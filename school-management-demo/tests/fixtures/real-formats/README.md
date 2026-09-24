# Fixture'y w formatach, które szkoły naprawdę mają

> Sample exports shaped like the files a Polish school can actually hand us: an aSc Timetables XML,
> a VULCAN "Plan lekcji Optivum" HTML publication (windows-1250), municipal/incumbent pupil rosters
> and an illustrative year-end logbook archive. Every section says which parts follow the real
> schema and which are reconstructed from memory.

Powód: raport z 23.09.2026 (`docs/research/2026-09-23-gemini-triage.md`, wiersze 1–4 sekcji 1)
stwierdza wprost, że nasz CSV planu lekcji (`GET /api/admin/timetable/format`,
`class;weekday;lessonNo;subject;teacherLogin;room;group`) jest formatem wymyślonym, a szkoły mają
aSc XML albo publikację Optivum. Te pliki są **wejściem dla importerów z pakietu R1**, nie
formatem docelowym.

## Skróty

* **SCHEMAT** — kształt, którego jestem pewien: tak wygląda plik z prawdziwego programu.
* **REKONSTRUKCJA** — kształt odtworzony z pamięci/opisu; prawdopodobny, ale nie do cytowania.
* **WYMYŚLONE** — dane wypełniające (nazwiska, e-maile, kolory); realistyczne, ale bez pokrycia.

Dane osobowe są syntetyczne. Numery PESEL mają poprawną sumę kontrolną, ale nie należą do nikogo.

## Regeneracja

```bash
tests/fixtures/real-formats/_gen/generate-all.sh      # tylko Python 3 ze stdlib, zero zależności
```

Generatory są deterministyczne — ponowne uruchomienie daje bajt w bajt te same pliki. Kadrę, sale,
przedmioty i oddziały trzyma `_gen/school.py`; nazwiska pokrywają się z `server/seed/00-base.js`
tam, gdzie to możliwe.

---

## 1. `asc/plan-sp12.xml` — aSc Timetables, eksport XML (60 KB)

**Czym jest.** To, co wychodzi z aSc Timetables (ASC Applied Software Consultants, w Polsce sprzedawane
też jako „Plan lekcji”) przez *Eksport → XML*. Dwa warianty krążą po szkołach: „aSc Timetables 2008 XML”
i „aSc Timetables 2012 XML”; ten plik to ten drugi.

**SCHEMAT (pewne):**

* korzeń `<timetable ascttversion="…" importtype="database" options="…" displayname="…">`;
* kolekcje-tabele w tej kolejności: `periods`, `daysdefs`, `weeksdefs`, `termsdefs`, `subjects`,
  `teachers`, `classrooms`, `classes`, `groups`, `students`, `lessons`, `cards`;
* każda kolekcja niesie `options="canadd,canremove,canupdate,silent"` i `columns="…"` — lista
  atrybutów w kolejności, w jakiej aSc je zapisuje (to jest deklaracja schematu wewnątrz pliku);
* **identyfikatory** to nieprzezroczyste tokeny; aSc pisze `*1`, `*2`, … z **jednego licznika
  wspólnego dla wszystkich typów encji** (sala i nauczyciel nigdy nie mają tego samego id);
* `days` to maska bitowa dni, `"10000"` = poniedziałek; `daysdef` może trzymać **listę masek po
  przecinku** (`"10000,01000,…"` = „dowolny dzień”);
* `weeks`: `"11"` każdy tydzień, `"10"` tydzień I, `"01"` tydzień II;
* `<group>` ma `classid`, `entireclass="1"` dla całej klasy oraz `divisiontag` — grupy o tym samym
  `divisiontag` to **wzajemnie wykluczający się podział tego samego oddziału** (języki, WF, religia/etyka);
* `<lesson>`: `periodspercard` (długość jednej karty; `2` = lekcja podwójna), `periodsperweek`
  (godziny tygodniowo łącznie), `classids` / `groupids` / `teacherids` / `classroomids` —
  **listy id po przecinku**, plus `termsdefid`, `weeksdefid`, `daysdefid`;
* `<card>`: `lessonid`, `period`, `days`, `weeks`, `terms`, `classroomids` — sala z karty ma
  pierwszeństwo przed listą sal z lekcji.

**REKONSTRUKCJA / niepewne:**

* atrybut `displaycountry="pl"` — brief prosił o `displaycountries`; nie umiem rozstrzygnąć, która
  pisownia jest prawdziwa. **Importer powinien przyjąć obie i zignorować obie.**
* zawartość `options` w korzeniu (`idprefix`, `exportlicensename`, `exportlicensenumber`,
  `numberofweeks`) — wiarygodna, ale nie dosłowna;
