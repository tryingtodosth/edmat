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
