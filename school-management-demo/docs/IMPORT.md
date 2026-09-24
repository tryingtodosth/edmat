# Import planu lekcji

> **Nie widzieliśmy jeszcze ani jednego prawdziwego pliku ze szkoły.** Wszystko poniżej jest napisane
> pod kształt opisany w [`tests/fixtures/real-formats/README.md`](../tests/fixtures/real-formats/README.md),
> a ten README sam rozróżnia, co jest schematem, a co rekonstrukcją z pamięci. Pierwszy eksport
> z prawdziwej szkoły jest po to, żeby to potwierdzić albo obalić — i to jest Pytanie 4 z prezentacji.

Trasa: `POST /api/admin/timetable/import` (rola `admin`), opis formatów: `GET /api/admin/timetable/format`.
Ekran: **Administracja → Import planu lekcji**. Testy: `tests/51-timetable-import.test.js`,
`tests/35-registry.test.js` (stary CSV, import częściowy `merge`).

## 1. Skąd to się wzięło

Raport z 23.09.2026 ([triage](research/2026-09-23-gemini-triage.md), wiersz 1) mówi wprost: nasz CSV
(`class;weekday;lessonNo;subject;teacherLogin;room;group`) jest formatem **wymyślonym**. Szkoły mają
albo eksport XML z **aSc Timetables**, albo publikację HTML **„Plan lekcji Optivum”** (VULCAN).
Oba wchodzą teraz tą samą trasą; CSV i JSON zostają dla kreatora pierwszego uruchomienia i dla
poprawek ręcznych.

## 2. Cztery formaty

| `format` | Co to jest | Jak wysłać |
| --- | --- | --- |
| `csv` | nasz format wymiany; separator `;` albo `,`, cudzysłowy wg RFC 4180 | `data: "<tekst>"` |
| `json` | tablica obiektów o tych samych kluczach co CSV | `data: [ {...} ]` |
| `asc-xml` | *aSc Timetables → Eksport → XML* (warianty 2012 i 2008) | `dataBase64: "<base64 pliku>"` albo `data: "<tekst>"` |
| `optivum-html` | *Plan lekcji Optivum → Opublikuj plan → Zapisz stronę na dysku* | `files: { "plany/o1.html": "<base64>", … }` albo pojedyncze `dataBase64` |

`format` można pominąć — wtedy rozpoznajemy go z treści (`<timetable ascttversion=…>`,
`<table class="tabela">`, tablica JSON, reszta = CSV). Podanie nieznanej nazwy to `400`, nigdy ciche
zgadywanie.

### Kolumny CSV/JSON

```
class;weekday;lessonNo;subject;teacherLogin;room;group[;week;groupLabel]
7b;1;1;mat;j.nowak;12;
7b;2;1;inf;a.wojcik;30;;A;chłopcy
7b;2;1;inf;a.wojcik;30;;B;dziewczęta
```

`week` przyjmuje `A`, `B` albo pusto (co tydzień). `groupLabel` to wolny tekst używany wtedy, gdy
podziału nie ma jeszcze w kolekcji `groups`. Obie kolumny są opcjonalne — plik bez nich zachowuje
się dokładnie jak przed tą zmianą.

## 3. Dekodery bez npm-a

`server/lib/textdecode.js` — **Node 18 nie ma dekodera windows-1250** (`TextDecoder('windows-1250')`
wymaga pełnego ICU, którego nie gwarantujemy), a zasada zerowych zależności nie pozwala dołożyć
biblioteki. Stąd własna, 128-elementowa tablica bajtów `0x80–0xFF` → UTF-16.

Kolejność rozpoznawania kodowania:

1. **BOM** (`EF BB BF`, `FF FE`, `FE FF`) — ma pierwszeństwo przed wszystkim i jest usuwany z tekstu;
2. **deklaracja w treści** — `<?xml … encoding="…"?>` albo `<meta … charset=…>`;
3. **wartość domyślna wywołującego** — cp1250 dla plików Optivum, UTF-8 dla XML i CSV;
4. gdy bajty zadeklarowane jako UTF-8 nie tworzą poprawnego UTF-8 (a nic tego nie deklarowało),
   czytamy je jako windows-1250 i mówimy o tym w `warnings`.

`iso-8859-2` i `windows-1252` czytamy tablicą cp1250 i zgłaszamy w `warnings` — różnice nie dotyczą
polskich liter używanych w planie lekcji.

`server/lib/csv.js` — parser CSV z cudzysłowami: separator (`;` / `,`) wykrywany poza cudzysłowami
z pierwszego wiersza, CRLF, BOM, podwojony cudzysłów `""`, separator i przełamanie wiersza w środku
pola. `column(row, 'Opiekun 1 - nazwisko')` znajduje kolumnę mimo półpauzy w nagłówku (`–`), bo to
jest najczęstszy powód „importer nie widzi opiekunów”. `split(';')` rozbijał adnotację sądową
w naborze i **każdy** wiersz eksportu z UONET+.

