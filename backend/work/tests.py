"""Tests for `work` — refusals first (MANAGEMENT-BRIEF.md §3, §4 rule 14)."""

from django.test import SimpleTestCase, TestCase
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


class EdmatProjectSeedTests(APITestCase):
    """`seed_edmat_project` (work/edmat_project.py) — that it founds the body with its owner, the
    goals, the association's phases, the tasks, needs, polls, the two research accounts and the
    thread; that a second run refreshes text and leaves state alone; that the surfaces answer as the
    rule modules say (a plan step and a need are everybody's, a task and a poll are the roster's);
    that the deadlines follow the two dates; and that nothing secret-shaped is written."""

    databases = set(all_log_shards()) | {'default'}

    #: A small history table and a small thread, so the assertions are exact and the test is fast.
    #: The real files are checked by `EdmatHistoryTests` and by the command test below.
    HISTORY = [
        {'ref': '17A', 'title': 'Feature: the Random Exercise picker', 'heading': '17A. Feature: the Random Exercise picker (✅ built)',
         'line': 379, 'date': '2026-07-25', 'date_source': 'repo-start', 'summary': 'A navbar dice button.', 'subproject': 'corpus', 'listed': True},
        {'ref': '17BO', 'title': '/dziennik: the school demo as a page with no server behind it', 'heading': '17BO. /dziennik (2026-09-25)',
         'line': 9000, 'date': '2026-09-25', 'date_source': 'heading', 'summary': 'A page with no server.', 'subproject': 'dziennik', 'listed': True},
        {'ref': '17BV', 'title': 'The colour pass', 'heading': '17BV — The colour pass (2026-10-07, `ux/colour-pass`)',
         'line': 13802, 'date': '2026-10-07', 'date_source': 'heading', 'summary': 'Colour that means something.', 'subproject': 'interface', 'listed': True},
    ]
    THREAD = {
        'date': '2026-10-06', 'page': 'about', 'section': 'money-and-openness',
        'author': 'google-gemini', 'replier': 'anthropic-claude',
        'items': [
            {'n': 0, 'title': 'Raport prawny', 'body': 'Wstęp raportu.', 'reply': 'Jak czytać ten wątek.'},
            {'n': 1, 'title': 'Termin z art. 22', 'body': 'Siedem dni jest instrukcyjne.', 'reply': None},
            {'n': 2, 'title': 'KRS-WF', 'body': 'Nie dołączać, gdy wybrano Zarząd.', 'reply': 'Przyjęte.'},
        ],
    }

    def setUp(self):
        for key in ('organizations', 'tasks', 'needs', 'plans', 'decisions', 'work_dashboard', 'events', 'about_discussions'):
            FeatureFlag.objects.update_or_create(key=key, defaults={'enabled': True})
        self.owner = make_user('piotr')

    def _build(self, **overrides):
        from work.edmat_project import build_edmat_project

        kwargs = {'history': self.HISTORY, 'thread': self.THREAD, **overrides}
        return build_edmat_project('piotr', **kwargs)

    @staticmethod
    def _plan(built, title_start):
        """Find a seeded plan by the start of its title.

        `title_start` may be a GLUED "PL / EN" title straight out of `SUBPROJECTS`, which is no
        longer what the row's own column holds: since 2026-10-08 the seed splits its two languages
        into `translations.TextVersion` rows and mirrors the POLISH half onto `Plan.title`
        (`HISTORY.md` §17BX.C). So the Polish half is what we match on.
        """
        from work.edmat_project import _split_title

        wanted = _split_title(title_start)[0]
        return next(plan for plan in built['plans'] if plan.title.startswith(wanted))

    @staticmethod
    def _phase_one_rows():
        from work.edmat_project import PHASE_1_STEPS

        return sum(1 + len(step.get('substeps', ())) for step in PHASE_1_STEPS)

    def test_it_founds_the_organisation_with_its_owner_and_everything_hung_off_it(self):
        from community.models import Comment, DiscussionLocation
        from organizations.models import OrganizationMember
        from work.edmat_project import ASSOCIATION_PLANS, NEEDS, ORGANIZATION_SLUG, POLLS, SUBPROJECTS, TASKS

        built = self._build()
        self.assertTrue(built['organization_created'])
        self.assertEqual(built['organization'].slug, ORGANIZATION_SLUG)
        self.assertEqual(built['organization'].created_by, self.owner)
        self.assertTrue(built['organization'].open_board)
        self.assertEqual(
            OrganizationMember.objects.get(organization=built['organization'], user=self.owner).role, 'owner'
        )
        # one plan per goal, three for the association; the goals are public, phase 2 is a draft
        self.assertEqual(built['plans'].count(), len(SUBPROJECTS) + len(ASSOCIATION_PLANS))
        for goal in SUBPROJECTS:
            self.assertEqual(self._plan(built, goal['title']).status, 'active')
        self.assertEqual(self._plan(built, 'Stowarzyszenie — faza 1').status, 'active')
        self.assertEqual(self._plan(built, 'Stowarzyszenie — faza 2').status, 'draft')
        # history steps: done, dated, titled by reference, filed under their goal
        corpus = self._plan(built, 'Zadania i korpus')
        step = corpus.steps.get()
        self.assertTrue(step.title.startswith('§17A — Feature: the Random Exercise picker'))
        self.assertEqual(step.status, 'done')
        self.assertEqual(timezone.localtime(step.done_at).date().isoformat(), '2026-07-25')
        self.assertIn('`HISTORY.md` §17A', step.description)
        dziennik = self._plan(built, '/dziennik')
        dziennik_goal = next(goal for goal in SUBPROJECTS if goal['key'] == 'dziennik')
        self.assertEqual(dziennik.steps.filter(status='done').count(), 1)
        self.assertEqual(dziennik.steps.filter(status='pending').count(), len(dziennik_goal['steps']))
        self.assertEqual(built['history_unfiled'], [])
        # phase 1 is mirrored into tasks, all seated on the owner, plus the standalone tasks
        self.assertEqual(built['tasks'].count(), len(TASKS) + self._phase_one_rows())
        for task in built['tasks']:
            self.assertTrue(task.assignees.filter(user=self.owner).exists(), task.title)
        self.assertEqual(built['tasks'].filter(status='in_progress').count(), 1)  # "this table in the tasks module"
        self.assertEqual(built['tasks'].filter(parent__isnull=False).count(), 2)  # the two substeps of 1.1
        # needs and polls
        self.assertEqual(built['needs'].count(), len(NEEDS))
        self.assertEqual(set(built['needs'].values_list('status', flat=True)), {'open'})
        self.assertEqual(built['polls'].count(), len(POLLS))
        for poll in built['polls']:
            self.assertEqual(poll.status, 'open')
            self.assertIsNotNone(poll.opens_at)
            self.assertEqual(poll.options.count(), 3)
        # the two research accounts: no usable password, a profile that says what they are
        User = get_user_model()
        for username in ('google-gemini', 'anthropic-claude'):
            user = User.objects.get(username=username)
            self.assertFalse(user.has_usable_password())
            self.assertTrue(user.profile.display_name)
            self.assertIn('---', user.profile.bio)
        self.assertEqual(built['accounts_created'], 2)
        # the thread: one top-level comment per item, a reply where the file has one, dated
        location = DiscussionLocation.objects.get(page='about', section='money-and-openness')
        at_location = Comment.objects.filter(object_id=location.pk, content_type__model='discussionlocation')
        tops = at_location.filter(parent__isnull=True).order_by('created_at')
        self.assertEqual([c.author.username for c in tops], ['google-gemini'] * 3)
        self.assertTrue(tops[0].body.startswith('**Raport prawny**'))
        self.assertTrue(tops[2].body.startswith('**2. KRS-WF**'))
        replies = at_location.filter(parent__isnull=False)
        self.assertEqual(replies.count(), 2)
        self.assertEqual(set(r.author.username for r in replies), {'anthropic-claude'})
        self.assertEqual({timezone.localtime(c.created_at).date().isoformat() for c in at_location}, {'2026-10-06'})
        self.assertIsNone(tops[0].auto_hidden_at)
        self.assertEqual(built['thread'], {'page': 'about', 'section': 'money-and-openness', 'comments': 3, 'replies': 2, 'created': 5})
        # the founding meeting waits for its date
        self.assertIsNone(built['event'])
        self.assertEqual(len(built['waiting']), 2)

    def test_a_second_run_refreshes_text_and_leaves_state_alone(self):
        """Still true, and deliberately NOT contradicted by
        `translations.tests.KeepEditedTests` — the two draw a line that matters.

        The edits below are made with `.update()` straight onto the model's own column, which is
        what an admin poking the database does. Those are refreshed, because the seed is the owner
        of that text. An edit made through the BILINGUAL EDITOR is a different thing: it writes a
        `translations.TextVersion` carrying `written_by`, and `write_versions(keep_edited=True)` —
        which the seed passes — leaves those alone for ever (owner, 2026-10-08, `HISTORY.md` §17BX).

        So: the seed owns text nobody has claimed, and a person's edit through the UI wins. A raw
        column edit is not a claim, and it never was.
        """
        from community.models import Comment
        from decisions.models import Poll, PollOption
        from events.models import Event
        from needs.models import Need
        from plans.models import Plan, PlanStep
        from tasks.models import Task, TaskAssignee

        first = self._build()
        before = {m: m.objects.count() for m in (Plan, PlanStep, Task, TaskAssignee, Need, Poll, PollOption, Comment, Event)}
        corpus = self._plan(first, 'Zadania i korpus')
        history_step = corpus.steps.get()
        PlanStep.objects.filter(pk=history_step.pk).update(description='edited on the site')
        dziennik = self._plan(first, '/dziennik')
        open_step = dziennik.steps.filter(status='pending').first()
        PlanStep.objects.filter(pk=open_step.pk).update(status='in_progress', done_by=self.owner)
        task = first['tasks'].first()
        Task.objects.filter(pk=task.pk).update(status='review', description='edited on the site')
        Plan.objects.filter(pk=corpus.pk).update(description='edited on the site')
        need = first['needs'].first()
        Need.objects.filter(pk=need.pk).update(status='in_progress')
        comment = Comment.objects.filter(author__username='google-gemini').order_by('created_at').first()
        # after the bold first line, which is the row's key: an edit of the key itself would be a new
        # comment to the seed, and only the seed can write under these accounts anyway
        Comment.objects.filter(pk=comment.pk).update(body=comment.body + '\n\nedited on the site')

        moved = [dict(e, date='2026-07-26') if e['ref'] == '17A' else e for e in self.HISTORY]
        second = self._build(history=moved)
        self.assertFalse(second['organization_created'])
        for key in ('plans_created', 'steps_created', 'tasks_created', 'needs_created', 'polls_created', 'accounts_created'):
            self.assertEqual(second[key], 0, key)
        self.assertEqual(second['thread']['created'], 0)
        self.assertEqual({m: m.objects.count() for m in before}, before)
        # state kept
        open_step.refresh_from_db()
        self.assertEqual(open_step.status, 'in_progress')
        self.assertEqual(open_step.done_by, self.owner)
        task.refresh_from_db()
        self.assertEqual(task.status, 'review')
        need.refresh_from_db()
        self.assertEqual(need.status, 'in_progress')
        # text refreshed
        self.assertNotEqual(task.description, 'edited on the site')
        corpus.refresh_from_db()
        self.assertNotEqual(corpus.description, 'edited on the site')
        history_step.refresh_from_db()
        self.assertNotEqual(history_step.description, 'edited on the site')
        comment.refresh_from_db()
        self.assertTrue(comment.body.startswith('**Raport prawny**'))
        self.assertNotIn('edited on the site', comment.body)
        # a history step's date is a fact of the log, so it follows the log
        self.assertEqual(timezone.localtime(history_step.done_at).date().isoformat(), '2026-07-26')

    def test_what_the_public_reads_and_what_the_roster_keeps(self):
        built = self._build()
        organization = built['organization']
        phase_one = self._plan(built, 'Stowarzyszenie — faza 1')
        phase_two = self._plan(built, 'Stowarzyszenie — faza 2')
        node = f'/api/nodes/organization/{organization.pk}'

        # anonymous: active plans and open needs, no poll, no task
        listed = self.client.get(f'{node}/plans/')
        self.assertEqual(listed.status_code, 200)
        titles = [row['title'] for row in listed.json()]
        self.assertIn(phase_one.title, titles)
        self.assertNotIn(phase_two.title, titles)
        self.assertEqual(self.client.get(f'/api/plans/{phase_one.pk}/').status_code, 200)
        self.assertEqual(self.client.get(f'/api/plans/{phase_two.pk}/').status_code, 404)
        # the board is open (2026-10-08): the polls and the tasks are readable, not usable
        open_polls = self.client.get(f'{node}/polls/').json()
        self.assertEqual(len(open_polls), 2)
        self.assertFalse(any(row['can_vote'] for row in open_polls))
        self.assertTrue(all(row['can_see_results'] for row in open_polls))
        self.assertEqual(self.client.get(f'{node}/tasks/').status_code, 200)
        self.assertEqual(self.client.get(f'/api/tasks/{built["tasks"].first().pk}/').status_code, 200)
        board = self.client.get('/api/needs/')
        self.assertEqual(board.status_code, 200)
        self.assertEqual({row['id'] for row in board.json()} & set(built['needs'].values_list('id', flat=True)),
                         set(built['needs'].values_list('id', flat=True)))
        thread = self.client.get('/api/discussions/thread/', {'page': 'about', 'section': 'money-and-openness'})
        self.assertEqual(thread.status_code, 200)
        self.assertEqual(len(thread.json()['comments']), 5)

        # a signed-in stranger: the same reading, and still no vote and no edit
        stranger = make_user('stranger')
        self.client.force_authenticate(stranger)
        self.assertEqual(self.client.get(f'/api/plans/{phase_two.pk}/').status_code, 404)
        task_row = self.client.get(f'/api/tasks/{built["tasks"].first().pk}/')
        self.assertEqual(task_row.status_code, 200)
        self.assertFalse(task_row.json()['can_edit'])
        stranger_polls = self.client.get(f'{node}/polls/').json()
        self.assertEqual(len(stranger_polls), 2)
        self.assertFalse(any(row['can_vote'] for row in stranger_polls))
        self.assertEqual(
            self.client.post(f'/api/polls/{stranger_polls[0]["id"]}/vote/', {'options': [stranger_polls[0]['options'][0]['id']]}, format='json').status_code,
            409,
        )

        # the owner: the draft, the tasks with their buttons, the polls — and one vote, once
        self.client.force_authenticate(self.owner)
        self.assertEqual(self.client.get(f'/api/plans/{phase_two.pk}/').status_code, 200)
        self.assertTrue(self.client.get(f'/api/tasks/{built["tasks"].first().pk}/').json()['can_edit'])
        polls = self.client.get(f'{node}/polls/').json()
        self.assertEqual(len(polls), 2)
        self.assertTrue(all(row['can_vote'] for row in polls))
        option = polls[0]['options'][0]['id']
        self.assertEqual(self.client.post(f'/api/polls/{polls[0]["id"]}/vote/', {'options': [option]}, format='json').status_code, 201)
        self.assertEqual(self.client.post(f'/api/polls/{polls[0]["id"]}/vote/', {'options': [option]}, format='json').status_code, 409)

    def test_the_deadlines_follow_the_two_dates_and_the_meeting_appears_with_its_date(self):
        from datetime import date, datetime
        from unittest import mock

        from events.models import Event
        from organizations.models import OrganizationLink
        from work import edmat_project

        built = self._build()
        crbr = built['tasks'].get(title__startswith='Zgłoszenie do CRBR')
        statement = built['tasks'].get(title__startswith='Pierwszy rok obrotowy')
        self.assertIsNone(crbr.due_at)
        self.assertEqual(timezone.localtime(statement.due_at).date(), date(2027, 3, 31))
        self.assertIsNone(built['event'])

        meeting = timezone.make_aware(datetime(2026, 11, 15, 18, 0))
        with mock.patch.object(edmat_project, 'FOUNDING_MEETING_AT', meeting), \
             mock.patch.object(edmat_project, 'KRS_ENTRY_DATE', date(2027, 1, 20)):
            again = self._build()
            crbr.refresh_from_db()
            self.assertEqual(timezone.localtime(crbr.due_at).date(), date(2027, 2, 3))
            filing = again['tasks'].get(title__startswith='Wniosek do KRS')
            self.assertEqual(filing.due_at, meeting + timedelta(days=7))
            step = self._plan(again, 'Stowarzyszenie — faza 1').steps.get(title__startswith='Zgłoszenie do CRBR')
            self.assertEqual(timezone.localtime(step.due_at).date(), date(2027, 2, 3))
            event = again['event']
            self.assertIsNotNone(event)
            self.assertTrue(again['event_created'])
            self.assertEqual((event.status, event.visibility, event.host, event.starts_at), ('draft', 'public', self.owner, meeting))
            self.assertTrue(OrganizationLink.objects.filter(organization=again['organization'], object_id=event.pk, kind='runs').exists())
            self.assertEqual(again['waiting'], [])
            third = self._build()
            self.assertFalse(third['event_created'])
            self.assertEqual(Event.objects.filter(title=event.title).count(), 1)

    def test_the_owners_work_dashboard_shows_the_compliance_tasks(self):
        built = self._build()
        self.client.force_authenticate(self.owner)
        response = self.client.get('/api/work/')
        self.assertEqual(response.status_code, 200)
        tasks = next(section for section in response.json()['sections'] if section['key'] == 'task')
        titles = {item['title'] for item in tasks['items']}
        self.assertTrue(all(task.title in titles for task in built['tasks']))

    def test_the_command_prints_the_paths_and_refuses_an_unknown_owner(self):
        from io import StringIO

        from django.core.management import CommandError, call_command

        out = StringIO()
        call_command('seed_edmat_project', '--owner', 'piotr', stdout=out)
        printed = out.getvalue()
        for needle in ('Founded', '/organizations/edmat', '/plans/', '/tasks/', '/needs/', '/polls/',
                       'account google-gemini', 'account anthropic-claude', 'thread /about#money-and-openness', 'waiting:'):
            self.assertIn(needle, printed)
        self.assertNotIn('unknown goal', printed)
        with self.assertRaises(CommandError):
            call_command('seed_edmat_project', '--owner', 'nobody', stdout=StringIO())

    def test_nothing_secret_shaped_is_written_and_every_title_fits(self):
        import json

        from work.edmat_history import TABLE_PATH
        from work.edmat_project import DATA_FILE_SHAPES, RESEARCH_THREAD_PATH, SECRET_SHAPES, all_seeded_text

        for text in all_seeded_text():
            for shape in SECRET_SHAPES:
                self.assertIsNone(shape.search(text), f'{shape.pattern!r} in {text[:80]!r}')
        # the two data files: an address, a phone number, an id or a credential with a value must
        # not be in them either (a statutory sum of money may be — it is law, not a secret)
        for path in (TABLE_PATH, RESEARCH_THREAD_PATH):
            text = path.read_text(encoding='utf-8')
            for shape in DATA_FILE_SHAPES:
                self.assertIsNone(shape.search(text), f'{shape.pattern!r} in {path.name}')
        for entry in json.loads(TABLE_PATH.read_text(encoding='utf-8')):
            self.assertLessEqual(len(f"§{entry['ref']} — {entry['title']}"), 200, entry['title'])


