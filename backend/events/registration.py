"""The registration engine (AUDIENCE-BRIEF.md §3.3): one row per person per event, its status
moved by exactly these functions, capacity re-checked against the database on every path.

    (none) ──► going ─────────────────────────────► not_going   (seat freed → promote next)
       │         ▲  ▲
       ├──► pending ┘  │  (approval mode: organiser accepts; full → waitlisted)
       └──► waitlisted ┴─► promoted (24h claim) ──► going | expired ──► next in line
    going ◄──► checked_in_at set / cleared   (never touches the seat)
    going ──► waitlisted    (capacity cut below the holders: LIFO demotion, notified)

Promotion expiry is LAZY: there is no scheduler in this project, so `expire_promotions` runs
at the start of every read or write that cares about seats. A window that lapsed is therefore
noticed the next time anybody looks, which for a live event is soon enough and is stated here
rather than pretended to be a clock.
"""

from django.db import transaction
from django.utils import timezone

from notifications.services import notify

from .models import PROMOTION_WINDOW, SEAT_HOLDING_STATUSES, EventAttendance


def _label(event) -> str:
    return event.title


def expire_promotions(event, actor=None):
    """Turn lapsed `promoted` rows into `expired` and pass their seats on."""
    now = timezone.now()
    lapsed = list(event.attendances.filter(status='promoted', promotion_expires_at__lt=now))
    for row in lapsed:
        row.status = 'expired'
        row.promotion_expires_at = None
        row.save(update_fields=['status', 'promotion_expires_at', 'responded_at'])
    if lapsed:
        promote_next(event, actor)


def promote_next(event, actor=None):
    """While seats are free and somebody is waiting, offer the oldest waitlisted row a seat."""
    with transaction.atomic():
        while event.capacity and event.seat_holder_count() < event.capacity:
            candidate = (
                event.attendances.filter(status='waitlisted').order_by('waitlisted_at', 'id').first()
            )
            if candidate is None:
                return
            candidate.status = 'promoted'
            candidate.promotion_expires_at = timezone.now() + PROMOTION_WINDOW
            candidate.save(update_fields=['status', 'promotion_expires_at', 'responded_at'])
            notify(
                candidate.attendee,
                'registration_promoted',
                actor=actor,
                target_label=_label(event),
                event=event,
                note=candidate.promotion_expires_at.isoformat(),
            )


def register(event, user, *, answers=None, note='', registered_by=None, actor=None):
    """Somebody asks to come. What they get depends on the mode and on the seats:
    approval → pending; a full event → waitlisted; a `promoted` row confirming → going;
    otherwise → going. Re-asking from `not_going`/`expired` starts again from the same rules.
    Returns the row and whether the host should be told (a new seat holder only)."""
    expire_promotions(event, actor)
    with transaction.atomic():
        row = event.attendances.select_for_update().filter(attendee=user).first()
        was_holding = bool(row and row.status in SEAT_HOLDING_STATUSES)
        # The host is told of a FIRST seat only: a brand-new row, or one that waited (pending /
        # waitlisted / promoted) and is now seated. Somebody who said no and then yes again is a
        # change of mind, and a change of mind is not news — the host was told the first time.
        first_seat_possible = row is None or row.status in ('pending', 'waitlisted', 'promoted')
        # A brand-new row, or one that said no / let an offer lapse, is asking afresh; a row that
        # is already going, pending or waiting keeps its place and only updates its answers.
        fresh = row is None or row.status in ('not_going', 'expired')
        if row is None:
            row = EventAttendance(event=event, attendee=user, registered_by=registered_by)
        elif registered_by is not None:
            row.registered_by = registered_by
        if answers is not None:
            row.answers = answers
        if note:
            row.note = note
        if row.status == 'promoted':
            row.status = 'going'
            row.promotion_expires_at = None
        elif not fresh:
            pass
        elif event.registration_mode == 'approval':
            row.status = 'pending'
        elif event.is_full:
            row.status = 'waitlisted'
            row.waitlisted_at = timezone.now()
        else:
            row.status = 'going'
        row.save()
    newly_holding = row.status in SEAT_HOLDING_STATUSES and not was_holding and first_seat_possible
    if row.status == 'waitlisted' and not was_holding:
        # `actor=None`: the person did this themselves, and notify() drops a self-actor row — but a
        # line in the bell saying "you are on the waiting list" is worth keeping for later.
        notify(user, 'registration_waitlisted', actor=None, target_label=_label(event), event=event)
    return row, newly_holding


