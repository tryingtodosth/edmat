'use strict';
/* 3.8 — moduły szkolne: świetlica (czytnik legitymacji, odbiór dziecka), stołówka (obiady z porannej
   frekwencji, blokada przy zaległości), wycieczka (karta, zatwierdzenie, pozostający w szkole),
   biblioteka (komplet podręczników, rozliczenie przed świadectwami), gabinet profilaktyki. */
const test = require('node:test'); const assert = require('node:assert/strict');
const { startServer, expectOk, fixtures } = require('./helpers');

let S; test.before(async () => { S = await startServer(); }); test.after(() => S.close());
const ANNA = 'st_kowalczyk_anna', JAN = 'st_nowak_jan', MAJA = 'st_adamczyk_maja';
const TRIP = 'pm_trip_wieliczka';
const state = {};

/* Zapis Anny do świetlicy tworzy 3.8.1, ale potrzebuje go też 3.8.2. Budujemy go leniwie i raz,
   żeby oba testy przechodziły także uruchomione osobno (`--test-name-pattern`). */
const need = fixtures();
const annaInCare = () => need('care:anna', async () => {
  const c = await S.as('swietlica');
  const roster = expectOk(await c.get('/api/modules/care/roster?classId=7b'));
  const annaRow = roster.students.find((x) => x.studentId === ANNA);
  const scan = expectOk(await c.post('/api/modules/care/checkin', { barcode: annaRow.barcode, at: '14:52' }));
  return { c, roster, annaRow, scan };
});

test('[3.8.1] zapis do świetlicy czytnikiem legitymacji albo z listy klasy', async () => {
  const { c, roster, annaRow, scan } = await annaInCare();
  assert.ok(roster.students.length >= 12);
  assert.ok(annaRow.barcode, 'uczeń ma kod legitymacji');
  assert.equal(annaRow.checkedIn, false, 'przed skanowaniem uczeń nie jest zapisany');

  assert.equal(scan.method, 'barcode');
  assert.equal(scan.checkin.studentId, ANNA);
  assert.equal(scan.checkin.inAt, '14:52');
  assert.match(scan.confirmation, /czytnik legitymacji/);

  const unknown = await c.post('/api/modules/care/checkin', { barcode: 'XX-999' });
  assert.equal(unknown.status, 404); assert.equal(unknown.body.code, 'unknown_barcode');

  const quick = expectOk(await c.post('/api/modules/care/checkin', { studentId: JAN, at: '14:58' }));
  assert.equal(quick.method, 'roster');
  const dup = await c.post('/api/modules/care/checkin', { studentId: JAN });
  assert.equal(dup.status, 409); assert.equal(dup.body.code, 'already_checked_in');

  const list = expectOk(await c.get('/api/modules/care/checkins'));
  assert.equal(list.present, 2);
  assert.ok(S.db.col('careCheckins').every((x) => x.byUserId === 'u_swietlica' && x.date === S.TODAY));
});

