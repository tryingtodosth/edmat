from django.contrib.contenttypes.models import ContentType
from django.db import transaction
from django.db.models import Max, Q
from rest_framework import permissions, status, viewsets
from rest_framework.decorators import action
from rest_framework.response import Response

from community.models import Comment
from community.serializers import CommentSerializer
from config.i18n_utils import request_locale
from moderation.services import is_governor_of_course
from notifications.services import notify_comment_reply
from taxonomy.models import Subtopic, SubtopicTranslation, Topic

from .models import (
    Material,
    MaterialCoverage,
    MaterialCoverageVote,
    MaterialRequirement,
    MaterialRequirementVote,
    MaterialReview,
    MaterialView,
)
from .serializers import (
    MaterialCoverageCreateSerializer,
    MaterialCoverageSerializer,
    MaterialRequirementSerializer,
    MaterialReviewSerializer,
    MaterialSerializer,
)
from .services import (
    _net_vote_weight,
    clean_requirement_labels,
    find_duplicate_requirement_label,
    get_recommended_materials,
    resolved_title,
)


def _notify_coverage_reply(comment, coverage):
    # No natural Exercise to link (a MaterialCoverage claim belongs to a Material, not an exercise)
    # — the label falls back to the material's own slug rather than a fully-localized title the way
    # label_for_exercise resolves one, an honest, functional simplification, not a full
    # per-locale-resolved title.
    label = f'{coverage.material.slug} — {coverage.topic.slug}'
    notify_comment_reply(comment, target_label=label)


def _notify_material_reply(comment, material, locale):
    # A whole-material discussion's own reply notification — the same "no natural Exercise to link,
    # fall back to a resolved title" shape `_notify_coverage_reply` above already establishes, just
    # one level up (the Material itself, not one specific coverage claim on it).
    notify_comment_reply(comment, target_label=resolved_title(material, locale), material=material)


# Mirrors exercises/views.py's own `_filter_exercises`/`_annotated_exercises` shape exactly — plain,
# mechanical query-building helpers living directly beside the ViewSet, not a FilterSet class. This
# is a deliberate consistency call, not an oversight: `django_filters` IS a project dependency and
# IS wired as the default REST_FRAMEWORK filter backend (config/settings.py), but grepping the whole
# codebase turns up zero actual `filterset_class`/`filterset_fields` usage anywhere — the backend's
# REAL established convention for "filter a list by query params" is this manual-Q-filter-function
# style, not django-filter's declarative FilterSet API. Following the established pattern literally
# (manual helpers) serves "don't invent a new filtering approach" better than introducing the ONE
# FilterSet class in an otherwise FilterSet-free codebase would.
#
# `topic_id` (new) — a Topic's own numeric PK, not a slug, unlike exercises' own `?topic=` filter
# (which reads a course-scoped SLUG). Topic slugs are only unique WITHIN one course
# (`unique_together = [('course', 'slug')]`, taxonomy/models.py) — the materials browse experience
# this filter backs is explicitly cross-course (GET /api/materials/, not just
# /api/courses/{slug}/materials/), so a slug alone would be ambiguous the moment two different
# courses both have, say, a topic called `granice`. The frontend's own Topic.id is already the bare
# numeric PK as a string (lib/api/mappers.ts's `mapTopic`), so no new id shape needed on that side.
def _filter_materials(qs, params):
    branch = params.get('branch')
    if branch:
        qs = qs.filter(branch__slug=branch)
    discipline = params.get('discipline')
    if discipline and not branch:
        qs = qs.filter(branch__discipline__slug=discipline)
    material_type = params.get('type')
    if material_type:
        qs = qs.filter(type=material_type)
    tag = params.get('tag')
    if tag:
        qs = qs.filter(tags__slug=tag)

    topic_id = params.get('topic_id')
    min_level = params.get('min_level')
    try:
        min_level_int = int(min_level) if min_level else None
    except (TypeError, ValueError):
        min_level_int = None

    if topic_id:
        coverage_filter = Q(coverage__topic_id=topic_id)
        if min_level_int is not None:
            coverage_filter &= Q(coverage__level__gte=min_level_int)
        qs = qs.filter(coverage_filter)
    elif min_level_int is not None:
        # No specific topic named — "any coverage claim at all reaches this depth," a coarser
        # "well-covered material" filter than the topic-scoped one above.
        qs = qs.filter(coverage__level__gte=min_level_int)

    q = params.get('q')
    if q:
        qs = qs.filter(
            Q(translations__title__icontains=q) | Q(translations__description__icontains=q)
        )
    return qs.distinct()


