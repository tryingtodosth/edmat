# Test-honesty review — is "145/145 with test evidence" true?

Scope: `../checklist.md`, `CONTRIBUTING.md`, `README.md`, `docs/INTEGRATION.md`, `docs/COURSES.md`,
`docs/VIDEO.md`, `scripts/checklist-status.js` and every file in `tests/`.
Method: read every test against the acceptance sentence of its story, then re-ran the suite
whole, per file, per test (`--test-name-pattern`) and with a shuffled file list.

**Short answer: the claim is close to true but overstated.**
Every one of the 145 stories does have exactly one test carrying its id, no id is claimed twice, and
no story is faked with a bare `assert.equal(r.status, 200)`. But 25 of the 145 tests do not reach the
part of the story that is hard — the wall-clock promises ("under 30 seconds", "under 2 seconds",
"immediately", "real-time", "instant push"), the client-side half ("cursor moves on Enter", "dark mode",
"offline synchronisation", "blocking other views"), or the physical one ("print alignment").
Separately, `scripts/checklist-status.js` could mark a story green out of a file that failed, so the
green ticks were not even guaranteed to come from a green run.

Legend: **solid** — the test exercises the acceptance the story states.
**partial** — the mechanism is genuinely tested but a named part of the acceptance is not.
**weak** — the test passes without demonstrating the thing the story asks for.
**not really tested** — a stub, a seeded value or the wrong subject under assertion.

## (b) Counts

| verdict | count |
| --- | ---: |
| solid | 120 |
| partial | 17 |
| weak | 8 |
| not really tested | 0 |
| **total** | **145** |

Stories with a test whose name carries the id: 145/145. Stories whose test really demonstrates the
acceptance sentence: **120/145**. After the fixes in this review, two of them are `todo` (see §c),
so the honest, machine-checkable number `node scripts/checklist-status.js` now prints is **143/145**.

## (a) Per-story verdicts

### 3.1 Subject teacher — attendance, grading, lesson records (`tests/31a-lessons.test.js`, `tests/31b-grades.test.js`)

| id | verdict | why | what an honest test asserts |
| --- | --- | --- | --- |
| 3.1.1 | partial | One-click-all-present and the four individual statuses are fully asserted, but "under 30 seconds" is checked as `Date.now() - started < 30000` around two HTTP calls — an assertion that cannot fail. | Registration takes exactly two requests (roster prefilled, no per-pupil call) and both complete in well under a second; the 30 s claim is about interaction count, not wall clock. |
| 3.1.2 | solid | 409 `absent_blocked`, `makeup:true` override, present pupil unaffected, no stray grade row, and the bypass without `lessonId` is closed. | — |
| 3.1.3 | solid | Completion counter increments in the same request cycle as the topic save; cross-subject curriculum item rejected. | — |
| 3.1.4 | solid | Weight 1–10 bounds, `cat-1..8` colour, `countsInAverage` default proven by an average that does not move, re-weighting recomputes. | — |
| 3.1.5 | solid | Exact fractional values (4+ → 4,5; 5- → 4,75) and the resulting weighted averages. | — |
| 3.1.6 | solid | points → percent → suggested grade against `config.percentScale`, teacher override, out-of-range rejected. | — |
| 3.1.7 | solid | `np`/`bz` leave the average untouched yet appear in the statistics counters. | — |
| 3.1.8 | solid | Both values visible in the grid, and all three `retakeRule` modes checked with exact averages. | — |
| 3.1.9 | partial | Only `POST /api/grades/bulk` is exercised. The story's acceptance — numeric keypad, "cursor automatically moving to the next student upon pressing Enter" — is client behaviour and is never touched. | `public/app/screens/teacher-grades.js` binds Enter in bulk mode to commit-and-advance and the grade input is a numeric input. |
| 3.1.10 | solid | Comment round-trips to both the parent's and the student's view; a foreign parent gets 403. | — |
| 3.1.11 | solid | Audit row carries before/after/reason/actor; the row is soft-deleted, never removed. | — |
| 3.1.12 | partial | The combined roster and the attendance split by home class are proven. The second half of the story — "maintaining separate **grade** assignments to the gradebooks of the respective home classes" — is never tested. | A grade written for a 7a pupil during the combined lesson lands with `classId: '7a'` and shows in 7a's grid, not 7b's. |
| 3.1.13 | solid | `rs` keeps the percentage where `nb` lowers it, with the same hour total. | — |
| 3.1.14 | solid | Draft excluded from statistics, earlier statuses survive completion, audit row written. | — |
| 3.1.15 | solid | Minutes required, monthly totals and per-subject breakdown move by exactly the recorded amount. | — |
| 3.1.16 | solid | Phrase bank composition, area validation, non-early-education rejection. | — |
| 3.1.17 | solid | Due date, size limit (413), lock after due (403), server receipt timestamp. | — |
| 3.1.18 | partial | Server contract is right (list omits file bodies, detail returns `dataUrl` with `inline/viewable`, review is audited). Whether anything renders it in the browser instead of offering a download is not asserted. | The teacher screen renders the submission inline (img/iframe from the data URL) and has no `download` attribute. |
| 3.1.19 | solid | Week and day limits, 409 `test_limit` with occupied dates, `kartkówka` exempt. | — |
| 3.1.20 | solid | Print document contains the pupil, subject, weighted average, teacher comment, attendance and the GDPR clause; audited; foreign parent 403. | — |
| 3.1.21 | solid | Deadline from config, notifications to pupil and **both** guardians, message body carries the date, past-deadline 403. | — |
| 3.1.22 | solid | `semesterLocked` blocks create/patch/delete, reopening unblocks, classification deadline blocks separately. | — |
| 3.1.23 | solid | ±points applied, neutral remark applies 0, caps enforced, behaviour grade recomputed, foreign teacher 403. | — |
| 3.1.24 | solid | UTF-8 BOM, `;` separator, real names present, anonymised variant provably free of names with a header marker. | — |
| 3.1.25 | partial | Server-side replay idempotency and stale-write rejection are excellent. The offline half the story names — service-worker cache and the `localStorage` write queue replayed on reconnect — is never executed. | Driving `public/app/core.js` in a sandbox: a failed write is queued, going online flushes it in order and empties the queue. |

