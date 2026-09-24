# Przegląd bezpieczeństwa — prototyp EdMat

Adversarial review of the EdMat single-school prototype, carried out with the team's
authorisation against the working tree of `prototype/` (server, routes, client shell and
service worker). The system holds special-category personal data of minors (grades,
attendance, psychological-pedagogical documentation, health records, PESEL numbers), so the
yardstick throughout is GDPR Art. 5(1)(f), Art. 9 and Art. 32 rather than "does it work".

**Scope.** `CONTRIBUTING.md`, `server/index.js`, `server/auth.js`, `server/lib/{router,crypto,audit,domain,store,util,video,pdf}.js`,
all 23 files in `server/routes/`, `public/app/core.js`, `public/sw.js`, plus the client
screens where a server-side finding needed confirming at the rendering end.

**Method.** Source review plus throwaway exploit scripts driven through the real HTTP stack
with `tests/helpers.js` `startServer()`. Every finding below was reproduced against a running
server; the scripts were deleted afterwards and the reproductions that matter were re-written
as permanent regression tests in `tests/45-security.test.js`.

> **Note on concurrency.** While this review was running, another process was editing
> `server/routes/{attendance,lessons,homeroom,remarks,setup}.js`, `server/lib/{util,blank-seed}.js`.
> Findings in those files were re-verified against the current contents before publishing.
> The one failing test in the suite at hand-off (`[setup.3]`) comes from that in-flight work —
> it fails identically with every change from this review reverted.

---

## Findings

