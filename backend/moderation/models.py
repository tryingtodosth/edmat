"""ExerciseSubmission (a brand-new exercise, pending review) and EditSuggestion (a proposed change to
an existing exercise/translation) — see CLAUDE.md Section 9. Report and ContentView (below) extend
this app into moderating already-PUBLISHED content (Exercise/Comment/Review), not just pre-publish
submissions — a genuinely different concern from the three models above, which is why they get their
own doc comment rather than being folded into this file's original one."""

from django.conf import settings
from django.contrib.contenttypes.fields import GenericForeignKey
from django.contrib.contenttypes.models import ContentType
from django.db import models

from exercises.models import Exercise
from taxonomy.models import Course

REVIEW_STATUS_CHOICES = [
    ('pending', 'Pending'),
    ('approved', 'Approved'),
    ('rejected', 'Rejected'),
]


class ExerciseSubmission(models.Model):
    course = models.ForeignKey(Course, on_delete=models.CASCADE)
    submitted_by = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE)
    payload = models.JSONField()  # draft of everything Exercise + ExerciseTranslation would need
    status = models.CharField(max_length=10, choices=REVIEW_STATUS_CHOICES, default='pending')
    reviewed_by = models.ForeignKey(
        settings.AUTH_USER_MODEL, null=True, blank=True, related_name='+', on_delete=models.SET_NULL
    )
    review_note = models.TextField(blank=True)
    resulting_exercise = models.ForeignKey(
        Exercise, null=True, blank=True, on_delete=models.SET_NULL
    )  # set once approved
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ['-created_at']

    def __str__(self) -> str:
        return f'submission by {self.submitted_by} [{self.status}]'


class EditSuggestion(models.Model):
    exercise = models.ForeignKey(Exercise, related_name='edit_suggestions', on_delete=models.CASCADE)
    locale = models.CharField(max_length=8)  # which translation this edits
    field = models.CharField(max_length=30)  # 'statement' | 'hint' | 'answer' | 'solution' | ...
    proposed_value = models.TextField()
    reason = models.TextField(blank=True)
    submitted_by = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE)
    status = models.CharField(max_length=10, choices=REVIEW_STATUS_CHOICES, default='pending')
    reviewed_by = models.ForeignKey(
        settings.AUTH_USER_MODEL, null=True, blank=True, related_name='+', on_delete=models.SET_NULL
    )
    # Phase 3 — a real, found-before-first-use gap: the frontend's own EditSuggestion type
    # (lib/types/submission.ts) has always carried an optional reviewNote, same as ExerciseSubmission
    # gets — this model's own original Section 9 sketch just never included it, so a moderator's
    # note on an edit-suggestion decision would have been silently discarded. Added to match.
    review_note = models.TextField(blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ['-created_at']

    def __str__(self) -> str:
        return f'edit suggestion by {self.submitted_by} on {self.exercise} [{self.status}]'


REPORT_STATUS_CHOICES = [
    ('pending', 'Pending'),
    ('resolved', 'Resolved'),
]


class Report(models.Model):
    """A user flagging an already-PUBLISHED piece of content (an Exercise, a Comment, or a Review —
    the three named in the task this was built for) as needing moderator attention. Generic FK,
    same pattern Comment itself already uses for its own polymorphic target — deliberately not
    restricted at the model layer to those three, since the exact same mechanism would work for any
    future reportable type without a schema change; the *view* layer (moderation/views.py's
    `ReportViewSet`) is what actually restricts `kind` to `exercise`/`comment`/`review` today.

    `unique_together` on (content_type, object_id, reported_by) is a real correctness rule, not
    just tidiness — without it, one user could inflate a target's own report count arbitrarily by
    reporting it repeatedly, which would make the whole percentage-of-viewers threshold below
    meaningless.
    """

    content_type = models.ForeignKey(ContentType, on_delete=models.CASCADE)
    object_id = models.PositiveIntegerField()
    target = GenericForeignKey('content_type', 'object_id')
    reported_by = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE)
    reason = models.TextField(blank=True)
    status = models.CharField(max_length=10, choices=REPORT_STATUS_CHOICES, default='pending')
    resolved_by = models.ForeignKey(
        settings.AUTH_USER_MODEL, null=True, blank=True, related_name='+', on_delete=models.SET_NULL
    )
    resolved_note = models.TextField(blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        unique_together = [('content_type', 'object_id', 'reported_by')]
        ordering = ['-created_at']

    def __str__(self) -> str:
        return f'report by {self.reported_by} on {self.target!r} [{self.status}]'


class ContentView(models.Model):
    """One row per (user, exercise) — recorded the FIRST time an authenticated user loads that
    exercise's own detail page (exercises/views.py's `ExerciseViewSet.retrieve`). This is the "how
    many people have actually seen this" denominator moderation/services.py's `check_auto_hide`
    divides a report count against.

    Exercise is the only content type in this app with a real per-user detail-page view to track —
    a Comment or a Review has no page of its own, it's read as part of viewing its own parent
    Exercise, so `check_auto_hide` resolves a reported Comment/Review's own "viewer pool" through
    this same table via whichever Exercise it's attached to, rather than this model needing a
    separate row per content type. Guests aren't tracked (there's no identity to key a unique row
    on), so the percentage this feeds is honestly "percentage of REGISTERED viewers," not literally
    everyone who ever loaded the page — the same kind of registered-users-only approximation this
    app already accepts elsewhere (e.g. `browsingHistoryStore`'s own client-side view history, which
    similarly only means anything for the one browser it's stored in).
    """

    user = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE)
    exercise = models.ForeignKey(Exercise, related_name='views', on_delete=models.CASCADE)
    viewed_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        unique_together = [('user', 'exercise')]

    def __str__(self) -> str:
        return f'{self.user} viewed {self.exercise}'
