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
    AUDIENCE_CHOICES,
    DIFFICULTY_CHOICES,
    SOURCE_TYPE_CHOICES,
    Exercise,
    ExercisePart,
    ExerciseRequirement,
    ExerciseSource,
    ExerciseSourceTranslation,
    ExerciseTranslation,
    SolutionEntry,
    SolutionEntryAttachment,
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


class SolutionEntryAttachmentSerializer(serializers.ModelSerializer):
    """`community.CommentAttachmentSerializer`'s twin, for the same reason the model is its
    twin — the client renders both through one component and a different field spelling would
    make that impossible."""

    url = serializers.SerializerMethodField()

    class Meta:
        model = SolutionEntryAttachment
        fields = ['id', 'kind', 'url', 'original_name', 'size_bytes']

    def get_url(self, a) -> str:
        if not a.file:
            return ''
        request = self.context.get('request')
        return request.build_absolute_uri(a.file.url) if request else a.file.url


class SolutionEntrySerializer(serializers.ModelSerializer):
    """One hint/solution in the pool (models.SolutionEntry). `vote_summary` is the same shared
    weighted math every claim/requirement vote already reads (materials/services.py);
    `comment_count` follows ExerciseClaimSerializer's own per-row COUNT precedent (a handful of
    entries per exercise, never a bulk-listed shape)."""

    author_display_name = serializers.SerializerMethodField()
    vote_summary = serializers.SerializerMethodField()
    comment_count = serializers.SerializerMethodField()
    attachments = SolutionEntryAttachmentSerializer(many=True, read_only=True)

    class Meta:
        model = SolutionEntry
        fields = [
            'id',
            'exercise',
            'part',
            'kind',
            'locale',
            'body',
            'blocks',
            'author',
            'author_display_name',
            'status',
            'pinned',
            'is_removed',
            'auto_hidden_at',
            'reviewed_by',
            'review_note',
            'vote_summary',
            'comment_count',
            'attachments',
            'licence',
            'created_at',
        ]
        read_only_fields = [
            'exercise',
            # Chosen at creation (`SolutionEntryCreateSerializer.part`); an entry does not move
            # between parts afterwards.
            'part',
            'author',
            'status',
            'pinned',
            # Changed only through `/api/licences/solution_entry/<id>/` (licensing/rules.py).
            'licence',
            'is_removed',
            'auto_hidden_at',
            'reviewed_by',
            'review_note',
            'created_at',
        ]

    def get_author_display_name(self, obj):
        if obj.author is None:
            return ''
        profile = getattr(obj.author, 'profile', None)
        return (profile.display_name if profile and profile.display_name else obj.author.username)

    def to_representation(self, instance):
        from config.blocks import SOLUTION_PROFILE, expand_blocks

        rep = super().to_representation(instance)
        rep['blocks'] = expand_blocks(
            instance.blocks or [],
            profile=SOLUTION_PROFILE,
            request=self.context.get('request'),
            cache=self.context.setdefault('_notebook_refs', {}),
        )
        return rep

    def get_vote_summary(self, obj):
        from materials.services import build_vote_summary

        # select_related over a bare .all(): _vote_weight reads each voter's profile, so without
        # the join this is one query PER VOTE — same call ExerciseRequirementSerializer makes.
        return build_vote_summary(
            list(obj.votes.select_related('voter__profile')), self.context.get('request')
        )

    def get_comment_count(self, obj):
        from django.contrib.contenttypes.models import ContentType

        from community.models import Comment

        return Comment.objects.filter(
            content_type=ContentType.objects.get_for_model(SolutionEntry),
            object_id=obj.pk,
            is_removed=False,
        ).count()


