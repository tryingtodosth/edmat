'use strict';
/* 3.7 — konto rodzica: przełączanie dzieci, alert o 1. lekcji, usprawiedliwienia, wgląd w oceny,
   cisza nocna, zebrania, płatności, odwołanie obiadu, wiadomości poufne, e-podpis zgody,
   rozdzielone konta opiekunów, zawiadomienia o zagrożeniu i eksport roczny. */
const test = require('node:test'); const assert = require('node:assert/strict');
const { startServer, expectOk, fixtures, DEMO_PASSWORD } = require('./helpers');
const D = require('../server/lib/domain');

let S; test.before(async () => { S = await startServer(); }); test.after(() => S.close());
const ANNA = 'st_kowalczyk_anna', PIOTR = 'st_kowalczyk_piotr';
const state = {};

const need = fixtures();
const excuse = () => need('excuse', async () => {
  const c = await S.as('rodzic.kowalczyk');
  const r = expectOk(await c.post('/api/parent/excuses', { studentId: ANNA, from: '2026-10-23', to: '2026-10-23', reason: 'Choroba — gorączka od rana.', channel: 'mobile' }));
  state.excuseId = r.excuse.id;
  return r;
});
const confidentialMessage = () => need('confidentialMessage', async () => {
  const c = await S.as('rodzic.kowalczyk');
  const sent = expectOk(await c.post('/api/messages', {
    toUserIds: ['u_pedagog'], subject: 'Prośba o rozmowę — sytuacja rodzinna',
    body: 'Proszę o spotkanie w sprawie sytuacji domowej córki. Wiadomość poufna.', confidential: true
  }));
  state.confidentialId = sent.message.id;
  return sent;
});

test('[3.7.1] jedno logowanie obsługuje oboje dzieci, a dane cudzego ucznia są zamknięte', async () => {
  const c = await S.as('rodzic.kowalczyk');
  const list = expectOk(await c.get('/api/parent/children'));
  assert.equal(list.children.length, 2);
  assert.deepEqual(list.children.map((x) => x.studentId).sort(), [ANNA, PIOTR].sort());
  const anna = list.children.find((x) => x.studentId === ANNA);
  assert.equal(anna.classId, '7b');
  assert.equal(list.children.find((x) => x.studentId === PIOTR).classId, '3a');

  // przełączenie profilu: ten sam adres z innym studentId zwraca dane drugiego dziecka
  const a = expectOk(await c.get('/api/parent/overview?studentId=' + ANNA));
  const p = expectOk(await c.get('/api/parent/overview?studentId=' + PIOTR));
  assert.equal(a.student.classId, '7b'); assert.equal(p.student.classId, '3a');
  assert.notEqual(a.student.studentId, p.student.studentId);

  // kontrola dostępu: inny rodzic nie zobaczy Anny
  const obcy = await S.as('rodzic.nowak');
  const denied = await obcy.get('/api/parent/overview?studentId=' + ANNA);
  assert.equal(denied.status, 403);
  assert.equal((await obcy.get('/api/parent/grades?studentId=' + ANNA)).status, 403);
});

test('[3.7.2] nieobecność na 1. lekcji tworzy rodzicowi powiadomienie push o priorytecie kryzysowym (idempotentnie)', async () => {
  const t = await S.as('j.nowak');
  /* Demo zasiewa tę nieobecność, żeby pulpit rodzica miał co pokazać od pierwszego wejścia — a skan
     jest idempotentny, więc test zaczyna od usunięcia tego, co powstało z zasiewu, i mierzy dokładnie
     ten jeden zapis frekwencji. */
  const annaRow = S.db.one('attendance', (a) => a.lessonId === 'les_tt_7b_5_1_2026-10-23' && a.studentId === ANNA);
  S.db.data.notifications = S.db.col('notifications').filter((n) => n.dedupeKey !== 'first-period:' + (annaRow && annaRow.id));
  const before = S.db.col('notifications').filter((n) => n.userId === 'u_p_kowalczyk' && n.crisis).length;
  expectOk(await t.post('/api/attendance/lesson/les_tt_7b_5_1_2026-10-23', { entries: [{ studentId: ANNA, status: 'nb' }] }), 'wpis nb');

  // NATYCHMIAST — bez żadnego odpytywania ze strony rodzica
  const instant = S.db.col('notifications').filter((n) => n.userId === 'u_p_kowalczyk' && n.crisis).slice(before);
  assert.ok(instant.some((n) => /1\. lekcji/.test(n.text) && n.push === true && n.deferred === false),
    'zapis nieobecności na 1. lekcji musi od razu utworzyć powiadomienie push dla opiekuna (bez /absence-alerts/scan)');

  const c = await S.as('rodzic.kowalczyk');
  const first = expectOk(await c.post('/api/parent/absence-alerts/scan'));
  const mine = first.alerts.find((x) => x.studentId === ANNA && x.lessonNo === 1);
  assert.ok(mine, 'alert Anny jest na liście');
  assert.equal(mine.notified, 0, 'odpytanie nie tworzy niczego — powiadomienie powstało przy zapisie');

  const view = expectOk(await c.get('/api/parent/absence-alerts?studentId=' + ANNA));
  const push = view.notifications.find((n) => n.text.includes('1. lekcji') && n.text.includes('Anna'));
  assert.ok(push, 'powiadomienie w kanale push');
  assert.equal(push.push, true);
  assert.equal(push.crisis, true);
  assert.equal(push.deferred, false);

  const again = expectOk(await c.post('/api/parent/absence-alerts/scan'));
  assert.equal(again.created, 0, 'powtórne sprawdzenie nie dubluje powiadomień');
});

