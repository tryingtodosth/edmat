from datetime import date as date_cls, datetime, time, timedelta

from django.db.models import Q
from django.utils import timezone
from rest_framework import permissions, status, viewsets
from rest_framework.decorators import action
from rest_framework.response import Response
from rest_framework.views import APIView

from moderation.permissions import feature_gate
from services.models import Service

from .availability import (
    DEFAULT_HORIZON_DAYS,
    MAX_HORIZON_DAYS,
    conflicting_confirmed,
    overlapping_open,
    slots_for_service,
    windows_for_tutor,
)
from .models import OPEN_STATUSES, AvailabilityException, AvailabilityRule, Booking
from .serializers import (
    AvailabilityExceptionSerializer,
    AvailabilityRuleSerializer,
    BookingCreateSerializer,
    BookingSerializer,
)
from .services import notify_cancelled, notify_confirmed, notify_declined, notify_requested

# Booking is part of tutoring, not a feature of its own, so it hides behind the SAME kill switch
# rather than gaining a second flag a moderator would have to remember to pull as well. Turning
# tutoring off already takes the listings away; leaving their booking endpoints live would mean a
# stale tab could still write appointments against a feature that is supposed to be gone.
_TutoringFeatureGate = feature_gate('tutoring')


def _parse_day(raw, fallback: date_cls) -> date_cls:
    if not raw:
        return fallback
    try:
        return date_cls.fromisoformat(raw)
    except ValueError:
        # Ignored rather than 400'd, matching `?near=`'s own established behaviour in
        # services/views.py: this is a browse parameter, and rendering the default fortnight is
        # friendlier than failing the page over a malformed date.
        return fallback


class ServiceAvailabilityView(APIView):
    """`GET /api/services/{id}/availability/?from=&to=` — what a student is shown.

    It lives in the booking app despite the `services/` URL shape, and that is the right way round:
    the URL says what the availability is *of*, while the code belongs with the logic that computes
    it. Wiring it as an `@action` on `ServiceViewSet` instead would have made the services app import
    the booking app, which already imports it back.

    Public, matching the listing itself — a student comparing tutors should not have to register to
    find out when they are free. The response says which mode produced it, because "available" means
    two different things depending on that answer and the student is entitled to know which.
    """

    permission_classes = [permissions.AllowAny, _TutoringFeatureGate]

    def get(self, request, pk=None):
        # `Service.objects.all()`, not the active-only browse queryset: a provider previewing their
        # own paused listing needs this to answer, and an inactive listing's availability is
        # harmless to compute — BookingCreateSerializer is what refuses to actually book one.
        service = Service.objects.filter(pk=pk).first()
        if service is None:
            return Response(status=status.HTTP_404_NOT_FOUND)

        today = timezone.localdate()
        start_day = _parse_day(request.query_params.get('from'), today)
        end_day = _parse_day(
            request.query_params.get('to'), start_day + timedelta(days=DEFAULT_HORIZON_DAYS - 1)
        )
        # Never show the past, whatever was asked for — a slot behind us is not availability.
        start_day = max(start_day, today)
        end_day = min(end_day, today + timedelta(days=MAX_HORIZON_DAYS))

        days = slots_for_service(service, start_day, end_day)
        return Response(
            {
                'service': service.pk,
                # The two things that decide how the calendar below should be READ, returned with it
                # rather than left to the client to have fetched separately and possibly staler.
                'availability_mode': service.availability_mode,
                'session_minutes': service.session_minutes,
                # True when the tutor has published no weekly rules at all for this offering. Worth
                # its own flag rather than being inferred from "every day is empty": a fully-booked
                # week and a schedule nobody ever wrote look identical otherwise, and they call for
                # completely different words on screen.
                'has_schedule': service.provider.availability_rules.filter(
                    Q(service__isnull=True) | Q(service=service)
                ).exists(),
                'days': [
                    {
                        'date': day.day.isoformat(),
                        'slots': [
                            {'start': slot.start.isoformat(), 'end': slot.end.isoformat()}
                            for slot in day.slots
                        ],
                    }
                    for day in days
                ],
            }
        )


