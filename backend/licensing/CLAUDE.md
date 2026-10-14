# licensing — the content licence, per item (2026-10-14)

Owner, 2026-10-14: the licence is *"not settled yet. should be specific to each exercise, materials
etc."* So there is no site-wide licence: each piece of content carries the one its author chose.

## The registry — `licences.py` (pure Python, no models)

Seven keys: `cc0-1.0` `cc-by-4.0` `cc-by-sa-4.0` `cc-by-nc-4.0` `cc-by-nc-sa-4.0` `edmat-only`
`unknown`. **Mirrored by hand** in `frontend/src/lib/types/licence.ts` (`LICENCE_KEYS`) and
`frontend/src/lib/utils/labels.ts` (`LICENCE_FACTS`, names, summaries) — both say so. A new key
also needs a migration on every model below, because the field freezes its `choices`.

- **No `-nd` licence.** A translation is a derivative; ND would forbid the site's own translations.
- **`edmat-only` is the default** — `/terms` § 9 point 2 alone, nothing opened without a choice.
- **`unknown` is never a person's choice** (`licence_validation_error` → `licence_not_selectable`).
  It is the corpus (LEGAL.md §3), an import with no declared licence, and staff's "rights in
  question" marker.
- `at_least_as_open(new, old)` is a **partial order**: BY-NC and BY-SA are incomparable.
- `derivative_licence(parent)` is the identity for every key (SA requires it; for the rest a
  different licence on a translation would be a trap for whoever reuses it).

## Which models carry a licence, and why each child does or does not

| Model | Field | Why |
|---|---|---|
| `exercises.Exercise` | own, chosen | the work; covers the statement and answer in the original language |
| `exercises.ExerciseTranslation` | own, **stamped, never chosen** | a derivative: `save()` copies the parent's licence at the moment it is written; it does NOT follow a later widening of the parent (the translator contributed under the old one). Original-language rows DO follow (`rules._carry_to_own_text`) — they are the exercise |
| `exercises.SolutionEntry` | own, chosen (composer) | a solution is its author's independent work, not a derivative of the statement; inheriting would let the exercise's author relicense somebody else's solution |
| `materials.Material` | own, chosen | the work |
| `coauthoring.MaterialProject` | drafting copy | copied onto the Material at first publication (`materials.publish.create_material`) |
| `coauthoring.MaterialVersion` | none | a contribution INTO the material under its licence (Wikipedia shape) |
| `concepts.ConceptArticle` | own, chosen | the work |
| `concepts.ConceptRevision` | none | a contribution into the article under its licence |
| `flashcards.Deck`, galleries, sketches, chem drawings | none | left open — a deck's cards are copies of exercises with differing licences; LEGAL.md §10 |

## The rules — `rules.py` (house boundary #2: every endpoint asks it)

`change_block_reason` returns a reason, never a boolean: `licence_not_author`,
`licence_not_selectable`, `licence_unchanged`, `licence_narrowing`, `licence_other_contributors`
(somebody else's version/revision is in the item — staff included, except staff clearing `unknown`
after the rights holder agreed), `licence_note_required` (staff acting without being the author).
`change_licence` is a WHERE-anchored `UPDATE … WHERE licence=<old>` (→ `licence_conflict`, 409) plus
a `LicenceChange` row. Creation writes no row: `created_at` is the date of the first grant, and
`licence_since` falls back to it.

`targets.py` is the kind registry (`exercise`, `solution_entry`, `material`, `concept_article`):
who the authors are, who the contributors are, whether a stranger may see it (404 otherwise).

## Endpoints

`GET|POST /api/licences/<kind>/<id>/` — the reading (`licence`, `since`, `history`, `can_change`,
`allowed`) and the change. **No kill switch**, deliberately, like `legal`: what a reader may do with
content cannot be switched off while the content is up. The key itself rides on every exercise,
solution, material, project, queue row and concept-article serializer; `?licence=` filters the
exercise and material lists.

## Write paths that set it

`/submit` payload `licence` (validated in `ExerciseSubmissionSerializer.validate_payload`, re-checked
in `_submission_licence`; the founding hint/solution get the same); `POST /exercises/{id}/entries/`;
`POST /material-projects/` (+ PATCH while drafting); `POST /concepts/` and
`/concepts/{slug}/articles/`; `manage.py import_exercises` (`licence:` per file / `batch.yaml` /
`--licence`, default `unknown`, a re-run only widens and records). The Django admin shows `licence`
read-only on every licensed model — the admin must not be a way around "only widen, and record it".

## Data migration (2026-10-14)

`exercises 0015`, `materials 0019`, `coauthoring 0004`, `concepts 0002` — classification and counts
in LEGAL.md §2. The rule: an exercise is `edmat-only` only with a kept `ExerciseSubmission` behind
it (NOT `submitted_by` — `seed_demo_content` credits corpus rows to demo accounts); a corpus
original hint/solution (no author, or pinned, on an `unknown` exercise) and a material with no
submitter or a file under `materials/` → `unknown`; everything a person wrote through the site →
`edmat-only`.
