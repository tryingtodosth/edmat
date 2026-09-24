'use strict';
/* 3.1 — frekwencja, temat lekcji i podstawa programowa, zadania domowe, sprawdziany, tryb offline.
   Oceny (3.1.4–3.1.11, 3.1.16, 3.1.20–3.1.24) testuje osobny plik. */
const test = require('node:test'); const assert = require('node:assert/strict');
const { startServer, expectOk } = require('./helpers');
const util = require('../server/lib/util');
const D = require('../server/lib/domain');
const HW = require('../server/routes/homework');

let S; test.before(async () => { S = await startServer(); }); test.after(() => S.close());

const lesson = (pred) => S.db.col('lessons').find(pred);
const matToday = (no) => lesson((l) => l.classId === '7b' && l.subjectId === 'mat' && l.date === S.TODAY && l.lessonNo === no);
const matOn = (date) => lesson((l) => l.classId === '7b' && l.subjectId === 'mat' && l.date === date);
const roster7b = () => S.db.get('classes', '7b').studentIds;

test('[3.1.1] jednym kliknięciem wszyscy obecni, potem zmiany pojedynczych statusów', async () => {
  const c = await S.as('j.nowak');
  const les = matToday(1); assert.ok(les, 'lekcja matematyki 7b na dziś');
  /* „Poniżej 30 sekund” to liczba czynności, nie zegarek: porównanie Date.now() wokół dwóch żądań HTTP
     nie może się nie udać. Liczymy więc, ile żądań zapisu potrzeba na całą klasę — jedno „wszyscy obecni”
     plus jedna korekta — i pilnujemy, żeby serwer nie wymuszał wpisu per uczeń. */
  let writes = 0; const post = (path, body) => { writes++; return c.post(path, body); };
  const started = Date.now();

  const all = expectOk(await post(`/api/attendance/lesson/${les.id}`, { allPresent: true }));
  assert.equal(all.students.length, roster7b().length);
  assert.ok(all.students.every((s) => s.status === 'ob'), 'po jednym kliknięciu wszyscy mają ob');

  const ids = all.students.map((s) => s.studentId);
  const change = expectOk(await post(`/api/attendance/lesson/${les.id}`, {
    entries: [
      { studentId: ids[0], status: 'nb' },
      { studentId: ids[1], status: 'sp', minutes: 8 },
      { studentId: ids[2], status: 'zw' },
      { studentId: ids[3], status: 'u' }
    ]
  }));
  assert.equal(change.saved, 4);
  assert.equal(writes, 2, 'cała klasa zapisana dwoma żądaniami: „wszyscy obecni” + jedna korekta zbiorcza');
  assert.ok(roster7b().length >= 12, 'to naprawdę jest cała klasa, nie trzyosobowa grupa');
  assert.ok(Date.now() - started < 1000, 'oba zapisy razem poniżej sekundy (limit z historyjki to 30 s na całą czynność nauczyciela)');

  const got = expectOk(await c.get(`/api/attendance/lesson/${les.id}`));
  const by = Object.fromEntries(got.students.map((s) => [s.studentId, s]));
  assert.equal(by[ids[0]].status, 'nb');
  assert.equal(by[ids[1]].status, 'sp'); assert.equal(by[ids[1]].minutes, 8);
  assert.equal(by[ids[2]].status, 'zw'); assert.equal(by[ids[3]].status, 'u');
  assert.equal(by[ids[4]].status, 'ob');
  assert.equal(got.stats.total, roster7b().length);

  // każdy zapis frekwencji trafia do rejestru audytowego
  assert.ok(S.db.col('audit').some((a) => a.action === 'attendance_save' && a.entityId === les.id));
  // status pojedynczego ucznia jest dostępny dla 3.1.2 (blokada oceny przy nb)
  const st = expectOk(await c.get(`/api/attendance/status?lessonId=${les.id}&studentId=${ids[0]}`));
  assert.equal(st.status, 'nb'); assert.equal(st.blocked, true);
  const ok2 = expectOk(await c.get(`/api/attendance/status?lessonId=${les.id}&studentId=${ids[4]}`));
  assert.equal(ok2.blocked, false);

  // cudzej lekcji nauczyciel nie zapisze
  const other = await S.as('a.wojcik');
  const denied = await other.post(`/api/attendance/lesson/${les.id}`, { allPresent: true });
  assert.equal(denied.status, 403); assert.equal(denied.body.code, 'not_lesson_teacher');
});

test('[3.1.3] temat lekcji powiązany z podstawą programową i realizacja liczona w czasie rzeczywistym', async () => {
  const c = await S.as('j.nowak');
  const les = matToday(1);
  const item = S.db.col('curriculum').find((x) => x.id === 'cur_mat7_8');
  const before = expectOk(await c.get('/api/curriculum/completion?subjectId=mat&classId=7b'));
  const coveredBefore = before.items.find((x) => x.id === item.id).covered;

  const saved = expectOk(await c.patch(`/api/lessons/${les.id}`, {
    topic: 'Twierdzenie Pitagorasa — wprowadzenie', curriculumItemIds: [item.id], at: '2026-10-23T08:40:00.000Z'
  }));
  assert.equal(saved.lesson.topic, 'Twierdzenie Pitagorasa — wprowadzenie');
  assert.deepEqual(saved.lesson.curriculumItemIds, [item.id]);
  assert.equal(saved.lesson.status, 'held');

  const after = expectOk(await c.get('/api/curriculum/completion?subjectId=mat&classId=7b'));
  const row = after.items.find((x) => x.id === item.id);
  assert.equal(row.covered, coveredBefore + 1, 'realizacja rośnie natychmiast po zapisaniu tematu');
  assert.equal(row.hours, item.hours);
  assert.equal(row.remaining, item.hours - row.covered);
  assert.ok(after.percent > 0 && after.percent <= 100);
  assert.equal(after.hours, S.db.col('curriculum').filter((x) => x.subjectId === 'mat' && x.level === 7).reduce((n, x) => n + x.hours, 0));

  // punkt z innego przedmiotu nie przejdzie walidacji
  const bad = await c.patch(`/api/lessons/${les.id}`, { curriculumItemIds: ['cur_fiz7_1'] });
  assert.equal(bad.status, 400); assert.equal(bad.body.code, 'curriculum_subject_mismatch');
  // pusty temat też nie
  assert.equal((await c.patch(`/api/lessons/${les.id}`, { topic: '  ' })).status, 400);

  // plan dnia nauczyciela pokazuje lekcję z tematem
  const day = expectOk(await c.get('/api/lessons'));
  assert.equal(day.date, S.TODAY);
  assert.ok(day.lessons.length >= 2);
  assert.ok(day.lessons.every((l) => l.teacherId === 'u_nowak' || l.substituteTeacherId === 'u_nowak'));
  assert.equal(day.lessons.find((l) => l.id === les.id).hasTopic, true);
  // plan klasy
  const cls = expectOk(await c.get('/api/lessons?classId=7b'));
  assert.ok(cls.lessons.length >= 5);
});

