"""The community-driven auto-hide rule: "reported comment, content, review etc gets a priority in
the moderation queue. If +20% of users who viewed that content report it, it gets hidden right away
even before a moderator's decision."

Also home to the "node governor" access-control helpers (`is_governor_of_course`/
`governed_branch_ids`) — a moderator scoped to one taxonomy node (a Discipline or a Branch) rather than
Django's own global `is_staff`. Neither is HTTP-shaped, matching this module's own existing
"business logic lives here, views.py stays thin" convention already established for
`check_auto_hide`/`resolve_view_scope_exercise` below.
"""

from __future__ import annotations

from django.contrib.contenttypes.models import ContentType
from django.db.models import Q
from django.utils import timezone

from community.models import Comment, Review
from exercises.models import Exercise, ExerciseTranslation, Tag
from materials.models import Material, MaterialRequirement
from services.models import Service, ServiceReview
from taxonomy.models import Branch, Discipline

# The one place `kind` <-> model is defined — moderation/serializers.py's ReportCreateSerializer
# (validating an incoming report) and build_report_queue below (rendering the moderator-facing
# queue) both import this rather than each keeping their own copy. `service` is a real, public-
# facing user-generated listing exactly like the other three (a title/description anyone can read),
# so it gets the same generic reporting mechanism rather than a bespoke one. `tag`/`material`/
# `requirement` (a MaterialRequirement — a "skill tag") joined for the identical reason: all three
# are live, user-generated content with no moderation gate at write time (QA.md's own flagged risk
# for tags specifically: a slur or defamatory label is live the instant it's applied).
# `service_review` — a written review of a TUTOR (a Service listing), the exact same "one written
# opinion, one rating" shape `review` (community.Review, an Exercise review) already covers, just a
# separate model (ServiceReview) rather than a generic retrofit of Review itself — a deliberately
# DIFFERENT kind string from `review`, not reused, since REPORT_KIND_MODELS maps one kind to exactly
# one model and the two are genuinely different tables.
REPORT_KIND_MODELS = {
    'exercise': Exercise,
    'comment': Comment,
    'review': Review,
    'service': Service,
    'tag': Tag,
    'material': Material,
    'requirement': MaterialRequirement,
    'service_review': ServiceReview,
}
_REVERSE_KIND_MODELS = {model: kind for kind, model in REPORT_KIND_MODELS.items()}

# A safety rail beyond the literal "+20%" instruction, added deliberately and flagged plainly here
# rather than silently baked in: with a low view count, a single report can already clear 20% on
# its own (e.g. 1 report / 4 viewers = 25%) — which would let ONE bad-faith report hide something.
# Requiring real corroboration first (a handful of independent reporters) closes that gap without
# changing the rule's own spirit; trivially tunable if the real number should be different.
MIN_REPORTS_FOR_AUTO_HIDE = 3
AUTO_HIDE_THRESHOLD = 0.20


def is_governor_of_course(user, branch) -> bool:
    """Does `user` have moderation authority over `course` — Django's global `is_staff` (unchanged,
    checked first, always wins regardless of `course`), OR a real `NodeGovernor` grant covering it
    (a direct Branch-level grant, OR a Discipline-level one cascading down since `course` sits under that
    Discipline)? `course=None` is a safe-default DENY for a non-staff user — a caller that couldn't
    determine which course a report's target even belongs to shouldn't guess yes."""
    if user is None or not user.is_authenticated:
        return False
    if user.is_staff:
        return True
    if branch is None:
        return False
    from .models import NodeGovernor

    branch_ct = ContentType.objects.get_for_model(Branch)
    discipline_ct = ContentType.objects.get_for_model(Discipline)
    return NodeGovernor.objects.filter(user=user).filter(
        Q(content_type=branch_ct, object_id=branch.pk) | Q(content_type=discipline_ct, object_id=branch.discipline_id)
    ).exists()


