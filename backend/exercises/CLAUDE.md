# exercises — the core content model (742-exercise corpus lives here)

`Exercise` is structural only (branch, number, topics, difficulty, tags, published, verified,
`original_locale`, `submitted_by` — null for migrated corpus rows). Translation text lives in
`ExerciseTranslation`, one row per (exercise, locale, status) **including the original**
(`translated_by=None`, locale='pl' for corpus rows) — **title/statement/answer ONLY since
2026-08-27**: hints/solutions moved to the `SolutionEntry` pool (below, migrations 0009–0011,
columns dropped). Also: `ExerciseSource` (+ translation), `Tag` + `TagFollow` (per-tag `notify`
is separate from following), `ExerciseRequirement` (+ vote).

## The solution/hint pool (`SolutionEntry`, root `HISTORY.md` §17AH)

Peer hints/solutions per exercise: one language each, ▲/▼ votes (verified-contributor weight 2×),
`pinned` corpus originals first then net score, per-entry Comment thread + reports/auto-hide.
`exercises/entries.py` owns EVERY trust rule (publish-without-review, reviewer circle, edit-
suggestion deciding circle, per-caller visibility, ordering) — and is the seam for the future
SKILL expert tier. One review path only: `POST /solution-entries/{id}/review/` (one accept
publishes; a deny REQUIRES a note; WHERE-anchored claim → 409) — the moderation queue's tab calls
this same endpoint, deliberately not a `_KIND_MODELS` kind. **`Exercise.verified` is DERIVED**
(signals.recount_verified — a published solution that is pinned/reviewed/verified-authored, EXCEPT a
solution its author marked AI-assisted, which counts only once reviewed — `provenance/`, 2026-10-21;
for an exercise with parts, a passed solution for the WHOLE or one for EVERY part — "Parts" below);
never hand-toggle it (it is read-only in the admin too), and call the recount after any
queryset-`update()` on entries.
`EditSuggestion.entry` (moderation app) targets a row; its deciders are author+staff+governors.

## Invariants (each one closed a real bug)

- **Translation uniqueness is a partial constraint**: at most one *published* row per
  (exercise, locale) — multiple pending/rejected rows are explicitly legal. It was once a full
  `unique_together('exercise','locale','status')` and that produced three deterministic 500s
  (superseding a published translation, resubmitting after rejection, second pending). Publish
  order: delete the superseded published row FIRST, then flip pending→published with a
  WHERE-anchored `UPDATE` (the 409-on-race claim). Don't reorder.
- `unique_together (branch, number)` — number allocation on submission approval uses a bounded
  retry loop (see moderation/CLAUDE.md); never a bare read-max-plus-one.
- **Never cache resolved translations on `self` in a serializer** — DRF's `ListSerializer`
  shares ONE child instance across all rows under `many=True`; a `self._cached` made every bulk
  row show the first row's content (real data-corruption bug). Cache on the per-row `obj`, and
  read `obj.translations.all()` (prefetch-friendly), not `.filter(status=...)`.
- `retrieve()` records a `ContentView` row — the viewer pool moderation's auto-hide divides by.
  `bulk/` deliberately does NOT (a queue listing isn't a "view"), and exercise detail is carved
  out of the anonymous response cache for exactly this reason. Keep both properties.
- `random/` is a list-level `@action` registered BEFORE the `{pk}` route; algorithm =
  prefer-unseen then weighted roulette by topic affinity (mirrors frontend
  `browsingHistory.svelte.ts`; inputs arrive as `seen=`/`affinity=` params).
- `bulk/?ids=` exists because the frontend once fired 115 individual GETs; its queryset carries
  the full select_related/prefetch set (5 queries flat regardless of row count).
- Content is Markdown + literal `\(…\)`/`\[…\]` + raw-HTML passthrough. Never rewrite corpus
  bodies; after any bulk content change re-run `manage.py dump_text_fields` +
  `npm run check:katex` (frontend).

## Endpoints

`ExerciseViewSet`: list filters `?topic=&difficulty=&source_type=&q=&tag=&sort=&lang=`, plus
`random/`, `bulk/`, `translations/`, `reviews/`, `comments/`, `requirements/`.
**`PATCH /api/exercises/{id}/` is the author's (or staff's) in-place edit** (`editing.py`,
`ExerciseEditSerializer`, 2026-10-21): title/statement/answer onto the original-locale
translation, each text change recorded as an APPROVED `moderation.EditSuggestion` by the editor;
difficulty, audience, topics (of the branch only — `topics_not_in_branch`), tags and the source
straight onto the row. A stranger gets 403 `exercise_not_editor` and keeps "Suggest an edit". The
detail serializer's `can_edit` is the same rule asked once. **No PUT, no DELETE**
(`http_method_names`): until that day the ModelViewSet exposed both to any signed-in account with
no guard, so anybody could PATCH `difficulty` on anything — found by trying it. Left open: the
author's own UNPUBLISHED exercise is a 404 to PATCH (the public queryset), so a held submission is
still edited through the queue.
`TagViewSet.apply/` (POST attach / DELETE-with-body remove, any authenticated user — additive,
reversible metadata, deliberately not moderation-gated).

