# Second pass — regressions and logic slips in the fix round

What a hostile re-read of the code the seven fix packages landed on 23.09.2026 turned up: the storage
engine (`server/lib/store.js`), the time helpers (`server/lib/util.js`, `server/lib/domain.js`), the
record-access gate, the shared upload validator, the audit log and the backup/benchmark scripts.

Scope: `store.js`, `util.js`, `domain.js`, `migrate.js`, `uploads.js`, `audit.js`, `scripts/backup.js`,
`scripts/bench.js`, tests `46-reliability`, `47-records`, new `tests/50-regressions.test.js`.
Everything outside that list is reported here with the exact patch instead of being edited.

Round finished 23.09.2026. `node --test tests/` — **342 tests, 342 pass, 0 fail, 0 skipped, 0 todo**
on an unloaded machine (see §6 for a pre-existing flake under load). `npm run smoke` — 32/32 clean.
`npm run checklist` — 145/145.

## 1. Findings

| id | severity | where | what | status |
| --- | --- | --- | --- | --- |
| REG-01 | **high** | `store.js` `readLayout` | one unreadable collection file took the whole school down at boot | fixed |
| REG-02 | **high** | `store.js` `_flushHot` | an id removed and inserted again in one flush window lost the new row | fixed |
| REG-03 | **high** | `util.js` `toInstant` | in the DST spring gap the instant was an hour later than its own text said | fixed |
| REG-04 | medium | `store.js` `readLayout` | a backup taken while the server compacted could lose everything the append log held | fixed |
| REG-05 | medium | `store.js` change tracking | two rows sharing an id: the first one's edit was dropped | fixed |
| REG-06 | medium | `util.js` `addDays`/`weekday`/`daysBetween` | `RangeError: Invalid time value` on a full ISO instant | fixed |
| REG-07 | medium | `util.js` `toInstant` | 30 February and month 13 were silently rolled over to another day | fixed |
| REG-08 | medium | `domain.js` `assertCanSeeStudent` | the documented `deny` reason was missing from two refusals | fixed |
| REG-09 | medium | `audit.js` `audit()` | a live document with a back-reference turned the request into a 500 | fixed |
| REG-10 | medium | `audit.js` `query()` | `edit_or_delete` missed six real edit/delete actions; an instant as `to` produced a nonsense bound | fixed |
| REG-11 | low | `domain.js` `isBeforeCutoff` | a one-digit hour in the configuration switched the cut-off off for the whole day | fixed |
| REG-12 | medium | `domain.js` `isHomeroomOf` | the acting homeroom teacher's term (`actingFrom`/`actingTo`) was not checked | fixed — the term is now effective only within `[from, to]` (§2) |
| REG-13 | low | `domain.js` `teachesPupil` | one lesson ever taught opens the pupil's record for good | accepted by design, now pinned by a test |
| REG-14 | low | `store.js` legacy engine | `EDMAT_STORE=legacy` rewrote the whole document on every flush, changed or not | fixed |
| REG-15 | low | `store.js` nested Proxy | `Object.defineProperty` on a nested array/object was not tracked | fixed |
| REG-16 | info | `audit.js` `query()` | `from`/`to` are wall-clock UTC days, not school days | open by decision — §4 |
| REG-17 | info | `registry.js` / `domain.js` `guardianScope` | the per-child scope list `students[].guardians[]` is never written in production | fixed |
| REG-18 | info | `uploads.js` | quoted data-URL parameters, Unicode normalisation, the message on a sub-byte limit | open, harmless — §4 |
| REG-19 | low | `migrate.js` `importLegacyFile` | a corrupt pre-2 `school.json` ended the start with `Unexpected token …` and no file name | fixed |

## 2. What each one was

### REG-01 · one torn file, no school (high, fixed)

`readLayout` did `JSON.parse(fs.readFileSync(...))` with no guard. A collection file truncated by a
full disk or a power cut — exactly what `docs/STORAGE.md` promises recovery from — made `Store.load()`
throw `SyntaxError: Unexpected end of JSON input`, and the process died before the first request.
Recovery was documented for a torn *log line* only; a torn *snapshot* had none.

Now the file is moved out of the data directory (to `<data>/school-uszkodzone/<name>.json-<stamp>`, so
that neither a flush nor `_sweepOrphans` can destroy the evidence), the collection comes back empty so
its append log can still rebuild what it holds, a Polish warning names the file and points at
`scripts/backup.js restore`, and `store.damaged` carries the list for anyone who wants to surface it.
A non-array value (`config`, `meta` — the manifest says which is which) comes back as `null` rather
than as an empty array: half a school's configuration is worse than none, and it fails loudly.

