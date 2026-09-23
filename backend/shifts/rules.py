"""Every rule the rota has, in one module, because more than one endpoint needs each of them.

`claim` asks it, `assign` asks it, the station list asks it so a disabled button can say *why*
(house rule 6), and the coverage grid asks it for its colours. An endpoint that re-derived any of
this is how two surfaces start disagreeing about whether a fifteen-year-old may stand at the door.

**The constants are constants.** R2 infers them from the Labour Code's juvenile-employment limits
applied by analogy — an inference, not a statute about volunteers, and its citations are
unverified (`CONFERENCE-BRIEF.md` §1). So they are adopted as defaults an organiser **cannot
loosen** rather than as configuration: a number a form can raise is a number somebody raises at
23:40 on the second evening. The one number we do not take from the report is the minor line
itself — EdMat's is **under 16** (`accounts/minors.py`, GDPR Art. 8 as transposed), not 18, and
the rota reads `Profile.is_minor` rather than computing an age of its own.

The 14-hour daily-rest rule from R2 §2 is deliberately **not** implemented: it is the one limit
that would refuse a volunteer who helped pack down at 18:00 the shift that starts at 07:00 the
next morning, which is the ordinary shape of a two-day conference, and the report itself calls
the analogy unsettled. The daily cap and the night window already carry the substance. Said here
rather than left as a silence (house rule 14).
"""

from datetime import datetime, time, timedelta
from decimal import Decimal

from django.db.models import Q
from django.utils import timezone

from accounts.minors import is_minor

from .models import COMMITTED_STATUSES, HOLDING_STATUSES, Assignment, Shift, VolunteerRecord

#: The night a minor may not be rostered into, in `settings.TIME_ZONE` (there is no per-account
#: timezone in this project — a known gap, named in the root CLAUDE.md).
NIGHT_START = time(22, 0)
NIGHT_END = time(6, 0)

#: Hours a minor may be committed to across one calendar day.
MINOR_DAILY_CAP_HOURS = Decimal('7')

#: Breathing room between two of one person's shifts — the room is at the other end of the
#: building and a rota that assumes teleportation produces a late handover, not a saved minute.
MIN_GAP = timedelta(minutes=15)

#: How close to a shift a volunteer may still drop it themselves. An organiser may always drop
#: anyone: after the cutoff the vacancy needs a person deciding, not a rule.
DROP_CUTOFF = timedelta(hours=4)

#: How far a credited-hours override may sit from the shift's own length before the organiser has
#: to say why (R2 §3's "mandatory audit note for deviations over 30 minutes").
CREDIT_NOTE_THRESHOLD = timedelta(minutes=30)

#: Reasons that stop a claim outright.
HARD_REASONS = (
    'sign_in',
    'event_over',
    'not_volunteer',
    'minor_no_consent',
    'already_assigned',
    'shift_full',
    'overlap',
    'too_close',
    'minor_station',
    'minor_night',
    'minor_daily_cap',
)

#: Reasons that shape the claim instead of refusing it. `needs_adult` means the volunteer is on
#: the shift but the shift is not yet legal to run — the organiser sees it as short an adult;
#: `needs_confirmation` means the station's own claims wait for a person. Both land the assignment
#: as `claimed` rather than `confirmed`, which is exactly what the coverage grid draws amber.
SOFT_REASONS = ('needs_adult', 'needs_confirmation')


def _staff_role(event, user) -> str | None:
    return event.role_of(user)


def is_volunteer(event, user) -> bool:
    """Who may claim for themselves: somebody the organiser put on staff as a volunteer.

    An organiser may *assign* anybody on staff (`assign_block_reason`), including a reviewer they
    have talked into running the door for an hour — but self-service claiming stays with the role
    that was created for it, so "who is on the rota" never drifts away from "who agreed to be".
    """
    return _staff_role(event, user) == 'volunteer'


def _committed_assignments(user, event=None):
    qs = Assignment.objects.filter(user=user, status__in=COMMITTED_STATUSES).select_related('shift')
    if event is not None:
        qs = qs.filter(shift__station__event=event)
    return qs


def touches_night(starts_at, ends_at) -> bool:
    """Does [starts_at, ends_at) overlap 22:00–06:00 on any day it spans?

    Walked day by day in local time rather than compared hour-to-hour, because a shift may start
    before midnight and end after it, and "start hour ≥ 22 or end hour ≤ 6" answers that case
    wrongly in both directions.
    """
    start = timezone.localtime(starts_at)
    end = timezone.localtime(ends_at)
    day = start.date()
    last = end.date()
    while day <= last:
        night_from = timezone.make_aware(
            datetime.combine(day, NIGHT_START), timezone.get_default_timezone()
        )
        night_to = timezone.make_aware(
            datetime.combine(day + timedelta(days=1), NIGHT_END),
            timezone.get_default_timezone(),
        )
        if starts_at < night_to and night_from < ends_at:
            return True
        # The other half of the same night: midnight to 06:00 of this day belongs to the previous
        # night, and a 05:00–08:00 breakfast-desk shift is caught here and nowhere else.
        early_from = timezone.make_aware(
            datetime.combine(day, time(0, 0)), timezone.get_default_timezone()
        )
        early_to = timezone.make_aware(
            datetime.combine(day, NIGHT_END), timezone.get_default_timezone()
        )
        if starts_at < early_to and early_from < ends_at:
            return True
        day += timedelta(days=1)
    return False


