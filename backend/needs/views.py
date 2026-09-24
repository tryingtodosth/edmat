"""`/api/needs/`, `/api/nodes/{kind}/{id}/needs/` and `/api/need-applications/…`
(MANAGEMENT-BRIEF.md §3.C).

**Visibility is the queryset filter; authority is an object-level check, and both are here** (house
rule 4). `NeedViewSet.get_queryset()` is `rules.public_needs`, so a stranger's `GET
/api/needs/{id}/` on a need they cannot see 404s through DRF's own `get_object()` exactly the way
the board already narrows for them. Every action that MUTATES then asks `rules.can_manage` or
`rules.apply_block_reason`/`decide_block_reason` explicitly, because a queryset filter never runs
for an action that arrives with an id in the URL.
"""

from django.contrib.contenttypes.models import ContentType
from django.db.models import Q
from django.http import Http404
from django.shortcuts import get_object_or_404
from django.utils import timezone
from rest_framework import mixins, permissions, status, viewsets
from rest_framework.decorators import action
from rest_framework.response import Response
from rest_framework.views import APIView

from config import nodes as node_seam
from moderation.permissions import feature_gate

from . import rules
from .models import Need, NeedApplication
from .serializers import (
    ApplyDraftSerializer,
    DecideSerializer,
    NeedApplicationSerializer,
    NeedSerializer,
)

_NeedsGate = feature_gate('needs')

#: `apply_block_reason` words that mean "the world moved" (409) rather than "who you are" (403) —
#: root `CLAUDE.md`: do not conflate the two.
_APPLY_CONFLICTS = {rules.NOT_OPEN, rules.ALREADY_APPLIED, rules.FULL}


def _apply_refusal_status(reason: str) -> int:
    return status.HTTP_409_CONFLICT if reason in _APPLY_CONFLICTS else status.HTTP_403_FORBIDDEN


class NodeNeedsView(APIView):
    """`/api/nodes/{kind}/{id}/needs/` — this app's own nested route (MANAGEMENT-BRIEF.md §2: your
    nested routes hang under the same prefix in *your* app's `urls.py`). GET is anybody who can see
    the node (narrowed to `open` for a non-staff reader — `rules.node_needs`); POST is the node's
    own manager, because posting a need on behalf of a course or an event is running it, not
    volunteering for it.
    """

    permission_classes = [permissions.IsAuthenticatedOrReadOnly, _NeedsGate]

    def _node(self, request, kind, pk):
        node = node_seam.resolve_node(kind, pk)
        if node is None or not node_seam.can_view_node(request.user, node):
            raise Http404
        return node

    def get(self, request, kind, pk):
        node = self._node(request, kind, pk)
        qs = rules.node_needs(request.user, node)
        return Response(NeedSerializer(qs, many=True, context={'request': request}).data)

    def post(self, request, kind, pk):
        node = self._node(request, kind, pk)
        if not node_seam.can_manage_node(request.user, node):
            return Response({'detail': rules.NOT_MANAGER}, status=status.HTTP_403_FORBIDDEN)
        serializer = NeedSerializer(data=request.data, context={'request': request})
        serializer.is_valid(raise_exception=True)
        need = serializer.save(
            content_type=node_seam.node_content_type(node),
            object_id=node.pk,
            created_by=request.user,
        )
        return Response(
            NeedSerializer(need, context={'request': request}).data, status=status.HTTP_201_CREATED
        )


