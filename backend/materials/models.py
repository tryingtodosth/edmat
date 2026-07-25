"""materiał dydaktyczny — see CLAUDE.md Section 9.

Type choices were widened from the section's own sketch (`script`/`formula_sheet`/`other`) to match
what the real corpus's own material.yaml `type:` field actually uses — none of the 7 real materials
are a formula sheet; they're a script, exam collection, midterm collection, or exercise collection.
"""

from django.db import models

from taxonomy.models import Course, Topic

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
    topics = models.ManyToManyField(Topic, related_name='materials', blank=True)
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


class MaterialTranslation(models.Model):
    material = models.ForeignKey(Material, related_name='translations', on_delete=models.CASCADE)
    locale = models.CharField(max_length=8)
    title = models.CharField(max_length=300)
    description = models.TextField(blank=True)

    class Meta:
        unique_together = [('material', 'locale')]

    def __str__(self) -> str:
        return f'{self.material} ({self.locale})'
