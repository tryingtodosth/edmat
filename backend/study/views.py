from rest_framework import permissions, viewsets

from .models import ExerciseSet
from .serializers import ExerciseSetSerializer


class ExerciseSetViewSet(viewsets.ModelViewSet):
    """POST /api/exercise-sets/ — registered users only; guests use localStorage (unchanged
    frontend behavior, Section 6/7). A user only ever sees/manages their own sets."""

    serializer_class = ExerciseSetSerializer
    permission_classes = [permissions.IsAuthenticated]

    def get_queryset(self):
        return ExerciseSet.objects.filter(owner=self.request.user)

    def perform_create(self, serializer):
        serializer.save(owner=self.request.user)
