'use strict';
/* Komentarze i notatki prywatne przy wpisach dziennika wychowawcy i dziennika lekcyjnego:
   `homeroom-logbook`, `pupil-history`, `remarks` i `lesson-log`. Sprawdzamy to samo dla każdego
   rodzaju: kto widzi wpis — komentuje, notatka prywatna zostaje przy autorze, a lista wpisów
   niesie liczniki do znacznika przy wierszu. */
const test = require('node:test'); const assert = require('node:assert/strict');
const { startServer, expectOk } = require('./helpers');

const OSKAR = 'st_h_mazurek_oskar';          // 7b, przeniesiony, ma historię świadectw i opiekuna
const JAN = 'st_nowak_jan';                  // 7b, ma uwagi z zasiewu
const JULIA = 'st_baran_julia';              // 7a — poza zasięgiem wychowawcy 7b
const HIST = 'reportCardHistory:h_hist_mazurek_2025';

let S, P, H7b, H7a, W, PARENT, STUDENT, LIB, LESSON;
test.before(async () => {
  S = await startServer();
  P = await S.as('dyrektor');                // dyrektor
  H7b = await S.as('j.nowak');               // wychowawczyni 7b
  H7a = await S.as('b.sikora');              // wychowawczyni 7a
  W = await S.as('a.wojcik');                // nauczyciel bez wychowawstwa
  PARENT = await S.as('rodzic.mazurek');     // matka Oskara (7b)
  STUDENT = await S.as('oskar.mazurek');     // sam Oskar
  LIB = await S.as('biblioteka');            // rola spoza kartoteki ucznia
  const day = expectOk(await H7b.get('/api/lessons?date=' + S.TODAY));
  LESSON = day.lessons[0];
  assert.ok(LESSON, 'zasiew ma lekcję na dziś');
});
test.after(() => S.close());

const lc = (kind, id) => '/api/log-comments/' + kind + '/' + encodeURIComponent(id);

test('rodzaje dzienników wychowawcy i lekcyjnego są zarejestrowane', async () => {
  const k = expectOk(await P.get('/api/log-comments/kinds'));
  for (const kind of ['homeroom-logbook', 'pupil-history', 'remarks', 'lesson-log']) assert.ok(k.kinds.includes(kind), 'brak rodzaju ' + kind);
});

/* ---------------------------------------------------------------- dziennik wychowawcy (klasa) */
test('homeroom-logbook: komentuje wychowawca i dyrektor, notatka zostaje przy autorze', async () => {
  const c = expectOk(await H7b.post(lc('homeroom-logbook', '7b'), { text: 'Dziennik uzupełniony po radzie klasyfikacyjnej.' }));
  assert.equal(c.comment.private, false);
  const seen = expectOk(await P.get(lc('homeroom-logbook', '7b')));
  assert.equal(seen.comments.length, 1);
  assert.ok(seen.comments[0].author.includes('Nowak'));

  const note = expectOk(await P.post(lc('homeroom-logbook', '7b'), { text: 'Zapytać o brakujące podpisy.', private: true }));
  assert.equal(note.comment.private, true);
  const teacherSees = expectOk(await H7b.get(lc('homeroom-logbook', '7b')));
  assert.ok(!teacherSees.comments.some((x) => x.id === note.comment.id), 'notatki dyrektora wychowawczyni nie widzi');
  assert.equal(expectOk(await P.get(lc('homeroom-logbook', '7b'))).comments.length, 2);

  assert.equal((await H7a.get(lc('homeroom-logbook', '7b'))).status, 404, 'wychowawczyni 7a nie zagląda do dziennika 7b');
  assert.equal((await W.get(lc('homeroom-logbook', '7b'))).status, 403, 'nauczyciel bez wychowawstwa — rola spoza rejestru');
  assert.equal((await PARENT.get(lc('homeroom-logbook', '7b'))).status, 403);
  assert.equal((await H7b.get(lc('homeroom-logbook', 'brak-takiej-klasy'))).status, 404);
});

test('homeroom-logbook: status dziennika niesie liczniki komentarzy', async () => {
  const mine = expectOk(await H7b.get('/api/homeroom/logbook'));
  assert.equal(mine.classId, '7b');
  assert.equal(mine.comments.comments, 1);
  assert.equal(mine.comments.notes, 0, 'wychowawczyni nie liczy cudzych notatek');
  const forPrincipal = expectOk(await P.get('/api/homeroom/logbook?classId=7b'));
  assert.equal(forPrincipal.comments.comments, 1);
  assert.equal(forPrincipal.comments.notes, 1);
});

/* ---------------------------------------------------------------- historia ucznia */
test('pupil-history: wiersz historii komentuje wychowawca klasy ucznia i dyrektor', async () => {
  const c = expectOk(await H7b.post(lc('pupil-history', HIST), { text: 'Świadectwo z poprzedniej szkoły sprawdzone z oryginałem.' }));
  const seen = expectOk(await P.get(lc('pupil-history', HIST)));
  assert.ok(seen.comments.some((x) => x.id === c.comment.id));

  const note = expectOk(await H7b.post(lc('pupil-history', HIST), { text: 'Dopytać sekretariat o numer świadectwa.', private: true }));
  assert.ok(!expectOk(await P.get(lc('pupil-history', HIST))).comments.some((x) => x.id === note.comment.id));

  assert.equal((await H7a.get(lc('pupil-history', HIST))).status, 404, 'wychowawczyni 7a nie czyta historii ucznia 7b');
  assert.equal((await PARENT.get(lc('pupil-history', HIST))).status, 403, 'endpoint historii nie wpuszcza opiekunów');
  assert.equal((await STUDENT.get(lc('pupil-history', HIST))).status, 403);
  assert.equal((await H7b.get(lc('pupil-history', 'reportCardHistory:nie-ma'))).status, 404);
  assert.equal((await H7b.get(lc('pupil-history', 'h_hist_mazurek_2025'))).status, 404, 'identyfikator bez nazwy kolekcji nie działa');
});

