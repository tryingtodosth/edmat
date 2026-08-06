"""What matters about an event is who can see it, who can get into it, and who is told when it moves.

So most of these pin refusals rather than happy paths, on the same reasoning `classroom/tests.py`
records: a broken create flow announces itself the first time somebody uses it, while a draft leaking
to strangers, an over-capacity room, or a cancellation nobody was told about all fail silently.
"""

import io
import shutil
import tempfile
from datetime import timedelta

from django.contrib.auth.models import User
from django.core.files.uploadedfile import SimpleUploadedFile
from django.db import connection
from django.test import TestCase, override_settings
from django.test.utils import CaptureQueriesContext
from django.utils import timezone
from PIL import Image
from rest_framework.test import APIClient

from moderation.models import FeatureFlag
from notifications.models import Notification
from taxonomy.models import Branch, Discipline
from telemetry.routers import all_log_shards

from .models import MAX_POST_LINKS, Event, EventAttendance, EventPost
from .postimage import MAX_POST_IMAGE_EDGE
from .services import POST_PREVIEW_CHARS


class ApiTestCase(TestCase):
    """The request-logging middleware writes to its own shards; a view test that does not declare
    them fails on Django's cross-database guard rather than on anything under test. Copied from
    `classroom/tests.py` rather than imported, so this app's suite does not break when that one's
    fixtures change."""

    databases = set(all_log_shards()) | {'default'}

    def setUp(self):
        self.host = User.objects.create_user('kasia', 'kasia@x.example', 'pw12345!')
        self.goer = User.objects.create_user('michal', 'michal@x.example', 'pw12345!')
        self.other = User.objects.create_user('ola', 'ola@x.example', 'pw12345!')
        self.discipline = Discipline.objects.create(slug='matematyka')
        self.subject = Branch.objects.create(slug='analiza-2', discipline=self.discipline)
        self.client = APIClient()

    def as_(self, user):
        client = APIClient()
        client.force_authenticate(user)
        return client

    def make_event(self, **kwargs):
        defaults = {
            'host': self.host,
            'title': 'Analiza II — exam prep',
            'status': 'published',
            'starts_at': timezone.now() + timedelta(days=3),
            'duration_minutes': 120,
            'location_kind': 'onsite',
            'location_text': 'room 4070',
        }
        defaults.update(kwargs)
        return Event.objects.create(**defaults)


class VisibilityTests(ApiTestCase):
    def test_a_draft_is_invisible_to_everybody_but_its_host(self):
        draft = self.make_event(status='draft')
        self.assertEqual(
            [e['id'] for e in self.as_(self.host).get('/api/events/').json()], [draft.pk]
        )
        self.assertEqual(self.as_(self.other).get('/api/events/').json(), [])
        self.assertEqual(self.client.get('/api/events/').json(), [])

    def test_a_stranger_reading_a_draft_directly_gets_a_404_not_a_403(self):
        """404, because for them it genuinely does not exist — the same answer this codebase gives
        for somebody else's course draft, and one that does not confirm the id is real."""
        draft = self.make_event(status='draft')
        self.assertEqual(self.as_(self.other).get(f'/api/events/{draft.pk}/').status_code, 404)

    def test_a_published_event_is_readable_without_an_account(self):
        event = self.make_event()
        response = self.client.get(f'/api/events/{event.pk}/')
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()['title'], event.title)

    def test_a_cancelled_event_stays_readable_but_leaves_the_browse_list(self):
        """Both halves matter, and they pull in opposite directions.

        It has to stay readable: the whole reason cancelling is a state rather than a delete is that
        somebody who arranged their Thursday around this must be able to find out it is off, and the
        link in their notification has to resolve. But it is not something on offer, so a stranger
        browsing "what is on" should not be shown three things that are not happening — which is
        exactly what the rendered page looked like before this filter existed.
        """
        event = self.make_event(status='cancelled')
        self.assertEqual(self.client.get(f'/api/events/{event.pk}/').status_code, 200)
        self.assertEqual(self.client.get('/api/events/').json(), [])

    def test_but_it_stays_in_the_lists_of_the_people_it_concerns(self):
        event = self.make_event(status='cancelled')
        EventAttendance.objects.create(event=event, attendee=self.goer, status='going')
        self.assertEqual(
            [e['id'] for e in self.as_(self.host).get('/api/events/?mine=hosting').json()],
            [event.pk],
        )
        self.assertEqual(
            [e['id'] for e in self.as_(self.goer).get('/api/events/?mine=attending').json()],
            [event.pk],
        )

    def test_upcoming_is_the_default_and_past_is_reachable(self):
        soon = self.make_event(title='soon')
        gone = self.make_event(title='gone', starts_at=timezone.now() - timedelta(days=2))
        self.assertEqual([e['id'] for e in self.client.get('/api/events/').json()], [soon.pk])
        self.assertEqual(
            [e['id'] for e in self.client.get('/api/events/?when=past').json()], [gone.pk]
        )

    def test_discovery_by_subject_and_field(self):
        event = self.make_event()
        event.subjects.add(self.subject)
        event.discipline = self.discipline
        event.save()
        self.make_event(title='unrelated')
        self.assertEqual(
            [e['id'] for e in self.client.get('/api/events/?subject=analiza-2').json()], [event.pk]
        )
        self.assertEqual(
            [e['id'] for e in self.client.get('/api/events/?discipline=matematyka').json()], [event.pk]
        )

    def test_mine_splits_hosting_from_attending(self):
        hosted = self.make_event(title='mine')
        theirs = self.make_event(title='theirs', host=self.other)
        EventAttendance.objects.create(event=theirs, attendee=self.host, status='going')
        client = self.as_(self.host)
        self.assertEqual(
            [e['id'] for e in client.get('/api/events/?mine=hosting').json()], [hosted.pk]
        )
        self.assertEqual(
            [e['id'] for e in client.get('/api/events/?mine=attending').json()], [theirs.pk]
        )

    def test_declining_takes_an_event_off_your_attending_list(self):
        theirs = self.make_event(host=self.other)
        EventAttendance.objects.create(event=theirs, attendee=self.host, status='not_going')
        self.assertEqual(self.as_(self.host).get('/api/events/?mine=attending').json(), [])


