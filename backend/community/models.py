"""Review (star rating) and Comment (threaded discussion) — see CLAUDE.md Section 9.

Comment targets an Exercise or Material generically via GenericForeignKey, matching the sketch
exactly (both are content types a discussion thread should be able to attach to).
"""

from django.conf import settings
from django.contrib.contenttypes.fields import GenericForeignKey
from django.contrib.contenttypes.models import ContentType
from django.db import models

from exercises.models import Exercise


class Review(models.Model):
    exercise = models.ForeignKey(Exercise, related_name='reviews', on_delete=models.CASCADE)
    author = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE)
    rating = models.PositiveSmallIntegerField()  # 1-5
    body = models.TextField(blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    # Both added alongside the reporting system (moderation/models.py's Report/ContentView) — a
    # Review had no moderation concept of any kind before this. `is_removed` is a moderator's own
    # permanent decision, same meaning as Comment's field of the same name below; `auto_hidden_at`
    # is set the instant community reports cross the threshold, BEFORE any moderator has looked at
    # it — see moderation/services.py's `check_auto_hide` for the actual rule. Kept as two separate
    # fields rather than one, on purpose: a moderator resolving a report needs to distinguish
    # "hidden automatically, pending my decision" from "I decided to remove this," and a review that
    # gets auto-hidden and then RESTORED needs `auto_hidden_at` cleared without ever having set
    # `is_removed` at all.
    is_removed = models.BooleanField(default=False)
    auto_hidden_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        unique_together = [('exercise', 'author')]  # one review per user per exercise
        ordering = ['-created_at']

    def __str__(self) -> str:
        return f'{self.rating}★ by {self.author} on {self.exercise}'


class Comment(models.Model):
    content_type = models.ForeignKey(ContentType, on_delete=models.CASCADE)
    object_id = models.PositiveIntegerField()
    target = GenericForeignKey('content_type', 'object_id')
    parent = models.ForeignKey(
        'self', null=True, blank=True, related_name='replies', on_delete=models.CASCADE
    )
    author = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE)
    body = models.TextField()
    created_at = models.DateTimeField(auto_now_add=True)
    is_removed = models.BooleanField(default=False)  # tombstone, not hard-delete
    # See Review.auto_hidden_at's own doc comment just above for the full reasoning — same field,
    # same meaning, added here for symmetry now that Comment is reportable too.
    auto_hidden_at = models.DateTimeField(null=True, blank=True)
    # Set when the AUTHOR deletes their own comment, which is a genuinely different event from a
    # moderator removing it even though both end up as `is_removed`. Without this the reader is
    # told "removed by a moderator" for a comment nobody moderated — a placeholder that lies about
    # what happened to somebody's own words. The two are kept as one `is_removed` plus this flag
    # rather than a second removal state so every existing reader of `is_removed` (the serializer's
    # own body blanking, the moderation queue, the auto-hide check) keeps working untouched.
    removed_by_author = models.BooleanField(default=False)
    # Null until the author edits. Recorded rather than silently overwriting the body because a
    # comment can already have replies written in answer to what it USED to say — an edit that
    # leaves no trace lets somebody rewrite the question after the answer exists.
    edited_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        ordering = ['created_at']

    def __str__(self) -> str:
        return f'comment by {self.author} on {self.target!r}'
