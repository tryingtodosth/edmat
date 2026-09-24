# Pilotaż — jeden tydzień szkolny od pustej instalacji do piątkowego eksportu

`npm run pilot` (`scripts/pilot.js`, test `tests/49-pilot.test.js`) rozgrywa jeden realistyczny tydzień
szkolny **przez publiczne API**, na **pustej instalacji** (`createApp({ blank: true })`): w poniedziałek
rano sekretariat kończy kreator, przez pięć dni sześcioro nauczycieli prowadzi dziennik, a w piątek
dyrektor przegląda rejestr audytowy i robi eksporty. Skrypt nie powtarza asercji poszczególnych
historyjek — sprawdza to, czego nie sprawdza żaden test pojedynczej trasy: **inwarianty międzyrolowe**.

```bash
npm run pilot                 # pełny raport na stdout; kod wyjścia 1 przy jakimkolwiek naruszeniu
npm run pilot -- --quiet      # same tabele końcowe
node --test tests/49-pilot.test.js
EDMAT_SKIP_PILOT=1 npm test   # pomija pilotaż (bardzo obciążone CI)
```

Ostatni przebieg: **39 kroków · 288 sprawdzeń inwariantów (227 unikalnych) · 575 żądań HTTP · ~10–20 s ·
0 naruszeń · 0 luk produktowych**. Budżet testu to 2 minuty.

---

## 0. Zasada pilotażu: jeden dziennik ustawowy na szkołę

**Szkoła w pilotażu prowadzi dziennik albo tu, albo tam — nigdy w dwóch miejscach naraz.** To nie jest
ostrożność, tylko wniosek z rundy 3:

- **Dokumentacja musi być kompletna w jednym miejscu.** Pakiet z § 22, który dyrektor podpisuje na
  koniec roku, jest odwzorowaniem dziennika: tematy, frekwencja lekcja po lekcji, uwagi, oceny opisowe,
  zachowanie, dane świadectw. Rocznik prowadzony w połowie tu, a w połowie w starym programie daje
  pakiet, który wygląda na kompletny i nie jest.
- **Data przejścia jest danymi, nie ustawieniem.** Szkoła, która przechodzi 23 września, generuje
  lekcje **od dnia przejścia** (`POST /api/setup/lessons/generate {"from": "…"}`, pole w kroku 4
  kreatora). Wcześniejsze dni należą do poprzedniej książki i nie mają tu powstać — inaczej audyt
  kompletności oskarża wszystkich nauczycieli o braki za tydzień, w którym szkoła jeszcze tu nie była.
- **Instancja demo nie jest instancją pilotażową.** Demo (`EDMAT_DEMO=1`) przełącza role bez haseł
  i daje się zresetować jednym żądaniem. To jest sprzeczne z pojęciem dokumentacji przebiegu nauczania.
- **Równoległy dziennik to podwójna praca i dwa różne stany.** Nauczyciel, który wpisuje frekwencję
  dwa razy, prędzej czy później wpisze ją inaczej, a wtedy żaden z dwóch zapisów nie jest
  dokumentacją.

Co z tego wynika dla organizacji pilotażu: jedna instancja na szkołę (jeden katalog danych, jeden
proces — `docs/STORAGE.md`), data przejścia ustalona **przed** kreatorem, stary dziennik zamknięty
i wyeksportowany na ten dzień, a kopia zapasowa z `files/` włącznie od pierwszego dnia
(`node scripts/backup.js backup --keep 30` w cronie o 02:30 **i** poza host). Terminy roczne liczą się
od **31 sierpnia**: pakiet § 22 powstaje po zakończeniu roku szkolnego, a nie po ostatnim dzwonku —
`docs/ARCHIVE.md` opisuje okno, przypomnienia i to, czego oprogramowanie **nie** rozstrzyga (rodzaj
podpisu).

Dwie rzeczy, których pilotaż **nie** przesądza i które muszą zapaść przed pierwszą szkołą:
`config.adultAccess` (dostęp opiekunów po 18. urodzinach — `docs/GUARDIANS.md`) i to, czy w pilotażu
włączamy push (wtedy szkoła zyskuje podmiot przetwarzający poza EOG i umowa powierzenia musi go
nazwać — `docs/PUSH.md`, `docs/compliance/README.md`). Pełna lista decyzji:
`docs/review/round3/README.md` § 5.

