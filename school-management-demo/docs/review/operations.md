# Przegląd operacyjny prototypu EdMat — sytuacje, które zdarzają się w każdej szkole

Recenzja z perspektywy osoby prowadzącej sekretariat i administrację szkoły. Scenariusze odtworzono
na żywym serwerze (`tests/helpers.js` → `startServer()` / `createApp({ blank: true })`), z danymi demo
(`EDMAT_TODAY=2026-10-23`) i na czystej instalacji z wygenerowanym plikiem 400 uczniów.
Odwołania `plik:linia` wskazują **stan sprzed poprawek** (commit przeglądu).

Legenda: **blocker** — szkoła nie może pracować / dane w dzienniku stają się nieprawdziwe;
**major** — da się obejść, ale kosztem ręcznej pracy albo niezgodności z przepisami; **minor** — uciążliwość.

## Tabela ustaleń

| id | waga | co się psuje | gdzie | powtórzenie | proponowana poprawka | stan |
| --- | --- | --- | --- | --- | --- | --- |
| OPS-01 | blocker | Wszystkie trzy importy kreatora (`/api/setup/teachers/import`, `/api/setup/students/import`, `/api/setup/lessons/generate`) kończą się `500 Błąd serwera` w każdej szkole, w której `config.setup` nie istnieje (zasiew demo, baza sprzed kreatora, baza po migracji) — **ale wiersze zdążyły się już zapisać**. Administrator widzi błąd, ponawia import i dostaje duplikaty. W praktyce: po zakończeniu kreatora nie ma żadnej drogi dopisania nauczyciela w trakcie roku. | `server/routes/setup.js:49`, `:66`, `:69` (`db.data.config.setup.steps.X = U.now()`) | `S.as('admin')` → `POST /api/setup/teachers/import` na zasiewie demo → 500, a `db.one('users', u=>u.login==='n.new')` istnieje | Leniwy `steps(db)`, który tworzy `config.setup` gdy go nie ma; zapis kroku dopiero po udanym przetworzeniu | **naprawione** |
| OPS-02 | blocker | **Nie da się utworzyć ani zmienić grupy — nigdzie w całym API.** Grupy istnieją wyłącznie w zasiewie. Podział oddziału na dwie grupy językowe po imporcie planu jest niewykonalny: import planu odrzuca wiersz z nieznaną grupą (`admin.js:62`), a jedyna trasa dotykająca grup (`homeroom.js:736`) obsługuje wyłącznie `kind:'cross-class'` i tylko dopisuje istniejących uczniów. Uczeń dopisany w trakcie roku nigdy nie trafi do grupy językowej i cicho wypada ze wszystkich lekcji grupowych. | brak trasy; `server/routes/admin.js:62`, `server/routes/homeroom.js:736-753` | `grep -rn "insert('groups'" server/` → pusto; `POST /api/admin/timetable/import` z `group=g_7c_ang1` → „nieznana grupa” | Pełny CRUD grup w `admin.js` (`GET/POST/PATCH/DELETE /api/admin/groups`) + `POST /api/admin/classes/:id/split` dzielący oddział na dwie grupy jednym wywołaniem | **naprawione** |
| OPS-03 | blocker | Przeniesienie ucznia do innej szkoły zamyka wpis w księdze, ale **nie usuwa go z `class.studentIds` ani z grup**, nie blokuje jego konta i nie odbiera dostępu rodzicowi. Uczeń, który odszedł 20.10, do końca roku stoi na każdej liście obecności, ma aktywny login, a rodzic widzi w `/api/parent/children` bieżące oceny klasy. `homeroom.js` filtruje tylko `status!=='removed'`, więc `transferred` przechodzi. | `server/routes/registry.js:209-225`; roster: `server/routes/attendance.js:24-28`; `server/routes/homeroom.js:79` | patrz repro A/B poniżej — po `POST /api/registry/students/st_kowalczyk_anna/transfer` `GET /api/attendance/lesson/<przyszła lekcja>` nadal zwraca Annę, `rodzic.kowalczyk` → `/api/parent/children` 200 z Anną, `anna.kowalczyk` loguje się | Domknięcie wpisu ma robić to samo, co robi już `privacy.js:139-140` przy usuwaniu danych: wypisać z oddziału i ze wszystkich grup, zablokować konto ucznia i unieważnić jego sesje, odpiąć opiekunów (z zachowaniem `formerParentIds` w archiwum), unieważnić niewykorzystane kody rejestracyjne | **naprawione** |
| OPS-04 | blocker | Import planu w trakcie roku podmienia `db.data.timetable` w całości i **nie dotyka `lessons`**. Przeniesienie jednej godziny (7b pon. 1 → pon. 6) zostawia sierotę `les_tt_7b_1_1_<data>` z opublikowanym zastępstwem, a nowa godzina nie ma żadnej lekcji, dopóki ktoś nie wygeneruje ich ręcznie — czyli nigdy, bo generowanie zwracało 500 (OPS-01). Przy pełnej wymianie planu zostaje 130 lekcji-widm. | `server/routes/admin.js:244-247` | `POST /api/admin/timetable/import` z przesuniętą godziną → `db.get('lessons','les_tt_7b_1_1_2026-10-26')` nadal istnieje ze `status:'substituted'`, a `GET /api/lessons?date=2026-10-26&teacherId=u_nowak` pokazuje starą godzinę | Po zapisie planu uzgodnić lekcje w horyzoncie już wygenerowanym: usunąć puste lekcje bez śladu w dzienniku, **anulować** (nie kasować) te z frekwencją/tematem/ocenami/zastępstwem, wygenerować lekcje dla nowych pozycji i zaraportować liczby; próbny import ma pokazać ten sam bilans | **naprawione** |
| OPS-05 | blocker | Import uczniów nie ma żadnej kontroli duplikatów. Ten sam PESEL przechodzi dowolną liczbę razy (3 wpisy, 3 numery księgi, 3 loginy, ten sam numer w dzienniku), a powtórne wgranie tego samego pliku podwaja szkołę. Ręczny formularz sekretariatu odrzuca duplikat PESEL (`registry.js:141`) — kreator nie. | `server/routes/setup.js:52-68` (brak kontroli; `:59` tworzy tylko unikatowe `id`) | CSV z dwoma identycznymi wierszami → `count: 2`, `errors: []`; `db.col('students').filter(s=>s.pesel===p)` → 3 rekordy, wszystkie `rollNo: 1` | Odrzucać wiersz z numerem PESEL już obecnym w bazie lub wcześniej w tym samym pliku; odrzucać powtórzenie (oddział + nazwisko + imię + data urodzenia); zgłaszać kolizje numerów w dzienniku — wszystko z numerem wiersza | **naprawione** |
| OPS-06 | blocker | Import 400 uczniów trwa **37 s** w jednowątkowym procesie — cała szkoła stoi, a każdy odwrotny proxy zdąży przerwać żądanie. Powód: `C.hashPassword` (scrypt, ~57 ms) wywoływane dla konta ucznia i konta rodzica, ~690 razy. Hasła te nikomu nie są pokazywane: uczeń dostaje je resetem, rodzic i tak zakłada konto kodem rejestracyjnym. | `server/routes/setup.js:62`, `:63` | `POST /api/setup/students/import` z 404-wierszowym CSV → 37 054 ms | Konta uczniów i rodziców zakładane importem powstają **bez hasła** (`passwordHash: null`, `mustActivate: true`) — logowanie i tak je odrzuca (`crypto.js:14`), a aktywacja idzie kodem rejestracyjnym albo resetem administratora | **naprawione** (0,3 s) |
| OPS-07 | major | Pusta instalacja ma `holidays: []` i `daysOff: []`, więc kreator generuje lekcje **w każde święto**: 1 i 11 listopada, 25 grudnia, Poniedziałek Wielkanocny, 1 i 3 maja, Boże Ciało. Przy 24 oddziałach to po 144 lekcje-widma dziennie; audyt kompletności tematów natychmiast zgłasza nauczycielom braki za Boże Narodzenie. | `server/lib/blank-seed.js:11` | Kreator na czystej instancji → `db.col('lessons').filter(l=>l.date==='2026-12-25').length` → 144 | `schoolYearFor()` wylicza ustawowe dni wolne roku szkolnego (z Wielkanocą liczoną algorytmem Meeusa) i przerwy świąteczne; kreator dostaje je gotowe i może je edytować w „strukturze roku” | **naprawione** |
| OPS-08 | major | Dzień wolny dopisany po wygenerowaniu lekcji nie robi nic: lekcje zostają, nauczyciele mają je w planie, audyt kompletności liczy je jako nieuzupełnione. | `server/routes/admin.js:204-217` | `PATCH /api/admin/year` z `daysOff:[{date:'2026-11-13'}]` → `GET /api/lessons?date=2026-11-13` nadal zwraca 6 lekcji | Zmiana struktury roku uzgadnia lekcje: nowe dni wolne i przerwy anulują (lub kasują, gdy nic nie zapisano) lekcje z tych dni, odpowiedź podaje bilans; cofnięcie dnia wolnego przywraca lekcje z planu | **naprawione** |
| OPS-09 | major | Numery księgi uczniów nie są kolejne: w imporcie 402 uczniów powstało **381 dziur** (1001 → 1783). Ten sam licznik `regNo` służy do odróżniania identycznych identyfikatorów i do numeru księgi, a punkt startowy to `max(1000)`, a nie faktyczny następny numer. Księga uczniów z dziurami to dokument, którego nie da się obronić przy kontroli. | `server/routes/setup.js:53`, `:59`, `:60` | import 400 uczniów → `min 1001, max 1783, count 402`, 381 dziur | Rozdzielić licznik identyfikatorów od numeru księgi; numer księgi startuje od faktycznego `max(registerNo)+1` i rośnie o 1 na utworzonego ucznia | **naprawione** |
| OPS-10 | major | Literówka w kolumnie `class` cicho zakłada nowy oddział. W pliku testowym `9z` utworzyło oddział bez wychowawcy, który potem blokuje pakiet SIO („oddział nie ma wychowawcy”) i widnieje na każdej liście klas. | `server/routes/setup.js:58` (i `:48` dla `homeroomOf`) | CSV z wierszem `9z;1;Testowy;Brak;…` → `db.col('classes')` zawiera `9z` | Walidacja wzorca oddziału (`9zz`, `VIIb`, puste — odrzucane z numerem wiersza), jawna lista `classesCreated` w odpowiedzi i ostrzeżenie dla oddziału z jednym lub dwoma uczniami (typowy objaw literówki). Oddziału poprawnego składniowo system nie odrzuci — nie wie, które oznaczenia są w tej szkole legalne — ale próbny przebieg pokazuje go operatorowi przed zapisem | **naprawione** (ostrzeżenie + próbny przebieg) |
| OPS-11 | major | Nie ma cofnięcia importu. Administrator, który wkleił nie ten plik, zostaje z 400 uczniami, 286 kontami rodziców i 401 kodami rejestracyjnymi bez żadnej drogi odwrotu — poza trasą „prawa do bycia zapomnianym” (rola IOD, jeden uczeń na raz, dane kasowane bezpowrotnie). | brak trasy; jedyne kasowanie: `server/routes/privacy.js:137-141` | po imporcie nie istnieje żadne `DELETE`/`undo` dla `students`/`users` | Każdy import zapisuje partię w kolekcji `imports`; `POST /api/setup/imports/:id/undo` cofa ją **tylko gdy nic jeszcze nie zapisano** na utworzonych rekordach (brak ocen, frekwencji, logowań, użytych kodów) — inaczej odmawia i wskazuje, co stoi na przeszkodzie | **naprawione** |
| OPS-12 | major | Uczeń dopisany do księgi przez sekretariat nie dostaje **konta**, **opiekuna** ani **kodu rejestracyjnego** — trasa tworzy sam rekord ucznia z `parentIds: []`. Uczeń nie może się zalogować, rodzic nie ma jak założyć konta, a dane opiekunów lądują w polu tekstowym `guardians`, którego nie widzi ani moduł wiadomości, ani powiadomienia. | `server/routes/registry.js:131-167` (`:158` `parentIds: []`) | `POST /api/registry/students` → `db.one('users', u=>u.studentId===sid)` → `null`, `registrationCodes` dla ucznia → 0 | Zapis do księgi zakłada konto ucznia (bez hasła, do aktywacji) i wystawia kod rejestracyjny dla opiekuna; odpowiedź zwraca kod do wydania w sekretariacie | **naprawione** |
| OPS-13 | major | Uczeń dopisany w trakcie roku pojawia się na listach obecności **lekcji sprzed swojego przyjęcia**: lista jest liczona na żywo z `class.studentIds`, bez daty przyjęcia. Nauczyciel otwiera lekcję z 7 września i widzi ucznia, który przyszedł 20 października — może mu wpisać nieobecność za dzień, w którym nie był uczniem szkoły. Lustrzanie: uczeń, który odszedł, nadal jest na listach przyszłych lekcji (OPS-03). | `server/routes/attendance.js:24-28` (`rosterIds`) | `POST /api/registry/students` (7b) → `GET /api/attendance/lesson/les_tt_7b_1_1_2026-09-07` zawiera nowego ucznia | **poza zakresem (3.1)** — łatka dla właściciela w sekcji „Do przekazania właścicielom” | zgłoszone |
| OPS-14 | major | Nie ma przejścia na nowy rok szkolny. Jest tylko `POST /api/support/rollover` dla IPET/WOPFU (`support.js:612`). Promocja 7b→8b, utworzenie nowej 1a, zamknięcie klas kończących, przenumerowanie, wyczyszczenie planu i lekcji, przestawienie `config.year` i semestrów — wszystko trzeba zrobić ręcznie w pliku JSON. | brak trasy; istniejący wyjątek: `server/routes/support.js:612-634` | `grep "rollover\|promot" server/routes/` → tylko `support.js` | Nowy moduł `server/routes/school-year.js`: `GET /api/school-year/plan` (podgląd), `POST /api/school-year/rollover` (promocja po poziomach, absolwenci, nowe oddziały, przenumerowanie, archiwum, nowy rok), `POST /api/school-year/students/:id/retain` (pozostawienie na drugi rok) | **naprawione** |
| OPS-15 | major | Kod rejestracyjny działa po odejściu ucznia. Kod wydany klasie 7b pozostaje ważny po zamknięciu wpisu ucznia, więc ktokolwiek z kopertą zakłada konto rodzica z pełnym wglądem w dane byłego ucznia. | `server/routes/admin.js:350-376` (`:357` sprawdza tylko istnienie ucznia) | wygeneruj kod dla 7b → przenieś ucznia → `POST /api/register` tym kodem → 200, konto z `childrenIds:[<uczeń>]` | `/api/register` odmawia dla ucznia o statusie innym niż `active`; zamknięcie wpisu unieważnia niewykorzystane kody | **naprawione** |
| OPS-16 | major | Nie ma zarządzania opiekunami: `parentIds` można wyłącznie **powiększyć**, i tylko przez kod rejestracyjny. Zmiana opiekuna prawnego, śmierć rodzica, postanowienie sądu o odebraniu władzy rodzicielskiej — żadnego z tych zdarzeń nie da się odwzorować. Dodatkowo konto rodzica zakładane importem (`setup.js:63`, `pendingActivation:true`) nigdy nie jest przejmowane: `/api/register` tworzy **drugi** rekord rodzica, więc uczeń ma dwoje „opiekunów”, z których jeden nie może się zalogować. Rodzic dwojga dzieci nie ma jak dopiąć drugiego dziecka — drugi kod wymaga nowego loginu. | `server/routes/registry.js`, `server/routes/admin.js:350-376`, `server/routes/setup.js:63` | zarejestruj rodzica kodem w kreatorze → `db.get('students', sid).parentIds.length === 2`, jeden z kont bez hasła | `POST/DELETE /api/registry/students/:id/guardians` (przypięcie istniejącego konta albo wydanie kodu, odpięcie z powodem i audytem); `/api/register` przejmuje konto-kontakt założone importem po adresie e-mail i pozwala zalogowanemu rodzicowi zrealizować kolejny kod jako **dopisanie dziecka** | **naprawione** |
| OPS-17 | major | Rodzic z ograniczoną władzą rodzicielską jest nie do odwzorowania. `custodyNote` to swobodny tekst (`seed/00-base.js:76`), a `visibleStudentIds` daje każdemu przypiętemu rodzicowi **identyczny, pełny** dostęp. Sąd ograniczający władzę do „prawa do informacji o wynikach w nauce” nie ma odpowiednika w systemie — jedyna blokada (`parentAccessBlocked`) wycina **wszystkich** opiekunów naraz. | `server/lib/domain.js:14`, `server/lib/domain.js:34` | `rodzic.kowalczyk2` (rozwód) → `/api/parent/children` pełny zakres; `Object.keys(user).filter(/limit|court|restrict/)` → `[]` | **poza zakresem (3.7 / lib)** — łatka dla właściciela w sekcji „Do przekazania właścicielom” | zgłoszone |
| OPS-18 | major | Odejście nauczyciela w trakcie roku zostawia go w planie. Blokada konta (`principal.js:418`) unieważnia sesje, ale 11 pozycji planu i 19 przyszłych lekcji dalej wskazują zablokowane konto jako prowadzącego; nie ma trasy przekazania obowiązków następcy. Dyrektor może jedynie wpisywać zastępstwa dzień po dniu, a `POST /api/substitutions` obejmuje tylko lekcje **już istniejące** — lekcje wygenerowane później nie mają obsady. | `server/routes/principal.js:418-433`; `server/routes/substitutions.js:96-111` | `POST /api/principal/users/u_krol/block` → `db.col('timetable').filter(t=>t.teacherId==='u_krol').length` → 11, przyszłe lekcje → 19 | `POST /api/substitutions/handover`: trwałe przekazanie przedmiotów/oddziałów następcy od wskazanej daty — przepisuje pozycje planu i przyszłe lekcje, przenosi wychowawstwo, powiadamia klasy i rodziców, wszystko w audycie | **naprawione** |
| OPS-19 | minor | Scalanie rodzeństwa po adresie e-mail jest wrażliwe na wielkość liter i spacje: `Marta@Example.com` i `marta@example.com` dają dwa konta dla tej samej osoby. | `server/routes/setup.js:63` | CSV z tym samym adresem w dwóch zapisach → dwa konta rodzica | Normalizacja `trim().toLowerCase()` przed porównaniem i zapisem | **naprawione** |
| OPS-20 | minor | Dwoje uczniów o tym samym imieniu i nazwisku w jednym oddziale rozróżnia wyłącznie numer w dzienniku. Listy obecności podają `no` osobno, ale wybieraki ocen, wiadomości i wyszukiwarka pokazują samo „Nowak Jan” dwa razy. | `server/lib/domain.js:37` (`studentLabel`), ekrany | dopisz drugiego „Jan Nowak” do 7b → roster zwraca dwa identyczne `name` | `studentLabel` powinno dokładać rok urodzenia, gdy w oddziale są dwie identyczne pary imię+nazwisko | zgłoszone |
| OPS-21 | minor | `findConflicts` porównuje tylko importowane wiersze między sobą. Import planu dla części oddziałów nie zauważy, że sala albo nauczyciel są już zajęci przez pozycje pozostawione w bazie. | `server/routes/admin.js:81-114` | import 720 wierszy zgłasza 30 konfliktów wewnętrznych i zero wobec stanu bieżącego | Po zmianie z OPS-04 import jest pełną wymianą planu, więc konflikt „wobec bazy” znika z definicji; dla importu częściowego zostaje do rozważenia | **naprawione** — `merge: true` podmienia tylko wymienione oddziały i liczy konflikty (nauczyciel, sala, grupa) także wobec planu zapisanego, z flagą `stored: true`; test w `tests/35` |
| OPS-22 | minor | Kolumna `homeroomOf` w imporcie nauczycieli po cichu odbiera wychowawstwo poprzedniemu nauczycielowi i nie czyści jego pola `homeroomOf` — zostają dwaj „wychowawcy” tego samego oddziału. | `server/routes/setup.js:48` | import z `homeroomOf=7b` → `db.get('users','u_nowak').homeroomOf === '7b'` mimo zmiany w `classes` | Czyścić `homeroomOf` poprzednikowi i zwracać ostrzeżenie o przejęciu wychowawstwa | **naprawione** |
| OPS-24 | major | Konto rodzica założone importem kreatora nigdy nie jest aktywowane: `/api/register` tworzy **drugi** rekord, więc po rejestracji uczeń ma dwoje „opiekunów”, z czego jeden (`pendingActivation:true`, hasło losowe, nikomu nieznane) nie może się zalogować i nie da się go usunąć. Na 400 uczniów to 286 martwych kont z danymi osobowymi. | `server/routes/setup.js:63` + `server/routes/admin.js:365-371` | kreator → `POST /api/register` kodem → `db.get('students', sid).parentIds.length === 2` | `/api/register` przejmuje konto-kontakt po adresie e-mail albo po `parentUserId` zapisanym w kodzie; konto importowane powstaje bez hasła, więc do czasu aktywacji jest tylko wpisem kontaktowym | **naprawione** |
| OPS-23 | — | Rodzic z dziećmi w **dwóch różnych szkołach** jest poza zakresem prototypu: instalacja obsługuje jedną szkołę („single node”, `CONTRIBUTING.md:1`), a konto rodzica jest wierszem w bazie tej szkoły. Potrzebne jest osobne konto w każdej instalacji; scalanie to zadanie platformy EdMat (SSO, `docs/INTEGRATION.md`), nie prototypu. Warto to napisać wprost w dokumentacji, bo rodzice pytają o to w pierwszym tygodniu. | `README.md`, `docs/INTEGRATION.md` | — | Zdanie w README: jedno konto na szkołę, wspólne logowanie przez SSO platformy | poza zakresem |

