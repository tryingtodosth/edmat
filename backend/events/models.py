"""One-off happenings somebody organises and other people turn up to.

**Why this is not one of the two things it looks like.** EdMat already has two models that put a
person in a room with other people at a time, and an event is neither of them:

- `classroom.Course` is something taught *over time* to a group who sign up for it. It has a
  roster, chapters, lessons, contributions, staff and an enrolment lifecycle in which a request can
  be pending, approved, declined or revoked. A guest lecture on Thursday has none of that. Modelling
  one as a course with a single lesson would mean every one of those fields exists and means nothing,
  and every read site would have to defend against a "course" that is really an evening.
- `booking.Booking` is one person's hour with one tutor, negotiated: requested, then confirmed or
  declined. An event is the opposite shape — it is published first and *many* people answer it, and
  nobody approves anybody. There is no counterparty to negotiate with.

So an event is its own small model, and deliberately smaller than either: a title, a time, a place, a
cap, and a list of people who said they are coming. Everything it needs that already exists is reused
rather than rebuilt — the taxonomy for discovery (the same `subjects`/`field` pair `Course` and
`Service` both use), `notifications.notify()` for telling people, and the `events` FeatureFlag for the
kill switch.
"""

from datetime import timedelta

from django.conf import settings
from django.core.exceptions import ValidationError
from django.db import models
from config.audience import AUDIENCE_CHOICES, DEFAULT_AUDIENCE
from django.utils import timezone

from .postimage import validate_post_image

# An event's own lifecycle. Three values rather than a boolean `is_published` plus a boolean
# `is_cancelled`, for the reason `Course.status` already records: two booleans make an illegal
# state representable — cancelled but never published — that every read site then has to defend
# against.
STATUS_CHOICES = [
    # Visible only to its host. Every event starts here, so nothing is ever published by the act of
    # creating it — the same rule courses follow, and for the same reason: an event is announced
    # once, to everybody, and there is no taking that back.
    ('draft', 'Draft'),
    ('published', 'Published'),
    # Deliberately a state rather than a deletion. People have arranged their Thursday around this;
    # deleting the row would remove it from their list with no explanation and leave whoever did not
    # see the notification turning up to an empty room. A cancelled event stays visible, and says so.
    ('cancelled', 'Cancelled'),
]

#: The states in which an event is visible to anybody other than its host. One definition, so
#: "is this public?" can never drift between the queryset filter and a permission check.
PUBLIC_STATUSES = frozenset({'published', 'cancelled'})
#: The one state that accepts answers. A cancelled event is readable but nobody may newly say they
#: are coming to it.
RESPONDABLE_STATUSES = frozenset({'published'})

# Who besides the host can ever see this event, independent of `status`. Genuinely orthogonal to
# publishing: `status` asks "has this been announced", `visibility` asks "who is it announced TO".
# A published-but-private event is a real, coherent thing — a personal calendar entry the host
# wants their own attendance/notification/schedule machinery for, with nobody else in the loop —
# not a contradiction the model needs to refuse.
#
# Defaults to `private`, per explicit product direction: creating an event is not the same act as
# broadcasting it, and a visitor's very first event should never be world-readable by accident.
# Making it public is a deliberate, later choice, not something that falls out of publishing.
VISIBILITY_CHOICES = [
    ('private', 'Only me'),
    ('public', 'Anyone'),
]
PUBLIC_VISIBILITY = frozenset({'public'})

# Where it happens. Three values rather than a nullable URL, because "online" and "in a room" and
# "both" are three genuinely different things to a person deciding whether they can attend, and a
# hybrid event with only a URL field set would read as online-only to somebody who would have come
# in person.
LOCATION_KIND_CHOICES = [
    ('onsite', 'In a physical place'),
    ('online', 'Online'),
    ('hybrid', 'Both — a room, and a link'),
]

#: Kinds that need somewhere to be. Used by `clean()` below, so the requirement lives in one place.
NEEDS_PLACE = frozenset({'onsite', 'hybrid'})
#: Kinds that need a link.
NEEDS_LINK = frozenset({'online', 'hybrid'})

