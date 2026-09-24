"""A task: the one actionable item that hangs off anything work gets organised around.

`MANAGEMENT-BRIEF.md` §3.B. Two tables, and the second one is the interesting one.

**Why a generic target rather than three foreign keys.** A course, an event, a material and (once
step A lands) an organisation all need "somebody has to do this by Friday", and all four already
have a roster and a rule module saying who runs them. So a task points at a *node* through
`config.nodes` — `content_type` + `object_id`, the `community.Comment` / `moderation.Report` shape
this codebase already uses four times — and asks that module who has standing. The registry of
legal targets is `config.nodes.NODE_KINDS` rather than a list of this app's own: a task on a thing
nobody can run is a task nobody can be given.

**One level of subtasks, and the limit is a refusal, not a silence.** `parent` is a self FK, and a
subtask of a subtask answers `409 nested` (`rules.NESTED`). The reason is not schema tidiness — it
is that `progress()` is "done subtasks over subtasks", which stops meaning anything the moment the
tree is arbitrarily deep, and a checklist that quietly becomes a work-breakdown structure is how a
board people trusted stops being read.

**`progress` and `is_overdue` are not fields.** Both are recounted from the rows (house rule 5):
a stored `progress` drifts the first time a subtask is deleted by a path that forgot to decrement,
and a stored `is_overdue` is wrong at 00:01 every night. `done_at` IS stored, because it records
*when* something happened rather than restating what `status` already says.

**One `status`, never two booleans** (the shape note in the root `CLAUDE.md`): `done` and
`cancelled` are two different ends, and "finished but cancelled" is a state nothing should have to
defend against. `rules.transition_block_reason` is the only thing that moves it.

`frontend/src/lib/utils/labels.ts` mirrors `STATUS_CHOICES` and `PRIORITY_CHOICES` below, and names
this module from its side (house rule 13: say it in both files).
"""

from django.conf import settings
from django.contrib.contenttypes.fields import GenericForeignKey
from django.contrib.contenttypes.models import ContentType
from django.db import models

#: The lifecycle. `todo → in_progress → review → done`, anything open → `cancelled`, and a manager
#: may reopen a finished or cancelled task to `todo`. `rules.transition_block_reason` holds the
#: table itself; these are only the words.
STATUS_CHOICES = [
    ('todo', 'To do'),
    ('in_progress', 'In progress'),
    ('review', 'In review'),
    ('done', 'Done'),
    ('cancelled', 'Cancelled'),
]

#: Still waiting on somebody. The work dashboard and the `?overdue=1` filter both read this rather
#: than spelling out three strings each time.
OPEN_STATUSES = frozenset({'todo', 'in_progress', 'review'})

#: Finished, one way or the other. A task in one of these is never overdue.
CLOSED_STATUSES = frozenset({'done', 'cancelled'})

#: 1 is most urgent. Four levels rather than three because three collapses to "normal and not
#: normal" in practice, and rather than five because nobody has ever agreed what the middle of five
#: means. The default is 3 — "ordinary" — so an unconsidered priority is not a loud one.
PRIORITY_CHOICES = [
    (1, 'Urgent'),
    (2, 'High'),
    (3, 'Normal'),
    (4, 'Low'),
]


class Task(models.Model):
    """Something to be done, on a course, an event, a material or an organisation."""

    # The node. `config.nodes` says which models are legal here and who has standing on each; this
    # model deliberately holds no allowlist of its own, so that step A's `organization` kind becomes
    # a legal target by uncommenting one line there and nothing here.
    content_type = models.ForeignKey(ContentType, on_delete=models.CASCADE)
    object_id = models.PositiveIntegerField()
    node = GenericForeignKey('content_type', 'object_id')

    title = models.CharField(max_length=200)
    # Sanitized on write (`config/sanitize.py`) and rendered through the ordinary content pipeline,
    # so a task description carries the same Markdown + LaTeX a statement does — house rule 8.
    description = models.TextField(blank=True)

    status = models.CharField(max_length=12, choices=STATUS_CHOICES, default='todo')
    priority = models.PositiveSmallIntegerField(choices=PRIORITY_CHOICES, default=3)
    due_at = models.DateTimeField(null=True, blank=True)

    # One level. A row whose parent already has a parent is refused by `rules.NESTED` before it is
    # ever created; the schema cannot express the limit, so the rule module is where it lives and
    # the tests are what keep it true.
    parent = models.ForeignKey(
        'self', related_name='subtasks', null=True, blank=True, on_delete=models.CASCADE
    )

    # Hand ordering within a status column. Ties break on `created_at`, so a board that has never
    # been reordered still reads oldest-first rather than by primary key.
    order = models.PositiveIntegerField(default=0)

    created_by = models.ForeignKey(
        settings.AUTH_USER_MODEL, related_name='tasks_created', on_delete=models.CASCADE
    )
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    #: When it reached `done`. Set and cleared by the transition, never by hand — it is the one
    #: thing `status` does not already say.
    done_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        ordering = ['order', 'created_at']
        indexes = [
            models.Index(fields=['content_type', 'object_id']),
            models.Index(fields=['status']),
            models.Index(fields=['due_at']),
        ]

    def __str__(self):
        return self.title


class TaskAssignee(models.Model):
    """One person carrying one task.

    A row rather than a `ManyToManyField` so that *who put them there* and *when* survive — the
    same reason `courses.CourseStaff` is a table. `assigned_by` is nullable for a row created by a
    data migration or by an account since deleted: an honest absence beats attributing it to
    whoever happened to run the migration.

    **An assignee must be node staff** (`rules.assign_block_reason` → `not_staff`). A task is work
    the team carries; handing one to a passer-by would be the only place in this app where
    membership of the node stopped meaning anything.
    """

    task = models.ForeignKey(Task, related_name='assignees', on_delete=models.CASCADE)
    user = models.ForeignKey(
        settings.AUTH_USER_MODEL, related_name='task_assignments', on_delete=models.CASCADE
    )
    assigned_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        related_name='task_assignments_made',
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
    )
    assigned_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        unique_together = [('task', 'user')]
        ordering = ['assigned_at']

    def __str__(self):
        return f'{self.user} on {self.task_id}'
