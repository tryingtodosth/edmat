"""`/api/auth/me/password/` — setting a first password and changing one (`accounts/password.py`)."""

from django.contrib.auth.models import User
from django.core.cache import cache
from rest_framework.test import APITestCase

from telemetry.models import AuditEvent
from telemetry.routers import all_log_shards, shard_for_user

URL = '/api/auth/me/password/'
STRONG = 'Plenty-long-Passw0rd!'


class PasswordTestCase(APITestCase):
    databases = set(all_log_shards()) | {'default'}

    def setUp(self):
        cache.clear()  # throttle counters


class SetFirstPasswordTests(PasswordTestCase):
    def setUp(self):
        super().setUp()
        self.user = User.objects.create_user('sso-only', 'sso@example.com')  # unusable password
        self.client.force_authenticate(self.user)

    def test_reports_no_password(self):
        self.assertEqual(self.client.get(URL).data, {'has_password': False})

    def test_sets_one_without_a_current_password(self):
        res = self.client.post(URL, {'new_password': STRONG}, format='json')
        self.assertEqual(res.status_code, 200)
        self.user.refresh_from_db()
        self.assertTrue(self.user.check_password(STRONG))
        event = AuditEvent.objects.using(shard_for_user(self.user.pk)).get(target_type='user')
        self.assertEqual(event.action, 'password_change')
        self.assertEqual(event.summary, 'First password set')
        # …and from now on it is a change, which wants the current one.
        res = self.client.post(URL, {'new_password': 'Another-long-Passw0rd!'}, format='json')
        self.assertEqual(res.data['current_password'], ['current_password_required'])

    def test_weak_password_is_refused_with_the_validators_words(self):
        res = self.client.post(URL, {'new_password': 'password'}, format='json')
        self.assertEqual(res.status_code, 400)
        self.assertTrue(res.data['new_password'])
        self.user.refresh_from_db()
        self.assertFalse(self.user.has_usable_password())

    def test_missing_new_password(self):
        self.assertEqual(self.client.post(URL, {}, format='json').data['new_password'], ['new_password_required'])


class ChangePasswordTests(PasswordTestCase):
    def setUp(self):
        super().setUp()
        self.user = User.objects.create_user('ala', 'ala@example.com', STRONG)
        self.client.force_authenticate(self.user)

    def test_change_needs_the_current_password(self):
        res = self.client.post(URL, {'new_password': 'Another-long-Passw0rd!'}, format='json')
        self.assertEqual(res.data['current_password'], ['current_password_required'])
        res = self.client.post(URL, {'current_password': 'wrong', 'new_password': 'Another-long-Passw0rd!'}, format='json')
        self.assertEqual(res.status_code, 400)
        self.assertEqual(res.data['current_password'], ['current_password_wrong'])
        self.user.refresh_from_db()
        self.assertTrue(self.user.check_password(STRONG))

    def test_change(self):
        res = self.client.post(URL, {'current_password': STRONG, 'new_password': 'Another-long-Passw0rd!'}, format='json')
        self.assertEqual(res.status_code, 200)
        self.user.refresh_from_db()
        self.assertTrue(self.user.check_password('Another-long-Passw0rd!'))
        self.assertEqual(
            AuditEvent.objects.using(shard_for_user(self.user.pk)).get(target_type='user').summary, 'Password changed'
        )

    def test_the_new_password_is_validated_against_the_user(self):
        res = self.client.post(URL, {'current_password': STRONG, 'new_password': 'ala@example.com1'}, format='json')
        self.assertEqual(res.status_code, 400)
        self.assertIn('new_password', res.data)

    def test_anonymous_is_refused(self):
        self.client.force_authenticate(None)
        self.assertEqual(self.client.post(URL, {'new_password': STRONG}, format='json').status_code, 401)