# What somebody said. Two values, and `not_going` is a real stored row rather than the absence of
# one, for two reasons that are not the same:
#
#  1. Capacity. Somebody who said they were coming and then changed their mind must give the seat
#     back, and with one row per person (see the unique constraint below) that is a status change on
#     a row that already exists — so nobody can ever hold two seats, and no counting code has to
#     reconcile a delete with a create.
#  2. "I answered no" and "I never answered" are different states, and the host's own view of the
#     event is more honest when it can tell them apart: twelve declines out of forty invitations
#     is information, and an empty list looks identical whether nobody wants to come or nobody has
#     looked yet.
ATTENDANCE_STATUS_CHOICES = [
    ('going', 'Going'),
    ('not_going', 'Not going'),
    # Registration states (AUDIENCE-BRIEF.md §3.3). `pending` waits for an organiser (approval
    # mode); `waitlisted` waits for a seat; `promoted` HOLDS a seat for 24 hours while the person
    # confirms it; `expired` let that window lapse — the seat went on to the next in line.
    ('pending', 'Awaiting approval'),
    ('waitlisted', 'On the waiting list'),
    ('promoted', 'Seat offered — awaiting confirmation'),
    ('expired', 'Offer expired'),
]

REGISTRATION_MODE_CHOICES = [
    ('rsvp', 'Anyone may register, immediately'),
    ('approval', 'The organiser confirms each registration'),
    ('form', 'A registration form, confirmed immediately'),
]
PROMOTION_WINDOW = timedelta(hours=24)

#: The one status that occupies a seat.
ATTENDING_STATUSES = frozenset({'going'})
# What occupies a seat: the people going, and the people a seat is being held for while they
# confirm. A `promoted` row that did not count would let the next person take the very seat that
# was just offered.
SEAT_HOLDING_STATUSES = frozenset({'going', 'promoted'})


