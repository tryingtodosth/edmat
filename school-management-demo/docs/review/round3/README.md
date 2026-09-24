# Round 3 — status page

Every finding of the six round-3 reviews, where it was closed, and the proof. Round 3 ran on
23 September 2026; the seven fix packages of [`FIXPLAN.md`](FIXPLAN.md) landed the same day.

Reports: [`operations.md`](operations.md) (OPS3-01…21) · [`security.md`](security.md) (S3-01…21) ·
[`usability.md`](usability.md) (U3-01…47) · [`domain.md`](domain.md) (D3-01…57) ·
[`reliability.md`](reliability.md) (R3-01…13) · [`test-honesty.md`](test-honesty.md) (verdicts,
retags, the flake, coverage holes H-1…H-10). Round 1–2 and their fix round:
[`../README.md`](../README.md).

**How to read the tables.** `closed` means the whole finding is closed and somebody has looked at the
code that closes it. A finding whose fix landed **in part** is listed as `open`, with the part that is
still missing named in the description — no row is half-green. `open by design` means the team looked
at it and chose the current behaviour. `needs the team` means the fix is a policy or legal decision,
not a code change; every one of those appears again in § 5. Evidence is a file and a line in the
current tree, or the name of a test that fails if the fix is reverted. Line numbers are from the
tree as it stands after the fix round, not from the reports (those are stale by construction).

## 1. Where the round ended

| report | findings | closed | open | open by design | needs the team |
| --- | ---: | ---: | ---: | ---: | ---: |
| `operations.md` | 21 | 19 | 2 | — | — |
| `security.md` | 21 | 19 | 1 | — | 1 |
| `usability.md` | 47 | 34 | 13 | — | — |
| `domain.md` | 57 | 42 | 13 | — | 2 |
| `reliability.md` | 13 | 12 | 1 | — | — |
| `test-honesty.md` — holes H-1…H-10 | 10 | 8 | 2 | — | — |
| `test-honesty.md` — retags, hygiene, harness | 11 | 11 | — | — | — |
| `test-honesty.md` — speed suggestions § 6 | 3 | — | 2 | 1 | — |
| **total** | **183** | **145** | **34** | **1** | **3** |

By severity, the ones that would have stopped a pilot: **26 blocker/high rows** were raised
(OPS3 4, S3 5, U3 3, D3 12, R3 2) and **all 26 are closed**. Everything still open is a major, a
minor, a coverage hole or a decision. Several findings were reached twice from different lenses and
are listed in both reports with the same verdict — OPS3-12 = D3-51, OPS3-13 = D3-43 = R3-05,
S3-21 = R3-04, S3-03 = R3-07 — so the 183 rows are fewer than 183 distinct defects.

One thing that is *not* a round-3 finding and is red today: **`node --test tests/` is 511 pass / 1
fail**, and the failure is `[3.9.1]` — see § 5.

---

## 2. Findings

### 2.1 `operations.md` — onboarding a 600-pupil school (OPS3-01…21)

