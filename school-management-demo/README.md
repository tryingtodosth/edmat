# EdMat — prototyp dziennika elektronicznego (jedna szkoła, jeden proces)

Prototyp na "stosie EdMat": jeden proces Node 18, zero zależności npm, magazyn JSON, React 18 (UMD, bez bundlera) i pakiet komponentów z systemu projektowego EdMat (`../design-system`). Kryterium odbioru to lista historyjek użytkownika w `../checklist.md`: każda historyjka ma test w `tests/` z jej numerem w nazwie.

## Uruchomienie

```bash
cd prototype
npm start                 # http://localhost:3000, dane w ./data/school/ (plik na kolekcję, patrz docs/STORAGE.md)
npm test                  # node --test tests/
npm run checklist         # raport pokrycia historyjek; `node scripts/checklist-status.js --write` odhacza listy
npm run seed              # ponowny zasiew danych demo
npm run smoke             # przegląd wszystkich ekranów w obu językach (zrzuty i błędy konsoli w smoke-out/)
npm run pilot             # pilotaż: jeden tydzień szkolny od pustej instalacji przez API, inwarianty międzyrolowe (docs/PILOT.md)
npm run bench             # pomiar magazynu (zapis frekwencji, odczyt, kompaktowanie) — liczby z docs/STORAGE.md
EDMAT_DEV=1 npm start     # dodatkowo /api/dev/login?as=<login>&to=/sciezka (tylko do QA)
```

Zmienne: `PORT`, `EDMAT_DATA` (katalog danych), `EDMAT_SECURE_COOKIES=1` (za TLS/reverse proxy: cookie `Secure`, nagłówek HSTS wysyłany przy `X-Forwarded-Proto: https`), `EDMAT_LOG=1`, `EDMAT_TODAY` (data "dziś" dla logiki szkolnej; domyślnie 2026-10-23), `EDMAT_TZ` (strefa czasowa szkoły; domyślnie `TZ`, a bez niej `Europe/Warsaw`), `EDMAT_SEED=blank` (pusta instancja z kreatorem), `EDMAT_DEMO=1` (tryb demo), `EDMAT_DEV=1` (skrót logowania do QA).

Log żądań (`EDMAT_LOG=1`) to jedna linia na żądanie, bez kolorów: znacznik czasu ISO, metoda, **wzorzec trasy** (`/api/registry/students/:id/guardians`, a nie identyfikator ucznia — identyfikatory w tej bazie są slugami z nazwiska, więc sama ścieżka byłaby danymi osobowymi; ścieżka niepasująca do żadnej trasy jest redagowana, query string nie jest logowany w ogóle), status, czas obsługi, `user=` (id konta albo `-`), `req=` (krótki identyfikator żądania, ten sam w nagłówku `X-Request-Id` — przychodzący jest honorowany, gdy pasuje do `^[A-Za-z0-9._-]{4,64}$`) oraz `code=` przy odpowiedzi błędu JSON.

Magazyn: `EDMAT_STORE=legacy` (stary jednoplikowy `data/school.json`), `EDMAT_FSYNC`, `EDMAT_HOT_BYTES`, `EDMAT_COMPACT_OPS`, `EDMAT_MAX_SAVE_DELAY_MS` — opis i wartości domyślne w `docs/STORAGE.md`.

Wydruki PDF: `EDMAT_CHROME` (ścieżka do lokalnego headless Chromium; bez niej `/api/pdf` odpowiada `501 pdf_unavailable` i klient otwiera HTML), `EDMAT_PDF_TIMEOUT` (ms, domyślnie 30000).
Spotkania wideo: `EDMAT_JITSI_DOMAIN`, `EDMAT_JITSI_APP_ID`, `EDMAT_JITSI_APP_SECRET`, `EDMAT_VIDEO_EVENT_SECRET` — szczegóły w `docs/VIDEO.md`.
Osadzanie: `EDMAT_BASE_PATH`, `EDMAT_SSO_SECRET` — szczegóły w `docs/INTEGRATION.md`.

## Eksploatacja (kopie zapasowe, zdrowie procesu, retencja)

