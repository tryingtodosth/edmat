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

from .models import Exercise, ExerciseSource, ExerciseSourceTranslation, ExerciseTranslation, Tag


class TagSerializer(serializers.ModelSerializer):
    class Meta:
        model = Tag
        fields = ['id', 'slug']


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

    def get_title(self, obj):
        t = _resolve_exercise_translation(obj, request_locale(self.context))
        return t.title if t else f'#{obj.number}'

    def get_resolved_locale(self, obj):
        t = _resolve_exercise_translation(obj, request_locale(self.context))
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

    def _translation(self, obj):
        if not hasattr(self, '_cached_translation'):
            self._cached_translation = _resolve_exercise_translation(obj, request_locale(self.context))
        return self._cached_translation

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
        implementation of this exact rule)."""
        published_locales = set(obj.translations.filter(status='published').values_list('locale', flat=True))
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
