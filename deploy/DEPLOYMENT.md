# EdMat — webek4.fuw.edu.pl / edmat.net deployment runbook

**This package (`FUW/NEW`) is a fresh code snapshot, taken 2026-07-30, of everything that changed
since the last one (`FUW/CURRENTLY`, frozen 2026-07-27).** If `FUW/CURRENTLY` was already copied to
the real server and is live there, read **Part A** first — it's the short "sync the update" path.
Part B (further down) is the original, full from-scratch runbook, kept intact for a fresh box or if
it turns out the server was never actually finished. Every command below runs **on webek4 itself**
(root access required for most of it) — nothing in this repo can run these for you.

---

## What changed since the 2026-07-27 snapshot (`FUW/CURRENTLY`)

Read this before touching the server — it's the actual scope of the update, not a guess:

- **Two brand-new Django apps: `services` (tutoring/course listings) and `messaging`** (real
  user-to-user messages, built over `django-postman`). New `INSTALLED_APPS` entries:
  `services`, `messaging`, `django.contrib.sites`, `postman`. New pip dependencies:
  `django-postman`, and (from a slightly earlier pass) `python-magic` + `clamd` for material-upload
  scanning — **all three are already in `backend/requirements.txt`** in this package, so a plain
  `pip install -r requirements.txt` picks them up; nothing to hand-add.
- **Material requirements, price/time-estimate, and threaded coverage discussion** (materials app) —
  new fields on `Material`/`MaterialSubmission`, no new dependency.
- **Platform-wide moderator "kill switches"** (`moderation.FeatureFlag`) — a new model + migration
  that self-seeds 4 flags, all enabled, the instant `migrate` runs. Nothing to configure; existing
  behavior is unchanged until a moderator actually flips one off from the new `/moderation` → Flags
  tab.
