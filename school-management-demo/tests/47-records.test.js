'use strict';
/* S-10 — kto czyta kartę ucznia. Decyzja produktowa z docs/review/FIXPLAN.md: oceny, uwagi, zadania
   i oceny opisowe widzą uczeń, opiekun z pełnym zakresem dostępu, nauczyciel uczący tego ucznia,
   wychowawca, dyrektor i zespół wspierający. Świetlica, stołówka, biblioteka, pielęgniarka, IOD,
   sekretariat i administrator zostają przy katalogu ucznia i obecności. */
const test = require('node:test'); const assert = require('node:assert/strict');
const { startServer, expectOk } = require('./helpers');
const D = require('../server/lib/domain');

let S; test.before(async () => { S = await startServer(); }); test.after(() => S.close());

const ANNA = 'st_kowalczyk_anna';   // 7b
const LEON = 'st_adamczyk_leon';    // klasy 1–3, ocena opisowa

/** Role, które wg decyzji produktowej nie mają potrzeby wglądu w oceny i uwagi. */
const NO_RECORD = ['biblioteka', 'stolowka', 'swietlica', 'pielegniarka', 'iod', 'sekretariat', 'admin'];

test('[S-10] stołówka, biblioteka, świetlica, pielęgniarka, IOD, sekretariat i administrator nie czytają ocen ani uwag', async () => {
  for (const login of NO_RECORD) {
    const c = await S.as(login);
    const grades = await c.get('/api/grades/student/' + ANNA);
    assert.equal(grades.status, 403, `${login} nie widzi ocen`);
    assert.equal(grades.body.code, 'forbidden');
    assert.equal(grades.body.deny, 'record_scope');
    assert.match(grades.body.error, /nie są dostępne dla tej roli/);

    assert.equal((await c.get('/api/grades/record/' + ANNA)).status, 403, `${login} nie drukuje wykazu ocen`);
    assert.equal((await c.get('/api/remarks?studentId=' + ANNA)).status, 403, `${login} nie widzi uwag`);
    assert.equal((await c.get('/api/remarks/points/' + ANNA)).status, 403, `${login} nie widzi punktów zachowania`);
    assert.equal((await c.get('/api/descriptive-grades?studentId=' + LEON)).status, 403, `${login} nie widzi oceny opisowej`);
  }
  /* żadna z tych ról nie zostawia śladu odczytu w audycie — bo odczyt nie doszedł do skutku */
  assert.equal(S.db.col('audit').some((a) => a.action === 'grades_record_print' && a.userId === 'u_bibliotekarz'), false);
});

test('[S-10] uczeń, dyrektor, zespół wspierający i nauczyciel uczący czytają kartę ucznia', async () => {
  for (const login of ['anna.kowalczyk', 'dyrektor', 'pedagog', 'e.zielinska', 'pedagog.specjalny', 'logopeda', 'n.wspomagajacy', 'j.nowak']) {
    const c = await S.as(login);
    expectOk(await c.get('/api/grades/student/' + ANNA), login + ' → oceny');
    expectOk(await c.get('/api/remarks?studentId=' + ANNA), login + ' → uwagi');
  }
});

test('[S-10] nauczyciel widzi tylko uczniów, których uczy albo ma pod wychowawstwem', async () => {
  const stranger = await S.as('i.kaczmarek');            // edukacja wczesnoszkolna 1a, nie uczy w 7b
  const denied = await stranger.get('/api/grades/student/' + ANNA);
  assert.equal(denied.status, 403);
  assert.equal(denied.body.code, 'forbidden');
  assert.equal(denied.body.deny, 'not_teaching_pupil');
  assert.match(denied.body.error, /uczniów, których uczysz/);
  assert.equal((await stranger.get('/api/remarks?studentId=' + ANNA)).status, 403);
  assert.equal((await stranger.get('/api/grades/record/' + ANNA)).status, 403);

  /* wychowawczyni 7b czyta każdy przedmiot, także ten, którego sama nie uczy */
  const homeroom = await S.as('j.nowak');
  const all = expectOk(await homeroom.get('/api/grades/student/' + ANNA + '?subjectId=pol'));
  assert.equal(all.studentId, ANNA);

  /* nauczyciel spoza oddziału, ale prowadzący grupę międzyoddziałową, ucznia z tej grupy widzi */
  assert.equal(D.teachesPupil(S.db, S.db.get('users', 'u_wojcik'), ANNA), true, 'fizyka w 7b');
  const groups = S.db.col('groups');
  const g = groups.find((x) => x.id === 'g_cross_inf');
  const wasTeacher = g.teacherId;
  g.teacherId = 'u_kaczmarek';
  assert.equal(D.teachesPupil(S.db, S.db.get('users', 'u_kaczmarek'), ANNA), true, 'koło informatyczne 7a+7b');
  assert.equal(D.teachesPupil(S.db, S.db.get('users', 'u_kaczmarek'), 'st_szymaski_tomasz'), false, 'ale już nie resztę 7b');
  if (wasTeacher === undefined) delete g.teacherId; else g.teacherId = wasTeacher;
});

