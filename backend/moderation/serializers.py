from django.contrib.auth import get_user_model
from django.contrib.contenttypes.models import ContentType
from rest_framework import serializers

from config.i18n_utils import request_locale, resolve_translation
from taxonomy.models import Course

from .models import (
    GOVERNABLE_NODE_MODELS,
    EditSuggestion,
    ExerciseSubmission,
    MaterialSubmission,
    NodeGovernor,
    Report,
)
from .services import REPORT_KIND_MODELS

User = get_user_model()
_REVERSE_GOVERNABLE_NODE_MODELS = {model: kind for kind, model in GOVERNABLE_NODE_MODELS.items()}


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


class MaterialSubmissionSerializer(serializers.ModelSerializer):
    """POST /api/material-submissions/ (multipart — `file` is a real upload, not JSON) — the
    file-centric counterpart to ExerciseSubmissionSerializer above. `course` follows the exact same
    by-slug convention that one already established. `scan_status`/`scan_detail` are read-only here
    too — MaterialSubmissionViewSet.perform_create (views.py) is what actually runs
    materials.validators.scan_for_malware and sets them, never trusted from the client."""

    course = serializers.SlugRelatedField(slug_field='slug', queryset=Course.objects.all())

    class Meta:
        model = MaterialSubmission
        fields = [
            'id',
            'course',
            'submitted_by',
            'type',
            'title',
            'description',
            'locale',
            'file',
            'scan_status',
            'scan_detail',
            'status',
            'reviewed_by',
            'review_note',
            'resulting_material',
            'created_at',
        ]
        read_only_fields = [
            'submitted_by',
            'scan_status',
            'scan_detail',
            'status',
            'reviewed_by',
            'review_note',
            'resulting_material',
        ]


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


class NodeGovernorSerializer(serializers.ModelSerializer):
    """The "node governor" feature's own grant/list serializer — `kind` + `node_slug` (a Field/Course
    slug, matching every other Field/Course reference in this API, e.g.
    ExerciseSubmissionSerializer.course above — the frontend never deals with a raw numeric PK for
    either of those two types) resolve to the real GenericForeignKey target, mirroring
    ReportCreateSerializer's own `kind`/`object_id` write-only pattern one level up (a slug, not a
    bare int, since Field/Course are the one pair of models this whole API already treats that way).
    `user` stays a plain PK — User genuinely is one of the "opaque numeric id" types everywhere else
    in this app (Review.author, Comment.author, ...), so no special-casing needed there.
    """

    user = serializers.PrimaryKeyRelatedField(queryset=User.objects.all())
    user_display_name = serializers.SerializerMethodField()
    kind = serializers.ChoiceField(choices=list(GOVERNABLE_NODE_MODELS), write_only=True)
    node_slug = serializers.CharField(write_only=True)
    node_type = serializers.SerializerMethodField()
    node_id = serializers.SerializerMethodField()
    node_label = serializers.SerializerMethodField()

    class Meta:
        model = NodeGovernor
        fields = [
            'id',
            'user',
            'user_display_name',
            'kind',
            'node_slug',
            'node_type',
            'node_id',
            'node_label',
            'granted_by',
            'created_at',
        ]
        read_only_fields = ['granted_by', 'created_at']

    def validate(self, attrs):
        model = GOVERNABLE_NODE_MODELS[attrs['kind']]
        node = model.objects.filter(slug=attrs['node_slug']).first()
        if node is None:
            raise serializers.ValidationError({'node_slug': ['No matching node found.']})
        content_type = ContentType.objects.get_for_model(model)
        # Pre-validated here (same style ReportCreateSerializer's own `already_reported` check
        # already uses) rather than relying on the model's own unique_together to raise
        # IntegrityError — a clean 400 beats a raw 500 for an entirely expected "already granted"
        # case.
        if NodeGovernor.objects.filter(
            user=attrs['user'], content_type=content_type, object_id=node.pk
        ).exists():
            raise serializers.ValidationError({'detail': ['This user already governs this node.']})
        attrs['_node'] = node
        attrs['_content_type'] = content_type
        return attrs

    def create(self, validated_data):
        validated_data.pop('kind')
        validated_data.pop('node_slug')
        node = validated_data.pop('_node')
        content_type = validated_data.pop('_content_type')
        return NodeGovernor.objects.create(content_type=content_type, object_id=node.pk, **validated_data)

    def get_node_type(self, obj):
        return _REVERSE_GOVERNABLE_NODE_MODELS.get(obj.content_type.model_class())

    def get_node_id(self, obj):
        node = obj.node
        return getattr(node, 'slug', None)

    def get_node_label(self, obj):
        node = obj.node
        if node is None:
            return ''
        t = resolve_translation(node.translations, request_locale(self.context))
        return t.name if t else node.slug

    def get_user_display_name(self, obj):
        return getattr(obj.user.profile, 'display_name', '') or obj.user.username
