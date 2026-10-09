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

## The transition table, once (step A, 2026-10-09)

`TRANSITIONS` below is the only statement of which status may follow which, and
`rules.transition_block_reason` is the only reader of it. `cancelled` is reachable from everything
but `closed`; `closed` is final; nothing ever goes backwards, because every backwards step would
un-say something a participant has already been told (a registration that was open, a result that
was published). The three timestamps `announced_at`, `results_published_at` and `closed_at` are
written by the transition that earns them and never by hand.

## What step A added, and the two shapes to know before reading the rest

* **Nothing stores a score.** `ContestScore` is one juror's marks for one problem of one
  submission; a submission's points are the MEAN over the jurors who scored each problem, summed
  over problems, recounted on every read (`rules.ranking`, house rule 5). There is no
  `total_points` on a submission, deliberately: a stored total drifts the moment a juror edits a
  cell, and a contest whose ranking disagrees with its own scoring matrix is worse than one that
  takes two `COUNT`s longer to draw.
* **`ContestResult` rows exist only between `publish_results` and `unpublish_results`.** They are
  the frozen, published ranking — the one thing that must not change under a reader who was given
  the link — and `rules.publish_results` is their only writer. Unpublishing deletes them, which is
  allowed only while the complaints window is open.
"""

from datetime import timedelta

from django.conf import settings
from django.contrib.contenttypes.fields import GenericRelation
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

#: Which status may follow which — the one statement of it (`rules.transition_block_reason` is the
#: only reader). `cancelled` from anything but `closed`; `closed` is final; nothing goes backwards.
TRANSITIONS: dict[str, tuple[str, ...]] = {
    'draft': ('announced', 'cancelled'),
    'announced': ('registration_open', 'running', 'cancelled'),
    'registration_open': ('running', 'cancelled'),
    'running': ('judging', 'cancelled'),
    'judging': ('results_published', 'cancelled'),
    'results_published': ('closed', 'cancelled'),
    'closed': (),
    'cancelled': (),
}

#: The timestamp a transition writes, if any. Written by `rules.transition` and nothing else — a
#: hand-set `announced_at` is a date that no longer means "when strangers were first told".
TRANSITION_STAMPS = {
    'announced': 'announced_at',
    'results_published': 'results_published_at',
    'closed': 'closed_at',
}

#: What a reader is told about a winner by default. `initials` is the UODO model regulamin's own
#: default (CONTESTS-LAW.md §4); a full name always rests on `ContestRegistration.publish_name`,
#: which is its own revocable consent and never bundled into entry.
PUBLICATION_CHOICES = [
    ('initials', 'Initials only, unless the participant opts in'),
    ('full_name_opt_in', 'Full name for participants who opt in'),
]

#: The licence a participant grants on their entry. Two presets and no transfer checkbox: a
#: transfer or an exclusive licence needs written form (pr.aut. art. 53), which a checkbox is not
#: (CONTESTS-LAW.md §6; `kc_921_3` is the disputed side of it).
ENTRY_LICENCE_CHOICES = [
    ('none', 'No licence — the author keeps everything; the entry is shown here to run the contest'),
    ('non_exclusive', 'A non-exclusive licence, with the fields of exploitation listed in §11'),
]

#: `prize_regime` — the four values of `presets.PRIZE_REGIMES`, spelled here with their sentences
#: so the admin and the API say the same thing. Mirrored in `labels.ts` (house rule 13).
PRIZE_REGIME_CHOICES = [
    ('none', 'No prize is promised'),
    ('pupil_exempt_115', "Pupils' prizes, education-system basis — exempt without a cap"),
    ('science_68_then_10pct', 'The "science" limb: up to 2 000 zl exempt, 10% above it'),
    ('flat_10pct', '10% withheld, no exemption pleaded'),
]

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
    #: The bilingual title and description (`translations/`, step B's `contest` kind). A
    #: `GenericRelation` and not a column — it is what lets `translations/resolve.py` prefetch the
    #: rows instead of querying once per contest (step B's left-open, closed at integration).
    text_versions = GenericRelation('translations.TextVersion')
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

    # ---- the prize, and everything that exists only because of it -----------------------------
    #: False is the default and the whole point of the `challenge` preset: no prize means no
    #: przyrzeczenie publiczne (KC art. 919 s 1 needs one), no gambling exposure and no PIT, so
    #: every obligation below is unlocked by one deliberate toggle (CONTESTS-LAW.md §13 g).
    has_prize = models.BooleanField(default=False)
    #: **The one hard field in Polish contest law.** KC art. 921 s 1: a promise of a prize for the
    #: BEST work with no deadline within which the prize may be claimed is *bezskuteczne* — the
    #: whole promise, not the deadline. Nullable in the schema because a draft is allowed to be
    #: incomplete; `rules.announce_block_reason` refuses `claim_deadline_missing` rather than the
    #: database doing it, so the organiser is told which field and why.
    prize_claim_deadline = models.DateTimeField(null=True, blank=True)
    prize_description = models.TextField(blank=True)
    #: In zloty, for the TAX COPY ONLY. There is no money anywhere in this module (CONTESTS-BRIEF.md
    #: §6 default 2): no entry fee, no prize pool, no payment. This number exists so the compliance
    #: panel can say "above the 2 000 zl line" and show the gross-up, and for nothing else.
    prize_total_value_pln = models.PositiveIntegerField(null=True, blank=True)
    prize_regime = models.CharField(max_length=24, choices=PRIZE_REGIME_CHOICES, default='none')
    #: Whether the organiser is a *przedsiebiorca*. It unlocks the consumer block (UOKiK's own
    #: register: a 7-day complaint window was held abusive) and nothing else.
    organiser_is_business = models.BooleanField(default=False)

    # ---- identity, law and the regulamin ------------------------------------------------------
    #: The kurator's or komitet glowny's own announcement. Mandatory by rule for the two staff-only
    #: presets (`external_reference_required`): a false "kuratoryjny" claim harms pupils who believe
    #: they are earning an exam exemption (CONTESTS-LAW.md §14 item 9).
    external_reference_url = models.URLField(max_length=500, blank=True)
    entry_licence = models.CharField(max_length=16, choices=ENTRY_LICENCE_CHOICES, default='none')
    #: From the preset; at least 14 unless the preset says 7 (the two kurator ones, where the
    #: regulation's own practice is shorter). `rules.complain_block_reason` reads it.
    complaint_window_days = models.PositiveSmallIntegerField(default=14)
    publication_default = models.CharField(
        max_length=20, choices=PUBLICATION_CHOICES, default='initials'
    )
    #: The merit criteria and their weights, in the organiser's own words. Required to announce:
    #: published criteria are what keeps a contest out of the lottery regime (u.g.h. art. 2 — the
    #: signature of a genuine konkurs is a knowledge task, published criteria, a jury applying them).
    merit_criteria = models.TextField(blank=True)
    #: Who the data controller is, in their own words. GDPR art. 13 wants it named before anybody
    #: enters, and EdMat is the processor, never the controller (LEGAL.md; GDPR art. 28).
    data_controller_name = models.CharField(max_length=200, blank=True)
    data_controller_contact = models.CharField(max_length=300, blank=True)
    #: A contact for participants with special needs. The 2019 accessibility act binds a public
    #: organiser; for a private one this is good practice the presets still ask for.
    accommodation_contact = models.CharField(max_length=300, blank=True)

    # ---- teams, capacity, the preparation course ----------------------------------------------
    team = models.BooleanField(default=False)
    team_size_max = models.PositiveSmallIntegerField(null=True, blank=True)
    #: A cap on accepted registrations, if the organiser wants one. Null means no cap, which is the
    #: usual case for a problem set.
    capacity = models.PositiveIntegerField(null=True, blank=True)
    #: A course people can take to get ready. Informational, like `organization`: it grants nothing
    #: and taking it is never a condition of entry (which would be the first step towards a
    #: *sprzedaz premiowa* reading of the whole thing).
    preparation_course = models.ForeignKey(
        'courses.Course',
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
        related_name='contests_prepared_for',
    )

    # ---- the title thresholds `rules.titles_for` applies --------------------------------------
    #: Percentages of the maximum, the organiser's to set, because "laureate" means whatever the
    #: regulamin says it means and nothing else. The defaults are the kuratoria's usual practice.
    laureate_min_pct = models.PositiveSmallIntegerField(default=90)
    finalist_min_pct = models.PositiveSmallIntegerField(default=75)
    #: How many *distinctions* are handed out below the finalist line, by rank. Zero means none.
    distinction_count = models.PositiveSmallIntegerField(default=0)

    # ---- when things actually happened (written by `rules.transition`, never by hand) ---------
    announced_at = models.DateTimeField(null=True, blank=True)
    results_published_at = models.DateTimeField(null=True, blank=True)
    closed_at = models.DateTimeField(null=True, blank=True)

    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ['-created_at']

    def __str__(self):
        return self.title

    def save(self, *args, **kwargs):
        # Every free-text body on this row, on write (house rule 8). The admin is a second entry
        # point and a moderator reading a draft regulamin is already rendering untrusted HTML.
        self.description = sanitize_content(self.description)
        self.prize_description = sanitize_content(self.prize_description)
        self.merit_criteria = sanitize_content(self.merit_criteria)
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

    @property
    def complaints_close_at(self):
        """When the complaints window shuts: `results_published_at + complaint_window_days`, or
        None while results are unpublished. One definition, read by `rules.complain_block_reason`,
        by `rules.unpublish_block_reason` and by the results page, so the date the reader is shown
        and the date the refusal uses cannot differ."""
        if self.results_published_at is None:
            return None
        return self.results_published_at + timedelta(days=self.complaint_window_days)

    @property
    def rules_version(self) -> int:
        """The number of the latest published regulamin, or 0 if none has been published. Read
        rather than stored: `ContestRulesVersion` already is the record."""
        latest = self.rules_versions.order_by('-number').values_list('number', flat=True).first()
        return latest or 0


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


# ---- stages: the ladder a contest is run on ------------------------------------------------------

#: How a stage is answered. `presets.StageTemplate.mode` has a third value, `either`, which is the
#: founder's CHOICE in the wizard and never a stored one — a stage is answered on EdMat or in a room.
STAGE_MODE_CHOICES = [
    ('online', 'Answered here, in the browser'),
    ('onsite', 'Answered in a room — the stage is an event, with its venue, documents and rota'),
]

STAGE_STATUS_CHOICES = [
    ('scheduled', 'Scheduled — the problems are not visible yet'),
    ('open', 'Open — participants may answer'),
    ('closed', 'Closed — the jury may score'),
    ('scored', 'Scored — who advances has been computed'),
]

#: `presets.ADVANCEMENTS` spelled with its sentences. There is deliberately no `draw`: chance
#: deciding ANY stage makes the whole thing a *gra losowa* needing a permit, with an administrative
#: penalty and a penal-fiscal one that stack (CONTESTS-LAW.md §2).
ADVANCEMENT_CHOICES = [
    ('all', 'Everyone who answered goes on'),
    ('top_n', 'The best N by points go on'),
    ('threshold', 'Everyone at or above a points threshold goes on'),
    ('final', 'The last stage — nobody goes on from here'),
]


class ContestStage(models.Model):
    """One round. The problems hang off it, the submissions hang off it, and `rules.advance` reads
    it to decide who goes on.

    **An on-site stage IS an event.** `event` points at a real `events.Event`, which is what brings
    a venue, the conference layer's documents, a volunteer rota and a cloakroom with it — none of
    which this app re-implements (CONTESTS-BRIEF.md §0: what a contest shares with a course and an
    event, it gets by being a node and by pointing at one).

    `max_points` is DERIVED from the problems (house rule 5): a stored maximum is wrong the moment
    somebody edits a problem's points, and every percentage on the results page is computed from it.
    """

    contest = models.ForeignKey(Contest, on_delete=models.CASCADE, related_name='stages')
    order = models.PositiveSmallIntegerField(default=0)
    #: The preset's `StageTemplate.key` where the stage came from one, so a wizard-built ladder can
    #: be recognised later; free text otherwise.
    key = models.CharField(max_length=40, blank=True)
    title = models.CharField(max_length=200)
    description = models.TextField(blank=True)
    mode = models.CharField(max_length=10, choices=STAGE_MODE_CHOICES, default='online')
    event = models.ForeignKey(
        'events.Event',
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
        related_name='contest_stages',
    )
    opens_at = models.DateTimeField(null=True, blank=True)
    closes_at = models.DateTimeField(null=True, blank=True)
    advancement = models.CharField(max_length=10, choices=ADVANCEMENT_CHOICES, default='final')
    #: For `top_n` and `threshold` respectively. Null for `all` and `final`.
    advance_count = models.PositiveSmallIntegerField(null=True, blank=True)
    advance_threshold = models.FloatField(null=True, blank=True)
    status = models.CharField(max_length=10, choices=STAGE_STATUS_CHOICES, default='scheduled')
    #: When `rules.advance` last ran. Evidence, not a decision — the decision is the `advanced` flag
    #: on each submission.
    advanced_at = models.DateTimeField(null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ['order', 'id']
        constraints = [
            # A stage key is how the wizard's ladder is recognised; two rounds with the same key on
            # one contest would make `advance` ambiguous about which one it just scored.
            models.UniqueConstraint(
                fields=['contest', 'key'],
                condition=models.Q(key__gt=''),
                name='contests_one_stage_per_key',
            ),
        ]

    def __str__(self):
        return f'{self.contest.title}: {self.title}'

    def save(self, *args, **kwargs):
        self.description = sanitize_content(self.description)
        super().save(*args, **kwargs)

    @property
    def max_points(self) -> float:
        """The sum of the problems' points. Two reads of an indexed FK, recounted every time."""
        return float(sum(p.points for p in self.problems.all()))

    @property
    def problems_visible(self) -> bool:
        """Whether a non-staff reader may see WHICH exercises this stage uses. An exercise's
        statement is public content already — that is the whole point of the corpus — but the
        selection is the contest, and it is secret until the stage opens. `opens_at` in the past is
        not enough on its own: an organiser who has not pressed Open has not opened anything."""
        if self.status in ('open', 'closed', 'scored'):
            return True
        return False


