"""Every taxonomy serializer resolves for a ?lang= locale, falling back to 'pl' (today's only real
original locale) when no translation exists for the requested one — same "resolve, fall back to
original" behavior CLAUDE.md Section 10 specifies for Exercise, applied here too since Discipline/
Branch/Topic/Chapter are translatable the same way. See config/i18n_utils.py for the shared helper.
"""

from rest_framework import serializers

from config.i18n_utils import request_locale, resolve_translation

from .counts import counts_for
from .models import Branch, Chapter, Discipline, Subtopic, Topic


class DisciplineSerializer(serializers.ModelSerializer):
    name = serializers.SerializerMethodField()
    description = serializers.SerializerMethodField()
    # How much is published under this node, per kind and audience band — every band, whatever the
    # reader's `?audience=`, so one cached list serves every lens (taxonomy/counts.py). Language-
    # agnostic: a row counts whichever language it is published in.
    counts = serializers.SerializerMethodField()

    class Meta:
        model = Discipline
        fields = ['id', 'slug', 'published', 'status', 'name', 'description', 'counts']

    def get_counts(self, obj):
        return counts_for(self.context, 'discipline', obj.pk)

    def get_name(self, obj):
        t = resolve_translation(obj.translations, request_locale(self.context))
        return t.name if t else obj.slug

    def get_description(self, obj):
        t = resolve_translation(obj.translations, request_locale(self.context))
        return t.description if t else ''


class BranchSerializer(serializers.ModelSerializer):
    name = serializers.SerializerMethodField()
    description = serializers.SerializerMethodField()
    discipline = serializers.SlugRelatedField(slug_field='slug', read_only=True)
    counts = serializers.SerializerMethodField()  # same shape and rule as DisciplineSerializer's

    class Meta:
        model = Branch
        fields = ['id', 'slug', 'discipline', 'published', 'status', 'order', 'name', 'description', 'counts']

    def get_counts(self, obj):
        return counts_for(self.context, 'branch', obj.pk)

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
        fields = ['id', 'slug', 'branch', 'order', 'status', 'name']

    def get_name(self, obj):
        t = resolve_translation(obj.translations, request_locale(self.context))
        return t.name if t else obj.slug


class SubtopicSerializer(serializers.ModelSerializer):
    """Nested inside MaterialCoverageSerializer (materials app) — not exposed as its own top-level
    /api/subtopics/ list endpoint, since a subtopic is only ever meaningful in the context of one
    topic (matching how Topic itself has no standalone list endpoint either, only nested inside a
    Branch's own detail response)."""

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
        fields = ['id', 'branch', 'number', 'start_page', 'topics', 'title']

    def get_title(self, obj):
        t = resolve_translation(obj.translations, request_locale(self.context))
        return t.title if t else f'Chapter {obj.number}'


class BranchDetailSerializer(BranchSerializer):
    topics = TopicSerializer(many=True, read_only=True)
    chapters = ChapterSerializer(many=True, read_only=True)

    class Meta(BranchSerializer.Meta):
        fields = BranchSerializer.Meta.fields + ['topics', 'chapters']
