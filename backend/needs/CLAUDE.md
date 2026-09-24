# needs — help wanted, and who answered (MANAGEMENT-BRIEF.md §3.C)

`Need` and `NeedApplication`, hung off a course, an event or a material through the shared node
seam (`config/nodes.py`) rather than a direct FK — the same reasoning every management app in
`MANAGEMENT-BRIEF.md` follows: one app per step, no migration outside it (§4 rule 1).

## The one invariant everything else follows from

**A need is never paid.** `FINANCES.md`: nothing on this platform takes or mentions money.
`estimated_hours` is an estimate for somebody deciding whether they have the time, never a rate,
and nothing here computes a cost.

## Shapes

- **`Need.status` is one field**, never a pair of booleans: `open` → `in_progress` (a manager's own
  call, or left alone) → `fulfilled` (**derived only** — `needs/rules.py: recount` is the sole
  writer, never a manager's `PATCH`) or `cancelled` (a manager's call).
  `NeedSerializer.validate_status` refuses a client-set `fulfilled` outright.
- **`fulfilled` is a RECOUNT, never an increment** (house rule 5): `rules.recount(need)` compares
  `accepted_count()` (a live `COUNT` over the applications FK) against `wanted_count` on every
  decision and withdrawal, and is a single WHERE-anchored `update()` so a stray concurrent recount
  loses cleanly rather than overwriting a status that moved again in between.
- **`NeedApplication` is unique per `(need, user)` across every status, not just the live ones.**
  A withdrawn or declined application is the record of that decision (house rule 12 — tombstone,
  don't hard-delete), and re-applying after withdrawing is deliberately not offered: the honest
  read of the unique constraint is that a mind changed once, and a second answer is a message to
  the node's staff, not a second row pretending to be a first one.
- **The node is a `GenericForeignKey`**, resolved through `config.nodes` — never a direct FK to
  `Course`/`Event`/`Material`. `needs/rules.py` asks `config.nodes.can_view_node` /
  `is_node_staff` / `can_manage_node` for every question about the node itself, and never
  re-derives a course's or an event's own visibility rule (the trap `config/nodes.py`'s own
  docstring names — "an app that filters `Course.objects` itself is how two surfaces start
  disagreeing"). `organization` nodes are silently unsupported until step A lands
  (`config.nodes.NODE_KINDS` does not carry that kind yet on this branch) — an attempt 404s, and
  `NeedsPanel` (frontend) treats that 404 the same as "nothing here yet".

## Rules live in `rules.py`, and the endpoints ask

`can_manage`, `public_needs`, `node_needs`, `apply_block_reason`, `decide_block_reason`, `recount`.

Every refusal is a word, not a boolean (house rule 6): `not_open`, `own_node`, `minor`,
`already_applied`, `full` (`apply_block_reason`); `already_decided` (`decide_block_reason`, and
reused by a too-late withdraw — declined/withdrawn/already-decided is the same "this is already
settled" shape); `not_manager` (creating, editing or deciding without the node's standing). All of
them have a sentence in `frontend/src/lib/utils/labels.ts`.

**409 vs 403 vs 400** (root `CLAUDE.md`): `not_open` / `already_applied` / `full` /
`already_decided` are the world having moved (409, `_apply_refusal_status` in `views.py`);
`own_node` / `minor` / `not_manager` are about who is asking, not what changed (403); a malformed
request (a missing title, `wanted_count < 1`, a hand-set `fulfilled`) is 400.

**`public_needs(user)`** is the board's queryset: open needs on nodes the reader can view are
public, and a node's own staff also see the rest of that node's needs. There is no bulk "which
nodes can this user see" query in `config.nodes` (each node kind answers visibility differently,
and building one here would be exactly the re-derivation the seam exists to prevent), so this reads
every `Need` row once, bulk-resolves each row's node with one query per content type
(`_resolve_nodes`, never per row), and asks `config.nodes` per node. Every list this frontend calls
is bounded by construction (root `CLAUDE.md`) — a help-wanted board is not a list anybody expects to
page through.

**`can_manage(user, need)`** dispatches straight to `config.nodes.can_manage_node(user, need.node)`.
A need is not a thing its own creator keeps editing after handing it to the node; it is the node's
posting, so authority tracks the node's manager, not `Need.created_by` (which is kept only as a
"who posted this" byline).

## API

```
GET  /api/needs/                              the public board: ?kind=, ?remote=1, ?q=, ?node_kind=
GET  /api/needs/{id}/                          detail — 404s exactly where public_needs() would omit it
PATCH /api/needs/{id}/                         manager only: edit fields, cancel (status=cancelled), reopen (status=open)
GET/POST /api/nodes/{kind}/{id}/needs/         this app's own nested route; POST is manager-only
POST /api/needs/{id}/apply/       {message}    apply_block_reason first
POST /api/needs/{id}/withdraw/                 the caller's own application only
GET  /api/needs/{id}/applications/             manager only — 404 to everyone else, the roster shape
POST /api/need-applications/{id}/decide/  {decision: accept|decline}
```

All behind `feature_gate('needs')`. The node-nested list/create is **this app's own URL**
(`needs/urls.py`), not an `@action` on `courses`/`events`/`materials` — nothing in those apps moves
(MANAGEMENT-BRIEF.md §4 rule 1). Visibility is `NeedViewSet.get_queryset` = `rules.public_needs`, so
a stranger's `GET /api/needs/{id}/` on a need they cannot see 404s through DRF's own `get_object()`
(house rule 4) exactly the way the board already narrows for them; every mutating action then asks
`rules.can_manage` / `apply_block_reason` / `decide_block_reason` explicitly, because a queryset
filter never runs for an action that arrives with an id in the URL.

## `needs/work.py: work_items(user)`

Not imported anywhere on this branch, and imports nothing from `work/` either
(MANAGEMENT-BRIEF.md §4 rule 13) — the integrator registers `needs.work.work_items` in
`work/providers.py` at §5. Two kinds: `need_application` (my own pending applications) and
`need_decision` (one row per need I manage that has pending applications, carrying the count rather
than one row per applicant).

## Verify

`../.venv/bin/python3 manage.py test needs config`. Frontend: `lib/types/need.ts`,
`lib/services/needs.ts`, `/needs` (the board) and `/needs/[id]`, `NeedsPanel` at mount point C.
Browser: `frontend/e2e/needs.mjs`.

## Left open

- **Matching by profile skills** (`accounts.SkillEntry` exists) is not built — a need's
  `skill_level` is descriptive text on the posting, not matched against an applicant's own declared
  skills. The join is the obvious next step once somebody asks for it.
- **An accepted application does not put the applicant on the node's roster.** Whether "accept"
  should also offer course/event membership is named in `MANAGEMENT-BRIEF.md` §3.C as the
  integrator's call, not this step's; the seam is `rules.decide_block_reason` / the `decide` view
  action in `views.py`, both of which have nothing else standing in the way of adding it.
- **No people search** — applicants and managers already know each other by being on the same
  node; nothing here needed one.
- **No thread on a need.** `community.Comment`'s registry gains a `need` line, later, alongside the
  other three management apps that want one (MANAGEMENT-BRIEF.md §7).
- **No notification on a new application or a decision.** House rule 12 / MANAGEMENT-BRIEF.md rule
  12: a new notification type is a three-file change six branches would collide on; named here
  rather than built.
- **`NeedsPanel`'s manager half has no aggregate "N applications waiting" badge** across every need
  on the node — each need's own applications queue lives on its `/needs/{id}` page instead. Adding
  the badge would mean either an extra request per need in the panel or a new field on the list
  serializer; left for whoever needs the panel to say more before opening it.
