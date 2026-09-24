# organizations — bodies, their rosters, and what they stand behind

Management step A (`MANAGEMENT-BRIEF.md` §3.A), built on `mgmt/a-organizations`. Three models, one
rule module, one flag: `organizations`.

## Why this is an app and not a field on a course or an event

A student circle outlives every course its members teach and every event it runs; a faculty stands
behind forty of each. `Course.organization` would model the one case something is run once by one
body and nothing about the case a body runs things for twenty years — and it would put the
organisation's own roster nowhere.

**The link IS the relationship** (the `venues.RoomBooking` shape): `OrganizationLink` is a row
pointing at a node through `config.nodes`, not a nullable FK on the node. That is what keeps every
other app's schema untouched (`MANAGEMENT-BRIEF.md` §4 rule 1) and what lets two organisations stand
behind one event — a faculty that hosts it and a student circle that runs it — which one FK cannot
express.

## The decision that shapes everything else: no cascade

This is the one thing taken from 2donet (`/Projects/2donet` §2.30) and then deliberately narrowed.
2donet cascades permissions from an organisation down through teams to projects. **EdMat does not.**
Every node here already has its own roster and its own rule module (`courses.Course.can_curate`,
`events.Event.can_organise`, `coauthoring.access.can_manage`), so a cascade would be a *second*
answer to "who may edit this course", and two answers to one question is how two surfaces start
disagreeing.

So a membership grants **nothing** on the things the organisation runs. `OrganizationLink` is
informational — a badge and a list. `NodeSeamTests.test_the_seam_does_not_grant_anything_on_what_the_body_runs`
is the proof, and the organisation page says it in words to the reader as well.

## The one shared-file edit in the whole management layer

`config/nodes.py`'s `NODE_KINDS` gained its `organization` line in this step (§4 rule 3 — the only
edit any of the six steps makes to a shared backend file). The four functions it dispatches to live
at the bottom of `access.py`:

    can_view_organization   is_organization_member   can_manage_organization   organization_member_users

They are thin wrappers over `can_view` / `is_member` / `can_manage` on purpose: the node seam asks a
fixed set of questions of every kind, and this app's own vocabulary is what those questions mean
here. **An organisation is therefore itself a node**, which is what lets a student circle keep its
own tasks, needs, plans and polls without any of the other five steps knowing this app exists.

`member` and `staff` are the same set here — an organisation's roster has no reader tier — and
`config/nodes.py` answers `is_node_member` from `is_node_staff` for that reason.

## Invariants

- **At least one owner at all times.** Removing *or demoting* the last one is `409 last_owner`, and
  the count is **recounted** every time (house rule 5), never tracked. A rule that only guarded
  `DELETE` would be walked around by a `PATCH`, so `remove_block_reason` takes a `wanted_role` and
  answers the same word for both. The same reasoning `VenueStaff` gives for `last_administrator`:
  an organisation nobody can administer is a page nobody can ever correct again, and there is no
  self-service "claim this organisation" flow to recover it with.
- **Leaving is not being removed**, but it still cannot strand the body. Anybody may take themselves
  off a roster; the last owner still gets `last_owner`, because "I left and now nobody runs it" is
  the state the invariant exists to prevent however it is reached.
- **Only an owner rearranges the owners.** An administrator runs the roster and the links and may
  not remove or demote an owner (`403 not_org_owner`); only an owner dissolves the body.
- **A link needs BOTH ends.** `can_manage` on the organisation *and* `can_manage_node` on the target
  — a badge saying "run by the Faculty of Physics" is a claim about two parties. **Undoing it takes
  one**: either end may delete the link. Agreeing takes two, withdrawing takes one.
- **An organisation is not a linkable target.** `access.LINKABLE_KINDS` is `config.nodes.NODE_KINDS`
  minus `organization`: a body inside a body is a hierarchy this step does not model, and a
  self-referential graph with no cycle rule is worse than no graph.
- **Nothing is hard-deleted.** `is_active=False` is the tombstone (house rule 12): the page stays for
  its own members, every badge comes off every public page, and the row still resolves for anything
  that names it.
- **A minor may not found one** (`accounts/minors.py`, `403 minor`). Founding means standing publicly
  behind a body and being the person a stranger writes to about it — the same reasoning that closes
  event hosting and tutoring listings to an under-16. A minor may perfectly well be *on* a roster.

## Who may do what

`access.py` is the only place that answers this, and every pk-addressed action asks it explicitly —
a queryset filter never runs for an id in a URL (house rule 4).

| | owner | admin | member | anyone |
|---|---|---|---|---|
| read an active body, its roster, its links | ✓ | ✓ | ✓ | ✓ |
| read a dissolved body | ✓ | ✓ | ✓ | — (404) |
| edit the details | ✓ | ✓ | — | — |
| add / remove a member, change a non-owner's role | ✓ | ✓ | — | — |
| remove or demote an **owner** | ✓ | — | — | — |
| link / unlink (needs the node too) | ✓ | ✓ | — | — |
| leave | ✓ (unless last owner) | ✓ | ✓ | — |
| dissolve | ✓ | — | — | — |

