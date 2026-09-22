from django.contrib.auth import get_user_model
from django.contrib.contenttypes.models import ContentType
from rest_framework import serializers

from config.i18n_utils import request_locale, resolve_translation
from exercises.links import submission_material_id
from exercises.models import SolutionEntry
from materials.services import clean_requirement_labels, find_duplicate_requirement_label
from taxonomy.models import Branch

from .applications import kind_of, node_label, resolve_node
from .models import (
    GOVERNABLE_NODE_MODELS,
    EditSuggestion,
    ExerciseSubmission,
    FeatureFlag,
    GovernorApplication,
    NodeGovernor,
    Report,
)
from .services import REPORT_KIND_MODELS

User = get_user_model()
_REVERSE_GOVERNABLE_NODE_MODELS = {model: kind for kind, model in GOVERNABLE_NODE_MODELS.items()}


class ExerciseSubmissionSerializer(serializers.ModelSerializer):
    # By slug, not PK — every other course reference on the frontend (Branch.id, ExerciseListSerializer's
    # own branch_slug) already uses the slug as the id it round-trips, so submitting/reading a
    # submission's own `course` this way needs no separate slug<->PK lookup on the frontend side.
    branch = serializers.SlugRelatedField(slug_field='slug', queryset=Branch.objects.all())
    # "for material X" — lifted out of `payload` onto the row itself so the queue can SAY which
    # material a submission was written for without every reader of the queue having to know the
    # payload's key names. Read-only derivations, not stored columns: the draft stays the one
    # place the answer lives (`ExerciseMaterialLink` is created from it on approval).
    material_id = serializers.SerializerMethodField()
    material_title = serializers.SerializerMethodField()

    class Meta:
        model = ExerciseSubmission
        fields = [
            'id',
            'branch',
            'submitted_by',
            'payload',
            'material_id',
            'material_title',
            'status',
            'reviewed_by',
            'review_note',
            'resulting_exercise',
            'created_at',
        ]
        read_only_fields = ['submitted_by', 'status', 'reviewed_by', 'review_note', 'resulting_exercise']

    def get_material_id(self, obj):
        return submission_material_id(obj.payload)

    def get_material_title(self, obj):
        """The material's own title, resolved for the reader's locale.

        Reads a `{id: title}` map out of the serializer context when the caller supplied one —
        which is how `build_moderation_queue_payload` keeps this at ONE extra query for the whole
        queue instead of one per submission, the same discipline `ReplyCountMixin` already applies
        to reply counts. Falls back to a single lookup when nothing prepared a map (the submission
        ViewSet's own list/retrieve, where there is one row), so a caller that has not been taught
        about the map still gets the truth rather than a blank.
        """
        material_id = submission_material_id(obj.payload)
        if material_id is None:
            return None
        titles = self.context.get('material_titles')
        if titles is not None:
            return titles.get(material_id)
        from materials.models import Material

        material = Material.objects.filter(pk=material_id).prefetch_related('translations').first()
        if material is None:
            return None
        translation = resolve_translation(material.translations, request_locale(self.context))
        return translation.title if translation else material.slug

    def validate_payload(self, value):
        """`payload` stays a flat, unvalidated JSON blob for every OTHER key (Section 9's own
        "draft of everything Exercise + ExerciseTranslation would need"), but `requirements` — a
        new list[str] of skill-tag labels, applied into real `ExerciseRequirement` rows on approval
        (`_apply_submission`, moderation/views.py) — gets the exact same real validation
        `coauthoring.serializers._CatalogueValidationMixin.validate_requirements` applies to the
        identical concept for a material: reject (don't silently dedupe) a case-insensitive-after-
        trim duplicate within the submitted list itself, sharing `find_duplicate_requirement_label`
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
        # `material_id` / `material_role` / `material_locator` — the "add an exercise to THIS
        # material" flow's own half of the draft (exercises/links.py owns the key names). Validated
        # here rather than only at apply time for the reason the requirement check above already
        # gives: a draft that names a material nobody can link to is a submission that will quietly
        # lose half of what it was for, weeks later, in front of a moderator who cannot tell why.
        if any(key in value for key in ('material_id', 'materialId')):
            from exercises.models import EXERCISE_LINK_ROLE_CHOICES
            from materials.models import Material

            material_id = submission_material_id(value)
            if material_id is None or not Material.objects.filter(
                pk=material_id, published=True
            ).exists():
                raise serializers.ValidationError(
                    ['material_id: no published material with that id.']
                )
            role = value.get('material_role', value.get('materialRole'))
            if role is not None and role not in dict(EXERCISE_LINK_ROLE_CHOICES):
                raise serializers.ValidationError(
                    ["material_role: must be 'source' or 'practice'."]
                )
            locator = value.get('material_locator', value.get('materialLocator'))
            if locator is not None and len(str(locator)) > 120:
                raise serializers.ValidationError(
                    ['material_locator: keep this under 120 characters.']
                )
        return value


class EditSuggestionSerializer(serializers.ModelSerializer):
    # Which SolutionEntry this edits, when it edits one at all — hints/solutions are pool entries
    # now (exercises.SolutionEntry), so a suggestion against one names the ROW, not a translation
    # field. `exercise`/`locale`/`field` are then derived server-side from the entry itself
    # (queue scoping still reads them), never trusted from the client.
    entry = serializers.PrimaryKeyRelatedField(
        queryset=SolutionEntry.objects.all(),
        required=False,
        allow_null=True,
    )

    class Meta:
        model = EditSuggestion
        fields = [
            'id',
            'exercise',
            'locale',
            'field',
            'entry',
            'proposed_value',
            'reason',
            'submitted_by',
            'status',
            'reviewed_by',
            'review_note',
            'created_at',
        ]
        read_only_fields = ['submitted_by', 'status', 'reviewed_by', 'review_note']
        # `exercise`/`locale`/`field` are required for a translation-targeted suggestion but
        # derived for an entry-targeted one — enforced in validate(), not by field flags.
        extra_kwargs = {
            'exercise': {'required': False},
            'locale': {'required': False, 'allow_blank': True},
            'field': {'required': False, 'allow_blank': True},
        }

    def validate(self, attrs):
        entry = attrs.get('entry') or getattr(self.instance, 'entry', None)
        if entry is not None:
            # An entry-targeted suggestion: everything positional comes from the entry itself.
            if not entry.is_visible_to_readers():
                raise serializers.ValidationError(
                    {'entry': ['Only a published entry can receive edit suggestions.']}
                )
            attrs['exercise'] = entry.exercise
            attrs['locale'] = entry.locale
            attrs['field'] = 'body'
            return attrs

        exercise = attrs.get('exercise') or getattr(self.instance, 'exercise', None)
        locale = attrs.get('locale') or getattr(self.instance, 'locale', None)
        field = attrs.get('field') or getattr(self.instance, 'field', None)
        if exercise is None or not locale or not field:
            raise serializers.ValidationError(
                {'field': ['exercise, locale and field are required unless an entry is named.']}
            )
        # Hints/solutions are no longer translation fields — a suggestion against one must name
        # the entry it edits (see `entry` above); accepting the old field names here would produce
        # a suggestion `_apply_edit_suggestion` can never apply.
        if field not in ('title', 'statement', 'answer'):
            raise serializers.ValidationError(
                {'field': ["Must be one of 'title', 'statement', 'answer' — a hint/solution edit names its entry instead."]}
            )
        # An edit suggestion is a proposed change to an EXISTING translation, never a way to
        # originate a brand-new one for a locale nobody has translated yet — that's what the
        # separate translation-submission flow (`POST /api/exercises/{id}/translations/`) is
        # for, and it goes through its own real review. Without this check,
        # `_apply_edit_suggestion` (moderation/views.py) would happily `get_or_create` a fresh,
        # published `ExerciseTranslation` the moment a moderator approved a suggestion for a
        # locale with no existing translation — publishing a near-empty exercise (blank title,
        # blank statement, just the one edited field) straight to readers, with no real
        # translation review ever having happened.
        if not exercise.translations.filter(locale=locale).exists():
            raise serializers.ValidationError(
                {'locale': [f'No existing translation for locale "{locale}" on this exercise.']}
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
    # A Discipline/Branch is addressed by slug everywhere in this API; a Material is not, because
    # its slug is only unique WITHIN a branch (`unique_together [('branch','slug')]`) and a lookup
    # by slug alone would silently pick whichever one the database returned first. So a material
    # grant carries `node_pk` instead, and exactly one of the two is required.
    node_slug = serializers.CharField(write_only=True, required=False, allow_blank=True)
    node_pk = serializers.IntegerField(write_only=True, required=False)
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
            'node_pk',
            'node_type',
            'node_id',
            'node_label',
            'granted_by',
            'created_at',
        ]
        read_only_fields = ['granted_by', 'created_at']

    def validate(self, attrs):
        model = GOVERNABLE_NODE_MODELS[attrs['kind']]
        node_pk = attrs.get('node_pk')
        node_slug = (attrs.get('node_slug') or '').strip()
        if node_pk is not None:
            node = model.objects.filter(pk=node_pk).first()
            if node is None:
                raise serializers.ValidationError({'node_pk': ['No matching node found.']})
        elif node_slug:
            node = model.objects.filter(slug=node_slug).first()
            if node is None:
                raise serializers.ValidationError({'node_slug': ['No matching node found.']})
        else:
            raise serializers.ValidationError(
                {'node_slug': ['Give either node_slug (a discipline or branch) or node_pk.']}
            )
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
        validated_data.pop('node_slug', None)
        validated_data.pop('node_pk', None)
        node = validated_data.pop('_node')
        content_type = validated_data.pop('_content_type')
        return NodeGovernor.objects.create(content_type=content_type, object_id=node.pk, **validated_data)

    def get_node_type(self, obj):
        return _REVERSE_GOVERNABLE_NODE_MODELS.get(obj.content_type.model_class())

    def get_node_id(self, obj):
        """The slug for a taxonomy node, the pk for a material — the same value the client has to
        send back to grant or revoke the same thing, so a round trip through this field works for
        all three kinds."""
        node = obj.node
        if node is None:
            return None
        if _REVERSE_GOVERNABLE_NODE_MODELS.get(type(node)) == 'material':
            return node.pk
        return getattr(node, 'slug', None)

    def get_node_label(self, obj):
        node = obj.node
        if node is None:
            return ''
        t = resolve_translation(node.translations, request_locale(self.context))
        if t is None:
            return getattr(node, 'slug', '') or str(node.pk)
        # A Discipline/Branch translation carries `name`; a MaterialTranslation carries `title`.
        return getattr(t, 'name', None) or getattr(t, 'title', '') or ''

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


class GovernorApplicationSerializer(serializers.ModelSerializer):
    """Reading an application. `queue_position` is the honest half of "transparent queue tracking":
    it says how many people are ahead, and there is nothing anybody can do to change it — which is
    the point (see GovernorApplication's own docstring on the fee that was proposed and dropped)."""

    applicant_display_name = serializers.SerializerMethodField()
    kind = serializers.SerializerMethodField()
    node_label = serializers.SerializerMethodField()
    node_ref = serializers.SerializerMethodField()
    queue_position = serializers.IntegerField(read_only=True)
    decided_by_display_name = serializers.SerializerMethodField()

    class Meta:
        model = GovernorApplication
        fields = [
            'id',
            'applicant',
            'applicant_display_name',
            'kind',
            'node_label',
            'node_ref',
            'statement',
            'status',
            'queue_position',
            'decision_note',
            'decided_by_display_name',
            'decided_at',
            'created_at',
        ]
        read_only_fields = fields

    def _name(self, user) -> str:
        if user is None:
            return ''
        profile = getattr(user, 'profile', None)
        return (profile.display_name if profile and profile.display_name else user.username) or ''

    def get_applicant_display_name(self, obj) -> str:
        return self._name(obj.applicant)

    def get_decided_by_display_name(self, obj) -> str:
        return self._name(obj.decided_by)

    def get_kind(self, obj) -> str:
        return kind_of(obj.node)

    def get_node_label(self, obj) -> str:
        return node_label(obj.node)

    def get_node_ref(self, obj):
        """What a client sends back to talk about the same node — a slug for a taxonomy node, a pk
        for a material, matching `NodeGovernorSerializer.node_id`."""
        node = obj.node
        if node is None:
            return None
        return node.pk if kind_of(node) == 'material' else getattr(node, 'slug', None)


class GovernorApplicationCreateSerializer(serializers.Serializer):
    kind = serializers.ChoiceField(choices=list(GOVERNABLE_NODE_MODELS))
    node_ref = serializers.CharField()
    statement = serializers.CharField(max_length=4000)

    def validate_statement(self, value: str) -> str:
        cleaned = value.strip()
        if len(cleaned) < 20:
            # Not a style rule: an application with nothing in it gives the reader nothing to weigh,
            # and "no" is then the only answer that can be justified — which wastes the applicant's
            # time more than asking for a sentence does.
            raise serializers.ValidationError(
                'Say a little about why you want to look after this — at least a sentence.'
            )
        return cleaned

    def validate(self, attrs):
        content_type, node = resolve_node(attrs['kind'], attrs['node_ref'])
        if node is None:
            raise serializers.ValidationError({'node_ref': ['No matching discipline, branch or material.']})
        user = self.context['request'].user
        if NodeGovernor.objects.filter(
            user=user, content_type=content_type, object_id=node.pk
        ).exists():
            raise serializers.ValidationError({'detail': ['You already look after this.']})
        if GovernorApplication.objects.filter(
            applicant=user, content_type=content_type, object_id=node.pk, status='pending'
        ).exists():
            raise serializers.ValidationError({'detail': ['You have already applied for this.']})
        attrs['_content_type'] = content_type
        attrs['_node'] = node
        return attrs

    def create(self, validated_data):
        return GovernorApplication.objects.create(
            applicant=self.context['request'].user,
            content_type=validated_data['_content_type'],
            object_id=validated_data['_node'].pk,
            statement=validated_data['statement'],
        )
