# A. Flashcards — brief for one agent

| | |
|---|---|
| **Model** | Opus (every step of this cycle runs on Opus, owner decision 2026-10-05) |
| **Branch** | `learn/a-flashcards` |
| **Worktree** | `/Projects/edmat/.claude/worktrees/learn-a-flashcards/` |
| **Ports** | API `8131`, Vite `5231` |
| **Prep commit** | `f90e221` (`prompts/README.md` §3; the worktree is on it) |
| **Boards** | `/Projects/edmat-boards/` — your `doing.md` entry is already written |
| **Node 24** | `export PATH=/home/bob/.cache/edmat-tools/node24/bin:$PATH` |

## Read first
`prompts/README.md` §4 (the always-list, in order) and §5 (the rules), then `prompts/00-DESIGN.md`
(§1 rule 2 and rule 3 are yours), then `prompts/01-prep.md`. Then `backend/study/CLAUDE.md`,
`backend/courses/CLAUDE.md` (for the snapshot shape only), `backend/needs/CLAUDE.md` (the most
recent app, as the template for yours).

## The task
A new app `flashcards`, the thirty-fifth: **decks** of **cards**, each card the front/back of an
exercise or a concept or free text, a **per-person SM-2 review schedule**, a review screen, and
**placements** that put a deck on a course or an event so the people there can study it. The
other steps' "make a deck from this lesson / session / concept" buttons all call ONE endpoint of
yours, whose shape is fixed below; they are built against this document, not against your code.

## What "finished" means
- [ ] `backend/flashcards/`: models, `scheduling.py` (pure SM-2), `rules.py`, serializers, views,
      urls, `record.py`, `work.py`, tests, `CLAUDE.md`, one migration.
- [ ] Every endpoint in §API answers exactly as written; a stranger gets 404; refusals carry a word.
- [ ] `/flashcards` (my decks), `/flashcards/[id]` (the deck: cards, add from set / by search,
      placements, delete), `/flashcards/[id]/review` (one card, flip, four grades on keys 1–4,
      progress line, end screen). Both faces render through `MathContent`.
- [ ] A `DeckPlacementsPanel` mounted at the two `learning: deck placements (A)` markers.
- [ ] "My decks" in the account menu at the `Learning account-menu marker`, behind `flashcards`.
- [ ] "Add to a deck" through the existing save-targets store on exercise cards (a deck is one
      more target kind), behind `flashcards`.
- [ ] "Make a deck from this set" on `/my-set` and `/sets/[id]`, behind `flashcards`.
- [ ] Kill switch off: every link above gone, every endpoint 403 for a non-staff caller, the
      course and event pages still render with no panel (house rule 3).
- [ ] i18n prefix `decks_`, both catalogues, identical key sets; `labels.ts` mirrors your enums.
- [ ] `HISTORY.md` §17BR.A, `test.md` paragraph, `backend/flashcards/CLAUDE.md`, the board entry.