**Platform `is_staff` is deliberately NOT a manager here.** `venues.access.is_venue_admin` lets staff
in because that is the only way a building gets its first administrator; an organisation is founded
by the person who runs it, who is its first owner in the same transaction, so there is no bootstrap
that needs a back door. Staff do see every row in `visible_organizations` (so a moderator can find a
body somebody reported after it went quiet), and `feature_gate`'s own `is_staff` bypass is about the
kill switch and is unaffected.

## Refusals are words, not booleans (house rule 6)

`minor` `last_owner` `not_org_manager` `not_org_owner` `not_node_manager` `not_linkable`
`already_linked` `already_member` `no_such_user`.

`last_owner`, `already_linked` and `already_member` are **409** (the world moved — somebody got there
first, or the roster is not what the caller thought); `not_linkable` and `no_such_user` are **400**
(the request was wrong when it was written); the rest are **403**. A node the caller may not see is
**404** before any of this is asked. The frontend has a line for each in `ORGANIZATION_BLOCK_LABELS`
(`frontend/src/lib/utils/labels.ts`).

## The API

    GET|POST   /api/organizations/            ?q= ?kind= ?mine=1 ?slug=
    GET        /api/organizations/managed/    the bodies you may act in — the link picker's feed
    GET|PATCH|DELETE /api/organizations/{id}/ DELETE = is_active=False
    GET|POST   /api/organizations/{id}/members/
    PATCH|DELETE /api/organization-members/{id}/
    GET|POST   /api/organizations/{id}/links/
    DELETE     /api/organization-links/{id}/
    GET        /api/nodes/{kind}/{id}/organizations/   the badges on one course/event/material

`managed/` is a separate endpoint from `?mine=1` on purpose: `?mine=1` answers "where am I listed"
and `managed/` answers "where may I act". A picker fed by the first would offer options the API then
refuses, which is house rule 6 from the other side — do not offer a refusal.

Members are added by **account id**, because there is no people search on this platform (root
`CLAUDE.md`, known gaps). The form says so rather than drawing a search box that cannot work.

## The link list is filtered by the target's own visibility

`_readable_links` drops any link whose target this reader cannot see. A link is a claim about two
things, so it is only as public as the *less* public of them — an organisation that runs a draft
event must not advertise the draft event's title on its own public page. That is the filter half;
`link_block_reason` is the authority half (house rule 4 wants both).

## The kill switch

`feature_gate('organizations')` on every viewset and on `NodeOrganizationsView`, with the usual
`is_staff` bypass. Off: the whole `/api/organizations/`, `/api/organization-members/`,
`/api/organization-links/` surface and the node-hung list 403 a non-staff caller; `/api/nodes/{kind}/
{id}/` itself keeps working untouched (asserted), and the frontend's two header entries, the
directory and the panel all disappear. The panel checks the flag **itself** rather than being wrapped
in `FeatureGate` — that component renders an "unavailable" notice, which is right for a route and
wrong for a panel sitting mid-page on somebody else's course (the `VenuePanel` precedent, found by
looking at an e2e screenshot).

## The work provider

`work.py: work_items(user)` in the `MANAGEMENT-BRIEF.md` §3.F shape; the integrator registers it in
`work/providers.py` (§5) and this app never imports `work/`.

It reports **organisations you are the only owner of that other people are relying on** — one owner,
at least one other person on the roster. That is a real single point of failure with an action that
clears it (promote a second owner), and it is narrowed so it is not permanent noise: a one-person
body produces no row, because there is nobody it could fail. Urgency 1, `due_at` honestly `None`.

There is no queue here — no join requests, no invitations (both out of scope in §3.A) — so this is
the only honest row this app has.

## Verify

`../.venv/bin/python3 manage.py test organizations config` from `backend/` (refusal-weighted; the
`config` half is the node seam this step edited). E2E: `frontend/e2e/organizations.mjs`.

## Left open

- **No join requests and no invitations.** A body is joined by somebody already in it adding you by
  account id, full stop. Both were named out of scope in `MANAGEMENT-BRIEF.md` §3.A and are the
  obvious next step; `coauthoring`'s invite/join-request pair is the shape to copy.
- **No notification** when somebody is added to a roster, given a role or has a link made — §4 rule
  12 forbids a new notification type while six branches are open. `notifications.notify()` is the
  right home for all three.
- **No verified-organisation badge** and no "claim this university" flow, so anybody may found a body
  called anything. `moderation.Report` already accepts a target registry entry if impersonation turns
  out to matter.
- **Membership grants nothing**, by design (above) — but the integrator may want an organisation's
  managers to be *offered* a place on a linked node's roster. That is a decision, not an oversight.
- **A link carries no note.** "Supports" cannot say how.
- **No `organization` target in `community/targets.py`**, so a body has no discussion thread; §7 of
  the brief lists that as a deliberate later step for all six apps at once.
- **Members are added by account id** (no people search — root `CLAUDE.md`, known gaps).
