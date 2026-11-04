"""Inviting somebody to a course by their email address (owner, 2026-11-02: "adding collaborators
from that place — with whom you are connected, or adding by mail").

The people an administrator already shares a roster with are added directly (`CourseViewSet.staff`
with `PersonPicker`); everybody else is reached here. **A mailed invite is an ordinary
`CourseInvite`** — single-use, 14 days, with the address it went to in `sent_to` — and the mail is
an ordinary `mail.OutboundEmail` row whose link is built at send time from the invite
(`mail.services.build_link`, `KIND_COURSE_INVITE`). So accepting it is the existing
`/courses/join/<token>` page and its `invite_accept`, with every rule that already has: capacity,
"already staff", the use count under a lock. Nothing new decides who gets in.

**Never says whether an address has an account.** The answer for a stranger's address and for a
member's is the same: an invite was sent. Adding somebody straight onto the staff because their
address matched an account would turn this form into a way to find out who is registered, and would
put a person on a course they never agreed to.

Three limits, each a refusal with its reason (house rule 6):

- the inviter's own address must be CONFIRMED (`mail.services.is_confirmed`) — mail sent in
  somebody's name from an account nobody proved belongs to anyone is how this becomes a spam relay;
- at most `MAX_PER_REQUEST` addresses at once, and `MAX_PER_DAY` mailed invites per inviter in any
  24 hours, RECOUNTED from the invites themselves (house rule 5) rather than a throttle counter;
- no second invite to an address while an earlier one to it still works (`already_invited`).

The body is fixed text: the inviter's display name, the course title, the role and the link. No
free-text message — that would make it a way to mail anybody anything.

Every refusal word here has a sentence in `frontend/src/lib/utils/labels.ts: emailInviteReasonLabel`
(house rule 13 — a new word is a change in both files).
"""

from __future__ import annotations

from datetime import timedelta

from django.core.exceptions import ValidationError
from django.core.validators import validate_email
from django.db import transaction
from django.utils import timezone

from .models import INVITE_ROLE_CHOICES, CourseInvite

MAX_PER_REQUEST = 20
MAX_PER_DAY = 50
EXPIRES_AFTER = timedelta(days=14)
DAY = timedelta(days=1)

INVITE_ROLES = frozenset(key for key, _ in INVITE_ROLE_CHOICES)


class EmailInviteRequestError(Exception):
    """A malformed request (400), with the word the frontend has a sentence for."""


def parse_addresses(raw) -> list[str]:
    """A list of strings, or one string separated by commas, semicolons, spaces or new lines — what
    somebody pastes from a spreadsheet or a mail client. Lower-cased, deduplicated, order kept.
    Invalid entries are KEPT, so each gets its own `email_invalid` answer instead of vanishing."""
    if isinstance(raw, str):
        for sep in (';', '\n', '\r', '\t', ' '):
            raw = raw.replace(sep, ',')
        parts = raw.split(',')
    elif isinstance(raw, (list, tuple)):
        parts = [p for p in raw if isinstance(p, str)]
    else:
        raise EmailInviteRequestError('email_invite_no_addresses')
    out, seen = [], set()
    for part in parts:
        address = part.strip().strip('<>').strip().lower()
        if address and address not in seen:
            seen.add(address)
            out.append(address)
    if not out:
        raise EmailInviteRequestError('email_invite_no_addresses')
    if len(out) > MAX_PER_REQUEST:
        raise EmailInviteRequestError('email_invite_too_many')
    return out


def sent_today(user, now=None) -> int:
    now = now or timezone.now()
    return (
        CourseInvite.objects.filter(created_by=user, created_at__gte=now - DAY)
        .exclude(sent_to='')
        .count()
    )


def block_reason(user, course) -> str | None:
    """Why `user` may not mail invites for `course` at all, or None. `not_admin` is answered 404 by
    the view, like every other administrator action in this app."""
    from mail.services import is_confirmed

    if not course.can_administer(user):
        return 'not_admin'
    if not is_confirmed(user):
        return 'email_not_confirmed'
    return None


def _still_invited(course, address: str, now) -> bool:
    for invite in course.invites.filter(sent_to__iexact=address, revoked_at__isnull=True):
        if invite.unusable_reason(now) is None:
            return True
    return False


def _locale_for(course, inviter) -> str:
    """The course's language when it is one the mail has words for, else the inviter's. The
    recipient's own preference is unknown — they may have no account — and the course's language
    is the best guess at what they read."""
    if course.language in ('pl', 'en'):
        return course.language
    from mail.services import _locale

    return _locale(inviter)


def _queue_mail(invite, inviter, locale: str) -> None:
    from mail.models import OutboundEmail
    from mail.services import _name, queue
    from mail.texts import text

    values = {
        'inviter': _name(inviter),
        'course': invite.course.title,
        'role': text(locale, f'course_invite_role_{invite.role}'),
        'date': timezone.localtime(invite.expires_at).strftime('%d.%m.%Y'),
    }
    queue(
        OutboundEmail.KIND_COURSE_INVITE,
        invite.sent_to,
        text(locale, 'course_invite_subject', **values),
        text(locale, 'course_invite_body', **values),
        locale=locale,
        ref_id=invite.pk,
    )


def invite_by_email(course, inviter, addresses: list[str], role: str, now=None) -> list[dict]:
    """One result per address, in the order given: `{email, ok, reason, invite}`. Partial success
    is the normal answer — a typo in one address must not cost the other nine their invitation.

    One small transaction per address rather than one around the loop (backend/CLAUDE.md, SQLite:
    a long write transaction blocks every other writer)."""
    if role not in INVITE_ROLES:
        raise EmailInviteRequestError('email_invite_role')
    now = now or timezone.now()
    budget = MAX_PER_DAY - sent_today(inviter, now)
    own = (inviter.email or '').lower()
    locale = _locale_for(course, inviter)
    results = []
    for address in addresses:
        result = {'email': address, 'ok': False, 'reason': '', 'invite': None}
        try:
            validate_email(address)
        except ValidationError:
            result['reason'] = 'email_invalid'
            results.append(result)
            continue
        if address == own:
            result['reason'] = 'email_is_you'
        elif _still_invited(course, address, now):
            result['reason'] = 'already_invited'
        elif budget <= 0:
            result['reason'] = 'daily_limit'
        if result['reason']:
            results.append(result)
            continue
        with transaction.atomic():
            invite = CourseInvite.objects.create(
                course=course,
                role=role,
                created_by=inviter,
                token=CourseInvite.new_token(),
                max_uses=1,
                expires_at=now + EXPIRES_AFTER,
                sent_to=address,
            )
            _queue_mail(invite, inviter, locale)
        budget -= 1
        result['ok'] = True
        result['invite'] = invite
        results.append(result)
    return results