def governed_branch_ids(user) -> set[int] | None:
    """Every Branch id `user` can act as a governor on, resolving Discipline-level grants down to every
    Branch under them. Returns `None` for a global (`is_staff`) moderator or an unauthenticated
    caller — the signal every caller below reads as "skip scoping entirely, see everything," not an
    empty/no-access result (an authenticated non-staff governor who genuinely governs nothing would
    get back a real empty `set()` instead, which correctly filters everything out)."""
    if user is None or not user.is_authenticated or user.is_staff:
        return None
    from .models import NodeGovernor

    branch_ct = ContentType.objects.get_for_model(Branch)
    discipline_ct = ContentType.objects.get_for_model(Discipline)
    grants = NodeGovernor.objects.filter(user=user).values_list('content_type_id', 'object_id')
    branch_ids: set[int] = set()
    discipline_ids: set[int] = set()
    for ct_id, obj_id in grants:
        if ct_id == branch_ct.id:
            branch_ids.add(obj_id)
        elif ct_id == discipline_ct.id:
            discipline_ids.add(obj_id)
    if discipline_ids:
        branch_ids |= set(Branch.objects.filter(discipline_id__in=discipline_ids).values_list('id', flat=True))
    return branch_ids


def _content_owner(target):
    """Whose Notification inbox a decision about `target` belongs in (notifications/services.py's
    `notify()` is the only caller). `Exercise.submitted_by` is nullable — every one of the 742
    migrated corpus exercises has no real submitter — and `notify()`'s own `recipient=None` guard is
    what turns that into a correct, silent no-op rather than something this function needs to
    special-case itself."""
    if isinstance(target, Exercise):
        return target.submitted_by
    if isinstance(target, Service):
        return target.provider
    if isinstance(target, Material):
        return target.submitted_by
    return getattr(target, 'author', None)


def resolve_view_scope_exercise(target):
    """Which Exercise's own ContentView count a report against `target` should be measured against.
    Exercise is the only content type with a real per-user view record in this app (ContentView) —
    a Comment or Review has no page of its own, so it borrows its parent Exercise's own audience
    (the people who could plausibly have seen it while reading that exercise). Anything else
    reachable through Report's own generic targeting (e.g. a Material or MaterialCoverage, since
    Comment already established that any GenericForeignKey target is fair game) has no view data to
    divide by at all — returning None here is what makes `check_auto_hide` correctly no-op for
    those instead of raising or dividing by zero.
    """
    if isinstance(target, Exercise):
        return target
    if isinstance(target, Review):
        return target.exercise
    if isinstance(target, Comment):
        parent = target.target
        if parent is None or parent is target:
            return None
        return resolve_view_scope_exercise(parent)
    return None


def check_auto_hide(target) -> bool:
    """Called immediately after a new Report on `target` is saved. Returns True if this call is
    what triggered the hide (so the caller can report it back), False otherwise — including when
    `target` was already hidden, since re-triggering an already-hidden item isn't a new event.
    """
    if getattr(target, 'auto_hidden_at', None) is not None:
        return False
    if getattr(target, 'is_removed', False):
        return False

    from .models import Report  # local import — avoids a models.py <-> services.py import cycle

    content_type = ContentType.objects.get_for_model(type(target))
    report_count = Report.objects.filter(
        content_type=content_type, object_id=target.pk, status='pending'
    ).count()
    if report_count < MIN_REPORTS_FOR_AUTO_HIDE:
        return False

    exercise = resolve_view_scope_exercise(target)
    if exercise is None:
        return False
    view_count = exercise.views.count()
    if view_count == 0:
        return False
    if (report_count / view_count) < AUTO_HIDE_THRESHOLD:
        return False

    target.auto_hidden_at = timezone.now()
    update_fields = ['auto_hidden_at']
    if isinstance(target, Exercise):
        target.published = False
        update_fields.append('published')
    target.save(update_fields=update_fields)

    kind = _REVERSE_KIND_MODELS.get(type(target))
    if kind is not None:
        from notifications.services import notify

        preview, _exercise_id, _exercise_title = _describe(target, kind)
        # `exercise` already resolved above via resolve_view_scope_exercise — that function returns
        # `target` itself when target IS the Exercise, so this is correct for all three kinds
        # without needing to re-derive it.
        notify(_content_owner(target), 'content_auto_hidden', target_label=preview, exercise=exercise)
    return True


