# Magazyn danych EdMat

> Storage engine: what is on disk, what a write costs, how a crash is recovered, how an older
> installation is migrated, and when the school has outgrown this and must move to SQLite.
> Kod: `server/lib/store.js`, `server/lib/migrate.js`, `scripts/backup.js`, `scripts/bench.js`.
> Testy: `tests/46-reliability.test.js`. Pomiary wyjściowe: `docs/review/reliability.md`.

## 1. Dlaczego to się zmieniło

Do tej pory cała szkoła była jednym dokumentem `data/school.json`, przepisywanym w całości przy
każdym zapisie. Przegląd niezawodności (REL-05) zmierzył to na szkole z brief-u — 600 uczniów,
50 nauczycieli, 30 oddziałów, 5 lekcji dziennie:

| stan | wiersze | plik | `flush()` | start procesu |
| --- | ---: | ---: | ---: | ---: |
| 5 miesięcy | 369 976 | 117,4 MB | 1 932 ms | 1 393 ms |
| 12 miesięcy | 657 976 | 209,4 MB | 3 693 ms | 3 821 ms |

Proces jest jednowątkowy, więc **każdy zapis zatrzymywał całą szkołę** na te 2–4 sekundy — a zapis
wywołuje każde żądanie (stempel `lastActivity` sesji). Frekwencja jednej lekcji to ~20 wierszy po
~320 B; przepisywanie z tego powodu 117 MB to 20 000-krotny narzut.

Cel przebudowy: **zapis proporcjonalny do tego, co się zmieniło**, bez zmiany API `Store`
(`col/get/one/find/insert/update/remove/save/flush`), bez zmiany żadnego route'u i bez zależności.

## 2. Układ na dysku (format 2)

```
data/
  school.json.lock                 plik blokady — jeden katalog danych = jeden proces (bez zmian)
  school/                          katalog danych
    _store.json                    manifest: format, czas ostatniego zapisu, wiersze/bajty per kolekcja
    config.json                    każda wartość nietablicowa ma swój plik (config, meta)
    meta.json
    students.json                  migawka kolekcji: jedna tablica JSON
    users.json
    …
    attendance.json                migawka kolekcji „gorącej”
    attendance.jsonl               dziennik dopisywania: jedna operacja w linii
    files/                         bajty, które nie są dokumentami (pakiety § 22, podpisy) — niżej
  school.json.migrated-2026-09-23  stary dokument po migracji (patrz §6)
  backups/school-2026-09-23T02-30-00.json.gz
```

**Kolekcje gorące** — pisane bez przerwy i rosnące bez ograniczeń — mają dziennik od początku:
`attendance`, `audit`, `notifications`, `lessons`, `grades`, `sessions`, `messages`.
Każda inna kolekcja **awansuje automatycznie**, gdy jej migawka przekroczy `hotBytes`
(domyślnie 4 MB, `EDMAT_HOT_BYTES`) — nowa kolekcja dodana w przyszłości nie wymaga decyzji.

### Format dziennika

Jedna linia = jedna operacja, JSON bez odstępów:

```json
{"op":"i","doc":{"id":"att_les_1_st_7","status":"ob", …}}
{"op":"u","id":"att_les_1_st_7","doc":{"id":"att_les_1_st_7","status":"nb", …}}
{"op":"d","id":"ses_9a3f"}
```

`i` (insert) i `u` (update) są zapisywane jako **cały dokument**, nie jako łatka. Kosztuje to tyle
samo, a jest odporne na zmianę, której śledzenie mogło nie zauważyć (§4) i na odtworzenie dziennika
na nowszej migawce: obie operacje działają jak *upsert* po `id`, więc powtórzenie jest nieszkodliwe.
`{"op":"u","id":…,"patch":{…}}` jest nadal rozumiane przy odczycie.

### Pliki wierszy: `data/school/files/`

Od rundy R3 obok kolekcji leży katalog `files/` — bajty, które **nie są dokumentami**:

