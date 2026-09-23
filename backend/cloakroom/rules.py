"""Every cloakroom rule, in one module, asked by the endpoints (root `CLAUDE.md`, boundary 2).

Three of these are the `enrollment_block_reason` shape (house rule 6): they answer **why**, in a
word the frontend has a line for, because "no" and "that rack already has a coat on it" are the
same boolean and completely different to a person standing at the counter.

`return_result` is the same idea pushed one step further — it is not a refusal at all but a
*verdict*, and all five of its values (`returned`, `unknown_token`, `already_returned`,
`blacklisted`, `desk_closed`) are things the clerk has to say out loud to the person in front of
them. A boolean would collapse "this coat went home an hour ago" and "I have never seen this
token" into one shrug.
"""

from django.db import transaction
from django.utils import timezone

from .models import CloakroomItem

#: Refusals. Kept as constants so the views, the tests and this module cannot drift on a spelling.
NOT_STAFF = 'not_staff'
DESK_CLOSED = 'desk_closed'
RACK_TAKEN = 'rack_taken'
UNKNOWN_RACK = 'unknown_rack'
#: The two the exception dialog can hit. Neither is optional: a lost-token return with no
#: description is a coat handed to whoever asked first, and the identity KIND is the only trace
#: that anybody checked at all.
DESCRIPTION_REQUIRED = 'description_required'
IDENTITY_REQUIRED = 'identity_required'
NOT_STORED = 'not_stored'

#: Verdicts of a return.
RETURNED = 'returned'
UNKNOWN_TOKEN = 'unknown_token'
ALREADY_RETURNED = 'already_returned'
BLACKLISTED = 'blacklisted'


def can_operate(user, event) -> bool:
    """**The one function that answers "who may work this desk".**

    Today: any member of the event's staff — the same bar `events` already sets for checking people
    in, and for the same reason (a volunteer on the door IS the person at the cloakroom counter).

    It is one function rather than a check spelled out at five endpoints precisely because it is
    going to change: `CONFERENCE-BRIEF.md` §5 has the integrator narrowing it to *a confirmed
    `cloakroom` station assignment on the rota* (step E's `shifts` app) when the event has one,
    falling back to staff membership when it has not. When that lands, this body grows an `if` and
    nothing else in this app moves.
    """
    if not (user and getattr(user, 'is_authenticated', False)):
        return False
    if not event.is_staff_member(user):
        return False
    # Integration (CONFERENCE-BRIEF.md §5, 2026-09-23): when the event rostered a `cloakroom`
    # station on step E's rota, the desk is worked by whoever holds a confirmed assignment there —
    # and by the organisers, who built the rota and are the ones a clerk fetches when a slip is
    # lost. An event that never built a rota keeps the plain staff rule; and with the `shifts`
    # switch off the rota is invisible, so it cannot be the thing that locks a desk.
    if event.can_organise(user):
        return True
    from moderation.services import is_feature_enabled
    from shifts.rules import event_has_station, holds_station_assignment

    if is_feature_enabled('shifts') and event_has_station(event, 'cloakroom'):
        return holds_station_assignment(user, event, 'cloakroom')
    return True


def deposit_block_reason(user, desk, rack_label: str) -> str | None:
    """Why this coat cannot go on that hook — or `None`, meaning take it.

    Ordered by what the clerk can do about it: who you are, then whether the desk is open, then
    whether the rack exists, then whether it is free. `rack_taken` is re-checked against the
    database here rather than trusted from the grid the clerk is looking at, because two clerks at
    one desk both see a free rack 12 for as long as it takes the other one to tap it (the
    `events/registration.py` seat rule, one counter down).
    """
    if not can_operate(user, desk.event):
        return NOT_STAFF
    if desk.status != 'open':
        return DESK_CLOSED
    label = (rack_label or '').strip()
    if label not in desk.racks():
        return UNKNOWN_RACK
    if desk.items.filter(status='stored', rack_label=label).exists():
        return RACK_TAKEN
    return None


def free_racks(desk) -> list[str]:
    """The grid the Deposit flow draws. A derivation from the items, never a counter kept on the
    desk (house rule 5): a tally that misses one code path is wrong for the rest of the evening,
    and this is one indexed read.

    **`unclaimed` counts as taken, not free.** A coat nobody came back for is still hanging on
    that hook — found by looking at a screenshot of a closed desk reporting every hook free while
    one of them visibly held a rucksack.
    """
    taken = set(
        desk.items.filter(status__in=['stored', 'unclaimed']).values_list('rack_label', flat=True)
    )
    return [label for label in desk.racks() if label not in taken]