class Event(models.Model):
    host = models.ForeignKey(
        settings.AUTH_USER_MODEL, related_name='hosted_events', on_delete=models.CASCADE
    )
    title = models.CharField(max_length=200)
    summary = models.CharField(max_length=300, blank=True)
    description = models.TextField(blank=True)

    # A bigger event made of smaller ones — a conference with individual sessions, a two-day
    # workshop with a talk each morning. Self-referential rather than a second model: a sub-event
    # IS a real, ordinary Event (its own time, its own place, its own roster somebody answers), not
    # a lighter "session" shape that would need its own attendance/notification machinery
    # duplicated. `related_name='sub_events'` is what the parent's own serializer reads to list them.
    #
    # `on_delete=CASCADE`, deliberately unlike every other FK on this model: a session only exists
    # IN THE CONTEXT of the conference that groups it, unlike an attendance or a post, which outlive
    # a deleted account (`SET_NULL`) because the people who need them are someone else. Deleting the
    # conference deleting its own sessions is the same "the deletion is a statement about the
    # grouping" reasoning `Chapter`'s own `SET_NULL` note (`courses/models.py`) argues for the
    # opposite case — there, content survives its chapter; here, a session has no life outside its
    # own conference to survive INTO.
    #
    # Capped at exactly two levels (`clean()` below refuses a sub-event's own parent having a
    # parent) rather than an arbitrarily deep tree — "sessions of sessions" is not a shape this
    # feature is for, and a hard cap is also what makes a cycle structurally impossible to construct
    # without a second, separate cycle-detection pass: a parent that itself has no parent can never
    # be reached by walking upward from any of its own descendants.
    parent = models.ForeignKey(
        'self', null=True, blank=True, related_name='sub_events', on_delete=models.CASCADE
    )

    # Discovery through the taxonomy rather than free-text tags — the same choice `Course` and
    # `Service` both already make, and the reason somebody browsing Analiza Matematyczna II finds the
    # exam-prep session about it without knowing it exists.
    subjects = models.ManyToManyField('taxonomy.Branch', related_name='events', blank=True)
    discipline = models.ForeignKey(
        'taxonomy.Discipline',
        related_name='events',
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
    )

    status = models.CharField(max_length=10, choices=STATUS_CHOICES, default='draft')
    # Who this is for — AUDIENCE-BRIEF.md §1. `university` is what every row that predates the
    # field means; the submit forms require an explicit choice, this default exists for the
    # migration and for code paths (the corpus importer, fixtures) that never asked.
    audience = models.CharField(
        max_length=12, choices=AUDIENCE_CHOICES, default=DEFAULT_AUDIENCE, db_index=True
    )
    visibility = models.CharField(max_length=8, choices=VISIBILITY_CHOICES, default='private')

    # A single instant plus a length, rather than a start and an end. Two datetimes make an event
    # that ends before it begins representable and would need validating at every write; a duration
    # cannot be negative in the first place, and "90 minutes" is also what a host actually knows when
    # they are writing the announcement. `ends_at` is derived below, so read sites still get one.
    #
    # Nullable, deliberately: a host may know nothing yet — not the day, not the hour — and this app
    # would rather hold that honestly than force a placeholder date nobody meant. `event_time` is the
    # one case a bare nullable `starts_at` cannot express on its own: a known HOUR with no known day
    # ("sometime around 3pm, haven't picked a date"). The two never both carry real information at
    # once in practice — the moment a host also knows the date, it belongs in `starts_at` instead —
    # but nothing here enforces that as a hard exclusivity rule; `event_time` is simply ignored by
    # every consumer (ordering, notifications, calendar-blocking, `?when=`) the instant `starts_at`
    # is set, since a real instant is always the more useful of the two.
    starts_at = models.DateTimeField(null=True, blank=True)
    event_time = models.TimeField(null=True, blank=True)
    duration_minutes = models.PositiveSmallIntegerField(default=60)

    location_kind = models.CharField(
        max_length=8, choices=LOCATION_KIND_CHOICES, default='onsite'
    )
    # Free text, not a structured address: this is "room 4070, Banacha 2" or "the third-floor common
    # room", and forcing that through a street/city/postcode form would make the common case harder
    # to write and no easier to read. `services.Service` already carries a geocoded location for the
    # one place in this app where distance genuinely matters (finding a tutor near you); nothing about
    # an event is decided by kilometres, so it does not inherit that machinery.
    location_text = models.CharField(max_length=300, blank=True)
    online_url = models.URLField(max_length=500, blank=True)

    # 0 means no limit, which is genuinely different from "a limit that happens to be large" — the
    # same convention, and the same default, `Course.capacity` already uses.
    capacity = models.PositiveSmallIntegerField(default=0)
    language = models.CharField(max_length=8, default='pl')
    # A multi-day event: the instant it runs until, when that is not simply `starts_at` plus the
    # duration. Null for the ordinary one-evening event, whose end is derived exactly as before —
    # so nothing that predates the field changes its meaning. See `ends_at`.
    runs_until = models.DateTimeField(null=True, blank=True)
    # How somebody gets in (AUDIENCE-BRIEF.md §3.3). `rsvp` is what every event did before the
    # field existed. Capacity is enforced on every path regardless of mode; a full event waitlists.
    registration_mode = models.CharField(
        max_length=10, choices=REGISTRATION_MODE_CHOICES, default='rsvp'
    )
    # The organiser's choice to show a MASKED list (first name + last initial) of who is going to
    # anybody who can see the event. Off, the roster stays what it was: attendees and staff only.
    show_attendees_publicly = models.BooleanField(default=False)

    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        # Soonest first, unlike every other list in this project — an event list is read to answer
        # "what is on next", and newest-first would put a talk in three months above the one tonight.
        ordering = ['starts_at']
        indexes = [models.Index(fields=['status', 'starts_at'])]

    def __str__(self) -> str:
        return self.title

    def clean(self):
        # Location is a courtesy, not a requirement — deliberately, per explicit product direction:
        # a private, undated "maybe drinks with the study group" entry has nowhere concrete to be
        # yet, and forcing a placeholder room/link into it would just be a lie the form makes you
        # tell. `NEEDS_PLACE`/`NEEDS_LINK` stay defined (and still drive which fields the frontend
        # shows) but no longer raise — a host who *does* fill one in still gets it rendered, and one
        # who doesn't gets an honestly-blank field, not a validation error standing in the way.
        if self.duration_minutes is not None and self.duration_minutes < 5:
            raise ValidationError({'duration_minutes': 'An event lasts at least five minutes.'})
        if self.runs_until is not None and self.starts_at is not None and self.runs_until <= self.starts_at:
            raise ValidationError({'runs_until': 'An event has to end after it starts.'})
        if self.parent_id is not None:
            if self.pk is not None and self.parent_id == self.pk:
                raise ValidationError({'parent': 'An event cannot be part of itself.'})
            # The depth cap, checked here too (not only in the write serializer) so the admin and
            # any seed command are held to it as well — the same "the model is the one place a rule
            # lives" discipline this method's own docstring already established for duration.
            if self.parent_id is not None and Event.objects.filter(
                pk=self.parent_id, parent__isnull=False
            ).exists():
                raise ValidationError(
                    {'parent': 'An event that is itself part of another cannot hold sub-events too.'}
                )

    @property
    def ends_at(self):
        """`None` when there is no `starts_at` to add a duration to — genuinely unscheduled, not a
        zero-length event. Every reader of this property already has to handle `starts_at` being
        absent one way or another (ordering/filtering already exclude it via `starts_at__lt`/`__gte`
        style queries, which simply never match a NULL row), so this stays consistent with that."""
        if self.starts_at is None:
            return None
        if self.runs_until is not None:
            return self.runs_until
        return self.starts_at + timedelta(minutes=self.duration_minutes or 0)

    def save(self, *args, **kwargs):
        """Creating an event also seats its host as an organiser — the `Course.save()` lesson:
        "every event has an organiser" is an invariant of the model, not of one view, since seed
        commands, the admin and tests create events too."""
        creating = self._state.adding
        super().save(*args, **kwargs)
        if creating and self.host_id:
            EventStaff.objects.get_or_create(
                event=self, user_id=self.host_id, defaults={'role': 'organiser'}
            )

    def role_of(self, user) -> str | None:
        if not (user and getattr(user, 'is_authenticated', False)):
            return None
        if self.host_id == user.pk:
            return 'organiser'
        for row in self.staff.all():
            if row.user_id == user.pk:
                return row.role
        return None

    def can_organise(self, user) -> bool:
        """Change the event, its programme and its staff."""
        return self.role_of(user) in ORGANISING_ROLES

    def is_staff_member(self, user) -> bool:
        return self.role_of(user) is not None

    @property
    def is_past(self) -> bool:
        ends_at = self.ends_at
        return ends_at is not None and ends_at < timezone.now()

    def going_count(self) -> int:
        """People who said they are coming. The host is NOT counted — they are running it, not
        attending it, and counting them would make an empty event report one attendee."""
        return self.attendances.filter(status__in=ATTENDING_STATUSES).count()

    def declined_count(self) -> int:
        return self.attendances.filter(status='not_going').count()

    def seat_holder_count(self) -> int:
        return self.attendances.filter(status__in=SEAT_HOLDING_STATUSES).count()

    def waitlist_count(self) -> int:
        return self.attendances.filter(status='waitlisted').count()

    def pending_count(self) -> int:
        return self.attendances.filter(status='pending').count()

    @property
    def seats_left(self):
        """`None` for an uncapped event — genuinely different from 0, which means full."""
        if not self.capacity:
            return None
        return max(0, self.capacity - self.seat_holder_count())

    @property
    def is_full(self) -> bool:
        return self.capacity > 0 and self.seat_holder_count() >= self.capacity

    def response_block_reason(self, user):
        """Why this person cannot say they are coming, or `None` if they can.

        One function returning a reason rather than a boolean, because every one of these has to be
        shown to somebody — a disabled button with no explanation is the thing this codebase's own
        classroom enrolment notes already argue against.
        """
        if not (user and user.is_authenticated):
            return 'sign_in'
        if self.status not in RESPONDABLE_STATUSES:
            return 'cancelled' if self.status == 'cancelled' else 'not_published'
        if self.host_id == user.pk:
            return 'host'
        if self.is_past:
            return 'past'
        # Somebody who already holds a seat is never blocked by the cap — otherwise a full event
        # would refuse to let one of its own attendees change their mind and then change it back,
        # and would refuse to let them decline, which is the one answer a full event most wants.
        # A full event no longer refuses: the answer is the waiting list (§3.3). `full` stays a
        # value of this function's contract for clients that predate the field, but is never
        # returned now.
        return None


