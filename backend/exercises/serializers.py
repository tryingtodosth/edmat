"""Exercise resolves like everything else translatable (CLAUDE.md Section 10): ?lang= picks the
published translation for that locale, falling back to Exercise.original_locale, then to whatever
exists. `average_rating`/`review_count` are computed off the reverse `reviews` relation the
community app's Review model defines (related_name='reviews') — no import of community.models needed
here, Django wires the reverse accessor up automatically once that FK exists.

Phase 3 note: `course_slug`/`submitted_by` are cheap and live on BOTH the List and Detail shape (a
plain FK id, or a value already available off the already-joined `course` row) — but `translated_by`/
`available_locales` (which need to walk every translation row for that exercise) are Detail-only,
same "Card is lightweight, Detail resolves the rest" split this project's own sibling apps already
establish: a 383-exercise course listing has no reason to pay for per-exercise translation-locale
resolution when nothing in that view ever reads it.
"""

from rest_framework import serializers

from config.i18n_utils import request_locale

from .models import Exercise, ExerciseSource, ExerciseSourceTranslation, ExerciseTranslation, Tag, TagFollow


class TagSerializer(serializers.ModelSerializer):
    class Meta:
        model = Tag
        fields = ['id', 'slug']


class TagFollowSerializer(serializers.ModelSerializer):
    tag = serializers.SlugRelatedField(slug_field='slug', read_only=True)

    class Meta:
        model = TagFollow
        fields = ['tag', 'notify']


def _resolve_exercise_translation(exercise, locale, status='published'):
    """Only ever resolves a PUBLISHED translation for reader-facing endpoints — a pending or
    rejected translation is never shown to an ordinary reader, matching Section 10's "invisible to
    ordinary readers until a moderator flips it to published" rule."""
    qs = exercise.translations.filter(status=status)
    by_locale = {t.locale: t for t in qs}
    return (
        by_locale.get(locale)
        or by_locale.get(exercise.original_locale)
        or next(iter(by_locale.values()), None)
    )


class ExerciseSourceSerializer(serializers.ModelSerializer):
    name = serializers.SerializerMethodField()

    class Meta:
        model = ExerciseSource
        fields = ['type', 'collection', 'original_problem_number', 'pages', 'chapter', 'name']

    def get_name(self, obj):
        locale = request_locale(self.context)
        by_locale = {t.locale: t for t in obj.translations.all()}
        t = by_locale.get(locale) or next(iter(by_locale.values()), None)
        return t.name if t else ''


class ExerciseListSerializer(serializers.ModelSerializer):
    """Lightweight — a course/exercises listing and a random-pick result both use this shape, the
    Card-weight analogue described elsewhere in this project's own sibling apps' own conventions."""

    title = serializers.SerializerMethodField()
    resolved_locale = serializers.SerializerMethodField()
    course_slug = serializers.SlugRelatedField(source='course', slug_field='slug', read_only=True)
    topics = serializers.PrimaryKeyRelatedField(many=True, read_only=True)
    tags = serializers.SlugRelatedField(slug_field='slug', many=True, read_only=True)
    source = ExerciseSourceSerializer(read_only=True)
    average_rating = serializers.FloatField(read_only=True, allow_null=True)
    review_count = serializers.IntegerField(read_only=True)

    class Meta:
        model = Exercise
        fields = [
            'id',
            'course',
            'course_slug',
            'number',
            'topics',
            'difficulty',
            'tags',
            'published',
            'verified',
            'original_locale',
            'submitted_by',
            'title',
            'resolved_locale',
            'source',
            'average_rating',
            'review_count',
            'created_at',
        ]

    def _published_translations(self, obj):
        """✅ Phase 4 — the ONE place every title/locale/content-field resolve on this exercise
        reads from, replacing what used to be several independent calls to
        `_resolve_exercise_translation` (one for `title`, a separate one for `resolved_locale`, a
        third — cached only on `self`, see the note this replaced — for `statement`/`hint`/
        `answer`/`solution`/`translated_by`). Two real, found-before-they-shipped problems, both
        caught while adding `ExerciseViewSet.bulk` (the moderation-queue load test's own fix) — the
        first time this serializer was ever used with `many=True`:

        1. Caching on `self` (the old `ExerciseDetailSerializer._translation`) is silently WRONG
           under `many=True` — DRF's `ListSerializer` reuses ONE shared child serializer instance
           across every row, so every exercise past the first in a bulk response would have shown
           the FIRST exercise's own content. Caching on the per-row `obj` instead (a real, distinct
           object per row) fixes this at the actual source, not routed around in the new endpoint.
        2. `title`/`resolved_locale` (this class) previously called `_resolve_exercise_translation`
           directly and UNCACHED, each triggering its own fresh `exercise.translations.filter(...)`
           query — meaning even a single exercise cost 2-4 separate translation queries before this
           unification, on top of `get_available_locales`'s own separate query below.

        Reads `obj.translations.all()`, not `.filter(status='published')` — `.all()` is what lets
        this transparently use Django's `prefetch_related('translations')` cache when the caller's
        own queryset requested one (`ExerciseViewSet.bulk` does, specifically so 115 exercises cost
        ZERO extra queries here, not 115) while still working correctly, just with one real query
        per object, when it wasn't prefetched (`retrieve()`/`random()`, both single-object, where a
        prefetch would be pure overhead for no benefit).
        """
        if not hasattr(obj, '_cached_published_translations'):
            obj._cached_published_translations = [t for t in obj.translations.all() if t.status == 'published']
        return obj._cached_published_translations

    def _translation(self, obj):
        by_locale = {t.locale: t for t in self._published_translations(obj)}
        locale = request_locale(self.context)
        return by_locale.get(locale) or by_locale.get(obj.original_locale) or next(iter(by_locale.values()), None)

    def get_title(self, obj):
        t = self._translation(obj)
        return t.title if t else f'#{obj.number}'

    def get_resolved_locale(self, obj):
        t = self._translation(obj)
        return t.locale if t else obj.original_locale


