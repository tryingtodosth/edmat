"""Tests for `work` — refusals first (MANAGEMENT-BRIEF.md §3, §4 rule 14)."""

from django.test import TestCase
from django.contrib.auth import get_user_model
from django.utils import timezone
from datetime import timedelta
from rest_framework.test import APITestCase
from rest_framework.authtoken.models import Token
from moderation.models import FeatureFlag
from telemetry.routers import all_log_shards
from testing.factories import make_user, make_branch
from . import providers

User = get_user_model()


class WorkDashboardAuthTests(APITestCase):
    """Refusal tests: the endpoint rejects unauthenticated requests.

    `databases` includes every log shard (backend/CLAUDE.md's `DATABASE_ROUTERS` note) because a
    live request goes through `telemetry.middleware`, which writes a request-log row on its own
    shard — the same declaration every other app's API test carries (`grep databases = */tests.py`).
    """

    databases = set(all_log_shards()) | {'default'}

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
        from courses.models import Course
        self.user = make_user('course_test_user')
        # `Course.instructor` is required, and `Course.save()` seats the instructor as an 'owner'
        # `CourseStaff` row itself — courses/models.py — so the explicit `CourseStaff.create()
        # below is redundant but harmless (it is what the course's OWN staff table is called;
        # there is no separate `CourseStaffRole` model).
        self.course = Course.objects.create(
            title='Test Course',
            instructor=self.user,
            visibility='listed',
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
        """Create test data. `MaterialProject` has no `title` of its own (coauthoring/models.py —
        it is drafting-only catalogue fields plus `branch`; the title lives on its versions), and
        `ProjectMember.role` is one of `owner`/`coauthor`, not `editor`."""
        from coauthoring.models import MaterialProject, ProjectMember
        self.user = make_user('coauth_test_user')
        self.branch = make_branch()
        self.project = MaterialProject.objects.create(
            branch=self.branch,
            created_by=self.user,
        )
        # `MaterialProject.save()` already seats `created_by` as the 'owner' member; this is
        # idempotent (`get_or_create`) so re-asserting it here is harmless and explicit.
        ProjectMember.objects.get_or_create(
            project=self.project,
            user=self.user,
            defaults={'role': 'owner'},
        )

    def test_project_with_pending_version_appears(self):
        """A project with a pending version should appear, titled after that version."""
        from coauthoring.models import MaterialVersion
        # Create a pending version. `number` is required (unique per project); `kind='body'` needs
        # no file/url payload for a bare `.create()` (validated in `clean()`/the serializer, not a
        # DB constraint — coauthoring/models.py).
        MaterialVersion.objects.create(
            project=self.project,
            number=1,
            kind='body',
            body='Some content.',
            title='Pending Version',
            status='proposed',
            created_by=self.user,
        )

        result = providers.collect(self.user)

        # Find the project in any section
        found = False
        for section in result['sections']:
            for item in section['items']:
                if 'Pending Version' in item['title']:
                    found = True
                    self.assertEqual(item['kind'], 'proposal')

        self.assertTrue(found, "Project with pending version not found")


class ShiftProviderTests(TestCase):
    """Tests for the shifts provider."""

    def setUp(self):
        """Create test data. `Station` lives in `shifts/models.py`, not `venues` — a station hangs
        off an `Event` directly, with no `Venue` in between (shifts/CLAUDE.md, shifts/models.py).
        `Shift` has `starts_at`/`ends_at`, not `title`/`duration_minutes`; `Assignment.user`, not
        `volunteer` (shifts/models.py)."""
        from shifts.models import Shift, Station, Assignment
        from events.models import Event

        self.user = make_user('shift_test_user')
        self.event = Event.objects.create(
            host=self.user,
            title='Shift Test Event',
            status='published',
            visibility='public',
            starts_at=timezone.now() + timedelta(days=5),
            duration_minutes=60,
        )
        self.station = Station.objects.create(
            event=self.event,
            name='Test Station',
        )
        starts_at = timezone.now() + timedelta(days=5)
        self.shift = Shift.objects.create(
            station=self.station,
            starts_at=starts_at,
            ends_at=starts_at + timedelta(hours=1),
        )
        # Assign user to shift
        Assignment.objects.create(
            shift=self.shift,
            user=self.user,
            status='confirmed',
        )

    def test_shift_within_14_days_appears(self):
        """A shift the user is assigned to within 14 days should appear."""
        result = providers.collect(self.user)

        # Find the shift in any section — titled '<event title> - <station name>'
        found = False
        for section in result['sections']:
            for item in section['items']:
                if 'Test Station' in item['title']:
                    found = True
                    self.assertEqual(item['kind'], 'shift')

        self.assertTrue(found, "Shift not found in dashboard")


class TutoringProviderTests(TestCase):
    """Tests for the tutoring provider."""

    def setUp(self):
        """Create test data. `Service` has no `kind`/`is_verified` field (services/models.py); a
        `Booking` needs `tutor` (denormalized from `service.provider`, not derived) and `ends_at`
        (both required, booking/models.py)."""
        from booking.models import Booking
        from services.models import Service

        self.user = make_user('tutoring_test_user')
        self.student = make_user('student_user')
        self.service = Service.objects.create(
            provider=self.user,
            title='Test Tutoring',
        )
        starts_at = timezone.now() + timedelta(days=5)
        Booking.objects.create(
            service=self.service,
            tutor=self.user,
            student=self.student,
            starts_at=starts_at,
            ends_at=starts_at + timedelta(hours=1),
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


class ManagementIntegrationTests(TestCase):
    """The wiring `work/integrations.py` does at integration (MANAGEMENT-BRIEF.md §5): each
    management section is a registered provider behind its own app's kill switch, and a fresh
    user gets every one of them back as an empty section rather than as an error."""

    databases = set(all_log_shards()) | {'default'}

    MANAGEMENT_SECTIONS = {
        'task': 'tasks',
        'need_application': 'needs',
        'need_decision': 'needs',
        'plan_step': 'plans',
        'plan_suggestion': 'plans',
        'poll': 'decisions',
    }

    def test_management_sections_are_registered_behind_their_own_flags(self):
        for key, flag in self.MANAGEMENT_SECTIONS.items():
            with self.subTest(section=key):
                self.assertIn(key, providers._REGISTRY)
                self.assertEqual(providers._REGISTRY[key][0], flag)

    def test_management_providers_run_clean_for_a_fresh_user(self):
        """All six RUN for somebody with nothing, and none of them raises.

        `unavailable` being empty is the whole assertion: `collect()` appends a section only
        `if items` (providers.py, and `test.md` records the same thing from the page's side), so a
        person with nothing waiting on them gets **no** management section rather than six empty
        ones. This test asserted the opposite and had been failing since the §5 wiring landed;
        corrected on `mgmt/h-matrix` rather than left red, because a suite with one known failure
        in it is a suite nobody reads.
        """
        user = make_user('fresh')
        result = providers.collect(user)
        self.assertEqual(result['unavailable'], [])
        keys = [section['key'] for section in result['sections']]
        for key in self.MANAGEMENT_SECTIONS:
            self.assertNotIn(key, keys)
