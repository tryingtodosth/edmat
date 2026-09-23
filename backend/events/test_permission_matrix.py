"""The events permission matrix — one declarative table, one test, one row per (persona, method,
path, body, expected status). CONFERENCE-BRIEF.md §3.B.

WHY A TABLE. The alternative is a hundred small tests, each of which says one true thing and none
of which says what the *shape* is. A table can be read down a column: "here is everything a
volunteer may not do", which is the question somebody actually has. It is also the shape that
survives new endpoints — adding one is adding rows, not writing a new file.

    ┌──────────── HOW TO ADD YOUR ROWS (steps A, C, D, E, F, G — at integration) ───────────┐
    │ Append a block to MATRIX below, with your step's letter in the comment heading. Use  │
    │ the ids `setUpTestData` already publishes (`event`, `draft`, `session`, `attendance`, │
    │ `contribution`, `staff_volunteer`, …) and add your own there if you need more. The    │
    │ personas come from `testing/personas.make_personas()`, so your rows and the seed      │
    │ command are talking about the same seven accounts. Every endpoint your step adds      │
    │ needs at least: the role that may (a 2xx), one staff role that may not (403), a       │
    │ stranger (403 or 404), and anonymous (401 for a write, or 404 on a draft).            │
    └───────────────────────────────────────────────────────────────────────────────────────┘

The three shapes this file exists to pin, and why each one is that status and not another
(root `CLAUDE.md`, house rule 4):

* A **stranger** poking at a draft gets **404**, never 403 — for them it does not exist, and
  saying "forbidden" would confirm that something is there.
* An **attendee** asking for a staff list gets **403**: the event is visible to them, the
  registration list is not. Real thing, wrong party.
* A **volunteer** asking to decide a contribution gets **403** even though they are staff: a role
  is not a ladder. This is the row that would have caught a `is_staff_member` check written where
  a `role_of(...) in (...)` check was meant.

Each row runs inside its own savepoint which is then rolled back, so a row that writes cannot
change what a later row sees. That is what makes the table order-independent and therefore
honestly readable — without it, "organiser may DELETE this session" quietly breaks the next four
rows that address the same session.
"""

import shutil
import tempfile
from datetime import timedelta

from django.core.files.base import ContentFile
from django.db import transaction
from django.test import override_settings
from django.utils import timezone
from rest_framework.test import APITestCase

from cloakroom.models import CloakroomDesk
from documents.models import DocumentAcknowledgement, EventDocument
from shifts.models import Assignment, Shift, Station, VolunteerRecord
from testing.factories import make_branch, make_user
from testing.personas import make_personas
from venues import services as venue_services
from venues.models import (
    ChecklistTemplate,
    ChecklistTemplateItem,
    Room,
    RoomBooking,
    Venue,
    VenueStaff,
)

from .exports import log_export
from .models import Contribution, Event, EventAttendance, EventStaff

#: A four-line PDF, so the one `file` document in the fixture has real bytes for
#: `GET /documents/{id}/file/` to stream. Written straight to storage rather than through the
#: upload endpoint: this file is about who may fetch it, and `documents/tests.py` already owns the
#: question of what may be uploaded in the first place.
_PDF = b'%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF'


class _Rollback(Exception):
    """Raised at the end of every row to undo whatever that row wrote. Never escapes the loop."""


class PermissionMatrixTests(APITestCase):
    """One test method, driven by MATRIX through `subTest` — a failing row names itself and the
    rest still run, which is the whole reason not to write this as a hundred methods."""

    @classmethod
    def setUpClass(cls):
        """Its own temporary MEDIA_ROOT, the arrangement `documents/tests.py` uses — one fixture
        document carries real bytes, and a test run must not leave them under `media/`."""
        cls._media_root = tempfile.mkdtemp(prefix='edmat-matrix-test-')
        cls._override = override_settings(MEDIA_ROOT=cls._media_root)
        cls._override.enable()
        super().setUpClass()

    @classmethod
    def tearDownClass(cls):
        super().tearDownClass()
        cls._override.disable()
        shutil.rmtree(cls._media_root, ignore_errors=True)

    @classmethod
    def setUpTestData(cls):
        built = make_personas()
        cls.people = {
            'stranger': built['stranger'],
            'attendee': built['attendee'],
            'guardian': built['guardian'],
            'child': built['child'],
            'volunteer': built['volunteer'],
            'reviewer': built['reviewer'],
            'organiser': built['organiser'],
        }
        event = built['event']
        organiser = built['organiser']

        # A draft nobody but its host can see — the 404 column.
        draft = Event.objects.create(
            host=organiser, title='Sandbox draft', status='draft', visibility='private',
            starts_at=event.starts_at, duration_minutes=60, audience='university',
        )
        # A published event whose roster its organiser has NOT made public — so the difference
        # between "the organiser chose to publish a masked list" and "the roster is private" is a
        # row rather than an assumption.
        closed = Event.objects.create(
            host=organiser, title='Sandbox, roster closed', status='published', visibility='public',
            starts_at=event.starts_at, duration_minutes=60, audience='university',
            show_attendees_publicly=False,
        )
        # A `pending` row for the accept/decline endpoint, which refuses anything else (409
        # `not_pending`) — the matrix is about who may, so the row it acts on has to be decidable.
        pending = EventAttendance.objects.create(
            event=event, attendee=built['stranger'], status='pending'
        )
        # An already-accepted proposal, so "the organiser may schedule" is a 200 rather than the
        # 409 an un-accepted one would honestly give.
        accepted = Contribution.objects.create(
            event=event, submitter=built['stranger'], title='An accepted talk',
            kind='talk', audience='university', status='accepted', submitted_at=timezone.now(),
        )
        branch = make_branch('macierze')

        # ---- the conference layer (CONFERENCE-BRIEF.md §3.A, C, E, F, G) ------------------------
        #
        # TWO EXTRA PEOPLE, and they are built HERE rather than in `make_personas()`.
        #
        # `venue_admin` runs a building. A building is not part of the demo seven: adding it to
        # `make_personas` would make `seed_conference_personas` (and the browser script that signs
        # in as its accounts) depend on four more apps and four more kill switches, and
        # `CAPABILITY_TABLE` would grow a row about a surface the event page does not show. The
        # table needs the persona; the demo does not, so it lives with the table that needs it.
        #
        # `clerk` exists for exactly one row: a desk write refused with 409 `briefing_unread`. The
        # volunteer cannot carry that row, because the volunteer is the persona the check-in rows
        # above assert a 200 for — one unread mandatory document would turn every one of those into
        # the same 409, and the briefing rule is not about who somebody is.
        venue_admin = make_user('persona.venue_admin')
        clerk = make_user('persona.clerk')
        EventStaff.objects.create(event=event, user=clerk, role='volunteer', added_by=organiser)
        cls.people['venue_admin'] = venue_admin
        cls.people['clerk'] = clerk

        # A. A building, a room, the room it was actually given, and one it is still waiting on.
        venue = Venue.objects.create(
            name='Banacha 2', slug='sandbox-banacha-2', address='ul. Banacha 2, Warszawa'
        )
        venue_staff = VenueStaff.objects.create(
            venue=venue, user=venue_admin, role='administrator'
        )
        room = Room.objects.create(
            venue=venue, name='4070', seated_capacity=60, fire_capacity=90
        )
        booking = RoomBooking.objects.create(
            event=event, room=room, status='approved',
            starts_at=event.starts_at, ends_at=event.starts_at + timedelta(hours=8),
            expected_headcount=40, requested_by=organiser, decided_by=venue_admin,
            decided_at=timezone.now(),
        )
        # A second, still-undecided request, so approve/reject are 200s rather than the honest 409
        # an already-decided booking gives. A different week, so approving it cannot find itself
        # busy against the approved one above.
        asked = RoomBooking.objects.create(
            event=event, room=room, status='requested',
            starts_at=event.starts_at + timedelta(days=7),
            ends_at=event.starts_at + timedelta(days=7, hours=4),
            expected_headcount=30, requested_by=organiser,
        )
        template = ChecklistTemplate.objects.create(venue=venue, name='Sandbox handover')
        # `requires_venue_signoff` on the one item on purpose: it is the only flag that makes the
        # organiser and the building's administrator answer DIFFERENTLY to the same PATCH, which is
        # the whole reason the flag exists.
        ChecklistTemplateItem.objects.create(
            template=template, title_en='Keys back to the porter', title_pl='Zdanie kluczy',
            requires_venue_signoff=True, is_mandatory=True, order=0,
        )
        instance = venue_services.instantiate(event, venue, template, created_by=organiser)
        checklist_item = instance.items.get()

        # C. One document at every tier, and exactly one of them mandatory.
        documents = {}
        for tier in ('attendees', 'staff', 'organisers', 'venue'):
            documents[tier] = EventDocument.objects.create(
                event=event, title=f'Sandbox {tier} note', kind='link',
                url=f'https://example.org/{tier}', visibility=tier, uploaded_by=organiser,
                requires_acknowledgement=(tier == 'staff'),
            )
        documents['public'] = EventDocument.objects.create(
            event=event, title='Programme', kind='file', visibility='public',
            uploaded_by=organiser, content_type='application/pdf', byte_size=len(_PDF),
        )
        documents['public'].file.save('programme.pdf', ContentFile(_PDF), save=True)
        # Everybody who holds the staff tier has read the briefing EXCEPT `clerk` — see above.
        for reader in (organiser, built['reviewer'], built['volunteer']):
            DocumentAcknowledgement.objects.create(
                document=documents['staff'], user=reader, version=documents['staff'].version
            )

        # E. The rota: a cloakroom station whose shift is worked, and an info station whose shift is
        # still open. A day apart, so `MIN_GAP` and the overlap rule are not what a claim row is
        # about.
        cloak_station = Station.objects.create(
            event=event, kind='cloakroom', name='Szatnia', location_text='Hol północny'
        )
        info_station = Station.objects.create(
            event=event, kind='info', name='Punkt informacyjny',
            location_text='Hol główny', order=1,
        )
        cloak_shift = Shift.objects.create(
            station=cloak_station, starts_at=event.starts_at,
            ends_at=event.starts_at + timedelta(hours=4), needed=2,
        )
        open_shift = Shift.objects.create(
            station=info_station, starts_at=event.starts_at + timedelta(days=1),
            ends_at=event.starts_at + timedelta(days=1, hours=3), needed=2,
        )
        volunteer_assignment = Assignment.objects.create(
            shift=cloak_shift, user=built['volunteer'], status='confirmed', source='self',
            confirmed_at=timezone.now(),
        )
        Assignment.objects.create(
            shift=cloak_shift, user=clerk, status='confirmed', source='organiser',
            confirmed_by=organiser, confirmed_at=timezone.now(),
        )
        # CLAIMED, not confirmed — which is what makes the reviewer's 403 at the cloakroom counter
        # a statement about `holds_station_assignment` rather than about being staff.
        reviewer_claim = Assignment.objects.create(
            shift=open_shift, user=built['reviewer'], status='claimed', source='self',
        )
        record = VolunteerRecord.objects.create(
            event=event, user=built['volunteer'], consent_recorded_at=timezone.now(),
            consent_recorded_by=organiser,
        )

        # F. A desk with one coat on it.
        desk = CloakroomDesk.objects.create(
            event=event, name='Szatnia — wejście północne', rack_labels=['1', '2', '3'],
            opens_note='Czynna od 09:00', created_by=organiser,
        )
        coat = desk.items.create(
            rack_label='1', token=desk.new_token(), description='Czarny płaszcz',
            deposited_by=built['volunteer'],
        )

        # G. Something for the export log to have in it.
        log_export(event, organiser, 'full_csv', 12)

        cls.ids = {
            'event': event.pk,
            'draft': draft.pk,
            'closed': closed.pk,
            'session': built['sessions'][0].pk,
            'track': built['track'].pk,
            'attendance': built['attendance'].pk,
            'pending': pending.pk,
            'contribution': built['contribution'].pk,
            'accepted': accepted.pk,
            'staff_volunteer': event.staff.get(user=built['volunteer']).pk,
            'staff_host': event.staff.get(user=organiser).pk,
            'stranger_id': built['stranger'].pk,
            'child_id': built['child'].pk,
            'branch': branch.slug,
            'discipline': branch.discipline.slug,
            # ---- the conference layer's own ids (steps A, C, E, F, G) ----------------------
            'venue': venue.pk,
            'venue_staff': venue_staff.pk,
            'room': room.pk,
            'booking': booking.pk,
            'asked': asked.pk,
            'template': template.pk,
            'instance': instance.pk,
            'checklist_item': checklist_item.pk,
            'doc_public': documents['public'].pk,
            'doc_attendees': documents['attendees'].pk,
            'doc_staff': documents['staff'].pk,
            'doc_organisers': documents['organisers'].pk,
            'doc_venue': documents['venue'].pk,
            'cloak_station': cloak_station.pk,
            'info_station': info_station.pk,
            'cloak_shift': cloak_shift.pk,
            'open_shift': open_shift.pk,
            'assignment': volunteer_assignment.pk,
            'claimed_assignment': reviewer_claim.pk,
            'record': record.pk,
            'desk': desk.pk,
            'coat': coat.pk,
            'coat_token': coat.token,
            'volunteer_id': built['volunteer'].pk,
            'reviewer_id': built['reviewer'].pk,
            'attendee_id': built['attendee'].pk,
            'clerk_id': clerk.pk,
            'venue_admin_id': venue_admin.pk,
        }
        cls.event_start = event.starts_at

    def _body_for(self, body):
        """A body may be a plain value or a callable taking the ids — the latter for anything that
        has to name a real instant or a real id."""
        return body(self.ids, self.event_start) if callable(body) else body

    def test_matrix(self):
        for persona, method, path, body, expected, why in MATRIX:
            label = f'{persona} {method} {path} → {expected} ({why})'
            with self.subTest(label):
                self.client.force_authenticate(
                    user=None if persona == 'anonymous' else self.people[persona]
                )
                try:
                    with transaction.atomic():
                        call = getattr(self.client, method.lower())
                        url = f'/api{path.format(**self.ids)}'
                        payload = self._body_for(body)
                        response = (
                            call(url) if payload is None else call(url, payload, format='json')
                        )
                        self.assertEqual(
                            response.status_code, expected,
                            f'{label}\n  got {response.status_code}: '
                            f'{getattr(response, "data", b"")!r:.200}',
                        )
                        raise _Rollback
                except _Rollback:
                    pass


