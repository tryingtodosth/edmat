"""The rota's endpoints. Thin: every decision they make is `shifts/rules.py`'s.

**Visibility and authority are two separate things here, and both are needed** (house rule 4). A
rota is staff-only, so `_event_for_staff` 404s anybody else — for a stranger this event has no
rota, which is both the honest answer and the safe one. But every single-object action arrives
with an id in the URL, where no queryset filter runs, so each one asks the rule module again
before it mutates anything.

**Capacity under SQLite**: a claim creates its row and then recounts, deleting its own row and
answering 409 if it turns out to have been one too many (`backend/CLAUDE.md`'s no-`select_for_
update` rule). Two people claiming the last place at the same instant is the case this is for; the
loser is told `shift_full`, which is exactly what they would have been told a second earlier.
"""

from django.contrib.auth import get_user_model
from django.db.models import Prefetch
from django.http import HttpResponse
from django.shortcuts import get_object_or_404
from django.utils import timezone
from rest_framework import permissions, status
from rest_framework.response import Response
from rest_framework.views import APIView

from accounts.minors import is_minor
from events.models import Event
from moderation.permissions import feature_gate

from . import rules
from .ics import shifts_calendar
from .models import Assignment, Shift, Station, VolunteerRecord
from .serializers import (
    AssignmentSerializer,
    CreditSerializer,
    ShiftSerializer,
    ShiftWriteSerializer,
    StationSerializer,
    StationWriteSerializer,
    VolunteerRecordSerializer,
    VolunteerRecordWriteSerializer,
    person,
)

User = get_user_model()
_ShiftsFeatureGate = feature_gate('shifts')


def _shift_queryset():
    return Shift.objects.select_related('station', 'station__event').prefetch_related(
        Prefetch('assignments', queryset=Assignment.objects.select_related('user', 'user__profile'))
    )


class RotaView(APIView):
    """Everything in this app is authenticated and behind the `shifts` kill switch."""

    permission_classes = [permissions.IsAuthenticated, _ShiftsFeatureGate]

    def event_for_staff(self, request, event_id) -> Event:
        event = get_object_or_404(Event.objects.prefetch_related('staff'), pk=event_id)
        if not event.is_staff_member(request.user):
            # 404, not 403: for somebody who does not help run this event, its rota does not exist.
            raise _NotFound()
        return event

    def event_for_organiser(self, request, event_id) -> Event:
        event = self.event_for_staff(request, event_id)
        if not event.can_organise(request.user):
            raise _Forbidden()
        return event

    def context_for(self, request, event):
        return {'request': request, 'can_organise': event.can_organise(request.user)}


class _NotFound(Exception):
    pass


class _Forbidden(Exception):
    pass


def _handle(fn):
    """The two refusals above, turned into responses. A decorator rather than try/except in every
    method, because forgetting it once would turn a scope refusal into a 500 that reads like a bug
    in the feature rather than a door being shut."""

    def wrapper(self, request, *args, **kwargs):
        try:
            return fn(self, request, *args, **kwargs)
        except _NotFound:
            return Response({'detail': 'Not found.'}, status=status.HTTP_404_NOT_FOUND)
        except _Forbidden:
            return Response({'detail': 'Only an organiser can do that.'}, status=status.HTTP_403_FORBIDDEN)

    return wrapper


# --------------------------------------------------------------------------------------------
# Stations and shifts
# --------------------------------------------------------------------------------------------


class EventStationsView(RotaView):
    """`/api/events/{id}/stations/` — the whole rota in one response.

    One call powers three screens: the volunteer's open-shift board, the organiser's coverage grid
    and the wall rota. Every shift carries its own counts and its own `claim_block_reason`, so the
    frontend never has to ask a second endpoint what a disabled button should say.
    """

    @_handle
    def get(self, request, event_id):
        event = self.event_for_staff(request, event_id)
        stations = (
            Station.objects.filter(event=event)
            .select_related('session')
            .prefetch_related(Prefetch('shifts', queryset=_shift_queryset()))
        )
        data = StationSerializer(stations, many=True, context=self.context_for(request, event)).data
        return Response(data)

    @_handle
    def post(self, request, event_id):
        event = self.event_for_organiser(request, event_id)
        serializer = StationWriteSerializer(data=request.data, context={'event': event})
        serializer.is_valid(raise_exception=True)
        station = serializer.save(event=event)
        return Response(
            StationSerializer(station, context=self.context_for(request, event)).data,
            status=status.HTTP_201_CREATED,
        )


