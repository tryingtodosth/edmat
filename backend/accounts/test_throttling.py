"""Regression tests for the auth rate limiting — the fourth gap the whole-project security scan
found, and the one with the shortest path from "missing" to a compromised account: before this,
`POST /api/auth/login/` accepted unlimited password guesses against any account.

**Every test clears the cache first.** DRF throttling counts through Django's cache, and the default
`LocMemCache` is shared for the whole test process — without an explicit clear, one test's requests
leak into the next one's budget and the results depend on execution order. This is also why the rates
are overridden per-test to small, obvious numbers rather than testing against the real production
values: a test that has to issue 600 requests to prove a 600/hour limit is a slow test that proves
very little.
"""

from __future__ import annotations

import shutil
import tempfile
from unittest import mock

from django.contrib.auth import get_user_model
from django.core.cache import cache
from django.test import override_settings
from django.urls import reverse
from rest_framework import status
from rest_framework.test import APITestCase
from rest_framework.throttling import SimpleRateThrottle

User = get_user_model()


class ThrottleTestCase(APITestCase):
    """Base class handling the two things that make throttle tests silently meaningless otherwise.

    **1. The rate override has to patch the throttle class, not the setting.** `SimpleRateThrottle`
    binds `THROTTLE_RATES = api_settings.DEFAULT_THROTTLE_RATES` as a CLASS attribute, evaluated once
    at import time — so `override_settings(REST_FRAMEWORK=...)` genuinely does not reach it, and a
    test written that way runs against the real production rates while appearing to declare its own.
    Found the hard way: the first version of these tests failed because 4 requests understandably did
    not trip a 10/min limit. `patch.dict` on the shared dict every throttle subclass inherits is what
    actually works.

    **2. The cache has to be cleared between tests.** DRF counts through Django's cache, and the
    default `LocMemCache` persists for the whole test process, so without this one test's requests
    spend the next one's budget and results depend on execution order.

    Subclasses declare `RATES` with small, obvious numbers rather than testing the real production
    values — a test that must issue 600 requests to prove a 600/hour limit is slow and proves little.
    """

    RATES: dict[str, str] = {}

    def setUp(self):
        cache.clear()
        self._patch = mock.patch.dict(SimpleRateThrottle.THROTTLE_RATES, self.RATES)
        self._patch.start()

    def tearDown(self):
        self._patch.stop()
        cache.clear()


class LoginIpThrottleTests(ThrottleTestCase):
    RATES = {'login': '3/min', 'login_username': '100/hour'}

    def setUp(self):
        super().setUp()
        self.user = User.objects.create_user('throttled', 'throttled@example.com', 'right-password')
        self.url = reverse('auth-login')

    def _attempt(self, password='wrong-password', username='throttled@example.com'):
        return self.client.post(
            self.url, {'username': username, 'password': password}, format='json'
        )

    def test_repeated_failed_logins_from_one_ip_are_eventually_throttled(self):
        for i in range(3):
            self.assertEqual(
                self._attempt().status_code,
                status.HTTP_401_UNAUTHORIZED,
                msg=f'attempt {i + 1} should still be allowed through',
            )

        self.assertEqual(self._attempt().status_code, status.HTTP_429_TOO_MANY_REQUESTS)

    def test_a_successful_login_still_counts_toward_the_limit(self):
        """DRF throttles REQUESTS, not failures — worth pinning down as the real, documented
        behavior rather than leaving a future reader to assume a failed-attempt lockout. It is also
        exactly the limitation accounts/throttles.py names as a follow-up."""
        for _ in range(3):
            self._attempt()

        response = self._attempt(password='right-password')

        self.assertEqual(response.status_code, status.HTTP_429_TOO_MANY_REQUESTS)


