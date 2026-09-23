"""The rules more than one endpoint needs, in one module the endpoints ask (root `CLAUDE.md`,
boundary 2).

Four questions live here, and nothing outside this file answers any of them:

- **Who runs this building?** `is_venue_admin`, `is_venue_staff`, `can_manage_room`.
- **May this event have this room, at this hour, for this many people?** `booking_block_reason`,
  which returns a WORD, not a boolean (house rule 6) — "the room is taken" and "you are bringing
  more people than the fire instruction allows" are the same refusal to a boolean and completely
  different things to do about.
- **May this event be published?** `publish_block_reason`, called from `events/views.py`'s own
  update path. This is the one place `events` depends on `venues`, and it depends on this function
  only.

`publish_block_reason` returning `None` while the `venues` kill switch is off is deliberate and is
house rule 3 read the strict way: with the feature off the checklist surface is gone from the API
and from the page, so a checklist nobody can see or tick must not be able to stop an event being
announced. A killed feature removes itself; it does not leave a lock behind.
"""

from django.db.models import Q

from moderation.services import is_feature_enabled

from .models import (
    OCCUPYING_STATUSES,
    SETTLED_ITEM_STATUSES,
    VENUE_ADMIN_ROLES,
    ChecklistInstanceItem,
    RoomBooking,
    VenueStaff,
)

#: The flag this whole app hides behind. Named once so a check can never be spelled differently in
#: two files.
FEATURE_KEY = 'venues'


def _authenticated(user) -> bool:
    return bool(user and getattr(user, 'is_authenticated', False))


def is_venue_admin(user, venue) -> bool:
    """Platform staff count, because that is how the first administrator of any building is granted
    (CONFERENCE-BRIEF.md §6.4 — no self-service "claim this building"). After that the building's
    own administrator adds the next one and platform staff never has to be involved again.
    """
    if not _authenticated(user) or venue is None:
        return False
    if getattr(user, 'is_staff', False):
        return True
    return VenueStaff.objects.filter(
        venue=venue, user=user, role__in=VENUE_ADMIN_ROLES
    ).exists()


def is_venue_staff(user, venue) -> bool:
    """Administrator *or* porter — the people who may see a building's bookings and checklists.

    A porter sees; an administrator decides. Kept as its own question rather than
    `is_venue_admin(...) or role == 'porter'` at four call sites, because "who may look" and "who
    may act" drifting apart is exactly the leak house rule 4 is about.
    """
    if not _authenticated(user) or venue is None:
        return False
    if getattr(user, 'is_staff', False):
        return True
    return VenueStaff.objects.filter(venue=venue, user=user).exists()


def venues_administered_by(user):
    """Every venue this person administers, as a queryset of ids — what the booking queue and the
    "Venues" menu entry are scoped by."""
    if not _authenticated(user):
        return VenueStaff.objects.none().values_list('venue_id', flat=True)
    return VenueStaff.objects.filter(user=user).values_list('venue_id', flat=True)


def can_manage_room(user, room) -> bool:
    """Editing a room is editing the building's own description of itself."""
    return room is not None and is_venue_admin(user, room.venue)


def booking_block_reason(event, room, starts_at, ends_at, headcount, *, exclude_pk=None):
    """Why this booking may not be made — or `None`.

    The words, and what each means to the person reading it:

    - ``bad_times`` — the end is not after the start. A malformed request (400).
    - ``room_closed`` — the room or the whole building is marked inactive (409: the world moved).
    - ``over_fire_capacity`` — more people than the fire safety instruction permits in that room.
      A 400, not a 409: nothing moved, the request was wrong when it was written, and the fix is to
      ask for a different room or bring fewer people.
    - ``room_busy`` — an **approved** booking already overlaps. A 409, because this is precisely the
      world having moved: the request was fine when the organiser opened the form.

    `exclude_pk` is for re-deciding a booking that already exists — an approval must not find itself
    busy against its own row.

    Overlap is half-open: a booking ending at 12:00 does not collide with one starting at 12:00.
    Rooms are handed over between groups all day and treating the boundary as a collision would
    refuse every back-to-back lecture in the timetable.
    """
    if starts_at is None or ends_at is None or ends_at <= starts_at:
        return 'bad_times'
    if room is None or not room.is_active or not room.venue.is_active:
        return 'room_closed'
    if room.fire_capacity and (headcount or 0) > room.fire_capacity:
        return 'over_fire_capacity'

    clashes = RoomBooking.objects.filter(
        room=room, status__in=OCCUPYING_STATUSES
    ).filter(starts_at__lt=ends_at, ends_at__gt=starts_at)
    if exclude_pk is not None:
        clashes = clashes.exclude(pk=exclude_pk)
    if clashes.exists():
        return 'room_busy'
    return None