* `<buildings>` i `<students>` są puste. Prawdziwe eksporty niosą dodatkowo m.in. `<globalsettings>`,
  `<studentsubjects>`, `<teachercards>`, `<subjectcards>` — **importer musi po cichu pomijać
  nieznane elementy i nieznane atrybuty**, bo ten zestaw zależy od wersji i od licencji.

**WYMYŚLONE:** nazwiska, e-maile, kolory nauczycieli, numery licencji.

**Co plik pokrywa (celowo):**

| Przypadek | Gdzie |
| --- | --- |
| cykl dwutygodniowy A/B | informatyka w 7a/7b/8a/8b: grupa 1 `weeksdefid` → `weeks="10"`, grupa 2 → `"01"`, ta sama karta-okienko |
| podział na grupy językowe | `divisiontag="1"`, grupy „1. grupa” / „2. grupa”, angielski i niemiecki |
| WF chłopcy / dziewczęta | `divisiontag="2"`, grupy „Chłopcy” / „Dziewczęta”, dwie różne sale w tym samym okienku |
| lekcja podwójna | 8 lekcji WF z `periodspercard="2"` |
| religia i etyka równolegle | `divisiontag="3"`, grupy „Religia” / „Etyka” w tym samym okienku |
| lekcja z dwoma nauczycielami | matematyka 7b: `teacherids="*32,*44"` (nauczyciel + nauczyciel wspomagający) |
| lekcja bez sali | etyka we wszystkich 8 oddziałach: `classroomids=""` |
| polskie znaki diakrytyczne | w `name`, `lastname` i w **skrótach** (`ŻM`, `ĆH`, `DŁ`, `ŚZ`, `ŁU`) |

**Zasięg:** 8 oddziałów ułożonych w całości (1a, 1b, 3a, 3b, 7a, 7b, 8a, 8b), 20 nauczycieli,
14 sal, 108 lekcji, 264 karty. **To nie jest cała szkoła** — brief mówi o 24 oddziałach, a
`server/seed/00-base.js` zasiewa 5 (1a, 3a, 7a, 7b, 8b). Ani jedna z tych trzech liczb nie zgadza
się z pozostałymi; to celowe, importer i tak musi umieć wgrać plan dla podzbioru oddziałów
(`merge: true` w `POST /api/admin/timetable/import`).

**Pułapki:**

1. `teacherids`, `classroomids`, `classids`, `groupids` to **listy**. Zero sal (`""`), dwóch
   nauczycieli, dwa oddziały na jednej lekcji (zajęcia międzyoddziałowe) są normalne.
2. Kilka lekcji w tym samym okienku tego samego oddziału to **nie jest konflikt**, jeśli mają
   różne grupy tego samego `divisiontag` albo rozłączne `weeks`. `findConflicts()` w
   `server/routes/admin.js` liczy konflikty po `(classId, weekday, lessonNo)` — na tym pliku
   zgłosi ich setki, jeśli nie nauczy się grup i tygodni.
3. `periodspercard="2"` to jedna karta o długości dwóch godzin lekcyjnych — trzeba ją rozwinąć na
   dwa wiersze `timetable` (`lessonNo` i `lessonNo+1`).
4. `weeks="10"` / `"01"` nie ma odpowiednika w naszej kolekcji `timetable` (kolumny:
   `classId, weekday, lessonNo, subjectId, teacherId, room, groupId`). Import musi albo spłaszczyć
   do „co tydzień”, albo dołożyć pole tygodnia — i to jest decyzja produktowa, nie techniczna.
5. `period` w karcie odnosi się do atrybutu `period` z `<periods>`, a nie do pozycji w liście.
   W prawdziwych planach istnieje lekcja „0” (7:10) — tu jej nie ma, ale importer nie może zakładać,
   że pierwsza godzina ma numer 1.
6. Sale i nauczycieli dopasowujemy po `short` (`NJ`, `12`, `sg`), bo `id` jest lokalne dla eksportu
   i zmienia się przy każdym zapisie z aSc. Nasze `users[].login` (`j.nowak`) nie ma z tym nic wspólnego.

## 2. `asc/plan-old-2008.xml` — starszy eksport aSc (12 KB)

**REKONSTRUKCJA, niska pewność.** Wycinek (tylko 7a i 7b) w kształcie, jaki kojarzę z „aSc Timetables
2008 XML”. Różnice wobec pliku 2012, których mam się spodziewać:

* brak `<daysdefs>`, `<weeksdefs>`, `<termsdefs>` — dni i tygodnie siedzą wprost na karcie;
* brak atrybutów `options` / `columns` na kolekcjach (nie ma deklaracji schematu w pliku);
* nauczyciel ma jedno pole `name="Joanna Nowak"` zamiast `firstname` + `lastname`;
* brak `<groups>`; podział siedzi jako `group="1"` / `group="2"` na `<lesson>`;
* `durationperiods` zamiast `periodspercard`;
* karta ma `day="1".."5"` (numer dnia) zamiast maski `days`, i pojedyncze `classroomid` zamiast `classroomids`.

**Traktuj to jako „prawdopodobny stary kształt”, nie jako specyfikację.** Jeśli importer ma obsłużyć
oba, niech rozgałęzia się po `ascttversion` i po obecności `<weeksdefs>`, a przy nieznanym układzie
niech wypisze czytelny błąd zamiast zgadywać.

## 3. `asc/plan-edge.xml` — wariant z pułapkami (61 KB)

Ten sam plan co `plan-sp12.xml`, plus:

* **BOM UTF-8** (`EF BB BF`) przed deklaracją XML — `JSON.parse`-owa naiwność tu nie wystarczy,
  a niektóre parsery XML wykrzaczą się na `Content at start of document`;
* **CRLF** we wszystkich 530 liniach;
* karta wskazująca na **nieistniejące id sali** `classroomids="*9999"`;
* nauczycielka z **pustym skrótem** `short=""` (Halina Ćwikła) — dopasowanie po `short` musi mieć plan B;
* **zdublowana karta**: ta sama `lessonid`, ten sam dzień i ta sama godzina występują dwa razy
  (plus wariant z zepsutą salą, czyli trzy wiersze na to samo okienko).

Oczekiwane zachowanie importera: nie wywalać się, zgłosić trzy pozycje w `errors`/`conflicts`
i policzyć je w raporcie z `dryRun`.

## 3a. `asc/plan-extra.xml` — zajęcia międzyoddziałowe i godzina 0 (7,5 KB)

Mały, ręcznie zbudowany eksport aSc (3 oddziały, 4 nauczycieli, 5 sal, 7 lekcji, 10 kart) dla
dwóch przypadków, których świadomie **nie ma** w `plan-sp12.xml` — tamten plik ma zamrożone liczby,
na których opiera się `tests/51-timetable-import.test.js`.

**Zajęcia międzyoddziałowe** — `<lesson>` z dwoma oddziałami w `classids`:

| Lekcja | `classids` | `groupids` | Co to jest |
| --- | --- | --- | --- |
| religia | 7a + 7b | grupa „Religia” z każdego oddziału | jedna katechetka uczy obie klasy naraz |
| WF | 7b + 8a | grupa „Chłopcy” z każdego oddziału | międzyoddziałowa grupa ćwiczebna, `periodspercard="2"` |

Obie mają `seminargroup="2"` (aSc oznacza tak lekcje złożone z grup kilku oddziałów).
Importer musi rozpisać taką lekcję na **osobny wiersz `timetable` per oddział** — z tą samą salą,
tym samym nauczycielem i tą samą godziną. Jeżeli tego nie zrobi, w planie 8a zabraknie WF-u, a
kontrola kolizji nauczyciela zobaczy „dwie lekcje naraz” tam, gdzie jest jedna.

**Godzina 0** — `<periods>` zaczyna się od `<period name="0" period="0" starttime="7:10" endtime="7:55"/>`,
a dwie karty mają `period="0"` (angielski w 7a w czwartek, matematyka w 8a w piątek). Numer godziny
czyta się z atrybutu `period`, nie z pozycji w liście.

> **Uwaga dla importera: godziny 0 nie da się dziś zapisać.** `server/routes/admin.js` waliduje
> numer lekcji jako `no >= 1 && no <= (config.lessonTimes || []).length`, więc `period="0"`
> **zawsze** wpadnie w „numer lekcji poza planem dzwonków”, niezależnie od tego, co szkoła ma
> w `config.lessonTimes`. Co więcej, górna granica to **długość tablicy**, a nie największe `no`
> w niej: szkoła, która dopisze `{ no: 0, start: '07:10', end: '07:55' }` na początku
> ośmioelementowej listy, dostanie tablicę o długości 9 i zakres dozwolony 1–9 — czyli numer 9,
> którego nie ma, przejdzie, a numer 0, który jest, nadal nie. (`server/routes/parent.js`
> liczy tę samą granicę inaczej, przez `reduce(max(t.no))` — te dwa miejsca się rozjeżdżają.)
> **Jak szkoła ma dodać godzinę 0:** albo przenumerować dzwonki (0→1, 1→2, …), co psuje wszystkie
> wydrukowane plany i wszystkie istniejące wiersze `timetable`, albo zmienić warunek na
> `lessonTimes.some((t) => t.no === no)` i dopuścić `no: 0`. To decyzja do pakietu R1, nie do fixture'a —
> tutaj jest tylko dowód, że takie pliki istnieją.

