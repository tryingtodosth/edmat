"""The exercise itself — structural fields only. All human-language text lives in
ExerciseTranslation, one row per (exercise, locale) pair, including the original language.
See CLAUDE.md Section 9 and Section 10 for why this split isn't "original fields on Exercise,
translations elsewhere."
"""

from django.conf import settings
from django.db import models
from config.audience import AUDIENCE_CHOICES, DEFAULT_AUDIENCE
from licensing.models import licence_field

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
    # Who made the tag and when (WP16, 2026-10-15 — the owner's "tag creation is a must"). Both are
    # null on the 1,022 tags that predate them: nobody recorded it, and inventing a date would be
    # a lie. `created_at` is stamped by `save()` on every NEW row whichever path makes it (the
    # importer, a submission's approval, a concept article, a question); `created_by` is set where
    # a person is known.
    created_by = models.ForeignKey(
        settings.AUTH_USER_MODEL, null=True, blank=True, related_name='+', on_delete=models.SET_NULL
    )
    created_at = models.DateTimeField(null=True, blank=True)
    # True for a tag a person minted by asking a question in it (`exercises/tags.py:
    # create_tag_from`). Such a tag is LISTED only while something visible uses it — an exercise, a
    # material, a concept, or a post a reader may see (`tags.listed_tags`) — so a question that is
    # withdrawn, auto-hidden or held never leaves its tag's name standing on its own. The origin is
    # a fact, not a decision: nothing flips it back.
    from_question = models.BooleanField(default=False)

    def save(self, *args, **kwargs):
        if self._state.adding and self.created_at is None:
            from django.utils import timezone

            self.created_at = timezone.now()
        super().save(*args, **kwargs)

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
    # Who this is for — AUDIENCE-BRIEF.md §1. `university` is what every row that predates the
    # field means; the submit forms require an explicit choice, this default exists for the
    # migration and for code paths (the corpus importer, fixtures) that never asked.
    audience = models.CharField(
        max_length=12, choices=AUDIENCE_CHOICES, default=DEFAULT_AUDIENCE, db_index=True
    )
    tags = models.ManyToManyField(Tag, related_name='exercises', blank=True)
    # The licence the author chose for this exercise (licensing/licences.py, 2026-10-14). Covers
    # the statement and answer in the original language; another person's translation carries its
    # own (`ExerciseTranslation.licence`) and every hint/solution its own (`SolutionEntry.licence`).
    # The corpus is `unknown` (LEGAL.md §3); the model default `edmat-only` opens nothing.
    # Changed only through `licensing.rules.change_licence`, which records it.
    licence = licence_field()
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


# Which question a link answers. `source` — this exercise IS in that material (transcribed from
# it, so the material is where it came from); `practice` — the exercise is not in the material at
# all, it practises what the material teaches. Two rows, two different claims: a script somebody
# wrote and an exercise sheet somebody solved against it are not the same relationship, and
# collapsing them into "related" would make the page unable to say which it is.
EXERCISE_LINK_ROLE_CHOICES = [
    ('source', 'In this material'),
    ('practice', 'Practises this material'),
]


