# Closing integration — for the orchestrating session, after the five land

Order: **C, D, B, E, A** into `ux/mission-nav-tutoring-volunteering` — the two smallest diffs
first, then the backend seams, then the one with a frontend surface, and **A last**: it touches 26
test files, and every conflict it has should be against a tree that has already settled. Before
each merge, re-run that branch's own "Verified" numbers from its board entry on its worktree
(`README.md` §8, last bullet).

1. **Each merge:** `git -C /Projects/edmat merge --no-ff close/<x>-…`; resolve "both appended" in
   `HISTORY.md`, `test.md`, the two catalogues and `labels.ts` with
   `~/.claude/projects/-Projects-edmat/memory/resolve_union.py`; then Prettier and
   then by hand what `fix_labels_seams.py` did (it is named in `README.md` §1 and `HISTORY.md`
   but no longer exists on disk): close any `export const … = {` block the union left open in
   `labels.ts` — `19e9660` is what that fix looks like. Look for identical trailing lines folded
   into context (`};`, `}`). The catalogues: `python3 -c` the two key sets are identical before moving on.

2. **No migration is expected from any branch.** `ls backend/*/migrations/ | diff` against
   `4a57d6d`; if one appeared, stop and read the board — a step was told to write there before
   adding one.

3. **The three one-liners that crossed the ownership table** (`11-closing-design.md` §4): after A
   merges, run `backend/testing/check_databases_declared.py` and expect **0** — B put the line on
   `PermissionMatrixTests`, E on the two `community/test_discussions.py` classes. If it is not zero,
   the name it prints is the step that missed it.

4. **The learning record, once:** sign in as the seeded sharer B used, open their profile, see
   `lessons_done` once. B verified this on their branch; verify it again on the merged tree, because
   the registration lives in `identity/apps.py: ready()` and E's branch also imports from
   `community` at ready-time — order of `INSTALLED_APPS` is the kind of thing a merge changes
   without a conflict.

5. **The whole suite, the way it is now documented:**
   `../.venv/bin/python3 manage.py test --parallel 4 --keepdb` — note the wall-clock; this number
   is the first of the three the cycle is judged on (`11-closing-design.md` §8). Then `check`,
   `makemigrations --check`, `npm run check` 0/0, **`npm run lint` clean** (the second number),
   `npm run build`, `npm run check:katex`.

6. **The browser, on the main checkout's ports**, after `manage.py migrate` (no-op expected) and
   with `backend/cachedata/*` cleared before each script: `flashcards.mjs`, `guide-screenshots.mjs`
   whole (C's chapter is now in the `order`; the budget check at the bottom must still pass),
   `about-discussions.mjs` (E's exact-count assertion, if E delivered one), `about-page.mjs`,
   `learning-record.mjs`, and `npm run check:a11y` over everything — **0 violations on all nineteen
   new pages** is the third number. Look at `static/guide/flashcards/*.png` and
   `e2e/screens/flashcards-*.png` yourself.

7. **Docs the steps were told are the integrator's:** root `CLAUDE.md` "Running, testing" gets the
   parallel command and its time; `CLAUDE_MAP.md` gets `backend/testing/check_databases_declared.py`
   and anything E added under `community/`; `test.md` already has one paragraph per step — check
   they did not land twice. `prompts/README.md` §10 (this cycle's row) gets the outcome in one
   line.

8. **`HISTORY.md`:** the `## 17BT` preamble above the five sub-sections — what the cycle was (a
   closing cycle, no prep commit, the ownership table), the three numbers, what integration found.
   Boards: one `done.md` entry for the integration; `todo.md`'s "Learning cycle — left open" block
   should be **gone** and the "Standing-page discussions — left open" block reduced to what E named;
   anything still open goes under a new heading dated today.

9. **Publishing is a replay** (`CLAUDE.md`): a scratch worktree from `origin/main`, cherry-pick
   minus `grant/` and `deploy/`, and **ask before any push**. Production is on `UPDATE-20261006-c`;
   the next bundle's runbook goes in `deploy/UPDATE-2026-10-xx.md` and is held back like the others.