test('[3.1.12] lekcja łączona dwóch grup językowych: wspólna lista, wpisy w dzienniku klasy macierzystej', async () => {
  const c = await S.as('e.krol');
  const les = S.db.get('lessons', 'l_les_7b_ang2_' + S.TODAY);
  assert.ok(les && les.combinedWith, 'lekcja łączona z seeda');
  const view = expectOk(await c.get(`/api/attendance/lesson/${les.id}`));
  assert.equal(view.combined, true);
  assert.equal(view.combinedLessons.length, 2);
  const real = (ids) => ids.filter((sid) => S.db.get('students', sid));
  const g7b = real(S.db.get('groups', 'g_7b_ang2').studentIds), g7a = real(S.db.get('groups', 'g_7a_ang2').studentIds);
  assert.equal(view.students.length, g7b.length + g7a.length, 'jedna wspólna lista obecności');
  assert.ok(view.students.some((s) => s.classId === '7b') && view.students.some((s) => s.classId === '7a'));

  expectOk(await c.post(`/api/attendance/lesson/${les.id}`, { allPresent: true }));
  const rows7a = S.db.col('attendance').filter((a) => g7a.includes(a.studentId) && a.date === S.TODAY && a.subjectId === 'ang');
  assert.equal(rows7a.length, g7a.length);
  assert.ok(rows7a.every((a) => a.classId === '7a'), 'wiersze 7a zostają przy klasie macierzystej');
  assert.ok(rows7a.every((a) => a.lessonId === les.combinedWith), 'wiersze 7a trafiają do lekcji dziennika 7a');
  const rows7b = S.db.col('attendance').filter((a) => a.lessonId === les.id);
  assert.equal(rows7b.length, g7b.length);
  assert.ok(rows7b.every((a) => a.classId === '7b'));

  // ta sama lista widziana od strony lekcji 7a
  const mirror = expectOk(await c.get(`/api/attendance/lesson/${les.combinedWith}`));
  assert.equal(mirror.students.length, view.students.length);
  assert.ok(mirror.students.every((s) => s.status === 'ob'));

  // uczeń spoza obu grup nie może dostać wpisu
  const bad = await c.post(`/api/attendance/lesson/${les.id}`, { entries: [{ studentId: 'st_nowak_jan', status: 'nb' }] });
  assert.equal(bad.status, 400); assert.equal(bad.body.code, 'not_in_roster');
});

test('[3.1.13] status „reprezentuje szkołę” nie obniża procentu frekwencji', async () => {
  const c = await S.as('j.nowak');
  const les = matToday(3); assert.ok(les);
  const student = roster7b()[5];
  expectOk(await c.post(`/api/attendance/lesson/${les.id}`, { allPresent: true }));

  expectOk(await c.post(`/api/attendance/lesson/${les.id}`, { entries: [{ studentId: student, status: 'rs' }] }));
  const withRs = expectOk(await c.get(`/api/attendance/student/${student}/monthly?month=2026-10`));
  assert.ok(withRs.counts.rs >= 1);
  assert.equal(withRs.present, withRs.counts.ob + withRs.counts.sp + withRs.counts.rs + withRs.counts.w);
  assert.equal(withRs.representedSchool, withRs.counts.rs);

  expectOk(await c.post(`/api/attendance/lesson/${les.id}`, { entries: [{ studentId: student, status: 'nb' }] }));
  const withNb = expectOk(await c.get(`/api/attendance/student/${student}/monthly?month=2026-10`));
  assert.equal(withNb.total, withRs.total, 'ta sama liczba godzin');
  assert.ok(withNb.percent < withRs.percent, 'nb obniża procent, rs nie');

  expectOk(await c.post(`/api/attendance/lesson/${les.id}`, { entries: [{ studentId: student, status: 'rs' }] }));
  const back = expectOk(await c.get(`/api/attendance/student/${student}/monthly?month=2026-10`));
  assert.equal(back.percent, withRs.percent);

  // uczeń z seeda, który reprezentował szkołę na konkursie
  const kacper = S.db.one('students', (s) => s.classId === '7b' && s.firstName === 'Kacper');
  const m = expectOk(await c.get(`/api/attendance/student/${kacper.id}/monthly?month=2026-10`));
  assert.ok(m.counts.rs > 0);
});