#: The most links one post may carry. Not a storage bound — it is a shape bound. A post is an
#: announcement somebody reads in a feed, and past a handful of links it has stopped being one and
#: become a link dump, which is what the event's own `description` is for.
MAX_POST_LINKS = 10


class EventPost(models.Model):
    """An update the host writes on an event after announcing it. A picture, some links, some words.

    **Why this is not the event's `description`.** A description answers "what is this?" and is read
    by somebody deciding whether to come; it is edited in place, and its history is of no interest.
    An update answers "what has happened since?" — the room changed, the slides are up, here is the
    recording, we are running twenty minutes late — and those are *appended*, dated, and read in
    order. Folding them into the description would mean either losing every earlier one or growing a
    single text field into an undated changelog nobody can skim.

    **Why this is not a comment.** The `community.Comment` thread this project already has is a
    conversation: anybody may write, and the reader's question is "what do people think?". This is a
    broadcast from the one person running the thing, and the reader's question is "what do I need to
    know?". Same shape, opposite direction — mixing them would bury "moved to room 5" under a
    discussion, which is exactly the message that must not be buried.

    **Why the host alone may write one.** Everything here goes out as a notification to everybody
    holding a seat (see `services.notify_attendees_of_post`), and the right to interrupt forty
    people's evening belongs to the person who organised it. Attendees are not silenced by this —
    they have the event's own thread — they simply do not get the megaphone.
    """

    event = models.ForeignKey(Event, related_name='posts', on_delete=models.CASCADE)
    # Nullable and SET_NULL, matching `Attachment.uploaded_by`: a deleted account must not take the
    # announcement "the venue has moved" down with it, since the people who need that are the
    # attendees, not the author.
    author = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        related_name='event_posts',
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
    )

    body = models.TextField(blank=True)
    # Re-encoded on the way in rather than stored as uploaded — `postimage.py` explains why, and the
    # validator here is what keeps the admin path (which never reaches the API's processing) held to
    # the size, type and decompression-bomb checks at least.
    image = models.ImageField(
        upload_to='event-posts/', blank=True, validators=[validate_post_image]
    )

    created_at = models.DateTimeField(auto_now_add=True)
    # An explicit stamp rather than `auto_now`, because the question a reader has is "was this
    # changed after I read it?", and `auto_now` cannot answer it: it is set on the very first save
    # too, so "edited" would have to be inferred from `updated_at != created_at`, which is true by a
    # few microseconds for every post ever written. Null means never edited, and says so plainly.
    edited_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        # Newest first — the opposite of `Event.Meta.ordering`, and deliberately so. An event list is
        # read to answer "what is on next", so it runs soonest-first; a feed of updates is read to
        # answer "what has changed?", and the answer is at the top.
        ordering = ['-created_at', '-id']
        indexes = [models.Index(fields=['event', '-created_at'])]

    def __str__(self) -> str:
        return f'{self.event.title} — {self.created_at:%Y-%m-%d}'

    def clean(self):
        # A post with neither words nor a picture is not an update, it is an empty notification sent
        # to everybody who is coming. Links alone do not count: a bare URL with no sentence saying
        # what it is asks the reader to click to find out, which is the thing an announcement exists
        # to save them.
        if not (self.body or '').strip() and not self.image:
            raise ValidationError(
                {'body': 'An update needs something to say — write a line, or attach a picture.'}
            )

    @property
    def is_edited(self) -> bool:
        return self.edited_at is not None


