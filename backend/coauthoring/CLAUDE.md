# coauthoring — a material's project, its team, and its version history

`MaterialProject` (the team + the catalogue while drafting) + `ProjectMember` + `ProjectInvite` +
`ProjectJoinRequest` + `MaterialVersion` (one immutable attempt at the content). Rules live in
`access.py`, writes and side effects in `services.py`, views are thin. `COAUTHORING-BRIEF.md` is the
spec this was built from; where the two disagree, the code wins.

**This app is the ONLY way a material comes into being.** `moderation.MaterialSubmission` — the
single-shot `/submit-material` form — was folded into "a project with a team of one" and deleted on
2026-09-22 (`0003_fold_material_submissions` + `moderation/0038_delete_materialsubmission`). The
submit form is `POST /api/material-projects/` with `publish: true`, which creates the project, its
owner row and version 1 and then calls `publish_version` in the same request; the answer is the
project, and `material_id` (set) versus `head_version.status == 'proposed'` is how the caller tells
"published" from "queued for a moderator". Everything that path used to have came with it: the file
validators, the re-encode, the malware scan, the per-account byte quota, the
`material_uploads_verified_only` restriction, the `material_submission` throttle budget and the
verified-contributor fast path.

## Invariants

- **The `Material` row is the PUBLISHED PROJECTION, not a second source of truth.** Publishing a
  version copies its payload onto `Material.file`/`url`/`body` and its title/description onto the
  `MaterialTranslation` for the **project's** locale — `services.sync_material`, the one writer.
  That is why no existing read site (listings, courses, galleries, reports, the feed, the
  recommender) needed changing, and why the `coauthoring` kill switch can never remove a material.
  Never write a material's payload from anywhere else in this app.
