"""Turning weekly rules, one-off exceptions and existing bookings into the list of slots a student
actually sees.

Everything here is pure interval arithmetic over aware datetimes, deliberately kept out of the views
and the serializers: it is the one part of this feature with real logic, it is what both the browse
endpoint and the "is this a slot you actually offered?" check at request time must agree on, and two
independent implementations of that agreement is exactly how a booking system starts accepting
appointments at 3am.

**The two modes meet in one place, and only one place** — `_busy_windows` is consulted for a
`derived` service and skipped for a `declared` one. Everything else (rules, exceptions, slicing,
dropping slots in the past) is identical. That is on purpose: the difference between the two modes
should be one subtraction, not two parallel code paths that can grow apart.

**Times are interpreted in the project timezone** (`settings.TIME_ZONE`, UTC today). A rule saying
14:00 means 14:00 there. This app has no per-tutor timezone field, so a tutor in another country
would be publishing hours in the wrong one — a real limitation, named in CLAUDE.md rather than
papered over with a guess based on the browser.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import date as date_cls, datetime, time, timedelta

from django.db.models import Q
from django.utils import timezone

from .models import (
    BLOCKING_STATUSES,
    OPEN_STATUSES,
    AvailabilityException,
    AvailabilityRule,
    Booking,
)

#: How far ahead an availability query may look. Not a performance guard (the queries are two, and
#: bounded) but an honesty one: a weekly rule says nothing about whether its author will still be
#: tutoring in eight months, and a calendar that confidently offers next March is inviting a booking
#: nobody will honour.
MAX_HORIZON_DAYS = 90

#: What the browse endpoint shows when the caller asks for no particular range.
DEFAULT_HORIZON_DAYS = 14


@dataclass(frozen=True)
class Interval:
    start: datetime
    end: datetime

    def overlaps(self, other: 'Interval') -> bool:
        # Half-open on both sides, so an appointment ending at 15:00 and one starting at 15:00 do
        # not collide. Back-to-back sessions are the normal case, not a conflict.
        return self.start < other.end and other.start < self.end


@dataclass(frozen=True)
class DaySlots:
    day: date_cls
    slots: list[Interval]


def _aware(day: date_cls, at: time) -> datetime:
    return timezone.make_aware(datetime.combine(day, at), timezone.get_default_timezone())


def _merge(intervals: list[Interval]) -> list[Interval]:
    """Union of possibly-overlapping intervals, in order.

    Needed because a tutor may well write two rules that touch — "Tuesdays 10–12" plus a one-off
    "and also 11–14 on the 3rd" — and slicing those into sessions separately would produce two
    overlapping series of slots, i.e. the same hour offered twice.
    """
    if not intervals:
        return []
    ordered = sorted(intervals, key=lambda i: i.start)
    merged = [ordered[0]]
    for current in ordered[1:]:
        last = merged[-1]
        if current.start <= last.end:
            merged[-1] = Interval(last.start, max(last.end, current.end))
        else:
            merged.append(current)
    return merged


def _subtract(base: list[Interval], cuts: list[Interval]) -> list[Interval]:
    """`base` minus `cuts`. A cut through the middle of a window genuinely splits it in two, which is
    why this returns a list rather than trimming edges: a 09:00–17:00 day with a 12:00–13:00 lunch
    booking is two windows, not one shorter one."""
    result = list(base)
    for cut in cuts:
        next_result: list[Interval] = []
        for window in result:
            if not window.overlaps(cut):
                next_result.append(window)
                continue
            if window.start < cut.start:
                next_result.append(Interval(window.start, cut.start))
            if cut.end < window.end:
                next_result.append(Interval(cut.end, window.end))
        result = next_result
    return result


def _rule_windows(tutor, days: list[date_cls], *, service=None) -> dict[date_cls, list[Interval]]:
    """The weekly pattern, expanded over the requested days.

    `service=None` means every rule this tutor has, whichever listing it was written for — the shape
    the tutor's OWN calendar needs, where "when might I be working" is the question and which listing
    an hour was published under is not. With a service, rules pinned to a DIFFERENT listing are
    correctly absent, which is the whole point of pinning one.
    """
    rules = AvailabilityRule.objects.filter(tutor=tutor)
    if service is not None:
        rules = rules.filter(Q(service__isnull=True) | Q(service=service))
    by_weekday: dict[int, list[AvailabilityRule]] = {}
    for rule in rules:
        by_weekday.setdefault(rule.weekday, []).append(rule)

    windows: dict[date_cls, list[Interval]] = {}
    for day in days:
        windows[day] = [
            Interval(_aware(day, rule.start_time), _aware(day, rule.end_time))
            for rule in by_weekday.get(day.weekday(), [])
        ]
    return windows


def _apply_exceptions(tutor, windows: dict[date_cls, list[Interval]]) -> None:
    """One-off openings added, one-off blocks removed. Mutates `windows` in place.

    Exceptions are tutor-wide with no per-service narrowing, unlike rules. A dentist appointment is
    not a fact about one of your listings, and an "extra hours this Saturday" opening that applied to
    only one of three listings would be a strange thing to want and a stranger one to explain.

    Order matters and is deliberate: openings are added *before* blocks are subtracted, so a block on
    the same day genuinely cuts the extra hours too. The other order would let an opening survive a
    day the tutor had already said they were away.
    """
    if not windows:
        return
    days = list(windows)
    exceptions = AvailabilityException.objects.filter(
        tutor=tutor, date__gte=min(days), date__lte=max(days)
    )
    blocks: dict[date_cls, list[Interval]] = {}
    for exception in exceptions:
        if exception.date not in windows:
            continue
        if exception.is_all_day:
            # Only ever a block (the serializer refuses an all-day opening). Midnight to midnight of
            # the following day, so the subtraction covers a window that runs to 23:59 as well as one
            # that stops at 17:00.
            span = Interval(
                _aware(exception.date, time.min), _aware(exception.date + timedelta(days=1), time.min)
            )
        else:
            span = Interval(
                _aware(exception.date, exception.start_time), _aware(exception.date, exception.end_time)
            )
        if exception.kind == 'open':
            windows[exception.date].append(span)
        else:
            blocks.setdefault(exception.date, []).append(span)

    for day in days:
        merged = _merge(windows[day])
        windows[day] = _subtract(merged, blocks.get(day, []))


def _busy_intervals(tutor, start: datetime, end: datetime) -> list[Interval]:
    """Everything already spoken for in the tutor's calendar, across **every** listing they run.

    Not scoped to this service on purpose: an hour a student booked through the tutor's physics
    listing is not available through their maths one, and scoping this would produce exactly that
    double-booking while every individual listing looked internally consistent.
    """
    bookings = Booking.objects.filter(
        tutor=tutor,
        status__in=BLOCKING_STATUSES,
        starts_at__lt=end,
        ends_at__gt=start,
    )
    return [Interval(b.starts_at, b.ends_at) for b in bookings]


def _slice(window: Interval, session: timedelta, not_before: datetime) -> list[Interval]:
    """Cut one free window into consecutive sessions.

    The step is the session length itself, so slots are back-to-back and never overlap. A sliding
    window (offering 14:00, 14:15, 14:30… for a 60-minute session) would show four times as many
    slots for the same three hours, and booking any one of them would silently invalidate the three
    around it — which is a much worse thing for a student to run into than a slightly coarser grid.

    The tail is dropped rather than offered short: 50 minutes left at the end of a window is not a
    60-minute session.
    """
    slots: list[Interval] = []
    cursor = window.start
    while cursor + session <= window.end:
        if cursor >= not_before:
            slots.append(Interval(cursor, cursor + session))
        cursor += session
    return slots


def slots_for_service(service, start_day: date_cls, end_day: date_cls, *, now=None) -> list[DaySlots]:
    """The availability a student is shown for one offering, day by day, inclusive of both ends.

    Returns every day in the range, including the empty ones — a calendar that silently omits the
    days with nothing on them makes "no slots on Wednesday" indistinguishable from "Wednesday wasn't
    asked about", and the caller rendering a week needs the difference.
    """
    now = now or timezone.now()
    if end_day < start_day:
        return []
    days = [start_day + timedelta(days=offset) for offset in range((end_day - start_day).days + 1)]

    windows = _rule_windows(service.provider, days, service=service)
    _apply_exceptions(service.provider, windows)

    # The one place the two modes diverge. A `declared` listing keeps publishing its window whether or
    # not somebody already has half of it — that is what the tutor asked for by choosing that mode.
    #
    # Note what is deliberately NOT done for `declared`: taken slots are not returned flagged as
    # taken. Doing so would leak the tutor's real calendar to anybody who opened the page, which is a
    # thing they can only have opted out of by choosing to triage requests themselves, and it would
    # half-defeat the mode anyway. What the student gets instead is an explicit statement of the mode
    # (see BookingAvailabilitySerializer and the UI's own notice), so nobody is misled about what
    # "available" means here.
    if service.availability_mode == 'derived':
        span_start = _aware(days[0], time.min)
        span_end = _aware(days[-1] + timedelta(days=1), time.min)
        busy = _merge(_busy_intervals(service.provider, span_start, span_end))
        for day in days:
            windows[day] = _subtract(windows[day], busy)

    session = timedelta(minutes=service.session_minutes)
    return [DaySlots(day=day, slots=_slice_all(windows[day], session, now)) for day in days]


def _slice_all(windows: list[Interval], session: timedelta, now: datetime) -> list[Interval]:
    slots: list[Interval] = []
    for window in windows:
        slots.extend(_slice(window, session, now))
    return slots


def windows_for_tutor(tutor, start_day: date_cls, end_day: date_cls) -> dict[date_cls, list[Interval]]:
    """The tutor's own published availability, day by day, across every listing they run.

    Three things it deliberately does NOT do, all of which the student-facing `slots_for_service`
    does:

    * it does not subtract bookings — a tutor's calendar shows the booking sitting *inside* the
      window it occupies, which is the whole point of looking at a calendar rather than a list;
    * it does not slice windows into sessions — session length is a property of one offering, and
      this view spans all of them;
    * it does not drop the past — somebody looking at last week wants to see last week.
    """
    if end_day < start_day:
        return {}
    days = [start_day + timedelta(days=offset) for offset in range((end_day - start_day).days + 1)]
    windows = _rule_windows(tutor, days)
    _apply_exceptions(tutor, windows)
    return windows


def is_offered_slot(service, starts_at: datetime, *, now=None) -> bool:
    """Whether `starts_at` is genuinely one of the slots this offering is publishing right now.

    This is the request-time gate, and it is deliberately the *same* function the browse endpoint
    uses rather than a separate "does this look reasonable" check. Two consequences fall out of that
    for free, which is why it is worth the extra query:

    * a student cannot request 03:00 on a Sunday just because they can craft the POST;
    * in `derived` mode, a slot that somebody else has already requested is simply not in the list,
      so the second request is refused with no separate collision check anywhere — while in
      `declared` mode the same slot *is* still in the list, so the second request is accepted. One
      subtraction expresses both modes' entire booking semantics.
    """
    day = timezone.localtime(starts_at, timezone.get_default_timezone()).date()
    for day_slots in slots_for_service(service, day, day, now=now):
        for slot in day_slots.slots:
            if slot.start == starts_at:
                return True
    return False


def conflicting_confirmed(booking) -> bool:
    """Whether confirming this booking would put the tutor in two places at once.

    Checked in **both** modes, and that is the considered answer rather than an oversight. `declared`
    mode is a statement about what is *published*, not a claim that its author can teach two students
    simultaneously; this app has no notion of a group session (a Booking has exactly one student), so
    allowing two overlapping confirmations would be silently pretending it does.

    It matters in `derived` mode too, despite the request path already refusing overlaps there: a
    tutor can switch an offering from `declared` to `derived` after the requests have landed, and
    those requests are still sitting there overlapping each other.
    """
    return (
        Booking.objects.filter(
            tutor=booking.tutor,
            status='confirmed',
            starts_at__lt=booking.ends_at,
            ends_at__gt=booking.starts_at,
        )
        .exclude(pk=booking.pk)
        .exists()
    )


def overlapping_open(booking):
    """The tutor's other live requests/bookings for the same time — the thing a tutor running a
    `declared` listing is actually deciding between when two people ask for Tuesday at 2.

    Surfaced to the tutor rather than resolved for them: confirming one of three requests does not
    auto-decline the other two, because the tutor may want to counter-offer, or may know the other
    two are the same study group. What they must not be asked to do is decide blind.
    """
    return (
        Booking.objects.filter(
            tutor=booking.tutor,
            status__in=OPEN_STATUSES,
            starts_at__lt=booking.ends_at,
            ends_at__gt=booking.starts_at,
        )
        .exclude(pk=booking.pk)
        .select_related('student', 'service')
    )
