# Round 3 — test honesty, regressions and flakiness

Lens: **are the tests added on 23.09.2026 evidence, or decoration?** Scope: `tests/51-timetable-import.test.js`,
`52-archive.test.js`, `53-guardian-status.test.js`, `54-compliance.test.js`, `55-retention.test.js`,
`56-register-sio.test.js`, the additions in `36-student.test.js`, `44-setup.test.js` and `48-push.test.js`
— **85 tests**. Read against `CONTRIBUTING.md`, `scripts/checklist-status.js`, `tests/helpers.js` and the
two round-2 reports (`docs/review/test-honesty.md`, `docs/review/regressions.md`); nothing those closed is
re-opened here.

Method: every test read against the claim in its own name and against the story id it carries, then the
suite re-run whole, in reverse file order, per file, and **once per test** with `--test-name-pattern`;
then the flake hunted with CPU load and a purpose-built repro. Repro scripts:
`docs/review/round3/repro/`. Nothing outside `docs/review/round3/` was edited — the fixes in §4 are diffs,
not commits.

**Short answer.** The new tests are markedly better than the round-2 average: 78 of 85 reach the behaviour
their name claims, through real routes, on real files, against numbers that can be derived from the input
rather than copied from the output. The suite is clean whole, reversed, per file and per test — **0
failures in 118 single-test runs**. Three things are wrong and none of them is "the test does not test
anything": **12 parser and regression tests carry a user-story id they do not prove** (§2), **one test is a source grep**
(§1, `[r4.12]`), and **the flake is a defect in the harness, not in the machine** (§4) — reproduced
deterministically, and reproduced again in six parallel suites, where `[setup.4]` and `[setup.6]` failed
**6 times out of 6** while not one test in the nine files under review failed even once. The most serious
finding is not in the tests at all: **`POST /api/privacy/forget` deletes exactly the documentation classes
`tests/55-retention.test.js` proves are never deleted** (§5, hole H-1).

| | |
| --- | ---: |
| tests reviewed | 85 |
| solid | **78** |
| partial | **6** |
| weak | **1** |
| not really tested | 0 |
| story tags recommended to change | **13** |

---

## 1. Verdict per new test

Legend, unchanged from round 2: **solid** — the test exercises what its name claims, through the surface a
caller really uses. **partial** — the mechanism is genuinely tested but a named part of the claim is not
reached. **weak** — the test passes without demonstrating the thing it names.

"tag" is the story id the test carries today; §2 says which should change.

### `tests/51-timetable-import.test.js` — 16 tests, all tagged `[3.5.5]`

| # | name (shortened) | tag | verdict | why |
| ---: | --- | --- | --- | --- |
| 1 | dekodery bez npm-a: windows-1250, BOM, `<meta charset>`, deklaracja XML | `[3.5.5]` | solid | Real `textdecode` over real fixture bytes; `0xB3 → ł`, `0x8C → Ś` are facts about cp1250, not about our code. BOM/`<meta>`/XML-declaration precedence each asserted separately. **Tag wrong** (§2). |
| 2 | parser CSV z cudzysłowami: średnik w polu, eksport UONET+ | `[3.5.5]` | solid | RFC 4180 cases written out by hand (CRLF, doubled quote, separator inside a field, embedded newline) plus the real nabór/UONET fixtures. 22 header columns and 60 rows are verifiable with `wc -l` and a count of the header's separators. **Tag wrong.** |
| 3 | aSc `plan-sp12.xml` → pary A/B, podwójne, dwóch nauczycieli, brak sali, grupy | `[3.5.5]` | solid | Every pinned number is independently derivable from the file: `grep -c '<card '` = 264, `<lesson ` = 108, `<classroom ` = 14, `<teacher ` = 20, `<class ` = 8, `periodspercard="2"` = 8, and `rows = 264 + 8 = 272`. Not copied from the parser. |
| 4 | aSc `plan-edge.xml` — BOM, CRLF, brakująca sala, zdublowana karta | `[3.5.5]` | solid | Asserts the fixture really has the BOM bytes and CRLF before using it, then proves the edge file and the clean file describe the **same plan** by comparing sorted row keys — a much stronger oracle than a row count. |
| 5 | aSc eksport „2008” (bez `daysdefs`/`weeksdefs`, `day=`, `durationperiods`) | `[3.5.5]` | solid | The 2008 dialect's four differences are each asserted; `week === null` everywhere is the right answer for a file with no `<weeksdefs>`. |
| 6 | aSc `plan-extra.xml` — międzyoddziałowe, godzina 0 a plan dzwonków | `[3.5.5]` | solid | Parser **and** `POST /api/admin/timetable/import`; the "hour 0" rule is proven in both directions (rejected without the bell, accepted after `withConfig` adds it, rejected again) and the message is asserted to name the remedy. |
| 7 | Optivum cp1250 vs UTF-8, strony brzegowe | `[3.5.5]` | solid | Two encodings of the same publication must produce identical sorted row keys; `rowspan="2"` expansion and an empty Friday column asserted on the edge publication. |
| 8 | Optivum kontrola krzyżowa — dokładnie dwie rozbieżności | `[3.5.5]` | solid | Both mismatches pinned by class/day/period/subject and by *which page said what*, plus the rule that the class page wins and the teacher page never adds a row. Ends through the route. |
| 9 | Optivum znaczniki tygodnia `-T1`/`-T2` kontra podział `-1/2` | `[3.5.5]` | solid | `splitGroupSuffix` truth table for the ambiguous suffix in both contexts, the legend read from `<p class="opis">` *after* `</table>`, and an explicit assertion that we do not simultaneously warn "no fortnightly cycle". |
| 10 | katalog z kilkoma publikacjami naraz | `[3.5.5]` | solid | Proves the importer picks one publication (112 rows, not a five-way merge) and names the four it skipped. |
| 11 | konflikty planu liczą tydzień i grupę | `[3.5.5]` | **partial** | Six of the seven rules are asserted on `findConflicts` called directly. That is the real production function (`admin.js:652`), so it is not a stub — but the route's own gate (`force`, and `findStoredConflicts` for `merge:true`, OPS-21) is only touched by the single happy-path call at the end. |
| 12 | import dwufazowy: propozycja, zapis bez mapowania = 400 | `[3.5.5]` | solid | Whole route. Proves the dry run writes nothing, that `SB` is disambiguated by full name and `ŻM` is left unmatched, that room `3` does not snap onto room `30`, and that the refusal writes no partial plan. |
| 13 | import z mapowaniem zapisuje plan; lekcje wg cyklu A/B | `[3.5.5]` | solid | Route → store → `POST /api/setup/lessons/generate` → the generated lessons checked against `TTL.weekOf` for every date, and A and B proven never to fall on the same day. Also pins that an ordinary row still has **no** `week`/`groupLabel` key. |
| 14 | Optivum: import publikacji przez trasę | `[3.5.5]` | solid | Soft subject matching (`j.polski` ↔ `Język polski`), class remapping, save, and the `source.tool` stamp on every stored row. |
| 15 | zasiew demo bez zmian | `[3.5.5]` | solid | The regression this round most needed: regenerating from the demo timetable yields exactly the number of lessons the seed produced, and the old row shape is still what is on disk. |
| 16 | stary CSV i JSON jak przedtem; `week`/`groupLabel` opcjonalne | `[3.5.5]` | solid | Back-compat through the route, including that `tt_7b_1_1` keeps its old id and that a quoted field with a `;` inside no longer splits the row. |

### `tests/52-archive.test.js` — 9 tests, no story id

