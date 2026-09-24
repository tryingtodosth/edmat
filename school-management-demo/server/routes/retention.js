'use strict';
/*
 * Retencja i brakowanie — JEDNA reguła dla całego programu.
 *
 * Jednostką retencji NIE jest „liczba lat dla logów”, tylko **klasa dokumentacji** z kategorią
 * archiwalną wg JRWA szkoły (A, B5, B20, B25, B50, Bc…). Ta sama tabela rozstrzyga dwie rzeczy:
 *
 *   1. co wolno **zbrakować** (to zadanie, POST …/run),
 *   2. co wolno **usunąć na żądanie z art. 17 RODO** (server/routes/privacy.js) — pole `erasure`.
 *
 * Nie ma drugiej listy. `policyFor(db, collection)` mówi, do której klasy należy kolekcja,
 * a `classifyAll(db)` przechodzi **wszystkie** tablice w magazynie i pokazuje te, które nie
 * należą do żadnej — jako `uncovered`. Wiersz „uncovered” nigdy nie znika z raportu ani z karty
 * administratora, a test `tests/55-retention.test.js` nie przepuszcza nowej kolekcji bez klasy.
 *
 * Tabela domyślna (DEFAULT_CLASSES) pochodzi z raportu Gemini §7
 * (docs/research/2026-09-23-gemini-raw.md) i z jego triażu (…-triage.md, wiersz 7, pakiet R5).
 * Triaż ocenił cały ten wiersz na **B** — „nasze domyślne wartości trzeba porównać linia po linii
 * z JRWA konkretnej szkoły”. Dlatego klasy dokumentacji szkolnej niosą `verified: false`, a raport
 * i ekran administratora pokazują ostrzeżenie.
 *
 * Trzy rodzaje klas — i to jest cała różnica w zachowaniu:
 *
 *   kind: 'archival'     dokumentacja przebiegu nauczania i dokumentacja ucznia. Zegar rusza
 *                        1 stycznia roku następującego po roku, w którym sprawę zamknięto
 *                        (koniec roku szkolnego albo odejście ucznia) — reguła JRWA. Zadanie
 *                        NIGDY tego nie kasuje samo: wytwarza **propozycję brakowania**
 *                        (GET /api/admin/retention/proposal), którą zatwierdza ktoś INNY niż
 *                        autor propozycji (POST …/approve, zasada czworga oczu) podając numer
 *                        zgody Archiwum Państwowego, i dopiero POST …/run z tym identyfikatorem
 *                        i z jednorazowym `confirmationToken` wykonuje usunięcie.
 *                        Kategoria A i wszystko z flagą `archiveCategoryA` nie trafia do
 *                        propozycji w ogóle.
 *
 *   kind: 'operational'  dzienniki techniczne: rejestr zdarzeń, sesje, doręczenia push,
 *                        powiadomienia, wiadomości, kody rejestracyjne, opinie o prototypie.
 *                        Okres liczy się wprost od daty wpisu (okno przesuwne), a POST …/run bez
 *                        propozycji sprząta tylko je.
 *
 *   kind: 'reference'    dane robocze programu: słowniki, plan lekcji, konta, materiały
 *                        dydaktyczne. Nie są dokumentacją z okresem przechowywania i nie mają
 *                        zegara — znikają wtedy, gdy kończy się życie samego wiersza (usunięcie
 *                        konta, art. 17), nigdy „z urzędu”. `neverDelete: true`.
 *
 *   GET  /api/admin/retention/runs       historia brakowań + plan na dziś (jeden skan)
 *   GET  /api/admin/retention/proposal   propozycja brakowania (klasy archiwalne), idempotentna
 *   POST /api/admin/retention/approve    { proposalId, archiveConsentReference, reason }
 *                                        → { confirmationToken } — zatwierdza KTOŚ INNY
 *   POST /api/admin/retention/run        { confirm:true, reason } → tylko klasy operacyjne
 *                                        { confirm:true, reason, proposalId, confirmationToken }
 *
 * Trwałość (R3-02): `run` najpierw zapisuje protokół `retentionRuns` i wpis audytowy
 * `retention_executed`, potem `db.flush()`, i DOPIERO POTEM usuwa. Zabicie procesu w trakcie
 * sprzątania zostawia na dysku protokół ze statusem `started` — wiadomo, co się działo.
 *
 * Usuwanie jest bezpieczne dla dziennika dopisywania (docs/STORAGE.md §2): podmieniamy całą
 * kolekcję (`db.data.x = keep`), co wymusza przepisanie migawki, zamiast dopisywać tysiące
 * operacji `d` do `.jsonl`. Nigdzie nie materializujemy list identyfikatorów (R3-03) — propozycja
 * niesie liczby i datę odcięcia, a wykonanie wylicza wiersze tą samą regułą jeszcze raz.
 *
 * Uruchamiane raz na dobę zadaniem crona po stronie VPS (sprząta tylko klasy operacyjne):
 *   15 3 * * *  curl -fsS -X POST -H 'Content-Type: application/json' -b "$COOKIE" \
 *               --data '{"confirm":true,"reason":"nocne sprzątanie dzienników technicznych"}' \
 *               http://127.0.0.1:3000/api/admin/retention/run
 *
 * Pełny opis tabeli, reguły zegara, macierzy usuwania i ścieżki zatwierdzania: docs/RETENTION.md.
 */
const { httpError } = require('../lib/router');
const U = require('../lib/util');
const D = require('../lib/domain');
const { schoolYearFor } = require('../lib/blank-seed');
const { RAW } = require('../lib/store');
const LA = require('../lib/log-access');        // rejestracja rodzajów dzienników do komentarzy
const LC = require('./log-comments');           // liczniki komentarzy przy wierszach list

const ADMIN = { roles: ['admin'] };
const BRAKOWANIE = { roles: ['admin', 'principal'] };

const JRWA_NOTE = 'Kategorię i okres potwierdź z jednolitym rzeczowym wykazem akt (JRWA) tej szkoły, zatwierdzonym przez właściwe Archiwum Państwowe — to on, a nie ustawienie w programie, rozstrzyga.';

/* ------------------------------------------------------------------ tabela klas dokumentacji --
   `years` albo `days` (klasy krótkookresowe). `clock`:
     'school-year-end' — zegar od 1 stycznia po roku szkolnym, w którym powstał wpis,
     'pupil-left'      — zegar od 1 stycznia po roku, w którym uczeń opuścił szkołę,
     'event'           — zegar od daty samego wpisu (dla klas archiwalnych i tak zaokrąglony
                         do 1 stycznia roku następnego, dla operacyjnych liczony wprost).
   `erasure` — co z tą klasą robi żądanie z art. 17 RODO (server/routes/privacy.js):
     'anonymise' — wiersz zostaje, pola tożsamości zastępuje trwały pseudonim (daty i oceny bez zmian),
     'delete'    — wiersze osoby znikają,
     'unlink'    — z list członkostwa (klasa, grupa) znika identyfikator osoby, wiersz zostaje,
     'keep'      — nie ruszamy w ogóle; `erasureReason` mówi dlaczego. */
