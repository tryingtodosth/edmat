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

Sections appear in a fixed order, defined in `providers.collect()`:

1. `event_hosting` (events I host)
2. `event_attendance` (events I'm going to)
3. `course_request` (courses with pending enrollments)
4. `proposal` (materials with pending versions)
5. `shift` (upcoming shifts)
6. `booking` (upcoming tutoring bookings)
7–12. The four management apps (tasks, needs, plans, decisions) — added by the integrator

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

Run: `manage.py test work config`