### Repro A — uczeń dochodzi w trakcie roku (dane demo, „dziś” = 2026-10-23)

```js
const S = await startServer(); const sek = await S.as('sekretariat'), jn = await S.as('j.nowak');
const r = await sek.post('/api/registry/students', { firstName:'Nowy', lastName:'Przybysz', identityKind:'pesel',
  pesel:'13330931118', birthDate:'2013-05-09', birthPlace:'Kraków', classId:'7b', mother:'Przybysz Ewa' });
const sid = r.body.student.id;
S.db.one('users', u => u.studentId === sid);                       // null                      → OPS-12
S.db.col('registrationCodes').filter(c => c.studentId === sid);    // []                        → OPS-12
S.db.col('groups').filter(g => g.studentIds.includes(sid));        // []  (brak grupy językowej) → OPS-02
await jn.get('/api/attendance/lesson/les_tt_7b_1_1_2026-09-07');   // lista zawiera nowego ucznia → OPS-13
```

### Repro B — uczeń odchodzi (przeniesienie)

```js
await sek.post('/api/registry/students/st_kowalczyk_anna/transfer', { date:'2026-10-20', school:'SP 3', reason:'przeprowadzka' });
S.db.get('classes','7b').studentIds.includes('st_kowalczyk_anna');            // true  → OPS-03
S.db.col('groups').filter(g => g.studentIds.includes('st_kowalczyk_anna'));   // 3 grupy → OPS-03
(await (await S.as('rodzic.kowalczyk')).get('/api/parent/children')).status;  // 200, z Anną → OPS-03
(await S.as('anna.kowalczyk')).user;                                          // logowanie działa → OPS-03
```

