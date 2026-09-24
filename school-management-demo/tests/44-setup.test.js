'use strict';
const test = require('node:test'); const assert = require('node:assert/strict');
const { totpCode } = require('../server/lib/crypto');
const { startServer, fixtures } = require('./helpers');
/* Ten plik miał własnego klienta na gołym `fetch`, bez ponowienia i bez wpływu na `keepAliveTimeout`
   serwera — i to dlatego [setup.4]/[setup.6]/[setup.7] przewracały się z `TypeError: fetch failed`
   pod obciążeniem, a nie z powodu kodu, który sprawdzają (docs/review/round3/test-honesty.md §4).
   Teraz idzie tędy wspólny klient z tests/helpers.js. */
let S, app, base; const client = () => S.client();
test.before(async () => { S = await startServer({ blank: true }); app = S.app; base = S.base; });
test.after(() => S.close());

/* The wizard is a sequence, so [setup.3] used to need [setup.2] to have run first. The school +
   admin step is now built lazily and once (tests/helpers.js): in a whole-file run by [setup.2], with
   --test-name-pattern by whichever test asks for it, so every step also passes on its own. */
const need = fixtures();
const ADMIN_PW = 'Tarnow-2026!ok';
const schoolCreated = () => need('school', async () => {
  const c = client();
  const noName = await c.post('/api/setup/school', { school: { name: 'SP' }, admin: { login: 'admin', password: 'x', firstName: 'A', lastName: 'B' } });
  const weak = await c.post('/api/setup/school', { school: { name: 'Szkoła Podstawowa nr 5 w Tarnowie' }, admin: { login: 'admin', password: 'abc', firstName: 'A', lastName: 'B' } });
  const ok = await c.post('/api/setup/school', { school: { name: 'Szkoła Podstawowa nr 5 w Tarnowie', short: 'SP 5', address: 'ul. Lipowa 3, Tarnów', rspo: '99887' }, year: '2026/2027', locale: 'en', admin: { login: 'm.admin', password: ADMIN_PW, firstName: 'Marek', lastName: 'Zając' }, principal: { login: 'dyrektor', firstName: 'Ewa', lastName: 'Bober' } });
  return { c, noName, weak, ok };
});

