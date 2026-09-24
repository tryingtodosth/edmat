"""Built-in providers for the work dashboard — six sections for what exists today.

Each provider reads only its own app's models and lives behind that app's own flag key.
Do not import tasks, needs, plans or decisions — they do not exist on this branch.
The integrator registers their work_items at §5 of MANAGEMENT-BRIEF.md.
"""

from datetime import timedelta, datetime
from django.utils import timezone
from django.db.models import Q, Exists, OuterRef
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
    from events.models import Event, EventStaff, RESPONDABLE_STATUSES
    from config.nodes import resolve_node

    if not user or not user.is_authenticated:
        return []

    now = timezone.now()
    within_14_days = _days_from_now(14)

    # Events where user is host or staff, starting soon
    events = Event.objects.filter(
        Q(host=user) | Q(event_staff_roles__staff_member=user),
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
            'urgency': urgency,
            'node': node,
        })

    return items


# ---- Courses: enrollment requests waiting ----


def _course_requests_waiting(user):
    """Courses I staff where enrolment requests are waiting."""
    from courses.models import Course, Enrollment

    if not user or not user.is_authenticated:
        return []

    # Get courses where user is staff
    courses = Course.objects.filter(
        course_staff_roles__staff=user
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
                'status': f'{pending_count} pending',
                'urgency': 1,  # This month
                'node': node,
            })

    return items


# ---- Coauthoring: pending versions ----


def _coauth_pending_versions(user):
    """Material projects I'm a member of with a pending version."""
    from coauthoring.models import MaterialProject, MaterialVersion, ProjectMember

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
            items.append({
                'kind': 'proposal',
                'title': project.title,
                'url': f'/material-projects/{project.pk}',
                'due_at': None,
                'status': f'{pending_versions} pending',
                'urgency': 1,  # This month
                'node': None,  # Projects don't map to a single node
            })

    return items


# ---- Shifts: within 14 days ----


def _shifts_upcoming(user):
    """Shifts I hold in the next 14 days."""
    from shifts.models import Assignment

    if not user or not user.is_authenticated:
        return []

    now = timezone.now()
    within_14_days = _days_from_now(14)

    # Active statuses: offered, claimed, confirmed (not dropped, no_show, done)
    active_statuses = ['offered', 'claimed', 'confirmed']

    # Get assignments for this user that are upcoming
    assignments = Assignment.objects.filter(
        volunteer=user,
        status__in=active_statuses,
        shift__starts_at__gte=now,
        shift__starts_at__lte=within_14_days,
    ).select_related('shift__event').order_by('shift__starts_at')

    items = []

    for assignment in assignments:
        shift = assignment.shift
        event = shift.event
        urgency = _calculate_urgency(shift.starts_at)
        node = node_ref(event, user) if event else None

        items.append({
            'kind': 'shift',
            'title': f'{event.title} - {shift.title}' if event else shift.title,
            'url': f'/events/{event.pk}' if event else '/',
            'due_at': shift.starts_at.isoformat() if shift.starts_at else None,
            'status': assignment.status,
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

    # Get bookings where user is the tutor (service provider)
    bookings = Booking.objects.filter(
        service__provider=user,
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
