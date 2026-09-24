'use strict';
/* 3.2 — Wychowawca klasy 7b (j.nowak). Jeden test na historyjkę 3.2.1 … 3.2.20. */
const test = require('node:test'); const assert = require('node:assert/strict');
const { startServer, expectOk, fixtures } = require('./helpers');

let S, C, P; // C = wychowawca 7b, P = dyrektor
test.before(async () => { S = await startServer(); C = await S.as('j.nowak'); P = await S.as('dyrektor'); });
test.after(() => S.close());

let n = 0;
/** Wstrzykuje wiersz frekwencji wprost do magazynu (dane 3.1 należą do innej sekcji). */
function att(row) {
  const r = Object.assign({ id: 't_att_' + (++n), lessonId: 't_les_' + n, classId: '7b', minutes: 0, draft: false, byUserId: 'u_nowak', at: '2026-10-01T09:00:00Z', excuseId: null, lessonNo: 1 }, row);
  S.db.col('attendance').push(r); return r;
}
/** Wstrzykuje ocenę (wpisy ocen należą do 3.1). */
function grade(row) {
  const r = Object.assign({ id: 't_g_' + (++n), classId: '7b', semester: 1, weight: 1, countsInAverage: false, deleted: false, teacherId: 'u_nowak', date: '2026-10-16' }, row);
  S.db.col('grades').push(r); return r;
}
const student = (id) => S.db.get('students', id);

const need = fixtures();
const proposedGrades = () => need('proposedGrades', async () => {
  grade({ studentId: 'st_zieliski_kacper', subjectId: 'mat', kind: 'proposedMid', value: '1' });
  grade({ studentId: 'st_nowak_jan', subjectId: 'fiz', kind: 'proposedMid', value: '1' });
  grade({ studentId: 'st_kowalczyk_anna', subjectId: 'mat', kind: 'proposedMid', value: '5' });
});
const closedSemester = () => need('closedSemester', async () => expectOk(await C.post('/api/homeroom/semester/close', { semester: 1, resolutionNo: '3/2026/2027', force: true, reason: 'Uchwała Rady Pedagogicznej nr 3/2026/2027 — klasyfikacja śródroczna zatwierdzona przed terminem.' })));
const removedStudent = () => need('removedStudent', async () => expectOk(await C.post('/api/homeroom/students/st_szymaski_tomasz/remove', { date: '2027-01-26', decisionNo: 'SP12/1024/2027', reason: 'Przeniesienie do szkoły w miejscu zamieszkania.' })));

test('[3.2.1] wychowawca widzi zbiorczą tablicę klasyfikacji: wszystkie przedmioty, oceny proponowane i klasyfikacyjne oraz ostrzeżenia o zagrożeniu', async () => {
  await proposedGrades();
  const b = expectOk(await C.get('/api/homeroom/classification'));
  assert.equal(b.classId, '7b');
  assert.ok(b.subjects.length >= 5, 'wszystkie przedmioty klasy');
  assert.ok(b.students.length >= 13);
  const kacper = b.students.find((s) => s.studentId === 'st_zieliski_kacper');
  assert.equal(kacper.subjects.mat.proposed, '1');
  assert.equal(kacper.subjects.mat.final, null);
  assert.deepEqual(kacper.failing, ['Matematyka']);
  const anna = b.students.find((s) => s.studentId === 'st_kowalczyk_anna');
  assert.equal(anna.subjects.mat.proposed, '5');
  assert.ok(b.warnings.some((w) => w.studentId === 'st_zieliski_kacper' && w.subject === 'Matematyka'));
  assert.ok(b.summary.atRisk >= 1 && b.summary.missingFinals > 0);
  assert.equal(b.summary.locked, false);
  // wychowawca innej klasy nie zajrzy do 7b, nauczyciel bez wychowawstwa nie wejdzie wcale
  const sikora = await S.as('b.sikora');
  assert.equal((await sikora.get('/api/homeroom/classification?classId=7b')).status, 403);
  const wojcik = await S.as('a.wojcik');
  assert.equal((await wojcik.get('/api/homeroom/classification')).status, 403);
});

test('[3.2.2] ocena zachowania śródroczna liczona z punktów, frekwencji i uwag innych nauczycieli, z możliwością zmiany przez wychowawcę', async () => {
  const b = expectOk(await C.get('/api/homeroom/behavior'));
  const jan = b.students.find((s) => s.studentId === 'st_nowak_jan');
  assert.equal(jan.points, 80, 'punkt startowy 100 minus 20 punktów z uwag');
  assert.equal(jan.negative, 3);
  assert.ok(jan.teacherRemarks.some((r) => r.teacher.includes('Wójcik')), 'uwagi nauczycieli uczących');
  assert.ok(b.scale.includes(jan.suggested));
  assert.ok(jan.basis.join(' ').includes('punkty: 80'));
  const bad = await C.post('/api/homeroom/behavior', { studentId: 'st_nowak_jan', value: 'wzorowe' });
  assert.equal(bad.status, 400); assert.equal(bad.body.code, 'reason_required');
  const ok = expectOk(await C.post('/api/homeroom/behavior', { studentId: 'st_nowak_jan', value: 'poprawne', kind: 'proposed', reason: 'Wyraźna poprawa w październiku, uwagi z września nieaktualne.' }));
  assert.equal(ok.grade.value, 'poprawne'); assert.equal(ok.grade.override, true);
  assert.equal(S.db.col('behaviorGrades').find((x) => x.studentId === 'st_nowak_jan' && x.kind === 'proposed').value, 'poprawne');
  const fin = expectOk(await C.post('/api/homeroom/behavior', { studentId: 'st_kowalczyk_anna', kind: 'final', semester: 1 }));
  assert.equal(fin.grade.kind, 'final'); assert.equal(fin.grade.override, false);
  assert.ok(S.db.col('audit').some((a) => a.action === 'behavior_grade_set' || a.action === 'behavior_grade_updated'));
});

test('[3.2.3] lista zagrożonych nieklasyfikowaniem: ponad 50 % nieusprawiedliwionych godzin z przedmiotu', async () => {
  for (let i = 0; i < 8; i++) att({ studentId: 'st_woniak_filip', subjectId: 'muz', date: '2026-09-' + String(7 + i).padStart(2, '0'), status: 'nb' });
  for (let i = 0; i < 2; i++) att({ studentId: 'st_woniak_filip', subjectId: 'muz', date: '2026-10-' + String(7 + i).padStart(2, '0'), status: 'ob' });
  const b = expectOk(await C.get('/api/homeroom/at-risk'));
  assert.equal(b.threshold, 50);
  const filip = b.students.find((s) => s.studentId === 'st_woniak_filip');
  assert.ok(filip, 'uczeń powyżej progu trafia na listę');
  const muz = filip.subjects.find((x) => x.subjectId === 'muz');
  assert.ok(muz.percent > 50, 'ponad 50 % nieusprawiedliwionych: ' + muz.percent);
  assert.match(muz.hours, /^8 z \d+ godzin \(Muzyka\)$/);
  assert.equal(muz.unexcused, 8);
  assert.ok(b.count >= 1);
});

