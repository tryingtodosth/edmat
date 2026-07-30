"""Part of this project's automated test suite (CLAUDE.md Section 17L's own established convention
- Django's/DRF's built-in TestCase/APITestCase, no new dependency). Covers messaging/views.py's
own thin DRF wrapper over django-postman: sending a brand-new message, replying within a thread
(services.py's own hand-written thread-linking logic, since django-postman ships no reply() API of
its own), the unread-count badge, folder listing, and the sender-or-recipient access boundary.
"""

from django.urls import reverse
from postman.models import Message
from rest_framework import status
from rest_framework.test import APITestCase

from moderation.models import FeatureFlag
from testing.factories import make_user


class SendMessageTests(APITestCase):
    def setUp(self):
        self.sender = make_user('msg-sender')
        self.recipient = make_user('msg-recipient')

    def test_authenticated_user_can_send_a_new_message(self):
        self.client.force_authenticate(self.sender)

        response = self.client.post(
            reverse('message-list'),
            {
                'recipient_id': self.recipient.pk,
                'subject': 'Interested in your tutoring',
                'body': 'Do you have time this week?',
            },
            format='json',
        )

        self.assertEqual(response.status_code, status.HTTP_201_CREATED)
        message = Message.objects.get(pk=response.data['id'])
        self.assertEqual(message.sender_id, self.sender.pk)
        self.assertEqual(message.recipient_id, self.recipient.pk)
        self.assertEqual(message.subject, 'Interested in your tutoring')
        self.assertIsNone(message.parent_id)

    def test_anonymous_user_cannot_send_a_message(self):
        response = self.client.post(
            reverse('message-list'),
            {'recipient_id': self.recipient.pk, 'subject': 'Anon message'},
            format='json',
        )

        self.assertEqual(response.status_code, status.HTTP_401_UNAUTHORIZED)
        self.assertFalse(Message.objects.filter(subject='Anon message').exists())

    def test_cannot_send_a_message_to_oneself(self):
        self.client.force_authenticate(self.sender)

        response = self.client.post(
            reverse('message-list'),
            {'recipient_id': self.sender.pk, 'subject': 'Note to self'},
            format='json',
        )

        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertIn('recipient_id', response.data)

    def test_unknown_recipient_id_is_rejected(self):
        self.client.force_authenticate(self.sender)

        response = self.client.post(
            reverse('message-list'),
            {'recipient_id': 999999, 'subject': 'Nobody home'},
            format='json',
        )

        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertIn('recipient_id', response.data)

    def test_sending_a_message_increments_the_recipients_unread_count(self):
        self.client.force_authenticate(self.sender)
        self.client.post(
            reverse('message-list'),
            {'recipient_id': self.recipient.pk, 'subject': 'Hello', 'body': 'Hi there'},
            format='json',
        )

        self.client.force_authenticate(self.recipient)
        response = self.client.get(reverse('message-unread-count'))

        self.assertEqual(response.data['unread_count'], 1)


