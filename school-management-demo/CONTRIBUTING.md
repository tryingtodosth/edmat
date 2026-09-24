# EdMat prototype — contributor contract

Single-school prototype ("single node"): ONE Node 18 process, ZERO npm dependencies, JSON-file store, React 18 UMD + the EdMat design-system bundle, no bundler. Acceptance is the user-story checklist at `../checklist.md`; every story needs a passing `node --test` test whose name carries its id, e.g. `test('[3.1.4] teacher defines a grade category …')`. Story ids are `<section>.<n>` counting `- [ ]` lines in order under each `## 3.x` heading of `checklist.md` (3.1.1 is the first story of 3.1). `node scripts/checklist-status.js` reports coverage; `--write` marks the checklists.

## Layout

```
server/index.js          http server, static files, API dispatch (do not edit; extend via routes/seed)
server/auth.js           login, sessions (15-min inactivity), TOTP, password policy, IP allowlist, dev login
server/lib/util.js       ids, wall-clock time in the school's zone (localDate/localTime/zoneOffsetMinutes/toInstant), dates, plural(), validatePesel(), parseGrade(), pointsToGrade(), average(), attendanceStats()
server/lib/store.js      the JSON store: one file per collection under data/school/ + an append log for hot ones (docs/STORAGE.md)
server/lib/migrate.js    one-off migration of a legacy single-file data/school.json into that layout
server/lib/uploads.js    validateUpload/validateUploads — the ONE gate every browser-sent attachment goes through
server/lib/webpush.js    Web Push with zero dependencies: VAPID keys + ES256 token (RFC 8292), RFC 8291 payload encryption, sendPush(); webpush.transport is the seam tests stub
server/lib/crypto.js     hashPassword, TOTP, RSA keypairs, encryptForReaders/decryptFor, sealDocument
server/lib/audit.js      audit(db, {action, entity, entityId, before, after, reason}) — append-only; query(db, filters)
server/lib/router.js     httpError(status, msg, extra)
server/seed/00-base.js   the school: config, users, classes, students, groups, timetable, lessons, gradeCategories, curriculum
server/seed/NN-<domain>.js   YOUR seed: exports seed(db, ctx) — add collections/rows; runs after 00-base in file order
server/routes/<domain>.js    YOUR routes: exports register(r, app)
public/app/core.js       window.EdApp: api, useApi, useAppState, navigate, screen(), toast, onSave, fmt* helpers
public/app/shell.js      login gates, TopBar from registry, timeout dialog, sync bar, toasts, announcements
public/app/screens/<name>.js  YOUR screens: EdApp.screen({...}); files are concatenated in name order
tests/<section>.test.js  YOUR tests, with startServer() from tests/helpers.js
```

## Server conventions