class AuthoringTests(ApiTestCase):
    def _payload(self, **over):
        body = {
            'title': 'Workshop',
            'starts_at': (timezone.now() + timedelta(days=5)).isoformat(),
            'duration_minutes': 90,
            'location_kind': 'onsite',
            'location_text': 'room 12',
            'status': 'published',
        }
        body.update(over)
        return body

    def test_creating_an_event_needs_an_account(self):
        self.assertEqual(self.client.post('/api/events/', self._payload()).status_code, 401)

    def test_the_creator_becomes_the_host_regardless_of_what_was_posted(self):
        response = self.as_(self.goer).post(
            '/api/events/', self._payload(host=self.host.pk), format='json'
        )
        self.assertEqual(response.status_code, 201)
        self.assertEqual(Event.objects.get(pk=response.json()['id']).host, self.goer)

    def test_creating_answers_with_the_read_shape(self):
        """The client needs an id and the derived fields to navigate; the write serializer has
        neither, so returning it would force an immediate second GET."""
        body = self.as_(self.goer).post('/api/events/', self._payload(), format='json').json()
        self.assertIn('ends_at', body)
        self.assertIn('can_respond', body)
        self.assertEqual(body['going_count'], 0)

    def test_an_onsite_event_must_say_where(self):
        response = self.as_(self.goer).post(
            '/api/events/', self._payload(location_text=''), format='json'
        )
        self.assertEqual(response.status_code, 400)

    def test_an_online_event_must_carry_a_link(self):
        response = self.as_(self.goer).post(
            '/api/events/',
            self._payload(location_kind='online', location_text='', online_url=''),
            format='json',
        )
        self.assertEqual(response.status_code, 400)

    def test_a_hybrid_event_needs_both(self):
        client = self.as_(self.goer)
        self.assertEqual(
            client.post(
                '/api/events/',
                self._payload(location_kind='hybrid', online_url=''),
                format='json',
            ).status_code,
            400,
        )
        self.assertEqual(
            client.post(
                '/api/events/',
                self._payload(location_kind='hybrid', online_url='https://x.example/room'),
                format='json',
            ).status_code,
            201,
        )

    def test_a_partial_edit_is_validated_against_the_fields_it_is_not_changing(self):
        """The real reason `EventWriteSerializer.validate` builds a merged probe: switching an onsite
        event to online while sending no URL must fail on the URL it does not have, not pass because
        the request did not mention it."""
        event = self.make_event()
        response = self.as_(self.host).patch(
            f'/api/events/{event.pk}/', {'location_kind': 'online'}, format='json'
        )
        self.assertEqual(response.status_code, 400)

    def test_somebody_elses_event_cannot_be_edited(self):
        event = self.make_event()
        response = self.as_(self.other).patch(
            f'/api/events/{event.pk}/', {'title': 'hijacked'}, format='json'
        )
        self.assertEqual(response.status_code, 404)
        self.assertEqual(Event.objects.get(pk=event.pk).title, event.title)

    def test_cancelling_cannot_be_smuggled_in_as_an_edit(self):
        event = self.make_event()
        response = self.as_(self.host).patch(
            f'/api/events/{event.pk}/', {'status': 'cancelled'}, format='json'
        )
        self.assertEqual(response.status_code, 400)
        self.assertEqual(Event.objects.get(pk=event.pk).status, 'published')

    def test_a_cancelled_event_cannot_be_reopened(self):
        event = self.make_event(status='cancelled')
        response = self.as_(self.host).patch(
            f'/api/events/{event.pk}/', {'status': 'published'}, format='json'
        )
        self.assertEqual(response.status_code, 400)

    def test_a_draft_nobody_is_coming_to_can_be_deleted(self):
        event = self.make_event(status='draft')
        self.assertEqual(self.as_(self.host).delete(f'/api/events/{event.pk}/').status_code, 204)
        self.assertFalse(Event.objects.filter(pk=event.pk).exists())

    def test_an_event_people_are_coming_to_refuses_to_be_deleted(self):
        event = self.make_event()
        EventAttendance.objects.create(event=event, attendee=self.goer, status='going')
        response = self.as_(self.host).delete(f'/api/events/{event.pk}/')
        self.assertEqual(response.status_code, 409)
        self.assertIn('Cancel it', response.json()['detail'])
        self.assertTrue(Event.objects.filter(pk=event.pk).exists())


