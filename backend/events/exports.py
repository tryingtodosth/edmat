"""Who sees which registration data, what leaves as a file, and what is thrown away when.

`CONFERENCE-BRIEF.md` §3.G, from `CONFERENCE-RESEARCH-REPORT.md` §1.4 (the role → minimum-data
table), §4.2 (export leak vectors) and §4.3 (retention). **The report's legal citations are
unverified** — the research paste dropped them — so nothing here turns a citation into a rule: the
numbers below are project defaults, labelled as defaults, and `LEGAL.md` §8 says the same in
prose.

Three things live here, and they are one idea seen from three sides:

1. **Minimisation on read.** `GET /registrations/` used to hand every staff member the whole row —
   every answer, the accessibility note, the person's account id. A volunteer on the door needs a
   name, a state and a check-in button; the report's blunt finding is that the commonest accidental
   disclosure in an academic event is a roster with medical and dietary prose on it, handed to
   whoever is standing at the table. So an organiser keeps the full row and everybody else gets
   `DoorListAttendanceSerializer`, which carries the row id the check-in action addresses and
   nothing else that identifies anybody beyond their name.
2. **Aggregation on export.** Catering and the accessibility desk need counts, not people:
   `needs_summary()` returns nothing but integers. Where a question is free text, the only honest
   aggregate is *how many answered it* — a count of "wheelchair access" cannot be derived from
   prose without reading the prose, and pretending otherwise would be house rule 10 in reverse.
   The one export that does name people is narrowed to organisers and writes an `ExportLog` row.
3. **Retention.** `manage.py purge_event_data` is the command that makes a retention sentence
   true. See `RETENTION_NOTE`.

Deliberately NOT here: any notion of a "catering export" as a file. The needs summary is a
JSON response an organiser reads on the page and can copy; a CSV of counts would be the same
numbers with a filename, and a file is the thing that gets forwarded.
"""

import csv
from io import StringIO

from django.http import HttpResponse
from django.utils import timezone
from rest_framework import permissions, serializers, status
from rest_framework.decorators import action
from rest_framework.response import Response

from moderation.permissions import feature_gate

from .models import SEAT_HOLDING_STATUSES, EventAttendance, ExportLog
from .registration import expire_promotions
from .serializers import PersonSerializer

# ---- what the purge command covers, and what it does not yet ----------------------------------

RETENTION_NOTE = """Tables this retention pass covers today, and the ones it must learn next.

Covered by `manage.py purge_event_data`:
  * `events.EventAttendance.answers`  — the accessibility key and every free-text answer blanked
  * `events.EventAttendance.checked_in_by` — nulled (that somebody was checked in survives; which
    volunteer tapped the button does not need to)

  * `cloakroom.CloakroomItem.exception_note` / `exception_identity_kind` — blanked (wired at
    integration, 2026-09-23). What a lost-slip claimant's coat looked like and what kind of identity
    they showed covers a property claim for 30 days and nothing after; the item's own rack, token
    and status are not personal data and stay, so the reconciliation history still adds up.

NOT covered yet:
  * `events.ScanEvent` (step D, `conf/d-tickets`, not merged at the time of writing) — scan
    timestamps, device labels and the token seen. The report puts device telemetry in the
    T+14–30 day bucket; the rows should go entirely rather than be blanked, since a scan row with
    every field emptied is not a record of anything.

Also deliberately left alone today, and named so that the decision is somebody's rather than an
omission (house rule 14):
  * `EventAttendance.note` — free text the attendee wrote for the host ("I will be twenty minutes
    late"). It is prose about a person and a fair candidate for the same blanking, but §3.G
    enumerates answers, and quietly widening a purge is how a purge starts deleting things
    somebody was relying on. Decide it at integration.
"""

# Default retention window. A default, not a legal finding: the report's own bucket is "T+14 to 30
# days" for operational data, and 30 is the end of it that leaves room for a late question.
DEFAULT_RETENTION_DAYS = 30

# The baseline questions every registration form asks, stored under reserved keys in
# `EventAttendance.answers` (the client renders them; `RegistrationField` holds the organiser's own
# questions only). HISTORY.md §17AN.
KEY_ATTENDANCE_MODE = '_attendance_mode'
KEY_NEEDS = '_needs'
KEY_CONSENT = '_consent'

