# Powiadomienia push (Web Push) — jak działają i co widzi pośrednik

Rodzic ma się dowiedzieć o nieobecności na 1. lekcji **wtedy, kiedy ona nastąpi**, a nie przy
następnym zalogowaniu. Robi to Web Push: standard W3C/IETF wbudowany w przeglądarki, bez żadnej
biblioteki npm i bez SDK dostawcy. Cały kod to `server/lib/webpush.js` (kryptografia i wysyłka),
`server/routes/notifications.js` (subskrypcje, kolejka, rejestr doręczeń), `public/sw.js`
(service worker) i `EdApp.push` w `public/app/core.js`.

Domyślnie **wyłączone**: `config.push.enabled = false`. Przy wyłączonym push z procesu nie wychodzi
ani jeden bajt — powiadomienia istnieją wyłącznie w dzienniku.

Od pakietu R6 (raport Gemini #20) w zaszyfrowanym ładunku nie ma **żadnej treści**: jedzie w nim
`{v: 2, kind, id, ts}`, a tytuł i treść service worker pobiera z serwera szkoły dopiero po
odebraniu powiadomienia. Pośrednik — FCM, Mozilla, APNs — nie dostaje nawet szyfrogramu imienia
dziecka. Co dokładnie mu zostaje: [Co widzi pośrednik](#co-widzi-pośrednik).

## Droga jednego powiadomienia

```
zapis frekwencji  →  createNotification(…, { push: true, crisis: true })
                        │
                        ├─ cisza nocna i nie-kryzys?  → wiersz czeka (deliverAt = koniec ciszy)
                        │
                        ├─ jitterSeconds > 0 i nie-kryzys?  → losowe opóźnienie 0…N sekund
                        │
                        └─ kolejka w procesie → pushDeliveries {status: pending}
                                 │
                                 │  ładunek: {"v":2,"kind":"absence","id":"not_…","ts":1761…,"crisis":true}
                                 │  szyfrowanie RFC 8291 kluczami subskrypcji (p256dh + auth)
                                 │  nagłówek Authorization: vapid t=<JWT ES256>, k=<klucz szkoły>
                                 ▼
                        POST https://fcm.googleapis.com/… (usługa push przeglądarki)
                                 │  201 → sent · 404/410 → gone (subskrypcja usunięta)
                                 │  429/5xx → retry (1 s, 5 s, 30 s, 2 min, 10 min) · 4xx → failed
                                 ▼
                        przeglądarka → service worker (zdarzenie `push`, public/sw.js)
                                 │
                                 │  GET /api/notifications/<id>/render?locale=pl
                                 │      credentials: 'include' — ciasteczko sesji, ten sam origin
                                 │      AbortSignal.timeout(4000) — szkoła ma cztery sekundy
                                 │
                                 ├─ 200 → showNotification(neutralny tytuł i neutralne zdanie
                                 │          ZE SZKOŁY, w języku konta, odnośnik prosto do sprawy)
                                 │
                                 └─ offline · 401 · 403 · 5xx · brak odpowiedzi w 4 s →
                                            showNotification(neutralny tytuł rodzaju z tabelki
                                            w sw.js + akcja „Otwórz EdMat”; przy sprawie
                                            kryzysowej także dopisek „· pilne”, wibracja
                                            i requireInteraction — o tym mówi bit `crisis`
                                            w ładunku oraz wspólna lista `CRISIS_KINDS`).
                                            Nigdy „nic”: cichy push przeglądarka karze (Chrome
                                            pokazuje „Ta witryna została zaktualizowana w tle”,
                                            Firefox po kilku takich zdarzeniach kasuje subskrypcję).
                                 ▼
                        kliknięcie → `notificationclick` → karta dziennika na trasie z powiadomienia;
                        gdy sesji już nie ma, ta sama trasa ląduje na bramce logowania i czeka
                        w adresie (`#/rodzic?…&login=1`) — po zalogowaniu użytkownik jest na miejscu.
```

### Szyfrowanie (RFC 8291, `aes128gcm` z RFC 8188)

Przeglądarka przy subskrypcji oddaje trzy rzeczy: adres endpointu swojej usługi push, klucz
publiczny `p256dh` (P-256, 65 B) i 16-bajtowy sekret `auth`. Serwer szkoły dla **każdej** wiadomości:

1. losuje efemeryczną parę P-256 (klucz serwera aplikacji, „as”) i 16-bajtową sól,
2. `ecdh_secret = ECDH(as_private, ua_public)`,
3. `PRK_key = HMAC-SHA-256(auth, ecdh_secret)`, `key_info = "WebPush: info" ‖ 0x00 ‖ ua_public ‖ as_public`,
   `IKM = HMAC-SHA-256(PRK_key, key_info ‖ 0x01)`,
4. `PRK = HMAC-SHA-256(salt, IKM)`, z niego `CEK` (16 B) i `NONCE` (12 B) przez etykiety
   `"Content-Encoding: aes128gcm"` i `"Content-Encoding: nonce"`,
5. szyfruje AES-128-GCM treść zakończoną ogranicznikiem `0x02` (jeden rekord, `rs = 4096`),
6. skleja nagłówek `salt ‖ rs ‖ długość klucza ‖ as_public` z szyfrogramem i tagiem.

Klucz prywatny efemerydy nigdy nie opuszcza procesu i ginie po wysyłce; odszyfrować może wyłącznie
ta przeglądarka, która ma prywatny odpowiednik `p256dh`. **Zgodność sprawdza test**: `encrypt()`
przyjmuje sól i klucz serwera, więc wynik jest deterministyczny i `tests/48-push.test.js` porównuje
go **bajt w bajt** z wektorem z RFC 8291 Appendix A („When I grow up, I want to be a watermelon”),
a dodatkowo odszyfrowuje go niezależnym deszyfratorem napisanym z treści RFC.

### VAPID (RFC 8292)

Usługa push musi wiedzieć, kto wysyła — inaczej każdy, kto zna adres endpointu, mógłby wysyłać
powiadomienia w imieniu szkoły. Szkoła ma więc własną parę kluczy P-256 i dokłada do każdego
żądania nagłówek:

```
Authorization: vapid t=<JWT ES256: {aud: origin usługi push, exp ≤ 24 h, sub: mailto:…}>, k=<publicKey>
```

Ten sam `publicKey` dostaje przeglądarka jako `applicationServerKey` — subskrypcja jest z nim
związana. Klucze powstają raz, przy włączaniu push, i leżą w **osobnej kolekcji** `pushKeys`
(`{ id: 'vapid', publicKey (surowy punkt 65 B w base64url), privateKey (PEM), subject, createdAt }`),
a nie w `config`: cała konfiguracja szkoły jedzie do każdego zalogowanego klienta w
`/api/auth/session`, więc klucz prywatny w niej byłby kluczem prywatnym w przeglądarce każdego
rodzica. W `config.push` zostaje tylko to, co publiczne: `enabled`, `subject`, `publicKey`, `ttl`,
`maxAttempts`, `releaseWindowHours`, `payload`, `jitterSeconds`, `kinds`. Podmiana
(`POST /api/push/config {regenerateKeys:true}`) unieważnia wszystkie istniejące subskrypcje —
i dlatego usuwa je z bazy, razem z wpisem w rejestrze zdarzeń: wiersz, do którego usługa push
odpowiada odtąd 403, pokazywałby rodzicowi „urządzenie zarejestrowane”, choć nic już nie dochodzi
(przeglądarka zarejestruje się ponownie przy następnym otwarciu dziennika).

## Co widzi pośrednik

Między szkołą a telefonem stoi usługa push producenta przeglądarki (Google FCM dla Chrome,
Mozilla autopush dla Firefoksa, Apple APNs dla Safari). Od R6 ładunek nie niesie już ani tytułu,
ani treści, ani odnośnika — tylko `{v, kind, id, ts, crisis}`. Pośrednikowi zostaje więc **tożsamość
urządzenia, rozmiar i czas**, i nic ponadto:

| co | co z tego wynika | co z tym robimy |
| --- | --- | --- |
| **adres endpointu** — losowy identyfikator urządzenia nadany przez samą usługę | „to konkretne urządzenie dostaje powiadomienia z tej szkoły”; pośrednik i tak zna urządzenie, bo sam je zarejestrował | nic się nie da: bez endpointu nie ma dostarczenia. U nas nie wychodzi poza proces (w audycie i statystykach host + 8 znaków skrótu) |
| **klucz publiczny VAPID szkoły i jej `mailto:`** | „nadawcą jest ta szkoła” | z definicji jawne — po to jest VAPID (inaczej każdy, kto zna endpoint, wysyłałby w imieniu szkoły) |
| **rozmiar szyfrogramu** | kilkadziesiąt bajtów, praktycznie stałe: ~145 B nagłówka + tagu i ~55–65 B ładunku. Różnica między rodzajami to kilka bajtów (`absence` vs `ack`) | wystarczy do zgadywania rodzaju tylko teoretycznie; dopełnienie rekordu do stałej długości (RFC 8188) domknęłoby to i jest naturalnym następnym krokiem — świadomie **nie** ruszamy dziś ścieżki szyfrowania, bo trzyma ją wektor testowy |
| **czas wysyłki** | „o 8:05 szkoła wysłała coś do tego telefonu” — czyli: dziecko nie przyszło na 1. lekcję | temu służy `config.push.jitterSeconds` (niżej); alert kryzysowy z założenia **nie** jest rozmywany |
| **nagłówki `TTL`, `Urgency`, `Topic`** | `Urgency: high` zdradza „to pilne” | `high` dajemy wyłącznie sprawom kryzysowym, `Topic` tylko tam, gdzie naprawdę trzeba zastąpić starsze powiadomienie |

**Nie widzi**: kogo dotyczy (ani imienia, ani identyfikatora ucznia), czego dotyczy poza samym
`kind`, treści powiadomienia, odnośnika, tematu wiadomości, ocen, frekwencji. Nie widzi też, czy
powiadomienie zostało w ogóle wyświetlone — to już rozmowa service workera ze szkołą.

Czego **nie** ukrywa minimalizacja: `kind` zostaje w ładunku (worker musi mieć co pokazać, gdy
szkoła jest nieosiągalna), a `id` powiadomienia jest dla pośrednika losowym ciągiem — ale gdyby
kiedyś wyciekł razem z bazą, wskazuje konkretny wiersz. Dlatego `id` jest nieodgadywalnym
identyfikatorem `not_…`, a `GET /api/notifications/:id/render` odpowiada **403** na cudzy wiersz.

## Pobranie treści po odebraniu (fetch on receipt)

Ładunek mówi tylko „zdarzyło się coś rodzaju *absence*, wiersz `not_abc`”. Resztę service worker
dobiera sobie ze szkoły:

```
GET /api/notifications/not_abc/render?locale=pl      (credentials: 'include')
→ 200 { id, kind, locale, title, body, link, crisis, at, read }
```

- **Uwierzytelnienie to ciasteczko sesji**, dokładnie to samo co w całej aplikacji (`edmat_sid`,
  HttpOnly, SameSite=Strict — `public/app/core.js` woła `fetch` z `credentials: 'same-origin'`,
  bo nigdzie nie ma nagłówka z tokenem). Żądanie workera idzie na **ten sam origin** co strona,
  więc `SameSite=Strict` go nie blokuje; `credentials: 'include'` jest konieczne, bo `fetch`
  w service workerze domyślnie nie dokłada ciasteczek.
- `locale` worker podaje tylko wtedy, gdy wie, w jakim języku ostatnio chodziła aplikacja
  (strona mówi mu to wiadomością `{type:'session'|'locale', locale}`). Bez tego parametru tytuł
  i treść składa serwer w języku konta (`users[].locale`).
- Trasa ma `noTouch`: powiadomienie o 3 w nocy **nie przedłuża** 15-minutowej sesji z wieczora
  i nie oznacza powiadomienia jako przeczytane.
- **Szkoła ma na odpowiedź cztery sekundy** (`RENDER_TIMEOUT_MS`, `AbortSignal.timeout`). Bez
  terminu zdarzenie `push` nie kończyło się wcale, gdy proces szkoły był zajęty — a to jest
  dokładnie ta chwila, w której właśnie poszła cała fala powiadomień (raport reliability R3-10).
  Przekroczony termin to zwykły przypadek zapasowy, nie błąd: pokazujemy tytuł rodzaju.
- Gdy odpowiedzi nie ma (brak sieci, 401, 403, 5xx, przekroczony termin), worker pokazuje
  **neutralny tytuł rodzaju** z tabelki `PUSH_FALLBACK` w `public/sw.js` (oba języki, wszystkie
  rodzaje z listy pozytywnej), zdanie „Masz nowe powiadomienie” i akcję **„Otwórz EdMat”**.
  Przy sprawie kryzysowej tytuł dostaje dopisek „· pilne”, a treść brzmi „Pilna sprawa
  w dzienniku — otwórz, żeby sprawdzić frekwencję”: alert, którego nie dało się dopytać,
  nie ma prawa wyglądać jak zwykłe powiadomienie. Pustego push nie ma
  nigdy — przeglądarki karzą ciche zdarzenia (Chrome dokłada własne „Ta witryna została
  zaktualizowana w tle”, Firefox po kilku takich zdarzeniach kasuje subskrypcję).
- Po 401/403 (sesja wygasła) kliknięcie prowadzi na tę samą trasę z dopiskiem `login=1`: bramka
  logowania renderuje się nad trasą trzymaną w adresie, więc po zalogowaniu użytkownik ląduje
  dokładnie tam, gdzie prowadziło powiadomienie.

Koszt: powiadomienie wymaga **jednego żądania do szkoły w momencie odebrania**. Telefon w zasięgu
zrobi je w kilkadziesiąt milisekund; telefon bez zasięgu zobaczy tytuł rodzaju zamiast treści.
Szkoła, która woli treść w ładunku, przełącza `config.push.payload` na `neutral` (niżej).

## iOS: jak to jest naprawdę

- Web Push na iOS/iPadOS działa **od 16.4** i **wyłącznie** dla dziennika dodanego do ekranu
  początkowego (PWA). W samej karcie Safari nie ma ani `PushManager`, ani zgody na powiadomienia.
- Doręczenie zawsze idzie przez **APNs Apple'a** — inaczej się nie da: to jedyny kanał budzenia
  aplikacji na iOS. Standard (RFC 8030/8291) jest zachowany, więc nasz kod się nie zmienia, ale
  pośrednikiem jest Apple i widzi to, co w tabelce wyżej.
- Zgody trzeba poprosić **z gestu użytkownika** (dotknięcie przełącznika), a subskrypcja ginie,
  gdy użytkownik usunie ikonę z ekranu początkowego — wtedy endpoint zaczyna odpowiadać 410
  i kolejka sama kasuje wiersz.
- Powiadomienia nie ma na starszych iOS, w trybie prywatnym i w przeglądarkach bez Push API;
  dziennik mówi o tym wprost i zostaje przy powiadomieniach w aplikacji.
- Minimalizacja ładunku ma na iOS dodatkowy sens: Apple widzi wtedy dokładnie tyle samo, co
  Google, czyli identyfikator urządzenia, rozmiar i czas — a nie imię dziecka.

## Dwa przełączniki prywatności

| klucz | domyślnie | co robi | kiedy zmieniać |
| --- | --- | --- | --- |
| `config.push.payload` | `'minimal'` | `minimal` → ładunek to `{v:2, kind, id, ts, crisis}`, treść pobiera worker. `neutral` → ładunek znowu niesie `title`, `body` (neutralną dla wiadomości), `link`, `tag`, `kind`, `crisis`, `at` | **Zostaw `minimal`.** `neutral` znaczy, że treść — choć zaszyfrowana — jedzie przez cudzy serwer i leży w jego kolejce do końca `TTL` (do 24 h), a każde jej odszyfrowanie zależy już tylko od bezpieczeństwa klucza w przeglądarce. Jedyny powód, żeby przełączyć: szkoła, w której rodzice mają telefony bez stałego dostępu do sieci szkoły (VPN, sieć tylko w budynku) i „Nieobecność w szkole” bez treści byłoby dla nich bezużyteczne |
| `config.push.jitterSeconds` | `0` (wyłączony) | opóźnia doręczenie **nie-kryzysowe** o losowe 0…N sekund (jedno losowanie na powiadomienie, więc wszystkie urządzenia konta brzęczą razem). Sprawa kryzysowa nie czeka ani sekundy | Włącz (np. 300–900), jeśli szkoła uznaje, że sam **czas** wysyłki zdradza za dużo: pośrednik widzi „o 8:05 szkoła wysłała coś do tego telefonu”, a to przy 1. lekcji jest prawie równoznaczne z „dziecko nie przyszło”. Cena: powiadomienie o zadaniu domowym czy płatności przychodzi do kilkunastu minut później. Cisza nocna działa niezależnie: termin, który wypadłby w oknie ciszy, jest przycinany do zera, więc rozrzut nigdy nie przenosi powiadomienia w noc |

Obu pilnuje `POST /api/push/config` (`{payload, jitterSeconds}`, administrator albo dyrekcja);
nieznany tryb ładunku to `400 bad_payload_mode`, `jitterSeconds` jest przycinane do 0…3600.

## Prywatność, w tym danych dzieci

- Ładunek niesie **wyłącznie** `{v: 2, kind, id, ts, crisis}` — ani imienia, ani przedmiotu, ani
  jednego zdania treści (`config.push.payload = 'minimal'`, domyślnie). `crisis` to jeden bit,
  a nie dana osobowa: pośrednik i tak widzi `Urgency: high`, a bez niego telefon bez zasięgu do
  szkoły pokazywał alert o nieobecności jak zwykłe powiadomienie. Tytuł i treść service worker
  pobiera przez `GET /api/notifications/:id/render` — i **nie** są to słowa z dziennika, tylko
  zdanie neutralne dla danego rodzaju (niżej).
- Na ekranie blokady widać treść (tę pobraną ze szkoły), więc lista rodzajów, które wolno wysłać,
  jest **pozytywna** i sprawdzana **jako pierwsza — także dla sprawy kryzysowej**. Do R6 włącznie
  `pushableKind` zaczynał się od `if (n.crisis) return true;`, co omijało listę w całości: alert
  frekwencyjny pedagoga („Uczeń objęty pomocą społeczną: <imię nazwisko>…”) trafiał na ekran
  blokady o każdej porze i z `Urgency: high`. Kryzys omija dziś **wyłącznie ciszę nocną**.
  (`PUSH_KINDS`, `config.push.kinds` może listę **tylko zawęzić** — wartość spoza `PUSH_KINDS`
  jest ignorowana): nieobecność, plan lekcji, usprawiedliwienie,
  płatność, stołówka, wycieczka, spotkanie, biblioteka, zadanie domowe, potwierdzenie odbioru,
  wiadomość i test. Nowy, nieznany rodzaj **nie** zacznie się sam wyświetlać nad zablokowanym
  telefonem, a notatki pomocy psychologiczno-pedagogicznej, gabinet pielęgniarki i oceny
  z uzasadnieniem nie są na liście w ogóle. Powiadomienia tworzone przez `D.notify` (domain.js)
  omijają kolejkę i zostają w dzienniku.
- **Każdy** rodzaj ma swoje zdanie neutralne (`PUSH_NEUTRAL`, oba języki, wiersz dla każdego
  wpisu z `PUSH_TITLES`), i to ono — a nie treść z dziennika — jest tym, co wychodzi z `/render`.
  Do R6 neutralizowana była wyłącznie **wiadomość**, a jedenaście pozostałych rodzajów szło na
  ekran blokady dosłownie: powód nieobecności (dane o zdrowiu), kwota zaległości za obiady,
  temat wiadomości, imię i nazwisko ucznia (S3-16, D3-34). Ekran blokady widzi każdy, kto stoi
  obok telefonu, a przy sprawie kryzysowej powiadomienie zostaje na nim do dotknięcia.
- **Imienia dziecka nie ma już nigdzie po drodze**: ani w ładunku, ani w odpowiedzi `/render`,
  ani na ekranie blokady. Rodzic z dwójką dzieci dowiaduje się, o które chodzi, po otwarciu
  dziennika — odnośnik prowadzi prosto do sprawy. Szkoła, która woli imię na ekranie telefonu,
  musi świadomie zmienić `PUSH_NEUTRAL` w `server/routes/notifications.js`; test
  `tests/48-push.test.js` sprawdza wtedy każdy rodzaj i powie, co wyszło.
- Subskrypcja to dane osobowe (identyfikator urządzenia). Trzymamy: `endpoint`, `keys`, nazwę
  przeglądarki/urządzenia i datę. Rejestracja, wypisanie i usunięcie martwej subskrypcji są
  audytowane, ale w audycie i w statystykach zostaje **host + 8-znakowy skrót**, nigdy pełny adres.
- Każdy użytkownik wypisuje się jednym przełącznikiem (Ustawienia → Powiadomienia push), a wtedy
  subskrypcja jest **usuwana**, nie oznaczana jako nieaktywna.
- Uczniowie mają dokładnie te same reguły co dorośli: ta sama lista rodzajów, ta sama zgoda
  przeglądarki i ta sama możliwość wyłączenia. Szkoła, która nie chce wysyłać push uczniom,
  usuwa rodzaje z `config.push.kinds` albo zostawia im wyłącznie powiadomienia w dzienniku.
- Cisza nocna (`users[].quietHours`) wstrzymuje wysyłkę do rana; przechodzą tylko powiadomienia
  kryzysowe (`crisis: true`), czyli dziś alert o nieobecności na 1. lekcji. Rozrzut czasowy nie
  może wepchnąć powiadomienia w to okno: termin wypadający w ciszy jest przycinany do zera
  (liczone w strefie szkoły, `D.inQuietHours`, nie w strefie procesu).
- Lista rodzajów kryzysowych (`CRISIS_KINDS`) jest **jedna**: `server/routes/notifications.js`
  ją eksportuje, `public/sw.js` ma jej kopię, a test parzystości nie pozwala im się rozjechać.

## Cisza nocna i odłożone powiadomienia

Powiadomienie utworzone w ciszy nocnej dostaje `deferred: true` i `deliverAt` = koniec okna
(liczony w strefie szkoły, więc okno przez północ kończy się rano, także w noc zmiany czasu).
Nie ma osobnego wątku ani crona: **sprawdzenie jest leniwe** — `sweepDeferred()` uruchamia się przy
każdym żądaniu `/api/notifications/feed`, przy operacjach `/api/push/*` oraz przy tworzeniu
kolejnego powiadomienia (nie częściej niż raz na 30 s w procesie). Zwalniane jest tylko to, co
dojrzało w ciągu ostatnich `config.push.releaseWindowHours` (domyślnie 24) godzin — alert sprzed
tygodnia nie ma prawa zabrzęczeć w telefonie po ponownym włączeniu push.

To świadomy kompromis prototypu: dostarczenie po ciszy nocnej czeka na pierwsze żądanie do serwera
(w praktyce: pierwsze otwarcie dziennika przez kogokolwiek). W instalacji produkcyjnej wystarczy
dołożyć `setInterval` wywołujący `sweepDeferred(db, true)` co minutę — kolejka i rejestr doręczeń
są już na to gotowe.

### Restart w środku rozrzutu

Zadanie z rozrzutem czeka w pamięci procesu, ale jego ślad — wiersz `pushDeliveries` ze statusem
`pending` i zapisanym `notBefore` — jest w bazie. Przy pierwszym zamiataniu po starcie
(`resumePending`, wołane z `sweepDeferred`) proces wraca do tych wierszy:

- powiadomienie wciąż w oknie `releaseWindowHours` → zadanie wraca do kolejki z zapamiętanym
  terminem, więc rozrzut nie zaczyna się od zera i nie zamienia się w falę tuż po restarcie;
- powiadomienie poza oknem (albo już go nie ma) → wiersz zostaje zamknięty jako `failed`
  z powodem „restart procesu poza oknem zwalniania — nie wysłano”. Wiersz `pending` na zawsze
  czytałby się jak „wysłaliśmy i nie znamy odpowiedzi”, a to nieprawda: nigdy nie wyszło (R3-11).

Wznowienie jest leniwe dokładnie tak jak zamiatanie: dzieje się przy pierwszym żądaniu
`/api/notifications/feed` albo `/api/push/*` po starcie, nie w `createApp`.

## API

| metoda | ścieżka | kto | po co |
| --- | --- | --- | --- |
| GET | `/api/notifications/:id/render` | właściciel wiersza | tytuł, treść i odnośnik dla service workera (`?locale=pl\|en`); cudzy wiersz → **403**, nieznany → 404; `noTouch` (nie przedłuża sesji, nie oznacza jako przeczytane) |
| GET | `/api/push/vapid-public-key` | każde konto | `{enabled, publicKey}` do `PushManager.subscribe` |
| POST | `/api/push/subscribe` | każde konto | `{endpoint, keys:{p256dh, auth}, userAgent}`; deduplikacja po endpoincie |
| DELETE | `/api/push/subscribe` | każde konto | `{endpoint}` albo bez ciała = wszystkie urządzenia konta |
| GET | `/api/push/subscriptions` | każde konto | lista urządzeń (host + skrót, nigdy pełny adres) |
| POST | `/api/push/test` | każde konto | powiadomienie próbne na własne urządzenia |
| GET | `/api/push/stats` | administrator, dyrekcja | liczniki doręczeń, usługi push, kolejka |
| POST | `/api/push/config` | administrator, dyrekcja | `{enabled, subject, ttl, payload, jitterSeconds, regenerateKeys}` (rodzaje: `config.push.kinds`) |

Starsza ścieżka z sekcji 3.6 (`POST /api/notifications/push/register`, `GET /api/notifications/push`,
`DELETE /api/notifications/push/:id`) działa dalej i zapisuje do tej samej kolekcji.

Kolekcje: `pushKeys` (jeden wiersz z parą kluczy szkoły), `pushSubscriptions` `{id, userId, endpoint, keys:{p256dh, auth}, device, at, revoked}`
oraz `pushDeliveries` `{id, notificationId, userId, subscriptionId, endpoint, status, at, attempts,
code, error, kind, crisis}`, gdzie `status` ∈ `pending | sent | retry | failed | gone`.

## Włączenie w szkole

```bash
# administrator albo dyrekcja, po zalogowaniu
curl -X POST http://localhost:3000/api/push/config \
     -H 'Content-Type: application/json' \
     -d '{"enabled":true,"subject":"mailto:sekretariat@sp12.krakow.pl"}'
```

Klucze VAPID wygenerują się przy pierwszym włączeniu i zapiszą w `data/school/pushKeys.json`.
Kopia zapasowa zawiera więc klucz prywatny — trzymaj ją tak jak klucz szkoły. Po stronie użytkownika: Ustawienia → **Powiadomienia push** → przełącznik,
a rodzic z alertem o nieobecności dostaje tę samą propozycję na swoim ekranie.

Wymagania: **HTTPS** (poza `localhost`), zarejestrowany service worker i zgoda użytkownika na
powiadomienia. Wysyłka wychodzi z serwera szkoły na `https://<usługa push>` — zapora musi na to
pozwalać (ruch wychodzący 443 do domen FCM/Mozilli/Apple).

## Wsparcie przeglądarek

| przeglądarka | stan |
| --- | --- |
| Chrome / Edge / Opera (desktop, Android) | tak, przez FCM; działa także przy zamkniętej karcie |
| Firefox (desktop, Android) | tak, przez autopush Mozilli |
| Safari macOS 16.1+ | tak, dla stron dodanych do Docka/zakładek |
| Safari iOS/iPadOS 16.4+ | tak, **tylko** po dodaniu dziennika do ekranu początkowego (PWA) |
| starsze iOS, tryb prywatny, przeglądarki bez Push API | nie — dziennik mówi o tym wprost i zostaje przy powiadomieniach w aplikacji |

Bez SDK dostawcy: żaden plik z `public/` nie ładuje się z zewnętrznego adresu, więc CSP
(`script-src 'self'`) zostaje nietknięta, a szkoła nie zakłada konta u Google ani u Apple. Jedyne
połączenie na zewnątrz to POST z serwera szkoły na adres endpointu podany przez przeglądarkę.

## Test

`node --test tests/48-push.test.js` — wektor RFC 8291 bajt w bajt i przez niezależny deszyfrator,
struktura i podpis tokenu VAPID (weryfikacja `node:crypto`, surowe r‖s), rejestr subskrypcji
z deduplikacją, doręczenie powiadomienia `push:true` przez podstawiony transport (`webpush.transport`),
**minimalny ładunek** (alert o nieobecności i powiadomienie o wiadomości: w szyfrogramie nie ma ani
imienia, ani treści, ani odnośnika), **tryb `neutral`**, **trasa `/render`** (tytuł i treść po
polsku i po angielsku, 403 na cudzy wiersz), **rozrzut czasowy** (zwykłe doręczenie czeka, kryzysowe
nie), lista dopuszczonych rodzajów i neutralna treść powiadomienia o wiadomości, ponawianie po 5xx
i brak ponawiania po 4xx, usunięcie subskrypcji po 410, cisza nocna (odłożenie i przepuszczenie
sprawy kryzysowej), okno zwalniania, wyłącznik `config.push.enabled`, statystyki bez adresów
urządzeń, pełna droga alertu o nieobecności oraz obsługa zdarzeń `push` i `notificationclick`
w prawdziwym `public/sw.js` uruchomionym w `node:vm`: pobranie treści ze szkoły, zapasowy tytuł
rodzaju przy braku sieci i przy 401/403, komplet tabelki `PUSH_FALLBACK` dla **każdego** rodzaju
z listy pozytywnej w obu językach.

Po rundzie 3 doszło do tego: **parzystość trzech tabel** (`PUSH_TITLES`, `PUSH_NEUTRAL`,
`PUSH_FALLBACK`) i wspólnej listy `CRISIS_KINDS` po obu stronach, **neutralność treści dla
każdego rodzaju** (żadna odpowiedź `/render` nie niesie imienia, kwoty ani powodu),
**pierwszeństwo listy pozytywnej przed kryzysem** (kryzysowy `attendance-alert` zostaje
w dzienniku), **indeks powiadomień** (odczyt po id kontra przejście kolekcji, na 20 000
wierszach, w tym samym przebiegu), **termin 4 s w service workerze**, **zwolnienie rozrzutu
przez sam budzik kolejki** (bez `flushPush`), **restart w środku rozrzutu** (dwa serwery na
tym samym katalogu danych), **strefa czasowa szkoły** (`EDMAT_TZ` ustawione na antypodach),
unieważnienie subskrypcji przy wymianie kluczy VAPID oraz **parzystość słowników** ekranów
powłoki, wiadomości i ustawień (brak polskich liter w angielskim buildzie).

## Czego to nie sprawdziło

Uczciwie, bo to jedyne miejsce, gdzie ta uwaga ma sens: **ani jedno powiadomienie z tego
prototypu nie przeszło jeszcze przez prawdziwą usługę push.** Testy podstawiają
`webpush.transport`, a service worker chodzi w `node:vm`, nie w przeglądarce. Zgodne ze
standardem jest to, co da się sprawdzić na sucho: szyfrogram zgadza się co do bajtu z wektorem
z RFC 8291 Appendix A, token VAPID weryfikuje się kluczem publicznym, nagłówki są te z RFC 8030.
Czego **nie** wiemy, dopóki ktoś nie wyśle tego do FCM, Mozilli i APNs z prawdziwego telefonu:

- czy któraś usługa nie kręci nosem na nasz nagłówek `Authorization: vapid …` (część bibliotek
  wysyła starszy schemat `WebPush`),
- jak APNs zachowa się przy `TTL` i `Urgency`, których używamy,
- czy 55-bajtowy ładunek nie trafia gdzieś na limit „minimalnej” długości rekordu,
- czy `GET /render` zdąży się wykonać, zanim system uśpi workera (iOS daje na zdarzenie `push`
  kilka sekund) — i jak często w praktyce wypada tytuł zapasowy zamiast treści,
- czy `actions` w powiadomieniu są w ogóle pokazywane na danej platformie (iOS ich nie pokazuje).

Pierwszy pilotaż w szkole musi zacząć się od `POST /api/push/test` na prawdziwym telefonie
z każdej z trzech rodzin przeglądarek — i od sprawdzenia w `GET /api/push/stats`, co wróciło.
