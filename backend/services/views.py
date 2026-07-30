from rest_framework import permissions, status, viewsets
from rest_framework.response import Response

from moderation.permissions import feature_gate

from .models import Service
from .serializers import ServiceSerializer, ServiceWriteSerializer

_TutoringFeatureGate = feature_gate('tutoring')


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
        if self.action in ('list', 'retrieve'):
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
        else:
            qs = qs.filter(is_active=True)

        course_slug = self.request.query_params.get('course')
        if course_slug:
            qs = qs.filter(courses__slug=course_slug)

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
