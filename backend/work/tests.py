"""Tests for `work` — refusals first (MANAGEMENT-BRIEF.md §3, §4 rule 14)."""

from django.test import TestCase
from django.contrib.auth import get_user_model
from django.utils import timezone
from datetime import timedelta
from rest_framework.test import APITestCase
from rest_framework.authtoken.models import Token
from moderation.models import FeatureFlag
from testing.factories import make_user, make_branch
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
        user = make_user('test_user')
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
        self.user = make_user('registry_test_user')

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


class EventProviderTests(TestCase):
    """Tests for the events providers."""

    def setUp(self):
        """Create test data."""
        from events.models import Event
        self.user = make_user('event_test_user')
        self.event_in_10_days = Event.objects.create(
            host=self.user,
            title='Event in 10 days',
            status='published',
            visibility='public',
            starts_at=timezone.now() + timedelta(days=10),
            duration_minutes=60,
        )
        self.event_in_30_days = Event.objects.create(
            host=self.user,
            title='Event in 30 days',
            status='published',
            visibility='public',
            starts_at=timezone.now() + timedelta(days=30),
            duration_minutes=60,
        )

    def test_event_hosting_within_14_days_appears(self):
        """An event the user hosts within 14 days should appear."""
        result = providers.collect(self.user)

        # Find the event in any section
        found = False
        for section in result['sections']:
            for item in section['items']:
                if item['title'] == 'Event in 10 days':
                    found = True
                    self.assertEqual(item['kind'], 'event')
                    self.assertEqual(item['status'], 'hosting')
                    self.assertIn('/events/', item['url'])

        self.assertTrue(found, "Event in 10 days not found in dashboard")

    def test_event_hosting_beyond_14_days_excluded(self):
        """An event the user hosts beyond 14 days should not appear."""
        result = providers.collect(self.user)

        # Verify the 30-day event is not in any section
        for section in result['sections']:
            for item in section['items']:
                self.assertNotEqual(item['title'], 'Event in 30 days')


class CourseProviderTests(TestCase):
    """Tests for the courses provider."""

    def setUp(self):
        """Create test data."""
        from courses.models import Course, CourseStaffRole
        self.user = make_user('course_test_user')
        self.course = Course.objects.create(
            title='Test Course',
            created_by=self.user,
            visibility='listed',
        )
        # Make user staff on the course
        CourseStaffRole.objects.create(
            course=self.course,
            staff=self.user,
        )

    def test_course_with_pending_enrollment_appears(self):
        """A course with pending enrollments should appear."""
        from courses.models import Enrollment
        # Create a pending enrollment
        other_user = make_user('other_user')
        Enrollment.objects.create(
            course=self.course,
            participant=other_user,
            status='pending',
        )

        result = providers.collect(self.user)

        # Find the course in any section
        found = False
        for section in result['sections']:
            for item in section['items']:
                if 'Test Course' in item['title']:
                    found = True
                    self.assertEqual(item['kind'], 'course_request')

        self.assertTrue(found, "Course with pending enrollment not found")


class CoauthoringProviderTests(TestCase):
    """Tests for the coauthoring provider."""

    def setUp(self):
        """Create test data."""
        from coauthoring.models import MaterialProject, ProjectMember
        self.user = make_user('coauth_test_user')
        self.project = MaterialProject.objects.create(
            title='Test Material Project',
            created_by=self.user,
        )
        # Make user a member
        ProjectMember.objects.create(
            project=self.project,
            user=self.user,
            role='editor',
        )

    def test_project_with_pending_version_appears(self):
        """A project with a pending version should appear."""
        from coauthoring.models import MaterialVersion
        # Create a pending version
        MaterialVersion.objects.create(
            project=self.project,
            title='Pending Version',
            status='proposed',
            created_by=self.user,
        )

        result = providers.collect(self.user)

        # Find the project in any section
        found = False
        for section in result['sections']:
            for item in section['items']:
                if 'Test Material Project' in item['title']:
                    found = True
                    self.assertEqual(item['kind'], 'proposal')

        self.assertTrue(found, "Project with pending version not found")


class ShiftProviderTests(TestCase):
    """Tests for the shifts provider."""

    def setUp(self):
        """Create test data."""
        from shifts.models import Shift, Assignment
        from venues.models import Venue, Station
        from events.models import Event

        self.user = make_user('shift_test_user')
        self.venue = Venue.objects.create(
            name='Test Venue',
            slug='test-venue',
        )
        self.station = Station.objects.create(
            venue=self.venue,
            name='Test Station',
        )
        self.event = Event.objects.create(
            host=self.user,
            title='Shift Test Event',
            status='published',
            visibility='public',
            starts_at=timezone.now() + timedelta(days=5),
            duration_minutes=60,
        )
        self.shift = Shift.objects.create(
            station=self.station,
            event=self.event,
            title='Test Shift',
            starts_at=timezone.now() + timedelta(days=5),
            duration_minutes=60,
        )
        # Assign user to shift
        Assignment.objects.create(
            shift=self.shift,
            volunteer=self.user,
            status='confirmed',
        )

    def test_shift_within_14_days_appears(self):
        """A shift the user is assigned to within 14 days should appear."""
        result = providers.collect(self.user)

        # Find the shift in any section
        found = False
        for section in result['sections']:
            for item in section['items']:
                if 'Test Shift' in item['title']:
                    found = True
                    self.assertEqual(item['kind'], 'shift')

        self.assertTrue(found, "Shift not found in dashboard")


class TutoringProviderTests(TestCase):
    """Tests for the tutoring provider."""

    def setUp(self):
        """Create test data."""
        from booking.models import Booking
        from services.models import Service

        self.user = make_user('tutoring_test_user')
        self.student = make_user('student_user')
        self.service = Service.objects.create(
            provider=self.user,
            title='Test Tutoring',
            kind='tutoring',
            is_verified=False,
        )
        Booking.objects.create(
            service=self.service,
            student=self.student,
            starts_at=timezone.now() + timedelta(days=5),
            status='confirmed',
        )

    def test_tutoring_booking_within_14_days_appears(self):
        """A tutoring booking within 14 days should appear."""
        result = providers.collect(self.user)

        # Find the booking in any section
        found = False
        for section in result['sections']:
            for item in section['items']:
                if 'Test Tutoring' in item['title']:
                    found = True
                    self.assertEqual(item['kind'], 'booking')

        self.assertTrue(found, "Tutoring booking not found in dashboard")
