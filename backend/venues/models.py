"""A building, its rooms, the people who run it, and the paperwork it hands an organiser.

**Why this is its own app and not fields on `events.Event`.** A venue outlives every event held in
it, has its own administrators who are not anybody's event staff, and says "no" to bookings for
reasons that have nothing to do with the event asking (the room is taken, the fire capacity is
lower than the headcount, the building is closed). Putting a `venue` FK and a `room` FK on `Event`
would model the one case a lecture theatre is used once, and nothing about the case it is used
forty times a term by forty different organisers.

**The event ↔ venue link IS the booking** (`RoomBooking`), which is what lets `events` keep an
untouched schema (CONFERENCE-BRIEF.md §4 rule 1). An event with no booking has no venue; an event
with a `requested` booking has asked; an event with an `approved` one has a room. Three states
already carried by one `status` field, rather than a nullable FK plus a boolean, for the reason the
root `CLAUDE.md` gives: two fields make "has a room but was never approved" representable.

**A checklist instance is a snapshot, not a view of a template.** `ChecklistTemplate` is edited by
the building over years; the copy an organiser is working through must not change under them the
week of their conference. So `ChecklistInstanceItem` carries the item's own text, not a FK to the
template item — a template edit bumps `ChecklistTemplate.version` and is *offered* to open instances
(`/api/checklist-instances/{id}/sync/`), never applied to them.
"""

import os
import uuid

from django.conf import settings
from django.core.exceptions import ValidationError
from django.db import models
from django.utils import timezone

from materials.validators import validate_material_submission_file

# Who a person is inside a building. Two values, deliberately not three: an `administrator` does
# everything (adds staff, edits rooms and templates, decides bookings, signs a checklist item off),
# and a `porter` is the person on the desk — they SEE the building's bookings and checklists and
# nothing else. There is no read-only "viewer" tier because a venue's own list of rooms is public
# anyway, so a role that could only read would grant nothing a stranger does not already have.
VENUE_ROLE_CHOICES = [
    ('administrator', 'Administrator'),
    ('porter', 'Porter'),
]
#: The one role that may decide a booking, edit a room or sign a checklist item off. One frozenset
#: so "what may an administrator do" can never drift between `access.py` and a serializer.
VENUE_ADMIN_ROLES = frozenset({'administrator'})

# A request for a room, and what happened to it. `rejected` and `cancelled` are kept rather than
# deleted (house rule 12): an organiser who was told no needs to be able to see that they were told
# no, and by whom, rather than watching their request disappear.
BOOKING_STATUS_CHOICES = [
    ('requested', 'Requested'),
    ('approved', 'Approved'),
    ('rejected', 'Rejected'),
    ('cancelled', 'Withdrawn by the organiser'),
]
#: The one status that occupies a room. Two `approved` bookings on one room may not overlap; a
#: `requested` one may overlap anything, because asking is free and the building decides.
OCCUPYING_STATUSES = frozenset({'approved'})

# Who is expected to do a checklist item. Not a permission — a `venue` item is still ticked through
# the same endpoint — but the honest answer to "whose job is this?", which is the question an
# organiser reading a four-page list from the building actually has.
ITEM_OWNER_CHOICES = [
    ('organiser', 'The organiser'),
    ('venue', 'The building'),
]

# What the offset is measured from. A signed offset alone cannot express "two hours after the doors
# close" on a two-day conference, because the negative-is-before convention silently measures both
# ends from the start; `anchor` is what makes "T + 1 day" mean the day after the conference ends.
ANCHOR_CHOICES = [
    ('start', 'Before/after the event starts'),
    ('end', 'Before/after the event ends'),
]

# What "done" has to be accompanied by. `none` is the common case; the others exist because a
# building that asks for a vehicle registration number or a signed handover protocol wants the thing
# itself, not a tick.
EVIDENCE_KIND_CHOICES = [
    ('none', 'Nothing — a tick is enough'),
    ('text', 'A short note'),
    ('link', 'A link'),
    ('file', 'A file'),
]

# One `status` field, never two booleans (root CLAUDE.md, shape 4). `not_applicable` is a real,
# separate outcome from `done`: "there is no catering" is not the same statement as "the catering
# was notified", and a building reading the list later needs to be able to tell them apart.
ITEM_STATUS_CHOICES = [
    ('pending', 'Not started'),
    ('in_progress', 'Being done'),
    ('done', 'Done'),
    ('not_applicable', 'Does not apply'),
]
#: The statuses a mandatory item may be in without blocking publication. `in_progress` is
#: deliberately here: somebody is on it, and a checklist is a list of what must happen before the
#: doors open, not a gate on how far along the organiser is the moment they press Publish.
SETTLED_ITEM_STATUSES = frozenset({'in_progress', 'done', 'not_applicable'})


