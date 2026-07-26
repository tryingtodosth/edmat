"""Section 14's moderation surface. "Moderator" is, for this prototype, Django's own `is_staff` flag
— a coarser, adjacent concept to the separate verified-contributor tier (`Profile.is_verified_contributor`)
`ExerciseSubmissionViewSet.perform_create` below reads for the auto-publish fast path CLAUDE.md
Section 18 item 4 resolves.
"""

from django.contrib.contenttypes.models import ContentType
from django.db import IntegrityError, OperationalError, transaction
from django.shortcuts import get_object_or_404
from rest_framework import permissions, status, viewsets
from rest_framework.response import Response
from rest_framework.views import APIView

from exercises.models import Exercise, ExerciseTranslation
from exercises.serializers import ExerciseTranslationSerializer
from notifications.services import label_for_exercise, notify, notify_tag_followers

from .models import EditSuggestion, ExerciseSubmission, Report
from .serializers import EditSuggestionSerializer, ExerciseSubmissionSerializer, ReportCreateSerializer
from .services import (
    REPORT_KIND_MODELS,
    _content_owner,
    _describe,
    build_moderation_queue_payload,
    build_report_queue,
    check_auto_hide,
    resolve_view_scope_exercise,
)


class IsModerator(permissions.BasePermission):
    def has_permission(self, request, view):
        return bool(request.user and request.user.is_authenticated and request.user.is_staff)


class ExerciseSubmissionViewSet(viewsets.ModelViewSet):
    """POST /api/exercise-submissions/ (auth required) → moderation queue, unless the submitter is a
    verified contributor (below). A regular user only ever sees their own submissions; a moderator
    (is_staff) sees every submission."""

    serializer_class = ExerciseSubmissionSerializer
    permission_classes = [permissions.IsAuthenticated]

    def get_queryset(self):
        qs = ExerciseSubmission.objects.all()
        if not self.request.user.is_staff:
            qs = qs.filter(submitted_by=self.request.user)
        course = self.request.query_params.get('course')
        if course:
            qs = qs.filter(course__slug=course)
        return qs

    def perform_create(self, serializer):
        """CLAUDE.md Section 18 item 4's own real, previously-undecided policy question — resolved: a
        NEW EXERCISE from a verified contributor (`Profile.is_verified_contributor`, already a real
        tier this app grants and reads elsewhere for material-coverage vote weighting,
        materials/serializers.py) goes live immediately, no moderator review. Deliberately narrow,
        matching the policy exactly as decided, not "trust this person generally": an EDIT SUGGESTION
        or a TRANSLATION from the same verified contributor still queues regardless
        (`EditSuggestionViewSet`/`ExerciseTranslationViewSet` are both untouched by this) — trust in
        someone's own NEW exercise being mathematically sound doesn't extend to trusting an unreviewed
        CHANGE to something that's already published and already been checked once.

        Reuses `_apply_submission` unchanged — the exact same function `ModerationActionView` calls
        for a moderator's own approve action, retry-safe number allocation included, so an auto-
        published submission racing a real concurrent moderator approval for the same course (Section
        17I) is already covered by the same fix, not a new, second race this path could reintroduce.

        `reviewed_by` is deliberately left unset — genuinely no one reviewed this, and pretending the
        submitter reviewed their own work would be dishonest in exactly the place a moderator might
        later want to distinguish "a person checked this" from "the system published it on trust."
        `review_note` says so in plain language instead. No `_notify_decision` call either: that
        notification exists to tell a submitter about a moderator's decision they weren't present
        for — here the submitter IS the one making this request right now, and the response body
        (`status: 'approved'`, `resulting_exercise` set) already tells them synchronously; a
        notification a moment later about their own just-completed action would just be noise. Tag
        followers still get notified as usual — that already happens unconditionally inside
        `_apply_submission` itself, regardless of which path led there."""
        submission = serializer.save(submitted_by=self.request.user)
        profile = getattr(self.request.user, 'profile', None)
        if profile and profile.is_verified_contributor:
            _apply_submission(submission, self.request.user)
            submission.status = 'approved'
            submission.review_note = 'Auto-published — submitted by a verified contributor.'
            submission.save(update_fields=['status', 'review_note', 'resulting_exercise'])