class StationDetailView(RotaView):
    @_handle
    def patch(self, request, pk):
        station = get_object_or_404(Station.objects.select_related('event'), pk=pk)
        event = self.event_for_organiser(request, station.event_id)
        serializer = StationWriteSerializer(
            station, data=request.data, partial=True, context={'event': event}
        )
        serializer.is_valid(raise_exception=True)
        serializer.save()
        return Response(StationSerializer(station, context=self.context_for(request, event)).data)

    @_handle
    def delete(self, request, pk):
        station = get_object_or_404(Station.objects.select_related('event'), pk=pk)
        self.event_for_organiser(request, station.event_id)
        station.delete()
        return Response(status=status.HTTP_204_NO_CONTENT)


class StationShiftsView(RotaView):
    @_handle
    def get(self, request, station_id):
        station = get_object_or_404(Station.objects.select_related('event'), pk=station_id)
        event = self.event_for_staff(request, station.event_id)
        shifts = _shift_queryset().filter(station=station)
        return Response(ShiftSerializer(shifts, many=True, context=self.context_for(request, event)).data)

    @_handle
    def post(self, request, station_id):
        station = get_object_or_404(Station.objects.select_related('event', 'session'), pk=station_id)
        event = self.event_for_organiser(request, station.event_id)
        serializer = ShiftWriteSerializer(data=request.data, context={'station': station})
        serializer.is_valid(raise_exception=True)
        shift = serializer.save(station=station)
        return Response(
            ShiftSerializer(shift, context=self.context_for(request, event)).data,
            status=status.HTTP_201_CREATED,
        )


class ShiftDetailView(RotaView):
    @_handle
    def patch(self, request, pk):
        shift = get_object_or_404(_shift_queryset(), pk=pk)
        event = self.event_for_organiser(request, shift.station.event_id)
        serializer = ShiftWriteSerializer(
            shift, data=request.data, partial=True, context={'station': shift.station}
        )
        serializer.is_valid(raise_exception=True)
        serializer.save()
        return Response(ShiftSerializer(shift, context=self.context_for(request, event)).data)

    @_handle
    def delete(self, request, pk):
        shift = get_object_or_404(Shift.objects.select_related('station'), pk=pk)
        self.event_for_organiser(request, shift.station.event_id)
        shift.delete()
        return Response(status=status.HTTP_204_NO_CONTENT)


# --------------------------------------------------------------------------------------------
# The six actions on a shift
# --------------------------------------------------------------------------------------------


def _refusal(reason, http_status=status.HTTP_409_CONFLICT):
    return Response({'detail': reason, 'reason': reason}, status=http_status)


class ShiftClaimView(RotaView):
    """A volunteer takes a shift. A soft reason does not refuse it — it decides what it becomes."""

    @_handle
    def post(self, request, pk):
        shift = get_object_or_404(_shift_queryset(), pk=pk)
        event = self.event_for_staff(request, shift.station.event_id)
        reason = rules.claim_block_reason(request.user, shift)
        if reason in rules.HARD_REASONS:
            return _refusal(reason)
        assignment = Assignment.objects.create(
            shift=shift, user=request.user, status=rules.status_for_claim(reason), source='self'
        )
        if assignment.status == 'confirmed':
            assignment.confirmed_at = timezone.now()
            assignment.save(update_fields=['confirmed_at'])
        # The recount that makes the last place safe under SQLite — see the module docstring.
        if rules.held_count(shift) > shift.needed:
            assignment.delete()
            return _refusal('shift_full')
        shift.refresh_from_db()
        return Response(
            {
                'assignment': AssignmentSerializer(
                    assignment, context=self.context_for(request, event)
                ).data,
                'pending_reason': reason if reason in rules.SOFT_REASONS else None,
            },
            status=status.HTTP_201_CREATED,
        )


