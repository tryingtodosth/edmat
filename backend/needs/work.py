"""`needs.work_items(user)` — the work-dashboard provider shape (MANAGEMENT-BRIEF.md §3.F). Not
imported anywhere on THIS branch — step F's `work/` app does not know this app exists yet, and this
app must not import `work/` either (MANAGEMENT-BRIEF.md §4 rule 13). The integrator registers this
function in `work/providers.py` at §5 with a two-line `register('need_application', 'needs',
needs.work.work_items)`-shaped call (`work/CLAUDE.md` has the exact shape).

Two rows per person, per MANAGEMENT-BRIEF.md §3.C: their own pending applications, and — for
whichever needs they manage — one row per need that has pending applications waiting, carrying the
count rather than one row per applicant (a manager with five open postings and fifteen applicants
gets five rows to look at, not fifteen).
"""

from django.utils import timezone

from config import nodes as node_seam

from .models import NeedApplication
from .rules import can_manage

#: MANAGEMENT-BRIEF.md §6 default: "soon" is 14 days everywhere a dashboard reads a due date.
_URGENT_DAYS = 14


def _urgency(due_at) -> int:
    if not due_at:
        return 0
    now = timezone.now()
    if due_at < now:
        return 3
    days = (due_at - now).days
    if days < 7:
        return 2
    if days < _URGENT_DAYS:
        return 1
    return 0


def work_items(user) -> list[dict]:
    items: list[dict] = []

    mine = (
        NeedApplication.objects.filter(user=user, status='pending')
        .select_related('need', 'need__content_type')
        .order_by('-created_at')
    )
    for application in mine:
        need = application.need
        node = need.node
        items.append({
            'kind': 'need_application',
            'title': need.title,
            'url': f'/needs/{need.pk}',
            'due_at': need.deadline.isoformat() if need.deadline else None,
            'status': application.status,
            'urgency': _urgency(need.deadline),
            'node': node_seam.node_ref(node, user) if node is not None else None,
        })

    pending = (
        NeedApplication.objects.filter(status='pending')
        .select_related('need', 'need__content_type')
        .order_by('need_id')
    )
    by_need: dict[int, list[NeedApplication]] = {}
    for application in pending:
        by_need.setdefault(application.need_id, []).append(application)

    for applications in by_need.values():
        need = applications[0].need
        if not can_manage(user, need):
            continue
        items.append({
            'kind': 'need_decision',
            'title': need.title,
            'url': f'/needs/{need.pk}',
            'due_at': need.deadline.isoformat() if need.deadline else None,
            'status': f'{len(applications)} pending',
            'urgency': max(_urgency(need.deadline), 2 if applications else 0),
            'node': node_seam.node_ref(need.node, user),
        })

    return items