test('[3.1.14] frekwencja zapisana jako wersja robocza po alarmie i dokończona bez utraty danych', async () => {
  const c = await S.as('j.nowak');
  const les = matOn('2026-10-26'); assert.ok(les);
  const ids = roster7b();

  const draft = expectOk(await c.post(`/api/attendance/lesson/${les.id}`, {
    draft: true, at: '2026-10-26T08:05:00.000Z',
    entries: [{ studentId: ids[0], status: 'ob' }, { studentId: ids[1], status: 'nb' }, { studentId: ids[2], status: 'sp', minutes: 4 }]
  }));
  assert.equal(draft.draft, true);
  assert.equal(S.db.get('lessons', les.id).attendanceDraft, true);
  const view = expectOk(await c.get(`/api/attendance/lesson/${les.id}`));
  assert.equal(view.draft, true);
  assert.ok(view.students.filter((s) => s.draft).length === 3);
  // wersja robocza nie wchodzi jeszcze do statystyk
  assert.equal(view.stats.total, 0);

  // dokończenie wpisu: wcześniejsze statusy zostają, reszta klasy dostaje ob
  const done = expectOk(await c.post(`/api/attendance/lesson/${les.id}`, {
    at: '2026-10-26T08:40:00.000Z',
    entries: ids.slice(3).map((studentId) => ({ studentId, status: 'ob' }))
  }));
  assert.equal(done.draft, false);
  const after = expectOk(await c.get(`/api/attendance/lesson/${les.id}`));
  const by = Object.fromEntries(after.students.map((s) => [s.studentId, s]));
  assert.equal(by[ids[1]].status, 'nb', 'wpis z wersji roboczej nie przepadł');
  assert.equal(by[ids[2]].status, 'sp'); assert.equal(by[ids[2]].minutes, 4);
  assert.ok(after.students.every((s) => !s.draft));
  assert.equal(after.stats.total, ids.length);
  assert.ok(S.db.col('audit').some((a) => a.action === 'attendance_draft' && a.entityId === les.id));
});

test('[3.1.15] spóźnienie z dokładną liczbą minut aktualizuje statystyki miesięczne', async () => {
  const c = await S.as('j.nowak');
  const les = matOn('2026-10-28'); assert.ok(les);
  const student = roster7b()[7];
  const before = expectOk(await c.get(`/api/attendance/student/${student}/monthly?month=2026-10`));

  const noMinutes = await c.post(`/api/attendance/lesson/${les.id}`, { entries: [{ studentId: student, status: 'sp' }] });
  assert.equal(noMinutes.status, 400); assert.equal(noMinutes.body.code, 'minutes_required');

  expectOk(await c.post(`/api/attendance/lesson/${les.id}`, { at: '2026-10-28T08:12:00.000Z', entries: [{ studentId: student, status: 'sp', minutes: 12 }] }));
  const after = expectOk(await c.get(`/api/attendance/student/${student}/monthly?month=2026-10`));
  assert.equal(after.lateMinutes, before.lateMinutes + 12);
  assert.equal(after.lateCount, before.lateCount + 1);
  assert.equal(after.month, '2026-10'); assert.equal(after.from, '2026-10-01'); assert.equal(after.to, '2026-10-31');
  const entry = after.late.find((x) => x.date === '2026-10-28');
  assert.ok(entry && entry.minutes === 12 && entry.subjectId === 'mat');
  assert.ok(after.bySubject.mat, 'statystyka miesięczna w rozbiciu na przedmioty');
  // spóźnienie liczy się jako obecność
  assert.equal(after.present, after.counts.ob + after.counts.sp + after.counts.rs + after.counts.w);
});

test('[3.1.17] zadanie domowe z terminem, limitem załącznika i blokadą po terminie', async () => {
  const c = await S.as('j.nowak');
  const open = expectOk(await c.post('/api/homework', {
    classId: '7b', subjectId: 'mat', text: 'Zadania 1–5 ze strony 72.', dueAt: '2026-10-28T20:00', maxAttachmentMB: 1, lockAfterDue: true
  }));
  /* P24 — nauczyciel wpisuje czas ścienny szkoły; zapisujemy instant ZE STREFĄ i to, co wpisał.
     28.10 to już czas zimowy, więc 20:00 w Warszawie = 19:00 UTC, a nie 20:00 UTC. */
  assert.equal(open.homework.dueAt, '2026-10-28T20:00:00+01:00');
  assert.equal(open.homework.dueLocal, '2026-10-28T20:00');
  assert.equal(open.homework.dueTime, '20:00');
  assert.equal(new Date(open.homework.dueAt).toISOString(), '2026-10-28T19:00:00.000Z');
  assert.equal(open.homework.maxAttachmentMB, 1);
  assert.equal(open.homework.lockAfterDue, true);
  assert.equal(open.homework.locked, false);
  assert.ok(S.db.col('audit').some((a) => a.action === 'homework_publish' && a.entityId === open.homework.id));

  const past = expectOk(await c.post('/api/homework', {
    classId: '7b', subjectId: 'mat', text: 'Zadanie po terminie.', dueAt: '2026-10-20T15:00', lockAfterDue: true
  }));
  assert.equal(past.homework.locked, true);

  // limit większy niż szkolny odrzucony
  const tooBig = await c.post('/api/homework', { classId: '7b', subjectId: 'mat', text: 'x', dueAt: '2026-10-28', maxAttachmentMB: 500 });
  assert.equal(tooBig.status, 400); assert.equal(tooBig.body.code, 'bad_limit');
  // nie swój przedmiot
  const notMine = await c.post('/api/homework', { classId: '7b', subjectId: 'ang', text: 'x', dueAt: '2026-10-28' });
  assert.equal(notMine.status, 403);

  const s = await S.as('anna.kowalczyk');
  // załącznik ponad limit — rozmiar liczy się z treści, nie z pola `size` przysłanego przez klienta
  const bigPdf = 'data:application/pdf;base64,' + Buffer.from('%PDF-1.4\n' + 'A'.repeat(1.3 * 1024 * 1024)).toString('base64');
  const big = await s.post(`/api/homework/${open.homework.id}/submissions`, { files: [{ name: 'skan.pdf', size: 12, type: 'application/pdf', dataUrl: bigPdf }] });
  assert.equal(big.status, 413); assert.equal(big.body.code, 'attachment_too_large');
  // S-13: „PDF”, którego treść nie jest PDF-em, odrzuca wspólny walidator załączników
  const fake = await s.post(`/api/homework/${open.homework.id}/submissions`, { files: [{ name: 'skan.pdf', size: 4, type: 'application/pdf', dataUrl: 'data:application/pdf;base64,AAAA' }] });
  assert.equal(fake.status, 415); assert.equal(fake.body.code, 'content_mismatch');
  // oddanie po terminie zablokowane
  const late = await s.post(`/api/homework/${past.homework.id}/submissions`, { text: 'spóźnione' });
  assert.equal(late.status, 403); assert.equal(late.body.code, 'homework_locked');
  // oddanie przed terminem przyjęte z potwierdzeniem odbioru
  const ok = expectOk(await s.post(`/api/homework/${open.homework.id}/submissions`, { text: 'Rozwiązania 1–5 w zeszycie.', files: [{ name: 'zad.png', type: 'image/png', dataUrl: 'data:image/png;base64,iVBORw0KGgo=' }] }));
  assert.ok(ok.receivedAt && ok.receivedAt.endsWith('Z'), 'serwerowy znacznik odbioru');
  assert.equal(ok.late, false);
  assert.equal(ok.submission.studentId, 'st_kowalczyk_anna');
});

