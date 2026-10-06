# C. The manual's flashcards chapter — brief for one agent

| | |
|---|---|
| **Model** | Opus 5, **with the browser harness** (every step runs on Opus, owner decision 2026-10-05) |
| **Branch** | `close/c-manual-flashcards` |
| **Worktree** | `/Projects/edmat/.claude/worktrees/close-c-manual-flashcards/` |
| **Ports** | API `8143`, Vite `5243` |
| **Base commit** | `4a57d6d` — there is no prep commit this cycle, `11-closing-design.md` §3 says why |
| **Boards** | `/Projects/edmat-boards/` — your `doing.md` entry is already written |
| **Node 24** | `export PATH=/home/bob/.cache/edmat-tools/node24/bin:$PATH` |

## Read first
`prompts/README.md` §4 and §5, `frontend/e2e/CLAUDE.md` **before** touching the screenshot script,
then `prompts/11-closing-design.md` §4 — `frontend/src/routes/about/guide/**` is yours and the
seven showcase pages beside it are step D's.

## The task

The manual at `/about/guide` has eleven chapters. Ten are written against real screens with real
screenshots; the eleventh, **Fiszki / Flashcards**, is the honest placeholder `learn/h-manual` wrote
on 2026-10-05, before the flashcards app existed: it tells the reader it is not written yet and
sends them to the design showcase at `/about/flashcards`. The app has existed since `eb6086a`.
Write the chapter.

The placeholder's own docstring (`frontend/src/lib/content/guide/flashcards.ts`) says exactly what
replacing it means, and it is right:

1. **The steps, in both languages, in that one file** — `GuideChapterDoc` from `types.ts`: a
   `title`, one or two sentences of `lead`, the `steps` (each a `heading`, one or more plain-text
   `body` paragraphs, and usually a `screenshot`), and an honest closing `note`. The manual is one
   piece of writing per chapter with EN and PL side by side in one file *on purpose* — read the
   docstring of `types.ts` for why that beats sixty catalogue keys — and the ten written chapters
   are the style guide. `exercises.ts` is the longest; `concepts.ts` the shortest that still has
   pictures. Match their register: second person, present tense, a reader who has never seen the
   screen, and nothing the screen does not actually do.
2. **The pictures** — a `chapters.flashcards` block in `frontend/e2e/guide-screenshots.mjs`, writing
   `static/guide/flashcards/<nn>-<name>.png`, added to the `order` array at the bottom. Every
   picture in `static/guide/` is taken by that script against the real app; none is drawn by hand,
   and that is the whole point of the manual (the file's forty-line header says why, five times
   over). Budget: 400 KB a picture, 8 MB the set; every shot clipped, never `fullPage`.
3. **Drop `pending: true`** from the `flashcards` entry in `index.ts`, and rewrite its `BLURBS`
   line (both languages), which currently says "Not written yet".

