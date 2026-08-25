"""Courses run by users, and the people taking part in them.

**On the name.** This module used to be called `classroom`, with its model named `TaughtCourse` and
its route `/api/taught-courses/`, because `taxonomy.Course` already meant a *przedmiot* — a
university subject like Analiza Matematyczna II — and English collapses that and *kurs* onto one
word. The note here used to say that renaming the taxonomy side "would arguably be the tidier fix,
but reaches into migrations, the corpus importer, the API and the frontend's own routes." That is
exactly what has now been done: przedmiot turned out not to be taxonomy at all (it carried a
`university`), so it became a kurs, the knowledge levels became Discipline → Branch → Topic, and the
word `Course` is free for the thing everybody means by it.

Everything here reuses machinery this project already has rather than inventing parallel versions:
the taxonomy for discovery, existing exercises and materials as lesson content, the feature-flag kill
switch, and the same "public GET, owner-scoped writes" split `Service` and `ExerciseSet` established.
"""

import secrets

from django.conf import settings
from django.core.exceptions import ValidationError
from django.core.validators import MaxValueValidator, MinValueValidator
from django.db import models
from django.db.models.signals import post_delete
from django.dispatch import receiver
from django.utils import timezone

from .attachmentfile import validate_attachment_file

# These are two different questions, and until now they were one field. `draft` answered "who can
# see this", while `open`/`running`/`finished` answered "how far along is it" — so an instructor who
# wanted a course that was under way but unlisted had nothing to pick, and "Running" sitting in a
# menu of visibility options could not be explained to anybody in a sentence.
#
# Split, they are genuinely independent: a private course can be running, a public one can be
# finished, and a course visible only to its owner can be at any point in its life.
VISIBILITY_CHOICES = [
    # Nobody but the people who run it. Every course starts here, so creating one never publishes it.
    ('only_you', 'Only you'),
    # Not listed and not searchable, but openable with an invite link and by people the owner adds
    # directly. `CourseInvite.new_token` is 256-bit, so "unlisted" is a real boundary here and not
    # an obscurity that a guessable URL would give away.
    ('private', 'Private — only people you invite'),
    # Listed in the public course directory, for anyone, account or not.
    ('public', 'Public — anyone can find it'),
]

#: Visibilities somebody who is not staff on the course can reach at all, given a link or a place on
#: the roster.
REACHABLE_VISIBILITIES = frozenset({'private', 'public'})
#: The one visibility that appears in the public directory. Deliberately its own name rather than a
#: reuse of REACHABLE_VISIBILITIES: "can open it when handed a link" and "will be found by someone
#: browsing" are precisely the distinction `private` exists to draw, and collapsing them into one
#: set is how a private course would quietly end up listed.
LISTED_VISIBILITIES = frozenset({'public'})

# How far along the course is — lifecycle only now. There is no `draft` here any more; that was a
# statement about visibility, and it moved to the field above.
STATUS_CHOICES = [
    ('open', 'Open for enrolment'),
    # Under way, but closed to new participants. A distinct state from `finished`, because people are
    # still actively taking part.
    ('running', 'Running, enrolment closed'),
    ('finished', 'Finished'),
]

#: The one state that accepts new participants.
ENROLLING_STATUSES = frozenset({'open'})

# Who may read the course discussion. Three values rather than a boolean pair for the same reason
# `status` is one field: "off" and "public" and "participants only" are three states, and two
# booleans would make a fourth, meaningless one representable.
#
# `participants` is the default because it matches what the rest of the course already does — the
# roster is private and lesson notes are participant-only, so a discussion that was public by default
# would be the one place the course quietly leaked.
DISCUSSION_MODE_CHOICES = [
    ('off', 'No discussion'),
    ('participants', 'Participants and the instructor'),
    ('public', 'Anyone can read; participants can post'),
]

#: Modes in which the thread is readable by somebody who is not in the course.
PUBLICLY_READABLE_DISCUSSION = frozenset({'public'})

# Who sees how far everybody has got. Four values rather than a boolean pair, for the third time in
# this module and the same reason: "on or off" and "named or not" are two questions whose four
# combinations are not all meaningful, and one ladder says exactly what each rung is.
#
# `shared_anonymous` is the default because a tracker's whole point is that a cohort can see itself —
# "most people are still on week 2" is what stops somebody who is behind assuming they are the only
# one — while being named as the person who has not done the reading is a different thing to sign up
# for. So the useful half is on by default and the exposing half is not.
PROGRESS_VISIBILITY_CHOICES = [
    # Nobody, including staff and including your own row. Rows are RETAINED rather than deleted, so
    # turning it back on restores the history instead of destroying it — which is also why this is
    # not the same as "there is no tracker": there may be a great deal of it, simply not shown.
    ('off', 'No progress tracking'),
    # Only you see your own. Not shared with staff either — "private" that the people running the
    # course can read would be a promise the word does not make.
    ('private', 'Only you see your own'),
    # Everyone in the course sees the counts; only staff see who is where. The default.
    ('shared_anonymous', 'Everyone sees the counts, nobody is named'),
    # Everyone in the course sees who is where.
    ('shared_named', 'Everyone sees who is where'),
]

#: Modes in which somebody in the course learns anything about anybody else's progress.
PEER_VISIBLE_PROGRESS = frozenset({'shared_anonymous', 'shared_named'})

# What a participant may say about a lesson. Deliberately three values and not four: "not started" is
# the ABSENCE of a row, never a stored one, so there is exactly one representation of "I have not
# said anything" and no count ever has to reconcile two. The API still accepts `not_started` as a
# write — it deletes the row — because a person resetting their own answer is a real action.
#
# `stuck` earns its place because staff see names in every mode that shares anything, so it is a
# request for help somebody can actually answer, rather than a mood recorded into a void.
LESSON_PROGRESS_STATUS_CHOICES = [
    ('in_progress', 'Working on it'),
    ('stuck', 'Stuck'),
    ('done', 'Done'),
]

#: The write value that means "forget my answer". Not a stored status — see above.
PROGRESS_NOT_STARTED = 'not_started'

# Below this many OTHER active participants, a count stops hiding anybody: with one other person, "1
# done" and the knowledge that it was not you names them exactly. So in `shared_anonymous` — and only
# there, since it is the only mode that promises anonymity — a small cohort is told the counts are
# withheld rather than being shown a number that quietly identifies somebody.
#
# Two is the smallest honest threshold: with two others, a count of 1 is genuinely ambiguous. It does
# not save a UNANIMOUS count, where everybody is identified at any cohort size — that is inherent to
# aggregates and is said out loud in the UI rather than pretended away.
MIN_PEERS_FOR_ANONYMOUS_COUNTS = 2

# How somebody gets in. Two honest answers, and the difference is real: a reading group wants anyone
# who turns up; a small course with twelve seats and prerequisites wants to choose. Not a boolean,
# so a third policy (an invite code, say) is a value rather than a schema change.
ENROLLMENT_POLICY_CHOICES = [
    ('open', 'Anyone may join immediately'),
    ('approval', 'The instructor approves each request'),
]

ENROLLMENT_STATUS_CHOICES = [
    # Only ever reachable under the `approval` policy — an open course never parks anybody here.
    ('pending', 'Awaiting approval'),
    ('active', 'Taking part'),
    # Deliberately three separate endings rather than one 'inactive', because who ended it and why
    # is exactly what an instructor and a participant each need to see later, and a single flag
    # would throw that away. They also behave differently: someone who left may re-join, someone
    # removed may not, and a declined request is a decision rather than an absence.
    ('left', 'Left'),
    ('declined', 'Request declined'),
    ('removed', 'Removed by the instructor'),
]

