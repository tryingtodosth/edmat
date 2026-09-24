'use strict';
/* Moduł „Kursy” (LMS): budowa i publikacja kursu, zapisy klasy i zapisy własne, widoczność dla ucznia,
   bramkowanie jednostek datą, postęp i ukończenie, quiz sprawdzany automatycznie z limitem podejść,
   przeniesienie wyniku quizu do ocen, uprawnienia w dyskusji, tylko-do-odczytu dla rodzica,
   zaświadczenie o ukończeniu i wyłączenie modułu. */
const test = require('node:test'); const assert = require('node:assert/strict');
const { startServer, expectOk, fixtures } = require('./helpers');

let S; test.before(async () => { S = await startServer(); }); test.after(() => S.close());

const ANNA = 'st_kowalczyk_anna';
const state = {};
const audits = (action) => S.db.col('audit').filter((a) => a.action === action);

/* Kurs, na którym stoi cała reszta pliku, budujemy leniwie i tylko raz (tests/helpers.js): w pełnym
   przebiegu robi to [courses.1], a przy `--test-name-pattern` — pierwszy test, który go potrzebuje.
   Każde asercje zostają w swoim teście; fikstura zwraca wyłącznie odpowiedzi serwera. */
const need = fixtures();
const builtCourse = () => need('course', async () => {
  const c = await S.as('j.nowak');
  const created = expectOk(await c.post('/api/courses', {
    title: 'Równania z jedną niewiadomą', description: 'Kurs sprawdzający dla 7b.',
    subjectId: 'mat', classIds: ['7b'], visibility: 'class', coverColor: 'cat-3', language: 'pl'
  }));
  state.course = created.course.id;
  const early = await c.post('/api/courses/' + state.course + '/publish', {});      // publikacja bez jednostek
  const u1 = expectOk(await c.post('/api/courses/' + state.course + '/units', { title: 'Podstawy', summary: 'Zasady przekształcania równań.', availableFrom: '2026-10-01' }));
  const u2 = expectOk(await c.post('/api/courses/' + state.course + '/units', { title: 'Zadania na później', availableFrom: '2026-11-15' }));
  state.u1 = u1.unit.id; state.u2 = u2.unit.id;
  const textA = expectOk(await c.post('/api/courses/' + state.course + '/items', {
    unitId: state.u1, kind: 'text', title: 'Jak rozwiązać równanie',
    body: 'Równanie rozwiązujemy **krok po kroku**.\n\n- przenieś niewiadome na jedną stronę;\n- uprość obie strony;\n- podziel przez współczynnik.'
  }));
  state.textA = textA.item.id;
  const quiz = expectOk(await c.post('/api/courses/' + state.course + '/items', {
    unitId: state.u1, kind: 'quiz', title: 'Quiz: równania',
    quiz: {
      attempts: 2, timeLimitMin: 10,
      questions: [
        { id: 'q1', text: 'x + 3 = 7, ile wynosi x?', points: 2, correctId: 'b', options: [{ id: 'a', text: '10' }, { id: 'b', text: '4' }, { id: 'c', text: '3' }] },
        { id: 'q2', text: '2x = 10, ile wynosi x?', points: 3, correctId: 'a', options: [{ id: 'a', text: '5' }, { id: 'b', text: '20' }, { id: 'c', text: '8' }] }
      ]
    }
  }));
  state.quiz = quiz.item.id;
  const textB = expectOk(await c.post('/api/courses/' + state.course + '/items', { unitId: state.u2, kind: 'text', title: 'Zadania dodatkowe', body: 'Do zrobienia po otwarciu jednostki.' }));
  state.textB = textB.item.id;
  const badQuiz = await c.post('/api/courses/' + state.course + '/items', { unitId: state.u1, kind: 'quiz', title: 'Zły quiz', quiz: { questions: [{ id: 'q1', text: 'A?', correctId: 'z', options: [{ id: 'a', text: '1' }, { id: 'b', text: '2' }] }] } });
  const enrol = expectOk(await c.post('/api/courses/' + state.course + '/enrol', { classId: '7b' }));
  const anna = await S.as('anna.kowalczyk');
  const draft = await anna.get('/api/courses/' + state.course);                      // wersja robocza u ucznia
  const draftList = expectOk(await anna.get('/api/courses'));
  const pub = expectOk(await c.post('/api/courses/' + state.course + '/publish', {}));
  return { c, created, early, u1, u2, textA, quiz, textB, badQuiz, enrol, draft, draftList, pub };
});
/* Postęp Anny: oznaczenie elementu tekstowego (courses.3) i dwa podejścia do quizu (courses.4). */
const textADone = () => need('textADone', async () => {
  const st = await builtCourse(); void st;
  const anna = await S.as('anna.kowalczyk');
  const before = expectOk(await anna.get('/api/courses/' + state.course));
  const done = expectOk(await anna.post('/api/courses/' + state.course + '/items/' + state.textA + '/done', {}));
  const again = expectOk(await anna.post('/api/courses/' + state.course + '/items/' + state.textA + '/done', {}));
  return { anna, before, done, again };
});
const quizAttempts = () => need('quizAttempts', async () => {
  await textADone();                                     // procent ukończenia w a1 zakłada zrobiony tekst
  const anna = await S.as('anna.kowalczyk');
  const view = expectOk(await anna.get('/api/courses/' + state.course));
  const item = view.units.find((u) => u.id === state.u1).items.find((i) => i.id === state.quiz);
  const a1 = expectOk(await anna.post('/api/courses/' + state.course + '/items/' + state.quiz + '/quiz', { answers: { q1: 'b', q2: 'c' } }));
  const a2 = expectOk(await anna.post('/api/courses/' + state.course + '/items/' + state.quiz + '/quiz', { answers: { q1: 'b', q2: 'a' } }));
  const a3 = await anna.post('/api/courses/' + state.course + '/items/' + state.quiz + '/quiz', { answers: { q1: 'b', q2: 'a' } });
  return { anna, view, item, a1, a2, a3 };
});