# Free-text question kinds, whose answers the purge blanks. `choice` / `multi` / `checkbox` answers
# survive it, and that is the point: the aggregate an organiser reported to the venue stays
# reproducible after the prose about individual people has gone.
FREE_TEXT_KINDS = frozenset({'text', 'long_text'})

# Everything `EventAttendanceSerializer` carries that a non-organiser does not get. Named as data
# rather than as a comment because the tests assert against exactly this set — a field added to the
# full serializer later is either added here too or it starts leaking, and the test says which.
WITHHELD_FROM_NON_ORGANISERS = frozenset({
    'answers', 'note', 'registered_by', 'waitlisted_at', 'promotion_expires_at',
    'session_ids', 'responded_at',
})


# ---- minimisation on read ----------------------------------------------------------------------

class DoorListPersonSerializer(PersonSerializer):
    """A name, and no account id.

    The id is withheld on purpose: nothing a volunteer does addresses a *person*, only a
    registration row — `POST /registrations/{row_id}/checkin/` takes the row. An account id in a
    door list is a link to a profile, a messaging target and a join key onto everything else that
    person has ever posted, handed out for no operational reason at all. `PersonSerializer`'s own
    shape is kept (an `id` key that is null) rather than dropped, so one client mapper reads both
    responses; the frontend already guards the profile link on a falsy id, because the masked
    public roster taught it to (§17AN).
    """

    id = serializers.SerializerMethodField()

    def get_id(self, user) -> None:
        return None


class DoorListAttendanceSerializer(serializers.ModelSerializer):
    """What a volunteer or a reviewer sees of a registration: the report's "Door / Gate check-in"
    row — full name, registration state, check-in stamp — and the row id the check-in action needs.

    A reviewer gets the same narrow body although §3.G names only volunteers. The report's table
    gives a reviewer *less* business with the roster than a door volunteer has, not more (their
    row is single-blind proposals and nothing else), so the split is "organisers, and everybody
    else" rather than a third serializer that would say the same thing.
    """

    attendee = DoorListPersonSerializer(read_only=True)
    checked_in = serializers.SerializerMethodField()

    class Meta:
        model = EventAttendance
        fields = ['id', 'attendee', 'status', 'checked_in', 'checked_in_at']

    def get_checked_in(self, row) -> bool:
        return row.checked_in_at is not None


# ---- aggregation --------------------------------------------------------------------------------

def _resolved_mode(row, event) -> str:
    """One person's attendance mode, resolved the way the registration form itself resolves it.

    A hybrid event asks; an onsite or online event does not, because there is only one answer, and
    an rsvp-mode event stores no answers at all. Reading the stored key alone would report every
    attendee of an ordinary onsite lecture as "not stated", which is a true statement about the
    database and a useless one about the room.
    """
    stored = (row.answers or {}).get(KEY_ATTENDANCE_MODE)
    if stored in ('in_person', 'online'):
        return stored
    if event.location_kind == 'online':
        return 'online'
    if event.location_kind == 'onsite':
        return 'in_person'
    return 'unstated'


def needs_summary(event) -> dict:
    """Counts, and only counts — the catering and accessibility figures with nobody in them.

    Counted over seat holders (`going` + `promoted`), because a waiting-list row is not a person
    the kitchen has to feed and a declined row is the opposite of one. Recount, never increment
    (house rule 5): this is two queries and a pass over the rows, and it cannot drift.
    """
    rows = list(
        event.attendances.filter(status__in=SEAT_HOLDING_STATUSES).only(
            'id', 'status', 'answers'
        )
    )
    modes = {'in_person': 0, 'online': 0, 'unstated': 0}
    accessibility = {'stated': 0, 'none': 0}
    for row in rows:
        modes[_resolved_mode(row, event)] += 1
        needs = (row.answers or {}).get(KEY_NEEDS)
        accessibility['stated' if str(needs or '').strip() else 'none'] += 1

    fields = []
    for field in event.registration_fields.all():
        key = str(field.pk)
        entry = {'field_id': field.pk, 'label': field.label, 'kind': field.kind, 'options': [],
                 'answered': 0, 'unanswered': 0}
        for row in rows:
            value = (row.answers or {}).get(key)
            answered = value not in (None, '', [], False)
            entry['answered' if answered else 'unanswered'] += 1
        if field.kind in ('choice', 'multi'):
            for option in field.options or []:
                count = 0
                for row in rows:
                    value = (row.answers or {}).get(key)
                    # `multi` stores a list, `choice` a single string — one loop, both shapes.
                    hit = option in value if isinstance(value, list) else value == option
                    count += 1 if hit else 0
                entry['options'].append({'option': option, 'count': count})
        elif field.kind == 'checkbox':
            yes = sum(1 for row in rows if (row.answers or {}).get(key) is True)
            entry['options'] = [{'option': 'yes', 'count': yes},
                                {'option': 'no', 'count': len(rows) - yes}]
        fields.append(entry)

    return {
        'total': len(rows),
        'attendance_mode': modes,
        # Two numbers and no third. A count of people who wrote *something* under accessibility is
        # the whole of what a free-text field can honestly aggregate to; the wording stays with the
        # organiser, who is the person who has to act on it.
        'accessibility': accessibility,
        'fields': fields,
    }