| id | severity | CWE | where (file:line) | proof | fix |
| --- | --- | --- | --- | --- | --- |
| **S-01** | **high** | CWE-307 *Improper restriction of excessive authentication attempts* | `server/auth.js:21` (`/api/auth/login`), `:34` (`/api/auth/totp`), `:56` (`/api/auth/sso`); `server/routes/admin.js:350` (`/api/register`) | 60 wrong passwords for `j.nowak` from one address: 60× HTTP 401 in 3.5 s, no 429, and the correct password worked immediately after. 40 `/api/register` code guesses completed in **74 ms** (≈540 req/s). 30 forged SSO tokens: 30× 401, no throttle. The TOTP check accepts a ±1 step window (`crypto.js:21`), so three of every 10⁶ codes are live — ~333 k expected guesses, hours at the observed rate. | **FIXED** — in-memory sliding window per (IP, login) and per IP in `server/auth.js`, wired through `auth.guarded()` from `server/index.js:66`. Polish 429, audited once per lockout as `login_rate_limited`. |
| **S-02** | **high** | CWE-639 *Authorization bypass through user-controlled key* / CWE-200 | `server/routes/grades.js:467` (`GET /api/descriptive-grades`) | The route declared no `roles` and only called `assertCanSee` **when `studentId` was supplied**. `GET /api/descriptive-grades` with no parameters, as pupil `anna.kowalczyk` (7b), returned every descriptive assessment in the school for the current semester with full names — proof run retrieved `st_adamczyk_leon`'s assessment text verbatim. Same for any parent account. | **FIXED** — a scope (`studentId` or `classId`) is now mandatory, `studentId` goes through `assertCanSee`, and the class-wide form is refused to any account with a restricted `visibleStudentIds` (pupils, parents). |
| **S-03** | **high** | CWE-285 *Improper authorization* (GDPR Art. 9) | `server/routes/support.js:206` (`/api/support/wopfu`), `:262` (`/api/support/ipet`), `:384` (`/api/support/ipet-implementation`) | `roles: TEAM.concat(['teacher'])` with no per-pupil check, and with no `studentId` the handlers returned the **whole collection**. Physics teacher `a.wojcik` read a complete IPET (diagnosis basis, support hours, exam accommodations) and WOPFU (barriers, recommendations) for a pupil — special-category disability data, Art. 9 GDPR. | **FIXED** — new `assertSupportSubject()`: a named `studentId` is required, the support team keeps full access, and a plain teacher only reaches pupils they actually teach or are homeroom of. |
| **S-04** | **high** | CWE-863 *Incorrect authorization* (GDPR Art. 6/9, consent) | `server/routes/meetings.js:456` (`POST /api/meetings/:id/recording-consent`) | `D.assertCanSeeStudent` is a no-op for staff, and the only extra guard was "a *pupil* may not consent for a minor". The meeting host therefore recorded the guardians' consent themselves. Proof: teacher `j.nowak` created a 7b remote lesson (13 missing consents), was correctly refused recording (409), then POSTed consent for all 13 minors and enabled recording — the consent gate became decorative. | **FIXED** — only the pupil's own guardian (`s.parentIds`) or the adult pupil themselves may record a decision; staff get 403 `not_guardian`. |
| **S-05** | **high** | CWE-613 *Insufficient session expiration* / CWE-384 *Session fixation* | `server/auth.js:44` (`/api/auth/password`), `:21` (login) | A session opened before a password change stayed fully valid afterwards (proof: session A returns 200 on `/api/auth/session` after session B changed the password) — so the standard "someone knows my password, I'll change it" remediation did nothing. Login never revoked the session id the browser presented, and there was no cap: 25 consecutive logins left 25 live sessions for one account. Contrast `admin.js:261`, where an admin-driven reset *does* revoke sessions — the inconsistency was the tell. | **FIXED** — password change revokes every other session of the account (keeping the caller's), login revokes the presented session id and mints a fresh token, TOTP success rotates the token across the privilege boundary, and `capSessions()` bounds live sessions per account (`config.maxSessionsPerUser`, default 30). |
| **S-06** | medium | CWE-352 *CSRF* / CWE-1286 *Improper validation of syntactic correctness of input* | `server/index.js:53` (old body parsing) | The body was parsed as JSON **only** when the content-type said so; otherwise the raw string was handed to the handler and the handler still ran. Proof: `POST /api/auth/touch` and `PATCH /api/me/preferences` with `Content-Type: text/plain` and with `application/x-www-form-urlencoded` both returned 200. These are CORS "simple requests", so a cross-site `<form>` or `fetch()` reaches them; the only thing stopping the cookie from riding along was `SameSite=Strict`, with no second line of defence (no Origin check, no token, no content-type enforcement) and no protection against a same-site subdomain. A string body also reached handlers that assume an object. | **FIXED** — `readJsonBody()` in `server/lib/router.js` refuses anything but `application/json` with 415 `unsupported_media_type`, and malformed JSON with 400 `bad_json` instead of a 500. |
| **S-07** | medium | CWE-1236 *Improper neutralization of formula elements in a CSV file* | `server/lib/domain.js:38` (`csv()`), consumed by `grades.js:500` (`/api/grades/export.csv`), `demo.js:51` (`/api/feedback/export.csv`), `homeroom.js:560` (attendance CSV), `substitutions.js:323` (payroll export) | A teacher's grade comment `=cmd\|' /C calc'!A1` came out of `/api/grades/export.csv` as the raw cell `…;tak;=cmd\|' /C calc'!A1`, i.e. a live formula in Excel/LibreOffice. `=HYPERLINK("http://evil","x")` in `/api/feedback` likewise survived into the admin export. Every field here is attacker-writable by design (comments, feedback, pupil names). | **FIXED** — `csvCell()` prefixes a cell starting with `=`, `+`, `-`, `@`, tab or CR with an apostrophe. Plain numbers (`-12,5`) and grades (`4+`) are deliberately left alone so the exports stay machine-readable. |
| **S-08** | medium | CWE-778 *Insufficient logging* (GDPR accountability) | `server/routes/support.js:299` (`GET /api/support/notes`), `:134` (`GET /api/support/overview`) | Both routes call `openNote()`, which **decrypts** confidential intervention notes for entitled readers, and neither writes an audit row. Proof: `e.zielinska` fetched `/api/support/notes`, received one note with `sealed:false` and the plaintext, and the audit collection grew by **0** rows; same for `/api/support/overview?studentId=…`. Only the single-note route `:304` audits `note_read`. The contributor contract requires reads of this material to be accountable. | **reported** — patch below. |
| **S-09** | medium | CWE-524 *Use of cache containing sensitive information* / CWE-359 | `public/sw.js:9`, `public/app/core.js:52` (`logout()`) | The service worker mirrors **every** `GET /api/…` response into the browser Cache Storage for offline use, and nothing ever evicted it. On a shared staffroom or library machine, grades, attendance, messages, IPET data and nurse visits stayed readable through the cache after logout, and survived restarts. | **FIXED** — `sw.js` listens for `postMessage({type:'logout'})` and deletes every cached `/api/` entry (keeping the app shell so the login page still works offline); `core.js logout()` sends it. |
| **S-10** | medium | CWE-200 *Exposure of sensitive information to an unauthorized actor* | `grades.js:390` (`/api/grades/student/:id`), `:483` (`/api/grades/record/:id`), `remarks.js:37` (`/api/remarks?classId=`), `homework.js:169` (submission detail), `attendance.js:217` (`/api/attendance/class/:id/monthly`) | The `staff` alias covers 14 roles including cafeteria, library, after-school care and the DPO. Proof as `biblioteka` (librarian): 19 grades of a named 7b pupil, 11 behaviour remarks for the whole of 7b, and a homework submission returned **inline with the file's `dataUrl`**. None of these roles has a need-to-know for a pupil's grades or behaviour record. | **partly FIXED** — the homework-submission read (the one that hands over file contents) is now restricted to the setting teacher, the homeroom teacher, the pupil and their guardian. The rest is reported: see "Remaining work". |
| **S-11** | medium | CWE-522 *Insufficiently protected credentials* | `server/auth.js:51` (`POST /api/auth/totp/setup`) | For an account that already has 2FA enabled the route returns the **existing** `totpSecret` (and the `otpauth://` URI) to anyone holding the session, with no password re-authentication and no audit row. Proof: two consecutive calls as `admin` returned the same secret `OD4G…7MTY`. A borrowed or hijacked session converts into a permanent second factor. | **reported** — patch below. |
| **S-12** | medium | CWE-770 *Allocation of resources without limits* | `server/lib/router.js:20` (`readBody` default) | One 25 MB cap applied to every route, including `POST /api/feedback`, whose text is then truncated to 4 000 characters. Proof: a 20 MB body was buffered and accepted with 200. Any authenticated account could pin ~25 MB of heap per in-flight request. | **FIXED** — per-route-type caps: 512 KB for ordinary JSON routes, 25 MB only for the routes that genuinely carry `dataUrl` attachments or pasted CSV (`UPLOAD_ROUTES`), plus a per-route `opts.maxBody` override. |
| **S-13** | medium | CWE-434 *Unrestricted upload of file with dangerous type* / CWE-646 | `homework.js:56` (`subView`), `:133` (submission cleaning), `student.js:403` (`POST /api/materials`), `messages.js:164` (attachments), `public/app/screens/teacher-lesson.js:436` | Uploads are stored as client-supplied `dataUrl` + client-declared `type` with no allowlist, no magic-byte check and no validation that the `data:` prefix matches the declared type. `subView` marks anything matching `/^(image\|text\|application\/pdf)/` as `viewable`, so a pupil can submit `type: "text/html"` with `dataUrl: "data:text/html,<script>…"`, and the teacher's screen renders `<a href={dataUrl} target="_blank">`. What keeps this from being stored XSS is the browser (top-level `data:` navigation has been blocked since 2017) and `frame-src 'self'`, not the application. Per-file size is capped but the **total** across files is not. | **reported** — patch below. |
| **S-14** | low | CWE-248 *Uncaught exception* / CWE-703 | `server/auth.js:25` (was `C.verifyPassword(password \|\| '', …)`) | `POST /api/auth/login` with `{"password":{}}` or `{"password":["a"]}` put a non-string into `crypto.scryptSync`, which threw — HTTP 500 plus a stack trace on stderr. The response body was the generic `Błąd serwera.`, so nothing leaked to the client, but it is a cheap log-flooding and error-path nuisance. | **FIXED** — the password is coerced to a string before hashing in both `/api/auth/login` and `/api/auth/password`; a non-string is now a normal 401/400. |
| **S-15** | low | CWE-915 *Improperly controlled modification of dynamically-determined object attributes* | `server/lib/audit.js:6` | `Object.freeze(e)` is shallow: the `before`/`after` sub-objects of an audit row stay mutable in-process, so an ill-behaved handler holding a reference can still rewrite the evidence. `/api/privacy/forget` (`privacy.js:76`) deliberately **replaces** audit rows for Art. 17 redaction — a legitimate, self-audited exception, but it means "append-only" is a convention, not an invariant. The HTTP surface is correct: `PATCH/PUT/DELETE/POST /api/audit/:id` return 405 `audit_immutable` and log the attempt. | **reported** — use a deep freeze, and keep the Art. 17 path as the single documented exception. |
| **S-16** | low | CWE-307 | `server/routes/support.js:600` (`POST /api/support/interviews/:id/attachment`) | The attachment password is checked with `scryptSync` per request with no throttle. Restricted to `counselor`/`principal`, so it is an insider/CPU issue rather than an anonymous one. | **naprawione** — przesuwane okno w `support.js`: 5 nieudanych prób na parę (użytkownik, wywiad) w 15 min, potem 429 `rate_limited`, blokada audytowana raz; test `[S-16]` w `tests/34`. |
| **S-17** | low | CWE-862 *Missing authorization* | `server/routes/modules.js:468` (`POST /api/modules/trips/:id/non-participants`) | Unlike every other trip write, this one never calls `assertTripEditable`, so any teacher can reassign the supervision groups of a trip they have nothing to do with. | **reported** — one-line patch below. |
| **S-18** | low | CWE-405 *Asymmetric resource consumption* | `server/routes/support.js:318` (`POST /api/support/notes`) | `ensureKeys()` generates a 2048-bit RSA key pair for **every** id in `readerIds` before the reader's role is validated, so a malformed request costs many key generations before it is rejected. | **reported** — validate the role first, then generate. |
| **S-19** | info | — | `server/index.js:36` | Headers re-verified as requested: `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`, `Referrer-Policy: same-origin`, a tight `Permissions-Policy`, `frame-ancestors 'none'`, `base-uri 'self'`, `form-action 'self'`, `Cache-Control: no-store` on every API response, HSTS when the connection is secure, and the video origin only admitted into CSP when a real domain is configured. Two gaps: `style-src 'unsafe-inline'` and no `object-src 'none'`. | **reported** — low value, non-breaking. |

### Checks that came back clean

Items on the brief that were probed and found to be correctly handled:

- **`/api/pdf` SSRF and header injection** (`routes/pdf.js`). The path must start with `/api/`, must not contain `..`, must not be `/api/pdf` itself, and must resolve to a real registered GET route *before* the loopback request is made; an absolute URL is rejected with 400 `bad_path`. The loopback carries the caller's cookie to the app's own port, so the inner role guard is re-applied and a 403 is passed through unchanged (verified: a pupil asking for a homeroom printout gets 403, not a PDF). A non-HTML resource is refused with 415, and `fileName()` strips everything outside `[A-Za-z0-9._-]`, so no CRLF or quote reaches `Content-Disposition`. `X-Forwarded-For` is set deliberately so the audit row and IP allowlist keep pointing at the real caller.
- **Dev login and demo switch cannot be turned on by a request.** `GET /api/dev/login` is only registered when `EDMAT_DEV=1` at process start (`auth.js:42`); no route writes `config.demo.enabled`, and `demoEnabled()` also reads `EDMAT_DEMO` from the environment. No route can promote a request into either mode.
- **No credential leakage in payloads.** `auth.publicUser()` strips `passwordHash`, `totpSecret` and `privateKey`; `/api/auth/session`, `/api/admin/users`, `/api/principal/staff` and the anonymised backup were all checked and carry none of them. `publicConfig()` withholds `ipAllowlist` and `schoolPrivateKey`; the video admin view reports `appSecretSet: true/false` and never the secret.
- **Confidential notes are genuinely confidential.** AES-256-GCM content keys wrapped per reader with RSA-OAEP; the principal's own route `/api/principal/specialist-log/notes/:id` refuses and audits its own refusal rather than quietly returning metadata. A plain teacher gets 403 on `/api/support/notes`.
- **Health records.** `/api/modules/nurse/visits*` is restricted to the nurse and the pupil's guardians, and **every** access — including each refusal — is written to both `nurseVisitAccessLog` and the audit log.
- **The incident register** (`blueCard`/`probation`) records every read attempt in `accessLog` plus the audit log, grants only to the named readers, and returns sealed metadata to everyone else.
- **Messaging.** `isParty()` is enforced on read, ack and read-receipt; a parent cannot ack or read a message they are not addressed on; `personRef()` deliberately withholds phone numbers, e-mail addresses and logins from both sides; confidential messages are excluded from the principal/DPO supervision list.
- **Core IDOR paths hold.** Verified negative: a 7a homeroom teacher reading 7b's classification board (403 `not_homeroom`), a parent reading another child's grades (403), a pupil requesting another pupil's grades (403), a physics teacher writing a Polish grade (403 `not_teaching`), a parent paying another family's fee (403), a second parent cancelling someone else's consultation booking (403 `not_owner`), a parent reaching a principal-only route (403).
- **Audit immutability over HTTP.** Every mutating verb on `/api/audit/:id` returns 405 `audit_immutable` and records the attempt.
- **SSO tokens** are HMAC-SHA256 with `timingSafeEqual`, an `exp` check and a replay-protected nonce list; the `to` redirect is constrained to a relative path by regex, so it cannot be turned into an open redirect.
- **Video provider webhooks** fail closed when no shared secret is configured (`video.js:200,221`) and use constant-time comparison.

---

## Done well

1. **A single, honest access-control vocabulary.** `D.visibleStudentIds` / `D.assertCanSeeStudent` give one answer to "whose data is this" and are used consistently across grades, attendance, homework, courses, meetings and payments. Most of the IDOR surface is closed by that one helper, and the failures found were all *places that forgot to call it*, not a broken model.
2. **Defence in depth on the homeroom boundary.** `homeroom.js scope()` re-derives the class from params/query/body and re-checks it on every single route, so the role gate (`homeroom` + `homeroomOf`) is never trusted on its own. A 7a homeroom teacher genuinely cannot touch 7b.
3. **Encryption where it earns its keep.** Confidential notes and report requests use per-reader RSA-wrapped AES-256-GCM, so the database alone does not yield the plaintext — and the principal's route proves the team tested that *they* cannot read it either. Community-interview attachments are password-encrypted with scrypt + AES-GCM.
4. **Access logging on the most sensitive collections.** Nurse visits and the incident register log every read *and every refusal*, with IP, into a dedicated collection as well as the audit log. That is above the bar for a prototype.
5. **A real WORM story for the audit log.** Append-only helper, shallow-frozen rows, explicit 405 on every mutating verb with the attempt itself audited, a retention *report* that deletes nothing, and minimum retention periods that cannot be lowered below the statutory floor.
6. **Art. 17 handled as redaction, not deletion.** `/api/privacy/forget` keeps the technical audit trail (account id, IP, action) while redacting names and content, which is the right reading of erasure against accountability.
7. **Output encoding in printouts.** Every `D.printHtml` caller reviewed passes user data through `D.xmlEsc` — grade comments, remarks, descriptive assessments, pupil and guardian names, trip schedules, duplicate-certificate annotations, receipt fields. No unescaped interpolation of user data into a print document was found anywhere in the 23 route files.
8. **Security headers set once, centrally, and correctly.** Including `frame-ancestors 'none'`, `form-action 'self'`, `Cache-Control: no-store` on all API responses, and a CSP that only widens to the school's video host when a *real* domain is configured — the seed's example domain is deliberately rejected by a regex.
9. **Zero third-party code in the browser.** `/api/privacy/trackers` statically proves it, and the CSP enforces it.
10. **Data minimisation as a product decision.** Phone numbers and e-mail addresses are withheld from the other party in messaging; the second guardian's contact details are explicitly not exposed; the cafeteria debt block notifies only the guardians and never shows the pupil a reason at the counter; the SIO export supports an anonymised mode; the test-environment backup pseudonymises deterministically and strips every secret.
11. **Good "deny" ergonomics.** Refusals carry a stable machine `code` and a Polish sentence that tells the user what to do — which is why the gaps above stood out: they were the routes that said nothing at all.

---

## What was fixed in this pass

| file | change |
| --- | --- |
| `server/auth.js` | Brute-force window (S-01), session rotation on login and on TOTP completion, revocation of other sessions on password change, per-account session cap (S-05), string coercion of passwords (S-14). Exports `guarded`, `resetRateLimits`, `revokeOtherSessions`, `capSessions`. |
| `server/lib/router.js` | `readJsonBody()` — 415 on non-JSON, 400 on malformed JSON (S-06) — and per-route-type body caps via `bodyLimitFor()` / `UPLOAD_ROUTES` (S-12). |
| `server/index.js` | Two lines only: body parsing goes through `readJsonBody(req, route)`, and the handler is invoked through `auth.guarded(route, ctx)`. |
| `server/lib/domain.js` | `csvCell()` neutralises spreadsheet formulas in every CSV export (S-07). |
| `server/routes/grades.js` | `GET /api/descriptive-grades` requires a scope and enforces it (S-02). |
| `server/routes/support.js` | `assertSupportSubject()` on `/api/support/{wopfu,ipet,ipet-implementation}` (S-03). |
| `server/routes/meetings.js` | Recording consent only from a guardian or an adult pupil (S-04). |
| `server/routes/homework.js` | Submission detail restricted to reviewer / pupil / guardian (S-10, partial). |
| `public/sw.js`, `public/app/core.js` | API cache purge on logout (S-09). |
| `tests/45-security.test.js` | 18 regression tests, one per fix and per IDOR closed. |

## Remaining work — exact patches

**S-08 · audit the reads that decrypt confidential notes** (`server/routes/support.js`)

```js
// in GET /api/support/notes, after the list is built
const opened = list.filter((n) => n.sealed === false);
if (opened.length) ctx.audit({ action: 'note_read', entity: 'confidentialNotes', entityId: sid || 'list',
  after: { noteIds: opened.map((n) => n.id), studentId: sid || null }, reason: 'Odczyt notatek poufnych z listy' });

// in GET /api/support/overview, after `notes` is built
const openedOv = notes.filter((n) => n.sealed === false);
if (openedOv.length) ctx.audit({ action: 'note_read', entity: 'confidentialNotes', entityId: sid,
  after: { noteIds: openedOv.map((n) => n.id) }, reason: 'Odczyt notatek poufnych w karcie ucznia' });
```

**S-11 · stop handing back an enrolled account's TOTP secret** (`server/auth.js:51`)

```js
r.post('/api/auth/totp/setup', (ctx) => {
  const u = ctx.user;
  if (u.totpEnabled) throw httpError(409, 'Drugi składnik jest już włączony. Aby powiązać nową aplikację, najpierw wyłącz 2FA, potwierdzając hasłem.', { code: 'totp_already_enabled' });
  if (!C.verifyPassword(String((ctx.body || {}).password || ''), u.passwordHash)) throw httpError(401, 'Potwierdź hasłem, zanim powiążesz aplikację uwierzytelniającą.', { code: 'reauth_required' });
  u.totpSecret = C.totpSecret(); ctx.db.save();
  ctx.audit({ action: 'totp_secret_issued', entity: 'user', entityId: u.id });
  return { secret: u.totpSecret, otpauth: `otpauth://totp/EdMat:${u.login}?secret=${u.totpSecret}&issuer=EdMat` };
});
```

**S-10 · narrow the remaining pupil-data reads** (`grades.js`, `remarks.js`, `attendance.js`)

Introduce one helper next to `D.assertCanSeeStudent` and call it on `/api/grades/student/:studentId`,
`/api/grades/record/:studentId`, `/api/remarks`, `/api/attendance/class/:classId/monthly`:

```js
// server/lib/domain.js
const PUPIL_DATA_ROLES = ['teacher', 'principal', 'supportTeacher', 'counselor', 'psychologist',
  'specialEducator', 'speechTherapist', 'registrar'];