test('[setup.1] a blank install reports setup needed and blocks everything but the wizard', async () => {
  const c = client(); const st = await c.get('/api/setup/status'); assert.equal(st.status, 200); assert.equal(st.body.needed, true); assert.equal(st.body.school, '');
  const login = await c.post('/api/auth/login', { login: 'x', password: 'y' }); assert.equal(login.status, 503); assert.equal(login.body.code, 'setup_required');
  assert.equal((await fetch(base + '/')).status, 200, 'the app shell itself is served so the wizard can run');
});
test('[setup.2] school + admin: validation, then creation signs the admin in; the wizard closes', async () => {
  const { c, noName, weak, ok } = await schoolCreated();
  assert.equal(noName.status, 400);
  assert.equal(weak.status, 400); assert.equal(weak.body.field, 'admin.password');
  assert.equal(ok.status, 200); assert.equal(ok.body.user.role, 'admin'); assert.match(ok.body.principalTempPassword, /-\d{4}/);
  assert.equal((await c.get('/api/setup/status')).body.needed, false);
  assert.equal((await client().post('/api/setup/school', { school: { name: 'Inna szkoła zupełnie' }, admin: { login: 'x2', password: ADMIN_PW, firstName: 'A', lastName: 'B' } })).status, 403);
  const ses = await c.get('/api/auth/session'); assert.equal(ses.body.user.login, 'm.admin'); assert.equal(ses.body.user.locale, 'en'); assert.equal(ses.body.config.school.short, 'SP 5');
  const dyr = client(); const l = await dyr.post('/api/auth/login', { login: 'dyrektor', password: ok.body.principalTempPassword }); assert.equal(l.status, 200); assert.equal(l.body.mustChangePassword, true);
});
test('[setup.3] teachers, students with parents and codes, timetable, lessons; summary and finish', async () => {
  await schoolCreated();
  const c = client(); await c.post('/api/auth/login', { login: 'm.admin', password: ADMIN_PW });
  const fm = await c.get('/api/setup/formats'); assert.equal(fm.status, 200); assert.match(fm.body.teachers.header, /login;firstName/);
  const t = await c.post('/api/setup/teachers/import', { csv: 'login;firstName;lastName;title;subjects;homeroomOf;email\nj.kowal;Jan;Kowal;mgr;mat|fiz;7a;j.kowal@sp5.pl\n;Anna;Lis;mgr;pol;;\nx;Zły;Wiersz;;xyz;;' });
  assert.equal(t.status, 200); assert.equal(t.body.count, 2); assert.equal(t.body.errors.length, 1); assert.ok(t.body.created[0].tempPassword); assert.equal(t.body.created[1].login, 'a.lis');
  const s = await c.post('/api/setup/students/import', { csv: 'class;rollNo;lastName;firstName;pesel;birthDate;birthPlace;parentLastName;parentFirstName;parentEmail;parentPhone\n7a;1;Adamska;Zofia;13241512849;2013-04-15;Tarnów;Adamska;Iwona;i.adamska@example.com;600111222\n7a;2;Bąk;Olaf;;2013-06-01;Tarnów;;;;\n7a;3;Cichy;Igor;12345678901;;;;;;' });
  assert.equal(s.status, 200); assert.equal(s.body.count, 2); assert.equal(s.body.errors.length, 1); assert.match(s.body.errors[0].error, /suma kontrolna/); assert.equal(s.body.codes.length, 1); assert.match(s.body.codes[0].code, /^7A-/);
  assert.equal(app.db.get('classes', '7a').studentIds.length, 2); assert.equal(app.db.get('classes', '7a').homeroomTeacherId, app.db.one('users', (u) => u.login === 'j.kowal').id);
  // parent activates with the code through the registrar's public endpoint
  const reg = await client().post('/api/register', { code: s.body.codes[0].code, login: 'i.adamska', password: 'Tarnow-2026!ok', firstName: 'Iwona', lastName: 'Adamska' }); assert.ok([200, 201].includes(reg.status), JSON.stringify(reg.body));
  const tt = await c.post('/api/admin/timetable/import', { csv: 'class;weekday;lessonNo;subject;teacherLogin;room;group\n7a;1;1;mat;j.kowal;12;\n7a;2;1;pol;a.lis;8;\n7a;5;2;fiz;j.kowal;24;', dryRun: false }); assert.equal(tt.status, 200, JSON.stringify(tt.body));
  const gen = await c.post('/api/setup/lessons/generate', {}); assert.equal(gen.status, 200); assert.ok(gen.body.created > 60, 'lessons for the whole year: ' + gen.body.created);
  const again = await c.post('/api/setup/lessons/generate', {}); assert.equal(again.body.created, 0, 'idempotent');
  const sum = await c.get('/api/setup/summary'); assert.equal(sum.body.teachers, 2); assert.equal(sum.body.students, 2); assert.equal(sum.body.timetable, 3); assert.equal(sum.body.done, false);
  const fin = await c.post('/api/setup/finish', {}); assert.equal(fin.status, 200); assert.equal(fin.body.summary.done, true);
  // the new teacher must change the temporary password, then sees her lessons
  const teach = client(); const tl = await teach.post('/api/auth/login', { login: 'j.kowal', password: t.body.created[0].tempPassword }); assert.equal(tl.body.mustChangePassword, true);
  assert.equal((await teach.post('/api/auth/password', { next: 'Nowe-Haslo-2026!' })).status, 200);
  const lessons = await teach.get('/api/lessons?from=2026-09-01&to=2027-06-30&classId=7a'); assert.equal(lessons.status, 200);
  assert.ok(app.db.col('audit').some((a) => a.action === 'setup_finished'));
});

/* ===================================================== przegląd operacyjny (docs/review/operations.md)
   Kreator na realnej skali: 400 uczniów, powtórzony plik, literówka w oddziale, cofnięcie pomyłki. */

