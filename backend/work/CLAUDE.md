# work — personal work dashboard (MANAGEMENT-BRIEF.md §3.F, §4)

No models, no migrations. A provider registry and a single GET endpoint that aggregates work items
from every module, showing the user everything waiting on them in one place.

## The provider contract

A provider is a function `(user) → list[dict]`. Each dict carries exactly seven keys
(`providers.ITEM_KEYS`):

- `kind`: a short word ('event', 'course_request', 'proposal', 'shift', 'booking', …)
- `title`: human-readable label
- `url`: a FRONTEND path (e.g., '/events/12')
- `due_at`: ISO timestamp or None
- `status`: the row's own word ('hosting', 'pending', 'going', etc.)
- `urgency`: 0–3 (0 = none, 1 = this month, 2 = this week, 3 = overdue/today)
- `node`: the output of `config.nodes.node_ref(node, user)` or None

To register a provider at integration:

```python
# In your app's work.py:
from work.providers import register

def work_items(user):
    # return list of dicts, each with the seven keys above
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
