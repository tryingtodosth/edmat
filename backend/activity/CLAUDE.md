# activity — the public feed's stored event log + anchored micro-posts (root `HISTORY.md` §17AI)

## The one rule

**`ActivityEvent` is public-by-construction, never an audit log.** `services.record_activity()`
is the ONLY writer, called ONLY for events public at that instant (a rejection and its note never
get a row); `services.remove_activity_for(obj)` is the forgetting half — deletes by generic
`source` AND by link target — wired into auto-hide (`moderation/services.check_auto_hide`), the
moderator remove (`ReportActionView`), tombstones and hard deletes (`signals.py`). The table
self-trims past `FEED_RETENTION_DAYS` (90) on write. Do not add read-time privacy filters: if a
row needs filtering out, it should never have been written — widen the forgetting, not the WHERE.

## Write paths

- **Content kinds** (exercise/material/solution_entry/translation/post): explicit
  `record_activity()` calls at the PUBLISH moment — several are queryset-`update()` transitions
  no signal can see (`_apply_submission`, `_publish_translation`, the entry review claim).
- **Community kinds** (review/claim/comment): `signals.py` post_save hooks. Comments go through a
  STRICT allowlist of never-privatizable target types — course threads and issues are absent by
  design; read the allowlist's comment before widening it.
- **Courses / one-off events / listings**: pre/post_save transition pairs (draft→open,
  published+public, created-active). A pause/cancel/privatize transition REMOVES the row.

## `Post`

Body (sanitized in save) + exactly one anchor (discipline|branch|tag — a real DB CheckConstraint)
+ at most one ref (exercise|material|course, SET_NULL) + optional image. The image is re-encoded
(`postimage.py`, shared `imaging.py` bounds — aspect-preserving, EXIF stripped, never the
uploaded bytes). Publishing is immediate: `post_create` throttle (12/hour) + the `posts` kill
switch (which also strips post rows from the FEED for non-staff — links leave with the feature).
Delete = tombstone (`is_removed`); reports via `REPORT_KIND_MODELS['post']` (viewer pool = the
referenced exercise's, else none); thread = generic Comment target `'post'`; replies carry the
new nullable `Notification.post` FK.

## Read

`GET /api/activity/?kind=&discipline=&branch=&tag=&followed=1&before=<id>&limit=` — bare array,
id-cursor. Followed = the caller's `TagFollow`s + active `Enrollment`s, nothing else yet.

`GET /api/posts/?tag=<slug>&before=<id>&limit=` (WP15, 2026-10-15) — one tag's posts, newest first:
what the tag page `/tags/[slug]` lists, and the reading half of "ask a question" (a question IS a
post anchored to a tag — no `kind` field, by design). Reads the **Post table, not the feed**: the
feed trims itself at 90 days and a question must not fall off its own tag. `tag` required (400
otherwise), page ≤ 50, the feed's id cursor. Lists only rows a reader may see — tombstoned,
auto-hidden and minors' HELD posts are left out (a list is not a permalink; the detail endpoint
keeps the tombstone). The content-language rule applies with the usual hidden-count header; the
audience band deliberately does not (as on the feed — audit finding 2). Reply counts come from one
grouped COUNT per page (`comment_counts` in the serializer context). Behind `posts` like the rest
of the viewset. `tag` is still an EXISTING slug (an unknown one is a 400), but since WP16 (2026-10-15, the owner's
"tag creation is a must") a question may instead send `tag_name` — create only, never on an edit.
`PostViewSet.create` hands it to `exercises/tags.py: create_tag_from`, which reuses the tag the name
FOLDS to (case, Polish letters, spaces) or mints a new one (`from_question=True`, `created_by`);
refusals come back as `{tag_name: ['<word>']}` — 400 for the name, 403 for a minor, 429 for
`tag_create` (5/hour, spent only when a tag is actually made). The answer carries `tag_created`
only when a name was sent. A tag a question minted is LISTED only while something visible uses it
(`tags.listed_tags`), and `PostSerializer` withholds such a tag's name on a hidden post from
non-staff readers, so a withdrawn or held question never leaves its tag's name standing.

**`?course=<id>` on the same list (2026-10-21, the course BOARD):** every post whose `ref_course` is
that course or one under it (`courses.rules.descendant_ids` — its versions and subcourses, any
depth), newest first; the course must be one the caller may see (`courses.rules.visible_courses`),
else 404. Combinable with `?tag=`; one of the two is required. The serializer also carries
`attachment_count` — the public, current `attachments/` rows on the post (one grouped COUNT per
page, the comment-count shape) — because a board row should say it carries a PDF before it is
opened. `/ask?course=` is the writing side (the composer sets `ref_course`, then attaches files and
a link to the post it just made). `PostCourseBoardTests`.

**Known gap (found in WP16, not fixed):** `PostCreateThrottle` is a `ScopedRateThrottle` on a
viewset with no `throttle_scope`, and DRF's scoped throttle reads the scope from the VIEW — so
`post_create` (12/hour) is never counted. `TagCreateThrottle` is a `UserRateThrottle` for that
reason. Fixing `post_create` changes live posting behaviour (and needs `cache.clear()` in suites that
post a lot), so it was left for an explicit decision. `community/views.py: _DiscussionThrottle` has
the same shape.

## Verify

`manage.py test activity` (49 — eight of them `PostTagListTests`, fourteen `TagCreationTests`). E2E: `e2e/activity-feed.mjs`
(20 checks — resets by tombstoning prior runs' posts as staff first) and `e2e/ask.mjs` (59 checks,
the ask flow in both languages).
