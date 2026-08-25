"""The exercise itself — structural fields only. All human-language text lives in
ExerciseTranslation, one row per (exercise, locale) pair, including the original language.
See CLAUDE.md Section 9 and Section 10 for why this split isn't "original fields on Exercise,
translations elsewhere."
"""

from django.conf import settings
from django.db import models

from taxonomy.models import Branch, Topic

DIFFICULTY_CHOICES = [
    ('easy', 'Easy'),
    ('medium', 'Medium'),
    ('hard', 'Hard'),
]

# Real corpus values are Polish (Ćwiczenia/Kolokwium/Egzamin/other) — mapped to these English codes
# by the import_legacy_corpus command (CLAUDE.md Section 12).
SOURCE_TYPE_CHOICES = [
    ('exercises', 'Exercise sheet'),
    ('midterm', 'Midterm'),
    ('exam', 'Exam'),
    ('other', 'Other'),
]

TRANSLATION_STATUS_CHOICES = [
    ('published', 'Published'),
    ('pending', 'Pending review'),
    ('rejected', 'Rejected'),
]


class Tag(models.Model):
    """Free-form, per-exercise (not course-scoped) — kept global, matching the real corpus's own
    per-exercise `tags:` lists. Also attachable to a Material (materials/models.py) — the same tag
    vocabulary, used the same way, across both content types."""

    slug = models.SlugField(unique=True)
    # A tag is entirely ungated (any authenticated user can apply any free-form string, live, with
    # zero moderation — CLAUDE.md's own flagged risk: a slur, a defamatory label). This is what a
    # moderator's "remove" decision on a reported tag actually sets — a real, global tombstone
    # (moderation/moderation's own generic `hasattr(target, 'is_removed')` handling already covers
    # this for free, same as Comment/Review), not just resolving the report rows with no real
    # effect. Filtered out wherever a tag is serialized to an ordinary reader (Exercise/Material
    # `tags`), same as a removed Comment/Review already disappears from its own reader-facing list.
    is_removed = models.BooleanField(default=False)

    def __str__(self) -> str:
        return self.slug