| # | name | tag | verdict | why |
| ---: | --- | --- | --- | --- |
| 1 | the zip writer round-trips — stored entries, real CRC-32, UTF-8 names | — | solid | The ZIP is read back by a reader written from the spec inside the test (EOCD, central directory, local headers), CRC recomputed from the bytes read, and `crc32('hello') === 0x3610a686` is a published constant. DOS date/time decoded field by field. |
| 2 | the package builds and parses back, manifest hashes match | — | solid | Hashes recomputed with `node:crypto` from the bytes pulled out of the ZIP; collection counts compared with `S.db.col(...).length`; the XML inside the package compared with what `GET …/xml` serves; the seal verified with the school's public key. |
| 3 | the downloaded file is exactly the one the record describes, twice over | — | solid | Same sha256 from the record, from the download, from a second download and from the listing. |
| 4 | the deadline is the year end plus 10 days, status turns over on the boundary | — | **partial** | The arithmetic is right and externally checkable (23.10.2026 → 05.07.2027 is 255 days) and both sides of the boundary are tested. But it asserts `status === 'package-ready'`, which the two signature tests below would turn into `'signed'`. It survives only because node runs top-level tests in declaration order — the file's header claims `fixtures()` makes it order-independent, and for this one test that is not how it is achieved. |
| 5 | the principal is reminded on day 3 and day 8, once each | — | solid | Clears its own rows first, then proves silence on day 2, one row on day 3 (with the `dedupeKey`, `push:false`, the deadline in the text and the link), that a second visit to the screen adds nothing, one more on day 8, and different wording past the deadline. The "through `D.notify`" half is carried by the dedupe behaviour, which is `D.notify`'s and nothing else's. |
| 6 | a XAdES-like signature whose DigestValue is ours verifies as digest-matched | — | solid | The digest in the signature is computed in the test from the real `manifest.sha256` bytes; the answer names *which* file matched; `/verify` agrees; the signature file downloads back byte for byte; the audit row carries the verdict. Repeated for a signature over the whole ZIP. |
| 7 | an opaque signature is stored and said to be unverified, never called valid | — | solid | A PAdES-shaped blob and an alien XML with somebody else's digest both come back `stored-unverified`, and `/verify` says the same. |
| 8 | the signature upload goes through the shared validator; kind is a closed list | — | solid | `bad_signature_kind`, `bad_signed_file`, `bad_data_url`, `empty_file`, `content_mismatch` (415, name says PDF, bytes say XML) and `attachment_too_large` (413) — the S-13 gate, not a private copy. |
| 9 | only the principal may build, download or sign | — | solid | Three roles × four routes, plus the DPO's read-only `/verify`, plus 404 on an unknown id. |

### `tests/53-guardian-status.test.js` — 10 tests, no story id

| # | name | tag | verdict | why |
| ---: | --- | --- | --- | --- |
| 1 | zakres wynika ze statusu władzy rodzicielskiej | — | solid | The four status → scope pairs come from `docs/GUARDIANS.md`, not from the code; each is asserted in the API answer, in the stored row and in `D.guardianStatusScope`, and an explicit override is shown to keep `derivedScope` visible beside it. |
| 2 | pozbawienie władzy bez postanowienia sądu jest odrzucane | — | solid | Six refusals with distinct codes (missing basis, a declaration instead of a court order, a blank reference, two scope conflicts, an unknown status) and a final assertion that **nothing** was written. |
| 3 | „court-restricted” + `none` zamyka oceny i frekwencję w prawdziwym API | — | solid | Real `403 { deny:'guardian_scope', scope:'none' }` on `/api/parent/grades` and `/attendance`, the child disappears from `/api/parent/children`, the *other* guardian is unaffected, and `info` is shown to keep attendance and drop grades. |
| 4 | zmiana statusu i zakresu zostawia wiersz audytu | — | solid | Two separate audit actions with before/after, the legal basis kind/reference/date and the reason. |
| 5 | wpis bez pola „status” = pełna władza | — | solid | Pre-R3 row shapes written straight into the store, then read back **through the API** — including the old `accessScope:'info'` row still behaving as it did. |
| 6 | tryb „do sprzeciwu” zostawia wgląd po 18. urodzinach | — | solid | `D.adultFrom` pinned, then the guardian's real read on the birthday itself. |
| 7 | tryb „zgoda wymagana” odcina w dniu 18. urodzin, wraca po zgodzie | — | solid | Day before / day of, the refusal carrying `adultAccess` and `adultSince`, `D.notifyParentsOf` returning `[]`, the consent recorded by the registrar, the guardian's read restored, the audit row, and withdrawal closing it again. |
| 8 | sprzeciw działa tak samo w obu trybach | — | solid | The pupil's own objection, then both modes, then withdrawal. |
| 9 | uczeń, opiekun i wychowawca czytają tę samą regułę i tę samą datę | — | solid | Three different session/route shapes must agree on mode, state and date; a non-homeroom teacher gets 403. |
| 10 | zapisu zgody nie da się zrobić uczniowi niepełnoletniemu | — | solid | `not_adult`, `no_reason`, `consent_missing`. |

All ten clean up in `finally`, which is why they pass alone (§3).

### `tests/54-compliance.test.js` — 12 tests, tagged `[r4.1]`–`[r4.12]` (not story ids, deliberately)

| # | name | tag | verdict | why |
| ---: | --- | --- | --- | --- |
| 1 | trzy dokumenty × dwa języki × Markdown i wydruk | `[r4.1]` | solid | Also enforces the `[3.9.1]` print rules on the generated HTML: exactly one `h1`, every `<table>` with a `<caption>`, every `<th>` with `scope`. |
| 2 | żadnego „undefined”, „NaN”, „[object Object]” | `[r4.2]` | **partial** | A negative smoke check. It catches a template hole but cannot fail for a document that is populated and wrong, which is what the rest of the file is for. Worth keeping, not worth counting as evidence. |
| 3 | prawdziwe nazwy zbiorów i prawdziwe liczby wierszy | `[r4.3]` | solid | The oracle is `Object.keys(S.db.data)` and `S.db.col(name).length` — the store, not the module that wrote the document. Every array collection must appear. |
| 4 | zbiory art. 9 i macierz „rola → dane” z prawdziwej bramy | `[r4.4]` | solid | The art. 9 list is checked against five hard-coded collection names, and the matrix rows against hard-coded deny codes (`record_scope`, `not_teaching_pupil`, `guardian_scope`) that `roleMatrix()` obtains by really probing `D.assertMayReadPupilRecord`. Only the `dpo / iod / N` endpoint-count cell is checked against the module's own `facts` — self-referential, and the one line here worth ignoring. |
| 5 | retencja, fakty kryptograficzne, transport, wynik skanu śledzenia | `[r4.5]` | solid | `scrypt`, `AES-256-GCM+RSA-OAEP`, `RSA-SHA256`, `default-src` and the session timeout are hard-coded or read from `config`; the tracker scan is the real scanner over `public/`. (`pl.includes(facts.trackers.verdict)` is the one self-referential line.) |
| 6 | deklaracja dostępności — struktura ustawowa i kryteria niezbadane | `[r4.6]` | solid | Statutory phrases in both languages, school name and address from `config`, and — the part that matters — every criterion on the *untested* list must appear in the document. See hole H-4 for what `facts.a11y` does not check. |
| 7 | umowa powierzenia rozdziela program od hostującego | `[r4.7]` | solid | All eight letters of art. 28 ust. 3, the concrete route and script the obligations point at, and the parties from `config`. |
| 8 | pola do uzupełnienia są oznaczone | `[r4.8]` | **partial** | Counts `[[ … ]]` markers (`>= 3`) and checks the English document carries no Polish marker. It never says *which* fields must be marked; the three it names are matched with a case-insensitive regex over the whole document, so "hosting" would pass on any mention. |
| 9 | konto bez uprawnień nie dostaje żadnego z dokumentów | `[r4.9]` | solid | Seven roles × four routes at 403, three roles at 200, and the statutory public reach of the accessibility declaration without a session while DPIA stays 401. |
| 10 | nieznana postać dokumentu to 400 | `[r4.10]` | solid | `bad_format`, the JSON shape, the unknown-locale fallback and the `Content-Disposition` of `download=1`. |
| 11 | moduł „compliance” da się wyłączyć | `[r4.11]` | solid | Five routes at `404 module_disabled` and the client's own module registry (`/app/screens.js`) carrying `"compliance":false`, then restored. |
| 12 | ekran „Zgodność i dostępność” jest zarejestrowany dla IOD/admina/dyrekcji | `[r4.12]` | **weak** | `readFileSync` + `assert.match` on `public/app/screens/compliance.js`. CONTRIBUTING says "client behaviour is run, not grepped"; `loadClient()` exists and `56-register-sio.test.js` uses it two files away. A renamed prop, a screen registered twice or a role list that the shell filters differently all pass this test. |

