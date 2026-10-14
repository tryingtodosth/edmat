# telemetry — request logging, audit, log shards, cache preloading

`RequestLog`, `AuditEvent`, `middleware.py` (the request logger — and the source `analytics/` rolls
up into aggregates), `routers.py`
(`LogShardRouter`, wired in settings' `DATABASE_ROUTERS`), `checks.py`, and
`management/commands/preload_cache.py`.

## Invariants

- Logs write to **separate SQLite shard databases** (`logs_*` under `backend/logdata/`, sized by
  `EDMAT_LOG_SHARD_SIZE`/`_COUNT`) — never the main DB. The **anonymous shard (`logs_anon`) is
  kept apart** and is what `preload_cache` reads to pick URLs to warm.
- **Query strings are redacted by design** — a search term is the visitor's content. Consequence:
  the preloader never replays query strings; don't "improve" it into doing so.
- `preload_cache` warms the taxonomy base set (both locales) + top-N anonymous GET paths,
  fetched **through the full middleware stack** and seated via `config/cachemw.py`'s own
  `store()` with admission deliberately bypassed; same TTL as organic entries (a head start,
  never a staleness extension). Traps already paid for: it must degrade loudly-but-gracefully
  when the `logs_anon` shard is missing/unmigrated, and it must use a host from `ALLOWED_HOSTS`
  (the test client's `Host: testserver` 400s outside the test suite — an all-failures run once
  read as success). Its output separates "off-list" from "failed fetches"; keep that.
- **`RequestLog.analytics_opt_out`** (2026-10-14): set when the request carried `Sec-GPC: 1` or
  `DNT: 1` (exact value `1`; `middleware.objects_to_analytics`), read as a GDPR Art. 21 objection to
  analytics. The row is still WRITTEN — the objection is to statistics, not to the security log — and
  every rollup in `analytics/` skips it. Per request, never remembered: remembering it would need a
  visitor identifier. `db_default=False`, so a process on the old model can still insert while a shard
  is migrated. Basis for the statistics: art. 6(1)(e), 6(1)(f) as fallback — `ANALYTICS-LAW.md` §4.
  `test_ip_is_the_only_directly_identifying_field` lists it; `AnalyticsObjectionTests` pins it.
- **Retention is now scheduled**: `deploy/cron/edmat-analytics` runs `analytics`' rollup and THEN
  `enforce_log_retention` nightly (rollup first — a day can be recounted only while its rows exist).
  Before that file nothing in the repository ran `enforce_log_retention`.
- The anonymous-read response cache tests live here (`AnonymousReadCacheTests`) even though the
  middleware is `config/cachemw.py` — admission ladder, busy-traffic bar, auth-disqualification
  both directions, the exercise-detail carve-out, preloader seating.

## Verify

`manage.py test telemetry`. Runtime data dirs `backend/logdata/` and `backend/cachedata/` are
gitignored runtime state — don't commit, don't assume present on a fresh clone.