test('[S-10] zakres dostępu opiekuna: full czyta wszystko, info bez ocen, none nic', async () => {
  const parent = S.db.get('users', 'u_p_kowalczyk');
  const was = parent.accessScope;
  const c = await S.as('rodzic.kowalczyk');

  assert.equal(D.guardianScope(S.db, parent, ANNA), 'full', 'brak zapisu = pełny dostęp');
  expectOk(await c.get('/api/grades/student/' + ANNA));

  parent.accessScope = 'info';
  assert.equal(D.guardianScope(S.db, parent, ANNA), 'info');
  const info = await c.get('/api/grades/student/' + ANNA);
  assert.equal(info.status, 403);
  assert.equal(info.body.code, 'forbidden');
  assert.equal(info.body.deny, 'guardian_scope');
  assert.equal(info.body.scope, 'info');
  assert.match(info.body.error, /bez ocen/);
  assert.equal((await c.get('/api/remarks?studentId=' + ANNA)).status, 403);
  assert.equal((await c.get('/api/grades/record/' + ANNA)).status, 403);
  /* frekwencja i katalog zostają dostępne — to rodzaje 'attendance' i 'directory' */
  assert.doesNotThrow(() => D.assertMayReadPupilRecord(S.db, parent, ANNA, 'attendance'));
  assert.doesNotThrow(() => D.assertMayReadPupilRecord(S.db, parent, ANNA, 'directory'));

  parent.accessScope = 'none';
  const none = await c.get('/api/grades/student/' + ANNA);
  assert.equal(none.status, 403);
  assert.equal(none.body.scope, 'none');
  assert.throws(() => D.assertMayReadPupilRecord(S.db, parent, ANNA, 'attendance'), /ograniczony/);

  /* zapis przy uczniu (students[].guardians[]) ma pierwszeństwo przed zapisem na koncie */
  const student = S.db.get('students', ANNA);
  const wasGuardians = student.guardians;
  student.guardians = [{ userId: parent.id, accessScope: 'full' }];
  assert.equal(D.guardianScope(S.db, parent, ANNA), 'full');
  expectOk(await c.get('/api/grades/student/' + ANNA), 'zapis przy uczniu przywraca pełny dostęp');

  student.guardians = wasGuardians;
  if (was === undefined) delete parent.accessScope; else parent.accessScope = was;
  expectOk(await c.get('/api/grades/student/' + ANNA));
});

test('[S-10] obcy rodzic i obcy uczeń nadal dostają 403 z dotychczasowym kodem', async () => {
  const other = await S.as('rodzic.nowak');
  const r = await other.get('/api/grades/student/' + ANNA);
  assert.equal(r.status, 403);
  assert.equal(r.body.code, 'forbidden', 'krąg dostępu sprawdzany jest przed rolą');
  const pupil = await S.as('jan.nowak');
  assert.equal((await pupil.get('/api/remarks?studentId=' + ANNA)).status, 403);
  /* lista całego oddziału pozostaje zamknięta dla ucznia i rodzica */
  assert.equal((await pupil.get('/api/remarks?classId=7b')).status, 403);
  assert.equal((await other.get('/api/remarks?classId=7b')).status, 403);
});

