# E. Discussions under the standing pages — closing §17BS's left-opens — brief for one agent

| | |
|---|---|
| **Model** | Opus 5, **with the browser harness** (every step runs on Opus, owner decision 2026-10-05) |
| **Branch** | `close/e-discussions` |
| **Worktree** | `/Projects/edmat/.claude/worktrees/close-e-discussions/` |
| **Ports** | API `8145`, Vite `5245` |
| **Base commit** | `4a57d6d` — there is no prep commit this cycle, `11-closing-design.md` §3 says why |
| **Boards** | `/Projects/edmat-boards/` — your `doing.md` entry is already written |
| **Node 24** | `export PATH=/home/bob/.cache/edmat-tools/node24/bin:$PATH` |

## Read first
`prompts/README.md` §4 and §5, `backend/community/CLAUDE.md`, the module docstring of
`backend/community/discussions.py` (the rule module — every decision about these threads is argued
there), `frontend/e2e/CLAUDE.md` trap 27 (written by this feature), then
`prompts/11-closing-design.md` §4 — `backend/community/**` is yours; `backend/moderation/**` is not,
with one named exception below.

## The task

The discussions under `/about` and its subpages landed on 2026-10-06 (`9e4e671`, `HISTORY.md`
§17BS) with six left-opens in `todo.md`. Three of them are product decisions nobody has taken and
stay open; three are engineering, and they are this step. Plus two one-line debts the cycle's
ownership table routes to you.

**1. The browser script asserts an exact count.** `e2e/about-discussions.mjs:188–191` asserts "a
count ≥ 1" because the script leaves its comments behind and cannot remove them. House rule 12
forbids the hard delete the todo bullet asks for, so the honest shape is not a delete endpoint. Work
out what the collapsed line's count actually counts (`SectionDiscussion.svelte`; the thread
endpoint's `comments`), then make the exact number reachable. The three shapes, in the order to try:

