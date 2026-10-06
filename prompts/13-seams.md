# B. Seams — one `lessons_done`, and the two matrix rows that never landed — brief for one agent

| | |
|---|---|
| **Model** | Opus 5 (every step runs on Opus, owner decision 2026-10-05) |
| **Branch** | `close/b-seams` |
| **Worktree** | `/Projects/edmat/.claude/worktrees/close-b-seams/` |
| **Ports** | API `8142`, Vite `5242` |
| **Base commit** | `4a57d6d` — there is no prep commit this cycle, `11-closing-design.md` §3 says why |
| **Boards** | `/Projects/edmat-boards/` — your `doing.md` entry is already written |
| **Node 24** | `export PATH=/home/bob/.cache/edmat-tools/node24/bin:$PATH` |

## Read first
`prompts/README.md` §4 and §5, then `prompts/11-closing-design.md` — §2 is the decision this step
executes and §4 the files that are yours.

## The task

Two small backend edits the learning cycle's integration left on the board because each one wanted
a decision rather than a quiet hand. The decisions are taken; make the edits.

**1. One implementation of `lessons_done`.** Steps B and C of the learning cycle each wrote one,
on branches that could not see each other: `identity.record.lessons_done_by_branch` (read-only over
`courses`, registered at the bottom of `identity/record.py`, tested in `identity/tests.py`) and
`courses.record.activity_by_branch` (in the app that owns `LessonProgress`, tested in
`courses/test_school_mode.py:549–577`, **not registered**). `identity.record._activity_block` sums
across providers, so registering both would double every number on every profile — which is why
`identity/apps.py: ready()` carries a long docstring explaining that it registers only the
flashcards provider and leaves this to the board.

**The owner's decision (2026-10-06): keep C's, delete B's.** The provider lives where the rows live
(`README.md` §5 rule 13), and the record module stops importing `courses.models` at all. Concretely:

- Delete `lessons_done_by_branch` from `identity/record.py` and its `register_activity_provider`
  line at the bottom; fix the module docstring, which names it four times and explains why it
  "lives here because `courses` had nothing to hand" — that was true on 2026-10-05 and is not now.
- Register `courses.record.activity_by_branch` in `identity/apps.py: ready()` beside the flashcards
  one, and rewrite that docstring: it currently argues at length for *not* doing this. Keep the
  one sentence that is still true (the hook lives in the app that owns the rows; the integrator
  wires it) and the idempotency reason.
- `identity/tests.py` — grep `lessons_done` — retargets whatever asserted B's function to the
  registry (`ACTIVITY_PROVIDERS` contains `courses.record.activity_by_branch` after `ready()`) or to
  the end-to-end record (`LearningRecordTests@638` reads the whole record through the endpoint; that
  is the test that proves a lesson marked done shows up, whichever function counts it). Do not
  delete a test that pins behaviour; move it to where the behaviour now lives.
- `courses/record.py`'s module docstring says "the integrator registers this function" — it is now
  registered; say where. Its `activity_by_branch` guards `AnonymousUser` and `None`; B's did not —
  check whether anything relied on B's raising (nothing should; `_activity_block` is only called
  behind `share_activity`).
- `accounts/management/commands/seed_profile_showcase.py:150` names `lessons_done_by_branch` in a
  comment; point it at the survivor.
- The label beside the column in both catalogues says *said they finished*, not *completed*, and
  both implementations' docstrings insist on the distinction. Keep the label; nothing here changes
  what the number means.

**2. The two permission-matrix rows.** `prompts/10-integration.md` §3 asked for six blocks of rows in
`backend/events/test_permission_matrix.py`; four landed. Missing:

- `/api/course-completions/{id}/` — step C's certificate (`courses/views.py`, grep
  `CourseCompletion`; the shape is in `backend/courses/CLAUDE.md` and `HISTORY.md` §17BR.C). The
  rows the matrix's own header demands: the holder reads it (200), a stranger gets 404 (a
  certificate is a personal record), anonymous 401 or 404 — read the view to see which it actually
  answers and pin *that*, with the refusal word where the rule module gives one.
- `/api/creation/` — step F's gate (`config/creation.py`, `HISTORY.md` §17BR.F). It is a GET that
  tells the caller what they may found; every persona gets a 200 with a *different body*, so the
  rows pin the body's `may_found`/reason fields, not just the status. The matrix supports a
  `(status, refusal word)` pair — check whether it supports a body predicate; if not, a small
  `assertBody` hook on the row tuple is in scope, documented in the file's header box.

**And the one-line fix step A cannot make.** `PermissionMatrixTests@89` lacks
`databases = set(all_log_shards()) | {'default'}` (`11-closing-design.md` §4 — the file is yours, so
the line is yours). Add it with the same one-sentence comment `events/tests.py:33` carries.

## What "finished" means