- Route: `r.get('/api/x/:id', handler, { roles: ['teacher','homeroom','principal'] })`. Handlers get `ctx = { db, user, session, body, query, params, ip, util, audit(entry), setCookie }` and return a JSON-able value (or `{ __raw: true, body, contentType, filename }` for CSV/XML/text downloads). Throw `httpError(400, 'Komunikat po polsku', { code })` for errors.
- Role names: teacher, principal, counselor, psychologist, specialEducator, speechTherapist, supportTeacher, registrar, admin, student, parent, careEducator, cafeteria, librarian, nurse, dpo. Aliases in `roles`: `'staff'` (all non student/parent), `'gradeEditors'`, `'homeroom'` (a teacher with `homeroomOf`). Enforce finer rules inside the handler (e.g. a teacher may only write grades for subjects they teach; a parent only sees their `childrenIds`; a student only `studentId`).
- Data access: `ctx.db.col('grades')` (array), `db.get(col, id)`, `db.one(col, pred)`, `db.find(col, pred)`, `db.insert(col, doc)`, `db.update(col, id, patch)`, `db.remove(col, id)`, `db.save()` after mutating objects directly. Keep documents flat and use the existing ids (`st_kowalczyk_anna`, `u_nowak`, class `'7b'`, subject `'mat'`, lesson ids `les_<tt>_<date>`).
- **Every write that changes grades, attendance, documents, permissions or accounts calls `ctx.audit({ action, entity, entityId, before, after, reason })`.** Never delete audit rows.
- Storage layout: the store keeps `data/school/<collection>.json` (one JSON array per collection), `data/school/<collection>.jsonl` (an append log for the collections written to constantly — attendance, audit, notifications), `data/school/config.json` for the non-array top-level values and `data/school/_store.json` as the manifest; a legacy single-file `data/school.json` is migrated on first start, and `EDMAT_STORE=legacy` still selects the old engine. `db.save()` marks the store dirty and debounces; `db.flush()` writes **only** the collections that changed (signal handlers flush on `SIGTERM`/`SIGINT`). Which means: mutate documents you got from `db.col()`/`db.get()` and call `db.save()` — do not rebuild `db.data.<collection>` with a fresh array unless you really mean "rewrite the whole file", and never write into `data/` yourself. Collections are **Proxies** (that is how the store knows what changed), so never mutate a document from inside a `filter`/`map`/`sort` callback — read with `db.get/one/find`, write with `db.insert/update/remove`, or iterate with `for…of` and call `db.save()`. Design, recovery rules and measurements: `docs/STORAGE.md` (`npm run bench`).
- Config lives in `db.data.config` (semesters, plusMinus, percentScale, testLimits, retakeRule, thresholds, visibility, messaging, sessionTimeoutMin, timezone, `npLimitPerSemester`, `testNoticeDays`, `classificationMinHours`, `proposalWindowDays`…). Read it, don't hard-code. `proposalWindowDays` (default 30) is how long before the classification meeting a proposed grade may be entered — earlier is `403 proposal_window`.
- Dates: ISO `YYYY-MM-DD`; "today" for the demo is `db.data.config.today` (2026-10-23, a Friday) — use it instead of the wall clock for school logic so tests are deterministic; timestamps use `util.now()`.
- **Time of day belongs to the school's zone, never to UTC.** `util.now()` is an instant (ISO, UTC) and is the only thing you store as a timestamp. Everything that means "a day or an hour in the life of the school" goes through `server/lib/domain.js`: `D.today(db)` (the school's calendar day, honouring `config.today` in the demo), `D.tz(db)` (`config.timezone`, else `EDMAT_TZ`/`TZ`, else `Europe/Warsaw`), `D.schoolNow(db)` → `{ date, time, instant }`, `D.isBeforeCutoff(db, '08:00')` for cut-offs (lunch cancellation, alerts) and `D.inQuietHours(user, db)` for notifications. Never call `new Date().getHours()` or slice an ISO string to get a local date — `util.localDate(instant, tz)` / `util.localTime(instant, tz)` do it right across DST. A due time the client sends as local wall time is stored as an instant with the school offset (`util.toInstant`).
- **Attachments: one gate.** Anything arriving as `{ name, type, size, dataUrl }` from a browser goes through `const U = require('../lib/uploads')` — `U.validateUpload(file, { allow, maxMB })` for one, `U.validateUploads(list, { allow, maxMB, maxTotalMB })` for a set. It cleans the file name, checks the declared type against the `data:` header **and** the magic bytes, computes the size from the base64 (never from the client's `size`), refuses browser-executable types (HTML, SVG, scripts) unless the school allows them explicitly, and throws `400/413/415` with a Polish message and a `code`. Never trust `file.type` or `file.size` yourself, and never store a `dataUrl` the validator did not return (S-13).
- **Reading a pupil's record: one gate.** `D.assertMayReadPupilRecord(db, user, studentId, kind)` with `kind` in `'grades' | 'remarks' | 'homework' | 'descriptive' | 'attendance' | 'directory'` decides who may read what: the pupil, a guardian with `accessScope: 'full'` (`'info'` sees attendance and the directory only, `'none'` nothing), a teacher who teaches that pupil, the homeroom teacher, the principal and the support team. Care, cafeteria, library, nurse and the DPO keep the directory and the day's attendance and see no learning record. It throws `403 { code:'forbidden', deny, scope }` where `deny` is `'guardian_scope' | 'not_teaching_pupil' | 'record_scope'` — call it at the top of every handler that returns grades, remarks, submissions or descriptive assessments, instead of re-deriving the rule (S-10).
- Grades and classification: a final grade carries `proposedId` (the proposal it came from), and the classification views expose `changedFromProposal` / `lowerThanProposal` so a teacher can see where a final departs from the proposal. Changing a category's weight with `recalculate: true` writes one `grade_update` audit row **per recalculated grade** plus a `grade_category_update` row carrying `after.{gradeIds, recalculated, classAverages}` and `before.classAverages` — never recompute averages silently.
- `D.semesterOf(db, date, mode)`: a day between the semesters belongs to the semester that **ended** when reading, and to the next one when writing (`mode: 'entry'`). `D.studentLabel(s, db)` disambiguates same-name pupils with `(nr N)` / `(ur. RRRR)` — use it for every human-readable pupil name. `D.attendanceStats` ignores status codes it does not know and reports them in `unknown` instead of silently lowering the percentage.
- Print documents are read by screen readers too: every `<table>` in a `D.printHtml` body needs a `<caption>` and every `<th>` a `scope="col"` / `scope="row"` (asserted by `[3.9.1]`).
- **Notifications: one gate.** `D.notify(db, userId, kind, text, { crisis, link, push, at, dedupeKey })` is the only way a notification row comes into being — `createNotification` in `server/routes/notifications.js` is a thin alias of it. It honours the account's quiet hours (`users[].quietHours`; a `crisis` alert always passes), deduplicates on `dedupeKey`, and sets `deferred`/`deliverAt` (`D.endOfQuiet`) for what has to wait until morning. **It returns `null`** when the account does not exist or the same `dedupeKey` is already there, so check the result before reading a field off it; `D.notifyParentsOf` filters the nulls out for you. Never `db.insert` into `notifications` yourself: the Web Push queue hangs off `D.onNotify` and would never see the row. Messages go to `db.col('messages')` (see 3.7 owner's shape if you need one; keep `{ fromUserId, toUserIds, subject, body, at, kind, confidential, requiresAck, readBy:{}, deliveredTo:[] }`).
- **Push delivery is real, and off by default.** A notification row with `push: true` that quiet hours did not defer is handed to the in-process queue in `server/routes/notifications.js`: one `pushDeliveries` row per subscription (`pending → sent | retry | failed | gone`), retries at 1 s/5 s/30 s/2 min/10 min, 404/410 deletes the subscription, and the payload is encrypted end-to-end (RFC 8291) with the browser's own `p256dh`/`auth` keys, so the push service carries ciphertext only. Nothing leaves the process unless `config.push.enabled` is true **and** the `pushKeys` collection holds the school's VAPID pair (`POST /api/push/config` turns it on and generates them). The keys live in their own collection because `/api/auth/session` hands the whole `config` to every signed-in client — never put a secret in `db.data.config`. Put **nothing** in the payload: it carries `{v: 2, kind, id, ts, crisis}` (the last one is a single bit, so a fallback notification for a crisis still vibrates and sticks) and the service worker fetches the wording from `GET /api/notifications/:id/render` on receipt, with a four-second `AbortSignal.timeout` (`config.push.payload`, default `'minimal'`; `'neutral'` restores the old title/body/link payload). A new kind needs an entry in **three** tables: `PUSH_TITLES` and `PUSH_NEUTRAL` (server, pl+en) and `PUSH_FALLBACK` (`public/sw.js`, pl+en) — `tests/48-push.test.js` fails when they do not carry exactly the same kinds, and `CRISIS_KINDS` is mirrored the same way on both sides. **What `/render` returns is never the text from the logbook**: it is the neutral sentence for that kind, so no pupil's name, amount or reason reaches a lock screen (S3-16). Which kinds may go out at all is a positive list (`PUSH_KINDS`) checked **first — also for a crisis**, which now bypasses quiet hours and nothing else; `config.push.kinds` may only narrow it, never add a kind. Support notes, the nurse's office, graded work and the counselor's `attendance-alert` are not on the list. Quiet-hours releases are swept lazily (feed request, `/api/push/*`, or a new notification, at most every 30 s), and the same lazy sweep re-queues the jitter jobs a restart left as `pending` rows (`resumePending`; anything past `releaseWindowHours` is closed as `failed` with a reason instead of reading as „still waiting"). Quiet hours and the jitter clamp are computed in the **school's** time zone through `D.inQuietHours`/`D.schoolNow`, never off the process clock. Reads of a notification by id go through the index in `server/routes/notifications.js` (`notificationById` / `notificationsOf`), not `db.get('notifications', id)`: the store's `get` is a linear `find`, and a push fan-out turns into 600 concurrent `/render` calls. Never write your own web-push crypto or add an npm client: `server/lib/webpush.js` is the one gate, and `docs/PUSH.md` explains what the push service can see.
- Session extras: `app.sessionExtras.push((ctx) => ({ pendingAnnouncement }))` adds fields to `/api/auth/session` (the shell renders `pendingAnnouncement` as a blocking dialog and POSTs `/api/announcements/:id/ack`).
- Encrypted notes: `crypto.encryptForReaders(text, [{userId, publicKey}])` / `decryptFor(envelope, userId, privateKey)`; specialists in the seed have `publicKey`/`privateKey`. Never return `privateKey`, `passwordHash` or `totpSecret` to clients (`auth.publicUser(u)`).
- Exports: CSV = UTF-8 with BOM and `;` separator; XML as text; "PDF" = a print-ready HTML document (`{__raw:true, contentType:'text/html; charset=utf-8'}`) that the browser prints to PDF — say so in the response, don't fake binary PDFs.
- Real PDF: `GET /api/pdf?path=<internal print path>` (`server/routes/pdf.js`) re-runs that GET through the app (same session, same role guard) and prints the HTML with a local headless Chromium (`server/lib/pdf.js`, `EDMAT_CHROME` to point at one). Without a browser it answers `501 { code:'pdf_unavailable', fallbackUrl }`, so keep serving print-ready HTML as above.

