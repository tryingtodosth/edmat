"""Refusals first, as the brief asks: a stranger below a tier, an attendee below a tier, somebody
who may read but not write, a file that is not what it says it is, a file that is too big, an
acknowledgement of text that has been superseded, and a door that stays shut until the briefing is
read. Then the things that must still work — including with the kill switch off.

CONFERENCE-BRIEF.md §3.C.
"""

import base64
import io
import shutil
import tempfile

from datetime import timedelta

from django.core.files.uploadedfile import SimpleUploadedFile
from django.test import override_settings
from django.urls import reverse
from django.utils import timezone
from rest_framework.test import APIClient, APITestCase

from events.models import Event, EventStaff
from venues.models import Room, RoomBooking, Venue, VenueStaff
from moderation.models import FeatureFlag
from telemetry.routers import all_log_shards
from testing.factories import make_user

from . import access
from .models import DocumentAcknowledgement, EventDocument

# A real 1x1 PNG — libmagic has to agree it is a PNG before `imaging.py` will decode it.
PNG = base64.b64decode(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII='
)
PDF = b'%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF'


def as_(user):
    c = APIClient()
    c.force_authenticate(user)
    return c


class DocumentCase(APITestCase):
    """Its own temporary MEDIA_ROOT per class, the arrangement `sketches/tests.py` and
    `galleries/tests.py` already use, so a run never leaves files under `media/event-documents/`."""

    databases = set(all_log_shards()) | {'default'}

    @classmethod
    def setUpClass(cls):
        cls._media_root = tempfile.mkdtemp(prefix='edmat-documents-test-')
        cls._override = override_settings(MEDIA_ROOT=cls._media_root)
        cls._override.enable()
        super().setUpClass()

    @classmethod
    def tearDownClass(cls):
        super().tearDownClass()
        cls._override.disable()
        shutil.rmtree(cls._media_root, ignore_errors=True)

    def setUp(self):
        self.host = make_user('doc-host')
        self.volunteer = make_user('doc-volunteer')
        self.attendee = make_user('doc-attendee')
        self.stranger = make_user('doc-stranger')
        self.event = Event.objects.create(
            host=self.host, title='Conference', status='published', visibility='public',
            starts_at=timezone.now() + timedelta(days=3), duration_minutes=240,
            location_kind='onsite', location_text='Room 1',
        )
        EventStaff.objects.create(event=self.event, user=self.volunteer, role='volunteer')
        self.event.attendances.create(attendee=self.attendee, status='going')
        self.list_url = reverse('event-documents', args=[self.event.pk])

    def make_document(self, **over):
        fields = dict(
            event=self.event, title='Fire plan', kind='link', url='https://example.org/plan',
            visibility='staff', uploaded_by=self.host,
        )
        fields.update(over)
        return EventDocument.objects.create(**fields)

    def upload(self, client, *, name='plan.pdf', data=PDF, **over):
        payload = {
            'title': 'Uploaded plan',
            'kind': 'file',
            'visibility': 'staff',
            'file': SimpleUploadedFile(name, data),
        }
        payload.update(over)
        return client.post(self.list_url, payload, format='multipart')


class VenueTierTests(DocumentCase):
    """Integration with step A (CONFERENCE-BRIEF.md §5): the `venue` tier answers to the
    administrators of the building the event has an APPROVED booking with — nobody else, and not
    before the building has said yes."""

    def setUp(self):
        super().setUp()
        self.venue_admin = make_user('doc-venue-admin')
        self.porter = make_user('doc-porter')
        venue = Venue.objects.create(name='Pasteura 5', slug='pasteura-5')
        VenueStaff.objects.create(venue=venue, user=self.venue_admin, role='administrator',
                                  added_by=self.venue_admin)
        VenueStaff.objects.create(venue=venue, user=self.porter, role='porter',
                                  added_by=self.venue_admin)
        self.room = Room.objects.create(venue=venue, name='Aula', seated_capacity=100,
                                        fire_capacity=150)
        self.booking = RoomBooking.objects.create(
            event=self.event, room=self.room, starts_at=self.event.starts_at,
            ends_at=self.event.starts_at + timedelta(hours=4), requested_by=self.host,
        )
        self.doc = self.make_document(title='Umowa najmu', visibility='venue')

    def titles(self, user):
        response = as_(user).get(self.list_url)
        self.assertEqual(response.status_code, 200)
        return {row['title'] for row in response.data}

    def test_a_requested_booking_grants_nothing_yet(self):
        self.assertNotIn('Umowa najmu', self.titles(self.venue_admin))

    def test_an_approved_booking_opens_the_tier_to_the_administrator_only(self):
        self.booking.status = 'approved'
        self.booking.save(update_fields=['status'])
        self.assertIn('Umowa najmu', self.titles(self.venue_admin))
        self.assertNotIn('Umowa najmu', self.titles(self.porter))
        self.assertNotIn('Umowa najmu', self.titles(self.volunteer))
        self.assertIn('Umowa najmu', self.titles(self.host))