### Repro C — czysta instalacja, 400 uczniów

```
school+admin                 190 ms
teachers (30)              1 707 ms
students (404 wiersze)    37 054 ms   ← OPS-06
  utworzonych 402, błędów 2 (zła suma kontrolna PESEL w. 122, brak pól w. 202) — numery wierszy są poprawne
  numery księgi 1001…1783, 381 dziur                                   ← OPS-09
  duplikat wiersza przeszedł bez ostrzeżenia, ten sam nr w dzienniku   ← OPS-05
  oddział „9z” z literówki utworzony po cichu                          ← OPS-10
  286 kont rodziców, scalanie rodzeństwa po e-mailu działa (114 rodziców z >1 dzieckiem)
timetable (720 wierszy)       26 ms   próbny import: 570 wierszy, 30 konfliktów, 150 błędów — zgodnie z prawdą
lessons/generate          29 376 lekcji, 102 ms
  144 lekcje 11.11, 144 lekcje 25.12, 144 lekcje 03.05, 144 lekcje w Poniedziałek Wielkanocny ← OPS-07
```

## Co działa dobrze

- **Nauczyciel na zastępstwie pisze dziennik.** `canEditLesson` i `canWriteLesson` uznają `substituteTeacherId`,
  więc zastępujący zapisuje frekwencję i temat bez żadnych zabiegów administracyjnych — a ocenę z przedmiotu,
  którego nie uczy, dostaje odmowę `403 not_teaching`. Dokładnie tak, jak powinno być.
