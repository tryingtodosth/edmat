"""Keeps `Profile.exercises_*_count` true — see accounts/counters.py for why the counters are
recounted rather than incremented.

Every state an exercise can move through that changes what its submitter's profile should say —
created, unpublished (a moderator's decision or an auto-hide), republished, deleted, or handed to a
different submitter — arrives here as a save or a delete. The one thing a `post_save` alone cannot
see is who the exercise USED to belong to, so `pre_save` remembers the previous submitter and both
accounts are recounted when they differ.
"""

from django.db.models.signals import post_delete, post_save, pre_save
from django.dispatch import receiver

from accounts.counters import recount_exercises

from .models import Exercise


@receiver(pre_save, sender=Exercise)
def remember_previous_submitter(sender, instance, **kwargs):
    instance._previous_submitter_id = None
    if instance.pk:
        instance._previous_submitter_id = (
            Exercise.objects.filter(pk=instance.pk)
            .values_list('submitted_by_id', flat=True)
            .first()
        )


@receiver(post_save, sender=Exercise)
def recount_after_save(sender, instance, **kwargs):
    recount_exercises(instance.submitted_by_id)
    previous = getattr(instance, '_previous_submitter_id', None)
    if previous is not None and previous != instance.submitted_by_id:
        recount_exercises(previous)


@receiver(post_delete, sender=Exercise)
def recount_after_delete(sender, instance, **kwargs):
    recount_exercises(instance.submitted_by_id)