## 1. Jak wyglądał tydzień

Szkoła: **SP nr 12 w Krakowie**, rok 2026/2027, 6 nauczycieli, 3 oddziały (6a, 7a, 8a) po 20 uczniów,
każdy z opiekunem. Plan: 6 lekcji dziennie × 5 dni × 3 oddziały = 90 pozycji, zero konfliktów.
Dzień szkolny przesuwa się przez `config.today` (wbudowany zegar demo — w produkcji robi to zegar ścienny).

| dzień | co się dzieje |
| --- | --- |
| **poniedziałek** | Pusta instalacja odmawia wszystkiego poza kreatorem (`503 setup_required`). Sekretariat zakłada szkołę, konto administratora i konto dyrektora (hasło tymczasowe → wymuszona zmiana). Import 6 nauczycieli (hasła tymczasowe, zmiana przy pierwszym logowaniu), 60 uczniów z rodzicami (próbny przebieg, potem zapis; 60 kodów rejestracyjnych), plan lekcji (dryRun → zapis), generowanie lekcji, `setup/finish`. Rodzice aktywują konta kodami; uczennica z 8a ma **dwoje opiekunów na osobnych kontach**. Nauczyciele zapisują frekwencję na **wszystkich 18 lekcjach**: jedna lista jako **wersja robocza**, dokończona po dzwonku; na jednej lekcji telefon dosyła **zapis offline sprzed korekty** (odrzucony jako `stale_write`); jeden uczeń nieobecny na 1. lekcji → **alert do opiekuna**. Tematy wszystkich lekcji, jeden powiązany z podstawą programową. Nowa kategoria ocen, **sprawdzian punktowy wpisany seryjnie** dla całej klasy. Zadanie domowe z terminem na środę. Sprawdzian zapowiedziany na czwartek (ostrzeżenie o krótkiej zapowiedzi); **drugi sprawdzian tego samego dnia odrzucony przez limit szkolny**, kartkówka przechodzi. |
| **wtorek** | Frekwencja na 18 lekcjach. **Poprawa** sprawdzianu (druga poprawa tej samej pracy odrzucona), **„np”** poza średnią, **komentarz** nauczyciela, **cofnięcie oceny z powodem** (bez powodu → 400). Oceny z angielskiego w 8a. Pięć **wniosków o usprawiedliwienie** od opiekunów. Uczniowie oddają zadanie domowe. |
| **środa** | Frekwencja; trzeci dzień nieobecności ucznia objętego pomocą społeczną → **alert 3-dniowy dla pedagoga**. Wychowawcy rozpatrują wnioski: **cztery przyjęte, jeden odrzucony z powodem** (odrzucenie bez powodu → 400). **Nowy uczeń dołącza do 6a** (księga uczniów, kolejny wolny numer, nauczyciele uzupełniają mu dzisiejszą frekwencję). **Korekta planu 7a w trakcie tygodnia** (import częściowy `merge: true`). Chory nauczyciel fizyki → **ranking zastępstw i publikacja** planu na czwartek i piątek. Kurs z quizem: pięcioro uczniów rozwiązuje, jeden wynik **przeniesiony do ocen cząstkowych**. Zebranie online (Jitsi na domenie przykładowej) i dane do wejścia. Psycholog planuje zajęcia (kolizja z lekcją obowiązkową odrzucona) i zapisuje **notatkę poufną, której dyrektor nie odczyta**. Pielęgniarka zapisuje **wizytę widoczną wyłącznie dla opiekuna**. Biblioteka wypożycza komplety podręczników, stołówka liczy obiady **z porannej frekwencji**, opiekun płaci i **odwołuje obiad przed progiem** (po progu → 409). Wieczorem opiekun włącza **ciszę nocną**. |
| **czwartek** | Frekwencja z zastępcami; jedna zastępowana lekcja zostaje **celowo bez tematu**. Spóźnione oddanie zadania domowego (oznaczone jako spóźnione), przejrzenie pracy przez nauczyciela. |
| **piątek** | Frekwencja i tematy. Dyrektor: **audyt kompletności** (pon.–śr. czysty, z czwartkiem dokładnie jedna luka, przypisana **zastępcy**, nie nauczycielowi z planu) i **obciążenie sprawdzianami**. Przegląd rejestru audytowego, **kopia anonimizowana**, eksport **CSV** i **XML**, **wydruk** (i prawdziwy PDF, gdy jest Chromium; bez niego `501 pdf_unavailable` z adresem HTML). **Zamknięcie semestru w październiku odrzucone**; ze świadomym potwierdzeniem i podstawą przechodzi i jest oznaczone jako wcześniejsze, po czym dyrekcja je odblokowuje. **Tryb demo wyłączony — `POST /api/demo/reset` jest nieosiągalny (404).** |

