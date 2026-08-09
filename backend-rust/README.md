# edmat-api — the Rust port (milestone M0)

> **OUTDATED — this branch is archived (2026-08-09).** The owner decided to stay with Django and
> put the effort into the Redis caching/delivery work on `main` instead. Nothing here is wrong —
> M0 passed conformance on its first run (`SESSION-LOG.md`) — it is simply not the direction.
> The `spec/` mechanism (schema export, goldens, conformance runner) outlives this branch and is
> what the Redis preloader warms from; if a port is ever revisited, start from that, not from
> resurrecting this code blind.

The Rust implementation of the EdMat backend, per `PORTS-BRIEF.md`. **Django stays authoritative**:
it owns the schema (`spec/schema.sql`), the migrations, and the golden corpus this port is judged
against. This branch never edits `spec/` — contract changes happen on `main` first.

## Status: M0

Serves the anonymous taxonomy read surface — `GET /api/disciplines/`,
`/api/disciplines/{slug}/`, `/api/disciplines/{slug}/branches/` (with nested topics and chapters),
including the `?lang=` locale-resolution contract (requested → `pl` → any → slug/empty fallbacks,
mirroring `backend/config/i18n_utils.py`).

The database is opened **read-only at the SQLite level** (`SQLITE_OPEN_READ_ONLY`) — the port
cannot write even by mistake. Writes stay Django's until the milestone that ports them arrives
together with their validation (see the hard-parts inventory in PORTS-BRIEF §4).

## Run

```sh
cd backend-rust
EDMAT_DB=../backend/db.sqlite3 EDMAT_PORT=8090 cargo run
```

## The definition of done, at every milestone

```sh
# reference (sanity — must always pass):
node spec/conformance/run.mjs http://127.0.0.1:8012
# this port:
node spec/conformance/run.mjs http://127.0.0.1:8090
```

Same runner, same goldens, both green — there is no separate Rust test suite to drift. To extend
the contract: add cases to `spec/conformance/record.mjs`, re-record against the reference
(`record.mjs http://127.0.0.1:8012`), then make this port pass them.
