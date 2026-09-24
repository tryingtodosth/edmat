# Round 3 — operations: onboarding a real 600-pupil school, end to end

Lens: I am the administrator and the registrar of SP nr 12 in Kraków — 24 classes, ~600 pupils — and
I am switching to EdMat in September. I have exactly what a Polish school has: an aSc XML or an
Optivum publication from whoever lays out the timetable, a staff list from the arkusz organizacyjny,
and a candidate export from the gmina's nabór. Nothing else.

Method: a blank instance (`EDMAT_SEED=blank`, i.e. `createApp({ blank: true })`), driven through the
HTTP API by the scripts in [`repro/operations/`](repro/operations/). Every number and every quoted
error in this report came out of a run; nothing is inferred from reading the source. School day =
the real day, **2026-09-23** (a blank install has `config.today: null`, so "today" is the wall clock —
which is exactly the mid-September switch the brief describes). The fixtures were not modified; the
24-class file is generated in memory inside `10-february-and-scale.js`.

Severity: **blocker** — the school cannot start in September, or the statutory document it produces
would be false; **major** — a workaround exists but it is manual, lossy or invisible; **minor** —
friction, wrong default, or a message that does not say what to do.

Not repeated here: everything closed in `docs/review/README.md` (OPS-01…OPS-24 and the rest). Two
findings below are the same defect the parallel domain review reached from the document side —
they are marked *(= D3-43)* / *(= D3-51)* and are kept only because this report shows what they do to
a live onboarding.

```bash
cd prototype
node docs/review/round3/repro/operations/01-september.js          # blank -> school -> staff file verbatim
node docs/review/round3/repro/operations/02-staff-and-pupils.js   # both pupil importers on the nabór file
node docs/review/round3/repro/operations/03-full-path.js          # the whole happy path incl. aSc two-phase
node docs/review/round3/repro/operations/04-rooms-mapping.js      # what echoing report.mapping costs
node docs/review/round3/repro/operations/05-first-day.js          # teacher's first attendance, parent, SIO
node docs/review/round3/repro/operations/06-blank-vs-demo.js      # what a blank config is missing
node docs/review/round3/repro/operations/07-statutory.js          # SIO, completeness, archive, retention
node docs/review/round3/repro/operations/08-hard-cases.js         # hour 0, A/B weeks, language groups
node docs/review/round3/repro/operations/09-year-structure.js     # the school-year screen
node docs/review/round3/repro/operations/10-february-and-scale.js # February arrival; 24 classes / 600 pupils
node docs/review/round3/repro/operations/11-optivum-twins-sex.js  # Optivum folder; siblings; `sex`
node docs/review/round3/repro/operations/12-siblings-and-deadends.js
node docs/review/round3/repro/operations/13-switch-date.js        # 1 September vs the day we switched
```

---

## 1. The walkthrough

### The happy path

**1. `GET /api/setup/status`** → `200 {"needed":true,"year":"2026/2027","semesters":[…]}`. Good: the
blank install already knows the year, both semesters, the winter break, the two holiday breaks and six
statutory days off, computed from Easter (`server/lib/blank-seed.js:15–41`). This is the single best thing
in the whole path — OPS-07 is properly closed.

**2. `GET /api/registry/students`** (a secretary who goes straight to her own screen) → `503
{"code":"setup_required"}` with a sentence telling her to run the wizard. Correct.

**3. `POST /api/setup/school`** with name, address, RSPO, REGON, director, `year: "2026/2027"` →
`200`, admin account created, session cookie set, `summary` returned. 
The principal account is an **optional** third card on step 1 (`public/app/screens/setup.js:5`, `sw.principal`). Skip it and the school has no `principal` role at all; every `/api/principal/*` route —
the completeness audit, the semester close, the year-end archive — answers `403` to the administrator.
It is recoverable (`POST /api/admin/staff {role:'principal'}` works), but nothing says so.

**4. `POST /api/setup/teachers/import` with `register/staff.csv` verbatim** — the file the school
actually has, decoded from windows-1250 first because the endpoint takes a string, not bytes:

```
-> 200 {"count":0,"errors":[{"line":2,"error":"Brak imienia lub nazwiska."}, …20 identical rows]}
```

All 20 teachers rejected. The file is fine; the wizard simply looks for columns called `firstName`
and `lastName` (`server/routes/setup.js:185`) and the file says `Imię` / `Nazwisko`. The message names
neither the expected header nor the headers it found. Compare `POST /api/registry/students/import`,
which returns `columns` and `unknownColumns` for exactly this reason.