class TierRefusalTests(DocumentCase):
    def test_a_stranger_does_not_see_a_staff_document_at_all(self):
        document = self.make_document()
        rows = as_(self.stranger).get(self.list_url).json()
        self.assertEqual(rows, [])
        self.assertEqual(as_(self.stranger).get(reverse('event-document-detail', args=[document.pk])).status_code, 404)

    def test_a_stranger_gets_404_on_the_file_of_a_staff_document(self):
        document = self.make_document(kind='file', file=SimpleUploadedFile('a.pdf', PDF), content_type='application/pdf')
        url = reverse('event-document-file', args=[document.pk])
        self.assertEqual(as_(self.stranger).get(url).status_code, 404)
        self.assertEqual(self.client.get(url).status_code, 404)  # anonymous

    def test_an_attendee_cannot_read_an_organisers_document(self):
        document = self.make_document(visibility='organisers', title='Budget')
        self.assertEqual(as_(self.attendee).get(reverse('event-document-detail', args=[document.pk])).status_code, 404)
        titles = [row['title'] for row in as_(self.attendee).get(self.list_url).json()]
        self.assertNotIn('Budget', titles)

    def test_the_venue_tier_is_organisers_only_until_step_a_wires_the_hook(self):
        document = self.make_document(visibility='venue', title='Access arrangements')
        self.assertEqual(as_(self.volunteer).get(reverse('event-document-detail', args=[document.pk])).status_code, 404)
        self.assertEqual(as_(self.host).get(reverse('event-document-detail', args=[document.pk])).status_code, 200)

    def test_the_venue_hook_is_a_real_seam_not_a_decoration(self):
        # Proves the integration point works: point `venue_admin_check` at something that says yes,
        # and the tier opens for exactly that person and nobody else.
        document = self.make_document(visibility='venue')
        original = access.venue_admin_check
        try:
            access.venue_admin_check = lambda user, event: user.pk == self.stranger.pk
            self.assertEqual(as_(self.stranger).get(reverse('event-document-detail', args=[document.pk])).status_code, 200)
            self.assertEqual(as_(self.attendee).get(reverse('event-document-detail', args=[document.pk])).status_code, 404)
        finally:
            access.venue_admin_check = original

    def test_a_draft_events_public_document_does_not_exist_for_a_stranger(self):
        self.event.status = 'draft'
        self.event.save(update_fields=['status'])
        self.make_document(visibility='public')
        self.assertEqual(as_(self.stranger).get(self.list_url).status_code, 404)


class WriteRefusalTests(DocumentCase):
    def test_a_volunteer_cannot_upload(self):
        self.assertEqual(self.upload(as_(self.volunteer)).status_code, 403)

    def test_an_attendee_cannot_upload(self):
        self.assertEqual(self.upload(as_(self.attendee)).status_code, 403)

    def test_a_volunteer_cannot_retire_or_edit_a_document(self):
        document = self.make_document()
        url = reverse('event-document-detail', args=[document.pk])
        self.assertEqual(as_(self.volunteer).patch(url, {'title': 'Mine now'}, format='json').status_code, 403)
        self.assertEqual(as_(self.volunteer).delete(url).status_code, 403)

    def test_a_link_document_may_not_also_carry_a_file(self):
        r = as_(self.host).post(
            self.list_url,
            {'title': 'Both', 'kind': 'link', 'url': 'https://x.org', 'visibility': 'staff',
             'file': SimpleUploadedFile('a.pdf', PDF)},
            format='multipart',
        )
        self.assertEqual(r.status_code, 400, r.content)


