"""`/api/venues/`, `/api/rooms/`, `/api/room-bookings/`, `/api/checklist-templates/`, and one
event's checklist.

The permission split is the project's standard one (root `CLAUDE.md`, "API conventions"):

- **Public GET where the content is public.** A building, its rooms and their capacities are what an
  organiser needs in order to decide whether to ask, so `/api/venues/` is open — and the whole
  surface still sits behind `feature_gate('venues')`, so with the switch off a non-staff caller gets
  403 everywhere here while `/api/events/` keeps working untouched.
- **Visibility is a queryset filter; authority is an object-level check, and both are needed**
  (house rule 4). Every pk-addressed action below asks `access.py` explicitly before it writes,
  because the filter that scopes a list never runs for an id in a URL.
- **409 means the world moved** — an already-decided booking, a room that has since been taken. A
  400 means the request was wrong when it was written (more people than the fire capacity).
"""

from django.db.models import Prefetch, Q
from django.shortcuts import get_object_or_404
from django.utils import timezone
from rest_framework import permissions, status, viewsets
from rest_framework.decorators import action
from rest_framework.response import Response
from rest_framework.views import APIView

from events.models import Event
from moderation.permissions import feature_gate

from . import services
from .access import (
    booking_block_reason,
    can_manage_room,
    is_venue_admin,
    is_venue_staff,
    item_change_block_reason,
    venues_administered_by,
    visible_venues,
)
from .models import (
    ChecklistInstance,
    ChecklistInstanceItem,
    ChecklistTemplate,
    Room,
    RoomBooking,
    Venue,
    VenueStaff,
)
from .serializers import (
    ChecklistInstanceItemSerializer,
    ChecklistInstanceItemWriteSerializer,
    ChecklistInstanceSerializer,
    ChecklistTemplateSerializer,
    ChecklistTemplateWriteSerializer,
    RoomBookingSerializer,
    RoomBookingWriteSerializer,
    RoomSerializer,
    RoomWriteSerializer,
    VenueSerializer,
    VenueStaffSerializer,
    VenueStaffWriteSerializer,
    VenueSummarySerializer,
    VenueWriteSerializer,
)

_VenuesGate = feature_gate('venues')


