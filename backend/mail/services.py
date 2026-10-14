"""The one place mail is queued, sent, and its links are made. Endpoints and the cron command ask
this module; nothing else builds an `OutboundEmail` row or a confirmation token.

**Queue first, send after the commit, in a thread.** A request never waits on OVH's SMTP: the row
is written inside the request's transaction, and `transaction.on_commit` starts a daemon thread
that delivers it. Production has eight mod_wsgi request slots (`deploy/CLAUDE.md`); an SMTP
handshake inside one is a slot gone for a second or two, per message. Whatever the thread does not
get to — the process was recycled, OVH refused — `manage.py mail_cron` picks up every five minutes.

**A claim is one WHERE-anchored `update()`** (`backend/CLAUDE.md`), so the thread and the cron job
can both reach for the same row and exactly one of them sends it.
"""

import logging
import threading
from datetime import timedelta

from django.conf import settings
from django.contrib.auth import get_user_model
from django.contrib.auth.password_validation import validate_password
from django.contrib.auth.tokens import default_token_generator
from django.core import signing
from django.core.exceptions import ValidationError
from django.core.mail import EmailMessage
from django.db import close_old_connections, transaction
from django.db.models import F, Q
from django.utils import timezone
from django.utils.encoding import force_bytes, force_str
from django.utils.http import urlsafe_base64_decode, urlsafe_base64_encode

from .models import ConfirmedEmail, MailPreference, OutboundEmail
from .texts import text
from .transport import delivered_status, real_connection, transport_name

log = logging.getLogger(__name__)
User = get_user_model()

MAX_ATTEMPTS = 5
CONFIRM_SALT = 'mail.confirm-email'
CONFIRM_MAX_AGE = 7 * 24 * 3600
# A row left in `sending` this long belongs to a process that died mid-send. Whether OVH accepted
# it is unknown; it is marked failed and retried, and a rare duplicate is the honest cost.
STUCK_AFTER = timedelta(minutes=15)
DIGEST_EVERY = timedelta(hours=1)
DIGEST_MAX_LINES = 20


# ---- who a person is, for the words in a message ---------------------------------------------

def _locale(user) -> str:
    profile = getattr(user, 'profile', None)
    return 'en' if getattr(profile, 'preferred_locale', 'pl') == 'en' else 'pl'


def _name(user) -> str:
    profile = getattr(user, 'profile', None)
    return (getattr(profile, 'display_name', '') or '').strip() or user.username


# ---- the queue ---------------------------------------------------------------------------------

def queue(kind: str, to: str, subject: str, body: str, *, user=None, locale: str = 'pl') -> OutboundEmail:
    row = OutboundEmail.objects.create(
        kind=kind, to=to, subject=subject[:300], body=body, user=user, locale=locale,
        transport=transport_name(),
    )
    transaction.on_commit(lambda: _kick(row.pk))
    return row


def _kick(row_id: int) -> None:
    if getattr(settings, 'EDMAT_MAIL_DELIVER_INLINE', False):
        deliver(row_id)
        return
    threading.Thread(target=_deliver_in_thread, args=(row_id,), daemon=True, name=f'mail-{row_id}').start()


def _deliver_in_thread(row_id: int) -> None:
    close_old_connections()
    try:
        deliver(row_id)
    except Exception:  # noqa: BLE001 — a thread has nobody to raise to; the row records the failure
        log.exception('mail: delivering %s failed outside the send itself', row_id)
    finally:
        close_old_connections()


def build_link(row: OutboundEmail) -> str:
    user = row.user
    if user is None:
        raise ValueError('a message with a link needs its user')
    if row.kind == OutboundEmail.KIND_CONFIRM:
        token = signing.dumps({'u': user.pk, 'e': user.email.lower()}, salt=CONFIRM_SALT)
        return f'{settings.EDMAT_SITE_URL}/confirm-email?token={token}'
    if row.kind == OutboundEmail.KIND_RESET:
        uid = urlsafe_base64_encode(force_bytes(user.pk))
        token = default_token_generator.make_token(user)
        return f'{settings.EDMAT_SITE_URL}/reset-password?uid={uid}&token={token}'
    raise ValueError(f'no link for kind {row.kind}')


def render_body(row: OutboundEmail) -> str:
    if OutboundEmail.LINK_MARKER not in row.body:
        return row.body
    return row.body.replace(OutboundEmail.LINK_MARKER, build_link(row))