- The script's **signed-in** comments are removable today through `DELETE /api/comments/{id}/` by
  their author (tombstone — `Comment.is_removed`). Its **anonymous** comments are *held*
  (`discussions.held_for`: anonymous is always held), so they were never public and never in a
  visitor's count. If the displayed count also excludes tombstones — which a reader would expect, a
  placeholder is not a comment — then the script can clean up after itself and assert exactly, with
  **no new endpoint**. If the count includes tombstones, decide whether it should (write the reason
  in `discussions.py`'s docstring) and change it, with the test.
- If a held anonymous comment still needs clearing for the script's own hygiene, staff can already
  reach it through the existing report-queue actions (`hold_for_review` files a `Report`; the
  queue's `remove` tombstones). The script signs in as `kasia@edmat.example` for that.
- Only if neither closes it: a staff-only action, tombstoning, in `community/views.py`, argued in
  the docstring against rule 12 and the existing `DiscussionLocationViewSet` docstring that refuses
  `destroy` for the *row*.

Finished is: the script's own comments gone or invisible after it runs, and line 191 asserting
`===` a number the script computed.

**2. The held count is a link.** `DiscussionLocationsPanel.svelte:142–143` prints
`Waiting: {heldCount}` as text. A moderator seeing "Waiting: 5" has to go and find them. A held
comment is a `Report` with `HOLD_REASON` (`accounts/minors.py:38–53`), so the five are rows on the
Reports tab of `/moderation` — `?tab=reports`, which the page reads once at mount
(`routes/moderation/+page.svelte:103–110`). Make the count a link that lands the moderator on
**those** rows:

- The queue payload (`moderation/services.py`, the report-row builder around `:660–682`) does not
  say which location a comment belongs to. **Your one permitted edit outside `community/`** is one
  additive, read-only field on a report row — the location key when the target is a `Comment` on a
  `DiscussionLocation`, `null` otherwise — named on the board. Its test goes in
  `community/test_discussions.py`, **not** `moderation/tests.py` (step A is in that file).
- The Reports tab reads `?location=<key>` once at mount, the way it reads `?tab=`, and shows only
  rows carrying that key, with a visible "showing held comments at <key> · show all" line so the
  filter is never invisible. **Append-only** in `+page.svelte`: a new `$state`, a new branch in the
  rows' filter, a new line of markup — nothing reordered. Catalogue keys under `discussions_*`.
- The panel's link is `/moderation?tab=reports&location=<key>`.

**3. No row for a key nobody will read.** `DiscussionLocation` rows are created lazily by the first
writer (`views.py:565–570`, `_location_row(create=True)`) and the page allowlist is a pattern
(`PAGE_RE`), so a well-formed junk key makes a row that shows up to moderators with no comments.
Two halves: **(a)** find out whether the row is created *before* or *after* the post is refused or
held — if before, move it after, so a refused write leaves nothing behind (and a test that a 403
creates no row); **(b)** a management command `sweep_discussion_locations` that deletes rows with no
comments, default settings and `updated_by IS NULL` — those three together mean nobody decided
anything about the row, so deleting it is not a lost decision (house rule 12's own test), and the
docstring says so. `--dry-run` first, prints what it would remove; the board entry says how many it
found on the development database.

**4. Two one-liners routed to you.** Prettier rejects exactly one file in the tree,
`e2e/about-discussions.mjs` — `npx prettier --write` it, so `npm run lint` is clean (the second
number this cycle is judged on, `11-closing-design.md` §8). And `DiscussionEndpointTests@181` and
`DiscussionLocationAdminTests@323` in `community/test_discussions.py` lack
`databases = set(all_log_shards()) | {'default'}` — step A's sweep skips your file on purpose; add
the line with the one-sentence comment `events/tests.py:33` carries.

## What "finished" means

- [ ] `about-discussions.mjs`: **N checks, 0 failed, 0 console errors**, the count assertion exact,
      the script leaving no visible comment of its own behind — confirmed by an authenticated
      re-query at the end (trap 12). N and the run's output in the board entry.
- [ ] The held count in the panel is an `<a>`; clicking it lands on `/moderation?tab=reports&location=…`
      showing only that location's held rows and a line saying so. Screenshot in the board entry.
      `community/test_discussions.py` pins the new payload field for a held comment and `null` for
      a comment elsewhere.
- [ ] A refused or held write creates no `DiscussionLocation` row (test); `manage.py
      sweep_discussion_locations --dry-run` runs and prints its candidates; without the flag it
      removes them; a row with `updated_by` set, or a non-default setting, or any comment is never a
      candidate (three tests).
- [ ] `npm run lint` **clean, whole tree** — this is the only step that can make that true.
- [ ] Both `test_discussions.py` classes declare `databases`; `manage.py test community` serially
      prints no `Failed to write a request log row`.
- [ ] `manage.py test community` green with the new count; `check`; `makemigrations --check
      --dry-run` clean — **no migration**: none of the three changes touches a model. If you find
      one does, stop and write on the board.
- [ ] `npm run check` 0/0; `npm run build` clean; both catalogues have identical key sets and the
      new keys are one contiguous `discussions_*` block at the end of each.
- [ ] `HISTORY.md` has `## 17BT.E …` at the very end; `todo.md`'s "Standing-page discussions — left
      open" block loses bullets 1, 3 and 6 (**deleted**) and keeps 2, 4 and 5 — rewritten only if
      what you learned changes them; `test.md`'s `about-discussions.mjs` paragraph has the new count
      and the command's name. `backend/community/CLAUDE.md` names the command and the filter field.

## Context — what you need and where it is

| Need | Where | Why |
|---|---|---|
| The rule module | `backend/community/discussions.py` — `effective_policy:149`, `post_block_reason:228`, `held_for:260`, `visible_comments:275`, `PAGE_RE:82` | every "may" and "is shown" question |
| The row and why it is lazy | `backend/community/models.py:281–321` (`DiscussionLocation`) | change 3 (a) |
| The three views | `backend/community/views.py:546–800` — `_location_row:565`, `DiscussionPolicyView:595`, `DiscussionThreadView:657` (POST at `:714`, the hold at `:761–775`), `DiscussionLocationViewSet:780` | where the row is created; what the count is |
| The moderator's shape | `backend/community/serializers.py:294–345` (`held_count`, `comment_count`) | what the panel draws |
| The panel | `frontend/src/lib/components/moderation/DiscussionLocationsPanel.svelte:142` | change 2's link |
| The widget and its count | `frontend/src/lib/components/discussion/SectionDiscussion.svelte`; `frontend/src/lib/services/discussions.ts`; `frontend/src/lib/types/discussion.ts` | change 1 |
| The moderation page's read-once `?tab=` | `frontend/src/routes/moderation/+page.svelte:103–110`, the Reports tab around `:560`, the panel's mount at `:683–692` | the pattern to copy for `?location=` |
| How a held comment reaches the queue | `backend/accounts/minors.py:38–53` (`hold_for_review`); `backend/moderation/services.py:200–250` (auto-hide), `:360–375` (restore), `:640–682` (the report rows and their sort) | the one additive field, and why the Reports tab is the right landing |
| The queue endpoint | `backend/moderation/views.py:256–270` (`ModerationQueueView` → `build_moderation_queue_payload`) | read-only for you |
| The script | `frontend/e2e/about-discussions.mjs` (the count at `:188–191`; the staff thread at `:156`) | change 1 and 4 |
| What was found and left | `HISTORY.md` §17BS; `done.md` "Discussions under the standing pages"; `todo.md` "Standing-page discussions — left open" | the six bullets; the `effective_policy` bug the one permissive test caught — the shape of test this feature needs |
| The i18n prefix | `grep -rhoE "m\.discussions_[A-Za-z]+" frontend/src` | `discussions_*` (the panel's); the widget also has a few older `discussion_*` — do not add to those |
| Comment deletion today | `backend/community/views.py` `CommentViewSet.destroy`; `backend/community/CLAUDE.md` on tombstones | whether the script can clean up as the author |

## Shapes fixed in advance

- `GET /api/discussions/`, `GET|POST /api/discussions/thread/`, `/api/discussion-locations/` keep
  their paths and bodies; a new field is additive. `DiscussionLocationViewSet` still has no
  `destroy` — the sweep command is for rows nobody decided about, a `destroy` would be for rows
  somebody did.
- The queue payload's new field is one key on a report row, `null` for anything that is not a
  comment at a location. Name it `discussion_location` and say in `moderation/services.py` *and* in
  `community/discussions.py` that the other file reads it (house rule 13 — mirrored, said in both).
- `?location=` is read once at mount, never written back to the URL, for the reason the `?tab=`
  comment at `+page.svelte:103` gives.

## Left open, by design — write these on the board, do not build them

- **An anonymous writer sees their own held comment once.** `todo.md` bullet 2. A signed cookie
  would fix it and the bullet says it is a decision; it still is. Leave the bullet.
- **One thread per manual chapter** (bullet 4) — deliberate; leave.
- **`/privacy`, `/levels`, `/legal` have no discussions** (bullet 5) — legal text; product decision;
  leave.
- No server-side `?location=` filter on the queue endpoint — the client-side filter over an
  additive field is enough for the numbers a standing page produces; say so, and say when it would
  stop being enough.
- No new notification type (`README.md` §5 rule 12).

## Verify

From `/Projects/edmat/.claude/worktrees/close-e-discussions/`, servers on **your** ports:

```bash
cd backend && ../.venv/bin/python3 manage.py runserver 8145 &
cd frontend && npm run dev -- --port 5245 &
cd backend && ../.venv/bin/python3 manage.py test community --keepdb
../.venv/bin/python3 manage.py sweep_discussion_locations --dry-run
../.venv/bin/python3 manage.py check && ../.venv/bin/python3 manage.py makemigrations --check --dry-run
cd ../frontend && rm -rf ../backend/cachedata/*
E2E_BASE=http://localhost:5245 E2E_API=http://127.0.0.1:8145/api node e2e/about-discussions.mjs
npm run check && npm run lint && npm run build
```

Clear `backend/cachedata/*` before every browser run; never run the script while editing; trap 27 is
yours and it still applies. Numbers in the board entry.
