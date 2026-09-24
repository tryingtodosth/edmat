# Round 3 — reliability, performance and storage of today's changes at full-school scale

**Question.** Today's work added a year-end archive package, a JRWA retention job, foreign-timetable
importers, a compliance pack, a minimal push payload with fetch-on-receipt, and a register/SIO
screen. Does any of it hold at the school in the brief — **600 pupils, 24 classes, a whole school
year** — on one Node 18 process with the per-collection JSON store?

**Answer.** The importers and `generateLessons` hold: a 24-class aSc file parses in 124 ms and
`findConflicts` costs 2 ms. Three things do not.

1. **A mid-year timetable change freezes the school for 2.7 minutes** (`160.26 s` applied, `72.24 s`
   for the dry run alone). `hasJournal()` asks "is anything written in this lesson?" by scanning the
   whole `attendance` collection, once per dropped lesson. This is REL-01's exact shape, reborn.
2. **`kill -9` during a retention run leaves the deletion durable and the protocol, the audit row and
   the approval gone.** Measured: `attendance 564 000 → 0`, `lessons 22 560 → 0`,
   `audit 22 569 → 0`, `retentionRuns 0`, proposal back to `pending`. The school loses its logbook
   and there is nothing on disk that says who deleted it, when, or under which archive consent.
3. **Retention scans everything on every endpoint** (0.83–1.04 s per scan, twice per
   `GET …/proposal`), and a proposal that really has a year due materialises **586 560 ids into one
   28.9 MB store row** (+178.7 MB RSS while it is built).

Everything below was measured on a fixture built here, not estimated. Scripts:
`docs/review/round3/repro/reliability/`. Hardware: dev container, Node 18.19.1, 6 cores,
`--max-old-space-size=4096`.

---

## 1. The fixture

`node --max-old-space-size=4096 docs/review/round3/repro/reliability/fixture.js --out /tmp/edmat-r3`
builds a blank install through the **real** setup endpoints (school + admin, teacher CSV, six student
CSV batches, timetable CSV, `generateLessons` over the whole year) and then inflates attendance,
grades, notifications and audit directly, the way `scripts/bench.js` `inflate()` does.

| collection | rows | on disk |
| --- | ---: | ---: |
| attendance | 564 000 | 175.4 MB |
| notifications | 79 294 | 16.8 MB |
| grades | 48 000 | 19.7 MB |
| audit | 22 569 | 5.1 MB |
| lessons | 22 560 | 5.8 MB |
| users (50 teachers + 600 pupils + 600 guardians + 2) | 1 252 | 0.5 MB |
| students / timetable / registrationCodes / classes | 600 / 600 / 600 / 24 | 0.5 MB |
| **whole store** | **739 538** | **223.9 MB** |

Build steps (all through the real handlers unless marked): `POST /api/setup/school` 246 ms · teacher
CSV (50) **2.68 s** · student CSV 100+100 **27–35 ms per batch** (REL-15's `breathe()` batching and
OPS-06's removal of the per-account scrypt both hold — this used to be 11–16 s) · timetable CSV (600
rows) 24 ms · `generateLessons` for the year (22 560 lessons) 120 ms · `db.compact()` 4.18 s.

Loading it: **2.53–3.65 s**, RSS after load **589–601 MB**. The store's own guard fires on the way in:
`EdMat: dane szkoły zajmują 224 MB (739 538 wierszy)`. `docs/STORAGE.md` §9 already calls this
"stop — migrate now"; this review is about what today's code does *on top of* that.

---

## 2. Findings

Severity: **blocker** — the school stops working or loses data · **major** — recoverable only by hand
· **minor** — friction.