class SolutionEntryCreateSerializer(serializers.ModelSerializer):
    # Which part of a set-shaped exercise the entry is for; absent or null = the whole exercise
    # (`exercises/parts.py`). The exercise it must belong to comes from `context['exercise']` on a
    # POST, or from the row itself on a PATCH. `part_not_of_exercise` otherwise.
    part = serializers.PrimaryKeyRelatedField(
        queryset=ExercisePart.objects.all(), required=False, allow_null=True
    )

    class Meta:
        model = SolutionEntry
        # `licence` optional: absent is the model default `edmat-only`, which opens nothing.
        fields = ['kind', 'locale', 'body', 'blocks', 'licence', 'part']
        extra_kwargs = {'licence': {'required': False}, 'body': {'required': False, 'allow_blank': True}}

    #: A notebook solution (`config/blocks.py`); absent or `[]` is a plain one.
    blocks = serializers.JSONField(required=False)

    def validate_blocks(self, value):
        from config.blocks import SOLUTION_PROFILE, clean_blocks_for_api

        return clean_blocks_for_api(value, profile=SOLUTION_PROFILE)

    def validate(self, attrs):
        attrs = super().validate(attrs)
        # A body OR a notebook: the body of a notebook is derived in `SolutionEntry.save()`. On a
        # PATCH that sends neither, the row keeps what it has.
        has_blocks = bool(attrs.get('blocks'))
        if self.instance is None and not has_blocks and not (attrs.get('body') or '').strip():
            raise serializers.ValidationError({'body': ['This field may not be blank.']})
        if self.instance is not None and 'body' in attrs and not has_blocks:
            if not attrs['body'].strip():
                raise serializers.ValidationError({'body': ['This field may not be blank.']})
            # A plain edit of a notebook makes it plain: the person was handed one text box.
            attrs.setdefault('blocks', [])
        return attrs

    def validate_part(self, value):
        from .parts import part_refusal

        # On a PATCH an entry does not MOVE between parts (`part_immutable`, 400): a hint written
        # for (b) under (c) would be wrong, and its votes and review were for (b). Sending the part
        # it already has is not a move, and is accepted as a no-op.
        if self.instance is not None:
            if (value.pk if value is not None else None) != self.instance.part_id:
                raise serializers.ValidationError('part_immutable')
            return value
        exercise = self.context.get('exercise') or (self.instance.exercise if self.instance else None)
        if exercise is None and value is not None:
            raise serializers.ValidationError('part_not_of_exercise')
        reason = part_refusal(exercise, value) if exercise is not None else None
        if reason:
            raise serializers.ValidationError(reason)
        return value

    def validate_licence(self, value):
        from licensing.licences import licence_validation_error

        reason = licence_validation_error(value)
        if reason:
            raise serializers.ValidationError(reason)
        return value

    def validate_locale(self, value):
        if not value.strip():
            raise serializers.ValidationError('This field may not be blank.')
        return value.strip()


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
            'audience',
            'licence',
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


class ExercisePartSerializer(serializers.ModelSerializer):
    """One part of a set-shaped exercise, its text resolved for `?lang=` exactly as the statement
    is (`exercises/parts.py: part_text`). `[]` on an exercise without parts."""

    statement = serializers.SerializerMethodField()
    answer = serializers.SerializerMethodField()
    resolved_locale = serializers.SerializerMethodField()

    class Meta:
        model = ExercisePart
        fields = ['id', 'label', 'order', 'statement', 'answer', 'resolved_locale']

    def _text(self, obj):
        from .parts import part_text

        return part_text(obj, request_locale(self.context))

    def get_statement(self, obj):
        t = self._text(obj)
        return t.statement if t else ''

    def get_answer(self, obj):
        t = self._text(obj)
        return t.answer if t else ''

    def get_resolved_locale(self, obj):
        t = self._text(obj)
        return t.locale if t else obj.exercise.original_locale


class ExerciseDetailSerializer(ExerciseListSerializer):
    statement = serializers.SerializerMethodField()
    answer = serializers.SerializerMethodField()
    # The parts of a set-shaped exercise (`SUBEXERCISES-BRIEF.md`), in order; entries carry
    # `part` so the page can group each part's hints, answer and solutions under its label.
    parts = serializers.SerializerMethodField()
    # The solution/hint pool, replacing the old per-translation `hint`/`solution` text fields —
    # ALL locales, sorted pinned-first then net vote score, visibility resolved per caller
    # (a pending entry is included for its own author and for reviewers; see
    # entries.visible_entries). The frontend groups by locale itself.
    entries = serializers.SerializerMethodField()
    translated_by = serializers.SerializerMethodField()
    available_locales = serializers.SerializerMethodField()
    can_edit = serializers.SerializerMethodField()
    # Detail-only, matching this class's own established "Card is lightweight, Detail resolves the
    # rest" split (module doc comment above) — a course listing has no reason to pay for resolving
    # every exercise's own requirement rows when nothing in that view ever reads them.
    requirements = serializers.SerializerMethodField()
    contributors = serializers.SerializerMethodField()
    # The licence of the TEXT being shown — differs from `licence` only when the reader is shown
    # somebody else's translation, which carries the licence it was contributed under.
    text_licence = serializers.SerializerMethodField()

    class Meta(ExerciseListSerializer.Meta):
        fields = ExerciseListSerializer.Meta.fields + [
            'statement',
            'answer',
            'parts',
            'entries',
            'text_licence',
            'translated_by',
            'available_locales',
            'requirements',
            'contributors',
            'can_edit',
        ]

    def get_can_edit(self, obj) -> bool:
        """Whether the caller may edit this exercise in place (`exercises/editing.py`) — the one
        question the page's "Edit" link asks, answered by the rule rather than re-derived from
        `submitted_by` in the browser."""
        from .editing import can_edit

        request = self.context.get('request')
        return can_edit(getattr(request, 'user', None), obj)

    def get_statement(self, obj):
        t = self._translation(obj)
        return t.statement if t else ''

    def get_answer(self, obj):
        t = self._translation(obj)
        return t.answer if t else ''

    def get_parts(self, obj):
        from django.db.models import prefetch_related_objects

        from .parts import parts_of

        # Two queries for every part and its text, rather than one per part — unless the caller's
        # queryset already prefetched them.
        if 'parts' not in getattr(obj, '_prefetched_objects_cache', {}):
            prefetch_related_objects([obj], 'parts__translations')
        return ExercisePartSerializer(parts_of(obj), many=True, context=self.context).data

    def get_entries(self, obj):
        from .entries import sort_entries, visible_entries

        request = self.context.get('request')
        user = request.user if request is not None else None
        rows = sort_entries(visible_entries(obj, user))
        return SolutionEntrySerializer(rows, many=True, context=self.context).data

    def get_translated_by(self, obj):
        t = self._translation(obj)
        return t.translated_by_id if t else None

    def get_text_licence(self, obj):
        t = self._translation(obj)
        return (t.licence or obj.licence) if t else obj.licence

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
            'answer',
            'status',
            'translated_by',
            'reviewed_by',
            'review_note',
            'licence',
            'created_at',
        ]
        # `licence` is never chosen: a translation is a derivative (ExerciseTranslation.save()).
        read_only_fields = ['status', 'translated_by', 'reviewed_by', 'review_note', 'licence', 'created_at']


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