- **Lekcje łączone.** Jedna lista obecności dla obu oddziałów (`combinedLessons` + `rosterIds`), jedna płatna
  godzina doraźna zamiast dwóch, wspólna sala zapisana na obu lekcjach.
- **Odwołanie i przeniesienie lekcji** jest ograniczone do pierwszej albo ostatniej godziny oddziału w danym dniu
  („w środku planu uczniowie muszą mieć zapewnioną opiekę”), a rodzice dostają powiadomienie **od razu przy decyzji**,
  nie dopiero przy publikacji arkusza. To jest myślenie o szkole, nie o bazie danych.
- **Generowanie lekcji jest idempotentne** (`generateLessons` pomija istniejące identyfikatory) — ponowne
  uruchomienie nie robi duplikatów.
- **Próbny import planu** z raportem konfliktów (nauczyciel / sala / oddział), rozpoznający lekcje łączone
  i podział na grupy jako sytuacje dozwolone, z odmową zapisu przy błędnych wierszach i wymuszeniem przy konfliktach.
- **Walidacja PESEL w sekretariacie** wskazuje pozycję błędnej cyfry, kontroluje krzyżowo datę urodzenia
  z pozycji 1–6 i odrzuca numer już wpisany do księgi. Komunikaty są po polsku i mówią, co poprawić.