def _material_title(material) -> str:
    """The same "resolve, fall back to original" title lookup `MaterialSerializer.get_title`
    already does (materials/serializers.py) — reused here (not re-imported from there, to avoid a
    real circular import: materials/serializers.py has no reason to import moderation, but keeping
    the lookup itself in one place, not two independently-drifting copies, is still worth it) for
    the moderator-facing report preview."""
    from config.i18n_utils import resolve_translation, DEFAULT_FALLBACK_LOCALE

    t = resolve_translation(material.translations, DEFAULT_FALLBACK_LOCALE)
    return t.title if t else material.slug


def _describe(target, kind: str) -> tuple[str, int | None, str | None]:
    """(preview text, the exercise id it belongs to, that exercise's own title) — the moderator-
    facing summary for one reported target. Deliberately reads the REAL body/title regardless of
    is_removed/auto_hidden_at: those flags control what an ORDINARY reader sees (community/
    serializers.py blanks the content for them), a moderator reviewing the report needs to see the
    actual text to judge it, not the already-blanked public-facing version."""
    from config.i18n_utils import DEFAULT_FALLBACK_LOCALE
    from exercises.serializers import _resolve_exercise_translation

    if kind == 'exercise':
        t = _resolve_exercise_translation(target, DEFAULT_FALLBACK_LOCALE)
        title = t.title if t else f'#{target.number}'
        return title, target.pk, title

    if kind == 'service':
        # A tutoring listing isn't scoped to one Exercise the way a Comment/Review borrows its
        # parent's — `resolve_view_scope_exercise` already returns None for it (its own default
        # branch), so `check_auto_hide` correctly never auto-hides a reported listing (no view-count
        # denominator to measure against); it still queues normally for a moderator's own decision.
        return target.title[:150], None, None

    if kind == 'tag':
        # Same "no viewer-pool concept" shape as Service — a Tag is global, shared across every
        # Exercise/Material it's applied to, not scoped to any one of them.
        return f'#{target.slug}', None, None

    if kind == 'material':
        return _material_title(target), None, None

    if kind == 'requirement':
        return target.label[:150], None, None

    if kind == 'service_review':
        # Same "no viewer-pool concept" shape as `service` itself — a tutoring listing's own review
        # isn't scoped to an Exercise page either.
        preview = target.body[:150] if target.body else f'{target.rating}★ (no written review)'
        return preview, None, None

    exercise = resolve_view_scope_exercise(target)
    exercise_title = None
    if exercise is not None:
        t = _resolve_exercise_translation(exercise, DEFAULT_FALLBACK_LOCALE)
        exercise_title = t.title if t else f'#{exercise.number}'
    exercise_id = exercise.pk if exercise is not None else None

    if kind == 'comment':
        preview = target.body[:150]
        return preview, exercise_id, exercise_title
    if kind == 'review':
        preview = target.body[:150] if target.body else f'{target.rating}★ (no written review)'
        return preview, exercise_id, exercise_title
    return '', exercise_id, exercise_title