test('[3.7.3] rodzic składa elektroniczny wniosek o usprawiedliwienie z powodem — bez żadnej opłaty', async () => {
  const c = await S.as('rodzic.kowalczyk');
  const bad = await c.post('/api/parent/excuses', { studentId: ANNA, from: '2026-10-23', to: '2026-10-23', reason: '' });
  assert.equal(bad.status, 400); assert.equal(bad.body.code, 'no_reason');

  const r = await excuse();
  assert.equal(r.excuse.status, 'pending');
  assert.equal(r.fee, 0); assert.equal(r.free, true);
  assert.match(r.receipt, /0,00 zł/);

  const row = S.db.get('excuses', state.excuseId);
  assert.equal(row.studentId, ANNA); assert.equal(row.byUserId, 'u_p_kowalczyk'); assert.equal(row.status, 'pending');
  const list = expectOk(await c.get('/api/parent/excuses?studentId=' + ANNA));
  assert.equal(list.fee, 0);
  assert.ok(list.excuses.some((e) => e.id === state.excuseId && e.mine));
});

test('[3.7.4] status wniosku i komentarz wychowawcy przy odrzuceniu są widoczne dla rodzica', async () => {
  await excuse();
  const hr = await S.as('j.nowak');
  const rej = expectOk(await hr.post(`/api/homeroom/excuses/${state.excuseId}/decision`, { decision: 'reject', reason: 'Zwolnienie z 1. lekcji wymaga zgody dyrektora — proszę o wniosek w sekretariacie.' }));
  assert.equal(rej.excuses[0].status, 'rejected');

  const c = await S.as('rodzic.kowalczyk');
  const list = expectOk(await c.get('/api/parent/excuses?studentId=' + ANNA));
  const e = list.excuses.find((x) => x.id === state.excuseId);
  assert.equal(e.status, 'rejected');
  assert.equal(e.statusLabel, 'Odrzucone');
  assert.match(e.rejectReason, /zgody dyrektora/);
  assert.equal(e.decidedBy, 'mgr Joanna Nowak');
  assert.equal(list.counts.rejected >= 1, true);
});

test('[3.7.5] zgłoszenie planowanej nieobecności powiadamia wychowawcę i nauczycieli przedmiotów z tych dni', async () => {
  const c = await S.as('rodzic.kowalczyk');
  const before = S.db.col('notifications').length;
  const r = expectOk(await c.post('/api/parent/excuses', { studentId: ANNA, from: '2026-11-03', to: '2026-11-04', reason: 'Planowany zabieg w poradni specjalistycznej.', planned: true }));
  assert.equal(r.notifiedHomeroom, 'mgr Joanna Nowak');
  assert.ok(r.notifiedTeacherIds.length >= 2, 'powiadomiono nauczycieli przedmiotów');
  assert.ok(r.notifiedTeacherIds.includes('u_wojcik') || r.notifiedTeacherIds.includes('u_sikora'));
  assert.equal(S.db.get('excuses', r.excuse.id).planned, true);
  assert.ok(S.db.col('notifications').length > before);
  for (const tid of r.notifiedTeacherIds) {
    assert.ok(S.db.col('notifications').some((n) => n.userId === tid && n.text.includes('Planowana nieobecność')), 'powiadomienie dla ' + tid);
  }
});

test('[3.7.6] stały bezpłatny wgląd w oceny, średnie, komentarze i frekwencję; ukryta średnia klasy znika', async () => {
  const c = await S.as('rodzic.kowalczyk');
  const g = expectOk(await c.get('/api/parent/grades?studentId=' + ANNA));
  assert.equal(g.access.free, true); assert.equal(g.access.cost, 0); assert.equal(g.access.permanent, true);
  assert.ok(g.subjects.length >= 3);
  assert.ok(typeof g.average === 'number' && g.average > 1);
  const withComment = g.subjects.flatMap((s) => s.grades).find((x) => x.comment);
  assert.ok(withComment && withComment.comment.length > 3, 'komentarz nauczyciela jest widoczny');
  assert.ok(g.subjects.every((s) => 'classAverage' in s), 'średnia klasy widoczna przy visibility.classAverage');
  assert.ok(!('rank' in g.subjects[0]), 'ranking pozostaje wyłączony');

  const att = expectOk(await c.get('/api/parent/attendance?studentId=' + ANNA));
  assert.ok(att.days.length >= 1); assert.ok(att.total > 0);
  assert.ok(att.bySubject && Object.keys(att.bySubject).length >= 1);

  const dyr = await S.as('dyrektor');
  expectOk(await dyr.patch('/api/principal/visibility', { classAverage: false, reason: 'Test polityki porównywania uczniów' }));
  const hidden = expectOk(await c.get('/api/parent/grades?studentId=' + ANNA));
  assert.equal(hidden.visibility.classAverage, false);
  assert.ok(hidden.subjects.every((s) => !('classAverage' in s)), 'średnia klasy ukryta');
  expectOk(await dyr.patch('/api/principal/visibility', { classAverage: true, reason: 'Przywrócenie ustawienia' }));
});