class VenueViewSet(viewsets.ModelViewSet):
    """Read by anybody, written by platform staff (a new building) and by its own administrators
    (everything about it afterwards). Addressed by **numeric pk**, not the slug, so that it follows
    the project's id convention — the slug is still what `/venues/[slug]` on the frontend resolves,
    through `?slug=`."""

    permission_classes = [permissions.IsAuthenticatedOrReadOnly, _VenuesGate]
    serializer_class = VenueSerializer

    def get_queryset(self):
        qs = Venue.objects.prefetch_related('rooms', 'staff')
        qs = visible_venues(qs, self.request.user)
        if self.action == 'list':
            slug = self.request.query_params.get('slug')
            if slug:
                qs = qs.filter(slug=slug)
            if self.request.query_params.get('mine') == 'administering':
                qs = qs.filter(id__in=venues_administered_by(self.request.user))
        return qs

    def get_serializer_class(self):
        if self.action == 'list':
            return VenueSummarySerializer
        return VenueSerializer

    def create(self, request, *args, **kwargs):
        # No self-service "claim this building" (CONFERENCE-BRIEF.md §6.4). A venue is created by a
        # platform staff member, who then names its first administrator.
        if not request.user.is_staff:
            return Response({'detail': 'not_allowed'}, status=status.HTTP_403_FORBIDDEN)
        write = VenueWriteSerializer(data=request.data)
        write.is_valid(raise_exception=True)
        venue = write.save()
        return Response(
            VenueSerializer(venue, context=self.get_serializer_context()).data,
            status=status.HTTP_201_CREATED,
        )

    def update(self, request, *args, **kwargs):
        venue = self.get_object()
        if not is_venue_admin(request.user, venue):
            return Response({'detail': 'not_allowed'}, status=status.HTTP_403_FORBIDDEN)
        write = VenueWriteSerializer(
            venue, data=request.data, partial=kwargs.pop('partial', False)
        )
        write.is_valid(raise_exception=True)
        write.save()
        return Response(VenueSerializer(venue, context=self.get_serializer_context()).data)

    def partial_update(self, request, *args, **kwargs):
        kwargs['partial'] = True
        return self.update(request, *args, **kwargs)

    def destroy(self, request, *args, **kwargs):
        # A building is deactivated, never deleted: every past event that was held in it still names
        # it, and its templates are what other buildings' are copied from (house rule 12).
        venue = self.get_object()
        if not request.user.is_staff:
            return Response({'detail': 'not_allowed'}, status=status.HTTP_403_FORBIDDEN)
        venue.is_active = False
        venue.save(update_fields=['is_active'])
        return Response(status=status.HTTP_204_NO_CONTENT)

    @action(detail=True, methods=['get', 'post'], url_path='staff')
    def staff(self, request, pk=None):
        venue = self.get_object()
        if not is_venue_staff(request.user, venue):
            # Who runs a building is not a public fact — the contact note is what a stranger reads.
            return Response({'detail': 'not_allowed'}, status=status.HTTP_403_FORBIDDEN)
        if request.method == 'GET':
            rows = venue.staff.select_related('user__profile', 'added_by__profile')
            return Response(VenueStaffSerializer(rows, many=True).data)
        if not is_venue_admin(request.user, venue):
            return Response({'detail': 'not_allowed'}, status=status.HTTP_403_FORBIDDEN)
        write = VenueStaffWriteSerializer(data=request.data)
        write.is_valid(raise_exception=True)
        row, created = VenueStaff.objects.get_or_create(
            venue=venue,
            user_id=write.validated_data['user_id'],
            defaults={'role': write.validated_data['role'], 'added_by': request.user},
        )
        if not created:
            row.role = write.validated_data['role']
            row.save(update_fields=['role'])
        return Response(
            VenueStaffSerializer(row).data,
            status=status.HTTP_201_CREATED if created else status.HTTP_200_OK,
        )

    @action(detail=True, methods=['delete'], url_path=r'staff/(?P<staff_id>[0-9]+)')
    def remove_staff(self, request, pk=None, staff_id=None):
        venue = self.get_object()
        if not is_venue_admin(request.user, venue):
            return Response({'detail': 'not_allowed'}, status=status.HTTP_403_FORBIDDEN)
        row = venue.staff.filter(pk=staff_id).first()
        if row is None:
            return Response(status=status.HTTP_404_NOT_FOUND)
        remaining = venue.staff.filter(role='administrator').exclude(pk=row.pk).count()
        if row.role == 'administrator' and remaining == 0:
            # A building with no administrator is a building nobody can open again — the same
            # "an event whose host a co-organiser could evict" reasoning `EventStaff` states.
            return Response({'detail': 'last_administrator'}, status=status.HTTP_409_CONFLICT)
        row.delete()
        return Response(status=status.HTTP_204_NO_CONTENT)

    @action(detail=True, methods=['get'], url_path='bookings')
    def bookings(self, request, pk=None):
        """The building's own queue. Staff of the venue only — a list of who is in which room when
        is a security fact about a building, not a timetable for the public."""
        venue = self.get_object()
        if not is_venue_staff(request.user, venue):
            return Response({'detail': 'not_allowed'}, status=status.HTTP_403_FORBIDDEN)
        rows = (
            RoomBooking.objects.filter(room__venue=venue)
            .select_related('room', 'room__venue', 'event', 'decided_by__profile')
            .order_by('status', 'starts_at')
        )
        wanted = request.query_params.get('status')
        if wanted:
            rows = rows.filter(status=wanted)
        return Response(RoomBookingSerializer(rows, many=True).data)

    @action(detail=True, methods=['get'], url_path='templates')
    def templates(self, request, pk=None):
        """What this building hands out — its own templates plus the platform defaults, which is
        what an organiser actually chooses from."""
        venue = self.get_object()
        rows = ChecklistTemplate.objects.filter(
            Q(venue=venue) | Q(venue__isnull=True), is_active=True
        ).prefetch_related('items')
        return Response(
            ChecklistTemplateSerializer(
                rows, many=True, context=self.get_serializer_context()
            ).data
        )


