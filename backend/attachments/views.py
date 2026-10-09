"""`/api/attachments/…` and the two target-scoped list endpoints.

Two halves of one rule, exactly as house rule 4 asks for them:

- **Visibility is a queryset filter.** `visible_attachments` narrows to the tiers this reader has
  on this target, so a staff-only file does not exist for a participant.
- **Authority is an object-level check**, because a filter never runs for an action that arrives
  with an id in the URL. Every action below asks `access.py` before it reads or writes anything, and
  the refusal is a **404 for a tier you do not have** (the honest answer: for you, this attachment
  does not exist) and a **403 for something you can see but may not change**.

The list endpoint hangs off `/api/<kind>/<id>/attachments/` through one pattern rather than nine,
because the kind is a word in the registry and not a route each app has to add.
"""

from __future__ import annotations

from urllib.parse import quote

from django.db import IntegrityError
from django.http import FileResponse, Http404
from django.utils import timezone
from django.utils.text import slugify
from rest_framework import permissions, status, viewsets
from rest_framework.decorators import action
from rest_framework.response import Response
from rest_framework.throttling import ScopedRateThrottle
from rest_framework.views import APIView

from moderation.permissions import feature_gate

from . import targets
from .access import (
    can_attach,
    can_manage_attachments,
    can_read_attachment,
    can_view_target,
    tier_block_reason,
    visible_attachments,
)
from .files import extension_for
from .models import KIND_FILE, Acknowledgement, Attachment
from .serializers import (
    AcknowledgementSerializer,
    AttachmentSerializer,
    AttachmentWriteSerializer,
)

_AttachmentsGate = feature_gate('attachments')
_READ_OR_WRITE = [permissions.IsAuthenticatedOrReadOnly, _AttachmentsGate]


def _target_or_404(request, kind, pk):
    """The thing an attachment hangs off, or 404 — for a stranger it does not exist (house rule 4),
    and that is the same answer whether the kind is unknown, the row is missing or the reader may
    not see it. Three different facts, one honest response: anything else is a probe."""
    target = targets.resolve_target(kind, pk)
    if target is None or not can_view_target(request.user, target):
        raise Http404
    return target


class TargetAttachmentsView(APIView):
    """`GET` the attachments of one thing, filtered to the reader's tiers; `POST` a new one.

    A bare array on GET, like every other list in this API — what a manager needs beyond the rows
    (who still owes a reading) is derivable from `requires_acknowledgement` and the per-reader
    `acknowledged` field, so a second shape would be a second thing to keep in step.
    """

    permission_classes = _READ_OR_WRITE
    throttle_classes = [ScopedRateThrottle]
    throttle_scope = 'attachment'

    def get_throttles(self):
        # Reading a list is not what needs rate-limiting here; writing bytes is.
        return super().get_throttles() if self.request.method == 'POST' else []

    def get(self, request, kind, pk):
        target = _target_or_404(request, kind, pk)
        rows = visible_attachments(request.user, target)
        return Response(AttachmentSerializer(rows, many=True, context={'request': request}).data)

    def post(self, request, kind, pk):
        target = _target_or_404(request, kind, pk)
        if not can_attach(request.user, target):
            # 403 and not 404: they can see the thing, so pretending it does not exist would be a
            # lie they can disprove by looking at the page they are on.
            return Response({'detail': 'not_allowed'}, status=status.HTTP_403_FORBIDDEN)

        write = AttachmentWriteSerializer(data=request.data)
        write.is_valid(raise_exception=True)

        blocked = tier_block_reason(target, write.validated_data.get('visibility', 'members'))
        if blocked:
            return Response({'detail': blocked}, status=status.HTTP_400_BAD_REQUEST)
        if write.validated_data.get('requires_acknowledgement') and not can_manage_attachments(
            request.user, target
        ):
            # A mandatory reading is an instruction to everybody else, so it is a manager's act even
            # where attaching is not.
            return Response({'detail': 'not_allowed_mandatory'}, status=status.HTTP_403_FORBIDDEN)

        row = write.build(target=target, user=request.user)
        row.full_clean(exclude=['content_type', 'object_id', 'file'])
        row.save()
        return Response(
            AttachmentSerializer(row, context={'request': request}).data,
            status=status.HTTP_201_CREATED,
        )