**5. I convert `staff.csv` by hand** (what a secretary does in Excel): rename 9 columns → 7, translate
`Przedmioty` from names to EdMat subject ids (`Matematyka`→`mat`), change the separator inside that
column from `,` to `|`, strip the space out of `Wychowawstwo` (`7 B` → `7b`), derive a login from the
e-mail. Three of the 19 subject names in the file have **no EdMat id at all**: `Etyka`,
`Wychowanie do życia w rodzinie`, `Nauczyciel współorganizujący kształcenie`.
→ `POST /api/setup/teachers/import` `200 {"count":20,"errors":[],"warnings":[]}`, 8 classes created as
a side effect of `homeroomOf`.

**6. `POST /api/setup/students/import` with `register/nabor-vulcan.csv` verbatim** →
`200 {"count":0}` and 60 identical errors `"Wymagane: class, lastName, firstName."` Same cause, same
non-explanation.

**7. `POST /api/registry/students/import` with the same file** → this one reads it:

```
200 {"count":60,"ok":60,"withPesel":57,"withDocument":3,"needsReview":3,
     "unknownColumns":["Kod pocztowy","Miejscowość","Opiekun 1 – nazwisko","Opiekun 1 – imię",
                       "Opiekun 1 – telefon","Opiekun 1 – e-mail","Opiekun 2 – …",…,"Uwagi"],
     "missingClasses":[]}
```

cp1250, the en-dash in `Opiekun 1 – nazwisko`, `DD.MM.RRRR` dates, the quoted court annotation with a
semicolon inside, the three pupils with no PESEL — all handled. And then it stops, because the route
is dry-run only, **every guardian column is in `unknownColumns`**, and no screen in `public/app/screens/`
calls it. The 60 mapped rows cannot be posted back anywhere.

**8. I convert the nabór file by hand too.** 20 columns → the wizard's 15. Measured losses per run:
58 second guardians, 60 addresses, 34 middle names, 4 free-text notes (one of them the court
annotation about a father deprived of parental authority — the exact case `guardianStatus: deprived`
exists for). Dates reformatted; the free-text `Dokument tożsamości` split by hand into
`documentType;documentNumber;documentCountry`.

**9. `POST /api/setup/students/import` dryRun** → `200 {"count":60,"codes":60,"errors":[]}` **plus 58
warnings** `"Numer 1 w oddziale 1a jest już zajęty — nadaj numery ponownie w widoku wychowawcy."`
**10. The same call for real** → `200 {"count":60,"codes":60,"errors":[],"warnings":[]}` — **zero**
warnings. The preview the secretary is told to trust says the roll numbers collide; the real run says
they do not. (Cause: in `dryRun` nothing is written, so the "next free roll number" is recomputed as 1
for every row — `server/routes/setup.js:261`.)

Result: 60 pupils, register numbers 1001–1060 with no holes, 60 pupil accounts without passwords,
60 parent contact accounts, 60 registration codes valid 60 days. The three pupils with no PESEL came
out right (`{"type":"passport","number":"FL123456","country":"UA"}`, `residence-card BY`, `passport VN`).
`enrolledAt` defaulted to `2026-09-01`, not to the day of the import — GAP-6 is properly closed.

**11. `POST /api/admin/timetable/import` with `asc/plan-sp12.xml`, `dryRun: true`** — this is the good
part of the system. 254 rows, 8 classes, 18 teachers, 14 rooms, 5 group labels, `weeks {every:246, A:4, B:4}`,
**0 conflicts, 0 errors**, 20/8/16 exact matches and a `proposal` with a ready `mapping`. The importer
earns its keep.
Three entities block: `subjects: ["Etyka","Wychowanie do życia w rodzinie","Godzina z wychowawcą"]`.
There is **no route in the whole API that creates a subject** — `db.data.subjects` is written only by
the seed (`server/lib/blank-seed.js:58`). So the only legal answer is `null` = skip those rows, and the
homeroom hour disappears from the plan and from the journal for all 8 classes.

**12. `POST /api/admin/timetable/import`, phase 2, echoing back `report.mapping`** — what
`docs/IMPORT.md` § 5 shows and what `public/app/screens/admin.js:702` actually does:

```
200 {"ok":true,"applied":true,"rows":254,"rooms":0,
     "message":"Zaimportowano 254 lekcje: 5 podziałów na grupy, 0 sal, 18 nauczycieli. …"}
stored rows: 254 | rows with a room: 0
```

Every room number is gone. Control run in `04-rooms-mapping.js`: the same file, the same phase 2,
with the `rooms` key simply left out of `mapping` → `254 rows, 254 with a room`. The dry run promised
14 rooms; the apply wrote none, and said so in a number nobody reads. *(= D3-51, reached from the UI.)*

