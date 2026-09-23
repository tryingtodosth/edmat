"""The volunteer rota: a station is a post, a shift is an hour of it, an assignment is a person.

`CONFERENCE-BRIEF.md` §3.E. The shape is the research report's (R2 §2) minus its swap machinery:
a volunteer who cannot make a shift **drops it back into the pool** (with a cutoff) instead of
negotiating a bilateral trade, because somebody who has just fallen ill has no time to find a
replacement and software that insists on one turns into an unannounced no-show. The one thing the
report's five entities keep that we do not build as a table is its `Hours Log`: hours are
**derived** from a `done` assignment's own shift, with `hours_credited` as the organiser's
override, because a second table that stores what the first one already implies is one more thing
that can disagree with the rota.

Why its own app rather than more of `events`: seven conference steps were built in parallel on
seven branches and only one of them was allowed an `events` migration (§4 rule 1). But the split
would be right anyway — a rota owns a lifecycle (offered → claimed → confirmed → done/no_show),
a set of safeguarding invariants, and a legal artefact (`VolunteerRecord`) that no other part of
an event has any use for. `events` keeps meaning "who is coming"; `shifts` means "who is working".

**No volunteer-facing response ever carries another volunteer's contact data** (§6 rule 3) — the
serializers mask a co-volunteer down to a first name and a last initial, and the desk somebody is
meant to reach is `Station.location_text` of the `info` station, not a phone number.
"""

from datetime import timedelta
from decimal import Decimal

from django.conf import settings
from django.core.exceptions import ValidationError
from django.db import models

STATION_KIND_CHOICES = [
    ('door', 'Door / entrance'),
    ('room', 'Session room'),
    ('info', 'Information desk'),
    ('cloakroom', 'Cloakroom'),
    ('runner', 'Runner'),
    ('setup', 'Set-up / tear-down'),
    ('other', 'Other'),
]

ASSIGNMENT_STATUS_CHOICES = [
    ('offered', 'Offered'),
    ('claimed', 'Claimed'),
    ('confirmed', 'Confirmed'),
    ('dropped', 'Dropped'),
    ('no_show', 'No show'),
    ('done', 'Done'),
]

ASSIGNMENT_SOURCE_CHOICES = [
    ('self', 'Claimed by the volunteer'),
    ('organiser', 'Assigned by an organiser'),
    ('pool', 'Picked up from the pool'),
]

#: Statuses that occupy one of a shift's places. `dropped` does not (that is the whole point of
#: dropping), and `no_show` does not either — the place was not covered, and a coverage grid that
#: counted it would tell an organiser the door was staffed while nobody was standing at it.
HOLDING_STATUSES = ('offered', 'claimed', 'confirmed', 'done')

#: Statuses that count as "this person is really going to be there" — what the overlap, gap and
#: daily-cap invariants are computed over, and what `requires_adult` looks for.
COMMITTED_STATUSES = ('claimed', 'confirmed', 'done')

#: Statuses an assignment can still be dropped or decided from.
LIVE_STATUSES = ('offered', 'claimed', 'confirmed')


class Station(models.Model):
    """One post that needs a person standing at it — a door, a room, the information desk.

    A station is **not** a new `EventStaff` role (§1, R1 decision 1): a person is a volunteer,
    and where they stand this afternoon is an assignment. Adding "AV volunteer" and "door
    volunteer" as roles would have made the roster the schedule, and then Tuesday's roster would
    disagree with Wednesday's.

    `session` binds a station to a block on the programme. Shifts created for such a station take
    their hours from the session and **follow it when it moves** (`shifts/signals.py`) — the
    programme is edited far more often than the rota is, and a rota that silently keeps the old
    time is worse than no rota at all.
    """

    event = models.ForeignKey('events.Event', related_name='stations', on_delete=models.CASCADE)
    kind = models.CharField(max_length=10, choices=STATION_KIND_CHOICES, default='other')
    name = models.CharField(max_length=120)
    location_text = models.CharField(max_length=300, blank=True)
    session = models.ForeignKey(
        'events.Session', related_name='stations', null=True, blank=True, on_delete=models.SET_NULL
    )
    briefing_note = models.TextField(blank=True)
    #: Whether a volunteer under 16 (`accounts/minors.py`, NOT the report's 18) may stand here.
    #: Default False: a post nobody has thought about is not a post to put a child on.
    minors_permitted = models.BooleanField(default=False)
    #: A minor here needs a committed adult on the same shift. Not a refusal — the claim lands as
    #: `claimed` and waits for one (`shifts/rules.py`).
    requires_adult = models.BooleanField(default=False)
    #: Claims here wait for an organiser rather than confirming themselves.
    needs_confirmation = models.BooleanField(default=False)
    order = models.PositiveSmallIntegerField(default=0)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ['order', 'id']

    def __str__(self) -> str:
        return f'{self.name} — {self.event.title}'

    def clean(self):
        if self.session_id is not None and self.session.event_id != self.event_id:
            raise ValidationError({'session': 'That session belongs to a different event.'})
        if self.requires_adult and not self.minors_permitted:
            # Not an error the API refuses — it is simply meaningless, and saying so here keeps the
            # organiser from believing they have configured a supervision rule that can never fire.
            raise ValidationError(
                {'requires_adult': 'Adult supervision only means something where minors are permitted.'}
            )


