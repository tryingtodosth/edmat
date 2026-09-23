"""Refusals first, because a rota is mostly refusals.

Every invariant in `shifts/rules.py` exists to say no to something, and the thing that would fail
silently is not "a volunteer claimed a shift" — it is "a fifteen-year-old claimed the 23:00 door
shift and nobody noticed until they were standing there". So the minor rules, the overlap rules
and the authority rules get a test each, in the shape `test.md` §5 asks for, before anything about
a happy path.
"""

from datetime import timedelta
from decimal import Decimal

from django.urls import reverse
from django.utils import timezone
from rest_framework import status
from rest_framework.test import APITestCase

from events.models import Event, EventStaff, Session
from shifts.models import Assignment, Shift, Station, VolunteerRecord
from shifts import rules
from testing.factories import make_user


def _future(days=3, hour=10):
    """A weekday morning a few days out, in local time — far enough ahead that the drop cutoff and
    `is_past` never accidentally decide a test that is about something else."""
    when = timezone.localtime(timezone.now()) + timedelta(days=days)
    return when.replace(hour=hour, minute=0, second=0, microsecond=0)


class RotaTestCase(APITestCase):
    def setUp(self):
        self.organiser = make_user('rota-organiser')
        self.volunteer = make_user('rota-volunteer')
        self.event = Event.objects.create(
            host=self.organiser,
            title='Conference',
            starts_at=_future(),
            duration_minutes=60,
            runs_until=_future() + timedelta(days=1),
            status='published',
        )
        EventStaff.objects.create(event=self.event, user=self.volunteer, role='volunteer')
        self.station = Station.objects.create(event=self.event, kind='door', name='Main door')
        self.shift = Shift.objects.create(
            station=self.station, starts_at=_future(), ends_at=_future() + timedelta(hours=2), needed=1
        )

    def make_minor(self, username='rota-minor', *, with_consent=False):
        minor = make_user(username)
        minor.profile.is_minor = True
        minor.profile.save(update_fields=['is_minor'])
        EventStaff.objects.create(event=self.event, user=minor, role='volunteer')
        if with_consent:
            VolunteerRecord.objects.create(
                event=self.event, user=minor, consent_recorded_at=timezone.now()
            )
        return minor

    def claim(self, shift=None):
        return self.client.post(reverse('shift-claim', args=[(shift or self.shift).pk]))


