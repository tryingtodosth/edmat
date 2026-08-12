"""CLAUDE.md Section 14's exercise-related endpoints, plus /api/exercises/random/ replicating the
frontend's own weighted-random algorithm (lib/services/exercises.ts's getRandomExercise, see
CLAUDE.md's "Random Exercise" feature note) byte-for-byte, so a future frontend swap-over changes
zero behavior, only the call site.
"""

import json
import random

from django.contrib.contenttypes.models import ContentType
from django.db import transaction
from django.db.models import Avg, Count, Max, Q
from rest_framework import permissions, status, viewsets
from rest_framework.decorators import action
from rest_framework.response import Response

from community.models import Comment, Review
from community.serializers import CommentSerializer, ReviewSerializer
from community.views import reply_counts_for
from moderation.services import is_governor_of_course
from notifications.services import label_for_exercise, notify_comment_reply, notify_tag_followers

from .models import Exercise, ExerciseRequirement, ExerciseRequirementVote, Tag, TagFollow
from .serializers import (
    ExerciseDetailSerializer,
    ExerciseListSerializer,
    ExerciseRequirementSerializer,
    ExerciseTranslationSerializer,
    TagFollowSerializer,
    TagSerializer,
)


def _notify_reply(comment, exercise):
    notify_comment_reply(comment, target_label=label_for_exercise(exercise), exercise=exercise)


# kind -> (model, the M2M-accessor attribute name on that model) — the one place the tag-hover
# menu's "apply to different content" action (below) and the notify_tag_followers call site both
# read from, so the two kinds this action supports can't quietly drift apart.
def _tag_target_model(kind):
    if kind == 'exercise':
        return Exercise
    if kind == 'material':
        from materials.models import Material

        return Material
    return None