- **Head / published / stale.** Head = the highest-numbered `draft` or `published` row — plus a
  `proposed` one while the project has no material, because before the first publication `proposed`
  can only mean "we pressed Publish and a moderator has not read it yet" (a stranger cannot propose
  on a project that has never published). Without that, a queued first publication had no head at
  all: nothing to name it in a listing and an editor offering `based_on: null`. Published = the one
  `published` row (partial unique index). For a non-member the two coincide, because a draft is
  invisible to them. A save whose `based_on` is not the expected basis is **409
  `{'detail':'stale','head':{…}}`** carrying the real head — collaboration is turn-based by design
  (PRODUCT.md's real-time-editing non-goal), so a stale save is refused rather than silently winning.
  A member's basis is the head; a proposer's is the published version.
- **Publishing checks the basis, not just the number** (`access.publish_block_reason`, read by both
  `services.publish_version` and the serializer's `can_publish`). A draft may publish only if the
  first `published`/`superseded` row up its `based_on` chain is the version published NOW. A number
  check alone let a draft saved while a proposal waited — numbered above it, written without it —
  publish after that proposal was accepted and silently overwrite it (found in review 2026-09-22,
  `ReviewFindingsTests`).
- **A project names itself by the version the caller may see** (`_naming_version` in the project
  serializer): the published one for a stranger, the head for the team, the draft only for a
  teaser. Naming it by the raw head put members' unpublished titles on public pages.
- **Publishing supersedes FIRST, then claims.** `one_published_version_per_project` is a real
  partial index, so the previous row goes to `superseded` before the new one is claimed
  `draft → published` with a WHERE-anchored `update()`. The other order is a deterministic 500 —
  `moderation/views.py _publish_translation` records the same bug in the same shape. If the
  projection then fails, both writes are reverted.
- **Two deciding circles, one predicate.** `access.needs_staff_review(project)` is true when the
  project has no material (a first publication) or no members (an orphan — every backfilled corpus
  material with no `submitted_by`). Those go to staff or the **branch** governor and appear in the
  moderation queue's `material_versions` section. Everything else is decided by the project's own
  team, staff, or the **material** governor. The queue and `access.can_decide` read the SAME
  predicate, so the queue can never show a row nobody in it may decide. Decisions go through
  `POST /api/material-versions/{id}/decide/` — **never a new `_KIND_MODELS` kind** (the
  `solution_entries` precedent, `moderation/CLAUDE.md`).
- **Two switches, two abilities, asked PER PROJECT.** `coauthoring` gates collaborating on a
  material that exists (versions, proposals, members, invites, join requests) and is the class-level
  gate on every view here bar three. `material_submissions` gates bringing a NEW material into
  being: project creation, publishing a first version, and deciding one. Which applies to a publish
  or a decision is `access.governing_switch(project)` — `material_submissions` while
  `project.material_id is None`, `coauthoring` after — because a class-level gate could not express
  "with collaboration off, a new material must still be sendable and acceptable end to end", which
  is the whole point of having two. `views._switch_refusal` is the one helper both actions ask, and
  the serializer's `can_publish`/`can_decide` read the same rule so no button is drawn for a call
  that would 403. Staff bypass both.
  `material_uploads_verified_only` applies to any version that carries a file, checked in
  `services._require_verified_contributor_for_uploads` rather than as a permission class, because
  it restricts one SHAPE of request rather than one action — and that module now carries the whole
  of the retired permission class's reasoning (inverted semantics, fail-CLOSED default).
- **Minors may propose, never own.** `accounts.minors.is_minor` is consulted in project create,
  member add, invite accept and join request, each refusing `400 {'detail': 'minor'}`. A proposal is
  always read by a person before it goes anywhere, which is exactly why it stays open to them.
- **Both halves of house rule 4.** `access.visible_projects` is the queryset filter (a stranger
  gets 404 on a draft — it does not exist for them) and `access.can_view` is the object check. They
  must agree; `CoauthoringBase.test_visible_projects_agrees_with_can_view` pins them against each
  other. A project the caller CAN see but may not act on answers **403**, not 404.
- **Reclaim the bytes, keep the row.** A rejected or withdrawn version loses its file blob
  (`file=''`, `file_reclaimed_at`, `file_size` kept) and nothing else — who proposed what, when, and
  why it was refused is part of the trust model (house rule 12). A `published` or `superseded`
  version is NEVER reclaimed: superseded versions keeping their files IS the history, and the live
  `Material` holds the same stored path.
- **The feed gets a row only for a new version of an already-published material.** Never for a first
  publication (`materials.publish.create_material` announces the material itself) and never for the
  backfill. `MaterialVersion` is registered on `activity/signals.py`'s `post_delete` list so the
  forgetting half works.
- **Exactly one payload per version**, enforced in `clean()` AND the serializer, deliberately not as
  a DB `CheckConstraint` — a reclaimed row has no payload left and must stay valid.
- The **backfill** (`0002_backfill_projects`) gives every existing material a project and a
  `published` version 1 that COPIES the stored file reference (never a re-upload),
  `published_at = material.created_at`, owner from `submitted_by` when there is one. No activity
  rows, no notifications. Reverse is a no-op; forwards is idempotent.
- The **fold** (`0003_fold_material_submissions`) does the same for the retired submissions: pending
  → a draft project with a `proposed` v1, rejected → the same with a `rejected` v1 carrying its
  decision and reclaim stamp, approved → nothing created, its material's backfilled v1 taught what
  only the submission knew (who decided, their note, the scan outcome, the real upload time). It
  re-runs the backfill first, so a material approved through the old path AFTER 0002 still gets a
  project; it seats no owner row for a minor (they may propose, never own — `materialise` falls back
  to `created_by` for the byline); and it is idempotent by matching submitter + branch + v1 title +
  v1 `created_at` rather than by a marker column on a table that is about to be dropped.

## Traps

- `MaterialProject.save()` seats the creator as owner (the `courses.Course.save()` precedent) —
  a historical model in a migration does NOT run it, so the backfill creates the row itself.
- DRF derives uniqueness validators from `unique_together` but **not** from `Meta.constraints`, and
  every constraint here is a `constraints` entry. Nothing relies on DRF to refuse a duplicate; the
  services claim rows with WHERE-anchored updates and answer 409.
- `MaterialSerializer.project_id` and `translation_stale` both walk the reverse one-to-one, so BOTH
  material listings (`materials/views.py` and its long-drifted copy in `taxonomy/views.py`) need
  `select_related('project')` plus `published_version_prefetch()`. Pinned by a query-count test.
- The tests declare `databases = set(all_log_shards()) | {'default'}`; every publish, decision and
  team change writes an `AuditEvent` to its own SQLite file.
- **`propose_block_reason` and `join_block_reason` ask `materials_coop.policy`** (2026-09-24) for
  the project's contribution policy: `request` / `closed` refuse an outsider's proposal with
  `members_only` / `closed`, and a PUBLISHED project under `request` takes join requests (so
  `published` is no longer the only answer there). A project with no `CoopSettings` row is `open`,
  which is the behaviour every test here was written against.

## Verify

`manage.py test coauthoring` (`tests.py` for the feature, `test_submit_path.py` for the folded-in
submit path — the whole retired `MaterialSubmission` suite, ported class for class) and
`manage.py test moderation.test_material_versions_queue`. `test_submit_path.FoldMigrationTests` is
the project's only `TransactionTestCase`: it migrates the database backwards to run the fold for
real, which is why it flushes afterwards and why Django's runner puts it last.
E2E: `frontend/e2e/coauthoring.mjs` (the material-page panel is now `components/coop/CoopPanel`,
which kept this script's selectors) and `e2e/materials-coop.mjs`.
