"""The programme half of the events API — nested under `/api/events/{id}/…` for everything an
organiser edits, plus two top-level reads: `/api/sessions/?material=…` (the reverse listing an
exercise or material page shows) and `/api/my-agenda/` (+ `.ics`) for what a person bookmarked."""

from django.contrib.contenttypes.models import ContentType
from django.db.models import Prefetch, Q
from django.http import HttpResponse
from rest_framework import permissions, status, viewsets
from rest_framework.decorators import action
from rest_framework.response import Response
from rest_framework.views import APIView

from community.models import Comment
from community.serializers import CommentSerializer
from moderation.permissions import feature_gate
from moderation.services import is_feature_enabled
from notifications.services import notify

from .agenda_serializers import EventStaffSerializer, SessionSerializer, TrackSerializer
from .ics import agenda_calendar, event_calendar
from .models import (
    ATTENDING_STATUSES,
    PUBLIC_STATUSES,
    PUBLIC_VISIBILITY,
    STAFF_ROLE_CHOICES,
    Event,
    EventStaff,
    Session,
    SessionBookmark,
    Track,
)
from .services import going_attendees

_EventsFeatureGate = feature_gate('events')


def _session_queryset():
    return Session.objects.select_related('event', 'event__host', 'track').prefetch_related(
        'speakers__user__profile',
        'links__material__translations',
        'links__exercise__translations',
        'links__exercise_set',
        Prefetch('bookmarks', queryset=SessionBookmark.objects.all(), to_attr='bookmark_rows'),
    )


def _visible_events(user):
    qs = Event.objects.filter(status__in=PUBLIC_STATUSES, visibility__in=PUBLIC_VISIBILITY)
    if user.is_authenticated:
        qs = qs | Event.objects.filter(host=user) | Event.objects.filter(staff__user=user)
    return qs.distinct()


def _ics_response(text: str, filename: str) -> HttpResponse:
    response = HttpResponse(text, content_type='text/calendar; charset=utf-8')
    response['Content-Disposition'] = f'attachment; filename="{filename}"'
    return response


