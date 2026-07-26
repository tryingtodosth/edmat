"""A recipient-scoped activity feed for the moderation/community events EdMat already has real
triggers for — see notifications/services.py's `notify()` for the one place every one of these rows
gets created, and moderation/views.py + exercises/views.py + materials/views.py for the call sites.

Deliberately denormalized (`target_label`, `exercise`), not a GenericForeignKey the way Comment/
Report resolve their own target — a Notification.exercise is nullable and SET_NULL on delete
specifically so an exercise being later removed doesn't cascade-delete someone's own notification
history, and `target_label` is captured once at creation time rather than re-resolved on every read
(the same "carry a label, avoid a lookup" reasoning this project's own sibling `2donet` blueprint
already documents for its own Notification.targetLabel). A submission that gets REJECTED never
becomes a real Exercise at all, so `exercise` genuinely has to be optional, not just defensively so.

No grouping/clustering of same-type notifications into one card (unlike `2donet`'s own
NotificationGroup) — EdMat's real event volume per user is small enough (a handful of moderation
decisions, occasional replies) that a plain reverse-chronological list is honest and sufficient;
building a clustering layer for volume this app doesn't actually have yet would be speculative, not
grounded.
"""

from django.conf import settings
from django.db import models

NOTIFICATION_TYPES = [
    ('submission_approved', 'Exercise submission approved'),
    ('submission_rejected', 'Exercise submission rejected'),
    ('edit_suggestion_approved', 'Edit suggestion approved'),
    ('edit_suggestion_rejected', 'Edit suggestion rejected'),
    ('translation_approved', 'Translation approved'),
    ('translation_rejected', 'Translation rejected'),
    ('comment_reply', 'Reply to your comment'),
    ('content_auto_hidden', 'Content auto-hidden by community reports'),
    ('content_restored', 'Content restored by a moderator'),
    ('content_removed', 'Content removed by a moderator'),
    # A followed tag (exercises.TagFollow) got attached to new/existing content — see
    # notifications/services.py's notify_tag_followers. The one type here whose recipient is a
    # FOLLOWER, not a participant in the event itself (everything above notifies someone about their
    # OWN content/decision; this notifies someone who merely subscribed to a tag).
    ('new_tagged_content', 'New content tagged with a tag you follow'),
]


class Notification(models.Model):
    recipient = models.ForeignKey(
        settings.AUTH_USER_MODEL, related_name='notifications', on_delete=models.CASCADE
    )
    # None for a system-triggered event (community auto-hide has no single acting user) — every
    # other type always has one (the moderator who decided, or the person who replied).
    actor = models.ForeignKey(
        settings.AUTH_USER_MODEL, null=True, blank=True, related_name='+', on_delete=models.SET_NULL
    )
    type = models.CharField(max_length=32, choices=NOTIFICATION_TYPES)
    target_label = models.CharField(max_length=300, blank=True)
    exercise = models.ForeignKey(
        'exercises.Exercise', null=True, blank=True, related_name='+', on_delete=models.SET_NULL
    )
    # Added alongside 'new_tagged_content' — a followed tag can be attached to a Material, which has
    # no Exercise to link through. Same nullable/SET_NULL shape as `exercise` above, same reasoning.
    material = models.ForeignKey(
        'materials.Material', null=True, blank=True, related_name='+', on_delete=models.SET_NULL
    )
    # A moderator's own review_note/resolved_note, or a comment reply's own short preview — whatever
    # extra context that event type actually has, blank when it doesn't.
    note = models.TextField(blank=True)
    is_read = models.BooleanField(default=False)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ['-created_at']

    def __str__(self) -> str:
        return f'{self.type} -> {self.recipient}'
