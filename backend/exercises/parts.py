"""Sub-exercises — the parts of a set-shaped exercise (`SUBEXERCISES-BRIEF.md`, 2026-10-21).

The ONE module every surface asks about parts (root CLAUDE.md, boundary #2): which parts an
exercise has, how a part's text is resolved for a reader's language, whether an entry's `part`
belongs to the exercise it is posted on, and — step A of the build — the "verified" clause for a
set (a passed solution for the whole, or one for every part). Endpoints and the importer call
these; none re-implements them.
"""

from __future__ import annotations

from .models import Exercise, ExercisePart, ExercisePartTranslation


def parts_of(exercise: Exercise) -> list[ExercisePart]:
    """Every part of the exercise in order. Reads `.all()` so a `prefetch_related('parts')`
    on the caller's queryset is honoured (the same reason `_published_translations` does)."""
    return list(exercise.parts.all())


def part_text(part: ExercisePart, locale: str) -> ExercisePartTranslation | None:
    """The published row for `locale`, else the exercise's original locale, else any — the same
    fallback the statement gets (`ExerciseListSerializer._translation`). Cached on the part row,
    never on a serializer (the `many=True` trap in `exercises/CLAUDE.md`)."""
    if not hasattr(part, '_cached_published_translations'):
        part._cached_published_translations = [
            t for t in part.translations.all() if t.status == 'published'
        ]
    by_locale = {t.locale: t for t in part._cached_published_translations}
    return (
        by_locale.get(locale)
        or by_locale.get(part.exercise.original_locale)
        or next(iter(by_locale.values()), None)
    )


def part_refusal(exercise: Exercise, part: ExercisePart | None) -> str | None:
    """Why `part` may not be attached to something on `exercise`: `part_not_of_exercise`, or
    None when it may (including the whole-exercise case, `part=None`)."""
    if part is None:
        return None
    if part.exercise_id != exercise.pk:
        return 'part_not_of_exercise'
    return None
