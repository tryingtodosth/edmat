# taxonomy — the controlled vocabulary everything hangs off

`Discipline` → `Branch` → `Topic` (+ `Subtopic`) + `Chapter` (textbook page map). **Renamed**:
Discipline was `Field`, Branch was `Course` — the root CLAUDE.md still uses the old names.
`courses.Course` is the *unrelated* user-run course model.

## Invariants

- Structural fields on the node, ALL human-language text in the `*Translation` sibling table —
  every node model has one. Resolve locale via `config/i18n_utils.py` (fallback to original),
  never ad hoc.
- `Topic` is **branch-scoped** (`unique_together (branch, slug)`), matching the source corpus
  where a topic id only means anything inside its own course.yaml. `Subtopic` nests under Topic.
- Ids in the API are **slugs** for Discipline/Branch (the one exception to numeric-pk ids).
- Unpublished nodes **404** rather than leak — enforced by queryset filtering in the viewsets.
- `ProposableNode` is the community half: `POST /api/taxonomy/propose/` lands proposals in the
  moderation queue; approval creates the real node.

## Files / endpoints

`models.py` (nodes + translations + ProposableNode base), `views.py` (`DisciplineViewSet` +
`branches` action, `BranchViewSet` + exercises/materials actions, `ProposeNodeView`).
Data source of record for the seeded taxonomy: `import_legacy_corpus` (in `exercises/management/`)
— 3 disciplines, 4 branches, 50 topics, 42 chapters.

## Notes

- Taxonomy lists are small and bounded — they're on the anonymous-read cache positive list and
  are what `manage.py preload_cache` warms first. Changing response shapes here touches that.
- Frontend mirrors: `lib/services/taxonomy.ts`, `lib/state/taxonomy.svelte.ts`.

## Verify

`../.venv/bin/python3 manage.py test taxonomy` — plus `e2e/taxonomy-preload.mjs`,
`taxonomy-others.mjs` for the browse surfaces.
