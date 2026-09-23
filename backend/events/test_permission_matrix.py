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

from datetime import timedelta

from django.db import transaction
from django.utils import timezone
from rest_framework.test import APITestCase

from testing.factories import make_branch
from testing.personas import make_personas

from .models import Contribution, Event, EventAttendance


class _Rollback(Exception):
    """Raised at the end of every row to undo whatever that row wrote. Never escapes the loop."""


class PermissionMatrixTests(APITestCase):
    """One test method, driven by MATRIX through `subTest` — a failing row names itself and the
    rest still run, which is the whole reason not to write this as a hundred methods."""

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

#: (persona, method, path, body, expected status, why). Paths are formatted with `cls.ids` and get
#: an `/api` prefix. `None` as a body means "send nothing".
MATRIX = [
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
    ('volunteer', 'GET', '/events/{event}/registrations/export/', None, 200, 'staff'),
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
]