## 2. Co sprawdza pilotaż (inwarianty międzyrolowe)

Nie „czy trasa odpowiedziała 200”, tylko **czy wszyscy widzą to samo**. Skróty z tabeli raportu:

| grupa | o co chodzi |
| --- | --- |
| `X-1…X-8` | To, co zapisał nauczyciel, widzą **dosłownie** uczeń, opiekun, wychowawca i dyrektor: ten sam zestaw ocen, ta sama średnia, ten sam komentarz. |
| `Y-1…Y-7` | Frekwencja ucznia jest identyczna w: raporcie miesięcznym, zestawieniu okresowym, raporcie oddziału, miesięcznym raporcie wychowawcy, widoku opiekuna i widoku ucznia — co do godziny i co do procenta. |
| `AVG-1…AVG-4` | Średnia z arkusza ocen = średnia w tablicy klasyfikacji = średnia w statystykach; średnia klasy = średnia ze średnich; liczba wpisów = liczba żywych ocen. |
| `DASH-1…DASH-8` | Liczniki na pulpitach równe wierszom, które za nimi stoją: statystyka listy obecności, liczba uczniów, wnioski oczekujące, prace oddane i przejrzane, nieprzeczytane powiadomienia. |
| `NOTIF-1…NOTIF-6` | Powiadomienia trafiają **dokładnie** do zbioru osób policzonego z danych — i do nikogo więcej (alert o 1. lekcji, publikacja zastępstw). |
| `SCOPE-1…SCOPE-5` | Opiekun z zakresem `info` dostaje `403 guardian_scope` na oceny, ma pusty blok ocen na pulpicie, ale widzi frekwencję; oboje opiekunów widzą tę samą frekwencję i nie widzą nawzajem swoich danych kontaktowych. |
| `AUDIT-1…AUDIT-7` | Każda ważna operacja tygodnia (31 akcji) ma wiersz audytu; każda zmiana istniejącego wiersza niesie stan **przed** zmianą; rejestru nie da się skasować, a próba też jest w rejestrze. |
| `PRINT-1, PRINT-2` | Wydruk miesięcznej frekwencji ma te same liczby, co API — wiersz po wierszu, razem z procentem sformatowanym regułą szkoły. |
| `NEW-1…NEW-8` | Nowy uczeń pojawia się **dopiero od środy**: nie ma go na listach obecności z poniedziałku, jest od środy, w arkuszu ocen bez ocen sprzed przyjęcia, i nie ma ani jednego wiersza frekwencji sprzed daty przyjęcia. |
| `TT-6…TT-10` | Korekta planu 7a nie ruszyła ani jednej lekcji 6a i 8a; zmieniona godzina ma nowego nauczyciela i salę; lekcje z zapisanym dziennikiem zostają nietknięte. |
| `HTTP-1` | Żadna z 556 odpowiedzi nie była nieoczekiwanym błędem serwera. |

## 3. Co się zepsuło — i co zostało naprawione

Siedem błędów wyszło dopiero wtedy, gdy ten sam tydzień przeszedł przez wszystkie role naraz.
Każdy ma test regresyjny w pliku swojej sekcji.

