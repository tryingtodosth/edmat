"""Exercise resolves like everything else translatable (CLAUDE.md Section 10): ?lang= picks the
published translation for that locale, falling back to Exercise.original_locale, then to whatever
exists. `average_rating`/`review_count` are computed off the reverse `reviews` relation the
community app's Review model defines (related_name='reviews') — no import of community.models needed
here, Django wires the reverse accessor up automatically once that FK exists.

Phase 3 note: `branch_slug`/`submitted_by` are cheap and live on BOTH the List and Detail shape (a
plain FK id, or a value already available off the already-joined `course` row) — but `translated_by`/
`available_locales` (which need to walk every translation row for that exercise) are Detail-only,
same "Card is lightweight, Detail resolves the rest" split this project's own sibling apps already
establish: a 383-exercise course listing has no reason to pay for per-exercise translation-locale
resolution when nothing in that view ever reads it.
"""

from rest_framework import serializers

from config.i18n_utils import request_locale

from .models import (
    Exercise,
    ExerciseRequirement,
    ExerciseSource,
    ExerciseSourceTranslation,
    ExerciseTranslation,
    Tag,
    TagFollow,
)


class TagSerializer(serializers.ModelSerializer):
    class Meta:
        model = Tag
        fields = ['id', 'slug']


class TagFollowSerializer(serializers.ModelSerializer):
    tag = serializers.SlugRelatedField(slug_field='slug', read_only=True)

    class Meta:
        model = TagFollow
        fields = ['tag', 'notify']