### `tests/55-retention.test.js` — 11 tests, no story id

| # | name | tag | verdict | why |
| ---: | --- | --- | --- | --- |
| 1 | zegar rusza 1 stycznia po roku szkolnym | — | solid | Six dates across the calendar-year and the summer boundary, all derivable from the rule in `docs/RETENTION.md`; B50 and the 20-year medical class checked from the same entry. Helper-level (`RET.retentionDeadline`) — see hole H-5. |
| 2 | kategoria A i księga uczniów bez terminu; PPP czeka na odejście ucznia | — | solid | `null` for category A and for the register, and the PPP clock proven to start on a hand-made db whose pupil has a departure date. |
| 3 | klasy operacyjne liczą okres wprost od wpisu | — | solid | Also proves a session counts from `lastActivity`, not from `createdAt`. |
| 4 | `GET /api/admin/retention` niesie klasy i flagę weryfikacji | — | solid | Category, clock, years per class, and `verified:false` on the six JRWA classes — the test asserts the system admits what it has not verified. |
| 5 | `GET …/report` — wiersz na klasę z liczbą po terminie | — | solid | Deletes nothing, says so, and carries the JRWA warning. |
| 6 | propozycja: kategoria A i księga uczniów nigdy na liście | — | solid | Own server with planted 2010 rows; the proposal is idempotent (two reads, one row). |
| 7 | zatwierdzenie wymaga sygnatury zgody Archiwum Państwowego | — | solid | Blank and missing reference refused with nothing changed; approval audited with the reference; re-approval 409; unknown id 404; a teacher 403. |
| 8 | uruchomienie bez zatwierdzenia sprząta tylko klasy operacyjne | — | solid | The three planted audit rows go, the B5 attendance and the category-A lock stay, and a run against an unapproved proposal is `403 approval_required` that deletes nothing. |
| 9 | wykonanie zatwierdzonego brakowania | — | solid | Five rows deleted, the protocol and audit row carry the counts and the consent reference, the proposal becomes `executed`, and a replay is 409. |
| 10 | stary kształt `config.retention` migruje przy odczycie | — | solid | Flat map, list without categories, and key absent — three legacy shapes, each checked for the migrated result and for the live config knobs winning. |
| 11 | dyrektor widzi propozycję, ale nie uruchamia zadania | — | solid | Nothing overdue in the seed, and the principal is 403 on `run`. |

### `tests/56-register-sio.test.js` — 12 tests, no story id

| # | name | tag | verdict | why |
| ---: | --- | --- | --- | --- |
| 1 | uczeń bez PESEL wchodzi do księgi z rodzajem i numerem dokumentu | — | solid | Seven steps through `POST /api/registry/students` and `PATCH …/flags`: no document, no country, unknown type (with the allowed list), the residence card accepted, the register row and flags, a correction with an audit before/after, a too-short number, the refusal to wipe the last identity, and a bad PESEL still failing the checksum. |
| 2 | odpis arkusza ocen i pakiet SIO pokazują dokument | — | solid | The transcript and the XML both asserted to carry `paszport N1234567 (VN)` and never `undefined`, and the package is checked for well-formedness. |
| 3 | import listy z naboru mapuje trzech uczniów bez PESEL | — | solid | The three documents pinned by type/number/country against a fixture whose contents can be read; heuristic splits flagged `review` without blocking; missing classes reported before any write. |
| 4 | bliźniak UTF-8 i plik windows-1250 dają to samo mapowanie | — | solid | The encoding invariant stated as an equality between two parses. |
| 5 | walidacja SIO: brakujące pola, powtórzony PESEL, `not-validated-against-cie-xsd` | — | solid | The clean seed passes, the five named checks are listed, the answer refuses to claim XSD validation, and four planted defects each raise their own code with the right level. Restores the pupils in `finally`. |
| 6 | skaner składni XML | — | solid | Six error classes with line numbers, plus the real archive fixture passing. |
| 7 | import frekwencji odmawia przy kodzie „ns” | — | solid | Refusal names the code and counts its rows, nothing is written, an explicit mapping passes, and a deliberate skip is recorded as a decision with an audit row. |
| 8 | `D.mapAttendanceCode` niczego nie zgaduje | — | solid | Seven cases including `target_unknown` and the statistics still reporting the unknown status instead of lowering the percentage. |
| 9 | pismo o charakterze decyzji wysyła wyłącznie dyrektor | — | solid | Teacher 403 with `formal_requires_principal`, the principal's message carrying the banner, the stored flag, the `formal_notice_sent` audit row, and the recipient reading the same marker in the detail view and the inbox. |
| 10 | zwykła wiadomość zostaje bez zmian | — | solid | `formal:false`, no KPA text anywhere, a parent's `kind:'decision'` downgraded to `message`, and the mailbox policy telling the client who may send what. |
| 11 | baner „to nie jest doręczenie” ma tę samą treść po polsku i po angielsku | — | solid | Runs the real `i18n.js` in the `node:vm` sandbox, asserts both exact strings, asserts server and client constants are equal, and asserts the two languages differ. |
| 12 | ekran sekretariatu nazywa dokument tożsamości w obu językach | — | **partial** | The dictionary is real and two exact strings are pinned, but the screen file is only evaluated, never rendered: this proves keys exist, not that the registrar's form uses them. `loadClient().render()` is one line away. |

### Additions in `tests/36-student.test.js` — 2 tests

| name | tag | verdict | why |
| --- | --- | --- | --- |
| tryb „zgoda wymagana”: opiekun czeka na zgodę, cofnięcie znowu zamyka wgląd | `[3.6.12]` | solid | Real refusals with `scope:'none'`, `D.guardianScope`, the consent through `/api/student/parent-access`, the `parent_access_restored` audit row, and withdrawal. Cleans up in `finally`. **Tag wrong** (§2): this is consent, not objection. |
| tryb „do sprzeciwu” zostaje bez zmian | `[3.6.12]` | solid | This one *is* story 3.6.12 — access until the pupil objects, then blocked, then restored. |

### Additions in `tests/44-setup.test.js` — 4 tests

| name | tag | verdict | why |
| --- | --- | --- | --- |
| `[setup.4]` import 400 uczniów | `[setup.4]` | **partial** | The substance is strong: the dry run writes nothing, three errors each carry a line number, the class typo is a warning, register numbers have no gaps, roll numbers are unique per class, no PESEL repeats, siblings merge onto one parent account by e-mail, parent accounts have no password hash, and a re-upload creates nobody. But the name promises *"czas poniżej sekundy"* and the assertion is `took < 5000` — five times the claim, on a shared machine, exactly the wall-clock weakness round 2 wrote up. Either measure what you claim or drop the claim from the name. |
| `[setup.5]` pomyłkowy import da się cofnąć | `[setup.5]` | solid | Undo removes pupils, parent accounts, registration codes **and** the empty classes it created, is audited, refuses a second time, and is blocked with `import_in_use` once a grade exists — with a final assertion that the block deleted nothing. |
| `[setup.6]` ustawowe dni wolne | `[setup.6]` | solid | Independence Day, Easter Monday computed from Easter, Corpus Christi, both school breaks; then a real year of generated lessons with six holidays empty and the day after a holiday normal. |
| `[setup.7]` data przyjęcia z pliku / początek roku | `[setup.7]` | solid | Opens by asserting the two dates differ, *so the test can fail*; then the format, the dry run, the write, and `enrolledOn()` agreeing on both pupils. Exemplary. |