# --- exercise ↔ material links -------------------------------------------------------------------
#
# Two serializers for one model, because the two pages read the row from opposite ends: the material
# page wants the EXERCISE embedded, the exercise page wants the MATERIAL. Neither embeds both — a
# material's own claim rows and an exercise's own translation walk are each paid for once, and
# putting both on one shape would make every row of either list carry the other side for nothing.

from materials.serializers import MaterialSerializer  # noqa: E402

from .models import ExerciseMaterialLink  # noqa: E402


def _link_display_name(user):
    if user is None:
        return None
    profile = getattr(user, 'profile', None)
    return profile.display_name if profile and profile.display_name else user.username


class ExerciseMaterialLinkSerializer(serializers.ModelSerializer):
    """`GET/POST /api/materials/{id}/exercises/` — one linked exercise, in the LIST shape the
    exercise cards already render, resolved for `?lang=` like every other list on the site.

    `exercise` is the shared `ExerciseListSerializer`, so the card on a material page is the same
    card as in a branch listing; the view is responsible for handing this serializer exercises off
    an ANNOTATED queryset (`average_rating`/`review_count` are annotations, not columns).
    """

    exercise = ExerciseListSerializer(read_only=True)
    added_by_id = serializers.PrimaryKeyRelatedField(source='added_by', read_only=True)
    added_by_display_name = serializers.SerializerMethodField()

    class Meta:
        model = ExerciseMaterialLink
        fields = [
            'id',
            'role',
            'locator',
            'added_by_id',
            'added_by_display_name',
            'created_at',
            'exercise',
        ]

    def get_added_by_display_name(self, obj):
        # `None`, not '', when nobody is attached — the same distinction MaterialSerializer's own
        # `submitted_by_display_name` draws between "no real person" and "a person with a blank name".
        return _link_display_name(obj.added_by)


class MaterialLinkForExerciseSerializer(serializers.ModelSerializer):
    """`GET /api/exercises/{id}/materials/` — the same row read from the exercise's end, so the
    exercise page can say "From material …". Published materials only; the view filters."""

    material = MaterialSerializer(read_only=True)
    added_by_id = serializers.PrimaryKeyRelatedField(source='added_by', read_only=True)

    class Meta:
        model = ExerciseMaterialLink
        fields = ['id', 'role', 'locator', 'added_by_id', 'created_at', 'material']


class ExerciseMaterialLinkWriteSerializer(serializers.ModelSerializer):
    """What a PATCH may change: which claim the row makes, and where in the material it points.
    Never the pair itself — re-pointing a link at a different exercise is a delete and a new link,
    not an edit, or the `added_by` credit would follow a claim nobody made."""

    class Meta:
        model = ExerciseMaterialLink
        fields = ['role', 'locator']


class ExerciseSourceEditSerializer(serializers.Serializer):
    type = serializers.ChoiceField(choices=SOURCE_TYPE_CHOICES)
    name = serializers.CharField(max_length=300, required=False, allow_blank=True, default='')
    collection = serializers.CharField(max_length=200, required=False, allow_blank=True, default='')
    original_problem_number = serializers.IntegerField(required=False, allow_null=True, min_value=1, default=None)
    pages = serializers.CharField(max_length=20, required=False, allow_blank=True, default='')
    chapter = serializers.IntegerField(required=False, allow_null=True, min_value=1, default=None)


