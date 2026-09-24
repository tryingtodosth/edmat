# Pakiet zgodności — co jest generowane, a co jest szablonem

> **Żaden dokument z tego pakietu nie jest poradą prawną.** EdMat wypełnia w nich wyłącznie te pola,
> które da się odczytać z kodu i z danych działającej instancji; wszystko pozostałe — w tym wybór
> podstawy prawnej, dane Inspektora Ochrony Danych, hosting, kategorie archiwalne z JRWA szkoły,
> ocena ryzyka i decyzja o uprzednich konsultacjach z UODO — wypełnia i zatwierdza szkoła wraz ze
> swoim IOD i obsługą prawną.

Kod: `server/lib/compliance.js` (fakty i złożenie dokumentu), `server/routes/compliance.js` (trasy),
`public/app/screens/compliance.js` (ekran „Zgodność i dostępność”), test `tests/54-compliance.test.js`.
Powód powstania: [`docs/research/2026-09-23-gemini-triage.md`](../research/2026-09-23-gemini-triage.md),
wiersze 8, 11 i 14 oraz pakiet **R4** w § 2.

## 1. Trzy dokumenty

| Dokument | Trasa | Po co |
| --- | --- | --- |
| Ocena skutków dla ochrony danych (DPIA) | `GET /api/compliance/dpia` | Dziennik elektroniczny jest na wykazie Prezesa UODO (dane dzieci + systematyczna ocena osób), więc oceny skutków nie da się pominąć. Układ wg WP 248 rev.01. |
| Deklaracja dostępności | `GET /api/compliance/accessibility` | Obowiązek z ustawy z 4 kwietnia 2019 r. o dostępności cyfrowej; deklarację publikuje się na stronie szkoły i w BIP. |
| Umowa powierzenia (art. 28 RODO) — szkielet | `GET /api/compliance/dpa` | Szkoła jest administratorem, a ten, kto prowadzi dla niej instancję (gmina, CUW, dostawca hostingu), podmiotem przetwarzającym. |

Wspólne parametry:

- `locale=pl` (domyślnie) albo `locale=en`,
- `format=md` (domyślnie, `text/markdown`), `format=html` (dokument gotowy do druku — ten sam, który
  `GET /api/pdf?path=…` zamienia na prawdziwy PDF), `format=json` (struktura dokumentu + obie postacie;
  `facts=1` dokłada komplet faktów, **ale wyłącznie na trasach za rolami** — patrz § 5),
- `download=1` — plik do zapisania zamiast podglądu, `print=1` w postaci HTML uruchamia drukowanie.

Dodatkowo: `GET /api/compliance` (spis dokumentów i podsumowanie) oraz `GET /api/compliance/facts`
(same fakty jako JSON — podgląd dla IOD i materiał do rejestru czynności przetwarzania).

Dostęp: role **dpo, admin, principal** — **poza deklaracją dostępności, która jest publiczna**
(§ 5). Moduł: `compliance` (wyłączany w rejestrze modułów; po wyłączeniu trasy odpowiadają
`404 module_disabled`, a ekran znika z nawigacji).

## 2. Co jest **generowane** (fakt odczytany, nie opisany)