test('[3.2.4] wnioski rodziców o usprawiedliwienie: hurtowe zatwierdzenie zmienia nb na u, odrzucenie wymaga powodu', async () => {
  const pending = expectOk(await C.get('/api/homeroom/excuses?status=pending'));
  assert.ok(pending.excuses.some((e) => e.id === 'h_exc_1' && e.attachment), 'wniosek z załącznikiem od rodzica');
  const rows = ['2026-10-19', '2026-10-20', '2026-10-21'].map((d) => att({ studentId: 'st_kowalczyk_anna', subjectId: 'mat', date: d, status: 'nb' }));
  const ok = expectOk(await C.post('/api/homeroom/excuses/decide', { ids: ['h_exc_1', 'h_exc_2'], decision: 'approve' }));
  assert.equal(ok.count, 2);
  assert.ok(ok.changedAttendance >= 3);
  for (const r of rows) { assert.equal(S.db.get('attendance', r.id).status, 'u'); assert.equal(S.db.get('attendance', r.id).excuseId, 'h_exc_1'); }
  assert.equal(S.db.get('excuses', 'h_exc_1').status, 'approved');
  const noReason = await C.post('/api/homeroom/excuses/h_exc_3/decision', { decision: 'reject' });
  assert.equal(noReason.status, 400); assert.equal(noReason.body.code, 'reason_required');
  const rej = expectOk(await C.post('/api/homeroom/excuses/h_exc_3/decision', { decision: 'reject', reason: 'Brak wskazania przyczyny nieobecności.' }));
  assert.equal(rej.excuses[0].status, 'rejected');
  assert.equal(S.db.get('excuses', 'h_exc_3').rejectReason, 'Brak wskazania przyczyny nieobecności.');
  assert.ok(S.db.col('messages').some((m) => m.toUserIds.includes('u_p_lewandowski') && m.body.includes('Brak wskazania przyczyny')), 'powód trafia do rodzica');
  assert.ok(S.db.col('audit').some((a) => a.action === 'excuse_approved') && S.db.col('audit').some((a) => a.action === 'excuse_rejected'));
});

test('[3.2.5] kontrola odmiany imion, nazwisk i miejsc urodzenia w miejscowniku przed wydrukiem świadectw', async () => {
  const b = expectOk(await C.get('/api/homeroom/declension'));
  assert.ok(b.flagged >= 1);
  const all = expectOk(await C.get('/api/homeroom/declension?all=1'));
  const anna = all.students.find((s) => s.studentId === 'st_kowalczyk_anna');
  assert.equal(anna.suggested.firstNameLocative, 'Annie');
  assert.equal(anna.suggested.birthPlaceLocative, 'Krakowie');
  const piotr = all.students.find((s) => s.studentId === 'st_lewandowski_piotr');
  assert.equal(piotr.suggested.firstNameLocative, 'Piotrze');
  assert.equal(piotr.suggested.lastNameLocative, 'Lewandowskim');
  const oskar = all.students.find((s) => s.studentId === 'st_h_mazurek_oskar');
  assert.equal(oskar.suggested.birthPlaceLocative, 'Zakopanem');
  assert.equal(oskar.status.birthPlaceLocative, 'missing');
  const saved = expectOk(await C.patch('/api/homeroom/declension/st_h_mazurek_oskar', { accept: true }));
  assert.equal(saved.student.ok, true);
  assert.equal(student('st_h_mazurek_oskar').declension.firstNameLocative, 'Oskarze');
  assert.equal(student('st_h_mazurek_oskar').birthPlaceLocative, 'w Zakopanem');
  assert.ok(S.db.col('audit').some((a) => a.action === 'declension_confirmed'));
});

/** Ustala oceny śródroczne dla całej klasy — świadectwo powstaje z ocen klasyfikacyjnych,
    nigdy z propozycji. `skip` zostaje bez ocen (uczeń dopisany w trakcie roku). */
function setMidtermGrades(values, skip, perSubject) {
  const subjects = [...new Set(S.db.col('timetable').filter((t) => t.classId === '7b').map((t) => t.subjectId))];
  for (const st of S.db.col('students').filter((x) => x.classId === '7b' && x.status !== 'removed')) {
    if ((skip || []).includes(st.id)) continue;
    for (const subjectId of subjects) {
      if (S.db.col('grades').some((g) => g.studentId === st.id && g.subjectId === subjectId && g.kind === 'midterm' && g.semester === 1 && !g.deleted)) continue;
      const own = (perSubject || {})[st.id] || {};
      grade({ studentId: st.id, subjectId, kind: 'midterm', value: own[subjectId] || values[st.id] || '4' });
    }
  }
  return subjects;
}

test('[3.2.6] generowanie świadectw dla całej klasy z ocenami rocznymi, adnotacją o uchwale rady i klauzulą o wyróżnieniu', async () => {
  setMidtermGrades({ st_kowalczyk_anna: '5', st_nowak_jan: '2' }, ['st_h_mazurek_oskar'], { st_nowak_jan: { fiz: '1' } });
  const b = expectOk(await C.post('/api/homeroom/report-cards', { semester: 1, resolutionNo: '3/2026/2027', resolutionDate: '2027-01-26' }));
  assert.ok(b.count >= 13);
  assert.match(b.resolution, /Uchwała Rady Pedagogicznej nr 3\/2026\/2027 z dnia 26\.01\.2027/);
  assert.ok(b.honours >= 1, 'co najmniej jedno świadectwo z wyróżnieniem');
  assert.equal(S.db.col('documents').filter((d) => d.kind === 'reportCard' && d.classId === '7b').length, b.count);
  const anna = b.documents.find((d) => d.studentId === 'st_kowalczyk_anna');
  assert.equal(anna.honours, true);
  // uczeń bez ustalonych ocen klasyfikacyjnych nie dostaje ani średniej, ani wyróżnienia
  const oskar = S.db.col('documents').find((d) => d.kind === 'reportCard' && d.studentId === 'st_h_mazurek_oskar');
  assert.equal(oskar.honours, false);
  assert.equal(oskar.data.average, null, 'średniej nie liczy się z propozycji');
  assert.ok(oskar.data.missingFinals.length > 0);
  assert.match(oskar.data.promotion, /Klasyfikacja niekompletna/);
  // ocena niedostateczna: świadectwo nie może stwierdzać promocji
  const jan = S.db.col('documents').find((d) => d.kind === 'reportCard' && d.studentId === 'st_nowak_jan');
  assert.ok(jan.data.failing.length > 0);
  assert.match(jan.data.promotion, /nie otrzymuje promocji|egzaminu poprawkowego/);
  assert.equal(jan.honours, false);
  const html = await C.get('/api/homeroom/report-cards/print');
  assert.equal(html.status, 200);
  assert.match(html.headers.get('content-type'), /text\/html/);
  assert.ok(html.body.includes('Anna Kowalczyk'), 'wydruk zawiera nazwiska uczniów');
  assert.ok(html.body.includes('Uchwała Rady Pedagogicznej'));
  assert.ok(html.body.includes('z wyróżnieniem'));
  assert.ok(html.body.includes('Dokument roboczy'), 'brak ocen klasyfikacyjnych jest oznaczony na wydruku');
  assert.ok(S.db.col('audit').some((a) => a.action === 'report_card_generated'));
});

test('[3.2.6] świadectwo klas 1–3 jest opisowe — bez tabeli stopni i bez średniej', async () => {
  const k = await S.as('i.kaczmarek');
  const leon = S.db.get('classes', '1a').studentIds[0];
  expectOk(await k.post('/api/descriptive-grades', { studentId: leon, semester: 1, area: 'Edukacja społeczna', text: 'Chętnie współpracuje w grupie i pomaga młodszym kolegom.' }));
  const r = await k.get('/api/homeroom/report-cards/print?classId=1a&semester=1&studentId=' + leon);
  assert.equal(r.status, 200);
  assert.ok(r.body.includes('Osiągnięcia ucznia'), 'tabela opisowa zamiast stopni');
  assert.ok(r.body.includes('Chętnie współpracuje w grupie'));
  assert.ok(!r.body.includes('Średnia ocen'), 'w klasach 1–3 nie ma średniej ocen');
  assert.ok(!/<th scope="row">Matematyka<\/th>/.test(r.body), 'bez tabeli ocen z przedmiotów');
});