test('[3.8.2] wydanie dziecka tylko osobie upoważnionej, z zapisem godziny i tożsamości', async () => {
  const c = (await annaInCare()).c;            // wydanie ma sens dopiero, gdy uczeń jest w świetlicy
  const p = expectOk(await c.get('/api/modules/care/pickups?studentId=' + ANNA));
  assert.ok(p.authorized.length >= 2, 'lista osób upoważnionych');
  const matka = p.authorized.find((x) => x.relation === 'matka');
  assert.ok(matka && matka.valid);

  const obcy = await c.post('/api/modules/care/pickup', { studentId: ANNA, person: 'Kazimierz Nieznany' });
  assert.equal(obcy.status, 403); assert.equal(obcy.body.code, 'not_authorized');
  assert.equal(S.db.col('carePickups').length, 0, 'nieupoważniony odbiór nie zostawia wpisu wydania');

  const ok = expectOk(await c.post('/api/modules/care/pickup', { studentId: ANNA, pickupId: matka.pickupId, at: '15:24', identityCheck: 'Dowód osobisty okazany przy wydaniu' }));
  assert.equal(ok.pickup.time, '15:24');
  assert.equal(ok.pickup.person, 'Marta Kowalczyk');
  assert.equal(ok.pickup.relation, 'matka');
  const row = S.db.one('carePickups', (x) => x.studentId === ANNA);
  assert.equal(row.byUserId, 'u_swietlica');
  assert.match(row.identityCheck, /Dowód osobisty/);
  assert.ok(row.at, 'zapisano dokładny znacznik czasu');
  assert.equal(S.db.one('careCheckins', (x) => x.studentId === ANNA && x.date === S.TODAY).outAt, '15:24');

  const again = await c.post('/api/modules/care/pickup', { studentId: ANNA, pickupId: matka.pickupId });
  assert.equal(again.status, 409); assert.equal(again.body.code, 'not_in_care');

  const log = expectOk(await c.get('/api/modules/care/pickups')).log;
  assert.ok(log.some((x) => x.studentId === ANNA && x.person === 'Marta Kowalczyk'));
  assert.ok(S.db.col('audit').some((a) => a.action === 'care_pickup'));
});

test('[3.8.3] dzienny raport obiadów liczony z porannej frekwencji skrzyżowanej z kontami stołówkowymi', async () => {
  const stol = await S.as('stolowka');
  const base = expectOk(await stol.get('/api/modules/cafeteria/meal-report'));
  const b7 = base.rows.find((x) => x.classId === '7b');
  assert.equal(b7.enrolled, 12);
  /* liczby względem stanu zasiewu: w demo bywa już nieobecność na 1. lekcji (alert dla rodzica) */
  assert.equal(b7.portions, b7.enrolled - b7.absentMorning, 'porcje to zapisani minus nieobecni rano');

  /* kogo wypisać: ktoś, kto dziś jeszcze jest na liście wydawania (w demo część uczniów bywa już
     nieobecna rano, więc wybieramy ucznia z bieżącego stanu, a nie na sztywno) */
  const before = expectOk(await stol.get('/api/modules/cafeteria/serving-list?classId=7b'));
  const victim = before.rows.find((x) => x.serve).studentId;
  const mat = await S.as('j.nowak');
  expectOk(await mat.post('/api/attendance/lesson/les_tt_7b_5_1_2026-10-23', { entries: [{ studentId: victim, status: 'nb' }] }));
  const fiz = await S.as('a.wojcik');
  expectOk(await fiz.post('/api/attendance/lesson/les_tt_7b_5_2_2026-10-23', { entries: [{ studentId: victim, status: 'nb' }] }));

  const after = expectOk(await stol.get('/api/modules/cafeteria/meal-report'));
  const a7 = after.rows.find((x) => x.classId === '7b');
  assert.equal(a7.absentMorning, b7.absentMorning + 1, 'nieobecny rano wypada z liczby porcji');
  assert.equal(a7.portions, b7.portions - 1);
  assert.equal(after.totals.portions, base.totals.portions - 1);
  assert.match(after.source, /poranna frekwencja/);
  assert.equal(after.value, Math.round(after.totals.portions * S.db.data.config.mealPrice * 100) / 100);

  const serving = expectOk(await stol.get('/api/modules/cafeteria/serving-list?classId=7b'));
  assert.equal(serving.rows.find((x) => x.studentId === victim).serve, false);
  assert.match(serving.rows.find((x) => x.studentId === victim).reason, /nieobecny rano/);
  const present = serving.rows.find((x) => x.studentId !== victim && x.serve);
  assert.ok(present, 'uczniowie obecni rano nadal są na liście wydawania');
});

