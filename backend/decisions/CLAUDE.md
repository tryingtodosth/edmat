# decisions — management step (MANAGEMENT-BRIEF.md §3.E)

Polls are formal decisions with an eligibility rule, open/close, and a written decision when closed.

## The shape

**`Poll`** — the question, with lifecycle `draft` → `open` → `closed`. Fields:

- `content_type` + `object_id`: the node (course, event, or material project) it belongs to, resolved through `config.nodes`
- `question`, `description` (sanitized with `config/sanitize.py`)
- `mode`: `single` (one choice) or `multiple` (many choices)
- `anonymous`: whether `Ballot` rows carry no person identifier
- `eligibility`: `staff` (staff only) or `members` (staff + enrolled/attending/on project)
- `opens_at`, `closes_at`: nullable timestamps to schedule the poll
- `status`: `draft` → `open` → `closed`
- `decision_note`: the manager's written decision when closed
- `closed_by`, `closed_at`: who closed it and when
- `created_by`, `created_at`: who created it and when

**`PollOption`** — one answer. Fields: `poll`, `text`, `order`.

**`Ballot`** — a record that a person took part. One per (poll, user). For anonymous polls,
there is no way to see WHO voted for WHAT — the person is known, the choice is not (house
rule 9: public by construction). For non-anonymous polls, a Ballot is the match between
a person and their Vote rows.

**`Vote`** — a vote for an option. Fields: `poll`, `option`, `ballot` (NULL for anonymous
polls). Results are **recounted, never stored** (house rule 5): a vote count is
`Vote.objects.filter(option_id=...).count()`.

## Rules (in `rules.py`)

- `poll_node(poll)` — the node a poll hangs off, from its `content_type`/`object_id`. **Use this,
  never `resolve_node(poll.content_type.app_label, …)`** — `app_label` is the plural Django app
  label (`'courses'`), not the short seam word `resolve_node` takes (`'course'`); that exact
  mismatch shipped as a real bug (every poll silently `not_eligible`, `can_see_results` always
  `False`) until a finishing pass on 2026-09-24 fixed it by mapping through
  `config.nodes.NODE_KIND_OF_MODEL` instead.
- `visible_polls(user, node)` — polls the user may see (visibility is a queryset filter): drafts to
  managers only, open and closed ones to **the people they were put to** — anyone eligible, plus
  the node's staff. Checking only the WORD `eligibility='members'` and not whether this reader IS
  one showed every members poll on a public course to every passer-by, anonymous included, until
  the permission matrix found it (§17BI.H)
- `can_view_poll(user, poll)` — the same rule for a poll addressed by id (house rule 4's other
  half): asked by `retrieve` and by `results`. `vote` deliberately does NOT — it answers the
  refusal word (`not_eligible`, `not_open`) rather than a 404, because somebody who was shown a
  ballot and lost their place needs the sentence
- `is_eligible(user, poll)` — whether they may vote (based on `eligibility` + node membership)
- `vote_block_reason(user, poll, option_ids)` — why they cannot vote, or None
- `can_see_results(user, poll)` — whether they may see results (managers always; others when closed)
- `eligible_count(poll, node)` — a real recount (house rule 5) of who *could* vote: staff via the
  seam's `node_staff_users` for `eligibility='staff'`; staff plus active enrollees/attendees,
  read directly off the course/event (the seam has no member-*enumeration* function, only the
  membership *test* `is_node_member`), for `'members'`
- `open_block_reason(poll)` — why it cannot be opened (fewer than 2 options, already open)
- `close_block_reason(poll)` — why it cannot be closed (already closed)

Every refusal is a word: `not_open`, `not_eligible`, `already_voted`, `too_many_choices`,
`unknown_option`, `no_options`, `already_open`, `already_closed`, `not_draft`. All have a
sentence in `frontend/src/lib/utils/labels.ts` (`POLL_REFUSAL_LABELS`).

## API (all behind `feature_gate('decisions')`)

- `GET|POST /api/nodes/<kind>/<pk>/polls/` — list/create on a node (NodePollsView)
- `GET|PATCH|DELETE /api/polls/{id}/` — single poll (PollViewSet)
  - PATCH/DELETE → `409 not_draft` if not draft
