"""The exercise itself — structural fields only. All human-language text lives in
ExerciseTranslation, one row per (exercise, locale) pair, including the original language.
See CLAUDE.md Section 9 and Section 10 for why this split isn't "original fields on Exercise,
translations elsewhere."
"""

from django.conf import settings
from django.db import models

from taxonomy.models import Course, Topic

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
    per-exercise `tags:` lists."""

    slug = models.SlugField(unique=True)

    def __str__(self) -> str:
        return self.slug


class Exercise(models.Model):
    course = models.ForeignKey(Course, related_name='exercises', on_delete=models.CASCADE)
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
        unique_together = [('course', 'number')]
        ordering = ['course', 'number']

    def __str__(self) -> str:
        return f'{self.course.slug}-{self.number:04d}'


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
        # At most one row per (exercise, locale, status) — in practice this means at most one
        # PUBLISHED version per locale, while still allowing a new pending resubmission after a
        # rejection (a fresh 'pending' row) to coexist with the still-live 'published' one.
        unique_together = [('exercise', 'locale', 'status')]
        ordering = ['exercise', 'locale']

    def __str__(self) -> str:
        return f'{self.exercise} [{self.locale}/{self.status}]'