class ExerciseMaterialLink(models.Model):
    """One exercise attached to one material — a PDF script this site hosts, or a proprietary
    textbook it only links to (`Material.url`). Both halves of the feature land here: an exercise
    submitted through the normal moderated flow "for material X" gets this row the instant the
    exercise exists (`moderation.views._apply_submission`), and an exercise already in the database
    gets one through `POST /api/materials/{id}/exercises/`.

    **Deliberately not moderation-gated**, the same call `MaterialCoverage` and `TagViewSet.apply`
    already made for the identical shape of thing: a link is additive, reversible, low-stakes
    organisational metadata — wrong ones are corrected by whoever notices, not queued for a
    moderator. The EXERCISE itself still goes through review; saying which material it belongs to
    is not the part that needs a gate.

    **Why this is not a field on `ExerciseSource`.** `ExerciseSource` is the free-text provenance
    block the legacy corpus already carried ("Analiza II — Normy w R^n, Zadanie 1", a collection
    name, a page range) — one row per exercise, no referential meaning, and no way to ask "what
    else came from this?" A link is the opposite: a real foreign key, many per exercise, and
    readable from BOTH ends. They overlap for `role='source'` and are still different objects —
    `locator` here says *where in that material*, which is exactly what `ExerciseSource.pages`
    says for a source nobody has a row for. Left side by side on purpose rather than merged; see
    the report/HISTORY note for the migration that would be needed to unify them.

    The FK to `materials.Material` is a STRING reference, not an import: `materials.models` imports
    `exercises.Tag` at module scope, so naming the class here would close the cycle.
    """

    exercise = models.ForeignKey(Exercise, on_delete=models.CASCADE, related_name='material_links')
    material = models.ForeignKey(
        'materials.Material', on_delete=models.CASCADE, related_name='exercise_links'
    )
    role = models.CharField(max_length=10, choices=EXERCISE_LINK_ROLE_CHOICES, default='source')
    # "p. 34, ex. 3.2" — deliberately free text, not a page number plus an index: a material can be
    # a scanned handout, a slide deck, a recording or a web page, and every one of those numbers
    # its own parts differently. The same reasoning `MaterialRequirement.label` already records for
    # not making a loose human string into a structured vocabulary.
    locator = models.CharField(max_length=120, blank=True)
    added_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
        related_name='+',
    )
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        # One row per pair — a second link between the same two things is never a new claim, only
        # a duplicate. Changing your mind about the role is a PATCH, not a second row.
        unique_together = [('exercise', 'material')]
        ordering = ['material', 'created_at']

    def __str__(self) -> str:
        return f'{self.exercise} {self.role} {self.material_id}'


class ExerciseTranslation(models.Model):
    """THE translation table — the one place title/statement/answer live, for every locale
    including the original. `status` makes a submitted-but-unreviewed translation a real,
    queryable thing (CLAUDE.md Section 10).

    `hint`/`solution` used to live here too and were MOVED OUT (migrations 0009–0011, 2026-08) into
    the `SolutionEntry` pool below — an exercise now carries any number of peer hints/solutions,
    each in one language, voted on and individually reviewed. A "translation" of a solution is just
    another entry in that language, never a field here."""

    exercise = models.ForeignKey(Exercise, related_name='translations', on_delete=models.CASCADE)
    locale = models.CharField(max_length=8)
    title = models.CharField(max_length=300)
    statement = models.TextField()
    answer = models.TextField(blank=True)
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
    # A translation is a DERIVATIVE of the exercise, so it is never chosen: `save()` stamps the
    # parent's licence at the moment it is written (`licensing.licences.derivative_licence`), and it
    # does not follow a later change of the parent — the translator contributed under THAT licence,
    # and only they could widen it. The original-language rows do follow the exercise
    # (`licensing.rules._carry_to_own_text`), because they are the exercise.
    licence = licence_field(default='', blank=True)
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
        self.answer = sanitize_content(self.answer)
        if not self.licence:
            from licensing.licences import derivative_licence

            self.licence = derivative_licence(self.exercise.licence)
        super().save(*args, **kwargs)


class ExercisePart(models.Model):
    """One PART of an exercise that is really a small set — "(a)", "(b)", "1.", "ii" — with its own
    sub-statement and answer, and its own hints and solutions in the pool (`SolutionEntry.part`).
    `SUBEXERCISES-BRIEF.md` (2026-10-21), owner: *"one Statement, and multiple examples split into
    subsets each with own sub-statement, solution, and hints, so hints can be both statement- or
    sub-statement-specific"*.

    A part is ADDITIVE: the shared statement stays on `ExerciseTranslation`, an exercise with no
    parts is exactly what it was, and a part is never a thing on its own outside its exercise's
    page (no licence of its own — it is the exercise's own text and moves with it, no difficulty,
    no topics). `label` is free text shown as written; `order` is what sorts and what the importer
    keys on (`(exercise, order)` unique), so a re-run updates a part's text and never duplicates it.
    """

    exercise = models.ForeignKey(Exercise, related_name='parts', on_delete=models.CASCADE)
    order = models.PositiveSmallIntegerField()
    label = models.CharField(max_length=20)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        unique_together = [('exercise', 'order')]
        ordering = ['exercise', 'order']

    def __str__(self) -> str:
        return f'{self.exercise} ({self.label})'