test('[3.2.7] oceny z poprzedniej szkoły wpisane do historii świadectw ucznia przeniesionego w trakcie cyklu', async () => {
  const before = expectOk(await C.get('/api/homeroom/history/st_h_mazurek_oskar'));
  assert.equal(before.transferredFrom, 'Szkoła Podstawowa nr 3 w Zakopanem');
  assert.equal(before.history.length, 1);
  const bad = await C.post('/api/homeroom/history', { studentId: 'st_h_mazurek_oskar', schoolYear: '2024/2025', className: '5a', grades: [{ subjectId: 'mat', value: '9' }] });
  assert.equal(bad.status, 400); assert.equal(bad.body.code, 'bad_grade');
  const ok = expectOk(await C.post('/api/homeroom/history', { studentId: 'st_h_mazurek_oskar', schoolYear: '2024/2025', className: '5a', schoolName: 'Szkoła Podstawowa nr 3 w Zakopanem', behavior: 'dobre', grades: [{ subjectId: 'mat', value: '4' }, { subjectId: 'pol', value: '3+' }] }));
  assert.equal(ok.history.length, 2);
  assert.equal(ok.entry.grades[1].value, '3+');
  assert.equal(S.db.col('reportCardHistory').filter((h) => h.studentId === 'st_h_mazurek_oskar').length, 2);
  const html = await C.get('/api/homeroom/report-cards/print?studentId=st_h_mazurek_oskar');
  assert.ok(html.body.includes('Szkoła Podstawowa nr 3 w Zakopanem'), 'historia świadectw na wydruku');
});

