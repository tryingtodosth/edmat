"""ExerciseSet — "Mój zestaw" — server-side, for registered users only. Guests use localStorage
(unchanged frontend behavior, CLAUDE.md Section 6/7) — this model is only ever populated for a
registered user's own sets, never a guest's."""

import secrets

from django.conf import settings
from django.db import models

from exercises.models import Exercise


def _generate_set_slug() -> str:
    """A cryptographically random, unguessable identifier (secrets.token_urlsafe, NOT a sequential
    id) — the actual mechanism behind the privacy model below: a PRIVATE set's link is worthless to
    guess (72 bits of entropy from 9 random bytes), so "is_public" only ever needs to gate whether a
    real link is reachable at all, not defend against someone enumerating small integers."""
    return secrets.token_urlsafe(9)


class ExerciseSet(models.Model):
    owner = models.ForeignKey(settings.AUTH_USER_MODEL, related_name='exercise_sets', on_delete=models.CASCADE)
    name = models.CharField(max_length=100)
    exercises = models.ManyToManyField(Exercise, through='ExerciseSetItem')
    # The external identifier this whole API resolves a set BY (ExerciseSetViewSet.lookup_field) —
    # matching the exact same "id IS the slug" convention Field/Course already use, rather than a
    # numeric-pk/slug split invented just for this one model. Auto-generated, never user-editable —
    # a set has no real reason to want a vanity URL the way a Course does.
    slug = models.SlugField(max_length=16, unique=True, default=_generate_set_slug, editable=False)
    # Privacy — new sets are PRIVATE by default (a deliberate opt-IN model): the owner has to
    # actively decide to share before a stranger holding the link can open it at all. Toggling this
    # off after sharing is a real, working "unshare" — CLAUDE.md Section 17J's own "Left open" note
    # ("no unshare/revoke mechanism") is what this field resolves.
    is_public = models.BooleanField(default=False)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ['-created_at']

    def __str__(self) -> str:
        return f'{self.name} (owned by {self.owner})'


class ExerciseSetItem(models.Model):
    exercise_set = models.ForeignKey(ExerciseSet, on_delete=models.CASCADE)
    exercise = models.ForeignKey(Exercise, on_delete=models.CASCADE)
    order = models.PositiveIntegerField(default=0)
    # Per-exercise "what to include beyond the statement" — the statement itself is always shown
    # (a set with none of these three is exactly today's original behavior, unchanged). Persisted
    # here, not a client-side-only display toggle, so a saved/shared set remembers and shows the
    # SAME content to whoever it's shared with, not just to the person who happened to check a box
    # in their own browser session.
    include_hint = models.BooleanField(default=False)
    include_answer = models.BooleanField(default=False)
    include_solution = models.BooleanField(default=False)

    class Meta:
        unique_together = [('exercise_set', 'exercise')]
        ordering = ['order']