**Druga pisownia atrybutu w korzeniu.** Ten plik ma `displaycountries="pl"`, podczas gdy
`plan-sp12.xml` ma `displaycountry="pl"` — patrz §7. Dzięki temu obie pisownie są w korpusie i
zachowanie „przyjmij obie, zignoruj obie” da się pokryć testem.

## 4. `optivum/` — VULCAN „Plan lekcji Optivum”, publikacja HTML (316 KB)

**Czym jest.** *Plik → Opublikuj plan → Zapisz stronę na dysku*. Setki szkół mają dokładnie to na
swojej stronie WWW — najłatwiej dostępny plan lekcji w Polsce.

```
optivum/index.html          frameset: lista po lewej, plan po prawej
optivum/lista.html          spis odnośników: Oddziały / Nauczyciele / Sale
optivum/plany/o1..o8.html   oddziały
optivum/plany/n1..n6.html   nauczyciele
optivum/plany/s1..s4.html   sale
optivum/utf8/…              ten sam eksport w UTF-8 (nowsze wersje programu)
optivum/edge/plany/…        wariant z pułapkami (rowspan, pusty dzień, wychowawca)
optivum/ab/…                cykl dwutygodniowy T1/T2 — osobna publikacja, patrz §4a
optivum/edge2/…             celowa niespójność oddział ↔ nauczyciel, patrz §4b
```

**SCHEMAT (pewne):** drzewo `index.html` + `lista.html` + katalog `plany/` z `o*`, `n*`, `s*`;
windows-1250 w starszych buildach; `<table class="tabela">`; kolumny `Nr`, `Godz`, a potem
Poniedziałek…Piątek; komórka lekcji ma postać
`<span class="p">przedmiot</span> <a href="../plany/n3.html" class="n">KE</a> <a href="../plany/s3.html" class="s">15</a>`;
na stronie nauczyciela i sali w miejsce nauczyciela wchodzi odnośnik do oddziału z `class="o"`;
podział na grupy to dwa wpisy w jednej komórce rozdzielone `<br>`, z sufiksem `-1/2` / `-2/2`;
godziny w formacie `8:00- 8:45`; stopka z nazwą programu i datą wygenerowania.

**REKONSTRUKCJA:** dokładny arkusz stylów, znaczniki `tytulnapis` / `opis`, treść i układ stopki,
oraz sposób numerowania stron (prawdziwy eksport numeruje w kolejności z programu, niekoniecznie
alfabetycznie).

**Celowo zmniejszone:** 8 oddziałów, 6 nauczycieli, 4 sale, po ~12 godzin tygodniowo na oddział i
tylko 6 przedmiotów — dzięki temu **każdy odnośnik w fixturze prowadzi do istniejącego pliku**.
Prawdziwa publikacja obejmuje całą szkołę i ma kilkadziesiąt stron. To **inny plan niż `asc/plan-sp12.xml`**,
choć ta sama szkoła i ta sama kadra: nie porównuj jednego z drugim.

**Pułapki:**

1. **windows-1250.** Sprawdzone bajtowo: `ł` = `0xB3`, `ą` = `0xB9` (dalej: `ś`=`0x9C`, `ż`=`0xBF`,
   `Ś`=`0x8C`, `ó`=`0xF3`). Odczyt jako UTF-8 daje krzaki albo `U+FFFD`. **Node 18 nie ma dekodera
   cp1250** — `TextDecoder('windows-1250')` działa tylko z pełnym ICU, którego nie gwarantujemy, a
   npm-a nie dokładamy. Importer potrzebuje własnej 128-elementowej tablicy dla bajtów `0x80–0xFF`.
2. Kodowanie deklaruje `<meta http-equiv="Content-Type" content="text/html; charset=windows-1250">`
   w `<head>`. **Sniffuj ten meta**, nie zgaduj: `optivum/utf8/` ma identyczny znacznik z `charset=utf-8`.
3. Odnośniki wewnątrz `plany/o1.html` są zapisane jako `../plany/n3.html` — wychodzą katalog w górę
   i wracają. Rozwiązuj je względem pliku, nie doklejaj do katalogu.
4. **Nie ma żadnych identyfikatorów.** Nauczyciel to skrót `KE`, sala to `15`, oddział to `4 A` /
   `4A`. Dopasowanie do bazy idzie po nazwie i po skrócie — i dlatego import musi mieć krok
   „zmapuj skróty” z podglądem, zanim cokolwiek zapisze.
