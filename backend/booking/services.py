"""Telling the other party what just happened to a booking.

Every one of these goes through notifications/services.py's `notify()` rather than creating a
`Notification` row directly, so the recipient's own preferences (`Profile.notify_on_booking`, the
per-type mute list) and the actor==recipient guard cannot be bypassed by a call site forgetting one —
the same discipline that module's own doc comment already sets out for every other notifying app.

**No `Notification` FK to `Booking`, deliberately.** The existing model carries an `exercise`,
`material` and `course` FK precisely because each of those has a real page to open. A booking
does not: there is no per-booking route, and both parties' destination is the same one schedule page,
which is also where the request is actually acted on. The frontend routes the four booking types
there by type (NotificationCard.svelte), which is a genuinely simpler answer than a fifth nullable
column that would always point at the same URL.

`target_label` carries the listing title and `note` the session time, so the notification says the
two things a recipient needs before deciding whether to open anything at all.
"""

from django.utils import timezone

from notifications.services import notify


def _when(booking) -> str:
    """The session time, formatted for the notification's own note line.

    Rendered in the project timezone rather than as an ISO instant — this string is read by a person
    in a notification list, not parsed by anything, and `2026-08-11 14:00` is legible where
    `2026-08-11T14:00:00Z` is not.
    """
    return timezone.localtime(booking.starts_at).strftime('%Y-%m-%d %H:%M')


def notify_requested(booking):
    notify(
        booking.tutor,
        'booking_requested',
        actor=booking.student,
        target_label=booking.service.title,
        note=_when(booking),
    )


def notify_confirmed(booking):
    notify(
        booking.student,
        'booking_confirmed',
        actor=booking.tutor,
        target_label=booking.service.title,
        note=_when(booking),
    )


def notify_declined(booking):
    # The tutor's own reason rides along when they gave one, since "declined" without a word is the
    # least useful version of this message and the tutor has already typed the useful version.
    note = _when(booking)
    if booking.tutor_note:
        note = f'{note} — {booking.tutor_note}'
    notify(
        booking.student,
        'booking_declined',
        actor=booking.tutor,
        target_label=booking.service.title,
        note=note,
    )


def notify_cancelled(booking, *, actor):
    """Goes to whichever party did NOT cancel. One type for both directions — `Booking.cancelled_by`
    already records which side it was, so a second type would only duplicate a fact the row carries."""
    recipient = booking.student if actor.pk == booking.tutor_id else booking.tutor
    notify(
        recipient,
        'booking_cancelled',
        actor=actor,
        target_label=booking.service.title,
        note=_when(booking),
    )
