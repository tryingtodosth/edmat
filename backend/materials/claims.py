"""The request handling a covers/requires claim shares whatever it is a claim about.

`MaterialViewSet.coverage` / `MaterialCoverageViewSet` and `CourseViewSet.claims` /
`CourseClaimViewSet` differ only in the owner row and the set of topics the owner admits; the
topic/subtopic resolution, the duplicate refusal, the two vote upserts and the thread rules are one
implementation here rather than two drifting copies.
"""

from django.contrib.contenttypes.models import ContentType
from rest_framework import status
from rest_framework.response import Response

from community.models import Comment
from community.serializers import CommentSerializer
from taxonomy.models import Subtopic, SubtopicTranslation

from .models import CLAIM_KIND_CHOICES

CLAIM_KINDS = [k for k, _ in CLAIM_KIND_CHOICES]


def resolve_claim_input(request, topics_qs):
    """Reads `kind`, `topic`, `subtopic` / `subtopic_slug` (+ `subtopic_name`, `locale`) off the
    request. Returns `(kind, topic, subtopic, None)` or `(None, None, None, error_response)`.
    `topics_qs` is the set of topics the owner admits — a material's own branch, a course's
    subject branches."""
    kind = request.data.get('kind') or 'covers'
    if kind not in CLAIM_KINDS:
        return None, None, None, Response(
            {'kind': ["Must be 'covers' or 'requires'."]}, status=status.HTTP_400_BAD_REQUEST
        )

    topic_id = request.data.get('topic')
    if not topic_id:
        return None, None, None, Response(
            {'topic': ['This field is required.']}, status=status.HTTP_400_BAD_REQUEST
        )
    try:
        topic = topics_qs.get(pk=topic_id)
    except (topics_qs.model.DoesNotExist, ValueError, TypeError):
        return None, None, None, Response(
            {'topic': ['Not a topic this can be claimed against.']},
            status=status.HTTP_400_BAD_REQUEST,
        )

    subtopic = None
    subtopic_id = request.data.get('subtopic')
    subtopic_slug = request.data.get('subtopic_slug')
    if subtopic_id:
        try:
            subtopic = Subtopic.objects.get(pk=subtopic_id, topic=topic)
        except (Subtopic.DoesNotExist, ValueError, TypeError):
            return None, None, None, Response(
                {'subtopic': ['Not a subtopic of the chosen topic.']},
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
    return kind, topic, subtopic, None


DUPLICATE_CLAIM = {
    'detail': (
        'This topic/subtopic pairing is already claimed here — discuss or vote on the existing one '
        'instead of proposing a duplicate.'
    )
}


def vote_response(request, claim, vote_model, fk_name, serializer_cls, *, labels):
    """POST `{value: 1|-1}` upserts this voter's row, DELETE removes it; either way the claim is
    returned freshly tallied. `labels` names the two values for the 400 message."""
    if not request.user.is_authenticated:
        return Response(status=status.HTTP_401_UNAUTHORIZED)
    lookup = {fk_name: claim, 'voter': request.user}
    if request.method == 'DELETE':
        vote_model.objects.filter(**lookup).delete()
    else:
        try:
            value = int(request.data.get('value'))
        except (TypeError, ValueError):
            value = None
        if value not in (1, -1):
            return Response(
                {'value': [f'Must be 1 ({labels[0]}) or -1 ({labels[1]}).']},
                status=status.HTTP_400_BAD_REQUEST,
            )
        vote_model.objects.update_or_create(**lookup, defaults={'value': value})
    return Response(serializer_cls(claim, context={'request': request}).data)


def thread_response(request, claim, *, on_created=None):
    """The claim's own discussion — the generic `Comment`, with the same same-thread `parent`
    check every other comment endpoint in this app applies."""
    content_type = ContentType.objects.get_for_model(claim)
    if request.method == 'GET':
        qs = Comment.objects.filter(content_type=content_type, object_id=claim.pk)
        return Response(
            CommentSerializer(
                qs.prefetch_related('votes'), many=True, context={'request': request}
            ).data
        )
    if not request.user.is_authenticated:
        return Response(status=status.HTTP_401_UNAUTHORIZED)
    serializer = CommentSerializer(data=request.data)
    serializer.is_valid(raise_exception=True)
    parent = serializer.validated_data.get('parent')
    if parent is not None and (
        parent.content_type_id != content_type.id or parent.object_id != claim.pk
    ):
        return Response(
            {'parent': ['This reply must belong to the same discussion.']},
            status=status.HTTP_400_BAD_REQUEST,
        )
    serializer.save(content_type=content_type, object_id=claim.pk, author=request.user)
    if on_created is not None:
        on_created(serializer.instance)
    return Response(serializer.data, status=status.HTTP_201_CREATED)