## Context — what you need and where it is
| Need | Where | Why |
|---|---|---|
| The set a deck is made from | `backend/study/models.py:22-67` (`ExerciseSet`, `ExerciseSetItem` with `include_hint/answer/solution`), `study/views.py:8-47` (visibility: `is_public` OR owner), `study/urls.py` (the API is `/api/exercise-sets/`) | copy the owner-scoping; a deck's `source_set` is nullable FK SET_NULL |
| Snapshot, not copy | `backend/courses/models.py:1389-1551` (`LessonExerciseSet` + `LessonSetExercise`) | the exact "membership pinned at link time, content live" shape for a deck made from a set/lesson/session |
| Exactly-one-of | `backend/courses/models.py:901-946` (`course_item_exactly_one_target`) | `Card` is exercise XOR concept XOR free text — one `CheckConstraint`, same idiom |
| The exercise's faces | `backend/exercises/entries.py:60-94` (`visible_entries(exercise, user)`, `sort_entries`) and `exercises/models.py:90-106, 359-360` (`published`, `auto_hidden_at`, `is_visible_to_readers`) | front = statement; back = the published answer; hint and the pinned solution as optional reveals. Ask the rule, never re-implement it; an exercise that is no longer visible is skipped by the queue |
| Many exercises in one request | `backend/exercises/views.py:764-803` (`GET /api/exercises/bulk/?ids=`) | the review screen loads a deck's exercises once |
| A concept's faces | `backend/concepts/resolve.py:99-163` (`resolve_page(concept, audiences=, locales=, user=)`) | front = the resolved revision's title, back = its summary; audiences/locales from `config/audience.py` and `config/content_locale.py` as the exercise views do |
| Where a deck is placed | `backend/config/nodes.py:45-250` (`resolve_node`, `can_view_node`, `can_manage_node`, `node_content_type`, `node_ref`) | `DeckPlacement` is a GenericFK to a `course` or `event` node, nothing else; placing needs `can_manage_node`; seeing needs `can_view_node` |
| Gate | `backend/moderation/permissions.py:19-41`, usage `services/views.py:30` | `_FlashcardsGate = feature_gate('flashcards')` on every viewset |
| Sanitize on write | `backend/config/sanitize.py:134` (`sanitize_content`), usage `courses/models.py:635-638` | free-text `front`/`back` are Markdown with LaTeX; sanitize in `save()` |
| Minors | `backend/accounts/minors.py:22` (`is_minor`) | a minor cannot set `is_public` → refusal `minor` |
| Work dashboard | `backend/work/providers.py:1-56` (`ITEM_KEYS`, `register`), `backend/tasks/work.py` (the template) | write `flashcards/work.py: work_items(user)` — one row "N cards due" per deck with due cards; the integrator registers it |
| Learning record | `prompts/03-learning-record.md` §Shapes | write `flashcards/record.py: activity_by_branch(user) -> {branch_id: {'cards_reviewed': n}}` from `ReviewLog` joined through `Card.exercise.branch`; the integrator registers it |
| Tests | `backend/testing/factories.py:18-100` (`make_user` — password `testpass123`, `make_exercise`, `make_branch`), `backend/tasks/tests.py:37-41` (`databases = set(all_log_shards()) \| {'default'}` — mandatory) | |
| Frontend seam | `frontend/src/lib/services/exerciseSets.ts`, `lib/services/tasks.ts` (mapper idiom), `lib/api/client.ts:180-224` | `lib/services/flashcards.ts` already exists with `createDeckFromExercises` — keep its signature, append everything else |
| Save targets | `frontend/src/lib/state/saveTargets.svelte.ts` (`addTo`, `ensureCoursesLoaded`), `lib/components/exercise/SaveToSetButton.svelte` | a deck is one more target kind; the store loads decks only when `flashcards` is on |
| Rendering | `frontend/src/lib/components/shared/MathContent.svelte`, `lib/utils/mathRender.ts` | both faces; KaTeX stays lazy |
| Flags on the frontend | `frontend/src/lib/state/featureFlags.svelte.ts:29` (`isEnabled`), Header's `can()` | |
| Routes to model on | `frontend/src/routes/my-set/+page.svelte`, `routes/sets/[id]/+page.svelte` | |
| Svelte 5 traps | `frontend/CLAUDE.md` | the review route needs the id-changed idempotency guard on its `$effect`; `bind:value` types |
| e2e | `frontend/e2e/CLAUDE.md`, `frontend/e2e/about-page.mjs` (the template: `E2E_BASE`/`E2E_API`, `tokenFor`, `check`, `screens/`) | write `frontend/e2e/flashcards.mjs` |

## Shapes fixed in advance — do not rename
Models (`flashcards/models.py`):
```
Deck(owner FK, name ≤120, audience (config/audience choices, as ExerciseSet), is_public default False,
     source_kind: '' | 'set' | 'lesson' | 'session' | 'concept', source_id nullable int,
     source_set nullable FK study.ExerciseSet SET_NULL, created_at)
Card(deck FK, order, exercise nullable FK CASCADE, concept nullable FK CASCADE,
     front text, back text, include_hint bool, include_solution bool, created_at)
     CheckConstraint card_exactly_one_face: exercise XOR concept XOR (front != '')
ReviewState(user FK, card FK, due_at, interval_days, ease (default 2.5), repetitions, lapses,
            updated_at)  unique (user, card)
ReviewLog(user FK, card FK, grade 1..4, reviewed_at, interval_before)   append-only
DeckPlacement(deck FK, content_type, object_id, order, added_by FK, added_at)
              unique (deck, content_type, object_id); node kind ∈ {course, event}
```
Rules (`flashcards/rules.py`):
```
can_study(user, deck)   owner | deck.is_public | a placement on a node can_view_node(user, node)
can_edit(user, deck)    owner only (staff bypass as everywhere)
place_block_reason(user, deck, node)  'not_owner' | 'cannot_manage' | 'already_placed' | 'kind'
public_block_reason(user, deck)       'minor'
grade: one update_or_create + one log insert inside a short atomic(); no select_for_update
```
**The one deviation from `00-DESIGN.md` §4.1, decided by the integrator 2026-10-05 and to be
written on the board:** decks stay private to the WORLD (`is_public` defaults off, a minor cannot
set it), but a deck PLACED on a course or an event is studyable by everyone who can view that node —
otherwise the "make a deck from this lesson" button would make a deck only its maker could open.
Placement is the sharing mechanism of this cycle; `is_public` is the later one.