class EventPostLink(models.Model):
    """One link on one post.

    Rows rather than a JSON list on the post, matching how every other repeated thing in this project
    is stored: a `URLField` gets each one validated on the way in for free, and a list inside a text
    column gets none of that and cannot be queried later without parsing it back out.

    Deliberately a URL and nothing else — no title, no description. A label sounds useful until you
    ask who writes it: the host, in a second field, for every link, most of which are self-describing
    (a Zoom URL, a Drive folder, an arXiv paper). The frontend shows the host and path, which is what
    somebody actually reads before deciding whether to click.
    """

    post = models.ForeignKey(EventPost, related_name='links', on_delete=models.CASCADE)
    url = models.URLField(max_length=500)
    # The order the host wrote them in. Stored rather than relying on insertion id, so a later edit
    # that rewrites the set can put them back in a different order without deleting and recreating
    # rows in a particular sequence.
    position = models.PositiveSmallIntegerField(default=0)

    class Meta:
        ordering = ['position', 'id']

    def __str__(self) -> str:
        return self.url


class EventAttendance(models.Model):
    """One person's answer to one event. See `ATTENDANCE_STATUS_CHOICES` for why "no" is a row.

    Not a history table: an answer is overwritten rather than appended to. Somebody who flips between
    going and not going four times has one current answer, which is the only thing either the host or
    the seat count ever asks about — keeping every intermediate state would need its own retention
    story and answer a question nobody has.
    """

    event = models.ForeignKey(Event, related_name='attendances', on_delete=models.CASCADE)
    attendee = models.ForeignKey(
        settings.AUTH_USER_MODEL, related_name='event_attendances', on_delete=models.CASCADE
    )
    status = models.CharField(max_length=10, choices=ATTENDANCE_STATUS_CHOICES, default='going')
    # Free text the attendee writes for the host — "I will be twenty minutes late", "can I bring a
    # colleague". Mirrors the note on a course enrolment request, which exists for the same reason:
    # the answer alone frequently is not the whole of what somebody wanted to say.
    note = models.CharField(max_length=300, blank=True)
    # Registration (AUDIENCE-BRIEF.md §3.3). `answers` is keyed by RegistrationField id (a JSON
    # object) — a form event's answers travel with the row rather than a second table, because
    # they are read together and never queried apart. `registered_by` is set when a guardian
    # registers a child (step 5); null means the person registered themselves.
    answers = models.JSONField(default=dict, blank=True)
    registered_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        related_name='registrations_made',
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
    )
    # Waiting-list order is `waitlisted_at` (first asked, first promoted); a promotion holds a seat
    # until `promotion_expires_at`. Check-in is a timestamp on a `going` row, not a status: an
    # undo is clearing it, and the seat is never touched by either.
    waitlisted_at = models.DateTimeField(null=True, blank=True)
    promotion_expires_at = models.DateTimeField(null=True, blank=True)
    checked_in_at = models.DateTimeField(null=True, blank=True)
    checked_in_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        related_name='event_checkins_done',
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
    )
    responded_at = models.DateTimeField(auto_now=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        # One answer per person per event, enforced by the database rather than by whichever view
        # happens to write it — this is what makes "change your mind" a status update and makes it
        # impossible for one person to occupy two seats.
        constraints = [
            models.UniqueConstraint(
                fields=['event', 'attendee'], name='unique_event_attendance'
            )
        ]
        ordering = ['created_at']

    def __str__(self) -> str:
        return f'{self.attendee} → {self.event} ({self.status})'


# ---- the programme: organisers, tracks, sessions, speakers, links, bookmarks -------------------
# AUDIENCE-BRIEF.md §3.1, §3.2. Everything below hangs off Event and is deleted with it.

STAFF_ROLE_CHOICES = [
    ('organiser', 'Organiser'),  # edits the event and its programme, decides registrations
    ('reviewer', 'Reviewer'),  # sees and decides contributions only (step 4)
    ('volunteer', 'Volunteer'),  # checks people in on the day only (step 3)
]
ORGANISING_ROLES = frozenset({'organiser'})


class EventStaff(models.Model):
    """One person who helps run an event, and in what capacity — the `CourseStaff` shape.

    The host is a real `organiser` row here (created in `Event.save()`), not an implied special
    case, so `Event.role_of` is one lookup with no "…or the host field" branch at every call site.
    `Event.host` stays as the denormalised owner every byline and `mine=hosting` filter reads.
    The host's row is never removable through the API: an event whose host a co-organiser could
    evict is an event that can be taken hostage.
    """

    event = models.ForeignKey(Event, related_name='staff', on_delete=models.CASCADE)
    user = models.ForeignKey(
        settings.AUTH_USER_MODEL, related_name='event_staff_roles', on_delete=models.CASCADE
    )
    role = models.CharField(max_length=10, choices=STAFF_ROLE_CHOICES, default='organiser')
    added_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        related_name='event_staff_added',
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
    )
    added_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ['added_at', 'id']
        constraints = [
            models.UniqueConstraint(fields=['event', 'user'], name='unique_staff_per_event'),
        ]

    def __str__(self) -> str:
        return f'{self.user} — {self.role} of {self.event}'


