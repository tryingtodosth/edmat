'use strict';
/* 3.10 — wydarzenia szkolne od strony organizatora (server/routes/events.js, seed 20-events.js).
   Każdy test przechodzi sam: stan, którego potrzebuje więcej niż jedna historyjka, budują
   `fixtures()` (świeże wydarzenie, instruktaż, zgoda opiekuna), a nie kolejność w pliku. */
const test = require('node:test');
const assert = require('node:assert');
const { startServer, expectOk, fixtures } = require('./helpers');

let S;
test.before(async () => { S = await startServer(); });
test.after(() => S.close());

const need = fixtures();

/** Świeże wydarzenie w wersji roboczej, prowadzone przez j.nowak. Nie dotyka wydarzeń z zasiewu. */
const freshEvent = (suffix) => need('event:' + suffix, async () => {
  const C = await S.as('j.nowak');
  const b = expectOk(await C.post('/api/events', {
    name: 'Próbne wydarzenie ' + suffix, kind: 'openDay', date: '2026-11-20', start: '16:00', end: '20:00',
    objective: 'Sprawdzić, czy karta wydarzenia trzyma cel, miarę i granice.',
    measure: 'Test przechodzi.', expectedVisitors: 100
  }), 'nie udało się założyć wydarzenia');
  return b.event.id;
});

/** Instruktaż obsługi wymagający potwierdzenia + dyżur; zwraca identyfikatory. */
const crewedEvent = () => need('crewed', async () => {
  const C = await S.as('j.nowak');
  const eventId = await freshEvent('crew');
  const br = expectOk(await C.post(`/api/events/${eventId}/briefings`, {
    title: 'Instruktaż obsługi', tier: 'staff', body: 'Nie zostawiamy stanowiska bez obsady.', requiresAck: true
  }));
  return { eventId, briefingId: br.briefing.id };
});

/* ============================================================================ 3.10.1 */
test('[3.10.1] karta wydarzenia powstaje z celem i miarą, a bez nich nie powstaje', async () => {
  const C = await S.as('j.nowak');

  const noObjective = await C.post('/api/events', {
    name: 'Wydarzenie bez celu', kind: 'fete', date: '2026-12-01', start: '10:00', end: '14:00', measure: 'Frekwencja.'
  });
  assert.equal(noObjective.status, 400, 'karta bez celu nie może powstać');
  assert.equal(noObjective.body.code, 'no_objective');

  const noMeasure = await C.post('/api/events', {
    name: 'Wydarzenie bez miary', kind: 'fete', date: '2026-12-01', start: '10:00', end: '14:00',
    objective: 'Zintegrować społeczność szkolną po feriach.'
  });
  assert.equal(noMeasure.status, 400, 'karta bez miary celu nie może powstać');
  assert.equal(noMeasure.body.code, 'no_measure');

  const b = expectOk(await C.post('/api/events', {
    name: 'Wigilia szkolna 2026', kind: 'ceremony', date: '2026-12-18', start: '17:00', end: '19:00',
    objective: 'Zebrać uczniów, rodziców i nauczycieli na wspólnym kolędowaniu przed przerwą świąteczną.',
    outcome: 'Rodzic zna wychowawcę i widzi klasę swojego dziecka poza sytuacją zebrania.',
    measure: 'Obecność co najmniej jednego opiekuna z 70% rodzin.',
    redLines: ['Bez zbiórek pieniężnych przy wejściu.', 'Sala gimnastyczna zamknięta dla osób bez opieki dorosłego.'],
    expectedVisitors: 240
  }));
  assert.equal(b.event.status, 'draft');
  assert.equal(b.event.kindLabel, 'Uroczystość szkolna');
  assert.equal(b.event.redLines.length, 2, 'granice nienegocjowalne zostają w karcie');
  assert.equal(b.event.measure, 'Obecność co najmniej jednego opiekuna z 70% rodzin.');

  /* Karta zostawia ślad w dzienniku zdarzeń. */
  const row = S.db.col('audit').filter((a) => a.action === 'event_created' && a.entityId === b.event.id);
  assert.equal(row.length, 1, 'założenie karty zostawia dokładnie jeden wiersz audytu');
  assert.equal(row[0].after.measure, 'Obecność co najmniej jednego opiekuna z 70% rodzin.');
});