All four reach the server through the file's **private** `fetch` client, which is why they are the ones that flake (§4).

### Additions in `tests/48-push.test.js` — 9 tests (R6 payload + service worker)

| name | verdict | why |
| --- | --- | --- |
| the minimal payload carries no pupil name and no text | solid | The payload is **decrypted with the browser's own keys** by a decryptor written from RFC 8188/8291 inside the test, then checked key by key and searched for seven leak strings — and the ciphertext lengths of two different kinds compared, so size itself leaks nothing. |
| `config.push.payload = neutral` restores the pre-R6 payload | solid | Both directions plus a refused unknown mode. |
| the render endpoint answers in the right language and never for another account | solid | pl/en titles, the neutral message body in both, 403 for somebody else's id with nothing about it in the body, 404 for an unknown id, and the notification still unread. |
| jitterSeconds delays an ordinary delivery and never a crisis alert | solid | The crisis goes out immediately, the ordinary one is queued with `notBefore` inside the window, and a forced flush then delivers it. (What is not shown: the pump releasing it by itself when the time comes — hole H-6.) |
| on receipt the SW fetches the text from the school and shows it | solid | The real `public/sw.js` in a `node:vm` worker stub: the request URL, `credentials:'include'`, `cache:'no-store'`, every `showNotification` option, and the click opening the right hash. |
| when the school cannot be reached the worker still shows the neutral title | solid | Offline, 401 and 403 each produce a notification; 401/403 set `data.login` and the click lands on `#/?login=1`. The 401 fallback the brief asked about is covered. |
| the worker asks for and falls back to the language the app last ran in | solid | A `message` event sets the locale, the next push asks for `?locale=en` and falls back to the English table. |
| the worker ships a neutral fallback title for every kind, in both languages | solid | `PUSH_FALLBACK` read out of the worker's own vm context and compared with `N.PUSH_KINDS` and `N.PUSH_TITLES.pl` — the two-table agreement CONTRIBUTING demands. |
| a neutral-mode payload is shown as it comes, a broken one still shows something | solid | Includes the off-site link being rewritten to `/` and an existing tab being navigated instead of a second one opened. |

---

## 2. Story mapping — 13 tags to change

`scripts/checklist-status.js` counts a story as proven when **some** test carrying its id reported `ok`,
with no `# SKIP`/`# TODO`, and no file declaring that id failed. Two consequences matter here.

**Nothing is falsely proven.** For both ids reused this round the original test still exists and still
passes: `[3.5.5]` in `tests/35-registry.test.js` (five tests) and `[3.6.12]` in
`tests/36-student.test.js` (the objection test). No story in `../checklist.md` is now green *only* because
of a test that does not test it. Round 2's verdicts for `3.5.5`, `3.5.1`, `3.5.3`, `3.5.15` and `3.6.12`
(all "solid") stand.

**But the evidence is inflated and the tick is now hostage to unrelated code.** 21 tests now carry
`[3.5.5]`, of which **16 are new**. `[3.5.5]` is *"import a timetable grid from external scheduling
software, ensuring group splits, room allocations and teacher assignments are transferred correctly"*.
A windows-1250 byte table and an RFC 4180 quoting parser are not that story, and a conflict-detector unit
test is not that story either — yet a regression in any of them now marks story 3.5.5 as **without
evidence** in `npm run checklist`, because `reject()` wins over `passing` for the whole id.

| where | today | recommended | why |
| --- | --- | --- | --- |
| `51` #1 dekodery cp1250/BOM/meta | `[3.5.5]` | `[R1.1]` | a character-set decoder; no timetable in sight |
| `51` #2 parser CSV / RFC 4180 | `[3.5.5]` | `[R1.2]` | a CSV parser, shared with the register importer |
| `51` #3–#5, #7 aSc and Optivum parsers | `[3.5.5]` | `[R1.3]`–`[R1.6]` | file-format readers; the story is about what reaches the school's plan |
| `51` #8–#10 cross-check, week markers, several publications | `[3.5.5]` | `[R1.7]`–`[R1.9]` | parser behaviour; each ends with one route assertion that could stay tagged |
| `51` #11 `findConflicts` | `[3.5.5]` | `[R1.10]` | a scheduling-conflict unit test |
| `51` #15 zasiew demo bez zmian | `[3.5.5]` | `[R1.11]` | a regression guard on lesson generation, not on import |
| `51` #16 stary CSV/JSON | `[3.5.5]` | `[R1.12]` | back-compat guard |
| `36` „tryb zgoda wymagana” | `[3.6.12]` | `[R3.1]` | story 3.6.12 is the pupil's **objection**; consent-required is the opposite switch, new in R3 |

That is **12 tags in `51` + 1 in `36` = 13**. Keep `[3.5.5]` on `51` #6, #12, #13, #14 — the four that go
through `POST /api/admin/timetable/import` end to end and demonstrate groups, rooms and teachers arriving
in the school's own plan. That leaves story 3.5.5 with nine tests (five old, four new), all of which are
about the story.

The `[r4.N]` convention `54-compliance.test.js` already uses — and its comment saying *"the test names
deliberately carry no story id: this package adds no stories to the checklist"* — is the right pattern and
is what `[R1.N]`/`[R3.N]` copy. `52`, `53`, `55` and `56` already follow it and need no change.

**Two things are worth claiming and are not.** `56` #1–#2 are the passport/residence-card half of story
`3.5.1` ("recording PESEL **or passport details**") and the document half of `3.5.3` (the SIO package);
`55` is squarely story `3.5.15` (a retention policy with a legally required duration). Both stories are
already green from `35-registry.test.js`, so nothing is lost — but if anyone wants the checklist to point
at the strongest evidence, those are the tests.

**One cosmetic note.** `fileOfId` in `checklist-status.js` is built from `readdirSync`, which is not sorted,
so with two files declaring `3.5.5` the `(plik …)` annotation in the "bez dowodu" list is whichever the
filesystem returns last. It only affects that one label; the verdict itself is correct either way.

**Checked and sound:** the round-2 fix that rejects a story out of a red file *does* fire on this engine.
Node 18.19 prints a file-level `not ok N - /abs/path/x.test.js` line only for files that fail, which is why
a green run contains none. `docs/review/round3/repro/checklist-file-level-rule.js` builds a file whose
`after` hook throws and shows `3.1.1` correctly rejected with "plik … zakończył się błędem".

---

## 3. Order independence — clean, four ways

Machine: 6 cores, Node v18.19.1, shared with the other round-3 reviews; load average ~2.4 at the start of the baseline.

| run | command | result |
| --- | --- | --- |
| baseline | `node --test tests/` | **437 tests, 437 pass, 0 fail, 0 skipped, 0 todo** · 42.2 s |
| reverse file order | `node --test $(ls tests/*.test.js \| sort -r)` | **437 pass, 0 fail** · 45.6 s · zero `not ok` lines, same test count |
| new files only, reversed | `node --test $(ls tests/5*.test.js \| sort -r)` | **83 pass, 0 fail** |
| each new file alone | `node --test tests/NN-….test.js` | 51: 16/16 · 52: 9/9 · 53: 10/10 · 54: 12/12 · 55: 11/11 · 56: 12/12 · 36: 18/18 · 44: 7/7 · 48: 23/23 |
| **each new test alone** | `node docs/review/round3/repro/run-each-test-alone.js tests/51-… tests/56-… tests/36-… tests/44-… tests/48-…` | **118 tests run singly, 0 failures** |