SESSION_KIND_CHOICES = [
    ('talk', 'Talk'),
    ('workshop', 'Workshop'),
    ('poster', 'Poster session'),
    ('break', 'Break'),
    ('social', 'Social'),
    ('other', 'Other'),
]


class Track(models.Model):
    """A parallel strand of a programme ("Room A", "Beginners"). Optional: a single-track workshop
    never creates one, and a session with no track sits in the programme's one implicit column."""

    event = models.ForeignKey(Event, related_name='tracks', on_delete=models.CASCADE)
    name = models.CharField(max_length=80)
    colour = models.CharField(max_length=7, blank=True)  # '#rrggbb', or blank for the default
    order = models.PositiveSmallIntegerField(default=0)

    class Meta:
        ordering = ['order', 'id']
        constraints = [
            models.UniqueConstraint(fields=['event', 'name'], name='unique_track_name_per_event'),
        ]

    def __str__(self) -> str:
        return self.name


class Session(models.Model):
    """One block on the programme. Its own time and place, because a two-day event has many of
    both; its own `capacity` (0 = the event's own) because "register for the 14:00 workshop" only
    means something once a session can be full on its own (step 3)."""

    event = models.ForeignKey(Event, related_name='sessions', on_delete=models.CASCADE)
    track = models.ForeignKey(
        Track, related_name='sessions', null=True, blank=True, on_delete=models.SET_NULL
    )
    kind = models.CharField(max_length=10, choices=SESSION_KIND_CHOICES, default='talk')
    title = models.CharField(max_length=200)
    abstract = models.TextField(blank=True)
    starts_at = models.DateTimeField()
    duration_minutes = models.PositiveSmallIntegerField(default=60)
    location_text = models.CharField(max_length=300, blank=True)
    online_url = models.URLField(max_length=500, blank=True)
    capacity = models.PositiveSmallIntegerField(default=0)
    order = models.PositiveSmallIntegerField(default=0)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ['starts_at', 'order', 'id']

    def __str__(self) -> str:
        return self.title

    @property
    def ends_at(self):
        return self.starts_at + timedelta(minutes=self.duration_minutes or 0)

    def clean(self):
        if self.duration_minutes is not None and self.duration_minutes < 5:
            raise ValidationError({'duration_minutes': 'A session lasts at least five minutes.'})
        event = self.event
        # Within the event's own span, when the event has one. An unscheduled event ("not decided
        # yet") constrains nothing — a programme is what fixes the dates in that case.
        if event.starts_at is not None and self.starts_at is not None:
            if self.starts_at < event.starts_at or self.ends_at > event.ends_at:
                raise ValidationError(
                    {'starts_at': 'A session has to fit inside the event it belongs to.'}
                )
        if self.track_id is not None and self.track.event_id != event.pk:
            raise ValidationError({'track': 'That track belongs to a different event.'})