- **Pakiet SIO** liczy wyłącznie uczniów `active`, wykrywa oddział bez wychowawcy, brak miejsca urodzenia,
  paszport bez kodu kraju i błędną sumę kontrolną — i **nie zapisuje pakietu**, dopóki są błędy.
- **Przeniesienie do innej szkoły** wystawia odpis arkusza ocen z frekwencją i unieważnia legitymację cyfrową.
- **Uczeń pełnoletni** może wnieść sprzeciw wobec wglądu opiekunów i jest on egzekwowany centralnie —
  w `visibleStudentIds` i w `notifyParentsOf`, więc nie da się go ominąć trasą, która o nim nie wie.
- **Powierzenie obowiązków wychowawcy** z zakresem dat, bez przenoszenia odpowiedzialności formalnej;
  `isHomeroomOf` honoruje `actingHomeroomTeacherId`.
- **Blokada konta pracownika** unieważnia sesje web i mobile, a wpisy nauczyciela w dzienniku zostają nietknięte.
- **Rejestr audytowy jest naprawdę niezmienny** (WORM, 405 na każdą modyfikację, próba też trafia do rejestru),
  a zadanie retencyjne **tylko raportuje** i niczego nie kasuje.
- **Usunięcie danych (RODO)** jako jedyne miejsce w kodzie robiło to poprawnie: wypisuje ucznia z oddziału
  **i ze wszystkich grup**. To był wzorzec, którego brakowało przeniesieniu (OPS-03).

