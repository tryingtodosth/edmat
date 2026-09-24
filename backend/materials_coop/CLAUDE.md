# materials_coop — the cooperation overview of a material, and how open it is

One row (`CoopSettings`: `policy` open | request | closed, `welcome_note`) hung off
`coauthoring.MaterialProject` by a `OneToOneField` of its own, one rule module (`policy.py`), one
derived overview (`overview.py`), two URLs nested under the MATERIAL:

```
GET|PATCH /api/materials/{id}/coop/            the overview; PATCH = policy + note, can_manage only
GET|POST  /api/materials/{id}/coop/comments/   the team thread (community.Comment on the PROJECT)
```

Built 2026-09-24 (`HISTORY.md` §17BH) from 2donet's project/dashboard designs. The frontend half is
`lib/components/coop/` (`CoopPanel` on `/materials/[id]`, three switchable designs) and the route
`/materials/[id]/coop`.

## Invariants

- **A project with no row is `open`.** That is what every backfilled corpus project behaved like
  before this app existed, so the default is the absence of a row, not 700 identical rows.
- **The policy is a rule, not a badge.** `coauthoring.access.propose_block_reason` and
  `join_block_reason` import `policy.py` (lazily) and refuse on the write path that already
  exists — `POST …/versions/` answers `400 members_only | closed`, `POST …/join-requests/` takes an
  application on a PUBLISHED project under `request` (before this app, `published` was always the
  answer) and refuses `closed` in its own word. The overview's `can_*` read the same functions, so
  no button is drawn for a call that would be refused. A member is told `member` before the policy
  is ever asked — the ordering in `access.py` is the point.
- **Everything in the overview is derived and per-row filtered.** Versions go through
  `coauthoring.access.can_view_version` one by one; members' counts are recounts over those
  (house rule 5); the timeline has an event only because a row the caller can see says so (house
  rule 9). A draft's `version_drafted` therefore appears for the team and not for a reader without
  a second rule saying so. `join_requests_pending` is a manager's number, `pending_proposals` a
  member's; everybody else gets 0 / [].
- **Both halves of house rule 4.** `views._project_for` scopes through `visible_projects`
  (a stranger asking about a draft project's material, or a taken-down material, gets 404);
  `can_manage` / `policy.can_post` are the object checks before any write.
- **The thread hangs off the project, not the material.** `community/targets.py` maps
  `('coauthoring','materialproject')` → `materialProject`, in `PRIVATE_TARGET_TYPES` (a
  `request`/`closed` team's room is not a public thread a course should link in). Readable by
  whoever can see the project; writable by the team, staff and the governor always, and by any
  signed-in reader only under `open`. The material's own `/comments/` stays the public thread.
- **Same switch as co-authoring.** The overview is a view onto that app's rows; a killed
  co-authoring with a live cooperation page would be a page of links to 403s (house rule 3).
  Deliberately not a new `FeatureFlag` key (the three-file trap for a switch that could never be
  flipped independently).
- A policy change is audited as `permission_change` on `material_project` — it decides who may
  write here. Outside the `atomic()` block, as `telemetry/audit.py` requires.
- `welcome_note` is sanitized on write (`config/sanitize.py`) and rendered through `MathContent`
  on read (house rule 8).

## Verify

`manage.py test materials_coop` (20 tests: visibility, the policy on the write path, the thread,
the switch) plus `manage.py test coauthoring` (its `join_block_reason` tests still hold under the
default). E2E: `frontend/e2e/materials-coop.mjs` (47 checks) and `e2e/coauthoring.mjs` (the panel
kept `.project-panel`, `.version-line`, `button.secondary` and `.notice` on purpose).
