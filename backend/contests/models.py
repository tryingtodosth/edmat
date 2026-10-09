"""Contests (*konkursy*) — a staged competition somebody organises, a jury scores, and results close.

**Why this is not an event and not a course.** EdMat already has two things people run together
over a span of time: a course (`courses.Course`, taught over weeks to a roster) and an event
(`events.Event`, one happening people turn up to). A contest is a third shape with one property
neither has: **the participants are judged, and the judging produces a ranking** — a laureate, a
finalist, a distinction — that outlives the contest and that Polish law attaches real consequences
to (CONTESTS-LAW.md: a *przyrzeczenie publiczne* under KC art. 919–921 once a prize is promised, a
complaints window, tax on the prize, a kurator's regulation for a school *konkurs przedmiotowy*).
A course has no jury; an event has no ranking. What a contest shares with them — a roster, a
venue for its final, documents, a rota of volunteers, tasks, plans, goals, needs, polls,
attachments, flashcards, a discussion — it gets by being a **node** (`config/nodes.py`, kind
`contest`), not by copying any of it.

**What the prep commit fixed, and what the two builders add.** This file holds the two rows the
node seam needs to answer "may this person see it" and "where do they stand on it": the contest
itself and its staff. Everything a contest *does* — stages with problems drawn from the exercise
corpus, registrations with a guardian's consent, submissions, jury scores, published results,
complaints, the regulamin — is step A's (`prompts/18-contests-a-core.md`), in this app, migrations
`0002+`. The presets (`presets.py`), the personalisation of every other module to this use case
(`personalize.py`) and the registries in other apps are step B's (`prompts/19-contests-b-personalise.md`),
which adds **no** migration to this app.

The lifecycle is one `status` field (root CLAUDE.md, shape 4), and the order of its values is the
order a contest moves through them:

    draft → announced → registration_open → running → judging → results_published → closed
                                                 ↘ cancelled (from anything but closed)

`results_published` is the one that matters legally: it starts the complaints window, and step A's
`rules.py` is where "may results be published" (every stage scored, a regulamin exists) lives.
"""

from django.conf import settings
from django.db import models
from django.utils import timezone

from config.audience import AUDIENCE_CHOICES, DEFAULT_AUDIENCE
from config.sanitize import sanitize_content

#: Mirrored in `frontend/src/lib/utils/labels.ts` (house rule 13) — say so there too.
STATUS_CHOICES = [
    ('draft', 'Draft — visible to its staff only'),
    ('announced', 'Announced — the regulamin is public, registration not yet open'),
    ('registration_open', 'Registration open'),
    ('running', 'Running — at least one stage is open'),
    ('judging', 'Judging — every stage closed, scores being entered'),
    ('results_published', 'Results published — the complaints window is open'),
    ('closed', 'Closed — complaints decided, prizes handed over'),
    ('cancelled', 'Cancelled'),
]
#: The states in which a contest exists for somebody who is not on its staff. One definition, so
#: "is this public?" cannot drift between the queryset filter and `access.can_view`.
PUBLIC_STATUSES = frozenset(
    {'announced', 'registration_open', 'running', 'judging', 'results_published', 'closed', 'cancelled'}
)
#: The one state that accepts a registration.
REGISTRABLE_STATUSES = frozenset({'registration_open'})

VISIBILITY_CHOICES = [
    ('private', 'Only its staff, until announced'),
    ('public', 'Anyone'),
]
PUBLIC_VISIBILITY = frozenset({'public'})

#: Role presets, never a permission editor (MANAGEMENT-BRIEF.md §1). `organiser` runs it; `jury`
#: scores and nothing else; `proctor` supervises a stage (sees submissions, cannot score);
#: `secretary` handles registrations and complaints but does not score. The organiser who founded
#: it (`Contest.organiser`) is an organiser whether or not a staff row says so, the way an event's
#: host is.
STAFF_ROLE_CHOICES = [
    ('organiser', 'Organiser'),
    ('jury', 'Jury member'),
    ('proctor', 'Proctor'),
    ('secretary', 'Secretary'),
]
ORGANISING_ROLES = frozenset({'organiser'})
SCORING_ROLES = frozenset({'organiser', 'jury'})


class Contest(models.Model):
    title = models.CharField(max_length=200)
    #: Markdown + HTML passthrough like every other body; sanitized in `save()` so the admin is
    #: covered too (`config/sanitize.py`).
    description = models.TextField(blank=True)
    #: A key into `contests/presets.py: PRESETS`. A plain string rather than `choices`, so that a
    #: preset can be added or renamed without a migration; the serializer validates it.
    preset_key = models.CharField(max_length=40, blank=True)
    organiser = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.PROTECT, related_name='contests_organised'
    )
    #: The body standing behind it, if any — a school, a faculty, a student circle. Informational
    #: plus a badge, like every `organizations.OrganizationLink`; it grants nothing.
    organization = models.ForeignKey(
        'organizations.Organization',
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
        related_name='contests',
    )
    status = models.CharField(max_length=20, choices=STATUS_CHOICES, default='draft')
    visibility = models.CharField(max_length=10, choices=VISIBILITY_CHOICES, default='private')
    audience = models.CharField(max_length=20, choices=AUDIENCE_CHOICES, default=DEFAULT_AUDIENCE)
    #: Whether an under-16 may register at all. When true, step A's registration requires a
    #: guardian's consent (CONTESTS-LAW.md §4) and the minors rules in `accounts/minors.py` still
    #: apply to every free-text channel.
    allows_minors = models.BooleanField(default=False)
    starts_at = models.DateTimeField(null=True, blank=True)
    ends_at = models.DateTimeField(null=True, blank=True)
    registration_opens_at = models.DateTimeField(null=True, blank=True)
    registration_closes_at = models.DateTimeField(null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ['-created_at']

    def __str__(self):
        return self.title

    def save(self, *args, **kwargs):
        self.description = sanitize_content(self.description)
        super().save(*args, **kwargs)

    # ---- standing — thin, and answered by `access.py` so the node seam and the views agree ----

    def role_of(self, user) -> str | None:
        from . import access

        return access.role_of(user, self)

    def is_staff_member(self, user) -> bool:
        return self.role_of(user) is not None

    def can_organise(self, user) -> bool:
        return self.role_of(user) in ORGANISING_ROLES

    @property
    def is_public(self) -> bool:
        return self.status in PUBLIC_STATUSES and self.visibility in PUBLIC_VISIBILITY

    @property
    def is_past(self) -> bool:
        return self.ends_at is not None and self.ends_at < timezone.now()


class ContestStaff(models.Model):
    contest = models.ForeignKey(Contest, on_delete=models.CASCADE, related_name='staff')
    user = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name='contest_staff_roles'
    )
    role = models.CharField(max_length=12, choices=STAFF_ROLE_CHOICES, default='jury')
    added_by = models.ForeignKey(
        settings.AUTH_USER_MODEL, null=True, blank=True, on_delete=models.SET_NULL, related_name='+'
    )
    added_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        constraints = [
            models.UniqueConstraint(fields=['contest', 'user'], name='contests_one_role_per_person'),
        ]
        ordering = ['added_at']

    def __str__(self):
        return f'{self.user} as {self.role} on {self.contest}'