## Co zostało naprawione w tej zmianie

Pliki: `server/routes/setup.js`, `server/routes/registry.js`, `server/routes/admin.js`,
`server/routes/substitutions.js`, `server/lib/blank-seed.js`, nowy `server/routes/school-year.js`
(zmapowany w `server/modules.js` na moduł `registry`), testy w `tests/35-registry.test.js`
i `tests/44-setup.test.js`.

| nowe/zmienione API | do czego służy |
| --- | --- |
| `POST /api/setup/students/import` · `…/teachers/import` (`dryRun`) | próbny przebieg bez zapisu, odrzucanie powtórzonego numeru PESEL i powtórzonego ucznia, kolejne numery księgi, ostrzeżenia o numerach w dzienniku i o oddziale z literówki, konta bez hasła (400 uczniów w ułamku sekundy) |
| `GET /api/setup/imports` · `POST /api/setup/imports/:id/undo` | cofnięcie pomyłkowego importu, dopóki na utworzonych kontach nic nie zapisano; odmowa wskazuje, co stoi na przeszkodzie |
| `GET/POST/PATCH/DELETE /api/admin/groups` · `POST /api/admin/classes/:id/split` | tworzenie i edycja grup zajęciowych: podział oddziału na grupy językowe, dopisanie ucznia z połowy roku, blokada usunięcia grupy używanej w planie |
| `POST /api/admin/timetable/import` | raport `lessonImpact` w próbnym imporcie i uzgodnienie lekcji po zapisie: puste kasowane, z wpisami odwoływane, nowe dogenerowane |
| `PATCH /api/admin/year` | dzień wolny zdejmuje lekcje z planu, cofnięcie decyzji je przywraca |
| `POST /api/registry/students` | zakłada konto ucznia i wystawia kod rejestracyjny dla opiekuna, zapisuje `enrolledAt` |
| `GET/POST/DELETE /api/registry/students/:id/guardians` | przypięcie i odpięcie opiekuna z podstawą prawną i audytem, wydanie kodu dla nowego opiekuna |
| `POST /api/registry/students/:id/transfer` | zamknięcie wpisu odcina ucznia od bieżącego dziennika (listy, grupy, konto, sesje, dostęp opiekunów, kody) |
| `POST /api/register` | odmawia kodu dla ucznia z zamkniętym wpisem, przejmuje konto-kontakt z importu, a zalogowanemu rodzicowi dopisuje kolejne dziecko |
| `POST /api/substitutions/handover` | trwałe przekazanie przedmiotów, lekcji i wychowawstwa następcy odchodzącego nauczyciela |
| `GET /api/school-year/plan` · `POST /api/school-year/rollover` · `POST /api/school-year/students/:id/retain` | przejście na nowy rok: promocja, absolwenci, powtarzanie roku, nowe pierwsze klasy, przenumerowanie, nowy kalendarz |

