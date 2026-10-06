# The other three routes in, and why one of them is dead

## 1. `POST /api/exercise-submissions/` — the contribution route

Use this when the exercise is **somebody's contribution**, not an import: it goes through review,
it is attributed, and it is what the `/submit` form does.

```http
POST /api/exercise-submissions/        Authorization: Token <token>
{ "branch": "analiza-matematyczna",
  "payload": { "title": "...", "statement": "...", "answer": "...", "hint": "...",
               "solution": "...", "difficulty": "hard", "audience": "university",
               "locale": "pl", "topic_ids": [12, 14], "tags": ["calka-gaussa"],
               "requirements": ["pochodna cząstkowa"],
               "source": {"type": "exam", "name": "Egzamin 2025", "pages": "12"},
               "material_id": 7, "material_role": "source", "material_locator": "s. 12" } }
```

- `branch` is the **slug**; `topic_ids` are numeric pks. `payload` is a free JSON draft — only
  `requirements` is validated at submission time.
- It lands `pending` in the moderation queue. A moderator decides with
  `POST /api/moderation/submission/{id}/approve/` (or `/reject/`, which **requires** a note).
  Approval is where the number is allocated (bounded retry), the published translation is created,
  and the hint/solution become `SolutionEntry` rows — pinned only because a moderator approved.
- **Exception:** a submitter with `Profile.is_verified_contributor` is published immediately, with
  `reviewed_by` left null and a `review_note` saying so, and the entries **not** pinned — nobody
  reviewed it. An edit suggestion or a translation from the same person still queues.
- Gated by the `exercise_submissions` feature flag for every action, not just create.
- 20 exercises through this route means 20 queue rows for a human to click. That is the point of it;
  it is also why it is the wrong tool for a batch.

## 2. Adding a translation of an exercise that already exists

Importing the same exercise twice in two languages is wrong — one exercise, many
`ExerciseTranslation` rows:

```http
POST /api/exercises/{id}/translations/   { "locale": "en", "title": "...", "statement": "...", "answer": "..." }
```

It queues for review (always — the verified-contributor fast path does not apply). On approval the
superseded published row is deleted **first**, then the pending row is flipped with a WHERE-anchored
update; a lost race is a 409. At most one *published* row per (exercise, locale); pending and
rejected rows for the same locale are legal. Hints and solutions are not translations — they are
`SolutionEntry` rows with their own `locale` (`GET|POST /api/exercises/{id}/entries/`; every trust
rule — who may publish without review, who may review — lives in `exercises/entries.py`).

## 3. `manage.py import_legacy_corpus` — do not use, do not repair

It is the one-time migration that brought `Database-of-Student-Exercise/content/` in, and it has not
been runnable since the taxonomy restructure (commit 420bf41, `Field` → `Discipline`,
`Course` → `Branch`). Three independent breakages, verified by running it on 2026-10-01:

1. `DisciplineTranslation.objects.update_or_create(field=field, …)` → `FieldError: Cannot resolve
   keyword 'field'` — the FK is `discipline` now. Same for `Branch(field=…)`.
2. `Branch.objects.update_or_create(..., defaults={'university': …})` — `Branch` has no `university`;
   a university is a `courses.Course` concern now.
3. It globs `content/branches/*/branch.yaml`; the corpus on disk is `content/courses/*/course.yaml`.

Repairing it would also be wrong, not just unnecessary: its slugs are the pre-restructure shape
(`uw-matematyka-am2`, a university's subject), so a "fixed" run would recreate exactly the
conflation the restructure removed. Treat the file as provenance for how the 742 corpus rows got
here. The 746 rows in the current database are the migrated result, not something to re-import.

## 4. A hand-written ORM script

Fine for a one-off fix, wrong for an import, and if you do it anyway these are the four things that
go wrong in that order:

1. `Exercise(verified=True)` — derived; call `exercises.signals.recount_verified(pk)` instead.
2. `number` — `(branch, number)` is unique; read the max and expect to lose a race with the live site.
3. `ExerciseTranslation(status=...)` — a second *published* row for a locale violates a partial
   unique constraint; a pending one does not.
4. `.update()` on entries fires no signal, so `verified` silently rots (house rule 5's stated limit).

`manage.py import_exercises` exists so that none of that has to be remembered twice.