def build_report_queue(branch_ids: set[int] | None = None) -> list[dict]:
    """Every target with at least one PENDING report, grouped and sorted by priority — this is the
    literal "gets a priority in the moderation queue" requirement: already auto-hidden items float
    to the very top (most urgent, since they're live-hidden right now and waiting on a decision),
    everything else follows by raw pending-report count descending.

    `branch_ids`, added for the "node governor" feature — `None` (the default, and what a global
    `is_staff` moderator's call always passes, see `build_moderation_queue_payload`) means
    unfiltered, exactly today's existing behavior. A real `set` scopes the results to only groups
    whose own resolved Exercise belongs to one of those courses — a group whose course can't be
    resolved at all (e.g. a Comment targeting something with no viewer-pool concept) is excluded
    for a SCOPED caller, a safe default (hide rather than show something we can't verify is theirs),
    but still included for the unscoped (`None`) global-moderator case, unchanged.

    ✅ Phase 4 — rewritten from a real, measured N+1 (820 SQL queries / ~1.45s for 198 report
    groups under `seed_moderation_load_test`'s own synthetic backlog — see
    `measure_moderation_queue`, and the earlier version of this docstring's own "fine at this app's
    real scale" claim, which that measurement refuted, not confirmed) into a small, fixed number of
    bulk queries: one to resolve every target row per involved kind (at most 3 queries, not one per
    group), one bulk `ContentView` count aggregate, one bulk `ExerciseTranslation` fetch, and one
    bulk "reasons" fetch grouped in Python.

    ✅ A second pass closed the one remaining gap the first rewrite deliberately left open: a
    Comment's own generic `target` (which Exercise's viewer-pool it borrows) used to cost one real
    query PER COMMENT-kind group, via the single-object `resolve_view_scope_exercise` — Django's
    GenericForeignKey has no bulk-prefetch of its own, but a Comment's raw `content_type_id`/
    `object_id` columns are already present on the fetched row (no query to read them), so the same
    "group by content type, bulk-fetch by kind" pattern already used for the top-level report
    targets applies one hop further down: every reported Comment's own direct target is now
    resolved via one more small batch of bulk queries (grouped by kind, same as the top-level
    fetch), not one query per comment. The one case left genuinely per-object, not bulk-fetched: a
    Comment whose own target is ANOTHER Comment (a real recursive chain) — not present in this
    app's real data today (every real Comment targets an Exercise or a MaterialCoverage directly,
    confirmed by inspection), but still resolved correctly via the original
    `resolve_view_scope_exercise`, not silently dropped, for the rare case it ever does occur.
    Re-run `measure_moderation_queue` after any further change to this function — that's what it's
    for, not a one-time check.
    """
    from django.db.models import Count, Max

    from .models import ContentView, Report

    groups = list(
        Report.objects.filter(status='pending')
        .values('content_type', 'object_id')
        .annotate(report_count=Count('id'), last_reported_at=Max('created_at'))
    )
    if not groups:
        return []

    # --- Bulk-resolve every target row: one query per involved kind (Exercise/Comment/Review),
    # never one per group. Review's own `exercise` is select_related here specifically so resolving
    # its viewer-pool below costs zero extra queries too.
    ids_by_content_type: dict[int, list[int]] = {}
    for g in groups:
        ids_by_content_type.setdefault(g['content_type'], []).append(g['object_id'])

    targets_by_key: dict[tuple[int, int], object] = {}
    for ct_id, obj_ids in ids_by_content_type.items():
        content_type = ContentType.objects.get_for_id(ct_id)
        model = content_type.model_class()
        if _REVERSE_KIND_MODELS.get(model) is None:
            continue  # a report on something outside the moderator-facing kinds (see the model's own note)
        qs = model.objects.filter(pk__in=obj_ids)
        if model is Review:
            qs = qs.select_related('exercise')
        for obj in qs:
            targets_by_key[(ct_id, obj.pk)] = obj

    # --- Which Exercise's own viewer pool each target is measured against. Exercise/Review resolve
    # for free from what's already fetched above; a Comment's own generic `target` is resolved in a
    # dedicated bulk pass right below, deferred rather than resolved inline here.
    exercise_ct_id = ContentType.objects.get_for_model(Exercise).id
    scope_exercise_by_key: dict[tuple[int, int], Exercise | None] = {}
    needed_exercise_ids: set[int] = set()
    comment_keys: list[tuple[int, int]] = []
    for key, obj in targets_by_key.items():
        ct_id, obj_id = key
        if ct_id == exercise_ct_id:
            scope_exercise_by_key[key] = obj
            needed_exercise_ids.add(obj_id)
        elif isinstance(obj, Review):
            scope_exercise_by_key[key] = obj.exercise
            if obj.exercise_id:
                needed_exercise_ids.add(obj.exercise_id)
        elif isinstance(obj, (Service, Tag, Material, MaterialRequirement, ServiceReview)):
            # None of these five have a viewer-pool concept at all (not page-scoped to one Exercise
            # the way a Comment/Review borrows its parent's) — resolved directly to None, matching
            # resolve_view_scope_exercise's own behavior for each, rather than falling into the
            # "every remaining target is a Comment" branch below, which assumes a
            # `content_type_id`/`object_id` pair none of these five genuinely have.
            scope_exercise_by_key[key] = None
        else:
            comment_keys.append(key)  # every remaining target is a reported Comment

    # --- Bulk-resolve every reported Comment's own DIRECT target, one hop down, the exact same
    # "group by content type, bulk-fetch by kind" pattern already used for the top-level report
    # targets above — a Comment's own `content_type_id`/`object_id` are plain columns already on
    # the fetched row, so grouping by them costs nothing extra.
    if comment_keys:
        comment_target_ids_by_ct: dict[int, list[int]] = {}
        for key in comment_keys:
            comment = targets_by_key[key]
            comment_target_ids_by_ct.setdefault(comment.content_type_id, []).append(comment.object_id)

        comment_targets_by_key: dict[tuple[int, int], object] = {}
        for ct_id, obj_ids in comment_target_ids_by_ct.items():
            content_type = ContentType.objects.get_for_id(ct_id)
            model = content_type.model_class()
            qs = model.objects.filter(pk__in=obj_ids)
            if model is Review:
                qs = qs.select_related('exercise')
            for obj in qs:
                comment_targets_by_key[(ct_id, obj.pk)] = obj

        for key in comment_keys:
            comment = targets_by_key[key]
            direct_target = comment_targets_by_key.get((comment.content_type_id, comment.object_id))
            if isinstance(direct_target, Exercise):
                scope_exercise_by_key[key] = direct_target
                needed_exercise_ids.add(direct_target.pk)
            elif isinstance(direct_target, Review):
                scope_exercise_by_key[key] = direct_target.exercise
                if direct_target.exercise_id:
                    needed_exercise_ids.add(direct_target.exercise_id)
            elif isinstance(direct_target, Comment):
                # A real recursive chain — genuinely rare (not present in today's real data), so
                # this one case still costs a real query rather than a third bulk-fetch layer for
                # a case that may never occur; resolved correctly via the original single-object
                # function, not silently dropped.
                exercise = resolve_view_scope_exercise(direct_target)
                scope_exercise_by_key[key] = exercise
                if exercise is not None:
                    needed_exercise_ids.add(exercise.pk)
            else:
                # The Comment's own target is something with no viewer-pool concept at all (e.g. a
                # Material/MaterialCoverage) or no longer resolves (deleted since being reported) —
                # correctly None, matching resolve_view_scope_exercise's own final `return None`.
                scope_exercise_by_key[key] = None

    # --- One bulk aggregate instead of an `exercise.views.count()` per group.
    view_counts = dict(
        ContentView.objects.filter(exercise_id__in=needed_exercise_ids)
        .values('exercise_id')
        .annotate(n=Count('id'))
        .values_list('exercise_id', 'n')
    )

    # --- One bulk fetch instead of `_resolve_exercise_translation`'s own query per group. Same
    # 3-step fallback order that function already uses (try DEFAULT_FALLBACK_LOCALE, then the
    # exercise's own original_locale, then whatever's available), just read from a prefetched dict.
    from config.i18n_utils import DEFAULT_FALLBACK_LOCALE

    translations_by_exercise: dict[int, dict[str, ExerciseTranslation]] = {}
    for t in ExerciseTranslation.objects.filter(exercise_id__in=needed_exercise_ids, status='published'):
        translations_by_exercise.setdefault(t.exercise_id, {})[t.locale] = t

    def _title_for(exercise: Exercise) -> str:
        by_locale = translations_by_exercise.get(exercise.pk, {})
        t = (
            by_locale.get(DEFAULT_FALLBACK_LOCALE)
            or by_locale.get(exercise.original_locale)
            or next(iter(by_locale.values()), None)
        )
        return t.title if t else f'#{exercise.number}'

    # --- One bulk fetch instead of a `[:5]`-sliced query per group; grouped and capped in Python.
    # Report's own default ordering is `-created_at`, so iterating this query in the same order and
    # capping each bucket at 5 as we go reproduces the original per-group `[:5]` slice exactly.
    reasons_by_key: dict[tuple[int, int], list[str]] = {}
    for row in (
        Report.objects.filter(status='pending')
        .exclude(reason='')
        .order_by('-created_at')
        .values('content_type_id', 'object_id', 'reason')
    ):
        bucket = reasons_by_key.setdefault((row['content_type_id'], row['object_id']), [])
        if len(bucket) < 5:
            bucket.append(row['reason'])

    results = []
    for g in groups:
        key = (g['content_type'], g['object_id'])
        target = targets_by_key.get(key)
        if target is None:
            continue  # the reported row itself was deleted since being reported
        kind = _REVERSE_KIND_MODELS.get(type(target))
        if kind is None:
            continue

        exercise = scope_exercise_by_key.get(key)
        # Node-governor scoping — see this function's own doc comment for why an unresolvable
        # exercise (course=None) is excluded for a SCOPED caller but not for the unfiltered one.
        if branch_ids is not None and (exercise is None or exercise.branch_id not in branch_ids):
            continue
        # `.get(pk, 0)`, not `.get(pk)` — an exercise genuinely resolved but with zero ContentView
        # rows must read as 0 (a real, meaningful "nobody's viewed this yet"), not None (which means
        # "there's no exercise to measure a viewer pool against at all" — a different, rarer case,
        # e.g. a Comment attached to a Material). Conflating the two was a real bug this correctness
        # diff against the pre-optimization implementation caught before it ever shipped.
        view_count = view_counts.get(exercise.pk, 0) if exercise is not None else None
        percent = round(100 * g['report_count'] / view_count) if view_count else None

        if kind == 'exercise':
            title = _title_for(target)
            preview, exercise_id, exercise_title = title, target.pk, title
        elif kind == 'service':
            # No exercise scope to report here at all — `exercise` is already None for this kind
            # (set directly above, never routed through the comment-resolution pass).
            preview, exercise_id, exercise_title = target.title[:150], None, None
        elif kind == 'tag':
            preview, exercise_id, exercise_title = f'#{target.slug}', None, None
        elif kind == 'material':
            preview, exercise_id, exercise_title = _material_title(target), None, None
        elif kind == 'requirement':
            preview, exercise_id, exercise_title = target.label[:150], None, None
        elif kind == 'service_review':
            preview = target.body[:150] if target.body else f'{target.rating}★ (no written review)'
            exercise_id, exercise_title = None, None
        else:
            exercise_id = exercise.pk if exercise is not None else None
            exercise_title = _title_for(exercise) if exercise is not None else None
            if kind == 'comment':
                preview = target.body[:150]
            else:  # review
                preview = target.body[:150] if target.body else f'{target.rating}★ (no written review)'

        results.append(
            {
                'kind': kind,
                'object_id': g['object_id'],
                'report_count': g['report_count'],
                'view_count': view_count,
                'percent_reported': percent,
                'is_auto_hidden': getattr(target, 'auto_hidden_at', None) is not None,
                'reasons': reasons_by_key.get(key, []),
                'preview': preview,
                'exercise_id': exercise_id,
                'exercise_title': exercise_title,
                'last_reported_at': g['last_reported_at'],
            }
        )

    results.sort(key=lambda r: (not r['is_auto_hidden'], -r['report_count']))
    return results


