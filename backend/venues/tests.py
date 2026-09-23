"""`venues` — refusals first, then the happy paths that make the refusals mean something.

The order is deliberate and is the project's standing habit: a feature whose only tests are its
happy paths is a feature whose permission model has never been exercised. Every class below opens
with who is told no.
"""

from datetime import timedelta

from django.urls import reverse
from django.utils import timezone
from rest_framework import status
from rest_framework.test import APITestCase

from events.models import Event, EventStaff
from moderation.models import FeatureFlag
from telemetry.routers import all_log_shards
from testing.factories import make_user
from venues.access import booking_block_reason, publish_block_reason
from venues.models import (
    ChecklistInstance,
    ChecklistInstanceItem,
    ChecklistTemplate,
    ChecklistTemplateItem,
    Room,
    RoomBooking,
    Venue,
    VenueStaff,
)
from venues.services import instantiate


class VenueTestCase(APITestCase):
    """`databases` covers the log shards for the same reason every other suite here does: the
    activity/telemetry router sends some writes to `logs_*`, and a test that touches one without
    declaring it fails with `DatabaseOperationForbidden` rather than anything about venues."""

    databases = set(all_log_shards()) | {'default'}


def make_venue(slug='banacha-2', **kwargs):
    return Venue.objects.create(name=kwargs.pop('name', 'Banacha 2'), slug=slug, **kwargs)


def make_room(venue, name='4070', seated=60, fire=90, **kwargs):
    return Room.objects.create(
        venue=venue, name=name, seated_capacity=seated, fire_capacity=fire, **kwargs
    )


def make_event(host, **kwargs):
    kwargs.setdefault('title', 'Wykład gościnny')
    kwargs.setdefault('starts_at', timezone.now() + timedelta(days=20))
    kwargs.setdefault('duration_minutes', 90)
    return Event.objects.create(host=host, **kwargs)


class VenueReadTests(VenueTestCase):
    def setUp(self):
        self.venue = make_venue()
        make_room(self.venue)
        make_room(self.venue, name='0142', seated=200, fire=240, is_active=False)

    def test_a_stranger_can_read_the_building_and_its_active_rooms(self):
        """A lecture theatre's address and seat count is not a secret — it is the thing somebody
        needs in order to decide whether to ask for it."""
        res = self.client.get(f'/api/venues/{self.venue.pk}/')
        self.assertEqual(res.status_code, status.HTTP_200_OK)
        self.assertEqual(len(res.data['rooms']), 1)
        self.assertFalse(res.data['can_administer'])

    def test_an_inactive_building_leaves_the_public_list(self):
        closed = make_venue(slug='closed', name='Closed', is_active=False)
        res = self.client.get('/api/venues/')
        slugs = {row['slug'] for row in res.data}
        self.assertIn(self.venue.slug, slugs)
        self.assertNotIn(closed.slug, slugs)

    def test_an_administrator_still_sees_their_own_inactive_building(self):
        closed = make_venue(slug='closed', name='Closed', is_active=False)
        admin = make_user('venue-admin')
        VenueStaff.objects.create(venue=closed, user=admin, role='administrator')
        self.client.force_authenticate(admin)
        res = self.client.get('/api/venues/')
        self.assertIn(closed.slug, {row['slug'] for row in res.data})

    def test_who_runs_a_building_is_not_a_public_fact(self):
        res = self.client.get(f'/api/venues/{self.venue.pk}/staff/')
        self.assertEqual(res.status_code, status.HTTP_403_FORBIDDEN)