# Who may run a course alongside the person who created it. A course is frequently taught by more
# than one person — a lecturer and two TAs — and before this the model had exactly one instructor, so
# a co-teacher either shared a password or did not exist.
#
# Three levels rather than a boolean `is_admin`, because the interesting distinction in practice is
# not "trusted or not" but *which* job somebody was brought in to do: an assistant marks and curates
# content, an admin also changes the course itself and who runs it. Two booleans would make a fourth,
# meaningless state representable, the same reasoning `status` already records.
STAFF_ROLE_CHOICES = [
    # Exactly one per course, always the creator, and never removable — somebody has to be able to
    # delete the course and to be the last one who can grant roles back. Held as a real row (rather
    # than implied by Course.instructor alone) so one query answers "what is this person to
    # this course", with no special case for the owner at every call site.
    ('owner', 'Owner'),
    # Everything the owner can do except deleting the course and removing the owner.
    ('admin', 'Administrator'),
    # Content and participants, but not the course's own settings or its staff list.
    ('assistant', 'Assistant'),
]

#: Roles that may change the course itself, its staff and its invite links.
ADMINISTERING_ROLES = frozenset({'owner', 'admin'})
#: Roles that may curate content and act on participants. A superset of the above on purpose — an
#: owner is not *less* able to edit a lesson than the assistant they hired.
CURATING_ROLES = frozenset({'owner', 'admin', 'assistant'})

# Who may put materials and exercises into this course. The default is the middle one because it is
# what the ask described as the usual case ("if allowed by admin, usually requires approval") and
# because it is the only value that is safe to pick on somebody's behalf: an unattended course does
# not silently accept strangers' uploads, and equally does not silently refuse a participant who
# has something worth adding — their submission simply waits for a human.
CONTRIBUTION_POLICY_CHOICES = [
    ('staff', 'Only the people running the course'),
    ('approval', 'Participants may submit; staff approve each one'),
    ('open', 'Participants may add directly, with no review'),
]

#: Policies under which somebody who is merely a participant may submit anything at all.
PARTICIPANT_CONTRIBUTION_POLICIES = frozenset({'approval', 'open'})

# The lifecycle of one piece of content offered to a course. `pending` only ever exists under the
# `approval` policy; staff-added content and content added under the `open` policy is born approved,
# so nothing has to remember to auto-approve it later.
CONTRIBUTION_STATUS_CHOICES = [
    ('pending', 'Waiting for review'),
    ('approved', 'In the course'),
    ('rejected', 'Not accepted'),
]

#: The one status whose content is actually part of the course.
VISIBLE_ITEM_STATUSES = frozenset({'approved'})

# What an invite link hands out when somebody follows it. A link that enrols is the common case; a
# link that makes somebody an assistant is how a course adds a TA without the TA first enrolling and
# then being promoted. `owner` is deliberately absent — transferring a course is a decision to make
# about a named person, never something to leave lying in a URL.
INVITE_ROLE_CHOICES = [
    ('participant', 'Joins as a participant'),
    ('assistant', 'Joins as an assistant'),
    ('admin', 'Joins as an administrator'),
]

#: Enrolments that occupy a seat and see participant-only content.
ACTIVE_ENROLLMENT_STATUSES = frozenset({'active'})
#: Enrolments that block a second request from the same person — a pending request is as blocking as
#: an active one, or somebody could queue ten requests while waiting.
BLOCKING_ENROLLMENT_STATUSES = frozenset({'pending', 'active'})