class UploadSafetyTests(DocumentCase):
    def test_a_text_file_is_refused_by_name(self):
        r = self.upload(as_(self.host), name='notes.txt', data=b'just some notes, honestly\n' * 20)
        self.assertEqual(r.status_code, 400, r.content)
        self.assertIn('PDF', str(r.content))

    def test_a_script_renamed_as_a_pdf_is_refused(self):
        r = self.upload(as_(self.host), name='plan.pdf', data=b'#!/bin/bash\nrm -rf /\n')
        self.assertEqual(r.status_code, 400, r.content)

    def test_an_oversized_file_is_refused(self):
        from .files import MAX_DOCUMENT_BYTES

        r = self.upload(as_(self.host), name='huge.pdf', data=b'%PDF-1.4\n' + b'0' * MAX_DOCUMENT_BYTES)
        self.assertEqual(r.status_code, 400, r.content)

    def test_a_polyglot_image_loses_its_payload_because_the_bytes_are_never_stored(self):
        """A real PNG with a zip appended — a file that is honestly an image AND honestly an
        archive, so no sniff can refuse it. House rule 7's answer is not to ask: the picture is
        rebuilt from decoded pixels and every byte that was not pixel data is gone."""
        polyglot = PNG + b'PK\x03\x04' + b'EDMAT-PAYLOAD-MARKER' * 8
        r = self.upload(as_(self.host), name='poster.png', data=polyglot)
        self.assertEqual(r.status_code, 201, r.content)
        document = EventDocument.objects.get(pk=r.json()['id'])
        self.assertEqual(document.content_type, 'image/webp')
        self.assertTrue(document.file.name.endswith('.webp'))
        with document.file.open('rb') as fh:
            stored = fh.read()
        self.assertNotIn(b'EDMAT-PAYLOAD-MARKER', stored)
        self.assertTrue(stored.startswith(b'RIFF'))

    def test_the_uploaders_own_filename_is_never_the_stored_name(self):
        r = self.upload(as_(self.host), name='../../etc/passwd.pdf')
        self.assertEqual(r.status_code, 201, r.content)
        document = EventDocument.objects.get(pk=r.json()['id'])
        self.assertNotIn('passwd', document.file.name)
        self.assertTrue(document.file.name.startswith('event-documents/'))

    def test_a_scan_that_could_not_run_is_recorded_as_not_scanned(self):
        r = self.upload(as_(self.host))
        self.assertEqual(r.status_code, 201, r.content)
        self.assertFalse(r.json()['scanned'])  # honest: no clamd here, never "clean"

    @override_settings(MATERIAL_SCAN_REQUIRED=True)
    def test_a_deployment_that_requires_a_scan_refuses_when_none_can_run(self):
        self.assertEqual(self.upload(as_(self.host)).status_code, 400)


class ServingTests(DocumentCase):
    def test_the_file_endpoint_carries_the_type_and_a_safe_attachment_name(self):
        r = self.upload(as_(self.host), title='Plan ewakuacji "A"')
        document = EventDocument.objects.get(pk=r.json()['id'])
        response = as_(self.volunteer).get(reverse('event-document-file', args=[document.pk]))
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response['Content-Type'], 'application/pdf')
        self.assertEqual(response['X-Content-Type-Options'], 'nosniff')
        disposition = response['Content-Disposition']
        self.assertTrue(disposition.startswith('attachment; '))
        self.assertIn('filename="plan-ewakuacji-a.pdf"', disposition)
        self.assertNotIn('\n', disposition)

    def test_the_api_never_hands_out_a_media_url(self):
        r = self.upload(as_(self.host))
        self.assertEqual(r.json()['file_url'], f'/documents/{r.json()["id"]}/file/')
        self.assertNotIn('/media/', str(r.content))


