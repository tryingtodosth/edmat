"""GET /api/activity/ (the feed) and the anchored micro-posts' own endpoints.

The feed endpoint replaced community/views.py's placeholder `SiteActivityView` (root CLAUDE.md
§17AH) — same URL, now reading the stored, public-by-construction `ActivityEvent` table instead of
re-querying three source tables per page view. Bare array response, per this API's own convention.
"""

from accounts.minors import hold_for_review, should_hold_post
from rest_framework import permissions, status, viewsets
from rest_framework.decorators import action
from rest_framework.parsers import FormParser, JSONParser, MultiPartParser
from rest_framework.response import Response
from rest_framework.throttling import ScopedRateThrottle, UserRateThrottle
from rest_framework.views import APIView

from materials.claims import thread_response
from moderation.permissions import feature_gate
from moderation.services import is_feature_enabled
from notifications.services import notify_comment_reply

from config.content_locale import HIDDEN_HEADER

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
        try:
            topic_id = int(params.get('topic', '') or 0) or None
        except ValueError:
            topic_id = None
        events, hidden = feed_events(
            kind=kind,
            include_posts=is_feature_enabled('posts') or request.user.is_staff,
            discipline_slug=params.get('discipline') or None,
            branch_slug=params.get('branch') or None,
            tag_slug=params.get('tag') or None,
            topic_id=topic_id,
            followed_for=request.user if params.get('followed') in ('1', 'true') else None,
            content_locales_params=params,
            before_id=before_id,
            limit=limit,
        )
        response = Response(
            ActivityEventSerializer(events, many=True, context={'request': request}).data
        )
        response[HIDDEN_HEADER] = str(hidden)
        return response


class PostCreateThrottle(ScopedRateThrottle):
    scope = 'post_create'


class TagCreateThrottle(UserRateThrottle):
    """Minting a NEW tag while asking (`exercises/tags.py`). Asked by hand, and only when a new
    row is about to be written — reusing an existing tag never spends it.

    A `UserRateThrottle` with its own scope, NOT a `ScopedRateThrottle`: the scoped class reads its
    scope from the VIEW's `throttle_scope` and allows everything when the view has none, whatever
    the subclass's own `scope` says — which is what `PostCreateThrottle` above does today (this
    viewset sets no `throttle_scope`, so `post_create` is never counted; WP16 report, left open)."""

    scope = 'tag_create'


# How each refusal from `exercises/tags.py: create_tag_from` reaches the client: the shape of the
# name is a malformed request (400), who is asking is authority (403), the hourly bound is 429.
_TAG_REFUSAL_STATUS = {
    'signin_required': status.HTTP_403_FORBIDDEN,
    'minor_cannot_create_tag': status.HTTP_403_FORBIDDEN,
    'too_many_new_tags': status.HTTP_429_TOO_MANY_REQUESTS,
}


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
        extra = {}
        # `tag_created` rides on the answer ONLY when the tag was named by typing it: true for a new
        # tag, false when the name folded to one that existed (the UI says which). Absent otherwise.
        extra_out = {}
        tag_created = False
        tag_name = serializer.validated_data.get('tag_name')
        if tag_name:
            # A tag by the name somebody typed: an existing one when it folds to it, else a new one
            # (WP16 — every rule is in exercises/tags.py). The words are already validated, so the
            # only thing that can fail after the tag is made is the save itself, and then the tag
            # goes too: a tag never exists without the post that made it. Not `atomic()` — the save
            # may re-encode a picture, and SQLite would hold its write lock for all of it
            # (backend/CLAUDE.md, SQLite rule 2).
            from exercises.tags import create_tag_from

            tag, tag_created, refusal = create_tag_from(
                tag_name,
                request.user,
                allow_create=lambda: TagCreateThrottle().allow_request(request, self),
            )
            if refusal:
                return Response(
                    {'tag_name': [refusal]},
                    status=_TAG_REFUSAL_STATUS.get(refusal, status.HTTP_400_BAD_REQUEST),
                )
            extra['tag'] = tag
            extra_out['tag_created'] = tag_created
        try:
            post = serializer.save(author=request.user, **extra)
        except Exception:
            if tag_created:
                extra['tag'].delete()
            raise
        if should_hold_post(post):
            # accounts/minors.py: held for a moderator's look; nothing announces it until then.
            hold_for_review(post, request.user)
            return Response(
                {**PostSerializer(post, context={'request': request}).data, **extra_out},
                status=status.HTTP_201_CREATED,
            )
        record_activity(
            'post',
            actor=request.user,
            target_label=post.body[:150],
            post=post,
            branch=post.branch or (post.topic.branch if post.topic_id else None),
            discipline=post.discipline or (post.branch.discipline if post.branch_id else None),
            topic=post.topic,
            tags=[post.tag] if post.tag_id else (),
        )
        return Response(
            {**PostSerializer(post, context={'request': request}).data, **extra_out},
            status=status.HTTP_201_CREATED,
        )

    def list(self, request):
        """`GET /api/posts/?tag=<slug>&before=<id>&limit=` — the questions and posts asked in ONE
        tag, newest first: what the tag page (`/tags/[slug]`) lists. WP15, 2026-10-15, the owner's
        "ask as ppl should be allowed to post in tags".

        Why not the feed's `?tag=&kind=post`: the feed is an EVENT log that trims itself past
        `FEED_RETENTION_DAYS`, so a question asked four months ago would silently fall off its own
        tag's page while its permalink still worked. This reads the `Post` table itself.

        Bounded by construction (house convention — no global pagination): `tag` is required, the
        page is at most 50, and `before` is the same id cursor the feed uses. Only rows a reader
        may see are listed — a tombstoned, auto-hidden or held post is left out rather than drawn
        as a blank shell: a LIST is not a permalink (the detail endpoint keeps the tombstone so a
        shared link and its thread survive). The content-language rule applies, with the hidden
        count in the usual header; the audience band deliberately does NOT, the same as the feed
        this page sits beside — a tag is shared across bands, and a sticky audience chip emptying a
        page with no notice is the first-visitor audit's finding 2."""
        from config.content_locale import apply_content_locale_filter

        slug = (request.query_params.get('tag') or '').strip()
        if not slug:
            return Response(
                {'tag': ['Name the tag whose posts to list.']}, status=status.HTTP_400_BAD_REQUEST
            )
        try:
            before_id = int(request.query_params.get('before', '') or 0) or None
        except ValueError:
            before_id = None
        try:
            limit = int(request.query_params.get('limit', '') or 20)
        except ValueError:
            limit = 20
        qs = self.get_queryset().filter(
            tag__slug=slug, tag__is_removed=False, is_removed=False, auto_hidden_at__isnull=True
        )
        qs, hidden = apply_content_locale_filter(qs, request.query_params, 'language')
        if before_id:
            qs = qs.filter(id__lt=before_id)
        posts = list(qs.order_by('-id')[: max(1, min(limit, 50))])
        # One grouped COUNT per page instead of one per row: the serializer reads this map when it
        # is in the context and falls back to its own query for a single post.
        from community.models import Comment
        from django.contrib.contenttypes.models import ContentType
        from django.db.models import Count

        comment_counts = dict(
            Comment.objects.filter(
                content_type=ContentType.objects.get_for_model(Post),
                object_id__in=[post.pk for post in posts],
                is_removed=False,
            )
            .values('object_id')
            .annotate(n=Count('id'))
            .values_list('object_id', 'n')
        )
        response = Response(
            PostSerializer(
                posts,
                many=True,
                context={'request': request, 'comment_counts': comment_counts},
            ).data
        )
        response[HIDDEN_HEADER] = str(hidden)
        return response

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