class ExercisePartTranslation(models.Model):
    """A part's text in one language, including the original — the same shape as
    `ExerciseTranslation` (root CLAUDE.md, "Text lives in a translation table, including the
    original"), with the same partial unique constraint: exactly one `published` row per (part,
    locale), any number pending or rejected. Resolved for the reader's `?lang=` and falling back
    to the exercise's `original_locale` exactly as the statement does (`exercises/parts.py`)."""

    part = models.ForeignKey(ExercisePart, related_name='translations', on_delete=models.CASCADE)
    locale = models.CharField(max_length=8)
    statement = models.TextField()
    answer = models.TextField(blank=True)
    status = models.CharField(max_length=10, choices=TRANSLATION_STATUS_CHOICES, default='published')
    translated_by = models.ForeignKey(
        settings.AUTH_USER_MODEL, null=True, blank=True, related_name='+', on_delete=models.SET_NULL
    )
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        constraints = [
            models.UniqueConstraint(
                fields=['part', 'locale'],
                condition=models.Q(status='published'),
                name='one_published_part_translation_per_locale',
            )
        ]
        ordering = ['part', 'locale']

    def __str__(self) -> str:
        return f'{self.part} [{self.locale}/{self.status}]'

    def save(self, *args, **kwargs):
        # The same one choke point every ExerciseTranslation write gets.
        from config.sanitize import sanitize_content

        self.statement = sanitize_content(self.statement)
        self.answer = sanitize_content(self.answer)
        super().save(*args, **kwargs)


ENTRY_KIND_CHOICES = [
    ('hint', 'Hint'),
    ('solution', 'Solution'),
]