test('[3.7.7] cisza nocna odkłada zwykłe powiadomienie, a alert kryzysowy przechodzi mimo wyciszenia', async () => {
  const c = await S.as('rodzic.kowalczyk');
  const set = expectOk(await c.patch('/api/parent/quiet-hours', { from: '00:00', to: '23:59' }));
  assert.deepEqual(set.quietHours, { from: '00:00', to: '23:59' });
  assert.equal(expectOk(await c.get('/api/parent/quiet-hours')).quietNow, true);

  // zwykłe powiadomienie (potwierdzenie wniosku) czeka do rana
  const r = expectOk(await c.post('/api/parent/excuses', { studentId: ANNA, from: '2026-11-16', to: '2026-11-16', reason: 'Wizyta kontrolna u lekarza.' }));
  assert.ok(r.ok);
  const normal = S.db.col('notifications').filter((n) => n.userId === 'u_p_kowalczyk' && n.kind === 'excuse').slice(-1)[0];
  assert.equal(normal.deferred, true, 'zwykłe powiadomienie odłożone');
  assert.equal(normal.push, false);
  assert.ok(normal.deliverAt > normal.at);

  // alert kryzysowy: nieobecność Piotra na 1. lekcji
  const wf = await S.as('a.mazur');
  expectOk(await wf.post('/api/attendance/lesson/les_tt_3a_5_1_2026-10-23', { entries: [{ studentId: PIOTR, status: 'nb' }] }));
  // alert kryzysowy powstaje już przy zapisie frekwencji (3.7.2), więc odpytanie nic nie dokłada
  const scan = expectOk(await c.post('/api/parent/absence-alerts/scan'));
  assert.equal(scan.created, 0, 'powiadomienie powstało przy zapisie nieobecności, nie przy odpytaniu');
  assert.ok(scan.alerts.some((x) => x.studentId === PIOTR && x.lessonNo === 1));
  const crisis = S.db.col('notifications').filter((n) => n.userId === 'u_p_kowalczyk' && n.crisis).slice(-1)[0];
  assert.equal(crisis.deferred, false, 'alert kryzysowy dociera mimo ciszy nocnej');
  assert.equal(crisis.push, true);
  assert.match(crisis.text, /Piotr/);

  expectOk(await c.patch('/api/parent/quiet-hours', { enabled: false }));
  assert.equal(expectOk(await c.get('/api/parent/quiet-hours')).enabled, false);
});

test('[3.7.8] zebrania i dni otwarte z rezerwacją konsultacji; podwójna rezerwacja kończy się konfliktem 409', async () => {
  const c = await S.as('rodzic.kowalczyk');
  const m = expectOk(await c.get('/api/parent/meetings'));
  assert.ok(m.meetings.some((x) => x.kind === 'meeting' && x.classId === '7b'));
  assert.ok(m.meetings.some((x) => x.kind === 'openDay'));
  const free = m.slots.find((s) => !s.booked);
  assert.ok(free, 'jest wolny termin konsultacji');

  const booked = expectOk(await c.post(`/api/parent/consultation-slots/${free.id}/book`, { studentId: ANNA }));
  assert.equal(booked.slot.booked, true); assert.equal(booked.slot.mine, true);
  assert.equal(S.db.get('consultationSlots', free.id).bookedByUserId, 'u_p_kowalczyk');

  const inny = await S.as('rodzic.nowak');
  const clash = await inny.post(`/api/parent/consultation-slots/${free.id}/book`, { studentId: 'st_nowak_jan' });
  assert.equal(clash.status, 409); assert.equal(clash.body.code, 'slot_taken');

  const other = expectOk(await inny.get('/api/parent/meetings')).slots.find((s) => !s.booked);
  expectOk(await inny.post(`/api/parent/consultation-slots/${other.id}/book`, { studentId: 'st_nowak_jan' }));
  assert.equal(S.db.get('consultationSlots', other.id).bookedForStudentId, 'st_nowak_jan');
});

