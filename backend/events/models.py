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
]

#: The one status that occupies a seat.
ATTENDING_STATUSES = frozenset({'going'})


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
        return self.starts_at + timedelta(minutes=self.duration_minutes or 0)

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

    @property
    def seats_left(self):
        """`None` for an uncapped event — genuinely different from 0, which means full."""
        if not self.capacity:
            return None
        return max(0, self.capacity - self.going_count())

    @property
    def is_full(self) -> bool:
        return self.capacity > 0 and self.going_count() >= self.capacity

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
        already = self.attendances.filter(attendee=user).first()
        if self.is_full and not (already and already.status in ATTENDING_STATUSES):
            return 'full'
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