class ExerciseDetailSerializer(ExerciseListSerializer):
    statement = serializers.SerializerMethodField()
    hint = serializers.SerializerMethodField()
    answer = serializers.SerializerMethodField()
    solution = serializers.SerializerMethodField()
    translated_by = serializers.SerializerMethodField()
    available_locales = serializers.SerializerMethodField()

    class Meta(ExerciseListSerializer.Meta):
        fields = ExerciseListSerializer.Meta.fields + [
            'statement',
            'hint',
            'answer',
            'solution',
            'translated_by',
            'available_locales',
        ]

    def get_statement(self, obj):
        t = self._translation(obj)
        return t.statement if t else ''

    def get_hint(self, obj):
        t = self._translation(obj)
        return t.hint if t else ''

    def get_answer(self, obj):
        t = self._translation(obj)
        return t.answer if t else ''

    def get_solution(self, obj):
        t = self._translation(obj)
        return t.solution if t else ''

    def get_translated_by(self, obj):
        t = self._translation(obj)
        return t.translated_by_id if t else None

    def get_available_locales(self, obj):
        """Every locale with at least one PUBLISHED translation, original locale first — mirrors
        lib/state/mockData.svelte.ts's own `resolveExercise` exactly (Phase 1's own reference
        implementation of this exact rule). Reads the same shared, per-object-cached, prefetch-
        cache-friendly `_published_translations` every other field above now reads too — no query
        of its own anymore."""
        published_locales = {t.locale for t in self._published_translations(obj)}
        rest = sorted(loc for loc in published_locales if loc != obj.original_locale)
        return [obj.original_locale, *rest] if obj.original_locale in published_locales else rest


class ExerciseTranslationSerializer(serializers.ModelSerializer):
    """GET lists every locale + its status (for the language picker, any status included — a
    moderator/the submitter themselves needs to see a still-pending one too); POST creates a new
    'pending' row (Section 14)."""

    class Meta:
        model = ExerciseTranslation
        fields = [
            'id',
            'exercise',
            'locale',
            'title',
            'statement',
            'hint',
            'answer',
            'solution',
            'status',
            'translated_by',
            'reviewed_by',
            'review_note',
            'created_at',
        ]
        read_only_fields = ['status', 'translated_by', 'reviewed_by', 'review_note', 'created_at']


class ExerciseSourceTranslationSerializer(serializers.ModelSerializer):
    class Meta:
        model = ExerciseSourceTranslation
        fields = ['id', 'source', 'locale', 'name']
