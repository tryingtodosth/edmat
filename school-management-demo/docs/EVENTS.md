# Wydarzenia szkolne (moduł `events`, historyjki 3.10)

Dzień otwarty, festyn, uroczystość, zebranie ogólne — **od strony organizatora**. Moduł nie jest
ani kalendarzem dla rodzica, ani kartą wycieczki; te dwie rzeczy już w dzienniku są i moduł ich nie
dubluje:

| co | gdzie mieszka | kto prowadzi |
| --- | --- | --- |
| zebranie i dzień otwarty w kalendarzu rodzica, rezerwacja konsultacji | kolekcja `meetings` + `consultationSlots`, `server/routes/parent.js` (3.7.8) | rodzic czyta, sekretariat wpisuje |
| karta wycieczki: ubezpieczenie, opiekunowie grup, zgody, status „w” w dzienniku | kolekcja `trips`, `server/routes/modules.js` (3.8.5–3.8.7) | kierownik wycieczki, zatwierdza dyrekcja |
| **karta wydarzenia: cel, sale, dyżury, instruktaże, wejścia, ryzyko** | **kolekcja `schoolEvents` i spółka, `server/routes/events.js` (3.10)** | **organizator, zatwierdza dyrekcja** |

Wydarzenie może wskazywać zebranie z 3.7 kluczem `meetingId` — wtedy rodzic widzi je w swoim
kalendarzu, a organizator prowadzi całą resztę tutaj. Zasiew tak właśnie wiąże „Dzień otwarty
szkoły 2026” z `pm_meet_open`.

## Kolekcje

| kolekcja | kształt |
| --- | --- |
| `schoolEvents` | `{ id, name, kind:'openDay'|'fete'|'ceremony'|'parentEvening'|'competition'|'other', date, start, end, leaderId, meetingId, objective, outcome, measure, redLines:[], audience:[], expectedVisitors, rooms:[{roomId,name,layout,areaM2,bufferPct,fireCapacity,expected,note}], status:'draft'|'submitted'|'approved'|'closed', createdAt, approvedBy, approvedAt, purgedAt, summary }` |
| `eventShifts` | `{ id, eventId, station, date, start, end, needed, adultRequired, assignees:[{kind:'staff'|'student', userId, studentId, status:'confirmed'|'pending', pendingReason, minor, at, byUserId}], note, createdAt }` |
| `eventBriefings` | `{ id, eventId, title, tier:'public'|'participant'|'staff'|'organizer', body, requiresAck, version, at, byUserId }` |
| `eventBriefingAcks` | `{ id, briefingId, eventId, userId, studentId, version, at }` |
| `eventConsents` | `{ id, eventId, studentId, scope:'volunteer', byUserId, by, at, note }` |
| `eventPasses` | `{ id, eventId, token, kind:'visitor'|'volunteer'|'guest', label, issuedAt, issuedBy, revoked, inside }` |
| `eventScans` | `{ id, eventId, passId, token, direction:'in'|'out', at, nonce, deviceId, status:'ok'|'duplicate'|'collision'|'unknown'|'revoked'|'rejected', code, byUserId }` |
| `eventDietary` | `{ id, eventId, passId, diet, allergens:[], at, byUserId }` |
| `eventRisks` | `{ id, eventId, hazard, category:'human'|'technical'|'natural'|'environmental', likelihood:1-5, severity:1-5, control, fallback, ownerId, at, byUserId }` |

Progi modułu siedzą w `config.events` (zasiew `20-events.js`, ten sam komplet w
`server/lib/blank-seed.js`, żeby nowa szkoła miała parytet kluczy — pilnuje tego `[onb.1]`).

## Cztery rzeczy, które ten moduł robi inaczej, niż się zwykle robi

### 1. Pojemność sali to nie limit przeciwpożarowy

Dwie różne liczby i moduł nigdy ich nie miesza. **Pojemność użytkowa** wychodzi z powierzchni
pomniejszonej o zapas na ciągi komunikacyjne i miejsca dla osób poruszających się na wózku
(`accessibilityBufferPct`, domyślnie 12%), podzielonej przez metraż na osobę dla danego układu sali
(rzędy krzeseł 0,85 m², stoliki 1,5 m², stoły okrągłe 1,2 m², podkowa 2,3 m², stojące 0,65 m²).
**Limit przeciwpożarowy** podaje szkoła i on zawsze wygrywa: `capacity = min(z powierzchni, fireCapacity)`.

Przekroczenie pojemności użytkowej jest ostrzeżeniem („ciasno”). Przekroczenie limitu
przeciwpożarowego **blokuje zatwierdzenie** (`409 over_fire_capacity`). Metraże na osobę to praktyka
organizacji wydarzeń, nie cytat z przepisu — limit ppoż. sali bierze się z dokumentacji budynku.