const DEFAULT_CLASSES = [
  {
    class: 'dziennik-lekcyjny', label: 'Dziennik lekcyjny (frekwencja, tematy, uwagi, usprawiedliwienia)', category: 'B5', years: 5,
    clock: 'school-year-end', kind: 'archival', verified: false, erasure: 'anonymise',
    collections: ['attendance', 'lessons', 'remarks', 'excuses', 'attendanceAlerts', 'tests', 'substitutions'],
    dateFields: ['date', 'from', 'at', 'createdAt'],
    legalBasis: 'JRWA MEN / wzorcowy wykaz NDAP; rozporządzenie MEN z 25.08.2017 r. w sprawie sposobu prowadzenia dokumentacji przebiegu nauczania',
    note: 'Raport Gemini §7 podaje B5. Triaż ocenił cały wiersz na B. Usprawiedliwienia, zapowiedzi sprawdzianów, alerty frekwencyjne i zastępstwa to wpisy tego samego dziennika i dzielą jego kategorię. ' + JRWA_NOTE
  },
  {
    class: 'arkusze-ocen', label: 'Arkusze ocen, świadectwa i oceny, które je zasilają', category: 'B50', years: 50,
    clock: 'school-year-end', kind: 'archival', verified: false, erasure: 'anonymise',
    collections: ['grades', 'behaviorGrades', 'descriptiveGrades', 'reportCardHistory', 'documents'],
    legalBasis: 'Ustawa z 14.07.1983 r. o narodowym zasobie archiwalnym i archiwach; JRWA szkoły',
    note: 'Oceny cząstkowe trafiają do arkusza ocen, więc dzielą jego kategorię — brakowanie ocen wcześniej niż arkusza pozbawiłoby arkusz podstawy. Wydane świadectwa (`documents`) to ten sam ciąg dokumentacji. ' + JRWA_NOTE
  },
  {
    class: 'ksiega-uczniow', label: 'Księga uczniów, legitymacje i rejestr duplikatów', category: 'B50', years: 50,
    clock: 'pupil-left', kind: 'archival', verified: false, archiveCategoryA: true, erasure: 'anonymise',
    collections: ['students', 'studentIds', 'duplicates'],
    legalBasis: 'JRWA szkoły; kwalifikacja archiwalna ustalana przez właściwe Archiwum Państwowe',
    note: 'Wiele archiwów kwalifikuje księgę uczniów jako kategorię A (wieczyście). Dopóki szkoła tego nie rozstrzygnie, program NIGDY nie proponuje jej do brakowania (archiveCategoryA). Żądanie z art. 17 anonimizuje wpis, nie usuwa go — numer w księdze i przebieg nauki zostają. ' + JRWA_NOTE
  },
  {
    class: 'ksiega-ewidencji-dzieci', label: 'Księga ewidencji dzieci z obwodu (kontrola obowiązku szkolnego)', category: 'B50', years: 50,
    clock: 'event', kind: 'archival', verified: false, erasure: 'anonymise',
    collections: ['districtChildren'], dateFields: ['reportedAt', 'at', 'createdAt'],
    legalBasis: 'Art. 40–41 ustawy z 14.12.2016 r. Prawo oświatowe (kontrola spełniania obowiązku szkolnego); JRWA szkoły',
    note: 'Rejestr ustawowy prowadzony obok księgi uczniów — dotyczy dzieci, które do tej szkoły nie chodzą. Część wykazów kwalifikuje go jako kategorię A. ' + JRWA_NOTE
  },
  {
    class: 'uchwaly-klasyfikacyjne', label: 'Ślady uchwał klasyfikacyjnych (zamknięcia okresów)', category: 'B5', years: 5,
    clock: 'school-year-end', kind: 'archival', verified: false, erasure: 'anonymise',
    collections: ['semesterLocks'],
    legalBasis: 'JRWA szkoły — dokumentacja klasyfikowania i promowania uczniów',
    note: 'To NIE są protokoły rady pedagogicznej: `semesterLocks` to techniczny zamek okresu z numerem uchwały (`resolutionNo`) — odwołanie do uchwały, którą szkoła przechowuje poza programem. EdMat nie prowadzi protokołów rady pedagogicznej (kategoria A) w ogóle; odpowiada za nie szkoła. ' + JRWA_NOTE
  },
  {
    class: 'pakiet-archiwalny', label: 'Kopia robocza pakietu archiwalnego roku (§ 22)', category: 'B5', years: 5,
    clock: 'school-year-end', kind: 'archival', verified: false, erasure: 'keep',
    erasureReason: 'Pakiet jest zapieczętowany i podpisany — jego zawartość poprawia się przez ponowne wytworzenie pakietu, nie przez edycję wiersza. Żądanie z art. 17 obsługuje się na dokumentacji źródłowej, a pakiet wytwarza się na nowo.',
    collections: ['archives'],
    legalBasis: '§ 22 rozporządzenia MEN z 25.08.2017 r.; ustawa o narodowym zasobie archiwalnym — w zakresie treści pakietu',
    note: 'Podpisany oryginał na nośniku przechowuje SZKOŁA; w programie zostaje kopia robocza. Kategorię pakietu wyznacza jego treść (dziennik B5, arkusze B50), więc kopia robocza nie może być kategorią A — inaczej dokument B5 stawałby się wieczysty tylko dlatego, że opakowano go w zip. Ustaw B5 dopiero po potwierdzeniu, że szkoła ma podpisany oryginał na nośniku. ' + JRWA_NOTE
  },
  {
    class: 'protokoly-brakowania', label: 'Protokoły brakowania i propozycje brakowania', category: 'A', years: null,
    clock: 'event', kind: 'archival', verified: true, erasure: 'keep',
    erasureReason: 'Protokół brakowania jest dowodem zgodności z prawem archiwalnym i sam w sobie jest rejestrem zdarzeń — nie podlega usunięciu ani anonimizacji.',
    collections: ['retentionRuns', 'retentionProposals'],
    legalBasis: 'Ustawa z 14.07.1983 r. o narodowym zasobie archiwalnym i archiwach — dokumentacja z brakowania (spisy i protokoły) jest materiałem archiwalnym',
    note: 'Kategoria A: protokół brakowania zostaje na zawsze. Zadanie retencyjne nie usunie go nigdy i nie wpisze go do żadnej propozycji.'
  },
  {
    class: 'dokumentacja-ppp', label: 'Dokumentacja pomocy psychologiczno-pedagogicznej (IPET, WOPFU, opinie, notatki)', category: 'B5', years: 5,
    clock: 'pupil-left', kind: 'archival', verified: false, erasure: 'anonymise', article9: true,
    collections: ['ipet', 'ipetImplementations', 'wopfu', 'supportDocuments', 'supportSessions', 'supportEvaluations', 'confidentialNotes', 'communityInterviews', 'speechSessions', 'otherActivities', 'reportRequests'],
    legalBasis: 'JRWA szkoły; rozporządzenie MEN w sprawie pomocy psychologiczno-pedagogicznej',
    note: '„5 lat od opuszczenia szkoły przez ucznia” to ta pozycja raportu, której triaż nie potrafił potwierdzić — zweryfikuj ją jako pierwszą. Dane szczególnej kategorii (art. 9 RODO): żądanie z art. 17 anonimizuje je, nie pomija. Wiersze zajęć grupowych (`otherActivities`) nie mają ucznia, więc zegar „odejście ucznia” dla nich nie rusza — brakuje się je razem z rocznikiem, ręcznie. ' + JRWA_NOTE
  },
  {
    class: 'dokumentacja-medyczna', label: 'Dokumentacja gabinetu profilaktyki zdrowotnej', category: 'B20', years: 20,
    clock: 'event', kind: 'archival', verified: true, erasure: 'anonymise', article9: true,
    collections: ['nurseVisits', 'nurseVisitAccessLog'],
    legalBasis: 'Art. 29 ust. 1 ustawy z 6.11.2008 r. o prawach pacjenta i Rzeczniku Praw Pacjenta',
    note: 'Okres ustawowy, nie JRWA: 20 lat od końca roku kalendarzowego, w którym dokonano ostatniego wpisu. Dlatego zegar zaokrągla się do 1 stycznia roku następnego. Dane o zdrowiu (art. 9 RODO) — art. 17 anonimizuje, nie usuwa.'
  },
  {
    class: 'rejestr-wypadkow', label: 'Rejestr wypadków uczniów', category: 'B25', years: 25,
    clock: 'event', kind: 'archival', verified: false, erasure: 'anonymise', article9: true,
    collections: ['incidents'],
    legalBasis: 'Rozporządzenie MENiS w sprawie bezpieczeństwa i higieny w szkołach (rejestr wypadków); JRWA szkoły',
    note: 'Raport podaje B25, triaż tego NIE potwierdził. Spotykane są także B10 i A. ' + JRWA_NOTE
  },
  {
    class: 'prace-uczniowskie', label: 'Prace domowe, prace kontrolne i postępy w kursach', category: 'Bc', years: 2,
    clock: 'school-year-end', kind: 'archival', verified: false, erasure: 'anonymise',
    collections: ['homework', 'homeworkSubmissions', 'courseEnrollments', 'courseProgress', 'quizAttempts', 'courseThreads', 'coursePosts'],
    dateFields: ['date', 'receivedAt', 'dueAt', 'at', 'createdAt'],
    legalBasis: 'JRWA szkoły — wytwory ucznia i prace kontrolne mają krótkotrwałe znaczenie praktyczne (kat. Bc/B2); dokumentacją przebiegu nauczania jest ocena z nich, w klasie arkusze-ocen',
    note: 'Dwa lata to okres, po którym praca domowa nie ma już znaczenia dowodowego — ocena za nią została w arkuszu ocen. Mimo krótkiego okresu klasa jest archiwalna: nic tu nie znika bez decyzji człowieka. ' + JRWA_NOTE
  },
  {
    class: 'dokumentacja-finansowa', label: 'Opłaty, wpłaty i konta stołówkowe', category: 'B5', years: 5,
    clock: 'event', kind: 'archival', verified: false, erasure: 'anonymise',
    collections: ['payments', 'receipts', 'cafeteriaAccounts', 'cafeteriaCancellations'],
    dateFields: ['paidAt', 'dueDate', 'date', 'at', 'createdAt', 'issuedAt'],
    legalBasis: 'Art. 74 ust. 2 ustawy z 29.09.1994 r. o rachunkowości (dowody księgowe — 5 lat); JRWA szkoły',
    note: 'Okres liczony od początku roku następującego po roku obrotowym. Konta stołówkowe bez daty rozliczenia (`cafeteriaAccounts` z samym `period`) nie mają zegara i zostają do ręcznej decyzji. ' + JRWA_NOTE
  },
  {
    class: 'dziennik-swietlicy', label: 'Dziennik zajęć świetlicy i upoważnienia do odbioru', category: 'B5', years: 5,
    clock: 'school-year-end', kind: 'archival', verified: false, erasure: 'anonymise',
    collections: ['careCheckins', 'carePickups', 'careAuthorizedPickups'],
    dateFields: ['date', 'at', 'createdAt', 'validFrom'],
    legalBasis: '§ 9 rozporządzenia MEN z 25.08.2017 r. (dziennik zajęć świetlicy); JRWA szkoły',
    note: 'Upoważnienie do odbioru dziecka jest oświadczeniem rodzica i zostaje tyle, co dziennik świetlicy. ' + JRWA_NOTE
  },
  {
    class: 'biblioteka', label: 'Wypożyczenia i księgozbiór biblioteki', category: 'B5', years: 5,
    clock: 'event', kind: 'archival', verified: false, erasure: 'anonymise',
    collections: ['libraryLoans', 'libraryItems'], dateFields: ['returnedAt', 'loanedAt', 'addedAt', 'at', 'createdAt'],
    legalBasis: 'JRWA szkoły; rozporządzenie MKiDN ws. ewidencji materiałów bibliotecznych',
    note: 'Historia czytelnicza ucznia to dane osobowe — zostaje najwyżej tak długo, jak rozliczenie wypożyczenia. Księga inwentarzowa (`libraryItems`) bywa kwalifikowana wyżej niż B5; sprawdź to z JRWA. ' + JRWA_NOTE
  },
  {
    class: 'wycieczki-i-zebrania', label: 'Wycieczki, zebrania, konsultacje i spotkania online', category: 'B5', years: 5,
    clock: 'school-year-end', kind: 'archival', verified: false, erasure: 'anonymise',
    collections: ['trips', 'meetings', 'meetingAttendance', 'consultationSlots', 'videoMeetings'],
    dateFields: ['date', 'from', 'start', 'at', 'createdAt'],
    legalBasis: 'Rozporządzenie MEN ws. warunków i sposobu organizowania krajoznawstwa i turystyki (karta wycieczki); JRWA szkoły',
    note: 'Lista obecności rady pedagogicznej, jeśli szkoła prowadzi ją w programie, jest załącznikiem do protokołu przechowywanego poza EdMat (kategoria A) — tutaj zostaje jej ślad. ' + JRWA_NOTE
  },
  {
    class: 'dziennik-zdarzen', label: 'Rejestr zdarzeń (audyt)', category: 'B5', years: 5,
    clock: 'event', kind: 'operational', verified: true, erasure: 'keep',
    erasureReason: 'Rejestr zdarzeń jest dowodem rozliczalności (art. 5 ust. 2 RODO) i NIGDY nie jest ruszany przez żądanie z art. 17 — protokół usunięcia danych sam jest wpisem w tym rejestrze.',
    collections: ['audit'], configYears: 'logRetentionYears', configMinYears: 'logRetentionMinYears',
    legalBasis: 'RODO art. 5 ust. 2 (rozliczalność) i art. 32; rozporządzenie KRI — polityka szkoły',
    note: 'Okres bierze się z config.logRetentionYears (minimum 5 lat, PATCH /api/admin/retention). Rejestr jest WORM: pojedynczego wpisu nie da się zmienić ani usunąć — znikają wyłącznie całe roczniki starsze niż polityka.'
  },
  {
    class: 'wiadomosci', label: 'Wiadomości i ogłoszenia', category: 'B5', years: 5,
    clock: 'event', kind: 'operational', verified: true, erasure: 'delete',
    collections: ['messages', 'announcements'],
    legalBasis: 'Polityka szkoły; RODO art. 5 ust. 1 lit. e (ograniczenie przechowywania)',
    note: 'Moduł korespondencji nie jest dokumentacją przebiegu nauczania. Decyzje administracyjne idą e-Doręczeniami, nie tędy.'
  },
  {
    class: 'powiadomienia', label: 'Powiadomienia w aplikacji', category: 'Bc', days: 365,
    clock: 'event', kind: 'operational', verified: true, erasure: 'delete',
    collections: ['notifications'],
    legalBasis: 'Polityka szkoły; RODO art. 5 ust. 1 lit. e',
    note: 'Dokumentacja o krótkotrwałym znaczeniu praktycznym (kat. Bc).'
  },
  {
    class: 'doreczenia-push', label: 'Dziennik doręczeń powiadomień push', category: 'Bc', days: 90,
    clock: 'event', kind: 'operational', verified: true, erasure: 'delete',
    collections: ['pushDeliveries'],
    legalBasis: 'Polityka szkoły; dowód doręczenia komunikatu kryzysowego',
    note: 'Subskrypcje przeglądarek (pushSubscriptions) mają własną klasę — znikają przy wypisaniu albo po 404/410 z usługi push.'
  },
  {
    class: 'sesje', label: 'Sesje i dziennik logowań', category: 'Bc', days: 90,
    clock: 'event', kind: 'operational', verified: true, erasure: 'delete',
    collections: ['sessions'], dateFields: ['lastActivity', 'createdAt', 'at'], configDays: 'sessionRetentionDays',
    legalBasis: 'Polityka bezpieczeństwa; rozporządzenie KRI (rejestrowanie dostępu)',
    note: 'Okres bierze się z config.sessionRetentionDays (domyślnie 90 dni).'
  },
  {
    class: 'kody-i-importy', label: 'Kody rejestracyjne i partie importu', category: 'Bc', days: 365,
    clock: 'event', kind: 'operational', verified: true, erasure: 'delete',
    collections: ['registrationCodes', 'imports'], dateFields: ['usedAt', 'createdAt', 'at'],
    legalBasis: 'Polityka bezpieczeństwa — kod rejestracyjny jest poświadczeniem; partia importu służy wyłącznie cofnięciu pomyłki',
    note: 'Kod rejestracyjny to żywe poświadczenie dostępu do konta dziecka; po roku traci sens i znika. Partia importu niesie kopię zaimportowanych wierszy — po roku nie da się już cofnąć importu, więc kopia nie ma po co zostawać.'
  },
  {
    class: 'opinie', label: 'Opinie i zgłoszenia błędów', category: 'Bc', days: 730,
    clock: 'event', kind: 'operational', verified: true, erasure: 'delete',
    collections: ['feedback', 'issueReports'],
    legalBasis: 'Polityka zespołu EdMat — dane spoza dokumentacji szkolnej',
    note: 'Opinie zbiera wyłącznie tryb demo; zgłoszenia z przycisku „Zgłoś błąd” przyjmuje każdy tryb, bo osoba, która nie może się zalogować, ma najwięcej do powiedzenia. Jedno i drugie może nieść adres kontaktowy podany dobrowolnie — i jedno, i drugie nie jest dokumentacją szkoły. Kopia zgłoszenia trafia też do serwisu EdMat (server/routes/report-issue.js); brakowanie tutaj nie usuwa jej stamtąd.'
  },
  {
    class: 'wydarzenia-szkolne', label: 'Wydarzenia szkolne: karty, dyżury, instruktaże, ryzyko, zgody', category: 'B5', years: 5,
    clock: 'school-year-end', kind: 'archival', verified: false, erasure: 'anonymise',
    collections: ['schoolEvents', 'eventShifts', 'eventBriefings', 'eventBriefingAcks', 'eventRisks', 'eventConsents'],
    dateFields: ['date', 'at', 'createdAt'],
    legalBasis: 'JRWA szkoły — organizacja imprez i uroczystości szkolnych; art. 6 ust. 1 lit. c i e RODO',
    note: 'Karta wydarzenia z oceną ryzyka, grafikiem dyżurów i zgodami opiekunów na wolontariat to dowód, że szkoła dopełniła obowiązków organizatora — zostaje na wypadek zdarzenia ujawnionego później. Wejściówki, skany wejść i zgłoszenia żywieniowe mają własną, krótką klasę. ' + JRWA_NOTE
  },
  {
    class: 'wydarzenia-dane-ulotne', label: 'Wejściówki, skany wejść i zgłoszenia żywieniowe przy wydarzeniach', category: 'Bc', days: 30,
    clock: 'event', kind: 'operational', verified: true, erasure: 'delete',
    collections: ['eventPasses', 'eventScans', 'eventDietary'],
    dateFields: ['at', 'issuedAt'], configDays: 'eventDataRetentionDays',
    legalBasis: 'RODO art. 5 ust. 1 lit. c i e (minimalizacja i ograniczenie przechowywania)',
    note: 'Po wydarzeniu te wiersze nie mają już żadnej funkcji: wejściówka jest zużyta, skan wejścia był potrzebny tylko na bramce, a zgłoszenie żywieniowe — tylko kuchni w dniu imprezy. Zostają wyłącznie liczby zbiorcze przepisane do karty wydarzenia (`schoolEvents[].summary`). Okres bierze się z config.eventDataRetentionDays (domyślnie 30 dni).'
  },
  {
    class: 'konta-uzytkownikow', label: 'Konta użytkowników', category: 'B5', years: 5,
    clock: 'event', kind: 'reference', verified: false, erasure: 'anonymise',
    collections: ['users'], dateFields: ['closedAt', 'createdAt', 'at'],
    legalBasis: 'RODO art. 5 ust. 1 lit. e; akta osobowe pracownika prowadzi kadra POZA programem (ustawa z 10.01.2018 r. — 10 lat)',
    note: 'Konto w programie nie jest ani aktami osobowymi pracownika, ani księgą uczniów. Program nie odnotowuje jeszcze daty zamknięcia konta, więc zadanie retencyjne NIGDY nie proponuje kont do brakowania — konto zamyka sekretariat albo żądanie z art. 17 (anonimizacja: login, imię, nazwisko, e-mail, telefon). ' + JRWA_NOTE
  },
  {
    class: 'dostep-techniczny', label: 'Subskrypcje push, klucze VAPID i jednorazowe tokeny SSO', category: 'Bc', days: 90,
    clock: 'event', kind: 'reference', verified: true, erasure: 'delete',
    collections: ['pushSubscriptions', 'pushKeys', 'ssoNonces'],
    legalBasis: 'Polityka bezpieczeństwa — poświadczenia techniczne, nie dokumentacja',
    note: 'Nie sprzątamy ich z zegara: klucz VAPID szkoły musi przeżyć, a subskrypcja żyje tak długo, jak przeglądarka. Znikają przy wypisaniu, po 404/410 z usługi push albo na żądanie z art. 17.'
  },
  {
    class: 'konfiguracja-szkoly', label: 'Organizacja i słowniki (plan, oddziały, grupy, przedmioty, podstawa programowa)', category: 'Bc', years: null,
    clock: 'event', kind: 'reference', verified: true, erasure: 'unlink',
    collections: ['subjects', 'classes', 'groups', 'timetable', 'gradeCategories', 'curriculum', 'phraseBank', 'developmentAreas', 'duties'],
    legalBasis: 'Polityka szkoły — dane robocze systemu, nie dokumentacja przebiegu nauczania',
    note: 'Arkusz organizacyjny i plan lekcji szkoła prowadzi jako odrębną dokumentację (kat. B5 w JRWA); tutaj są ich robocze odpowiedniki, z których program żyje na co dzień. Zadanie retencyjne ich nie rusza; żądanie z art. 17 wypisuje ucznia z list członkostwa (oddział, grupa), a reszta wiersza zostaje.'
  },
  {
    class: 'materialy-dydaktyczne', label: 'Kursy i materiały nauczyciela', category: 'Bc', years: null,
    clock: 'event', kind: 'reference', verified: true, erasure: 'keep',
    erasureReason: 'Nie zawierają danych osobowych ucznia — autorem i właścicielem jest nauczyciel, on je usuwa.',
    collections: ['courses', 'courseUnits', 'courseItems', 'materials'],
    legalBasis: 'Polityka szkoły — wytwory nauczyciela, nie dokumentacja przebiegu nauczania',
    note: 'Postępy i prace uczniów z tych kursów mają własną klasę (prace-uczniowskie) i własny okres.'
  },
  {
    class: 'komentarze-do-wpisow', label: 'Komentarze i notatki prywatne do wpisów dzienników', category: 'Bc', years: null,
    clock: 'event', kind: 'reference', verified: true, erasure: 'delete',
    collections: ['logComments'],
    ruleNote: 'Bez własnego okresu: komentarz dzieli los wpisu, pod którym stoi — znika razem z brakowanym wierszem, nigdy przed nim.',
    legalBasis: 'Polityka szkoły; RODO art. 5 ust. 1 lit. e — komentarz nie jest samodzielnym dokumentem, tylko dopiskiem do wpisu',
    note: 'Komentarz do wpisu dokumentacji sam jest dokumentacją, ale nie ma własnego zegara: brakowanie wpisu zabiera razem z nim jego komentarze i notatki (licznik `logComments` w protokole), a żądanie z art. 17 usuwa komentarze usuniętej osoby i te, które wisiały pod jej usuniętymi wpisami.'
  }
];

