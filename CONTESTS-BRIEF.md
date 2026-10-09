# Contests (*konkursy*) — the design, the law, and the two parallel steps

Written 2026-10-09 by the orchestrating session (Fable 5.1) from the owner's ask of that afternoon:
*"add contests. personalize all current modules to this use case. each subagent can have 1 haiku.
research law for konkursy in poland and add presets with making it possible by prefilling with
current users"* — and the interface to be built by an Opus agent with the interface tasks spelled
out. This note is what lets two branches merge. `CONTESTS-LAW.md` beside it is the research
(sourced, with every claim marked verified / secondary / unverified / disputed); `prompts/18-contests-a-core.md`
and `prompts/19-contests-b-personalise.md` are the two agents' briefs; `prompts/README.md` §4–5
are the standing rules every brief inherits.

Status: **§2 (the prep: the flag, the app skeleton, the node kind, the markers, the presets) landed
as the prep commit named in each brief's header. Steps A and B are on the shared boards.**
`HISTORY.md` §17CE is where each step records what it built.

---

## 0. Where we stand, and why this is a new app

EdMat has three things people run together: a **course** (taught over weeks, a roster, lessons), an
**event** (one happening, people turn up), and a **material project** (people co-write a thing). It
has a management layer that hangs **tasks, needs, plans, polls, goals and attachments** off any of
them through one seam (`config/nodes.py`), a conference layer that hangs **venues, documents,
shifts and a cloakroom** off an event, a learning cycle (flashcards, a learning record,
certificates, school mode), bilingual management text, discussions under any board row, and an
"AI-assisted" mark.

A **contest** has one property none of them has: **the participants are judged, and the judging
produces a ranking** — laureate, finalist, distinction — that outlives the contest and that Polish
law attaches real consequences to. The moment a prize is promised, the contest is a
*przyrzeczenie publiczne* (Kodeks cywilny art. 919–921): it needs a deadline within which the prize
may be claimed or it is *bezskuteczne*; chance may not decide any stage or it is a lottery needing
a permit (with penalties that stack); the prize is taxed at 10% unless an exemption applies and
somebody is the *płatnik*; a minor needs a guardian's consent; publishing a winner's name is its
own consent; the organiser is the data controller and EdMat is a processor. A course has no jury.
An event has no ranking. So `contests` is its own app, deliberately small in what it owns, and it
gets everything it shares with the others — a roster, a venue and a rota for its final, documents,
tasks, a plan, a goal, needs, polls, attachments, a practice deck, a discussion, a bilingual
description, an organisation standing behind it — **by being a node**, not by copying any of it.

**"Personalise all current modules to this use case"** therefore means two things, and they are the
two steps:

- **A — the contest itself and its interface**: the app's models beyond the prep, its rule module,
  its API, every route under `/contests`, the preset wizard that prefills from the people the
  founder already works with, the stage pages with problems drawn from the exercise corpus, the
  jury's scoring, published results, complaints, the regulamin, the compliance panel, and the demo
  seed with the dev accounts.