class AttendanceTests(ApiTestCase):
    def test_saying_you_are_coming(self):
        event = self.make_event()
        response = self.as_(self.goer).post(
            f'/api/events/{event.pk}/attend/', {'status': 'going'}, format='json'
        )
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()['event']['going_count'], 1)
        self.assertEqual(response.json()['event']['my_attendance'], 'going')

    def test_answering_twice_updates_one_row_rather_than_making_a_second(self):
        event = self.make_event()
        client = self.as_(self.goer)
        client.post(f'/api/events/{event.pk}/attend/', {'status': 'going'}, format='json')
        body = client.post(
            f'/api/events/{event.pk}/attend/', {'status': 'not_going'}, format='json'
        ).json()
        self.assertEqual(event.attendances.count(), 1)
        self.assertEqual(body['event']['going_count'], 0)

    def test_changing_your_mind_gives_the_seat_back(self):
        event = self.make_event(capacity=1)
        first = self.as_(self.goer)
        first.post(f'/api/events/{event.pk}/attend/', {'status': 'going'}, format='json')
        second = self.as_(self.other)
        self.assertEqual(
            second.post(
                f'/api/events/{event.pk}/attend/', {'status': 'going'}, format='json'
            ).status_code,
            409,
        )
        first.post(f'/api/events/{event.pk}/attend/', {'status': 'not_going'}, format='json')
        self.assertEqual(
            second.post(
                f'/api/events/{event.pk}/attend/', {'status': 'going'}, format='json'
            ).status_code,
            200,
        )

    def test_a_full_event_still_lets_somebody_holding_a_seat_decline(self):
        """The one answer a full event most wants to hear, and the reason the cap check exempts
        somebody who already holds a seat."""
        event = self.make_event(capacity=1)
        client = self.as_(self.goer)
        client.post(f'/api/events/{event.pk}/attend/', {'status': 'going'}, format='json')
        self.assertEqual(
            client.post(
                f'/api/events/{event.pk}/attend/', {'status': 'not_going'}, format='json'
            ).status_code,
            200,
        )

    def test_the_host_does_not_attend_their_own_event(self):
        event = self.make_event()
        response = self.as_(self.host).post(
            f'/api/events/{event.pk}/attend/', {'status': 'going'}, format='json'
        )
        self.assertEqual(response.status_code, 409)
        self.assertEqual(response.json()['detail'], 'host')

    def test_the_host_is_not_counted_as_an_attendee(self):
        event = self.make_event()
        self.assertEqual(
            self.client.get(f'/api/events/{event.pk}/').json()['going_count'], 0
        )

    def test_a_past_event_cannot_be_answered(self):
        event = self.make_event(starts_at=timezone.now() - timedelta(days=1))
        response = self.as_(self.goer).post(
            f'/api/events/{event.pk}/attend/', {'status': 'going'}, format='json'
        )
        self.assertEqual(response.status_code, 409)
        self.assertEqual(response.json()['detail'], 'past')

    def test_a_cancelled_event_cannot_be_answered(self):
        event = self.make_event(status='cancelled')
        response = self.as_(self.goer).post(
            f'/api/events/{event.pk}/attend/', {'status': 'going'}, format='json'
        )
        self.assertEqual(response.status_code, 409)
        self.assertEqual(response.json()['detail'], 'cancelled')

    def test_answering_needs_an_account(self):
        event = self.make_event()
        self.assertEqual(
            self.client.post(
                f'/api/events/{event.pk}/attend/', {'status': 'going'}, format='json'
            ).status_code,
            401,
        )

    def test_the_block_reason_is_told_to_the_person_it_applies_to(self):
        """A disabled button with no explanation is the thing this codebase argues against, so the
        reason rides on the event itself rather than only being discovered by trying."""
        event = self.make_event(capacity=1)
        self.as_(self.goer).post(
            f'/api/events/{event.pk}/attend/', {'status': 'going'}, format='json'
        )
        body = self.as_(self.other).get(f'/api/events/{event.pk}/').json()
        self.assertFalse(body['can_respond'])
        self.assertEqual(body['response_block_reason'], 'full')
        self.assertEqual(body['seats_left'], 0)

    def test_an_uncapped_event_reports_no_seat_count_rather_than_a_large_one(self):
        event = self.make_event(capacity=0)
        self.assertIsNone(self.client.get(f'/api/events/{event.pk}/').json()['seats_left'])


class RosterTests(ApiTestCase):
    def test_the_attendee_list_is_not_public(self):
        event = self.make_event()
        self.assertEqual(self.client.get(f'/api/events/{event.pk}/attendees/').status_code, 403)

    def test_somebody_who_is_not_going_cannot_read_it(self):
        event = self.make_event()
        self.assertEqual(
            self.as_(self.other).get(f'/api/events/{event.pk}/attendees/').status_code, 403
        )

    def test_people_who_are_going_see_each_other(self):
        """Unlike a branch roster: "is anybody else going" is half of why somebody opens an event."""
        event = self.make_event()
        EventAttendance.objects.create(event=event, attendee=self.goer, status='going')
        EventAttendance.objects.create(event=event, attendee=self.other, status='going')
        rows = self.as_(self.goer).get(f'/api/events/{event.pk}/attendees/').json()
        self.assertEqual(len(rows), 2)

    def test_an_attendee_does_not_see_the_declines_and_the_host_does(self):
        event = self.make_event()
        EventAttendance.objects.create(event=event, attendee=self.goer, status='going')
        EventAttendance.objects.create(event=event, attendee=self.other, status='not_going')
        self.assertEqual(len(self.as_(self.goer).get(f'/api/events/{event.pk}/attendees/').json()), 1)
        self.assertEqual(len(self.as_(self.host).get(f'/api/events/{event.pk}/attendees/').json()), 2)

    def test_only_the_host_is_told_how_many_declined(self):
        event = self.make_event()
        EventAttendance.objects.create(event=event, attendee=self.other, status='not_going')
        self.assertEqual(
            self.as_(self.host).get(f'/api/events/{event.pk}/').json()['declined_count'], 1
        )
        self.assertEqual(
            self.as_(self.goer).get(f'/api/events/{event.pk}/').json()['declined_count'], 0
        )


