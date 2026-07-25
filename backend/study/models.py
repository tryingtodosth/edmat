"""ExerciseSet — "Mój zestaw" — server-side, for registered users only. Guests use localStorage
(unchanged frontend behavior, CLAUDE.md Section 6/7) — this model is only ever populated for a
registered user's own sets, never a guest's."""

from django.conf import settings
from django.db import models

from exercises.models import Exercise


class ExerciseSet(models.Model):
    owner = models.ForeignKey(settings.AUTH_USER_MODEL, related_name='exercise_sets', on_delete=models.CASCADE)
    name = models.CharField(max_length=100)
    exercises = models.ManyToManyField(Exercise, through='ExerciseSetItem')
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ['-created_at']

    def __str__(self) -> str:
        return f'{self.name} (owned by {self.owner})'


class ExerciseSetItem(models.Model):
    exercise_set = models.ForeignKey(ExerciseSet, on_delete=models.CASCADE)
    exercise = models.ForeignKey(Exercise, on_delete=models.CASCADE)
    order = models.PositiveIntegerField(default=0)

    class Meta:
        unique_together = [('exercise_set', 'exercise')]
        ordering = ['order']
