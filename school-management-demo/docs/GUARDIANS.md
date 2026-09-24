# Opiekunowie, władza rodzicielska i uczeń pełnoletni

Kto z rodziców i opiekunów widzi w dzienniku co — i na jakiej podstawie. Dokument opisuje **decyzje
przyjęte w prototypie**, nie stan prawny. Pakiet R3 powstał po triage'u raportu Gemini z 23.09.2026
(`docs/research/2026-09-23-gemini-triage.md`, wiersze 9 i 10 oraz §3 pkt 2 i 3).

> **Zweryfikuj z prawnikiem.** Triage wskazuje dwa punkty jako wymagające opinii prawnej, zanim
> zobaczy je jakakolwiek szkoła: (a) rozróżnienie rodzica **pozbawionego** władzy rodzicielskiej od
> rodzica o władzy **ograniczonej** wraz z domyślnym zakresem dla każdego z nich i dokumentem, jakiego
> szkoła może żądać; (b) czy wobec ucznia pełnoletniego szkoła może informować opiekunów **do
> sprzeciwu**, czy potrzebuje **zgody** od pierwszego dnia. Dopóki opinii nie ma, oba ustawienia są
> w dzienniku jawne i przełączalne, a nie zaszyte w kodzie.

## 1. Cztery statusy władzy rodzicielskiej

Każdy wpis w `students[].guardians[]` niesie:

```js
{ userId, status, accessScope, scopeSource, basis: { kind, reference, date }, note,
  since, legalBasis, decidedByUserId, at }
```

| `status` | po polsku | zakres domyślny | czego wymaga |
| --- | --- | --- | --- |
| `full` | władza rodzicielska pełna | `full` | nic ponad opis podstawy (`legalBasis`) |
| `limited` | władza ograniczona | `full` | nic; prawo do informacji **zostaje** |
| `court-restricted` | dostęp do informacji ograniczony orzeczeniem sądu | `info` (albo `none`, jak wpisano) | `basis.kind = 'court-order'` **i** sygnatura |
| `deprived` | rodzic pozbawiony władzy rodzicielskiej | `none` | `basis.kind = 'court-order'` **i** sygnatura |

Zakresy dostępu są dalej te trzy, co dotąd (`D.assertMayReadPupilRecord`):

- `full` — oceny, uwagi, zadania, frekwencja, plan, wiadomości;
- `info` — frekwencja, plan lekcji, wiadomości i ogłoszenia, **bez** ocen, uwag i zadań;
- `none` — nic; dziecko znika z konta opiekuna (`/api/parent/children`).

### Jedna bramka: `D.guardianStanding(db, user, studentId)`

Zakres to za mało: do rundy R3/F1 czytał go wyłącznie odczyt karty ucznia, a powiadomienia,
skrzynka, zgody i płatności szły obok. Teraz wszystkie te drogi pytają **jedną** funkcję, która
składa razem trzy rzeczy: status władzy rodzicielskiej (albo zakres nadpisany ręcznie), sprzeciw
ucznia pełnoletniego (`parentAccessBlocked`) i tryb `config.adultAccess`.

```js
D.guardianStanding(db, user, studentId)
// → { ok, scope: 'full'|'info'|'none', reason, status, adultAccess, since }
```

`user` bywa kontem albo samym `userId` — rozsyłka po `students[].parentIds` zna tylko identyfikatory.
Dla pracownika szkoły i ucznia zwraca `{ ok: true, scope: 'full' }`; bramką ról zajmują się trasy.

| `reason` (gdy `ok` jest fałszem) | kiedy | co widzi opiekun |
| --- | --- | --- |
| `no_account` / `no_student` | konta albo ucznia nie ma w bazie | 403 „Brak dostępu do danych tego ucznia.” |
| `not_guardian` | to nie jest jego dziecko | jak wyżej |
| `parent_access_blocked` | sprzeciw ucznia pełnoletniego (3.6.12) | „Uczeń pełnoletni wniósł sprzeciw…”, `parentAccessBlocked: true` |
| `consent_required` | tryb `consent-required` przed zgodą | „Uczeń jest pełnoletni od…”, `adultAccess`, `adultSince` |
| `guardian_scope` | zakres `none` ze statusu albo z nadpisania | „Dostęp… ograniczony decyzją zapisaną w dokumentacji szkoły.”, `guardianStatus` |

