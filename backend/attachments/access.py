"""Who may see an attachment, and who may add one — the one module every endpoint asks.

The root CLAUDE.md's second boundary: a rule more than one endpoint needs lives in one module, and
the endpoints ask it. There are five surfaces now (a node page, a board row, a comment, the
protected file endpoint and the acknowledgement ledger) and one answer.

**The ladder, generalised from `documents/access.py`.** `public ⊂ members ⊂ staff ⊂ managers`, each
answer including everything under it — a manager reads the staff notes, a staff member reads what
the members were sent, and everybody who can see the thing reads the public ones. `venue` is the one
tier NOT on the ladder: the building's own administrators are neither above nor below an organiser,
they are somebody else entirely (a fire plan they wrote; an access arrangement they need signed).

**Three target shapes, and the differences are real.**

- A **node** (course, event, material, organisation) answers the whole ladder through
  `config/nodes.py`, plus `venue` for an event that has an approved booking.
- A **board row** (task, plan, need, goal) has no standing of its own and inherits the node it is
  hung on, exactly as its own discussion thread does. Its attachments are therefore visible to the
  same people as the node's — and a row a reader cannot see has no attachments, because the row
  itself 404s first.
- A **comment** has no node at all. Its attachment is visible to whoever may read the comment, which
  `community` already decides, so the tiers do not apply: only `public` is legal and the rest are
  refused at write time rather than quietly treated as public.

**Nothing here decides whether the TARGET is visible.** That is a queryset filter and belongs to
whoever resolved it (house rule 4); this module answers the second, object-level half.
"""

from __future__ import annotations

from config import nodes

from . import targets
from .models import (
    TIER_LADDER,
    TIER_MANAGERS,
    TIER_MEMBERS,
    TIER_PUBLIC,
    TIER_STAFF,
    TIER_VENUE,
    Attachment,
)

#: Refusal words, not booleans (house rule 6). "This is not yours" and "a comment has no tiers" are
#: the same `False` and completely different to a person.
NOT_FOUND = 'not_found'
NOT_ALLOWED = 'not_allowed'
UNKNOWN_KIND = 'unknown_kind'
TIER_NOT_ON_A_COMMENT = 'tier_not_on_a_comment'
VENUE_TIER_IS_EVENT_ONLY = 'venue_tier_is_event_only'


def _authenticated(user) -> bool:
    return bool(user and getattr(user, 'is_authenticated', False))


def _up_to(tier: str) -> set[str]:
    """Every tier at or below `tier` on the ladder."""
    return set(TIER_LADDER[: TIER_LADDER.index(tier) + 1])


def venue_admin_check(user, event) -> bool:
    """The building an event has an APPROVED booking with is the one whose administrators read its
    `venue` tier — `documents/access.py`'s rule, carried over unchanged. A requested-but-undecided
    booking grants nothing: the building has not said yes yet."""
    if not _authenticated(user):
        return False
    from venues.access import is_venue_admin

    booking = event.room_bookings.filter(status='approved').select_related('room__venue').first()
    return bool(booking) and is_venue_admin(user, booking.room.venue)


def visible_tiers_for(user, target) -> frozenset[str]:
    """The tiers this person may read on this target."""
    kind = targets.kind_of(target)
    if kind in targets.COMMENT_TARGET_KINDS:
        # A comment's own visibility is the whole rule; there is no ladder to climb.
        return frozenset({TIER_PUBLIC})

    node = targets.node_behind(target)
    if node is None:
        return frozenset()

    tiers = {TIER_PUBLIC}
    if not _authenticated(user):
        return frozenset(tiers)

    if nodes.can_manage_node(user, node):
        # A manager sees everything the target holds, the venue tier included on an event: they are
        # the party the building is corresponding WITH, so a document addressed to it is addressed
        # to them too.
        return frozenset(set(TIER_LADDER) | {TIER_VENUE})
    if nodes.is_node_staff(user, node):
        tiers |= _up_to(TIER_STAFF)
    elif nodes.is_node_member(user, node):
        tiers |= _up_to(TIER_MEMBERS)

    if nodes.kind_of(node) == 'event' and venue_admin_check(user, node):
        tiers.add(TIER_VENUE)
    return frozenset(tiers)