## Client conventions

- A screen file: `EdApp.screen({ id:'teacher-lesson', path:'/lekcja', title:'Lekcja', roles:['teacher'], nav:{ label:'Dziennik', order:10 }, component: function Screen(props) {...} })`. `props.user`, `props.route.query`, `props.config`. Use `var E = window.EdMat, A = window.EdApp, h = React.createElement;`. No JSX, no imports, no external URLs.
- Data: `A.useApi('/api/…', deps)` → `{data, loading, error, reload}`; writes via `A.api.post(path, body, { queueable:true, label })` for attendance/topic writes (offline queue), plain otherwise. `A.toast(text, 'success'|'danger')`. `A.onSave(fn)` binds Ctrl+S. `A.navigate('/path', {query})`.
- Layout: `<h1 class="display app-title">` once per screen, `.app-sub`, `.card`, `.grid-2`, `.grid-3`, `.row`, `.stack`, `.muted` from `public/app/app.css`; everything else from the EdMat bundle (`E.Button, E.TextField (multiline), E.Select, E.Checkbox, E.RadioGroup, E.Switch, E.GradeInput, E.AttendanceChip, E.AttendanceRoster, E.GradeCell, E.GradeGrid, E.Badge, E.ProgressBar, E.StatTile, E.SyncStatus, E.Alert, E.Toast, E.Dialog (initialFocus, blocking, timeout), E.Tabs, E.AccountSwitcher, E.Avatar, E.Table (stack), E.AuditEntry, E.Calendar, E.LessonCard, E.MessageItem, E.ConfidentialNote, E.PrintSheet (headingLevel), E.Kbd, E.Icon`). Prop shapes: `../design-system/components/index.d.ts`; behaviour examples: `../design-system/components/<Comp>/preview.html` and the showcase screens `../design-system/components/{TeacherLesson,TeacherGrades,HomeroomClassification,PrincipalDesk,SupportTeam,RegistrarAdmin,StudentDashboard,ParentMobile,SchoolModules}/preview.html` — port those, wiring them to your API.
- Polish UI copy, sentence case, decimal comma (`A.fmtNum`), dates `A.fmtDate`, names `A.studentName(s)` / `A.userName(u)`. Every status has a glyph or word, never colour alone. One `h1`, labelled controls, `aria-live` for results, tokens only.
- Printing: render `E.PrintSheet` inside the screen and call `window.print()` (app.css hides chrome in print), or open the server's print-ready document with `A.openPrint('/api/…/print')` (`public/app/print.js`) — it opens a real PDF when the server can render one and the HTML otherwise.

