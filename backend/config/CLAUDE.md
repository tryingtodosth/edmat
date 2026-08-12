# config — settings and the four cross-cutting modules

`settings.py`, `urls.py`, `cachemw.py` (anonymous-read response cache), `sanitize.py` (bleach
write-side sanitizer), `i18n_utils.py` (translation resolution/fallback — used by every
translated serializer; define fallback ONCE, here), `dbsearch.py` (+ its own tests).

## settings.py — what matters

- `SECRET_KEY`/`DEBUG`/`ALLOWED_HOSTS`/`CSRF_TRUSTED_ORIGINS` env-driven. CORS is load-bearing
  (separate-origin SPA) — `run.sh` passes the chosen origin through; a hand-changed port
  silently breaks the site with "Something went wrong".
- `EMAIL_BACKEND` = console. No real mail anywhere; password reset is an honest always-200 stub.
- `TIME_ZONE='UTC'`, and **no per-user timezone exists anywhere** — `Profile.time_format`/
  `week_starts_on` are display preferences only.
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
an invalidation protocol). Gates are about WHO asks: any `Authorization` header or session
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

## Verify

`manage.py check`, `manage.py test config telemetry` (cachemw tests live in telemetry),
`makemigrations --check --dry-run`.