/* ============================================================================ 3.10.2 */
test('[3.10.2] plan sali liczy pojemność użytkową z zapasem na dostępność i nie przekracza limitu ppoż.', async () => {
  const C = await S.as('j.nowak');
  const eventId = await freshEvent('rooms');

  const b = expectOk(await C.put(`/api/events/${eventId}/rooms`, {
    rooms: [
      /* 100 m², zapas 12% → 88 m² użytkowe; rzędy krzeseł 0,85 m²/os. → 103 miejsca, limit ppoż. 80 wygrywa. */
      { name: 'Aula', layout: 'theatre', areaM2: 100, fireCapacity: 80, expected: 70 },
      /* 50 m², zapas 12% → 44 m²; stoliki 1,5 m²/os. → 29 miejsc, a spodziewamy się 40. */
      { name: 'Sala 12', layout: 'classroom', areaM2: 50, expected: 40 }
    ]
  }));

  const aula = b.rooms.find((r) => r.name === 'Aula');
  assert.equal(aula.bufferPct, 12, 'domyślny zapas na dostępność bierze się z konfiguracji');
  assert.equal(aula.usableM2, 88);
  assert.equal(aula.byLayout, 103, '88 m² / 0,85 m² na osobę');
  assert.equal(aula.capacity, 80, 'limit przeciwpożarowy ogranicza arytmetykę powierzchni');
  assert.equal(aula.overCapacity, false);
  assert.equal(aula.overFire, false);

  const s12 = b.rooms.find((r) => r.name === 'Sala 12');
  assert.equal(s12.capacity, 29, '44 m² / 1,5 m² na osobę');
  assert.equal(s12.overCapacity, true, '40 osób nie mieści się w 29 miejscach');
  assert.equal(s12.fireCapacity, null);
  assert.equal(s12.overFire, false, 'bez podanego limitu ppoż. nie orzekamy o jego przekroczeniu');

  assert.equal(b.warnings.length, 1);
  assert.match(b.warnings[0].message, /Sala 12/);
  assert.equal(b.totalCapacity, 109);

  /* Zatwierdzenie odmawia, gdy frekwencja przekracza limit przeciwpożarowy. */
  expectOk(await C.put(`/api/events/${eventId}/rooms`, { rooms: [{ name: 'Aula', layout: 'theatre', areaM2: 100, fireCapacity: 80, expected: 120 }] }));
  expectOk(await C.post(`/api/events/${eventId}/risks`, { hazard: 'Zator przy wejściu', category: 'human', likelihood: 2, severity: 2, control: 'Dwa stanowiska.' }));
  const P = await S.as('dyrektor');
  const denied = await P.post(`/api/events/${eventId}/approve`, {});
  assert.equal(denied.status, 409);
  assert.equal(denied.body.code, 'over_fire_capacity');
});

/* ============================================================================ 3.10.3 */
test('[3.10.3] grafik dyżurów pokazuje, na których stanowiskach wciąż brakuje ludzi', async () => {
  const C = await S.as('j.nowak');
  const eventId = await freshEvent('rota');

  expectOk(await C.post(`/api/events/${eventId}/shifts`, { station: 'Szatnia', start: '15:45', end: '18:00', needed: 2 }));
  const second = expectOk(await C.post(`/api/events/${eventId}/shifts`, { station: 'Wejście', start: '16:00', end: '18:00', needed: 1 }));

  let rota = expectOk(await C.get(`/api/events/${eventId}/rota`));
  assert.equal(rota.totalShort, 3, 'trzy nieobsadzone miejsca na dwóch dyżurach');
  assert.deepEqual(rota.stations, ['Szatnia', 'Wejście']);

  /* Nauczyciel zapisuje się na dyżur przy wejściu — brak spada o jeden. */
  expectOk(await C.post(`/api/events/${eventId}/shifts/${second.shift.id}/claim`, {}));
  rota = expectOk(await C.get(`/api/events/${eventId}/rota`));
  assert.equal(rota.totalShort, 2);
  const filled = rota.shifts.find((s) => s.id === second.shift.id);
  assert.equal(filled.filled, 1);
  assert.equal(filled.short, 0);
  assert.equal(filled.adultOnShift, true);
  assert.equal(rota.shortfall.length, 1, 'na liście braków zostaje tylko szatnia');
  assert.equal(rota.shortfall[0].station, 'Szatnia');

  /* Drugi zapis tej samej osoby na ten sam dyżur to konflikt, nie cicha duplikacja. */
  const again = await C.post(`/api/events/${eventId}/shifts/${second.shift.id}/claim`, {});
  assert.equal(again.status, 409);
  assert.equal(again.body.code, 'already_claimed');
});

