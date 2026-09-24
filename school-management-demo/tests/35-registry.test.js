'use strict';
const test = require('node:test'); const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { startServer, expectOk, DEMO_PASSWORD } = require('./helpers');
const { validatePesel } = require('../server/lib/util');

let S; test.before(async () => { S = await startServer(); }); test.after(() => S.close());

/** Syntetyczny, poprawny PESEL: rrmmdd + seria + płeć + suma kontrolna. */
function pesel(yy, mm, dd, serial, male) {
  const base = `${String(yy).padStart(2, '0')}${String(mm + 20).padStart(2, '0')}${String(dd).padStart(2, '0')}${String(serial).padStart(3, '0')}${male ? 1 : 2}`;
  const w = [1, 3, 7, 9, 1, 3, 7, 9, 1, 3];
  return base + ((10 - (w.reduce((s, wi, i) => s + wi * +base[i], 0) % 10)) % 10);
}
/** Ten sam numer z popsutą cyfrą kontrolną. */
const breakChecksum = (p) => p.slice(0, 10) + ((+p[10] + 1) % 10);

/* ------------------------------------------------------------------------------- 3.5.1 */
test('[3.5.1] sekretariat wpisuje ucznia do księgi: błędny PESEL wskazuje pozycję cyfry, poprawny nadaje numer księgi', async () => {
  const c = await S.as('sekretariat');
  const good = pesel(19, 3, 12, 742, false);                       // ur. 2019-03-12
  assert.equal(validatePesel(good).ok, true);

  // 1. zła suma kontrolna — komunikat nazywa pozycję cyfry
  const bad = await c.post('/api/registry/students', { firstName: 'Maja', lastName: 'Adamczewska', identityKind: 'pesel', pesel: breakChecksum(good), birthDate: '2019-03-12', birthPlace: 'Kraków', classId: '1a', mother: 'Adamczewska Katarzyna' });
  assert.equal(bad.status, 400);
  assert.equal(bad.body.position, 11);
  assert.match(bad.body.error, /pozycji 11/);

  // 2. PESEL poprawny, ale data urodzenia w formularzu inna — kontrola krzyżowa
  const cross = await c.post('/api/registry/students', { firstName: 'Maja', lastName: 'Adamczewska', identityKind: 'pesel', pesel: good, birthDate: '2019-03-13', birthPlace: 'Kraków', classId: '1a', mother: 'Adamczewska Katarzyna' });
  assert.equal(cross.status, 400);
  assert.equal(cross.body.expectedBirthDate, '2019-03-12');
  assert.match(cross.body.error, /1–6/);

  // 3. poprawny wpis
  const before = expectOk(await c.get('/api/registry/students'));
  const ok = expectOk(await c.post('/api/registry/students', { firstName: 'Maja', lastName: 'Adamczewska', identityKind: 'pesel', pesel: good, birthDate: '2019-03-12', birthPlace: 'Kraków', classId: '1a', mother: 'Adamczewska Katarzyna', father: 'Adamczewski Marcin', phone: '512 044 187', email: 'k.adamczewska@example.org', address: 'ul. Lea 114/3, 30-133 Kraków' }));
  assert.equal(ok.registerNo, before.nextRegisterNo);
  assert.equal(ok.student.birthDate, '2019-03-12');
  assert.equal(ok.student.sex, 'K');
  assert.equal(ok.student.status, 'active');
  assert.ok(S.db.get('classes', '1a').studentIds.includes(ok.student.id));
  assert.ok(S.db.col('audit').some((a) => a.action === 'registry_student_created' && a.entityId === ok.student.id));

  // 4. cudzoziemiec bez numeru PESEL — paszport i kod kraju
  const foreign = expectOk(await c.post('/api/registry/students', { firstName: 'Sofia', lastName: 'Melnyk', identityKind: 'passport', passport: 'FE998211', passportCountry: 'UA', birthDate: '2019-05-04', birthPlace: 'Lwów', classId: '1a', mother: 'Melnyk Olena' }));
  assert.equal(foreign.student.foreigner, true);
  assert.equal(foreign.student.pesel, null);
  const noCountry = await c.post('/api/registry/students', { firstName: 'Ivan', lastName: 'Melnyk', identityKind: 'passport', passport: 'FE998212', birthDate: '2019-05-04', birthPlace: 'Lwów', classId: '1a', mother: 'Melnyk Olena' });
  assert.equal(noCountry.status, 400);
  assert.equal(noCountry.body.field, 'passportCountry');

  // walidacja na żywo pod formularzem
  const live = expectOk(await c.post('/api/registry/pesel/check', { pesel: breakChecksum(good) }));
  assert.equal(live.ok, false); assert.equal(live.position, 11);
});

