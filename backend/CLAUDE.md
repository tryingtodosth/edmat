# backend/ — Django 5.2 + DRF, 20 apps + `config/` + `testing/` + `imaging.py`, SQLite

Scoped context for backend work. Per-app specifics live in each app's own `CLAUDE.md`; the
cross-cutting rules live in the root `CLAUDE.md`; full chronological history and design reasoning
live in `HISTORY.md` (which predates the taxonomy rename below, so its model names are stale).

## The vocabulary rename (the root CLAUDE.md does NOT know about this)

| Concept | Current model | Old name in root CLAUDE.md |
|---|---|---|
| University subject (*przedmiot*) | `taxonomy.Branch` | `taxonomy.Course` |
| Field of study (*kierunek*) | `taxonomy.Discipline` | `taxonomy.Field` |
| User-run course (*kurs*) | `courses.Course` | app was `classroom` |

`/api/courses/` is the **user-run** course API; `/api/branches/` + `/api/disciplines/` are the
taxonomy. An untracked `backend/classroom/` directory (stale `migrations/` + `__pycache__`) may
still exist on disk — the live app is `courses/`; never resurrect `classroom`.

## Run / test

- One shared venv at repo root: `.venv/` (Python 3.12). From `backend/`:
  `../.venv/bin/python3 manage.py test --parallel 4 --keepdb` (`test.md` has the current count, the time and what each suite covers), `manage.py check`,
  `manage.py makemigrations --check --dry-run`. No CI runs any of this — run it yourself.
- Dev server: `./run.sh` from repo root (starts both halves; keeps CORS origin + `frontend/.env`
  in step with the chosen ports — changing a port by hand silently breaks CORS).
- `backend/requirements.txt` is canonical; root `requirements.txt` is a one-line include of it.
  Don't let them drift again (a clean clone once couldn't boot: `No module named 'postman'`).
- `db.sqlite3.bak-*` snapshots beside the database are deliberate; don't clean them up.

## SQLite rules (violating these has produced real 500s)

1. **No `select_for_update()`** — SQLite has no row locking; Django silently no-ops it, and a
   surrounding `atomic()` holds a whole-block write lock that turns concurrency into
   `database is locked`. The pattern that works: claim state with ONE WHERE-anchored
   `filter(pk=…, status='pending').update(...)` (atomic on every backend); loser sees 0 rows →
   return 409.
2. `atomic()` is fine only around a couple of fast adjacent statements on one table (e.g.
   delete+bulk_create), never around a slow multi-table apply sequence.
3. Unique-key allocation under concurrency (exercise numbers, material slugs): bounded retry loop,
   each attempt in its own savepoint, catching both `IntegrityError` and `OperationalError`.
4. `DATABASES['default']['OPTIONS']['timeout']` is raised to 20s on purpose.

## API conventions (hold these on every new endpoint)

- Public GET, owner-scoped writes. Non-owner → **404** via queryset scoping; a real-but-wrong
  party → **403**; a wrong-status transition → **409**. A queryset filter is NOT a permission
  check for anything addressed by pk — single-object actions need their own object-level check.
- Ids: Discipline/Branch are **slugs**; everything else numeric pk (frontend stringifies).
- Pagination is globally OFF (deliberate — every list is bounded by construction). Bare arrays.
- `?lang=` resolves a translation, falling back to `original_locale`. Resolution logic is
  `config/i18n_utils.py` — use it, don't reimplement fallback.
- Refusals carry their *reason* to the client (`enrollment_block_reason` pattern) — "full" and
  "you were removed" are the same boolean but different sentences.
- Feature kill switches: `moderation.FeatureFlag` + `feature_gate('<name>')` — gates reads too,
  `is_staff` bypasses. Killing a feature must also remove every frontend **link** to it.

## Content safety (both layers, always)