class MyScheduleView(APIView):
    """`GET /api/my-schedule/?from=&to=` — the caller's own calendar: published windows, and the
    bookings sitting inside them.

    A separate endpoint from `/services/{id}/availability/` rather than a flag on it, because the two
    answer genuinely different questions. That one asks "what can I book on this offering", so it is
    scoped to one listing, sliced into that listing's session length, and has the taken hours already
    removed. This asks "what does my week look like", which spans every listing, has no single
    session length to slice by, and must show the bookings rather than subtract them — a calendar
    with the appointments cut out of it is the one thing a calendar must not be.

    It also does not hide the past: somebody looking back at last week wants last week.

    Both parties' bookings come back, not only the ones where the caller is the tutor. Somebody who
    teaches on Tuesday and takes a lesson on Thursday has one week, not two, and a calendar showing
    half of it would be worse than useless for deciding whether Thursday is free.
    """

    permission_classes = [permissions.IsAuthenticated, _TutoringFeatureGate]

    def get(self, request):
        today = timezone.localdate()
        start_day = _parse_day(request.query_params.get('from'), today)
        end_day = _parse_day(
            request.query_params.get('to'), start_day + timedelta(days=DEFAULT_HORIZON_DAYS - 1)
        )
        # Bounded by SPAN here rather than clamped to a horizon from today, unlike the public
        # endpoint: this one may legitimately look backwards, so "no more than 90 days at a time" is
        # the honest limit, not "nothing past today + 90".
        if (end_day - start_day).days > MAX_HORIZON_DAYS:
            end_day = start_day + timedelta(days=MAX_HORIZON_DAYS)

        windows = windows_for_tutor(request.user, start_day, end_day)

        tz = timezone.get_default_timezone()
        span_start = timezone.make_aware(datetime.combine(start_day, time.min), tz)
        span_end = timezone.make_aware(
            datetime.combine(end_day + timedelta(days=1), time.min), tz
        )
        bookings = (
            Booking.objects.filter(Q(tutor=request.user) | Q(student=request.user))
            .filter(starts_at__lt=span_end, ends_at__gt=span_start)
            .select_related('service', 'tutor', 'student', 'tutor__profile', 'student__profile')
        )
        # `as_tutor` is decided per row, not per request: one week can hold both a lesson somebody
        # booked with you and one you booked with somebody else, and only the first kind may carry a
        # clash count (BookingSerializer.get_overlapping_count).
        serialized = [
            BookingSerializer(
                booking,
                context={'request': request, 'as_tutor': booking.tutor_id == request.user.pk},
            ).data
            for booking in bookings
        ]

        return Response(
            {
                'days': [
                    {
                        'date': day.isoformat(),
                        'windows': [
                            {'start': window.start.isoformat(), 'end': window.end.isoformat()}
                            for window in day_windows
                        ],
                    }
                    for day, day_windows in sorted(windows.items())
                ],
                'bookings': serialized,
            }
        )


class AvailabilityRuleViewSet(viewsets.ModelViewSet):
    """A tutor's own weekly windows. Authenticated-only and owner-scoped throughout — there is no
    public read at all, because the *rules* are an implementation detail of the availability a
    student is shown, and in `declared` mode showing them raw would leak more than the tutor chose
    to publish."""

    serializer_class = AvailabilityRuleSerializer
    permission_classes = [permissions.IsAuthenticated, _TutoringFeatureGate]

    def get_queryset(self):
        # Queryset-scoping rather than permission-checking, the pattern every owner-scoped viewset in
        # this app already follows: somebody else's rule 404s rather than 403ing.
        return AvailabilityRule.objects.filter(tutor=self.request.user)

    def perform_create(self, serializer):
        serializer.save(tutor=self.request.user)


