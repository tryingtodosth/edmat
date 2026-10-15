"""`work_items(user)` for the personal work dashboard — the §3.F shape of `MANAGEMENT-BRIEF.md`.

**Not imported anywhere on this branch.** `work/` does not know this app exists yet and this app
must not import `work/` either (CONTESTS-BRIEF.md §4 rule 13 — the brief's own rule 13); step B
registers this function in `work/builtin.py` behind the `contests` flag, with a label for each of
the four kinds. The dict shape is `work/providers.py: ITEM_KEYS` exactly:
`('kind', 'title', 'url', 'due_at', 'status', 'count', 'urgency', 'node')`.

`status` is a CODE from `work/providers.py: STATUS_CODES` — a registration's own status
(`requested`/`accepted`), `open` for a stage or a complaint, `waiting` for a juror's row, whose
number of submissions left travels separately as `count` (the frontend says "5 to score" in the
reader's language; this module used to send the English sentence `'5 waiting'`).

Four kinds, each answering a different question for a different person:

| kind | who sees it | what it is |
|---|---|---|
| `contest_registration` | a participant | a contest they are in, with the next thing that happens |
| `contest_stage` | a participant | a stage that is OPEN and they have not handed in |
| `contest_judging` | a juror | a closed stage with submissions they have not finished scoring |
| `contest_complaint` | an organiser or secretary | a complaint waiting for an answer, with its deadline |

The complaint row is the one with a real legal deadline on it — 14 days to answer with reasons
(UOKiK's own register) — so it is the one whose `urgency` reaches 3 on its own.

**One row per thing to do, not per person affected**: an organiser with nine open complaints gets
nine rows because each is a separate answer somebody is owed, while a juror with forty submissions
to mark on one stage gets ONE row carrying the count, the `needs.work_items` shape, because the
work is "finish marking this stage".
"""

from __future__ import annotations

from django.utils import timezone

from config import nodes as node_seam

from . import access
from .models import Contest, ContestStage, ContestSubmission

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


def _row(kind, title, url, due_at, status, urgency, node, user, count=None):
    return {
        'kind': kind,
        'title': title,
        'url': url,
        'due_at': due_at.isoformat() if due_at else None,
        'status': status,
        'count': count,
        'urgency': urgency,
        'node': node_seam.node_ref(node, user) if node is not None else None,
    }


def work_items(user) -> list[dict]:
    if not (user and getattr(user, 'is_authenticated', False)):
        return []

    items: list[dict] = []
    live = ('announced', 'registration_open', 'running', 'judging', 'results_published')

    # ---- a participant: the contests I am in, and the stages waiting for me -------------------
    mine = (
        Contest.objects.filter(
            registrations__user=user,
            registrations__status__in=('requested', 'accepted'),
            status__in=live,
        )
        .distinct()
        .prefetch_related('registrations', 'stages')
    )
    for contest in mine:
        registration = next(
            (r for r in contest.registrations.all() if r.user_id == user.pk), None
        )
        if registration is None:
            continue
        next_at = _next_date(contest)
        items.append(_row(
            'contest_registration', contest.title, f'/contests/{contest.pk}',
            next_at, registration.status, _urgency(next_at), contest, user,
        ))
        if not registration.is_competing:
            continue
        for stage in contest.stages.all():
            if stage.status != 'open':
                continue
            handed_in = ContestSubmission.objects.filter(
                stage=stage, registration=registration
            ).exclude(status='draft').exists()
            if handed_in:
                continue
            items.append(_row(
                'contest_stage', f'{contest.title}: {stage.title}',
                f'/contests/{contest.pk}/stages/{stage.pk}',
                stage.closes_at, 'open', max(_urgency(stage.closes_at), 2), contest, user,
            ))

    # ---- a juror: closed stages with marking left ---------------------------------------------
    judging = (
        ContestStage.objects.filter(
            contest__status__in=live, status__in=('closed', 'open'),
        )
        .select_related('contest')
        .prefetch_related('contest__staff', 'problems', 'submissions__scores')
    )
    for stage in judging:
        if not access.can_score(user, stage.contest):
            continue
        if stage.status != 'closed':
            continue
        problem_ids = {p.pk for p in stage.problems.all()}
        if not problem_ids:
            continue
        waiting = 0
        for submission in stage.submissions.all():
            if submission.status == 'draft':
                continue
            if submission.registration.user_id == user.pk:
                continue
            mine_scored = {
                s.problem_id for s in submission.scores.all() if s.juror_id == user.pk
            }
            if mine_scored != problem_ids:
                waiting += 1
        if not waiting:
            continue
        items.append(_row(
            'contest_judging', f'{stage.contest.title}: {stage.title}',
            f'/contests/{stage.contest.pk}/judge', stage.closes_at,
            'waiting', max(_urgency(stage.closes_at), 2), stage.contest, user, count=waiting,
        ))

    # ---- an organiser or secretary: complaints owed an answer ----------------------------------
    from .models import ContestComplaint

    complaints = (
        ContestComplaint.objects.filter(status='open')
        .select_related('contest')
        .prefetch_related('contest__staff')
    )
    for complaint in complaints:
        role = access.role_of(user, complaint.contest)
        if role not in ('organiser', 'secretary'):
            continue
        due_at = complaint.contest.complaints_close_at
        items.append(_row(
            'contest_complaint', complaint.contest.title,
            f'/contests/{complaint.contest.pk}/manage', due_at, 'open',
            max(_urgency(due_at), 2), complaint.contest, user,
        ))

    return items


def _next_date(contest):
    """The next thing that happens, from a participant's point of view. The stage that opens or
    closes soonest, else the registration deadline, else the contest's end — whichever is still in
    the future. A dashboard row with no date reads as "nothing to do", which for a contest that
    closes tomorrow is false."""
    now = timezone.now()
    candidates = [
        contest.registration_closes_at,
        *[s.closes_at for s in contest.stages.all()],
        *[s.opens_at for s in contest.stages.all()],
        contest.ends_at,
    ]
    future = sorted(d for d in candidates if d and d > now)
    return future[0] if future else None
