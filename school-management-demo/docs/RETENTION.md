# Retencja, brakowanie i prawo do bycia zapomnianym

Jednostką retencji w EdMat nie jest „liczba lat dla logów”, tylko **klasa dokumentacji** z kategorią
archiwalną z jednolitego rzeczowego wykazu akt (JRWA). Tabela mieszka w `config.retention`
(`server/seed/00-base.js` wkłada wartości domyślne z `DEFAULT_RETENTION()`), a liczy ją
`server/routes/retention.js`. Ekran administratora pokazuje ją w karcie „Retencja logów”
(`public/app/screens/admin.js`), raport wydaje `GET /api/admin/retention/report`.

**Ta sama tabela rządzi dwiema drogami, którymi cokolwiek w programie znika.** Brakowanie akt
(`POST /api/admin/retention/run`) i żądanie z art. 17 RODO (`POST /api/privacy/forget`) czytają jedną
politykę i jeden wpis na klasę. Nie ma drugiej listy, nie ma trasy, która „wie lepiej”, i nie ma
żądania, które usunie arkusz ocen.

> **Nic tu nie jest decyzją prawną.** Domyślne kategorie pochodzą z raportu badawczego
> (`docs/research/2026-09-23-gemini-raw.md` §7) i z jego triażu
> (`docs/research/2026-09-23-gemini-triage.md`, wiersz 7 — ocena **B**, „nasze domyślne wartości
> trzeba porównać linia po linii z JRWA konkretnej szkoły”). Dlatego każda klasa niesie flagę
> `verified` i dopóki jest `false`, raport i ekran administratora wyświetlają ostrzeżenie.

## 0. Jedna reguła

```js
const RET = require('./retention');
RET.policyFor(db, 'grades')   // → klasa tej kolekcji: { class:'arkusze-ocen', category:'B50', kind:'archival',
                              //    neverDelete:false, erasure:'anonymise', … }  albo null
RET.classifyAll(db)           // → wiersz na KAŻDĄ tablicę w magazynie: klasa albo { uncovered: true }
RET.uncoveredCollections(db)  // → same nazwy kolekcji bez klasy
```

`classifyAll` przechodzi `Object.keys(db.data)` i porównuje z sumą `collections` wszystkich klas.
Kolekcja, której żadna klasa nie wymienia, jest **`uncovered`**: nie ma okresu przechowywania, nie
liczy się w raporcie i nigdy nie trafi do brakowania. Wiersz „bez klasy” **nie znika** z odpowiedzi
`GET /api/admin/retention/report` ani z karty administratora, nawet gdy jest pusty — o to właśnie
chodziło w D3-13, gdzie 46 z 74 kolekcji nie należało do niczego i nie było tego po czym poznać.
Dopisanie kolekcji bez klasy wywraca `tests/55-retention.test.js` („każda tablica w magazynie ma
klasę dokumentacji”), który wylicza klucze `db.data` na zaseedowanym magazynie.

Trzy rodzaje klas (`kind`), i to jest cała różnica w zachowaniu:

| `kind` | zegar | usuwa je | art. 17 |
| --- | --- | --- | --- |
| `archival` | 1 stycznia po zamknięciu sprawy (JRWA) | **wyłącznie** zatwierdzona propozycja brakowania ze zgodą Archiwum Państwowego | anonimizacja w miejscu |
| `operational` | okno przesuwne od daty wpisu | nocne `POST …/run` bez propozycji | usunięcie wierszy osoby |
| `reference` | brak | **nic** — `neverDelete: true` | wypisanie z list / anonimizacja konta |

`reference` to dane robocze programu: plan lekcji, oddziały, grupy, przedmioty, słowniki, konta,
materiały nauczyciela, klucze push. To nie jest dokumentacja z okresem przechowywania i zadanie
retencyjne jej nie dotyka; wiersz kończy życie wtedy, gdy kończy je jego właściciel (zamknięcie
konta, art. 17), a nie po upływie terminu.

## 1. Tabela klas