class RoomViewSet(viewsets.ModelViewSet):
    """Rooms, readable with their building, written by its administrators."""

    permission_classes = [permissions.IsAuthenticatedOrReadOnly, _VenuesGate]
    serializer_class = RoomSerializer

    def get_queryset(self):
        qs = Room.objects.select_related('venue').prefetch_related('venue__staff')
        venue_id = self.request.query_params.get('venue')
        if venue_id:
            qs = qs.filter(venue_id=venue_id)
        if self.action == 'list':
            # An inactive room is still reachable by id (a past booking names it) but leaves the
            # list for anybody who does not run the building — visibility as a filter.
            user = self.request.user
            if not (user.is_authenticated and user.is_staff):
                qs = qs.filter(
                    Q(is_active=True)
                    | Q(venue__staff__user=user if user.is_authenticated else None)
                ).distinct()
        return qs

    def create(self, request, *args, **kwargs):
        write = RoomWriteSerializer(data=request.data)
        write.is_valid(raise_exception=True)
        venue = write.validated_data.get('venue')
        if not is_venue_admin(request.user, venue):
            return Response({'detail': 'not_allowed'}, status=status.HTTP_403_FORBIDDEN)
        room = write.save()
        return Response(RoomSerializer(room).data, status=status.HTTP_201_CREATED)

    def update(self, request, *args, **kwargs):
        room = self.get_object()
        if not can_manage_room(request.user, room):
            return Response({'detail': 'not_allowed'}, status=status.HTTP_403_FORBIDDEN)
        write = RoomWriteSerializer(room, data=request.data, partial=kwargs.pop('partial', False))
        write.is_valid(raise_exception=True)
        write.save()
        return Response(RoomSerializer(room).data)

    def partial_update(self, request, *args, **kwargs):
        kwargs['partial'] = True
        return self.update(request, *args, **kwargs)

    def destroy(self, request, *args, **kwargs):
        room = self.get_object()
        if not can_manage_room(request.user, room):
            return Response({'detail': 'not_allowed'}, status=status.HTTP_403_FORBIDDEN)
        room.is_active = False
        room.save(update_fields=['is_active'])
        return Response(status=status.HTTP_204_NO_CONTENT)


