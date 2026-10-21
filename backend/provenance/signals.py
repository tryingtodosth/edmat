"""An author's AI-assisted mark on a SOLUTION changes whether its exercise counts as verified
(`exercises/signals.py: recount_verified`), so the mark's own writes recount — the same
recount-not-increment shape as every other derived flag here."""

from django.contrib.contenttypes.models import ContentType
from django.db.models.signals import post_delete, post_save
from django.dispatch import receiver

from .models import AuthorMark


def _recount_if_solution(mark: AuthorMark) -> None:
    from exercises.models import SolutionEntry
    from exercises.signals import recount_verified

    if mark.content_type_id != ContentType.objects.get_for_model(SolutionEntry).pk:
        return
    exercise_id = (
        SolutionEntry.objects.filter(pk=mark.object_id).values_list('exercise_id', flat=True).first()
    )
    recount_verified(exercise_id)


@receiver(post_save, sender=AuthorMark)
def recount_after_mark_save(sender, instance, **kwargs):
    _recount_if_solution(instance)


@receiver(post_delete, sender=AuthorMark)
def recount_after_mark_delete(sender, instance, **kwargs):
    _recount_if_solution(instance)