class LoginUsernameThrottleTests(ThrottleTestCase):
    """The credential-stuffing case: guessing one account's password from a large pool of IPs never
    trips any single IP's own counter, which is why the per-IP throttle is set absurdly high here —
    it must be the identifier-keyed one doing the work, or these tests prove nothing."""

    RATES = {'login': '1000/min', 'login_username': '3/hour'}

    def setUp(self):
        super().setUp()
        User.objects.create_user('victim', 'victim@example.com', 'right-password')
        User.objects.create_user('bystander', 'bystander@example.com', 'right-password')
        self.url = reverse('auth-login')

    def _attempt(self, username, ip='10.0.0.1'):
        return self.client.post(
            self.url,
            {'username': username, 'password': 'wrong-password'},
            format='json',
            REMOTE_ADDR=ip,
        )

    def test_guessing_one_account_from_many_ips_is_still_throttled(self):
        for i in range(3):
            self.assertEqual(
                self._attempt('victim@example.com', ip=f'10.0.0.{i + 1}').status_code,
                status.HTTP_401_UNAUTHORIZED,
            )

        # A brand-new IP, which no per-IP throttle would have ever seen before.
        response = self._attempt('victim@example.com', ip='203.0.113.99')

        self.assertEqual(response.status_code, status.HTTP_429_TOO_MANY_REQUESTS)

    def test_throttling_one_account_does_not_lock_out_a_different_account(self):
        for i in range(4):
            self._attempt('victim@example.com', ip=f'10.0.0.{i + 1}')

        response = self._attempt('bystander@example.com')

        self.assertEqual(response.status_code, status.HTTP_401_UNAUTHORIZED)

    def test_capitalization_and_whitespace_cannot_reset_the_budget(self):
        """Without normalization the throttle is trivially bypassed — every variant of the same
        address would get its own fresh counter."""
        for _ in range(3):
            self._attempt('victim@example.com')

        response = self._attempt('  VICTIM@Example.COM  ')

        self.assertEqual(response.status_code, status.HTTP_429_TOO_MANY_REQUESTS)


class ScopedThrottleTests(ThrottleTestCase):
    RATES = {'register': '2/hour', 'avatar': '2/hour'}

    @classmethod
    def setUpClass(cls):
        cls._media_root = tempfile.mkdtemp(prefix='edmat-throttle-test-')
        cls._media_override = override_settings(MEDIA_ROOT=cls._media_root)
        cls._media_override.enable()
        super().setUpClass()

    @classmethod
    def tearDownClass(cls):
        super().tearDownClass()
        cls._media_override.disable()
        shutil.rmtree(cls._media_root, ignore_errors=True)

    def test_registration_is_throttled(self):
        url = reverse('auth-register')
        for i in range(2):
            response = self.client.post(
                url,
                {
                    'username': f'fresh{i}',
                    'email': f'fresh{i}@example.com',
                    'password': 'a-real-password',
                },
                format='json',
            )
            self.assertEqual(response.status_code, status.HTTP_201_CREATED)

        response = self.client.post(
            url,
            {'username': 'fresh9', 'email': 'fresh9@example.com', 'password': 'a-real-password'},
            format='json',
        )

        self.assertEqual(response.status_code, status.HTTP_429_TOO_MANY_REQUESTS)

    def test_avatar_upload_is_throttled(self):
        """The most expensive authenticated write in the app — it decodes and re-encodes a real
        image, so an unbounded rate is a CPU-exhaustion lever for any logged-in account.

        The MEDIA_ROOT override is not incidental: the first version of this test lacked it and
        genuinely left two stray .webp files in the real `backend/media/avatars/` directory alongside
        actual user uploads, found by listing that directory rather than assumed absent."""
        from accounts.test_avatar import make_image_bytes, make_upload

        user = User.objects.create_user('uploader', 'uploader@example.com', 'pw-for-test')
        self.client.force_authenticate(user)
        url = reverse('auth-me-avatar')

        for _ in range(2):
            self.client.post(url, {'avatar': make_upload(make_image_bytes(60, 60))}, 'multipart')

        response = self.client.post(
            url, {'avatar': make_upload(make_image_bytes(60, 60))}, 'multipart'
        )

        self.assertEqual(response.status_code, status.HTTP_429_TOO_MANY_REQUESTS)
