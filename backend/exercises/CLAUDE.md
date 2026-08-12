# exercises — the core content model (742-exercise corpus lives here)

`Exercise` is structural only (branch, number, topics, difficulty, tags, published, verified,
`original_locale`, `submitted_by` — null for migrated corpus rows). ALL text lives in
`ExerciseTranslation`, one row per (exercise, locale, status) **including the original**
(`translated_by=None`, locale='pl' for corpus rows). Also: `ExerciseSource` (+ translation),
`Tag` + `TagFollow` (per-tag `notify` is separate from following), `ExerciseRequirement` (+ vote).

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

## Verify

`manage.py test exercises` — the `many=True` regression test lives here. E2E: exercise pages are
exercised across most scripts; KaTeX correctness via `npm run check:katex`.