class ShiftDropView(RotaView):
    """Drop-to-pool (R2 §6 decision 2). The organiser may drop anybody, at any time, by naming the
    assignment; a volunteer drops their own and only outside the cutoff."""

    @_handle
    def post(self, request, pk):
        shift = get_object_or_404(_shift_queryset(), pk=pk)
        event = self.event_for_staff(request, shift.station.event_id)
        as_organiser = event.can_organise(request.user)
        assignment_id = request.data.get('assignment')
        if assignment_id and as_organiser:
            assignment = get_object_or_404(Assignment, pk=assignment_id, shift=shift)
        else:
            assignment = shift.assignments.filter(user=request.user).exclude(status='dropped').first()
            if assignment is None:
                return _refusal('not_yours', status.HTTP_404_NOT_FOUND)
            as_organiser = as_organiser and assignment.user_id != request.user.pk
        reason = rules.drop_block_reason(request.user, assignment, as_organiser=as_organiser)
        if reason:
            return _refusal(reason)
        assignment.status = 'dropped'
        assignment.dropped_at = timezone.now()
        assignment.drop_reason = str(request.data.get('reason', ''))[:200]
        assignment.save(update_fields=['status', 'dropped_at', 'drop_reason'])
        return Response(
            AssignmentSerializer(assignment, context=self.context_for(request, event)).data
        )


class ShiftAssignView(RotaView):
    """An organiser puts somebody on a shift. By account id, because there is no people search —
    the same honest stopgap `EventStaffPanel` already documents."""

    @_handle
    def post(self, request, pk):
        shift = get_object_or_404(_shift_queryset(), pk=pk)
        event = self.event_for_organiser(request, shift.station.event_id)
        try:
            target = User.objects.select_related('profile').get(pk=request.data.get('user'))
        except (User.DoesNotExist, ValueError, TypeError):
            return _refusal('no_such_user', status.HTTP_400_BAD_REQUEST)
        reason = rules.assign_block_reason(request.user, shift, target)
        if reason in rules.HARD_REASONS or reason == 'not_organiser':
            return _refusal(reason)
        assignment = Assignment.objects.create(
            shift=shift,
            user=target,
            # An organiser's assignment is confirmed by the act of making it — they are the person
            # `confirm` would otherwise be waiting for. A `requires_adult` shift is the exception
            # the rule module still flags, and the grid still draws it as needing one.
            status='confirmed',
            source='organiser',
            confirmed_by=request.user,
            confirmed_at=timezone.now(),
        )
        if rules.held_count(shift) > shift.needed:
            assignment.delete()
            return _refusal('shift_full')
        return Response(
            {
                'assignment': AssignmentSerializer(
                    assignment, context=self.context_for(request, event)
                ).data,
                'pending_reason': reason if reason in rules.SOFT_REASONS else None,
            },
            status=status.HTTP_201_CREATED,
        )


class _AssignmentDecisionView(RotaView):
    """Shared shape for confirm / no-show / done: an organiser, an assignment on this shift, and a
    WHERE-anchored transition so a second click answers 409 rather than re-deciding."""

    from_statuses: tuple = ()
    to_status = ''

    def transition(self, request, assignment, event):
        changed = Assignment.objects.filter(
            pk=assignment.pk, status__in=self.from_statuses
        ).update(status=self.to_status)
        if not changed:
            return _refusal('already_decided')
        assignment.refresh_from_db()
        return None

    @_handle
    def post(self, request, pk):
        shift = get_object_or_404(_shift_queryset(), pk=pk)
        event = self.event_for_organiser(request, shift.station.event_id)
        assignment = get_object_or_404(Assignment, pk=request.data.get('assignment'), shift=shift)
        refusal = self.transition(request, assignment, event)
        if refusal is not None:
            return refusal
        return Response(
            AssignmentSerializer(assignment, context=self.context_for(request, event)).data
        )


class ShiftConfirmView(_AssignmentDecisionView):
    from_statuses = ('offered', 'claimed')
    to_status = 'confirmed'

    def transition(self, request, assignment, event):
        refusal = super().transition(request, assignment, event)
        if refusal is not None:
            return refusal
        assignment.confirmed_by = request.user
        assignment.confirmed_at = timezone.now()
        assignment.save(update_fields=['confirmed_by', 'confirmed_at'])
        return None


class ShiftNoShowView(_AssignmentDecisionView):
    from_statuses = ('offered', 'claimed', 'confirmed')
    to_status = 'no_show'