def door_list_rows(event):
    """Name, status, checked-in. The report's door export, minus every column it names as a leak."""
    rows = event.attendances.select_related('attendee', 'attendee__profile').order_by(
        'created_at', 'id'
    )
    out = [['name', 'status', 'checked_in']]
    for row in rows:
        profile = getattr(row.attendee, 'profile', None)
        name = getattr(profile, 'display_name', '') or row.attendee.username
        out.append([name, row.status, 'yes' if row.checked_in_at else 'no'])
    return out


def log_export(event, user, kind, rows) -> ExportLog:
    """Record that a file naming people left the system. The only writer of `ExportLog`."""
    return ExportLog.objects.create(event=event, user=user, kind=kind, rows=rows)


def as_csv(rows, filename) -> HttpResponse:
    out = StringIO()
    csv.writer(out).writerows(rows)
    response = HttpResponse(out.getvalue(), content_type='text/csv; charset=utf-8')
    response['Content-Disposition'] = f'attachment; filename="{filename}"'
    return response


# ---- retention ------------------------------------------------------------------------------

def purge_event_data(older_than_days=DEFAULT_RETENTION_DAYS, dry_run=False):
    """Blank the perishable half of an old event's registrations; leave who attended alone.

    What goes: the accessibility note, every free-text answer, and the identity of whoever tapped
    check-in. What stays: that the person registered, what they answered to a multiple-choice
    question, whether they turned up, and the whole programme — those are the event's own record,
    not a temporary operational need, and erasing them would answer a question nobody asked while
    destroying the one an organiser is asked a year later ("was I there?").

    `Event.ends_at` is a property (start + duration, or `runs_until`), so the cutoff cannot be a
    single SQL `WHERE`. The narrowing filter `starts_at__lt=cutoff` is nonetheless exact as a
    *candidate* filter — an event that ended before the cutoff necessarily started before it — and
    the real test runs in Python over that bounded set.

    Returns a report dict; the command prints it. Idempotent: a second run finds nothing to do,
    because it only counts rows it actually changes.
    """
    from .models import Event  # local: `models` imports nothing from here, and this keeps it so.

    cutoff = timezone.now() - timezone.timedelta(days=older_than_days)
    candidates = (
        Event.objects.filter(starts_at__lt=cutoff)
        .prefetch_related('attendances', 'registration_fields')
        .order_by('starts_at', 'id')
    )
    report = {'cutoff': cutoff, 'dry_run': dry_run, 'events': [], 'answers_blanked': 0,
              'accessibility_blanked': 0, 'checkins_unlinked': 0, 'cloakroom_exceptions_blanked': 0}

    for event in candidates:
        ends_at = event.ends_at
        if ends_at is None or ends_at >= cutoff:
            continue
        free_text_keys = {
            str(f.pk) for f in event.registration_fields.all() if f.kind in FREE_TEXT_KINDS
        }
        answers_blanked = accessibility_blanked = checkins_unlinked = 0
        for row in event.attendances.all():
            changed = []
            answers = dict(row.answers or {})
            if str(answers.get(KEY_NEEDS) or '').strip():
                answers[KEY_NEEDS] = ''
                accessibility_blanked += 1
                changed.append('answers')
            wiped = [k for k in free_text_keys if str(answers.get(k) or '').strip()]
            for key in wiped:
                answers[key] = ''
            if wiped:
                answers_blanked += len(wiped)
                if 'answers' not in changed:
                    changed.append('answers')
            if row.checked_in_by_id is not None:
                checkins_unlinked += 1
                changed.append('checked_in_by')
            if not changed:
                continue
            if not dry_run:
                row.answers = answers
                row.checked_in_by = None
                # `responded_at` is `auto_now`, and a purge is not the attendee responding — so the
                # update names its fields and leaves that stamp where it was.
                row.save(update_fields=list(dict.fromkeys(changed)))
        cloakroom_blanked = _purge_cloakroom_exceptions(event, dry_run)
        if answers_blanked or accessibility_blanked or checkins_unlinked or cloakroom_blanked:
            report['events'].append({
                'id': event.pk, 'title': event.title, 'ended': ends_at,
                'answers_blanked': answers_blanked, 'accessibility_blanked': accessibility_blanked,
                'checkins_unlinked': checkins_unlinked,
                'cloakroom_exceptions_blanked': cloakroom_blanked,
            })
            report['answers_blanked'] += answers_blanked
            report['accessibility_blanked'] += accessibility_blanked
            report['checkins_unlinked'] += checkins_unlinked
            report['cloakroom_exceptions_blanked'] += cloakroom_blanked
    return report