/* ============================================================================ 3.10.4 */
test('[3.10.4] uczeń zapisuje się na dyżur dopiero po zgodzie opiekuna i potwierdzeniu instruktażu', async () => {
  const C = await S.as('j.nowak');
  const eventId = await freshEvent('consent');
  const br = expectOk(await C.post(`/api/events/${eventId}/briefings`, {
    title: 'Instruktaż obsługi', tier: 'staff', body: 'Nie zostawiamy stanowiska bez obsady.', requiresAck: true
  }));
  const sh = expectOk(await C.post(`/api/events/${eventId}/shifts`, { station: 'Wejście', start: '16:00', end: '18:00', needed: 3 }));
  /* Dorosły na dyżurze, żeby w tym teście nie mieszała się reguła „potrzebny dorosły”. */
  expectOk(await C.post(`/api/events/${eventId}/shifts/${sh.shift.id}/claim`, {}));

  const A = await S.as('anna.kowalczyk');

  /* 1. Bez zgody opiekuna — odmowa. */
  const noConsent = await A.post(`/api/events/${eventId}/shifts/${sh.shift.id}/claim`, {});
  assert.equal(noConsent.status, 409);
  assert.equal(noConsent.body.code, 'no_guardian_consent');

  /* 2. Opiekun podpisuje zgodę ze swojego konta. */
  const R = await S.as('rodzic.kowalczyk');
  expectOk(await R.post(`/api/events/${eventId}/consents`, { studentId: 'st_kowalczyk_anna' }));

  /* 3. Zgoda jest, ale instruktaż wciąż niepotwierdzony — nadal odmowa. */
  const noBriefing = await A.post(`/api/events/${eventId}/shifts/${sh.shift.id}/claim`, {});
  assert.equal(noBriefing.status, 409);
  assert.equal(noBriefing.body.code, 'briefing_unread');

  /* 4. Uczennica potwierdza instruktaż i zapis przechodzi. */
  expectOk(await A.post(`/api/events/${eventId}/briefings/${br.briefing.id}/ack`, {}));
  const ok = expectOk(await A.post(`/api/events/${eventId}/shifts/${sh.shift.id}/claim`, {}));
  assert.equal(ok.status, 'confirmed');
  assert.equal(ok.minor, true, 'trzynastolatka jest małoletnia w rozumieniu modułu');

  /* Opiekun innego dziecka nie podpisze zgody za cudze. */
  const foreign = await R.post(`/api/events/${eventId}/consents`, { studentId: 'st_nowak_jan' });
  assert.equal(foreign.status, 403);
  assert.equal(foreign.body.code, 'not_guardian');

  /* Nowa wersja instruktażu unieważnia potwierdzenie — narzędzia dyżurowe znów są zamknięte. */
  expectOk(await C.post(`/api/events/${eventId}/briefings`, {
    title: 'Instruktaż obsługi', tier: 'staff', body: 'ZMIANA: wyjście wschodnie jest drogą ewakuacyjną.', requiresAck: true
  }));
  const after = expectOk(await A.get(`/api/events/${eventId}/briefings`));
  assert.equal(after.unread.length, 1, 'po nowej wersji instruktaż liczy się znów jako niepotwierdzony');
  assert.equal(after.briefings.find((b) => b.id === br.briefing.id).version, 2);
});

/* ============================================================================ 3.10.5 */
test('[3.10.5] dyżur małoletniego wolontariusza łamiący limit, ciszę nocną lub przerwę jest odrzucany', async () => {
  const C = await S.as('j.nowak');
  const eventId = await freshEvent('minor');
  const br = expectOk(await C.post(`/api/events/${eventId}/briefings`, { title: 'Instruktaż obsługi', tier: 'staff', body: 'Zasady.', requiresAck: true }));

  /* Uczeń gotowy do zapisu: zgoda opiekuna + potwierdzony instruktaż. */
  expectOk(await C.post(`/api/events/${eventId}/consents`, { studentId: 'st_nowak_jan' }));
  const J = await S.as('jan.nowak');
  expectOk(await J.post(`/api/events/${eventId}/briefings/${br.briefing.id}/ack`, {}));

  const mkShift = async (station, start, end) => (expectOk(await C.post(`/api/events/${eventId}/shifts`, { station, start, end, needed: 4 }))).shift.id;

  /* --- cisza nocna ----------------------------------------------------------------------- */
  const night = await mkShift('Sprzątanie po festynie', '21:00', '23:00');
  expectOk(await C.post(`/api/events/${eventId}/shifts/${night}/claim`, {}));      // dorosły na dyżurze
  const curfew = await J.post(`/api/events/${eventId}/shifts/${night}/claim`, {});
  assert.equal(curfew.status, 409);
  assert.equal(curfew.body.code, 'curfew');
  assert.match(curfew.body.error, /ciszy nocnej/);

  /* --- dobowy limit 7 h ------------------------------------------------------------------ */
  const long1 = await mkShift('Stoisko A', '08:00', '14:00');                       // 6 h
  expectOk(await C.post(`/api/events/${eventId}/shifts/${long1}/claim`, {}));
  expectOk(await J.post(`/api/events/${eventId}/shifts/${long1}/claim`, {}));       // 6 h w sumie — wolno
  const long2 = await mkShift('Stoisko B', '15:00', '17:00');                       // +2 h = 8 h > 7 h
  expectOk(await C.post(`/api/events/${eventId}/shifts/${long2}/claim`, {}));
  const cap = await J.post(`/api/events/${eventId}/shifts/${long2}/claim`, {});
  assert.equal(cap.status, 409);
  assert.equal(cap.body.code, 'daily_cap');
  assert.equal(cap.body.blockers[0].capMinutes, 420);
  assert.equal(cap.body.blockers[0].alreadyMinutes, 360);

  /* --- przerwa między dyżurami ------------------------------------------------------------ */
  const tooClose = await mkShift('Stoisko C', '14:10', '14:40');                    // 10 min po 14:00
  expectOk(await C.post(`/api/events/${eventId}/shifts/${tooClose}/claim`, {}));
  const gap = await J.post(`/api/events/${eventId}/shifts/${tooClose}/claim`, {});
  assert.equal(gap.status, 409);
  assert.equal(gap.body.code, 'no_rest_gap');

  /* --- dorosły na dyżurze: zapis czeka, zamiast zostać odrzucony -------------------------- */
  const alone = await mkShift('Stoisko D', '14:30', '15:00');
  const pending = expectOk(await J.post(`/api/events/${eventId}/shifts/${alone}/claim`, {}));
  assert.equal(pending.status, 'pending');
  assert.equal(pending.pendingReason, 'no_adult');
  /* Dorosły dołącza i domyka oczekujący zapis. */
  const joined = expectOk(await C.post(`/api/events/${eventId}/shifts/${alone}/claim`, {}));
  assert.equal(joined.releasedPending, 1);
  assert.equal(joined.shift.assignees.find((a) => a.studentId === 'st_nowak_jan').status, 'confirmed');
  /* A jego odejście cofa zapis do stanu oczekującego — dyżur nie zostaje bez dorosłego po cichu. */
  const left = expectOk(await C.post(`/api/events/${eventId}/shifts/${alone}/release`, {}));
  assert.equal(left.heldBackPending, 1);

  /* --- pełnoletnia uczennica nie podlega regułom wiekowym -------------------------------- */
  expectOk(await C.post(`/api/events/${eventId}/consents`, { studentId: 'st_borowska_aleksandra' }));
  const B = await S.as('aleksandra.borowska');
  expectOk(await B.post(`/api/events/${eventId}/briefings/${br.briefing.id}/ack`, {}));
  const adultNight = expectOk(await B.post(`/api/events/${eventId}/shifts/${night}/claim`, {}));
  assert.equal(adultNight.status, 'confirmed', 'osiemnastolatka może pełnić dyżur wieczorny');
  assert.equal(adultNight.minor, false);
});