```bash
node scripts/backup.js backup --keep 30   # kopia katalogu data/school/ (gzip, jeden plik) do data/backups, rotacja
node scripts/backup.js list               # co mamy
node scripts/backup.js verify <plik>      # czy kopia daje się odczytać
node scripts/backup.js restore <plik> --yes   # odtworzenie (przy zatrzymanym serwerze)
```

Codziennie w cronie o 02:30 i **kopiuj katalog kopii poza VPS** — kopia na tym samym dysku to nie kopia.
**Strefa czasowa.** Cała logika szkolna (dzień „dziś”, terminy zadań, progi godzinowe, cisza nocna)
liczy się czasem ściennym szkoły, nie UTC: obraz kontenera ustawia `TZ=Europe/Warsaw` (`Dockerfile`),
proces może to nadpisać `EDMAT_TZ`, a pojedyncza szkoła — kluczem `config.timezone`. Uruchamiając
serwer poza kontenerem, ustaw `TZ` tak samo — bez tego `today()` po północy pokazuje jeszcze wczoraj.
`GET /api/health` (publiczny, bez danych szkoły) służy jako sonda kontenera; `docker-compose.yml` ma
gotowy `healthcheck` i `stop_grace_period: 60s`, bo zapis dużego pliku danych trwa kilka sekund.
Proces zapisuje dane przy `SIGTERM`/`SIGINT` — nie ubijaj go `kill -9`. Jeden katalog danych obsługuje
**jeden** proces (plik blokady `school.json.lock`). Raz na dobę uruchom nocne sprzątanie dzienników technicznych
`POST /api/admin/retention/run` (`{"confirm":true,"reason":"…"}`), żeby rejestr audytowy i sesje nie
puchły w nieskończoność; brakowanie dokumentacji archiwalnej (kategorie JRWA, zgoda archiwum) idzie
osobną ścieżką z zatwierdzeniem **na cztery oczy** (inne konto zatwierdza, niż układało listę): `docs/RETENTION.md`. Dane leżą w katalogu `data/school/` — jeden plik JSON na kolekcję plus
dziennik dopisywania dla kolekcji pisanych najczęściej, manifest `_store.json` i katalog `files/`
z bajtami, które nie są dokumentami (pakiety archiwalne § 22 i pliki podpisów). **Kopia zapasowa
obejmuje `files/`** — `scripts/backup.js` wkłada je do tego samego jednego `.json.gz` (`_files`),
`verify` mówi, ile ich jest i czy któregoś nie brakuje, a `restore` rozkłada je z powrotem; kopia bez
podpisanego pakietu byłaby gorsza niż jej brak. Stary
`data/school.json` jest wczytywany raz i przemianowany na `school.json.migrated-<data>`. Układ plików,
odtwarzanie po awarii, pomiary i próg przejścia na SQLite: `docs/STORAGE.md` (benchmark:
`npm run bench`), tło: `docs/review/reliability.md`.

## Dokumentacja tematyczna (stan po trzech rundach przeglądu, 23.09.2026)

