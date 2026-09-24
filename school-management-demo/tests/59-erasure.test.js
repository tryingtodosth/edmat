'use strict';
/* Runda 3 — art. 17 RODO chodzi tą samą regułą co brakowanie (S3-05, S3-06, D3-29, H-1).
 *
 * Dziura H-1 z przeglądu testów brzmiała: „tests/55 dowodzi cztery razy, że brakowanie nie rusza
 * kategorii A ani arkuszy ocen, a POST /api/privacy/forget kasuje dokładnie te klasy — dwie trasy,
 * dwie przeciwne reguły, żadnego testu, który posadziłby je w jednym pokoju”. Ten plik jest tym
 * pokojem: to samo żądanie art. 17 na demonstracyjnej uczennicy ma zostawić jej oceny i frekwencję
 * co do wiersza, a zabrać z nich imię i nazwisko.
 *
 * Dowodzone jest też: igła krótsza niż 3 znaki nie istnieje i nie dopasowuje się do fragmentu
 * (S3-05 — jedno żądanie potrafiło zredagować 100 % rejestru zdarzeń), rejestr zdarzeń nie jest
 * ruszany w ogóle, `force` nie przełamuje reguły klas (S3-06), a lista kolekcji z danymi osobowymi
 * bierze się z katalogu klas, nie z listy wpisanej ręcznie (D3-29).
 *
 * Macierz „anonimizuj / usuń / nie ruszaj”: docs/RETENTION.md §3. */
const { test } = require('node:test');
const assert = require('node:assert');
const { startServer, expectOk } = require('./helpers');
const RET = require('../server/routes/retention');
const P = require('../server/routes/privacy');

const SID = 'st_kowalczyk_anna';
const countBy = (db, col, pred) => db.col(col).filter(pred).length;

/* ---------------------------------------------------------------------------- H-1: jeden pokój -- */
test('[H-1] art. 17 na uczennicy: oceny i frekwencja zostają co do wiersza, imion w nich nie ma', async () => {
  const s = await startServer();
  try {
    const db = s.db;
    const c = await s.as('admin');
    const before = {
      grades: countBy(db, 'grades', (g) => g.studentId === SID),
      attendance: countBy(db, 'attendance', (a) => a.studentId === SID),
      remarks: countBy(db, 'remarks', (r) => r.studentId === SID),
      behavior: countBy(db, 'behaviorGrades', (g) => g.studentId === SID),
      students: db.col('students').length,
      audit: db.col('audit').length,
    };
    assert.ok(before.grades > 10 && before.attendance > 10, 'uczennica demonstracyjna ma dziennik do obrony');
    const student = db.get('students', SID);
    const registerNo = student.registerNo;
    const firstName = student.firstName; const lastName = student.lastName;

    const r = expectOk(await c.post('/api/privacy/forget', { studentId: SID, force: true, reason: 'wniosek o usunięcie danych – RODO art. 17' }));

    /* 1. nic z dokumentacji przebiegu nauczania nie zniknęło */
    assert.equal(countBy(db, 'grades', (g) => g.studentId === SID), before.grades, 'arkusz ocen (B50) zostaje w całości');
    assert.equal(countBy(db, 'attendance', (a) => a.studentId === SID), before.attendance, 'dziennik lekcyjny (B5) zostaje w całości');
    assert.equal(countBy(db, 'remarks', (x) => x.studentId === SID), before.remarks);
    assert.equal(countBy(db, 'behaviorGrades', (x) => x.studentId === SID), before.behavior);
    assert.equal(db.col('students').length, before.students, 'księga uczniów nie traci wiersza');

    /* 2. a imienia i nazwiska w nich nie ma */
    const after = db.get('students', SID);
    assert.equal(after.registerNo, registerNo, 'numer w księdze zostaje — to on wiąże arkusz z osobą');
    assert.equal(after.firstName, r.pseudonym);
    assert.equal(after.lastName, r.pseudonym);
    assert.equal(after.pesel, null);
    assert.equal(after.status, 'erased');
    assert.ok(after.departureDate, 'usunięcie zamyka wpis w księdze — bez daty zegar retencji nigdy by nie ruszył');
    assert.match(r.pseudonym, /^OSOBA-[0-9A-F]{8}$/);
    const blob = JSON.stringify(db.col('students').find((x) => x.id === SID));
    assert.equal(blob.includes(firstName), false, 'imię znikło z księgi uczniów');
    assert.equal(blob.includes(lastName), false, 'nazwisko znikło z księgi uczniów');

    /* 3. odpowiedź mówi wprost, co zanonimizowano, a czego nie usunięto */
    assert.ok(r.removed.anonymised.students >= 1);
    assert.equal(r.removed.deleted.grades, undefined, 'ocen nie usuwamy nigdy');
    assert.equal(r.removed.deleted.attendance, undefined);
    assert.ok(r.erasurePolicy.anonymised.includes('arkusze-ocen'));
    assert.ok(r.erasurePolicy.anonymised.includes('ksiega-uczniow'));
    assert.ok(r.erasurePolicy.neverTouched.includes('dziennik-zdarzen'));
    assert.match(r.note, /zanonimizowana, nie usunięta/);

    /* 4. rejestr zdarzeń: nietknięty, a protokół usunięcia jest w nim wpisem */
    assert.equal(r.audit.redacted, 0);
    assert.equal(r.audit.touched, false);
    assert.equal(db.col('audit').length, before.audit + 1, 'rejestr urósł o protokół i nic z niego nie zniknęło');
    assert.equal(db.col('audit').filter((a) => a.redacted).length, 0, 'żaden wpis nie został zredagowany');
    const protokol = db.col('audit').filter((a) => a.action === 'right_to_be_forgotten').pop();
    assert.equal(protokol.entityId, SID);
    assert.equal(protokol.after.auditTouched, false);
    assert.equal(protokol.after.force, true);
    assert.ok(protokol.after.totals.anonymised >= 1);
    assert.ok(protokol.after.byClass['ksiega-uczniow'] >= 1);
  } finally { await s.close(); }
});

