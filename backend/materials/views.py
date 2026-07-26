from django.contrib.contenttypes.models import ContentType
from django.db.models import Q
from rest_framework import permissions, status, viewsets
from rest_framework.decorators import action
from rest_framework.response import Response

from community.models import Comment
from community.serializers import CommentSerializer
from notifications.services import notify_comment_reply
from taxonomy.models import Subtopic, SubtopicTranslation, Topic

from .models import Material, MaterialCoverage, MaterialCoverageVote
from .serializers import MaterialCoverageCreateSerializer, MaterialCoverageSerializer, MaterialSerializer


def _notify_coverage_reply(comment, coverage):
    # No natural Exercise to link (a MaterialCoverage claim belongs to a Material, not an exercise)
    # — the label falls back to the material's own slug rather than a fully-localized title the way
    # label_for_exercise resolves one, an honest, functional simplification, not a full
    # per-locale-resolved title.
    label = f'{coverage.material.slug} — {coverage.topic.slug}'
    notify_comment_reply(comment, target_label=label)


class MaterialViewSet(viewsets.ReadOnlyModelViewSet):
    """GET /api/materials/ — course-scoped listing is also available via
    /api/courses/{slug}/materials/ (taxonomy.CourseViewSet.materials). Plus POST
    /api/materials/{id}/coverage/ to propose a new topic-subtopic-level claim.

    `?q=` (new) — a title/description text search, mirroring `exercises/views.py`'s own
    `_filter_exercises` `Q(translations__title__icontains=q)` pattern exactly. Added specifically to
    back the tag-hover menu's "add to different content" picker, which needs SOME way to find a
    material target by name — the course-scoped listing above bypasses this ViewSet's own
    `get_queryset` entirely (a separate `course.materials.filter(...)` query), so this only ever
    affects a direct `GET /api/materials/?q=...` call, not that route.
    """

    queryset = Material.objects.filter(published=True)
    serializer_class = MaterialSerializer

    def get_queryset(self):
        qs = self.queryset
        q = self.request.query_params.get('q')
        if q:
            qs = qs.filter(
                Q(translations__title__icontains=q) | Q(translations__description__icontains=q)
            ).distinct()
        return qs

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
            topic = Topic.objects.get(pk=topic_id, course=material.course)
        except (Topic.DoesNotExist, ValueError, TypeError):
            return Response(
                {'topic': ["Not a topic of this material's own course."]},
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
        serializer.save(content_type=content_type, object_id=coverage.pk, author=request.user)
        _notify_coverage_reply(serializer.instance, coverage)
        return Response(serializer.data, status=status.HTTP_201_CREATED)
