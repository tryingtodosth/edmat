"""Events — public discovery, host-owned writes, and one answer per person.

The permission split is the one this app already uses everywhere else (`ServiceViewSet`,
`TaughtCourseViewSet`): anyone may read what is published, only the host may change it, and the
scoping happens in the queryset rather than in after-the-fact checks — so somebody poking at another
person's draft gets a 404, which is also the honest answer, since for them it does not exist.
"""

from django.db import IntegrityError, transaction
from django.utils import timezone
from rest_framework import permissions, status, viewsets
from rest_framework.decorators import action
from rest_framework.response import Response

from moderation.permissions import feature_gate

from .models import ATTENDING_STATUSES, PUBLIC_STATUSES, Event, EventAttendance
from .serializers import (
    AttendanceWriteSerializer,
    EventAttendanceSerializer,
    EventSerializer,
    EventWriteSerializer,
)
from .services import (
    notify_attendees_of_cancellation,
    notify_attendees_of_change,
    notify_host_of_response,
)

_EventsFeatureGate = feature_gate('events')


class EventViewSet(viewsets.ModelViewSet):
    permission_classes = [permissions.IsAuthenticatedOrReadOnly, _EventsFeatureGate]

    def get_queryset(self):
        """Two layers, and keeping them apart is a real bug fix rather than tidiness.

        DRF's `get_object` reads this same queryset, so a filter meant for the list narrows what is
        reachable by id as well. That is exactly right for the VISIBILITY layer — somebody else's
        draft should 404 on its own URL too — and exactly wrong for the browse filters: with
        `when=upcoming` applied unconditionally, `GET /api/events/{id}/` for a talk that happened last
        week answered 404, and so did an attempt to look at what you attended. Found by
        `AttendanceTests.test_a_past_event_cannot_be_answered`, which expected the honest refusal
        ("this already happened") and got "no such event".

        So: visibility always, browse filters only on `list`.
        """
        user = self.request.user
        qs = Event.objects.select_related('host', 'host__profile', 'field').prefetch_related(
            'subjects', 'attendances'
        )
        qs = self._visible_to(qs, user)
        if self.action != 'list':
            return qs
        return self._filtered(qs, user)

    def _visible_to(self, qs, user):
        """A draft belongs to its host alone.

        Filtering rather than permission-checking means it is absent from every listing for free, not
        hidden by a rule each new endpoint would have to remember — and somebody poking at an id they
        cannot see gets a 404, which is also the honest answer, since for them it does not exist.
        """
        visible = qs.filter(status__in=PUBLIC_STATUSES)
        if user.is_authenticated:
            visible = visible | qs.filter(host=user)
        return visible.distinct()

    def _filtered(self, qs, user):
        # Both `mine` lists deliberately return before the `when` filter below: somebody's own list
        # of what they have run, or been to, is a record rather than a schedule, and hiding last
        # term's seminar from the person who ran it would be losing their own history to a default.
        mine = self.request.query_params.get('mine')
        if mine == 'hosting':
            if not user.is_authenticated:
                return qs.none()
            # Drafts included on purpose: "the thing I have not announced yet" is exactly what
            # somebody opens this list to find. They are already in `qs` — the visibility layer keeps
            # your own drafts — so this needs no special case.
            return qs.filter(host=user)
        if mine == 'attending':
            if not user.is_authenticated:
                return qs.none()
            return qs.filter(
                attendances__attendee=user, attendances__status__in=ATTENDING_STATUSES
            ).distinct()

        # A cancelled event is readable at its own URL and stays in the lists of the people it
        # concerns, but it is not something on offer — so it is out of the browse listing.
        #
        # This was found by looking at the rendered page rather than by any assertion: three cancelled
        # events sat at the top of "Coming up", each one an invitation to click through to something
        # that is not happening. The half that matters is preserved by keeping it out of THIS filter
        # only: somebody who said they were going still sees it under "I am going to these", and the
        # link in their cancellation notification still resolves.
        qs = qs.exclude(status='cancelled')

        subject = self.request.query_params.get('subject')
        if subject:
            qs = qs.filter(subjects__slug=subject)
        field = self.request.query_params.get('field')
        if field:
            qs = qs.filter(field__slug=field)

        # `upcoming` is the default for a list nobody parameterized, because an events page that
        # opens on last month's talks is answering a question nobody asked. `past` is a real value
        # rather than only an absence of the filter, so "what did I miss" stays reachable, and it
        # reverses the ordering: most-recent-first is what "past" means to a reader, where
        # soonest-first is what "upcoming" means.
        #
        # The line is `starts_at`, not `ends_at`, even though the latter would keep an event that is
        # under way in the upcoming list for another hour. `ends_at` is derived from a duration
        # rather than stored, so filtering on it means either an expression the database has to
        # compute per row or a second denormalized column to keep in step — real cost for a
        # difference that lasts as long as one event does.
        when = self.request.query_params.get('when', 'upcoming')
        now = timezone.now()
        if when == 'upcoming':
            qs = qs.filter(starts_at__gte=now)
        elif when == 'past':
            qs = qs.filter(starts_at__lt=now).order_by('-starts_at')
        return qs.distinct()

    def get_serializer_class(self):
        if self.action in {'create', 'update', 'partial_update'}:
            return EventWriteSerializer
        return EventSerializer

    def perform_create(self, serializer):
        serializer.save(host=self.request.user)

    def create(self, request, *args, **kwargs):
        """Answers with the READ shape, not the write shape.

        The client needs the new event's id and its derived fields (`ends_at`, `can_respond`) to be
        able to navigate to it, and the write serializer carries neither — returning it would force
        an immediate second GET for something the server already has in hand.
        """
        write = self.get_serializer(data=request.data)
        write.is_valid(raise_exception=True)
        event = write.save(host=request.user)
        read = EventSerializer(event, context=self.get_serializer_context())
        return Response(read.data, status=status.HTTP_201_CREATED)

    def _mine_or_404(self):
        event = self.get_object()
        if event.host_id != self.request.user.pk:
            return None
        return event

    def update(self, request, *args, **kwargs):
        event = self._mine_or_404()
        if event is None:
            return Response(status=status.HTTP_404_NOT_FOUND)
        # Captured before the write, because "did the time or the place move" is a question only
        # something holding the old values can answer — see `notify_attendees_of_change`.
        before = (event.starts_at, event.location_kind, event.location_text, event.online_url)
        write = self.get_serializer(event, data=request.data, partial=kwargs.pop('partial', False))
        write.is_valid(raise_exception=True)
        event = write.save()
        after = (event.starts_at, event.location_kind, event.location_text, event.online_url)
        if before != after and event.status == 'published':
            moved_in_time = before[0] != after[0]
            note = (
                timezone.localtime(event.starts_at).strftime('%Y-%m-%d %H:%M')
                if moved_in_time
                else (event.location_text or event.online_url or '')[:300]
            )
            notify_attendees_of_change(event, request.user, note)
        return Response(EventSerializer(event, context=self.get_serializer_context()).data)

    def partial_update(self, request, *args, **kwargs):
        kwargs['partial'] = True
        return self.update(request, *args, **kwargs)

    def destroy(self, request, *args, **kwargs):
        """Deleting is for a draft nobody ever saw.

        Once an event is published, people have arranged their week around it, and the honest end of
        it is `cancel` — which keeps the row, keeps it visible, and tells everybody. Refusing here
        rather than silently turning a delete into a cancel, because a client that asked to delete
        should be told that is not what happened.
        """
        event = self._mine_or_404()
        if event is None:
            return Response(status=status.HTTP_404_NOT_FOUND)
        if event.status != 'draft' and event.going_count() > 0:
            return Response(
                {'detail': 'People are coming to this. Cancel it instead of deleting it.'},
                status=status.HTTP_409_CONFLICT,
            )
        event.delete()
        return Response(status=status.HTTP_204_NO_CONTENT)

    @action(detail=True, methods=['post'])
    def cancel(self, request, pk=None):
        event = self._mine_or_404()
        if event is None:
            return Response(status=status.HTTP_404_NOT_FOUND)
        if event.status == 'cancelled':
            # 409 rather than 400: the request was well formed, the state is simply not one this
            # transition applies to. `BookingViewSet` answers a repeated transition the same way.
            return Response(
                {'detail': 'Already cancelled.'}, status=status.HTTP_409_CONFLICT
            )
        event.status = 'cancelled'
        event.save(update_fields=['status', 'updated_at'])
        notify_attendees_of_cancellation(event, request.user)
        return Response(EventSerializer(event, context=self.get_serializer_context()).data)

    @action(detail=True, methods=['post'], permission_classes=[permissions.IsAuthenticated, _EventsFeatureGate])
    def attend(self, request, pk=None):
        """Say whether you are coming — and say it again later if you change your mind.

        One endpoint for both answers rather than an `attend` and an `unattend`, because there is one
        row and it has a value; two endpoints would leave a client having to know which one applies
        from the state it is holding, and getting it wrong on a stale page.
        """
        event = self.get_object()
        write = AttendanceWriteSerializer(data=request.data)
        write.is_valid(raise_exception=True)
        wanted = write.validated_data['status']

        existing = event.attendances.filter(attendee=request.user).first()
        # The cap is re-checked here against the database, not trusted from the `can_respond` the
        # client was last shown: two people answering a one-seat event at the same moment both saw
        # a free seat.
        reason = event.response_block_reason(request.user)
        if reason is not None and not (reason == 'full' and wanted == 'not_going'):
            return Response({'detail': reason}, status=status.HTTP_409_CONFLICT)

        try:
            with transaction.atomic():
                if existing:
                    existing.status = wanted
                    existing.note = write.validated_data.get('note', existing.note)
                    existing.save(update_fields=['status', 'note', 'responded_at'])
                    attendance = existing
                    # A change of mind is not news. The host was told the first time; being told
                    # again every time somebody toggles would be noise, and there is no event here
                    # worth interrupting them for.
                    newly_going = False
                else:
                    attendance = EventAttendance.objects.create(
                        event=event,
                        attendee=request.user,
                        status=wanted,
                        note=write.validated_data.get('note', ''),
                    )
                    newly_going = wanted in ATTENDING_STATUSES
        except IntegrityError:
            # The unique constraint firing means somebody double-clicked, or two tabs answered at
            # once. Not an error worth showing: read the row that won and answer with it.
            attendance = event.attendances.filter(attendee=request.user).first()
            newly_going = False

        if newly_going:
            notify_host_of_response(event, request.user, wanted)

        event.refresh_from_db()
        return Response(
            {
                'attendance': EventAttendanceSerializer(attendance).data,
                'event': EventSerializer(event, context=self.get_serializer_context()).data,
            }
        )

    @action(detail=True, methods=['get'])
    def attendees(self, request, pk=None):
        """Who is coming.

        Not public, on the same reasoning `classroom`'s roster is not: turning up to a seminar should
        not publish your name to anybody who finds the page. But unlike a course roster, the people
        who ARE coming can see each other — "is anybody else going" is half of why somebody opens an
        event at all, and an attendee list nobody in it can read would be a list for nobody. The host
        additionally sees the declines, which nobody else does.
        """
        event = self.get_object()
        user = request.user
        if not user.is_authenticated:
            return Response(status=status.HTTP_403_FORBIDDEN)
        is_host = event.host_id == user.pk
        mine = event.attendances.filter(attendee=user).first()
        if not is_host and not (mine and mine.status in ATTENDING_STATUSES):
            return Response(status=status.HTTP_403_FORBIDDEN)
        rows = event.attendances.select_related('attendee', 'attendee__profile')
        if not is_host:
            rows = rows.filter(status__in=ATTENDING_STATUSES)
        return Response(EventAttendanceSerializer(rows, many=True).data)