class Course(models.Model):
    instructor = models.ForeignKey(
        settings.AUTH_USER_MODEL, related_name='courses', on_delete=models.CASCADE
    )
    title = models.CharField(max_length=200)
    summary = models.CharField(max_length=300, blank=True)
    description = models.TextField(blank=True)

    # Discovery, reusing the taxonomy rather than free-text tags: somebody browsing Analiza
    # Matematyczna II should find the courses being run about it, which is the same reasoning
    # `Service.courses` already follows for tutoring listings.
    subjects = models.ManyToManyField(
        'taxonomy.Branch', related_name='courses', blank=True
    )
    field = models.ForeignKey(
        'taxonomy.Discipline',
        related_name='courses',
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
    )

    visibility = models.CharField(
        max_length=12, choices=VISIBILITY_CHOICES, default='only_you'
    )
    status = models.CharField(max_length=12, choices=STATUS_CHOICES, default='open')
    enrollment_policy = models.CharField(
        max_length=12, choices=ENROLLMENT_POLICY_CHOICES, default='open'
    )
    # 0 means no limit, which is genuinely different from "a limit that happens to be large" and is
    # the honest default for a reading group nobody intends to cap.
    capacity = models.PositiveSmallIntegerField(default=0)
    # Total bytes of material attached to this course, 0 meaning uncapped — the same convention
    # `capacity` above already uses, so "no limit" reads identically on both. Set by an administrator
    # rather than by the instructor: it is a cost control on the platform, not a teaching decision.
    upload_quota_bytes = models.PositiveBigIntegerField(default=0)

    language = models.CharField(max_length=8, default='pl')
    starts_on = models.DateField(null=True, blank=True)
    ends_on = models.DateField(null=True, blank=True)

    # Display-only, exactly like `Service.hourly_rate`: this project has no payment processing
    # anywhere, so a price is information a prospective participant sees before deciding, never
    # something the platform collects. Null means the instructor said nothing; 0 means free, and the
    # two are not the same statement.
    price = models.DecimalField(max_digits=8, decimal_places=2, null=True, blank=True)
    currency = models.CharField(max_length=3, default='PLN', blank=True)

    # --- what this course announces, and to whom -------------------------------------------------
    # Per-course rather than only per-account, because the right answer genuinely differs by course:
    # a ten-week seminar posting one lesson a week should announce each one, and a busy reading group
    # posting daily should not. The instructor knows which of those they are running; nobody else
    # can. Each defaults to the behaviour somebody would expect if they never opened the settings.
    discussion_mode = models.CharField(
        max_length=12, choices=DISCUSSION_MODE_CHOICES, default='participants'
    )
    announce_new_lessons = models.BooleanField(default=True)
    announce_new_posts = models.BooleanField(default=True)

    # Who sees how far everybody has got — see PROGRESS_VISIBILITY_CHOICES. Changing it is an
    # administrator's decision rather than an assistant's, because it is a promise made to every
    # participant about their own data, not a piece of course content.
    progress_visibility = models.CharField(
        max_length=16, choices=PROGRESS_VISIBILITY_CHOICES, default='shared_anonymous'
    )

    # Whether participants may contribute materials and exercises, and whether those wait for review.
    # See CONTRIBUTION_POLICY_CHOICES for why 'approval' is the default rather than 'staff'.
    contribution_policy = models.CharField(
        max_length=12, choices=CONTRIBUTION_POLICY_CHOICES, default='approval'
    )

    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ['-created_at']

    def __str__(self) -> str:
        return self.title

    def save(self, *args, **kwargs):
        """Creating a course also seats its creator as owner.

        Here rather than in the viewset, because "every course has exactly one owner" is an invariant
        of the model and not of one code path: seed commands, the Django admin, fixtures and tests
        all create courses too, and every one of them would otherwise produce a course that nobody —
        including its own author — has any permission over, since `role_of` reads `CourseStaff` alone.

        `get_or_create` rather than `create` so re-saving is not an error, and so a course whose owner
        row already exists (the data migration's work, or a transfer) is left exactly as it is.
        """
        creating = self._state.adding
        super().save(*args, **kwargs)
        if creating and self.instructor_id:
            CourseStaff.objects.get_or_create(
                course=self, user_id=self.instructor_id, defaults={'role': 'owner'}
            )

    def clean(self):
        if self.starts_on and self.ends_on and self.ends_on < self.starts_on:
            raise ValidationError({'ends_on': 'A course cannot end before it starts.'})

    @property
    def is_public(self) -> bool:
        """Listed in the public directory. NOT the same as reachable — see `is_reachable`, which is
        the one to check when deciding whether a given person may open this course."""
        return self.visibility in LISTED_VISIBILITIES

    @property
    def is_reachable(self) -> bool:
        """Openable by somebody who is not staff on it, given a link or a place on the roster."""
        return self.visibility in REACHABLE_VISIBILITIES

    @property
    def uploaded_bytes(self) -> int:
        """Total bytes this course has stored — its materials AND its attachments.

        Both, deliberately. A quota that counted only one kind would be one somebody could route
        around by uploading the other, which is not a quota. This was actually wrong for a while:
        attachments were charged against `upload_quota_bytes` on the way in but never counted on the
        way out, so the cap silently stopped applying after the first file.

        Summed live rather than kept as a running total on the row: a stored counter has to be
        correct after every add, every removal and every failed upload, and this is read on a
        handful of admin and upload paths rather than on anything hot.
        """
        total = 0
        for item in self.items.select_related('material').all():
            material_file = getattr(getattr(item, 'material', None), 'file', None)
            if not material_file:
                continue
            try:
                total += material_file.size
            except (OSError, ValueError):
                # A row whose file is missing from storage must not take the whole course page down;
                # it contributes nothing to the total, which is the honest reading of "not there".
                continue
        for attachment in self.attachments.all():
            total += attachment.size_bytes
        return total

    @property
    def upload_bytes_left(self) -> int | None:
        """None when uncapped — deliberately not 0, which would read as "full", the same distinction
        `seats_left` already draws for capacity."""
        if not self.upload_quota_bytes:
            return None
        return max(self.upload_quota_bytes - self.uploaded_bytes, 0)

    @property
    def active_participant_count(self) -> int:
        return self.enrollments.filter(status__in=ACTIVE_ENROLLMENT_STATUSES).count()

    @property
    def seats_left(self) -> int | None:
        """None when uncapped — deliberately not 0, which would read as "full"."""
        if not self.capacity:
            return None
        return max(self.capacity - self.active_participant_count, 0)

    @property
    def is_full(self) -> bool:
        return self.capacity > 0 and self.active_participant_count >= self.capacity

    # --- who this person is to this course -------------------------------------------------------
    # One lookup answering "what are you here", and three predicates over it, so no call site ever
    # spells out a set of roles for itself. Before multi-admin existed every one of these was an
    # inline `course.instructor_id == user.pk`, scattered across the viewset — which is exactly the
    # shape that goes wrong when a second kind of privileged person appears, because each site has
    # to be found and changed by hand.

    def role_of(self, user) -> str | None:
        """This person's staff role, or None if they do not run this course.

        Iterates the related rows rather than filtering, so a prefetched list of courses answers this
        without a query each — the same reason `CourseSerializer._my_enrollment` walks
        `enrollments.all()` instead of calling `.filter()`.
        """
        if not user or not getattr(user, 'is_authenticated', False):
            return None
        for row in self.staff.all():
            if row.user_id == user.pk:
                return row.role
        return None

    def can_administer(self, user) -> bool:
        """Change the course itself, its staff, and its invite links."""
        return self.role_of(user) in ADMINISTERING_ROLES

    def can_curate(self, user) -> bool:
        """Edit content and act on participants. Every administrator can also do this."""
        return self.role_of(user) in CURATING_ROLES

    def is_staff_member(self, user) -> bool:
        return self.role_of(user) is not None

    def is_participant(self, user) -> bool:
        if not user or not getattr(user, 'is_authenticated', False):
            return False
        for enrollment in self.enrollments.all():
            if enrollment.participant_id == user.pk:
                return enrollment.status in ACTIVE_ENROLLMENT_STATUSES
        return False

    def is_member(self, user) -> bool:
        """In the room in any capacity — running it or taking it.

        The question most content checks actually want: a course's staff are not on its roster, so
        asking only `is_participant` would hide a course's own material from the person who put it
        there.
        """
        return self.is_staff_member(user) or self.is_participant(user)

    def can_contribute(self, user) -> bool:
        """Whether this person may offer a material or an exercise to this course at all."""
        if self.can_curate(user):
            return True
        if self.contribution_policy not in PARTICIPANT_CONTRIBUTION_POLICIES:
            return False
        return self.is_participant(user)

    def contribution_needs_approval(self, user) -> bool:
        """Whether what they add waits for a human.

        Staff never queue behind themselves — approving your own upload is a click that means
        nothing, and leaving staff submissions pending would make the review queue mostly noise.
        """
        if self.can_curate(user):
            return False
        return self.contribution_policy == 'approval'

    def discussion_visible_to(self, user) -> bool:
        """Whether this person may READ the thread. Posting is a separate, stricter question — see
        `discussion_writable_by` — because "anyone can read" is a reasonable thing for an instructor
        to want and "anyone can post" is generally not."""
        if self.discussion_mode == 'off':
            return False
        if self.discussion_mode in PUBLICLY_READABLE_DISCUSSION:
            return True
        if not user or not user.is_authenticated:
            return False
        return self.is_member(user)

    def discussion_writable_by(self, user) -> bool:
        """Only the people actually in the course, in every mode. A public thread is public to
        read; letting strangers post into somebody's course would make it a different feature."""
        if self.discussion_mode == 'off':
            return False
        if not user or not user.is_authenticated:
            return False
        return self.is_member(user)

    # --- who sees how far people have got --------------------------------------------------------
    # Four predicates rather than one, because the four questions have genuinely different answers in
    # the middle two modes: under `private` you may record and read your own and staff may not read
    # it, and under `shared_anonymous` everybody reads the counts while only staff read the names.
    # A single `can_see_progress` would collapse exactly the distinctions the modes exist to draw.

    def progress_writable_by(self, user) -> bool:
        """Whether this person may record their own progress.

        Participants only — deliberately NOT `is_member`, which would include staff. A tracker
        measures how a cohort is getting on, and the people running the course are not in the cohort;
        a staff row would sit in the counts as an extra nobody can interpret, and would make the
        denominator ("of how many?") a different number from the roster.
        """
        if self.progress_visibility == 'off':
            return False
        return self.is_participant(user)

    def progress_visible_to(self, user) -> bool:
        """Whether this person sees ANY of it, including their own row.

        `off` blinds staff too. That is the point of the setting rather than an oversight: an
        instructor who turns tracking off has told their participants nobody is watching, and a
        version of "off" that still showed the instructor everything would make that untrue.
        """
        if self.progress_visibility == 'off':
            return False
        return self.is_member(user)

    def progress_peers_visible_to(self, user) -> bool:
        """Whether they learn anything about anybody else — as counts or as names."""
        if self.progress_visibility not in PEER_VISIBLE_PROGRESS:
            return False
        return self.is_member(user)

    def progress_names_visible_to(self, user) -> bool:
        """Whether they see WHO is where.

        Staff see names in `shared_anonymous` as well as in `shared_named`: somebody has to be able
        to act on "one person is stuck", and anonymity there is a promise made to the room, not to
        the person teaching it. It does not survive `off` or `private`, where the promise is broader.
        """
        if self.progress_visibility == 'shared_named':
            return self.is_member(user)
        if self.progress_visibility == 'shared_anonymous':
            return self.can_curate(user)
        return False

    def enrollment_block_reason(self, user) -> str | None:
        """Why this person cannot join, or None if they can.

        One place, returning the actual reason rather than a bare boolean, because both the API and
        the UI need to *say* why — "this course is full" and "you have already asked to join" are
        the same refusal to a boolean and completely different to a person.
        """
        if not user or not user.is_authenticated:
            return 'authentication_required'
        # Anybody running the course, not just its owner: an assistant is already in the room, and
        # letting them also occupy a participant seat would double-count them against capacity.
        if self.is_staff_member(user):
            return 'instructor_cannot_enrol'
        # Checked before `status`, because it is the stronger refusal: a course nobody outside its
        # staff can even see is not "not open yet", it is not on offer at all. A private course is
        # deliberately absent from this guard — being handed a link IS how you join one.
        if not self.is_reachable:
            return 'not_open'
        if self.status not in ENROLLING_STATUSES:
            return 'not_open'
        existing = self.enrollments.filter(participant=user).first()
        if existing and existing.status in BLOCKING_ENROLLMENT_STATUSES:
            return 'already_enrolled'
        if existing and existing.status == 'removed':
            # Someone the instructor removed does not get to re-join by pressing the button again.
            return 'removed'
        if self.is_full:
            return 'full'
        return None


