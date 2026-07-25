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

    class Meta:
        ordering = ['created_at']

    def __str__(self) -> str:
        return f'comment by {self.author} on {self.target!r}'
