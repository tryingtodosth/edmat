"""A minor's comment is held for a moderator before anybody else sees it (AUDIENCE-BRIEF.md
§2) — one hook on the model rather than a check in each of the many comment endpoints."""

from django.db.models.signals import post_save
from django.dispatch import receiver

from accounts.minors import hold_for_review, is_minor

from .models import Comment


@receiver(post_save, sender=Comment)
def hold_minor_comment(sender, instance, created, **kwargs):
    if created and is_minor(instance.author):
        hold_for_review(instance, instance.author)