| Klasa | Kategoria | Okres | Rodzaj | Zegar | Kolekcje | art. 17 | Zweryfikowane |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `dziennik-lekcyjny` | **B5** | 5 lat | archival | school-year-end | `attendance`, `lessons`, `remarks`, `excuses`, `attendanceAlerts`, `tests`, `substitutions` | anonimizacja | ✗ |
| `arkusze-ocen` | **B50** | 50 lat | archival | school-year-end | `grades`, `behaviorGrades`, `descriptiveGrades`, `reportCardHistory`, `documents` | anonimizacja | ✗ |
| `ksiega-uczniow` | **B50** + `archiveCategoryA` | 50 lat / wieczyście | archival | pupil-left | `students`, `studentIds`, `duplicates` | anonimizacja | ✗ |
| `ksiega-ewidencji-dzieci` | **B50** | 50 lat | archival | event | `districtChildren` | anonimizacja | ✗ |
| `uchwaly-klasyfikacyjne` | **B5** | 5 lat | archival | school-year-end | `semesterLocks` | anonimizacja | ✗ |
| `pakiet-archiwalny` | **B5** | 5 lat | archival | school-year-end | `archives` | nie ruszamy | ✗ |
| `protokoly-brakowania` | **A** | wieczyście | archival | event | `retentionRuns`, `retentionProposals` | nie ruszamy | ✓ |
| `dokumentacja-ppp` (art. 9) | **B5** | 5 lat | archival | pupil-left | `ipet`, `ipetImplementations`, `wopfu`, `supportDocuments`, `supportSessions`, `supportEvaluations`, `confidentialNotes`, `communityInterviews`, `speechSessions`, `otherActivities`, `reportRequests` | anonimizacja | ✗ |
| `dokumentacja-medyczna` (art. 9) | **B20** | 20 lat | archival | event | `nurseVisits`, `nurseVisitAccessLog` | anonimizacja | ✓ |
| `rejestr-wypadkow` (art. 9) | **B25** | 25 lat | archival | event | `incidents` | anonimizacja | ✗ |
| `prace-uczniowskie` | **Bc** | 2 lata | archival | school-year-end | `homework`, `homeworkSubmissions`, `courseEnrollments`, `courseProgress`, `quizAttempts`, `courseThreads`, `coursePosts` | anonimizacja | ✗ |
| `dokumentacja-finansowa` | **B5** | 5 lat | archival | event | `payments`, `receipts`, `cafeteriaAccounts`, `cafeteriaCancellations` | anonimizacja | ✗ |
| `dziennik-swietlicy` | **B5** | 5 lat | archival | school-year-end | `careCheckins`, `carePickups`, `careAuthorizedPickups` | anonimizacja | ✗ |
| `biblioteka` | **B5** | 5 lat | archival | event | `libraryLoans`, `libraryItems` | anonimizacja | ✗ |
| `wycieczki-i-zebrania` | **B5** | 5 lat | archival | school-year-end | `trips`, `meetings`, `meetingAttendance`, `consultationSlots`, `videoMeetings` | anonimizacja | ✗ |
| `dziennik-zdarzen` | **B5** | `config.logRetentionYears` (min. 5) | operational | event | `audit` | **nie ruszamy nigdy** | ✓ (polityka szkoły) |
| `wiadomosci` | **B5** | 5 lat | operational | event | `messages`, `announcements` | usunięcie | ✓ |
| `powiadomienia` | **Bc** | 365 dni | operational | event | `notifications` | usunięcie | ✓ |
| `doreczenia-push` | **Bc** | 90 dni | operational | event | `pushDeliveries` | usunięcie | ✓ |
| `sesje` | **Bc** | `config.sessionRetentionDays` (90 dni) | operational | ostatnia aktywność | `sessions` | usunięcie | ✓ |
| `kody-i-importy` | **Bc** | 365 dni | operational | event | `registrationCodes`, `imports` | usunięcie | ✓ |
| `opinie` | **Bc** | 730 dni | operational | event | `feedback` | usunięcie | ✓ |
| `konta-uzytkownikow` | **B5** | 5 lat od zamknięcia konta | reference | — | `users` | anonimizacja | ✗ |
| `dostep-techniczny` | **Bc** | — | reference | — | `pushSubscriptions`, `pushKeys`, `ssoNonces` | usunięcie | ✓ |
| `konfiguracja-szkoly` | **Bc** | — | reference | — | `subjects`, `classes`, `groups`, `timetable`, `gradeCategories`, `curriculum`, `phraseBank`, `developmentAreas`, `duties` | wypisanie z list | ✓ |
| `materialy-dydaktyczne` | **Bc** | — | reference | — | `courses`, `courseUnits`, `courseItems`, `materials` | nie ruszamy | ✓ |