test('[S-10] helper jest jeden dla wszystkich modułów i zna wszystkie rodzaje danych', () => {
  assert.deepEqual(D.RECORD_KINDS, ['grades', 'remarks', 'homework', 'descriptive', 'attendance', 'directory']);
  assert.equal(typeof D.assertMayReadPupilRecord, 'function');
  assert.equal(typeof D.guardianScope, 'function');
  assert.equal(typeof D.teachesPupil, 'function');
  /* visibleStudentIds / assertCanSeeStudent zostają dla pozostałych modułów */
  assert.deepEqual(D.visibleStudentIds(S.db, S.db.get('users', 'u_p_nowak')), ['st_nowak_jan']);
  assert.equal(D.visibleStudentIds(S.db, S.db.get('users', 'u_nowak')), null);
  assert.throws(() => D.assertCanSeeStudent(S.db, S.db.get('users', 'u_p_nowak'), ANNA), /Brak dostępu/);
  /* nieznany rodzaj traktujemy jak najostrzejszy, czyli 'grades' */
  assert.throws(() => D.assertMayReadPupilRecord(S.db, S.db.get('users', 'u_bibliotekarz') || { role: 'librarian' }, ANNA, 'cokolwiek'), /nie są dostępne dla tej roli/);
});

test('[S-10] zadania domowe i homework korzystają z tego samego rodzaju danych', () => {
  const librarian = S.db.col('users').find((u) => u.role === 'librarian');
  for (const kind of ['grades', 'remarks', 'homework', 'descriptive'])
    assert.throws(() => D.assertMayReadPupilRecord(S.db, librarian, ANNA, kind), /nie są dostępne dla tej roli/, kind);
  for (const kind of ['attendance', 'directory'])
    assert.doesNotThrow(() => D.assertMayReadPupilRecord(S.db, librarian, ANNA, kind), kind);
});

/* ================================================================================================
   Second-pass regressions on the record gate (docs/review/regressions.md). Each case is one the
   first round left untested: the edges of "who teaches this pupil" and the exact `deny` reason. */

test('[S-10] p.o. wychowawcy, zastępca na jednej lekcji i nauczyciel grupy czytają kartę; poprzedni semestr też', () => {
  const db = S.db;
  const u = (id) => db.get('users', id);
  const reads = (user, sid) => { try { D.assertMayReadPupilRecord(db, user, sid || ANNA, 'grades'); return true; } catch (e) { return (e.extra && e.extra.deny) || 'throw'; } };
  const stranger = u('u_kaczmarek');                       // edukacja wczesnoszkolna 1a
  assert.equal(reads(stranger), 'not_teaching_pupil', 'punkt wyjścia: nie uczy 7b');

  /* p.o. wychowawcy */
  const cls = db.get('classes', '7b');
  const wasActing = cls.actingHomeroomTeacherId;
  cls.actingHomeroomTeacherId = stranger.id;
  assert.equal(reads(stranger), true, 'p.o. wychowawcy czyta wszystkie przedmioty');
  cls.actingHomeroomTeacherId = wasActing === undefined ? undefined : wasActing;
  delete cls.actingFrom; delete cls.actingTo;
  if (wasActing === undefined) delete cls.actingHomeroomTeacherId;
  assert.equal(reads(stranger), 'not_teaching_pupil', 'i traci dostęp po cofnięciu powierzenia');

  /* zastępstwo na jednej jedynej lekcji wystarcza, żeby zobaczyć kartę ucznia z tego oddziału */
  const lesson = db.col('lessons').find((l) => l.classId === '7b');
  const wasSub = lesson.substituteTeacherId;
  lesson.substituteTeacherId = stranger.id;
  assert.equal(reads(stranger), true, 'jedno zastępstwo = dostęp do karty');
  lesson.substituteTeacherId = wasSub;
  assert.equal(reads(stranger), 'not_teaching_pupil');

  /* nauczyciel, który uczył oddziału wyłącznie w pierwszym semestrze, dostęp zachowuje:
     bez tego nie wystawi ani nie obroni oceny klasyfikacyjnej, którą sam postawił (REG-13) */
  const old = { id: 'les_stare_7b', date: '2026-09-02', lessonNo: 1, classId: '7b', subjectId: 'his', teacherId: stranger.id, status: 'held' };
  db.col('lessons').push(old);
  assert.equal(reads(stranger), true, 'lekcja z września nadal otwiera kartę');
  db.remove('lessons', old.id);
  assert.equal(reads(stranger), 'not_teaching_pupil');
});