test('[courses.1] nauczyciel buduje kurs, zapisuje oddział i publikuje go', async () => {
  const { c, created, early, u1, u2, quiz, badQuiz, enrol, draft, draftList, pub } = await builtCourse();

  const ctxList = expectOk(await c.get('/api/courses'));
  assert.ok(ctxList.context.subjects.some((s) => s.id === 'mat'), 'kontekst nauczyciela zawiera przedmiot');
  assert.ok(ctxList.courses.some((x) => x.id === 'co_ulamki'), 'kurs z zasiewu jest na liście');

  assert.equal(created.course.status, 'draft');
  assert.equal(created.course.coverColor, 'cat-3');
  assert.ok(audits('course_create').some((a) => a.entityId === state.course), 'utworzenie kursu w audycie');

  // publikacja bez jednostek jest odrzucana
  assert.equal(early.status, 400); assert.equal(early.body.code, 'no_units');

  assert.equal(u1.unit.locked, false); assert.equal(u2.unit.locked, true, 'jednostka z przyszłą datą jest zamknięta');
  assert.equal(quiz.item.maxScore, 5);

  // quiz bez wskazanej poprawnej odpowiedzi jest odrzucany
  assert.equal(badQuiz.status, 400); assert.equal(badQuiz.body.code, 'bad_quiz');

  assert.ok(enrol.added >= 12, 'zapisano całą klasę 7b');
  assert.ok(S.db.col('courseEnrollments').some((e) => e.courseId === state.course && e.studentId === ANNA && e.source === 'class'));
  assert.ok(audits('course_enrol').some((a) => a.entityId === state.course), 'zapis oddziału w audycie');

  // kurs w wersji roboczej jest niewidoczny dla zapisanego ucznia
  assert.equal(draft.status, 404); assert.equal(draft.body.code, 'course_not_published');
  assert.ok(!draftList.courses.some((x) => x.id === state.course), 'kurs roboczy nie trafia na listę ucznia');

  assert.equal(pub.course.status, 'published');
  assert.ok(audits('course_publish').some((a) => a.entityId === state.course && a.before.status === 'draft'));
});

