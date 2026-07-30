from django.contrib.contenttypes.models import ContentType
from django.db import models
from rest_framework import mixins, permissions, status, viewsets
from rest_framework.decorators import action
from rest_framework.response import Response

from community.models import Comment
from community.serializers import CommentSerializer
from moderation.permissions import feature_gate
from notifications.services import notify_comment_reply

from .models import Service, ServiceReview, ServiceWatch
from .serializers import (
    ServiceReviewSerializer,
    ServiceSerializer,
    ServiceWatchSerializer,
    ServiceWriteSerializer,
)

_TutoringFeatureGate = feature_gate('tutoring')


def _notify_service_reply(comment, service):
    # No `exercise=`/`material=` to pass — a tutoring listing has neither, and notify_comment_reply
    # already defaults both to None (it's a generic "was this a reply, tell the parent's author"
    # helper shared across every content type with comments, not exercise/material-specific despite
    # its own call sites so far only ever being those two). The listing's own title is enough of a
    # label for the notification to read sensibly without one.
    notify_comment_reply(comment, target_label=service.title)


class ServiceViewSet(viewsets.ModelViewSet):
    """Tutoring/services listings ("Korepetycje") — public discovery (`list`/`retrieve`), owner-only
    writes (`create`/`update`/`partial_update`/`destroy`), matching the exact "public GET, owner-
    scoped writes" split `ExerciseSetViewSet`/`Material` already establish elsewhere in this app —
    not a new trust model invented for this feature.

    `?course=<slug>` — course-scoped discovery (the whole reason a Service is tied to real Courses
    rather than left as free text, see models.py's own doc comment), a plain manual `get_queryset`
    filter matching this codebase's own established convention (MaterialViewSet's `?q=`,
    ExerciseViewSet's own `_filter_exercises`) rather than reaching for DRF's built-in
    DjangoFilterBackend/SearchFilter machinery, which no other viewset in this app actually uses —
    consistency with the rest of the API matters more here than using a "more idiomatic DRF"
    approach that would be the only place doing it that way.

    `?mine=true` — a registered user's own listings (including paused/`is_active=False` ones the
    public browse never shows), for their own "manage my listings" page. Only meaningful combined
    with authentication; silently ignored for an anonymous request (falls through to the plain
    public queryset, matching the polite-degradation instinct this app's other optional/authenticated
    -only query params already follow rather than 401ing on a param a guest simply can't use).
    """

    def get_serializer_class(self):
        if self.action in ('create', 'update', 'partial_update'):
            return ServiceWriteSerializer
        return ServiceSerializer

    def get_permissions(self):
        # feature_gate('tutoring') is added to EVERY branch — a killed tutoring feature vanishes
        # from the API for a non-staff caller across list/retrieve too, not just create/update
        # (moderation/permissions.py's own doc comment); the underlying is_staff bypass inside the
        # gate itself is what still lets a real moderator browse/manage listings while it's off.
        # `comments` is public-GET here too (matching Exercise/MaterialCoverage's own discussion
        # threads, readable by anyone) — the write side's own auth check lives inside the action
        # itself, the same GET/POST-in-one-action shape those two already use.
        if self.action in ('list', 'retrieve', 'comments', 'reviews'):
            return [permissions.AllowAny(), _TutoringFeatureGate()]
        return [permissions.IsAuthenticated(), _TutoringFeatureGate()]

    def get_queryset(self):
        if self.action in ('update', 'partial_update', 'destroy'):
            # Owner-scoped, not just permission-checked — a non-owner's attempt correctly 404s
            # rather than 403ing, the same queryset-scoping-not-permission-checking pattern
            # ExerciseSetViewSet/NodeGovernorViewSet already establish throughout this app.
            return Service.objects.filter(provider=self.request.user)

        qs = Service.objects.all()
        mine = self.request.query_params.get('mine')
        if mine and self.request.user.is_authenticated:
            qs = qs.filter(provider=self.request.user)
        elif self.action in ('retrieve', 'comments', 'reviews') and self.request.user.is_authenticated:
            # A real, found-before-shipping gap: without this, a provider's OWN paused listing
            # (is_active=False) 404'd on its own detail page/comments the instant they viewed it
            # directly — the `?mine=true` escape hatch above only ever applied to the LIST action,
            # nothing let a single retrieve see a caller's own inactive listing. `list` deliberately
            # keeps requiring the explicit `?mine=true` opt-in (an anonymous/other-user browse should
            # never include paused listings by default), but a direct link to one specific listing —
            # exactly what "view your own paused listing's detail page" is — reasonably always
            # includes your own regardless of status.
            qs = qs.filter(models.Q(is_active=True) | models.Q(provider=self.request.user))
        else:
            qs = qs.filter(is_active=True)

        course_slug = self.request.query_params.get('course')
        if course_slug:
            qs = qs.filter(courses__slug=course_slug)

        # A user's own active tutoring listings — the public profile page's own new "their
        # tutoring listings" section (CLAUDE.md's tutoring-listings feature note, item 6). Reuses
        # this same branch's own `is_active=True` default (set just above, since `mine`/`retrieve`
        # aren't in play for a stranger's profile visit) rather than a separate code path — a
        # public profile should never surface someone else's paused listing any more than the
        # ordinary public browse page would.
        provider = self.request.query_params.get('provider')
        if provider:
            qs = qs.filter(provider_id=provider)

        return qs.distinct()

    def perform_create(self, serializer):
        serializer.save(provider=self.request.user)

    def _respond_full(self, instance, response_status):
        # ServiceWriteSerializer (used for create/update, above) is deliberately narrower than
        # ServiceSerializer — but the caller still wants the FULL representation back (provider
        # info, resolved course_slugs) after a successful write, the same way every other
        # create/update endpoint in this app responds with its own real, full read shape rather
        # than echoing back the narrower write payload.
        return Response(
            ServiceSerializer(instance, context={'request': self.request}).data, status=response_status
        )

    def create(self, request, *args, **kwargs):
        serializer = self.get_serializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        self.perform_create(serializer)
        return self._respond_full(serializer.instance, status.HTTP_201_CREATED)

    def update(self, request, *args, **kwargs):
        partial = kwargs.pop('partial', False)
        instance = self.get_object()
        serializer = self.get_serializer(instance, data=request.data, partial=partial)
        serializer.is_valid(raise_exception=True)
        self.perform_update(serializer)
        return self._respond_full(serializer.instance, status.HTTP_200_OK)

    @action(detail=True, methods=['get', 'post'])
    def comments(self, request, pk=None):
        """Threaded discussion on a tutoring listing — the exact same generic Comment mechanism
        (GenericForeignKey content_type/object_id) Exercise and MaterialCoverage already use, not a
        bespoke one built for this feature. `get_object()` deliberately bypasses this ViewSet's own
        write-scoped `get_queryset()` for update/destroy — a real, existing `get_object()` call
        already resolves against `Service.objects.all()` for `list`/`retrieve`/`comments`, so any
        listing (not just the caller's own) can be commented on, matching the public-GET posture
        `comments` itself is already gated for above."""
        service = self.get_object()
        content_type = ContentType.objects.get_for_model(Service)
        if request.method == 'GET':
            qs = Comment.objects.filter(content_type=content_type, object_id=service.pk)
            serializer = CommentSerializer(qs, many=True)
            return Response(serializer.data)
        if not request.user.is_authenticated:
            return Response(status=status.HTTP_401_UNAUTHORIZED)
        serializer = CommentSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        # Same cross-target check exercises/views.py's/materials/views.py's own `comments` actions
        # already apply — a client-supplied `parent` genuinely threads, but nothing should let it
        # name a comment belonging to an entirely different listing's own thread.
        parent = serializer.validated_data.get('parent')
        if parent is not None and (
            parent.content_type_id != content_type.id or parent.object_id != service.pk
        ):
            return Response(
                {'parent': ['This reply must belong to the same discussion.']},
                status=status.HTTP_400_BAD_REQUEST,
            )
        serializer.save(content_type=content_type, object_id=service.pk, author=request.user)
        _notify_service_reply(serializer.instance, service)
        return Response(serializer.data, status=status.HTTP_201_CREATED)

    @action(detail=True, methods=['get', 'post'])
    def reviews(self, request, pk=None):
        """Star rating + optional written review on a tutoring listing — the same upsert-on-
        resubmit shape exercises/views.py's own ExerciseViewSet.reviews already establishes
        (POSTing again updates your own existing review rather than creating a second row, since
        `ServiceReview` has the identical `unique_together = [('service', 'author')]`)."""
        service = self.get_object()
        if request.method == 'GET':
            # `is_removed=False` — a moderator-removed review (the report-a-tutor-review feature)
            # disappears entirely, same `community.Review.is_removed` precedent (a full queryset
            # exclusion, not a Comment-style tombstone-blank — a ServiceReview is never threaded).
            qs = service.reviews.filter(is_removed=False)
            serializer = ServiceReviewSerializer(qs, many=True)
            return Response(serializer.data)
        if not request.user.is_authenticated:
            return Response(status=status.HTTP_401_UNAUTHORIZED)
        existing = ServiceReview.objects.filter(service=service, author=request.user).first()
        serializer = ServiceReviewSerializer(
            existing, data={**request.data, 'service': service.pk}, partial=existing is not None
        )
        serializer.is_valid(raise_exception=True)
        serializer.save(service=service, author=request.user)
        return Response(serializer.data, status=status.HTTP_201_CREATED if existing is None else status.HTTP_200_OK)


class ServiceWatchViewSet(
    mixins.ListModelMixin, mixins.CreateModelMixin, mixins.DestroyModelMixin, viewsets.GenericViewSet
):
    """"Add certain tutor offers to a watchlist to compare listings" — GET lists the caller's own
    watched listings (each with the FULL Service embedded, ServiceWatchSerializer's own
    `to_representation`, so a comparison view can render straight from this one response); POST
    watches one; DELETE un-watches. Authenticated-only throughout, no public read at all — a
    watchlist is inherently personal, unlike a Service/Comment/Review, which are all public by
    design."""

    serializer_class = ServiceWatchSerializer
    permission_classes = [permissions.IsAuthenticated, _TutoringFeatureGate]

    def get_queryset(self):
        # Queryset-scoping, not permission-checking — the same established pattern this app already
        # uses throughout (ExerciseSetViewSet, NodeGovernorViewSet): a non-owner's DELETE attempt on
        # someone else's watch row 404s here rather than needing its own explicit check.
        return ServiceWatch.objects.filter(user=self.request.user).select_related(
            'service__provider__profile'
        )

    def perform_create(self, serializer):
        serializer.save(user=self.request.user)
