"""Built-in providers for the work dashboard — the six sections of the original six modules,
plus the four a contest contributes.

Each provider reads only its own app's models and lives behind that app's own flag key.
Do not import tasks, needs, plans or decisions — they did not exist on the branch this file was
written on. The integrator registers their work_items at §5 of MANAGEMENT-BRIEF.md
(`work/integrations.py`).

**The contests block at the bottom is step B of the contests cycle** (CONTESTS-BRIEF.md §3.B): the
rows come from `contests/work.py`, which step A writes because it owns the registration, submission
and complaint models they are counted from, and the registration is here because step A must not
import `work` (`prompts/README.md` §5 rule 13 — a step ships a module, the other side wires it).
On B's own branch that function returns `[]`, which is the honest answer for a model with no
registrations: the section simply never appears, because `collect()` drops an empty one.

**Status is a code, count is separate** (2026-10-14): every row's `status` is one of
`providers.STATUS_CODES[kind]` and a row standing for several things carries the number as an int
`count` — `{'status': 'pending', 'count': 2}`, never the English `'2 pending'` these providers
used to send and `/work` used to print verbatim to a Polish reader.
"""

from django.utils import timezone
from datetime import timedelta
from django.db.models import Q
from config.nodes import node_ref

from . import providers


def _days_from_now(days):
    """Utility to get a datetime N days from now."""
    return timezone.now() + timedelta(days=days)


# ---- Events: hosting or staffing (within 14 days) ----


def _events_hosting_or_staffing(user):
    """Events I host or staff, starting within 14 days.

    A provider that reads events with a start time within 14 days and where the
    user is the host or on the staff list.
    """
    from events.models import Event, RESPONDABLE_STATUSES

    if not user or not user.is_authenticated:
        return []

    now = timezone.now()
    within_14_days = _days_from_now(14)

    # Events where user is host or staff, starting soon. `Event.staff` is the related_name from
    # `EventStaff.event`; the host is denormalized onto `Event.host` (events/models.py), so both
    # need their own `Q()` arm rather than one join.
    events = Event.objects.filter(
        Q(host=user) | Q(staff__user=user),
        status__in=RESPONDABLE_STATUSES,
        starts_at__gte=now,
        starts_at__lte=within_14_days,
    ).distinct().order_by('starts_at')

    items = []

    for event in events:
        urgency = _calculate_urgency(event.starts_at)
        node = node_ref(event, user)

        # Determine if hosting or staffing
        is_host = event.host_id == user.id
        status = 'hosting' if is_host else 'staffing'

        items.append({
            'kind': 'event',
            'title': event.title,
            'url': f'/events/{event.pk}',
            'due_at': event.starts_at.isoformat() if event.starts_at else None,
            'status': status,
            'count': None,
            'urgency': urgency,
            'node': node,
        })

    return items


def _events_attending(user):
    """Events I'm going to, within 14 days."""
    from events.models import Event, ATTENDING_STATUSES

    if not user or not user.is_authenticated:
        return []

    now = timezone.now()
    within_14_days = _days_from_now(14)

    # Events where user is going
    events = Event.objects.filter(
        attendances__attendee=user,
        attendances__status__in=ATTENDING_STATUSES,
        starts_at__gte=now,
        starts_at__lte=within_14_days,
    ).distinct().order_by('starts_at')

    items = []
    for event in events:
        urgency = _calculate_urgency(event.starts_at)
        node = node_ref(event, user)
        items.append({
            'kind': 'event',
            'title': event.title,
            'url': f'/events/{event.pk}',
            'due_at': event.starts_at.isoformat() if event.starts_at else None,
            'status': 'going',
            'count': None,
            'urgency': urgency,
            'node': node,
        })

    return items


# ---- Courses: enrollment requests waiting ----


def _course_requests_waiting(user):
    """Courses I staff where enrolment requests are waiting."""
    from courses.models import Course

    if not user or not user.is_authenticated:
        return []

    # Get courses where user is staff. `Course.staff` is the related_name from
    # `CourseStaff.course`; `CourseStaff.user` is the person (courses/models.py).
    courses = Course.objects.filter(
        staff__user=user
    ).distinct()

    items = []

    for course in courses:
        # Count pending enrollments
        pending_count = course.enrollments.filter(status='pending').count()

        if pending_count > 0:
            node = node_ref(course, user)
            items.append({
                'kind': 'course_request',
                'title': course.title,
                'url': f'/courses/{course.pk}',
                'due_at': None,
                'status': 'pending',
                'count': pending_count,
                'urgency': 1,  # This month
                'node': node,
            })

    return items


# ---- Coauthoring: pending versions ----


def _coauth_pending_versions(user):
    """Material projects I'm a member of with a pending version."""
    from coauthoring.models import MaterialProject

    if not user or not user.is_authenticated:
        return []

    # Get projects where user is a member
    projects = MaterialProject.objects.filter(
        members__user=user
    ).distinct()

    items = []

    for project in projects:
        # Count pending versions (proposed status)
        pending_versions = project.versions.filter(status='proposed').count()

        if pending_versions > 0:
            # `MaterialProject` has no `title` of its own (coauthoring/models.py) — it is the
            # material's title once published, and the head draft/proposed version's title before
            # that. Falling back to the branch slug covers the (practically unreachable, since a
            # pending version implies at least one version exists) case where `head_version` is
            # still None.
            head = project.head_version
            title = head.title if head is not None else str(project.branch)
            items.append({
                'kind': 'proposal',
                'title': title,
                'url': f'/material-projects/{project.pk}',
                'due_at': None,
                'status': 'pending',
                'count': pending_versions,
                'urgency': 1,  # This month
                'node': None,  # Projects don't map to a single node
            })

    return items


