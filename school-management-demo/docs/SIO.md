# Pakiet SIO — co eksportujemy i czego **nie** sprawdzamy

Sekretariat wywołuje `POST /api/registry/sio/validate` i pobiera `GET /api/registry/sio/package`
(3.5.3). Dokument opisuje, skąd bierze się każdy element XML-a, co robi kontrola własna pakietu
i gdzie jest dziura, której z tego środowiska nie da się zasypać. Powstał w pakiecie R7 po triage'u
raportu Gemini z 23.09.2026 (`docs/research/2026-09-23-gemini-triage.md`, wiersze 2 i 4).

## 1. Nie mamy schematu XSD i nie udajemy, że mamy

SIO 2 nie ma publicznego API do zapisu: dane wprowadza się w aplikacji SIO, a producenci dzienników
dostarczają **pliki wsadowe sprawdzane wobec schematów XSD Centrum Informatycznego Edukacji**. Tych
schematów nie pobraliśmy — środowisko, w którym ten prototyp powstaje, nie ma dostępu do sieci,
a schematu nie ma w repozytorium. Nasz XML powstał więc **z opisu, nie ze schematu**.

Dlatego każda odpowiedź walidacji niesie pole:

```json
{ "schema": "not-validated-against-cie-xsd" }
```

To jest jedyna uczciwa etykieta: pakiet przeszedł **kontrolę własną**, a nie walidację schematem.
Nazwy elementów i atrybutów niemal na pewno różnią się od tych, których oczekuje CIE — zgodność
nazw jest do ustalenia dopiero przy schemacie w ręku.

**Co trzeba zrobić, zanim jakakolwiek szkoła wyśle ten plik:**

1. pobrać aktualny schemat XSD z `cie.gov.pl` (albo dostać go od szkoły, która już sprawozdaje);
2. porównać nazwy elementów z tabelą z §2 i poprawić `buildSio()` w `server/routes/registry.js`;
3. wpiąć prawdziwą walidację schematem — i dopiero wtedy zmienić wartość `schema`.

Do tego czasu `GET /api/registry/sio/package` jest **materiałem do porównania ze schematem**, a nie
sprawozdaniem gotowym do wysłania.

## 2. Co pakiet zawiera i z jakiej kolekcji

Źródło: `buildSio(db)` w `server/routes/registry.js`. Uczniowie: wyłącznie ci ze `status === 'active'`.

| element / atrybut | skąd pochodzi |
| --- | --- |
| `<sio wersja>` | `config.sio.schemaVersion`, a gdy szkoła nie ma jeszcze ustawień SIO — `1.0` |
| `<sio dataSprawozdania>` | `D.today(db)` (dzień szkolny, w demo przypięty przez `config.today`) |
| `<sio anonimizacja>` | `config.anonymized` |
| `<szkola rspo / regon / nazwa>` | `config.school.rspo`, `.regon`, `.name` |
| `<szkola rokSzkolny>` | `config.year` |
| `<podsumowanie liczbaOddzialow / liczbaUczniow>` | policzone z `classes` i `students` |
| `<oddzial id / nazwa / poziom>` | `classes[].id`, `.name`, `.level` |
| `<oddzial liczbaUczniow>` + `<liczbaUczniow>` | liczba aktywnych uczniów z `students[].classId` |
| `<oddzial wychowawca>` | `classes[].homeroomTeacherId`, a gdy pusty — `.actingHomeroomTeacherId` (`users`) |
| `<uczen numerKsiegi>` | `students[].registerNo` |
| `<uczen nazwisko / imie>` | `students[].lastName`, `.firstName` (puste w kopii anonimizowanej) |
| `<uczen pesel>` | `students[].pesel`; w kopii anonimizowanej `pesel=""` + `anonimizacja="tak"` |
| `<uczen rodzajDokumentu / numerDokumentu / krajWydania>` | `students[].identityDocument` (`{type, number, country}`) — patrz §4 |
| `<uczen paszport>` | ten sam numer co `numerDokumentu`, zostawiony dla zgodności ze starszym odbiorcą |
| `<uczen dataUrodzenia / miejsceUrodzenia / plec>` | `students[].birthDate`, `.birthPlace`, `.sex` |
| `<uczen dataPrzyjecia>` | `students[].enrolledAt` (alias `joinedAt`) |
| `<uczen dataOdejscia>` | `students[].departureDate` (pusta przy otwartym wpisie w księdze) |

Czego w pakiecie **nie ma**, choć SIO tego oczekuje: danych kadrowych, godzin zajęć, orzeczeń
i opinii, dowożenia, subwencyjnych kategorii wsparcia. To jest eksport uczniowsko-oddziałowy, a nie
pełne sprawozdanie.

## 3. Co sprawdza kontrola własna (`POST /api/registry/sio/validate`)

Odpowiedź: `{ ok, errors[], warnings[], counts, schemaVersion, anonymized, schema, checks[], note }`.