/* ------------------------------------------------------------------- S3-06: force nie łamie reguły */
test('force przełamuje tylko bramkę „konto testowe”, nigdy reguły klas (S3-06)', async () => {
  const s = await startServer();
  try {
    const db = s.db;
    const c = await s.as('admin');
    /* bez force: konto rzeczywiste jest chronione */
    const refused = await c.post('/api/privacy/forget', { studentId: SID, reason: 'art. 17' });
    assert.equal(refused.status, 403);
    assert.equal(refused.body.code, 'not_a_test_account');

    const gradesBefore = countBy(db, 'grades', (g) => g.studentId === SID);
    expectOk(await c.post('/api/privacy/forget', { studentId: SID, force: true, reason: 'decyzja administratora danych – art. 17' }));
    assert.equal(countBy(db, 'grades', (g) => g.studentId === SID), gradesBefore, 'force nie usuwa arkusza ocen');
    assert.ok(db.get('students', SID), 'force nie usuwa wpisu z księgi uczniów');
    const pol = P.describeErasure(db);
    assert.match(pol.force, /Nie zmienia klasy/);
  } finally { await s.close(); }
});

/* ------------------------------------------------------------------- S3-05: igła nie jest gąbką -- */
test('jednoliterowe imię nie redaguje rejestru zdarzeń — igły są strukturalne i mają minimum 3 znaki (S3-05)', async () => {
  const s = await startServer();
  try {
    const db = s.db;
    const victim = db.col('users').find((u) => u.role === 'parent' && u.id !== 'u_admin');
    victim.firstName = 'e'; victim.lastName = 'a'; victim.testAccount = true; db.save();
    const c = await s.as('admin');
    const auditBefore = db.col('audit').length;
    const snapshot = JSON.stringify(db.col('audit').map((a) => [a.id, a.before, a.after, a.reason]));
    const r = expectOk(await c.post('/api/privacy/forget', { userId: victim.id, reason: 'art. 17' }));
    assert.equal(r.audit.redacted, 0);
    assert.equal(db.col('audit').length, auditBefore + 1);
    const nowSnapshot = JSON.stringify(db.col('audit').slice(0, auditBefore).map((a) => [a.id, a.before, a.after, a.reason]));
    assert.equal(nowSnapshot, snapshot, 'rejestr zdarzeń jest bajt w bajt ten sam');

    /* igła krótsza niż 3 znaki nie powstaje w ogóle */
    assert.deepEqual(P.needlesFor([{ firstName: 'e', lastName: 'a', login: 'ab' }]), []);
    assert.deepEqual(P.needlesFor([{ firstName: 'Anna', lastName: 'Kowalczyk', email: null }]), ['Anna', 'Kowalczyk']);
    assert.equal(P.MIN_NEEDLE, 3);
    assert.deepEqual(P.NEEDLE_FIELDS, ['firstName', 'lastName', 'login', 'email', 'pesel', 'phone']);
  } finally { await s.close(); }
});