| # | co było nie tak | naprawa | test regresyjny |
| --- | --- | --- | --- |
| 1 | **Audyt kompletności liczył cały oddział**, a listę obecności wypełniają tylko uczniowie zapisani danego dnia. Uczeń przyjęty w trakcie roku robił z **każdej** wcześniejszej lekcji „frekwencję częściową” — i to na zawsze. W pilotażu: 6 fałszywych luk zaraz po dopisaniu jednego ucznia. | `server/routes/substitutions.js:71` — `studentsOfLesson()` przepuszcza uczniów przez `enrolledOn()` z `routes/attendance.js` (ta sama zasada, co lista obecności). | `tests/33-principal.test.js` — `[3.3.8] OPS-13: uczeń przyjęty w trakcie roku nie robi braków w lekcjach sprzed przyjęcia` |
| 2 | **Indeks liczebności oddziału w audycie kompletności ignorował datę.** Klucz `klasa\|grupa` (REL-01) sprawiał, że cały audytowany tydzień dostawał liczebność pierwszej napotkanej lekcji — po przyjęciu ucznia w środę wtorek raportował „12 z 13 wpisów”. | `server/routes/principal.js:88` — klucz to `klasa\|grupa\|data`. | jw. (druga część testu: lekcja z dnia przyjęcia **ma** być zgłoszona, sprzed przyjęcia **nie**) |
| 3 | **Opublikowane zastępstwo nie było zmianą w planie ucznia.** `applySubstitution` nie stemplowało lekcji, a `GET /api/student/changes` (3.6.5) filtruje po `changedAt` — ekran „zmiany w planie” pokazywał więc wyłącznie zmiany wpisane ręcznie w zasiewie demo. Prawdziwe zastępstwo docierało tylko powiadomieniem. | `server/routes/substitutions.js:213` — publikacja zapisuje `changedAt`, `changeReason`, a przy zmianie sali także `roomChangedFrom`. | `tests/33-principal.test.js` — `[3.3.5] opublikowane zastępstwo pojawia się na ekranie zmian ucznia, nie tylko w powiadomieniu` |
| 4 | **Korekta planu w istniejącej godzinie nie ruszała już wygenerowanych lekcji.** Identyfikator pozycji planu to `tt_<oddział>_<dzień>_<nr>[_<grupa>]` — bez przedmiotu, nauczyciela i sali. „Piątą godzinę we czwartek prowadzi teraz kto inny” zostawiało więc lekcje ze starym nauczycielem do końca roku: slot się nie zmienił, więc nic nie było ani usuwane, ani dogenerowane. | `server/routes/setup.js:66` — `syncLessons()` uzgadnia także **treść** slotu (przedmiot, nauczyciel, sala, grupa); lekcję z wpisami w dzienniku zostawia nietkniętą i raportuje w `keptWithJournal`. Komunikat importu w `server/routes/admin.js:410` podaje obie liczby. | `tests/35-registry.test.js` — `[3.5.5] korekta planu w istniejącej godzinie przestawia przyszłe lekcje, a te z wpisami zostawia` |
| 5 | **Zamknięcie semestru nie miało żadnej bramki.** Wychowawca mógł jednym kliknięciem w połowie półrocza zamrozić oceny, frekwencję i uwagi całego oddziału; odblokować mogła tylko dyrekcja. | `server/routes/homeroom.js:629` — przed terminem klasyfikacji `409 too_early`; świadome `force` **wymaga podstawy** (`400 reason_required`), a blokada zostaje oznaczona `early: true` razem z datą i terminem rady. Ekran wychowawcy (`public/app/screens/homeroom.js:473, 805`) pyta wtedy o podstawę. | `tests/32-homeroom.test.js` — `[3.2.11] zamknięcie semestru przed terminem klasyfikacji wymaga potwierdzenia i podstawy` |
| 6 | **Data przyjęcia ucznia miała dwie nazwy w jednej regule.** `enrolledOn()` honorował tylko `enrolledAt`, a wychowawca dopisujący ucznia w trakcie roku zapisuje `joinedAt` — taki uczeń stał na listach obecności z dni, w których nie był jeszcze uczniem szkoły. | `server/routes/attendance.js:34` — liczy się wcześniejsza z dat `enrolledAt`/`joinedAt`. | pokryte przez test z wiersza 1 (druga część sprawdza `joinedAt`) |
| 7 | **Pilotaż liczył 503 z kreatora jako błąd serwera.** Drobiazg narzędziowy, ale wart odnotowania: „żadna odpowiedź nie była 5xx” musi znaczyć „żadna **nieoczekiwana**”, inaczej inwariant jest bezużyteczny. | `scripts/pilot.js` — każde wywołanie deklaruje oczekiwany status; 5xx liczy się tylko wtedy, gdy nie był oczekiwany. | `tests/49-pilot.test.js` (`R.serverErrors`) |