class EditSuggestionViewSet(viewsets.ModelViewSet):
    """POST /api/edit-suggestions/ (auth required) → moderation queue, always — deliberately
    unconditional, unlike `ExerciseSubmissionViewSet` right above. The verified-contributor
    auto-publish policy (CLAUDE.md Section 18 item 4) only ever covers a brand-new exercise; an edit
    suggestion is a change to something that's ALREADY published and already been reviewed once, so
    trusting a verified contributor's own new work doesn't extend to skipping review of a change to
    someone else's."""

    serializer_class = EditSuggestionSerializer
    permission_classes = [permissions.IsAuthenticated]

    def get_queryset(self):
        qs = EditSuggestion.objects.all()
        if not self.request.user.is_staff:
            qs = qs.filter(submitted_by=self.request.user)
        exercise = self.request.query_params.get('exercise')
        if exercise:
            qs = qs.filter(exercise_id=exercise)
        return qs

    def perform_create(self, serializer):
        serializer.save(submitted_by=self.request.user)


class ReportViewSet(viewsets.ModelViewSet):
    """POST /api/reports/ (auth required) — the user-facing side of the reporting system (see
    moderation/services.py's own module doc comment for the full feature). Create-only from this
    surface: a moderator's own view of reports goes through ModerationQueueView's grouped `reports`
    key (build_report_queue) and acts through ReportActionView below, never through this ViewSet's
    own list/retrieve/update — a plain per-row Report is never itself the unit a moderator reviews.
    """

    http_method_names = ['post']
    serializer_class = ReportCreateSerializer
    permission_classes = [permissions.IsAuthenticated]

    def perform_create(self, serializer):
        report = serializer.save(reported_by=self.request.user)
        check_auto_hide(report.target)


class ModerationQueueView(APIView):
    """GET /api/moderation/queue/ — pending submissions + edits + translations + reports (grouped,
    priority-sorted — see build_report_queue's own doc comment), moderator only."""

    permission_classes = [IsModerator]

    def get(self, request):
        # ✅ Phase 4 — the real query-building logic lives in build_moderation_queue_payload()
        # (services.py) now, not duplicated here — the exact same function
        # `measure_moderation_queue` imports and measures directly, so there is only ever one real
        # code path to keep correct/optimized.
        return Response(build_moderation_queue_payload())