## Testing

```js
const { startServer, expectOk } = require('./helpers');
let S; test.before(async () => { S = await startServer(); }); test.after(() => S.close());
test('[3.1.1] one-click all present then individual changes', async () => { const c = await S.as('j.nowak'); const r = await c.post('/api/…', {...}); assert.equal(r.status, 200); … });
```
`S.as(login)` logs in a demo user (password `Szkola-2026!`); `S.db` is the live store for assertions; `S.TODAY` = '2026-10-23'. Logins: j.nowak (math, homeroom 7b), a.wojcik (physics), e.krol (english), b.sikora (polish, homeroom 7a), t.gorski (chemistry/biology), k.lis (history/geo, homeroom 8b), a.mazur (PE, homeroom 3a), i.kaczmarek (grade 1a teacher), dyrektor, e.zielinska (psychologist), pedagog (counselor), pedagog.specjalny, logopeda, n.wspomagajacy, sekretariat, admin, iod, swietlica, stolowka, biblioteka, pielegniarka, anna.kowalczyk / jan.nowak / … (students: first.last without diacritics), aleksandra.borowska (adult student, 8b), rodzic.kowalczyk (Marta, children Anna 7b + Piotr 3a), rodzic.kowalczyk2 (Tomasz, divorced, separate account), rodzic.nowak, rodzic.lewandowski, rodzic.wisniewska, rodzic.zielinski, rodzic.adamczyk, rodzic.mazurek, rodzic.borowska (opiekun uczennicy pełnoletniej).