Evidence: `tests/46-reliability.test.js` → *"a torn collection file is quarantined instead of taking
the school down"*.

### REG-02 · a row deleted and written again in the same 50 ms (high, fixed)

The append log is written as *inserts, then updates, then deletes* — not as a journal. So

```js
db.remove('messages', 'm1');            // logged as  {"op":"d","id":"m1"}
db.col('messages').push({ id: 'm1', v: 'nowe' });   // logged as {"op":"i","doc":{…}} — before it
```

replayed as insert-then-delete and the new row was gone after the next restart. Both halves are
ordinary things for a route to do inside one debounce window (re-issue a registration code, replace a
substitution, re-file an attendance entry under the id the client sent back).

`_flushHot` now notices that an appended id is also in `removed` and writes a full snapshot instead,
which is unambiguous. Evidence: *"an id removed and inserted again inside one flush window keeps the
new row"*.

### REG-03 · the hour that does not exist (high, fixed)

`toInstant('2027-03-28', '02:30')` returned `'2027-03-28T03:30:00+02:00'`… after the fix. Before it, it
returned **`'2027-03-28T03:30:00+01:00'`** — a string no clock in Warsaw ever shows, and one that parses
back to 04:30 local. The offset search settled on the winter offset and then printed the summer wall
clock next to it. Every deadline, quiet-hour boundary and cut-off stamped on the night of 28.03.2027
was an hour late; `schoolNow` inherited it through `config.today`.

The instant the search found was right all along — only the offset printed beside it was from the
wrong step. It is now read back off the settled instant. The documented behaviour is unchanged: the
repeated hour (25.10.2026 02:30) still resolves to the later, winter occurrence, and the missing hour
still moves forward.

Evidence: *"toInstant writes an instant whose offset matches its own wall clock, on both DST nights"*.

### REG-04 · the 02:30 backup and the compaction (medium, fixed)

`readLayout` read every `<collection>.json` first and every `<collection>.jsonl` second. A compaction
in the server process does the opposite: it writes the new snapshot and *then* deletes the log. A
reader that landed between the two got the **old** snapshot and **no log at all** — every op the log
held simply vanished from the copy. `scripts/backup.js` is documented as safe to run against a live
server, so the nightly cron sat exactly in that window.

Logs are now read before snapshots. The worst case becomes an old log replayed over a newer snapshot,
which is an idempotent upsert, and the order inside the log is preserved, so an insert that was later
deleted still cancels out. Evidence: *"a reader that arrives in the middle of a compaction loses
nothing"* and *"backup: a copy taken while the server is writing restores every row"*.

### REG-05 · two rows, one id (medium, fixed)

`st.dirty` was a `Map` keyed by `doc.id`. Two rows carrying the same id — a bad import, a merge, a
restore over a half-written directory — collapsed into one entry, and whichever was marked first lost
its edit for good. It is now a `Set` of documents, so both survive; and if a flush really would have
to log two different objects under one id, it writes a full snapshot instead. Memory is unchanged: the
set is bounded by the number of distinct documents touched since the last flush, not by the number of
writes (100 000 writes to one row are one entry — pinned by a test).

### REG-06 · `addDays` on an instant (medium, fixed)

`addDays('2026-09-23T10:00:00Z', 1)` threw `RangeError: Invalid time value` from inside
`Date.prototype.toISOString`, with no hint which value or which caller. `weekday` and `daysBetween`
returned `NaN` and carried it into a response. Routes mix `'RRRR-MM-DD'` and full instants freely
(`t.announcedAt`, `n.at`, `enrolledAt`), so this is one careless argument away in a dozen places. The
three helpers now take the calendar day out of whatever they are given, and a value that is not a date
at all throws a named error (`code: 'EDMAT_BAD_DATE'`) that says what was expected.

### REG-07 · 30 February (medium, fixed)

`toInstant('2026-02-30', '12:00')` matched the `RRRR-MM-DD` pattern and `Date.UTC` rolled it over to
2 March; `'2026-13-01'` became 1 January 2027; `'25:00'` became the next day. A date from a form became
a valid instant on a different day. The components are now checked against the date they produce and
an impossible one returns `null`, which every caller already handles.

### REG-08 · a refusal without a reason (medium, fixed)