/* ------------------------------------------------------------------------------- 3.5.2 */
test('[3.5.2] legitymacja cyfrowa z kodem autoryzacyjnym mObywatel, poprzednia zostaje unieważniona', async () => {
  const c = await S.as('sekretariat');
  const r1 = expectOk(await c.post('/api/registry/students/st_nowak_jan/student-id'));
  assert.match(r1.code, /^[A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{4}$/);
  assert.equal(r1.studentId.status, 'issued');
  assert.equal(r1.studentId.app, 'mObywatel');
  assert.match(r1.validTo, /^2027-09-30$/);

  const r2 = expectOk(await c.post('/api/registry/students/st_nowak_jan/student-id'));
  assert.notEqual(r2.code, r1.code);
  const all = expectOk(await c.get('/api/registry/student-ids')).studentIds.filter((x) => x.studentId === 'st_nowak_jan');
  assert.equal(all.filter((x) => x.status === 'issued').length, 1);
  assert.ok(all.some((x) => x.status === 'revoked'));
  assert.ok(S.db.col('audit').some((a) => a.action === 'student_id_issued'));
});

/* ------------------------------------------------------------------------------- 3.5.3 */
test('[3.5.3] pakiet SIO: XML poprawny składniowo, z RSPO, oddziałami i liczbą uczniów; walidacja zwraca listę błędów', async () => {
  const c = await S.as('sekretariat');
  const val = expectOk(await c.post('/api/registry/sio/validate'));
  assert.equal(val.ok, true, 'walidacja: ' + JSON.stringify(val.errors));
  assert.equal(val.counts.classes, S.db.col('classes').length);

  const xml = (await c.get('/api/registry/sio/package')).body;
  assert.match(xml, /^<\?xml version="1\.0" encoding="UTF-8"\?>/);
  assert.match(xml, /rspo="12345"/);
  // poprawność składniowa: wszystkie znaczniki domykają się i są prawidłowo zagnieżdżone
  const stack = []; const tagRe = /<(\/?)([a-zA-Z][\w:-]*)([^>]*?)(\/?)>/g; let m, roots = 0;
  while ((m = tagRe.exec(xml))) {
    if (m[4] === '/') { assert.ok(stack.length > 0, 'element pusty poza korzeniem'); continue; }
    if (m[1] === '/') { assert.equal(stack.pop(), m[2], 'niedomknięty znacznik przy ' + m[2]); if (!stack.length) roots++; }
    else stack.push(m[2]);
  }
  assert.equal(stack.length, 0, 'wszystkie znaczniki domknięte');
  assert.equal(roots, 1, 'dokładnie jeden element główny');

  for (const cls of S.db.col('classes')) {
    const n = S.db.col('students').filter((s) => s.classId === cls.id && s.status === 'active').length;
    assert.match(xml, new RegExp(`<oddzial id="${cls.id}"[^>]*liczbaUczniow="${n}"`), 'brak licznika dla ' + cls.id);
  }
  assert.match(xml, /pesel="13\d{9}"/);                              // PESEL obecny, bo kopia nie jest anonimizowana
  assert.equal(S.db.data.config.anonymized, false);

  // wariant z błędami: uczeń bez PESEL i bez paszportu
  const victim = S.db.get('students', 'st_mrz_natalia'); const keep = victim.pesel;
  victim.pesel = null; victim.birthPlace = '';
  const bad = expectOk(await c.post('/api/registry/sio/validate'));
  assert.equal(bad.ok, false);
  assert.ok(bad.errors.some((e) => /paszport/.test(e)));
  assert.ok(bad.errors.some((e) => /miejsceUrodzenia/.test(e)));
  const blocked = await c.get('/api/registry/sio/package');
  assert.equal(blocked.status, 400);
  victim.pesel = keep; victim.birthPlace = 'Kraków'; S.db.save();
});

/* ------------------------------------------------------------------------------- 3.5.4 */
test('[3.5.4] administrator zapisuje strukturę roku; nachodzące terminy są odrzucane', async () => {
  const c = await S.as('admin');
  const base = expectOk(await c.get('/api/admin/year'));
  assert.equal(base.semesters.length, 2);

  const overlapping = await c.patch('/api/admin/year', { semesters: [{ id: 1, name: 'Semestr 1', from: '2026-09-01', to: '2027-02-10' }, { id: 2, name: 'Semestr 2', from: '2027-01-20', to: '2027-06-25' }] });
  assert.equal(overlapping.status, 400);
  assert.equal(overlapping.body.code, 'year_invalid');
  assert.match(overlapping.body.errors[0], /nachodzą na siebie/);

  const dayInBreak = await c.patch('/api/admin/year', { daysOff: [{ date: '2026-12-28', name: 'Dzień wolny' }] });
  assert.equal(dayInBreak.status, 400);
  assert.match(dayInBreak.body.error, /mieści się w przerwie/);

  const reversed = await c.patch('/api/admin/year', { winterBreak: { from: '2027-02-14', to: '2027-02-01', name: 'Ferie zimowe' } });
  assert.equal(reversed.status, 400);

  const ok = expectOk(await c.patch('/api/admin/year', {
    semesters: [{ id: 1, name: 'Semestr 1', from: '2026-09-01', to: '2027-01-23', proposedDeadline: '2026-12-12', classificationMeeting: '2027-01-20', classificationDeadline: '2027-01-20', locked: false },
      { id: 2, name: 'Semestr 2', from: '2027-01-26', to: '2027-06-25', proposedDeadline: '2027-05-14', classificationMeeting: '2027-06-18', classificationDeadline: '2027-06-18', locked: false }],
    winterBreak: { from: '2027-02-01', to: '2027-02-14', name: 'Ferie zimowe' },
    holidays: [{ from: '2026-12-23', to: '2026-12-31', name: 'Zimowa przerwa świąteczna' }, { from: '2027-04-01', to: '2027-04-06', name: 'Wiosenna przerwa świąteczna' }],
    daysOff: [{ date: '2026-11-02', name: 'Dzień wolny od zajęć dydaktycznych' }, { date: '2027-01-07', name: 'Dzień wolny' }, { date: '2027-05-04', name: 'Dzień wolny (egzamin ósmoklasisty)' }]
  }));
  assert.equal(ok.semesters[0].to, '2027-01-23');
  assert.equal(ok.daysOff.length, 3);
  assert.equal(S.db.data.config.daysOff.length, 3);
  assert.ok(S.db.col('audit').some((a) => a.action === 'school_year_updated'));
});

/* ------------------------------------------------------------------------------- 3.5.5 */
test('[3.5.5] import planu z zewnętrznego programu: próbny raport konfliktów, potem zapis z grupami, salami i nauczycielami', async () => {
  const c = await S.as('admin');
  const fmt = expectOk(await c.get('/api/admin/timetable/format'));
  assert.equal(fmt.format, 'class;weekday;lessonNo;subject;teacherLogin;room;group');

  const csv = ['class;weekday;lessonNo;subject;teacherLogin;room;group',
    '7b;1;1;mat;j.nowak;12;',
    '7b;1;2;ang;e.krol;15;g_7b_ang1',
    '7b;1;2;ang;e.krol;16;g_7b_ang2',
    '7a;1;3;fiz;a.wojcik;24;',
    '8b;1;4;his;k.lis;9;'].join('\n');

  // konflikt: ten sam nauczyciel w dwóch oddziałach o tej samej porze
  const clash = expectOk(await c.post('/api/admin/timetable/import', { data: csv + '\n7a;1;1;mat;j.nowak;11;', dryRun: true }));
  assert.equal(clash.ok, false);
  assert.equal(clash.applied, false);
  assert.ok(clash.conflicts.some((x) => x.kind === 'teacher'));
  assert.equal(S.db.col('timetable').length > 0 && clash.dryRun, true);

  const badRow = expectOk(await c.post('/api/admin/timetable/import', { data: csv + '\n9z;1;1;mat;j.nowak;11;', dryRun: true }));
  assert.ok(badRow.errors.some((e) => /nieznany oddział/.test(e)));

  const refused = await c.post('/api/admin/timetable/import', { data: csv + '\n7a;1;1;mat;j.nowak;11;', dryRun: false });
  assert.equal(refused.status, 409);

  const before = S.db.col('timetable').length;
  const dry = expectOk(await c.post('/api/admin/timetable/import', { data: csv, dryRun: true }));
  assert.equal(dry.ok, true); assert.equal(dry.applied, false);
  assert.equal(S.db.col('timetable').length, before, 'próbny import niczego nie zapisuje');

  const done = expectOk(await c.post('/api/admin/timetable/import', { data: csv, dryRun: false }));
  assert.equal(done.applied, true);
  assert.equal(done.rows, 5);
  assert.equal(done.groups, 2);
  const tt = S.db.col('timetable');
  assert.equal(tt.length, 5);
  const ang = tt.filter((x) => x.subjectId === 'ang');
  assert.deepEqual(ang.map((x) => x.groupId).sort(), ['g_7b_ang1', 'g_7b_ang2']);
  assert.deepEqual(ang.map((x) => x.room).sort(), ['15', '16']);
  assert.equal(ang.every((x) => x.teacherId === 'u_krol'), true);
  assert.ok(S.db.col('audit').some((a) => a.action === 'timetable_imported'));

  // JSON o tych samych kluczach też działa
  const viaJson = expectOk(await c.post('/api/admin/timetable/import', { format: 'json', data: [{ class: '7b', weekday: 2, lessonNo: 1, subject: 'mat', teacherLogin: 'j.nowak', room: '12', group: '' }], dryRun: true }));
  assert.equal(viaJson.rows, 1);
});

/* OPS-21 — import częściowy: konflikty także wobec planu już zapisanego. */
test('[3.5.5] OPS-21: import częściowy (merge) widzi kolizje z planem pozostałych oddziałów', async () => {
  const T = await startServer();
  try {
    const c = await T.as('admin');
    const H = 'class;weekday;lessonNo;subject;teacherLogin;room;group';
    /* stan wyjściowy: pełny plan trzech oddziałów */
    expectOk(await c.post('/api/admin/timetable/import', { data: [H,
      '7a;1;1;fiz;a.wojcik;24;',
      '8b;1;2;his;k.lis;9;',
      '7b;1;5;mat;j.nowak;12;'].join('\n'), dryRun: false, force: true }), 'plan wyjściowy');
    /* pozycja-widmo: grupa, której już nie ma, została w planie oddziału spoza importu */
    T.db.col('timetable').push({ id: 'tt_7a_1_3_g_widmo', classId: '7a', weekday: 1, lessonNo: 3, subjectId: 'ang', teacherId: 'u_krol', room: '15', groupId: 'g_widmo' });

    const csv = [H,
      '7b;1;1;fiz;a.wojcik;12;',            // ten sam nauczyciel co 7a o tej porze — inna sala, więc kolizja
      '7b;1;2;pol;b.sikora;9;',             // sala 9 zajęta o tej porze przez 8b
      '7b;1;3;ang;e.krol;15;g_7a_ang2'].join('\n');   // grupa należy do 7a

    /* pełna wymiana planu — pozostałe oddziały znikają, więc nie ma z czym kolidować */
    const full = expectOk(await c.post('/api/admin/timetable/import', { data: csv, dryRun: true }));
    assert.equal(full.merge, false);
    assert.equal(full.conflicts.filter((x) => x.stored).length, 0, 'pełny import podmienia cały plan');

    /* import częściowy — plan 7a i 8b zostaje, więc kolizje muszą być widoczne */
    const dry = expectOk(await c.post('/api/admin/timetable/import', { data: csv, merge: true, dryRun: true }));
    assert.equal(dry.merge, true); assert.equal(dry.applied, false); assert.equal(dry.ok, false);
    assert.deepEqual(dry.classes, ['7b']);
    assert.ok(dry.keptEntries >= 3, 'pozycje pozostałych oddziałów zostają w planie');
    const stored = dry.conflicts.filter((x) => x.stored === true);

    const teacher = stored.find((x) => x.kind === 'teacher');
    assert.ok(teacher, 'nauczyciel zajęty w innym oddziale: ' + JSON.stringify(stored));
    assert.equal(teacher.weekday, 1); assert.equal(teacher.lessonNo, 1);
    assert.match(teacher.detail, /Wójcik/); assert.match(teacher.detail, /7a/);
    assert.deepEqual(teacher.lines, [2], 'wskazuje wiersz wgrywanego pliku');

    const room = stored.find((x) => x.kind === 'room');
    assert.ok(room, 'sala zajęta przez inny oddział');
    assert.equal(room.lessonNo, 2); assert.match(room.detail, /Sala 9/); assert.match(room.detail, /8b/);

    const groups = stored.filter((x) => x.kind === 'group');
    assert.ok(groups.some((x) => /g_widmo/.test(x.detail) && /nie istnieje/.test(x.detail)), 'grupa, której nie ma');
    assert.ok(groups.some((x) => /7a/.test(x.detail) && /7b/.test(x.detail)), 'grupa spoza oddziału');

    /* zapisu nie ma, dopóki ktoś nie zdecyduje */
    assert.equal((await c.post('/api/admin/timetable/import', { data: csv, merge: true, dryRun: false })).status, 409);

    /* czysty import częściowy: 7b podmienione, reszta planu nietknięta */
    T.db.data.timetable = T.db.col('timetable').filter((t) => t.id !== 'tt_7a_1_3_g_widmo');
    const clean = [H, '7b;1;6;mat;j.nowak;12;', '7b;1;7;pol;b.sikora;8;'].join('\n');
    const okDry = expectOk(await c.post('/api/admin/timetable/import', { data: clean, merge: true, dryRun: true }));
    assert.equal(okDry.ok, true); assert.equal(okDry.conflicts.length, 0);
    const done = expectOk(await c.post('/api/admin/timetable/import', { data: clean, merge: true, dryRun: false, force: true }));
    assert.equal(done.applied, true); assert.equal(done.merge, true);
    const tt = T.db.col('timetable');
    assert.deepEqual(tt.filter((x) => x.classId === '7b').map((x) => x.lessonNo).sort(), [6, 7], 'stary plan 7b zastąpiony');
    assert.ok(tt.some((x) => x.classId === '7a' && x.lessonNo === 1), 'plan 7a zostaje');
    assert.ok(tt.some((x) => x.classId === '8b' && x.lessonNo === 2), 'plan 8b zostaje');
    assert.ok(T.db.col('audit').some((a) => a.action === 'timetable_imported' && a.after.merge === true && a.after.classes.includes('7b')));
  } finally { await T.close(); }
});

/* Identyfikator pozycji planu to `tt_<oddział>_<dzień>_<nr>[_<grupa>]` — bez przedmiotu, nauczyciela
   i sali. Korekta arkusza organizacyjnego („piątą godzinę we czwartek prowadzi teraz kto inny”)
   zostawiała więc już wygenerowane lekcje ze starym nauczycielem do końca roku: slot się nie zmienił,
   więc nic nie było ani usuwane, ani dogenerowane. Uzgadnianie musi dotyczyć także treści slotu —
   ale nigdy lekcji, w której coś już zapisano. */
test('[3.5.5] korekta planu w istniejącej godzinie przestawia przyszłe lekcje, a te z wpisami zostawia', async () => {
  const T = await startServer();
  try {
    const c = await T.as('admin');
    const H = 'class;weekday;lessonNo;subject;teacherLogin;room;group';
    expectOk(await c.post('/api/admin/timetable/import', { data: [H, '7b;1;1;mat;j.nowak;12;'].join('\n'), dryRun: false, force: true }));
    const gen = expectOk(await c.post('/api/setup/lessons/generate', { from: '2026-10-26', to: '2026-12-20' }));
    assert.ok(gen.created > 5, 'lekcje na kolejne poniedziałki: ' + gen.created);
    const mondays = () => T.db.col('lessons').filter((l) => l.classId === '7b' && l.lessonNo === 1 && l.date >= '2026-10-26' && l.date <= '2026-12-20');
    assert.ok(mondays().every((l) => l.subjectId === 'mat' && l.teacherId === 'u_nowak' && l.room === '12'));

    /* w jednej z nich nauczyciel zdążył już wpisać temat — ta zostaje nietknięta */
    const t = await T.as('j.nowak');
    const journal = mondays().sort((a, b) => (a.date < b.date ? -1 : 1))[1];
    expectOk(await t.patch('/api/lessons/' + journal.id, { topic: 'Temat wpisany przed korektą planu.' }));

    const fixed = expectOk(await c.post('/api/admin/timetable/import', {
      data: [H, '7b;1;1;fiz;a.wojcik;24;'].join('\n'), merge: true, dryRun: false, force: true,
      reason: 'Korekta arkusza organizacyjnego.'
    }));
    assert.equal(fixed.applied, true);
    assert.equal(T.db.col('timetable').length, 1, 'ta sama pozycja planu, inna treść');
    assert.ok(fixed.lessons.changed >= 1, 'uzgadnianie raportuje poprawione lekcje: ' + JSON.stringify(fixed.lessons));
    assert.equal(fixed.lessons.keptWithJournal, 1, 'lekcja z tematem zostaje nietknięta');
    assert.match(fixed.message, /poprawiono/);

    for (const l of mondays()) {
      if (l.id === journal.id) { assert.equal(l.subjectId, 'mat'); assert.equal(l.teacherId, 'u_nowak'); continue; }
      assert.equal(l.subjectId, 'fiz', l.id + ' powinna być już fizyką');
      assert.equal(l.teacherId, 'u_wojcik');
      assert.equal(l.room, '24');
      assert.ok(l.changedAt, 'poprawiona lekcja niesie znacznik zmiany');
    }
    /* uczeń widzi korektę na ekranie zmian w planie */
    const anna = await T.as('anna.kowalczyk');
    const seen = expectOk(await anna.get('/api/student/changes'));
    assert.ok(seen.changes.some((x) => mondays().some((l) => l.id === x.lessonId)), 'zmiana planu dociera do ucznia');
  } finally { await T.close(); }
});

/* ------------------------------------------------------------------------------- 3.5.6 */
test('[3.5.6] reset hasła: hasło jednorazowe raz, wymuszona zmiana przy logowaniu, polityka złożoności', async () => {
  const c = await S.as('admin');
  const res = expectOk(await c.post('/api/admin/users/u_gorski/reset-password'));
  assert.ok(res.temporaryPassword && res.temporaryPassword.length >= 12);
  assert.equal(res.mustChangePassword, true);
  assert.equal(S.db.get('users', 'u_gorski').mustChangePassword, true);
  assert.ok(S.db.col('audit').some((a) => a.action === 'password_reset' && a.entityId === 'u_gorski'));
  assert.equal(JSON.stringify(S.db.col('audit')).includes(res.temporaryPassword), false, 'hasła nie wolno zapisywać w audycie');

  const t = S.client();
  const login = await t.post('/api/auth/login', { login: 't.gorski', password: res.temporaryPassword });
  assert.equal(login.status, 200);
  assert.equal(login.body.mustChangePassword, true);

  const blocked = await t.get('/api/registry/students');            // zwykłe trasy zablokowane do czasu zmiany
  assert.equal(blocked.status, 403);
  assert.equal(blocked.body.code, 'password_change_required');

  const weak = await t.post('/api/auth/password', { next: 'haslo123' });
  assert.equal(weak.status, 400);
  assert.ok(weak.body.missing.length >= 2);

  expectOk(await t.post('/api/auth/password', { next: 'Zmienione-Haslo-2026!' }));
  assert.equal(S.db.get('users', 'u_gorski').mustChangePassword, false);
  assert.equal((await S.client().post('/api/auth/login', { login: 't.gorski', password: DEMO_PASSWORD })).status, 401);
  assert.equal((await S.client().post('/api/auth/login', { login: 't.gorski', password: 'Zmienione-Haslo-2026!' })).status, 200);
});

/* ------------------------------------------------------------------------------- 3.5.7 */
test('[3.5.7] wymuszenie TOTP dla edytujących oceny i frekwencję: flagi na kontach i lista stanu 2FA', async () => {
  const c = await S.as('admin');
  const off = expectOk(await c.post('/api/admin/2fa/require', { required: false }));
  assert.equal(off.required, false);
  assert.equal(S.db.get('users', 'u_nowak').totpRequired, false);

  const on = expectOk(await c.post('/api/admin/2fa/require', { required: true }));
  assert.equal(on.required, true);
  assert.equal(S.db.data.config.require2FAForGradeEditors, true);
  const editors = S.db.col('users').filter((u) => ['teacher', 'principal', 'supportTeacher'].includes(u.role));
  assert.equal(editors.every((u) => u.totpRequired === true), true);
  assert.equal(editors.filter((u) => !u.totpEnabled).every((u) => u.mustSetup2FA === true), true);
  assert.equal(S.db.get('users', 'u_sekretariat').totpRequired, undefined, 'sekretariat nie edytuje ocen — bez wymogu');

  const list = expectOk(await c.get('/api/admin/2fa'));
  assert.equal(list.required, true);
  assert.deepEqual(list.roles.sort(), ['principal', 'supportTeacher', 'teacher']);
  const nowak = list.users.find((u) => u.id === 'u_nowak');
  assert.equal(nowak.totpRequired, true); assert.equal(nowak.totpEnabled, false); assert.equal(nowak.mustSetup2FA, true);

  // nauczyciel widzi wymóg w sesji i znika on po powiązaniu aplikacji
  const t = await S.as('j.nowak');
  assert.equal(expectOk(await t.get('/api/auth/session')).mustSetup2FA, true);
  const setup = expectOk(await t.post('/api/auth/totp/setup'));
  expectOk(await t.post('/api/auth/totp/enable', { code: require('../server/lib/crypto').totpCode(setup.secret) }));
  expectOk(await c.post('/api/admin/2fa/require', { required: true }));
  assert.equal(S.db.get('users', 'u_nowak').mustSetup2FA, false);
  assert.ok(S.db.col('audit').some((a) => a.action === 'totp_policy_changed'));
});

/* ------------------------------------------------------------------------------- 3.5.8 */
test('[3.5.8] przeniesienie ucznia: odpis arkusza ocen i wpis zamknięty z datą odejścia', async () => {
  const c = await S.as('sekretariat');
  const sid = 'st_olszewski_wiktor';
  const r = expectOk(await c.post('/api/registry/students/' + sid + '/transfer', { date: '2026-10-30', school: 'Szkoła Podstawowa nr 5 w Krakowie', reason: 'zmiana miejsca zamieszkania' }));
  assert.equal(r.student.status, 'transferred');
  assert.equal(r.student.departureDate, '2026-10-30');
  assert.equal(r.transcriptUrl, '/api/registry/students/' + sid + '/transcript');
  const s = S.db.get('students', sid);
  assert.equal(s.status, 'transferred'); assert.equal(s.transferSchool, 'Szkoła Podstawowa nr 5 w Krakowie');
  assert.ok(S.db.col('audit').some((a) => a.action === 'registry_entry_closed' && a.entityId === sid));

  const html = (await c.get(r.transcriptUrl)).body;
  assert.match(html, /^<!doctype html>/);
  assert.match(html, /Odpis arkusza ocen/);
  assert.match(html, /Olszewski/);
  assert.match(html, new RegExp('numer księgi uczniów <b>' + s.registerNo + '</b>'));
  assert.match(html, /30\.10\.2026/);
  assert.match(html, /Szkoła Podstawowa nr 5 w Krakowie/);

  // powtórne zamknięcie tego samego wpisu jest odrzucane, a uczeń znika z liczników SIO
  assert.equal((await c.post('/api/registry/students/' + sid + '/transfer', { date: '2026-11-02', school: 'X' })).status, 400);
  const xml = (await c.get('/api/registry/sio/package')).body;
  assert.equal(xml.includes(`numerKsiegi="${s.registerNo}"`), false);
});

/* ------------------------------------------------------------------------------- 3.5.9 */
test('[3.5.9] uprawnienia wiadomości: rodzice piszą do wszystkich albo tylko do wychowawcy i uczących', async () => {
  const c = await S.as('admin');
  /* Historyjka jest o tym, CO WOLNO RODZICOWI, a nie o tym, czy ustawienie wraca z API. Wybieramy
     nauczyciela, który nie uczy dziecka tego rodzica, i sprawdzamy oba tryby na żywej wiadomości. */
  const parent = await S.as('rodzic.nowak');                         // dziecko: Jan Nowak, 7b
  const teachesJan = new Set(S.db.col('lessons').filter((l) => l.classId === '7b').map((l) => l.teacherId));
  const stranger = S.db.one('users', (u) => u.role === 'teacher' && !teachesJan.has(u.id) && u.id !== 'u_nowak');
  assert.ok(stranger, 'w szkole jest nauczyciel, który nie uczy tego dziecka');
  const msg = { toUserIds: [stranger.id], subject: 'Pytanie o zajęcia', body: 'Czy prowadzi Pan(i) zajęcia dodatkowe?' };

  const all = expectOk(await c.patch('/api/admin/messaging', { parentsCanMessage: 'all' }));
  assert.equal(all.messaging.parentsCanMessage, 'all');
  assert.equal(S.db.data.config.messaging.parentsCanMessage, 'all');
  const sent = await parent.post('/api/messages', msg);
  assert.equal(sent.status, 200, 'w trybie „all” rodzic pisze do każdego pracownika: ' + JSON.stringify(sent.body).slice(0, 160));
  assert.ok(S.db.get('messages', sent.body.message.id).toUserIds.includes(stranger.id));
  assert.ok(expectOk(await parent.get('/api/messages/recipients')).recipients.some((x) => x.id === stranger.id), 'nauczyciel jest na liście odbiorców');

  const bad = await c.patch('/api/admin/messaging', { parentsCanMessage: 'nobody' });
  assert.equal(bad.status, 400);
  assert.deepEqual(bad.body.allowed, ['all', 'homeroomAndSubject']);

  const back = expectOk(await c.patch('/api/admin/messaging', { parentsCanMessage: 'homeroomAndSubject' }));
  assert.equal(back.messaging.parentsCanMessage, 'homeroomAndSubject');
  assert.ok(S.db.col('audit').some((a) => a.action === 'messaging_permissions_changed'));
  const blocked = await parent.post('/api/messages', msg);
  assert.equal(blocked.status, 403, 'po zawężeniu rodzic nie napisze do nauczyciela spoza uczących');
  assert.equal(blocked.body.code, 'messaging_not_allowed');
  assert.ok(!expectOk(await parent.get('/api/messages/recipients')).recipients.some((x) => x.id === stranger.id), 'nauczyciel znika z listy odbiorców');
  const toHomeroom = await parent.post('/api/messages', { toUserIds: ['u_nowak'], subject: 'Pytanie do wychowawczyni', body: 'Proszę o kontakt.' });
  assert.equal(toHomeroom.status, 200, 'do wychowawczyni rodzic pisze zawsze');

  const teacher = await S.as('e.krol');                              // ustawienie jest widoczne w konfiguracji sesji
  assert.equal(expectOk(await teacher.get('/api/auth/session')).config.messaging.parentsCanMessage, 'homeroomAndSubject');
});

/* ------------------------------------------------------------------------------ 3.5.10 */
test('[3.5.10] zbiorczy wydruk duplikatów świadectw z adnotacją o dacie wydania i numerze decyzji', async () => {
  const c = await S.as('sekretariat');
  const missing = await c.post('/api/registry/duplicates/print', { studentIds: ['st_kowalczyk_anna'] });
  assert.equal(missing.status, 400);
  assert.equal(missing.body.field, 'decisionNo');

  const html = (await c.post('/api/registry/duplicates/print', {
    studentIds: ['st_kowalczyk_anna', 'st_nowak_jan', 'st_lewandowski_piotr'],
    decisionNo: 'SO.4424.17.2026', issueDate: '2026-10-24', certificate: 'świadectwo ukończenia klasy 6', schoolYear: '2025/2026'
  })).body;
  assert.match(html, /^<!doctype html>/);
  assert.equal((html.match(/>DUPLIKAT</g) || []).length, 3);
  assert.equal((html.match(/data wydania duplikatu <b>24\.10\.2026<\/b>/g) || []).length, 3);
  assert.equal((html.match(/decyzja administracyjna nr <b>SO\.4424\.17\.2026<\/b>/g) || []).length, 3);
  assert.match(html, /Kowalczyk/); assert.match(html, /Lewandowski/);

  const reg = expectOk(await c.get('/api/registry/duplicates')).duplicates;
  assert.equal(reg.filter((d) => d.decisionNo === 'SO.4424.17.2026').length, 3);
  assert.equal(reg[0].issuedAt, '2026-10-24');
  assert.equal(S.db.col('audit').filter((a) => a.action === 'certificate_duplicate_issued').length, 3);
});

/* ------------------------------------------------------------------------------ 3.5.11 */
test('[3.5.11] jednorazowe kody rejestracyjne dla rodziców klasy 1: kod zakłada konto rodzica, które może się zalogować', async () => {
  const c = await S.as('admin');
  const gen = expectOk(await c.post('/api/admin/registration-codes', { classId: '1a', expiresInDays: 30 }));
  assert.ok(gen.count >= 1);
  assert.equal(gen.created.every((x) => x.code.startsWith('1A-') && !x.usedAt), true);
  assert.equal(gen.expiresAt, '2026-11-22');

  const seeded = expectOk(await c.get('/api/admin/registration-codes')).codes.find((x) => x.id === 'rc_kot_stanislaw');
  assert.equal(seeded.code, '1A-KRQT-3N7W');
  assert.equal(seeded.usedAt, null);

  const pub = S.client();                                            // rejestracja jest publiczna: rodzic nie ma jeszcze konta
  assert.equal((await pub.post('/api/register', { code: 'NIE-MA-KODU', login: 'rodzic.kot', password: 'Rodzic-Haslo-2026!', firstName: 'Aleksandra', lastName: 'Kot' })).status, 400);
  const weak = await pub.post('/api/register', { code: seeded.code, login: 'rodzic.kot', password: 'kot', firstName: 'Aleksandra', lastName: 'Kot' });
  assert.equal(weak.status, 400); assert.equal(weak.body.field, 'password');

  const made = expectOk(await pub.post('/api/register', { code: '1a-krqt-3n7w', login: 'rodzic.kot', password: 'Rodzic-Haslo-2026!', firstName: 'Aleksandra', lastName: 'Kot', email: 'a.kot@example.org' }));
  assert.equal(made.user.role, 'parent');
  assert.equal(made.user.passwordHash, undefined);
  assert.deepEqual(made.user.childrenIds, ['st_kot_stanisaw']);
  assert.ok(S.db.get('students', 'st_kot_stanisaw').parentIds.includes(made.user.id));
  assert.equal(S.db.get('registrationCodes', 'rc_kot_stanislaw').usedByUserId, made.user.id);

  const parent = S.client();                                         // konto działa
  const session = await parent.login('rodzic.kot', 'Rodzic-Haslo-2026!');
  assert.equal(session.user.role, 'parent');

  const reuse = await S.client().post('/api/register', { code: '1A-KRQT-3N7W', login: 'rodzic.kot2', password: 'Rodzic-Haslo-2026!', firstName: 'Damian', lastName: 'Kot' });
  assert.equal(reuse.status, 400);
  assert.match(reuse.body.error, /jednorazowy/);
  assert.ok(S.db.col('audit').some((a) => a.action === 'parent_account_created'));
});

/* ------------------------------------------------------------------------------ 3.5.12 */
test('[3.5.12] lista dozwolonych adresów IP odcina logowanie administracyjne spoza sieci szkolnej', async () => {
  const c = await S.as('admin');
  const bad = await c.patch('/api/admin/ip-allowlist', { ipAllowlist: ['10.999.0.1'] });
  assert.equal(bad.status, 400);
  assert.match(bad.body.error, /CIDR/);

  const lockOut = await c.patch('/api/admin/ip-allowlist', { ipAllowlist: ['193.219.28.14'] });
  assert.equal(lockOut.status, 400, 'zapis odcinający własny adres wymaga force');

  const saved = expectOk(await c.patch('/api/admin/ip-allowlist', { ipAllowlist: ['10.12.0.0/24', '193.219.28.14'], force: true }));
  assert.deepEqual(saved.ipAllowlist, ['10.12.0.0/24', '193.219.28.14']);
  assert.ok(S.db.col('audit').some((a) => a.action === 'ip_allowlist_changed'));

  const outside = await S.client().post('/api/auth/login', { login: 'admin', password: DEMO_PASSWORD }, { 'X-Forwarded-For': '8.8.8.8' });
  assert.equal(outside.status, 403);
  assert.match(outside.body.error, /adresu IP/);
  assert.ok(S.db.col('audit').some((a) => a.action === 'login_denied_ip'));

  const inside = await S.client().post('/api/auth/login', { login: 'admin', password: DEMO_PASSWORD }, { 'X-Forwarded-For': '10.12.0.55' });
  assert.equal(inside.status, 200);

  const teacher = await S.client().post('/api/auth/login', { login: 'a.wojcik', password: DEMO_PASSWORD }, { 'X-Forwarded-For': '8.8.8.8' });
  assert.equal(teacher.status, 200, 'ograniczenie dotyczy tylko kont administracyjnych');

  expectOk(await c.patch('/api/admin/ip-allowlist', { ipAllowlist: [] }));   // przywracamy stan z seeda
  assert.deepEqual(S.db.data.config.ipAllowlist, []);
});

/* ------------------------------------------------------------------------------ 3.5.13 */
test('[3.5.13] anonimizowana kopia bazy dla środowiska testowego: brak prawdziwych nazwisk i numerów PESEL, audyt zachowany', async () => {
  const c = await S.as('admin');
  const snap = (await c.post('/api/admin/backup/anonymized', {})).body;
  assert.equal(snap.config.anonymized, true);
  assert.equal(snap.meta.anonymized, true);

  const text = JSON.stringify(snap);
  for (const name of ['Kowalczyk', 'Wiśniewska', 'Lewandowski', 'Nowak', 'Bąk', 'Zielińska', 'Sobczak']) assert.equal(text.includes(name), false, 'w kopii pozostało nazwisko ' + name);
  for (const s of S.db.col('students')) if (s.pesel) assert.equal(text.includes(s.pesel), false, 'w kopii pozostał PESEL ' + s.pesel);
  assert.equal(text.includes('j.nowak@sp12.krakow.pl'), false);
  assert.equal(text.includes('ul. Długa 17/4'), false);

  // sekrety nie wychodzą z systemu
  assert.equal(snap.users.every((u) => !u.passwordHash && !u.totpSecret && !u.privateKey), true);
  assert.equal(snap.config.schoolPrivateKey, undefined);
  assert.deepEqual(snap.sessions, []);

  // struktura i dane niewrażliwe zostają
  assert.equal(snap.students.length, S.db.col('students').length);
  assert.equal(snap.classes.length, S.db.col('classes').length);
  assert.equal(snap.audit.length >= S.db.col('audit').length - 1, true, 'wpisy audytowe zachowane');
  assert.equal(snap.students.every((s) => !s.pesel || require('../server/lib/util').validatePesel(s.pesel).ok), true, 'pseudonimy PESEL mają poprawną sumę kontrolną');

  // deterministycznie: ten sam uczeń dostaje ten sam pseudonim w kolejnej kopii
  const again = (await c.post('/api/admin/backup/anonymized', {})).body;
  const pick = (d) => d.students.find((s) => s.id === 'st_kowalczyk_anna');
  assert.equal(pick(again).lastName, pick(snap).lastName);
  assert.notEqual(pick(snap).lastName, 'Kowalczyk');

  assert.equal(S.db.data.config.anonymized, false, 'produkcja nie jest zmieniana');
  assert.ok(S.db.col('audit').some((a) => a.action === 'anonymized_backup_created'));
});

/* ------------------------------------------------------------------------------ 3.5.14 */
test('[3.5.14] rejestr obwodowy przygotowania przedszkolnego: kompletność i rejestracja zgłoszenia', async () => {
  const c = await S.as('sekretariat');
  const first = expectOk(await c.get('/api/registry/district'));
  assert.equal(first.children.length, 6);
  assert.equal(first.stats.total, 6);
  assert.equal(first.stats.reported, 3);
  assert.equal(first.stats.missing, 3);
  assert.equal(first.stats.completeness, 50);

  const target = first.children.find((x) => !x.reported && !x.summonedAt);
  expectOk(await c.post('/api/registry/district/' + target.id + '/summon'));
  assert.equal(S.db.get('districtChildren', target.id).summonedAt, S.TODAY);

  const done = expectOk(await c.post('/api/registry/district/' + target.id + '/report', { institution: 'Przedszkole nr 44' }));
  assert.equal(done.child.reported, true);
  assert.equal(done.child.institution, 'Przedszkole nr 44');
  assert.equal(done.child.reportedAt, S.TODAY);
  assert.equal(done.stats.reported, 4);
  assert.ok(Math.abs(done.stats.completeness - 66.7) < 0.1);
  assert.equal((await c.post('/api/registry/district/' + target.id + '/summon')).status, 400, 'zgłoszone dziecko nie wymaga wezwania');
  assert.ok(S.db.col('audit').some((a) => a.action === 'district_child_reported' && a.entityId === target.id));
});

/* ------------------------------------------------------------------------------ 3.5.15 */
test('[3.5.15] retencja logów: minimum ustawowe, raport bez usuwania i niezmienność wpisów audytowych (405)', async () => {
  const c = await S.as('admin');
  const cur = expectOk(await c.get('/api/admin/retention'));
  assert.equal(cur.logRetentionMinYears, 5);
  assert.equal(cur.immutable, true);

  const tooShort = await c.patch('/api/admin/retention', { logRetentionYears: 2 });
  assert.equal(tooShort.status, 400);
  assert.equal(tooShort.body.min, 5);
  assert.match(tooShort.body.error, /nie może być krótszy/);
  assert.equal((await c.patch('/api/admin/retention', { gradesArchiveRetentionYears: 20 })).status, 400);

  const ok = expectOk(await c.patch('/api/admin/retention', { logRetentionYears: 10 }));
  assert.equal(ok.logRetentionYears, 10);
  assert.equal(S.db.data.config.logRetentionYears, 10);

  const report = expectOk(await c.get('/api/admin/retention/report'));
  assert.equal(report.cutoff, '2016-10-23');
  assert.equal(report.deleted, 0);
  assert.equal(report.wouldExpire, 0);
  assert.equal(report.total, S.db.col('audit').length);
  assert.match(report.message, /nic nie usuwa/);

  // WORM: żadną metodą nie da się ruszyć wpisu audytowego
  const row = S.db.col('audit')[0]; const auditBefore = S.db.col('audit').length;
  for (const call of [c.patch('/api/audit/' + row.id, { action: 'x' }), c.put('/api/audit/' + row.id, {}), c.delete('/api/audit/' + row.id), c.post('/api/audit/' + row.id, {}), c.delete('/api/audit')]) {
    const r = await call;
    assert.equal(r.status, 405, 'oczekiwano 405 dla modyfikacji audytu');
    assert.equal(r.body.code, 'audit_immutable');
  }
  assert.equal(S.db.get('audit', row.id).action, row.action);
  assert.ok(S.db.col('audit').length > auditBefore, 'próby modyfikacji same trafiają do rejestru');
  assert.equal(S.db.col('audit').filter((a) => a.action === 'audit_modification_attempt').length, 5);

  expectOk(await c.patch('/api/admin/retention', { logRetentionYears: 5 }));
});

/* ============================================================ przegląd operacyjny (docs/review/operations.md)
   Sytuacje, które zdarzają się w każdej szkole: uczeń dochodzi i odchodzi, klasa dzieli się na grupy,
   plan zmienia się w lutym, nauczyciel odchodzi, rok szkolny się kończy. Każdy test ma własny serwer
   tam, gdzie zmienia stan całej szkoły — dzięki temu kolejność w pliku nie ma znaczenia. */

test('[3.5.1] wpis do księgi zakłada konto ucznia i wydaje kod rejestracyjny dla opiekuna (OPS-12)', async () => {
  const c = await S.as('sekretariat');
  const p = pesel(14, 6, 11, 508, true);
  const r = expectOk(await c.post('/api/registry/students', { firstName: 'Bruno', lastName: 'Pszczółka', identityKind: 'pesel', pesel: p, birthDate: '2014-06-11', birthPlace: 'Kraków', classId: '3a', mother: 'Pszczółka Iwona' }));
  const sid = r.student.id;
  assert.equal(r.student.enrolledAt, S.TODAY, 'data przyjęcia jest zapisana — bez niej listy obecności nie wiedzą, od kiedy uczeń jest w szkole');
  const account = S.db.one('users', (u) => u.role === 'student' && u.studentId === sid);
  assert.ok(account, 'uczeń dostaje konto od razu');
  assert.equal(account.login, r.studentLogin);
  assert.equal(account.passwordHash, null, 'konto bez hasła: aktywuje je administrator, import nie liczy scrypta');
  assert.ok(r.guardianCode && /^3A-/.test(r.guardianCode.code), 'sekretariat dostaje kod dla opiekuna: ' + JSON.stringify(r.guardianCode));
  assert.equal(S.db.col('registrationCodes').filter((x) => x.studentId === sid && !x.usedAt).length, 1);

  const g = expectOk(await c.get('/api/registry/students/' + sid + '/guardians'));
  assert.deepEqual(g.guardians, [], 'na razie bez opiekuna — kod czeka na odbiór');
  const attach = expectOk(await c.post('/api/registry/students/' + sid + '/guardians', { userId: 'u_p_zielinski', reason: 'oświadczenie matki z 20.10.2026' }));
  assert.equal(attach.guardian.userId, 'u_p_zielinski');
  assert.ok(S.db.get('users', 'u_p_zielinski').childrenIds.includes(sid));
  assert.equal((await c.post('/api/registry/students/' + sid + '/guardians', { userId: 'u_p_zielinski', reason: 'to samo' })).status, 409, 'dwukrotne przypięcie tego samego opiekuna');
  assert.equal((await c.post('/api/registry/students/' + sid + '/guardians', { userId: 'u_nowak', reason: 'nauczycielka' })).status, 400, 'tylko konto rodzica');
  assert.equal((await c.delete('/api/registry/students/' + sid + '/guardians/u_p_zielinski', {})).status, 400, 'odpięcie bez podstawy prawnej jest odrzucane');
  const off = expectOk(await c.delete('/api/registry/students/' + sid + '/guardians/u_p_zielinski', { reason: 'postanowienie sądu III Nsm 88/26', force: true }));
  assert.equal(off.remainingChildren, 1, 'rodzic ma jeszcze inne dziecko w tej szkole, więc konto zostaje czynne');
  assert.equal(S.db.get('users', 'u_p_zielinski').blocked, false);
  assert.ok(!S.db.get('students', sid).parentIds.includes('u_p_zielinski'));
  assert.ok(S.db.get('students', sid).formerParentIds.includes('u_p_zielinski'), 'historia opiekunów zostaje');
  assert.ok(S.db.col('audit').some((a) => a.action === 'guardian_detached' && a.entityId === sid));
});

test('[3.5.8] zamknięcie wpisu odcina ucznia od bieżącego dziennika: listy, grupy, konto, dostęp opiekunów, kody (OPS-03, OPS-15)', async () => {
  const T = await startServer();
  try {
    const sek = await T.as('sekretariat'), adm = await T.as('admin'), jn = await T.as('j.nowak');
    const sid = 'st_kowalczyk_anna';                                  // 7b, dwoje rozwiedzionych rodziców, trzy grupy
    const codes = expectOk(await adm.post('/api/admin/registration-codes', { classId: '7b' }));
    const mine = codes.created.find((x) => x.studentId === sid);
    assert.ok(mine, 'uczennica ma niewykorzystany kod rejestracyjny');
    const future = T.db.col('lessons').find((l) => l.classId === '7b' && l.date > T.TODAY && !l.groupId);
    assert.ok(JSON.stringify(expectOk(await jn.get('/api/attendance/lesson/' + future.id)).students).includes(sid), 'przed przeniesieniem jest na liście');

    const r = expectOk(await sek.post('/api/registry/students/' + sid + '/transfer', { date: '2026-10-20', school: 'Szkoła Podstawowa nr 3 w Krakowie', reason: 'przeprowadzka' }));
    assert.equal(r.student.status, 'transferred');
    assert.equal(T.db.get('classes', '7b').studentIds.includes(sid), false, 'schodzi z listy oddziału');
    assert.deepEqual(T.db.col('groups').filter((g) => g.studentIds.includes(sid)).map((g) => g.id), [], 'schodzi ze wszystkich grup');
    assert.equal(JSON.stringify(expectOk(await jn.get('/api/attendance/lesson/' + future.id)).students).includes(sid), false, 'znika z przyszłych list obecności');
    assert.equal(T.db.one('users', (u) => u.studentId === sid).blocked, true, 'konto ucznia zablokowane');
    await assert.rejects(() => T.client().login('anna.kowalczyk'), /login failed/, 'były uczeń nie zaloguje się do dziennika');

    const marta = await T.as('rodzic.kowalczyk');                     // ma jeszcze brata w 3a — konto działa dalej
    const children = expectOk(await marta.get('/api/parent/children'));
    assert.equal(JSON.stringify(children).includes(sid), false, 'opiekun nie widzi już danych ucznia, który odszedł');
    assert.ok(children.children.length >= 1, 'ale nadal widzi rodzeństwo w tej szkole');
    await assert.rejects(() => T.client().login('rodzic.kowalczyk2'), /login failed/, 'drugi rodzic bez innych dzieci traci konto');

    const stolen = await T.client().post('/api/register', { code: mine.code, login: 'ktos.obcy', password: 'Rodzic-Haslo-2026!', firstName: 'Ktoś', lastName: 'Obcy' });
    assert.equal(stolen.status, 400, 'koperta z kodem po odejściu ucznia nie zakłada już konta');
    assert.match(stolen.body.error, /unieważnion|zamknięt/i);

    const xml = (await sek.get('/api/registry/sio/package')).body;    // wypis nie psuje sprawozdania
    assert.equal(xml.includes(`numerKsiegi="${T.db.get('students', sid).registerNo}"`), false);
    assert.match((await sek.get('/api/registry/students/' + sid + '/transcript')).body, /Odpis arkusza ocen/, 'odpis arkusza nadal do wydania');
  } finally { T.close(); }
});

test('[3.5.5] oddział da się podzielić na grupy językowe po ułożeniu planu (OPS-02)', async () => {
  const c = await S.as('admin');
  const list = expectOk(await c.get('/api/admin/groups?classId=7b'));
  assert.ok(list.groups.length >= 2 && list.classes.some((x) => x.id === '7b'));

  const roster = expectOk(await c.get('/api/admin/groups?classId=7a')).classes.find((x) => x.id === '7a').students.map((s) => s.id);
  const half = Math.ceil(roster.length / 2);
  assert.equal((await c.post('/api/admin/classes/7a/split', { subjectId: 'ang', groups: [{ id: 'g_7a_nm1', name: '7a / niem. gr. 1', studentIds: roster.slice(0, half) }] })).status, 400, 'podział wymaga co najmniej dwóch grup');
  const unfinished = await c.post('/api/admin/classes/7a/split', { subjectId: 'ang', groups: [{ id: 'g_7a_nm1', name: 'gr 1', studentIds: roster.slice(0, 2) }, { id: 'g_7a_nm2', name: 'gr 2', studentIds: roster.slice(2, 3) }] });
  assert.equal(unfinished.status, 400); assert.equal(unfinished.body.code, 'unassigned', 'nikt nie może zostać poza podziałem');
  const both = await c.post('/api/admin/classes/7a/split', { subjectId: 'ang', groups: [{ id: 'g_7a_nm1', name: 'gr 1', studentIds: roster }, { id: 'g_7a_nm2', name: 'gr 2', studentIds: roster.slice(0, 1) }] });
  assert.equal(both.status, 400, 'ten sam uczeń w dwóch grupach');

  const split = expectOk(await c.post('/api/admin/classes/7a/split', { subjectId: 'ang', kind: 'language', groups: [{ id: 'g_7a_nm1', name: '7a / niem. gr. 1', studentIds: roster.slice(0, half) }, { id: 'g_7a_nm2', name: '7a / niem. gr. 2', studentIds: roster.slice(half) }] }));
  assert.equal(split.groups.length, 2);
  assert.equal(split.groups[0].members + split.groups[1].members, roster.length);
  assert.ok(S.db.get('groups', 'g_7a_nm1') && S.db.get('groups', 'g_7a_nm2'));
  assert.ok(S.db.col('audit').some((a) => a.action === 'class_split_into_groups' && a.entityId === '7a'));

  // dopisanie ucznia do istniejącej grupy językowej — bez tego uczeń z połowy roku wypada z lekcji grupowych
  const p = pesel(13, 9, 4, 611, false);
  const nowa = expectOk(await (await S.as('sekretariat')).post('/api/registry/students', { firstName: 'Lidia', lastName: 'Późna', identityKind: 'pesel', pesel: p, birthDate: '2013-09-04', birthPlace: 'Kraków', classId: '7b', mother: 'Późna Ewa' })).student;
  const added = expectOk(await c.patch('/api/admin/groups/g_7b_ang1', { add: [nowa.id], reason: 'uczennica dopisana w trakcie roku' }));
  assert.ok(added.group.studentIds.includes(nowa.id));
  const ang = S.db.col('lessons').find((l) => l.groupId === 'g_7b_ang1' && l.date > S.TODAY);
  const rost = expectOk(await (await S.as('e.krol')).get('/api/attendance/lesson/' + ang.id));
  assert.ok(rost.students.some((x) => x.studentId === nowa.id), 'od razu jest na liście lekcji grupowej');
  assert.equal((await c.patch('/api/admin/groups/g_7b_ang1', { add: ['st_baran_julia'] })).status, 400, 'do grupy 7b nie wpiszemy ucznia z 7a');

  const inUse = await c.delete('/api/admin/groups/g_7b_ang1');
  assert.equal(inUse.status, 409); assert.equal(inUse.body.code, 'group_in_use', 'grupy używanej w planie nie da się skasować');
  expectOk(await c.delete('/api/admin/groups/g_7a_nm2', { reason: 'pomyłka' }));
});

test('[3.5.5] zmiana planu w trakcie roku uzgadnia już wygenerowane lekcje (OPS-04)', async () => {
  const T = await startServer();
  try {
    const adm = await T.as('admin'), dyr = await T.as('dyrektor'), jn = await T.as('j.nowak');
    expectOk(await jn.post('/api/attendance/lesson/les_tt_7b_1_1_2026-10-19', { allPresent: true }));   // lekcja z przeszłości z frekwencją
    const sub = expectOk(await dyr.post('/api/substitutions', { teacherId: 'u_nowak', from: '2026-10-26', to: '2026-10-26', reason: 'zwolnienie lekarskie' }));
    for (const l of sub.lessons) expectOk(await dyr.post(`/api/substitutions/${sub.id}/assign`, { lessonId: l.id, substituteTeacherId: 'u_dyrektor', force: true }));
    expectOk(await dyr.post(`/api/substitutions/${sub.id}/publish`, { force: true }));
    assert.equal(T.db.get('lessons', 'les_tt_7b_1_1_2026-10-26').status, 'substituted');

    const rows = T.db.col('timetable').map((t) => [t.classId, t.weekday, t.lessonNo, t.subjectId, T.db.get('users', t.teacherId).login, t.room, t.groupId || ''].join(';'));
    const moved = rows.map((l) => (l.startsWith('7b;1;1;mat;') ? l.replace('7b;1;1;', '7b;1;7;') : l));   // matematyka z 1. na 7. godzinę
    const csv = ['class;weekday;lessonNo;subject;teacherLogin;room;group', ...moved].join('\n');

    const dry = expectOk(await adm.post('/api/admin/timetable/import', { data: csv, dryRun: true }));
    assert.ok(dry.lessonImpact.dropped >= 1, 'próbny import mówi, ile lekcji zniknie: ' + JSON.stringify(dry.lessonImpact));
    assert.ok(dry.lessonImpact.withJournal >= 1, 'i ile z nich ma wpisy albo zastępstwa');
    assert.ok(dry.lessonImpact.added >= 1, 'oraz ile dojdzie');
    assert.equal(T.db.get('lessons', 'les_tt_7b_1_1_2026-10-26').status, 'substituted', 'próbny import niczego nie rusza');

    const done = expectOk(await adm.post('/api/admin/timetable/import', { data: csv, dryRun: false, force: true }));
    assert.ok(done.lessons.created >= 1, 'nowe godziny dogenerowane: ' + JSON.stringify(done.lessons));
    assert.equal(T.db.get('lessons', 'les_tt_7b_1_1_2026-10-26').status, 'cancelled', 'lekcja z opublikowanym zastępstwem zostaje odwołana, nie skasowana');
    assert.equal(T.db.get('lessons', 'les_tt_7b_1_1_2026-10-26').cancelledBy, 'timetable');
    assert.ok(T.db.get('lessons', 'les_tt_7b_1_7_2026-10-26'), 'nowa godzina ma swoją lekcję w dzienniku');
    assert.equal(T.db.col('attendance').filter((a) => a.lessonId === 'les_tt_7b_1_1_2026-10-19').length > 0, true, 'frekwencja z przeszłości nietknięta');
    const monday = expectOk(await adm.get('/api/lessons?date=2026-10-26&classId=7b'));
    assert.ok(monday.lessons.some((l) => l.lessonNo === 7 && l.subjectId === 'mat'), 'nauczyciel widzi nową godzinę w planie dnia');

    // import, który skasowałby lekcje z wpisami, wymaga świadomej decyzji
    expectOk(await jn.patch('/api/lessons/les_tt_7b_2_2_2026-10-27', { topic: 'Pierwiastki — wprowadzenie' }));
    const current = T.db.col('timetable').map((t) => [t.classId, t.weekday, t.lessonNo, t.subjectId, T.db.get('users', t.teacherId).login, t.room, t.groupId || ''].join(';'));
    /* poza usunięciem 7b/wt./2 prostujemy zastany konflikt z zasiewu (ta sama anglistka w 7a i 7b o tej samej godzinie),
       żeby import zatrzymała wyłącznie kontrola lekcji z wpisami */
    const shrunk = ['class;weekday;lessonNo;subject;teacherLogin;room;group', ...current.filter((l) => !l.startsWith('7b;2;2;') && !l.startsWith('7a;2;4;ang'))].join('\n');
    const refused = await adm.post('/api/admin/timetable/import', { data: shrunk, dryRun: false });
    assert.equal(refused.status, 409, JSON.stringify(refused.body).slice(0, 200));
    assert.equal(refused.body.code, 'lessons_with_journal', refused.body.error);
    assert.equal(T.db.get('lessons', 'les_tt_7b_2_2_2026-10-27').topic, 'Pierwiastki — wprowadzenie', 'odrzucony import niczego nie ruszył');
    const forced = expectOk(await adm.post('/api/admin/timetable/import', { data: shrunk, dryRun: false, force: true }));
    assert.ok(forced.lessons.cancelled >= 1);
    assert.equal(T.db.get('lessons', 'les_tt_7b_2_2_2026-10-27').status, 'cancelled', 'temat i tak zostaje — lekcja jest odwołana, nie skasowana');
  } finally { T.close(); }
});

test('[3.5.4] dzień wolny dopisany po wygenerowaniu lekcji zdejmuje je z planu, a cofnięty przywraca (OPS-08)', async () => {
  const T = await startServer();
  try {
    const c = await T.as('admin');
    const day = '2026-11-05';                                          // czwartek w wygenerowanym zakresie
    const before = T.db.col('lessons').filter((l) => l.date === day).length;
    assert.ok(before > 0, 'najpierw lekcje są: ' + before);
    const base = T.db.data.config.daysOff.slice();

    const off = expectOk(await c.patch('/api/admin/year', { daysOff: [...base, { date: day, name: 'Dzień wolny od zajęć dydaktycznych' }] }));
    assert.ok(off.lessons, 'odpowiedź podaje bilans: ' + off.message);
    assert.equal(T.db.col('lessons').filter((l) => l.date === day && l.status !== 'cancelled').length, 0, 'żadna lekcja nie zostaje w planie dnia wolnego');
    assert.equal(expectOk(await c.get('/api/lessons?date=' + day + '&classId=7b')).lessons.filter((l) => l.status !== 'cancelled').length, 0);

    const back = expectOk(await c.patch('/api/admin/year', { daysOff: base }));
    assert.equal(T.db.col('lessons').filter((l) => l.date === day).length, before, 'cofnięcie decyzji odtwarza plan: ' + back.message);
    assert.ok(T.db.col('audit').some((a) => a.action === 'school_year_updated'));
  } finally { T.close(); }
});

test('[3.3.1] odejście nauczyciela w trakcie roku: następca przejmuje plan, lekcje i wychowawstwo (OPS-18)', async () => {
  const T = await startServer();
  try {
    const adm = await T.as('admin'), dyr = await T.as('dyrektor');
    expectOk(await adm.post('/api/setup/teachers/import', { csv: 'login;firstName;lastName;title;subjects;homeroomOf;email\nn.anglista;Nina;Anglista;mgr;ang;;n.anglista@sp12.krakow.pl' }));
    const successor = T.db.one('users', (u) => u.login === 'n.anglista');
    const date = '2026-11-02';
    const pastBefore = T.db.col('lessons').filter((l) => l.date < date && l.teacherId === 'u_krol').length;

    assert.equal((await dyr.post('/api/substitutions/handover', { fromTeacherId: 'u_krol', toTeacherId: successor.id, from: date })).status, 400, 'przekazanie wymaga podstawy');
    assert.equal((await dyr.post('/api/substitutions/handover', { fromTeacherId: 'u_krol', toTeacherId: 'u_mazur', from: date, reason: 'x' })).status, 409, 'następca bez kwalifikacji tylko za wymuszeniem');
    const dry = expectOk(await dyr.post('/api/substitutions/handover', { fromTeacherId: 'u_krol', toTeacherId: successor.id, from: date, reason: 'rozwiązanie umowy', dryRun: true }));
    assert.ok(dry.slots > 0 && dry.lessons > 0);
    assert.equal(T.db.col('timetable').filter((t) => t.teacherId === 'u_krol').length, dry.slots, 'podgląd niczego nie zmienia');

    const done = expectOk(await dyr.post('/api/substitutions/handover', { fromTeacherId: 'u_krol', toTeacherId: successor.id, from: date, reason: 'rozwiązanie umowy z 31.10.2026' }));
    assert.equal(T.db.col('timetable').filter((t) => t.teacherId === 'u_krol').length, 0, 'plan nie wskazuje już osoby, której nie ma w szkole');
    assert.equal(T.db.col('lessons').filter((l) => l.date >= date && l.teacherId === 'u_krol').length, 0);
    assert.equal(T.db.col('lessons').filter((l) => l.date < date && l.teacherId === 'u_krol').length, pastBefore, 'historia zostaje przy poprzedniej nauczycielce');
    assert.ok(done.notifications > 0 && done.classes.length > 0, 'klasy i rodzice dowiadują się o zmianie');
    assert.ok(T.db.col('audit').some((a) => a.action === 'teaching_handover' && a.entityId === 'u_krol'));
    assert.equal(expectOk(await dyr.post('/api/principal/users/u_krol/block', { reason: 'rozwiązanie umowy' })).blocked, true);

    // wychowawstwo: odejście wychowawczyni 7b przenosi oddział na następcę
    const hr = expectOk(await dyr.post('/api/substitutions/handover', { fromTeacherId: 'u_nowak', toTeacherId: 'u_wojcik', from: date, reason: 'przeniesienie służbowe', force: true }));
    assert.deepEqual(hr.homeroom, [{ classId: '7b', to: 'u_wojcik' }]);
    assert.equal(T.db.get('classes', '7b').homeroomTeacherId, 'u_wojcik');
    assert.equal(T.db.get('users', 'u_nowak').homeroomOf, null);
  } finally { T.close(); }
});

test('[3.5.4] przejście na nowy rok szkolny: promocja, absolwenci, nowe pierwsze klasy, przenumerowanie (OPS-14)', async () => {
  const T = await startServer();
  try {
    const adm = await T.as('admin'), dyr = await T.as('dyrektor');
    const plan = expectOk(await adm.get('/api/school-year/plan'));
    assert.equal(plan.fromYear, '2026/2027'); assert.equal(plan.toYear, '2027/2028'); assert.equal(plan.topLevel, 8);
    assert.deepEqual(plan.classes.find((x) => x.classId === '7a').becomes, '8a');
    assert.equal(plan.classes.find((x) => x.classId === '8b').graduating, true);
    assert.ok(plan.blockers.some((x) => /archiwal/.test(x)), 'bez pakietu archiwalnego rok się nie zamyka');
    assert.equal((await adm.post('/api/school-year/rollover', {})).status, 409);

    /* Rok zamyka się dopiero nad **podpisanym** pakietem archiwalnym (§ 22): bez tego rollover
       odpowiada `409 rollover_blocked`, bo klasa, która odchodzi, znika z dziennika razem
       z oddziałem. Generujemy pakiet i dołączamy podpis, którego skrót naprawdę zgadza się
       z manifestem — „podpisany” znaczy „digest-matched”, nie „jest jakiś plik”. */
    const pkg = expectOk(await dyr.post('/api/principal/archive', { force: true, reason: 'zamknięcie roku' }));
    /* Skrót, który podpis ma nieść, to skrót pliku `manifest.sha256` z pakietu — pakiet podaje go
       szesnastkowo, XAdES chce base64 tych samych bajtów. */
    const digest = Buffer.from(pkg.package.manifestSha256, 'hex').toString('base64');
    const xades = `<?xml version="1.0" encoding="UTF-8"?>\n<ds:Signature xmlns:ds="http://www.w3.org/2000/09/xmldsig#"><ds:SignedInfo><ds:Reference URI="manifest.sha256"><ds:DigestValue>${digest}</ds:DigestValue></ds:Reference></ds:SignedInfo><ds:SignatureValue>${Buffer.alloc(200, 0x41).toString('base64')}</ds:SignatureValue></ds:Signature>`;
    const signed = expectOk(await dyr.post('/api/principal/archive/' + pkg.id + '/signature', {
      name: 'podpis dyrektora.xades', contentBase64: Buffer.from(xades, 'utf8').toString('base64'), kind: 'zaufany', signedFile: 'manifest.sha256',
    }), 'podpis pakietu');
    assert.equal(signed.signature.verification, 'digest-matched', 'pakiet naprawdę podpisany, a nie „jest jakiś plik”');
    assert.equal((await adm.post('/api/school-year/students/st_nowak_jan/retain', {})).status, 400, 'druga klasa wymaga uchwały');
    expectOk(await adm.post('/api/school-year/students/st_nowak_jan/retain', { reason: 'uchwała rady pedagogicznej 12/2027' }));

    const dry = expectOk(await adm.post('/api/school-year/rollover', { dryRun: true }));
    assert.equal(dry.retaining, 1); assert.equal(T.db.data.config.year, '2026/2027', 'podgląd nic nie zmienia');

    const gradesBefore = T.db.col('grades').length, attBefore = T.db.col('attendance').length;
    const roll = expectOk(await adm.post('/api/school-year/rollover', { graduationDate: '2027-06-25', newClasses: [{ id: '1b', name: '1b', homeroomTeacherId: 'u_kaczmarek' }], reason: 'zakończenie roku 2026/2027' }));
    assert.equal(T.db.data.config.year, '2027/2028');
    assert.equal(roll.graduated, 4, 'ósmoklasiści kończą szkołę');
    assert.equal(T.db.get('students', 'st_baran_julia').classId, '8a', '7a → 8a razem z uczniami');
    assert.equal(T.db.get('users', 'u_sikora').homeroomOf, '8a', 'wychowawca idzie z oddziałem');
    assert.equal(T.db.get('students', 'st_nowak_jan').classId, '7b', 'powtarzający rok zostaje na swoim poziomie');
    assert.equal(T.db.get('students', 'st_borowska_aleksandra').status, 'graduated');
    assert.equal(T.db.one('users', (u) => u.studentId === 'st_borowska_aleksandra').blocked, true, 'absolwent traci dostęp do dziennika');
    assert.equal(T.db.col('grades').length, gradesBefore, 'oceny zostają');
    assert.equal(T.db.col('attendance').length, attBefore, 'frekwencja zostaje');
    assert.equal(T.db.col('timetable').length, 0, 'plan układa się od nowa');
    assert.equal(T.db.col('lessons').some((l) => l.date > '2027-06-25'), false);
    assert.ok(T.db.get('classes', '1b'), 'nowa pierwsza klasa z wychowawcą');
    const rolls = T.db.col('students').filter((s) => s.classId === '8a' && s.status === 'active').map((s) => s.rollNo).sort((a, b) => a - b);
    assert.deepEqual(rolls, rolls.map((_, i) => i + 1), 'numery w dzienniku nadane od nowa: ' + rolls.join(','));
    assert.ok(T.db.data.config.daysOff.some((d) => /Niepodległości/.test(d.name)), 'nowy rok dostaje ustawowe dni wolne');
    assert.ok(T.db.col('audit').some((a) => a.action === 'school_year_rollover'));
  } finally { T.close(); }
});

/* ======================================================================================
   Luki produktowe z docs/PILOT.md §4 — bez nich nowa szkoła nie da się uruchomić samą
   aplikacją: konta kadry (GAP-1), zakres opiekuna per dziecko (GAP-3, REG-17) i flagi
   ucznia (GAP-4).
   ====================================================================================== */

test('[3.5.6] GAP-1: administrator zakłada konto dowolnego pracownika z hasłem jednorazowym i parą kluczy', async () => {
  const c = await S.as('admin');
  const before = expectOk(await c.get('/api/admin/staff'));
  assert.ok(before.roles.includes('nurse') && before.roles.includes('dpo') && before.roles.includes('careEducator'),
    'lista ról to lista STAFF z server/auth.js, a nie podzbiór kreatora');
  assert.ok(before.staff.some((u) => u.login === 'j.nowak'), 'kadra z zasiewu jest widoczna');

  // 1. pedagog specjalny — rola spoza kreatora, konto z parą kluczy do notatek poufnych
  const made = expectOk(await c.post('/api/admin/staff', { role: 'psychologist', title: 'mgr', firstName: 'Hanna', lastName: 'Bednarek', email: 'h.bednarek@sp12.krakow.pl', phone: '600 900 100' }));
  assert.equal(made.user.role, 'psychologist');
  assert.equal(made.user.login, 'h.bednarek');
  assert.ok(typeof made.temporaryPassword === 'string' && made.temporaryPassword.length >= 12, 'hasło jednorazowe wraca raz, w odpowiedzi');
  assert.equal(require('../server/lib/crypto').checkPasswordPolicy(made.temporaryPassword).ok, true, 'i spełnia politykę złożoności');
  assert.equal(made.user.passwordHash, undefined, 'publicUser nie wypuszcza hasza');
  assert.equal(made.user.privateKey, undefined, 'ani klucza prywatnego');
  const row = S.db.get('users', made.user.id);
  assert.ok(row.publicKey && row.privateKey, 'psycholog prowadzi notatki szyfrowane — konto bez pary kluczy nie odczyta własnych wpisów');
  assert.equal(row.mustChangePassword, true);
  assert.ok(S.db.col('audit').some((a) => a.action === 'staff_created' && a.entityId === made.user.id));

  // 2. hasło jednorazowe naprawdę loguje i wymusza zmianę
  const fresh = S.client();
  const login = await fresh.post('/api/auth/login', { login: made.user.login, password: made.temporaryPassword });
  assert.equal(login.status, 200);
  assert.equal(login.body.mustChangePassword, true);

  // 3. rola bez pary kluczy (świetlica, stołówka, IOD) powstaje tak samo
  for (const role of ['careEducator', 'cafeteria', 'librarian', 'dpo']) {
    const r = expectOk(await c.post('/api/admin/staff', { role, firstName: 'Ala', lastName: 'Rola' + role }), role);
    assert.equal(r.user.role, role);
    assert.equal(!!S.db.get('users', r.user.id).publicKey, false, role + ' nie potrzebuje pary kluczy');
  }

  // 4. walidacje
  assert.equal((await c.post('/api/admin/staff', { role: 'wojewoda', firstName: 'X', lastName: 'Y' })).status, 400);
  assert.equal((await c.post('/api/admin/staff', { role: 'nurse', firstName: '', lastName: 'Y' })).status, 400);
  assert.equal((await c.post('/api/admin/staff', { role: 'teacher', firstName: 'A', lastName: 'B', subjects: ['nieznany'] })).status, 400);
  assert.equal((await c.post('/api/admin/staff', { role: 'nurse', firstName: 'A', lastName: 'B', subjects: ['mat'] })).status, 400, 'przedmioty tylko nauczycielom');
  assert.equal((await c.post('/api/admin/staff', { role: 'nurse', firstName: 'A', lastName: 'B', homeroomOf: '7b' })).status, 400, 'wychowawstwo tylko nauczycielom');
  assert.equal((await c.post('/api/admin/staff', { role: 'nurse', firstName: 'A', lastName: 'B', login: 'admin' })).status, 409, 'zajęty login wprost podany = błąd');

  // 5. nauczyciel z przedmiotami i wychowawstwem — oddział dostaje nowego wychowawcę, poprzedni traci wpis
  const prev = S.db.get('classes', '8b').homeroomTeacherId;
  const teacher = expectOk(await c.post('/api/admin/staff', { role: 'teacher', title: 'mgr', firstName: 'Igor', lastName: 'Sowiński', subjects: ['mat', 'inf'], homeroomOf: '8b' }));
  assert.deepEqual(teacher.user.subjects, ['mat', 'inf']);
  assert.equal(S.db.get('classes', '8b').homeroomTeacherId, teacher.user.id);
  assert.equal(S.db.get('users', prev).homeroomOf, null, 'poprzedni wychowawca nie zostaje z martwym wpisem');
  // porządki: oddajemy wychowawstwo poprzednikowi
  expectOk(await c.patch('/api/admin/staff/' + prev, { homeroomOf: '8b' }));
  assert.equal(S.db.get('classes', '8b').homeroomTeacherId, prev);

  // 6. dyrekcja czyta listę, ale nie zakłada kont
  const dyr = await S.as('dyrektor');
  expectOk(await dyr.get('/api/admin/staff'), 'dyrekcja czyta kadrę');
  assert.equal((await dyr.post('/api/admin/staff', { role: 'nurse', firstName: 'A', lastName: 'B' })).status, 403);
  const ped = await S.as('pedagog');
  assert.equal((await ped.get('/api/admin/staff')).status, 403);
});

test('[3.5.6] GAP-1: PATCH zmienia rolę, przedmioty i kontakt, blokada odcina sesje, a ostatni administrator zostaje', async () => {
  const c = await S.as('admin');
  const made = expectOk(await c.post('/api/admin/staff', { role: 'supportTeacher', firstName: 'Wanda', lastName: 'Korzeniowska' }));
  const id = made.user.id;

  // kontakt i przedmioty
  const patched = expectOk(await c.patch('/api/admin/staff/' + id, { email: 'w.korzeniowska@sp12.krakow.pl', phone: '511 222 333', title: 'mgr', subjects: ['pol'] }));
  assert.equal(patched.user.email, 'w.korzeniowska@sp12.krakow.pl');
  assert.deepEqual(patched.user.subjects, ['pol']);
  assert.equal((await c.patch('/api/admin/staff/' + id, { email: 'to-nie-adres' })).status, 400);
  const changed = S.db.col('audit').filter((a) => a.action === 'staff_updated' && a.entityId === id);
  assert.ok(changed.length && changed[0].before && changed[0].after, 'audyt niesie stan przed i po');

  // rola: awans na pedagoga dokłada parę kluczy, bo od teraz prowadzi notatki poufne
  expectOk(await c.patch('/api/admin/staff/' + id, { role: 'counselor' }));
  assert.ok(S.db.get('users', id).publicKey, 'nowa rola z notatkami poufnymi dostaje parę kluczy');

  // blokada: bez powodu odrzucona, z powodem odcina żywe sesje
  const her = S.client();
  expectOk(await her.post('/api/auth/login', { login: made.user.login, password: made.temporaryPassword }), 'logowanie hasłem jednorazowym');
  assert.equal(S.db.col('sessions').filter((s) => s.userId === id && !s.revoked).length, 1);
  assert.equal((await c.patch('/api/admin/staff/' + id, { blocked: true })).status, 400, 'blokada bez powodu');
  const blocked = expectOk(await c.patch('/api/admin/staff/' + id, { blocked: true, reason: 'rozwiązanie umowy z 31.10.2026' }));
  assert.equal(blocked.user.blocked, true);
  assert.equal(blocked.revokedSessions.total, 1);
  assert.equal(S.db.col('sessions').filter((s) => s.userId === id && !s.revoked).length, 0);
  assert.ok(S.db.col('audit').some((a) => a.action === 'account_blocked' && a.entityId === id));
  assert.equal((await her.get('/api/auth/session')).status, 401, 'odcięta sesja nie wraca');

  // dezaktywacja zamiast skasowania
  expectOk(await c.patch('/api/admin/staff/' + id, { blocked: false }));
  const off = expectOk(await c.delete('/api/admin/staff/' + id, { reason: 'koniec zastępstwa' }));
  assert.equal(off.user.blocked, true);
  assert.ok(S.db.get('users', id), 'konta pracownika się nie kasuje — wpisy w dzienniku zostają przy autorze');
  assert.ok(S.db.col('audit').some((a) => a.action === 'staff_deactivated' && a.entityId === id));
  assert.equal((await c.delete('/api/admin/staff/' + id, { reason: 'jeszcze raz' })).status, 409, 'konto jest już zablokowane');
  assert.equal((await c.delete('/api/admin/staff/' + id, {})).status, 400, 'dezaktywacja bez podstawy');

  // ostatni czynny administrator zostaje administratorem i zostaje czynny
  const admins = S.db.col('users').filter((u) => u.role === 'admin' && !u.blocked);
  assert.equal(admins.length, 1, 'w zasiewie jest jedno konto administratora');
  const me = admins[0].id;
  assert.equal((await c.patch('/api/admin/staff/' + me, { blocked: true, reason: 'próba' })).status, 400, 'własnego konta nie blokujemy');
  assert.equal((await c.delete('/api/admin/staff/' + me, { reason: 'próba' })).status, 400);
  const second = expectOk(await c.post('/api/admin/staff', { role: 'admin', firstName: 'Drugi', lastName: 'Administrator' }));
  assert.equal((await c.patch('/api/admin/staff/' + second.user.id, { role: 'librarian' })).status, 200, 'przy dwóch administratorach degradacja przechodzi');
  const lastOne = await c.patch('/api/admin/staff/' + me, { role: 'librarian' });
  assert.equal(lastOne.status, 409);
  assert.equal(lastOne.body.code, 'last_admin');
  assert.equal(S.db.get('users', me).role, 'admin');
});

test('[3.5.1] GAP-3/REG-17: zakres dostępu opiekuna zapisuje się przy dziecku, nie na koncie', async () => {
  const c = await S.as('sekretariat');
  const ANNA = 'st_kowalczyk_anna', PIOTR = 'st_kowalczyk_piotr', MARTA = 'u_p_kowalczyk';
  assert.ok(S.db.get('users', MARTA).childrenIds.includes(ANNA) && S.db.get('users', MARTA).childrenIds.includes(PIOTR),
    'to samo konto opiekuna prowadzi dwoje dzieci');

  // wizytówka kontaktowa sekretariatu zeszła z pola `guardians`, żeby zrobić miejsce na listę zakresów
  assert.ok(Array.isArray(S.db.get('students', ANNA).guardians), '`students[].guardians` to lista zakresów');
  assert.ok(S.db.get('students', ANNA).guardianContact.mother, 'dane matki zostały, pod własną nazwą');
  const book = expectOk(await c.get('/api/registry/students'));
  assert.ok(book.students.find((s) => s.id === ANNA).guardianContact.phone, 'księga nadal pokazuje kontakt');

  // pełny zakres przy Annie, informacyjny przy Piotrze — to samo konto
  const full = expectOk(await c.patch('/api/registry/students/' + ANNA + '/guardians/' + MARTA, { accessScope: 'full', legalBasis: 'oświadczenie matki z 20.10.2026' }));
  assert.equal(full.guardian.accessScope, 'full');
  const info = expectOk(await c.patch('/api/registry/students/' + PIOTR + '/guardians/' + MARTA, { accessScope: 'info', legalBasis: 'postanowienie sądu III Nsm 88/26', note: 'wgląd bez ocen' }));
  assert.equal(info.guardian.accessScope, 'info');
  assert.deepEqual(info.otherChildren, [{ studentId: ANNA, name: 'Anna Kowalczyk', accessScope: 'full' }],
    'zawężenie przy jednym dziecku nie rusza drugiego');

  // kształt zapisu to dokładnie ten, którego szuka D.guardianScope
  const entry = S.db.get('students', PIOTR).guardians.find((g) => g.userId === MARTA);
  assert.equal(entry.accessScope, 'info');
  assert.equal(entry.legalBasis, 'postanowienie sądu III Nsm 88/26');
  assert.equal(entry.since, S.TODAY);
  assert.equal(S.db.get('users', MARTA).accessScope, undefined, 'konto zostaje przy domyślnym zakresie');

  // audyt niesie stan przed i po
  const a = S.db.col('audit').filter((x) => x.action === 'guardian_scope_changed' && x.entityId === PIOTR).pop();
  assert.equal(a.before.accessScope, 'full');
  assert.equal(a.after.accessScope, 'info');
  assert.equal(a.reason, 'postanowienie sądu III Nsm 88/26');

  // widok sekretariatu pokazuje zakres obowiązujący przy TYM dziecku
  const view = expectOk(await c.get('/api/registry/students/' + PIOTR + '/guardians'));
  const g = view.guardians.find((x) => x.userId === MARTA);
  assert.equal(g.accessScope, 'info');
  assert.equal(g.perChild, true);
  assert.equal(g.accountScope, 'full');
  assert.deepEqual(view.scopes, ['full', 'info', 'none']);

  // walidacje
  assert.equal((await c.patch('/api/registry/students/' + PIOTR + '/guardians/' + MARTA, { accessScope: 'wszystko', legalBasis: 'x' })).status, 400);
  assert.equal((await c.patch('/api/registry/students/' + PIOTR + '/guardians/' + MARTA, { accessScope: 'none' })).status, 400, 'bez podstawy prawnej');
  assert.equal((await c.patch('/api/registry/students/' + PIOTR + '/guardians/u_p_nowak', { accessScope: 'none', legalBasis: 'x' })).status, 404, 'obcy opiekun');

  // przypięcie nowego opiekuna od razu zapisuje ten sam kształt
  const attach = expectOk(await c.post('/api/registry/students/' + PIOTR + '/guardians', { userId: 'u_p_zielinski', accessScope: 'none', reason: 'postanowienie sądu III Nsm 90/26' }));
  assert.equal(attach.guardian.accessScope, 'none');
  assert.equal(S.db.get('students', PIOTR).guardians.find((x) => x.userId === 'u_p_zielinski').accessScope, 'none');
  assert.equal(S.db.get('users', 'u_p_zielinski').accessScope, undefined, 'przypięcie nie ogranicza konta przy innych dzieciach');
  expectOk(await c.delete('/api/registry/students/' + PIOTR + '/guardians/u_p_zielinski', { reason: 'pomyłka sekretariatu', force: true }));
  assert.equal(S.db.get('students', PIOTR).guardians.some((x) => x.userId === 'u_p_zielinski'), false, 'odpięcie zabiera też zakres');

  // porządki dla innych testów w tym pliku
  const piotr = S.db.get('students', PIOTR); piotr.guardians = piotr.guardians.filter((x) => x.userId !== MARTA);
  const anna = S.db.get('students', ANNA); anna.guardians = anna.guardians.filter((x) => x.userId !== MARTA);
  S.db.save();
});

test('[3.5.1] GAP-4: flagi ucznia — pomoc społeczna uruchamia alert 3-dniowy dla pedagoga', async () => {
  const c = await S.as('sekretariat');
  const OLIWIA = 'st_kaczmarek_oliwia';                       // 7b, w zasiewie bez pomocy społecznej
  assert.equal(S.db.get('students', OLIWIA).socialWelfare, false);

  const before = expectOk(await c.get('/api/registry/students/' + OLIWIA + '/flags'));
  assert.equal(before.socialWelfare, false);
  const on = expectOk(await c.patch('/api/registry/students/' + OLIWIA + '/flags', { socialWelfare: true, reason: 'decyzja MOPS z 12.10.2026' }));
  assert.deepEqual(on.changed, ['socialWelfare']);
  assert.equal(on.flags.socialWelfare, true);
  const aud = S.db.col('audit').filter((a) => a.action === 'student_flags_changed' && a.entityId === OLIWIA).pop();
  assert.equal(aud.before.socialWelfare, false);
  assert.equal(aud.after.socialWelfare, true);
  assert.equal(aud.reason, 'decyzja MOPS z 12.10.2026');

  // pełnoletność bramkuje samodzielne usprawiedliwianie
  const tooEarly = await c.patch('/api/registry/students/' + OLIWIA + '/flags', { adultSelfExcuse: true });
  assert.equal(tooEarly.status, 400);
  assert.equal(tooEarly.body.code, 'not_adult');
  expectOk(await c.patch('/api/registry/students/' + OLIWIA + '/flags', { adult: true, adultSelfExcuse: true }));
  assert.equal(S.db.get('students', OLIWIA).adultSelfExcuse, true);
  expectOk(await c.patch('/api/registry/students/' + OLIWIA + '/flags', { adult: false, adultSelfExcuse: false }));

  // obywatelstwo i rodzaj dokumentu tożsamości
  expectOk(await c.patch('/api/registry/students/' + OLIWIA + '/flags', { nationality: 'PL' }));
  assert.equal(S.db.get('students', OLIWIA).nationality, 'PL');
  const noPassport = await c.patch('/api/registry/students/' + OLIWIA + '/flags', { identityKind: 'passport' });
  assert.equal(noPassport.status, 400, 'paszportu nie da się zadeklarować bez numeru — pakiet SIO by tego nie przyjął');

  // wychowawca poprawia flagi w swoim oddziale, obcy nauczyciel nie
  const JULIA = 'st_baran_julia';                              // 7a
  const hr = await S.as('b.sikora');                           // wychowawczyni 7a
  expectOk(await hr.patch('/api/registry/students/' + JULIA + '/flags', { socialWelfare: true, reason: 'decyzja MOPS' }), 'wychowawczyni swojego oddziału');
  expectOk(await hr.patch('/api/registry/students/' + JULIA + '/flags', { socialWelfare: false, reason: 'uchylenie decyzji' }));
  const stranger = await S.as('i.kaczmarek');                  // wychowawczyni 1a
  const nope = await stranger.patch('/api/registry/students/' + OLIWIA + '/flags', { socialWelfare: false });
  assert.equal(nope.status, 403);
  assert.equal(nope.body.code, 'not_homeroom');
  assert.equal((await stranger.get('/api/registry/students/' + OLIWIA + '/flags')).status, 403, 'i nie czyta ich nawet do odczytu');

  /* Alert 3-dniowy (3.4.15) opiera się wyłącznie na tej fladze: trzy dni pełnej nieobecności bez
     informacji od opiekuna muszą teraz uruchomić istniejący skan. */
  const db = S.db; const DAYS = ['2026-10-19', '2026-10-20', '2026-10-21'];
  for (const date of DAYS) {
    const rows = db.col('attendance').filter((a) => a.studentId === OLIWIA && a.date === date);
    if (!rows.length) {
      for (const l of db.col('lessons').filter((x) => x.date === date && x.classId === '7b')) {
        if (l.groupId) { const g = db.get('groups', l.groupId); if (!g || !g.studentIds.includes(OLIWIA)) continue; }
        db.col('attendance').push({ id: 'g4_att_' + date + '_' + l.lessonNo, lessonId: l.id, studentId: OLIWIA, date, lessonNo: l.lessonNo, classId: '7b', subjectId: l.subjectId, status: 'nb', minutes: 0, draft: false, byUserId: l.teacherId, at: date + 'T08:05:00Z', excuseId: null });
      }
    } else for (const a of rows) { a.status = 'nb'; a.draft = false; a.excuseId = null; }
  }
  db.data.excuses = db.col('excuses').filter((e) => !(e.studentId === OLIWIA && e.from <= '2026-10-21' && (e.to || e.from) >= '2026-10-19'));
  db.save();

  const ped = await S.as('pedagog');
  const out = expectOk(await ped.get('/api/support/attendance-alerts'));
  const alert = out.alerts.find((a) => a.studentId === OLIWIA);
  assert.ok(alert, 'po ustawieniu flagi skan tworzy alert — przed nią uczennica była dla niego niewidoczna');
  assert.equal(alert.kind, 'welfare-3-days');
  for (const d of DAYS) assert.ok(alert.days.includes(d), 'alert obejmuje ' + d);
  assert.ok(db.col('notifications').some((n) => n.userId === 'u_pedagog' && n.kind === 'attendance-alert' && n.crisis === true && n.text.includes('Kaczmarek')),
    'pedagog dostaje powiadomienie kryzysowe');
});

test('[3.5.1] S3-10: sąd zdejmuje się dokumentem, nie notatką — i stara podstawa nie jedzie na nowy wpis', async () => {
  const c = await S.as('sekretariat');
  const PIOTR = 'st_kowalczyk_piotr', MARTA = 'u_p_kowalczyk';
  const clean = () => { const s = S.db.get('students', PIOTR); s.guardians = (s.guardians || []).filter((x) => x.userId !== MARTA); S.db.save(); };
  clean();
  try {
    /* Nałożenie ograniczenia wymaga postanowienia z sygnaturą — to działało od R3. */
    const impose = expectOk(await c.patch('/api/registry/students/' + PIOTR + '/guardians/' + MARTA, {
      status: 'court-restricted', accessScope: 'none', legalBasis: 'postanowienie sądu',
      basis: { kind: 'court-order', reference: 'III Nsm 45/26', date: '2026-09-01' },
    }));
    assert.equal(impose.guardian.guardianStatus, 'court-restricted');
    assert.equal(impose.guardian.accessScope, 'none');

    /* Kontrola była jednokierunkowa: zdjęcie szło na wolnym tekście, a wiersz audytu przywracający
       pełny dostęp cytował postanowienie, które go odbierało. Reguła przejścia mieszka teraz
       w `D.guardianTransition`, a ta trasa ją tylko wywołuje. */
    const lift = await c.patch('/api/registry/students/' + PIOTR + '/guardians/' + MARTA, { status: 'full', accessScope: 'full', legalBasis: 'rodzic prosił' });
    assert.equal(lift.status, 400, 'zdjęcie ograniczenia na notatce telefonicznej');
    assert.equal(lift.body.code, 'guardian_basis_required');
    assert.equal(lift.body.transition, 'lift');
    assert.equal(S.db.get('students', PIOTR).guardians.find((x) => x.userId === MARTA).status, 'court-restricted', 'nic się nie zmieniło');

    const noRef = await c.patch('/api/registry/students/' + PIOTR + '/guardians/' + MARTA, { status: 'full', accessScope: 'full', legalBasis: 'pismo', basis: { kind: 'declaration' } });
    assert.equal(noRef.status, 400); assert.equal(noRef.body.code, 'guardian_basis_reference_required');

    const ok = expectOk(await c.patch('/api/registry/students/' + PIOTR + '/guardians/' + MARTA, {
      status: 'full', accessScope: 'full', legalBasis: 'postanowienie zmieniające',
      basis: { kind: 'court-order', reference: 'III Nsm 45/26 zm.', date: '2026-11-10' },
    }));
    assert.equal(ok.guardian.guardianStatus, 'full');
    assert.equal(ok.guardian.basis.reference, 'III Nsm 45/26 zm.', 'nowy dokument, nie odziedziczony');
    assert.notEqual(ok.guardian.basis.reference, 'III Nsm 45/26');
    const a = S.db.col('audit').filter((x) => x.action === 'guardian_status_changed' && x.entityId === PIOTR).pop();
    assert.equal(a.before.guardianStatus, 'court-restricted');
    assert.equal(a.after.guardianStatus, 'full');
    assert.equal(a.after.basis.reference, 'III Nsm 45/26 zm.', 'wiersz audytu nie cytuje postanowienia, które orzekało coś przeciwnego');
    assert.equal(a.after.transition, 'lift');
    assert.equal(a.after.basisCleared, true);
  } finally { clean(); }
});