class ContestProblem(models.Model):
    """One exercise from the corpus, worth some points, in one stage.

    Nothing is copied: a problem is a pointer at `exercises.Exercise`, so the statement people read
    is the same row, in the same languages, rendered by the same renderer as `/exercises/<id>`. The
    stage payload carries the STATEMENT only — hints and solutions are exactly what a contest must
    not hand out, and `serializers.ContestProblemSerializer` is where that is enforced.
    """

    stage = models.ForeignKey(ContestStage, on_delete=models.CASCADE, related_name='problems')
    exercise = models.ForeignKey(
        'exercises.Exercise', on_delete=models.PROTECT, related_name='contest_problems'
    )
    order = models.PositiveSmallIntegerField(default=0)
    points = models.PositiveSmallIntegerField(default=1)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ['order', 'id']
        constraints = [
            models.UniqueConstraint(
                fields=['stage', 'exercise'], name='contests_one_problem_per_exercise'
            ),
        ]

    def __str__(self):
        return f'{self.stage.title} #{self.order}'

    @property
    def visible_from(self):
        """Derived from the stage, never stored — a per-problem reveal time would be a second
        answer to "is this stage open?" and the two would disagree the first time a date was
        edited."""
        return self.stage.opens_at


# ---- registrations: who is taking part, and on whose consent -------------------------------------

