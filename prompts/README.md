# prompts/ — the agents about to be launched, and how to launch them

This directory holds one brief per agent for the **learning cycle** (`00-DESIGN.md`): the design
they share, the context each one needs and where it is, which model and worktree each gets, and
what the integrator does after they land. A brief is pasted as the agent's prompt, whole, after
the header block from `_template.md` has been filled in. It is the third time this project builds
many branches at once; `CONFERENCE-BRIEF.md` §4 and `MANAGEMENT-BRIEF.md` §4–5 are the two
previous runs and this file is their rules, kept, plus what they taught.

The briefs are tracked in git on purpose (they are design, like the `*-BRIEF.md` files). The
boards are not, and stay at `/Projects/edmat-boards/` (or `/home/alojzy/Wymiana_VM/edmat-boards/`
on the other machine) — a brief says *what*, a board says *who is on it right now*.

---

## 1. The pattern

```
prep commit (integrator)  →  N branches at once, one app each  →  integration (integrator)
```

The prep commit lands every **shared** edit before anyone starts: feature flags (one migration),
marker comments in the shared Svelte files, empty registered apps, stub rule modules. After that
the only shared-file edits a step makes are appending at its own marker. Every merge conflict is
then a "both appended" conflict, resolved mechanically (`resolve_union.py` beside the
management-build memory; watch for identical trailing lines folded into context, run Prettier and
`fix_labels_seams.py` after each merge).

## 2. Who — model per step

| Step | Brief | Model | Why this model |
|---|---|---|---|
| prep | `01-prep.md` | the orchestrating session (Fable 5.1) | touches shared files; must know all nine briefs |
| A flashcards | `02-flashcards.md` | **Opus 5** | new app, new algorithm, the one others build against |
| B learning record | `03-learning-record.md` | **Opus 5** | one rule module, one profile section, one consent flag, a minors fix |
| C courses | `04-courses-school-mode.md` | **Opus 5** | `courses` is the largest app (1 600+ lines of models) with the most invariants |
| D concept paths | `05-concept-paths.md` | **Opus 5** | a bounded graph walk and two buttons |
| E events | `06-event-takeaways.md` | **Opus 5** | two panels against documented shapes |
| F creation gate | `07-creation-gate.md` | **Opus 5** | one rule module, four call sites already wired, one menu, four hubs |
| G /about showcase | `08-about-showcase.md` | **Opus 5** | design judgement across every surface; must read all briefs |
| H manual | `09-manual.md` | **Opus 5**, with the browser harness | drives the real app, writes, screenshots, iterates |
| integration | `10-integration.md` | the orchestrating session | merges, wires, runs everything |

**Every step runs on Opus 5 — owner decision, 2026-10-05** ("Agents should be using Opus 5"),
replacing the Opus/Sonnet split this table first proposed. The reason the split existed is
below and still true of Haiku.

**Do not give a step to Haiku.** On 2026-09-24 both Haiku steps reported checks they had not run
and did not converge when sent back; Sonnet takeovers found real bugs underneath. Re-run every
agent's "Verified" numbers before merging regardless of model.

## 3. Where — worktrees, branches, ports

Branch `learn/<letter>-<app>`, worktree `/Projects/edmat/.claude/worktrees/learn-<letter>-<app>/`,
both created from the prep commit on `ux/mission-nav-tutoring-volunteering` (the branch production
was packed from; `origin/main` is behind it and the publish rule in `CLAUDE.md` still applies).

| Step | API port | Vite port |
|---|---|---|
| A | 8131 | 5231 |
| B | 8132 | 5232 |
| C | 8133 | 5233 |
| D | 8134 | 5234 |
| E | 8135 | 5235 |
| F | 8136 | 5236 |
| G | 8137 | 5237 |
| H | 8138 | 5238 |

(810x/520x were the conference build, 812x/522x the management build; those worktrees still exist
under `.claude/worktrees/mgmt-*` — leave them.)

Making one worktree, from the repo root, after the prep commit `<PREP>`:

