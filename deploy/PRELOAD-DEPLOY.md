# Deploying the extended `preload_cache` on FUW (webek4 / edmat.net)

A note for the Claude session (or human) doing the deploy. Context: this branch widens
`manage.py preload_cache` (telemetry app) from the taxonomy base set (~13 URLs) to the full
anonymous browse surface (~60+ URLs) — per-branch detail/exercise/material listings in both
locales plus the top-level public lists. Nothing else changed; no migration, no new dependency,
no frontend change.

## Constraints that shape the deploy (from FUTURE-UPDATES.md — read it first)

- **This VM cannot ssh to webek4.** Prepare paste-able commands (and a tarball in `Wymiana_VM`
  if needed); Piotr pastes them from his own machine as `todoonet`.
- **The app runs as `www-data`**, deploys run as `todoonet`. `preload_cache` only writes to the
  cache (Redis on webek4 — `EDMAT_REDIS_URL` is set in `/etc/apache2/envvars`), so no file
  permissions are involved — but the env var must be present in the shell that runs the command,
  or it will warm the file cache the WSGI processes never read.

## Steps (paste-able, as todoonet on webek4)

```bash
cd /home/todoonet/todonet
git fetch origin
git merge --ff-only origin/main        # after this branch's PR is merged; or cherry-pick the commit
# no migrate, no collectstatic, no Apache restart needed — management command only

# one manual warm to verify (source the env so EDMAT_REDIS_URL matches the app's):
set -a; source /etc/apache2/envvars 2>/dev/null; set +a
backend/../.venv/bin/python backend/manage.py preload_cache
# expect: "Preloaded N responses (...)" with N in the dozens; if N is ~0 with many failures,
# check ALLOWED_HOSTS (the command picks the first real host) and that logs_anon is migrated
# (manage.py migrate_log_shards — run via sudo -u www-data, logdata/ is www-data-owned).
```

Verify from outside: `curl -sI https://edmat.net/api/disciplines/ | grep -i x-edmat-cache`
should read `hit` right after a warm run (TTL is `EDMAT_CACHE_RESPONSE_TTL`, default 60 s).

## Standing warmth: cron at the TTL cadence

```bash
crontab -e   # as todoonet
* * * * * . /etc/apache2/envvars; /home/todoonet/todonet/.venv/bin/python /home/todoonet/todonet/backend/manage.py preload_cache >> /home/todoonet/preload_cache.log 2>&1
```

Every minute matches the default 60 s TTL. If that feels heavy, raise
`EDMAT_CACHE_RESPONSE_TTL` (in `/etc/apache2/envvars`, then `apachectl graceful`) and slow the
cron to match — the preload is a head start, never a staleness extension, so the two cadences
should stay equal. Keep the log file an eye for a run or two, then feel free to drop the
`>> …log` if it's noise.

## Rollback

It's one management command — stop the cron line and the app behaves exactly as before
(earn-your-slot admission still caches organically). No code rollback needed.