class ClaimRefusalTests(RotaTestCase):
    def test_a_stranger_does_not_see_the_rota_at_all(self):
        outsider = make_user('rota-outsider')
        self.client.force_authenticate(outsider)
        response = self.client.get(reverse('event-stations', args=[self.event.pk]))
        self.assertEqual(response.status_code, status.HTTP_404_NOT_FOUND)

    def test_somebody_who_is_not_a_volunteer_cannot_claim(self):
        reviewer = make_user('rota-reviewer')
        EventStaff.objects.create(event=self.event, user=reviewer, role='reviewer')
        self.client.force_authenticate(reviewer)
        response = self.claim()
        self.assertEqual(response.status_code, status.HTTP_409_CONFLICT)
        self.assertEqual(response.data['reason'], 'not_volunteer')

    def test_a_full_shift_is_refused(self):
        other = make_user('rota-other')
        EventStaff.objects.create(event=self.event, user=other, role='volunteer')
        Assignment.objects.create(shift=self.shift, user=other, status='confirmed')
        self.client.force_authenticate(self.volunteer)
        response = self.claim()
        self.assertEqual(response.status_code, status.HTTP_409_CONFLICT)
        self.assertEqual(response.data['reason'], 'shift_full')

    def test_an_overlapping_shift_is_refused(self):
        other_station = Station.objects.create(event=self.event, name='Info', kind='info')
        clashing = Shift.objects.create(
            station=other_station,
            starts_at=_future() + timedelta(hours=1),
            ends_at=_future() + timedelta(hours=3),
        )
        Assignment.objects.create(shift=self.shift, user=self.volunteer, status='confirmed')
        self.client.force_authenticate(self.volunteer)
        response = self.claim(clashing)
        self.assertEqual(response.status_code, status.HTTP_409_CONFLICT)
        self.assertEqual(response.data['reason'], 'overlap')

    def test_a_shift_starting_ten_minutes_later_is_too_close(self):
        other_station = Station.objects.create(event=self.event, name='Info', kind='info')
        tight = Shift.objects.create(
            station=other_station,
            starts_at=_future() + timedelta(hours=2, minutes=10),
            ends_at=_future() + timedelta(hours=3),
        )
        Assignment.objects.create(shift=self.shift, user=self.volunteer, status='confirmed')
        self.client.force_authenticate(self.volunteer)
        response = self.claim(tight)
        self.assertEqual(response.status_code, status.HTTP_409_CONFLICT)
        self.assertEqual(response.data['reason'], 'too_close')

    def test_a_minor_cannot_claim_a_station_that_does_not_permit_minors(self):
        minor = self.make_minor(with_consent=True)
        self.client.force_authenticate(minor)
        response = self.claim()
        self.assertEqual(response.status_code, status.HTTP_409_CONFLICT)
        self.assertEqual(response.data['reason'], 'minor_station')

    def test_a_minor_cannot_claim_a_shift_touching_the_night(self):
        minor = self.make_minor(with_consent=True)
        self.station.minors_permitted = True
        self.station.save(update_fields=['minors_permitted'])
        night = Shift.objects.create(
            station=self.station,
            starts_at=_future(hour=21),
            ends_at=_future(hour=23),
        )
        self.client.force_authenticate(minor)
        response = self.claim(night)
        self.assertEqual(response.status_code, status.HTTP_409_CONFLICT)
        self.assertEqual(response.data['reason'], 'minor_night')

    def test_a_minor_cannot_go_over_the_daily_cap(self):
        minor = self.make_minor(with_consent=True)
        self.station.minors_permitted = True
        self.station.save(update_fields=['minors_permitted'])
        morning = Shift.objects.create(
            station=self.station, starts_at=_future(hour=8), ends_at=_future(hour=14), needed=2
        )
        Assignment.objects.create(shift=morning, user=minor, status='confirmed')
        afternoon = Shift.objects.create(
            station=self.station, starts_at=_future(hour=15), ends_at=_future(hour=18)
        )
        self.client.force_authenticate(minor)
        response = self.claim(afternoon)
        self.assertEqual(response.status_code, status.HTTP_409_CONFLICT)
        self.assertEqual(response.data['reason'], 'minor_daily_cap')

    def test_a_minor_with_no_consent_on_file_cannot_claim_anything(self):
        minor = self.make_minor()
        self.station.minors_permitted = True
        self.station.save(update_fields=['minors_permitted'])
        self.client.force_authenticate(minor)
        response = self.claim()
        self.assertEqual(response.status_code, status.HTTP_409_CONFLICT)
        self.assertEqual(response.data['reason'], 'minor_no_consent')

    def test_the_same_shift_cannot_be_claimed_twice(self):
        self.shift.needed = 3
        self.shift.save(update_fields=['needed'])
        self.client.force_authenticate(self.volunteer)
        self.assertEqual(self.claim().status_code, status.HTTP_201_CREATED)
        response = self.claim()
        self.assertEqual(response.status_code, status.HTTP_409_CONFLICT)
        self.assertEqual(response.data['reason'], 'already_assigned')

    def test_an_event_that_is_over_takes_no_more_claims(self):
        self.event.starts_at = timezone.now() - timedelta(days=5)
        self.event.runs_until = timezone.now() - timedelta(days=4)
        self.event.save(update_fields=['starts_at', 'runs_until'])
        self.client.force_authenticate(self.volunteer)
        response = self.claim()
        self.assertEqual(response.status_code, status.HTTP_409_CONFLICT)
        self.assertEqual(response.data['reason'], 'event_over')


