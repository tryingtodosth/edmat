from rest_framework import permissions, viewsets

from .models import ExerciseSet
from .serializers import ExerciseSetSerializer


class ExerciseSetViewSet(viewsets.ModelViewSet):
    """POST /api/exercise-sets/ — registered users only; guests use localStorage (unchanged
    frontend behavior, Section 6/7). A user only ever LISTS/manages their own sets — `list`/
    `create`/`update`/`destroy` all stay both authenticated AND scoped to `owner=request.user`.

    `retrieve` (a single set, by id) is the one deliberate exception: publicly readable, no
    authentication required at all. This is what makes a real, working share link possible — "a
    link to someone else's set, not just your own saved one," the one real feature from the
    original static site CLAUDE.md's own Section 16 had flagged as deliberately deferred rather
    than built. A set's own content (a name plus an ordered list of exercise references) isn't
    sensitive data the way, say, a private message would be — the same "public GET, owner-scoped
    writes" split `Exercise`/`Material` already use throughout this app, not a new trust model
    invented just for this. The set's own numeric id IS the share link — no separate opaque token
    was added, since nothing about a set's contents needs to stay unguessable, only its OWNER's
    ability to modify it does (still fully protected, unchanged, by the `owner=request.user` scope
    on every other action)."""

    serializer_class = ExerciseSetSerializer

    def get_permissions(self):
        if self.action == 'retrieve':
            return [permissions.AllowAny()]
        return [permissions.IsAuthenticated()]

    def get_queryset(self):
        if self.action == 'retrieve':
            return ExerciseSet.objects.all()
        return ExerciseSet.objects.filter(owner=self.request.user)

    def perform_create(self, serializer):
        serializer.save(owner=self.request.user)