`docs/review/README.md` §2 says a refusal is always `403 { code: 'forbidden', deny, scope }`. Two of
them were not: `assertCanSeeStudent` threw a bare `{ code: 'forbidden' }`, so the two cases a client
most needs to tell apart — "not your child" and "the adult pupil objected to guardian access" —
arrived indistinguishable. Both now carry `deny: 'guardian_scope'`, `scope: 'none'`, and the objection
case also carries `parentAccessBlocked: true` and says so in the message. A user who is not a guardian
at all gets `deny: 'record_scope'`.

### REG-09 · the audit log throwing the request away (medium, fixed)

`snapshot()` was `structuredClone` with a `JSON.parse(JSON.stringify(…))` fallback. Both refuse what
routes actually pass:

* **`structuredClone` throws `DataCloneError` on every document the store hands out** — they are all
  change-tracking Proxies. So the fast path never once ran on a live row; every `audit({ after: cat })`
  quietly fell through to JSON.
* the JSON fallback throws `TypeError: Converting circular structure to JSON` on a graph with a
  back-reference.

Put the two together — a live document inside a structure that points back at itself — and `audit()`
threw, taking down the request it was the only record of. `audit.js` now copies the entry itself:
Proxies are unwrapped, a cycle is written down as `'[cykl]'`, and `Date` / `Map` / `Set` / `BigInt` /
`Error` / `Buffer` are reduced to shapes the store can write and read back. The S-15 guarantees are
unchanged — the copy is cut off from the live row and deep-frozen.

Evidence: *"a live document with a back-reference is written, not thrown back at the route"*.

### REG-10 · `edit_or_delete` and the glued-together bound (medium, fixed)

Two things in `query()`:

* `/update|delete|revert/` missed `grade_value_edit`, `student_removed`, `right_to_be_forgotten`,
  `grade_superseded`, `classification_grade_invalidated` and `import_undone` — a grade edit and a
  pupil's removal are precisely what the principal's "edits and deletions" filter is for. It now uses
  the same vocabulary `routes/principal.js` (`kindOf`) classifies with, so the library and the screen
  answer the same question. (The screen re-classifies on top of the library, so the visible filter was
  already right; a direct library caller was not.)
* `e.at <= q.to + 'T23:59:59.999Z'` produced `'2026-01-01T10:00:00ZT23:59:59.999Z'` when `to` was a
  full instant — a bound that matches nothing. The day-end is now appended only to a `RRRR-MM-DD`.

### REG-11 · `'9:00'` (low, fixed)

`isBeforeCutoff` required `\d{2}:\d{2}` and returned `true` — permissive — for anything else. A school
that typed `'9:00'` into the lunch cut-off had no cut-off at all, silently, all day. A one-digit hour
is now read; something genuinely impossible (`'24:00'`) still means "no cut-off".

### REG-12 · the acting homeroom teacher's term is not checked (medium, **fixed**)

`POST /api/principal/classes/:id/acting-homeroom` *requires* `from` and `to`, and nothing ever expired
the assignment. `isHomeroomOf` ignored both dates, so a teacher who stood in for two weeks in September
kept reading every pupil's record in that class — grades, remarks, homework, descriptive assessments
— until the principal remembered to revoke it by hand.

**The product decision has been taken: an acting-homeroom assignment is effective only within
`[from, to]`, both dates inclusive, counted in school days (`D.today(db)`).** An assignment signed in
advance gives no rights before its first day, and an expired one stops giving them by itself. A
permanently appointed homeroom teacher has no term and is the homeroom teacher always.

`isHomeroomOf` in `server/lib/domain.js` now honours `actingFrom`/`actingTo` (the four-line patch that
was in §3), and `[3.3.11]` in `tests/33-principal.test.js` asserts the new answer: the term assigned
covers the demo day, a future-dated assignment is **not** yet effective, the last day of the term still
is, and the day after it is not. The two lines in `tests/47-records.test.js` that pinned the old
behaviour are gone.

### REG-13 · one lesson, forever (low, accepted)

`teachesPupil` matches any `lessons` row ever taught to the pupil's class, with no semester or date
bound. A teacher who taught the class only in the first semester — or who covered one lesson as a
substitute two years ago — still reads the pupil's record. That is deliberate for the first case (they
must be able to defend a classification grade they themselves gave) and over-broad for the second. It
is not changed here because a time bound would take grades out of the hands of the teacher who awarded
them mid-classification; it is now written down and pinned by a test instead of being accidental.

### REG-19 · the migration's own unreadable file (low, fixed)