class AvailabilityExceptionViewSet(viewsets.ModelViewSet):
    """One-off blocks and extra openings. Same posture as the rules above, and for the same reason —
    with one extra: a block is frequently *why* somebody is unavailable ("hospital appointment"), and
    that note is nobody else's business."""

    serializer_class = AvailabilityExceptionSerializer
    permission_classes = [permissions.IsAuthenticated, _TutoringFeatureGate]

    def get_queryset(self):
        qs = AvailabilityException.objects.filter(tutor=self.request.user)
        # `?from=` — the schedule editor only ever shows upcoming exceptions, and a tutor who has
        # been using the app for a year should not have to receive every past block to render it.
        from_day = _parse_day(self.request.query_params.get('from'), None)
        if from_day is not None:
            qs = qs.filter(date__gte=from_day)
        return qs

    def perform_create(self, serializer):
        serializer.save(tutor=self.request.user)


class BookingViewSet(viewsets.ReadOnlyModelViewSet):
    """A booking, from both ends.

    `ReadOnlyModelViewSet` plus explicit actions rather than a full `ModelViewSet`: a booking is
    never edited as a bag of fields. Every change to one is a specific act by a specific party —
    confirm, decline, cancel, complete — each with its own rules about who may do it and from which
    status, and a generic PATCH would be a way to write `status='confirmed'` straight past all of
    them.
    """

    serializer_class = BookingSerializer
    permission_classes = [permissions.IsAuthenticated, _TutoringFeatureGate]

    def get_queryset(self):
        # Scoped to the two parties, so a third party's read is a 404 rather than a 403 — matching
        # messaging/views.py's own answer to exactly this question for a private conversation.
        user = self.request.user
        qs = Booking.objects.filter(Q(student=user) | Q(tutor=user)).select_related(
            'service', 'tutor', 'student', 'tutor__profile', 'student__profile'
        )
        role = self.request.query_params.get('role')
        if role == 'tutor':
            qs = qs.filter(tutor=user)
        elif role == 'student':
            qs = qs.filter(student=user)
        if self.request.query_params.get('upcoming') == 'true':
            qs = qs.filter(ends_at__gte=timezone.now(), status__in=OPEN_STATUSES)
        return qs

    def get_serializer_context(self):
        context = super().get_serializer_context()
        # Whether the CALLER is the tutor on each row decides whether they are told about clashes at
        # all (BookingSerializer.get_overlapping_count). A mixed list — one page showing both the
        # bookings you made and the ones made with you — is the normal case, so this is per row
        # rather than per request.
        context['as_tutor'] = False
        return context

    def _serialize(self, booking):
        context = self.get_serializer_context()
        context['as_tutor'] = booking.tutor_id == self.request.user.pk
        return BookingSerializer(booking, context=context).data

    def list(self, request, *args, **kwargs):
        bookings = self.filter_queryset(self.get_queryset())
        return Response([self._serialize(b) for b in bookings])

    def retrieve(self, request, *args, **kwargs):
        return Response(self._serialize(self.get_object()))

    def create(self, request, *args, **kwargs):
        serializer = BookingCreateSerializer(
            data=request.data, context=self.get_serializer_context()
        )
        serializer.is_valid(raise_exception=True)
        booking = serializer.save()
        notify_requested(booking)
        return Response(self._serialize(booking), status=status.HTTP_201_CREATED)

    def _require(self, booking, *, party: str, from_statuses: set[str]):
        """The two questions every transition below asks. Returns an error Response, or None.

        `409 Conflict` rather than `400` for a wrong-status transition, deliberately: nothing about
        the request was malformed — a booking that has already been cancelled is a state of the
        world, and a client that raced another tab into it deserves a status code that says so.
        """
        actor_ok = (
            booking.tutor_id == self.request.user.pk
            if party == 'tutor'
            else booking.student_id == self.request.user.pk
            if party == 'student'
            else True
        )
        if not actor_ok:
            # 403 rather than 404 here, unlike the queryset scoping above: the caller is genuinely
            # one of the two parties (or they would never have got this far), they are simply the
            # wrong one for this particular act. Pretending it does not exist would be a lie they can
            # immediately disprove by reading it.
            return Response(
                {'detail': 'Only the other party can do that.'}, status=status.HTTP_403_FORBIDDEN
            )
        if booking.status not in from_statuses:
            return Response(
                {'detail': f'A {booking.get_status_display().lower()} booking cannot be changed that way.'},
                status=status.HTTP_409_CONFLICT,
            )
        return None

    @action(detail=True, methods=['post'])
    def confirm(self, request, pk=None):
        booking = self.get_object()
        error = self._require(booking, party='tutor', from_statuses={'requested'})
        if error:
            return error
        # Checked in BOTH availability modes — see availability.conflicting_confirmed for why a
        # `declared` listing is not a licence to be in two places at once.
        if conflicting_confirmed(booking):
            return Response(
                {'detail': 'You have already confirmed another session at that time.'},
                status=status.HTTP_409_CONFLICT,
            )
        booking.status = 'confirmed'
        booking.tutor_note = (request.data.get('tutor_note') or '').strip()[:2000]
        booking.decided_at = timezone.now()
        booking.save(update_fields=['status', 'tutor_note', 'decided_at', 'updated_at'])
        notify_confirmed(booking)
        return Response(self._serialize(booking))

    @action(detail=True, methods=['post'])
    def decline(self, request, pk=None):
        booking = self.get_object()
        error = self._require(booking, party='tutor', from_statuses={'requested'})
        if error:
            return error
        booking.status = 'declined'
        booking.tutor_note = (request.data.get('tutor_note') or '').strip()[:2000]
        booking.decided_at = timezone.now()
        booking.save(update_fields=['status', 'tutor_note', 'decided_at', 'updated_at'])
        notify_declined(booking)
        return Response(self._serialize(booking))

    @action(detail=True, methods=['post'])
    def cancel(self, request, pk=None):
        """Either party, from either live status.

        A student cancelling a `requested` booking is really a withdrawal and a tutor cancelling a
        `confirmed` one is really breaking an agreement, but both end in the same place and
        `cancelled_by` records which happened — a separate 'withdrawn' status would add a fifth
        terminal state that behaves identically to this one in every query.
        """
        booking = self.get_object()
        error = self._require(booking, party='either', from_statuses=set(OPEN_STATUSES))
        if error:
            return error
        booking.status = 'cancelled'
        booking.cancelled_by = request.user
        booking.save(update_fields=['status', 'cancelled_by', 'updated_at'])
        notify_cancelled(booking, actor=request.user)
        return Response(self._serialize(booking))

    @action(detail=True, methods=['post'])
    def complete(self, request, pk=None):
        """The tutor marking a session as having actually happened.

        Refused before the session has ended, which is the one guard that makes this status mean
        anything: a 'completed' booking for an hour still in the future is a claim about something
        that has not occurred. Not automatic on the clock passing either — plenty of confirmed
        sessions do not happen, and silently marking them complete would turn a real record of what
        took place into a record of what was scheduled.
        """
        booking = self.get_object()
        error = self._require(booking, party='tutor', from_statuses={'confirmed'})
        if error:
            return error
        if booking.ends_at > timezone.now():
            return Response(
                {'detail': 'That session has not finished yet.'}, status=status.HTTP_409_CONFLICT
            )
        booking.status = 'completed'
        booking.save(update_fields=['status', 'updated_at'])
        return Response(self._serialize(booking))

    @action(detail=True, methods=['get'])
    def clashes(self, request, pk=None):
        """The tutor's other live bookings at the same time — what makes a contested `declared` slot
        decidable rather than a guess. Tutor-only, because it is a window onto their whole calendar
        across every listing they run, which is precisely what a student must not see."""
        booking = self.get_object()
        if booking.tutor_id != request.user.pk:
            return Response(status=status.HTTP_403_FORBIDDEN)
        context = self.get_serializer_context()
        context['as_tutor'] = True
        return Response(BookingSerializer(overlapping_open(booking), many=True, context=context).data)