class SessionSpeaker(models.Model):
    """A speaker is a row that MAY point at a profile, not a profile. Most speakers at a school
    science day have no EdMat account and never will; forcing one would produce fake accounts.
    When `user` is set, the name is still stored — it is what the programme printed."""

    session = models.ForeignKey(Session, related_name='speakers', on_delete=models.CASCADE)
    user = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        related_name='speaking_at',
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
    )
    name = models.CharField(max_length=120)
    affiliation = models.CharField(max_length=200, blank=True)
    bio = models.TextField(blank=True)
    order = models.PositiveSmallIntegerField(default=0)

    class Meta:
        ordering = ['order', 'id']

    def __str__(self) -> str:
        return self.name


LINK_ROLE_CHOICES = [
    ('prepare', 'Read or try before'),
    ('live', 'Worked through in the room'),
    ('homework', 'Afterwards, on your own'),
    ('slides', 'Slides'),
    ('recording', 'Recording'),
    ('solutions', 'Solutions'),
    ('other', 'Related'),
]


class SessionLink(models.Model):
    """A session points at the corpus — the thing a generic conference tool does not do. Exactly
    one of material/exercise/exercise_set/url (a real CheckConstraint, the `Post` anchor shape),
    plus the `role` that says what the reader is meant to do with it, which is what lets the
    session page group them and an exercise page list every session it appears in."""

    session = models.ForeignKey(Session, related_name='links', on_delete=models.CASCADE)
    material = models.ForeignKey(
        'materials.Material', null=True, blank=True, related_name='session_links', on_delete=models.CASCADE
    )
    exercise = models.ForeignKey(
        'exercises.Exercise', null=True, blank=True, related_name='session_links', on_delete=models.CASCADE
    )
    exercise_set = models.ForeignKey(
        'study.ExerciseSet', null=True, blank=True, related_name='session_links', on_delete=models.CASCADE
    )
    url = models.URLField(max_length=500, blank=True)
    role = models.CharField(max_length=10, choices=LINK_ROLE_CHOICES, default='other')
    label = models.CharField(max_length=200, blank=True)
    note = models.CharField(max_length=300, blank=True)
    order = models.PositiveSmallIntegerField(default=0)

    class Meta:
        ordering = ['order', 'id']
        constraints = [
            models.CheckConstraint(
                condition=(
                    models.Q(material__isnull=False, exercise__isnull=True, exercise_set__isnull=True, url='')
                    | models.Q(material__isnull=True, exercise__isnull=False, exercise_set__isnull=True, url='')
                    | models.Q(material__isnull=True, exercise__isnull=True, exercise_set__isnull=False, url='')
                    | (models.Q(material__isnull=True, exercise__isnull=True, exercise_set__isnull=True) & ~models.Q(url=''))
                ),
                name='session_link_exactly_one_target',
            ),
        ]

    @property
    def kind(self) -> str:
        if self.material_id:
            return 'material'
        if self.exercise_id:
            return 'exercise'
        if self.exercise_set_id:
            return 'set'
        return 'url'