The same class of defect as REG-01, one layer up: `importLegacyFile` parsed `data/school.json` with no
guard, so a corrupt pre-2 document ended the start with `SyntaxError: Unexpected token } in JSON at
position 4711` — no file name, no next step, at the one moment when someone still has the chance to
reach for a backup. It now throws `EDMAT_BAD_DATA_FILE` naming the file and the restore command, and
refuses a document that parses but is not a school (an array, a string).

### REG-14 / REG-15 (low, fixed)

`EDMAT_STORE=legacy` rewrote the whole document on every `flush()`, even with nothing changed — a
debounce timer firing was enough, and in `scripts/bench.js` it flattered the comparison in the wrong
direction. It now compares against what it last wrote. And the nested-object Proxy had `get`, `set`
and `deleteProperty` but no `defineProperty`, so `Object.defineProperty(doc.readBy, …)` slipped past
the tracker; the trap is there now.

## 3. Patches for files this package does not own

**REG-12 — the acting homeroom teacher's term (APPLIED).** `server/lib/domain.js` and
`tests/33-principal.test.js` landed together; the diff is kept for the record:

```diff
--- a/server/lib/domain.js
+++ b/server/lib/domain.js
-const isHomeroomOf = (db, user, classId) => { const c = db.get('classes', classId); return !!c && (c.homeroomTeacherId === user.id || c.actingHomeroomTeacherId === user.id); };
+const isHomeroomOf = (db, user, classId) => {
+  const c = db.get('classes', classId);
+  if (!c || !user) return false;
+  if (c.homeroomTeacherId === user.id) return true;
+  if (c.actingHomeroomTeacherId !== user.id) return false;
+  const d = today(db);
+  return (!c.actingFrom || d >= c.actingFrom) && (!c.actingTo || d <= c.actingTo);
+};
```

```diff
--- a/tests/33-principal.test.js          # [3.3.11], line 306
-  assert.equal(D.isHomeroomOf(S.db, S.db.get('users', 'u_gorski'), '7b'), true);
+  /* powierzenie zaczyna się 26.10, a dzień szkoły to 23.10 — p.o. wchodzi w prawa w swoim terminie */
+  assert.equal(D.isHomeroomOf(S.db, S.db.get('users', 'u_gorski'), '7b'), false, 'przed terminem jeszcze nie');
+  await withConfig(S.db, { today: '2026-11-10' }, () => {
+    assert.equal(D.isHomeroomOf(S.db, S.db.get('users', 'u_gorski'), '7b'), true, 'w terminie tak');
+  });
+  await withConfig(S.db, { today: '2026-12-19' }, () => {
+    assert.equal(D.isHomeroomOf(S.db, S.db.get('users', 'u_gorski'), '7b'), false, 'po terminie już nie');
+  });
```

The test file took `withConfig` into its `require('./helpers')` import, and the two `REG-12` pin
lines in `tests/47-records.test.js` are deleted. The landed test goes one step further than the diff
above: it assigns a term that **includes** the demo day (so the ordinary path asserts `true`), and then
checks a future-dated assignment, the last day of a term and the day after it.

**REG-17 — the per-child access scope is unreachable (fixed).** `domain.guardianScope` reads
`students[].guardians[]` as a list of `{ userId, accessScope }` and treats `users[].accessScope` as the
fallback. Nothing used to write that list: the seed and `POST /api/registry/students` both stored
`guardians` as an **object** (`{ mother, father, phone, email, address }` — the secretary's contact
card), and `POST /api/registry/students/:id/guardians` wrote the scope onto the **account**. The
per-child branch therefore only ever ran in tests, and a school that gives one parent `full` for one
child and `info` for another could not express it.

Resolved the other way round from the patch sketched here: rather than adding a third field
(`guardianScopes`), the contact card moved out of the way, so the list lives exactly where
`guardianScope` already looks.

- The card is now `students[].guardianContact`; `server/routes/registry.js` normalises any stored
  object once at start-up (`normaliseGuardians`, called from `register()`), so an existing school
  migrates on its first boot. `POST /api/registry/students` writes the card to `guardianContact` and
  `guardians: []` from the outset.
- `students[].guardians[]` holds `{ userId, accessScope, since, legalBasis, note }`. It is written by
  `POST /api/registry/students/:id/guardians` (attach) and by the new
  `PATCH /api/registry/students/:id/guardians/:userId` (`{ accessScope, legalBasis, note }`), which is
  the route a court order restricting a parent who already holds an account goes through.
  Detaching a guardian, and closing the register entry, drop the entry again.