test('[S-10] odmowa zawsze niesie powód: krąg dostępu, sprzeciw pełnoletniego i zakres opiekuna', async () => {
  const db = S.db;
  const denial = (user, sid, kind) => { try { D.assertMayReadPupilRecord(db, user, sid, kind || 'grades'); return null; } catch (e) { return Object.assign({ status: e.status }, e.extra); } };

  /* obcy rodzic i obcy uczeń — 403 z powodem, nie samo `forbidden` */
  assert.deepEqual(denial(db.get('users', 'u_p_nowak'), ANNA), { status: 403, code: 'forbidden', deny: 'guardian_scope', scope: 'none' });
  const pupil = db.col('users').find((x) => x.role === 'student' && x.studentId !== ANNA);
  assert.deepEqual(denial(pupil, ANNA), { status: 403, code: 'forbidden', deny: 'record_scope' });

  /* uczeń pełnoletni wnosi sprzeciw: konto opiekuna traci wgląd, a powód nazywa rzecz po imieniu */
  const s = db.get('students', ANNA); const parent = db.get('users', 'u_p_kowalczyk');
  s.parentAccessBlocked = true;
  const blocked = denial(parent, ANNA);
  assert.equal(blocked.status, 403); assert.equal(blocked.code, 'forbidden');
  assert.equal(blocked.deny, 'guardian_scope'); assert.equal(blocked.scope, 'none');
  assert.equal(blocked.parentAccessBlocked, true);
  assert.equal(denial(parent, ANNA, 'attendance').deny, 'guardian_scope', 'sprzeciw obejmuje też frekwencję i katalog');
  assert.equal(denial(parent, ANNA, 'directory').deny, 'guardian_scope');
  const c = await S.as('rodzic.kowalczyk');
  const http = await c.get('/api/grades/student/' + ANNA);
  assert.equal(http.status, 403);
  assert.equal(http.body.deny, 'guardian_scope');
  assert.equal(http.body.scope, 'none');
  s.parentAccessBlocked = false;
  assert.equal(denial(parent, ANNA), null, 'i wraca po cofnięciu sprzeciwu');
});

test('[S-10] zakres przy uczniu bije zakres na koncie w obie strony', () => {
  const db = S.db;
  const parent = db.get('users', 'u_p_kowalczyk'); const s = db.get('students', ANNA);
  const was = parent.accessScope; const wasG = s.guardians;

  parent.accessScope = 'full';
  s.guardians = [{ userId: parent.id, accessScope: 'info' }];
  assert.equal(D.guardianScope(db, parent, ANNA), 'info', 'zapis przy uczniu ogranicza konto z pełnym dostępem');
  s.guardians = [{ id: parent.id, accessScope: 'none' }];
  assert.equal(D.guardianScope(db, parent, ANNA), 'none', 'lista opiekunów bywa kluczowana przez `id`, nie `userId`');

  parent.accessScope = 'none';
  s.guardians = [{ userId: parent.id, accessScope: 'full' }];
  assert.equal(D.guardianScope(db, parent, ANNA), 'full', 'i rozszerza konto ograniczone');

  /* opiekun, którego na liście przy uczniu nie ma, zostaje przy zakresie z konta */
  s.guardians = [{ userId: 'u_ktos_inny', accessScope: 'full' }];
  assert.equal(D.guardianScope(db, parent, ANNA), 'none');

  /* stary kształt pola (obiekt z danymi matki i ojca z sekretariatu) nie jest listą zakresów */
  s.guardians = { mother: 'Ewa Kowalczyk', father: '', phone: '', email: '', address: '' };
  assert.equal(D.guardianScope(db, parent, ANNA), 'none', 'i nie przewraca odczytu');

  parent.accessScope = 'nonsens';
  assert.equal(D.guardianScope(db, parent, ANNA), 'full', 'nieznana wartość = pełny dostęp, nigdy cichy brak');
  assert.equal(D.guardianScope(db, db.get('users', 'u_nowak'), ANNA), 'full', 'a rola inna niż opiekun nie ma zakresu opiekuna');

  s.guardians = wasG; if (was === undefined) delete parent.accessScope; else parent.accessScope = was;
});