5. Jedna komórka może zawierać kilka lekcji rozdzielonych `<br>`. Sufiks `-1/2` stoi **przy
   przedmiocie na stronie oddziału**, a **przy oddziale na stronie nauczyciela i sali** (`4A-1/2`).
   Gdzie tego szukać w fixturze: `optivum/plany/s3.html` ma 16 wpisów `…-1/2`,
   `optivum/plany/s1.html` — 16 wpisów `…-2/2` (grupa 1 angielskiego ma salę 15, grupa 2 salę 12,
   więc każda z nich wychodzi na innej stronie sali). `s2.html` i `s4.html` sufiksów nie mają,
   bo w tych salach nie ma zajęć dzielonych.
6. `optivum/edge/plany/n1.html`: lekcja podwójna zapisana jako `rowspan="2"`. W kolejnym wierszu
   jest wtedy **mniej `<td>` niż dni tygodnia** — parser liczący komórki po pozycji rozjedzie się na
   całej reszcie tabeli. Trzeba prowadzić licznik zajętych wierszy per kolumna.
7. `optivum/edge/plany/n1.html` ma też **całą kolumnę dnia pustą** (piątek) — to legalne.
8. `optivum/edge/plany/o1.html` ma wiersz `Wychowawca: …` w nagłówku strony oddziału (nie wszystkie
   szkoły go publikują) — dodatkowe źródło przypisania wychowawcy, ale nie da się na nim polegać.
9. Pusta godzina to `<td class="l">&nbsp;</td>`, nie pusty `<td>`.
10. Pliki mają zakończenia linii **CRLF**, a `index.html` to `<frameset>` bez `<body>`.

## 4a. `optivum/ab/` — cykl dwutygodniowy w publikacji Optivum (11 plików, 34 KB)

4 oddziały (`o1`–`o4`: 7 A, 7 B, 8 A, 8 B), 3 nauczycieli (`n1`–`n3`), 2 sale (`s1`–`s2`),
windows-1250, komplet odnośników rozwiązywalny wewnątrz katalogu. Każdy oddział ma 6 godzin
w tygodniu, w tym **jedną w cyklu A/B**: w środę informatyka w tygodniu I i fizyka w tygodniu II,
w tym samym okienku, u tego samego nauczyciela, w dwóch różnych salach.

**REKONSTRUKCJA — i to słabsza niż w pozostałych sekcjach.** Nie umiem potwierdzić, żeby
„Plan lekcji Optivum” miał w publikacji HTML **własny wymiar tygodnia**: siatka, którą znam, ma
tylko `Nr`, `Godz` i pięć dni, i nie ma w niej miejsca na tydzień I/II. To, co odtwarza ten
fixture, to **obejście, którego używają szkoły**: obie lekcje wpisane w jedną komórkę, rozdzielone
`<br>`, z markerem tygodnia doklejonym do nazwy przedmiotu (`informatyka-T1`, `fizyka-T2`), plus
legenda `<p class="opis">` pod tabelą. Markery bywają różne (`T1`/`T2`, `I`/`II`, `tyg.A`/`tyg.B`,
`co 2 tyg.`) i **nie są ustandaryzowane** — to zwykły tekst wpisany przez planistę.

Drugi kształt, który spotkasz w naturze, a którego tu **nie ma**: szkoła publikuje **dwa osobne
drzewa** (`tydzienI/`, `tydzienII/` albo dwa pliki ZIP), każde jako normalny jednotygodniowy plan.
Jeśli importer ma to obsługiwać, poproś o fixture w `REQUESTS.md` — dorobienie to kilkanaście linii
w `_gen/gen_optivum_ab.py`.

**Pułapki:**

1. Marker tygodnia jest **nieodróżnialny składniowo od sufiksu grupy**: `informatyka-T1` wygląda
   dokładnie jak `j.angielski-1/2`. Różnicę robi tylko kształt sufiksu (`-N/M` = grupa, cokolwiek
   innego = prawdopodobnie tydzień) i legenda pod tabelą. Heurystyka, nie reguła — dlatego wynik
   musi trafić do `warnings` i pod oko człowieka, a nie po cichu do bazy.
2. Legenda `<p class="opis">…</p>` stoi **po** `</table>`, a przed stopką generatora. Parser, który
   kończy czytanie na `</table>`, jej nie zobaczy.
3. Jeśli importer spłaszcza cykl do „co tydzień”, z jednej komórki zrobią się **dwie lekcje w tym
   samym okienku tego samego oddziału** — czyli fałszywy konflikt. Alternatywa (wziąć tylko T1)
   gubi połowę planu. Obie drogi wymagają komunikatu.

## 4b. `optivum/edge2/` — celowa niespójność oddział ↔ nauczyciel (8 plików, 21 KB)