class DropTests(RotaTestCase):
    def test_a_volunteer_cannot_drop_inside_the_cutoff(self):
        soon = Shift.objects.create(
            station=self.station,
            starts_at=timezone.now() + timedelta(hours=2),
            ends_at=timezone.now() + timedelta(hours=4),
        )
        Assignment.objects.create(shift=soon, user=self.volunteer, status='confirmed')
        self.client.force_authenticate(self.volunteer)
        response = self.client.post(reverse('shift-drop', args=[soon.pk]))
        self.assertEqual(response.status_code, status.HTTP_409_CONFLICT)
        self.assertEqual(response.data['reason'], 'cutoff')

    def test_an_organiser_can_still_drop_inside_the_cutoff(self):
        soon = Shift.objects.create(
            station=self.station,
            starts_at=timezone.now() + timedelta(hours=2),
            ends_at=timezone.now() + timedelta(hours=4),
        )
        assignment = Assignment.objects.create(shift=soon, user=self.volunteer, status='confirmed')
        self.client.force_authenticate(self.organiser)
        response = self.client.post(
            reverse('shift-drop', args=[soon.pk]), {'assignment': assignment.pk}, format='json'
        )
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        assignment.refresh_from_db()
        self.assertEqual(assignment.status, 'dropped')

    def test_a_dropped_shift_can_be_claimed_again(self):
        """The partial unique constraint's own reason for existing."""
        Assignment.objects.create(
            shift=self.shift, user=self.volunteer, status='dropped', dropped_at=timezone.now()
        )
        self.client.force_authenticate(self.volunteer)
        response = self.claim()
        self.assertEqual(response.status_code, status.HTTP_201_CREATED)


class AssignTests(RotaTestCase):
    def test_a_volunteer_cannot_assign_anybody(self):
        other = make_user('rota-other')
        EventStaff.objects.create(event=self.event, user=other, role='volunteer')
        self.client.force_authenticate(self.volunteer)
        response = self.client.post(
            reverse('shift-assign', args=[self.shift.pk]), {'user': other.pk}, format='json'
        )
        self.assertEqual(response.status_code, status.HTTP_403_FORBIDDEN)

    def test_an_organiser_may_assign_a_reviewer(self):
        reviewer = make_user('rota-reviewer')
        EventStaff.objects.create(event=self.event, user=reviewer, role='reviewer')
        self.client.force_authenticate(self.organiser)
        response = self.client.post(
            reverse('shift-assign', args=[self.shift.pk]), {'user': reviewer.pk}, format='json'
        )
        self.assertEqual(response.status_code, status.HTTP_201_CREATED)
        self.assertEqual(response.data['assignment']['status'], 'confirmed')

    def test_an_organiser_cannot_assign_somebody_who_is_not_on_staff(self):
        stranger = make_user('rota-stranger')
        self.client.force_authenticate(self.organiser)
        response = self.client.post(
            reverse('shift-assign', args=[self.shift.pk]), {'user': stranger.pk}, format='json'
        )
        self.assertEqual(response.status_code, status.HTTP_409_CONFLICT)
        self.assertEqual(response.data['reason'], 'not_volunteer')

    def test_an_organiser_cannot_assign_a_minor_to_a_night_shift_either(self):
        minor = self.make_minor(with_consent=True)
        self.station.minors_permitted = True
        self.station.save(update_fields=['minors_permitted'])
        night = Shift.objects.create(
            station=self.station, starts_at=_future(hour=22), ends_at=_future(hour=23)
        )
        self.client.force_authenticate(self.organiser)
        response = self.client.post(
            reverse('shift-assign', args=[night.pk]), {'user': minor.pk}, format='json'
        )
        self.assertEqual(response.status_code, status.HTTP_409_CONFLICT)
        self.assertEqual(response.data['reason'], 'minor_night')