_SORT_KEYS = ('recent', 'level', 'votes', 'alphabetical')


def _sort_materials(materials, sort, locale, topic_id=None):
    """`materials` is already a concrete LIST by the time this runs, not a queryset — matching this
    codebase's own established "small real corpus, cheap to score/sort in Python" convention
    (MaterialCoverageSerializer's own doc comment already makes this exact call for its per-row vote
    aggregation) rather than a database-level ORDER BY for a scoring rule that depends on Python-side
    vote-weight math (`_net_vote_weight`) and per-locale title resolution anyway. `sort=None`/anything
    outside `_SORT_KEYS` leaves the list in whatever order the queryset itself already produced
    (Material's own `Meta.ordering = ['course', 'order']`) — unchanged default behavior, so no
    existing caller/test relying on that default order breaks.
    """
    if sort == 'recent':
        return sorted(materials, key=lambda m: m.created_at, reverse=True)
    if sort == 'alphabetical':
        return sorted(materials, key=lambda m: resolved_title(m, locale).casefold())
    if sort == 'level':
        def best_level(m):
            rows = m.coverage.all()
            if topic_id:
                rows = [r for r in rows if str(r.topic_id) == str(topic_id)]
            levels = [r.level for r in rows]
            return max(levels) if levels else -1

        return sorted(materials, key=best_level, reverse=True)
    if sort == 'votes':
        # Both votable claim types count toward "most community-vetted material" — coverage AND
        # requirement votes are the identical "the community verified this claim" signal, just cast
        # on two different kinds of row (materials/models.py's own MaterialRequirementVote doc
        # comment).
        def total_votes(m):
            return sum(_net_vote_weight(r) for r in m.coverage.all()) + sum(
                _net_vote_weight(req) for req in m.requirements.all()
            )

        return sorted(materials, key=total_votes, reverse=True)
    return materials