class ProgrammeMixin:
    """Actions added to `EventViewSet` — they read `self.get_object()` so the event's own
    visibility layer (a stranger's draft 404s) applies to every one of them for free."""

    def _organiser_or_403(self, event):
        if not event.can_organise(self.request.user):
            return Response(status=status.HTTP_403_FORBIDDEN)
        return None

    # ---- staff ------------------------------------------------------------------------------
    @action(detail=True, methods=['get', 'post'], permission_classes=[permissions.IsAuthenticated, _EventsFeatureGate])
    def staff(self, request, pk=None):
        event = self.get_object()
        if not event.is_staff_member(request.user):
            return Response(status=status.HTTP_403_FORBIDDEN)
        if request.method == 'GET':
            return Response(EventStaffSerializer(event.staff.select_related('user__profile', 'event'), many=True).data)
        refused = self._organiser_or_403(event)
        if refused:
            return refused
        role = request.data.get('role', 'organiser')
        if role not in dict(STAFF_ROLE_CHOICES):
            return Response({'detail': 'role must be organiser, reviewer or volunteer.'}, status=status.HTTP_400_BAD_REQUEST)
        from django.contrib.auth import get_user_model
        user = get_user_model().objects.filter(pk=request.data.get('user')).first()
        if user is None:
            return Response({'detail': 'no_such_user'}, status=status.HTTP_400_BAD_REQUEST)
        if event.staff.filter(user=user).exists():
            return Response({'detail': 'already_staff'}, status=status.HTTP_400_BAD_REQUEST)
        row = EventStaff.objects.create(event=event, user=user, role=role, added_by=request.user)
        return Response(EventStaffSerializer(row).data, status=status.HTTP_201_CREATED)

    @action(detail=True, methods=['patch', 'delete'], url_path='staff/(?P<staff_id>[^/.]+)', permission_classes=[permissions.IsAuthenticated, _EventsFeatureGate])
    def staff_detail(self, request, pk=None, staff_id=None):
        event = self.get_object()
        refused = self._organiser_or_403(event)
        if refused:
            return refused
        row = event.staff.filter(pk=staff_id).first()
        if row is None:
            return Response(status=status.HTTP_404_NOT_FOUND)
        if row.user_id == event.host_id:
            # The host's row is immutable through the API — see EventStaff's docstring.
            return Response({'detail': 'host_row_is_immutable'}, status=status.HTTP_400_BAD_REQUEST)
        if request.method == 'DELETE':
            row.delete()
            return Response(status=status.HTTP_204_NO_CONTENT)
        role = request.data.get('role')
        if role not in dict(STAFF_ROLE_CHOICES):
            return Response({'detail': 'role must be organiser, reviewer or volunteer.'}, status=status.HTTP_400_BAD_REQUEST)
        row.role = role
        row.save(update_fields=['role'])
        return Response(EventStaffSerializer(row).data)

    # ---- tracks -----------------------------------------------------------------------------
    @action(detail=True, methods=['get', 'post'], permission_classes=[permissions.IsAuthenticatedOrReadOnly, _EventsFeatureGate])
    def tracks(self, request, pk=None):
        event = self.get_object()
        if request.method == 'GET':
            return Response(TrackSerializer(event.tracks.all(), many=True).data)
        refused = self._organiser_or_403(event)
        if refused:
            return refused
        serializer = TrackSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        if event.tracks.filter(name=serializer.validated_data['name']).exists():
            return Response({'name': ['A track with that name already exists.']}, status=status.HTTP_400_BAD_REQUEST)
        track = serializer.save(event=event)
        return Response(TrackSerializer(track).data, status=status.HTTP_201_CREATED)

    @action(detail=True, methods=['patch', 'delete'], url_path='tracks/(?P<track_id>[^/.]+)', permission_classes=[permissions.IsAuthenticated, _EventsFeatureGate])
    def track_detail(self, request, pk=None, track_id=None):
        event = self.get_object()
        refused = self._organiser_or_403(event)
        if refused:
            return refused
        track = event.tracks.filter(pk=track_id).first()
        if track is None:
            return Response(status=status.HTTP_404_NOT_FOUND)
        if request.method == 'DELETE':
            track.delete()  # sessions keep existing, unfiled — SET_NULL
            return Response(status=status.HTTP_204_NO_CONTENT)
        serializer = TrackSerializer(track, data=request.data, partial=True)
        serializer.is_valid(raise_exception=True)
        serializer.save()
        return Response(serializer.data)

    # ---- sessions ---------------------------------------------------------------------------
    @action(detail=True, methods=['get', 'post'], permission_classes=[permissions.IsAuthenticatedOrReadOnly, _EventsFeatureGate])
    def sessions(self, request, pk=None):
        event = self.get_object()
        if request.method == 'GET':
            qs = _session_queryset().filter(event=event)
            return Response(SessionSerializer(qs, many=True, context={'request': request, 'event': event}).data)
        refused = self._organiser_or_403(event)
        if refused:
            return refused
        serializer = SessionSerializer(data=request.data, context={'request': request, 'event': event})
        serializer.is_valid(raise_exception=True)
        session = serializer.save()
        session = _session_queryset().get(pk=session.pk)
        return Response(SessionSerializer(session, context={'request': request, 'event': event}).data, status=status.HTTP_201_CREATED)

    @action(detail=True, methods=['get', 'patch', 'delete'], url_path='sessions/(?P<session_id>[^/.]+)', permission_classes=[permissions.IsAuthenticatedOrReadOnly, _EventsFeatureGate])
    def session_detail(self, request, pk=None, session_id=None):
        event = self.get_object()
        session = _session_queryset().filter(event=event, pk=session_id).first()
        if session is None:
            return Response(status=status.HTTP_404_NOT_FOUND)
        ctx = {'request': request, 'event': event}
        if request.method == 'GET':
            return Response(SessionSerializer(session, context=ctx).data)
        refused = self._organiser_or_403(event)
        if refused:
            return refused
        if request.method == 'DELETE':
            session.delete()
            return Response(status=status.HTTP_204_NO_CONTENT)
        before = (session.starts_at, session.duration_minutes, session.location_text, session.online_url)
        serializer = SessionSerializer(session, data=request.data, partial=True, context=ctx)
        serializer.is_valid(raise_exception=True)
        session = serializer.save()
        after = (session.starts_at, session.duration_minutes, session.location_text, session.online_url)
        if before != after and event.status == 'published':
            # Time or place only — the `event_updated` rule. Told to the people who bookmarked
            # THIS session and to everybody going; a description edit tells nobody.
            recipients = {b.user for b in session.bookmarks.select_related('user')}
            recipients.update(going_attendees(event))
            for person in recipients:
                notify(person, 'session_changed', actor=request.user, target_label=f'{session.title} — {event.title}', event=event)
        session = _session_queryset().get(pk=session.pk)
        return Response(SessionSerializer(session, context=ctx).data)

    @action(detail=True, methods=['post', 'delete'], url_path='sessions/(?P<session_id>[^/.]+)/bookmark', permission_classes=[permissions.IsAuthenticated, _EventsFeatureGate])
    def session_bookmark(self, request, pk=None, session_id=None):
        event = self.get_object()
        session = event.sessions.filter(pk=session_id).first()
        if session is None:
            return Response(status=status.HTTP_404_NOT_FOUND)
        if request.method == 'POST':
            SessionBookmark.objects.get_or_create(user=request.user, session=session)
        else:
            SessionBookmark.objects.filter(user=request.user, session=session).delete()
        session = _session_queryset().get(pk=session.pk)
        return Response(SessionSerializer(session, context={'request': request, 'event': event}).data)

    @action(detail=True, methods=['get', 'post'], url_path='sessions/(?P<session_id>[^/.]+)/comments', permission_classes=[permissions.IsAuthenticatedOrReadOnly, _EventsFeatureGate])
    def session_comments(self, request, pk=None, session_id=None):
        """The session's Q&A — the generic Comment with the votes it already has, so a question
        asked from the room can be upvoted by the rest of it."""
        event = self.get_object()
        session = event.sessions.filter(pk=session_id).first()
        if session is None:
            return Response(status=status.HTTP_404_NOT_FOUND)
        content_type = ContentType.objects.get_for_model(Session)
        if request.method == 'GET':
            qs = Comment.objects.filter(content_type=content_type, object_id=session.pk)
            return Response(CommentSerializer(qs.prefetch_related('votes'), many=True, context={'request': request}).data)
        serializer = CommentSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        parent = serializer.validated_data.get('parent')
        if parent is not None and (parent.content_type_id != content_type.id or parent.object_id != session.pk):
            return Response({'parent': ['This reply must belong to the same discussion.']}, status=status.HTTP_400_BAD_REQUEST)
        serializer.save(content_type=content_type, object_id=session.pk, author=request.user)
        if parent is not None and parent.author_id != request.user.pk:
            notify(parent.author, 'comment_reply', actor=request.user, target_label=session.title, event=event)
        return Response(serializer.data, status=status.HTTP_201_CREATED)

    # ---- export -----------------------------------------------------------------------------
    @action(detail=True, methods=['get'], permission_classes=[permissions.AllowAny, _EventsFeatureGate])
    def ics(self, request, pk=None):
        event = self.get_object()
        sessions = list(event.sessions.all())
        return _ics_response(event_calendar(event, sessions), f'edmat-event-{event.pk}.ics')