def _apply_submission(submission, reviewer):
    """Builds a real Exercise + ExerciseTranslation from the submission's own JSON payload — same
    structural/translation-field split as everywhere else (CLAUDE.md Section 9). Auto-assigns the
    next free `number` within the course rather than trusting the payload for it, since (course,
    number) is the real uniqueness constraint.

    That constraint made this a genuine, found-and-reproduced race, not a theoretical one: two
    submissions for the SAME course, approved by two genuinely simultaneous requests, can both read
    the identical `next_number` before either one's `Exercise.objects.create()` commits — confirmed
    directly by firing two real, concurrent `POST .../approve/` calls against a real dev server and
    watching one come back a raw `django.db.utils.IntegrityError` / HTTP 500
    (`UNIQUE constraint failed: exercises_exercise.course_id, exercises_exercise.number`). The
    textbook fix, `select_for_update()` on the course while computing the next number, doesn't help
    here: this project's own dev database is SQLite, which has no row-level locking at all
    (`connection.features.has_select_for_update` is `False`; Django silently no-ops a `select_for_update()`
    call rather than raising on a backend that can't honor it), so a lock-based fix would work on a
    real production Postgres deployment but do nothing in the one environment this was actually
    reproduced in.

    A small, bounded retry loop is what's genuinely correct on both — it doesn't try to prevent the
    collision, it makes the collision harmless by re-reading the current max and trying again the
    instant one is detected. Two DIFFERENT exceptions turned out to need catching, both found by
    directly re-running the same real concurrent-request test, not assumed up front:
    `IntegrityError` for the actual `(course, number)` collision described above, and — separately —
    `OperationalError` ("database is locked"), SQLite's own single-writer limitation surfacing under
    genuine concurrent write pressure even for this one small statement (`config/settings.py`'s own
    `DATABASES['default']['OPTIONS']['timeout']` was raised from Python's 5-second `sqlite3` default
    specifically because of this same finding, which helps but doesn't eliminate the chance of hitting
    it under real load). Each attempt gets its own SAVEPOINT (a nested `atomic()`) so a failed one
    doesn't poison whatever transaction the caller happens to be running in — without a savepoint,
    Django refuses any further query on that connection until an explicit rollback, which would turn
    a handled retry into the exact same unhandled 500 this is fixing."""
    payload = submission.payload
    course = submission.course
    for attempt in range(5):
        next_number = (
            Exercise.objects.filter(course=course)
            .order_by('-number')
            .values_list('number', flat=True)
            .first()
            or 0
        ) + 1
        try:
            with transaction.atomic():
                exercise = Exercise.objects.create(
                    course=course,
                    number=next_number,
                    difficulty=payload.get('difficulty', 'medium'),
                    published=True,
                    verified=False,
                    original_locale=payload.get('locale', 'pl'),
                    submitted_by=submission.submitted_by,
                )
            break
        except (IntegrityError, OperationalError):
            if attempt == 4:
                raise
            continue
    topic_ids = payload.get('topic_ids') or payload.get('topicIds') or []
    if topic_ids:
        exercise.topics.set(topic_ids)
    tag_slugs = payload.get('tags', [])
    if tag_slugs:
        from exercises.models import Tag

        tags = [Tag.objects.get_or_create(slug=slug)[0] for slug in tag_slugs]
        exercise.tags.set(tags)
        for tag in tags:
            notify_tag_followers(tag, actor=submission.submitted_by, exercise=exercise)
    source = payload.get('source') or {}
    if source:
        from exercises.models import ExerciseSource, ExerciseSourceTranslation

        exercise_source = ExerciseSource.objects.create(
            exercise=exercise,
            type=source.get('type', 'other'),
            collection=source.get('collection', '') or '',
            original_problem_number=source.get('original_problem_number')
            or source.get('originalProblemNumber'),
            pages=str(source.get('pages', '')) if source.get('pages') is not None else '',
            chapter=source.get('chapter'),
        )
        source_name = source.get('name', '')
        if source_name:
            ExerciseSourceTranslation.objects.create(
                source=exercise_source, locale=payload.get('locale', 'pl'), name=source_name
            )
    ExerciseTranslation.objects.create(
        exercise=exercise,
        locale=payload.get('locale', 'pl'),
        title=payload.get('title', ''),
        statement=payload.get('statement', ''),
        hint=payload.get('hint', ''),
        answer=payload.get('answer', ''),
        solution=payload.get('solution', ''),
        status='published',
        translated_by=None,
    )
    submission.resulting_exercise = exercise
    return exercise


def _apply_edit_suggestion(suggestion):
    """Applies a proposed field change onto the (exercise, locale) translation it targets — creating
    a fresh translation row if none exists yet for that locale."""
    translation, _created = ExerciseTranslation.objects.get_or_create(
        exercise=suggestion.exercise,
        locale=suggestion.locale,
        status='published',
        defaults={'title': ''},
    )
    if suggestion.field in {'title', 'statement', 'hint', 'answer', 'solution'}:
        setattr(translation, suggestion.field, suggestion.proposed_value)
        translation.save(update_fields=[suggestion.field])


def _publish_translation(translation, reviewer):
    """Promotes a pending translation to published, superseding whatever was previously published
    for the same (exercise, locale) — the unique_together on (exercise, locale, status) means only
    one row can hold 'published' per locale at a time."""
    ExerciseTranslation.objects.filter(
        exercise=translation.exercise, locale=translation.locale, status='published'
    ).exclude(pk=translation.pk).delete()
    translation.status = 'published'
    translation.reviewed_by = reviewer
    translation.save(update_fields=['status', 'reviewed_by'])


