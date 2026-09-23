"""`/api/events/{id}/documents/`, `/api/documents/{id}/…` and the protected file endpoint.

Two halves of one rule, exactly as house rule 4 asks for them:

- **Visibility is a queryset filter.** `get_queryset` narrows to documents of events this person can
  see at all, so a draft event's document does not exist for a stranger.
- **Authority is an object-level check**, because a filter never runs for an action that arrives
  with an id in the URL. Every action below asks `access.py` before it reads or writes anything, and
  the refusal is a **404 for a tier you do not have** (the honest answer: for you, this document
  does not exist) and a **403 for something you can see but may not change**.

The list endpoint hangs off `/api/events/{id}/…` without touching `events/urls.py`: the router
registered there generates patterns for its own declared actions only, so `events/7/documents/`
falls through the whole of `events.urls` and is matched here. That is what keeps this step's API
surface inside its own app (CONFERENCE-BRIEF.md §4 rule 1).
"""

from __future__ import annotations

from urllib.parse import quote

from django.core.exceptions import ValidationError as DjangoValidationError
from django.db import IntegrityError
from django.http import FileResponse, Http404
from django.shortcuts import get_object_or_404
from django.utils import timezone
from django.utils.text import slugify
from rest_framework import mixins, permissions, status, viewsets
from rest_framework.decorators import action
from rest_framework.response import Response
from rest_framework.throttling import ScopedRateThrottle
from rest_framework.views import APIView

from moderation.permissions import feature_gate

from .access import (
    can_manage_documents,
    can_read_document,
    visible_documents,
    visible_events,
    visible_tiers_for,
)
from .models import KIND_FILE, DocumentAcknowledgement, EventDocument
from .serializers import (
    DocumentAcknowledgementRowSerializer,
    EventDocumentSerializer,
    EventDocumentWriteSerializer,
)

_DocumentsGate = feature_gate('event_documents')
_READ_OR_WRITE = [permissions.IsAuthenticatedOrReadOnly, _DocumentsGate]


def _event_or_404(request, event_id):
    return get_object_or_404(visible_events(request.user), pk=event_id)


class EventDocumentsView(APIView):
    """`GET` the documents of one event, filtered to the reader's tiers; `POST` a new one.

    A bare array on GET, like every other list in this API — what an organiser needs beyond the
    rows (who still owes an acknowledgement) is derivable from `requires_acknowledgement` and the
    per-reader `acknowledged` field, so a second shape would be a second thing to keep in step.
    """

    permission_classes = _READ_OR_WRITE
    throttle_classes = [ScopedRateThrottle]
    throttle_scope = 'event_document'

    def get_throttles(self):
        # Reading a list costs a query; uploading costs a decode and a re-encode. Only the second
        # needs a rate (the `sketch`/`gallery_image` precedent).
        return super().get_throttles() if self.request.method == 'POST' else []

    def get(self, request, event_id):
        event = _event_or_404(request, event_id)
        rows = visible_documents(request.user, event)
        return Response(
            EventDocumentSerializer(rows, many=True, context={'request': request}).data
        )

    def post(self, request, event_id):
        event = _event_or_404(request, event_id)
        if not can_manage_documents(request.user, event):
            return Response(status=status.HTTP_403_FORBIDDEN)
        serializer = EventDocumentWriteSerializer(data=request.data, context={'request': request})
        serializer.is_valid(raise_exception=True)
        document = serializer.build(event=event, user=request.user)
        document.save()
        return Response(
            EventDocumentSerializer(document, context={'request': request}).data,
            status=status.HTTP_201_CREATED,
        )


class EventAcknowledgementsView(APIView):
    """The organiser's read-receipt table: for every mandatory document, who has read it and who
    has not.

    The "has not" half is the whole point — a list of acknowledgements alone answers a question
    nobody asks. Who is EXPECTED to read a document follows from its tier: an organisers-only
    briefing is owed by organisers, a staff one by every staff member, an attendee one by everybody
    holding a seat as well. The `venue` tier has no enumerable audience until step A lands, so it
    lists whoever has actually acknowledged and expects nobody — an honest gap rather than a guess.
    """

    permission_classes = [permissions.IsAuthenticated, _DocumentsGate]

    def get(self, request, event_id):
        event = _event_or_404(request, event_id)
        if not can_manage_documents(request.user, event):
            return Response(status=status.HTTP_403_FORBIDDEN)
        documents = list(
            event.documents.filter(
                requires_acknowledgement=True, replaced_by__isnull=True, removed_at__isnull=True
            ).order_by('visibility', 'title', 'id')
        )
        acknowledged = {
            (row.document_id, row.user_id): row
            for row in DocumentAcknowledgement.objects.filter(
                document__in=documents
            ).select_related('user', 'user__profile')
        }
        rows = []
        for document in documents:
            for person in _expected_readers(event, document):
                match = acknowledged.get((document.pk, person.pk))
                rows.append(
                    {
                        'user': person,
                        'document_id': document.pk,
                        'version': match.version if match else document.version,
                        'acknowledged_at': match.acknowledged_at if match else None,
                        'outstanding': match is None or match.version != document.version,
                    }
                )
        return Response(DocumentAcknowledgementRowSerializer(rows, many=True).data)