test('[courses.2] widoczność: obcy uczeń bez dostępu, jednostka zamknięta do dnia otwarcia', async () => {
  await builtCourse();
  const anna = await S.as('anna.kowalczyk');
  const view = expectOk(await anna.get('/api/courses/' + state.course));
  assert.equal(view.role, 'student');
  assert.equal(view.units.length, 2);
  const open = view.units.find((u) => u.id === state.u1), locked = view.units.find((u) => u.id === state.u2);
  assert.equal(open.locked, false); assert.equal(open.items.length, 2);
  assert.equal(locked.locked, true);
  assert.deepEqual(locked.items, [], 'elementy zamkniętej jednostki nie wracają do ucznia');
  assert.match(locked.lockedNote, /15\.11\.2026/);

  // uczeń innego oddziału nie jest zapisany
  const julia = await S.as('julia.baran');
  const denied = await julia.get('/api/courses/' + state.course);
  assert.equal(denied.status, 403); assert.equal(denied.body.code, 'not_enrolled');

  // element z zamkniętej jednostki jest zablokowany również przy zapisie postępu
  const early = await anna.post('/api/courses/' + state.course + '/items/' + state.textB + '/done', {});
  assert.equal(early.status, 403); assert.equal(early.body.code, 'unit_locked');
});

test('[courses.3] postęp ucznia i procent ukończenia', async () => {
  const { before, done } = await textADone();
  assert.deepEqual(before.progress, { done: 0, total: 3, percent: 0, complete: false });

  assert.equal(done.progress.done, 1);
  assert.equal(done.progress.total, 3);
  assert.equal(done.progress.percent, 33.3);
  assert.equal(done.progress.complete, false);
  assert.equal(done.certificatePath, null, 'bez ukończenia nie ma zaświadczenia');
  assert.ok(audits('course_item_progress').some((a) => a.after.itemId === state.textA && a.after.studentId === ANNA), 'postęp w audycie');

  // ponowne oznaczenie nie dubluje wiersza (drugie żądanie wysłała fikstura)
  assert.equal(S.db.col('courseProgress').filter((p) => p.itemId === state.textA && p.studentId === ANNA).length, 1);
});

test('[courses.4] quiz sprawdzany automatycznie, z limitem podejść', async () => {
  const { item, a1, a2, a3 } = await quizAttempts();
  assert.equal(item.attemptsLeft, 2);
  assert.ok(item.quiz.questions.every((q) => q.correctId === undefined), 'uczeń nie dostaje poprawnych odpowiedzi przed oddaniem');

  assert.equal(a1.autoGraded, true);
  assert.equal(a1.score, 2); assert.equal(a1.maxScore, 5); assert.equal(a1.percent, 40);
  assert.equal(a1.results.find((r) => r.questionId === 'q1').correct, true);
  assert.equal(a1.results.find((r) => r.questionId === 'q2').correct, false);
  assert.equal(a1.results.find((r) => r.questionId === 'q2').correctId, 'a', 'poprawna odpowiedź wraca dopiero po oddaniu');
  assert.equal(a1.attemptsLeft, 1);
  assert.equal(a1.progress.percent, 66.7);

  assert.equal(a2.score, 5); assert.equal(a2.bestScore, 5); assert.equal(a2.attemptsLeft, 0);
  assert.equal(a2.suggestedGrade, 6);

  assert.equal(a3.status, 409); assert.equal(a3.body.code, 'attempts_exhausted');
  assert.equal(S.db.col('quizAttempts').filter((x) => x.itemId === state.quiz && x.studentId === ANNA).length, 2, 'trzecie podejście nie zostawia wiersza');
  assert.ok(S.db.col('quizAttempts').filter((x) => x.itemId === state.quiz).every((x) => x.autoGraded === true));
});