def deliver(row_id: int) -> str | None:
    """Send one row if it is still waiting. Returns its new status, or None if somebody else had
    it (or it is finished, or out of attempts)."""
    claimed = OutboundEmail.objects.filter(
        Q(status=OutboundEmail.STATUS_QUEUED) | Q(status=OutboundEmail.STATUS_FAILED),
        pk=row_id,
        attempts__lt=MAX_ATTEMPTS,
    ).update(status=OutboundEmail.STATUS_SENDING, attempts=F('attempts') + 1, transport=transport_name())
    if not claimed:
        return None
    row = OutboundEmail.objects.select_related('user').get(pk=row_id)
    try:
        message = EmailMessage(
            subject=row.subject,
            body=render_body(row),
            from_email=settings.DEFAULT_FROM_EMAIL,
            to=[row.to],
            headers={'Auto-Submitted': 'auto-generated', 'X-EdMat-Kind': row.kind},
            connection=real_connection(),
        )
        message.send()
    except Exception as exc:  # noqa: BLE001 — SMTP raises a zoo of types; every one is a failure
        OutboundEmail.objects.filter(pk=row_id).update(
            status=OutboundEmail.STATUS_FAILED, error=f'{type(exc).__name__}: {exc}'[:2000]
        )
        return OutboundEmail.STATUS_FAILED
    status = delivered_status()
    OutboundEmail.objects.filter(pk=row_id).update(status=status, error='', sent_at=timezone.now())
    return status


def drain(limit: int = 100) -> dict:
    """What the cron job does first: un-stick dead sends, then try everything still waiting."""
    stuck = OutboundEmail.objects.filter(
        status=OutboundEmail.STATUS_SENDING, created_at__lt=timezone.now() - STUCK_AFTER
    ).update(status=OutboundEmail.STATUS_FAILED, error='Interrupted while sending; retried.')
    ids = list(
        OutboundEmail.objects.filter(
            status__in=[OutboundEmail.STATUS_QUEUED, OutboundEmail.STATUS_FAILED],
            attempts__lt=MAX_ATTEMPTS,
        )
        .exclude(kind=OutboundEmail.KIND_DIRECT)  # nothing to re-send: its message object is gone
        .order_by('created_at')
        .values_list('pk', flat=True)[:limit]
    )
    results = {'stuck': stuck, 'sent': 0, 'failed': 0}
    for row_id in ids:
        status = deliver(row_id)
        if status == OutboundEmail.STATUS_FAILED:
            results['failed'] += 1
        elif status:
            results['sent'] += 1
    return results


def retry(row: OutboundEmail) -> str | None:
    """A superuser's "try again": a failed row gets its attempts back. Returns why not, or None."""
    if row.kind == OutboundEmail.KIND_DIRECT:
        return 'direct'
    if row.status != OutboundEmail.STATUS_FAILED:
        return 'not_failed'
    updated = OutboundEmail.objects.filter(pk=row.pk, status=OutboundEmail.STATUS_FAILED).update(
        status=OutboundEmail.STATUS_QUEUED, attempts=0, error=''
    )
    if not updated:
        return 'not_failed'
    transaction.on_commit(lambda: _kick(row.pk))
    return None


# ---- email confirmation ------------------------------------------------------------------------

def is_confirmed(user) -> bool:
    if not user.email:
        return False
    return ConfirmedEmail.objects.filter(user=user, email__iexact=user.email).exists()


def send_confirmation(user) -> OutboundEmail | None:
    if not user.email or is_confirmed(user):
        return None
    locale = _locale(user)
    return queue(
        OutboundEmail.KIND_CONFIRM,
        user.email,
        text(locale, 'confirm_subject'),
        text(locale, 'confirm_body', name=_name(user)),
        user=user,
        locale=locale,
    )


def confirm(token: str):
    """Returns `(user, None)` or `(None, reason)` — 'expired' | 'invalid' | 'changed'."""
    try:
        data = signing.loads(token or '', salt=CONFIRM_SALT, max_age=CONFIRM_MAX_AGE)
    except signing.SignatureExpired:
        return None, 'expired'
    except signing.BadSignature:
        return None, 'invalid'
    user = User.objects.filter(pk=data.get('u'), is_active=True).first()
    if user is None:
        return None, 'invalid'
    if (user.email or '').lower() != data.get('e'):
        return None, 'changed'
    ConfirmedEmail.objects.update_or_create(user=user, defaults={'email': user.email})
    return user, None