class NeedViewSet(
    mixins.ListModelMixin, mixins.RetrieveModelMixin, mixins.UpdateModelMixin, viewsets.GenericViewSet
):
    """`/api/needs/` (the public board, list only — creation is always node-nested, above) and
    `/api/needs/{id}/…` — detail, edit, apply, withdraw, the manager's applications queue."""

    permission_classes = [permissions.IsAuthenticatedOrReadOnly, _NeedsGate]
    serializer_class = NeedSerializer

    def get_queryset(self):
        return rules.public_needs(self.request.user)

    def list(self, request, *args, **kwargs):
        qs = self.get_queryset()
        kind = request.query_params.get('kind')
        if kind:
            qs = qs.filter(kind=kind)
        if request.query_params.get('remote') == '1':
            qs = qs.filter(is_remote=True)
        query = request.query_params.get('q', '').strip()
        if query:
            qs = qs.filter(Q(title__icontains=query) | Q(description__icontains=query))
        node_kind = request.query_params.get('node_kind')
        if node_kind in node_seam.NODE_KINDS:
            from django.apps import apps as django_apps

            model = django_apps.get_model(*node_seam.NODE_KINDS[node_kind])
            qs = qs.filter(content_type=ContentType.objects.get_for_model(model))
        return Response(self.get_serializer(qs, many=True).data)

    def partial_update(self, request, *args, **kwargs):
        need = self.get_object()
        if not rules.can_manage(request.user, need):
            return Response({'detail': rules.NOT_MANAGER}, status=status.HTTP_403_FORBIDDEN)
        serializer = self.get_serializer(need, data=request.data, partial=True)
        serializer.is_valid(raise_exception=True)
        serializer.save()
        return Response(serializer.data)

    @action(detail=True, methods=['post'], permission_classes=[permissions.IsAuthenticated, _NeedsGate])
    def apply(self, request, pk=None):
        need = self.get_object()
        reason = rules.apply_block_reason(request.user, need)
        if reason:
            return Response({'detail': reason}, status=_apply_refusal_status(reason))
        draft = ApplyDraftSerializer(data=request.data)
        draft.is_valid(raise_exception=True)
        application = NeedApplication.objects.create(
            need=need, user=request.user, message=draft.validated_data.get('message', '')
        )
        return Response(NeedApplicationSerializer(application).data, status=status.HTTP_201_CREATED)

    @action(detail=True, methods=['post'], permission_classes=[permissions.IsAuthenticated, _NeedsGate])
    def withdraw(self, request, pk=None):
        need = self.get_object()
        application = get_object_or_404(need.applications, user=request.user)
        # Withdrawing is decided-once too: only a still-live application (pending, or accepted and
        # now backed out of) has anything to withdraw. `already_decided` reused deliberately —
        # declined/withdrawn is the same "this is already settled" shape `decide_block_reason`
        # answers for a manager.
        if application.status not in ('pending', 'accepted'):
            return Response({'detail': rules.ALREADY_DECIDED}, status=status.HTTP_409_CONFLICT)
        claimed = NeedApplication.objects.filter(pk=application.pk, status=application.status).update(
            status='withdrawn'
        )
        if not claimed:
            return Response({'detail': rules.ALREADY_DECIDED}, status=status.HTTP_409_CONFLICT)
        application.refresh_from_db()
        rules.recount(need)
        return Response(NeedApplicationSerializer(application).data)

    @action(detail=True, methods=['get'], permission_classes=[permissions.IsAuthenticated, _NeedsGate])
    def applications(self, request, pk=None):
        """The manager's queue. Not public information on any node this seam covers (`config/
        views.py: NodeStaffView`'s own reasoning) — a non-manager gets the same 404 a stranger to
        the need itself would, house rule 4 applied one level down."""
        need = self.get_object()
        if not rules.can_manage(request.user, need):
            raise Http404
        rows = need.applications.select_related('user', 'user__profile', 'decided_by', 'decided_by__profile')
        return Response(NeedApplicationSerializer(rows, many=True).data)


class NeedApplicationViewSet(viewsets.GenericViewSet):
    """`/api/need-applications/{id}/decide/` only — an application has no other API of its own; it
    is read as part of its need (`NeedViewSet.applications`) or as part of `needs/work.py`."""

    permission_classes = [permissions.IsAuthenticated, _NeedsGate]
    serializer_class = NeedApplicationSerializer
    queryset = NeedApplication.objects.select_related('need', 'need__content_type', 'user')

    @action(detail=True, methods=['post'])
    def decide(self, request, pk=None):
        application = get_object_or_404(self.get_queryset(), pk=pk)
        need = application.need
        if not rules.can_manage(request.user, need):
            raise Http404
        draft = DecideSerializer(data=request.data)
        draft.is_valid(raise_exception=True)
        reason = rules.decide_block_reason(application)
        if reason:
            return Response({'detail': reason}, status=status.HTTP_409_CONFLICT)
        new_status = 'accepted' if draft.validated_data['decision'] == 'accept' else 'declined'
        claimed = NeedApplication.objects.filter(pk=application.pk, status='pending').update(
            status=new_status, decided_by=request.user, decided_at=timezone.now()
        )
        if not claimed:
            return Response({'detail': rules.ALREADY_DECIDED}, status=status.HTTP_409_CONFLICT)
        application.refresh_from_db()
        rules.recount(need)
        return Response(NeedApplicationSerializer(application).data)