class ReplyAndThreadingTests(APITestCase):
    def setUp(self):
        self.sender = make_user('thread-sender')
        self.recipient = make_user('thread-recipient')
        self.client.force_authenticate(self.sender)
        create_response = self.client.post(
            reverse('message-list'),
            {'recipient_id': self.recipient.pk, 'subject': 'Original subject', 'body': 'First message.'},
            format='json',
        )
        self.original = Message.objects.get(pk=create_response.data['id'])

    def test_recipient_can_reply_and_thread_id_links_both_messages(self):
        self.client.force_authenticate(self.recipient)

        reply_response = self.client.post(
            reverse('message-reply', args=[self.original.pk]),
            {'body': 'Sure, Thursday works.'},
            format='json',
        )

        self.assertEqual(reply_response.status_code, status.HTTP_201_CREATED)
        reply = Message.objects.get(pk=reply_response.data['id'])
        self.assertEqual(reply.parent_id, self.original.pk)
        # The first-ever reply promotes the original into being its own thread root.
        self.original.refresh_from_db()
        self.assertEqual(self.original.thread_id, self.original.pk)
        self.assertEqual(reply.thread_id, self.original.pk)
        self.assertEqual(reply.subject, 'Re: Original subject')

    def test_reply_recipient_is_whoever_isnt_the_replier_not_always_the_original_sender(self):
        # The recipient replies first...
        self.client.force_authenticate(self.recipient)
        first_reply = self.client.post(
            reverse('message-reply', args=[self.original.pk]),
            {'body': 'Sure, Thursday works.'},
            format='json',
        ).data

        # ...then the ORIGINAL SENDER replies to that reply. The recipient of this second reply
        # should be the original recipient (whoever isn't the current replier), not blindly
        # `parent.sender` (which here would incorrectly be the recipient again).
        self.client.force_authenticate(self.sender)
        second_reply_response = self.client.post(
            reverse('message-reply', args=[first_reply['id']]),
            {'body': 'Great, see you then.'},
            format='json',
        )

        self.assertEqual(second_reply_response.status_code, status.HTTP_201_CREATED)
        self.assertEqual(second_reply_response.data['recipient_id'], self.recipient.pk)
        self.assertEqual(second_reply_response.data['sender_id'], self.sender.pk)

    def test_a_custom_subject_can_override_the_default_re_prefix(self):
        self.client.force_authenticate(self.recipient)

        response = self.client.post(
            reverse('message-reply', args=[self.original.pk]),
            {'body': 'Different subject entirely', 'subject': 'A whole new topic'},
            format='json',
        )

        self.assertEqual(response.data['subject'], 'A whole new topic')

    def test_thread_endpoint_returns_every_message_oldest_first(self):
        self.client.force_authenticate(self.recipient)
        self.client.post(
            reverse('message-reply', args=[self.original.pk]), {'body': 'Reply one.'}, format='json'
        )
        self.client.force_authenticate(self.sender)
        self.client.post(
            reverse('message-reply', args=[self.original.pk]), {'body': 'Reply two.'}, format='json'
        )

        response = self.client.get(reverse('message-thread', args=[self.original.pk]))

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        bodies = [row['body'] for row in response.data]
        self.assertEqual(bodies, ['First message.', 'Reply one.', 'Reply two.'])
        # The root message's own replies_count reflects every reply in the thread.
        root_row = response.data[0]
        self.assertEqual(root_row['replies_count'], 2)

    def test_a_third_party_cannot_reply_to_or_view_a_thread_they_arent_part_of(self):
        outsider = make_user('thread-outsider')
        self.client.force_authenticate(outsider)

        reply_response = self.client.post(
            reverse('message-reply', args=[self.original.pk]), {'body': 'Butting in'}, format='json'
        )
        thread_response = self.client.get(reverse('message-thread', args=[self.original.pk]))
        retrieve_response = self.client.get(reverse('message-detail', args=[self.original.pk]))

        self.assertEqual(reply_response.status_code, status.HTTP_404_NOT_FOUND)
        self.assertEqual(thread_response.status_code, status.HTTP_404_NOT_FOUND)
        self.assertEqual(retrieve_response.status_code, status.HTTP_404_NOT_FOUND)