/** Świeża kopia tabeli domyślnej — seed 00-base wkłada ją do config.retention. */
function DEFAULT_RETENTION() {
  return {
    version: 3, jrwaVerified: false, note: JRWA_NOTE,
    source: 'docs/research/2026-09-23-gemini-raw.md §7 + docs/research/2026-09-23-gemini-triage.md (wiersz 7, pakiet R5), rozszerzone w rundzie 3 o 46 kolekcji bez klasy (docs/review/round3/domain.md §3)',
    classes: DEFAULT_CLASSES.map((c) => Object.assign({}, c, { collections: c.collections.slice(), dateFields: c.dateFields ? c.dateFields.slice() : undefined }))
  };
}

/* ------------------------------------------------------------------------- migracja na odczyt --
   Starsze instalacje trzymały w config.retention płaską mapę „klasa → liczba lat” albo samą listę
   klas bez kategorii. Czytamy jedno i drugie i uzupełniamy brakujące pola z tabeli domyślnej. */
const LEGACY_KEYS = {
  audit: 'dziennik-zdarzen', auditYears: 'dziennik-zdarzen', log: 'dziennik-zdarzen', logs: 'dziennik-zdarzen', logRetentionYears: 'dziennik-zdarzen',
  sessions: 'sesje', sessionDays: 'sesje', sessionRetentionDays: 'sesje',
  grades: 'arkusze-ocen', gradesArchive: 'arkusze-ocen', gradesArchiveRetentionYears: 'arkusze-ocen', arkusze: 'arkusze-ocen',
  lessons: 'dziennik-lekcyjny', attendance: 'dziennik-lekcyjny', dziennik: 'dziennik-lekcyjny', logbook: 'dziennik-lekcyjny',
  students: 'ksiega-uczniow', register: 'ksiega-uczniow', ksiega: 'ksiega-uczniow',
  support: 'dokumentacja-ppp', ppp: 'dokumentacja-ppp',
  health: 'dokumentacja-medyczna', nurse: 'dokumentacja-medyczna',
  incidents: 'rejestr-wypadkow', accidents: 'rejestr-wypadkow',
  messages: 'wiadomosci', notifications: 'powiadomienia', pushDeliveries: 'doreczenia-push', feedback: 'opinie'
};
/* Klasy, których nie ma już w tabeli: zapisana konfiguracja sprzed rundy 3 nadal je wymienia. */
const RETIRED_CLASSES = {
  /* D3-15: `semesterLocks` i `archives` nie są protokołami rady pedagogicznej — EdMat ich nie prowadzi. */
  'protokoly-rady-pedagogicznej': ['uchwaly-klasyfikacyjne', 'pakiet-archiwalny']
};