def build_moderation_queue_payload(user=None) -> dict:
    """The exact body `GET /api/moderation/queue/` returns (moderation/views.py's
    `ModerationQueueView.get`) — pulled out here, not left duplicated between the view and
    `measure_moderation_queue` (Phase 4's own load-test measurement command), so there is only ever
    ONE real query-building path to keep correct/optimized, not two copies that can silently drift
    the moment one gets a fix (`select_related('course')` below) the other doesn't. Local imports,
    same discipline `check_auto_hide`/`build_report_queue` above already use, to avoid a real
    circular import (moderation/serializers.py itself imports from this module).

    `user`, added for the "node governor" feature — `None` (measure_moderation_queue's own call,
    unchanged) means unfiltered, matching this function's original, always-unscoped behavior.
    Passing the requesting user (ModerationQueueView.get does) resolves their own `governed_branch_ids`
    and scopes every one of the four queue sections to it — `None` from THAT resolution (a global
    `is_staff` moderator) still means unfiltered, so today's global-moderator experience is
    completely unchanged; only a real, non-staff node governor ever sees a narrower queue."""
    from exercises.serializers import ExerciseTranslationSerializer

    from .models import EditSuggestion, ExerciseSubmission, MaterialSubmission
    from .serializers import EditSuggestionSerializer, ExerciseSubmissionSerializer, MaterialSubmissionSerializer

    branch_ids = governed_branch_ids(user) if user is not None else None

    # select_related('course') — ExerciseSubmissionSerializer.course/MaterialSubmissionSerializer.course
    # are both SlugRelatedFields, which resolve `submission.course.slug` per row; without this it's
    # a real, measured N+1 (one query per pending submission), the next-largest cost in this response
    # once build_report_queue()'s own, larger N+1 was fixed.
    submissions = ExerciseSubmission.objects.filter(status='pending').select_related('branch')
    material_submissions = MaterialSubmission.objects.filter(status='pending').select_related('branch')
    edits = EditSuggestion.objects.filter(status='pending')
    translations = ExerciseTranslation.objects.filter(status='pending')
    if branch_ids is not None:
        submissions = submissions.filter(branch_id__in=branch_ids)
        material_submissions = material_submissions.filter(branch_id__in=branch_ids)
        edits = edits.filter(exercise__branch_id__in=branch_ids)
        translations = translations.filter(exercise__branch_id__in=branch_ids)
    return {
        'taxonomy_proposals': build_taxonomy_proposal_queue(),
        'submissions': ExerciseSubmissionSerializer(submissions, many=True).data,
        'material_submissions': MaterialSubmissionSerializer(material_submissions, many=True).data,
        'edit_suggestions': EditSuggestionSerializer(edits, many=True).data,
        'translations': ExerciseTranslationSerializer(translations, many=True).data,
        'reports': build_report_queue(branch_ids=branch_ids),
    }