class RetrieveMarksReadTests(APITestCase):
    def setUp(self):
        self.sender = make_user('read-sender')
        self.recipient = make_user('read-recipient')
        self.client.force_authenticate(self.sender)
        create_response = self.client.post(
            reverse('message-list'),
            {'recipient_id': self.recipient.pk, 'subject': 'Please read me'},
            format='json',
        )
        self.message_id = create_response.data['id']

    def test_retrieving_a_message_as_its_recipient_marks_it_read(self):
        self.client.force_authenticate(self.recipient)
        pre_count = self.client.get(reverse('message-unread-count')).data['unread_count']
        self.assertEqual(pre_count, 1)

        detail_response = self.client.get(reverse('message-detail', args=[self.message_id]))

        self.assertEqual(detail_response.status_code, status.HTTP_200_OK)
        self.assertTrue(detail_response.data['is_read'])
        post_count = self.client.get(reverse('message-unread-count')).data['unread_count']
        self.assertEqual(post_count, 0)

    def test_retrieving_as_the_sender_does_not_mark_it_read_and_recipients_count_is_unaffected(self):
        self.client.force_authenticate(self.sender)

        detail_response = self.client.get(reverse('message-detail', args=[self.message_id]))

        self.assertEqual(detail_response.status_code, status.HTTP_200_OK)
        self.client.force_authenticate(self.recipient)
        count = self.client.get(reverse('message-unread-count')).data['unread_count']
        self.assertEqual(count, 1)


class FolderListingTests(APITestCase):
    def setUp(self):
        self.sender = make_user('folder-sender')
        self.recipient = make_user('folder-recipient')
        self.client.force_authenticate(self.sender)
        self.client.post(
            reverse('message-list'),
            {'recipient_id': self.recipient.pk, 'subject': 'In the recipient inbox'},
            format='json',
        )

    def test_default_folder_is_inbox(self):
        self.client.force_authenticate(self.recipient)

        response = self.client.get(reverse('message-list'))

        subjects = [row['subject'] for row in response.data]
        self.assertIn('In the recipient inbox', subjects)

    def test_sent_folder_shows_the_senders_own_outgoing_messages(self):
        response = self.client.get(reverse('message-list'), {'folder': 'sent'})

        subjects = [row['subject'] for row in response.data]
        self.assertIn('In the recipient inbox', subjects)

    def test_invalid_folder_name_is_rejected(self):
        response = self.client.get(reverse('message-list'), {'folder': 'not-a-real-folder'})

        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)

    def test_anonymous_user_cannot_list_messages(self):
        self.client.force_authenticate(None)

        response = self.client.get(reverse('message-list'))

        self.assertEqual(response.status_code, status.HTTP_401_UNAUTHORIZED)


class MessagingKillSwitchTests(APITestCase):
    """The 'messaging' FeatureFlag (moderation/models.py), wired in via
    moderation/permissions.py's feature_gate('messaging') on MessageViewSet.permission_classes —
    applies to every action (list/retrieve/create/reply/thread/unread-count), so the whole surface
    is inaccessible to a non-staff user while off."""

    def setUp(self):
        self.sender = make_user('kill-msg-sender')
        self.recipient = make_user('kill-msg-recipient')
        self.staff = make_user('kill-msg-staff', is_staff=True)
        FeatureFlag.objects.filter(key='messaging').update(is_enabled=False)

    def test_inbox_is_blocked_while_off(self):
        self.client.force_authenticate(self.recipient)

        response = self.client.get(reverse('message-list'))

        self.assertEqual(response.status_code, status.HTTP_403_FORBIDDEN)

    def test_sending_a_message_is_blocked_while_off(self):
        self.client.force_authenticate(self.sender)

        response = self.client.post(
            reverse('message-list'),
            {'recipient_id': self.recipient.pk, 'subject': 'Hi', 'body': 'Still there?'},
        )

        self.assertEqual(response.status_code, status.HTTP_403_FORBIDDEN)
        self.assertFalse(Message.objects.filter(subject='Hi').exists())

    def test_staff_is_unaffected_while_off(self):
        self.client.force_authenticate(self.staff)

        response = self.client.get(reverse('message-list'))

        self.assertEqual(response.status_code, status.HTTP_200_OK)

    def test_turning_it_back_on_restores_access(self):
        FeatureFlag.objects.filter(key='messaging').update(is_enabled=True)
        self.client.force_authenticate(self.recipient)

        response = self.client.get(reverse('message-list'))

        self.assertEqual(response.status_code, status.HTTP_200_OK)
