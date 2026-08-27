"""GET /api/activity/ (the feed) and the anchored micro-posts' own endpoints.

The feed endpoint replaced community/views.py's placeholder `SiteActivityView` (root CLAUDE.md
§17AH) — same URL, now reading the stored, public-by-construction `ActivityEvent` table instead of
re-querying three source tables per page view. Bare array response, per this API's own convention.
"""

from rest_framework import permissions, status, viewsets
from rest_framework.decorators import action
from rest_framework.parsers import FormParser, JSONParser, MultiPartParser
from rest_framework.response import Response
from rest_framework.throttling import ScopedRateThrottle
from rest_framework.views import APIView

from materials.claims import thread_response
from moderation.permissions import feature_gate
from moderation.services import is_feature_enabled
from notifications.services import notify_comment_reply

from .models import ACTIVITY_KIND_CHOICES, Post
from .serializers import ActivityEventSerializer, PostCreateSerializer, PostSerializer
from .services import feed_events, record_activity, remove_activity_for

_VALID_KINDS = {kind for kind, _label in ACTIVITY_KIND_CHOICES}


class FeedView(APIView):
    """`?kind=&discipline=&branch=&tag=&followed=1&before=<id>&limit=` — public. `followed=1`
    narrows a signed-in reader to their followed tags + courses they are in; for a guest it is
    silently ignored rather than erroring (a shared link with the flag still renders)."""

    permission_classes = [permissions.AllowAny]

    def get(self, request):
        params = request.query_params
        kind = params.get('kind')
        if kind and kind not in _VALID_KINDS:
            kind = None
        try:
            before_id = int(params.get('before', '') or 0) or None
        except ValueError:
            before_id = None
        try:
            limit = int(params.get('limit', '') or 20)
        except ValueError:
            limit = 20
        events = feed_events(
            kind=kind,
            include_posts=is_feature_enabled('posts') or request.user.is_staff,
            discipline_slug=params.get('discipline') or None,
            branch_slug=params.get('branch') or None,
            tag_slug=params.get('tag') or None,
            followed_for=request.user if params.get('followed') in ('1', 'true') else None,
            before_id=before_id,
            limit=limit,
        )
        return Response(
            ActivityEventSerializer(events, many=True, context={'request': request}).data
        )


class PostCreateThrottle(ScopedRateThrottle):
    scope = 'post_create'


class PostViewSet(viewsets.GenericViewSet):
    """Create/retrieve/edit/delete one post, plus its comment thread. Publishing is immediate
    (bounded by the per-account throttle and the `posts` kill switch); "delete" is a TOMBSTONE
    (`is_removed`), the Comment precedent — replies hang off the generic thread with no FK to
    cascade, so a hard delete would orphan them, and any reported row must stay addressable."""

    queryset = Post.objects.select_related(
        'author__profile', 'discipline', 'branch', 'tag', 'ref_exercise', 'ref_material', 'ref_course'
    )
    serializer_class = PostSerializer
    permission_classes = [permissions.IsAuthenticatedOrReadOnly, feature_gate('posts')]
    parser_classes = [MultiPartParser, FormParser, JSONParser]

    def get_throttles(self):
        if self.action == 'create':
            return [PostCreateThrottle()]
        return super().get_throttles()

    def _serialized(self, post, request):
        return Response(PostSerializer(post, context={'request': request}).data)

    def create(self, request):
        if not request.user.is_authenticated:
            return Response(status=status.HTTP_401_UNAUTHORIZED)
        serializer = PostCreateSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        post = serializer.save(author=request.user)
        # The feed row — the whole reason a post exists. Tags: the anchor tag when that's the
        # anchor, so tag-followers' Followed view picks the post up.
        record_activity(
            'post',
            actor=request.user,
            target_label=post.body[:150],
            post=post,
            branch=post.branch,
            discipline=post.discipline or (post.branch.discipline if post.branch_id else None),
            tags=[post.tag] if post.tag_id else (),
        )
        return Response(
            PostSerializer(post, context={'request': request}).data,
            status=status.HTTP_201_CREATED,
        )

    def retrieve(self, request, pk=None):
        return self._serialized(self.get_object(), request)

    def partial_update(self, request, pk=None):
        post = self.get_object()
        if not request.user.is_authenticated:
            return Response(status=status.HTTP_401_UNAUTHORIZED)
        if not (request.user.is_staff or post.author_id == request.user.pk):
            return Response(status=status.HTTP_403_FORBIDDEN)
        if not post.is_visible_to_readers():
            return Response(
                {'detail': 'A removed post cannot be edited.'}, status=status.HTTP_409_CONFLICT
            )
        serializer = PostCreateSerializer(post, data=request.data, partial=True)
        serializer.is_valid(raise_exception=True)
        post = serializer.save()
        return self._serialized(post, request)

    def destroy(self, request, pk=None):
        post = self.get_object()
        if not request.user.is_authenticated:
            return Response(status=status.HTTP_401_UNAUTHORIZED)
        if not (request.user.is_staff or post.author_id == request.user.pk):
            return Response(status=status.HTTP_403_FORBIDDEN)
        post.is_removed = True
        post.save(update_fields=['is_removed'])
        remove_activity_for(post)
        return Response(status=status.HTTP_204_NO_CONTENT)

    @action(detail=True, methods=['get', 'post'])
    def comments(self, request, pk=None):
        post = self.get_object()

        def on_created(comment):
            # The feed row for this comment comes from activity/signals.py's Comment hook (the
            # one chokepoint for comment feed rows) — this callback only owes the notification.
            notify_comment_reply(
                comment,
                target_label=post.body[:150],
                post=post,
                # The post's author hears about top-level comments too — a comment under
                # somebody's post is a reply to a person, the same root_recipient reasoning
                # review threads already use.
                root_recipient=post.author,
            )

        return thread_response(request, post, on_created=on_created)