/** Deterministyczny CSV szkoły: `classes` × `perClass` uczniów, rodzeństwo scalane po adresie e-mail. */
function studentsCsv(classes, perClass, opts) {
  const o = opts || {};
  const LAST = ['Nowak', 'Kowalski', 'Wiśniewski', 'Wójcik', 'Kowalczyk', 'Kamiński', 'Lewandowski', 'Zieliński', 'Szymański', 'Woźniak', 'Dąbrowski', 'Kozłowski', 'Jankowski', 'Mazur', 'Kwiatkowski'];
  const FIRST = ['Jan', 'Maja', 'Piotr', 'Zuzanna', 'Kacper', 'Julia', 'Szymon', 'Lena', 'Antoni', 'Hanna'];
  const pesel = (yy, mm, dd, serial, male) => { const b = `${String(yy).padStart(2, '0')}${String(mm + 20).padStart(2, '0')}${String(dd).padStart(2, '0')}${String(serial).padStart(3, '0')}${male ? 1 : 2}`; const w = [1, 3, 7, 9, 1, 3, 7, 9, 1, 3]; return b + ((10 - (w.reduce((s, wi, i) => s + wi * +b[i], 0) % 10)) % 10); };
  const rows = []; let n = 0, serial = 100;
  for (const cls of classes) for (let i = 1; i <= perClass; i++) {
    n++; const male = n % 2 === 0; const yy = 20 - (+cls.replace(/\D/g, '') || 1);
    const mm = 1 + (n % 12), dd = 1 + (n % 27); const fam = Math.ceil(n / 1.4);
    rows.push([cls, i, LAST[n % LAST.length], FIRST[n % FIRST.length], pesel(yy, mm, dd, serial++, male), `20${String(yy).padStart(2, '0')}-${String(mm).padStart(2, '0')}-${String(dd).padStart(2, '0')}`, 'Kraków', LAST[n % LAST.length], 'Rodzic' + fam, `rodzic${fam}@example.com`, '60010' + String(fam).padStart(4, '0')].join(';'));
  }
  if (o.messy) {
    rows.splice(5, 0, '9z;1;Literówka;Oddział;;2015-01-01;Kraków;;;;');              // literówka w kolumnie „class”
    rows.splice(20, 0, '3a;2;Zepsuty;Pesel;12345678901;2016-01-01;Kraków;;;;');      // zła suma kontrolna
    rows.splice(40, 0, ';;BezKlasy;Ktoś;;;;;;;');                                     // braki w wymaganych polach
    rows.push(rows[1]);                                                               // ten sam uczeń dwa razy
  }
  return ['class;rollNo;lastName;firstName;pesel;birthDate;birthPlace;parentLastName;parentFirstName;parentEmail;parentPhone', ...rows].join('\n');
}
const CLASSES_24 = [].concat(...[1, 2, 3, 4, 5, 6, 7, 8].map((l) => ['a', 'b', 'c'].map((x) => l + x)));
function teachersCsv(n) { const subj = ['mat', 'pol', 'ang', 'fiz', 'his', 'bio', 'che', 'geo', 'inf', 'wf']; return ['login;firstName;lastName;title;subjects;homeroomOf;email', ...Array.from({ length: n }, (_, i) => `t${i + 1};Imię${i + 1};Nazwisko${i + 1};mgr;${subj[i % subj.length]};;t${i + 1}@sp.pl`)].join('\n'); }
function timetableCsv(classes) { const subj = ['mat', 'pol', 'ang', 'fiz', 'his', 'bio']; const out = []; let k = 0; for (const cls of classes) for (let wd = 1; wd <= 5; wd++) for (let no = 1; no <= 6; no++) { k++; out.push(`${cls};${wd};${no};${subj[no - 1]};t${1 + (k % 30)};${100 + (k % 40)};`); } return ['class;weekday;lessonNo;subject;teacherLogin;room;group', ...out].join('\n'); }
/** Świeża pusta instancja z założoną szkołą i zalogowanym administratorem. */
async function blankSchool() {
  const s = await startServer({ blank: true });
  const c = s.client();
  await c.post('/api/setup/school', { school: { name: 'Szkoła Podstawowa nr 400 w Krakowie', short: 'SP 400', address: 'ul. Duża 1', rspo: '40040' }, year: '2026/2027', admin: { login: 'admin', password: 'Wielka-Szkola-2026!', firstName: 'Ala', lastName: 'Adm' } });
  return { app: s.app, c, close: () => s.close() };
}