test('[3.2.8] wydruk próbny świadectwa na czystą kartkę A4 z marginesami 18 mm blankietu MEN', async () => {
  const r = await C.get('/api/homeroom/print/test-certificate?studentId=st_kowalczyk_anna');
  assert.equal(r.status, 200);
  assert.ok(r.body.includes('MEN-I/1a-w/2'));
  assert.ok(r.body.includes('pod światło'), 'instrukcja przyłożenia do blankietu');
  assert.ok(r.body.includes('WYDRUK PRÓBNY'));
  /* Sprawdzenie pasowania to GEOMETRIA, nie opis. Marginesy @page muszą się zgadzać z opisem blankietu,
     a arkusz musi mieć cztery znaczniki pasowania w rogach — inaczej nie ma czego przyłożyć do blankietu. */
  const page = /@page\{size:A4;margin:(\d+)mm\}/.exec(r.body);
  assert.ok(page, 'dokument deklaruje format i marginesy strony: ' + (r.body.match(/@page[^}]*\}/) || [''])[0]);
  const stated = /Marginesy strony: <b>(\d+) mm<\/b>/.exec(r.body);
  assert.ok(stated, 'opis blankietu podaje margines');
  assert.equal(page[1], stated[1], 'margines @page (' + page[1] + ' mm) musi być tym samym, co margines blankietu z opisu (' + stated[1] + ' mm)');
  for (const corner of ['m1', 'm2', 'm3', 'm4']) assert.ok(r.body.includes('class="mark ' + corner + '"'), 'brak znacznika pasowania ' + corner);
  assert.match(r.body, /\.mark\{position:fixed;width:(\d+)mm;height:\1mm;border:[\d.]+mm solid/, 'znaczniki pasowania mają stałą pozycję i wymiar w mm');
  assert.match(r.body, /\.m1\{top:0;left:0/); assert.match(r.body, /\.m4\{bottom:0;right:0/);
  assert.ok(/Linie podpisów: 25 mm od dolnej krawędzi/.test(r.body), 'opis podaje odległość linii podpisów');
  assert.ok(r.body.includes('Tabela ocen: szerokość 174 mm'), 'szerokość pola zadruku podana w mm');
  assert.equal(+page[1] * 2 + 174, 210, 'szerokość tabeli + dwa marginesy musi dać szerokość arkusza A4 (210 mm)');
  assert.ok(S.db.col('audit').some((a) => a.action === 'certificate_test_print'));
});

test('[3.2.9] seryjny wydruk świadectw z wyróżnieniem dla uczniów ze średnią co najmniej 4,75 i zachowaniem bardzo dobrym lub wzorowym', async () => {
  const list = expectOk(await C.get('/api/homeroom/honours'));
  assert.equal(list.honorsAverage, 4.75);
  assert.deepEqual(list.honorsBehavior, ['wzorowe', 'bardzo dobre']);
  const anna = list.students.find((s) => s.studentId === 'st_kowalczyk_anna');
  assert.equal(anna.honours, true); assert.ok(anna.average >= 4.75);
  const jan = list.students.find((s) => s.studentId === 'st_nowak_jan');
  assert.equal(jan.honours, false);
  const r = await C.get('/api/homeroom/print/honours');
  assert.equal(r.status, 200);
  assert.ok(r.body.includes('Świadectwa z wyróżnieniem'));
  assert.ok(r.body.includes('Anna Kowalczyk'));
  assert.ok(!r.body.includes('Jan Nowak'), 'uczeń bez wyróżnienia nie trafia na seryjny wydruk');
  assert.ok(S.db.col('audit').some((a) => a.action === 'honours_certificates_printed'));
});

test('[3.2.10] osiągnięcia szczególne z parametrem wpisu na świadectwie sprawdzanym wobec listy dopuszczonej przepisami', async () => {
  const kinds = expectOk(await C.get('/api/homeroom/achievements'));
  assert.ok(kinds.kinds.some((k) => k.id === 'konkurs_wojewodzki' && k.onCertificate === true));
  const badKind = await C.post('/api/homeroom/achievements', { studentId: 'st_kowalczyk_anna', kind: 'nagroda_wewnetrzna', title: 'Nagroda' });
  assert.equal(badKind.status, 400); assert.equal(badKind.body.code, 'bad_kind');
  const notAllowed = await C.post('/api/homeroom/achievements', { studentId: 'st_szymaski_tomasz', kind: 'inne', title: 'Pomoc przy gazetce', onCertificate: true });
  assert.equal(notAllowed.status, 400); assert.equal(notAllowed.body.code, 'not_certifiable');
  const ok = expectOk(await C.post('/api/homeroom/achievements', { studentId: 'st_zieliski_kacper', kind: 'zawody_sportowe', title: 'II miejsce w powiatowych zawodach w pływaniu', level: 'powiatowy', onCertificate: true }));
  assert.equal(ok.achievement.onCertificate, true);
  assert.ok(student('st_zieliski_kacper').achievements.some((a) => a.title.includes('pływaniu')));
  const after = expectOk(await C.get('/api/homeroom/achievements'));
  assert.ok(after.onCertificate >= 3);
  assert.ok(S.db.col('audit').some((a) => a.action === 'achievement_added'));
});

/* Zamknięcie semestru zamraża oceny, frekwencję i uwagi całego oddziału, a odblokowuje je wyłącznie
   dyrekcja — jedno kliknięcie w połowie półrocza unieruchamiało dziennik klasy na miesiące, bez
   żadnego pytania. Przed terminem klasyfikacji potrzebna jest świadoma decyzja i podstawa. */
test('[3.2.11] zamknięcie semestru przed terminem klasyfikacji wymaga potwierdzenia i podstawy', async () => {
  const T = await startServer();
  try {
    const hr = await T.as('j.nowak');
    const meeting = T.db.data.config.semesters[0].classificationMeeting;
    assert.ok(T.TODAY < meeting, 'demo stoi przed posiedzeniem rady: ' + T.TODAY + ' < ' + meeting);

    const early = await hr.post('/api/homeroom/semester/close', { semester: 1, resolutionNo: '3/2026/2027' });
    assert.equal(early.status, 409);
    assert.equal(early.body.code, 'too_early');
    assert.equal(early.body.classificationMeeting, meeting);
    assert.equal(T.db.col('semesterLocks').length, 0, 'odmowa niczego nie zamyka');

    const noReason = await hr.post('/api/homeroom/semester/close', { semester: 1, force: true });
    assert.equal(noReason.status, 400); assert.equal(noReason.body.code, 'reason_required');

    const forced = expectOk(await hr.post('/api/homeroom/semester/close', {
      semester: 1, force: true, resolutionNo: '3/2026/2027',
      reason: 'Uchwała Rady Pedagogicznej nr 3/2026/2027 — klasyfikacja przeniesiona na wcześniejszy termin.'
    }));
    assert.equal(forced.lock.early, true);
    assert.equal(forced.lock.closedOn, T.TODAY);
    assert.match(forced.lock.reason, /Uchwała/);
    const row = T.db.col('audit').find((a) => a.action === 'semester_closed');
    assert.equal(row.after.early, true);
    assert.match(row.reason, /Uchwała/);

    /* po terminie klasyfikacji potwierdzenie nie jest już potrzebne */
    const T2 = await startServer();
    try {
      T2.db.data.config.today = meeting; T2.db.save();
      const hr2 = await T2.as('j.nowak');
      const onTime = expectOk(await hr2.post('/api/homeroom/semester/close', { semester: 1, resolutionNo: '3/2026/2027' }));
      assert.equal(onTime.lock.early, false);
    } finally { await T2.close(); }
  } finally { await T.close(); }
});

test('[3.2.11] zamknięcie semestru blokuje wpisy wsteczne, a odblokowanie należy wyłącznie do dyrektora', async () => {
  const closed = await closedSemester();
  assert.equal(closed.lock.semester, 1); assert.equal(closed.lock.classId, '7b'); assert.equal(closed.lock.reopened, false);
  assert.ok(S.db.col('semesterLocks').some((l) => l.id === closed.lock.id));
  const D = require('../server/lib/domain');
  assert.equal(D.isSemesterLocked(S.db, 1, '7b'), true);
  const again = await C.post('/api/homeroom/semester/close', { semester: 1 });
  assert.equal(again.status, 409); assert.equal(again.body.code, 'already_locked');
  const blocked = await C.post('/api/homeroom/behavior', { studentId: 'st_kowalczyk_anna', kind: 'proposed', semester: 1 });
  assert.equal(blocked.status, 409); assert.equal(blocked.body.code, 'semester_locked');
  assert.equal((await C.post('/api/homeroom/semester/reopen', { classId: '7b', semester: 1, reason: 'x' })).status, 403, 'wychowawca nie odblokuje semestru');
  const noReason = await P.post('/api/homeroom/semester/reopen', { classId: '7b', semester: 1 });
  assert.equal(noReason.status, 400); assert.equal(noReason.body.code, 'reason_required');
  const reopened = expectOk(await P.post('/api/homeroom/semester/reopen', { classId: '7b', semester: 1, reason: 'Zgoda dyrekcji na poprawienie oceny po egzaminie klasyfikacyjnym.' }));
  assert.equal(reopened.locked, false);
  assert.equal(S.db.get('semesterLocks', closed.lock.id).reopened, true);
  assert.ok(S.db.col('audit').some((a) => a.action === 'semester_reopened'));
  expectOk(await C.post('/api/homeroom/semester/close', { semester: 1, force: true, reason: 'Klasyfikacja zatwierdzona po egzaminie klasyfikacyjnym.' }));
  assert.equal(D.isSemesterLocked(S.db, 1, '7b'), true);
});

test('[3.2.12] miesięczny raport frekwencji (usprawiedliwione, nieusprawiedliwione, spóźnienia, zwolnienia) w JSON i CSV', async () => {
  att({ studentId: 'st_kaczmarek_oliwia', subjectId: 'mat', date: '2026-10-05', status: 'u' });
  att({ studentId: 'st_kaczmarek_oliwia', subjectId: 'mat', date: '2026-10-06', status: 'nb' });
  att({ studentId: 'st_kaczmarek_oliwia', subjectId: 'mat', date: '2026-10-07', status: 'sp', minutes: 12 });
  att({ studentId: 'st_kaczmarek_oliwia', subjectId: 'mat', date: '2026-10-08', status: 'zw' });
  const b = expectOk(await C.get('/api/homeroom/attendance/monthly?month=2026-10'));
  assert.equal(b.month, '2026-10');
  const oliwia = b.rows.find((r) => r.studentId === 'st_kaczmarek_oliwia');
  assert.ok(oliwia.unexcused >= 1 && oliwia.late >= 1 && oliwia.earlyLeave >= 1 && oliwia.excused >= 2);
  assert.equal(oliwia.lateMinutes >= 12, true);
  assert.ok(b.totals.hours > 0);
  const csv = await C.get('/api/homeroom/attendance/monthly?month=2026-10&format=csv');
  assert.equal(csv.status, 200);
  assert.match(csv.headers.get('content-disposition'), /frekwencja-7b-2026-10\.csv/);
  const raw = Buffer.from(await (await fetch(S.base + '/api/homeroom/attendance/monthly?month=2026-10&format=csv', { headers: { Cookie: C.cookie } })).arrayBuffer());
  assert.equal(raw.slice(0, 3).toString('hex'), 'efbbbf', 'CSV w UTF-8 z BOM');
  const lines = csv.body.replace(/^\ufeff/, '').split('\r\n');
  assert.equal(lines[0], 'Nr;Uczeń;Usprawiedliwione;Nieusprawiedliwione;Spóźnienia;Zwolnienia (zw);Godziny razem;Frekwencja %');
  assert.ok(lines.some((l) => l.includes('Kaczmarek Oliwia')));
  assert.ok(S.db.col('audit').some((a) => a.action === 'attendance_report_exported'));
});

test('[3.2.13] komunikat wyłącznie do członków Rady Rodziców klasy z załączonym porządkiem zebrania', async () => {
  const council = expectOk(await C.get('/api/homeroom/council'));
  assert.equal(council.count, 3);
  assert.ok(council.members.some((m) => m.userId === 'u_p_kowalczyk' && m.children.length));
  const b = expectOk(await C.post('/api/homeroom/broadcast', {
    subject: 'Porządek zebrania z rodzicami 04.02.2027', body: 'W załączeniu porządek obrad.',
    attachments: [{ name: 'porzadek-zebrania-7b.pdf', size: 131072, type: 'application/pdf' }]
  }));
  assert.equal(b.recipients, 3); assert.equal(b.audience, 'council');
  const msg = S.db.get('messages', b.message.id);
  assert.equal(msg.kind, 'broadcast');
  assert.deepEqual(msg.toUserIds.slice().sort(), ['u_p_kowalczyk', 'u_p_lewandowski', 'u_p_nowak']);
  assert.ok(!msg.toUserIds.includes('u_p_wisniewska'), 'rodzic spoza rady nie dostaje komunikatu');
  assert.equal(msg.attachments[0].name, 'porzadek-zebrania-7b.pdf');
  assert.equal(S.db.col('notifications').filter((x) => x.userId === 'u_p_nowak' && x.kind === 'message').length >= 1, true);
  assert.ok(S.db.col('audit').some((a) => a.action === 'council_broadcast_sent'));
});

test('[3.2.14] potwierdzenia odczytu pism o zagrożeniu oceną niedostateczną na 30 dni przed klasyfikacją', async () => {
  await proposedGrades();
  const sent = expectOk(await C.post('/api/homeroom/warnings', { semester: 1 }));
  assert.ok(sent.sent >= 1);
  assert.equal(sent.classificationMeeting, '2027-01-26');
  assert.equal(sent.deadline, '2026-12-27', '30 dni przed posiedzeniem klasyfikacyjnym');
  assert.equal(sent.onTime, true);
  const forJan = sent.messages.find((m) => m.studentId === 'st_nowak_jan');
  assert.ok(forJan, 'pismo o zagrożeniu dla ucznia z oceną niedostateczną');
  assert.deepEqual(forJan.failing, ['Fizyka']);
  // pismo ostrzega także o nieklasyfikowaniu i o tym, że egzamin wymaga zgody rady
  assert.deepEqual(forJan.absence, ['Fizyka']);
  assert.equal(forJan.consentRequired, true);
  assert.match(S.db.get('messages', forJan.messageId).body, /art\. 44k ust\. 1/);
  assert.match(S.db.get('messages', forJan.messageId).body, /zgody rady pedagogicznej/);
  // rodzic ucznia z usprawiedliwioną absencją ponad połowę godzin też dostaje pismo
  const forPiotr = sent.messages.find((m) => m.studentId === 'st_lewandowski_piotr');
  assert.ok(forPiotr, 'nieklasyfikowanie z powodu usprawiedliwionych nieobecności też wymaga ostrzeżenia');
  assert.deepEqual(forPiotr.failing, []);
  assert.equal(forPiotr.consentRequired, false);
  assert.match(S.db.get('messages', forPiotr.messageId).subject, /nieklasyfikowaniem/);
  const msg = S.db.get('messages', forJan.messageId);
  assert.equal(msg.kind, 'warning'); assert.equal(msg.requiresAck, true);
  assert.deepEqual(Object.keys(msg.readBy), []);
  let list = expectOk(await C.get('/api/homeroom/warnings'));
  assert.equal(list.daysBefore, 30);
  assert.equal(list.read, 0); assert.ok(list.unread >= 1);
  assert.equal(list.warnings.find((w) => w.messageId === msg.id).recipients[0].receipt, 'delivered');
  msg.readBy['u_p_nowak'] = '2026-10-24T19:14:00Z'; S.db.save();
  list = expectOk(await C.get('/api/homeroom/warnings'));
  const row = list.warnings.find((w) => w.messageId === msg.id);
  assert.equal(row.recipients.find((p) => p.userId === 'u_p_nowak').receipt, 'read');
  assert.equal(row.read, 1);
  assert.equal(list.read, 1);
  assert.ok(S.db.col('audit').some((a) => a.action === 'failing_warning_sent'));
});

test('[3.2.15] numery w dzienniku nadawane alfabetycznie, z zachowaniem numerów przy dopisaniu ucznia w trakcie roku', async () => {
  const before = expectOk(await C.get('/api/homeroom/roll-call'));
  const oskar = before.students.find((s) => s.studentId === 'st_h_mazurek_oskar');
  assert.equal(oskar.rollNo, null); assert.equal(oskar.needsNumber, true);
  assert.equal(before.missing, 1);
  assert.equal(before.students[0].alphabeticalNo, 1);
  const annaBefore = student('st_kowalczyk_anna').rollNo;
  const b = expectOk(await C.post('/api/homeroom/roll-call', { mode: 'assign' }));
  assert.equal(b.changed, 1);
  assert.equal(b.changes[0].studentId, 'st_h_mazurek_oskar');
  assert.equal(b.changes[0].to, before.nextFree);
  assert.equal(student('st_h_mazurek_oskar').rollNo, before.nextFree);
  assert.equal(student('st_kowalczyk_anna').rollNo, annaBefore, 'pozostali zachowują swoje numery');
  assert.ok(S.db.col('audit').some((a) => a.action === 'roll_number_assigned' && a.entityId === 'st_h_mazurek_oskar' && a.after.rollNo === before.nextFree));
  const noReason = await C.post('/api/homeroom/roll-call', { mode: 'renumber' });
  assert.equal(noReason.status, 400); assert.equal(noReason.body.code, 'reason_required');
  const re = expectOk(await C.post('/api/homeroom/roll-call', { mode: 'renumber', reason: 'Uporządkowanie numeracji po dopisaniu ucznia.' }));
  assert.ok(re.changed >= 1);
  assert.equal(student('st_adamczyk_maja').rollNo, 1, 'po przenumerowaniu pierwsza alfabetycznie ma numer 1');
});

test('[3.2.16] wypisanie ucznia decyzją administracyjną: status removed, osiągnięcia zarchiwizowane, nic nie znika z bazy', async () => {
  const noDecision = await C.post('/api/homeroom/students/st_szymaski_tomasz/remove', { date: '2027-01-26' });
  assert.equal(noDecision.status, 400); assert.equal(noDecision.body.code, 'decision_required');
  const gradesBefore = S.db.col('grades').filter((g) => g.studentId === 'st_szymaski_tomasz').length;
  const b = await removedStudent();
  assert.equal(b.student.status, 'removed');
  assert.equal(b.student.removal.decisionNo, 'SP12/1024/2027');
  assert.equal(b.student.removal.date, '2027-01-26');
  const s = student('st_szymaski_tomasz');
  assert.ok(s, 'uczeń pozostaje w bazie');
  assert.equal(s.achievements.every((a) => a.archived === true), true);
  /* OPS-03 — sam `status: 'removed'` zostawiał ucznia na listach obecności, w grupach i z czynnym
     loginem. Wypisanie zamyka wpis tak samo jak przeniesienie w księdze uczniów. */
  assert.equal(s.leftAt, '2027-01-26');
  assert.ok(!S.db.get('classes', '7b').studentIds.includes('st_szymaski_tomasz'), 'zszedł z listy oddziału');
  assert.deepEqual(S.db.col('groups').filter((g) => (g.studentIds || []).includes('st_szymaski_tomasz')), [], 'i ze wszystkich grup');
  assert.deepEqual(b.access.groups, ['g_7b_ang2']);
  const su = S.db.one('users', (u) => u.role === 'student' && u.studentId === 'st_szymaski_tomasz');
  assert.equal(su.blocked, true); assert.match(su.blockedReason, /decyzja SP12\/1024\/2027/);
  assert.equal(S.db.col('sessions').some((x) => x.userId === su.id && !x.revoked), false, 'sesje ucznia unieważnione');
  assert.deepEqual(s.parentIds, [], 'opiekunowie odpięci');
  assert.equal(S.db.col('registrationCodes').some((rc) => rc.studentId === s.id && !rc.usedAt && !rc.voidedAt), false, 'niewykorzystane kody unieważnione');
  assert.equal(S.db.col('studentIds').some((x) => x.studentId === s.id && x.status === 'issued'), false, 'legitymacja unieważniona');
  // po wypisaniu nie stoi już na liście obecności przyszłej lekcji
  const future = expectOk(await C.get('/api/attendance/lesson/les_tt_7b_1_1_2026-10-26'));
  assert.ok(!future.students.some((x) => x.studentId === 'st_szymaski_tomasz'), 'wypisany uczeń znika z list obecności');
  assert.equal(S.db.col('grades').filter((g) => g.studentId === 'st_szymaski_tomasz').length, gradesBefore, 'oceny nie są usuwane');
  assert.ok(!(expectOk(await C.get('/api/homeroom/classification'))).students.some((x) => x.studentId === 'st_szymaski_tomasz'));
  assert.equal((await C.post('/api/homeroom/students/st_szymaski_tomasz/remove', { date: '2027-01-26', decisionNo: 'X' })).status, 409);
  assert.ok(S.db.col('audit').some((a) => a.action === 'student_removed' && a.entityId === 'st_szymaski_tomasz'));
});

test('[3.2.17] wydruk strony dziennika z kontaktami do rodziców na wypadek sytuacji alarmowej z klauzulą RODO', async () => {
  await removedStudent();
  const r = await C.get('/api/homeroom/print/emergency');
  assert.equal(r.status, 200);
  assert.match(r.headers.get('content-type'), /text\/html/);
  assert.ok(r.body.includes('Kowalczyk Anna'));
  assert.ok(r.body.includes(S.db.get('users', 'u_p_nowak').phone), 'telefon opiekuna');
  assert.ok(r.body.includes('Klauzula poufności (RODO)'));
  assert.ok(r.body.includes('ewakuacji'));
  assert.ok(!r.body.includes('Szymański Tomasz'), 'uczeń wypisany nie trafia na listę alarmową');
  assert.ok(S.db.col('audit').some((a) => a.action === 'emergency_page_printed'));
});

test('[3.2.18] przypisanie uczniów swojej klasy do grup międzyoddziałowych utworzonych w innych oddziałach', async () => {
  const before = expectOk(await C.get('/api/homeroom/groups'));
  const cross = before.groups.find((g) => g.id === 'g_cross_inf');
  assert.equal(cross.kind, 'cross-class');
  const notMine = await C.post('/api/homeroom/groups/g_cross_inf/members', { studentIds: ['st_duda_lena'], action: 'add' });
  assert.equal(notMine.status, 403); assert.equal(notMine.body.code, 'not_my_student');
  const notCross = await C.post('/api/homeroom/groups/g_7b_ang1/members', { studentIds: ['st_kaczmarek_oliwia'], action: 'add' });
  assert.equal(notCross.status, 400); assert.equal(notCross.body.code, 'not_cross_class');
  const b = expectOk(await C.post('/api/homeroom/groups/g_cross_inf/members', { studentIds: ['st_kaczmarek_oliwia'], action: 'add' }));
  assert.ok(b.group.studentIds.includes('st_kaczmarek_oliwia'));
  assert.ok(S.db.get('groups', 'g_cross_inf').studentIds.includes('st_kaczmarek_oliwia'));
  const removed = expectOk(await C.post('/api/homeroom/groups/g_cross_inf/members', { studentIds: ['st_kaczmarek_oliwia'], action: 'remove' }));
  assert.ok(!removed.group.studentIds.includes('st_kaczmarek_oliwia'));
  assert.ok(S.db.col('audit').some((a) => a.action === 'group_members_added' && a.entityId === 'g_cross_inf'));
});

test('[3.2.19] kontrola liczby godzin zapisanych w dzienniku wobec planu zajęć — lista rozbieżności', async () => {
  const b = expectOk(await C.get('/api/homeroom/hours-check'));
  assert.ok(b.checkedDays > 20);
  assert.equal(b.ok, false);
  const day = b.discrepancies.find((d) => d.date === '2026-09-11');
  assert.ok(day, 'dzień z nadmiarową godziną trafia na listę rozbieżności');
  assert.equal(day.planned, 5); assert.equal(day.recorded, 6); assert.equal(day.status, 'extra');
  assert.match(day.text, /zapisano 6 godz\., plan przewiduje 5/);
  assert.ok(b.days.some((d) => d.status === 'ok'), 'pozostałe dni zgodne z planem');
  assert.ok(b.plannedHours > 0 && b.recordedHours >= b.plannedHours);
  const narrow = expectOk(await C.get('/api/homeroom/hours-check?from=2026-09-14&to=2026-09-18'));
  assert.equal(narrow.ok, true);
});

test('[3.2.20] przekazanie zamkniętego dziennika klasy do formalnego zatwierdzenia przez dyrektora', async () => {
  await closedSemester();
  const b = expectOk(await C.post('/api/homeroom/logbook/submit', { note: 'Dziennik klasy 7b po zakończeniu zajęć.' }));
  assert.equal(b.status, 'submitted');
  assert.deepEqual(b.closedSemesters, [1]);
  assert.equal(S.db.get('classes', '7b').logbookStatus, 'submitted');
  assert.equal((await C.post('/api/homeroom/logbook/submit', {})).status, 409);
  assert.equal((await C.post('/api/homeroom/logbook/approve', { classId: '7b' })).status, 403, 'zatwierdza wyłącznie dyrektor');
  const ok = expectOk(await P.post('/api/homeroom/logbook/approve', { classId: '7b', note: 'Dziennik zatwierdzony.' }));
  assert.equal(ok.status, 'approved');
  assert.equal(S.db.get('classes', '7b').logbookStatus, 'approved');
  assert.ok(S.db.col('notifications').some((x) => x.userId === 'u_nowak' && x.kind === 'logbook'));
  assert.ok(S.db.col('audit').some((a) => a.action === 'logbook_submitted') && S.db.col('audit').some((a) => a.action === 'logbook_approved'));
  const st = expectOk(await C.get('/api/homeroom/logbook'));
  assert.equal(st.status, 'approved');
  assert.match(st.approvedBy, /Wiśniewski/);
});

/* --- przegląd pedagogiczny (docs/review/pedagogy.md) ------------------------------------- */

const D = require('../server/lib/domain');
/** Testy poniżej biegną po [3.2.11], które zostawia semestr zamknięty — stan ustawiamy jawnie. */
async function ensureOpen() {
  if (!D.isSemesterLocked(S.db, 1, '7b')) return;
  expectOk(await P.post('/api/homeroom/semester/reopen', { classId: '7b', semester: 1, reason: 'Korekta dokumentacji przed radą.' }));
}
async function ensureClosed() {
  if (D.isSemesterLocked(S.db, 1, '7b')) return;
  expectOk(await C.post('/api/homeroom/semester/close', { semester: 1, force: true, reason: 'Klasyfikacja śródroczna zatwierdzona.' }));
}

test('[3.2.3] nieklasyfikowanie: liczy się nieobecność na ponad połowie godzin, także usprawiedliwiona, oraz brak ocen', async () => {
  const b = expectOk(await C.get('/api/homeroom/at-risk?semester=1'));
  // Jan Nowak — ponad połowa godzin fizyki nieusprawiedliwiona: egzamin za zgodą rady
  const jan = b.students.find((s) => s.studentId === 'st_nowak_jan');
  assert.ok(jan, 'uczeń z nieusprawiedliwionymi godzinami fizyki na liście');
  const fiz = jan.subjects.find((x) => x.subjectId === 'fiz');
  assert.ok(fiz.percent > 50, 'ponad 50 % nieusprawiedliwionych: ' + fiz.percent);
  assert.equal(fiz.consentRequired, true);
  assert.equal(jan.consentRequired, true);
  // Piotr Lewandowski — ponad połowa godzin polskiego opuszczona, ale usprawiedliwiona
  const piotr = b.students.find((s) => s.studentId === 'st_lewandowski_piotr');
  assert.ok(piotr, 'usprawiedliwiona nieobecność też jest podstawą nieklasyfikowania (art. 44k ust. 1)');
  const pol = piotr.subjects.find((x) => x.subjectId === 'pol');
  assert.ok(pol.absentPercent > 50, 'ponad połowa godzin: ' + pol.absentPercent);
  assert.equal(pol.percent, 0, 'żadna z tych godzin nie jest nieusprawiedliwiona');
  assert.equal(pol.consentRequired, false, 'egzamin klasyfikacyjny przysługuje z mocy przepisów');
  assert.equal(pol.reason, 'absence');
  // uczeń dopisany w trakcie roku: brak ocen cząstkowych = brak podstaw do ustalenia oceny
  const oskar = b.students.find((s) => s.studentId === 'st_h_mazurek_oskar');
  assert.ok(oskar, 'uczeń bez żadnej oceny z przedmiotu trafia na listę');
  assert.equal(oskar.joinedAt, '2026-10-05');
  assert.equal(oskar.joinedMidYear, true);
  assert.ok(oskar.withoutGrades.length >= 1);
  assert.ok(oskar.subjects.every((x) => x.reason === 'noGrades'));
  assert.match(oskar.subjects[0].hours, /brak ocen cząstkowych/);
  // proporcja z trzech zapisanych godzin nie jest jeszcze „połową czasu przeznaczonego na zajęcia”
  assert.equal(b.minHours, 10);
  assert.equal(b.gradesDue, false, 'termin propozycji (12.12.2026) jeszcze nie minął');
  assert.ok(b.students.length < 6, 'lista jest krótka i czytelna, nie zawiera całej klasy');
  assert.match(b.note, /art\. 44k/);
  assert.ok(b.withoutGrades >= 1 && b.consentRequired >= 1);
});

test('[3.2.2] wycofana uwaga nie obniża już oceny zachowania, a punkty liczą się w granicach semestru', async () => {
  await ensureOpen();
  const sikora = await S.as('b.sikora');
  const before = expectOk(await C.get('/api/homeroom/behavior?semester=1')).students.find((s) => s.studentId === 'st_kowalczyk_anna');
  const rem = S.db.get('remarks', 'g_rem_1');
  assert.equal(rem.teacherId, 'u_sikora');
  expectOk(await sikora.delete('/api/remarks/' + rem.id, { reason: 'Pochwała wpisana omyłkowo w wierszu innej uczennicy.' }));
  const after = expectOk(await C.get('/api/homeroom/behavior?semester=1')).students.find((s) => s.studentId === 'st_kowalczyk_anna');
  assert.equal(after.points, before.points - rem.points, 'punkty z wycofanej uwagi znikają z propozycji');
  assert.equal(after.positive, before.positive - 1);
  assert.equal(expectOk(await C.get('/api/remarks/points/st_kowalczyk_anna')).total, after.points, 'ekran nauczyciela i wychowawcy pokazują tę samą liczbę');
  assert.ok(after.teacherRemarks.every((x) => x.id !== rem.id));

  // uwaga z semestru 2 nie obciąża oceny śródrocznej
  const sem2 = expectOk(await C.post('/api/remarks', { studentId: 'st_kowalczyk_anna', kind: 'negative', text: 'Spóźnienie na pierwszą lekcję po feriach.', points: 15, date: '2027-03-02' }));
  assert.equal(sem2.remark.semester, 2);
  const still = expectOk(await C.get('/api/homeroom/behavior?semester=1')).students.find((s) => s.studentId === 'st_kowalczyk_anna');
  assert.equal(still.points, after.points, 'ocena śródroczna liczy się z uwag semestru 1');
  assert.equal(expectOk(await C.get('/api/remarks/points/st_kowalczyk_anna?semester=2')).total, 100 - 15, 'w semestrze 2 punkty startują od nowa');
});

test('[3.2.4] odrzucenie wcześniej przyjętego wniosku przywraca nieobecności nieusprawiedliwione', async () => {
  await ensureOpen();
  const rows = ['2026-11-16', '2026-11-17'].map((d) => att({ studentId: 'st_szymaska_karolina', subjectId: 'pol', date: d, status: 'nb' }));
  const other = att({ studentId: 'st_dbrowska_emilia', subjectId: 'pol', date: '2026-11-16', status: 'nb' });
  S.db.col('excuses').push({ id: 't_exc_karolina', studentId: 'st_szymaska_karolina', from: '2026-11-16', to: '2026-11-17', lessonNos: [], reason: 'Choroba.', attachment: null, byUserId: 'u_p_kowalczyk', at: '2026-11-18T07:00:00Z', planned: false, status: 'pending', rejectReason: null, decidedBy: null, decidedAt: null });

  expectOk(await C.post('/api/homeroom/excuses/decide', { ids: ['t_exc_karolina'], decision: 'approve' }));
  for (const r of rows) assert.equal(S.db.get('attendance', r.id).status, 'u');
  assert.equal(S.db.get('attendance', other.id).status, 'nb', 'wniosek działa tylko na wskazanego ucznia');

  const back = expectOk(await C.post('/api/homeroom/excuses/t_exc_karolina/decision', { decision: 'reject', reason: 'Zwolnienie dotyczyło innego terminu — rodzic przesłał korektę.' }));
  assert.equal(back.changedAttendance, 2);
  for (const r of rows) {
    const a = S.db.get('attendance', r.id);
    assert.equal(a.status, 'nb', 'cofnięcie zgody przywraca nieobecność nieusprawiedliwioną');
    assert.equal(a.excuseId, null);
  }
  assert.ok(S.db.col('audit').some((a) => a.action === 'attendance_unexcused' && a.entityId === rows[0].id));
});

test('[3.2.11] po zamknięciu semestru nie zmienia się już frekwencji ani uwag, które są podstawą klasyfikacji', async () => {
  await ensureClosed();
  assert.equal(D.isSemesterLocked(S.db, 1, '7b'), true);
  const les = S.db.col('lessons').find((l) => l.classId === '7b' && l.subjectId === 'mat' && l.date === '2026-09-25');
  const att1 = await C.post('/api/attendance/lesson/' + les.id, { entries: [{ studentId: 'st_dbrowska_emilia', status: 'ob' }] });
  assert.equal(att1.status, 403); assert.equal(att1.body.code, 'semester_locked');
  const rem = await C.post('/api/remarks', { studentId: 'st_kowalczyk_anna', kind: 'negative', text: 'Wpis po radzie klasyfikacyjnej.', points: 20, date: '2026-10-20' });
  assert.equal(rem.status, 403); assert.equal(rem.body.code, 'semester_locked');

  expectOk(await P.post('/api/homeroom/semester/reopen', { classId: '7b', semester: 1, reason: 'Korekta frekwencji po odwołaniu rodzica.' }));
  expectOk(await C.post('/api/attendance/lesson/' + les.id, { entries: [{ studentId: 'st_dbrowska_emilia', status: 'ob' }] }));
  expectOk(await C.post('/api/homeroom/semester/close', { semester: 1, force: true, reason: 'Klasyfikacja zatwierdzona ponownie.' }));
});

test('[3.2.12] zwolnienie nie jest nieobecnością i nie zaniża frekwencji', async () => {
  const S1 = 'st_winiewska_zofia';
  for (const d of ['2026-12-01', '2026-12-02', '2026-12-03', '2026-12-04']) att({ studentId: S1, subjectId: 'wf', date: d, status: 'ob' });
  const before = expectOk(await C.get('/api/homeroom/attendance/monthly?month=2026-12')).rows.find((r) => r.studentId === S1);
  assert.equal(before.percent, 100);
  for (const d of ['2026-12-07', '2026-12-08']) att({ studentId: S1, subjectId: 'wf', date: d, status: 'zw' });
  const after = expectOk(await C.get('/api/homeroom/attendance/monthly?month=2026-12')).rows.find((r) => r.studentId === S1);
  assert.equal(after.percent, 100, 'zwolnienie z zajęć nie obniża frekwencji');
  assert.equal(after.hours, 6); assert.equal(after.countedHours, 4, 'podstawą procentu są godziny bez zwolnień');
  assert.equal(after.earlyLeave, 2);
  att({ studentId: S1, subjectId: 'wf', date: '2026-12-09', status: 'nb' });
  const withNb = expectOk(await C.get('/api/homeroom/attendance/monthly?month=2026-12')).rows.find((r) => r.studentId === S1);
  assert.equal(withNb.percent, 80, 'nieobecność obniża: 4 z 5 godzin');
});

/* --- przegląd operacyjny i niezawodnościowy (docs/review/operations.md, reliability.md) --- */

test('[OPS-13] lista obecności lekcji liczy się z daty przyjęcia, nie z bieżącego składu oddziału', async () => {
  await ensureOpen();
  const reg = await S.as('sekretariat');
  const made = expectOk(await reg.post('/api/registry/students', {
    firstName: 'Nina', lastName: 'Zawadzka', birthPlace: 'Kraków', classId: '7b',
    identityKind: 'passport', passport: 'UA9912345', passportCountry: 'UA', birthDate: '2013-03-11',
    mother: 'Ołena Zawadzka', phone: '600 000 111', address: 'ul. Długa 1, Kraków'
  }), 'wpis do księgi');
  const NINA = made.student.id;
  assert.equal(made.student.enrolledAt, S.TODAY, 'data przyjęcia zapisana w księdze');
  assert.ok(S.db.get('classes', '7b').studentIds.includes(NINA));

  const wrzesien = expectOk(await C.get('/api/attendance/lesson/les_tt_7b_1_1_2026-09-07'));
  assert.ok(!wrzesien.students.some((x) => x.studentId === NINA),
    'uczennica przyjęta 23.10 nie może stać na liście lekcji z 7 września');
  const teraz = expectOk(await C.get('/api/attendance/lesson/les_tt_7b_1_1_2026-10-26'));
  assert.ok(teraz.students.some((x) => x.studentId === NINA), 'od dnia przyjęcia jest na liście');

  // wpisu frekwencji za dzień sprzed przyjęcia nie da się nawet wymusić
  const wymuszony = await C.post('/api/attendance/lesson/les_tt_7b_1_1_2026-09-07', { entries: [{ studentId: NINA, status: 'nb' }] });
  assert.equal(wymuszony.status, 400); assert.equal(wymuszony.body.code, 'not_in_roster');

  // lustrzanie: po dacie odejścia uczeń znika z list przyszłych lekcji
  const odchodzi = S.db.get('students', NINA);
  odchodzi.departureDate = '2026-10-25';
  assert.ok(!expectOk(await C.get('/api/attendance/lesson/les_tt_7b_1_1_2026-10-26')).students.some((x) => x.studentId === NINA),
    'po dacie odejścia nie ma go na liście');
  assert.ok(expectOk(await C.get('/api/attendance/lesson/les_tt_7b_5_1_2026-10-23')).students.some((x) => x.studentId === NINA),
    'ale lekcje z czasu nauki zostają nietknięte');
  delete odchodzi.departureDate;
});

test('[REL-10] odtworzony zapis offline nie nadpisuje nowszej korekty nauczyciela', async () => {
  await ensureOpen();
  const les = 'les_tt_7b_1_1_2026-10-26';
  const SID = 'st_kowalczyk_anna';
  const rowOf = () => S.db.one('attendance', (a) => a.lessonId === les && a.studentId === SID);

  // 1. nauczyciel poprawia wpis w przeglądarce (bez `at` — stempel serwera)
  expectOk(await C.post('/api/attendance/lesson/' + les, { entries: [{ studentId: SID, status: 'ob' }] }));
  const correction = rowOf();
  assert.equal(correction.status, 'ob'); assert.equal(correction.atClient, false);

  // 2. telefon wraca do sieci i odtwarza zapis sprzed korekty (stempel klienta starszy niż wiersz)
  const stale = new Date(Date.parse(correction.at) - 2 * 3600 * 1000).toISOString();
  const fresh = new Date(Date.parse(correction.at) + 2 * 3600 * 1000).toISOString();
  const replay = expectOk(await C.post('/api/attendance/lesson/' + les, { at: stale, entries: [{ studentId: SID, status: 'nb' }] }));
  assert.equal(replay.saved, 0); assert.equal(replay.skipped, 1);
  assert.equal(replay.skippedEntries[0].studentId, SID);
  assert.equal(replay.skippedEntries[0].reason, 'stale_write');
  assert.equal(replay.skippedEntries[0].keptStatus, 'ob');
  assert.equal(rowOf().status, 'ob', 'korekta z przeglądarki zostaje');

  // 3. zapis z nowszym `at` wygrywa — last-write-wins działa dalej
  const later = expectOk(await C.post('/api/attendance/lesson/' + les, { at: fresh, entries: [{ studentId: SID, status: 'sp', minutes: 5 }] }));
  assert.equal(later.saved, 1); assert.equal(later.skipped, 0);
  assert.equal(rowOf().status, 'sp'); assert.equal(rowOf().atClient, true);

  // 4. ten sam zapis odtworzony dwa razy jest bezpieczny (jeden wiersz `att_<lekcja>_<uczeń>`)
  const again = expectOk(await C.post('/api/attendance/lesson/' + les, { at: fresh, entries: [{ studentId: SID, status: 'sp', minutes: 5 }] }));
  assert.equal(again.skipped, 0);
  assert.equal(S.db.col('attendance').filter((a) => a.lessonId === les && a.studentId === SID).length, 1);
});

/* GAP-6 — jedna data przyjęcia. „Dopisany w trakcie roku” czytało wyłącznie `joinedAt`, więc uczeń
   wpisany przez sekretariat (`enrolledAt`) nigdy nie był tak oznaczony. Teraz kanoniczne jest
   `enrolledAt`, a `joinedAt` zostaje aliasem — obie drogi dają ten sam wynik. */
test('[3.2.15] GAP-6: „dopisany w trakcie roku” liczy się z kanonicznej daty przyjęcia (enrolledAt), nie z jednej z dwóch nazw', async () => {
  const PIOTR = 'st_lewandowski_piotr';                    // 7b, na liście zagrożonych
  const s = student(PIOTR);
  const was = { enrolledAt: s.enrolledAt, joinedAt: s.joinedAt };
  try {
    // 1. bez żadnej daty: uczeń z września nie jest dopisany w trakcie roku
    delete s.enrolledAt; delete s.joinedAt; S.db.save();
    const plain = expectOk(await C.get('/api/homeroom/at-risk')).students.find((x) => x.studentId === PIOTR);
    assert.ok(plain, 'uczeń jest na liście zagrożonych niezależnie od daty przyjęcia');
    assert.equal(plain.joinedMidYear, false);
    assert.equal(plain.joinedAt, null);

    // 2. `enrolledAt` po początku semestru — to jest data z księgi uczniów, którą pisze sekretariat
    s.enrolledAt = '2026-10-05'; S.db.save();
    const viaEnrolled = expectOk(await C.get('/api/homeroom/at-risk')).students.find((x) => x.studentId === PIOTR);
    assert.equal(viaEnrolled.joinedAt, '2026-10-05', 'widok wychowawcy czyta datę z księgi, a nie tylko własny wpis');
    assert.equal(viaEnrolled.joinedMidYear, true);
    const roll = expectOk(await C.get('/api/homeroom/roll-call')).students.find((x) => x.studentId === PIOTR);
    assert.equal(roll.joinedAt, '2026-10-05', 'numery w dzienniku pokazują tę samą datę');
    assert.equal(expectOk(await C.get('/api/homeroom/history/' + PIOTR)).joinedAt, '2026-10-05');

    // 3. `joinedAt` (wpis wychowawcy) nadal działa jako alias — tak wpisano Oskara w zasiewie
    delete s.enrolledAt; s.joinedAt = '2026-10-05'; S.db.save();
    const viaJoined = expectOk(await C.get('/api/homeroom/at-risk')).students.find((x) => x.studentId === PIOTR);
    assert.equal(viaJoined.joinedMidYear, true, 'obie nazwy dają ten sam wynik');
    assert.equal(viaJoined.joinedAt, '2026-10-05');

    // 4. data sprzed początku semestru to zwykły uczeń rocznika, nie „dopisany w trakcie”
    delete s.joinedAt; s.enrolledAt = S.db.data.config.semesters[0].from; S.db.save();
    const first = expectOk(await C.get('/api/homeroom/at-risk')).students.find((x) => x.studentId === PIOTR);
    assert.equal(first.joinedMidYear, false, 'wrześniowy import nie może zrobić z całego rocznika uczniów dopisanych w trakcie roku');
  } finally {
    delete s.enrolledAt; delete s.joinedAt;
    if (was.enrolledAt) s.enrolledAt = was.enrolledAt;
    if (was.joinedAt) s.joinedAt = was.joinedAt;
    S.db.save();
  }
});