class EdmatHistoryTests(SimpleTestCase):
    """`work/edmat_history.py` — the parse of HISTORY.md, the goal each section is filed under, and
    that the checked-in table is current whenever the log is present."""

    SAMPLE = (
        '# HISTORY\n\n'
        '## Two staleness warnings, because this file is a record\n\nSkip me.\n\n'
        '## 17A. Feature: the Random Exercise picker (✅ built, post-Phase-1)\n\n'
        'A navbar dice button (`🎲`, `lib/x.svelte`), mounted in\n'
        '**Header**. Two behaviours.\n\n- a list that is not the paragraph\n\n'
        '## 17BV — The colour pass: colour that means something (2026-10-07, `ux/colour-pass`)\n\n'
        '### Not a section\n\nThe owner\'s ask.\n\n'
        '## Something nobody filed (2026-10-08)\n\nText.\n'
    )

    def test_parse_skips_the_meta_headings_and_reads_ref_date_summary_and_goal(self):
        from work.edmat_history import parse_history

        entries = parse_history(self.SAMPLE)
        self.assertEqual([e['ref'] for e in entries], ['17A', '17BV', None])
        first, colour, unfiled = entries
        self.assertEqual(first['title'], 'Feature: the Random Exercise picker')
        self.assertEqual(first['line'], 7)
        self.assertIsNone(first['date'])
        self.assertEqual(first['summary'], 'A navbar dice button (🎲, lib/x.svelte), mounted in Header. Two behaviours.')
        self.assertEqual((first['subproject'], first['listed']), ('corpus', True))
        self.assertEqual(colour['title'], 'The colour pass: colour that means something')
        self.assertEqual((colour['date'], colour['date_source']), ('2026-10-07', 'heading'))
        self.assertEqual(colour['summary'], '')  # the next line is a sub-heading, not a paragraph
        self.assertEqual((unfiled['subproject'], unfiled['listed']), ('platform', False))

    def test_the_second_use_of_a_reference_is_told_apart_by_its_heading(self):
        from work.edmat_history import classify

        self.assertEqual(classify({'ref': '17BE', 'heading': '17BE. Exercises linked to the materials they come from'}), ('materials', True))
        self.assertEqual(classify({'ref': '17BE', 'heading': '17BE. Three asks in one afternoon: the whiteboard'}), ('interface', True))
        self.assertEqual(classify({'ref': None, 'heading': '§17BQ — the owner\'s 2026-10-01 list'}), ('interface', True))

    def test_the_checked_in_table_is_current_and_whole(self):
        from unittest import skipUnless

        from work.edmat_history import HISTORY_PATH, SUBPROJECT_BY_REF, load_table, parse_history
        from work.edmat_project import SUBPROJECTS

        table = load_table()
        self.assertGreaterEqual(len(table), 116)
        goals = {goal['key'] for goal in SUBPROJECTS}
        self.assertEqual(set(SUBPROJECT_BY_REF.values()) - goals, set())
        for entry in table:
            self.assertTrue(entry['date'], entry['heading'])
            self.assertTrue(entry['listed'], entry['heading'])
            self.assertIn(entry['subproject'], goals)
        if not HISTORY_PATH.exists():
            return  # on a server there is no log; the table is what ships
        parsed = parse_history(HISTORY_PATH.read_text(encoding='utf-8'))
        key = lambda e: (e['ref'], e['heading'], e['line'], e['summary'], e['subproject'])  # noqa: E731
        self.assertEqual([key(e) for e in parsed], [key(e) for e in table],
                         'HISTORY.md moved on: run `manage.py export_edmat_history`')

    def test_the_thread_file_is_whole(self):
        from community import discussions
        from work.edmat_project import load_thread

        thread = load_thread()
        self.assertIsNotNone(thread)
        self.assertEqual([item['n'] for item in thread['items']], list(range(33)))
        self.assertTrue(all(item['body'] and item['title'] for item in thread['items']))
        self.assertTrue(discussions.PAGE_RE.match(thread['page']))
        self.assertTrue(discussions.SECTION_RE.match(thread['section']))
        self.assertEqual((thread['author'], thread['replier']), ('google-gemini', 'anthropic-claude'))
