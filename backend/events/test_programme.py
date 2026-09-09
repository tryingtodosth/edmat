"""The programme (AUDIENCE-BRIEF.md §3.1, §3.2, §3.5): organisers, tracks, sessions, speakers,
links, bookmarks, Q&A, .ics, and what a hosted programme does to a tutor's bookable hours.
Weighted at refusals, on events/tests.py's own reasoning."""

from datetime import timedelta

from django.urls import reverse
from django.utils import timezone
from rest_framework.test import APIClient, APITestCase

from booking.availability import _event_intervals
from notifications.models import Notification
from telemetry.routers import all_log_shards
from testing.factories import make_branch, make_exercise, make_material, make_user

from .models import Event, EventStaff, Session, SessionBookmark


def as_(user):
    c = APIClient()
    c.force_authenticate(user)
    return c


class ProgrammeCase(APITestCase):
    databases = set(all_log_shards()) | {'default'}

    def setUp(self):
        self.host = make_user('prog-host')
        self.co = make_user('prog-co')
        self.volunteer = make_user('prog-volunteer')
        self.stranger = make_user('prog-stranger')
        self.start = timezone.now() + timedelta(days=5)
        self.event = Event.objects.create(
            host=self.host, title='Autumn school', status='published', visibility='public',
            starts_at=self.start, runs_until=self.start + timedelta(days=2), location_kind='onsite',
            location_text='Main hall',
        )
        EventStaff.objects.create(event=self.event, user=self.co, role='organiser')
        EventStaff.objects.create(event=self.event, user=self.volunteer, role='volunteer')

    def sessions_url(self):
        return reverse('event-sessions', args=[self.event.pk])

    def session(self, **kw):
        defaults = dict(event=self.event, title='Opening talk', starts_at=self.start + timedelta(hours=2), duration_minutes=60)
        defaults.update(kw)
        return Session.objects.create(**defaults)


class StaffTests(ProgrammeCase):
    def test_creating_an_event_seats_the_host_as_organiser(self):
        row = self.event.staff.get(user=self.host)
        self.assertEqual(row.role, 'organiser')
        self.assertTrue(self.event.can_organise(self.host))

    def test_a_co_organiser_may_add_a_session_and_a_volunteer_may_not(self):
        body = {'title': 'Workshop A', 'starts_at': (self.start + timedelta(hours=3)).isoformat(), 'duration_minutes': 90}
        self.assertEqual(as_(self.co).post(self.sessions_url(), body, format='json').status_code, 201)
        self.assertEqual(as_(self.volunteer).post(self.sessions_url(), body, format='json').status_code, 403)
        self.assertEqual(as_(self.stranger).post(self.sessions_url(), body, format='json').status_code, 403)

    def test_only_an_organiser_sees_or_changes_staff_and_the_host_row_is_immutable(self):
        url = reverse('event-staff', args=[self.event.pk])
        self.assertEqual(as_(self.stranger).get(url).status_code, 403)
        self.assertEqual(as_(self.volunteer).get(url).status_code, 200)
        added = as_(self.co).post(url, {'user': self.stranger.pk, 'role': 'reviewer'}, format='json')
        self.assertEqual(added.status_code, 201, added.content)
        self.assertEqual(as_(self.co).post(url, {'user': self.stranger.pk, 'role': 'reviewer'}, format='json').json()['detail'], 'already_staff')
        host_row = self.event.staff.get(user=self.host)
        gone = as_(self.co).delete(reverse('event-staff-detail', args=[self.event.pk, host_row.pk]))
        self.assertEqual(gone.status_code, 400)
        self.assertTrue(self.event.staff.filter(user=self.host).exists())

    def test_a_staff_member_sees_a_draft_event(self):
        draft = Event.objects.create(host=self.host, title='Draft', status='draft', visibility='private')
        EventStaff.objects.create(event=draft, user=self.co, role='reviewer')
        self.assertEqual(as_(self.co).get(reverse('event-detail', args=[draft.pk])).status_code, 200)
        self.assertEqual(as_(self.stranger).get(reverse('event-detail', args=[draft.pk])).status_code, 404)