function mergeClass(base, patch) {
  const out = Object.assign({}, base, patch);
  /* zapisana wartość w latach wygrywa z domyślnym okresem dziennym i odwrotnie */
  if (base && patch && patch.years !== undefined && patch.days === undefined && base.days !== undefined) delete out.days;
  if (base && patch && patch.days !== undefined && patch.years === undefined && base.years !== undefined) out.years = null;
  out.collections = (patch && Array.isArray(patch.collections) && patch.collections.length ? patch.collections : (base ? base.collections : [])).slice();
  if (!out.kind) out.kind = 'archival';
  if (out.verified === undefined) out.verified = false;
  if (!out.erasure) out.erasure = out.kind === 'operational' ? 'delete' : 'anonymise';
  return out;
}

/** Nakłada zapisane ustawienia na tabelę domyślną; przyjmuje trzy kształty (v2/v3, lista, płaska mapa). */
function migrateRetention(raw) {
  const def = DEFAULT_RETENTION();
  const byId = new Map(def.classes.map((c) => [c.class, c]));
  if (!raw || typeof raw !== 'object') return Object.assign(def, { migratedFrom: raw === undefined || raw === null ? 'defaults' : 'unknown' });

  const list = Array.isArray(raw) ? raw : Array.isArray(raw.classes) ? raw.classes : null;
  if (list) {
    const out = [];
    const seen = new Set();
    let retired = 0;
    for (const c of list) {
      if (!c || !c.class) continue;
      if (RETIRED_CLASSES[c.class]) { retired++; continue; }        // klasa wycofana — zastąpiły ją nowe
      if (seen.has(c.class)) continue;
      seen.add(c.class);
      out.push(mergeClass(byId.get(c.class) || null, c));
    }
    for (const c of def.classes) if (!seen.has(c.class)) out.push(c);       // klasa dodana w nowszej wersji programu
    return { version: 3, jrwaVerified: !!(raw.jrwaVerified), note: raw.note || def.note, source: raw.source || def.source, classes: out, retiredClasses: retired, migratedFrom: Array.isArray(raw) ? 'list' : (raw.version >= 2 ? 'v' + raw.version : 'list') };
  }

  /* płaska mapa { audit: 5, sessions: 30, grades: 50 } — liczba to lata, a dla klas dziennych dni */
  let touched = 0;
  for (const [k, v] of Object.entries(raw)) {
    if (typeof v !== 'number' || !Number.isFinite(v)) continue;
    const id = LEGACY_KEYS[k] || (byId.has(k) ? k : null);
    if (!id) continue;
    const c = byId.get(id); if (!c) continue;
    if (c.days !== undefined) c.days = Math.max(1, Math.round(v)); else c.years = Math.max(0, Math.round(v));
    touched++;
  }
  return Object.assign(def, { jrwaVerified: !!raw.jrwaVerified, migratedFrom: touched ? 'legacy-flat' : 'defaults', migratedKeys: touched });
}

/** Czy tej klasy program nie usunie nigdy — kategoria A, kwalifikacja archiwum albo dane robocze. */
function neverDeleteOf(cls) { return !!cls && (cls.category === 'A' || !!cls.archiveCategoryA || cls.kind === 'reference'); }

/** Obowiązująca polityka: config.retention po migracji + żywe pokrętła z config (PATCH /api/admin/retention). */
function policy(db) {
  const c = (db.data && db.data.config) || {};
  const p = migrateRetention(c.retention);
  for (const cls of p.classes) {
    if (cls.configYears && c[cls.configYears] !== undefined && +c[cls.configYears] > 0) cls.years = +c[cls.configYears];
    if (cls.configDays && c[cls.configDays] !== undefined && +c[cls.configDays] > 0) cls.days = +c[cls.configDays];
    if (cls.configMinYears && +c[cls.configMinYears] > 0) cls.years = Math.max(+cls.years || 0, +c[cls.configMinYears]);
    cls.neverDelete = neverDeleteOf(cls);
    if (!cls.erasure) cls.erasure = cls.kind === 'operational' ? 'delete' : 'anonymise';
  }
  const grades = p.classes.find((x) => x.class === 'arkusze-ocen');
  if (grades && +c.gradesArchiveRetentionYears > 0) grades.years = +c.gradesArchiveRetentionYears;
  p.unverified = p.classes.filter((x) => !x.verified).map((x) => x.class);
  return p;
}

const classById = (db, id) => policy(db).classes.find((c) => c.class === id) || null;

/* --------------------------------------------------------------- jedna reguła dla całej bazy --
   `policyFor(db, 'grades')` → klasa tej kolekcji (albo null). `classifyAll(db)` → każda tablica
   w magazynie z jej klasą albo z `uncovered: true`. Obie czytają tę samą politykę, więc erasure
   (privacy.js) i brakowanie (to zadanie) nie mogą się rozjechać. */
