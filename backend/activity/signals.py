"""The community half of the feed's write path — and its forgetting half.

New CONTENT reaches the feed through explicit `record_activity()` calls at its publish moment
(there are few of those, and several are status transitions a signal cannot see — a queryset
`update()` fires nothing). Community actions are the opposite shape: a Comment is created from a
dozen endpoints and a Review/claim from several, so the pragmatic chokepoint is `post_save` —
with a STRICT allowlist of target types that are public by construction and can never later
become private (an exercise thread can be hidden, and the removal hooks below handle that; a
course thread can be private from birth, so course targets are simply never in the list at all).

The allowlist is the public-by-construction rule doing its work — read models.py's docstring
before widening it.
"""

from django.db.models.signals import post_delete, post_save
from django.dispatch import receiver

from community.models import Comment, Review
from community.targets import target_type_for
from exercises.models import ExerciseClaim, SolutionEntry
from materials.models import MaterialCoverage

from .models import Post
from .services import record_activity, remove_activity_for

# Comment targets whose threads are public-by-construction. Deliberately absent: every course
# target (private by policy), 'issue' (an issue can be staff-only), 'service'/'serviceReview'
# (a listing can be paused into invisibility), 'courseClaim' (its course can be a draft).
_PUBLIC_COMMENT_TARGETS = frozenset(
    {'exercise', 'material', 'materialCoverage', 'materialReview', 'exerciseClaim', 'solutionEntry', 'review', 'post'}
)


def _comment_feed_context(comment):
    """(link kwargs, label, extra scoping) for a public comment's feed row, or None when the
    target — or the content it hangs off — is not currently public."""
    from notifications.services import label_for_exercise, label_for_material

    target_type = target_type_for(comment)
    if target_type not in _PUBLIC_COMMENT_TARGETS:
        return None
    target = comment.target
    if target is None:
        return None

    def exercise_ctx(exercise):
        if exercise is None or not exercise.published:
            return None
        return {'exercise': exercise}, label_for_exercise(exercise), {}

    def material_ctx(material):
        if material is None or not material.published:
            return None
        return {'material': material}, label_for_material(material), {}

    if target_type == 'exercise':
        return exercise_ctx(target)
    if target_type == 'material':
        return material_ctx(target)
    if target_type in ('materialCoverage', 'materialReview'):
        return material_ctx(target.material)
    if target_type == 'exerciseClaim':
        return exercise_ctx(target.exercise)
    if target_type == 'review':
        return exercise_ctx(target.exercise)
    if target_type == 'solutionEntry':
        if not target.is_visible_to_readers():
            return None
        return exercise_ctx(target.exercise)
    if target_type == 'post':
        if not target.is_visible_to_readers():
            return None
        extra = {
            'branch': target.branch,
            'discipline': target.discipline
            or (target.branch.discipline if target.branch_id else None),
            'tags': [target.tag] if target.tag_id else (),
        }
        return {'post': target}, target.body[:150], extra
    return None


@receiver(post_save, sender=Comment)
def comment_feed_row(sender, instance, created, **kwargs):
    if created and not instance.is_removed:
        context = _comment_feed_context(instance)
        if context is not None:
            links, label, extra = context
            record_activity(
                'comment',
                actor=instance.author,
                target_label=instance.body[:150] or label,
                source=instance,
                **links,
                **extra,
            )
    elif not created and instance.is_removed:
        # The tombstone transition — the row it produced leaves the feed with it.
        remove_activity_for(instance)


@receiver(post_save, sender=Review)
def review_feed_row(sender, instance, created, **kwargs):
    from notifications.services import label_for_exercise

    if created and not instance.is_removed and instance.exercise.published:
        record_activity(
            'review',
            actor=instance.author,
            target_label=label_for_exercise(instance.exercise),
            exercise=instance.exercise,
            source=instance,
        )
    elif not created and instance.is_removed:
        remove_activity_for(instance)