## 4. Rozszerzony model pozycji planu (decyzja)

Kolekcja `timetable` miała siedem kolumn. Prawdziwy plan niesie więcej, więc doszły cztery pola
**opcjonalne**:

| pole | wartości | znaczenie |
| --- | --- | --- |
| `week` | `'A'` \| `'B'` \| brak | cykl dwutygodniowy; brak = co tydzień (stare zachowanie) |
| `teacherIds` | `[id, …]` | lekcja z nauczycielem wspomagającym; `teacherId` to zawsze `teacherIds[0]` |
| `groupLabel` | wolny tekst (`"1/2"`, `"chłopcy"`, `"Etyka"`) | podział, którego nie ma w kolekcji `groups` |
| `source` | `{ tool, ref, lessonId }` | z czego ten wiersz powstał |

**Migracja jest przy odczycie, nie przy zapisie.** `server/lib/timetable.js` → `normalize(t)` dokłada
brakujące pola (`week: null`, `teacherIds: [teacherId]`, `groupLabel: null`, `source: null`), więc plan
zapisany wcześniej zachowuje się identycznie i nie trzeba przepisywać pliku danych. Import zapisuje
nowe pola **tylko wtedy, gdy niosą treść** — wiersz z CSV wygląda na dysku dokładnie jak przedtem.

Identyfikator pozycji: `tt_<oddział>_<dzień>_<nr>[_<grupa>][_w<A|B>]`. Bez tygodnia i bez etykiety
grupy wychodzi dokładnie stary kształt, więc już wygenerowane lekcje (`les_<pozycja>_<data>`)
zachowują swoje identyfikatory.

### Konflikty

`findConflicts()` porównuje **pary** wierszy w tym samym `(weekday, lessonNo)`:

* tygodnie nachodzą na siebie, gdy któryś jest pusty albo oba są takie same (`A` i `B` = brak kolizji);
* grupy nachodzą na siebie, gdy któraś pozycja dotyczy **całego oddziału**, albo obie mają ten sam
  `groupId`/`groupLabel`; dwie różne grupy są rozłączne;
* **nauczyciel** — kolizja liczona dla każdego z `teacherIds`; wyjątki jak dotąd: lekcja łączona
  (ta sama sala i przedmiot) i podział jednego oddziału na grupy;
* **sala** — kolizja, chyba że to ten sam nauczyciel i ten sam przedmiot;
* **oddział** — kolizja, gdy tygodnie i grupy nachodzą na siebie.

Efekt na `asc/plan-sp12.xml` (272 pozycje, 8 oddziałów): **zero konfliktów**. Przed tą zmianą byłyby
ich setki — wyłącznie fałszywych.

**Znane uproszczenie.** aSc oznacza podziały atrybutem `divisiontag`: grupy o tym samym `divisiontag`
wykluczają się nawzajem, grupy o różnych — niekoniecznie (chłopcy z podziału WF-owego i „1. grupa”
z podziału językowego to częściowo ci sami uczniowie). My porównujemy same etykiety, więc traktujemy
**każde dwie różne grupy jako rozłączne**. To jest bezpieczne dla importu (nie blokuje planu, który
układacz uznał za poprawny) i niebezpieczne dla ręcznej edycji — dlatego prawdziwe pokrycie grup
uczniami zostaje w kolekcji `groups`, a nie w etykietach.

### Cykl A/B i kotwica

Tydzień dnia liczymy od **kotwicy**: `config.weekCycleAnchor` (data `RRRR-MM-DD`), a domyślnie
**poniedziałek tygodnia, w którym zaczyna się pierwszy semestr** (`config.semesters[0].from`).
Tydzień kotwicy to zawsze **A**; dalej na przemian. Szkoła, która zaczęła rok od tygodnia II,
przestawia jedną wartość w konfiguracji zamiast poprawiać cały plan.

`generateLessons()` (`server/routes/setup.js`) pomija pozycję, której `week` nie zgadza się
z tygodniem danego dnia, i tworzy **jedną lekcję na wiersz planu**, czyli jedną na grupę. Lekcja
dostaje `week` i `groupLabel`, gdy pozycja je ma. Dla planu bez tygodni liczba wygenerowanych lekcji
jest bit w bit ta sama co przed zmianą (test „zasiew demo bez zmian”).

## 4a. Numer lekcji i „godzina 0”

Numer lekcji jest poprawny wtedy, gdy **w `config.lessonTimes` istnieje dzwonek o tym `no`** —
`lessonTimes.some((t) => t.no === no)`. Nie jest to zakres `1…długość tablicy`: ta reguła odrzucała
godzinę 0 przy każdej konfiguracji, a po dopisaniu `{ no: 0 }` do ośmioelementowej listy
przepuszczała numer 9, którego nie ma.

