# work — personal work dashboard (MANAGEMENT-BRIEF.md §3.F, §4)

No models, no migrations. A provider registry and a single GET endpoint that aggregates work items
from every module, showing the user everything waiting on them in one place.

## The provider contract

A provider is a function `(user) → list[dict]`. Each dict carries exactly eight keys
(`providers.ITEM_KEYS`):

- `kind`: a short word ('event', 'course_request', 'proposal', 'shift', 'booking', …)
- `title`: human-readable label
- `url`: a FRONTEND path (e.g., '/events/12')
- `due_at`: ISO timestamp or None
- `status`: a **CODE** from `providers.STATUS_CODES[kind]` ('hosting', 'pending', 'todo', 'due', …)
  — never a sentence and never English
- `count`: an int ≥ 1 for the kinds in `providers.COUNTED_KINDS` (a row standing for several
  things: requests waiting, versions to review, applications to decide, cards ready, submissions
  to score), else None
- `urgency`: 0–3 (0 = none, 1 = this month, 2 = this week, 3 = overdue/today)
- `node`: the output of `config.nodes.node_ref(node, user)` or None

**Why code + count (2026-10-15).** `/work` printed `item.status` verbatim and the providers sent a
mix of codes (`in_progress`, `sole_owner`) and preformatted English (`'3 due'`, `'2 pending'`,
`'5 waiting'`), so a Polish reader got raw words and English — house rule 1. Now the frontend owns
the words: `frontend/src/lib/utils/labels.ts: WORK_STATUS_CODES` / `WORK_COUNTED_KINDS` mirror the
two declarations (house rule 13, named in both files) and `workStatusLabel(kind, status, count)`
draws them, the counted ones as Paraglide plural messages (`workStatus_*`, the repo's first plural
keys — `one`/`few`/`many` in Polish). **An undeclared code reads "Status unknown"**, never raw.
**Adding a code** means: add it to `STATUS_CODES` (or the kind to `COUNTED_KINDS`), add its words in
`labels.ts` and both catalogues. `StatusVocabularyTests` fails on a provider that emits anything
undeclared — it builds one world with a row of every kind and holds every row to
`providers.item_problems` — and on a declared set drifting from the model enum it was copied from.

**`organizations/work.py` is written but NOT registered** — nothing in `builtin.py` or
`integrations.py` calls `register(...)` for it, so the sole-owner row never reaches `/work`. Its
`sole_owner` code is declared and labelled anyway, and the vocabulary test calls it directly, so it
is right on the day somebody registers it (and adds a `work_section_organization` label).

To register a provider at integration:

```python
# In your app's work.py:
from work.providers import register

def work_items(user):
    # return list of dicts, each with the eight keys above
    ...

register('<section_key>', '<feature_flag_key>', work_items)
```

Two lines: the function and the registration. That is the seam the integrator wires at
MANAGEMENT-BRIEF.md §5.

## Provider ordering

Sections appear in a fixed order, `providers._SECTION_ORDER`:

1. `event_hosting` (events I host)
2. `event_attendance` (events I'm going to)
3. `course_request` (courses with pending enrollments)
4. `proposal` (materials with pending versions)
5. `shift` (upcoming shifts)
6. `booking` (upcoming tutoring bookings)
7–12. The four management apps (tasks, needs, plans, decisions) — added by the integrator

**This list is ordering ONLY, not a gate.** `collect()` runs every key actually in `_REGISTRY`,
not just the ones named here — a key registered but not (yet) in `_SECTION_ORDER` still runs and
is simply appended after the known ones. An earlier version of `collect()` iterated
`_SECTION_ORDER` and skipped anything not in it, which silently dropped any provider registered
under a key this list did not already know — including, in the isolation test, the raising
provider itself, which meant the test only PASSED because the provider it registered never ran at
all (`test_raising_provider_is_isolated`, fixed 2026-09-24). Keep new integration keys added to
`_SECTION_ORDER` for their fixed position, but do not rely on that list to decide what runs.

## Built-in providers (this step)

`builtin.py` registers six providers, one per existing app. Each reads only its own models,
runs behind its own feature flag, and appears as one of the first six sections above.

A provider that raises is caught, logged with `logging.getLogger(__name__).exception(...)`,
and reported in the response's `unavailable` list — house rule 10 (flag it, don't fake it).
The page shows a quiet line for it.