def is_feature_enabled(key: str) -> bool:
    """The one place every `feature_gate` permission (moderation/permissions.py) reads a kill
    switch's current state from. Fails OPEN — see FeatureFlag's own doc comment (models.py) for why
    a missing row means "on," not "off." A plain `.filter().first()` rather than `.get()` on
    purpose: no exception to catch for the "not provisioned yet" case, just a `None` to fall through."""
    from .models import FeatureFlag

    flag = FeatureFlag.objects.filter(key=key).first()
    return True if flag is None else flag.is_enabled


def count_pending_moderation(user=None) -> dict:
    """How many decisions are waiting, by kind and in total.

    Its own function rather than `len(build_moderation_queue_payload(...))`, because that one
    SERIALIZES every pending submission, edit, translation and report group — resolving titles,
    per-locale translations and a viewer-pool percentage each — to produce a body a badge then throws
    away. This asks the database for numbers.

    Reports are counted as GROUPS, not rows, because that is the unit somebody acts on: three people
    reporting one comment is one decision. `values(...).distinct().count()` gets that in one query
    without building the queue.

    Scoped exactly as the queue is, so a node governor's badge counts what a node governor's queue
    shows — a number that disagreed with the page it links to would be worse than no number.
    """
    from exercises.models import ExerciseTranslation

    from .models import EditSuggestion, ExerciseSubmission, MaterialSubmission, Report

    branch_ids = governed_branch_ids(user) if user is not None else None

    submissions = ExerciseSubmission.objects.filter(status='pending')
    material_submissions = MaterialSubmission.objects.filter(status='pending')
    edits = EditSuggestion.objects.filter(status='pending')
    translations = ExerciseTranslation.objects.filter(status='pending')
    if branch_ids is not None:
        submissions = submissions.filter(branch_id__in=branch_ids)
        material_submissions = material_submissions.filter(branch_id__in=branch_ids)
        edits = edits.filter(exercise__branch_id__in=branch_ids)
        translations = translations.filter(exercise__branch_id__in=branch_ids)

    # Reports carry no branch column of their own — resolving one means walking a GenericForeignKey
    # per row, which is the cost this function exists to avoid. A scoped moderator's report count is
    # therefore taken from the real queue builder, which already does that resolution in bulk; an
    # unscoped one (global staff) can have the cheap distinct-count.
    if branch_ids is None:
        reports = (
            Report.objects.filter(status='pending')
            .values('content_type_id', 'object_id')
            .distinct()
            .count()
        )
    else:
        reports = len(build_report_queue(branch_ids=branch_ids))

    counts = {
        'submissions': submissions.count(),
        'material_submissions': material_submissions.count(),
        'edit_suggestions': edits.count(),
        'translations': translations.count(),
        'taxonomy_proposals': len(build_taxonomy_proposal_queue()),
        'reports': reports,
    }
    return {**counts, 'total': sum(counts.values())}