class SessionViewSet(viewsets.ReadOnlyModelViewSet):
    """GET /api/sessions/?material=|exercise=|exercise_set=|speaker= — the reverse listing: every
    visible session that links this thing, or that this person speaks at."""

    serializer_class = SessionSerializer
    permission_classes = [permissions.AllowAny, _EventsFeatureGate]

    def get_queryset(self):
        p = self.request.query_params
        qs = _session_queryset().filter(event__in=_visible_events(self.request.user))
        if p.get('material'):
            qs = qs.filter(links__material_id=p['material'])
        if p.get('exercise'):
            qs = qs.filter(links__exercise_id=p['exercise'])
        if p.get('exercise_set'):
            qs = qs.filter(links__exercise_set__slug=p['exercise_set'])
        if p.get('speaker'):
            qs = qs.filter(speakers__user_id=p['speaker'])
        if p.get('event'):
            qs = qs.filter(event_id=p['event'])
        return qs.distinct()

    def get_serializer_context(self):
        ctx = super().get_serializer_context()
        ctx['event'] = None
        return ctx

    @action(detail=True, methods=['get', 'post'], permission_classes=[permissions.IsAuthenticatedOrReadOnly, _EventsFeatureGate])
    def comments(self, request, pk=None):
        """`/api/sessions/{id}/comments/` — the same Q&A thread as the nested route, addressed
        by the session alone so the frontend's one comment-target→path table can name it."""
        session = self.get_object()
        content_type = ContentType.objects.get_for_model(Session)
        if request.method == 'GET':
            qs = Comment.objects.filter(content_type=content_type, object_id=session.pk)
            return Response(CommentSerializer(qs.prefetch_related('votes'), many=True, context={'request': request}).data)
        serializer = CommentSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        parent = serializer.validated_data.get('parent')
        if parent is not None and (parent.content_type_id != content_type.id or parent.object_id != session.pk):
            return Response({'parent': ['This reply must belong to the same discussion.']}, status=status.HTTP_400_BAD_REQUEST)
        serializer.save(content_type=content_type, object_id=session.pk, author=request.user)
        if parent is not None and parent.author_id != request.user.pk:
            notify(parent.author, 'comment_reply', actor=request.user, target_label=session.title, event=session.event)
        return Response(serializer.data, status=status.HTTP_201_CREATED)


class MyAgendaView(APIView):
    """What this person bookmarked, plus the events they said they are going to — one list,
    soonest first, and the same thing as a downloadable calendar at `.ics`."""

    permission_classes = [permissions.IsAuthenticated]

    def _rows(self, request):
        if not is_feature_enabled('events') and not request.user.is_staff:
            return [], []
        sessions = list(_session_queryset().filter(bookmarks__user=request.user).distinct())
        events = list(
            Event.objects.filter(attendances__attendee=request.user, attendances__status__in=ATTENDING_STATUSES)
            .exclude(status='cancelled').distinct()
        )
        return sessions, events

    def get(self, request, fmt=None):
        sessions, events = self._rows(request)
        if fmt == 'ics':
            return _ics_response(agenda_calendar(sessions, events), 'edmat-my-agenda.ics')
        from .serializers import EventSummarySerializer
        return Response({
            'sessions': SessionSerializer(sessions, many=True, context={'request': request, 'event': None}).data,
            'events': EventSummarySerializer(events, many=True, context={'request': request}).data,
        })