**Jak szkoła dodaje godzinę 0.** Na ekranie administracji, w karcie „Struktura roku szkolnego”,
sekcja **„Plan dzwonków”** — przycisk „Dodaj godzinę 0 (7:10)”. Trasą jest `PATCH /api/admin/year`
z polem `lessonTimes` (`GET /api/admin/year` zwraca je razem z semestrami i przerwami):

```jsonc
PATCH /api/admin/year
{ "lessonTimes": [
    { "no": 0, "start": "07:10", "end": "07:55" },
    { "no": 1, "start": "08:00", "end": "08:45" }
    // … bez przenumerowywania pozostałych
] }
```

Walidacja (`server/lib/timetable.js validateLessonTimes`): numer całkowity 0–19 i **unikalny**,
godziny `GG:MM`, początek przed końcem, pozycje **nie mogą na siebie nachodzić**; odpowiedź jest
posortowana po numerze niezależnie od kolejności wysyłki. Błędy wracają jako `400 year_invalid`
z listą zdań po polsku, tak samo jak błędy semestrów i przerw. Numery już zapisanych pozycji planu
nie ruszają się — zmiana dzwonków nie przenumerowuje niczego.

Tą samą trasą ustawia się **kotwicę cyklu A/B** (`weekCycleAnchor`): pusta wartość znaczy „pierwszy
poniedziałek roku szkolnego”, a szkoła zaczynająca rok od tygodnia II wpisuje tam jedną datę.

Do września 2026 r. tej trasy nie było wcale: komunikat importu odsyłał do „ustawień szkoły”, a
jedyną drogą było ręczne przepisanie `data/school/config.json` (OPS3-03).

Przenumerowanie dzwonków (0→1, 1→2, …) jest **złym pomysłem**: psuje wszystkie wydrukowane plany,
wszystkie istniejące wiersze `timetable` i identyfikatory już wygenerowanych lekcji.

**Co robi import, gdy plik ma godzinę 0, a szkoła jej nie ma.** Wiersz nie wchodzi, a błąd nazywa
rzecz po imieniu i podpowiada rozwiązanie:

> Wiersz 4: numer lekcji „0” nie ma odpowiednika w planie dzwonków (są: 1, 2, 3, 4, 5, 6, 7, 8).
> Plik ma „godzinę 0” (zwykle 7:10) — dopisz ją do planu dzwonków: PATCH /api/admin/year z polem
> lessonTimes (karta „Struktura roku szkolnego” → „Plan dzwonków”, przycisk „Dodaj godzinę 0”),
> a potem wgraj plan jeszcze raz.

Reszta pliku wchodzi normalnie: `dryRun` pokazuje, ile wierszy odpadło i dlaczego, i nic nie zapisuje.

## 5. Import dwufazowy

W plikach ze szkoły **nie ma naszych identyfikatorów**: aSc ma `*17` (lokalne dla eksportu, zmienne
przy każdym zapisie), Optivum nie ma nic poza skrótem `KE` i numerem sali `15`. Dlatego import jest
dwufazowy.

### Faza 1 — `dryRun: true`

Odpowiedź niesie, obok dotychczasowego raportu (`rows`, `errors`, `conflicts`, `lessonImpact`,
`classes`, `replacing`, `merge`), także:

```jsonc
{
  "format": "asc-xml",
  "warnings": ["Plik niesie 1 definicję okresu (<termsdefs>) — import je pomija…"],
  "weeks":   { "every": 264, "A": 4, "B": 4 },
  "groupLabels": ["1. grupa", "2. grupa", "Chłopcy", "Dziewczęta", "Etyka", "Religia"],
  "rowsPerClass": { "7a": 43, "7b": 43 },
  "multiTeacher": 4, "roomless": 12,
  "unmatched": { "teachers": ["ŻM"], "classes": ["8A"], "subjects": ["Etyka"], "rooms": [], "groups": [] },
  "mapping":   { "teachers": { "NJ": "u_nowak" }, "classes": {…}, "subjects": {…}, "rooms": { "12": "12", "3": null }, "groups": {…} },
  "proposal": {
    "tool": "asc", "ref": "…",
    "teachers": [{ "key": "NJ", "short": "NJ", "name": "Joanna Nowak",
                   "matched": "u_nowak", "matchedLabel": "mgr Joanna Nowak",
                   "how": "short", "candidates": [], "rows": 20 }],
    "groups":   [{ "key": "7B|1. grupa", "label": "1. grupa", "classKey": "7B", "classId": "7b",
                   "matched": null, "how": "unmatched", "rows": 6 }],
    "options":  { "teachers": [{ "id": "u_nowak", "label": "mgr Joanna Nowak" }], … },
    "blocking": [{ "kind": "teachers", "key": "ŻM" }],
    "exactMatches": { "teachers": 10, "classes": 5, "subjects": 13, "rooms": 9, "groups": 0 },
    "creates":  { "subjects": 0, "classes": 0, "groups": 32 }
  }
}
```

