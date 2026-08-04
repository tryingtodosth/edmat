"""Booking a session with a tutor.

Most of these pin the two availability modes against each other, because that is the pair of rules
that fails silently. A broken booking form announces itself the first time anybody uses it; a
`derived` listing that quietly keeps offering an hour somebody already took does not — the student
finds out when the tutor declines them, which is exactly the experience the mode exists to prevent.
The other half is the lifecycle: who may confirm, decline, cancel and complete, and from where.

Times are built relative to a fixed, computed anchor rather than hard-coded — `_next_weekday` walks
forward to a real future date, so the suite does not start failing on a particular Tuesday.
"""

from datetime import date, datetime, time, timedelta

from django.contrib.auth.models import User
from django.test import TestCase
from django.utils import timezone
from rest_framework.test import APIClient

from notifications.models import Notification
from services.models import Service
from taxonomy.models import Course, Field
from telemetry.routers import all_log_shards

from .availability import slots_for_service
from .models import AvailabilityException, AvailabilityRule, Booking


class ApiTestCase(TestCase):
    """The request-logging middleware writes to its own shards; a view test that does not declare
    them fails on Django's cross-database guard rather than on anything under test."""

    databases = set(all_log_shards()) | {'default'}

    def setUp(self):
        self.tutor = User.objects.create_user('kasia', 'kasia@x.example', 'pw12345!')
        self.student = User.objects.create_user('michal', 'michal@x.example', 'pw12345!')
        self.other = User.objects.create_user('ola', 'ola@x.example', 'pw12345!')
        self.field = Field.objects.create(slug='matematyka')
        self.course = Course.objects.create(slug='analiza-2', field=self.field, university='UW')
        self.client = APIClient()

    def as_(self, user):
        client = APIClient()
        client.force_authenticate(user)
        return client

    def make_service(self, **kwargs):
        defaults = {
            'provider': self.tutor,
            'title': 'Analiza II — korepetycje',
            'availability_mode': 'derived',
            'session_minutes': 60,
        }
        return Service.objects.create(**{**defaults, **kwargs})

    def next_weekday(self, weekday: int, *, weeks_ahead: int = 1) -> date:
        """A real future date falling on `weekday`, comfortably ahead of now.

        A week out rather than tomorrow, so a test that adds an hour or two to a slot can never
        accidentally land in the past when the suite runs late in the day.
        """
        today = timezone.localdate()
        ahead = (weekday - today.weekday()) % 7
        return today + timedelta(days=ahead + 7 * weeks_ahead)

    def at(self, day: date, hour: int, minute: int = 0):
        return timezone.make_aware(
            datetime.combine(day, time(hour, minute)), timezone.get_default_timezone()
        )

    def rule(self, weekday, start_hour, end_hour, service=None):
        return AvailabilityRule.objects.create(
            tutor=self.tutor,
            service=service,
            weekday=weekday,
            start_time=time(start_hour),
            end_time=time(end_hour),
        )

    def host_event(self, day, hour, *, minutes=60, host=None, status='published'):
        """An event on the tutor's own calendar. Imported inside the method rather than at module
        scope so the booking suite does not gain a hard import of the events app just to define its
        fixtures."""
        from events.models import Event

        return Event.objects.create(
            host=host or self.tutor,
            title='Warsztat',
            status=status,
            starts_at=self.at(day, hour),
            duration_minutes=minutes,
            location_kind='onsite',
            location_text='sala 4070',
        )

    def book(self, service, day, hour, *, status='requested', student=None):
        starts = self.at(day, hour)
        return Booking.objects.create(
            service=service,
            tutor=service.provider,
            student=student or self.student,
            starts_at=starts,
            ends_at=starts + timedelta(minutes=service.session_minutes),
            status=status,
        )