class VenueStaffTests(VenueTestCase):
    def setUp(self):
        self.venue = make_venue()
        self.admin = make_user('admin-of-venue')
        VenueStaff.objects.create(venue=self.venue, user=self.admin, role='administrator')
        self.porter = make_user('porter')
        VenueStaff.objects.create(venue=self.venue, user=self.porter, role='porter')
        self.stranger = make_user('stranger')

    def test_a_stranger_cannot_add_a_venue_administrator(self):
        self.client.force_authenticate(self.stranger)
        res = self.client.post(
            f'/api/venues/{self.venue.pk}/staff/', {'user_id': self.stranger.pk}, format='json'
        )
        self.assertEqual(res.status_code, status.HTTP_403_FORBIDDEN)

    def test_a_porter_may_read_the_staff_list_but_not_write_it(self):
        self.client.force_authenticate(self.porter)
        self.assertEqual(
            self.client.get(f'/api/venues/{self.venue.pk}/staff/').status_code,
            status.HTTP_200_OK,
        )
        res = self.client.post(
            f'/api/venues/{self.venue.pk}/staff/', {'user_id': self.stranger.pk}, format='json'
        )
        self.assertEqual(res.status_code, status.HTTP_403_FORBIDDEN)

    def test_an_administrator_adds_the_next_one(self):
        self.client.force_authenticate(self.admin)
        res = self.client.post(
            f'/api/venues/{self.venue.pk}/staff/',
            {'user_id': self.stranger.pk, 'role': 'administrator'},
            format='json',
        )
        self.assertEqual(res.status_code, status.HTTP_201_CREATED)
        self.assertEqual(res.data['added_by']['id'], self.admin.pk)

    def test_the_last_administrator_cannot_be_removed(self):
        """A building with nobody who can open it is a building nobody can open again."""
        self.client.force_authenticate(self.admin)
        row = VenueStaff.objects.get(venue=self.venue, user=self.admin)
        res = self.client.delete(f'/api/venues/{self.venue.pk}/staff/{row.pk}/')
        self.assertEqual(res.status_code, status.HTTP_409_CONFLICT)
        self.assertEqual(res.data['detail'], 'last_administrator')

    def test_only_platform_staff_creates_a_building(self):
        self.client.force_authenticate(self.admin)
        res = self.client.post(
            '/api/venues/', {'name': 'Pasteura 5', 'slug': 'pasteura-5'}, format='json'
        )
        self.assertEqual(res.status_code, status.HTTP_403_FORBIDDEN)
        self.client.force_authenticate(make_user('moderator', is_staff=True))
        res = self.client.post(
            '/api/venues/', {'name': 'Pasteura 5', 'slug': 'pasteura-5'}, format='json'
        )
        self.assertEqual(res.status_code, status.HTTP_201_CREATED)


class RoomTests(VenueTestCase):
    def setUp(self):
        self.venue = make_venue()
        self.admin = make_user('room-admin')
        VenueStaff.objects.create(venue=self.venue, user=self.admin, role='administrator')
        self.stranger = make_user('room-stranger')

    def test_a_non_administrator_cannot_add_a_room(self):
        self.client.force_authenticate(self.stranger)
        res = self.client.post(
            '/api/rooms/', {'venue_id': self.venue.pk, 'name': '1.01'}, format='json'
        )
        self.assertEqual(res.status_code, status.HTTP_403_FORBIDDEN)

    def test_more_chairs_than_the_fire_capacity_is_refused(self):
        self.client.force_authenticate(self.admin)
        res = self.client.post(
            '/api/rooms/',
            {'venue_id': self.venue.pk, 'name': '1.01', 'seated_capacity': 80, 'fire_capacity': 60},
            format='json',
        )
        self.assertEqual(res.status_code, status.HTTP_400_BAD_REQUEST)

    def test_a_partial_edit_is_checked_against_the_field_it_is_not_changing(self):
        room = make_room(self.venue, seated=40, fire=60)
        self.client.force_authenticate(self.admin)
        res = self.client.patch(f'/api/rooms/{room.pk}/', {'seated_capacity': 90}, format='json')
        self.assertEqual(res.status_code, status.HTTP_400_BAD_REQUEST)