class Lesson(models.Model):
    """One session within a chapter — the middle level of a course's contents.

    A course reads Chapter -> Lesson -> CourseItem: "Week 3" holds "Tuesday's session", which holds
    the exercises and materials worked through in it.

    **This model used to sit beside Chapter rather than inside it**, and the two were near-duplicates
    — both hung off the course with a title, a description and an order, and both grouped content.
    They differed only in how: Lesson pointed at exercises and materials with two direct M2Ms, while
    Chapter grouped `CourseItem` rows, which also carry a review status and a submitter. Only the
    Chapter half was ever rendered; the Lesson half had serializers, viewset actions and frontend
    service functions, and nothing displayed it.

    So the duplication is resolved by nesting rather than by deleting either one: Lesson becomes the
    subchapter that a course actually needs, and content stays in `CourseItem`, which is the
    mechanism that can express "a participant offered this and it is waiting for review".

    Content is *referenced*, never copied: a lesson's items point at exercises and materials that
    already exist in this app, so a corrected exercise stays corrected everywhere and nothing here
    becomes a second, silently diverging copy of the corpus.
    """

    # A string reference because `Chapter` is declared further down this file. Left in place rather
    # than reordering the module: the declaration order here follows the order these models were
    # added, and moving a class to satisfy a name lookup Django resolves lazily anyway would make
    # the diff look like a rewrite.
    chapter = models.ForeignKey('Chapter', related_name='lessons', on_delete=models.CASCADE)
    title = models.CharField(max_length=200)
    description = models.TextField(blank=True)
    order = models.PositiveIntegerField(default=0)

    # A scheduled time is optional on purpose: plenty of courses are a sequence of units people work
    # through at their own pace, and forcing a date would make those lie.
    scheduled_at = models.DateTimeField(null=True, blank=True)
    duration_minutes = models.PositiveSmallIntegerField(null=True, blank=True)

    # Lesson notes visible only to active participants (and the instructor). The public course page
    # shows a lesson's title and description so somebody can judge whether to join; this is the part
    # that is actually worth joining for.
    participant_notes = models.TextField(blank=True)

    class Meta:
        ordering = ['order', 'id']

    def __str__(self) -> str:
        return f'{self.chapter.course.title} — {self.chapter.title} — {self.title}'

    @property
    def course(self):
        """The course this belongs to, through its chapter.

        A property rather than a denormalized column: a lesson's course is never independently
        settable, and a second copy of it is a second thing that can disagree with the first.
        """
        return self.chapter.course

    def is_visible_to(self, user) -> bool:
        """A lesson is as visible as the chapter holding it — the gate lives one level up, because
        "week 3 opens on the 14th" is one decision about a group of sessions."""
        return self.chapter.is_visible_to(user)

    def save(self, *args, **kwargs):
        """Sanitize the two fields that render as Markdown.

        These were safe while the frontend printed them through Svelte's escaping braces — nothing
        could get out of a text node. Rendering them turns them into an injection surface, so the
        server-side pass has to land in the same change as the rendering, not after it. `title` is
        deliberately left alone: it still renders escaped, and running it through the sanitizer
        would mangle an honest "a < b" for no gain.
        """
        from config.sanitize import sanitize_content

        self.description = sanitize_content(self.description)
        self.participant_notes = sanitize_content(self.participant_notes)
        return super().save(*args, **kwargs)


class Enrollment(models.Model):
    course = models.ForeignKey(Course, related_name='enrollments', on_delete=models.CASCADE)
    participant = models.ForeignKey(
        settings.AUTH_USER_MODEL, related_name='enrollments', on_delete=models.CASCADE
    )
    status = models.CharField(
        max_length=12, choices=ENROLLMENT_STATUS_CHOICES, default='active'
    )
    # Free text from the person asking to join, and only meaningful under the `approval` policy —
    # an instructor choosing between applicants needs something to choose on.
    request_note = models.CharField(max_length=500, blank=True)

    # "Stay in the course, stop hearing about it" — deliberately its own per-course flag rather than
    # only an account-wide switch, mirroring `exercises.TagFollow.notify` exactly: muting one busy
    # course should not cost somebody notifications from every other one, and leaving the course
    # entirely is far too blunt an instrument for "this thread is noisy".
    notify = models.BooleanField(default=True)

    requested_at = models.DateTimeField(auto_now_add=True)
    decided_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        ordering = ['requested_at']
        # One row per person per course, reused as they leave and re-join, rather than a growing
        # pile of historical rows. That keeps "am I in this course?" a single lookup with a single
        # answer — a history table would be a different feature, and would need its own retention
        # answer given telemetry's existing rules.
        constraints = [
            models.UniqueConstraint(
                fields=['course', 'participant'], name='unique_enrollment_per_course'
            )
        ]

    def __str__(self) -> str:
        return f'{self.participant} in {self.course} ({self.status})'


class CourseStaff(models.Model):
    """One person who runs a course, and in what capacity.

    The owner is a real row here, not an implied special case, so `Course.role_of` is one
    lookup with no branch for "…or the instructor field". `Course.instructor` remains as the
    denormalized owner: it is what every existing listing, byline and `mine=teaching` filter already
    reads, and keeping the two in step is far less collateral than rewriting all of them.
    """

    course = models.ForeignKey(Course, related_name='staff', on_delete=models.CASCADE)
    user = models.ForeignKey(
        settings.AUTH_USER_MODEL, related_name='course_staff_roles', on_delete=models.CASCADE
    )
    role = models.CharField(max_length=12, choices=STAFF_ROLE_CHOICES, default='assistant')

    # Who brought them in. Null for the owner row, which nobody added, and for rows created by a
    # data migration — an honest absence rather than attributing it to whoever happened to run it.
    added_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        related_name='course_staff_added',
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
    )
    added_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ['added_at', 'id']
        constraints = [
            models.UniqueConstraint(fields=['course', 'user'], name='unique_staff_per_course'),
            # One owner per course, enforced by the database rather than by whichever view happens
            # to remember. A partial unique index is the right tool: it constrains only the rows
            # where role='owner' and leaves any number of admins and assistants alone.
            models.UniqueConstraint(
                fields=['course'],
                condition=models.Q(role='owner'),
                name='unique_owner_per_course',
            ),
        ]

    def __str__(self) -> str:
        return f'{self.user} — {self.role} of {self.course}'


class Chapter(models.Model):
    """A collection of course content, optionally not readable until a date.

    Time-gating lives here rather than on each item because that is how a course is actually run —
    "week 3 opens on the 14th" is one decision about a group of things, and setting the same date on
    nine items individually is nine chances to get it wrong.

    A chapter with no `unlocks_at` is simply always open, which is genuinely different from one whose
    date has passed: the first was never gated, the second was and no longer is. Nothing in the model
    distinguishes them afterwards because nothing needs to — but the null is why a course that never
    wanted scheduling does not have to invent a date in the past.
    """

    course = models.ForeignKey(Course, related_name='chapters', on_delete=models.CASCADE)
    title = models.CharField(max_length=200)
    description = models.TextField(blank=True)
    order = models.PositiveIntegerField(default=0)

    unlocks_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        ordering = ['order', 'id']

    def __str__(self) -> str:
        return f'{self.course.title} — {self.title}'

    def is_unlocked(self, now=None) -> bool:
        if self.unlocks_at is None:
            return True
        return (now or timezone.now()) >= self.unlocks_at

    def is_visible_to(self, user) -> bool:
        """Staff always see a locked chapter — they are the people who have to prepare it.

        Note this governs the chapter's CONTENT, not its existence: a locked chapter still appears in
        the course with its title and its unlock date, because "there is a week 3 and it opens on the
        14th" is information a participant should have. Hiding the chapter entirely would make a
        course look shorter than it is.
        """
        if self.is_unlocked():
            return True
        return self.course.can_curate(user)

    def save(self, *args, **kwargs):
        """Same reasoning as `Lesson.save` — `description` renders as Markdown now, so it is
        sanitized on the way in rather than trusted to the one client that happens to render it."""
        from config.sanitize import sanitize_content

        self.description = sanitize_content(self.description)
        return super().save(*args, **kwargs)


