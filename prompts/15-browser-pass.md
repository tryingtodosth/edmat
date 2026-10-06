# D. The browser pass — run what was never run, fix what it finds — brief for one agent

| | |
|---|---|
| **Model** | Opus 5, **with the browser harness** (every step runs on Opus, owner decision 2026-10-05) |
| **Branch** | `close/d-browser-pass` |
| **Worktree** | `/Projects/edmat/.claude/worktrees/close-d-browser-pass/` |
| **Ports** | API `8144`, Vite `5244` |
| **Base commit** | `4a57d6d` — there is no prep commit this cycle, `11-closing-design.md` §3 says why |
| **Boards** | `/Projects/edmat-boards/` — your `doing.md` entry is already written |
| **Node 24** | `export PATH=/home/bob/.cache/edmat-tools/node24/bin:$PATH` |

## Read first
`prompts/README.md` §4 and §5, `frontend/e2e/CLAUDE.md` whole (it is the catalogue of ways a
browser script lies, and this step is nothing but browser scripts), then
`prompts/11-closing-design.md` §4 — `backend/flashcards/` and the seven showcase pages are yours;
the manual's twelve pages and `guide-screenshots.mjs` are step C's.

## The task

House rule 2 — *verify by running it, not by reading it* — and the learning cycle's integration
entry says in so many words that it did not: `e2e/flashcards.mjs` (step A's, 42 checks) has never
been run against real servers; `npm run check:a11y` has never been run over the nineteen pages the
cycle added (the manual's twelve, the showcase's seven); and the integration's green suite, green
`svelte-check` and green build are, by the project's own rule, not a substitute. This step runs
them, **looks at the screenshots**, and fixes what the run finds — in the one app and the seven
pages nobody else is in this cycle.

Three parts, in this order:

**1. `e2e/flashcards.mjs`.** Clear the file cache, run it on your ports, read every line of output,
open every `e2e/screens/flashcards-*.png`. It drives five things (its header lists them): deck from
a set, the list with due counts, the review screen's four grades and the SM-2 due count after a
lapse, placement on a course and a participant studying it, and the kill switch. Expect it to find
something — it was written against mocked shapes on one branch and the app it drives merged
afterwards. For each failure decide whether the script or the app is wrong (`e2e/CLAUDE.md` traps
first — the anonymous read cache, `networkidle` that never fires, the login throttle — then the
code), fix the right one, and say which on the board. A failure that is a real bug in
`backend/flashcards/` or `frontend/src/routes/flashcards/**` is **yours to fix**, with a backend
test beside it in `backend/flashcards/tests.py` where the bug is backend.

**2. `npm run check:a11y`** over the showcase's seven pages — `/about/exercises`, `/about/flashcards`,
`/about/learning-record`, `/about/courses`, `/about/schools`, `/about/concepts`, `/about/events`
(`frontend/scripts/check_accessibility.ts:174–184` already lists them). Zero violations on all
seven is the bar; the fix lives in `frontend/src/lib/content/showcase/**` and
`frontend/src/routes/about/<feature>/**`, which are yours. The script will also report the manual's
twelve pages; **copy those findings verbatim to the board** under "Closing step D — for step C" and
do not touch them.

**3. Look.** Open each of the seven showcase pages and the flashcards routes yourself at phone width
(390 px) and at 1280 px, as a signed-out visitor and as `michal@edmat.example`. The axe run finds
contrast and labels; it does not find a panel that overflows, a button that is cut off, or a
sample-data card that shows raw LaTeX. Write down what you see, fix what is yours, and name what is
not.

## What "finished" means

- [ ] `e2e/flashcards.mjs` runs to the end: **N checks, 0 failed, 0 console errors**, with N in the
      board entry (42 at `4a57d6d`; it may change if you had to split or add a check). Every
      `flashcards-*.png` looked at, and the entry says so and names the one that was most
      informative.
- [ ] For every failure the first run produced: a line on the board saying *script* or *app*, the
      fix, and the commit.
- [ ] `backend/flashcards/tests.py` has a test for every backend bug fixed (regression pinned);
      `manage.py test flashcards` green with the new count.
- [ ] `npm run check:a11y`: **0 violations on the seven showcase pages**; the manual's findings
      copied to the board for C; the board entry carries the per-page counts before and after.
- [ ] The phone-width pass: a sentence per page on the board, even when the sentence is "fine".
- [ ] `npm run check` 0/0; `npm run lint` clean on your files; `npm run build` clean;
      `manage.py check`; `makemigrations --check --dry-run` clean — **no migration**; if a bug fix
      wants one, stop and write on the board.
- [ ] `HISTORY.md` has `## 17BT.D …` at the very end: what the run found, what was script and what
      was app, the a11y counts. `todo.md` bullet 5 under "Learning cycle — left open" is **deleted**
      (if the manual's half is still open because C has not merged, the bullet is *rewritten* to say
      exactly that and nothing else, and your board entry says so).
- [ ] `test.md`'s paragraph on `flashcards.mjs` says it has been run, when, and the numbers.

## Context — what you need and where it is

| Need | Where | Why |
|---|---|---|
| The script, its header, its five parts | `frontend/e2e/flashcards.mjs` | what you are running; the header tells you the ports convention and that the shots are "meant to be LOOKED at" |
| The app | `backend/flashcards/CLAUDE.md`; `backend/flashcards/{models,views,rules,review}.py` (the names may differ — the `CLAUDE.md` maps them); `frontend/src/routes/flashcards/**`; `frontend/src/lib/flashcards*` | where a real bug would live |
| Its tests | `backend/flashcards/tests.py` (ten classes, `FlashcardsTestCase` base — already declares `databases`) | where a regression test goes |
| The design it implements | `prompts/02-flashcards.md`; `prompts/00-DESIGN.md` §4.1; `prompts/README.md` §9 (placement is sharing; numeric ids; `is_public` off) | so "script wrong" vs "app wrong" is decided against the design, not against the script |
| What integration said | `HISTORY.md` §17BR, the integration section and §17BR.A; `done.md` "Learning cycle — integration finished" | the two hooks wired in `c010ae9`, the production incident with the 404 buttons |
| The axe runner and its list | `frontend/scripts/check_accessibility.ts` (`:174–195`) | nothing to add; everything to run |
| The showcase pages | `frontend/src/lib/content/showcase/**`; `frontend/src/routes/about/{exercises,flashcards,learning-record,courses,schools,concepts,events}/`; `prompts/08-about-showcase.md`; `HISTORY.md` §17BR.G | where an a11y fix lives, and what the pages are for |
| The seeded accounts | `michal@edmat.example` (owner), `ola@edmat.example` (student), `kasia@edmat.example` (staff), password `password123` — `frontend/e2e/flashcards.mjs:40–44` | the script's own three |
| Browser traps | `frontend/e2e/CLAUDE.md` — 1 (seeded users over registering), 12 (anonymous read cache), 16 (content locales), 27 (instant panel ≠ loaded panel), and the `ERR_INSUFFICIENT_RESOURCES` note | before deciding anything is a bug |

## Shapes fixed in advance

- `/api/decks/`, `/api/decks/{id}/…`, `/api/nodes/{kind}/{pk}/decks/` and the `/flashcards`,
  `/flashcards/[id]` routes do not change shape. A fix changes behaviour, not addresses.
- SM-2's grades and intervals are what `backend/flashcards/` says they are; if the script's
  expectation and the app disagree, the design (`02-flashcards.md`) is the referee, and the loser is
  fixed to match it.

## Left open, by design

- You do not touch the manual's pages or `guide-screenshots.mjs` (C), the discussions widget or the
  moderation panel (E), or any test file outside `backend/flashcards/` (A).
- You do not add checks to `flashcards.mjs` for things it was not written to cover; if you see a
  gap (the three "make a deck" buttons from a lesson, a session, a concept are each verified in
  their own step's script against a mock — nobody has driven them against the real `POST
  /api/decks/`), write it on the board as the next script, do not write it now.
- If an a11y finding on a showcase page is in a shared component (`$lib/components/**`), fix it
  only if the component is used nowhere else; otherwise write it on the board with the selector
  and the rule id.

## Verify

From `/Projects/edmat/.claude/worktrees/close-d-browser-pass/`, servers on **your** ports:

```bash
cd backend && ../.venv/bin/python3 manage.py runserver 8144 &
cd frontend && npm run dev -- --port 5244 &
rm -rf ../backend/cachedata/*
E2E_BASE=http://localhost:5244 E2E_API=http://127.0.0.1:8144/api node e2e/flashcards.mjs
E2E_BASE=http://localhost:5244 npm run check:a11y
cd ../backend && ../.venv/bin/python3 manage.py test flashcards --keepdb
cd ../frontend && npm run check && npm run lint && npm run build
```

Clear `backend/cachedata/*` before **every** run of the script (the login throttle); never run it
while editing; never alongside the full backend suite. Look at the screenshots. Numbers in the
board entry — "ran, green" without them is the thing `README.md` §8 says has not happened.