class SessionTests(ProgrammeCase):
    def test_a_session_has_to_fit_inside_the_event(self):
        too_early = {'title': 'x', 'starts_at': (self.start - timedelta(hours=1)).isoformat(), 'duration_minutes': 60}
        r = as_(self.host).post(self.sessions_url(), too_early, format='json')
        self.assertEqual(r.status_code, 400)
        self.assertIn('starts_at', r.json())
        day_two = {'title': 'y', 'starts_at': (self.start + timedelta(days=1, hours=9)).isoformat(), 'duration_minutes': 60}
        self.assertEqual(as_(self.host).post(self.sessions_url(), day_two, format='json').status_code, 201)

    def test_an_unscheduled_event_constrains_nothing(self):
        loose = Event.objects.create(host=self.host, title='Sometime', status='published', visibility='public')
        r = as_(self.host).post(reverse('event-sessions', args=[loose.pk]), {'title': 'z', 'starts_at': self.start.isoformat()}, format='json')
        self.assertEqual(r.status_code, 201, r.content)

    def test_speakers_and_links_are_written_whole_and_titles_resolve(self):
        branch = make_branch(slug='prog-branch')
        material = make_material(branch, 'prog-slides', title='Skrypt AM2')
        exercise = make_exercise(branch, 1, title='Całka Gaussa')
        body = {
            'title': 'Integrals', 'starts_at': (self.start + timedelta(hours=4)).isoformat(),
            'speakers': [{'user_id': self.co.pk}, {'name': 'Dr Guest', 'affiliation': 'PW'}],
            'links': [
                {'material': material.pk, 'role': 'slides'},
                {'exercise': exercise.pk, 'role': 'live', 'note': 'try (a) first'},
                {'url': 'https://example.org/rec', 'role': 'recording', 'label': 'Video'},
            ],
        }
        r = as_(self.host).post(self.sessions_url(), body, format='json')
        self.assertEqual(r.status_code, 201, r.content)
        data = r.json()
        self.assertEqual([s['name'] for s in data['speakers']], ['prog-co', 'Dr Guest'])
        self.assertEqual([(l['kind'], l['title']) for l in data['links']], [('material', 'Skrypt AM2'), ('exercise', 'Całka Gaussa'), ('url', 'Video')])
        # Replaced whole on PATCH: one link stays.
        r2 = as_(self.host).patch(reverse('event-session-detail', args=[self.event.pk, data['id']]), {'links': [{'exercise': exercise.pk, 'role': 'homework'}]}, format='json')
        self.assertEqual(r2.status_code, 200, r2.content)
        self.assertEqual(len(r2.json()['links']), 1)
        self.assertEqual(len(r2.json()['speakers']), 2)

    def test_a_link_points_at_exactly_one_thing(self):
        branch = make_branch(slug='prog-branch-2')
        material = make_material(branch, 'prog-m2')
        for links in ([{'role': 'slides'}], [{'material': material.pk, 'url': 'https://x.org', 'role': 'slides'}]):
            r = as_(self.host).post(self.sessions_url(), {'title': 't', 'starts_at': self.start.isoformat(), 'links': links}, format='json')
            self.assertEqual(r.status_code, 400, links)

    def test_reverse_listing_shows_visible_sessions_only(self):
        branch = make_branch(slug='prog-branch-3')
        material = make_material(branch, 'prog-m3')
        s = self.session()
        s.links.create(material=material, role='prepare')
        draft = Event.objects.create(host=self.host, title='Hidden', status='draft', visibility='private', starts_at=self.start)
        hidden = Session.objects.create(event=draft, title='secret', starts_at=self.start)
        hidden.links.create(material=material, role='prepare')
        ids = {row['id'] for row in self.client.get(reverse('session-list'), {'material': material.pk}).json()}
        self.assertEqual(ids, {s.pk})
        ids_host = {row['id'] for row in as_(self.host).get(reverse('session-list'), {'material': material.pk}).json()}
        self.assertEqual(ids_host, {s.pk, hidden.pk})

    def test_deleting_a_track_leaves_its_sessions_unfiled(self):
        track = self.event.tracks.create(name='Room A')
        s = self.session(track=track)
        r = as_(self.host).delete(reverse('event-track-detail', args=[self.event.pk, track.pk]))
        self.assertEqual(r.status_code, 204)
        s.refresh_from_db()
        self.assertIsNone(s.track_id)
        self.assertTrue(Session.objects.filter(pk=s.pk).exists())

    def test_a_track_from_another_event_is_refused(self):
        other = Event.objects.create(host=self.host, title='Other', status='published', visibility='public', starts_at=self.start)
        track = other.tracks.create(name='Elsewhere')
        r = as_(self.host).post(self.sessions_url(), {'title': 't', 'starts_at': self.start.isoformat(), 'track': track.pk}, format='json')
        self.assertEqual(r.status_code, 400)


