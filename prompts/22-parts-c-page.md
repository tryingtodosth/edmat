# C. Sub-exercises — the page, the composer and the Parts editor — brief for one agent

| | |
|---|---|
| **Model** | Opus (owner decision 2026-10-21: "spawn opus agents"; no Haiku) |
| **Branch** | `parts/c-page` |
| **Worktree** | `/home/piotr/Projects/edmat/.claude/worktrees/parts-c-page/` |
| **Ports** | API `8183`, Vite `5283` |
| **Prep commit** | the tip of `fix/analytics-after-deploy` your branch was cut from — `git -C <worktree> log -2 --stat` shows it (the prep itself, then the hash-stamping commit) |
| **Boards** | `/home/piotr/Projects/edmat-boards/` — your `doing.md` entry is already written |
| **Node 24** | `export PATH=/home/piotr/.local/opt/node-v24.22.0-linux-x64/bin:$PATH` |
| **Chromium** | `LD_LIBRARY_PATH=/home/piotr/syslibs/usr/lib/x86_64-linux-gnu CHROME=/home/piotr/.cache/ms-playwright/chromium_headless_shell-1248/chrome-headless-shell-linux64/chrome-headless-shell node e2e/<script>.mjs` (no sudo on this machine; `frontend/e2e/CLAUDE.md`) |
| **Python** | `/home/piotr/Projects/edmat/.venv/bin/python3` (symlinked into the worktree as `.venv`) |
| **Siblings** | A (`parts/a-backend`) builds the write side (`PATCH parts`, edit-suggestion `part`) at the same time; B the importer. You own everything under `frontend/` and nothing under `backend/`. Where you need A's endpoint before it exists, build against the shape below and verify it with `page.route` interception; the integrator runs the real round-trip after the merge. |

## Read first
`prompts/README.md` §4 and §5, `frontend/CLAUDE.md`, `frontend/e2e/CLAUDE.md` (every trap; this
machine's Chromium line is above), then **`SUBEXERCISES-BRIEF.md`** (§3 is your step — what the
reader sees — §4 the edit page, §5 the API). Then the prep commit (`git -C <worktree> show HEAD~1
-- frontend/`): `types/exercise.ts` (`ExercisePart`, `ExercisePartEdit`, `SolutionEntry.partId`,
`ResolvedExercise.parts`, `ExerciseEdit.parts`), `api/mappers.ts`, `services/exercises.ts`
(`submitSolutionEntry` sends `part`). Then the page `routes/exercises/[id]/+page.svelte` whole,
`components/exercise/SolutionEntrySection.svelte` and `SolutionEntryCard.svelte`,
`routes/exercises/[id]/edit/+page.svelte` whole (2026-10-21, §17CU), `components/submission/EditSuggestionForm.svelte`,
`e2e/exercise-edit.mjs` (the newest script; copy its login and screenshot conventions),
`utils/labels.ts` (how refusal words become sentences).

## The task
What `SUBEXERCISES-BRIEF.md` §3 describes, exactly, plus the editor of §4:

1. **The page.** After the shared statement and the whole-exercise Hints stage (labelled
   "for the whole exercise" ONLY when parts exist), one block per part in order: the label and its
   sub-statement (`MathContent`), then its own three stages — Hints, Answer (reveal toggle),
   Solutions — each listing only that part's entries (`entry.partId === part.id`), each with its
   own "Add a hint / solution" that pre-selects the part. Then the whole-exercise Answer and
   Solutions stages (`partId === undefined`). An exercise with `parts: []` renders exactly as
   today — pixel-for-pixel is the bar; diff a screenshot of an ordinary exercise before and after.
   `SolutionEntrySection` gains an optional `part` prop (id + label) that it passes to the
   composer; the card shows "for (b)" as a small label when the entry has a part AND the card is
   shown outside its part's block (the whole-exercise stages never show part entries, so in
   practice: the moderation queue and `/submit/mine` if they list entries — check, and say).
2. **The composer** (wherever `submitSolutionEntry` is called from): a "For:" select — "the whole
   exercise" / each part by label — present only when the exercise has parts, pre-set from the
   block it was opened in, sending `partId`.
3. **Suggest an edit** (`EditSuggestionForm`): when parts exist, a "Which text" select adds the
   parts' statement and answer to the shared ones; sends `part` (A's shape: `part: <id>` on
   `POST /api/edit-suggestions/`, field `statement`|`answer`). The service
   `services/editSuggestions.ts` gains the field; `mappers.ts` the raw key.
4. **The Parts editor** on `/exercises/[id]/edit`: a "Parts" section — the list of parts with a
   label input and two editors (statement, answer — `RichEditor` + `InsertStrip` like the main
   fields), add, remove, move up/down. On save the form sends `parts: [{id?, label, statement,
   answer}]` (A's shape; `services/exercises.ts: updateExercise` passes it through as `parts`
   with numeric `id`s). Before sending a list that drops a known part, the form says that the
   part's hints and solutions go with it and asks once (a confirm in the page, not `window.confirm`).
   Refusal words from A, mirrored in `labels.ts` under your own comment: `part_not_of_exercise`,
   `part_label_duplicate`, `parts_too_many`, `part_and_entry`, `part_field_invalid`, `part_immutable`.
5. **Keys** `parts_*` in BOTH catalogues, one contiguous block at the end, identical sets, every
   `m.*()` call with its `// "Original text"` comment. Recompile Paraglide
   (`npx paraglide-js compile --project ./project.inlang --outdir ./src/lib/paraglide`) — and
   restart your Vite if it was running when you added keys (a running dev server serves a stale
   `_index.js`; §17CU found this).