`npm run pilot` (`scripts/pilot.js`, test `tests/49-pilot.test.js`) plays one realistic school week end
to end **through the public API on a blank install** and asserts the **cross-role invariants** no
single-route test covers: what the teacher saved is exactly what the pupil, both guardians, the homeroom
teacher and the principal see; averages and attendance percentages agree in every view that shows them;
dashboard counters equal the rows behind them; notifications reach exactly the right people; every write
leaves an audit row with before/after; a printout carries the same numbers as the API; nothing answers an
unexpected 5xx. It exits non-zero on any violation and prints a step-by-step report with timings.
`EDMAT_SKIP_PILOT=1` skips the test. What the week looks like, what it found and what is still open:
`docs/PILOT.md`.

Run `node --test tests/` (all), `node --test tests/31b-grades.test.js` (one file — 3.1 is split into `31a-lessons.test.js` for attendance/lessons and `31b-grades.test.js` for grades) or `node --test --test-name-pattern='\[3\.1\.9\]' tests/31b-grades.test.js` (one story).

**Every test must pass on its own.** `--test-name-pattern` with the story's id is how a single story's
evidence gets re-verified, and one early failure must not hide the rest of the file. Files still share
one seeded server, so when a test needs state another test creates, do not rely on file order: build
that state through `fixtures()` from `tests/helpers.js`.

```js
const { startServer, expectOk, fixtures } = require('./helpers');
const need = fixtures();
/* Built lazily and at most once: in a whole-file run by the test that owns the step, alone by the
   test that needs it. */
const closedSemester = () => need('closedSemester', async () => expectOk(await C.post('/api/homeroom/semester/close', { semester: 1, resolutionNo: '3/2026/2027' })));

test('[3.2.11] closing the semester …', async () => { const closed = await closedSemester(); … });
test('[3.2.20] handing the closed logbook over …', async () => { await closedSemester(); … });
```

`withConfig(db, patch, fn)` changes `db.data.config` for the length of `fn` and restores it even when an
assertion throws — use it instead of a manual save/restore pair around a config tweak. A key the
configuration did **not** have comes back **absent**, not present-and-`undefined`: the whole config
goes to every signed-in client in `/api/auth/session`, so a leftover key would be visible there.

### What the harness guarantees, and what it refuses to do

Two properties of `tests/helpers.js` exist because the suite used to fail for reasons that had
nothing to do with the code under test (`docs/review/round3/test-honesty.md` §4). Both are pinned
by tests in `tests/46-reliability.test.js` („harness: …”).