def _session_body(ids, start):
    return {'title': 'A new session', 'starts_at': (start + timedelta(hours=2)).isoformat(),
            'duration_minutes': 30, 'kind': 'talk'}


def _schedule_body(ids, start):
    return {'starts_at': (start + timedelta(hours=3)).isoformat(), 'duration_minutes': 30}


_NEW_EVENT = {
    'title': 'Something I am running', 'status': 'draft', 'visibility': 'private',
    'audience': 'university', 'location_kind': 'onsite', 'duration_minutes': 60,
}
_PROPOSAL = {'kind': 'talk', 'title': 'A proposal', 'abstract': 'Words.', 'audience': 'university'}

# ---- bodies for the conference layer (steps A, C, E, F, G) -----------------------------------


def _booking_body(ids, start):
    """A free week, so a refusal is never about the room already being taken."""
    return {'event_id': ids['event'], 'room_id': ids['room'],
            'starts_at': (start + timedelta(days=14)).isoformat(),
            'ends_at': (start + timedelta(days=14, hours=2)).isoformat(),
            'expected_headcount': 20}


def _busy_booking_body(ids, start):
    """The hours the building has already given away to this very event."""
    return {'event_id': ids['event'], 'room_id': ids['room'],
            'starts_at': start.isoformat(),
            'ends_at': (start + timedelta(hours=2)).isoformat(),
            'expected_headcount': 20}


def _crowd_booking_body(ids, start):
    """More people than the fire instruction allows — wrong when it was written, so 400."""
    return {'event_id': ids['event'], 'room_id': ids['room'],
            'starts_at': (start + timedelta(days=21)).isoformat(),
            'ends_at': (start + timedelta(days=21, hours=2)).isoformat(),
            'expected_headcount': 500}


def _room_body(ids, _s):
    return {'venue_id': ids['venue'], 'name': '0142', 'seated_capacity': 20, 'fire_capacity': 40}


def _template_body(ids, _s):
    return {'venue_id': ids['venue'], 'name': 'Another list'}


def _instantiate_body(ids, _s):
    return {'template_id': ids['template']}


def _shift_body(ids, start):
    return {'starts_at': (start + timedelta(days=2)).isoformat(),
            'ends_at': (start + timedelta(days=2, hours=2)).isoformat(), 'needed': 1}


def _assign_body(ids, _s):
    return {'user': ids['clerk_id']}


def _assign_outsider_body(ids, _s):
    return {'user': ids['attendee_id']}


def _claimed_assignment_body(ids, _s):
    return {'assignment': ids['claimed_assignment']}


def _assignment_body(ids, _s):
    return {'assignment': ids['assignment']}


def _record_body(ids, _s):
    return {'user': ids['volunteer_id'], 'consent_recorded': True}


def _token_body(ids, _s):
    return {'token': ids['coat_token']}


_NEW_STATION = {'kind': 'info', 'name': 'Drugi punkt'}
_NEW_DESK = {'name': 'Szatnia — wejście zachodnie', 'rack_labels': ['A1', 'A2']}
_NEW_DOCUMENT = {'title': 'Another note', 'kind': 'link', 'url': 'https://example.org/x',
                 'visibility': 'staff'}
_REPLACEMENT = {'url': 'https://example.org/v2'}
_DEPOSIT = {'rack_label': '2'}
_DEPOSIT_TAKEN = {'rack_label': '1'}
_DEPOSIT_NOWHERE = {'rack_label': '99'}
_EXCEPTION = {'description': 'Czarny płaszcz', 'identity_kind': 'student_card'}
_EXCEPTION_ANONYMOUS = {'description': 'Czarny płaszcz', 'identity_kind': 'none'}

