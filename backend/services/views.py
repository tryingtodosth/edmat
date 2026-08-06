import math

from django.contrib.contenttypes.models import ContentType
from django.db import models
from django.utils import timezone
from rest_framework import mixins, permissions, status, viewsets
from rest_framework.decorators import action
from rest_framework.response import Response
from rest_framework.views import APIView

from community.models import Comment
from community.serializers import CommentSerializer
from community.views import comment_thread_response, notify_review_reply, reply_counts_for
from moderation.permissions import feature_gate
from notifications.services import notify_comment_reply

from .geocoding import GeocodingUnavailable, reverse as reverse_geocode, search as geocode_search
from .models import DELIVERY_MODE_CHOICES, IN_PERSON_MODES, Service, ServiceReview, ServiceWatch
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


def _haversine_km(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    """Great-circle distance. Written out rather than pulled from a library: it is six lines, and
    `geopy` would be a new runtime dependency for one formula — the same call this project already
    made for `testing/factories.py` over `factory_boy`."""
    radius = 6371.0
    d_lat = math.radians(lat2 - lat1)
    d_lon = math.radians(lon2 - lon1)
    a = (
        math.sin(d_lat / 2) ** 2
        + math.cos(math.radians(lat1)) * math.cos(math.radians(lat2)) * math.sin(d_lon / 2) ** 2
    )
    return 2 * radius * math.asin(math.sqrt(a))


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

        branch_slug = self.request.query_params.get('branch')
        if branch_slug:
            qs = qs.filter(branches__slug=branch_slug)

        # A user's own active tutoring listings — the public profile page's own new "their
        # tutoring listings" section (CLAUDE.md's tutoring-listings feature note, item 6). Reuses
        # this same branch's own `is_active=True` default (set just above, since `mine`/`retrieve`
        # aren't in play for a stranger's profile visit) rather than a separate code path — a
        # public profile should never surface someone else's paused listing any more than the
        # ordinary public browse page would.
        provider = self.request.query_params.get('provider')
        if provider:
            qs = qs.filter(provider_id=provider)

        # "Show me only tutors I can actually meet in person" / "only online". `hybrid` listings
        # deliberately match BOTH — a tutor offering either way genuinely satisfies a student
        # looking for either, and excluding them from both filters would hide the most flexible
        # listings from everyone, which is the opposite of useful.
        mode = self.request.query_params.get('delivery_mode')
        if mode == 'in_person':
            qs = qs.filter(delivery_mode__in=IN_PERSON_MODES)
        elif mode == 'online':
            qs = qs.filter(delivery_mode__in=['online', 'hybrid'])

        qs = self._filter_by_distance(qs)

        return qs.distinct()

    def _filter_by_distance(self, qs):
        """`?near=<lat>,<lon>&radius_km=<n>` — "tutors within N km of me", the thing that makes a
        stored location useful rather than merely displayed.

        Two stages, on purpose. A bounding box runs in SQL and discards almost everything cheaply;
        the exact great-circle distance is then computed in Python over what survives. The reason is
        that this project runs on SQLite with no GIS extension (CLAUDE.md Section 13) — there is no
        `ST_Distance` to call, and a bounding box is genuinely all SQL can express here. It is also
        not merely an optimization: a raw lat/lon box is not a circle, so filtering by the box alone
        would return corner results up to ~41% further away than the radius asked for.
        """
        near = self.request.query_params.get('near')
        if not near:
            return qs
        try:
            lat_str, lon_str = near.split(',')
            lat, lon = float(lat_str), float(lon_str)
            radius_km = float(self.request.query_params.get('radius_km') or 25)
        except (ValueError, TypeError):
            # A malformed `near=` is ignored rather than 400'd — this is a browse filter, and
            # silently showing the unfiltered list is friendlier than failing the whole page.
            return qs
        if not (-90 <= lat <= 90 and -180 <= lon <= 180) or radius_km <= 0:
            return qs

        radius_km = min(radius_km, 500)  # a sane ceiling; beyond this the filter means nothing

        lat_delta = radius_km / 111.0
        # Longitude degrees shrink toward the poles, so the box must widen by 1/cos(latitude) to
        # still cover the full radius east-west. Clamped because cos() approaches zero at the poles
        # and would otherwise produce an infinite box.
        cos_lat = max(math.cos(math.radians(lat)), 0.01)
        lon_delta = radius_km / (111.0 * cos_lat)

        boxed = qs.filter(
            location_lat__isnull=False,
            location_lon__isnull=False,
            location_lat__gte=lat - lat_delta,
            location_lat__lte=lat + lat_delta,
            location_lon__gte=lon - lon_delta,
            location_lon__lte=lon + lon_delta,
        )

        within = [
            service.pk
            for service in boxed
            if _haversine_km(lat, lon, float(service.location_lat), float(service.location_lon))
            <= radius_km
        ]
        return qs.filter(pk__in=within)

    def perform_create(self, serializer):
        serializer.save(provider=self.request.user)

    def _respond_full(self, instance, response_status):
        # ServiceWriteSerializer (used for create/update, above) is deliberately narrower than
        # ServiceSerializer — but the caller still wants the FULL representation back (provider
        # info, resolved branch_slugs) after a successful write, the same way every other
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

    def destroy(self, request, *args, **kwargs):
        """Refused while somebody still has a live session booked against this listing.

        `Booking.service` cascades, so deleting the listing would take real, agreed appointments with
        it — silently, and from the student's side as well as the tutor's. The listing is not the
        appointment, and a tutor withdrawing an offer is not the same act as standing somebody up.

        `Pause` is the answer offered instead, and it already exists (`is_active`): it takes the
        listing out of every browse and refuses new bookings, while leaving the ones already agreed
        intact. Once those have been through their own lifecycle — completed, declined or cancelled —
        the delete goes through.

        The import is local because services and booking each need the other: booking is built on
        Service, and this one rule is the single place the dependency runs back the other way.
        """
        from booking.models import OPEN_STATUSES, Booking

        instance = self.get_object()
        live = Booking.objects.filter(
            service=instance, status__in=OPEN_STATUSES, ends_at__gte=timezone.now()
        ).count()
        if live:
            return Response(
                {
                    'detail': (
                        'This listing has upcoming bookings. Pause it instead, or cancel them first.'
                    ),
                    'live_bookings': live,
                },
                status=status.HTTP_409_CONFLICT,
            )
        return super().destroy(request, *args, **kwargs)

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
            # disappears entirely, same `community.Review.is_removed` precedent: a full queryset
            # exclusion rather than a Comment-style tombstone-blank. A review CAN now be replied to,
            # but the reasoning is unchanged — nothing structural hangs off the review row itself
            # (the replies are Comments, which keep their own tombstones), so a removed review can
            # still simply disappear and take its thread's reachability with it.
            qs = list(service.reviews.filter(is_removed=False))
            serializer = ServiceReviewSerializer(
                qs, many=True, context={'reply_counts': reply_counts_for(qs)}
            )
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


class GeocodeView(APIView):
    """`GET /api/geocode/?q=<address>` and `?lat=&lon=` — a thin, deliberate proxy in front of
    Nominatim (OpenStreetMap). See services/geocoding.py for the full reasoning on why this is
    server-side rather than a direct browser call; the short version is that Nominatim's usage policy
    requires an identifying `User-Agent` (which browser `fetch()` cannot set at all), a global
    1 request/second cap (which per-browser calls cannot coordinate), and caching (which only helps
    when it is shared).

    Authenticated-only. Not because addresses are sensitive — they end up on a public listing — but
    because this endpoint spends a shared, rate-limited third-party budget on the caller's behalf,
    and an anonymous one would let anyone exhaust it for every real user. Paired with its own tight
    throttle scope for the same reason.
    """

    # Behind the same `tutoring` kill switch as every other endpoint in this app (moderation/
    # permissions.py). Address lookup exists solely to place a tutoring listing's own pin, so when
    # tutoring is switched off nothing should be able to reach this — and without the gate it would
    # stay live, still spending the shared, rate-limited Nominatim budget for a feature that is
    # supposed to be disabled. Found by grepping this file for endpoints missing the gate rather
    # than by anything failing.
    permission_classes = [permissions.IsAuthenticated, _TutoringFeatureGate]
    throttle_scope = 'geocode'

    def get(self, request):
        query = (request.query_params.get('q') or '').strip()
        lat_raw = request.query_params.get('lat')
        lon_raw = request.query_params.get('lon')

        try:
            if lat_raw is not None and lon_raw is not None:
                result = reverse_geocode(float(lat_raw), float(lon_raw))
                results = [result] if result else []
            elif query:
                results = geocode_search(query)
            else:
                return Response(
                    {'detail': 'Provide either q= or lat=&lon=.'},
                    status=status.HTTP_400_BAD_REQUEST,
                )
        except ValueError:
            return Response(
                {'detail': 'lat/lon must be numbers.'}, status=status.HTTP_400_BAD_REQUEST
            )
        except GeocodingUnavailable:
            # 503, deliberately not an empty 200. "The lookup is down, try again" and "that address
            # does not exist" must not be indistinguishable, or a user will keep retyping a perfectly
            # valid address wondering why nothing is found.
            return Response(
                {'detail': 'Address lookup is temporarily unavailable. Please try again shortly.'},
                status=status.HTTP_503_SERVICE_UNAVAILABLE,
            )

        return Response(
            {
                'results': [
                    {'label': r.label, 'lat': r.lat, 'lon': r.lon} for r in results
                ],
                # OSM data is ODbL-licensed and requires credit wherever it is shown. Returned with
                # the data itself so the UI cannot render results while forgetting the attribution.
                'attribution': '© OpenStreetMap contributors',
            }
        )


class ServiceReviewViewSet(viewsets.GenericViewSet):
    """`/api/service-reviews/{id}/comments/` — the conversation under one tutoring-listing review.

    The third of three, and the reason all three exist: `ReviewList.svelte` renders exercise,
    material and tutoring reviews from one component, so replies had to reach all three or the
    affordance would appear and disappear between pages for no reason a reader could see.

    Carries the same `tutoring` kill switch every other listing endpoint does — a killed feature
    whose review threads stayed writable would be exactly the leak the switch exists to prevent.
    A removed review is excluded, matching `ServiceViewSet.reviews`'s own read.
    """

    queryset = ServiceReview.objects.filter(is_removed=False)
    serializer_class = CommentSerializer

    def get_permissions(self):
        return [permissions.AllowAny(), _TutoringFeatureGate()]

    @action(detail=True, methods=['get', 'post'])
    def comments(self, request, pk=None):
        review = self.get_object()
        return comment_thread_response(
            request,
            review,
            on_created=lambda comment: notify_review_reply(
                comment,
                review,
                # No Notification FK exists for a Service (the model carries exercise/material/
                # taught_course/event and nothing else), so this label is all the notification can
                # say — the same honest limitation a per-coverage-claim reply already has.
                label=review.service.title,
            ),
        )