| id | sev | where (file:line) | measurement (numbers, how measured) | consequence at 600 pupils | smallest fix |
| --- | --- | --- | --- | --- | --- |
| **R3-01** | blocker | `server/routes/setup.js:62` (`hasJournal`), called from `server/routes/admin.js:402` (`lessonImpact`) and `server/routes/setup.js:102,109` (`syncLessons`); entered at `server/routes/admin.js:655` | `repro/reliability/importer.js`. February state (today 2027‑02‑15, 300 000 attendance rows, 12 528 `planned` lessons). One `hasJournal()` on an empty planned lesson = **33 ms** (57–73 ms at the full 564 000 rows) — it is `db.col('attendance').some(a => a.lessonId === l.id)` plus the same over `grades`, `homework`, `substitutions`, and `.some()` only returns early when it *finds* something, so "nothing written here" always costs a full scan. A routine plan correction that drops the 5th period for every class (2 112 lessons): **dry run 72.24 s, applied 160.26 s**, both fully synchronous. During it my own HTTP client got `ECONNRESET` on pooled connections — the 5 s `keepAliveTimeout` fires while the loop is blocked and the server closes idle sockets (REL-15's shape, reproduced live). | One admin fixing the organisational sheet in February freezes every teacher, pupil and guardian in the building for **2.7 minutes**, and any reverse proxy with a 60 s read timeout gives up on the import itself — leaving the operation half-believed. `/api/health` cannot answer either, so the container looks dead and gets restarted mid-write. | Index once per import instead of per lesson: before the loop build `const written = new Set(); for (const a of db.col('attendance')) written.add(a.lessonId); for (const g of db.col('grades')) if (!g.deleted) written.add(g.lessonId); …` and make `hasJournal(db, l, written)` a `written.has(l.id)` lookup. Same fix as REL-01. |
| **R3-02** | blocker | `server/routes/retention.js:526` (`sweepOperational`) vs `:541` (`retentionRuns` insert) and `:553` (`ctx.audit`) | `repro/reliability/crash.js retention-write`. `kill -9` 4 200 ms into `POST /api/admin/retention/run`, before the handler returned. Store reopens cleanly — and holds: `attendance 564 000 → 0`, `lessons 22 560 → 0`, `audit 22 569 → 0`, `notifications 79 294 → 0`, `sessions 1 → 0`, store 223.9 MB → 49.7 MB. `retentionRuns` = **0**. `retentionProposals` = one row, status **`pending`** — even the `approve` that preceded the run never reached disk. No `retention_executed` audit row. | The whole logbook is gone and **nothing on disk says it was a retention run**: no protocol, no audit entry, no approved proposal, no archive-consent reference. The one operation in the system that is allowed to delete is also the one whose accountability trail is the least durable. The same proposal is still `pending`, so the screen invites the operator to approve and run it again. | Make the protocol durable *before* the deletion: insert the `retentionRuns` row and write the audit entry first, `db.flush()`, then `sweepOperational`/`removeIds`, then `db.flush()` again and patch the run row with the counts. One extra flush, two lines moved. |
| **R3-03** | major | `server/routes/retention.js:311` (`classPlan`), `:319`/`:436` (`_items`), `:448` (`proposalView` re-scans) | `repro/reliability/retention.js`. `classPlans()` walks `attendance` + `lessons` + `remarks` + `grades` + `audit` + `notifications` + `sessions` = 736 926 rows: **1.04 s**. It runs on `GET …/runs` (**807 ms**), on `POST …/run` even as a dry run (**774 ms**) and **twice** on `GET …/proposal` (`buildProposal` → `proposableRows` → `classPlans`, then `proposalView` → `classPlans` again): **1.50 s**. With a year actually due (clock moved to 2033‑06‑30) `GET …/proposal` is **2.11 s** and builds `_items` = **586 560 ids**, stored as one `retentionProposals` row of **28.9 MB** (RSS +178.7 MB while building). `POST …/run` 2.89 s + a 948 ms flush. A push `…/render` queued behind one `GET …/proposal`: **21 ms → 1.69 s**. | The nightly cron line in the file header (`POST …/run`) blocks the school for ~1 s every night — acceptable. The admin screen is not: opening the retention tab is a 0.8–2.1 s freeze, and every refresh rebuilds a 28.9 MB document that the store then writes in full. The 586 560-id list is also a lie about atomicity: it is a snapshot of ids that may no longer exist when the run executes. | (a) `proposalView` should take the rows `buildProposal` already computed instead of calling `classPlans` again — one argument. (b) `classPlan` should only collect `_items` when the caller needs them (`{ withItems: true }`), so `GET …/runs` and the dry run stop materialising 586 k strings. (c) Store the proposal as *criteria* (class + cut-off date) and re-derive ids at run time, instead of a 28.9 MB id list. |
| **R3-04** | major | `server/routes/principal.js:499`+`:510` vs `server/lib/router.js:32` (`UPLOAD_ROUTES`) | `repro/reliability/archive.js`. The handler advertises `config.archiveSignatureMaxMB || 5` and passes `maxMB: 5` to the upload gate, but `/api/principal/archive/:id/signature` is **not** in `UPLOAD_ROUTES`, so `bodyLimitFor()` returns `BODY_LIMITS.json` = **512 kB**. Measured: 200 kB signature → HTTP 200 (86 ms), 300 kB → HTTP 200 (98 ms), **400 kB → request fails with `ECONNRESET`**, 1 MB and 5 MB the same. base64 inflates 4/3, so the real ceiling is ~**380 kB**. `readBody` (`router.js:20`) rejects with a 413 **and then calls `req.destroy()`**, so the 413 never reaches the browser. | The last step of the § 22 workflow — hand back the qualified signature — fails for any PAdES/enveloping signature over ~380 kB (a PAdES‑LT over the package is routinely megabytes). The principal sees "połączenie przerwane", not "plik za duży", on the one deadline the regulation actually fixes. | Add `/^\/api\/principal\/archive\/[^/]+\/signature$/` to `UPLOAD_ROUTES` (or `{ roles:['principal'], maxBody: 8*1024*1024 }` on the route), and in `readBody` send the 413 before destroying the socket (`res` is not in scope there — simplest is to stop reading and let the promise reject *without* `req.destroy()`, or destroy after a tick). |
| **R3-05** | major | `server/routes/registry.js:621`; `server/lib/blank-seed.js:44–57` has no `sio` key | `repro/reliability/misc.js`. `POST /api/registry/sio/validate` on the fixture (a school born from the first-run wizard) → **HTTP 500**, `TypeError: Cannot read properties of undefined (reading 'schemaVersion')`. The demo seed sets `config.sio`; `blankSeed()` does not, and the wizard never creates it. `GET …/sio/package` survives; only `validate` reads `config.sio` unguarded. | The SIO self-check — today's R7 work — is a 500 on **every real installation**, because every real installation is a blank install. The registrar gets "Błąd serwera." with no code and nothing to act on. The demo hides it, which is why no test caught it. | `const sio = db.data.config.sio || {};` at the top of the handler and read `sio.schemaVersion`; add a default `sio: { schemaVersion: '…', namespace: '' }` block to `blank-seed.js`, and give `tests/56-register-sio.test.js` one case on `createApp({ blank: true })`. |
| **R3-06** | major | `server/lib/xmlcheck.js:51` (`at(open.pos)` inside the message) with `:26–27` | `repro/reliability/misc.js`. `fail()` caps the error list at 50, but the `tag_mismatch` message interpolates `at(open.pos).line` **eagerly, for every mismatch**, and `at()` is `s.slice(0, pos).split('\n')` — O(n) each. Measured on `<a></b>` repeated: 20 000 mismatches / 137 kB → **0.65 s**; 40 000 / 273 kB → **2.25 s**; 70 000 / 479 kB → **6.74 s**. Quadratic (2× size ⇒ 3.4× time). `POST /api/registry/attendance/import` takes `{xml}` under the 512 kB JSON body limit, so 479 kB is reachable. Well-formed input is fine: the 4.6 MB year archive XML validates in 250 ms / 51 626 elements. | Any account with the registrar role can freeze the whole school for ~7 s with one half-megabyte paste of a broken export — and a broken export is exactly what somebody pastes into a validator. | Two changes in `fail`/the message: keep the position and resolve it lazily (`fail('tag_mismatch', (p) => …, lt, open.pos)`), and bail out of the scan once `errors.length >= 50`. Cheaper still: memoise line starts once (`const lineStarts = [...]` + binary search) so `at()` is O(log n). |
| **R3-07** | major | `server/routes/compliance.js:87` (`{ public: true }`), `server/lib/compliance.js:347` (`facts`), `:256` (`hashPassword` probe), `server/routes/privacy.js:37` (`scanTrackers`) | `repro/reliability/misc.js` + `repro/reliability/compliance.js`. `GET /api/compliance/accessibility` is public — no session, no rate limit — and rebuilds the whole fact set per call: **138 ms**, of which ~58 ms is `security()` running a **real scrypt KDF** plus `encryptForReaders` plus an RSA `sealDocument` only to read back the algorithm names, and ~100 ms is `scanTrackers()` reading every file under `public/` from disk. 50 unauthenticated requests: **wall 6.59 s, p50 3.31 s, p95 6.19 s** — the process serves nothing else in that time. | An unauthenticated GET loop from anywhere on the internet is an outage button for a single-process school server. It also costs the DPO: five refreshes of `/api/compliance/dpia` = **733 ms** of dead process (worst single event-loop stall 167 ms), and a teacher's roster read goes **42 ms → 312 ms** behind them. | Cache `facts(db, app)` for ~60 s keyed by `db.stats().totalRows` + `config` mtime (it is a snapshot document, not live data); hoist the three crypto probes to module scope — they do not depend on `db` except for `schoolPrivateKey` — and cache `scanTrackers()` for the process lifetime (`public/` cannot change without a redeploy). |
| **R3-08** | major | `server/routes/setup.js:292` (`recordImport` runs *after* the row loop) with `:129` (`breathe()`) | `repro/reliability/crash.js import`. `kill -9` 90 ms into a 600-row `POST /api/setup/students/import`: the store reopens clean and holds **students 600 → 700, users 1 252 → 1 452, registrationCodes 600 → 700 — and `imports` 7 → 7**. The `breathe()` yield every 50 rows is exactly what lets the 50 ms debounce fire mid-batch, so half a batch becomes durable before the batch row exists. | 100 pupils, 200 accounts and 100 registration codes are in the school with no batch to undo (`POST /api/setup/imports/:id/undo` has nothing to act on) and no audit row. The admin re-runs the file, the PESEL duplicate check rejects those 100 rows, and the roster ends up split across two half-imports that nobody can roll back. | Insert the `imports` batch row **first**, with `status: 'running'`, and append ids to it as rows are created (it is one small document in a cold collection); mark it `done` at the end. A batch left `running` after a restart is then visible and undoable. |
| **R3-09** | major | `server/lib/archive.js:164` (whole package in memory) + `server/routes/principal.js:464` (xml/html/manifest/seal stored in the row), `:510` (signature base64 in the row), `:534` (`a.verified` write on a **GET**) | `repro/reliability/archive.js`. `POST /api/principal/archive`: **859 ms** synchronous, RSS +56–96 MB peak; the row serialises to **5.2 MB** (4.6 MB XML + 48 kB HTML + manifest + seal) and the store grows 223.9 → 229.1 MB. A second package: 241.0 MB, process RSS **926 MB**. The blob itself is cheap *until something touches the row*: with a 5 MB signature on it (6.7 MB base64, row 11.8 MB) a `GET …/verify` — which writes `a.verified` — costs **290–336 ms per call**, because a hot-collection update logs the **whole document** and then trips `logBytes >= snapBytes/2` into an immediate full snapshot rewrite. And while `archives` is still a *cold* collection (`hotBytes` = 4 MB, so any school whose year XML is under 4 MB — under roughly 500 pupils — **forever**), every flush re-serialises it: measured with `EDMAT_HOT_BYTES=64MB`, one attendance write + flush goes **11 ms → 50 ms**, on every request, all year. | At 600 pupils the archive alone adds 5.2 MB per year and 6.7 MB per signature to a store that is already past `docs/STORAGE.md`'s "migrate now" line, and pushes peak RSS to 926 MB — over the 725 MB that reliability.md §2 used to size a 2 GB VPS. At a 300-pupil school (the size this store *is* right for) the same feature makes every single save 4–5× slower for the rest of the year. | See §5: keep the XML, the HTML and the signature bytes in `data/school/files/`, and keep only `{ name, bytes, sha256, path }` in the row. Short of that: (a) `GET …/verify` must not write (`a.verified` is derived — compute it, do not store it); (b) add `'archives'` to `HOT` in `store.js` so it never sits in the cold-compare path. |
| **R3-10** | major | `server/routes/notifications.js:321` (`mine`), `:277` (`sweepDeferred` full scan), `public/sw.js:183` (`fetchRendered`, no timeout) | `repro/reliability/notifications.js`. After a morning absence sweep (600 guardians, `D.notify` 148 ms) there are 79 894 notification rows. `db.get('notifications', id)` is a linear `arr.find`: **4.0 ms**; `db.col('notifications').filter(mine)` **4.1 ms**. Bursts: 200 concurrent `GET …/:id/render` → wall 1.50 s, p50 782 ms, p95 1.36 s; 200 `…/unread-count` → p50 1.23 s; 200 `…/feed` → p50 791 ms, p95 1.46 s. At the size a real sweep produces — **600 concurrent renders, one per guardian** — wall **4.23 s**, p50 **2.68 s**, p95 **3.84 s**, and nothing else is served for those 4.2 s. `public/sw.js fetchRendered()` passes no `AbortSignal` and no timeout, so when the server is blocked (R3-01: 72–160 s) the push event never settles and Chrome replaces it with its own "this site has been updated in the background". | R6's minimal payload turns every push fan-out into a synchronised stampede against the one process that just sent it, and the fallback that was designed for "offline" never runs for the case it matters most — "the school's own server is busy". | Server: index `notifications` by id and by `userId` once at load (two `Map`s maintained in `D.notify`/`read`), which also fixes `unread-count`, polled on every navigation. Client: `fetch(..., { signal: AbortSignal.timeout(4000) })` in `fetchRendered` and fall through to `PUSH_FALLBACK`. Optional: spread the fetch with the jitter the server already knows about. |
| **R3-11** | minor | `server/routes/notifications.js:176–199` (`enqueuePush` → in-process `st.jobs`), `:268` (`sweepDeferred` skips `pushQueuedAt`) | `repro/reliability/jitter.js`. With `config.push.jitterSeconds = 600`, an ordinary push sits in the in-memory queue: after 300 ms its `pushDeliveries` row is still `pending` and nothing has been sent. A crisis alert queued behind it goes out **4 ms later** — the `schedulePump` fix is correct and verified (`timerAt <= when` re-arms on the earlier deadline). But the pending job exists only in the `QUEUES` WeakMap; nothing re-queues a `pending` `pushDeliveries` row at boot, and `sweepDeferred` skips any notification that already has `pushQueuedAt`. | A restart or deploy inside the jitter window — up to an hour, and the window exists precisely so the window is long — silently drops every queued push. The `pushDeliveries` row stays `pending` for ever, which reads as "we tried and never heard back" rather than "we never sent it". | On boot (and in `sweepDeferred`), re-queue `pushDeliveries` rows with `status === 'pending'` whose notification is still inside `releaseWindowHours`; otherwise mark them `failed` with a reason so the row is honest. |
| **R3-12** | minor | `server/routes/setup.js:133` (`undoBlockers`) called per batch at `:298`; `server/routes/registry.js:282` | `repro/reliability/misc.js`. `GET /api/setup/imports` = **418 ms**: it calls `undoBlockers()` for every batch, and that is a `grades.some()` + `attendance.some()` per pupil in the batch (600 pupils across 6 batches here). `.some()` short-circuits only on a hit, so a batch whose pupils have *nothing* yet — the batch you actually want to undo — is the slowest. `GET /api/registry/students/:id/transcript` = **152 ms**: `db.col('subjects').filter(su => db.col('grades').some(…))` is 18 × 48 000. | The admin's import screen and the registrar's transcript are both a few hundred milliseconds of blocked process; annoying rather than dangerous, but they are on the same single thread as everything else. | Same index-once shape: build `Set`s of `studentId` from `grades` and `attendance` once per request, before the batch loop; for the transcript, build one `Set` of the pupil's subject ids from a single pass over `grades`. |
| **R3-13** | minor | `server/routes/principal.js:486` (`packageOf` → `AR.buildArchivePackage`), `:443` (`packageView`) | `repro/reliability/archive.js`. `GET …/package` rebuilds the whole 4.7 MB ZIP (CRC32 in pure JS) from the stored parts on **every** download: 99–122 ms, RSS +14–19 MB. `GET …/xml` 47–127 ms for 4.6 MB. `GET /api/principal/archive` (the list) 6–22 ms. | One download a year, so the cost is fine; but it is a synchronous 100 ms stall on a process that has none to spare, and the reproducible-ZIP guarantee it buys is already provable from the stored `sha256`. | Cache the built ZIP on the row (`package.zipBase64`) — or, better, on disk per §5 — and serve the bytes. |

Two things the brief asked about and that **hold**, with the numbers, so they are not findings:

- **The importers.** A 24-class aSc export generated here (744 `<lesson>`, 744 `<card>`, group splits
  and an A/B informatics pair — `repro/reliability/importer.js` scales `tests/fixtures/real-formats/_gen/gen_asc.py`'s
  shapes in memory; nothing under `tests/fixtures/` was touched): `parseAsc` **124 ms**, the whole
  `POST /api/admin/timetable/import` dry run **180 ms**, `findConflicts` on the 744 rows **2 ms / 4
  conflicts**. `findConflicts` *is* O(k²) inside one `(weekday, lessonNo, key)` bucket
  (`pairsOf`, `admin.js:326`): 800 rows sharing one room in one window = 90 ms. A 24-class school
  cannot fill a bucket like that (max 24), so it stays a footnote, not a finding.
- **`generateLessons` with A/B weeks for the year.** 744 timetable rows (24 A, 24 B, 696 every week)
  over 2026‑09‑01 → 2027‑06‑25: **89–142 ms** for 27 096 lessons, flush 128–169 ms.
- **`publicConfig` and the request log.** `GET /api/auth/session` p50 **2 ms**, 3.9 kB;
  `schoolPrivateKey`, `ipAllowlist` and `retention` are all absent from the response,
  `schoolPublicKey` (public by design) is there. The `EDMAT_LOG=1` line costs nothing measurable.
- **`setup.js breathe()` batching.** 100 pupils + 100 guardians per request: **27–35 ms**. REL-15's
  11–16 s is gone. (Its crash behaviour is R3-08.)
- **The `schedulePump` fix.** Verified working — see R3-11.

---

## 3. Measurement table

| what | how measured | number |
| --- | --- | ---: |
| store load (739 538 rows / 223.9 MB) | `repro/reliability/archive.js`, `createApp` → first request | 2.53–3.65 s |
| RSS after load | `process.memoryUsage().rss` | 589–601 MB |
| `POST /api/principal/archive` | HTTP round trip, `repro/reliability/archive.js` | **859 ms** |
| … RSS while it runs | 20 ms sampler around the request | 662 → **718 MB** (peak +56 MB; +96 MB on a colder heap) |
| … output | response | xml 4.6 MB · zip 4.7 MB |
| what it adds to the store | `dirBytes` before/after + row JSON length | **+5.2 MB per package** (row 5.2 MB) |
| `GET …/archive/:id/package` (zip rebuilt each time) | 5 downloads | 99–122 ms · 4.7 MB · RSS +14–19 MB |
| `GET …/archive/:id/xml` | 1 request | 47–127 ms · 4.6 MB |
| `GET …/archive/:id/verify` (writes `a.verified`) | 1 request | 45–111 ms |
| signature upload, 200 kB / 300 kB file | `POST …/signature` | HTTP 200, 86 / 98 ms |
| signature upload, 400 kB / 1 MB / 5 MB file | same | **ECONNRESET** (512 kB body limit, `req.destroy()`) |
| 5 MB signature written at the store level | row assignment + flush | 397 ms · row → 11.8 MB · store → 235.8 MB |
| flush after one attendance write, baseline | 20 iterations, p50/p95 | **11 ms / 18 ms** |
| … with an archive in the store (`archives` hot) | same | 10 ms / 13 ms |
| … with the 11.8 MB signed row (`archives` hot) | same | 10 ms / **53 ms** |
| … with `archives` **cold** (`EDMAT_HOT_BYTES=64MB`) | same | **50 ms / 51 ms** |
| five `verify`-shaped writes to the signed row | flush after each | **290, 336, 304, 332, 307 ms** |
| second package, store total | after flush | 241.0 MB · RSS **926 MB** |
| `RET.classPlans()` (the retention scan) | direct call, 736 926 rows walked | **0.83–1.04 s** |
| `GET /api/admin/retention/runs` | HTTP | **807 ms** |
| `GET /api/admin/retention/proposal` (nothing due) | HTTP, twice | **1.50 s / 1.48 s** |
| `POST /api/admin/retention/run` (dry run) | HTTP | **774 ms** |
| `GET …/proposal` with a year due (clock 2033‑06‑30) | HTTP | **2.11 s**, RSS +178.7 MB |
| `retentionProposals` row at that volume | `JSON.stringify(row).length` | **28.9 MB** (attendance 564 000 + lessons 22 560 ids) |
| `POST …/run` (confirm + proposal) | HTTP + flush | 2.89 s + **948 ms** flush |
| `CP.facts(db, app)` | direct call | 149 ms |
| … of which `security()` (scrypt + RSA probes) | direct call | **58 ms** |
| … of which `scanTrackers()` (disk scan of `public/`) | `GET /api/privacy/trackers` | **103 ms** |
| `GET /api/compliance/dpia` | HTTP | **183 ms**, worst event-loop stall 167 ms |
| `GET /api/compliance/facts` / `dpa` / `accessibility` | HTTP | 147 / 160 / 138 ms |
| **five DPO refreshes of `/dpia` in a row** | HTTP ×5 | **733 ms total**, worst stall **139 ms** |
| a teacher's roster read behind those five | concurrent | **42 ms → 312 ms** |
| 50 **unauthenticated** `GET /api/compliance/accessibility` | concurrent, no session | **wall 6.59 s**, p50 3.31 s, p95 6.19 s |
| `D.notify` for 600 guardians (morning sweep) | direct | 148 ms |
| `db.get('notifications', id)` at 79 894 rows | ×100 | **4.0 ms each** |
| `GET /api/notifications/:id/render`, idle | HTTP | 7–21 ms |
| **… 200 concurrent** | HTTP | wall 1.50 s · p50 782 ms · **p95 1.36 s** |
| … 600 concurrent (one per guardian) | HTTP | wall **4.23 s** · p50 2.68 s · **p95 3.84 s** |
| `GET …/unread-count`, 200 concurrent | HTTP | p50 1.23 s · p95 1.26 s |
| `GET …/feed`, 200 concurrent | HTTP | p50 791 ms · p95 1.46 s |
| `…/render` queued behind one `GET …/proposal` | concurrent | **21 ms → 1.69 s** |
| `ASC.parseAsc` on a 24-class export (0.2 MB, 744 cards) | direct | **124 ms** |
| `POST /api/admin/timetable/import` dry run (aSc) | HTTP | **180 ms** · 744 rows · 4 conflicts |
| `findConflicts(744 rows)` | direct | **2 ms** |
| `findConflicts`, 800 rows in one room/window | synthetic | 90 ms (O(k²) `pairsOf`) |
| `generateLessons` for the year with A/B weeks | direct | **89–142 ms** · 27 096 lessons |
| `hasJournal(db, lesson)` on an empty planned lesson | ×10–20 | **33 ms** (300 k rows) / **57–73 ms** (564 k rows) |
| **mid-year plan change, dry run** | HTTP | **72.24 s** |
| **mid-year plan change, applied** | HTTP | **160.26 s** (2 112 lessons cancelled) |
| `POST /api/registry/students/import`, 600-row dry run | HTTP | **218 ms** · 138 kB response |
| `POST /api/registry/sio/validate` | HTTP | **HTTP 500** (`config.sio` undefined) |
| `GET /api/registry/sio/package?force=1` | HTTP | 13 ms · 0.1 MB |
| `xmlcheck.wellFormed` on the 4.6 MB year XML | direct | 250 ms · 51 626 elements |
| `xmlcheck.wellFormed`, 20 k / 40 k / 70 k mismatched tags | direct, 137/273/479 kB | **0.65 s / 2.25 s / 6.74 s** |
| `GET /api/setup/imports` | HTTP | **418 ms** |
| `GET /api/registry/students/:id/transcript` | HTTP | **152 ms** |
| `GET /api/auth/session` | HTTP ×50 | p50 2 ms · p95 3 ms · 3.9 kB |
| **RSS after all of the above in one process** | `process.memoryUsage().rss` | **692–926 MB** |

---

## 4. Crash-safety log

`repro/reliability/crash.js` copies the fixture, spawns a child that boots the real app and starts
the operation, `SIGKILL`s it after a set delay, then reopens the store through `Store.load()` (the
real recovery path, including `.jsonl` replay and quarantine) and reports what is there.

| # | killed during | finished? | store reopens | torn / quarantined / `.tmp` left | what is on disk afterwards |
| --- | --- | --- | --- | --- | --- |
| 1 | `POST /api/principal/archive`, 400 ms in (mid-build: XML + zip, before the insert) | no | yes | none | **nothing changed** — `archives` empty, 223.9 MB. Clean. |
| 2 | the same, 950 ms in (while the 5.2 MB `archives` snapshot is written) | had just finished | yes | none | `archives` = 1 complete row (xml 4 831 834 B, package, seal, no signature), audit +2, store 229.1 MB. **Whole or not at all — correct.** |
| 3 | `POST /api/admin/retention/run`, 1 500 ms in (mid-scan) | no | yes | none | **nothing changed** — no deletions, no protocol. Clean. |
| 4 | `POST /api/admin/retention/run`, 4 200 ms in (while the replaced collections are written) | **no** | yes | none | **attendance 564 000 → 0 · lessons 22 560 → 0 · audit 22 569 → 0 · notifications 79 294 → 0 · sessions → 0 · store 223.9 → 49.7 MB · `retentionRuns` 0 · proposal back to `pending`.** Every file is individually whole; the *operation* is not. **→ R3-02 (blocker).** |
| 5 | `POST /api/setup/students/import` (600 rows), 90 ms in (mid-batch, after a `breathe()` yield) | **no** | yes | none | **students 600 → 700 · users 1 252 → 1 452 · registrationCodes 600 → 700 · `imports` 7 → 7.** 100 pupils and 200 accounts with no batch row and no audit row. **→ R3-08 (major).** |
| 6 | the same, 400 ms in (just after it wrote) | yes | yes | none | students 600 → 1 200, users → 2 452, codes → 1 200, `imports` 7 → 8. Consistent. |
| 7 | a burst of 40 attendance writes, 1 200 ms in (the ordinary case, for comparison) | yes | yes | none | audit +1, sessions +1. Clean. |

**What the store itself did well.** In all seven kills there was **no torn snapshot, no quarantined
file, no leftover `.tmp`, and no warning on reload** — `writeAtomic`'s tmp+rename and the append-log
replay behaved exactly as `docs/STORAGE.md` §5 promises, at 224 MB and 739 k rows. Every failure
above is a failure of **write ordering inside a handler**, not of the storage engine: the engine
guarantees each *file* is whole, and neither retention nor the importer arranges for the *operation*
to be whole. That distinction is worth putting in `docs/STORAGE.md` §5 as its own row — "a multi-file
flush is not a transaction" — because two of today's three new write paths assumed otherwise.

---

## 5. Where large blobs should live

**Recommendation: on disk, in `data/school/files/`, with only a descriptor in the store.**

The measurements say this plainly:

- The store is a **whole-collection, in-memory, JSON-serialising** engine. Its one performance
  promise (`docs/STORAGE.md` §3) is that a write costs what *changed*. That promise holds for rows;
  it does not hold for blobs, because the unit of change is a whole document. A 5 MB signature on an
  `archives` row makes every write that touches that row cost **290–336 ms** (log the whole row, then
  trip compaction and rewrite the whole snapshot), and `GET …/verify` is such a write.
- Below `hotBytes` (4 MB) a collection is *verified, not tracked* — re-serialised and string-compared
  on **every** flush. A 3.5 MB archive row at a 300–500-pupil school therefore taxes every single
  request for the rest of the year: measured **11 ms → 50 ms** per attendance write. The school this
  store is actually right for is the one this hurts most.
- Blobs inflate everything that is sized by the store: load time (2.5 → 3.3 s), RSS (601 → 926 MB
  with two packages and a signature — past the 725 MB that reliability.md used to size a 2 GB VPS),
  `scripts/backup.js`'s single gzipped document, and the anonymised export.
- None of the blob bytes are ever *queried*. `xml`, `html`, `manifestJson`, `sealJson` and
  `signature.contentBase64` are written once and streamed back byte-for-byte. They are files
  pretending to be documents.
- base64 is a 33 % tax on top: the 5 MB signature occupies 6.7 MB in the store, in memory, in the
  backup and in every serialisation.

Concretely:

```
data/school/files/archives/<archiveId>/dziennik-2026-2027.xml
                                      /dziennik-2026-2027.html
                                      /manifest.json  /manifest.sha256  /seal.json
                                      /podpis.xml                      (as uploaded, raw bytes)
                                      /dziennik-2026-2027-archiwum.zip (built once, cached)
```

and in the `archives` row only

```json
{ "id": "...", "year": "2026/2027", "at": "...", "byUserId": "...",
  "files": [{ "name": "dziennik-2026-2027.xml", "bytes": 4831834, "sha256": "…", "path": "archives/arc_…/dziennik-2026-2027.xml" }],
  "package": { "name": "…zip", "bytes": 4947…, "sha256": "…", "manifestSha256": "…" },
  "signature": { "name": "podpis.xml", "type": "application/xml", "bytes": 5242880, "sha256": "…",
                 "kind": "xades", "signedFile": "manifest.sha256", "verification": "digest-matched", "at": "…", "by": "…" } }
```

The row stays under 2 kB, the collection stays cold and cheap, `__raw` responses become
`fs.createReadStream` (which also removes the 100 ms synchronous ZIP rebuild, R3-13), and
`sha256` in the row is still the integrity proof — the seal is over `manifest.json`, whose hash is
recorded, so nothing about § 22 changes.

Three things the move must carry:

1. **The directory is part of the data directory**, so `scripts/backup.js` must include it (the
   gzipped single document gains a `files: { path: base64 }` map, or the backup becomes a tar — the
   former keeps `verify`/`restore` shapes). A backup that silently stops containing the signed
   package would be worse than the current cost.
2. **Deletion follows the row.** Retention class `protokoly-rady-pedagogicznej` is category A and
   never deletes `archives`, so today nothing orphans; if that ever changes, removing a row must
   remove its directory, and `Store._sweepOrphans` must not touch `files/`.
3. **Writes go through one gate**, the way `lib/uploads.js` is the one gate for attachments: a
   `lib/blobs.js` with `put(kind, id, name, buffer) → {path, bytes, sha256}` and `open(descriptor)`,
   so no route ever writes into `data/` itself (the rule `CONTRIBUTING.md` already states).

Until that lands, the two one-line mitigations are: add `'archives'` to `HOT` in
`server/lib/store.js` (so a small school stops paying the cold-compare tax), and stop writing
`a.verified` from a `GET` (`principal.js:534`) — it is derived, not stored.

---

## 6. Counts

- **13 findings**: 2 blocker (R3-01, R3-02), 8 major (R3-03…R3-10), 3 minor (R3-11, R3-12, R3-13).
- **By area**: timetable import / lessons 1 (blocker R3-01) · retention 2 (blocker R3-02, major
  R3-03) · archive + signature 3 (majors R3-04, R3-09; minor R3-13) · register/SIO 2 (majors R3-05,
  R3-06) · compliance 1 (major R3-07) · setup import 1 (major R3-08) · push + service worker 2
  (major R3-10, minor R3-11) · cross-cutting per-row scans 1 (minor R3-12).
- **New synchronous loops over `attendance` or `lessons` in a request handler at year volume: 4** —
  `setup.js:62` (`hasJournal`, R3-01), `retention.js:311` (`classPlan`, R3-03),
  `setup.js:139` (`undoBlockers`, R3-12), `registry.js:282` (transcript, R3-12).
  `archive.js:119–120` walks both too but indexes them once into a `Map` first, which is why the
  package build is 859 ms and not minutes — that is the pattern the other four should copy.
- **Crash scenarios run: 7** (2 archive, 2 retention, 2 import, 1 attendance baseline).
  **Store-level damage: 0** — no torn file, no quarantine, no leftover `.tmp` in any of them.
  **Operation-level damage: 2** (crash #4 → R3-02, crash #5 → R3-08).
- **Endpoints measured at 600 pupils / 24 classes / full year: 21.**
  **Slowest single request measured: 160.26 s** (`POST /api/admin/timetable/import`, applied).
  **Largest single store row measured: 28.9 MB** (`retentionProposals`).
  **Peak process RSS measured: 926 MB.**
- **Repro scripts: 10**, all under `docs/review/round3/repro/reliability/`
  (`fixture.js`, `rlib.js`, `archive.js`, `retention.js`, `compliance.js`, `notifications.js`,
  `jitter.js`, `importer.js`, `misc.js`, `crash.js`). Nothing outside `docs/review/round3/` was
  changed; `tests/fixtures/` was read, never edited.