def evidence_upload_path(instance, filename: str) -> str:
    """Random name, extension kept — the uploader's own filename is untrusted input (house rule 7,
    and the same shape `coauthoring.version_upload_path` states in full)."""
    ext = os.path.splitext(filename)[1].lower()
    return f'checklist_evidence/{uuid.uuid4().hex}{ext}'


class Venue(models.Model):
    """A building. Public by construction — a lecture theatre's address and seat count is not a
    secret, and the whole point of `/venues/` is that an organiser can find out where they could
    hold something before asking anybody.

    `is_active` rather than a delete: a building that stops hosting still has to resolve for every
    past event that names it, and its checklist templates are what the next building's are copied
    from.
    """

    name = models.CharField(max_length=200)
    # The id every public URL uses, like Discipline and Branch (root CLAUDE.md, "Ids"). A building
    # is read about far more often than it is written to, and `/venues/wydzial-fizyki/` is a link
    # somebody can send.
    slug = models.SlugField(max_length=80, unique=True)
    address = models.CharField(max_length=300, blank=True)
    # Free text on purpose: "ask at the porter's lodge, ground floor, before 20:00" is the real
    # answer, and no structured contact form expresses it.
    contact_note = models.TextField(blank=True)
    # Deliberately its own field rather than part of `contact_note`: this is the number somebody
    # looks for while something is going wrong, and it must be findable without reading a paragraph.
    security_phone = models.CharField(max_length=40, blank=True)
    is_active = models.BooleanField(default=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ['name']

    def __str__(self) -> str:
        return self.name


class VenueStaff(models.Model):
    """One person's standing inside one building.

    No self-service "claim this building" (CONFERENCE-BRIEF.md §6.4): the first administrator is
    granted by a platform staff member, and that administrator adds the next. `added_by` is kept so
    the chain is readable — a building whose administrator list nobody can account for is how a
    stranger ends up approving bookings.
    """

    venue = models.ForeignKey(Venue, related_name='staff', on_delete=models.CASCADE)
    user = models.ForeignKey(
        settings.AUTH_USER_MODEL, related_name='venue_roles', on_delete=models.CASCADE
    )
    role = models.CharField(max_length=14, choices=VENUE_ROLE_CHOICES, default='administrator')
    added_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        related_name='venue_staff_added',
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
    )
    added_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ['added_at', 'id']
        constraints = [
            models.UniqueConstraint(fields=['venue', 'user'], name='unique_staff_per_venue'),
        ]

    def __str__(self) -> str:
        return f'{self.user} — {self.role} of {self.venue}'


class Room(models.Model):
    """A room in a building, with the two capacities that are genuinely different numbers.

    `seated_capacity` is how many chairs there are; `fire_capacity` is how many people the fire
    safety instruction lets into the room at once (standing included). They are not the same number
    and confusing them is how a workshop with 40 chairs gets 120 people into a room rated for 90.
    `clean()` refuses `seated > fire`, because more chairs than the building permits people is not a
    room, it is a typo.
    """

    venue = models.ForeignKey(Venue, related_name='rooms', on_delete=models.CASCADE)
    name = models.CharField(max_length=120)
    number = models.CharField(max_length=40, blank=True)
    floor = models.CharField(max_length=40, blank=True)
    seated_capacity = models.PositiveSmallIntegerField(default=0)
    fire_capacity = models.PositiveSmallIntegerField(default=0)
    has_av = models.BooleanField(default=False)
    accessible = models.BooleanField(default=False)
    notes = models.TextField(blank=True)
    is_active = models.BooleanField(default=True)

    class Meta:
        ordering = ['venue__name', 'name']
        constraints = [
            models.UniqueConstraint(fields=['venue', 'name'], name='unique_room_name_per_venue'),
        ]

    def __str__(self) -> str:
        return f'{self.name} ({self.venue.name})'

    def clean(self):
        # In `clean()` rather than only in the serializer, so the admin and any seed command are
        # held to it too — the discipline `events.Event.clean` already states.
        if self.fire_capacity and self.seated_capacity > self.fire_capacity:
            raise ValidationError(
                {'seated_capacity': 'A room cannot seat more people than fire safety lets in.'}
            )


