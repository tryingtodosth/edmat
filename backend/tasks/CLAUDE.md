# tasks/ — the universal actionable item

Management step B (`MANAGEMENT-BRIEF.md` §3.B, built 2026-09-24 on `mgmt/b-tasks`). A **task** is
"somebody has to do this, by then" attached to a *node*: a course, an event, a material, or an
organisation once step A lands. Two tables, one rule module, one flag (`tasks`).

`HISTORY.md` §17BI.B has the reasoning and what was left open. Read the root `CLAUDE.md` and
`backend/CLAUDE.md` first; this file is only what is specific to tasks.

## The shape

```
Task(content_type+object_id -> a node, title, description, status, priority 1-4,
     due_at, parent -> Task (ONE level), order, created_by, created_at, updated_at, done_at)
TaskAssignee(task, user, assigned_by, assigned_at)          unique per (task, user)
```

- **The target is a node, never a model of ours.** `config/nodes.py` is the registry and the
  authority; this app holds no allowlist of legal targets and no copy of anybody's roster rule.
  When step A uncomments `organization` there, tasks work on organisations with no change here.
- **One level of subtasks.** `parent` is a self FK; a subtask of a subtask is `409 nested`. The
  schema cannot express that, so `rules.subtask_block_reason` and the tests are what keep it true.
- **`progress` and `is_overdue` are recounted, never stored** (house rule 5). `done_at` IS stored,
  because it records *when*, which `status` cannot.
- **One `status`, never two booleans.** `done` and `cancelled` are different ends.

## The rule module is the whole app

`rules.py` answers every question more than one endpoint asks, and `views.py` asks it. The words:

| Word | HTTP | Means |
|---|---|---|
| `not_manager` | 403 | Assigning, unassigning and reopening are the node manager's |
| `not_staff` | 400 | The person named cannot be an assignee — they are not on the roster |
| `not_allowed` | 403 | Editing / moving / deleting, and you are none of manager, creator, assignee |
| `already_assigned` | 409 | A second click |
| `not_assigned` | 400 | Taking off somebody who was never on |
| `nested` | 409 | A subtask of a subtask |
| `has_subtasks` | 409 | Delete refuses rather than cascading somebody else's rows away |
| `illegal_transition` | 409 | Not a move the table has, or the row moved under you |

`frontend/src/lib/utils/labels.ts` has a sentence for each (`TASK_BLOCK_REASON_LABELS`) and names
`tasks/models.py` back — house rule 13, said in both files.

**The transition table** is `todo → in_progress → review → done` forward, any open status →
`cancelled`, and `done | cancelled → todo` for a manager. There is deliberately **no**
`review → in_progress` (a rejection): §3.B's table is what was specified, and widening it is a
decision somebody should make on purpose, not a patch. Named in `HISTORY.md` §17BI.B "Left open".

**The claim is one WHERE-anchored `update()`** (`backend/CLAUDE.md` SQLite rule 1), not a
read-then-save: two people clicking Done at once must not both win, and `select_for_update()` is a
silent no-op on SQLite.

## Two traps this app has that the rest of the backend does not

1. **There is no SQL for "tasks on nodes I am staff of."** The target is a `GenericForeignKey`
   across three models with three different rosters, so the queryset filter house rule 4 asks for
   genuinely does not exist. What replaces it: **every path scopes before it reads** — the nested
   list resolves its node and 404s a non-staff caller before touching `Task`, and every
   single-object path goes through `TaskViewSet.get_object`, which asks `rules.visible_task`.
   **There is no `GET /api/tasks/`**, on purpose: a list with no node to scope it to is exactly the
   unscoped queue that leaked once before. `mine` and `work_items` filter in Python, over one
   account's own rows.
2. **`status` is not writable by PATCH.** `TaskWriteSerializer` does not list it. A PATCH that
   could set it would be a second, unguarded copy of the transition table; there is a test that
   fails if somebody adds it back.

## API

```
GET|POST   /api/nodes/{kind}/{id}/tasks/   ?status= ?assignee=me ?overdue=1   (node staff; else 404)
GET|PATCH|DELETE /api/tasks/{id}/
POST       /api/tasks/{id}/transition/  {status}
POST       /api/tasks/{id}/assign/ | /unassign/   {user: <account id>}
POST       /api/tasks/{id}/subtasks/
GET        /api/tasks/mine/     -> {assigned: [...], created: [...]}
```

All behind `feature_gate('tasks')`. Members are named by **account id** — there is no people
search in this project, and the frontend's picker is fed by `GET /api/nodes/{kind}/{id}/staff/`
(the shared seam) so nobody ever types one.

## work.py

`work_items(user)` is this app's row on the personal work dashboard (§3.F): open tasks assigned to
me, overdue first, then tasks I created that are in `review`. Nothing here imports `work/`, and
`work/` does not import this — the integrator registers it in two lines (§5).

## Polish

`zadanie` is already this project's word for an **exercise** (root `CLAUDE.md` glossary). The panel
is therefore `Zadania zespołu` ("team tasks") rather than a bare `Zadania`, and the personal page is
`Moje zadania`. If a third thing ever needs the word, that is the moment to rename one of them
rather than to add a third meaning.

## Tests

`tests.py`, refusals first: visibility (a stranger, an attendee, an anonymous caller and an
unknown node kind all 404), authority (who may edit, assign, delete), the whole transition table
including the lost race, the one level of subtasks, the derived numbers, the three filters, the
sanitizer, `mine`, `work_items` and the kill switch. `databases` includes the telemetry log shards
— a 404 walks through the request logger, and without them the failure is about `logs_0` rather
than about tasks.
