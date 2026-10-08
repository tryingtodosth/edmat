"""The `ai-assistance` endpoints. Thin by this codebase's convention — every judgement is
`rules.py`'s, and every one of these views ends by answering with the same reading, so a client
never has to re-ask after writing.

One batched READ and three per-target WRITES, and the batch is the reason the four target kinds'
own serializers in three different apps were left alone: a page asks once for every chip it has
just drawn (`provideAiAssistance` on the frontend), which is one request per page instead of a
field on `Exercise`, `SolutionEntry`, `Comment` and `Review` and the N+1 that a GenericForeignKey
aggregate on a list serializer invites.
"""

from __future__ import annotations

from django.contrib.contenttypes.models import ContentType
from django.shortcuts import get_object_or_404
from rest_framework import status
from rest_framework.permissions import AllowAny, IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from accounts.minors import is_minor
from moderation.permissions import feature_gate

from . import rules
from .models import AssistanceVote, AuthorMark, ScoreLock
from .serializers import AuthorMarkSerializer, ScoreLockSerializer, VoteSerializer
from .targets import model_for

#: The one kill switch (`moderation` migration 0049). Off, the whole surface closes to an ordinary
#: visitor and the frontend takes its chips and its menu items with it — house rule 3.
_GATE = feature_gate('ai_assisted')

#: How many targets one batch read may ask about. A page draws a statement, a handful of entries, a
#: thread and a few reviews; a cap means a crafted querystring cannot turn one request into a scan.
MAX_BATCH_TARGETS = 200


def _parse_targets(raw: str):
    """`"exercise:12,comment:9"` -> `[('exercise', '12'), ('comment', '9')]`. Malformed segments are
    dropped rather than refused: a batch is a set of independent questions."""
    pairs = []
    for segment in (raw or '').split(','):
        segment = segment.strip()
        if not segment or ':' not in segment:
            continue
        kind, _, obj_id = segment.partition(':')
        pairs.append((kind.strip(), obj_id.strip()))
        if len(pairs) >= MAX_BATCH_TARGETS:
            break
    return pairs


class AssistanceSummaryView(APIView):
    """`GET /api/ai-assistance/?targets=<kind>:<id>,...`

    Public, because the content it describes is public and a reader deciding whether to trust a
    solution is exactly who the badge is for. Signed in, the reading also carries `my_confidence`
    and the three `can_*` answers.
    """

    permission_classes = [AllowAny, _GATE]

    def get(self, request):
        pairs = _parse_targets(request.query_params.get('targets', ''))
        user = request.user if request.user.is_authenticated else None
        return Response(rules.summaries_for(pairs, user))


class _TargetView(APIView):
    """Shared resolution for the three write endpoints: the kind, the row, and the object-level
    check — asked explicitly, before any mutation, because a queryset filter never runs for an
    action that arrives with an id in the URL (house rule 4)."""

    permission_classes = [IsAuthenticated, _GATE]

    def _target(self, request, kind, pk):
        model = model_for(kind)
        if model is None:
            return None
        obj = get_object_or_404(model, pk=pk)
        # A stranger poking at a draft gets 404, because for them it does not exist.
        if not rules.is_readable(obj, request.user):
            return None
        return obj


class VoteView(_TargetView):
    """`PUT /api/ai-assistance/<kind>/<pk>/vote/` with `{"confidence": 0..100}`, and `DELETE` to
    take it back.

    PUT rather than POST because it is an upsert of the one row this person is allowed: voting
    twice is changing your mind, not voting twice, and the row carries `updated_at` to say when you
    last looked.
    """

    def put(self, request, kind, pk):
        obj = self._target(request, kind, pk)
        if obj is None:
            return Response(status=status.HTTP_404_NOT_FOUND)
        if not rules.can_vote(request.user, obj):
            # The author of the thing. The reason is the refusal (house rule 6) — the frontend
            # shows the author their own mark instead.
            return Response(
                {'detail': 'author_marks_instead'}, status=status.HTTP_403_FORBIDDEN
            )
        serializer = VoteSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        AssistanceVote.objects.update_or_create(
            content_type=ContentType.objects.get_for_model(type(obj)),
            object_id=obj.pk,
            voter=request.user,
            defaults={'confidence': serializer.validated_data['confidence']},
        )
        return Response(rules.summary_for(obj, request.user))

    def delete(self, request, kind, pk):
        obj = self._target(request, kind, pk)
        if obj is None:
            return Response(status=status.HTTP_404_NOT_FOUND)
        AssistanceVote.objects.filter(
            content_type=ContentType.objects.get_for_model(type(obj)),
            object_id=obj.pk,
            voter=request.user,
        ).delete()
        return Response(rules.summary_for(obj, request.user))