class NotificationTests(ApiTestCase):
    def test_the_host_is_told_when_somebody_says_they_are_coming(self):
        event = self.make_event()
        self.as_(self.goer).post(
            f'/api/events/{event.pk}/attend/', {'status': 'going'}, format='json'
        )
        row = Notification.objects.get(recipient=self.host, type='event_attendance')
        self.assertEqual(row.actor, self.goer)
        self.assertEqual(row.event_id, event.pk)
        self.assertEqual(row.target_label, event.title)

    def test_a_decline_is_deliberately_silent(self):
        event = self.make_event()
        self.as_(self.goer).post(
            f'/api/events/{event.pk}/attend/', {'status': 'not_going'}, format='json'
        )
        self.assertFalse(Notification.objects.filter(recipient=self.host).exists())

    def test_changing_your_mind_does_not_notify_again(self):
        event = self.make_event()
        client = self.as_(self.goer)
        client.post(f'/api/events/{event.pk}/attend/', {'status': 'going'}, format='json')
        client.post(f'/api/events/{event.pk}/attend/', {'status': 'not_going'}, format='json')
        client.post(f'/api/events/{event.pk}/attend/', {'status': 'going'}, format='json')
        self.assertEqual(
            Notification.objects.filter(recipient=self.host, type='event_attendance').count(), 1
        )

    def test_cancelling_reaches_everybody_who_said_they_were_coming(self):
        event = self.make_event()
        EventAttendance.objects.create(event=event, attendee=self.goer, status='going')
        EventAttendance.objects.create(event=event, attendee=self.other, status='not_going')
        self.as_(self.host).post(f'/api/events/{event.pk}/cancel/')
        self.assertTrue(
            Notification.objects.filter(recipient=self.goer, type='event_cancelled').exists()
        )
        self.assertFalse(
            Notification.objects.filter(recipient=self.other, type='event_cancelled').exists()
        )

    def test_cancelling_twice_is_a_409_rather_than_a_second_round_of_notifications(self):
        event = self.make_event(status='cancelled')
        self.assertEqual(self.as_(self.host).post(f'/api/events/{event.pk}/cancel/').status_code, 409)

    def test_only_the_host_can_cancel(self):
        event = self.make_event()
        self.assertEqual(self.as_(self.other).post(f'/api/events/{event.pk}/cancel/').status_code, 404)

    def test_moving_the_time_tells_the_people_who_are_coming(self):
        event = self.make_event()
        EventAttendance.objects.create(event=event, attendee=self.goer, status='going')
        self.as_(self.host).patch(
            f'/api/events/{event.pk}/',
            {'starts_at': (timezone.now() + timedelta(days=9)).isoformat()},
            format='json',
        )
        self.assertTrue(
            Notification.objects.filter(recipient=self.goer, type='event_updated').exists()
        )

    def test_moving_the_room_tells_them_too(self):
        event = self.make_event()
        EventAttendance.objects.create(event=event, attendee=self.goer, status='going')
        self.as_(self.host).patch(
            f'/api/events/{event.pk}/', {'location_text': 'room 5820'}, format='json'
        )
        self.assertTrue(
            Notification.objects.filter(recipient=self.goer, type='event_updated').exists()
        )

    def test_fixing_a_typo_in_the_description_tells_nobody(self):
        """The reason `update` compares the old values rather than notifying on every write: a badge
        on forty people's bell for a corrected spelling is how a notification bell gets ignored."""
        event = self.make_event()
        EventAttendance.objects.create(event=event, attendee=self.goer, status='going')
        self.as_(self.host).patch(
            f'/api/events/{event.pk}/', {'description': 'bring a calculator'}, format='json'
        )
        self.assertFalse(Notification.objects.filter(recipient=self.goer).exists())

    def test_turning_the_category_off_stops_the_row_being_created_at_all(self):
        profile = self.host.profile
        profile.notify_on_event = False
        profile.save()
        event = self.make_event()
        self.as_(self.goer).post(
            f'/api/events/{event.pk}/attend/', {'status': 'going'}, format='json'
        )
        self.assertFalse(Notification.objects.filter(recipient=self.host).exists())


class KillSwitchTests(ApiTestCase):
    """The `events` flag hides the whole surface — every action, not only the writes — while real
    staff keep access. Matching `feature_gate`'s own documented contract."""

    def setUp(self):
        super().setUp()
        FeatureFlag.objects.update_or_create(key='events', defaults={'is_enabled': False})

    def test_anonymous_is_refused(self):
        self.assertEqual(self.client.get('/api/events/').status_code, 401)

    def test_a_signed_in_visitor_is_refused(self):
        self.assertEqual(self.as_(self.goer).get('/api/events/').status_code, 403)

    def test_even_the_host_of_an_existing_event_is_refused(self):
        event = self.make_event()
        self.assertEqual(self.as_(self.host).get(f'/api/events/{event.pk}/').status_code, 403)

    def test_answering_is_refused_too_so_a_stale_tab_cannot_write(self):
        event = self.make_event()
        self.assertEqual(
            self.as_(self.goer).post(
                f'/api/events/{event.pk}/attend/', {'status': 'going'}, format='json'
            ).status_code,
            403,
        )

    def test_a_moderator_keeps_access(self):
        self.goer.is_staff = True
        self.goer.save()
        self.assertEqual(self.as_(self.goer).get('/api/events/').status_code, 200)