class TagViewSet(viewsets.ReadOnlyModelViewSet):
    """GET /api/tags/ — distinct tag list across the whole corpus, backs the Random picker's own
    tag filter (CLAUDE.md's Random Exercise feature note). Plus the tag-hover action menu's own
    endpoints below (follow/unfollow, mute/unmute notifications on an existing follow, and applying
    the tag to a different piece of content) — `lookup_field = 'slug'` since every tag reference
    throughout this app (including the existing `?tag=` filter) is already slug-keyed, never the
    bare numeric pk `TagSerializer.id` also happens to expose.
    """

    # `is_removed=False` — a moderator-removed tag (the new tag-reporting feature) shouldn't be
    # browsable/searchable/appliable to new content anymore. Doesn't affect the moderation report
    # system itself: ReportActionView/build_report_queue (moderation/services.py) resolve a reported
    # Tag directly via REPORT_KIND_MODELS, never through this ViewSet's own queryset.
    queryset = Tag.objects.filter(is_removed=False).order_by('slug')
    serializer_class = TagSerializer
    pagination_class = None
    lookup_field = 'slug'

    def get_permissions(self):
        if self.action in ('list', 'retrieve'):
            return [permissions.AllowAny()]
        return [permissions.IsAuthenticated()]

    @action(detail=False, methods=['get'], url_path='my-follows')
    def my_follows(self, request):
        """GET /api/tags/my-follows/ — every tag the current user follows, plus whether they've
        muted notifications for that one specifically. The tag-hover menu's own source of truth for
        rendering "Following" vs. "Follow" without a per-tag round trip."""
        follows = TagFollow.objects.filter(user=request.user).select_related('tag')
        return Response(TagFollowSerializer(follows, many=True).data)

    @action(detail=True, methods=['post', 'delete'])
    def follow(self, request, slug=None):
        tag = self.get_object()
        if request.method == 'DELETE':
            TagFollow.objects.filter(user=request.user, tag=tag).delete()
            return Response(status=status.HTTP_204_NO_CONTENT)
        follow, _created = TagFollow.objects.get_or_create(user=request.user, tag=tag)
        return Response(TagFollowSerializer(follow).data, status=status.HTTP_201_CREATED)

    @action(detail=True, methods=['post'])
    def notify(self, request, slug=None):
        """POST /api/tags/{slug}/notify/ {"notify": bool} — mutes/unmutes notifications on an
        EXISTING follow, without unfollowing. 404 if the user isn't following this tag at all (the
        frontend's own menu only ever shows this control once already-following, so reaching this
        without a real follow row would itself be a real, worth-surfacing inconsistency, not
        something to silently paper over)."""
        tag = self.get_object()
        follow = TagFollow.objects.filter(user=request.user, tag=tag).first()
        if follow is None:
            return Response(status=status.HTTP_404_NOT_FOUND)
        follow.notify = bool(request.data.get('notify', True))
        follow.save(update_fields=['notify'])
        return Response(TagFollowSerializer(follow).data)

    @action(detail=True, methods=['post', 'delete'])
    def apply(self, request, slug=None):
        """POST/DELETE /api/tags/{slug}/apply/ {"kind": "exercise"|"material", "object_id": N} —
        the tag-hover menu's "add to different content" action: attach (or remove) this tag on
        another Exercise/Material. Open to any authenticated user, not moderation-gated — the same
        trust level MaterialCoverage's own community proposals already get (materials/models.py's
        own doc comment: additive, reversible, low-stakes organizational metadata, not content
        itself). Only the POST (add) path notifies followers — removing a tag isn't "new content."
        """
        tag = self.get_object()
        kind = request.data.get('kind')
        model = _tag_target_model(kind)
        if model is None:
            return Response({'kind': ["Must be 'exercise' or 'material'."]}, status=status.HTTP_400_BAD_REQUEST)
        try:
            target = model.objects.get(pk=request.data.get('object_id'))
        except (model.DoesNotExist, ValueError, TypeError):
            return Response({'object_id': ['No matching content found.']}, status=status.HTTP_400_BAD_REQUEST)

        if request.method == 'DELETE':
            target.tags.remove(tag)
            return Response(status=status.HTTP_204_NO_CONTENT)

        already_tagged = target.tags.filter(pk=tag.pk).exists()
        target.tags.add(tag)
        if not already_tagged:
            if kind == 'exercise':
                notify_tag_followers(tag, actor=request.user, exercise=target)
            else:
                notify_tag_followers(tag, actor=request.user, material=target)
        return Response(status=status.HTTP_201_CREATED)


def _annotated_exercises():
    # A hidden review (removed by a moderator, or auto-hidden pending one — community/models.py's
    # Review.is_removed/auto_hidden_at) must not pull the exercise's own average up or down, or
    # inflate its count — a plain queryset .filter() on the related field would instead drop the
    # whole EXERCISE from this query if none of its reviews matched, which isn't what's wanted here;
    # a conditional aggregate (filter= on Avg/Count) is what actually excludes just the hidden rows
    # from the calculation while keeping every exercise.
    visible_reviews = Q(reviews__is_removed=False, reviews__auto_hidden_at__isnull=True)
    return Exercise.objects.filter(published=True).annotate(
        average_rating=Avg('reviews__rating', filter=visible_reviews),
        review_count=Count('reviews', filter=visible_reviews, distinct=True),
    )


def _browse_exercises():
    """`_annotated_exercises()` plus everything the serializers then walk per row.

    Exactly the set `ExerciseViewSet.bulk` already worked out and measured — `branch` for the slug
    and `source` (a reverse OneToOne) both join; `translations` is what `_published_translations`
    reads via `.all()` specifically so a prefetch can serve it; `topics`/`tags` are resolved per
    object by DRF's own related fields; `source__translations` is one level further down again, for
    `ExerciseSourceSerializer.get_name`.

    Deliberately its own function rather than folding this into `_annotated_exercises()`, which
    would look tidier and would be a real regression: `random()` materialises the ENTIRE filtered
    pool with `list(...)` to weight it, so prefetching translations there would pull a translation
    row for all ~750 published exercises on every roll, to serialize exactly one of them.
    """
    return _annotated_exercises().select_related('branch', 'source').prefetch_related(
        'translations', 'topics', 'tags', 'source__translations'
    )