def _expected_readers(event, document):
    """The people whose names belong in the table for this document, deduplicated and in a stable
    order. Asks `visible_tiers_for` per person rather than re-deriving the ladder — the one place
    that rule is written stays the one place it is read."""
    candidates = [row.user for row in event.staff.select_related('user', 'user__profile').all()]
    if document.visibility in ('public', 'attendees'):
        from events.models import SEAT_HOLDING_STATUSES

        candidates += [
            row.attendee
            for row in event.attendances.filter(
                status__in=SEAT_HOLDING_STATUSES
            ).select_related('attendee', 'attendee__profile')
        ]
    seen, out = set(), []
    for person in candidates:
        if person.pk in seen:
            continue
        seen.add(person.pk)
        if document.visibility in visible_tiers_for(person, event):
            out.append(person)
    return out


class DocumentViewSet(
    mixins.RetrieveModelMixin,
    mixins.UpdateModelMixin,
    mixins.DestroyModelMixin,
    viewsets.GenericViewSet,
):
    permission_classes = _READ_OR_WRITE
    serializer_class = EventDocumentSerializer
    throttle_classes = [ScopedRateThrottle]
    throttle_scope = 'event_document'

    def get_throttles(self):
        return super().get_throttles() if self.action == 'replace' else []

    def get_queryset(self):
        return (
            EventDocument.objects.filter(event__in=visible_events(self.request.user))
            .select_related('event', 'event__host', 'uploaded_by', 'uploaded_by__profile')
            .prefetch_related('acknowledgements', 'event__staff')
        )

    def _readable(self):
        """The object-level half. Below the tier is a 404, deliberately: a staff briefing an
        attendee can prove exists is already half a leak."""
        document = self.get_object()
        if not can_read_document(self.request.user, document):
            raise Http404
        return document

    def retrieve(self, request, *args, **kwargs):
        document = self._readable()
        return Response(EventDocumentSerializer(document, context={'request': request}).data)

    def update(self, request, *args, **kwargs):
        """Title, tier and whether it must be acknowledged. The FILE is never edited in place — that
        is `replace`, which writes a new version, because an in-place swap would leave every
        acknowledgement pointing at text nobody agreed to."""
        document = self._readable()
        if not can_manage_documents(request.user, document.event):
            return Response(status=status.HTTP_403_FORBIDDEN)
        for field in ('title', 'visibility', 'requires_acknowledgement'):
            if field in request.data:
                setattr(document, field, request.data[field])
        try:
            # The model is what says which tiers exist and what a document of each kind must carry,
            # so an invented tier is refused here rather than by a second list in this view.
            document.full_clean(exclude=['file', 'url', 'event', 'uploaded_by', 'replaced_by'])
        except DjangoValidationError as exc:
            return Response(
                getattr(exc, 'message_dict', {'detail': exc.messages}),
                status=status.HTTP_400_BAD_REQUEST,
            )
        document.save(update_fields=['title', 'visibility', 'requires_acknowledgement'])
        return Response(EventDocumentSerializer(document, context={'request': request}).data)

    def partial_update(self, request, *args, **kwargs):
        return self.update(request, *args, **kwargs)

    def destroy(self, request, *args, **kwargs):
        """A tombstone (house rule 12), not a row deletion: the read receipts stay answerable, and
        so does "what was posted on the day". It leaves every list immediately, which is the part
        the organiser actually asked for."""
        document = self._readable()
        if not can_manage_documents(request.user, document.event):
            return Response(status=status.HTTP_403_FORBIDDEN)
        if document.removed_at is None:
            document.removed_at = timezone.now()
            document.removed_by = request.user
            document.save(update_fields=['removed_at', 'removed_by'])
        return Response(status=status.HTTP_204_NO_CONTENT)

    @action(detail=True, methods=['get'], permission_classes=_READ_OR_WRITE)
    def file(self, request, pk=None):
        """The bytes, tier-checked on every single request.

        Never a `/media/` URL: the web server has no idea who is asking, so a static path would make
        every tier decision above decorative. `Content-Disposition: attachment` unconditionally —
        the frontend fetches this through `lib/api/client.ts` and renders it itself (pdf.js, or an
        object URL for a picture), so nothing needs the browser to display it in place, and an
        attachment header is one less way for a file on the API's own origin to become a page on it.
        The filename is rebuilt from the title: what was uploaded is untrusted input and was thrown
        away at upload time anyway.
        """
        document = self._readable()
        if document.kind != KIND_FILE or not document.file:
            raise Http404
        response = FileResponse(
            document.file.open('rb'), content_type=document.content_type or 'application/octet-stream'
        )
        name = _download_name(document)
        # Both forms: a plain ASCII fallback for old clients, and RFC 5987 for the real name. The
        # ASCII one is slugified, so there is no quote or newline left to break out of the header.
        response['Content-Disposition'] = (
            f'attachment; filename="{name["ascii"]}"; filename*=UTF-8\'\'{quote(name["utf8"])}'
        )
        response['X-Content-Type-Options'] = 'nosniff'
        return response

    @action(detail=True, methods=['post'], permission_classes=[permissions.IsAuthenticated, _DocumentsGate])
    def acknowledge(self, request, pk=None):
        """"Read and understood", recorded against the version that was on screen.

        A superseded or withdrawn document refuses with 409 rather than 400: the request was fine,
        the world moved (root CLAUDE.md's API conventions). The client's answer is to reload and
        acknowledge the current version — acknowledging the old one would put a name against text
        that is no longer the instruction.
        """
        document = self._readable()
        if document.replaced_by_id is not None:
            return Response(
                {'detail': 'superseded', 'document': document.replaced_by_id},
                status=status.HTTP_409_CONFLICT,
            )
        if document.removed_at is not None:
            return Response({'detail': 'withdrawn'}, status=status.HTTP_409_CONFLICT)
        try:
            DocumentAcknowledgement.objects.get_or_create(
                document=document, user=request.user, version=document.version
            )
        except IntegrityError:
            # Two taps racing each other. The row exists either way, which is the outcome asked for.
            pass
        document.refresh_from_db()
        return Response(EventDocumentSerializer(document, context={'request': request}).data)

    @action(detail=True, methods=['post'])
    def replace(self, request, pk=None):
        """Upload the next version: a NEW row at `version + 1`, with the old one pointing at it.

        Not an edit, for the reason the model docstring gives — an in-place swap silently converts
        everybody's "I have read it" into a claim about text they never saw. The new row inherits the
        tier and the mandatory flag unless the form says otherwise, and every acknowledgement of the
        old version stays exactly where it was, attached to the version it was made about.
        """
        document = self._readable()
        if not can_manage_documents(request.user, document.event):
            return Response(status=status.HTTP_403_FORBIDDEN)
        if document.replaced_by_id is not None:
            return Response(
                {'detail': 'superseded', 'document': document.replaced_by_id},
                status=status.HTTP_409_CONFLICT,
            )
        data = request.data.copy()
        data.setdefault('title', document.title)
        data.setdefault('visibility', document.visibility)
        data.setdefault('kind', document.kind)
        if 'requires_acknowledgement' not in data:
            data['requires_acknowledgement'] = document.requires_acknowledgement
        serializer = EventDocumentWriteSerializer(data=data, context={'request': request})
        serializer.is_valid(raise_exception=True)
        replacement = serializer.build(
            event=document.event, user=request.user, version=document.version + 1
        )
        replacement.save()
        # Two fast statements on one table — the shape `backend/CLAUDE.md` says `atomic()` is for;
        # left without one deliberately, because the failure mode of the second statement not
        # landing is a visible duplicate an organiser can retire, not a lost acknowledgement.
        document.replaced_by = replacement
        document.save(update_fields=['replaced_by'])
        return Response(
            EventDocumentSerializer(replacement, context={'request': request}).data,
            status=status.HTTP_201_CREATED,
        )


def _download_name(document) -> dict[str, str]:
    extension = '.pdf' if (document.content_type or '').endswith('pdf') else '.webp'
    stem = slugify(document.title) or 'document'
    return {'ascii': f'{stem}{extension}', 'utf8': f'{document.title}{extension}'}
