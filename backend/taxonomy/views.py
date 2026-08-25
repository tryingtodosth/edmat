from django.utils.text import slugify
from rest_framework import permissions, status, viewsets
from rest_framework.decorators import action
from rest_framework.exceptions import ValidationError
from rest_framework.response import Response
from rest_framework.views import APIView

from moderation.services import governed_branch_ids

from .models import (
    Branch,
    BranchTranslation,
    Discipline,
    DisciplineTranslation,
    Topic,
    TopicTranslation,
)
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
                'translations',
                'coverage__votes__voter__profile',
                'coverage__importance_votes__voter__profile',
                'coverage__topic',
                'tags',
                'requirements',
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


class ProposeNodeView(APIView):
    """POST /api/taxonomy/propose/ — suggest a discipline, a branch or a topic.

    Anyone signed in may propose. A moderator's own proposal is approved on the spot: asking
    somebody to approve their own suggestion is a click that means nothing, and it is the same
    "staff never queue behind themselves" rule `Course.contribution_needs_approval` already applies
    to course contributions.

    Everybody else's arrives `pending` and is REAL immediately — referenceable, filable against,
    and shown in the browse UI grouped under "others" until a moderator agrees. A proposal that
    could not be used until approved would be useless to the person who needed the word.

        {"kind": "topic", "slug": "teoria-miary", "name": "Teoria miary", "parent": "analiza-..."}

    `parent` is the containing node's slug — a discipline for a branch, a branch for a topic. Not
    needed for a discipline, which has nothing above it.
    """

    permission_classes = [permissions.IsAuthenticated]

    @staticmethod
    def kinds():
        """kind -> (model, translation model, parent field, parent model, the translation's own FK)

        A function rather than a class attribute because `material_type` lives in the materials app,
        which imports taxonomy.models — resolving it at import time here would close that loop. It
        is proposed through this endpoint rather than one of its own because everything that makes a
        proposal work is already here: the moderator-proposes-is-approved rule, the duplicate guard,
        and the "real but pending" contract. A material type simply has nothing above it, like a
        discipline.
        """
        from materials.models import MaterialType, MaterialTypeTranslation

        return {
            'discipline': (Discipline, DisciplineTranslation, None, None, 'discipline'),
            'branch': (Branch, BranchTranslation, 'discipline', Discipline, 'branch'),
            'topic': (Topic, TopicTranslation, 'branch', Branch, 'topic'),
            'material_type': (MaterialType, MaterialTypeTranslation, None, None, 'material_type'),
        }

    def post(self, request):
        kinds = self.kinds()
        kind = request.data.get('kind')
        if kind not in kinds:
            raise ValidationError({'kind': f'Expected one of {sorted(kinds)}.'})
        model, translation_model, parent_field, parent_model, translation_fk = kinds[kind]

        slug = slugify((request.data.get('slug') or request.data.get('name') or '').strip())
        if not slug:
            raise ValidationError({'slug': 'A slug or a name is required.'})
        name = (request.data.get('name') or slug).strip()

        parent = None
        if parent_field:
            parent_slug = request.data.get('parent')
            parent = parent_model.objects.filter(slug=parent_slug).first()
            if parent is None:
                raise ValidationError({'parent': f'No {parent_field} with that slug.'})

        # A branch slug is unique globally; a topic slug only within its branch. Checking here
        # rather than letting IntegrityError surface means the caller gets "that already exists"
        # instead of a 500, and it is also how a duplicate proposal is turned into a no-op.
        existing = model.objects.filter(slug=slug)
        if parent_field:
            existing = existing.filter(**{parent_field: parent})
        if existing.exists():
            raise ValidationError({'slug': 'That already exists.'})

        # `governed_branch_ids` returns None for global staff and a SET for everybody else —
        # empty when they govern nothing. So `is not None` would read every ordinary user as a
        # moderator, which is exactly the bug the tests caught: a truthy set is the real signal.
        is_moderator = bool(request.user.is_staff or governed_branch_ids(request.user))
        fields = {'slug': slug, 'status': 'approved' if is_moderator else 'pending'}
        if not is_moderator:
            fields['proposed_by'] = request.user
        if parent_field:
            fields[parent_field] = parent

        node = model.objects.create(**fields)
        # The name is a translation row, exactly as every other name in this app is — a proposal
        # that stored a bare CharField would be the one node nobody could ever translate.
        translation_model.objects.create(
            **{translation_fk: node, 'locale': request.data.get('locale') or 'pl', 'name': name}
        )
        return Response(
            {'kind': kind, 'slug': node.slug, 'status': node.status},
            status=status.HTTP_201_CREATED,
        )
