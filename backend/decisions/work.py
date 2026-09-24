"""Integration point for the work dashboard (step F).

Provides `work_items(user) -> list[dict]` with items the user should act on.
"""

from django.utils import timezone

from . import rules
from .models import Ballot, Poll


def work_items(user):
    """Open polls the user is eligible for and has not voted in, soonest closes_at first.

    Each item is a dict with keys: kind, title, url, due_at, status, urgency, node.
    """
    if not (user and getattr(user, 'is_authenticated', False)):
        return []

    items = []

    # Find all open polls the user is eligible for
    polls = Poll.objects.filter(status='open').select_related('created_by').prefetch_related('options')

    now = timezone.now()

    for poll in polls:
        # Check if opens_at has passed (if set)
        if poll.opens_at and now < poll.opens_at:
            continue

        # Check if closes_at has passed (if set)
        if poll.closes_at and now >= poll.closes_at:
            continue

        # Check eligibility
        if not rules.is_eligible(user, poll):
            continue

        # Check if already voted
        if Ballot.objects.filter(poll=poll, user=user).exists():
            continue

        # Determine urgency: 3 if closing today, 2 if this week, 1 if later
        urgency = 0
        if poll.closes_at:
            time_left = poll.closes_at - now
            if time_left.days == 0:
                urgency = 3
            elif time_left.days < 7:
                urgency = 2
            else:
                urgency = 1

        # Determine node for the item
        from config.nodes import resolve_node, node_ref

        node_obj = resolve_node(poll.content_type.app_label, poll.object_id)
        node = node_ref(node_obj, user) if node_obj else None

        items.append({
            'kind': 'poll',
            'title': poll.question,
            'url': f'/polls/{poll.id}',
            'due_at': poll.closes_at.isoformat() if poll.closes_at else None,
            'status': 'open',
            'urgency': urgency,
            'node': node,
        })

    # Sort by due_at (soonest first), with None at the end
    items.sort(key=lambda x: (x['due_at'] is None, x['due_at']))

    return items