class RoomBooking(models.Model):
    """An organiser asking a building for a room, and the building's answer.

    This row IS the event ↔ venue link. There is no `Event.venue` field and there is not going to be
    one: an event may ask two buildings, be refused by one, and hold the answer from the other; a
    nullable FK on `Event` can hold exactly one of those facts and loses the rest.

    Overlap is checked in `access.booking_block_reason` against the database rather than by a
    constraint, because the rule is not "these two rows are identical" — it is "these two intervals
    intersect", which no SQLite unique index expresses. `approved` is the only status that occupies
    the room: two organisers may both ask for Thursday, and the building picks.
    """

    event = models.ForeignKey('events.Event', related_name='room_bookings', on_delete=models.CASCADE)
    room = models.ForeignKey(Room, related_name='bookings', on_delete=models.CASCADE)
    starts_at = models.DateTimeField()
    ends_at = models.DateTimeField()
    status = models.CharField(max_length=10, choices=BOOKING_STATUS_CHOICES, default='requested')
    # What the organiser expects, checked against `Room.fire_capacity` at request time — an honest
    # refusal before the room is held, rather than a surprise on the day.
    expected_headcount = models.PositiveSmallIntegerField(default=0)
    purpose = models.CharField(max_length=300, blank=True)
    decided_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        related_name='room_bookings_decided',
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
    )
    decided_at = models.DateTimeField(null=True, blank=True)
    # The building's own sentence — "not during the exam session", "yes, but the side door stays
    # locked". A refusal carries its reason (house rule 6), and a rejected booking with no note is a
    # door closed with nobody behind it.
    note = models.TextField(blank=True)
    requested_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        related_name='room_bookings_requested',
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
    )
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ['starts_at', 'id']
        indexes = [models.Index(fields=['room', 'status', 'starts_at'])]

    def __str__(self) -> str:
        return f'{self.room} — {self.event} ({self.status})'

    def clean(self):
        if self.starts_at and self.ends_at and self.ends_at <= self.starts_at:
            raise ValidationError({'ends_at': 'A booking has to end after it starts.'})


class ChecklistTemplate(models.Model):
    """What a building hands an organiser, or what the platform hands one whose building has not
    written its own.

    `venue` nullable means "a platform default" — the four seeded bilingual templates
    (CONFERENCE-RESEARCH-REPORT.md §6.4) belong to nobody and are offered everywhere, which is what
    makes the feature useful on day one to a venue that has written nothing.

    `version` is an integer that goes up when the items change. It is not there to version the
    template for its own sake; it is there so an instance can say which edition it was cut from, and
    so `sync` can tell an organiser "the building added two items since you started".
    """

    venue = models.ForeignKey(
        Venue, related_name='checklist_templates', null=True, blank=True, on_delete=models.CASCADE
    )
    name = models.CharField(max_length=200)
    description = models.TextField(blank=True)
    version = models.PositiveIntegerField(default=1)
    # A hint, not a filter: "a one-room guest lecture", "a school science day with minors". Free text
    # rather than a choice list, because the four seeded ones are examples of a shape, not an
    # enumeration of every kind of thing that happens in a university building.
    event_kind_hint = models.CharField(max_length=80, blank=True)
    is_active = models.BooleanField(default=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ['venue__name', 'name']

    def __str__(self) -> str:
        where = self.venue.name if self.venue_id else 'platform default'
        return f'{self.name} ({where}, v{self.version})'


class ChecklistTemplateItem(models.Model):
    """One line of a template, in both languages.

    Two title columns rather than the project's usual translation table (root CLAUDE.md, shape 1),
    and deliberately so: a translation row exists because *the community* submits and reviews
    translations of content. A checklist item is not content — it is a rule a building wrote, in the
    two languages this platform speaks, edited by the building itself. A review workflow over "zdanie
    kluczy na portierni" would be machinery with nobody to run it.
    """

    template = models.ForeignKey(
        ChecklistTemplate, related_name='items', on_delete=models.CASCADE
    )
    title_en = models.CharField(max_length=300)
    title_pl = models.CharField(max_length=300)
    description_en = models.TextField(blank=True)
    description_pl = models.TextField(blank=True)
    owner_role = models.CharField(max_length=10, choices=ITEM_OWNER_CHOICES, default='organiser')
    # Signed minutes. Negative is before the anchor, positive is after — "T − 14 days" is
    # `-20160` with `anchor='start'`, "T + 1 hour" is `60` with `anchor='end'`.
    due_offset_minutes = models.IntegerField(default=0)
    anchor = models.CharField(max_length=5, choices=ANCHOR_CHOICES, default='start')
    is_mandatory = models.BooleanField(default=True)
    # Whether this line may be waved away at all. A mandatory item can still be `na_allowed` — "no
    # catering was ordered" is a legitimate answer to the catering notification item — and the
    # difference between the two flags is the difference between "you must answer this" and "the
    # answer may be no".
    na_allowed = models.BooleanField(default=False)
    evidence_kind = models.CharField(max_length=5, choices=EVIDENCE_KIND_CHOICES, default='none')
    requires_venue_signoff = models.BooleanField(default=False)
    order = models.PositiveSmallIntegerField(default=0)

    class Meta:
        ordering = ['order', 'id']

    def __str__(self) -> str:
        return self.title_en or self.title_pl


class ChecklistInstance(models.Model):
    """One event's working copy of one building's template. One per (event, venue).

    `template` is `SET_NULL` on purpose, unlike almost every other FK here: the instance is a
    snapshot and must keep resolving after the building deletes the template it came from. What it
    loses is the *offer* to sync, which is exactly the right thing to lose.
    """

    event = models.ForeignKey(
        'events.Event', related_name='checklist_instances', on_delete=models.CASCADE
    )
    venue = models.ForeignKey(Venue, related_name='checklist_instances', on_delete=models.CASCADE)
    template = models.ForeignKey(
        ChecklistTemplate,
        related_name='instances',
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
    )
    #: The edition the snapshot was cut from. Compared against the template's CURRENT `version` to
    #: decide whether there is anything to offer.
    template_version = models.PositiveIntegerField(default=1)
    template_name = models.CharField(max_length=200, blank=True)
    created_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        related_name='checklist_instances_created',
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
    )
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ['created_at', 'id']
        constraints = [
            models.UniqueConstraint(
                fields=['event', 'venue'], name='unique_checklist_per_event_venue'
            ),
        ]

    def __str__(self) -> str:
        return f'{self.template_name or "Checklist"} — {self.event}'


