"""Registration (AUDIENCE-BRIEF.md §3.3): modes, the waiting list with its 24-hour claim, lazy
expiry, LIFO demotion when capacity is cut, check-in, the organiser's questions, the CSV, the
masked public list, and per-session seats. Refusals first."""

from datetime import timedelta
from unittest.mock import patch

from django.urls import reverse
from django.utils import timezone
from rest_framework.test import APIClient, APITestCase

from notifications.models import Notification
from telemetry.routers import all_log_shards
from testing.factories import make_user

from .models import Event, EventStaff, Session
from .registration import PROMOTION_WINDOW


def as_(user):
    c = APIClient()
    c.force_authenticate(user)
    return c


class RegistrationCase(APITestCase):
    databases = set(all_log_shards()) | {'default'}

    def setUp(self):
        self.host = make_user('reg-host')
        self.a = make_user('reg-a')
        self.b = make_user('reg-b')
        self.c = make_user('reg-c')
        self.start = timezone.now() + timedelta(days=4)

    def event(self, **kw):
        defaults = dict(host=self.host, title='Seminar', status='published', visibility='public',
                        starts_at=self.start, duration_minutes=90, location_kind='online', online_url='https://x.org')
        defaults.update(kw)
        return Event.objects.create(**defaults)

    def attend(self, user, event, status='going', **extra):
        return as_(user).post(reverse('event-attend', args=[event.pk]), {'status': status, **extra}, format='json')

    def status_of(self, user, event):
        return event.attendances.get(attendee=user).status


class WaitingListTests(RegistrationCase):
    def test_a_full_event_waitlists_instead_of_refusing(self):
        ev = self.event(capacity=1)
        self.assertEqual(self.attend(self.a, ev).status_code, 200)
        r = self.attend(self.b, ev)
        self.assertEqual(r.status_code, 200)
        self.assertEqual(r.json()['attendance']['status'], 'waitlisted')
        self.assertEqual(r.json()['event']['waitlist_count'], 1)
        self.assertEqual(r.json()['event']['my_waitlist_position'], 1)
        self.assertEqual(Notification.objects.filter(recipient=self.b, type='registration_waitlisted').count(), 1)

    def test_a_freed_seat_is_offered_to_the_first_asked_with_a_claim_window(self):
        ev = self.event(capacity=1)
        self.attend(self.a, ev)
        self.attend(self.b, ev)
        self.attend(self.c, ev)
        self.assertEqual(self.attend(self.a, ev, status='not_going').status_code, 200)
        self.assertEqual(self.status_of(self.b, ev), 'promoted')
        self.assertEqual(self.status_of(self.c, ev), 'waitlisted')
        row = ev.attendances.get(attendee=self.b)
        self.assertIsNotNone(row.promotion_expires_at)
        self.assertEqual(Notification.objects.filter(recipient=self.b, type='registration_promoted').count(), 1)
        # The held seat counts: a newcomer cannot take it.
        self.assertEqual(self.attend(make_user('reg-d'), ev).json()['attendance']['status'], 'waitlisted')
        # Claiming turns it into a seat.
        self.assertEqual(self.attend(self.b, ev).json()['attendance']['status'], 'going')

    def test_a_lapsed_claim_expires_and_passes_the_seat_on(self):
        ev = self.event(capacity=1)
        self.attend(self.a, ev)
        self.attend(self.b, ev)
        self.attend(self.c, ev)
        self.attend(self.a, ev, status='not_going')
        row = ev.attendances.get(attendee=self.b)
        row.promotion_expires_at = timezone.now() - timedelta(minutes=1)
        row.save()
        # Lazy expiry: the next read notices.
        as_(self.host).get(reverse('event-registrations', args=[ev.pk]))
        self.assertEqual(self.status_of(self.b, ev), 'expired')
        self.assertEqual(self.status_of(self.c, ev), 'promoted')

    def test_cutting_capacity_demotes_the_most_recent_seat_holders(self):
        ev = self.event(capacity=3)
        for u in (self.a, self.b, self.c):
            self.attend(u, ev)
        r = as_(self.host).patch(reverse('event-detail', args=[ev.pk]), {'capacity': 1}, format='json')
        self.assertEqual(r.status_code, 200, r.content)
        self.assertEqual(self.status_of(self.a, ev), 'going')
        self.assertEqual(self.status_of(self.b, ev), 'waitlisted')
        self.assertEqual(self.status_of(self.c, ev), 'waitlisted')
        self.assertEqual(Notification.objects.filter(type='registration_waitlisted', note='capacity_reduced').count(), 2)

    def test_the_seat_count_never_exceeds_capacity_under_a_race(self):
        ev = self.event(capacity=1)
        self.attend(self.a, ev)
        self.attend(self.b, ev)
        self.assertEqual(ev.seat_holder_count(), 1)


