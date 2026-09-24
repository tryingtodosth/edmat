"""The personal work dashboard endpoint."""

from rest_framework.decorators import api_view, permission_classes
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from moderation.permissions import feature_gate
from .providers import collect

# The feature gate for the work dashboard
_WorkDashboardGate = feature_gate('work_dashboard')


@api_view(['GET'])
@permission_classes([IsAuthenticated, _WorkDashboardGate])
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
    result = collect(request.user)
    return Response(result)
