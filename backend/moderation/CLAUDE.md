# moderation — the queue, scoped governors, reports/auto-hide, kill switches

Models: `ExerciseSubmission` (JSON `payload` draft), `EditSuggestion` (nullable `entry` FK →
a solution/hint row — those suggestions derive exercise/locale/field from the entry, are decided
by the entry's AUTHOR + staff/governors via `/edit-suggestions/{id}/decide/`, and only
title/statement/answer remain valid translation fields), `Report`, `ContentView` (the viewer pool
auto-hide divides by), `NodeGovernor`, `GovernorApplication`, `FeatureFlag`. The queue payload also
carries `solution_entries` (pending pool entries, governor-scoped) and `material_versions` — both
decided through their own app's ONE review endpoint, never a new `_KIND_MODELS` kind.

## `MaterialSubmission` is gone — a new material is a project now

Retired 2026-09-22. A material comes into being in exactly one way: `POST /api/material-projects/`
(with `publish: true` when the sender means "…and send it"), whose first `coauthoring.MaterialVersion`
waits in this queue's `material_versions` section and is decided at
`POST /api/material-versions/{id}/decide/`. Two models for one act was the defect the board named.

- The fold is `coauthoring/0003_fold_material_submissions` (pending → a draft project with a
  `proposed` v1; rejected → the same with a `rejected` v1 and its decision; approved → its
  material's backfilled v1 learns who decided and what the scanner found). The model went in
  `moderation/0038_delete_materialsubmission`, which depends on it so the order cannot invert.
- **What stayed, and why**: the `material_submissions` feature flag (the ABILITY is unchanged — it
  gates project creation, first publication and the decision on one, per `coauthoring.access
  .governing_switch`), the `material_submission` throttle scope (same budget, new endpoint), the
  `material_submission_approved`/`_rejected` notification types (existing rows carry them), and
  `models.material_submission_upload_path` (migrations 0005/0021 import it by dotted path).
- `RequireVerifiedContributorForMaterialUploads` went with it; the flag it read lives on in
  `coauthoring.services._require_verified_contributor_for_uploads`, which carries its whole
  argument. `_KIND_MODELS` has three kinds again and `'material'` must not come back.
- The ported tests are `coauthoring/test_submit_path.py` (the whole old suite, class for class) and
  `materials/test_validators.py` (the validator tests, which never needed a model).

## Roles

- **Moderator** = `is_staff` (global). **Node governor** = a `NodeGovernor` row (GenericForeignKey
  to a Discipline OR a Branch; a Discipline grant cascades to every Branch under it). Granting/
  revoking is staff-only (v1).
- `governed_branch_ids(user)` returns **`None` for staff ("don't filter") vs. a real, possibly
  EMPTY set for a governor** — never collapse that into an empty-set convention, or a zero-grant
  governor becomes indistinguishable from staff at the query layer.
- BOTH a queryset filter AND an object-level check (`is_governor_of_course` — kept its
  pre-rename name but takes a **Branch** — plus target-resolution helpers) exist because
  single-object actions arrive by URL pk and never run the list query.
  A past leak: a report action's *response* returned the unscoped queue — always re-scope the
  payload you return, not just what you act on.

## Concurrency (the hard-won pattern — see backend/CLAUDE.md SQLite rules)

Every decision claims its row with ONE `filter(pk=…, status='pending').update(status=…, …)`;
a simultaneous second decision affects 0 rows → clean **409**. If the apply step then fails, the
claim is reverted to 'pending' in an `except` so the item isn't stuck. Translation-approve is the
one carve-out: the claim sets only reviewed_by/note, and `_publish_translation` does
delete-superseded-first then its own pending→published UPDATE (the ordering that fixed a
deterministic 500). Submission approval retries `(branch, number)` allocation in a bounded loop
(IntegrityError AND OperationalError, per-attempt savepoints). A material version's decision uses
the identical shape one app over (`coauthoring.services.decide_version`). `select_for_update()` was tried
and made things WORSE on SQLite — don't reintroduce it.

## Auto-hide

Fires at ≥3 distinct reports **and** ≥20% of the target's viewer pool (`ContentView` count).
Both, not either. Targets without a viewer pool no-op gracefully. Restore/remove decisions
notify via `notifications.notify()`.

## Queue performance

`build_report_queue` / `build_moderation_queue_payload` (`services.py`) are bulk-query rewrites
(820 queries/1.4s → 13/~70ms at ~200 groups) and are shared by the real view AND
`manage.py measure_moderation_queue` — one code path only; never fork a measurement copy.
Re-run `seed_moderation_load_test` (manifest-tracked, `--clear` removes exactly what it made)
then `measure_moderation_queue` after touching queue logic.

## FeatureFlag

The kill-switch table (tutoring, messaging, courses, events, …), seeded on by data migration,
gating READS as well as writes via `feature_gate()`, `is_staff` bypassed. A killed feature must
also lose every frontend link (nav, tabs, menus) — pinned by e2e. Adding a flag changes the
seeded-flag-set test's expected list; that test being stale is the intended effect.

**Adding a key is a THREE-file change, and the third is the one that gets forgotten**: the
backend choices + migrations, *and* `frontend/src/lib/types/featureFlag.ts` *and*
`frontend/src/lib/utils/labels.ts`. A key missing from the label map used to render
`undefined()` and take the whole Flags tab down with it — that happened twice (`classroom` after
the rename, `galleries` after migration 0032). `featureFlagLabel()` now falls back to the raw
key, so the tab survives; it still looks broken, so add the label.

**Not every flag wants `feature_gate`.** It is a permission class, so it answers "may this caller
touch this endpoint at all" — right for a whole feature surface, wrong where the flag should
remove one *rule* from an endpoint everybody must still reach. `age_verification` is the second
shape: `RegisterSerializer.validate_birth_year` reads `is_feature_enabled()` directly, because
gating anonymous registration would 403 exactly the people it serves, and the `is_staff` bypass
means nothing to a caller with no account. Pick by what the flag removes, not by habit.

`age_verification` off means the age question leaves `/register` and the under-16 refusal stops
firing — **and nothing else**. The minors regime (`accounts/minors.py`) and Settings → Children
are deliberately outside its reach; `accounts/test_minors.py`'s `RegistrationAgeGateFlagTests`
is what pins that, and `e2e/age-gate-flag.mjs` drives it in a browser.

## Verified-contributor fast path

A brand-new `ExerciseSubmission` from `is_verified_contributor` auto-publishes in
`perform_create` (reusing `_apply_submission` unchanged; `reviewed_by` stays None honestly).
Edit suggestions and translations from the same person still queue — deliberately.

## Verify

`manage.py test moderation` (largest suite — races, scoping, auto-hide, provenance all pinned).

## GovernorApplication — asking to look after a node

- A **Material** is a governable node now, beside Discipline and Branch (`GOVERNABLE_NODE_MODELS`),
  resolved by `services.is_governor_of_material` (material grant → branch → discipline). It is
  addressed by `node_pk`, never `node_slug`: `Material.slug` is unique only within a branch.
- **First come, first served, with no way to change that** — no priority column, no fee, no hook
  for one. A paid fast-track was proposed and dropped (Piotr, 2026-09-18); the model's docstring
  carries why, so a future reader finds it where the hook would have gone. `queue_position` is the
  honest half of "queue tracking" and is shown to the applicant.
- **Deciding stays staff-only** (§17M, unchanged) even though the hierarchy is now three deep;
  delegated granting is a real feature with real failure modes and is not built.
- Approving creates the `NodeGovernor` row in ONE place (`applications.finish_decision`), reusing an
  existing grant rather than duplicating it. Declining requires a reason. The claim is a
  WHERE-anchored `update()` with a revert on failure — §17I's shape.
- Two notification types: the applicant is told the decision; EVERY staff account is told a new one
  arrived (a queue that notifies one person stalls).

Verify: `manage.py test moderation.test_governor_applications` (25).