## The endpoint

`GET /api/work/` (authenticated, behind `feature_gate('work_dashboard')`):

```json
{
  "sections": [
    {
      "key": "event_hosting",
      "items": [
        {
          "kind": "event",
          "title": "...",
          "url": "...",
          "due_at": "...",
          "status": "hosting",
          "count": null,
          "urgency": 2,
          "node": {...}
        }
      ]
    }
  ],
  "unavailable": ["provider_key_that_raised"],
  "generated_at": "2026-09-24T..."
}
```

## Tests

- Anonymous → 401
- A raising provider is isolated and named in `unavailable`
- A provider behind an off flag is skipped silently
- Each builtin provider returns sensible rows for small fixtures
- `StatusVocabularyTests`: no provider emits a status outside its declared code set

Run: `manage.py test work config` — 10/10 (`work`) + 45/45 (`work config`), `manage.py check`,
`makemigrations --check --dry-run` all clean as of 2026-09-24.

## Frontend: `/work`, `lib/services/work.ts`, `lib/types/work.ts`, `UrgencyDot.svelte`

`getWorkDashboard()` calls `apiClient.get('/work/')` — **no leading `/api/`**: `apiClient` already
prepends `PUBLIC_API_BASE_URL`, which itself ends in `/api` (`lib/services/nodes.ts` is the
pattern to copy). A stray `/api/` prefix doubles into `/api/api/work/`, a 404 that a component
swallows into the generic `work_error_loading` message — nothing in `svelte-check`, `eslint` or a
static build catches this; only a real request does (house rule 2), which is what `e2e/work.mjs`
found. A `WorkItem.node`'s URL is built from `node.kind` (`config/nodes.py: NODE_KINDS` — 'course',
'event', 'material', singular) against the frontend's plural routes (`/courses`, `/events`,
`/materials`); `+page.svelte`'s `NODE_ROUTE_PREFIX` map is the singular→plural translation — do not
build a node link as `/{node.kind}/{node.id}` directly.

The node link is a **sibling** of the item's `<button>`, not nested inside it — a `<button>` may
not contain interactive content (an `<a>` would be invalid HTML and ambiguous to both a click and
a screen reader), so the two share a `.item-card` wrapper for the visual border/background instead.

## e2e

`e2e/work.mjs`: kasia gets a real event created through the API within the 14-day window and sees
it in "Events I'm hosting" (urgency dot, due date, working node link, cross-checked against
`GET /api/work/` directly so a browser-side failure is known to be a rendering bug and not a
missing fixture); a second account whose OWN `/api/work/` is probed empty (or, failing that, a
freshly registered scratch account) sees the whole-page "Nothing is waiting on you" state. The
per-SECTION empty state (`work_section_empty`) is NOT exercised — `collect()` never appends a
section with zero items (`if items: sections.append(...)`), so that branch in `+page.svelte` is
unreachable through the real API; documented as dead defensive code rather than a script gap.
15/15 checks passing as of 2026-09-24 (`E2E_BASE=http://localhost:5226 E2E_API=http://127.0.0.1:8126
node e2e/work.mjs`).

## `edmat_project.py`, `edmat_history.py` and the two commands — EdMat managed on EdMat (2026-10-07)

The owner's direction of 2026-10-07: the project is run on the platform, as an open volunteer
cooperative, with one goal per module and the project's own history imported with its dates.
`work/edmat_project.py` is the content; `manage.py seed_edmat_project --owner <username>` writes
it, idempotently by title (a plan, task, need by title on the node; a step by title on its plan; a
poll by question; a comment by its bold first line): a second run refreshes the text and leaves
status, assignees, applications, ballots and who-marked-what alone. It lives here and not in
`organizations/` because it imports every management app, which `organizations` must not do at
module level (`config/nodes.py` dispatches to `organizations`). It is NOT demo data: no
`FAKE_PREFIX`, no `testing/`. What it writes, and the rule behind each choice:

- **A goal is a plan** (`SUBPROJECTS`, fifteen: one per module, `/dziennik` among them). EdMat
  has no project tree; a plan has a summary, steps with one level of nesting, `done_at`, a
  suggestion box and a panel that already draws "N of M steps". Its done steps are the sections of
  `HISTORY.md` filed under it — `work/edmat_history.py` parses the log, `SUBPROJECT_BY_REF` files
  each section by hand (a keyword guess would be wrong too often), and `manage.py
  export_edmat_history` writes `work/edmat_history.json` with a date per section (from the
  heading, else the first commit carrying it, else "no later than the repository's first commit").
  **The JSON ships; `HISTORY.md` does not** (`deploy/fuw/pack.sh` rsyncs `backend/` only), so
  re-run the export when the log grows — `EdmatHistoryTests` fails when the table is behind, and
  a section not in the map lands in `platform` with a warning.
- **The association is RETIRED (owner, 2026-11-02: *"delete stowarzyszenie related ones"*;
  `HISTORY.md` §17DD).** It was three plans (the phases of `FUW/association/07`), phase 1 mirrored
  into tasks with deadlines counted from a founding date and a KRS entry, a "Founders" need, a poll
  on founding it, a founding-meeting event and the Gemini legal-report thread under
  `/about#money-and-openness`. **`RETIRED` is how something leaves**: the seed is idempotent by
  title, so an entry dropped from the file stays on every database it was ever written to. Each run
  deletes the rows `RETIRED` names — only on the EdMat node, only by the exact title the seed wrote
  (glued or its Polish half) — with their threads, sub-tasks, ballots and applications, and prints a
  `retired …` line per row; a database that never had them retires nothing. Hard deletion by the
  owner's word, not archiving; step 0 of the apply script is the way back.
- **`seed_edmat_project --dry-run`** does the whole run in a transaction it rolls back, so the
  printed list (the retired rows included) is exact; **`--owner` is needed only the first time** —
  later runs reuse the organisation's existing owner. `deploy/fuw/apply-on-server.sh` step 12 is
  exactly that: dry run, `[Y/n]`, run.
- **The polls are the owner's open questions, put to the members** (`POLLS`): the AI-assisted
  score, and since 2026-11-02 the five decisions §17DB–§17DC left open (a new course's suggested
  licence, when a course's licence may be widened, courses on the licences page, a restricted file
  only for a signed-in reader, the legitimate interest behind e-mail invitations). Each describes
  what the site does TODAY. Every title and option holds exactly one `' / '`.
- **The board is open** (`ORGANIZATION['open_board']`, 2026-10-08): anyone who can see the
  organisation reads its plans, tasks, needs and polls; the roster and its members vote and edit.
- **Two research accounts** (`ACCOUNTS`: `google-gemini`, `anthropic-claude`, no usable
  password, a bio that says what they are). `anthropic-claude` signs the project threads
  (`work/edmat_project_threads.json`: one comment per item under a plan found by its title, or under
  the organisation's own thread). `google-gemini` posted the legal report, which went with the
  association; the account stays. A `discussionLocation` comment creates no activity row
  (`activity/signals.py`), so the feed is not flooded.
- **No personal data, ever.** Nothing names a founder, a Faculty official, an office or a sum;
  people are roles or counts. `all_seeded_text()` + `SECRET_SHAPES` and the test that runs them
  over the module and the two JSON files are the gate — extend the shapes before you extend the text.
- **Both languages in one field**, Polish first, a rule, then English: no management row has a
  translation table. History steps quote the English log as written. Whether project content
  should get a locale axis is on the board ("EdMat on EdMat").