Nothing fails, nothing changes count. The `fixtures()` discipline round 2 introduced has been applied
properly: every shared step in the new files (`richSchool`, `built`/`downloaded`, `registrar`, `documents`,
`admin`/`principal`, `pushOn`, `schoolCreated`) is a memoised builder, and every test that dirties shared
state undoes it in `finally` (`clearGuardians`, `clearAdultAccess`, `removeStudent`, the signature
subscription deletes in `48`, the pupil restore in `56` #5).

Two hygiene notes that the green runs do not surface:

* **`52` #4 is ordered, not independent** (see §1). It passes alone and in file order; it would fail if the
  signature tests were moved above it. Fix: assert `['package-ready', 'signed'].includes(ready.status)`, or
  build a dedicated package for this test.
* **`withConfig` cannot restore "key absent".** `before[k] = db.data.config[k]` records `undefined` for a
  key that did not exist, and the restore then leaves the key present with value `undefined`.
  `52` #8 does exactly this with `archiveSignatureMaxMB`, which is not in the seed config. Harmless today
  (`config.archiveSignatureMaxMB || 5`, and `JSON.stringify` drops it), but `/api/auth/session` hands the
  whole config to every client, so a future `'key' in config` or `Object.keys(config)` would read it.
  Two-line fix in §4.

---

## 4. The flake: it is `tests/helpers.js`, not the machine

`docs/review/regressions.md` §6 handed this over: `[setup.4]`, `[setup.6]`, `[3.3.8]` failing with
`fetch failed` on a loaded box, *"worth handing to whoever owns tests/helpers.js"*. Here is the diagnosis.

### 4.1 What actually happens

Node's HTTP server closes an idle keep-alive socket after `server.keepAliveTimeout`, **5000 ms by
default** — confirmed on this app: `docs/review/round3/repro/keepalive-race.js` prints
`server.keepAliveTimeout = 5000 ms` straight off `app.server`. undici, the engine behind global `fetch`,
keeps that socket in its pool. When a request is written into the socket in the same tick the server sends
its FIN, undici reports `ECONNRESET` or `UND_ERR_SOCKET` ("other side closed"), and `fetch` surfaces it as
`TypeError: fetch failed`.

**Reproduced deterministically, and the boundary is the whole story.**
`docs/review/round3/repro/keepalive-race.js` makes a request, spends the gap, makes another, 20 times.
`--block` spends the gap on *synchronous* work instead of an idle `await` — which is what a test does
between two requests. `--burners N` adds N CPU-bound processes.

| `server.keepAliveTimeout` | loop blocked for | extra CPU load | requests after the gap that failed |
| --- | ---: | --- | --- |
| 5000 ms (Node's default) | 5010 ms | none | **10 / 20** — every one `ECONNRESET` |
| 5000 ms | 5010 ms | 6 busy loops | **10 / 20** — every one `ECONNRESET` |
| 5000 ms | **4000 ms** (under the boundary) | none | **0 / 20** |
| **120000 ms** (the fix below) | 5010 ms | 6 busy loops | **0 / 20** |

An *idle* wait across the same boundary never fails — the same script with `setTimeout` instead of
`--block` gave 0/20 in all three configurations, with and without load. The failure needs the loop to be
**busy** when the keep-alive timer fires, so that the server's close and the client's next request are
handed to the same tick. **Load is not the cause; it is what makes the busy stretches long enough to cross
5 s.** That is why the suite is green on an idle box and red under six parallel copies, and why raising
the timeout (row 4) fixes it under load while lowering the gap (row 3) fixes it without load.


Three things make the tests that fail exactly the tests that fail:

1. **They hold the loop across the boundary while a socket to an already-used server sits in the pool.**
   `createApp({ blank: true })` alone is ~1.1 s of solid CPU, a 400-row import and a year of generated
   lessons are seconds more. `[setup.4]`, `[setup.5]` and `[setup.6]` each build their own school and spend
   several seconds there — and all the while the socket to the server `test.before` created is idle in the
   pool. `[setup.7]` is the next test to use that server, and it gets the stale socket: undici pools
   **per origin, not per client object**, so asking for a fresh `client()` changes nothing. `[3.9.10]` has
   the same shape with Chromium in the middle. Under six parallel suites every gap widens, and the
   starvation also delays undici's own `close` handler, so the dead socket lingers.
2. **`tests/44-setup.test.js` does not use the shared client.** It defines its own on bare `fetch`
   (line 5, and again inside `blankSchool()` at line 90) with **no retry at all** — the only new file that
   does. `tests/54-compliance.test.js` has one bare `fetch` for `/app/screens.js` in `[r4.11]`; every other
   new file goes through `tests/helpers.js`.
3. **The shared retry misses the shapes that actually occur.** The predicate is
   `/fetch failed|ECONNREFUSED|ECONNRESET/.test(String(e && (e.cause && e.cause.code || e.message)))`.
   The `||` means that as soon as undici sets a `cause.code`, `e.message` is never consulted — so
   `'fetch failed'` in that alternation is dead code, and `UND_ERR_SOCKET` ("other side closed", the other
   half of the reset race), `EPIPE` and `UND_ERR_CONNECT_TIMEOUT` are rethrown instead of retried.
   `UND_ERR_CONNECT_TIMEOUT` is the second shape `docs/review/regressions.md` §6 saw — *"the first fetch
   after `app.listen(0)` never connects"* — which is the accept queue not being drained while the loop is
   starved, and it too means the request was never read, so replaying it is safe.

**And in the suite itself, on demand.** `docs/review/round3/repro/stress.sh suite 6` — six whole suites at
once, load average 4.8 rising to 36 — reproduced the reported flake in every copy:

| copy | result | what failed |
| --- | --- | --- |
| 1, 2, 3, 6 | 434 pass, **3 fail** | `[setup.4]`, `[setup.6]`, and one of `[3.3.8]` / `shutdown: SIGTERM …` |
| 4, 5 | 435 pass, **2 fail** | `[setup.4]`, `[setup.6]` |

* **`[setup.4]` and `[setup.6]`: 6 out of 6 copies each, all `TypeError: fetch failed`.** Twelve failures,
  and every stack frame is the same: `async call (tests/44-setup.test.js:90:50)` — the **private
  bare-`fetch` client inside `blankSchool()`**, exactly the one identified above. `[setup.4]` dies at
  line 103, the students import, which is the request that follows the 30-teacher import (30 scrypt
  hashes) and the synchronous build of a 412-row CSV: the longest busy stretch in the file, and the
  boundary crossing the repro above models.
* **Not one test in the nine files under review failed** — 51, 52, 53, 54, 55, 56, 36 and 48 were green in
  all six copies. They go through `tests/helpers.js`, whose retry catches the `ECONNRESET` half. That is
  the cleanest possible confirmation that the harness, not the new tests, is what needs fixing.
* **`[3.3.8]` is a different flake, and the fix below does not touch it.** 3 of 6 copies, and never with
  `fetch failed`: *"audyt kompletności zajął 621 ms"* (also 546 ms and 532 ms) against a hard-coded
  `< 500 ms` budget. A wall-clock budget on a shared machine is not evidence of an index being present —
  round 2 made exactly this point about `[3.9.7]` and `[3.1.1]`. Same class of defect as `[setup.4]`'s
  `took < 5000` (§1): assert the shape of the work (one indexed lookup, not a scan) or scale the budget to
  a measured baseline.
* One copy failed `shutdown: SIGTERM flushes a debounced write` on *"the write must still be pending"* —
  under load the debounce fired before the assertion could look. Another wall-clock assumption.

Three runs of `tests/44-setup.test.js` alone under six busy loops (`stress.sh setup 6`) were, by contrast,
all green: a single file crosses the boundary only a handful of times and each crossing is roughly a coin
flip. A green stress run is not a refutation — the six-suite run is the condition to use.

**A second, worse failure mode: the suite can hang, not fail.** While the six copies ran, one of them
stopped at test 315 and stayed there. `tests/46-reliability.test.js` `shutdown: SIGTERM flushes a
debounced write` spawns a child, sends `SIGTERM` and then waits with **no bound**:
`await new Promise((resolve) => p.on('exit', resolve))`. Under load the child did not act on that first
signal; a second `SIGTERM` from outside killed it instantly and the copy finished at once (434/3). This
box was carrying **three** such hangs, two of them from earlier sessions — `node --test tests/` processes
6 543 s and 7 213 s old, each holding a `/tmp/edmat-sigterm-*/child.js` that had been alive for nearly
seven hours. In CI that is a job timeout with no verdict at all, which is worse than a red test. Whatever
is swallowing the first signal (a `store.js` shutdown-handler race or a Node signal race — out of scope
here) the test must not wait forever:

```diff
--- a/tests/46-reliability.test.js                # ~line 272, and the same shape at ~line 770
-  p.kill('SIGTERM');
-  await new Promise((resolve) => p.on('exit', resolve));
+  p.kill('SIGTERM');
+  /* Never wait unbounded on another process: a missed signal must become a named failure, not a hung
+     `node --test`. Three such hangs were live on the review machine, the oldest nearly 7 h old. */
+  const exited = await new Promise((resolve) => {
+    const t = setTimeout(() => resolve(false), 10000);
+    p.on('exit', () => { clearTimeout(t); resolve(true); });
+  });
+  if (!exited) { p.kill('SIGKILL'); assert.fail('dziecko nie zareagowało na SIGTERM w ciągu 10 s — zapis mógł nie zostać zrzucony'); }
```

`[3.9.10]` is a different animal and must not be fixed the same way: its Chromium sub-test shells out
through `execFile` with `timeout: 60000` and `--virtual-time-budget=12000`. Under load Chromium is killed
by that timeout, `domOf` returns `''`, and the failure reads
`assert.match(dom, /app-title/)` — *"Chromium wyrenderował ekran /uczen"*, which blames the app for a
starved browser. `inChromium` fails a step later with *"the page never reported back (dump 0 bytes)"*.

### 4.2 The fix

Four more diffs (the fifth, the bounded `SIGTERM` wait, is in §4.1), in order of how much they buy. The
first removes the race instead of papering over it; the second stops a real failure being mistaken for a
flake **and** stops a flake being mistaken for a real failure; the third takes `44-setup` off its private,
retry-less client — which on the evidence above would alone have turned 12 of the 15 stress failures
green; the fourth makes a starved Chromium say so.

What none of them do is touch a wall-clock budget. `[3.3.8]`'s `< 500 ms` and `[setup.4]`'s `took < 5000`
need a decision from whoever owns those tests, not a harness change: a number that only holds on an idle
machine is not evidence, and raising it until it always passes is not evidence either.

```diff
--- a/tests/helpers.js
+++ b/tests/helpers.js
@@ -4,6 +4,18 @@
 /** Starts an in-memory seeded server; returns { base, app, db, close, client(login) } */
 async function startServer(opts) {
   const app = createApp(Object.assign({ dataFile: null, quiet: true }, opts || {}));
+  /* Node closes an idle keep-alive socket after `server.keepAliveTimeout` (5 s by default). undici —
+     the engine behind global `fetch` — keeps that socket in its pool, so a request written into it in
+     the same tick the server sends FIN comes back as `TypeError: fetch failed`
+     (cause ECONNRESET / UND_ERR_SOCKET). A test regularly leaves the pool idle for longer than 5 s:
+     a 400-row import, a year of generated lessons, a Chromium run, or simply a starved event loop when
+     six suites share six cores — and starvation also delays undici's own close handler, which widens
+     the window further.
+     A test server lives for seconds, on loopback, for one client: let it hold the connection for the
+     whole file instead of racing it. Production keep-alive is untouched (`server/index.js` is not
+     edited), so this hides no product behaviour — it removes a property of the *test harness*.
+     Repro: docs/review/round3/repro/keepalive-race.js */
+  app.server.keepAliveTimeout = 120000;
+  app.server.headersTimeout = 150000;          // must stay above keepAliveTimeout, or Node warns
   const port = await app.listen(0); const base = `http://127.0.0.1:${port}`;
   function client() {
     let cookie = '';
@@
-    async function call(method, path, body, headers) {
-      let res; for (let attempt = 0; ; attempt++) { try { res = await fetch(base + path, { method, headers: Object.assign({ 'Content-Type': 'application/json', Cookie: cookie }, headers || {}), body: body != null ? (typeof body === 'string' ? body : JSON.stringify(body)) : undefined, redirect: 'manual' }); break; } catch (e) { if (attempt >= 4 || !/fetch failed|ECONNREFUSED|ECONNRESET/.test(String(e && (e.cause && e.cause.code || e.message)))) throw e; await new Promise((r) => setTimeout(r, 120 * (attempt + 1))); } }
+    /* Exactly the errors that mean "the server never read this request" — the only case in which
+       replaying a POST is safe. Anything else (a timeout, a half-written body, an HTTP error) is a
+       real failure: it is rethrown with the route and the cause spelled out, so a broken handler can
+       never be mistaken for a flake, and a flake can never be mistaken for a broken handler.
+       The old predicate read `e.cause.code || e.message`, so once undici set a code the string
+       'fetch failed' was never consulted and UND_ERR_SOCKET — the commonest shape of this failure —
+       fell straight through to `throw`. */
+    const REPLAYABLE = /^(ECONNRESET|ECONNREFUSED|EPIPE|UND_ERR_SOCKET|UND_ERR_CONNECT_TIMEOUT)$/;
+    async function call(method, path, body, headers) {
+      let res;
+      for (let attempt = 0; ; attempt++) {
+        try {
+          res = await fetch(base + path, { method, headers: Object.assign({ 'Content-Type': 'application/json', Cookie: cookie }, headers || {}), body: body != null ? (typeof body === 'string' ? body : JSON.stringify(body)) : undefined, redirect: 'manual' });
+          break;
+        } catch (e) {
+          const code = String((e && e.cause && e.cause.code) || '');
+          if (attempt >= 4 || !REPLAYABLE.test(code)) {
+            throw new Error(`${method} ${path}: ${e.message}${code ? ' [' + code + ']' : ''}${attempt ? ' (po ' + attempt + ' ponowieniach)' : ''}`, { cause: e });
+          }
+          await new Promise((r) => setTimeout(r, 120 * (attempt + 1)));
+        }
+      }
       const sc = res.headers.get('set-cookie'); if (sc) cookie = sc.split(';')[0];
```

```diff
--- a/tests/helpers.js
+++ b/tests/helpers.js
@@ /* withConfig */
-async function withConfig(db, patch, fn) {
-  const before = {}; for (const k of Object.keys(patch)) before[k] = db.data.config[k];
-  Object.assign(db.data.config, patch);
-  try { return await fn(); } finally { Object.assign(db.data.config, before); }
-}
+async function withConfig(db, patch, fn) {
+  /* A key the configuration did not have must come back absent, not present-and-undefined:
+     /api/auth/session hands the whole config to every signed-in client, and
+     tests/52-archive.test.js sets `archiveSignatureMaxMB`, which the seed does not define. */
+  const before = {}; const added = [];
+  for (const k of Object.keys(patch)) { if (k in db.data.config) before[k] = db.data.config[k]; else added.push(k); }
+  Object.assign(db.data.config, patch);
+  try { return await fn(); } finally { Object.assign(db.data.config, before); for (const k of added) delete db.data.config[k]; }
+}
```

```diff
--- a/tests/44-setup.test.js
+++ b/tests/44-setup.test.js
@@ -1,6 +1,6 @@
 'use strict';
 const test = require('node:test'); const assert = require('node:assert/strict');
-const { createApp } = require('../server/index'); const { totpCode } = require('../server/lib/crypto');
-const { fixtures } = require('./helpers');
-let app, base; const client = () => { let cookie = ''; const call = async (m, p, b) => { const r = await fetch(base + p, { method: m, headers: { 'Content-Type': 'application/json', Cookie: cookie }, body: b != null ? JSON.stringify(b) : undefined }); const sc = r.headers.get('set-cookie'); if (sc) cookie = sc.split(';')[0]; return { status: r.status, ok: r.ok, body: await r.json().catch(() => ({})) }; }; return { get: (p) => call('GET', p), post: (p, b) => call('POST', p, b), patch: (p, b) => call('PATCH', p, b) }; };
-test.before(async () => { app = createApp({ dataFile: null, quiet: true, blank: true }); base = `http://127.0.0.1:${await app.listen(0)}`; }); test.after(() => app.close());
+const { totpCode } = require('../server/lib/crypto');
+const { startServer, fixtures } = require('./helpers');
+/* The private bare-`fetch` client this file used to carry had no retry and no control over the
+   server's keep-alive timer, which is why [setup.4]/[setup.6]/[setup.7] were the tests that failed
+   with `TypeError: fetch failed` under load (docs/review/round3/test-honesty.md §4). */
+let S, app, base; const client = () => S.client();
+test.before(async () => { S = await startServer({ blank: true }); app = S.app; base = S.base; });
+test.after(() => S.close());
@@ /* blankSchool() */
-async function blankSchool() {
-  const a = createApp({ dataFile: null, quiet: true, blank: true });
-  const b = `http://127.0.0.1:${await a.listen(0)}`;
-  let cookie = '';
-  const call = async (m, p, body) => { const r = await fetch(b + p, { method: m, headers: { 'Content-Type': 'application/json', Cookie: cookie }, body: body != null ? JSON.stringify(body) : undefined }); const sc = r.headers.get('set-cookie'); if (sc) cookie = sc.split(';')[0]; return { status: r.status, ok: r.ok, body: await r.json().catch(() => ({})) }; };
-  const c = { get: (p) => call('GET', p), post: (p, x) => call('POST', p, x), patch: (p, x) => call('PATCH', p, x) };
+async function blankSchool() {
+  const s = await startServer({ blank: true });
+  const c = s.client();
   await c.post('/api/setup/school', { school: { name: 'Szkoła Podstawowa nr 400 w Krakowie', short: 'SP 400', address: 'ul. Duża 1', rspo: '40040' }, year: '2026/2027', admin: { login: 'admin', password: 'Wielka-Szkola-2026!', firstName: 'Ala', lastName: 'Adm' } });
-  return { app: a, c, close: () => a.close() };
+  return { app: s.app, c, close: () => s.close() };
 }
```

The shared client returns the same `{ status, ok, body }` shape, so no assertion in `44-setup` changes.
`[setup.1]`'s bare `fetch(base + '/')` can stay — it deliberately wants the raw status of the shell.
The same one-line swap applies to `tests/54-compliance.test.js` `[r4.11]`
(`await fetch(S.base + '/app/screens.js')` → `(await IOD.get('/app/screens.js')).body`, or keep the bare
call and accept that this one line can flake).

```diff
--- a/tests/helpers.js
+++ b/tests/helpers.js
@@ /* inChromium / domOf — the same two lines in each */
-  const out = await new Promise((resolve) => execFile(chrome, args, { encoding: 'utf8', timeout: o.timeout || 60000, maxBuffer: 32 * 1024 * 1024 }, (err, stdout) => resolve(stdout || '')));
+  /* A Chromium killed by its own timeout is a loaded machine, not a broken screen. Retry once, then
+     say which it was — `assert.match(dom, /app-title/)` blaming the app for a starved browser is how
+     [3.9.10] has been reading. EDMAT_UI_TIMEOUT raises the limit on slow CI. */
+  const limit = o.timeout || +process.env.EDMAT_UI_TIMEOUT || 60000;
+  const run = () => new Promise((resolve) => execFile(chrome, args, { encoding: 'utf8', timeout: limit, maxBuffer: 32 * 1024 * 1024 }, (err, stdout) => resolve({ err, out: stdout || '' })));
+  let r = await run();
+  if (r.err && r.err.killed) r = await run();
+  if (r.err && r.err.killed) throw new Error(`Chromium przekroczył ${limit} ms dwa razy z rzędu — maszyna jest obciążona (EDMAT_UI_TIMEOUT podnosi limit); to nie jest wynik testu`);
+  const out = r.out;
```

What this deliberately does **not** do: it does not widen the retry to every error, it does not swallow an
HTTP status, and it does not touch `server/index.js`. A route that is genuinely broken still fails on the
first attempt, now with the method, the path and the cause in the message.

---

## 5. Coverage holes — one per new feature

Each of these is a behaviour the feature really has (or really lacks) and that no test touches.

**H-1 · R5 retention — `/api/privacy/forget` walks straight through the guarantee.** `55-retention` proves
four times over that a retention run never touches category A or the student register. But
`server/routes/privacy.js` deletes rows from `grades`, `attendance`, `remarks`, `behaviorGrades` and
`descriptiveGrades` — which `server/routes/retention.js` classifies as `dziennik-lekcyjny` (B5) and
`arkusze-ocen` (B50) — and anonymises the `students` row, which **is** `ksiega-uczniow`
(`archiveCategoryA: true`). Two routes, two opposite rules, no test that puts them in the same room.
Missing: *erasure of a test account leaves the category-A classes intact, or says in the answer which
archival classes it had to touch and why.* This is the one hole on this list that is a defect and not just
a gap.

**H-2 · R1 timetable import — nobody has run the importer on a school-sized file.** The largest input any
test gives it is 272 rows over 8 classes (`asc/plan-sp12.xml`) or 112 rows over 8 (Optivum). `44-setup`
already has `CLASSES_24` (24 classes) but uses it only for pupils; `timetableCsv(CLASSES_24)` would be 720
rows and is never built. Missing: *an aSc or CSV plan for 24 classes imports inside a stated time, produces
the conflicts it should and no conflicts it should not, and generates a year of lessons.* This is where
`findConflicts` (O(n²)-shaped) and the A/B `_wA`/`_wB` id scheme will first hurt.

**H-3 · R1 — a timetable import cannot be undone, and nothing says so.** `[setup.5]` proves undo for pupil
and teacher imports. `recordImport` is only called for `kind: 'teachers'` and `kind: 'students'`
(`setup.js:208, 292`), so an aSc import that replaces the whole plan — and the lessons generated from it —
leaves no `imports` row and no way back. Missing: either *a timetable import appears in
`GET /api/setup/imports` and can be undone while no lesson on it carries a grade or attendance*, or a test
pinning that it deliberately cannot be and that the answer says so before the school clicks.

**H-4 · R4 compliance — the accessibility declaration cites tests without checking they pass.**
`compliance.js` `a11y()` decides "tested" with `src.includes('[3.9.2]')` — a grep of
`tests/39-nonfunctional.test.js`. The published, statutory declaration then says *"the evidence is the
tests in this file, run on every code change"*. `[r4.6]` asserts `missingEvidence.length === 0`, which
re-runs the same grep. A cited test that is failing, `# SKIP`ped (which is what happens to the Chromium
halves of `[3.9.2]`/`[3.9.3]` on a machine without Chromium) or renamed still counts. Missing: *the
declaration's evidence list is built from, or checked against, a green run* — `scripts/checklist-status.js
--json` already produces exactly that verdict.

**H-5 · R5 — no API answer ever carries a computed deadline that a test checks.** The 1-January rule is
proven three times on `RET.retentionDeadline`, but `GET /api/admin/retention/report` is only asserted to
have a truthy `nextDeadline`. Missing: *the report's `nextDeadline` for `dziennik-lekcyjny` equals the date
the rule gives for the oldest row.* Without it the helper can be right while the report reads the wrong
field.

**H-6 · R6 push — the jitter queue is never released by time.** `48-push` proves an ordinary delivery is
queued with a future `notBefore` and then **forces** the flush. Nothing shows the lazy pump releasing it
once the time passes — which is the behaviour a parent's phone depends on. Missing: *with
`jitterSeconds: 1`, an unforced `flushPush` after the window delivers exactly the queued notification.*

**H-7 · R7 register — the bulk path that writes a pupil without a PESEL is untested.**
`POST /api/registry/students/import` is dry-run only by design, so `56` #3 correctly asserts nothing was
written. The path that does write is `POST /api/setup/students/import`, which has a whole
`documentType`/`documentNumber`/`documentCountry` / "Dokument tożsamości" branch (`setup.js:240–250`) —
and `grep -rn documentType tests/` returns **nothing**. Missing: *a nabór CSV with the three foreign pupils
imported for real, landing in the register with the right `identityDocument` and `passport` fields and a
`document_needs_review` warning.*

**H-8 · R7 messages — forging a formal notice by the flag rather than the kind.** `56` #9 proves a teacher
cannot send `kind: 'expulsion'`. The code also accepts an explicit `formal: true`
(`messages.js:190`), and a teacher sending that is refused by the same line — but no test says so, so the
day someone reorders that expression nothing notices. Missing: *a teacher POSTing `{ formal: true }` with
an ordinary `kind` gets `403 formal_requires_principal`, and a principal's forwarded/replied message does
not inherit `formal`.*

**H-9 · R2 archive — rebuilding after signing silently un-signs the year.** `archiveWindow()` reports
`latestArchive(db, year)`, so a second `POST /api/principal/archive` for the same year makes a new,
unsigned package the current one: the status drops from `signed` back to `package-ready`/`overdue` and the
day-3/day-8 reminders start again, while the signed package is still in the collection. That may well be
the right rule — but it is undocumented and untested. Missing: *after signing, a forced rebuild of the same
year leaves the signed package retrievable and says plainly which package the deadline now hangs on.*

**H-10 · R3 guardians — "immediate" is never tested against a live session.** Every refusal in
`53-guardian-status` is read by a client that logs in **after** the change (`await S.as('rodzic…')`). Story
3.6.12 says "triggering immediate block on guardian accounts". Missing: *a guardian who is already signed
in is refused on the very next request, with no re-login* — the one thing a parent would notice.

---

## 6. Speed

`/usr/bin/time -v node --test tests/`, 6 cores, load average 2.4 at the start (the box is shared with the other round-3 reviews, so treat these as an upper bound on a quiet machine):

| | |
| --- | ---: |
| wall clock | **42.4 s** |
| CPU | 369 % (node runs one process per file, concurrency = core count) |
| peak RSS | 311 MB |
| tests | 437 |

Five slowest tests in a whole-suite run:

| | test | |
| ---: | --- | ---: |
| 1 | `[pilot] jeden tydzień szkolny przez publiczne API` (`49-pilot`) | 12.70 s |
| 2 | `[3.8.1] zapis do świetlicy czytnikiem legitymacji` (`38-modules`) | 4.66 s |
| 3 | `[3.9.10] interfejs mobilny bez progów płatności` (`39-nonfunctional`) | 4.21 s |
| 4 | `[sec.1] repeated wrong passwords lock the login out` (`45-security`) | 4.13 s |
| 5 | `ekrany ucznia i rodzica mieszczą się w oknie telefonu 360 px` (`39`, sub-test of `[3.9.10]`) | 4.05 s |

Next in line: `[r4.1]` 3.93 s, `archive: the zip writer round-trips` 3.56 s, `[3.1.2]` 3.54 s.

**Where the time really goes: seeding.** The `archive: the zip writer` entry is the giveaway — a pure
function over three in-memory files cannot take 3.5 s. What it measures is the file's `test.before`, i.e.
one `startServer()`. Run singly, every test in the nine files reviewed costs between 2.1 s and 7.1 s, and
the floor of ~2.1 s is the same for a test that only reads a string table. `tests/` starts **47 servers by
static count and more at run time** — `51` spawns seven (`richSchool` plus five `spawn()` plus the shared
one), `55` six (four `serverWithExpired()`, one migration server, one shared), `44` four, `46-reliability`
twelve between `startServer` and `createApp`. On the 42 s wall clock that is the dominant term.

Three things would make the suite faster without losing evidence, in order of value:

1. **Seed once, clone per server.** `createApp` re-runs every `server/seed/*.js` for each instance. Building
   the seeded `db.data` once per process and deep-copying it for each subsequent `startServer()` in the same
   file would cut most of the ~2 s floor. Nothing is lost: the tests assert on the data, not on the seeding.
2. **Make `blank: true` the default for tests that do not need the demo school.** `55`'s four
   `serverWithExpired()` instances plant their own rows and then assert about them; they carry a full demo
   school (5 classes, lessons, grades, an audit log) to do it. A blank seed plus the six rows they plant
   would be a fraction of the cost. The same holds for `52`'s "not-started" server, which only reads a
   window.
3. **Split `49-pilot`.** At 12.7 s it is nearly a third of the wall clock on its own and it is the file
   every other file waits for at the end. It already honours `EDMAT_SKIP_PILOT=1`; splitting the week into
   two files would let node run the halves in parallel. (Do not shorten the week — the cross-role
   invariants are the point.)

What would *not* help: trimming assertions. The slow tests are slow because they start servers and drive a
browser, not because they check too much.

---

## 7. Counts

| verdict | count |
| --- | ---: |
| solid | **78** |
| partial | **6** |
| weak | **1** |
| not really tested | 0 |
| **tests reviewed** | **85** |

Partial: `51` #11 (`findConflicts` at helper level), `52` #4 (order, not construction), `54` `[r4.2]`
(negative smoke), `54` `[r4.8]` (a marker count, not a field list), `56` #12 (dictionary, not screen),
`44` `[setup.4]` (the name claims a second, the assertion allows five).
Weak: `54` `[r4.12]` (source grep of `public/app/screens/compliance.js`).

**Story tags recommended to change: 13** — 12 in `tests/51-timetable-import.test.js` (`[3.5.5]` →
`[R1.1]`…`[R1.12]`, keeping `[3.5.5]` on the four end-to-end route tests) and 1 in
`tests/36-student.test.js` (`[3.6.12]` → `[R3.1]` on the consent-required test). No story loses its
evidence: `35-registry.test.js` keeps `3.5.5` and the objection test keeps `3.6.12`.

Also on the table but not counted above: two `withConfig`/order-hygiene fixes (§3), five harness diffs
(§4), two wall-clock budgets that cannot survive a shared machine (`[3.3.8]`, `[setup.4]`), one way the
suite **hangs** instead of failing (§4.1), and ten coverage holes (§5), of which **H-1 is a defect, not a
gap**.

## 8. How to re-run everything on this page

```bash
cd prototype
node --test tests/                                            # 437/437, ~42 s
node --test $(ls tests/*.test.js | sort -r)                   # reverse file order
node --test $(ls tests/5*.test.js | sort -r)                  # the new files, reversed
node docs/review/round3/repro/run-each-test-alone.js \
  tests/51-timetable-import.test.js tests/52-archive.test.js tests/53-guardian-status.test.js \
  tests/54-compliance.test.js tests/55-retention.test.js tests/56-register-sio.test.js \
  tests/36-student.test.js tests/44-setup.test.js tests/48-push.test.js   # 118 single-test runs

node docs/review/round3/repro/checklist-file-level-rule.js     # rule 3 of checklist-status.js still fires
node docs/review/round3/repro/keepalive-race.js --rounds 20 --gap 5010 --burners 6
node docs/review/round3/repro/keepalive-race.js --rounds 20 --gap 5010 --burners 6 --keepalive 120000
docs/review/round3/repro/stress.sh suite 6                     # six whole suites at once
docs/review/round3/repro/stress.sh setup 6                     # 44-setup under six busy loops
docs/review/round3/repro/stress.sh idle 6                      # 39-nonfunctional under six busy loops
```

After `stress.sh suite 6`, check for a copy that stopped rather than failed:

```bash
pgrep -af 'edmat-sigterm.*child.js'        # a leftover child = a hung `node --test` (see §4.1)
```