class ExercisePartEditSerializer(serializers.Serializer):
    """One item of `PATCH /api/exercises/{id}/`'s `parts` list: a missing `id` creates the part, a
    known one updates it (`exercises/parts.py: apply_parts`). `label` and `statement` required,
    `answer` may be blank; the list's position is the part's order."""

    id = serializers.IntegerField(required=False, allow_null=True)
    label = serializers.CharField(max_length=20)
    statement = serializers.CharField()
    answer = serializers.CharField(required=False, allow_blank=True, default='')


class ExerciseEditSerializer(serializers.Serializer):
    """`PATCH /api/exercises/{id}/` by the author or staff (`exercises/editing.py`). Every field
    is optional; what arrives is what changes. Text goes onto the original-locale translation and
    is recorded as an approved `EditSuggestion`; the rest goes onto the row."""

    title = serializers.CharField(max_length=300, required=False)
    statement = serializers.CharField(required=False)
    answer = serializers.CharField(required=False, allow_blank=True)
    difficulty = serializers.ChoiceField(choices=DIFFICULTY_CHOICES, required=False)
    audience = serializers.ChoiceField(choices=AUDIENCE_CHOICES, required=False)
    topic_ids = serializers.ListField(child=serializers.IntegerField(), required=False)
    tags = serializers.ListField(child=serializers.CharField(max_length=80, allow_blank=True), required=False)
    source = ExerciseSourceEditSerializer(required=False)
    # The WHOLE list of parts as the form now has them (`SUBEXERCISES-BRIEF.md` §4): absent leaves
    # the parts alone; `[]` deletes every one. Refusal words: `exercises/parts.py:
    # parts_payload_refusal` (`parts_too_many`, `part_not_of_exercise`, `part_label_duplicate`).
    parts = ExercisePartEditSerializer(many=True, required=False)

    TEXT_FIELDS = ('title', 'statement', 'answer')

    def validate_parts(self, value):
        from .parts import parts_payload_refusal

        reason = parts_payload_refusal(self.context['exercise'], value)
        if reason:
            raise serializers.ValidationError(reason)
        return value

    def validate_topic_ids(self, value):
        exercise = self.context['exercise']
        wanted = set(value)
        known = set(exercise.branch.topics.filter(pk__in=wanted).values_list('pk', flat=True))
        if wanted - known:
            raise serializers.ValidationError('topics_not_in_branch')
        return sorted(wanted)

    def validate_tags(self, value):
        from .tags import clean_name, fold, matching_tag

        slugs, out = set(), []
        for raw in value:
            name = clean_name(raw)
            if not name:
                continue
            existing = matching_tag(name)
            if existing is not None and existing.is_removed:
                raise serializers.ValidationError('tag_removed')
            slug = existing.slug if existing is not None else fold(name)[:50].strip('-')
            if slug and slug not in slugs:
                slugs.add(slug)
                out.append(slug)
        return out

    def apply(self, exercise, user):
        from django.db import transaction

        from moderation.models import EditSuggestion
        from notifications.services import notify_tag_followers

        data = self.validated_data
        with transaction.atomic():
            text = {f: data[f] for f in self.TEXT_FIELDS if f in data}
            if text:
                translation, _ = ExerciseTranslation.objects.get_or_create(
                    exercise=exercise, locale=exercise.original_locale, status='published',
                    defaults={'title': ''},
                )
                changed = [f for f, v in text.items() if getattr(translation, f) != v]
                for f in changed:
                    setattr(translation, f, text[f])
                if changed:
                    translation.save(update_fields=changed)
                    for f in changed:
                        EditSuggestion.objects.create(
                            exercise=exercise, locale=exercise.original_locale, field=f,
                            proposed_value=getattr(translation, f), reason='', submitted_by=user,
                            status='approved', reviewed_by=user,
                        )
            structural = [f for f in ('difficulty', 'audience') if f in data]
            for f in structural:
                setattr(exercise, f, data[f])
            if structural:
                exercise.save(update_fields=structural)
            if 'topic_ids' in data:
                exercise.topics.set(data['topic_ids'])
            if 'tags' in data:
                before = set(exercise.tags.values_list('slug', flat=True))
                tags = [Tag.objects.get_or_create(slug=slug)[0] for slug in data['tags']]
                exercise.tags.set(tags)
                for tag in tags:
                    if tag.slug not in before:
                        notify_tag_followers(tag, actor=user, exercise=exercise)
            if 'source' in data:
                src = dict(data['source'])
                name = src.pop('name', '')
                source, _ = ExerciseSource.objects.update_or_create(exercise=exercise, defaults=src)
                ExerciseSourceTranslation.objects.update_or_create(
                    source=source, locale=exercise.original_locale, defaults={'name': name}
                )
            if 'parts' in data:
                from .parts import apply_parts

                apply_parts(exercise, data['parts'], user)
        return exercise