def _hours_on_day(user, day, *, excluding=None) -> Decimal:
    """Committed hours a person already holds on one local calendar day.

    Counted over the *overlap* with the day rather than the whole shift, so one shift crossing
    midnight does not spend its full length out of both days' budgets.
    """
    day_start = timezone.make_aware(
        datetime.combine(day, time(0, 0)), timezone.get_default_timezone()
    )
    day_end = day_start + timedelta(days=1)
    total = Decimal('0')
    for assignment in _committed_assignments(user).filter(
        shift__starts_at__lt=day_end, shift__ends_at__gt=day_start
    ):
        if excluding is not None and assignment.pk == excluding:
            continue
        start = max(assignment.shift.starts_at, day_start)
        end = min(assignment.shift.ends_at, day_end)
        total += Decimal((end - start).total_seconds()) / Decimal(3600)
    return total


def _shift_hours_on_day(shift, day) -> Decimal:
    day_start = timezone.make_aware(
        datetime.combine(day, time(0, 0)), timezone.get_default_timezone()
    )
    day_end = day_start + timedelta(days=1)
    start = max(shift.starts_at, day_start)
    end = min(shift.ends_at, day_end)
    if end <= start:
        return Decimal('0')
    return Decimal((end - start).total_seconds()) / Decimal(3600)


def held_count(shift) -> int:
    return shift.assignments.filter(status__in=HOLDING_STATUSES).count()


def has_committed_adult(shift, *, excluding_user=None) -> bool:
    for assignment in shift.assignments.filter(status__in=COMMITTED_STATUSES).select_related(
        'user', 'user__profile'
    ):
        if excluding_user is not None and assignment.user_id == excluding_user.pk:
            continue
        if not is_minor(assignment.user):
            return True
    return False


def has_consent(event, user) -> bool:
    return VolunteerRecord.objects.filter(
        event=event, user=user, consent_recorded_at__isnull=False
    ).exists()


def claim_block_reason(user, shift, *, by_organiser=False):
    """Why this person cannot take this shift — or a **soft** reason, or `None`.

    Returns one string, in a deliberate order: the hard refusals first, most fundamental first, so
    that a fifteen-year-old with no consent on file is told about the consent rather than about the
    shift being full. The two soft reasons come last, because a soft reason is not a refusal and
    must never hide a real one.

    `by_organiser=True` skips the "you are not a volunteer" check only — an organiser may put a
    reviewer on the door, but not a minor on a station that forbids minors, and not anybody into
    two places at once.
    """
    if not (user and getattr(user, 'is_authenticated', False)):
        return 'sign_in'
    station = shift.station
    event = station.event
    if event.is_past:
        return 'event_over'
    if not by_organiser and not is_volunteer(event, user):
        return 'not_volunteer'
    if by_organiser and _staff_role(event, user) is None:
        # An organiser assigning somebody who is not on the event's staff at all.
        return 'not_volunteer'
    minor = is_minor(user)
    if minor and not has_consent(event, user):
        return 'minor_no_consent'
    if shift.assignments.filter(user=user).exclude(status='dropped').exists():
        return 'already_assigned'
    if held_count(shift) >= shift.needed:
        return 'shift_full'

    others = list(_committed_assignments(user).exclude(shift=shift))
    for assignment in others:
        other = assignment.shift
        if other.starts_at < shift.ends_at and shift.starts_at < other.ends_at:
            return 'overlap'
    for assignment in others:
        other = assignment.shift
        if other.ends_at <= shift.starts_at and shift.starts_at - other.ends_at < MIN_GAP:
            return 'too_close'
        if shift.ends_at <= other.starts_at and other.starts_at - shift.ends_at < MIN_GAP:
            return 'too_close'

    if minor:
        if not station.minors_permitted:
            return 'minor_station'
        if touches_night(shift.starts_at, shift.ends_at):
            return 'minor_night'
        day = timezone.localtime(shift.starts_at).date()
        last = timezone.localtime(shift.ends_at).date()
        while day <= last:
            if _hours_on_day(user, day) + _shift_hours_on_day(shift, day) > MINOR_DAILY_CAP_HOURS:
                return 'minor_daily_cap'
            day += timedelta(days=1)

    if station.requires_adult and minor and not has_committed_adult(shift, excluding_user=user):
        return 'needs_adult'
    if station.needs_confirmation:
        return 'needs_confirmation'
    return None


def status_for_claim(reason) -> str:
    """What an accepted claim becomes. A soft reason means it waits; nothing means it stands."""
    return 'claimed' if reason in SOFT_REASONS else 'confirmed'