class MaterialViewSet(viewsets.ReadOnlyModelViewSet):
    """GET /api/materials/ — the cross-course materials browse/search/filter/sort endpoint; a
    course-scoped listing is ALSO available via /api/courses/{slug}/materials/
    (taxonomy.CourseViewSet.materials, which reuses `_filter_materials`/`_sort_materials` below
    rather than its own separate copy). Plus POST /api/materials/{id}/coverage/ to propose a new
    topic-subtopic-level claim, and GET /api/materials/recommended/ for the personalized feed (see
    that action's own doc comment, and materials/services.py, for the full reasoning).

    Query params on `list`: `course` (slug), `field` (slug, ignored if `course` is also given),
    `type` (MATERIAL_TYPE_CHOICES value), `tag` (slug), `topic_id` (a Topic's numeric PK — see
    `_filter_materials`'s own note on why not a slug), `min_level` (1-100, a coverage-depth floor),
    `q` (title/description text search, unchanged from before this overhaul — still what the
    tag-hover menu's "add to different content" picker uses), and `sort` (one of `_SORT_KEYS`;
    omitted/unrecognized keeps the existing `(course, order)` default).
    """

    queryset = Material.objects.filter(published=True).select_related('submitted_by__profile')
    serializer_class = MaterialSerializer

    def get_queryset(self):
        return _filter_materials(self.queryset, self.request.query_params)

    def list(self, request, *args, **kwargs):
        qs = self.filter_queryset(self.get_queryset())
        materials = list(
            qs.prefetch_related(
                'translations',
                'coverage__votes__voter__profile',
                'coverage__topic',
                'tags',
                'requirements__votes__voter__profile',
            )
        )
        materials = _sort_materials(
            materials,
            request.query_params.get('sort'),
            request_locale({'request': request}),
            topic_id=request.query_params.get('topic_id'),
        )
        serializer = self.get_serializer(materials, many=True)
        return Response(serializer.data)

    def retrieve(self, request, *args, **kwargs):
        """Records a real "view" the first time a signed-in user loads this material's own detail
        page — MaterialView (models.py), the exact same shape/reasoning
        ExerciseViewSet.retrieve's own ContentView tracking already established, just for Material.
        A guest visitor isn't tracked, same honesty as that sibling. Fetches the instance once (not
        via `super().retrieve()`, which would call `get_object()` a second time), matching that same
        precedent."""
        instance = self.get_object()
        if request.user.is_authenticated:
            MaterialView.objects.get_or_create(user=request.user, material=instance)
        serializer = self.get_serializer(instance)
        return Response(serializer.data)

    @action(detail=False, methods=['get'])
    def recommended(self, request):
        """GET /api/materials/recommended/?limit=12 — the materials search/filter/sort overhaul's
        own "genuine personalization dimension." Delegates entirely to
        materials/services.py's `get_recommended_materials` (see that module's own header comment
        for the full, honest reasoning: real engagement signals only, an explicit non-personalized
        fallback when none exist, never a fabricated ML ranking).

        Deliberately the ONE endpoint in this whole API that returns an OBJECT, `{personalized,
        results}`, not a bare array the way every other list endpoint in this app does (Phase 3's
        own established convention) — `personalized` is real, load-bearing information a plain
        array literally cannot carry: whether what follows is genuinely tailored to this visitor, or
        the platform's own honest, non-personalized default (a brand-new account or a guest has no
        real signal to personalize from yet, and this says so rather than quietly presenting a
        generic list as if it were personal). Flagged here as a deliberate, one-off exception to
        "bare array everywhere," not an oversight — no existing caller of any OTHER endpoint is
        affected, since this is a brand-new route with a brand-new frontend consumer.
        """
        limit_param = request.query_params.get('limit', '12')
        try:
            limit = max(1, min(int(limit_param), 50))
        except ValueError:
            limit = 12
        user = request.user if request.user.is_authenticated else None
        materials, personalized = get_recommended_materials(user, limit=limit)
        serializer = MaterialSerializer(materials, many=True, context={'request': request})
        return Response({'personalized': personalized, 'results': serializer.data})

    @action(detail=True, methods=['post'])
    def coverage(self, request, pk=None):
        """Propose a new (topic, subtopic?, level) coverage claim for this material — see
        MaterialCoverage's own doc comment (models.py) for why this is open to any authenticated
        user rather than moderation-gated, and why re-proposing an existing pairing is rejected
        rather than silently overwritten.

        Body: `topic` (PK, required, must belong to this material's own course), `level` (1-100,
        required), and EITHER `subtopic` (an existing Subtopic PK) OR `subtopic_slug` (+ optional
        `subtopic_name`/`locale`) to get-or-create one under the chosen topic on the fly — matching
        how a brand-new tag is created the first time someone proposes it, not a two-step "create
        the subtopic, then the coverage row" flow.
        """
        material = self.get_object()
        if not request.user.is_authenticated:
            return Response(status=status.HTTP_401_UNAUTHORIZED)

        topic_id = request.data.get('topic')
        if not topic_id:
            return Response({'topic': ['This field is required.']}, status=status.HTTP_400_BAD_REQUEST)
        try:
            topic = Topic.objects.get(pk=topic_id, branch=material.branch)
        except (Topic.DoesNotExist, ValueError, TypeError):
            return Response(
                {'topic': ["Not a topic of this material's own branch."]},
                status=status.HTTP_400_BAD_REQUEST,
            )

        subtopic = None
        subtopic_id = request.data.get('subtopic')
        subtopic_slug = request.data.get('subtopic_slug')
        if subtopic_id:
            try:
                subtopic = Subtopic.objects.get(pk=subtopic_id, topic=topic)
            except (Subtopic.DoesNotExist, ValueError, TypeError):
                return Response(
                    {'subtopic': ["Not a subtopic of the chosen topic."]},
                    status=status.HTTP_400_BAD_REQUEST,
                )
        elif subtopic_slug:
            subtopic, _created = Subtopic.objects.get_or_create(topic=topic, slug=subtopic_slug)
            subtopic_name = request.data.get('subtopic_name')
            if subtopic_name:
                locale = (
                    request.data.get('locale')
                    or getattr(getattr(request.user, 'profile', None), 'preferred_locale', None)
                    or 'en'
                )
                SubtopicTranslation.objects.update_or_create(
                    subtopic=subtopic, locale=locale, defaults={'name': subtopic_name}
                )

        if MaterialCoverage.objects.filter(material=material, topic=topic, subtopic=subtopic).exists():
            return Response(
                {
                    'detail': (
                        'This topic/subtopic pairing is already claimed for this material — '
                        'discuss or vote on the existing one instead of proposing a duplicate.'
                    )
                },
                status=status.HTTP_409_CONFLICT,
            )

        serializer = MaterialCoverageCreateSerializer(
            data={
                **request.data,
                'topic': topic.pk,
                'subtopic': subtopic.pk if subtopic else None,
            }
        )
        serializer.is_valid(raise_exception=True)
        coverage = serializer.save(material=material, proposed_by=request.user)
        return Response(
            MaterialCoverageSerializer(coverage, context={'request': request}).data,
            status=status.HTTP_201_CREATED,
        )

    @action(detail=True, methods=['post'], url_path='requirements/propose_requirement')
    def propose_requirement(self, request, pk=None):
        """POST /api/materials/{id}/requirements/propose_requirement/ — open to any authenticated
        user, the requirement-side counterpart to `coverage` above: "anyone can propose, the
        community votes" (materials/models.py's own MaterialRequirementVote doc comment) — a single
        new requirement, not a full-list replace, so proposing one never risks touching anyone
        else's already-existing rows. Originally this whole claim type was governor-only end to end
        (see `requirements` below, which still IS governor-only, for the reason that was the right
        call); opening just the PROPOSE half to everyone — while keeping bulk-reorder/removal a
        governor-only curation power — is the same asymmetry `coverage`'s own open-propose/
        governor-adjacent-nothing split already has no equivalent tension for, since coverage never
        had a separate governor-only edit path to begin with. A brand-new proposal starts with zero
        votes; the community's own agree/disagree signal (already-built `vote` action) is what
        actually surfaces or buries it from here, exactly like a freshly-proposed coverage claim.

        Body: `{"label": "English B2+"}`. Rejects (409, matching `coverage`'s own duplicate-pairing
        response) a label that's a case-insensitive match (after trim) of an EXISTING requirement —
        `find_duplicate_requirement_label` (materials/services.py), the same check the governor-only
        bulk replace and the submission-time draft both already enforce, reused here a third time
        rather than a fourth independent copy of the identical rule.
        """
        material = self.get_object()
        if not request.user.is_authenticated:
            return Response(status=status.HTTP_401_UNAUTHORIZED)

        label = clean_requirement_labels([request.data.get('label', '')])
        if not label:
            return Response({'label': ['This field is required.']}, status=status.HTTP_400_BAD_REQUEST)
        label = label[0]

        existing_labels = list(material.requirements.values_list('label', flat=True))
        if find_duplicate_requirement_label([*existing_labels, label]) is not None:
            return Response(
                {
                    'detail': (
                        'This requirement is already listed for this material — '
                        'vote on the existing one instead of proposing a duplicate.'
                    )
                },
                status=status.HTTP_409_CONFLICT,
            )

        next_order = (material.requirements.aggregate(Max('order'))['order__max'] or 0) + 1
        requirement = MaterialRequirement.objects.create(
            material=material, label=label, order=next_order
        )
        return Response(
            MaterialRequirementSerializer(requirement, context={'request': request}).data,
            status=status.HTTP_201_CREATED,
        )

    @action(detail=True, methods=['put'])
    def requirements(self, request, pk=None):
        """PUT /api/materials/{id}/requirements/ — a governor-only bulk replace of this ALREADY-
        PUBLISHED Material's own requirement list (reordering, removing, or renaming several at
        once) — a real curation power, distinct from `propose_requirement` above (open to anyone,
        adds exactly one). Gated by the exact same trust boundary every other moderator-adjacent
        Material mutation in this app already uses (global staff, or a governor of the material's
        own course — see moderation/services.py's `is_governor_of_course`).

        Body: `{"requirements": ["English B2+", "basic algebra", ...]}` — a full, ordered replace,
        not a single add/remove — the natural shape for a governor-facing list editor that always
        submits its own current full state, and one endpoint shape instead of a second one just for
        reordering.

        Rejects (400, not silently deduped) a body containing two labels that are the same after
        trim+casefold — `find_duplicate_requirement_label` (materials/services.py), shared with the
        identical check on the submission-side `requirements` field
        (moderation/serializers.py's own `validate_requirements`) so a brand-new submission can't
        sneak in duplicates any more than an already-published Material's own governor-facing edit
        can.

        The delete+recreate below runs inside `transaction.atomic()` — SQLite has no row-level
        locking (`select_for_update()` silently no-ops, the same lesson this app's own moderation
        race-condition work already learned the hard way, see CLAUDE.md Section 17I/17K), but a
        plain `atomic()` block still gives this specific delete+bulk_create pair the one property it
        actually needs: if `bulk_create` ever fails partway through, the preceding `delete()` rolls
        back with it, so a failed save can't leave a Material with ZERO requirements when it
        started with some. This is deliberately NOT the same `atomic()`-holds-a-full-exclusive-
        SQLite-write-lock trap Section 17I's own "select_for_update()/atomic() detour" note
        describes — that trap bit a MUCH slower, multi-statement apply sequence (several real
        queries, including cross-table resolution) held open for the whole transaction; this
        transaction is two fast, adjacent statements against one table, the same low-risk shape
        `ExerciseSetSerializer.update()`'s own transaction already uses elsewhere in this codebase.
        A concurrent double-PUT race (two governors racing the same Material's requirements at once)
        was reproduced once, not left purely theoretical — see CLAUDE.md's own writeup: no crash, no
        partial state, "last write wins" exactly as this full-replace endpoint's own docstring
        already promises.
        """
        material = self.get_object()
        if not request.user.is_authenticated:
            return Response(status=status.HTTP_401_UNAUTHORIZED)
        if not (request.user.is_staff or is_governor_of_course(request.user, material.branch)):
            return Response(status=status.HTTP_403_FORBIDDEN)

        labels = request.data.get('requirements', [])
        if not isinstance(labels, list):
            return Response(
                {'requirements': ['Must be a list of labels.']}, status=status.HTTP_400_BAD_REQUEST
            )
        cleaned = clean_requirement_labels(labels)
        duplicate = find_duplicate_requirement_label(cleaned)
        if duplicate is not None:
            return Response(
                {'requirements': [f'"{duplicate}" appears more than once in this list.']},
                status=status.HTTP_400_BAD_REQUEST,
            )

        with transaction.atomic():
            material.requirements.all().delete()
            MaterialRequirement.objects.bulk_create(
                MaterialRequirement(material=material, label=label, order=i)
                for i, label in enumerate(cleaned)
            )
        serializer = self.get_serializer(material)
        return Response(serializer.data)

    @action(detail=True, methods=['get', 'post'])
    def comments(self, request, pk=None):
        """A whole-Material discussion thread — the exact same generic Comment mechanism Exercise/
        Service already use, targeting the Material itself directly (`ContentType.get_for_model
        (Material)`), NOT the same thing as `MaterialCoverageViewSet.comments` below (that one is
        scoped to a single topic/subtopic coverage CLAIM; this is the material as a whole — "add
        discussions... to materials," a real, previously-missing top-level thread, distinct from
        the narrower per-claim one that already existed). Public GET (matching every other
        discussion thread in this app), auth-required POST, the same cross-target `parent`
        validation `ExerciseViewSet.comments`/`ServiceViewSet.comments` already enforce."""
        material = self.get_object()
        content_type = ContentType.objects.get_for_model(Material)
        if request.method == 'GET':
            qs = Comment.objects.filter(content_type=content_type, object_id=material.pk)
            serializer = CommentSerializer(qs, many=True)
            return Response(serializer.data)
        if not request.user.is_authenticated:
            return Response(status=status.HTTP_401_UNAUTHORIZED)
        serializer = CommentSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        parent = serializer.validated_data.get('parent')
        if parent is not None and (
            parent.content_type_id != content_type.id or parent.object_id != material.pk
        ):
            return Response(
                {'parent': ['This reply must belong to the same discussion.']},
                status=status.HTTP_400_BAD_REQUEST,
            )
        serializer.save(content_type=content_type, object_id=material.pk, author=request.user)
        _notify_material_reply(serializer.instance, material, request_locale({'request': request}))
        return Response(serializer.data, status=status.HTTP_201_CREATED)

    @action(detail=True, methods=['get', 'post'])
    def reviews(self, request, pk=None):
        """Star rating + optional written review on a Material — the same upsert-on-resubmit shape
        `ExerciseViewSet.reviews`/`ServiceViewSet.reviews` already establish (POSTing again updates
        your own existing review rather than creating a second row, since `MaterialReview` has the
        identical `unique_together = [('material', 'author')]`)."""
        material = self.get_object()
        if request.method == 'GET':
            qs = material.reviews.all()
            serializer = MaterialReviewSerializer(qs, many=True)
            return Response(serializer.data)
        if not request.user.is_authenticated:
            return Response(status=status.HTTP_401_UNAUTHORIZED)
        existing = MaterialReview.objects.filter(material=material, author=request.user).first()
        serializer = MaterialReviewSerializer(
            existing, data={**request.data, 'material': material.pk}, partial=existing is not None
        )
        serializer.is_valid(raise_exception=True)
        serializer.save(material=material, author=request.user)
        return Response(
            serializer.data, status=status.HTTP_201_CREATED if existing is None else status.HTTP_200_OK
        )