2 oddziały (`o1` = 7 A, `o2` = 7 B), 2 nauczycieli (`n1` = Nowak, `n2` = Sikora), 2 sale
(`s1` = 12, `s2` = 15), 10 godzin tygodniowo, windows-1250. **Strony oddziałów i strony sal
pokazują stan faktyczny; strony nauczycieli mają dwa wstawione błędy** — dokładnie takie, jakie
powstają, gdy planista poprawi plan i opublikuje część stron ze starego stanu.

| Id | Gdzie | Strona oddziału / sali | Strona nauczyciela |
| --- | --- | --- | --- |
| **M1** (sala) | 7 A, poniedziałek, godz. 2, matematyka, NJ | `plany/o1.html` → sala **12**; `plany/s1.html` (sala 12) potwierdza | `plany/n1.html` → sala **15** |
| **M2** (nauczyciel) | 7 B, środa, godz. 1, j.polski | `plany/o2.html` → **SB**; `plany/s2.html` (sala 15) → **SB** | `plany/n1.html` (**Nowak**) ma tę godzinę u siebie, `plany/n2.html` (**Sikora**) jej nie ma |

Poza tymi dwoma punktami publikacja jest spójna, więc kontrola krzyżowa powinna zwrócić dokładnie
**2 rozbieżności** i ani jednej więcej. Oczekiwane zachowanie: zgłosić obie, wskazać, która strona
mówi co, i **nie zgadywać, która ma rację** — na stronie oddziału i na stronie sali jest większość
głosów, ale to jest reguła produktowa, nie fakt o formacie.

## 5. `register/` — listy uczniów i kadry (72 KB)

### `register/nabor-vulcan.csv` + `register/nabor-vulcan.utf8.csv`

Eksport kandydatów z gminnego systemu naboru (VULCAN Nabór i odpowiedniki), taki, jaki sekretariat
dostaje w sierpniu. **REKONSTRUKCJA nagłówków** — kształt (jeden wiersz na kandydata, dwa bloki
opiekunów, wolnotekstowe „Uwagi”) jest prawdziwy, dokładne brzmienie kolumn nie jest potwierdzone.

* windows-1250, `;`, CRLF, 60 wierszy danych. Bliźniak w UTF-8 **z BOM** ma tę samą treść.
* **W nagłówku jest półpauza**: `Opiekun 1 – nazwisko` (bajt `0x96` w CP1250, `U+2013` w UTF-8).
  Dopasowanie nagłówka zwykłym dywizem `-` nie trafi. To najczęstszy powód „importer nie widzi opiekunów”.
* Daty: `DD.MM.RRRR`.
* **3 uczniów bez PESEL** (kolumna `Dokument tożsamości`): `paszport UA FL123456`,
  `karta pobytu BY 0012345`, `paszport VN N1234567`. To **jedno wolne pole tekstowe**, a
  `POST /api/registry/students` chce `passport` (≥ 6 znaków) i osobno `passportCountry` (kod kraju,
  pakiet SIO). Rozbicie tego stringu to heurystyka i musi mieć ręczną poprawkę w UI.
* **1 uczeń z jednym opiekunem** (wszystkie kolumny `Opiekun 2 – …` puste).
* **1 uczeń z adnotacją sądową** w Uwagach, zawierającą **średnik w środku pola** → pole jest w
  cudzysłowach. `line.split(';')` rozwala ten wiersz. (Treść: ojciec pozbawiony władzy rodzicielskiej —
  to dokładnie przypadek z pakietu R3, `guardianStatus: deprived`, domyślny zakres `none`.)
* **Bliźnięta**: to samo nazwisko, ten sam adres, ta sama data urodzenia, różne numery PESEL, oddział 7a.
  Deduplikacja „po nazwisku + dacie urodzenia” skasuje jedno dziecko.
* Nazwisko dwuczłonowe (`Kowalska-Wójcik`), imiona z diakrytykami (`Żaneta`, `Łucja`, `Miłosz`).
* **57 z 60 numerów PESEL ma poprawną sumę kontrolną** i zakodowaną datę urodzenia zgodną z kolumną
  `Data urodzenia` — `U.validatePesel()` je przyjmie.
* Oddziały: `1a, 1b, 3a, 3b, 7a, 7b, 8a, 8b`. Zasiew ma tylko `1a, 3a, 7a, 7b, 8b` — import musi
  albo zakładać oddziały, albo zgłosić brakujące, zanim cokolwiek zapisze.

### `register/librus-uczniowie.csv`

Kształt listy uczniów z Librus Synergia (*Wydruki i zestawienia*). **REKONSTRUKCJA nazw kolumn.**
UTF-8 **bez BOM**, `;`, CRLF, kolumna porządkowa `Lp.`, daty **ISO `2012-03-04`**, opiekun jako
jeden string `Imię Nazwisko`, adres w jednym polu, `Nr w dzienniku` liczony w obrębie klasy.

