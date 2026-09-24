# EdMat prototype — reliability review

**Question:** will one Node 18 process with a JSON-file store carry a real school — 600 students,
50 teachers, 30 classes, 5 lessons a day, 190 school days — for a year on one small VPS, and does it
survive the ordinary operational accidents?

**Answer:** the code survives the accidents once the fixes below are in; **the store does not survive
the year.** A 600-student school produces a 118 MB data file after five months and 210 MB after
twelve. Every single write rewrites that whole file — 1.9 s at five months, 3.7–4.6 s at twelve — and
the process is single-threaded, so every teacher in the building waits for it. Plan the move to
SQLite for the end of the first semester; the thresholds and the migration path are at the bottom.

Everything below was measured on a fixture built with `createApp({ blank: true })` plus the real
setup endpoints (school + admin, teacher CSV, six student CSV batches, timetable CSV,
`generateLessons`), then attendance and grades inserted directly. Hardware: the dev container,
Node 18.19.1, `--max-old-space-size=4096` unless stated.

---

## 1. The fixture

| collection | rows | serialized |
| --- | ---: | ---: |
| attendance | 324 000 | 103.5 MB |
| lessons | 30 600 | 8.3 MB |
| grades | 12 000 | 4.8 MB |
| users (50 teachers + 600 students + 600 parents + admin) | 1 252 | 0.5 MB |
| students | 600 | 0.24 MB |
| registrationCodes | 600 | 0.10 MB |
| timetable | 750 | 0.09 MB |
| classes | 30 | 0.01 MB |
| **whole file** | **369 980** | **117.6 MB** |

30 classes × 25 weekly slots = 750 timetable rows; `generateLessons` over the whole year produced
30 600 lessons (204 school days after weekends); attendance was written for every lesson before the
pinned school clock `config.today = 2027-01-29`, i.e. ~5 months, 16 200 held lessons × 20 students.

Fixture build, step by step:

| step | time |
| --- | ---: |
| `POST /api/setup/school` | 216 ms |
| teacher CSV import (50 accounts) | 3 822 ms |
| student CSV import, 100 students + 100 parents | 11 253 – 15 823 ms per batch (**~80 s for 600**) |
| timetable CSV import (750 rows) | 20 ms |
| `generateLessons` (whole school year, 30 600 lessons) | 75 ms |
| build 324 000 attendance rows in memory | 186 ms |
| build 12 000 grade rows in memory | 90 ms |
| `db.flush()` (117.6 MB) | 1 505 – 1 831 ms |
| `db.load()` + routes at startup | 1 370 ms |
| process RSS after load / after the build | 433 MB / 874 MB |

The import number is from before OPS-06 (scrypt per imported account) landed; the operations review
has since removed those hashes. The shape of the finding stands: a single synchronous handler that
runs for tens of seconds blocks every other user and drops idle keep-alive connections — my own
loader hit `SocketError: other side closed` on the request that followed a 4 s import.

## 2. What the store costs as it grows

One `Store`, real `flush()`, real `JSON.parse` of the file back in a fresh process:

| attendance rows | total rows | file | `flush()` | startup parse |
| ---: | ---: | ---: | ---: | ---: |
| 10 000 | 55 976 | 17.1 MB | 261 ms | 166 ms |
| 25 000 | 70 976 | 21.9 MB | 316 ms | 236 ms |
| 50 000 | 95 976 | 29.9 MB | 435 ms | 320 ms |
| 100 000 | 145 976 | 45.8 MB | 651 ms | 574 ms |
| 200 000 | 245 976 | 77.8 MB | 1 097 ms | 929 ms |
| **324 000 (5 months)** | **369 976** | **117.4 MB** | **1 932 ms** | **1 393 ms** |
| **612 000 (12 months)** | **657 976** | **209.4 MB** | **3 693 ms** | **3 821 ms** |

Full-year file inside the real app, with the heap capped at 1 GB (a 2 GB VPS):
startup 2 964 ms · `/api/health` 200 · `db.flush()` **4 557 ms** · peak RSS **725 MB** (cap 1 072 MB).
It does not run out of memory, but every forced write freezes the school for four and a half seconds.

## 3. Latency, 20 concurrent clients