test('[3.7.9] płatność za obiady i składkę na radę rodziców kończy się natychmiastowym potwierdzeniem', async () => {
  const c = await S.as('rodzic.kowalczyk');
  const list = expectOk(await c.get('/api/parent/payments'));
  assert.ok(list.payments.length >= 3);
  const lunch = list.payments.find((p) => p.kind === 'lunch' && p.status === 'due');
  const council = list.payments.find((p) => p.kind === 'council' && p.status === 'due');
  assert.ok(lunch && council);

  const paid = expectOk(await c.post(`/api/parent/payments/${lunch.id}/pay`, { method: 'BLIK' }));
  assert.equal(paid.payment.status, 'paid');
  assert.match(paid.receiptNo, /^\d{4}-\d+$/);
  assert.match(paid.receipt, /Zapłacono/);
  assert.equal(S.db.get('payments', lunch.id).status, 'paid');

  const rec = await c.get(`/api/parent/payments/${lunch.id}/receipt`);
  assert.equal(rec.status, 200);
  assert.match(rec.headers.get('content-type'), /text\/html/);
  assert.match(rec.body, /Potwierdzenie wpłaty nr/);
  assert.ok(rec.body.includes(paid.receiptNo));

  const twice = await c.post(`/api/parent/payments/${lunch.id}/pay`, {});
  assert.equal(twice.status, 409); assert.equal(twice.body.code, 'already_paid');

  const c2 = expectOk(await c.post(`/api/parent/payments/${council.id}/pay`, {}));
  assert.equal(c2.payment.kindLabel, 'Rada Rodziców');
  assert.notEqual(c2.receiptNo, paid.receiptNo);
});

test('[3.7.10] odwołanie obiadu przed progiem daje zwrot na kolejny miesiąc; po progu system odmawia', async () => {
  const c = await S.as('rodzic.kowalczyk');
  const before = S.db.one('cafeteriaAccounts', (a) => a.studentId === ANNA).balance;
  const r = expectOk(await c.post('/api/parent/lunch/cancel', { studentId: ANNA, at: '07:40' }));
  assert.equal(r.cutoff, '08:00');
  assert.equal(r.amount, S.db.data.config.mealPrice);
  assert.equal(r.creditMonth, '2026-11', 'zwrot na rachunku za kolejny miesiąc');
  const acc = S.db.one('cafeteriaAccounts', (a) => a.studentId === ANNA);
  assert.equal(Math.round((acc.balance - before) * 100) / 100, S.db.data.config.mealPrice);
  assert.ok(acc.entries.some((e) => e.kind === 'credit' && e.month === '2026-11'));

  const again = await c.post('/api/parent/lunch/cancel', { studentId: ANNA, at: '07:45' });
  assert.equal(again.status, 409); assert.equal(again.body.code, 'already_cancelled');

  const late = await c.post('/api/parent/lunch/cancel', { studentId: PIOTR, at: '09:10' });
  assert.equal(late.status, 409); assert.equal(late.body.code, 'after_cutoff');
  assert.match(late.body.error, /po progu 08:00/);
  assert.equal(S.db.col('cafeteriaCancellations').some((x) => x.studentId === PIOTR), false);
});

test('[3.7.11] wiadomość poufna do pedagoga jest niedostępna dla pozostałych pracowników szkoły', async () => {
  const c = await S.as('rodzic.kowalczyk');
  const sent = await confidentialMessage();
  const id = sent.message.id;
  assert.equal(S.db.get('messages', id).confidential, true);

  const ped = await S.as('pedagog');
  assert.equal(expectOk(await ped.get('/api/messages/' + id)).confidential, true);

  const teacher = await S.as('j.nowak');
  const denied = await teacher.get('/api/messages/' + id);
  assert.equal(denied.status, 403);
  assert.match(denied.body.error, /poufna/);

  const dyr = await S.as('dyrektor');
  const sup = expectOk(await dyr.get('/api/messages/supervision'));
  assert.equal(sup.messages.some((m) => m.id === id), false, 'nadzór nie widzi wiadomości poufnej');
  assert.ok(sup.hiddenConfidential >= 1);
});

test('[3.7.12] zgoda na wycieczkę podpisana w aplikacji wymaga powtórnego podania hasła', async () => {
  const c = await S.as('rodzic.kowalczyk');
  const list = expectOk(await c.get('/api/parent/consents?studentId=' + ANNA));
  const trip = list.trips.find((t) => t.tripId === 'pm_trip_wieliczka');
  assert.ok(trip); assert.equal(trip.signed, false);
  assert.ok(trip.insurance && trip.insurance.policyNo);

  const bad = await c.post('/api/parent/trips/pm_trip_wieliczka/consent', { studentId: ANNA, agree: true, password: 'nie-to-haslo' });
  assert.equal(bad.status, 401); assert.equal(bad.body.code, 'bad_password');
  assert.equal(S.db.get('trips', 'pm_trip_wieliczka').consents[ANNA], undefined);

  const ok = expectOk(await c.post('/api/parent/trips/pm_trip_wieliczka/consent', { studentId: ANNA, agree: true, password: DEMO_PASSWORD }));
  const consent = S.db.get('trips', 'pm_trip_wieliczka').consents[ANNA];
  assert.equal(consent.signedBy, 'u_p_kowalczyk');
  assert.equal(consent.method, 'app-auth');
  assert.ok(consent.at);
  assert.equal(ok.signedCount, 1);

  const twice = await c.post('/api/parent/trips/pm_trip_wieliczka/consent', { studentId: ANNA, agree: true, password: DEMO_PASSWORD });
  assert.equal(twice.status, 409);
});

