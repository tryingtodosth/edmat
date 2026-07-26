"""Section 14's moderation surface. "Moderator" is, for this prototype, Django's own `is_staff` flag
— CLAUDE.md Section 18 item 4 leaves a real verified-contributor-tier question open; is_staff is the
simplest real gate available today, not a final answer to that question.
"""

from django.contrib.contenttypes.models import ContentType
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
    """POST /api/exercise-submissions/ (auth required) → moderation queue. A regular user only ever
    sees their own submissions; a moderator (is_staff) sees every submission."""

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
        serializer.save(submitted_by=self.request.user)


class EditSuggestionViewSet(viewsets.ModelViewSet):
    """POST /api/edit-suggestions/ (auth required) → moderation queue."""

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
    number) is the real uniqueness constraint."""
    payload = submission.payload
    course = submission.course
    next_number = (Exercise.objects.filter(course=course).order_by('-number').values_list('number', flat=True).first() or 0) + 1
    exercise = Exercise.objects.create(
        course=course,
        number=next_number,
        difficulty=payload.get('difficulty', 'medium'),
        published=True,
        verified=False,
        original_locale=payload.get('locale', 'pl'),
        submitted_by=submission.submitted_by,
    )
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
    """POST /api/moderation/{kind}/{id}/approve/ and /reject/ — moderator only."""

    permission_classes = [IsModerator]

    def post(self, request, kind, pk, decision):
        if kind not in _KIND_MODELS or decision not in ('approve', 'reject'):
            return Response(status=status.HTTP_404_NOT_FOUND)
        model, serializer_class = _KIND_MODELS[kind]
        obj = get_object_or_404(model, pk=pk)
        review_note = request.data.get('review_note', '')

        if decision == 'reject':
            obj.status = 'rejected'
            update_fields = ['status']
            if hasattr(obj, 'review_note'):
                obj.review_note = review_note
                update_fields.append('review_note')
            if hasattr(obj, 'reviewed_by'):
                obj.reviewed_by = request.user
                update_fields.append('reviewed_by')
            obj.save(update_fields=update_fields)
            self._notify_decision(kind, obj, request.user, 'rejected', review_note)
            return Response(serializer_class(obj).data)

        # approve
        if kind == 'submission':
            _apply_submission(obj, request.user)
            obj.status = 'approved'
            obj.reviewed_by = request.user
            obj.review_note = review_note
            obj.save(update_fields=['status', 'reviewed_by', 'review_note', 'resulting_exercise'])
        elif kind == 'edit':
            _apply_edit_suggestion(obj)
            obj.status = 'approved'
            obj.reviewed_by = request.user
            obj.review_note = review_note
            obj.save(update_fields=['status', 'reviewed_by', 'review_note'])
        elif kind == 'translation':
            _publish_translation(obj, request.user)

        self._notify_decision(kind, obj, request.user, 'approved', review_note)
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