class SupervisionTests(RotaTestCase):
    def test_a_minor_on_a_supervised_station_lands_as_claimed_not_refused(self):
        minor = self.make_minor(with_consent=True)
        self.station.minors_permitted = True
        self.station.requires_adult = True
        self.station.save(update_fields=['minors_permitted', 'requires_adult'])
        self.shift.needed = 2
        self.shift.save(update_fields=['needed'])
        self.client.force_authenticate(minor)
        response = self.claim()
        self.assertEqual(response.status_code, status.HTTP_201_CREATED)
        self.assertEqual(response.data['assignment']['status'], 'claimed')
        self.assertEqual(response.data['pending_reason'], 'needs_adult')

    def test_an_adult_already_on_the_shift_makes_the_minors_claim_stand(self):
        minor = self.make_minor(with_consent=True)
        self.station.minors_permitted = True
        self.station.requires_adult = True
        self.station.save(update_fields=['minors_permitted', 'requires_adult'])
        self.shift.needed = 2
        self.shift.save(update_fields=['needed'])
        Assignment.objects.create(shift=self.shift, user=self.volunteer, status='confirmed')
        self.client.force_authenticate(minor)
        response = self.claim()
        self.assertEqual(response.data['assignment']['status'], 'confirmed')
        self.assertIsNone(response.data['pending_reason'])

    def test_a_station_that_needs_confirmation_leaves_the_claim_waiting(self):
        self.station.needs_confirmation = True
        self.station.save(update_fields=['needs_confirmation'])
        self.client.force_authenticate(self.volunteer)
        response = self.claim()
        self.assertEqual(response.data['assignment']['status'], 'claimed')
        self.assertEqual(response.data['pending_reason'], 'needs_confirmation')
        assignment = Assignment.objects.get(pk=response.data['assignment']['id'])
        self.client.force_authenticate(self.organiser)
        confirmed = self.client.post(
            reverse('shift-confirm', args=[self.shift.pk]), {'assignment': assignment.pk}, format='json'
        )
        self.assertEqual(confirmed.data['status'], 'confirmed')


class SessionSignalTests(RotaTestCase):
    def test_a_shift_that_follows_a_session_moves_with_it(self):
        session = Session.objects.create(
            event=self.event, title='Keynote', starts_at=_future(hour=9), duration_minutes=60
        )
        station = Station.objects.create(
            event=self.event, name='Keynote room', kind='room', session=session
        )
        self.client.force_authenticate(self.organiser)
        response = self.client.post(
            reverse('station-shifts', args=[station.pk]), {'needed': 1}, format='json'
        )
        self.assertEqual(response.status_code, status.HTTP_201_CREATED)
        shift = Shift.objects.get(pk=response.data['id'])
        self.assertTrue(shift.follows_session)
        self.assertEqual(shift.starts_at, session.starts_at)

        session.starts_at = _future(hour=14)
        session.save()
        shift.refresh_from_db()
        self.assertEqual(shift.starts_at, session.starts_at)
        self.assertEqual(shift.ends_at, session.ends_at)

    def test_a_shift_with_its_own_hours_does_not_move(self):
        session = Session.objects.create(
            event=self.event, title='Keynote', starts_at=_future(hour=9), duration_minutes=60
        )
        station = Station.objects.create(
            event=self.event, name='Keynote room', kind='room', session=session
        )
        own = Shift.objects.create(
            station=station, starts_at=_future(hour=9), ends_at=_future(hour=10)
        )
        session.starts_at = _future(hour=15)
        session.save()
        own.refresh_from_db()
        self.assertEqual(own.starts_at, _future(hour=9))


class CoverageTests(RotaTestCase):
    def test_coverage_counts_confirmed_and_claimed_apart(self):
        self.shift.needed = 3
        self.shift.save(update_fields=['needed'])
        other = make_user('rota-other')
        Assignment.objects.create(shift=self.shift, user=self.volunteer, status='confirmed')
        Assignment.objects.create(shift=self.shift, user=other, status='claimed')
        self.client.force_authenticate(self.organiser)
        response = self.client.get(reverse('event-coverage', args=[self.event.pk]))
        row = response.data['shifts'][0]
        self.assertEqual(row['confirmed'], 1)
        self.assertEqual(row['claimed'], 1)
        self.assertEqual(row['needed'], 3)
        self.assertTrue(row['is_short'])

    def test_a_dropped_assignment_frees_its_place(self):
        Assignment.objects.create(
            shift=self.shift, user=self.volunteer, status='dropped', dropped_at=timezone.now()
        )
        self.client.force_authenticate(self.organiser)
        response = self.client.get(reverse('event-coverage', args=[self.event.pk]))
        self.assertEqual(response.data['shifts'][0]['confirmed'], 0)
        self.assertTrue(response.data['shifts'][0]['is_short'])

    def test_a_volunteer_cannot_read_the_coverage_grid(self):
        self.client.force_authenticate(self.volunteer)
        response = self.client.get(reverse('event-coverage', args=[self.event.pk]))
        self.assertEqual(response.status_code, status.HTTP_403_FORBIDDEN)


