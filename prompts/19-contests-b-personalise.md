# B. Contests — every other module made contest-aware — brief for one agent

| | |
|---|---|
| **Model** | Opus (the owner's standing decision; you may spawn ONE Haiku subagent for a bounded side task and must re-run anything it reports) |
| **Branch** | `contest/b-personalise` |
| **Worktree** | `/Projects/edmat/.claude/worktrees/contest-b-personalise/` |
| **Ports** | API `8172`, Vite `5272` |
| **Prep commit** | `75a6fea` on `contests/prep` (branched from `ux/colour-pass` at `b6aa58a`) |
| **Boards** | `/Projects/edmat-boards/` — your `doing.md` entry is already written |
| **Node 24** | `export PATH=/home/bob/.cache/edmat-tools/node24/bin:$PATH` |
| **Sibling** | step A (`contest/a-core`) builds at the same time and owns everything in `backend/contests/` EXCEPT `presets.py` and `personalize.py`, and everything under `routes/contests/**`. On your branch a contest has only the prep's two models; design against that and against §3.A's names for what A adds. |

## Read first
`prompts/README.md` §4 and §5, then **`CONTESTS-BRIEF.md` whole** — §0 says what "personalise
every module" means, §1 the law as decisions, §2 what exists, §3.B your step in full, §4 the rules.
`CONTESTS-LAW.md` §1, §5, §11, §12, §13, §14 (your `LEGAL.md` section summarises §11 and §14).
Then `backend/contests/presets.py` (yours now — read every line), `personalize.py` (the stub you
replace), and, for each registry you join, the file named in §3.B and the step that added the last
entry to it (`HISTORY.md` §17BI for the management apps, §17CD for attachments, the
`translations` and `provenance` sections for 2026-10-08). `MANAGEMENT-BRIEF.md` §3.B–E and §3.F
for how a task, a need, a plan, a poll and a work row are made and what each refuses.
`prompts/08-about-showcase.md` and `prompts/09-manual.md` for the showcase and manual shapes.

## The task
Make every existing module speak "contest": the preset becomes rows on the contest node (the
plan, the goal, the tasks of the legal checklist, the needs, the poll) through those apps' own
paths; a contest joins every registry a course or an event is in (comments, reports, discussions,
galleries, translations, flashcard placements, the activity feed, the work dashboard, the learning
record); `/about/contests` tells the story; the manual gains its chapter; `LEGAL.md` and
`FINANCES.md` record what the research found; `labels.ts` mirrors the presets and the statuses so
A's pages and the panels read the same words.

## What "finished" means
- [ ] `personalize.apply_preset` creates, for a `school` contest with every flag on: one plan with
      the timeline steps and due dates, one goal with the preset's criteria, one task per
      `checklist_for` item assigned by role with a description carrying the citations and
      markers and "this is not legal advice", the needs, one draft poll; returns the report shape
      of the stub's docstring; **idempotent** (a second call creates nothing and says so);
      with `tasks` off → `'tasks'` in `skipped` and the rest created; a `challenge` creates no
      prize items. Tests for each of those sentences.
- [ ] Every registry in §3.B joined, each with the test its neighbours have (a stranger 404s
      on a draft contest's thread / report / gallery / translation / placement; the activity row
      appears on announce ONLY if public, and is forgotten on cancel).
- [ ] `work/builtin.py` registers `contests.work.work_items` under `contests`; `/work` has labels
      for the four kinds; `identity/record.py` registers `contests.record.placements_for`; the
      profile shows a "Contests" block behind the learning-record consent (empty on your branch —
      the stubs return `[]` — and tested with a monkeypatched provider).
- [ ] `/about/contests` prerendered, in `ShowcaseIndex`, in `svelte.config.js` at the marker, in
      the style of the seven; `check:a11y` clean on it.
- [ ] `/about/guide/contests` chapter with a note that its screenshots are re-shot after
      integration; in the guide's index and the prerender list.
- [ ] `LEGAL.md` "Contests" section; one line in `FINANCES.md`; `backend/contests/CLAUDE.md` is
      A's file — put your "Presets and personalisation" paragraph in `HISTORY.md` §17CE.B and on
      the board for the integrator to append.
- [ ] `labels.ts`: `PRESET_LABELS`, `PRIZE_REGIME_LABELS`, `ORGANISER_KIND_LABELS`,
      `LAW_MARKER_LABELS`, `CONTEST_STATUS_LABELS`, `CONTEST_STAFF_ROLE_LABELS`, at the end,
      under a comment naming `contests/presets.py` and `contests/models.py`; both files say they
      mirror each other.
- [ ] i18n: `contestsAbout_*`, `contestPreset_*`, `contestLabel_*`, `guide_contests_*` keys,
      identical sets, every `m.*()` with its comment.
- [ ] `e2e/contests-personalise.mjs`: against real servers, found a contest by `POST
      /api/contests/`? — **No endpoint exists on your branch.** Create one through the ORM in a
      setup script (`Contest.objects.create` + `apply_preset`), then drive the browser to
      `/contests/<id>` (the prep placeholder mounts `ManagementPanels`) and screenshot the plan,
      goal, tasks, needs and poll panels there, `/about/contests`, the guide chapter, `/work`
      with the section present, and a profile. Look at them.
- [ ] `HISTORY.md` `## 17CE.B`; a paragraph in `test.md`; the board entry moved to `done.md`
      with the numbers.

## Context — what you need and where it is
| Need | Where | Why |
|---|---|---|
| How to create a task / need / plan / poll / goal through its own path | `tasks/views.py` + `serializers.py`, `needs/…`, `plans/…`, `decisions/…`, `goals/…`; `work/edmat_project.py` (the seed that already creates such rows on the EdMat organisation) | never their ORMs directly; the seed is your closest precedent |
| Node standing | `config/nodes.py` (read-only), `contests/access.py` | a contest's organiser is `can_manage`; jury/secretary are staff |
| The registries | `community/targets.py`, `community/discussions.py: MANAGEMENT_KINDS`, `moderation/services.py: REPORT_KIND_MODELS`, `galleries/visibility.py`, `translations/authority.py`, `flashcards/models.py: PLACEABLE_NODE_KINDS`, `activity/models.py` + `signals.py`, `work/builtin.py`, `identity/record.py` | one line each plus the frontend union where one exists |
| Public by construction | `activity/CLAUDE.md`, house rule 9 | the signal fires only when the row is public at that instant |
| The showcase and manual shapes | `routes/about/events/+page.svelte`, `routes/about/guide/[chapter]`, `prompts/08`, `prompts/09` | sample data, prerendered, a11y clean |
| The law for `LEGAL.md` | `CONTESTS-LAW.md` §11, §14; `LEGAL.md` as it stands | EdMat is medium + processor; the DSA act of 6.11.2026 |
| A's model and refusal names | `CONTESTS-BRIEF.md` §3.A | your labels and the manual are written against them |

## Shapes fixed in advance
- `apply_preset(contest, actor) -> {'preset', 'created': {'plan', 'goal', 'tasks', 'needs',
  'polls'}, 'skipped': [...]}`.
- Work kinds `contest_registration`, `contest_judging`, `contest_complaint`, `contest_stage`.
- `placements_for(user) -> [{contest_id, title, result_title, published_at}]`.
- Comment target name `contest`; discussion page key `contests/<id>`; translation kind `contest`
  with fields `title` and `description`.
- Activity kinds `contest` and `contest_results`.

## Left open, by design
Notifications (name the four); a DPA template; `CompliancePanel` is A's; mounting the
translations panel and the discussion on A's page is the integrator's (§5).

## Verify
```bash
W=/Projects/edmat/.claude/worktrees/contest-b-personalise
export PATH=/home/bob/.cache/edmat-tools/node24/bin:$PATH
cd $W/backend && ../.venv/bin/python3 manage.py test contests community moderation galleries translations flashcards activity work identity tasks needs plans decisions goals config --parallel 4
../.venv/bin/python3 manage.py check && ../.venv/bin/python3 manage.py makemigrations --check --dry-run
../.venv/bin/python3 testing/check_databases_declared.py
cd $W/frontend && npm run check && npx eslint . && npm run build && npm run check:a11y
rm -rf $W/backend/cachedata/*
DJANGO_CORS_ALLOWED_ORIGINS=http://localhost:5272,http://127.0.0.1:5272 ../.venv/bin/python3 ../backend/manage.py runserver 127.0.0.1:8172 &
npm run dev -- --port 5272 --strictPort &
node e2e/contests-personalise.mjs
```
Numbers in the board entry. Look at the screenshots.