class AvailabilityComputationTests(ApiTestCase):
    """The slot maths, straight against `slots_for_service` — no HTTP, because these are statements
    about arithmetic rather than about access."""

    def test_a_weekly_rule_becomes_back_to_back_sessions(self):
        service = self.make_service()
        tuesday = self.next_weekday(1)
        self.rule(1, 14, 17)

        days = slots_for_service(service, tuesday, tuesday)
        starts = [s.start for s in days[0].slots]
        self.assertEqual(starts, [self.at(tuesday, 14), self.at(tuesday, 15), self.at(tuesday, 16)])

    def test_a_window_that_cannot_fit_a_whole_session_offers_nothing(self):
        """50 minutes left over is not a 60-minute session, and offering it short would be a
        different product than the one the listing sells."""
        service = self.make_service(session_minutes=90)
        tuesday = self.next_weekday(1)
        self.rule(1, 14, 15)

        days = slots_for_service(service, tuesday, tuesday)
        self.assertEqual(days[0].slots, [])

    def test_every_day_in_the_range_comes_back_even_when_empty(self):
        """A calendar that omits its empty days makes "nothing on Wednesday" indistinguishable from
        "Wednesday was never asked about"."""
        service = self.make_service()
        monday = self.next_weekday(0)
        self.rule(0, 10, 12)

        days = slots_for_service(service, monday, monday + timedelta(days=3))
        self.assertEqual(len(days), 4)
        self.assertEqual(len(days[0].slots), 2)
        self.assertEqual([len(d.slots) for d in days[1:]], [0, 0, 0])

    def test_a_rule_pinned_to_one_listing_does_not_leak_into_another(self):
        general = self.make_service(title='General')
        physics = self.make_service(title='Physics only')
        tuesday = self.next_weekday(1)
        self.rule(1, 9, 11, service=physics)

        self.assertEqual(len(slots_for_service(physics, tuesday, tuesday)[0].slots), 2)
        self.assertEqual(slots_for_service(general, tuesday, tuesday)[0].slots, [])

    def test_a_general_rule_applies_to_every_listing(self):
        first = self.make_service(title='First')
        second = self.make_service(title='Second')
        tuesday = self.next_weekday(1)
        self.rule(1, 9, 11)

        self.assertEqual(len(slots_for_service(first, tuesday, tuesday)[0].slots), 2)
        self.assertEqual(len(slots_for_service(second, tuesday, tuesday)[0].slots), 2)

    def test_a_block_cuts_a_hole_in_the_middle_rather_than_trimming_an_edge(self):
        service = self.make_service()
        tuesday = self.next_weekday(1)
        self.rule(1, 9, 13)
        AvailabilityException.objects.create(
            tutor=self.tutor, date=tuesday, kind='block', start_time=time(10), end_time=time(11)
        )

        starts = [s.start for s in slots_for_service(service, tuesday, tuesday)[0].slots]
        self.assertEqual(starts, [self.at(tuesday, 9), self.at(tuesday, 11), self.at(tuesday, 12)])

    def test_an_all_day_block_clears_the_day(self):
        service = self.make_service()
        tuesday = self.next_weekday(1)
        self.rule(1, 9, 13)
        AvailabilityException.objects.create(tutor=self.tutor, date=tuesday, kind='block')

        self.assertEqual(slots_for_service(service, tuesday, tuesday)[0].slots, [])

    def test_an_opening_adds_hours_the_weekly_pattern_never_had(self):
        service = self.make_service()
        saturday = self.next_weekday(5)
        self.rule(1, 9, 13)  # Tuesdays only
        AvailabilityException.objects.create(
            tutor=self.tutor, date=saturday, kind='open', start_time=time(10), end_time=time(12)
        )

        starts = [s.start for s in slots_for_service(service, saturday, saturday)[0].slots]
        self.assertEqual(starts, [self.at(saturday, 10), self.at(saturday, 11)])

    def test_a_block_on_the_same_day_also_cuts_an_opening(self):
        """Order matters: openings are added before blocks are subtracted, so "I'm away that day"
        wins over "and also this Saturday" rather than the two silently disagreeing."""
        service = self.make_service()
        saturday = self.next_weekday(5)
        AvailabilityException.objects.create(
            tutor=self.tutor, date=saturday, kind='open', start_time=time(10), end_time=time(14)
        )
        AvailabilityException.objects.create(
            tutor=self.tutor, date=saturday, kind='block', start_time=time(11), end_time=time(13)
        )

        starts = [s.start for s in slots_for_service(service, saturday, saturday)[0].slots]
        self.assertEqual(starts, [self.at(saturday, 10), self.at(saturday, 13)])

    def test_overlapping_rules_do_not_offer_the_same_hour_twice(self):
        service = self.make_service()
        tuesday = self.next_weekday(1)
        self.rule(1, 9, 12)
        self.rule(1, 11, 14)

        starts = [s.start for s in slots_for_service(service, tuesday, tuesday)[0].slots]
        self.assertEqual(starts, [self.at(tuesday, h) for h in (9, 10, 11, 12, 13)])

    def test_slots_already_past_are_never_offered(self):
        service = self.make_service()
        today = timezone.localdate()
        AvailabilityException.objects.create(
            tutor=self.tutor, date=today, kind='open', start_time=time(0), end_time=time(23)
        )

        slots = slots_for_service(service, today, today)[0].slots
        self.assertTrue(all(s.start > timezone.now() for s in slots))