Korzystają z niej: `D.visibleStudentIds` (a więc każda trasa chroniona `assertCanSeeStudent` —
frekwencja, zastępstwa, kursy, spotkania), `D.assertMayReadPupilRecord`, `D.notifyParentsOf`,
skrzynka (`server/routes/messages.js`), konto rodzica (`server/routes/parent.js`) i zgody na
nagrywanie (`server/routes/meetings.js`).

### Rozsyłka: zakres obowiązuje też tam, gdzie dane idą SAME

`D.notifyParentsOf` jest **jedyną** drogą rozsyłki po `students[].parentIds`; każdy adresat
przechodzi przez `guardianStanding` i przez regułę rodzaju powiadomienia:

| zakres | co dostaje |
| --- | --- |
| `full` | wszystko |
| `info` | frekwencja (`absence`, `attendance-alert`, `excuse`), plan i zastępstwa (`schedule`, `timetable`, `substitution`), ogłoszenia i korespondencja (`announcement`, `message`, `broadcast`, `ack`), zebrania (`meeting`), pisma o jego własnych prawach (`rights`, `semester`) |
| `none` | **nic** — także alert kryzysowy o nieobecności na 1. lekcji |

Lista dla `info` (`D.GUARDIAN_INFO_KINDS`) jest **pozytywna** z rozmysłu: nowy rodzaj powiadomienia
domyślnie nie idzie do opiekuna, któremu sąd zawęził prawo do informacji. Poza listą zostają oceny
(`grade`), uwagi i zachowanie (`remark`, `behavior`), gabinet profilaktyczny (`gabinet`), pomoc
psychologiczno-pedagogiczna (`speech`, `session`, `document`) i pieniądze (`payment`, `cafeteria`).
Ta sama reguła zamyka skrzynkę: pismo niosące `studentId` (na przykład zawiadomienie o zagrożeniu
oceną niedostateczną, `kind: 'warning'`) czyta opiekun, którego zakres ten rodzaj przepuszcza.

Jeden wyjątek jest zamierzony: powiadomienie o **własnym dostępie** opiekuna (`kind: 'rights'` —
zgoda albo sprzeciw ucznia pełnoletniego, zmiana zakresu zapisana przez sekretariat) idzie do konta
opiekuna niezależnie od legitymacji, bo inaczej dostęp znikałby bez słowa. Takie powiadomienie nie
niesie żadnych danych o nauce dziecka. Rozsyłają je `server/routes/registry.js`
i `server/routes/student.js` własną pętlą — i tylko one mają do tego prawo.

> **Do rozstrzygnięcia przez zespół** (`docs/review/round3/domain.md` § 2 pkt 2): czy rodzic
> pozbawiony władzy rodzicielskiej ma mimo wszystko **dostawać** zawiadomienie o zagrożeniu oceną
> albo informację o wyjeździe. Prototyp przyjmuje „nie” i tak to testuje; przesunięcie `trip` albo
> `warning` na listę dla `info` to jedna linia w `D.GUARDIAN_INFO_KINDS`.

### Decyzje to nie odczyt

Zgoda na nagranie zajęć, zgoda na wycieczkę, wniosek o usprawiedliwienie, płatność, odwołanie obiadu
i potwierdzenie odbioru zawiadomienia są **oświadczeniami woli opiekuna prawnego**. Składa je
wyłącznie opiekun w pełnej legitymacji (`ok && scope === 'full'`); `consentRows().decidedBy`
w `server/routes/meetings.js` nie wymienia nikogo, kto nie mógłby zdecydować. Skutek uboczny jest
zamierzony i wskazany w raporcie: rodzic pozbawiony władzy nie może zgody **udzielić** ani jej
**odmówić** — wystarczy zgoda drugiego opiekuna.