#: (persona, method, path, body, expected status, why). Paths are formatted with `cls.ids` and get
#: an `/api` prefix. `None` as a body means "send nothing".
MATRIX = [

    # ---- step D: tickets, the door, the badge sheet (events/ticket_views.py; integration) --------
    # This fixture's stranger holds a `pending` registration (the approval-mode row above), so the
    # ticket endpoint names that refusal rather than 404-ing — the whole point of §3.D's design.
    ('stranger', 'GET', '/events/{event}/my-ticket/', None, 409, 'pending — told which refusal, not 404'),
    ('attendee', 'GET', '/events/{event}/my-ticket/', None, 200, 'holds a seat, so has a ticket'),
    ('volunteer', 'GET', '/events/{event}/my-ticket/', None, 404, 'staff without a seat has no ticket'),
    ('organiser', 'GET', '/events/{event}/my-ticket/', None, 404, 'the host does not attend'),
    ('stranger', 'POST', '/events/{event}/my-ticket/rotate/', {}, 409, 'pending — nothing to rotate yet'),
    ('attendee', 'POST', '/events/{event}/my-ticket/rotate/', {}, 200, 'their own ticket'),
    ('stranger', 'GET', '/events/{event}/checkin-list/', None, 403, 'staff only'),
    ('attendee', 'GET', '/events/{event}/checkin-list/', None, 403, 'staff only'),
    ('volunteer', 'GET', '/events/{event}/checkin-list/', None, 200, 'the door needs the list'),
    ('organiser', 'GET', '/events/{event}/checkin-list/', None, 200, 'staff'),
    ('stranger', 'POST', '/events/{event}/scans/',
     {'scans': [{'token': 'nope', 'direction': 'entry', 'client_nonce': 'mx-s', 'client_at': '2026-09-23T10:00:00Z'}]},
     403, 'staff only'),
    ('attendee', 'POST', '/events/{event}/scans/',
     {'scans': [{'token': 'nope', 'direction': 'entry', 'client_nonce': 'mx-a', 'client_at': '2026-09-23T10:00:00Z'}]},
     403, 'staff only'),
    ('volunteer', 'POST', '/events/{event}/scans/',
     {'scans': [{'token': 'nope', 'direction': 'entry', 'client_nonce': 'mx-v', 'client_at': '2026-09-23T10:00:00Z'}]},
     200, 'a batch is always answered; an unknown token is a result, not an error'),
    ('clerk', 'POST', '/events/{event}/scans/',
     {'scans': [{'token': 'nope', 'direction': 'entry', 'client_nonce': 'mx-c', 'client_at': '2026-09-23T10:00:00Z'}]},
     409, 'briefing_unread — the door answers the documents gate like check-in and the desk'),
    ('stranger', 'GET', '/events/{event}/scans/', None, 403, 'organisers only'),
    ('volunteer', 'GET', '/events/{event}/scans/', None, 403, 'the log is the organisers\''),
    ('organiser', 'GET', '/events/{event}/scans/', None, 200, 'the log'),
    ('attendee', 'GET', '/events/{event}/badge-sheet/', None, 403, 'organisers only'),
    ('volunteer', 'GET', '/events/{event}/badge-sheet/', None, 403, 'organisers only'),
    ('organiser', 'GET', '/events/{event}/badge-sheet/', None, 200, 'the printable list'),
    # ---- the event itself ---------------------------------------------------------------------
    ('anonymous', 'GET', '/events/{event}/', None, 200, 'a published, public event is public'),
    ('stranger', 'GET', '/events/{event}/', None, 200, 'same'),
    ('attendee', 'GET', '/events/{event}/', None, 200, 'same'),
    ('child', 'GET', '/events/{event}/', None, 200, 'a minor may read what anybody may read'),
    ('volunteer', 'GET', '/events/{event}/', None, 200, 'same'),

    ('anonymous', 'GET', '/events/{draft}/', None, 404, 'a draft does not exist for a stranger'),
    ('stranger', 'GET', '/events/{draft}/', None, 404, 'not 403 — 403 would confirm it is there'),
    ('attendee', 'GET', '/events/{draft}/', None, 404, 'same'),
    ('volunteer', 'GET', '/events/{draft}/', None, 404, 'staff of another event is not staff here'),
    ('reviewer', 'GET', '/events/{draft}/', None, 404, 'same'),
    ('organiser', 'GET', '/events/{draft}/', None, 200, 'its host sees their own draft'),

    ('anonymous', 'PATCH', '/events/{event}/', {'summary': 'x'}, 401, 'a write needs a sign-in'),
    ('stranger', 'PATCH', '/events/{event}/', {'summary': 'x'}, 404, 'not yours → 404, not 403'),
    ('attendee', 'PATCH', '/events/{event}/', {'summary': 'x'}, 404, 'going is not organising'),
    ('volunteer', 'PATCH', '/events/{event}/', {'summary': 'x'}, 404, 'a volunteer edits nothing'),
    ('reviewer', 'PATCH', '/events/{event}/', {'summary': 'x'}, 404, 'a reviewer edits nothing'),
    ('organiser', 'PATCH', '/events/{event}/', {'summary': 'x'}, 200, 'the host may'),

    ('stranger', 'DELETE', '/events/{draft}/', None, 404, 'somebody else’s draft'),
    ('volunteer', 'DELETE', '/events/{draft}/', None, 404, 'same'),
    ('organiser', 'DELETE', '/events/{draft}/', None, 204, 'a draft nobody saw may be deleted'),
    ('organiser', 'DELETE', '/events/{event}/', None, 409,
     'people are coming — cancel it instead (409, the world moved, not 400)'),

    ('anonymous', 'POST', '/events/{event}/cancel/', None, 401, 'a write needs a sign-in'),
    ('stranger', 'POST', '/events/{event}/cancel/', None, 404, 'not yours'),
    ('volunteer', 'POST', '/events/{event}/cancel/', None, 404, 'not yours'),
    ('reviewer', 'POST', '/events/{event}/cancel/', None, 404, 'not yours'),
    ('organiser', 'POST', '/events/{event}/cancel/', None, 200, 'the host may call it off'),

    ('anonymous', 'POST', '/events/', _NEW_EVENT, 401, 'a write needs a sign-in'),
    ('child', 'POST', '/events/', _NEW_EVENT, 403, 'a minor may not host (accounts/minors.py)'),
    ('stranger', 'POST', '/events/', _NEW_EVENT, 201, 'anybody of age may run something'),

    ('anonymous', 'GET', '/events/{event}/ics/', None, 200, 'the calendar is as public as the page'),

    # ---- the id that is not an id (config/routers.py) -------------------------------------------
    # Every one of these was a 500 before `NumericPkRouter`: `pk='undefined'` reached the database
    # and the cast raised. A frontend that sends `undefined` is a frontend bug; the honest answer
    # to "the thing at this id" is still 404.
    ('anonymous', 'GET', '/events/undefined/', None, 404, 'not a number, so not a thing'),
    ('anonymous', 'GET', '/exercises/undefined/', None, 404, 'same, everywhere'),
    ('anonymous', 'GET', '/materials/undefined/', None, 404, 'same, everywhere'),
    ('anonymous', 'GET', '/courses/undefined/', None, 404, 'same, everywhere'),
    ('anonymous', 'GET', '/services/undefined/', None, 404, 'same, everywhere'),
    ('anonymous', 'GET', '/sessions/undefined/', None, 404, 'same, everywhere'),
    ('attendee', 'GET', '/events/undefined/', None, 404, 'signed in changes nothing'),
    # The nested ids inside a custom action's own `url_path` are that action's regex, not the
    # router's — so they need the same narrowing, and these rows are what says whether they have it.
    ('organiser', 'POST', '/events/{event}/registrations/undefined/checkin/', None, 404,
     'a nested id that is not a number is not a row'),
    ('organiser', 'PATCH', '/events/{event}/staff/undefined/', {'role': 'reviewer'}, 404, 'same'),
    ('organiser', 'PATCH', '/events/{event}/sessions/undefined/', {'title': 'x'}, 404, 'same'),
    ('organiser', 'PATCH', '/events/{event}/tracks/undefined/', {'name': 'x'}, 404, 'same'),
    ('attendee', 'GET', '/events/{event}/contributions/undefined/', None, 404, 'same'),
    ('organiser', 'PATCH', '/events/{event}/posts/undefined/', {'body': 'x'}, 404, 'same'),
    # …and the two that are deliberately NOT numbers keep working.
    ('anonymous', 'GET', '/disciplines/{discipline}/', None, 200, 'a discipline is a slug'),
    ('anonymous', 'GET', '/branches/{branch}/', None, 200, 'a branch is a slug'),

    # ---- staff ---------------------------------------------------------------------------------
    ('anonymous', 'GET', '/events/{event}/staff/', None, 401, 'who runs this is not public'),
    ('stranger', 'GET', '/events/{event}/staff/', None, 403, 'real thing, wrong party'),
    ('attendee', 'GET', '/events/{event}/staff/', None, 403, 'going is not helping'),
    ('guardian', 'GET', '/events/{event}/staff/', None, 403, 'same'),
    ('volunteer', 'GET', '/events/{event}/staff/', None, 200, 'staff see who else is staff'),
    ('reviewer', 'GET', '/events/{event}/staff/', None, 200, 'same'),
    ('organiser', 'GET', '/events/{event}/staff/', None, 200, 'same'),

    ('attendee', 'POST', '/events/{event}/staff/',
     lambda ids, _s: {'user': ids['stranger_id'], 'role': 'volunteer'}, 403, 'not staff at all'),
    ('volunteer', 'POST', '/events/{event}/staff/',
     lambda ids, _s: {'user': ids['stranger_id'], 'role': 'volunteer'}, 403,
     'staff, but only an organiser adds staff'),
    ('reviewer', 'POST', '/events/{event}/staff/',
     lambda ids, _s: {'user': ids['stranger_id'], 'role': 'volunteer'}, 403, 'same'),
    ('organiser', 'POST', '/events/{event}/staff/',
     lambda ids, _s: {'user': ids['stranger_id'], 'role': 'volunteer'}, 201, 'the organiser may'),

    ('volunteer', 'PATCH', '/events/{event}/staff/{staff_volunteer}/', {'role': 'organiser'}, 403,
     'a volunteer cannot promote themselves'),
    ('reviewer', 'PATCH', '/events/{event}/staff/{staff_volunteer}/', {'role': 'organiser'}, 403, 'same'),
    ('organiser', 'PATCH', '/events/{event}/staff/{staff_volunteer}/', {'role': 'reviewer'}, 200, 'the organiser may'),
    ('attendee', 'DELETE', '/events/{event}/staff/{staff_volunteer}/', None, 403, 'not staff at all'),
    ('reviewer', 'DELETE', '/events/{event}/staff/{staff_volunteer}/', None, 403, 'not an organiser'),
    ('organiser', 'DELETE', '/events/{event}/staff/{staff_volunteer}/', None, 204, 'the organiser may'),
    ('organiser', 'DELETE', '/events/{event}/staff/{staff_host}/', None, 400,
     'the host’s own row is immutable — an event a co-organiser could evict its host from is an '
     'event that can be taken hostage'),

    # ---- the programme -------------------------------------------------------------------------
    ('anonymous', 'GET', '/events/{event}/sessions/', None, 200, 'a programme is an advertisement'),
    ('stranger', 'GET', '/events/{event}/sessions/', None, 200, 'same'),
    ('anonymous', 'GET', '/events/{event}/tracks/', None, 200, 'same'),
    ('anonymous', 'POST', '/events/{event}/sessions/', _session_body, 401, 'a write needs a sign-in'),
    ('attendee', 'POST', '/events/{event}/sessions/', _session_body, 403, 'going is not organising'),
    ('volunteer', 'POST', '/events/{event}/sessions/', _session_body, 403, 'a volunteer writes no programme'),
    ('reviewer', 'POST', '/events/{event}/sessions/', _session_body, 403, 'nor a reviewer'),
    ('organiser', 'POST', '/events/{event}/sessions/', _session_body, 201, 'the organiser may'),
    ('volunteer', 'PATCH', '/events/{event}/sessions/{session}/', {'title': 'Moved'}, 403, 'same'),
    ('reviewer', 'PATCH', '/events/{event}/sessions/{session}/', {'title': 'Moved'}, 403, 'same'),
    ('organiser', 'PATCH', '/events/{event}/sessions/{session}/', {'title': 'Moved'}, 200, 'the organiser may'),
    ('reviewer', 'DELETE', '/events/{event}/sessions/{session}/', None, 403, 'same'),
    ('organiser', 'DELETE', '/events/{event}/sessions/{session}/', None, 204, 'the organiser may'),
    ('volunteer', 'POST', '/events/{event}/tracks/', {'name': 'Room B'}, 403, 'same'),
    ('reviewer', 'POST', '/events/{event}/tracks/', {'name': 'Room B'}, 403, 'same'),
    ('organiser', 'POST', '/events/{event}/tracks/', {'name': 'Room B'}, 201, 'the organiser may'),
    ('volunteer', 'PATCH', '/events/{event}/tracks/{track}/', {'name': 'Room C'}, 403, 'same'),
    ('organiser', 'PATCH', '/events/{event}/tracks/{track}/', {'name': 'Room C'}, 200, 'the organiser may'),
    ('anonymous', 'POST', '/events/{event}/sessions/{session}/bookmark/', None, 401, 'a bookmark is somebody’s'),
    ('attendee', 'POST', '/events/{event}/sessions/{session}/bookmark/', None, 200, 'anybody who can read it may'),

    # ---- registrations -------------------------------------------------------------------------
    ('anonymous', 'GET', '/events/{event}/registrations/', None, 401, 'who is coming is not public'),
    ('stranger', 'GET', '/events/{event}/registrations/', None, 403, 'real thing, wrong party'),
    ('attendee', 'GET', '/events/{event}/registrations/', None, 403,
     'an attendee is on this list; that is not the same as reading it'),
    ('guardian', 'GET', '/events/{event}/registrations/', None, 403, 'same'),
    ('child', 'GET', '/events/{event}/registrations/', None, 403, 'same'),
    ('volunteer', 'GET', '/events/{event}/registrations/', None, 200, 'they check people in against it'),
    ('reviewer', 'GET', '/events/{event}/registrations/', None, 200, 'staff'),
    ('organiser', 'GET', '/events/{event}/registrations/', None, 200, 'staff'),

    ('stranger', 'GET', '/events/{event}/registrations/export/', None, 403, 'the file is the same data'),
    ('attendee', 'GET', '/events/{event}/registrations/export/', None, 403, 'same'),
    # Step G (CONFERENCE-BRIEF.md §3.G) made the full CSV organiser-only: a volunteer gets the
    # door list at /exports/door-list.csv instead, and the full export is logged.
    ('volunteer', 'GET', '/events/{event}/registrations/export/', None, 403, 'organisers only since 17BF.G'),
    ('organiser', 'GET', '/events/{event}/registrations/export/', None, 200, 'staff'),

    ('volunteer', 'POST', '/events/{event}/registrations/{pending}/decide/', {'decision': 'accept'},
     403, 'a volunteer opens the door; they do not choose who is on the list'),
    ('reviewer', 'POST', '/events/{event}/registrations/{pending}/decide/', {'decision': 'accept'},
     403, 'a reviewer decides proposals, not people'),
    ('attendee', 'POST', '/events/{event}/registrations/{pending}/decide/', {'decision': 'accept'},
     403, 'not staff at all'),
    ('organiser', 'POST', '/events/{event}/registrations/{pending}/decide/', {'decision': 'accept'},
     200, 'the organiser may'),

    ('stranger', 'POST', '/events/{event}/registrations/{attendance}/checkin/', None, 403, 'not staff'),
    ('attendee', 'POST', '/events/{event}/registrations/{attendance}/checkin/', None, 403,
     'not even their own row'),
    ('volunteer', 'POST', '/events/{event}/registrations/{attendance}/checkin/', None, 200,
     'this is exactly what the role is for'),
    ('organiser', 'POST', '/events/{event}/registrations/{attendance}/checkin/', None, 200, 'staff'),
    ('volunteer', 'DELETE', '/events/{event}/registrations/{attendance}/checkin/', None, 200,
     'undoing a wrong tap is the same permission as making it'),

    ('anonymous', 'GET', '/events/{event}/registration-fields/', None, 200,
     'the form has to be renderable to be filled'),
    ('anonymous', 'PUT', '/events/{event}/registration-fields/', [], 401, 'a write needs a sign-in'),
    ('attendee', 'PUT', '/events/{event}/registration-fields/', [], 403, 'answering is not authoring'),
    ('volunteer', 'PUT', '/events/{event}/registration-fields/', [], 403, 'not an organiser'),
    ('reviewer', 'PUT', '/events/{event}/registration-fields/', [], 403, 'not an organiser'),
    ('organiser', 'PUT', '/events/{event}/registration-fields/', [], 200, 'the organiser’s own questions'),

    ('anonymous', 'GET', '/events/{event}/attendees/', None, 200,
     'this organiser published a MASKED list (show_attendees_publicly)'),
    ('attendee', 'GET', '/events/{event}/attendees/', None, 200, 'people going see each other'),
    ('anonymous', 'GET', '/events/{closed}/attendees/', None, 403,
     'the default: turning up somewhere does not publish your name'),
    ('stranger', 'GET', '/events/{closed}/attendees/', None, 403, 'same'),
    ('organiser', 'GET', '/events/{closed}/attendees/', None, 200, 'their own roster'),

    ('anonymous', 'POST', '/events/{event}/attend/', {'status': 'going'}, 401, 'a seat is somebody’s'),
    ('stranger', 'POST', '/events/{event}/attend/', {'status': 'going'}, 200, 'anybody may answer'),
    ('organiser', 'POST', '/events/{event}/attend/', {'status': 'going'}, 409,
     'the host is running it, not attending it — a reason (409), not a silent no'),
    ('child', 'POST', '/events/{event}/attend/', {'status': 'going'}, 200,
     'a minor may answer for themselves; what they may not do is HOST'),
    ('guardian', 'POST', '/events/{event}/attend/',
     lambda ids, _s: {'status': 'going', 'on_behalf_of': ids['child_id']}, 200,
     'a guardian answers for their own child — the row is the child’s, marked registered_by'),
    ('stranger', 'POST', '/events/{event}/attend/',
     lambda ids, _s: {'status': 'going', 'on_behalf_of': ids['child_id']}, 403,
     'not_your_child: 403 rather than 404, because the child is a real account and the refusal is '
     'about the relationship, not about existence'),
    ('organiser', 'POST', '/events/{event}/attend/',
     lambda ids, _s: {'status': 'going', 'on_behalf_of': ids['child_id']}, 403, 'same'),

    # ---- contributions -------------------------------------------------------------------------
    ('anonymous', 'GET', '/events/{event}/contributions/', None, 200,
     'accepted and scheduled proposals are the programme; the rest are filtered out, not refused'),
    ('attendee', 'GET', '/events/{event}/contributions/', None, 200, 'plus their own'),
    ('volunteer', 'GET', '/events/{event}/contributions/', None, 200, 'staff see the queue'),
    ('anonymous', 'POST', '/events/{event}/contributions/', _PROPOSAL, 401, 'a proposal is somebody’s'),
    ('stranger', 'POST', '/events/{event}/contributions/', _PROPOSAL, 201, 'an open call is open'),

    ('stranger', 'PATCH', '/events/{event}/contributions/{contribution}/', {'title': 'x'}, 404,
     'a proposal under review is invisible to anybody but its author and the staff'),
    ('attendee', 'PATCH', '/events/{event}/contributions/{contribution}/', {'title': 'x'}, 200,
     'its author, while nobody has decided'),
    ('volunteer', 'PATCH', '/events/{event}/contributions/{contribution}/', {'title': 'x'}, 403,
     'visible to staff, editable by its author'),
    ('organiser', 'PATCH', '/events/{event}/contributions/{contribution}/', {'title': 'x'}, 403, 'same'),

    ('stranger', 'POST', '/events/{event}/contributions/{contribution}/review/', None, 404, 'invisible'),
    ('attendee', 'POST', '/events/{event}/contributions/{contribution}/review/', None, 403,
     'the author does not review their own'),
    ('volunteer', 'POST', '/events/{event}/contributions/{contribution}/review/', None, 403,
     'THE row this file exists for: staff is not a ladder'),
    ('reviewer', 'POST', '/events/{event}/contributions/{contribution}/review/', None, 200, 'the role'),
    ('organiser', 'POST', '/events/{event}/contributions/{contribution}/review/', None, 200, 'organisers review too'),
    ('volunteer', 'POST', '/events/{event}/contributions/{contribution}/accept/', None, 403, 'same'),
    ('reviewer', 'POST', '/events/{event}/contributions/{contribution}/accept/', None, 200, 'the role'),
    ('attendee', 'POST', '/events/{event}/contributions/{contribution}/withdraw/', None, 200,
     'the author may pull their own proposal'),
    ('volunteer', 'POST', '/events/{event}/contributions/{contribution}/withdraw/', None, 403, 'not theirs'),
    ('reviewer', 'POST', '/events/{event}/contributions/{accepted}/schedule/', _schedule_body, 403,
     'scheduling writes the programme, so it is an organiser’s'),
    ('volunteer', 'POST', '/events/{event}/contributions/{accepted}/schedule/', _schedule_body, 403, 'same'),
    ('organiser', 'POST', '/events/{event}/contributions/{accepted}/schedule/', _schedule_body, 200, 'the organiser may'),

    # ---- my agenda -----------------------------------------------------------------------------
    ('anonymous', 'GET', '/my-agenda/', None, 401, 'an agenda is somebody’s'),
    ('attendee', 'GET', '/my-agenda/', None, 200, 'their own'),
    ('stranger', 'GET', '/my-agenda/', None, 200, 'an empty one is still theirs'),
    ('anonymous', 'GET', '/my-agenda.ics', None, 401, 'the file is the same data'),
    ('attendee', 'GET', '/my-agenda.ics', None, 200, 'their own'),

    # ================ the conference layer (CONFERENCE-BRIEF.md §5) =============================
    # Steps A, C, E, F and G each hung a surface off the same event. Their rows go below, one block
    # per step, and two personas exist only for them: `venue_admin` runs the building (and is NOT
    # event staff), `clerk` is a second volunteer who has not read the briefing.

    # ---- A. venues, rooms, bookings, checklists (17BF.A) ---------------------------------------
    ('anonymous', 'GET', '/venues/', None, 200,
     'a lecture theatre’s address and seat count is what somebody needs to decide whether to ask'),
    ('anonymous', 'GET', '/venues/{venue}/', None, 200, 'same'),
    ('stranger', 'GET', '/venues/{venue}/', None, 200, 'same'),
    ('anonymous', 'GET', '/venues/{venue}/templates/', None, 200,
     'what a building hands out is part of deciding to ask it'),
    ('anonymous', 'POST', '/venues/', {'name': 'Mine', 'slug': 'mine'}, 401, 'a write needs a sign-in'),
    ('stranger', 'POST', '/venues/', {'name': 'Mine', 'slug': 'mine'}, 403,
     'no self-service "claim this building" (§6.4) — platform staff make the first one'),
    ('venue_admin', 'POST', '/venues/', {'name': 'Mine', 'slug': 'mine'}, 403,
     'running a building is not being given another one'),
    ('anonymous', 'PATCH', '/venues/{venue}/', {'address': 'x'}, 401, 'a write needs a sign-in'),
    ('organiser', 'PATCH', '/venues/{venue}/', {'address': 'x'}, 403,
     'holding a booking is not running the building'),
    ('venue_admin', 'PATCH', '/venues/{venue}/', {'address': 'ul. Pasteura 5'}, 200, 'its administrator may'),
    ('venue_admin', 'DELETE', '/venues/{venue}/', None, 403,
     'closing a building is a platform-staff act — every past event still names it'),

    ('anonymous', 'GET', '/venues/{venue}/staff/', None, 403,
     'who runs a building is not a public fact; the contact note is what a stranger reads'),
    ('stranger', 'GET', '/venues/{venue}/staff/', None, 403, 'same'),
    ('organiser', 'GET', '/venues/{venue}/staff/', None, 403, 'same — an organiser is not venue staff'),
    ('venue_admin', 'GET', '/venues/{venue}/staff/', None, 200, 'venue staff see who else is'),
    ('anonymous', 'POST', '/venues/{venue}/staff/',
     lambda ids, _s: {'user_id': ids['stranger_id']}, 401, 'a write needs a sign-in'),
    ('organiser', 'POST', '/venues/{venue}/staff/',
     lambda ids, _s: {'user_id': ids['stranger_id']}, 403, 'not theirs to staff'),
    ('venue_admin', 'POST', '/venues/{venue}/staff/',
     lambda ids, _s: {'user_id': ids['stranger_id'], 'role': 'porter'}, 201,
     'an administrator adds the next person, and platform staff never has to be involved again'),
    ('stranger', 'DELETE', '/venues/{venue}/staff/{venue_staff}/', None, 403, 'not venue staff'),
    ('venue_admin', 'DELETE', '/venues/{venue}/staff/{venue_staff}/', None, 409,
     'the last administrator — a building nobody can open again (409, the world would have moved)'),
    ('venue_admin', 'DELETE', '/venues/{venue}/staff/undefined/', None, 404,
     'a nested id that is not a number is not a row'),

    ('anonymous', 'GET', '/venues/{venue}/bookings/', None, 403,
     'who is in which room when is a security fact about a building, not a timetable'),
    ('organiser', 'GET', '/venues/{venue}/bookings/', None, 403,
     'they see their OWN booking at /room-bookings/, not the building’s queue'),
    ('venue_admin', 'GET', '/venues/{venue}/bookings/', None, 200, 'the building’s own queue'),

    ('anonymous', 'GET', '/rooms/', None, 200, 'a room is as public as its building'),
    ('anonymous', 'GET', '/rooms/{room}/', None, 200, 'same'),
    ('anonymous', 'POST', '/rooms/', _room_body, 401, 'a write needs a sign-in'),
    ('organiser', 'POST', '/rooms/', _room_body, 403, 'the building describes itself'),
    ('venue_admin', 'POST', '/rooms/', _room_body, 201, 'its administrator may'),
    ('organiser', 'PATCH', '/rooms/{room}/', {'notes': 'x'}, 403, 'same'),
    ('venue_admin', 'PATCH', '/rooms/{room}/', {'notes': 'Klucz na portierni'}, 200, 'its administrator may'),
    ('organiser', 'DELETE', '/rooms/{room}/', None, 403, 'same'),
    ('venue_admin', 'DELETE', '/rooms/{room}/', None, 204, 'deactivated, never deleted'),

    ('anonymous', 'GET', '/room-bookings/', None, 401, 'a booking is somebody’s'),
    ('stranger', 'GET', '/room-bookings/', None, 200, 'an empty list is still theirs'),
    ('organiser', 'GET', '/room-bookings/', None, 200, 'the events they run'),
    ('venue_admin', 'GET', '/room-bookings/', None, 200, 'the rooms they let'),
    ('anonymous', 'GET', '/room-bookings/{booking}/', None, 401, 'same'),
    ('stranger', 'GET', '/room-bookings/{booking}/', None, 404, 'scoped out → it does not exist'),
    ('attendee', 'GET', '/room-bookings/{booking}/', None, 404, 'same'),
    ('volunteer', 'GET', '/room-bookings/{booking}/', None, 404,
     'the queryset names the event’s ORGANISERS, not its staff'),
    ('organiser', 'GET', '/room-bookings/{booking}/', None, 200, 'the party that asked'),
    ('venue_admin', 'GET', '/room-bookings/{booking}/', None, 200, 'the party that answered'),
    ('anonymous', 'POST', '/room-bookings/', _booking_body, 401, 'a write needs a sign-in'),
    ('stranger', 'POST', '/room-bookings/', _booking_body, 404,
     'asking for a room for somebody else’s event — that event does not exist to this endpoint'),
    ('volunteer', 'POST', '/room-bookings/', _booking_body, 404, 'same — a volunteer books nothing'),
    ('organiser', 'POST', '/room-bookings/', _booking_body, 201, 'the organiser asks'),
    ('organiser', 'POST', '/room-bookings/', _busy_booking_body, 409,
     'room_busy: an approved booking already holds those hours (the world moved)'),
    ('organiser', 'POST', '/room-bookings/', _crowd_booking_body, 400,
     'over_fire_capacity: nothing moved, the request was wrong when it was written'),
    ('volunteer', 'POST', '/room-bookings/{asked}/approve/', None, 404, 'scoped out'),
    ('organiser', 'POST', '/room-bookings/{asked}/approve/', None, 403,
     'the party that asked does not get to answer'),
    ('venue_admin', 'POST', '/room-bookings/{asked}/approve/', None, 200, 'the building decides'),
    ('venue_admin', 'POST', '/room-bookings/{asked}/reject/', None, 200, 'and may say no'),
    ('venue_admin', 'POST', '/room-bookings/{booking}/approve/', None, 409,
     'already_decided — a second decision is the world having moved, not a bad request'),
    ('venue_admin', 'POST', '/room-bookings/{asked}/cancel/', None, 403,
     'withdrawing is the organiser’s word, not the building’s'),
    ('organiser', 'POST', '/room-bookings/{asked}/cancel/', None, 200, 'the organiser withdraws'),

    ('anonymous', 'GET', '/checklist-templates/', None, 200, 'a building’s list is readable'),
    ('anonymous', 'POST', '/checklist-templates/', _template_body, 401, 'a write needs a sign-in'),
    ('organiser', 'POST', '/checklist-templates/', _template_body, 403, 'the building writes its own'),
    ('venue_admin', 'POST', '/checklist-templates/', _template_body, 201, 'its administrator may'),
    ('venue_admin', 'POST', '/checklist-templates/', {'name': 'A platform default'}, 403,
     'a template belonging to NOBODY is a platform default, and that is platform staff’s'),
    ('organiser', 'PATCH', '/checklist-templates/{template}/', {'name': 'x'}, 403, 'same'),
    ('venue_admin', 'PATCH', '/checklist-templates/{template}/', {'name': 'Handover v2'}, 200, 'its own'),
    ('venue_admin', 'DELETE', '/checklist-templates/{template}/', None, 204, 'deactivated, not deleted'),

    ('anonymous', 'GET', '/events/{event}/checklist/', None, 401, 'a blocked fire door is not news'),
    ('stranger', 'GET', '/events/{event}/checklist/', None, 404, 'for them this event has no checklist'),
    ('attendee', 'GET', '/events/{event}/checklist/', None, 404, 'same'),
    ('volunteer', 'GET', '/events/{event}/checklist/', None, 200, 'event staff work through it'),
    ('reviewer', 'GET', '/events/{event}/checklist/', None, 200, 'same'),
    ('organiser', 'GET', '/events/{event}/checklist/', None, 200, 'same'),
    ('venue_admin', 'GET', '/events/{event}/checklist/', None, 200, 'it is the building’s own list'),
    ('venue_admin', 'GET', '/events/{draft}/checklist/', None, 404,
     'no booking, no instance — this building has no business with that event'),
    ('anonymous', 'GET', '/events/undefined/checklist/', None, 404, 'not a number, so not a thing'),
    ('attendee', 'POST', '/events/{event}/checklist/', _instantiate_body, 404, 'not theirs to cut'),
    ('venue_admin', 'POST', '/events/{event}/checklist/', _instantiate_body, 404,
     'the building hands the list over; the organiser starts it'),
    ('organiser', 'POST', '/events/{event}/checklist/', _instantiate_body, 409,
     'already_started — one instance per (event, venue)'),

    ('anonymous', 'POST', '/checklist-instances/{instance}/sync/', None, 401, 'a write needs a sign-in'),
    ('volunteer', 'POST', '/checklist-instances/{instance}/sync/', None, 403, 'not an organiser'),
    ('organiser', 'POST', '/checklist-instances/{instance}/sync/', None, 200, 'theirs to refresh'),
    ('venue_admin', 'POST', '/checklist-instances/{instance}/sync/', None, 200,
     'the building may offer what it has since written'),
    ('venue_admin', 'DELETE', '/checklist-instances/{instance}/', None, 403,
     'abandoning the list is the organiser’s decision, not the building’s'),
    ('organiser', 'DELETE', '/checklist-instances/{instance}/', None, 204, 'theirs to abandon'),

    ('anonymous', 'PATCH', '/checklist-items/{checklist_item}/', {'status': 'in_progress'}, 401,
     'a write needs a sign-in'),
    ('attendee', 'PATCH', '/checklist-items/{checklist_item}/', {'status': 'in_progress'}, 403, 'not theirs'),
    ('volunteer', 'PATCH', '/checklist-items/{checklist_item}/', {'status': 'in_progress'}, 403,
     'a porter reads and a volunteer reads; neither ticks'),
    ('organiser', 'PATCH', '/checklist-items/{checklist_item}/', {'status': 'in_progress'}, 200,
     'somebody is on it'),
    ('organiser', 'PATCH', '/checklist-items/{checklist_item}/', {'status': 'done'}, 400,
     'needs_venue_signoff: the keys really were handed back, and the BUILDING says so'),
    ('organiser', 'PATCH', '/checklist-items/{checklist_item}/', {'status': 'not_applicable'}, 400,
     'na_not_allowed — the building did not mark this line as one that may be waved away'),
    ('venue_admin', 'PATCH', '/checklist-items/{checklist_item}/', {'status': 'done'}, 200,
     'the administrator may tick the line their own building signs'),
    ('volunteer', 'POST', '/checklist-items/{checklist_item}/sign-off/', None, 403, 'not theirs'),
    ('organiser', 'POST', '/checklist-items/{checklist_item}/sign-off/', None, 403,
     'signing your own handover is what the flag exists to refuse'),
    ('venue_admin', 'POST', '/checklist-items/{checklist_item}/sign-off/', None, 200, 'the building’s signature'),

    ('anonymous', 'GET', '/venues/undefined/', None, 404, 'not a number, so not a thing'),
    ('anonymous', 'GET', '/rooms/undefined/', None, 404, 'same'),
    ('anonymous', 'GET', '/room-bookings/undefined/', None, 404, 'same'),
    ('anonymous', 'GET', '/checklist-templates/undefined/', None, 404, 'same'),
    ('organiser', 'POST', '/checklist-instances/undefined/sync/', None, 404, 'same'),
    ('organiser', 'PATCH', '/checklist-items/undefined/', {'status': 'done'}, 404, 'same'),

    # ---- C. documents and briefings (17BF.C) ---------------------------------------------------
    ('anonymous', 'GET', '/events/{event}/documents/', None, 200,
     'the list is tier-filtered, not refused — an anonymous reader gets the public ones'),
    ('attendee', 'GET', '/events/{event}/documents/', None, 200, 'plus the attendee tier'),
    ('volunteer', 'GET', '/events/{event}/documents/', None, 200, 'plus the staff tier'),
    ('organiser', 'GET', '/events/{event}/documents/', None, 200, 'everything the event holds'),
    ('venue_admin', 'GET', '/events/{event}/documents/', None, 200, 'public plus the venue tier'),
    ('anonymous', 'GET', '/events/{draft}/documents/', None, 404, 'a draft does not exist for a stranger'),
    ('organiser', 'GET', '/events/{draft}/documents/', None, 200, 'its host sees their own draft'),
    ('anonymous', 'POST', '/events/{event}/documents/', _NEW_DOCUMENT, 401, 'a write needs a sign-in'),
    ('attendee', 'POST', '/events/{event}/documents/', _NEW_DOCUMENT, 403, 'reading is not filing'),
    ('volunteer', 'POST', '/events/{event}/documents/', _NEW_DOCUMENT, 403,
     'a volunteer who could publish a mandatory briefing could lock every other volunteer out'),
    ('reviewer', 'POST', '/events/{event}/documents/', _NEW_DOCUMENT, 403, 'same'),
    ('organiser', 'POST', '/events/{event}/documents/', _NEW_DOCUMENT, 201, 'the organiser may'),

    ('anonymous', 'GET', '/events/{event}/acknowledgements/', None, 401, 'who has read what is not public'),
    ('attendee', 'GET', '/events/{event}/acknowledgements/', None, 403, 'real thing, wrong party'),
    ('volunteer', 'GET', '/events/{event}/acknowledgements/', None, 403, 'they are ON this table'),
    ('organiser', 'GET', '/events/{event}/acknowledgements/', None, 200, 'the receipts are theirs to read'),

    ('anonymous', 'GET', '/documents/{doc_public}/', None, 200, 'the public tier is public'),
    ('anonymous', 'GET', '/documents/{doc_attendees}/', None, 404,
     'below the tier is 404, not 403 — a staff briefing an attendee can prove exists is half a leak'),
    ('stranger', 'GET', '/documents/{doc_attendees}/', None, 404, 'same'),
    ('attendee', 'GET', '/documents/{doc_attendees}/', None, 200, 'a seat holder reads the joining note'),
    ('volunteer', 'GET', '/documents/{doc_attendees}/', None, 200, 'the ladder: staff see what attendees see'),
    ('attendee', 'GET', '/documents/{doc_staff}/', None, 404, 'below the tier'),
    ('volunteer', 'GET', '/documents/{doc_staff}/', None, 200, 'the briefing is theirs'),
    ('reviewer', 'GET', '/documents/{doc_staff}/', None, 200, 'same'),
    ('volunteer', 'GET', '/documents/{doc_organisers}/', None, 404, 'the ladder stops below them'),
    ('organiser', 'GET', '/documents/{doc_organisers}/', None, 200, 'theirs'),
    ('anonymous', 'GET', '/documents/{doc_venue}/', None, 404, 'the venue tier is not on the ladder'),
    ('volunteer', 'GET', '/documents/{doc_venue}/', None, 404, 'not even for staff — it is somebody else’s'),
    ('organiser', 'GET', '/documents/{doc_venue}/', None, 200,
     'the organiser is the party the building is corresponding WITH'),
    ('venue_admin', 'GET', '/documents/{doc_venue}/', None, 200,
     'venue_admin_check: an APPROVED booking is what makes this building this event’s building'),
    ('venue_admin', 'GET', '/documents/{doc_staff}/', None, 404, 'the building is not event staff'),

    ('anonymous', 'GET', '/documents/{doc_public}/file/', None, 200, 'the bytes are as public as the tier'),
    ('attendee', 'GET', '/documents/{doc_staff}/file/', None, 404, 'the file endpoint re-checks the tier'),
    ('volunteer', 'GET', '/documents/{doc_staff}/file/', None, 404, 'a link document has no bytes'),

    ('anonymous', 'PATCH', '/documents/{doc_staff}/', {'title': 'x'}, 401, 'a write needs a sign-in'),
    ('attendee', 'PATCH', '/documents/{doc_staff}/', {'title': 'x'}, 404, 'below the tier, so it is not there'),
    ('volunteer', 'PATCH', '/documents/{doc_staff}/', {'title': 'x'}, 403, 'readable, not editable'),
    ('organiser', 'PATCH', '/documents/{doc_staff}/', {'title': 'Briefing'}, 200, 'the organiser may'),
    ('volunteer', 'DELETE', '/documents/{doc_staff}/', None, 403, 'same'),
    ('organiser', 'DELETE', '/documents/{doc_staff}/', None, 204, 'a tombstone, so the receipts still answer'),
    ('volunteer', 'POST', '/documents/{doc_staff}/replace/', _REPLACEMENT, 403, 'same'),
    ('organiser', 'POST', '/documents/{doc_staff}/replace/', _REPLACEMENT, 201,
     'a NEW row at version+1 — every acknowledgement stays attached to the text it was made about'),

    ('anonymous', 'POST', '/documents/{doc_staff}/acknowledge/', None, 401, '"I have read it" is somebody’s'),
    ('attendee', 'POST', '/documents/{doc_staff}/acknowledge/', None, 404, 'below the tier'),
    ('volunteer', 'POST', '/documents/{doc_staff}/acknowledge/', None, 200, 'again is the same as once'),
    ('clerk', 'POST', '/documents/{doc_staff}/acknowledge/', None, 200, 'the reading that unlocks the desk'),
    ('anonymous', 'GET', '/documents/undefined/', None, 404, 'not a number, so not a thing'),

    # ---- E. the rota (17BF.E) ------------------------------------------------------------------
    ('anonymous', 'GET', '/events/{event}/stations/', None, 401, 'a rota is staff-only'),
    ('stranger', 'GET', '/events/{event}/stations/', None, 404,
     'for somebody who does not help run this event, its rota does not exist'),
    ('attendee', 'GET', '/events/{event}/stations/', None, 404, 'same'),
    ('volunteer', 'GET', '/events/{event}/stations/', None, 200, 'the open-shift board'),
    ('reviewer', 'GET', '/events/{event}/stations/', None, 200, 'staff'),
    ('organiser', 'GET', '/events/{event}/stations/', None, 200, 'the coverage grid'),
    ('volunteer', 'POST', '/events/{event}/stations/', _NEW_STATION, 403, 'a volunteer writes no rota'),
    ('reviewer', 'POST', '/events/{event}/stations/', _NEW_STATION, 403, 'nor a reviewer'),
    ('organiser', 'POST', '/events/{event}/stations/', _NEW_STATION, 201, 'the organiser may'),
    ('attendee', 'POST', '/events/{event}/stations/', _NEW_STATION, 404, 'not staff at all'),

    ('volunteer', 'GET', '/events/{event}/coverage/', None, 403,
     'how short the rota is, is an organiser’s number'),
    ('organiser', 'GET', '/events/{event}/coverage/', None, 200, 'the grid’s own colours'),
    ('attendee', 'GET', '/events/{event}/coverage/', None, 404, 'not staff at all'),
    ('anonymous', 'GET', '/events/{event}/my-shifts/', None, 401, 'an agenda is somebody’s'),
    ('volunteer', 'GET', '/events/{event}/my-shifts/', None, 200, 'their own'),
    ('organiser', 'GET', '/events/{event}/my-shifts/', None, 200, 'an empty one is still theirs'),
    ('attendee', 'GET', '/events/{event}/my-shifts/', None, 404, 'not staff at all'),
    ('volunteer', 'GET', '/events/{event}/my-shifts.ics', None, 200, 'the file is the same data'),
    ('volunteer', 'GET', '/events/{event}/volunteers/', None, 403,
     'the safeguarding records are the organiser’s, and they name minors'),
    ('organiser', 'GET', '/events/{event}/volunteers/', None, 200, 'theirs'),
    ('organiser', 'POST', '/events/{event}/volunteers/', _record_body, 201, 'consent is recorded by them'),
    ('volunteer', 'PATCH', '/volunteer-records/{record}/', {'consent_note': 'x'}, 403, 'not their own record'),
    ('organiser', 'PATCH', '/volunteer-records/{record}/', {'consent_note': 'Zgoda na papierze'}, 200,
     'the organiser keeps it'),

    ('stranger', 'PATCH', '/stations/{cloak_station}/', {'name': 'x'}, 404, 'no rota here for them'),
    ('volunteer', 'PATCH', '/stations/{cloak_station}/', {'name': 'x'}, 403, 'staff, but not an organiser'),
    ('organiser', 'PATCH', '/stations/{cloak_station}/', {'name': 'Szatnia A'}, 200, 'the organiser may'),
    ('volunteer', 'GET', '/stations/{cloak_station}/shifts/', None, 200, 'staff read the rota'),
    ('attendee', 'GET', '/stations/{cloak_station}/shifts/', None, 404, 'not staff at all'),
    ('volunteer', 'POST', '/stations/{info_station}/shifts/', _shift_body, 403, 'not an organiser'),
    ('organiser', 'POST', '/stations/{info_station}/shifts/', _shift_body, 201, 'the organiser may'),
    ('volunteer', 'PATCH', '/shifts/{open_shift}/', {'needed': 3}, 403, 'same'),
    ('organiser', 'PATCH', '/shifts/{open_shift}/', {'needed': 3}, 200, 'the organiser may'),
    ('organiser', 'DELETE', '/shifts/{open_shift}/', None, 204, 'same'),

    ('anonymous', 'POST', '/shifts/{open_shift}/claim/', None, 401, 'a shift is somebody’s'),
    ('stranger', 'POST', '/shifts/{open_shift}/claim/', None, 404, 'no rota here for them'),
    ('attendee', 'POST', '/shifts/{open_shift}/claim/', None, 404, 'same'),
    ('volunteer', 'POST', '/shifts/{open_shift}/claim/', None, 201, 'exactly what the role is for'),
    ('volunteer', 'POST', '/shifts/{cloak_shift}/claim/', None, 409,
     'already_assigned — a reason, not a silent no (house rule 6)'),
    ('reviewer', 'POST', '/shifts/{open_shift}/claim/', None, 409,
     'not_volunteer: staff, but self-service claiming stays with the role created for it'),
    ('organiser', 'POST', '/shifts/{open_shift}/claim/', None, 409,
     'organiser_assigns — told something different from a stranger, because they can fix it'),
    ('volunteer', 'POST', '/shifts/{cloak_shift}/drop/', None, 200, 'their own, well outside the cutoff'),
    ('reviewer', 'POST', '/shifts/{cloak_shift}/drop/', None, 404, 'nothing of theirs on that shift'),
    ('organiser', 'POST', '/shifts/{cloak_shift}/drop/', _assignment_body, 200,
     'an organiser may drop anybody, at any time, by naming the assignment'),
    ('volunteer', 'POST', '/shifts/{open_shift}/assign/', _assign_body, 403, 'only an organiser assigns'),
    ('organiser', 'POST', '/shifts/{open_shift}/assign/', _assign_body, 201, 'the organiser may'),
    ('organiser', 'POST', '/shifts/{open_shift}/assign/', _assign_outsider_body, 409,
     'not_volunteer: an organiser may put a reviewer on the door, but not somebody off the staff'),
    ('volunteer', 'POST', '/shifts/{open_shift}/confirm/', _claimed_assignment_body, 403, 'not an organiser'),
    ('organiser', 'POST', '/shifts/{open_shift}/confirm/', _claimed_assignment_body, 200, 'the organiser may'),
    ('organiser', 'POST', '/shifts/{open_shift}/no-show/', _claimed_assignment_body, 200, 'same'),
    ('organiser', 'POST', '/shifts/{cloak_shift}/done/', _assignment_body, 200,
     'passive hours logging — the organiser marks it afterwards'),
    ('organiser', 'POST', '/shifts/{cloak_shift}/confirm/', _assignment_body, 409,
     'already_decided — a second click is the world having moved'),
    ('anonymous', 'GET', '/my-volunteering/', None, 401, 'somebody’s own hours'),
    ('volunteer', 'GET', '/my-volunteering/', None, 200, 'theirs'),
    ('attendee', 'GET', '/my-volunteering/', None, 200, 'an empty one is still theirs'),
    ('anonymous', 'GET', '/shifts/undefined/', None, 404, 'not a number, so not a thing'),
    ('anonymous', 'GET', '/stations/undefined/', None, 404, 'same'),
    ('organiser', 'PATCH', '/volunteer-records/undefined/', {'consent_note': 'x'}, 404, 'same'),

    # ---- F. the cloakroom desk (17BF.F) --------------------------------------------------------
    ('anonymous', 'GET', '/events/{event}/cloakroom-desks/', None, 200,
     'an attendee needs to be told there IS a cloakroom; the rack grid is not in that answer'),
    ('attendee', 'GET', '/events/{event}/cloakroom-desks/', None, 200, 'same'),
    ('volunteer', 'GET', '/events/{event}/cloakroom-desks/', None, 200, 'plus the counter'),
    ('anonymous', 'GET', '/events/{draft}/cloakroom-desks/', None, 404, 'a draft does not exist for them'),
    ('anonymous', 'POST', '/events/{event}/cloakroom-desks/', _NEW_DESK, 401, 'a write needs a sign-in'),
    ('stranger', 'POST', '/events/{event}/cloakroom-desks/', _NEW_DESK, 403, 'not theirs'),
    ('volunteer', 'POST', '/events/{event}/cloakroom-desks/', _NEW_DESK, 403,
     'hanging coats is a shift; deciding there are 120 hooks is running the event'),
    ('organiser', 'POST', '/events/{event}/cloakroom-desks/', _NEW_DESK, 201, 'the organiser may'),
    ('anonymous', 'GET', '/cloakroom-desks/{desk}/', None, 200, 'the "there is a cloakroom at…" line'),
    ('attendee', 'GET', '/cloakroom-desks/{desk}/', None, 200, 'same'),
    ('volunteer', 'GET', '/cloakroom-desks/{desk}/', None, 200, 'the whole counter'),
    ('anonymous', 'PATCH', '/cloakroom-desks/{desk}/', {'name': 'x'}, 401, 'a write needs a sign-in'),
    ('volunteer', 'PATCH', '/cloakroom-desks/{desk}/', {'name': 'x'}, 403, 'organiser-only, like creating it'),
    ('organiser', 'PATCH', '/cloakroom-desks/{desk}/', {'name': 'Szatnia — północ'}, 200, 'the organiser may'),
    ('volunteer', 'DELETE', '/cloakroom-desks/{desk}/', None, 403, 'same'),
    ('organiser', 'DELETE', '/cloakroom-desks/{desk}/', None, 409,
     'has_items — a desk that took a coat is a record of an evening; closing it is reconcile'),

    ('anonymous', 'GET', '/cloakroom-desks/{desk}/items/', None, 401, 'what is on the racks is not public'),
    ('attendee', 'GET', '/cloakroom-desks/{desk}/items/', None, 403, 'leaving a coat is not working the desk'),
    ('reviewer', 'GET', '/cloakroom-desks/{desk}/items/', None, 403,
     'THE row this step needs: staff, but no CONFIRMED cloakroom place on the rota'),
    ('volunteer', 'GET', '/cloakroom-desks/{desk}/items/', None, 200, 'the rota says they work this counter'),
    ('organiser', 'GET', '/cloakroom-desks/{desk}/items/', None, 200, 'they built the rota'),
    ('anonymous', 'POST', '/cloakroom-desks/{desk}/items/', _DEPOSIT, 401, 'a write needs a sign-in'),
    ('reviewer', 'POST', '/cloakroom-desks/{desk}/items/', _DEPOSIT, 403, 'not_staff at this counter'),
    ('volunteer', 'POST', '/cloakroom-desks/{desk}/items/', _DEPOSIT, 201, 'the token is minted here, once'),
    ('clerk', 'POST', '/cloakroom-desks/{desk}/items/', _DEPOSIT, 409,
     'briefing_unread — a clerk who has not read the building’s briefing does not take coats'),
    ('volunteer', 'POST', '/cloakroom-desks/{desk}/items/', _DEPOSIT_TAKEN, 409,
     'rack_taken, re-read from the database rather than trusted from the grid on screen'),
    ('volunteer', 'POST', '/cloakroom-desks/{desk}/items/', _DEPOSIT_NOWHERE, 400,
     'unknown_rack: a hook this desk does not have — wrong when it was written, so 400 not 409'),
    ('volunteer', 'POST', '/cloakroom-desks/{desk}/return/', _token_body, 200, 'the slip, and the coat'),
    ('volunteer', 'POST', '/cloakroom-desks/{desk}/return/', {'token': 'NOSUCH12'}, 200,
     'unknown_token is a VERDICT the clerk says out loud, not an HTTP status'),
    ('reviewer', 'POST', '/cloakroom-desks/{desk}/return/', _token_body, 403, 'not at this counter'),
    ('clerk', 'POST', '/cloakroom-desks/{desk}/return/', _token_body, 409, 'briefing_unread'),
    ('volunteer', 'POST', '/cloakroom-desks/{desk}/items/{coat}/return/', None, 200,
     'the slip that went through the wash, addressed by the hook instead'),
    ('organiser', 'POST', '/cloakroom-desks/{desk}/items/{coat}/return/', None, 200, 'same'),
    ('reviewer', 'POST', '/cloakroom-desks/{desk}/items/{coat}/return/', None, 403, 'not at this counter'),
    ('volunteer', 'POST', '/cloakroom-desks/{desk}/items/{coat}/return-by-exception/', _EXCEPTION, 200,
     'what the coat looks like and what KIND of identity was shown — never a document number'),
    ('volunteer', 'POST', '/cloakroom-desks/{desk}/items/{coat}/return-by-exception/',
     _EXCEPTION_ANONYMOUS, 400,
     'identity_required: the exception path exists because somebody proved something'),
    ('reviewer', 'POST', '/cloakroom-desks/{desk}/items/{coat}/return-by-exception/', _EXCEPTION, 403,
     'not at this counter'),
    ('volunteer', 'POST', '/cloakroom-desks/{desk}/reconcile/', None, 200, 'closing the desk is clerk work'),
    ('reviewer', 'POST', '/cloakroom-desks/{desk}/reconcile/', None, 403, 'not at this counter'),
    ('attendee', 'GET', '/cloakroom-desks/{desk}/export/', None, 403, 'the evening is not theirs'),
    ('reviewer', 'GET', '/cloakroom-desks/{desk}/export/', None, 403, 'nor theirs'),
    ('volunteer', 'GET', '/cloakroom-desks/{desk}/export/', None, 200, 'six columns and not one is a person'),
    ('anonymous', 'GET', '/cloakroom-desks/undefined/', None, 404, 'not a number, so not a thing'),
    ('volunteer', 'POST', '/cloakroom-desks/{desk}/items/undefined/return/', None, 404,
     'a nested id that is not a number is not a row — this was a 500 until 17BF.H'),
    ('volunteer', 'POST', '/cloakroom-desks/{desk}/items/undefined/return-by-exception/', _EXCEPTION, 404,
     'same'),

    # ---- G. exports (17BF.G) -------------------------------------------------------------------
    ('anonymous', 'GET', '/events/{event}/exports/needs/', None, 401, 'a count of four is nearly a name'),
    ('stranger', 'GET', '/events/{event}/exports/needs/', None, 403, 'real thing, wrong party'),
    ('attendee', 'GET', '/events/{event}/exports/needs/', None, 403, 'same'),
    ('volunteer', 'GET', '/events/{event}/exports/needs/', None, 403,
     'organisers only although it has no identifiers — on a small event it very nearly does'),
    ('reviewer', 'GET', '/events/{event}/exports/needs/', None, 403, 'same'),
    ('organiser', 'GET', '/events/{event}/exports/needs/', None, 200, 'catering and the room'),
    ('stranger', 'GET', '/events/{draft}/exports/needs/', None, 404, 'a draft does not exist for them'),
    ('anonymous', 'GET', '/events/{event}/exports/door-list.csv/', None, 401, 'the file names people'),
    ('attendee', 'GET', '/events/{event}/exports/door-list.csv/', None, 403, 'real thing, wrong party'),
    ('volunteer', 'GET', '/events/{event}/exports/door-list.csv/', None, 200,
     'the point of it: a volunteer who can only get this file cannot forward the other one'),
    ('reviewer', 'GET', '/events/{event}/exports/door-list.csv/', None, 200, 'staff'),
    ('organiser', 'GET', '/events/{event}/exports/door-list.csv/', None, 200, 'staff'),
    ('anonymous', 'GET', '/events/{event}/exports/log/', None, 401, 'it names staff'),
    ('volunteer', 'GET', '/events/{event}/exports/log/', None, 403, 'who took a file out is the organiser’s'),
    ('reviewer', 'GET', '/events/{event}/exports/log/', None, 403, 'same'),
    ('organiser', 'GET', '/events/{event}/exports/log/', None, 200, 'theirs'),
]