Pomiar po zmianie (ten sam plik 400 uczniów, ta sama maszyna):

```
students (412 wierszy)   111 ms   (było 37 054 ms)
  numery księgi 1001…1409, 0 dziur
  3 wiersze zgłoszone z numerami: zła suma kontrolna PESEL, braki pól, powtórzony PESEL
  1 ostrzeżenie: oddział „9z” dla 1 ucznia — sprawdź literówkę
  286 kont rodziców, 114 z dwojgiem dzieci, brak duplikatów
timetable (720 wierszy)   22 ms
lessons/generate       27 072 lekcji, 116 ms — zero lekcji w święta
cofnięcie importu        401 uczniów, 687 kont, 400 kodów, 1 oddział
```

## Do przekazania właścicielom (poza zakresem tej zmiany)

### OPS-13 — lista obecności ignoruje datę przyjęcia i datę odejścia (właściciel 3.1, `server/routes/attendance.js`)

`rosterIds` bierze `class.studentIds` bez filtra. Po poprawce OPS-03 uczeń, który odszedł, znika z listy,
ale uczeń dopisany w trakcie roku nadal widnieje na lekcjach sprzed przyjęcia.

```diff
--- a/server/routes/attendance.js
+++ b/server/routes/attendance.js
@@
 function rosterIds(db, lesson) {
-  if (lesson.groupId) { const g = db.get('groups', lesson.groupId); if (g) return g.studentIds.slice(); }
-  const c = db.get('classes', lesson.classId);
-  return c ? c.studentIds.slice() : [];
+  const enrolled = (sid) => {
+    const s = db.get('students', sid); if (!s) return false;
+    if (s.enrolledAt && lesson.date < s.enrolledAt) return false;      // przed przyjęciem do szkoły
+    if (s.leftAt && lesson.date > s.leftAt) return false;              // po wypisaniu decyzją
+    if (s.departureDate && lesson.date > s.departureDate) return false; // po przeniesieniu
+    return true;
+  };
+  if (lesson.groupId) { const g = db.get('groups', lesson.groupId); if (g) return g.studentIds.filter(enrolled); }
+  const c = db.get('classes', lesson.classId);
+  return c ? c.studentIds.filter(enrolled) : [];
 }
```

`registry.js` ustawia już `enrolledAt` przy wpisie do księgi, a poprawka OPS-03 ustawia `departureDate`
i wypisuje ucznia z `class.studentIds`, więc łatka wystarczy sama z siebie. Warto dołożyć test:
uczeń dopisany 20.10 nie pojawia się na liście lekcji z 7.09.

### OPS-17 — zakres dostępu pojedynczego opiekuna (właściciel 3.7 / `server/lib/domain.js`)

Potrzebne jest pole na koncie rodzica, nie notatka. Proponowany kształt: `user.accessScope`
(`'full' | 'info' | 'none'`) z `accessScopeReason`, `accessScopeDecidedBy`, `accessScopeAt`
oraz `accessScopeStudentIds` (ograniczenie może dotyczyć jednego dziecka, nie całego konta).