```
data/school/
  archives.json                    wiersz: { id, year, files, package, signature, … } — kilkaset bajtów
  files/
    archives/<archiveId>/dziennik-2026-2027.xml      4,6 MB
                        /dziennik-2026-2027.html
                        /manifest.json  /seal.json
                        /dziennik-2026-2027-archiwum.zip   gotowy ZIP, nie składany przy każdym pobraniu
                        /podpis.xml                        plik podpisu, bajt w bajt jak wgrany
```

W wierszu zostaje wyłącznie opis: `{ name, bytes, sha256, path: 'files/<kolekcja>/<id>/<nazwa>' }`.
Powód jest zmierzony (`docs/review/round3/reliability.md` § 5, R3-09/R3-13): jednostką zapisu tego
magazynu jest **cały dokument**, więc 5 MB podpisu na wierszu `archives` sprawiało, że każdy zapis
dotykający tego wiersza kosztował 290–336 ms, a kolekcja poniżej `hotBytes` była dodatkowo
porównywana przy **każdym** flushu (11 ms → 50 ms na zapis frekwencji, przez cały rok). Żaden z tych
bajtów nigdy nie jest odpytywany — zapisujemy je raz i oddajemy bajt w bajt. To są pliki udające
dokumenty.

Cztery reguły, i wszystkie cztery są w kodzie, nie tylko tutaj:

1. **Jedna bramka: `server/lib/blobs.js`.** `put/get/stream/has/list/del/sha256Of`. Żaden route nie
   pisze sam do `data/` (reguła z `CONTRIBUTING.md`). Każdy segment ścieżki musi pasować do
   `/^[A-Za-z0-9._-]+$/`; „..” i separatory są **odrzucane**, nie „czyszczone”. Zapis idzie przez
   plik tymczasowy i `rename`, a SHA-256 liczy się w locie ze strumienia.
2. **Kopia zapasowa je obejmuje.** `scripts/backup.js` dokłada je do tego samego, jednego
   `school-<data>.json.gz` jako `_files: { "files/<kolekcja>/<id>/<plik>": "<base64>" }`; `verify`
   sprawdza, czy każdy wiersz wskazujący na plik ma ten plik w kopii (`missingFiles`), a `restore`
   rozkłada je z powrotem pod `files/`. Kopia, która po cichu przestałaby zawierać podpisany pakiet
   § 22, byłaby gorsza niż brak kopii (§ 7).
3. **Sprzątanie kolekcji ich nie dotyka.** `files/` nie jest kolekcją: `Store._sweepOrphans` trzyma
   je na liście `keep` obok `_store.json`, a `writeLayout` (odtworzenie układu z jednego dokumentu)
   ich nie rusza. Kasowanie idzie **za wierszem** — usunięcie pakietu archiwalnego kasuje jego
   katalog (`B.del`), więc sierot nie ma.
4. **Nie liczą się do `db.stats().bytes`.** Rozmiar magazynu w `/api/health` i w progu ostrzegawczym
   (§ 9) to suma plików kolekcji; `files/` wchodzi do niej tylko rozmiarem samego katalogu. To jest
   zamierzone — próg mówi o tym, ile danych mieli się w pamięci procesu, a bajty z `files/` nigdy
   nie są wczytywane do `db.data`. Miejsce na dysku licz osobno (`du -sh data/school/files`).

Dziś pisze tu wyłącznie archiwum roczne (`archives`). Każda następna funkcja z dużym plikiem —
załączniki, skany, eksporty — ma iść tą samą drogą, a nie wierszem z base64.

## 3. Co kosztuje zapis

`db.save()` jest nadal odbijany (50 ms, twardy limit `maxSaveDelayMs` = 1 000 ms — REL-02).
`db.flush()` przechodzi po kolekcjach:

| rodzaj kolekcji | co robi flush |
| --- | --- |
| mała (zimna) | serializuje ją i **porównuje z ostatnio zapisanym tekstem**; zapisuje tylko przy różnicy |
| gorąca | dopisuje do `.jsonl` wiersze dodane od ostatniego flusha + zmienione + usunięte |
| gorąca, zmiana strukturalna | przepisuje migawkę (sort, `db.data.x = […]`, `splice`, przypisanie po indeksie) |