### `register/uonet-uczniowie.csv`

Kształt rosteru z VULCAN UONET+ (eksport do XLSX, zapisany jako CSV w polskim Excelu).
**REKONSTRUKCJA nazw kolumn.** windows-1250, `;`, CRLF, **każde pole w cudzysłowach** (także liczby
i puste), daty **`04.03.2012`**, adres rozbity na `Miejscowość / Ulica / Nr domu / Nr mieszkania /
Kod pocztowy / Poczta`, opiekun jako `Nazwisko Imię` + osobna kolumna `Stopień pokrewieństwa`,
`Nr w księdze` zamiast numeru w dzienniku.

> **Te trzy pliki opisują tych samych 60 uczniów.** Inna kolejność imienia i nazwiska, inny format
> daty, inny podział adresu, inne kodowanie opiekuna, inny separator numeru porządkowego. To jest
> gotowy materiał na test dopasowywania rekordów i na test „ten sam uczeń wgrany dwa razy”.

### `register/staff.csv`

Lista kadry: nazwisko, imię, skrót, stopień awansu zawodowego, wymiar (`18/18`), przedmioty,
kody kwalifikacji, wychowawstwo, e-mail. **REKONSTRUKCJA w całości**, kształt zapożyczony z arkusza
organizacyjnego. **Kody kwalifikacji (`01`, `05/10`, …) są wymyślone — to nie są kody SIO.** Jeśli
importer ma je czytać, musi je traktować jak nieprzezroczyste etykiety. Skróty (`NJ`, `WA`, …) są tym
samym kluczem, którego używają `asc/` i `optivum/` — to jedyny most między planem lekcji a kadrą.
windows-1250, `;`, CRLF.

## 6. `archive/dziennik-2025-2026-sample.xml` — archiwum roczne (221 KB)

**ILUSTRACYJNE. To nie jest schemat żadnego producenta** i nie należy go traktować jak takiego —
plik ma na wstępie komentarz, który to mówi. Odtwarza *obowiązek* z § 21 / § 22 rozporządzenia MEN
z 25.08.2017 (eksport dziennika do XML; archiwizacja w ciągu 10 dni od końca roku szkolnego) oraz
to, co szkoły relacjonują o **zawartości** takiego eksportu (raport, punkt 3).

Zakres: oddział 7B, marzec 2026, 24 uczniów, 110 lekcji z frekwencją, oceny bieżące i śródroczne, uwagi.

**Co oddaje wiernie (i po to powstał):**

1. **Oceny przychodzą jako gołe wartości.** Brak wag, brak kategorii, brak kolorów, brak historii
   poprawek. `<ocena wartosc="4" rodzaj="biezaca"/>` i tyle. Nasz model ocen (kategorie z
   `server/seed/00-base.js`, wagi, zasada `retakeRule`) musi się po imporcie **odbudować lokalnie**,
   a import musi umieć powiedzieć nauczycielowi, że wag nie było w pliku.
2. **Kody frekwencji są cudze.** Plik używa `ob / nb / u / sp / zw / ns`. Nasz `ATTENDANCE_STATUSES`
   w `server/lib/domain.js` to `ob, nb, sp, zw, u, rs, w` — **`ns` (nieobecność z przyczyn szkolnych)
   nie ma u nas odpowiednika**, a `rs` i `w` nie mają odpowiednika tam. `D.attendanceStats()` wypisuje
   ostrzeżenie i **nie liczy** nieznanych statusów do frekwencji, więc cicha zgubienie kodu jest
   widoczne dopiero w statystykach. Mapowanie musi być jawne i przejrzane przez wychowawcę.
3. Uczeń bez numeru PESEL ma `pesel=""` i `dokumentTozsamosci="paszport VN N1234567"`.
4. Ocena zachowania jedzie w tym samym elemencie `<ocena>`, tylko z wartością tekstową
   (`wzorowe`, `bardzo dobre`…) i `przedmiot="Zachowanie"`.
5. `<podpis typ="brak">` — **pliku nikt nie podpisał**. Podpis (XAdES: podpis zaufany, osobisty albo
   kwalifikowany) powstaje poza systemem; to jest dokładnie pakiet R2 z triage'u.
6. Czego w eksporcie **nie ma**, a szkoła o tym nie wie, dopóki nie przejdzie: wiadomości,
   dokumentacja pomocy psychologiczno-pedagogicznej (osobne PDF-y), wagi, kategorie, poświadczenia
   rodziców.

## 7. `displaycountry` czy `displaycountries` w korzeniu aSc — **NIE WIEM**

