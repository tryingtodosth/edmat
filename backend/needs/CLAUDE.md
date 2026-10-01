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
PATCH|PUT /api/needs/{id}/                     manager only: edit fields, cancel (status=cancelled), reopen (status=open)
                                               — BOTH verbs: `UpdateModelMixin` binds `PUT → update` too, and overriding
                                                 only `partial_update` once left PUT running DRF's own, which asks the
                                                 queryset (visibility) and never `can_manage` (fixed §17BI.H)
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

---

# The supply side: `VolunteeringOffer` (2026-10-01)

Added by owner request ("make it possible to add /volunteering offers, in different languages"),
and placed in **this** app rather than a new one by the owner's own choice between three shapes.

`Need` is the demand side — a course, an event or a material saying what it needs.
`VolunteeringOffer` is the supply side — a person saying what they can do, attached to no node.

## Why it lives here

The shared vocabulary is the payoff. An offer reuses `NEED_KIND_CHOICES` and
`SKILL_LEVEL_CHOICES` verbatim, so "expertise, advanced" means one thing on both boards and a
future matcher has one vocabulary to join on rather than two that nearly agree.

It is deliberately **not** a `services.Service` with a `kind` column, which was the other
candidate: a Service carries a rate, a currency, a bookable calendar and a reviews table, every one
of which is wrong here. `FINANCES.md` governs both, but a volunteering offer should not have a
money field to leave empty — just as `Need.estimated_hours` is time, never a rate.

## Two language fields, on purpose

- **`language`** is what the offer is WRITTEN in. It is the platform's existing content axis, so
  `config/content_locale.apply_content_locale_filter(qs, params, 'language')` narrows the board and
  the hidden count rides back in `X-EdMat-Hidden-Languages`. Same field, same name, same job as
  `services.Service.language`.
- **`spoken_languages`** (a `JSONField` list) is what the volunteer can HELP in. That is a fact
  about the person, not the text, and it is what somebody searching usually means: an advert typed
  in Polish by somebody who also speaks Ukrainian is exactly the row a family looking for
  Ukrainian-speaking help needs to find. Normalised in `save()` — lower-cased, de-duplicated,
  capped at `MAX_SPOKEN_LANGUAGES` — so the admin and any importer get the same answer the API
  does; the serializer refuses more than the cap rather than truncating silently.

**`?speaks=` filters in Python, not SQL.** `JSONField.__contains` raises `NotSupportedError` on
SQLite (`backend/CLAUDE.md`'s list). The list is bounded by construction like every list here, so
walking it is honest; on PostgreSQL this could become one `contains`. The alternatives were a child
table for two columns, or `icontains` against the raw JSON, which matches a substring of a code as
happily as a code.

## Shapes

- **`status` is one field**: `open` → `paused` ("not right now, ask me later") → `closed`. Never a
  pair of booleans.
- **`public_offers(user)`** is the one visibility rule, read by the list AND by `get_object()`, so
  a stranger reaching for a paused offer gets 404 rather than 403 (house rule 4). Staff see
  everything, because a reported offer must be readable by whoever decides the report.
- **Seeing is not editing.** `public_offers` shows staff every row, and staff are not the author —
  so writes ask `_mine_or_404()` explicitly. `update` covers **PATCH and PUT** through one method,
  the lesson `NeedViewSet.update` already records.
- **DELETE really deletes**, unlike most things here (house rule 12 asks for a tombstone where a
  thread or a link would break; nothing links to an offer, there are no applications and no
  messages anchored to it, so there is nothing to orphan and nothing worth keeping).
- **A minor may not publish one** (`rules.MINOR`, 403) — the same refusal a tutoring listing makes
  and for the same reason: a public posting inviting strangers to make contact. They can still
  volunteer at an event, where an organiser is accountable for them.
- **The description is sanitized on write**, because it renders as content (`MathContent` on both
  the card and the detail page): Markdown, literal LaTeX, links and an `<img data-chem>`.

## Its own feature flag

`volunteering`, not `needs`. Two boards, two questions, and the owner may want one without the
other. A three-file change as always — `moderation` choices + migration 0046,
`frontend/src/lib/types/featureFlag.ts`, `frontend/src/lib/utils/labels.ts`.

## API

```
GET    /api/volunteering-offers/          the board: ?kind= ?remote=1 ?q= ?speaks= ?mine=true
POST   /api/volunteering-offers/          signed-in adults
GET    /api/volunteering-offers/{id}/     404 where public_offers() would omit it
PATCH|PUT|DELETE /api/volunteering-offers/{id}/   the volunteer's own, else 404
```

Frontend: `lib/types/need.ts`, `lib/services/needs.ts` (same file as the demand side — same app,
same vocabulary), `components/needs/OfferForm.svelte`, `/volunteering`, `/volunteering/new`,
`/volunteering/mine`, `/volunteering/[id]`. **`/volunteering/hours` is NOT this feature** — it is
the shifts rota's own page, behind `shifts`, which moved there when the board took the address.

## Left open

- **No way to answer an offer except to message the volunteer.** The demand side has applications
  and a decision; there is nothing here to apply TO. A record-keeping "ask this person" flow is a
  real feature and a bigger one than this step.
- **No matching between the two boards**, which is the obvious next step now that they share a
  vocabulary — the same shape as the profile-skills join already named above.
- **No Polish address** (`/wolontariat`) the way `/korki` and `/materialy` have one. Not asked for;
  the neutral-English rule is the default.
- **No thread, no reports, no activity row** on an offer — `community`'s, `moderation`'s and
  `activity`'s registries are each a deliberate allowlist, and widening one is its own decision.