function assertMayReadPupilRecord(db, user, studentId) {
  assertCanSeeStudent(db, user, studentId);
  if (visibleStudentIds(db, user)) return;                       // pupil / parent: already scoped
  if (!PUPIL_DATA_ROLES.includes(user.role)) throw require('./router').httpError(403,
    'Oceny, uwagi i frekwencja ucznia nie są dostępne dla tej roli.', { code: 'forbidden' });
  const s = db.get('students', studentId);
  if (user.role === 'teacher' && s && !isHomeroomOf(db, user, s.classId)
      && !db.col('timetable').some((t) => t.classId === s.classId && t.teacherId === user.id))
    throw require('./router').httpError(403, 'Widzisz dane uczniów, których uczysz.', { code: 'forbidden' });
}
```

This is the one change that needs a product decision before it lands: it will also stop the
`careEducator`, `cafeteria`, `librarian`, `nurse` and `dpo` roles from reading grade records,
which is correct under need-to-know but should be confirmed against the school's own policy.

**S-13 · validate uploads server-side** (`homework.js`, `student.js`, `messages.js`)

```js
const ALLOWED = /^(image\/(png|jpeg|gif|webp)|application\/pdf|text\/plain|application\/(msword|vnd\.openxmlformats-officedocument\.[a-z.]+)|application\/zip)$/;
function cleanDataUrl(name, declared, dataUrl, limitBytes) {
  const m = /^data:([a-z0-9.+-]+\/[a-z0-9.+-]+);base64,([A-Za-z0-9+/=]*)$/i.exec(String(dataUrl || ''));
  if (!m) throw httpError(400, `Plik „${name}” nie jest poprawnym załącznikiem (oczekiwano data:<typ>;base64,…).`, { code: 'bad_data_url' });
  const type = m[1].toLowerCase();
  if (type !== String(declared || '').toLowerCase()) throw httpError(400, `Typ pliku „${name}” nie zgadza się z jego treścią.`, { code: 'type_mismatch' });
  if (!ALLOWED.test(type)) throw httpError(415, `Typ pliku „${name}” (${type}) nie jest dopuszczony.`, { code: 'file_type_not_allowed' });
  const bytes = Math.floor(m[2].length * 3 / 4);
  if (bytes > limitBytes) throw httpError(413, `Plik „${name}” przekracza limit.`, { code: 'attachment_too_large' });
  return { type, bytes };
}
```

Also drop `text/` from the `viewable` regex at `homework.js:57` (narrow it to `text/plain`), and
cap the **sum** of attachment sizes per submission, not just each file.

**S-15 · make the freeze deep** (`server/lib/audit.js`)

```js
const deepFreeze = (o) => { if (o && typeof o === 'object' && !Object.isFrozen(o)) { Object.freeze(o); for (const k of Object.keys(o)) deepFreeze(o[k]); } return o; };
db.col('audit').push(deepFreeze(e));
```

**S-17 · missing trip authorisation** (`server/routes/modules.js:468`)

```js
const t = db.get('trips', ctx.params.id); if (!t) throw httpError(404, 'Nie ma takiej wycieczki.');
assertTripEditable(ctx, t);                       // ← add this line, as every other trip write does
```

**S-18 · validate before generating keys** (`server/routes/support.js:318`) — check
`SPECIALISTS.includes(u.role) || u.role === 'principal'` against `db.get('users', uid)` first, and
only then call `ensureKeys`.

**S-19 · CSP tightening** (`server/index.js:40`) — add `object-src 'none'`, and move the handful of
inline `style=` attributes in the print templates into the existing `<style>` block so
`style-src 'unsafe-inline'` can be dropped.

---

## Deployment notes

- The brute-force window lives in one process's memory, which matches the "single node"
  contract. Behind more than one node, or behind a proxy that does not set
  `X-Forwarded-For` faithfully, it must move to the shared store — `auth.ipOf` trusts that
  header, so the reverse proxy has to overwrite it rather than append to it.
- `EDMAT_SECURE_COOKIES=1` must be set in production; without it the session cookie has no
  `Secure` flag.
- `config.ipAllowlist` is empty in the seed, so administrative logins are unrestricted until
  a school fills it in.