class ModeTests(ApiTestCase):
    """The load-bearing distinction: what a booking does to what the next student sees."""

    def test_derived_removes_a_taken_hour_from_what_others_see(self):
        service = self.make_service(availability_mode='derived')
        tuesday = self.next_weekday(1)
        self.rule(1, 14, 17)
        self.book(service, tuesday, 15, status='confirmed')

        starts = [s.start for s in slots_for_service(service, tuesday, tuesday)[0].slots]
        self.assertEqual(starts, [self.at(tuesday, 14), self.at(tuesday, 16)])

    def test_declared_keeps_offering_the_whole_window(self):
        service = self.make_service(availability_mode='declared')
        tuesday = self.next_weekday(1)
        self.rule(1, 14, 17)
        self.book(service, tuesday, 15, status='confirmed')

        starts = [s.start for s in slots_for_service(service, tuesday, tuesday)[0].slots]
        self.assertEqual(
            starts, [self.at(tuesday, 14), self.at(tuesday, 15), self.at(tuesday, 16)]
        )

    def test_an_event_the_tutor_is_HOSTING_takes_the_hour_out_of_derived_availability(self):
        """Hosting is a commitment to people who will physically turn up expecting you — exactly as
        binding as a confirmed booking. A tutor bookable during a workshop they are running would be
        double-booked by the app rather than by their own mistake."""
        service = self.make_service(availability_mode='derived')
        tuesday = self.next_weekday(1)
        self.rule(1, 14, 17)
        self.host_event(tuesday, 15)

        starts = [s.start for s in slots_for_service(service, tuesday, tuesday)[0].slots]
        self.assertEqual(starts, [self.at(tuesday, 14), self.at(tuesday, 16)])

    def test_an_event_the_tutor_is_only_ATTENDING_does_not(self):
        """The other half of the decision, and the reason it is a decision at all. Saying you are
        going to something is a statement this app lets you take back with one click, telling nobody —
        so treating it as a withdrawal of bookable hours would mean an RSVP silently costing somebody
        income they never agreed to give up. It is still drawn on their own calendar, so a tutor who
        does want the evening can block it with the one-off exception mechanism that already exists.
        """
        from events.models import EventAttendance

        service = self.make_service(availability_mode='derived')
        tuesday = self.next_weekday(1)
        self.rule(1, 14, 17)
        somebody_elses = self.host_event(tuesday, 15, host=self.other)
        EventAttendance.objects.create(
            event=somebody_elses, attendee=self.tutor, status='going'
        )

        starts = [s.start for s in slots_for_service(service, tuesday, tuesday)[0].slots]
        self.assertEqual(
            starts, [self.at(tuesday, 14), self.at(tuesday, 15), self.at(tuesday, 16)]
        )

    def test_a_declared_listing_keeps_publishing_through_a_hosted_event_too(self):
        """`declared` means "this window keeps showing whatever else is true", and an event is one
        more thing that is true. The two modes still meet in exactly one subtraction."""
        service = self.make_service(availability_mode='declared')
        tuesday = self.next_weekday(1)
        self.rule(1, 14, 17)
        self.host_event(tuesday, 15)

        starts = [s.start for s in slots_for_service(service, tuesday, tuesday)[0].slots]
        self.assertEqual(
            starts, [self.at(tuesday, 14), self.at(tuesday, 15), self.at(tuesday, 16)]
        )

    def test_a_draft_or_cancelled_event_blocks_nothing(self):
        """A draft was never announced. A cancellation is the hour being given back — continuing to
        withhold it would be the app disagreeing with the notification it just sent."""
        service = self.make_service(availability_mode='derived')
        tuesday = self.next_weekday(1)
        self.rule(1, 14, 17)
        self.host_event(tuesday, 14, status='draft')
        self.host_event(tuesday, 15, status='cancelled')

        starts = [s.start for s in slots_for_service(service, tuesday, tuesday)[0].slots]
        self.assertEqual(
            starts, [self.at(tuesday, 14), self.at(tuesday, 15), self.at(tuesday, 16)]
        )

    def test_a_longer_event_swallows_every_slot_it_covers(self):
        """The subtraction is interval arithmetic, not slot matching — a 150-minute workshop starting
        at 14:00 is not three separate one-hour clashes to be found individually."""
        service = self.make_service(availability_mode='derived')
        tuesday = self.next_weekday(1)
        self.rule(1, 14, 17)
        self.host_event(tuesday, 14, minutes=150)

        self.assertEqual(slots_for_service(service, tuesday, tuesday)[0].slots, [])

    def test_the_events_kill_switch_gives_the_hours_back(self):
        """The harder half of the call, stated as a test so nobody has to guess. With events off the
        tutor cannot see the event anywhere, so an hour missing from their published availability
        would be unexplainable from inside the app — and a kill switch whose side effects outlive it
        is not a kill switch. Nothing is lost: the hour goes again when the flag returns."""
        from moderation.models import FeatureFlag

        service = self.make_service(availability_mode='derived')
        tuesday = self.next_weekday(1)
        self.rule(1, 14, 17)
        self.host_event(tuesday, 15)
        FeatureFlag.objects.update_or_create(key='events', defaults={'is_enabled': False})

        starts = [s.start for s in slots_for_service(service, tuesday, tuesday)[0].slots]
        self.assertEqual(
            starts, [self.at(tuesday, 14), self.at(tuesday, 15), self.at(tuesday, 16)]
        )

    def test_a_student_cannot_book_the_hour_a_hosted_event_took(self):
        """The request-time gate reads the same function the browse endpoint does, so this follows —
        but it is the consequence that actually matters, and asserting it means a future refactor
        that split those two apart would be caught here rather than in production."""
        service = self.make_service(availability_mode='derived')
        tuesday = self.next_weekday(1)
        self.rule(1, 14, 17)
        self.host_event(tuesday, 15)

        response = self.as_(self.student).post(
            '/api/bookings/',
            {'service': service.pk, 'starts_at': self.at(tuesday, 15).isoformat()},
            format='json',
        )
        self.assertEqual(response.status_code, 400)

    def test_derived_holds_a_slot_from_the_moment_it_is_requested_not_confirmed(self):
        """The whole promise of `derived` is that what you see is bookable — a slot four people can
        request and one can have would break it just as thoroughly as a double-confirmed one."""
        service = self.make_service(availability_mode='derived')
        tuesday = self.next_weekday(1)
        self.rule(1, 14, 16)
        self.book(service, tuesday, 14, status='requested')

        starts = [s.start for s in slots_for_service(service, tuesday, tuesday)[0].slots]
        self.assertEqual(starts, [self.at(tuesday, 15)])

    def test_a_declined_booking_gives_the_hour_back(self):
        service = self.make_service(availability_mode='derived')
        tuesday = self.next_weekday(1)
        self.rule(1, 14, 16)
        booking = self.book(service, tuesday, 14, status='requested')

        booking.status = 'declined'
        booking.save()
        starts = [s.start for s in slots_for_service(service, tuesday, tuesday)[0].slots]
        self.assertEqual(starts, [self.at(tuesday, 14), self.at(tuesday, 15)])

    def test_an_hour_taken_through_one_listing_is_taken_on_all_of_them(self):
        """A tutor is one person. Scoping busy time to the listing the booking came through would
        double-book them while every individual listing looked internally consistent."""
        maths = self.make_service(title='Maths', availability_mode='derived')
        physics = self.make_service(title='Physics', availability_mode='derived')
        tuesday = self.next_weekday(1)
        self.rule(1, 14, 16)
        self.book(maths, tuesday, 14, status='confirmed')

        starts = [s.start for s in slots_for_service(physics, tuesday, tuesday)[0].slots]
        self.assertEqual(starts, [self.at(tuesday, 15)])


