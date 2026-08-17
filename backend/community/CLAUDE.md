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

## Verify

`manage.py test community` — tombstone blanking, resubmit-updates, threading, anonymous
rejection, and the saved-comment privacy/idempotency rules are all pinned there.