class TagFollow(models.Model):
    """"Follow [a tag]" — the tag-hover action menu's own subscription record (frontend
    `TagChip.svelte`). `notify` is a SEPARATE control from following itself, not the same toggle:
    following puts a tag on a user's own "followed tags" list regardless of whether they want to be
    pinged about it, while `notify` (default True the moment you follow, independently togglable
    afterward without unfollowing) is what actually gates whether new tagged content produces a real
    `Notification` (see notifications/services.py's `notify_tag_followers`) — the same "follow the
    subscription, separately choose whether it's noisy" split a lot of real notification systems use,
    read directly off the request's own "follow, set notifications" as two related but distinct
    actions rather than one combined toggle.
    """

    user = models.ForeignKey(settings.AUTH_USER_MODEL, related_name='tag_follows', on_delete=models.CASCADE)
    tag = models.ForeignKey(Tag, related_name='follows', on_delete=models.CASCADE)
    notify = models.BooleanField(default=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        unique_together = [('user', 'tag')]

    def __str__(self) -> str:
        return f'{self.user} follows #{self.tag.slug} (notify={self.notify})'


class Exercise(models.Model):
    branch = models.ForeignKey(Branch, related_name='exercises', on_delete=models.CASCADE)
    number = models.PositiveIntegerField()
    topics = models.ManyToManyField(Topic, related_name='exercises', blank=True)
    difficulty = models.CharField(max_length=10, choices=DIFFICULTY_CHOICES)
    tags = models.ManyToManyField(Tag, related_name='exercises', blank=True)
    published = models.BooleanField(default=True)
    verified = models.BooleanField(default=False)
    original_locale = models.CharField(max_length=8)
    submitted_by = models.ForeignKey(
        settings.AUTH_USER_MODEL, null=True, blank=True, on_delete=models.SET_NULL
    )
    # Set the instant community reports cross moderation/services.py's own auto-hide threshold —
    # BEFORE any moderator decision, per that feature's own requirement. Reuses the existing
    # `published` field as the actual visibility switch (an auto-hidden exercise gets
    # `published = False`, which ExerciseViewSet's queryset already excludes everywhere) rather than
    # adding a second, competing visibility flag; this timestamp exists purely so the moderation
    # queue can tell "auto-hidden, pending review" apart from any other reason an exercise might be
    # unpublished, and to give that queue a real "since when" to sort/display. Cleared once a
    # moderator resolves the report (restore sets `published = True` + clears this; a deliberate
    # removal decision leaves `published = False` but clears this too, since it's no longer a
    # pending auto-flag at that point — see moderation/views.py's ReportActionView).
    auto_hidden_at = models.DateTimeField(null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        unique_together = [('branch', 'number')]
        ordering = ['branch', 'number']

    def __str__(self) -> str:
        return f'{self.branch.slug}-{self.number:04d}'


class ExerciseSource(models.Model):
    """1:1 with Exercise — mirrors the existing `source:` block exactly."""

    exercise = models.OneToOneField(Exercise, related_name='source', on_delete=models.CASCADE)
    type = models.CharField(max_length=10, choices=SOURCE_TYPE_CHOICES)
    collection = models.CharField(max_length=200, blank=True)
    original_problem_number = models.PositiveIntegerField(null=True, blank=True)
    pages = models.CharField(max_length=20, blank=True)
    chapter = models.PositiveIntegerField(null=True, blank=True)

    def __str__(self) -> str:
        return f'source for {self.exercise}'


class ExerciseSourceTranslation(models.Model):
    """`name` is often a human sentence, e.g. "Analiza II - Normy w R^n, Zadanie 1" — translatable."""

    source = models.ForeignKey(ExerciseSource, related_name='translations', on_delete=models.CASCADE)
    locale = models.CharField(max_length=8)
    name = models.CharField(max_length=300, blank=True)

    class Meta:
        unique_together = [('source', 'locale')]

    def __str__(self) -> str:
        return f'{self.source} ({self.locale})'


class ExerciseTranslation(models.Model):
    """THE translation table — the one place title/statement/hint/answer/solution live, for every
    locale including the original. `status` makes a submitted-but-unreviewed translation a real,
    queryable thing (CLAUDE.md Section 10)."""

    exercise = models.ForeignKey(Exercise, related_name='translations', on_delete=models.CASCADE)
    locale = models.CharField(max_length=8)
    title = models.CharField(max_length=300)
    statement = models.TextField()
    hint = models.TextField(blank=True)
    answer = models.TextField(blank=True)
    solution = models.TextField(blank=True)
    status = models.CharField(max_length=10, choices=TRANSLATION_STATUS_CHOICES, default='pending')
    translated_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        null=True,
        blank=True,
        related_name='exercise_translations',
        on_delete=models.SET_NULL,
    )
    reviewed_by = models.ForeignKey(
        settings.AUTH_USER_MODEL, null=True, blank=True, related_name='+', on_delete=models.SET_NULL
    )
    review_note = models.TextField(blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        # ✅ Phase 4 fix, found while chasing the "translation race" CLAUDE.md Section 17I flagged
        # and deferred: the ORIGINAL `unique_together = [('exercise', 'locale', 'status')]` was
        # strictly broader than what this Meta's own comment already claimed it did ("in practice
        # this means at most one PUBLISHED version per locale") — a real, DETERMINISTIC bug, not
        # just a rare concurrency edge case, reproduced with zero concurrency involved: (1)
        # submitting a second pending translation for a locale that already had one pending 500'd
        # outright (two rows both wanting status='pending' collided under the old, all-statuses
        # constraint); (2) approving ANY translation that supersedes an already-published one for
        # the same locale 500'd too, every single time, not just under a race (the moderation
        # claim step had to set status='published' before _publish_translation ever got a chance to
        # delete the row it was superseding — see moderation/views.py's own doc comment); (3)
        # rejecting a resubmitted translation after an EARLIER one for the same locale had already
        # been rejected 500'd as well, since old rejected rows are never purged. A genuine partial
        # unique constraint — published rows only — is what this Meta's own comment always
        # described; multiple pending or rejected rows for the same (exercise, locale) were never
        # actually meant to be blocked, they just accidentally were.
        constraints = [
            models.UniqueConstraint(
                fields=['exercise', 'locale'],
                condition=models.Q(status='published'),
                name='one_published_translation_per_locale',
            )
        ]
        ordering = ['exercise', 'locale']

    def __str__(self) -> str:
        return f'{self.exercise} [{self.locale}/{self.status}]'

    def save(self, *args, **kwargs):
        # Real, server-side sanitization (config/sanitize.py) — the ONE choke point for every write
        # path (a moderator-approved submission, a direct translation submission, an applied edit
        # suggestion, the legacy-corpus importer, the Django admin), so nothing has to remember to
        # call this by hand at each individual call site. See that module's own doc comment for why
        # this was missing until a security scan of the whole project found the gap.
        from config.sanitize import sanitize_content

        self.title = sanitize_content(self.title)
        self.statement = sanitize_content(self.statement)
        self.hint = sanitize_content(self.hint)
        self.answer = sanitize_content(self.answer)
        self.solution = sanitize_content(self.solution)
        super().save(*args, **kwargs)


class ExerciseRequirement(models.Model):
    """A loose, free-text prerequisite/skill label for actually attempting this exercise — "basic
    algebra", "epsilon-delta proofs", "a graphing calculator" — the exact same shape and reasoning
    `materials.models.MaterialRequirement` already establishes for a Material, applied here to
    Exercise for the first time. Deliberately NOT a fixed vocabulary, matching that same precedent:
    a requirement is whatever the submitter/community actually typed, not a value chosen from a
    list this app would have to keep in sync with reality.

    `order` is a plain, user-controlled display order, same convention as `MaterialRequirement.order`.
    `is_removed` exists for report-flag parity with `MaterialRequirement`/`Tag` — a moderator's own
    "reports were founded" decision on a reported skill tag, filtered out of ordinary reads rather
    than a Comment-style tombstone (this row is never threaded/replied-to).
    """

    exercise = models.ForeignKey(Exercise, related_name='requirements', on_delete=models.CASCADE)
    label = models.CharField(max_length=200)
    order = models.PositiveIntegerField(default=0)
    is_removed = models.BooleanField(default=False)

    class Meta:
        ordering = ['order', 'id']

    def __str__(self) -> str:
        return f'{self.exercise}: {self.label}'


class ExerciseRequirementVote(models.Model):
    """The exact same "is this claim accurate" weighted signal `materials.models.MaterialRequirementVote`
    already provides for a Material's own requirement row, just targeting an ExerciseRequirement
    instead. Weight is computed the same way, at read time, by the same shared
    `materials/services.py` `_vote_weight`/`_net_vote_weight`/`build_vote_summary` functions — all
    three are already generic over any object exposing a `.votes` related manager (this model's own
    `related_name='votes'` is what makes that work without any change to any of the three), reused
    here rather than a second, independently-drifting copy of the identical math."""

    requirement = models.ForeignKey(ExerciseRequirement, related_name='votes', on_delete=models.CASCADE)
    voter = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE)
    value = models.SmallIntegerField(choices=[(1, 'Agree'), (-1, 'Disagree')])
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        unique_together = [('requirement', 'voter')]  # one vote per user per requirement

    def __str__(self) -> str:
        return f'{self.get_value_display()} by {self.voter} on {self.requirement}'


# --- covers / requires claims -------------------------------------------------------------------
#
# The same claims a material and a course carry (`materials.ClaimBase`): what this exercise
# practises, and what you should already know to attempt it. Topics come from the exercise's own
# branch. Request handling is shared in `materials/claims.py`; votes mirror the material ones.

from materials.models import ClaimBase, VOTE_CHOICES  # noqa: E402 — materials imports exercises.Tag; this import is resolved at call time only


class ExerciseClaim(ClaimBase):
    exercise = models.ForeignKey(Exercise, related_name='claims', on_delete=models.CASCADE)

    class Meta:
        unique_together = [('exercise', 'kind', 'topic', 'subtopic')]
        ordering = ['topic', 'subtopic']

    def __str__(self) -> str:
        sub = f'/{self.subtopic.slug}' if self.subtopic else ''
        return f'{self.exercise}@{self.kind}:{self.topic.slug}{sub}={self.level}'


class ExerciseClaimVote(models.Model):
    claim = models.ForeignKey(ExerciseClaim, related_name='votes', on_delete=models.CASCADE)
    voter = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE)
    value = models.SmallIntegerField(choices=VOTE_CHOICES)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        unique_together = [('claim', 'voter')]


class ExerciseClaimImportanceVote(models.Model):
    claim = models.ForeignKey(ExerciseClaim, related_name='importance_votes', on_delete=models.CASCADE)
    voter = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE)
    value = models.SmallIntegerField(choices=[(1, 'More important'), (-1, 'Less important')])
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        unique_together = [('claim', 'voter')]