/* ============================================================================ 3.10.6 */
test('[3.10.6] instruktaże są widoczne warstwami: rodzic, obsługa i organizator widzą różne komplety', async () => {
  const C = await S.as('j.nowak');
  const eventId = await freshEvent('tiers');
  for (const [title, tier] of [['Program', 'public'], ['Dla rodziców', 'participant'], ['Dla obsługi', 'staff'], ['Kosztorys i kontakty', 'organizer']]) {
    expectOk(await C.post(`/api/events/${eventId}/briefings`, { title, tier, body: 'Treść ' + tier, requiresAck: false }));
  }

  const titles = (b) => b.briefings.map((x) => x.title).sort();

  /* Organizator widzi wszystko. */
  const org = expectOk(await C.get(`/api/events/${eventId}/briefings`));
  assert.equal(org.myTier, 'organizer');
  assert.deepEqual(titles(org), ['Dla obsługi', 'Dla rodziców', 'Kosztorys i kontakty', 'Program']);
  assert.equal(org.hidden, 0);

  /* Rodzic widzi warstwę jawną i uczestnika — kosztorysu i instruktażu obsługi nie. */
  const R = await S.as('rodzic.kowalczyk');
  const parent = expectOk(await R.get(`/api/events/${eventId}/briefings`));
  assert.equal(parent.myTier, 'participant');
  assert.deepEqual(titles(parent), ['Dla rodziców', 'Program']);
  assert.equal(parent.hidden, 2, 'dwa instruktaże pozostają poza zasięgiem rodzica');

  /* Pielęgniarka jako pracownik szkoły wchodzi do warstwy obsługi, ale nie organizatora. */
  const N = await S.as('pielegniarka');
  const nurse = expectOk(await N.get(`/api/events/${eventId}/briefings`));
  assert.equal(nurse.myTier, 'staff');
  assert.deepEqual(titles(nurse), ['Dla obsługi', 'Dla rodziców', 'Program']);

  /* Uczeń bez dyżuru jest uczestnikiem; potwierdzenie cudzej warstwy jest odrzucane. */
  const A = await S.as('maja.adamczyk');
  const pupil = expectOk(await A.get(`/api/events/${eventId}/briefings`));
  assert.equal(pupil.myTier, 'participant');
  const crew = org.briefings.find((x) => x.title === 'Dla obsługi');
  const denied = await A.post(`/api/events/${eventId}/briefings/${crew.id}/ack`, {});
  assert.equal(denied.status, 403);
  assert.equal(denied.body.code, 'tier_forbidden');
});

