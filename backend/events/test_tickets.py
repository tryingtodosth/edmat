"""Tickets, the door and the badge sheet (CONFERENCE-BRIEF.md §3.D). Refusals first: who may not
see a ticket, who may not scan, and every result the door can give that is not "come in"."""

from datetime import timedelta

from django.urls import reverse
from django.utils import timezone
from rest_framework.test import APIClient, APITestCase

from documents.models import DocumentAcknowledgement, EventDocument
from moderation.models import FeatureFlag
from telemetry.routers import all_log_shards
from testing.factories import make_user

from .models import Event, EventStaff, ScanEvent
from .scanning import SHORT_CODE_LENGTH


def as_(user):
    c = APIClient()
    c.force_authenticate(user)
    return c


def nonce(tag):
    return f'n-{tag}'


class TicketCase(APITestCase):
    databases = set(all_log_shards()) | {'default'}

    def setUp(self):
        self.host = make_user('tik-host')
        self.volunteer = make_user('tik-vol')
        self.attendee = make_user('tik-att')
        self.stranger = make_user('tik-str')
        self.event = Event.objects.create(
            host=self.host, title='Conference', status='published', visibility='public',
            starts_at=timezone.now() + timedelta(days=2), duration_minutes=480,
            location_kind='onsite', location_text='Hall A',
        )
        EventStaff.objects.create(event=self.event, user=self.volunteer, role='volunteer')

    def attend(self, user, status='going'):
        return as_(user).post(reverse('event-attend', args=[self.event.pk]), {'status': status}, format='json')

    def token_of(self, user):
        return self.event.attendances.get(attendee=user).ticket_token

    def scan(self, user, scans):
        return as_(user).post(reverse('event-scans', args=[self.event.pk]), {'scans': scans}, format='json')

    def entry(self, token, tag, direction='entry', at=None):
        return {
            'token': token, 'direction': direction, 'client_nonce': nonce(tag),
            'client_at': (at or timezone.now()).isoformat(), 'device_label': 'door-1',
        }


class TicketIssueTests(TicketCase):
    def test_a_going_row_gets_a_token_and_a_stranger_cannot_read_it(self):
        self.attend(self.attendee)
        token = self.token_of(self.attendee)
        self.assertTrue(token and len(token) == 32)
        r = as_(self.attendee).get(reverse('event-my-ticket', args=[self.event.pk]))
        self.assertEqual(r.status_code, 200)
        self.assertEqual(r.json()['token'], token)
        self.assertEqual(r.json()['short_code'], token[:SHORT_CODE_LENGTH])
        # Somebody else's ticket, asked for by account id, is a 403 — the row exists and saying
        # otherwise would send them hunting.
        r = as_(self.stranger).get(
            reverse('event-my-ticket', args=[self.event.pk]) + f'?attendee={self.attendee.pk}'
        )
        self.assertEqual(r.status_code, 403)

    def test_someone_who_never_answered_has_no_ticket(self):
        r = as_(self.stranger).get(reverse('event-my-ticket', args=[self.event.pk]))
        self.assertEqual(r.status_code, 404)
        self.assertEqual(r.json()['detail'], 'not_registered')

    def test_a_pending_row_is_told_which_refusal_it_is_rather_than_given_a_ticket(self):
        self.event.registration_mode = 'approval'
        self.event.save()
        self.attend(self.attendee)
        r = as_(self.attendee).get(reverse('event-my-ticket', args=[self.event.pk]))
        self.assertEqual(r.status_code, 409)
        self.assertEqual(r.json()['detail'], 'pending')
        self.assertEqual(r.json()['token'], '')

    def test_rotate_mints_a_new_token_and_the_old_one_stops_working(self):
        self.attend(self.attendee)
        old = self.token_of(self.attendee)
        r = as_(self.attendee).post(reverse('event-my-ticket-rotate', args=[self.event.pk]))
        self.assertEqual(r.status_code, 200)
        new = r.json()['token']
        self.assertNotEqual(new, old)
        self.assertEqual(self.token_of(self.attendee), new)
        results = self.scan(self.volunteer, [self.entry(old, 'old')]).json()['results']
        self.assertEqual(results[0]['result'], 'unknown')