Zimne kolekcje są weryfikowane, a nie śledzone — w szkole z brief-u ważą razem ~1,5 MB, więc
serializacja kosztuje ~10 ms i jest **dokładna z definicji**: żadna bezpośrednia mutacja dokumentu
nie może jej umknąć.

**Kompaktowanie.** Migawka gorącej kolekcji jest przepisywana, gdy dziennik przekroczy
`compactOps` operacji (domyślnie 20 000, `EDMAT_COMPACT_OPS`) albo gdy urośnie do połowy migawki
(minimum 256 kB). Kompaktowanie odbudowuje migawkę **z pamięci**, więc jest także siatką
bezpieczeństwa dla §4. Przy frekwencji 600 uczniów (~3 000 wierszy dziennie) wypada raz na ~7 dni.

`close()` (i `flushAll()` przy `SIGTERM`) robi **zwykły flush, bez kompaktowania**: dziennik jest tak
samo trwały jak migawka, a przepisywanie 91 MB przy każdym restarcie kosztowałoby ~3 s i niczego by
nie dodało. Kompaktowanie wymusza się jawnie: `db.compact()`.

## 4. Śledzenie zmian: dlaczego Proxy i gdzie jego granica

Route'y nie wiedzą o magazynie: dopisują do `db.col(name)` i piszą wprost po dokumentach, które
znalazły (`Object.assign(existing, patch)`, `s.session.lastActivity = …`). Żeby nie ruszać żadnego
route'u, `db.data`, każda kolekcja i każdy wydany dokument są opakowane w `Proxy`.

Warunek był jeden: **czytanie nie może na tym stracić**. `scripts/bench.js --proxy` mierzy filtr po
324 000 wierszy frekwencji:

| wariant | czas | vs. surowa tablica |
| --- | ---: | ---: |
| surowa tablica (odniesienie) | 6,0 ms | 1,0× |
| `Proxy` z pułapką `get` na każdym elemencie | 57,0 ms | **8,3×** |
| `Proxy` przekazujący metodę do surowej tablicy | 6,3 ms | **1,0×** |
| filtr po dokumentach opakowanych w `Proxy` | 19,1 ms | 2,8× |
| opakowanie 324 000 dokumentów (jednorazowo) | 6,6 ms | — |

Pierwszy wariant — najprostszy — kosztuje 8,3× i odpada (próg z planu naprawczego to ~30 %). Dlatego
**kolekcja nigdy nie pozwala metodzie tablicowej iterować przez siebie**: `filter`, `some`, `map`,
`reduce`, `indexOf`… są wywoływane na surowej tablicy, a callback dostaje surowe dokumenty.
Opakowane wracają tylko te referencje, które route realnie modyfikuje:

* wynik `db.get` / `db.one` / `db.find` / `db.insert` / `db.update`,
* wynik `col.find` / `col.filter` / `col.slice` / `col.at` / `col[i]`,
* elementy wydawane przez `for…of`, spread i `col.forEach`.

Opakowanie jednego dokumentu kosztuje ~23 ns, więc typowa lista (roster: 20 wierszy) jest darmowa,
a pełny skan frekwencji w `for…of` (`routes/attendance.js` kasuje flagę `draft`) kosztuje ~7 ms.
Dokumenty **zamrożone** (dziennik audytu, `Object.freeze`) wracają nietknięte — i tak nie mogą się
zmienić, a `Proxy` nad niezapisywalną właściwością łamałby niezmiennik języka.

**Granica.** Umknęłaby mutacja dokumentu wykonana *wewnątrz* callbacku `filter`/`map`/`sort`.
W tym kodzie nikt tak nie pisze, a skutkiem nie jest ciche zgubienie danych:

1. zimne kolekcje są przy każdym flushu porównywane w całości, więc widzą wszystko;
2. gorące przepisują migawkę z pamięci przy każdym kompaktowaniu, więc okno jest ograniczone
   dziennikiem (domyślnie 20 000 operacji), a nie czasem życia procesu;
3. `db.compact()` (i `scripts/backup.js`) wymusza pełny przepis w dowolnej chwili.