@receiver(post_save, sender=ExerciseClaim)
def exercise_claim_feed_row(sender, instance, created, **kwargs):
    from notifications.services import label_for_exercise

    if created and instance.exercise.published:
        record_activity(
            'claim',
            actor=instance.proposed_by,
            target_label=label_for_exercise(instance.exercise),
            exercise=instance.exercise,
            source=instance,
        )


@receiver(post_save, sender=MaterialCoverage)
def material_claim_feed_row(sender, instance, created, **kwargs):
    from notifications.services import label_for_material

    if created and instance.material.published:
        record_activity(
            'claim',
            actor=instance.proposed_by,
            target_label=label_for_material(instance.material),
            material=instance.material,
            source=instance,
        )


# Hard deletes (an author deleting their own entry, a claim retracted, admin cleanups) — the
# generic `source` reference has no FK to cascade, so the rows are removed explicitly.
@receiver(post_delete, sender=Comment)
@receiver(post_delete, sender=Review)
@receiver(post_delete, sender=ExerciseClaim)
@receiver(post_delete, sender=MaterialCoverage)
@receiver(post_delete, sender=SolutionEntry)
@receiver(post_delete, sender=Post)
def source_deleted(sender, instance, **kwargs):
    remove_activity_for(instance)


# --- new platform objects: courses, one-off events, tutoring listings ----------------------------
#
# These three announce themselves on a STATUS TRANSITION into publicness (a course leaves draft, an
# event is published-and-public, a listing is created active), which their save() paths do go
# through — unlike the moderation flows above, whose claims are queryset updates. The pre_save
# hooks remember what the row used to say so only the genuine transition records, never every save.

from courses.models import Course as TaughtCourse  # noqa: E402
from events.models import Event as OneOffEvent  # noqa: E402
from services.models import Service  # noqa: E402


def _course_is_public(course) -> bool:
    return course.status != 'draft'


@receiver(post_save, sender=TaughtCourse)
def course_feed_row(sender, instance, created, **kwargs):
    was_public = getattr(instance, '_activity_was_public', False)
    if _course_is_public(instance) and not was_public and (created or hasattr(instance, '_activity_was_public')):
        record_activity(
            'course',
            actor=instance.instructor,
            target_label=instance.title,
            course=instance,
        )


def _remember_course(sender, instance, **kwargs):
    if instance.pk:
        previous = sender.objects.filter(pk=instance.pk).values_list('status', flat=True).first()
        instance._activity_was_public = previous is not None and previous != 'draft'
    else:
        instance._activity_was_public = False


def _event_is_public(event) -> bool:
    return event.status == 'published' and event.visibility == 'public'


@receiver(post_save, sender=OneOffEvent)
def event_feed_row(sender, instance, created, **kwargs):
    was_public = getattr(instance, '_activity_was_public', False)
    if _event_is_public(instance) and not was_public and (created or hasattr(instance, '_activity_was_public')):
        record_activity(
            'event',
            actor=instance.host,
            target_label=instance.title,
            happening=instance,
        )
    elif was_public and not _event_is_public(instance):
        # Cancelled, or pulled back to private — the announcement leaves the feed with it.
        remove_activity_for(instance)


def _remember_event(sender, instance, **kwargs):
    if instance.pk:
        row = sender.objects.filter(pk=instance.pk).values('status', 'visibility').first()
        instance._activity_was_public = bool(
            row and row['status'] == 'published' and row['visibility'] == 'public'
        )
    else:
        instance._activity_was_public = False


@receiver(post_save, sender=Service)
def service_feed_row(sender, instance, created, **kwargs):
    if created and instance.is_active:
        record_activity(
            'service',
            actor=instance.provider,
            target_label=instance.title,
            service=instance,
        )
    elif not created and not instance.is_active:
        # Paused — a paused listing 404s to the public, so its announcement goes too. Reactivating
        # deliberately does NOT re-announce (it is not new).
        remove_activity_for(instance)


from django.db.models.signals import pre_save  # noqa: E402

pre_save.connect(_remember_course, sender=TaughtCourse)
pre_save.connect(_remember_event, sender=OneOffEvent)