- **B — every other module, made contest-aware**: the preset turned into rows on the contest node
  (a plan with the timeline, a goal whose criteria are the definition of done, the legal checklist
  as tasks, "jury member wanted" as needs, the jury's confirmation as a poll); the registries a
  contest must join (comments, reports, discussions, galleries, translations, flashcard placements,
  the activity feed, the work dashboard, the learning record); `/about/contests`; the manual
  chapter; `LEGAL.md`; the labels.

## 1. The law, reconciled into design decisions

From `CONTESTS-LAW.md`. Each of these is a decision the owner can overturn; none is advice.

| Decision | Why (CONTESTS-LAW.md) | Where it lives |
|---|---|---|
| **The default preset promises no prize.** Adding a prize is a deliberate step that unlocks obligations. | §13 (g): no prize ⇒ no przyrzeczenie publiczne, no gambling exposure, no PIT, no płatnik | `presets.py: challenge`; A's wizard |
| **A draw is structurally impossible.** No `draw` advancement, no tie-break by lot, and a stage whose description says *losowanie* is refused `400 chance_element`. | §2: u.g.h. art. 2; art. 89 + KKS art. 108 stack | `presets.ADVANCEMENTS`; A's `rules.py` |
| **The claim deadline is required the moment a prize exists** (`prize_claim_deadline` non-null when `has_prize`), and the contest cannot be announced without it: `409 claim_deadline_missing`. | §1: KC art. 921 §1 — bezskuteczność | A's model + `announce_block_reason` |
| **A jury is required** (≥ `preset.jury_min` staff with role `jury` or the organiser), three recommended. | §1: KC art. 921 §2; §2 | A's `announce_block_reason: jury_missing` |
| **Licence presets only, never a transfer checkbox.** `none` (author keeps all; display on EdMat), `non_exclusive` (fields of exploitation enumerated). A transfer is a paper annex and the UI says so. | §6: pr.aut. art. 53 vs KC art. 921 §3 — disputed | A's `entry_licence` choices |
| **Publishing a winner's full name is a separate, revocable consent**; the public list defaults to initials (or opt-in full names for university presets). | §4–5: UODO's own model regulamin | A's `ContestRegistration.publish_name`; results page |
| **A minor registers only with a guardian's consent recorded on the registration**, and `allows_minors=False` presets refuse `minor`. Under 16 is the line (`accounts/minors.py`). | §4: KC art. 15/17, GDPR art. 8 (Poland did not lower it) | A's `register_block_reason` |
| **`kuratorium` and `olympiad` are staff-only**, with the external reference mandatory; the UI never implies a user's contest exempts anybody from an exam. | §7, §14 item 9 | `presets.staff_only`; A's create |
| **The tax block shows the "science" limb (≤ 2 000 zł) and the 10% above it, never the mass-media limb**; in-kind prizes show the gross-up (÷ 0.9). Every number carries its marker. | §3: PIT art. 21 ust. 1 pkt 68 (disputed limb), art. 30 ust. 1 pkt 2, art. 41 ust. 4/7 | `presets.LAW`, `PIT_68_THRESHOLD_PLN`, `GROSS_UP_DIVISOR`; A's compliance panel |
| **The organiser is named above the fold on every contest page, and EdMat never funds, judges, breaks ties or guarantees a prize.** No payment field, no entry fee, no prize pool. | §11: co-organiser risk; `FINANCES.md` | A's page; B's `LEGAL.md` section |
| **Complaints: ≥ 14 days to lodge, 14 to answer, with reasons**; 7 for the two kurator presets where the practice is shorter. | §9: UOKiK register; §7: MENiS §9 ust. 4 pkt 4 | `presets.complaint_window_days`; A's `ContestComplaint` |
| **Retention is per purpose**, not one field: the regulamin's §10 says so, and the module stores nothing it does not need. | §5 | A's rules sections guidance |
| **Everything the compliance panel says carries its verification marker and the sentence "this is not legal advice".** | §14 | `presets.LAW_MARKERS`; A's panel |
| **Community voting does not decide a prize.** Not built (preset (k)) until a lawyer answers §14 item 1. | §14 item 1 | left open, named |

## 2. The shared seam — what the prep landed

- **Flag `contests`** — `moderation` migration 0053, seeded ON, in `featureFlag.ts`, `labels.ts`
  and both catalogues. Every endpoint `feature_gate('contests')`; every link `can('contests')`.
  Nobody adds a key.
- **`backend/contests/`** — registered in `INSTALLED_APPS` and `config/urls.py` (included BEFORE
  `attachments.urls`, whose catch-all must stay last):
  - `models.py`: `Contest` (title, description sanitized in `save()`, `preset_key`, `organiser`,
    `organization` nullable, `status` [draft → announced → registration_open → running → judging →
    results_published → closed; cancelled], `visibility`, `audience`, `allows_minors`, `starts_at`,
    `ends_at`, `registration_opens_at`, `registration_closes_at`) and `ContestStaff` (role:
    organiser | jury | proctor | secretary; one row per person). Migration `0001`. **Step A adds
    `0002+`; step B adds NO migration to this app.**
  - `access.py`: `role_of`, `can_view`, `is_staff`, `is_member`, `can_manage`, `can_score`,
    `staff_users`, `visible_contests`, and the four `*_contest` names `config/nodes.py` imports.
    `_registered(user, contest)` is the one body A replaces (registration in a place-holding status).
  - `presets.py`: ten presets, the regulamin skeleton (12 sections), the legal checklist (24
    items), the `LAW` table with markers, `visible_to(user)`, `checklist_for`, `sections_for`,
    `as_api(user)` → `{'law': {...}, 'presets': [...]}`. **B owns it after the prep; A reads it.**
  - `personalize.py: apply_preset(contest, actor) -> dict` — STUB returning `skipped: ['not_built']`.
    B writes the body; A calls it on create and in the seed and shows the report.
  - `work.py: work_items(user) -> []` and `record.py: placements_for(user) -> []` — STUBS. **A
    writes both bodies** (it owns the rows they read); **B registers both** (`work/builtin.py`,
    `identity/record.py`).
  - `views.py: ContestPresetsView` at `GET /api/contest-presets/` (public, behind the flag; staff
    see the two staff-only presets). `urls.py` has an empty `NumericPkRouter` for A.
  - `tests.py`: seven prep tests (the draft-404 rule, the roles, the seam, the flag, the gate).
- **`config/nodes.py`**: kind `contest` → `('contests', 'contest')`, dispatching to `access.py`.
  **Read-only for A and B.**
- **`config/creation.py`**: `contest` is the fifth `CREATION_KINDS` entry (mirrored in
  `types/creation.ts` and `labels.ts: GATE_HUB_SENTENCES`, `gate_hub_contest` in both catalogues).
  A's `ContestViewSet.create` asks `creation_block_reason(user, 'contest')` and answers `403
  {"detail": word}` like the other four.
- **`attachments/targets.py`** and `types/attachment.ts`: `contest` is a target kind, so
  `AttachmentsPanel` already works on a contest node through `ManagementPanels`.
- **Frontend**: `types/node.ts` (`'contest'` in `NodeKind`), `utils/nodeHref.ts`
  (`/contests/[id]`), two PLACEHOLDER routes `routes/contests/+page.svelte` and
  `routes/contests/[id]/+page.svelte` (A replaces both whole; the second already mounts
  `<ManagementPanels nodeKind="contest" nodeId={id} />`), keys `contests_title`,
  `contests_placeholder`.
- **Markers**, one HTML comment each, replaced or appended-below by exactly the step named:

| File | Marker | Step |
|---|---|---|
| `Header.svelte` script block | `Contests flag` — `let canContests = $derived(can('contests'))` already there | A reads it; A also wraps "New contest" in `creationStore.allows('contest')` |
| same, main nav | `Contests nav marker` | A appends "Contests" → `/contests` with an inline icon |
| same, Add… snippet | `Contests Add… marker` | A appends "New contest" → `/contests/new`, adults, gate |
| same, account snippet | `Contests account-menu marker` | A appends "My contests" → `/contests?mine=1` |
| `routes/about/+page.svelte` | `contests: showcase (B)` | B (adds its card to `ShowcaseIndex` itself) |
| `svelte.config.js` prerender list | `contests: showcase (B)` | B appends `/about/contests` and its guide chapter |
| A's `routes/contests/[id]/+page.svelte` | `contests: compliance (A)` / `contests: translations (integration)` / `contests: discussion (integration)` | A writes the markers; the integrator mounts B's pieces |

## 3. The two steps

Each step is one Opus agent, one branch, one worktree, one board entry, one port pair, **full
stack**, and may spawn **at most one Haiku subagent** for a bounded side task (a search, a catalogue
diff, a screenshot comparison) — never a step, never a check it then reports as its own. Re-run
anything Haiku reports.

| Step | Branch | Worktree | API | Vite | Brief |
|---|---|---|---|---|---|
| A core + interface | `contest/a-core` | `.claude/worktrees/contest-a-core` | 8171 | 5271 | `prompts/18-contests-a-core.md` |
| B personalise | `contest/b-personalise` | `.claude/worktrees/contest-b-personalise` | 8172 | 5272 | `prompts/19-contests-b-personalise.md` |

### A. The contest, and every page of it (`contest/a-core`)

**Models (migrations 0002+):** on `Contest` add `prize_claim_deadline` (nullable; required by
rule when `has_prize`), `has_prize` bool, `prize_description` (sanitized), `prize_total_value_pln`
(int, nullable), `prize_regime` (`presets.PRIZE_REGIMES`), `organiser_is_business` bool,
`external_reference_url` (blank; required by rule for staff-only presets), `entry_licence`
(`none` | `non_exclusive`), `complaint_window_days` (int, from the preset), `publication_default`
(`initials` | `full_name_opt_in`), `merit_criteria` (sanitized text; required by rule to announce),
`team` bool, `team_size_max` (nullable), `preparation_course` FK `courses.Course` nullable,
`accommodation_contact` (blank), `data_controller_name` / `data_controller_contact` (blank;
required by rule to announce), `announced_at`, `results_published_at`, `closed_at`.
Then: `ContestStage(contest, order, key, title, description sanitized, mode: online | onsite,
event FK events.Event nullable [the on-site stage IS an event: venue, documents, rota, cloakroom
come with it], opens_at, closes_at, advancement: presets.ADVANCEMENTS, advance_count nullable,
advance_threshold nullable, max_points derived from problems, status: scheduled | open | closed |
scored)`; `ContestProblem(stage, exercise FK exercises.Exercise, order, points, visible_from
derived from the stage — an exercise's statement is public content already, but WHICH exercises a
stage uses is hidden until it opens)`; `ContestRegistration(contest, user, status: requested |
accepted | declined | withdrawn | disqualified, affiliation, guardian_name, guardian_consent_at
nullable, publish_name bool default False, team_name blank, accepted_rules_version int,
created_at, decided_by, decided_at)` unique (contest, user); `ContestSubmission(stage,
registration, submitted_at, status: draft | submitted | scored)` unique (stage, registration);
`ContestAnswer(submission, problem, text sanitized, attachment FK attachments.Attachment nullable)`
unique (submission, problem); `ContestScore(submission, problem, juror, points, note sanitized)`
unique (submission, problem, juror) — the submission's score is the MEAN over jurors per problem,
summed, **recounted never stored** (house rule 5); `ContestResult(contest, registration, rank,
total_points, title: participant | distinction | finalist | laureate, published_at)` written only
by `publish_results` and deleted only by `unpublish` while the complaints window is open;
`ContestComplaint(contest, registration, text sanitized, status: open | answered | withdrawn,
answer sanitized, answered_by, answered_at, created_at)`; `ContestRulesSection(contest, key from
presets.RULES_SECTIONS, order, body sanitized)` and `ContestRulesVersion(contest, number,
published_at, snapshot JSON of the sections)` — a registration stores the version it accepted.

**Rule module `contests/rules.py`** (every word is a refusal the frontend has a sentence for —
house rule 6; a stranger gets 404 from `access.visible_contests` first — house rule 4):
`announce_block_reason(contest)`: `claim_deadline_missing`, `jury_missing`, `criteria_missing`,
`controller_missing`, `external_reference_missing`, `no_stages`, `chance_element` (a stage's
description or the criteria match `losowan` / `loteri` / `wylosow`); `transition_block_reason
(contest, to)`: the table in §2 of `models.py`, `illegal_transition` otherwise, `closed` is final;
`register_block_reason(user, contest)`: `anonymous`, `not_open`, `own_staff`, `minor` (when
`allows_minors` is False), `guardian_consent_required` (when a minor and no consent in the
payload), `already_registered`, `full` (if a cap exists), `team_required`; `submit_block_reason`:
`stage_not_open`, `not_accepted`, `already_submitted`; `score_block_reason(user, submission)`:
`not_juror`, `stage_open` (scoring starts when the stage closes), `own_submission`;
`publish_results_block_reason(contest)`: `stage_unscored`, `already_published`;
`complain_block_reason(user, contest)`: `window_closed` (`results_published_at + complaint_window_days`),
`not_participant`, `already_open`; `advance(stage)` computes who goes on by `advancement`
(`top_n` / `threshold` / `all`; `final` advances nobody) and is the ONLY writer of the next
stage's eligibility; `ranking(contest)` = ordered recount; `titles_for(ranking, preset)` assigns
laureate / finalist / distinction by the organiser's thresholds (`laureate_min_pct`,
`finalist_min_pct`, `distinction_count` on `Contest`, added in A's migration).
`contests/people.py: suggested_people(user) -> [{id, display_name, via: [...]}]` — people the
founder shares a roster with (course staff on courses they staff, event staff on events they host
or staff, members of their organisations, members of their material projects), for the wizard's
role pickers: **this is "prefilling with current users"**, and the seed makes it visible on the
dev database. `contests/compliance.py: report(contest) -> {'items': [{key, state: ok | missing |
warning, law: [keys], detail}], 'not_legal_advice': True}` — the checklist of
`presets.checklist_for` evaluated against the rows (claim deadline present, jury size, criteria,
minors with consent, prize value vs the 2 000 zł line and the regime, in-kind prize gross-up,
external reference, stage descriptions free of chance words, complaint window ≥ 14 or the
preset's), every item with its `LAW` keys so the panel can draw the marker.

**API** (all behind `feature_gate('contests')`, `IsAuthenticatedOrReadOnly`):
`GET /api/contests/` (`?mine=1` organised or staffed or registered, `?status=`, `?preset=`,
`?q=`; `visible_contests`), `POST` (the gate; `preset_key` validated against `visible_to(user)`;
`apply_preset` called after save; the response carries `personalisation` = its report),
`GET|PATCH /api/contests/{id}/`, `POST …/transition/ {status}`, `POST …/announce/` (the checks),
`GET|POST …/staff/`, `DELETE /api/contest-staff/{id}/` (`409 last_organiser`),
`GET|POST …/stages/`, `GET|PATCH|DELETE /api/contest-stages/{id}/`, `POST …/open/`,
`POST …/close/`, `POST …/advance/`, `GET|POST /api/contest-stages/{id}/problems/` (problems
hidden until `opens_at` for non-staff: 404), `DELETE /api/contest-problems/{id}/`,
`GET|POST …/registrations/` (POST = register; `guardian_name`, `guardian_consent` bool,
`publish_name`, `affiliation`, `team_name`), `POST /api/contest-registrations/{id}/decide/
{decision}`, `/withdraw/`, `/disqualify/`, `PATCH …/publish-name/` (the separate consent, revocable),
`GET|PUT /api/contest-stages/{id}/submission/` (mine; answers inline), `POST …/submit/`,
`GET /api/contest-stages/{id}/submissions/` (jury), `POST /api/contest-submissions/{id}/scores/`,
`GET /api/contest-stages/{id}/ranking/` (staff before results, everyone after),
`POST /api/contests/{id}/publish-results/`, `POST …/unpublish-results/` (window open only),
`GET …/results/` (public once published; names per `publish_name`), `GET|POST …/complaints/`,
`POST /api/contest-complaints/{id}/answer/`, `GET|PUT …/rules/` (sections), `POST …/rules/publish/`
(new version), `GET …/rules/versions/{n}/`, `GET …/compliance/`, `GET /api/contests/people-suggestions/`,
`GET /api/contests/{id}/certificate/{resultId}/`.

**Interface tasks** (the owner asked for these spelled out; each is a page or a component A ships):
1. **`/contests` hub** — cards (title, organiser above the fold, preset badge, status, dates, the
   next thing that happens), tabs "all" / "mine" / "I am judging" / "I am taking part", filters
   by status and preset, the creation-gate note, the empty state.
2. **`/contests/new` — the wizard**, four screens, back-navigable, nothing saved until the last:
   (i) choose a preset (the ten cards with summary, who the organiser is, prize or not, staff-only
   ones only for staff); (ii) the prefilled form — title, description, audience, dates, the stage
   ladder from the preset (editable unless `stages_locked`; `onsite` stages offer "create the
   event now"), has-prize toggle (off for `challenge`, and turning it on reveals the prize block
   and the claim deadline), organiser kind (person / organisation picker from `getOrganizations
   ?mine=1` / kurator / committee with the external-reference field), organiser-is-business;
   (iii) **roles prefilled from current users** — one picker per `RoleSlot` fed by
   `/api/contests/people-suggestions/` with the "via" line ("staff with you on Analiza I"), plus
   "by account id" as the fallback the rest of the site uses; (iv) the legal checklist preview
   (`checklist_for` with the markers and "this is not legal advice") and the "what will be created
   for you" list (plan, goal, tasks, needs, poll — from the preset; shows `skipped` honestly after
   create). Create → `/contests/[id]`.
3. **`/contests/[id]` — the contest page**: hero with the organiser's name and kind first, the
   status timeline (the eight statuses as a strip, the current one lit), the stage ladder with
   dates and "opens in", the register call-to-action with the guardian-consent block when the
   reader is a minor and the `publish_name` opt-in, "you are registered / on the jury /
   organising" states, the problems link per open stage, results once published, the rules link,
   the compliance panel for staff (marker `contests: compliance (A)`), the markers for the
   integrator (`translations`, `discussion`), and `<ManagementPanels nodeKind="contest">` — which
   is where B's plan, goal, tasks, needs and poll appear without A doing anything.
4. **`/contests/[id]/rules`** — the regulamin: for readers the sections rendered through
   `renderContent`, the version and date, a print stylesheet (the "downloadable" the law wants);
   for staff an editor with one block per `RulesSection` carrying its guidance and law markers,
   and "publish a new version".
5. **`/contests/[id]/stages/[stageId]`** — for a participant: the problems (the exercise's
   statement rendered as on `/exercises/[id]`, hints hidden, solutions hidden), an answer box per
   problem (Markdown + LaTeX like everywhere, the existing editor), attach a file via the
   attachments service, a countdown to `closes_at`, draft autosave, submit with confirmation; for
   staff: the problem picker (search the corpus by branch/topic like `/search`, add with points),
   open / close / advance controls with the refusal sentences.
6. **`/contests/[id]/judge`** — the jury's matrix: submissions × problems for a closed stage,
   points and a note per cell, the mean so far, "my scoring is complete" per submission, the
   ranking preview for the organiser, anonymised by default (registration number, not name).
7. **`/contests/[id]/results`** — the ranking once published: rank, initials or opted-in name,
   points, title chip; the complaints window with its end date and the "lodge a complaint" form
   for a participant; the certificate link for a laureate / finalist.
8. **`/contests/[id]/manage`** — registrations queue (accept / decline / disqualify with the
   consent column visible), staff roster with roles, complaints inbox with answer form,
   publish / unpublish results, transitions, the compliance panel at full size, danger zone
   (cancel with the same-channel notice the law wants).
9. **`/contests/[id]/certificate/[resultId]`** — printed by the browser like a course completion,
   naming the organiser as the issuer and EdMat as the medium.
10. **Header**: the three marker appends; **work dashboard rows** come from `work.py` (A) with the
    labels from B; **`/about/contests`** is B's.
11. **Components** worth their own file: `ContestCard`, `StatusStrip`, `StageLadder`,
    `RolePicker` (the suggested-people picker, reusable), `GuardianConsentBlock`,
    `CompliancePanel` (A's; reads `/compliance/` and the `law` map from the presets endpoint),
    `ScoringMatrix`, `RankingTable`, `RulesSectionEditor`.
12. **i18n** prefix `contests_`; every refusal word has a sentence in both catalogues; every
    `m.*()` call carries its `// "Original text"` comment.
13. **`seed_contest_demo`** — idempotent by title, on the dev accounts: `u-kasia` organises a
    `school` contest with `u-michal` and `u-ola` on the jury, `u-bartek` as secretary, the four
    `demo-*` accounts registered (two as minors with consent), one stage with four real
    exercises, submissions, scores, results published, one complaint answered; `u-michal`
    organises a `challenge` with `u-julia` on the jury, registration open; `student1` registered
    nowhere. Calls `apply_preset` (a stub on A's branch; the report says so).
14. **`e2e/contests.mjs`** — the real browser: found from the wizard with a suggested person on
    the jury, announce refused for the missing claim deadline then accepted, register a minor
    with consent, open a stage, answer, close, score as jury, publish results, lodge and answer a
    complaint, screenshot every page and LOOK at it.

**Not in A:** presets content (B), the rows in other apps (B), registries outside `contests/` and
the two shared files the prep touched (B), notifications (rule 12 — name them), community voting
(not built, §1), payments of any kind (never), people search (the known gap — the suggested-people
list is the honest substitute).

### B. Every other module, made contest-aware (`contest/b-personalise`)

- **`contests/personalize.py: apply_preset`** — the body. For the contest's preset: a `plans.Plan`
  on the contest node with one `PlanStep` per phase (announce → registration opens → registration
  closes → each stage opens / closes → judging → results → complaints window closes → prizes
  handed → close), due dates from the contest's dates and the preset's offsets; a `goals.Goal`
  with one `GoalCriterion` per `goal_criteria`; one `tasks.Task` per `checklist_for` item,
  assigned to the organiser or secretary by `role` (the secretary slot may be empty: then the
  organiser), with `due_at` by `phase` (`before_announce` → `starts_at − 7 d`, `before_results` →
  `ends_at`, `after_results` → `ends_at + complaint_window_days`, `at_close` → `+ 30 d`), the
  description carrying the citations and their markers and "this is not legal advice"; one
  `needs.Need` per `needs` entry (kind, wanted_count); one `decisions.Poll` "Confirm the final
  ranking" (staff, single, two options, draft). **Through those apps' own service / serializer
  paths, never their ORMs directly**, so every rule they have (minors, flags, node standing)
  fires. A module whose flag is off → its key in `skipped`, never an exception (house rule 10).
  Idempotent: a second call creates nothing (keyed by a `contest_preset_rows` note? — no: by
  title + node, and say so). Tested with every flag on, each one off, and a preset without a prize.
- **Registries**: `community/targets.py` (`('contests','contest'): 'contest'` + the frontend union
  — comments on a contest); `community/discussions.py: MANAGEMENT_KINDS` (`'contests'` → the
  contest page is a discussion location, `contests/17`); `moderation`'s `REPORT_KIND_MODELS`
  (a contest can be reported — DSA art. 16); `galleries/visibility.py` (photos of the final);
  `translations/authority.py` (`contest`: title and description in every language — the
  management-text third case, resolved for the reader's interface language); `flashcards.PLACEABLE_NODE_KINDS`
  (`'contest'` — a practice deck for participants, visible to registered members); `activity`
  (kinds `contest` on announce and `contest_results` on publish, from a `post_save` on `Contest`
  that fires ONLY when the row is public at that instant — house rule 9 — with the forgetting half
  on cancel); `work/builtin.py` (register `contests.work.work_items` under the flag; labels for
  kinds `contest_registration`, `contest_judging`, `contest_complaint`, `contest_stage` on `/work`);
  `identity/record.py` (register `contests.record.placements_for` behind the person's
  learning-record consent; a "Contests" block on the public profile with the title chips).
- **`/about/contests`** — the showcase page in the style of the seven existing ones (sample data,
  prerendered, the card in `ShowcaseIndex`, the prerender entry), telling the story of §1 in a
  reader's words: what a contest is here, the no-prize default, the law a prize brings, the
  presets, the people pickers.
- **The manual chapter** `/about/guide/contests` in H's shape (`prompts/09-manual.md`), written
  against A's pages as described in §3.A (the integrator re-shoots the screenshots after the
  merge — say so in the chapter's note).
- **`LEGAL.md`**: a new section "Contests" summarising §1 and §11 of `CONTESTS-LAW.md`: EdMat is
  the medium and a processor, never the przyrzekający; the three separations that keep
  `FINANCES.md` true; the terms-of-use clause the research recommends; the new Polish DSA act
  (6 November 2026, Prezes UKE); the ranked open questions for a lawyer. Plus the one line in
  `FINANCES.md` saying a prize contest does not change "nothing takes money".
- **`labels.ts`**: `PRESET_LABELS`, `PRIZE_REGIME_LABELS`, `ORGANISER_KIND_LABELS`,
  `LAW_MARKER_LABELS`, `CONTEST_STATUS_LABELS`, `CONTEST_STAFF_ROLE_LABELS` — mirroring
  `presets.py` and `models.py` (house rule 13, said in both). A reads them.
- **`CompliancePanel` is A's** (it reads A's endpoint); B does not write a second one.

**Not in B:** any `contests` migration; A's pages; notifications (rule 12 — name the four you
wanted: registration decided, stage opened, results published, complaint answered).

## 4. Rules for building two branches at once

1. **One app per step for migrations**: A migrates `contests`; B migrates nothing in `contests`
   and anything it needs in `activity` / `identity` / others. If B truly needs a `Contest` field,
   stop and write it on the board.
2. **The flag is seeded.** Do not add a key; do not touch `moderation/migrations`.
3. **`config/nodes.py`, `config/creation.py`, `attachments/targets.py` are read-only** for both.
4. **Markers**: replace or append at **your own marker only** (§2 table). A owns
   `routes/contests/**` whole. B owns `routes/about/contests/**`, `routes/about/guide/**`'s new
   chapter, and `lib/components/showcase/**`'s new card. Neither touches the other's.
5. **i18n keys prefixed**: A `contests_*`; B `contestsAbout_*`, `contestPreset_*`,
   `contestLabel_*`, `guide_contests_*`; both as one contiguous block at the END of each
   catalogue, identical key sets, every `m.*()` with its comment. Recompile Paraglide after.
6. **`labels.ts`**: B appends the contest maps at the end under a comment naming `contests/presets.py`
   and `contests/models.py`; A appends ONLY its refusal-word maps (`CONTEST_BLOCK_LABELS`) under
   its own comment. Nothing else there.
7. **`HISTORY.md`**: append `## 17CE.A …` / `## 17CE.B …` at the very end with "Verified" (what you
   ran, numbers) and "Left open". `test.md` one paragraph each. `CLAUDE.md`, `CLAUDE_MAP.md`, the
   app list and the flag count are the integrator's. A writes `backend/contests/CLAUDE.md` (B adds
   a "Presets and personalisation" section to it at integration via the board, not by editing A's
   file).
