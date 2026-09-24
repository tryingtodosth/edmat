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

- `visible_polls(user, node)` — polls the user may see (visibility is a queryset filter; drafts
  visible to managers only)
- `is_eligible(user, poll)` — whether they may vote (based on `eligibility` + node membership)
- `vote_block_reason(user, poll, option_ids)` — why they cannot vote, or None
- `can_see_results(user, poll)` — whether they may see results (managers always; others when closed)
- `open_block_reason(poll)` — why it cannot be opened (fewer than 2 options, already open)
- `close_block_reason(poll)` — why it cannot be closed (already closed)

Every refusal is a word: `not_open`, `not_eligible`, `already_voted`, `too_many_choices`,
`unknown_option`, `no_options`, `already_open`, `already_closed`, `not_draft`. All have a
sentence in `frontend/src/lib/utils/labels.ts`.

## API (all behind `feature_gate('decisions')`)

- `GET|POST /api/nodes/<kind>/<pk>/polls/` — list/create on a node (NodePollsView)
- `GET|PATCH|DELETE /api/polls/{id}/` — single poll (PollViewSet)
  - PATCH/DELETE → `409 not_draft` if not draft
- `POST /api/polls/{id}/options/` — add option to draft
- `DELETE /api/poll-options/{id}/` — delete option from draft
- `POST /api/polls/{id}/open/` — open for voting
- `POST /api/polls/{id}/close/ {decision_note}` — close and record decision
- `POST /api/polls/{id}/vote/ {options: [ids]}` — cast a vote
- `GET /api/polls/{id}/results/` — results (ballots only for managers)

Visibility: a stranger gets 404 on what they cannot see (house rule 4). Every refusal is 409
when the world moved (already voted, poll closed) or 400 when the request is wrong (unknown
option). Authority is checked object-level because a queryset filter never runs for an action
with an id in the URL.

## Frontend integration

- `lib/types/poll.ts` — TypeScript shape
- `lib/services/polls.ts` — API calls
- `lib/components/decisions/PollsPanel.svelte` — panel on event/course/material pages
- `/polls/[id]` — full-page detail view
- i18n: `polls_*` prefix in both `messages/en.json` and `messages/pl.json`
- `labels.ts`: enum maps for modes, statuses, eligibilities
- `frontend/e2e/decisions.mjs` — browser test

## work.py integration

`work_items(user)` returns open polls the user is eligible for and has not voted in, due soonest.
Each item is a dict: `kind: 'poll'`, `title`, `url: '/polls/{id}'`, `due_at`, `status: 'open'`,
`urgency: 0|1|2|3`, `node`.

## Verify

`manage.py test decisions config` (refusals first). e2e against real servers with a screenshot.
Before e2e, clear the throttle cache: `rm -rf backend/cachedata/*`.

## Left open

- No notification when a poll opens
- Quorum rules or minimum vote counts
- Ranked or weighted voting
- Reminders before closing
- Anonymous results do not expose vote distribution without hiding the question itself,
  so results on an anonymous poll are honest (the manager cannot cheat) but less fun
  (nobody sees who won unless the manager decides to tell them in the decision note)
