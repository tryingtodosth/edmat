"""`/api/materials/{id}/coop/` — the cooperation overview of one material, and its team thread.

Nested under the MATERIAL rather than the project because that is the id a reader has: the
material page is where the panel lives, and `/materials/<id>/coop` is the page's own URL. The
project id is in the answer for anything that needs the co-authoring API next.

Both halves of house rule 4: `visible_projects` is the queryset filter (a stranger asking about a
draft project's material gets 404 — for them it does not exist), and `can_manage` / `can_post`
are the object checks every write asks before touching anything. The same `coauthoring` switch
gates this surface: the overview is a view onto that app's rows, and a killed co-authoring with a
live cooperation page would be a page full of links to 403s (house rule 3).
"""

from django.db import transaction
from rest_framework import permissions, status
from rest_framework.response import Response
from rest_framework.views import APIView

from coauthoring.access import can_manage, visible_projects
from community.views import comment_thread_response
from moderation.permissions import feature_gate
from telemetry.audit import record_audit

from .models import CoopSettings
from .overview import build_overview
from .policy import can_post, post_block_reason
from .serializers import CoopOverviewSerializer, CoopSettingsWriteSerializer

_CoauthGate = feature_gate('coauthoring')


def _project_for(request, material_id):
    """The project behind a material, scoped through `visible_projects`, or None → 404.

    Prefetched to the shape `overview.build_overview` documents, so the whole answer is a bounded
    number of queries whatever the version count."""
    return (
        visible_projects(request.user)
        .filter(material_id=material_id)
        .select_related('material', 'branch', 'coop')
        .prefetch_related(
            'members__user__profile',
            'versions__created_by__profile',
            'versions__decided_by__profile',
        )
        .first()
    )


class MaterialCoopView(APIView):
    permission_classes = [permissions.IsAuthenticatedOrReadOnly, _CoauthGate]

    def get(self, request, material_id):
        project = _project_for(request, material_id)
        if project is None:
            return Response(status=status.HTTP_404_NOT_FOUND)
        return Response(CoopOverviewSerializer(build_overview(project, request.user)).data)

    def patch(self, request, material_id):
        project = _project_for(request, material_id)
        if project is None:
            return Response(status=status.HTTP_404_NOT_FOUND)
        if not can_manage(project, request.user):
            return Response({'detail': 'forbidden'}, status=status.HTTP_403_FORBIDDEN)
        serializer = CoopSettingsWriteSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        with transaction.atomic():
            row, _ = CoopSettings.objects.select_related('project').get_or_create(project=project)
            before = {'policy': row.policy, 'welcome_note': row.welcome_note}
            for field, value in serializer.validated_data.items():
                setattr(row, field, value)
            row.updated_by = request.user
            row.save()
        # Outside the atomic block, as `telemetry/audit.py` requires. A policy change is a
        # permission change in everything but name: it decides who may write here.
        record_audit(
            request,
            action='permission_change',
            target_type='material_project',
            target_id=project.pk,
            summary=f'Cooperation policy {before["policy"]} → {row.policy}',
            detail={'before': before, 'after': {'policy': row.policy, 'welcome_note': row.welcome_note}},
        )
        # Re-read so the cached reverse one-to-one on `project` is the saved row, not a stale miss.
        project = _project_for(request, material_id)
        return Response(CoopOverviewSerializer(build_overview(project, request.user)).data)


class MaterialCoopCommentsView(APIView):
    """The team thread. Hangs off the PROJECT (`community.targets`: `materialProject`, private),
    not the material — the material's own thread is the public one every reader sees on its
    page, and this is the room where the people changing it talk."""

    permission_classes = [permissions.IsAuthenticatedOrReadOnly, _CoauthGate]

    def _respond(self, request, material_id):
        project = _project_for(request, material_id)
        if project is None:
            return Response(status=status.HTTP_404_NOT_FOUND)
        if request.method == 'POST' and not can_post(project, request.user):
            return Response(
                {'detail': post_block_reason(project, request.user)},
                status=status.HTTP_403_FORBIDDEN,
            )
        return comment_thread_response(request, project)

    def get(self, request, material_id):
        return self._respond(request, material_id)

    def post(self, request, material_id):
        return self._respond(request, material_id)