```diff
--- a/server/lib/domain.js
+++ b/server/lib/domain.js
@@
-  if (user.role === 'parent') return (user.childrenIds || []).filter((sid) => { const s = db.get('students', sid); return s && !s.parentAccessBlocked; });
+  if (user.role === 'parent') return (user.childrenIds || []).filter((sid) => {
+    const s = db.get('students', sid); if (!s || s.parentAccessBlocked) return false;
+    return parentScope(user, sid) !== 'none';                          // sąd odebrał wgląd w dane tego dziecka
+  });
@@
+/** Zakres opiekuna dla konkretnego dziecka: 'full' (domyślnie), 'info' (tylko oceny i frekwencja), 'none'. */
+function parentScope(user, studentId) {
+  const sc = user.accessScope || 'full';
+  if (sc === 'full') return 'full';
+  const ids = user.accessScopeStudentIds;
+  return !ids || ids.includes(studentId) ? sc : 'full';
+}
```

`'info'` powinno wycinać w `routes/parent.js` dane kontaktowe drugiego opiekuna, adres, dokumentację
pomocy psychologiczno-pedagogicznej, zgody na wycieczki i prawo do usprawiedliwiania — zostawiając oceny,
frekwencję i wiadomości od wychowawcy. Decyzja musi być audytowana z numerem postanowienia sądu, tak jak
wypisanie ucznia w `homeroom.js:685`. Trasa ustawiająca zakres należy do sekretariatu; przygotowane
w tej zmianie `POST /api/registry/students/:id/guardians` przyjmuje już pole `accessScope` i je zapisuje —
brakuje wyłącznie egzekwowania go po stronie 3.7.

### OPS-03 (część) — wypisanie ucznia decyzją administracyjną (właściciel 3.2, `server/routes/homeroom.js`)

`POST /api/homeroom/students/:studentId/remove` ustawia `status:'removed'`, ale — tak samo jak przeniesienie
przed poprawką — zostawia ucznia w `class.studentIds` i w grupach, z czynnym kontem.

```diff
--- a/server/routes/homeroom.js
+++ b/server/routes/homeroom.js
@@ s.achievements = (s.achievements || []).map(...)
+    cls.studentIds = (cls.studentIds || []).filter((x) => x !== s.id);
+    for (const g of db.col('groups')) g.studentIds = (g.studentIds || []).filter((x) => x !== s.id);
+    const su = db.one('users', (u) => u.studentId === s.id);
+    if (su) { su.blocked = true; su.blockedReason = `Wypisanie z klasy — decyzja ${decisionNo}`; }
+    for (const ses of db.col('sessions')) if (su && ses.userId === su.id && !ses.revoked) { ses.revoked = true; ses.revokedReason = 'student_removed'; }
+    for (const rc of db.col('registrationCodes')) if (rc.studentId === s.id && !rc.usedAt) { rc.voidedAt = U.now(); rc.voidReason = 'removed'; }
     db.save();
```

### Uwaga z przebiegu testów — `[3.1.25]` czerwony nie z powodu tej zmiany (właściciel 3.1)

W trakcie przeglądu `public/app/core.js` dostał kolejkę offline kluczowaną kontem
(`edmat.queue.<userId>` zamiast `edmat.queue`, `enqueue()` zwraca `null`, gdy nikt nie jest zalogowany),
a `tests/31a-lessons.test.js` nadal czyta `store['edmat.queue']` i nie ustawia użytkownika kolejki.
Test przewraca się na `shell.noNet` przy pierwszym `A.api.post(..., { queueable: true })`.
Żaden z tych dwóch plików nie należy do zakresu tej zmiany (zmiany serwerowe nie mają z nimi styku —
test uruchamia `core.js` w piaskownicy `vm` z atrapą `fetch`). Łatka dla właściciela:

```diff
--- a/tests/31a-lessons.test.js
+++ b/tests/31a-lessons.test.js
@@ test('[3.1.25] kolejka offline z core.js: …
   const { A, store, fire } = loadCore({ online: false, fetch: fakeFetch });
+  A.setQueueUser('u_nowak');                 // kolejka jest teraz per konto — bez tego enqueue() zwraca null
@@
-  const queued = JSON.parse(store['edmat.queue']);
+  const queued = JSON.parse(store['edmat.queue.u_nowak']);
```
(oraz analogicznie w punktach 3. i w asercji „kolejka pusta po synchronizacji”; `flushQueue()` wymaga
dodatkowo `A.state.user.id === 'u_nowak'`, więc test musi ustawić też zalogowanego użytkownika).

### OPS-20 — rozróżnienie imienników (właściciel: `server/lib/domain.js` + ekrany)

```diff
-function studentLabel(s) { return s ? `${s.rollNo != null ? s.rollNo + '. ' : ''}${s.lastName} ${s.firstName}` : ''; }
+function studentLabel(s, db) {
+  if (!s) return '';
+  const base = `${s.rollNo != null ? s.rollNo + '. ' : ''}${s.lastName} ${s.firstName}`;
+  if (!db) return base;
+  const twin = db.col('students').some((x) => x.id !== s.id && x.classId === s.classId && x.lastName === s.lastName && x.firstName === s.firstName && x.status === 'active');
+  return twin && s.birthDate ? `${base} (ur. ${s.birthDate})` : base;
+}
```
