# deploy/ — the webek4 / edmat.net production runbooks

`DEPLOYMENT.md` (Part A: routine sync; Part B: full from-scratch setup),
`UPDATE-2026-08-10.md` (the breaking-upgrade runbook — taxonomy rename etc., applied
2026-08-10), `UPDATE-2026-08-25.md` (the claims/first-paint release — the shape a routine,
additive update should take), `UPDATE-2026-08-28.md` (the solution-pool + activity release —
NOT purely additive: `exercises.0011` drops two columns; the step-0 backup is the rollback), `apache/edmat.conf` + `edmat-stage1-http-only.conf` (the real vhosts: TLS, and the
pre-certificate bootstrap).

## Production shape — facts that constrain code

- Apache + **mod_wsgi, `processes=2 threads=4` = 8 request slots total.** This number is why the
  SSE polling loop was rewritten (eight idle tabs used to occupy every slot) and why anything
  long-running per-connection is a real availability question, not a style one.
- SQLite in production too. The SPA build is served statically. Runs as **`www-data`** — file
  ownership/permission traps are real; see the FUW rescue notes.
- The sync in `DEPLOYMENT.md` rsyncs ONLY `backend/`, `frontend/` and `deploy/` — the root
  `requirements.txt` never reaches the server, which is why `backend/requirements.txt` is
  canonical and the root file is a one-line include. Keep that split.
- Throttle counters and the response cache are per-process unless `EDMAT_REDIS_URL` is set on
  the server.
- This VM **cannot ssh to webek4** — server work happens elsewhere; here you only maintain the
  runbooks and payloads.

## Secrets

The untracked repo-root `FUW/` directory holds live secrets from the server rescue (a real
`SECRET_KEY`, a TLS private key, ~15 API tokens, weak passwords — `FUW/secrets.md`). **Never
commit anything from it; sanitise before restoring from it.** Nothing under `deploy/` may ever
contain a real secret — the vhosts read env/config on the server. `FUW/FUTURE-UPDATES.md` is the
read-me-first for the next server update.

## When code changes touch deployment

New env vars, new system dependencies, new migrations with data steps, port/origin changes —
update `DEPLOYMENT.md` (and, for breaking steps, a dated `UPDATE-*.md`) in the same change.
The runbook being stale is how the last rescue became necessary.