/* ============================================================================ 3.10.7 */
test('[3.10.7] bramka przyjmuje paczkę skanów z kolejki offline, a kod QR nie niesie danych osobowych', async () => {
  const C = await S.as('j.nowak');
  const { eventId, briefingId } = await crewedEvent();
  expectOk(await C.post(`/api/events/${eventId}/briefings/${briefingId}/ack`, {}));

  const issued = expectOk(await C.post(`/api/events/${eventId}/passes`, { count: 3, kind: 'visitor', label: 'Rodzice 7b' }));
  assert.equal(issued.issued, 3);
  for (const p of issued.passes) {
    assert.equal(p.token.length, 32, 'token ma 32 znaki');
    assert.match(p.token, /^[A-Za-z0-9_-]+$/, 'token jest URL-safe');
    /* Klucz do tożsamości nie może dać się odczytać z samego kodu. */
    assert.ok(!/kowalczyk|anna|st_/i.test(p.token), 'token nie niesie nazwiska ani identyfikatora ucznia');
  }
  assert.equal(new Set(issued.passes.map((p) => p.token)).size, 3, 'tokeny się nie powtarzają');

  /* Etykieta z numerem PESEL jest odrzucana. */
  const pii = await C.post(`/api/events/${eventId}/passes`, { count: 1, label: 'Kowalski 13242222321' });
  assert.equal(pii.status, 400);
  assert.equal(pii.body.code, 'pii_in_label');

  /* Paczka z bramki: skany przychodzą nie po kolei, rozliczają się po czasie skanu. */
  const [p1, p2, p3] = issued.passes;
  const batch = expectOk(await C.post(`/api/events/${eventId}/scans`, {
    deviceId: 'bramka-1',
    scans: [
      { token: p3.token, at: '2026-11-20T15:10:00.000Z', nonce: 'n3', direction: 'in' },
      { token: p1.token, at: '2026-11-20T15:00:00.000Z', nonce: 'n1', direction: 'in' },
      { token: p2.token, at: '2026-11-20T15:05:00.000Z', nonce: 'n2', direction: 'in' }
    ]
  }));
  assert.equal(batch.accepted, 3);
  assert.equal(batch.inside, 3);
  assert.deepEqual(batch.results.map((r) => r.status), ['ok', 'ok', 'ok'], 'wyniki wracają w kolejności paczki');

  /* Powtórka tej samej paczki (kolejka nie dostała potwierdzenia) nie wpuszcza nikogo drugi raz. */
  const replay = expectOk(await C.post(`/api/events/${eventId}/scans`, {
    deviceId: 'bramka-1',
    scans: [{ token: p1.token, at: '2026-11-20T15:00:00.000Z', nonce: 'n1', direction: 'in' }]
  }));
  assert.equal(replay.replays, 1);
  assert.equal(replay.results[0].replay, true);
  assert.equal(replay.results[0].status, 'ok', 'powtórka zwraca pierwotny wynik');
  assert.equal(replay.inside, 3, 'liczba osób w środku się nie zmienia');
  assert.equal(S.db.col('eventScans').filter((s) => s.eventId === eventId && s.nonce === 'n1').length, 1, 'powtórka nie tworzy drugiego wiersza');

  /* Nieznana wejściówka jest odnotowana, ale nikogo nie wpuszcza. */
  const unknown = expectOk(await C.post(`/api/events/${eventId}/scans`, {
    deviceId: 'bramka-1', scans: [{ token: 'nie-ma-takiego-tokenu-xxxxxxxxxx', at: '2026-11-20T15:20:00.000Z', nonce: 'nX', direction: 'in' }]
  }));
  assert.equal(unknown.results[0].status, 'unknown');
  assert.equal(unknown.inside, 3);

  /* Bez potwierdzonego instruktażu narzędzie dyżurowe jest zamknięte. */
  const M = await S.as('a.mazur');
  const blocked = await M.post(`/api/events/${eventId}/scans`, { deviceId: 'bramka-2', scans: [] });
  assert.equal(blocked.status, 403);
  assert.equal(blocked.body.code, 'briefing_unread');
  assert.equal(blocked.body.briefings[0].title, 'Instruktaż obsługi');
});