class ScheduleTests(ApiTestCase):
    """Events feed `/api/my-schedule/` — see `MyScheduleView`'s own docstring for why, and for what
    they deliberately do not do."""

    def test_an_event_you_host_is_in_your_own_calendar(self):
        event = self.make_event(starts_at=timezone.now() + timedelta(days=1))
        body = self.as_(self.host).get('/api/my-schedule/').json()
        self.assertEqual([e['id'] for e in body['events']], [event.pk])
        self.assertTrue(body['events'][0]['is_host'])

    def test_an_event_you_are_going_to_is_in_it_as_well(self):
        event = self.make_event(starts_at=timezone.now() + timedelta(days=1))
        EventAttendance.objects.create(event=event, attendee=self.goer, status='going')
        body = self.as_(self.goer).get('/api/my-schedule/').json()
        self.assertEqual([e['id'] for e in body['events']], [event.pk])
        self.assertFalse(body['events'][0]['is_host'])

    def test_an_event_you_declined_is_not(self):
        event = self.make_event(starts_at=timezone.now() + timedelta(days=1))
        EventAttendance.objects.create(event=event, attendee=self.goer, status='not_going')
        self.assertEqual(self.as_(self.goer).get('/api/my-schedule/').json()['events'], [])

    def test_somebody_elses_event_is_not(self):
        self.make_event(starts_at=timezone.now() + timedelta(days=1))
        self.assertEqual(self.as_(self.other).get('/api/my-schedule/').json()['events'], [])

    def test_your_own_draft_is_not_in_it_either(self):
        """A draft is not a commitment — nothing has been announced, so nothing is occupying the
        evening yet."""
        self.make_event(status='draft', starts_at=timezone.now() + timedelta(days=1))
        self.assertEqual(self.as_(self.host).get('/api/my-schedule/').json()['events'], [])

    def test_a_cancelled_event_leaves_the_calendar(self):
        """The mirror image of the draft case, and for the opposite reason: this WAS a commitment and
        is not one any more, so leaving it there would go on saying the evening is taken after the
        very notification saying it is not."""
        event = self.make_event(starts_at=timezone.now() + timedelta(days=1))
        EventAttendance.objects.create(event=event, attendee=self.goer, status='going')
        self.as_(self.host).post(f'/api/events/{event.pk}/cancel/')
        self.assertEqual(self.as_(self.goer).get('/api/my-schedule/').json()['events'], [])

    def test_the_calendar_still_draws_published_windows_whole(self):
        """This endpoint never subtracts, whatever an event does to the student-facing one — a
        calendar with the appointments cut out of it is the one thing a calendar must not be. The
        bands come from `windows_for_tutor`, which knows nothing about events."""
        self.make_event(starts_at=timezone.now() + timedelta(days=1))
        body = self.as_(self.host).get('/api/my-schedule/').json()
        self.assertTrue(len(body['events']) > 0)
        self.assertIn('days', body)

    def test_the_events_kill_switch_empties_the_list_without_breaking_the_endpoint(self):
        """A killed feature leaking through a neighbouring endpoint is exactly the hole a kill switch
        is meant not to have — and `my-schedule` is a tutoring endpoint, so it must keep working."""
        self.make_event(starts_at=timezone.now() + timedelta(days=1))
        FeatureFlag.objects.update_or_create(key='events', defaults={'is_enabled': False})
        response = self.as_(self.host).get('/api/my-schedule/')
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()['events'], [])


# ---------------------------------------------------------------------------------------------
# Updates the host posts on an event
# ---------------------------------------------------------------------------------------------


def make_post_image_bytes(width: int = 2400, height: int = 1200, fmt: str = 'PNG') -> bytes:
    """A real encoded image, deliberately non-square and patterned. A solid square would make a
    working resize indistinguishable from a no-op, which is one of the things these tests check."""
    image = Image.new('RGB', (width, height), (30, 120, 200))
    for x in range(0, width, 80):
        for y in range(0, height, 80):
            image.paste((240, 200, 40), (x, y, x + 40, y + 40))
    buffer = io.BytesIO()
    image.save(buffer, fmt)
    return buffer.getvalue()


class PostTestCase(ApiTestCase):
    """Its own temporary MEDIA_ROOT, applied per class so the directory survives every test in it and
    is removed exactly once — the same arrangement `accounts/test_avatar.py` uses."""

    @classmethod
    def setUpClass(cls):
        cls._media_root = tempfile.mkdtemp(prefix='edmat-event-post-test-')
        cls._override = override_settings(MEDIA_ROOT=cls._media_root)
        cls._override.enable()
        super().setUpClass()

    @classmethod
    def tearDownClass(cls):
        super().tearDownClass()
        cls._override.disable()
        shutil.rmtree(cls._media_root, ignore_errors=True)


class PostWritingTests(PostTestCase):
    def test_the_host_can_post_an_update(self):
        event = self.make_event()
        response = self.as_(self.host).post(
            f'/api/events/{event.pk}/posts/', {'body': 'Slides are up.'}, format='json'
        )
        self.assertEqual(response.status_code, 201)
        body = response.json()
        self.assertEqual(body['body'], 'Slides are up.')
        self.assertEqual(body['author']['id'], self.host.pk)
        self.assertFalse(body['is_edited'])
        self.assertIsNone(body['edited_at'])

    def test_an_update_with_nothing_in_it_is_refused(self):
        """Not a pedantic check: an empty post is a notification sent to everybody who is coming,
        carrying nothing. See `EventPost.clean`."""
        event = self.make_event()
        response = self.as_(self.host).post(
            f'/api/events/{event.pk}/posts/', {'body': '   '}, format='json'
        )
        self.assertEqual(response.status_code, 400)

    def test_links_alone_are_not_an_update(self):
        """A bare URL with no sentence saying what it is asks the reader to click to find out, which
        is what an announcement exists to save them."""
        event = self.make_event()
        response = self.as_(self.host).post(
            f'/api/events/{event.pk}/posts/',
            {'body': '', 'links': ['https://example.com/slides']},
            format='json',
        )
        self.assertEqual(response.status_code, 400)

    def test_a_picture_with_no_words_is_a_valid_update(self):
        event = self.make_event()
        response = self.as_(self.host).post(
            f'/api/events/{event.pk}/posts/',
            {
                'body': '',
                'image': SimpleUploadedFile(
                    'board.png', make_post_image_bytes(), content_type='image/png'
                ),
            },
            format='multipart',
        )
        self.assertEqual(response.status_code, 201, response.content)
        self.assertTrue(response.json()['image_url'])

    def test_nobody_but_the_host_may_post(self):
        """404 rather than 403: whether somebody else's event has a posting endpoint is not
        information a stranger needs."""
        event = self.make_event()
        for user in (self.goer, self.other):
            response = self.as_(user).post(
                f'/api/events/{event.pk}/posts/', {'body': 'hello'}, format='json'
            )
            self.assertEqual(response.status_code, 404)
        self.assertEqual(EventPost.objects.count(), 0)

    def test_an_anonymous_client_cannot_post(self):
        event = self.make_event()
        response = self.client.post(
            f'/api/events/{event.pk}/posts/', {'body': 'hello'}, format='json'
        )
        self.assertIn(response.status_code, (401, 403))