test('[3.1.18] przegląd oddanej pracy w przeglądarce: treść pliku wraca inline i zostaje oznaczona', async () => {
  const c = await S.as('j.nowak');
  const list = expectOk(await c.get('/api/homework/l_hw_mat_7b/submissions'));
  assert.ok(list.submissions.some((x) => x.id === 'l_sub_kowalczyk'));
  assert.equal(list.submissions[0].files[0].dataUrl, undefined, 'lista nie przesyła treści plików');
  assert.ok(Array.isArray(list.missing) && list.missing.length >= 1);

  const view = expectOk(await c.get('/api/homework/l_hw_mat_7b/submissions/l_sub_kowalczyk'));
  const f = view.submission.files[0];
  assert.match(f.dataUrl, /^data:image\/png;base64,/, 'plik dostępny inline, bez pobierania na dysk');
  assert.equal(f.inline, true); assert.equal(f.viewable, true);
  assert.equal(view.submission.reviewedAt, null);

  const reviewed = expectOk(await c.post('/api/homework/l_hw_mat_7b/submissions/l_sub_kowalczyk/review', { comment: 'Zadanie 6 – sprawdź skracanie.' }));
  assert.ok(reviewed.submission.reviewedAt);
  assert.equal(reviewed.submission.reviewedBy, 'u_nowak');
  assert.match(reviewed.submission.files[0].dataUrl, /^data:image\/png;base64,/);
  assert.ok(S.db.col('audit').some((a) => a.action === 'homework_review' && a.entityId === 'l_sub_kowalczyk'));

  const stranger = await S.as('a.wojcik');
  assert.equal((await stranger.post('/api/homework/l_hw_mat_7b/submissions/l_sub_kowalczyk/review', {})).status, 403);
});

test('[3.1.19] zapowiedź sprawdzianu z ostrzeżeniem po osiągnięciu limitu szkolnego', async () => {
  const c = await S.as('j.nowak');
  // tydzień 02–08.11.2026: w seedzie jest już jeden sprawdzian (06.11), zostają dwa wolne terminy
  const free = ['2026-11-03', '2026-11-04', '2026-11-05'];
  const chk = expectOk(await c.get('/api/tests/check?classId=7b&date=2026-11-03'));
  assert.equal(chk.perWeek, S.db.data.config.testLimits.perWeek);
  assert.equal(chk.limitReached, false);
  assert.equal(chk.weekFrom, '2026-11-02'); assert.equal(chk.weekTo, '2026-11-08');

  let i = 0, last = null;
  for (let k = chk.weekCount; k < chk.perWeek; k++) {
    last = expectOk(await c.post('/api/tests', { classId: '7b', subjectId: 'mat', date: free[i++], kind: 'sprawdzian', scope: 'Twierdzenie Pitagorasa' }));
  }
  assert.ok(last, 'w tym tygodniu był jeszcze wolny termin');
  assert.equal(last.check.weekFull, true);
  assert.match(last.warning, /\d+\/\d+ sprawdzianów/);

  const over = await c.post('/api/tests', { classId: '7b', subjectId: 'mat', date: free[i], kind: 'sprawdzian', scope: 'Kolejny' });
  assert.equal(over.status, 409);
  assert.equal(over.body.code, 'test_limit');
  assert.equal(over.body.weekFull, true);
  assert.match(over.body.error, /Limit szkolny/);
  assert.ok(over.body.tests.length >= 3, 'odpowiedź pokazuje zajęte terminy tygodnia');

  // limit dzienny: drugi sprawdzian tego samego dnia
  const sameDay = await c.post('/api/tests', { classId: '7b', subjectId: 'mat', date: free[i - 1], kind: 'sprawdzian', scope: 'Drugi tego dnia' });
  assert.equal(sameDay.status, 409);
  // kartkówka nie jest objęta limitem
  const quiz = expectOk(await c.post('/api/tests', { classId: '7b', subjectId: 'mat', date: free[i], kind: 'kartkówka', scope: 'Kartkówka' }));
  assert.equal(quiz.test.kind, 'kartkówka');
  const listed = expectOk(await c.get('/api/tests?classId=7b&from=2026-11-02&to=2026-11-08'));
  assert.ok(listed.tests.some((t) => t.id === quiz.test.id));
  assert.ok(listed.tests.every((t) => t.classId === '7b'));

  // sprawdzianu nie zapowiada się wstecz ani „na jutro” bez wymaganego wyprzedzenia
  const past = await c.post('/api/tests', { classId: '7b', subjectId: 'mat', date: '2026-10-21', kind: 'sprawdzian', scope: 'Wstecz' });
  assert.equal(past.status, 400); assert.equal(past.body.code, 'test_in_past');
  assert.match(past.body.error, /już minął/);
  assert.equal(chk.noticeDays, 7, 'domyślne wyprzedzenie: tydzień (config.testNoticeDays)');
  const soon = expectOk(await c.post('/api/tests', { classId: '7b', subjectId: 'mat', date: '2026-10-24', kind: 'sprawdzian', scope: 'Za dzień' }));
  assert.equal(soon.shortNotice, true);
  assert.equal(soon.test.daysAhead, 1);
  assert.match(soon.notice, /7 dni/);
  assert.ok(S.db.col('audit').some((a) => a.action === 'test_announce' && a.entityId === soon.test.id && /Statut wymaga/.test(a.reason || '')), 'krótka zapowiedź trafia do rejestru zmian');
  const inTime = expectOk(await c.get('/api/tests/check?classId=7b&date=2026-11-20'));
  assert.equal(inTime.shortNotice, false); assert.equal(inTime.inPast, false);
});

