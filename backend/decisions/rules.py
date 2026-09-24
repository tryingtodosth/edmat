"""Every poll rule, in one module, asked by the endpoints.

All refusals are words, not booleans (house rule 6). The block_reason functions return
the word, or None when the action is allowed.
"""

from django.utils import timezone

from config.nodes import (
    NODE_KIND_OF_MODEL,
    can_manage_node,
    can_view_node,
    is_node_member,
    is_node_staff,
    kind_of,
    node_content_type,
    node_staff_users,
    resolve_node,
)
from .models import Ballot, Poll, Vote

# Refusal words (kept as constants so views, tests and this module cannot drift on spelling)
NOT_OPEN = 'not_open'
NOT_ELIGIBLE = 'not_eligible'
ALREADY_VOTED = 'already_voted'
TOO_MANY_CHOICES = 'too_many_choices'
UNKNOWN_OPTION = 'unknown_option'
NO_OPTIONS = 'no_options'
ALREADY_OPEN = 'already_open'
ALREADY_CLOSED = 'already_closed'
NOT_DRAFT = 'not_draft'


def visible_polls(user, node):
    """Polls this user may see on this node.

    - Draft: node managers only (404 to everybody else)
    - Open and closed: anyone **eligible**, plus the node's staff

    So a stranger sees no poll at all, and neither does an anonymous reader: a question put to the
    room is not put to the street, and its wording ("shall we drop Tomek from the rota?") is as
    much of the decision as the count is. `eligibility` is the whole of the rule — checking only
    the WORD `members` and not whether this person is one was how, until §17BI.H, every reader of
    a public course saw every `members` poll on it.

    Node staff see every open and closed poll whatever its eligibility, because a staff poll is
    theirs and a members poll is one they are also members of — the seam's `is_node_member`
    already includes staff.
    """
    ct = node_content_type(node)
    qs = Poll.objects.filter(
        content_type_id=ct.id,
        object_id=node.pk,
    )

    if can_manage_node(user, node):
        return qs  # Managers see all, drafts included

    live = qs.filter(status__in=['open', 'closed'])
    if is_node_staff(user, node):
        return live
    if is_node_member(user, node):
        return live.filter(eligibility='members')
    return qs.none()


def can_view_poll(user, poll, node=None) -> bool:
    """`visible_polls` for a poll that arrives with its id in the URL — house rule 4's other half.

    A queryset filter never runs for a single-object route, so `retrieve`, `results` and anything
    else that hands a poll's *contents* back asks this instead of re-deriving the rule. `vote` and
    the manager-only writes deliberately do NOT: they answer a refusal WORD (`not_eligible`,
    `not_open`) rather than a 404, because a person who was shown a ballot and lost their place
    between loading it and clicking needs the sentence, not a vanished page (house rule 6).
    """
    node = node if node is not None else poll_node(poll)
    if node is None or not can_view_node(user, node):
        return False
    return visible_polls(user, node).filter(pk=poll.pk).exists()


def poll_node(poll):
    """The node a poll hangs off (course/event/material row), or None.

    `poll.content_type` is the ContentType of that row — its `app_label` is the plural Django app
    label ('courses', 'events', 'materials'), NOT the short `kind` word `resolve_node` takes
    ('course', 'event', 'material'). `NODE_KIND_OF_MODEL` is the same map `config.nodes.kind_of`
    uses, keyed by (app_label, model) instead of by an instance, so this works from a poll's
    content_type without loading the node first.
    """
    kind = NODE_KIND_OF_MODEL.get((poll.content_type.app_label, poll.content_type.model))
    if not kind:
        return None
    return resolve_node(kind, poll.object_id)


def is_eligible(user, poll) -> bool:
    """Whether this user may vote in this poll."""
    if not (user and getattr(user, 'is_authenticated', False)):
        return False

    node = poll_node(poll)
    if not node:
        return False

    if poll.eligibility == 'staff':
        return is_node_staff(user, node)
    else:  # 'members'
        return is_node_member(user, node)


def vote_block_reason(user, poll, option_ids: list[int]) -> str | None:
    """Why this user cannot vote right now.

    Checks, in order:
    1. Is the poll open?
    2. Is the user eligible?
    3. Has the user already voted?
    4. Is the option list valid for the mode?
    5. Do all options exist?

    Returns None if voting is allowed, or a refusal word.
    """
    now = timezone.now()

    # Check if poll is open
    if poll.status != 'open':
        return NOT_OPEN

    # Check if opens_at has passed (if set)
    if poll.opens_at and now < poll.opens_at:
        return NOT_OPEN

    # Check if closes_at has passed (if set)
    if poll.closes_at and now >= poll.closes_at:
        return NOT_OPEN

    # Check eligibility
    if not is_eligible(user, poll):
        return NOT_ELIGIBLE

    # Check if already voted
    if Ballot.objects.filter(poll=poll, user=user).exists():
        return ALREADY_VOTED

    # Check option list for mode
    if not option_ids:
        return UNKNOWN_OPTION

    if poll.mode == 'single' and len(option_ids) > 1:
        return TOO_MANY_CHOICES

    # Check all options exist and belong to this poll
    existing_ids = set(poll.options.values_list('id', flat=True))
    if not all(oid in existing_ids for oid in option_ids):
        return UNKNOWN_OPTION

    return None


def can_see_results(user, poll) -> bool:
    """Who may see the poll results.

    - Managers: always
    - Everyone else: only after the poll is closed
    """
    node = poll_node(poll)
    if not node:
        return False
    return can_manage_node(user, node) or poll.status == 'closed'


def eligible_count(poll, node) -> int:
    """How many people could vote — always a recount (house rule 5), never stored.

    `eligibility='staff'` is exactly `node_staff_users` (the seam already answers this). For
    `'members'` the seam's `is_node_member` is staff OR enrolled/going, but it does not expose an
    enumeration — so this counts staff plus whoever is actually enrolled/attending, per node kind,
    the same roster each node's own membership row already tracks.
    """
    if poll.eligibility == 'staff':
        return node_staff_users(node).count()

    kind = kind_of(node)
    staff_ids = set(node_staff_users(node).values_list('id', flat=True))
    if kind == 'course':
        member_ids = set(node.enrollments.filter(status='active').values_list('participant_id', flat=True))
    elif kind == 'event':
        from events.models import SEAT_HOLDING_STATUSES

        member_ids = set(node.attendances.filter(status__in=SEAT_HOLDING_STATUSES).values_list('attendee_id', flat=True))
    else:
        # A material's "members" are its project's members — the same set as its staff.
        member_ids = set()
    return len(staff_ids | member_ids)


def open_block_reason(poll) -> str | None:
    """Why this poll cannot be opened.

    - Must have at least 2 options
    - Must not already be open or closed
    """
    if poll.options.count() < 2:
        return NO_OPTIONS
    if poll.status != 'draft':
        return ALREADY_OPEN
    return None


def close_block_reason(poll) -> str | None:
    """Why this poll cannot be closed.

    - Must not already be closed
    """
    if poll.status == 'closed':
        return ALREADY_CLOSED
    return None