class BookmarkAndAgendaTests(ProgrammeCase):
    def test_bookmark_toggle_and_my_agenda(self):
        s = self.session()
        url = reverse('event-session-bookmark', args=[self.event.pk, s.pk])
        r = as_(self.stranger).post(url)
        self.assertEqual(r.status_code, 200)
        self.assertTrue(r.json()['is_bookmarked'])
        self.assertEqual(r.json()['bookmark_count'], 1)
        agenda = as_(self.stranger).get(reverse('my-agenda')).json()
        self.assertEqual([row['id'] for row in agenda['sessions']], [s.pk])
        r = as_(self.stranger).delete(url)
        self.assertFalse(r.json()['is_bookmarked'])
        self.assertEqual(as_(self.stranger).get(reverse('my-agenda')).json()['sessions'], [])
        self.assertEqual(self.client.get(reverse('my-agenda')).status_code, 401)

    def test_ics_for_an_event_and_for_my_agenda(self):
        s = self.session(title='Talk; with, punctuation')
        r = self.client.get(reverse('event-ics', args=[self.event.pk]))
        self.assertEqual(r.status_code, 200)
        self.assertTrue(r['Content-Type'].startswith('text/calendar'))
        text = r.content.decode()
        self.assertIn('BEGIN:VEVENT', text)
        self.assertIn(f'UID:session-{s.pk}@edmat', text)
        self.assertIn('SUMMARY:Talk\\; with\\, punctuation — Autumn school', text)
        SessionBookmark.objects.create(user=self.stranger, session=s)
        r2 = as_(self.stranger).get(reverse('my-agenda-ics', kwargs={'fmt': 'ics'}))
        self.assertEqual(r2.status_code, 200)
        self.assertIn(f'UID:session-{s.pk}@edmat', r2.content.decode())

    def test_an_event_without_a_programme_exports_itself(self):
        text = self.client.get(reverse('event-ics', args=[self.event.pk])).content.decode()
        self.assertIn(f'UID:event-{self.event.pk}@edmat', text)


class NotificationTests(ProgrammeCase):
    def test_moving_a_session_tells_bookmarkers_and_attendees_but_an_abstract_edit_does_not(self):
        s = self.session()
        SessionBookmark.objects.create(user=self.stranger, session=s)
        going = make_user('prog-going')
        self.event.attendances.create(attendee=going, status='going')
        url = reverse('event-session-detail', args=[self.event.pk, s.pk])
        as_(self.host).patch(url, {'abstract': 'now with more detail'}, format='json')
        self.assertEqual(Notification.objects.filter(type='session_changed').count(), 0)
        as_(self.host).patch(url, {'location_text': 'Room 5'}, format='json')
        told = set(Notification.objects.filter(type='session_changed').values_list('recipient_id', flat=True))
        self.assertEqual(told, {self.stranger.pk, going.pk})


class QandATests(ProgrammeCase):
    def test_questions_thread_and_a_foreign_parent_is_refused(self):
        s = self.session()
        other = self.session(title='Other')
        url = reverse('event-session-comments', args=[self.event.pk, s.pk])
        root = as_(self.stranger).post(url, {'body': 'Why does the integral converge?'}, format='json')
        self.assertEqual(root.status_code, 201, root.content)
        reply = as_(self.co).post(url, {'body': 'Because…', 'parent': root.json()['id']}, format='json')
        self.assertEqual(reply.status_code, 201)
        foreign = as_(self.co).post(reverse('event-session-comments', args=[self.event.pk, other.pk]), {'body': 'x', 'parent': root.json()['id']}, format='json')
        self.assertEqual(foreign.status_code, 400)
        self.assertEqual(len(self.client.get(url).json()), 2)


class BookableHoursTests(ProgrammeCase):
    def test_a_programme_blocks_its_sessions_not_the_whole_span(self):
        span_start = self.start - timedelta(days=1)
        span_end = self.start + timedelta(days=4)
        # Without sessions: the whole two-day event is busy.
        whole = _event_intervals(self.host, span_start, span_end)
        self.assertEqual(len(whole), 1)
        self.assertEqual((whole[0].start, whole[0].end), (self.event.starts_at, self.event.ends_at))
        # With a programme: only the sessions' hours are.
        s1 = self.session(starts_at=self.start + timedelta(hours=2))
        s2 = self.session(title='Day two', starts_at=self.start + timedelta(days=1, hours=9), duration_minutes=120)
        busy = sorted(_event_intervals(self.host, span_start, span_end), key=lambda i: i.start)
        self.assertEqual([(i.start, i.end) for i in busy], [(s1.starts_at, s1.ends_at), (s2.starts_at, s2.ends_at)])
