"""Every taxonomy serializer resolves for a ?lang= locale, falling back to 'pl' (today's only real
original locale) when no translation exists for the requested one — same "resolve, fall back to
original" behavior CLAUDE.md Section 10 specifies for Exercise, applied here too since Field/Course/
Topic/Chapter are translatable the same way. See config/i18n_utils.py for the shared helper.
"""

from rest_framework import serializers

from config.i18n_utils import request_locale, resolve_translation

from .models import Chapter, Course, Field, Subtopic, Topic


class FieldSerializer(serializers.ModelSerializer):
    name = serializers.SerializerMethodField()
    description = serializers.SerializerMethodField()

    class Meta:
        model = Field
        fields = ['id', 'slug', 'published', 'name', 'description']

    def get_name(self, obj):
        t = resolve_translation(obj.translations, request_locale(self.context))
        return t.name if t else obj.slug

    def get_description(self, obj):
        t = resolve_translation(obj.translations, request_locale(self.context))
        return t.description if t else ''


class CourseSerializer(serializers.ModelSerializer):
    name = serializers.SerializerMethodField()
    description = serializers.SerializerMethodField()
    field = serializers.SlugRelatedField(slug_field='slug', read_only=True)

    class Meta:
        model = Course
        fields = ['id', 'slug', 'field', 'university', 'published', 'order', 'name', 'description']

    def get_name(self, obj):
        t = resolve_translation(obj.translations, request_locale(self.context))
        return t.name if t else obj.slug

    def get_description(self, obj):
        t = resolve_translation(obj.translations, request_locale(self.context))
        return t.description if t else ''


class TopicSerializer(serializers.ModelSerializer):
    name = serializers.SerializerMethodField()

    class Meta:
        model = Topic
        fields = ['id', 'slug', 'course', 'order', 'name']

    def get_name(self, obj):
        t = resolve_translation(obj.translations, request_locale(self.context))
        return t.name if t else obj.slug


class SubtopicSerializer(serializers.ModelSerializer):
    """Nested inside MaterialCoverageSerializer (materials app) — not exposed as its own top-level
    /api/subtopics/ list endpoint, since a subtopic is only ever meaningful in the context of one
    topic (matching how Topic itself has no standalone list endpoint either, only nested inside a
    Course's own detail response)."""

    name = serializers.SerializerMethodField()

    class Meta:
        model = Subtopic
        fields = ['id', 'slug', 'topic', 'order', 'name']

    def get_name(self, obj):
        t = resolve_translation(obj.translations, request_locale(self.context))
        return t.name if t else obj.slug


class ChapterSerializer(serializers.ModelSerializer):
    title = serializers.SerializerMethodField()
    topics = serializers.PrimaryKeyRelatedField(many=True, read_only=True)

    class Meta:
        model = Chapter
        fields = ['id', 'course', 'number', 'start_page', 'topics', 'title']

    def get_title(self, obj):
        t = resolve_translation(obj.translations, request_locale(self.context))
        return t.title if t else f'Chapter {obj.number}'


class CourseDetailSerializer(CourseSerializer):
    topics = TopicSerializer(many=True, read_only=True)
    chapters = ChapterSerializer(many=True, read_only=True)

    class Meta(CourseSerializer.Meta):
        fields = CourseSerializer.Meta.fields + ['topics', 'chapters']
