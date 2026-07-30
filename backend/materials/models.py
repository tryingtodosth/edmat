"""materiał dydaktyczny — see CLAUDE.md Section 9.

Type choices were first widened from the section's own sketch (`script`/`formula_sheet`/`other`) to
match what the real corpus's own material.yaml `type:` field actually used at the time (none of the
original 7 real materials were a formula sheet — a script, exam collection, midterm collection, or
exercise collection). Widened again, deliberately BEYOND what the current corpus happens to contain
— "expand material types" per explicit request, not another narrow grounding pass: a real university
materials archive plausibly wants slides/solution guides/syllabi/etc. even before a specific course
happens to have one uploaded. `formula_sheet` in particular is restored here, not re-invented — it
was in the section's own original sketch and only ever dropped for not matching the (at the time)
tiny 7-material corpus, not because it's a bad category.

`Material.topics` (a flat, weightless ManyToManyField to Topic) was replaced outright by
MaterialCoverage below, not kept alongside it — "which topics does this material cover" is now
`coverage.values_list('topic', flat=True).distinct()` rather than a second, competing source of
truth that could drift from the richer one. `Material.tags` (new) is NOT the same axis as coverage —
tags are the same free-form, cross-content-type labels Exercise already has (exercises.Tag), letting
a material be found/organized the same way an exercise is, independent of the structured
topic/subtopic/level coverage claims.
"""

from django.conf import settings
from django.core.validators import MaxValueValidator, MinValueValidator
from django.db import models

from exercises.models import Tag
from taxonomy.models import Course, Subtopic, Topic

from .validators import validate_material_submission_file

MATERIAL_TYPE_CHOICES = [
    ('script', 'Course script'),
    ('exam_collection', 'Exam collection'),
    ('midterm_collection', 'Midterm collection'),
    ('exercise_collection', 'Exercise collection'),
    ('formula_sheet', 'Formula sheet'),
    ('lecture_slides', 'Lecture slides'),
    ('solution_guide', 'Solution guide'),
    ('syllabus', 'Syllabus'),
    ('practice_test', 'Practice test'),
    ('recording', 'Recorded lecture'),
    ('textbook_excerpt', 'Textbook excerpt'),
    ('code_dataset', 'Code / dataset'),
    ('other', 'Other'),
]

# A small, curated set — this app has no multi-currency payment processing anywhere, `price_amount`/
# `price_currency` are display-only fields (2026 follow-up to Section 17O's own price/time-estimate
# feature), so `choices=` here follows the exact same precedent MATERIAL_TYPE_CHOICES/DIFFICULTY
# already establish for a small, real enum rather than a bare, unvalidated CharField. Four currencies
# genuinely cover this platform's real, likely case (a Polish university, PLN-priced by default, with
# EUR/USD/GBP realistic for an international audience) — deliberately NOT exhaustive ISO-4217, the
# same "mirror a small enum, don't try to be a general-purpose currency picker" restraint this app's
# own DONATION_PLATFORMS/SOURCE_TYPES already apply elsewhere. See CLAUDE.md's own note on this
# decision for the real tradeoff (a governor wanting an exotic currency can't set one through the UI
# without a backend change) — flagged there, not silently accepted.
CURRENCY_CHOICES = [
    ('PLN', 'PLN'),
    ('EUR', 'EUR'),
    ('USD', 'USD'),
    ('GBP', 'GBP'),
]