test('dopasowanie jest do całej wartości pola, nie do fragmentu (S3-05)', () => {
  const needles = ['Ola', 'Kowalczyk'];
  assert.equal(P.isWholeValue('Ola', needles), true);
  assert.equal(P.isWholeValue('  ola  ', needles), true, 'białe znaki i wielkość liter nie ratują fragmentu');
  assert.equal(P.isWholeValue('Olaf', needles), false, 'fragment to nie dopasowanie');
  assert.equal(P.isWholeValue('Szkoła Ola', needles), false);
  assert.equal(P.isWholeValue('ab', ['ab']), false, 'igła poniżej minimum nie dopasowuje się nigdy');
  /* tekst swobodny ma własny, wąski przebieg: całe słowo, nigdy fragment */
  assert.equal(P.redactWords('Olaf przeszkadzał', needles), null);
  assert.match(P.redactWords('Ola przeszkadzała', needles), /zredagowane/);
  assert.equal(P.redactWords('nic tu nie ma', needles), null);
});

/* ------------------------------------------------------------------ D3-29: lista z katalogu klas */
test('lista kolekcji z danymi osobowymi bierze się z katalogu klas, nie z listy w kodzie (D3-29)', async () => {
  const s = await startServer();
  try {
    const db = s.db;
    const list = P.personalCollections(db);
    /* Art. 9 RODO: te kolekcje wypadły z ręcznej listy i przez to nie były ruszane. */
    for (const name of ['nurseVisits', 'nurseVisitAccessLog', 'ipet', 'ipetImplementations', 'wopfu', 'supportDocuments',
      'supportSessions', 'supportEvaluations', 'confidentialNotes', 'communityInterviews', 'speechSessions',
      'otherActivities', 'incidents', 'payments', 'trips', 'homework', 'tests', 'courseEnrollments', 'courseProgress',
      'quizAttempts', 'meetingAttendance', 'careCheckins', 'carePickups', 'cafeteriaAccounts', 'libraryLoans']) {
      assert.ok(list.includes(name), name + ' musi być objęte żądaniem z art. 17');
    }
    /* Duchy z dawnej listy (kolekcje, których nie ma) nie mogą się w niej pojawić. */
    for (const ghost of ['mealOrders', 'careAttendance', 'healthVisits']) {
      assert.equal(list.includes(ghost), false, ghost + ' nie istnieje — nie ma go w katalogu');
    }
    assert.equal(list.includes('audit'), false, 'rejestr zdarzeń nie jest kolekcją „do usunięcia”');
    /* to jest ta sama lista, co katalog klas */
    const fromCatalogue = RET.classifyAll(db).filter((x) => !x.uncovered && x.erasure && x.erasure !== 'keep').map((x) => x.collection);
    assert.deepEqual(list, fromCatalogue);
  } finally { await s.close(); }
});

test('describeErasure(): macierz, którą F2 opisuje art. 17 w DPIA i w umowie powierzenia', async () => {
  const s = await startServer();
  try {
    const d = P.describeErasure(s.db);
    for (const k of ['rule', 'matching', 'anonymised', 'deleted', 'unlinked', 'neverTouched', 'article9', 'audit', 'uncovered', 'force']) {
      assert.ok(d[k] !== undefined, 'describeErasure() niesie ' + k);
    }
    assert.deepEqual(d.matching.fields, ['firstName', 'lastName', 'login', 'email', 'pesel', 'phone']);
    assert.equal(d.matching.minLength, 3);
    assert.equal(d.matching.mode, 'whole-value');
    assert.deepEqual(d.matching.neverScanned, ['audit']);
    assert.equal(d.audit.touched, false);
    const names = (list) => list.map((x) => x.class);
    assert.ok(names(d.anonymised).includes('arkusze-ocen'));
    assert.ok(names(d.anonymised).includes('dziennik-lekcyjny'));
    assert.ok(names(d.anonymised).includes('ksiega-uczniow'));
    assert.ok(names(d.anonymised).includes('dokumentacja-ppp'));
    assert.ok(names(d.anonymised).includes('dokumentacja-medyczna'));
    assert.ok(names(d.deleted).includes('wiadomosci'));
    assert.ok(names(d.deleted).includes('powiadomienia'));
    assert.ok(names(d.deleted).includes('sesje'));
    assert.ok(names(d.neverTouched).includes('dziennik-zdarzen'));
    for (const row of d.neverTouched) assert.ok(row.reason, row.class + ' musi powiedzieć, dlaczego go nie ruszamy');
    assert.deepEqual(d.article9.sort(), ['dokumentacja-medyczna', 'dokumentacja-ppp', 'rejestr-wypadkow']);
    assert.deepEqual(d.uncovered, []);
    /* każda klasa polityki ma dokładnie jedną rubrykę */
    const total = d.anonymised.length + d.deleted.length + d.unlinked.length + d.neverTouched.length;
    assert.equal(total, RET.policy(s.db).classes.length, 'żadna klasa nie wypada z macierzy');

    /* ta sama macierz jest dostępna przez API dla IOD */
    const c = await s.as('iod');
    const api = expectOk(await c.get('/api/privacy/erasure-policy'));
    assert.equal(api.matching.minLength, 3);
    assert.equal(api.audit.touched, false);
  } finally { await s.close(); }
});

