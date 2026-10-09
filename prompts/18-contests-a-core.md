# A. Contests — the app, its rules, and every page of it — brief for one agent

| | |
|---|---|
| **Model** | Opus (the owner's standing decision: steps run on Opus; you may spawn ONE Haiku subagent for a bounded side task and must re-run anything it reports) |
| **Branch** | `contest/a-core` |
| **Worktree** | `/Projects/edmat/.claude/worktrees/contest-a-core/` |
| **Ports** | API `8171`, Vite `5271` |
| **Prep commit** | `75a6fea` on `contests/prep` (branched from `ux/colour-pass` at `b6aa58a`) |
| **Boards** | `/Projects/edmat-boards/` — your `doing.md` entry is already written |
| **Node 24** | `export PATH=/home/bob/.cache/edmat-tools/node24/bin:$PATH` |
| **Sibling** | step B (`contest/b-personalise`) builds at the same time; it owns `contests/presets.py` and `contests/personalize.py` and every file outside `contests/` and `routes/contests/**`. You never edit those; it never edits yours. |

## Read first
`prompts/README.md` §4 (the always-list) and §5 (the rules), then **`CONTESTS-BRIEF.md` whole**
— §1 is the law turned into decisions, §2 what already exists, §3.A is your step in full, §4 the
rules for two branches, §6 the defaults. `CONTESTS-LAW.md` is the research behind §1; read §1, §2,
§3, §4, §12 of it so that the copy you write is right. Then `backend/contests/` as the prep left it
(`models.py`, `access.py`, `presets.py`, the three stubs, `tests.py`), `backend/CLAUDE.md`,
`frontend/CLAUDE.md`, `frontend/e2e/CLAUDE.md`, and — as the closest existing shapes —
`backend/events/` (host, staff, registration lifecycle, `can_organise`), `backend/courses/`
(completion certificates), `backend/needs/rules.py` (the refusal-word style), the `/events/[id]`,
`/events/new` and `/courses/[id]/certificate/[completionId]` routes, and `lib/components/task/TasksPanel.svelte`
(a node panel with a picker fed by `getNodeStaff`).

## The task
Build the contest: the models beyond the prep, the rule module, the API, and **every page under
`/contests`** as `CONTESTS-BRIEF.md` §3.A lists them — the hub, the four-screen wizard that
**prefills roles from the people the founder already works with**, the contest page with the
organiser above the fold and the status strip, the regulamin editor and reader, the stage page
with problems drawn from the exercise corpus and an answer box, the jury's scoring matrix, the
published results with the complaints window, the manage page, the certificate, the header's
three entries, the compliance panel, the demo seed on the dev accounts, and the browser script.
The fourteen interface tasks in §3.A are the deliverable list; each one is a page or component
you ship.

## What "finished" means
- [ ] `contests` migrations `0002+` for every model in §3.A; `makemigrations --check` clean.
- [ ] `contests/rules.py` with every refusal word in §3.A, each with a test that triggers it
      (refusals first, then the happy path); `advance()` is the only writer of next-stage
      eligibility; scores are recounted, never stored; `ContestResult` rows exist only between
      `publish_results` and `unpublish_results`.
- [ ] `access._registered` replaced: an accepted registration is a member; a draft still 404s a
      stranger; a registered participant sees the contest when it is private-but-announced? **No**
      — visibility is the contest's own two axes; a participant of a private contest sees it because
      they are a member. Test that.
- [ ] A stage's problems are 404 to a non-staff reader before `opens_at`, and the exercise's
      hints and solutions are not sent in the stage payload (statement only).
- [ ] `announce` refuses `claim_deadline_missing` when `has_prize`, `jury_missing` below
      `preset.jury_min`, `chance_element` on *losowanie* in a stage description; a `challenge`
      announces with no prize block at all.
- [ ] A minor registers only with `guardian_consent=true` and a guardian's name, on a preset
      with `allows_minors`; `minor` otherwise; `publish_name` is its own PATCH and defaults false.
- [ ] `ContestViewSet.create` asks `creation_block_reason(user, 'contest')`, validates
      `preset_key` against `presets.visible_to(user)` (a non-staff founder cannot pick
      `kuratorium`), calls `personalize.apply_preset(contest, request.user)` and returns its report
      under `personalisation`.
- [ ] `work.py: work_items` and `record.py: placements_for` written against your rows, in the
      §3.F shape of `MANAGEMENT-BRIEF.md` (kinds `contest_registration`, `contest_judging`,
      `contest_complaint`, `contest_stage`) and the brief's `placements_for` shape; NOT registered
      (B does that).
- [ ] `compliance.py: report(contest)` evaluating `presets.checklist_for` against the rows, every
      item carrying its `LAW` keys; `GET /api/contests/{id}/compliance/` for staff.
- [ ] `people.py: suggested_people(user)` with the `via` line; `GET /api/contests/people-suggestions/`.
- [ ] Every route in §3.A items 1–9, every component in item 11, the header's three marker
      appends (item 10) with "New contest" wrapped in `creationStore.allows('contest')` and
      `!isMinor` like "New event".
- [ ] The three markers on `/contests/[id]` for the integrator: `<!-- contests: compliance (A) -->`
      (yours, mounted), `<!-- contests: translations (integration) -->`, `<!-- contests: discussion (integration) -->`.
- [ ] `seed_contest_demo` (item 13), idempotent, run twice on your copy of the dev database.
- [ ] `e2e/contests.mjs` (item 14) green on your ports with screenshots looked at.
- [ ] `contests_*` keys in both catalogues, identical sets; `CONTEST_BLOCK_LABELS` in `labels.ts`
      under your own comment, one sentence per refusal word.
- [ ] `backend/contests/CLAUDE.md`; `HISTORY.md` `## 17CE.A`; one paragraph in `test.md`; the
      board entry moved to `done.md` with the numbers.

## Context — what you need and where it is
| Need | Where | Why |
|---|---|---|
| The law as decisions | `CONTESTS-BRIEF.md` §1 | every refusal word above comes from a row there |
| The citations and their markers | `contests/presets.py: LAW`, `CONTESTS-LAW.md` | the compliance panel shows the marker; never present `unverified` as settled |
| The ten presets, stages, roles, checklist | `contests/presets.py` (read-only for you) | the wizard's screens are this data drawn |
| Who may see / run a contest | `contests/access.py`, `config/nodes.py` | ask, never re-implement |
| The founding gate | `config/creation.py`, `events/views.py: create` | the one call and the 403 shape |
| An event as a stage's venue | `events/models.py`, `/events/new` | an `onsite` stage has `event` FK; venues, documents, rota, cloakroom come with it |
| Exercises for problems | `exercises/` serializers, `/search`, `renderContent.ts` | statement only, rendered like `/exercises/[id]` |
| Attachments on an answer | `attachments/`, `lib/services/attachments.ts` | `comment`-style target? No — attach to the contest node with tier `staff` and reference the row from the answer |
| Certificates | `courses/` completion certificate route and component | same print-by-browser shape, organiser as issuer |
| Suggested people | `courses.CourseStaff`, `events.EventStaff` + host, `organizations.OrganizationMember`, `coauthoring.ProjectMember` | the four rosters `suggested_people` unions |
| Minors | `accounts/minors.py` | the line and the free-text rule |
| Dev accounts for the seed | `u-kasia`(staff) `u-michal` `u-ola` `u-bartek` `u-julia` `demo-ania` `demo-piotr` `demo-zofia` `demo-jakub` `student1` | §3.A item 13 |
| Browser traps | `frontend/e2e/CLAUDE.md`, an existing script (`e2e/attachments.mjs`) | the login throttle lives in `backend/cachedata/` |

## Shapes fixed in advance
- The model names, fields and refusal words of `CONTESTS-BRIEF.md` §3.A — B's labels and the
  integrator's matrix rows are written against them.
- `personalize.apply_preset(contest, actor) -> dict` — call it, show `created` and `skipped`.
- `work.work_items(user) -> list[dict]` with `ITEM_KEYS`; `record.placements_for(user) ->
  [{contest_id, title, result_title, published_at}]`.
- `GET /api/contest-presets/` answers `{'law': {key: {citation, marker}}, 'presets': [...]}`.
- The three markers on `/contests/[id]`, spelled exactly as above.
- i18n prefix `contests_`; `labels.ts` only `CONTEST_BLOCK_LABELS`.

## Left open, by design
Notifications (four, named); teams beyond a name; community voting; people search; a DPA
template; proctoring beyond a role. Say each on the board and in `HISTORY.md`.

## Verify
```bash
W=/Projects/edmat/.claude/worktrees/contest-a-core
export PATH=/home/bob/.cache/edmat-tools/node24/bin:$PATH
cd $W/backend && ../.venv/bin/python3 manage.py test contests config --parallel 4
../.venv/bin/python3 manage.py check && ../.venv/bin/python3 manage.py makemigrations --check --dry-run
../.venv/bin/python3 testing/check_databases_declared.py
../.venv/bin/python3 manage.py seed_contest_demo && ../.venv/bin/python3 manage.py seed_contest_demo   # twice
cd $W/frontend && npm run check && npx eslint . && npm run build
# servers on YOUR ports, then:
rm -rf $W/backend/cachedata/*
DJANGO_CORS_ALLOWED_ORIGINS=http://localhost:5271,http://127.0.0.1:5271 ../.venv/bin/python3 ../backend/manage.py runserver 127.0.0.1:8171 &
npm run dev -- --port 5271 --strictPort &
node e2e/contests.mjs
```
Numbers in the board entry. Look at the screenshots.
