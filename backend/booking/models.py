"""Booking a session with a tutor: when they are free, and who has taken which hour.

This attaches to `services.Service` — a tutoring *offering* — rather than inventing a second,
parallel notion of "a thing you can book". A Service already carries the provider, the courses, the
rate and the delivery mode; what it lacked was any answer to "when?".

**The one decision everything else here follows from.** A tutor chooses, per offering, how the
availability a student sees is computed (`Service.availability_mode`, in services/models.py, because
the ask was explicit that this be a real field on the offering rather than behaviour inferred from
something else):

* ``derived`` — publish real hours, minus whatever is already taken. Booking an hour removes it from
  what the next student sees.
* ``declared`` — publish a window and keep publishing it, even once half of it is spoken for. Some
  tutors advertise "2–4pm, ask me" and triage the requests themselves; that is a legitimate way to
  run a schedule, not a bug to be designed out.

Both modes produce *requests*, never confirmed appointments — see `Booking.status`. The mode changes
what is **shown** and what is **refused**, not who decides. That split is what keeps `declared` from
being a hole: a slot can be legitimately requested by two people, and the tutor answers each one.

**Why availability rules belong to the tutor, with an optional narrowing to one offering, rather
than to the offering outright.** A person has one calendar. A tutor with three listings who had to
re-declare Tuesday afternoon three times would be maintaining three copies of one fact, and — worse
— the copies would drift, so "when is this person free" would depend on which listing you asked. The
`service` FK being nullable is what keeps the narrower case available anyway: a rule pinned to one
listing is "I only teach Analiza on Thursday evenings", while a rule with no listing is the tutor's
general schedule. Busy time is *always* computed across every one of their listings, for the same
reason: an hour is taken regardless of which listing the student came through.

**Two layers of schedule, and which one is in force is a property of the week.** `AvailabilityRule`
above is the repeating pattern — unbounded, no dates, "this is what my ordinary week looks like". A
`WeekSchedule` (below) is one specific week that does NOT follow it: concrete hours for one Monday-
to-Sunday span, replacing the pattern outright for those seven days. A term that runs to one
timetable for five weeks and a different one in reading week is two facts, not one rule with a hole
in it, and this is the pair of models that can say so. `WeekTemplate` is the third piece and the
least load-bearing: a named shape on a shelf, doing nothing until it is applied to real weeks.
"""

from datetime import date as date_cls, timedelta

from django.conf import settings
from django.core.exceptions import ValidationError
from django.db import models

#: Weekday numbering follows `datetime.date.weekday()` — Monday is 0. Deliberately Python's own
#: convention rather than Django's `__week_day` lookup (Sunday is 1) or ISO's (Monday is 1), because
#: every comparison in availability.py is against a real `date.weekday()` call; picking either of the
#: other two would mean a conversion at each of those sites and exactly one of them eventually
#: forgetting it.
WEEKDAY_CHOICES = [
    (0, 'Monday'),
    (1, 'Tuesday'),
    (2, 'Wednesday'),
    (3, 'Thursday'),
    (4, 'Friday'),
    (5, 'Saturday'),
    (6, 'Sunday'),
]

# One-off departures from the weekly pattern, in both directions. Two kinds rather than a
# `is_blocked` boolean, because the second kind is a genuinely different statement: `block` is "not
# that Tuesday" (a conference, a dentist, an exam they are sitting themselves — the "any other
# appointments/events they have recorded" half of the brief), while `open` is "and also this one
# Saturday", which no amount of blocking can express.
EXCEPTION_KIND_CHOICES = [
    ('block', 'Not available'),
    ('open', 'Extra availability'),
]

BOOKING_STATUS_CHOICES = [
    # Where every booking starts, in BOTH availability modes. Nothing in this app ever creates a
    # confirmed booking directly: a stranger should not be able to write into somebody's calendar,
    # and a tutor should be free to refuse a particular student without having to undo an
    # appointment they never agreed to.
    ('requested', 'Requested'),
    ('confirmed', 'Confirmed'),
    # Three separate endings rather than one 'closed', for the reason classroom.Enrollment already
    # records for its own: who ended it and why is exactly what both parties need to read later, and
    # a single flag throws that away. They also behave differently — `declined` is the tutor's
    # answer to a request, `cancelled` is either party walking away from something already agreed.
    ('declined', 'Declined by the tutor'),
    ('cancelled', 'Cancelled'),
    ('completed', 'Completed'),
]

