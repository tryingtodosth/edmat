"""`testing/conference_demo.py` — the lived-in demo conference (CONFERENCE-BRIEF.md, the
"sample data" follow-up).

What is asserted is not the content but the two things a seed can silently get wrong: that a
second run leaves one of everything, and that the rows it writes directly agree with the rule
modules that will read them — a rota the rota would have refused, a briefing ledger that does not
block the one person it is meant to block, a desk the desk rules would not let its clerk operate.
"""

from datetime import datetime, timedelta, timezone as dt_timezone
from unittest.mock import patch

from django.contrib.auth import get_user_model
from django.db.models import Q
from django.test import TestCase

from cloakroom.rules import can_operate
from documents.access import briefing_block_reason
from events.models import Event, EventAttendance, EventStaff, ScanEvent, Session
from events.scanning import inside_count
from shifts.models import Assignment, Shift, Station
from shifts.rules import claim_block_reason, coverage
from testing.conference_demo import (
    CONTAINMENT_MODELS,
    DEMO_TITLE,
    assert_contained,
    make_conference_demo,
    seeded_accounts,
)
from testing.personas import FAKE_PREFIX, SANDBOX_TITLE
from venues.models import RoomBooking, VenueStaff

#: Day one of the frozen conference, and the frozen instant: 15:00 on day one (`TIME_ZONE` is UTC),
#: by which the door, the lunch-time returns and the lost-slip returns have all happened and the
#: afternoon shifts have not. The builder reads the clock through `timezone.now()`, as does every
#: rule module it is checked against, so one patch freezes them all together.
User = get_user_model()

DAY_ONE = datetime(2026, 10, 14, tzinfo=dt_timezone.utc).date()
FROZEN_NOW = datetime(2026, 10, 14, 15, 0, tzinfo=dt_timezone.utc)