class AcknowledgementTests(DocumentCase):
    def test_acknowledging_a_superseded_version_is_refused_with_409(self):
        old = self.make_document(requires_acknowledgement=True)
        replacement = self.make_document(title='Fire plan', version=2, requires_acknowledgement=True)
        old.replaced_by = replacement
        old.save(update_fields=['replaced_by'])
        r = as_(self.volunteer).post(reverse('event-document-acknowledge', args=[old.pk]))
        self.assertEqual(r.status_code, 409, r.content)
        self.assertEqual(r.json()['detail'], 'superseded')
        self.assertEqual(r.json()['document'], replacement.pk)

    def test_acknowledging_a_withdrawn_document_is_refused(self):
        document = self.make_document(requires_acknowledgement=True, removed_at=timezone.now())
        self.assertEqual(as_(self.volunteer).post(reverse('event-document-acknowledge', args=[document.pk])).status_code, 409)

    def test_a_document_below_your_tier_cannot_be_acknowledged(self):
        document = self.make_document(visibility='organisers', requires_acknowledgement=True)
        self.assertEqual(as_(self.attendee).post(reverse('event-document-acknowledge', args=[document.pk])).status_code, 404)

    def test_acknowledging_twice_is_one_row(self):
        document = self.make_document(requires_acknowledgement=True)
        url = reverse('event-document-acknowledge', args=[document.pk])
        self.assertEqual(as_(self.volunteer).post(url).status_code, 200)
        self.assertEqual(as_(self.volunteer).post(url).status_code, 200)
        self.assertEqual(DocumentAcknowledgement.objects.filter(document=document, user=self.volunteer).count(), 1)

    def test_a_replacement_makes_an_old_acknowledgement_stop_counting(self):
        document = self.make_document(requires_acknowledgement=True)
        as_(self.volunteer).post(reverse('event-document-acknowledge', args=[document.pk]))
        self.assertEqual(access.missing_acknowledgements(self.volunteer, self.event), [])
        r = as_(self.host).post(
            reverse('event-document-replace', args=[document.pk]),
            {'file': SimpleUploadedFile('v2.pdf', PDF), 'kind': 'file'},
            format='multipart',
        )
        self.assertEqual(r.status_code, 201, r.content)
        self.assertEqual(r.json()['version'], 2)
        document.refresh_from_db()
        self.assertEqual(document.replaced_by_id, r.json()['id'])
        self.assertEqual(
            [d.pk for d in access.missing_acknowledgements(self.volunteer, self.event)],
            [r.json()['id']],
        )
        # The old receipt is kept, attached to the version it was actually made about (house rule 12).
        self.assertTrue(DocumentAcknowledgement.objects.filter(document=document, version=1).exists())

    def test_the_read_receipt_table_names_who_has_not_read_it(self):
        document = self.make_document(requires_acknowledgement=True)  # staff tier
        as_(self.volunteer).post(reverse('event-document-acknowledge', args=[document.pk]))
        rows = as_(self.host).get(reverse('event-acknowledgements', args=[self.event.pk])).json()
        by_user = {row['user']['id']: row for row in rows}
        self.assertFalse(by_user[self.volunteer.pk]['outstanding'])
        self.assertTrue(by_user[self.host.pk]['outstanding'])
        self.assertNotIn(self.attendee.pk, by_user)  # a staff document is not owed by an attendee

    def test_the_read_receipt_table_is_organisers_only(self):
        url = reverse('event-acknowledgements', args=[self.event.pk])
        self.assertEqual(as_(self.volunteer).get(url).status_code, 403)
        self.assertEqual(as_(self.attendee).get(url).status_code, 403)


class BriefingGateTests(DocumentCase):
    def setUp(self):
        super().setUp()
        self.row = self.event.attendances.get(attendee=self.attendee)
        self.checkin_url = reverse('event-registration-checkin', args=[self.event.pk, self.row.pk])

    def test_check_in_is_refused_until_the_briefing_is_acknowledged_then_allowed(self):
        document = self.make_document(requires_acknowledgement=True)
        r = as_(self.volunteer).post(self.checkin_url)
        self.assertEqual(r.status_code, 409, r.content)
        self.assertEqual(r.json()['detail'], 'briefing_unread')
        self.assertEqual(r.json()['documents'], [document.pk])
        self.assertEqual(r.json()['titles'], ['Fire plan'])
        self.row.refresh_from_db()
        self.assertIsNone(self.row.checked_in_at)

        self.assertEqual(as_(self.volunteer).post(reverse('event-document-acknowledge', args=[document.pk])).status_code, 200)
        self.assertEqual(as_(self.volunteer).post(self.checkin_url).status_code, 200)
        self.row.refresh_from_db()
        self.assertIsNotNone(self.row.checked_in_at)

    def test_a_document_that_is_not_mandatory_blocks_nobody(self):
        self.make_document(requires_acknowledgement=False)
        self.assertEqual(as_(self.volunteer).post(self.checkin_url).status_code, 200)

    def test_a_document_the_volunteer_cannot_see_does_not_lock_them_out(self):
        self.make_document(visibility='organisers', requires_acknowledgement=True)
        self.assertEqual(as_(self.volunteer).post(self.checkin_url).status_code, 200)

    def test_a_withdrawn_briefing_stops_blocking(self):
        self.make_document(requires_acknowledgement=True, removed_at=timezone.now())
        self.assertEqual(as_(self.volunteer).post(self.checkin_url).status_code, 200)