8. **Boards** at `/Projects/edmat-boards/`: your `doing.md` entry is written. Finish → top of
   `done.md` with the commit and the numbers; re-read immediately before editing and write in one
   process. Left-opens → `todo.md` under "Contests step <letter>".
9. **Verify by running** (house rule 2), with Node 24 first on `PATH`: `manage.py test contests
   config <every app you touched>`, `manage.py check`, `makemigrations --check --dry-run`,
   `testing/check_databases_declared.py` prints zero, `npm run check` (0/0), `npx eslint .`
   (`npm run lint` fails on `frontend/CLAUDE.md`'s formatting — pre-existing at the prep, not
   yours; do not reformat that file), `npm run build`, your e2e script against real servers on
   YOUR ports (`DJANGO_CORS_ALLOWED_ORIGINS=http://localhost:<vite>,http://127.0.0.1:<vite>`,
   `frontend/.env` already points at your API port), `backend/cachedata/*` cleared before each
   e2e run, never while editing, never beside the full suite. Look at the screenshots.
10. **Commit on your branch, never push, never merge, never rebase.** The integrator merges B
    then A onto `ux/colour-pass` and wires §5.
11. **Absolute paths always**; `git -C <worktree>`.
12. **No new notification types.** Name them in "Left open".
13. **One Haiku at most**, for a bounded side task; re-run what it reports.
14. **Refusals carry a word; a stranger gets 404; one status field; recount never increment;
    sanitize on write; render through `renderContent`.** Read `backend/CLAUDE.md` and
    `frontend/CLAUDE.md` before the first line.

