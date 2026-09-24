"""The personal work dashboard endpoint."""

from rest_framework.decorators import api_view, permission_classes
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from moderation.permissions import feature_gate
from .providers import collect


@api_view(['GET'])
@permission_classes([IsAuthenticated])
def work_dashboard(request):
    """GET /api/work/ — all work items waiting on me, aggregated from every module.

    Returns {
        'sections': [
            {'key': '...', 'items': [...]},
            ...
        ],
        'unavailable': [keys where the provider raised],
        'generated_at': ISO timestamp
    }

    Gated by feature_gate('work_dashboard').
    """
    if not feature_gate('work_dashboard', user=request.user):
        return Response({'detail': 'Feature not enabled'}, status=403)

    result = collect(request.user)
    return Response(result)
