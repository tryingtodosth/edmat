# G. The showcase under /about — brief for one agent

| | |
|---|---|
| **Model** | Opus (every step of this cycle runs on Opus, owner decision 2026-10-05) |
| **Branch** | `learn/g-about` |
| **Worktree** | `/Projects/edmat/.claude/worktrees/learn-g-about/` |
| **Ports** | API `8137`, Vite `5237` |
| **Prep commit** | `f90e221` (`prompts/README.md` §3; the worktree is on it) |
| **Boards** | `/Projects/edmat-boards/` — your `doing.md` entry is already written |
| **Node 24** | `export PATH=/home/bob/.cache/edmat-tools/node24/bin:$PATH` |

## Read first
`prompts/README.md` §4 and §5, **all of** `prompts/00-DESIGN.md` and **every other brief in
`prompts/`** (you are showing what they build, before they have built it), `prompts/01-prep.md`,
then `HISTORY.md` §17BO (the `/dziennik` posture: a recorded snapshot with no server behind it)
and §17BQ (the trimmed bar, the three pillars on `/about`), `frontend/CLAUDE.md`.

## The task
Seven pages under `/about/<feature>` that SHOW each design of this cycle with **sample data from
`lib/content/showcase/*.ts`**, rendering the real components read-only — nothing seeded into
production tables, no API call, prerendered like `/about` itself. A visitor who has never signed
in sees what a course with a deck placed on it looks like, what a learning record looks like,
what a school on EdMat is, what a conference leaves behind. The index of these pages mounts at
the `learning: showcase (G)` marker on `/about`.

Pages: `/about/exercises` (sets → decks), `/about/flashcards`, `/about/learning-record`,
`/about/courses` (lesson → deck, the certificate), `/about/schools` (an organisation of kind
`school`, classes, guardians; the link to the `/dziennik` demo as "the full register"),
`/about/concepts` (learn-first paths), `/about/events` (take-home, event ↔ course).

## What "finished" means
- [ ] `lib/content/showcase/{index,exercises,flashcards,learningRecord,courses,schools,concepts,events}.ts`
      — typed, EN + PL consts, a `…For(locale)` resolver (the `lib/content/about.ts` idiom).
- [ ] Seven routes, each `prerender = true`, each built from real components where the component
      takes props (`ExerciseCard`, `CourseCard`, `EventCard`, `ConceptCard`, `EducationCard`,
      `TranscriptView`, `MaterialCard`) and from a thin presentational twin where the real one
      fetches (`lib/components/showcase/*`), each saying honestly at the top that the data is
      illustrative and nothing on the page is live.
- [ ] A "what this is" paragraph per page in both languages, written from the briefs, in the
      voice of `/about` (plain, no marketing).
- [ ] The index at the marker; the seven entries appended at the `showcase (G)` comment in
      `svelte.config.js`'s prerender list; `npm run build` emits `about/<feature>.html` for each.
- [ ] Every link out of a showcase page goes to a real route that exists on YOUR branch or to
      `/about`; nothing 404s.
- [ ] `npm run check:a11y` on the seven pages, 0 violations.
- [ ] i18n prefix `showcase_` for UI chrome (the sample content itself lives in `lib/content/`,
      not in the catalogues — that is the `/about` convention); `HISTORY.md` §17BR.G; `test.md`;
      board entry (tell H which page shows what — H links to them).

## Context — what you need and where it is
| Need | Where | Why |
|---|---|---|
| The precedent page | `frontend/src/routes/about/+page.svelte` (imports 16-23, sections 82-180, the two markers), `routes/about/+page.ts` (`prerender = true` and why), `lib/content/about.ts:24-404` (`AboutDoc`, EN/PL, `aboutDocFor`) | copy the pattern exactly |
| Static pages with subroutes | `frontend/src/routes/legal/` (hub + `notice/`, `queue/`), `routes/levels/` | the hub-plus-children shape |
| Prerender | `frontend/svelte.config.js` (the entries list with your comment), `deploy/fuw/pack.sh:75-80` (the integrator extends this list — tell them the names) | |
| The cards | `lib/components/exercise/ExerciseCard.svelte`, `course/CourseCard.svelte`, `event/EventCard.svelte`, `concept/ConceptCard.svelte`, `shared/EducationCard.svelte`, `profile/TranscriptView.svelte`, `material/MaterialCard.svelte`, `service/ServiceCard.svelte`; the types they take in `lib/types/*.ts` | build sample objects of the real types |
| What each step builds | `prompts/02-…` to `07-…`, the §Shapes and "What finished means" of each | the showcase draws THOSE shapes: a Deck with `card_count`/`due_count`, a learning record with two blocks, a `CourseCompletion`, a "before this, know…" line, a related-courses panel |
| Maths | `lib/components/shared/MathContent.svelte` | sample statements carry LaTeX; render through it |
| The demo link | `HISTORY.md` §17BO, the `school_demo` flag (`Header.svelte` footer link) | `/about/schools` links to `/dziennik` behind `school_demo` |
| Flags | `lib/state/featureFlags.svelte.ts` | a showcase page for a killed feature still renders (it is prose), but says the feature is off on this site |
| a11y | `npm run check:a11y` (`package.json`), `frontend/e2e/CLAUDE.md` | |
| e2e | `frontend/e2e/about-page.mjs` | write `frontend/e2e/showcase.mjs`: open all seven, screenshot each, assert no console error and no failed request |

## Shapes fixed in advance — do not rename
Route names above; `lib/content/showcase/index.ts: SHOWCASE_PAGES: {slug, titleFor(locale)}[]`
(H reads it to link chapters to showcases). You touch nothing under `backend/`.

## Left open, by design
Interactive demos (a flashcard you can flip is fine; a review you can "grade" that stores
nothing is fine; anything that calls the API is not); screenshots (H's job — yours are drawn
with components, so they never go stale).

## Verify
From `/Projects/edmat/.claude/worktrees/learn-g-about/`:
```
cd frontend && npm run check && npm run lint && npm run build && ls build/about/
npm run check:a11y
npm run dev -- --port 5237 --strictPort
E2E_BASE=http://localhost:5237 node e2e/showcase.mjs
```
No backend is needed, but start one on 8137 anyway so the header's flag fetch answers (the page
must also render with the API down — prerendered prose does). Screenshots, looked at — this
step is design judgement, so look twice. Numbers on the board.