class MyScheduleTests(ApiTestCase):
    """The tutor's own calendar. Every test here pins a way it differs from the student-facing
    availability endpoint — those differences are the whole reason it exists separately."""

    def setUp(self):
        super().setUp()
        self.tuesday = self.next_weekday(1)
        self.rule(1, 14, 18)
        self.service = self.make_service()

    def get(self, user, **params):
        query = '&'.join(f'{key}={value}' for key, value in params.items())
        return self.as_(user).get(f'/api/my-schedule/{"?" + query if query else ""}')

    def day(self, response, day):
        return next(d for d in response.data['days'] if d['date'] == day.isoformat())

    def one_day(self, user, day):
        return self.get(user, **{'from': day.isoformat(), 'to': day.isoformat()})

    def test_a_booked_hour_stays_inside_its_window_rather_than_being_cut_out_of_it(self):
        """The one thing a calendar must not do. The student-facing endpoint subtracts a taken hour;
        here the window stays whole and the booking is drawn on top of it."""
        self.book(self.service, self.tuesday, 15, status='confirmed')

        response = self.one_day(self.tutor, self.tuesday)
        windows = self.day(response, self.tuesday)['windows']
        self.assertEqual(len(windows), 1)
        self.assertTrue(windows[0]['start'].startswith(f'{self.tuesday.isoformat()}T14:00'))
        self.assertEqual(len(response.data['bookings']), 1)

    def test_windows_are_not_sliced_into_sessions(self):
        """Session length belongs to one offering and this view spans all of them, so a 14:00-18:00
        rule is one four-hour window here rather than four bookable hours."""
        response = self.one_day(self.tutor, self.tuesday)
        self.assertEqual(len(self.day(response, self.tuesday)['windows']), 1)

    def test_rules_pinned_to_different_listings_all_appear(self):
        """"When might I be working" spans every listing — which one an hour was published under is a
        question for the rules list, not for the calendar."""
        other = self.make_service(title='Physics')
        self.rule(2, 9, 11, service=other)
        wednesday = self.next_weekday(2)

        response = self.one_day(self.tutor, wednesday)
        self.assertEqual(len(self.day(response, wednesday)['windows']), 1)

    def test_the_past_is_not_hidden(self):
        last_time = self.tuesday - timedelta(days=14)
        response = self.one_day(self.tutor, last_time)
        self.assertEqual(len(self.day(response, last_time)['windows']), 1)

    def test_a_blocked_day_has_no_window_at_all(self):
        AvailabilityException.objects.create(tutor=self.tutor, date=self.tuesday, kind='block')
        response = self.one_day(self.tutor, self.tuesday)
        self.assertEqual(self.day(response, self.tuesday)['windows'], [])

    def test_both_sides_of_the_caller_show_up_in_one_calendar(self):
        """Somebody who teaches on Tuesday and takes a lesson on Thursday has one week, not two."""
        self.book(self.service, self.tuesday, 14, status='confirmed')
        theirs = self.make_service(provider=self.student, title='Their listing')
        Booking.objects.create(
            service=theirs,
            tutor=self.student,
            student=self.tutor,
            starts_at=self.at(self.tuesday, 20),
            ends_at=self.at(self.tuesday, 21),
            status='confirmed',
        )

        response = self.one_day(self.tutor, self.tuesday)
        self.assertEqual(len(response.data['bookings']), 2)

    def test_nobody_else_is_in_it(self):
        self.book(self.service, self.tuesday, 14, status='confirmed')
        response = self.one_day(self.other, self.tuesday)
        self.assertEqual(response.data['bookings'], [])
        self.assertEqual(self.day(response, self.tuesday)['windows'], [])

    def test_it_needs_an_account(self):
        self.assertEqual(self.client.get('/api/my-schedule/').status_code, 401)

    def test_an_absurd_span_is_trimmed_rather_than_rendered(self):
        response = self.get(
            self.tutor,
            **{
                'from': self.tuesday.isoformat(),
                'to': (self.tuesday + timedelta(days=900)).isoformat(),
            },
        )
        self.assertLessEqual(len(response.data['days']), 91)