| W dokumencie | Skąd pochodzi |
| --- | --- |
| Spis zbiorów z licznikami wierszy | `db.data` — każda tablica w magazynie, z licznikiem na chwilę wygenerowania |
| Oznaczenie zbiorów z danymi art. 9 | katalog w `server/lib/compliance.js` (`CATALOG`), nałożony na realny spis kolekcji |
| Macierz „rola → dane”: zasięg w API | rejestr tras uruchomionej aplikacji (`app.router.routes`) z rozwinięciem aliasów `staff` / `gradeEditors` / `homeroom` dokładnie tak, jak robi to `server/index.js` |
| Macierz „rola → dane”: odczyt karty ucznia | **prawdziwe wywołania** `D.assertMayReadPupilRecord` dla każdej roli i każdego rodzaju danych, na kontach i uczniach tej instalacji — w tabeli jest odpowiedź bramy, łącznie z kodem odmowy (`guardian_scope`, `not_teaching_pupil`, `record_scope`) |
| Retencja | `config.retention` (klasy dokumentacji z kategorią archiwalną, pakiet R5) oraz `logRetentionYears`, `logRetentionMinYears`, `gradesArchiveRetentionYears`, `sessionRetentionDays`, `archiveWindow` |
| Fakty kryptograficzne | wykonanie funkcji z `server/lib/crypto.js`: skrót hasła (`scrypt`), koperta notatek poufnych (`AES-256-GCM+RSA-OAEP`), pieczęć pakietu archiwalnego (`RSA-SHA256`), polityka hasła |
| Transport i to, co opuszcza szkołę | `config.push` + kolekcja `pushKeys`, `config.video` (ten sam test domeny, którym `server/index.js` buduje CSP), obecność lokalnej przeglądarki do PDF |
| Podprocesorzy | wyliczane: **brak**, dopóki push i wideo nie są skonfigurowane |
| Skan śledzenia | `server/routes/privacy.js` → `scanTrackers()` (zasoby zewnętrzne, biblioteki analityczne); skan czytamy **raz na proces**, bo `public/` nie zmienia się bez wdrożenia |
| Treść polityki CSP | `app.contentSecurityPolicy()` — **ten sam budowniczy**, którym `server/index.js` ustawia nagłówek. Wcześniej brało ją stąd wyrażenie regularne po źródle `index.js`, które — bo polityka jest szablonem znakowym — przelatywało przez zamykający grawis i wsypywało do DPIA trzy kilobajty kodu serwera (D3-28) |
| Co w dostępności jest zbadane | **odhaczony kwadrat historyjki w `../../checklist.md`**, czyli zapisany wynik prawdziwego przebiegu: `scripts/checklist-status.js` odhacza go wyłącznie wtedy, gdy test zgłosił `ok`, nie miał `# SKIP`/`# TODO` i jego plik nie zakończył się błędem. Kryterium, którego ostatni przebieg nie potwierdził, schodzi z listy „zbadane” na listę „bez dowodu” z podaniem powodu. Wcześniej wystarczył grep po pliku testów — test czerwony albo pominięty liczył się tak samo jak zielony (H-4) |
| Co się dzieje z danymi przy żądaniu z art. 17 | `server/routes/privacy.js` → `describeErasure(db)`, to samo źródło, z którego korzysta sama operacja: które klasy dokumentacji są anonimizowane, które usuwane, a których prawo każe nie ruszać (D3-29) |
| Miejsce przetwarzania i przekazywanie do państw trzecich | `config.push` — przy włączonych powiadomieniach dokument **nazywa operatora** (Google LLC / FCM, Apple Inc. / APNs, Stany Zjednoczone) i żąda wskazania podstawy z rozdziału V RODO. Zdanie „nie przekazujemy danych poza EOG” było fałszywe dokładnie wtedy, gdy szkoła włączyła push (D3-27) |
| Nazwa szkoły, adres, REGON, RSPO, rok szkolny, strefa czasu | `config.school`, `config.year`, `config.timezone` |

## 3. Co jest **szablonem** do wypełnienia

Pola oznaczone w treści jako `[[ do uzupełnienia przez szkołę ]]` (w wersji angielskiej
`[[ to be completed by the school ]]`). Najważniejsze:

- administrator danych, dane i podpis Inspektora Ochrony Danych, data oceny i termin przeglądu,
- **wybór podstawy prawnej** (art. 6 ust. 1 lit. c i e; dla danych art. 9 — art. 9 ust. 2 lit. b i g),
- kto prowadzi hosting i jakie stosuje zabezpieczenia (szyfrowanie nośnika, zapora, kopie poza serwerem),
- prawdopodobieństwo, waga i ryzyko szczątkowe w rejestrze ryzyk — kod ich nie zna,
- kategorie archiwalne z **JRWA tej szkoły** przypisane do zbiorów (domyślna tabela jest hipotezą, dopóki
  szkoła jej nie potwierdzi — patrz `docs/RETENTION.md`),
- w deklaracji dostępności: data publikacji, data ostatniej istotnej aktualizacji, **data sporządzenia
  deklaracji i data jej ostatniego przeglądu jako osobne pola**, **adres deklaracji w BIP**, **odnośnik
  do procedury składania żądania i skargi**, osoba kontaktowa, adres e-mail i telefon do zgłoszeń,
  dostępność architektoniczna budynku, ostateczny status zgodności,