**Piąty rodzaj dopasowania: `groups` (podziały na grupy).** Plan z aSc i publikacja Optivum niosą
podział jako **etykietę przy lekcji** („1. grupa”, „Chłopcy”, „Religia”), a nie jako listę uczniów.
Do września 2026 r. etykieta jechała do wiersza planu jako `groupLabel`, `groupId` zostawał `null`,
a `rosterIds()` (`server/routes/attendance.js`) klucza **wyłącznie po `groupId`** — więc
nauczycielka angielskiego otwierała lekcję swojej grupy i widziała cały oddział. Przy 24 oddziałach
to jest mniej więcej piąta część ustawowej frekwencji, błędna od pierwszego dnia (OPS3-02).

Etykieta jest lokalna dla oddziału (każda klasa ma swoją „1. grupę”), więc **kluczem dopasowania jest
`oddział-z-pliku|etykieta`**, np. `7B|1. grupa`. Dla każdej takiej pary są trzy odpowiedzi:

| wartość w `mapping.groups` | co się dzieje |
| --- | --- |
| identyfikator naszej grupy | wiersze tej etykiety dostają `groupId`; skład grupy zostaje ten, który ma |
| `"@new"` | grupa **powstaje przy zapisie planu** (nie przy próbie) i wiersze dostają jej `groupId` |
| `null` albo brak klucza | zostaje sama etykieta, dokładnie jak przed zmianą — podział **nigdy nie blokuje importu** |

Skład grupy zakładanej przez `"@new"`: plik nie mówi, kto jest w której połowie, więc listę oddziału
(wg numerów w dzienniku) rozdajemy po kolei między wszystkie etykiety tego samego oddziału **i tego
samego przedmiotu** — dwie etykiety dają dwie połowy. To jest **propozycja**: import zwraca po jednym
ostrzeżeniu na grupę, a raport mówi wprost, żeby sprawdzić skład w „Grupach w oddziale”
(`GET/PATCH /api/admin/groups`), zanim nauczyciel sprawdzi obecność. Pojedyncza etykieta bez pary
(np. „Religia”) dostaje cały oddział — i też o tym mówi.

**„Załóż u nas” (`"@new"`) działa także dla `subjects` i `classes`** (OPS3-04, OPS3-14): plik
zatrzymujący się na `Etyka` albo na `4A` nie wymaga już wychodzenia z importu. Wszystko, co ma
powstać, leży w `proposal.pending` i wchodzi do bazy **dopiero przy zapisie planu, po wszystkich
kontrolach** — próba nie zakłada niczego. Odpowiedź zapisu niesie `created: { subjects, classes,
groups }`, a założone dokumenty należą do tej samej partii importu, więc cofnięcie zabiera je razem
z planem.

Jak dopasowujemy (`how`):

| `how` | znaczenie |
| --- | --- |
| `short` | skrót z pliku = skrót u nas. Nasze konta nie mają pola `short`, więc wyprowadzamy je jak aSc i Optivum: **pierwsza litera nazwiska + pierwsza litera imienia** (`Nowak Joanna` → `NJ`). Oddział i przedmiot dopasowujemy też po identyfikatorze (`7A` → `7a`, `w-f` → `wf`). |
| `name` | pełna nazwa (bez wielkości liter i diakrytyków): `Beata Sikora`, `Matematyka` |
| `key` | klucz encji z pliku, gdy nie ma osobnego skrótu ani nazwy |
| `fuzzy` | po tokenach: każdy token obcej nazwy jest przedrostkiem odpowiadającego naszego i choć jeden ma ≥ 4 litery (`j.polski` ↔ `Język polski`). Same cyfry nie idą tą ścieżką — inaczej sala „3” wskoczyłaby na „30”. |
| `ambiguous` | pasuje więcej niż jeden wpis; decyduje człowiek. Niejednoznaczność na jednym poziomie nie kończy szukania — skrót `SB` pasuje do dwóch kont, ale imię i nazwisko z pliku rozstrzyga. |
| `unmatched` | brak odpowiednika |
| `mapping` / `skipped` | rozstrzygnięte ręcznie w `mapping` (wartość, albo `null` = pomiń) |
| `create` | wybrano „załóż u nas” (`"@new"`); dokument powstanie przy zapisie planu |
| `verbatim` | tylko sale: `null` w `mapping.rooms` = „wpisz do planu tekst z pliku” |

**Kandydaci na nauczyciela.** Lekcję może prowadzić tylko konto, które może ją ocenić (`teacher`,
`principal`, `supportTeacher`). Wcześniej kandydatem było każde konto poza uczniem i rodzicem, więc
mapowanie potrafiło wpisać do dziennika bibliotekarkę albo inspektora ochrony danych jako
nauczyciela matematyki — a `teachersOfStudent()` otwiera takiej osobie graf korespondencji (S3-18).

### Faza 2 — właściwy import

Klient odsyła poprawiony `mapping` razem z plikiem:

```jsonc
{ "format": "asc-xml", "dataBase64": "…", "dryRun": false, "force": true,
  "mapping": { "teachers": { "KE": "u_krol", "ŻM": null }, "classes": { "8A": null }, "subjects": {}, "rooms": {} } }
```

* wartość = nasz identyfikator; `null` albo `""` = **pomiń wiersze tej encji**; `"@new"` = załóż
  (tylko `subjects`, `classes`, `groups`);
* encja bez dopasowania i bez decyzji → `400 { code: 'unmatched_entities', unmatched, blocking, mapping }`
  i **żadnego zapisu częściowego**;
* **encji bez dopasowania nie ma w `mapping`** — klucza po prostu brak. To jest różnica między
  „klient odesłał, co dostał” a „człowiek zdecydował”. Wcześniej `buildProposal` wstawiał tam `null`,
  a `null` znaczy „pomiń”: klient, który odsyłał `report.mapping` bez zmian — dokładnie tak, jak każe
  ten rozdział i jak robi ekran administracji — zamieniał `400 „uzupełnij mapowanie”` w cichy zapis
  planu bez tych lekcji, z `ok: true` (D3-51/OPS3-12);
* **sale nigdy nie blokują** — to wolny tekst. Każda sala **ma** klucz w `mapping.rooms`: wartość =
  nasza sala, `null` = „wpisz tekst z pliku”, `""` = „wyczyść numer sali”. Odesłanie mapowania z próby
  bez zmian zachowuje więc wszystkie sale co do wiersza — wcześniej kasowało je wszystkie naraz
  (mierzone: 254 wiersze, 14 sal w próbie → 0 sal po zapisie), a komunikat mówił o tym tylko liczbą;
* `merge`, `force`, `applyToLessons`, `reason` i wpis do rejestru audytowego działają jak dotąd.
  Wpis audytowy niesie dodatkowo `format`, `weeks`, `source`, `importId` i `created`.

### Cofanie importu planu

Import planu jest **partią** (`kind: 'timetable'`) w kolekcji `imports`, tak samo jak import kadry
i uczniów. Partia powstaje i trafia na dysk **zanim** zmieni się choć jeden wiersz planu (R3-08) i
niesie cały poprzedni plan, więc `POST /api/setup/imports/:id/undo`:

* odtwarza poprzedni plan **co do wiersza**,
* usuwa grupy, przedmioty i oddziały założone tym importem — o ile nic ich nie używa,
* uzgadnia dziennik (`syncLessons`): lekcja z wpisami zostaje **odwołana**, nigdy skasowana,
* odmawia (`409 import_in_use`), jeżeli w lekcjach dołożonych przez ten import ktoś już coś zapisał.

`GET /api/setup/imports` pokazuje partię z `kind`, `status` (`running` / `done`) i
`timetableRestores` (ile wierszy wróci); samego ładunku nie wysyła. Partia, która została
`running` po restarcie, jest widoczna i daje się cofnąć — wcześniej `recordImport` szedł **po**
pętli wierszy, a `breathe()` co 50 wierszy pozwala zadziałać zrzutowi na dysk w jej środku, więc
`kill -9` zostawiał 100 uczniów i 200 kont bez partii i bez wpisu audytowego.

### Poprawka jednej pozycji planu

`PATCH /api/admin/timetable/rows/:id` (administrator, audytowane) zmienia w jednym wierszu planu
`subjectId`, `teacherId`/`teacherIds`, `room`, `week`, `groupId` i `groupLabel`. Identyfikator
pozycji niesie oddział, dzień, numer, podział i tydzień, więc zmiana podziału zmienia też
identyfikator — wtedy przenosimy razem z nim już wygenerowane lekcje i ich wpisy (frekwencja, oceny,
zadania, zastępstwa), a odpowiedź podaje `renamedFrom`. Na koniec wołamy `syncLessons`, tak jak po
imporcie. Bez tej trasy jedynym pisarzem kolekcji `timetable` był import całego pliku.

## 6. Co robi importer aSc

Parser XML jest własny (`server/lib/import-asc.js`) — mały tokenizer ze stanem, nie wyrażenie
regularne: atrybuty potrafią zawierać `>` i encje (`&amp;`, `&#261;`), tagi bywają samozamykające,
plik bywa z BOM-em i z CRLF-ami. **Nieznane elementy i atrybuty pomijamy po cichu**, bo zestaw
kolekcji zależy od wersji aSc i od licencji.

* `periods` → numer lekcji **z atrybutu `period`**, nie z pozycji na liście (w prawdziwych planach
  istnieje lekcja „0” — patrz §4a);
* `daysdefs` / `days` → maska bitowa dnia (`"10000"` = poniedziałek; lista masek po przecinku = kilka dni);
* `weeksdefs` / `weeks` → `"11"` = co tydzień (`null`), `"10"` = A, `"01"` = B, `"10,01"` = obie osobno;
* `classes` + `groups` → oddział i etykieta podziału; `entireclass="1"` znaczy „cały oddział”
  (bez etykiety), a `divisiontag` czytamy tylko informacyjnie;
