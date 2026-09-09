"""Organiser-side registration endpoints (AUDIENCE-BRIEF.md §3.3), mixed into `EventViewSet`:
the full list with answers, accept/decline, check-in, the CSV export, the organiser's own form
questions, and per-session seats."""

import csv
from io import StringIO

from django.http import HttpResponse
from rest_framework import permissions, status
from rest_framework.decorators import action
from rest_framework.response import Response

from moderation.permissions import feature_gate

from .models import ATTENDING_STATUSES, RegistrationField, SessionAttendance
from .registration import check_in, decide, expire_promotions
from .serializers import EventAttendanceSerializer, RegistrationFieldSerializer

_EventsFeatureGate = feature_gate('events')
_AUTH = [permissions.IsAuthenticated, _EventsFeatureGate]


class RegistrationMixin:
    def _staff_or_403(self, event, organiser_only=False):
        user = self.request.user
        ok = event.can_organise(user) if organiser_only else event.is_staff_member(user)
        return None if ok else Response(status=status.HTTP_403_FORBIDDEN)

    def _rows(self, event):
        return event.attendances.select_related(
            'attendee', 'attendee__profile', 'registered_by__profile'
        ).prefetch_related('session_registrations').order_by('created_at', 'id')

    @action(detail=True, methods=['get'], permission_classes=_AUTH)
    def registrations(self, request, pk=None):
        """Every row, every state, with answers — staff only (volunteers included: they check
        people in against this list)."""
        event = self.get_object()
        refused = self._staff_or_403(event)
        if refused:
            return refused
        expire_promotions(event, request.user)
        return Response(EventAttendanceSerializer(self._rows(event), many=True).data)

    @action(detail=True, methods=['get'], url_path='registrations/export', permission_classes=_AUTH)
    def registrations_csv(self, request, pk=None):
        """The roster as a file: one row per person, one column per question. What an organiser
        takes to the door, or to whoever gives course credit."""
        event = self.get_object()
        refused = self._staff_or_403(event)
        if refused:
            return refused
        expire_promotions(event, request.user)
        fields = list(event.registration_fields.all())
        out = StringIO()
        writer = csv.writer(out)
        # `_attendance_mode` / `_needs` are the baseline questions every form asks (rendered by the
        # client, stored under reserved keys) — exported beside the organiser's own.
        writer.writerow(['name', 'status', 'registered_at', 'checked_in_at', 'note', 'attendance_mode', 'needs', *[f.label for f in fields]])
        for row in self._rows(event):
            profile = getattr(row.attendee, 'profile', None)
            name = getattr(profile, 'display_name', '') or row.attendee.username
            answers = row.answers or {}
            writer.writerow([
                name, row.status, row.created_at.isoformat(timespec='minutes'),
                row.checked_in_at.isoformat(timespec='minutes') if row.checked_in_at else '',
                row.note,
                answers.get('_attendance_mode', ''), answers.get('_needs', ''),
                *[', '.join(v) if isinstance(v := answers.get(str(f.pk), ''), list) else ('yes' if v is True else v) for f in fields],
            ])
        response = HttpResponse(out.getvalue(), content_type='text/csv; charset=utf-8')
        response['Content-Disposition'] = f'attachment; filename="edmat-event-{event.pk}-registrations.csv"'
        return response

    @action(detail=True, methods=['post'], url_path='registrations/(?P<row_id>[^/.]+)/decide', permission_classes=_AUTH)
    def registration_decide(self, request, pk=None, row_id=None):
        event = self.get_object()
        refused = self._staff_or_403(event, organiser_only=True)
        if refused:
            return refused
        row = event.attendances.filter(pk=row_id).first()
        if row is None:
            return Response(status=status.HTTP_404_NOT_FOUND)
        decision = request.data.get('decision')
        if decision not in ('accept', 'decline'):
            return Response({'detail': 'decision must be accept or decline.'}, status=status.HTTP_400_BAD_REQUEST)
        note = (request.data.get('note') or '')[:300]
        if note:
            row.note = note
        row, problem = decide(event, row, decision == 'accept', request.user)
        if problem:
            return Response({'detail': problem}, status=status.HTTP_409_CONFLICT)
        return Response(EventAttendanceSerializer(row).data)

    @action(detail=True, methods=['post', 'delete'], url_path='registrations/(?P<row_id>[^/.]+)/checkin', permission_classes=_AUTH)
    def registration_checkin(self, request, pk=None, row_id=None):
        """Day-of: mark somebody as here (POST) or undo a wrong tap (DELETE). Never touches the
        seat. Any staff member, volunteers included — that is what the role is for."""
        event = self.get_object()
        refused = self._staff_or_403(event)
        if refused:
            return refused
        row = event.attendances.filter(pk=row_id).first()
        if row is None:
            return Response(status=status.HTTP_404_NOT_FOUND)
        problem = check_in(row, request.user, undo=request.method == 'DELETE')
        if problem:
            return Response({'detail': problem}, status=status.HTTP_409_CONFLICT)
        return Response(EventAttendanceSerializer(row).data)

    @action(detail=True, methods=['get', 'put'], url_path='registration-fields', permission_classes=[permissions.IsAuthenticatedOrReadOnly, _EventsFeatureGate])
    def registration_fields(self, request, pk=None):
        """The organiser's own questions, replaced whole on PUT (one form submits one list).
        Readable by anybody who can see the event — the form has to be rendered to be filled."""
        event = self.get_object()
        if request.method == 'GET':
            return Response(RegistrationFieldSerializer(event.registration_fields.all(), many=True).data)
        refused = self._staff_or_403(event, organiser_only=True)
        if refused:
            return refused
        serializer = RegistrationFieldSerializer(data=request.data, many=True)
        serializer.is_valid(raise_exception=True)
        event.registration_fields.all().delete()
        rows = [RegistrationField(event=event, order=i, **attrs) for i, attrs in enumerate(serializer.validated_data)]
        RegistrationField.objects.bulk_create(rows)
        return Response(RegistrationFieldSerializer(event.registration_fields.all(), many=True).data)

    @action(detail=True, methods=['post', 'delete'], url_path='sessions/(?P<session_id>[^/.]+)/register', permission_classes=_AUTH)
    def session_register(self, request, pk=None, session_id=None):
        """A seat in a capped session, for somebody who already holds a seat at the event.
        Re-checked against the database on every call — two people answering the last seat at
        the same moment both saw it free."""
        event = self.get_object()
        session = event.sessions.filter(pk=session_id).first()
        if session is None:
            return Response(status=status.HTTP_404_NOT_FOUND)
        mine = event.attendances.filter(attendee=request.user).first()
        if request.method == 'DELETE':
            if mine:
                SessionAttendance.objects.filter(session=session, attendance=mine).delete()
            return Response({'registered': False, 'registered_count': session.registrations.count()})
        if not (mine and mine.status in ATTENDING_STATUSES):
            return Response({'detail': 'not_going'}, status=status.HTTP_409_CONFLICT)
        if not session.capacity:
            return Response({'detail': 'uncapped'}, status=status.HTTP_409_CONFLICT)
        already = SessionAttendance.objects.filter(session=session, attendance=mine).exists()
        if not already and session.registrations.count() >= session.capacity:
            return Response({'detail': 'session_full'}, status=status.HTTP_409_CONFLICT)
        SessionAttendance.objects.get_or_create(session=session, attendance=mine)
        return Response({'registered': True, 'registered_count': session.registrations.count()})
