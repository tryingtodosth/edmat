"""**There is deliberately no admin page for the request log or the audit trail.**

Both models live on the log SHARDS (`telemetry/routers.py` — `logs_1 … logs_7`, `logs_anon`), not
on `default`, and Django's admin reads one database. A registered `RequestLogAdmin` therefore opens
to `OperationalError: no such table: telemetry_requestlog`, which is what the first version of this
file did on 2026-10-08 — registered, `manage.py check` clean, and broken the moment anybody clicked
it. (Found by opening all 164 changelists as a superuser rather than by any check.)

Three things could fix it and none of them is a `ModelAdmin`:

- a shard picker (`?shard=logs_3`) plus `get_queryset().using(...)` — honest, but it is a
  bespoke page wearing an admin's clothes, and it cannot answer "where is request X" without
  asking all eight;
- a read-only VIEW over the union, which SQLite will not give across attached files here;
- the thing that already exists: `manage.py enforce_log_retention`, and the moderation surface
  that reads these tables through the router that knows which shard an actor's rows are on.

House rule 10 — flag it, don't fake it: an admin page that shows one shard and calls itself the
request log would answer "no" to "did this happen?" seven times out of eight.
"""