class AvailabilityEndpointTests(ApiTestCase):
    def test_availability_is_public_and_says_which_mode_produced_it(self):
        service = self.make_service(availability_mode='declared')
        self.rule(1, 14, 16)

        response = self.client.get(f'/api/services/{service.pk}/availability/')
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.data['availability_mode'], 'declared')
        self.assertEqual(response.data['session_minutes'], 60)
        self.assertTrue(response.data['has_schedule'])

    def test_a_listing_with_no_rules_says_so_rather_than_looking_fully_booked(self):
        """"Nobody wrote a schedule" and "every hour is taken" want completely different words on
        screen, and they are indistinguishable from an empty day list alone."""
        service = self.make_service()

        response = self.client.get(f'/api/services/{service.pk}/availability/')
        self.assertFalse(response.data['has_schedule'])
        self.assertTrue(all(day['slots'] == [] for day in response.data['days']))

    def test_the_horizon_is_capped_however_far_ahead_the_caller_asks(self):
        service = self.make_service()
        far = (timezone.localdate() + timedelta(days=400)).isoformat()

        response = self.client.get(f'/api/services/{service.pk}/availability/?to={far}')
        self.assertLessEqual(len(response.data['days']), 91)

    def test_a_malformed_date_falls_back_rather_than_failing_the_page(self):
        service = self.make_service()
        response = self.client.get(f'/api/services/{service.pk}/availability/?from=not-a-date')
        self.assertEqual(response.status_code, 200)


class RuleOwnershipTests(ApiTestCase):
    def test_rules_are_private_to_their_author(self):
        self.rule(1, 14, 16)
        response = self.as_(self.other).get('/api/availability-rules/')
        self.assertEqual(response.data, [])

    def test_somebody_elses_rule_cannot_be_deleted(self):
        rule = self.rule(1, 14, 16)
        response = self.as_(self.other).delete(f'/api/availability-rules/{rule.pk}/')
        self.assertEqual(response.status_code, 404)

    def test_a_rule_cannot_be_pinned_to_somebody_elses_listing(self):
        theirs = Service.objects.create(provider=self.other, title='Theirs')
        response = self.as_(self.tutor).post(
            '/api/availability-rules/',
            {'service': theirs.pk, 'weekday': 1, 'start_time': '14:00', 'end_time': '16:00'},
            format='json',
        )
        self.assertEqual(response.status_code, 400)

    def test_a_backwards_window_is_refused(self):
        response = self.as_(self.tutor).post(
            '/api/availability-rules/',
            {'weekday': 1, 'start_time': '16:00', 'end_time': '14:00'},
            format='json',
        )
        self.assertEqual(response.status_code, 400)

    def test_an_all_day_opening_is_refused_but_an_all_day_block_is_not(self):
        day = self.next_weekday(1).isoformat()
        opening = self.as_(self.tutor).post(
            '/api/availability-exceptions/', {'date': day, 'kind': 'open'}, format='json'
        )
        self.assertEqual(opening.status_code, 400)

        block = self.as_(self.tutor).post(
            '/api/availability-exceptions/', {'date': day, 'kind': 'block'}, format='json'
        )
        self.assertEqual(block.status_code, 201)

    def test_half_a_window_is_refused(self):
        response = self.as_(self.tutor).post(
            '/api/availability-exceptions/',
            {'date': self.next_weekday(1).isoformat(), 'kind': 'block', 'start_time': '10:00'},
            format='json',
        )
        self.assertEqual(response.status_code, 400)


