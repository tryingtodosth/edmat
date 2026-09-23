"""`/api/events/{id}/cloakroom-desks/` and `/api/cloakroom-desks/…` — the desk, from the clerk's
side of the counter.

Shape notes, because two of them are deliberate departures:

- **The event-nested list is this app's own URL**, not an `@action` on `EventViewSet`
  (`CONFERENCE-BRIEF.md` §4 rule 1: one new app per step, and nothing in `events` moves). It reads
  the same visibility filter `events` uses, imported rather than re-derived.
- **Visibility is the queryset filter; authority is an object check, and both are here** (house
  rule 4). `get_queryset` narrows desks to events the caller can see at all — a stranger poking at
  a draft event's cloakroom gets 404, because for them it does not exist. Every mutating action
  then asks `rules.can_operate` explicitly, because a filter never runs for an action that arrives
  with an id in the URL.
"""

import csv
from io import StringIO

from django.db import IntegrityError
from django.http import HttpResponse
from django.shortcuts import get_object_or_404
from rest_framework import permissions, status, viewsets
from rest_framework.decorators import action
from rest_framework.response import Response
from rest_framework.views import APIView

# `NUMERIC_PK_REGEX` rather than DRF's default `[^/.]+` for the two nested item ids below. The
# router narrows the DESK id for free (`config/routers.py`), but an `@action`'s own `url_path` is
# that action's regex and the router never sees it — so `/cloakroom-desks/3/items/undefined/return/`
# reached `get_object_or_404(..., pk='undefined')` and raised, which is a **500** for a request that
# is simply about nothing. Found by `events/test_permission_matrix.py` (17BF.H), which is exactly
# the shape §17BF.B's own fix took in `events/`.
from config.routers import NUMERIC_PK_REGEX
from moderation.permissions import feature_gate

# The one visibility rule for events, borrowed rather than copied: `events/agenda_views.py` owns
# it, `events/views.py` states the reasoning, and a second hand-written copy here is how two
# surfaces start disagreeing about whose draft is whose.
from events.agenda_views import _visible_events as visible_events
# Integration (CONFERENCE-BRIEF.md §5): the same 409 `briefing_unread` the check-in button answers
# with, on the desk's writes — a clerk who has not read the building's briefing does not take coats.
from documents.access import briefing_block_reason
from . import rules
from .models import CloakroomDesk
from .serializers import (
    CloakroomDeskSerializer,
    CloakroomItemSerializer,
    DepositSerializer,
    ExceptionReturnSerializer,
    PublicDeskSerializer,
)

_CloakroomGate = feature_gate('cloakroom')


def _desk_payload(desk, user):
    """A desk as its reader is allowed to know it: the whole counter for somebody working it, the
    "there is a cloakroom at …" line for everybody else."""
    if rules.can_operate(user, desk.event):
        data = CloakroomDeskSerializer(desk).data
        data['can_operate'] = True
        return data
    data = PublicDeskSerializer(desk).data
    data['can_operate'] = False
    return data


class EventCloakroomDesksView(APIView):
    """`/api/events/{event_id}/cloakroom-desks/` — the desks of one event.

    GET is open to anybody who can see the event (an attendee needs to be told there IS a
    cloakroom); POST creates one and is **organiser-only**, unlike operating it: hanging coats is
    a shift, deciding that there are 120 hooks at the north entrance is running the event.
    """

    permission_classes = [permissions.IsAuthenticatedOrReadOnly, _CloakroomGate]

    def _event(self, request, event_id):
        return get_object_or_404(visible_events(request.user), pk=event_id)

    def get(self, request, event_id):
        event = self._event(request, event_id)
        desks = event.cloakroom_desks.prefetch_related('items')
        return Response([_desk_payload(desk, request.user) for desk in desks])

    def post(self, request, event_id):
        event = self._event(request, event_id)
        if not event.can_organise(request.user):
            return Response({'detail': rules.NOT_STAFF}, status=status.HTTP_403_FORBIDDEN)
        serializer = CloakroomDeskSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        desk = serializer.save(event=event, created_by=request.user)
        return Response(_desk_payload(desk, request.user), status=status.HTTP_201_CREATED)


