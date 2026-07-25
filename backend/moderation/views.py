"""Section 14's moderation surface. "Moderator" is, for this prototype, Django's own `is_staff` flag
— CLAUDE.md Section 18 item 4 leaves a real verified-contributor-tier question open; is_staff is the
simplest real gate available today, not a final answer to that question.
"""

from django.shortcuts import get_object_or_404
from rest_framework import permissions, status, viewsets
from rest_framework.response import Response
from rest_framework.views import APIView

from exercises.models import Exercise, ExerciseTranslation
from exercises.serializers import ExerciseTranslationSerializer

from .models import EditSuggestion, ExerciseSubmission
from .serializers import EditSuggestionSerializer, ExerciseSubmissionSerializer


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


class ModerationQueueView(APIView):
    """GET /api/moderation/queue/ — pending submissions + edits + translations (moderator only)."""

    permission_classes = [IsModerator]

    def get(self, request):
        submissions = ExerciseSubmission.objects.filter(status='pending')
        edits = EditSuggestion.objects.filter(status='pending')
        translations = ExerciseTranslation.objects.filter(status='pending')
        return Response(
            {
                'submissions': ExerciseSubmissionSerializer(submissions, many=True).data,
                'edit_suggestions': EditSuggestionSerializer(edits, many=True).data,
                'translations': ExerciseTranslationSerializer(translations, many=True).data,
            }
        )


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

        return Response(serializer_class(obj).data)