class RoomBookingViewSet(viewsets.ModelViewSet):
    """An organiser asks; the building answers.

    Scoped in `get_queryset` to the two parties who have any business seeing a booking — the event's
    own organisers and the building's staff — so a stranger poking at an id gets 404 rather than
    403, and there is no third list anywhere that could quietly widen.
    """

    permission_classes = [permissions.IsAuthenticated, _VenuesGate]
    serializer_class = RoomBookingSerializer

    def get_queryset(self):
        user = self.request.user
        qs = RoomBooking.objects.select_related(
            'room', 'room__venue', 'event', 'decided_by__profile'
        )
        if user.is_authenticated and user.is_staff:
            return qs
        mine = Q(event__host=user) | Q(event__staff__user=user, event__staff__role='organiser')
        theirs = Q(room__venue__staff__user=user)
        qs = qs.filter(mine | theirs).distinct()
        event_id = self.request.query_params.get('event')
        if event_id and self.action == 'list':
            qs = qs.filter(event_id=event_id)
        return qs

    def create(self, request, *args, **kwargs):
        write = RoomBookingWriteSerializer(data=request.data)
        write.is_valid(raise_exception=True)
        data = write.validated_data
        event = Event.objects.filter(pk=data['event_id']).first()
        if event is None or not event.can_organise(request.user):
            # Somebody else's event does not exist as far as this endpoint is concerned.
            return Response(status=status.HTTP_404_NOT_FOUND)
        room = data['room']
        reason = booking_block_reason(
            event, room, data['starts_at'], data['ends_at'], data.get('expected_headcount', 0)
        )
        if reason is not None:
            return Response({'detail': reason}, status=_refusal_status(reason))
        booking = RoomBooking.objects.create(
            event=event,
            room=room,
            starts_at=data['starts_at'],
            ends_at=data['ends_at'],
            expected_headcount=data.get('expected_headcount', 0),
            purpose=data.get('purpose', ''),
            requested_by=request.user,
        )
        return Response(RoomBookingSerializer(booking).data, status=status.HTTP_201_CREATED)

    @action(detail=True, methods=['post'])
    def approve(self, request, pk=None):
        return self._decide(request, 'approved')

    @action(detail=True, methods=['post'])
    def reject(self, request, pk=None):
        return self._decide(request, 'rejected')

    def _decide(self, request, wanted):
        booking = self.get_object()
        if not is_venue_admin(request.user, booking.room.venue):
            return Response({'detail': 'not_allowed'}, status=status.HTTP_403_FORBIDDEN)
        if wanted == 'approved':
            # Re-checked against the database at the moment of approval, not at the moment of
            # asking: two organisers may both have asked for Thursday and the building is deciding
            # the second one now.
            reason = booking_block_reason(
                booking.event,
                booking.room,
                booking.starts_at,
                booking.ends_at,
                booking.expected_headcount,
                exclude_pk=booking.pk,
            )
            if reason is not None:
                return Response({'detail': reason}, status=_refusal_status(reason))
        # ONE WHERE-anchored update, never `select_for_update` (backend/CLAUDE.md rule 1): the loser
        # of a double decision matches zero rows and is told the world moved.
        changed = RoomBooking.objects.filter(pk=booking.pk, status='requested').update(
            status=wanted,
            decided_by=request.user,
            decided_at=timezone.now(),
            note=request.data.get('note', '') or '',
        )
        if not changed:
            return Response({'detail': 'already_decided'}, status=status.HTTP_409_CONFLICT)
        booking.refresh_from_db()
        return Response(RoomBookingSerializer(booking).data)

    @action(detail=True, methods=['post'])
    def cancel(self, request, pk=None):
        """The organiser withdrawing. A state, not a delete — the building's own record of who asked
        for Thursday and then did not need it is part of why the room was held."""
        booking = self.get_object()
        if not booking.event.can_organise(request.user):
            return Response({'detail': 'not_allowed'}, status=status.HTTP_403_FORBIDDEN)
        changed = RoomBooking.objects.filter(
            pk=booking.pk, status__in=['requested', 'approved']
        ).update(status='cancelled', decided_at=timezone.now())
        if not changed:
            return Response({'detail': 'already_decided'}, status=status.HTTP_409_CONFLICT)
        booking.refresh_from_db()
        return Response(RoomBookingSerializer(booking).data)


def _refusal_status(reason: str) -> int:
    """`room_busy` and `room_closed` are the world having moved (409); everything else was wrong
    when the request was written (400). Conflating the two is explicitly called out in the root
    `CLAUDE.md`."""
    return (
        status.HTTP_409_CONFLICT
        if reason in ('room_busy', 'room_closed')
        else status.HTTP_400_BAD_REQUEST
    )