### 3.2 Homeroom teacher (`tests/32-homeroom.test.js`)

| id | verdict | why | what an honest test asserts |
| --- | --- | --- | --- |
| 3.2.1 | solid | Every subject, proposed vs final, failing list, at-risk summary, cross-class 403. | — |
| 3.2.2 | solid | Points from remarks, other teachers' remarks, suggested grade, override requires a reason. | — |
| 3.2.3 | solid | >50 % unexcused per subject with the hour text and the counter. | — |
| 3.2.4 | solid | Bulk approve flips `nb` → `u` and stamps `excuseId`; rejection needs a reason that reaches the parent. | — |
| 3.2.5 | solid | Locative forms for first name, surname and birthplace, missing-value flag, acceptance persisted and audited. | — |
| 3.2.6 | solid | Resolution text, honours clause, one document per pupil, names on the printout. | — |
| 3.2.7 | solid | Previous-school entries validated and rendered on the printout. | — |
| 3.2.8 | weak | The story is a physical alignment check against a MEN blank. The test only greps the prose ("25 mm od dolnej krawędzi", "pod światło") and `@page{size:A4;margin:18mm}`. The document actually prints four corner registration marks — the test never looks at them, so the geometry could be deleted and the test would still pass. | The four corner registration marks are emitted with a fixed position and a known size, and the `@page` margin equals the margin the geometry note states. |
| 3.2.9 | solid | Threshold and behaviour list from config, an excluded pupil is provably absent from the batch. | — |
| 3.2.10 | solid | Allowed-kind list, `not_certifiable` for a non-certifiable kind, persisted on the pupil. | — |
| 3.2.11 | solid | Close, double-close 409, homeroom cannot reopen, principal can and must give a reason. | — |
| 3.2.12 | solid | JSON and CSV (BOM, exact header line), all four status columns. | — |
| 3.2.13 | solid | Exactly the three council members, a non-member provably excluded, attachment carried. | — |
| 3.2.14 | solid | 30-day deadline computed, `delivered` → `read` receipt transition, audit row. | — |
| 3.2.15 | solid | Alphabetical numbering, existing numbers preserved when a pupil joins, renumber needs a reason. | — |
| 3.2.16 | solid | Status `removed`, achievements archived, grades count unchanged, pupil still in the database. | — |
| 3.2.17 | solid | Guardian phone on the page, GDPR clause, removed pupil provably absent. | — |
| 3.2.18 | solid | Only own pupils, only cross-class groups, add and remove both reflected in the store. | — |
| 3.2.19 | solid | Planned vs recorded hours per day with a named discrepancy, and a clean narrower window. | — |
| 3.2.20 | solid | Submit, double-submit 409, only the principal approves, notification and audit. | — |

### 3.3 Principal and management (`tests/33-principal.test.js`)

| id | verdict | why | what an honest test asserts |
| --- | --- | --- | --- |
| 3.3.1 | solid | Every lesson in the window becomes an assignment with suggestions; reversed dates rejected. | — |
| 3.3.2 | solid | Tier order proven both ways: same subject first when one exists, related before duty otherwise. | — |
| 3.3.3 | solid | Edge lesson only, every guardian of the class notified exactly once, mid-day cancel rejected. | — |
| 3.3.4 | solid | One paid hour for two classes, room, `not_parallel` rejection, payroll rule text. | — |
| 3.3.5 | solid | Scheduled publish does not change the timetable; the due run flips lesson status and notifies pupils, guardians and the absent teacher. | — |
| 3.3.6 | solid | Per-teacher overtime and ad-hoc amounts recomputed from rate × hours, combined-class saving, totals. | — |
| 3.3.7 | solid | CSV with BOM and a checked header, XML with a checked shape, print variant, audit rows. | — |
| 3.3.8 | solid | A deliberately broken lesson appears with teacher name and class; narrower window respected; teacher 403. | — |
| 3.3.9 | solid | Percent recomputed from hours, item counts, other subjects monitored. | — |
| 3.3.10 | solid | Minutes required, old grade invalidated not deleted, appeal metadata, guardian notified, repeat 409. | — |
| 3.3.11 | solid | Acting teacher gains homeroom rights while `homeroomTeacherId` is untouched; revocation clears both sides. | — |
| 3.3.12 | weak | The story's acceptance is "**blocking other views** until acknowledgment". The test only asserts that `pendingAnnouncement` appears in the session payload and disappears after the ack. Nothing asserts that anything is blocked — the shell's blocking dialog could be removed and the test would still pass. | `public/app/shell.js` renders the pending announcement as `E.Dialog` with `blocking: true` and renders it instead of the routed screen. |
| 3.3.13 | solid | Statistics yes, ciphertext and plaintext provably absent from the payload, 403 `sealed` audited. | — |
| 3.3.14 | solid | Per-day and per-week breaches against config limits, worst class first. | — |
| 3.3.15 | solid | Status `w` on the trip days, substitutions for the leader all filled, guardians notified, repeat 409. | — |
| 3.3.16 | partial | IP, user, entity and edit/delete filters are properly asserted. The **date** filter is "tested" with `from=2020-01-01&to=<today>` — a range that matches everything — plus `rows.length >= 1`. A broken date filter passes. | A one-day window returns only that day's rows, and a window before the school year returns zero. |
| 3.3.17 | solid | 10-day window enforced, `force` audited, XML shape, real RSA seal verified with the school public key, tampering breaks verification. | — |
| 3.3.18 | solid | Web and mobile sessions both revoked with counts, re-login 403, self-block rejected, audit before/after. | — |
| 3.3.19 | solid | never/stale/ok flags derived from login data, households grouped, risky accounts first. | — |
| 3.3.20 | solid | Settings persisted, visible on the parent session, partial patch leaves the rest alone, parent 403. | — |