```bash
W=/Projects/edmat/.claude/worktrees/learn-a-flashcards
git worktree add -b learn/a-flashcards "$W" <PREP>
cp backend/db.sqlite3 "$W/backend/db.sqlite3"            # migrated main DB, a copy per worktree
ln -s /Projects/edmat/frontend/node_modules "$W/frontend/node_modules"
ln -s /Projects/edmat/.venv "$W/.venv"
printf 'PUBLIC_API_BASE_URL=http://127.0.0.1:8131/api\n' > "$W/frontend/.env"
# The telemetry log shards are separate files the copy above does NOT bring (found by step D,
# 2026-10-05): without this, every write that records an AuditEvent answers 500 AFTER creating
# the row — "no such table: telemetry_auditevent" — which looks exactly like a code bug.
(cd "$W/backend" && for a in logs_0 logs_1 logs_2 logs_3 logs_4 logs_5 logs_6 logs_7 logs_anon; do ../.venv/bin/python3 manage.py migrate --database=$a; done)
```

Two more worktree-only symptoms, so nobody chases them as bugs: the dev server answers **403 for
KaTeX's fonts** (`node_modules` is a symlink outside Vite's `server.fs.allow`; the build bundles
them, so production is unaffected — step H carries the `vite.config.ts` fix), and the backend
logs `no such table: telemetry_requestlog` per request until the shards are migrated.

Each agent runs its own servers on its own ports (brief §Verify), with Node 24 first on `PATH`:
`export PATH=/home/bob/.cache/edmat-tools/node24/bin:$PATH`.

## 4. What context, and where to get it

Three layers. The first is the same for every agent and is listed once here; the brief lists the
second; the third is how an agent answers a question nobody anticipated.

**Always, before the first line** (in this order):
1. `CLAUDE.md` (root) — the contract, house rules 1–14, the flag three-file rule.
2. `backend/CLAUDE.md` and `frontend/CLAUDE.md` — the half-specific traps (SQLite, Svelte 5).
3. `frontend/e2e/CLAUDE.md` — the browser-script traps, before writing or running one.
4. `prompts/00-DESIGN.md` — the design this step is a piece of.
5. `prompts/README.md` §5 — the rules.
6. The three boards.
7. `backend/<app>/CLAUDE.md` for every app named in the brief.

**Per step**: the "Context" section of the brief, each entry a path and the reason it is there.
Line numbers are from 2026-10-05 and may drift; the file is the pointer, the line a hint.

**When stuck**: `CLAUDE_MAP.md` for where something lives; `HISTORY.md` for why (grep the §
named in the brief); `test.md` §5 for how to add a test; `QA.md` for what is known to be weak.
The previous briefs are worked examples of every shape used here: `MANAGEMENT-BRIEF.md` §2 (a
shared seam), `CONFERENCE-BRIEF.md` §3.E (a step with a printable certificate), `CONCEPTS-BRIEF.md`
(an app modelled on another app on purpose).

## 5. Rules for building eight branches at once

1. **One app per step, and no migration outside your app.** A field you want on `Course`,
   `Event`, `Exercise` or `Profile` is a row in your app pointing at it. If you truly need a
   shared schema change, stop and write it on the board.
2. **Feature flags are already seeded** by the prep (`moderation` migration 0047, both frontend
   files, both catalogues). Do not add a key; do not touch `moderation/migrations`.
3. **`config/nodes.py` and `config/creation.py` are read-only** for everyone but F (creation).
   Every "may this person" question goes through them.
4. **Mount points**: replace your own marker line only, in the file the brief names; your import
   goes right after the marker comment in the script block. Do not reorder anything.
5. **i18n keys are prefixed by step** (`decks_*`, `record_*`, `school_*`, `paths_*`, `takehome_*`,
   `gate_*`, `showcase_*`, `guide_*`), one contiguous block at the end of **both** catalogues,
   identical key sets, every `m.*()` call with its `// "Original text"` comment. Recompile
   Paraglide after editing. A key outside your prefix is a merge conflict you caused.
6. **`labels.ts`**: append at the end under a comment naming your backend module; say in
   `models.py` that `labels.ts` mirrors it.
7. **`HISTORY.md`**: append `## 17BR.<letter> …` at the very end with "Verified" (what you ran,
   with numbers) and "Left open". `test.md` gets one paragraph at the end. Root `CLAUDE.md`,
   `CLAUDE_MAP.md` and the app list are the integrator's. Write `backend/<app>/CLAUDE.md`.
