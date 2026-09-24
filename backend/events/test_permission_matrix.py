"""The events permission matrix — one declarative table, one test, one row per (persona, method,
path, body, expected status). CONFERENCE-BRIEF.md §3.B.

WHY A TABLE. The alternative is a hundred small tests, each of which says one true thing and none
of which says what the *shape* is. A table can be read down a column: "here is everything a
volunteer may not do", which is the question somebody actually has. It is also the shape that
survives new endpoints — adding one is adding rows, not writing a new file.

    ┌──────────────────────────── HOW TO ADD YOUR ROWS ─────────────────────────────────────┐
    │ Append a block to MATRIX below, with your step's letter in the comment heading. Use   │
    │ the ids `setUpTestData` already publishes (`event`, `draft`, `session`, `attendance`,  │
    │ `contribution`, `staff_volunteer`, …) and add your own there if you need more. The     │
    │ personas come from `testing/personas.make_personas()`, so your rows and the seed       │
    │ command are talking about the same seven accounts; a persona only this table needs is  │
    │ built in `setUpTestData` instead (`venue_admin`, `clerk`, `participant` — each says    │
    │ why, where it is made). Every endpoint your step adds needs at least: the role that    │
    │ may (a 2xx), one staff role that may not (403), a stranger (403 or 404), and           │
    │ anonymous (401 for a write, or 404 on a draft).                                        │
    │ An expectation is a status, or a **(status, refusal word)** pair — use the pair        │
    │ wherever your rule module answers a word (house rule 6), because the number alone      │
    │ passes just as happily on the wrong reason.                                            │
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
from coauthoring.models import MaterialProject, ProjectMember
from config import nodes as node_seam
from courses.models import Course, Enrollment
from decisions.models import Ballot, Poll, PollOption
from documents.models import DocumentAcknowledgement, EventDocument
from needs.models import Need, NeedApplication
from organizations import services as organization_services
from organizations.models import OrganizationLink, OrganizationMember
from plans.models import Plan
from shifts.models import Assignment, Shift, Station, VolunteerRecord
from tasks.models import Task, TaskAssignee
from testing.factories import make_branch, make_material, make_user
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

        # ---- the management layer (MANAGEMENT-BRIEF.md §3.A–F, wired at §5) ---------------------
        #
        # ONE EXTRA PERSONA, built here for the reason the conference two were: `participant` is
        # somebody who is *in the room* and runs nothing — enrolled on a course, on no staff list
        # anywhere. The demo seven have no such person. An attendee is the nearest, and an attendee
        # is a member of an EVENT, so a course's "member but not staff" tier — the tier that answers
        # "may they see the task board" (no) and "may they vote in an `eligibility: members` poll"
        # (yes) — would have no row at all. Kept out of `make_personas()` so that
        # `seed_conference_personas`, its printed CAPABILITY_TABLE and the browser script that signs
        # in as its accounts do not grow a course and six more kill switches for a tier the event
        # page never draws.
        participant = make_user('persona.participant')
        cls.people['participant'] = participant

        # Every node kind the seam knows (`config/nodes.py: NODE_KINDS`), so the nested
        # `/api/nodes/{kind}/{id}/…` lists are exercised on all four rather than four times on an
        # event — each kind answers `is_node_staff` from a different roster, which is the whole
        # reason that module exists. `organiser` runs all of them: the persona means "the person who
        # runs this", and a different owner per node would only be testing Django's foreign keys.
        course = Course.objects.create(
            instructor=organiser, title='Sandbox course', visibility='public', status='open'
        )
        Enrollment.objects.create(course=course, participant=participant, status='active')
        # Unlisted — the 404 column for a course, exactly as `draft` is for an event.
        private_course = Course.objects.create(
            instructor=organiser, title='Sandbox course, unlisted', visibility='only_you'
        )
        # A material whose authority is its co-authoring project, and a bare one with no project at
        # all — the case `config/nodes.py` answers with platform `is_staff`, which no persona here
        # is. The reviewer is a co-author and not the owner, so "on the team" and "runs the team"
        # are two different answers on a material as well as on an event.
        material = make_material(branch, slug='sandbox-material')
        bare_material = make_material(branch, slug='sandbox-material-no-project')
        # `MaterialProject.save()` seats its creator as owner, the way `Course.save()` does — so
        # only the co-author row is made here.
        project = MaterialProject.objects.create(
            material=material, branch=branch, created_by=organiser
        )
        ProjectMember.objects.create(
            project=project, user=built['reviewer'], role='coauthor', added_by=organiser
        )

        # A. An organisation with exactly ONE owner — which is what makes `last_owner` a row rather
        # than a sentence — one plain member, and a badge already on the Sandbox conference so that
        # `already_linked` has something to collide with. Plus a dissolved one, whose page exists
        # for its own roster and for nobody else.
        organization = organization_services.found(
            creator=organiser, name='Koło Naukowe Sandbox', kind='student_circle'
        )
        org_owner_row = organization.members.get(user=organiser)
        org_member_row = OrganizationMember.objects.create(
            organization=organization, user=built['volunteer'], role='member', added_by=organiser
        )
        org_link = OrganizationLink.objects.create(
            organization=organization,
            content_type=node_seam.node_content_type(event),
            object_id=event.pk,
            kind='runs',
            added_by=organiser,
        )
        dissolved = organization_services.found(
            creator=built['reviewer'], name='Sandbox, rozwiązane'
        )
        dissolved.is_active = False
        dissolved.save(update_fields=['is_active'])
        dissolved_row = dissolved.members.get(user=built['reviewer'])

        # B. A task with a subtask (so `has_subtasks` and `nested` are rows), the volunteer carrying
        # it (so "an assignee may edit but may not assign" is a row), and a finished one, because
        # reopening is the one transition that asks who you are rather than where the task is.
        event_ct = node_seam.node_content_type(event)
        task = Task.objects.create(
            content_type=event_ct, object_id=event.pk,
            title='Print the badges', created_by=organiser,
        )
        subtask = Task.objects.create(
            content_type=event_ct, object_id=event.pk, parent=task,
            title='Collect the artwork', created_by=organiser,
        )
        TaskAssignee.objects.create(task=task, user=built['volunteer'], assigned_by=organiser)
        done_task = Task.objects.create(
            content_type=event_ct, object_id=event.pk, title='Book the hall',
            status='done', done_at=timezone.now(), created_by=organiser,
        )
        TaskAssignee.objects.create(task=done_task, user=built['volunteer'], assigned_by=organiser)

        # C. An open posting with one pending application, a full one (accepted == wanted, which is
        # `full` without anybody having to be refused twice), and a cancelled one — the three states
        # `apply_block_reason` answers differently. Plus one on the DRAFT event, which is how "a
        # need on a node you cannot see does not exist" gets a row of its own.
        need_open = Need.objects.create(
            content_type=event_ct, object_id=event.pk, title='Somebody to work the door',
            kind='help', status='open', wanted_count=2, created_by=organiser,
        )
        app_pending = NeedApplication.objects.create(
            need=need_open, user=built['stranger'], message='I can do the morning.'
        )
        need_full = Need.objects.create(
            content_type=event_ct, object_id=event.pk, title='A projector',
            kind='equipment', status='open', wanted_count=1, created_by=organiser,
        )
        app_decided = NeedApplication.objects.create(
            need=need_full, user=built['attendee'], status='accepted',
            decided_by=organiser, decided_at=timezone.now(),
        )
        need_cancelled = Need.objects.create(
            content_type=event_ct, object_id=event.pk, title='A second room',
            kind='venue', status='cancelled', created_by=organiser,
        )
        need_hidden = Need.objects.create(
            content_type=event_ct, object_id=draft.pk, title='Nobody may read this',
            kind='help', status='open', created_by=organiser,
        )

        # D. An active plan with one done step, one pending step (so `steps_pending` is a row) and a
        # sub-step (so `nested` is), one pending suggestion and one already decided; plus a draft
        # plan, which ordinary staff may read and only its editors may move.
        plan_active = Plan.objects.create(
            content_type=event_ct, object_id=event.pk, title='Getting the conference open',
            status='active', created_by=organiser,
        )
        step_done = plan_active.steps.create(
            title='Book the hall', status='done', order=0,
            done_by=organiser, done_at=timezone.now(),
        )
        step_pending = plan_active.steps.create(title='Print the programme', order=1)
        substep = plan_active.steps.create(parent=step_pending, title='Proof-read it', order=0)
        suggestion = plan_active.suggestions.create(
            user=built['attendee'], text='Add a coffee break after the opening lecture.'
        )
        suggestion_decided = plan_active.suggestions.create(
            user=built['stranger'], text='Move it to June.', status='rejected',
            decided_by=organiser, decided_at=timezone.now(),
        )
        plan_draft = Plan.objects.create(
            content_type=event_ct, object_id=event.pk, title='Next year',
            status='draft', created_by=organiser,
        )
        draft_step = plan_draft.steps.create(title='Pick the dates', order=0)

        # E. One poll in each status, plus a second open one whose eligibility is `staff` — which is
        # what makes "being in the room is not being on the rota" a row. The closed one is the
        # anonymous one: its votes carry no ballot, so "who took part" and "what they chose" stay
        # two different questions even to the manager who closed it.
        poll_draft = Poll.objects.create(
            content_type=event_ct, object_id=event.pk, question='Which day for the workshop?',
            status='draft', eligibility='members', created_by=organiser,
        )
        draft_option = PollOption.objects.create(poll=poll_draft, text='Saturday', order=0)
        PollOption.objects.create(poll=poll_draft, text='Sunday', order=1)
        # No options at all: the one poll `no_options` can be refused on.
        poll_bare = Poll.objects.create(
            content_type=event_ct, object_id=event.pk, question='Nothing to choose from yet',
            status='draft', eligibility='members', created_by=organiser,
        )
        poll_open = Poll.objects.create(
            content_type=event_ct, object_id=event.pk, question='Coffee or tea?',
            status='open', mode='single', eligibility='members', created_by=organiser,
        )
        open_option_a = PollOption.objects.create(poll=poll_open, text='Coffee', order=0)
        open_option_b = PollOption.objects.create(poll=poll_open, text='Tea', order=1)
        # The attendee has already been to this one — `already_voted` without any row having to vote.
        Ballot.objects.create(poll=poll_open, user=built['attendee'])
        poll_staff = Poll.objects.create(
            content_type=event_ct, object_id=event.pk, question='Who locks up on Sunday?',
            status='open', mode='single', eligibility='staff', created_by=organiser,
        )
        PollOption.objects.create(poll=poll_staff, text='The organiser', order=0)
        PollOption.objects.create(poll=poll_staff, text='The volunteer', order=1)
        poll_closed = Poll.objects.create(
            content_type=event_ct, object_id=event.pk, question='Where next year?',
            status='closed', anonymous=True, eligibility='members', created_by=organiser,
            closed_by=organiser, closed_at=timezone.now(), decision_note='Banacha again.',
        )
        closed_option = PollOption.objects.create(poll=poll_closed, text='Banacha', order=0)
        PollOption.objects.create(poll=poll_closed, text='Hoża', order=1)

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
            # ---- the management layer's own ids (steps A–F) -------------------------------
            'course': course.pk,
            'private_course': private_course.pk,
            'material': material.pk,
            'bare_material': bare_material.pk,
            'org': organization.pk,
            'dissolved': dissolved.pk,
            'org_owner_row': org_owner_row.pk,
            'org_member_row': org_member_row.pk,
            'dissolved_row': dissolved_row.pk,
            'org_link': org_link.pk,
            'task': task.pk,
            'subtask': subtask.pk,
            'done_task': done_task.pk,
            'need_open': need_open.pk,
            'need_full': need_full.pk,
            'need_cancelled': need_cancelled.pk,
            'need_hidden': need_hidden.pk,
            'app_pending': app_pending.pk,
            'app_decided': app_decided.pk,
            'plan_active': plan_active.pk,
            'plan_draft': plan_draft.pk,
            'step_done': step_done.pk,
            'step_pending': step_pending.pk,
            'substep': substep.pk,
            'draft_step': draft_step.pk,
            'suggestion': suggestion.pk,
            'suggestion_decided': suggestion_decided.pk,
            'poll_draft': poll_draft.pk,
            'poll_bare': poll_bare.pk,
            'poll_open': poll_open.pk,
            'poll_staff': poll_staff.pk,
            'poll_closed': poll_closed.pk,
            'draft_option': draft_option.pk,
            'open_option_a': open_option_a.pk,
            'open_option_b': open_option_b.pk,
            'closed_option': closed_option.pk,
            'participant_id': participant.pk,
            'guardian_id': built['guardian'].pk,
            'organiser_id': organiser.pk,
        }
        cls.event_start = event.starts_at

    def _body_for(self, body):
        """A body may be a plain value or a callable taking the ids — the latter for anything that
        has to name a real instant or a real id."""
        return body(self.ids, self.event_start) if callable(body) else body

    def test_matrix(self):
        for persona, method, path, body, expected, why in MATRIX:
            # A row's expectation is a status, or a (status, refusal word) pair. The pair is what
            # house rule 6 asks of a refusal — `enrollment_block_reason` and its cousins answer
            # WHY, and a row that only checked the number would pass just as happily on the wrong
            # reason. Added with the management rows (§17BI.H); the conference rows above are
            # statuses because their refusal words are asserted in each app's own suite.
            expected_status, expected_word = (
                expected if isinstance(expected, tuple) else (expected, None)
            )
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
                            response.status_code, expected_status,
                            f'{label}\n  got {response.status_code}: '
                            f'{getattr(response, "data", b"")!r:.200}',
                        )
                        if expected_word is not None:
                            data = getattr(response, 'data', None) or {}
                            self.assertEqual(
                                data.get('detail'), expected_word,
                                f'{label}\n  right status, wrong word: {data!r:.200}',
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


# ---- bodies for the management layer (steps A–F) ---------------------------------------------
#
# Each of these is a factory rather than a literal because the body has to name a real id, and the
# ids are not known until `setUpTestData` has run — the same reason the conference bodies above are
# callables. `_body_for` calls them with (ids, event_start).


def _member_body(key, role='member'):
    return lambda ids, _s: {'user_id': ids[key], 'role': role}


def _role_body(role):
    return {'role': role}


def _link_body(kind, key, link_kind='runs'):
    return lambda ids, _s: {'node_kind': kind, 'node_id': ids[key], 'kind': link_kind}


def _user_body(key):
    return lambda ids, _s: {'user': ids[key]}


def _vote_body(*keys):
    return lambda ids, _s: {'options': [ids[key] for key in keys]}


def _reorder_body(*keys):
    return lambda ids, _s: {'ids': [ids[key] for key in keys]}


def _parent_step_body(key):
    return lambda ids, _s: {'title': 'A step under a step', 'parent': ids[key]}


_NEW_ORGANIZATION = {'name': 'Nowe koło', 'kind': 'student_circle'}
_NEW_TASK = {'title': 'Something that needs doing'}
_NEW_NEED = {'title': 'Somebody who can bake', 'kind': 'help', 'wanted_count': 1}
_NEW_PLAN = {'title': 'A roadmap'}
_NEW_STEP = {'title': 'A step'}
_NEW_POLL = {'question': 'Shall we?', 'mode': 'single', 'eligibility': 'members'}
_NEW_OPTION = {'text': 'Maybe'}
_NEW_SUGGESTION = {'text': 'Please add a break for lunch.'}
_APPLY = {'message': 'I can help on the Saturday.'}
_ACCEPT = {'decision': 'accept'}

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

    # ==== the management layer (MANAGEMENT-BRIEF.md §3, integrated at §5) =======================
    #
    # Six apps hang off one seam (`config/nodes.py`), so the rows below are grouped by step and
    # every one of them is really two questions: what does the SEAM say about this node, and what
    # does the app's own rule module say about this row. The `(status, word)` pairs are the second
    # half of house rule 6 — the number says a refusal happened, the word says which sentence the
    # frontend draws.

    # ---- the node seam itself (config/views.py) ------------------------------------------------
    ('anonymous', 'GET', '/nodes/event/{event}/', None, 200,
     'a public event is a node anybody may ask about; every standing comes back false'),
    ('stranger', 'GET', '/nodes/event/{draft}/', None, 404, 'a draft node does not exist for them'),
    ('organiser', 'GET', '/nodes/event/{draft}/', None, 200, 'its host'),
    ('anonymous', 'GET', '/nodes/course/{course}/', None, 200, 'a listed course is public'),
    ('stranger', 'GET', '/nodes/course/{private_course}/', None, 404, 'only_you — not for them'),
    ('organiser', 'GET', '/nodes/course/{private_course}/', None, 200, 'they run it'),
    ('anonymous', 'GET', '/nodes/material/{material}/', None, 200, 'a material is public content'),
    ('anonymous', 'GET', '/nodes/organization/{org}/', None, 200, 'an active body is public'),
    ('stranger', 'GET', '/nodes/organization/{dissolved}/', None, 404,
     'a dissolved body exists for its own roster and for nobody else'),
    ('reviewer', 'GET', '/nodes/organization/{dissolved}/', None, 200, 'its owner'),
    ('anonymous', 'GET', '/nodes/exercise/{event}/', None, 404, 'not a node kind this seam knows'),
    ('anonymous', 'GET', '/nodes/event/undefined/', None, 404, 'not a number, so not a thing'),

    ('anonymous', 'GET', '/nodes/event/{event}/staff/', None, 401, 'a roster is nobody’s by default'),
    ('stranger', 'GET', '/nodes/event/{event}/staff/', None, 404, 'the event is visible, the roster is not'),
    ('attendee', 'GET', '/nodes/event/{event}/staff/', None, 404,
     'in the room is not on the rota — 404 rather than 403, as on the node itself'),
    ('volunteer', 'GET', '/nodes/event/{event}/staff/', None, 200, 'staff see who else is'),
    ('participant', 'GET', '/nodes/course/{course}/staff/', None, 404, 'enrolled is not staff'),
    ('organiser', 'GET', '/nodes/course/{course}/staff/', None, 200, 'they run it'),
    ('reviewer', 'GET', '/nodes/material/{material}/staff/', None, 200, 'a co-author is on the team'),
    ('attendee', 'GET', '/nodes/material/{bare_material}/staff/', None, 404,
     'a material with no project answers is_staff = platform staff, which no persona here is'),
    ('volunteer', 'GET', '/nodes/organization/{org}/staff/', None, 200,
     'an organisation’s roster has no reader tier — member and staff are one set'),
    ('stranger', 'GET', '/nodes/organization/{org}/staff/', None, 404, 'not on it'),
    ('organiser', 'GET', '/nodes/event/undefined/staff/', None, 404, 'not a number, so not a thing'),

    # ---- A. organisations (17BI.A) -------------------------------------------------------------
    ('anonymous', 'GET', '/organizations/', None, 200, 'the directory is public'),
    ('anonymous', 'GET', '/organizations/{org}/', None, 200, 'so is a body’s page'),
    ('stranger', 'GET', '/organizations/{dissolved}/', None, 404, 'dissolved — for them it is gone'),
    ('reviewer', 'GET', '/organizations/{dissolved}/', None, 200, 'its own people keep the page'),
    ('anonymous', 'POST', '/organizations/', _NEW_ORGANIZATION, 401, 'a write needs a sign-in'),
    ('child', 'POST', '/organizations/', _NEW_ORGANIZATION, (403, 'minor'),
     'founding one means being the person a stranger writes to about it'),
    ('attendee', 'POST', '/organizations/', _NEW_ORGANIZATION, 201, 'any adult may found one'),
    ('anonymous', 'PATCH', '/organizations/{org}/', {'city': 'Warszawa'}, 401, 'a write needs a sign-in'),
    ('stranger', 'PATCH', '/organizations/{org}/', {'city': 'Warszawa'}, (403, 'not_org_manager'),
     'the page is visible, so 403 rather than 404 — a real thing, wrong party'),
    ('volunteer', 'PATCH', '/organizations/{org}/', {'city': 'Warszawa'}, (403, 'not_org_manager'),
     'a plain member is on the roster, not in charge of it'),
    ('organiser', 'PATCH', '/organizations/{org}/', {'city': 'Warszawa'}, 200, 'its owner'),
    # `not_org_owner`, not `not_org_manager`: an administrator runs the roster, and only an owner
    # decides the body is over — the row was written expecting the manager word and the app was
    # right (organizations/views.py: OrganizationViewSet.destroy).
    ('volunteer', 'DELETE', '/organizations/{org}/', None, (403, 'not_org_owner'), 'not theirs to end'),
    ('organiser', 'DELETE', '/organizations/{org}/', None, 204, 'an owner decides the body is over'),

    ('anonymous', 'GET', '/organizations/{org}/members/', None, 200,
     'a body’s membership is what it is FOR; hiding it leaves a name and nothing else'),
    ('anonymous', 'POST', '/organizations/{org}/members/', _member_body('attendee_id'), 401,
     'a write needs a sign-in'),
    ('volunteer', 'POST', '/organizations/{org}/members/', _member_body('attendee_id'),
     (403, 'not_org_manager'), 'a member does not add members'),
    ('organiser', 'POST', '/organizations/{org}/members/', _member_body('attendee_id'), 201,
     'by account id — there is no people search'),
    ('organiser', 'POST', '/organizations/{org}/members/', _member_body('volunteer_id'),
     (409, 'already_member'), 'the world moved, not a malformed request'),
    ('organiser', 'POST', '/organizations/{org}/members/', {'user_id': 99999999},
     (400, 'no_such_user'), 'an id that names nobody is wrong when it was written, so 400'),
    ('organiser', 'PATCH', '/organization-members/{org_owner_row}/', _role_body('member'),
     (409, 'last_owner'), 'demoting the last owner leaves a page nobody can ever correct'),
    ('organiser', 'DELETE', '/organization-members/{org_owner_row}/', None, (409, 'last_owner'),
     'and removing them is the same end state, so the same word'),
    ('volunteer', 'PATCH', '/organization-members/{org_member_row}/', _role_body('admin'),
     (403, 'not_org_manager'), 'nobody promotes themselves'),
    ('organiser', 'PATCH', '/organization-members/{org_member_row}/', _role_body('admin'), 200,
     'an owner may'),
    ('stranger', 'DELETE', '/organization-members/{org_member_row}/', None, (403, 'not_org_manager'),
     'a bystander takes nobody off a roster'),
    ('volunteer', 'DELETE', '/organization-members/{org_member_row}/', None, 204,
     'leaving is not being removed — anybody may take themselves off'),
    ('stranger', 'PATCH', '/organization-members/{dissolved_row}/', _role_body('member'), 404,
     'a row inside a body they cannot see does not exist for them'),

    ('anonymous', 'GET', '/organizations/{org}/links/', None, 200, 'what a body runs is public'),
    ('anonymous', 'POST', '/organizations/{org}/links/', _link_body('course', 'course'), 401,
     'a write needs a sign-in'),
    ('volunteer', 'POST', '/organizations/{org}/links/', _link_body('course', 'course'),
     (403, 'not_org_manager'), 'the badge carries the body’s name, so the body must agree'),
    ('organiser', 'POST', '/organizations/{org}/links/', _link_body('material', 'bare_material'),
     (403, 'not_node_manager'), 'and so must the thing being claimed — both halves, never one'),
    ('organiser', 'POST', '/organizations/{org}/links/', _link_body('event', 'event'),
     (409, 'already_linked'), 'somebody got there first'),
    ('organiser', 'POST', '/organizations/{org}/links/', _link_body('organization', 'org'),
     (400, 'not_linkable'), 'an organisation inside an organisation is a hierarchy A did not model'),
    ('stranger', 'POST', '/organizations/{org}/links/', _link_body('event', 'draft'), 404,
     'a node they cannot see 404s before the question of linking to it is ever asked'),
    ('organiser', 'POST', '/organizations/{org}/links/', _link_body('exercise', 'event'), 404,
     'an unknown kind is nothing, not a bad request'),
    ('organiser', 'POST', '/organizations/{org}/links/', _link_body('course', 'course'), 201,
     'running both ends is what a badge means'),
    ('anonymous', 'DELETE', '/organization-links/{org_link}/', None, 401, 'a write needs a sign-in'),
    ('volunteer', 'DELETE', '/organization-links/{org_link}/', None, (403, 'not_org_manager'),
     'neither end is theirs'),
    ('organiser', 'DELETE', '/organization-links/{org_link}/', None, 204,
     'agreeing takes two, withdrawing takes one'),

    ('anonymous', 'GET', '/organizations/managed/', None, 401, '"where may I act" is personal'),
    ('volunteer', 'GET', '/organizations/managed/', None, 200, 'an empty list is still theirs'),
    ('organiser', 'GET', '/organizations/managed/', None, 200, 'the picker’s own source'),
    ('anonymous', 'GET', '/nodes/event/{event}/organizations/', None, 200, 'the badge on a public page'),
    ('anonymous', 'GET', '/nodes/event/{draft}/organizations/', None, 404, 'a draft node does not exist'),
    ('anonymous', 'GET', '/nodes/course/{course}/organizations/', None, 200, 'the same panel, a course'),
    ('stranger', 'GET', '/nodes/course/{private_course}/organizations/', None, 404, 'nor does that one'),
    ('anonymous', 'GET', '/organizations/undefined/', None, 404, 'not a number, so not a thing'),
    ('organiser', 'PATCH', '/organization-members/undefined/', _role_body('member'), 404, 'same'),
    ('organiser', 'DELETE', '/organization-links/undefined/', None, 404, 'same'),

    # ---- B. tasks (17BI.B) ---------------------------------------------------------------------
    # A board is the inside of a team: everything below staff is 404, on every node kind.
    ('anonymous', 'GET', '/nodes/event/{event}/tasks/', None, 404,
     'not 401 — an anonymous caller and a signed-in stranger get the same answer'),
    ('stranger', 'GET', '/nodes/event/{event}/tasks/', None, 404, 'same'),
    ('attendee', 'GET', '/nodes/event/{event}/tasks/', None, 404, 'holding a seat is not staffing it'),
    ('child', 'GET', '/nodes/event/{event}/tasks/', None, 404, 'same'),
    ('volunteer', 'GET', '/nodes/event/{event}/tasks/', None, 200, 'the rota may read the board'),
    ('reviewer', 'GET', '/nodes/event/{event}/tasks/', None, 200, 'same'),
    ('organiser', 'GET', '/nodes/event/{event}/tasks/', None, 200, 'same'),
    ('participant', 'GET', '/nodes/course/{course}/tasks/', None, 404,
     'THE member-not-staff row: enrolled on the course, and the board is still not theirs'),
    ('organiser', 'GET', '/nodes/course/{course}/tasks/', None, 200, 'they run the course'),
    ('reviewer', 'GET', '/nodes/material/{material}/tasks/', None, 200,
     'a material’s authority is its co-authoring project, and they are on it'),
    ('attendee', 'GET', '/nodes/material/{bare_material}/tasks/', None, 404,
     'a material with no project has no team, so it has no board'),
    ('volunteer', 'GET', '/nodes/organization/{org}/tasks/', None, 200, 'the roster is the team'),
    ('stranger', 'GET', '/nodes/organization/{org}/tasks/', None, 404, 'not on it'),
    ('anonymous', 'GET', '/nodes/exercise/{event}/tasks/', None, 404, 'not a node kind'),
    ('anonymous', 'POST', '/nodes/event/{event}/tasks/', _NEW_TASK, 404, 'the node check runs first'),
    ('attendee', 'POST', '/nodes/event/{event}/tasks/', _NEW_TASK, 404, 'same'),
    ('volunteer', 'POST', '/nodes/event/{event}/tasks/', _NEW_TASK, 201,
     'any staff member writes a task; only a manager puts somebody on it'),

    ('anonymous', 'GET', '/tasks/{task}/', None, 401, 'the detail route is authenticated'),
    ('stranger', 'GET', '/tasks/{task}/', None, 404, 'for them it does not exist'),
    ('attendee', 'GET', '/tasks/{task}/', None, 404, 'same'),
    ('volunteer', 'GET', '/tasks/{task}/', None, 200, 'they are carrying it'),
    ('reviewer', 'PATCH', '/tasks/{task}/', {'title': 'Print the lanyards'}, (403, 'not_allowed'),
     'staff, but neither the manager, the creator nor the assignee'),
    ('volunteer', 'PATCH', '/tasks/{task}/', {'title': 'Print the lanyards'}, 200,
     'the assignee may fix the due date of the thing they are doing'),
    ('organiser', 'PATCH', '/tasks/{task}/', {'title': 'Print the lanyards'}, 200, 'the manager may'),
    ('stranger', 'PATCH', '/tasks/{task}/', {'title': 'x'}, 404, 'not yours → 404, not 403'),

    ('organiser', 'POST', '/tasks/{task}/transition/', {'status': 'done'},
     (409, 'illegal_transition'), 'todo → done skips the path; a status people can set to anything'
     ' stops being read as a status'),
    ('organiser', 'POST', '/tasks/{task}/transition/', {'status': 'nonsense'}, 400,
     'a status that is not a status is malformed, not a conflict'),
    ('volunteer', 'POST', '/tasks/{task}/transition/', {'status': 'in_progress'}, 200, 'the assignee may'),
    ('reviewer', 'POST', '/tasks/{task}/transition/', {'status': 'in_progress'}, (403, 'not_allowed'),
     'a bystander on the rota may not move somebody else’s task'),
    ('organiser', 'POST', '/tasks/{task}/transition/', {'status': 'cancelled'}, 200,
     'anything open may be cancelled'),
    ('volunteer', 'POST', '/tasks/{done_task}/transition/', {'status': 'todo'}, (403, 'not_manager'),
     'reopening un-does a decision somebody recorded, so it is the manager’s'),
    ('organiser', 'POST', '/tasks/{done_task}/transition/', {'status': 'todo'}, 200, 'and theirs it is'),

    ('organiser', 'POST', '/tasks/{task}/assign/', _user_body('attendee_id'), (400, 'not_staff'),
     'the request named somebody who cannot be an assignee — a bad request, not a race'),
    ('organiser', 'POST', '/tasks/{task}/assign/', _user_body('volunteer_id'),
     (409, 'already_assigned'), 'that one IS a race'),
    ('volunteer', 'POST', '/tasks/{task}/assign/', _user_body('reviewer_id'), (403, 'not_manager'),
     'an assignee who could hand their task on makes "who is behind" unanswerable'),
    ('organiser', 'POST', '/tasks/{task}/assign/', _user_body('reviewer_id'), 200, 'the manager may'),
    ('organiser', 'POST', '/tasks/{task}/unassign/', _user_body('reviewer_id'), (400, 'not_assigned'),
     'nobody to take off'),
    ('organiser', 'POST', '/tasks/{task}/unassign/', _user_body('volunteer_id'), 200, 'and off they come'),

    ('organiser', 'POST', '/tasks/{subtask}/subtasks/', _NEW_TASK, (409, 'nested'), 'one level, and no more'),
    ('reviewer', 'POST', '/tasks/{task}/subtasks/', _NEW_TASK, (403, 'not_allowed'), 'not theirs to break up'),
    ('organiser', 'POST', '/tasks/{task}/subtasks/', _NEW_TASK, 201, 'the manager may'),
    ('organiser', 'DELETE', '/tasks/{task}/', None, (409, 'has_subtasks'),
     'a button that quietly removes four other people’s rows is the wrong shape for one click'),
    ('reviewer', 'DELETE', '/tasks/{subtask}/', None, (403, 'not_allowed'), 'neither creator nor manager'),
    ('organiser', 'DELETE', '/tasks/{subtask}/', None, 204, 'the creator may'),

    ('anonymous', 'GET', '/tasks/mine/', None, 401, 'somebody’s own work'),
    ('stranger', 'GET', '/tasks/mine/', None, 200, 'an empty one is still theirs'),
    ('volunteer', 'GET', '/tasks/mine/', None, 200, 'theirs'),
    ('volunteer', 'GET', '/tasks/undefined/', None, 404, 'not a number, so not a thing'),
    ('volunteer', 'POST', '/tasks/undefined/transition/', {'status': 'done'}, 404, 'same'),

    # ---- C. needs (17BI.C) ---------------------------------------------------------------------
    # The one management surface that is public by design: an open posting is help wanted.
    ('anonymous', 'GET', '/needs/', None, 200, 'the board is the point of it'),
    ('anonymous', 'GET', '/needs/{need_open}/', None, 200, 'an open posting on a visible node'),
    ('anonymous', 'GET', '/needs/{need_cancelled}/', None, 404,
     'a cancelled posting is the node’s own business again'),
    ('volunteer', 'GET', '/needs/{need_cancelled}/', None, 200, 'the node’s staff see the rest'),
    ('anonymous', 'GET', '/needs/{need_hidden}/', None, 404, 'it hangs on a draft event'),
    ('organiser', 'GET', '/needs/{need_hidden}/', None, 200, 'the draft’s host'),
    ('anonymous', 'GET', '/nodes/event/{event}/needs/', None, 200, 'the panel on a public page'),
    ('anonymous', 'GET', '/nodes/event/{draft}/needs/', None, 404, 'a draft node does not exist'),
    ('anonymous', 'GET', '/nodes/material/{material}/needs/', None, 200, 'the same panel, a material'),
    ('anonymous', 'POST', '/nodes/event/{event}/needs/', _NEW_NEED, 401, 'a write needs a sign-in'),
    ('volunteer', 'POST', '/nodes/event/{event}/needs/', _NEW_NEED, (403, 'not_manager'),
     'posting on behalf of an event is running it, not volunteering for it'),
    ('organiser', 'POST', '/nodes/event/{event}/needs/', _NEW_NEED, 201, 'the host may'),
    ('stranger', 'POST', '/nodes/course/{private_course}/needs/', _NEW_NEED, 404, 'a node they cannot see'),
    ('stranger', 'PATCH', '/needs/{need_open}/', {'status': 'cancelled'}, (403, 'not_manager'),
     'a posting is the node’s, not its readers’'),
    ('stranger', 'PUT', '/needs/{need_open}/', {'title': 'Mine now', 'kind': 'help'},
     (403, 'not_manager'),
     'the same rule through the other verb — PUT inherited from UpdateModelMixin skipped it'),
    ('organiser', 'PATCH', '/needs/{need_open}/', {'status': 'cancelled'}, 200, 'managers cancel and reopen'),

    ('anonymous', 'POST', '/needs/{need_open}/apply/', _APPLY, 401, 'a write needs a sign-in'),
    ('volunteer', 'POST', '/needs/{need_open}/apply/', _APPLY, (403, 'own_node'),
     'the node’s own staff do not answer their own advertisement'),
    ('child', 'POST', '/needs/{need_open}/apply/', _APPLY, (403, 'minor'),
     'an application carries free text to somebody they do not know'),
    ('stranger', 'POST', '/needs/{need_open}/apply/', _APPLY, (409, 'already_applied'), 'once each'),
    ('guardian', 'POST', '/needs/{need_full}/apply/', _APPLY, (409, 'full'),
     'accepted has reached wanted_count — recounted, never a stored tally'),
    # `not_open` is a refusal only the node's own STAFF can reach, and that is house rule 4 working
    # rather than a gap: a cancelled posting is not in `public_needs` for anybody else, so a
    # stranger gets 404 at `get_object` long before `apply_block_reason` is asked. The row was
    # first written for the guardian and the 404 was the honest answer.
    ('guardian', 'POST', '/needs/{need_cancelled}/apply/', _APPLY, 404, 'for them it is not there'),
    ('volunteer', 'POST', '/needs/{need_cancelled}/apply/', _APPLY, (409, 'not_open'),
     'staff can see it, and there is nothing left to answer'),
    ('guardian', 'POST', '/needs/{need_open}/apply/', _APPLY, 201, 'an adult stranger is exactly who this is for'),
    ('guardian', 'POST', '/needs/{need_open}/withdraw/', None, 404, 'they never applied'),
    ('stranger', 'POST', '/needs/{need_open}/withdraw/', None, 200, 'their own application'),

    ('stranger', 'GET', '/needs/{need_open}/applications/', None, 404, 'who answered is the node’s'),
    ('volunteer', 'GET', '/needs/{need_open}/applications/', None, 404,
     'staff, but the queue belongs to whoever decides it'),
    ('organiser', 'GET', '/needs/{need_open}/applications/', None, 200, 'the manager’s queue'),
    ('stranger', 'POST', '/need-applications/{app_pending}/decide/', _ACCEPT, 404, 'not theirs to decide'),
    ('volunteer', 'POST', '/need-applications/{app_pending}/decide/', _ACCEPT, 404, 'nor theirs'),
    ('organiser', 'POST', '/need-applications/{app_pending}/decide/', _ACCEPT, 200, 'the manager decides'),
    ('organiser', 'POST', '/need-applications/{app_pending}/decide/', {'decision': 'maybe'}, 400,
     'not one of the two words — malformed, not a conflict'),
    ('organiser', 'POST', '/need-applications/{app_decided}/decide/', _ACCEPT, (409, 'already_decided'),
     'a second click is the world having moved'),
    ('anonymous', 'GET', '/needs/undefined/', None, 404, 'not a number, so not a thing'),
    ('organiser', 'POST', '/need-applications/undefined/decide/', _ACCEPT, 404, 'same'),

    # ---- D. plans (17BI.D) ---------------------------------------------------------------------
    # An ACTIVE plan is readable by anybody who can see the node; a draft is the team’s.
    ('anonymous', 'GET', '/nodes/event/{event}/plans/', None, 200, 'the active one, read-only'),
    ('volunteer', 'GET', '/nodes/event/{event}/plans/', None, 200, 'staff see the drafts too'),
    ('anonymous', 'GET', '/nodes/event/{draft}/plans/', None, 404, 'a draft node does not exist'),
    ('anonymous', 'GET', '/nodes/organization/{org}/plans/', None, 200, 'the same panel, an organisation'),
    ('stranger', 'GET', '/nodes/organization/{dissolved}/plans/', None, 404, 'nor does a dissolved body'),
    ('anonymous', 'POST', '/nodes/event/{event}/plans/', _NEW_PLAN, 401, 'a write needs a sign-in'),
    ('volunteer', 'POST', '/nodes/event/{event}/plans/', _NEW_PLAN, (403, 'not_editor'),
     'drafting a roadmap is running the thing'),
    ('organiser', 'POST', '/nodes/event/{event}/plans/', _NEW_PLAN, 201, 'the host may'),

    ('anonymous', 'GET', '/plans/{plan_active}/', None, 200, 'an active plan is public with the node'),
    ('anonymous', 'GET', '/plans/{plan_draft}/', None, 404, 'a draft is not'),
    ('attendee', 'GET', '/plans/{plan_draft}/', None, 404, 'same'),
    ('volunteer', 'GET', '/plans/{plan_draft}/', None, 200, 'ordinary staff READ a draft plan'),
    ('volunteer', 'PATCH', '/plans/{plan_active}/', {'title': 'x'}, (403, 'not_editor'),
     '…and do not edit one: reading a draft is not drafting it'),
    ('stranger', 'PATCH', '/plans/{plan_active}/', {'title': 'x'}, (403, 'not_editor'), 'nor do they'),
    ('organiser', 'PATCH', '/plans/{plan_active}/', {'title': 'Opening the conference'}, 200, 'its editor'),
    ('organiser', 'DELETE', '/plans/{plan_active}/', None, (409, 'not_draft'),
     'a plan people have seen is a record, archived rather than deleted'),
    ('volunteer', 'DELETE', '/plans/{plan_draft}/', None, (403, 'not_editor'), 'not theirs'),
    ('organiser', 'DELETE', '/plans/{plan_draft}/', None, 204, 'a draft nobody saw may go'),
    ('organiser', 'POST', '/plans/{plan_active}/transition/', {'status': 'completed'},
     (409, 'steps_pending'), '"completed" has to mean what it says'),
    ('organiser', 'POST', '/plans/{plan_active}/transition/', {'status': 'draft'},
     (409, 'illegal_transition'), 'the graph has no way back'),
    ('volunteer', 'POST', '/plans/{plan_draft}/transition/', {'status': 'active'}, (403, 'not_editor'),
     'publishing a roadmap is the editor’s'),
    ('organiser', 'POST', '/plans/{plan_draft}/transition/', {'status': 'active'}, 200, 'and theirs it is'),

    ('organiser', 'POST', '/plans/{plan_active}/steps/', _parent_step_body('substep'), (409, 'nested'),
     'one level of sub-steps, like a subtask'),
    ('stranger', 'POST', '/plans/{plan_active}/steps/', _NEW_STEP, (403, 'not_editor'), 'a reader suggests'),
    ('organiser', 'POST', '/plans/{plan_active}/steps/', _NEW_STEP, 201, 'an editor adds'),
    ('stranger', 'PATCH', '/plan-steps/{step_pending}/', {'status': 'done'}, (403, 'not_editor'),
     'ticking somebody else’s step off'),
    ('organiser', 'PATCH', '/plan-steps/{step_pending}/', {'status': 'done'}, 200, 'and who did it is recorded'),
    ('attendee', 'PATCH', '/plan-steps/{draft_step}/', {'status': 'done'}, 404,
     'a step of a plan they cannot see does not exist'),
    ('organiser', 'DELETE', '/plan-steps/{step_pending}/', None, 204, 'the editor’s'),
    ('organiser', 'POST', '/plans/{plan_active}/reorder/', _reorder_body('step_pending'), 400,
     'a reorder that is not exactly the group is malformed, not a state that moved'),
    ('organiser', 'POST', '/plans/{plan_active}/reorder/', _reorder_body('step_pending', 'step_done'),
     200, 'the whole group, once each'),
    ('stranger', 'POST', '/plans/{plan_active}/reorder/', _reorder_body('step_done', 'step_pending'),
     (403, 'not_editor'), 'not theirs to sort'),

    ('organiser', 'GET', '/plans/{plan_active}/suggestions/', None, 200, 'the editor’s queue'),
    ('attendee', 'GET', '/plans/{plan_active}/suggestions/', None, (403, 'not_editor'),
     'a suggestion box is not a forum — nobody reads everybody else’s'),
    ('anonymous', 'POST', '/plans/{plan_active}/suggestions/', _NEW_SUGGESTION, 401,
     'a write needs a sign-in'),
    ('attendee', 'POST', '/plans/{plan_active}/suggestions/', _NEW_SUGGESTION, 201,
     'the reader’s way in'),
    ('organiser', 'POST', '/plans/{plan_active}/suggestions/', _NEW_SUGGESTION, (403, 'own_plan'),
     'an editor who wants a step adds one; two ways to do one thing disagree the moment both are used'),
    ('child', 'POST', '/plans/{plan_active}/suggestions/', _NEW_SUGGESTION, (403, 'minor'),
     'free text to a stranger again — the same rule as a need’s application'),
    ('reviewer', 'POST', '/plans/{plan_draft}/suggestions/', _NEW_SUGGESTION, (409, 'not_active'),
     'staff can SEE the draft, and there is nothing to suggest on yet — 409, the plan moved'),
    ('attendee', 'POST', '/plan-suggestions/{suggestion}/decide/', _ACCEPT, (403, 'not_editor'),
     'the author does not decide their own'),
    ('organiser', 'POST', '/plan-suggestions/{suggestion}/decide/', _ACCEPT, 200,
     'accepting turns it into a step at the end'),
    ('organiser', 'POST', '/plan-suggestions/{suggestion_decided}/decide/', _ACCEPT,
     (409, 'already_decided'), 'once each'),
    ('stranger', 'POST', '/plan-suggestions/{suggestion}/withdraw/', None, (403, 'not_own_suggestion'),
     'withdrawing somebody else’s'),
    ('attendee', 'POST', '/plan-suggestions/{suggestion}/withdraw/', None, 200, 'their own'),
    ('anonymous', 'GET', '/plans/undefined/', None, 404, 'not a number, so not a thing'),
    ('organiser', 'PATCH', '/plan-steps/undefined/', {'status': 'done'}, 404, 'same'),
    ('organiser', 'POST', '/plan-suggestions/undefined/decide/', _ACCEPT, 404, 'same'),

    # ---- E. decisions (17BI.E) -----------------------------------------------------------------
    # Visibility is eligibility: a poll is shown to the people it is being put to, plus the node’s
    # staff. A draft is the managers’ alone.
    ('anonymous', 'GET', '/nodes/event/{event}/polls/', None, 200, 'the list answers; it is empty'),
    ('attendee', 'GET', '/nodes/event/{event}/polls/', None, 200, 'the ones they may vote in'),
    ('volunteer', 'GET', '/nodes/event/{event}/polls/', None, 200, 'every open and closed one'),
    ('organiser', 'GET', '/nodes/event/{event}/polls/', None, 200, 'the drafts too'),
    ('anonymous', 'GET', '/nodes/event/{draft}/polls/', None, 404, 'a draft node does not exist'),
    ('anonymous', 'GET', '/nodes/course/{course}/polls/', None, 200, 'the same panel, a course'),
    ('anonymous', 'POST', '/nodes/event/{event}/polls/', _NEW_POLL, 401, 'a write needs a sign-in'),
    ('volunteer', 'POST', '/nodes/event/{event}/polls/', _NEW_POLL, (403, 'not_manager'),
     'putting a question to the room is running it'),
    ('organiser', 'POST', '/nodes/event/{event}/polls/', _NEW_POLL, 201, 'and it opens as a draft'),

    ('anonymous', 'GET', '/polls/{poll_open}/', None, 404,
     'an anonymous reader is eligible for nothing, so for them there is no poll here'),
    ('stranger', 'GET', '/polls/{poll_open}/', None, 404, 'same — a question put to the room, not the street'),
    ('attendee', 'GET', '/polls/{poll_open}/', None, 200, 'they are in the room'),
    ('participant', 'GET', '/polls/{poll_open}/', None, 404, 'in a different room'),
    ('attendee', 'GET', '/polls/{poll_staff}/', None, 404, 'a staff poll is not put to the attendees'),
    ('volunteer', 'GET', '/polls/{poll_staff}/', None, 200, 'it is put to them'),
    ('volunteer', 'GET', '/polls/{poll_draft}/', None, 404, 'a draft is the managers’ alone'),
    ('organiser', 'GET', '/polls/{poll_draft}/', None, 200, 'theirs'),
    ('volunteer', 'PATCH', '/polls/{poll_draft}/', {'question': 'x'}, 404, 'not theirs to word'),
    ('organiser', 'PATCH', '/polls/{poll_draft}/', {'question': 'Which day suits?'}, 200, 'while it is a draft'),
    ('organiser', 'PATCH', '/polls/{poll_open}/', {'question': 'x'}, (409, 'not_draft'),
     'rewording a question people have already answered'),
    ('organiser', 'DELETE', '/polls/{poll_open}/', None, (409, 'not_draft'),
     'a decision, once made, is a record and not a draft to discard'),
    ('organiser', 'DELETE', '/polls/{poll_draft}/', None, 204, 'a draft may go'),
    ('volunteer', 'POST', '/polls/{poll_draft}/options/', _NEW_OPTION, 404, 'not theirs'),
    ('organiser', 'POST', '/polls/{poll_draft}/options/', _NEW_OPTION, 201, 'while it is a draft'),
    ('organiser', 'POST', '/polls/{poll_open}/options/', _NEW_OPTION, (409, 'not_draft'),
     'a choice added after the first ballot is a different question'),
    ('volunteer', 'DELETE', '/poll-options/{draft_option}/', None, 404, 'not theirs'),
    ('organiser', 'DELETE', '/poll-options/{draft_option}/', None, 204, 'while it is a draft'),
    ('organiser', 'DELETE', '/poll-options/{open_option_a}/', None, (409, 'not_draft'), 'and not after'),

    ('organiser', 'POST', '/polls/{poll_bare}/open/', None, (409, 'no_options'),
     'fewer than two options is not a choice'),
    ('organiser', 'POST', '/polls/{poll_open}/open/', None, (409, 'already_open'), 'the world moved'),
    ('volunteer', 'POST', '/polls/{poll_draft}/open/', None, 404, 'not theirs to open'),
    ('organiser', 'POST', '/polls/{poll_draft}/open/', None, 200, 'theirs'),
    ('organiser', 'POST', '/polls/{poll_closed}/close/', {'decision_note': 'x'},
     (409, 'already_closed'), 'same'),
    ('volunteer', 'POST', '/polls/{poll_open}/close/', {'decision_note': 'x'}, 404, 'not theirs to close'),
    ('organiser', 'POST', '/polls/{poll_open}/close/', {'decision_note': 'Coffee, then.'}, 200,
     'closing is where the written decision goes'),

    ('anonymous', 'POST', '/polls/{poll_open}/vote/', _vote_body('open_option_a'), 401,
     'a ballot needs a sign-in'),
    ('stranger', 'POST', '/polls/{poll_open}/vote/', _vote_body('open_option_a'), (409, 'not_eligible'),
     'the write endpoint answers the WORD rather than 404 — house rule 6, and the list already hid it'),
    ('attendee', 'POST', '/polls/{poll_open}/vote/', _vote_body('open_option_a'), (409, 'already_voted'),
     'one ballot each, and the ballot is what says so'),
    ('child', 'POST', '/polls/{poll_open}/vote/', _vote_body('open_option_a'), 201,
     'a minor MAY vote — no free text leaves them'),
    ('volunteer', 'POST', '/polls/{poll_open}/vote/', _vote_body('open_option_a'), 201, 'staff are members'),
    ('volunteer', 'POST', '/polls/{poll_open}/vote/', _vote_body('open_option_a', 'open_option_b'),
     (409, 'too_many_choices'), 'a single-choice poll, asked for two'),
    ('volunteer', 'POST', '/polls/{poll_open}/vote/', _vote_body('draft_option'), (409, 'unknown_option'),
     'an option belonging to another poll'),
    ('volunteer', 'POST', '/polls/{poll_closed}/vote/', _vote_body('closed_option'), (409, 'not_open'),
     'the room has already been told the answer'),
    ('attendee', 'POST', '/polls/{poll_staff}/vote/', _vote_body('open_option_a'), (409, 'not_eligible'),
     'eligibility is the rota here, not the seat'),

    ('anonymous', 'GET', '/polls/{poll_closed}/results/', None, 404,
     'a closed poll is still only shown to the room it was put to'),
    ('attendee', 'GET', '/polls/{poll_open}/results/', None, 403,
     'eligible, and a running tally is the manager’s until it closes'),
    ('attendee', 'GET', '/polls/{poll_closed}/results/', None, 200, 'once closed, everybody eligible sees it'),
    ('organiser', 'GET', '/polls/{poll_open}/results/', None, 200, 'a manager always may'),
    ('anonymous', 'GET', '/polls/undefined/', None, 404, 'not a number, so not a thing'),
    ('organiser', 'POST', '/polls/undefined/open/', None, 404, 'same'),
    ('organiser', 'DELETE', '/poll-options/undefined/', None, 404, 'same'),

    # ---- F. the work dashboard (17BI.F) --------------------------------------------------------
    # One page of everything waiting on ME, so there is nobody else’s view of it to get wrong.
    ('anonymous', 'GET', '/work/', None, 401, 'there is no "my work" without a me'),
    ('stranger', 'GET', '/work/', None, 200, 'an empty dashboard is still theirs'),
    ('volunteer', 'GET', '/work/', None, 200, 'a task and a shift are waiting on them'),
    ('organiser', 'GET', '/work/', None, 200, 'and rather more on them'),
    ('child', 'GET', '/work/', None, 200, 'a minor holds tasks and votes, so they have one too'),
]