### 2. Kolejność przy wolontariacie małoletnich: zgoda → instruktaż → dyżur

Wszyscy uczniowie szkoły podstawowej są poniżej progu (`minorUnderAge`, domyślnie 16), więc reguły
ochronne są tu ścieżką zwykłą, nie wyjątkiem. `volunteerBlockers()` w jednym miejscu rozstrzyga:

1. **zgoda opiekuna** (`eventConsents`) — dla każdego niepełnoletniego ucznia;
2. **potwierdzony instruktaż** obsługi w bieżącej wersji;
3. **cisza nocna** — dyżur nie może dotknąć `minorCurfewFrom`–`minorCurfewTo` (22:00–06:00);
4. **dobowy limit** `minorMaxHoursPerDay` (7 h) liczony po **wszystkich** wydarzeniach tego dnia;
5. **przerwa** `minShiftGapMin` (15 min) między dyżurami; dyżury nachodzące na siebie też ją łamią.

Szósta reguła — **dorosły na stanowisku** — nie odrzuca zapisu, tylko zostawia go w stanie
`pending`. Dorosły, który dołącza do dyżuru, domyka oczekujące zapisy; dorosły, który się wypisuje
jako ostatni, cofa je z powrotem do `pending`. Dzięki temu dyżur nie zostaje bez opieki po cichu.

Kolejność zgoda → instruktaż → dyżur nie jest przypadkowa: uczeń wchodzi do warstwy „obsługa”
(a więc widzi instruktaż obsługi) dopiero wtedy, gdy ma **zgłoszenie do wolontariatu albo dyżur**.
Bez tego pierwszego warunku powstałoby zakleszczenie — instruktażu nie dałoby się potwierdzić bez
dyżuru, a dyżuru wziąć bez potwierdzonego instruktażu.

> Progi są wartościami domyślnymi z regulaminu wolontariatu, **nie** cytatem z Kodeksu pracy ani z
> ustawy o wolontariacie. Szkoła ustala je u siebie; do weryfikacji z prawnikiem.

### 3. Wejściówka nie wie, kim jesteś, a bramka działa bez sieci

Kod QR niesie **wyłącznie** losowy token: 24 losowe bajty jako 32 znaki URL-safe. Imienia,
nazwiska, numeru PESEL ani identyfikatora ucznia w kodzie nie ma i być nie może — etykieta
wejściówki jest grupowa („Rodzice 7b”), a trasa odrzuca etykietę z numerem PESEL.

Skaner kolejkuje skany w przeglądarce i wysyła je paczką. Każdy skan ma własny `nonce` nadany przez
klienta, przez co:

- **powtórka paczki** (kolejka nie dostała potwierdzenia) zwraca pierwotny wynik i nie tworzy
  drugiego wiersza ani nie wpuszcza nikogo drugi raz;
- **paczka rozlicza się po czasie skanu**, nie po kolejności nadejścia — to rozstrzyga, kto wszedł
  pierwszy, gdy dwie bramki wysyłają naraz;
- **ponowny skan** tej samej wejściówki na **tej samej** bramce to `duplicate` („już w środku”);
- ta sama wejściówka na **innej** bramce w oknie `scanCollisionWindowMin` (5 min) to `collision` —
  sprawa dla człowieka, nie dla algorytmu. Po tym oknie to już zwykły duplikat.

Każda próba — także odrzucona — zostaje w `eventScans`. Narzędzie skanujące otwiera się dopiero po
potwierdzeniu instruktażu obsługi (`403 briefing_unread`).

### 4. Catering dostaje liczby, nie nazwiska

`GET /api/events/:id/catering` zwraca wyłącznie zestawienia zbiorcze: ile diet którego rodzaju, ile
zgłoszeń każdego z **14 alergenów** z załącznika II rozporządzenia (UE) nr 1169/2011. Ani jednego
identyfikatora osoby, ani jednego identyfikatora wejściówki — pilnuje tego asercja w
`tests/63-events.test.js`. Lista alergenów jest zamknięta: alergen spoza niej to `400 bad_allergen`.

## Rejestr ryzyka i zatwierdzenie

Matryca 5×5: `ocena = prawdopodobieństwo × skutek`. Pasma: 1–4 niskie, 5–12 średnie, **powyżej
`riskAcceptMax` (12) nieakceptowalne**. Dyrekcja nie zatwierdzi wydarzenia, dopóki w rejestrze
zostaje pozycja w paśmie nieakceptowalnym (`409 risk_unacceptable`) — trzeba obniżyć ocenę środkiem
zaradczym albo wyeliminować zagrożenie. Pusty rejestr też nie przechodzi (`409 no_risk_register`):
wydarzenie bez oceny ryzyka nie jest zatwierdzane.