class RequestTests(ApiTestCase):
    def setUp(self):
        super().setUp()
        self.tuesday = self.next_weekday(1)
        self.rule(1, 14, 17)

    def ask(self, service, hour, *, user=None, **extra):
        return self.as_(user or self.student).post(
            '/api/bookings/',
            {'service': service.pk, 'starts_at': self.at(self.tuesday, hour).isoformat(), **extra},
            format='json',
        )

    def test_a_request_starts_as_a_request_in_both_modes(self):
        """Nothing here ever writes a confirmed booking directly. A stranger should not be able to
        put an appointment in somebody's calendar, and a tutor should be free to refuse a particular
        student without having to undo one."""
        for mode in ('derived', 'declared'):
            with self.subTest(mode=mode):
                service = self.make_service(availability_mode=mode)
                response = self.ask(service, 14)
                self.assertEqual(response.status_code, 201, response.data)
                self.assertEqual(response.data['status'], 'requested')

    def test_the_end_time_is_the_servers_to_decide(self):
        service = self.make_service(session_minutes=45)
        response = self.ask(service, 14)
        booking = Booking.objects.get(pk=response.data['id'])
        self.assertEqual(booking.ends_at - booking.starts_at, timedelta(minutes=45))

    def test_a_time_the_tutor_never_offered_is_refused(self):
        service = self.make_service()
        response = self.ask(service, 3)
        self.assertEqual(response.status_code, 400)

    def test_in_derived_mode_a_second_request_for_the_same_hour_is_refused(self):
        service = self.make_service(availability_mode='derived')
        self.assertEqual(self.ask(service, 14).status_code, 201)
        second = self.ask(service, 14, user=self.other)
        self.assertEqual(second.status_code, 400)
        self.assertIn('no longer available', str(second.data))

    def test_in_declared_mode_the_same_hour_can_legitimately_be_asked_for_twice(self):
        """This is the mode working, not a hole in it: the tutor publishes a window and sorts the
        clashes out themselves, which is what they asked for by choosing it."""
        service = self.make_service(availability_mode='declared')
        self.assertEqual(self.ask(service, 14).status_code, 201)
        self.assertEqual(self.ask(service, 14, user=self.other).status_code, 201)

    def test_a_paused_listing_takes_no_bookings(self):
        service = self.make_service(is_active=False)
        self.assertEqual(self.ask(service, 14).status_code, 400)

    def test_a_tutor_cannot_book_themselves(self):
        service = self.make_service()
        self.assertEqual(self.ask(service, 14, user=self.tutor).status_code, 400)

    def test_a_past_slot_is_refused(self):
        service = self.make_service()
        past = timezone.now() - timedelta(days=7)
        response = self.as_(self.student).post(
            '/api/bookings/',
            {'service': service.pk, 'starts_at': past.isoformat()},
            format='json',
        )
        self.assertEqual(response.status_code, 400)

    def test_booking_requires_an_account(self):
        service = self.make_service()
        response = self.client.post(
            '/api/bookings/',
            {'service': service.pk, 'starts_at': self.at(self.tuesday, 14).isoformat()},
            format='json',
        )
        self.assertEqual(response.status_code, 401)


