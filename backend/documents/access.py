"""Who may see which documents, and who still owes a briefing.

The rule module boundary the root CLAUDE.md asks for: **a rule that more than one endpoint needs
lives in one module, and the endpoints ask it.** Four endpoints in this app ask `visible_tiers_for`,
and `missing_acknowledgements` is asked from `events/registration_views.py` today and, at
integration (CONFERENCE-BRIEF.md §5), from step D's `/scans/` and step F's cloakroom desk. None of
them re-derives a role; all of them go through `Event.role_of` / `can_organise` / `is_staff_member`.
"""

from __future__ import annotations

from django.db.models import Q

from moderation.services import is_feature_enabled

from .models import (
    TIER_ATTENDEES,
    TIER_ORGANISERS,
    TIER_PUBLIC,
    TIER_STAFF,
    TIER_VENUE,
    DocumentAcknowledgement,
    EventDocument,
)

FLAG = 'event_documents'

# `access.venue_admin_check` is the seam step A plugs into. Until `venues` exists, nobody but an
# organiser answers to the `venue` tier — which is a deliberate refusal to guess: a tier that
# defaults OPEN would mean every document filed under it was readable by the wrong people for the
# length of one merge window.
#
# INTEGRATION (CONFERENCE-BRIEF.md §5, first bullet): replace the body with
#     from venues.access import is_venue_admin
#     booking = event.room_bookings.filter(status='approved').first()
#     return bool(booking) and is_venue_admin(user, booking.room.venue)
# and nothing else in this app changes — every caller already goes through here. Kept a plain
# module-level function rather than a settings string so that the wiring is one obvious edit in the
# module that owns the rule, and so a test can monkeypatch it (see `tests.py`) to prove the tier is
# real rather than decorative.
def venue_admin_check(user, event) -> bool:
    return False


def visible_tiers_for(user, event) -> frozenset[str]:
    """The tiers this person may read on this event.

    A ladder, so each answer includes everything under it: an organiser reads the staff notes, a
    volunteer reads what the attendees were sent, and everybody reads the public ones. The one thing
    NOT on the ladder is `venue` — see the module docstring of `models.py`.

    Deliberately says nothing about whether the EVENT itself is visible. That is a queryset filter
    and belongs to whoever resolved the event (house rule 4); this function answers the second,
    object-level half.
    """
    tiers = {TIER_PUBLIC}
    if not (user and getattr(user, 'is_authenticated', False)):
        return frozenset(tiers)
    if event.can_organise(user):
        # An organiser sees everything the event holds, the venue tier included: they are the party
        # the venue is corresponding WITH, so a document addressed to the building is addressed to
        # them too.
        return frozenset({TIER_PUBLIC, TIER_ATTENDEES, TIER_STAFF, TIER_ORGANISERS, TIER_VENUE})
    if event.is_staff_member(user):
        tiers |= {TIER_ATTENDEES, TIER_STAFF}
    elif _holds_a_seat(user, event):
        tiers.add(TIER_ATTENDEES)
    if venue_admin_check(user, event):
        tiers.add(TIER_VENUE)
    return frozenset(tiers)


def _holds_a_seat(user, event) -> bool:
    # `going` and `promoted` both — somebody holding a 24-hour seat offer is as much an attendee as
    # somebody who has confirmed, and the joining instructions are exactly what they need to decide.
    # Imported here rather than at module level so this app keeps its one-way dependency on `events`
    # to a single name.
    from events.models import SEAT_HOLDING_STATUSES

    return event.attendances.filter(attendee=user, status__in=SEAT_HOLDING_STATUSES).exists()


def visible_documents(user, event):
    """The queryset half (house rule 4): every current document of this event in a tier this person
    has. Superseded and withdrawn rows are out — they are history, reachable only through the
    organiser's own read-receipt view."""
    return (
        event.documents.filter(
            visibility__in=visible_tiers_for(user, event),
            replaced_by__isnull=True,
            removed_at__isnull=True,
        )
        .select_related('uploaded_by', 'uploaded_by__profile')
        .prefetch_related('acknowledgements')
    )


def can_read_document(user, document) -> bool:
    """The object-level half, for anything addressed by id — a filter never runs for those."""
    return document.visibility in visible_tiers_for(user, document.event)


def can_manage_documents(user, event) -> bool:
    """Uploading, replacing, retiring, and reading the receipts. Organisers only: a volunteer who
    could publish a mandatory briefing could lock every other volunteer out of the door."""
    return event.can_organise(user)


def missing_acknowledgements(user, event) -> list[EventDocument]:
    """The mandatory documents this person has not acknowledged AT THEIR CURRENT VERSION.

    Empty for anonymous callers (nothing to owe), and empty while the `event_documents` flag is off
    — house rule 3 cuts both ways: a killed feature must not keep imposing its rule on a neighbouring
    surface that is still meant to work. Read with the plain `is_feature_enabled()` rather than
    `feature_gate`, for the same reason `age_verification` is: this flag governs a RULE applied to
    somebody else's endpoint, not a surface of its own, and a `is_staff` bypass would mean a
    platform moderator silently got a different answer from the one the volunteer beside them got.
    """
    if not (user and getattr(user, 'is_authenticated', False)):
        return []
    if not is_feature_enabled(FLAG):
        return []
    tiers = visible_tiers_for(user, event)
    documents = list(
        event.documents.filter(
            requires_acknowledgement=True,
            replaced_by__isnull=True,
            removed_at__isnull=True,
            visibility__in=tiers,
        ).order_by('title', 'id')
    )
    if not documents:
        return []
    acknowledged = set(
        DocumentAcknowledgement.objects.filter(
            user=user, document__in=documents
        ).values_list('document_id', 'version')
    )
    return [d for d in documents if (d.pk, d.version) not in acknowledged]


def briefing_block_reason(event, user) -> dict | None:
    """The refusal body a day-of tool returns, or `None` when there is nothing owed.

    A reason, not a boolean (house rule 6) — and it carries the document ids, because "you have not
    read the briefing" is only actionable if the person is told WHICH one and can open it there and
    then. `events/registration_views.py` returns this verbatim with a 409; steps D and F will do the
    same. 409 rather than 403: nothing is wrong with the request or with who is making it, the world
    is simply not yet in the state the action needs.
    """
    missing = missing_acknowledgements(user, event)
    if not missing:
        return None
    return {
        'detail': 'briefing_unread',
        'documents': [d.pk for d in missing],
        'titles': [d.title for d in missing],
    }


def visible_events(user):
    """The events this person may see at all.

    A deliberate MIRROR of `EventViewSet._visible_to` (events/views.py), not an import: that rule
    lives in a viewset method, and reaching into a viewset from another app to borrow one line is
    worse coupling than restating four filters that are already spelled by the same two constants.
    Named here as the drift risk it is (house rule 13) — if the events visibility rule changes, this
    changes with it. The alternative, extracting a function in `events`, was rejected only because
    §4 rule 1 holds `events` to one guard this cycle; the integrator may well do it.
    """
    from events.models import PUBLIC_STATUSES, PUBLIC_VISIBILITY, Event

    qs = Event.objects.all()
    visible = qs.filter(status__in=PUBLIC_STATUSES, visibility__in=PUBLIC_VISIBILITY)
    if getattr(user, 'is_authenticated', False):
        visible = visible | qs.filter(Q(host=user) | Q(staff__user=user))
    return visible.distinct()