class SessionBookmark(models.Model):
    """"I want to be at this one" — what feeds a person's own agenda view and `.ics` export."""

    user = models.ForeignKey(
        settings.AUTH_USER_MODEL, related_name='session_bookmarks', on_delete=models.CASCADE
    )
    session = models.ForeignKey(Session, related_name='bookmarks', on_delete=models.CASCADE)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        constraints = [
            models.UniqueConstraint(fields=['user', 'session'], name='unique_bookmark_per_session'),
        ]


# ---- registration forms and per-session seats (AUDIENCE-BRIEF.md §3.3) ------------------------

FIELD_KIND_CHOICES = [
    ('text', 'Short text'),
    ('long_text', 'Longer text'),
    ('choice', 'One of a list'),
    ('multi', 'Any of a list'),
    ('checkbox', 'Yes / no'),
]


class RegistrationField(models.Model):
    """One question on a `form` event's registration form — the Indico pattern cut down to what a
    small organiser uses. Baseline questions every form has (attendance mode for a hybrid event,
    accessibility needs, the consent line) are rendered by the client, not stored here; these are
    the organiser's own additions (affiliation, student number, dietary needs…)."""

    event = models.ForeignKey(Event, related_name='registration_fields', on_delete=models.CASCADE)
    label = models.CharField(max_length=200)
    kind = models.CharField(max_length=10, choices=FIELD_KIND_CHOICES, default='text')
    required = models.BooleanField(default=False)
    options = models.JSONField(default=list, blank=True)  # for choice / multi
    order = models.PositiveSmallIntegerField(default=0)

    class Meta:
        ordering = ['order', 'id']

    def __str__(self) -> str:
        return self.label


class SessionAttendance(models.Model):
    """A seat in one capped session, held by somebody who already holds a seat at the event.
    Only capped sessions need rows; an uncapped session is open to everybody going."""

    session = models.ForeignKey(Session, related_name='registrations', on_delete=models.CASCADE)
    attendance = models.ForeignKey(
        EventAttendance, related_name='session_registrations', on_delete=models.CASCADE
    )
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        constraints = [
            models.UniqueConstraint(fields=['session', 'attendance'], name='one_seat_per_session'),
        ]