test('[3.7.13] konto drugiego opiekuna nie daje wglądu w korespondencję ani dane kontaktowe pierwszego', async () => {
  await confidentialMessage();
  const drugi = await S.as('rodzic.kowalczyk2');
  // to samo dziecko jest widoczne
  assert.equal(expectOk(await drugi.get('/api/parent/children')).children[0].studentId, ANNA);

  // korespondencja pierwszego opiekuna pozostaje zamknięta
  const denied = await drugi.get('/api/messages/' + state.confidentialId);
  assert.equal(denied.status, 403);
  const box = expectOk(await drugi.get('/api/messages?box=inbox'));
  assert.equal(box.messages.some((m) => m.id === state.confidentialId), false);

  // dane kontaktowe drugiej strony nie są udostępniane
  const g = expectOk(await drugi.get('/api/parent/guardians?studentId=' + ANNA));
  const marta = g.coGuardians.find((x) => x.id === 'u_p_kowalczyk');
  assert.ok(marta, 'drugi opiekun jest wymieniony z imienia');
  assert.equal(marta.phone, null); assert.equal(marta.email, null); assert.equal(marta.contactVisible, false);
  assert.equal(g.correspondenceSeparated, true);
  assert.ok(S.db.get('users', 'u_p_kowalczyk').phone, 'szkoła ma telefon pierwszego opiekuna w bazie');

  // własne dane kontaktowe widzi każdy u siebie
  const own = expectOk(await drugi.get('/api/parent/profile'));
  assert.equal(own.contact.phone, S.db.get('users', 'u_p_kowalczyk2').phone);
});

test('[3.7.14] formalne zawiadomienie o zagrożeniu na 30 dni przed klasyfikacją ma śledzone potwierdzenie odbioru', async () => {
  const c = await S.as('rodzic.kowalczyk');
  const list = expectOk(await c.get('/api/parent/warnings?studentId=' + ANNA));
  const w = list.warnings.find((x) => x.id === 'pm_msg_warning_anna');
  assert.ok(w, 'zawiadomienie jest w skrzynce opiekuna');
  assert.equal(w.requiresAck, true);
  assert.equal(w.delivered, true);
  assert.equal(w.acked, false);
  assert.equal(w.status, 'delivered');
  assert.equal(list.requiredDaysBefore, 30);
  assert.ok(w.daysBeforeClassification >= 30, 'wysłane co najmniej 30 dni przed klasyfikacją');
  assert.equal(w.inTime, true);
  assert.equal(list.toAck, 1);

  const ack = expectOk(await c.post('/api/parent/warnings/pm_msg_warning_anna/ack'));
  assert.equal(ack.warning.acked, true);
  assert.equal(ack.warning.status, 'acked');
  assert.ok(S.db.get('messages', 'pm_msg_warning_anna').ackBy.u_p_kowalczyk);
  assert.match(ack.receipt, /Potwierdzenie odbioru zapisano/);

  const after = expectOk(await c.get('/api/parent/warnings?studentId=' + ANNA));
  assert.equal(after.toAck, 0);
  assert.equal(after.warnings.find((x) => x.id === 'pm_msg_warning_anna').statusLabel, 'Odbiór potwierdzony');
  // drugi opiekun nadal ma własne, nierozliczone potwierdzenie
  const drugi = await S.as('rodzic.kowalczyk2');
  assert.equal(expectOk(await drugi.get('/api/parent/warnings')).toAck, 1);
});

test('[3.7.15] eksport historii ocen i frekwencji na koniec roku jest gotowym do druku dokumentem', async () => {
  const c = await S.as('rodzic.kowalczyk');
  const r = await c.get('/api/parent/export?studentId=' + ANNA);
  assert.equal(r.status, 200);
  assert.match(r.headers.get('content-type'), /text\/html/);
  assert.match(r.body, /Historia ocen i frekwencji · Anna Kowalczyk/);
  assert.match(r.body, /Semestr 1/);
  assert.match(r.body, /Semestr 2/);
  assert.match(r.body, /Frekwencja 01\.09\.2026/);
  assert.match(r.body, /Komentarze nauczycieli do ocen/);
  assert.match(r.body, /Zapisz jako PDF/);

  const json = expectOk(await c.get('/api/parent/export?studentId=' + ANNA + '&json=1'));
  assert.equal(json.studentId, ANNA);
  assert.equal(json.year, S.db.data.config.year);
  assert.ok(json.attendance.total > 0);
  assert.ok(S.db.col('audit').some((a) => a.action === 'parent_export' && a.entityId === ANNA));
});

/* --- przegląd operacyjny i pedagogiczny (docs/review/operations.md, pedagogy.md) ---------- */