Trzy rzeczy, o których warto wiedzieć, a które **nie** są błędami:

- **Limit sprawdzianów działa per dzień, nie per tydzień, dopóki dzień nie jest pełny.** Drugi sprawdzian
  tego samego dnia dostaje `409 test_limit`, kartkówka przechodzi bez limitu — zgodnie ze statutem.
- **Ocena za pracę ucznia z potwierdzoną nieobecnością wymaga „do uzupełnienia”.** Wpis seryjny dla
  całego oddziału zatrzymuje się więc na jednym uczniu (`absent_blocked`) i reszta idzie dalej — to
  jest właściwe zachowanie, ale trzeba o nim pamiętać przy imporcie wyników sprawdzianu.
- **Alerty powstają przy zapisie frekwencji, a nie przy odczycie** (`[3.7.2]`, `[3.4.15]`). Odrzucenie
  usprawiedliwienia, które „zasłaniało” nieobecność, nie uruchamia ponownego skanu — alert pojawi się
  przy następnym zapisie frekwencji albo gdy pedagog otworzy swój ekran.

## 4. Luki produktowe — wszystkie zamknięte

Pilotaż wymusił je wszystkie: bez nich **nowa szkoła nie dała się uruchomić samą aplikacją**.
Przez kilka rund `scripts/pilot.js` → `provision()` wpisywał brakujące wiersze wprost do magazynu
i każdy taki zapis notował jako lukę. **Od tej rundy nie wpisuje żadnego.** `provision()` ustawia
już tylko dwa progi konfiguracyjne (cena posiłku, godzina odwołania obiadu) i zakłada puste
kolekcje; kadra, podstawa programowa, konta stołówkowe, stan biblioteki, opłaty, flagi ucznia
i zakres dostępu opiekuna powstają **przez publiczne API**, tymi samymi trasami, którymi zrobiłaby
to prawdziwa szkoła. W raporcie sekcja „LUKI PRODUKTOWE” brzmi teraz `— brak`, a
`tests/49-pilot.test.js` pilnuje, żeby tak zostało.