* `lessons` × `cards` → wiersze planu. `periodspercard="2"` (2008: `durationperiods`) rozwijamy na
  dwie kolejne godziny; `teacherids` to **lista** (dwóch nauczycieli); `classids` też jest listą —
  zajęcia międzyoddziałowe (`seminargroup="2"`) dają wiersz na każdy oddział; `classroomids` z karty
  ma pierwszeństwo przed listą z lekcji, a pusta lista jest normalna (etyka bez sali);
* `termsdefs` **ignorujemy** — nasz plan nie zna podziału roku na okresy inne niż semestry; jest o tym
  wpis w `warnings`;
* `displaycountry` i `displaycountries` — przyjmujemy obie pisownie i obie ignorujemy (README fixture'ów
  nie rozstrzyga, która jest prawdziwa).

Tolerancja: nieistniejące id sali/lekcji/nauczyciela/przedmiotu → wpis w `warnings`, nie wyjątek;
zdublowana karta (ta sama lekcja, dzień, godzina, tydzień) → scalona i policzona; pusty `short`
nauczyciela → kluczem staje się imię i nazwisko.

**Wariant 2008** (`ascttversion="2008"`): brak `daysdefs`/`weeksdefs`/`groups`, `day="1".."5"` zamiast
maski, `durationperiods` zamiast `periodspercard`, pojedyncze `classroomid`, podział jako `group="1"`
na lekcji, nauczyciel z jednym polem `name`. Wszystko to obsługujemy, ale README fixture'ów oznacza
ten kształt jako **rekonstrukcję o niskiej pewności** — potwierdzić prawdziwym plikiem.

## 7. Co robi importer Optivum

`server/lib/import-optivum.js` buduje z HTML-a małe drzewo (ten sam tokenizer + domykanie `<p>`,
`<td>`, `<tr>` i lista elementów pustych), a potem czyta `<table class="tabela">`.

* **każdy plik dekodujemy osobno** — starsze buildy piszą windows-1250, nowsze UTF-8, a w jednym
  katalogu potrafią być oba;
* kolumny `Nr`, `Godz`, potem dni tygodnia z nagłówka (`Poniedziałek`…`Piątek`);
* komórka: `span.p` = przedmiot, `a.n` = skrót nauczyciela, `a.o` = oddział (na stronie nauczyciela
  i sali), `a.s` = sala; kilka lekcji w komórce rozdziela `<br>`;
* sufiks `-1/2` / `-2/2` → `groupLabel`; stoi przy **przedmiocie** na stronie oddziału i przy
  **oddziale** na stronie nauczyciela i sali;
* `rowspan="2"` = lekcja podwójna. Prowadzimy licznik zajętych wierszy **per kolumna**, bo kolejny
  wiersz ma wtedy mniej `<td>` niż dni tygodnia i parser liczący komórki po pozycji rozjeżdża się na
  całej reszcie tabeli;
* pusta godzina to `<td class="l">&nbsp;</td>`, cała pusta kolumna dnia jest legalna;
* `lista.html` daje imiona i nazwiska do skrótów (`Nowak Joanna (NJ)`) i nazwy sal; bez niej zostaje
  sam skrót i mówi o tym `warnings`;
* wiersz `Wychowawca: …` ze strony oddziału trafia do `homerooms` — jako podpowiedź, nie jako prawda
  (nie wszystkie szkoły go publikują);
* **kontrola krzyżowa**: strony nauczycieli porównujemy ze stronami oddziałów i raportujemy
  rozbieżności (`crossMismatch`); plan oddziału ma pierwszeństwo. Oddziały, dla których nie ma strony
  `o*.html`, odtwarzamy ze stron nauczycieli i sal.

Publikacja Optivum **nie ma własnego wymiaru tygodnia ani drugiego nauczyciela**. Drugi nauczyciel
przepada bezpowrotnie; cykl dwutygodniowy szkoły obchodzą, i tę obejściową formę czytamy
**heurystycznie**:

* obie lekcje siedzą w jednej komórce, rozdzielone `<br>`, a tydzień jest doklejony do nazwy
  przedmiotu (`informatyka-T1`, `fizyka-T2`), z legendą w `<p class="opis">` **pod** tabelą
  (parser kończący na `</table>` jej nie zobaczy);
* `-N/M` to **zawsze** podział na grupy i nigdy tydzień; `-T1`, `-T2`, `-I`, `-II`, `-tyg.A`,
  `-tyg.B`, `-A`, `-B` uznajemy za tydzień **tylko w kontekście** (kilka lekcji w jednej komórce
  albo legenda pod tabelą); każdy inny sufiks zostaje etykietą podziału;
* markery nie są ustandaryzowane — to tekst wpisany przez planistę — więc wynik **zawsze** idzie do
  `warnings` (z markerem, przypisanym tygodniem, liczbą pozycji i treścią legendy) oraz do
  `report.weekMarkers`, i widać go w karcie importu przed zapisem. Nigdy nie jest to cichy zapis.

