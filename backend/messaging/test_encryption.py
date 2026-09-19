"""Private message bodies are encrypted at rest (messaging/crypto.py).

Weighted at the properties that fail silently rather than loudly. A body that is not actually
encrypted still round-trips perfectly through the API, so an assertion on what the API returns can
never tell whether this feature works at all — every test here that matters reads the DATABASE ROW.
The reverse case matters too: a key change or a truncated value must degrade to one unreadable
message rather than a 500 that takes a whole inbox with it.
"""

import base64
import os
from io import StringIO

from django.core.management import call_command
from django.test import override_settings
from django.urls import reverse
from postman.models import Message
from rest_framework import status
from rest_framework.test import APITestCase

from messaging.crypto import PREFIX, MessageDecryptionError, decrypt_text, encrypt_text
from moderation.models import FeatureFlag
from testing.factories import make_user

OTHER_KEY = base64.urlsafe_b64encode(os.urandom(32)).decode()


class BodyEncryptionTests(APITestCase):
    def setUp(self):
        self.sender = make_user('crypt-sender')
        self.recipient = make_user('crypt-recipient')

    def _send(self, body='Do you have time this Thursday at six?', subject='About your listing'):
        self.client.force_authenticate(self.sender)
        response = self.client.post(
            reverse('message-list'),
            {'recipient_id': self.recipient.pk, 'subject': subject, 'body': body},
            format='json',
        )
        self.assertEqual(response.status_code, status.HTTP_201_CREATED)
        return Message.objects.get(pk=response.data['id'])

    def test_the_stored_row_does_not_contain_the_message(self):
        body = 'Do you have time this Thursday at six?'
        message = self._send(body=body)

        self.assertNotEqual(message.body, body)
        self.assertNotIn('Thursday', message.body)
        self.assertTrue(message.body.startswith(PREFIX))

    def test_both_people_read_the_real_words_back(self):
        body = 'Do you have time this Thursday at six?'
        message = self._send(body=body)

        for user in (self.sender, self.recipient):
            self.client.force_authenticate(user)
            response = self.client.get(reverse('message-detail', args=[message.pk]))
            self.assertEqual(response.status_code, status.HTTP_200_OK)
            self.assertEqual(response.data['body'], body)
            self.assertFalse(response.data['body_unavailable'])

    def test_a_reply_is_encrypted_too(self):
        original = self._send()
        self.client.force_authenticate(self.recipient)
        response = self.client.post(
            reverse('message-reply', args=[original.pk]),
            {'body': 'Thursday is good, see you at six.'},
            format='json',
        )
        self.assertEqual(response.status_code, status.HTTP_201_CREATED)

        reply = Message.objects.get(pk=response.data['id'])
        self.assertTrue(reply.body.startswith(PREFIX))
        self.assertNotIn('Thursday', reply.body)
        self.assertEqual(response.data['body'], 'Thursday is good, see you at six.')
        # The `Re:` default is built from the parent's own subject, which is stored in clear — so it
        # reads as a subject and not as base64. Pins the seam if the subject is ever encrypted too.
        self.assertEqual(reply.subject, 'Re: About your listing')

    def test_the_subject_is_deliberately_not_encrypted(self):
        """A decision, not an oversight — `Message.subject` is a CharField(120) and the ciphertext of
        a full-length subject does not fit in it. crypto.py's module docstring carries the reasoning;
        this test is here so that changing it is a deliberate act rather than an accident."""
        message = self._send(subject='About your listing')
        self.assertEqual(message.subject, 'About your listing')

    def test_an_empty_body_stays_empty(self):
        message = self._send(body='')
        self.assertEqual(message.body, '')

    def test_a_listing_decrypts_every_row_not_just_the_first(self):
        """DRF reuses ONE child serializer across a list, so a decrypt cached on `self` would serve
        the first message's body for every row. Two different bodies is what catches that."""
        self._send(body='First question about the notes.')
        self._send(body='Second, unrelated question.')

        self.client.force_authenticate(self.recipient)
        response = self.client.get(reverse('message-list'), {'folder': 'inbox'})
        bodies = sorted(row['body'] for row in response.data)
        self.assertEqual(bodies, ['First question about the notes.', 'Second, unrelated question.'])


