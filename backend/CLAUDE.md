# backend/ — Django 5.2 + DRF, 15 apps + `config/` + `testing/` + `imaging.py`, SQLite

Scoped context for backend work. Per-app specifics live in each app's own `CLAUDE.md`; full
chronological history and design reasoning live in the root `CLAUDE.md` (authoritative when they
disagree — but note it predates the taxonomy rename below, so its model names are stale).

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
  `../.venv/bin/python3 manage.py test` (~1145 tests), `manage.py check`,
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

## Testing

`testing/factories.py` — plain functions, deliberately not factory_boy. Use `make_viewer` (no
password hash) for decorative FK-target users; `make_user` only when something logs in — that
one change alone cut a suite from 52s to 12s. DRF derives uniqueness validators from
`unique_together` but NOT from `Meta.constraints` — add serializer-level checks or duplicates
500 instead of 400.