20 teacher sessions, each looping over its own lessons; `p95` over all requests in the phase.
"Before" = the code as reviewed, "after" = with the debounce cap from REL-02 (the store now really
writes; the earlier numbers were fast partly because nothing reached the disk — see REL-02).

| endpoint | single client p50 | 20 clients p95 (before) | 20 clients p95 (after the write fix) |
| --- | ---: | ---: | ---: |
| `GET /api/attendance/lesson/:id` | 27 ms | 437 ms | 7 833 ms |
| `GET /api/grades/grid` | 10 ms | 261 ms | 2 427 ms |
| `GET /api/homeroom/classification` | 34 ms | 654 ms | — |
| `POST /api/attendance/lesson/:id` | 57 ms | 916 ms | 3 087 ms |
| `GET /api/principal/completeness` (7 days) | **11 035 ms** | **224 239 ms** | — |
| `GET /api/principal/completeness` (whole semester) | **239 364 ms** | — | — |

Mixed load (60 % roster read / 20 % grid / 20 % attendance write), 20 clients: p95 474 ms before,
2 439 ms after. Single-client reads showed a **7 279 ms outlier** on an otherwise 27 ms endpoint —
a full mark-compact GC over the 324 000-object graph.

Read those two columns together: the "before" latencies are what a durable store costs *minus*
durability. The honest cost of a 118 MB JSON document under 20 users is the right-hand column, and
that is the number that says "move to SQLite", not "tune the debounce".

---

## 4. Findings

Severity: **blocker** — the school stops working or loses data · **major** — recoverable only by hand
· **minor** — friction.