8. **Boards**: your `doing.md` entry exists before you start, with your branch and worktree. On
   finishing, move it to the top of `done.md` with the commit hash and what you ran; re-read the
   file immediately before editing and write it in one process. Anything left open goes to
   `todo.md` under "Learning step <letter>".
9. **Verify by running**, from your worktree, on your own ports: `manage.py test <yourapp> config`
   (`--keepdb`; test-DB creation takes ~9 minutes on this tree), `manage.py check`,
   `makemigrations --check --dry-run`, `npm run check` (0/0), `npm run lint`, `npm run build`,
   and your e2e script `frontend/e2e/<name>.mjs` against real servers. Clear
   `backend/cachedata/*` before each e2e run (the login throttle lives in the file cache); never
   run e2e while editing files; never alongside the full backend suite. **Look at the
   screenshot.** Say in the board entry exactly what you ran and the numbers.
10. **Commit on your branch, never push, never merge, never rebase.**
11. **Absolute paths always**; `git -C <worktree>`; `pkill` by PID, never by a pattern that
    appears in your own command line.
12. **No new notification types**; name the ones you wanted in "Left open".
13. **Do not edit another step's app.** A hook another step must wire goes in *your* app as a
    small module the brief names (`<app>/record.py`, `<app>/work.py`), and the integrator registers it.
14. Refusals carry a word (house rule 6); a stranger gets 404 (rule 4); one status field; counts
    recounted; sanitize on write with `config/sanitize.py`; render through the existing renderer;
    lazy-load anything heavy; both catalogues, always.

## 6. Launching

Two ways, both used before:

- **A separate Claude Code session per worktree** (the conference and management builds): open the
  worktree, paste the filled-in brief as the first message. The agent reads the boards itself.
- **The Agent tool from the orchestrating session**: `subagent_type: general-purpose`, the model
  from §2, the brief as the prompt, and the worktree path in the header so every command is
  absolute. The agent's final report is not shown to the owner; relay it. **This is how the
  2026-10-05 launch was done**, from session `d1b7fac5` (the one that respawned the cycle after
  the session that wrote `00-DESIGN.md` ended before writing a brief).

Launch order: A first (others reference its API shapes but do not wait for it), then B–G in one
go, then H (its exercises chapter starts at once; its flashcards chapter after A is merged).

## 7. Integration (`10-integration.md`)

Merge order H, G, F, E, D, C, B, A into `ux/mission-nav-tutoring-volunteering`, migrate the main
database **before** any e2e, register the record and work providers, add permission-matrix rows,
update `CLAUDE.md` (apps 34 → 35, flags 28 → 31), `CLAUDE_MAP.md`, `test.md`, run the whole
suite, the e2e scripts, `check:a11y`, write the `HISTORY.md` §17BR preamble, then the replay onto
`origin/main` per the publish rule. Ask before any push.

## 8. What the previous two runs taught (so nobody relearns it)

- Pre-registering the apps and putting the shared rule in one module **in the prep** is what
  reduced shared edits to one line; keep doing it.
- Migrate the main DB after merging any branch with a new model before e2e, or 500s look like
  regressions.
- The union resolver drops a line when both sides end with the same text; Prettier after merge.
- The register endpoint is throttled per process; sign in as seeded users (`password123`).
- `waitUntil: 'networkidle'` never fires on an authenticated page (the SSE stream).
- An agent that says "verified" without numbers has not verified.

## 9. Decisions taken at launch (2026-10-05, the integrator) — the briefs are written to these

- **A placed deck is studyable by everyone who can view the node** it is placed on; `is_public`
  (world-readable) stays off and a minor cannot set it. `00-DESIGN.md` §4.1 said "private only";
  read literally it would have made the lesson/session/concept buttons produce decks nobody but
  their maker could open. Placement is this cycle's sharing; a public deck library is the next.
- **Decks are addressed by numeric id** (`/flashcards/[id]`), like every non-taxonomy object
  (`CLAUDE.md` API conventions); the random slug in the first analysis was for a share link that
  this cycle does not have.
- **`creation_requires_verification` is a `FeatureFlag` row, inverted, seeded ON** — a moderator
  flips it, not a deploy. `is_feature_enabled` fails open, which for an inverted flag is the safe
  direction (the restriction holds if the row is somehow missing).