class ApprovalTests(RegistrationCase):
    def test_approval_mode_queues_and_the_organiser_decides(self):
        ev = self.event(registration_mode='approval', capacity=1)
        r = self.attend(self.a, ev)
        self.assertEqual(r.json()['attendance']['status'], 'pending')
        self.assertEqual(r.json()['event']['pending_count'], 1)
        row = ev.attendances.get(attendee=self.a)
        url = reverse('event-registration-decide', args=[ev.pk, row.pk])
        self.assertEqual(as_(self.b).post(url, {'decision': 'accept'}, format='json').status_code, 403)
        self.assertEqual(as_(self.host).post(url, {'decision': 'accept'}, format='json').json()['status'], 'going')
        self.assertEqual(Notification.objects.filter(recipient=self.a, type='registration_confirmed').count(), 1)
        # Deciding twice is refused.
        self.assertEqual(as_(self.host).post(url, {'decision': 'accept'}, format='json').status_code, 409)
        # Accepting into a full event waitlists.
        self.attend(self.b, ev)
        row_b = ev.attendances.get(attendee=self.b)
        r2 = as_(self.host).post(reverse('event-registration-decide', args=[ev.pk, row_b.pk]), {'decision': 'accept'}, format='json')
        self.assertEqual(r2.json()['status'], 'waitlisted')

    def test_a_declined_person_is_told(self):
        ev = self.event(registration_mode='approval')
        self.attend(self.a, ev)
        row = ev.attendances.get(attendee=self.a)
        r = as_(self.host).post(reverse('event-registration-decide', args=[ev.pk, row.pk]), {'decision': 'decline', 'note': 'staff only'}, format='json')
        self.assertEqual(r.json()['status'], 'not_going')
        self.assertEqual(Notification.objects.filter(recipient=self.a, type='registration_declined').count(), 1)


class FormTests(RegistrationCase):
    def test_required_questions_and_choices_are_checked(self):
        ev = self.event(registration_mode='form')
        url = reverse('event-registration-fields', args=[ev.pk])
        r = as_(self.host).put(url, [
            {'label': 'Affiliation', 'kind': 'text', 'required': True},
            {'label': 'Track', 'kind': 'choice', 'required': False, 'options': ['A', 'B']},
        ], format='json')
        self.assertEqual(r.status_code, 200, r.content)
        fields = {f['label']: f['id'] for f in r.json()}
        self.assertEqual(as_(self.a).put(url, [], format='json').status_code, 403)
        missing = self.attend(self.a, ev, answers={})
        self.assertEqual(missing.status_code, 400)
        self.assertEqual(missing.json()['answers'][str(fields['Affiliation'])], 'required')
        bad = self.attend(self.a, ev, answers={str(fields['Affiliation']): 'UW', str(fields['Track']): 'Z'})
        self.assertEqual(bad.status_code, 400)
        ok = self.attend(self.a, ev, answers={str(fields['Affiliation']): 'UW', str(fields['Track']): 'B'})
        self.assertEqual(ok.status_code, 200, ok.content)
        self.assertEqual(ok.json()['attendance']['answers'][str(fields['Track'])], 'B')

    def test_a_choice_needs_two_options(self):
        ev = self.event(registration_mode='form')
        r = as_(self.host).put(reverse('event-registration-fields', args=[ev.pk]), [{'label': 'x', 'kind': 'choice', 'options': ['only']}], format='json')
        self.assertEqual(r.status_code, 400)

    def test_csv_export_carries_the_answers(self):
        ev = self.event(registration_mode='form')
        f = ev.registration_fields.create(label='Diet', kind='text')
        self.attend(self.a, ev, answers={str(f.pk): 'vegan'})
        r = as_(self.host).get(reverse('event-registrations-csv', args=[ev.pk]))
        self.assertEqual(r.status_code, 200)
        self.assertTrue(r['Content-Type'].startswith('text/csv'))
        text = r.content.decode()
        self.assertIn('Diet', text.splitlines()[0])
        self.assertIn('vegan', text)
        self.assertEqual(as_(self.a).get(reverse('event-registrations-csv', args=[ev.pk])).status_code, 403)