**26 klas, 81 kolekcji, 0 bez klasy.** (Przed rundą 3: 13 klas, 28 kolekcji objętych, **46 bez
klasy** — `docs/review/round3/domain.md` §3.)

Kształt jednego wiersza:

```js
{ class: 'dziennik-lekcyjny', label: '…', category: 'B5', years: 5, clock: 'school-year-end',
  kind: 'archival', collections: ['attendance', 'lessons', 'remarks', …],
  erasure: 'anonymise', legalBasis: '…', note: '…', verified: false }
```

`years` albo `days` (klasy krótkookresowe, kategoria Bc). `archiveCategoryA: true` znaczy „miejscowe
archiwum może zakwalifikować tę klasę jako A” — program **nigdy** nie zaproponuje jej do brakowania,
nawet gdy okres B minął. `article9: true` oznacza dane szczególnej kategorii. `configYears` /
`configDays` wskazują pokrętło w `config`, które ma pierwszeństwo przed zapisaną wartością (to je
zmienia `PATCH /api/admin/retention`). `neverDelete` jest **wyliczane**: kategoria A **albo**
`archiveCategoryA` **albo** `kind: 'reference'`.

### 1.1 Co zmieniła runda 3 i dlaczego

* **`protokoly-rady-pedagogicznej` zniknęła.** Była kategorią A i obejmowała `semesterLocks` oraz
  `archives` — a żadne z dwojga nie jest protokołem (D3-15). **EdMat nie prowadzi protokołów rady
  pedagogicznej w ogóle**; prowadzi je szkoła, poza programem, i to ona odpowiada za przekazanie ich
  do Archiwum Państwowego. Klasa została wycofana; stara konfiguracja, która ją wymienia, jest przy
  odczycie po cichu pomijana (`RETIRED_CLASSES`).
  * `semesterLocks` → **`uchwaly-klasyfikacyjne`** (B5). To techniczny zamek okresu z numerem
    uchwały (`resolutionNo`) — odwołanie do uchwały, nie sama uchwała.
  * `archives` → **`pakiet-archiwalny`** (B5, `neverDelete: false`). Pakiet § 22 to **kopia robocza**
    tego, co szkoła przechowuje na nośniku; jego kategorię wyznacza treść (dziennik B5, arkusze B50),
    więc opakowanie nie może być wieczyste. Ustaw B5 dopiero po potwierdzeniu, że szkoła naprawdę ma
    podpisany oryginał na nośniku — do tego czasu traktuj wiersz jako jedyny egzemplarz.
* **Kategoria A została tam, gdzie jej miejsce**: przy `protokoly-brakowania` (`retentionRuns`,
  `retentionProposals`). Protokół brakowania jest materiałem archiwalnym i dowodem, że brakowanie
  odbyło się zgodnie z prawem — program nie usunie go nigdy i nie wpisze do żadnej propozycji.
* **Dodano 13 klas** dla 46 kolekcji, które wcześniej nie należały do niczego. Wszystkie dotyczące
  dokumentacji szkolnej mają `verified: false` — dokładnie z tego powodu, co reszta: rozstrzyga JRWA
  szkoły, nie ustawienie w programie.
* **`users` i plan lekcji nie są brakowane.** Program nie odnotowuje jeszcze daty zamknięcia konta,
  więc zegar B5 nie miałby od czego ruszyć; gdyby liczyć go od `createdAt`, zadanie proponowałoby do
  usunięcia żywe konta nauczycieli. Stąd `kind: 'reference'` i jawne `neverDelete: true` zamiast
  cichego „nie ma daty, więc nic się nie dzieje”.