class Material(models.Model):
    course = models.ForeignKey(Course, related_name='materials', on_delete=models.CASCADE)
    slug = models.SlugField()
    type = models.CharField(max_length=20, choices=MATERIAL_TYPE_CHOICES)
    # validators=[...] — same real content-type/size check materials.validators.
    # validate_material_submission_file already gives every user-submitted MaterialSubmission
    # (moderation/models.py), added here too for defense-in-depth consistency: a raw `.save()` call
    # (the corpus importer, or MaterialSubmission's own approval path copying an already-validated
    # file across) bypasses field validators entirely, by design — this only ever runs where
    # something is actually being VALIDATED (a ModelForm/DRF serializer write), not on every save.
    file = models.FileField(upload_to='materials/', validators=[validate_material_submission_file])
    # Free text, NOT a User FK — the real corpus's own material.yaml `author:` values are plain
    # human names (a course TA/professor), almost never a registered platform account, so this is
    # deliberately never rendered as a clickable link (frontend's own MaterialCard, see its doc
    # comment). `submitted_by` below is the genuinely DIFFERENT, real-account attribution this was
    # missing — mirrors `Exercise.submitted_by` exactly, and is what a community-submitted
    # material's own clickable byline actually resolves through.
    author = models.CharField(max_length=200, blank=True)
    # A found, real gap: `_apply_material_submission` (moderation/views.py) builds a real Material
    # from an approved MaterialSubmission — which already has a real `submitted_by` User — but
    # nothing ever carried that onto the resulting Material, so a community-submitted material had
    # NO real, clickable attribution at all, unlike Exercise's own `submitted_by`. Null for every
    # one of the 7 legacy corpus materials (imported with no submitter, matching
    # Exercise.submitted_by's own "null for migrated legacy content" convention) and for any
    # existing Material predating this field.
    submitted_by = models.ForeignKey(
        settings.AUTH_USER_MODEL, null=True, blank=True, on_delete=models.SET_NULL
    )
    tags = models.ManyToManyField(Tag, blank=True, related_name='materials')
    published = models.BooleanField(default=True)
    featured = models.BooleanField(default=False)
    order = models.PositiveIntegerField(default=0)
    # Added for the "search/filter/sort overhaul" — "sort by upload recency" was a real, explicitly
    # requested capability this model had no field to back at all before now. `auto_now_add=True`,
    # not a plain `DateTimeField()`, so the corpus importer and the moderation-approval path (which
    # never set this explicitly) still get a real, honest timestamp for free — same convention
    # Exercise.created_at already established.
    created_at = models.DateTimeField(auto_now_add=True)
    # Both genuinely optional — most materials stay free/no-estimate, exactly like the rest of this
    # 749-exercise, 7-material corpus today. `price_currency` only means anything once `price_amount`
    # is actually set (blank=True, not a forced 'PLN' the moment a material has no price at all).
    # `estimated_minutes` was chosen over a page-count "length" field (the other real option on the
    # table) because it's the more directly useful signal across every material type this app has —
    # a script, an exam collection, a slide deck — and doesn't require a page count nobody in this
    # corpus has ever actually recorded (material.yaml never carried one).
    price_amount = models.DecimalField(max_digits=8, decimal_places=2, null=True, blank=True)
    price_currency = models.CharField(max_length=3, choices=CURRENCY_CHOICES, default='PLN', blank=True)
    estimated_minutes = models.PositiveIntegerField(null=True, blank=True)

    class Meta:
        unique_together = [('course', 'slug')]
        ordering = ['course', 'order']

    def __str__(self) -> str:
        return f'{self.course.slug}/{self.slug}'