class CloakroomDeskViewSet(viewsets.GenericViewSet):
    """One desk and everything done at it. Not a `ModelViewSet`: `create` lives on the event-nested
    view above (a desk without an event is not a thing), and `list` across every event is not a
    question anybody asks."""

    permission_classes = [permissions.IsAuthenticatedOrReadOnly, _CloakroomGate]
    serializer_class = CloakroomDeskSerializer

    def get_queryset(self):
        return CloakroomDesk.objects.filter(
            event__in=visible_events(self.request.user)
        ).select_related('event').prefetch_related('items', 'event__staff')

    def _operable(self, desk):
        """The object-level half of house rule 4. Returns a refusal response, or `None`."""
        if not rules.can_operate(self.request.user, desk.event):
            return Response({'detail': rules.NOT_STAFF}, status=status.HTTP_403_FORBIDDEN)
        return None

    def _briefed(self, desk):
        """The briefing gate (documents/access.py), for the writes only: reading the rack grid
        while the briefing is still open in the other tab is fine; taking a coat is not."""
        block = briefing_block_reason(desk.event, self.request.user)
        if block:
            return Response(block, status=status.HTTP_409_CONFLICT)
        return None

    def retrieve(self, request, pk=None):
        return Response(_desk_payload(self.get_object(), request.user))

    def partial_update(self, request, pk=None):
        """Rename the desk, re-type the racks, change the note. Organiser-only, like creating it.

        Racks already carrying a coat are not protected here — a label removed from the list leaves
        the grid but the item keeps its own copy of the string (`CloakroomItem.rack_label`), so the
        coat is still findable and the reconciliation list still names the right hook.
        """
        desk = self.get_object()
        if not desk.event.can_organise(request.user):
            return Response({'detail': rules.NOT_STAFF}, status=status.HTTP_403_FORBIDDEN)
        serializer = CloakroomDeskSerializer(desk, data=request.data, partial=True)
        serializer.is_valid(raise_exception=True)
        serializer.save()
        return Response(_desk_payload(desk, request.user))

    def destroy(self, request, pk=None):
        """Only while nothing has ever been left here. A desk that took a coat is a record of an
        evening (house rule 12) — closing it is `reconcile`, not deletion."""
        desk = self.get_object()
        if not desk.event.can_organise(request.user):
            return Response({'detail': rules.NOT_STAFF}, status=status.HTTP_403_FORBIDDEN)
        if desk.items.exists():
            return Response({'detail': 'has_items'}, status=status.HTTP_409_CONFLICT)
        desk.delete()
        return Response(status=status.HTTP_204_NO_CONTENT)

    @action(detail=True, methods=['get', 'post'], permission_classes=[permissions.IsAuthenticated, _CloakroomGate])
    def items(self, request, pk=None):
        """GET: everything this desk has ever held, newest first. POST: take a coat in, and hand
        back the token — **the only time the token is minted**, and the only response that is worth
        printing."""
        desk = self.get_object()
        refused = self._operable(desk)
        if refused:
            return refused
        if request.method == 'GET':
            return Response(CloakroomItemSerializer(desk.items.all(), many=True).data)
        briefing = self._briefed(desk)
        if briefing:
            return briefing

        serializer = DepositSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        label = serializer.validated_data['rack_label'].strip()
        reason = rules.deposit_block_reason(request.user, desk, label)
        if reason:
            # `rack_taken` and `desk_closed` are the world having moved (409); `unknown_rack` is a
            # request naming a hook this desk does not have (400). Root CLAUDE.md: do not conflate
            # the two.
            code = status.HTTP_400_BAD_REQUEST if reason == rules.UNKNOWN_RACK else status.HTTP_409_CONFLICT
            return Response({'detail': reason}, status=code)
        try:
            item = desk.items.create(
                rack_label=label,
                token=desk.new_token(),
                description=serializer.validated_data.get('description', '').strip()[:200],
                deposited_by=request.user,
            )
        except IntegrityError:
            # The partial unique constraint firing means the other clerk got there between the
            # check above and this insert. The honest answer is the same one they would have seen.
            return Response({'detail': rules.RACK_TAKEN}, status=status.HTTP_409_CONFLICT)
        return Response(CloakroomItemSerializer(item).data, status=status.HTTP_201_CREATED)

    # `url_path` spelled out because `return` is a Python keyword and cannot name a method.
    @action(detail=True, methods=['post'], url_path='return',
            permission_classes=[permissions.IsAuthenticated, _CloakroomGate])
    def return_by_token(self, request, pk=None):
        """`POST …/return/` with `{"token": "…"}` — the Return flow's own endpoint, because the
        clerk scans or types a **token**, never an item id; the id is exactly the thing this design
        refuses to put on the slip.

        Always 200 with a `result`, never a 404 for an unknown token: every verdict is a sentence
        the clerk says out loud, and an HTTP status cannot carry which one. (The 409 below is the
        one exception, and it is not a verdict but a race: two clerks scanned the same slip.)
        """
        desk = self.get_object()
        refused = self._operable(desk)
        if refused:
            return refused
        briefing = self._briefed(desk)
        if briefing:
            return briefing
        result, item = rules.return_result(desk, request.data.get('token', ''))
        if result == rules.RETURNED and not rules.hand_back(item, request.user):
            return Response({'result': rules.ALREADY_RETURNED}, status=status.HTTP_409_CONFLICT)
        return Response({
            'result': result,
            'item': CloakroomItemSerializer(item).data if item else None,
        })

    @action(
        detail=True, methods=['post'], url_path=f'items/(?P<item_id>{NUMERIC_PK_REGEX})/return',
        permission_classes=[permissions.IsAuthenticated, _CloakroomGate],
    )
    def item_return(self, request, pk=None, item_id=None):
        """The same hand-back, addressed by the item the clerk tapped on the rack grid — for the
        slip that has gone through the wash but whose owner is standing there pointing at it, and
        for undoing nothing at all: a coat only ever leaves once."""
        desk = self.get_object()
        refused = self._operable(desk)
        if refused:
            return refused
        briefing = self._briefed(desk)
        if briefing:
            return briefing
        item = get_object_or_404(desk.items, pk=item_id)
        if desk.status != 'open':
            return Response({'result': rules.DESK_CLOSED}, status=status.HTTP_409_CONFLICT)
        if item.status != 'stored':
            result = rules.BLACKLISTED if item.is_blacklisted else rules.ALREADY_RETURNED
            return Response({'result': result, 'item': CloakroomItemSerializer(item).data},
                            status=status.HTTP_409_CONFLICT)
        if not rules.hand_back(item, request.user):
            return Response({'result': rules.ALREADY_RETURNED}, status=status.HTTP_409_CONFLICT)
        return Response({'result': rules.RETURNED, 'item': CloakroomItemSerializer(item).data})

    @action(
        detail=True, methods=['post'],
        url_path=f'items/(?P<item_id>{NUMERIC_PK_REGEX})/return-by-exception',
        permission_classes=[permissions.IsAuthenticated, _CloakroomGate],
    )
    def item_return_by_exception(self, request, pk=None, item_id=None):
        """The lost slip. Records **what the coat looks like** and **what kind of identity was
        shown** — never a document number, never a name (research decision 5) — and blacklists the
        token in the same write."""
        desk = self.get_object()
        refused = self._operable(desk)
        if refused:
            return refused
        briefing = self._briefed(desk)
        if briefing:
            return briefing
        item = get_object_or_404(desk.items, pk=item_id)
        if desk.status != 'open':
            return Response({'detail': rules.DESK_CLOSED}, status=status.HTTP_409_CONFLICT)
        serializer = ExceptionReturnSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        reason = rules.exception_block_reason(
            serializer.validated_data['description'], serializer.validated_data['identity_kind']
        )
        if reason:
            return Response({'detail': reason}, status=status.HTTP_400_BAD_REQUEST)
        if item.status != 'stored':
            return Response({'detail': rules.NOT_STORED}, status=status.HTTP_409_CONFLICT)
        if not rules.return_by_exception(
            item, request.user,
            description=serializer.validated_data['description'],
            identity_kind=serializer.validated_data['identity_kind'],
            note=serializer.validated_data.get('note', ''),
        ):
            return Response({'detail': rules.NOT_STORED}, status=status.HTTP_409_CONFLICT)
        return Response({'result': 'returned_by_exception', 'item': CloakroomItemSerializer(item).data})

    @action(detail=True, methods=['post'], permission_classes=[permissions.IsAuthenticated, _CloakroomGate])
    def reconcile(self, request, pk=None):
        """Close the desk. Everything still on a hook becomes `unclaimed` and comes back as the
        list somebody walks the rail with. Idempotent: closing a closed desk returns what was left
        on it, and does not close it twice."""
        desk = self.get_object()
        refused = self._operable(desk)
        if refused:
            return refused
        left = rules.reconcile(desk, request.user)
        if not left and desk.status == 'closed':
            left = list(desk.items.filter(status='unclaimed'))
        return Response({
            'desk': _desk_payload(desk, request.user),
            'unclaimed': CloakroomItemSerializer(left, many=True).data,
        })

    @action(detail=True, methods=['get'], permission_classes=[permissions.IsAuthenticated, _CloakroomGate])
    def export(self, request, pk=None):
        """The evening as a CSV. **Six columns and not one of them is a person** — rack, token,
        status, the two times and the identity KIND on the exception rows. The clerk who took each
        coat is on the row in the database, for the organiser who has to reconstruct a mix-up, and
        is left out of the file, which is the artefact that gets emailed around."""
        desk = self.get_object()
        refused = self._operable(desk)
        if refused:
            return refused
        out = StringIO()
        writer = csv.writer(out)
        writer.writerow(['rack', 'token', 'status', 'deposited_at', 'returned_at', 'identity_kind'])
        for item in desk.items.order_by('deposited_at', 'id'):
            writer.writerow([
                item.rack_label,
                item.token,
                item.status,
                item.deposited_at.isoformat(timespec='minutes'),
                item.returned_at.isoformat(timespec='minutes') if item.returned_at else '',
                item.exception_identity_kind,
            ])
        response = HttpResponse(out.getvalue(), content_type='text/csv; charset=utf-8')
        response['Content-Disposition'] = f'attachment; filename="edmat-cloakroom-{desk.pk}.csv"'
        return response
