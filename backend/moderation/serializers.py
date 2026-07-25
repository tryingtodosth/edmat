from django.contrib.contenttypes.models import ContentType
from rest_framework import serializers

from taxonomy.models import Course

from .models import EditSuggestion, ExerciseSubmission, Report
from .services import REPORT_KIND_MODELS


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


class ReportCreateSerializer(serializers.ModelSerializer):
    """POST /api/reports/ — `kind` (one of moderation/services.py's REPORT_KIND_MODELS) + `object_id`
    resolve to the real GenericForeignKey target; `reported_by`/`status` are set server-side
    (`reported_by` in the view via request.user, `status` by the model's own default), never trusted
    from the client. `kind`/`object_id` are write_only since a read of a Report by itself is never
    served directly — moderation/services.py's `build_report_queue` is what a moderator actually
    reads, already resolved and grouped.
    """

    kind = serializers.ChoiceField(choices=list(REPORT_KIND_MODELS), write_only=True)
    object_id = serializers.IntegerField(write_only=True)

    class Meta:
        model = Report
        fields = ['id', 'kind', 'object_id', 'reason', 'reported_by', 'status', 'created_at']
        read_only_fields = ['reported_by', 'status', 'created_at']

    def validate(self, attrs):
        model = REPORT_KIND_MODELS[attrs['kind']]
        if not model.objects.filter(pk=attrs['object_id']).exists():
            raise serializers.ValidationError({'object_id': ['No matching content found.']})

        request = self.context.get('request')
        if request is not None and request.user.is_authenticated:
            content_type = ContentType.objects.get_for_model(model)
            already_reported = Report.objects.filter(
                content_type=content_type, object_id=attrs['object_id'], reported_by=request.user
            ).exists()
            if already_reported:
                raise serializers.ValidationError({'detail': ['You already reported this.']})
        return attrs

    def create(self, validated_data):
        kind = validated_data.pop('kind')
        object_id = validated_data.pop('object_id')
        model = REPORT_KIND_MODELS[kind]
        content_type = ContentType.objects.get_for_model(model)
        return Report.objects.create(content_type=content_type, object_id=object_id, **validated_data)
