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

## Verify

`manage.py test community` — tombstone blanking, resubmit-updates, threading, anonymous
rejection are all pinned there.