class CourseItem(models.Model):
    """One piece of content placed in a course.

    Deliberately one model for two jobs that turn out to be the same job: "staff add content to a
    chapter" and "a participant offers content for review" differ only in what `status` starts as.
    Splitting them would mean an approved contribution had to become a different row, losing who
    submitted it — which is the single most useful thing to keep.

    Content is *referenced*, never copied, exactly as `Lesson` already does: a corrected exercise
    stays corrected everywhere, and a course never becomes a silently diverging fork of the corpus.

    **Five kinds, exactly one per row**, because they are genuinely different things a course points
    at and a reader needs to know which they are looking at before clicking: a corpus `material`, a
    corpus `exercise`, an `attachment` (a file belonging to this course — last year's paper, Tuesday's
    slides), an `event` (a one-off happening people turn up to), or a `discussion` — the thread that
    already answered this week's question, wherever in the site it happens to have been asked.

    Five nullable FKs with a check constraint rather than a GenericForeignKey: the set is small,
    closed and known, and every query here wants to join and prefetch the real row, which a generic
    relation cannot do.

    The `discussion` kind is the newest and is the one that needed a rule the other four did not.
    Every other target is a page anybody can open; a comment may be sitting in a thread that is
    private to a course — see `CourseItemWriteSerializer`, which refuses to link one belonging to a
    course other than this one, on exactly the reasoning that already refuses another course's
    attachment. It also points at a **root** comment only: a thread is a conversation, and a link
    into the middle of one is a link to an answer with the question missing.
    """

    course = models.ForeignKey(Course, related_name='items', on_delete=models.CASCADE)
    # Null on BOTH means "in the course but not filed anywhere yet" — which is precisely where a
    # participant's submission sits before somebody decides where it belongs.
    #
    # An item files into a lesson OR straight into a chapter, never both. Both targets are real
    # because both are how courses are actually run: a reading everybody does before week 3 starts
    # belongs to the week, not to any one session in it, while Tuesday's worksheet belongs to
    # Tuesday. Forcing the first into an invented "general" lesson would be a lesson nobody teaches.
    lesson = models.ForeignKey(
        'Lesson', related_name='items', null=True, blank=True, on_delete=models.SET_NULL
    )
    chapter = models.ForeignKey(
        'Chapter', related_name='items', null=True, blank=True, on_delete=models.SET_NULL
    )

    material = models.ForeignKey(
        'materials.Material',
        related_name='course_items',
        null=True,
        blank=True,
        on_delete=models.CASCADE,
    )
    exercise = models.ForeignKey(
        'exercises.Exercise',
        related_name='course_items',
        null=True,
        blank=True,
        on_delete=models.CASCADE,
    )
    # CASCADE like the two above: an attachment lives in this course, so a row pointing at a deleted
    # one is meaningless rather than merely unfiled.
    attachment = models.ForeignKey(
        'Attachment',
        related_name='course_items',
        null=True,
        blank=True,
        on_delete=models.CASCADE,
    )
    # CASCADE too, but for a different reason worth stating: an event is NOT owned by the course —
    # it has its own host and its own page, and a course merely points at it. Deleting the event
    # still has to take the pointer with it, because a course listing a talk that no longer exists
    # is worse than one that never listed it. Cancelling, which is the normal ending for an event,
    # deletes nothing and correctly leaves the link in place saying it is cancelled.
    event = models.ForeignKey(
        'events.Event',
        related_name='course_items',
        null=True,
        blank=True,
        on_delete=models.CASCADE,
    )
    # CASCADE, but note what that does and does not cover: a `Comment` is a tombstone rather than a
    # row delete when its author takes it down (community/models.py), so the ordinary ending for a
    # linked thread deletes nothing here and correctly leaves the link in place — pointing at a
    # thread whose opening post now reads as removed, with its replies intact. That is the honest
    # outcome: the conversation a curator filed is still the conversation, minus one post.
    discussion = models.ForeignKey(
        'community.Comment',
        related_name='course_items',
        null=True,
        blank=True,
        on_delete=models.CASCADE,
    )

    order = models.PositiveIntegerField(default=0)
    note = models.CharField(max_length=500, blank=True)

    status = models.CharField(
        max_length=12, choices=CONTRIBUTION_STATUS_CHOICES, default='approved'
    )
    submitted_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        related_name='course_contributions',
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
    )
    decided_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        related_name='course_contribution_decisions',
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
    )
    decided_at = models.DateTimeField(null=True, blank=True)
    # Why it was refused. Worth a field because "no" without a reason is the complaint every review
    # queue in this project already tries to avoid — see the rejected-application note in CLAUDE.md.
    decision_note = models.CharField(max_length=500, blank=True)

    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ['order', 'created_at', 'id']
        constraints = [
            # Exactly one of the four, enforced by the database. A row with none is meaningless and a
            # row with two is ambiguous about what it even is. Spelled out as four explicit branches
            # rather than something clever: this is the constraint most likely to be read by somebody
            # adding a fifth kind, and it should show them exactly what to write.
            models.CheckConstraint(
                condition=(
                    models.Q(
                        material__isnull=False,
                        exercise__isnull=True,
                        attachment__isnull=True,
                        event__isnull=True,
                        discussion__isnull=True,
                    )
                    | models.Q(
                        material__isnull=True,
                        exercise__isnull=False,
                        attachment__isnull=True,
                        event__isnull=True,
                        discussion__isnull=True,
                    )
                    | models.Q(
                        material__isnull=True,
                        exercise__isnull=True,
                        attachment__isnull=False,
                        event__isnull=True,
                        discussion__isnull=True,
                    )
                    | models.Q(
                        material__isnull=True,
                        exercise__isnull=True,
                        attachment__isnull=True,
                        event__isnull=False,
                        discussion__isnull=True,
                    )
                    | models.Q(
                        material__isnull=True,
                        exercise__isnull=True,
                        attachment__isnull=True,
                        event__isnull=True,
                        discussion__isnull=False,
                    )
                ),
                name='course_item_exactly_one_target',
            ),
            # A lesson already belongs to a chapter, so a row carrying both would be stating the
            # same fact twice with two chances to disagree — and nothing could say which one meant
            # it. Either is allowed to be null: that is an unfiled item.
            models.CheckConstraint(
                condition=models.Q(lesson__isnull=True) | models.Q(chapter__isnull=True),
                name='course_item_one_filing_target',
            ),
            # The same thing cannot be in the same course twice. One partial constraint per kind
            # rather than one over all the columns, because NULLs do not compare equal in SQL — a
            # single (course, material, exercise, ...) unique index would happily allow the same
            # exercise ten times, since `material` is NULL in every one of those rows.
            models.UniqueConstraint(
                fields=['course', 'material'],
                condition=models.Q(material__isnull=False),
                name='unique_material_per_course',
            ),
            models.UniqueConstraint(
                fields=['course', 'exercise'],
                condition=models.Q(exercise__isnull=False),
                name='unique_exercise_per_course',
            ),
            models.UniqueConstraint(
                fields=['course', 'attachment'],
                condition=models.Q(attachment__isnull=False),
                name='unique_attachment_per_course',
            ),
            models.UniqueConstraint(
                fields=['course', 'event'],
                condition=models.Q(event__isnull=False),
                name='unique_event_per_course',
            ),
            models.UniqueConstraint(
                fields=['course', 'discussion'],
                condition=models.Q(discussion__isnull=False),
                name='unique_discussion_per_course',
            ),
        ]

    def __str__(self) -> str:
        return f'{self.course.title} — {self.kind}'

    def clean(self):
        targets = [
            self.material_id,
            self.exercise_id,
            self.attachment_id,
            self.event_id,
            self.discussion_id,
        ]
        if sum(1 for t in targets if t) != 1:
            raise ValidationError(
                'An item must reference exactly one material, exercise, attachment, event or '
                'discussion.'
            )
        if self.lesson_id and self.chapter_id:
            raise ValidationError('An item files into a lesson or a chapter, not both.')

    @property
    def kind(self) -> str:
        if self.material_id:
            return 'material'
        if self.exercise_id:
            return 'exercise'
        if self.attachment_id:
            return 'attachment'
        if self.event_id:
            return 'event'
        return 'discussion'

    @property
    def parent_chapter(self):
        """The chapter gating this item, whichever way it was filed.

        One place to ask, so every caller stops having to know that an item reaches its chapter by
        two different routes.
        """
        if self.chapter_id:
            return self.chapter
        if self.lesson_id:
            return self.lesson.chapter
        return None

    def is_visible_to(self, user) -> bool:
        """Approved, and in a chapter that has opened.

        Both halves matter and they fail for different people: a pending item is invisible to
        everyone except staff and whoever submitted it (who should be able to see their own
        submission waiting), while a locked one is invisible to participants but present for staff.
        """
        if self.status not in VISIBLE_ITEM_STATUSES:
            if self.course.can_curate(user):
                return True
            return bool(
                self.submitted_by_id
                and user
                and getattr(user, 'is_authenticated', False)
                and self.submitted_by_id == user.pk
            )
        # Asked of whichever target it was filed into. An item filed straight into a chapter is
        # gated by that chapter exactly as one inside a lesson is — the lock is a statement about
        # the week, and routing around it by filing one level up would make it worthless.
        gate = self.parent_chapter
        if gate and not gate.is_visible_to(user):
            return False
        return self.target_is_available_to(user)

    def target_is_available_to(self, user) -> bool:
        """Whether the thing this item POINTS AT is still something this person may see.

        This was missing, and it is the half nobody notices: a course item is approved and its
        chapter is open, so it rendered — regardless of whether the exercise or material underneath
        it had since been unpublished. A moderator pulling a wrong exercise took it out of the corpus
        and left it listed, by name, in every course that had referenced it. Content here is
        referenced rather than copied (that is the whole design), so a reference has to answer to
        what it references.

        `LessonExerciseSet.visible_exercises` already got this right for a pinned set and its own
        comment notes that this class did not; that gap is now closed rather than merely documented.
        Curators still see it, exactly as they see a pending contribution — the person maintaining
        the week needs to know something in it has been pulled, and hiding it from them would make
        the course look complete when it is not.

        An `Event` is deliberately not gated on its own `status` here: a cancelled event stays
        readable on purpose (see events/models.py — people arranged their week around it), and a
        course that referenced it should keep saying so rather than quietly dropping it.
        """
        if self.course.can_curate(user):
            return True
        if self.exercise_id is not None and not self.exercise.published:
            return False
        if self.material_id is not None and not self.material.published:
            return False
        # An attachment lives in this course rather than in the corpus, so its own visibility is the
        # course's business and is already answered by `Attachment.is_visible_to`.
        if self.attachment_id is not None and not self.attachment.is_visible_to(user):
            return False
        # A linked thread whose opening post has been taken down — by its author, by a moderator, or
        # by the report threshold firing — is dropped for everybody but a curator, exactly as an
        # unpublished exercise is, and for the same reason: the curator is the person who can
        # replace it, and a list that silently got shorter tells them nothing. The thread's replies
        # may well still be there and worth reading; that is not enough to keep a course pointing at
        # it by a title made of words nobody stands behind any more.
        if self.discussion_id is not None and (
            self.discussion.is_removed or self.discussion.auto_hidden_at is not None
        ):
            return False
        return True