test('[S-10] uczeń skreślony z listy zostaje w kartotece wychowawcy', async () => {
  const TOM = 'st_szymaski_tomasz';
  const hr = await S.as('j.nowak');                        // wychowawczyni 7b
  expectOk(await hr.get('/api/grades/student/' + TOM), 'przed skreśleniem');
  expectOk(await hr.post('/api/homeroom/students/' + TOM + '/remove', { date: '2027-01-26', decisionNo: 'SP12/1024/2027', reason: 'Przeniesienie do szkoły w miejscu zamieszkania.' }));
  const row = S.db.get('students', TOM);
  assert.equal(row.status, 'removed');
  assert.equal(row.classId, '7b', 'przydział do oddziału zostaje — inaczej nikt nie wydrukuje arkusza');
  expectOk(await hr.get('/api/grades/student/' + TOM), 'po skreśleniu wychowawca nadal czyta kartę');
  assert.equal(D.teachesPupil(S.db, S.db.get('users', 'u_nowak'), TOM), true);
  const stranger = await S.as('i.kaczmarek');
  assert.equal((await stranger.get('/api/grades/student/' + TOM)).status, 403, 'ale obcy nauczyciel nadal nie');
});

/* REG-17 / GAP-3 — do tej pory gałąź „zakres przy dziecku” odpalała się wyłącznie w testach, bo
   nic w produkcji nie zapisywało `students[].guardians[]`. Teraz robi to sekretariat, więc ten sam
   opiekun ma pełny wgląd przy jednym dziecku i informacyjny przy drugim — przez publiczne API. */
test('[S-10] REG-17: zakres per dziecko zapisany przez sekretariat działa na żywo dla obojga dzieci', async () => {
  const PIOTR = 'st_kowalczyk_piotr';              // brat Anny, oddział 3a
  const MARTA = 'u_p_kowalczyk';
  const reg = await S.as('sekretariat');
  const parent = await S.as('rodzic.kowalczyk');

  expectOk(await reg.patch('/api/registry/students/' + ANNA + '/guardians/' + MARTA, { accessScope: 'full', legalBasis: 'oświadczenie matki' }));
  expectOk(await reg.patch('/api/registry/students/' + PIOTR + '/guardians/' + MARTA, { accessScope: 'info', legalBasis: 'postanowienie sądu III Nsm 88/26' }));

  /* ten sam rodzic, ta sama sesja: pełny wgląd przy Annie, informacyjny przy Piotrze */
  expectOk(await parent.get('/api/grades/student/' + ANNA), 'oceny Anny — zakres pełny');
  const blocked = await parent.get('/api/grades/student/' + PIOTR);
  assert.equal(blocked.status, 403);
  assert.equal(blocked.body.deny, 'guardian_scope');
  assert.equal(blocked.body.scope, 'info');
  expectOk(await parent.get('/api/attendance/student/' + PIOTR), 'frekwencja zostaje w zakresie informacyjnym');

  assert.equal(D.guardianScope(S.db, S.db.get('users', MARTA), ANNA), 'full');
  assert.equal(D.guardianScope(S.db, S.db.get('users', MARTA), PIOTR), 'info');
  assert.equal(S.db.get('users', MARTA).accessScope, undefined, 'konto zostaje przy domyślnym zakresie — ograniczenie dotyczy jednego dziecka');

  /* cofnięcie postanowienia działa tą samą trasą */
  expectOk(await reg.patch('/api/registry/students/' + PIOTR + '/guardians/' + MARTA, { accessScope: 'full', legalBasis: 'uchylenie postanowienia III Nsm 88/26' }));
  expectOk(await parent.get('/api/grades/student/' + PIOTR), 'po uchyleniu wgląd wraca');

  // porządki: inne testy w tym pliku liczą na czysty stan
  for (const sid of [ANNA, PIOTR]) { const s = S.db.get('students', sid); s.guardians = (s.guardians || []).filter((g) => g.userId !== MARTA); }
  S.db.save();
});