class SolutionEntry(models.Model):
    """One hint or one solution for an exercise — a PEER in a ranked pool, not a field on a
    translation. This model replaced `ExerciseTranslation.hint`/`.solution` outright (2026-08,
    migrations 0009–0011): an exercise can now carry several solutions and several hints, each
    written by a named person in one language, voted on, discussed, reportable, and individually
    review-gated. The corpus's own original hints/solutions were migrated in as PINNED, published
    rows (`author=None`, the same "nobody here submitted this" honesty `Exercise.submitted_by`
    already carries for migrated content).

    Design decisions, each made explicitly with the owner (2026-08-27), not defaulted to:

    - **All entries are peers; `pinned` floats one (or more) to the top.** The original corpus
      solutions are pinned; staff/node governors can pin/unpin any entry. Ordering everywhere is
      pinned-first, then net weighted vote score.
    - **`locale` is the language the entry is WRITTEN in** — not a translation axis. A solution
      rendered into another language is simply another entry in that language, never a translation
      row of an existing one. Readers see entries matching their content locale by default and can
      pull in the rest through an explicit action ("2 more in English").
    - **`status` gates non-verified authors only**: an entry by a verified contributor / staff /
      governor publishes immediately; anybody else's starts `pending`, visible inline to its own
      author and to reviewers. ONE accept (any verified contributor, staff, or a governor of the
      exercise's branch — see `views.can_review_entry`, the single seam where a future
      field/branch-expert SKILL check will slot in) publishes it; one deny (note required) rejects
      it and notifies the author.
    - **`Exercise.verified` is DERIVED from this table** (signals.py's `recount_verified`): at
      least one published, visible solution that passed review — pinned, or reviewed by someone,
      or written by a verified contributor. Recounted, never incremented, same reasoning as
      accounts/counters.py.
    - `is_removed`/`auto_hidden_at` wire this into the existing report/auto-hide system exactly
      like a Comment (`REPORT_KIND_MODELS['solution_entry']`); the viewer pool is the exercise's.
    """

    exercise = models.ForeignKey(Exercise, related_name='entries', on_delete=models.CASCADE)
    # Which PART of a set-shaped exercise this is for; null = the whole exercise. A whole-exercise
    # hint ("use the conjugate") and a part hint ("for (b), square first") are the same row with a
    # different `part` — every pool rule in `entries.py` is untouched by it. `SUBEXERCISES-BRIEF.md`.
    part = models.ForeignKey(
        ExercisePart, null=True, blank=True, related_name='entries', on_delete=models.CASCADE
    )
    kind = models.CharField(max_length=10, choices=ENTRY_KIND_CHOICES)
    locale = models.CharField(max_length=8)
    body = models.TextField()
    author = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        null=True,
        blank=True,
        related_name='solution_entries',
        on_delete=models.SET_NULL,
    )
    status = models.CharField(max_length=10, choices=TRANSLATION_STATUS_CHOICES, default='pending')
    pinned = models.BooleanField(default=False)
    # Its OWN licence, not the exercise's: a solution is an independent work by a different person
    # (it is not a derivative of the statement), and inheriting would mean the exercise's author
    # could relicense somebody else's solution by changing their own. The corpus's pinned originals
    # (`author=None`) are `unknown`; a new entry is what its author picked, `edmat-only` if nothing.
    licence = licence_field()
    is_removed = models.BooleanField(default=False)
    auto_hidden_at = models.DateTimeField(null=True, blank=True)
    reviewed_by = models.ForeignKey(
        settings.AUTH_USER_MODEL, null=True, blank=True, related_name='+', on_delete=models.SET_NULL
    )
    review_note = models.TextField(blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ['-pinned', 'created_at']
        verbose_name_plural = 'solution entries'

    def __str__(self) -> str:
        return f'{self.kind} for {self.exercise} [{self.locale}/{self.status}]'

    def save(self, *args, **kwargs):
        # Same one-choke-point server-side sanitization every ExerciseTranslation write already
        # gets — see that model's own save() for why this lives here and not at each call site.
        from config.sanitize import sanitize_content

        self.body = sanitize_content(self.body)
        super().save(*args, **kwargs)

    def is_visible_to_readers(self) -> bool:
        return self.status == 'published' and not self.is_removed and self.auto_hidden_at is None


def entry_attachment_upload_path(instance, filename: str) -> str:
    """A random stored name, the uploader's own name kept only for display (house rule 7). The
    extension comes from what the file was decided to BE, never from what it was called."""
    import uuid

    ext = '.webp' if instance.kind == 'image' else '.pdf'
    return f'entry-attachments/{uuid.uuid4().hex}{ext}'


class SolutionEntryAttachment(models.Model):
    """A scan or a PDF hanging off one hint/solution — the owner's "make adding solution as PDF,
    image, Chemistry, etc. work" (2026-10-01).

    Three of the four ways that sentence names already worked once the insert strip was put on the
    composer, because they all go INTO the body: a picture through `/inline-images/`, a chemistry
    structure through `/chem-drawings/`, a freehand sketch through `/sketches/`. A PDF cannot go
    into a body — there is nothing to embed it as — so it needs a row, and this is it.

    It is `community.CommentAttachment` again, deliberately: same three-per-parent limit, same
    `process_attachment` (re-encode a picture, sniff-and-scan a PDF, house rule 7), same random
    stored name, same upload allowance. A second shape for the same thing is how two surfaces
    start disagreeing about what a 6 MB upload should do. It is a separate TABLE rather than a
    generic target on the existing one because `CommentAttachment.comment` is a real FK that four
    call sites read; widening it to a `GenericForeignKey` would be a migration on a live table to
    save one model definition.

    A picture may be attached as well as embedded. Embedding is better — it sits in the sentence
    it belongs to — but a phone photo of four pages of working is a stack of pictures, not an
    illustration, and making somebody place each one in the text is the kind of friction that ends
    with the solution not being written at all.
    """

    KIND_CHOICES = [('image', 'Picture'), ('pdf', 'PDF')]

    entry = models.ForeignKey(SolutionEntry, related_name='attachments', on_delete=models.CASCADE)
    kind = models.CharField(max_length=5, choices=KIND_CHOICES)
    file = models.FileField(upload_to=entry_attachment_upload_path)
    original_name = models.CharField(max_length=120, blank=True)
    size_bytes = models.PositiveIntegerField(default=0)
    order = models.PositiveSmallIntegerField(default=0)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ['order', 'id']

    def __str__(self) -> str:
        return f'{self.kind} on entry #{self.entry_id}'


class SolutionEntryVote(models.Model):
    """One ▲/▼ per user per entry — "is this correct and helpful", a single axis on purpose (the
    claims system's separate accuracy/importance votes answer two genuinely different questions; a
    solution has only one). Weight is applied at read time by the same shared
    `materials/services.py` vote math every claim/requirement vote already uses (a verified
    contributor's vote counts double), via this model's own `related_name='votes'`."""

    entry = models.ForeignKey(SolutionEntry, related_name='votes', on_delete=models.CASCADE)
    voter = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE)
    value = models.SmallIntegerField(choices=[(1, 'Up'), (-1, 'Down')])
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        unique_together = [('entry', 'voter')]

    def __str__(self) -> str:
        return f'{self.get_value_display()} by {self.voter} on {self.entry}'


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
