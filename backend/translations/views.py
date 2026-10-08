"""One endpoint: write a management row's text in every language at once.

There is no read endpoint, and `authority.py`'s own tail says why — every version a client needs
arrives embedded in the row it belongs to, through a queryset that has already decided whether
this reader may see that row at all.

No kill switch of its own, deliberately. A flag guards a feature SURFACE (root CLAUDE.md's
"A feature surface gets a `FeatureFlag` kill switch"), and this is not one: it is a property of
four surfaces that each already have their own switch. With `tasks` off, a task's text cannot be
reached to be translated, because the task cannot be reached.
"""

from __future__ import annotations

from django.shortcuts import get_object_or_404
from rest_framework import status
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from . import authority, resolve
from .serializers import WriteVersionsSerializer
from .services import TranslationWriteError, write_versions
from .targets import model_for


class TextVersionsView(APIView):
    """`PUT /api/text-versions/<kind>/<pk>/`

    Answers with the row's new reading and every version of it, so the editor that just submitted
    both languages never has to re-fetch the panel it lives in.
    """

    permission_classes = [IsAuthenticated]

    def put(self, request, kind, pk):
        model = model_for(kind)
        if model is None:
            return Response(status=status.HTTP_404_NOT_FOUND)
        obj = get_object_or_404(model, pk=pk)

        # The object-level check, asked explicitly before any mutation: a queryset filter never
        # runs for an action that arrives with an id in the URL (house rule 4). The refusal carries
        # its reason (house rule 6) — "this poll is already open" is not "no".
        blocked = authority.write_block_reason(request.user, obj)
        if blocked == authority.NOT_DRAFT:
            return Response({'detail': blocked}, status=status.HTTP_409_CONFLICT)
        if blocked is not None:
            # 404 and not 403 for an ordinary refusal: writes here are owner-scoped, and the root
            # CLAUDE.md's API convention is that a non-owner's write attempt is a 404.
            return Response(status=status.HTTP_404_NOT_FOUND)

        serializer = WriteVersionsSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        try:
            write_versions(
                obj,
                original_locale=serializer.validated_data['original_locale'],
                versions=serializer.validated_data['versions'],
                user=request.user,
            )
        except TranslationWriteError as error:
            return Response({'detail': str(error)}, status=status.HTTP_400_BAD_REQUEST)

        obj.refresh_from_db()
        reading = resolve.resolve(obj, request.query_params.get('lang'))
        return Response(
            {
                'heading': reading['heading'],
                'body': reading['body'],
                'text': {
                    'locale': reading['locale'],
                    'requested_locale': reading['requested_locale'],
                    'is_fallback': reading['is_fallback'],
                    'available': reading['available'],
                    'original_locale': reading['original_locale'],
                    'newer_elsewhere': reading['newer_elsewhere'],
                },
                'text_versions': resolve.versions_payload(obj),
            }
        )
