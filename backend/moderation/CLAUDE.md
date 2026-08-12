# moderation — the queue, scoped governors, reports/auto-hide, kill switches

Models: `ExerciseSubmission` (JSON `payload` draft), `EditSuggestion`, `MaterialSubmission`
(real typed fields + a file — no rich text to draft), `Report`, `ContentView` (the viewer pool
auto-hide divides by), `NodeGovernor`, `FeatureFlag`.

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
(IntegrityError AND OperationalError, per-attempt savepoints). `select_for_update()` was tried
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

## Verified-contributor fast path

A brand-new `ExerciseSubmission` from `is_verified_contributor` auto-publishes in
`perform_create` (reusing `_apply_submission` unchanged; `reviewed_by` stays None honestly).
Edit suggestions and translations from the same person still queue — deliberately.

## Verify

`manage.py test moderation` (largest suite — races, scoping, auto-hide, provenance all pinned).
