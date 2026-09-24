"""`work_items(user)` — the `plans` contribution to the personal work dashboard
(MANAGEMENT-BRIEF.md §3.F's shape; §5: the integrator registers this in `work/providers.py`, this
app never imports `work` itself, MANAGEMENT-BRIEF.md §4 rule 13).

Two sections, exactly as §3.D specifies: steps due within 14 days on active plans I can edit, and
pending suggestions on plans I manage. Both ask `plans/rules.can_edit` rather than re-deriving
"mine" — the one place that answer lives.

Honest limitation, named rather than hidden (house rule 14): this walks every open row across the
whole table and filters in Python, because `can_edit` dispatches across course/event/material/
organisation node kinds that cannot be expressed as one SQL join. Fine at this project's scale
(a few hundred plans at most); `backend/plans/CLAUDE.md` says so as the thing to revisit first if
it ever needs to be someone's `work_items` that shows up slow in `manage.py measure_moderation_queue`-
style profiling.
"""

from datetime import timedelta

from django.utils import timezone

from config import nodes

from . import rules
from .models import PlanStep, PlanSuggestion

SOON_DAYS = 14

ITEM_KEYS = ('kind', 'title', 'url', 'due_at', 'status', 'urgency', 'node')


def _urgency(due_at, now) -> int:
    if due_at is None:
        return 0
    if due_at < now:
        return 3
    if due_at <= now + timedelta(days=7):
        return 2
    if due_at <= now + timedelta(days=SOON_DAYS):
        return 1
    return 0


def _node_ref(plan, user):
    node = plan.node
    return nodes.node_ref(node, user) if node is not None else None


def work_items(user) -> list[dict]:
    if not (user and getattr(user, 'is_authenticated', False)):
        return []

    now = timezone.now()
    horizon = now + timedelta(days=SOON_DAYS)
    items: list[dict] = []

    due_steps = (
        PlanStep.objects.filter(plan__status=rules.ACTIVE, due_at__isnull=False, due_at__lte=horizon)
        .exclude(status__in=['done', 'skipped'])
        .select_related('plan')
        .order_by('due_at')
    )
    for step in due_steps:
        plan = step.plan
        if not rules.can_edit(user, plan):
            continue
        items.append({
            'kind': 'plan_step',
            'title': step.title,
            'url': f'/plans/{plan.pk}',
            'due_at': step.due_at.isoformat(),
            'status': step.status,
            'urgency': _urgency(step.due_at, now),
            'node': _node_ref(plan, user),
        })

    pending_suggestions = (
        PlanSuggestion.objects.filter(status='pending')
        .select_related('plan')
        .order_by('created_at')
    )
    for suggestion in pending_suggestions:
        plan = suggestion.plan
        if not rules.can_edit(user, plan):
            continue
        items.append({
            'kind': 'plan_suggestion',
            'title': suggestion.text[:120],
            'url': f'/plans/{plan.pk}',
            'due_at': None,
            'status': suggestion.status,
            'urgency': 0,
            'node': _node_ref(plan, user),
        })

    return items
