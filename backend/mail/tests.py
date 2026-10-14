import re
from datetime import timedelta
from unittest import mock

from django.contrib.auth.models import User
from django.core import mail as django_mail
from django.test import TestCase, override_settings
from django.utils import timezone
from rest_framework.test import APITestCase

from telemetry.routers import all_log_shards

from . import inbox, services
from .models import ConfirmedEmail, InboundEmail, MailPreference, OutboundEmail
from .texts import TEXTS


def _link(message) -> str:
    return re.search(r'https?://\S+', message.body).group(0)


class TextsTests(TestCase):
    def test_every_key_exists_in_both_languages(self):
        self.assertEqual(set(TEXTS['pl']), set(TEXTS['en']))

    def test_link_bodies_carry_the_marker(self):
        for locale in ('pl', 'en'):
            for key in ('confirm_body', 'reset_body'):
                self.assertIn(OutboundEmail.LINK_MARKER, TEXTS[locale][key])


class MailApiTestCase(APITestCase):
    databases = set(all_log_shards()) | {'default'}

    def setUp(self):
        from django.core.cache import cache

        cache.clear()  # throttle counters
        self.user = User.objects.create_user('ala', 'ala@example.com', 'a-long-Passw0rd!')
        self.root = User.objects.create_superuser('root', 'root@example.com', 'a-long-Passw0rd!')
        self.staff = User.objects.create_user('mod', 'mod@example.com', 'a-long-Passw0rd!', is_staff=True)


class RegistrationConfirmationTests(MailApiTestCase):
    def test_register_sends_a_confirmation_and_the_link_confirms(self):
        with self.captureOnCommitCallbacks(execute=True):
            response = self.client.post('/api/auth/register/', {
                'username': 'ola', 'email': 'ola@example.com', 'password': 'a-long-Passw0rd!',
                'preferred_locale': 'pl', 'accept_terms': True,
            }, format='json')
        self.assertEqual(response.status_code, 201, response.data)
        self.assertEqual(len(django_mail.outbox), 1)
        message = django_mail.outbox[0]
        self.assertEqual(message.to, ['ola@example.com'])
        self.assertIn('potwierdź', message.subject)
        row = OutboundEmail.objects.get(kind=OutboundEmail.KIND_CONFIRM)
        # Delivered by locmem, which is not a real send — and the log holds no working link.
        self.assertEqual(row.status, OutboundEmail.STATUS_CONSOLE)
        self.assertIn(OutboundEmail.LINK_MARKER, row.body)
        self.assertNotIn('token=', row.body)

        token = _link(message).split('token=')[1]
        ola = User.objects.get(username='ola')
        self.assertFalse(services.is_confirmed(ola))
        response = self.client.post('/api/auth/confirm-email/', {'token': token}, format='json')
        self.assertEqual(response.status_code, 200)
        self.assertTrue(services.is_confirmed(ola))

    def test_a_tampered_token_is_refused_with_its_reason(self):
        response = self.client.post('/api/auth/confirm-email/', {'token': 'nonsense'}, format='json')
        self.assertEqual(response.status_code, 400)
        self.assertEqual(response.data['detail'], 'invalid')

    def test_confirmation_stops_matching_when_the_address_changes(self):
        ConfirmedEmail.objects.create(user=self.user, email='ala@example.com')
        self.assertTrue(services.is_confirmed(self.user))
        self.user.email = 'other@example.com'
        self.user.save()
        self.assertFalse(services.is_confirmed(self.user))

    def test_resend_refuses_once_confirmed(self):
        self.client.force_authenticate(self.user)
        with self.captureOnCommitCallbacks(execute=True):
            self.assertEqual(self.client.post('/api/auth/confirm-email/resend/').status_code, 202)
        self.assertEqual(len(django_mail.outbox), 1)
        ConfirmedEmail.objects.create(user=self.user, email=self.user.email)
        self.assertEqual(self.client.post('/api/auth/confirm-email/resend/').status_code, 409)