class MaterialReview(models.Model):
    """A star rating + optional written review on a Material — the same shape `community.Review`
    (Exercise) and `services.ServiceReview` (a tutoring listing) already establish, just targeting a
    Material instead. Kept as its own small model (not a generic FK) for the identical reason those
    two aren't unified into one either: a plain, direct FK is simpler than a GenericForeignKey for a
    review, which — unlike Comment — never needs to be reused across MORE than the one content type
    it was built for at a time; each of the three review models was added only once its own content
    type actually needed reviewing, matching this app's own "build what's asked, not a speculative
    generic system" restraint.
    """

    material = models.ForeignKey(Material, related_name='reviews', on_delete=models.CASCADE)
    author = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE)
    rating = models.PositiveSmallIntegerField(validators=[MinValueValidator(1), MaxValueValidator(5)])
    body = models.TextField(blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        unique_together = [('material', 'author')]  # one review per user per material, same as Review/ServiceReview

    def __str__(self) -> str:
        return f'{self.rating}★ by {self.author} on {self.material}'


# Shared by both MaterialRequirementVote AND MaterialCoverageVote below — "agree/disagree" is the
# identical real question for either kind of claim (is this REQUIREMENT actually needed / is this
# coverage LEVEL accurate), just voted on a different target row. One choices tuple, not two
# independently-drifting copies of the same two values.
VOTE_CHOICES = [(1, 'Agree'), (-1, 'Disagree')]


class MaterialRequirement(models.Model):
    """A loose, free-text prerequisite/skill label for actually USING this material — "English
    B2+", "basic algebra", "a graphing calculator". Deliberately NOT a fixed vocabulary, matching
    this codebase's own established style for similarly loose, per-item labels (Comment/Report's
    generic targeting aside, the closest real precedent is `ExerciseSource.collection`/`.name` —
    free text describing something about one specific row, not a `choices=` enum the way
    `Material.type`/`difficulty` are) — a requirement is whatever the uploader/governor actually
    typed, not a value chosen from a list this app would have to keep in sync with reality.

    `order` is a plain, user-controlled display order (not alphabetical, not creation-order) — the
    same "a plain PositiveIntegerField the client controls, not `auto_now_add`-derived" shape this
    app already uses for `Material.order`/`Course.order`/`Topic.order` itself.
    """

    material = models.ForeignKey(Material, related_name='requirements', on_delete=models.CASCADE)
    label = models.CharField(max_length=200)
    order = models.PositiveIntegerField(default=0)
    # Open to any authenticated user to PROPOSE (propose_requirement, materials/views.py) — the same
    # reason a Tag needs a real removal path, not just a resolved-with-no-effect report: a bad-faith
    # or simply wrong "skill tag" is live the instant it's proposed. Reused the same way `is_removed`
    # already tombstones a reported Comment/Review — filtered out of `MaterialSerializer.requirements`
    # for an ordinary reader, still present in the row for a moderator reviewing the report itself.
    is_removed = models.BooleanField(default=False)

    class Meta:
        ordering = ['order', 'id']

    def __str__(self) -> str:
        return f'{self.material}: {self.label}'


class MaterialRequirementVote(models.Model):
    """The exact same "is this claim accurate" weighted signal `MaterialCoverageVote` already
    provides for a coverage row, just targeting a MaterialRequirement instead — "split material
    tags into two groups (covers / requires), each votable, so users can sort by that." Weight is
    computed the same way, live, at read time (`materials/services.py`'s `_vote_weight`/
    `_net_vote_weight`, both already generic over any object exposing a `.votes` related manager —
    this model's own `related_name='votes'` is what makes that work without any change to either
    function)."""

    requirement = models.ForeignKey(MaterialRequirement, related_name='votes', on_delete=models.CASCADE)
    voter = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE)
    value = models.SmallIntegerField(choices=VOTE_CHOICES)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        unique_together = [('requirement', 'voter')]  # one vote per user per requirement

    def __str__(self) -> str:
        return f'{self.get_value_display()} by {self.voter} on {self.requirement}'


class MaterialView(models.Model):
    """One row per (user, material) — mirrors moderation.models.ContentView's own shape and
    reasoning exactly, just scoped to Material instead of Exercise: recorded the first time an
    authenticated user loads this material's own detail page (MaterialViewSet.retrieve, below).

    This is the real "have I already looked at this" engagement signal the materials search/
    filter/sort overhaul's own personalization engine (materials/services.py's
    get_recommended_materials) uses to DEPRIORITIZE — not hide — a material a visitor has already
    opened; a material worth resurfacing shouldn't vanish just because it was seen once. Guests
    aren't tracked, same honesty ContentView's own doc comment already states — there's no
    identity to key a row on. Deliberately no `unique_together`/extra Meta at all, mirroring
    ContentView's own shape exactly (that model enforces "one row per (user, exercise)" purely via
    `get_or_create` at the call site, not a DB constraint) rather than inventing a stricter
    guarantee for this new, structurally identical sibling.
    """

    user = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE)
    material = models.ForeignKey(Material, related_name='views', on_delete=models.CASCADE)
    viewed_at = models.DateTimeField(auto_now_add=True)

    def __str__(self) -> str:
        return f'{self.user} viewed {self.material}'