class ScanRefusalTests(TicketCase):
    def test_an_attendee_may_not_post_scans(self):
        self.attend(self.attendee)
        r = self.scan(self.attendee, [self.entry(self.token_of(self.attendee), 'a')])
        self.assertEqual(r.status_code, 403)

    def test_a_stranger_may_not_read_the_checkin_list(self):
        self.assertEqual(
            as_(self.stranger).get(reverse('event-checkin-list', args=[self.event.pk])).status_code, 403
        )

    def test_a_volunteer_may_not_read_the_scan_log(self):
        self.assertEqual(
            as_(self.volunteer).get(reverse('event-scans', args=[self.event.pk])).status_code, 403
        )
        self.assertEqual(
            as_(self.host).get(reverse('event-scans', args=[self.event.pk])).status_code, 200
        )

    def test_a_volunteer_may_not_read_the_badge_sheet(self):
        self.assertEqual(
            as_(self.volunteer).get(reverse('event-badge-sheet', args=[self.event.pk])).status_code, 403
        )

    def test_an_unknown_token_is_refused_and_still_logged(self):
        results = self.scan(self.volunteer, [self.entry('nosuchtokenatall', 'u')]).json()['results']
        self.assertEqual(results[0]['result'], 'unknown')
        self.assertEqual(results[0]['name'], '')
        self.assertEqual(ScanEvent.objects.filter(event=self.event, result='unknown').count(), 1)

    def test_a_waitlisted_row_holds_a_ticket_but_is_refused_at_the_door(self):
        self.event.capacity = 1
        self.event.save()
        self.attend(make_user('tik-seat'))
        self.attend(self.attendee)  # waitlisted — no seat
        row = self.event.attendances.get(attendee=self.attendee)
        self.assertEqual(row.status, 'waitlisted')
        # No seat, so no ticket was ever minted; the door is asked with the short code somebody
        # read off a friend's screen, and answers about the token rather than the person.
        results = self.scan(self.volunteer, [self.entry('whatever12', 'w')]).json()['results']
        self.assertEqual(results[0]['result'], 'unknown')

    def test_a_withdrawn_seat_holder_keeps_the_token_and_is_answered_not_going(self):
        self.attend(self.attendee)
        token = self.token_of(self.attendee)
        self.attend(self.attendee, status='not_going')
        results = self.scan(self.volunteer, [self.entry(token, 'ng')]).json()['results']
        self.assertEqual(results[0]['result'], 'not_going')

    def test_a_batch_without_a_nonce_is_a_400_not_a_silent_skip(self):
        self.attend(self.attendee)
        r = self.scan(self.volunteer, [{'token': self.token_of(self.attendee), 'direction': 'entry'}])
        self.assertEqual(r.status_code, 400)

    def test_the_tickets_flag_removes_the_surface_but_not_the_checkin_button(self):
        self.attend(self.attendee)
        FeatureFlag.objects.filter(key='tickets').update(is_enabled=False)
        self.assertEqual(
            as_(self.attendee).get(reverse('event-my-ticket', args=[self.event.pk])).status_code, 403
        )
        self.assertEqual(
            as_(self.volunteer).get(reverse('event-checkin-list', args=[self.event.pk])).status_code, 403
        )
        row = self.event.attendances.get(attendee=self.attendee)
        r = as_(self.volunteer).post(
            reverse('event-registration-checkin', args=[self.event.pk, row.pk])
        )
        self.assertEqual(r.status_code, 200)
        self.assertTrue(r.json()['checked_in'])


class DoorTests(TicketCase):
    def setUp(self):
        super().setUp()
        self.attend(self.attendee)
        self.token = self.token_of(self.attendee)

    def test_the_first_entry_admits_and_sets_the_check_in_the_panel_already_reads(self):
        results = self.scan(self.volunteer, [self.entry(self.token, '1')]).json()['results']
        self.assertEqual(results[0]['result'], 'admitted')
        row = self.event.attendances.get(attendee=self.attendee)
        self.assertIsNotNone(row.checked_in_at)
        self.assertEqual(row.checked_in_by, self.volunteer)
        panel = as_(self.volunteer).get(reverse('event-registrations', args=[self.event.pk])).json()
        self.assertTrue(next(r for r in panel if r['status'] == 'going')['checked_in'])

    def test_a_second_entry_in_a_later_sync_is_already_in(self):
        self.scan(self.volunteer, [self.entry(self.token, '1')])
        results = self.scan(self.volunteer, [self.entry(self.token, '2')]).json()['results']
        self.assertEqual(results[0]['result'], 'already_in')

    def test_two_entries_for_one_token_in_one_batch_flag_the_later_as_a_collision(self):
        now = timezone.now()
        body = self.scan(self.volunteer, [
            self.entry(self.token, 'late', at=now),
            self.entry(self.token, 'early', at=now - timedelta(minutes=3)),
        ]).json()
        by_nonce = {r['client_nonce']: r['result'] for r in body['results']}
        # Ordered by the client's own clock, not by the order the phone happened to send them.
        self.assertEqual(by_nonce[nonce('early')], 'admitted')
        self.assertEqual(by_nonce[nonce('late')], 'collision')
        self.assertEqual(body['counts']['collisions'], 1)

    def test_an_exit_then_an_entry_admits_again(self):
        self.scan(self.volunteer, [self.entry(self.token, 'in1')])
        out = self.scan(self.volunteer, [self.entry(self.token, 'out', direction='exit')]).json()
        self.assertEqual(out['results'][0]['result'], 'exited')
        self.assertEqual(out['counts']['inside'], 0)
        again = self.scan(self.volunteer, [self.entry(self.token, 'in2')]).json()
        self.assertEqual(again['results'][0]['result'], 'admitted')
        self.assertEqual(again['counts']['inside'], 1)
        self.assertEqual(again['counts']['entries'], 2)
        self.assertEqual(again['counts']['exits'], 1)

    def test_leaving_when_never_admitted_changes_nothing(self):
        r = self.scan(self.volunteer, [self.entry(self.token, 'out', direction='exit')]).json()
        self.assertEqual(r['results'][0]['result'], 'already_in')
        self.assertIsNone(self.event.attendances.get(attendee=self.attendee).checked_out_at)

    def test_a_replayed_nonce_returns_the_same_row_and_scans_nobody_twice(self):
        first = self.scan(self.volunteer, [self.entry(self.token, 'once')]).json()['results'][0]
        again = self.scan(self.volunteer, [self.entry(self.token, 'once')]).json()['results'][0]
        self.assertEqual(again['result'], first['result'])
        self.assertEqual(again['received_at'], first['received_at'])
        self.assertEqual(ScanEvent.objects.filter(event=self.event).count(), 1)

    def test_an_offline_batch_stamps_the_time_the_scan_happened_not_the_time_it_arrived(self):
        happened = timezone.now() - timedelta(hours=2)
        payload = self.entry(self.token, 'offline', at=happened)
        payload['is_offline_sync'] = True
        self.scan(self.volunteer, [payload])
        row = self.event.attendances.get(attendee=self.attendee)
        self.assertLess(abs((row.checked_in_at - happened).total_seconds()), 2)

    def test_a_clock_running_fast_cannot_stamp_a_check_in_in_the_future(self):
        self.scan(self.volunteer, [self.entry(self.token, 'fast', at=timezone.now() + timedelta(hours=5))])
        row = self.event.attendances.get(attendee=self.attendee)
        self.assertLessEqual(row.checked_in_at, timezone.now())

    def test_a_typed_short_code_reaches_the_same_ticket(self):
        results = self.scan(self.volunteer, [self.entry(self.token[:SHORT_CODE_LENGTH], 'typed')]).json()['results']
        self.assertEqual(results[0]['result'], 'admitted')