class HoursTests(RotaTestCase):
    def _done(self, body=None):
        assignment = Assignment.objects.create(
            shift=self.shift, user=self.volunteer, status='confirmed'
        )
        self.client.force_authenticate(self.organiser)
        payload = {'assignment': assignment.pk}
        payload.update(body or {})
        response = self.client.post(
            reverse('shift-done', args=[self.shift.pk]), payload, format='json'
        )
        return assignment, response

    def test_hours_come_from_the_shift_when_nothing_is_overridden(self):
        assignment, response = self._done()
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        assignment.refresh_from_db()
        self.assertEqual(assignment.credited_hours, Decimal('2.00'))
        self.assertEqual(rules.hours_for(self.volunteer, self.event), Decimal('2.00'))

    def test_a_small_override_needs_no_note(self):
        assignment, response = self._done({'hours': '1.75'})
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        assignment.refresh_from_db()
        self.assertEqual(assignment.credited_hours, Decimal('1.75'))

    def test_a_big_override_without_a_note_is_refused(self):
        _, response = self._done({'hours': '0.5'})
        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertEqual(response.data['reason'], 'note_required')

    def test_a_big_override_with_a_note_is_accepted(self):
        assignment, response = self._done({'hours': '0.5', 'note': 'Left early, ill.'})
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        assignment.refresh_from_db()
        self.assertEqual(assignment.credited_hours, Decimal('0.50'))
        self.assertEqual(assignment.credit_note, 'Left early, ill.')

    def test_a_no_show_credits_nothing(self):
        assignment = Assignment.objects.create(
            shift=self.shift, user=self.volunteer, status='confirmed'
        )
        self.client.force_authenticate(self.organiser)
        response = self.client.post(
            reverse('shift-no-show', args=[self.shift.pk]), {'assignment': assignment.pk}, format='json'
        )
        self.assertEqual(response.data['status'], 'no_show')
        self.assertEqual(rules.hours_for(self.volunteer, self.event), Decimal('0.00'))

    def test_deciding_twice_is_a_409(self):
        assignment = Assignment.objects.create(
            shift=self.shift, user=self.volunteer, status='confirmed'
        )
        self.client.force_authenticate(self.organiser)
        url = reverse('shift-no-show', args=[self.shift.pk])
        self.client.post(url, {'assignment': assignment.pk}, format='json')
        again = self.client.post(url, {'assignment': assignment.pk}, format='json')
        self.assertEqual(again.status_code, status.HTTP_409_CONFLICT)
        self.assertEqual(again.data['reason'], 'already_decided')


class PrivacyTests(RotaTestCase):
    def test_a_volunteer_never_sees_another_volunteers_account_id(self):
        other = make_user('rota-other')
        other.profile.display_name = 'Anna Kowalska'
        other.profile.save(update_fields=['display_name'])
        EventStaff.objects.create(event=self.event, user=other, role='volunteer')
        self.shift.needed = 2
        self.shift.save(update_fields=['needed'])
        Assignment.objects.create(shift=self.shift, user=other, status='confirmed')
        self.client.force_authenticate(self.volunteer)
        response = self.client.get(reverse('event-stations', args=[self.event.pk]))
        assignment = response.data[0]['shifts'][0]['assignments'][0]
        self.assertIsNone(assignment['user']['id'])
        self.assertEqual(assignment['user']['display_name'], 'Anna K.')
        self.assertIsNone(assignment['is_minor'])

    def test_an_organiser_sees_the_whole_name_and_the_id(self):
        other = make_user('rota-other')
        other.profile.display_name = 'Anna Kowalska'
        other.profile.save(update_fields=['display_name'])
        EventStaff.objects.create(event=self.event, user=other, role='volunteer')
        Assignment.objects.create(shift=self.shift, user=other, status='confirmed')
        self.client.force_authenticate(self.organiser)
        response = self.client.get(reverse('event-stations', args=[self.event.pk]))
        assignment = response.data[0]['shifts'][0]['assignments'][0]
        self.assertEqual(assignment['user']['id'], str(other.pk))
        self.assertEqual(assignment['user']['display_name'], 'Anna Kowalska')

    def test_a_volunteer_cannot_read_the_safeguarding_records(self):
        self.client.force_authenticate(self.volunteer)
        response = self.client.get(reverse('event-volunteers', args=[self.event.pk]))
        self.assertEqual(response.status_code, status.HTTP_403_FORBIDDEN)