**13. `POST /api/setup/lessons/generate {}`** (what the wizard button sends) → `200
{"created":9395,"from":"2026-09-01","to":"2027-06-25"}` in 139 ms. Holidays respected: 0 lessons on
11 November, 0 on 25 December, 44 on a normal Thursday.
**805 of those 9 395 are dated before the day the school switched, and every one of them has
`status: "held"`** (`server/routes/setup.js:50`) with no topic and no attendance.

**14. `GET /api/principal/completeness`** on day one:

```
window 2026-09-16 → 2026-09-22 | lessonsChecked: 250
totals {"missingTopic":250,"missingAttendance":250,"lessonsWithGaps":250,"classes":8,"teachers":17}
```

The principal's first screen accuses all 17 teachers of 250 missing entries for a week in which the
school was still on its old logbook. `POST /api/setup/lessons/generate {"from":"2026-09-23"}` produces
the right 8 590 lessons and zero phantoms — but neither the wizard nor `GET /api/setup/formats`
mentions that the call takes a date.

**15. `POST /api/setup/finish`** → `200`, `summary {teachers:20, classes:8, students:60, parents:60,
registrationCodes:60, timetable:254, lessons:9395}`.

### The first day

**16. `POST /api/admin/users/u_j_nowak/reset-password`** → `200` with `temporaryPassword`, all sessions
of that account revoked. **17.** teacher logs in (`mustChangePassword: true`), changes the password,
**18. `GET /api/lessons?date=2026-09-23`** → her three lessons, **19. `GET /api/attendance/lesson/…`**
→ an 8-row roster, **20. `POST /api/attendance/lesson/…`** → `200 {"alerts":{"firstPeriod":[{"studentId":…,"notified":1}]}}`,
**21. `PATCH /api/lessons/…{topic}`** → `200`, and the guardian's notification row exists immediately:
`"Nieobecność na 1. lekcji · Paweł Dąbrowski · 08:00"`. This whole leg is clean.