test('pupil-history: lista historii ucznia niesie identyfikatory wpisów i liczniki', async () => {
  const h = expectOk(await H7b.get('/api/homeroom/history/' + OSKAR));
  const row = h.history.find((x) => x.entryId === HIST);
  assert.ok(row, 'wiersz ma trwały identyfikator <kolekcja>:<id>');
  assert.equal(row.comments.comments, 1);
  assert.equal(row.comments.notes, 1, 'autorka widzi własną notatkę');
  const forPrincipal = expectOk(await P.get('/api/homeroom/history/' + OSKAR + '?classId=7b'));
  assert.equal(forPrincipal.history.find((x) => x.entryId === HIST).notes, undefined);
  assert.equal(forPrincipal.history.find((x) => x.entryId === HIST).comments.notes, 0);
});

/* ---------------------------------------------------------------- uwagi i pochwały */
test('remarks: uwagę komentuje każdy, kto ją widzi — z rodzicem i uczniem włącznie', async () => {
  const r = expectOk(await H7b.post('/api/remarks', { studentId: OSKAR, kind: 'positive', text: 'Pomógł nowemu koledze odnaleźć się w klasie.', points: 5 }));
  const rid = r.remark.id;

  const byParent = expectOk(await PARENT.post(lc('remarks', rid), { text: 'Dziękujemy za informację — porozmawiamy w domu.' }));
  assert.equal(expectOk(await H7b.get(lc('remarks', rid))).comments.filter((x) => x.id === byParent.comment.id).length, 1);
  expectOk(await STUDENT.post(lc('remarks', rid), { text: 'Dziękuję.' }));
  assert.equal(expectOk(await P.get(lc('remarks', rid))).comments.length, 2);

  const note = expectOk(await PARENT.post(lc('remarks', rid), { text: 'Do rozmowy na zebraniu.', private: true }));
  assert.ok(!expectOk(await H7b.get(lc('remarks', rid))).comments.some((x) => x.id === note.comment.id));

  assert.equal((await LIB.get(lc('remarks', rid))).status, 403, 'biblioteka nie czyta uwag — rola spoza rejestru');

  // opiekun innego ucznia: uwaga Jana Nowaka jest dla matki Oskara niewidoczna
  const jan = expectOk(await H7b.get('/api/remarks?studentId=' + JAN)).remarks[0];
  assert.equal((await PARENT.get(lc('remarks', jan.id))).status, 404);
  assert.equal((await STUDENT.get(lc('remarks', jan.id))).status, 404);

  // wychowawczyni 7b nie uczy uczennicy 7a — jej uwagi też nie skomentuje
  const ra = expectOk(await H7a.post('/api/remarks', { studentId: JULIA, kind: 'neutral', text: 'Przyniosła zwolnienie z zajęć.' }));
  assert.equal((await H7b.get(lc('remarks', ra.remark.id))).status, 404);
  expectOk(await H7a.get(lc('remarks', ra.remark.id)));
});

test('remarks: lista uwag niesie liczniki przy każdym wpisie', async () => {
  const list = expectOk(await PARENT.get('/api/remarks?studentId=' + OSKAR));
  const row = list.remarks.find((x) => x.text.indexOf('Pomógł nowemu') === 0);
  assert.equal(row.comments.comments, 2);
  assert.equal(row.comments.notes, 1);
  const teacherList = expectOk(await H7b.get('/api/remarks?studentId=' + OSKAR));
  assert.equal(teacherList.remarks.find((x) => x.id === row.id).comments.notes, 0);
});

/* ---------------------------------------------------------------- dziennik lekcyjny */
test('lesson-log: temat lekcji komentuje pracownik szkoły, notatka zostaje przy autorze', async () => {
  const c = expectOk(await H7b.post(lc('lesson-log', LESSON.id), { text: 'Temat przesunięty o jedną godzinę — klasa była na apelu.' }));
  const seen = expectOk(await W.get(lc('lesson-log', LESSON.id)));
  assert.ok(seen.comments.some((x) => x.id === c.comment.id), 'plan klasy widzi każdy pracownik, więc i komentarz');
  expectOk(await P.get(lc('lesson-log', LESSON.id)));

  const note = expectOk(await W.post(lc('lesson-log', LESSON.id), { text: 'Sprawdzić salę na następny raz.', private: true }));
  assert.ok(!expectOk(await H7b.get(lc('lesson-log', LESSON.id))).comments.some((x) => x.id === note.comment.id));

  assert.equal((await PARENT.get(lc('lesson-log', LESSON.id))).status, 403, 'rodzic nie ma wglądu w dziennik lekcyjny');
  assert.equal((await STUDENT.get(lc('lesson-log', LESSON.id))).status, 403);
  assert.equal((await H7b.get(lc('lesson-log', 'les_nie_ma'))).status, 404);
});

test('lesson-log: plan dnia i karta lekcji niosą liczniki', async () => {
  const day = expectOk(await H7b.get('/api/lessons?date=' + S.TODAY));
  const row = day.lessons.find((l) => l.id === LESSON.id);
  assert.equal(row.comments.comments, 1);
  assert.equal(row.comments.notes, 0);
  const one = expectOk(await W.get('/api/lessons/' + LESSON.id));
  assert.equal(one.comments.comments, 1);
  assert.equal(one.comments.notes, 1, 'autor notatki liczy własną');
});
