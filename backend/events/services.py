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


#: How much of a post's own text rides along in the notification. Long enough that "we are starting
#: twenty minutes late" arrives whole — which is the case where reading the notification is the
#: entire point and opening the page would be too slow to help.
POST_PREVIEW_CHARS = 140


def notify_attendees_of_post(post, actor):
    """Everybody holding a seat, when the host writes an update.

    Fired on the first publish of a post and never on an edit. A host fixing a typo must not put a
    badge on forty people's bell a second time — the same restraint `notify_attendees_of_change`
    already shows by firing only when the time or the place actually moved, rather than on every save.

    The post's own opening words ride along in `note` rather than only its existence, on
    `Notification.target_label`'s own reasoning: a notification that says "there is an update" and
    makes you open a page to find out it was "the slides are up" spent your attention to tell you
    nothing.
    """
    body = (post.body or '').strip()
    preview = body[:POST_PREVIEW_CHARS].rstrip()
    if len(body) > POST_PREVIEW_CHARS:
        preview = f'{preview}…'
    # A picture-only post is legal (see `EventPost.clean`), and has no words to preview. Falling back
    # to the event's time keeps the note carrying *something* the reader can place, matching what
    # every other event notification puts there.
    if not preview:
        preview = _when(post.event)

    for attendee in going_attendees(post.event):
        notify(
            attendee,
            'event_posted',
            actor=actor,
            target_label=post.event.title,
            event=post.event,
            note=preview,
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
