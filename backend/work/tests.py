"""Tests for `work` — refusals first (MANAGEMENT-BRIEF.md §3, §4 rule 14)."""

from django.test import TestCase
from django.contrib.auth import get_user_model
from django.utils import timezone
from datetime import timedelta
from rest_framework.test import APITestCase
from rest_framework.authtoken.models import Token
from moderation.models import FeatureFlag
from testing.factories import make_user
from . import providers

User = get_user_model()


class WorkDashboardAuthTests(APITestCase):
    """Refusal tests: the endpoint rejects unauthenticated requests."""

    def test_anonymous_gets_401(self):
        """Anonymous request should get 401."""
        response = self.client.get('/api/work/')
        self.assertEqual(response.status_code, 401)

    def test_authenticated_succeeds(self):
        """Authenticated request should get 200."""
        user = make_user()
        token = Token.objects.create(user=user)
        self.client.credentials(HTTP_AUTHORIZATION=f'Token {token.key}')

        response = self.client.get('/api/work/')
        self.assertEqual(response.status_code, 200)
        self.assertIn('sections', response.data)
        self.assertIn('unavailable', response.data)
        self.assertIn('generated_at', response.data)


class ProviderRegistryTests(TestCase):
    """Tests for the provider registry and collection."""

    def setUp(self):
        """Set up test data."""
        self.user = make_user()

    def test_raising_provider_is_isolated(self):
        """A provider that raises should be reported in unavailable, not fatal."""
        # Save original registry
        original_registry = providers._REGISTRY.copy()

        try:
            # Register a provider that always raises
            def failing_provider(user):
                raise ValueError("Test error")

            providers.register('failing_test', 'events', failing_provider)

            # Collect should not raise, but report it unavailable
            result = providers.collect(self.user)

            self.assertIn('failing_test', result['unavailable'])
        finally:
            # Restore original registry
            providers._REGISTRY = original_registry

    def test_provider_behind_off_flag_is_skipped(self):
        """A provider whose flag is off should be skipped silently."""
        # Save original registry
        original_registry = providers._REGISTRY.copy()

        try:
            # Create a feature flag that's off
            FeatureFlag.objects.get_or_create(
                key='test_off_flag',
                defaults={'is_enabled': False}
            )

            called = []

            def test_provider(user):
                called.append(True)
                return []

            providers.register('test_off', 'test_off_flag', test_provider)

            # Collect with the flag off
            result = providers.collect(self.user)

            # Provider should not have been called
            self.assertEqual(len(called), 0)
            # And it should not be in unavailable (it was skipped, not failed)
            self.assertNotIn('test_off', result['unavailable'])
        finally:
            # Restore original registry
            providers._REGISTRY = original_registry

    def test_response_structure(self):
        """Response should have the correct structure."""
        result = providers.collect(self.user)

        # Check structure
        self.assertIsInstance(result['sections'], list)
        self.assertIsInstance(result['unavailable'], list)
        self.assertIsInstance(result['generated_at'], str)

        # Check that all sections have the right keys
        for section in result['sections']:
            self.assertIn('key', section)
            self.assertIn('items', section)
            self.assertIsInstance(section['items'], list)

            # Check item structure
            for item in section['items']:
                self.assertIn('kind', item)
                self.assertIn('title', item)
                self.assertIn('url', item)
                self.assertIn('due_at', item)
                self.assertIn('status', item)
                self.assertIn('urgency', item)
                self.assertIn('node', item)
                # Verify urgency is 0-3
                self.assertIn(item['urgency'], [0, 1, 2, 3])