- `users[].accessScope` stays exactly what it always was for accounts that have no per-child entry:
  the account-wide default. Nothing writes it any more.
- Evidence: `tests/35-registry.test.js` — *"[3.5.1] GAP-3/REG-17: zakres dostępu opiekuna zapisuje się
  przy dziecku, nie na koncie"* (the shape, the audit row with before/after, the validations) and
  `tests/47-records.test.js` — *"[S-10] REG-17: zakres per dziecko zapisany przez sekretariat działa na
  żywo dla obojga dzieci"* (the same guardian account reads Anna's grades and gets
  `403 guardian_scope` on her brother's, through the public API).

**REG-01 — surface a quarantined collection.** `server/index.js` (not owned) can make a damaged file
visible instead of leaving it in the boot log:

```diff
--- a/server/index.js                    # line 102
-  app.router.get('/api/health', () => ({ status: 'ok', schemaVersion: app.migration.to, uptimeSec: Math.round(process.uptime()), at: util.now() }), { public: true });
+  app.router.get('/api/health', () => {
+    const damaged = (db.damaged || []).length;                     // REG-01: a quarantined collection
+    return { status: damaged ? 'degraded' : 'ok', damaged, schemaVersion: app.migration.to, uptimeSec: Math.round(process.uptime()), at: util.now() };
+  }, { public: true });
```

A **count**, not the names: `tests/46-reliability.test.js` asserts `/api/health` carries no `"students"`,
`"users"` or `"config"` anywhere in its body, and a list of collection names would trip that check.
Without this, a school that came up with an empty collection only says so in the boot log.

**REG-08 — a now-redundant catch (APPLIED).** `server/routes/student.js` re-wrapped the refusal from
`assertCanSeeStudent` to add the objection message. The helper says it itself now, and the re-wrap
dropped the new `deny`/`scope` fields on that one route, so it is gone:

```diff
--- a/server/routes/student.js
-    try { D.assertCanSeeStudent(db, ctx.user, sid); }
-    catch (e) { throw httpError(403, s.parentAccessBlocked ? 'Uczeń pełnoletni wniósł sprzeciw wobec dostępu opiekunów do jego danych.' : e.message, { code: 'forbidden', parentAccessBlocked: !!s.parentAccessBlocked }); }
+    D.assertCanSeeStudent(db, ctx.user, sid);   // niesie już powód i `parentAccessBlocked`
```

**REG-10 — `routes/principal.js` leans on the library (APPLIED).** `GET /api/principal/audit` used to
pass `action: null` for `edit_or_delete` and re-filter with its own `kindOf`, so the library branch was
dead for the only caller. The action now goes straight through to `auditQuery`, and `kindOf` is kept
for the `kind` column only. To make the two vocabularies really agree, `kindOf` learned the words the
library's `EDIT_OR_DELETE` already knew: `forgotten` and `undone` read as a deletion, `superseded` as
an edit — otherwise `right_to_be_forgotten`, `import_undone` and `grade_superseded` would have come
back from the library labelled `create`.

## 4. Open by decision

**REG-16 — the audit date filter runs on UTC days.** `query({ from, to })` compares `e.at` (a UTC
instant) against `'RRRR-MM-DD'` bounds as strings. In Warsaw that means a search for "today" misses
everything between 00:00 and 02:00 local and includes the same two hours of the next day. Changing it
to school days is four lines, but `[3.3.16]` deliberately asserts the wall-clock reading
(*"wpisy audytu mają znacznik zegara, nie «dziś» ze szkoły"*) and the test file is not owned here.
Raise it with whoever owns `tests/33-principal.test.js`; the sibling defect (an instant as `to`) is
fixed.

**REG-18 — three harmless edges in `uploads.js`.** A data URL whose parameter is quoted
(`data:text/plain;charset="utf-8";base64,…`) is refused with `bad_data_url`; no browser's
`FileReader.readAsDataURL` produces one. File names are not `NFC`-normalised, so a name typed on macOS
keeps its decomposed `ó` — it survives, round-trips and displays, it is just two code points. And the
`attachment_too_large` message prints `0.0 MB … limit 9.5e-7 MB` for a limit below a megabyte, which no
school configures. Everything that matters is right and is now pinned: padded and unpadded base64 of
every length, whitespace inside the payload, the client's `size` ignored, an inclusive limit, the
consignment total, an upper-case MIME, a JPEG renamed to PNG, `image/*` never reaching
`image/svg+xml`, path traversal, control characters, and Polish letters surviving untouched.