| dokument | o czym |
| --- | --- |
| `docs/IMPORT.md` | import planu lekcji z prawdziwych formatów: aSc XML, publikacja Optivum (HTML, windows-1250), CSV/JSON; cykl A/B, **grupy z pliku** (piąty rodzaj dopasowania `groups` — etykieta podziału staje się prawdziwą grupą i listą obecności), plan dzwonków z godziną 0 (`PATCH /api/admin/year` z `lessonTimes`), zakładanie przedmiotu i oddziału z tabeli dopasowań (`POST /api/admin/subjects`, `POST /api/admin/classes`, wartość `"@new"`), poprawka pojedynczego wiersza planu (`PATCH /api/admin/timetable/rows/:id`), import jako partia, którą da się cofnąć; **żaden prawdziwy plik szkoły nie był jeszcze widziany** |
| `docs/ARCHIVE.md` | archiwum roczne (§ 22) jako paczka do podpisu zewnętrznego: pakiet **jest** dziennikiem (tematy, frekwencja lekcja po lekcji, uwagi, oceny opisowe, zachowanie, świadectwa, słowniki), filtrowanym do rocznika; termin liczony od **31 sierpnia**; bajty leżą w `data/school/files/`, a w wierszu zostaje `{name, bytes, sha256, path}`; trzy stany podpisu — `digest-matched` (= podpisany), `stored-unverified` (przypomnienie chodzi dalej) i `accepted-unverified` (audytowana decyzja dyrektora); `DELETE` istnieje, `GET …/verify` nic nie zapisuje; otwarte pytanie prawne o podpis zaufany |
| `docs/GUARDIANS.md` | status władzy rodzicielskiej opiekuna (pełna / ograniczona / pozbawiony / ograniczona orzeczeniem) i domyślne zakresy; **jedna bramka** (`D.guardianStanding`) rozstrzyga odczyty, powiadomienia, skrzynkę i oświadczenia woli; zdjęcie ograniczenia wymaga nowej podstawy i kasuje starą; dostęp opiekunów ucznia pełnoletniego jako **decyzja szkoły** (`config.adultAccess`: `until-objection` domyślnie albo `consent-required`) — do weryfikacji z prawnikiem |
| `docs/RETENTION.md` | klasy dokumentacji z kategoriami archiwalnymi (A, B5, B50, 20 lat), zegar od 1 stycznia po roku szkolnym, propozycja → zgoda archiwum → wykonanie **na cztery oczy** (zatwierdza inne konto niż to, które ułożyło listę; `run` zużywa jednorazowy token z zatwierdzenia); protokół i wpis audytowy lądują na dysku **przed** usunięciem; każda tablica w magazynie ma klasę albo jest raportowana jako nieobjęta; kategorii A nigdy nie usuwa |
| `docs/compliance/README.md` | pakiet zgodności generowany z działającej instancji: szablon DPIA, **publiczna** deklaracja dostępności (`GET /api/compliance/accessibility` — bez logowania, z pamięci podręcznej wiązanej z wersją magazynu i z limitem żądań jak przy logowaniu, nigdy z `facts`), szkielet umowy powierzenia (art. 28) z nazwanym podmiotem spoza EOG, gdy push jest włączony; art. 17 (`GET /api/privacy/erasure-policy`, `POST /api/privacy/forget`, `GET /api/privacy/erasures`) anonimizuje w klasach archiwalnych i nie tyka rejestru zdarzeń; to nie jest porada prawna |
| `docs/SIO.md` | co emituje paczka SIO i z jakich kolekcji; samokontrola struktury **bez** walidacji XSD CIE (`schema: not-validated-against-cie-xsd`), ale jej błędy **blokują** pobranie pakietu; uczeń bez PESEL = dokument tożsamości, PESEL nadany w trakcie roku dopisuje się bez utraty numeru księgi (`PATCH …/flags`), a zmiana nazwiska jest trasą z podstawą i historią (`PATCH /api/registry/students/:id/name`) |
| `docs/PUSH.md` | push niesie tylko `{kind, id, ts}` (plus `crisis`), treść pobiera service worker po odbiorze — z czterosekundowym limitem i neutralnym zapasem; lista rodzajów jest pozytywna i sprawa kryzysowa jej nie omija; każdy rodzaj ma neutralne zdanie na ekranie blokady; co widzi pośrednik; iOS zawsze przez Apple |
| `docs/review/round3/README.md` | **strona stanu rundy 3**: wiersz na każde ustalenie (OPS3, S3, U3, D3, R3, H) z tym, co je zamknęło i czym to udowodniono, co zostaje otwarte i dlaczego, oraz lista decyzji dla zespołu, IOD-a, prawnika i archiwum szkoły |
| `docs/research/` | raport z deep research (Gemini, 23.09.2026) i jego triage z ocenami wiarygodności — mapa tego, co trzeba sprawdzić u prawnika i w szkole |
| `tests/fixtures/real-formats/` | realistyczne pliki wejściowe (aSc, Optivum, eksporty naboru/Librus/UONET+, archiwum) z README, które mówi, co jest wiernym schematem, a co rekonstrukcją |

## Konta demo (hasło `Szkola-2026!`)