class RoomBookingTests(VenueTestCase):
    def setUp(self):
        self.venue = make_venue()
        self.room = make_room(self.venue, seated=60, fire=90)
        self.admin = make_user('booking-admin')
        VenueStaff.objects.create(venue=self.venue, user=self.admin, role='administrator')
        self.organiser = make_user('organiser')
        self.event = make_event(self.organiser)
        self.stranger = make_user('booking-stranger')
        self.start = timezone.now() + timedelta(days=20)
        self.end = self.start + timedelta(hours=2)

    def _request_body(self, **over):
        body = {
            'event_id': self.event.pk,
            'room_id': self.room.pk,
            'starts_at': self.start.isoformat(),
            'ends_at': self.end.isoformat(),
            'expected_headcount': 50,
        }
        body.update(over)
        return body

    def test_a_stranger_cannot_book_a_room_for_somebody_elses_event(self):
        self.client.force_authenticate(self.stranger)
        res = self.client.post('/api/room-bookings/', self._request_body(), format='json')
        # 404, not 403: for them, that event's booking surface does not exist.
        self.assertEqual(res.status_code, status.HTTP_404_NOT_FOUND)

    def test_a_headcount_over_the_fire_capacity_is_refused_with_its_reason(self):
        self.client.force_authenticate(self.organiser)
        res = self.client.post(
            '/api/room-bookings/', self._request_body(expected_headcount=120), format='json'
        )
        self.assertEqual(res.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertEqual(res.data['detail'], 'over_fire_capacity')

    def test_asking_for_a_room_that_is_already_taken_is_refused_there_and_then(self):
        """An approved booking is a fact the organiser can already see, so telling them at the
        moment they ask is more use than letting them wait for a refusal."""
        other = make_event(make_user('other-host'), title='Kolokwium')
        RoomBooking.objects.create(
            event=other,
            room=self.room,
            starts_at=self.start + timedelta(minutes=30),
            ends_at=self.end,
            status='approved',
        )
        self.client.force_authenticate(self.organiser)
        res = self.client.post('/api/room-bookings/', self._request_body(), format='json')
        self.assertEqual(res.status_code, status.HTTP_409_CONFLICT)
        self.assertEqual(res.data['detail'], 'room_busy')

    def test_approval_re_checks_the_room_against_the_database(self):
        """Two organisers may both have asked for Thursday while it was free. The building is
        deciding the second one now, and the rule is re-asked at that moment — a check done only at
        request time would double-book the room."""
        self.client.force_authenticate(self.organiser)
        mine = self.client.post('/api/room-bookings/', self._request_body(), format='json')
        self.assertEqual(mine.status_code, status.HTTP_201_CREATED)
        other = make_event(make_user('faster-host'), title='Kolokwium')
        RoomBooking.objects.create(
            event=other,
            room=self.room,
            starts_at=self.start + timedelta(minutes=30),
            ends_at=self.end,
            status='approved',
        )
        self.client.force_authenticate(self.admin)
        res = self.client.post(f'/api/room-bookings/{mine.data["id"]}/approve/')
        self.assertEqual(res.status_code, status.HTTP_409_CONFLICT)
        self.assertEqual(res.data['detail'], 'room_busy')

    def test_back_to_back_bookings_do_not_collide(self):
        """A room handed over at 12:00 is free at 12:00 — a closed interval would refuse every
        back-to-back lecture in the timetable."""
        other = make_event(make_user('earlier-host'))
        RoomBooking.objects.create(
            event=other,
            room=self.room,
            starts_at=self.start - timedelta(hours=2),
            ends_at=self.start,
            status='approved',
        )
        self.assertIsNone(
            booking_block_reason(self.event, self.room, self.start, self.end, 10)
        )

    def test_a_non_venue_admin_cannot_decide_a_booking(self):
        booking = RoomBooking.objects.create(
            event=self.event, room=self.room, starts_at=self.start, ends_at=self.end
        )
        self.client.force_authenticate(self.organiser)
        res = self.client.post(f'/api/room-bookings/{booking.pk}/approve/')
        self.assertEqual(res.status_code, status.HTTP_403_FORBIDDEN)

    def test_deciding_twice_is_a_409(self):
        booking = RoomBooking.objects.create(
            event=self.event, room=self.room, starts_at=self.start, ends_at=self.end
        )
        self.client.force_authenticate(self.admin)
        self.assertEqual(
            self.client.post(f'/api/room-bookings/{booking.pk}/approve/').status_code,
            status.HTTP_200_OK,
        )
        again = self.client.post(f'/api/room-bookings/{booking.pk}/reject/')
        self.assertEqual(again.status_code, status.HTTP_409_CONFLICT)
        self.assertEqual(again.data['detail'], 'already_decided')

    def test_a_rejection_carries_the_buildings_own_words(self):
        booking = RoomBooking.objects.create(
            event=self.event, room=self.room, starts_at=self.start, ends_at=self.end
        )
        self.client.force_authenticate(self.admin)
        res = self.client.post(
            f'/api/room-bookings/{booking.pk}/reject/',
            {'note': 'Nie w sesji egzaminacyjnej.'},
            format='json',
        )
        self.assertEqual(res.data['status'], 'rejected')
        self.assertEqual(res.data['note'], 'Nie w sesji egzaminacyjnej.')

    def test_cancelling_is_a_state_not_a_delete(self):
        booking = RoomBooking.objects.create(
            event=self.event, room=self.room, starts_at=self.start, ends_at=self.end
        )
        self.client.force_authenticate(self.organiser)
        res = self.client.post(f'/api/room-bookings/{booking.pk}/cancel/')
        self.assertEqual(res.status_code, status.HTTP_200_OK)
        booking.refresh_from_db()
        self.assertEqual(booking.status, 'cancelled')

    def test_a_stranger_never_sees_the_booking_in_any_list(self):
        RoomBooking.objects.create(
            event=self.event, room=self.room, starts_at=self.start, ends_at=self.end
        )
        self.client.force_authenticate(self.stranger)
        self.assertEqual(self.client.get('/api/room-bookings/').data, [])
        self.assertEqual(
            self.client.get(f'/api/venues/{self.venue.pk}/bookings/').status_code,
            status.HTTP_403_FORBIDDEN,
        )


class ChecklistTests(VenueTestCase):
    def setUp(self):
        self.venue = make_venue()
        self.room = make_room(self.venue)
        self.admin = make_user('checklist-admin')
        VenueStaff.objects.create(venue=self.venue, user=self.admin, role='administrator')
        self.organiser = make_user('checklist-organiser')
        self.event = make_event(self.organiser)
        self.stranger = make_user('checklist-stranger')
        self.template = ChecklistTemplate.objects.create(venue=self.venue, name='Wykład')
        ChecklistTemplateItem.objects.create(
            template=self.template,
            title_en='Book the hall',
            title_pl='Rezerwacja sali',
            due_offset_minutes=-14 * 24 * 60,
            is_mandatory=True,
            order=0,
        )
        ChecklistTemplateItem.objects.create(
            template=self.template,
            title_en='Return the keys',
            title_pl='Zdanie kluczy',
            due_offset_minutes=60,
            anchor='end',
            is_mandatory=True,
            requires_venue_signoff=True,
            order=1,
        )
        ChecklistTemplateItem.objects.create(
            template=self.template,
            title_en='Order catering',
            title_pl='Zamówienie cateringu',
            due_offset_minutes=-3 * 24 * 60,
            is_mandatory=False,
            na_allowed=True,
            order=2,
        )

    def _instance(self):
        return instantiate(self.event, self.venue, self.template, created_by=self.organiser)

    def test_a_stranger_cannot_read_an_events_checklist(self):
        self._instance()
        self.client.force_authenticate(self.stranger)
        res = self.client.get(f'/api/events/{self.event.pk}/checklist/')
        self.assertEqual(res.status_code, status.HTTP_404_NOT_FOUND)

    def test_only_an_organiser_starts_one(self):
        self.client.force_authenticate(self.stranger)
        res = self.client.post(
            f'/api/events/{self.event.pk}/checklist/',
            {'template_id': self.template.pk},
            format='json',
        )
        self.assertEqual(res.status_code, status.HTTP_404_NOT_FOUND)

    def test_one_instance_per_event_and_venue(self):
        self._instance()
        self.client.force_authenticate(self.organiser)
        res = self.client.post(
            f'/api/events/{self.event.pk}/checklist/',
            {'template_id': self.template.pk},
            format='json',
        )
        self.assertEqual(res.status_code, status.HTTP_409_CONFLICT)
        self.assertEqual(res.data['detail'], 'already_started')

    def test_not_applicable_without_a_reason_is_refused(self):
        instance = self._instance()
        item = instance.items.get(order=2)
        self.client.force_authenticate(self.organiser)
        res = self.client.patch(
            f'/api/checklist-items/{item.pk}/', {'status': 'not_applicable'}, format='json'
        )
        self.assertEqual(res.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertEqual(res.data['detail'], 'na_reason_required')

    def test_not_applicable_on_an_item_the_building_did_not_allow_it_on(self):
        instance = self._instance()
        item = instance.items.get(order=0)
        self.client.force_authenticate(self.organiser)
        res = self.client.patch(
            f'/api/checklist-items/{item.pk}/',
            {'status': 'not_applicable', 'na_reason': 'Nie dotyczy.'},
            format='json',
        )
        self.assertEqual(res.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertEqual(res.data['detail'], 'na_not_allowed')

    def test_an_organiser_cannot_tick_an_item_the_building_signs_off(self):
        instance = self._instance()
        item = instance.items.get(order=1)
        self.client.force_authenticate(self.organiser)
        res = self.client.patch(
            f'/api/checklist-items/{item.pk}/', {'status': 'done'}, format='json'
        )
        self.assertEqual(res.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertEqual(res.data['detail'], 'needs_venue_signoff')
        # …but may say they are working on it.
        ok = self.client.patch(
            f'/api/checklist-items/{item.pk}/', {'status': 'in_progress'}, format='json'
        )
        self.assertEqual(ok.status_code, status.HTTP_200_OK)

    def test_sign_off_by_a_non_administrator_is_refused(self):
        instance = self._instance()
        item = instance.items.get(order=1)
        self.client.force_authenticate(self.organiser)
        res = self.client.post(f'/api/checklist-items/{item.pk}/sign-off/')
        self.assertEqual(res.status_code, status.HTTP_403_FORBIDDEN)

    def test_the_building_signs_an_item_off_and_it_becomes_done(self):
        instance = self._instance()
        item = instance.items.get(order=1)
        self.client.force_authenticate(self.admin)
        res = self.client.post(f'/api/checklist-items/{item.pk}/sign-off/')
        self.assertEqual(res.status_code, status.HTTP_200_OK)
        self.assertEqual(res.data['status'], 'done')
        self.assertEqual(res.data['signed_off_by']['id'], self.admin.pk)

    def test_signing_off_an_item_that_never_asked_for_one_is_refused(self):
        instance = self._instance()
        item = instance.items.get(order=0)
        self.client.force_authenticate(self.admin)
        res = self.client.post(f'/api/checklist-items/{item.pk}/sign-off/')
        self.assertEqual(res.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertEqual(res.data['detail'], 'no_signoff_needed')

    def test_the_instance_is_a_snapshot_a_later_template_edit_does_not_rewrite(self):
        instance = self._instance()
        ChecklistTemplateItem.objects.filter(template=self.template, order=0).update(
            title_en='Book the hall AND the foyer'
        )
        self.template.version = 2
        self.template.save(update_fields=['version'])
        self.assertEqual(instance.items.get(order=0).title_en, 'Book the hall')
        self.client.force_authenticate(self.organiser)
        res = self.client.get(f'/api/events/{self.event.pk}/checklist/')
        self.assertTrue(res.data[0]['template_has_new_items'])

    def test_sync_adds_the_new_items_and_touches_nothing_else(self):
        instance = self._instance()
        done = instance.items.get(order=2)
        done.status = 'done'
        done.save(update_fields=['status'])
        ChecklistTemplateItem.objects.create(
            template=self.template,
            title_en='Photograph the room afterwards',
            title_pl='Zdjęcia sali po wydarzeniu',
            due_offset_minutes=30,
            anchor='end',
            order=3,
        )
        self.template.version = 2
        self.template.save(update_fields=['version'])
        self.client.force_authenticate(self.organiser)
        res = self.client.post(f'/api/checklist-instances/{instance.pk}/sync/')
        self.assertEqual(res.status_code, status.HTTP_200_OK)
        self.assertEqual(res.data['added'], 1)
        self.assertEqual(instance.items.count(), 4)
        done.refresh_from_db()
        self.assertEqual(done.status, 'done')

    def test_due_dates_follow_the_event_when_it_moves(self):
        instance = self._instance()
        first = instance.items.get(order=0).computed_due_at
        self.event.starts_at = self.event.starts_at + timedelta(days=7)
        self.event.save(update_fields=['starts_at'])
        self.client.force_authenticate(self.organiser)
        self.client.get(f'/api/events/{self.event.pk}/checklist/')
        moved = ChecklistInstanceItem.objects.get(pk=instance.items.get(order=0).pk)
        self.assertEqual(moved.computed_due_at, first + timedelta(days=7))

    def test_an_end_anchored_item_is_measured_from_the_end_of_a_multi_day_event(self):
        self.event.runs_until = self.event.starts_at + timedelta(days=2)
        self.event.save(update_fields=['runs_until'])
        instance = self._instance()
        item = instance.items.get(order=1)
        self.assertEqual(item.computed_due_at, self.event.runs_until + timedelta(minutes=60))


class PublishBlockTests(VenueTestCase):
    """The one edit this step makes to `events` — `EventViewSet.update` asking
    `venues.access.publish_block_reason`."""

    def setUp(self):
        self.venue = make_venue()
        self.room = make_room(self.venue)
        self.organiser = make_user('publish-organiser')
        self.event = make_event(self.organiser, status='draft')
        self.template = ChecklistTemplate.objects.create(venue=self.venue, name='Wykład')
        ChecklistTemplateItem.objects.create(
            template=self.template,
            title_en='Book the hall',
            title_pl='Rezerwacja sali',
            is_mandatory=True,
            order=0,
        )
        self.client.force_authenticate(self.organiser)

    def _approve_a_room(self):
        RoomBooking.objects.create(
            event=self.event,
            room=self.room,
            starts_at=self.event.starts_at,
            ends_at=self.event.starts_at + timedelta(hours=2),
            status='approved',
        )

    def test_an_event_with_no_venue_publishes_exactly_as_before(self):
        res = self.client.patch(
            f'/api/events/{self.event.pk}/', {'status': 'published'}, format='json'
        )
        self.assertEqual(res.status_code, status.HTTP_200_OK)
        self.assertEqual(res.data['status'], 'published')

    def test_an_approved_room_with_a_pending_mandatory_item_blocks_publishing(self):
        self._approve_a_room()
        instantiate(self.event, self.venue, self.template)
        res = self.client.patch(
            f'/api/events/{self.event.pk}/', {'status': 'published'}, format='json'
        )
        self.assertEqual(res.status_code, status.HTTP_409_CONFLICT)
        self.assertEqual(res.data['detail'], 'checklist_pending')
        self.event.refresh_from_db()
        self.assertEqual(self.event.status, 'draft')

    def test_a_merely_requested_booking_blocks_nothing(self):
        RoomBooking.objects.create(
            event=self.event,
            room=self.room,
            starts_at=self.event.starts_at,
            ends_at=self.event.starts_at + timedelta(hours=2),
        )
        instantiate(self.event, self.venue, self.template)
        res = self.client.patch(
            f'/api/events/{self.event.pk}/', {'status': 'published'}, format='json'
        )
        self.assertEqual(res.status_code, status.HTTP_200_OK)

    def test_an_item_in_progress_does_not_block(self):
        self._approve_a_room()
        instance = instantiate(self.event, self.venue, self.template)
        instance.items.update(status='in_progress')
        self.assertIsNone(publish_block_reason(self.event))

    def test_the_block_lifts_when_the_item_is_done(self):
        self._approve_a_room()
        instance = instantiate(self.event, self.venue, self.template)
        instance.items.update(status='done')
        res = self.client.patch(
            f'/api/events/{self.event.pk}/', {'status': 'published'}, format='json'
        )
        self.assertEqual(res.status_code, status.HTTP_200_OK)

    def test_the_block_lifts_when_the_kill_switch_is_off(self):
        """House rule 3 read the strict way: a killed feature removes itself, it does not leave a
        lock behind on somebody else's surface."""
        self._approve_a_room()
        instantiate(self.event, self.venue, self.template)
        FeatureFlag.objects.update_or_create(key='venues', defaults={'is_enabled': False})
        self.assertIsNone(publish_block_reason(self.event))
        res = self.client.patch(
            f'/api/events/{self.event.pk}/', {'status': 'published'}, format='json'
        )
        self.assertEqual(res.status_code, status.HTTP_200_OK)


class KillSwitchTests(VenueTestCase):
    def setUp(self):
        self.venue = make_venue()
        self.room = make_room(self.venue)
        self.reader = make_user('flag-reader')
        FeatureFlag.objects.update_or_create(key='venues', defaults={'is_enabled': False})

    def test_with_the_switch_off_the_whole_venue_surface_closes(self):
        # Signed in as an ordinary account on purpose (e2e/CLAUDE.md trap 10 states the same rule
        # for the browser scripts): a staff-bypassed check proves nothing about a kill switch, and
        # an ANONYMOUS one would be answered 401 by DRF's own authentication layer before the gate
        # is ever consulted, which is a different sentence about a different thing.
        self.client.force_authenticate(self.reader)
        for path in (
            '/api/venues/',
            f'/api/venues/{self.venue.pk}/',
            '/api/rooms/',
            '/api/checklist-templates/',
        ):
            with self.subTest(path=path):
                self.assertEqual(
                    self.client.get(path).status_code, status.HTTP_403_FORBIDDEN, path
                )

    def test_a_moderator_still_reaches_it(self):
        self.client.force_authenticate(make_user('flag-moderator', is_staff=True))
        self.assertEqual(self.client.get('/api/venues/').status_code, status.HTTP_200_OK)

    def test_the_events_surface_keeps_working(self):
        host = make_user('flag-host')
        make_event(host, status='published', visibility='public')
        res = self.client.get('/api/events/')
        self.assertEqual(res.status_code, status.HTTP_200_OK)
        self.assertEqual(len(res.data), 1)


class SeededTemplateTests(VenueTestCase):
    def test_the_four_platform_defaults_are_there_and_bilingual(self):
        defaults = ChecklistTemplate.objects.filter(venue__isnull=True)
        self.assertEqual(defaults.count(), 4)
        for template in defaults:
            with self.subTest(template=template.name):
                self.assertGreater(template.items.count(), 0)
                for item in template.items.all():
                    self.assertTrue(item.title_en.strip())
                    self.assertTrue(item.title_pl.strip())

    def test_a_platform_default_needs_a_venue_named_when_it_is_instantiated(self):
        organiser = make_user('default-organiser')
        event = make_event(organiser)
        template = ChecklistTemplate.objects.filter(venue__isnull=True).first()
        self.client.force_authenticate(organiser)
        res = self.client.post(
            f'/api/events/{event.pk}/checklist/', {'template_id': template.pk}, format='json'
        )
        self.assertEqual(res.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertEqual(res.data['detail'], 'venue_required')

    def test_a_venue_lists_the_platform_defaults_alongside_its_own(self):
        venue = make_venue()
        ChecklistTemplate.objects.create(venue=venue, name='Nasza lista')
        res = self.client.get(f'/api/venues/{venue.pk}/templates/')
        self.assertEqual(res.status_code, status.HTTP_200_OK)
        self.assertEqual(len(res.data), 5)


class ChecklistReadAccessTests(VenueTestCase):
    """The building's own staff read the list too — it is their paperwork as much as the
    organiser's."""

    def setUp(self):
        self.venue = make_venue()
        self.admin = make_user('read-admin')
        VenueStaff.objects.create(venue=self.venue, user=self.admin, role='administrator')
        self.porter = make_user('read-porter')
        VenueStaff.objects.create(venue=self.venue, user=self.porter, role='porter')
        self.organiser = make_user('read-organiser')
        self.event = make_event(self.organiser)
        template = ChecklistTemplate.objects.create(venue=self.venue, name='Lista')
        ChecklistTemplateItem.objects.create(
            template=template, title_en='A', title_pl='A', order=0
        )
        self.instance = instantiate(self.event, self.venue, template)

    def test_the_buildings_porter_may_read_it(self):
        self.client.force_authenticate(self.porter)
        res = self.client.get(f'/api/events/{self.event.pk}/checklist/')
        self.assertEqual(res.status_code, status.HTTP_200_OK)
        self.assertEqual(len(res.data), 1)

    def test_a_porter_does_not_tick(self):
        item = self.instance.items.first()
        self.client.force_authenticate(self.porter)
        res = self.client.patch(
            f'/api/checklist-items/{item.pk}/', {'status': 'done'}, format='json'
        )
        self.assertEqual(res.status_code, status.HTTP_403_FORBIDDEN)

    def test_an_event_volunteer_may_read_but_a_stranger_may_not(self):
        volunteer = make_user('read-volunteer')
        EventStaff.objects.create(event=self.event, user=volunteer, role='volunteer')
        self.client.force_authenticate(volunteer)
        self.assertEqual(
            self.client.get(f'/api/events/{self.event.pk}/checklist/').status_code,
            status.HTTP_200_OK,
        )
        self.client.force_authenticate(make_user('read-nobody'))
        self.assertEqual(
            self.client.get(f'/api/events/{self.event.pk}/checklist/').status_code,
            status.HTTP_404_NOT_FOUND,
        )


class TemplateWriteTests(VenueTestCase):
    def setUp(self):
        self.venue = make_venue()
        self.admin = make_user('template-admin')
        VenueStaff.objects.create(venue=self.venue, user=self.admin, role='administrator')
        self.stranger = make_user('template-stranger')

    def test_a_stranger_cannot_write_a_buildings_template(self):
        self.client.force_authenticate(self.stranger)
        res = self.client.post(
            '/api/checklist-templates/',
            {'venue_id': self.venue.pk, 'name': 'Mine'},
            format='json',
        )
        self.assertEqual(res.status_code, status.HTTP_403_FORBIDDEN)

    def test_only_platform_staff_writes_a_platform_default(self):
        self.client.force_authenticate(self.admin)
        res = self.client.post('/api/checklist-templates/', {'name': 'New default'}, format='json')
        self.assertEqual(res.status_code, status.HTTP_403_FORBIDDEN)

    def test_replacing_the_items_bumps_the_version(self):
        self.client.force_authenticate(self.admin)
        created = self.client.post(
            '/api/checklist-templates/',
            {
                'venue_id': self.venue.pk,
                'name': 'Nasza',
                'items': [{'title_en': 'A', 'title_pl': 'A'}],
            },
            format='json',
        )
        self.assertEqual(created.status_code, status.HTTP_201_CREATED)
        self.assertEqual(created.data['version'], 1)
        res = self.client.patch(
            f'/api/checklist-templates/{created.data["id"]}/',
            {'items': [{'title_en': 'A', 'title_pl': 'A'}, {'title_en': 'B', 'title_pl': 'B'}]},
            format='json',
        )
        self.assertEqual(res.data['version'], 2)

    def test_renaming_the_template_does_not_bump_the_version(self):
        template = ChecklistTemplate.objects.create(venue=self.venue, name='Stara')
        self.client.force_authenticate(self.admin)
        res = self.client.patch(
            f'/api/checklist-templates/{template.pk}/', {'name': 'Nowa'}, format='json'
        )
        self.assertEqual(res.data['version'], 1)
