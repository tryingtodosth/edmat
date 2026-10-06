# The closing cycle — the design the five steps share

This is the fourth time this project builds several branches at once, and the first time it builds
nothing new. Every item here is already written down as "left open": the top two blocks of
`todo.md` (dated 2026-10-06), `HISTORY.md` §17BR and §17BS. The cycle's whole job is to turn that
list into commits and leave the board shorter than it found it.

`prompts/README.md` is still the rulebook — §4 (what to read, in order), §5 (the fourteen rules for
building many branches at once), §8 (what the previous runs taught). This file is the delta: what
is different about a cycle that closes things rather than opening them, who owns which file, and
what "finished" means for the cycle as a whole.

---

## 1. Why these five, and why in parallel

The left-open list is not one job. It is five, and they touch five disjoint sets of files — which
is the only reason they can run at once. Read the ownership table in §4 before you believe that.

| Step | What it closes | Where that was written down |
|---|---|---|
| **A** test shards | `manage.py test --parallel 4` does not work at all; the serial run prints tens of thousands of lines of traceback noise | `todo.md` "Learning cycle — left open", bullet 2 |
| **B** seams | two implementations of `lessons_done`, one of which must go; two permission-matrix rows `10-integration.md` §3 asked for and never got | `todo.md` bullets 1 and 4; `backend/identity/apps.py: ready()` |
| **C** the manual's flashcards chapter | the chapter is still the honest placeholder `learn/h-manual` wrote before the app existed | `todo.md` bullet 3; the docstring of `frontend/src/lib/content/guide/flashcards.ts`, which says exactly how |
| **D** the browser pass | `e2e/flashcards.mjs` and `e2e/guide-screenshots.mjs` have never been run; `npm run check:a11y` has never been run over the nineteen new pages | `todo.md` bullet 5 — and it says out loud that no green check above it is a substitute |
| **E** discussions | the six left-opens under the standing-page discussions, and the one file Prettier still rejects | `todo.md` "Standing-page discussions — left open" |

**A closing cycle has a sharper definition of done than a building one.** A step is finished when
the bullet it was given is deleted from `todo.md` — not moved, not reworded, deleted — or when the
step has written down why that bullet was wrong. Both are real outcomes. Leaving the bullet there
with a commit beside it is not.

## 2. One decision the owner already took

**The `lessons_done` metric keeps step C's implementation and loses step B's** (owner,
2026-10-06). `courses.record.activity_by_branch` lives in the app that owns `LessonProgress`, which
is the shape `prompts/README.md` §5 rule 13 asks for; `identity.record.lessons_done_by_branch` is a
read-across into another app's models that only existed because step B could not see step C. Step B
of this cycle deletes the loser and registers the winner. It is not a question to re-open on the
branch.

## 3. No prep commit

The three previous runs each began with one. This one does not, and the reason is worth stating so
nobody goes looking for a hash that was never cut:

- **No new app, so nothing to pre-register.**
- **No new feature flag**, so no `moderation` migration, so none of the three-file flag dance.
- **No new migration anywhere.** If a step finds it needs one, that is news: stop and write it on
  the board before adding it. (Step E is the only plausible source, and its brief argues why the
  shape it is given needs none.)
- The shared files that *are* touched — the two catalogues, `labels.ts`, `test.md`, `HISTORY.md` —
  are append-at-the-end files, and §5 rule 5/6/7 already makes every collision in them the
  mechanical "both appended" kind.
  (`fix_labels_seams.py`, which `README.md` §1 runs after a merge, no longer exists on disk;
  `17-closing-integration.md` step 1 says what to do by hand instead.)

So every worktree is cut from **`4a57d6d`**, the head of `ux/mission-nav-tutoring-volunteering`.

## 4. Who owns which file — read this before your first edit

Parallel branches are cheap exactly as long as two of them never edit the same file. This table is
the contract; where it and a brief disagree, this table wins.

