# config — settings and the four cross-cutting modules

`settings.py`, `urls.py`, `cachemw.py` (anonymous-read response cache), `sanitize.py` (bleach
write-side sanitizer), `i18n_utils.py` (translation resolution/fallback — used by every
translated serializer; define fallback ONCE, here), `dbsearch.py` (+ its own tests).

## settings.py — what matters

- `SECRET_KEY`/`DEBUG`/`ALLOWED_HOSTS`/`CSRF_TRUSTED_ORIGINS` env-driven. CORS is load-bearing
  (separate-origin SPA) — `run.sh` passes the chosen origin through; a hand-changed port
  silently breaks the site with "Something went wrong".
- `EMAIL_BACKEND` = console. No real mail anywhere; password reset is an honest always-200 stub.
- `TIME_ZONE='Europe/Warsaw'` (owner, 2026-10-15; it was `'UTC'` until then — root `CLAUDE.md`,
  known gaps, lists what reads it), and **no per-user timezone exists anywhere** —
  `Profile.time_format`/`week_starts_on` are display preferences only. Stored datetimes are UTC
  regardless (`USE_TZ`); DRF writes them out at the Polish offset.
- `DEFAULT_PAGINATION_CLASS` deliberately unset (every list bounded by construction).
- `DATABASE_ROUTERS = ['telemetry.routers.LogShardRouter']` — log shards, see telemetry app.
- SQLite `OPTIONS['timeout']=20` is a real fix for concurrent-writer contention, not a guess.
- Feature-relevant env: `EDMAT_REDIS_URL` (unset = file cache + polling SSE; set = shared
  throttles + shared response cache + pub/sub SSE), `MATERIAL_SCAN_REQUIRED` + `CLAMD_*`,
  `EDMAT_OAUTH_CLIENTS`/`EDMAT_USOS_CREDENTIALS` (empty = identity providers report themselves
  as drafts), `EDMAT_USOS_MOCK`, `EDMAT_LOG_SHARD_*`, `EDMAT_CACHE_*`, `EDMAT_REPOSITORY_URL`.
- Throttle rates in `DEFAULT_THROTTLE_RATES` are per-process without Redis (documented caveat,
  here and in `accounts/throttles.py`). Global anon/user backstops are deliberately loose — one
  exercise page fires several requests; don't tighten them to "sensible" API defaults.

## cachemw.py — the anonymous-read response cache

Admission is the owner's policy verbatim: an anonymous GET on a positive-list prefix is only
STORED after its exact URL missed twice; the bar rises to 7 when the minute's anonymous traffic
passes 120 rpm. TTL 60s; **writes never invalidate** (stated trade — sub-minute staleness beats
an invalidation protocol). That trade holds for CONTENT and broke exactly once, on the CONTROL
PLANE: `/api/feature-flags/` was on the allowlist, so a moderator could kill a feature and every
logged-out visitor kept being shown it, links and all, for up to 60s — house rule 3's whole
point, lost to a cache. It is off the allowlist now (2026-09-19); pinned by
`AnonymousReadCacheTests.test_the_feature_flag_list_is_never_cached`, because putting it back
breaks no other test and the symptom reads as flakiness rather than a bug. Nothing else here is
a control plane; if something becomes one, it does not belong on this list either. Gates are about WHO asks: any `Authorization` header or session
cookie disqualifies in both directions; a `Set-Cookie` response is never stored; **exercise
detail is carved out** because `retrieve()` records the `ContentView` rows auto-hide divides by
— a cache hit would silently stop counting anonymous readers. `X-EdMat-Cache: miss/stored/hit/
skip` on every response — keep every decision observable. Speaks Django's cache API only, so the
identical logic runs on the file cache; Redis makes it shared, not different.

## sanitize.py

The bleach allowlist matches what the frontend's markdown-it/KaTeX pipeline actually emits.
Every user-text write path goes through it — the API is an independent entry point; DOMPurify
client-side is the read layer, never the only one. Widening the allowlist is a security
decision, not a convenience.

## creation.py — the creation gate (learning step F, 2026-10-05)

The one rule module for "may this account FOUND something here?", asked by four `create` paths
(`courses`, `events`, `services`, `organizations`) and by `GET /api/creation/`, which is what the
header's Add… menu and the four hubs draw themselves from. **Nothing else is gated**: reads, joins,
enrolments, attendance, bookings and everything already created never ask it.

- Three refusal words, in this order: `anonymous` → (staff pass) → `minor` → `verification_required`.
  The order is the point and the module's docstring argues each step; the short version is that only
  the last one answers to a flag, and only the last one goes away when USOS lands.
- `creation_requires_verification` is **INVERTED** (on = the restriction is on) and read with plain
  `is_feature_enabled`, not `feature_gate` — it removes a RULE from endpoints everybody must still
  reach, exactly like `age_verification` on registration. It fails OPEN, which for an inverted flag
  means the restriction HOLDS when the row is missing: the safe direction, and the same reversal
  `coauthoring/services.py` documents for `material_uploads_verified_only`.
- `Profile.is_verified_contributor` is the only signal. `identity/standing.py: ceiling_for` is a
  different axis and must not be read here (`LAUNCHCHECKLIST.md` §3: standing is a ceiling, never
  authority).
- It widened one existing rule on purpose: `courses` had no minors check, so founding a course is
  now closed to an under-16 like hosting an event and listing tutoring already were
  (`HISTORY.md` §17BR.F).
- Tests: `config/test_creation.py` — the five-persona × flag × four-kind table, one request-level
  test per create path, and the endpoint. **Six existing suites founded things through the API as
  ordinary accounts and had to move**: `courses/tests.py`, `events/tests.py`, `services/tests.py`,
  `services/test_location.py`, `organizations/tests.py` and one test in
  `exercises/test_sorting_locale.py` now make their fixture a verified contributor, each with a
  comment pointing here; and `events/test_permission_matrix.py` has two rows whose answer the gate
  changed (`stranger POST /events/` and `attendee POST /organizations/`, 201 → `(403,
  verification_required)`). If a seventh suite starts failing with `403 verification_required`, that
  is this rule, not a regression in the app under test.

## Verify

`manage.py check`, `manage.py test config telemetry` (cachemw tests live in telemetry),
`makemigrations --check --dry-run`.