6. **The browser script** `e2e/exercise-parts.mjs`: seed a three-part exercise through
   `manage.py shell` on YOUR worktree's database (the prep's `exercises/test_parts.py: make_part`
   shows the two rows) owned by `u-michal` (verified contributor), then: read the page as a
   stranger (three blocks, labels, the whole-exercise hint labelled, part (b)'s answer reveals only
   (b)'s), add a hint FOR (b) as michal through the real composer (the real endpoint exists —
   the prep did it) and see it under (b) only, open the edit page as michal, add a fourth part and
   reorder, and intercept the PATCH with `page.route` to assert the exact `parts` payload (A's
   endpoint may not exist on your branch — say so in the script's header and in the board entry;
   the integrator removes the interception after the merge). Screenshots under
   `e2e/screens/exercise-parts/`; LOOK at them. Clear `backend/cachedata/*` first; sign in with the
   seeded tokens (`exercise-edit.mjs` shows how) rather than registering.
7. **Docs**: `HISTORY.md` `## 17CV.C` at the very end (Verified with numbers, Left open); one
   paragraph in `test.md`; `frontend/CLAUDE.md` is the integrator's — put nothing there.

## What "finished" means
- [ ] An exercise without parts renders unchanged (screenshot diff, said in the board entry).
- [ ] Part blocks with their three stages; entries grouped by `partId`; composer "For:" select.
- [ ] `EditSuggestionForm` with the part choice; service + mapper fields.
- [ ] The Parts editor: add, remove (with the in-page confirm), reorder, label + two editors, the
      payload shape asserted.
- [ ] `parts_*` keys in both catalogues, identical sets (`node -e` diff of the key sets, number in
      the board entry); every call site commented.
- [ ] `labels.ts` has the six refusal sentences under your comment.
- [ ] `npm run check` 0/0, `npx eslint .` clean, `npx prettier --check .` clean, `npm run build`
      green, `e2e/exercise-parts.mjs` green on your ports, screenshots looked at.
- [ ] `HISTORY.md` §17CV.C, `test.md`, the board entry in `done.md` with numbers.

## Context — what you need and where it is
| Need | Where | Why |
|---|---|---|
| The reader's view | `SUBEXERCISES-BRIEF.md` §3 | the order of blocks and stages is fixed there |
| The page today | `routes/exercises/[id]/+page.svelte` (the two `SolutionEntrySection` mounts, the Answer stage) | what you wrap per part |
| The composer | `SolutionEntrySection.svelte` (the form it owns), `SolutionEntryCard.svelte` | the "For:" select and the "for (b)" label |
| The edit page | `routes/exercises/[id]/edit/+page.svelte` | the Parts section goes between the answer and difficulty |
| Rich editing | `components/editor/RichEditor.svelte`, `InsertStrip.svelte` (grep the edit page for how they are mounted) | the same two per part |
| Svelte 5 traps | `frontend/CLAUDE.md` (`bind:value`, `$effect` re-firing, `untrack`) | the edit page already uses the `$effect` + `untrack` guard — copy it |
| Browser traps | `frontend/e2e/CLAUDE.md`, `e2e/exercise-edit.mjs` | the Chromium line, tokens, scoping locators to `[data-…]` |
| Seeded accounts | `u-kasia` (staff), `u-michal` (verified), `u-ola`; tokens in `exercise-edit.mjs`'s header or `manage.py drf_create_token` | sign in without registering |

## Shapes fixed in advance
- The prep's types/mappers/service names. Add to them; do not rename.
- `updateExercise(id, edit, locale)` sends `parts` as `[{id?: number, label, statement, answer}]`.
- `POST /api/edit-suggestions/` body gains `part: <number>`.
- i18n prefix `parts_`; `labels.ts` block `PART_REFUSAL_LABELS`.
- `data-` hooks for the script: `[data-part="<id>"]` on each block, `[data-parts-editor]` on the
  editor, `[data-part-row]` per row, `[data-entry-for]` on the composer's select.

## Left open, by design
Parts in `TranslateForm` (a translation of a set carries no part text yet — say it); a part as a
flashcard/contest problem; the moderation queue showing part labels on entries beyond what item 1
finds. Name each in `HISTORY.md` and `todo.md` under "Sub-exercises step C".

## Verify
```bash
W=/home/piotr/Projects/edmat/.claude/worktrees/parts-c-page
export PATH=/home/piotr/.local/opt/node-v24.22.0-linux-x64/bin:$PATH
cd $W/frontend && npm run check && npx eslint . && npx prettier --check . && npm run build
rm -rf $W/backend/cachedata/*
# servers on YOUR ports (CORS must name your Vite origin — see run.sh for the env var it sets):
(cd $W/backend && DJANGO_CORS_ALLOWED_ORIGINS=http://localhost:5283,http://127.0.0.1:5283 ../.venv/bin/python3 manage.py runserver 127.0.0.1:8183 > /tmp/parts-c-api.log 2>&1 &)
(cd $W/frontend && npm run dev -- --port 5283 --strictPort > /tmp/parts-c-vite.log 2>&1 &)
E2E_API=http://127.0.0.1:8183 E2E_BASE=http://127.0.0.1:5283 LD_LIBRARY_PATH=/home/piotr/syslibs/usr/lib/x86_64-linux-gnu CHROME=/home/piotr/.cache/ms-playwright/chromium_headless_shell-1248/chrome-headless-shell-linux64/chrome-headless-shell node e2e/exercise-parts.mjs
```
Check `run.sh` for the exact CORS env var name and the `.env` the frontend reads
(`PUBLIC_API_BASE_URL`); the worktree's `frontend/.env` is already written for your port. Kill
servers by PID. Numbers in the board entry. Commit on your branch; never push, never merge, never rebase.