function collectionIndex(pol) {
  const map = new Map();
  for (const cls of pol.classes) for (const name of cls.collections) if (!map.has(name)) map.set(name, cls);
  return map;
}

/** Klasa dokumentacji, do której należy kolekcja — albo `null`, jeśli żadna jej nie obejmuje. */
function policyFor(db, collection) {
  return collectionIndex(policy(db)).get(String(collection)) || null;
}

const publicShape = (cls) => ({
  class: cls.class, label: cls.label, category: cls.category, kind: cls.kind,
  years: cls.years === undefined ? null : cls.years, days: cls.days === undefined ? null : cls.days,
  clock: cls.clock, collections: cls.collections.slice(), verified: !!cls.verified,
  archiveCategoryA: !!cls.archiveCategoryA, article9: !!cls.article9,
  neverDelete: neverDeleteOf(cls), erasure: cls.erasure, erasureReason: cls.erasureReason || null,
  legalBasis: cls.legalBasis, note: cls.note, rule: ruleText(cls)
});

/**
 * Każda tablica w magazynie z jej klasą — albo z `uncovered: true`. To jest ten raport, który
 * ma nigdy nie zniknąć: dopisanie kolekcji bez klasy musi być widać (D3-13).
 */
function classifyAll(db) {
  const pol = policy(db);
  const idx = collectionIndex(pol);
  const data = (db && db.data) || {};
  const out = [];
  const seen = new Set();
  for (const name of Object.keys(data)) {
    if (!Array.isArray(data[name])) continue;
    seen.add(name);
    const cls = idx.get(name);
    out.push(cls
      ? { collection: name, rows: data[name].length, uncovered: false, class: cls.class, label: cls.label, category: cls.category, kind: cls.kind, neverDelete: neverDeleteOf(cls), erasure: cls.erasure, erasureReason: cls.erasureReason || null }
      : { collection: name, rows: data[name].length, uncovered: true, class: null, label: null, category: null, kind: null, neverDelete: false, erasure: null, erasureReason: null });
  }
  /* Kolekcje, które klasa wymienia, a magazyn jeszcze ich nie założył (np. feedback) — dla porządku. */
  for (const [name, cls] of idx) {
    if (seen.has(name)) continue;
    out.push({ collection: name, rows: 0, absent: true, uncovered: false, class: cls.class, label: cls.label, category: cls.category, kind: cls.kind, neverDelete: neverDeleteOf(cls), erasure: cls.erasure, erasureReason: cls.erasureReason || null });
  }
  out.sort((a, b) => (a.collection < b.collection ? -1 : 1));
  return out;
}

/** Skrót dla raportu i karty administratora: same kolekcje bez klasy. */
function uncoveredCollections(db) { return classifyAll(db).filter((x) => x.uncovered).map((x) => x.collection); }

/* ------------------------------------------------------------------------------ reguła zegara --
   `schoolYearFor` liczy przy okazji Wielkanoc i dni wolne, a my wołamy je raz na wiersz frekwencji,
   więc wynik trzymamy w pamięci podręcznej — granica roku szkolnego zależy tylko od miesiąca. */
const SCHOOL_YEAR_END = new Map();
function schoolYearEndYear(date) {
  const key = String(date).slice(0, 7);
  let v = SCHOOL_YEAR_END.get(key);
  if (v === undefined) { v = schoolYearFor(String(date).slice(0, 10)).start + 1; SCHOOL_YEAR_END.set(key, v); }
  return v;
}

function addYears(iso, n) { const d = new Date(iso + 'T00:00:00Z'); d.setUTCFullYear(d.getUTCFullYear() + (+n || 0)); return d.toISOString().slice(0, 10); }

/** Granica retencji dla okna przesuwnego: dzisiejsza data minus `years` lat. */
function cutoffFor(today, years) { return addYears(String(today).slice(0, 10), -Math.abs(+years || 0)); }

/** Data wpisu wg pól, których używa jego kolekcja. */
function recordDate(cls, rec) {
  if (!rec || typeof rec !== 'object') return null;                 // np. developmentAreas trzyma same napisy
  const fields = (cls && cls.dateFields) || ['date', 'at', 'createdAt', 'issuedAt'];
  for (const f of fields) { const v = rec[f]; if (v && typeof v === 'string') return v.slice(0, 10); }
  return null;
}

/** Zdarzenie, od którego liczy się okres: koniec roku szkolnego, odejście ucznia albo data wpisu. */
function clockStart(cls, rec, db) {
  if (!cls) return null;
  if (cls.clock === 'pupil-left') {
    const student = rec && rec.registerNo !== undefined && rec.pesel !== undefined ? rec
      : (rec && rec.studentId && db ? db.get('students', rec.studentId) : null);
    if (!student) return null;
    /* D3-14: trzy z czterech dróg odejścia zapisywały tylko `leftAt`/`erasedAt`. Czytamy wszystkie,
       a droga administracyjna w homeroom.js ustawia od teraz `departureDate` wprost. */
    return student.departureDate || student.leftAt || (student.erasedAt ? String(student.erasedAt).slice(0, 10) : null) || null;
  }
  return recordDate(cls, rec);
}

/**
 * Pierwszy dzień, w którym wolno usunąć rekord — albo `null`, gdy nie wolno nigdy
 * (kategoria A, flaga archiveCategoryA, dane robocze, brak daty, uczeń wciąż w szkole).
 *
 * Klasy archiwalne: okres liczy się od 1 stycznia roku następującego po zdarzeniu (reguła JRWA),
 * a dla `clock: 'school-year-end'` zdarzeniem jest koniec roku szkolnego, w którym powstał wpis —
 * wpis z 23.10.2026 należy do roku 2026/2027, więc zegar rusza 1.01.2028, a B5 mija 1.01.2033.
 * Klasy operacyjne: okres liczy się wprost od daty wpisu (okno przesuwne).
 */
function deadlineFromBase(c, base) {
  if (!c || neverDeleteOf(c)) return null;
  if (!base || !/^\d{4}-\d{2}-\d{2}$/.test(base)) return null;
  if (c.kind === 'operational') {
    const end = c.days ? U.addDays(base, +c.days) : addYears(base, +c.years || 0);
    return U.addDays(end, 1);                                   // okres musi upłynąć w całości
  }
  const eventYear = c.clock === 'school-year-end' ? schoolYearEndYear(base) : +base.slice(0, 4);
  const years = c.days ? Math.ceil(+c.days / 365) : (+c.years || 0);
  return `${eventYear + 1 + years}-01-01`;
}

function retentionDeadline(cls, rec, db) {
  const c = typeof cls === 'string' ? classById(db, cls) : cls;
  if (!c) return null;
  return deadlineFromBase(c, clockStart(c, rec, db));
}

/** Czy ten wiersz przekroczył okres przechowywania na dzień `day`. */
function isDue(cls, rec, db, day) { const dl = retentionDeadline(cls, rec, db); return !!dl && dl <= day; }

/* Setki tysięcy wierszy dzielą kilkaset różnych dat, a policzenie terminu to Date + arytmetyka
   kalendarzowa. Jedno przejście po klasie zapamiętuje więc termin dla daty, nie dla wiersza. */
function deadlineMemo(cls) {
  const cache = new Map();
  return (base) => {
    if (!base) return null;
    let v = cache.get(base);
    if (v === undefined) { v = deadlineFromBase(cls, base); cache.set(base, v); }
    return v;
  };
}

/* --------------------------------------------------------------------------- plan per klasa --- */
const colOf = (db, name) => (db.data && db.data[name] ? db.col(name) : []);
/* Skan czyta i nic nie zmienia, a kolekcja ze store'u jest Proxy, które opakowuje KAŻDY wiersz
   (docs/STORAGE.md §3). Przy 586 tysiącach wierszy to samo opakowanie kosztuje więcej niż reguła,
   więc do liczenia bierzemy surową tablicę. Zapis nadal idzie przez `db.data[name] = keep`. */
const rawRows = (db, name) => { const c = colOf(db, name); const raw = c && c[RAW]; return raw || c; };

/**
 * Co w tej klasie przekroczyło okres na dzień `today` — bez żadnej zmiany w danych i **bez**
 * materializowania identyfikatorów (R3-03): policzone są liczby, a usuwanie wylicza wiersze tą
 * samą regułą jeszcze raz.
 */
function classPlan(db, cls, today) {
  const day = today || D.today(db);
  const perCollection = {};
  const deadline = deadlineMemo(cls);
  const never = neverDeleteOf(cls);
  const pupil = cls.clock === 'pupil-left';
  let due = 0; let total = 0; let next = null; let oldest = null;
  for (const name of cls.collections) {
    const col = rawRows(db, name); let n = 0;
    total += col.length;
    for (const rec of col) {
      const base = clockStart(cls, rec, db);
      const d = pupil ? (recordDate(cls, rec) || base) : base;   // poza 'pupil-left' to ta sama data
      if (d && (!oldest || d < oldest)) oldest = d;
      if (never) continue;
      const dl = deadline(base);
      if (!dl) continue;
      if (dl <= day) n++;
      else if (!next || dl < next) next = dl;
    }
    perCollection[name] = n; due += n;
  }
  return Object.assign(publicShape(cls), {
    neverDeletes: neverDeleteOf(cls),                        // nazwa sprzed R5 — karta i raport jej używają
    total, due, perCollection, nextDeadline: next, oldestRecord: oldest
  });
}