def build_taxonomy_proposal_queue() -> list[dict]:
    """Every pending discipline, branch, topic and material type, in one flat list.

    Flat rather than three sections, because to a moderator they are one job — "somebody suggested a
    word, does it belong" — and the only thing that differs is which level it sits at, which the
    `kind` field carries.

    Deliberately NOT scoped by `governed_branch_ids`. A node governor is scoped to a branch, and the
    whole point of a proposal is that its place in the tree is what is being decided; a new
    discipline belongs to no branch at all, so scoping this would make every proposal invisible to
    exactly the people closest to it. Global staff and node governors alike see all of them.
    """
    from config.i18n_utils import resolve_translation
    from materials.models import MaterialType
    from taxonomy.models import Branch, Discipline, Topic

    def name_of(node):
        translation = resolve_translation(node.translations, 'pl')
        return translation.name if translation else node.slug

    rows = []
    for kind, queryset, parent_of in (
        ('discipline', Discipline.objects.filter(status='pending'), lambda n: None),
        (
            'branch',
            Branch.objects.filter(status='pending').select_related('discipline'),
            lambda n: n.discipline.slug,
        ),
        (
            'topic',
            Topic.objects.filter(status='pending').select_related('branch'),
            lambda n: n.branch.slug,
        ),
        # A material type is not part of the tree, but it is the same job for the same person on the
        # same screen — somebody suggested a word, does it belong — so it joins the same list rather
        # than earning a queue tab of its own.
        ('material_type', MaterialType.objects.filter(status='pending'), lambda n: None),
    ):
        for node in queryset.prefetch_related('translations'):
            rows.append(
                {
                    'kind': kind,
                    'id': node.pk,
                    'slug': node.slug,
                    'name': name_of(node),
                    'parent': parent_of(node),
                    'proposed_by': node.proposed_by_id,
                    'proposed_at': node.proposed_at.isoformat() if node.proposed_at else None,
                }
            )
    return rows
