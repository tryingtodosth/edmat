"""`/api/sketches/` — a drawing is made by a signed-in person, read by anybody (it ends up inside
public content), replaced only by its author. The same five rules `chem/views.py` settled on, for
the same reasons:

- POST creates one and returns the `<img>` to paste (`embed_html`), behind its own throttle scope:
  a picture goes through a real decode and re-encode, which is a CPU lever without one.
- GET by id is public. The rich editor reads it to reopen the drawing behind a picture; a listing
  of "my sketches" is the bare list and needs a session, since the number of things somebody has
  drawn is not a public fact.
- PUT/PATCH replaces source and picture — only the author (a 403, not a 404: the drawing is public,
  so pretending it does not exist would be a lie the reader can disprove).
- No DELETE: a drawing that a published comment embeds must keep resolving. An author who wants it
  gone edits the text that shows it.
"""

from rest_framework import mixins, permissions, status, viewsets
from rest_framework.response import Response
from rest_framework.throttling import ScopedRateThrottle

from moderation.permissions import feature_gate

from .models import Sketch
from .serializers import SketchSerializer, SketchWriteSerializer

_SketchesGate = feature_gate('sketches')


class SketchViewSet(
    mixins.CreateModelMixin,
    mixins.ListModelMixin,
    mixins.RetrieveModelMixin,
    mixins.UpdateModelMixin,
    viewsets.GenericViewSet,
):
    permission_classes = [_SketchesGate]
    throttle_classes = [ScopedRateThrottle]
    throttle_scope = 'sketch'
    serializer_class = SketchSerializer

    def get_throttles(self):
        if self.action not in ('create', 'update', 'partial_update'):
            return []
        return super().get_throttles()

    def get_permissions(self):
        perms = [_SketchesGate()]
        if self.action in ('create', 'update', 'partial_update', 'list'):
            perms.append(permissions.IsAuthenticated())
        return perms

    def get_queryset(self):
        qs = Sketch.objects.select_related('author')
        if self.action == 'list':
            return qs.filter(author=self.request.user)
        return qs

    def create(self, request, *args, **kwargs):
        serializer = SketchWriteSerializer(data=request.data, context={'request': request})
        serializer.is_valid(raise_exception=True)
        sketch = serializer.save()
        return Response(
            SketchSerializer(sketch, context={'request': request}).data,
            status=status.HTTP_201_CREATED,
        )

    def update(self, request, *args, **kwargs):
        sketch = self.get_object()
        # The queryset is unscoped for a pk-addressed action (house rule 4: a filter never runs
        # here), so authority is asked explicitly, before anything is written.
        if sketch.author_id != request.user.pk and not request.user.is_staff:
            return Response(status=status.HTTP_403_FORBIDDEN)
        serializer = SketchWriteSerializer(sketch, data=request.data, context={'request': request})
        serializer.is_valid(raise_exception=True)
        serializer.save()
        return Response(SketchSerializer(sketch, context={'request': request}).data)

    def partial_update(self, request, *args, **kwargs):
        # A sketch is replaced whole — scene and picture together — or not at all. A "partial"
        # update that changed the scene but kept the old picture would show one thing and reopen
        # as another.
        return self.update(request, *args, **kwargs)
