"""Sub-exercises — the parts of a set-shaped exercise (`SUBEXERCISES-BRIEF.md`, 2026-10-21).

The ONE module every surface asks about parts (root CLAUDE.md, boundary #2): which parts an
exercise has, how a part's text is resolved for a reader's language, whether an entry's `part`
belongs to the exercise it is posted on, and — step A of the build — the "verified" clause for a
set (a passed solution for the whole, or one for every part), the author's/staff's edit of the
whole list (`parts_payload_refusal` + `apply_parts`, behind `PATCH /api/exercises/{id}/`), and an
approved edit suggestion's write into one part (`write_part_text`). Endpoints and the importer
call these; none re-implements them.

Refusal words this module returns (mirrored in the frontend's `labels.ts`; `exercises/CLAUDE.md`
"Parts" lists every one with its surface): `part_not_of_exercise`, `parts_too_many`,
`part_label_duplicate`, `part_id_duplicate`. `part_immutable` (an entry PATCH) lives on
`SolutionEntryCreateSerializer.validate_part`; `part_and_entry` and `part_field_invalid` (an edit
suggestion) on `moderation.serializers.EditSuggestionSerializer.validate`.

A part carries NO licence of its own, by design: it is the exercise's own text and moves with
the exercise (`licensing/rules.py: _carry_to_own_text` says why there is nothing to move).
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


# --- step A: the derived "verified" clause for a set --------------------------------------------


def verified_by_parts(exercise_id, passed=None) -> bool:
    """True when the exercise HAS parts and every one of them has at least one passed solution of
    its own — the second half of `signals.recount_verified`'s rule ("a passed solution for the
    whole, OR one for every part"). An exercise with no parts is never verified by this clause: the
    whole-exercise clause is the only one that applies to it, exactly as before parts existed.

    `passed` is the caller's queryset of passed solutions (`signals.passed_solutions`), handed in
    so the definition of "passed" — pinned, reviewed or verified-authored, AI-assisted only once
    reviewed — lives in ONE place and this clause only adds "for which parts"."""
    part_ids = set(ExercisePart.objects.filter(exercise_id=exercise_id).values_list('pk', flat=True))
    if not part_ids:
        return False
    if passed is None:
        from .signals import passed_solutions

        passed = passed_solutions(exercise_id)
    solved = set(passed.filter(part_id__in=part_ids).values_list('part_id', flat=True).distinct())
    return solved >= part_ids


# --- step A: the author's / staff's in-place edit of the parts (PATCH /api/exercises/{id}/) -----

#: More than this many parts is refused (`parts_too_many`): a set with more items than the
#: alphabet has letters is a sheet, and is several exercises.
MAX_PARTS = 26


def parts_payload_refusal(exercise: Exercise, items: list[dict]) -> str | None:
    """Why the PATCH's `parts` list may not be applied to `exercise`, or None. Asked by
    `ExerciseEditSerializer.validate_parts`; the words are mirrored in the frontend's `labels.ts`
    (`exercises/CLAUDE.md`, "Parts", lists them):

    - `parts_too_many` — more than `MAX_PARTS` items;
    - `part_not_of_exercise` — an `id` that is not a part of THIS exercise (a stranger's part, a
      deleted one, a made-up number — all the same answer, nothing about the other row leaks);
    - `part_id_duplicate` — the same `id` twice (the form cannot send it; a hand-built body can);
    - `part_label_duplicate` — two items with the same label (compared after trimming, as shown)."""
    if len(items) > MAX_PARTS:
        return 'parts_too_many'
    own = set(ExercisePart.objects.filter(exercise=exercise).values_list('pk', flat=True))
    ids = [item['id'] for item in items if item.get('id') is not None]
    if any(pk not in own for pk in ids):
        return 'part_not_of_exercise'
    if len(ids) != len(set(ids)):
        return 'part_id_duplicate'
    labels = [item['label'].strip() for item in items]
    if len(labels) != len(set(labels)):
        return 'part_label_duplicate'
    return None


def apply_parts(exercise: Exercise, items: list[dict], user) -> None:
    """Make the exercise's parts exactly `items` (already validated by `parts_payload_refusal`):

    - a known part missing from the list is DELETED, and its entries and edit suggestions with it
      (both FKs CASCADE — the form says so before it sends the list);
    - an item without `id` creates a part, an item with one updates its label and text;
    - `order` is the list position, 1-based, rewritten on every save;
    - text goes onto the part's ORIGINAL-locale published translation row (created if missing),
      and every changed field is recorded as an APPROVED `moderation.EditSuggestion` with
      `part=<part>` by the editor — the same record the shared statement's edit leaves.

    The caller holds the transaction (`ExerciseEditSerializer.apply`). The verified flag follows
    through the `ExercisePart` and `SolutionEntry` signals (`exercises/signals.py`)."""
    from config.sanitize import sanitize_content
    from moderation.models import EditSuggestion

    locale = exercise.original_locale
    keep = {item['id'] for item in items if item.get('id') is not None}
    for gone in ExercisePart.objects.filter(exercise=exercise).exclude(pk__in=keep):
        gone.delete()  # per row, so every signal fires (the entries' and the part's own recount)

    # Move every surviving part out of the way first: `(exercise, order)` is unique, and a swap of
    # (a) and (b) written straight in would collide half-way through.
    existing = list(ExercisePart.objects.filter(exercise=exercise).values_list('order', flat=True))
    parking = max(existing + [len(items)]) + 1
    for offset, pk in enumerate(sorted(keep)):
        ExercisePart.objects.filter(pk=pk).update(order=parking + offset)

    for position, item in enumerate(items, start=1):
        label = item['label'].strip()
        if item.get('id') is not None:
            part = ExercisePart.objects.get(pk=item['id'])
            ExercisePart.objects.filter(pk=part.pk).update(order=position, label=label)
        else:
            part = ExercisePart.objects.create(exercise=exercise, order=position, label=label)
        row = ExercisePartTranslation.objects.filter(part=part, locale=locale, status='published').first()
        wanted = {
            'statement': sanitize_content(item['statement']),
            'answer': sanitize_content(item.get('answer') or ''),
        }
        if row is None:
            row = ExercisePartTranslation(part=part, locale=locale, status='published', statement='', answer='')
        changed = [f for f, value in wanted.items() if getattr(row, f) != value]
        if not changed:
            continue
        for f in changed:
            setattr(row, f, wanted[f])
        row.save()
        for f in changed:
            EditSuggestion.objects.create(
                exercise=exercise, part=part, locale=locale, field=f,
                proposed_value=getattr(row, f), reason='', submitted_by=user,
                status='approved', reviewed_by=user,
            )


# --- step A: an approved edit suggestion against one part ---------------------------------------


def write_part_text(part: ExercisePart, locale: str, field: str, value: str) -> ExercisePartTranslation:
    """Write an approved suggestion's `value` into `field` ('statement' | 'answer') of the part's
    PUBLISHED row for `locale` — `moderation.views._apply_edit_suggestion`'s part branch, the
    counterpart of its `ExerciseTranslation` write.

    A row that does not exist yet is created, and it starts as a COPY of the text the reader of
    that language was already shown (the original-locale fallback, `part_text`): otherwise a
    suggested English answer would create an English row with an empty statement, and the English
    reader would lose the (Polish) statement they could read the moment before. The suggestion
    serializer only accepts a locale the exercise itself has a translation in, so this never
    originates a language the exercise does not speak."""
    if field not in ('statement', 'answer'):
        raise ValueError(f'a part has no {field!r}')
    row = ExercisePartTranslation.objects.filter(part=part, locale=locale, status='published').first()
    if row is None:
        fallback = part_text(part, locale)
        row = ExercisePartTranslation(
            part=part,
            locale=locale,
            status='published',
            statement=fallback.statement if fallback else '',
            answer=fallback.answer if fallback else '',
        )
    setattr(row, field, value)
    row.save()
    return row
