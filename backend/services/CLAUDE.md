# services — tutoring listings and OSM locations

`Service` (provider, title, description, branches M2M, rate + currency — **display-only, no
payment processing anywhere**, `is_active`, `delivery_mode`, coordinates + label,
`availability_mode`, `session_minutes`), `ServiceReview`, `ServiceWatch`. The frontend service
file is `lib/services/tutoring.ts` (deliberately not `services.ts` — self-referential path).

## Invariants

- `delivery_mode` is ONE choice field (`online`/`in_person`/`hybrid`), never two booleans (which
  make "attendable by nobody" representable). **Hybrid matches BOTH filters**, not neither.
- Mode↔location consistency runs in BOTH directions in `ServiceWriteSerializer.validate`:
  in-person/hybrid without coordinates → rejected; switching back to online **clears** the pin
  (a stale pin renders a map for somewhere the tutoring no longer happens — worse than nothing).
  On PATCH, read the mode from the *instance* when not supplied.
- `CoordinateField` **rounds** excess decimal precision instead of rejecting it — Nominatim
  returns 7+ decimals, the model stores 6, and DRF's DecimalField rejects by default (the
  frontend once got a 400 echoing back a value the API itself had handed it).
- Owner-scoped writes via queryset (non-owner → 404); `?mine=true` includes paused listings the
  public browse never shows. Deleting a listing with an upcoming booking is **409** (pausing is
  the alternative) — that check imports from `booking` locally, the one place the dependency
  runs backwards; keep the import local.
- Behind the `tutoring` FeatureFlag (reads too).

## Geocoding (`geocoding.py`) — proxied server-side, for policy reasons, not convenience

Nominatim's policy demands an identifying User-Agent (a browser `fetch()` cannot set one — it
would arrive as anonymous traffic and get the whole app blocked), a 1 req/s cap for the WHOLE
application (only a server-side gate can enforce that: `cache.add` as an atomic mutex, with a
bounded ≤1.5s wait-and-retry because "search then nudge the pin" is two lookups under a second
apart), and caching (24h, including empty results). Cache keys are **hashed** — raw addresses
contain spaces, which LocMem tolerates and memcached rejects. `GET /api/geocode/` is
authenticated + throttled (it spends a shared third-party budget). Uses stdlib `urllib.request`,
not `requests` (not a dependency — keep it that way). Attribution travels WITH the data.
Tests patch `_fetch` — the suite must never hit the real Nominatim.

## `?near=` filtering

Two stages: a lat/lon bounding box in SQL (SQLite has no GIS), then an exact haversine pass —
the box is not a circle (corner results up to ~41% too far; a test pins this). Longitude width
scales by 1/cos(latitude), clamped. Malformed `near=` degrades to unfiltered, never errors.

## Verify

`manage.py test services` + `test_location.py`. E2E: `tutoring-modals.mjs`,
`tutoring-cache.mjs`.

## The description renders (2026-10-01)

Asked for as "allow adding chemistry, latex, having hrefs". `ServiceForm` now uses `RichEditor` +
`InsertStrip` — the same input every other prose field on this site has — and `ServiceCard` draws
the field through `MathContent` instead of printing it. Links came free: `<a href>` has always been
in the bleach allowlist; what was missing was anything that RENDERED the field.

Rendering it makes it an injection surface, so **`Service.save()` sanitizes `description`** in the
same change (house rule 8 — the API is a second entry point no DOMPurify ever sees).
`ServiceDescriptionSanitizeTests` is the refusal set that widening owes: a script tag, an event
handler, a `javascript:` URI, a surviving plain link, untouched LaTeX delimiters, a chemistry
drawing that keeps the `class` §17AV once lost silently, and the PATCH path as well as the POST.
`title` is deliberately left alone — it still renders escaped, and sanitizing it would mangle an
honest "a < b".

`allowFiles` is off on the strip: a listing has no attachment table.

## The route is `/tutoring`, and `/korki` in Polish (2026-10-01)

Owner's call, and a deliberate exception to the root `CLAUDE.md` rule that URL segments are neutral
English. **The Django app, its models and `/api/services/` are unchanged** — only the frontend route
moved, from `routes/services/` to `routes/tutoring/`, with the Polish address coming from
Paraglide `urlPatterns` in `frontend/vite.config.ts` and the existing `hooks.ts` reroute. A browser
script calling `api('/services/')` is still correct; one calling `page.goto('/services')` is not.