/** Uruchamia public/app/core.js w piaskownicy z minimalnym „przeglądarkowym” otoczeniem.
    Dzięki temu tryb offline z historyjki 3.1.25 jest naprawdę wykonywany, a nie tylko opisany. */
function loadCore(opts) {
  const vm = require('node:vm'); const fs = require('node:fs'); const path = require('node:path');
  const store = {}; const handlers = {};
  const sandbox = {
    console,
    React: { createElement: () => null, useState: (v) => [v, () => {}], useEffect: () => {}, useRef: () => ({ current: null }), useMemo: (f) => f(), useCallback: (f) => f, Fragment: 'F' },
    localStorage: { getItem: (k) => (k in store ? store[k] : null), setItem: (k, v) => { store[k] = String(v); }, removeItem: (k) => { delete store[k]; } },
    navigator: { onLine: opts.online, userAgent: 'node', serviceWorker: undefined },
    location: { hash: '#/lekcja', search: '' },
    document: { addEventListener: () => {}, querySelector: () => null, documentElement: { dataset: {}, style: {} } },
    fetch: opts.fetch,
    setTimeout, clearTimeout, setInterval: () => 0, clearInterval: () => {},
    EdI18n: { get: () => 'pl', set: (l) => l, t: (k) => k },
  };
  sandbox.window = sandbox;
  sandbox.addEventListener = (ev, fn) => { (handlers[ev] = handlers[ev] || []).push(fn); };
  vm.createContext(sandbox);
  vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'public', 'app', 'core.js'), 'utf8'), sandbox);
  return { A: sandbox.EdApp, store, fire: (ev) => Promise.all((handlers[ev] || []).map((f) => f())) };
}

test('[3.1.25] kolejka offline z core.js: zapis czeka w localStorage konta i dogrywa się po powrocie sieci', async () => {
  /* Historyjka mówi o „bezszwowej synchronizacji” po odzyskaniu łącza — to zachowanie klienta,
     którego test serwerowy nie dotyka. Uruchamiamy więc prawdziwy public/app/core.js. */
  let offline = true; const sent = [];
  const fakeFetch = async (url, init) => {
    if (offline) throw new TypeError('Failed to fetch');
    sent.push({ url, method: init.method, body: init.body ? JSON.parse(init.body) : null });
    return { status: 200, ok: true, headers: { get: () => 'application/json' }, json: async () => ({ ok: true }) };
  };
  const { A, store, fire } = loadCore({ online: false, fetch: fakeFetch });
  A.setState({ user: { id: 'u_nowak', login: 'j.nowak' } });
  A.setQueueUser('u_nowak');                                   // kolejka jest przypisana do konta

  // 1. zapis bez sieci nie ginie: wraca {queued:true} i ląduje w localStorage tego konta
  const r1 = await A.api.post('/api/attendance/lesson/l1', { allPresent: true }, { queueable: true, label: 'frekwencja' });
  const r2 = await A.api.patch('/api/lessons/l1', { topic: 'Temat z trybu offline' }, { queueable: true, label: 'temat' });
  assert.equal(r1.queued, true); assert.equal(r2.queued, true);
  assert.equal(sent.length, 0, 'nic nie poszło do sieci');
  const key = A.queueKey('u_nowak');
  const queued = JSON.parse(store[key]);
  assert.equal(queued.length, 2, 'oba zapisy czekają w kolejce konta ' + key);
  assert.deepEqual(queued.map((x) => x.method + ' ' + x.path), ['POST /api/attendance/lesson/l1', 'PATCH /api/lessons/l1']);
  assert.ok(queued.every((x) => x.userId === 'u_nowak' && x.at), 'każdy wpis niesie autora i czas naciśnięcia zapisu');
  assert.equal(A.state.online, false);

  // 2. zapis bez queueable nadal zgłasza błąd, zamiast po cichu znikać
  await assert.rejects(() => A.api.get('/api/lessons'), (e) => e.offline === true);

  // 3. cudza sesja nie dogrywa tej kolejki (wspólny komputer w pokoju nauczycielskim)
  offline = false;
  A.setState({ user: { id: 'u_wojcik', login: 'a.wojcik' } });
  await A.flushQueue();
  assert.equal(sent.length, 0, 'kolejka nauczycielki nie może się wysłać w sesji innego nauczyciela');
  assert.equal(JSON.parse(store[key]).length, 2, 'i nic z niej nie znika');

  // 4. powrót sieci we własnej sesji: zdarzenie 'online' dogrywa kolejkę w kolejności i czyści ją
  A.setState({ user: { id: 'u_nowak', login: 'j.nowak' } });
  A.setQueueUser('u_nowak');
  await fire('online');                                  // nasłuch 'online' odpala flushQueue() bez await
  for (let i = 0; i < 200 && (store[key] ? JSON.parse(store[key]).length : 0); i++) await new Promise((r) => setTimeout(r, 5));
  assert.deepEqual(sent.map((x) => x.method + ' ' + x.url), ['POST /api/attendance/lesson/l1', 'PATCH /api/lessons/l1']);
  assert.deepEqual(sent[1].body, { topic: 'Temat z trybu offline' });
  assert.equal(store[key] ? JSON.parse(store[key]).length : 0, 0, 'kolejka pusta po synchronizacji');
  assert.equal(A.state.queue.length, 0);
  assert.equal(A.state.syncError, null);
});