## Tags made by asking (`tags.py`, WP16, 2026-10-15)

`tags.py` is the one rule for a tag somebody TYPES: `fold` (lower case, `ł`→`l`, accents off,
non-alphanumerics → one hyphen — the shape of the corpus's 860 ASCII slugs; mirrored in
`TagPicker.svelte`), `name_refusal`, `matching_tag` (folded match, live beats removed, so a removed
tag cannot be re-made by respelling it), `create_tag_from` (refusal words mirrored in `labels.ts:
TAG_REFUSAL_LABELS`), `listed_tags` (the orphan rule `TagViewSet` uses: a `from_question` tag is listed
only while an exercise, material, concept or visible post uses it) and `merge_tag`. `Tag.created_by`,
`created_at` (stamped on every new row by `save()`; null on the 1,022 that predate it) and
`from_question` are migration 0016. The admin renames (folded, refused onto an existing name),
removes, and merges ("merge into" moves every use and REMOVES the source). `test_tags.py` pins it.

## Parts — a set-shaped exercise (`SUBEXERCISES-BRIEF.md`, §17CV, 2026-10-21)

**The shape.** `ExercisePart` (`exercise`, `order`, `label` ≤ 20 chars, free text shown as
written; `(exercise, order)` unique) with its text in `ExercisePartTranslation` — one row per
(part, locale, status) including the original, the same partial unique constraint as
`ExerciseTranslation`, sanitized in `save()`. `SolutionEntry.part` (null = the whole exercise) and
`moderation.EditSuggestion.part` both CASCADE from the part. The shared statement stays on
`ExerciseTranslation`; an exercise without parts is exactly what it was. A part has no licence, no
difficulty, no topics — it is the exercise's own text (`licensing/rules.py: _carry_to_own_text`
says why there is nothing to carry). **`parts.py` is the one rule module**: `parts_of`, `part_text`
(reader's locale → original → any), `part_refusal`, `verified_by_parts`, `parts_payload_refusal`,
`apply_parts`, `write_part_text`. The importer (`import_exercises`, step B) writes parts by `(exercise, order)` and calls `recount_verified` as it always did.

**The read shape.** The detail's `parts: [{id, label, order, statement, answer, resolved_locale}]`
(`[]` without parts; prefetched in two queries); every entry carries `part`.

**Verified for a set.** `signals.passed_solutions` is the one definition of "passed" (pinned,
reviewed or verified-authored; AI-assisted only once reviewed). `recount_verified` = a passed
solution with `part IS NULL`, **or** `verified_by_parts` (the exercise has parts and every one has a
passed solution of its own). (a)–(c) solved and (d) not is unverified. `ExercisePart` signals
recount on create and delete (a new part unverifies a set until it is solved; deleting the unsolved
one may verify it); a rename or reorder is an `update()` and changes nothing.

**`PATCH /api/exercises/{id}/` with `parts: [{id?, label, statement, answer}]`** (author or staff,
`editing.py` — a stranger is still 403 `exercise_not_editor`). The list is the WHOLE set: absent
leaves the parts alone; a missing `id` creates; a known `id` updates label and text; a known part
NOT in the list is deleted with its entries and its edit suggestions (CASCADE — the form warns);
`[]` deletes every part; `order` is rewritten from the list position, 1-based (survivors are parked
above the highest order first, so a swap never trips the unique pair). Text lands on the part's
ORIGINAL-locale published row (created if missing), and each changed field — a new part's
statement and non-blank answer included — is an APPROVED `EditSuggestion` with `part=<part>` by the
editor. Resending the same list writes and records nothing. Same transaction as the rest of the edit.

**An entry's part does not move.** `POST /exercises/{id}/entries/` takes `part`
(`part_not_of_exercise`); `PATCH /solution-entries/{id}/` with a DIFFERENT `part` (or `null` on a
part entry, or a part on a whole one) is **refused 400 `part_immutable`** — not ignored, so a
client that tries learns it failed. The part it already has is accepted as a no-op. The pool's
visibility and ordering (`entries.py`) do not look at `part` at all (`EntryPartTests` pins it).

**Refusal words** (400, each under the field named; mirrored in the frontend's `labels.ts`):

| Word | Field | Where |
|---|---|---|
| `part_not_of_exercise` | `part` / `parts` | an entry POST, an edit suggestion, or a PATCH item `id` that is not this exercise's part |
| `part_label_duplicate` | `parts` | two PATCH items with the same (trimmed) label |
| `parts_too_many` | `parts` | more than 26 PATCH items (`parts.MAX_PARTS`) |
| `part_id_duplicate` | `parts` | the same `id` twice in one PATCH (the form cannot send it; a hand-built body can) |
| `part_and_entry` | `part` | an edit suggestion naming both a part and an entry |
| `part_field_invalid` | `field` | an edit suggestion for a part with a field other than `statement`/`answer` |
| `part_immutable` | `part` | an entry PATCH that would move it to another part |

**The admin.** `ExercisePart` has its own page with its translations inline; the parts are an
inline (order, label, a change link) on the exercise page; `SolutionEntry.part` and every FK on
`EditSuggestion` are `raw_id_fields`. `PartsAdminTests` opens them.

Tests: `test_parts.py` (21), `moderation/test_part_suggestions.py` (7), `licensing/test_parts.py` (2).

## Covers / requires claims

`ExerciseClaim` (+ `ExerciseClaimVote`, `ExerciseClaimImportanceVote`, migration 0008) inherits
`materials.ClaimBase`; handlers are shared in `materials/claims.py`. `GET|POST /exercises/{id}/claims/`
(topics = the exercise's branch), per-claim `/exercise-claims/{id}/vote|importance|comments/` scoped
to published exercises. `community.targets` maps it to `exerciseClaim`. The free-text
`ExerciseRequirement` API stays but has no UI any more (the exercise page renders `ClaimGroups`).

## Getting exercises in

Three ways, and they are not interchangeable: `/submit` → `POST /api/exercise-submissions/` → the
queue (one contribution, reviewed, attributed); `manage.py import_exercises <dir> --branch <slug>`
for a batch (idempotent by `(branch, number)`, `--dry-run` first — `.claude/skills/import-exercises/SKILL.md`
is the whole procedure); and `import_legacy_corpus`, which is **dead** — it predates the
Discipline/Branch restructure and crashes on its first row. Keep it as provenance, do not repair it.

## A solution can carry a file (2026-10-01)

`SolutionEntryAttachment` — a scan or a PDF hanging off one hint/solution, added for the owner's
"make adding solution as PDF, image, Chemistry, etc. work".

Three of the four ways that sentence names cost nothing but mounting `InsertStrip` beside the
composer's `RichEditor`, because they all go INTO the body: a picture through `/inline-images/`, a
chemistry structure through `/chem-drawings/`, a sketch through `/sketches/`. **A PDF has nothing
to be embedded as**, which is the whole reason the row exists.

It is `community.CommentAttachment` again, deliberately — same three-per-parent limit, same
`process_attachment` (re-encode a picture, sniff-and-scan a PDF, house rule 7), same random stored
name, same allowance. A separate TABLE rather than a generic target on the existing one, because
`CommentAttachment.comment` is a real FK four call sites read. **`community.attachments.
used_upload_bytes` counts these too** — its own docstring makes that the rule.

- `POST /api/solution-entries/{id}/attachments/` (multipart, author only, 403/409/400 as
  `CommentViewSet.attachments`), `DELETE …/attachments/{attachmentId}/` (author or staff).
- The entry must exist first, as a comment must: the composer POSTs the text, then the files
  against the id it gets back, which keeps every other entry endpoint JSON. **A failed upload does
  not lose the entry** — the words are already saved; failures are counted and said out loud.
- Unlike a comment attachment this does **not** hold the entry for review when a minor uploads a
  picture: a non-verified author's entry already starts `pending`, so the hold is already there.
- Pinned by `EntryAttachmentTests` (8).

## Verify

`manage.py test exercises` — the `many=True` regression test lives here. E2E: exercise pages are
exercised across most scripts; KaTeX correctness via `npm run check:katex`.

## Licence (2026-10-14, `licensing/CLAUDE.md`)

This app's content carries a per-item `licence` (`licensing/licences.py`, default `edmat-only`, the
corpus `unknown`). It is set at creation and changed ONLY through `licensing.rules.change_licence`
(`/api/licences/<kind>/<id>/`) — only ever widened, recorded, read-only in the admin. Which rows here
carry their own and which contribute under their parent's is the table in `licensing/CLAUDE.md`.