| id | sev | where | what happens / evidence | fix | state |
| --- | --- | --- | --- | --- | --- |
| REL-01 | blocker | `server/routes/principal.js:81` (`/api/principal/completeness`), same shape at `:302` | The principal's completeness board is O(lessons × attendance). 750 lessons (the default 7-day window) × 324 000 rows = 243 M comparisons: **11.0 s single client, p95 224 s with 20 clients**, and because the process is single-threaded *every other user in the school waits those 224 s*. A whole-semester window takes **239 s** for one request. One principal opening one screen is a full outage. | Build the index once per request: `const byLesson = new Map(); for (const a of db.col('attendance')) if (!a.draft) byLesson.set(a.lessonId, (byLesson.get(a.lessonId)||0)+1);` then look up per lesson. Same shape in `homeroom`/`student` monthly views. Longer term: keep a persistent `attendanceCountByLesson` index or move to SQL. | **reported** (owner: 3.3) |
| REL-02 | blocker | `server/lib/store.js` `save()` | `save()` cleared and re-armed a 50 ms timer on every mutation. While the school keeps working, mutations arrive faster than 50 ms, so the timer never fired and **nothing was ever written**. Measured side by side (`tests/46-reliability.test.js`, "the debounce is capped"): with the original unbounded debounce, 289 `save()` calls spread over 3 s produced **0 writes and 0 rows on disk**; with the cap, the same load wrote 191 of 281 rows. Every authenticated request calls `db.save()` to stamp `lastActivity` (`server/index.js`), so a school in session keeps the timer permanently re-armed — a crash or `kill -9` at 12:00 lost everything since the last genuinely quiet moment. | The debounce is now capped: `maxSaveDelayMs` (1 000 ms, `EDMAT_MAX_SAVE_DELAY_MS`) forces the write no matter how much traffic there is. | **fixed** |
| REL-03 | blocker | `server/lib/store.js`, `server/index.js` | Nothing flushed on shutdown. `docker compose restart`, a deploy, an OOM kill or Ctrl+C during the 50 ms window threw the pending write away; the tmp+rename in `flush()` protects against a *torn* file, not against a write that never happened. | Every store with a file registers `SIGTERM`/`SIGINT`/`beforeExit`/`exit` handlers that flush and release the lock; `app.shutdown()` stops accepting connections, flushes, unlocks; the main block wires the signals; `stop_grace_period: 60s` in compose gives a 210 MB write time to finish. | **fixed** |
| REL-04 | major | `server/lib/store.js` | Two processes on one data directory (a stale container, `npm start` next to `docker compose up`, a second replica) each hold the whole document in memory and each rewrite the whole file. The last writer wins and silently deletes the other's day. Nothing detected it. | A lock file `school.json.lock` with pid/host/start time. A second process fails fast with `EDMAT_LOCKED`; a lock left by a process that no longer exists on this host is reclaimed with a warning. | **fixed** |
| REL-05 | blocker | `server/lib/store.js` (whole-document rewrite) | The store does not fit the year. 117.6 MB / 370 k rows at five months, 209 MB / 658 k rows at twelve; `flush()` 1.9 s → 3.7 s (4.6 s in-process), startup parse 1.4 s → 3.8 s, RSS 433 MB → 725 MB. With the write fix in place, p95 for a plain roster read under 20 users is 7.8 s. | Short term: the size guard now warns from 64 MB (and again at every doubling) and when a write takes over 400 ms; the retention job (REL-06) removes the two collections that grow without bound. Real fix: SQLite — thresholds and path in §5. | **fixed (engine)** — per-collection store with dirty tracking and an append log; design, recovery and measurements in `docs/STORAGE.md`, SQLite thresholds in its §9 |
| REL-06 | major | `server/lib/audit.js`, `server/routes/admin.js:571` (`/api/admin/retention/report`), `sessions` | `audit` is append-only and nothing ever removed a row — the report endpoint literally returns `deleted: 0`. `sessions` is never pruned either, and `auth.resolveSession` does a linear `db.one('sessions', …)` **on every request**: at ~650 accounts × 190 days × 2 logins ≈ 250 k session rows the session lookup alone becomes a 250 k scan per request. Both collections sit in the same file that gets rewritten on every write. | New `server/routes/retention.js` (module `registry`): `POST /api/admin/retention/run` — dry run by default, `{confirm:true, reason}` deletes audit rows older than `logRetentionYears` (floored at the statutory `logRetentionMinYears`) and sessions older than `sessionRetentionDays` (90), reports counts per action and per year, writes a `retentionRuns` protocol **and** an audit entry that itself stays. `GET /api/admin/retention/runs` lists them. Cron line in the file header. | **fixed** |
| REL-07 | major | — (no script, no endpoint) | There was no backup and no restore anywhere: no script, no endpoint, no note in the README. The only export was `POST /api/admin/backup/anonymized`, which is for test environments, not for recovery. | `scripts/backup.js`: `backup` (gzipped, verified, rotated), `list`, `verify`, `prune`, `restore` (refuses while the data-directory lock is held, dry-run unless `--yes`, keeps the replaced file as `school-przed-odtworzeniem-*.json`). Daily rotation cron line in the file header; an anonymised snapshot restores through the same path. | **fixed** |
| REL-08 | major | `server/lib/util.js:6` `today()`, `server/lib/domain.js:4` | `today()` is `new Date().toISOString().slice(0,10)` — **UTC**. A blank install leaves `config.today = null`, so production really uses it. Measured with `TZ=Europe/Warsaw`: at `2027-01-15 00:30` local it returns `2027-01-14`; at `2027-07-15 01:30` local it returns `2027-07-14`. Anything run between midnight and 01:00 (02:00 in summer) writes to yesterday: night-shift care entries, cron-driven jobs, `generateLessons`' held/planned split, retention cut-offs. | `today()` should be the wall clock in the school's zone: `new Intl.DateTimeFormat('sv-SE', { timeZone: cfg.timezone || 'Europe/Warsaw' }).format(new Date())` (sv-SE gives ISO order), with `config.timezone` as the knob and `config.today` still overriding it for the demo. Date arithmetic (`addDays`, `weekday`, `daysBetween`) is UTC-anchored on `T00:00:00Z` and is DST-safe as it stands — do not change it. | **reported** (owner: lib) |
| REL-09 | major | `server/routes/attendance.js:15` `schoolNow()`, `server/routes/student.js:190,302`, `Dockerfile` | Time of day comes from the *server's* clock and the container sets no `TZ`, so it is UTC. `schoolNow()` glues the school date to a UTC time-of-day, and `homework.js:29` compares that to a `dueAt` a teacher entered in local time — homework due at 20:00 keeps accepting submissions until 22:00 local in summer. `new Date().toTimeString()` decides "which lesson is now" on the student's dashboard, so the highlighted lesson is 1–2 h out. Lesson times themselves are plain `HH:MM` strings in config and are DST-proof. | `ENV TZ=Europe/Warsaw` in the Dockerfile (and `TZ` in compose), plus one helper `D.nowHm(db)` used everywhere instead of `new Date().toTimeString()`. | **reported** (owner: 3.1 / 3.6 / platform) |
| REL-10 | major | `server/routes/attendance.js:157` | Last-write-wins is only half-applied: `if (existing && existing.atClient && clientAt && clientAt < existing.at) skip` (`:157`). A replayed offline write only loses to another *client-stamped* write. Proven on the demo school: online write at 10:00 sets `ob` (`atClient:false`), the 08:00 queued write replayed afterwards sets `nb` and wins — `saved: 1, skipped: 0`. A correction the teacher made in the browser is silently undone by a phone that came back online. Two client-stamped writes do order correctly. | Drop `existing.atClient` from the condition and compare `clientAt < existing.at` always (a server-stamped `at` is a real instant too), or stamp every write with `atClient:true` on the client. Document the rule on the endpoint: **last write wins by the client's `at`, per lesson+student, and the row id `att_<lesson>_<student>` makes the replay idempotent.** | **reported** (owner: 3.1) |
| REL-11 | major | `public/app/core.js` offline queue | `localStorage` is per *browser*. The queue key was `edmat.queue`, shared by everyone who used that classroom PC: teacher A saved attendance offline, went home, teacher B signed in on the same machine, the browser came back online and **A's attendance was replayed inside B's session and stored with B as the author** (`byUserId`, audit entry, everything). | One queue per account (`edmat.queue.<userId>`), every item carries its `userId`, `flushQueue()` refuses to run unless `state.user.id === state.queueUser` and drops foreign items instead of sending them, the queue is bound on session load and unbound on logout, and a write with nobody signed in is not queued at all. A queue left by an older build has no known author: it is quarantined in `edmat.queue.__unclaimed` and replayed only through an explicit `A.adoptUnclaimedQueue()`. Covered by `tests/46-reliability.test.js`. | **fixed** |
| REL-12 | major | `public/app/core.js` `flushQueue()` | Replay treated everything below 500 as success: a 4xx (semester locked, no longer this lesson's teacher, student transferred out) shifted the item off the queue **and said "Zsynchronizowano"**. The teacher's entry was gone with a green toast. | A 4xx still leaves the queue (the server will never accept it) but lands in `state.queueRejected` and raises a `danger` toast naming the first one (`shell.syncRejected`, pl + en). | **fixed** |
| REL-13 | minor | `server/index.js`, `docker-compose.yml` | No health or readiness endpoint, so the container had no liveness probe and a reverse proxy had nothing to poll; a process wedged in a 224 s completeness request looked identical to a healthy one. | `GET /api/health` — public, no school data at all (`status`, `schemaVersion`, `uptimeSec`, `at`), served even before the first-run wizard has finished. Compose healthcheck with `start_period: 40s` (a big file takes seconds to parse), `restart: unless-stopped`, and capped json-file logging. | **fixed** |
| REL-14 | minor | `server/index.js`, store | `db.data.meta` carried `seededAt` and the seed file list, nothing a future release could branch on. Any change to a stored document's shape would have had to guess. | `server/lib/migrate.js`: `meta.version`, an ordered `MIGRATIONS` list with a no-op `baseline` at version 1, `migrate(db)` called from `createApp` before routes load, `app.migration = { from, to, applied, changed }`. Rules for writing the next one are in the file header. | **fixed** |
| REL-15 | minor | `server/routes/setup.js` imports, `server/routes/admin.js` timetable import | A bulk import is one synchronous handler. 100 students + 100 parents took 11–16 s (scrypt per account, since fixed by OPS-06); 50 teachers 3.8 s. During that time nothing else is served and Node's 5 s keep-alive timer closes idle sockets — every other user gets a dropped connection, and a reverse proxy with a 30 s read timeout gives up on the import itself. | Cap a batch (e.g. 200 rows per request) and let the wizard loop, or yield between rows. Whatever the batch size, keep the import idempotent so a client retry after a proxy timeout cannot double the school (OPS-05 covers the duplicate side). | **reported** |
| REL-16 | minor | heap shape | Everything lives in one object graph. A single-client roster read, normally 27 ms, was measured at **7 279 ms** — a full GC over 370 k live objects. At full year the graph doubles. | Not fixable inside the JSON store; it is another argument for §5. Until then, `--max-old-space-size` should be set explicitly on the VPS so GC behaviour does not depend on how much RAM the host happens to report. | **documented** |
| REL-17 | minor | `server/index.js` logging | `EDMAT_LOG=1` prints `METHOD /path 200 12ms` — no timestamp, no user, no request id, no correlation for the 500s that `console.error` dumps separately. On one process with one log stream that is what you have when a teacher says "it broke this morning". | One line of JSON per request (`ts`, `level`, `method`, `path`, `status`, `ms`, `userId`, `ip`, `reqId`) and the same `reqId` on the error line. Compose already caps the file at 10 MB × 5. | **naprawione** — jedna linia: znacznik ISO, metoda, ścieżka bez query, status, czas, `user=`, `req=` i `code=` przy błędzie JSON; `X-Request-Id` na każdej odpowiedzi (przychodzący honorowany); test `[REL-17]` w `tests/40`. |
| REL-18 | minor | `public/sw.js` | The service worker caches GET `/api/…` responses in a per-browser cache that is not keyed by user either — the same shared-classroom-PC shape as REL-11. The security review has added `A.purgeOfflineCache()` on logout, which covers the ordinary case; a browser closed without logging out still holds the previous user's data. | Noted only — owner: security review. Keying the SW cache by the session cookie's user, or refusing to cache any `/api/` response at all, closes the rest. | **noted** |

### Repro — REL-11 before the fix (shared classroom PC)

```
localStorage['edmat.queue'] = [ {POST /api/attendance/lesson/les_…, body:{allPresent:true}} ]   // teacher A, offline
teacher A signs out · teacher B signs in on the same browser · network comes back
core.js flushQueue() → POST replayed with B's cookie → 200 { saved: 20, byUserId: 'u_wojcik' }
```
After the fix the same sequence leaves A's queue untouched under `edmat.queue.u_nowak`, B's session
sees an empty queue, and a foreign item that somehow reaches memory is dropped rather than sent
(`tests/46-reliability.test.js`, "a queue is keyed by user and is never replayed…").

### Repro — REL-10 (stale offline write beats a newer online correction)

```
POST /api/attendance/lesson/<les>  {entries:[{studentId, status:'ob'}]}                  → row: ob,  atClient:false
POST /api/attendance/lesson/<les>  {entries:[{studentId, status:'nb'}], at:'…T08:00:00Z'} → saved:1, skipped:0
db.one('attendance', …).status === 'nb'      // the 08:00 replay overwrote the 10:00 correction
```

---

## 5. When to leave the JSON store, and what to move to

**Thresholds.** The store stops being appropriate well before it stops working:

| state | file / rows | `flush()` | what it feels like | verdict |
| --- | --- | ---: | --- | --- |
| green | ≤ 25 MB / ≤ 75 k rows | ≤ 320 ms | a write is invisible | fine |
| amber | 25–64 MB / 75–150 k rows | 0.3–0.9 s | occasional stutter when several teachers save at once | fine with the size guard on |
| **red** | **> 64 MB / > 150 k rows** | **> 0.9 s** | every write blocks every user for about a second; the guard starts warning | **plan the migration** |
| stop | > 100 MB / > 500 k rows | > 1.9 s | p95 for a roster read is measured in seconds; restart takes 4 s; GC pauses of several seconds | migrate now |

A 600-student school crosses amber in **October** (~100 k attendance rows), red around **November**,
and ends the year at 210 MB. In other words: the JSON store is right for the pilot and for a small
school (≤ 150 students, ≤ 150 k rows/year); it is not right for the school in the brief.
A useful rule of thumb from the fixture: **attendance rows ≈ students × lessons-per-day ×
school-days**, and each row costs ~320 bytes on disk.

**Migration path to SQLite** (`node:sqlite` ships in Node 22; on Node 18 the same schema works with
`better-sqlite3`, which would be the prototype's first dependency — that is the reason to wait for
the newer Node rather than to break the zero-dependency rule now):

1. **Keep the `Store` API.** `col/get/one/find/insert/update/remove/save/flush` is the entire data
   surface every route uses (`CONTRIBUTING.md` documents exactly this). A SQLite-backed `Store` with
   the same methods is a drop-in; no route changes.
2. **One table per collection**, `CREATE TABLE <col> (id TEXT PRIMARY KEY, doc TEXT NOT NULL)` plus
   generated columns for the fields that are actually filtered on. From the measurements, those are:
   `attendance(lessonId, studentId, date, classId)`, `lessons(date, teacherId, classId)`,
   `grades(studentId, subjectId, semester, classId)`, `sessions(token)`, `users(login)`,
   `audit(at, userId, entity)`. Those six indexes remove every hot scan in this review, REL-01 first.
3. **`PRAGMA journal_mode=WAL; synchronous=NORMAL`** — writes become sub-millisecond and stop
   blocking readers, which is what kills the debounce/starvation/flush family of findings (REL-02,
   REL-03, REL-05) outright.
4. **Migrate with `server/lib/migrate.js`**: migration N reads the JSON document one last time, opens
   the SQLite file, inserts every collection in one transaction, stamps `meta.version = N`, and
   leaves the JSON file in place as the automatic backup. `scripts/backup.js` switches to
   `VACUUM INTO 'plik.sqlite'` — still one file, still a copy taken with the server running.
5. **What must not change:** the document shapes in `CONTRIBUTING.md`, the audit log's WORM rule, and
   `db.data.config` as the single place configuration lives. Routes keep speaking documents; only the
   storage engine underneath them changes.

**Until then**, the operational minimum for the VPS:

- `EDMAT_DATA` on its own volume, `node --max-old-space-size=1536` at least, 2 GB RAM minimum and
  4 GB if the school is at full size (measured peak RSS 725 MB plus a 210 MB string per write).
- `scripts/backup.js backup --keep 30` daily at 02:30 **and rsync'd off the host** — a copy on the
  same disk is not a backup. Restore into a scratch directory once a term and open it with
  `createApp` to prove it.
- `POST /api/admin/retention/run` nightly so `audit` and `sessions` stop inflating every write.
- Health probe on `/api/health`, `stop_grace_period: 60s`, and never `kill -9` a busy process.
- Watch the log for `EdMat: plik danych ma … MB` — that is the store telling you §5 has arrived.

---

## 6. What was changed in this review

| file | change |
| --- | --- |
| `server/lib/store.js` | debounce cap (REL-02), flush + unlock on SIGTERM/SIGINT/beforeExit/exit (REL-03), data-directory lock file with stale-lock reclaim (REL-04), size/flush-time guard warnings (REL-05), `close()`, `stats()` |
| `server/lib/migrate.js` *(new)* | `meta.version`, ordered migrations, no-op `baseline` at 1, rules for the next one (REL-14) |
| `server/index.js` | three lines: `migrate()` before routes, public `GET /api/health` (also allowed through the setup gate), `app.shutdown()` + signal wiring in the main block; `app.close()` now releases the lock |
| `server/routes/retention.js` *(new)* | admin-only dry-run/execute retention job for `audit` + `sessions`, protocol in `retentionRuns`, cron line (REL-06); `retention: 'registry'` in `server/modules.js` |
| `scripts/backup.js` *(new)* | backup / list / verify / prune / restore, gzip, rotation, lock-aware restore, anonymised backups restore through the same path (REL-07) |
| `public/app/core.js` | offline queue keyed by user, foreign items never replayed, quarantine for a legacy queue, 4xx reported instead of dropped (REL-11, REL-12); `shell.syncRejected` added to `public/app/i18n.js` (pl + en) |
| `docker-compose.yml` | `/api/health` healthcheck, `stop_grace_period: 60s`, `restart: unless-stopped`, capped logging (REL-13) |
| `tests/46-reliability.test.js` *(new)* | health (incl. before setup), migrations, SIGTERM flush (real child process), debounce cap, lock + stale-lock reclaim, backup/restore round trip incl. an anonymised backup and a corrupt archive, queue keying + quarantine + 4xx reporting, retention (dry run, reason required, counts, protocol, role guard, session pruning) |

Still open and handed to their owners: **REL-01** (completeness, 3.3 — the single worst number in this
review), **REL-08/REL-09** (time zone, lib + platform), **REL-10** (attendance last-write-wins, 3.1),
**REL-15** (import batching), **REL-17** (log format), **REL-18** (service-worker cache, security).