test('[3.8.4] blokada wydawania przy zaległości z dyskretnym powiadomieniem wyłącznie dla rodzica', async () => {
  const stol = await S.as('stolowka');
  const accounts = expectOk(await stol.get('/api/modules/cafeteria/accounts?overdue=1'));
  const maja = accounts.accounts.find((x) => x.studentId === MAJA);
  assert.ok(maja && maja.debt > 0);

  const noDebt = S.db.one('cafeteriaAccounts', (a) => a.studentId === ANNA);
  const refused = await stol.post(`/api/modules/cafeteria/accounts/${noDebt.id}/block`, {});
  assert.equal(refused.status, 400); assert.equal(refused.body.code, 'no_debt');

  const before = S.db.col('notifications').length;
  const r = expectOk(await stol.post(`/api/modules/cafeteria/accounts/${maja.id}/block`, {}));
  assert.equal(r.blocked, true);
  assert.equal(r.discreet, true);
  assert.equal(r.studentNotified, false);
  assert.equal(r.parentsNotified, 1);
  assert.deepEqual(r.parentUserIds, ['u_p_adamczyk']);

  const fresh = S.db.col('notifications').slice(before);
  assert.equal(fresh.length, 1, 'powstało dokładnie jedno powiadomienie');
  assert.equal(fresh[0].userId, 'u_p_adamczyk');
  assert.equal(S.db.col('notifications').some((n) => n.userId === 'u_' + MAJA), false, 'uczeń nie dostaje powiadomienia o długu');

  const serving = expectOk(await stol.get('/api/modules/cafeteria/serving-list?classId=7b'));
  const line = serving.rows.find((x) => x.studentId === MAJA);
  assert.equal(line.serve, false);
  assert.equal(line.blocked, true);
  assert.match(line.reason, /rozliczenia/);
  assert.match(serving.note, /nie pokazuje kwot/);

  const twice = await stol.post(`/api/modules/cafeteria/accounts/${maja.id}/block`, {});
  assert.equal(twice.status, 409);
});

test('[3.8.5] kierownik tworzy cyfrową kartę wycieczki z harmonogramem, listą, grupami i ubezpieczeniem', async () => {
  const c = await S.as('a.mazur');
  const bad = await c.post('/api/modules/trips', { name: 'Wyjazd bez polisy', from: '2026-11-04', to: '2026-11-04', classIds: ['3a'] });
  assert.equal(bad.status, 400); assert.equal(bad.body.code, 'no_insurance');

  const r = expectOk(await c.post('/api/modules/trips', {
    name: 'Zielona szkoła klasy 3a', from: '2026-11-04', to: '2026-11-04', classIds: ['3a'],
    insurance: { insurer: 'PZU SA', policyNo: 'POL/2026/114/902' },
    transport: 'Autokar · Trans-Bus', cost: 45,
    chaperones: [{ userId: 'u_mazur', groupNo: 1 }, { userId: 'u_kaczmarek', groupNo: 2 }],
    schedule: [{ day: '2026-11-04', text: 'Wyjazd 8:00, ognisko, powrót 16:00' }],
    groups: { st_kowalczyk_piotr: 2 }
  }));
  const t = r.trip;
  assert.equal(t.status, 'draft'); assert.equal(t.statusLabel, 'Wersja robocza');
  assert.equal(t.leader, 'mgr Anna Mazur');
  assert.equal(t.insurance.policyNo, 'POL/2026/114/902');
  assert.equal(t.schedule.length, 1);
  assert.equal(t.chaperones.length, 2);
  assert.equal(t.participantCount, 4, 'cała klasa 3a trafia na listę');
  assert.equal(t.students.find((s) => s.studentId === 'st_kowalczyk_piotr').groupNo, 2);
  state.newTrip = t.id;

  const print = await c.get(`/api/modules/trips/${t.id}/print`);
  assert.equal(print.status, 200);
  assert.match(print.body, /Karta wycieczki/);
  assert.match(print.body, /POL\/2026\/114\/902/);
  assert.match(print.body, /Harmonogram/);
});