def drop_block_reason(user, assignment, *, as_organiser=False):
    """Why this assignment cannot be dropped — `not_yours`, `not_active`, `cutoff`, or `None`.

    The cutoff is the report's decision 2 (drop-to-pool rather than mandatory bilateral swaps)
    with its own teeth: four hours out, the vacancy is still something the board can fill by
    itself; inside four hours it needs a person who knows the building, so it goes to the
    organiser — who is never blocked by the cutoff, because somebody has to be able to act.
    """
    if not (user and getattr(user, 'is_authenticated', False)):
        return 'sign_in'
    if not as_organiser and assignment.user_id != user.pk:
        return 'not_yours'
    if assignment.status not in ('offered', 'claimed', 'confirmed'):
        return 'not_active'
    if as_organiser:
        return None
    if assignment.shift.starts_at - timezone.now() < DROP_CUTOFF:
        return 'cutoff'
    return None


def assign_block_reason(organiser, shift, target):
    """An organiser putting somebody else on a shift. Same invariants, one exemption (the target
    need not hold the `volunteer` role), and the organiser's own authority checked first."""
    event = shift.station.event
    if not event.can_organise(organiser):
        return 'not_organiser'
    return claim_block_reason(target, shift, by_organiser=True)


def coverage(event):
    """Per-shift `needed` / `confirmed` / `claimed` / `is_short`, as `COUNT`s (house rule 5).

    Two aggregates over one indexed FK, recomputed on every read. A stored `filled` column would
    have to be corrected by every one of claim, drop, assign, confirm, no-show, done and a
    cascading station delete — seven chances to be wrong forever, against one query that cannot
    drift.

    `needs_adult` is reported per shift too, because it is the one deficiency a number cannot
    show: a shift with two of two places filled by two fifteen-year-olds is *full* and still
    cannot run.
    """
    from django.db.models import Count

    shifts = (
        Shift.objects.filter(station__event=event)
        .select_related('station')
        .annotate(
            confirmed_count=Count(
                'assignments',
                filter=Q(assignments__status__in=('confirmed', 'done')),
                distinct=True,
            ),
            claimed_count=Count(
                'assignments', filter=Q(assignments__status='claimed'), distinct=True
            ),
        )
        .order_by('starts_at', 'station__order', 'station_id')
    )
    rows = []
    for shift in shifts:
        needs_adult = bool(
            shift.station.requires_adult
            and shift.assignments.filter(status__in=COMMITTED_STATUSES).exists()
            and not has_committed_adult(shift)
        )
        rows.append(
            {
                'shift': shift,
                'needed': shift.needed,
                'confirmed': shift.confirmed_count,
                'claimed': shift.claimed_count,
                'is_short': shift.confirmed_count < shift.needed,
                'needs_adult': needs_adult,
            }
        )
    return rows


def credit_note_required(shift, hours) -> bool:
    """Does an override this far from the shift's own length need a word of explanation?"""
    if hours is None:
        return False
    difference = abs(Decimal(hours) - shift.hours)
    return difference * Decimal(3600) > Decimal(CREDIT_NOTE_THRESHOLD.total_seconds())


def hours_for(user, event=None) -> Decimal:
    """Credited hours, derived from `done` assignments. The certificate's only number."""
    qs = Assignment.objects.filter(user=user, status='done').select_related('shift')
    if event is not None:
        qs = qs.filter(shift__station__event=event)
    total = Decimal('0.00')
    for assignment in qs:
        total += assignment.credited_hours
    return total.quantize(Decimal('0.01'))


def holds_station_assignment(user, event, kind: str) -> bool:
    """Is this person **confirmed** (or already done) on a shift at a station of `kind` for this
    event, regardless of whether that shift is happening right now?

    Written for step F (the cloakroom desk): at integration, "who may operate the desk" becomes
    `holds_station_assignment(user, event, 'cloakroom')` when the event has a cloakroom station,
    and plain staff membership when it does not — so an event that bothered to roster its desk gets
    the narrower rule for free, and one that did not is not locked out by a rota it never built.
    It is deliberately general rather than a `has_cloakroom_assignment`: the same question is the
    honest check for a door scanner (`kind='door'`) the moment step D wants one.

    **Not narrowed to "on shift right now" on purpose.** A volunteer who arrives ten minutes early,
    or who stays to hand over, is the ordinary case; a desk that locks them out on the minute would
    be a rule the building disagrees with. Membership of the rota is the permission; the rota
    itself is what says when they should be there.
    """
    if not (user and getattr(user, 'is_authenticated', False)):
        return False
    return Assignment.objects.filter(
        user=user,
        status__in=('confirmed', 'done'),
        shift__station__event=event,
        shift__station__kind=kind,
    ).exists()


def event_has_station(event, kind: str) -> bool:
    """Whether the rule above is worth asking at all — see its docstring."""
    from .models import Station

    return Station.objects.filter(event=event, kind=kind).exists()