class PostReadingTests(PostTestCase):
    def test_anybody_can_read_the_updates_on_a_published_event(self):
        """Public on purpose. "The room has moved" is most useful to somebody still deciding whether
        to come, and gating it behind an RSVP hides it from exactly those people."""
        event = self.make_event()
        self.as_(self.host).post(
            f'/api/events/{event.pk}/posts/', {'body': 'Room 5 now.'}, format='json'
        )
        response = self.client.get(f'/api/events/{event.pk}/posts/')
        self.assertEqual(response.status_code, 200)
        self.assertEqual([p['body'] for p in response.json()], ['Room 5 now.'])

    def test_a_strangers_view_of_a_drafts_updates_is_a_404(self):
        """Falls out of the event's own visibility rather than being checked again here — which is
        the point of scoping visibility in the queryset."""
        draft = self.make_event(status='draft')
        self.as_(self.host).post(
            f'/api/events/{draft.pk}/posts/', {'body': 'secret'}, format='json'
        )
        self.assertEqual(self.as_(self.other).get(f'/api/events/{draft.pk}/posts/').status_code, 404)
        self.assertEqual(self.client.get(f'/api/events/{draft.pk}/posts/').status_code, 404)
        self.assertEqual(self.as_(self.host).get(f'/api/events/{draft.pk}/posts/').status_code, 200)

    def test_the_newest_update_is_first(self):
        """The opposite of the event list's own order, and deliberately so: a feed of updates is read
        to answer "what has changed?", and the answer is at the top."""
        event = self.make_event()
        for line in ('first', 'second', 'third'):
            self.as_(self.host).post(
                f'/api/events/{event.pk}/posts/', {'body': line}, format='json'
            )
        rows = self.client.get(f'/api/events/{event.pk}/posts/').json()
        self.assertEqual([p['body'] for p in rows], ['third', 'second', 'first'])


class PostLinkTests(PostTestCase):
    def _links_of(self, event, payload, fmt='json'):
        response = self.as_(self.host).post(
            f'/api/events/{event.pk}/posts/', payload, format=fmt
        )
        self.assertEqual(response.status_code, 201, response.content)
        return response.json()['links']

    def test_a_json_list_keeps_the_order_it_was_written_in(self):
        event = self.make_event()
        links = self._links_of(
            event,
            {'body': 'Materials', 'links': ['https://b.example/2', 'https://a.example/1']},
        )
        self.assertEqual(links, ['https://b.example/2', 'https://a.example/1'])

    def test_repeated_form_fields_are_all_kept(self):
        """The case DRF's own default `get_value` loses: on a QueryDict it reads the LAST value for a
        repeated key, so three links would silently become one. See `PostLinksField.get_value`."""
        event = self.make_event()
        links = self._links_of(
            event,
            {
                'body': 'Materials',
                'links': ['https://a.example/1', 'https://b.example/2', 'https://c.example/3'],
            },
            fmt='multipart',
        )
        self.assertEqual(
            links, ['https://a.example/1', 'https://b.example/2', 'https://c.example/3']
        )

    def test_one_field_holding_several_lines_is_split(self):
        event = self.make_event()
        links = self._links_of(
            event,
            {'body': 'Materials', 'links': 'https://a.example/1\nhttps://b.example/2\n'},
            fmt='multipart',
        )
        self.assertEqual(links, ['https://a.example/1', 'https://b.example/2'])

    def test_the_same_link_twice_is_stored_once(self):
        event = self.make_event()
        links = self._links_of(
            event,
            {'body': 'Materials', 'links': ['https://a.example/1', 'https://a.example/1']},
        )
        self.assertEqual(links, ['https://a.example/1'])

    def test_something_that_is_not_a_url_is_refused(self):
        event = self.make_event()
        response = self.as_(self.host).post(
            f'/api/events/{event.pk}/posts/',
            {'body': 'Materials', 'links': ['not a link']},
            format='json',
        )
        self.assertEqual(response.status_code, 400)

    def test_more_links_than_a_post_may_carry_is_refused(self):
        event = self.make_event()
        response = self.as_(self.host).post(
            f'/api/events/{event.pk}/posts/',
            {
                'body': 'Materials',
                'links': [f'https://example.com/{n}' for n in range(MAX_POST_LINKS + 1)],
            },
            format='json',
        )
        self.assertEqual(response.status_code, 400)


