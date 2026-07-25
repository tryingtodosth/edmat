"""The community-driven auto-hide rule: "reported comment, content, review etc gets a priority in
the moderation queue. If +20% of users who viewed that content report it, it gets hidden right away
even before a moderator's decision."

Two pieces, both here rather than in views.py since neither is HTTP-shaped: `check_auto_hide` (the
actual rule, called right after a new Report is saved) and `resolve_view_scope_exercise` (which
Exercise's own ContentView count a report's percentage gets divided against — reused by
moderation/views.py's queue builder too, so the displayed percentage and the one the rule itself
acted on can never drift apart).
"""

from __future__ import annotations

from django.contrib.contenttypes.models import ContentType
from django.utils import timezone

from community.models import Comment, Review
from exercises.models import Exercise

# The one place `kind` <-> model is defined — moderation/serializers.py's ReportCreateSerializer
# (validating an incoming report) and build_report_queue below (rendering the moderator-facing
# queue) both import this rather than each keeping their own copy.
REPORT_KIND_MODELS = {
    'exercise': Exercise,
    'comment': Comment,
    'review': Review,
}
_REVERSE_KIND_MODELS = {model: kind for kind, model in REPORT_KIND_MODELS.items()}

# A safety rail beyond the literal "+20%" instruction, added deliberately and flagged plainly here
# rather than silently baked in: with a low view count, a single report can already clear 20% on
# its own (e.g. 1 report / 4 viewers = 25%) — which would let ONE bad-faith report hide something.
# Requiring real corroboration first (a handful of independent reporters) closes that gap without
# changing the rule's own spirit; trivially tunable if the real number should be different.
MIN_REPORTS_FOR_AUTO_HIDE = 3
AUTO_HIDE_THRESHOLD = 0.20


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
    return True


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


def build_report_queue() -> list[dict]:
    """Every target with at least one PENDING report, grouped and sorted by priority — this is the
    literal "gets a priority in the moderation queue" requirement: already auto-hidden items float
    to the very top (most urgent, since they're live-hidden right now and waiting on a decision),
    everything else follows by raw pending-report count descending. Resolves each target directly
    (N+1 queries) — fine at this app's real scale, the same "don't optimize prematurely" call this
    project already makes for MaterialCoverageSerializer's own per-row vote aggregation.
    """
    from django.db.models import Count, Max

    from .models import Report

    groups = (
        Report.objects.filter(status='pending')
        .values('content_type', 'object_id')
        .annotate(report_count=Count('id'), last_reported_at=Max('created_at'))
    )

    results = []
    for g in groups:
        content_type = ContentType.objects.get_for_id(g['content_type'])
        model = content_type.model_class()
        kind = _REVERSE_KIND_MODELS.get(model)
        if kind is None:
            continue  # a report on something outside the moderator-facing kinds (see the model's own note)
        try:
            target = model.objects.get(pk=g['object_id'])
        except model.DoesNotExist:
            continue  # the reported row itself was deleted since being reported

        reasons = list(
            Report.objects.filter(content_type=content_type, object_id=g['object_id'], status='pending')
            .exclude(reason='')
            .values_list('reason', flat=True)[:5]
        )
        exercise = resolve_view_scope_exercise(target)
        view_count = exercise.views.count() if exercise is not None else None
        percent = round(100 * g['report_count'] / view_count) if view_count else None
        preview, exercise_id, exercise_title = _describe(target, kind)

        results.append(
            {
                'kind': kind,
                'object_id': g['object_id'],
                'report_count': g['report_count'],
                'view_count': view_count,
                'percent_reported': percent,
                'is_auto_hidden': getattr(target, 'auto_hidden_at', None) is not None,
                'reasons': reasons,
                'preview': preview,
                'exercise_id': exercise_id,
                'exercise_title': exercise_title,
                'last_reported_at': g['last_reported_at'],
            }
        )

    results.sort(key=lambda r: (not r['is_auto_hidden'], -r['report_count']))
    return results
