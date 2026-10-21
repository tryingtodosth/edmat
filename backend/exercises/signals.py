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

from .models import Exercise, ExercisePart, SolutionEntry


def passed_solutions(exercise_id):
    """Every SOLUTION on the exercise that counts as having passed review — the one definition the
    verified flag reads, for the whole exercise and (`exercises/parts.py: verified_by_parts`) for
    each part alike: published, visible, and pinned (the corpus originals, or a staff/governor pin),
    reviewed by someone, or written by a verified contributor.

    A solution its author declared AI-assisted (`provenance.AuthorMark`, 2026-10-21, owner:
    "mark it as ai assisted … and remove the verified solution") counts only once a REVIEWER
    accepted it: neither a pin nor the author's contributor tier stands in for a human having
    checked machine-written work. The mark's own signals (`provenance/signals.py`) recount."""
    from django.contrib.contenttypes.models import ContentType
    from django.db.models import Q

    from provenance.models import AuthorMark

    assisted = AuthorMark.objects.filter(
        content_type=ContentType.objects.get_for_model(SolutionEntry), assisted=True
    ).values('object_id')
    return (
        SolutionEntry.objects.filter(
            exercise_id=exercise_id,
            kind='solution',
            status='published',
            is_removed=False,
            auto_hidden_at__isnull=True,
        )
        .filter(
            Q(pinned=True)
            | Q(reviewed_by__isnull=False)
            | Q(author__profile__is_verified_contributor=True)
        )
        .exclude(Q(pk__in=assisted) & Q(reviewed_by__isnull=True))
    )


def recount_verified(exercise_id) -> None:
    """Keeps the DERIVED `Exercise.verified` true — recomputed, never toggled by hand (an owner
    decision, 2026-08-27, replacing the manual moderator flag): verified means "a passed solution
    (`passed_solutions`) for the WHOLE exercise" — or, for a set-shaped exercise with parts
    (`SUBEXERCISES-BRIEF.md`, 2026-10-21), "a passed solution of its own for EVERY part"
    (`exercises/parts.py: verified_by_parts`). A set with (a)–(c) solved and (d) not is honestly
    unverified. Recount-not-increment, the same reasoning accounts/counters.py already writes down.

    The verified-contributor clause is evaluated as of NOW — revoking somebody's contributor tier
    does not sweep every exercise they ever touched, only ones whose entries change again. A full
    sweep on tier changes would be the complete fix; flagged here rather than silently absent.

    Called from the SolutionEntry and ExercisePart signals below, and EXPLICITLY from any write
    that bypasses save()/delete() — the review action's own WHERE-anchored claim `update()` fires
    no signal.
    """
    if exercise_id is None:
        return
    from .parts import verified_by_parts

    passed = passed_solutions(exercise_id)
    verified = passed.filter(part__isnull=True).exists() or verified_by_parts(exercise_id, passed)
    # update(), not save(): no signal recursion, and no other column is touched.
    Exercise.objects.filter(pk=exercise_id).exclude(verified=verified).update(verified=verified)


@receiver(post_save, sender=SolutionEntry)
def recount_verified_after_entry_save(sender, instance, **kwargs):
    recount_verified(instance.exercise_id)


@receiver(post_delete, sender=SolutionEntry)
def recount_verified_after_entry_delete(sender, instance, **kwargs):
    recount_verified(instance.exercise_id)


@receiver(post_save, sender=ExercisePart)
def recount_verified_after_part_save(sender, instance, created, **kwargs):
    # A part added to a verified set makes it unverified until that part is solved. A renamed or
    # reordered part changes nothing — and `apply_parts` moves them with `update()`, no signal.
    if created:
        recount_verified(instance.exercise_id)


@receiver(post_delete, sender=ExercisePart)
def recount_verified_after_part_delete(sender, instance, **kwargs):
    # The unsolved part going may leave every remaining one solved (or none, back to the whole).
    # Its entries were deleted first by the CASCADE, each recounting while the part still stood;
    # this is the recount that sees the set without it.
    recount_verified(instance.exercise_id)


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