class ChecklistTemplateViewSet(viewsets.ModelViewSet):
    """Read by anybody who can see the building; written by its administrators. A **platform
    default** (`venue` null) is written by platform staff only."""

    permission_classes = [permissions.IsAuthenticatedOrReadOnly, _VenuesGate]
    serializer_class = ChecklistTemplateSerializer

    def get_queryset(self):
        qs = ChecklistTemplate.objects.select_related('venue').prefetch_related('items')
        venue_id = self.request.query_params.get('venue')
        if venue_id:
            qs = qs.filter(Q(venue_id=venue_id) | Q(venue__isnull=True))
        if self.action == 'list' and self.request.query_params.get('include_inactive') != '1':
            qs = qs.filter(is_active=True)
        return qs

    def _may_write(self, request, venue) -> bool:
        if venue is None:
            return bool(request.user.is_authenticated and request.user.is_staff)
        return is_venue_admin(request.user, venue)

    def create(self, request, *args, **kwargs):
        write = ChecklistTemplateWriteSerializer(data=request.data)
        write.is_valid(raise_exception=True)
        if not self._may_write(request, write.validated_data.get('venue')):
            return Response({'detail': 'not_allowed'}, status=status.HTTP_403_FORBIDDEN)
        template = write.save()
        return Response(
            ChecklistTemplateSerializer(
                template, context=self.get_serializer_context()
            ).data,
            status=status.HTTP_201_CREATED,
        )

    def update(self, request, *args, **kwargs):
        template = self.get_object()
        if not self._may_write(request, template.venue):
            return Response({'detail': 'not_allowed'}, status=status.HTTP_403_FORBIDDEN)
        write = ChecklistTemplateWriteSerializer(
            template, data=request.data, partial=kwargs.pop('partial', False)
        )
        write.is_valid(raise_exception=True)
        write.save()
        return Response(
            ChecklistTemplateSerializer(template, context=self.get_serializer_context()).data
        )

    def partial_update(self, request, *args, **kwargs):
        kwargs['partial'] = True
        return self.update(request, *args, **kwargs)

    def destroy(self, request, *args, **kwargs):
        template = self.get_object()
        if not self._may_write(request, template.venue):
            return Response({'detail': 'not_allowed'}, status=status.HTTP_403_FORBIDDEN)
        template.is_active = False
        template.save(update_fields=['is_active'])
        return Response(status=status.HTTP_204_NO_CONTENT)


def _checklist_readers(user, event, instance=None) -> bool:
    """Who may read one event's checklist: the event's own staff, and staff of the building whose
    list it is. Deliberately not the public — a list saying which fire door is blocked is not
    something to publish."""
    if event.is_staff_member(user):
        return True
    if instance is not None:
        return is_venue_staff(user, instance.venue)
    return any(
        is_venue_staff(user, row.venue) for row in event.checklist_instances.select_related('venue')
    )


class EventChecklistView(APIView):
    """`GET /api/events/{id}/checklist/` — every instance on this event, items included.
    `POST` — cut a new instance from a template (organisers only).

    Routed from `venues/urls.py` rather than added to `EventViewSet`, so that `events` gains no
    import of this app beyond the one `publish_block_reason` call (CONFERENCE-BRIEF.md §4 rule 1).
    """

    permission_classes = [permissions.IsAuthenticated, _VenuesGate]

    def get(self, request, event_id):
        event = get_object_or_404(Event, pk=event_id)
        if not _checklist_readers(request.user, event):
            return Response(status=status.HTTP_404_NOT_FOUND)
        # The event may have moved since the snapshot was cut; the due dates are re-derived at the
        # moment somebody actually looks (services.recompute_due_dates says why not a signal).
        services.recompute_due_dates(event)
        rows = event.checklist_instances.select_related('venue', 'template').prefetch_related(
            Prefetch(
                'items',
                queryset=ChecklistInstanceItem.objects.select_related(
                    'done_by__profile', 'signed_off_by__profile'
                ),
            )
        )
        return Response(
            ChecklistInstanceSerializer(rows, many=True, context={'request': request}).data
        )

    def post(self, request, event_id):
        event = get_object_or_404(Event, pk=event_id)
        if not event.can_organise(request.user):
            return Response(status=status.HTTP_404_NOT_FOUND)
        template = ChecklistTemplate.objects.filter(
            pk=request.data.get('template_id'), is_active=True
        ).first()
        if template is None:
            return Response({'detail': 'no_such_template'}, status=status.HTTP_400_BAD_REQUEST)
        venue = template.venue
        if venue is None:
            # A platform default is instantiated against the building the event actually has — the
            # one it holds an approved booking in — because the checklist is a contract with a
            # building, not with the platform.
            venue_id = request.data.get('venue_id')
            venue = Venue.objects.filter(pk=venue_id).first() if venue_id else None
            if venue is None:
                return Response({'detail': 'venue_required'}, status=status.HTTP_400_BAD_REQUEST)
        if ChecklistInstance.objects.filter(event=event, venue=venue).exists():
            return Response({'detail': 'already_started'}, status=status.HTTP_409_CONFLICT)
        instance = services.instantiate(event, venue, template, created_by=request.user)
        return Response(
            ChecklistInstanceSerializer(instance, context={'request': request}).data,
            status=status.HTTP_201_CREATED,
        )