test('[3.1.25] powtórzony zapis z kolejki offline jest idempotentny, a odczyt po synchronizacji się zgadza', async () => {
  const c = await S.as('j.nowak');
  const les = matOn('2026-10-27'); assert.ok(les);
  const ids = roster7b();
  const queued = {
    at: '2026-10-27T08:55:00.000Z', allPresent: true,
    entries: [{ studentId: ids[0], status: 'nb' }, { studentId: ids[1], status: 'sp', minutes: 6 }]
  };
  const path = `/api/attendance/lesson/${les.id}`;
  const first = expectOk(await c.post(path, queued));
  const rowsAfterFirst = S.db.col('attendance').filter((a) => a.lessonId === les.id).length;
  assert.equal(rowsAfterFirst, ids.length);

  // kolejka offline wysyła to samo żądanie jeszcze dwa razy
  const replay1 = expectOk(await c.post(path, queued));
  const replay2 = expectOk(await c.post(path, queued));
  assert.equal(S.db.col('attendance').filter((a) => a.lessonId === les.id).length, rowsAfterFirst, 'brak duplikatów wierszy');
  assert.deepEqual(replay2.students.map((s) => s.status + ':' + (s.minutes || 0)), first.students.map((s) => s.status + ':' + (s.minutes || 0)));
  assert.deepEqual(replay1.students.map((s) => s.studentId), first.students.map((s) => s.studentId));

  const read = expectOk(await c.get(path));
  assert.deepEqual(read.students.map((s) => s.status), first.students.map((s) => s.status));
  const by = Object.fromEntries(read.students.map((s) => [s.studentId, s]));
  assert.equal(by[ids[0]].status, 'nb');
  assert.equal(by[ids[1]].status, 'sp'); assert.equal(by[ids[1]].minutes, 6);

  // starszy wpis z kolejki nie nadpisuje nowszej korekty zrobionej online
  expectOk(await c.post(path, { at: '2026-10-27T09:30:00.000Z', entries: [{ studentId: ids[0], status: 'u' }] }));
  const stale = expectOk(await c.post(path, { at: '2026-10-27T08:55:00.000Z', entries: [{ studentId: ids[0], status: 'nb' }] }));
  assert.equal(stale.skipped, 1);
  assert.equal(stale.students.find((s) => s.studentId === ids[0]).status, 'u');

  // temat lekcji zapisany offline jest odporny na powtórzenie
  const topic = { topic: 'Równania z jedną niewiadomą — zadania', curriculumItemIds: ['cur_mat7_6'], at: '2026-10-27T09:35:00.000Z' };
  expectOk(await c.patch(`/api/lessons/${les.id}`, topic));
  expectOk(await c.patch(`/api/lessons/${les.id}`, topic));
  assert.equal(S.db.get('lessons', les.id).topic, topic.topic);
  assert.deepEqual(S.db.get('lessons', les.id).curriculumItemIds, ['cur_mat7_6']);
});

/* ------------------------------------------------------------------ czas i strefa czasowa (W2) */

test('[REL-08] „dzisiaj” to dzień ścienny w Europe/Warsaw, nie doba UTC', () => {
  const TZ = 'Europe/Warsaw';
  /* 00:30 w Warszawie 15.01.2027 to jeszcze 14.01 w UTC — dawne today() zapisywało wtedy wczoraj.
     Zegara nie ruszamy: podajemy instant, a nie udajemy, że jest noc. */
  const nightWinter = util.toInstant('2027-01-15', '00:30', TZ);
  assert.equal(new Date(nightWinter).toISOString(), '2027-01-14T23:30:00.000Z');
  assert.equal(util.localDate(nightWinter, TZ), '2027-01-15');
  assert.equal(util.localTime(nightWinter, TZ), '00:30');
  assert.equal(new Date(nightWinter).toISOString().slice(0, 10), '2027-01-14', 'UTC naprawdę pokazuje wtedy wczoraj');
  // latem przesunięcie wynosi dwie godziny — 01:30 czasu letniego to wciąż poprzednia doba UTC
  const nightSummer = util.toInstant('2027-07-15', '01:30', TZ);
  assert.equal(new Date(nightSummer).toISOString(), '2027-07-14T23:30:00.000Z');
  assert.equal(util.localDate(nightSummer, TZ), '2027-07-15');
  assert.equal(util.zoneOffsetMinutes(nightSummer, TZ), 120);
  assert.equal(util.zoneOffsetMinutes(nightWinter, TZ), 60);
  // today() bez argumentu liczy w strefie szkoły (o ile proces nie narzuca innej)
  const processTz = process.env.EDMAT_TZ || process.env.TZ || 'Europe/Warsaw';
  assert.equal(util.today(), new Intl.DateTimeFormat('sv-SE', { timeZone: processTz }).format(new Date()));
  assert.equal(util.today(TZ), new Intl.DateTimeFormat('sv-SE', { timeZone: TZ }).format(new Date()));
  // jedno „teraz w szkole”: data, godzina i instant z tej samej strefy (P31)
  const sn = D.schoolNow(S.db);
  assert.equal(sn.date, S.TODAY, 'demo przypina dzień przez config.today');
  assert.match(sn.time, /^\d{2}:\d{2}$/);
  assert.equal(util.localDate(sn.instant, D.tz(S.db)), sn.date);
  assert.equal(util.localTime(sn.instant, D.tz(S.db)), sn.time);
  assert.equal(D.tz(S.db), TZ);
});