class LifecycleTests(ApiTestCase):
    def setUp(self):
        super().setUp()
        self.tuesday = self.next_weekday(1)
        self.rule(1, 14, 18)
        self.service = self.make_service(availability_mode='declared')
        self.booking = self.book(self.service, self.tuesday, 14)

    def act(self, user, what, booking=None, **body):
        return self.as_(user).post(
            f'/api/bookings/{(booking or self.booking).pk}/{what}/', body, format='json'
        )

    def test_only_the_tutor_confirms(self):
        self.assertEqual(self.act(self.student, 'confirm').status_code, 403)
        self.assertEqual(self.act(self.tutor, 'confirm').status_code, 200)

    def test_a_third_party_sees_nothing_at_all(self):
        """404 rather than 403 for somebody who is neither party — the same queryset-scoping answer
        this app already gives for a private conversation."""
        self.assertEqual(self.as_(self.other).get(f'/api/bookings/{self.booking.pk}/').status_code, 404)
        self.assertEqual(self.act(self.other, 'confirm').status_code, 404)

    def test_confirming_twice_is_a_conflict_not_a_bad_request(self):
        self.act(self.tutor, 'confirm')
        second = self.act(self.tutor, 'confirm')
        self.assertEqual(second.status_code, 409)

    def test_a_declined_booking_keeps_the_tutors_reason(self):
        response = self.act(self.tutor, 'decline', tutor_note='Sorry, exam week.')
        self.assertEqual(response.data['status'], 'declined')
        self.assertEqual(response.data['tutor_note'], 'Sorry, exam week.')

    def test_either_party_may_cancel_and_the_row_records_which(self):
        self.act(self.tutor, 'confirm')
        response = self.act(self.student, 'cancel')
        self.assertEqual(response.data['status'], 'cancelled')
        self.assertEqual(response.data['cancelled_by'], self.student.pk)

    def test_a_tutor_cannot_confirm_two_sessions_at_the_same_time_even_in_declared_mode(self):
        """`declared` is a statement about what is published, not a claim to be in two places at
        once — there is no group session in this model, so a second confirmation would be pretending
        there is."""
        clash = self.book(self.service, self.tuesday, 14, student=self.other)
        self.assertEqual(self.act(self.tutor, 'confirm').status_code, 200)
        second = self.act(self.tutor, 'confirm', booking=clash)
        self.assertEqual(second.status_code, 409)

    def test_a_session_cannot_be_completed_before_it_has_happened(self):
        self.act(self.tutor, 'confirm')
        self.assertEqual(self.act(self.tutor, 'complete').status_code, 409)

    def test_a_finished_session_can_be_marked_complete_by_the_tutor_only(self):
        past = timezone.now() - timedelta(hours=3)
        booking = Booking.objects.create(
            service=self.service,
            tutor=self.tutor,
            student=self.student,
            starts_at=past,
            ends_at=past + timedelta(hours=1),
            status='confirmed',
        )
        self.assertEqual(self.act(self.student, 'complete', booking=booking).status_code, 403)
        self.assertEqual(self.act(self.tutor, 'complete', booking=booking).status_code, 200)

    def test_a_cancelled_booking_cannot_be_confirmed_afterwards(self):
        self.act(self.student, 'cancel')
        self.assertEqual(self.act(self.tutor, 'confirm').status_code, 409)

    def test_the_tutor_is_told_how_many_other_requests_a_slot_is_contested_by(self):
        self.book(self.service, self.tuesday, 14, student=self.other)
        as_tutor = self.as_(self.tutor).get(f'/api/bookings/{self.booking.pk}/')
        self.assertEqual(as_tutor.data['overlapping_count'], 1)

    def test_a_student_is_never_shown_the_tutors_other_bookings(self):
        """It is a window onto the tutor's whole calendar across every listing they run — most of all
        in `declared` mode, where keeping their real load private is the point of the mode."""
        self.book(self.service, self.tuesday, 14, student=self.other)
        as_student = self.as_(self.student).get(f'/api/bookings/{self.booking.pk}/')
        self.assertEqual(as_student.data['overlapping_count'], 0)
        self.assertEqual(
            self.as_(self.student).get(f'/api/bookings/{self.booking.pk}/clashes/').status_code, 403
        )

    def test_the_list_splits_by_which_side_you_are_on(self):
        mine = self.book(
            self.make_service(provider=self.student, title='Their own listing'),
            self.tuesday,
            16,
            student=self.tutor,
        )
        as_tutor = self.as_(self.student).get('/api/bookings/?role=tutor')
        self.assertEqual([b['id'] for b in as_tutor.data], [mine.pk])
        as_student = self.as_(self.student).get('/api/bookings/?role=student')
        self.assertEqual([b['id'] for b in as_student.data], [self.booking.pk])