class ConferenceDemoTests(TestCase):
    @classmethod
    def setUpClass(cls):
        cls._clock = patch('django.utils.timezone.now', return_value=FROZEN_NOW)
        cls._clock.start()
        super().setUpClass()

    @classmethod
    def tearDownClass(cls):
        super().tearDownClass()
        cls._clock.stop()

    @classmethod
    def setUpTestData(cls):
        cls.day_one = DAY_ONE
        cls.built = make_conference_demo(day_one=cls.day_one)
        cls.event = cls.built['event']

    def test_shape(self):
        report = self.built['report']
        self.assertEqual(self.event.title, DEMO_TITLE)
        self.assertFalse(self.event.is_past)
        self.assertEqual(self.event.seat_holder_count(), self.event.capacity, 'full, with a waiting list')
        self.assertEqual(report['waitlisted'], 6)
        self.assertEqual(report['sessions'], Session.objects.filter(event=self.event).count())
        self.assertEqual(report['checked_in'], 100)
        self.assertEqual(inside_count(self.event), 99, 'three out for lunch, two back in')
        self.assertEqual(
            set(ScanEvent.objects.filter(event=self.event).values_list('result', flat=True)),
            {'admitted', 'already_in', 'collision', 'unknown', 'exited'},
        )
        self.assertEqual(report['coats_returned'], 9)
        self.assertEqual(report['coats_exception'], 2)
        self.assertEqual(report['checklist_items'], 6)
        self.assertEqual(RoomBooking.objects.filter(event=self.event, status='approved').count(), 8)

    def test_second_run_leaves_one_of_everything(self):
        before = {
            'attendances': EventAttendance.objects.filter(event=self.event).count(),
            'sessions': Session.objects.filter(event=self.event).count(),
            'stations': Station.objects.filter(event=self.event).count(),
            'shifts': Shift.objects.filter(station__event=self.event).count(),
            'assignments': Assignment.objects.filter(shift__station__event=self.event).count(),
            'scans': ScanEvent.objects.filter(event=self.event).count(),
            'documents': self.event.documents.count(),
            'bookings': RoomBooking.objects.filter(event=self.event).count(),
            'coats': sum(d.items.count() for d in self.event.cloakroom_desks.all()),
        }
        again = make_conference_demo(day_one=self.day_one)
        self.assertEqual(again['event'].pk, self.event.pk)
        after = {
            'attendances': EventAttendance.objects.filter(event=self.event).count(),
            'sessions': Session.objects.filter(event=self.event).count(),
            'stations': Station.objects.filter(event=self.event).count(),
            'shifts': Shift.objects.filter(station__event=self.event).count(),
            'assignments': Assignment.objects.filter(shift__station__event=self.event).count(),
            'scans': ScanEvent.objects.filter(event=self.event).count(),
            'documents': self.event.documents.count(),
            'bookings': RoomBooking.objects.filter(event=self.event).count(),
            'coats': sum(d.items.count() for d in self.event.cloakroom_desks.all()),
        }
        self.assertEqual(before, after)

    def test_rota_agrees_with_the_rules(self):
        """Every live assignment is one the rota would have accepted: asked about their own shift,
        the holder is refused only for already holding it."""
        for row in Assignment.objects.filter(shift__station__event=self.event).exclude(
            status__in=('dropped', 'no_show')
        ).select_related('shift__station', 'user__profile'):
            with self.subTest(user=row.user.username, shift=str(row.shift.starts_at)):
                self.assertEqual(claim_block_reason(row.user, row.shift), 'already_assigned')
        grid = coverage(self.event)
        self.assertEqual(sum(1 for cell in grid if cell['is_short']), self.built['report']['shifts_short'])
        self.assertFalse(any(cell['needs_adult'] for cell in grid), 'no minor is ever alone')

    def test_the_second_minor_cannot_claim(self):
        info = Shift.objects.get(station__event=self.event, station__name='Punkt informacyjny',
                                 starts_at__date=self.day_one + timedelta(days=1), needed=1)
        self.assertEqual(claim_block_reason(self.built['child.02'], info), 'minor_no_consent')

    def test_briefing_ledger_blocks_exactly_the_unread(self):
        self.assertIsNone(briefing_block_reason(self.event, self.built['volunteer']))
        self.assertIsNotNone(briefing_block_reason(self.event, self.built['clerk']))
        stale = briefing_block_reason(self.event, self.built['volunteer.09'])
        self.assertIsNotNone(stale, 'read version 1, not version 2')
        self.assertEqual(stale['titles'], ['Instrukcja bezpieczeństwa dla wolontariuszy'])

    def test_desk_clerks_may_operate(self):
        self.assertTrue(can_operate(self.built['volunteer.07'], self.event))
        self.assertTrue(can_operate(self.built['volunteer.09'], self.event))
        self.assertFalse(can_operate(self.built['attendee'], self.event))

    def test_future_day_one_has_nothing_happened_yet(self):
        built = make_conference_demo(day_one=DAY_ONE + timedelta(days=30))
        report = built['report']
        self.assertEqual(report['scans'], 0)
        self.assertEqual(report['coats_stored'], 0)
        self.assertEqual(report['shifts_done'], 0)
        self.assertFalse(Assignment.objects.filter(shift__station__event=built['event'], status='no_show').exists())


class DemoIsMarkedAsFakeTests(TestCase):
    """The marker exists for a reader, so it is asserted where a reader would meet it: the title.

    The demo is seeded onto the production database, into the same `events.Event` table and the
    same public `/events` list as real conferences. Nothing else distinguishes them — deliberately,
    because the personas module rejected an `is_sandbox` column — so the title is load-bearing.
    """

    @classmethod
    def setUpTestData(cls):
        cls.built = make_conference_demo(day_one=DAY_ONE)

    def test_every_seeded_event_title_starts_with_the_marker(self):
        titles = list(Event.objects.values_list('title', flat=True))
        self.assertTrue(titles, 'the seeder made no events at all')
        for title in titles:
            self.assertTrue(
                title.startswith(FAKE_PREFIX),
                f'seeded event {title!r} does not start with {FAKE_PREFIX!r} — it reads as a real conference',
            )

    def test_both_seeders_agree_on_one_marker(self):
        # Two modules, one literal: `conference_demo` imports the prefix rather than repeating it.
        self.assertTrue(DEMO_TITLE.startswith(FAKE_PREFIX))
        self.assertTrue(SANDBOX_TITLE.startswith(FAKE_PREFIX))

    def test_the_marker_survives_a_polish_interface(self):
        # Not a translated string and not punctuation a locale rewrites: the same bytes everywhere.
        self.assertEqual(FAKE_PREFIX, 'TEST=FAKE ')
        self.assertTrue(FAKE_PREFIX.isascii())


