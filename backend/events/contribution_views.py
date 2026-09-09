"""Endpoints for the call for contributions (AUDIENCE-BRIEF.md §3.4), mixed into `EventViewSet`.
Visibility is a filter, not a permission check: accepted and scheduled proposals are public;
everything else is the submitter's and the staff's."""

from django.core.exceptions import ValidationError
from rest_framework import permissions, status
from rest_framework.decorators import action
from rest_framework.response import Response

from moderation.permissions import feature_gate

from . import contributions as engine
from .models import CONTRIBUTION_PUBLIC_STATUSES, Contribution, Track
from .serializers import ContributionSerializer, ContributionWriteSerializer

_EventsFeatureGate = feature_gate('events')


class ContributionMixin:
    def _visible_contributions(self, event):
        user = self.request.user
        qs = event.contributions.select_related('submitter__profile', 'decided_by__profile', 'session')
        if event.is_staff_member(user):
            return qs
        public = qs.filter(status__in=CONTRIBUTION_PUBLIC_STATUSES)
        if user.is_authenticated:
            return (public | qs.filter(submitter=user)).distinct()
        return public

    def _ctx(self, event):
        return {'request': self.request, 'event': event, 'is_staff': event.is_staff_member(self.request.user)}

    @action(detail=True, methods=['get', 'post'], permission_classes=[permissions.IsAuthenticatedOrReadOnly, _EventsFeatureGate])
    def contributions(self, request, pk=None):
        event = self.get_object()
        if request.method == 'GET':
            return Response(ContributionSerializer(self._visible_contributions(event), many=True, context=self._ctx(event)).data)
        if not engine.call_is_open(event):
            return Response({'detail': 'call_closed'}, status=status.HTTP_409_CONFLICT)
        serializer = ContributionWriteSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        submit_now = bool(request.data.get('submit', True))
        c = serializer.save(event=event, submitter=request.user)
        if submit_now:
            engine.submit(c, request.user)
        return Response(ContributionSerializer(c, context=self._ctx(event)).data, status=status.HTTP_201_CREATED)

    @action(detail=True, methods=['get', 'patch'], url_path='contributions/(?P<contribution_id>[^/.]+)', permission_classes=[permissions.IsAuthenticatedOrReadOnly, _EventsFeatureGate])
    def contribution_detail(self, request, pk=None, contribution_id=None):
        event = self.get_object()
        c = self._visible_contributions(event).filter(pk=contribution_id).first()
        if c is None:
            return Response(status=status.HTTP_404_NOT_FOUND)
        if request.method == 'GET':
            return Response(ContributionSerializer(c, context=self._ctx(event)).data)
        # Editing is the author's, and only while nobody has decided anything — draft or
        # (re)submitted; under review it is read-only, the Indico rule.
        if c.submitter_id != request.user.pk:
            return Response(status=status.HTTP_403_FORBIDDEN)
        if c.status not in ('draft', 'submitted'):
            return Response({'detail': 'read_only'}, status=status.HTTP_409_CONFLICT)
        serializer = ContributionWriteSerializer(c, data=request.data, partial=True)
        serializer.is_valid(raise_exception=True)
        serializer.save()
        return Response(ContributionSerializer(c, context=self._ctx(event)).data)

    @action(detail=True, methods=['post'], url_path='contributions/(?P<contribution_id>[^/.]+)/(?P<verb>submit|unsubmit|withdraw|review|revisions|accept|reject|schedule|unschedule)', permission_classes=[permissions.IsAuthenticated, _EventsFeatureGate])
    def contribution_transition(self, request, pk=None, contribution_id=None, verb=None):
        event = self.get_object()
        c = self._visible_contributions(event).filter(pk=contribution_id).first()
        if c is None:
            return Response(status=status.HTTP_404_NOT_FOUND)
        user = request.user
        is_author = c.submitter_id == user.pk
        is_reviewer = event.is_staff_member(user) and event.role_of(user) in ('organiser', 'reviewer')
        is_organiser = event.can_organise(user)
        note = (request.data.get('note') or '')[:2000]
        problem = None
        created = None
        if verb in ('submit', 'unsubmit', 'withdraw'):
            if not is_author:
                return Response(status=status.HTTP_403_FORBIDDEN)
            problem = {'submit': lambda: engine.submit(c, user), 'unsubmit': lambda: engine.unsubmit(c), 'withdraw': lambda: engine.withdraw(c, user)}[verb]()
        elif verb in ('review', 'revisions', 'accept', 'reject'):
            if not is_reviewer:
                return Response(status=status.HTTP_403_FORBIDDEN)
            if verb == 'review':
                problem = engine.start_review(c, user)
            elif verb == 'revisions':
                problem = engine.request_revisions(c, user, note)
            elif verb == 'accept':
                problem = engine.accept(c, user, note)
            else:
                problem = engine.reject(c, user, request.data.get('reason_code') or '', note)
        else:  # schedule / unschedule — organisers only, it writes the programme
            if not is_organiser:
                return Response(status=status.HTTP_403_FORBIDDEN)
            if verb == 'unschedule':
                problem = engine.unschedule(c, user)
            else:
                from rest_framework.fields import DateTimeField
                try:
                    starts_at = DateTimeField().to_internal_value(request.data.get('starts_at'))
                except Exception:
                    return Response({'starts_at': ['A start time is required.']}, status=status.HTTP_400_BAD_REQUEST)
                track = None
                if request.data.get('track'):
                    track = Track.objects.filter(pk=request.data['track'], event=event).first()
                try:
                    problem, created = engine.schedule(
                        c, user, starts_at=starts_at, duration_minutes=int(request.data.get('duration_minutes') or 60),
                        track=track, location_text=(request.data.get('location_text') or '')[:300], online_url=(request.data.get('online_url') or '')[:500],
                    )
                except ValidationError as e:
                    return Response(e.message_dict if hasattr(e, 'message_dict') else {'detail': e.messages}, status=status.HTTP_400_BAD_REQUEST)
        if problem:
            code = status.HTTP_400_BAD_REQUEST if problem in ('reason_required', 'note_required') else status.HTTP_409_CONFLICT
            return Response({'detail': problem}, status=code)
        c.refresh_from_db()
        return Response(ContributionSerializer(c, context=self._ctx(event)).data)
