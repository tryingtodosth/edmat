"""`/api/licences/<kind>/<id>/` — one item's licence, its history, and the change.

No kill switch, deliberately — the same exception `legal` is (`LEGAL.md` §4): what a reader may do
with a piece of content is not a feature that can be switched off while the content stays up.
"""

from __future__ import annotations

from django.shortcuts import get_object_or_404
from rest_framework import status
from rest_framework.permissions import AllowAny
from rest_framework.response import Response
from rest_framework.views import APIView

from . import rules
from .targets import kind_for


def reading(obj, user) -> dict:
    """What the frontend needs to draw the licence line and, for its author, the change control."""
    return {
        'licence': obj.licence,
        'since': rules.licence_since(obj),
        'history': [
            {
                'from': row.from_licence,
                'to': row.to_licence,
                'changed_at': row.changed_at,
                'as_staff': row.as_staff,
                'note': row.note,
            }
            for row in rules.history(obj)[:20]
        ],
        'can_change': rules.can_manage(obj, user),
        'allowed': rules.allowed_targets(obj, user),
    }


class LicenceView(APIView):
    """GET — public wherever the item is public; POST `{"licence": "<key>", "note": "…"}` — the
    author (or staff) changes it. A stranger asking about an unpublished item gets 404."""

    permission_classes = [AllowAny]

    def _target(self, request, kind_name, pk):
        kind = kind_for(kind_name)
        if kind is None:
            return None
        obj = get_object_or_404(kind.model, pk=pk)
        user = request.user if request.user.is_authenticated else None
        if not kind.visible(obj) and not rules.can_manage(obj, user):
            return None
        return obj

    def get(self, request, kind, pk):
        obj = self._target(request, kind, pk)
        if obj is None:
            return Response(status=status.HTTP_404_NOT_FOUND)
        return Response(reading(obj, request.user if request.user.is_authenticated else None))

    def post(self, request, kind, pk):
        if not request.user.is_authenticated:
            return Response({'detail': 'licence_not_signed_in'}, status=status.HTTP_401_UNAUTHORIZED)
        obj = self._target(request, kind, pk)
        if obj is None:
            return Response(status=status.HTTP_404_NOT_FOUND)
        if not rules.can_manage(obj, request.user):
            # Readable, but not theirs: a real-but-wrong party is 403 (backend/CLAUDE.md).
            return Response({'detail': 'licence_not_author'}, status=status.HTTP_403_FORBIDDEN)
        new = str(request.data.get('licence') or '')
        note = str(request.data.get('note') or '')
        reason = rules.change_licence(obj, new, request.user, note)
        if reason:
            code = status.HTTP_409_CONFLICT if reason in rules.CONFLICT_REASONS else status.HTTP_400_BAD_REQUEST
            return Response({'detail': reason}, status=code)
        return Response(reading(obj, request.user))