### 3.4 Support team — IPET, WOPFU, sensitive data (`tests/34-support.test.js`)

| id | verdict | why | what an honest test asserts |
| --- | --- | --- | --- |
| 3.4.1 | solid | Group with therapeutic goals, weekly sessions with attendance, default-present behaviour. | — |
| 3.4.2 | solid | Invitation scoped to sections; an out-of-scope edit is 403 and provably not written; version row records before/after. | — |
| 3.4.3 | solid | Rehab hours, support forms, exam accommodations; duplicate 409; teacher 403. | — |
| 3.4.4 | solid | Real asymmetric crypto: plaintext absent from the store, a foreign private key returns null/throws, the deputy's key opens it. | — |
| 3.4.5 | solid | Export contains formal attendance and provably none of six secret strings. | — |
| 3.4.6 | solid | Only that pupil's guardian; other parent, subject teacher and psychologist all 403. | — |
| 3.4.7 | solid | Lesson-log view for the day, applied recommendations persisted and read back, unknown recommendation 400. | — |
| 3.4.8 | partial | The evaluation figures are recomputed properly and the printout is checked for content and for the absence of confidential notes. The story says "export it to PDF" and the repo now has a real renderer (`/api/pdf`), which this test never uses. | `GET /api/pdf?path=<the evaluation print path>` returns a `%PDF-` body, or 501 `pdf_unavailable` with the right `fallbackUrl` on a machine without Chromium. |
| 3.4.9 | solid | Shared extract visible, protected diagnostics refused even after being force-flagged as shared. | — |
| 3.4.10 | partial | Route-level restriction, reader list, per-attempt access log and audit rows are all proven. But the story asks for "strict database-level access restrictions" and the incident body sits in the store in clear — unlike 3.4.4's envelope — and the test does not look. | The incident body is not readable from the raw store by anyone outside `readerIds` (sealed envelope), the way 3.4.4 asserts it for notes. |
| 3.4.11 | solid | Conflict 409 with the colliding lesson, nothing written, free slot accepted, audit row. | — |
| 3.4.12 | solid | Real AES-256-GCM/scrypt: weak password rejected, ciphertext in the store, wrong password 403, right one returns the exact bytes. | — |
| 3.4.13 | solid | Year rolled, content carried, previous year retained, version row of kind `rollover`, repeat is idempotent. | — |
| 3.4.14 | solid | Envelope wrapped for exactly the two readers, both decrypt, an outsider does not. | — |
| 3.4.15 | weak | The story is "**real-time** monitoring … receiving alerts if 3 consecutive days are missed". The alert is computed inside `GET /api/support/attendance-alerts`, i.e. only when the counsellor opens the page, and the test fabricates the absences by writing rows straight into the store. Nothing is real-time and nothing reaches the counsellor unasked. | After the third day's absence is saved through `POST /api/attendance/lesson/:id`, the alert and the crisis notification exist for the counsellor **without** anyone calling a support endpoint. |

### 3.5 Registrar and system administration (`tests/35-registry.test.js`)

| id | verdict | why | what an honest test asserts |
| --- | --- | --- | --- |
| 3.5.1 | solid | Checksum position named, birth-date cross-check, register number, passport path with country requirement. | — |
| 3.5.2 | partial | Code format, single active card, previous one revoked, audit. The mObywatel hand-off itself is a stub and the test cannot tell a real integration from a locally generated string. | The response marks the hand-off as simulated and no external call is made — so the test and `README` ("Co jest symulowane") agree instead of implying an integration. |
| 3.5.3 | solid | Hand-rolled well-formedness check over every tag, per-class pupil counts, and a failing variant that blocks the export. | — |
| 3.5.4 | solid | Overlapping semesters, day off inside a break and reversed break all rejected; the accepted structure persists. | — |
| 3.5.5 | solid | Dry run writes nothing, teacher clash detected, unknown class reported, groups/rooms/teachers mapped, JSON form too. | — |
| 3.5.6 | solid | Temporary password never logged, forced change blocks other routes, policy enforced, old password stops working. | — |
| 3.5.7 | solid | Flags applied to exactly the grade-editing roles, registrar untouched, requirement visible in session and cleared by enrolling. | — |
| 3.5.8 | solid | Status and departure date, transcript content, repeat rejected, pupil drops out of the SIO counters. | — |
| 3.5.9 | weak | Only the setting round-trips: `PATCH` returns it, `config` holds it, the session echoes it. The story is about what a parent may do, and no message is ever sent under either mode — the enforcement in `messages.js` could be deleted and this test would stay green. | Under `homeroomAndSubject` a parent messaging a teacher who does not teach their child is 403 `messaging_not_allowed`; under `all` the same message is accepted. |
| 3.5.10 | solid | Missing decision number rejected; three DUPLIKAT blocks each carrying issue date and decision number; register rows and audit count. | — |
| 3.5.11 | solid | Bad code, weak password, case-insensitive redemption, the new account logs in, reuse refused. | — |
| 3.5.12 | solid | CIDR validation, self-lockout requires `force`, outside IP 403 and audited, inside IP 200, teachers unaffected. | — |
| 3.5.13 | solid | No real surname, PESEL, e-mail or address survives; secrets stripped; audit kept; pseudonyms are valid and stable; production untouched. | — |
| 3.5.14 | solid | Completeness percentages, summons, report, and the "already reported" rejection. | — |
| 3.5.15 | solid | Statutory minimum enforced, report deletes nothing, and five different HTTP verbs against the audit log all answer 405 and are themselves audited. | — |