/* ============================================================================ 3.10.8 */
test('[3.10.8] ponowny skan mówi „już w środku”, a ta sama wejściówka na dwóch bramkach zgłasza kolizję', async () => {
  const C = await S.as('j.nowak');
  const eventId = await freshEvent('scans');
  const br = expectOk(await C.post(`/api/events/${eventId}/briefings`, { title: 'Instruktaż obsługi', tier: 'staff', body: 'Zasady.', requiresAck: true }));
  expectOk(await C.post(`/api/events/${eventId}/briefings/${br.briefing.id}/ack`, {}));
  const issued = expectOk(await C.post(`/api/events/${eventId}/passes`, { count: 2, kind: 'visitor' }));
  const [p1, p2] = issued.passes;

  expectOk(await C.post(`/api/events/${eventId}/scans`, { deviceId: 'bramka-1', scans: [{ token: p1.token, at: '2026-11-20T16:00:00.000Z', nonce: 'a1', direction: 'in' }] }));

  /* Ta sama bramka, nowy skan tej samej wejściówki — zwykły duplikat. */
  const dup = expectOk(await C.post(`/api/events/${eventId}/scans`, { deviceId: 'bramka-1', scans: [{ token: p1.token, at: '2026-11-20T16:01:00.000Z', nonce: 'a2', direction: 'in' }] }));
  assert.equal(dup.results[0].status, 'duplicate');
  assert.equal(dup.results[0].code, 'already_in');
  assert.equal(dup.duplicates, 1);
  assert.equal(dup.collisions, 0);

  /* Inna bramka w tym samym oknie czasu — kolizja do rozstrzygnięcia przez człowieka. */
  const col = expectOk(await C.post(`/api/events/${eventId}/scans`, { deviceId: 'bramka-2', scans: [{ token: p1.token, at: '2026-11-20T16:02:00.000Z', nonce: 'a3', direction: 'in' }] }));
  assert.equal(col.results[0].status, 'collision');
  assert.equal(col.collisions, 1);
  assert.match(col.results[0].message, /innym wejściu/);

  /* Ta sama wejściówka na innej bramce, ale długo później — to już nie kolizja, tylko duplikat. */
  const late = expectOk(await C.post(`/api/events/${eventId}/scans`, { deviceId: 'bramka-3', scans: [{ token: p1.token, at: '2026-11-20T18:30:00.000Z', nonce: 'a4', direction: 'in' }] }));
  assert.equal(late.results[0].status, 'duplicate');

  /* Wyjście i ponowne wejście są poprawne; wyjście bez wejścia — nie. */
  expectOk(await C.post(`/api/events/${eventId}/scans`, { deviceId: 'bramka-1', scans: [{ token: p1.token, at: '2026-11-20T19:00:00.000Z', nonce: 'a5', direction: 'out' }] }));
  const outAgain = expectOk(await C.post(`/api/events/${eventId}/scans`, { deviceId: 'bramka-1', scans: [{ token: p2.token, at: '2026-11-20T19:05:00.000Z', nonce: 'a6', direction: 'out' }] }));
  assert.equal(outAgain.results[0].status, 'duplicate');
  assert.equal(outAgain.results[0].code, 'not_inside');

  /* Rejestr skanów zna każdą próbę, także odrzuconą. */
  const log = expectOk(await C.get(`/api/events/${eventId}/scans`));
  assert.equal(log.counts.ok, 2, 'jedno wejście i jedno wyjście');
  assert.equal(log.counts.duplicate, 3);
  assert.equal(log.counts.collision, 1);
});

/* ============================================================================ 3.10.9 */
test('[3.10.9] raport cateringowy podaje wyłącznie liczby — bez imiennej listy diet', async () => {
  const C = await S.as('j.nowak');
  const eventId = await freshEvent('catering');

  expectOk(await C.post(`/api/events/${eventId}/dietary`, { diet: 'vegetarian' }));
  expectOk(await C.post(`/api/events/${eventId}/dietary`, { diet: 'vegetarian', allergens: ['orzechy'] }));
  expectOk(await C.post(`/api/events/${eventId}/dietary`, { diet: 'glutenFree', allergens: ['gluten', 'mleko'] }));

  /* Alergen spoza zamkniętej listy 14 pozycji z rozporządzenia (UE) 1169/2011 jest odrzucany. */
  const bad = await C.post(`/api/events/${eventId}/dietary`, { diet: 'standard', allergens: ['truskawki'] });
  assert.equal(bad.status, 400);
  assert.equal(bad.body.code, 'bad_allergen');
  assert.equal(bad.body.allergens.length, 14, 'lista alergenów ma dokładnie 14 pozycji');

  const rep = expectOk(await C.get(`/api/events/${eventId}/catering`));
  assert.equal(rep.diets.find((d) => d.id === 'vegetarian').count, 2);
  assert.equal(rep.diets.find((d) => d.id === 'glutenFree').count, 1);
  assert.equal(rep.allergens.find((a) => a.id === 'orzechy').count, 1);
  assert.equal(rep.allergens.find((a) => a.id === 'gluten').count, 1);
  assert.equal(rep.headcount.declared, 3);
  assert.equal(rep.allAllergens.length, 14);

  /* Minimalizacja danych: w całej odpowiedzi nie ma ani identyfikatora osoby, ani wejściówki. */
  const raw = JSON.stringify(rep);
  assert.ok(!/st_|u_st_|evd_|passId/.test(raw), 'raport nie niesie identyfikatorów osób ani zgłoszeń: ' + raw.slice(0, 200));
  assert.ok(!/"studentId"/.test(raw));
});