* `errors[]` — zdania po polsku z `buildSio()`. To jest lista sprzed R7, niezmieniona.
* `warnings[]` — kontrola własna. Każdy wpis: `{ code, level: 'error' | 'warning', message, studentId?, field? }`.
* `blocking[]` / `blockingCount` — **suma jednego i drugiego**: `errors` plus te `warnings`, które mają
  `level: 'error'`. `ok` jest prawdą dokładnie wtedy, gdy `blocking` jest puste.

Do rundy 3 `GET …/package` patrzył wyłącznie na `errors`, więc **każda** kontrola opisana niżej była
w praktyce doradcza: dwoje uczniów z tym samym numerem PESEL albo uczeń z pustym nazwiskiem pobierał
się „czysto”, przy `ok: false` w walidacji obok. Teraz blokuje całe `blocking` (D3-44).

**Obejście jest wyjątkiem, nie trybem pracy.** `?force=1` pobiera pakiet mimo błędów, ale:

* wywołać to może wyłącznie **administrator** — sekretariat pod presją terminu dostaje `403
  sio_force_admin_only` i najpierw poprawia wskazane wpisy w księdze;
* akcją w rejestrze zdarzeń jest `sio_export_forced` (a nie zwykły `sio_export`), a wiersz niesie
  liczbę błędów i ich kody. Kto pobrał wadliwe sprawozdanie i kiedy, widać po latach.

**Szkoła bez ustawień SIO.** `config.sio` zapisuje seed demonstracyjny; instalacja z kreatora
pierwszego uruchomienia może go nie mieć. `POST …/validate` odpowiada wtedy `400
sio_not_configured` ze zdaniem mówiącym, czego brakuje (`config.sio.schemaVersion`) — nigdy
`500 „Błąd serwera.”`, jak przed rundą 3 (R3-05, D3-43, OPS3-13).

Kontrole (`checks[]` w odpowiedzi):

| `check` | co robi | kody |
| --- | --- | --- |
| `well-formed-xml` | pełny skan składni własnym skanerem `server/lib/xmlcheck.js`: jeden element główny, domknięte i prawidłowo zagnieżdżone znaczniki, atrybuty w cudzysłowach, bez powtórzeń, bez nagiego `&`, bez tekstu poza korzeniem, odwołania znakowe w zakresie Unicode, zagnieżdżenie do 500 poziomów. Każdy błąd z numerem linii i kolumny | `xml_not_well_formed`, `xml_root_unexpected`, `bad_entity`, `nesting_too_deep` |
| `required-fields-per-pupil` | przy każdym uczniu: nazwisko, imię, data urodzenia, miejsce urodzenia, oddział | `missing_field` |
| `identity-pesel-or-document` | numer PESEL **albo** dokument tożsamości z krajem wydania; PESEL zawsze liczony sumą kontrolną | `no_identity`, `document_no_country`, `pesel_checksum` |
| `no-duplicate-pesel` | ten sam numer PESEL przy dwóch uczniach | `duplicate_pesel` |
| `iso-dates` | `dataUrodzenia`, `dataPrzyjecia`, `dataOdejscia` w formacie `RRRR-MM-DD` | `bad_date` |
| — | brak daty przyjęcia (wpisy sprzed GAP-6) — ostrzeżenie, nie blokada | `missing_enrolment` |

**Czego kontrola NIE sprawdza** (i nie ma jak sprawdzić bez schematu):

* czy nazwy elementów i atrybutów są te, których oczekuje CIE;
* czy kolejność elementów, liczności (`minOccurs`/`maxOccurs`) i typy danych zgadzają się ze schematem;
* czy słowniki (kody typów szkół, kody krajów, kody kwalifikacji) mają dopuszczalne wartości;
* czy sprawozdanie jest kompletne w sensie SIO — brakujących obszarów z końca §2 nikt nie policzy;
* czy identyfikator RSPO i REGON istnieją w rejestrze.

Skaner jest **liniowy** i **ograniczony**. Numer linii wylicza się z raz policzonej tablicy początków
linii (wyszukiwanie binarne), a nie przez kopiowanie tekstu od początku pliku przy każdym błędzie —
pół megabajta zepsutego eksportu wklejone do walidatora kosztowało 7 sekund zajętego procesu, dziś
kosztuje ~50 ms (R3-06). Lista błędów zamyka się na 50 i wtedy skan się kończy; przy zagnieżdżeniu
głębszym niż 500 poziomów kończy się od razu, z własnym komunikatem, zamiast czekać, aż rekurencyjny
parser tego samego pliku przewróci stos (S3-19).

## 4. Uczeń bez numeru PESEL (§ 4 rozporządzenia o dokumentacji)