- [ ] `grep -rn lessons_done_by_branch backend/` finds nothing.
- [ ] `grep -rn "courses.record\|courses_activity" backend/identity/apps.py` finds the registration,
      and `ready()`'s docstring no longer argues against it.
- [ ] `manage.py test identity courses flashcards` is green, and `identity/tests.py` still has a test
      that marks a lesson done and sees `lessons_done: 1` on the record — through the endpoint.
- [ ] With both servers up on your ports, sign in as a seeded user who has `share_activity` on and
      lessons marked done (`seed_profile_showcase` builds one — read the command to learn which),
      open their profile, and **see the number once, not twice**. Screenshot in the board entry.
- [ ] `test_permission_matrix.py` has two new row blocks under a `# closing step B` heading, each
      with at least: the role that may (2xx), one role that may not (403), a stranger (404), anonymous.
      `manage.py test events.test_permission_matrix` green.
- [ ] `PermissionMatrixTests` declares `databases`; a serial run of that one module prints no
      `Failed to write a request log row` traceback.
- [ ] `manage.py check`, `makemigrations --check --dry-run` clean. **No migration** — nothing here
      changes a model; if you think it does, stop and write on the board.
- [ ] `HISTORY.md` has `## 17BT.B …` at the very end with "Verified" (numbers) and "Left open";
      `todo.md` bullets 1 and 4 under "Learning cycle — left open" are **deleted**, not reworded.

## Context — what you need and where it is

| Need | Where | Why |
|---|---|---|
| The registry, the summing, the two providers | `backend/identity/record.py:55–70` (registry), `:114–150` (B's provider — to delete), `:195–235` (`_activity_block`), `:287–288` (registrations) | the whole of change 1 |
| The deliberate non-registration | `backend/identity/apps.py` | the docstring you rewrite |
| The survivor | `backend/courses/record.py` | registered by you; its docstring updated by you |
| Its tests | `backend/courses/test_school_mode.py:540–580` | they stay; they already pin the counting |
| B's tests to retarget | `backend/identity/tests.py` — grep `lessons_done`, `ACTIVITY_PROVIDERS`, `register_activity_provider` (lines 35, 55, 638+, 803, 815) | move, do not drop |
| The design the metric serves | `prompts/00-DESIGN.md` §1 rule 3, §4.4; `prompts/03-learning-record.md` | so the docstrings you touch still say the true thing |
| The matrix and how to add rows | `backend/events/test_permission_matrix.py:1–45` (the header box), `:89` (the class), `:1359–1390` (the `nodes/` rows — the most recent block, a worked example) | shape of a row, what every endpoint needs |
| The certificate endpoint | `backend/courses/views.py` grep `CourseCompletion`; `backend/courses/CLAUDE.md`; `HISTORY.md` §17BR.C | what each persona should get |
| The creation gate | `backend/config/creation.py`; `backend/config/test_creation.py` (its own tests — the matrix rows are the cross-persona view, not a copy) ; `HISTORY.md` §17BR.F | same |
| The personas | `backend/testing/personas.py` | the seven accounts the matrix speaks of |
| What was asked and not delivered | `prompts/10-integration.md` §3; `todo.md` "Learning cycle — left open" bullets 1 and 4 | the exact gap |

## Shapes fixed in advance

- The metric key stays `lessons_done`; `METRIC_KEYS` in `identity/record.py` and its mirror
  `LEARNING_RECORD_METRICS` in `frontend/src/lib/utils/labels.ts` do not change. You should not need
  to open `labels.ts`.
- `register_activity_provider` stays idempotent and stays the only way in.
- The matrix row tuple shape `(persona, method, path, body, expected, note)` does not change; if you
  add a body predicate it is an optional seventh element or a wrapper on `expected`, and the header
  box documents it.

## Left open, by design

- No per-course record, no time window, no caching of the counts — `todo.md` "Learning step B —
  left open" keeps those; you are not re-opening them.
- No new permission-matrix rows beyond the two blocks named. If reading the certificate view shows
  you a third endpoint nobody pinned, write it on the board.
- Nothing in `frontend/` changes.

## Verify

From `/Projects/edmat/.claude/worktrees/close-b-seams/`:

```bash
cd backend
../.venv/bin/python3 manage.py test identity courses.test_school_mode events.test_permission_matrix flashcards --keepdb
../.venv/bin/python3 manage.py check
../.venv/bin/python3 manage.py makemigrations --check --dry-run
grep -rn lessons_done_by_branch . ; echo "exit $? (want 1)"
# the profile, by eye:
../.venv/bin/python3 manage.py runserver 8142 &   # API
cd ../frontend && npm run dev -- --port 5242     # then the profile of the seeded sharer; screenshot
```

Clear `backend/cachedata/*` before signing in through the browser (the login throttle lives in the
file cache). Numbers and the screenshot path in the board entry.