test('[3.8.6] zatwierdzenie wycieczki przez dyrekcję nadaje uczestnikom status „w” na wszystkich lekcjach z dni wyjazdu', async () => {
  const leader = await S.as('a.mazur');
  const sub = expectOk(await leader.post(`/api/modules/trips/${TRIP}/submit`, {}));
  assert.equal(sub.trip.status, 'submitted');

  const dyr = await S.as('dyrektor');
  const ap = expectOk(await dyr.post(`/api/principal/trips/${TRIP}/approve`, { reason: 'Karta kompletna' }), 'zatwierdzenie 3.3');
  assert.equal(ap.trip.status, 'approved');
  assert.ok(ap.attendanceMarked > 0);

  const trip = S.db.get('trips', TRIP);
  const annaGroups = S.db.col('groups').filter((g) => (g.studentIds || []).includes(ANNA)).map((g) => g.id);
  for (const day of ['2026-11-05', '2026-11-06']) {
    const lessons = S.db.col('lessons').filter((l) => l.date === day && l.classId === '7b' && (!l.groupId || annaGroups.includes(l.groupId)));
    assert.ok(lessons.length > 0);
    for (const l of lessons) {
      const a = S.db.one('attendance', (x) => x.lessonId === l.id && x.studentId === ANNA);
      assert.ok(a, `wpis frekwencji ${l.id}`);
      assert.equal(a.status, 'w', 'status wycieczki na lekcji ' + l.lessonNo + ' ' + day);
    }
  }
  const notGoing = S.db.col('attendance').filter((a) => a.studentId === MAJA && a.date === '2026-11-05');
  assert.equal(notGoing.some((a) => a.status === 'w'), false, 'nieuczestnicząca uczennica nie dostaje statusu „w”');
  assert.equal(trip.studentIds.includes(MAJA), false);
});

test('[3.8.7] lista uczniów pozostających w szkole z przypisaniem do grup tymczasowych', async () => {
  const c = await S.as('a.mazur');             // kartę wycieczki prowadzi jej kierownik (S-17)
  const list = expectOk(await c.get(`/api/modules/trips/${TRIP}/non-participants`));
  assert.ok(list.students.length >= 2, 'są uczniowie klasy 7b poza wycieczką');
  assert.ok(list.students.some((s) => s.studentId === MAJA));
  assert.equal(list.students.every((s) => !s.tempGroup), true);
  assert.ok(list.options.some((o) => o.value === 'biblioteka'));
  assert.ok(list.options.some((o) => o.value === 'class:7a'));

  const ids = list.students.map((s) => s.studentId);
  const r = expectOk(await c.post(`/api/modules/trips/${TRIP}/non-participants`, {
    assignments: [
      { studentId: ids[0], tempGroup: 'class:7a', reason: 'Brak zgody opiekuna' },
      { studentId: ids[1], tempGroup: 'biblioteka', reason: 'Zwolnienie lekarskie' }
    ]
  }));
  assert.equal(r.assigned.length, 2);
  assert.equal(r.unassigned, ids.length - 2);

  const after = expectOk(await c.get(`/api/modules/trips/${TRIP}/non-participants`));
  const first = after.students.find((s) => s.studentId === ids[0]);
  assert.equal(first.tempGroup, 'class:7a');
  assert.match(first.tempGroupLabel, /7a/);
  assert.equal(first.reason, 'Brak zgody opiekuna');
  assert.equal(first.assignedBy, 'mgr Anna Mazur');

  const wrong = await c.post(`/api/modules/trips/${TRIP}/non-participants`, { studentId: ANNA, tempGroup: 'swietlica' });
  assert.equal(wrong.status, 400); assert.equal(wrong.body.code, 'is_participant');

  /* S-17: nauczyciel spoza karty wycieczki widzi listę, ale nie przestawia opieki nad uczniami. */
  const obcy = await S.as('j.nowak');
  expectOk(await obcy.get(`/api/modules/trips/${TRIP}/non-participants`), 'wykaz pozostaje jawny dla grona');
  const denied = await obcy.post(`/api/modules/trips/${TRIP}/non-participants`, { studentId: ids[0], tempGroup: 'swietlica' });
  assert.equal(denied.status, 403); assert.equal(denied.body.code, 'not_trip_leader');
  assert.equal(S.db.get('trips', TRIP).nonParticipants[ids[0]].tempGroup, 'class:7a', 'przypisanie kierownika zostaje nienaruszone');
});