### Czytanie prawne, za którym idą te domyślne wartości

Raport twierdził, że rodzic **pozbawiony** władzy rodzicielskiej zachowuje prawo do informacji na
podstawie art. 113 K.r.o. Art. 113 dotyczy **kontaktów** z dzieckiem, a nie informacji o nauce, i nie
przywraca uprawnień odebranych orzeczeniem. Utrwalona praktyka MEN rozdziela dwie sytuacje:

- **władza ograniczona** (art. 109 K.r.o.) — rodzic zachowuje prawo do informacji o dziecku, chyba że
  sąd wprost to prawo ograniczył. Stąd `limited → full`, a nie `limited → info`;
- **pozbawienie władzy** (art. 111 K.r.o.) — rodzic traci uprawnienia rodzicielskie, w tym wgląd
  w dokumentację przebiegu nauczania. Stąd `deprived → none`, wbrew raportowi.

Sytuację „sąd ograniczył właśnie prawo do informacji” obsługuje osobny status `court-restricted`,
bo tylko ona pozwala szkole zawęzić dostęp rodzicowi, który władzy nie stracił. Dlatego oba statusy
sądowe wymagają sygnatury postanowienia: bez niej zawężenia nie da się obronić w dokumentacji szkoły.

**Zweryfikuj z prawnikiem** (triage §3 pkt 2), zanim szkoła zacznie na tym opierać odmowy.

### Nadpisanie zakresu

Zakres wynika ze statusu, dopóki sekretariat go nie nadpisze. W ekranie sekretariatu służy do tego
osobny przełącznik „Nadpisz zakres ręcznie”; w API — podanie `accessScope` obok `status`. Wpis pamięta
w `scopeSource` (`'derived' | 'explicit'`), skąd zakres pochodzi, więc późniejsza zmiana statusu
przelicza zakres domyślny, a nie kasuje ręcznej decyzji. Granice: rodzic `deprived` może mieć wyłącznie
`none`, a `court-restricted` — `info` albo `none`.

Gdy zakres nadpisany ręcznie **nie mieści się** w nowym statusie, żądanie jest odrzucane
(`guardian_scope_conflict` z listą `allowed` i `carried: true`), a nie po cichu nadpisywane:
sekretariat musi podać zakres jawnie razem ze statusem i tym samym potwierdzić, że rezygnuje
z poprzedniej decyzji.

Na odczycie obowiązuje dodatkowo przycięcie (`D.clampGuardianScope`): `deprived` czyta się zawsze
jako `none`, a `court-restricted` najwyżej jako `info` — również wtedy, gdy sprzeczną parę zapisał
zasiew, migracja albo import z pominięciem trasy sekretariatu.

### Przejścia między statusami — `D.guardianTransition(entry, next, body)`

Bramka musi działać w obie strony. Do rundy R3/F1 nałożenie ograniczenia wymagało postanowienia
sądu, a **zdjęcie** go — niczego: `PATCH {status:'full', legalBasis:'rodzic prosił'}` wracało z 200,
a ponieważ `basis` nie przyszła w żądaniu, wpis przywracający pełny dostęp powoływał się na
postanowienie, które ten dostęp odbierało.

```js
D.guardianTransition(prevEntry, { status, accessScope }, requestBody)
// → { status, scope, derived, explicit, scopeSource, basis, basisCleared, carriedScope,
//     previousStatus, transition: 'impose'|'lift'|'change'|'none' }
```

| przejście | czego wymaga | co robi z podstawą |
| --- | --- | --- |
| `* → deprived` / `* → court-restricted` (`impose`) | `basis.kind === 'court-order'` **i** sygnatura | zapisuje nową; poprzedniej nie dziedziczy |
| `deprived`/`court-restricted` → `full`/`limited` (`lift`) | **nowa** podstawa w tym żądaniu: `court-order` (postanowienie zmieniające) albo `declaration` (oświadczenie przyjęte w sekretariacie) — zawsze z własną sygnaturą | **kasuje** poprzednią (`basisCleared: true`) |
| każda inna zmiana statusu (`change`) | opis podstawy (`legalBasis`) jak dotąd | zapisuje opis; starej podstawy nie dziedziczy |
| zmiana samego zakresu (`none`) | opis podstawy | **zostawia** podstawę, na której wpis stoi |