def publish_block_reason(event):
    """Why this event may not leave `draft` — or `None`.

    One rule, and only one: an event that has been **given a room** carries the building's
    conditions with it, so it cannot be announced while a mandatory line of that building's
    checklist has not been started. `in_progress` does not block (`SETTLED_ITEM_STATUSES`) —
    somebody is on it, and this is a gate on whether the work has been *acknowledged*, not on how
    far along it is the minute Publish is pressed.

    Returns ``'checklist_pending'``. A word, so `events/views.py` can hand it straight back and the
    frontend has a line for it.

    Deliberately silent when:

    - the `venues` flag is off (see the module docstring);
    - the event has no approved booking — an event with no venue publishes exactly as it did before
      this app existed, which is the compatibility half of house rule 3;
    - the event has an approved booking but no checklist instance for that venue — a building that
      hands out no list blocks nothing.
    """
    if event is None or not is_feature_enabled(FEATURE_KEY):
        return None

    venue_ids = set(
        RoomBooking.objects.filter(event=event, status__in=OCCUPYING_STATUSES).values_list(
            'room__venue_id', flat=True
        )
    )
    if not venue_ids:
        return None

    blocking = ChecklistInstanceItem.objects.filter(
        instance__event=event,
        instance__venue_id__in=venue_ids,
        is_mandatory=True,
    ).exclude(status__in=SETTLED_ITEM_STATUSES)
    if blocking.exists():
        return 'checklist_pending'
    return None


def item_change_block_reason(user, item, *, wanted_status=None, na_reason=None):
    """Why this person may not put this checklist item into this state — or `None`.

    - ``not_allowed`` — neither an organiser of the event nor staff of the building.
    - ``na_not_allowed`` — the building did not mark this line as one that may be waved away.
    - ``na_reason_required`` — it may, but not silently.
    - ``needs_venue_signoff`` — only a **venue administrator** ticks a line the building signs off.
      The organiser may take it to `in_progress` and no further; this is the whole point of the flag
      (the keys really were handed back, and the building says so, not the person who wanted to go
      home).
    """
    event = item.instance.event
    venue = item.instance.venue
    is_organiser = event.can_organise(user)
    admin = is_venue_admin(user, venue)
    if not (is_organiser or is_venue_staff(user, venue)):
        return 'not_allowed'

    if wanted_status == 'not_applicable':
        if not item.na_allowed:
            return 'na_not_allowed'
        if not (na_reason if na_reason is not None else item.na_reason or '').strip():
            return 'na_reason_required'
    if wanted_status == 'done' and item.requires_venue_signoff and not admin:
        return 'needs_venue_signoff'
    if wanted_status is not None and not (is_organiser or admin):
        # A porter reads; they do not tick.
        return 'not_allowed'
    return None


def visible_venues(qs, user):
    """A queryset filter, not a permission check (house rule 4). An inactive building is visible to
    the people who run it and to platform staff, and to nobody else — so a venue that stops hosting
    leaves `/venues/` without breaking its own page for its own administrators."""
    if _authenticated(user) and getattr(user, 'is_staff', False):
        return qs
    if not _authenticated(user):
        return qs.filter(is_active=True)
    return qs.filter(Q(is_active=True) | Q(staff__user=user)).distinct()