| Step | Owns, and may edit | Explicitly not yours |
|---|---|---|
| **A** test shards | every `backend/*/test*.py` **except the two below**; `backend/requirements.txt`; `requirements.txt`; `test.md` | `backend/events/test_permission_matrix.py` (B's), `backend/community/test_discussions.py` (E's) — both need your one-line `databases` fix, and **their owners make it**, not you |
| **B** seams | `backend/identity/{record,apps,tests}.py`; `backend/courses/record.py`; `backend/courses/test_school_mode.py`; `backend/events/test_permission_matrix.py` (rows **and** its `databases` line); `backend/accounts/management/commands/seed_profile_showcase.py` | anything under `backend/flashcards/`, `backend/community/`, the frontend except `labels.ts` |
| **C** manual chapter | `frontend/src/lib/content/guide/{flashcards,index}.ts`; `frontend/e2e/guide-screenshots.mjs`; `frontend/static/guide/flashcards/**`; the `guide_*` block of both catalogues | every other `e2e/*.mjs`; `frontend/src/routes/about/` except `about/guide/**` |
| **D** browser pass | `frontend/e2e/flashcards.mjs`; `backend/flashcards/**` (non-test); `frontend/src/routes/flashcards/**`; `frontend/src/lib/content/showcase/**`; `frontend/src/routes/about/{exercises,flashcards,learning-record,courses,schools,concepts,events}/**` | `about/guide/**` and `guide-screenshots.mjs` (C's); `backend/flashcards/tests.py` is A's only if A needs it — in practice nobody does, it already declares `databases` |
| **E** discussions | `backend/community/**` (including `test_discussions.py`); `frontend/src/lib/{services/discussions.ts,types/discussion.ts,components/moderation/DiscussionLocationsPanel.svelte}`; `frontend/e2e/about-discussions.mjs`; the `discussions_*` block of both catalogues (the prefix `DiscussionLocationsPanel.svelte` already uses); **append-only** in `frontend/src/routes/moderation/+page.svelte` | every other `backend/*/tests.py`; the rest of the moderation page |

Everybody appends to `HISTORY.md`, `todo.md`, `doing.md`, `done.md` and (where the brief says so)
`test.md`. Everybody may add to both catalogues, under their own prefix, as one contiguous block at
the end — §5 rule 5, unchanged.

**`config/nodes.py`, `config/creation.py` and `backend/moderation/migrations/` are read-only for
all five**, as in every previous cycle.

## 5. Where — worktrees, branches, ports

Branch `close/<letter>-<name>`, worktree `/Projects/edmat/.claude/worktrees/close-<letter>-<name>/`,
both cut from `4a57d6d`. The 814x/524x band is free; 813x/523x is the learning cycle's and those
worktrees still exist.

| Step | Branch | API port | Vite port |
|---|---|---|---|
| A | `close/a-test-shards` | 8141 | 5241 |
| B | `close/b-seams` | 8142 | 5242 |
| C | `close/c-manual-flashcards` | 8143 | 5243 |
| D | `close/d-browser-pass` | 8144 | 5244 |
| E | `close/e-discussions` | 8145 | 5245 |

Making one, from the repo root — this is `README.md` §3's recipe with the log-shard line that §3
learned the hard way, and it is not optional:

```bash
W=/Projects/edmat/.claude/worktrees/close-a-test-shards
git -C /Projects/edmat worktree add -b close/a-test-shards "$W" 4a57d6d
cp /Projects/edmat/backend/db.sqlite3 "$W/backend/db.sqlite3"
ln -s /Projects/edmat/frontend/node_modules "$W/frontend/node_modules"
ln -s /Projects/edmat/.venv "$W/.venv"
printf 'PUBLIC_API_BASE_URL=http://127.0.0.1:8141/api\n' > "$W/frontend/.env"
# The nine telemetry log shards are separate SQLite files the copy above does NOT bring. Without
# this, every write that records an AuditEvent answers 500 AFTER creating its row —
# "no such table: telemetry_auditevent" — which looks exactly like a code bug (found by step D of
# the learning cycle, 2026-10-05).
(cd "$W/backend" && for a in logs_0 logs_1 logs_2 logs_3 logs_4 logs_5 logs_6 logs_7 logs_anon; do \
   ../.venv/bin/python3 manage.py migrate --database=$a; done)
```

Two worktree-only symptoms, so nobody chases them as bugs: the dev server answers **403 for KaTeX's
fonts** (`node_modules` is a symlink outside Vite's `server.fs.allow`; the production build bundles
them), and the backend logs `no such table: telemetry_requestlog` per request until the shards
above are migrated. Node 24 first on `PATH` in every shell:
`export PATH=/home/bob/.cache/edmat-tools/node24/bin:$PATH`.

## 6. Launch order

**A and E first**, because they are the two that touch the most files and so are the two the merge
order has to respect. **B, C, D in the same go** — none of them waits on anything. D is the only
step that can discover work for another step (a real bug in `backend/flashcards/`), and if it does,
it fixes it on its own branch and says so loudly on the board; nobody else is in that app.

## 7. Integration

`prompts/17-closing-integration.md`. Merge order **C, D, B, E, A** — the smallest diff first and
the 137-file sweep last, so that every conflict A has is against a tree that has already settled.

## 8. The three numbers this cycle is judged on

1. `../.venv/bin/python3 manage.py test --parallel 4` **completes**, and says how long it took.
2. `npm run lint` is **clean**, so it can finally be used as a gate.
3. `npm run check:a11y` has **run over all nineteen new pages**, and somebody has looked at the
   screenshots from `flashcards.mjs` and `guide-screenshots.mjs`.

None of the three is a code change on its own. All three are the reason this cycle exists.
