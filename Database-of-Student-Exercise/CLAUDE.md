# Database-of-Student-Exercise/ — RETIRED. Read-only migration provenance.

The original static-site generator plus the vendored ~740-exercise corpus EdMat was seeded from.
**Retired by decision (root CLAUDE.md §12): EdMat is the sole source of truth.** Its README and
every generated page carry a retirement banner pointing at EdMat.

## Rules

- **Do not edit anything here.** Not the generator, not `content/` — `content/` is the
  historical record of exactly what `manage.py import_legacy_corpus` (in
  `backend/exercises/management/`) read. Content fixes happen in EdMat's database via the edit-
  suggestion/moderation flow, never here.
- Do not publish a new build. The only reason `build/` was ever regenerated post-retirement was
  to bake the retirement banner in.
- The importer is idempotent (upsert by natural key; materials keyed by **directory name**, not
  the `id:` field — two real materials share a copy-pasted `id:`). Re-running it against this
  tree is safe but is a historical one-shot, not a sync.

## What's still useful here

- `content/courses/*/zadania/NNNN.md` — the exercise schema (front-matter + `## Treść/
  Wskazówka/Odpowiedź/Rozwiązanie` sections, HTML-fragments-with-literal-LaTeX bodies) that
  shaped `Exercise`/`ExerciseTranslation`.
- `generator/builder.py` — the parsing logic the importer and the Phase-1 mock extractor reused.
- `content/fields/*.yaml`, `course.yaml`, `mapa_rozdzialow.yaml`, `materialy/` — the sources of
  the seeded taxonomy, chapters and materials.
