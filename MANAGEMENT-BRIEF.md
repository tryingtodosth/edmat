# Management modules — the design, and the six parallel steps

Written 2026-09-24 from a read of the sibling `2donet` project (`/Projects/2donet/CLAUDE.md` §2.3
Task, §2.5 Need, §2.6 Plan, §2.18 Poll, §2.30 Teams & Organizations, §4AE the management
dashboard, and `STORIES.md`'s twenty personas). Piotr's ask: "add management modules, you can get
inspired by 2donet", built by **six agents at once** — two Opus, two Sonnet, two Haiku. This note is
what lets six branches merge. Read §4 before touching anything.

Status: **§0 (this note, the flags, the shared node seam, the mount points, six registered empty
apps) landed on `ux-and-whiteboard`. Steps A–F are on the shared boards, one `doing.md` entry each.**
`HISTORY.md` §17BI is where each step records what it built.

---

## 0. Where we stand

EdMat has *content* (exercises, materials, concepts), *community* (comments, reviews, claims,
reports) and four *things people run together*: a course (`courses.Course` + `CourseStaff` +
`Enrollment`), an event (`events.Event` + `EventStaff` + `EventAttendance`, and the whole conference
layer), a material project (`coauthoring.MaterialProject` + `ProjectMember`) and a venue
(`venues.Venue` + `VenueStaff`). Each has a roster and a rule module saying who may do what. **None
of them has a way to organise the work itself**: no task with an owner and a due date, no public
"we need somebody who can…", no roadmap, no way to put a question to the team and record the
answer, no organisation standing behind a course or an event, and no page where a person sees
everything that is waiting on them across all of it.

2donet is exactly that layer, built for cooperatives. What we take from it is its *concepts* and
its hard-won decisions (below), not its architecture: 2donet folds everything into one `Content`
shape with a cascading RBAC; EdMat's contract is one app per concern, one rule module per app, and a
polymorphic target through a registry (root `CLAUDE.md`, "Shapes that repeat"). The management
layer follows EdMat's shapes.

## 1. 2donet, reconciled

Accepted, with the step that builds it:

| Decision | From 2donet | Step |
|---|---|---|
| An **Organization** is a first-class thing with its own roster and roles, standing behind courses, events and materials it "runs"; a member's standing on the organisation gives *nothing automatically* on the things it runs — no permission cascade. | §2.30, but the cascade rejected (below) | A |
| A **Task** is a universal actionable item that attaches to anything in the system, with status / priority / due date / assignees, one level of subtasks, progress derived not stored. | §2.3 (Session 11 reframing) | B |
| A **Need** is a public "help wanted" attached to a piece of work, with its own status vocabulary (open / in progress / fulfilled / cancelled — deliberately not Task's), skill level, time estimate, remote/on-site, and applications a manager accepts or declines. **Never paid** (`FINANCES.md`: nothing on this platform takes money). | §2.5, `STORIES.md` #3 Jonas, #4 Priya | C |
| A **Plan** is a roadmap of ordered steps with one level of nesting, progress derived from the steps, and *suggestions* from readers that a manager accepts (becoming a step) or rejects. | §2.6, §4F, §4G | D |
| A **Poll** is a formal, structured decision — single or multiple choice, an eligibility rule, open/close, a written decision when closed — kept apart from the lightweight votes that already exist on claims. Anonymous ballots record *who took part*, never *what they chose*. | §2.18, §4I | E |
| A **work dashboard** is one page of everything waiting on *me*, aggregated from every module, each module contributing its own rows. | §4AE, §4AF | F |
| Role presets, never a checkbox permission editor. | §2.24 | all |
| Every refusal is a *word* the frontend has a sentence for (house rule 6). | EdMat's own rule; 2donet's `*BlockReason` shape agrees | all |

Rejected or narrowed, and why:

- **The permission cascade** (a Project's `nodeId` pointing at a Team pointing at an Organization,
  §2.30). EdMat's rosters are per-object and each has its own rule module already; a cascade would
  put a second answer to "who may edit this course" beside `courses.Course.can_curate`. An
  organisation *links* to the things it runs, and the link is informational plus a badge — house
  rule: "a rule more than one endpoint needs lives in one module", and that module already exists
  for every node.
- **One `Content` shape for everything.** Six apps, six model sets, each with its own registry of
  legal targets — the `community.Comment` / `moderation.Report` shape this codebase already uses
  four times. What is *shared* is the node seam (§2), not the model.
- **Custom roles / renamed tiers** (§2.30 `CustomRole`). Three fixed roles on an organisation.
- **Teams as a separate type.** A "team" in EdMat is already a course's staff, an event's staff, a
  project's members. Organisations are the only new roster.
- **Paid needs, hourly rates, budgets** (§2.5 `isPaid`, §2.31). Never (`FINANCES.md`).
- **Drag-and-drop reordering** (§4F). Up/down controls and a reorder endpoint; no new dependency.
- **Time logging** (§4AF). Not in this cycle; `shifts` already logs volunteer hours for events.
- **Problems** (§2.4). `issues/` exists.
- **Chat inside a task or a need.** Threads are `community.Comment` where wanted, later; a minor may
  not message or be messaged (`accounts/minors.py`), so nothing here opens a free-text channel to a
  stranger for a minor — which is why a minor cannot *apply* to a need or *suggest* on a plan
  (both carry free text to somebody they do not know), while a minor *can* vote in a poll and hold
  a task on a course they are on.

## 2. The shared seam — built in the prep, used by every step

**Backend `config/nodes.py`** — the one place that says which objects work can hang off, and who
has standing on each. Every step *asks it* and never re-implements it:

```
NODE_KINDS = {'course': ('courses','course'), 'event': ('events','event'),
              'material': ('materials','material')}      # + 'organization' once step A lands
resolve_node(kind, pk)              -> instance | None
can_view_node(user, node)           -> bool    # the node's own visibility rule (404 otherwise)
is_node_staff(user, node)           -> bool    # course staff / event staff (+host) / project members
is_node_member(user, node)          -> bool    # staff, OR enrolled (course) / going (event); == staff for a material
can_manage_node(user, node)         -> bool    # can_administer|can_curate / can_organise / coauthoring can_manage
node_staff_users(node)              -> QuerySet[User]
node_content_type(node)             -> ContentType   (for your GenericForeignKey)
node_ref(node, user)                -> {'kind','id','title','is_staff','is_member','can_manage'}
```

A `material` node's authority is its co-authoring project (`material.project`); a material with no
project answers `is_staff = can_manage = user.is_staff`.

**Two endpoints**, in `config/views.py`: `GET /api/nodes/{kind}/{id}/` → `node_ref` (404 unless
`can_view_node`), and `GET /api/nodes/{kind}/{id}/staff/` → `[{id, display_name}]` (404 unless
`is_node_staff`) — the assignee / decider picker every step needs, so no step lists people itself.

**Your nested routes** hang under the same prefix in *your* app's `urls.py`:
`/api/nodes/<str:kind>/<int:pk>/tasks/`, `…/needs/`, `…/plans/`, `…/polls/`, `…/organizations/`.
Resolve with `resolve_node`, 404 unless `can_view_node`, then apply your own rule.

**Frontend** `lib/types/node.ts` (`NodeKind`, `NodeRef` — mirrors `config/nodes.py`, said in both),
`lib/services/nodes.ts` (`getNodeRef`, `getNodeStaff`), and
**`lib/components/management/ManagementPanels.svelte`**, mounted once on `/events/[id]`,
`/courses/[id]` and `/materials/[id]` in the prep. It fetches the `NodeRef` and renders **six mount
points**, one HTML comment per step, each receiving `node`:

```
<!-- management: organizations (A) -->
<!-- management: tasks (B) -->
<!-- management: needs (C) -->
<!-- management: plans (D) -->
<!-- management: polls (E) -->
<!-- management: work (F) — F mounts nothing here; the marker is kept so the file has six -->
```

Step A's organisation page mounts `<ManagementPanels nodeKind="organization" nodeId={…} />` itself.

**Header** (`lib/components/layout/Header.svelte`) has four marker comments — in the flag block of
the script, in the main nav, in the Add… snippet and in the account snippet — each saying which
steps may append a line there. Nothing else in the header is touched by any step.

**Flags** — six kill switches, seeded ON by `moderation` migration `0044`, in all three frontend
files and both catalogues: `organizations`, `tasks`, `needs`, `plans`, `decisions`,
`work_dashboard`. Gate every endpoint with `feature_gate('<key>')`, every link with `can('<key>')`.

**Six registered empty apps** — `organizations/`, `tasks/`, `needs/`, `plans/`, `decisions/`,
`work/` — already in `INSTALLED_APPS` and `config/urls.py` with an empty `NumericPkRouter`, so no
step edits `settings.py` or `config/urls.py` at all. Fill them in.

## 3. The six steps

Each step is one agent, one branch `mgmt/<letter>-<name>`, one worktree
`/Projects/edmat/.claude/worktrees/mgmt-<letter>-<name>`, one board entry, one port pair. Each is
**full stack**: models + migrations + rule module + serializers + views + tests (refusals first),
`lib/types` + `lib/services` + components + routes, both message catalogues, an e2e script run
against real servers with a screenshot looked at, a `backend/<app>/CLAUDE.md`, a `HISTORY.md`
§17BI.<letter> section with "Verified" and "Left open", the board entry moved to `done.md`, and a
`<app>/work.py: work_items(user)` provider in the §3.F shape.

| Step | App | Branch | Agent | API port | Vite port |
|---|---|---|---|---|---|
| A | `organizations` | `mgmt/a-organizations` | Opus | 8121 | 5221 |
| B | `tasks` | `mgmt/b-tasks` | Opus | 8122 | 5222 |
| C | `needs` | `mgmt/c-needs` | Sonnet | 8123 | 5223 |
| D | `plans` | `mgmt/d-plans` | Sonnet | 8124 | 5224 |
| E | `decisions` | `mgmt/e-decisions` | Haiku | 8125 | 5225 |
| F | `work` | `mgmt/f-work` | Haiku | 8126 | 5226 |

### A. `organizations` — organisations, their rosters, and what they run (branch `mgmt/a-organizations`, Opus)

Models: `Organization(name, slug unique, kind: university | faculty | school | student_circle |
ngo | company | other, description (sanitized, `config/sanitize.py`), website, city, is_active,
created_by, created_at)`; `OrganizationMember(organization, user, role: owner | admin | member,
added_by, added_at)` unique per (organization, user), **at least one owner at all times** (removing
or demoting the last one is `409 last_owner`); `OrganizationLink(organization, content_type,
object_id, kind: runs | supports, added_by, added_at)` unique per (organization, target) — the
target is a node from `config/nodes.py`, and creating a link needs `can_manage_node` on the target
**and** `can_manage` on the organisation (`not_node_manager` / `not_org_manager` /
`already_linked`). Founding an organisation needs an adult (`minor`, `accounts/minors.py`).

Rule module `organizations/access.py`: `role_of`, `is_member`, `can_manage` (owner | admin),
`visible_organizations(user)` (active ones are public; an inactive one exists only for its members
— 404 otherwise), `link_block_reason`, `remove_block_reason`. **Also the four answers
`config/nodes.py` dispatches to for the `organization` kind**: `can_view_organization(user, org)`,
`is_organization_member(user, org)`, `can_manage_organization(user, org)`,
`organization_member_users(org)` — and **uncomment the one `organization` line in
`config/nodes.py`'s `NODE_KINDS`**. That is the only edit to a shared backend file any step makes.

API (all behind `feature_gate('organizations')`): `GET /api/organizations/` (`?q=`, `?kind=`,
`?mine=1`), `POST`; `GET|PATCH|DELETE /api/organizations/{id}/` (DELETE = `is_active=False`,
tombstone); `GET|POST /api/organizations/{id}/members/` (POST by account id — there is no people
search; say so in the UI), `PATCH|DELETE /api/organization-members/{id}/`; `GET|POST
/api/organizations/{id}/links/`, `DELETE /api/organization-links/{id}/`;
`GET /api/nodes/{kind}/{id}/organizations/` (the organisations behind a node, for the panel).

Frontend: `/organizations` (browse + "mine" tab), `/organizations/new`, `/organizations/[slug]`
(about, roster with roles, what it runs as cards by kind, and `<ManagementPanels
nodeKind="organization" nodeId={org.id} />`), `/organizations/[slug]/manage` (roster, links).
`OrganizationsPanel` at mount point A: the organisations behind this node with a badge; a node
manager who also manages an organisation links it there. Header: Add… "New organisation" (adults,
flag), account menu "My organisations". i18n prefix `orgs_`.

Not in A: anything an organisation membership *grants* on the things it runs; invitations by
email; a "claim this university" flow.

### B. `tasks` — the universal actionable item (branch `mgmt/b-tasks`, Opus)

Models: `Task(content_type, object_id [a node], title, description (sanitized), status: todo |
in_progress | review | done | cancelled, priority 1–4 default 3, due_at nullable, parent FK self
nullable — **one level**, a subtask of a subtask is `409 nested` —, order, created_by, created_at,
updated_at, done_at)`; `TaskAssignee(task, user, assigned_by, assigned_at)` unique per (task, user),
and an assignee **must be node staff** (`not_staff`).

Rule module `tasks/rules.py`: `visible_tasks(user, node)` (node staff only; a stranger gets 404 on
the node's list and on any task id), `can_edit(user, task)` (node manager, creator, or assignee),
`can_assign(user, task)` (node manager), `transition_block_reason(task, to)` — the table is
`todo → in_progress → review → done`, anything open → `cancelled`, and `done | cancelled → todo` by
a manager only; anything else `409 illegal_transition` —, `progress(task)` = done subtasks over
subtasks (recount, never stored), `is_overdue(task)` = `due_at < now` and not done/cancelled.
`tasks/work.py: work_items(user)` — tasks assigned to me that are open, overdue first, then by due
date, then tasks I created that are in `review`.

API (behind `feature_gate('tasks')`): `GET|POST /api/nodes/{kind}/{id}/tasks/` (`?status=`,
`?assignee=me`, `?overdue=1`); `GET|PATCH|DELETE /api/tasks/{id}/` (DELETE by creator or manager,
`409 has_subtasks` otherwise); `POST /api/tasks/{id}/transition/ {status}`; `POST
/api/tasks/{id}/assign/ {user}` and `/unassign/`; `POST /api/tasks/{id}/subtasks/`; `GET
/api/tasks/mine/`.

Frontend: `TasksPanel` at mount point B — tasks grouped by status with a priority chip, overdue in
red, add-task form, an assignee picker fed by `getNodeStaff`, subtasks folded under their parent;
`/tasks` = "my tasks" (assigned to me, created by me, overdue first) linked from the account menu
marker. i18n prefix `tasks_`.

Not in B: recurring tasks; estimates and time logging; task templates; notifications on
assignment (§4 rule 12 — say it in "Left open").

### C. `needs` — help wanted, and who answered (branch `mgmt/c-needs`, Sonnet)

Models: `Need(content_type, object_id, title, description (sanitized), kind: help | expertise |
equipment | venue | other, status: open | in_progress | fulfilled | cancelled, skill_level: none |
beginner | intermediate | advanced, estimated_hours nullable, deadline nullable, is_remote,
wanted_count default 1, created_by, created_at)`; `NeedApplication(need, user, message (sanitized),
status: pending | accepted | declined | withdrawn, decided_by, decided_at, created_at)` unique per
(need, user).

Rule module `needs/rules.py`: `public_needs(user)` — **open needs on nodes the user can view are
public**; the node's staff also see the rest —, `can_manage(user, need)` (node manager),
`apply_block_reason(user, need)`: `not_open`, `own_node` (staff of the node cannot apply),
`minor` (an application carries free text to a stranger — `accounts/minors.py`), `already_applied`,
`full` (accepted ≥ wanted_count); `decide_block_reason`: `already_decided`. A need becomes
`fulfilled` when accepted applications reach `wanted_count` — **recounted** on every decision, never
incremented. `needs/work.py: work_items(user)` — my pending applications, and needs on nodes I
manage with pending applications (one row per need, with the count).

API (behind `feature_gate('needs')`): `GET /api/needs/` (the public board: `?kind=`, `?remote=1`,
`?q=`, `?node_kind=`); `GET|POST /api/nodes/{kind}/{id}/needs/`; `GET|PATCH /api/needs/{id}/`
(status changes by managers: cancel, reopen); `POST /api/needs/{id}/apply/ {message}`, `POST
/api/needs/{id}/withdraw/`; `GET /api/needs/{id}/applications/` (managers); `POST
/api/need-applications/{id}/decide/ {decision: accept | decline}`.

Frontend: `/needs` (the board: cards, filters, empty state), `/needs/[id]` (the need, the node it
belongs to, apply/withdraw, the manager's applications queue with accept/decline), `NeedsPanel` at
mount point C (open needs on this node, a form for managers, pending-application badge). Header:
main-nav marker gets **"Help wanted"** → `/needs` (behind `needs`). i18n prefix `needs_`.

Not in C: matching by profile skills (`accounts.SkillEntry` exists — name the join in "Left open");
accepted applicants gaining a place on the node's roster (the integrator may wire
`accept → offer membership`; leave the seam as a comment in `rules.py`).

### D. `plans` — roadmaps with steps and suggestions (branch `mgmt/d-plans`, Sonnet)

Models: `Plan(content_type, object_id, title, description (sanitized), status: draft | active |
completed | archived, created_by, created_at)`; `PlanStep(plan, parent FK self nullable — one
level, `409 nested` —, title, description, order, status: pending | in_progress | done | skipped,
due_at nullable, done_by, done_at)`; `PlanSuggestion(plan, user, text (sanitized), status: pending
| accepted | rejected | withdrawn, decided_by, decided_at, created_at)` — accepting creates a
`PlanStep` at the end, and the suggestion points at it (`created_step`).

Rule module `plans/rules.py`: `visible_plans(user, node)` — node staff see all; **an `active` plan
on a node the user can view is readable by anyone**, read-only —, `can_edit(user, plan)` (node
manager or creator), `suggest_block_reason(user, plan)`: `not_active`, `minor`, `own_plan`
(editors do not suggest, they edit); `complete_block_reason(plan)`: `steps_pending` (every step
must be done or skipped); `decide_block_reason`: `already_decided`; `progress(plan)` = done over
(total − skipped), recounted; `reorder(plan, ids)` validates the ids are exactly the plan's
top-level steps (`400` otherwise). `plans/work.py: work_items(user)` — steps due within 14 days
on active plans I can edit, and pending suggestions on plans I manage.

API (behind `feature_gate('plans')`): `GET|POST /api/nodes/{kind}/{id}/plans/`; `GET|PATCH|DELETE
/api/plans/{id}/` (DELETE for `draft` only, `409 not_draft`); `POST /api/plans/{id}/transition/
{status}`; `POST /api/plans/{id}/steps/`; `PATCH|DELETE /api/plan-steps/{id}/`; `POST
/api/plans/{id}/reorder/ {ids}`; `GET|POST /api/plans/{id}/suggestions/`; `POST
/api/plan-suggestions/{id}/decide/ {decision}` and `/withdraw/`.

Frontend: `PlansPanel` at mount point D (each plan as a card: title, progress bar, next step, a
link), `/plans/[id]` (the roadmap: steps with sub-steps, status per step, up/down reorder for
editors, due dates, the suggestion box for readers and the suggestion queue for editors).
i18n prefix `plans_`.

Not in D: drag-and-drop; plan templates (`isTemplate`); dependencies between steps; a Gantt view.

### E. `decisions` — polls, and the decision that closes them (branch `mgmt/e-decisions`, Haiku)

Models: `Poll(content_type, object_id, question, description (sanitized), mode: single | multiple,
anonymous bool, eligibility: staff | members, opens_at nullable, closes_at nullable, status: draft |
open | closed, decision_note, closed_by, closed_at, created_by, created_at)`; `PollOption(poll,
text, order)`; `Ballot(poll, user, cast_at)` unique per (poll, user) — **who took part**;
`Vote(poll, option, ballot nullable)` — `ballot` is set when the poll is not anonymous and **NULL
when it is**, so an anonymous poll's votes are rows nobody can trace to a person (house rule 9:
public by construction). Results are a **recount** over `Vote`, never a stored tally.

Rule module `decisions/rules.py`: `visible_polls(user, node)` (draft: managers only; open and
closed: anyone eligible, plus node staff), `is_eligible(user, poll)` → `is_node_staff` or
`is_node_member` by `eligibility`, `vote_block_reason(user, poll, option_ids)`: `not_open`,
`not_eligible`, `already_voted`, `too_many_choices` (single mode with two ids), `unknown_option`;
`can_see_results(user, poll)` — managers always, everyone else once `closed`; `open_block_reason`:
`no_options` (fewer than two), `already_open`; `close_block_reason`: `already_closed`. A minor
**may** vote (no free text leaves them). `decisions/work.py: work_items(user)` — open polls I am
eligible for and have not voted in, soonest `closes_at` first.

API (behind `feature_gate('decisions')`): `GET|POST /api/nodes/{kind}/{id}/polls/`;
`GET|PATCH|DELETE /api/polls/{id}/` (PATCH and DELETE while `draft` only, `409 not_draft`); `POST
/api/polls/{id}/options/`, `DELETE /api/poll-options/{id}/` (draft only); `POST
/api/polls/{id}/open/`; `POST /api/polls/{id}/close/ {decision_note}`; `POST /api/polls/{id}/vote/
{options: [ids]}`; `GET /api/polls/{id}/results/` (`[{option, count}]`, `ballots`, `eligible_count`).

Frontend: `PollsPanel` at mount point E — open polls with a vote form (radio for `single`,
checkboxes for `multiple`), closed polls with result bars and the decision note, a create form for
managers (question, options, mode, anonymous, eligibility); `/polls/[id]` the same at full size.
i18n prefix `polls_`.

Not in E: ranked or weighted voting; quorum rules; reminders.

### F. `work` — the personal work dashboard (branch `mgmt/f-work`, Haiku)

No models. **A provider registry and one page.** `work/providers.py`:

```python
ITEM_KEYS = ('kind', 'title', 'url', 'due_at', 'status', 'urgency', 'node')
# kind: a short word the frontend has a label for ('task', 'need_application', 'need_decision',
#       'plan_step', 'plan_suggestion', 'poll', 'event', 'course_request', 'proposal', 'shift', 'booking')
# url: a FRONTEND path ('/tasks/12'); due_at: ISO string or None; status: the row's own word;
# urgency: 0 none, 1 this month, 2 this week, 3 overdue/today; node: config.nodes.node_ref(...) or None
register(key, flag_key, provider)   # provider(user) -> list[dict]; skipped when flag_key is off
collect(user) -> {'sections': [{'key', 'items'}], 'unavailable': [keys that raised], 'generated_at'}
```

**A provider that raises is reported in `unavailable`, never fatal** (house rule 10: flag it,
don't fake it), and the page shows a quiet line for it. Ship `work/builtin.py` with providers
for what exists today, each behind its own flag: events I host or staff in the next 14 days
(`events`), events I am going to in the next 14 days, courses I staff with enrolment requests
waiting (`courses`), material projects I am a member of with a pending version (`coauthoring`),
shifts I hold in the next 14 days (`shifts`), tutoring bookings coming up (`tutoring`). **Do not
import `tasks`, `needs`, `plans` or `decisions`** — they do not exist on your branch; the integrator
registers their `work_items` at §5. Write `work/CLAUDE.md` so that registering one is a two-line
change, and a test that proves a raising provider is isolated.

API (behind `feature_gate('work_dashboard')`, authenticated): `GET /api/work/`.

Frontend: `/work` — sections in a fixed order with a heading per section, an urgency dot, due
dates in the reader's format, an empty state per section, one "nothing is waiting on you" state
for the whole page, and the `unavailable` line. Header: account-menu marker gets **"My work"** →
`/work`. i18n prefix `work_`.

Not in F: counts in the header; per-section preferences; email digests (no email backend).

## 4. Rules for building six branches at once

These exist because six agents share one repo, one `config/nodes.py` and one header.

1. **One app per step, and no migration outside your app.** Anything that would be a field on
   `Course`, `Event`, `Material` or `MaterialProject` is a row in your app pointing at it through
   `config.nodes`. If you truly need a shared schema change, stop and write it on the board.
2. **Feature flags are already seeded** (six keys, `moderation` migration `0044`, both frontend
   files, both catalogues). Do not add a key; do not touch `moderation/migrations`.
3. **`config/nodes.py` is read-only for B–F.** Step A uncomments one line. Every "who is this
   node / may this person" question goes through it; a rule you re-implement is how two surfaces
   start disagreeing.
4. **Mount points**: replace **your own marker line only** in `ManagementPanels.svelte` with your
   component; your import goes in the script block **right after the marker comment there**, one
   line. In `Header.svelte`, each of the four marker comments names the steps that may append a
   line after it. Do not reorder anything in either file.
5. **i18n keys are prefixed by step**: `orgs_*`, `tasks_*`, `needs_*`, `plans_*`, `polls_*`,
   `work_*`; add them as **one contiguous block at the end of each catalogue**, both files, identical
   key sets (house rule 1), every `m.*()` call with its `// "Original text"` comment. A key outside
   your prefix is a merge conflict you caused. Recompile Paraglide after editing the catalogues.
6. **`labels.ts`**: append your enum maps at the end under a comment naming your backend module,
   and say in your `models.py` that `labels.ts` mirrors it (house rule 13). Nothing else there.
7. **`HISTORY.md`**: append `## 17BI.<letter> …` at the very end, with "Verified" (what you actually
   ran, with numbers) and "Left open". `test.md` gets one paragraph at the end. `CLAUDE.md`,
   `CLAUDE_MAP.md` and the app list are edited by the integrator only. Write `backend/<app>/CLAUDE.md`.
8. **Boards**: your `doing.md` entry is already written with your branch and worktree at
   `/Projects/edmat-boards/`. When you finish, move it to the top of `done.md` with the commit hash
   and what you ran; re-read the file immediately before editing it and write it in one process (a
   small Python script), because five others edit the same files. Anything you leave open goes to
   `todo.md` under "Management step <letter>".
9. **Verify by running** (house rule 2), from your worktree, with **Node 24** first on `PATH`
   (`export PATH=/home/bob/.cache/edmat-tools/node24/bin:$PATH`): `manage.py test <yourapp> config`,
   `manage.py check`, `makemigrations --check --dry-run`, `npm run check` (0/0), `npm run lint`,
   `npm run build`, and your e2e script `frontend/e2e/<app>.mjs` against real servers **on your own
   ports** (§3 table) — `DJANGO_CORS_ALLOWED_ORIGINS=http://localhost:<vite>,http://127.0.0.1:<vite>
   manage.py runserver 127.0.0.1:<api>` and `npm run dev -- --port <vite> --strictPort` with
   `frontend/.env` already pointing at your API port. Clear `backend/cachedata/*` before each e2e
   run (the login throttle lives in the file cache); never run e2e while editing files (HMR
   restarts kill the run) and never alongside the full backend suite. Look at the screenshot. Say
   in the board entry exactly what you ran and the numbers.
10. **Commit on your branch, never push, never merge, never rebase.** The integrator merges F, E,
    D, C, B, A into `ux-and-whiteboard` and wires §5.
11. **Absolute paths always.** Your shell's cwd is not reliable across calls; every command names
    your worktree. Use `git -C <worktree>`.
12. **No new notification types** (a three-file change across `notifications/`, the settings page
    and the frontend labels, which six branches would collide on). Name the ones you wanted in
    "Left open".
13. **Do not edit another step's app**, `work/` included. Your provider lives in *your* app as
    `<app>/work.py: work_items(user)`; the integrator registers it.
14. **Refusals carry a word** (house rule 6), a stranger gets 404 on what they cannot see (house
    rule 4), every status is one field (never two booleans), counts are recounted, HTML is
    sanitized on write with `config/sanitize.py` and rendered through the existing content
    renderer. Read `backend/CLAUDE.md` and `frontend/CLAUDE.md` before your first line.

## 5. Integration, after the six land

Merge order F → E → D → C → B → A. Then, on `ux-and-whiteboard`:

- register `tasks.work`, `needs.work`, `plans.work`, `decisions.work` in `work/providers.py` (four
  two-line registrations) and add their `kind` labels to the `/work` page;
- run the four `work_items` under the permission matrix's personas and add matrix rows for every
  new endpoint (`events/test_permission_matrix.py`'s header says how);
- decide whether an accepted need application offers a place on the node's roster (C's seam);
- update `CLAUDE.md`'s app list (28 → 34) and flag list (21 → 27), `CLAUDE_MAP.md`, `test.md`;
- run the whole backend suite, `npm run check`, `npm run build`, `check:a11y`, and the six e2e
  scripts plus `events-and-nav.mjs`, `event-registration.mjs`, the course and material scripts;
- one `HISTORY.md` §17BI preamble tying the letters together.

## 6. Defaults in force unless Piotr says otherwise

1. Minor line is **under 16** (`accounts/minors.py`): a minor may hold a task and vote, may not
   found an organisation, apply to a need or suggest on a plan.
2. "Soon" is 14 days everywhere a dashboard or a provider says it; "one level" of nesting for
   subtasks and sub-steps.
3. Members are added by **account id** (no people search yet — `CLAUDE.md` known gaps).
4. Nothing here takes or mentions money.

## 7. Left open, by design

- Threads (`community.Comment`) on a task, a need, a plan or a poll — the target registry gains
  four lines after the shapes settle.
- Notifications for assignment, application decisions, poll openings (rule 12).
- Organisation membership *granting* anything; invitations; a verified-organisation badge.
- People search — every "by account id" above waits on it.
- Time logging on tasks; recurring tasks; plan templates; ranked voting.