def _filter_exercises(qs, params):
    branch = params.get('branch')
    if branch:
        qs = qs.filter(branch__slug=branch)
    topic = params.get('topic')
    if topic:
        qs = qs.filter(topics__slug=topic)
    difficulty = params.get('difficulty')
    if difficulty:
        qs = qs.filter(difficulty=difficulty)
    source_type = params.get('source_type')
    if source_type:
        qs = qs.filter(source__type=source_type)
    tag = params.get('tag')
    if tag:
        qs = qs.filter(tags__slug=tag)
    # A user's own published exercise submissions — "what they were doing/contributing," a public
    # profile page's own new section (CLAUDE.md's tutoring-listings feature note, item 6). Already
    # scoped to `published=True` by `_annotated_exercises()` itself, so this never leaks a still-
    # pending/rejected submission to a stranger viewing someone else's profile.
    submitted_by = params.get('submitted_by')
    if submitted_by:
        qs = qs.filter(submitted_by_id=submitted_by)
    verified = params.get('verified')
    if verified in ('true', '1'):
        qs = qs.filter(verified=True)
    discipline = params.get('discipline')
    if discipline and not branch:
        qs = qs.filter(branch__discipline__slug=discipline)
    q = params.get('q')
    if q:
        # `ucontains`, not `icontains`: on SQLite the latter is case-insensitive for ASCII only, so
        # searching `zbieżność` never found a statement written `ZBIEŻNOŚĆ` — see config/dbsearch.py,
        # which also explains why this is a lookup rather than a rewritten query (it falls through to
        # `icontains` on PostgreSQL, where nothing is broken).
        qs = qs.filter(
            Q(translations__title__ucontains=q) | Q(translations__statement__ucontains=q)
        )
    return qs.distinct()