#: The statuses that occupy the tutor's time. This is the single definition behind three otherwise
#: independent behaviours — what `derived` availability subtracts, what a second request for the same
#: slot collides with, and what stops a listing being deleted out from under a real appointment — so
#: they cannot drift apart into three subtly different answers to one question.
#:
#: `requested` counts, which is a real choice with a real cost: it means the first person to ask
#: holds a `derived` slot until the tutor answers. The alternative (only `confirmed` holds) would let
#: a slot be shown as free, requested by four people, and disappoint three of them — which defeats
#: the entire promise of `derived` mode. The cost is that an unanswered request sits on an hour; see
#: CLAUDE.md's "Left open" for the expiry this app does not have.
BLOCKING_STATUSES = frozenset({'requested', 'confirmed'})

#: Statuses that are still live — a booking nobody has finished with yet.
OPEN_STATUSES = frozenset({'requested', 'confirmed'})


class AvailabilityRule(models.Model):
    """One recurring weekly window: "Tuesdays, 14:00–16:00"."""

    tutor = models.ForeignKey(
        settings.AUTH_USER_MODEL, related_name='availability_rules', on_delete=models.CASCADE
    )
    # Null means "all of my offerings" — see this module's own doc comment for why that is the
    # common case rather than the exception. SET_NULL rather than CASCADE would be wrong here: a rule
    # written *for one listing* has no meaning once that listing is gone, and silently promoting it
    # to a general rule would quietly widen the hours a tutor publishes.
    service = models.ForeignKey(
        'services.Service',
        related_name='availability_rules',
        null=True,
        blank=True,
        on_delete=models.CASCADE,
    )
    weekday = models.PositiveSmallIntegerField(choices=WEEKDAY_CHOICES)
    start_time = models.TimeField()
    end_time = models.TimeField()
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ['weekday', 'start_time']

    def clean(self):
        # A zero-length or reversed window is not a narrower rule, it is a rule that can never
        # produce a slot — so it fails here rather than sitting in the table looking like real
        # availability. Times are half-open (`start` inclusive, `end` exclusive) throughout
        # availability.py, so equality is empty rather than a single instant.
        if self.start_time >= self.end_time:
            raise ValidationError({'end_time': 'The end of a window must be after its start.'})

    def __str__(self) -> str:
        return f'{self.get_weekday_display()} {self.start_time:%H:%M}-{self.end_time:%H:%M} ({self.tutor})'