test('[courses.5] wynik quizu wpisany jako ocena w dzienniku, z audytem', async () => {
  await quizAttempts();                        // najlepszy wynik Anny z [courses.4]
  const c = await S.as('j.nowak');
  const gb = expectOk(await c.get('/api/courses/' + state.course + '/gradebook'));
  const row = gb.students.find((s) => s.studentId === ANNA);
  assert.equal(row.quiz[state.quiz].score, 5);
  assert.equal(row.quiz[state.quiz].gradeId, null);

  const r = expectOk(await c.post('/api/courses/' + state.course + '/items/' + state.quiz + '/grade', { studentId: ANNA }));
  const grade = S.db.get('grades', r.grade.id);
  assert.equal(grade.studentId, ANNA);
  assert.equal(grade.subjectId, 'mat');
  assert.equal(grade.categoryName, 'quiz');
  assert.equal(grade.points, 5); assert.equal(grade.maxPoints, 5); assert.equal(grade.percent, 100);
  assert.equal(grade.value, '6');
  assert.ok(S.db.col('gradeCategories').some((x) => x.name === 'quiz'), 'kategoria „quiz” została utworzona');
  assert.ok(audits('grade_create').some((a) => a.entityId === grade.id), 'wpis oceny w audycie');
  assert.ok(audits('course_quiz_grade').some((a) => a.after.gradeId === grade.id && a.after.studentId === ANNA), 'przeniesienie wyniku quizu w audycie');

  const after = expectOk(await c.get('/api/courses/' + state.course + '/gradebook'));
  assert.equal(after.students.find((s) => s.studentId === ANNA).quiz[state.quiz].gradeValue, '6');

  const nobody = await c.post('/api/courses/' + state.course + '/items/' + state.quiz + '/grade', { studentId: 'st_woniak_filip' });
  assert.equal(nobody.status, 409); assert.equal(nobody.body.code, 'no_attempt');
});

test('[courses.6] dyskusja kursu: wątek zamknięty przez nauczyciela blokuje odpowiedzi', async () => {
  await builtCourse();
  const anna = await S.as('anna.kowalczyk');
  const th = expectOk(await anna.post('/api/courses/' + state.course + '/threads', { title: 'Pytanie do zadania 3', body: 'Czy można pomnożyć obie strony przez 2?' }));
  state.thread = th.thread.id;
  assert.equal(th.thread.locked, false);
  assert.equal(th.thread.posts.length, 1);
  assert.ok(audits('course_thread_create').some((a) => a.entityId === state.thread));

  const c = await S.as('j.nowak');
  expectOk(await c.post('/api/courses/' + state.course + '/threads/' + state.thread + '/posts', { body: 'Tak, obie strony wolno pomnożyć przez tę samą liczbę różną od zera.' }));

  // uczeń nie moderuje
  const cantLock = await anna.patch('/api/courses/' + state.course + '/threads/' + state.thread, { locked: true });
  assert.equal(cantLock.status, 403);

  const locked = expectOk(await c.patch('/api/courses/' + state.course + '/threads/' + state.thread, { locked: true, pinned: true }));
  assert.equal(locked.thread.locked, true); assert.equal(locked.thread.pinned, true);
  assert.ok(audits('course_thread_moderate').some((a) => a.entityId === state.thread && a.after.locked === true));

  const blocked = await anna.post('/api/courses/' + state.course + '/threads/' + state.thread + '/posts', { body: 'Jeszcze jedno pytanie' });
  assert.equal(blocked.status, 403); assert.equal(blocked.body.code, 'thread_locked');

  // nauczyciel nadal może dopisać podsumowanie
  expectOk(await c.post('/api/courses/' + state.course + '/threads/' + state.thread + '/posts', { body: 'Wątek zamykam — resztę omówimy na lekcji.' }));

  // obcy uczeń nie wchodzi do dyskusji
  const julia = await S.as('julia.baran');
  const outsider = await julia.get('/api/courses/' + state.course + '/discussion');
  assert.equal(outsider.status, 403);
});