class CourseInvite(models.Model):
    """A link that lets somebody into a course without asking.

    The point of an invite is to bypass the queue: following one enrols you immediately even under
    the `approval` policy, because the person who sent it has already made that decision. It does not
    bypass `capacity` — a full course is full, and quietly letting an invited person over the limit
    would break the promise the limit makes to everybody already in.

    Revoking is a timestamp rather than a delete so a link that stops working leaves a trace of who
    killed it and when, and so the row's own use count survives to be looked at.
    """

    course = models.ForeignKey(Course, related_name='invites', on_delete=models.CASCADE)
    token = models.CharField(max_length=64, unique=True, db_index=True)
    role = models.CharField(max_length=12, choices=INVITE_ROLE_CHOICES, default='participant')

    label = models.CharField(max_length=120, blank=True)

    created_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        related_name='course_invites_created',
        null=True,
        on_delete=models.SET_NULL,
    )
    created_at = models.DateTimeField(auto_now_add=True)

    # 0 means unlimited, matching `Course.capacity`'s own convention in this app rather than
    # introducing a second way to say "no limit".
    max_uses = models.PositiveIntegerField(default=0)
    uses = models.PositiveIntegerField(default=0)
    expires_at = models.DateTimeField(null=True, blank=True)
    revoked_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        ordering = ['-created_at']

    def __str__(self) -> str:
        return f'invite to {self.course} ({self.role})'

    @staticmethod
    def new_token() -> str:
        # Not a UUID: this ends up in a URL somebody pastes into a chat, and `token_urlsafe` gives
        # more entropy in fewer characters. 32 bytes because a guessable invite is an open door.
        return secrets.token_urlsafe(32)

    def unusable_reason(self, now=None) -> str | None:
        """Why this link will not work, or None. A reason rather than a boolean for the same purpose
        `enrollment_block_reason` states: "expired" and "already used up" are the same refusal to a
        boolean and completely different to the person holding the link."""
        now = now or timezone.now()
        if self.revoked_at:
            return 'revoked'
        if self.expires_at and now >= self.expires_at:
            return 'expired'
        if self.max_uses and self.uses >= self.max_uses:
            return 'used_up'
        return None

    @property
    def is_usable(self) -> bool:
        return self.unusable_reason() is None


class CourseNote(models.Model):
    """One person's own notes on a course, or on one lesson inside it.

    **Never visible to anybody else, including the people running the course.** That is the whole
    point of the feature and the reason it is a separate model rather than a field on Enrollment:
    an enrolment row is read by staff constantly — the roster, the review queue, the participant
    count — and a private note living on it would be one careless `select_related` away from being
    rendered on somebody else's screen. Here it can only ever be reached through a queryset already
    filtered to `author=request.user`, which is what `CourseNoteViewSet.get_queryset` does.

    Deliberately not `Lesson.participant_notes`, which looks similar and is the opposite thing:
    those are written by staff FOR everybody in the course. These are written by one person for
    themselves.

    `lesson` is nullable because both anchors are real: "notes on this course" is a running page of
    thoughts, and "notes on this session" belongs beside the session. One row per (author, course,
    lesson) so a note is edited rather than accumulated, with a partial constraint for the
    course-level row because NULLs do not compare equal in SQL — without it, a single unique index
    over all three columns would happily allow ten course-level notes per person.
    """

    author = models.ForeignKey(
        settings.AUTH_USER_MODEL, related_name='course_notes', on_delete=models.CASCADE
    )
    course = models.ForeignKey(Course, related_name='notes', on_delete=models.CASCADE)
    lesson = models.ForeignKey(
        Lesson, related_name='notes', null=True, blank=True, on_delete=models.CASCADE
    )
    body = models.TextField(blank=True)

    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ['-updated_at']
        constraints = [
            models.UniqueConstraint(
                fields=['author', 'course', 'lesson'],
                condition=models.Q(lesson__isnull=False),
                name='unique_note_per_lesson',
            ),
            models.UniqueConstraint(
                fields=['author', 'course'],
                condition=models.Q(lesson__isnull=True),
                name='unique_note_per_course',
            ),
        ]

    def __str__(self) -> str:
        where = self.lesson.title if self.lesson_id else self.course.title
        return f'{self.author} — notes on {where}'


class Attachment(models.Model):
    """A file uploaded straight to a course, with its own page, its own reviews and its own thread.

    Distinct from a Material, and the difference is who it is for. A Material is corpus content —
    branch-scoped, discoverable from `/materials`, reviewed by anyone on the site, and it stays
    useful to people who never join this course. An Attachment belongs to the course: last year's
    exam paper, the slide deck from Tuesday, a scan of somebody's notes. It is not corpus, it is not
    discoverable outside the course, and its discussion is a conversation between the people in the
    room rather than a public review thread. Filing those as Materials would put a course's private
    handouts into the site-wide library, which is a different and much worse thing than a missing
    feature.

    Storage is charged to the same `Course.upload_quota_bytes` a Material costs, so the cap an
    administrator sets means "this course may store this much", not "this much per kind of upload"
    — a per-kind cap is one somebody could route around by choosing the other kind.
    """

    course = models.ForeignKey(Course, related_name='attachments', on_delete=models.CASCADE)
    # `validate_attachment_file` wraps the material validator rather than replacing it: a PDF or a
    # `.docx` gets exactly the same checks it always did, while an image additionally gets the
    # decoded-pixel budget the material validator cannot apply because it never decodes anything.
    # The re-encode that strips EXIF is not here — a validator returns nothing — it is in
    # `AttachmentWriteSerializer`. See `courses/attachmentfile.py`.
    file = models.FileField(
        upload_to='course-attachments/', validators=[validate_attachment_file]
    )
    title = models.CharField(max_length=200)
    description = models.TextField(blank=True)

    uploaded_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        related_name='course_attachments',
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
    )
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ['-created_at', 'id']

    def __str__(self) -> str:
        return f'{self.course.title} — {self.title}'

    @property
    def size_bytes(self) -> int:
        """0 for a row whose file has gone missing from storage, matching `Course.uploaded_bytes`.
        A page must not fail to render because a file was deleted underneath it."""
        try:
            return self.file.size
        except (OSError, ValueError):
            return 0

    def is_visible_to(self, user) -> bool:
        """Anyone who can be in the room. An attachment is course material in the ordinary sense —
        it is not gated per-chapter the way `CourseItem` is, because it is not part of the running
        order; it is the pile of files the course keeps."""
        return self.course.is_member(user) or self.course.can_curate(user)


