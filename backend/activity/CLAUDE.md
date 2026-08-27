# activity — the public feed's stored event log + anchored micro-posts (root CLAUDE.md §17AI)

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

## Verify

`manage.py test activity` (21). E2E: `e2e/activity-feed.mjs` (20 checks — resets by tombstoning
prior runs' posts as staff first).