def _purge_cloakroom_exceptions(event, dry_run) -> int:
    """The lost-slip records on this event's cloakroom desks (see `RETENTION_NOTE`). Imported
    locally: `cloakroom` depends on `events`, and this module must not make that a cycle."""
    from cloakroom.models import CloakroomItem

    rows = CloakroomItem.objects.filter(desk__event=event).exclude(
        exception_note='', exception_identity_kind='none'
    )
    count = rows.count()
    if count and not dry_run:
        # A `QuerySet.update()` fires no signal — the honest limit house rule 5 names; nothing
        # listens on this model, so there is nothing for it to miss.
        rows.update(exception_note='', exception_identity_kind='none')
    return count


# ---- the endpoints -------------------------------------------------------------------------

class ExportLogSerializer(serializers.ModelSerializer):
    user = PersonSerializer(read_only=True)

    class Meta:
        model = ExportLog
        fields = ['id', 'kind', 'rows', 'user', 'created_at']


_EventsFeatureGate = feature_gate('events')
_AUTH = [permissions.IsAuthenticated, _EventsFeatureGate]


class ExportMixin:
    """Mixed into `EventViewSet` beside `RegistrationMixin`. Refusals are object-level checks, not
    queryset filters: every action here arrives with an event id in the URL, and house rule 4 is
    that a filter never runs for those."""

    @action(detail=True, methods=['get'], url_path='exports/needs', permission_classes=_AUTH)
    def exports_needs(self, request, pk=None):
        """Counts for catering, the accessibility desk and the room — organisers only.

        Organisers only although it contains no identifiers, because on a small event it very
        nearly does: "1 person stated an accessibility need" plus a roster of four is not an
        aggregate. The staff-wide export is the door list.
        """
        event = self.get_object()
        if not event.can_organise(request.user):
            return Response(status=status.HTTP_403_FORBIDDEN)
        expire_promotions(event, request.user)
        return Response(needs_summary(event))

    @action(detail=True, methods=['get'], url_path='exports/door-list.csv', permission_classes=_AUTH)
    def exports_door_list(self, request, pk=None):
        """The list somebody stands at the door with. Any staff member, which is the point —
        a volunteer who can only get this file cannot accidentally forward the other one."""
        event = self.get_object()
        if not event.is_staff_member(request.user):
            return Response(status=status.HTTP_403_FORBIDDEN)
        expire_promotions(event, request.user)
        rows = door_list_rows(event)
        log_export(event, request.user, 'door_list', len(rows) - 1)
        return as_csv(rows, f'edmat-event-{event.pk}-door-list.csv')

    @action(detail=True, methods=['get'], url_path='exports/log', permission_classes=_AUTH)
    def exports_log(self, request, pk=None):
        """Who took a file out of here, and how big it was. Organisers only — it names staff."""
        event = self.get_object()
        if not event.can_organise(request.user):
            return Response(status=status.HTTP_403_FORBIDDEN)
        rows = event.export_logs.select_related('user', 'user__profile')[:100]
        return Response(ExportLogSerializer(rows, many=True).data)