REGISTRATION_STATUS_CHOICES = [
    ('requested', 'Asked to take part'),
    ('accepted', 'Taking part'),
    ('declined', 'The organiser declined'),
    ('withdrawn', 'Withdrew'),
    ('disqualified', 'Disqualified by the organiser'),
]

#: The statuses that make somebody a participant — `access._registered` reads exactly this. A
#: declined, withdrawn or disqualified row is kept (house rule 12: who asked, when, and whether it
#: was accepted is part of the trust model) and holds no place.
PLACE_HOLDING_STATUSES = frozenset({'requested', 'accepted'})
#: The one status that may answer problems and be ranked.
COMPETING_STATUSES = frozenset({'accepted'})


class ContestRegistration(models.Model):
    """One person's entry, and the consents it rests on.

    **A minor's entry carries the guardian's consent on the row.** Under 16 is the line
    (`accounts/minors.py`; GDPR art. 8, which Poland did not lower), the preset must allow minors at
    all, and the consent is recorded with a name and a timestamp rather than a bare boolean — a
    boolean cannot be shown to anybody later.

    **`publish_name` is its own, separately revocable consent** and defaults to False, which is
    UODO's own lesson from its own pupil-contest regulamin (CONTESTS-LAW.md §4): publishing a
    winner's full name must never be bundled into entry. It has its own PATCH endpoint for the same
    reason — withdrawing it must not look like withdrawing from the contest.

    There is no `number` field. The anonymised label the jury scores against is this row's position
    among the contest's registrations, ordered by when they arrived, computed at serialization
    (house rule 5 again: a stored sequence allocated under SQLite's single writer is a retry loop
    and a drift risk for something two `COUNT`s answer). Registrations are never deleted — every
    terminal status keeps its row — so the position is stable.
    """

    contest = models.ForeignKey(Contest, on_delete=models.CASCADE, related_name='registrations')
    user = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name='contest_registrations'
    )
    status = models.CharField(
        max_length=14, choices=REGISTRATION_STATUS_CHOICES, default='requested'
    )
    #: School, faculty, circle — whatever the regulamin asks for. Free text, sanitized.
    affiliation = models.CharField(max_length=200, blank=True)
    guardian_name = models.CharField(max_length=200, blank=True)
    guardian_consent_at = models.DateTimeField(null=True, blank=True)
    publish_name = models.BooleanField(default=False)
    team_name = models.CharField(max_length=200, blank=True)
    #: Which version of the regulamin this person accepted. KC art. 384: the rules must be
    #: available before entry and storable — so the entry stores WHICH rules it agreed to, and a
    #: later version cannot silently become the one somebody is held to.
    accepted_rules_version = models.PositiveSmallIntegerField(default=0)
    created_at = models.DateTimeField(auto_now_add=True)
    decided_by = models.ForeignKey(
        settings.AUTH_USER_MODEL, null=True, blank=True, on_delete=models.SET_NULL, related_name='+'
    )
    decided_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        ordering = ['created_at', 'id']
        constraints = [
            models.UniqueConstraint(
                fields=['contest', 'user'], name='contests_one_registration_per_person'
            ),
        ]

    def __str__(self):
        return f'{self.user} in {self.contest}'

    def save(self, *args, **kwargs):
        self.affiliation = sanitize_content(self.affiliation)
        self.team_name = sanitize_content(self.team_name)
        self.guardian_name = sanitize_content(self.guardian_name)
        super().save(*args, **kwargs)

    @property
    def holds_a_place(self) -> bool:
        return self.status in PLACE_HOLDING_STATUSES

    @property
    def is_competing(self) -> bool:
        return self.status in COMPETING_STATUSES


