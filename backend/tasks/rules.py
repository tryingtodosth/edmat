"""Every rule a task has, in one module, because more than one endpoint needs each of them.

`MANAGEMENT-BRIEF.md` §3.B, and the root `CLAUDE.md`'s second load-bearing boundary: an endpoint
that re-derives "may this person move this task" is how the board and the panel start disagreeing
about a button. The node-side half of every answer here is asked of `config.nodes`, never
re-implemented — this module knows what a *task* is, and nothing about what a course is.

**Every refusal is a word** (house rule 6). `not_manager` and `not_staff` are the same boolean and
completely different sentences: one says "you may not do this", the other says "*they* cannot be
given this". The frontend has a line for each, in `lib/utils/labels.ts`.

**The transition table is deliberately narrow.** `todo → in_progress → review → done` forward, any
open status → `cancelled`, and a manager may reopen a finished or cancelled task to `todo`. It is
not a free-for-all because a status people can set to anything stops being read as a status; it is
not a workflow engine because four states do not need one. The one move it does NOT have, and that
a reviewer will eventually want, is `review → in_progress` — a rejection. That is spec, not
oversight: §3.B's table is what was asked for, and the gap is named in `HISTORY.md` §17BI.B's
"Left open" rather than quietly widened here.
"""

from django.utils import timezone

from config import nodes

from .models import CLOSED_STATUSES, OPEN_STATUSES, Task

#: Refusal words. Constants rather than literals at the call sites, so that a rename is one edit
#: and a typo is an ImportError rather than a refusal nobody has a sentence for.
NOT_MANAGER = 'not_manager'
NOT_STAFF = 'not_staff'
NOT_ALLOWED = 'not_allowed'
ALREADY_ASSIGNED = 'already_assigned'
NOT_ASSIGNED = 'not_assigned'
NESTED = 'nested'
HAS_SUBTASKS = 'has_subtasks'
ILLEGAL_TRANSITION = 'illegal_transition'

#: The forward path. A pair not in here, not open→cancelled, and not a manager's reopen is
#: `illegal_transition` (409 — the world is not where the request thought it was).
FORWARD_TRANSITIONS = frozenset(
    {
        ('todo', 'in_progress'),
        ('in_progress', 'review'),
        ('review', 'done'),
    }
)


def _authenticated(user) -> bool:
    return bool(user and getattr(user, 'is_authenticated', False))


def node_of(task):
    """The course / event / material this task hangs on, or None if the row it named is gone.

    A dangling generic target is not an error to raise — it is a task nobody can see, which is what
    every caller below turns it into.
    """
    return task.node


# ---- visibility -------------------------------------------------------------------------------


def visible_tasks(user, node):
    """The tasks on one node, for one reader: **node staff only**, and nobody else.

    A task board is the inside of a team — who is behind on what is not something a course's
    participants or an event's attendees are shown. Anyone below staff gets an empty queryset here
    and a 404 on the list itself (house rule 4: for them it does not exist), which is also why
    `visible_task` below answers the same question for a single id.
    """
    if node is None or not nodes.can_view_node(user, node) or not nodes.is_node_staff(user, node):
        return Task.objects.none()
    return Task.objects.filter(
        content_type=nodes.node_content_type(node), object_id=node.pk
    )


def visible_task(user, task) -> bool:
    """The same rule for a task that arrives with its id in the URL.

    House rule 4's other half: a queryset filter never runs for a single-object action, and this
    app genuinely cannot express "on a node I am staff of" as SQL — the target is a
    `GenericForeignKey` across three (soon four) models with three different rosters, so the join
    does not exist. Every single-object path therefore asks THIS, before anything else it does.
    """
    node = node_of(task)
    if node is None:
        return False
    return nodes.can_view_node(user, node) and nodes.is_node_staff(user, node)


# ---- authority --------------------------------------------------------------------------------


def can_edit(user, task) -> bool:
    """Change the words, the priority, the due date or the order.

    Three parties, deliberately: whoever runs the node, whoever wrote the task, and whoever is
    carrying it. The third is the one that matters — a person who may not fix the due date of the
    thing they are doing ends up keeping the real one somewhere else.
    """
    if not _authenticated(user):
        return False
    node = node_of(task)
    if node is None:
        return False
    if nodes.can_manage_node(user, node):
        return True
    if task.created_by_id == user.pk:
        return True
    return task.assignees.filter(user=user).exists()