test('[3.8.8] biblioteka wypożycza komplet podręczników całej klasie skanowaniem kodów kreskowych', async () => {
  const c = await S.as('biblioteka');
  const items = expectOk(await c.get('/api/modules/library/items?level=7'));
  assert.ok(items.items.length >= 4);
  const codes = ['9788301234581', '9788301234598'];   // fizyka + j. polski

  const unknown = await c.post('/api/modules/library/batch-checkout', { classId: '7b', barcodes: ['0000000000000'] });
  assert.equal(unknown.status, 404); assert.equal(unknown.body.code, 'unknown_barcode');

  const roster = S.db.get('classes', '7b').studentIds.length;
  const before = S.db.col('libraryLoans').length;
  const r = expectOk(await c.post('/api/modules/library/batch-checkout', { classId: '7b', barcodes: codes, dueDate: '2027-01-20' }));
  assert.equal(r.students, roster);
  assert.equal(r.titles.length, 2);
  assert.equal(r.created + r.skipped, roster * 2, 'komplet dwóch pozycji dla każdego ucznia klasy');
  assert.ok(r.skipped >= 1, 'pozycja już wypożyczona nie dubluje się');
  assert.equal(S.db.col('libraryLoans').length, before + r.created);
  assert.match(r.confirmation, /Termin zwrotu: 20\.01\.2027/);

  const loans = expectOk(await c.get('/api/modules/library/loans?classId=7b&open=1'));
  assert.ok(loans.loans.filter((l) => l.studentId === ANNA).length >= 2);
  assert.ok(S.db.col('audit').some((a) => a.action === 'library_batch_checkout'));
});

test('[3.8.9] rozliczenie materiałów przed wydaniem świadectw wskazuje zalegających uczniów', async () => {
  const bib = await S.as('biblioteka');
  const before = expectOk(await bib.get('/api/modules/library/settlement?classId=7b'));
  assert.ok(before.unsettled >= 1);
  const anna = before.students.find((s) => s.studentId === ANNA);
  assert.equal(anna.settled, false);
  assert.ok(anna.outstanding.length >= 1);
  assert.ok(anna.outstanding[0].title);
  assert.equal(anna.certificateBlocked, true);
  assert.ok(before.blockedStudentIds.includes(ANNA));

  // po zwrocie wszystkich pozycji uczeń jest rozliczony
  const open = expectOk(await bib.get('/api/modules/library/loans?studentId=' + JAN + '&open=1'));
  for (const l of open.loans) expectOk(await bib.post(`/api/modules/library/loans/${l.id}/return`, {}));
  const jan = expectOk(await bib.get('/api/modules/library/settlement?studentId=' + JAN)).student;
  assert.equal(jan.settled, true);
  assert.equal(jan.outstandingCount, 0);
  assert.equal(jan.detail, 'komplet zwrócony');

  // sekretariat i wychowawca korzystają z tego samego widoku przed świadectwami
  const sek = await S.as('sekretariat');
  const view = expectOk(await sek.get('/api/modules/library/settlement?classId=7b'));
  assert.equal(view.settled + view.unsettled, S.db.get('classes', '7b').studentIds.length);
  assert.equal(view.students.find((s) => s.studentId === JAN).settled, true);
  assert.equal((await (await S.as('anna.kowalczyk')).get('/api/modules/library/settlement?classId=7b')).status, 403);
});

