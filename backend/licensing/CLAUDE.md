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
`--licence`, default `unknown`, a re-run only widens and records); `manage.py import_concepts` (the same
declaration chain onto `ConceptArticle.licence`; a re-run widens through `rules.change_licence` as the
article's author, so it is refused once somebody else's revision is in the article). The Django admin shows `licence`
read-only on every licensed model — the admin must not be a way around "only widen, and record it".

## The bulk move — `manage.py relicense_content` (2026-10-21)

Owner: *"i want to add CC BY-SA 4.0 to all currently posted content"*. `relicense_content --to
<key> --by <staff> --note "<basis>" [--kinds …] [--dry-run]` walks every POSTED item of the four
kinds and calls `rules.change_licence` on each — it adds **no authority** of its own. So it moves
`unknown` content (the staff exception; the note says on what basis the rights were cleared and
rides on every `LicenceChange` row) and the caller's own content, leaves alone what is already at
least as open, and **refuses another person's `edmat-only` content** (`licence_other_contributors`,
listed by id): `/terms` § 9 point 2 gave the operator an operating licence, not the right to grant
the world one — those authors widen it themselves from the item page, or a CLA (LEGAL.md §3 item 4)
is written first. Unpublished, removed and auto-hidden items are not posted and keep what they have.
A dry run does the walk in a transaction and rolls it back. **`--author <username>`** (2026-10-22, owner: Marysia's work →
`cc-by-nc-4.0`) narrows the walk to that account's content plus the authorless hints/solutions on its own
exercises (the corpus originals; `_belongs_to`), and must run BEFORE a wider sweep to a licence it is
incomparable with — once BY-NC, a BY-SA sweep refuses it as `licence_narrowing` (pinned by a test).

## A person's own content, in bulk — `bulk.py` (2026-10-22)

Owner: *"improve the way user can decide/edit their contents' licence in bulk"*. `GET
/api/licences/mine/` lists every POSTED item of the four kinds the caller is an author of
(`Kind.authors` — so a solution on somebody else's exercise is listed, and a material's project
owners count), with `allowed` (the rules' own `allowed_targets`) and, when that is empty, a
`blocked_reason` asked of the rules against `cc0-1.0` (`licence_other_contributors`, or the
module's `licence_already_most_open`). Bounded at `MINE_LIMIT_PER_KIND` = 2000 LISTED items per kind,
newest first, with `truncated` — iterated, not sliced, so drafts in the queryset never eat a place.
`POST /api/licences/bulk/ {to, items:[{kind,id}]}` (≤ `BULK_MAX_ITEMS` = 500, deduplicated) puts each
through `rules.change_licence` as the caller, one WHERE-anchored UPDATE each, **no transaction around
the loop** (SQLite rule 2) — partial success is the answer, a result per item with the rules' reason.
**Authorship only, staff included**: an item that is missing, not posted, or not the caller's is the
same `licence_not_found` (a list of ids must not probe for unpublished ones), so staff get no extra
reach here — the staff sweep is `relicense_content`. 400 for a malformed request (the
`licence_bulk_*` words), 401 anonymous, 429 past `licence_bulk` (30/hour, a `UserRateThrottle`
subclass, never `ScopedRateThrottle`). The page is `/settings/licences`; every word has a sentence in
`labels.ts: licenceReasonLabel` (mirror, house rule 13). Tests: `licensing/test_bulk.py`.

## A person's default for new content (2026-10-22)

`accounts.Profile.default_licence` (`accounts 0028`), blank = none chosen (each form keeps its own
suggestion). Patched through `/api/auth/me/`, validated with `licence_validation_error` (`unknown`
refused). The frontend reads it in ONE place, `LicencePicker.svelte`, which starts from it on every
create form except one that names a source (the source guard keeps `edmat-only`). A prefill only —
no write path reads it to decide anything; `rules.default_licence_for(user)` is the server-side
reader for a path with no form, and resolves blank/anonymous/stale to `edmat-only`.

## Data migration (2026-10-14)

`exercises 0015`, `materials 0019`, `coauthoring 0004`, `concepts 0002` — classification and counts
in LEGAL.md §2. The rule: an exercise is `edmat-only` only with a kept `ExerciseSubmission` behind
it (NOT `submitted_by` — `seed_demo_content` credits corpus rows to demo accounts); a corpus
original hint/solution (no author, or pinned, on an `unknown` exercise) and a material with no
submitter or a file under `materials/` → `unknown`; everything a person wrote through the site →
`edmat-only`.