| id | sev | what it was | closed by | evidence | status |
| --- | --- | --- | --- | --- | --- |
| OPS3-01 | blocker | Every wizard-born calendar had Easter Monday inside the spring break, so `PATCH /api/admin/year` was `400` for ever | F5 | `server/lib/blank-seed.js:15,100`; `[onb.2] kalendarz, który wypisał kreator, da się zapisać…` | closed |
| OPS3-02 | blocker | Imported group splits kept `groupId: null`, so every split lesson listed the whole class | F5 | `server/routes/admin.js:151,189,208` (`groups` mapping kind), `:976` `PATCH /api/admin/timetable/rows/:id`; `[onb.5]` | closed |
| OPS3-03 | blocker | The hour-0 error pointed at a bell-schedule screen that did not exist; no route wrote `config.lessonTimes` | F5 | `server/routes/admin.js:616` (`PATCH /api/admin/year` carries `lessonTimes`), `:114`; `[onb.3]`, `[onb.6]` | closed |
| OPS3-04 | blocker | No route created a subject, so *godzina z wychowawcą*, etyka and WDŻ could only be skipped | F5 | `server/routes/admin.js:755–789`; `server/lib/blank-seed.js:109`; `[onb.9]`, `[onb.10]` | closed |
| OPS3-05 | major | Both wizard importers rejected the school's real CSV 100 % with one identical row error and no header diagnosis | F5 | `server/routes/setup.js:38` `headerDiagnostics`, `:302`; `[onb.4]` | closed |
| OPS3-06 | major | The only importer that reads a real nabór export is dry-run only, has no screen and cannot write back | F5 | guardian/`Uwagi`/`sex` aliases landed (`server/lib/identity.js:136–142`); **no apply route, no registrar import card** (`server/routes/registry.js:758` still dry-run only) | open |
| OPS3-07 | major | The wizard CSV carried one guardian; the nabór export carries two for 58 of 60 pupils | F5 | `server/routes/setup.js:422`; `[onb.4]` asserts two guardian accounts | closed |
| OPS3-08 | major | A school switching on 23 September got 805 phantom lessons dated before the switch, all `held` | F5 | default `from` = `max(today, year start)` + a wizard field (`server/routes/setup.js:514–524`); **a past lesson with no journal entry is still stamped `held`** (`setup.js:138`) | open |
| OPS3-09 | major | The wizard never stored `sex`, so SIO shipped `plec=""` and every girl's certificate said „urodzony” | F5 | `server/routes/setup.js:117,408`; `[onb.4]` | closed |
| OPS3-10 | major | Two register-number floors (1000 / 1200) left a 140-number hole in the księga uczniów | F5 | `server/routes/setup.js:86,367` one `nextRegisterNo`; `[onb.4a]` | closed |
| OPS3-11 | major | The wizard's timetable step was a textarea with `force: true` and a hint that named formats it could not read | F5 | `public/app/screens/setup.js:52` reuses `A.AdminCards.ImportPlanu`; `sw.ttHint` rewritten | closed |
| OPS3-12 | major | Echoing the dry run's `mapping` back wiped every room (= D3-51) | F5 | `server/routes/admin.js:259`; `tests/51-timetable-import.test.js:533,552,594`, `[onb.7]` | closed |
| OPS3-13 | major | `POST /api/registry/sio/validate` was a 500 on every wizard-born school; the blank seed lacked 18 config keys (= D3-43, R3-05) | F5 + F2 | `server/lib/blank-seed.js:100` (`blankExtras` parity), `server/routes/registry.js:707`; `[onb.1]` | closed |
| OPS3-14 | major | There was no way to create, rename or remove a class | F5 | `server/routes/admin.js:807–856`; `[onb.9]`, `[onb.10]` | closed |
| OPS3-15 | minor | The dry run cried "roll number taken" for every pupil; the real run did not | F5 | `server/routes/setup.js:100` `rollTracker`, used at `:368` | closed |
| OPS3-16 | minor | A February pupil's guardian code expired four months before she started | F5 | `server/routes/registry.js:101` (`max(today, enrolledAt)`) | closed |
| OPS3-17 | minor | A parent redeeming a second child's code without logging in got „Login musi mieć co najmniej 4 znaki." | F5 | `server/routes/admin.js:1243` → `409` with "zaloguj się na nie…" | closed |
| OPS3-18 | minor | A file-level wizard warning rendered as „wiersz undefined: …" | F5 | `public/app/screens/setup.js:47–48` | closed |
| OPS3-19 | minor | Guardian messages were hard-coded masculine („Katarzyna Mazur **stracił** dostęp") | F5 | `server/routes/registry.js:683` — impersonal „Odebrano dostęp…" | closed |
| OPS3-20 | minor | `Uwagi` — the column carrying the court annotation — was dropped by every importer | F5 | `server/lib/identity.js:181`, `server/routes/setup.js:432`; `[onb.4]` | closed |
| OPS3-21 | minor | Skip the optional principal card and every `/api/principal/*` route answers 403, with no hint | F5 | `server/routes/setup.js:534` adds `principal` to `missing`; `[onb.8]` | closed |

### 2.2 `security.md` — adversarial review (S3-01…21)

| id | sev | what it was | closed by | evidence | status |
| --- | --- | --- | --- | --- | --- |
| S3-01 | high | `GET /api/compliance/accessibility?facts=1` handed an anonymous caller every role's login, the password policy and the art. 9 row counts | F2 | `server/routes/compliance.js:122` + `server/lib/compliance.js:1111` (`build(…, {facts:false})`); `public surface: the accessibility statement never carries facts, in any shape` | closed |
| S3-02 | high | `publicConfig` shipped `video.eventSecret`, `jitsi.appSecret`, payroll rates and the IP-allowlist prose to every pupil | F2 | `server/index.js:29` `PUBLIC_CONFIG_KEYS` allowlist; `publicConfig: not one secret, not one line about the school's security posture` | closed |
| S3-03 | high | One anonymous GET cost 212 ms of CPU; ~5 req/s made the school's single process unusable | F2 | `server/lib/compliance.js:480` facts cache, `:309` hoisted probes, `:338` tracker scan; `server/routes/compliance.js:76` version-keyed cache | closed |
| S3-04 | high | A court-restricted parent kept reading grade warnings, messages and absence alerts although `/api/parent/grades` was 403 | F1 | `server/routes/messages.js:73`, `server/lib/domain.js:142,341`; `[R3.4] S3-04: przy obu statusach sądowych oceny, zawiadomienia i alerty idą tą samą regułą` | closed |
| S3-05 | high | An Art. 17 erasure with a one-letter needle redacted 100 % of the append-only audit log | F3 | `server/routes/privacy.js:112,127,141`; `jednoliterowe imię nie redaguje rejestru zdarzeń…` | closed |
| S3-06 | medium | `POST /api/privacy/forget` hard-deleted B50 grades and blanked the category-A register — the one path culling refuses | F3 | `server/routes/privacy.js:206,271`; `force przełamuje tylko bramkę „konto testowe", nigdy reguł klas (S3-06)` | closed |
| S3-07 | medium | A 369 kB hostile signature file froze the process for 12–22 s in `readSignedDigests` | F4 | `server/lib/archive.js:440` (`SCAN_BYTES`, `SCAN_MAX_HITS`, linear scan) | closed |
| S3-08 | medium | A JPEG uploaded as a signature turned the year `signed` and stopped the § 22 reminder for good | F4 | `server/routes/principal.js:719,723`, `server/lib/archive.js:417` `sniffSignature`; `archive: an opaque signature file is stored, said to be unverified, and does NOT silence the § 22 reminder` | closed |
| S3-09 | medium | `year` was free text, so `Content-Disposition` could carry two `filename` parameters — or a CRLF that bricked the row | F2 + F4 | `server/routes/principal.js:669,600`; `server/lib/router.js` `safeContentDisposition`; `public surface: a file name can never open a second header…` | closed |
| S3-10 | medium | Imposing a court restriction needed an order; lifting it needed nothing, and inherited the old order | F1 + F2 | `server/lib/domain.js:371` `guardianTransition`; `[R3.5] guardianTransition: nałożyć i zdjąć można tylko na dokumencie…` | closed |
| S3-11 | medium | One admin account proposed, approved and ran a cull that destroyed a child's whole art. 9 file | F3 | `server/routes/retention.js:767,811,816`; `brakowanie na cztery oczy: kto ułożył listę, ten jej nie zatwierdza (S3-11)` | closed |
| S3-12 | medium | Two dry-run imports that wrote nothing added 205 kB to the append-only audit log | F2 | `server/routes/registry.js:813,862`; `R7 imports: wiersz audytu suchego biegu niesie kształt, nie ładunek…` | closed |
| S3-13 | medium | Archive rows were a file host: 12 packages = 5.2 MB of JSON, no `DELETE`, `force` unbounded | F4 | `server/routes/principal.js:605,611,770`, blobs in `server/lib/blobs.js`; `archive: rebuilding a signed year needs a reason and loudly supersedes the old signature` | closed |
| S3-14 | medium | The PESEL dry run was a lookup service: a hit returned the child's name, and the audit row recorded nothing | F2 | `server/routes/registry.js:786,813`; `R7 imports: … i mówi, ile PESEL-i odpytano (S3-12, S3-14)` | closed |
| S3-15 | medium | The request log stripped the query string and then logged pupil names in the path | F2 | `server/index.js:126` `route.pattern`, `:113` `redactPath`; `public surface: the request log carries the route pattern, never the identifier in the path` | closed |
| S3-16 | low | The lock screen showed the pupil's name and the fact of the absence, and stuck there for a crisis | F6 | `server/routes/notifications.js:116,151,161`; `push: the render endpoint answers in the right language and never for another account` | closed |
| S3-17 | low | A registrar alone records an adult pupil's consent, on free text, and can re-open a guardian the pupil shut out | — | `server/routes/registry.js:505,512` — a non-empty `reason` is now required; no pupil confirmation, no structured document reference, notification still `rights` not crisis | needs the team |
| S3-18 | low | The import mapping let the DPO be made a maths teacher, and stored an unbounded, attacker-chosen room string | F2 + F5 | teacher half closed (`server/routes/admin.js:147`, `GRADE_EDITORS`); **the room value is still `String(room \|\| '')` with no allowlist and no cap on the import path** (`admin.js:329`) | open |
| S3-19 | low | A bad code point or 20 000 nested `<div>` returned V8's own message and cost seconds of blocked loop | F2 + F5 | `server/lib/import-asc.js:18`, `import-optivum.js:24`, `xmlcheck.js:19`, `server/routes/admin.js:349`; `R7 attendance: bomba zagnieżdżeń… to 400 po polsku` | closed |
| S3-20 | low | A `GET …/verify` wrote to a § 22 record with no audit row, and an unchecked package rendered as verified | F4 | `server/routes/principal.js:803` (writes nothing), `:577` derived `verified`, `intact: null` third state; `archive: GET …/verify computes and writes nothing…` | closed |
| S3-21 | low | A real PAdES signature hit the 512 kB JSON cap and came back as `ECONNRESET`, not 413 (= R3-04) | F2 | `server/lib/router.js:62,68`, `:24`; `[sec.26] a 413 on an oversized body reaches the caller as a Polish message, not a reset socket` | closed |

### 2.3 `usability.md` — the screens added that day (U3-01…47)

| id | sev | what it was | closed by | evidence | status |
| --- | --- | --- | --- | --- | --- |
| U3-01 | blocker | The guardian table's Save button sat 403 px outside the viewport, behind a silent scroller | F2 | `public/app/screens/registrar.js:931–936` — `Opiekunowie` is full width | closed |
| U3-02 | blocker | The compliance document table pushed the page to 423 px in a 390 px viewport (pl only) | F2 | `public/app/screens/compliance.js:111` (`E.Table`, `stack: true`); `[r4.12]` | closed |
| U3-03 | blocker | 8 483 characters of legal document inside one `aria-live="polite"` region | F2 | `compliance.js:159–172,194`; `[r4.12]` | closed |
| U3-04 | major | `Wykonaj brakowanie` destroyed school records on the first click, with no danger variant and no dialog | F3 | `public/app/screens/admin.js:1374–1383,1424–1430` | closed |
| U3-05 | major | An empty justification became the card heading in the legal disposal protocol | F3 | `admin.js:1363,1421–1423` — required, ≥5 characters, button disabled | closed |
| U3-06 | major | „poza terminem" was shown for a window that had not opened yet (pl only) | F4 | `public/app/screens/principal.js:1186`; `archive: the deadline is ten days after 31 August…` | closed |
| U3-07 | major | A three-step signing instruction for controls that are not on the screen yet | F4 | `principal.js:1200–1204` — `<ol>` gated on `last`, `pr.au.stepsNone` before it | closed |
| U3-08 | major | `Zweryfikuj pieczęć` reports 1 200 px up the page, and has no `.catch` | F4 | `principal.js:1085` still writes the shared `said`; no in-card alert, no catch | open |
| U3-09 | major | Outside the window the same button silently sends `force: true` with a canned reason | F4 | the window line now warns about the audit entry (`principal.js:1187`); **the label and the missing confirm dialog are unchanged** (`:1194`) | open |
| U3-10 | major | `Zapisz zakres` started dead for every guardian and was absent from the tab order | F2 | `registrar.js:698–707,771–775` — `blank()` seeds `g.legalBasis`, `why()` prints the reason | closed |
| U3-11 | major | The same fact is collected twice: structured basis fields and a free-text column that gates Save | F2 | `registrar.js:766–769` — the free-text column is still there and still gates Save | open |
| U3-12 | major | Four controls in the authority cell carry `label: ''` and only an `aria-label` | F2 | `registrar.js:743,747,751,752` — unchanged | open |
| U3-13 | major | The only new date field without `A.dateInputProps()` / `A.dateHint` | F2 | `registrar.js:752–753` | closed |
| U3-14 | major | Two server strings were hard-coded Polish and rendered verbatim in the English build | F1 + F6 | `server/routes/messages.js:28–46,170`; `[R3.7] „to nie jest doręczenie" i nota o danych kontaktowych idą w języku konta` | closed |
| U3-15 | major | One letter said "this is not a delivery" three times and never said what happens instead | F6 | `public/app/screens/messages.js:95–102,173–176,207` | closed |
| U3-16 | major | Three buttons whose whole accessible name is „Pokaż" | F2 | `compliance.js:98–99`, keys at `:20/:47`; `[r4.12]` | closed |
| U3-17 | major | `E.Tabs` rendered with no children, so even the selected tab's `aria-controls` pointed at nothing | F6 (messages) | **fixed for `messages.js:224–231`** (the panel is now `E.Tabs` children); **`compliance.js:181–185` still passes props only and the container at `:195` has no `role="tabpanel"`** | open |
| U3-18 | major | The compliance card told the DPO the login-footer link does not exist — it shipped | F2 | `compliance.js:37` (pl), `:64` (en) | closed |
| U3-19 | major | The accessibility-statement link on the login card measured 1.67 : 1 in the dark theme | F6 | `public/app/shell.js:22`, `public/app/app.css:70–76` (`.app-link`) | closed |
| U3-20 | major | The login page had no `<main>`, so the first tab stop — the skip link — was dead | orchestrator | `public/app/shell.js:143` — login body wrapped in `h('main', { id: 'main' }, …)` | closed |
| U3-21 | major | The import textarea was pre-filled with the example as its **value**, next to "replace the whole timetable" | F5 | `public/app/screens/admin.js:820–824,937–939` — placeholder plus an insert-example button | closed |
| U3-22 | major | The card subtitle interpolated the raw CSV header and overflowed a 390 px phone | F5 | `admin.js:79` (pl), `:427` (en) | closed |
| U3-23 | major | The retention table needs 840 px and gets 532 — the two acted-on columns are off-screen | F5 | `admin.js:1488` — the `dane` tab is still a `grid-2` with `Anonimizacja` | open |
| U3-24 | major | Choosing the document option in `Flagi` always 400s: the card has no type/number/country fields | F2 | `registrar.js:808–819,843–855` | closed |
| U3-25 | major | Opening a message announces it twice (focus move plus a live region around the pane) | F6 | `messages.js:253–259` — short `role="status"` line instead | closed |
| U3-26 | major | Choosing a decision kind inserts the banner at the top of a scrolled dialog | F6 | `messages.js:154–157` — banner beside the kind select, region mounted permanently | closed |
| U3-27 | major | The SW fallback dropped the urgency marker and said nothing about the child's absence | F6 | `public/sw.js:149,161,239–243`; `push: when the school cannot be reached the worker still shows the neutral title for the kind` | closed |
| U3-28 | major | Three screens had 26 `h3` cards and no `h2` at all | F2 + F4 + F5 | `admin.js:721`, `principal.js:775`, `registrar.js:503` — all three `Card` helpers emit `h2` | closed |
| U3-29 | minor | Two identical skip links as the first two tab stops | orchestrator | `shell.js:150` — `App` no longer renders `E.SkipLink` | closed |
| U3-30 | minor | `E.Table` and `E.Tabs` add focus stops that lead nowhere (axe `nested-interactive` ×6) | — | `public/edmat/bundle.js:369,399` — unchanged; the bundle is copied verbatim from the design system, so the fix belongs there | open |
| U3-31 | minor | 57 Tab presses to reach the first guardian control | F2 | `registrar.js:927–936` — card order unchanged, no skip link | open |
| U3-32 | minor | An option that can never be saved („2 lata") was selectable | F3 | `admin.js:1337–1338` — `disabled` under the statutory minimum | closed |
| U3-33 | minor | „Po terminie: 0" reads as a yes/no, not a count | F3 | `admin.js:314` (pl), `:661` (en) | closed |
| U3-34 | minor | *brakowanie*, JRWA and the B/Bc/A codes were used and never defined | F3 | `admin.js:325,328` (pl), `:672,675` (en) + a legend under the table | closed |
| U3-35 | minor | The field „Dokument tożsamości" had an option also called „Dokument tożsamości" | F2 | `registrar.js:35,136` (pl), `:260,361` (en) | closed |
| U3-36 | minor | The mother field is `required` and the father's is not, although either satisfies the rule | F2 | `registrar.js:558–559` — unchanged | open |
| U3-37 | minor | „Dane rodziców…" looks like a heading and is a `<p>` | F2 | `registrar.js:556` — unchanged | open |
| U3-38 | minor | The two file inputs are the only raw browser controls on the screen | F5 | a visible `<label>` was added (`admin.js:930–936`); the native inputs are still unstyled and still show the browser's own language | open |
| U3-39 | minor | The drop zone is a bare `div` and leads the hint on a phone | F5 | the hint now leads with „Wskaż plik poniżej" (`admin.js:100/448`); **the zone still has no `role` and no `aria-label`** | open |
| U3-40 | minor | `Zaimportuj i zastąp plan` is disabled with nothing saying why | F5 | `admin.js:131/479`, used at `:944` | closed |
| U3-41 | minor | Three names for one action across two buttons | F5 | `admin.js:116–117/464–465`, `:885,:961` | closed |
| U3-42 | minor | „Termin § 22" never named the act; the generate button claimed to print | F4 | `principal.js:250,237` (pl), `:622,609` (en) | closed |
| U3-43 | minor | Badge texts were spliced into the message subject string | F6 + orchestrator | `messages.js:239–247` — badges are their own row (the bundle gained the badge slot) | closed |
| U3-44 | minor | A rule about options only the head teacher can see was shown to every teacher | F6 | `messages.js:148–150` | closed |
| U3-45 | minor | One concept, three English names for "confirmation of receipt" | F6 | `public/sw.js:155,167`, `messages.js:26/66`; the English-dictionary test | closed |
| U3-46 | minor | The fallback body said "logbook" twice; `push.privacy` still promised the old payload | F6 | `public/sw.js:148,160`, `public/app/i18n.js:52,71` | closed |
| U3-47 | minor | The top nav and the tablists are silent horizontal scrollers, on a 1440 px desktop too | — | `public/app/app.css:44`, `public/edmat/bundle.css:263,304` — unchanged; half of it is the design-system bundle | open |

**Also from `usability.md` and not a numbered finding:** the "strings to reword" table was worked
through with the findings that own each key; the two WCAG 2.5.3 "label in name" cases (`rg.gu.saveAria`,
`cp.mdAria`/`cp.printAria`) are closed with U3-16 and the registrar strings.

### 2.4 `domain.md` — documents against the code (D3-01…57)

| id | sev | what it was | closed by | evidence | status |
| --- | --- | --- | --- | --- | --- |
| D3-01 | blocker | `notifyParentsOf` fanned out to every `parentIds` entry — a deprived parent got nurse visits, remarks and fees | F1 | `server/lib/domain.js:542`; `[R3.2] rozwód: jeden opiekun „court-restricted/info", drugi „deprived/none" — kto co widzi na każdej drodze` | closed |
| D3-02 | blocker | The first-period alert had its own loop and reached a `none` guardian and a non-consenting adult pupil's guardians | F1 | `server/routes/parent.js:101–110`; `[R3.3] uczeń pełnoletni bez zgody…` | closed |
| D3-03 | blocker | `visibleStudentIds` ignored scope, so a deprived parent could give the GDPR consent to record his child | F1 | `server/lib/domain.js:142–148`, `server/routes/meetings.js:95,116`, `parent.js:45` | closed |
| D3-04 | major | `ownStudents` used raw `childrenIds`, so a restricted parent still reached all the child's teachers | F1 | `server/routes/messages.js:60–65` | closed |
| D3-05 | major | The statutory failing-grade notice, the class broadcast and the emergency print ignored guardian status | orchestrator (F1's helper) | `server/routes/homeroom.js:699,705,743,844`; `[R3.4] S3-04…` | closed |
| D3-06 | major | `scopeSource` was written and never read, so a status edit silently widened a deliberate "no access" | F1 + F2 | `guardianTransition` in `server/lib/domain.js`; `[R3.5] guardianTransition…` | closed |
| D3-07 | major | Restoring access needed no basis, and inherited the court order that said the opposite | F1 + F2 | `guardianTransition` lifting branch; `[R3.5]` asserts `basisCleared` | closed |
| D3-08 | minor | `GET /api/parent/children` returns `restricted: ['st_kowalczyk_anna']` — the ids encode the child's name | F1 | `server/routes/parent.js:256` — still the id list, not a count | open |
| D3-09 | minor | `guardianScope` preferred a stored `accessScope` over the status, so `{deprived, full}` read as `full` | F1 | `server/lib/domain.js:277` `clampGuardianScope`, used at `:312` | closed |
| D3-10 | minor | `GET /api/auth/session` still reports `childrenIds` for a deprived guardian | — | `server/auth.js:6,159` — `publicUser` spreads the raw account | open |
| D3-11 | minor | A consent recorded under `until-objection` reads as an affirmative consent if the school switches mode | — | `server/lib/domain.js:249` — no `adultConsent.mode` stamped | needs the team |
| D3-12 | minor | The after-school pickup list is free text with no link to the guardian record | — | `server/routes/modules.js:56–57` — unchanged | needs the team |
| D3-13 | blocker | 46 of 74 array collections belonged to no retention class, invisibly | F3 | `server/routes/retention.js` `classifyAll`/`uncoveredCollections`; `każda tablica w magazynie ma klasę dokumentacji…` | closed |
| D3-14 | major | Two of four leaving paths never set `departureDate`, so the art. 9 clock never started | F3 | `retention.js:467`, `homeroom.js:826`, `privacy.js:287` | closed |
| D3-15 | major | `archives` and `semesterLocks` were filed as *protokoły rady pedagogicznej*, category A | F3 | `retention.js:309` `RETIRED_CLASSES`; `remapowane klasy: protokoły rady pedagogicznej znikają…` | closed |
| D3-16 | minor | „50 lat" was printed for a class that `archiveCategoryA` means is never proposed | F3 | `retention.js:559` `ruleText`; `docs/RETENTION.md:57` | closed |
| D3-17 | minor | The PPP clock resolves through the student row; if that row ever goes, the file is undeletable | F3 | `retention.js:466` — still `if (!student) return null;` | open |
| D3-18 | minor | Two "end of the school year" boundaries in one codebase (1 August vs the end of teaching) | F3 + F4 | the archive uses 01-09…31-08 and `retention.js:71` imports the shared helper; **`blank-seed.js:36` `schoolYearFor` is still `m >= 8`** | open |
| D3-19 | blocker | The § 22 XML had eleven element types and was not the dziennik | F4 | `server/lib/archive.js:107–264`; `archive: the XML is the logbook — lessons with topics, per-pupil attendance, remarks, descriptive and behaviour grades` | closed |
| D3-20 | blocker | The package indexed every grade and attendance row with no school-year filter | F4 | `archive.js:134,166`; the same test asserts a previous-year grade is excluded | closed |
| D3-21 | major | "Reproducible" meant "re-zips to the same bytes", not "the state on the year's last day" | F4 | `server/routes/principal.js:634` (`asOf`) + the D3-20 filter | closed |
| D3-22 | major | § 22 was counted from the end of teaching, ~2 months early and before the August resits | F4 + orchestrator | `principal.js:420–454`; `archive: the deadline is ten days after 31 August and the status turns over on that boundary` | closed |
| D3-23 | minor | A legitimate out-of-window rebuild was audited as a demo action | F4 | `principal.js:631`; `docs/ARCHIVE.md:340` | closed |
| D3-24 | minor | The day-3/day-8 reminders only exist as a side effect of opening the archive card | F4 | `docs/ARCHIVE.md:353` — „**Nie ma planisty.**" states it | closed (doc) |
| D3-25 | minor | The XML carried internal codes and no dictionary | F4 | `archive.js:124–131,218` `<Slowniki>` | closed |
| D3-26 | minor | An archive generated after the rollover omitted the graduating cohort | F4 + orchestrator | `archive.js:228` orphan class + the rollover blocker in `server/routes/school-year.js` | closed |
| D3-27 | blocker | The DPA the school signs says there is no third-country transfer, in the sentence that names push | F2 | `server/lib/compliance.js:1040`; `docs/compliance/README.md:53` | closed |
| D3-28 | blocker | The DPIA's CSP row was a 3 kB dump of `server/index.js` | F2 + orchestrator | `server/index.js:67` exported `contentSecurityPolicy()`, read by `privacy.js` `scanTrackers(app)` | closed |
| D3-29 | blocker | `PERSONAL_COLLECTIONS` named three collections that do not exist and omitted every art. 9 one | F2 + F3 | `server/routes/privacy.js:227` from `RET.classifyAll`; `lista kolekcji z danymi osobowymi bierze się z katalogu klas…` | closed |
| D3-30 | major | Seven collections holding personal and art. 9 data were declared "dictionary data, no personal data" | F2 | `article9Collections` now reads the retention table (`compliance.js:119`); **`REFERENCE` at `:94` still lists `otherActivities`, `substitutions`, `studentIds`, `documents`, `receipts`, `semesterLocks`** | open |
| D3-31 | major | The DPIA says `studentIds` holds no personal data and, twelve pages on, that it is the pupil register | F2 | follows D3-30 — unchanged | open |
| D3-32 | major | `docs/compliance/README.md` § 5 said the statement is not public; it had been public since the package landed | F2 | `docs/compliance/README.md:86` | closed (doc) |
| D3-33 | major | `pushableKind` began `if (n.crisis) return true`, so a welfare-status alert bypassed the positive list | F6 + orchestrator | `server/routes/notifications.js:184–192`; `push: the positive list decides first…` | closed |
| D3-34 | major | `PUSH_NEUTRAL` had one row; eleven kinds fell through to the raw text on the lock screen | F6 | `notifications.js:163`; `push: every pushable kind has a neutral sentence in both languages…` | closed |
| D3-35 | major | Neither payload nor SW carried `crisis`, so the alert was silent in exactly the case it exists for | F6 | `notifications.js:218`, `public/sw.js:179,258` | closed |
| D3-36 | minor | Jitter was drawn after the quiet-hours decision, so a push could fire inside the window | F6 | `notifications.js:331` re-checks at the delayed instant | closed |
| D3-37 | minor | `config.push.kinds` replaced the positive list instead of narrowing it | F6 | `notifications.js:187` filters against `PUSH_KINDS` | closed |
| D3-38 | minor | Regenerating VAPID keys left every subscription row on screen as a live device | F6 | `notifications.js:643–650` | closed |
| D3-39 | minor | The accessibility statement sent complaints to PFRON under the wrong act | F2 | `server/lib/compliance.js:931–937` | closed (doc) |
| D3-40 | minor | § 2 claimed full keyboard operation while § 4 listed 2.1.4 and 4.1.3 as untested | F2 | `compliance.js:873–876` | closed (doc) |
| D3-41 | minor | The DPIA risk row knew nothing of the four authority statuses or `adultAccess` | F2 | `compliance.js:768–773` | closed (doc) |
| D3-42 | minor | The § 22 wording error repeated inside the document the DPO signs | F4 | one `basis` constant at `principal.js:454`; seeds at `13-principal.js:41`, `blank-seed.js:73` | closed |
| D3-43 | blocker | `POST /api/registry/sio/validate` was a 500 on every blank install (= OPS3-13, R3-05) | F2 | `server/routes/registry.js:707–712`; `R7 SIO: „Sprawdź pakiet" na szkole z kreatora to 400 z instrukcją, nie pięćsetka` | closed |
| D3-44 | blocker | Every SIO self-check was advisory: a duplicate PESEL downloaded cleanly | F2 | `registry.js:721–726`; `R7 SIO: błąd kontroli własnej blokuje pobranie pakietu…` | closed |
| D3-45 | blocker | A pupil who gets a PESEL mid-year could not be given one anywhere | F2 | `registry.js:543–600`; `R7 register: uczeń dostaje numer PESEL w listopadzie i zachowuje numer księgi, konto i oceny (D3-45)` | closed |
| D3-46 | major | One SIO file carries three different `<uczen>` shapes; a pupil with both PESEL and a document loses the document | F2 | `registry.js:202–210` — still an `if/else if` chain | open |
| D3-47 | major | Duplicate detection exists for PESEL only, never for a document number | F2 | `registry.js:267` — no `duplicate_document` | open |
| D3-48 | major | No route changed a pupil's name and no previous name was stored (§ 4 of the regulation) | F2 | `registry.js:632` `PATCH …/name` + `previousNames[]`; `R7 register: zmiana nazwiska zapisuje poprzednie, podstawę i datę…` | closed |
| D3-49 | major | The confirmed declension forms are collected, audited, shown — and never printed on the certificate | — | `server/routes/homeroom.js:510` — still the nominative | open |
| D3-50 | major | An id referenced by a lesson but absent from the declared lists is dropped silently — a partial write | F5 | `server/lib/import-asc.js:325` — undeclared ids still never enter `entities`, and `skipped.rows` is still not printed | open |
| D3-51 | major | `null` in the proposal's `mapping` was read back as a human "skip" (= OPS3-12) | F5 | `server/routes/admin.js:259–264` `decided()`; `[3.5.5] import dwufazowy…` | closed |
| D3-52 | minor | One bad row rejects the whole CSV/JSON file and `force` does not bypass it | F5 | `admin.js:922` unchanged; `docs/IMPORT.md:167` still says the rest of the file goes in | open |
| D3-53 | minor | A `weeksdefs` mask longer than two characters was mis-read with no warning | F5 | `import-asc.js:94–105`, warning at `:316` | closed |
| D3-54 | minor | Two group lessons in one cell are read as week A / week B, so each half loses PE every other week | F5 | `import-optivum.js:280,301` — the gate is still `shared > 1 \|\| legend` | open |
| D3-55 | minor | „cofanie działa jak dotąd" — there was no undo for a timetable import | F5 | a `kind:'timetable'` batch with `previousTimetable`; `[onb.13] import planu jest partią i da się go cofnąć (H-3, R3-08)` | closed |
| D3-56 | minor | The cp1250 fallback note was discarded on the CSV/JSON branch | F5 | `admin.js:359` | closed |
| D3-57 | minor | Four small SIO drifts: `dataOdejscia`, unread `reportDate`/`namespace`, the two totals, `identityLabel` | F2 | only (d) is closed (`registry.js:116–117` `flagsView`); (a) the doc wording, (b) `reportDate`/`namespace` still unread and no `xmlns`, (c) the two totals still disagree under `?force=1` | open |

### 2.5 `reliability.md` — 600 pupils, a whole year (R3-01…13)

| id | sev | what it was | closed by | evidence | status |
| --- | --- | --- | --- | --- | --- |
| R3-01 | blocker | A mid-year plan change froze the school for 2.7 minutes (`hasJournal` scanned everything per lesson) | F5 | `server/routes/setup.js:153` `journalIndex`, `:171`; `[onb.12] 24 oddziały, 720 pozycji planu…` | closed |
| R3-02 | blocker | `kill -9` in a retention run left the deletion durable and the protocol, audit row and approval gone | F3 | `server/routes/retention.js:828` — protocol and audit flushed first; `kill -9 w środku sprzątania zostawia protokół brakowania i wpis audytowy (R3-02)` | closed |
| R3-03 | major | The retention scan ran twice per `GET …/proposal` and materialised 586 560 ids into a 28.9 MB row | F3 | `retention.js:579,598,696,720` — one scan, counts and a cut-off instead of ids | closed |
| R3-04 | major | The signature route's real ceiling was 512 kB, and the 413 never reached the browser (= S3-21) | F2 | `server/lib/router.js:62,68`; `[sec.26]` | closed |
| R3-05 | major | `POST /api/registry/sio/validate` was a 500 on every real (blank-seeded) installation (= D3-43) | F2 | `registry.js:712` + `blank-seed.js:58`; `R7 SIO: „Sprawdź pakiet"…` | closed |
| R3-06 | major | `xmlcheck` was quadratic: 479 kB of broken XML = 6.7 s of blocked process | F2 | `server/lib/xmlcheck.js:37,46` — precomputed line starts, bail at 50 errors | closed |
| R3-07 | major | An unauthenticated GET loop was an outage button (138 ms each, no cache, no limit) (= S3-03) | F2 | `compliance.js:480,309,338`; `server/index.js:88–100,131` token bucket; `public surface: the statement is served from a cache keyed by the store version, and is rate limited` | closed |
| R3-08 | major | `kill -9` mid-import left 100 pupils and 200 accounts with no batch to undo | F5 | `server/routes/setup.js:318,373` — batch row inserted and flushed first; `[onb.14] partia importu jest na dysku, zanim powstanie pierwszy uczeń — także po kill -9 (R3-08)` | closed |
| R3-09 | major | A 5 MB signature on a row made every write touching it cost 290–336 ms; RSS peaked at 926 MB | F4 | `server/lib/blobs.js` + `server/routes/principal.js:803`; `docs/STORAGE.md` § 2 | closed |
| R3-10 | major | 600 concurrent renders = 4.2 s of nothing else; the SW's fetch had no timeout | F6 | `notifications.js:231,251,443` index; `public/sw.js:198` `AbortSignal.timeout(4000)`; `push: the worker gives the school four seconds and then shows the neutral notification` | closed |
| R3-11 | minor | A restart inside the jitter window silently dropped every queued push and left the row `pending` | F6 | `notifications.js:346` `resumePending`; `push: the jitter queue survives a restart…` | closed |
| R3-12 | minor | `GET /api/setup/imports` (418 ms) and the transcript (152 ms) scan per pupil | F5 | only the `timetable` branch of `undoBlockers` got the index; `setup.js:257–259` and `registry.js:284` are unchanged | open |
| R3-13 | minor | Every `GET …/package` rebuilt the 4.7 MB ZIP in pure JS | F4 | `principal.js:687` streams the cached ZIP from `files/` | closed |

### 2.6 `test-honesty.md` — holes, tags, harness, speed

| id | what it was | closed by | evidence | status |
| --- | --- | --- | --- | --- |
| H-1 | **a defect, not a gap** — `/api/privacy/forget` deleted exactly the classes `55-retention` proves are never deleted | F3 | `[H-1] art. 17 na uczennicy: oceny i frekwencja zostają co do wiersza, imion w nich nie ma` (`tests/59-erasure.test.js`) | closed |
| H-2 | Nobody had run the importer on a school-sized file (272 rows was the largest) | F5 | `[onb.12] 24 oddziały, 720 pozycji planu: import i rok lekcji mieszczą się w podanym czasie (H-2)` | closed |
| H-3 | A timetable import could not be undone and nothing said so | F5 | `[onb.13] import planu jest partią i da się go cofnąć (H-3, R3-08)` | closed |
| H-4 | The published accessibility declaration cited tests by grepping for a story id | F2 | `tests/54-compliance.test.js:190–200` — `a11y().evidenceRun === 'checklist.md'`, and unticking a box on a copy changes the verdict | closed |
| H-5 | No API answer's computed deadline is ever checked — only the helper | F3 | `tests/55-retention.test.js:193` is still `assert.ok(row.nextDeadline)` | open |
| H-6 | The jitter queue was never shown releasing by time, only by a forced flush | F6 | `push: a jittered delivery is released by the queue itself, with nobody forcing it (H-6)` | closed |
| H-7 | The bulk path that writes a pupil without a PESEL was untested | F5 | `[onb.4]` — three document-only pupils land through `POST /api/setup/students/import` | closed |
| H-8 | Forging a formal notice with `formal: true` rather than the kind was untested | F1 | `[R3.6] flagi „formal" nie podniesie nauczyciel — ani rodzajem pisma, ani samą flagą` | closed |
| H-9 | Rebuilding after signing silently un-signed the year | F4 | `archive: rebuilding a signed year needs a reason and loudly supersedes the old signature` | closed |
| H-10 | "Immediate" block was only ever read by a client that logged in **after** the change | F1 | live-session refusals exist in `tests/36-student.test.js:255,283`; **no live-session case for a court-status change in `53-guardian-status`** | open |
| retag `51` | 16 parser tests carried `[3.5.5]`, holding a story hostage to a decoder | F5 | `[R1.1]`…`[R1.12]`; `[3.5.5]` kept on the four end-to-end route tests | closed |
| retag `36` | The consent-required test claimed story 3.6.12 (the objection) | F6 | `tests/36-student.test.js:283` `[R3.1]` | closed |
| order `52` #4 | The deadline test passed only because node runs tests in declaration order | F4 | `tests/52-archive.test.js:363–376` builds its own package on its own server | closed |
| `withConfig` | A key the config did not have came back present-and-`undefined` | F6 | `tests/helpers.js:97–104` | closed |
| keep-alive | The flake: Node closes an idle socket at 5 s while the loop is blocked | F6 | `tests/helpers.js:53–54` — `keepAliveTimeout = 120000`; `server/index.js` untouched | closed |
| retry predicate | `cause.code \|\| message` made `'fetch failed'` dead code and rethrew `UND_ERR_SOCKET` | F6 | `tests/helpers.js:15–30` — `REPLAYABLE_CODE`/`REPLAYABLE_TEXT`, replay narrowed to idempotent calls | closed |
| `44-setup` client | The only new file on a private, retry-less `fetch` — and the only one that flaked | F6 | `tests/44-setup.test.js:4` — `startServer` from `./helpers` | closed |
| Chromium timeout | A starved browser failed as „Chromium wyrenderował ekran /uczen" | F6 | `tests/helpers.js:251–261` + `EDMAT_UI_TIMEOUT` | closed |
| SIGTERM wait | The suite could **hang**, not fail, on an unbounded `p.on('exit')` | F6 | `tests/46-reliability.test.js:255–281` — bounded, second signal, named failure | closed |
| budget `[3.3.8]` | A 500 ms wall-clock budget on a shared machine is not evidence of an index | F6 | `tests/33-principal.test.js:299,306` — a ratio against an in-run linear pass | closed |
| budget `[setup.4]` | The name promised "under a second", the assertion allowed five | F5 | `tests/44-setup.test.js:102` — the timing claim is gone from the name and the body | closed |
| speed: seed once, clone | `createApp` re-runs every seed file per instance; ~2 s floor × 47 servers | — | `server/index.js:8–10`, `tests/helpers.js` — unchanged | open |
| speed: blank seed by default | `55`'s four servers carry a full demo school to assert about six planted rows | — | `tests/55-retention.test.js:207` — `serverWithExpired()` still demo-seeded | open |
| speed: split `49-pilot` | 12.7 s, a third of the wall clock, and the file everything waits for | — | still one file; the week is the point and splitting it is cosmetic next to the other two | open by design |

---

## 3. What each package did, in plain words

**F1 — guardian standing, one gate.** Before this package a court order was decoration: the grades
screen said 403 and the same parent read the child's absences, remarks, nurse visits and fees through
notifications and the message inbox. F1 put the whole question in one place — `D.guardianStanding` /
`D.guardianScope` in `server/lib/domain.js` — and made every channel ask it: the notification fan-out,
the inbox, a single message, the visible-children list, the recipient list a parent may write to, and
every consent decision. It also wrote `guardianTransition`, the rule that a restriction can only be
imposed **and only lifted** on a document, and that the old court order is never carried onto the new
entry. A scope a registrar typed by hand now survives a status edit instead of being silently widened.
The divorced-parent case is one test that walks every path for both parents at once.

**F2 — registry, identity, SIO, public surface.** Two halves. The public half: the accessibility
statement stays public because the law says so, but it is now built from a narrow fact subset, served
from a cache keyed on the store version, rate-limited like the login route, and it can no longer be
made to hand out `facts` in any shape; `publicConfig` became an allowlist, so the video event secret,
the Jitsi signing key, the payroll rates and the security-posture keys stopped being shipped to every
pupil; and the request log prints the route pattern instead of a pupil's name in the path. The registry
half closed the identity model the round exposed: a pupil can be given a PESEL in November without
losing their register number, a surname change is a route that keeps the previous name and the basis,
the SIO self-check now **blocks** the download instead of decorating it, and the validate button
answers a wizard-born school with an instruction rather than a 500. The compliance documents stopped
containing false statements: no third-country claim when push is on, a CSP read from the code that
builds it instead of a regex over the source, and an art. 17 list derived from the retention catalogue.

**F3 — erasure, retention, durability.** The two routes that may destroy data now share one rule.
Erasure no longer deletes in archival classes: it anonymises, refuses outright for category A, and
says in the answer which classes it had to touch. Its needles are structural fields with a minimum
length and a word boundary, so a pupil called "Ewa" can no longer take the audit log with her.
Culling grew the second pair of eyes the design always claimed: the approver must be a different
account from the proposer, and `run` consumes a one-shot token from that approval. The proposal
stopped being a 28.9 MB list of ids and became criteria plus counts, computed in one scan instead of
two. And the protocol, the audit row and the approval are flushed to disk **before** the sweep, so a
`kill -9` can no longer leave a school with no logbook and nothing on disk saying who deleted it.
Every array in the store now has a documentation class or is reported as uncovered.

**F4 — archive.** The § 22 package was not the dziennik and was not scoped to a year. It is now: per
lesson topics and attendance, remarks, descriptive and behaviour grades, certificate data and a
dictionary so a state archive can read the codes in 2077, all filtered to the school year and stamped
with the day the year ended. The deadline moved to ten days after **31 August**, which is what the
school year legally is, so the August resits and the resolutions that close the year are inside the
sealed package. `signed` now means one thing only — the uploaded signature's digest matches — and
anything else keeps the reminder coming until the head teacher records "accepted without verification"
with a reason, which is audited. Rebuilding a signed year needs a reason and loudly supersedes the old
signature. The bytes left the store: XML, print, ZIP and the signature file live under
`data/school/files/archives/<id>/` with only `{name, bytes, sha256, path}` in the row, which is why a
download is now a file read and `verify` is a GET that writes nothing.

**F5 — onboarding a wizard-born school.** This is the package a secretary would notice. The blank
seed's own calendar is now savable (it used to be `400` for ever, every year, by construction); there
are routes to create a subject, a class and a bell schedule including hour 0; an imported group split
becomes a real group and the English teacher's roster is her half of the class; both wizard importers
read the school's real files and, when nothing matches, say which columns they found and which they
wanted, once, instead of sixty identical row errors; the second guardian, the `Uwagi` annotation, `sex`
and the birth date all survive the import; register numbers come from one counter; lesson generation
starts on the day the school switched instead of manufacturing 805 phantom lessons; and a timetable
import is now a batch that is on disk before the first row changes, so it can be undone. The mid-year
plan change that froze the school for 2.7 minutes is one `Set` lookup.

**F6 — harness, push, shell strings.** The flake was in `tests/helpers.js`, not in the machine: a test
server now holds its keep-alive connection for the whole file, the retry predicate reads both the code
and the message and replays only what the server never read, `44-setup` lost its private retry-less
client, a starved Chromium says so instead of blaming the screen, and a missed `SIGTERM` becomes a
named failure instead of a hung `node --test`. Two wall-clock budgets were replaced by assertions about
the shape of the work. On the product side: the push positive list decides first (a crisis notification
of an unlisted kind stays in the logbook), every pushable kind has a neutral lock-screen sentence in
both languages, `crisis` travels in the minimal payload so the offline fallback is as loud as the
online one, jitter can no longer land inside quiet hours, rotating VAPID keys removes the dead devices,
and a queued push survives a restart. The service worker gives the school four seconds and then shows
the neutral notification.

**The orchestrator.** Between packages it applied the changes that crossed ownership lines: guardian
gating in the recipient lists of `support.js`, `modules.js` and `homeroom.js` (D3-05 and the
welfare-alert producer behind D3-33); `scanTrackers(app)` in `privacy.js`, which is what let the DPIA
read the CSP from the function that builds it; the retention sweep deleting an archive row's blob
directory with the row; the 31 August archive window in both seeds plus a rollover blocker in
`school-year.js`, so a year cannot be rolled over out from under an unsigned package; the pilot's
keep-alive; the message badge slot in the design-system bundle; and, on the login screen,
`<main id="main">` with the duplicate skip link removed.

---

## 4. Still open

Nothing here is a blocker. Each line says why it is still open.

**Product gaps somebody must still build**

- **OPS3-06 — the registrar's write-back import.** The one importer that reads a real nabór /
  Librus / UONET+ export is still dry-run only: the guardian, `Uwagi` and `sex` columns are now mapped,
  but there is no `POST /api/registry/students/import/apply` and no import card on the registrar
  screen. A secretary still converts the file by hand.
- **OPS3-08 (residue) — a past lesson with no journal entry is still stamped `held`.** The phantom
  lessons are gone (generation starts on the switch date and the wizard asks), but `planned` in the
  past would be the honest status.
- **D3-49 — the certificate still prints the nominative.** The declension forms are collected,
  drift-checked, audited and shown to the homeroom teacher; `certificateHtml` still uses
  `data.student`. The verification work has no effect on the blank.
- **D3-46 / D3-47 — the SIO identity model.** One file still carries three `<uczen>` shapes, a pupil
  with both a PESEL and a document loses the document, and duplicate detection exists for PESEL only.
  Both are cheap; both were behind D3-45 in the queue.
- **D3-50 — dictionary-less ids are dropped silently.** An id a `<lesson>` references but the file never
  declares still never reaches `parsed.entities`, so it cannot appear in `blocking`: the plan is saved
  minus those lessons, with `ok: true`, and `skipped.rows` is still not printed in the message. This is
  the one remaining partial write.
- **D3-52 / D3-54 — the other two import inconsistencies.** One bad row still rejects a whole CSV/JSON
  file and `force` does not bypass it, while aSc/Optivum drop rows; and two group lessons in one
  Optivum cell are still read as week A / week B. Both wait on decision 11 below ("strict or lenient
  imports") — picking one model is the fix.
- **D3-08 / D3-10 — restricted pupil ids are still exposed as ids.** `GET /api/parent/children` returns
  `restricted: ['st_kowalczyk_anna']` and `/api/auth/session` still reports `childrenIds` for a
  deprived guardian. The store id is a name slug, so the API tells the account exactly which child it
  may not see. A count would do.
- **D3-17 — the PPP clock has no fallback** if the pupil row ever goes away.
- **D3-18 (residue) — two "end of the school year" boundaries.** The archive and retention now share the
  01-09…31-08 range, but `blank-seed.js` `schoolYearFor` still switches on 1 August. Closing it needs
  decision 1 below.
- **D3-30 / D3-31 — `REFERENCE` still calls six personal collections "dictionary data".** The art. 9
  flag is now read from the retention table, so the DPIA's art. 9 list is right; the "no personal data"
  label on `otherActivities`, `substitutions`, `studentIds`, `documents`, `receipts` and `semesterLocks`
  is not, and it still contradicts § 8 of the same document.
- **D3-57 (residue) — three of the four SIO drifts.** `config.sio.reportDate` and `.namespace` are still
  stored and never read, the two `<podsumowanie>` totals still disagree under `?force=1`, and
  `docs/SIO.md`'s `dataOdejscia` sentence is unchanged.
- **S3-18 (residue) — the room value has no sanitiser on the import path.** The teacher half landed
  (only grade editors can be mapped in); an unrecognised room is still stored verbatim, unbounded.
  Nothing renders it as HTML today, so it stays a latent hazard.
- **R3-12 — the per-pupil scans in `GET /api/setup/imports` and the transcript.** Only the timetable
  branch of `undoBlockers` got the index.

**Interface work left on the table**

- **U3-17 — the tabs on `/dostepnosc`.** Fixed for `messages.js` (the panel is now `E.Tabs` children, so
  a real `role="tabpanel"` exists); `compliance.js` still calls `E.Tabs` with props only, so even the
  selected tab's `aria-controls` points at an id that is not in the DOM.
- **U3-08 / U3-09 — the archive card.** `Zweryfikuj pieczęć` still reports 1 200 px up the page and has
  no `.catch`; generating outside the window still uses the same label and no confirm dialog, although
  the line above it now warns about the audit entry.
- **U3-11 / U3-12 — the guardian card's two remaining shapes.** The free-text „Podstawa prawna" column
  still duplicates the structured fields and still gates Save, and four controls in the authority cell
  still carry `label: ''`.
- **U3-23 — the retention table is still in a `grid-2`**, so „Najbliższy termin" and „Weryfikacja" are
  off-screen on a 1440 px desktop.
- **U3-31 / U3-36 / U3-37 — registrar polish**: 30 transfer buttons before the first guardian control,
  the mother field `required` and the father's not, and a `<p class="body-strong">` posing as a heading.
- **U3-38 / U3-39 — the import card's file controls.** A visible label was added and the hint now leads
  with „Wskaż plik poniżej", but the two file inputs are still the browser's own (its language, its
  focus ring) and the drop zone is still a `div` with no `role` and no `aria-label`.
- **U3-30 / U3-47 — the design-system bundle.** `E.Table`/`E.Tabs` still add focus stops that lead
  nowhere, and the top nav and tablists are still silent horizontal scrollers. `public/edmat/` is copied
  verbatim from the design system; the fix belongs in that repository, not here.

**Tests**

- **H-5 — no API answer's computed deadline is checked.** `GET …/report`'s `nextDeadline` is still only
  asserted truthy; the 1-January rule is proven three times on the helper.
- **H-10 (residue) — "immediate" for a court-status change.** A guardian whose access is cut while they
  are signed in is still never tested; the adult-access pair in `36-student` covers the live-session
  shape, `53-guardian-status` does not.
- **Suite speed § 6.** Two of the three suggestions are untaken: `createApp` still re-runs every seed
  file per instance (~2 s floor × 47 servers, the dominant term in the 42 s wall clock), and the four
  retention servers still carry a full demo school to assert about six planted rows. Splitting
  `49-pilot` is **open by design** — the cross-role week is the point of that file, and at 12.7 s it is
  cheap next to the seeding.
- **The ZIP is still "stored", not deflated** — `dziennik-<rok>.xml` is 48 MB at 600 pupils and the
  package is the same size. `docs/ARCHIVE.md` § „Rozmiar" states this as a deliberate choice: deflate
  would shrink it more than tenfold but changes the ZIP writing contract, and today the package is a
  sack, not an archiver. **Open by design**, and the obvious next step.

---

## 5. Decisions the team must take

Eleven of these come from `domain.md` § 2; the packages added the rest while implementing. None is a
bug. Each one is a choice the code makes today, in one direction, that somebody outside engineering
has to own — and four of them are for the lawyer named in
`docs/research/2026-09-23-gemini-triage.md` § 3.

| # | decision | what the code does today | who decides | what changes if the answer is different |
| --- | --- | --- | --- | --- |
| 1 | **Is a *podpis zaufany* enough for § 22?** The 2026 research names the qualified signature, the qualified seal and the personal signature, and does **not** name the trusted profile — the weakest-graded claim in the whole report | accepts all five kinds (`zaufany`, `osobisty`, `qualified`, `xades`, `pades`), records which was used and **does not rule** on whether it satisfies § 22 (`docs/ARCHIVE.md` § „Otwarte pytanie") | lawyer | if only a qualified signature counts, every school buys a cloud seal (~900–1 350 PLN/year, unconfirmed) or the head teacher needs a qualified certificate; if the trusted profile counts, the cost is zero |
| 2 | **What does „zakończenie roku szkolnego" mean for § 22?** | **31 August** — the end of teaching stays as the earliest day the package makes sense (`config.archiveWindow.from` / `.yearEnd` / `.days` override both) | lawyer | moves the deadline by two months and decides whether the August resit results and the promotion resolutions are inside the sealed package. It also settles D3-18: the retention clock still switches on 1 August in `blank-seed.js` |
| 3 | **What archival category is the `archives` row?** Category A, or a container for B5 (dziennik) and B50 (arkusze) content? | the old *protokoły rady pedagogicznej* class was retired and split; the package has its own class and is **never culled** until the question is answered | school + its Archiwum Państwowe | decides whether the collection grows for ever. Since the bytes moved to `files/` a growing collection no longer taxes the store, so the cost of waiting is disk, not latency |
| 4 | **Which adult-pupil mode ships?** `config.adultAccess` | `until-objection` — the guardian keeps access after the 18th birthday until the pupil objects | team (deck question 7), with the lawyer | UODO practice points the other way. Whichever ships, **D3-11** must be settled with it: a consent recorded under `until-objection` must not be read as an affirmative consent under `consent-required`. Nothing stamps the mode on the record today |
| 5 | **Does a court-restricted `info` parent still get trip notices and grade warnings?** | **no** — `D.GUARDIAN_INFO_KINDS` does not carry `trip` or `warning`, and the tests pin that | team, per notification kind | a parent stripped of authority may still have to be told about a trip, and the school may want a record that the *zawiadomienie o zagrożeniu* went to both parents. Moving either kind onto the `info` list is one line; which way it should go is policy, not a bug fix |
| 6 | **Who may give the recording consent?** | only a guardian in full standing; a deprived parent can neither give nor refuse it, and the other parent's consent suffices | team + lawyer | the asymmetry is deliberate and should be said out loud, because "cannot refuse" is the surprising half |
| 7 | **The 13 documentation classes still marked `verified: false`.** Every school's JRWA is its own, approved by its own Archiwum Państwowe | the table admits what it has not verified: `verified: false` on all 13 archival classes, a warning on the admin card, and a class the triage could not confirm must be named explicitly to enter a proposal | each pilot school, against its own JRWA | `docs/RETENTION.md` § 7 is the checklist, in the order it should be worked: dziennik (B5 or B10?), księga uczniów (A or B50?), dokumentacja PPP, rejestr wypadków, arkusze ocen, the § 22 package, księga ewidencji, finance, library, medical, and the pedagogical-council minutes the program does not keep at all |
| 8 | **Coverage policy for the collections that are not statutory documentation** | every array now has a class or is reported as `uncovered`, so the omission cannot be invisible again | DPO + team | three positions are defensible (classify everything · declare the module collections operational, Bc · declare that retention covers only statutory documentation and say so). What is not defensible is silence, and that part is closed |
| 9 | **Does push ship in the pilot at all?** | off by default; when it is switched on the DPA names the US sub-processor and asks for the chapter-V basis | product + DPO | with push off, the "no third-country transfer" sentence is simply true and the whole lock-screen class of finding is moot. With it on, the school acquires a sub-processor and signs a different document |
| 10 | **Does a pupil's identity change, or does the pupil?** `s.id` is a name slug and the login derives from the name | a mid-year PESEL and a court-ordered surname change are both routes now, and the name change keeps the previous name, the basis and the register number — but the id and the login still carry the old surname | team | either ids and logins stop deriving from the name, or every name change stays a documented, audited, mirrored operation. Today it is the second, deliberately |
| 11 | **Does a re-issued certificate overwrite or version?** | `POST /api/homeroom/report-cards` still updates the `documents` row in place | records decision before it is a code change | a school must be able to say what it issued, to whom and when; a duplicate is a separate document with its own number |
| 12 | **Strict or lenient imports?** | both, undocumented, in one endpoint: CSV/JSON rejects the whole file on one bad row, aSc/Optivum drop the row | team | picking one model closes D3-50, D3-52 and D3-54 together and gives `docs/IMPORT.md` one story to tell |
| 13 | **What does the school do about the after-school pickup list?** | free-text `{name, relation}` rows with no link to a guardian account, so a court restriction cannot reach the one place it matters physically | team | linking it turns a paper authorisation into a system object, which may be more than the school wants; the alternative is a printed warning on the care screen (D3-12) |
| 14 | **Should the registrar alone be able to record an adult pupil's consent?** (S3-17) | registrar, admin or principal, on a free-text reason; the pupil is notified and can revoke it themselves | team + DPO | the consent belongs to the adult pupil. A pending state the pupil accepts, or at least a structured document reference and a crisis-level notification, is the fix — but it is a workflow decision |

## 6. One red test — `[3.9.1]`

`node --test tests/` is **511 pass, 1 fail** today, and `node scripts/checklist-status.js` reports
**144/145** because of it. The failure is not a round-3 finding and not a defect in the app:

```
not ok - [3.9.1] każdy ekran ma jeden nagłówek h1 i etykiety ARIA; wydruk serwera ma nagłówek h1
  error: 'powłoka renderuje odnośnik „Przejdź do treści"'
```

`tests/39-nonfunctional.test.js:65` is `assert.match(shell, /E\.SkipLink/)` — a **source grep** over
`public/app/shell.js`. Closing U3-29 removed the duplicated skip link from `App`, leaving the one
`E.TopBar` renders from the bundle, which is exactly what the finding asked for. The app is right and
the assertion is stale.

The file belongs to F6. The smallest honest fix is to stop grepping: `loadClient()` already exists and
the round-2 work turned the other source greps in this file into behaviour, so assert that the rendered
shell contains **exactly one** element whose accessible name is „Przejdź do treści" / "Skip to content"
and that its `href` resolves to an element with that id. A one-line alternative that keeps the grep
honest is to look for the link in the bundle's `TopBar` instead of in `shell.js`.

## 7. How to re-run everything on this page

```bash
cd prototype
npm test                                  # node --test tests/ — 511/512 today, see § 5
node scripts/checklist-status.js          # 144/145 while [3.9.1] is red
npm run pilot                             # 39 kroków · 288 inwariantów · 575 żądań · 0 naruszeń
npm run smoke                             # every screen, both languages, headless Chromium
node --test tests/57-guardian-paths.test.js tests/58-public-surface.test.js \
             tests/59-erasure.test.js tests/60-onboarding.test.js   # the four files this round added
```

The reviewers' own repro scripts are unchanged and still run against the fixed tree — they are the
quickest way to see a finding not come back: `docs/review/round3/repro/` (`s3-*.js` for security,
`reliability/` for the fixture and the crash log, `operations/` for the onboarding walk,
`usability/` for the screenshots, axe pass and keyboard walks).