test('[P30] wniosek o usprawiedliwienie ma zamknięty zakres dat i poprawne numery lekcji', async () => {
  const c = await S.as('rodzic.kowalczyk');
  const cfg = S.db.data.config;
  const body = (o) => Object.assign({ studentId: ANNA, reason: 'Choroba w rodzinie.' }, o);

  // wniosek „od 1.09 do 25.06” usprawiedliwiał jednym kliknięciem cały rok
  const year = await c.post('/api/parent/excuses', body({ from: cfg.semesters[0].from, to: cfg.semesters[1].to }));
  assert.equal(year.status, 400);
  assert.ok(['too_far_back', 'too_far_ahead', 'range_too_long'].includes(year.body.code), 'roczny zakres odrzucony: ' + year.body.code);

  const ahead = await c.post('/api/parent/excuses', body({ from: '2027-01-05', to: '2027-01-05', planned: true }));
  assert.equal(ahead.status, 400); assert.equal(ahead.body.code, 'too_far_ahead');
  assert.equal(ahead.body.maxFutureDays, 30);

  const back = await c.post('/api/parent/excuses', body({ from: '2026-09-07', to: '2026-09-07' }));
  assert.equal(back.status, 400); assert.equal(back.body.code, 'too_far_back');
  assert.equal(back.body.maxPastDays, 14);

  const long = await c.post('/api/parent/excuses', body({ from: '2026-10-20', to: '2026-11-20' }));
  assert.equal(long.status, 400); assert.equal(long.body.code, 'range_too_long');

  const badNo = await c.post('/api/parent/excuses', body({ from: '2026-10-22', to: '2026-10-22', lessonNos: [1, 99] }));
  assert.equal(badNo.status, 400); assert.equal(badNo.body.code, 'bad_lesson_nos');
  assert.equal(badNo.body.maxLessonNo, 8);

  // w granicach — wniosek przechodzi i obejmuje wskazane lekcje
  const ok = expectOk(await c.post('/api/parent/excuses', body({ from: '2026-10-22', to: '2026-10-22', lessonNos: [1, 2] })));
  assert.deepEqual(S.db.get('excuses', ok.excuse.id).lessonNos, [1, 2]);
  const revised = expectOk(await c.post('/api/parent/excuses', body({ from: '2026-11-10', to: '2026-11-12', planned: true })));
  assert.equal(S.db.get('excuses', revised.excuse.id).status, 'pending');
});

test('[OPS-17] zakres dostępu opiekuna: „info” zamyka oceny, „none” zamyka całe dziecko', async () => {
  const guardian = S.db.get('users', 'u_p_kowalczyk2');            // rozwód, jedno dziecko: Anna
  const anna = S.db.get('students', ANNA);
  const restore = { accessScope: guardian.accessScope, guardians: anna.guardians };
  try {
    // domyślnie — brak zapisu o zakresie znaczy pełny dostęp
    let c = await S.as('rodzic.kowalczyk2');
    assert.equal(expectOk(await c.get('/api/parent/children')).children.length, 1);
    expectOk(await c.get('/api/parent/grades?studentId=' + ANNA), 'pełny zakres widzi oceny');

    // sąd ograniczył władzę do prawa do informacji: frekwencja tak, oceny nie
    guardian.accessScope = 'info';
    c = await S.as('rodzic.kowalczyk2');
    const list = expectOk(await c.get('/api/parent/children'));
    assert.equal(list.accessScope, 'info');
    assert.equal(list.children[0].accessScope, 'info');

    const denied = await c.get('/api/parent/grades?studentId=' + ANNA);
    assert.equal(denied.status, 403); assert.equal(denied.body.deny, 'guardian_scope'); assert.equal(denied.body.scope, 'info');
    assert.equal((await c.get('/api/parent/export?studentId=' + ANNA)).status, 403, 'eksport ocen też jest zamknięty');

    const over = expectOk(await c.get('/api/parent/overview?studentId=' + ANNA));
    assert.equal(over.accessScope, 'info');
    assert.equal(over.grades.restricted, true);
    assert.deepEqual(over.grades.subjects, []);
    assert.equal(over.grades.average, null);
    assert.ok(over.lessons.length >= 1, 'plan lekcji pozostaje widoczny');
    assert.ok(over.attendanceWeek.total > 0, 'frekwencja pozostaje widoczna');
    expectOk(await c.get('/api/parent/attendance?studentId=' + ANNA), 'frekwencja dostępna');

    /* R3/F1 — zakres obowiązuje też tam, gdzie dane SAME idą do opiekuna: rozsyłka powiadomień
       i skrzynka. „info” przepuszcza frekwencję, plan i korespondencję, a zatrzymuje oceny,
       uwagi, gabinet i opłaty (D3-01, S3-04). */
    assert.deepEqual(D.notifyParentsOf(S.db, ANNA, 'grade', 'Nowa ocena — test OPS-17').map((n) => n.userId), ['u_p_kowalczyk']);
    assert.deepEqual(D.notifyParentsOf(S.db, ANNA, 'gabinet', 'Wizyta w gabinecie — test OPS-17').map((n) => n.userId), ['u_p_kowalczyk']);
    assert.deepEqual(D.notifyParentsOf(S.db, ANNA, 'absence', 'Nieobecność — test OPS-17').map((n) => n.userId).sort(), ['u_p_kowalczyk', 'u_p_kowalczyk2']);
    assert.equal((await c.get('/api/messages/pm_msg_warning_anna')).status, 403, 'zawiadomienie o zagrożeniu oceną to pismo o ocenach');
    assert.deepEqual(expectOk(await c.get('/api/parent/warnings')).warnings.filter((w) => w.studentId === ANNA), []);

    // drugi opiekun (bez ograniczenia) widzi oceny tego samego dziecka
    const pelny = await S.as('rodzic.kowalczyk');
    assert.ok(expectOk(await pelny.get('/api/parent/grades?studentId=' + ANNA)).subjects.length >= 1);

    // sąd odebrał wgląd w dane tego dziecka w całości
    guardian.accessScope = 'none';
    c = await S.as('rodzic.kowalczyk2');
    const empty = expectOk(await c.get('/api/parent/children'));
    assert.equal(empty.children.length, 0, 'dziecko znika z konta opiekuna');
    assert.deepEqual(empty.restricted, [ANNA]);
    const all403 = await Promise.all(['/api/parent/overview?studentId=' + ANNA, '/api/parent/grades?studentId=' + ANNA,
      '/api/parent/attendance?studentId=' + ANNA, '/api/parent/excuses?studentId=' + ANNA].map((u) => c.get(u)));
    for (const r of all403) { assert.equal(r.status, 403); assert.equal(r.body.deny, 'guardian_scope'); assert.equal(r.body.scope, 'none'); }
    assert.equal((await c.post('/api/parent/excuses', { studentId: ANNA, from: '2026-10-22', to: '2026-10-22', reason: 'Choroba.' })).status, 403);
    // trasa frekwencji poza 3.7 pilnuje tego samego zakresu
    assert.equal((await c.get('/api/attendance/student/' + ANNA)).status, 403);
    // …i żadne powiadomienie o dziecku już do tego konta nie powstaje
    for (const kind of ['grade', 'absence', 'gabinet', 'payment', 'schedule']) {
      assert.ok(!D.notifyParentsOf(S.db, ANNA, kind, `Test OPS-17 (${kind})`).some((n) => n.userId === 'u_p_kowalczyk2'), kind);
    }
    assert.deepEqual(expectOk(await c.get('/api/messages')).messages.filter((m) => m.studentId === ANNA), []);

    // zakres bywa zapisany przy dziecku, nie na koncie: ograniczenie dotyczy tylko tego dziecka
    guardian.accessScope = 'full';
    anna.guardians = [{ userId: 'u_p_kowalczyk2', accessScope: 'none' }, { userId: 'u_p_kowalczyk', accessScope: 'full' }];
    c = await S.as('rodzic.kowalczyk2');
    assert.equal(expectOk(await c.get('/api/parent/children')).children.length, 0, 'zapis przy uczniu też zamyka dostęp');
    const drugi = await S.as('rodzic.kowalczyk');
    expectOk(await drugi.get('/api/parent/grades?studentId=' + ANNA), 'drugiego opiekuna to nie dotyczy');
  } finally {
    guardian.accessScope = restore.accessScope; anna.guardians = restore.guardians;
  }
});