# ---- submissions, answers and scores -------------------------------------------------------------

SUBMISSION_STATUS_CHOICES = [
    ('draft', 'A draft — only its author can see it'),
    ('submitted', 'Handed in'),
    ('scored', 'Scored by the jury'),
]


class ContestSubmission(models.Model):
    """One participant's work on one stage. One row per (stage, registration), ever.

    **`advanced` is the next stage's eligibility, and `rules.advance` is its only writer.** That is
    the whole reason it is a field and not a computed answer: advancement is a decision somebody
    took at a moment, by a published rule, and a participant who was told they advanced must not
    stop having advanced because a juror later edited a cell. `rules.advance` recomputes it for a
    whole stage at once and stamps `ContestStage.advanced_at`; nothing else assigns it.
    """

    stage = models.ForeignKey(ContestStage, on_delete=models.CASCADE, related_name='submissions')
    registration = models.ForeignKey(
        ContestRegistration, on_delete=models.CASCADE, related_name='submissions'
    )
    status = models.CharField(max_length=10, choices=SUBMISSION_STATUS_CHOICES, default='draft')
    submitted_at = models.DateTimeField(null=True, blank=True)
    advanced = models.BooleanField(default=False)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ['registration__created_at', 'id']
        constraints = [
            models.UniqueConstraint(
                fields=['stage', 'registration'], name='contests_one_submission_per_stage'
            ),
        ]

    def __str__(self):
        return f'{self.registration.user} on {self.stage.title}'