/* Nazwa obiecywała „czas poniżej sekundy”, a asercja dopuszczała pięć — na współdzielonej maszynie
   zegar ścienny i tak niczego nie dowodzi (docs/review/round3/test-honesty.md §2). Dowodem na to, że
   import 400 uczniów nie liczy 800 hashów scrypt, jest `passwordHash === null` na każdym koncie
   założonym importem; to jest sprawdzane niżej i to jest ten sam fakt, tylko mierzalny. */
test('[setup.4] import 400 uczniów: próbny przebieg, duplikaty odrzucone, numery księgi bez dziur, konta bez hasła', async () => {
  const S = await blankSchool();
  try {
    assert.equal((await S.c.post('/api/setup/teachers/import', { csv: teachersCsv(30) })).body.count, 30);
    const csv = studentsCsv(CLASSES_24, 17, { messy: true });
    assert.equal(csv.split('\n').length - 1, 412, 'plik ma 408 uczniów i 4 wiersze do zgłoszenia');

    const dry = await S.c.post('/api/setup/students/import', { csv, dryRun: true });
    assert.equal(dry.status, 200);
    assert.equal(S.app.db.col('students').length, 0, 'próbny przebieg niczego nie zapisuje');
    assert.equal(dry.body.errors.length, 3, JSON.stringify(dry.body.errors));
    assert.ok(dry.body.errors.every((e) => Number.isInteger(e.line)), 'każdy błąd ma numer wiersza');
    assert.ok(dry.body.errors.some((e) => /suma kontrolna/.test(e.error)));
    assert.ok(dry.body.errors.some((e) => /Wymagane: oddział, nazwisko i imię/.test(e.error)));
    assert.ok(dry.body.errors.some((e) => /powtarza się w tym pliku/.test(e.error)), 'powtórzony wiersz wyłapany już przy próbie');
    assert.ok(dry.body.warnings.some((w) => /9z/.test(w.warning)), 'oddział z literówki jest zgłoszony jako ostrzeżenie: ' + JSON.stringify(dry.body.warnings));

    const r = await S.c.post('/api/setup/students/import', { csv });
    assert.equal(r.status, 200);
    assert.equal(r.body.count, 409, 'zapisano tylu uczniów, ile zapowiedział próbny przebieg minus duplikat');

    const regs = S.app.db.col('students').map((s) => s.registerNo).sort((a, b) => a - b);
    assert.deepEqual(regs, regs.map((_, i) => regs[0] + i), 'numery w księdze uczniów są kolejne, bez dziur');
    for (const cls of S.app.db.col('classes')) {
      const rolls = S.app.db.col('students').filter((s) => s.classId === cls.id).map((s) => s.rollNo);
      assert.equal(new Set(rolls).size, rolls.length, `oddział ${cls.id} ma powtórzony numer w dzienniku`);
    }
    const pesels = S.app.db.col('students').map((s) => s.pesel).filter(Boolean);
    assert.equal(new Set(pesels).size, pesels.length, 'żaden PESEL nie powtarza się w księdze');
    const parents = S.app.db.col('users').filter((u) => u.role === 'parent');
    assert.equal(new Set(parents.map((p) => p.email)).size, parents.length, 'rodzeństwo scalone po adresie e-mail');
    assert.ok(parents.some((p) => p.childrenIds.length > 1), 'a rodzice rodzeństwa mają oba dzieci na jednym koncie');
    assert.equal(parents.every((p) => p.passwordHash === null), true, 'konta rodziców czekają na aktywację kodem');

    const again = await S.c.post('/api/setup/students/import', { csv });
    assert.equal(again.body.count, 0, 'powtórne wgranie tego samego pliku nie tworzy nikogo');
    assert.ok(again.body.errors.length > 400);
    assert.match(again.body.errors[0].error, /należy już do ucznia/);
  } finally { await S.close(); }
});