Kształtu, w którym szkoła publikuje **dwa osobne drzewa** (`tydzienI/`, `tydzienII/`), jeszcze nie
obsługujemy — prośba o fixture jest w `REQUESTS.md`.

### Kontrola krzyżowa i kilka publikacji naraz

Strony nauczycieli porównujemy ze stronami oddziałów po **nauczycielu i przedmiocie** (samo
dopasowanie po nauczycielu myliłoby lekcję tygodnia I z lekcją tygodnia II w tej samej komórce).
Każda różnica wraca w `crossMismatch` z `kind: 'room' | 'teacher'`, ze slotem i z obiema wersjami
(`onClassPage`, `onTeacherPage`), oraz w `warnings`. **Plan bierzemy ze stron oddziałów**, bo one
i strony sal są zwykle zgodne — ale to jest reguła produktowa, nie fakt o formacie, więc importer
mówi o rozbieżności i nie rozstrzyga jej za człowieka.

Wgrany katalog potrafi zawierać **kilka publikacji obok siebie** (archiwum poprzednich lat, kopia
w innym kodowaniu). Publikacja = katalog nadrzędny nad `plany/`. Bierzemy tę z największą liczbą
stron oddziałów, a pozostałe wymieniamy w `warnings` — scalenie ich dałoby jeden plan złożony
z kilku różnych.

## 8. Co w fixture'ach jest odtworzone, a nie potwierdzone

Pełna lista: [`tests/fixtures/real-formats/README.md`](../tests/fixtures/real-formats/README.md).
Rzeczy, które wprost wpływają na ten importer:

* `displaycountry` vs `displaycountries` — **nieznane**: nie ma źródła, które by to rozstrzygało.
  W korpusie są obie pisownie (`plan-sp12.xml` / `plan-extra.xml`); importer przyjmuje obie i obie
  ignoruje, i nie wolno rozgałęziać po tym atrybucie logiki. Zawartość `options` w korzeniu aSc —
  **rekonstrukcja**;
* `optivum/ab/` (markery tygodnia w publikacji HTML) — **rekonstrukcja słabsza niż reszta**: to
  odtworzenie obejścia szkół, a nie funkcji programu. Stąd heurystyka i ostrzeżenie zamiast reguły;
* `optivum/edge2/` (dwie celowe rozbieżności oddział ↔ nauczyciel) — kształt błędu jest realny
  (planista poprawił plan i opublikował część stron ze starego stanu), same dane są wymyślone;
* cały `asc/plan-old-2008.xml` — **rekonstrukcja o niskiej pewności**;
* dokładne znaczniki `tytulnapis` / `opis`, stopka i sposób numerowania stron w Optivum — **rekonstrukcja**;
* nazwy kolumn we wszystkich plikach z `register/` — **rekonstrukcja** (kształt jest prawdziwy,
  brzmienie nagłówków nie);
* `archive/dziennik-2025-2026-sample.xml` jest **ilustracyjny** i nie jest schematem żadnego producenta.

Pewne (potwierdzone kształtem prawdziwych plików): układ kolekcji aSc i znaczenie masek `days`/`weeks`,
drzewo `index.html` + `lista.html` + `plany/o*|n*|s*.html`, windows-1250 w starszych buildach Optivum
i bajty polskich liter w cp1250 (`ł` = `0xB3`, `ą` = `0xB9`, `Ś` = `0x8C`).

**Czego nam brakuje:** jednego prawdziwego eksportu z aSc i jednej prawdziwej publikacji Optivum.
Braki i wątpliwości dopisujemy do [`tests/fixtures/real-formats/REQUESTS.md`](../tests/fixtures/real-formats/REQUESTS.md).

## 8a. Droga kreatora (pierwsze uruchomienie)

Kreator (`/setup`) wstawia w kroku „Plan lekcji” **tę samą kartę**, co ekran administracji
(`A.AdminCards.ImportPlanu`): pliki, katalogi, cztery formaty, tabela dopasowania i przebieg próbny.
Wcześniej krok 4 wysyłał `{ csv }` z pola tekstowego z `force: true`, a jego podpowiedź obiecywała
„ten sam format co aSc/Vulcan”, co było nieprawdą — żaden z prawdziwych formatów nie był w kreatorze
osiągalny (OPS3-11).

Dwa kroki przed nim — kadra i uczniowie — czytają pliki, które szkoła naprawdę ma:

* **`POST /api/setup/teachers/import`** przyjmuje nagłówki arkusza organizacyjnego
  (`Nazwisko`, `Imię`, `Skrót`, `Stopień awansu zawodowego`, `Przedmioty`, `Wychowawstwo`, `E-mail`)
  obok naszych własnych. Przedmioty wolno podać nazwami po przecinku („Matematyka, Fizyka”), nie
  tylko identyfikatorami; `Wychowawstwo` pisane „7 B” staje się oddziałem `7b`; `Skrót` zapisujemy
  przy koncie, bo to **ten sam klucz**, którym posługują się aSc i Optivum — plan wgrany później
  dopasowuje się wtedy dokładnie.