## 2. Reguła zegara

`retentionDeadline(class, record, db)` (czysta funkcja, `server/routes/retention.js`) zwraca
**pierwszy dzień, w którym wolno usunąć rekord**, albo `null`, gdy nie wolno nigdy.

* **Klasy archiwalne.** Okres liczy się od **1 stycznia roku następującego po roku, w którym sprawę
  zamknięto** — to reguła JRWA, a nie data wpisu.
  * `clock: 'school-year-end'` — zamknięciem jest koniec roku szkolnego, do którego należy wpis.
    Frekwencja z 23.10.2026 i z 15.01.2027 należy do roku 2026/2027, więc obie mają ten sam termin:
    zegar rusza 1.01.2028, B5 mija **1.01.2033**. Rok szkolny wyznacza `schoolYearFor()`
    z `server/lib/blank-seed.js` (granica: 1 sierpnia), a „dziś” to zawsze `D.today(db)` w strefie
    szkoły — nigdy `new Date()`.
  * `clock: 'pupil-left'` — zamknięciem jest odejście ucznia. Dopóki uczeń jest w szkole, termin
    wynosi `null` i nic z jego dokumentacji nie jest po terminie. **Wszystkie cztery drogi odejścia
    zapisują `departureDate`** (§ 2.1).
  * `clock: 'event'` — zamknięciem jest data wpisu, też zaokrąglona do 1 stycznia roku następnego
    (tak liczy art. 29 ustawy o prawach pacjenta: 20 lat od końca roku kalendarzowego ostatniego wpisu).
* **Klasy operacyjne.** Okno przesuwne: okres liczy się wprost od daty wpisu i musi upłynąć
  w całości. Wpis audytowy z 23.10.2020 przy polityce 5 lat wolno usunąć od 24.10.2025.
* **Kategoria A, `archiveCategoryA` i `kind: 'reference'`** nie mają terminu w ogóle — funkcja
  zwraca `null`.

Datę wpisu czyta `recordDate()` z pól wymienionych w `dateFields` klasy (domyślnie `date`, `at`,
`createdAt`, `issuedAt`) — dlatego `libraryLoans` liczy się od `returnedAt`, a `sessions` od
`lastActivity`. Wiersz bez daty nie ma terminu i nigdy nie jest proponowany; w raporcie widać to
jako `due: 0` przy `nextDeadline: null`. Dotyczy to `cafeteriaAccounts` (mają tylko tekstowy
`period`) i `otherActivities` (zajęcia grupowe nie mają ucznia, więc zegar „odejście ucznia” dla
nich nie rusza).

### 2.1 Cztery drogi odejścia ucznia

| droga | trasa | zapisuje |
| --- | --- | --- |
| przeniesienie do innej szkoły | `server/routes/registry.js` | `status: 'transferred'` + `departureDate` |
| ukończenie szkoły | `server/routes/school-year.js` | `status: 'graduated'` + `departureDate` |
| wypisanie decyzją administracyjną | `server/routes/homeroom.js` | `status: 'removed'` + `leftAt` **+ `departureDate`** |
| żądanie z art. 17 | `server/routes/privacy.js` | `status: 'erased'` + `erasedAt` **+ `departureDate`** |

Przed rundą 3 dwie ostatnie drogi nie ustawiały `departureDate` (D3-14), więc cała dokumentacja PPP
tych uczniów — IPET, WOPFU, opinie, notatki specjalistów — miała termin `null` i nie zostałaby
zbrakowana nigdy. `clockStart()` czyta dodatkowo `leftAt` i `erasedAt`, żeby stare dane z takich
instalacji też dostały zegar.

## 3. Art. 17 RODO: macierz usuwania

`POST /api/privacy/forget` (`server/routes/privacy.js`) działa na żądanie osoby, dotyczy jednego
konta lub jednego ucznia i nie czeka na żaden termin. **Klasa dokumentacji decyduje**, co się z jej
wierszami stanie. `GET /api/privacy/erasure-policy` i `describeErasure(db)` zwracają tę macierz
maszynowo (czyta ją `server/routes/compliance.js`, żeby DPIA i umowa powierzenia opisywały to, co
kod naprawdę robi — D3-27/D3-29).

