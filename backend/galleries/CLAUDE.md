# galleries — pictures on a piece of content

`Gallery` (one per target, generic FK) + `GalleryImage` (picture, caption, curated `order`,
uploader). Targets are `material` / `exercise` / `post` only — `GALLERY_TARGETS`, deliberately NOT
`community/targets.py`'s longer comment-target list.

## Invariants

- **Adding is open to anybody signed in; ORDERING is not.** That split is the whole design:
  curating is what `moderation.GovernorApplication` lets somebody apply for. `visibility.can_curate`
  is the one place the rule lives (staff, the post's own author, or `is_governor_of_material` /
  `is_governor_of_course` for the taxonomy cascade).
- **A gallery is exactly as visible as its target**, one predicate per model in `visibility.py`.
  An unknown target type is NOT readable — the failure of forgetting to teach this file about a new
  target must be "no gallery", never "an unguarded one". The leak it guards (an unpublished
  exercise reachable through its pictures) has its own test.
- **The stored picture is never the uploaded bytes** — `imagefile.process_gallery_image` via the
  shared `imaging` module; aspect-preserving, shrink-only, bounded at 2000px (bigger than a feed
  picture's 1600 on purpose: this is routinely a photographed page somebody must read).
- Bounded by 10 MB/upload, 40/gallery, and the SHARED `Profile.material_upload_quota_bytes`
  allowance (summed live, like every other consumer of it). Own throttle scope `gallery_image`.
- Reorder takes the **whole** list and refuses a partial one (a stale client must not have
  positions invented for what it forgot). Only the caption is editable — replacing a picture would
  change what a reader already saw under somebody else's caption.
- Minor-band and minor-author pictures go through `hold_for_review`, same queue as a comment's.
  Reportable as `gallery_image` (no viewer pool → auto-hide never fires; reports wait for a human).
- Behind the `galleries` FeatureFlag, staff bypassing as everywhere.

## Verify

`manage.py test galleries` (28) — weighted at refusals; and `e2e/galleries-and-applications.mjs`,
which drives the add → cannot reorder → apply → approved → can reorder loop end to end.
