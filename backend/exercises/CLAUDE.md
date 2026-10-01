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
(signals.recount_verified — a published solution that is pinned/reviewed/verified-authored);
never hand-toggle it, and call the recount after any queryset-`update()` on entries.
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
`TagViewSet.apply/` (POST attach / DELETE-with-body remove, any authenticated user — additive,
reversible metadata, deliberately not moderation-gated).

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