| id | co było | czym zamknięte | dowód w pilotażu |
| --- | --- | --- | --- |
| **GAP-1** | Kreator zakładał wyłącznie nauczycieli, uczniów i rodziców — pedagog, psycholog, pielęgniarka, bibliotekarka, intendent, wychowawca świetlicy i IOD nie mieli jak powstać, więc rozdziały 3.4 i 3.8 były w nowej szkole nieosiągalne. | `GET/POST /api/admin/staff`, `PATCH`/`DELETE /api/admin/staff/:id` (dyrekcja czyta, administrator pisze; hasło jednorazowe pokazane raz, para kluczy RSA dla ról z notatkami poufnymi, `DELETE` = dezaktywacja, ostatni czynny administrator zostaje). Ekran: „Konta pracowników” w `/administracja`. | `STAFF-1…STAFF-4` — administrator zakłada pięć kont, każde z hasłem jednorazowym i wymuszoną zmianą, role z notatkami dostają klucze, każde założenie ma wiersz audytu. |
| **GAP-2** | `curriculum` puste w pustej instalacji i zero tras zapisu: „temat lekcji powiązany z podstawą” (3.1.3) i ekran realizacji podstawy (3.3.9) były martwe. | `GET/POST/PATCH/DELETE /api/curriculum`, `POST /api/curriculum/import` (CSV `subject;level;code;title;hours`, próbny przebieg i zapis; duplikat po przedmiocie + poziomie + kodzie **aktualizuje**, nie dubluje) i `GET /api/curriculum/format` z opisem arkusza. Ekran `#/podstawa` (`public/app/screens/curriculum.js`): tabela, wklejenie arkusza, okno dodawania i edycji; dziennik lekcyjny prowadzi do niego wprost z karty tematu. Realizacja podstawy bez ani jednego punktu to **0 %**, nie `NaN`. | `PROV-2…PROV-4` — próbny import niczego nie zapisuje, właściwy wprowadza całą szkołę jednym arkuszem, powtórzony aktualizuje zamiast dublować. |
| **GAP-3** | `accessScope` dawało się ustawić wyłącznie przy pierwszym przypisaniu opiekuna; postanowienie sądu dotyczące rodzica, który ma już konto, nie miało jak trafić do dziennika. Brakowało też zapisu zakresu **per dziecko**. | `PATCH /api/registry/students/:id/guardians/:userId` `{accessScope, legalBasis, note}` — zapisuje `students[].guardians[]`, czyli zakres pary (opiekun, dziecko); wizytówka kontaktowa przeniesiona do `students[].guardianContact`. (Runda 3 dołożyła do tej samej trasy `status` władzy rodzicielskiej i `basis`; zakres wynika dziś ze statusu, a ręczne nadpisanie może go wyłącznie zawęzić — `docs/GUARDIANS.md`.) Ekran: „Opiekunowie i zakres dostępu” w `/sekretariat`. | `PAR-3a` — sekretariat zawęża zakres drugiego opiekuna **po** aktywacji konta i zapisuje go przy dziecku; `PAR-3` sprawdza, że opiekun widzi dziecko w zakresie „info”. |
| **GAP-4** | Alert 3-dniowy dla pedagoga (`[3.4.15]`) opierał się na `students[].socialWelfare`, którego żadna trasa nie zapisywała. | `GET`/`PATCH /api/registry/students/:id/flags` (sekretariat i administracja w całej szkole, wychowawca w swoim oddziale). Ekran: „Flagi ucznia” w `/sekretariat` i w `/wychowawca` → Klasa. | `PROV-9` — flagę ustawia sekretariat, a alert 3-dniowy rusza w czwartkowym kroku tygodnia. |
| **GAP-5** | Nie było jak założyć konta stołówkowego, wprowadzić stanu biblioteki ani wystawić opłaty — moduły 3.7.9, 3.7.10, 3.8.3, 3.8.4 i 3.8.8 czytały kolekcje, które umiał wypełnić tylko zasiew demo. | `POST /api/modules/cafeteria/accounts` (konto dla ucznia albo całego oddziału, z planem i ceną) i `PATCH /api/modules/cafeteria/accounts/:id`; `POST /api/modules/library/items` (pojedyncza pozycja albo CSV `barcode;title;kind`, kod kreskowy jest kluczem); `POST /api/modules/fees` (sekretariat, administrator albo dyrekcja wystawia opłatę oddziałowi, wskazanym uczniom albo całej szkole — opiekun widzi ją od razu w „Płatnościach”) i `GET /api/modules/fees`. Wszystko audytowane; formularze w zakładkach „Stołówka” i „Biblioteka” ekranu modułów, pl/en. | `PROV-5…PROV-8` — konta dla wszystkich uczniów jednym żądaniem na oddział, powtórzenie nikogo nie dubluje, stan biblioteki z wklejonego arkusza, opłata wystawiona przez API trafia do konta ucznia. |
| **GAP-6** | Data przyjęcia ucznia miała dwie nazwy (`joinedAt`, `enrolledAt`), a import kreatora stemplował jedną z nich dniem wgrania pliku. | `enrolledAt` jest kanoniczne i jest kolumną formatu importu (`GET /api/setup/formats`); puste pole = **początek roku szkolnego**, nie dzień wgrania. `joinedMidYear` u wychowawcy liczy się z `enrolledAt`, a `joinedAt` zostaje aliasem czytanym przez `enrolledOn()`. | `NEW-1` — uczeń dopisany w środę ma `enrolledAt` z tego dnia, a reszta rocznika nie wygląda na dopisaną w trakcie roku. |
| **GAP-7** | Dwie drogi powiadomień, dwa zachowania wobec ciszy nocnej: `createNotification` ją znała, `D.notify` — nie. Opiekun z włączoną ciszą był wyciszony tylko w połowie dziennika. | `D.notify` w `server/lib/domain.js` prowadzi tę samą ścieżkę: ciszę nocną, deduplikację po `dedupeKey` i `deliverAt`. `endOfQuiet` przeniesiony do `domain.js`, `notifyParentsOf` odfiltrowuje `null`, `routes/notifications.js` re-eksportuje cienkie opakowania i podpina kolejkę Web Push przez `D.onNotify` (§5). | `QUIET-1…QUIET-5` — `QUIET-4` przestało być charakteryzacją rozjazdu i jest zwykłym inwariantem: „obie drogi powiadomień honorują ciszę nocną”. |