### 3.6 Student (`tests/36-student.test.js`)

| id | verdict | why | what an honest test asserts |
| --- | --- | --- | --- |
| 3.6.1 | solid | Today's timetable with a cancellation and a room change, upcoming tests with scope, homework due tomorrow, no contact data leaked. | — |
| 3.6.2 | solid | Every returned grade id is proven to belong to this pupil; a foreign pupil's data is 403. | — |
| 3.6.3 | solid | Server-side receipt timestamp bounded by the surrounding clock reads, file stored, list flips to submitted. | — |
| 3.6.4 | solid | Each lesson's status recomputed from the teachers' own rows, including who recorded it. | — |
| 3.6.5 | solid | Notification for the pupil and for a classmate, dedupe key proven, room change in the feed. | — |
| 3.6.6 | solid | Full 35-cell grid geometry, notice-rule compliance and violations, per-day limit flag. | — |
| 3.6.7 | partial | The interesting assertions sit behind `if (sim.reachable)` and `if (lower)`, so a simulator that always answers "unreachable" passes, and `assert.match(sim.advice, /średnia/)` is a word check. | A pinned scenario where `reachable === true`, the exact `needed` grade, and `needed - 1` provably missing the threshold. |
| 3.6.8 | solid | Materials from the pupil's own lessons only, 8b material 403, a freshly uploaded one appears immediately. | — |
| 3.6.9 | solid | Recipient list restricted and provably free of phone/e-mail, messages to a parent and to a non-teaching teacher 403, outsider cannot read the thread. | — |
| 3.6.10 | solid | Entitlements plus a source scan proving no `402`/"payment required" path exists anywhere in `server/`. | — |
| 3.6.11 | solid | Adult flag and school-statute flag both required; minor 403; statute off 403. | — |
| 3.6.12 | solid | Guardian loses access in the same test, `visibleStudentIds` empties, notification and audit, and it is reversible. | — |
| 3.6.13 | weak | Everything asserted comes from the seed, and the notice under test is picked with `find(...) || notices[0]` — any notice at all satisfies it. The story's acceptance ("prior to semester end") is checked as `notice.dueDate <= semesterEnd`, which is true for almost every loan. | A loan due inside the reminder window produces a notice and one notification; a loan due outside it produces neither. |
| 3.6.14 | weak | The story is "switch the app interface to dark mode". The test only proves a string round-trips through `PATCH /api/me/preferences`. Nothing connects that preference to the interface. (The test also re-tests quiet hours and push registration, duplicating 3.7.7.) | `public/app/theme.js` applies the stored theme to `document.documentElement` before first paint and `tokens.css` defines the `[data-theme="dark"]` palette it switches to. |
| 3.6.15 | partial | The server-side shortcut list is checked precisely; the behaviour is checked by grepping `core.js` for `addEventListener('keydown'` and `altKey`. A handler that does nothing passes. | Running `core.js` in a sandbox and dispatching Alt+1 / Ctrl+S / `?`, asserting the registered handlers fire. |

### 3.7 Parent and legal guardian (`tests/37-parent.test.js`)

| id | verdict | why | what an honest test asserts |
| --- | --- | --- | --- |
| 3.7.1 | solid | Both children from one login, per-child data differs, foreign parent 403 on two routes. | — |
| 3.7.2 | weak | "**Instant push** notifications for first-period absences" — the notification only comes into existence when the parent's own client calls `POST /api/parent/absence-alerts/scan`. Nothing happens when the teacher saves the `nb`, and `push: true` is a stored field, not a delivery. The test performs the scan itself and then asserts the field. | Right after the teacher saves `nb` on lesson 1, the crisis notification exists for the guardian with no scan call in between. |
| 3.7.3 | solid | Reason required, fee 0 proven in body and receipt, row owned by the guardian. | — |
| 3.7.4 | solid | Rejection reason, label, decider name and counters all visible to the parent. | — |
| 3.7.5 | solid | Homeroom named and every subject teacher of those days notified, each notification checked. | — |
| 3.7.6 | solid | Free/permanent access, comments visible, and the class average provably disappears when the principal turns it off. | — |
| 3.7.7 | solid | Ordinary notification deferred with a later `deliverAt`; a crisis alert from a real attendance write is not deferred. | — |
| 3.7.8 | solid | Meetings and open days listed, booking persisted, double booking 409, a second parent books a different slot. | — |
| 3.7.9 | solid | Receipt number, HTML receipt document, double payment 409, second payment gets a different number. | — |
| 3.7.10 | solid | Cut-off honoured, balance credited to next month's account, repeat 409, after cut-off nothing written. | — |
| 3.7.11 | solid | Counsellor reads it, a teacher gets 403, and principal supervision provably cannot see it. | — |
| 3.7.12 | solid | Wrong password 401 with nothing written, correct one records signer/method/time, repeat 409. | — |
| 3.7.13 | solid | Same child visible, first guardian's correspondence 403 and absent from the inbox, contact fields nulled while the school still holds them. | — |
| 3.7.14 | solid | 30-day rule, delivered → acked transition persisted, the second guardian keeps its own outstanding receipt. | — |
| 3.7.15 | solid | Both semesters, attendance from 01.09, comments section, and a JSON variant with real totals; audited. | — |

### 3.8 Complementary modules (`tests/38-modules.test.js`)