class NotificationTests(ApiTestCase):
    def setUp(self):
        super().setUp()
        self.tuesday = self.next_weekday(1)
        self.rule(1, 14, 18)
        self.service = self.make_service()

    def test_a_request_reaches_the_tutor_with_the_time(self):
        self.as_(self.student).post(
            '/api/bookings/',
            {
                'service': self.service.pk,
                'starts_at': self.at(self.tuesday, 14).isoformat(),
                'student_note': 'Stuck on series.',
            },
            format='json',
        )
        notification = Notification.objects.get(recipient=self.tutor, type='booking_requested')
        self.assertEqual(notification.target_label, self.service.title)
        self.assertIn('14:00', notification.note)

    def test_the_answer_reaches_the_student(self):
        booking = self.book(self.service, self.tuesday, 14)
        self.as_(self.tutor).post(f'/api/bookings/{booking.pk}/confirm/', {}, format='json')
        self.assertTrue(
            Notification.objects.filter(recipient=self.student, type='booking_confirmed').exists()
        )

    def test_a_declined_request_carries_the_reason_into_the_notification(self):
        booking = self.book(self.service, self.tuesday, 14)
        self.as_(self.tutor).post(
            f'/api/bookings/{booking.pk}/decline/', {'tutor_note': 'Exam week'}, format='json'
        )
        notification = Notification.objects.get(recipient=self.student, type='booking_declined')
        self.assertIn('Exam week', notification.note)

    def test_a_cancellation_reaches_the_other_party_and_not_the_one_who_did_it(self):
        booking = self.book(self.service, self.tuesday, 14, status='confirmed')
        self.as_(self.student).post(f'/api/bookings/{booking.pk}/cancel/', {}, format='json')
        self.assertTrue(
            Notification.objects.filter(recipient=self.tutor, type='booking_cancelled').exists()
        )
        self.assertFalse(
            Notification.objects.filter(recipient=self.student, type='booking_cancelled').exists()
        )

    def test_turning_the_category_off_stops_the_row_being_created_at_all(self):
        self.tutor.profile.notify_on_booking = False
        self.tutor.profile.save()
        self.as_(self.student).post(
            '/api/bookings/',
            {'service': self.service.pk, 'starts_at': self.at(self.tuesday, 14).isoformat()},
            format='json',
        )
        self.assertFalse(Notification.objects.filter(recipient=self.tutor).exists())


class ListingDeletionTests(ApiTestCase):
    """A listing is an offer; a booking is an agreement. Deleting the first must not silently take
    the second with it."""

    def setUp(self):
        super().setUp()
        self.tuesday = self.next_weekday(1)
        self.rule(1, 14, 18)
        self.service = self.make_service()

    def test_a_listing_with_an_upcoming_booking_refuses_to_be_deleted(self):
        self.book(self.service, self.tuesday, 14, status='confirmed')
        response = self.as_(self.tutor).delete(f'/api/services/{self.service.pk}/')
        self.assertEqual(response.status_code, 409)
        self.assertEqual(response.data['live_bookings'], 1)

    def test_pausing_it_is_offered_instead_and_leaves_the_booking_alone(self):
        booking = self.book(self.service, self.tuesday, 14, status='confirmed')
        response = self.as_(self.tutor).patch(
            f'/api/services/{self.service.pk}/', {'is_active': False}, format='json'
        )
        self.assertEqual(response.status_code, 200)
        booking.refresh_from_db()
        self.assertEqual(booking.status, 'confirmed')

    def test_once_the_bookings_are_settled_the_delete_goes_through(self):
        self.book(self.service, self.tuesday, 14, status='cancelled')
        response = self.as_(self.tutor).delete(f'/api/services/{self.service.pk}/')
        self.assertEqual(response.status_code, 204)


class KillSwitchTests(ApiTestCase):
    """Booking hides behind the tutoring flag rather than one of its own — turning tutoring off must
    take the booking endpoints with it, or a stale tab could still write appointments against a
    feature that is supposed to be gone."""

    def test_the_flag_hides_availability_and_bookings_alike(self):
        from moderation.models import FeatureFlag

        service = self.make_service()
        FeatureFlag.objects.update_or_create(key='tutoring', defaults={'is_enabled': False})

        # 401 anonymous, 403 signed in — DRF's own answer to a failed permission check depends on
        # whether the caller was authenticated at all, and this is the same pair classroom's own
        # KillSwitchTests already pins for the identical gate.
        self.assertEqual(
            self.client.get(f'/api/services/{service.pk}/availability/').status_code, 401
        )
        self.assertEqual(
            self.as_(self.student).get(f'/api/services/{service.pk}/availability/').status_code, 403
        )
        self.assertEqual(self.as_(self.student).get('/api/bookings/').status_code, 403)

    def test_a_moderator_keeps_access_while_the_flag_is_off(self):
        from moderation.models import FeatureFlag

        service = self.make_service()
        FeatureFlag.objects.update_or_create(key='tutoring', defaults={'is_enabled': False})
        staff = User.objects.create_user('mod', 'mod@x.example', 'pw12345!', is_staff=True)

        self.assertEqual(
            self.as_(staff).get(f'/api/services/{service.pk}/availability/').status_code, 200
        )
