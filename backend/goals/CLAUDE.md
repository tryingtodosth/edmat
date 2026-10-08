# goals — a goal, and the criteria that say when it has been reached

Scoped context for `backend/goals/`. The owner's ask, 2026-10-08: *"we also need goal class which is
going to be used as a definition of done and also commentable"*. Two models, one rule module, one
kill switch (`goals`), one nullable FK in each of two other apps.

The word was already in use as a **convention**: `/about` calls the twelve module plans the
project's goals (`work/edmat_project.py`, "a goal is a plan on the EdMat organisation"). That
convention is what this app replaces — and by the owner's own call the same day, **those plans did
not move**: goals are a new, shorter list above them, and a plan points UP at the goal it serves.

## The one thing to understand: `met` is derived

Nothing writes `Goal.status = 'met'`. `rules.recount` does, from the goal's criteria, and it is the
only writer — the `needs.rules.recount` shape and the same argument (house rule 5).

```
every criterion met, and there is at least one   ->  met
a criterion re-opened while the goal said met    ->  open
no criteria at all                               ->  stays open, forever, by construction
abandoned                                        ->  left alone in both directions
```

Three consequences that are each a sentence somebody will try to simplify away:

- **A goal with no criteria can never be met.** That is the refusal the ask needs and it needs no
  refusal word — there is nothing to have met. Do not add a "mark met anyway" action.
- **`met -> open` is not a hand transition** (`HAND_TRANSITIONS`). Un-tick the criterion that is not
  actually true, or change what the definition of done says. A `PATCH {"status": "open"}` on a met
  goal is **409 `illegal_transition`**; a `PATCH {"status": "met"}` is **400** with the reason, from
  `GoalSerializer.validate_status` (house rule 10: flag it, don't fake it).
- **`criteria_counts()` must not read the prefetch cache.** A related manager whose relation has
  been prefetched answers `.count()` from that cache, so a goal loaded by a view that prefetched its
  criteria and then had one ADDED counted the old list and stayed `met`. `criteria_counts()` queries;
  `criteria_counts_cached()` is the read-time pair the serializer uses, and it never decides
  anything. Pinned by `tests.DefinitionOfDoneTests.test_adding_an_open_criterion_reopens_a_met_goal`.

A criterion's own state is **one nullable `met_at`** (plus `met_by`), not a boolean and not a
`status`: two states, and `met_at IS NULL` is already the honest spelling of one of them. `is_met` is
a property and nothing stores it.

## Two tiers of authority

| act | who | refusal |
|---|---|---|
| write the goal, its words, its criteria, its order; abandon it | the node's **manager**, or the goal's own author | `not_manager` |
| tick a criterion off, or un-tick it | the node's **staff** | `not_staff` |

The split is the `plans` precedent widened by one act: somebody doing the work is exactly who knows
a criterion is now true, and making them ask a manager to record it is how a definition of done goes
stale. Writing what done MEANS stays with whoever is accountable. `translations/authority.py` asks
`can_edit` for both `goal` and `goal_criterion` — translating is editing, never ticking.

## Visibility is the node's, and nothing narrower

A goal is a public statement of what a body is trying to achieve, which is the whole point of the
list on `/about`. Anyone who can view the node reads its goals, `abandoned` ones included (house rule
12: the record of a decision stays, and stays visible). It deliberately does **not** follow `tasks`,
which is staff-only unless the board is open — a task board is the inside of a team and a goal is the
outside. A dissolved organisation's goals are 404 to everybody but its roster, because its page is.

There is **no draft state**; named in `todo.md` rather than invented here.

## No `destroy` for a goal

`abandoned` is the tombstone. A goal carries a discussion thread (`goals/<id>`) and tasks and plans
point at it, so deleting one would break both; what is worth keeping is the record of what was once
wanted. A **criterion** does delete for real — nothing hangs off one, and editing a checklist means
removing lines from it. `DELETE /api/goals/{id}/` is 405.

## The "serves" link lives in two other apps, and its rule lives here

`tasks.Task.goal` and `plans.Plan.goal` are nullable `SET_NULL` FKs. The rule that a row may only
serve a goal on its **own node** cannot be a database constraint — the two ends are two generic
targets with no shared column — so it is `rules.goal_for_node`, and **both apps ask it** (house rule
13, said in all three files):

- `tasks` through `ServesGoalMixin` on `TaskWriteSerializer` (the node comes from the instance on a
  PATCH, from `context['node']` on a node-nested create, which `tasks/views.py` now passes).
- `plans` through its own hand-rolled `PlanViewSet.partial_update`, which sets three fields by name.

A cross-node goal is **400 `{"goal": ["other_node"]}"`** — the id came out of a request body, and
"that goal is not about this" is the honest answer.

## Endpoints

```
GET  /api/nodes/{kind}/{id}/goals/     anyone who can view the node
POST /api/nodes/{kind}/{id}/goals/     the node's manager
GET|PATCH /api/goals/{id}/             read is the node's rule; PATCH is `can_edit`
POST /api/goals/{id}/criteria/         add one line
POST /api/goals/{id}/reorder/          {ids: [...]} — the WHOLE list or 400
PATCH|DELETE /api/goal-criteria/{id}/  `can_edit`
POST|DELETE /api/goal-criteria/{id}/tick/   `can_tick`; answers {criterion, goal}
```

No `list` on `/api/goals/`: a goal has no site-wide board, because "740 exercises with verified
solutions" means nothing without the body that said it. `tick` answers with the **goal** as well as
the criterion, because ticking the last open line changes the goal's status and a client that had to
re-fetch would draw a stale "open" for a moment.

## Also commentable

A goal is a `DiscussionLocation` page like the other management rows: `goals/5`
(`community/discussions.py`, `MANAGEMENT_PAGE_RE` + `MANAGEMENT_KINDS` + `_row_visible`). No new
endpoint, table or queue; `rules.can_view_goal` is what the thread 404s on, and the `goals` flag
sits above the thread as well as the surface.

## Mirrors to keep in step (house rule 13)

| here | there |
|---|---|
| `GOAL_STATUS_CHOICES` | `frontend/src/lib/types/goal.ts`, `frontend/src/lib/utils/labels.ts: GOAL_STATUS_LABELS` |
| the refusal words | `labels.ts: GOAL_REFUSAL_LABELS` / `goalRefusalMessage` |
| the `goals` flag | `moderation/models.py` + migration 0051, `types/featureFlag.ts`, `labels.ts` — a flag is a **three-file** change and the third has been forgotten twice |
| `goal`, `goal_criterion` | `translations/targets.py`, `translations/authority.py`, `types/translation.ts: TranslatableKind` |
| `goals/<id>` as a key | `community/discussions.py`, `frontend/src/lib/utils/discussionKeys.ts` |

## Verify

`../.venv/bin/python3 manage.py test goals` (28) — the derived `met` in both directions, the
prefetch-cache bug, `abandoned` surviving a recount, the hand-written `met` refusal, `met -> open`
refused, the two authority tiers, the four visibility cases, the kill switch, the serves link and its
cross-node refusal, the whole-list reorder, and the thread. The browser half is
`frontend/e2e/goals.mjs`.
