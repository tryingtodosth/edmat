"""The door (CONFERENCE-BRIEF.md §3.D, CONFERENCE-RESEARCH-REPORT.md §2.2 and decisions 2–4).

The three decisions this module is built out of, and what each one cost:

1. **The ticket is an opaque random string and nothing else.** No name, no account id, no event
   id, no signature. A QR code is photographed by whoever is standing behind you, and a signed
   token that carries "Anna Kowalska, u/4412" tells that person who you are for free. Opaque means
   the QR is worth exactly one database lookup and nothing outside this server can read anything
   off it. The report offered Ed25519-signed tokens as an alternative and then preferred opaque
   itself; the only thing a signature would buy is offline validation, which we deliberately do
   not do — see 2.
2. **The scanner never decides.** It caches the list so it can SHOW a name and a likely answer
   with no network, but the admission is decided here, on the server, when the batch arrives. A
   scanner that decided for itself would have to be told the rules, would disagree with the phone
   next to it, and would make "the earlier scan wins" unknowable. So a phone queues scans and
   syncs them; the queue is the offline story, not local authority.
3. **Idempotency is the client's nonce, not the server's guess.** The phone stamps every scan with
   a nonce when it happens. A batch that is retried — because the reply was lost, not the request
   — returns the stored rows unchanged rather than scanning anybody twice. Without it, a flaky
   connection at the door turns into a stack of `already_in` refusals at the people who were
   admitted perfectly well the first time.

**What "collision" means, and the honest limit.** Two entry scans for one token inside one
sync window are a collision: the second one is flagged, because the likeliest explanation is that
the ticket was passed back out of the door. Across two windows it is only `already_in` — by then
the first scan is durable state, the second is an ordinary duplicate, and there is nothing left to
tell the two stories apart. That is a real limit of "the earlier scan wins" and it is stated here
rather than papered over with a time heuristic that would make a genuine second tap at the same
door look like fraud.

**`already_in` is the "nothing changed" answer for BOTH directions** — entering when already
inside, leaving when already outside. The vocabulary §3.D fixes has exactly one word for it; the
direction is on the row, so the frontend reads it as "already inside" or "already left" and a
person gets the right sentence.
"""

import secrets

from django.db import transaction
from django.utils import timezone

from .models import ATTENDING_STATUSES, SEAT_HOLDING_STATUSES, EventAttendance, ScanEvent

#: 32 characters (CONFERENCE-BRIEF.md §6.2). `token_urlsafe(24)` is 24 random bytes rendered as 32
#: base64url characters — the length is the readable consequence of the entropy, not the other way
#: round.
TOKEN_BYTES = 24
#: How much of the token the ticket page prints under the QR, for somebody to read out when the
#: camera will not focus. Eight base64url characters is ~48 bits — far more than enough to be
#: unique among a few hundred tickets, and short enough to type.
SHORT_CODE_LENGTH = 8


def short_code(token: str) -> str:
    return (token or '')[:SHORT_CODE_LENGTH]


def _mint() -> str:
    return secrets.token_urlsafe(TOKEN_BYTES)


def ensure_ticket(row: EventAttendance) -> EventAttendance:
    """Give this row a ticket if it holds a seat and has none yet.

    **The honest limit, since a docstring is where it belongs:** this is called from the
    registration transitions in `events/registration.py`, not from a `post_save` signal, because
    the seat machinery writes with `save()` in some places and would write with `QuerySet.update()`
    in others — and `update()` fires no signal, so a signal-based mint would silently skip exactly
    the paths that matter most on the morning of an event. The cost of doing it by hand is that a
    status changed *outside* those functions (the Django admin, a data migration, a shell) mints
    nothing. That is corrected the next time the person looks at their own ticket: `my-ticket`
    calls this too, so the worst case is a ticket that appears when it is first asked for rather
    than when the seat was granted.

    Tokens are never re-minted for a row that already has one — a ticket already printed or already
    in somebody's phone must keep working — and never revoked when a seat is lost, because
    `apply_scan` asks the row's CURRENT status, so a withdrawn person's ticket answers `not_going`
    at the door rather than `unknown`, which is the more useful refusal to read out loud.
    """
    if row.ticket_token or row.status not in SEAT_HOLDING_STATUSES:
        return row
    # A bounded retry, per backend/CLAUDE.md's SQLite rule 3 for unique-key allocation. A collision
    # on 24 random bytes will not happen; the loop costs nothing and means it cannot 500 if it does.
    for _ in range(5):
        candidate = _mint()
        if not EventAttendance.objects.filter(ticket_token=candidate).exists():
            row.ticket_token = candidate
            row.save(update_fields=['ticket_token', 'responded_at'])
            return row
    return row


def rotate_ticket(row: EventAttendance) -> EventAttendance:
    """"I forwarded my ticket to the wrong person." A new token replaces the old one in place, so
    the old QR is not invalid-because-revoked but invalid-because-it-is-nobody's — every past
    `ScanEvent` keeps the string it actually saw, which is what makes the log still readable."""
    if row.status not in SEAT_HOLDING_STATUSES:
        return row
    row.ticket_token = None
    return ensure_ticket(row)