Zostaje jeden świadomy skrót narzędziowy, **nie** luka: pilotaż przesuwa dzień szkolny przez
`config.today` (wbudowany zegar demo), bo nie da się czekać pięciu dni. W produkcji robi to zegar
ścienny.

## 5. GAP-7 — jedna droga powiadomień (wprowadzone)

Rozdział opisywał łatkę do plików, których ta runda nie była właścicielem (`server/lib/domain.js`,
`server/routes/notifications.js`). Łatka **jest wprowadzona**; zostaje tu jej opis, bo to jedyna
decyzja projektowa w dzienniku, która przenosi logikę z warstwy tras do biblioteki.

Cisza nocna, deduplikacja i `deliverAt` mieszkają w `server/lib/domain.js`:

```js
/** Koniec ciszy nocnej po instancie `at`, liczony w strefie szkoły (okno bywa przez północ). */
function endOfQuiet(at, q, zone) { … }

/**
 * Jedyna droga tworzenia powiadomień. Honoruje ciszę nocną konta (`users[].quietHours`) — alert
 * kryzysowy przechodzi zawsze — i deduplikuje po `dedupeKey`. Zwraca wstawiony wiersz albo `null`.
 */
function notify(db, userId, kind, text, opts) { … }
```

Warstwa tras nie znika: kolejka Web Push należy do `server/routes/notifications.js` i nie może
wjechać do `lib/`, więc `domain.js` wystawia jeden szew — `D.onNotify(fn)` — a plik tras rejestruje
w nim wysyłkę:

```js
/* server/routes/notifications.js */
const endOfQuiet = D.endOfQuiet;
const createNotification = (db, userId, kind, text, opts) => D.notify(db, userId, kind, text, opts);
D.onNotify((db, n) => { if (n.push && !n.deferred) enqueuePush(db, n); else sweepDeferred(db); });
```

Konsekwencje, o których mówiła łatka, są rozliczone: `notify()` może zwrócić `null`, więc
`notifyParentsOf` odfiltrowuje `null`, a `server/routes/grades.js` sprawdza wynik przed
`.userId`. Zachowanie jest przypięte testami: `[3.7.7]` (komunikat wychowawcy w ciszy nocnej czeka
do rana z wyzerowanym `push`, alert kryzysowy przechodzi), `48-push` (zwolnienie odłożonych)
i `QUIET-1…QUIET-5` w pilotażu.

## 6. Jak czytać raport

```
KROKI                     numer, czas, liczba sprawdzeń, opis kroku
INWARIANTY MIĘDZYROLOWE   id, wynik, ile razy sprawdzony, opis (przy błędzie — wartości obu stron)
LUKI PRODUKTOWE           GAP-n z rozdziału 4 — dziś „— brak”
ŻĄDANIA / CZAS            ile wywołań API, rozkład statusów, czas przebiegu
NARUSZENIA                0 albo lista — kod wyjścia 1
```

Inwariant o tym samym `id` bywa sprawdzany wiele razy (np. `Y-1` dla czworga dzieci) — kolumna
„sprawdzeń” pokazuje ile, a wiersz jest czerwony, jeżeli choć raz nie wyszedł.

## 7. Powiązane

- `CONTRIBUTING.md` — konwencje, które pilotaż weryfikuje w praktyce.
- `docs/review/README.md` — trzy rundy przeglądów; runda 3 ma własną stronę stanu
  (`docs/review/round3/README.md`) z wierszem na każde ustalenie i listą decyzji dla zespołu.
- `docs/IMPORT.md` — formaty, którymi szkoła wjeżdża do pilotażu: eksport aSc (XML), publikacja
  Optivum (katalog HTML, windows-1250), CSV/JSON, dwufazowe dopasowanie encji, grupy z pliku
  i cofanie partii importu.
- `docs/STORAGE.md`, `npm run bench` — magazyn i jego progi.
- `npm run smoke` — ten sam przegląd, ale ekranów w przeglądarce, a nie API.
