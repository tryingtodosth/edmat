"""`testing/conference_demo.py` — the lived-in demo conference (CONFERENCE-BRIEF.md, the
"sample data" follow-up).

What is asserted is not the content but the two things a seed can silently get wrong: that a
second run leaves one of everything, and that the rows it writes directly agree with the rule
modules that will read them — a rota the rota would have refused, a briefing ledger that does not
block the one person it is meant to block, a desk the desk rules would not let its clerk operate.
"""

from datetime import datetime, timedelta, timezone as dt_timezone
from unittest.mock import patch

from django.test import TestCase

from cloakroom.rules import can_operate
from documents.access import briefing_block_reason
from events.models import EventAttendance, ScanEvent, Session
from events.scanning import inside_count
from shifts.models import Assignment, Shift, Station
from shifts.rules import claim_block_reason, coverage
from testing.conference_demo import DEMO_TITLE, make_conference_demo
from venues.models import RoomBooking

#: Day one of the frozen conference, and the frozen instant: 15:00 on day one (`TIME_ZONE` is UTC),
#: by which the door, the lunch-time returns and the lost-slip returns have all happened and the
#: afternoon shifts have not. The builder reads the clock through `timezone.now()`, as does every
#: rule module it is checked against, so one patch freezes them all together.
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
