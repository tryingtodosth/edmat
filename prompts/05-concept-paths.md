# D. Concept paths — "learn this first", and a deck from a concept — brief for one agent

| | |
|---|---|
| **Model** | Opus (every step of this cycle runs on Opus, owner decision 2026-10-05) |
| **Branch** | `learn/d-concepts` |
| **Worktree** | `/Projects/edmat/.claude/worktrees/learn-d-concepts/` |
| **Ports** | API `8134`, Vite `5234` |
| **Prep commit** | `f90e221` (`prompts/README.md` §3; the worktree is on it) |
| **Boards** | `/Projects/edmat-boards/` — your `doing.md` entry is already written |
| **Node 24** | `export PATH=/home/bob/.cache/edmat-tools/node24/bin:$PATH` |

## Read first
`prompts/README.md` §4 and §5, `prompts/00-DESIGN.md` (§1 rule 1 — the concept is the "what is
this about" hub; §2 rows "concept → learn first", "concept → flashcard"), `prompts/01-prep.md`,
`prompts/02-flashcards.md` §API, then `backend/concepts/CLAUDE.md` and `CONCEPTS-BRIEF.md` §2–§3
(the graph and the two rule modules).

## The task
Two things inside `concepts`:
1. **The prerequisite closure.** `ConceptLink(relation='prerequisite')` already says "know this
   first" one hop at a time. Walk it to a **bounded** closure (depth ≤ 4, ≤ 20 concepts, cycles
   cut) and show it on an exercise page as *before this, know…* — the prerequisites of the
   concepts the exercise is linked to, nearest first, each resolved to the reader's own article
   title. The same list on a concept page, as a path rather than a flat list.
2. **"Make a deck from this concept."** On a concept page, a button that makes a deck of every
   exercise linked to the concept (`ConceptLink` targets of type exercise, visible to the reader),
   source `concept`, through `createDeckFromExercises`.

## What "finished" means
- [ ] `concepts/paths.py`: `prerequisite_closure(concepts, *, depth=4, limit=20) -> list[(concept, distance)]`,
      pure over `ConceptLink`, deterministic order (distance, then title).
- [ ] `GET /api/concepts/{slug}/prerequisites/` → the closure, each `{slug, title, distance}`
      with the title from `resolve_page` for the caller's audiences/locales.
- [ ] `GET /api/concept-links/learn-first/?target_type=exercise&target_id=` → the union closure
      of the target's linked concepts; answers `[]` (not 403) when `concepts` is off, exactly as
      the sibling `?target_type=` list does (house rule 3, the one documented exception).
- [ ] `GET /api/concepts/{slug}/exercises/` → `[{id}]` of linked exercises the caller may see.
- [ ] `lib/components/concept/LearnFirst.svelte` mounted at the `learning: learn first (D)` marker
      on the exercise page; renders nothing when empty; a "path" rendering on `/concepts/[slug]`
      inside `ConceptLinks.svelte`'s prerequisites section (yours — it is a concepts component).
- [ ] The deck button on `/concepts/[slug]`, behind `flashcards`, hidden when there are no exercises.
- [ ] Kill switches: `concepts` off → nothing on the exercise page, `[]` from the endpoint;
      `flashcards` off → no button.
- [ ] i18n prefix `paths_`; `HISTORY.md` §17BR.D; `test.md`; board entry.

## Context — what you need and where it is
| Need | Where | Why |
|---|---|---|
| The edge | `backend/concepts/models.py:62-67` (`RELATION_CHOICES`, `prerequisite`), `351-412` (`ConceptLink`: GenericFK target, `origin` manual/body, `clean()` — a prerequisite's target is always a Concept, never itself) | the walk is concept → concept only |
| Which page the reader gets | `backend/concepts/resolve.py:99-163` (`resolve_page(concept, audiences=, locales=, user=)`), the exercise views for how audiences/locales are read from the request | titles in the closure are per reader |
| Links on a target | `backend/concepts/services.py:763` (`links_for_target`), `concepts/views.py:747-784` (`ConceptLinkViewSet.list`, the `[]`-when-off rule at 776-784), `concepts/urls.py:19` | your two list endpoints sit beside these |
| Exercise visibility | `backend/exercises/models.py:359-360` (`is_visible_to_readers`), `exercises/views.py:196-215` (`_annotated_exercises`) | the `/exercises/` list filters through the rule, never re-implements it |
| Exercise page mount | `frontend/src/routes/exercises/[id]/+page.svelte:414-424` (`LinkedConcepts` + the two markers), `lib/components/concept/LinkedConcepts.svelte:39-57` (how it derives target type/id and fetches) | |
| Concept page | `frontend/src/routes/concepts/[slug]/+page.svelte:279-284`, `lib/components/concept/ConceptLinks.svelte:46-51, 111-141` (prerequisites derived + rendered) | |
| Service | `frontend/src/lib/services/concepts.ts:443-509` (`getLinks`, `getConceptsForTarget` — swallows 403/404 to `[]`) | add `getPrerequisites(slug)`, `getLearnFirst(targetType, targetId)`, `getConceptExercises(slug)` |
| The deck call | `frontend/src/lib/services/flashcards.ts` (`createDeckFromExercises({name, exerciseIds, source: {kind:'concept', id}})`) | the only flashcards code you touch; on your branch the backend answers 404 — e2e with a mocked response, and say so |
| Tests | `backend/concepts/tests*.py`, `backend/testing/factories.py`, `tasks/tests.py:37-41` (`databases`) | |
| e2e | `frontend/e2e/CLAUDE.md`, an existing concepts script in `frontend/e2e/` (find it) | write `frontend/e2e/concept-paths.mjs` |

## Shapes fixed in advance — do not rename
```
concepts/paths.py: prerequisite_closure(concepts: Iterable[Concept], *, depth=4, limit=20) -> list[tuple[Concept, int]]
GET /api/concepts/{slug}/prerequisites/            [{slug, title, distance}]
GET /api/concept-links/learn-first/?target_type=&target_id=   [{slug, title, distance}]   ([] when off)
GET /api/concepts/{slug}/exercises/                [{id, title}]   (visible to the caller only)
```

## Left open, by design
A "learning path" the reader can follow and tick (that is a course); prerequisite edges inferred
from bodies (`origin='body'` links are `related`, by the concepts design); deck from a concept's
prerequisites too; a depth preference.

## Verify
From `/Projects/edmat/.claude/worktrees/learn-d-concepts/`:
```
cd backend && ../.venv/bin/python3 manage.py test concepts config --keepdb
../.venv/bin/python3 manage.py check && ../.venv/bin/python3 manage.py makemigrations --check --dry-run
cd ../frontend && npm run check && npm run lint && npm run build
DJANGO_CORS_ALLOWED_ORIGINS=http://localhost:5234,http://127.0.0.1:5234 ../.venv/bin/python3 manage.py runserver 127.0.0.1:8134   # backend/
npm run dev -- --port 5234 --strictPort                                                                                   # frontend/
rm -rf backend/cachedata/*; E2E_BASE=http://localhost:5234 E2E_API=http://127.0.0.1:8134/api node e2e/concept-paths.mjs
```
`manage.py seed_concepts` exists — use it, then add prerequisite links through the real UI in
the e2e and watch the exercise page grow the "before this, know…" line, including a cycle that is
cut. Screenshots, looked at. Numbers on the board.