class CheckInTests(RegistrationCase):
    def test_a_volunteer_checks_in_and_undoes_without_touching_the_seat(self):
        ev = self.event(capacity=1)
        volunteer = make_user('reg-vol')
        EventStaff.objects.create(event=ev, user=volunteer, role='volunteer')
        self.attend(self.a, ev)
        row = ev.attendances.get(attendee=self.a)
        url = reverse('event-registration-checkin', args=[ev.pk, row.pk])
        self.assertEqual(as_(self.b).post(url).status_code, 403)
        r = as_(volunteer).post(url)
        self.assertEqual(r.status_code, 200, r.content)
        self.assertTrue(r.json()['checked_in'])
        self.assertEqual(ev.seat_holder_count(), 1)
        self.assertFalse(as_(volunteer).delete(url).json()['checked_in'])
        # A volunteer may not decide registrations.
        self.assertEqual(as_(volunteer).post(reverse('event-registration-decide', args=[ev.pk, row.pk]), {'decision': 'accept'}, format='json').status_code, 403)

    def test_only_somebody_going_can_be_checked_in(self):
        ev = self.event(capacity=1)
        self.attend(self.a, ev)
        self.attend(self.b, ev)  # waitlisted
        row = ev.attendances.get(attendee=self.b)
        self.assertEqual(as_(self.host).post(reverse('event-registration-checkin', args=[ev.pk, row.pk])).status_code, 409)


class RosterTests(RegistrationCase):
    def test_the_masked_public_list_is_opt_in_and_masked(self):
        ev = self.event()
        self.attend(self.a, ev)
        self.a.profile.display_name = 'Anna Kowalska'
        self.a.profile.save()
        url = reverse('event-attendees', args=[ev.pk])
        self.assertEqual(self.client.get(url).status_code, 403)
        ev.show_attendees_publicly = True
        ev.save()
        rows = self.client.get(url).json()
        self.assertEqual([r['attendee']['display_name'] for r in rows], ['Anna K.'])
        self.assertIsNone(rows[0]['attendee']['id'])
        # Somebody going sees full names; staff see every state.
        self.attend(self.b, ev, status='not_going')
        going_view = as_(self.a).get(url).json()
        self.assertEqual([r['attendee']['display_name'] for r in going_view], ['Anna Kowalska'])
        self.assertEqual(len(as_(self.host).get(url).json()), 2)


class SessionSeatTests(RegistrationCase):
    def test_a_capped_session_seats_only_people_going_and_stops_when_full(self):
        ev = self.event(capacity=0)
        session = Session.objects.create(event=ev, title='Workshop', starts_at=self.start + timedelta(hours=1), capacity=1)
        url = reverse('event-session-register', args=[ev.pk, session.pk])
        self.assertEqual(as_(self.a).post(url).status_code, 409)  # not going yet
        self.attend(self.a, ev)
        self.attend(self.b, ev)
        self.assertTrue(as_(self.a).post(url).json()['registered'])
        full = as_(self.b).post(url)
        self.assertEqual(full.status_code, 409)
        self.assertEqual(full.json()['detail'], 'session_full')
        detail = as_(self.a).get(reverse('event-session-detail', args=[ev.pk, session.pk])).json()
        self.assertTrue(detail['is_registered'])
        self.assertEqual(detail['registered_count'], 1)
        self.assertFalse(as_(self.a).delete(url).json()['registered'])
        # Withdrawing from the event drops the session seat too.
        as_(self.b).post(url)
        self.attend(self.b, ev, status='not_going')
        self.assertEqual(session.registrations.count(), 0)