test('[courses.7] rodzic widzi postęp dziecka tylko do odczytu', async () => {
  await quizAttempts();                        // postęp dziecka: tekst + quiz
  const p = await S.as('rodzic.kowalczyk');
  const d = expectOk(await p.get('/api/courses/child/progress'));
  assert.equal(d.readOnly, true);
  assert.equal(d.studentId, ANNA);
  const course = d.courses.find((x) => x.id === state.course);
  assert.ok(course, 'kurs dziecka jest widoczny dla rodzica');
  assert.equal(course.progress.done, 2);
  assert.equal(course.quiz.find((q) => q.itemId === state.quiz).score, 5);

  const view = expectOk(await p.get('/api/courses/' + state.course + '?studentId=' + ANNA));
  assert.equal(view.role, 'parent'); assert.equal(view.readOnly, true);

  // żaden zapis nie jest dla rodzica dostępny
  assert.equal((await p.post('/api/courses/' + state.course + '/items/' + state.textA + '/done', {})).status, 403);
  assert.equal((await p.post('/api/courses/' + state.course + '/items/' + state.quiz + '/quiz', { answers: {} })).status, 403);
  assert.equal((await p.post('/api/courses/' + state.course + '/threads', { title: 'x' })).status, 403);
  assert.equal((await p.post('/api/courses/' + state.course + '/enrol/self', {})).status, 403);

  // cudze dziecko poza zasięgiem
  const other = await p.get('/api/courses/' + state.course + '?studentId=st_nowak_jan');
  assert.equal(other.status, 403);

  /* OPS-17/S-10: opiekun z dostępem informacyjnym nie czyta postępów ani wyników quizów */
  const st = S.db.get('students', ANNA);
  const guardians = st.guardians;
  st.guardians = [{ userId: p.user.id, accessScope: 'info' }];
  S.db.save();
  try {
    const info = await p.get('/api/courses/child/progress');
    assert.equal(info.status, 403);
    assert.equal(info.body.deny, 'guardian_scope');
    assert.equal((await p.get('/api/courses/' + state.course + '?studentId=' + ANNA)).status, 403);
  } finally { st.guardians = guardians; S.db.save(); }
});

test('[courses.8] kurs otwarty, zapis własny i zaświadczenie o ukończeniu', async () => {
  await builtCourse();                         // drugi kurs Anny, którego nie ukończyła
  const w = await S.as('a.wojcik');
  const created = expectOk(await w.post('/api/courses', { title: 'Mini-kurs: pliki i foldery', subjectId: 'inf', visibility: 'open', language: 'pl', coverColor: 'cat-6' }));
  const id = created.course.id;
  const unit = expectOk(await w.post('/api/courses/' + id + '/units', { title: 'Jedna lekcja', availableFrom: '2026-10-01' }));
  const item = expectOk(await w.post('/api/courses/' + id + '/items', { unitId: unit.unit.id, kind: 'text', title: 'Ścieżki do plików', body: 'Ścieżka **bezwzględna** zaczyna się od katalogu głównego.' }));
  expectOk(await w.post('/api/courses/' + id + '/publish', {}));

  const jan = await S.as('jan.nowak');
  const list = expectOk(await jan.get('/api/courses'));
  assert.ok(list.available.some((x) => x.id === id), 'kurs otwarty jest na liście dostępnych');
  expectOk(await jan.post('/api/courses/' + id + '/enrol/self', {}));
  assert.ok(S.db.col('courseEnrollments').some((e) => e.courseId === id && e.studentId === 'st_nowak_jan' && e.source === 'self'));
  assert.ok(audits('course_enrol_self').some((a) => a.entityId === id));

  const tooEarly = await jan.get('/api/courses/' + id + '/certificate');
  assert.equal(tooEarly.status, 409); assert.equal(tooEarly.body.code, 'not_complete');

  const done = expectOk(await jan.post('/api/courses/' + id + '/items/' + item.item.id + '/done', {}));
  assert.equal(done.progress.complete, true);
  assert.equal(done.progress.percent, 100);
  assert.equal(done.certificatePath, '/api/courses/' + id + '/certificate?studentId=st_nowak_jan');

  const cert = await jan.get('/api/courses/' + id + '/certificate');
  assert.equal(cert.status, 200);
  assert.match(cert.headers.get('content-type'), /text\/html/);
  assert.match(cert.body, /^<!doctype html>/i);
  assert.match(cert.body, /Zaświadczenie o ukończeniu kursu/);
  assert.match(cert.body, /Mini-kurs: pliki i foldery/);
  assert.match(cert.body, /Nowak/);
  assert.ok(audits('course_certificate').some((a) => a.entityId === id && a.after.studentId === 'st_nowak_jan'));

  // uczeń bez ukończenia nadal nie dostaje zaświadczenia z innego kursu
  const anna = await S.as('anna.kowalczyk');
  const annaCert = await anna.get('/api/courses/' + state.course + '/certificate');
  assert.equal(annaCert.status, 409);
});

