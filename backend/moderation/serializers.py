from django.contrib.auth import get_user_model
from django.contrib.contenttypes.models import ContentType
from rest_framework import serializers

from config.i18n_utils import request_locale, resolve_translation
from materials.services import clean_requirement_labels, find_duplicate_requirement_label
from taxonomy.models import Branch

from .models import (
    GOVERNABLE_NODE_MODELS,
    EditSuggestion,
    ExerciseSubmission,
    FeatureFlag,
    MaterialSubmission,
    NodeGovernor,
    Report,
)
from .services import REPORT_KIND_MODELS

User = get_user_model()
_REVERSE_GOVERNABLE_NODE_MODELS = {model: kind for kind, model in GOVERNABLE_NODE_MODELS.items()}


class ExerciseSubmissionSerializer(serializers.ModelSerializer):
    # By slug, not PK — every other course reference on the frontend (Branch.id, ExerciseListSerializer's
    # own course_slug) already uses the slug as the id it round-trips, so submitting/reading a
    # submission's own `course` this way needs no separate slug<->PK lookup on the frontend side.
    branch = serializers.SlugRelatedField(slug_field='slug', queryset=Branch.objects.all())

    class Meta:
        model = ExerciseSubmission
        fields = [
            'id',
            'branch',
            'submitted_by',
            'payload',
            'status',
            'reviewed_by',
            'review_note',
            'resulting_exercise',
            'created_at',
        ]
        read_only_fields = ['submitted_by', 'status', 'reviewed_by', 'review_note', 'resulting_exercise']

    def validate_payload(self, value):
        """`payload` stays a flat, unvalidated JSON blob for every OTHER key (Section 9's own
        "draft of everything Exercise + ExerciseTranslation would need"), but `requirements` — a
        new list[str] of skill-tag labels, applied into real `ExerciseRequirement` rows on approval
        (`_apply_submission`, moderation/views.py) — gets the exact same real validation
        `MaterialSubmissionSerializer.validate_requirements` already applies to the identical
        concept for a Material: reject (don't silently dedupe) a case-insensitive-after-trim
        duplicate within the submitted list itself, sharing `find_duplicate_requirement_label`
        rather than a second, independently-drifting copy of that check."""
        if 'requirements' in value:
            labels = value.get('requirements')
            # A plain list of strings, not a field-keyed dict — `validate_<field>` is already
            # scoped to `payload` itself, so DRF nests whatever this raises under `{'payload': [...]}`
            # on its own; returning a dict here would double-nest instead.
            if not isinstance(labels, list):
                raise serializers.ValidationError(['requirements: must be a list of labels.'])
            cleaned = clean_requirement_labels(labels)
            duplicate = find_duplicate_requirement_label(cleaned)
            if duplicate is not None:
                raise serializers.ValidationError(
                    [f'requirements: "{duplicate}" appears more than once in this list.']
                )
            value['requirements'] = cleaned
        return value


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
    materials.validators.scan_for_malware and sets them, never trusted from the client.

    `requirements`/`price_amount`/`price_currency`/`estimated_minutes` are all genuinely optional —
    a submission that never sets any of them behaves exactly as before this feature existed.
    `requirements` is declared explicitly (not left to ModelSerializer's own JSONField default)
    because this endpoint is multipart, not JSON: a plain `serializers.JSONField(binary=False)`
    round-trips a real Python list fine when the request body actually IS JSON (this project's own
    test suite posts this way), but a multipart form field always arrives as a bare STRING — so
    `validate_requirements` below accepts either shape, parsing a JSON-encoded string itself rather
    than silently storing the raw string as a single-element requirement.
    """

    branch = serializers.SlugRelatedField(slug_field='slug', queryset=Branch.objects.all())
    requirements = serializers.JSONField(required=False, default=list)
    coverage = serializers.JSONField(required=False, default=list)

    class Meta:
        model = MaterialSubmission
        fields = [
            'id',
            'branch',
            'submitted_by',
            'type',
            'title',
            'description',
            'locale',
            'file',
            'author',
            'source_url',
            'requirements',
            'coverage',
            'price_amount',
            'price_currency',
            'estimated_minutes',
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

    def validate_requirements(self, value):
        if isinstance(value, str):
            import json

            try:
                value = json.loads(value) if value.strip() else []
            except ValueError:
                raise serializers.ValidationError('Must be a JSON array of strings.')
        if not isinstance(value, list):
            raise serializers.ValidationError('Must be a JSON array of strings.')
        cleaned = clean_requirement_labels(value)
        # Same case-insensitive (after trim) duplicate check the governor-only bulk-replace endpoint
        # (materials/views.py's `requirements` action) already enforces on an already-published
        # Material — shared via materials/services.py's `find_duplicate_requirement_label` so a
        # brand-new submission can't sneak in duplicates any more than an edit to an existing
        # Material's own requirement list can.
        duplicate = find_duplicate_requirement_label(cleaned)
        if duplicate is not None:
            raise serializers.ValidationError(f'"{duplicate}" appears more than once in this list.')
        return cleaned

    def validate_coverage(self, value):
        """Same string-or-list acceptance `validate_requirements` above already establishes (this
        endpoint is multipart, not JSON) — each entry is `{"topic_id": int, "level": int}` (1-100).
        Which COURSE a `topic_id` must belong to isn't known yet at this point (`course` is a
        sibling field, validated independently) — that cross-field check happens in `validate()`
        below, the same split DRF itself expects for anything needing more than one field's value."""
        if isinstance(value, str):
            import json

            try:
                value = json.loads(value) if value.strip() else []
            except ValueError:
                raise serializers.ValidationError('Must be a JSON array of {topic_id, level} objects.')
        if not isinstance(value, list):
            raise serializers.ValidationError('Must be a JSON array of {topic_id, level} objects.')

        cleaned = []
        seen_topic_ids = set()
        for entry in value:
            if not isinstance(entry, dict):
                raise serializers.ValidationError('Each coverage entry must be an object.')
            try:
                topic_id = int(entry.get('topic_id'))
                level = int(entry.get('level'))
            except (TypeError, ValueError):
                raise serializers.ValidationError('Each coverage entry needs a real topic_id and level.')
            if not (1 <= level <= 100):
                raise serializers.ValidationError('level must be between 1 and 100.')
            if topic_id in seen_topic_ids:
                raise serializers.ValidationError('The same topic was listed more than once.')
            seen_topic_ids.add(topic_id)
            cleaned.append({'topic_id': topic_id, 'level': level})
        return cleaned

    def validate(self, attrs):
        coverage = attrs.get('coverage')
        branch = attrs.get('branch')
        if coverage and branch is not None:
            valid_topic_ids = set(branch.topics.values_list('id', flat=True))
            for entry in coverage:
                if entry['topic_id'] not in valid_topic_ids:
                    raise serializers.ValidationError(
                        {'coverage': [f'Topic {entry["topic_id"]} is not one of this branch\'s own topics.']}
                    )
        return attrs


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
    """The "node governor" feature's own grant/list serializer — `kind` + `node_slug` (a Discipline/Branch
    slug, matching every other Discipline/Branch reference in this API, e.g.
    ExerciseSubmissionSerializer.course above — the frontend never deals with a raw numeric PK for
    either of those two types) resolve to the real GenericForeignKey target, mirroring
    ReportCreateSerializer's own `kind`/`object_id` write-only pattern one level up (a slug, not a
    bare int, since Discipline/Branch are the one pair of models this whole API already treats that way).
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


class FeatureFlagSerializer(serializers.ModelSerializer):
    """`key` is read-only — the 4 real flags are a fixed, curated set (FeatureFlag.Meta, seeded by
    migration), never client-creatable; a PATCH only ever touches `is_enabled`.
    `updated_by_display_name` mirrors the exact `getattr(obj.x.profile, 'display_name', '') or
    obj.x.username` pattern already established for NodeGovernorSerializer.user_display_name/
    ReviewSerializer/CommentSerializer above — the standard way this API resolves "whose name do we
    show" without a second round-trip."""

    updated_by_display_name = serializers.SerializerMethodField()

    class Meta:
        model = FeatureFlag
        fields = ['key', 'is_enabled', 'updated_at', 'updated_by_display_name']
        read_only_fields = ['key', 'updated_at', 'updated_by_display_name']

    def get_updated_by_display_name(self, obj):
        if obj.updated_by is None:
            return None
        return getattr(obj.updated_by.profile, 'display_name', '') or obj.updated_by.username
