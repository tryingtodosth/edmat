from django.contrib.contenttypes.models import ContentType
from rest_framework import serializers

from community.models import Comment
from exercises.models import Exercise, Tag
from materials.models import Material
from taxonomy.models import Branch, Discipline

from .models import ActivityEvent, Post
from .postimage import process_activity_post_image


def _display_name(user):
    if user is None:
        return ''
    profile = getattr(user, 'profile', None)
    return profile.display_name if profile and profile.display_name else user.username


class PostSerializer(serializers.ModelSerializer):
    """Read shape. A removed/auto-hidden post is TOMBSTONED, not omitted (the Comment precedent —
    its thread and any feed permalink survive): body/image/author blank out, the row stays."""

    author_display_name = serializers.SerializerMethodField()
    body = serializers.SerializerMethodField()
    image = serializers.SerializerMethodField()
    author = serializers.SerializerMethodField()
    discipline = serializers.SlugRelatedField(slug_field='slug', read_only=True)
    branch = serializers.SlugRelatedField(slug_field='slug', read_only=True)
    tag = serializers.SlugRelatedField(slug_field='slug', read_only=True)
    anchor_label = serializers.SerializerMethodField()
    ref_exercise_title = serializers.SerializerMethodField()
    ref_material_title = serializers.SerializerMethodField()
    ref_course_title = serializers.SerializerMethodField()
    comment_count = serializers.SerializerMethodField()

    class Meta:
        model = Post
        fields = [
            'id',
            'author',
            'author_display_name',
            'body',
            'image',
            'discipline',
            'branch',
            'tag',
            'anchor_label',
            'ref_exercise',
            'ref_exercise_title',
            'ref_material',
            'ref_material_title',
            'ref_course',
            'ref_course_title',
            'is_removed',
            'auto_hidden_at',
            'comment_count',
            'created_at',
        ]

    def _hidden(self, obj) -> bool:
        return not obj.is_visible_to_readers()

    def get_author(self, obj):
        return None if self._hidden(obj) else obj.author_id

    def get_author_display_name(self, obj):
        return '' if self._hidden(obj) else _display_name(obj.author)

    def get_body(self, obj):
        return '' if self._hidden(obj) else obj.body

    def get_image(self, obj):
        if self._hidden(obj) or not obj.image:
            return None
        request = self.context.get('request')
        url = obj.image.url
        return request.build_absolute_uri(url) if request is not None else url

    def get_anchor_label(self, obj):
        """The anchor's human name, resolved per request locale — a chip reading "Analiza
        Matematyczna II", not a bare slug."""
        from config.i18n_utils import request_locale, resolve_translation

        locale = request_locale(self.context)
        node = obj.discipline or obj.branch
        if node is not None:
            translation = resolve_translation(node.translations.all(), locale)
            return translation.name if translation else node.slug
        return f'#{obj.tag.slug}' if obj.tag_id else ''

    def _exercise_title(self, exercise):
        from notifications.services import label_for_exercise

        return label_for_exercise(exercise)

    def get_ref_exercise_title(self, obj):
        return self._exercise_title(obj.ref_exercise) if obj.ref_exercise_id else ''

    def get_ref_material_title(self, obj):
        from notifications.services import label_for_material

        return label_for_material(obj.ref_material) if obj.ref_material_id else ''

    def get_ref_course_title(self, obj):
        return obj.ref_course.title if obj.ref_course_id else ''

    def get_comment_count(self, obj):
        return Comment.objects.filter(
            content_type=ContentType.objects.get_for_model(Post),
            object_id=obj.pk,
            is_removed=False,
        ).count()


class PostCreateSerializer(serializers.ModelSerializer):
    """Write shape — multipart when an image rides along. The anchor arrives as slugs (the id
    convention every taxonomy reference in this API already uses); exactly one is required, and
    the DB CheckConstraint backs this validation up rather than being the only line."""

    discipline = serializers.SlugRelatedField(
        slug_field='slug', queryset=Discipline.objects.filter(published=True), required=False, allow_null=True
    )
    branch = serializers.SlugRelatedField(
        slug_field='slug', queryset=Branch.objects.filter(published=True), required=False, allow_null=True
    )
    tag = serializers.SlugRelatedField(
        slug_field='slug', queryset=Tag.objects.filter(is_removed=False), required=False, allow_null=True
    )
    ref_exercise = serializers.PrimaryKeyRelatedField(
        queryset=Exercise.objects.filter(published=True), required=False, allow_null=True
    )
    ref_material = serializers.PrimaryKeyRelatedField(
        queryset=Material.objects.filter(published=True), required=False, allow_null=True
    )
    image = serializers.ImageField(required=False, allow_null=True)

    class Meta:
        model = Post
        fields = ['body', 'discipline', 'branch', 'tag', 'ref_exercise', 'ref_material', 'ref_course', 'image']

    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        from courses.models import Course

        # A reference must point at a course a stranger can actually open — never a draft.
        # (Declared here, not at class level: importing courses at module import time is the
        # direction this app otherwise avoids.)
        self.fields['ref_course'] = serializers.PrimaryKeyRelatedField(
            queryset=Course.objects.exclude(status='draft'), required=False, allow_null=True
        )

    def validate_body(self, value):
        if not value.strip():
            raise serializers.ValidationError('This field may not be blank.')
        return value

    def validate(self, attrs):
        instance = self.instance
        anchors = [
            attrs.get('discipline', getattr(instance, 'discipline', None)),
            attrs.get('branch', getattr(instance, 'branch', None)),
            attrs.get('tag', getattr(instance, 'tag', None)),
        ]
        if sum(1 for a in anchors if a is not None) != 1:
            raise serializers.ValidationError(
                {'anchor': ['Pick exactly one: a discipline, a branch, or a tag.']}
            )
        refs = [
            attrs.get('ref_exercise', getattr(instance, 'ref_exercise', None)),
            attrs.get('ref_material', getattr(instance, 'ref_material', None)),
            attrs.get('ref_course', getattr(instance, 'ref_course', None)),
        ]
        if sum(1 for r in refs if r is not None) > 1:
            raise serializers.ValidationError(
                {'reference': ['A post can reference at most one thing.']}
            )
        return attrs

    def save(self, **kwargs):
        # The uploaded bytes are never what gets stored — postimage.py explains why. An explicit
        # None (a PATCH clearing the picture) passes through as the removal it is.
        upload = self.validated_data.pop('image', serializers.empty)
        instance = super().save(**kwargs)
        if upload is not serializers.empty:
            instance.image = process_activity_post_image(upload) if upload is not None else None
            instance.save(update_fields=['image'])
        return instance


class ActivityEventSerializer(serializers.ModelSerializer):
    actor_display_name = serializers.SerializerMethodField()
    branch = serializers.SlugRelatedField(slug_field='slug', read_only=True)
    discipline = serializers.SlugRelatedField(slug_field='slug', read_only=True)
    tags = serializers.SerializerMethodField()
    # Embedded for kind='post' so the feed renders the post's own words/image without a second
    # round trip per row; null for every other kind.
    post_detail = PostSerializer(source='post', read_only=True)

    class Meta:
        model = ActivityEvent
        fields = [
            'id',
            'kind',
            'entry_kind',
            'actor',
            'actor_display_name',
            'target_label',
            'exercise',
            'material',
            'course',
            'happening',
            'service',
            'post',
            'post_detail',
            'branch',
            'discipline',
            'tags',
            'created_at',
        ]

    def get_actor_display_name(self, obj):
        return _display_name(obj.actor)

    def get_tags(self, obj):
        return [t.slug for t in obj.tags.all() if not t.is_removed]