class MyShiftsTests(RotaTestCase):
    def setUp(self):
        super().setUp()
        Station.objects.create(
            event=self.event, kind='info', name='Desk', location_text='Foyer, table 1'
        )
        Assignment.objects.create(shift=self.shift, user=self.volunteer, status='confirmed')

    def test_my_shifts_names_the_desk_and_not_a_phone_number(self):
        self.client.force_authenticate(self.volunteer)
        response = self.client.get(reverse('event-my-shifts', args=[self.event.pk]))
        self.assertEqual(response.data['desk_location'], 'Foyer, table 1')
        self.assertEqual(len(response.data['shifts']), 1)
        self.assertEqual(response.data['shifts'][0]['station_name'], 'Main door')

    def test_the_ics_carries_one_vevent_per_shift(self):
        self.client.force_authenticate(self.volunteer)
        response = self.client.get(f'/api/events/{self.event.pk}/my-shifts.ics')
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        body = response.content.decode()
        self.assertEqual(body.count('BEGIN:VEVENT'), 1)
        self.assertIn('SUMMARY:Main door', body)
        self.assertIn('BEGIN:VCALENDAR', body)

    def test_my_volunteering_totals_the_hours_per_event(self):
        assignment = Assignment.objects.get(shift=self.shift, user=self.volunteer)
        assignment.status = 'done'
        assignment.save(update_fields=['status'])
        self.client.force_authenticate(self.volunteer)
        response = self.client.get(reverse('my-volunteering'))
        self.assertEqual(len(response.data), 1)
        self.assertEqual(response.data[0]['hours'], '2.00')
        self.assertEqual(response.data[0]['done_count'], 1)


class VolunteerRecordTests(RotaTestCase):
    def test_recording_consent_unlocks_a_minors_claim(self):
        minor = self.make_minor()
        self.station.minors_permitted = True
        self.station.save(update_fields=['minors_permitted'])
        self.client.force_authenticate(minor)
        self.assertEqual(self.claim().data['reason'], 'minor_no_consent')

        self.client.force_authenticate(self.organiser)
        recorded = self.client.post(
            reverse('event-volunteers', args=[self.event.pk]),
            {'user': minor.pk, 'consent_recorded': True, 'consent_note': 'Form seen 12 May'},
            format='json',
        )
        self.assertEqual(recorded.status_code, status.HTTP_201_CREATED)
        self.assertTrue(recorded.data['has_consent'])

        self.client.force_authenticate(minor)
        self.assertEqual(self.claim().status_code, status.HTTP_201_CREATED)

    def test_a_volunteer_with_no_record_still_shows_up_in_the_list(self):
        self.client.force_authenticate(self.organiser)
        response = self.client.get(reverse('event-volunteers', args=[self.event.pk]))
        names = [row['user']['display_name'] for row in response.data]
        self.assertIn(self.volunteer.username, names)
        self.assertFalse(response.data[0]['has_consent'])