class AuthorMarkView(_TargetView):
    """`PUT /api/ai-assistance/<kind>/<pk>/author-mark/` with `{"assisted": bool, "note": "…"}`.

    The author's own disclosure, and the only write here that is about the content rather than
    about an opinion of it. `DELETE` takes the answer back to "nobody has said", which is a
    different state from "the author says no" and so needs its own way to be reached.
    """

    def put(self, request, kind, pk):
        obj = self._target(request, kind, pk)
        if obj is None:
            return Response(status=status.HTTP_404_NOT_FOUND)
        if not rules.can_declare(request.user, obj):
            return Response({'detail': 'not_the_author'}, status=status.HTTP_403_FORBIDDEN)
        serializer = AuthorMarkSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        note = serializer.validated_data.get('note', '')
        # A minor's mark counts; a minor's free text does not go live unreviewed. Rather than hold
        # the disclosure itself (which would hide a fact a reader wants, and `AuthorMark` has no
        # `auto_hidden_at` for `accounts.minors.hold_for_review` to use), the note is simply not
        # taken — the same trade the owner's own spec makes for votes ("a vote carries no free
        # text"), applied to the one field here that has any.
        if is_minor(request.user):
            note = ''
        AuthorMark.objects.update_or_create(
            content_type=ContentType.objects.get_for_model(type(obj)),
            object_id=obj.pk,
            defaults={
                'assisted': serializer.validated_data['assisted'],
                'note': note,
                'declared_by': request.user,
                'version_label': _version_label(obj),
            },
        )
        return Response(rules.summary_for(obj, request.user))

    def delete(self, request, kind, pk):
        obj = self._target(request, kind, pk)
        if obj is None:
            return Response(status=status.HTTP_404_NOT_FOUND)
        if not rules.can_declare(request.user, obj):
            return Response({'detail': 'not_the_author'}, status=status.HTTP_403_FORBIDDEN)
        AuthorMark.objects.filter(
            content_type=ContentType.objects.get_for_model(type(obj)), object_id=obj.pk
        ).delete()
        return Response(rules.summary_for(obj, request.user))


class ScoreLockView(_TargetView):
    """`PUT /api/ai-assistance/<kind>/<pk>/lock/` with `{"value": 0..100, "reason": "…"}`, and
    `DELETE` to unlock — the moderator's quick action off the content's own menu, so that ending
    an argument does not mean going to find the row in Django admin."""

    def put(self, request, kind, pk):
        obj = self._target(request, kind, pk)
        if obj is None:
            return Response(status=status.HTTP_404_NOT_FOUND)
        if not rules.can_lock(request.user, obj):
            return Response(status=status.HTTP_403_FORBIDDEN)
        serializer = ScoreLockSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        ScoreLock.objects.update_or_create(
            content_type=ContentType.objects.get_for_model(type(obj)),
            object_id=obj.pk,
            defaults={
                'value': serializer.validated_data['value'],
                'reason': serializer.validated_data['reason'],
                'locked_by': request.user,
            },
        )
        return Response(rules.summary_for(obj, request.user))

    def delete(self, request, kind, pk):
        obj = self._target(request, kind, pk)
        if obj is None:
            return Response(status=status.HTTP_404_NOT_FOUND)
        if not rules.can_lock(request.user, obj):
            return Response(status=status.HTTP_403_FORBIDDEN)
        ScoreLock.objects.filter(
            content_type=ContentType.objects.get_for_model(type(obj)), object_id=obj.pk
        ).delete()
        return Response(rules.summary_for(obj, request.user))


def _version_label(obj) -> str:
    """"At which version" — the owner's task asks the author's mark to record it. Free text, and
    honest about the three kinds that do not version themselves: for them it is the timestamp of
    the body the author was looking at when they answered."""
    stamp = getattr(obj, 'updated_at', None) or getattr(obj, 'created_at', None)
    return stamp.isoformat(timespec='seconds') if stamp is not None else ''
