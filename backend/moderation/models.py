"""ExerciseSubmission (a brand-new exercise, pending review) and EditSuggestion (a proposed change to
an existing exercise/translation) — see CLAUDE.md Section 9."""

from django.conf import settings
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