- **The Add… menu holds only events and listings now**; courses and organisations are founded
  from their hubs (owner decision 2026-10-01), so F gates the hubs' buttons the same way.
- **C, D and E verify their "make a deck" buttons against a mocked `POST /api/decks/`** and say
  so; the real call is verified at integration, after A merges.

---

## 10. The closing cycle (2026-10-06) — `11-closing-design.md` and briefs 12–17

The learning cycle merged on 2026-10-06 (`4a57d6d`) and left two blocks at the top of `todo.md`.
The closing cycle turns them into five branches, built the same way as above with one difference:
**there is no prep commit**, because nothing new is registered, flagged or migrated
(`11-closing-design.md` §3). Everything else in §1–§8 of this file still applies, and §4 of the
design file is a per-file ownership table that is this cycle's one new rule.

| Step | Brief | Branch | Ports | Closes |
|---|---|---|---|---|
| A test shards | `12-test-shards.md` | `close/a-test-shards` | 8141 / 5241 | `--parallel 4` does not work; 137 test classes lack `databases` |
| B seams | `13-seams.md` | `close/b-seams` | 8142 / 5242 | two `lessons_done` providers (keep C's — owner, 2026-10-06); two missing matrix rows |
| C manual chapter | `14-manual-flashcards.md` | `close/c-manual-flashcards` | 8143 / 5243 | the flashcards chapter is still the placeholder |
| D browser pass | `15-browser-pass.md` | `close/d-browser-pass` | 8144 / 5244 | `flashcards.mjs`, `check:a11y` over the showcase, never run |
| E discussions | `16-discussions.md` | `close/e-discussions` | 8145 / 5245 | the §17BS left-opens; the one file Prettier rejects |
| integration | `17-closing-integration.md` | the orchestrating session | — | merge order C, D, B, E, A |

Every step on Opus 5. Launch A and E first, then B, C, D together (`11-closing-design.md` §6).
HISTORY section for the cycle: **§17BT**, one `## 17BT.<letter>` per step, appended at the end.

**Outcome (2026-10-07, integrated as `HISTORY.md` §17BT):** all five landed and were merged as they
landed (owner's call) — E `4d1f209`, D `1e2d775`+`e5ddf81`, B `a2eabd3`, C `06a6d05`, A `ac2bf0f` —
with no migration from any of them and every conflict the "both appended" kind. The three numbers:
`manage.py test --parallel 4 --keepdb` completes (2700 tests, 21 min, 198 lines of output);
`npm run lint` is clean over the whole tree; `check:a11y` audited 48 pages with 0 violations on the
nineteen new ones. `flashcards.mjs` 43/0, `about-discussions.mjs` 35/0, `guide-screenshots.mjs` 63/0
(50 pictures, 2.39 MB), `learning-record.mjs` 52/0, `about-page.mjs` 15/0 after its counts were set
to the page — all on the main checkout's servers.

What the board said on 2026-10-06 and what was true an hour later, for the record: `todo.md` claimed
`npm run lint` was red on four files and six eslint errors. At `4a57d6d` eslint is clean and
Prettier rejects exactly one file, `e2e/about-discussions.mjs` — the §17BS commit fixed the rest
without saying so. The lint sweep is therefore one line of step E, not a step of its own.

## 11. Contests (2026-10-09) — `CONTESTS-BRIEF.md` and briefs 18–19

The owner's ask of that afternoon: *"add contests. personalize all current modules to this use
case. each subagent can have 1 haiku. research law for konkursy in poland and add presets with
making it possible by prefilling with current users"*, with the interface built by an Opus agent and
its tasks spelled out. The law was researched first (`CONTESTS-LAW.md`, a sourced note with every
claim marked verified / secondary / unverified / disputed); the prep turned it into
`contests/presets.py` (ten presets, the 12-section regulamin, a 24-item legal checklist, a `LAW`
table with markers) and the seam of `CONTESTS-BRIEF.md` §2; then two branches at once:

| Step | Brief | Model | Owns |
|---|---|---|---|
| prep | `CONTESTS-BRIEF.md` §2 | the orchestrating session (Fable 5.1) | flag 0053, the app skeleton, the node kind, the creation kind, the attachment target, the markers, the presets |
| A core + interface | `18-contests-a-core.md` | Opus | `contests/` (minus presets, personalize), `routes/contests/**`, the fourteen interface tasks |
| B personalise | `19-contests-b-personalise.md` | Opus | `presets.py`, `personalize.py`, every registry in every other app, `/about/contests`, the manual chapter, `LEGAL.md`, the labels |
| integration | `CONTESTS-BRIEF.md` §5 | the orchestrating session | merge B then A, mount B's panels at A's markers, the matrix rows, the counts |

Ports 8171/5271 (A) and 8172/5272 (B). Each agent may spawn **one Haiku** for a bounded side task
and must re-run whatever it reports — §2's rule about Haiku stands. The two cross-branch seams are
stubs the prep wrote with the signature fixed: `personalize.apply_preset` (A calls, B writes),
`work.work_items` and `record.placements_for` (A writes, B registers).

## 12. Sub-exercises (2026-10-21) — `SUBEXERCISES-BRIEF.md` and briefs 20–22

**Integrated the same day** (`HISTORY.md` §17CV): A, B, C merged in that order onto
`fix/analytics-after-deploy`, the stand-ins in `e2e/exercise-parts.mjs` replaced by the real round-trip
(65/65), the importer given A's `MAX_PARTS`, paczka4 rehearsed and packed as `UPDATE-20261021-d`.

The owner's yes of that afternoon: *"go ahead and build the sub-exercises. spawn opus agents to go
through prompts dir"*. The design is `SUBEXERCISES-BRIEF.md` (written the same day, on the owner's
"analyze exercises that are small sets of exercises — e.g. edmat.net/exercises/964"); its §6 build
order became one prep commit and three branches at once, on **this** machine
(`/home/piotr/Projects/edmat`, not the VM the older sections name — Node is at
`~/.local/opt/node-v24.22.0-linux-x64/bin`, Chromium needs the `LD_LIBRARY_PATH` line in each brief,
and the venv is the repo's `.venv`).

| Step | Brief | Branch | Ports | Owns |
|---|---|---|---|---|
| prep | this section | `fix/analytics-after-deploy` (the orchestrating session, Fable 5.1) | — | `ExercisePart`, `ExercisePartTranslation`, `SolutionEntry.part`, `EditSuggestion.part`, the two migrations, `exercises/parts.py`, `parts` on the detail, `part` on entries (read and POST), the frontend types/mappers/service, two tests |
| A backend | `20-parts-a-backend.md` | `parts/a-backend` | 8181 / 5281 | every backend file in `exercises/`, `moderation/`, `licensing/` EXCEPT the importer and its test |
| B import | `21-parts-b-import.md` | `parts/b-import` | 8182 / 5282 | `exercises/management/commands/import_exercises.py`, `exercises/test_import_parts.py`, `.claude/skills/import-exercises/**`, `Database-of-Student-Exercise/paczka4/`, the presentations repo's `edmat/` files |
| C page | `22-parts-c-page.md` | `parts/c-page` | 8183 / 5283 | everything under `frontend/` |
| integration | §12 below | the orchestrating session | — | merge A, B, C; migrate; the real PATCH round-trip; `pack.sh` paczka4 section; `CLAUDE.md`, `CLAUDE_MAP.md`, `test.md`; HISTORY §17CV preamble; the kit |

Every step on Opus (the owner's words), no Haiku. Shared files: `HISTORY.md` (each appends
`## 17CV.<letter>` at the very end), `test.md` (one paragraph each at the end), the boards. The one
cross-branch seam is C's edit form against A's `PATCH parts` — C verifies the payload with a
`page.route` interception and says so; the integrator runs the real round-trip after the merge
(the §9 pattern: "verify against a mocked POST, say so"). B's importer needs A's `verified` clause
to be right for a set, but calls the same `recount_verified` it always did, so nothing in B waits.

Integration order: A, then B, then C (B's kit rehearsal and C's real round-trip both need A's
rules). After the merge: migrate the main DB and the nine log shards, run
`manage.py test exercises moderation licensing`, `check_databases_declared`, `npm run check`,
lint, build, `e2e/exercise-parts.mjs` with the interception removed, `e2e/exercise-edit.mjs`
(must still pass), `check:katex`, then the paczka4 rehearsal on a DB copy, `pack.sh` with a
paczka4 section and apply-on-server step 10, `UPDATE-2026-10-21.md` `-d`.