1. **Keep-alive.** `startServer()` sets `keepAliveTimeout = 120 s` (and `headersTimeout = 150 s`,
   which must stay above it). Node closes an idle keep-alive socket after **5 s** by default and
   undici — the engine behind global `fetch` — keeps that socket in its pool, so a request written
   into it in the same tick the server sends FIN comes back as `TypeError: fetch failed`
   (`ECONNRESET` / `UND_ERR_SOCKET`). A test crosses that boundary whenever it does several
   seconds of solid work between two requests: `createApp({ blank: true })`, a 400-row import, a
   year of generated lessons, a Chromium run — or simply a starved event loop when six suites
   share six cores. Only the *test* server is touched; `server/index.js` keeps Node's own value.
   Reproduce both halves with
   `node docs/review/round3/repro/keepalive-race.js --rounds 20 --gap 5010 --burners 6 --block`
   (10/20 requests fail at 5 s, 0/20 with `--keepalive 120000`).
2. **The retry replays only what the server never read.** `ECONNRESET`, `ECONNREFUSED`, `EPIPE`,
   `UND_ERR_SOCKET` — and `UND_ERR_CONNECT_TIMEOUT` only for an idempotent method (GET, HEAD,
   OPTIONS, PUT, DELETE), because there the connection never came up. The predicate reads
   `e.cause.code` **and** the message; everything else — an HTTP status, a timeout after the
   request went out, a half-written body — is a real failure and is rethrown as
   `GET /api/… : fetch failed [ECONNRESET] (po 4 ponowieniach)` with the original error as
   `cause`. **Never widen this.** A broken handler must not read as a flake, and a flake must not
   read as a broken handler. Nothing retries an HTTP response: a 500 stays a 500.

Two more rules follow from the same review:

- **Do not spawn your own `fetch` client in a test file.** Go through `S.client()` / `S.as()`;
  undici pools per origin, not per client object, so a private client gets the same stale socket
  and has no retry at all.
- **Never wait on another process without a bound.** `await new Promise((r) => p.on('exit', r))`
  turned a missed signal into a hung `node --test` (three such processes were alive on the review
  machine, the oldest nearly seven hours). Send a second signal, then `SIGKILL`, and fail by name
  — `killAndWait()` in `tests/46-reliability.test.js` is the shape to copy.
- **A wall-clock budget is not evidence.** `assert.ok(ms < 500)` says more about the machine than
  about the code: on a loaded box `[3.3.8]` failed in three of six parallel runs with a correct
  index in place. Assert the shape of the work against a baseline measured in the same run — see
  `[3.3.8]` in `tests/33-principal.test.js` (the audit costs *n* passes over the attendance
  collection, and there are >500 lessons to check) and the index test in `tests/48-push.test.js`.
- **A starved Chromium is not a test result.** `inChromium`/`domOf` retry once and then say so
  („Chromium przekroczył … dwa razy z rzędu — maszyna jest obciążona”); `EDMAT_UI_TIMEOUT` raises
  the limit on a slow machine.

**Client behaviour is run, not grepped.** `loadClient()` (tests/helpers.js) executes the real
`public/app/i18n.js`, `public/edmat/bundle.js`, `public/app/core.js` and `public/app/shell.js` in a
`node:vm` sandbox on a small DOM stub, with enough React to render the shell: `ui.press('2', { altKey: true })`
fires a real keydown, `ui.render()` settles the tree and `ui.names()` / `ui.find(name)` / `ui.all(name)` say
what the shell rendered ([3.9.3], [3.6.15], [3.1.25]). What needs a real engine — computed CSS, layout at a
phone width, a focus ring — runs in the same headless Chromium `npm run smoke` uses: `chromium()` returns its
path or `null`, `inChromium(html, script, {width, height})` runs a script on a page, `domOf(url)` dumps the DOM
the app really rendered. When Chromium is missing, skip **a nested sub-test**, never the story's own test —
a `# SKIP` on the story's line makes `checklist-status.js` drop its evidence.

`node scripts/checklist-status.js` only counts a story as covered when its test reported `ok`, carried no
`# TODO`/`# SKIP` directive **and** its file did not fail; `--json` prints the same verdict machine-readably
(run summary, per-section counts, every open story with the reason).

## Manual QA