class ChecklistInstanceItem(models.Model):
    """One line somebody actually has to do, with its own copy of the words.

    `computed_due_at` is stored rather than derived on read for one reason that is not performance:
    the event may move. A due date recomputed on every read would silently slide "the keys go back
    an hour after it ends" to a new day when the organiser changes the date, which is right — so it
    IS recomputed, by `services.recompute_due_dates`, on an explicit refresh rather than invisibly
    on every GET. Storing it is what makes "this was due yesterday" a fact the list can sort by.
    """

    instance = models.ForeignKey(
        ChecklistInstance, related_name='items', on_delete=models.CASCADE
    )
    # The snapshot. Same columns as the template item, deliberately duplicated rather than a FK.
    title_en = models.CharField(max_length=300)
    title_pl = models.CharField(max_length=300)
    description_en = models.TextField(blank=True)
    description_pl = models.TextField(blank=True)
    owner_role = models.CharField(max_length=10, choices=ITEM_OWNER_CHOICES, default='organiser')
    due_offset_minutes = models.IntegerField(default=0)
    anchor = models.CharField(max_length=5, choices=ANCHOR_CHOICES, default='start')
    is_mandatory = models.BooleanField(default=True)
    na_allowed = models.BooleanField(default=False)
    evidence_kind = models.CharField(max_length=5, choices=EVIDENCE_KIND_CHOICES, default='none')
    requires_venue_signoff = models.BooleanField(default=False)
    order = models.PositiveSmallIntegerField(default=0)

    #: Null when the event has no time yet — genuinely unknown, not "due now". Every reader already
    #: handles an event with no `starts_at` (events/models.py says why one is allowed).
    computed_due_at = models.DateTimeField(null=True, blank=True)

    status = models.CharField(max_length=14, choices=ITEM_STATUS_CHOICES, default='pending')
    na_reason = models.TextField(blank=True)
    evidence_text = models.TextField(blank=True)
    evidence_url = models.URLField(max_length=500, blank=True)
    evidence_file = models.FileField(
        upload_to=evidence_upload_path,
        blank=True,
        validators=[validate_material_submission_file],
    )
    done_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        related_name='checklist_items_done',
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
    )
    done_at = models.DateTimeField(null=True, blank=True)
    signed_off_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        related_name='checklist_items_signed',
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
    )
    signed_off_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        ordering = ['order', 'id']
        indexes = [models.Index(fields=['instance', 'status'])]

    def __str__(self) -> str:
        return self.title_en or self.title_pl

    def clean(self):
        if self.status == 'not_applicable':
            if not self.na_allowed:
                raise ValidationError({'status': 'This item cannot be marked as not applicable.'})
            if not (self.na_reason or '').strip():
                raise ValidationError({'na_reason': 'Say why this does not apply.'})

    @property
    def is_overdue(self) -> bool:
        return (
            self.computed_due_at is not None
            and self.status not in ('done', 'not_applicable')
            and self.computed_due_at < timezone.now()
        )