# ---- password reset ----------------------------------------------------------------------------

def request_password_reset(email: str) -> int:
    """Queues one message per active account with this address and a password to reset. Returns
    how many — which the endpoint never tells the caller (account enumeration)."""
    email = (email or '').strip()
    if not email or '@' not in email:
        return 0
    count = 0
    for user in User.objects.filter(email__iexact=email, is_active=True).select_related('profile'):
        # An unusable password is skipped — except on an account that signs in through Google /
        # Apple / Microsoft (`sso/`): a reset is how such an account SETS its first password, and
        # Settings sends people here for exactly that before unlinking their last provider.
        if not user.has_usable_password() and not user.sso_identities.exists():
            continue
        locale = _locale(user)
        queue(
            OutboundEmail.KIND_RESET,
            user.email,
            text(locale, 'reset_subject'),
            text(locale, 'reset_body', name=_name(user), username=user.username),
            user=user,
            locale=locale,
        )
        count += 1
    return count


def reset_password(uidb64: str, token: str, password: str):
    """Returns `(user, None)` or `(None, {'field': [messages]})`. On success every API token the
    account holds is deleted: whoever asked for a reset may be locking somebody else out."""
    try:
        user = User.objects.get(pk=force_str(urlsafe_base64_decode(uidb64 or '')), is_active=True)
    except (User.DoesNotExist, ValueError, TypeError, OverflowError):
        user = None
    if user is None or not default_token_generator.check_token(user, token or ''):
        return None, {'detail': 'invalid_link'}
    try:
        validate_password(password or '', user)
    except ValidationError as exc:
        return None, {'password': list(exc.messages)}
    user.set_password(password)
    user.save(update_fields=['password'])
    from rest_framework.authtoken.models import Token

    Token.objects.filter(user=user).delete()
    # The link arrived in this inbox and was used, which proves the address as well as a
    # confirmation link would have.
    if user.email:
        ConfirmedEmail.objects.update_or_create(user=user, defaults={'email': user.email})
    return user, None


# ---- the notification digest -------------------------------------------------------------------

def preference_for(user) -> MailPreference:
    pref, _ = MailPreference.objects.get_or_create(user=user)
    return pref


def set_digest(user, enabled: bool) -> MailPreference:
    pref = preference_for(user)
    if enabled and not pref.notification_digest:
        pref.digest_since = timezone.now()
    pref.notification_digest = enabled
    pref.save(update_fields=['notification_digest', 'digest_since'])
    return pref


def send_digests(now=None) -> int:
    """At most one message per person per hour, listing unread notifications since the last one.
    Only to a CONFIRMED address: an unconfirmed one may be somebody else's, typed by mistake."""
    from notifications.models import Notification

    now = now or timezone.now()
    queued = 0
    prefs = MailPreference.objects.filter(notification_digest=True, user__is_active=True).select_related(
        'user', 'user__profile'
    )
    for pref in prefs:
        since = pref.digest_since or now
        if now - since < DIGEST_EVERY:
            continue
        user = pref.user
        if not is_confirmed(user):
            continue
        notes = list(
            Notification.objects.filter(recipient=user, is_read=False, created_at__gt=since).order_by('-created_at')
        )
        if not notes:
            continue
        locale = _locale(user)
        lines = []
        for note in notes[:DIGEST_MAX_LINES]:
            label = note.target_label or ''
            kind = note.get_type_display() if locale == 'en' else ''
            lines.append('• ' + ' — '.join(part for part in (kind, label) if part) if (kind or label) else '•')
        if len(notes) > DIGEST_MAX_LINES:
            lines.append(text(locale, 'digest_more', count=len(notes) - DIGEST_MAX_LINES))
        body = '\n'.join(
            [text(locale, 'digest_intro', name=_name(user), count=len(notes)), *lines,
             text(locale, 'digest_outro', site=settings.EDMAT_SITE_URL)]
        )
        queue(OutboundEmail.KIND_DIGEST, user.email, text(locale, 'digest_subject', count=len(notes)), body,
              user=user, locale=locale)
        MailPreference.objects.filter(pk=pref.pk).update(digest_since=now)
        queued += 1
    return queued


def send_test(to: str, user) -> OutboundEmail:
    locale = _locale(user)
    return queue(OutboundEmail.KIND_TEST, to, text(locale, 'test_subject'), text(locale, 'test_body'),
                 user=user, locale=locale)
