"""Taxonomy models — mirrors content/fields/*.yaml and each course.yaml's own topics[] exactly.

See CLAUDE.md Section 9. One deviation from that section's own sketch, made while grounding these
models against the real corpus (Database-of-Student-Exercise/content/): Course and Topic both carry
a human-language `name` (and Course a `description`) in the source YAML, exactly like Field does — so
both get their own translation table here (CourseTranslation/TopicTranslation), matching Field's own
FieldTranslation pattern, not left as untranslatable plain CharFields the way the original sketch
implied by omission.
"""

from django.db import models


class Field(models.Model):
    """kierunek — matematyka / informatyka / fizyka."""

    slug = models.SlugField(unique=True)
    published = models.BooleanField(default=True)

    def __str__(self) -> str:
        return self.slug


class FieldTranslation(models.Model):
    field = models.ForeignKey(Field, related_name='translations', on_delete=models.CASCADE)
    locale = models.CharField(max_length=8)
    name = models.CharField(max_length=200)
    description = models.TextField(blank=True)

    class Meta:
        unique_together = [('field', 'locale')]

    def __str__(self) -> str:
        return f'{self.field.slug} ({self.locale})'


class Course(models.Model):
    """przedmiot."""

    slug = models.SlugField(unique=True)
    field = models.ForeignKey(Field, related_name='courses', on_delete=models.PROTECT)
    university = models.CharField(max_length=200)
    published = models.BooleanField(default=True)
    order = models.PositiveIntegerField(default=0)

    class Meta:
        ordering = ['order', 'slug']

    def __str__(self) -> str:
        return self.slug


class CourseTranslation(models.Model):
    course = models.ForeignKey(Course, related_name='translations', on_delete=models.CASCADE)
    locale = models.CharField(max_length=8)
    name = models.CharField(max_length=200)
    description = models.TextField(blank=True)

    class Meta:
        unique_together = [('course', 'locale')]

    def __str__(self) -> str:
        return f'{self.course.slug} ({self.locale})'


class Topic(models.Model):
    """dział — COURSE-SCOPED, matching the existing data exactly (topic ids repeat across courses)."""

    slug = models.SlugField()
    course = models.ForeignKey(Course, related_name='topics', on_delete=models.CASCADE)
    order = models.PositiveIntegerField(default=0)

    class Meta:
        unique_together = [('course', 'slug')]
        ordering = ['course', 'order']

    def __str__(self) -> str:
        return f'{self.course.slug}/{self.slug}'


class TopicTranslation(models.Model):
    topic = models.ForeignKey(Topic, related_name='translations', on_delete=models.CASCADE)
    locale = models.CharField(max_length=8)
    name = models.CharField(max_length=300)

    class Meta:
        unique_together = [('topic', 'locale')]

    def __str__(self) -> str:
        return f'{self.topic} ({self.locale})'


class Subtopic(models.Model):
    """A finer-grained breakdown within a Topic — e.g. within `ekstrema` (extrema), a subtopic
    might be `ekstrema-warunkowe` (constrained extrema). Topic-scoped the same way Topic is
    course-scoped, one level deeper — added to back Material's own coverage claims (materials
    app: MaterialCoverage), which pin down not just "this material touches Topic X" but how
    deeply, at what granularity.
    """

    slug = models.SlugField()
    topic = models.ForeignKey(Topic, related_name='subtopics', on_delete=models.CASCADE)
    order = models.PositiveIntegerField(default=0)

    class Meta:
        unique_together = [('topic', 'slug')]
        ordering = ['topic', 'order']

    def __str__(self) -> str:
        return f'{self.topic}/{self.slug}'


class SubtopicTranslation(models.Model):
    subtopic = models.ForeignKey(Subtopic, related_name='translations', on_delete=models.CASCADE)
    locale = models.CharField(max_length=8)
    name = models.CharField(max_length=300)

    class Meta:
        unique_together = [('subtopic', 'locale')]

    def __str__(self) -> str:
        return f'{self.subtopic} ({self.locale})'


class Chapter(models.Model):
    """From mapa_rozdzialow.yaml — optional textbook cross-reference, course-scoped."""

    course = models.ForeignKey(Course, related_name='chapters', on_delete=models.CASCADE)
    number = models.PositiveIntegerField()
    start_page = models.PositiveIntegerField(null=True, blank=True)
    topics = models.ManyToManyField(Topic, related_name='chapters', blank=True)

    class Meta:
        unique_together = [('course', 'number')]
        ordering = ['course', 'number']

    def __str__(self) -> str:
        return f'{self.course.slug} ch.{self.number}'


class ChapterTranslation(models.Model):
    chapter = models.ForeignKey(Chapter, related_name='translations', on_delete=models.CASCADE)
    locale = models.CharField(max_length=8)
    title = models.CharField(max_length=300)

    class Meta:
        unique_together = [('chapter', 'locale')]

    def __str__(self) -> str:
        return f'{self.chapter} ({self.locale})'