class PasswordResetTests(MailApiTestCase):
    def _request(self, email):
        with self.captureOnCommitCallbacks(execute=True):
            return self.client.post('/api/auth/password-reset/', {'email': email}, format='json')

    def test_unknown_and_known_addresses_get_the_same_answer(self):
        unknown = self._request('nobody@example.com')
        known = self._request('ALA@example.com')
        self.assertEqual(unknown.status_code, known.status_code)
        self.assertEqual(unknown.data, known.data)
        self.assertEqual(len(django_mail.outbox), 1)
        self.assertEqual(django_mail.outbox[0].to, ['ala@example.com'])

    def test_the_link_resets_once_and_logs_everybody_out(self):
        from rest_framework.authtoken.models import Token

        Token.objects.create(user=self.user)
        self._request('ala@example.com')
        link = _link(django_mail.outbox[0])
        uid = re.search(r'uid=([^&]+)', link).group(1)
        token = re.search(r'token=(\S+)', link).group(1)
        payload = {'uid': uid, 'token': token, 'password': 'An0ther-long-pass'}

        weak = self.client.post('/api/auth/password-reset/confirm/', {**payload, 'password': '123'}, format='json')
        self.assertEqual(weak.status_code, 400)
        self.assertIn('password', weak.data)

        ok = self.client.post('/api/auth/password-reset/confirm/', payload, format='json')
        self.assertEqual(ok.status_code, 200, ok.data)
        self.user.refresh_from_db()
        self.assertTrue(self.user.check_password('An0ther-long-pass'))
        self.assertFalse(Token.objects.filter(user=self.user).exists())
        self.assertTrue(services.is_confirmed(self.user))

        again = self.client.post('/api/auth/password-reset/confirm/', payload, format='json')
        self.assertEqual(again.status_code, 400)
        self.assertEqual(again.data['detail'], 'invalid_link')

    def test_the_logged_body_is_not_a_working_link(self):
        self._request('ala@example.com')
        row = OutboundEmail.objects.get(kind=OutboundEmail.KIND_RESET)
        self.assertNotIn('token=', row.body)


class QueueTests(MailApiTestCase):
    def test_a_failed_send_is_recorded_and_retried_by_drain(self):
        with mock.patch('django.core.mail.EmailMessage.send', side_effect=OSError('refused')):
            with self.captureOnCommitCallbacks(execute=True):
                row = services.send_test('x@example.com', self.user)
        row.refresh_from_db()
        self.assertEqual(row.status, OutboundEmail.STATUS_FAILED)
        self.assertIn('refused', row.error)
        result = services.drain()
        self.assertEqual(result['sent'], 1)
        row.refresh_from_db()
        self.assertEqual(row.status, OutboundEmail.STATUS_CONSOLE)
        self.assertEqual(row.attempts, 2)

    def test_a_row_is_claimed_once(self):
        row = OutboundEmail.objects.create(kind='test', to='x@example.com', subject='s', body='b')
        self.assertIsNotNone(services.deliver(row.pk))
        self.assertIsNone(services.deliver(row.pk))
        self.assertEqual(len(django_mail.outbox), 1)

    def test_a_row_stuck_in_sending_is_picked_up(self):
        row = OutboundEmail.objects.create(kind='test', to='x@example.com', subject='s', body='b', status='sending')
        OutboundEmail.objects.filter(pk=row.pk).update(created_at=timezone.now() - timedelta(hours=1))
        self.assertEqual(services.drain()['stuck'], 1)
        row.refresh_from_db()
        self.assertEqual(row.status, OutboundEmail.STATUS_CONSOLE)

    @override_settings(EMAIL_BACKEND='mail.transport.LoggedEmailBackend')
    def test_mail_sent_around_the_queue_is_logged_too(self):
        from django.core.mail import send_mail

        send_mail('hello', 'body', None, ['y@example.com'])
        row = OutboundEmail.objects.get(kind=OutboundEmail.KIND_DIRECT)
        self.assertEqual(row.to, 'y@example.com')
        self.assertEqual(row.status, OutboundEmail.STATUS_CONSOLE)


class DigestTests(MailApiTestCase):
    def _notify(self, label='Całka \\(\\int x\\)'):
        from notifications.services import notify

        return notify(self.user, 'submission_approved', actor=self.root, target_label=label)

    def test_digest_needs_opt_in_a_confirmed_address_and_an_hour(self):
        now = timezone.now()
        services.set_digest(self.user, True)
        MailPreference.objects.filter(user=self.user).update(digest_since=now - timedelta(hours=2))
        self._notify()
        self.assertEqual(services.send_digests(now), 0)  # not confirmed
        ConfirmedEmail.objects.create(user=self.user, email=self.user.email)
        with self.captureOnCommitCallbacks(execute=True):
            self.assertEqual(services.send_digests(now), 1)
        self.assertIn('\\(\\int x\\)', django_mail.outbox[0].body)
        # Within the hour: nothing, even with something new.
        self._notify('second')
        self.assertEqual(services.send_digests(now + timedelta(minutes=30)), 0)
        self.assertEqual(services.send_digests(now + timedelta(minutes=61)), 1)

    def test_switching_on_never_mails_the_backlog(self):
        self._notify()
        ConfirmedEmail.objects.create(user=self.user, email=self.user.email)
        services.set_digest(self.user, True)
        self.assertEqual(services.send_digests(timezone.now() + timedelta(hours=2)), 0)

    def test_my_mail_endpoint(self):
        self.client.force_authenticate(self.user)
        self.assertEqual(self.client.get('/api/auth/me/mail/').data,
                         {'email': 'ala@example.com', 'email_confirmed': False, 'notification_digest': False})
        response = self.client.patch('/api/auth/me/mail/', {'notification_digest': True}, format='json')
        self.assertTrue(response.data['notification_digest'])
        self.assertEqual(self.client.patch('/api/auth/me/mail/', {'notification_digest': 'yes'}, format='json').status_code, 400)