test('[3.1.17] termin zadania w dobie zmiany czasu zostaje godziną ścienną', async () => {
  const c = await S.as('j.nowak');
  /* 25.10.2026 zegary cofają się o 3:00 na 2:00, więc 02:30 istnieje dwa razy. Wpis nauczyciela
     rozstrzygamy na późniejsze (zimowe) wystąpienie — termin nie skraca się uczniowi o godzinę. */
  const dst = expectOk(await c.post('/api/homework', { classId: '7b', subjectId: 'mat', text: 'Zadanie w noc zmiany czasu.', dueAt: '2026-10-25T02:30' }));
  assert.equal(dst.homework.dueLocal, '2026-10-25T02:30');
  assert.equal(dst.homework.dueAt, '2026-10-25T02:30:00+01:00');
  assert.equal(new Date(dst.homework.dueAt).toISOString(), '2026-10-25T01:30:00.000Z');

  // doba zmiany czasu ma 25 godzin: „23:59” 24.10 i „23:59” 25.10 dzieli 25 h, nie 24
  const before = expectOk(await c.post('/api/homework', { classId: '7b', subjectId: 'mat', text: 'Sobota przed zmianą czasu.', dueAt: '2026-10-24' }));
  const after = expectOk(await c.post('/api/homework', { classId: '7b', subjectId: 'mat', text: 'Niedziela po zmianie czasu.', dueAt: '2026-10-25' }));
  assert.equal(before.homework.dueAt, '2026-10-24T23:59:59+02:00');
  assert.equal(after.homework.dueAt, '2026-10-25T23:59:59+01:00');
  assert.equal(before.homework.dueTime, '23:59');
  assert.equal(Date.parse(after.homework.dueAt) - Date.parse(before.homework.dueAt), 25 * 3600 * 1000);
});

test('[3.1.17] „23:59” jest po terminie dopiero po 23:59 w Warszawie', () => {
  const TZ = 'Europe/Warsaw';
  const db = { data: { config: { timezone: TZ } } };                 // bez przypiętego config.today
  const winter = Object.assign({ lockAfterDue: true }, HW.normalizeDueParts('2026-10-28T23:59', TZ));
  assert.equal(winter.dueAt, '2026-10-28T23:59:00+01:00');
  assert.equal(HW.isPastDue(db, winter, '2026-10-28T22:58:00Z'), false, '23:58 w Warszawie — jeszcze w terminie');
  assert.equal(HW.isPastDue(db, winter, '2026-10-28T22:59:30Z'), true, '23:59:30 w Warszawie — już po terminie');
  /* Dawny błąd: porównanie z czasem UTC. 23:30 UTC to 00:30 następnego dnia w Warszawie — praca
     jest spóźniona, choć zegar UTC pokazuje jeszcze 28.10 przed 23:59. */
  assert.equal(HW.isPastDue(db, winter, '2026-10-28T23:30:00Z'), true);
  assert.equal(HW.isLocked(db, winter, '2026-10-28T23:30:00Z'), true);

  const summer = Object.assign({ lockAfterDue: true }, HW.normalizeDueParts('2026-07-01T23:59', TZ));
  assert.equal(summer.dueAt, '2026-07-01T23:59:00+02:00');
  assert.equal(HW.isPastDue(db, summer, '2026-07-01T21:58:00Z'), false, '23:58 czasu letniego');
  assert.equal(HW.isPastDue(db, summer, '2026-07-01T22:30:00Z'), true, '00:30 następnego dnia w Warszawie');

  // stary wiersz z bazy (czas lokalny ostemplowany jako UTC) czytamy z powrotem jako czas ścienny
  const legacy = HW.dueOf(db, { dueAt: '2026-10-28T20:00:00Z' });
  assert.equal(legacy.dueLocal, '2026-10-28T20:00');
  assert.equal(legacy.dueAt, '2026-10-28T20:00:00+01:00');
});

/* ------------------------------------------------------------------ GAP-2 (docs/PILOT.md §4)
   Podstawa programowa była do tej rundy wyłącznie do czytania: pusta instalacja nie miała jak jej
   wprowadzić, więc „temat lekcji powiązany z podstawą” i ekran realizacji podstawy były w nowej
   szkole martwe. Te testy bronią tras zapisu, importu z arkusza i zachowania „zero punktów”. */