_KIND_MODELS = {
    'submission': (ExerciseSubmission, ExerciseSubmissionSerializer),
    'edit': (EditSuggestion, EditSuggestionSerializer),
    'translation': (ExerciseTranslation, ExerciseTranslationSerializer),
}


class ModerationActionView(APIView):
    """POST /api/moderation/{kind}/{id}/approve/ and /reject/ — moderator only.

    Idempotency guard, added after a real concurrent-access test reproduced a genuine race: nothing
    used to stop the SAME queue row from being approved/rejected twice at once (a moderator
    double-clicking, or two moderators racing the same row) — every branch used to re-run its full
    apply logic unconditionally, which for `submission` specifically meant a real risk of two full
    Exercise rows built from ONE submission.

    The first version of this fix wrapped the whole request in `transaction.atomic()` with
    `select_for_update()` on the row — the textbook approach, and genuinely correct on a real
    production Postgres deployment. It made things WORSE here, on this project's own dev database:
    SQLite has no row-level locking at all (`connection.features.has_select_for_update` is `False`,
    so `select_for_update()` silently does nothing on it), while Django's SQLite backend still holds a
    real, exclusive write lock for the FULL DURATION of an `atomic()` block, not just per statement —
    so wrapping `_apply_submission`'s own multi-statement work (several creates, tag lookups,
    notifications) in one big transaction meant two genuinely concurrent requests could now both hit
    a hard `sqlite3.OperationalError: database is locked` waiting on each other, a strictly worse
    failure than the one this was meant to fix (confirmed directly — re-running the exact same
    concurrent-request test against that version reproduced this new error instead of the old one).

    What's here now is a single, small, unconditional `UPDATE ... WHERE status = 'pending'` — a plain
    `QuerySet.update()`, no explicit transaction wrapper at all. That WHERE-clause evaluation is
    atomic at the database engine level on every backend, SQLite included, with zero reliance on row
    locking, and it only ever holds a write lock for the duration of that one fast statement, not for
    the whole slow apply sequence that follows. Exactly one concurrent request can ever see its own
    `UPDATE` affect a row still in `'pending'`; every other one gets `0` rows affected and returns a
    clean 409 instead of touching anything. The honest tradeoff: this claims the FINAL status before
    the apply logic that's supposed to justify it has actually run, so if `_apply_*` then fails for
    some unrelated reason, the item would be left claimed but incomplete — handled below by reverting
    the claim back to `'pending'` in that case, so a moderator can simply retry."""

    permission_classes = [IsModerator]

    def post(self, request, kind, pk, decision):
        if kind not in _KIND_MODELS or decision not in ('approve', 'reject'):
            return Response(status=status.HTTP_404_NOT_FOUND)
        model, serializer_class = _KIND_MODELS[kind]
        review_note = request.data.get('review_note', '')
        if decision == 'reject':
            target_status = 'rejected'
        else:
            # ExerciseTranslation's own status vocabulary calls its approved state 'published', not
            # 'approved' — REVIEW_STATUS_CHOICES (submission/edit) and TRANSLATION_STATUS_CHOICES
            # (translation) genuinely disagree on the name for the same idea (moderation/models.py vs
            # exercises/models.py); this is the one place that difference has to be bridged explicitly.
            target_status = 'published' if kind == 'translation' else 'approved'

        claimed = model.objects.filter(pk=pk, status='pending').update(
            status=target_status, reviewed_by=request.user, review_note=review_note
        )
        if not claimed:
            get_object_or_404(model, pk=pk)  # a genuinely bad pk still 404s rather than 409ing
            return Response(
                {'detail': 'This item has already been reviewed by another moderator.'},
                status=status.HTTP_409_CONFLICT,
            )
        obj = model.objects.get(pk=pk)

        if decision == 'approve':
            try:
                if kind == 'submission':
                    _apply_submission(obj, request.user)
                    obj.save(update_fields=['resulting_exercise'])
                elif kind == 'edit':
                    _apply_edit_suggestion(obj)
                elif kind == 'translation':
                    _publish_translation(obj, request.user)
            except Exception:
                model.objects.filter(pk=pk).update(status='pending', reviewed_by=None, review_note='')
                raise

        outcome = 'rejected' if decision == 'reject' else 'approved'
        self._notify_decision(kind, obj, request.user, outcome, review_note)
        return Response(serializer_class(obj).data)

    @staticmethod
    def _notify_decision(kind, obj, moderator, outcome, note):
        """One place for the 3-kind x 2-outcome notification matrix — both the approve and reject
        branches above call this rather than each repeating the same recipient/label lookup six
        times over. `obj.resulting_exercise` is only ever set on a `submission` that was just
        approved (still None on a rejected one, since it never became a real Exercise) —
        `label_for_exercise(None)` and `notify(..., exercise=None)` both already handle that
        honestly rather than needing a special case here."""
        if kind == 'submission':
            recipient = obj.submitted_by
            exercise = obj.resulting_exercise
            label = label_for_exercise(exercise) if exercise else obj.payload.get('title', '')
        elif kind == 'edit':
            recipient = obj.submitted_by
            exercise = obj.exercise
            label = label_for_exercise(exercise)
        else:  # translation
            recipient = obj.translated_by
            exercise = obj.exercise
            label = label_for_exercise(exercise)

        kind_prefix = {'submission': 'submission', 'edit': 'edit_suggestion', 'translation': 'translation'}[kind]
        notify(recipient, f'{kind_prefix}_{outcome}', actor=moderator, target_label=label, exercise=exercise, note=note)