- `POST /api/polls/{id}/options/` — add option to draft. `order` is optional and **appends** when
  omitted: `(poll, order)` is unique and the model default is 0, so a body of just `{"text": …}`
  raised IntegrityError — a 500 — on the second option until §17BI.H. A caller that names an
  order still gets exactly that order.
- `DELETE /api/poll-options/{id}/` — delete option from draft
- `POST /api/polls/{id}/open/` — open for voting
- `POST /api/polls/{id}/close/ {decision_note}` — close and record decision
- `POST /api/polls/{id}/vote/ {options: [ids]}` — cast a vote
- `GET /api/polls/{id}/results/` — results (ballots only for managers)

Visibility: a stranger gets 404 on what they cannot see (house rule 4). Every refusal is 409
when the world moved (already voted, poll closed) or 400 when the request is wrong (unknown
option). Authority is checked object-level because a queryset filter never runs for an action
with an id in the URL.

`PollSerializer` never embeds a live vote count on its `options` — only
`GET /api/polls/{id}/results/` does, gated by `can_see_results`, so an open poll's running tally
is never visible to anyone it should be hidden from (§3.E: "results hidden until closed for
non-managers"). It does carry `has_voted` (needs `context={'request': request}`), so a reload does
not re-offer the vote form to someone who already cast a ballot.

## Frontend integration

- `lib/types/poll.ts` — TypeScript shape, including `PollRefusalReason`
- `lib/services/polls.ts` — API calls
- `lib/components/decisions/PollsPanel.svelte` — panel on event/course/material pages
  (`data-polls-panel`/`data-poll-id`/`data-poll-status` for e2e targeting)
- `/polls/[id]` — full-page detail view
- i18n: `polls_*` prefix in both `messages/en.json` and `messages/pl.json` (34 keys)
- `labels.ts`: `POLL_MODES`/`POLL_STATUSES`/`POLL_ELIGIBILITIES`/`POLL_REFUSAL_LABELS` — the enum
  TYPES live in `types/poll.ts` and are imported here, not redefined (they were duplicated once;
  don't reintroduce that)
- `frontend/e2e/polls.mjs` — browser test

## work.py integration

`work_items(user)` returns open polls the user is eligible for and has not voted in, due soonest.
Each item is a dict: `kind: 'poll'`, `title`, `url: '/polls/{id}'`, `due_at`, `status: 'open'`,
`urgency: 0|1|2|3`, `node`.

## Verify

`manage.py test decisions config` (refusals first). e2e against real servers with a screenshot.
Before e2e: clear the throttle cache (`rm -rf backend/cachedata/*`) AND run `manage.py migrate` —
a model added this session is a table that exists in the branch but not yet in a worktree's own
dev `db.sqlite3`, which 500s the one endpoint that touches it while everything else keeps working
(e2e/CLAUDE.md trap 23; this is exactly how the first `polls.mjs` run failed).

## Left open

- No notification when a poll opens
- Quorum rules or minimum vote counts
- Ranked or weighted voting
- Reminders before closing
- Anonymous results do not expose vote distribution without hiding the question itself,
  so results on an anonymous poll are honest (the manager cannot cheat) but less fun
  (nobody sees who won unless the manager decides to tell them in the decision note)
- A poll is a `GenericForeignKey`; deleting its node does not cascade-delete it, and a poll past
  `draft` cannot be deleted through the API either (`409 not_draft` — a decision is a record, not
  a discardable draft). A hard-deleted node leaves an orphaned, invisible `Poll` behind: inert
  (`poll_node` returns `None`, every endpoint 404s), never reclaimed.
- `eligible_count` reads `enrollments`/`attendances` directly rather than through the seam (no
  member-enumeration function exists there) — a new node kind needs a new branch by hand.
- The panel only shows results once a poll is `closed`, matching §3.E's literal description; a
  manager wanting to watch a still-open poll's running numbers has to call
  `GET /api/polls/{id}/results/` directly.
- No edit/delete UI for a draft poll or its options — the endpoints exist, but §3.E's frontend
  list only asks for a create form.
- A caller that names an `order` an option already has still gets a 500 (`IntegrityError` on
  `(poll, order)`). Only the omitted-order case was fixed; refusing a collision with a word
  would be a new refusal vocabulary nothing asks for yet.