class Shift(models.Model):
    """A window of time at one station, wanting `needed` people in it.

    `needed` is one number, not the report's min/target/max triple. Three numbers require an
    organiser to have an opinion about all three before the first shift exists, and every screen
    then has to explain which of them it is showing; one number answers the only question a
    coverage grid asks ("is this short?") and the amber/green/red the grid draws is derived from
    it rather than from a second field that can contradict it.
    """

    station = models.ForeignKey(Station, related_name='shifts', on_delete=models.CASCADE)
    starts_at = models.DateTimeField()
    ends_at = models.DateTimeField()
    needed = models.PositiveSmallIntegerField(default=1)
    note = models.CharField(max_length=200, blank=True)
    #: Set when the shift was created from the station's session and has no hours of its own.
    #: `shifts/signals.py` moves exactly these when the session moves; a shift somebody gave its
    #: own hours to is left alone, because splitting a two-hour session into two one-hour shifts is
    #: a deliberate act that a programme edit has no business undoing.
    follows_session = models.BooleanField(default=False)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ['starts_at', 'id']
        indexes = [models.Index(fields=['station', 'starts_at'])]

    def __str__(self) -> str:
        return f'{self.station.name} {self.starts_at:%Y-%m-%d %H:%M}'

    def clean(self):
        if self.starts_at and self.ends_at and self.ends_at <= self.starts_at:
            raise ValidationError({'ends_at': 'A shift has to end after it starts.'})

    def save(self, *args, **kwargs):
        if self.follows_session and self.station_id and self.station.session_id:
            session = self.station.session
            self.starts_at = session.starts_at
            self.ends_at = session.ends_at
        super().save(*args, **kwargs)

    @property
    def duration(self) -> timedelta:
        return self.ends_at - self.starts_at

    @property
    def hours(self) -> Decimal:
        """Rounded to two places, because it is what a certificate prints."""
        return (Decimal(self.duration.total_seconds()) / Decimal(3600)).quantize(Decimal('0.01'))


class Assignment(models.Model):
    """One person on one shift, and what became of it.

    **One `status`, never two booleans** (root `CLAUDE.md`): "dropped" and "done" and "no_show" are
    three different ends and a pair of flags would make "dropped but done" representable.

    The unique constraint is **partial**, excluding `dropped` — the `ExerciseTranslation` lesson.
    A plain `unique_together` would mean that dropping a shift and picking it up again later is
    permanently refused, because the tombstone of the first attempt is still sitting there; a
    partial constraint keeps the tombstone (house rule 12) and still lets somebody change their
    mind.
    """

    shift = models.ForeignKey(Shift, related_name='assignments', on_delete=models.CASCADE)
    user = models.ForeignKey(
        settings.AUTH_USER_MODEL, related_name='shift_assignments', on_delete=models.CASCADE
    )
    status = models.CharField(max_length=10, choices=ASSIGNMENT_STATUS_CHOICES, default='claimed')
    source = models.CharField(max_length=10, choices=ASSIGNMENT_SOURCE_CHOICES, default='self')
    claimed_at = models.DateTimeField(auto_now_add=True)
    confirmed_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        related_name='shift_assignments_confirmed',
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
    )
    confirmed_at = models.DateTimeField(null=True, blank=True)
    dropped_at = models.DateTimeField(null=True, blank=True)
    drop_reason = models.CharField(max_length=200, blank=True)
    #: `None` means "the shift's own length" — the derived answer. A number here is the organiser
    #: overriding it, and `credit_note` is mandatory once the two differ by more than
    #: `rules.CREDIT_NOTE_THRESHOLD_MINUTES`.
    hours_credited = models.DecimalField(max_digits=5, decimal_places=2, null=True, blank=True)
    credit_note = models.CharField(max_length=300, blank=True)
    credited_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        related_name='shift_assignments_credited',
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
    )
    credited_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        ordering = ['shift__starts_at', 'id']
        constraints = [
            models.UniqueConstraint(
                fields=['shift', 'user'],
                condition=~models.Q(status='dropped'),
                name='unique_live_assignment_per_shift',
            ),
        ]

    def __str__(self) -> str:
        return f'{self.user} — {self.shift} ({self.status})'

    @property
    def credited_hours(self) -> Decimal:
        """What this assignment is worth on a certificate. Derived unless overridden; zero for
        anything that never happened, so a no-show cannot be printed as service."""
        if self.status != 'done':
            return Decimal('0.00')
        if self.hours_credited is not None:
            return self.hours_credited
        return self.shift.hours


class VolunteerRecord(models.Model):
    """The organiser's own note of the paperwork that exists **off** this server.

    R2 §4 lists six compliance artefacts and wants scans of two of them. We store **fields, never
    files** (§1, §6 rule 5): a guardian's signed consent form and a criminal-record certificate are
    exactly the documents a community exercise database has no business holding, and a row saying
    "recorded on 12 May by Anna K." carries the fact an inspector asks about without the document
    that makes this server worth attacking.

    `consent_recorded_at` is load-bearing rather than informational: a volunteer whose profile says
    `is_minor` cannot claim anything until it is set (`shifts/rules.py`).
    """

    event = models.ForeignKey('events.Event', related_name='volunteer_records', on_delete=models.CASCADE)
    user = models.ForeignKey(
        settings.AUTH_USER_MODEL, related_name='volunteer_records', on_delete=models.CASCADE
    )
    consent_recorded_at = models.DateTimeField(null=True, blank=True)
    consent_recorded_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        related_name='volunteer_consents_recorded',
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
    )
    consent_note = models.CharField(max_length=300, blank=True)
    vetting_checked_at = models.DateTimeField(null=True, blank=True)
    vetting_reference = models.CharField(max_length=120, blank=True)
    emergency_contact_note = models.CharField(max_length=300, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ['id']
        constraints = [
            models.UniqueConstraint(fields=['event', 'user'], name='unique_volunteer_record_per_event'),
        ]

    def __str__(self) -> str:
        return f'{self.user} — {self.event.title}'