function ruleText(cls) {
  if (cls.kind === 'reference') return cls.ruleNote || 'Dane robocze programu — bez okresu przechowywania; zadanie retencyjne ich nie usuwa.';
  if (cls.category === 'A') return 'Kategoria A — przechowywanie wieczyste, bez brakowania.';
  if (cls.archiveCategoryA) return `Kategoria ${cls.category}, ale archiwum może zakwalifikować ją jako A — program nigdy nie proponuje brakowania.`;
  const period = cls.days ? `${cls.days} ${U.plural(cls.days, 'dzień', 'dni', 'dni')}` : `${cls.years} ${U.plural(cls.years, 'rok', 'lata', 'lat')}`;
  if (cls.kind === 'operational') return `${period} od daty wpisu (okno przesuwne, sprzątane automatycznie).`;
  const from = cls.clock === 'school-year-end' ? 'roku szkolnym, w którym powstał wpis'
    : cls.clock === 'pupil-left' ? 'roku, w którym uczeń opuścił szkołę' : 'roku, w którym dokonano wpisu';
  return `${period}, licząc od 1 stycznia roku następującego po ${from}; usunięcie wymaga zgody Archiwum Państwowego.`;
}

/* Skan całej bazy jest drogi (R3-03: 736 926 wierszy = ~0,9 s), więc trzymamy go w pamięci
   podręcznej na wersję magazynu. Jeśli store wystawia licznik `db.version`, plan przeżywa żądanie;
   jeśli nie — pamięć podręczna działa w obrębie jednego żądania (trasa liczy plan raz i podaje go
   dalej), a `storeVersion` zwraca null i nic się nie zapamiętuje między żądaniami. */
const PLAN_CACHE = new WeakMap();
function storeVersion(db) {
  if (!db) return null;
  const v = typeof db.version === 'function' ? db.version() : db.version;
  return typeof v === 'number' ? v : null;
}

/** Pełny plan: wiersz na klasę. Jeden skan bazy. */
function classPlans(db, today) {
  const day = today || D.today(db);
  const ver = storeVersion(db);
  if (ver !== null) {
    const hit = PLAN_CACHE.get(db);
    if (hit && hit.version === ver && hit.day === day) return hit.rows;
  }
  const rows = policy(db).classes.map((c) => classPlan(db, c, day));
  if (ver !== null) PLAN_CACHE.set(db, { version: ver, day, rows });
  return rows;
}

/* Plan nie niesie już identyfikatorów, ale wiersz z pamięci podręcznej trafia do dokumentu
   propozycji — kopiujemy, żeby zapisany wiersz i pamięć podręczna nie były tym samym obiektem. */
const publicClass = (row) => Object.assign({}, row, { collections: row.collections.slice(), perCollection: Object.assign({}, row.perCollection) });

/* ------------------------------------------------------------ plan „klasyczny” (zgodność) ----
   Odpowiedź /runs i dry-run POST /run miały od 3.5.15 ustalony kształt; zostaje bez zmian, tylko
   liczby biorą się teraz z klas 'dziennik-zdarzen' i 'sesje'. `rows` podaje wołający, żeby ani
   /runs, ani /proposal nie skanowały bazy dwa razy (R3-03). */
function plan(db, rows) {
  const c = db.data.config;
  const today = D.today(db);
  rows = rows || classPlans(db, today);
  const auditRow = rows.find((r) => r.class === 'dziennik-zdarzen') || { due: 0, total: 0 };
  const sessionRow = rows.find((r) => r.class === 'sesje') || { due: 0, total: 0 };
  const years = Math.max(+(auditRow.years || 0) || +c.logRetentionYears || 5, +c.logRetentionMinYears || 5);
  const cutoff = cutoffFor(today, years);
  const sessionDays = Math.max(1, +(sessionRow.days || 0) || +c.sessionRetentionDays || 90);
  const sessionCutoff = U.addDays(today, -sessionDays);
  const auditCol = rawRows(db, 'audit');
  /* byAction/byYear dotyczą wyłącznie rejestru zdarzeń, więc liczymy je jednym przejściem po nim,
     zamiast zbierać identyfikatory wszystkich klas (R3-03). */
  const auditCls = policy(db).classes.find((x) => x.class === 'dziennik-zdarzen');
  const byAction = {}; const byYear = {}; let expiring = 0;
  if (auditCls) for (const a of auditCol) {
    if (!isDue(auditCls, a, db, today)) continue;
    expiring++;
    byAction[a.action] = (byAction[a.action] || 0) + 1;
    byYear[String(a.at).slice(0, 4)] = (byYear[String(a.at).slice(0, 4)] || 0) + 1;
  }
  const operational = rows.filter((r) => r.kind === 'operational');
  const archival = rows.filter((r) => r.kind === 'archival');
  const reference = rows.filter((r) => r.kind === 'reference');
  const uncovered = uncoveredCollections(db);
  return {
    today, logRetentionYears: years, cutoff, sessionRetentionDays: sessionDays, sessionCutoff,
    audit: { total: auditCol.length, expiring, byAction, byYear, oldest: auditCol.reduce((m, a) => (!m || a.at < m ? a.at : m), null) },
    sessions: { total: sessionRow.total, expiring: sessionRow.due },
    operational: operational.map(publicClass),
    archival: archival.map(publicClass),
    reference: reference.map(publicClass),
    operationalDue: operational.reduce((n, r) => n + r.due, 0),
    archivalDue: archival.reduce((n, r) => n + r.due, 0),
    unverified: rows.filter((r) => !r.verified).map((r) => r.class),
    uncovered, uncoveredCount: uncovered.length,
    _rows: rows,
  };
}
function publicPlan(p) { const { _rows, ...rest } = p; return rest; }

/* ------------------------------------------------------------------------- usuwanie rekordów -- */
/**
 * Usuwa z kolekcji wszystko, co w tej klasie przekroczyło okres na dzień `day`, podmieniając
 * kolekcję w całości (migawka zamiast tysięcy wierszy „d”). Predykat zamiast listy id: nic nie
 * rośnie w pamięci i nie ma ryzyka, że propozycja wskazuje wiersz, którego już nie ma (R3-03).
 */
function sweepCollection(db, cls, name, day, deadline, watch) {
  const col = rawRows(db, name);
  if (!col.length) return 0;
  const dl = deadline || deadlineMemo(cls);
  const keep = col.filter((row) => {
    const d = dl(clockStart(cls, row, db));
    if (!(d && d <= day)) return true;
    /* Komentarz do wpisu nie ma własnego zegara — notujemy identyfikator brakowanego wiersza, ale
       tylko takiego, pod którym ktoś coś napisał: komentarzy są dziesiątki, wierszy setki tysięcy. */
    if (watch && watch.commented.has(row.id)) watch.removed.add(row.id);
    return false;
  });
  const removed = col.length - keep.length;
  if (removed) {
    /* F4 — wiersze z plikami na dysku (data/school/files/<kolekcja>/<id>/) oddają katalog razem z wierszem. */
    if (name === 'archives') { const B = require('../lib/blobs'); const keepIds = new Set(keep.map((r) => r.id)); for (const r of col) if (!keepIds.has(r.id)) { try { B.del(db, 'archives', r.id); } catch (e) { /* katalog już nie istnieje */ } } }
    db.data[name] = keep;
  }
  return removed;
}

/** Sprząta wskazane klasy tą samą regułą, którą liczy raport. */
function sweepClasses(db, classes, day, watch) {
  const deleted = {}; const byClass = {}; let total = 0;
  for (const cls of classes) {
    if (neverDeleteOf(cls)) continue;                       // bramka bezpieczeństwa, nie tylko filtr wołającego
    let n = 0;
    const deadline = deadlineMemo(cls);
    for (const name of cls.collections) {
      const removed = sweepCollection(db, cls, name, day, deadline, watch);
      deleted[name] = (deleted[name] || 0) + removed;
      n += removed;
    }
    byClass[cls.class] = n; total += n;
  }
  return { deleted, byClass, total };
}

/* ------------------------------------------------------- komentarze giną razem ze swoim wpisem --
   Klasa 'komentarze-do-wpisow' nie ma zegara, więc zadanie nigdy nie usunie komentarza samego z
   siebie. Usuwa go dopiero to, że zniknął wpis, pod którym stał — a to widać wyłącznie w trakcie
   sprzątania. Stąd `watch`: zbiór identyfikatorów skomentowanych wpisów wchodzi do sweepu, zbiór
   brakowanych z niego wychodzi, a `dropCommentsFor` domyka rzecz jednym przejściem po logComments. */
function commentWatch(db) {
  const commented = new Set();
  for (const c of colOf(db, 'logComments')) commented.add(c.entryId);
  return { commented, removed: new Set() };
}
/** Usuwa komentarze i notatki wiszące pod wskazanymi wpisami. Zwraca licznik i rozbicie na rodzaje. */
function dropCommentsFor(db, ids) {
  const out = { removed: 0, byKind: {} };
  if (!ids || !ids.size) return out;
  const col = colOf(db, 'logComments');
  if (!col.length) return out;
  const keep = col.filter((c) => {
    if (!ids.has(c.entryId)) return true;
    out.byKind[c.kind] = (out.byKind[c.kind] || 0) + 1; out.removed++;
    return false;
  });
  if (out.removed) db.data.logComments = keep;
  return out;
}

/** Sprząta klasy operacyjne — to jest ta część, która nie wymaga zgody archiwum. */
function sweepOperational(db, day) {
  const classes = policy(db).classes.filter((c) => c.kind === 'operational' && !neverDeleteOf(c));
  const watch = commentWatch(db);
  const out = sweepClasses(db, classes, day || D.today(db), watch);
  const lc = dropCommentsFor(db, watch.removed);
  out.deleted.logComments = lc.removed;
  out.byClass['komentarze-do-wpisow'] = lc.removed;
  if (out.deleted.audit === undefined) out.deleted.audit = 0;
  if (out.deleted.sessions === undefined) out.deleted.sessions = 0;
  return out;
}