| login | rola |
| --- | --- |
| `j.nowak` | matematyka, wychowawca 7b |
| `a.wojcik`, `e.krol`, `b.sikora`, `t.gorski`, `k.lis`, `a.mazur`, `i.kaczmarek` | nauczyciele (fizyka/inf., angielski, polski + wych. 7a, chemia/bio, historia/geo + wych. 8b, wf + wych. 3a, edukacja wczesnoszkolna 1a) |
| `dyrektor` | dyrekcja |
| `e.zielinska`, `pedagog`, `pedagog.specjalny`, `logopeda`, `n.wspomagajacy` | zespół pomocy psychologiczno-pedagogicznej |
| `sekretariat`, `admin`, `iod` | sekretariat, administrator, inspektor ochrony danych |
| `swietlica`, `stolowka`, `biblioteka`, `pielegniarka` | moduły uzupełniające |
| `anna.kowalczyk`, `jan.nowak`, … | uczniowie (imię.nazwisko bez znaków diakrytycznych); `aleksandra.borowska` — uczennica pełnoletnia |
| `rodzic.kowalczyk` | rodzic dwojga dzieci (Anna 7b, Piotr 3a); `rodzic.kowalczyk2` — drugi rodzic po rozwodzie, osobne konto |



## Nowa szkoła od zera (kreator pierwszego uruchomienia)

`npm run start:blank` (albo `EDMAT_SEED=blank`) uruchamia pustą instancję: zamiast logowania pojawia się kreator, który w pięciu krokach zakłada szkołę i konto administratora, importuje nauczycieli (CSV; hasła tymczasowe pokazane raz), uczniów z rodzicami (CSV; dwoje opiekunów na wiersz, jednorazowe kody rejestracyjne, walidacja PESEL), wczytuje plan lekcji **tą samą kartą, co administracja** (eksport aSc, katalog publikacji Optivum, CSV/JSON, próbny przebieg i tabela dopasowań) i generuje lekcje — domyślnie **od dnia, w którym szkoła przechodzi**, a nie od 1 września. Do zakończenia kreatora API odpowiada `503 setup_required`. Formaty i kolumny: `GET /api/setup/formats`; co kreator uzna za brak przed zakończeniem (m.in. brak konta dyrektora): `POST /api/setup/finish`. Braki struktury szkoły uzupełnia się bez zaglądania do plików danych: przedmioty (`POST /api/admin/subjects`), oddziały (`POST /api/admin/classes`), plan dzwonków razem z godziną 0 i kotwicą cyklu A/B (`PATCH /api/admin/year` z `lessonTimes`, `weekCycleAnchor`).

## Tryb demo, dwa języki, moduły, osadzanie

- **Demo dla oceniających:** `EDMAT_DEMO=1 npm start` — pasek demo z przełączaniem ról bez haseł, lista „co wypróbować” (historyjki z listy kontrolnej, z oznaczeniem tych pokrytych testami) i formularz opinii. Opinie: `GET /api/feedback`, `GET /api/feedback/export.csv` (dyrekcja, administrator); `POST /api/demo/reset` przywraca dane demo, zachowując opinie.
- **PL/EN:** przełącznik w menu użytkownika i na ekranie logowania, zapis na koncie (`users[].locale`), wymuszenie w adresie `?lang=en`. Dokumenty urzędowe (świadectwa, wydruki) pozostają po polsku.
- **Moduły:** `GET /api/modules`, `PATCH /api/admin/modules` — rdzeń, dziennik, oceny, wychowawca, dyrekcja, pomoc p-p, sekretariat, uczeń, rodzic, wiadomości, moduły szkolne, kursy, spotkania, demo (14 pozycji, `server/modules.js`). Wyłączony moduł znika z nawigacji, a jego API zwraca `404 module_disabled`. Rdzeń, dziennik, ocen, sekretariatu i wiadomości nie da się wyłączyć.
- **Osadzanie w platformie EdMat:** `EDMAT_BASE_PATH=/dziennik` (zasoby, API i service worker pod prefiksem) oraz `EDMAT_SSO_SECRET` + `GET /api/auth/sso?token=…` (token HMAC-SHA256 z `login|email`, `exp`, `nonce`, `locale`, `to`). Szczegóły: `docs/INTEGRATION.md`.
- **Powiadomienia push:** `POST /api/push/config {"enabled":true,"subject":"mailto:…"}` (administrator, dyrekcja) włącza Web Push i generuje klucze VAPID w `config.push.vapid`; użytkownik włącza je u siebie w Ustawieniach. Bez tego dziennik pokazuje powiadomienia wyłącznie po zalogowaniu. Wymaga HTTPS i ruchu wychodzącego na usługi push przeglądarek. Szczegóły: `docs/PUSH.md`.
- **Kontener:** `docker compose up` (patrz `docker-compose.yml`, wolumen `/data`).