class KillSwitchTests(DocumentCase):
    """House rule 3: with the flag off the endpoints close to an ordinary caller, and — the part
    that is easy to miss — the neighbouring surface keeps working exactly as it did before."""

    def setUp(self):
        super().setUp()
        FeatureFlag.objects.update_or_create(key='event_documents', defaults={'is_enabled': False})

    def tearDown(self):
        FeatureFlag.objects.filter(key='event_documents').update(is_enabled=True)
        super().tearDown()

    def test_the_documents_endpoints_are_closed_to_a_non_staff_caller(self):
        document = self.make_document()
        self.assertEqual(as_(self.host).get(self.list_url).status_code, 403)
        self.assertEqual(as_(self.volunteer).get(reverse('event-document-detail', args=[document.pk])).status_code, 403)
        self.assertEqual(as_(self.volunteer).post(reverse('event-document-acknowledge', args=[document.pk])).status_code, 403)

    def test_check_in_works_exactly_as_before(self):
        self.make_document(requires_acknowledgement=True)
        row = self.event.attendances.get(attendee=self.attendee)
        r = as_(self.volunteer).post(reverse('event-registration-checkin', args=[self.event.pk, row.pk]))
        self.assertEqual(r.status_code, 200, r.content)

    def test_a_platform_moderator_still_reaches_a_killed_feature(self):
        self.make_document()
        staff = make_user('doc-moderator', is_staff=True)
        self.assertEqual(as_(staff).get(self.list_url).status_code, 200)


class VisibilityLadderTests(DocumentCase):
    def test_each_tier_sees_everything_under_it(self):
        for tier in ('public', 'attendees', 'staff', 'organisers'):
            self.make_document(visibility=tier, title=f'{tier} note')
        seen = lambda user: sorted(row['visibility'] for row in as_(user).get(self.list_url).json())
        self.assertEqual(seen(self.stranger), ['public'])
        self.assertEqual(seen(self.attendee), ['attendees', 'public'])
        self.assertEqual(seen(self.volunteer), ['attendees', 'public', 'staff'])
        self.assertEqual(seen(self.host), ['attendees', 'organisers', 'public', 'staff'])
        self.assertEqual(
            sorted(row['visibility'] for row in self.client.get(self.list_url).json()), ['public']
        )

    def test_a_promoted_seat_holder_counts_as_an_attendee(self):
        promoted = make_user('doc-promoted')
        self.event.attendances.create(attendee=promoted, status='promoted')
        self.make_document(visibility='attendees')
        self.assertEqual(len(as_(promoted).get(self.list_url).json()), 1)

    def test_somebody_who_declined_is_not_an_attendee(self):
        declined = make_user('doc-declined')
        self.event.attendances.create(attendee=declined, status='not_going')
        self.make_document(visibility='attendees')
        self.assertEqual(as_(declined).get(self.list_url).json(), [])


class LifecycleTests(DocumentCase):
    def test_a_delete_is_a_tombstone_and_the_row_survives(self):
        document = self.make_document()
        self.assertEqual(as_(self.host).delete(reverse('event-document-detail', args=[document.pk])).status_code, 204)
        document.refresh_from_db()
        self.assertIsNotNone(document.removed_at)
        self.assertEqual(document.removed_by_id, self.host.pk)
        self.assertEqual(as_(self.volunteer).get(self.list_url).json(), [])

    def test_an_organiser_can_move_a_document_between_tiers(self):
        document = self.make_document(visibility='organisers')
        r = as_(self.host).patch(
            reverse('event-document-detail', args=[document.pk]), {'visibility': 'staff'}, format='json'
        )
        self.assertEqual(r.status_code, 200, r.content)
        self.assertEqual(len(as_(self.volunteer).get(self.list_url).json()), 1)

    def test_an_invented_tier_is_refused(self):
        document = self.make_document()
        r = as_(self.host).patch(
            reverse('event-document-detail', args=[document.pk]), {'visibility': 'everyone'}, format='json'
        )
        self.assertEqual(r.status_code, 400, r.content)

    def test_a_link_document_has_no_file_url(self):
        document = self.make_document()
        body = as_(self.volunteer).get(reverse('event-document-detail', args=[document.pk])).json()
        self.assertIsNone(body['file_url'])
        self.assertEqual(as_(self.volunteer).get(reverse('event-document-file', args=[document.pk])).status_code, 404)