class ExerciseViewSet(viewsets.ModelViewSet):
    """GET /api/exercises/{id}/, GET /api/courses/{slug}/exercises/ is handled by
    taxonomy.CourseViewSet.exercises which just calls list() on this same queryset+filter logic;
    plus /translations/, /reviews/, /comments/, /random/ sub-endpoints per Section 14.
    """

    permission_classes = [permissions.IsAuthenticatedOrReadOnly]

    def get_queryset(self):
        qs = _browse_exercises()
        return _filter_exercises(qs, self.request.query_params)

    def get_serializer_class(self):
        if self.action == 'retrieve':
            return ExerciseDetailSerializer
        return ExerciseListSerializer

    def retrieve(self, request, *args, **kwargs):
        """Records a real "view" the first time a signed-in user loads this exercise's own detail
        page — moderation/models.py's ContentView, the denominator moderation/services.py's
        check_auto_hide divides a report count against. get_or_create rather than always creating a
        fresh row: this is meant to answer "how many distinct people have seen this," not "how many
        times has this been loaded," so a second visit by the same person doesn't inflate the count.
        A guest visitor isn't tracked at all — there's no identity to key a unique row on, same
        honesty ContentView's own doc comment already states. Fetches the instance once (not via
        `super().retrieve()`, which would call `get_object()` a second time) so this doesn't cost an
        extra query beyond the one a plain retrieve already makes.
        """
        instance = self.get_object()
        if request.user.is_authenticated:
            from moderation.models import ContentView

            ContentView.objects.get_or_create(user=request.user, exercise=instance)
        serializer = self.get_serializer(instance)
        return Response(serializer.data)

    def list(self, request, *args, **kwargs):
        qs = self.filter_queryset(self.get_queryset())
        sort = request.query_params.get('sort')
        if sort == 'top':
            qs = qs.order_by('-average_rating')
        elif sort == 'recent':
            qs = qs.order_by('-created_at')
        limit = request.query_params.get('limit')
        if limit:
            try:
                qs = qs[: int(limit)]
            except ValueError:
                pass
        serializer = self.get_serializer(qs, many=True)
        return Response(serializer.data)

    @action(detail=True, methods=['get', 'post'])
    def translations(self, request, pk=None):
        exercise = self.get_object()
        if request.method == 'GET':
            serializer = ExerciseTranslationSerializer(exercise.translations.all(), many=True)
            return Response(serializer.data)
        if not request.user.is_authenticated:
            return Response(status=status.HTTP_401_UNAUTHORIZED)
        serializer = ExerciseTranslationSerializer(data={**request.data, 'exercise': exercise.pk})
        serializer.is_valid(raise_exception=True)
        # Always 'pending', deliberately unconditional — the verified-contributor auto-publish policy
        # (CLAUDE.md Section 18 item 4, moderation/views.py's own ExerciseSubmissionViewSet.perform_create)
        # applies ONLY to a brand-new exercise, never to a translation, regardless of who submitted it.
        serializer.save(status='pending', translated_by=request.user)
        return Response(serializer.data, status=status.HTTP_201_CREATED)

    @action(detail=True, methods=['get', 'post'])
    def reviews(self, request, pk=None):
        exercise = self.get_object()
        if request.method == 'GET':
            # Unlike Comment (which preserves a hidden row as a blanked placeholder to keep reply
            # threading intact), a Review has no thread structure to preserve — a hidden one is
            # simply excluded outright, consistent with it also being excluded from
            # _annotated_exercises's own average_rating/review_count above (so the count shown here
            # always matches the number of rows actually returned).
            qs = list(exercise.reviews.filter(is_removed=False, auto_hidden_at__isnull=True))
            # One COUNT for the whole page rather than one per review — see reply_counts_for.
            serializer = ReviewSerializer(
                qs, many=True, context={'reply_counts': reply_counts_for(qs)}
            )
            return Response(serializer.data)
        if not request.user.is_authenticated:
            return Response(status=status.HTTP_401_UNAUTHORIZED)
        existing = Review.objects.filter(exercise=exercise, author=request.user).first()
        serializer = ReviewSerializer(
            existing, data={**request.data, 'exercise': exercise.pk}, partial=existing is not None
        )
        serializer.is_valid(raise_exception=True)
        serializer.save(exercise=exercise, author=request.user)
        return Response(serializer.data, status=status.HTTP_201_CREATED if existing is None else status.HTTP_200_OK)

    @action(detail=True, methods=['get', 'post'])
    def comments(self, request, pk=None):
        exercise = self.get_object()
        content_type = ContentType.objects.get_for_model(Exercise)
        if request.method == 'GET':
            qs = Comment.objects.filter(content_type=content_type, object_id=exercise.pk)
            serializer = CommentSerializer(qs, many=True)
            return Response(serializer.data)
        if not request.user.is_authenticated:
            return Response(status=status.HTTP_401_UNAUTHORIZED)
        serializer = CommentSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        # Same cross-target check materials/views.py's MaterialCoverageViewSet.comments now applies
        # — a client-supplied `parent` genuinely threads, but nothing used to stop it from naming a
        # comment belonging to an entirely different exercise's own thread.
        parent = serializer.validated_data.get('parent')
        if parent is not None and (
            parent.content_type_id != content_type.id or parent.object_id != exercise.pk
        ):
            return Response(
                {'parent': ['This reply must belong to the same discussion.']},
                status=status.HTTP_400_BAD_REQUEST,
            )
        serializer.save(content_type=content_type, object_id=exercise.pk, author=request.user)
        _notify_reply(serializer.instance, exercise)
        return Response(serializer.data, status=status.HTTP_201_CREATED)

    @action(detail=True, methods=['post'], url_path='requirements/propose_requirement')
    def propose_requirement(self, request, pk=None):
        """POST /api/exercises/{id}/requirements/propose_requirement/ — open to any authenticated
        user, the exact same "anyone can propose, the community votes" shape
        `materials.views.MaterialViewSet.propose_requirement` already establishes for a Material,
        applied here to Exercise for the first time. A single new requirement, not a full-list
        replace — `requirements` below (governor-only) stays the bulk-reorder/removal power."""
        from materials.services import clean_requirement_labels, find_duplicate_requirement_label

        exercise = self.get_object()
        if not request.user.is_authenticated:
            return Response(status=status.HTTP_401_UNAUTHORIZED)

        label = clean_requirement_labels([request.data.get('label', '')])
        if not label:
            return Response({'label': ['This field is required.']}, status=status.HTTP_400_BAD_REQUEST)
        label = label[0]

        existing_labels = list(exercise.requirements.values_list('label', flat=True))
        if find_duplicate_requirement_label([*existing_labels, label]) is not None:
            return Response(
                {
                    'detail': (
                        'This requirement is already listed for this exercise — '
                        'vote on the existing one instead of proposing a duplicate.'
                    )
                },
                status=status.HTTP_409_CONFLICT,
            )

        next_order = (exercise.requirements.aggregate(Max('order'))['order__max'] or 0) + 1
        requirement = ExerciseRequirement.objects.create(
            exercise=exercise, label=label, order=next_order
        )
        return Response(
            ExerciseRequirementSerializer(requirement, context={'request': request}).data,
            status=status.HTTP_201_CREATED,
        )

    @action(detail=True, methods=['put'])
    def requirements(self, request, pk=None):
        """PUT /api/exercises/{id}/requirements/ — a governor-only bulk replace of this exercise's
        own requirement list (reordering, removing, or renaming several at once), mirroring
        `materials.views.MaterialViewSet.requirements` exactly, including its own concurrency
        posture: wrapped in `transaction.atomic()` (two fast, adjacent statements against one
        table — the same low-risk shape that function's own docstring already reasons through, not
        the multi-statement, cross-table apply sequence CLAUDE.md's own node-governor race notes
        flag as the real SQLite `atomic()` trap), safe but not perfectly linearizable under genuine
        concurrent writes — an accepted, documented tradeoff, not a new one invented here.

        Body: `{"requirements": ["basic algebra", "epsilon-delta proofs", ...]}`.
        """
        from materials.services import clean_requirement_labels, find_duplicate_requirement_label

        exercise = self.get_object()
        if not request.user.is_authenticated:
            return Response(status=status.HTTP_401_UNAUTHORIZED)
        if not (request.user.is_staff or is_governor_of_course(request.user, exercise.branch)):
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
            exercise.requirements.all().delete()
            ExerciseRequirement.objects.bulk_create(
                ExerciseRequirement(exercise=exercise, label=label, order=i)
                for i, label in enumerate(cleaned)
            )

        # Explicitly the Detail serializer, not `self.get_serializer` — `get_serializer_class`
        # only returns it for `self.action == 'retrieve'`, and this action's own name isn't that,
        # so the plain List shape (no `requirements` field at all) would silently come back instead.
        serializer = ExerciseDetailSerializer(exercise, context={'request': request})
        return Response(serializer.data)

    @action(detail=False, methods=['get'])
    def random(self, request):
        """Mirrors frontend/src/lib/services/exercises.ts's getRandomExercise exactly: prefer an
        unseen exercise (falling back to the full filtered pool if everything's been seen), then a
        WEIGHTED random pick within that pool — weight = 1 + sum of the visitor's own view-count for
        each of the exercise's topics, so topics they've actually been reading come up more often
        without ever being a hard filter."""
        qs = _filter_exercises(_annotated_exercises(), request.query_params)
        candidates = list(qs.prefetch_related('topics'))
        if not candidates:
            return Response(status=status.HTTP_204_NO_CONTENT)

        seen_param = request.query_params.get('seen', '')
        seen_ids = {int(x) for x in seen_param.split(',') if x.strip().isdigit()}
        affinity_param = request.query_params.get('affinity', '{}')
        try:
            topic_affinity = json.loads(affinity_param)
        except (json.JSONDecodeError, TypeError):
            topic_affinity = {}

        unseen = [e for e in candidates if e.pk not in seen_ids]
        pool = unseen if unseen else candidates

        weights = [
            1 + sum(topic_affinity.get(t.slug, 0) for t in e.topics.all()) for e in pool
        ]
        total = sum(weights)
        roll = random.random() * total
        chosen = pool[-1]
        for exercise, weight in zip(pool, weights):
            roll -= weight
            if roll <= 0:
                chosen = exercise
                break

        serializer = ExerciseDetailSerializer(chosen, context={'request': request})
        return Response(serializer.data)

    @action(detail=False, methods=['get'])
    def bulk(self, request):
        """GET /api/exercises/bulk/?ids=1,2,3&lang=pl — Phase 4 hardening: closes a real, measured
        N+1 the moderation-queue load test found (198 pending edit-suggestions/translations meant
        115 individual GET /api/exercises/{id}/ round-trips from the frontend, ~10s of the page's
        own real load time — see CLAUDE.md's own writeup). ExerciseDetailSerializer, not the
        lighter List shape `list()` uses — a bulk resolve's own real callers (My Set's PDF export,
        the moderation queue's exercise-title lookups) both need at least the Detail shape's own
        fields (My Set genuinely needs the full statement/hint/answer/solution content to print;
        moderation only reads `.title`, but sharing one endpoint/mapper for both is simpler than a
        second, narrower one for a difference that's already this cheap). Does NOT call
        ContentView.get_or_create the way `retrieve()` does — a bulk resolve for a queue listing or
        a study sheet isn't a real "viewed this exercise's own detail page" event.
        """
        ids_param = request.query_params.get('ids', '')
        ids = [int(x) for x in ids_param.split(',') if x.strip().isdigit()]
        if not ids:
            return Response([])
        # select_related(...) + prefetch_related(...) — without these, ExerciseDetailSerializer
        # would still cost several queries PER ROW even after `_published_translations` was fixed to
        # share one cache: `branch_slug` resolves `obj.course.slug` (a plain FK, select_related),
        # `source` is a reverse OneToOne (also select_related), `topics`/`tags` are M2M fields DRF's
        # own PrimaryKeyRelatedField/SlugRelatedField resolve per object (prefetch_related), and
        # `source.translations` (ExerciseSourceSerializer.get_name) is its own separate reverse-FK
        # lookup one level further down. All of these together are what take this endpoint from "one
        # to several real queries per row" down to the fixed handful the whole bulk response costs
        # regardless of how many ids were requested — verified via a real CaptureQueriesContext
        # measurement, not assumed correct from reading the field list.
        qs = (
            _annotated_exercises()
            .filter(pk__in=ids)
            .select_related('branch', 'source')
            .prefetch_related(
                'translations', 'topics', 'tags', 'source__translations', 'requirements__votes__voter__profile'
            )
        )
        serializer = ExerciseDetailSerializer(qs, many=True, context={'request': request})
        return Response(serializer.data)


class ExerciseRequirementViewSet(viewsets.GenericViewSet):
    """No list/retrieve of its own — a requirement row is always reached through its parent
    Exercise (embedded via ExerciseDetailSerializer.requirements), mirroring
    `materials.views.MaterialRequirementViewSet` exactly, including its own reasoning: voting is
    open to any authenticated user (the community-verification layer for the claim), regardless of
    who may PROPOSE one in the first place (open) vs. bulk-edit an existing list (governor-only)."""

    queryset = ExerciseRequirement.objects.all()
    permission_classes = [permissions.IsAuthenticatedOrReadOnly]

    @action(detail=True, methods=['post', 'delete'])
    def vote(self, request, pk=None):
        requirement = self.get_object()
        if not request.user.is_authenticated:
            return Response(status=status.HTTP_401_UNAUTHORIZED)

        if request.method == 'DELETE':
            ExerciseRequirementVote.objects.filter(requirement=requirement, voter=request.user).delete()
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
            ExerciseRequirementVote.objects.update_or_create(
                requirement=requirement, voter=request.user, defaults={'value': value}
            )

        serializer = ExerciseRequirementSerializer(requirement, context={'request': request})
        return Response(serializer.data)