Zatwierdzenie zamyka kartę na zmiany planu (`409 approved`); dyżury i wejściówki żyją dalej.

## Retencja: co znika po 30 dniach, a co zostaje

Dwie klasy w `server/routes/retention.js`:

- **`wydarzenia-szkolne`** (B5, 5 lat) — `schoolEvents`, `eventShifts`, `eventBriefings`,
  `eventBriefingAcks`, `eventRisks`, `eventConsents`. Karta z oceną ryzyka, grafikiem i zgodami to
  dowód, że szkoła dopełniła obowiązków organizatora; zostaje na wypadek zdarzenia ujawnionego
  później.
- **`wydarzenia-dane-ulotne`** (Bc, 30 dni, `config.eventDataRetentionDays`) — `eventPasses`,
  `eventScans`, `eventDietary`. Po wydarzeniu nie mają żadnej funkcji.

`POST /api/events/:id/purge` (IOD albo dyrekcja, z powodem) **najpierw przepisuje liczby zbiorcze**
do `schoolEvents[].summary`, dopiero potem usuwa wiersze — po usunięciu nie dałoby się ich odtworzyć.
Przed terminem trasa odmawia (`409 not_due`) i wymaga `force`.

## Trasy

```
GET    /api/events                              lista + słowniki (kinds, layouts)
POST   /api/events                              karta: cel i miara obowiązkowe
GET    /api/events/:id                          karta + dyżury
PATCH  /api/events/:id                          zmiana karty (nie po zatwierdzeniu)
PUT    /api/events/:id/rooms                    plan sal → pojemność, ostrzeżenia
POST   /api/events/:id/shifts                   nowy dyżur
GET    /api/events/:id/rota                     grafik + braki obsady
POST   /api/events/:id/shifts/:sid/claim        zapis (tu działają reguły ochronne)
POST   /api/events/:id/shifts/:sid/release      wypisanie (cutoff 4 h dla siebie)
POST   /api/events/:id/consents                 zgoda opiekuna na wolontariat
GET    /api/events/:id/briefings                instruktaże w warstwie tej roli
POST   /api/events/:id/briefings                publikacja (ten sam tytuł = nowa wersja)
POST   /api/events/:id/briefings/:bid/ack       potwierdzenie zapoznania
POST   /api/events/:id/passes                   wydanie wejściówek (token nieprzezroczysty)
GET    /api/events/:id/passes                   pula wejściówek
POST   /api/events/:id/scans                    paczka skanów z kolejki offline
GET    /api/events/:id/scans                    rejestr skanów + liczniki
POST   /api/events/:id/dietary                  zgłoszenie żywieniowe
GET    /api/events/:id/catering                 raport zbiorczy (bez danych osobowych)
POST   /api/events/:id/risks                    pozycja rejestru ryzyka
PATCH  /api/events/:id/risks/:rid               obniżenie oceny środkiem zaradczym
GET    /api/events/:id/risks                    rejestr + matryca
POST   /api/events/:id/approve                  zatwierdzenie (dyrekcja)
GET    /api/events/:id/run-sheet/print          karta przebiegu do druku
GET    /api/events/:id/retention                co i kiedy znika
POST   /api/events/:id/purge                    usunięcie danych ulotnych (IOD/dyrekcja)
```

Ekran: `public/app/screens/events.js` (`/wydarzenia`, prefiks i18n `ev.`), zakładki Karta · Sale ·
Grafik · Instruktaże · Bramka · Catering · Ryzyko. Bramka trzyma kolejkę skanów w pamięci
przeglądarki i pokazuje `E.SyncStatus`; wynik skanu idzie do obszaru `aria-live`, bo na bramce
rzadko kto patrzy na ekran.

## Czego ten moduł jeszcze nie robi

- Wejściówki nie mają **wydruku arkusza z kodami QR** — trasa wydaje tokeny, kody trzeba złożyć
  poza dziennikiem. Sam skaner przyjmuje token wpisany albo wklejony, nie czyta kamery.
- **Zgłoszenie żywieniowe składa pracownik lub rodzic ręcznie**; nie ma samoobsługowego formularza
  dla gościa z zewnątrz, bo gość nie ma konta w dzienniku.
- Grafik nie liczy **kosztów** ani nie pilnuje budżetu — kosztorys zostaje poza dziennikiem.
- Progi ochrony małoletnich są **decyzją szkoły**, nie odwzorowaniem konkretnego przepisu.
