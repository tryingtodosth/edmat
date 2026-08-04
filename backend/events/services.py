"""Who gets told what, for events.

A separate module from views.py for the reason `booking/services.py` already records: every one of
these goes through `notifications.services.notify()` rather than creating a `Notification` row
directly, so the recipient's own preferences (`Profile.notify_on_event`, and the per-type mute list)
are honoured without every call site remembering to check them.
"""

from django.utils import timezone

from notifications.services import notify

from .models import ATTENDING_STATUSES


def _when(event) -> str:
    """The event's own time, carried in the notification's note.

    Denormalized deliberately, matching `Notification.target_label`'s own reasoning: somebody reading
    "your event was cancelled" three days later needs to know *which* Thursday, and re-resolving that
    from a row that may since have been edited (or deleted) would be a worse answer than the one that
    was true when the thing happened.
    """
    return timezone.localtime(event.starts_at).strftime('%Y-%m-%d %H:%M')


def going_attendees(event):
    """Everybody holding a seat. One definition, so a notification fan-out can never disagree with
    the seat count about who is actually coming."""
    return [
        attendance.attendee
        for attendance in event.attendances.filter(
            status__in=ATTENDING_STATUSES
        ).select_related('attendee', 'attendee__profile')
    ]


def notify_host_of_response(event, attendee, status: str):
    """The host, when somebody answers.

    Only for `going`. A decline is deliberately silent: it is information the host can see on the
    event itself, and a notification for every "no" would make hosting a well-attended event an
    unpleasant experience — the same restraint `notify_course_participants` shows by never telling a
    pending applicant what is happening inside a course.
    """
    if status not in ATTENDING_STATUSES:
        return None
    return notify(
        event.host,
        'event_attendance',
        actor=attendee,
        target_label=event.title,
        event=event,
        note=_when(event),
    )


def notify_attendees_of_cancellation(event, actor):
    """Everybody who said they were coming. This is the whole reason cancelling is a state rather
    than a delete — the row has to survive long enough to know who to tell."""
    for attendee in going_attendees(event):
        notify(
            attendee,
            'event_cancelled',
            actor=actor,
            target_label=event.title,
            event=event,
            note=_when(event),
        )


def notify_attendees_of_change(event, actor, note: str):
    """Everybody who said they were coming, when the time or the place moved.

    Only those two, not every edit: somebody fixing a typo in a description should not put a badge on
    forty people's bell, and somebody moving a lecture to a different building absolutely should. The
    caller decides which happened (see `EventViewSet.update`) because only it can see what the values
    were before.
    """
    for attendee in going_attendees(event):
        notify(
            attendee,
            'event_updated',
            actor=actor,
            target_label=event.title,
            event=event,
            note=note,
        )
