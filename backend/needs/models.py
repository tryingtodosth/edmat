"""`Need` — a public "help wanted" hung off a course, an event or a material through the shared
node seam (`config/nodes.py`, MANAGEMENT-BRIEF.md §3.C), and `NeedApplication` — who answered.

**Never paid.** `FINANCES.md`: nothing on this platform takes or mentions money, and this app is
one of the places that rule was written with in mind — `estimated_hours` is an estimate for
somebody deciding whether they have the time, not a rate.

`status` is one field, never a pair of booleans (root `CLAUDE.md`, the lifecycle shape): `open` →
`in_progress` (a manager's own call, or left alone) → `fulfilled` (**derived**, never set by hand —
`needs/rules.py: recount` is the only writer) or `cancelled` (a manager's call, terminal in
practice though the model does not forbid reopening it by the same PATCH that got it there).

`NeedApplication.status` is `pending | accepted | declined | withdrawn`, **unique per
(need, user) across every status, not just the live ones** — a withdrawn or declined application
is the record of a decision (house rule 12: tombstone, don't hard-delete) and a second row for the
same pair would be a second, disagreeing record of the same relationship. Applying again after
withdrawing is therefore not offered; the honest read is that the applicant changed their mind once
and the conversation moves to a message to the node's staff, not a second form.
"""

from django.conf import settings
from django.contrib.contenttypes.fields import GenericForeignKey
from django.contrib.contenttypes.models import ContentType
from django.db import models

from config.sanitize import sanitize_content

# Mirrored in `frontend/src/lib/types/need.ts` and labelled in `frontend/src/lib/utils/labels.ts`
# (root CLAUDE.md house rule 13 — say so in both places).
NEED_KIND_CHOICES = [
    ('help', 'General help'),
    ('expertise', 'Expertise'),
    ('equipment', 'Equipment'),
    ('venue', 'Venue'),
    ('other', 'Other'),
]

NEED_STATUS_CHOICES = [
    ('open', 'Open'),
    ('in_progress', 'In progress'),
    ('fulfilled', 'Fulfilled'),
    ('cancelled', 'Cancelled'),
]

SKILL_LEVEL_CHOICES = [
    ('none', 'No particular skill needed'),
    ('beginner', 'Beginner'),
    ('intermediate', 'Intermediate'),
    ('advanced', 'Advanced'),
]

APPLICATION_STATUS_CHOICES = [
    ('pending', 'Pending'),
    ('accepted', 'Accepted'),
    ('declined', 'Declined'),
    ('withdrawn', 'Withdrawn'),
]

DESCRIPTION_MAX_LENGTH = 4000
MESSAGE_MAX_LENGTH = 2000


class Need(models.Model):
    """One "help wanted" posting. The node it hangs off is a `GenericForeignKey` resolved through
    `config/nodes.py`'s registry — never a direct FK to `Course`/`Event`/`Material`, because that
    would be a fourth app each of those three would need a migration for (MANAGEMENT-BRIEF.md §4
    rule 1: one app per step, and no migration outside it)."""

    content_type = models.ForeignKey(ContentType, on_delete=models.CASCADE)
    object_id = models.PositiveIntegerField()
    node = GenericForeignKey('content_type', 'object_id')

    title = models.CharField(max_length=200)
    description = models.TextField(blank=True)
    kind = models.CharField(max_length=10, choices=NEED_KIND_CHOICES, default='help')
    status = models.CharField(max_length=12, choices=NEED_STATUS_CHOICES, default='open')
    skill_level = models.CharField(max_length=12, choices=SKILL_LEVEL_CHOICES, default='none')
    estimated_hours = models.PositiveIntegerField(null=True, blank=True)
    deadline = models.DateTimeField(null=True, blank=True)
    is_remote = models.BooleanField(default=False)
    wanted_count = models.PositiveIntegerField(default=1)

    created_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        related_name='needs_created',
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
    )
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ['-created_at', '-id']
        indexes = [models.Index(fields=['content_type', 'object_id'])]

    def __str__(self) -> str:
        return self.title

    def save(self, *args, **kwargs):
        self.description = sanitize_content(self.description or '')[:DESCRIPTION_MAX_LENGTH]
        super().save(*args, **kwargs)

    def accepted_count(self) -> int:
        """A `COUNT` over an indexed FK, recomputed on every read (house rule 5) — never a tally
        kept on the row, which is exactly the field `needs/rules.py: recount` exists to replace."""
        return self.applications.filter(status='accepted').count()


class NeedApplication(models.Model):
    need = models.ForeignKey(Need, related_name='applications', on_delete=models.CASCADE)
    user = models.ForeignKey(
        settings.AUTH_USER_MODEL, related_name='need_applications', on_delete=models.CASCADE
    )
    message = models.TextField(blank=True)
    status = models.CharField(max_length=10, choices=APPLICATION_STATUS_CHOICES, default='pending')
    decided_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        related_name='need_applications_decided',
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
    )
    decided_at = models.DateTimeField(null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ['-created_at', '-id']
        constraints = [
            models.UniqueConstraint(fields=['need', 'user'], name='unique_need_application_per_user'),
        ]
        indexes = [models.Index(fields=['need', 'status'])]

    def __str__(self) -> str:
        return f'user {self.user_id} -> need {self.need_id} ({self.status})'

    def save(self, *args, **kwargs):
        self.message = sanitize_content(self.message or '')[:MESSAGE_MAX_LENGTH]
        super().save(*args, **kwargs)