/* ------------------------------------------------------------------ GAP-5 (docs/PILOT.md §4)
   Opłatę potrafił do tej rundy wystawić wyłącznie zasiew demo. Teraz robi to sekretariat —
   a opiekun widzi ją w tej samej zakładce, w której ją opłaca. */
test('[3.7.9] GAP-5: sekretariat wystawia opłatę oddziałowi, a opiekun widzi ją i opłaca', async () => {
  const sek = await S.as('sekretariat');
  const cls = S.db.get('classes', '7b');
  const r = expectOk(await sek.post('/api/modules/fees', {
    classId: '7b', kind: 'council', title: 'Składka na radę rodziców — II półrocze', amount: 60, dueDate: '2026-12-15'
  }));
  assert.equal(r.students, (cls.studentIds || []).length, 'jeden wiersz opłaty na ucznia oddziału');
  assert.equal(r.amount, 60);
  assert.ok(r.parentsNotified >= 1, 'opiekunowie dowiadują się z dziennika');
  const row = S.db.col('audit').filter((a) => a.action === 'fee_issued' && a.entityId === r.feeId).slice(-1)[0];
  assert.ok(row, 'wystawienie opłaty zostawia wiersz audytu');
  assert.equal(row.after.students, r.students);

  // opiekun widzi ją natychmiast i może ją opłacić tą samą drogą, co opłaty z zasiewu
  const c = await S.as('rodzic.kowalczyk');
  const pay = expectOk(await c.get('/api/parent/payments?studentId=' + ANNA));
  const mine = pay.payments.find((p) => p.title === 'Składka na radę rodziców — II półrocze');
  assert.ok(mine, 'nowa opłata jest w koncie opiekuna');
  assert.equal(mine.amount, 60);
  assert.equal(mine.dueDate, '2026-12-15');
  assert.equal(mine.status, 'due');
  const paid = expectOk(await c.post(`/api/parent/payments/${mine.id}/pay`, { method: 'blik' }));
  assert.equal(paid.payment.status, 'paid');
  assert.ok(paid.receiptNo);

  // termin wstecz i cudza rola są odrzucane
  const past = await sek.post('/api/modules/fees', { classId: '7b', title: 'Wstecz', amount: 10, dueDate: '2026-01-10' });
  assert.equal(past.status, 400); assert.equal(past.body.code, 'due_date_in_past');
  const noTarget = await sek.post('/api/modules/fees', { title: 'Bez adresata', amount: 10, dueDate: '2026-12-15' });
  assert.equal(noTarget.status, 400); assert.equal(noTarget.body.code, 'no_target');
  const teacher = await S.as('j.nowak');
  assert.equal((await teacher.post('/api/modules/fees', { classId: '7b', title: 'Nie wolno', amount: 10, dueDate: '2026-12-15' })).status, 403);

  const list = expectOk(await sek.get('/api/modules/fees?classId=7b'));
  const fee = list.fees.find((f) => f.feeId === r.feeId);
  assert.equal(fee.students, r.students);
  assert.equal(fee.paid, 1, 'przegląd opłat liczy opłacone i zaległe');
});

