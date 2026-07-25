from rest_framework import serializers

from taxonomy.models import Course

from .models import EditSuggestion, ExerciseSubmission


class ExerciseSubmissionSerializer(serializers.ModelSerializer):
    # By slug, not PK — every other course reference on the frontend (Course.id, ExerciseListSerializer's
    # own course_slug) already uses the slug as the id it round-trips, so submitting/reading a
    # submission's own `course` this way needs no separate slug<->PK lookup on the frontend side.
    course = serializers.SlugRelatedField(slug_field='slug', queryset=Course.objects.all())

    class Meta:
        model = ExerciseSubmission
        fields = [
            'id',
            'course',
            'submitted_by',
            'payload',
            'status',
            'reviewed_by',
            'review_note',
            'resulting_exercise',
            'created_at',
        ]
        read_only_fields = ['submitted_by', 'status', 'reviewed_by', 'review_note', 'resulting_exercise']


class EditSuggestionSerializer(serializers.ModelSerializer):
    class Meta:
        model = EditSuggestion
        fields = [
            'id',
            'exercise',
            'locale',
            'field',
            'proposed_value',
            'reason',
            'submitted_by',
            'status',
            'reviewed_by',
            'review_note',
            'created_at',
        ]
        read_only_fields = ['submitted_by', 'status', 'reviewed_by', 'review_note']