# ---- Shifts: within 14 days ----


def _shifts_upcoming(user):
    """Shifts I hold in the next 14 days."""
    from shifts.models import Assignment, LIVE_STATUSES

    if not user or not user.is_authenticated:
        return []

    now = timezone.now()
    within_14_days = _days_from_now(14)

    # Get assignments for this user that are upcoming. `Assignment.user` is the field name
    # (shifts/models.py); a shift has no `event` of its own — it belongs to a `Station`, which
    # belongs to the `Event` — and no `title`, only a `station` and `note`.
    assignments = Assignment.objects.filter(
        user=user,
        status__in=LIVE_STATUSES,
        shift__starts_at__gte=now,
        shift__starts_at__lte=within_14_days,
    ).select_related('shift__station__event').order_by('shift__starts_at')

    items = []

    for assignment in assignments:
        shift = assignment.shift
        station = shift.station
        event = station.event if station else None
        urgency = _calculate_urgency(shift.starts_at)
        node = node_ref(event, user) if event else None

        items.append({
            'kind': 'shift',
            'title': f'{event.title} - {station.name}' if event else station.name,
            'url': f'/events/{event.pk}' if event else '/',
            'due_at': shift.starts_at.isoformat() if shift.starts_at else None,
            'status': assignment.status,
            'count': None,
            'urgency': urgency,
            'node': node,
        })

    return items


# ---- Tutoring: upcoming bookings ----


def _tutoring_bookings(user):
    """Tutoring bookings coming up."""
    from booking.models import Booking

    if not user or not user.is_authenticated:
        return []

    now = timezone.now()
    within_14_days = _days_from_now(14)

    # Active statuses: requested, confirmed (not declined, cancelled, completed)
    active_statuses = ['requested', 'confirmed']

    # `Booking.tutor` is denormalized from `service.provider` and is the field every tutor-wide
    # query in this app reads (booking/models.py's own doc comment) — filtering through
    # `service__provider` instead is exactly the join that comment warns against.
    bookings = Booking.objects.filter(
        tutor=user,
        status__in=active_statuses,
        starts_at__gte=now,
        starts_at__lte=within_14_days,
    ).select_related('service', 'student').order_by('starts_at')

    items = []

    for booking in bookings:
        urgency = _calculate_urgency(booking.starts_at)

        student_name = booking.student.get_display_name() if hasattr(booking.student, 'get_display_name') else str(booking.student)

        items.append({
            'kind': 'booking',
            'title': f'{booking.service.title} with {student_name}',
            'url': f'/bookings/{booking.pk}',
            'due_at': booking.starts_at.isoformat() if booking.starts_at else None,
            'status': booking.status,
            'count': None,
            'urgency': urgency,
            'node': None,  # Tutoring is personal, not tied to a course/event
        })

    return items


# ---- Utility ----


def _calculate_urgency(due_at):
    """Calculate urgency (0-3) based on due date.

    0: none (more than a month away)
    1: this month
    2: this week
    3: overdue/today
    """
    if not due_at:
        return 0

    now = timezone.now()
    days_until = (due_at - now).days

    if days_until < 0:
        return 3  # Overdue
    elif days_until == 0:
        return 3  # Today
    elif days_until <= 7:
        return 2  # This week
    elif days_until <= 30:
        return 1  # This month
    else:
        return 0  # More than a month


# ---- Registration ----


# Register all six providers
providers.register('event_hosting', 'events', _events_hosting_or_staffing)
providers.register('event_attendance', 'events', _events_attending)
providers.register('course_request', 'courses', _course_requests_waiting)
providers.register('proposal', 'coauthoring', _coauth_pending_versions)
providers.register('shift', 'shifts', _shifts_upcoming)
providers.register('booking', 'tutoring', _tutoring_bookings)


# ---- Contests: the four kinds `contests/work.py` yields (CONTESTS-BRIEF.md §3.B) ----
#
# One registration per SECTION and not per app, the reason `work/integrations.py` gives in full:
# `/work` groups rows by section key and labels each section by it, and these four are four
# different things waiting on a person — a registration to decide, a submission to score, a
# complaint to answer, a stage about to open. The item shape's `kind` and the section key are the
# same vocabulary, which is what makes the filter below a one-liner.


def _of_kind(kind, work_items):
    """`integrations._only`, which this cannot import.

    Two copies rather than one, deliberately, and said in both files (house rule 13 - three strikes
    before extracting, and this is the second). `work/apps.py: ready()` imports this module FIRST,
    and `work/integrations.py` registers the management providers at import time, which imports
    `tasks`, `needs`, `plans` and `decisions` - pulling that in from here would reorder app loading
    for the sake of four lines.
    """

    def provider(user):
        return [item for item in work_items(user) if item.get('kind') == kind]

    provider.__name__ = f'{kind}_items'
    return provider


def _register_contest_providers():
    from contests.work import work_items as contest_items

    for kind in (
        'contest_registration',
        'contest_judging',
        'contest_complaint',
        'contest_stage',
    ):
        providers.register(kind, 'contests', _of_kind(kind, contest_items))


_register_contest_providers()