test('[setup.5] pomyłkowy import da się cofnąć, dopóki nic na nim nie zapisano', async () => {
  const S = await blankSchool();
  try {
    await S.c.post('/api/setup/teachers/import', { csv: teachersCsv(3) });
    const r = await S.c.post('/api/setup/students/import', { csv: studentsCsv(['5a', '5b'], 6) });
    assert.equal(r.body.count, 12);
    const listed = await S.c.get('/api/setup/imports');
    assert.equal(listed.body.imports[0].id, r.body.importId);
    assert.equal(listed.body.imports[0].undoable, true);

    const undone = await S.c.post(`/api/setup/imports/${r.body.importId}/undo`, { reason: 'wgrany plik z zeszłego roku' });
    assert.equal(undone.status, 200, JSON.stringify(undone.body));
    assert.equal(undone.body.removed.students, 12);
    assert.equal(S.app.db.col('students').length, 0);
    assert.equal(S.app.db.col('users').filter((u) => u.role === 'parent').length, 0);
    assert.equal(S.app.db.col('registrationCodes').length, 0);
    assert.equal(S.app.db.col('classes').filter((c) => c.id === '5a' || c.id === '5b').length, 0, 'puste oddziały z pomyłkowego importu też znikają');
    assert.ok(S.app.db.col('audit').some((a) => a.action === 'import_undone'));
    assert.equal((await S.c.post(`/api/setup/imports/${r.body.importId}/undo`, {})).status, 400, 'drugi raz już nie');

    const again = await S.c.post('/api/setup/students/import', { csv: studentsCsv(['5a'], 4) });
    S.app.db.col('grades').push({ id: 'g_test', studentId: again.body.created[0].id, subjectId: 'mat', value: '4', deleted: false });
    const blocked = await S.c.post(`/api/setup/imports/${again.body.importId}/undo`, { reason: 'zmiana zdania' });
    assert.equal(blocked.status, 409);
    assert.equal(blocked.body.code, 'import_in_use');
    assert.match(blocked.body.blockers[0], /ma wpisane oceny/);
    assert.equal(S.app.db.col('students').length, 4, 'nic nie zostało usunięte');
  } finally { await S.close(); }
});

test('[setup.6] pusta instalacja zna ustawowe dni wolne — kreator nie generuje lekcji w święta', async () => {
  const S = await blankSchool();
  try {
    const cfg = S.app.db.data.config;
    assert.ok(cfg.daysOff.some((d) => d.date === '2026-11-11'), 'Narodowe Święto Niepodległości: ' + JSON.stringify(cfg.daysOff));
    /* OPS3-01 — Poniedziałek Wielkanocny (29.03.2027) leży w wiosennej przerwie świątecznej
       [Wielkanoc−3, Wielkanoc+2], a walidator struktury roku uznaje dzień wolny wewnątrz przerwy za
       sprzeczny wpis. Kreator wypisywał go w obu miejscach naraz, więc `PATCH /api/admin/year` z jego
       własnym kalendarzem kończył się 400 — w każdej szkole i w każdym roku. Jest więc tylko
       w przerwie, a lekcji tego dnia i tak nie ma (niżej). */
    assert.equal(cfg.daysOff.some((d) => d.date === '2027-03-29'), false, 'Poniedziałek Wielkanocny nie jest dublowany jako osobny dzień wolny');
    assert.ok(cfg.holidays.some((hd) => '2027-03-29' >= hd.from && '2027-03-29' <= hd.to), 'ale mieści się w wiosennej przerwie świątecznej');
    assert.ok(cfg.daysOff.some((d) => d.date === '2027-05-27'), 'Boże Ciało');
    assert.ok(cfg.holidays.some((h) => h.from === '2026-12-23'), 'zimowa przerwa świąteczna');
    assert.ok(cfg.holidays.some((h) => h.name === 'Wiosenna przerwa świąteczna' && h.from === '2027-03-25'));

    await S.c.post('/api/setup/teachers/import', { csv: teachersCsv(30) });
    await S.c.post('/api/setup/students/import', { csv: studentsCsv(['1a', '2a'], 4) });
    const tt = await S.c.post('/api/admin/timetable/import', { csv: timetableCsv(['1a', '2a']), dryRun: false, force: true });
    assert.equal(tt.status, 200, JSON.stringify(tt.body).slice(0, 200));
    const gen = await S.c.post('/api/setup/lessons/generate', {});
    assert.ok(gen.body.created > 300, 'lekcje na cały rok: ' + gen.body.created);
    for (const d of ['2026-11-11', '2026-12-25', '2027-01-01', '2027-03-29', '2027-05-03', '2027-05-27']) {
      assert.equal(S.app.db.col('lessons').filter((l) => l.date === d).length, 0, 'lekcje w święto ' + d);
    }
    assert.ok(S.app.db.col('lessons').some((l) => l.date === '2026-11-12'), 'a dzień po święcie jest normalnym dniem nauki');
  } finally { await S.close(); }
});