/* ------------------------------------------------------------------------ propozycja brakowania */
const proposalId = (today) => 'prop_' + today;

/** Klasy archiwalne, które wolno w ogóle zaproponować (kategoria A i flaga archiwum odpadają). */
function proposableRows(rows) {
  return rows.filter((r) => r.kind === 'archival' && !r.neverDelete);
}

/**
 * Buduje (i zapamiętuje) propozycję brakowania na dziś. Idempotentne: jeden wiersz na dzień.
 * Wiersz niesie LICZBY per klasa i datę odcięcia — nigdy listy identyfikatorów (R3-03).
 */
function buildProposal(db, userId, rows) {
  const today = D.today(db);
  const id = proposalId(today);
  const existing = db.get('retentionProposals', id);
  if (existing && existing.status !== 'pending') return existing;

  const due = proposableRows(rows).filter((r) => r.due > 0);
  const byClass = {}; const perCollection = {}; let total = 0;
  for (const r of due) {
    byClass[r.class] = r.due; total += r.due;
    perCollection[r.class] = Object.assign({}, r.perCollection);
  }
  const body = {
    id, at: U.now(), byUserId: (existing && existing.byUserId) || userId || null, today, cutoff: today, status: 'pending',
    classes: due.map(publicClass), byClass, perCollection, total,
    approvedBy: null, approvedAt: null, archiveConsentReference: null,
    confirmationToken: null, confirmationUsedAt: null, executedAt: null, runId: null
  };
  if (existing) { Object.assign(existing, body); db.save(); return existing; }
  return db.insert('retentionProposals', body);
}

function proposalView(db, p, rows) {
  const blocked = rows.filter((r) => r.neverDelete && r.kind !== 'reference').map((r) => ({ class: r.class, label: r.label, category: r.category, archiveCategoryA: r.archiveCategoryA, reason: r.rule }));
  const unverified = (p.classes || []).filter((c) => !c.verified).map((c) => c.class);
  return {
    proposalId: p.id, today: p.today, cutoff: p.cutoff || p.today, status: p.status, at: p.at, byUserId: p.byUserId,
    classes: p.classes || [], byClass: p.byClass || {}, perCollection: p.perCollection || {}, total: p.total || 0,
    approvedBy: p.approvedBy, approvedAt: p.approvedAt, archiveConsentReference: p.archiveConsentReference,
    executedAt: p.executedAt, runId: p.runId,
    neverDeleted: blocked, unverified,
    requiresConsent: true, requiresSecondPerson: true,
    fourEyes: 'Propozycję zatwierdza inne konto niż to, które ją utworzyła; wykonanie wymaga jednorazowego potwierdzenia wydanego przy zatwierdzeniu.',
    message: p.total
      ? `Propozycja brakowania na ${U.fmtDate(p.today)}: ${p.total} ${U.plural(p.total, 'pozycja', 'pozycje', 'pozycji')} w ${Object.keys(p.byClass || {}).length} ${U.plural(Object.keys(p.byClass || {}).length, 'klasie', 'klasach', 'klasach')} dokumentacji. Nic nie zostanie usunięte, dopóki listy nie zatwierdzi druga osoba, podając numer zgody Archiwum Państwowego.`
      : `Na ${U.fmtDate(p.today)} żadna klasa archiwalna nie przekroczyła okresu przechowywania — nie ma czego brakować.`
  };
}