What the chapter covers is what `e2e/flashcards.mjs` drives, because that is what the app does
(`backend/flashcards/CLAUDE.md`, `HISTORY.md` §17BR.A): making a deck from a saved set (or from a
lesson, a session, a concept — the three "make a deck" buttons steps C, D and E put behind the
flag), the deck list with its due counts, a deck's cards, the review screen and its four grades
(keys 1–4, SM-2 — explain *what the reader sees*, not the algorithm; one sentence that a card comes
back on the day you are about to forget it is the design's own phrasing), and **placement**: a deck
placed on a course is studyable by everyone who can view that course, which is this cycle's whole
notion of sharing (`prompts/README.md` §9, first bullet). The `note` names what is *not* there — no
public deck library, no share link — and points at `/about/flashcards` for the design.

## What "finished" means

- [ ] `flashcards.ts` has an EN and a PL `GuideChapterDoc` with the same number of steps, the same
      screenshots in the same order, and `alt` text in each language. A reader of either language
      learns the same things in the same order.
- [ ] `static/guide/flashcards/` holds the pictures the chapter references, **all taken by
      `guide-screenshots.mjs`** on your branch, from the seeded database, English interface, with
      scratch rows hidden (`hideScratch()`), each under 400 KB, the set still under 8 MB. The board
      entry says the count and the total.
- [ ] `index.ts`: no `pending` on the entry; the blurb describes the chapter.
- [ ] The hub at `/about/guide` shows the chapter without the "Not written yet" badge
      (`guide_pendingbadge`), and `/about/guide/flashcards` renders it — **both looked at in the
      browser**, screenshots in the board entry. The `guide_featureoff` behaviour (the chapter when
      the `flashcards` flag is off) still works: switch the flag off through `/moderation` as
      `kasia@edmat.example`, reload, look, switch it back on.
- [ ] `ONLY=flashcards node e2e/guide-screenshots.mjs` passes its own checks; then the **whole**
      script once, because `arrange()` and the content-locale widening are shared and your block
      must not break the chapter after it. Numbers (pictures, MB, checks) in the board entry.
- [ ] `npm run check:a11y` run with both servers up; the two manual pages you changed (the hub and
      `/about/guide/flashcards`) report **0 violations**. If a violation is in the chapter page's
      shared chrome (`routes/about/guide/[chapter]/+page.svelte`), fix it — that file is yours.
      Violations on the seven showcase pages are step D's; name them on the board, do not fix them.
- [ ] `npm run check` 0 errors 0 warnings; `npm run lint` clean on **your** files (Prettier on the
      `.mjs` — the e2e scripts are linted too); `npm run build` clean; both catalogues still have
      identical key sets (you may not need a new `guide_*` key at all — the chrome is already
      there; if you add one, it goes in both, at the end of the existing `guide_*` block).
- [ ] `HISTORY.md` has `## 17BT.C …` at the very end; `todo.md` bullet 3 under "Learning cycle —
      left open" is **deleted**; `test.md`'s paragraph on `guide-screenshots.mjs` says the chapter
      count is now eleven with pictures (grep `forty-three` — the number changes).

## Context — what you need and where it is

| Need | Where | Why |
|---|---|---|
| The placeholder and its instructions | `frontend/src/lib/content/guide/flashcards.ts` | the file you replace |
| The shapes | `frontend/src/lib/content/guide/types.ts` | `GuideChapterDoc`, `GuideStep`, `GuideScreenshot` |
| The hub entry, the blurb, the `pending` flag | `frontend/src/lib/content/guide/index.ts:85–121` | three lines to change |
| Two chapters to imitate | `guide/exercises.ts` (long, many pictures), `guide/concepts.ts` (short) | register and length |
| The screenshot script, its header, one chapter block, the `order` | `frontend/e2e/guide-screenshots.mjs:1–60`, `:666–688` (`chapters.concepts`, the simplest), `:947–960` | the helpers `open`, `visit`, `hideScratch`, `shoot`, `rect`, `settle`; the clip convention (`y: 56` is under the navbar) |
| What to photograph | `frontend/e2e/flashcards.mjs:1–25` (the five things it drives, with routes and the three seeded accounts); `frontend/src/routes/flashcards/**` | the screens, in the order a reader meets them |
| What the app is | `backend/flashcards/CLAUDE.md`; `prompts/02-flashcards.md`; `HISTORY.md` §17BR.A; `prompts/README.md` §9 (placement = sharing) | so the prose says true things |
| Which seeded user has decks | `backend/flashcards/management/commands/` (grep `seed`) and `accounts/management/commands/seed_demo*.py`; else create one through the API inside your block, idempotently, under `michal@edmat.example`, the way `chapters.help` creates its rows | an empty deck list is not a picture |
| The chapter page chrome and the a11y list | `frontend/src/routes/about/guide/[chapter]/+page.svelte`; `frontend/scripts/check_accessibility.ts:30` and `:186–195` | the manual's twelve pages are already in the axe list; nothing to add |
| How the pictures were argued | `HISTORY.md` §17BR.H | one set, English, clipped — do not re-open |
| Browser traps | `frontend/e2e/CLAUDE.md` — especially trap 16 (content locales), trap 12 (the anonymous read cache), 27 (a panel that appears instantly has not loaded) | before the first line of the script |

## Shapes fixed in advance

- The chapter's slug stays `flashcards`; its pictures live at `/guide/flashcards/<nn>-<name>.png`.
- The prose is plain text in the two `GuideChapterDoc`s — no Markdown, no HTML, nothing to sanitize
  (`types.ts`). Routes are written as paths (`/flashcards`), as the other chapters do.
- The pictures are of the **English** interface, one set.

## Left open, by design

- You do not write the showcase (`/about/flashcards`, step G's) and you do not touch the seven
  showcase pages' a11y findings — step D's.
- You do not run `e2e/flashcards.mjs`; D does. If, while photographing, you find the app does
  something wrong, write it on the board under "Closing step C — found" with the route and the
  screenshot, and photograph what *is* there. D owns `backend/flashcards/` on this cycle.
- No second language of pictures. Named in §17BR.H; still a cost, still not paid.

## Verify

From `/Projects/edmat/.claude/worktrees/close-c-manual-flashcards/`, servers on **your** ports
(`frontend/.env` already points at 8143):

```bash
cd backend && ../.venv/bin/python3 manage.py runserver 8143 &
cd frontend && npm run dev -- --port 5243 &
rm -rf ../backend/cachedata/*
ONLY=flashcards E2E_BASE=http://localhost:5243 E2E_API=http://127.0.0.1:8143/api node e2e/guide-screenshots.mjs
E2E_BASE=http://localhost:5243 E2E_API=http://127.0.0.1:8143/api node e2e/guide-screenshots.mjs      # the whole set, once
E2E_BASE=http://localhost:5243 npm run check:a11y
npm run check && npm run lint && npm run build
```

Never run the script while editing files; look at every picture in `static/guide/flashcards/`
before you call it done — the script cannot tell a good picture from a blank one. Numbers in the
board entry.