Przezroczystość opakowania jest testowana: `Array.isArray`, `JSON.stringify`, `for…of`, `.find`,
`.filter`, `.map`, `Object.keys`, dostęp po indeksie — `tests/46-reliability.test.js`
(„a collection behaves exactly like the array it wraps”).

## 5. Bezpieczeństwo przy awarii

| ryzyko | co je zamyka |
| --- | --- |
| przerwany zapis migawki | tmp + `rename` — plik jest zawsze cały albo poprzedni |
| przerwany dopis do dziennika | ostatnia linia jest urwana i **nie parsuje się → jest pomijana**; wszystko przed nią to komplet rekordów (test „survives a torn last log line”) |
| awaria między zapisem migawki a skróceniem dziennika | `i`/`u` są upsertami po `id`, więc powtórne odtworzenie dziennika na nowszej migawce jest bezstratne |
| zgubiony zapis przy `SIGTERM`/`kill` | `flushAll()` na `SIGTERM`/`SIGINT`/`beforeExit`/`exit` (REL-03), `stop_grace_period: 60s` w compose |
| dwa procesy na jednym katalogu | `school.json.lock` z pid/host/czasem, przejęcie osieroconej blokady (REL-04) |
| pamięć podręczna systemu plików | `EDMAT_FSYNC=1` → `fsync` po każdym dopisie i przed każdym `rename` (wolniej, ale przeżywa utratę zasilania hosta) |

Odtworzenie przy starcie: wczytaj `<kolekcja>.json`, potem odtwórz `<kolekcja>.jsonl` po kolei.
Linia, która się nie parsuje, jest pomijana, a liczba pominiętych trafia do logu:
`EdMat: pominięto N uszkodzonych linii w dzienniku attendance.jsonl…`.

## 6. Migracja ze starego układu

Wersja schematu (`meta.version`) to **2**, `per-collection-storage`.

Przy pierwszym starcie nowego builda `Store.load()` woła `migrate.importLegacyFile()`:

1. jeśli `data/school/_store.json` już jest — nic się nie dzieje;
2. w przeciwnym razie, jeśli istnieje `data/school.json`, jest wczytywany i zapisywany w nowym
   układzie (pełny `compact()`, czyli migawka każdej kolekcji);
3. stary dokument jest **przemianowywany** na `school.json.migrated-RRRR-MM-DD` — zostaje jako kopia
   i nie zostanie zaimportowany po raz drugi;
4. dopiero potem uruchamiają się migracje schematu, więc `meta.version` idzie 1 → 2 normalną drogą.

W logu: `EdMat: przeniosłem dane z school.json do katalogu school/ (369 976 wierszy, 2 041 ms).`
Import zdarza się raz; kolejne starty czytają katalog. Powrót do starszego builda: wystarczy
przywrócić `school.json.migrated-*` pod nazwą `school.json` i usunąć katalog `school/`
(albo `node scripts/backup.js restore <kopia>` na starym buildzie).

`db.data = {}` (reset demo, `--reseed`, kreator pierwszego uruchomienia) działa dalej: jest
traktowane jako podmiana wszystkiego — pliki kolekcji, których już nie ma, są kasowane.

## 7. Kopie zapasowe

`scripts/backup.js` bez zmian w CLI:

```
node scripts/backup.js backup  [--data <dir>] [--out <dir>] [--keep 30] [--label nocny]
node scripts/backup.js list    [--out <dir>]
node scripts/backup.js verify  [plik.json[.gz]]
node scripts/backup.js restore <plik.json[.gz]> [--data <dir>] [--yes]
node scripts/backup.js prune   [--out <dir>] [--keep 30]
```

Kopia to nadal **jeden plik `school-<data>.json.gz`**: katalog jest odczytywany (migawki + dzienniki)
i składany z powrotem w jeden dokument. Jeden plik do zrzucenia poza host, jeden do sprawdzenia, ten
sam kształt, co anonimizowany eksport `POST /api/admin/backup/anonymized` — więc obie drogi
odtwarzają się tak samo. Odtworzenie rozkłada dokument z powrotem na katalog (`writeLayout`),
zachowuje poprzednią wersję jako `school-przed-odtworzeniem-*.json` i odmawia działania, dopóki
blokada katalogu jest trzymana przez żywy proces.