/* ------------------------------------------------------------------------------------ trasy -- */
function register(r) {
  /* Protokoły brakowania i propozycje są listą z GET /api/admin/retention/runs, więc bramka
     komentarzy jest dokładnie bramką tej listy: administrator, cała szkoła, bez zawężeń. */
  LA.register('retention-runs', {
    label: 'Protokoły brakowania', roles: ADMIN.roles,
    find: (db, user, id) => db.get('retentionRuns', id)
  });
  LA.register('retention-proposals', {
    label: 'Propozycje brakowania', roles: ADMIN.roles,
    find: (db, user, id) => db.get('retentionProposals', id)
  });

  r.get('/api/admin/retention/runs', (ctx) => {
    const db = ctx.db;
    const rows = classPlans(db, D.today(db));                      // jeden skan na żądanie
    const runs = db.col('retentionRuns').slice().sort((a, b) => (a.at < b.at ? 1 : -1));
    const proposals = db.col('retentionProposals').slice().sort((a, b) => (a.at < b.at ? 1 : -1)).map((p) => ({ id: p.id, at: p.at, today: p.today, status: p.status, total: p.total, byClass: p.byClass, archiveConsentReference: p.archiveConsentReference, byUserId: p.byUserId, approvedBy: p.approvedBy, approvedAt: p.approvedAt, executedAt: p.executedAt, runId: p.runId }));
    return {
      runs, proposals,
      next: publicPlan(plan(db, rows)),
      comments: LC.countsFor(db, ctx.user, 'retention-runs', runs.map((x) => x.id)),
      proposalComments: LC.countsFor(db, ctx.user, 'retention-proposals', proposals.map((x) => x.id)),
    };
  }, ADMIN);

  /** Lista do brakowania. Kategoria A, księga uczniów i dane robocze nie trafiają tu nigdy. */
  r.get('/api/admin/retention/proposal', (ctx) => {
    const db = ctx.db;
    const rows = classPlans(db, D.today(db));                      // jeden skan: propozycja i widok
    const p = buildProposal(db, ctx.user.id, rows);
    return proposalView(db, p, rows);
  }, BRAKOWANIE);

  /** Zatwierdzenie brakowania: druga para oczu + numer zgody Archiwum Państwowego. */
  r.post('/api/admin/retention/approve', (ctx) => {
    const db = ctx.db; const b = ctx.body || {};
    const id = String(b.proposalId || '').trim();
    if (!id) throw httpError(400, 'Podaj identyfikator propozycji brakowania (proposalId).', { field: 'proposalId', code: 'proposal_required' });
    const p = db.get('retentionProposals', id);
    if (!p) throw httpError(404, 'Nie ma takiej propozycji brakowania.', { code: 'proposal_not_found' });
    if (p.status === 'executed') throw httpError(409, 'Ta propozycja została już wykonana.', { code: 'proposal_executed' });
    if (p.status === 'approved') throw httpError(409, `Ta propozycja jest już zatwierdzona (zgoda archiwum: ${p.archiveConsentReference}).`, { code: 'proposal_approved' });
    /* S3-11: cztery oczy. Kto ułożył listę, ten jej nie zatwierdza. */
    if (p.byUserId && p.byUserId === ctx.user.id) {
      throw httpError(409, 'Brakowanie zatwierdza inna osoba niż ta, która ułożyła listę. Poproś o zatwierdzenie dyrektora albo drugiego administratora — to jest ta druga para oczu, o którą chodzi w protokole brakowania.', { code: 'same_actor', proposalId: p.id, proposedBy: p.byUserId });
    }
    const consent = String(b.archiveConsentReference || '').trim();
    if (consent.length < 3) throw httpError(400, 'Podaj sygnaturę zgody Archiwum Państwowego na brakowanie (np. „AP Kraków, zgoda nr 123/2033 z 12.01.2033”). Bez niej brakowanie jest niedopuszczalne.', { field: 'archiveConsentReference', code: 'archive_consent_required' });
    if (!p.total) throw httpError(400, 'Ta propozycja jest pusta — nie ma czego zatwierdzać.', { code: 'proposal_empty' });

    const token = U.id('conf');
    p.status = 'approved'; p.approvedBy = ctx.user.id; p.approvedAt = U.now(); p.archiveConsentReference = consent;
    p.approvalReason = String(b.reason || '').trim() || null;
    p.confirmationToken = token; p.confirmationUsedAt = null;
    db.save();
    ctx.audit({
      action: 'retention_proposal_approved', entity: 'retentionProposals', entityId: p.id,
      before: { status: 'pending', proposedBy: p.byUserId },
      after: { status: 'approved', total: p.total, byClass: p.byClass, archiveConsentReference: consent, approvedBy: ctx.user.id, proposedBy: p.byUserId },
      reason: p.approvalReason || `zatwierdzenie brakowania na podstawie zgody archiwum: ${consent}`
    });
    return {
      ok: true, proposalId: p.id, status: p.status, total: p.total, byClass: p.byClass, archiveConsentReference: consent,
      proposedBy: p.byUserId, approvedBy: ctx.user.id, confirmationToken: token,
      message: `Brakowanie zatwierdzone: ${p.total} ${U.plural(p.total, 'pozycja', 'pozycje', 'pozycji')} na podstawie zgody „${consent}”. Wykonaj je przez POST /api/admin/retention/run z proposalId i tym jednorazowym potwierdzeniem — protokół trafi do rejestru zdarzeń.`
    };
  }, BRAKOWANIE);

  r.post('/api/admin/retention/run', (ctx) => {
    const db = ctx.db; const b = ctx.body || {};
    const rows = classPlans(db, D.today(db));                      // jeden skan na żądanie
    const p = plan(db, rows);
    const wanted = String(b.proposalId || '').trim();
    const proposal = wanted ? db.get('retentionProposals', wanted) : null;
    if (wanted && !proposal) throw httpError(404, 'Nie ma takiej propozycji brakowania.', { code: 'proposal_not_found' });
    if (proposal && proposal.status === 'pending') throw httpError(403, 'Ta propozycja nie została zatwierdzona. Brakowanie wymaga decyzji drugiej osoby i sygnatury zgody Archiwum Państwowego (POST /api/admin/retention/approve).', { code: 'approval_required', proposalId: proposal.id });
    if (proposal && proposal.status === 'executed') throw httpError(409, 'Ta propozycja została już wykonana.', { code: 'proposal_executed', runId: proposal.runId });

    const dryRun = b.confirm !== true;
    if (dryRun) {
      return Object.assign(publicPlan(p), {
        dryRun: true, deleted: { audit: 0, sessions: 0 }, archival: p.archival, proposalId: proposal ? proposal.id : null,
        message: `Podgląd na ${U.fmtDate(p.today)}: do usunięcia ${p.audit.expiring} z ${p.audit.total} wpisów audytowych starszych niż ${p.cutoff} oraz ${p.sessions.expiring} z ${p.sessions.total} sesji starszych niż ${p.sessionCutoff}. Klasy archiwalne (${p.archivalDue} ${U.plural(p.archivalDue, 'pozycja', 'pozycje', 'pozycji')}) wymagają osobnego brakowania ze zgodą archiwum. Nic nie usunięto — powtórz z "confirm": true i uzasadnieniem.`
      });
    }
    const reason = String(b.reason || '').trim();
    if (reason.length < 5) throw httpError(400, 'Podaj uzasadnienie brakowania (protokół trafia do rejestru).', { field: 'reason', code: 'reason_required' });
    /* S3-11: jednorazowe potwierdzenie wydane przy zatwierdzeniu. Kto nie ma tokenu, ten nie brakuje. */
    if (proposal) {
      const token = String(b.confirmationToken || '').trim();
      if (!proposal.confirmationToken || proposal.confirmationUsedAt) throw httpError(403, 'Potwierdzenie zatwierdzenia zostało już zużyte. Ułóż nową listę i poproś o ponowne zatwierdzenie.', { code: 'confirmation_spent', proposalId: proposal.id });
      if (!token || token !== proposal.confirmationToken) throw httpError(403, 'Brakuje jednorazowego potwierdzenia z zatwierdzenia (confirmationToken). Dostaje je osoba, która zatwierdziła listę — to ona decyduje, kiedy brakowanie ruszy.', { code: 'confirmation_required', proposalId: proposal.id });
      if (proposal.approvedBy === proposal.byUserId) throw httpError(409, 'Propozycja i jej zatwierdzenie pochodzą z tego samego konta — brakowanie wymaga dwóch osób.', { code: 'same_actor', proposalId: proposal.id });
    }

    const day = p.today;
    const opClasses = policy(db).classes.filter((c) => c.kind === 'operational' && !neverDeleteOf(c));
    const archClasses = proposal
      ? policy(db).classes.filter((c) => Object.prototype.hasOwnProperty.call(proposal.byClass || {}, c.class) && c.kind === 'archival' && !neverDeleteOf(c))
      : [];
    const plannedOperational = opClasses.reduce((n, c) => n + ((rows.find((x) => x.class === c.class) || { due: 0 }).due), 0);
    const plannedArchival = Object.values((proposal && proposal.byClass) || {}).reduce((n, v) => n + v, 0);

    /* ---- R3-02: protokół i wpis audytowy PRZED usunięciem, i na dysk. ---------------------- */
    const run = db.insert('retentionRuns', {
      at: U.now(), byUserId: ctx.user.id, reason, today: day, status: 'started',
      logRetentionYears: p.logRetentionYears, cutoff: p.cutoff, sessionCutoff: p.sessionCutoff,
      planned: { operational: plannedOperational, archival: plannedArchival, byClass: Object.assign({}, proposal ? proposal.byClass : {}) },
      deleted: {}, byClass: {}, byAction: p.audit.byAction, byYear: p.audit.byYear,
      proposalId: proposal ? proposal.id : null,
      archiveConsentReference: proposal ? proposal.archiveConsentReference : null,
      proposedBy: proposal ? proposal.byUserId : null, approvedBy: proposal ? proposal.approvedBy : null,
      archivalDeleted: 0, operationalDeleted: 0,
      before: { audit: p.audit.total, sessions: p.sessions.total },
      remaining: null, finishedAt: null,
    });
    if (proposal) { proposal.confirmationUsedAt = U.now(); }
    ctx.audit({
      action: 'retention_executed', entity: 'audit', entityId: run.id,
      before: { audit: p.audit.total, sessions: p.sessions.total },
      after: {
        runId: run.id, status: 'started', cutoff: p.cutoff,
        plannedOperational, plannedArchival, byClass: Object.assign({}, proposal ? proposal.byClass : {}),
        proposalId: proposal ? proposal.id : null, archiveConsentReference: proposal ? proposal.archiveConsentReference : null,
        proposedBy: proposal ? proposal.byUserId : null, approvedBy: proposal ? proposal.approvedBy : null
      },
      reason: proposal ? `${reason} (zgoda archiwum: ${proposal.archiveConsentReference})` : reason
    });
    db.save();
    if (db.flush) db.flush();                                  // protokół jest na dysku, dopiero teraz kasujemy

    /* ---- sprzątanie ------------------------------------------------------------------------ */
    const watch = commentWatch(db);                            // komentarze znikają razem ze swoimi wpisami
    const op = sweepClasses(db, opClasses, day, watch);
    const deleted = op.deleted; const byClass = op.byClass;
    if (deleted.audit === undefined) deleted.audit = 0;
    if (deleted.sessions === undefined) deleted.sessions = 0;
    let archivalDeleted = 0;
    if (archClasses.length) {
      /* Wykonanie liczy wiersze tą samą regułą i na tę samą datę odcięcia co propozycja — nie
         z zapisanej listy identyfikatorów, której i tak nikt by nie zweryfikował (R3-03). */
      const arch = sweepClasses(db, archClasses, proposal.cutoff || proposal.today || day, watch);
      for (const [name, n] of Object.entries(arch.deleted)) deleted[name] = (deleted[name] || 0) + n;
      for (const [cls, n] of Object.entries(arch.byClass)) byClass[cls] = (byClass[cls] || 0) + n;
      archivalDeleted = arch.total;
    }
    /* Dopisek do wpisu jest dokumentacją tego wpisu: gdy wpis zniknął, komentarz i notatka prywatna
       nie mają do czego wisieć. Licznik zostaje w protokole, żeby IOD widział, ile ich ubyło. */
    const comments = dropCommentsFor(db, watch.removed);
    deleted.logComments = comments.removed;
    byClass['komentarze-do-wpisow'] = comments.removed;

    /* ---- protokół domknięty ---------------------------------------------------------------- */
    const remaining = { audit: colOf(db, 'audit').length, sessions: colOf(db, 'sessions').length, logComments: colOf(db, 'logComments').length };
    Object.assign(run, {
      status: 'completed', finishedAt: U.now(), deleted, byClass,
      archivalDeleted, operationalDeleted: op.total, remaining,
      logComments: { removed: comments.removed, byKind: comments.byKind }
    });
    if (proposal) { proposal.status = 'executed'; proposal.executedAt = U.now(); proposal.runId = run.id; proposal.confirmationToken = null; }
    db.save();
    if (db.flush) db.flush();
    ctx.audit({
      action: 'retention_completed', entity: 'audit', entityId: run.id,
      before: { runId: run.id, status: 'started' },
      after: { runId: run.id, status: 'completed', deleted, byClass, archivalDeleted, operationalDeleted: op.total, remaining, logComments: { removed: comments.removed, byKind: comments.byKind }, proposalId: proposal ? proposal.id : null },
      reason: `zakończenie brakowania nr ${run.id}`
    });

    return {
      ok: true, dryRun: false, runId: run.id, status: 'completed', cutoff: p.cutoff, sessionCutoff: p.sessionCutoff,
      logRetentionYears: p.logRetentionYears, byAction: p.audit.byAction, byYear: p.audit.byYear,
      deleted, byClass, archivalDeleted, operationalDeleted: op.total, proposalId: proposal ? proposal.id : null,
      archiveConsentReference: proposal ? proposal.archiveConsentReference : null,
      remaining, logComments: { removed: comments.removed, byKind: comments.byKind },
      message: `Brakowanie wykonane: usunięto ${deleted.audit} ${U.plural(deleted.audit, 'wpis', 'wpisy', 'wpisów')} audytowych starszych niż ${U.fmtDate(p.cutoff)} (polityka: ${p.logRetentionYears} lat) i ${deleted.sessions} ${U.plural(deleted.sessions, 'sesję', 'sesje', 'sesji')}${proposal ? `, a z zatwierdzonego brakowania ${archivalDeleted} ${U.plural(archivalDeleted, 'pozycję', 'pozycje', 'pozycji')} dokumentacji (zgoda archiwum: ${proposal.archiveConsentReference})` : ''}${comments.removed ? `. Razem z brakowanymi wpisami znikło ${comments.removed} ${U.plural(comments.removed, 'komentarz', 'komentarze', 'komentarzy')} i notatek prywatnych` : ''}. Protokół nr ${run.id} pozostaje w rejestrze.`,
    };
  }, ADMIN);
}

module.exports = {
  register, plan, cutoffFor, classPlans, classPlan, policy, policyFor, classifyAll, uncoveredCollections,
  migrateRetention, retentionDeadline, deadlineFromBase, isDue, neverDeleteOf, clockStart, recordDate, ruleText,
  DEFAULT_RETENTION, DEFAULT_CLASSES, buildProposal, proposalId, addYears, sweepOperational, sweepClasses
};