def can_view_target(user, target) -> bool:
    """Whether this person may see the thing the attachment hangs off at all. A stranger gets 404
    on everything hung on it (house rule 4)."""
    kind = targets.kind_of(target)
    if kind in targets.COMMENT_TARGET_KINDS:
        # Asked of `community` rather than re-derived: a HELD comment (auto-hidden, awaiting
        # review) is visible to its author and to staff and to nobody else, and that rule already
        # has one home. One row through the same queryset filter, so this can never drift from the
        # thread the comment is drawn in.
        from community.discussions import visible_comments
        from community.models import Comment

        return visible_comments(user, Comment.objects.filter(pk=target.pk)).exists()
    node = targets.node_behind(target)
    if not (node and nodes.can_view_node(user, node)):
        return False
    # Most board rows are visible to whoever may see the node, and that is the whole rule. A POLL
    # is not: a draft is managers-only and an open one is for the eligible, because "shall we drop
    # Tomek from the rota?" is as much of the decision as the count is (`decisions/rules.py`). Its
    # attachments — the figures, the draft being voted on — have to inherit THAT, or this app
    # becomes the way to read a question nobody was shown. Asked of the app that owns the rule
    # rather than re-derived here (2026-10-10, when `poll` joined the registry).
    if targets.kind_of(target) == 'poll':
        from decisions import rules as poll_rules

        return poll_rules.can_view_poll(user, target, node)
    return True


def can_attach(user, target) -> bool:
    """Who may add one.

    - On a **node**, its staff: the people running the thing. Not every member, because an
      attachment on a course page is the course's pile of files and not a free-for-all — a
      participant who wants to add something has the comment thread, which has its own attachments.
    - On a **board row**, the same, plus the row's own author: somebody who filed a need may attach
      the photo that explains it.
    - On a **comment**, its author. Nobody attaches to somebody else's comment.
    """
    if not _authenticated(user):
        return False
    kind = targets.kind_of(target)
    if kind in targets.COMMENT_TARGET_KINDS:
        return getattr(target, 'author_id', None) == user.pk
    node = targets.node_behind(target)
    if node is None:
        return False
    if nodes.is_node_staff(user, node) or nodes.can_manage_node(user, node):
        return True
    if kind in targets.ROW_TARGET_KINDS:
        for field in ('created_by_id', 'author_id', 'submitted_by_id'):
            if getattr(target, field, None) == user.pk:
                return True
    return False


def can_manage_attachments(user, target) -> bool:
    """Replacing, retiring, changing a tier, and reading the receipts.

    Managers only on a node — `documents/access.py`'s reason carries over exactly: a volunteer who
    could publish a mandatory briefing could lock every other volunteer out of the door. On a
    comment it is the comment's author.
    """
    if not _authenticated(user):
        return False
    if targets.kind_of(target) in targets.COMMENT_TARGET_KINDS:
        return getattr(target, 'author_id', None) == user.pk
    node = targets.node_behind(target)
    return bool(node) and nodes.can_manage_node(user, node)


def tier_block_reason(target, visibility: str) -> str | None:
    """Why this tier may not be used on this target — a word, never a boolean (house rule 6)."""
    kind = targets.kind_of(target)
    if kind is None:
        return UNKNOWN_KIND
    if kind in targets.COMMENT_TARGET_KINDS and visibility != TIER_PUBLIC:
        return TIER_NOT_ON_A_COMMENT
    if visibility == TIER_VENUE:
        node = targets.node_behind(target)
        if node is None or nodes.kind_of(node) != 'event':
            return VENUE_TIER_IS_EVENT_ONLY
    return None


def visible_attachments(user, target):
    """The queryset half (house rule 4): every CURRENT attachment of this target in a tier this
    person has. Superseded and withdrawn rows are out — they are history, reachable only through the
    manager's own ledger view."""
    from django.contrib.contenttypes.models import ContentType

    content_type = ContentType.objects.get_for_model(target, for_concrete_model=False)
    return (
        Attachment.objects.filter(
            content_type=content_type,
            object_id=target.pk,
            visibility__in=visible_tiers_for(user, target),
            replaced_by__isnull=True,
            removed_at__isnull=True,
        )
        .select_related('uploaded_by', 'uploaded_by__profile', 'sketch', 'chem_drawing')
        .prefetch_related('acknowledgements')
    )


def can_read_attachment(user, attachment) -> bool:
    """The object-level half, for anything addressed by id — a filter never runs for those."""
    target = attachment.target
    if target is None or not can_view_target(user, target):
        return False
    return attachment.visibility in visible_tiers_for(user, target)


def missing_acknowledgements(user, target) -> list[Attachment]:
    """The mandatory attachments this person has not acknowledged AT THEIR CURRENT VERSION.

    Empty for anonymous callers (nothing to owe), and empty while the `attachments` flag is off —
    house rule 3 cuts both ways: a killed feature must not keep imposing its rule on a neighbouring
    surface that is still meant to work.
    """
    from moderation.services import is_feature_enabled

    if not _authenticated(user) or not is_feature_enabled('attachments'):
        return []
    owed = visible_attachments(user, target).filter(requires_acknowledgement=True)
    return [
        row
        for row in owed
        if not any(ack.user_id == user.pk and ack.version == row.version for ack in row.acknowledgements.all())
    ]
