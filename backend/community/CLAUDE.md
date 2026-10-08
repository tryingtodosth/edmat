# community — reviews and threaded comments (shared by half the platform)

Two models, no views of their own worth speaking of — they're reached through other apps'
actions (`ExerciseViewSet.reviews/comments`, `MaterialCoverageViewSet.comments`, course/lesson/
chapter discussion endpoints).

## `Review`

1–5 stars + optional body, `unique_together (exercise, author)`. Resubmitting **updates** the
existing row (the view's existing/partial logic) — never a duplicate. Exercise-only by direct FK;
materials/services/lessons have their own separate review models.

## `Comment`

GenericForeignKey target + self-FK `parent` — ONE model threads discussion under exercises,
materials, coverage claims, courses, lessons, chapters. Because it's generic:

- **Deletion is a tombstone** (`is_removed=True`), never a hard delete — thread structure
  survives; the serializer blanks `body`/`author_display_name` on removed rows.
- **Every endpoint that accepts a `parent` must validate it belongs to the SAME target**
  (same content_type + object_id), in the VIEW — the serializer can't know the target yet.
  This gap was found and closed in two endpoints; any new comment surface must repeat the check
  or a client can reply into an unrelated object's thread.
- Comments are reportable generically (`moderation.REPORT_KIND_MODELS` includes `comment`)
  regardless of what the comment targets. Auto-hide gracefully no-ops when the target has no
  viewer pool (e.g. a coverage claim) — don't "fix" that into a crash.

## `CommentVote`

`(comment, voter, value ±1)`, `unique_together`. `POST|DELETE /api/comments/{id}/vote/`
(signed-in; 409 on a removed/auto-hidden comment). `CommentSerializer` exposes `upvotes`,
`downvotes`, `score`, `current_user_vote` — the last needs `context={'request': …}`, which every
thread GET now passes (with `prefetch_related('votes')`); without it the field is honestly
`None`. **Unweighted on purpose**: the 2x contributor weight lives in `materials.services`, and
importing it here would run the dependency the wrong way. A score orders and signals; it never
hides — hiding stays with reports.

## `SavedComment`

A per-user bookmark on a `Comment` (`unique_together (user, comment)`, optional `note`), as thin
as `services.ServiceWatch`. Private: `get_queryset` is scoped to `request.user`, so there is no id
to guess. Saving twice is the same statement, not two rows (200 + the existing row, not a 400);
unsaving something never saved is a 204, so a client holding a stale flag can't manufacture an
error. A removed/auto-hidden comment refuses with 409 — there is no body left to come back to.

`POST|DELETE /api/comments/{id}/save-for-me/`, `GET /api/comments/saved/`. **`url_path` is spelled
out** on that action: DRF derives `url_name` with hyphens but leaves `url_path` as the method name
verbatim, so `reverse('comment-save-for-me')` resolved while the real route was `/save_for_me/` —
tests green against a URL no client could build. Found by a browser run.

## `targets.py`

`ContentType` → the short name the frontend knows a comment's target by (`'exercise'`,
`'courseLesson'`, …), plus `PRIVATE_TARGET_TYPES` (a course's/lesson's/chapter's own thread).
Needed because a comment has no page of its own: anything showing a comment away from its thread
(a saved-comments list, a course pointing at a discussion) can only be told where to send the
reader by the server. Hand-written, not the model name lowercased — `courses.Course` is
`taughtCourse`. The frontend's `CommentTargetType` union is the other half; neither derives from
the other, so both are flagged in each other's comments.

## `InlineImage` — a picture that goes IN the sentence, not under it

`/api/inline-images/` (`inline_images.py` + the viewset in `views.py`). POST a picture while the
comment is still being typed, get back `embed_html`, and the editor drops that `<img>` into the
body. Shaped after `/api/chem-drawings/`, which made the same argument first: an attachment sits
under a comment, a picture you are writing *about* sits in it.

- **Re-encoded, never stored as sent** — the same `imaging` pipeline `attachments.py` uses. No PDF
  branch: a PDF cannot be re-encoded, and it is not something you put mid-sentence.
- **`embed_html` is the only place the tag is spelled**, and it carries `width`/`height` plus
  `loading="lazy"` so a reader's layout does not jump. `config/sanitize.py` allows exactly those on
  a `/media/` `<img>` — widen one without the other and the picture silently loses the attribute,
  or the whole tag.
- **No PUT, no DELETE.** A picture inside a published comment must keep resolving (house rule 12).
- **The upload happens before the comment exists**, so an inserted-then-abandoned picture leaves a
  row nothing references — as an abandoned chem drawing already does. The storage allowance is what
  bounds it; a sweep for unreferenced rows is not written.
- **`attachments.used_upload_bytes(user)` is the allowance rule for both**, because two endpoints
  now ask it. An endpoint counting only attachments would hand out storage the other was guarding.

**`signals.py` looks for `<img` in the body, not `data-chem=`.** A picture on a minor-band thread
is held for a moderator; when pictures moved into the body, the old narrow check would have let
every ordinary one straight through — the exact hole it was written to close.

`CommentAttachment` is therefore documents-only in practice now. The image branch of
`process_attachment` still exists and is still tested: the endpoint is public API, and nothing
stops an older client from posting a picture to it.

## `DiscussionLocation` + `discussions.py` — talking under a page that has no row

The standing pages (`/about`, the seven `/about/<feature>` showcase pages, the manual's twelve) are
prerendered prose with nothing in any table, so a `Comment`'s GenericForeignKey had nothing to point
at. `DiscussionLocation` is that row — one per place on one of those pages — and
`discussions.py` is the rule module every endpoint asks (root `CLAUDE.md` boundary 2).

- **Two settings, not five.** `audience` (anyone | users | verified | staff) answers *who*;
  `moderated` answers *what happens to what they wrote*. One field could not express "verified
  contributors, and hold what they write".
- **A row with `section=''` is the page's own**, and acts as a **ceiling** over every section on it:
  where a page and a section disagree the NARROWER wins, and `moderated` is an OR. It is also the
  page's own thread — deliberately both, so "close discussion on this chapter" is one action.
- **Rows are created lazily**, by the first person to write at a location or by a moderator
  configuring one. A read never creates one, or a crawler would fill the moderation list.
- **`anyone` includes people with no account, and an anonymous comment is ALWAYS held**, whatever
  `moderated` says — there is no account to notify, suspend or show a history of. Holding reuses
  `accounts.minors.hold_for_review`, so it is `auto_hidden_at` + a `Report`, and the existing queue
  already knows how to show, restore and remove it. **That is why this feature added no new state
  and no second queue.**
- It made two fields nullable, and both have readers that had to learn it: `Comment.author`
  (`comment_author_display` in `serializers.py`, `courses/reports.py`) and `Report.reported_by`
  (nothing reads a reporter's name; the queue payload carries counts and reasons only).
- The page allowlist is a **pattern** (`PAGE_RE`), not a list: the manual's sections live in
  `frontend/src/lib/content/guide/*.ts` and Python cannot read them, so the frontend declares what
  it draws — the same division `targets.py` settles for target names. A well-formed junk key is the
  worst a stranger can make, and it shows up as a row with no comments.
- All of it under `feature_gate`-less `is_feature_enabled('about_discussions')`, because the read
  endpoint must keep answering "no discussion here" when the flag is off, so the frontend draws
  nothing rather than a button that fails on click.
- **A row is created by a write that SUCCEEDS** (2026-10-06). The row used to be created one line
  above the parent check that needs it, so a reply naming a comment in another thread was refused
  400 and still left a `DiscussionLocation` behind. `DiscussionThreadView.post` now resolves the
  row with `create=False`, refuses, and creates only when nothing is left that could refuse. A
  held comment still creates its row — it is stored, and a stored comment needs something to hang
  off.
- **`manage.py sweep_discussion_locations`** removes the rows that are left anyway: the pre-fix
  ones and the well-formed junk keys `PAGE_RE` permits by design. A candidate has **no comments of
  any kind, default settings and `updated_by IS NULL`** — the three together mean nobody decided
  anything about the row, which is why deleting it is not the hard delete house rule 12 forbids.
  `--dry-run` first; the command's docstring argues each condition. `DiscussionLocationViewSet`
  still has no `destroy`, and the two are not the same question.
- **`discussion_location` on a report row** is this app's one field in `moderation/services.py`
  (house rule 13 — mirrored, said in both files). `discussions.report_location_key` builds it from
  a reported comment's already-resolved target: the location key, or `None` for every other
  comment. It is what makes `/moderation?tab=reports&location=<key>` show only the comments held
  at one standing page, which is what the panel's "Waiting: 5" links to. The filter is
  client-side, over the queue the Reports tab already fetches whole; the day a location carries
  more held comments than a moderator will scroll past, it wants a real `WHERE` on the endpoint.
- **What "N comments" counts** is argued in `discussions.py` under that heading: public comments
  only, in all three places that print it. The collapsed line used to take `thread.comments.length`
  and so counted tombstones and, for staff, held rows.

### A task, a plan, a need or a poll is a location too (2026-10-08, `HISTORY.md` §17BY)

The project board's rows got the same threads by letting a row BE a page here: `tasks/17`,
`plans/3`, `needs/2`, `polls/1` (`MANAGEMENT_PAGE_RE`, the frontend's route words) is the `page`
of a `DiscussionLocation`, with no section — one thread, one row of settings. No new endpoint,
table or queue; the moderation tab lists them unchanged and `report_location_key` already works.

- **A row's page can be PRIVATE**, unlike a standing page. `can_read_location` asks the row's own
  app (`tasks.rules.visible_task`, `plans.rules.can_view_plan`, `needs.rules.can_view_need`,
  `decisions.rules.can_view_poll`) and both reading endpoints and the write answer **404** when it
  refuses, or when the row is gone — never 403, which would confirm the row exists (house rule 4).
  `MANAGEMENT_KINDS` is the dispatch table; a kind added there needs its rule named in `_row_visible`.
- **Two kill switches.** `effective_policy` also folds in the row's own flag (`tasks`, `plans`,
  `needs`, `decisions`) for these pages, so a killed board keeps no live thread.
- **`?keys=a,b,c` is the batched read** (`DiscussionPolicyView._many`, 200 keys at most): one
  policy per readable key, unreadable ones simply absent; one query for the location rows, one
  for the counts, one per KIND for the management rows WITH their node prefetched, and the flags
  through `discussions.memoised_flags()` — `is_feature_enabled` reads the database every call, and
  the first version paid it twice per key. A signed-in reader still pays one roster query per row
  inside the app's own rule. The frontend's `rowDiscussions.svelte.ts` is the one caller. Don't add
  a per-row policy fetch anywhere — that is the N+1 this form exists to avoid.
- **No ceiling.** There is no page row above a management row; "close every thread on this board"
  is N switches. Named in `todo.md`.
- **The serializer refuses a row that does not exist** (`tasks/999`) and any section under a row;
  a moderator configuring a location ahead of its first comment is the one caller who types a page.
- `frontend/src/lib/utils/discussionKeys.ts` mirrors `MANAGEMENT_PAGE_RE` (house rule 13, said in
  both files): a word added here and not there is a row the moderation tab cannot link to. It is
  also where a new kind needs a `ROW_KIND_LABELS` entry — `svelte-check` refuses the index without
  one, which is the one thing stopping a kind from being added in two files and forgotten in a third.
- **`goals/5` is one too** (2026-10-08, §17BZ), with `goals.rules.can_view_goal` as its rule and the
  `goals` flag above its thread. One line in `MANAGEMENT_KINDS`, one branch in `_row_visible`.

### An organisation's own page is a location, and it is addressed by SLUG (2026-10-08, §17BZ)

`organizations/edmat` (`ORGANIZATION_PAGE_RE`) is the `page` of a `DiscussionLocation`, with no
section: the thread under an organisation's description, which on `/about` is the one the owner
asked for. `organizations.access.can_view_organization` is the rule, so a dissolved organisation's
thread is members-only exactly as its page is.

**The slug, not the pk**, and `SLUG_KINDS` is the one-line split in `management_rows`. The slug is
this one model's stable public address (read-only on the serializer, "allocated once from the name
and never moves under a link somebody already sent"), it is what `/organizations/[slug]` resolves,
and a key is also an href. A task has no such address; its route is `/tasks/17`.

It is **not** the board ceiling `todo.md` asks for. This row is the organisation's own thread, not a
switch over the threads of its tasks and plans; making it both is one branch in `effective_policy`
and a decision nobody has taken.

## Verify

`manage.py test community` — tombstone blanking, resubmit-updates, threading, anonymous
rejection, and the saved-comment privacy/idempotency rules are all pinned there.
`test_inline_images.py` covers the re-encode, the sanitizer round-trip on `embed_html` (the check
that actually matters — a tag bleach strips is a picture that vanishes on save), the refusals, the
shared allowance and the minor-band hold. The browser half is `e2e/comment-input-kinds.mjs`.

`manage.py test community.test_discussions` (55) covers the standing-page discussions: key
parsing, the page-as-ceiling rule, every refusal word, what is held and what is not, who may
read a held comment, the moderator's list, that a refused write leaves no row, the three
conditions `sweep_discussion_locations` requires, and the `discussion_location` field on a report
row. The browser half is `e2e/about-discussions.mjs`.

`manage.py test community.test_management_discussions` (41) covers a row as a location, and an
organisation's own page as one (the slug key and what it refuses, an active body's public thread, a
closed BOARD not closing the page's own thread, a dissolved body's 404 and its roster's 200, the
`organizations` flag above it, the batched read answering a page beside its board, and the
moderator's add form). It also covers: the key
shape and what it refuses, the 404s (a missing row, a stranger on a closed board's task, a draft
plan, a non-open need, a members poll off an open board) and their roster twins, that
`can_view_need` agrees with `public_needs`, the two settings and the hold on a row, the report-queue
key, both kill switches, the batched read (order, absence, dedupe, the cap, the query count) and the
moderator's add form. The browser half is `e2e/management-discussions.mjs`.
