"""Courses run by users, and the people taking part in them.

**On the name.** `taxonomy.Course` already exists and means something else entirely — a *przedmiot*,
a university subject like Analiza Matematyczna II, which nobody runs and nobody enrols in. What this
module adds is the other Polish word: a *kurs*, something a person teaches over time to a group who
sign up for it. Two different concepts that English collapses onto one word, so the model here is
`TaughtCourse` and the app is `classroom`. Renaming `taxonomy.Course` to `Subject` would arguably be
the tidier fix, but it reaches into migrations, the corpus importer, the API and the frontend's own
`/courses/[course]` routes — far too much collateral for a naming preference, so the new thing takes
the new name. In the UI both are simply called what a person calls them ("course" / "kurs"), since a
visitor never sees a class name.

Everything here reuses machinery this project already has rather than inventing parallel versions:
the taxonomy for discovery, existing exercises and materials as lesson content, the feature-flag kill
switch, and the same "public GET, owner-scoped writes" split `Service` and `ExerciseSet` established.
"""

from django.conf import settings
from django.core.exceptions import ValidationError
from django.db import models

# A course's own lifecycle, as its instructor drives it. Deliberately a single field rather than a
# pair of booleans (`is_published`/`is_finished`): two booleans make an illegal state representable
# — finished but never published — that every read site would then have to defend against, the same
# reasoning `Service.delivery_mode` already records for its own three-way choice.
STATUS_CHOICES = [
    # Visible only to its instructor. Every course starts here, so nothing is ever published by the
    # act of creating it.
    ('draft', 'Draft'),
    # Listed publicly, and taking enrolments.
    ('open', 'Open for enrolment'),
    # Listed and running, but closed to new participants. A distinct state from `finished`, because
    # people are still actively taking part.
    ('running', 'Running, enrolment closed'),
    ('finished', 'Finished'),
]

#: The states in which a course is visible to anybody other than its instructor. One definition, so
#: "is this public?" can never drift between the queryset filter and a permission check.
PUBLIC_STATUSES = frozenset({'open', 'running', 'finished'})
#: The one state that accepts new participants.
ENROLLING_STATUSES = frozenset({'open'})

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

#: Enrolments that occupy a seat and see participant-only content.
ACTIVE_ENROLLMENT_STATUSES = frozenset({'active'})
#: Enrolments that block a second request from the same person — a pending request is as blocking as
#: an active one, or somebody could queue ten requests while waiting.
BLOCKING_ENROLLMENT_STATUSES = frozenset({'pending', 'active'})


class TaughtCourse(models.Model):
    instructor = models.ForeignKey(
        settings.AUTH_USER_MODEL, related_name='taught_courses', on_delete=models.CASCADE
    )
    title = models.CharField(max_length=200)
    summary = models.CharField(max_length=300, blank=True)
    description = models.TextField(blank=True)

    # Discovery, reusing the taxonomy rather than free-text tags: somebody browsing Analiza
    # Matematyczna II should find the courses being run about it, which is the same reasoning
    # `Service.courses` already follows for tutoring listings.
    subjects = models.ManyToManyField(
        'taxonomy.Course', related_name='taught_courses', blank=True
    )
    field = models.ForeignKey(
        'taxonomy.Field',
        related_name='taught_courses',
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
    )

    status = models.CharField(max_length=12, choices=STATUS_CHOICES, default='draft')
    enrollment_policy = models.CharField(
        max_length=12, choices=ENROLLMENT_POLICY_CHOICES, default='open'
    )
    # 0 means no limit, which is genuinely different from "a limit that happens to be large" and is
    # the honest default for a reading group nobody intends to cap.
    capacity = models.PositiveSmallIntegerField(default=0)

    language = models.CharField(max_length=8, default='pl')
    starts_on = models.DateField(null=True, blank=True)
    ends_on = models.DateField(null=True, blank=True)

    # Display-only, exactly like `Service.hourly_rate`: this project has no payment processing
    # anywhere, so a price is information a prospective participant sees before deciding, never
    # something the platform collects. Null means the instructor said nothing; 0 means free, and the
    # two are not the same statement.
    price = models.DecimalField(max_digits=8, decimal_places=2, null=True, blank=True)
    currency = models.CharField(max_length=3, default='PLN', blank=True)

    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ['-created_at']

    def __str__(self) -> str:
        return self.title

    def clean(self):
        if self.starts_on and self.ends_on and self.ends_on < self.starts_on:
            raise ValidationError({'ends_on': 'A course cannot end before it starts.'})

    @property
    def is_public(self) -> bool:
        return self.status in PUBLIC_STATUSES

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

    def enrollment_block_reason(self, user) -> str | None:
        """Why this person cannot join, or None if they can.

        One place, returning the actual reason rather than a bare boolean, because both the API and
        the UI need to *say* why — "this course is full" and "you have already asked to join" are
        the same refusal to a boolean and completely different to a person.
        """
        if not user or not user.is_authenticated:
            return 'authentication_required'
        if self.instructor_id == user.pk:
            return 'instructor_cannot_enrol'
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
    """One session or unit within a course.

    Content is *referenced*, never copied: a lesson points at exercises and materials that already
    exist in this app, so a corrected exercise stays corrected everywhere and nothing here becomes a
    second, silently diverging copy of the corpus.
    """

    course = models.ForeignKey(TaughtCourse, related_name='lessons', on_delete=models.CASCADE)
    title = models.CharField(max_length=200)
    description = models.TextField(blank=True)
    order = models.PositiveIntegerField(default=0)

    # A scheduled time is optional on purpose: plenty of courses are a sequence of units people work
    # through at their own pace, and forcing a date would make those lie.
    scheduled_at = models.DateTimeField(null=True, blank=True)
    duration_minutes = models.PositiveSmallIntegerField(null=True, blank=True)

    exercises = models.ManyToManyField('exercises.Exercise', related_name='lessons', blank=True)
    materials = models.ManyToManyField('materials.Material', related_name='lessons', blank=True)

    # Lesson notes visible only to active participants (and the instructor). The public course page
    # shows a lesson's title and description so somebody can judge whether to join; this is the part
    # that is actually worth joining for.
    participant_notes = models.TextField(blank=True)

    class Meta:
        ordering = ['order', 'id']

    def __str__(self) -> str:
        return f'{self.course.title} — {self.title}'


class Enrollment(models.Model):
    course = models.ForeignKey(TaughtCourse, related_name='enrollments', on_delete=models.CASCADE)
    participant = models.ForeignKey(
        settings.AUTH_USER_MODEL, related_name='enrollments', on_delete=models.CASCADE
    )
    status = models.CharField(
        max_length=12, choices=ENROLLMENT_STATUS_CHOICES, default='active'
    )
    # Free text from the person asking to join, and only meaningful under the `approval` policy —
    # an instructor choosing between applicants needs something to choose on.
    request_note = models.CharField(max_length=500, blank=True)

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
