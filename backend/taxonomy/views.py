from rest_framework import viewsets
from rest_framework.decorators import action
from rest_framework.response import Response

from .models import Branch, Discipline
from .serializers import BranchDetailSerializer, DisciplineSerializer


class DisciplineViewSet(viewsets.ReadOnlyModelViewSet):
    """GET /api/disciplines/, /api/disciplines/{slug}/, /api/disciplines/{slug}/branches/"""

    queryset = Discipline.objects.filter(published=True)
    serializer_class = DisciplineSerializer
    lookup_field = 'slug'

    @action(detail=True, methods=['get'])
    def branches(self, request, slug=None):
        discipline = self.get_object()
        branches = discipline.branches.filter(published=True)
        # BranchDetailSerializer (with nested topics), not the bare BranchSerializer — the
        # frontend's own Branch type requires `topics: Topic[]` on every Branch it's handed,
        # regardless of which endpoint produced it (Phase 3 note, taxonomy/serializers.py). The
        # branch COUNT here is small enough (2 in the real corpus) that this costs nothing real.
        serializer = BranchDetailSerializer(branches, many=True, context={'request': request})
        return Response(serializer.data)


class BranchViewSet(viewsets.ReadOnlyModelViewSet):
    """GET /api/branches/{slug}/ — branch detail (topics, chapters), plus /exercises/ and
    /materials/ sub-routes (Section 14). Imports exercises/materials serializers lazily, inside each
    method, to avoid a module-level import cycle risk as the app grows — taxonomy.models has no
    reverse dependency on exercises/materials, only the view layer needs them.
    """

    queryset = Branch.objects.filter(published=True)
    serializer_class = BranchDetailSerializer  # always includes topics — see the note above
    lookup_field = 'slug'

    @action(detail=True, methods=['get'])
    def exercises(self, request, slug=None):
        from exercises.views import _annotated_exercises, _filter_exercises
        from exercises.serializers import ExerciseListSerializer

        branch = self.get_object()
        params = request.query_params.copy()
        params['branch'] = branch.slug
        qs = _filter_exercises(_annotated_exercises(), params)
        serializer = ExerciseListSerializer(qs, many=True, context={'request': request})
        return Response(serializer.data)

    @action(detail=True, methods=['get'])
    def materials(self, request, slug=None):
        """Branch-scoped materials listing — now filter/sort-capable via the exact same
        `_filter_materials`/`_sort_materials` helpers `materials.views.MaterialViewSet` itself uses
        (imported lazily, same "avoid a module-level import cycle" discipline this method's own
        sibling `exercises` action already establishes for `_filter_exercises`/`_annotated_exercises`)
        — the materials search/filter/sort overhaul's own type/tag/topic_id/min_level/q/sort params
        all work here too, not just on the cross-branch /api/materials/ endpoint, since this is the
        ACTUAL route the per-branch "Materials" tab (routes/branches/[branch]) has always called.
        """
        from config.i18n_utils import request_locale
        from materials.models import Material
        from materials.serializers import MaterialSerializer
        from materials.views import _filter_materials, _sort_materials

        branch = self.get_object()
        params = request.query_params.copy()
        params['branch'] = branch.slug
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
