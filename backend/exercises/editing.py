"""Who may edit an exercise in place, and what that edit writes (2026-10-21).

Owner: *"even though im a superadmin and author of a specific exercise, there's no edit option …
and there should"*. Until now the only way to change a published exercise was a suggestion into
the moderation queue — right for a stranger, absurd for the person who wrote it. The rule, asked
by `ExerciseViewSet.partial_update` and by the detail serializer's `can_edit` (house boundary #2):

- the author (`Exercise.submitted_by`) or staff may edit; anybody else gets `exercise_not_editor`
  (403 — they can see it, they may not change it) and keeps the "suggest an edit" path;
- an edit writes the text onto the ORIGINAL-locale published translation and records each text
  change as an APPROVED `moderation.EditSuggestion` by the editor (house rule 12: the record of a
  decision), so an exercise's history reads the same whether a change arrived as a suggestion or
  as an edit;
- structural fields (difficulty, audience, topics, tags, source) write straight onto the row.

What this closed on the same day: `ExerciseViewSet` was a `ModelViewSet` with
`IsAuthenticatedOrReadOnly` and no write guard, so ANY signed-in account could `PATCH`
`difficulty` (or `published`) on any exercise — found by trying it. `PUT` and `DELETE` are gone
(`http_method_names`), `PATCH` asks this module first.
"""

from __future__ import annotations


def edit_block_reason(user, exercise) -> str | None:
    if user is None or not getattr(user, 'is_authenticated', False):
        return 'exercise_not_signed_in'
    if user.is_staff:
        return None
    if exercise.submitted_by_id is not None and exercise.submitted_by_id == user.id:
        return None
    return 'exercise_not_editor'


def can_edit(user, exercise) -> bool:
    return edit_block_reason(user, exercise) is None