def can_assign(user, task) -> bool:
    """Put somebody on a task, or take them off it. **Node managers only.**

    Narrower than `can_edit` on purpose: deciding who does the work is running the thing, and an
    assignee who could hand their task to somebody else would make "who is behind" unanswerable.
    """
    if not _authenticated(user):
        return False
    node = node_of(task)
    return node is not None and nodes.can_manage_node(user, node)


def can_create(user, node) -> bool:
    """Write a new task on a node: **any staff member**, not only a manager.

    A rota's worth of people who can see the board but may only ever be *given* work is a board
    that gets kept in a chat window instead. Assigning it stays with the managers.
    """
    return node is not None and nodes.is_node_staff(user, node)


# ---- refusals ---------------------------------------------------------------------------------


def transition_block_reason(task, to, user=None):
    """Why `task` may not move to `to`, or None.

    `user` is optional only so the signature reads as §3.B writes it; a reopen (`done | cancelled
    → todo`) genuinely needs it, and calling this without a user simply means no reopen is allowed.
    An unknown `to` never reaches here — the serializer refuses it with 400, because a status that
    is not a status is a malformed request, not a conflict (root `CLAUDE.md`, "409 means the world
    moved").
    """
    current = task.status
    if current == to:
        return ILLEGAL_TRANSITION
    if (current, to) in FORWARD_TRANSITIONS:
        return None
    if to == 'cancelled' and current in OPEN_STATUSES:
        return None
    if to == 'todo' and current in CLOSED_STATUSES:
        # Reopening is a manager's call: it un-does a decision somebody already recorded.
        return None if can_assign(user, task) else NOT_MANAGER
    return ILLEGAL_TRANSITION


def assign_block_reason(user, task, target):
    """Why `target` may not be put on `task`, or None.

    `not_staff` is a **400**, following `shifts/views.py`'s own answer for the same shape: the
    request named somebody who cannot be an assignee, which is a bad request rather than a race.
    `already_assigned` is a **409** — that one really is the world having moved under a second
    click.
    """
    if not can_assign(user, task):
        return NOT_MANAGER
    node = node_of(task)
    if target is None or not nodes.is_node_staff(target, node):
        return NOT_STAFF
    if task.assignees.filter(user=target).exists():
        return ALREADY_ASSIGNED
    return None


def unassign_block_reason(user, task, target):
    if not can_assign(user, task):
        return NOT_MANAGER
    if target is None or not task.assignees.filter(user=target).exists():
        return NOT_ASSIGNED
    return None


def subtask_block_reason(user, parent):
    """Why a subtask may not be hung under `parent`, or None. One level, and `nested` says so."""
    if not can_edit(user, parent):
        return NOT_ALLOWED
    if parent.parent_id is not None:
        return NESTED
    return None


def delete_block_reason(user, task):
    """Deleting is the creator's or a manager's, and never silently takes children with it.

    `has_subtasks` rather than a cascade the caller did not ask for: Django would happily delete
    the whole branch (the FK is `CASCADE`, for the sake of a node being removed), and a button that
    quietly removes four other people's rows is the wrong shape for one click. Say no, and let them
    decide what happens to the children.
    """
    node = node_of(task)
    if node is None:
        return NOT_ALLOWED
    if not (nodes.can_manage_node(user, node) or task.created_by_id == getattr(user, 'pk', None)):
        return NOT_ALLOWED
    if task.subtasks.exists():
        return HAS_SUBTASKS
    return None


# ---- derived numbers (recounted, never stored — house rule 5) -----------------------------------


def progress(task):
    """`(done, total)` over this task's subtasks. `(0, 0)` for a task that has none.

    Two `COUNT`s over an indexed FK, every time it is asked, rather than a column somebody has to
    remember to decrement. The honest limit: this counts `done` only, so a **cancelled** subtask
    sits in the denominator for ever — which is the right answer for a checklist (a cancelled item
    is work that did not happen) and is stated here rather than discovered later.
    """
    subtasks = task.subtasks.all()
    total = subtasks.count()
    if total == 0:
        return 0, 0
    return subtasks.filter(status='done').count(), total


def is_overdue(task, now=None) -> bool:
    """Past its due date and still open. A finished or cancelled task is never overdue."""
    if not task.due_at or task.status in CLOSED_STATUSES:
        return False
    return task.due_at < (now or timezone.now())
