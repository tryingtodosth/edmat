"""materiał dydaktyczny — see CLAUDE.md Section 9.

Type choices were widened from the section's own sketch (`script`/`formula_sheet`/`other`) to match
what the real corpus's own material.yaml `type:` field actually uses — none of the 7 real materials
are a formula sheet; they're a script, exam collection, midterm collection, or exercise collection.

`Material.topics` (a flat, weightless ManyToManyField to Topic) was replaced outright by
MaterialCoverage below, not kept alongside it — "which topics does this material cover" is now
`coverage.values_list('topic', flat=True).distinct()` rather than a second, competing source of
truth that could drift from the richer one.
"""

from django.conf import settings
from django.core.validators import MaxValueValidator, MinValueValidator
from django.db import models

from taxonomy.models import Course, Subtopic, Topic

MATERIAL_TYPE_CHOICES = [
    ('script', 'Course script'),
    ('exam_collection', 'Exam collection'),
    ('midterm_collection', 'Midterm collection'),
    ('exercise_collection', 'Exercise collection'),
    ('other', 'Other'),
]


class Material(models.Model):
    course = models.ForeignKey(Course, related_name='materials', on_delete=models.CASCADE)
    slug = models.SlugField()
    type = models.CharField(max_length=20, choices=MATERIAL_TYPE_CHOICES)
    file = models.FileField(upload_to='materials/')
    author = models.CharField(max_length=200, blank=True)
    published = models.BooleanField(default=True)
    featured = models.BooleanField(default=False)
    order = models.PositiveIntegerField(default=0)

    class Meta:
        unique_together = [('course', 'slug')]
        ordering = ['course', 'order']

    def __str__(self) -> str:
        return f'{self.course.slug}/{self.slug}'


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


COVERAGE_VOTE_CHOICES = [(1, 'Agree'), (-1, 'Disagree')]


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
    value = models.SmallIntegerField(choices=COVERAGE_VOTE_CHOICES)
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