class DemoAccountsAreContainedTests(TestCase):
    """No seeded account may reach anything outside its own conference.

    `assert_contained` runs inside the seeder, so these tests are about the check itself: that it
    passes on a clean build, and — the half that matters — that it actually fails when authority
    leaks. A containment check nobody has watched refuse is a check that might only be an
    expensive way of returning True.
    """

    @classmethod
    def setUpTestData(cls):
        cls.built = make_conference_demo(day_one=DAY_ONE)
        cls.event = cls.built['event']
        cls.venue = cls.built['venue']

    def test_a_clean_build_is_contained(self):
        summary = assert_contained(self.event, self.venue)
        self.assertEqual(summary['accounts_checked'], seeded_accounts().count())
        self.assertGreater(summary['accounts_checked'], 100, 'the attendees should be in scope too')

    def test_no_seeded_account_is_platform_staff(self):
        elevated = seeded_accounts().filter(Q(is_staff=True) | Q(is_superuser=True))
        self.assertFalse(list(elevated), 'a demo account carries the is_staff moderation bypass')

    def test_no_seeded_account_holds_a_group_or_a_direct_permission(self):
        for user in seeded_accounts():
            self.assertEqual(user.groups.count(), 0, f'{user.username} is in a group')
            self.assertEqual(user.user_permissions.count(), 0, f'{user.username} holds a permission')

    def test_event_and_venue_roles_point_only_at_marked_fake_events(self):
        # Two events are seeded, not one: this conference and the personas' Sandbox. Both carry the
        # marker, which is what makes them inside — the containment check trusts the title, so the
        # test states the rule in those terms rather than naming the pks.
        role_events = set(EventStaff.objects.filter(user__in=seeded_accounts()).values_list('event_id', flat=True))
        marked = set(Event.objects.filter(title__startswith=FAKE_PREFIX).values_list('pk', flat=True))
        self.assertIn(self.event.pk, role_events)
        self.assertTrue(role_events <= marked, f'roles on unmarked event(s): {sorted(role_events - marked)}')
        self.assertEqual(
            set(VenueStaff.objects.filter(user__in=seeded_accounts()).values_list('venue_id', flat=True)),
            {self.venue.pk},
        )

    def test_it_refuses_an_account_that_was_made_staff(self):
        organiser = self.built['organiser']
        organiser.is_staff = True
        organiser.save(update_fields=['is_staff'])
        with self.assertRaises(RuntimeError) as caught:
            assert_contained(self.event, self.venue)
        self.assertIn('is_staff', str(caught.exception))
        self.assertIn(organiser.username, str(caught.exception))

    def test_it_refuses_a_role_on_somebody_elses_event(self):
        outsider = Event.objects.create(
            host=User.objects.create_user('someone.real'),
            title='A real conference nobody demoed',
            starts_at=self.event.starts_at,
        )
        EventStaff.objects.update_or_create(
            event=outsider, user=self.built['volunteer'], defaults={'role': 'volunteer'}
        )
        with self.assertRaises(RuntimeError) as caught:
            assert_contained(self.event, self.venue)
        self.assertIn('EventStaff row', str(caught.exception))

    def test_every_authority_model_named_in_the_registry_is_importable(self):
        # The registry is hand-maintained; a renamed model would otherwise turn the whole check
        # into a silent no-op at exactly the moment it mattered.
        from importlib import import_module

        for label, path, scope_field in CONTAINMENT_MODELS:
            module_path, _, class_name = path.rpartition('.')
            model = getattr(import_module(module_path), class_name, None)
            self.assertIsNotNone(model, f'{label}: {path} no longer exists')
            self.assertTrue(hasattr(model, 'user'), f'{label} has no `user` field to filter on')
            if scope_field is not None:
                self.assertTrue(hasattr(model, scope_field), f'{label} has no `{scope_field}` field')
