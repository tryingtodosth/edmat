from django.db.models import Q
from rest_framework import permissions, viewsets

from .models import ExerciseSet
from .serializers import ExerciseSetSerializer


class ExerciseSetViewSet(viewsets.ModelViewSet):
    """POST /api/exercise-sets/ — registered users only; guests use localStorage (unchanged
    frontend behavior, Section 6/7). A user only ever LISTS/manages their own sets — `list`/
    `create`/`update`/`destroy` all stay both authenticated AND scoped to `owner=request.user`.

    `lookup_field = 'slug'` — every URL (including the owner's own update/delete) resolves a set by
    its random, unguessable slug rather than a raw numeric pk, matching the same "id IS the slug"
    convention Discipline/Branch already use elsewhere in this API. `ExerciseSet.slug`
    (study/models.py) is generated once at creation via `secrets.token_urlsafe`, never user-chosen.

    `retrieve` is the one deliberate exception to the owner-only rule above: reachable by an
    AUTHENTICATED-OR-NOT caller, but only for a set that's actually `is_public` — OR the set's own
    owner previewing their own, still-private one. This is the real, working "send a set to a
    friend" feature — CLAUDE.md Section 17J's own original design ("nothing about a set's content
    needs to stay secret, only the ability to modify it") has been narrowed since: a set is now
    PRIVATE by default (an opt-in share, not an unconditional one), and `is_public` is a real,
    owner-togglable "unshare" — resolving that section's own "Left open" note that no such
    mechanism existed. The slug itself is what makes a private set's own link safe to compute
    without a database check failing open: an unguessable identifier means "not `is_public`" is a
    real privacy boundary, not security-through-obscurity resting on a sequential integer."""

    serializer_class = ExerciseSetSerializer
    lookup_field = 'slug'

    def get_permissions(self):
        if self.action == 'retrieve':
            return [permissions.AllowAny()]
        return [permissions.IsAuthenticated()]

    def get_queryset(self):
        if self.action == 'retrieve':
            user = self.request.user
            if user and user.is_authenticated:
                return ExerciseSet.objects.filter(Q(is_public=True) | Q(owner=user))
            return ExerciseSet.objects.filter(is_public=True)
        return ExerciseSet.objects.filter(owner=self.request.user)

    def perform_create(self, serializer):
        serializer.save(owner=self.request.user)
