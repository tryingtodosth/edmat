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
        """Course-scoped materials listing — now filter/sort-capable via the exact same
        `_filter_materials`/`_sort_materials` helpers `materials.views.MaterialViewSet` itself uses
        (imported lazily, same "avoid a module-level import cycle" discipline this method's own
        sibling `exercises` action already establishes for `_filter_exercises`/`_annotated_exercises`)
        — the materials search/filter/sort overhaul's own type/tag/topic_id/min_level/q/sort params
        all work here too, not just on the new cross-course /api/materials/ endpoint, since this is
        the ACTUAL route the per-course "Materials" tab (routes/courses/[course]) has always called.
        """
        from config.i18n_utils import request_locale
        from materials.models import Material
        from materials.serializers import MaterialSerializer
        from materials.views import _filter_materials, _sort_materials

        course = self.get_object()
        params = request.query_params.copy()
        params['course'] = course.slug
        qs = _filter_materials(Material.objects.filter(published=True), params)
        materials = list(
            qs.prefetch_related(
                'translations', 'coverage__votes__voter__profile', 'coverage__topic', 'tags', 'requirements'
            )
        )
        materials = _sort_materials(
            materials,
            request.query_params.get('sort'),
            request_locale({'request': request}),
            topic_id=request.query_params.get('topic_id'),
        )
        serializer = MaterialSerializer(materials, many=True, context={'request': request})
        return Response(serializer.data)