def return_result(desk, token: str) -> tuple[str, CloakroomItem | None]:
    """The verdict on a slip handed across the counter, and the item it names if there is one.

    Reads **every** item at the desk carrying that token, not just the stored one, because the
    three "no" answers are exactly the rows this filter would otherwise throw away:

    - a `returned` / `unclaimed` row → `already_returned`: somebody already took this coat, which
      is a sentence worth saying;
    - a `returned_by_exception` row → `blacklisted`: this coat went home without its slip, so the
      slip in front of you is worth nothing and the person holding it is not the person who left
      the coat (or is, and lost the slip an hour ago and has already been served);
    - nothing at all → `unknown_token`: wrong desk, or a typo.
    """
    if desk.status != 'open':
        return DESK_CLOSED, None
    key = (token or '').strip().upper()
    if not key:
        return UNKNOWN_TOKEN, None
    rows = list(desk.items.filter(token=key))
    stored = next((r for r in rows if r.status == 'stored'), None)
    if stored is not None:
        return RETURNED, stored
    if any(r.status == 'returned_by_exception' for r in rows):
        return BLACKLISTED, next(r for r in rows if r.status == 'returned_by_exception')
    if rows:
        return ALREADY_RETURNED, rows[0]
    return UNKNOWN_TOKEN, None


def hand_back(item, user) -> bool:
    """Mark one stored item returned, and say whether this call is the one that did it.

    A single WHERE-anchored `update()` (`backend/CLAUDE.md`'s SQLite rule 1), not a read-then-save:
    two clerks scanning the same slip at the same moment must not both believe they handed the coat
    over. The loser sees 0 rows and the view answers 409 — the world moved.
    """
    claimed = CloakroomItem.objects.filter(pk=item.pk, status='stored').update(
        status='returned', returned_by=user, returned_at=timezone.now()
    )
    if not claimed:
        return False
    item.refresh_from_db()
    return True


def exception_block_reason(description: str, identity_kind: str) -> str | None:
    """Why this lost-token return cannot be recorded.

    Both fields are mandatory, and neither of them is a document number — `CONFERENCE-BRIEF.md`
    §3.F and research decision 5 are explicit that the desk records *what was shown*, never *what
    it said*. `none` is a legal value of the field (every ordinary item carries it) and an illegal
    answer here, which is the point: the exception path exists because somebody proved something.
    """
    if not (description or '').strip():
        return DESCRIPTION_REQUIRED
    if identity_kind in (None, '', 'none'):
        return IDENTITY_REQUIRED
    return None


def return_by_exception(item, user, *, description: str, identity_kind: str, note: str) -> bool:
    """Hand a coat back to somebody who has no slip, and blacklist the slip they lost.

    There is no second write to blacklist anything: the item's own `returned_by_exception` status
    IS the blacklist (`CloakroomItem.is_blacklisted`, read by `return_result` above). One row, one
    decision, no table that can disagree with the item it describes.
    """
    claimed = CloakroomItem.objects.filter(pk=item.pk, status='stored').update(
        status='returned_by_exception',
        returned_by=user,
        returned_at=timezone.now(),
        description=description.strip()[:200],
        exception_identity_kind=identity_kind,
        exception_note=(note or '').strip()[:300],
        exception_verified_by=user,
    )
    if not claimed:
        return False
    item.refresh_from_db()
    return True


@transaction.atomic
def reconcile(desk, user=None) -> list[CloakroomItem]:
    """Close the desk and say what is still hanging on it.

    Everything still `stored` becomes `unclaimed` — a state, not a deletion (house rule 12): the
    organiser walks away with a list of racks and descriptions, and the row still knows when the
    coat arrived and which clerk took it. Returns that list, in rack order, which is the order
    somebody walks the rail in.

    `atomic()` around two fast statements on two tables, which is exactly the size
    `backend/CLAUDE.md` rule 2 allows; a desk that closed but whose coats were still `stored`
    would be the one genuinely illegal state this app can reach.
    """
    stored = list(desk.items.filter(status='stored'))
    desk.items.filter(status='stored').update(status='unclaimed')
    if desk.status == 'open':
        desk.status = 'closed'
        desk.closed_at = timezone.now()
        desk.closed_by = user
        desk.save(update_fields=['status', 'closed_at', 'closed_by'])
    ids = [row.pk for row in stored]
    return sorted(
        CloakroomItem.objects.filter(pk__in=ids), key=lambda row: _rack_key(desk, row.rack_label)
    )


def _rack_key(desk, label: str):
    """Rack order as the desk typed it, with anything unrecognised last — the rail's own order,
    not the alphabet's ('10' before '9')."""
    racks = desk.racks()
    return (racks.index(label), label) if label in racks else (len(racks), label)