/* ============================================================================ 3.10.10 */
test('[3.10.10] ryzyko w paśmie nieakceptowalnym blokuje zatwierdzenie, obniżone — przepuszcza', async () => {
  const C = await S.as('j.nowak');
  const P = await S.as('dyrektor');
  const eventId = await freshEvent('risk');

  /* Bez rejestru ryzyka w ogóle nie zatwierdzamy. */
  const empty = await P.post(`/api/events/${eventId}/approve`, {});
  assert.equal(empty.status, 409);
  assert.equal(empty.body.code, 'no_risk_register');

  /* Skala 1–5 jest pilnowana. */
  const bad = await C.post(`/api/events/${eventId}/risks`, { hazard: 'Cokolwiek', category: 'human', likelihood: 7, severity: 2 });
  assert.equal(bad.status, 400);
  assert.equal(bad.body.code, 'bad_score');

  const low = expectOk(await C.post(`/api/events/${eventId}/risks`, { hazard: 'Zator przy szatni', category: 'human', likelihood: 2, severity: 2, control: 'Druga lada.' }));
  assert.equal(low.risk.score, 4);
  assert.equal(low.risk.band.id, 'low');

  const high = expectOk(await C.post(`/api/events/${eventId}/risks`, {
    hazard: 'Zastawione wyjście ewakuacyjne', category: 'human', likelihood: 4, severity: 4, control: ''
  }));
  assert.equal(high.risk.score, 16);
  assert.equal(high.risk.band.id, 'unacceptable');
  assert.equal(high.risk.band.blocksApproval, true);

  const blocked = await P.post(`/api/events/${eventId}/approve`, {});
  assert.equal(blocked.status, 409);
  assert.equal(blocked.body.code, 'risk_unacceptable');
  assert.equal(blocked.body.blocking.length, 1);
  assert.equal(blocked.body.blocking[0].score, 16);

  /* Środek zaradczy obniża prawdopodobieństwo — ocena wchodzi w pasmo średnie. */
  const fixed = expectOk(await C.patch(`/api/events/${eventId}/risks/${high.risk.id}`, {
    likelihood: 2, control: 'Sprzęt nagłośnieniowy ustawiony poza drogą ewakuacyjną; sprawdzenie przed otwarciem drzwi.'
  }));
  assert.equal(fixed.risk.score, 8);
  assert.equal(fixed.risk.band.id, 'medium');
  assert.equal(fixed.risk.band.blocksApproval, false);

  const ok = expectOk(await P.post(`/api/events/${eventId}/approve`, {}));
  assert.equal(ok.event.status, 'approved');
  assert.equal(ok.residualRisks, 2);

  /* Zatwierdzona karta jest zamknięta na zmiany planu. */
  const late = await C.patch(`/api/events/${eventId}`, { name: 'Inna nazwa' });
  assert.equal(late.status, 409);
  assert.equal(late.body.code, 'approved');

  /* Obniżenie oceny zostawia ślad z wartością przed i po. */
  const row = S.db.col('audit').filter((a) => a.action === 'event_risk_updated' && a.entityId === high.risk.id);
  assert.equal(row.length, 1);
  assert.equal(row[0].before.likelihood, 4);
  assert.equal(row[0].after.score, 8);
});

/* ============================================================================ 3.10.11 */
test('[3.10.11] karta przebiegu drukuje się z harmonogramem, salami i ryzykiem resztkowym', async () => {
  const C = await S.as('j.nowak');
  const eventId = await freshEvent('print');
  expectOk(await C.put(`/api/events/${eventId}/rooms`, { rooms: [{ name: 'Aula', layout: 'theatre', areaM2: 180, fireCapacity: 200, expected: 150 }] }));
  const sh = expectOk(await C.post(`/api/events/${eventId}/shifts`, { station: 'Wejście główne', start: '15:45', end: '17:45', needed: 2 }));
  expectOk(await C.post(`/api/events/${eventId}/shifts/${sh.shift.id}/claim`, {}));
  expectOk(await C.post(`/api/events/${eventId}/risks`, { hazard: 'Zator przy wejściu', category: 'human', likelihood: 3, severity: 2, control: 'Dwa stanowiska rejestracji.', fallback: 'Trzecie stanowisko.' }));
  expectOk(await C.patch(`/api/events/${eventId}`, { redLines: ['Bez zbiórek przy wejściu.'] }));

  const res = await C.get(`/api/events/${eventId}/run-sheet/print`);
  assert.equal(res.status, 200);
  assert.match(res.headers.get('content-type'), /text\/html/);
  const html = res.body;

  assert.match(html, /Karta przebiegu/);
  assert.match(html, /Wejście główne/, 'harmonogram niesie stanowisko');
  assert.match(html, /Aula/, 'tabela sal niesie salę');
  assert.match(html, /Zator przy wejściu/, 'ryzyko resztkowe jest na wydruku');
  assert.match(html, /Bez zbiórek przy wejściu/, 'granice nienegocjowalne są na wydruku');
  assert.match(html, /Dwa stanowiska rejestracji/, 'środek zaradczy jest na wydruku');

  /* Wymóg z historyjki 3.9.1 (bez nawiasów kwadratowych: identyfikator w tym pliku przypisałby tamtą
     historyjkę do tego pliku w scripts/checklist-status.js). Wydruk czyta też czytnik ekranu:
     każda tabela ma podpis, a każdy nagłówek — zakres. */
  const tables = html.match(/<table>[\s\S]*?<\/table>/g) || [];
  assert.equal(tables.length, 3, 'harmonogram, sale i ryzyko');
  for (const t of tables) {
    assert.match(t, /<caption>/, 'tabela bez <caption>: ' + t.slice(0, 80));
    for (const th of t.match(/<th(?:\s[^>]*)?>/g) || []) assert.match(th, /scope="(col|row)"/, 'nagłówek bez scope: ' + th);
  }
});