@receiver(post_delete, sender=Attachment)
def _delete_attachment_file(sender, instance, **kwargs):
    """Deleting an attachment deletes its file. It did not, and that made the delete a lie.

    Django's `FileField` deliberately does not remove the file when the row goes — the behaviour was
    taken out precisely because a rolled-back transaction would otherwise have destroyed a file it
    could not restore. So it has to be asked for, and here it should be: the whole point of the
    re-encoding in `attachmentfile.py` is that somebody who realises their photo of a whiteboard
    carries the coordinates of the room can take it down. If the row disappears from the page while
    the bytes stay at a stable, still-servable URL, they have not taken it down — they have only
    stopped being able to find it themselves.

    A signal rather than an override of `delete()`, because a model method is bypassed by exactly the
    two paths that matter most here: a queryset delete, and the cascade when a whole course is
    deleted. Django sends `post_delete` for cascaded rows too, so an attachment's file goes with its
    course.

    `save=False` because the row is already gone; saving it back would be an error. Storage failures
    are swallowed for the same reason `size_bytes` swallows them — a file already missing from
    storage is the outcome this wanted anyway, and raising here would leave the caller believing the
    delete failed when the row is committed either way.
    """
    if not instance.file:
        return
    try:
        instance.file.delete(save=False)
    except (OSError, ValueError):
        pass


class AttachmentReview(models.Model):
    """A star rating and an optional written review on one attachment.

    Its own small model with a direct FK, matching `community.Review` (Exercise),
    `MaterialReview` and `ServiceReview` rather than inventing a generic one — the same restraint
    those three already record: a review never needs to span more than the one content type it was
    built for, so a GenericForeignKey would buy nothing and cost every query a join.
    """

    attachment = models.ForeignKey(Attachment, related_name='reviews', on_delete=models.CASCADE)
    author = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE)
    rating = models.PositiveSmallIntegerField(
        validators=[MinValueValidator(1), MaxValueValidator(5)]
    )
    body = models.TextField(blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ['-created_at']
        # One review per person per attachment, same as every other review model here.
        unique_together = [('attachment', 'author')]

    def __str__(self) -> str:
        return f'{self.rating}★ by {self.author} on {self.attachment}'


class LessonReview(models.Model):
    """A star rating and an optional written review on one lesson.

    Its own small model with a direct FK, matching `AttachmentReview` directly above and
    `community.Review`/`MaterialReview`/`ServiceReview` before it — a review has never needed to
    span more than the one content type it was built for, so a GenericForeignKey would buy nothing
    and cost every query a join. (`Comment` is generic for the opposite reason: a thread genuinely
    does hang off eight different things.)

    What it rates is the session as taught — "was this week's material any good" — not the
    exercises inside it, which carry their own ratings and would otherwise be scored twice.
    """

    lesson = models.ForeignKey(Lesson, related_name='reviews', on_delete=models.CASCADE)
    author = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE)
    rating = models.PositiveSmallIntegerField(
        validators=[MinValueValidator(1), MaxValueValidator(5)]
    )
    body = models.TextField(blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ['-created_at']
        # One review per person per lesson, same as every other review model here.
        unique_together = [('lesson', 'author')]

    def __str__(self) -> str:
        return f'{self.rating}★ by {self.author} on {self.lesson}'

    def save(self, *args, **kwargs):
        from config.sanitize import sanitize_content

        self.body = sanitize_content(self.body)
        return super().save(*args, **kwargs)


class ChapterReview(models.Model):
    """The same, one level up: a rating of a whole week/unit rather than a single session.

    Both exist rather than only one because they answer different questions. "Tuesday's session was
    unclear" and "week 3 as a whole was worth it" are not the same judgement, and folding them
    together would mean a chapter's score was really an average of whichever lessons happened to be
    rated — a number nobody chose.
    """

    chapter = models.ForeignKey(Chapter, related_name='reviews', on_delete=models.CASCADE)
    author = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE)
    rating = models.PositiveSmallIntegerField(
        validators=[MinValueValidator(1), MaxValueValidator(5)]
    )
    body = models.TextField(blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ['-created_at']
        unique_together = [('chapter', 'author')]

    def __str__(self) -> str:
        return f'{self.rating}★ by {self.author} on {self.chapter}'

    def save(self, *args, **kwargs):
        from config.sanitize import sanitize_content

        self.body = sanitize_content(self.body)
        return super().save(*args, **kwargs)


class LessonExerciseSet(models.Model):
    """A whole `study.ExerciseSet` placed in a lesson — "these ten are this week's homework".

    **The membership is PINNED when the set is linked; the exercises themselves are referenced
    live.** Every row in `exercises` is a real FK to `exercises.Exercise`, so a corrected statement,
    a fixed solution or a moderator's unpublish reaches the lesson at once, exactly as it does for
    `CourseItem`. What does NOT travel is a later change to WHICH exercises the set contains.

    That is deliberately a narrower reading of this project's "content is referenced, never copied"
    rule than `Lesson` and `CourseItem` apply, and the reason is that the rule is about the corpus
    and this is not. "A corrected exercise stays corrected everywhere" is a statement about the
    exercise row, and pinning membership keeps it true in full. Which exercises somebody picked is a
    curatorial decision about this course, and an `ExerciseSet` belongs to exactly one person who
    may have no role here at all:

    * Every other write to a lesson's contents goes through `Course.can_curate`. A live link would
      hand somebody outside the course a standing, unreviewed channel into its contents — a
      permission hole rather than a gap in a convention. Under `contribution_policy='approval'` it
      is worse: what a curator approved would keep changing after they approved it.
    * The owner can also unshare the set, delete it, or cut it down to two exercises. Live, each of
      those silently empties or rewrites a week students have already started on. Pinned, none of
      them can — which is why `exercise_set` is SET_NULL rather than CASCADE: a deleted set must
      leave the homework standing.

    Liveness is still available, under the course's own control rather than a stranger's: a curator
    re-copies on demand (`refreshed_at`), and is told when the source has moved on since. The UI
    says all of this in words, in both locales, because a reader must never have to guess which of
    the two kinds of link they are looking at.
    """

    # Filed into a lesson OR straight into a chapter, exactly as `CourseItem` is and for the same
    # reason: a problem set everybody does before week 3 starts belongs to the week, not to whichever
    # session happens to be first in it. The model keeps its `Lesson`-shaped name because renaming it
    # would rewrite six files' worth of imports, related names and a drag-and-drop registry to say
    # something the docstring says better — it is a link from a course to a set, and the level it
    # hangs off is a column.
    lesson = models.ForeignKey(
        Lesson, related_name='exercise_sets', null=True, blank=True, on_delete=models.CASCADE
    )
    chapter = models.ForeignKey(
        'Chapter', related_name='exercise_sets', null=True, blank=True, on_delete=models.CASCADE
    )
    # Provenance and the "update from the source" affordance — never the contents.
    exercise_set = models.ForeignKey(
        'study.ExerciseSet',
        related_name='course_links',
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
    )
    # The set's name as it read when it was copied. Stored rather than resolved through the FK for
    # the same reason the exercises are: the source may be renamed, unshared or deleted, and a
    # lesson whose homework is headed by a blank is worse than one headed by a stale name.
    title = models.CharField(max_length=200)
    note = models.CharField(max_length=500, blank=True)
    order = models.PositiveIntegerField(default=0)

    linked_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        related_name='course_set_links',
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
    )
    linked_at = models.DateTimeField(auto_now_add=True)
    # Null for a link nobody has re-copied — genuinely different from "refreshed at the moment it
    # was linked", and the difference is what tells a curator whether they have looked since.
    refreshed_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        ordering = ['order', 'id']
        constraints = [
            # The same set twice in one lesson is one decision recorded twice with no way to say
            # which is meant. Partial, because NULLs do not compare equal in SQL: once a source set
            # is deleted every surviving link holds `exercise_set = NULL`, and a plain unique index
            # over both columns would then permit exactly one of them to exist.
            models.UniqueConstraint(
                fields=['lesson', 'exercise_set'],
                condition=models.Q(exercise_set__isnull=False),
                name='unique_set_per_lesson',
            ),
            models.UniqueConstraint(
                fields=['chapter', 'exercise_set'],
                condition=models.Q(exercise_set__isnull=False),
                name='unique_set_per_chapter',
            ),
            # One level or the other, never both and never neither. Both null would be a link
            # hanging off nothing, which — unlike an unfiled `CourseItem` — has nowhere to be
            # rendered and no queue to sit in, so it is a row nobody could ever see again.
            models.CheckConstraint(
                condition=(
                    models.Q(lesson__isnull=False, chapter__isnull=True)
                    | models.Q(lesson__isnull=True, chapter__isnull=False)
                ),
                name='lesson_set_exactly_one_parent',
            ),
        ]

    def __str__(self) -> str:
        parent = self.lesson or self.chapter
        return f'{parent.title if parent else "—"} — {self.title}'

    @property
    def parent(self):
        """The lesson or the chapter this hangs off — one place to ask, so callers stop having to
        know a link reaches its course by two routes. Mirrors `CourseItem.parent_chapter`."""
        return self.lesson or self.chapter

    @property
    def course(self):
        return self.lesson.chapter.course if self.lesson_id else self.chapter.course

    def is_visible_to(self, user) -> bool:
        """As visible as the lesson holding it, which is as visible as its chapter.

        The chapter lock is the whole of the gate, exactly as it is for `CourseItem`: staff read a
        locked week early because they are the people preparing it, and a participant does not.
        There is no per-link status to check — a link is placed by a curator and never offered for
        review, so it has no pending state of its own.

        Asked of whichever level it was filed into. A link filed straight into a chapter is gated by
        that chapter exactly as one inside a lesson is, for the reason `CourseItem.is_visible_to`
        already states: the lock is a statement about the week, and routing around it by filing one
        level up would make it worthless.
        """
        return self.parent.is_visible_to(user)

    def visible_exercises(self, user, *, can_curate=None):
        """The pinned rows this viewer should actually be shown.

        Unpublished exercises are dropped for anybody who cannot curate this course. `CourseItem`
        does not make this check and should: an exercise is unpublished when a moderator has pulled
        it, usually because its solution is wrong, which is the single worst thing to leave sitting
        in somebody's homework. Curators keep seeing it, because they are the people who can replace
        it and a list that silently got shorter tells them nothing.

        `can_curate` may be passed in already answered. The question is about the viewer and the
        course, never about this row, so a response rendering a dozen links should ask it once
        rather than a dozen times — `Course.role_of` walks a related manager, and reaching it from
        here goes `lesson -> chapter -> course` and so cannot reuse the caller's own prefetch.
        """
        rows = list(self.exercises.all())
        if self.course.can_curate(user) if can_curate is None else can_curate:
            return rows
        return [row for row in rows if row.exercise.published]