class ShiftDoneView(RotaView):
    """Passive hours logging (R2 §6 decision 4): no kiosk, no scanning — an organiser marks the
    shift done afterwards, and the hours are the shift's own length unless they say otherwise.

    An override more than `CREDIT_NOTE_THRESHOLD` away from that length needs a note. Not because
    the number is doubted, but because "3 hours became 30 minutes" is the line an inspector or a
    volunteer asks about, and a blank there is a question nobody can answer six months later.
    """

    @_handle
    def post(self, request, pk):
        shift = get_object_or_404(_shift_queryset(), pk=pk)
        event = self.event_for_organiser(request, shift.station.event_id)
        serializer = CreditSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        data = serializer.validated_data
        assignment = get_object_or_404(Assignment, pk=data['assignment'], shift=shift)
        hours = data.get('hours')
        note = data.get('note', '')
        if rules.credit_note_required(shift, hours) and not note.strip():
            return _refusal('note_required', status.HTTP_400_BAD_REQUEST)
        changed = Assignment.objects.filter(
            pk=assignment.pk, status__in=('offered', 'claimed', 'confirmed', 'no_show')
        ).update(status='done')
        if not changed:
            return _refusal('already_decided')
        assignment.refresh_from_db()
        assignment.hours_credited = hours
        assignment.credit_note = note
        assignment.credited_by = request.user
        assignment.credited_at = timezone.now()
        assignment.save(update_fields=['hours_credited', 'credit_note', 'credited_by', 'credited_at'])
        return Response(
            AssignmentSerializer(assignment, context=self.context_for(request, event)).data
        )


# --------------------------------------------------------------------------------------------
# Coverage, my shifts, the records, the certificate's numbers
# --------------------------------------------------------------------------------------------


class CoverageView(RotaView):
    """`COUNT`s per shift, never a stored tally (house rule 5). The grid's colours are derived
    from `is_short` here rather than in the component, so the wall print and the screen agree."""

    @_handle
    def get(self, request, event_id):
        event = self.event_for_organiser(request, event_id)
        rows = rules.coverage(event)
        return Response(
            {
                'event': str(event.pk),
                'shifts': [
                    {
                        'shift': str(row['shift'].pk),
                        'station': str(row['shift'].station_id),
                        'station_name': row['shift'].station.name,
                        'station_kind': row['shift'].station.kind,
                        'starts_at': row['shift'].starts_at,
                        'ends_at': row['shift'].ends_at,
                        'needed': row['needed'],
                        'confirmed': row['confirmed'],
                        'claimed': row['claimed'],
                        'is_short': row['is_short'],
                        'needs_adult': row['needs_adult'],
                    }
                    for row in rows
                ],
            }
        )


def _desk_location(event) -> str:
    """Where a volunteer goes when something goes wrong: the `info` station's own location, which
    is the deliberate replacement for a supervisor's phone number (§1, R2's "no peer contacts")."""
    station = Station.objects.filter(event=event, kind='info').order_by('order', 'id').first()
    return station.location_text if station else ''


def _my_assignments(user, event):
    return (
        Assignment.objects.filter(user=user, shift__station__event=event)
        .exclude(status='dropped')
        .select_related('shift', 'shift__station')
        .order_by('shift__starts_at')
    )


class MyShiftsView(RotaView):
    """A volunteer's own rota, and the `.ics` of it. Co-volunteers are first name + last initial."""

    @_handle
    def get(self, request, event_id, fmt=None):
        event = self.event_for_staff(request, event_id)
        assignments = list(_my_assignments(request.user, event))
        if fmt == 'ics':
            body = shifts_calendar(assignments, event)
            response = HttpResponse(body, content_type='text/calendar; charset=utf-8')
            response['Content-Disposition'] = f'attachment; filename="my-shifts-{event.pk}.ics"'
            return response
        rows = []
        for assignment in assignments:
            shift = assignment.shift
            co = [
                person(a.user, masked=True)['display_name']
                for a in shift.assignments.exclude(status='dropped').exclude(user=request.user).select_related(
                    'user', 'user__profile'
                )
            ]
            rows.append(
                {
                    'assignment': str(assignment.pk),
                    'shift': str(shift.pk),
                    'status': assignment.status,
                    'station_name': shift.station.name,
                    'station_kind': shift.station.kind,
                    'location_text': shift.station.location_text,
                    'briefing_note': shift.station.briefing_note,
                    'starts_at': shift.starts_at,
                    'ends_at': shift.ends_at,
                    'hours': str(shift.hours),
                    'credited_hours': str(assignment.credited_hours),
                    'drop_block_reason': rules.drop_block_reason(request.user, assignment),
                    'co_volunteers': co,
                }
            )
        return Response(
            {
                'event': {
                    'id': str(event.pk),
                    'title': event.title,
                    'starts_at': event.starts_at,
                    'ends_at': event.ends_at,
                    'location_text': event.location_text,
                    'organiser': person(event.host, masked=False)['display_name'],
                },
                'desk_location': _desk_location(event),
                'shifts': rows,
                'hours': str(rules.hours_for(request.user, event)),
            }
        )