def withdraw(event, user, *, note='', actor=None):
    """"I am not coming" — from any state. A freed seat goes to the next in line."""
    expire_promotions(event, actor)
    with transaction.atomic():
        row = event.attendances.select_for_update().filter(attendee=user).first()
        if row is None:
            row = EventAttendance(event=event, attendee=user)
        held = row.status in SEAT_HOLDING_STATUSES
        row.status = 'not_going'
        row.promotion_expires_at = None
        row.checked_in_at = None
        row.checked_in_by = None
        if note:
            row.note = note
        row.save()
        row.session_registrations.all().delete()
    if held:
        promote_next(event, actor)
    return row


def decide(event, row, accept: bool, actor):
    """An organiser answers a `pending` row: accepted people take a seat, or the waiting list
    when the event is full; declined people are told, and may not simply re-ask (their row
    stays `not_going` with the organiser's decision recorded in `note`)."""
    expire_promotions(event, actor)
    if row.status != 'pending':
        return row, 'not_pending'
    if accept:
        if event.is_full:
            row.status = 'waitlisted'
            row.waitlisted_at = timezone.now()
            kind = 'registration_waitlisted'
        else:
            row.status = 'going'
            kind = 'registration_confirmed'
    else:
        row.status = 'not_going'
        kind = 'registration_declined'
    row.save()
    notify(row.attendee, kind, actor=actor, target_label=_label(event), event=event)
    return row, None


def check_in(row, actor, undo=False):
    if undo:
        row.checked_in_at = None
        row.checked_in_by = None
    else:
        if row.status != 'going':
            return 'not_going'
        row.checked_in_at = timezone.now()
        row.checked_in_by = actor
    row.save(update_fields=['checked_in_at', 'checked_in_by', 'responded_at'])
    return None


def demote_over_capacity(event, actor):
    """Capacity was cut below the seat holders: the most recently seated go back to the waiting
    list, last in first out, and are told why."""
    if not event.capacity:
        return 0
    excess = event.seat_holder_count() - event.capacity
    if excess <= 0:
        return 0
    rows = list(
        event.attendances.filter(status__in=SEAT_HOLDING_STATUSES).order_by('-responded_at', '-id')[:excess]
    )
    for row in rows:
        row.status = 'waitlisted'
        row.waitlisted_at = timezone.now()
        row.promotion_expires_at = None
        row.checked_in_at = None
        row.checked_in_by = None
        row.save()
        row.session_registrations.all().delete()
        notify(row.attendee, 'registration_waitlisted', actor=actor, target_label=_label(event), event=event, note='capacity_reduced')
    return len(rows)


def validate_answers(event, answers) -> dict:
    """Check the organiser's own questions: every required one answered, choices from the list.
    Returns `{field_id: message}` — empty means fine."""
    problems = {}
    answers = answers or {}
    for field in event.registration_fields.all():
        value = answers.get(str(field.pk))
        empty = value in (None, '', [], False) if field.kind != 'checkbox' else value is not True
        if field.required and empty:
            problems[str(field.pk)] = 'required'
            continue
        if value in (None, ''):
            continue
        if field.kind == 'choice' and value not in field.options:
            problems[str(field.pk)] = 'not_an_option'
        if field.kind == 'multi' and (not isinstance(value, list) or any(v not in field.options for v in value)):
            problems[str(field.pk)] = 'not_an_option'
    return problems


def mask_name(display_name: str) -> str:
    """"Anna Kowalska" → "Anna K." for the optional public list."""
    parts = display_name.split()
    if len(parts) < 2:
        return display_name
    return f'{parts[0]} {parts[-1][0]}.'