/* ============================================================================ 3.10.12 */
test('[3.10.12] po 30 dniach znikają wejściówki, skany i diety, a liczby zbiorcze zostają', async () => {
  const db = S.db;
  const P = await S.as('dyrektor');
  const IOD = await S.as('iod');

  /* Festyn z zasiewu: 12.09.2026 + 30 dni = 12.10.2026, a „dziś” w demo to 23.10.2026. */
  const before = expectOk(await IOD.get('/api/events/ev_festyn_2026/retention'));
  assert.equal(before.retentionDays, 30);
  assert.equal(before.dueOn, '2026-10-12');
  assert.equal(before.dueNow, true);
  assert.equal(before.counts.passes, 5);
  assert.equal(before.counts.scans, 4);
  assert.equal(before.counts.dietary, 3);

  /* Powód jest obowiązkowy — trafia do dziennika zdarzeń. */
  const noReason = await IOD.post('/api/events/ev_festyn_2026/purge', { confirm: true });
  assert.equal(noReason.status, 400);
  assert.equal(noReason.body.code, 'no_reason');

  const out = expectOk(await IOD.post('/api/events/ev_festyn_2026/purge', { confirm: true, reason: 'Upłynął 30-dniowy okres przechowywania danych ulotnych wydarzenia.' }));
  assert.deepEqual(out.removed, { passes: 5, scans: 4, dietary: 3 });

  /* Wiersze osobowe zniknęły ze sklepu. */
  assert.equal(db.col('eventPasses').filter((p) => p.eventId === 'ev_festyn_2026').length, 0);
  assert.equal(db.col('eventScans').filter((s) => s.eventId === 'ev_festyn_2026').length, 0);
  assert.equal(db.col('eventDietary').filter((d) => d.eventId === 'ev_festyn_2026').length, 0);

  /* Liczby zbiorcze przeżyły — i to one są dowodem organizacyjnym. */
  assert.equal(out.summary.passesIssued, 5);
  assert.equal(out.summary.admitted, 4);
  assert.equal(out.summary.dietaryDeclared, 3);
  assert.equal(out.summary.byDiet.vegetarian, 1);
  assert.equal(out.summary.byAllergen.gluten, 1);
  const stored = db.get('schoolEvents', 'ev_festyn_2026');
  assert.equal(stored.summary.admitted, 4);
  assert.ok(stored.purgedAt, 'karta pamięta, kiedy dane ulotne usunięto');

  /* Karta, dyżury, instruktaże, ryzyko i zgody zostają — to dokumentacja organizatora. */
  assert.ok(db.get('schoolEvents', 'ev_festyn_2026'));
  assert.equal(db.col('eventRisks').filter((x) => x.eventId === 'ev_festyn_2026').length, 1);
  assert.equal(db.col('eventBriefings').filter((x) => x.eventId === 'ev_festyn_2026').length, 1);

  /* Usunięcie zostawia wiersz audytu z powodem. */
  const row = db.col('audit').filter((a) => a.action === 'event_data_purged' && a.entityId === 'ev_festyn_2026');
  assert.equal(row.length, 1);
  assert.match(row[0].reason, /30-dniowy/);
  assert.equal(row[0].before.scans, 4);

  /* Wydarzenie przed terminem nie daje się wyczyścić bez „force”. */
  const early = await IOD.post('/api/events/ev_open_2026/purge', { confirm: true, reason: 'Próba przed terminem.' });
  assert.equal(early.status, 409);
  assert.equal(early.body.code, 'not_due');
  assert.equal(early.body.dueOn, '2026-12-05');

  /* Kolekcje modułu mają klasę retencyjną — żadna nie jest „bez klasy”. */
  const RET = require('../server/routes/retention.js');
  const uncovered = RET.uncoveredCollections(db);
  assert.deepEqual(uncovered, [], 'kolekcje bez klasy: ' + uncovered.join(', '));

  /* Nauczyciel nie czyści danych osobowych — to czynność inspektora ochrony danych albo dyrekcji. */
  const T = await S.as('j.nowak');
  const forbidden = await T.post('/api/events/ev_open_2026/purge', { confirm: true, reason: 'Próba z konta nauczyciela.' });
  assert.equal(forbidden.status, 403);
  void P;
});
