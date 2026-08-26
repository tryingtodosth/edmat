"""Keeps `Profile.materials_*_count` true — the material twin of exercises/signals.py, which
explains the shape (recount, never increment; remember the previous submitter on save)."""

from django.db.models.signals import post_delete, post_save, pre_save
from django.dispatch import receiver

from accounts.counters import recount_materials

from .models import Material


@receiver(pre_save, sender=Material)
def remember_previous_submitter(sender, instance, **kwargs):
    instance._previous_submitter_id = None
    if instance.pk:
        instance._previous_submitter_id = (
            Material.objects.filter(pk=instance.pk).values_list('submitted_by_id', flat=True).first()
        )


@receiver(post_save, sender=Material)
def recount_after_save(sender, instance, **kwargs):
    recount_materials(instance.submitted_by_id)
    previous = getattr(instance, '_previous_submitter_id', None)
    if previous is not None and previous != instance.submitted_by_id:
        recount_materials(previous)


@receiver(post_delete, sender=Material)
def recount_after_delete(sender, instance, **kwargs):
    recount_materials(instance.submitted_by_id)