class PostImageTests(PostTestCase):
    def test_the_stored_picture_is_re_encoded_and_bounded_but_keeps_its_shape(self):
        """Three things at once, and all three matter. Re-encoding is what discards appended payloads
        and EXIF; the bound is what stops a 24 megapixel phone photo being served to every reader;
        and the aspect ratio surviving is what makes this different from an avatar, which is
        centre-cropped square."""
        event = self.make_event()
        response = self.as_(self.host).post(
            f'/api/events/{event.pk}/posts/',
            {
                'body': 'The board',
                'image': SimpleUploadedFile(
                    'board.png', make_post_image_bytes(2400, 1200), content_type='image/png'
                ),
            },
            format='multipart',
        )
        self.assertEqual(response.status_code, 201, response.content)
        post = EventPost.objects.get()
        self.assertTrue(post.image.name.endswith('.webp'), post.image.name)
        stored = Image.open(post.image.path)
        self.assertEqual(stored.format, 'WEBP')
        self.assertEqual(stored.size, (MAX_POST_IMAGE_EDGE, MAX_POST_IMAGE_EDGE // 2))

    def test_a_picture_smaller_than_the_bound_is_not_stretched_up_to_it(self):
        """`thumbnail` is shrink-only on purpose: upscaling adds bytes and invents detail the source
        never had."""
        event = self.make_event()
        self.as_(self.host).post(
            f'/api/events/{event.pk}/posts/',
            {
                'body': 'small',
                'image': SimpleUploadedFile(
                    'small.png', make_post_image_bytes(320, 240), content_type='image/png'
                ),
            },
            format='multipart',
        )
        stored = Image.open(EventPost.objects.get().image.path)
        self.assertEqual(stored.size, (320, 240))

    def test_a_file_that_is_not_an_image_is_refused(self):
        event = self.make_event()
        response = self.as_(self.host).post(
            f'/api/events/{event.pk}/posts/',
            {
                'body': 'nope',
                'image': SimpleUploadedFile(
                    'payload.png', b'MZ\x90\x00\x03' * 200, content_type='image/png'
                ),
            },
            format='multipart',
        )
        self.assertEqual(response.status_code, 400)
        self.assertEqual(EventPost.objects.count(), 0)


class PostEditingTests(PostTestCase):
    def _make_post(self, event, **payload):
        payload.setdefault('body', 'Slides are up.')
        response = self.as_(self.host).post(
            f'/api/events/{event.pk}/posts/', payload, format='json'
        )
        self.assertEqual(response.status_code, 201, response.content)
        return response.json()['id']

    def test_editing_stamps_it_as_edited(self):
        event = self.make_event()
        post_id = self._make_post(event)
        response = self.as_(self.host).patch(
            f'/api/events/{event.pk}/posts/{post_id}/',
            {'body': 'Slides are up (fixed).'},
            format='json',
        )
        self.assertEqual(response.status_code, 200)
        body = response.json()
        self.assertEqual(body['body'], 'Slides are up (fixed).')
        self.assertTrue(body['is_edited'])
        self.assertIsNotNone(body['edited_at'])

    def test_an_edit_that_names_only_the_body_leaves_the_links_alone(self):
        """The PATCH trap: a partial edit must not read an absent field as an instruction to blank
        it."""
        event = self.make_event()
        post_id = self._make_post(event, links=['https://a.example/1'])
        response = self.as_(self.host).patch(
            f'/api/events/{event.pk}/posts/{post_id}/', {'body': 'reworded'}, format='json'
        )
        self.assertEqual(response.json()['links'], ['https://a.example/1'])

    def test_sending_an_empty_link_list_does_clear_them(self):
        """The other half of the rule above: absent means "leave alone", present-and-empty means
        "remove", and the two have to be distinguishable."""
        event = self.make_event()
        post_id = self._make_post(event, links=['https://a.example/1'])
        response = self.as_(self.host).patch(
            f'/api/events/{event.pk}/posts/{post_id}/', {'links': []}, format='json'
        )
        self.assertEqual(response.json()['links'], [])

    def test_nobody_but_the_host_may_edit_or_delete(self):
        event = self.make_event()
        post_id = self._make_post(event)
        url = f'/api/events/{event.pk}/posts/{post_id}/'
        self.assertEqual(
            self.as_(self.goer).patch(url, {'body': 'x'}, format='json').status_code, 404
        )
        self.assertEqual(self.as_(self.goer).delete(url).status_code, 404)
        self.assertEqual(EventPost.objects.count(), 1)

    def test_the_host_can_withdraw_an_update(self):
        event = self.make_event()
        post_id = self._make_post(event)
        response = self.as_(self.host).delete(f'/api/events/{event.pk}/posts/{post_id}/')
        self.assertEqual(response.status_code, 204)
        self.assertEqual(EventPost.objects.count(), 0)

    def test_an_edit_cannot_empty_a_post_out(self):
        event = self.make_event()
        post_id = self._make_post(event)
        response = self.as_(self.host).patch(
            f'/api/events/{event.pk}/posts/{post_id}/', {'body': ''}, format='json'
        )
        self.assertEqual(response.status_code, 400)

    def _post_with_picture(self, event):
        response = self.as_(self.host).post(
            f'/api/events/{event.pk}/posts/',
            {
                'body': 'The board',
                'image': SimpleUploadedFile(
                    'board.png', make_post_image_bytes(800, 400), content_type='image/png'
                ),
            },
            format='multipart',
        )
        self.assertEqual(response.status_code, 201, response.content)
        return response.json()['id']

    def test_an_empty_image_field_removes_the_picture(self):
        """Multipart cannot send null — every value is a string — so an empty `image` field is the
        only way a form can say "remove this". DRF reads a blank value for a nullable field as None,
        and this pins that: without it, a host who attached the wrong photo could only delete the
        whole post."""
        event = self.make_event()
        post_id = self._post_with_picture(event)
        response = self.as_(self.host).patch(
            f'/api/events/{event.pk}/posts/{post_id}/', {'image': ''}, format='multipart'
        )
        self.assertEqual(response.status_code, 200, response.content)
        self.assertEqual(response.json()['image_url'], '')
        # The rest of the post is untouched — removing a picture is not a rewrite.
        self.assertEqual(response.json()['body'], 'The board')

    def test_an_edit_that_names_only_the_body_keeps_the_picture(self):
        """The other half of `test_an_edit_that_names_only_the_body_leaves_the_links_alone`, and the
        one that would break silently: an absent `image` must mean "leave it", not "remove it"."""
        event = self.make_event()
        post_id = self._post_with_picture(event)
        response = self.as_(self.host).patch(
            f'/api/events/{event.pk}/posts/{post_id}/', {'body': 'reworded'}, format='json'
        )
        self.assertTrue(response.json()['image_url'])

    def test_removing_the_only_picture_from_a_wordless_post_is_refused(self):
        """It would leave a post with neither words nor a picture — which `EventPost.clean` forbids on
        creation, and must equally forbid an edit from arriving at."""
        event = self.make_event()
        response = self.as_(self.host).post(
            f'/api/events/{event.pk}/posts/',
            {
                'body': '',
                'image': SimpleUploadedFile(
                    'board.png', make_post_image_bytes(400, 200), content_type='image/png'
                ),
            },
            format='multipart',
        )
        post_id = response.json()['id']
        response = self.as_(self.host).patch(
            f'/api/events/{event.pk}/posts/{post_id}/', {'image': ''}, format='multipart'
        )
        self.assertEqual(response.status_code, 400)


class PostCountTests(PostTestCase):
    """The count that makes the feature visible from a listing, and the prefetch that keeps it from
    costing a query per event."""

    def test_an_event_carries_how_many_updates_it_has(self):
        event = self.make_event()
        self.assertEqual(self.client.get(f'/api/events/{event.pk}/').json()['post_count'], 0)
        for line in ('one', 'two'):
            self.as_(self.host).post(
                f'/api/events/{event.pk}/posts/', {'body': line}, format='json'
            )
        self.assertEqual(self.client.get(f'/api/events/{event.pk}/').json()['post_count'], 2)

    def test_withdrawing_an_update_brings_the_count_back_down(self):
        event = self.make_event()
        response = self.as_(self.host).post(
            f'/api/events/{event.pk}/posts/', {'body': 'one'}, format='json'
        )
        self.as_(self.host).delete(f'/api/events/{event.pk}/posts/{response.json()["id"]}/')
        self.assertEqual(self.client.get(f'/api/events/{event.pk}/').json()['post_count'], 0)

    def test_counting_the_updates_costs_no_queries_of_its_own(self):
        """The check that gives the prefetch a reason to exist.

        Deliberately compares five events WITHOUT updates against the same five WITH them, rather
        than one event against five. The listing does still cost a query per event — `going_count()`
        counts attendances per row — but that N+1 predates this field and is not what this test is
        about. Holding the row count fixed and varying only whether they have posts isolates the one
        claim being made: counting updates adds nothing per event.
        """
        events = [self.make_event(title=f'Event {index}') for index in range(5)]
        with CaptureQueriesContext(connection) as without:
            response = self.client.get('/api/events/?when=upcoming')
        self.assertEqual(len(response.json()), 5)
        self.assertEqual([e['post_count'] for e in response.json()], [0] * 5)

        for event in events:
            for line in ('one', 'two', 'three'):
                self.as_(self.host).post(
                    f'/api/events/{event.pk}/posts/', {'body': line}, format='json'
                )

        with CaptureQueriesContext(connection) as with_posts:
            response = self.client.get('/api/events/?when=upcoming')
        self.assertEqual([e['post_count'] for e in response.json()], [3] * 5)

        self.assertEqual(
            len(without.captured_queries),
            len(with_posts.captured_queries),
            'fifteen updates across five events must not add fifteen queries to the listing',
        )


class PostNotificationTests(PostTestCase):
    def _going(self, event, user):
        EventAttendance.objects.create(event=event, attendee=user, status='going')

    def test_everybody_holding_a_seat_is_told(self):
        event = self.make_event()
        self._going(event, self.goer)
        self.as_(self.host).post(
            f'/api/events/{event.pk}/posts/', {'body': 'Slides are up.'}, format='json'
        )
        notification = Notification.objects.get(recipient=self.goer, type='event_posted')
        self.assertEqual(notification.target_label, event.title)
        self.assertEqual(notification.event_id, event.pk)
        # The post's own words ride along, so the bell answers the question rather than only raising
        # it.
        self.assertEqual(notification.note, 'Slides are up.')

    def test_somebody_who_declined_is_not_told(self):
        event = self.make_event()
        EventAttendance.objects.create(event=event, attendee=self.other, status='not_going')
        self.as_(self.host).post(
            f'/api/events/{event.pk}/posts/', {'body': 'Slides are up.'}, format='json'
        )
        self.assertFalse(Notification.objects.filter(recipient=self.other).exists())

    def test_a_draft_notifies_nobody(self):
        draft = self.make_event(status='draft')
        self._going(draft, self.goer)
        self.as_(self.host).post(
            f'/api/events/{draft.pk}/posts/', {'body': 'not announced yet'}, format='json'
        )
        self.assertFalse(Notification.objects.filter(type='event_posted').exists())

    def test_an_edit_does_not_ring_the_bell_a_second_time(self):
        """A host fixing a typo must not put a badge on forty people's bell again — the same
        restraint `notify_attendees_of_change` shows by firing only when the time or place moved."""
        event = self.make_event()
        self._going(event, self.goer)
        response = self.as_(self.host).post(
            f'/api/events/{event.pk}/posts/', {'body': 'Slides are up.'}, format='json'
        )
        post_id = response.json()['id']
        self.as_(self.host).patch(
            f'/api/events/{event.pk}/posts/{post_id}/', {'body': 'Slides are up!'}, format='json'
        )
        self.assertEqual(Notification.objects.filter(type='event_posted').count(), 1)

    def test_a_long_update_arrives_truncated_rather_than_whole(self):
        event = self.make_event()
        self._going(event, self.goer)
        self.as_(self.host).post(
            f'/api/events/{event.pk}/posts/', {'body': 'x' * 400}, format='json'
        )
        note = Notification.objects.get(type='event_posted').note
        self.assertTrue(note.endswith('…'))
        self.assertLessEqual(len(note), POST_PREVIEW_CHARS + 1)