Minimum operacyjne: `backup --keep 30` codziennie o 02:30 **i rsync poza host**, test odtworzenia do
katalogu na śmieci raz na semestr.

## 8. Wyniki (przed / po)

`node --max-old-space-size=4096 scripts/bench.js --attendance 324000 --clients 20 --rounds 10`
buduje szkołę demo i rozdmuchuje frekwencję do rozmiaru z §1, raz na starym silniku
(`EDMAT_STORE=legacy`, jeden `school.json`), raz na nowym.

Fikstura: szkoła demo (prawdziwe oddziały, plan lekcji, nauczyciele — żeby endpointy działały
naprawdę) z frekwencją rozdmuchaną do 324 000 wierszy, czyli koniec stycznia w szkole 600-osobowej.
Dev container, Node 18.19.1, 6 rdzeni, `--max-old-space-size=4096`.

| pomiar | przed (jeden plik) | po (plik na kolekcję) |
| --- | ---: | ---: |
| wiersze w magazynie | 325 426 | 325 426 |
| na dysku | 90,8 MB | 90,8 MB |
| pełny zapis (każda kolekcja) | 1,85 s | 2,86 s |
| **flush po jednym wpisie frekwencji** | **1,23 s** | **3 ms** |
| flush po jednym wpisie frekwencji, p95 | 1,60 s | 59 ms |
| start: wczytanie danych | 2,50 s | 1,14 s |
| `GET /api/attendance/lesson/:id` p50 | 253 ms | 230 ms |
| `GET /api/attendance/lesson/:id` p95 (20 klientów) | **1,58 s** | **407 ms** |
| `POST /api/attendance/lesson/:id` p50 | 336 ms | 292 ms |
| `POST /api/attendance/lesson/:id` p95 (20 klientów) | **1,57 s** | **316 ms** |
| szczytowy RSS procesu | 464 MB | 464 MB |

Jeden wpis frekwencji kosztuje **410× mniej** czasu zapisu (1 230 ms → 3 ms) i nie rośnie razem ze
szkołą: dopisujemy ~20 linii po ~280 B zamiast przepisywać 91 MB. p95 pod 20 klientami spada
3,9× przy odczycie rostera i 5,0× przy zapisie frekwencji — bo to nie endpoint był wolny, tylko
zapis, na który czekał cały proces.

Dwie pozycje wypadają gorzej i tak ma być:

* **pełny zapis 1,85 s → 2,86 s.** Nowy silnik zapisuje ~70 plików zamiast jednego, każdy przez
  tmp + `rename`, plus manifest. Zdarza się to przy migracji, przy kompaktowaniu i przy
  `db.compact()`, a nie przy zapisie użytkownika.
* **p95 pojedynczego flusha 59 ms** przy medianie 3 ms — to jedno kompaktowanie, które wypadło
  w oknie pomiaru (20 flushów). Im większa kolekcja, tym rzadziej: przy 324 000 wierszy próg
  20 000 operacji to raz na ~7 dni nauki.

Na mniejszej szkole (20 000 wierszy frekwencji) ta sama różnica: flush 240 ms → 10 ms,
start 537 ms → 183 ms, p95 zapisu 328 ms → 93 ms.


Czytanie: nowy silnik nie zmienia niczego w ścieżce odczytu — te same dane w pamięci, ten sam filtr.
Pisanie: koszt jednego wpisu frekwencji przestał zależeć od wielkości szkoły.

## 9. Kiedy to już nie wystarczy — progi i droga do SQLite

Nowy silnik przesuwa granicę, ale jej nie znosi: **całość nadal jest w pamięci procesu**, a odczyty
nadal są skanami liniowymi. Progi z przeglądu niezawodności zostają, z jedną poprawką — to już nie
`flush()` jest tym, co boli:

| stan | rozmiar / wiersze | co czuć | werdykt |
| --- | --- | --- | --- |
| zielony | ≤ 25 MB / ≤ 75 tys. wierszy | nic | w porządku |
| bursztynowy | 25–64 MB / 75–150 tys. | start procesu ~0,5 s, RSS rośnie | w porządku |
| **czerwony** | **> 64 MB / > 150 tys.** | **skany liniowe w gorących endpointach, pauzy GC, start 1,5 s** | **planuj migrację** |
| stop | > 100 MB / > 500 tys. | p95 odczytu w sekundach, start > 4 s, RSS > 700 MB | migruj teraz |

