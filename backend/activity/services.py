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
    topic=None,
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
        branch = (
            getattr(exercise, 'branch', None)
            or getattr(material, 'branch', None)
            or getattr(topic, 'branch', None)
        )
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
        topic=topic,
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


def _content_locale_feed_filter(wanted: list[str]):
    """A `Q` object: true for a feed row whose underlying content has a version in one of
    `wanted` — the content-language rule (AUDIENCE-BRIEF.md §5, config/content_locale.py) applied
    to a table that spans several content kinds instead of one.

    Not a new rule, one rule applied per kind, because the feed itself does not carry a language —
    the thing it points at does, and different kinds carry it differently:

    - `post`/`course`/`happening` (event)/`service` each have their own plain `language` column
      (config/content_locale.py's own per-model list) — checked directly.
    - `translation` and `solution_entry` rows also set `exercise` (so the reader lands somewhere
      real), but the row's OWN language is its `source` — an `ExerciseTranslation` or
      `SolutionEntry` — not necessarily the exercise's original language a translation/entry was
      submitted against. Checked via the `source` each was created with (`record_activity`'s own
      `source=obj` at both call sites), never the exercise's.
    - Every other exercise/material-linked kind (`exercise`/`review`/`claim`/`comment`) falls back
      to "the linked exercise/material has a version in one of these languages" — the exact rule
      that content's own list endpoint already applies: `published_only=True` for an exercise
      (`ExerciseTranslation.status` is a real pending/published axis), no such check for a
      material (`MaterialTranslation` has no `status` column at all — there is no review step for
      a material's own translation the way there is for an exercise's).
    """
    from django.contrib.contenttypes.models import ContentType
    from django.db.models import Exists, OuterRef, Q

    from exercises.models import ExerciseTranslation, SolutionEntry

    translation_locale = ExerciseTranslation.objects.filter(
        pk=OuterRef('source_object_id'), locale__in=wanted
    )
    entry_locale = SolutionEntry.objects.filter(
        pk=OuterRef('source_object_id'), locale__in=wanted
    )
    own_language = (
        Q(post__language__in=wanted)
        | Q(course__language__in=wanted)
        | Q(happening__language__in=wanted)
        | Q(service__language__in=wanted)
        | Q(
            kind='translation',
            source_content_type=ContentType.objects.get_for_model(ExerciseTranslation),
        )
        & Exists(translation_locale)
        | Q(kind='solution_entry', source_content_type=ContentType.objects.get_for_model(SolutionEntry))
        & Exists(entry_locale)
    )
    # `MaterialTranslation` has no `status` at all (materials/models.py — there is no
    # pending/published review step for a material's own translation the way there is for an
    # exercise's), the same reason `materials/views.py`'s own list endpoint calls
    # `apply_content_locale_filter` WITHOUT `published_only=True` — matched here rather than
    # guessed, or the query 500s trying to filter a field that does not exist.
    linked_content_fallback = ~Q(kind__in=('translation', 'solution_entry')) & (
        Q(exercise__translations__locale__in=wanted, exercise__translations__status='published')
        | Q(material__translations__locale__in=wanted)
    )
    return own_language | linked_content_fallback


def apply_feed_content_locale_filter(qs, params):
    """Narrows a feed queryset to `?content_locales=`, returning `(qs, hidden_count)` — same
    contract as `config.content_locale.apply_content_locale_filter`, which this cannot reuse
    directly (it takes one `lookup`; a feed row's language depends on its `kind`, see
    `_content_locale_feed_filter`). Absent `content_locales` → no narrowing, matching every other
    list in this app."""
    from config.content_locale import parse_content_locales

    wanted = parse_content_locales(params.get('content_locales'))
    if wanted is None:
        return qs, 0
    before = qs.count()
    narrowed = qs.filter(_content_locale_feed_filter(wanted)).distinct()
    return narrowed, max(0, before - narrowed.count())


def feed_events(
    *,
    kind: str | None = None,
    include_posts: bool = True,
    discipline_slug: str | None = None,
    branch_slug: str | None = None,
    tag_slug: str | None = None,
    topic_id: int | None = None,
    followed_for=None,
    content_locales_params=None,
    before_id: int | None = None,
    limit: int = 20,
):
    """The read query. `followed_for` (a User) narrows to their followed tags plus courses they
    are actively in — the two real follow signals this app has today. `before_id` is the cursor
    (rows are immutable and id-ordered, so an id cursor never skips or repeats across pages the
    way an offset would as new rows land). `content_locales_params` is the request's own
    query-params mapping — passed through rather than a parsed list so the same
    `?content_locales=` convention every other list uses stays in one place
    (`config.content_locale.parse_content_locales`); returns `(events, hidden_count)`."""
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
    if topic_id:
        # The topic thread: posts anchored to the topic, plus every content event whose exercise
        # carries it — so the page a claim chip opens shows the topic's real activity, not only
        # its posts. distinct(): the M2M join can duplicate a row.
        from django.db.models import Q

        qs = qs.filter(Q(topic_id=topic_id) | Q(exercise__topics=topic_id)).distinct()
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
    # Content-language narrowing, same place in the pipeline every other list applies it: after
    # every other filter, before the cursor/limit — so `hidden_count` counts real rows the reader's
    # languages left out, not just what happened to fit on this one page.
    hidden_count = 0
    if content_locales_params is not None:
        qs, hidden_count = apply_feed_content_locale_filter(qs, content_locales_params)
    if before_id:
        qs = qs.filter(id__lt=before_id)
    return list(qs[: max(1, min(limit, 50))]), hidden_count