class ReportActionView(APIView):
    """POST /api/moderation/reports/{kind}/{id}/restore/ or .../remove/ — a moderator resolving
    every PENDING report against one target at once (the group build_report_queue rendered as a
    single row), moderator only.

    - `restore`: the reports were unfounded (or a false-positive auto-hide) — content becomes
      visible again exactly as before. `is_removed` is deliberately left untouched here: restoring
      never un-removes something a moderator had ALREADY permanently removed in an earlier, separate
      decision — this action only ever reverses the community-driven auto-hide, not a moderator's
      own prior call.
    - `remove`: the reports were founded — a real, permanent moderator decision (Comment/Review's
      own `is_removed`, or `published = False` for an Exercise), the same terminal state the
      pre-existing `ModerationActionView` already produces for other content, just reached via a
      different path.

    Either way, `auto_hidden_at` is cleared — once a moderator has actually decided, the content is
    no longer merely "auto-hidden pending review," it's in whatever state that decision produced.
    """

    permission_classes = [IsModerator]

    def post(self, request, kind, pk, decision):
        if kind not in REPORT_KIND_MODELS or decision not in ('restore', 'remove'):
            return Response(status=status.HTTP_404_NOT_FOUND)
        model = REPORT_KIND_MODELS[kind]
        target = get_object_or_404(model, pk=pk)
        note = request.data.get('resolved_note', '')

        update_fields = ['auto_hidden_at']
        target.auto_hidden_at = None
        if decision == 'restore':
            if isinstance(target, Exercise):
                target.published = True
                update_fields.append('published')
        else:  # remove
            if hasattr(target, 'is_removed'):
                target.is_removed = True
                update_fields.append('is_removed')
            if isinstance(target, Exercise):
                target.published = False
                update_fields.append('published')
        target.save(update_fields=update_fields)

        content_type = ContentType.objects.get_for_model(model)
        Report.objects.filter(content_type=content_type, object_id=pk, status='pending').update(
            status='resolved', resolved_by=request.user, resolved_note=note
        )

        preview, _exercise_id, _exercise_title = _describe(target, kind)
        exercise = target if isinstance(target, Exercise) else resolve_view_scope_exercise(target)
        notify(
            _content_owner(target),
            'content_restored' if decision == 'restore' else 'content_removed',
            actor=request.user,
            target_label=preview,
            exercise=exercise,
            note=note,
        )
        return Response(build_report_queue())