## Strona projektu (`/projekt/`) i współpraca nad materiałami

**Strona projektu** — dla ludzi z zewnątrz: co działa, co jest udawane, co jest otwarte i jak dołączyć, obok demo w tej samej instalacji. Źródło w `../landing/` (SvelteKit, prerender do plików statycznych, układ za stroną treści 2donet: nagłówek z definicją i licznikami, „otwarte sprawy” jako pierwsza sekcja, gablota, dwie kolumny z kartami Przegląd / Oś czasu / Zasoby), wynik budowania w `public/projekt/` (pl) i `public/projekt/en/`. Katalog z własnym `index.html` serwer traktuje jak zwykłą stronę statyczną (bez `<base>`, ścieżki względne, więc działa też pod `EDMAT_BASE_PATH`), `/projekt` przekierowuje na `/projekt/`, skrót jedynego skryptu inline (start SvelteKit) trafia z `<meta>` do nagłówka CSP, a service worker nie przechwytuje tej ścieżki. Liczby na stronie pochodzą wyłącznie z `public/projekt/status.json`: `npm run landing:status` generuje go z tego samego przebiegu, co lista kontrolna (cały zestaw testów; `-- --from plik.json` bierze gotowy wynik `checklist-status.js --json`) i podmienia w zbudowanym katalogu bez przebudowy. Przebudowa: `npm run landing:build` (wymaga `npm install` w `../landing`; opis w `../landing/README.md`). Ekran logowania ma odnośnik „O projekcie EdMat”. `GET /api/health` zwraca dodatkowo `demo: true|false`, żeby strona wiedziała, czy wolno jej zaproponować wejście bez hasła.

**Współpraca nad materiałami** (`server/routes/materials.js`, ekran `/wspolpraca`, karta „Materiały z lekcji” w panelu lekcji) — na wzór strony treści w 2donet: materiał ma autora, flagę `coopAllowed` (domyślnie tak; przełącznik w formularzu dodawania i w ustawieniach autora), zgłoszenia współpracowników (`POST`/`DELETE /api/materials/:id/claim` z jednym zdaniem „co zrobię”; autor dostaje powiadomienie rodzaju `material`, tylko w aplikacji), opis dla współpracowników, dyskusję przez wspólny mechanizm komentarzy (`/api/log-comments/materials/:id`) i oś czasu z rejestru zdarzeń (pobrania uczniów wchodzą tylko jako liczba). `GET /api/materials` (metadane, nigdy `dataUrl`; `filter=open|mine|claimed`, `lessonId`, `subjectId`), `GET /api/materials/:id/details`, `PATCH /api/materials/:id` (autor albo dyrekcja: `coopAllowed`, `description`, `name`). Role: nauczyciele i kadra pedagogiczna; sekretariat, administrator, uczniowie i rodzice nie widzą współpracy, a pobieranie przez uczniów (`GET /api/materials/:id`) się nie zmienia. Testy: `tests/61-landing.test.js`, `tests/62-materials-coop.test.js`.

## Architektura