test('[courses.9] wyłączenie modułu ukrywa wszystkie trasy kursów', async () => {
  await builtCourse();
  const admin = await S.as('admin');
  expectOk(await admin.patch('/api/admin/modules', { enabled: { courses: false } }));

  const c = await S.as('j.nowak');
  const off = await c.get('/api/courses');
  assert.equal(off.status, 404); assert.equal(off.body.code, 'module_disabled'); assert.equal(off.body.module, 'courses');
  const offOne = await c.get('/api/courses/' + state.course);
  assert.equal(offOne.status, 404); assert.equal(offOne.body.code, 'module_disabled');
  const anna = await S.as('anna.kowalczyk');
  assert.equal((await anna.post('/api/courses/' + state.course + '/items/' + state.textA + '/done', {})).body.code, 'module_disabled');

  expectOk(await admin.patch('/api/admin/modules', { enabled: { courses: true } }));
  assert.equal((await c.get('/api/courses')).status, 200);
});

test('[courses.10] element kursu „spotkanie” zakłada spotkanie wideo dla zapisanych uczniów, a usunięcie go odwołuje', async () => {
  await builtCourse();
  const c = await S.as('j.nowak');

  // termin zamiast identyfikatora: spotkanie zakłada moduł „meetings”
  const created = expectOk(await c.post('/api/courses/' + state.course + '/items', {
    unitId: state.u1, kind: 'meeting', title: 'Konsultacje online przed sprawdzianem',
    body: 'Spotykamy się w pokoju szkoły.', start: '2026-11-03T16:00', end: '2026-11-03T16:45'
  }));
  state.meetItem = created.item.id;
  const meetingId = created.item.meetingId;
  assert.ok(meetingId, 'element niesie identyfikator spotkania');
  assert.equal(created.item.meeting.joinPath, '#/spotkania?meeting=' + meetingId);
  assert.equal(created.item.meeting.startTime, '16:00');
  assert.equal(created.item.meeting.endTime, '16:45');

  const m = S.db.get('videoMeetings', meetingId);
  assert.equal(m.kind, 'course');
  assert.equal(m.courseId, state.course);
  assert.equal(m.courseItemId, state.meetItem, 'spotkanie wie, z którego elementu pochodzi');
  assert.equal(m.hostId, 'u_nowak', 'gospodarzem jest nauczyciel prowadzący kurs');
  assert.equal(m.status, 'scheduled');
  assert.equal(m.start, '2026-11-03T16:00:00.000Z');
  const enrolled = S.db.col('courseEnrollments').filter((e) => e.courseId === state.course).map((e) => e.studentId);
  const expectedAudience = S.db.col('users').filter((u) => u.role === 'student' && enrolled.includes(u.studentId)).map((u) => u.id);
  assert.ok(expectedAudience.length >= 12);
  assert.deepEqual(m.participantIds.slice().sort(), expectedAudience.slice().sort(), 'publicznością są zapisani uczniowie');
  assert.ok(S.db.col('audit').some((a) => a.action === 'meeting_scheduled' && a.entityId === meetingId && a.after.courseId === state.course));

  // bez terminu i bez identyfikatora element nie powstaje, nieistniejące spotkanie też jest odrzucane
  const noWhen = await c.post('/api/courses/' + state.course + '/items', { unitId: state.u1, kind: 'meeting', title: 'Bez terminu' });
  assert.equal(noWhen.status, 400); assert.equal(noWhen.body.code, 'no_meeting');
  const ghost = await c.post('/api/courses/' + state.course + '/items', { unitId: state.u1, kind: 'meeting', title: 'Widmo', meetingId: 'me_nie_ma' });
  assert.equal(ghost.status, 400); assert.equal(ghost.body.code, 'no_meeting');

  // zapisany uczeń widzi spotkanie i ma przycisk „Dołącz”; obcy uczeń nie
  const anna = await S.as('anna.kowalczyk');
  const view = expectOk(await anna.get('/api/courses/' + state.course));
  const item = view.units.find((u) => u.id === state.u1).items.find((i) => i.id === state.meetItem);
  assert.equal(item.kind, 'meeting'); assert.equal(item.meetingId, meetingId);
  const detail = expectOk(await anna.get('/api/meetings/' + meetingId));
  assert.equal(detail.canJoin, true); assert.equal(detail.courseId, state.course);
  const julia = await S.as('julia.baran');
  assert.equal((await julia.get('/api/meetings/' + meetingId)).status, 403);

  // zmiana terminu przestawia to samo spotkanie, nie zakłada drugiego
  const before = S.db.col('videoMeetings').length;
  const moved = expectOk(await c.patch('/api/courses/' + state.course + '/items/' + state.meetItem, { start: '2026-11-04T17:00', end: '2026-11-04T17:45' }));
  assert.equal(moved.item.meetingId, meetingId);
  assert.equal(S.db.col('videoMeetings').length, before, 'nie powstał drugi pokój');
  assert.equal(S.db.get('videoMeetings', meetingId).start, '2026-11-04T17:00:00.000Z');
  assert.ok(S.db.col('audit').some((a) => a.action === 'meeting_rescheduled' && a.entityId === meetingId));

  // usunięcie elementu odwołuje spotkanie, które jeszcze się nie zaczęło
  const del = expectOk(await c.delete('/api/courses/' + state.course + '/items/' + state.meetItem));
  assert.equal(del.meetingCancelled, meetingId);
  assert.equal(S.db.get('videoMeetings', meetingId).status, 'cancelled');
  assert.ok(S.db.col('audit').some((a) => a.action === 'meeting_cancelled' && a.entityId === meetingId));
  assert.ok(S.db.col('notifications').some((n) => n.kind === 'meeting' && /Odwołano spotkanie/.test(n.text)));
});