class LessonSetExercise(models.Model):
    """One exercise pinned into a lesson's linked set, in the order it was copied in.

    A through-model carrying its own `order` rather than a plain M2M, mirroring
    `study.ExerciseSetItem` itself: a problem set is a sequence, and Django's automatic join table
    has nowhere to say so.
    """

    link = models.ForeignKey(
        LessonExerciseSet, related_name='exercises', on_delete=models.CASCADE
    )
    exercise = models.ForeignKey(
        'exercises.Exercise', related_name='course_set_links', on_delete=models.CASCADE
    )
    order = models.PositiveIntegerField(default=0)

    class Meta:
        ordering = ['order', 'id']
        unique_together = [('link', 'exercise')]

    def __str__(self) -> str:
        return f'{self.link.title} — {self.exercise}'


class LessonProgress(models.Model):
    """One participant's own statement about one lesson: working on it, stuck, or done.

    **It is a statement, not a measurement.** Nothing here is inferred from what somebody opened or
    how long they spent on it — a tracker that watched would be surveillance wearing a progress bar's
    clothes, and it would also be wrong, since reading a lesson and understanding it are different
    events. The row exists because a person pressed a button saying so.

    **Only the participant writes their own row.** Staff never mark somebody complete: a progress
    entry is the participant speaking about themselves, and an instructor writing into it would be
    putting words in their mouth — and would make "3 of 6 have finished" a claim nobody in that 3
    necessarily made. Staff READ it (in every mode but `off` and `private`), which is what makes the
    feature useful to them.

    **"Not started" is the absence of a row.** See LESSON_PROGRESS_STATUS_CHOICES: one representation
    of "I have not said anything", so nothing ever has to reconcile a missing row against a row
    saying nothing. Resetting deletes.

    Who may SEE any of this is `Course.progress_visibility` and lives on the course, not here — it is
    one decision about the whole course, exactly as `Chapter.unlocks_at` is one decision about a group
    of sessions rather than a field repeated on each one.
    """

    lesson = models.ForeignKey(Lesson, related_name='progress', on_delete=models.CASCADE)
    participant = models.ForeignKey(
        settings.AUTH_USER_MODEL, related_name='lesson_progress', on_delete=models.CASCADE
    )
    status = models.CharField(max_length=12, choices=LESSON_PROGRESS_STATUS_CHOICES)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ['-updated_at']
        # One row per person per lesson — the same shape every review model here uses, and for the
        # same reason: a second row would be a second answer to a question that has one.
        unique_together = [('lesson', 'participant')]

    def __str__(self) -> str:
        return f'{self.participant} — {self.lesson.title}: {self.status}'


# --- covers / requires claims -------------------------------------------------------------------
#
# The same claims a material carries (`materials.ClaimBase`): "this course teaches topic X to
# depth Y" and "you should know topic X to depth Y before joining". Topics come from the course's
# own `subjects` (its taxonomy branches). Anybody signed in who can see the course may propose one;
# the community corrects the level, ranks the order, and discusses each in its own thread. The
# vote and importance-vote rows mirror `MaterialCoverageVote`/`MaterialCoverageImportanceVote`
# exactly, and the request handling is shared in `materials/claims.py`.

from materials.models import ClaimBase, VOTE_CHOICES  # noqa: E402 — courses already depends on materials


class CourseClaim(ClaimBase):
    course = models.ForeignKey(Course, related_name='claims', on_delete=models.CASCADE)

    class Meta:
        unique_together = [('course', 'kind', 'topic', 'subtopic')]
        ordering = ['topic', 'subtopic']

    def __str__(self) -> str:
        sub = f'/{self.subtopic.slug}' if self.subtopic else ''
        return f'{self.course}@{self.kind}:{self.topic.slug}{sub}={self.level}'


class CourseClaimVote(models.Model):
    claim = models.ForeignKey(CourseClaim, related_name='votes', on_delete=models.CASCADE)
    voter = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE)
    value = models.SmallIntegerField(choices=VOTE_CHOICES)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        unique_together = [('claim', 'voter')]


class CourseClaimImportanceVote(models.Model):
    claim = models.ForeignKey(CourseClaim, related_name='importance_votes', on_delete=models.CASCADE)
    voter = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE)
    value = models.SmallIntegerField(choices=[(1, 'More important'), (-1, 'Less important')])
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        unique_together = [('claim', 'voter')]