class ExerciseRequirementSerializer(serializers.ModelSerializer):
    # `vote_summary`/`build_vote_summary` are the SAME shared implementation
    # `materials.serializers.MaterialRequirementSerializer` already uses (materials/services.py) —
    # reused directly, not a second, independently-drifting copy of the identical agree/disagree
    # weighting math, since both models share the exact same `.votes` shape.
    vote_summary = serializers.SerializerMethodField()

    class Meta:
        model = ExerciseRequirement
        fields = ['id', 'label', 'order', 'vote_summary']

    def get_vote_summary(self, obj):
        from materials.services import build_vote_summary

        votes = list(obj.votes.select_related('voter__profile'))
        return build_vote_summary(votes, self.context.get('request'))


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
    branch_slug = serializers.SlugRelatedField(source='branch', slug_field='slug', read_only=True)
    topics = serializers.PrimaryKeyRelatedField(many=True, read_only=True)
    # A plain SerializerMethodField, not a SlugRelatedField — a moderator-removed Tag
    # (`Tag.is_removed`, added alongside the tag/material/"skill tag" reporting feature) needs
    # filtering out for an ordinary reader. Filtered in PYTHON over the already-fetched `.all()`
    # list, not `.filter(is_removed=False)`, which would issue a fresh query and silently bypass
    # `ExerciseViewSet.bulk`'s own `prefetch_related('tags')` (the exact N+1 that prefetch exists to
    # avoid, same reasoning `_published_translations` above already documents for `translations`).
    tags = serializers.SerializerMethodField()
    source = ExerciseSourceSerializer(read_only=True)
    average_rating = serializers.FloatField(read_only=True, allow_null=True)
    review_count = serializers.IntegerField(read_only=True)

    class Meta:
        model = Exercise
        fields = [
            'id',
            'branch',
            'branch_slug',
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

    def get_tags(self, obj):
        return [t.slug for t in obj.tags.all() if not t.is_removed]

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
    # Detail-only, matching this class's own established "Card is lightweight, Detail resolves the
    # rest" split (module doc comment above) — a course listing has no reason to pay for resolving
    # every exercise's own requirement rows when nothing in that view ever reads them.
    requirements = serializers.SerializerMethodField()
    contributors = serializers.SerializerMethodField()

    class Meta(ExerciseListSerializer.Meta):
        fields = ExerciseListSerializer.Meta.fields + [
            'statement',
            'hint',
            'answer',
            'solution',
            'translated_by',
            'available_locales',
            'requirements',
            'contributors',
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

    def get_contributors(self, obj):
        """Everybody with a real account who worked on this exercise, named and in one list.

        An exercise genuinely has several: whoever submitted it, whoever wrote each locale's text,
        and whoever reviewed those. The page previously showed only the submitter — and since the
        imported corpus has no submitter at all, that meant most exercises credited nobody, which
        reads as "written by nobody" rather than "imported from a course archive".

        Roles rather than a flat list of people, because "translated this into Ukrainian" and
        "submitted it" are different claims and crediting them identically would be wrong. One row
        per person per role: somebody who translated two locales is named once per locale, since
        that is two pieces of work.

        Names are resolved here rather than left as bare ids for the client to fetch one by one —
        that was a real N+1 over the network on a page that already knows it needs them.
        """
        rows = []
        seen = set()

        def add(user, role, locale=None):
            if not user:
                return
            key = (user.pk, role, locale)
            if key in seen:
                return
            seen.add(key)
            profile = getattr(user, 'profile', None)
            rows.append(
                {
                    'id': user.pk,
                    'display_name': (
                        profile.display_name
                        if profile and profile.display_name
                        else user.username
                    ),
                    'role': role,
                    'locale': locale,
                }
            )

        add(obj.submitted_by, 'submitted')
        # Only translations that actually shipped: a pending suggestion is not yet a contribution to
        # what anybody is reading, and crediting it here would publish the fact that somebody made a
        # suggestion that has not been accepted. 'published' is the real value — the status vocabulary
        # here is published/pending/rejected, and guarding on 'approved' silently credited nobody.
        for translation in obj.translations.all():
            if translation.status != 'published':
                continue
            add(translation.translated_by, 'translated', translation.locale)
            add(translation.reviewed_by, 'reviewed', translation.locale)
        return rows

    def get_requirements(self, obj):
        # Filtered in Python over the `.all()` cache, not `.filter(is_removed=False)` — same
        # prefetch-cache-preserving reasoning `MaterialSerializer.get_requirements`/`get_tags`
        # already establish (materials/serializers.py).
        visible = [r for r in obj.requirements.all() if not r.is_removed]
        return ExerciseRequirementSerializer(visible, many=True, context=self.context).data

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


# --- covers / requires claims -------------------------------------------------------------------

from django.contrib.contenttypes.models import ContentType  # noqa: E402
from community.models import Comment  # noqa: E402
from materials.services import build_vote_summary  # noqa: E402
from taxonomy.serializers import SubtopicSerializer, TopicSerializer  # noqa: E402

from .models import ExerciseClaim  # noqa: E402


class ExerciseClaimSerializer(serializers.ModelSerializer):
    """Same wire shape as `MaterialCoverageSerializer`/`CourseClaimSerializer`, with `exercise` as
    the owner key — the frontend maps all three through one function."""

    topic = TopicSerializer(read_only=True)
    subtopic = SubtopicSerializer(read_only=True, allow_null=True)
    vote_summary = serializers.SerializerMethodField()
    importance_summary = serializers.SerializerMethodField()
    comment_count = serializers.SerializerMethodField()

    class Meta:
        model = ExerciseClaim
        fields = [
            'id', 'exercise', 'kind', 'topic', 'subtopic', 'level', 'proposed_by', 'created_at',
            'vote_summary', 'importance_summary', 'comment_count',
        ]

    def get_vote_summary(self, obj):
        return build_vote_summary(
            list(obj.votes.select_related('voter__profile')), self.context.get('request')
        )

    def get_importance_summary(self, obj):
        return build_vote_summary(
            list(obj.importance_votes.select_related('voter__profile')), self.context.get('request')
        )

    def get_comment_count(self, obj):
        return Comment.objects.filter(
            content_type=ContentType.objects.get_for_model(ExerciseClaim),
            object_id=obj.pk,
            is_removed=False,
        ).count()


class ExerciseClaimCreateSerializer(serializers.ModelSerializer):
    class Meta:
        model = ExerciseClaim
        fields = ['id', 'kind', 'topic', 'subtopic', 'level']