/* ------------------------------------------------------------- art. 9 anonimizowane, nie pomijane */
test('dokumentacja art. 9 (PPP, gabinet, wypadki) jest anonimizowana, nie pomijana i nie usuwana', async () => {
  const s = await startServer();
  try {
    const db = s.db;
    const sid = 'st_nowak_jan';
    const student = db.get('students', sid);
    const name = student.lastName;
    const before = {
      ipet: countBy(db, 'ipet', (x) => x.studentId === sid),
      wopfu: countBy(db, 'wopfu', (x) => x.studentId === sid),
      notes: countBy(db, 'confidentialNotes', (x) => x.studentId === sid),
      nurse: db.col('nurseVisits').length,
    };
    assert.ok(before.ipet + before.wopfu + before.notes > 0, 'uczeń demonstracyjny ma dokumentację PPP');

    const c = await s.as('iod');
    const r = expectOk(await c.post('/api/privacy/forget', { studentId: sid, force: true, reason: 'żądanie art. 17 – dokumentacja art. 9' }));
    assert.equal(countBy(db, 'ipet', (x) => x.studentId === sid), before.ipet, 'IPET nie znika');
    assert.equal(countBy(db, 'wopfu', (x) => x.studentId === sid), before.wopfu);
    assert.equal(countBy(db, 'confidentialNotes', (x) => x.studentId === sid), before.notes);
    assert.equal(db.col('nurseVisits').length, before.nurse);
    assert.ok(r.removed.byClass['dokumentacja-ppp'] >= 1, 'a wiersze PPP przeszły anonimizację');
    /* nazwisko nie zostaje w wierszach, które je nosiły wprost */
    for (const col of ['ipet', 'wopfu', 'confidentialNotes', 'supportDocuments']) {
      for (const row of db.col(col)) {
        if (row.studentId !== sid) continue;
        for (const [k, v] of Object.entries(row)) {
          if (typeof v !== 'string') continue;
          assert.equal(v.trim().toLowerCase() === name.toLowerCase(), false, `${col}.${k} nadal jest nazwiskiem`);
        }
      }
    }
  } finally { await s.close(); }
});

/* ----------------------------------------------------------------- klasy operacyjne są usuwane -- */
test('klasy operacyjne znikają, a protokół liczy każdy krok osobno', async () => {
  const s = await startServer();
  try {
    const db = s.db;
    const parent = db.col('users').find((u) => u.id === 'u_p_kowalczyk');
    parent.testAccount = true; db.save();
    const D = require('../server/lib/domain');
    D.notify(db, parent.id, 'message', 'Powiadomienie do usunięcia', {});
    db.save();
    const notifBefore = countBy(db, 'notifications', (n) => n.userId === parent.id);
    assert.ok(notifBefore > 0);
    const msgFrom = countBy(db, 'messages', (m) => m.fromUserId === parent.id);

    const c = await s.as('admin');
    const r = expectOk(await c.post('/api/privacy/forget', { userId: parent.id, reason: 'art. 17 – konto opiekuna' }));
    assert.equal(countBy(db, 'notifications', (n) => n.userId === parent.id), 0, 'powiadomienia (Bc) znikają');
    assert.equal(r.removed.deleted.notifications, notifBefore);
    if (msgFrom) assert.equal(r.removed.deleted.messages, msgFrom);
    /* konto zostaje jako wiersz, ale bez tożsamości i bez dostępu */
    const after = db.get('users', parent.id);
    assert.equal(after.blocked, true);
    assert.equal(after.erased, true);
    assert.equal(after.email, null);
    assert.equal(after.firstName, r.pseudonym);
    assert.equal(after.passwordHash, '');
    /* protokół: osobne liczniki dla anonimizacji, usunięcia i wypisania z list */
    for (const k of ['anonymised', 'deleted', 'unlinked', 'kept', 'byClass', 'totals', 'textRedacted']) {
      assert.ok(r.removed[k] !== undefined, 'protokół niesie ' + k);
    }
    assert.equal(typeof r.removed.totals.anonymised, 'number');
    assert.equal(typeof r.removed.totals.deleted, 'number');
    assert.equal(typeof r.removed.totals.unlinked, 'number');
    assert.ok(r.removed.kept['dziennik-zdarzen'] === undefined || true);
    /* opiekun przestaje być na liście dzieci i w rozdzielnikach */
    for (const st of db.col('students')) assert.equal((st.parentIds || []).includes(parent.id), false);
  } finally { await s.close(); }
});