| `erasure` | co się dzieje | klasy |
| --- | --- | --- |
| **`anonymise`** | wiersz **zostaje**; pola tożsamości zastępuje trwały pseudonim `OSOBA-XXXXXXXX`, pola kontaktowe i numery znikają, **daty, oceny i frekwencja zostają bez zmian** | `dziennik-lekcyjny`, `arkusze-ocen`, `ksiega-uczniow`, `ksiega-ewidencji-dzieci`, `uchwaly-klasyfikacyjne`, `dokumentacja-ppp`, `dokumentacja-medyczna`, `rejestr-wypadkow`, `prace-uczniowskie`, `dokumentacja-finansowa`, `dziennik-swietlicy`, `biblioteka`, `wycieczki-i-zebrania`, `konta-uzytkownikow` |
| **`delete`** | wiersze osoby znikają | `wiadomosci`, `powiadomienia`, `doreczenia-push`, `sesje`, `kody-i-importy`, `opinie`, `dostep-techniczny` |
| **`unlink`** | wiersz zostaje, znika z niego identyfikator osoby (lista uczniów oddziału, skład grupy, rozdzielnik) | `konfiguracja-szkoly` |
| **`keep`** | nie ruszamy w ogóle; `erasureReason` mówi dlaczego | `dziennik-zdarzen` (rejestr zdarzeń), `protokoly-brakowania`, `pakiet-archiwalny`, `materialy-dydaktyczne` |

Trzy rzeczy, które z tego wynikają i o które chodziło w S3-05/S3-06/H-1:

1. **Rejestr zdarzeń nie jest ruszany.** Nie ma redakcji wpisów, nie ma pola `redacted`. Protokół
   usunięcia danych (`action: 'right_to_be_forgotten'`) **sam jest wpisem w tym rejestrze** — tak
   wygląda rozliczalność z art. 5 ust. 2 RODO. Wcześniej jedno żądanie potrafiło zredagować 100 %
   rejestru, bo igłą było jednoliterowe imię.
2. **Nie istnieje żądanie, które usunie arkusz ocen albo księgę uczniów.** `force: true` przełamuje
   wyłącznie bramkę „to konto testowe”. Nie zmienia klasy i nie zmienia tego, co wolno usunąć.
3. **Dane z art. 9 są anonimizowane, nie pomijane.** IPET, WOPFU, notatki specjalistów, wizyty
   w gabinecie i rejestr wypadków zostają jako wiersze bez tożsamości.

### 3.1 Dopasowanie: pola, nie `JSON.stringify`

| | |
| --- | --- |
| skąd biorą się igły | wyłącznie `firstName`, `lastName`, `login`, `email`, `pesel`, `phone` usuwanej osoby |
| minimalna długość igły | **3 znaki** — krótsza nie powstaje w ogóle |
| jak dopasowujemy | do **całej wartości pola** (po przycięciu, bez względu na wielkość liter) |
| czy skanujemy rejestr zdarzeń | **nie, nigdy** |
| tekst swobodny | osobny, wąski przebieg po polach `text`, `body`, `subject`, `comment`, `reason`, `note`, `scope`, `description`, `summary` — dopasowanie do **całego słowa**, liczone osobno jako `textRedacted` |
| który wiersz „dotyczy osoby” | `studentId`, `userId`, `parentUserId`, `fromUserId`, `bookedForStudentId`, `bookedByUserId` — **nigdy** `byUserId` ani `teacherId` (te mówią, kto wpis zrobił; inaczej usunięcie konta nauczyciela zabrałoby dziennik całej klasy) |

Pseudonim jest trwały: ten sam identyfikator zawsze daje ten sam napis (`sha256` z soli i id), więc
zanonimizowane wiersze da się po latach złożyć w jeden przebieg nauki, nie znając już osoby.

Protokół w odpowiedzi i we wpisie audytowym liczy **każdy krok osobno**: `anonymised`, `deleted`,
`unlinked`, `kept`, `byClass`, `totals`, `textRedacted`, `pseudonym`, `needles`, a także listę
kolekcji `uncovered`, których żądanie nie dotknęło, bo nie mają klasy.

