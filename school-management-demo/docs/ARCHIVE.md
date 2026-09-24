# Roczny pakiet archiwalny — co szkoła podpisuje i co dziennik potrafi sprawdzić

> Kod: `server/lib/archive.js`, `server/lib/blobs.js`, sekcja archiwum w
> `server/routes/principal.js`, karta „Archiwum roczne” w `public/app/screens/principal.js`,
> kopia zapasowa `scripts/backup.js`, testy `tests/52-archive.test.js`.

§ 22 rozporządzenia o dokumentacji przebiegu nauczania każe **w ciągu 10 dni od zakończenia roku
szkolnego** zapisać dane dziennika na informatycznym nośniku danych i **podpisać** je. Raport z
23 września 2026 podaje trzy dopuszczone formy: podpis kwalifikowany, pieczęć kwalifikowaną albo
podpis osobisty (e-Dowód) — i tu jest [otwarte pytanie prawne](#otwarte-pytanie-podpis-zaufany).

Żadnej z tych form dziennik nie złoży za szkołę i nie udaje, że umie. Dyrektor podpisuje
**na zewnątrz** (gov.pl, e-Dowód, aplikacja dostawcy kwalifikowanego), a rola dziennika kończy się
na dwóch rzeczach:

1. wydać **jeden plik**, który da się zabrać na nośnik i podpisać;
2. przyjąć z powrotem plik podpisu, policzyć, co da się policzyć, i **nazwać to uczciwie**.

**To nie jest kwalifikowana usługa zaufania.** Dziennik nie wystawia pieczęci, nie weryfikuje
łańcuchów certyfikatów, nie sprawdza statusu odwołania ani znaczników czasu i nie jest w stanie
orzec, że podpis jest ważny.

## Zawartość pakietu

`GET /api/principal/archive/:id/package` oddaje jeden plik ZIP
(`dziennik-2026-2027-archiwum.zip`, `Content-Type: application/zip`):

| plik | co to jest |
| --- | --- |
| `dziennik-<rok>.xml` | eksport § 21 — **cały dziennik rocznika**, ten sam bajt w bajt, co `GET …/xml` |
| `dziennik-<rok>.html` | wydruk pakietu — ten sam, co `GET …/print` (do wydrukowania na PDF) |
| `manifest.json` | szkoła (nazwa, RSPO, REGON, adres), rok, czas wygenerowania, strefa czasowa, lista plików z SHA-256 i rozmiarem w bajtach, liczności wszystkich kolekcji magazynu, wersja oprogramowania i Node |
| `manifest.sha256` | jedna linia w formacie `sha256sum`: `<skrót>  manifest.json` — **to jest plik, który dyrektor podpisuje** |
| `seal.json` | pieczęć kluczem szkoły (RSA-SHA256) nad `manifest.json` — dowód spójności, **nie** podpis z § 22 |

XML jest **jeden na cały rocznik**, a nie jeden na oddział: oddziały siedzą w nim jako `<Klasa>`.
Rozbicie na pliki per oddział zmieniłoby korzeń dokumentu i kształt eksportu, na którym opiera się
reszta systemu (`GET …/xml`, test `[3.3.17]`), a nic nie daje — podpisywany jest i tak manifest.

### Co musi być w dzienniku, a co jest w pakiecie

Rozporządzenie o dokumentacji przebiegu nauczania mówi, co dziennik lekcyjny zawiera. Do 23.09.2026
XML miał jedenaście rodzajów elementów i **ani jednej lekcji** — pakiet, który dyrektor podpisywał,
nie pozwalał odtworzyć dziennika (przegląd R3, D3-19). Dziś kolumna „element” jest pełna:

| czego wymaga dokumentacja | element w `dziennik-<rok>.xml` |
| --- | --- |
| przebieg zajęć: data, numer lekcji, przedmiot, nauczyciel, temat | `<Lekcja data nrLekcji przedmiot nauczyciel zastepstwo sala status grupa>` + `<Temat>` |
| obecność **każdego ucznia na każdej lekcji** | `<Lekcja>/<Frekwencja>/<Obecnosc uczen status spoznienieMin usprawiedliwienie>` |
| oceny bieżące: kategoria, waga, data, nauczyciel | `<Ocena przedmiot rodzaj semestr data waga kategoria nauczyciel liczonaDoSredniej>` |
| oceny śródroczne i roczne | te same `<Ocena>` z `rodzaj="midterm"`/`"final"` (i `proposedMid`/`proposedFinal` dla propozycji) |
| oceny opisowe (klasy I–III) | `<OcenyOpisowe>/<OcenaOpisowa semestr obszar nauczyciel data>` |
| ocena zachowania | `<Zachowanie>/<OcenaZachowania semestr rodzaj punkty wystawil data>` |
| uwagi | `<Uwagi>/<Uwaga data rodzaj punkty nauczyciel>` |
| usprawiedliwienia nieobecności | `<Usprawiedliwienia>/<Usprawiedliwienie od do godziny status zgloszone przyjal>` |
| notatki wychowawcy (jeśli są) | `<NotatkiWychowawcy>/<Notatka data rodzaj autor>` |
| dane świadectwa tak, jak wydrukowane | `<Swiadectwa>/<Swiadectwo rok klasa szkola zachowanie zrodlo>` + `<OcenaSwiadectwa przedmiot>` |
| dane z księgi uczniów | `<Uczen nrWDzienniku nrKsiegi>`, `<Imie>`, `<Nazwisko>`, `<Pesel>`, `<DokumentTozsamosci>`, `<DaneOsobowe dataUrodzenia miejsceUrodzenia plec adres przyjety odszedl status>` |
| podsumowanie frekwencji ucznia | `<Frekwencja wpisow obecnosc nieusprawiedliwione usprawiedliwione spoznienia zwolnienia>` |

Dodatkowo, żeby pakiet dał się odczytać **bez kodu źródłowego** za dwadzieścia lat:

- `<Slowniki>` — `<Przedmioty>` (z `db.col('subjects')`), `<RodzajeOcen>` i `<StatusyFrekwencji>`
  rozwijają wszystkie kody używane w atrybutach (`przedmiot="mat"`, `rodzaj="proposedMid"`,
  `status="nb"`). Kod statusu stoi przy wpisie raz, opis — raz w słowniku: przy 600 uczniach
  powtarzanie opisu przy każdym z setek tysięcy wpisów urosłoby o kilkanaście megabajtów.
- `<Semestry>` — `<Semestr id nazwa od do>`, po których czytelnik rozdziela półrocza.
- Uczniowie, których oddział już nie istnieje (absolwenci po przejściu na nowy rok), trafiają do
  `<Klasa id="bez-oddzialu">`, a nie wypadają z pakietu.

### Rocznik, nie „wszystko, co jest w bazie”

Każda kolekcja jest filtrowana **rokiem szkolnym**, bo inaczej pakiet „2027/2028” po cichu zawierałby
oceny z 2026/2027 i nic w dokumencie nie pozwoliłoby ich rozdzielić (D3-20). Zakres roku stoi w
korzeniu dokumentu: `<DziennikElektroniczny rok="2026/2027" odDnia="2026-09-01" doDnia="2027-08-31">`.

Kolekcje datują się różnie i filtr czyta każdą tak, jak ona sama się opisuje
(`AR.rowYearDate` / `AR.inYear`, `server/lib/archive.js`):

| kolekcja | po czym rozpoznajemy rok |
| --- | --- |
| `lessons`, `attendance`, `grades`, `remarks` | `date` |
| `excuses` | `from` (początek zwolnienia) |
| `descriptiveGrades`, `behaviorGrades` | `at` → dzień lokalny szkoły |
| `reportCardHistory` | `schoolYear` (`"2025/2026"`) — porównywany wprost z rocznikiem pakietu |

Wiersz, który nie niesie żadnej z tych dat, **zostaje w pakiecie** — luka w dzienniku jest gorsza
niż wiersz za dużo. Rok szkolny to 1 września – 31 sierpnia; jeśli konfiguracja szkoły ma pierwszy
semestr zaczynający się wcześniej, bierzemy tę wcześniejszą datę.

### Ile to waży

Pakiet jest tak duży, jak duży jest dziennik. Zmierzone na roczniku 600 uczniów / 24 oddziały /
pełny rok (`docs/review/round3/repro/reliability/`): `dziennik-<rok>.xml` **48 MB**, ZIP tyle samo
(metoda „stored”, bez kompresji), budowa 5,9 s, przyrost RSS przy budowie **0 MB** — XML leci na
dysk kawałek po kawałku, nigdy nie jest napisem w pamięci. Dla szkoły 300-osobowej to odpowiednio
mniej. Kompresja deflate zmniejszyłaby plik kilkunastokrotnie i jest oczywistym następnym krokiem,
ale zmienia kontrakt zapisu ZIP — dziś świadomie zostajemy przy „worku”, nie „archiwizatorze”.

### Skróty

Łańcuch jest krótki i cały daje się przeliczyć ręcznie:

```
sha256(dziennik-<rok>.xml)   ─┐
sha256(dziennik-<rok>.html)  ─┴→  manifest.json  ─→  manifest.sha256  ─→  PODPIS DYREKTORA
                                        │
                                        └→  seal.json (pieczęć kluczem szkoły)
```

Sprawdzenie na dowolnym Linuksie po rozpakowaniu pakietu:

```
sha256sum -c manifest.sha256              # manifest zgadza się ze swoim skrótem
python3 -c "import json,hashlib;m=json.load(open('manifest.json'));\
 [print(f['name'], hashlib.sha256(open(f['name'],'rb').read()).hexdigest()==f['sha256']) for f in m['files']]"
```

Pakiet jest **odtwarzalny**, i to dosłownie: ZIP powstaje raz, przy generowaniu, i **leży na dysku**.
Pobranie pół roku później oddaje ten sam plik, a nie składa go od nowa — więc skrót SHA-256 zgadza
się z tym zapisanym w wierszu i w rejestrze audytowym z definicji, a nie przez zbieg okoliczności.
Wiersz `archives` pamięta też `asOf` (ostatni dzień rocznika, do którego pakiet sięga) i `window`
(okno z § 22, które obowiązywało w chwili generowania).

### Gdzie leżą bajty

Magazyn EdMat jest silnikiem **dokumentowym**: jednostką zapisu jest cały wiersz. Dopóki XML,
wydruk i podpis siedziały w kolekcji, każde dotknięcie wiersza `archives` przepisywało megabajty —
zmierzone: `GET …/verify` (który zapisywał `a.verified`) kosztował **290–336 ms**, a wiersz z 5 MB
podpisu ważył 11,8 MB (R3-09). Od R3 bajty leżą obok kolekcji, a w wierszu zostaje sam opis:

```
data/school/files/archives/<id>/dziennik-2026-2027.xml
                               /dziennik-2026-2027.html
                               /manifest.json
                               /seal.json
                               /dziennik-2026-2027-archiwum.zip     (zbudowany raz, oddawany z dysku)
                               /podpis.xml                          (plik podpisu, jak przyszedł)
```

```json
{ "id": "arc_…", "year": "2026/2027", "at": "…", "byUserId": "…", "asOf": "2027-08-31",
  "window": { "from": "2027-06-25", "yearEnd": "2027-08-31", "to": "2027-09-10" },
  "files": { "xml":  { "name": "dziennik-2026-2027.xml", "bytes": 50749358, "sha256": "…", "path": "files/archives/arc_…/dziennik-2026-2027.xml" },
             "html": { … }, "manifest": { … }, "seal": { … }, "zip": { … } },
  "package":   { "name": "…zip", "bytes": …, "sha256": "…", "manifestSha256": "…", "files": [ … ], "digests": [ … ] },
  "signature": { "name": "podpis.xml", "type": "application/xml", "bytes": …, "sha256": "…",
                 "path": "files/archives/arc_…/podpis.xml", "kind": "zaufany",
                 "signedFile": "manifest.sha256", "verification": "digest-matched", "at": "…", "by": "…" } }
```

Reguły, których pilnuje `server/lib/blobs.js` — **jedyna** bramka do tego katalogu (żadna trasa nie
pisze do `data/` sama, `CONTRIBUTING.md`):

- każdy segment ścieżki musi pasować do `[A-Za-z0-9._-]+`; `..`, ukośniki i znaki sterujące są
  **odrzucane**, a nie „czyszczone”, więc nazwa z żądania nigdy nie buduje ścieżki;
- zapis idzie przez plik tymczasowy i `rename`, a SHA-256 liczy się w trakcie zapisu, ze strumienia;
- **kasowanie idzie za wierszem**: `DELETE …/archive/:id` kasuje katalog razem z wierszem;
- `Store._sweepOrphans` i `writeLayout` nigdy nie ruszają `files/` — to nie jest kolekcja;
- `scripts/backup.js` kopiuje katalog razem z danymi (niżej, § „Przechowywanie”).

Wiersz `archives` waży dziś ~3 kB zamiast 5,2 MB, więc kolekcja zostaje „zimna” i nic nie kosztuje:
**nie trzeba** jej dopisywać do `HOT` w `server/lib/store.js` (propozycja z `reliability.md` § 5 była
środkiem doraźnym na czas, gdy bajty jeszcze siedziały w wierszu). Zmierzone przy 600 uczniach:
`archives.json` 5,2 MB → 0,0 MB, zapis frekwencji z flushem 13 ms → 11 ms, dotknięcie wiersza
315 ms → 11 ms.

**Wiersze sprzed R3 migrują przy pierwszym odczycie**: `GET /api/principal/archive` (i każde
pobranie) zapisuje `xml`, `html`, `manifest.json`, `seal.json` i `signature.contentBase64` na dysk,
odtwarza ZIP ze składników i **usuwa te pola z wiersza**. `GET …/verify` migracji nie robi — to
jest GET i nic nie zapisuje.

### Granice zapisu ZIP

`server/lib/archive.js` zawiera własny, ~80-liniowy zapis ZIP (zero zależności npm). Świadome
ograniczenia:

- tylko metoda **0 (stored)** — pakiet nie jest kompresowany; ZIP jest tu workiem, nie archiwizatorem;
- brak **ZIP64** — łącznie poniżej 4 GiB i poniżej 65 535 wpisów (rocznik szkoły to setki kilobajtów);
- brak katalogów, atrybutów uprawnień, komentarzy, `data descriptor`, pól `extra` i szyfrowania;
- nazwy plików w UTF-8 przez bit 11 flagi ogólnej (EFS), bez tablicy CP437;
- znacznik czasu w formacie MS-DOS: rozdzielczość 2 sekund, lata 1980–2107, zawsze **czas lokalny
  szkoły** (`D.tz(db)`), liczony z zapisanego instantu, nigdy z `new Date()`.

Czytelnikiem jest zwykły `unzip`, Eksplorator Windows, `bsdtar` i każda biblioteka ZIP; test
`tests/52-archive.test.js` rozbiera pakiet własnym czytnikiem katalogu centralnego i przelicza
CRC-32 każdego wpisu.

## Jak szkoła podpisuje

Karta „Archiwum roczne” na ekranie dyrekcji prowadzi przez trzy kroki:

0. **Wygeneruj pakiet** — dopiero wtedy na karcie pojawiają się przyciski, o których mówią kolejne
   trzy kroki (do R3 instrukcja stała na ekranie zawsze, także wtedy, gdy nie było czego pobierać —
   U3-07).
1. **Pobierz pakiet** (`.zip`) i zapisz go na informatycznym nośniku danych.
2. **Podpisz `manifest.sha256`** z pakietu (albo cały `.zip`) — podpisem zaufanym na
   [gov.pl](https://www.gov.pl/web/gov/podpisz-dokument-elektronicznie-wykorzystaj-podpis-zaufany),
   podpisem osobistym z e-Dowodu, albo aplikacją dostawcy kwalifikowanego (Certum, KIR, EuroCert,
   Sigillum, CenCert).
3. **Dołącz plik podpisu** z powrotem w tej samej karcie.

Podpisanie małego pliku `manifest.sha256` zamiast całego ZIP-a jest wygodniejsze (gov.pl ma limity
rozmiaru) i równie mocne: skrót manifestu przypina skróty wszystkich plików danych.

## Co znaczy „zweryfikowany”

`POST /api/principal/archive/:id/signature` przyjmuje
`{ name, contentBase64, kind, signedFile }`, gdzie `kind` ∈
`xades | pades | zaufany | qualified | osobisty`, a `signedFile` ∈ `manifest.sha256 | package`.

Plik podpisu powstaje **poza dziennikiem**, więc jest wejściem z zewnątrz jak każde inne i przechodzi
przez cztery bramki, zanim czegokolwiek dotknie:

1. **`contentBase64` musi być napisem.** Do R3 `contentBase64: true` dawało trzybajtowy „podpis
   kwalifikowany” ze statusem 200 (S3-08) — dziś to `400 bad_signature_content`.
2. **Rozmiar musi być fizycznie możliwy.** Sam blok RSA-2048 to 256 bajtów, więc krótszy plik nie
   jest podpisem: `400 signature_too_small` (`minBytes` w odpowiedzi).
3. **Typ rozpoznajemy z bajtów, nie z nazwy.** `AR.sniffSignature` zna trzy rodziny, które podpis
   naprawdę ma: PKCS#7/CMS w DER (CAdES, `.p7s` — `30 8x` na początku), XML (XAdES i opakowanie
   gov.pl — `<?xml` albo wprost `<…Signature`), PDF (PAdES — `%PDF-`). JPEG z nazwą `kotek.p7s`
   dostaje `415 signature_type_unknown`. Do R3 przechodził i **uciszał termin z § 22**.
4. **Bramka załączników** (`server/lib/uploads.js`, S-13): rozmiar liczony z bajtów, nie z
   deklaracji, limit `config.archiveSignatureMaxMB` (domyślnie 5 MB) → `413 attachment_too_large`.
   Trasa jest w `UPLOAD_ROUTES` (`server/lib/router.js`), więc 5 MB pliku (≈ 6,7 MB base64)
   naprawdę dochodzi — wcześniej limit 512 kB zrywał połączenie zamiast odpowiedzieć.

Dopiero potem szukamy w pliku `<DigestValue>` (XAdES/XML-DSig, dowolny prefiks przestrzeni nazw) i
odnośników `<Reference URI="…">` i porównujemy znalezione skróty ze skrótami naszych plików i całego
pakietu. Skanowanie jest **liniowe i ograniczone**: jedno przejście po pierwszych 256 kB, ciało
skrótu czytane do najbliższego `<` z twardym limitem długości, najwyżej 256 dopasowań. Poprzednia
wersja używała `matchAll` z leniwym `[\s\S]*?` po całym pliku i 369 kB `"<Reference URI"`
zajmowało jej **12–22 sekundy** w jedynym wątku procesu — cała szkoła stała (S3-07). Dziś ten sam
plik to 9 ms, a 5,2 MB (które wcześniej nie kończyło się w pięć minut) — 11 ms.

### Stany podpisu

`verification` mówi, co **policzyliśmy**; `state` mówi, **co z tego wynika dla § 22**. To są dwie
różne rzeczy i pakiet nigdy ich nie skleja:

| `state` | kiedy | czy zamyka termin z § 22 | etykieta na ekranie |
| --- | --- | --- | --- |
| `none` | podpisu nie ma | nie | „Do pakietu nie dołączono jeszcze podpisu” |
| `signed` | `verification: digest-matched` — w pliku jest skrót SHA-256 równy skrótowi naszego `manifest.json`, `manifest.sha256`, pliku danych albo całego pakietu; `matched[].file` mówi którego | **tak** | „Skrót zgodny” |
| `stored-unverified` | plik przyjęliśmy, policzyliśmy jego własny skrót i zapisaliśmy go — ale nic w nim nie wskazuje na nasz pakiet (PAdES, opakowanie gov.pl, surowe `.sig`, CAdES) | **nie — przypomnienie dalej chodzi** | „Przyjęty, niezweryfikowany” |
| `accepted-unverified` | dyrektor odnotował `POST …/accept-unverified { reason }` | tak | „Przyjęty bez weryfikacji skrótu · <kto>, <kiedy> — <powód>” |
| `superseded` | rocznik przebudowano po podpisaniu | nie | „Ten podpis dotyczy poprzedniej wersji pakietu” |

Do R3 `signed` znaczyło po prostu „pole `signature` nie jest puste”, więc JPEG zatrzymywał
przypomnienia o ustawowym terminie na dobre (S3-08). Dziś:

- **`stored-unverified` nie ucisza niczego.** Przypomnienie z 3. i 8. dnia przychodzi dalej i mówi
  wprost dlaczego: „Dołączony plik podpisu nie potwierdza tego pakietu”.
- **`accepted-unverified` to decyzja dyrektora, nie zachowanie domyślne.**
  `POST …/accept-unverified { reason }` wymaga uzasadnienia (np. „zweryfikowano w walidatorze
  dostawcy zaufania 12.09.2027, protokół 8/2027”), zapisuje kto i kiedy, i zostawia wiersz
  `archive_signature_accepted_unverified` w rejestrze audytowym z `before.closedDeadline: false` →
  `after.closedDeadline: true`. `verification` **nadal** brzmi `stored-unverified` — nie zaczynamy
  twierdzić, że skrót się zgadza, tylko odnotowujemy, kto wziął za to odpowiedzialność.
  Podpisu o zgodnym skrócie nie ma czego przyjmować: `400 already_matched`.
- **Przebudowa podpisanego rocznika jest głośna.** `POST /api/principal/archive` dla rocznika, który
  ma podpis zamykający termin, odpowiada `409 year_signed` z identyfikatorem tego pakietu. Dopiero
  `{ "rebuild": true, "reason": "…" }` buduje nowy pakiet i **unieważnia poprzedni podpis**: stary
  wiersz dostaje `superseded`, `supersededBy`, `supersededReason`, podpis dostaje notatkę „dotyczy
  poprzedniej wersji pakietu i nie zamyka terminu z § 22”, a do rejestru idzie
  `archive_signature_superseded`. Stary pakiet **zostaje** — jest do pobrania i nie da się go
  usunąć. Status rocznika wraca do `package-ready`, a przypomnienia wracają razem z nim (H-9).

Czego **nie** sprawdzamy i czego nigdy nie zasugerujemy w interfejsie:

- ważności samego podpisu kryptograficznego,
- łańcucha certyfikatów i tego, czy wystawca jest na liście TSL,
- statusu odwołania (OCSP/CRL),
- znacznika czasu i tego, czy podpis złożono w terminie,
- tożsamości podpisującego.

Odpowiedź API mówi to wprost (`checks.certificateChain: 'nie sprawdzamy'`, `attests: false`, pole
`note`), a karta na ekranie pokazuje etykietę „Skrót zgodny” albo „Przyjęty, niezweryfikowany”,
nigdy „podpis ważny”. Szkoła, która potrzebuje pełnej weryfikacji, robi ją w walidatorze dostawcy
zaufania — a nie tutaj.

`seal.json` i pole `seal` rekordu archiwum to **pieczęć kluczem szkoły**: `GET …/verify` mówi, czy
pakiet nie zmienił się od wygenerowania. To dobry dowód spójności i bezwartościowy jako podpis
ustawowy; tak też jest opisany w odpowiedzi (`sealMeaning`) i w samym `seal.json`.

`GET …/verify` **niczego nie zapisuje** (R3-09). Przelicza pieczęć nad XML-em odczytanym z dysku i
sprawdza rozmiar każdego składnika; `?deep=1` przelicza SHA-256 wszystkich plików (przy roczniku to
ponad sto megabajtów odczytu, więc nie robimy tego przy każdym wejściu na ekran). Pole `intact`
ma trzy wartości i `null` znaczy „nie sprawdzaliśmy”, a nie „w porządku”. `verified` na liście
pakietów jest **wyliczane** — do R3 było zapisywane przez GET-a i kosztowało 290–336 ms na kliknięcie.

### Usuwanie pakietu

`DELETE /api/principal/archive/:id { reason }` — bo literówka w roku albo zacięty przycisk nie mogą
zostać w kolekcji na zawsze (S3-13: do R3 nie było **żadnej** trasy usuwającej, a `year` był wolnym
tekstem, więc dało się trwale zepsuć `GET …/xml`). Reguły:

- pakiet, pod którym leży podpis o zgodnym skrócie **albo** odnotowane przyjęcie bez weryfikacji,
  jest nieusuwalny (`409 package_signed`) — także wtedy, gdy rocznik przebudowano; to jedyny ślad
  po tym, co dyrektor wtedy podpisał;
- `reason` jest obowiązkowy i trafia do rejestru (`archive_deleted`) razem z rokiem, rozmiarami i
  skrótami tego, co zniknęło;
- katalog plików znika razem z wierszem (`removedFiles` w odpowiedzi mówi ile).

`year` przy tworzeniu pakietu musi mieć kształt `RRRR/RRRR` (`400 bad_year`), a nazwa pliku w
`Content-Disposition` przechodzi przez `safeFileName` na **każdej** z czterech tras pobierania — do
R3 przechodziła przez nią tylko `/package`, więc `year` z cudzysłowem dawał dwa parametry
`filename`, a `year` z CRLF-em zamieniał `GET …/xml` w trwałe 500 (S3-09).

## Termin i przypomnienia

§ 22 liczy dziesięć dni **od zakończenia roku szkolnego**, a rok szkolny trwa **do 31 sierpnia** —
nie do ostatniego dnia zajęć. Do R3 termin liczył się od `config.semesters[ostatni].to` (25.06.2027
→ 05.07.2027), czyli był o dwa miesiące za wczesny, a pakiet zamykał się **przed** sierpniowymi
egzaminami poprawkowymi i klasyfikacyjnymi i przed radą pedagogiczną, która rok kończy — więc
decyzje o promocji nigdy nie trafiały do archiwum, które ten rok certyfikuje (D3-22).

`GET /api/principal/archive` zwraca `window`:

| pole | znaczenie |
| --- | --- |
| `from` / `teachingEnd` | koniec zajęć dydaktycznych (`config.semesters[ostatni].to`, nadpisywalne `config.archiveWindow.from`) — **najwcześniejszy** dzień, w którym pakiet ma sens |
| `yearEnd` | koniec roku szkolnego: 31 sierpnia (nadpisywalne `config.archiveWindow.yearEnd`) — **od niego** liczy się termin |
| `to` / `deadline` | `yearEnd` + `days` (domyślnie 10) — ostatni dzień terminu z § 22 |
| `days` | długość terminu (`config.archiveWindow.days`) |
| `daysLeft` | dni do terminu; 0 = ostatni dzień, wartość ujemna = po terminie |
| `open` | czy dziś mieści się między `from` a `to` |
| `notYetOpen` | `true`, gdy okno jeszcze się **nie otworzyło** — to nie to samo, co „po terminie” (U3-06) |
| `basis` | jedno, stałe i poprawne zdanie o § 22; cokolwiek szkoła wpisała w `config.archiveWindow.basis`, jedzie obok jako `schoolNote` |
| `status` | `not-started` → `package-ready` → `signature-unverified` → `signed`; po terminie bez podpisu zamykającego: `overdue` |
| `signatureState` | stan podpisu ostatniego pakietu (tabela wyżej) |
| `signedPackageId` | który pakiet zamyka termin (bywa inny niż ostatni) |

`config.archiveWindow.to` jest honorowane tylko wtedy, gdy nie wypada **przed** `yearEnd`: termin z
§ 22 nie może minąć wcześniej niż rok, który certyfikuje. Dzięki temu stara wartość z zasiewu
(koniec zajęć + 10 dni) jest przeliczana, a świadomie ustawiony późniejszy termin zostaje.

Poza oknem pakiet wymaga `force` **i** `reason` (S3-13). Wiersz zapamiętuje wtedy `window`, które
obowiązywało, a rejestr audytowy dostaje ten sam obiekt — regeneracja po sierpniowym egzaminie
poprawkowym jest normalną, uzasadnioną czynnością, a nie „trybem demonstracyjnym” (D3-23).

Wszystkie daty liczy `D.today(db)` i `addDays` z `server/lib/util.js` w strefie szkoły
(`Europe/Warsaw`), nigdy `new Date()`.

Dyrekcja dostaje przypomnienie w **3. i 8. dniu po 31 sierpnia** (3 i 8 września), dopóki termin nie
jest zamknięty — przez `D.notify(db, …, 'archive', …, { dedupeKey: 'archive-<rok>-d3' })`, czyli
przez jedyną bramkę powiadomień, z ciszą nocną i deduplikacją. Powiadomienie idzie `push: false`:
to sprawa dnia roboczego, nie ekranu blokady. Gdyby kiedyś miało wychodzić także pushem, `archive`
trzeba dopisać do `PUSH_KINDS` w `server/routes/notifications.js`.

**Nie ma planisty.** `remindArchive` chodzi jako efekt uboczny `GET /api/principal/archive`, czyli
wtedy, gdy dyrektor otworzy kartę „Archiwum roczne”. Jeśli jej nie otworzy, przypomnienie nie
powstanie (D3-24). To świadome ograniczenie prototypu „jeden proces, zero zależności” — w pilotażu
rolę budzika pełni kalendarz dyrektora, nie dziennik.

## Przechowywanie przez okres archiwalny

Podpisany pakiet to dokument kategorii archiwalnej: dziennik lekcyjny ma w typowym JRWA szkoły
kategorię **B5** (arkusze ocen B50, księga uczniów B50/A) — kategorie należy porównać z JRWA
własnej szkoły, zatwierdzonym przez archiwum państwowe (`docs/RETENTION.md`).

Pakiet **żyje poza dziennikiem**: po wygenerowaniu i podpisaniu zapisuje się go na nośniku danych i
trzyma razem z plikiem podpisu przez cały okres przechowywania. To, co zostaje w dzienniku (wiersz
`archives` plus pliki w `data/school/files/archives/<id>/`), jest **kopią roboczą** i jest objęte
zwykłą kopią zapasową instancji. `scripts/backup.js` kopiuje katalog plików razem z danymi — jeden
gzipowany dokument niesie kolekcje i mapę `_files: { "files/<kolekcja>/<id>/<plik>": "<base64>" }`,
a `restore` odtwarza obie połowy. `verify` odmawia przyjęcia kopii, w której wiersz wskazuje na
plik, którego w kopii nie ma: kopia bez podpisanego pakietu byłaby gorsza niż brak kopii.

```
node scripts/backup.js backup --keep 30 --out /kopie     # jeden plik school-<data>.json.gz
node scripts/backup.js verify /kopie/school-….json.gz
node scripts/backup.js restore /kopie/school-….json.gz --data ./data --yes
```

Minimum operacyjne opisane w `docs/STORAGE.md` § 7 (kopia co noc, rsync poza host, próba
odtworzenia raz na semestr) obowiązuje tak samo dla archiwum rocznego. Sama kopia zapasowa **nie
zastępuje** zapisu na nośniku: § 22 mówi o nośniku danych, a nie o kopii bazy.

## Otwarte pytanie: podpis zaufany?

Raport z 23 września 2026 wymienia w § 22 podpis kwalifikowany, pieczęć kwalifikowaną i podpis
osobisty, i **nie wymienia podpisu zaufanego**. To jedna z najważniejszych i najsłabiej
potwierdzonych informacji w całym raporcie (ocena **B**,
`docs/research/2026-09-23-gemini-triage.md` wiersz 6 i § 3 punkt 1): nowelizacja z 2019 r.
prawdopodobnie dopuszcza również **podpis zaufany**, który jest darmowy i dostępny dla każdego
dyrektora przez profil zaufany na gov.pl.

Stawka jest konkretna:

- **jeśli podpis zaufany wystarcza** — koszt zerowy, dyrektor podpisuje na gov.pl w dwie minuty;
- **jeśli wymagany jest podpis kwalifikowany, pieczęć albo podpis osobisty** — szkoła musi kupić
  pieczęć chmurową (rząd ~900–1 350 PLN rocznie, ceny niepotwierdzone) albo dyrektor musi mieć
  podpis kwalifikowany.

**Do rozstrzygnięcia przez prawnika, przed wdrożeniem w jakiejkolwiek szkole.** Do tego czasu
dziennik przyjmuje wszystkie pięć rodzajów (`zaufany`, `osobisty`, `qualified`, `xades`, `pades`),
zapisuje, którego użyto, i **nie orzeka**, czy wybrany rodzaj spełnia § 22. Ta decyzja należy do
szkoły i jej prawnika, nie do oprogramowania.

### Drugie pytanie: co to jest „zakończenie roku szkolnego”

Przegląd R3 (`docs/review/round3/domain.md` § 2 punkt 1) postawił je wprost: koniec zajęć
dydaktycznych (ostatni piątek po 20 czerwca) czy 31 sierpnia? Odpowiedź przesuwa termin o dwa
miesiące i decyduje, czy wyniki sierpniowych egzaminów poprawkowych są w zapieczętowanym pakiecie.

Kod przyjmuje **31 sierpnia** — bo rok szkolny prawnie trwa do 31 sierpnia i bo pakiet, który
powstaje przed sierpniową radą, nie zawiera decyzji kończących rok. Koniec zajęć zostaje jako
`from`: najwcześniejszy dzień, w którym pakiet w ogóle ma sens. Obie daty da się nadpisać
(`config.archiveWindow.from`, `.yearEnd`, `.days`), więc szkoła, której prawnik powie inaczej,
zmienia jedną wartość w konfiguracji, a nie kod. **To nadal jest decyzja prawnika, nie nasza.**

### Trzecie pytanie: jaka kategoria archiwalna

Czy pakiet jest kategorii **A** (wieczyste przechowywanie), czy jest tylko pojemnikiem na treść
kategorii B5 (dziennik) i B50 (arkusze)? `docs/RETENTION.md` i przegląd R3 (D3-15) opisują, czemu
dzisiejsze zaklasyfikowanie `archives` do „protokołów rady pedagogicznej” jest błędem. Dopóki to nie
jest rozstrzygnięte, `archives` nie jest niczym brakowane — a odkąd bajty leżą w `files/`, rosnąca
kolekcja nie obciąża już magazynu tak, jak obciążała.

## API

| metoda | ścieżka | rola | odpowiedź |
| --- | --- | --- | --- |
| `GET` | `/api/principal/archive` | principal | `{ window, year, reminders, packages[] }`; przy okazji wysyła należne przypomnienia i migruje wiersze sprzed R3 |
| `POST` | `/api/principal/archive` | principal | generuje rocznik: `{ id, seal, files, package, signature, window }`; `400 bad_year` (kształt `RRRR/RRRR`), `403 window_closed` (komunikat rozróżnia „okno jeszcze nie otwarte” i „po terminie”), `400 no_reason` (`force` bez uzasadnienia), `409 year_signed` (rocznik podpisany — potrzeba `rebuild: true` + `reason`) |
| `DELETE` | `/api/principal/archive/:id` | principal | usuwa **niepodpisany** pakiet razem z plikami; wymaga `reason`; `409 package_signed` |
| `GET` | `/api/principal/archive/:id/xml` | principal | eksport § 21 (`application/xml`), prosto z dysku |
| `GET` | `/api/principal/archive/:id/print` | principal | wydruk (`text/html`, `inline`) |
| `GET` | `/api/principal/archive/:id/package` | principal | **cały pakiet** (`application/zip`) — plik z dysku, nie składany od nowa |
| `POST` | `/api/principal/archive/:id/signature` | principal | przyjmuje podpis; `400 bad_signature_kind` / `400 bad_signed_file` / `400 bad_signature_content` / `400 signature_too_small` / `415 signature_type_unknown`, reszta z bramki załączników (`400 bad_data_url`, `413 attachment_too_large`) |
| `POST` | `/api/principal/archive/:id/accept-unverified` | principal | odnotowuje przyjęcie podpisu bez weryfikacji skrótu; wymaga `reason`; `400 no_signature` / `400 already_matched` |
| `GET` | `/api/principal/archive/:id/signature` | principal | pobranie pliku podpisu |
| `GET` | `/api/principal/archive/:id/verify` | principal, dpo | **nic nie zapisuje**: pieczęć, stan plików na dysku (`?deep=1` przelicza skróty), `package`, `signature`, `window` |

Każde wygenerowanie, pobranie, dołączenie podpisu, przyjęcie bez weryfikacji, unieważnienie podpisu
i usunięcie pakietu zostawia wpis w rejestrze audytowym razem ze skrótami: `archive_generated`,
`archive_exported`, `archive_signature_attached`, `archive_signature_accepted_unverified`,
`archive_signature_superseded`, `archive_deleted`.