class MaterialRequirementViewSet(viewsets.GenericViewSet):
    """No list/retrieve of its own — a requirement row is always reached through its parent
    Material (embedded via MaterialSerializer.requirements), this ViewSet exists purely to host the
    one action that targets ONE specific requirement row: voting on whether it's actually needed —
    the exact same "is this claim accurate" community signal `MaterialCoverageViewSet.vote` already
    provides for a coverage row. Open to any authenticated user, matching that same precedent
    (voting is the community-verification layer for BOTH votable claim types; who may PROPOSE one
    stays asymmetric — coverage is open, requirements stay governor-only — but voting on an
    already-existing one of either kind is not)."""

    queryset = MaterialRequirement.objects.all()
    permission_classes = [permissions.IsAuthenticatedOrReadOnly]

    @action(detail=True, methods=['post', 'delete'])
    def vote(self, request, pk=None):
        requirement = self.get_object()
        if not request.user.is_authenticated:
            return Response(status=status.HTTP_401_UNAUTHORIZED)

        if request.method == 'DELETE':
            MaterialRequirementVote.objects.filter(requirement=requirement, voter=request.user).delete()
        else:
            try:
                value = int(request.data.get('value'))
            except (TypeError, ValueError):
                value = None
            if value not in (1, -1):
                return Response(
                    {'value': ['Must be 1 (agree) or -1 (disagree).']},
                    status=status.HTTP_400_BAD_REQUEST,
                )
            MaterialRequirementVote.objects.update_or_create(
                requirement=requirement, voter=request.user, defaults={'value': value}
            )

        serializer = MaterialRequirementSerializer(requirement, context={'request': request})
        return Response(serializer.data)