`personalCollections(db)` — lista kolekcji, których art. 17 w ogóle dotyczy — jest **wyliczana
z katalogu klas**, nie wpisana ręcznie (D3-29). Dawna lista wymieniała trzy kolekcje, które nie
istnieją (`mealOrders`, `careAttendance`, `healthVisits`), i pomijała wszystkie kolekcje z art. 9.

## 4. Brakowanie: trzy kroki, dwie osoby i jedno potwierdzenie

```
GET  /api/admin/retention/proposal      admin | dyrektor   → lista, status 'pending'
POST /api/admin/retention/approve       admin | dyrektor   → { proposalId, archiveConsentReference, reason }
                                                           → { confirmationToken }  (INNE konto niż autor listy)
POST /api/admin/retention/run           admin              → { confirm:true, reason, proposalId, confirmationToken }
```

1. **Lista.** `GET …/proposal` wylicza, co w klasach archiwalnych przekroczyło termin na
   `D.today(db)`, i zapisuje to jako jeden wiersz `retentionProposals` na dzień (`prop_RRRR-MM-DD`).
   Powtórny odczyt odświeża tę samą propozycję, dopóki jest `pending` — nie mnoży wierszy.
   Kategoria A, klasy z `archiveCategoryA` i dane robocze nie trafiają na listę; wracają osobno
   w polu `neverDeleted` razem z powodem. **Propozycja niesie liczby per klasa i datę odcięcia
   (`cutoff`), nigdy list identyfikatorów** — wcześniej jeden rocznik B5 dawał wiersz o wadze 28,9 MB
   z 586 560 identyfikatorami, który i tak był tylko migawką (R3-03).
2. **Zatwierdzenie — druga para oczu.** `POST …/approve` odmawia z `409 same_actor`, jeśli
   zatwierdza to samo konto, które ułożyło listę. Wymaga też **sygnatury zgody Archiwum Państwowego**
   (`archiveConsentReference`, tekst, minimum 3 znaki — np. „AP Kraków, zgoda nr 17/2033
   z 12.01.2033”); bez niej `400 archive_consent_required`. W odpowiedzi wraca **jednorazowy
   `confirmationToken`**: to osoba zatwierdzająca decyduje, kiedy brakowanie ruszy. Zatwierdzenie
   zostawia wpis audytowy `retention_proposal_approved` z liczbami per klasa, sygnaturą zgody oraz
   `proposedBy` i `approvedBy`.
3. **Wykonanie.** `POST …/run` z `proposalId` **i** `confirmationToken`. Bez tokenu → `403
   confirmation_required`; token zużyty → `403 confirmation_spent`; propozycja niezatwierdzona →
   `403 approval_required`; wykonana po raz drugi → `409 proposal_executed`. Wykonanie **wylicza
   wiersze tą samą regułą i na tę samą datę odcięcia co propozycja**, zapisuje protokół
   w `retentionRuns` i wpis audytowy `retention_executed`. Wpisu audytowego nigdy nie da się zmienić
   ani usunąć pojedynczo (WORM, `405 audit_immutable`).

Rolę dyrektora dopuszczamy do listy i do zatwierdzenia (to jego decyzja), ale samo uruchomienie
zadania zostaje przy administratorze — dyrektor dostaje na `…/run` odpowiedź `403`.

Nocny cron po stronie VPS uruchamia wyłącznie część operacyjną (bez `proposalId` nie ma jak dotknąć
klas archiwalnych):

```
15 3 * * *  curl -fsS -X POST -H 'Content-Type: application/json' -b "$COOKIE" \
            --data '{"confirm":true,"reason":"nocne sprzątanie dzienników technicznych"}' \
            http://127.0.0.1:3000/api/admin/retention/run
```

### 4.1 Kolejność trwałości

Brakowanie jest jedyną operacją w programie, która wolno jej zniszczyć dokumentację szkoły. Dlatego
`POST …/run` robi rzeczy **w tej kolejności**:

```
1. policz plan (jeden skan bazy na żądanie)
2. db.insert('retentionRuns', { status: 'started', planned: { byClass, operational, archival }, … })
3. ctx.audit({ action: 'retention_executed', after: { status: 'started', plannedArchival, … } })
4. db.flush()                      ← protokół i wpis audytowy są NA DYSKU
5. sprzątanie: klasy operacyjne, potem klasy z zatwierdzonej propozycji
6. protokół domknięty: status 'completed', deleted, byClass, remaining; db.flush()
7. ctx.audit({ action: 'retention_completed', after: { deleted, byClass, … } })
```

Zabicie procesu (`kill -9`, zanik zasilania) w kroku 5 zostawia na dysku protokół ze statusem
`started`, wpis `retention_executed` i zatwierdzoną propozycję z zużytym potwierdzeniem. Wiadomo
więc, **co się działo, kto zatwierdził i na jakiej zgodzie**, a ekran nie zaprosi nikogo do
powtórzenia. Przed rundą 3 ta sama awaria zabierała 586 560 wierszy dziennika i nie zostawiała
niczego: `retentionRuns` = 0, propozycja z powrotem `pending` (R3-02). Dowód:
`tests/55-retention.test.js`, „kill -9 w środku sprzątania zostawia protokół brakowania i wpis
audytowy”.

Usuwanie jest bezpieczne dla dziennika dopisywania (`docs/STORAGE.md` §2): kolekcję podmieniamy
w całości (`db.data.x = keep`), co wymusza przepisanie migawki, zamiast dopisywać tysiące operacji
`d` do `.jsonl`. Dzięki temu odtworzenie dziennika na nowszej migawce nie „wskrzesi” zbrakowanych akt.
Filtrujemy **predykatem** (`isDue(cls, row, db, day)`), nie listą identyfikatorów — żadna trasa
retencji nie materializuje już identyfikatorów.

### 4.2 Koszt skanu

`classPlans(db, today)` przechodzi całą bazę raz. Każda trasa retencji liczy go **dokładnie raz na
żądanie** i podaje dalej (`plan(db, rows)`, `buildProposal(db, user, rows)`, `proposalView(db, p,
rows)`) — wcześniej `GET …/proposal` skanował bazę dwa razy. Jeśli magazyn wystawia licznik wersji
(`db.version`), plan trafia do pamięci podręcznej na tę wersję i przeżywa żądanie; bez licznika
pamięć podręczna po prostu nie działa i nic się nie psuje.

## 5. Raport

`GET /api/admin/retention/report` (administrator) niesie — obok pól sprzed pakietu R5 —
wiersz na każdą klasę:

```
class, label, category, kind, years|days, clock, rule, collections, verified, archiveCategoryA,
article9, neverDelete, neverDeletes, erasure, total, due, perCollection, nextDeadline, oldestRecord,
lastRun: { runId, at, deleted, archiveConsentReference } | null
```

oraz `dueTotal`, `operationalDue`, `archivalDue`, `unverified`, `jrwaWarning`, `collectionsTotal`
i **`uncovered` / `uncoveredCount` / `uncoveredRows` / `uncoveredWarning`**. Karta „Retencja logów”
na ekranie administratora pokazuje tę tabelę (pl + en), legendę kategorii (A / B*n* / Bc / JRWA),
ostrzeżenie o klasach niezweryfikowanych, **wiersz o kolekcjach bez klasy — także gdy jest pusty** —
i całą ścieżkę brakowania: przycisk w wariancie `danger`, wymagane uzasadnienie (puste na starcie,
nigdy podstawiane nagłówkiem karty) i dialog potwierdzenia z liczbami per klasa, sygnaturą zgody
i Twoim uzasadnieniem przed wykonaniem.

## 6. Zgodność wstecz

`config.retention` czytamy przez `migrateRetention()` — nic nie trzeba migrować w plikach:

| zapisany kształt | co się dzieje |
| --- | --- |
| brak klucza | tabela domyślna (`migratedFrom: 'defaults'`) |
| `{ version: 3, classes: [...] }` | używany wprost, brakujące pola uzupełniane z tabeli domyślnej |
| `{ version: 2, classes: [...] }` | to samo; klasy wycofane w rundzie 3 (`protokoly-rady-pedagogicznej`) są pomijane, a klasy dodane dochodzą na koniec (`migratedFrom: 'v2'`) |
| lista `[{ class, years }]` bez kategorii | kategoria, zegar, kolekcje i reguła art. 17 dochodzą z tabeli domyślnej |
| płaska mapa `{ audit: 7, sessions: 30, dziennik: 6 }` | liczba nadpisuje `years` (a dla klas Bc — `days`); klucze rozpoznajemy po aliasach (`LEGACY_KEYS`) |

Pokrętła `config.logRetentionYears` (minimum `logRetentionMinYears`),
`config.gradesArchiveRetentionYears` i `config.sessionRetentionDays` mają **pierwszeństwo** przed
zapisaną tabelą — to one zmieniają się przez `PATCH /api/admin/retention` i to one widzi test
[3.5.15].

## 7. Co sprawdzić w JRWA szkoły, zanim ktokolwiek naciśnie „brakuj”

Każda szkoła ma własny jednolity rzeczowy wykaz akt, zatwierdzony przez właściwe Archiwum
Państwowe. Rozstrzyga on, nie ustawienie w programie. Porównaj linia po linii i ustaw
`verified: true` dopiero wtedy:

1. **Dziennik lekcyjny** — czy na pewno B5 i od kiedy liczony (są wykazy z B10). Sprawdź też, czy
   usprawiedliwienia i zapowiedzi sprawdzianów wykaz traktuje razem z dziennikiem.
2. **Księga uczniów** — **A czy B50?** To pytanie do archiwum, nie do nas. Dopóki nie ma
   odpowiedzi, zostaw `archiveCategoryA: true`.
3. **Dokumentacja pomocy psychologiczno-pedagogicznej** — „5 lat od opuszczenia szkoły” to ta
   pozycja raportu, której triaż nie potrafił potwierdzić. Sprawdź ją jako pierwszą; opinie poradni
   bywają kwalifikowane inaczej niż IPET i WOPFU.
4. **Rejestr wypadków** — raport podaje B25, triaż tego nie potwierdził; spotykane są B10 i A.
5. **Arkusze ocen** — B50 jest bezpieczne, ale sprawdź, czy wykaz nie traktuje ich jako kategorii A.
   Świadectwa (`documents`) dzielą tu kategorię arkusza.
6. **Pakiet archiwalny (§ 22)** — potwierdź, że szkoła ma podpisany oryginał na nośniku. Dopóki go
   nie ma, wiersz w programie jest jedynym egzemplarzem i nie wolno go brakować mimo kategorii B5.
7. **Księga ewidencji dzieci** — część wykazów kwalifikuje ją jako kategorię A.
8. **Dokumentacja finansowa** — 5 lat wynika z art. 74 ustawy o rachunkowości, nie z JRWA; sprawdź,
   czy szkoła nie prowadzi tych rozliczeń w systemie księgowym organu prowadzącego.
9. **Biblioteka** — księga inwentarzowa bywa kwalifikowana wyżej niż historia wypożyczeń.
10. **Dokumentacja medyczna** — 20 lat wynika z ustawy o prawach pacjenta, nie z JRWA; sprawdź
    wyjątki z art. 29 ust. 1 (zgon w wyniku uszkodzenia ciała, zdjęcia RTG, skierowania).
11. **Protokoły rady pedagogicznej** — **program ich nie prowadzi**. Odpowiada za nie szkoła:
    kategoria A oznacza przekazanie do Archiwum Państwowego po 25 latach.
12. **Zgoda na brakowanie** — bez pisemnej zgody właściwego Archiwum Państwowego brakowanie
    dokumentacji niearchiwalnej jest niedopuszczalne. Sygnatura tej zgody jest w programie polem
    wymaganym i trafia do protokołu oraz do rejestru zdarzeń.

Testy: `tests/55-retention.test.js` (klasy, zegar, cztery oczy, trwałość) i
`tests/59-erasure.test.js` (art. 17 i macierz usuwania) —
`node --test tests/55-retention.test.js tests/59-erasure.test.js`.
