from rest_framework import viewsets

from .models import Material
from .serializers import MaterialSerializer


class MaterialViewSet(viewsets.ReadOnlyModelViewSet):
    """GET /api/materials/ — course-scoped listing is also available via
    /api/courses/{slug}/materials/ (taxonomy.CourseViewSet.materials)."""

    queryset = Material.objects.filter(published=True)
    serializer_class = MaterialSerializer
