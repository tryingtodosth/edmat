from rest_framework import permissions
from rest_framework.response import Response
from rest_framework.views import APIView

from moderation.permissions import feature_gate

from . import presets


class ContestPresetsView(APIView):
    """`GET /api/contest-presets/` — the presets a founder may start from, in the order the wizard
    shows them. Public, because the list is also what `/about/contests` explains; behind the flag
    like everything else here."""

    permission_classes = [permissions.AllowAny, feature_gate('contests')]

    def get(self, request):
        return Response(presets.as_api(request.user))
