"""CLAUDE.md Section 14's exercise-related endpoints, plus /api/exercises/random/ replicating the
frontend's own weighted-random algorithm (lib/services/exercises.ts's getRandomExercise, see
CLAUDE.md's "Random Exercise" feature note) byte-for-byte, so a future frontend swap-over changes
zero behavior, only the call site.
"""

import json
import random

from django.contrib.contenttypes.models import ContentType
from django.db.models import Avg, Count, Q
from rest_framework import permissions, status, viewsets
from rest_framework.decorators import action
from rest_framework.response import Response

from community.models import Comment, Review
from community.serializers import CommentSerializer, ReviewSerializer
from notifications.services import label_for_exercise, notify_comment_reply, notify_tag_followers

from .models import Exercise, Tag, TagFollow
from .serializers import (
    ExerciseDetailSerializer,
    ExerciseListSerializer,
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

    queryset = Tag.objects.all().order_by('slug')
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


def _filter_exercises(qs, params):
    course = params.get('course')
    if course:
        qs = qs.filter(course__slug=course)
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
    verified = params.get('verified')
    if verified in ('true', '1'):
        qs = qs.filter(verified=True)
    field = params.get('field')
    if field and not course:
        qs = qs.filter(course__field__slug=field)
    q = params.get('q')
    if q:
        qs = qs.filter(
            Q(translations__title__icontains=q) | Q(translations__statement__icontains=q)
        )
    return qs.distinct()


class ExerciseViewSet(viewsets.ModelViewSet):
    """GET /api/exercises/{id}/, GET /api/courses/{slug}/exercises/ is handled by
    taxonomy.CourseViewSet.exercises which just calls list() on this same queryset+filter logic;
    plus /translations/, /reviews/, /comments/, /random/ sub-endpoints per Section 14.
    """

    permission_classes = [permissions.IsAuthenticatedOrReadOnly]

    def get_queryset(self):
        qs = _annotated_exercises()
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
            qs = exercise.reviews.filter(is_removed=False, auto_hidden_at__isnull=True)
            serializer = ReviewSerializer(qs, many=True)
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
        # share one cache: `course_slug` resolves `obj.course.slug` (a plain FK, select_related),
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
            .select_related('course', 'source')
            .prefetch_related('translations', 'topics', 'tags', 'source__translations')
        )
        serializer = ExerciseDetailSerializer(qs, many=True, context={'request': request})
        return Response(serializer.data)