class EventVolunteersView(RotaView):
    """The organiser's safeguarding records. Fields, never files (§6 rule 5)."""

    @_handle
    def get(self, request, event_id):
        event = self.event_for_organiser(request, event_id)
        records = VolunteerRecord.objects.filter(event=event).select_related('user', 'user__profile')
        known = {r.user_id for r in records}
        data = VolunteerRecordSerializer(records, many=True).data
        # Staff with no record yet are listed as empty ones, so an organiser sees the volunteer
        # who cannot claim anything BECAUSE no consent is on file, rather than an absence.
        for staff in event.staff.select_related('user', 'user__profile').all():
            if staff.user_id in known or staff.role != 'volunteer':
                continue
            data.append(
                {
                    'id': None,
                    'event': str(event.pk),
                    'user': person(staff.user, masked=False),
                    'is_minor': is_minor(staff.user),
                    'has_consent': False,
                    'consent_recorded_at': None,
                    'consent_note': '',
                    'vetting_checked_at': None,
                    'vetting_reference': '',
                    'emergency_contact_note': '',
                    'hours': str(rules.hours_for(staff.user, event)),
                }
            )
        return Response(data)

    @_handle
    def post(self, request, event_id):
        event = self.event_for_organiser(request, event_id)
        serializer = VolunteerRecordWriteSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        user_id = serializer.validated_data.get('user')
        try:
            target = User.objects.get(pk=user_id)
        except (User.DoesNotExist, ValueError, TypeError):
            return _refusal('no_such_user', status.HTTP_400_BAD_REQUEST)
        if event.role_of(target) is None:
            return _refusal('not_staff', status.HTTP_400_BAD_REQUEST)
        record, _ = VolunteerRecord.objects.get_or_create(event=event, user=target)
        serializer.apply(record, serializer.validated_data, request.user)
        return Response(VolunteerRecordSerializer(record).data, status=status.HTTP_201_CREATED)


class VolunteerRecordDetailView(RotaView):
    @_handle
    def patch(self, request, pk):
        record = get_object_or_404(VolunteerRecord.objects.select_related('event', 'user'), pk=pk)
        self.event_for_organiser(request, record.event_id)
        serializer = VolunteerRecordWriteSerializer(data=request.data, partial=True)
        serializer.is_valid(raise_exception=True)
        serializer.apply(record, serializer.validated_data, request.user)
        return Response(VolunteerRecordSerializer(record).data)


class MyVolunteeringView(RotaView):
    """Across every event — what `/volunteering` lists and what each certificate is issued from."""

    @_handle
    def get(self, request):
        assignments = (
            Assignment.objects.filter(user=request.user)
            .exclude(status='dropped')
            .select_related('shift', 'shift__station', 'shift__station__event', 'shift__station__event__host')
        )
        by_event: dict = {}
        events: dict = {}
        for assignment in assignments:
            event = assignment.shift.station.event
            events[event.pk] = event
            row = by_event.setdefault(
                event.pk,
                {
                    'event': {
                        'id': str(event.pk),
                        'title': event.title,
                        'starts_at': event.starts_at,
                        'ends_at': event.ends_at,
                        'location_text': event.location_text,
                        'organiser': person(event.host, masked=False)['display_name'],
                    },
                    'shift_count': 0,
                    'done_count': 0,
                    'hours': None,
                },
            )
            row['shift_count'] += 1
            if assignment.status == 'done':
                row['done_count'] += 1
        for pk, row in by_event.items():
            row['hours'] = str(rules.hours_for(request.user, events[pk]))
        return Response(
            sorted(by_event.values(), key=lambda r: r['event']['starts_at'] or timezone.now(), reverse=True)
        )