class ListShapeTests(TicketCase):
    def test_the_checkin_list_carries_no_ids_and_no_contact_data(self):
        person = make_user('tik-anna')
        person.email = 'anna.kowalska@example.test'
        person.save(update_fields=['email'])
        person.profile.display_name = 'Anna Kowalska'
        person.profile.save()
        self.attend(person)
        rows = as_(self.volunteer).get(reverse('event-checkin-list', args=[self.event.pk])).json()
        self.assertEqual(len(rows), 1)
        row = rows[0]
        self.assertEqual(row['name'], 'Anna K.')
        self.assertEqual(set(row), {'token', 'short_code', 'name', 'status', 'checked_in_at',
                                    'checked_out_at', 'inside'})
        blob = str(rows)
        self.assertNotIn(person.email, blob)
        self.assertNotIn('Kowalska', blob)
        self.assertNotIn(str(person.pk), [str(v) for v in row.values()])

    def test_the_badge_sheet_prints_adults_in_full_and_minors_masked(self):
        adult = make_user('tik-adult')
        adult.profile.display_name = 'Bartek Nowak'
        adult.profile.save()
        child = make_user('tik-child')
        child.profile.display_name = 'Zosia Mazur'
        # `Profile.is_minor` is a stored flag, not a value derived from a birth year — set at
        # registration (accounts/minors.py, AUDIENCE-BRIEF.md §2) and never recomputed, so that a
        # child does not quietly stop being a minor between one request and the next.
        child.profile.is_minor = True
        child.profile.save()
        self.assertTrue(child.profile.is_minor)
        self.attend(adult)
        self.attend(child)
        body = as_(self.host).get(reverse('event-badge-sheet', args=[self.event.pk])).json()
        names = {b['name']: b['is_minor'] for b in body['badges']}
        self.assertEqual(names, {'Bartek Nowak': False, 'Zosia M.': True})


class BriefingGateTests(TicketCase):
    """Integration with step C (CONFERENCE-BRIEF.md §5): the door answers the documents gate."""

    def test_an_unread_mandatory_briefing_blocks_the_scan_batch(self):
        self.attend(self.attendee)
        doc = EventDocument.objects.create(
            event=self.event, title='Door briefing', kind='link', url='https://example.org/door',
            visibility='staff', requires_acknowledgement=True, uploaded_by=self.host,
        )
        refused = self.scan(self.volunteer, [self.entry(self.token_of(self.attendee), 'gate-1')])
        self.assertEqual(refused.status_code, 409)
        self.assertEqual(refused.json()['detail'], 'briefing_unread')
        self.assertEqual(refused.json()['documents'], [doc.pk])
        self.assertFalse(ScanEvent.objects.exists())
        # Reading the list is not gated — the volunteer can still see who is expected.
        self.assertEqual(
            as_(self.volunteer).get(reverse('event-checkin-list', args=[self.event.pk])).status_code, 200
        )
        DocumentAcknowledgement.objects.create(document=doc, user=self.volunteer, version=doc.version)
        allowed = self.scan(self.volunteer, [self.entry(self.token_of(self.attendee), 'gate-2')])
        self.assertEqual(allowed.status_code, 200)
        self.assertEqual(ScanEvent.objects.count(), 1)
