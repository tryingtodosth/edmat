"""A thin, deliberate wrapper around django-postman's own `Message` model — this app has no models
of its own (see models.py). django-postman ships a real, documented top-level API for a brand-new
message (`postman.api.pm_write`), which this module reuses directly rather than reimplementing.
It does NOT ship an equivalent helper for a REPLY within an existing thread (only its own Django
form classes handle that, `postman/forms.py`'s `BaseWriteForm._save`) — `reply()` below replicates
that exact thread-linking/moderation/notification sequence, read directly from that source (not
guessed), so a reply behaves identically to what django-postman's own web UI would produce.

Auto-moderation: this project configures no `POSTMAN_AUTO_MODERATE_AS`/auto-moderator functions —
every message and reply is immediately accepted (STATUS_ACCEPTED), matching `pm_write()`'s own
documented "no auto_moderators given → auto_moderate as accepted" default. `skip_notification=True`
throughout, since this project has no real email backend configured yet (the same honest gap
LAUNCHCHECKLIST.md already flags for PasswordResetView) — messages are surfaced via this app's own
REST endpoints (a real inbox/unread-count UI), not email.
"""

from postman.api import pm_write
from postman.models import STATUS_ACCEPTED, Message


def send_message(sender, recipient, subject: str, body: str = '') -> Message:
    """A brand-new, top-level message — thin pass-through to django-postman's own documented API."""
    return pm_write(sender=sender, recipient=recipient, subject=subject, body=body, skip_notification=True)


def reply_to_message(sender, parent: Message, body: str, subject: str | None = None) -> Message:
    """A reply within `parent`'s own thread. The recipient is always "whoever isn't the replier" on
    `parent` — not unconditionally `parent.sender`, since either side of a multi-message thread
    should be able to keep replying to the latest message regardless of whether THEY happened to be
    that message's own sender or recipient (a real, natural back-and-forth conversation, not a
    one-way "you may only ever reply to things sent TO you" restriction).

    Thread-linking logic below is copied verbatim from postman/forms.py's own
    `BaseWriteForm._save()` (read directly from the installed package source, not guessed) — the
    first-ever reply to a message promotes that message into being its own thread root
    (`parent.thread = parent`), and every reply after that inherits the SAME `thread_id`, which is
    what lets `Message.objects.thread(user, filter)` return every message in one conversation.
    """
    if not parent.thread_id:
        parent.thread = parent
        parent.save()

    recipient = parent.recipient if parent.sender_id == sender.id else parent.sender

    message = Message(
        sender=sender,
        recipient=recipient,
        subject=subject or f'Re: {parent.subject}',
        body=body,
        parent=parent,
        thread_id=parent.thread_id,
    )
    initial_status = message.moderation_status
    message.moderation_status = STATUS_ACCEPTED
    message.clean_moderation(initial_status)
    message.save()
    message.update_parent(initial_status)
    return message