test('[3.8.10] wizyta w gabinecie jest dostępna wyłącznie pielęgniarce i opiekunom, a każdy wgląd zostaje w rejestrze', async () => {
  const nurse = await S.as('pielegniarka');
  const r = expectOk(await nurse.post('/api/modules/nurse/visits', {
    studentId: ANNA, kind: 'otarcie', time: '11:20',
    description: 'Otarcie kolana na przerwie.', aid: 'Przemycie, opatrunek, powrót na lekcję.', outcome: 'return'
  }));
  assert.match(r.visit.no, /^GAB\/2026\//);
  assert.equal(r.visit.kindLabel, 'Otarcie lub skaleczenie');
  assert.deepEqual(r.privacy.readers, ['nurse', 'parent']);
  assert.equal(r.privacy.inLessonLog, false);
  const id = r.visit.id;

  assert.equal(expectOk(await nurse.get('/api/modules/nurse/visits/' + id)).visit.studentId, ANNA);

  const teacher = await S.as('j.nowak');
  const t = await teacher.get('/api/modules/nurse/visits/' + id);
  assert.equal(t.status, 403); assert.equal(t.body.code, 'health_forbidden');
  const dyr = await S.as('dyrektor');
  assert.equal((await dyr.get('/api/modules/nurse/visits?studentId=' + ANNA)).status, 403);

  const rodzic = await S.as('rodzic.kowalczyk');
  const mine = expectOk(await rodzic.get('/api/modules/nurse/visits?studentId=' + ANNA));
  assert.ok(mine.visits.some((v) => v.id === id));
  const obcy = await S.as('rodzic.nowak');
  assert.equal((await obcy.get('/api/modules/nurse/visits?studentId=' + ANNA)).status, 403);

  const log = expectOk(await nurse.get('/api/modules/nurse/access-log')).log;
  assert.ok(log.some((x) => x.userId === 'u_nowak' && x.allowed === false), 'odmowa dla nauczyciela w rejestrze');
  assert.ok(log.some((x) => x.userId === 'u_p_kowalczyk' && x.allowed === true), 'wgląd opiekuna w rejestrze');
  assert.ok(S.db.col('audit').some((a) => a.action === 'health_record_denied'));
  assert.ok(S.db.col('audit').some((a) => a.action === 'health_record_read'));
});

/* ------------------------------------------------------------------ GAP-5 (docs/PILOT.md §4)
   Konta stołówkowe i stan biblioteki umiał do tej rundy wypełnić wyłącznie zasiew demo, więc
   w nowej szkole raport obiadów, blokada przy zaległości i wypożyczenie kompletu czytały puste
   kolekcje. Te testy bronią tras zakładania danych. */

test('[3.8.3] GAP-5: konto stołówkowe zakłada się oddziałowi albo pojedynczemu uczniowi', async () => {
  const c = await S.as('stolowka');
  const before = S.db.col('cafeteriaAccounts').length;
  const cls = S.db.get('classes', '8b');
  const r = expectOk(await c.post('/api/modules/cafeteria/accounts', { classId: '8b', mealPlan: 'obiad', mealPrice: 5.5, period: 'listopad 2026' }));
  assert.equal(r.created, (cls.studentIds || []).length, 'konto dla każdego ucznia oddziału');
  assert.equal(r.skipped, 0);
  assert.ok(r.accounts.every((a) => a.mealPlan === 'obiad' && a.mealPrice === 5.5));
  assert.equal(S.db.col('cafeteriaAccounts').length, before + r.created);
  assert.ok(S.db.col('audit').some((a) => a.action === 'cafeteria_accounts_created' && a.entityId === '8b'));

  // ten sam oddział drugi raz: nikogo nie dubluje
  const again = expectOk(await c.post('/api/modules/cafeteria/accounts', { classId: '8b' }));
  assert.equal(again.created, 0);
  assert.equal(again.skipped, r.created);
  assert.equal(S.db.col('cafeteriaAccounts').length, before + r.created);

  // pojedynczy uczeń, który konta jeszcze nie ma
  const lone = S.db.col('students').find((s) => s.status !== 'removed' && !S.db.col('cafeteriaAccounts').some((a) => a.studentId === s.id));
  if (lone) {
    const one = expectOk(await c.post('/api/modules/cafeteria/accounts', { studentId: lone.id, mealPlan: 'obiad + podwieczorek', mealPrice: 7 }));
    assert.equal(one.created, 1);
    assert.equal(one.accounts[0].studentId, lone.id);
  }

  // zmiana planu i salda; saldo ujemne to zaległość, a nie błąd walidacji
  const acc = r.accounts[0];
  const patched = expectOk(await c.patch('/api/modules/cafeteria/accounts/' + acc.id, { mealPrice: 6, balance: -24 }));
  assert.equal(patched.account.mealPrice, 6);
  assert.equal(patched.account.balance, -24);
  assert.equal(S.db.get('cafeteriaAccounts', acc.id).overdueSince, S.db.data.config.today);
  const badPrice = await c.patch('/api/modules/cafeteria/accounts/' + acc.id, { mealPrice: -1 });
  assert.equal(badPrice.status, 400); assert.equal(badPrice.body.code, 'bad_amount');

  // zaległe konto natychmiast widać tam, gdzie stołówka jej szuka
  const overdue = expectOk(await c.get('/api/modules/cafeteria/accounts?overdue=1'));
  assert.ok(overdue.accounts.some((x) => x.id === acc.id));
  assert.ok(overdue.classes.some((x) => x.id === '8b' && x.withAccount > 0), 'lista oddziałów dla ekranu zakładania kont');
});

test('[3.8.8] GAP-5: stan biblioteki wprowadza się pozycją albo wklejonym arkuszem', async () => {
  const c = await S.as('biblioteka');
  const one = expectOk(await c.post('/api/modules/library/items', { barcode: 'T-4400001', title: 'Historia 8 · podręcznik', kind: 'textbook', subject: 'his', level: 8, set: 'Komplet klasy 8' }));
  assert.equal(one.item.barcode, 'T-4400001');
  assert.equal(one.item.kind, 'textbook');
  assert.equal(one.item.status, 'available');
  assert.ok(S.db.col('audit').some((a) => a.action === 'library_item_create' && a.entityId === one.item.id));

  const dup = await c.post('/api/modules/library/items', { barcode: 'T-4400001', title: 'To samo', kind: 'textbook' });
  assert.equal(dup.status, 409); assert.equal(dup.body.code, 'duplicate_barcode');

  const csv = ['barcode;title;kind', 'T-4400002;Lalka;reading', 'T-4400003;Atlas geograficzny;book', 'T-4400001;Historia 8 · podręcznik (wyd. 2);textbook'].join('\n');
  const dry = expectOk(await c.post('/api/modules/library/items', { csv, dryRun: true }));
  assert.equal(dry.applied, false);
  assert.equal(dry.created, 2); assert.equal(dry.updated, 1, 'ten sam kod kreskowy aktualizuje, nie dubluje');
  assert.equal(S.db.col('libraryItems').filter((x) => x.barcode === 'T-4400002').length, 0, 'próbny przebieg niczego nie zapisał');

  const real = expectOk(await c.post('/api/modules/library/items', { csv }));
  assert.equal(real.created, 2); assert.equal(real.updated, 1);
  assert.equal(S.db.col('libraryItems').filter((x) => x.barcode === 'T-4400001').length, 1, 'nadal jedna pozycja o tym kodzie');
  assert.match(S.db.one('libraryItems', (x) => x.barcode === 'T-4400001').title, /wyd\. 2/);
  assert.equal(S.db.one('libraryItems', (x) => x.barcode === 'T-4400002').kind, 'reading');

  const bad = await c.post('/api/modules/library/items', { csv: 'barcode;title;kind\nT-4400009;Zła pozycja;czasopismo' });
  assert.equal(bad.status, 400); assert.equal(bad.body.code, 'import_errors');
  assert.equal(bad.body.errors[0].line, 2);

  // wprowadzona pozycja jest od razu do wypożyczenia
  const loan = expectOk(await c.post('/api/modules/library/batch-checkout', { classId: '8b', barcodes: ['T-4400002'] }));
  assert.ok(loan.created >= 1);
  assert.ok(loan.loans.every((l) => l.barcode === 'T-4400002'));

  // nauczyciel nie zakłada stanu biblioteki
  const teacher = await S.as('j.nowak');
  const denied = await teacher.post('/api/modules/library/items', { barcode: 'T-9999999', title: 'Nie wolno', kind: 'book' });
  assert.equal(denied.status, 403);
});