Księga uczniów prowadzi numer PESEL, a gdy uczeń go nie ma — **rodzaj i numer dokumentu
potwierdzającego tożsamość**. Do R7 mieliśmy w bazie samo pole `passport`, przez co uczeń z kartą
pobytu (w fixture'ach naboru równie częsty co ten z paszportem) musiał być wpisany jako paszport.

```js
students[].identityDocument = { type: 'passport' | 'residence-card' | 'other', number, country }
```

Jeden gate: `server/lib/identity.js` — `documentOf(s)`, `identityLabel(s)`, `readDocument(body)`,
`documentFields(doc)`. `passport` / `passportCountry` zostają jako pola zgodności i są zapisywane
razem z dokumentem. Każde miejsce, które pokazywało `s.pesel`, pokazuje teraz `identityLabel(s)` —
odpis arkusza ocen, księga uczniów, karta flag ucznia. `identityLabel` nigdy nie zwraca pustego
napisu: bez PESEL-u i bez dokumentu mówi wprost, że ich nie ma.

Lista z naboru gminnego trzyma dokument jako **jedno wolne pole** („paszport UA FL123456”), więc
`POST /api/registry/students/import` rozbija je heurystycznie i **niczego nie zapisuje** — to faza
dopasowania, w której sekretariat przegląda wynik (`rows[].review`, kod `document_needs_review`).
Suchy bieg jest suchym biegiem także w rejestrze zdarzeń: wiersz niesie liczby i przyciętą próbkę
nazw kolumn, nigdy całej treści pliku, oraz — to jest nowe — **ile numerów PESEL przepuszczono przez
księgę i ile z nich trafiło** (`peselsProbed`, `peselsMatchedInRegister`). Wcześniej dwa żądania
„nic nie zapisujemy” potrafiły dopisać 205 kB do kolekcji, której nic w produkcie nie usuwa przed
upływem retencji, i nie zostawiały śladu po tym, co właściwie sprawdzano (S3-12, S3-14).

### Numer PESEL nadany w trakcie roku

Uczeń, który przyjechał we wrześniu na karcie pobytu i dostał numer PESEL w listopadzie, dostaje go
w księdze przez `PATCH /api/registry/students/:id/flags` z polem `pesel` (D3-45):

* numer przechodzi tę samą kontrolę, co przy wpisie — suma kontrolna **oraz** zgodność z datą
  urodzenia z księgi — i nie może stać już przy innym uczniu (`409 pesel_duplicate`);
* `registerNo`, `id` ucznia i jego login **zostają bez zmian**: to identyfikatory, na których wiszą
  oceny, frekwencja i konto. Usunięcie i ponowne wpisanie ucznia — jedyna dotychczasowa droga —
  paliło wszystkie trzy;
* poprzedni dokument tożsamości **zostaje w księdze**: przenosi się do `students[].identityHistory[]`
  razem z datą, kontem, które zapisało zmianę, i podstawą (§ 4);
* pole jest polem księgi uczniów, więc wpisuje je sekretariat, administracja albo dyrekcja —
  wychowawca dostaje `403 registry_only` (resztę flag swojego oddziału zmienia jak dotąd).

### Zmiana imienia albo nazwiska

`PATCH /api/registry/students/:id/name` (D3-48). § 4 wymaga, żeby księga niosła **także nazwisko
poprzednie**, więc:

* wymagane są `basis.kind` (`court-order`, `marriage`, `adoption`, `administrative-decision`,
  `correction`) i `basis.reference` — bez sygnatury wpisu nie da się obronić przy kontroli;
* poprzednia para imię + nazwisko trafia do `students[].previousNames[]` z datą (`until`) i podstawą,
  a księga (`GET /api/registry/students`) pokazuje ją obok bieżącej;
* imię i nazwisko przepisują się na konto ucznia, żeby nie logował się pod starym nazwiskiem;
  `id`, `registerNo` i **login zostają** — id jest slugiem nazwiska, ale jest przede wszystkim kluczem;
* odmiana przez przypadki traci potwierdzenie (`declension.confirmedAt = null`): miejscownik
  sprawdzony przed wydrukiem świadectw dotyczył poprzedniego nazwiska.

## 5. Kody frekwencji z cudzego dziennika

`D.mapAttendanceCode(code, mapping)` w `server/lib/domain.js` jest jedynym tłumaczem kodów
frekwencji. **Nic nie zgaduje**: kod, który nie jest naszym statusem (`ob, nb, sp, zw, u, rs, w`)
i nie ma wpisu w `mapping`, wraca jako `{ ok: false, reason: 'unknown' }`.
`POST /api/registry/attendance/import` (również wyłącznie próbny) zwraca `400
attendance_codes_unmapped` z listą kodów bez odpowiednika, zamiast je pomijać — archiwum
z `tests/fixtures/real-formats/archive/` używa `ns` („nieobecność z przyczyn szkolnych”), którego
nasz dziennik nie zna, a `D.attendanceStats` zobaczyłby go dopiero jako spadek frekwencji.

## 6. Dokąd dalej

1. **Schemat XSD z CIE** — bez niego wszystko powyżej jest hipotezą o nazwach (triage, §4).
2. Jedno prawdziwe sprawozdanie SIO ze szkoły, do porównania pole po polu.
3. Rozszerzenie pakietu o kadrę i godziny zajęć — dopiero po 1. i 2.