`EDMAT_DEV=1 PORT=3000 node server/index.js` then open `http://localhost:3000/api/dev/login?as=j.nowak&to=/lekcja` (dev-only shortcut). Headless screenshot: `node scripts/screenshot.js <login> <#path> <out.png> [width]`. Every screen in both languages: `npm run smoke` (`scripts/smoke.js` — console errors incl. CSP, server responses >= 400, a screenshot and a DOM check per pair in `smoke-out/`; non-zero exit on any finding).

## Shared collections (agreed shapes — create rows with exactly these fields)

Use `server/lib/domain.js` (`const D = require('../lib/domain')`) for: `today(db)`, `tz(db)`, `schoolNow(db)`, `isBeforeCutoff(db, 'HH:MM')`, `inQuietHours(user, db)`, `semesterOf(db,date)`, `teacherTeaches`, `teachesPupil`, `isHomeroomOf`, `guardianScope`, `visibleStudentIds` / `assertCanSeeStudent(db,user,studentId)` / `assertMayReadPupilRecord(db,user,studentId,kind)`, `studentGrades(db, studentId, subjectId, sem)` (average by school rule), `attendanceFor`, `attendanceBySubject`, `isSemesterLocked(db, sem, classId)`, `lessonsOn`, `notify(db,userId,kind,text,{crisis,link,dedupeKey,at})` (quiet hours + dedupe; may return `null`), `notifyParentsOf`, `endOfQuiet`, `onNotify`, `sendMessage`, `csv(rows, header)`, `xmlEsc`, `printHtml(title, body, opts)`.

| collection | shape |
| --- | --- |
| `attendance` | `{ id, lessonId, studentId, date, lessonNo, classId, subjectId, status:'ob'|'nb'|'sp'|'zw'|'u'|'rs'|'w', minutes, draft:false, byUserId, at, excuseId }` — one row per student per lesson (update in place) |
| `grades` | `{ id, studentId, subjectId, classId, categoryId, categoryName, weight, color, value:'4+'|'np'|'bz'|…, points, maxPoints, percent, comment, retakeOfId, makeup, lessonId, date, teacherId, kind:'partial'|'proposedMid'|'midterm'|'proposedFinal'|'final', semester:1|2, countsInAverage, locked:false, deleted:false, deletedReason }` |
| `descriptiveGrades` | `{ id, studentId, semester, area, text, phraseIds, teacherId, at }` (grades 1–3) |
| `behaviorGrades` | `{ id, studentId, semester, kind:'proposed'|'final', value, points, byUserId, at }` |
| `remarks` | `{ id, studentId, teacherId, kind:'positive'|'negative'|'neutral', text, points, date, lessonId }` |
| `excuses` | `{ id, studentId, from, to, lessonNos, reason, attachment, byUserId, at, planned:false, status:'pending'|'approved'|'rejected', rejectReason, decidedBy, decidedAt }` |
| `homework` | `{ id, classId, groupId, subjectId, teacherId, text, dueAt (ISO datetime), maxAttachmentMB, lockAfterDue, attachments, createdAt }` · `homeworkSubmissions` `{ id, homeworkId, studentId, text, files:[{name,size,type,dataUrl}], receivedAt, gradeId, reviewedAt }` |
| `tests` (announced) | `{ id, classId, subjectId, teacherId, date, scope, kind:'sprawdzian'|'kartkówka' }` |
| `messages` | `{ id, fromUserId, toUserIds:[], subject, body, at, kind:'message'|'warning'|'broadcast', confidential, requiresAck, readBy:{userId:at}, deliveredTo:[], attachments:[] , threadId }` |
| `notifications` | `{ id, userId, kind, text, at, read, crisis, link, push }` (use `D.notify`) |
| `pushSubscriptions` | `{ id, userId, endpoint, keys:{p256dh, auth}, device, at, revoked }` — one per browser; deduped by endpoint, deleted (not flagged) on unsubscribe or a 404/410 from the push service |
| `pushDeliveries` | `{ id, notificationId, userId, subscriptionId, endpoint, status:'pending'|'sent'|'retry'|'failed'|'gone', at, attempts, code, error, kind, crisis, notBefore }` (owner: 3.6; written only by the push queue; `notBefore` is the jitter deadline, so a restart resumes the job instead of dropping it) |
| `announcements` | `{ id, title, body, requiresAck, audience:['parent','staff','student'], byUserId, at, ackBy:{userId:at} }` — pending ones surface through `app.sessionExtras` as `pendingAnnouncement` and `POST /api/announcements/:id/ack` (owner: 3.3) |
| `semesterLocks` | `{ id, semester, classId, byUserId, at, reopened:false, reopenedBy, reason }` (owner: 3.2; 3.1 respects it via `D.isSemesterLocked`) |
| `substitutions` | `{ id, teacherId, from, to, reason, byUserId, assignments:[{lessonId, substituteTeacherId, kind:'sub'|'cancel'|'combine', combinedWithLessonId}], published:false, publishedAt }` (owner: 3.3) |
| `trips` | `{ id, name, from, to, leaderId, classIds, studentIds, chaperones:[{userId, groupNo}], insurance:{insurer, policyNo}, schedule:[], status:'draft'|'submitted'|'approved', consents:{studentId:{signedBy, at}} }` (owner: 3.8; 3.3 approves) |
| `audit` | written only through `ctx.audit()` / `audit(db, …)`; `{ id, at, userId, ip, action, entity, entityId, before, after, reason, client }` |