class AvailabilityException(models.Model):
    """A one-off departure from the weekly pattern, on one date."""

    tutor = models.ForeignKey(
        settings.AUTH_USER_MODEL, related_name='availability_exceptions', on_delete=models.CASCADE
    )
    date = models.DateField()
    kind = models.CharField(max_length=8, choices=EXCEPTION_KIND_CHOICES, default='block')
    # Null on both means the whole day, which is only meaningful for `block` ("I am away on the
    # 14th") — an all-day *opening* would be a claim to be free from midnight to midnight, which
    # nobody means, so BookingExceptionSerializer requires times for that kind. Kept nullable on the
    # model rather than split into two tables because the two kinds are otherwise identical and are
    # always read together, in date order, by the same query.
    start_time = models.TimeField(null=True, blank=True)
    end_time = models.TimeField(null=True, blank=True)
    note = models.CharField(max_length=200, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ['date', 'start_time']

    @property
    def is_all_day(self) -> bool:
        return self.start_time is None or self.end_time is None

    def clean(self):
        if self.start_time is not None and self.end_time is not None:
            if self.start_time >= self.end_time:
                raise ValidationError({'end_time': 'The end of a window must be after its start.'})

    def __str__(self) -> str:
        span = 'all day' if self.is_all_day else f'{self.start_time:%H:%M}-{self.end_time:%H:%M}'
        return f'{self.kind} {self.date} {span} ({self.tutor})'


def monday_of(day: date_cls) -> date_cls:
    """The Monday of the week containing `day`.

    **Stored weeks are always Monday-based, whatever week order the viewer has chosen to look at.**
    That is a storage decision, not a display one, and the two are deliberately separate: `week_start`
    is a lookup key, so it has to mean the same thing for everybody. If it followed each viewer's own
    `week_starts_on` preference, one calendar week would key to two different dates depending on who
    opened it, and a tutor switching to Sunday-first would silently re-partition every week they had
    already saved into halves of two others.

    Monday specifically, rather than an arbitrary pick between the two, because `weekday` on every
    model here is already Python's Monday-is-0 `date.weekday()` (see WEEKDAY_CHOICES) — so a week and
    the days in it are numbered by the same convention and no site has to convert.

    A Sunday-first viewer's *displayed* week therefore straddles two stored weeks. Nothing has to
    reconcile that, because editing is per-DAY: a window written on Sunday the 1st goes to whichever
    stored week the 1st actually belongs to, which is the honest answer and the one the tutor would
    give if asked. Only the bulk-apply operation works a week at a time, and it says in words which
    dates it is about to write.
    """
    return day - timedelta(days=day.weekday())


class ScheduleWindow(models.Model):
    """One window — "Tuesday 14:00–16:00" — belonging to either a template or a specific week.

    Abstract, so the two concrete tables below stay two tables (each meaning exactly one thing) while
    the columns, the ordering and the validation exist once. The alternative — a single table with a
    nullable FK to each parent and a check constraint that exactly one is set — trades that clarity
    for one fewer table, and this codebase has consistently taken the other side of that trade.
    """

    weekday = models.PositiveSmallIntegerField(choices=WEEKDAY_CHOICES)
    start_time = models.TimeField()
    end_time = models.TimeField()
    # Mirrors AvailabilityRule.service exactly, and for the same reason: null means "every listing I
    # run", which is the common case. Carrying it here is what stops a week that has been detached
    # from the repeating pattern from silently losing a rule that was pinned to one listing.
    service = models.ForeignKey(
        'services.Service',
        related_name='+',
        null=True,
        blank=True,
        on_delete=models.CASCADE,
    )

    class Meta:
        abstract = True
        ordering = ['weekday', 'start_time']

    def clean(self):
        if self.start_time >= self.end_time:
            raise ValidationError({'end_time': 'The end of a window must be after its start.'})


class WeekTemplate(models.Model):
    """A named week shape a tutor can save once and apply to as many weeks as they like.

    Deliberately NOT the same thing as the repeating `AvailabilityRule` pattern, even though both
    describe "a week". The pattern is what happens by default, forever, with no dates attached; a
    template is a shape sitting on a shelf that does nothing at all until somebody applies it to real
    weeks. Collapsing them would mean either that saving a template changed your live availability,
    or that your live availability was just one template among several with nothing marking which was
    in force — both worse than two models.
    """

    tutor = models.ForeignKey(
        settings.AUTH_USER_MODEL, related_name='week_templates', on_delete=models.CASCADE
    )
    name = models.CharField(max_length=100)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ['name']
        constraints = [
            # Per tutor, not global: two people may both sensibly call a template "Teaching weeks".
            models.UniqueConstraint(fields=['tutor', 'name'], name='unique_week_template_name'),
        ]

    def __str__(self) -> str:
        return f'{self.name} ({self.tutor})'


class WeekTemplateWindow(ScheduleWindow):
    template = models.ForeignKey(WeekTemplate, related_name='windows', on_delete=models.CASCADE)


class WeekSchedule(models.Model):
    """The concrete hours for ONE specific week, replacing the repeating pattern for that week.

    **This is the model that makes "change the third week only" expressible at all.** An
    `AvailabilityRule` is unbounded by construction — "Tuesdays, 14:00–16:00", with no dates — so
    there is no version of editing one that affects a single week. Bounding the rules with dates
    instead would mean every per-week edit split a rule into three (before, the changed week, after),
    which grows the table without limit and makes "what does my ordinary week look like" a question
    with no answer left in the data.

    So a week either follows the pattern or it does not, and the existence of one of these rows *is*
    that answer. When one exists, `availability._base_windows` reads the pattern for that week not at
    all — this replaces it outright rather than layering on top of it. That matters: a tutor who
    deletes every window from a detached week means "I am not working that week", and a design where
    the pattern showed through the gaps would publish hours they had just removed.

    One-off exceptions still apply on top, in both cases. "I am at a conference on the 14th" is a
    statement about the 14th, and it stays true whether or not that week has its own schedule.
    """

    tutor = models.ForeignKey(
        settings.AUTH_USER_MODEL, related_name='week_schedules', on_delete=models.CASCADE
    )
    #: Always a Monday — see `monday_of`. Normalised on save rather than merely expected, because a
    #: single row keyed to a Tuesday would be invisible to every lookup and the week would silently
    #: go on following the pattern.
    week_start = models.DateField()
    # Provenance only, and deliberately SET_NULL: it lets the editor say "from 'Teaching weeks'", and
    # deleting or renaming that template must not reach into weeks already written from it. A week's
    # hours are its own once applied — the template was the thing that produced them, not the thing
    # that owns them.
    source_template = models.ForeignKey(
        WeekTemplate, related_name='+', null=True, blank=True, on_delete=models.SET_NULL
    )
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ['week_start']
        constraints = [
            models.UniqueConstraint(fields=['tutor', 'week_start'], name='unique_week_schedule'),
        ]
        indexes = [
            # The hot query: "which of these weeks are detached", run once per availability request.
            models.Index(fields=['tutor', 'week_start']),
        ]

    def save(self, *args, **kwargs):
        self.week_start = monday_of(self.week_start)
        return super().save(*args, **kwargs)

    def __str__(self) -> str:
        return f'week of {self.week_start} ({self.tutor})'


class WeekScheduleWindow(ScheduleWindow):
    schedule = models.ForeignKey(WeekSchedule, related_name='windows', on_delete=models.CASCADE)


class Booking(models.Model):
    """One student asking one tutor for one session, and what became of it."""

    service = models.ForeignKey('services.Service', related_name='bookings', on_delete=models.CASCADE)
    # Denormalized from `service.provider`, and load-bearing rather than convenient: every busy-time
    # query in this app is tutor-wide across every listing they run (see this module's doc comment),
    # and routing that through `service__provider` would make the one query the whole feature depends
    # on a join that is easy to forget in a new call site. Set by the serializer from the service, so
    # it can never disagree with it.
    tutor = models.ForeignKey(
        settings.AUTH_USER_MODEL, related_name='bookings_as_tutor', on_delete=models.CASCADE
    )
    student = models.ForeignKey(
        settings.AUTH_USER_MODEL, related_name='bookings_as_student', on_delete=models.CASCADE
    )

    starts_at = models.DateTimeField()
    # Stored, not derived from `service.session_minutes` on read. A booking is an agreement about a
    # specific hour; a tutor who later changes their session length from 60 to 90 minutes has not
    # thereby lengthened every appointment already in their calendar.
    ends_at = models.DateTimeField()

    status = models.CharField(max_length=12, choices=BOOKING_STATUS_CHOICES, default='requested')
    # What the student wrote when asking ("I'm stuck on series convergence"), and the tutor's own
    # answer when confirming or declining. Two fields rather than one shared note, because they are
    # written by different people at different times and neither should overwrite the other.
    student_note = models.TextField(blank=True)
    tutor_note = models.TextField(blank=True)

    # Which side walked away. Null while the booking is live; on a cancellation this is the only
    # thing that distinguishes "the tutor cancelled on me" from "the student cancelled on me", which
    # is precisely the distinction each party wants when they look back at it.
    cancelled_by = models.ForeignKey(
        settings.AUTH_USER_MODEL, null=True, blank=True, related_name='+', on_delete=models.SET_NULL
    )
    decided_at = models.DateTimeField(null=True, blank=True)

    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ['starts_at']
        indexes = [
            # The one hot query: "what is this tutor's time already spoken for, between these two
            # instants" — run once per availability request, per day rendered.
            models.Index(fields=['tutor', 'status', 'starts_at']),
        ]

    def __str__(self) -> str:
        return f'{self.student} -> {self.tutor} {self.starts_at:%Y-%m-%d %H:%M} ({self.status})'
