"""This app's row on the personal work dashboard (`MANAGEMENT-BRIEF.md` §3.F).

`work/providers.py` registers this function behind the `tasks` flag at integration (§5); nothing
here imports `work`, and `work` does not import this — the registration is two lines in that file,
written by the integrator, so that six branches never edit each other's app (§4 rule 13).

**What it answers, and why in that order.** Tasks assigned to me that are still open, overdue
first and then by due date, followed by tasks I created that are sitting in `review` — because
those are the two ways a task is waiting on a person: one is work, the other is a decision. A task
I created that somebody else is doing is not waiting on me and is deliberately absent.

The node-staff check runs in Python over one account's own rows, for the reason `views.py` records:
a `GenericForeignKey` across three rosters has no SQL join. A provider that raises is reported in
the dashboard's `unavailable` rather than being fatal (§3.F), so this one being slow or wrong
degrades one section of one page.
"""

from datetime import timedelta

from django.utils import timezone

from config import nodes

from . import rules
from .models import OPEN_STATUSES, Task


def urgency_of(due_at, now=None) -> int:
    """0 none, 1 this month, 2 this week, 3 overdue or today — §3.F's own scale.

    "Today" counts as 3 rather than 2: something due at 23:00 tonight and something two hours
    overdue need the same dot, because the person reading the page can still act on both and has
    the same amount of time to do it.
    """
    if due_at is None:
        return 0
    now = now or timezone.now()
    if due_at <= now or timezone.localtime(due_at).date() <= timezone.localtime(now).date():
        return 3
    if due_at - now <= timedelta(days=7):
        return 2
    if due_at - now <= timedelta(days=31):
        return 1
    return 0


def _item(task, user):
    node = rules.node_of(task)
    return {
        'kind': 'task',
        'title': task.title,
        'url': f'/tasks/{task.pk}',
        'due_at': task.due_at.isoformat() if task.due_at else None,
        'status': task.status,
        'urgency': urgency_of(task.due_at),
        'node': nodes.node_ref(node, user) if node is not None else None,
    }


def work_items(user):
    if not user or not getattr(user, 'is_authenticated', False):
        return []
    base = Task.objects.select_related('content_type', 'created_by').prefetch_related('assignees')
    assigned = list(base.filter(assignees__user=user, status__in=OPEN_STATUSES).distinct())
    reviewing = list(
        base.filter(created_by=user, status='review')
        .exclude(assignees__user=user)
        .distinct()
    )
    items = []
    for task in sorted(assigned, key=lambda t: (not rules.is_overdue(t), t.due_at is None, t.due_at or timezone.now(), t.priority)):
        if rules.visible_task(user, task):
            items.append(_item(task, user))
    for task in sorted(reviewing, key=lambda t: t.created_at):
        if rules.visible_task(user, task):
            items.append(_item(task, user))
    return items