class MaterialCoverageViewSet(viewsets.GenericViewSet):
    """No list/retrieve of its own — a coverage row is always reached through its parent Material
    (embedded via MaterialSerializer.coverage), this ViewSet exists purely to host the two actions
    that target ONE specific coverage row: voting on whether its claimed level is accurate, and
    discussing it (reusing the existing generic Comment model — a MaterialCoverage is just another
    GenericForeignKey target, the same way Exercise/Material already are, no changes needed to
    Comment itself).
    """

    queryset = MaterialCoverage.objects.all()
    permission_classes = [permissions.IsAuthenticatedOrReadOnly]

    @action(detail=True, methods=['post', 'delete'])
    def vote(self, request, pk=None):
        coverage = self.get_object()
        if not request.user.is_authenticated:
            return Response(status=status.HTTP_401_UNAUTHORIZED)

        if request.method == 'DELETE':
            MaterialCoverageVote.objects.filter(coverage=coverage, voter=request.user).delete()
        else:
            try:
                value = int(request.data.get('value'))
            except (TypeError, ValueError):
                value = None
            if value not in (1, -1):
                return Response(
                    {'value': ['Must be 1 (agree) or -1 (disagree).']},
                    status=status.HTTP_400_BAD_REQUEST,
                )
            MaterialCoverageVote.objects.update_or_create(
                coverage=coverage, voter=request.user, defaults={'value': value}
            )

        serializer = MaterialCoverageSerializer(coverage, context={'request': request})
        return Response(serializer.data)

    @action(detail=True, methods=['get', 'post'])
    def comments(self, request, pk=None):
        coverage = self.get_object()
        content_type = ContentType.objects.get_for_model(MaterialCoverage)
        if request.method == 'GET':
            qs = Comment.objects.filter(content_type=content_type, object_id=coverage.pk)
            serializer = CommentSerializer(qs, many=True)
            return Response(serializer.data)
        if not request.user.is_authenticated:
            return Response(status=status.HTTP_401_UNAUTHORIZED)
        serializer = CommentSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        # A client-supplied `parent` genuinely threads (CommentSerializer already leaves it
        # writable, matching the sketch), but nothing used to stop it from naming a comment
        # belonging to an entirely DIFFERENT coverage row's (or a different content type's own)
        # thread — a real, if narrow, cross-target misattachment a client could otherwise cause.
        # Checked here, not in the serializer's own `validate()`, since `content_type`/`object_id`
        # aren't part of the client-submitted data at all (this view sets them itself, below) — the
        # serializer has no way to know what target it's about to be saved against until this point.
        parent = serializer.validated_data.get('parent')
        if parent is not None and (
            parent.content_type_id != content_type.id or parent.object_id != coverage.pk
        ):
            return Response(
                {'parent': ['This reply must belong to the same discussion.']},
                status=status.HTTP_400_BAD_REQUEST,
            )
        serializer.save(content_type=content_type, object_id=coverage.pk, author=request.user)
        _notify_coverage_reply(serializer.instance, coverage)
        return Response(serializer.data, status=status.HTTP_201_CREATED)