class ChecklistInstanceViewSet(viewsets.GenericViewSet):
    """The two things done to a whole instance: syncing in the building's later additions, and
    abandoning it."""

    permission_classes = [permissions.IsAuthenticated, _VenuesGate]
    serializer_class = ChecklistInstanceSerializer
    queryset = ChecklistInstance.objects.select_related('venue', 'event', 'template')

    @action(detail=True, methods=['post'])
    def sync(self, request, pk=None):
        instance = self.get_object()
        if not (
            instance.event.can_organise(request.user)
            or is_venue_admin(request.user, instance.venue)
        ):
            return Response({'detail': 'not_allowed'}, status=status.HTTP_403_FORBIDDEN)
        added = services.sync_new_items(instance)
        data = ChecklistInstanceSerializer(instance, context={'request': request}).data
        data['added'] = added
        return Response(data)

    def destroy(self, request, pk=None):
        instance = self.get_object()
        if not instance.event.can_organise(request.user):
            return Response({'detail': 'not_allowed'}, status=status.HTTP_403_FORBIDDEN)
        instance.delete()
        return Response(status=status.HTTP_204_NO_CONTENT)


class ChecklistItemViewSet(viewsets.GenericViewSet):
    """One line: `PATCH` it, or sign it off.

    Every refusal here is a word, not a boolean (house rule 6) — `na_not_allowed`,
    `na_reason_required`, `needs_venue_signoff`, `not_allowed` — because each is a different
    sentence to the person who hit it, and the frontend has a line for each.
    """

    permission_classes = [permissions.IsAuthenticated, _VenuesGate]
    serializer_class = ChecklistInstanceItemSerializer
    queryset = ChecklistInstanceItem.objects.select_related(
        'instance', 'instance__event', 'instance__venue', 'done_by__profile', 'signed_off_by__profile'
    )

    def partial_update(self, request, pk=None):
        item = self.get_object()
        wanted = request.data.get('status', item.status)
        reason = item_change_block_reason(
            request.user,
            item,
            wanted_status=wanted if wanted != item.status else None,
            na_reason=request.data.get('na_reason'),
        )
        if reason == 'not_allowed':
            return Response({'detail': reason}, status=status.HTTP_403_FORBIDDEN)
        if reason is not None:
            return Response({'detail': reason}, status=status.HTTP_400_BAD_REQUEST)
        write = ChecklistInstanceItemWriteSerializer(item, data=request.data, partial=True)
        write.is_valid(raise_exception=True)
        write.save()
        if item.status == 'done' and item.done_at is None:
            item.done_by = request.user
            item.done_at = timezone.now()
            item.save(update_fields=['done_by', 'done_at'])
        elif item.status != 'done' and item.done_at is not None:
            item.done_by = None
            item.done_at = None
            item.save(update_fields=['done_by', 'done_at'])
        return Response(
            ChecklistInstanceItemSerializer(item, context={'request': request}).data
        )

    @action(detail=True, methods=['post'], url_path='sign-off')
    def sign_off(self, request, pk=None):
        """The building's signature. Only a venue administrator, and only for an item that asked for
        one — signing a line the building never wanted to sign would make the flag meaningless."""
        item = self.get_object()
        if not is_venue_admin(request.user, item.instance.venue):
            return Response({'detail': 'not_allowed'}, status=status.HTTP_403_FORBIDDEN)
        if not item.requires_venue_signoff:
            return Response({'detail': 'no_signoff_needed'}, status=status.HTTP_400_BAD_REQUEST)
        item.signed_off_by = request.user
        item.signed_off_at = timezone.now()
        if item.status != 'not_applicable':
            item.status = 'done'
            if item.done_at is None:
                item.done_by = request.user
                item.done_at = timezone.now()
        item.save()
        return Response(
            ChecklistInstanceItemSerializer(item, context={'request': request}).data
        )