## 5. Integration, after both land

Merge B, then A, onto `ux/colour-pass`. Then:

- mount B's pieces at A's three markers on `/contests/[id]`: the `TranslateFields` panel for the
  contest's text, the `SectionDiscussion` under the page, and nothing else (the compliance panel is
  already A's);
- run `seed_contest_demo` on the dev database and confirm `apply_preset` now creates the plan, the
  goal, the tasks, the needs and the poll, visible in the panels on the contest page;
- permission-matrix rows for every new endpoint (`events/test_permission_matrix.py`'s header);
- `CLAUDE.md`: the app list (39 → 40), the flag count (36 → 37, counted), the routes block, the
  API block; `CLAUDE_MAP.md`; `test.md`;
- the whole backend suite, `npm run check`, `npm run build`, `check:a11y`, both e2e scripts, and
  `events-and-nav.mjs`;
- one `HISTORY.md` §17CE preamble tying A and B together;
- `deploy/fuw/pack.sh`'s prerender list gains `/about/contests` and the guide chapter.

## 6. Defaults in force unless the owner says otherwise

1. Minor line is under 16 (`accounts/minors.py`); a minor may register with a guardian's consent
   where the preset allows minors, may answer problems (no free text to a stranger), may NOT
   lodge a complaint themself (free text to the organiser — the guardian does, by the organiser
   recording it) — say so in the UI.
2. No money anywhere: no entry fee field, no prize pool, no payment; a prize's VALUE is recorded
   for the tax copy only.
3. People are suggested from shared rosters, or added by account id (the known gap).
4. Nothing EdMat says about the law is advice; every citation shows its marker.

## 7. Left open, by design

- Community-judged contests (preset (k)) — a lawyer's answer first.
- A DPA (umowa powierzenia) template between EdMat and an organiser — `LEGAL.md` names it.
- Notifications (rule 12).
- Teams beyond a `team_name` on a registration (a real team roster with a captain).
- Proctoring beyond a role name (no camera, no lockdown — and not wanted).