/* GAP-6 — jedna data przyjęcia. Import stemplował `enrolledAt` dniem wgrania pliku, więc po
   wrześniowym imporcie cały rocznik wyglądał na dopisany w trakcie roku. */
test('[setup.7] import stempluje datę przyjęcia z pliku, a bez niej — początkiem roku szkolnego, nie dniem importu', async () => {
  await schoolCreated();
  const c = client(); await c.post('/api/auth/login', { login: 'm.admin', password: ADMIN_PW });
  const start = app.db.data.config.semesters[0].from;
  const D = require('../server/lib/domain');
  const today = D.today(app.db);
  assert.notEqual(start, today, 'w tym roku szkolnym początek roku to nie dziś — inaczej test niczego nie dowodzi');

  const fm = await c.get('/api/setup/formats');
  assert.match(fm.body.students.header, /;enrolledAt;/, 'kolumna daty przyjęcia jest częścią formatu wymiany');
  assert.match(fm.body.students.note, /enrolledAt/);

  const header = 'class;rollNo;lastName;firstName;pesel;birthDate;birthPlace;enrolledAt;parentLastName;parentFirstName;parentEmail;parentPhone';
  const csv = [header,
    '5c;1;Wrzos;Maja;;2014-02-03;Kraków;;;;;',                       // bez daty → początek roku
    '5c;2;Wrzos;Borys;;2014-02-03;Kraków;2027-02-15;;;;',            // przyjęty w drugim semestrze
    '5c;3;Wrzos;Cyprian;;2014-02-03;Kraków;15.02.2027;;;;'           // zła data → wiersz odrzucony
  ].join('\n');

  const dry = await c.post('/api/setup/students/import', { csv, dryRun: true });
  assert.equal(dry.status, 200);
  assert.equal(dry.body.created.length, 2, 'wiersz ze złą datą nie wchodzi nawet do przebiegu próbnego');
  assert.equal(dry.body.created[0].enrolledAt, start);
  assert.equal(dry.body.created[1].enrolledAt, '2027-02-15');
  assert.equal(dry.body.errors.filter((e) => e.code === 'bad_date').length, 1);
  assert.match(dry.body.errors.find((e) => e.code === 'bad_date').error, /RRRR-MM-DD/);

  const r = await c.post('/api/setup/students/import', { csv });
  assert.equal(r.status, 200);
  assert.equal(r.body.created.length, 2);
  const maja = app.db.one('students', (s) => s.firstName === 'Maja' && s.lastName === 'Wrzos');
  const borys = app.db.one('students', (s) => s.firstName === 'Borys' && s.lastName === 'Wrzos');
  assert.equal(maja.enrolledAt, start, 'pusta kolumna = początek roku szkolnego, a nie dzień wgrania pliku');
  assert.notEqual(maja.enrolledAt, today);
  assert.equal(borys.enrolledAt, '2027-02-15', 'data z pliku ma pierwszeństwo');
  assert.ok(!app.db.one('students', (s) => s.firstName === 'Cyprian' && s.lastName === 'Wrzos'), 'wiersz ze złą datą nie został zapisany');

  /* `enrolledOn()` (routes/attendance.js) czyta obie nazwy, ale `enrolledAt` jest jedyną, którą pisze
     import — uczeń z wrześniowego rocznika stoi na liście od pierwszego dnia roku. */
  const { enrolledOn } = require('../server/routes/attendance');
  assert.equal(enrolledOn(app.db, maja.id, start), true);
  assert.equal(enrolledOn(app.db, borys.id, start), false);
  assert.equal(enrolledOn(app.db, borys.id, '2027-02-15'), true);
});