Zakres nadpisany ręcznie (`scopeSource: 'explicit'`) przechodzi przez zmianę statusu razem z wpisem
— albo kończy się odmową `guardian_scope_conflict`, jeśli nowy status go nie dopuszcza.
Trasę sekretariatu (`PATCH /api/registry/students/:id/guardians/:userId`) wpina w tę funkcję
`server/routes/registry.js`; reguła mieszka w domenie, żeby import, migracja i przyszły ekran
nie mogły się z nią rozjechać.

### Zgodność wstecz

Wpis bez pola `status` (dane sprzed R3, import ze starego dziennika, ręczny zapis w seedzie) zachowuje
się dokładnie jak `full`: `D.guardianStatus(entry)` zwraca `'full'`, a zakres czytany jest tak, jak
dotąd — najpierw `accessScope` przy uczniu, potem domyślny zakres konta `users[].accessScope`.

## 2. Uczeń pełnoletni — przełącznik `config.adultAccess`

```js
config.adultAccess = 'until-objection'   // domyślnie; 'consent-required' to druga możliwość
```

| tryb | co się dzieje w dniu 18. urodzin | jak uczeń to zmienia |
| --- | --- | --- |
| `until-objection` (**domyślny**) | nic — opiekunowie widzą dalej to, co wynika z ich zakresu | sprzeciw: `POST /api/student/parent-access {blocked: true}` |
| `consent-required` | dostęp opiekunów do danych tego ucznia staje się `none` | zgoda: `POST /api/student/parent-access {consent: true}` |

Dzień pełnoletności liczy `D.adultFrom(student)` z daty urodzenia (29 lutego → 28 lutego w roku
nieprzestępnym) i porównuje z dniem szkolnym `D.today(db)` — nigdy z zegarem procesu. Uczeń bez daty
urodzenia w księdze zostaje przy fladze `students[].adult`.

Zgoda i sprzeciw to **dwie strony jednego zapisu** (`D.setAdultParentAccess`): `students[].adultConsent`
`{given, at, byUserId, reason}` plus dotychczasowe `parentAccessBlocked` / `parentAccessBlockedAt` /
`parentAccessReason`. Dzięki temu przełączenie `config.adultAccess` w działającej szkole nie zostawia
dwóch sprzecznych zapisów, a sprzeciw działa tak samo w obu trybach.

W trybie `consent-required` przed zgodą:

- `D.guardianScope` zwraca `none`, więc `D.assertMayReadPupilRecord` zamyka oceny, uwagi, zadania
  **i** frekwencję; odmowa niesie `deny: 'guardian_scope'`, `scope: 'none'`,
  `adultAccess: 'consent-required'` i `adultSince`;
- `D.notifyParentsOf` milknie — powiadomienia o danych ucznia nie omijają reguły.

Kto to widzi i od kiedy:

- **uczeń** i **opiekun** — pole `adultAccess` w `/api/auth/session` (u opiekuna: lista pełnoletnich
  dzieci), z `rule`, `state`, `guardianAccess` i datą `since`;
- **wychowawca** — `GET /api/registry/students/:id/adult-access` oraz `.../flags`;
- **sekretariat** — to samo plus karta ucznia i karta opiekunów w ekranie „Sekretariat”.

Zgodę albo sprzeciw złożone na piśmie w sekretariacie zapisuje
`POST /api/registry/students/:id/adult-access` `{consent: true|false, reason}` — ta sama para pól, ten
sam wiersz audytu (`adult_consent_recorded` / `adult_consent_withdrawn`).

