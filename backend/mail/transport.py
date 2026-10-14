"""`settings.EMAIL_BACKEND`: log every message, then hand it to the real transport.

This catches the paths that do not go through `services.queue` — Django's admin, django-postman's
`notify_users()` — so that the Mail tab's "sent" list is the whole truth and not just this app's
share of it. The queue itself never comes through here: `services.deliver` opens the REAL transport
(`settings.EDMAT_MAIL_TRANSPORT`) directly, because its row already exists and logging it a second
time would show every message twice.
"""

from django.conf import settings
from django.core.mail import get_connection
from django.core.mail.backends.base import BaseEmailBackend
from django.utils import timezone

from .models import OutboundEmail


def transport_name() -> str:
    """'smtp' | 'console' | 'locmem' | the dotted path, for the log and the status line."""
    path = settings.EDMAT_MAIL_TRANSPORT
    for name in ('smtp', 'console', 'locmem'):
        if f'.{name}.' in path:
            return name
    return path


def real_connection(**kwargs):
    return get_connection(settings.EDMAT_MAIL_TRANSPORT, **kwargs)


def delivered_status() -> str:
    """What a successful hand-off means: only SMTP actually sends anything."""
    return OutboundEmail.STATUS_SENT if transport_name() == 'smtp' else OutboundEmail.STATUS_CONSOLE


class LoggedEmailBackend(BaseEmailBackend):
    def __init__(self, fail_silently=False, **kwargs):
        super().__init__(fail_silently=fail_silently)
        self._inner = real_connection(fail_silently=fail_silently, **kwargs)

    def open(self):
        return self._inner.open()

    def close(self):
        return self._inner.close()

    def send_messages(self, email_messages):
        sent = 0
        for message in email_messages:
            row = OutboundEmail.objects.create(
                kind=OutboundEmail.KIND_DIRECT,
                status=OutboundEmail.STATUS_SENDING,
                to=', '.join(message.recipients())[:320],
                subject=(message.subject or '')[:300],
                body=message.body if isinstance(message.body, str) else '',
                attempts=1,
                transport=transport_name(),
            )
            try:
                count = self._inner.send_messages([message]) or 0
            except Exception as exc:  # noqa: BLE001 — recorded, then re-raised unless told not to
                OutboundEmail.objects.filter(pk=row.pk).update(
                    status=OutboundEmail.STATUS_FAILED, error=f'{type(exc).__name__}: {exc}'[:2000]
                )
                if not self.fail_silently:
                    raise
                continue
            OutboundEmail.objects.filter(pk=row.pk).update(status=delivered_status(), sent_at=timezone.now())
            sent += count
        return sent