**REG-13** — see §2.

## 5. What was attacked and found sound

Worth recording, because these are the places a change is most likely to break next time. All are
pinned by tests in `46-reliability`, `47-records` and `50-regressions`.

*Storage engine.* `JSON.stringify(db.data)` and of a single collection; `Array.isArray`, `instanceof`,
`Object.keys` order on both `db.data` and a document; `delete` on a wrapped document reaching the raw
row; `students[].parentIds.push`, `classes[].studentIds.splice`, `messages[].readBy[uid] = …` and
`meeting.consents[sid] = {…}` all tracked, appended and read back — including on the hot collections
that go through the log; an in-place `sort` of a hot collection; `db.col('x').length = 0`;
`db.data.x = [...]` (and the stale `.jsonl` it leaves behind); a collection promoted to the append log
mid-run; a torn last log line; a stale log replayed over a compacted snapshot (order inside the log
makes insert-then-delete cancel); `flush()` with nothing changed writes nothing at all, not even the
manifest; the tracking set stays at one entry across 100 000 writes to one row; `EDMAT_STORE=legacy`
round-trips, Polish letters and all; SIGTERM during a compaction leaves a complete store, because a
signal is delivered between two synchronous flushes and never inside one.

**`structuredClone` throws `DataCloneError` on anything the store hands out.** That is now an
explicit, asserted fact rather than something to rediscover — it is what REG-09 was.

*Time.* `localDate`/`localTime` on instants with `+01:00`, `-05:00` and `+03:00` offsets, including the
ones that fall into the previous year; `schoolNow` pinned and unpinned, with the instant always
agreeing with the date and time beside it; the cut-off minute belonging to the cut-off, not to the
window before it; quiet hours for a window that crosses midnight, one that does not, one that starts at
midnight, one that ends at it, and `from === to` meaning off; `semesterOf(…, 'entry')` on the first and
last day of each semester and on both ends of the inter-semester gap, with the configuration entered
out of order and with a single semester; `weekday` from 1899 to 2200.

*Record access.* The acting homeroom teacher; a substitute on one single lesson; a group teacher
(`teacherId` and `teacherIds`); a teacher who taught the class only last semester; the per-child scope
overriding the account in **both** directions, keyed by `userId` or by `id`, with the guardian absent
from the list, with the old object shape in the field, and with a value nobody recognises; the pupil
themself, the principal and each of the five support roles; the five roles that keep the directory and
the day's attendance but not the record; a pupil removed from the register staying in their homeroom
teacher's file while a stranger still gets 403.

*Backup and benchmark.* A copy taken while the server holds the lock and is still writing restores
every row, including the ones that were only in the append log; a restore refuses while the lock is
held and succeeds into a different data directory; `npm run bench` finishes on a small fixture in a few
seconds with no failed request.

## 6. One thing this pass did not cause: the suite is flaky on a loaded machine

`[3.3.8] OPS-13`, `[setup.4]` and `[setup.6]` fail intermittently with `fetch failed` when
`node --test tests/` runs on a box whose load average is well above its core count — three of six
sampled runs on a 6-core host at load ~14. Measured with this package's own tests removed as well
(`tests/50-regressions.test.js` moved aside, the three child-process tests in `46` skipped): two of
three control runs still failed on `[3.3.8]`. So it predates this pass — but the tests added here do
spawn processes, which makes it likelier, so they were kept as small as they can be while still
proving the thing they prove (the benchmark runs one engine on 400 rows; the SIGTERM child holds
4 000).

All three failures are the same shape: the first `fetch` after `app.listen(0)` never connects, inside
a test that builds a whole seeded or blank school first (`createApp({ blank: true })` alone is ~1.1 s
of solid CPU, and `44-setup` builds six of them). Worth handing to whoever owns `tests/helpers.js`:
a retry on connect, or `AbortSignal.timeout` with a clear message, would turn a mystery into a
diagnosis. On an idle machine every run is green.

## 7. How to re-run

```bash
cd prototype
npm test                                       # 342/342 (on an idle machine — §6)
node --test tests/50-regressions.test.js       # time, uploads, audit
node --test tests/46-reliability.test.js       # storage engine, backup, bench
node --test tests/47-records.test.js           # the record gate
npm run smoke                                  # 32/32
npm run checklist                              # 145/145
node scripts/bench.js --engine store --attendance 2000 --clients 3 --rounds 3
```
