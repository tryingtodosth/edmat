# H. The manual — brief for one agent

| | |
|---|---|
| **Model** | Opus (every step of this cycle runs on Opus, owner decision 2026-10-05) |
| **Branch** | `learn/h-manual` |
| **Worktree** | `/Projects/edmat/.claude/worktrees/learn-h-manual/` |
| **Ports** | API `8138`, Vite `5238` |
| **Prep commit** | `f90e221` (`prompts/README.md` §3; the worktree is on it) |
| **Boards** | `/Projects/edmat-boards/` — your `doing.md` entry is already written |
| **Node 24** | `export PATH=/home/bob/.cache/edmat-tools/node24/bin:$PATH` |

## Read first
`prompts/README.md` §4 and §5, `prompts/00-DESIGN.md` §0 (what exists today — your chapters
describe THAT), `prompts/01-prep.md`, `PRODUCT.md` (roles and user stories — the chapter list
comes from there), `frontend/e2e/CLAUDE.md` (you will live in the browser harness), `AUDIENCE-BRIEF.md`
§1 (who reads this site).

## The task
A user manual at `/about/guide`, bilingual, with **real screenshots of the real app** taken by a
script against your own servers and a seeded database, one chapter per thing a person does here.
This cycle: the chapters for what exists today. The flashcards chapter is written LAST, after
step A has merged (the integrator tells you); until then its page says "coming" and links to
`/about/flashcards` (G's showcase).

Chapters (routes under `/about/guide/`): `start` (an account, the language, the bar, the
account menu), `exercises` (browse discipline → branch → exercise, hint/answer/solution, My set,
sharing a set), `submit` (an exercise, a material, what moderation does with it), `courses` (run
one, chapters and lessons, enrol, progress), `events` (announce, programme, register, the
conference layer in one paragraph), `tutoring` (a listing, booking), `concepts`, `help`
(needs, volunteering offers), `messages` (inbox, notifications), `moderation` (for staff:
queues, flags, reports), `flashcards` (placeholder this cycle).

## What "finished" means
- [ ] `lib/content/guide/*.ts`: one file per chapter, EN + PL, each a list of steps `{heading,
      body, screenshot?: {src, alt}}`; `lib/content/guide/index.ts: GUIDE_CHAPTERS`.
- [ ] `/about/guide` (the hub) + one route per chapter, `prerender = true`, entries appended at
      the `guide (H)` comment in `svelte.config.js`; the link at the `learning: guide (H)` marker
      on `/about`.
- [ ] `frontend/e2e/guide-screenshots.mjs`: signs in as seeded users, drives each flow, writes
      `frontend/static/guide/<chapter>/<nn>-<name>.png` (English UI; the Polish text in the
      chapter explains the same screen — one set of pictures, 1280 px wide, PNG, optimised,
      **≤ 400 KB each, ≤ 8 MB total** — `npm run build` must stay fast and the deploy bundle
      small; say the total on the board). Every screenshot has an `alt` in both languages.
- [ ] Every screenshot shows seeded (`FAKE_PREFIX`-titled or `seed_demo_*`) data only — no real
      names; crop or mask anything else.
- [ ] `npm run check:a11y` on the hub and the chapters, 0 violations.
- [ ] i18n prefix `guide_` for chrome only; `HISTORY.md` §17BR.H; `test.md` (the screenshot
      script and how to re-run it after a UI change); board entry.

## Context — what you need and where it is
| Need | Where | Why |
|---|---|---|
| Precedents | `frontend/src/routes/about/+page.svelte` + `lib/content/about.ts` (the content idiom), `routes/legal/` (hub + subroutes) | |
| The harness | `frontend/e2e/CLAUDE.md` (the traps — `networkidle` never fires signed in; the login throttle lives in `backend/cachedata/`; `password123`), `frontend/e2e/about-page.mjs` (`E2E_BASE`/`E2E_API`, `tokenFor`, `screens/`), `frontend/e2e/english.mjs` (`englishContext` — your screenshots are English UI) | |
| Seeds | `setup.sh:105-140` (`seed_demo_users`, `seed_demo_content`, the accounts and `password123`), `backend/events/management/commands/seed_conference_demo.py`, `seed_concepts.py`, `seed_profile_showcase.py` | run them all on your worktree's DB before the script |
| What each surface does | `PRODUCT.md`, `CLAUDE_MAP.md` (routes), `frontend/src/routes/**` | a chapter describes the screen as it is — when the screen and `PRODUCT.md` disagree, the screen wins and you say so on the board |
| The flashcards placeholder | `prompts/02-flashcards.md` (what the chapter will say), G's `/about/flashcards` | |
| Static files | `frontend/static/` (`excalidraw/`, `favicon.svg`, `robots.txt` today), `svelte.config.js` | `static/guide/` is new |
| Prerender guard | `deploy/fuw/pack.sh:75-80` (the integrator extends the list — tell them the page names) | |
| Image budget | `imaging.py` is backend-only; for PNG optimisation use what `node_modules` already has (look for `sharp` or `pngquant`; if neither, Playwright's `clip` + a smaller viewport, and say so) | no new dependency without naming it on the board |

## Shapes fixed in advance — do not rename
Routes above; `GUIDE_CHAPTERS: {slug, titleFor(locale), showcase?: string}[]`; screenshots under
`frontend/static/guide/<chapter>/`. You touch nothing under `backend/` except running seeds.

## Left open, by design
Polish-UI screenshots (a second set doubles the bundle — name the cost); video; a search over
the manual; chapters for the management layer (tasks, plans, decisions) and the conference
desk apps beyond one paragraph — list them as "not yet written" on the hub so nobody thinks
they are missing by accident.

## Verify
From `/Projects/edmat/.claude/worktrees/learn-h-manual/`:
```
cd backend && ../.venv/bin/python3 manage.py migrate && for s in seed_demo_users seed_demo_content seed_concepts seed_conference_demo seed_profile_showcase; do ../.venv/bin/python3 manage.py $s; done
DJANGO_CORS_ALLOWED_ORIGINS=http://localhost:5238,http://127.0.0.1:5238 ../.venv/bin/python3 manage.py runserver 127.0.0.1:8138
cd ../frontend && npm run dev -- --port 5238 --strictPort
rm -rf ../backend/cachedata/*; E2E_BASE=http://localhost:5238 E2E_API=http://127.0.0.1:8138/api node e2e/guide-screenshots.mjs
du -sh static/guide; npm run check && npm run lint && npm run build && ls build/about/guide/ && npm run check:a11y
```
**Look at every screenshot** before writing its step — several real bugs in this project were
found that way, and a manual that shows a broken screen teaches the bug. Anything broken you
see goes to `todo.md` under "Found by the manual", not fixed by you. Numbers on the board.