- **A real, found-and-fixed bug**: `seed_demo_users` used to only set a demo account's password on
  first creation, never on a re-run — meaning re-running it against a database that already has
  those 5 accounts (e.g. this server's own) silently did NOT reset `password123` the way its own
  docstring claimed. Fixed to always reset the password on every run.
- **This package's own settings.py has a real, structural fix `FUW/CURRENTLY`'s never had merged
  back into the main codebase**: the env-var-driven `SECRET_KEY`/`DEBUG`/`ALLOWED_HOSTS`/
  `CSRF_TRUSTED_ORIGINS`/`STATIC_ROOT`/HTTPS-readiness block that the *previous* deployment pass
  worked out now lives in the actual tracked `backend/config/settings.py`, not bolted on ad hoc
  inside a snapshot folder that never made it back into the real codebase. Practically: the same
  `/etc/apache2/envvars` values from the last deployment (`DJANGO_SECRET_KEY`, `DJANGO_DEBUG`,
  `EDMAT_HTTPS_READY`) still work unchanged, plus **three new, optional** ones
  (`DJANGO_ALLOWED_HOSTS`, `DJANGO_CSRF_TRUSTED_ORIGINS`, `DJANGO_CORS_ALLOWED_ORIGINS`, all
  comma-separated) — see Part B Step 6 for the exact values this deployment actually needs.
- **Migrations added since 2026-07-27**: `accounts.0005`, `exercises.0004`, `materials.0004`–`0007`,
  `moderation.0004`–`0009`, `postman.0001`, `services.0001`, `sites.0001`–`0002`. All additive
  (new tables, new nullable/defaulted columns) — none of them drop or rename anything a real
  user's existing data depends on. `manage.py migrate` applies all of them in one pass.
- **Frontend**: new routes (`/services`, `/services/new`, `/messages`, `/messages/new`,
  `/messages/[id]`), a new "Messages"/"Tutoring listings" nav link, a new Flags tab on
  `/moderation`. This package's own `frontend/build/` is a **fresh production build** of all of it —
  nothing to build server-side.

**⚠️ Corpus/content is unchanged** — `Database-of-Student-Exercise/content/` is byte-identical to
the last package; `import_legacy_corpus` is idempotent regardless, so re-running it is always safe.

---

**Optional since Aug 2026 — Redis.** With `EDMAT_REDIS_URL` (e.g. `redis://127.0.0.1:6379/0`) in
`/etc/apache2/envvars`, the backend switches its cache to Redis (auth throttle counters become
shared across every mod_wsgi worker and correct at any process count), the anonymous-read response
cache becomes genuinely shared, and notification SSE streams switch from per-connection DB polling
to pub/sub push with a per-account stream cap. Without the variable everything behaves exactly as
before — file-based cache, polling SSE — so this needs deciding only when a `redis-server` exists
on the box (`apt install redis-server`, then restart Apache). `manage.py preload_cache` (cron it at
the cache TTL cadence, 60 s, if standing warmth is wanted) warms the hot anonymous reads from the
telemetry log.

## Part A — updating an already-deployed instance (the likely path)

**Take a real backup first — `db.sqlite3`, `media/`, and the current deployment directory.** This
update should be a safe, additive sync, but "should be" is not "guaranteed," and restoring from a
backup is always cheaper than hand-fixing a partially-applied change.

```bash
BACKUP_TS=$(date +%Y%m%d-%H%M%S)
cd /home/todoonet/todonet   # or wherever this deployment actually lives — see Part B's own note
cp backend/db.sqlite3 ~/edmat-db-backup-$BACKUP_TS.sqlite3
tar czf ~/edmat-media-backup-$BACKUP_TS.tar.gz backend/media/
```

### 1. Sync the new code — **never `db.sqlite3` or `media/`**

However you'd normally copy files here (scp/rsync/git) — the important part is what to **exclude**:
this package's own `backend/` has no `db.sqlite3`, `media/`, `.venv`, or `staticfiles/` in it at
all (deliberately, so there's nothing in it that could accidentally overwrite live data even by
mistake), and `frontend/` has no `node_modules/`. A plain rsync of the whole package is safe as-is:

```bash
rsync -av --exclude='.venv' /path/to/FUW/NEW/backend/  /home/todoonet/todonet/backend/
rsync -av /path/to/FUW/NEW/frontend/                    /home/todoonet/todonet/frontend/
rsync -av /path/to/FUW/NEW/deploy/                      /home/todoonet/todonet/deploy/
```

(`--exclude='.venv'` on the backend sync is just belt-and-braces — this package never had one to
begin with, so the flag is a no-op, not a load-bearing safeguard.)

### 2. Install the new Python dependencies

```bash
cd /home/todoonet/todonet/backend
.venv/bin/pip install -r requirements.txt
```

New this round: `django-postman`, `python-magic`, `clamd`. `python-magic` needs the system
`libmagic` shared library — almost certainly already present on a normal Ubuntu box, but confirm:

```bash
ldconfig -p | grep libmagic || sudo apt install -y libmagic1
```

### 3. Apply migrations (safe, additive, idempotent)

> **One-time, and only for a database that predates the taxonomy split — run it BEFORE `migrate`.**
>
> ```bash
> .venv/bin/python3 manage.py rename_classroom_app
> ```
>
> The `classroom` app is now `courses`. An app label is not schema, so no migration can change it:
> `django_migrations` records the old label on every applied row, and `migrate` stops on its own
> consistency check before running anything —
> `InconsistentMigrationHistory: ... applied before its dependency courses.0002_...`. That is
> Django correctly refusing to proceed, not a problem to work around. The command renames the
> tables, rewrites `django_migrations.app` and re-files the content types, all in one transaction.
>
> It is idempotent and safe on a database that never had the old app — it finds nothing and says
> so — so leaving it in a deploy script costs nothing. It refuses outright if it finds both an old
> and a new table, which means a half-finished attempt; restore the backup and start again.
>
> **Two migrations in this release cannot be reversed**: `taxonomy.0005` (the four przedmiot rows
> collapsing into two branches, which discards which university each exercise came from) and
> `courses.0007`. The backup taken in step 0 is the rollback.

```bash
.venv/bin/python3 manage.py migrate
.venv/bin/python3 manage.py import_legacy_corpus --dry-run   # confirm zero unexpected changes first
.venv/bin/python3 manage.py import_legacy_corpus              # then for real — a no-op if content is unchanged
.venv/bin/python3 manage.py collectstatic --noinput
.venv/bin/python3 manage.py check --deploy
```

`check --deploy` should already be clean if `/etc/apache2/envvars` still has the same
`DJANGO_SECRET_KEY`/`DJANGO_DEBUG`/`EDMAT_HTTPS_READY` values from the original deployment — nothing
about this update requires touching that file again. If you'd like to set any of the three new,
optional env vars (`DJANGO_ALLOWED_HOSTS`/`DJANGO_CSRF_TRUSTED_ORIGINS`/
`DJANGO_CORS_ALLOWED_ORIGINS`), see Part B Step 6 for the exact values; not required if the old
hardcoded equivalents were already working.

### 4. Restart

```bash
sudo apache2ctl configtest && sudo systemctl restart apache2
```

(`restart`, not `reload` — a new `mod_wsgi` daemon process needs to actually pick up the new code
and any new/changed environment variables.)

### 5. Smoke test

```bash
curl -s https://edmat.net/api/feature-flags/ | python3 -m json.tool   # new — expect 4 flags, all true
curl -I https://edmat.net/services                                    # new route — expect 200
curl -I https://edmat.net/messages                                    # new route — expect 200
curl -I https://edmat.net/                                            # unaffected — expect 200
```

Then open `https://edmat.net/` in a real browser: confirm login still works with an existing real
account, confirm the new "Tutoring listings"/"Messages" nav links appear, and confirm
`/moderation`'s new Flags tab is visible to a real staff account.

### 6. A real, one-time cleanup this update surfaces

**Re-run `seed_demo_users` if this server's own 5 demo accounts need `password123` to actually
work.** The bug described above means any earlier run against this exact database may have silently
left their passwords un-reset:

```bash
.venv/bin/python3 manage.py seed_demo_users
```

Harmless to run even if it turns out nothing was wrong — it's fully idempotent and only ever
touches the 5 known demo accounts (`u-kasia`/`u-michal`/`u-ola`/`u-bartek`/`u-julia`), never a real
visitor's own account.

---

## Part B — the original, full runbook (fresh box / re-provisioning from scratch)

Everything below is unchanged from the 2026-07-27 package, reproduced here so this file is
complete on its own — skip to whichever step actually still needs doing if some of this is already
live.

**Path assumption, stated once, up front:** every path below assumes the deployment root is
`/home/todoonet/todonet/` (with `backend/` and `frontend/` as siblings underneath it) — taken
from the venv's own baked-in `pyvenv.cfg` (`command = /usr/bin/python3 -m venv
/home/todoonet/todonet/backend/.venv`), not confirmed live. If the real path differs, it only needs
changing in **two** places: the `Define EDMAT_ROOT` line at the top of both
`apache/edmat.conf` and `apache/edmat-stage1-http-only.conf`.

### Step 0 — copy this repo to webek4

Get this whole `FUW/NEW/` directory (or just `backend/`, `frontend/`, and `deploy/` — the
`Database-of-Student-Exercise/` copy is historical-provenance only, not needed to actually run the
site) onto webek4 at the assumed path, however you'd normally do that (scp/rsync/git).

### Step 1 — point edmat.net's DNS directly at this box

At OVH's own DNS zone management for `edmat.net`: real `A` records —

```
edmat.net.      A    193.0.80.55
www.edmat.net.  A    193.0.80.55
```

### Step 2 — verify DNS actually propagated before continuing

```bash
dig +short edmat.net A
dig +short www.edmat.net A
```

Both must print `193.0.80.55` before Step 5 (certbot) has any chance of working.

### Step 3 — install system prerequisites

```bash
sudo apt update
sudo apt install -y apache2-dev certbot libmagic1
```

(`libmagic1` is new to this list since the last package — needed by `python-magic`, materials
upload validation. `apache2-dev` provides `apxs`, needed for `mod_wsgi.so` in Step 3b.)

### Step 3b — compile and load mod_wsgi for this exact venv

```bash
cd /home/todoonet/todonet/backend
.venv/bin/mod_wsgi-express install-module
```

Put both printed lines into `/etc/apache2/mods-available/wsgi.load` (`LoadModule` line) and
`/etc/apache2/mods-available/wsgi.conf` (`WSGIPythonHome` line), then:

```bash
sudo a2enmod wsgi rewrite ssl headers
sudo apache2ctl configtest
```

`configtest` should say `Syntax OK`.

> **`headers` is not optional and is easy to miss.** The vhost sets the site's security headers
> (`X-Content-Type-Options`, `Referrer-Policy`, `X-Frame-Options`, `Content-Security-Policy`, and
> `Content-Disposition: attachment` on `/media/`) with `Header` directives, and without
> `mod_headers` loaded Apache **fails to start** on the first one rather than skipping it. If
> `configtest` reports `Invalid command 'Header'`, this is why.
>
> Those headers have to be set here rather than in Django because `SecurityMiddleware` only covers
> responses Django itself generates — `/api/` and `/admin/`. The SPA's own pages, `/static/` and
> `/media/` are served directly by Apache and never reach Django, so before they were added the
> site had no clickjacking or MIME-sniffing protection on any page a visitor actually looks at,
> even though `manage.py check --deploy` was clean.

### Step 4 — stage 1: HTTP-only vhost, to let certbot's challenge actually reach this box

```bash
sudo mkdir -p /var/www/html/.well-known/acme-challenge
sudo cp /home/todoonet/todonet/deploy/apache/edmat-stage1-http-only.conf \
    /etc/apache2/sites-available/edmat.conf
sudo a2ensite edmat
sudo apache2ctl configtest && sudo systemctl reload apache2
curl -I http://edmat.net/   # sanity check — expect a real HTTP response
```

### Step 5 — get the real certificate

```bash
sudo certbot certonly --webroot -w /var/www/html \
    -d edmat.net -d www.edmat.net -d webek4.fuw.edu.pl
sudo ls -la /etc/letsencrypt/live/edmat.net/   # expect fullchain.pem + privkey.pem
```

### Step 6 — Django-side production settings: secrets, static files, migrations

```bash
cd /home/todoonet/todonet/backend
.venv/bin/pip install -r requirements.txt
.venv/bin/python3 -c "from django.core.management.utils import get_random_secret_key; print(get_random_secret_key())"
```

Add the result, plus the other flags, to `/etc/apache2/envvars` (sourced by `apache2.service` on
every start — this is what makes them visible to a `WSGIDaemonProcess`; a plain Apache `SetEnv`
does **not** reach it the same way):

```bash
sudo tee -a /etc/apache2/envvars > /dev/null <<'EOF'

# EdMat production settings
export DJANGO_SECRET_KEY="paste-the-generated-key-here"
export DJANGO_DEBUG="False"
export EDMAT_HTTPS_READY="true"
export DJANGO_ALLOWED_HOSTS="edmat.net,www.edmat.net,webek4.fuw.edu.pl"
export DJANGO_CSRF_TRUSTED_ORIGINS="https://edmat.net,https://www.edmat.net"
EOF
```

(`DJANGO_ALLOWED_HOSTS`/`DJANGO_CSRF_TRUSTED_ORIGINS` are new — this package's own `settings.py`
reads these from the environment now, rather than needing the domain hardcoded into a file every
environment shares. `DJANGO_CORS_ALLOWED_ORIGINS` isn't needed here at all: the built frontend and
the API are served from the same origin, so no cross-origin request ever needs a CORS header — it
exists only for the rare case of testing a local dev frontend against this real production API.)

Then:

```bash
.venv/bin/python3 manage.py collectstatic --noinput
.venv/bin/python3 manage.py migrate
.venv/bin/python3 manage.py import_legacy_corpus
.venv/bin/python3 manage.py check --deploy
```

`check --deploy` should come back clean once the real secret key above is in place and Apache has
been restarted (next step) — env vars set in `/etc/apache2/envvars` aren't visible until then.

### Step 7 — switch to the real, full vhost and restart

```bash
sudo cp /home/todoonet/todonet/deploy/apache/edmat.conf /etc/apache2/sites-available/edmat.conf
sudo apache2ctl configtest && sudo systemctl restart apache2
```

### Step 8 — auto-start on reboot

```bash
sudo systemctl enable apache2
sudo systemctl is-enabled apache2   # should print "enabled"
sudo systemctl list-timers | grep certbot
sudo certbot renew --dry-run
```

### Step 9 — firewall

Skip if the university's own network already firewalls this box from a perimeter device.

```bash
sudo ufw allow OpenSSH
sudo ufw allow 80/tcp
sudo ufw allow 443/tcp
sudo ufw enable
sudo ufw status verbose
```

### Step 10 — smoke test, end to end

```bash
curl -I https://edmat.net/                          # real app — expect 200
curl -I https://www.edmat.net/                       # expect 200 (or a redirect to the bare domain)
curl -I https://webek4.fuw.edu.pl/                   # expect a 301 to https://edmat.net/
curl -s https://edmat.net/api/fields/ | head -c 200  # real API — expect real JSON, not an error
curl -s https://edmat.net/api/feature-flags/          # new — expect 4 flags, all true
curl -I https://edmat.net/admin/                     # Django admin — expect 200 (login page)
curl -I http://edmat.net/                            # plain HTTP — expect a 301 to https://
```

Then open `https://edmat.net/` in a real browser, click through a course/exercise page, confirm the
padlock shows a valid certificate, and confirm a real login works.

**Then check an AUTHENTICATED request, which none of the above does.** Every curl on this page is
anonymous, and "a real login works" is not the same test: logging in travels in a POST body and
succeeds even when token auth is completely broken. It is the request *after* the login that fails.

```bash
TOKEN=$(curl -s -X POST https://edmat.net/api/auth/login/ -H 'Content-Type: application/json' \
    -d '{"email":"YOUR_EMAIL","password":"YOUR_PASSWORD"}' \
    | python3 -c "import sys,json;print(json.load(sys.stdin).get('token',''))")
curl -s -o /dev/null -w "authenticated me -> %{http_code}\n" \
    https://edmat.net/api/auth/me/ -H "Authorization: Token $TOKEN"    # expect 200
```

A **401 here with a valid token** almost always means `WSGIPassAuthorization On` is missing from the
vhost (see the long note beside it in `apache/edmat.conf`) — mod_wsgi strips the `Authorization`
header by default. The tell is the response body length: 58 bytes ("Authentication credentials were
not provided.") means the header never arrived, 27 bytes ("Invalid token.") means it arrived and was
genuinely rejected. In a browser the same bug presents as "refreshing logs me out", because
`authStore.init()` clears the session on any `/auth/me/` failure.

---

## Left for you, not automated here

- **Admin/demo account cleanup.** If this server already has real user accounts from an earlier
  round, review which are genuine demo/test accounts (shared `password123`) versus real people
  before this goes fully public.
- **ClamAV**, if you want `MATERIAL_SCAN_REQUIRED = True` (currently `False` — uploads are still
  content-type-sniffed, just not virus-scanned): `sudo apt install clamav-daemon`, confirm `clamd`
  is listening on `/var/run/clamav/clamd.ctl`, then flip that one setting and restart Apache.
- **HSTS's own one-way commitment.** Once `EDMAT_HTTPS_READY=true` has been live and confirmed
  working for a while, browsers that have seen the HSTS header will refuse plain HTTP to this
  domain for a full year — if this is the very first cutover and still being debugged, consider
  commenting out the HSTS lines in `settings.py`'s `if _HTTPS_READY:` block for a few days first.
- **Email delivery still isn't configured** (`EMAIL_BACKEND` is the console backend) — password
  reset remains an honest stub; nothing about this update changes that.