class MailTabAccessTests(MailApiTestCase):
    URLS = ['/api/mail/status/', '/api/mail/outbound/', '/api/mail/inbound/']

    def test_only_a_superuser_reads_the_mail_tab(self):
        for user, expected in ((None, 401), (self.user, 403), (self.staff, 403), (self.root, 200)):
            self.client.force_authenticate(user)
            for url in self.URLS:
                self.assertEqual(self.client.get(url).status_code, expected, (user, url))

    def test_lists_leave_bodies_out_and_details_have_them(self):
        row = OutboundEmail.objects.create(kind='test', to='x@example.com', subject='s', body='secret body')
        self.client.force_authenticate(self.root)
        self.assertNotIn('body', self.client.get('/api/mail/outbound/').data[0])
        self.assertEqual(self.client.get(f'/api/mail/outbound/{row.pk}/').data['body'], 'secret body')

    def test_retry_only_a_failed_row(self):
        row = OutboundEmail.objects.create(kind='test', to='x@example.com', subject='s', body='b', status='sent')
        self.client.force_authenticate(self.root)
        self.assertEqual(self.client.post(f'/api/mail/outbound/{row.pk}/retry/').status_code, 409)
        OutboundEmail.objects.filter(pk=row.pk).update(status='failed', attempts=5)
        with self.captureOnCommitCallbacks(execute=True):
            self.assertEqual(self.client.post(f'/api/mail/outbound/{row.pk}/retry/').status_code, 202)
        row.refresh_from_db()
        self.assertEqual(row.status, OutboundEmail.STATUS_CONSOLE)

    def test_fetch_without_a_password_says_why(self):
        self.client.force_authenticate(self.root)
        with override_settings(EMAIL_HOST_PASSWORD=''):
            response = self.client.post('/api/mail/inbound/fetch/')
        self.assertEqual(response.status_code, 503)
        self.assertEqual(response.data['detail'], 'not_configured')


RAW_HTML_MAIL = (
    b'From: =?utf-8?q?Zo=C5=9Bka?= <zoska@example.com>\r\n'
    b'To: no-reply@edmat.net\r\n'
    b'Subject: =?utf-8?q?Pytanie_o_zadanie?=\r\n'
    b'Date: Tue, 13 Oct 2026 10:00:00 +0200\r\n'
    b'Message-ID: <abc@example.com>\r\n'
    b'MIME-Version: 1.0\r\n'
    b'Content-Type: multipart/mixed; boundary="B"\r\n\r\n'
    b'--B\r\nContent-Type: text/html; charset=utf-8\r\n\r\n'
    b'<p>Dzie\xc5\x84 dobry</p><script>alert(1)</script><p>a &amp; b</p>\r\n'
    b'--B\r\nContent-Type: application/pdf\r\nContent-Disposition: attachment; filename="a.pdf"\r\n'
    b'Content-Transfer-Encoding: base64\r\n\r\nJVBERi0=\r\n--B--\r\n'
)


class FakeImap:
    def __init__(self, *args, **kwargs):
        self.untagged_responses = {'UIDVALIDITY': [b'7']}

    def login(self, user, password):
        return 'OK', []

    def select(self, folder, readonly=False):
        assert readonly, 'the inbox must be opened read-only'
        return 'OK', [b'1']

    def uid(self, command, *args):
        if command == 'search':
            return 'OK', [b'41 42']
        if '(RFC822.SIZE)' in args:
            return 'OK', [f'1 (UID {args[0]} RFC822.SIZE {len(RAW_HTML_MAIL)})'.encode()]
        assert 'BODY.PEEK' in args[1], 'never a fetch that marks a message read'
        return 'OK', [(b'1 (BODY[] {n}', RAW_HTML_MAIL), b')']

    def logout(self):
        return 'BYE', []


@override_settings(EMAIL_HOST_PASSWORD='x')
class InboxTests(TestCase):
    def test_fetch_stores_text_names_attachments_and_is_incremental(self):
        with mock.patch('mail.inbox.imaplib.IMAP4_SSL', FakeImap):
            self.assertEqual(inbox.fetch(), 2)
            self.assertEqual(inbox.fetch(), 0)
        row = InboundEmail.objects.get(uid=41)
        self.assertEqual(row.from_address, 'Zośka <zoska@example.com>')
        self.assertEqual(row.subject, 'Pytanie o zadanie')
        self.assertIn('Dzień dobry', row.body)
        self.assertIn('a & b', row.body)
        self.assertNotIn('alert', row.body)
        self.assertNotIn('<p>', row.body)
        self.assertEqual(row.attachments, [{'filename': 'a.pdf', 'content_type': 'application/pdf', 'size': 5}])
