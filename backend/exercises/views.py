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

from .models import Exercise, Tag
from .serializers import ExerciseDetailSerializer, ExerciseListSerializer, ExerciseTranslationSerializer, TagSerializer


class TagViewSet(viewsets.ReadOnlyModelViewSet):
    """GET /api/tags/ — distinct tag list across the whole corpus, backs the Random picker's own
    tag filter (CLAUDE.md's Random Exercise feature note)."""

    queryset = Tag.objects.all().order_by('slug')
    serializer_class = TagSerializer
    pagination_class = None


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
        serializer.save(content_type=content_type, object_id=exercise.pk, author=request.user)
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