class MaterialCoverage(models.Model):
    """One (topic, subtopic?, level) claim about how deeply a Material treats that pairing.

    `level` is a single 1-100 self-assessed/community-verified depth score — deliberately NOT split
    into separate difficulty/time/requirement fields: the frontend derives a "what it covers" badge
    (any coverage row at all), a difficulty-ish bucket, and a rough relative-time weight from this
    one number, the same way a single confidence score can back several different UI readings
    without needing to be four separate inputs. `subtopic` is optional — a coverage row can claim
    topic-level coverage without breaking it down further.

    Anyone authenticated can propose a new coverage row (see materials/views.py's `coverage`
    action) — there's no moderation queue for this specific action, because the whole point of
    MaterialCoverageVote below is that the community verifies/corrects a claimed level
    collaboratively (a peer-review signal), not that a moderator gatekeeps it up front. Re-proposing
    an EXISTING (material, topic, subtopic) triple is rejected (unique_together), not silently
    overwritten — disagreeing with a claimed level is a vote/discussion, not a unilateral edit.
    """

    material = models.ForeignKey(Material, related_name='coverage', on_delete=models.CASCADE)
    topic = models.ForeignKey(Topic, related_name='material_coverage', on_delete=models.CASCADE)
    subtopic = models.ForeignKey(
        Subtopic, related_name='material_coverage', null=True, blank=True, on_delete=models.CASCADE
    )
    level = models.PositiveSmallIntegerField(validators=[MinValueValidator(1), MaxValueValidator(100)])
    proposed_by = models.ForeignKey(
        settings.AUTH_USER_MODEL, null=True, on_delete=models.SET_NULL
    )  # null for migrated legacy content, matching Exercise.submitted_by's own convention
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        unique_together = [('material', 'topic', 'subtopic')]
        ordering = ['topic', 'subtopic']

    def __str__(self) -> str:
        sub = f'/{self.subtopic.slug}' if self.subtopic else ''
        return f'{self.material}@{self.topic.slug}{sub}={self.level}'


class MaterialCoverageVote(models.Model):
    """A weighted "is this level accurate" signal on one MaterialCoverage claim.

    Weight is NOT stored on the vote itself — it's computed at read time (see
    materials/serializers.py's MaterialCoverageSerializer.get_vote_summary) from the voter's own
    `Profile.is_verified_contributor` (2x a plain registered user's 1x). Computing it live rather
    than snapshotting it at vote time means a later change to someone's contributor status is
    reflected on every vote they've ever cast immediately, not just future ones — the simpler,
    more honest behavior for what this weight is actually meant to represent (how much the
    platform trusts this person's judgment RIGHT NOW, not at some past moment).
    """

    coverage = models.ForeignKey(MaterialCoverage, related_name='votes', on_delete=models.CASCADE)
    voter = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE)
    value = models.SmallIntegerField(choices=VOTE_CHOICES)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        unique_together = [('coverage', 'voter')]  # one vote per user per coverage row

    def __str__(self) -> str:
        return f'{self.get_value_display()} by {self.voter} on {self.coverage}'


class MaterialTranslation(models.Model):
    material = models.ForeignKey(Material, related_name='translations', on_delete=models.CASCADE)
    locale = models.CharField(max_length=8)
    title = models.CharField(max_length=300)
    description = models.TextField(blank=True)

    class Meta:
        unique_together = [('material', 'locale')]

    def __str__(self) -> str:
        return f'{self.material} ({self.locale})'