Prośba z `REQUESTS.md` brzmiała „potwierdź pisownię”. Uczciwa odpowiedź: **nie mam czym potwierdzić
i nie potwierdzam**. Zamiast zgadywać, rozpisuję, co wiem i czego nie.

**Czego jestem pewien:** korzeń `<timetable>` niesie `ascttversion`, `importtype` i `options`;
atrybut, o który chodzi, jest **kosmetyczny** — to podpowiedź lokalizacyjna dla własnego UI aSc
i dla EduPage. Żaden importer planu lekcji nie potrzebuje go do niczego: ani do dni, ani do godzin,
ani do kodowania (to jest zawsze UTF-8 zadeklarowane w prologu XML).

**Czego nie wiem:** która pisownia jest prawdziwa. Moja pamięć skłania się do liczby pojedynczej
(`displaycountry`) i taką ma `plan-sp12.xml` — ale to jest słaba pamięć, nie dowód. Brief, na
podstawie którego powstał ten katalog, prosił o `displaycountries`, czyli **ktoś inny pamięta
liczbę mnogą**. Dwie sprzeczne pamięci i zero źródeł to jest `unknown`, a nie „pewnie singular”.
Nie mam tu dostępu do żadnego prawdziwego eksportu ani do dokumentacji ASC.

**Co z tym zrobiłem zamiast zgadywać:** w korpusie są teraz **obie pisownie** — `plan-sp12.xml`
ma `displaycountry="pl"`, `plan-extra.xml` ma `displaycountries="pl"`. Zachowanie importera
„przyjmij obie, obie zignoruj” jest więc pokryte testem niezależnie od tego, która jest prawdziwa,
i **nic się nie zmieni, gdy prawda wyjdzie na jaw**. To nie jest obejście braku wiedzy — dla
atrybutu, na którym nic nie zależy, to jest docelowe rozwiązanie. Odradzam rozgałęzianie logiki
po tym atrybucie w jakiejkolwiek postaci.

**Jak to naprawdę rozstrzygnąć:** jednym prawdziwym eksportem ze szkoły. To jest już pozycja 5
w `docs/research/2026-09-23-gemini-triage.md` §4 („One aSc XML and one Optivum HTML export from
a real school (nothing replaces this)”) — ta sama luka, nie nowa. Dopóki jej nie zamkniemy,
**żadnego zdania z §1 i §2 tego README nie wolno cytować jako specyfikacji aSc.**

---

## Trzy rzeczy, które autor importera musi wiedzieć

1. **Kodowanie i separator są częścią danych, nie detalem.** Trzy różne kodowania w pięciu plikach:
   windows-1250 (Optivum, nabór, UONET+, kadra), UTF-8 z BOM (bliźniak naboru), UTF-8 bez BOM
   (Librus, aSc), plus UTF-8 z BOM i CRLF w `plan-edge.xml`. Node 18 **nie dekoduje cp1250** bez
   własnej tablicy i bez npm-a. Wykrywanie: BOM → meta `charset` → domyślnie cp1250 dla plików z
   Optivum, UTF-8 dla XML. Każdy CSV czytaj prawdziwym parserem z obsługą cudzysłowów —
   `split(';')` psuje adnotację sądową w naborze i **każdy** wiersz w eksporcie UONET+.
2. **Jedno okienko planu to nie jedna lekcja.** Podziały na grupy (`divisiontag`, sufiksy `-1/2`),
   cykl dwutygodniowy (`weeks="10"` / `"01"`), religia równolegle z etyką, lekcje podwójne
   (`periodspercard="2"`, `rowspan="2"`), dwóch nauczycieli na jednej lekcji i lekcje bez sali są
   **normą, nie przypadkiem brzegowym**. Nasza tabela `timetable`
   (`classId, weekday, lessonNo, subjectId, teacherId, room, groupId`) nie ma pola tygodnia ani
   drugiego nauczyciela — to trzeba rozstrzygnąć przed pisaniem parsera, a `findConflicts()`
   nauczyć grup i tygodni, bo inaczej każdy prawdziwy plan zgłosi setki fałszywych konfliktów.
3. **Nic w tych plikach nie ma naszych identyfikatorów.** aSc ma `*17` (lokalne dla eksportu,
   zmienne przy każdym zapisie), Optivum nie ma nic poza skrótem `KE` i numerem sali `15`, rejestry
   mają PESEL (a trzech uczniów nie ma i jego). Każdy import musi być dwufazowy: **najpierw
   dopasowanie encji do przejrzenia przez człowieka (nauczyciel ↔ `users[].login`, oddział ↔
   `classes[].id`, sala ↔ tekst), potem zapis** — i `dryRun` w
   `POST /api/admin/timetable/import` jest na to właściwym miejscem.