/* ================================================================= S-13 (przegląd bezpieczeństwa) */

test('[courses.11] S-13: do kursu nie da się wstawić materiału, którego treść nie zgadza się z typem', async () => {
  await builtCourse();
  const c = await S.as('j.nowak');
  const mats = S.db.col('materials');
  const b64 = (t) => Buffer.from(t).toString('base64');
  mats.push({ id: 'mat_s13_html', lessonId: null, classId: '7b', subjectId: 'mat', name: 'sciaga.pdf',
    type: 'text/html', dataUrl: 'data:text/html;base64,' + b64('<script>fetch("/api/grades")</script>'),
    size: 42, byUserId: 'u_nowak', at: '2026-10-20T09:00:00.000Z' });
  mats.push({ id: 'mat_s13_fake', lessonId: null, classId: '7b', subjectId: 'mat', name: 'karta.pdf',
    type: 'application/pdf', dataUrl: 'data:application/pdf;base64,' + b64('<html>wcale nie pdf</html>'),
    size: 42, byUserId: 'u_nowak', at: '2026-10-20T09:00:00.000Z' });
  S.db.save();

  const html = await c.post('/api/courses/' + state.course + '/items', { unitId: state.u1, kind: 'material', title: 'Ściąga', materialId: 'mat_s13_html' });
  assert.equal(html.status, 415); assert.equal(html.body.code, 'file_type_not_allowed');
  const fake = await c.post('/api/courses/' + state.course + '/items', { unitId: state.u1, kind: 'material', title: 'Karta', materialId: 'mat_s13_fake' });
  assert.equal(fake.status, 415); assert.equal(fake.body.code, 'content_mismatch');
  assert.equal(S.db.col('courseItems').some((i) => i.materialId === 'mat_s13_html' || i.materialId === 'mat_s13_fake'), false,
    'żaden z odrzuconych materiałów nie trafił do kursu');

  /* prawdziwy PDF z zasiewu przechodzi bez zmian */
  const good = expectOk(await c.post('/api/courses/' + state.course + '/items', { unitId: state.u1, kind: 'material', title: 'Karta powtórkowa', materialId: 'co_mt_ulamki' }));
  assert.equal(good.item.material.name, 'Ułamki zwykłe – karta powtórkowa.pdf');
});
