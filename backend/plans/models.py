"""`Plan` — a roadmap of ordered steps hung off a node, with readers' suggestions the plan's
editor can accept into a step (MANAGEMENT-BRIEF.md §3.D).

The node is a `GenericForeignKey` through the registry in `config/nodes.py`, exactly the
`community.Comment` / `moderation.Report` shape the root `CLAUDE.md` names — a plan never adds a
field to `Course`, `Event` or `Material`, it points at one of them.

**One level of nesting, everywhere it matters.** `PlanStep.parent` points at another step of the
*same* plan; a step whose own `parent` is already set may not itself be a parent — the rule module
(`plans/rules.py`) refuses a second level with `409 nested` before it is ever written, so the
database never holds a chain the frontend could not draw as "steps with sub-steps".

`status` is one field on both `Plan` and `PlanStep` — never a pair of booleans (root `CLAUDE.md`,
"Shapes that repeat"). `PlanStep.done_by`/`done_at` are set when a step's status becomes `done` and
cleared if it moves away again (`views.py`), which is why they are separate from `status` rather
than folded into it: "done" is a fact about a moment, not only a word.

`PlanSuggestion` never edits the plan itself — accepting one *creates* a `PlanStep` and the
suggestion remembers which one (`created_step`), so the suggestion row stays a permanent record of
what was proposed and what happened to it (house rule 12: tombstone, don't hard-delete) even though
the step it produced can later be retitled or completed on its own.

`labels.ts` mirrors `PLAN_STATUS_CHOICES`, `STEP_STATUS_CHOICES` and `SUGGESTION_STATUS_CHOICES`
(house rule 13) — say so there too.
"""

from django.conf import settings
from django.contrib.contenttypes.fields import GenericForeignKey
from django.contrib.contenttypes.models import ContentType
from django.db import models

PLAN_STATUS_CHOICES = [
    ('draft', 'Draft — only its editors can see it'),
    ('active', 'Active — readable by anyone who can see the node'),
    ('completed', 'Completed — every step is done or skipped'),
    ('archived', 'Archived'),
]

STEP_STATUS_CHOICES = [
    ('pending', 'Pending'),
    ('in_progress', 'In progress'),
    ('done', 'Done'),
    ('skipped', 'Skipped'),
]

SUGGESTION_STATUS_CHOICES = [
    ('pending', 'Pending'),
    ('accepted', 'Accepted — became a step'),
    ('rejected', 'Rejected'),
    ('withdrawn', 'Withdrawn by its author'),
]


class Plan(models.Model):
    content_type = models.ForeignKey(ContentType, on_delete=models.CASCADE)
    object_id = models.PositiveIntegerField()
    node = GenericForeignKey('content_type', 'object_id')

    title = models.CharField(max_length=200)
    description = models.TextField(blank=True)
    status = models.CharField(max_length=10, choices=PLAN_STATUS_CHOICES, default='draft')

    created_by = models.ForeignKey(
        settings.AUTH_USER_MODEL, related_name='plans_created', null=True, blank=True,
        on_delete=models.SET_NULL,
    )
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ['-created_at', '-id']
        indexes = [models.Index(fields=['content_type', 'object_id'])]

    def __str__(self) -> str:
        return f'{self.title} ({self.status})'

    def save(self, *args, **kwargs):
        # Sanitized on write like every other rich-text field (config/sanitize.py) — the API is an
        # independent entry point, and an editor viewing this later is rendering untrusted HTML
        # (root CLAUDE.md house rule 8).
        from config.sanitize import sanitize_content

        self.description = sanitize_content(self.description)
        super().save(*args, **kwargs)


class PlanStep(models.Model):
    plan = models.ForeignKey(Plan, related_name='steps', on_delete=models.CASCADE)
    # `self`, nullable — ONE level (rules.py refuses a second before this is ever written).
    parent = models.ForeignKey(
        'self', related_name='substeps', null=True, blank=True, on_delete=models.CASCADE
    )

    title = models.CharField(max_length=200)
    description = models.TextField(blank=True)
    order = models.PositiveIntegerField(default=0)
    status = models.CharField(max_length=12, choices=STEP_STATUS_CHOICES, default='pending')
    due_at = models.DateTimeField(null=True, blank=True)

    done_by = models.ForeignKey(
        settings.AUTH_USER_MODEL, related_name='plan_steps_done', null=True, blank=True,
        on_delete=models.SET_NULL,
    )
    done_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        ordering = ['order', 'id']
        indexes = [models.Index(fields=['plan', 'parent'])]

    def __str__(self) -> str:
        return f'{self.title} ({self.status}) on plan {self.plan_id}'

    def save(self, *args, **kwargs):
        from config.sanitize import sanitize_content

        self.description = sanitize_content(self.description)
        super().save(*args, **kwargs)


class PlanSuggestion(models.Model):
    plan = models.ForeignKey(Plan, related_name='suggestions', on_delete=models.CASCADE)
    user = models.ForeignKey(
        settings.AUTH_USER_MODEL, related_name='plan_suggestions', on_delete=models.CASCADE
    )
    text = models.TextField()
    status = models.CharField(max_length=10, choices=SUGGESTION_STATUS_CHOICES, default='pending')

    decided_by = models.ForeignKey(
        settings.AUTH_USER_MODEL, related_name='plan_suggestions_decided', null=True, blank=True,
        on_delete=models.SET_NULL,
    )
    decided_at = models.DateTimeField(null=True, blank=True)
    # Set only on `accept` — the step the suggestion became. Never cleared, even if that step is
    # later deleted (SET_NULL): the suggestion is a record of what was proposed, not a live pointer.
    created_step = models.ForeignKey(
        PlanStep, related_name='+', null=True, blank=True, on_delete=models.SET_NULL
    )
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ['-created_at', '-id']

    def __str__(self) -> str:
        return f'suggestion by {self.user_id} on plan {self.plan_id} ({self.status})'

    def save(self, *args, **kwargs):
        from config.sanitize import sanitize_content

        self.text = sanitize_content(self.text)
        super().save(*args, **kwargs)