* **`POST /api/setup/students/import`** używa tabeli aliasów rejestru (`server/lib/identity.js`)
  poszerzonej o `Opiekun 1/2 – nazwisko/imię/telefon/e-mail`, `Płeć`, `Uwagi` i `Data przyjęcia`.
  Wchodzą **oboje opiekunowie** (każdy dostaje konto kontaktowe i własny kod rejestracyjny),
  `sex` bierzemy z kolumny albo z numeru PESEL, a `Uwagi` zostają przy uczniu jako `note` —
  program nic z nimi nie robi i mówi wprost, że trzeba je przeczytać.

Gdy w nagłówku brakuje kolumny wymaganej, obie trasy zwracają **jeden błąd o nagłówku** zamiast
jednego błędu na wiersz: z listą kolumn, które plik ma, i z przyjmowanymi nazwami tej, której brak
(`code: 'header_missing'`). Odpowiedź zawsze niesie `columns` i `unknownColumns` — kreator pokazuje
je pod wynikiem próby. Wcześniej prawdziwy plik szkoły odrzucał 100 % wierszy komunikatem
„Brak imienia lub nazwiska.”, powtórzonym sześćdziesiąt razy (OPS3-05).

**Numer księgi uczniów** ma jedną podłogę dla całej szkoły: `nextRegisterNo(db)`
(`server/routes/setup.js`, używane także przez sekretariat) — kolejny wolny numer, nie niżej niż
`config.registerNoStart` (domyślnie 1). Wcześniej kreator zaczynał od 1000, a sekretariat od 1200,
więc pierwszy uczeń przyjęty po kreatorze dostawał 1201 przy roczniku kończącym się na 1060.

**Generowanie lekcji.** `POST /api/setup/lessons/generate` bez `from` zaczyna od **późniejszej**
z dwóch dat: początku roku szkolnego albo dziś. Szkoła przechodząca na EdMat 23 września dostawała
wcześniej 805 lekcji z datami 1–22 września, wszystkie ze statusem „odbyła się”, bez tematu i bez
frekwencji — i audyt kompletności dyrektora zarzucał 17 nauczycielom 250 braków za tydzień, w którym
dziennik prowadziła jeszcze inna książka (OPS3-08). Odpowiedź niesie `from`, `defaultFrom`,
`skippedBeforeToday` i zdanie o tym w `message`; kreator ma pole „Generuj lekcje od dnia”.

## 9. Ograniczenia, o których warto wiedzieć

1. **Zajęcia międzyoddziałowe** (jedna lekcja aSc z dwoma `classids`, `seminargroup="2"`) rozpisujemy
   na osobny wiersz dla każdego oddziału — z tą samą salą, nauczycielem i godziną. Bez tego w planie
   drugiego oddziału zabrakłoby zajęć, a kontrola kolizji zobaczyłaby „nauczyciela w dwóch miejscach”
   tam, gdzie jest jedna lekcja. Nic ich potem nie łączy z powrotem w jedną pozycję dziennika.
   Przykład: `asc/plan-extra.xml` (religia 7a+7b, WF 7b+8a).
2. **Skład grupy z pliku jest zgadywany.** Import potrafi założyć grupę z etykiety (`"@new"`
   w `mapping.groups`, § 5) i związać z nią wiersze planu, ale **kto jest w której grupie, w pliku
   nie stoi**: rozdajemy listę oddziału po kolei wg numerów w dzienniku. To jest propozycja do
   poprawienia w „Grupach w oddziale” (`PATCH /api/admin/groups/:id`) albo
   w `POST /api/admin/classes/:id/split`; import mówi o tym ostrzeżeniem przy każdej grupie.
   Etykieta, której człowiek nie rozstrzygnął, zostaje samym `groupLabel` — i wtedy frekwencja
   obejmuje cały oddział, jak przedtem.
3. **Sale to wolny tekst.** Nie mamy kolekcji sal; dopasowanie idzie po już używanych etykietach.
4. **Cykl A/B z aSc wprost, z Optivum tylko heurystycznie** (markery przy nazwie przedmiotu, zawsze
   z ostrzeżeniem). CSV bez kolumny `week` daje plan „co tydzień”.
5. **Duplikaty identyfikatorów.** Dwie pozycje o tym samym `(oddział, dzień, godzina, grupa, tydzień)`
   to konflikt; `force: true` je zapisze, ale wygeneruje z nich jedną lekcję.
6. Parser XML nie sprawdza poprawności dokumentu (brak walidacji, brak przestrzeni nazw) — czyta to,
   co rozumie, i milczy o reszcie. To jest wybór: eksport aSc zależy od wersji i od licencji.