Owners add rows to their own collections; readers use the shapes above. If you must read a collection another section owns and it is empty in the seed, add a few rows for it in YOUR seed file (prefix your ids) rather than editing theirs.

## i18n (pl + en)

- The client has `window.EdI18n` (loaded before core.js) and `A.t(key, vars)`, `A.plural(n, key)`, `A.subjectName(id, fallback)`, `A.setLocale('en')`, `A.state.locale`. `A.fmtDate/fmtNum/fmtPct/fmtMoney` are locale-aware. Shared keys live in `public/app/i18n.js` (`common.*`, `nav.*`, `role.*`, `subject.*`, `shell.*`, `demo.*`).
- A screen registers its own dictionary at the top of its file: `window.EdI18n.add({ pl: { 'tl.title': 'Dziennik lekcyjny' }, en: { 'tl.title': 'Lesson logbook' } })`. Prefix keys with a short screen tag (`tl.`, `tg.`, `hr.`, `pr.`, `su.`, `rg.`, `ad.`, `st.`, `pa.`, `mo.`, `ms.`, `se.`, `co.`, `me.`). Every user-visible string goes through `t()`; no Polish literals remain in JSX/createElement calls, including aria-labels, placeholders, hints, badge texts, dialog titles and toast messages. Keep key names in English.
- Copy shared by several screens and by `core.js` lives in `public/app/i18n.js` next to `common.*`/`shell.*` — that is where `push.*` (the push-notification card, the parent prompt and the errors `A.push` throws) sits, not in a single screen file.
- Nav entries use a key: `nav: { key: 'nav.grades', order: 20 }` (the shell translates; keep `label` as a Polish fallback).
- The screen component receives `key: locale` from the shell, so it remounts on language change; nothing else is needed.
- The EdMat bundle translates its own component copy (`EdMat.setLocale` is called by `A.setLocale`). Server data stays Polish where it is legally Polish (statuses ob/nb…, category names, printouts, official documents); translate labels around it, and use `A.subjectName(subjectId)` for subject names.
- Server error messages are Polish; when you show `e.message`, that is acceptable for the demo. For messages you construct client-side, translate them.
- Screenshots in English: `node scripts/screenshot.js j.nowak '#/lekcja?lang=en' out.png`.

## Modules

`server/modules.js` lists modules; a route file maps to a module by file name (`ROUTE_MODULE`), and a screen declares `module: 'courses'` in `EdApp.screen()` so a disabled module hides both. New feature areas (courses, meetings) must set `module`.

## First-run wizard and blank installs

`createApp({ blank: true })` / `EDMAT_SEED=blank` loads `server/lib/blank-seed.js` (an empty school with default config) instead of the demo seeds. Until an admin exists, every route except `/api/setup/*` and `/api/auth/policy` answers `503 setup_required`; the shell shows `public/app/screens/setup.js` instead of the login page. `server/routes/setup.js` owns school+admin creation, CSV imports (teachers, students+parents with registration codes) and `generateLessons(db, from, to)`. i18n key prefixes already taken: tl, tg, hr, pr, su (support), rg, ad, st, pa, ms, se, mo, co, me, sw (setup wizard), cu (curriculum) — pick a new one for a new screen.