- `server/index.js` — serwer HTTP, pliki statyczne, nagłówki bezpieczeństwa (CSP, HSTS za TLS, nosniff, frame-ancestors), dispatch `/api/*`, sesje z 15-minutowym limitem bezczynności.
- `server/auth.js` — logowanie (scrypt), TOTP (RFC 6238), polityka haseł, lista dozwolonych IP dla administratora, unieważnianie sesji.
- `server/lib/` — magazyn JSON z zapisem atomowym i podziałem na pliki kolekcji (`store.js`, migracja `migrate.js`), rejestr audytowy tylko-do-dopisywania, kryptografia (szyfrowanie notatek dla wskazanych czytelników RSA-OAEP + AES-GCM, pieczęć archiwum), narzędzia domenowe (PESEL, średnie ważone z regułą poprawy, statystyki frekwencji, czas ścienny szkoły, bramka odczytu karty ucznia), walidator załączników (`uploads.js` — typ, sygnatura, rozmiar), Web Push (`webpush.js` — klucze VAPID, token ES256, szyfrowanie RFC 8291), generator PDF (`pdf.js`, lokalny headless Chromium) i budowanie adresów/JWT spotkań wideo (`video.js`, bez ruchu sieciowego).
- `server/seed/` — zasiew jednej szkoły (SP nr 12 w Krakowie): konfiguracja, użytkownicy, klasy, uczniowie, plan lekcji, lekcje, kategorie ocen, podstawa programowa; kolejne pliki dokładają domeny.
- `server/routes/` — moduły API per domena (frekwencja, lekcje, oceny, wychowawca, dyrekcja, zastępstwa, pomoc p-p, sekretariat, administracja, uczeń, rodzic, wiadomości, moduły szkolne, prywatność).
- `public/` — powłoka aplikacji (`app/core.js`, `app/shell.js`), ekrany per rola (`app/screens/*.js`, sklejane przez serwer w `/app/screens.js`), pakiet EdMat (`edmat/`), React (`vendor/`), service worker z trybem offline, kolejką wpisów i obsługą powiadomień push.
- `tests/` — testy `node:test` uruchamiające serwer w pamięci; nazwy testów niosą numery historyjek `[3.1.4]`.

Szczegóły konwencji: `CONTRIBUTING.md`.

## Kursy

Moduł „Kursy” (`courses`) to lekki LMS wbudowany w dziennik: nauczyciel układa kurs z jednostek i elementów (tekst w lekkim markdownie, materiał z dziennika, odnośnik, zadanie domowe, quiz, spotkanie wideo), otwiera kolejne jednostki datą, publikuje kurs i jednym kliknięciem zapisuje na niego cały oddział — albo ustawia kurs jako otwarty, na który uczniowie zapisują się sami. Uczeń przechodzi kurs krok po kroku, oznacza elementy jako zrobione, pobiera materiały, oddaje pracę w sekcji zadań domowych i rozwiązuje quizy sprawdzane automatycznie (poprawne odpowiedzi pokazują się dopiero po oddaniu, z limitem podejść); po zaliczeniu wszystkich elementów obowiązkowych pobiera zaświadczenie o ukończeniu gotowe do wydruku. Nauczyciel widzi dziennik postępów całej grupy (procent ukończenia, wyniki quizów, status oddania zadań) i może przenieść wynik quizu do ocen cząstkowych w kategorii „quiz” — przez tę samą logikę co zwykły wpis oceny. Każdy kurs ma własną dyskusję, w której nauczyciel przypina i zamyka wątki, a rodzic ma wyłącznie podgląd postępów swojego dziecka. Wszystkie zapisy trafiają do rejestru audytowego; wyłączenie modułu w „Modułach” ukrywa zarówno ekran, jak i API. Szczegóły: `docs/COURSES.md`.

## Co jest symulowane

