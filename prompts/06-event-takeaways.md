# E. Events — take-home decks, and event ↔ course through the organisation — brief for one agent

| | |
|---|---|
| **Model** | Opus (every step of this cycle runs on Opus, owner decision 2026-10-05) |
| **Branch** | `learn/e-events` |
| **Worktree** | `/Projects/edmat/.claude/worktrees/learn-e-events/` |
| **Ports** | API `8135`, Vite `5235` |
| **Prep commit** | see `prompts/README.md` §3 |
| **Boards** | `/Projects/edmat-boards/` — your `doing.md` entry is already written |
| **Node 24** | `export PATH=/home/bob/.cache/edmat-tools/node24/bin:$PATH` |

## Read first
`prompts/README.md` §4 and §5, `prompts/00-DESIGN.md` (§2 rows "session → deck", "event ↔
course"), `prompts/01-prep.md`, `prompts/02-flashcards.md` §API, then `backend/events/CLAUDE.md`
and `backend/organizations/CLAUDE.md`.

## The task
Two panels on `events`:
1. **"Take home"** on a programme session: every exercise the session links to (direct exercise
   links and the members of linked sets), snapshot, as a deck placed on the event — one call to
   `createDeckFromExercises` after one new read endpoint of yours that lists the ids.
2. **Event ↔ course, through the organisation.** No direct FK (`00-DESIGN.md` §1 rule 1): an
   event page shows "run by <organisation>" and, under it, the courses that organisation runs
   ("this conference's workshops became these courses"); a course page gets the mirror image
   from step C only for "run by" — the courses-under-an-event panel is yours, mounted at the
   `learning: event ↔ course (E)` marker, behind `organizations`.

## What "finished" means
- [ ] `GET /api/events/{id}/sessions/{session_id}/exercises/` → `[{id, title}]` the caller may
      see; 404 unless the event is visible to them (`_visible_to`).
- [ ] The "Take home" button in `Programme.svelte` per session with at least one exercise,
      behind `flashcards`; for organisers the placement is on the event, for visitors the deck
      is simply theirs.
- [ ] `GET /api/events/{id}/related-courses/` → the courses run by the organisations that run
      this event, filtered by the course's own visibility (ask `courses.Course.is_reachable` /
      the queryset rule — do not re-implement), each as the course summary shape; 404 unless the
      event is visible; `[]` when `organizations` is off (house rule 3's documented exception,
      because the event page must keep working).
- [ ] `lib/components/event/RelatedCoursesPanel.svelte` at the marker: "run by" line(s) with
      links, then the courses as `CourseCard`s.
- [ ] Kill switches: `flashcards` off → no button; `organizations` off → no panel, `[]`.
- [ ] i18n prefix `takehome_`; `HISTORY.md` §17BR.E; `test.md`; board entry.

## Context — what you need and where it is
| Need | Where | Why |
|---|---|---|
| Sessions and their links | `backend/events/models.py:613-763` (`Track`, `Session`, `LINK_ROLE_CHOICES` 702-710, `SessionLink` 714-763 with its exactly-one-of constraint and `kind` property) | exercise ids = exercise links + the items of `exercise_set` links |
| Set membership | `backend/study/models.py:51-67` (`ExerciseSetItem`) | read-only; a set linked to a session is readable through the session even if private — the organiser chose to link it (say so in the docstring) |
| Visibility | `backend/events/views.py:111-132` (`_visible_to`, and `_filtered` which is browse-only — keep them apart as `events/CLAUDE.md` demands) | |
| Where session endpoints live | `backend/events/agenda_views.py:68-244` (`ProgrammeMixin`: `sessions` 156, `session_detail` 171, `session_bookmark` 201), `events/urls.py:12` | yours is one more action on the mixin |
| The organisation link | `backend/organizations/models.py:158-180` (`OrganizationLink`, GenericFK + `kind`), `organizations/access.py:75-110` (`can_view`, `visible_organizations`), `backend/config/nodes.py` | event → its `runs`/`supports` organisations → their `runs` links of kind course → visible courses |
| Course visibility | `backend/courses/models.py:340-345` (`is_listed`, `is_reachable`), `courses/views.py:104-140` (the queryset rule) | ask, never re-implement |
| Event page | `frontend/src/routes/events/[id]/+page.svelte` (821 lines): imports 2-35, `<h1>` 303, the markers after 616; `lib/components/event/Programme.svelte` (sessions and their links render here — the button goes beside a session's links); `lib/services/events.ts` (`mapSession` 380, `getSessions` 485, `getSessionsLinking` 513); `lib/types/event.ts:252-292` (`SessionLink`, `Session.links`) | |
| Organisation page, as the mirror | `frontend/src/routes/organizations/[slug]/+page.svelte:171-199` (the "runs" list), `lib/services/organizations.ts:245-259` (`getOrganizationLinks`, `getNodeOrganizations`) | reuse `getNodeOrganizations('event', id)` for the "run by" line |
| The course card | `frontend/src/lib/components/course/CourseCard.svelte`, `lib/services/course.ts` (the summary mapper near line 244) | |
| The deck call | `frontend/src/lib/services/flashcards.ts` (`createDeckFromExercises({name, exerciseIds, source: {kind:'session', id}, placement: {kind:'event', id}})`) | the only flashcards code you touch; on your branch it answers 404 — e2e with a mocked response, and say so |
| Tests | `backend/events/tests*.py` (find the agenda tests), `backend/testing/factories.py`, `tasks/tests.py:37-41` (`databases`); `backend/events/test_permission_matrix.py` (do NOT add rows — the integrator does) | |
| e2e | `frontend/e2e/CLAUDE.md`, `frontend/e2e/event-registration.mjs` | write `frontend/e2e/take-home.mjs`; `seed_conference_demo` gives you a programme |

## Shapes fixed in advance — do not rename
```
GET /api/events/{id}/sessions/{session_id}/exercises/   [{id, title}]
GET /api/events/{id}/related-courses/                   [course summary…]   ([] when organizations is off)
```

## Left open, by design
A course page listing the events its organisation ran (C has "run by" only — name the mirror);
take-home of materials (a deck holds exercises and concepts, not files); a deck per track;
notifications.

## Verify
From `/Projects/edmat/.claude/worktrees/learn-e-events/`:
```
cd backend && ../.venv/bin/python3 manage.py test events organizations config --keepdb
../.venv/bin/python3 manage.py check && ../.venv/bin/python3 manage.py makemigrations --check --dry-run
cd ../frontend && npm run check && npm run lint && npm run build
DJANGO_CORS_ALLOWED_ORIGINS=http://localhost:5235,http://127.0.0.1:5235 ../.venv/bin/python3 manage.py runserver 127.0.0.1:8135   # backend/
npm run dev -- --port 5235 --strictPort                                                                                   # frontend/
rm -rf backend/cachedata/*; E2E_BASE=http://localhost:5235 E2E_API=http://127.0.0.1:8135/api node e2e/take-home.mjs
```
`manage.py seed_conference_demo` first. The e2e: open the demo conference, see "run by" and the
related courses, press Take home on a session with links (mocked deck answer), as a stranger see
no private course in the panel, flip `organizations` off as kasia and see the panel gone.
Screenshots, looked at. Numbers on the board.