**Zweryfikuj z prawnikiem** (triage §3 pkt 3), który tryb szkoła może włączyć; prototyp zostaje przy
`until-objection`, bo takie było dotychczasowe zachowanie dziennika, a decyzja należy do zespołu
(pytanie 7 w prezentacji).

## 3. API sekretariatu

| trasa | co robi |
| --- | --- |
| `GET /api/registry/students/:id/guardians` | opiekunowie ze statusem, podstawą, zakresem obowiązującym i `derivedScope`; listy `scopes`, `statuses`, `statusScopes`, `basisKinds` oraz `adultAccess` |
| `POST /api/registry/students/:id/guardians` | przypięcie konta opiekuna; przyjmuje `status`, `basis`, `accessScope` |
| `PATCH /api/registry/students/:id/guardians/:userId` | zmiana statusu i/lub zakresu przez `D.guardianTransition`; `legalBasis` (opis) wymagany zawsze, a nałożenie i zdjęcie ograniczenia sądowego — na dokumencie z sygnaturą |
| `DELETE /api/registry/students/:id/guardians/:userId` | odpięcie opiekuna (bez zmian w R3) |
| `GET /api/registry/students/:id/adult-access` | reguła, stan i data; czyta też wychowawca oddziału |
| `POST /api/registry/students/:id/adult-access` | zapis zgody albo sprzeciwu przyjętego w sekretariacie |

Kody błędów (stabilne, w polu `code`):

| `code` | kiedy |
| --- | --- |
| `guardian_status_unknown` | status spoza czterech dopuszczalnych |
| `guardian_basis_required` | `deprived` albo `court-restricted` bez podstawy `court-order`; a także **zdjęcie** któregoś z nich bez nowej podstawy (`transition: 'lift'`) |
| `guardian_basis_reference_required` | postanowienie sądu — albo dokument zdejmujący ograniczenie — bez sygnatury |
| `guardian_basis_kind` | `basis.kind` spoza `court-order` / `declaration` |
| `guardian_scope_unknown` | `accessScope` spoza `full` / `info` / `none` |
| `guardian_scope_conflict` | zakres nie do pogodzenia ze statusem (`allowed` niesie dopuszczalne; `carried: true`, gdy chodzi o zakres nadpisany wcześniej ręcznie) |
| `not_adult` | zapis zgody/sprzeciwu dla ucznia, który nie jest jeszcze pełnoletni |
| `consent_missing`, `no_reason` | żądanie bez `consent`/`blocked` albo bez podstawy zapisu |

## 4. Audyt

Każda zmiana zostawia wiersz z `before`/`after` niosącymi `accessScope`, `guardianStatus`, `basis`
i `derivedScope`:

- `guardian_status_changed` — gdy zmienił się status władzy rodzicielskiej;
- `guardian_scope_changed` — przy każdej zmianie wpisu (jak dotąd);
- `guardian_attached` / `guardian_detached` — przypięcie i odpięcie opiekuna;
- `adult_consent_recorded` / `adult_consent_withdrawn` — zgoda i jej cofnięcie;
- `parent_access_blocked` / `parent_access_restored` — sprzeciw ucznia z jego własnego ekranu.

Dowody: `tests/53-guardian-status.test.js` (domyślne zakresy per status, odmowa bez sygnatury,
`court-restricted none` zamykające oceny, frekwencję i rozsyłkę przez prawdziwe API, oba tryby
`adultAccess` po obu stronach 18. urodzin, wiersze audytu, zgodność wstecz);
`tests/57-guardian-paths.test.js` (scenariusz rozwodowy od początku do końca — dwoje opiekunów,
ocena, uwaga, gabinet, opłata, alert o 1. lekcji, pismo, zgoda na nagranie i płatność, sprawdzone
przez `/api/parent/*`, `/api/messages`, `/api/notifications/feed` i `/api/meetings/:id`; uczeń
pełnoletni w trybie „zgoda wymagana” na tych samych drogach; tabela przejść `guardianTransition`);
`tests/37-parent.test.js` (`[OPS-17]` — zakres `info` i `none` na koncie rodzica wraz z rozsyłką).