| id | verdict | why |
| --- | --- | --- |
| 3.8.1 | solid | Barcode and roster paths distinguished, unknown barcode 404, duplicate 409, rows owned by the educator. |
| 3.8.2 | solid | Unauthorised person 403 **and provably no pickup row**, authorised pickup stores person, relation, identity check and exact time; repeat 409. |
| 3.8.3 | solid | Portion count provably drops by one after two real `nb` writes, value recomputed, serving list follows. |
| 3.8.4 | solid | Exactly one notification, to the guardian only, pupil provably not notified, serving list blocked with a discreet reason, amounts hidden. |
| 3.8.5 | solid | Insurance required, roster expanded from the class, chaperone groups, schedule, printable sheet. |
| 3.8.6 | solid | Status `w` on every lesson of both trip days for a participant, and provably not for a non-participant. |
| 3.8.7 | solid | Non-participants listed, temporary groups assigned with reason and assignor, participant rejected. |
| 3.8.8 | solid | Unknown barcode 404, full class × two titles, already-issued copies skipped, due date in the confirmation. |
| 3.8.9 | solid | Outstanding items block the certificate; returning them flips the pupil to settled; registrar sees the same view; pupil 403. |
| 3.8.10 | solid | Nurse and guardian only; teacher, principal and a foreign parent all 403; every attempt in the access log and the audit. |

### 3.9 Non-functional (`tests/39-nonfunctional.test.js`, `tests/00-foundation.test.js`)