test('[3.1.3] GAP-2: nauczyciel prowadzi podstawę swojego przedmiotu, dyrekcja — całej szkoły', async () => {
  const c = await S.as('j.nowak');                       // matematyka
  const made = expectOk(await c.post('/api/curriculum', { subjectId: 'mat', level: 7, code: 'IX.7', title: 'Wyrażenia algebraiczne — powtórzenie', hours: 4 }));
  assert.equal(made.item.subjectId, 'mat');
  assert.equal(made.item.hours, 4);
  assert.equal(made.item.subjectName, 'Matematyka');
  assert.ok(S.db.col('audit').some((a) => a.action === 'curriculum_create' && a.entityId === made.item.id), 'zapis zostawia wiersz audytu');

  const fixed = expectOk(await c.patch(`/api/curriculum/${made.item.id}`, { hours: 6, title: 'Wyrażenia algebraiczne — utrwalenie' }));
  assert.equal(fixed.item.hours, 6);
  assert.match(fixed.item.title, /utrwalenie/);
  const upd = S.db.col('audit').filter((a) => a.action === 'curriculum_update' && a.entityId === made.item.id).slice(-1)[0];
  assert.equal(upd.before.hours, 4, 'rejestr zmian niesie stan sprzed zmiany');

  // cudzy przedmiot to 403 z powodem, a nie ciche powodzenie
  const alien = await c.post('/api/curriculum', { subjectId: 'fiz', level: 7, code: 'Z.1', title: 'Nie mój przedmiot', hours: 2 });
  assert.equal(alien.status, 403); assert.equal(alien.body.code, 'not_subject_teacher');

  // ten sam kod dla tego samego przedmiotu i poziomu — 409, nie drugi wiersz
  const dup = await c.post('/api/curriculum', { subjectId: 'mat', level: 7, code: 'IX.7', title: 'Kopia', hours: 1 });
  assert.equal(dup.status, 409); assert.equal(dup.body.code, 'duplicate_item');

  // dyrektor prowadzi każdy przedmiot
  const P = await S.as('dyrektor');
  const byPrincipal = expectOk(await P.post('/api/curriculum', { subjectId: 'fiz', level: 7, code: 'Z.1', title: 'Ruch jednostajny — powtórzenie', hours: 3 }));
  assert.equal(byPrincipal.item.subjectId, 'fiz');
  expectOk(await P.delete(`/api/curriculum/${byPrincipal.item.id}`));

  // usunięcie odpina punkt od tematów lekcji, zamiast zostawiać odwołanie donikąd
  const les = matOn('2026-10-21') || matToday(1);
  const before = (S.db.get('lessons', les.id).curriculumItemIds || []).slice();
  expectOk(await c.patch(`/api/lessons/${les.id}`, { topic: 'Wyrażenia algebraiczne — ćwiczenia', curriculumItemIds: [made.item.id] }));
  assert.ok(S.db.get('lessons', les.id).curriculumItemIds.includes(made.item.id));
  const gone = expectOk(await c.delete(`/api/curriculum/${made.item.id}`));
  assert.equal(gone.unlinkedLessons, 1, 'punkt odpięty dokładnie od tej jednej lekcji');
  assert.ok(!S.db.get('lessons', les.id).curriculumItemIds.includes(made.item.id));
  assert.equal(S.db.get('curriculum', made.item.id), null);
  S.db.get('lessons', les.id).curriculumItemIds = before;   // porządek po sobie
});

test('[3.1.3] GAP-2: wklejony arkusz wprowadza podstawę, a powtórzony import aktualizuje, nie dubluje', async () => {
  const c = await S.as('j.nowak');
  const format = expectOk(await c.get('/api/curriculum/format'));
  assert.equal(format.separator, ';');
  assert.equal(format.header, 'subject;level;code;title;hours');
  assert.ok(format.example.includes('mat;7;'), 'opis formatu niesie przykład do skopiowania');

  const csv = ['subject;level;code;title;hours', 'mat;5;I.1;Liczby naturalne;12', 'mat;5;II.1;Ułamki;9', 'mat;5;I.1;Liczby naturalne (kopia w pliku);3'].join('\n');
  const dry = expectOk(await c.post('/api/curriculum/import', { csv, dryRun: true }));
  assert.equal(dry.applied, false);
  assert.equal(dry.created, 2); assert.equal(dry.skipped, 1, 'duplikat w samym pliku liczony raz');
  assert.equal(S.db.col('curriculum').filter((x) => x.level === 5).length, 0, 'próbny przebieg niczego nie zapisał');

  const real = expectOk(await c.post('/api/curriculum/import', { csv }));
  assert.equal(real.applied, true); assert.equal(real.created, 2);
  const stored = S.db.col('curriculum').filter((x) => x.subjectId === 'mat' && x.level === 5);
  assert.equal(stored.length, 2);

  // ten sam arkusz z poprawioną liczbą godzin: aktualizacja, nie drugi komplet
  const again = expectOk(await c.post('/api/curriculum/import', { csv: 'subject;level;code;title;hours\nmat;5;I.1;Liczby naturalne;15' }));
  assert.equal(again.created, 0); assert.equal(again.updated, 1);
  assert.equal(S.db.col('curriculum').filter((x) => x.subjectId === 'mat' && x.level === 5).length, 2, 'nadal dwa punkty');
  assert.equal(S.db.one('curriculum', (x) => x.subjectId === 'mat' && x.level === 5 && x.code === 'I.1').hours, 15);
  assert.ok(S.db.col('audit').some((a) => a.action === 'curriculum_import'), 'import zostawia wiersz audytu');

  // błędny wiersz wstrzymuje import i wskazuje numer linii
  const bad = await c.post('/api/curriculum/import', { csv: 'subject;level;code;title;hours\nmat;99;X.1;Zły poziom;5' });
  assert.equal(bad.status, 400); assert.equal(bad.body.code, 'import_errors');
  assert.equal(bad.body.errors[0].line, 2);

  for (const x of stored) await c.delete('/api/curriculum/' + x.id);   // porządek po sobie
});

test('[3.1.3] GAP-2: przedmiot bez ani jednego punktu podstawy to 0 %, nie NaN', async () => {
  const c = await S.as('a.mazur');                      // wf — podstawa pusta w zasiewie
  const empty = expectOk(await c.get('/api/curriculum/completion?subjectId=wf&classId=7b'));
  assert.equal(empty.hasItems, false);
  assert.equal(empty.hours, 0);
  assert.equal(empty.percent, 0, 'zero godzin to zero procent, nie null i nie NaN');
  assert.ok(Number.isFinite(empty.percent));
  assert.deepEqual(empty.items, []);

  const full = expectOk(await (await S.as('j.nowak')).get('/api/curriculum/completion?subjectId=mat&classId=7b'));
  assert.equal(full.hasItems, true);
  assert.ok(full.hours > 0 && Number.isFinite(full.percent));
  assert.ok(full.items.every((x) => Number.isFinite(x.percent)), 'także procent per punkt nigdy nie jest NaN');
});