Scheduling (`flashcards/scheduling.py`): one pure function `review(state, grade, now) -> state`,
SM-2 with four grades (1 again, 2 hard, 3 good, 4 easy), no queries. "Due" is the server's day.
Test it as a table of grade sequences and expected intervals.

### API — every path behind `feature_gate('flashcards')`
```
GET  /api/decks/                         the caller's own decks (+ ?placed_on=<kind>:<id> → decks placed there that the caller may study)
POST /api/decks/  {name, audience?, exercise_ids?: [], source?: {kind, id}, placement?: {kind, id}}
                                         creates the deck, one exercise card per id IN ORDER (ids the caller may not see are skipped, count reported as `skipped`),
                                         and, if `placement`, the placement (403 with place_block_reason's word if refused — the deck is still created).
                                         → the Deck read shape (below), 201
GET|PATCH|DELETE /api/decks/{id}/        retrieve: can_study, else 404; PATCH/DELETE: can_edit, else 404
GET|POST /api/decks/{id}/cards/          POST {exercise?, concept?, front?, back?, include_hint?, include_solution?} → Card, 201
PATCH|DELETE /api/cards/{id}/            can_edit through deck, else 404
GET  /api/decks/{id}/review/             the caller's queue: due cards first (≤ 50), then new; {cards: [...], counts: {due, new, learned, total}}
POST /api/cards/{id}/grade/ {grade}      → the new ReviewState; 404 unless can_study; 400 unless grade ∈ 1..4
POST /api/decks/{id}/copy/               a private copy of a deck the caller can study (membership snapshot) → Deck, 201
GET  /api/flashcards/due/                {decks: [{id, name, due}], total} across the caller's studyable decks
GET  /api/nodes/{kind}/{pk}/decks/       placements on a node, each {id, deck: Deck, order, added_by}; 404 unless can_view_node
POST /api/decks/{id}/placements/ {kind, id}   → placement, 201; refusal word from place_block_reason
DELETE /api/deck-placements/{id}/        placer, deck owner or node manager; else 404
```
Deck read shape (snake_case): `id, name, audience, is_public, source_kind, source_id, card_count,
due_count, created_at, can_edit, placements: [{id, node: node_ref}]`.
Card read shape: `id, order, kind: 'exercise'|'concept'|'text', exercise: {id, title…} | null,
concept: {slug, title} | null, front, back, include_hint, include_solution`. For an exercise card
the API does NOT inline the statement — the review screen loads them through `/api/exercises/bulk/`.

### Frontend
Routes `/flashcards`, `/flashcards/[id]`, `/flashcards/[id]/review` (English URLs — the two Polish
addresses were owner decisions and this is not one). `lib/types/flashcards.ts` and
`lib/services/flashcards.ts` are yours (keep `createDeckFromExercises(draft)` exactly). The
placements panel: `lib/components/flashcards/DeckPlacementsPanel.svelte` taking
`nodeKind`/`nodeId`, mounted at the two markers; a manager sees "place one of my decks here".

## Left open, by design — name these on the board
Shared/public deck library; FSRS; notifications for cards due (a three-file change — say which);
offline grading; a frozen concept card; per-account timezone.

## Verify
From `/Projects/edmat/.claude/worktrees/learn-a-flashcards/`:
```
cd backend && ../.venv/bin/python3 manage.py test flashcards config --keepdb
../.venv/bin/python3 manage.py check && ../.venv/bin/python3 manage.py makemigrations --check --dry-run
cd ../frontend && npm run check && npm run lint && npm run build
# servers, your ports:
DJANGO_CORS_ALLOWED_ORIGINS=http://localhost:5231,http://127.0.0.1:5231 ../.venv/bin/python3 manage.py runserver 127.0.0.1:8131   # from backend/
npm run dev -- --port 5231 --strictPort                                                                                   # from frontend/, .env already points at 8131
rm -rf backend/cachedata/*; E2E_BASE=http://localhost:5231 E2E_API=http://127.0.0.1:8131/api node e2e/flashcards.mjs
```
Migrate your worktree's DB first (`manage.py migrate`). The e2e: sign in as a seeded user
(`password123`), make a deck from a set, review three cards with different grades, see the due
count change, place the deck on a course you run, open the course as a participant and study it,
switch the flag off as kasia and show the menu item and panel gone. **Look at the screenshots.**
Numbers in the board entry.