class AttachmentViewSet(viewsets.GenericViewSet):
    """Everything addressed by an attachment's own id.

    A `GenericViewSet` and not a `ModelViewSet`: there is no unscoped list of attachments and there
    never should be — a list is a question about a target, so it is that target's endpoint above. A
    model viewset would have generated `/api/attachments/` returning the lot.
    """

    permission_classes = _READ_OR_WRITE
    serializer_class = AttachmentSerializer
    queryset = Attachment.objects.all()

    def _readable(self):
        row = (
            Attachment.objects.filter(pk=self.kwargs['pk'])
            .select_related('uploaded_by', 'uploaded_by__profile', 'sketch', 'chem_drawing')
            .prefetch_related('acknowledgements')
            .first()
        )
        if row is None or not can_read_attachment(self.request.user, row):
            raise Http404
        return row

    def _manageable(self):
        row = self._readable()
        if not can_manage_attachments(self.request.user, row.target):
            return row, Response({'detail': 'not_allowed'}, status=status.HTTP_403_FORBIDDEN)
        return row, None

    def retrieve(self, request, pk=None):
        return Response(AttachmentSerializer(self._readable(), context={'request': request}).data)

    @action(detail=True, methods=['get'], permission_classes=_READ_OR_WRITE)
    def file(self, request, pk=None):
        """The bytes, tier-checked on every single request.

        Never a `/media/` URL: the web server has no idea who is asking, so a static path would make
        every tier decision above decorative. `Content-Disposition: attachment` unconditionally —
        the frontend fetches this through `lib/api/client.ts` and renders or saves it itself, so
        nothing needs the browser to display it in place, and an attachment header is one less way
        for a file on the API's own origin to become a page on it. The filename is rebuilt from the
        title: what was uploaded is untrusted input and was thrown away at upload time anyway.
        """
        row = self._readable()
        if row.kind != KIND_FILE or not row.file:
            raise Http404
        response = FileResponse(
            row.file.open('rb'), content_type=row.media_type or 'application/octet-stream'
        )
        name = _download_name(row)
        # Both forms: a plain ASCII fallback for old clients, and RFC 5987 for the real name. The
        # ASCII one is slugified, so there is no quote or newline left to break out of the header.
        response['Content-Disposition'] = (
            f'attachment; filename="{name["ascii"]}"; filename*=UTF-8\'\'{quote(name["utf8"])}'
        )
        response['X-Content-Type-Options'] = 'nosniff'
        return response

    @action(
        detail=True,
        methods=['post'],
        permission_classes=[permissions.IsAuthenticated, _AttachmentsGate],
    )
    def acknowledge(self, request, pk=None):
        """"Read and understood", recorded against the version that was on screen.

        A superseded or withdrawn row refuses with 409 rather than 400: the request was fine, the
        world moved. The client's answer is to reload and acknowledge the current version —
        acknowledging the old one would put a name against text that is no longer the instruction.
        """
        row = self._readable()
        if row.replaced_by_id is not None:
            return Response(
                {'detail': 'superseded', 'attachment': row.replaced_by_id},
                status=status.HTTP_409_CONFLICT,
            )
        if row.removed_at is not None:
            return Response({'detail': 'withdrawn'}, status=status.HTTP_409_CONFLICT)
        try:
            Acknowledgement.objects.get_or_create(
                attachment=row, user=request.user, version=row.version
            )
        except IntegrityError:
            # Two taps racing each other. The row exists either way, which is the outcome asked for.
            pass
        row.refresh_from_db()
        return Response(AttachmentSerializer(row, context={'request': request}).data)

    @action(detail=True, methods=['get'])
    def receipts(self, request, pk=None):
        """Who has read it — the half that matters, because a list of acknowledgements alone answers
        a question nobody asks. What a manager needs on the morning is who has NOT."""
        row, refusal = self._manageable()
        if refusal:
            return refusal
        rows = row.acknowledgements.select_related('user', 'user__profile')
        return Response(AcknowledgementSerializer(rows, many=True).data)

    @action(detail=True, methods=['post'])
    def replace(self, request, pk=None):
        """A replacement is a NEW ROW, and the old one keeps its bytes, its version number and
        every acknowledgement made against it (house rule 12).

        That is what makes "who had read the fire plan on the morning of the event" answerable at
        all: an in-place edit would rewrite history and silently convert everybody's "I have read
        it" into a claim about text they never saw.
        """
        old, refusal = self._manageable()
        if refusal:
            return refusal
        if old.replaced_by_id is not None:
            return Response({'detail': 'already_replaced'}, status=status.HTTP_409_CONFLICT)

        write = AttachmentWriteSerializer(data=request.data)
        write.is_valid(raise_exception=True)
        target = old.target
        blocked = tier_block_reason(target, write.validated_data.get('visibility', old.visibility))
        if blocked:
            return Response({'detail': blocked}, status=status.HTTP_400_BAD_REQUEST)

        new = write.build(target=target, user=request.user)
        new.version = old.version + 1
        new.order = old.order
        new.full_clean(exclude=['content_type', 'object_id', 'file'])
        new.save()
        # One WHERE-anchored update, never `select_for_update` (backend/CLAUDE.md rule 1): the loser
        # of a double replacement matches zero rows and is told the world moved.
        changed = Attachment.objects.filter(pk=old.pk, replaced_by__isnull=True).update(
            replaced_by=new
        )
        if not changed:
            new.delete()
            return Response({'detail': 'already_replaced'}, status=status.HTTP_409_CONFLICT)
        return Response(
            AttachmentSerializer(new, context={'request': request}).data,
            status=status.HTTP_201_CREATED,
        )

    @action(detail=True, methods=['post'])
    def withdraw(self, request, pk=None):
        """Taken down, not deleted — an acknowledgement ledger whose rows can vanish answers
        nothing, and a read receipt pointing at no attachment is worse than useless."""
        row, refusal = self._manageable()
        if refusal:
            return refusal
        changed = Attachment.objects.filter(pk=row.pk, removed_at__isnull=True).update(
            removed_at=timezone.now(), removed_by=request.user
        )
        if not changed:
            return Response({'detail': 'already_withdrawn'}, status=status.HTTP_409_CONFLICT)
        row.refresh_from_db()
        return Response(AttachmentSerializer(row, context={'request': request}).data)


def _download_name(row) -> dict[str, str]:
    extension = extension_for(row.media_type)
    stem = slugify(row.title) or 'attachment'
    return {'ascii': f'{stem}{extension}', 'utf8': f'{row.title}{extension}'}