class ContestAnswer(models.Model):
    """What somebody wrote for one problem. Markdown with literal LaTeX delimiters, like every
    other body on this site, rendered by the same pipeline.

    **The attachment field exists and the API accepts it; the participant-facing upload control
    does not, and the reason is a rule in another app.** `CONTESTS-BRIEF.md` §3.A proposed
    "attach to the contest node with tier `staff` and reference the row from the answer" — but
    `attachments/access.py: can_attach` allows an attachment on a NODE only to that node's STAFF,
    deliberately ("an attachment on a course page is the course's pile of files and not a
    free-for-all"), and a contest participant is a member, not staff. So the brief's shape is
    refused by the code, and the code is right: step A does not own `attachments/`.

    What the field IS good for today is an organiser or a proctor attaching a scan on somebody's
    behalf, which is the on-site case. The clean fix, named in `HISTORY.md` §17CE.A and in
    `todo.md`, is a `contest_answer` target kind in `attachments/targets.py` with this row as its
    own owner — the `ROW_TARGET_KINDS` shape `needs` already has, where "the row's own author may
    attach" is exactly the rule a contest answer wants. Either way the file then inherits the
    re-encode-never-store rule, the scan, the acknowledgement machinery and the tier check for
    free (house rule 7); a per-answer upload table here would inherit none of them.
    """

    submission = models.ForeignKey(
        ContestSubmission, on_delete=models.CASCADE, related_name='answers'
    )
    problem = models.ForeignKey(ContestProblem, on_delete=models.CASCADE, related_name='answers')
    text = models.TextField(blank=True)
    attachment = models.ForeignKey(
        'attachments.Attachment',
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
        related_name='contest_answers',
    )
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ['problem__order', 'id']
        constraints = [
            models.UniqueConstraint(
                fields=['submission', 'problem'], name='contests_one_answer_per_problem'
            ),
        ]

    def __str__(self):
        return f'answer to {self.problem_id}'

    def save(self, *args, **kwargs):
        self.text = sanitize_content(self.text)
        super().save(*args, **kwargs)


