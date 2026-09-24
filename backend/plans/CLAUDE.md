# plans — roadmaps with steps and suggestions

`Plan`, `PlanStep`, `PlanSuggestion` — MANAGEMENT-BRIEF.md §3.D, one of six management apps built
in parallel on 2026-09-24 (§0). A plan is a roadmap hung off a node (a course, an event or a
material, `config/nodes.py`) — ordered steps with one level of nesting, and a suggestion box a
reader can drop something into that an editor accepts (becoming a step) or rejects.

## The one invariant everything else follows from

**The node is asked, never re-implemented.** `plans/rules.py` never filters `Course.objects` or
checks `event.host_id` itself — every "who is this node / may this person" question goes to
`config.nodes` (`can_view_node`, `is_node_staff`, `can_manage_node`), because that module already
carries the real answer for each of the four node kinds and a second copy here is how two surfaces
start disagreeing (root `CLAUDE.md`, "Shapes that repeat"). `config/nodes.py` is **read-only** for
this app.

## Shapes

- **`status` is one field on both `Plan` and `PlanStep`**, never a pair of booleans. A plan's is
  `draft → active → {completed, archived}`, `completed → archived`, `archived` terminal —
  `plans/rules.py: _TRANSITIONS`, enforced by `transition_block_reason` and claimed with a single
  WHERE-anchored `update()` (`backend/CLAUDE.md`'s SQLite rule 1), never `select_for_update()`.
- **One level of nesting, by construction, not by convention.** `PlanStep.parent` points at
  another step of the same plan; `views.py: PlanViewSet.steps` refuses to attach a step under a
  step that already has a `parent` (`409 nested`) *before* the row is ever written, which is what
  lets `PlanStepSerializer.get_substeps` recurse without a depth counter — a step with a `parent`
  provably has no `substeps` of its own.
- **`PlanStep.done_by`/`done_at` are a fact about a moment**, kept separate from `status` itself
  (`views.py: PlanStepViewSet.partial_update`, which sets them when `status` becomes `done` and
  clears them if it moves away again) — the same reasoning `cloakroom`'s `deposited_by` carries for
  an operator rather than an owner.
- **`PlanSuggestion` never edits the plan.** Accepting one *creates* a `PlanStep` at the end of the
  plan's top-level steps and records `created_step` — the suggestion is a permanent record of what
  was proposed (house rule 12: tombstone, don't hard-delete), independent of what later happens to
  the step it produced.
- **A minor may not suggest** (`accounts/minors.py`) — a suggestion carries free text to a
  stranger the moment an editor reads it, the same reasoning that already keeps a minor out of
  messaging and a need's application (MANAGEMENT-BRIEF.md §1). A minor may still hold a task and
  vote in a poll; this is Plans' own line, not a blanket one.
- **An editor does not suggest.** `suggest_block_reason` returns `own_plan` for anybody
  `rules.can_edit` already covers — an editor who wants a step adds one directly
  (`POST …/steps/`); giving them the suggestion button too would be two ways to do the one thing.

## Visibility vs. authority (house rule 4)

- **Visibility** (`rules.visible_plans`, the nested list's queryset): node staff see every plan,
  draft included; everyone else who can already see the node sees only `active` plans.
- **Authority** (`rules.can_view_plan` for object-level reads, `rules.can_edit` for every
  mutation): the SAME visibility rule, plus — for editing — the node's own manager or the plan's
  creator. A stranger on a draft plan's `/api/plans/{id}/` gets **404** (for them it does not
  exist); a reader who can see an active plan but may not edit it gets **403** on `transition/`,
  `steps/`, `reorder/`, not a second 404 — the object was genuinely visible, the actor was not the
  right one (the `cloakroom.can_operate`/`_operable` shape).

## Refusal words (house rule 6)

`not_editor`, `not_active`, `minor`, `own_plan`, `steps_pending`, `already_decided`,
`illegal_transition`, `nested`, `not_draft`, `not_own_suggestion` — every one has a sentence in
`frontend/src/lib/utils/labels.ts`'s `PLAN_BLOCK_REASON_LABELS`, which says this file back (house
rule 13). `PLAN_STATUS_LABELS`/`PLAN_STEP_STATUS_LABELS`/`PLAN_SUGGESTION_STATUS_LABELS` mirror
`PLAN_STATUS_CHOICES`/`STEP_STATUS_CHOICES`/`SUGGESTION_STATUS_CHOICES` in `models.py` the same way.

**409 vs. 403**: `steps_pending`, `already_decided`, `not_active`, `illegal_transition`, `nested`,
`not_draft` are the world having moved or a request describing an impossible shape — 409.
`not_editor`, `minor`, `own_plan`, `not_own_suggestion` are about who is asking — 403. `reorder`'s
malformed-group case is a genuinely malformed request — 400, via a DRF `ValidationError`, never
conflated with the 409s (root `CLAUDE.md`).

## API

```
GET|POST /api/nodes/{kind}/{id}/plans/         nested list + create (create: node manager only)
GET|PATCH|DELETE /api/plans/{id}/              DELETE only while draft, 409 not_draft otherwise
POST /api/plans/{id}/transition/ {status}
POST /api/plans/{id}/steps/ {title, description?, due_at?, parent?}
PATCH|DELETE /api/plan-steps/{id}/
POST /api/plans/{id}/reorder/ {ids, parent?}   parent omitted = the plan's top-level steps
GET|POST /api/plans/{id}/suggestions/          GET is editor-only
POST /api/plan-suggestions/{id}/decide/ {decision: accept|reject}
POST /api/plan-suggestions/{id}/withdraw/      the suggestion's own author only
```

All behind `feature_gate('plans')`, `is_staff` bypassed. `PlanViewSet`/`PlanStepViewSet`/
`PlanSuggestionViewSet` are `GenericViewSet`s with no `list`/`create` method — DRF's router only
binds a verb to a method that exists (`config/routers.py`), so `GET /api/plans/` is simply
unrouted, exactly like `cloakroom.CloakroomDeskViewSet`. The node-nested list/create is this app's
own `APIView` (`NodePlansView`), not an `@action` on `courses`/`events`/`materials` — those three
apps are untouched by this step (MANAGEMENT-BRIEF.md §4 rule 1).

`PlanSerializer` embeds `can_edit` and `suggest_block_reason` computed for the requesting user —
answered server-side rather than re-derived client-side for the same "one rule, one module" reason
everything else in this file gives.

## `work.py`

`work_items(user)` — MANAGEMENT-BRIEF.md §3.F's shape, registered by the integrator in
`work/providers.py` (this app never imports `work`, §4 rule 13). Two sections: steps due within 14
days on active plans `rules.can_edit` says I may edit, and pending suggestions on plans I manage.
**Known limitation, named rather than hidden** (house rule 14): it walks every open row and filters
in Python, because `can_edit` dispatches across node kinds that cannot be expressed as one SQL
join. Fine at this project's scale; revisit first if `work_items` ever shows up slow.

## Frontend

`lib/types/plan.ts`, `lib/services/plans.ts`, `components/plans/PlansPanel.svelte` (mount point D
in `ManagementPanels.svelte`), route `/plans/[id]`. i18n prefix `plans_`. No header entry — a plan
is reached from its node's panel or a suggestion's `url`, never its own nav link (MANAGEMENT-BRIEF.md
§3.D: "No header entry for D").

## Verify

`../.venv/bin/python3 manage.py test plans config` (refusals first — visibility, authority,
transitions, nesting, reorder, the suggestion lifecycle, `work_items`). `manage.py check`,
`manage.py makemigrations --check --dry-run`. Browser: `frontend/e2e/plans.mjs`.

## Left open

- **No thread on a plan or a step** — `community.Comment`'s target registry gains a line once the
  shape settles across all six management apps (MANAGEMENT-BRIEF.md §7).
- **No notification** on a new suggestion, a decision, or a step becoming due (rule 12: no new
  notification type in this pass — six branches would collide on `notifications/`). Named here so
  it is not silently forgotten.
- **Plan templates, dependencies between steps, a Gantt view, drag-and-drop** — explicitly out of
  scope for this step (MANAGEMENT-BRIEF.md §3.D "Not in D").
- **`work_items`'s Python-side filter** (above) is an honest O(n) walk, not indexed by editor.
- **A `mySuggestion` receipt is per-page-load only.** The frontend shows a reader their own
  just-submitted suggestion (with a Withdraw button) from the POST response; there is no "my
  suggestions" endpoint, so navigating away and back loses that receipt until a "my suggestions
  across every plan" surface exists (not specified for this step).