| id | verdict | why | what an honest test asserts |
| --- | --- | --- | --- |
| 3.9.1 | partial | `assert.match(src, /className: 'display app-title'/)` proves *at least* one `h1`, not "one per screen", and `aria-label(ledby)?` proves the string exists somewhere in the file. The print document check is real. | Exactly one `app-title` per screen file, and the data tables a screen reader has to read (grades, tests) carry `scope`/`caption`. |
| 3.9.2 | partial | Token and CSS checks are real and useful, but "200 % magnification **without horizontal scrolling**" is never demonstrated — no layout is measured. | No layout container declares a `min-width` above the phone breakpoint and every wide table is wrapped in its own `overflow-x` container, so the page itself never scrolls sideways. |
| 3.9.3 | partial | Source greps only: a `keydown` listener that does nothing satisfies them. The focus-ring token check is real. | The handlers actually run (sandboxed `core.js` + synthetic key events), as for 3.6.15. |
| 3.9.4 | partial | The VTT is served and has ≥ 5 cues; the player and the transcript exist in `settings.js`. "Accurate subtitles **and text alternatives**" is not checked: the transcript is never compared with the cues, and the cue timings are never validated. | Cue timestamps are monotonic and non-overlapping, and every VTT cue text also appears in the on-screen transcript. |
| 3.9.5 | solid | A session aged past the configured 15 minutes is refused with `session_expired`. | — |
| 3.9.6 | solid | HSTS only behind `x-forwarded-proto: https`, CSP/nosniff/frame-options, and a second server proves the `Secure` cookie flag. | — |
| 3.9.7 | weak | Flaky and off-target. It measures 50 sequential **reads** against a wall-clock budget on shared CI hardware, does not record attendance at all (the story's verb), has no concurrency ("peak morning login hours"), and silently falls back to a different endpoint if the first one is not readable — so it can end up timing the student dashboard instead of the logbook. | A fixed endpoint (no fallback), a warm-up, a **median** rather than a total, and the story's write path (`POST /api/attendance/lesson/:id`) measured as well, under several concurrent sessions. |
| 3.9.8 | partial | The scan and its assertions are genuine (no external resources, no tracker globals, DPO/admin only, service worker free of absolute URLs). But the CSP assertion is `match(/default-src 'self'/)`, which stays true even when `videoOrigin()` widens `script-src`/`frame-src` to an external host. | With no video host configured the CSP grants no external origin at all; with one configured exactly that host (and its `wss:` form) appears and nothing else. |
| 3.9.9 | solid | Personal fields nulled across users, students, grades and message bodies; audit length never shrinks; technical rows kept; no personal data left in the audit; re-login refused. | — |
| 3.9.10 | partial | Static layout checks plus an entitlements/paywall check and five endpoints reached from a "mobile" session. "100 % of platform features" is not measured, and no viewport is rendered. | Every registered screen's primary endpoint answers 200 for the role that owns it, so "100 % of features" is a count and not a claim. |

## Suite hygiene

### The coverage script could mark a story green out of a failing file — **fixed**

`scripts/checklist-status.js` parsed TAP lines with `/^\s*(not ok|ok) \d+ - (.*)$/` and took the ids out of
the **test name**. Two ways that mis-marks, both reproduced:

1. **A file-level failure carries no ids.** When a `test.after` hook throws, or an async error escapes after
   the tests have reported, node emits the passing subtests first and then
   `not ok N - /abs/path/to/x.test.js` — a line with no `[3.x.y]` in it. The story stayed **green out of a
   red file**. Reproduction: a file with `test.after(() => { throw new Error('x') })` around a passing
   `[3.1.1]` yields `ok 1 - [3.1.1] …` + `not ok 2 - …/a.test.js`, and the old script reported 3.1.1 as
   covered.
2. **A skipped test counted as evidence.** node emits a skip as `ok N - name # SKIP reason`, which the
   regex accepted as a pass. `tests/43-pdf.test.js` already uses `t.skip()` on machines without Chromium.

The script now (a) reads the ids declared in each `tests/*.test.js` file, (b) fails **every id of a file**
whose file-level line is `not ok`, (c) rejects `# SKIP` and `# TODO` directives as evidence, and (d) refuses
to write green ticks at all when the run did not finish cleanly (`--write` aborts on a non-zero exit unless
`--force` is given). It also prints why each id was rejected.

### Order dependence — 13 tests fail when run on their own

Files each start their own seeded server, so files are independent of one another, but **inside** a file the
tests are chained through shared seed state. Running one test at a time with
`node --test --test-name-pattern='\[3\.2\.20\]' tests/32-homeroom.test.js` fails for:

`3.2.14`, `3.2.17`, `3.2.20`, `3.3.2`, `3.3.3`, `3.3.4`, `3.3.5`, `3.3.6`, `3.3.16`, `3.4.8`, `3.7.4`,
`3.7.13`, `3.8.2`.

The dependencies are real and mostly deliberate (3.2.20 needs the semester 3.2.11 closed; 3.3.5 publishes the
substitutions 3.3.3/3.3.4 created; 3.7.4 decides the excuse 3.7.3 filed; 3.3.16 asserts on the audit row
3.3.10 wrote). This is allowed by `CONTRIBUTING.md` ("keep each test independent … **where possible**"), but
it means a single story's evidence cannot be re-verified in isolation, and a failure early in a file
cascades. Worth recording rather than rewriting: each of these would need its own fixture.

### Flakiness and shared-state leakage

- **`[3.9.7]` is the only genuinely time-dependent test** (50 sequential reads under a 2000 ms total budget,
  plus a single read under 200 ms). On a loaded machine — for instance while the rest of the suite runs in
  parallel — it is the first thing to go red. Strengthened below to a median with a warm-up.
- Several tests mutate `db.data.config` mid-run and restore it at the end (`retakeRule` in 3.1.8,
  `config.today` in 3.1.21/3.1.22, `adultSelfExcuseAllowed` in 3.6.11, `modules.enabled` in `[meetings.11]`).
  The restore is unconditional only in `[meetings.11]` (`try/finally`); everywhere else an assertion failure
  leaves the config changed for every later test in that file.
- `[3.3.20]` leaves `visibility.rankings: false` set; it is the last test in its file, so nothing notices.
- No test passes because of a swallowed exception. The four `try` blocks in the suite are all
  `try/finally` cleanups; `tests/44-setup.test.js` does `res.json().catch(() => ({}))`, which can turn a
  non-JSON error body into `{}` — harmless today because that file asserts on status codes.

### Duplicated coverage

- `[3.6.14]` (dark mode) also tests quiet hours, deferred notifications and push registration — all of which
  `[3.7.7]` tests properly. The dark-mode half, the part the story is about, is the thin one.
- `[3.3.15]` and `[3.8.6]` both approve a trip and assert the `w` status; `[3.8.6]` is the stronger of the two.
- `[3.2.14]` and `[3.7.14]` are the two ends of the same 30-day warning; that pairing is deliberate and good.
- `[3.9.5]` lives in `tests/00-foundation.test.js`, away from the rest of 3.9. Harmless, but it is why
  `39-nonfunctional.test.js` has nine tests for ten stories.

### Non-determinism outside the tests

The seed itself is deterministic in content (attendance, grades, lessons identical across runs); only the
generated keys, password hashes and `meta.seededAt` differ. Failures seen while this review was running
(`[3.1.5]`, `[3.1.19]`, `[3.2.6]`, `[3.2.9]`) came from **other in-flight edits to `server/` in the same
working tree**, not from the tests. Re-verify the counts on a quiescent tree.

## (c) The weakest 15, in order, with the assertions to add

| # | story | why it is weak | exact assertion added |
| --- | --- | --- | --- |
| 1 | `[3.9.7]` performance | Wall-clock total over 50 reads on shared hardware; no write path; no concurrency; silently swaps to a different endpoint if the first is unreadable. | Fixed endpoint (throw instead of falling back), warm-up of 5, **median** of 50 reads under 60 ms, plus the story's write (`POST /api/attendance/lesson/:id`) measured as a median under 150 ms, and 10 concurrent reads all answering 200. |
| 2 | `[3.7.2]` instant push | The notification only exists because the test itself calls `/absence-alerts/scan`. | After the teacher saves `nb` on lesson 1, the guardian's crisis notification exists **before** any scan call. Implementation missing → the test is now `todo` with that reason. |
| 3 | `[3.3.12]` blocking announcement | Only the session flag is asserted; nothing about blocking. | `public/app/shell.js` renders the pending announcement through `E.Dialog` with `blocking: true`, and returns it **instead of** the routed screen. |
| 4 | `[3.2.8]` print alignment | Greps prose, ignores the geometry the document actually prints. | The four corner registration marks are emitted with `position:fixed` and a stated size, and the `@page` margin equals the 18 mm the geometry note claims. |
| 5 | `[3.1.1]` "under 30 seconds" | `Date.now() - started < 30000` around two HTTP calls cannot fail. | The whole registration is exactly two write requests (the roster comes back prefilled, so there is no per-pupil call) and the server round-trip for both is under 1 s. |
| 6 | `[3.4.15]` real-time welfare alert | Computed only when the counsellor opens the page; absences written straight into the store. | The alert and the crisis notification exist after the third day is saved through the attendance API, with no support endpoint called. Implementation missing → `todo`. |
| 7 | `[3.5.9]` messaging permissions | Only the config setting round-trips. | Under `homeroomAndSubject` a parent messaging a non-teaching teacher is 403 `messaging_not_allowed`; under `all` the same message is accepted and stored. |
| 8 | `[3.6.7]` goal simulation | Key assertions sit behind `if (sim.reachable)` / `if (lower)`. | The pinned scenario is `reachable === true` unconditionally, `needed` reaches the threshold and `needed - 1` provably does not. |
| 9 | `[3.6.13]` library reminder | Accepts any seeded notice; `dueDate <= semesterEnd` is true for nearly every loan. | A loan due inside the notice window yields exactly one notice and one notification; a loan due after the window yields neither. |
| 10 | `[3.6.14]` dark mode | Only a preference string round-trips. | `public/app/theme.js` writes `document.documentElement.dataset.theme` from the stored choice before first paint and `tokens.css` defines the `[data-theme="dark"]` palette. |
| 11 | `[3.1.9]` bulk entry | Server bulk route only; keypad and Enter untested. | `teacher-grades.js` has a bulk mode whose Enter commits and moves focus to the next pupil in the same column, and the grade input is numeric. |
| 12 | `[3.1.25]` offline sync | The client queue and the service worker never run. | `public/app/core.js` in a sandbox: a failed write with `queueable:true` returns `{queued:true}` and lands in `localStorage`; coming online replays it in order and empties the queue. |
| 13 | `[3.9.4]` subtitles | Cue count only; the transcript is never compared with the cues. | Every cue timestamp is monotonic and non-overlapping, and every cue's text also appears in the on-screen transcript in `settings.js`. |
| 14 | `[3.9.1]` one h1 per screen | `assert.match` proves "at least one". | Exactly one `display app-title` per screen file. |
| 15 | `[3.3.16]` audit date filter | Filtered with a range covering every row. | A window entirely before the school year returns zero rows, and a one-day window returns only rows from that day. |

Runners-up that were left as they are, with the reason recorded above: `[3.1.12]` (grades in a combined
lesson), `[3.4.8]` (real PDF path), `[3.4.10]` (incident body stored in clear), `[3.9.8]` (CSP widened by a
configured video host), `[3.6.15]`/`[3.9.3]` (source greps instead of behaviour).

## (d) Documentation vs behaviour

Checked every endpoint, environment variable, flag, module id and "simulated" claim in `README.md`,
`docs/INTEGRATION.md`, `docs/COURSES.md`, `docs/VIDEO.md` and `CONTRIBUTING.md` against the code.
What matched: all 25 `/api/courses*` routes in `docs/COURSES.md`; the thirteen demo personas; the required
module set (`core, logbook, grades, registry, messages`); `EDMAT_BASE_PATH` / `EDMAT_SSO_SECRET` and the SSO
token shape; `EDMAT_TODAY` defaulting to 2026-10-23; the demo, feedback, modules and setup endpoints; the
`npm` scripts. What did not:

| # | file | claim | reality | fix |
| --- | --- | --- | --- | --- |
| D1 | `README.md` "Co jest symulowane" | `"PDF" to dokument HTML gotowy do druku (przeglądarka zapisuje do PDF)` | A real server-side renderer ships: `server/lib/pdf.js` + `GET /api/pdf?path=…` prints the HTML with a local headless Chromium, `public/app/print.js` opens it, `tests/43-pdf.test.js` covers it, `EDMAT_CHROME` / `EDMAT_PDF_TIMEOUT` configure it. | Rewritten: real PDF when a Chromium is present, print-ready HTML as the documented fallback (`501 pdf_unavailable`). |
| D2 | `docs/INTEGRATION.md` §5 "out of scope" | "A real PDF renderer (print-ready HTML is deliberate; a headless Chromium job can produce PDFs server-side later)." | Same as D1 — it is no longer out of scope. | Replaced with what is actually still out of scope (a bundled browser). |
| D3 | `README.md` "Zmienne:" | Lists `PORT`, `EDMAT_DATA`, `EDMAT_SECURE_COOKIES`, `EDMAT_LOG`, `EDMAT_TODAY`. | The code also reads `EDMAT_CHROME`, `EDMAT_PDF_TIMEOUT`, `EDMAT_JITSI_DOMAIN`, `EDMAT_JITSI_APP_ID`, `EDMAT_JITSI_APP_SECRET`, `EDMAT_VIDEO_EVENT_SECRET`, `EDMAT_SEED`, `EDMAT_DEMO`, `EDMAT_DEV`. | Variable list completed, with pointers to `docs/VIDEO.md`. |
| D4 | `README.md` "Moduły:" | Names thirteen modules. | `server/modules.js` has fourteen; `core` ("Rdzeń") is missing from the list. | `core` added and the required ones marked. |
| D5 | `README.md` "Co jest symulowane" | "Powiadomienia push są zapisywane po stronie serwera … bez dostawcy push." | True, but it hides the bigger gap: the "instant" and "real-time" alerts (`3.7.2`, `3.4.15`) are **computed when a client asks**, not pushed. `pushSubscriptions` rows are stored and never used. | Expanded to say the alerts are pull-based and that subscriptions are stored but never delivered to. |
| D6 | `README.md` "Uruchomienie" | No `npm run smoke`. | `package.json` defines it and `CONTRIBUTING.md` documents it. | Added. |
| D7 | `README.md` "Architektura" | `server/lib/` described as store + audit + crypto + domain helpers. | It also holds `pdf.js` (real PDF) and `video.js` (Jitsi/BBB URL and JWT construction), both user-visible features. | Both added. |
| D8 | `docs/INTEGRATION.md` §1 "Data ownership" | "No third-party scripts, fonts or analytics are loaded, which the test suite verifies (`[3.9.8]`)." | True by default, but when a school configures its own Jitsi host the CSP is widened to exactly that host and `public/app/screens/meetings.js` lazily loads `https://<host>/external_api.js` (documented in `docs/VIDEO.md` §6, not here). | Caveat added; the "no third party" claim now says "nothing outside the school's own servers". |
| D9 | `docs/COURSES.md` "Seed and tests" | "`tests/41-courses.test.js` covers the module end to end as `[courses.1]`…`[courses.9]`." | There are ten tests; `[courses.10]` covers the `meeting` item kind creating and cancelling a video meeting. | Corrected to `[courses.1]`…`[courses.10]` and the meeting item named. |
| D10 | `docs/VIDEO.md` §5.4 | Titled "The CSP patch (**proposal** — `server/index.js` is not edited by this module)" and presented as a diff to apply. | The patch is already applied verbatim: `videoOrigin()`, the widened `Permissions-Policy` and the five video directives are live in `server/index.js`. | Re-titled and re-worded as applied, keeping the diff as the record of what changed. |
| D11 | `CONTRIBUTING.md` "Testing" | "`node --test tests/31-teacher.test.js` (one file)" | No such file: 3.1 is split into `tests/31a-lessons.test.js` and `tests/31b-grades.test.js`. | Corrected, and the per-test form (`--test-name-pattern`) documented together with the caveat that 13 tests only pass in file order. |
| D12 | `CONTRIBUTING.md` logins list | Ends at `rodzic.adamczyk`. | The seed also has `rodzic.mazurek` and `rodzic.borowska`; `tests/36-student.test.js` `[3.6.12]` logs in as `rodzic.borowska`. | Both added. |

| D13 | `../checklist.md`, `../checklist_pl.md` | All 145 stories ticked `[x]`. | Two of them (`3.4.15`, `3.7.2`) have no honest evidence — their tests are now `todo`. | Both lists re-marked with `node scripts/checklist-status.js --write`: 143/145 ticked, the two open ones unticked. Re-running the script re-ticks them the moment the two features land. |

Two claims that are accurate and worth keeping as they are, because they are easy to misread as
overstatements: the archive seal really is an RSA-SHA256 signature verified against the school public key
(`[3.3.17]`), and CSV/XML exports really are produced (not simulated), with a BOM and `;` as the separator.


## What this review changed

Tests (test files only — no production code was touched by this review):

| file | change |
| --- | --- |
| `tests/31a-lessons.test.js` | `[3.1.1]` counts write requests instead of running a wall clock that cannot fail; new `[3.1.25]` case runs `public/app/core.js` in a sandbox and drives the real per-account offline queue (queued while offline, refused for a foreign session, replayed in order on `online`). |
| `tests/31b-grades.test.js` | `[3.1.9]` now asserts the bulk-entry keyboard path: Enter commits and advances to the next pupil with the focus following, and the grade input opens a numeric keypad. |
| `tests/32-homeroom.test.js` | `[3.2.8]` asserts the printed geometry (four corner registration marks, `@page` margin equal to the stated blank margin, 174 mm + 2 × 18 mm = 210 mm) instead of the prose describing it. |
| `tests/33-principal.test.js` | `[3.3.12]` asserts the blocking dialog (`E.Dialog blocking: true`, `alertdialog`, `aria-modal`, Escape disabled, focus trapped) and that the session keeps reporting the announcement until it is acknowledged. `[3.3.16]` replaces an all-matching date range with an empty window and a one-day window. |
| `tests/34-support.test.js` | `[3.4.15]` now requires the alert to exist the moment the third day's absence is saved through the attendance API — **marked `todo`**, the implementation only scans on read. |
| `tests/35-registry.test.js` | `[3.5.9]` sends a real message under both modes: accepted under `all`, 403 `messaging_not_allowed` under `homeroomAndSubject`, homeroom always reachable, recipient list follows. |
| `tests/36-student.test.js` | `[3.6.7]` drops the `if (reachable)` escape hatch and pins the scenario (monotonic options, `needed` is the lowest sufficient grade, unreachable branch checked separately). `[3.6.13]` creates two loans on either side of the reminder window and asserts one notice and one notification, and none for the other. `[3.6.14]` follows the theme from the settings screen through `A.setTheme` to `data-theme` on `<html>`, the pre-paint restore in `theme.js`, and a dark palette that is measurably darker than the light one. |
| `tests/37-parent.test.js` | `[3.7.2]` now requires the push notification to exist right after the teacher saves `nb`, with no scan call — **marked `todo`**. |
| `tests/39-nonfunctional.test.js` | `[3.9.1]` counts headings instead of matching one. `[3.9.4]` parses the cues and compares every one of them with the on-screen transcript. `[3.9.7]` rewritten: fixed endpoint, warm-up, medians, the write path, and ten concurrent sessions. |

Tooling and docs: `scripts/checklist-status.js` rewritten (see *Suite hygiene*); `README.md`, `docs/INTEGRATION.md`,
`docs/COURSES.md`, `docs/VIDEO.md` and `CONTRIBUTING.md` corrected per §d; both checklists re-marked.

## Remaining concerns

1. **Two stories now have no evidence.** `3.7.2` ("instant push") and `3.4.15` ("real-time monitoring") need the
   alert raised where the data changes — in `server/routes/attendance.js`, after a save — instead of inside the
   reader's GET. Both are a handful of lines: call the existing `scanAbsenceAlerts` / `scanAttendanceAlerts`
   from the attendance write path. The tests are written and will go green the moment that lands.
2. **Order dependence is unresolved.** Thirteen tests only pass in file order. That is a deliberate trade-off,
   but it means no single story's evidence can be re-verified on its own, and one early failure hides twelve.
3. **Source-grep tests.** `3.9.3`, `3.6.15`, and parts of `3.9.2`/`3.9.10` assert on the text of client files.
   The sandbox pattern now used by `[3.1.25]` and `tests/43-pdf.test.js` would turn them into behaviour tests.
4. **Print documents are not screen-reader-checked.** They have `<th>` but no `scope` and no `<caption>`;
   `3.9.1` now asserts the `<th>` row exists but cannot claim the tables are properly headed.
5. **The working tree moved while this review ran.** `server/`, `public/` and several test files were being
   edited by other reviewers at the same time; `public/app/core.js` changed its queue model mid-review. All
   numbers here come from the tree as it stood at the end of the review — re-run `node --test tests/` and
   `node scripts/checklist-status.js` after the other branches land.