Szkoła 600-osobowa przekracza bursztyn w **październiku**, czerwony około **listopada** i kończy rok
na ~210 MB / 658 tys. wierszy. Reguła kciuka z pomiarów: **wiersze frekwencji ≈ uczniowie × lekcje
dziennie × dni nauki**, ~320 B na wiersz. Magazyn JSON jest właściwy dla pilotażu i małej szkoły
(≤ 150 uczniów, ≤ 150 tys. wierszy rocznie); nie jest właściwy dla szkoły z brief-u.

**Droga do SQLite** (`node:sqlite` jest w Node 22; na Node 18 ten sam schemat działa z
`better-sqlite3`, co byłoby pierwszą zależnością prototypu — dlatego warto poczekać na nowszy Node,
a nie łamać zasady zero zależności teraz):

1. **API `Store` zostaje.** `col/get/one/find/insert/update/remove/save/flush` to cała powierzchnia
   danych, z której korzystają route'y (`CONTRIBUTING.md`). `Store` oparty o SQLite jest podmianą
   jeden do jednego; żaden route się nie zmienia. Warstwa `Proxy` z §4 wtedy znika — SQLite wie, co
   zostało zapisane, bo zapis idzie przez `UPDATE`.
2. **Jedna tabela na kolekcję**, `CREATE TABLE <col> (id TEXT PRIMARY KEY, doc TEXT NOT NULL)` plus
   kolumny generowane dla pól, po których naprawdę się filtruje:
   `attendance(lessonId, studentId, date, classId)`, `lessons(date, teacherId, classId)`,
   `grades(studentId, subjectId, semester, classId)`, `sessions(token)`, `users(login)`,
   `audit(at, userId, entity)`. Te sześć indeksów usuwa każdy gorący skan z przeglądu.
3. **`PRAGMA journal_mode=WAL; synchronous=NORMAL`** — zapisy schodzą poniżej milisekundy i
   przestają blokować czytających.
4. **Migracja przez `server/lib/migrate.js`**, wersja 3: czyta katalog `school/` ostatni raz,
   wstawia każdą kolekcję w jednej transakcji, stempluje `meta.version = 3` i zostawia katalog jako
   automatyczną kopię. `scripts/backup.js` przechodzi na `VACUUM INTO 'plik.sqlite'`.
5. **Co się nie zmienia:** kształty dokumentów z `CONTRIBUTING.md`, zasada WORM dziennika audytu
   i `db.data.config` jako jedyne miejsce konfiguracji.

Do tego czasu, minimum na VPS: `EDMAT_DATA` na własnym wolumenie, `node --max-old-space-size=1536`
co najmniej, 2 GB RAM (4 GB przy pełnej szkole), nocne `POST /api/admin/retention/run`, sonda
`/api/health`, `stop_grace_period: 60s`, nigdy `kill -9`. W logu obserwuj
`EdMat: dane szkoły zajmują … MB` — to magazyn mówi, że §9 właśnie nadeszło.

## 10. Zmienne środowiskowe

| zmienna | domyślnie | znaczenie |
| --- | --- | --- |
| `EDMAT_DATA` | `./data` | katalog danych (magazyn leży w `<EDMAT_DATA>/school/`) |
| `EDMAT_STORE` | — | `legacy` = stary silnik: jeden `school.json` przepisywany w całości (do porównań) |
| `EDMAT_FSYNC` | — | `1` = `fsync` po każdym dopisie i przed każdym `rename` |
| `EDMAT_MAX_SAVE_DELAY_MS` | `1000` | twardy limit odbicia `save()` (REL-02) |
| `EDMAT_HOT_BYTES` | `4194304` | powyżej tego migawka kolekcji dostaje dziennik dopisywania |
| `EDMAT_COMPACT_OPS` | `20000` | po tylu operacjach w dzienniku migawka jest przepisywana |
