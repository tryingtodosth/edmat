"""A person's default licence (`accounts.Profile.default_licence`, 2026-10-22, HISTORY §17CX).

Pinned here: it round-trips through `/api/auth/me/` (blank = "no default, each form suggests");
`unknown` and a made-up key are refused with the same reasons every create form gives and change
nothing; an anonymous caller gets nothing; a stranger's public profile does not carry it; and
`rules.default_licence_for` resolves blank, anonymous and a stale stored value to `edmat-only`.
"""

from __future__ import annotations

from django.contrib.auth.models import AnonymousUser
from rest_framework.test import APITestCase

from accounts.models import Profile
from licensing.rules import default_licence_for
from telemetry.routers import all_log_shards
from testing.factories import make_user


class DefaultLicenceTests(APITestCase):
    databases = set(all_log_shards()) | {'default'}

    def setUp(self):
        self.user = make_user('deflic-me')
        self.other = make_user('deflic-other')

    def me(self):
        return self.client.get('/api/auth/me/')

    def patch(self, value):
        return self.client.patch('/api/auth/me/', {'default_licence': value}, format='json')

    def test_it_round_trips_and_blank_clears_it(self):
        self.client.force_authenticate(self.user)
        self.assertEqual(self.me().data['default_licence'], '')
        response = self.patch('cc-by-sa-4.0')
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.data['default_licence'], 'cc-by-sa-4.0')
        self.assertEqual(self.me().data['default_licence'], 'cc-by-sa-4.0')
        self.assertEqual(self.patch('edmat-only').data['default_licence'], 'edmat-only')
        self.assertEqual(self.patch('').data['default_licence'], '')
        self.assertEqual(Profile.objects.get(user=self.user).default_licence, '')

    def test_unknown_and_a_made_up_key_are_refused_with_their_reasons(self):
        self.client.force_authenticate(self.user)
        self.patch('cc-by-4.0')
        for value, reason in (('unknown', 'licence_not_selectable'), ('mit', 'licence_unknown_key')):
            response = self.patch(value)
            self.assertEqual(response.status_code, 400, value)
            self.assertEqual([str(e) for e in response.data['default_licence']], [reason])
        self.assertEqual(Profile.objects.get(user=self.user).default_licence, 'cc-by-4.0')

    def test_anonymous_gets_nothing(self):
        self.assertEqual(self.me().status_code, 401)
        self.assertEqual(self.patch('cc-by-4.0').status_code, 401)

    def test_a_strangers_public_profile_does_not_carry_it(self):
        Profile.objects.filter(user=self.other).update(default_licence='cc0-1.0')
        self.client.force_authenticate(self.user)
        response = self.client.get(f'/api/users/{self.other.pk}/')
        self.assertEqual(response.status_code, 200)
        self.assertNotIn('default_licence', response.data)

    def test_the_server_side_reader_falls_back_to_edmat_only(self):
        self.assertEqual(default_licence_for(None), 'edmat-only')
        self.assertEqual(default_licence_for(AnonymousUser()), 'edmat-only')
        self.assertEqual(default_licence_for(self.user), 'edmat-only')
        Profile.objects.filter(user=self.user).update(default_licence='cc-by-4.0')
        self.user.refresh_from_db()
        self.assertEqual(default_licence_for(self.user), 'cc-by-4.0')
        # a value that slipped in some other way (the admin, an old row) is never handed out
        Profile.objects.filter(user=self.user).update(default_licence='unknown')
        self.user.refresh_from_db()
        self.assertEqual(default_licence_for(self.user), 'edmat-only')
