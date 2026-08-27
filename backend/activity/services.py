"""The activity feed's one write chokepoint, its one removal path, and its read query.

`record_activity()` is the ONLY place an `ActivityEvent` row is created — the same discipline
`notifications.services.notify()` established, for the same reason: the rules that make this table
safe (public-by-construction, retention trim, at-most-one link target) live in one function no
call site can forget. `remove_activity_for()` is the forgetting half: called wherever content
stops being public (auto-hide, a moderator's remove, a tombstoned comment), it deletes exactly the
rows that specific object produced, via the generic `source` reference.

Retention: the feed is ambient discovery, not the record (an explicit owner decision — the feed is
"truncated"), so the table trims itself past `FEED_RETENTION_DAYS` opportunistically on write —
no cron, which this project has nowhere to run.
"""

from __future__ import annotations

from datetime import timedelta

from django.contrib.contenttypes.models import ContentType
from django.utils import timezone

from .models import ActivityEvent

FEED_RETENTION_DAYS = 90
# Trim on roughly every Nth insert — cheap, unscheduled, and the exact moment the table grows.
_TRIM_EVERY = 25


def record_activity(
    kind: str,
    *,
    actor=None,
    target_label: str = '',
    exercise=None,
    material=None,
    course=None,
    happening=None,
    service=None,
    post=None,
    source=None,
    branch=None,
    discipline=None,
    tags=(),
    entry_kind: str = '',
):
    """Creates one feed row. Callers only ever call this for events that are PUBLIC at the moment
    of the call — that contract, not a filter at read time, is what keeps the feed safe (see
    models.py's own docstring for the decision against a filtered audit log).

    `source` is the object that produced the event (the comment, the entry, the review …) — what
    `remove_activity_for` later deletes by; defaults to whichever single link target was passed.
    `branch`/`discipline`/`tags` scope the row for filters and the Followed view; `branch` is
    derived from the link target when not given.
    """
    link_target = exercise or material or course or happening or service or post
    if source is None:
        source = link_target
    if branch is None:
        branch = getattr(exercise, 'branch', None) or getattr(material, 'branch', None)
    if discipline is None and branch is not None:
        discipline = branch.discipline

    event = ActivityEvent.objects.create(
        kind=kind,
        entry_kind=entry_kind,
        actor=actor,
        target_label=(target_label or '')[:300],
        exercise=exercise,
        material=material,
        course=course,
        happening=happening,
        service=service,
        post=post,
        source_content_type=(
            ContentType.objects.get_for_model(type(source)) if source is not None else None
        ),
        source_object_id=source.pk if source is not None else None,
        branch=branch,
        discipline=discipline,
    )
    if tags:
        event.tags.set(tags)

    if event.pk % _TRIM_EVERY == 0:
        ActivityEvent.objects.filter(
            created_at__lt=timezone.now() - timedelta(days=FEED_RETENTION_DAYS)
        ).delete()
    return event


def remove_activity_for(obj) -> int:
    """Deletes every feed row `obj` produced (by generic source) AND every row that links to it as
    its destination — called when `obj` stops being public. Covers both halves deliberately: a
    hidden exercise takes down not just its own "new exercise" row but every solution/comment row
    that would now link a reader to a page that 404s them."""
    from django.db.models import Q

    content_type = ContentType.objects.get_for_model(type(obj))
    q = Q(source_content_type=content_type, source_object_id=obj.pk)
    for field, model_name in (
        ('exercise', 'exercise'),
        ('material', 'material'),
        ('course', 'course'),
        ('happening', 'event'),
        ('service', 'service'),
        ('post', 'post'),
    ):
        if type(obj).__name__.lower() == model_name:
            q = q | Q(**{field: obj})
    deleted, _ = ActivityEvent.objects.filter(q).delete()
    return deleted


def feed_events(
    *,
    kind: str | None = None,
    include_posts: bool = True,
    discipline_slug: str | None = None,
    branch_slug: str | None = None,
    tag_slug: str | None = None,
    followed_for=None,
    before_id: int | None = None,
    limit: int = 20,
):
    """The read query. `followed_for` (a User) narrows to their followed tags plus courses they
    are actively in — the two real follow signals this app has today. `before_id` is the cursor
    (rows are immutable and id-ordered, so an id cursor never skips or repeats across pages the
    way an offset would as new rows land)."""
    qs = ActivityEvent.objects.select_related(
        'actor__profile', 'branch', 'discipline', 'post'
    ).prefetch_related('tags')
    if not include_posts:
        # The `posts` kill switch removes LINKS as well as pages (the house rule): with the flag
        # off, every row that would send a reader to a post page leaves the feed too.
        qs = qs.filter(post__isnull=True)
    if kind:
        qs = qs.filter(kind=kind)
    if discipline_slug:
        from django.db.models import Q

        qs = qs.filter(
            Q(discipline__slug=discipline_slug) | Q(branch__discipline__slug=discipline_slug)
        )
    if branch_slug:
        qs = qs.filter(branch__slug=branch_slug)
    if tag_slug:
        qs = qs.filter(tags__slug=tag_slug)
    if followed_for is not None and followed_for.is_authenticated:
        from django.db.models import Q

        from courses.models import ACTIVE_ENROLLMENT_STATUSES, Enrollment
        from exercises.models import TagFollow

        followed_tag_ids = list(
            TagFollow.objects.filter(user=followed_for).values_list('tag_id', flat=True)
        )
        my_course_ids = list(
            Enrollment.objects.filter(
                participant=followed_for, status__in=ACTIVE_ENROLLMENT_STATUSES
            ).values_list('course_id', flat=True)
        )
        qs = qs.filter(Q(tags__in=followed_tag_ids) | Q(course_id__in=my_course_ids)).distinct()
    if before_id:
        qs = qs.filter(id__lt=before_id)
    return list(qs[: max(1, min(limit, 50))])