- User text: sanitize on write via `config/sanitize.py` (bleach allowlist) — the frontend's
  DOMPurify pass is the read side, never the only line. Content format is Markdown + literal
  LaTeX delimiters + raw-HTML passthrough (corpus migrated byte-for-byte; don't "normalize" it).
- File uploads: `python-magic` sniff against a per-extension whitelist (never filename or
  browser Content-Type), 25MB cap, stored under a random UUID name. ClamAV via
  `scan_for_malware` is honestly optional here (`MATERIAL_SCAN_REQUIRED=False`, no daemon in dev).
- Images (avatars, event-post pictures): **re-encode, never store the uploaded bytes** —
  shared bounds in `backend/imaging.py` (byte cap → magic sniff → declared-dimensions pixel cap
  BEFORE decode → decode/EXIF-transpose/re-encode WebP). The pixel cap is the decompression-bomb
  defense; EXIF stripping is a privacy fix (GPS in phone photos).
- SVG (a Ketcher chemistry drawing, `chem/`): **rebuilt from an allowlist, never stored as sent**
  (`chem/svg.py` — geometry/text/gradients kept; `script`, handlers, `foreignObject`, `image`,
  external `href`, `url()` CSS, DOCTYPE/entities dropped or refused). It is served from
  `/media/` on the app's own origin, so the Apache attachment header alone is not the defense.
  Content embeds it as `<img data-chem=… class="chem-drawing">`; bleach's `img` callable in
  `config/sanitize.py` must list every attribute itself — a tag with a callable never falls
  through to `'*'` (that is how `class` was silently lost on every picture until §17AV).

## The activity feed (activity/)

`ActivityEvent` is **public-by-construction, never an audit log** — `record_activity()` is the
only writer (called only for already-public events), `remove_activity_for()` the forgetting half
(auto-hide, removes, tombstones), 90-day self-trim. Community rows come from `activity/signals.py`
with a strict never-privatizable-targets allowlist. `Post` = words + exactly-one
discipline/branch/tag anchor (DB CheckConstraint) + optional re-encoded image; `posts` kill
switch strips its feed rows too. See activity/CLAUDE.md.

## Notifications

`notifications/services.notify()` is the ONLY place a `Notification` row is created — never
construct one directly (three gates live there: recipient=None no-op, actor==recipient no-op,
preference gating that means muted rows are never created). New type → register in
`_PREFERENCE_FIELD_FOR_TYPE` (NOTIFICATION_TYPES derives from it) AND mirror in frontend
`lib/utils/labels.ts`.

## Redis is optional, by design

`EDMAT_REDIS_URL` unset (bare clone, tests) = file/LocMem cache + DB-polling SSE. Set = shared
throttle counters, the anonymous-read response cache (`config/cachemw.py`) becomes shared, and
SSE goes pub/sub (`notifications/redisbus.py`). Never make Redis a hard dependency.

**`AnonymousReadCacheMiddleware` is stripped from `MIDDLEWARE` under the test runner**, and must
stay that way. It replays a stored response as a plain `HttpResponse`, which has no `.data`, and
the default cache is a FILE cache under `backend/cachedata/` that outlives the process — so one
test's anonymous GET earned admission and was then served to a different test, to the next run,
or to a run after the dev server had browsed the same URL. That broke ~74 tests in `courses`
alone on a clean checkout, moving around depending on execution order. `telemetry.tests.
AnonymousReadCacheTests` puts it back for itself with `@override_settings`.

## Testing

**Every test class that reaches an endpoint declares `databases = set(all_log_shards()) | {'default'}`**
(`from telemetry.routers import all_log_shards`) — **once, on a base class inside that file**, which is what
forty-two test files now do and what a new one should do, leaving any class that reaches no endpoint on plain
`APITestCase` so the checker below keeps its bite.
The request-log middleware writes to one of nine SQLite shards on every request, and a class that did not declare
them logs a traceback per request serially and kills `--parallel` outright. Not `'__all__'`.
`testing/check_databases_declared.py` prints the classes that forgot; zero is the bar, and
`testing/test_databases_declared.py` is what makes the suite itself check it (`HISTORY.md` §17BT.A, §17BU.C).

`testing/factories.py` — plain functions, deliberately not factory_boy. Use `make_viewer` (no
password hash) for decorative FK-target users; `make_user` only when something logs in — that
one change alone cut a suite from 52s to 12s. DRF derives uniqueness validators from
`unique_together` but NOT from `Meta.constraints` — add serializer-level checks or duplicates
500 instead of 400.

## The Django admin (2026-10-08 — 161 of 174 models have a page)

It is a real operator surface here, not scaffolding, and three rules keep it from becoming a hole in
the rules the API enforces:

1. **A derived field is `readonly_fields`.** `goals.Goal.status`, `needs.Need.fulfilled`, every
   recounted score, `MaterialView` — the API answers 400 if you try to set these by hand (house
   rule 5), and the admin must not be the one surface that can. Show the EVIDENCE beside it
   (`met_by`, `met_at`) rather than the decision.
2. **Evidence is add/change-disabled, not merely read-only-ish.** `events.ScanEvent`,
   `events.ExportLog`, `telemetry.*`: a door log somebody can edit answers nothing it was written
   to answer. Deletion is a retention command with a policy behind it, never a button.
3. **Every FK to a person or to a big table is `raw_id_fields`.** A select holding every account is
   slow and is a way to pick the wrong person.

**A model on a log shard cannot have an admin page.** The admin reads one database and
`telemetry/routers.py` spreads these across `logs_1 … logs_7` + `logs_anon`, so a registered
`RequestLog` opens to `no such table` — `manage.py check` validates `list_display` and friends but
never opens the page. `telemetry/admin.py` is a module explaining this instead of a registration.
**The check that would have caught it** (and that is worth re-running after adding models): open
every `admin.site._registry` changelist as a superuser and assert 200. 162 pass today.

The thirteen models with no page of their own are each an inline on the row they belong to — the
taxonomy translations, a set's items, a profile's CV rows, the availability windows, a post's links.
An inline answers the only question those tables are ever asked.