def _find(event, token: str):
    """Resolve what the camera read, or what somebody typed. A full token matches exactly; a short
    code matches on its prefix, case-insensitively, and an ambiguous prefix is deliberately NOT
    resolved to the first hit — two people's tickets that share eight characters is a thing the
    door should say it cannot tell apart, not something it should guess at."""
    token = (token or '').strip()
    if not token:
        return None
    exact = event.attendances.filter(ticket_token=token).first()
    if exact is not None:
        return exact
    if len(token) < SHORT_CODE_LENGTH:
        return None
    matches = list(event.attendances.filter(ticket_token__istartswith=token)[:2])
    return matches[0] if len(matches) == 1 else None


def _effective_time(client_at, received_at):
    """The phone's clock, clamped so it can never be in the future. A scanner that has been offline
    all morning is the reason `client_at` is used at all — "admitted at 09:02" is the true fact, and
    `received_at` would record the moment the Wi-Fi came back. A clock running fast is the reason it
    is clamped: an attendance stamped an hour ahead reads as a check-in that has not happened yet."""
    if client_at is None:
        return received_at
    return min(client_at, received_at)


def apply_scan(event, user, payload, *, admitted_in_batch=None) -> ScanEvent:
    """One scan, one `ScanEvent` row, always — including every refusal.

    `payload` is `{token, direction, client_nonce, client_at, device_label, is_offline_sync}`.
    `admitted_in_batch` is the set of tokens this sync window has already admitted; `apply_batch`
    passes it, and it is the only thing that can turn an `already_in` into a `collision`.
    """
    nonce = str(payload.get('client_nonce') or '').strip()[:64]
    existing = ScanEvent.objects.filter(client_nonce=nonce).first() if nonce else None
    if existing is not None:
        return existing

    token = str(payload.get('token') or '').strip()[:64]
    direction = payload.get('direction') if payload.get('direction') in ('entry', 'exit') else 'entry'
    now = timezone.now()
    row = _find(event, token)

    if row is None:
        result = 'unknown'
    elif row.status not in ATTENDING_STATUSES:
        # A seat that was offered but not confirmed, a person on the waiting list, somebody who
        # withdrew: all of them have a real row and (often) a real ticket, and none of them may come
        # in. `not_going` is the word the volunteer reads out, and the frontend turns it into the
        # sentence that says which of those it was.
        result = 'not_going'
    elif direction == 'entry':
        if row.is_inside:
            result = 'collision' if token and token in (admitted_in_batch or ()) else 'already_in'
        else:
            result = 'admitted'
    else:
        result = 'exited' if row.is_inside else 'already_in'

    if row is not None and result in ('admitted', 'exited'):
        when = _effective_time(payload.get('client_at'), now)
        if result == 'admitted':
            row.checked_in_at = when
            row.checked_in_by = user
            # Cleared rather than left behind: "inside" is `checked_in_at` with no later
            # `checked_out_at`, and a stale exit from yesterday's day one of a two-day event would
            # otherwise have to be reasoned about at every read.
            row.checked_out_at = None
            row.save(update_fields=['checked_in_at', 'checked_in_by', 'checked_out_at', 'responded_at'])
        else:
            row.checked_out_at = when
            row.save(update_fields=['checked_out_at', 'responded_at'])

    return ScanEvent.objects.create(
        event=event,
        attendance=row,
        token_seen=token,
        direction=direction,
        result=result,
        client_nonce=nonce or _mint(),
        client_at=payload.get('client_at'),
        scanned_by=user,
        device_label=str(payload.get('device_label') or '')[:60],
        is_offline_sync=bool(payload.get('is_offline_sync')),
    )


def apply_batch(event, user, scans) -> list[ScanEvent]:
    """A phone's whole queue, in one `transaction.atomic()` (`backend/CLAUDE.md` rule 2: a handful
    of fast adjacent statements, not a slow multi-table sequence — and the alternative, a
    transaction per scan, is what turns a forty-scan sync into forty write locks on a single-writer
    database).

    Ordered by the client's own clock first, because the order the scans HAPPENED in is the order
    the door happened in, and a phone that syncs out of order would otherwise record an exit before
    the entry that preceded it. Scans with no `client_at` keep their arrival order behind the
    stamped ones.

    Returns one row per submitted scan, in the order they were submitted — the caller answers the
    client per nonce, and a client that reordered its own queue must still be able to match up.
    """
    scans = list(scans or [])
    order = sorted(
        range(len(scans)),
        key=lambda i: (scans[i].get('client_at') is None, scans[i].get('client_at') or timezone.now(), i),
    )
    admitted: set[str] = set()
    by_index: dict[int, ScanEvent] = {}
    with transaction.atomic():
        for i in order:
            row = apply_scan(event, user, scans[i], admitted_in_batch=admitted)
            by_index[i] = row
            if row.result == 'admitted' and row.token_seen:
                admitted.add(row.token_seen)
    return [by_index[i] for i in range(len(scans))]


def inside_count(event) -> int:
    """How many people are in the building — a `COUNT` over the current state, never a running
    total kept by hand (house rule 5). Two entries and one exit is one person inside whichever
    order the syncs arrived in."""
    from django.db.models import F, Q

    return event.attendances.filter(checked_in_at__isnull=False).filter(
        Q(checked_out_at__isnull=True) | Q(checked_out_at__lt=F('checked_in_at'))
    ).count()