class BackwardsCompatibilityTests(APITestCase):
    """Encryption was switched on over a database that already had messages in it, and nothing
    forces those rows to be converted — so an unconverted one has to keep working."""

    def setUp(self):
        self.sender = make_user('legacy-sender')
        self.recipient = make_user('legacy-recipient')
        self.message = Message.objects.create(
            sender=self.sender,
            recipient=self.recipient,
            subject='Written before any of this',
            body='Plain text, straight in the column.',
            moderation_status='a',
        )

    def test_a_plaintext_row_still_reads_correctly(self):
        self.client.force_authenticate(self.recipient)
        response = self.client.get(reverse('message-detail', args=[self.message.pk]))

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(response.data['body'], 'Plain text, straight in the column.')
        self.assertFalse(response.data['body_unavailable'])

    def test_the_command_converts_it_and_is_idempotent(self):
        out = StringIO()
        call_command('encrypt_messages', stdout=out)

        self.message.refresh_from_db()
        self.assertTrue(self.message.body.startswith(PREFIX))
        self.assertEqual(decrypt_text(self.message.body), 'Plain text, straight in the column.')

        after_first = self.message.body
        call_command('encrypt_messages', stdout=StringIO())
        self.message.refresh_from_db()
        # Unchanged, not re-encrypted: a second run must not wrap the ciphertext in ciphertext.
        self.assertEqual(self.message.body, after_first)

    def test_check_reports_without_changing_anything(self):
        out = StringIO()
        call_command('encrypt_messages', '--check', stdout=out)

        self.message.refresh_from_db()
        self.assertEqual(self.message.body, 'Plain text, straight in the column.')
        self.assertIn('1 in clear', out.getvalue())


class UnreadableRowTests(APITestCase):
    """A rotated key, a truncated value, a tampered row — the inbox stays up and says so."""

    def setUp(self):
        self.sender = make_user('rot-sender')
        self.recipient = make_user('rot-recipient')
        with override_settings(EDMAT_MESSAGE_KEY=OTHER_KEY):
            sealed = encrypt_text('Encrypted with a key this server no longer has.')
        self.message = Message.objects.create(
            sender=self.sender,
            recipient=self.recipient,
            subject='Unreadable',
            body=sealed,
            moderation_status='a',
        )

    def test_the_inbox_still_loads_and_flags_the_message(self):
        self.client.force_authenticate(self.recipient)
        response = self.client.get(reverse('message-detail', args=[self.message.pk]))

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(response.data['body'], '')
        self.assertTrue(response.data['body_unavailable'])

    def test_a_listing_containing_one_still_returns_200(self):
        self.client.force_authenticate(self.recipient)
        response = self.client.get(reverse('message-list'), {'folder': 'inbox'})

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(len(response.data), 1)
        self.assertTrue(response.data[0]['body_unavailable'])

    def test_tampering_is_detected_rather_than_decrypting_to_something_else(self):
        sealed = encrypt_text('The original sentence.')
        flipped = sealed[:-2] + ('AB' if sealed[-2:] != 'AB' else 'CD')
        with self.assertRaises(MessageDecryptionError):
            decrypt_text(flipped)


class KeyConfigurationTests(APITestCase):
    def test_a_message_sealed_under_one_key_is_unreadable_under_another(self):
        sealed = encrypt_text('Something private.')
        with override_settings(EDMAT_MESSAGE_KEY=OTHER_KEY):
            with self.assertRaises(MessageDecryptionError):
                decrypt_text(sealed)

    @override_settings(EDMAT_MESSAGE_KEY=OTHER_KEY)
    def test_a_configured_key_is_used_in_preference_to_the_derived_one(self):
        sealed = encrypt_text('Something private.')
        self.assertEqual(decrypt_text(sealed), 'Something private.')

    @override_settings(EDMAT_MESSAGE_KEY=base64.urlsafe_b64encode(b'too short').decode())
    def test_a_key_of_the_wrong_length_is_refused_loudly(self):
        with self.assertRaises(ValueError):
            encrypt_text('Something private.')


class FeatureFlagInteractionTests(APITestCase):
    def test_encryption_does_not_depend_on_the_messaging_flag(self):
        """The flag governs the endpoints; the crypto governs the column. Turning messaging off must
        not leave anything writing bodies in clear by another route."""
        FeatureFlag.objects.filter(key='messaging').update(is_enabled=False)
        self.assertTrue(encrypt_text('still sealed').startswith(PREFIX))