- PDF jest prawdziwy, jeśli na serwerze jest lokalny headless Chromium: `GET /api/pdf?path=<ścieżka wydruku>` przepuszcza ten sam wydruk przez tę samą sesję i te same uprawnienia, a potem drukuje go do PDF (`server/lib/pdf.js`, `EDMAT_CHROME`). Bez przeglądarki odpowiedź to `501 pdf_unavailable` z `fallbackUrl`, a klient otwiera dokument HTML gotowy do druku — tak samo jak wcześniej. XML i CSV są prawdziwe.
- Kwalifikowana pieczęć elektroniczna to pieczęć RSA-SHA256 kluczem szkoły (weryfikowalna), nie usługa kwalifikowana. **Podpis dołączony do pakietu § 22 jest sprawdzany wyłącznie skrótem**: jeżeli w pliku podpisu znajdziemy skrót naszego manifestu albo naszego ZIP-a, stan brzmi `digest-matched` i dopiero wtedy rocznik liczy się jako podpisany. Nie sprawdzamy ścieżki certyfikacji, nie orzekamy, czy podpis jest kwalifikowany, i nie rozstrzygamy, który rodzaj spełnia § 22 (`docs/ARCHIVE.md`). Wszystko inne to `stored-unverified` — przypomnienie o terminie chodzi dalej, dopóki dyrektor świadomie nie odnotuje „przyjęty bez weryfikacji" z uzasadnieniem.
- Paczka SIO powstaje z prawdziwych danych i przechodzi **naszą** kontrolę struktury, ale **nie jest walidowana schematem XSD z CIE** — odpowiedź mówi to wprost (`schema: not-validated-against-cie-xsd`). Błąd naszej kontroli blokuje pobranie, zgodność ze schematem CIE potwierdzi dopiero pierwsza wysyłka (`docs/SIO.md`).
- Przynależność ucznia do grupy z importu jest **zgadywana z pliku**. Eksport planu niesie etykietę podziału („1. grupa", „ang-2"), a nie identyfikator grupy w dzienniku; etykieta staje się prawdziwą grupą i prawdziwą listą obecności dopiero wtedy, gdy administrator zaakceptuje dopasowanie w tabeli `groups`. Dopóki tego nie zrobi, lekcja dzielona ma na liście cały oddział, a nic w pliku nie potwierdza, że podział w planie odpowiada podziałowi w szkole (`docs/IMPORT.md`).
- Pakiet archiwalny jest ZIP-em bez kompresji (metoda „stored"): dla rocznika 600 uczniów to ~48 MB XML-a i tyle samo ZIP-a. To świadoma decyzja — deflate zmniejszyłby plik kilkunastokrotnie, ale zmienia kontrakt zapisu.
- Powiadomienia push są prawdziwe: Web Push (RFC 8030/8291/8292) bez żadnej zależności npm i bez SDK dostawcy — klucze VAPID generuje `node:crypto`, ładunek jest szyfrowany end-to-end kluczami subskrypcji, a usługa push producenta przeglądarki przenosi wyłącznie szyfrogram. Domyślnie **wyłączone** (`config.push.enabled = false`); włącza je administrator albo dyrekcja (`POST /api/push/config`). Czego push **nie** załatwia: włączenie go daje szkole podmiot przetwarzający poza EOG (usługa push producenta przeglądarki — Google, Apple), więc umowa powierzenia musi go nazwać razem z podstawą przekazania; treść na ekranie blokady jest z tego powodu celowo neutralna i nie wymienia ucznia. Szczegóły, prywatność i wsparcie przeglądarek: `docs/PUSH.md`.
- Alerty opisane w historyjkach jako „natychmiastowe” i „w czasie rzeczywistym” (nieobecność na 1. lekcji, 3 dni nieobecności ucznia objętego pomocą społeczną) powstają **w chwili zapisu frekwencji** — podnosi je zapis w `server/routes/attendance.js`, nie odczyt u rodzica czy pedagoga (`[3.7.2]`, `[3.4.15]`). „Natychmiast” znaczy więc: wiersz powiadomienia istnieje, zanim zapis wróci do nauczyciela — a przy włączonym push trafia stamtąd prosto na telefon rodzica (poza ciszą nocną, której sprawy kryzysowe nie dotyczą).
- **Nie ma planisty.** Przypomnienie o terminie z § 22 (3. i 8. dzień po zakończeniu roku) powstaje przy wejściu dyrektora na kartę archiwum, a nocne sprzątanie dzienników technicznych trzeba wywołać cronem (`POST /api/admin/retention/run`). Jeden proces i zero zależności znaczy też: zero zadań w tle poza tymi, które podnosi żądanie.
- Program **nie prowadzi protokołów rady pedagogicznej** ani ksiąg finansowych — zostają w szkole i w systemie organu prowadzącego. Uchwały klasyfikacyjne dziennik zna wyłącznie jako numer przy zamknięciu semestru (`docs/RETENTION.md`).
- Płatności są rejestrowane w prototypie bez operatora płatności.
- Kod autoryzacyjny do aplikacji mObywatel (`[3.5.2]`) jest generowany lokalnie; prototyp nie łączy się z żadną usługą państwową.
