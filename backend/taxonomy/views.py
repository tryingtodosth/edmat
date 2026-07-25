from rest_framework import viewsets
from rest_framework.decorators import action
from rest_framework.response import Response

from .models import Course, Field
from .serializers import CourseDetailSerializer, FieldSerializer


class FieldViewSet(viewsets.ReadOnlyModelViewSet):
    """GET /api/fields/, GET /api/fields/{slug}/, GET /api/fields/{slug}/courses/"""

    queryset = Field.objects.filter(published=True)
    serializer_class = FieldSerializer
    lookup_field = 'slug'

    @action(detail=True, methods=['get'])
    def courses(self, request, slug=None):
        field = self.get_object()
        courses = field.courses.filter(published=True)
        # CourseDetailSerializer (with nested topics), not the bare CourseSerializer — the
        # frontend's own Course type requires `topics: Topic[]` on every Course it's handed,
        # regardless of which endpoint produced it (Phase 3 note, taxonomy/serializers.py). The
        # course COUNT here is small enough (4 total in the real corpus) that this costs nothing
        # real.
        serializer = CourseDetailSerializer(courses, many=True, context={'request': request})
        return Response(serializer.data)


class CourseViewSet(viewsets.ReadOnlyModelViewSet):
    """GET /api/courses/{slug}/ — course detail (topics, chapters), plus /exercises/ and
    /materials/ sub-routes (Section 14). Imports exercises/materials serializers lazily, inside each
    method, to avoid a module-level import cycle risk as the app grows — taxonomy.models has no
    reverse dependency on exercises/materials, only the view layer needs them.
    """

    queryset = Course.objects.filter(published=True)
    serializer_class = CourseDetailSerializer  # always includes topics — see the note on `courses` above
    lookup_field = 'slug'

    @action(detail=True, methods=['get'])
    def exercises(self, request, slug=None):
        from exercises.views import _annotated_exercises, _filter_exercises
        from exercises.serializers import ExerciseListSerializer

        course = self.get_object()
        params = request.query_params.copy()
        params['course'] = course.slug
        qs = _filter_exercises(_annotated_exercises(), params)
        serializer = ExerciseListSerializer(qs, many=True, context={'request': request})
        return Response(serializer.data)

    @action(detail=True, methods=['get'])
    def materials(self, request, slug=None):
        from materials.serializers import MaterialSerializer

        course = self.get_object()
        materials = course.materials.filter(published=True)
        serializer = MaterialSerializer(materials, many=True, context={'request': request})
        return Response(serializer.data)