/* ------------------------------------------------------------------ GAP-7 (docs/PILOT.md §5)
   Do tej rundy dziennik miał dwie drogi powiadomień: `createNotification` znała ciszę nocną,
   a `D.notify` — nie. Opiekun z włączoną ciszą był więc wyciszony tylko w połowie dziennika:
   potwierdzenie wniosku czekało do rana, ale komunikat wychowawcy budził go o 23:40. */
test('[3.7.7] GAP-7: komunikat wychowawcy o 23:40 czeka do rana tak samo jak wniosek, a alert kryzysowy nie', async () => {
  const D = require('../server/lib/domain');
  const db = S.db;
  const parentId = 'u_p_kowalczyk';
  const parent = db.get('users', parentId);
  const restore = parent.quietHours;
  parent.quietHours = { from: '21:00', to: '06:30' }; db.save();
  try {
    /* 23:40 czasu szkoły (Europe/Warsaw, czas zimowy) = 22:40 UTC — instant podajemy wprost,
       żeby test nie zależał od godziny, o której go uruchomiono. */
    const at = '2026-11-16T22:40:00.000Z';
    const before = db.col('notifications').length;

    const broadcast = D.notify(db, parentId, 'message', 'Zebranie z wychowawcą 20 listopada o 17:00.', { at, link: '/wiadomosci' });
    assert.equal(broadcast.deferred, true, 'komunikat wychowawcy odłożony do końca ciszy');
    assert.equal(broadcast.push, false, 'i nie idzie na telefon');
    assert.equal(broadcast.quietHours, '21:00–06:30');
    assert.equal(broadcast.deliverAt, '2026-11-17T06:30:00+01:00', 'dostarczenie o 06:30 czasu szkoły następnego dnia');
    assert.ok(Date.parse(broadcast.deliverAt) > Date.parse(broadcast.at));

    const crisis = D.notify(db, parentId, 'absence', 'Nieobecność na 1. lekcji.', { at, crisis: true, link: '/rodzic' });
    assert.equal(crisis.deferred, false, 'sprawa kryzysowa przechodzi mimo ciszy nocnej');
    assert.equal(crisis.push, true);
    assert.equal(crisis.quietBypass, true);

    // deduplikacja działa na obu drogach: ten sam klucz nie tworzy drugiego wiersza
    const key = { at, dedupeKey: 'gap7:test' };
    assert.ok(D.notify(db, parentId, 'message', 'Pierwsze', key));
    assert.equal(D.notify(db, parentId, 'message', 'Drugie', key), null);
    // nieistniejące konto nie kończy się wierszem-widmem ani wyjątkiem
    assert.equal(D.notify(db, 'u_nie_ma_takiego', 'message', 'Donikąd', { at }), null);
    assert.equal(db.col('notifications').length, before + 3);

    // ta sama droga dla opiekunów ucznia — `null` nie wchodzi na listę
    const many = D.notifyParentsOf(db, ANNA, 'message', 'Do opiekunów.', { at });
    assert.ok(many.length >= 1 && many.every(Boolean));
    assert.ok(many.every((n) => n.deferred === (db.get('users', n.userId).quietHours ? true : false)));
  } finally {
    if (restore) parent.quietHours = restore; else delete parent.quietHours;
    db.save();
  }
});

test('[3.7.7] GAP-7: broadcast wychowawcy przez API honoruje ciszę nocną opiekuna', async () => {
  const c = await S.as('rodzic.kowalczyk');
  expectOk(await c.patch('/api/parent/quiet-hours', { from: '00:00', to: '23:59' }));
  try {
    const before = S.db.col('notifications').filter((n) => n.userId === 'u_p_kowalczyk').length;
    const hr = await S.as('j.nowak');
    expectOk(await hr.post('/api/homeroom/broadcast', { classId: '7b', audience: 'allParents', subject: 'Zebranie z rodzicami', body: 'Zapraszam w czwartek o 17:00.' }));
    const made = S.db.col('notifications').filter((n) => n.userId === 'u_p_kowalczyk').slice(before);
    assert.ok(made.length >= 1, 'komunikat wychowawcy dotarł do skrzynki opiekuna');
    assert.ok(made.every((n) => n.deferred === true && n.push === false && !!n.deliverAt),
      'obie drogi powiadomień odkładają go do rana i zerują push');
  } finally {
    expectOk(await c.patch('/api/parent/quiet-hours', { enabled: false }));
  }
});