**22. `POST /api/register`** with a code from the wizard's printout → `200
{"claimedImportedAccount":true}` — the imported contact account is claimed, not duplicated (OPS-24
holds). **23. `GET /api/parent/children`** → one child, `accessScope: "full"`, homeroom named.

**24. `POST /api/registry/sio/validate`** → **`500 {"error":"Błąd serwera."}`**
(`TypeError: Cannot read properties of undefined (reading 'schemaVersion')`, `registry.js:621`).
`config.sio` is written by the demo seed and never by the blank seed. `GET /api/registry/sio/package?json=1`
works and returns a correct 60-pupil package, so the only thing broken is the button the registrar is
told to press first. *(= D3-43.)*

**25. `GET /api/principal/archive`** → a correct window (`2027-06-25 … 2027-07-05`, 10 days, `open:false`,
285 days left). **26. `POST /api/principal/archive`** in September → `403 window_closed` with the dates
spelled out. **27.** with `force: true` → a 29 295-byte ZIP, 5 files, SHA-256 manifest. Good.

**28. `PATCH /api/admin/year`, echoing back exactly what `GET /api/admin/year` returned** →
**`400 {"code":"year_invalid","errors":["Dzień wolny 29.03.2027 („Poniedziałek Wielkanocny”) mieści się
w przerwie „Wiosenna przerwa świąteczna” — usuń jeden z wpisów."]}`**
The wizard's own calendar is invalid by the system's own rule, and it is invalid **every year**:
`statutoryDaysOff` always emits Easter Monday (`blank-seed.js:20`) and the spring break is always
`[Easter−3, Easter+2]` (`:38`), which always contains it. The school-year screen therefore cannot save
anything — not a *dzień dyrektorski*, not an exam day, not a corrected semester date — until someone
deletes Easter Monday by hand. The demo seed does not hit this (its spring break is 1–6 April), which
is why no test caught it.

### The harder cases

**29. Hour 0.** `asc/plan-extra.xml` (`period="0"`, 7:10) → dry run reports 2 rows rejected with a good,
specific message: *"…dopisz do planu dzwonków pozycję { no: 0, start, end } w ustawieniach szkoły."*
There is no such setting. `GET /api/admin/year` does not return `lessonTimes`; grepping every
non-GET route for a writer of `config.lessonTimes` gives **nothing** (only `/api/push/config` matches the
word "config"). The message points at a screen that does not exist, and the only way in is to edit
`data/school/config.json`. A school with an hour 0 cannot load its timetable.

**30. A/B weeks.** aSc carried them through cleanly: 4 A-rows, 4 B-rows, and after generation 148
lessons carry a week, alternating correctly from the derived anchor (`2026-09-07:B 2026-09-14:A
2026-09-21:B …`). The Optivum `-T1/-T2` workaround is read too, with the legend quoted back in
`weekMarkers`. But `config.weekCycleAnchor` — the one value a school that starts in week II has to
change (`docs/IMPORT.md` § 4) — has **no route either**: `PATCH /api/admin/year` ignores it (and in any
case answers 400, see 28).

**31. Language groups — the one that breaks the register.**
`POST /api/admin/classes/7b/split` with two English groups → `200`, two groups created, message
*"Wgraj plan lekcji z identyfikatorami g_7b_ang1, g_7b_ang2 w kolumnie „group”."*
The plan is already loaded. The imported rows still read
`{"id":"tt_7b_3_1_g-1-grupa","groupId":null,"groupLabel":"1. grupa"}`. `rosterIds`
(`server/routes/attendance.js:46`) keys on `groupId` only, so the English teacher opening
`les_tt_7b_3_1_g-1-grupa_2026-09-23` sees **8 of 8 pupils — the whole class.** Re-running the import
does not help: the two-phase `mapping` has exactly four kinds (`teachers, classes, subjects, rooms`),
there is no `groups` kind, and there is no route that edits a single timetable row
(`POST /api/admin/timetable/import` is the only writer). The only way to bind them is to abandon the
aSc file and hand-write 254 CSV rows with `group=` filled in.
At 24 classes this is every language, PE and religion/ethics lesson — roughly a fifth of the statutory
attendance record, wrong from day one, with no way for the homeroom teacher to correct it.

**32. A pupil who arrives in February.** `POST /api/registry/students` with `enrolledAt: "2027-02-16"`
→ `200`, pupil account, guardian code, and the roster gate works exactly as OPS-13 promised: she is
**absent** from a 24 September roster and **present** on a 16 February one. Two things around it:
her guardian's code expires `2026-10-23` (30 days from today, four months before she starts —
`registry.js:388`), and her register number is **1201** while the wizard's cohort ended at **1060**:
`setup.js:217` floors the counter at 1000, `registry.js:29` floors it at 1200, so the księga uczniów
gets a 140-number hole at the seam between the two routes. She is also in no group, and nothing warns.

**33. A pupil with no PESEL.** End to end correct. The register keeps
`identityDocument {type, number, country}`, and the SIO package writes
`rodzajDokumentu="passport" numerDokumentu="N1234567" paszport="N1234567" krajWydania="VN"`.
But the same XML line reads `plec=""` — and so does every other pupil's. The wizard's student row
(`setup.js:269`) has no `sex` field at all, although `U.validatePesel` already returned it two lines
earlier. Consequence beyond SIO: `homeroom.js:510` prints `urodzon${sex === 'K' ? 'a' : 'y'}`, so every
certificate for a girl imported by the wizard says **"urodzony"**, and the locative suggestions the
homeroom teacher is asked to confirm are generated with the wrong gender.

**34. Siblings.** The twins in the nabór file got two parent accounts, because the merge key is the
e-mail alone and the export numbered the same mother's address per application
(`katarzyna.mazur31@` / `katarzyna.mazur32@`). Redeeming the second code while **logged out** →
`400 "Login musi mieć co najmniej 4 znaki."`; while **logged in** → `200 "Do Twojego konta dopisano
ucznia Maciej Mazur. Masz teraz 2 dzieci w tej szkole."` The printed code card
(`POST /api/admin/registration-codes/print`) gives four numbered steps and none of them is "log in
first if you already have an account". Afterwards the registrar can detach the dead contact account —
`200 "Katarzyna Mazur **stracił** dostęp…"`.

**35. Scale — 24 classes, 600 pupils, 720 timetable rows.** No scale problem at all:

| step | rows | ms |
| --- | ---: | ---: |
| `POST /api/setup/teachers/import` | 24 | 2 488 (scrypt, ~57 ms × 24 + 24 classes) |
| `POST /api/setup/students/import` dryRun | 600 | 30 |
| `POST /api/setup/students/import` | 600 | 322 (600 pupils + 600 parents + 600 codes) |
| `POST /api/admin/timetable/import` | 720 | 26 (0 conflicts) |
| `POST /api/setup/lessons/generate` | — | 414 → **27 072 lessons** |
| `GET /api/registry/students` | 600 | 41 (744 KB in one response) |
| `GET /api/admin/registration-codes` | 600 | 46 (153 KB) |
| `POST /api/admin/registration-codes/print` | 600 | 13 (88 KB of HTML) |

REL-15 and OPS-06 hold. The whole API side of onboarding a 600-pupil school is ~3.3 seconds. What
takes the day is the Excel work in steps 5 and 8, and the 744 KB single-response register list is the
only number worth watching.

---

## 2. Findings

| id | severity | where | what happens | what a school expects | proposed fix |
| --- | --- | --- | --- | --- | --- |
| OPS3-01 | blocker | `server/lib/blank-seed.js:15–22` + `:38` vs `server/routes/admin.js:93` | Every wizard-born school has Easter Monday both in `daysOff` and inside the spring-break range, so `PATCH /api/admin/year` is `400 year_invalid` **forever** — a no-op save fails. The school cannot add a *dzień dyrektorski*, an exam day or a corrected semester date, and cannot make the calendar cancel lessons. Happens every year by construction; the demo seed dodges it, so no test sees it. | The calendar the wizard produced is savable, and adding one free day works. | One line in `blank-seed.js:15` — `statutoryDaysOff` drops any date that falls inside a `holidays` range of the same year (pass the ranges in from `schoolYearFor`). Add a test that `PATCH /api/admin/year` with the blank seed's own `GET` body returns 200. Files: `server/lib/blank-seed.js`, `tests/` (a new case in the setup suite). |
| OPS3-02 | blocker | `server/routes/attendance.js:46`; `server/routes/admin.js:592` (`split`), `:631` (import, `mapping` kinds); no `PATCH /api/admin/timetable/:id` | Groups imported from aSc/Optivum stay as `groupLabel` strings with `groupId: null`. `POST /api/admin/classes/:id/split` creates the groups but binds nothing, the two-phase mapping has no `groups` kind, and no route edits a single timetable row. Attendance on every split lesson lists the whole class (measured: 8 of 8 in 7b English). | After splitting a class, the English teacher's roster is her half of it. | Add `groups` as a fifth mapping kind: the dry run already reports `groupLabels`, so offer `{label → groupId}` next to teachers/classes/subjects/rooms and write `groupId` on the row when the label is mapped. Second, smaller half: let `POST /api/admin/classes/:id/split` take `bindLabels: {"1. grupa":"g_7b_ang1"}` and rewrite matching `timetable` rows + already-generated `lessons`. Files: `server/routes/admin.js` (proposal + apply + split), `public/app/screens/admin.js` (`mapTable('groups')`), `tests/51-timetable-import.test.js`, `docs/IMPORT.md` § 9.2. |
| OPS3-03 | blocker | `server/routes/admin.js:110–116` (the message), `server/lib/blank-seed.js:47` (`lessonTimes`, 1–8 only), no writer anywhere | The import error for an hour-0 row tells the admin to add `{no:0,start,end}` "in the school settings". No route writes `config.lessonTimes`; `GET /api/admin/year` does not even return it. Hand-editing the data file is the only way, and `docs/IMPORT.md` § 4a documents the JSON edit as if it were a feature. | A bells screen. An hour-0 school loads its plan. | `GET/PATCH /api/admin/bells` (admin): return `lessonTimes`, validate monotonic non-overlapping times and unique `no` (allowing `0`), and on change reconcile nothing (the numbers do not move). Point the existing error message at it. Files: `server/routes/admin.js` (new route + message), `public/app/screens/admin.js` (a field in `StrukturaRoku`), `tests/51-timetable-import.test.js`, `docs/IMPORT.md` § 4a. |
| OPS3-04 | blocker | `server/lib/blank-seed.js:58`; no `POST /api/subjects` | No route creates a subject. `asc/plan-sp12.xml` blocks on `Etyka`, `Wychowanie do życia w rodzinie` and `Godzina z wychowawcą`; `register/staff.csv` blocks on the same three. The only legal answer in phase 2 is `null` = skip, so the statutory *godzina z wychowawcą* vanishes from the plan and from the journal for every class. | "Add subject" next to "add teacher". | `POST /api/admin/subjects {id,name}` + `PATCH`/`DELETE` guarded by use, and an "add as a new subject" option in the import mapping table for an unmatched subject. Ship `etyka`, `wdz` and `gw` in the blank seed while you are there. Files: `server/routes/admin.js`, `server/lib/blank-seed.js`, `public/app/screens/admin.js` (mapping table), `tests/51-timetable-import.test.js`. |
| OPS3-05 | major | `server/routes/setup.js:185`, `:225` | Both wizard importers reject the school's real files 100 % with `"Brak imienia lub nazwiska."` / `"Wymagane: class, lastName, firstName."` — one line per row, no mention of the header found, the header expected, or the alias table that `server/lib/identity.js:119` already has. A secretary reads 60 identical errors and concludes the program is broken. | "I see columns `Nazwisko;Imię;…`; I need `lastName;firstName;…` — or let me map them." | Run both wizard CSVs through `ID.COLUMNS` / `CSV.column` the way the registrar importer does, and return `columns` + `unknownColumns` + one header-level error instead of N row errors when **no** row matched. Files: `server/routes/setup.js` (`parseCsv` + the two handlers), `server/lib/identity.js` (add `teacher*` aliases), `tests/`. |
| OPS3-06 | major | `server/routes/registry.js:646`; no caller in `public/app/screens/` | `POST /api/registry/students/import` is the only thing in the system that reads a real nabór/Librus/UONET+ export — and it is dry-run only, has no screen, and puts every guardian column in `unknownColumns`. The reviewed list it produces cannot be written by any route. R7's "two-phase pupil import" exists in the server and in the docs but not for the user. | Upload the nabór file, review the table, press Save. | (a) Map guardian columns in `ID.mapRegisterRow` (`Opiekun 1/2 – nazwisko/imię/telefon/e-mail`, `Uwagi`). (b) Add `POST /api/registry/students/import/apply {rows}` that writes the reviewed rows through the same code as `POST /api/registry/students`. (c) An import card in `registrar.js` with a file input. Files: `server/lib/identity.js`, `server/routes/registry.js`, `public/app/screens/registrar.js`, `tests/35-registry.test.js`, `docs/IMPORT.md`. |
| OPS3-07 | major | `server/routes/setup.js:175` (format), `:276` (parent block) | The wizard's pupil CSV carries **one** guardian. The nabór export carries two for 58 of 60 pupils. The second parent cannot be imported at all: `POST /api/registry/students/:id/guardians` either issues a code or pins an **existing** account — there is no way to record the second guardian's name, phone and e-mail from a file. At 600 pupils that is ~570 rows of contact data typed in by hand, or lost. | Both guardians come in with the pupil. | Accept `parent2LastName;parent2FirstName;parent2Email;parent2Phone` (and the `Opiekun 2 – …` aliases) in `POST /api/setup/students/import`, creating a second contact account + code exactly like the first. Files: `server/routes/setup.js`, `server/lib/identity.js`, `tests/`, `docs/IMPORT.md`. |
| OPS3-08 | major | `server/routes/setup.js:50`, `:315`; `public/app/screens/setup.js:50` (`gen`) | A school switching on 23 September gets 805 lessons dated 1–22 September, all `status: "held"`, none with a topic or attendance, and the principal's completeness audit reports 250 gaps against 17 teachers in its first window. `syncLessons` only ever touches `today+1` onward, so nothing can remove them afterwards — and with OPS3-01 open the calendar route cannot either. | "We start on the 23rd" is a question the wizard asks. | Give `POST /api/setup/lessons/generate` a `from` default of `max(semester1.from, today)` — or better, ask: add a `startDate` field to the wizard's step 4 and pass it. Also stop stamping `held` on a lesson with no journal entry; `planned` in the past is honest. Files: `server/routes/setup.js` (`generateLessons` status + the route default), `public/app/screens/setup.js` (`TimetableStep`), `tests/`. |
| OPS3-09 | major | `server/routes/setup.js:269` (no `sex`) vs `server/routes/registry.js:356` | The wizard never stores `sex`, although it has just validated the PESEL that encodes it. Measured: 0 of 60 pupils have one. The SIO package ships `plec=""` for the whole school, and `homeroom.js:510` prints "urodzon**y**" on every girl's certificate; the declension suggestions the homeroom teacher confirms are also generated with the wrong gender. | The certificate says "urodzona". | One line: keep the `U.validatePesel(pesel)` result and write `sex: v.sex` (and `birthDate: v.birthDate`) on the imported pupil. For a no-PESEL pupil, add an optional `sex` column and require it when the document path is used. Files: `server/routes/setup.js`, `tests/` (assert `plec` is non-empty in the SIO package after a wizard import). |
| OPS3-10 | major | `server/routes/setup.js:217` (floor 1000) vs `server/routes/registry.js:29` (floor 1200) | Two different floors for the same statutory number. A school whose wizard cohort ended at 1060 gets **1201** for the first pupil the registrar admits — a 140-number hole in the księga uczniów, which is exactly the defect OPS-09 closed inside one route. | Consecutive numbers, whichever screen opened the entry. | One shared helper, one floor. `D.nextRegisterNo(db)` in `server/lib/domain.js`, used by both; the floor is a config value (`config.registerNoStart`, default 1). Files: `server/lib/domain.js`, `server/routes/setup.js`, `server/routes/registry.js`, `tests/35-registry.test.js`. |
| OPS3-11 | major | `public/app/screens/setup.js:48` (`TimetableStep`), `sw.ttHint` at `:5`/`:6` | The wizard's timetable step posts `{csv: …}` from a textarea with `force: true` and no mapping table — none of the aSc/Optivum/two-phase work is reachable during first-run setup. Its hint says *"Ten sam format co import z programu układającego plan (aSc, Vulcan)"*, which is false: that format is the invented CSV the triage told us to stop treating as real. | Drop the aSc file into step 4. | Reuse `ImportPlanu` from `admin.js` inside step 4 instead of the textarea (it already handles files, folders, formats, the mapping table and `dryRun`), and fix `sw.ttHint` in both locales. Files: `public/app/screens/setup.js`, `public/app/screens/admin.js` (export the card), `docs/IMPORT.md`. |
| OPS3-12 | major | `server/routes/admin.js:219` (`buildProposal` writes `null`), `public/app/screens/admin.js:702` | *(= D3-51, shown live.)* Echoing `report.mapping` back — what the docs show and what the admin screen does — writes `room: ""` on all 254 rows. The dry run said 14 rooms; the apply says "0 sal" and nobody reads it. Printed timetables and the parent view lose every room number. | A room the importer did not recognise goes in verbatim, as `docs/IMPORT.md` § 5 promises. | Do not put `null` in `mapping.rooms`; for rooms, `undefined`/absent must mean "use the file's text", and only an explicit `""` should clear it. Files: `server/routes/admin.js`, `public/app/screens/admin.js`, `tests/51-timetable-import.test.js`. |
| OPS3-13 | major | `server/routes/registry.js:621`; `server/lib/blank-seed.js:44–56` | *(= D3-43, shown live.)* `POST /api/registry/sio/validate` → `500` on every wizard-born school (`config.sio` undefined); the admin screen's "Sprawdź pakiet SIO" button shows a red *"Błąd serwera."* The package download itself works, so the school can export something it was never able to check. The blank seed is missing **18** config keys the demo seed has (`adultAccess, archiveWindow, auditImmutable, …, retention, sio, termGradeThresholds, …` — full list from `06-blank-vs-demo.js`). | The button says whether the file is good. | Guard the read (`(config.sio \|\| {}).schemaVersion`) **and** close the class of bug: make the blank seed start from the same config defaults object the demo seed uses, so a key added for one is present in both. Files: `server/lib/blank-seed.js`, `server/routes/registry.js`, `tests/` (a "blank install answers every route the demo does" case). |
| OPS3-14 | major | no route; `server/routes/setup.js:198`, `:257` | There is no way to create a class. Classes appear only as a side effect of a teacher row with `homeroomOf` or a pupil row with `class`. Importing an Optivum publication before the roster blocks on `classes: ["4A","4B","5A","5B","6A"]` with nothing the admin can do but invent a pupil. There is also no way to rename one, and a typo'd class can only be removed by undoing the whole import. | "Add class 4a" next to "add teacher". | `GET/POST/PATCH/DELETE /api/admin/classes` (delete only when empty and unused), plus an "add as a new class" option in the import mapping table. Files: `server/routes/admin.js`, `public/app/screens/admin.js`, `tests/`. |
| OPS3-15 | minor | `server/routes/setup.js:261` | The dry run emits one "roll number already taken" warning per pupil per class (58 on the fixture, ~576 at 24-class scale) that the real import does not emit, because in `dryRun` no pupil is written and the next free number is recomputed as 1 every time. A preview that cries wolf is a preview nobody reads. | The trial run and the real run say the same thing. | Track the roll numbers handed out inside the loop (`seenRoll` at `:263` already exists — seed it with the stored maxima and use it for the "taken" test in both modes). Files: `server/routes/setup.js`, `tests/`. |
| OPS3-16 | minor | `server/routes/registry.js:388` | A pupil admitted with `enrolledAt: "2027-02-16"` gets a guardian code expiring `2026-10-23` — 30 days from **today**, four months before she starts. | The code is valid around the day she starts. | `expiresAt = addDays(max(today, enrolledAt), validDays)`. Files: `server/routes/registry.js`, `tests/`. |
| OPS3-17 | minor | `server/routes/admin.js:929`; `admin.js:896` (the printed card) | A parent of two children who redeems the second code without logging in first gets `400 "Login musi mieć co najmniej 4 znaki."` The printed instructions list four steps and none of them is "if you already have an account, log in first". | "You already have an account — sign in and the second child will be added." | Detect a code whose pupil has a guardian with an activated account and answer `409 {code:'login_first'}` with that sentence; add a fifth line to the printout. Files: `server/routes/admin.js` (both places), `tests/`. |
| OPS3-18 | minor | `public/app/screens/setup.js:43` | Wizard warnings render as `t('sw.line') + ' ' + w.line`, but the class-created warning (`setup.js:290`) carries no `line` → *"wiersz undefined: Oddział „9z” powstał dla 1 ucznia…"* on the screen. | A warning about a whole file does not pretend to be about a row. | `w.line ? t('sw.line') + ' ' + w.line + ': ' : ''`. Files: `public/app/screens/setup.js`. |
| OPS3-19 | minor | `server/routes/registry.js:593` and neighbours | Guardian messages are hard-coded masculine: *"Katarzyna Mazur **stracił** dostęp…"*. The parent record has `firstName` but no gender, so the string cannot be fixed without one. | Polish messages agree with the person's name. | Either keep both forms behind the guardian's own `sex` (add it to `POST /api/register` / `POST /api/admin/staff`) or rewrite the six strings impersonally (*"Odebrano dostęp: Katarzyna Mazur…"*). The impersonal rewrite is the small fix. Files: `server/routes/registry.js`. |
| OPS3-20 | minor | `server/lib/identity.js:119` (`COLUMNS`) | `Uwagi` — the free-text column that carries *"ojciec pozbawiony władzy rodzicielskiej"* — is dropped by every importer and lands in `unknownColumns`. The `guardianStatus: deprived` machinery R3 built has no path from the file the school was handed. | The annotation survives to the screen where somebody decides what it means. | Carry `Uwagi` through `mapRegisterRow` as `note`, show it in the review table, and never act on it automatically. Files: `server/lib/identity.js`, `server/routes/registry.js` (review payload), `public/app/screens/registrar.js`. |
| OPS3-21 | minor | `public/app/screens/setup.js:17` (the principal card), `server/routes/setup.js:316` | The principal is an optional field on step 1. Skip it and there is no `principal` role: the completeness audit, the semester close and the year-end archive all answer `403` to the administrator, with no hint that the missing piece is an account. | The wizard says a principal account is needed for the year-end archive. | Make the principal card required (or list "no principal account" as a gap in `POST /api/setup/finish`'s `missing`). Files: `server/routes/setup.js` (`finish`), `public/app/screens/setup.js`. |

**Counts: 4 blockers, 10 majors, 7 minors.**

### What works, and should not be touched

The aSc importer (254 rows, 0 conflicts, 0 errors, a `proposal` with 44 exact matches), the Optivum
folder reader (multi-publication detection, cp1250, cross-check, `-T1/-T2` legends quoted back), the
roster gate by enrolment date, the first-period absence alert, the registration-code lifecycle
including claiming an imported contact account, the archive window and package, the year-structure
computation itself, and the throughput at 24-class scale. Those are the parts of the system a school
would recognise as better than what it has.

---

## 3. The three things only a real school's file can settle

1. **One aSc export and one Optivum publication, from a school with an hour 0 and a two-week cycle.**
   Everything in § 4a and § 4a-of-the-fixtures is reconstruction. Our corpus has hour 0 in a
   hand-built 7-lesson file and the A/B cycle in a fixture whose own README calls it *"rekonstrukcja
   słabsza niż reszta"*. Two facts change the design: whether a real school's `<periods>` really
   starts at `period="0"` (then OPS3-03 is a blocker, not a nicety), and whether a real Optivum A/B
   school publishes markers in one tree or two trees (`tydzienI/`, `tydzienII/` — a shape we do not
   read at all). Ask for the file *with* the school's bell schedule next to it.

2. **One nabór/UONET+ export with the guardian block as the gmina really writes it.** OPS3-06 and
   OPS3-07 both hinge on it: how many guardian columns there are, whether the relationship
   (*matka / ojciec / opiekun prawny*) is a column or part of a name, whether the same parent of two
   children appears with one e-mail or two, and what actually goes in `Uwagi`. Our fixture numbers the
   twins' mother's e-mail per application, which is a guess — and it is the guess the whole
   sibling-merge rule rests on. Also needed: what a school does when the export has **no** e-mail at
   all, which is common in the first grades.

3. **One school's subject list and one arkusz organizacyjny.** OPS3-04 is only a blocker because our
   seed's 18 subjects are our invention. The real question is not "add three more" — it is whether a
   school's subject list is stable enough to seed at all, or whether every school needs its own from
   day one (*godzina z wychowawcą*, *etyka*, *WDŻ*, *doradztwo zawodowe*, *zajęcia rewalidacyjne*,
   two foreign languages under one id or two). The same file settles how the school writes a
   teacher's subjects and workload, which is the only bridge between `staff.csv` and the shortcodes
   in the timetable export.