class ContestScore(models.Model):
    """One juror's marks for one problem of one submission, and why.

    Nothing aggregates here. A submission's points are the mean over the jurors who scored each
    problem, summed over problems, recounted on every read (`rules.ranking`) — so a juror changing
    their mind changes the ranking immediately and no second number has to be kept in step.
    """

    submission = models.ForeignKey(ContestSubmission, on_delete=models.CASCADE, related_name='scores')
    problem = models.ForeignKey(ContestProblem, on_delete=models.CASCADE, related_name='scores')
    juror = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name='contest_scores'
    )
    points = models.FloatField(default=0)
    note = models.TextField(blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ['problem__order', 'id']
        constraints = [
            models.UniqueConstraint(
                fields=['submission', 'problem', 'juror'], name='contests_one_score_per_juror'
            ),
        ]

    def __str__(self):
        return f'{self.juror}: {self.points}'

    def save(self, *args, **kwargs):
        self.note = sanitize_content(self.note)
        super().save(*args, **kwargs)


# ---- the published ranking, and complaints about it ----------------------------------------------

RESULT_TITLE_CHOICES = [
    ('participant', 'Participant'),
    ('distinction', 'Distinction (wyroznienie)'),
    ('finalist', 'Finalist'),
    ('laureate', 'Laureate'),
]

#: The titles that earn a certificate. A participant's own record says they took part; a
#: *zaswiadczenie* is for the two titles the kurator's regulation itself names, plus a distinction,
#: which organisers hand out as a document too.
CERTIFIABLE_TITLES = frozenset({'laureate', 'finalist', 'distinction'})


class ContestResult(models.Model):
    """The published ranking — frozen, and the one thing on this page that must not move under a
    reader who was given the link.

    These rows **exist only between `publish_results` and `unpublish_results`** (`rules.py`), which
    is why there is no `is_published` flag: the row's existence IS the publication, so there is no
    way to have a published result that is secretly unpublished, or a draft ranking that leaks. The
    live, recounted ranking is `rules.ranking(contest)` and is staff-only until these rows exist.
    """

    contest = models.ForeignKey(Contest, on_delete=models.CASCADE, related_name='results')
    registration = models.ForeignKey(
        ContestRegistration, on_delete=models.CASCADE, related_name='results'
    )
    rank = models.PositiveSmallIntegerField()
    total_points = models.FloatField(default=0)
    title = models.CharField(max_length=12, choices=RESULT_TITLE_CHOICES, default='participant')
    published_at = models.DateTimeField()

    class Meta:
        ordering = ['rank', 'id']
        constraints = [
            models.UniqueConstraint(
                fields=['contest', 'registration'], name='contests_one_result_per_registration'
            ),
        ]

    def __str__(self):
        return f'#{self.rank} {self.title}'


COMPLAINT_STATUS_CHOICES = [
    ('open', 'Lodged, waiting for an answer'),
    ('answered', 'Answered with reasons'),
    ('withdrawn', 'Withdrawn by the participant'),
]


class ContestComplaint(models.Model):
    """A *reklamacja*: a participant says the result is wrong, and the organiser must answer within
    the window, with reasons.

    At least 14 days to lodge and 14 to answer is the UOKiK norm (a 7-day window was entered in its
    register of abusive clauses); the two kurator presets use 7 because the regulation's own practice
    is shorter. `Contest.complaint_window_days` carries whichever applies and
    `rules.complain_block_reason` is where it is read.

    By the owner's standing default (CONTESTS-BRIEF.md §6 item 1) **a minor does not lodge one
    themself** — it is free text to a stranger, which `accounts/minors.py` closes — so the guardian
    asks the organiser, who records it. The UI says that rather than greying a button.
    """

    contest = models.ForeignKey(Contest, on_delete=models.CASCADE, related_name='complaints')
    registration = models.ForeignKey(
        ContestRegistration, on_delete=models.CASCADE, related_name='complaints'
    )
    text = models.TextField()
    status = models.CharField(max_length=10, choices=COMPLAINT_STATUS_CHOICES, default='open')
    answer = models.TextField(blank=True)
    answered_by = models.ForeignKey(
        settings.AUTH_USER_MODEL, null=True, blank=True, on_delete=models.SET_NULL, related_name='+'
    )
    answered_at = models.DateTimeField(null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ['-created_at', '-id']

    def __str__(self):
        return f'complaint on {self.contest.title}'

    def save(self, *args, **kwargs):
        self.text = sanitize_content(self.text)
        self.answer = sanitize_content(self.answer)
        super().save(*args, **kwargs)


# ---- the regulamin -------------------------------------------------------------------------------


class ContestRulesSection(models.Model):
    """One paragraph of the regulamin, keyed by `presets.RULES_SECTIONS`.

    The sections are rows rather than one big text field because each one carries its own guidance
    and its own law citations, and because the compliance panel has to be able to say "§3 has no
    claim deadline in it" about a particular paragraph.
    """

    contest = models.ForeignKey(Contest, on_delete=models.CASCADE, related_name='rules_sections')
    #: A key into `presets.RULES_SECTIONS`. A plain string, like `Contest.preset_key`, so a section
    #: can be added to the skeleton without a migration.
    key = models.CharField(max_length=40)
    order = models.PositiveSmallIntegerField(default=0)
    body = models.TextField(blank=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ['order', 'id']
        constraints = [
            models.UniqueConstraint(
                fields=['contest', 'key'], name='contests_one_rules_section_per_key'
            ),
        ]

    def __str__(self):
        return f'{self.contest.title} {self.key}'

    def save(self, *args, **kwargs):
        self.body = sanitize_content(self.body)
        super().save(*args, **kwargs)


class ContestRulesVersion(models.Model):
    """A published version of the regulamin, with the sections as they stood.

    KC art. 384 wants the rules available before entry and storable, and art. 919 s 2's
    "never to the worse for acquired rights" only means something if there is a record of what the
    rules were when somebody entered. So publishing freezes a numbered snapshot, a registration
    stores the number it accepted (`accepted_rules_version`), and the reader of an old version gets
    the text that person agreed to rather than today's.
    """

    contest = models.ForeignKey(Contest, on_delete=models.CASCADE, related_name='rules_versions')
    number = models.PositiveSmallIntegerField()
    published_at = models.DateTimeField(auto_now_add=True)
    published_by = models.ForeignKey(
        settings.AUTH_USER_MODEL, null=True, blank=True, on_delete=models.SET_NULL, related_name='+'
    )
    #: `[{key, order, body}]` as the sections stood. JSON rather than copied rows: nothing ever
    #: queries inside an old version, and a second table of sections would be a second place for
    #: "which section is §3" to be answered.
    snapshot = models.JSONField(default=list)

    class Meta:
        ordering = ['-number']
        constraints = [
            models.UniqueConstraint(
                fields=['contest', 'number'], name='contests_one_rules_version_per_number'
            ),
        ]

    def __str__(self):
        return f'{self.contest.title} regulamin v{self.number}'
