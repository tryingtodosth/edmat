# telemetry — request logging, audit, log shards, cache preloading

`RequestLog`, `AuditEvent`, `middleware.py` (the request logger), `routers.py`
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
- The anonymous-read response cache tests live here (`AnonymousReadCacheTests`) even though the
  middleware is `config/cachemw.py` — admission ladder, busy-traffic bar, auth-disqualification
  both directions, the exercise-detail carve-out, preloader seating.

## Verify

`manage.py test telemetry`. Runtime data dirs `backend/logdata/` and `backend/cachedata/` are
gitignored runtime state — don't commit, don't assume present on a fresh clone.
