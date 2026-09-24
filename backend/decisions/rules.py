"""Every poll rule, in one module, asked by the endpoints.

All refusals are words, not booleans (house rule 6). The block_reason functions return
the word, or None when the action is allowed.
"""

from django.utils import timezone

from config.nodes import can_manage_node, is_node_member, is_node_staff, resolve_node
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

    - Draft: node managers only (404 to a stranger)
    - Open and closed: anyone who can see the node, if they are eligible OR if they are staff

    So a stranger sees no open poll. A member sees open polls they are eligible for.
    Node staff see all non-draft polls.
    """
    qs = Poll.objects.filter(
        content_type_id=node.node_content_type.id,
        object_id=node.pk,
    )

    if can_manage_node(user, node):
        return qs  # Managers see all

    # Non-managers see only open/closed polls they are eligible for
    if not (user and getattr(user, 'is_authenticated', False)):
        return qs.filter(status__in=['open', 'closed']).filter(eligibility='members')

    qs = qs.filter(status__in=['open', 'closed'])

    # If they're staff, they see all open/closed; if not, only ones they're eligible for
    if is_node_staff(user, node):
        return qs

    # Non-staff see only those eligible for members
    return qs.filter(eligibility='members')


def is_eligible(user, poll) -> bool:
    """Whether this user may vote in this poll."""
    if not (user and getattr(user, 'is_authenticated', False)):
        return False

    node = resolve_node(poll.content_type.app_label, poll.object_id)
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
    node = resolve_node(poll.content_type.app_label, poll.object_id)
    if not node:
        return False
    return can_manage_node(user, node) or poll.status == 'closed'


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