- w umowie powierzenia: strony, czas trwania, terminy zgłaszania naruszeń, tryb audytu, podpisy,
  a przy włączonych powiadomieniach push — **podstawa przekazania do państwa trzeciego** (standardowe
  klauzule umowne, decyzja o adekwatności albo wyjątek z art. 49 RODO) wraz z datą weryfikacji.

## 4. Czego pakiet **nie** rozstrzyga

- Nie jest oceną ryzyka — dostarcza rejestr ryzyk z opisem środków, ale wagi nadaje szkoła.
- Nie zastępuje rejestru czynności przetwarzania (art. 30 RODO); `GET /api/compliance/facts` jest do
  niego dobrym materiałem wyjściowym, ale nie jest nim.
- Nie rozstrzyga pytań, które triaż raportu skierował do prawnika (§ 3 dokumentu triażu): lista podpisów
  dopuszczalnych przy pakiecie archiwalnym, domyślny zakres dostępu opiekuna pozbawionego władzy
  rodzicielskiej, dostęp opiekunów do danych ucznia pełnoletniego.
- Deklaracja dostępności deklaruje **częściową** zgodność i wprost wymienia kryteria bez automatycznego
  dowodu. Nie należy jej zmieniać na „zgodna” bez własnego przeglądu albo audytu.

## 5. Deklaracja dostępności jest publiczna — i dlatego wąska

Ustawa o dostępności cyfrowej każe deklarację **opublikować**, więc `GET /api/compliance/accessibility`
odpowiada bez sesji i jest wyjęta z bramy `setup_required` w `server/index.js`. Powłoka renderuje
odnośnik do niej pod formularzem logowania (`public/app/shell.js`). Szkole zostaje wstawienie tego
samego dokumentu na własną stronę i do BIP — przycisk „Druk” albo „Markdown” na ekranie „Zgodność
i dostępność” daje gotowy plik, a adres publikacji wpisuje się w pole na BIP w punkcie 1 deklaracji.

Trasa bez sesji w procesie, który obsługuje całą szkołę, ma trzy twarde reguły (runda 3):

1. **Nigdy `facts`.** Dokument powstaje z wąskiego zestawu faktów (`CP.build(…, { facts: false })`):
   nazwa i adres szkoły, data, dowody dostępności i liczba zasobów zewnętrznych. Nie ma jak wyciągnąć
   z niej spisu zbiorów, liczników wierszy art. 9 ani polityki haseł — te stoją o jedną trasę dalej,
   za rolami. `?facts=1` na tej trasie nic nie robi (S3-01).
2. **Nigdy loginu konta.** Macierz „rola → dane” nie niesie już loginu przykładowego konta, tylko
   informację, czy szkoła w ogóle ma konto danej roli — także w dokumentach za rolami.
3. **Z pamięci i z ogranicznikiem tempa.** Odpowiedź jest pamiętana do najbliższej zmiany w magazynie
   (`db.version`) i podawana z `Cache-Control: public, max-age=300`; trasa ma własne okno na adres,
   takie samo w zamyśle jak okno na trasie logowania (`429 rate_limited`). Bez tego jedno anonimowe
   żądanie kosztowało ~200 ms procesora — prawdziwy scrypt, podpis RSA i skan całego `public/` —
   czyli około pięciu żądań na sekundę wystarczało, żeby dziennik przestał odpowiadać nauczycielom
   (S3-03, R3-07).

Pozostałe dwa dokumenty (DPIA, umowa powierzenia) i `GET /api/compliance/facts` zostają za rolami
**dpo / admin / principal** i odpowiadają `401`/`403` anonimowo, także przed pierwszym uruchomieniem.

## 6. Jak odświeżyć dokumenty

Nie trzeba nic odświeżać: dokument powstaje przy pierwszym żądaniu po zmianie w magazynie, więc
zawsze opisuje stan bieżący (publiczna deklaracja — z pamięci podręcznej przewiązanej do `db.version`,
co widać po tym, że dwa żądania pod rząd wracają co do bajtu tym samym plikiem).
Warto go wygenerować i zarchiwizować (z datą) przy każdej istotnej zmianie: włączeniu powiadomień push,
wskazaniu serwera wideo, włączeniu lub wyłączeniu modułu, zmianie polityki retencji.