class FeatureFlagTests(RotaTestCase):
    def test_the_kill_switch_closes_the_whole_app(self):
        from moderation.models import FeatureFlag

        FeatureFlag.objects.update_or_create(key='shifts', defaults={'is_enabled': False})
        self.client.force_authenticate(self.volunteer)
        response = self.client.get(reverse('event-stations', args=[self.event.pk]))
        self.assertEqual(response.status_code, status.HTTP_403_FORBIDDEN)

    def test_the_neighbouring_event_endpoint_keeps_working(self):
        from moderation.models import FeatureFlag

        FeatureFlag.objects.update_or_create(key='shifts', defaults={'is_enabled': False})
        self.client.force_authenticate(self.volunteer)
        response = self.client.get(f'/api/events/{self.event.pk}/')
        self.assertEqual(response.status_code, status.HTTP_200_OK)


class AvailabilityTests(RotaTestCase):
    def test_a_confirmed_shift_blocks_a_tutors_hours(self):
        """`booking/availability.py`'s own asymmetry, extended: hosting blocks, attending does not,
        and a confirmed shift is a commitment of the hosting kind made to somebody else's event."""
        from booking.availability import _shift_intervals

        Assignment.objects.create(shift=self.shift, user=self.volunteer, status='confirmed')
        window_start = self.shift.starts_at - timedelta(hours=1)
        window_end = self.shift.ends_at + timedelta(hours=1)
        intervals = _shift_intervals(self.volunteer, window_start, window_end)
        self.assertEqual(len(intervals), 1)
        self.assertEqual(intervals[0].start, self.shift.starts_at)

    def test_a_claimed_shift_does_not_block_yet(self):
        from booking.availability import _shift_intervals

        Assignment.objects.create(shift=self.shift, user=self.volunteer, status='claimed')
        intervals = _shift_intervals(
            self.volunteer, self.shift.starts_at - timedelta(hours=1), self.shift.ends_at
        )
        self.assertEqual(intervals, [])


class IntegrationHelperTests(RotaTestCase):
    """`holds_station_assignment` is what step F's cloakroom desk asks at integration (§5)."""

    def test_a_confirmed_cloakroom_assignment_is_what_the_desk_will_ask_for(self):
        desk = Station.objects.create(event=self.event, kind='cloakroom', name='Cloakroom')
        shift = Shift.objects.create(
            station=desk, starts_at=_future(hour=9), ends_at=_future(hour=12)
        )
        self.assertTrue(rules.event_has_station(self.event, 'cloakroom'))
        self.assertFalse(rules.holds_station_assignment(self.volunteer, self.event, 'cloakroom'))
        Assignment.objects.create(shift=shift, user=self.volunteer, status='confirmed')
        self.assertTrue(rules.holds_station_assignment(self.volunteer, self.event, 'cloakroom'))
        # A shift at a different kind of station is not the cloakroom.
        self.assertFalse(rules.holds_station_assignment(self.volunteer, self.event, 'door'))

    def test_a_claim_still_waiting_for_confirmation_does_not_open_the_desk(self):
        desk = Station.objects.create(event=self.event, kind='cloakroom', name='Cloakroom')
        shift = Shift.objects.create(
            station=desk, starts_at=_future(hour=9), ends_at=_future(hour=12)
        )
        Assignment.objects.create(shift=shift, user=self.volunteer, status='claimed')
        self.assertFalse(rules.holds_station_assignment(self.volunteer, self.event, 'cloakroom'))


class OrganiserSelfClaimTests(RotaTestCase):
    def test_an_organiser_is_told_to_assign_themselves_rather_than_that_they_are_not_a_volunteer(self):
        """Two refusals that a boolean would have made one (house rule 6). Found by looking at the
        real page: the generic line reads absurdly to the person who would have to grant it."""
        self.client.force_authenticate(self.organiser)
        response = self.claim()
        self.assertEqual(response.status_code, status.HTTP_409_CONFLICT)
        self.assertEqual(response.data['reason'], 'organiser_assigns')

    def test_and_assigning_themselves_works(self):
        self.client.force_authenticate(self.organiser)
        response = self.client.post(
            reverse('shift-assign', args=[self.shift.pk]),
            {'user': self.organiser.pk},
            format='json',
        )
        self.assertEqual(response.status_code, status.HTTP_201_CREATED)
