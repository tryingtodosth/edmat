'use strict';
/* 3.1 — oceny cząstkowe, kategorie, poprawy, oceny proponowane, uwagi, eksport i wydruk. */
const test = require('node:test'); const assert = require('node:assert/strict');
const { startServer, expectOk } = require('./helpers');

let S; test.before(async () => { S = await startServer(); }); test.after(() => S.close());

const ANNA = 'st_kowalczyk_anna';      // 7. Kowalczyk Anna
const TOMASZ = 'st_szymaski_tomasz';   // 16. Szymański Tomasz — nb na lekcji matematyki 25.09.2026
const FILIP = 'st_woniak_filip';       // 20. Woźniak Filip — nowy uczeń, w seedzie bez ocen
const EMILIA = 'st_dbrowska_emilia';   // 11. Dąbrowska Emilia
const ZOFIA = 'st_winiewska_zofia';    // 15. Wiśniewska Zofia
const OLIWIA = 'st_kaczmarek_oliwia';  // 19. Kaczmarek Oliwia
const KAROLINA = 'st_szymaska_karolina'; // 14. Szymańska Karolina — bez uwag w seedach

test('[3.1.2] ocena dla ucznia z potwierdzoną nieobecnością jest blokowana, chyba że wpis jest „do uzupełnienia”', async () => {
  const c = await S.as('j.nowak');
  const entry = { studentId: TOMASZ, subjectId: 'mat', categoryId: 'cat_spr', value: '4', date: '2026-09-25', lessonId: 'les_tt_7b_5_1_2026-09-25' };
  const nb = S.db.col('attendance').find((a) => a.lessonId === entry.lessonId && a.studentId === TOMASZ);
  assert.equal(nb.status, 'nb');

  const blocked = await c.post('/api/grades', entry);
  assert.equal(blocked.status, 409);
  assert.equal(blocked.body.code, 'absent_blocked');
  assert.match(blocked.body.error, /nieobecność \(nb\)/);
  assert.match(blocked.body.error, /do uzupełnienia/);
  assert.equal(S.db.col('grades').filter((g) => g.studentId === TOMASZ && g.date === '2026-09-25' && !g.deleted).length, 0);

  const ok = expectOk(await c.post('/api/grades', Object.assign({ makeup: true }, entry)));
  assert.equal(ok.grade.value, '4');
  assert.equal(ok.grade.makeup, true);
  assert.equal(ok.grade.weight, 3);

  // uczeń obecny na tej samej lekcji — wpis przechodzi bez „do uzupełnienia”
  const present = expectOk(await c.post('/api/grades', Object.assign({}, entry, { studentId: ANNA, value: '5' })));
  assert.equal(present.grade.makeup, false);

  // blokady nie da się ominąć pominięciem identyfikatora lekcji — liczy się nieobecność
  // z tego przedmiotu tego dnia
  const noLesson = Object.assign({}, entry, { value: '3' }); delete noLesson.lessonId;
  const stillBlocked = await c.post('/api/grades', noLesson);
  assert.equal(stillBlocked.status, 409);
  assert.equal(stillBlocked.body.code, 'absent_blocked');
  assert.equal(S.db.col('grades').filter((g) => g.studentId === TOMASZ && g.date === '2026-09-25' && !g.deleted && !g.makeup).length, 0);
});

test('[3.1.4] kategoria ocen z wagą 1–10, kolorem cat-1..8 i domyślnym wliczaniem do średniej', async () => {
  const c = await S.as('j.nowak');
  const badWeight = await c.post('/api/grade-categories', { name: 'Praca w grupach', weight: 11, color: 'cat-3' });
  assert.equal(badWeight.status, 400); assert.equal(badWeight.body.code, 'bad_weight');
  assert.equal((await c.post('/api/grade-categories', { name: 'Praca w grupach', weight: 0, color: 'cat-3' })).status, 400);
  const badColor = await c.post('/api/grade-categories', { name: 'Praca w grupach', weight: 2, color: 'cat-9' });
  assert.equal(badColor.status, 400); assert.equal(badColor.body.code, 'bad_color');

  const created = expectOk(await c.post('/api/grade-categories', { name: 'Praca w grupach', weight: 2, color: 'cat-3', countsInAverage: false, subjectId: 'mat' }));
  assert.equal(created.category.weight, 2);
  assert.equal(created.category.color, 'cat-3');
  assert.equal(created.category.colorNo, 3);
  assert.equal(created.category.countsInAverage, false);
  const catId = created.category.id;
  const list = expectOk(await c.get('/api/grade-categories?subjectId=mat'));
  assert.ok(list.categories.some((x) => x.id === catId));
  assert.ok(S.db.col('audit').some((a) => a.action === 'grade_category_create' && a.entityId === catId));

  // domyślny parametr działa: ocena w tej kategorii nie zmienia średniej ważonej
  const before = expectOk(await c.get('/api/grades/student/' + EMILIA + '?subjectId=mat')).average;
  assert.equal(before, 4.84);
  const g = expectOk(await c.post('/api/grades', { studentId: EMILIA, subjectId: 'mat', categoryId: catId, value: '1', date: '2026-10-20' }));
  assert.equal(g.grade.weight, 2);
  assert.equal(g.grade.countsInAverage, false);
  assert.equal(g.average, before);

  // [P27] sama zmiana wagi kategorii nie rusza ocen już wystawionych — zostają przy swojej wadze
  const keep = expectOk(await c.patch('/api/grade-categories/' + catId, { weight: 7, countsInAverage: true }));
  assert.equal(keep.category.weight, 7);
  assert.equal(keep.recalculated, false);
  assert.deepEqual(keep.gradeIds, [g.grade.id]);
  assert.match(keep.message, /przelicz istniejące/);
  assert.equal(S.db.get('grades', g.grade.id).weight, 2, 'ocena zachowuje wagę, z jaką ją wystawiono');
  assert.equal(expectOk(await c.get('/api/grades/student/' + EMILIA + '?subjectId=mat')).average, before);
  const catAudit = S.db.col('audit').filter((a) => a.action === 'grade_category_update' && a.entityId === catId).pop();
  assert.deepEqual(catAudit.after.gradeIds, [g.grade.id]);
  assert.ok(catAudit.before.classAverages && catAudit.after.classAverages, 'wpis audytu niesie średnie klasy przed i po');

  // [P27] dopiero „przelicz istniejące” zmienia oceny — każda z własnym wpisem w rejestrze zmian
  const upd = expectOk(await c.patch('/api/grade-categories/' + catId, { weight: 7, countsInAverage: true, recalculate: true, reason: 'Ujednolicenie wag po zmianie WSO' }));
  assert.equal(upd.category.weight, 7);
  assert.equal(upd.recalculated, true);
  assert.equal(S.db.get('grades', g.grade.id).weight, 7);
  const gradeAudit = S.db.col('audit').filter((a) => a.action === 'grade_update' && a.entityId === g.grade.id).pop();
  assert.equal(gradeAudit.before.weight, 2);
  assert.equal(gradeAudit.after.weight, 7);
  assert.match(gradeAudit.reason, /Ujednolicenie wag/);
  const after = expectOk(await c.get('/api/grades/student/' + EMILIA + '?subjectId=mat'));
  assert.equal(after.average, 3.35); // (4,84 · 11 + 1 · 7) / 18 — ocena 1 weszła do średniej
  const recalcAudit = S.db.col('audit').filter((a) => a.action === 'grade_category_update' && a.entityId === catId).pop();
  assert.equal(recalcAudit.after.recalculated, true);
  assert.notDeepEqual(recalcAudit.before.classAverages, recalcAudit.after.classAverages, 'średnie klasy przed i po przeliczeniu są różne');
  expectOk(await c.delete('/api/grades/' + g.grade.id, { reason: 'Kategoria testowa — wpis do usunięcia' }));
  expectOk(await c.delete('/api/grade-categories/' + catId, { reason: 'Kategoria testowa' }));
  assert.equal(expectOk(await c.get('/api/grades/student/' + EMILIA + '?subjectId=mat')).average, 4.84);
});

test('[3.1.5] plus i minus przeliczane wg config.plusMinus w średniej ważonej', async () => {
  const c = await S.as('a.wojcik');
  assert.deepEqual(S.db.data.config.plusMinus, { plus: 0.5, minus: -0.25 });
  // 15.10 Filip ma nb z fizyki, więc wpis wymaga oznaczenia „do uzupełnienia” (3.1.2)
  const a = expectOk(await c.post('/api/grades', { studentId: FILIP, subjectId: 'fiz', categoryId: 'cat_spr', value: '4+', date: '2026-10-15', makeup: true }));
  assert.equal(a.grade.weight, 3);
  assert.equal(a.numericValue, 4.5);
  assert.equal(a.average, 4.5);
  const b = expectOk(await c.post('/api/grades', { studentId: FILIP, subjectId: 'fiz', categoryId: 'cat_zd', value: '3', date: '2026-10-16' }));
  assert.equal(b.grade.weight, 1);
  assert.equal(b.average, 4.13); // (4,5 · 3 + 3 · 1) / 4 = 4,125
  const d = expectOk(await c.post('/api/grades', { studentId: FILIP, subjectId: 'fiz', categoryId: 'cat_odp', value: '5-', date: '2026-10-19' }));
  assert.equal(d.numericValue, 4.75);
  assert.equal(d.average, 4.33); // (13,5 + 3 + 9,5) / 6 = 4,333…
  assert.equal((await c.post('/api/grades', { studentId: FILIP, subjectId: 'fiz', categoryId: 'cat_zd', value: '7' })).status, 400);
});

test('[3.1.6] tryb punktowy: punkty → procent → ocena wg config.percentScale', async () => {
  const c = await S.as('e.krol');
  const r = expectOk(await c.post('/api/grades', { studentId: FILIP, subjectId: 'ang', categoryId: 'cat_spr', points: 19, maxPoints: 25, date: '2026-10-22' }));
  assert.equal(r.percent, 76);
  assert.equal(r.suggestedGrade, 4);
  assert.equal(r.grade.value, '4');
  assert.equal(r.grade.points, 19);
  assert.equal(r.grade.maxPoints, 25);
  assert.equal(r.average, 4);

  // nauczyciel może nadpisać podpowiedź własną oceną
  const r2 = expectOk(await c.post('/api/grades', { studentId: KAROLINA, subjectId: 'ang', categoryId: 'cat_kart', points: 24, maxPoints: 25, value: '5+', date: '2026-10-22' }));
  assert.equal(r2.percent, 96);
  assert.equal(r2.suggestedGrade, 6);
  assert.equal(r2.grade.value, '5+');

  const low = expectOk(await c.post('/api/grades', { studentId: KAROLINA, subjectId: 'ang', categoryId: 'cat_zd', points: 7, maxPoints: 25, date: '2026-10-22' }));
  assert.equal(low.percent, 28);
  assert.equal(low.suggestedGrade, 1);
  assert.equal((await c.post('/api/grades', { studentId: FILIP, subjectId: 'ang', categoryId: 'cat_spr', points: 30, maxPoints: 25 })).status, 400);
});

test('[3.1.7] np i bz poza średnią, ale widoczne w statystykach', async () => {
  const c = await S.as('b.sikora');
  const base = expectOk(await c.post('/api/grades', { studentId: FILIP, subjectId: 'pol', categoryId: 'cat_kart', value: '4', date: '2026-10-02' }));
  assert.equal(base.average, 4);
  const np = expectOk(await c.post('/api/grades', { studentId: FILIP, subjectId: 'pol', categoryId: 'cat_odp', value: 'np', date: '2026-10-09' }));
  assert.equal(np.grade.value, 'np');
  assert.equal(np.grade.countsInAverage, false);
  assert.equal(np.numericValue, null);
  assert.equal(np.average, 4);
  const bz = expectOk(await c.post('/api/grades', { studentId: FILIP, subjectId: 'pol', categoryId: 'cat_zd', value: 'bz', date: '2026-10-13' }));
  assert.equal(bz.average, 4);

  const st = expectOk(await c.get('/api/grades/statistics?classId=7b&subjectId=pol&semester=1'));
  const row = st.students.find((x) => x.studentId === FILIP);
  assert.equal(row.entries, 3);
  assert.equal(row.count, 1);
  assert.equal(row.average, 4);
  assert.equal(row.np, 1);
  assert.equal(row.bz, 1);
  assert.ok(st.npCount >= 2, 'np z seeda i z testu'); // 16. Szymański Tomasz ma np z polskiego 02.10.2026
  assert.equal(st.bzCount, 1);
  assert.ok(st.total > st.students.reduce((a, x) => a + x.count, 0), 'np i bz liczą się do liczby wpisów, nie do średniej');
});

test('[3.1.8] poprawa: obie oceny widoczne, średnia wg config.retakeRule', async () => {
  const cfg = S.db.data.config;
  const c = await S.as('j.nowak'); const g = await S.as('t.gorski');
  const orig = expectOk(await c.post('/api/grades', { studentId: FILIP, subjectId: 'mat', categoryId: 'cat_spr', value: '2', date: '2026-10-09' }));
  const retake = expectOk(await c.post('/api/grades', { studentId: FILIP, subjectId: 'mat', categoryId: 'cat_spr', value: '5', date: '2026-10-14', retakeOfId: orig.grade.id, comment: 'Poprawa po konsultacjach.' }));
  assert.equal(retake.grade.retakeOfId, orig.grade.id);
  // nieudana poprawa u innego ucznia: 4 → 2
  const oA = expectOk(await g.post('/api/grades', { studentId: OLIWIA, subjectId: 'che', categoryId: 'cat_spr', value: '4', date: '2026-10-09' }));
  expectOk(await g.post('/api/grades', { studentId: OLIWIA, subjectId: 'che', categoryId: 'cat_spr', value: '2', date: '2026-10-14', retakeOfId: oA.grade.id }));

  const avg = async (sid, sub) => expectOk(await c.get(`/api/grades/student/${sid}?subjectId=${sub}`)).average;
  assert.equal(cfg.retakeRule, 'higher');
  assert.equal(await avg(FILIP, 'mat'), 5);      // liczy się wyższa: poprawa 5
  assert.equal(await avg(OLIWIA, 'che'), 4);     // liczy się wyższa: ocena pierwotna 4
  cfg.retakeRule = 'average';
  assert.equal(await avg(FILIP, 'mat'), 3.5);    // (2 + 5) / 2
  assert.equal(await avg(OLIWIA, 'che'), 3);     // (4 + 2) / 2
  cfg.retakeRule = 'regulation';
  assert.equal(await avg(FILIP, 'mat'), 5);      // poprawa zastępuje ocenę pierwotną
  assert.equal(await avg(OLIWIA, 'che'), 2);
  cfg.retakeRule = 'higher';

  // obie wartości widoczne w siatce: komórka pierwotna pokazuje „2 → 5”, kolumna poprawy poza średnią
  const grid = expectOk(await c.get('/api/grades/grid?classId=7b&subjectId=mat&semester=1'));
  assert.equal(grid.retakeRule, 'higher');
  const row = grid.students.find((x) => x.studentId === FILIP);
  assert.deepEqual(row.grades['col_cat_spr_2026-10-09'].retake, { from: '2', to: '5' });
  assert.equal(row.grades['col_p_cat_spr_2026-10-14'].value, '5');
  assert.equal(grid.columns.find((x) => x.id === 'col_p_cat_spr_2026-10-14').excluded, true);
  assert.equal(row.average, 5);
});

test('[3.1.9] wpis seryjny dla grupy laboratoryjnej z wynikiem dla każdego wiersza', async () => {
  const c = await S.as('t.gorski');
  const group = S.db.get('groups', 'g_lab_che');
  const values = ['5', '4+', '3', 'np', '7', '2'];
  const entries = group.studentIds.map((sid, i) => ({ studentId: sid, value: values[i] }));
  entries.push({ studentId: KAROLINA, value: '' }); // pusta komórka — pomijana
  const r = expectOk(await c.post('/api/grades/bulk', { subjectId: 'che', classId: '7b', categoryId: 'cat_lab', date: '2026-10-21', entries }));

  assert.equal(r.results.length, 7);
  assert.deepEqual(r.results.map((x) => x.studentId), entries.map((e) => e.studentId), 'kolejność wierszy zachowana');
  assert.deepEqual(r.results.map((x) => x.index), [0, 1, 2, 3, 4, 5, 6]);
  assert.equal(r.saved, 5);
  assert.equal(r.failed, 1);
  assert.equal(r.skipped, 1);
  assert.equal(r.results[0].value, '5');
  assert.equal(r.results[1].value, '4+');
  assert.equal(r.results[3].value, 'np');
  assert.equal(r.results[4].ok, false);
  assert.equal(r.results[4].status, 400);
  assert.equal(r.results[4].code, 'bad_value');
  assert.equal(r.results[6].skipped, true);
  assert.match(r.message, /Zapisano 5 ocen z 7\./);
  // wagi z kategorii laboratorium (2) i średnia pierwszego ucznia
  const first = S.db.col('grades').find((x) => x.id === r.results[0].gradeId);
  assert.equal(first.weight, 2);
  assert.equal(first.categoryName, 'laboratorium');
  assert.equal(r.results[1].average, 4.5);

  /* Druga połowa historyjki jest po stronie klienta: klawiatura numeryczna i Enter przechodzący
     do następnego ucznia. Sam POST /api/grades/bulk tego nie pokazuje. */
  const fs = require('node:fs'); const path = require('node:path');
  const screen = fs.readFileSync(path.join(__dirname, '..', 'public', 'app', 'screens', 'teacher-grades.js'), 'utf8');
  assert.match(screen, /var b1 = React\.useState\(false\), bulk = b1\[0\]/, 'ekran ocen ma tryb wpisywania seryjnego');
  const at = screen.indexOf('if (advance && bulk) {');
  assert.ok(at > 0, 'po zapisie w trybie seryjnym ekran przechodzi dalej');
  const advance = screen.slice(at, at + 600);
  assert.match(advance, /students\[\(idx \+ 1\) % students\.length\]/, 'kursor idzie do NASTĘPNEGO ucznia z listy (z zawijaniem)');
  assert.match(advance, /setEd\(\{ studentId: next\.studentId/, 'aktywny wiersz zmienia się na następnego ucznia');
  assert.match(advance, /focusGradeInput\(\)/, 'fokus wraca do pola oceny bez dotykania myszy');
  assert.match(screen, /function focusGradeInput\(\)[\s\S]{0,200}el\.focus\(\)/, 'focusGradeInput naprawdę ustawia fokus');
  assert.match(screen, /'tg\.editor\.bulk'/, 'przełącznik trybu seryjnego jest opisany dla użytkownika');
  const bundle = fs.readFileSync(path.join(__dirname, '..', 'public', 'edmat', 'bundle.js'), 'utf8');
  const gi = bundle.slice(bundle.indexOf('function GradeInput'), bundle.indexOf('function GradeInput') + 2000);
  assert.ok(gi.startsWith('function GradeInput'), 'pakiet EdMat ma komponent GradeInput');
  assert.match(gi, /inputMode: '(numeric|decimal)'/, 'pole oceny otwiera klawiaturę numeryczną');
  assert.match(gi, /'Enter'/, 'Enter zatwierdza wpis w polu oceny');
});

test('[3.1.10] komentarz do oceny widoczny dla rodzica i ucznia', async () => {
  const c = await S.as('j.nowak');
  const TEXT = 'Błąd w zadaniu 4: pomyłka w rzędzie wielkości przy zamianie jednostek. Do poprawy: zamiana m² na cm².';
  const g = expectOk(await c.post('/api/grades', { studentId: ANNA, subjectId: 'mat', categoryId: 'cat_kart', value: '4', date: '2026-10-20', comment: TEXT }));
  assert.equal(g.grade.comment, TEXT);

  for (const login of ['rodzic.kowalczyk', 'anna.kowalczyk']) {
    const u = await S.as(login);
    const v = expectOk(await u.get('/api/grades/student/' + ANNA + '?subjectId=mat'));
    const seen = v.grades.find((x) => x.id === g.grade.id);
    assert.equal(seen.comment, TEXT);
    assert.equal(seen.weight, 2);
    assert.equal(seen.teacher, 'mgr Joanna Nowak');
    // komentarz z seeda też jest widoczny
    assert.ok(v.grades.some((x) => /zamianie jednostek/.test(x.comment || '')));
  }
  const other = await S.as('rodzic.nowak');
  assert.equal((await other.get('/api/grades/student/' + ANNA)).status, 403);
});

test('[3.1.11] cofnięcie i zmiana kategorii wymagają powodu i trafiają do rejestru zmian', async () => {
  const c = await S.as('j.nowak');
  const g = expectOk(await c.post('/api/grades', { studentId: ZOFIA, subjectId: 'mat', categoryId: 'cat_kart', value: '3', date: '2026-10-20' }));
  assert.equal(g.grade.weight, 2);

  assert.equal((await c.patch('/api/grades/' + g.grade.id, { categoryId: 'cat_spr' })).status, 400);
  const REASON = 'Praca była sprawdzianem działowym, nie kartkówką';
  const upd = expectOk(await c.patch('/api/grades/' + g.grade.id, { categoryId: 'cat_spr', reason: REASON }));
  assert.equal(upd.grade.categoryName, 'sprawdzian');
  assert.equal(upd.grade.weight, 3);
  assert.equal(upd.before.weight, 2);
  const a1 = S.db.col('audit').find((a) => a.action === 'grade_update' && a.entityId === g.grade.id);
  assert.equal(a1.before.categoryName, 'kartkówka');
  assert.equal(a1.before.weight, 2);
  assert.equal(a1.after.weight, 3);
  assert.equal(a1.reason, REASON);
  assert.equal(a1.userId, 'u_nowak');

  const noReason = await c.delete('/api/grades/' + g.grade.id, {});
  assert.equal(noReason.status, 400); assert.equal(noReason.body.code, 'reason_required');
  const del = expectOk(await c.delete('/api/grades/' + g.grade.id, { reason: 'Wpis w wierszu innego ucznia' }));
  assert.equal(del.reverted.value, '3');
  const a2 = S.db.col('audit').find((a) => a.action === 'grade_revert' && a.entityId === g.grade.id);
  assert.equal(a2.before.value, '3');
  assert.equal(a2.after.deleted, true);
  assert.equal(a2.reason, 'Wpis w wierszu innego ucznia');
  assert.equal(S.db.get('grades', g.grade.id).deleted, true, 'wpis nigdy nie znika z bazy');
  const list = expectOk(await c.get('/api/grades/student/' + ZOFIA + '?subjectId=mat'));
  assert.ok(!list.grades.some((x) => x.id === g.grade.id));
});

test('[3.1.16] ocena opisowa klas 1–3 wg obszarów rozwoju z banku zwrotów', async () => {
  const c = await S.as('i.kaczmarek');
  const bank = expectOk(await c.get('/api/phrase-bank'));
  const AREA = 'Edukacja matematyczna';
  const phrases = bank.areas.find((a) => a.area === AREA).phrases;
  assert.equal(phrases.length, 2);
  const student = S.db.data.classes.find((x) => x.id === '1a').studentIds[0];

  const r = expectOk(await c.post('/api/descriptive-grades', { studentId: student, semester: 1, area: AREA, phraseIds: phrases.map((p) => p.id), text: 'Chętnie liczy w pamięci i tłumaczy sposób obliczeń.' }));
  assert.match(r.descriptive.text, /Dodaje i odejmuje w zakresie 20/);
  assert.match(r.descriptive.text, /Rozwiązuje proste zadania tekstowe\./);
  assert.match(r.descriptive.text, /Chętnie liczy w pamięci/);
  assert.deepEqual(r.descriptive.phraseIds, phrases.map((p) => p.id));
  assert.equal(r.descriptive.area, AREA);
  assert.equal(r.filled, 1);
  assert.equal(r.total, S.db.data.developmentAreas.length);

  const wrongArea = await c.post('/api/descriptive-grades', { studentId: student, semester: 1, area: 'Edukacja polonistyczna', phraseIds: [phrases[0].id] });
  assert.equal(wrongArea.status, 400);
  const notEarly = await c.post('/api/descriptive-grades', { studentId: ANNA, semester: 1, area: AREA, phraseIds: [phrases[0].id] });
  assert.equal(notEarly.status, 400); assert.equal(notEarly.body.code, 'not_early_education');

  const list = expectOk(await c.get('/api/descriptive-grades?classId=1a&semester=1'));
  assert.equal(list.descriptive.length, 1);
  assert.equal(list.descriptive[0].studentId, student);
  assert.ok(S.db.col('audit').some((a) => a.action === 'descriptive_grade_create'));
});

test('[3.1.20] wydruk wykazu ocen i frekwencji ucznia na spotkanie z rodzicem', async () => {
  const c = await S.as('j.nowak');
  const r = await c.get('/api/grades/record/' + ANNA + '?subjectId=mat&semester=1');
  assert.equal(r.status, 200);
  assert.match(r.headers.get('content-type'), /text\/html/);
  assert.equal(r.headers.get('content-disposition'), 'inline');
  assert.match(r.body, /@page/);
  assert.match(r.body, /Wykaz ocen i frekwencji/);
  assert.match(r.body, /Kowalczyk Anna/);
  assert.match(r.body, /Matematyka/);
  assert.match(r.body, /Średnia ważona/);
  assert.match(r.body, /zamianie jednostek/);   // komentarz nauczyciela
  assert.match(r.body, /frekwencja/);
  assert.match(r.body, /Rodzic \/ opiekun prawny/);
  assert.match(r.body, /RODO/);
  assert.ok(S.db.col('audit').some((a) => a.action === 'grades_record_print' && a.entityId === ANNA));
  const other = await S.as('rodzic.nowak');
  assert.equal((await other.get('/api/grades/record/' + ANNA)).status, 403);
});

test('[3.1.21] ocena proponowana w terminie z powiadomieniem rodzica i ucznia', async () => {
  const c = await S.as('j.nowak');
  S.db.data.config.today = '2026-12-01';   // [P26] w oknie 30 dni przed terminem 12.12.2026
  const before = S.db.col('notifications').length;
  const r = expectOk(await c.post('/api/grades/proposed', { studentId: ANNA, subjectId: 'mat', value: '4', semester: 1 }));
  assert.equal(r.grade.kind, 'proposedMid');
  assert.equal(r.grade.countsInAverage, false);
  assert.equal(r.deadline, '2026-12-12');
  const fresh = S.db.col('notifications').slice(before);
  for (const uid of ['u_' + ANNA, 'u_p_kowalczyk', 'u_p_kowalczyk2']) {
    const n = fresh.find((x) => x.userId === uid);
    assert.ok(n, 'powiadomienie dla ' + uid);
    assert.match(n.text, /Ocena proponowana śródroczna z przedmiotu matematyka: 4/);
  }
  assert.deepEqual(r.notified.sort(), ['u_' + ANNA, 'u_p_kowalczyk', 'u_p_kowalczyk2'].sort());
  const msg = S.db.get('messages', r.messageId);
  assert.ok(msg.toUserIds.includes('u_p_kowalczyk'));
  assert.match(msg.body, /12\.12\.2026/);

  const s = await S.as('anna.kowalczyk');
  assert.equal(expectOk(await s.get('/api/grades/student/' + ANNA + '?subjectId=mat')).proposed, '4');

  // [P26] poza oknem — we wrześniu i październiku propozycji jeszcze nie ma
  S.db.data.config.today = S.TODAY;        // 23.10.2026, 50 dni przed terminem
  const early = await c.post('/api/grades/proposed', { studentId: EMILIA, subjectId: 'mat', value: '5', semester: 1 });
  assert.equal(early.status, 403);
  assert.equal(early.body.code, 'proposal_window');
  assert.equal(early.body.from, '2026-11-12');
  assert.match(early.body.error, /12\.11\.2026/);

  S.db.data.config.today = '2026-12-13';
  const late = await c.post('/api/grades/proposed', { studentId: EMILIA, subjectId: 'mat', value: '5', semester: 1 });
  assert.equal(late.status, 403);
  assert.equal(late.body.code, 'proposed_deadline');
  assert.match(late.body.error, /12\.12\.2026/);
  S.db.data.config.today = S.TODAY;
});

test('[3.1.22] edycja ocen cząstkowych zablokowana po zamknięciu klasyfikacji', async () => {
  const c = await S.as('j.nowak');
  const entry = { studentId: 'st_nowak_jan', subjectId: 'mat', categoryId: 'cat_zd', value: '4', date: '2026-10-20' };
  const ok = expectOk(await c.post('/api/grades', entry));

  S.db.col('semesterLocks').push({ id: 'g_lock_t', semester: 1, classId: '7b', byUserId: 'u_dyrektor', at: '2026-10-23T10:00:00Z', reopened: false, reason: 'Klasyfikacja śródroczna zamknięta uchwałą rady pedagogicznej' });
  const blocked = await c.post('/api/grades', entry);
  assert.equal(blocked.status, 403);
  assert.equal(blocked.body.code, 'semester_locked');
  assert.match(blocked.body.error, /zamknięta/);
  assert.equal((await c.patch('/api/grades/' + ok.grade.id, { value: '5', reason: 'korekta po terminie' })).status, 403);
  assert.equal((await c.delete('/api/grades/' + ok.grade.id, { reason: 'korekta po terminie' })).status, 403);

  S.db.col('semesterLocks').find((l) => l.id === 'g_lock_t').reopened = true;   // dyrekcja odblokowała semestr
  assert.equal((await c.post('/api/grades', entry)).status, 200);

  S.db.data.config.today = '2027-01-27';   // po terminie klasyfikacji 26.01.2027
  const late = await c.post('/api/grades', Object.assign({}, entry, { date: '2027-01-27' }));
  assert.equal(late.status, 403);
  assert.equal(late.body.code, 'classification_deadline');
  assert.match(late.body.error, /26\.01\.2027/);
  S.db.data.config.today = S.TODAY;
  const locks = S.db.col('semesterLocks'); locks.splice(locks.findIndex((l) => l.id === 'g_lock_t'), 1);
  assert.equal((await c.post('/api/grades', entry)).status, 200);
});

test('[3.1.23] uwaga pozytywna i negatywna zmienia punkty zachowania wg zasad szkoły', async () => {
  const c = await S.as('j.nowak');
  const p0 = expectOk(await c.get('/api/remarks/points/' + KAROLINA));
  assert.equal(p0.start, 100);
  assert.equal(p0.total, 100);
  assert.equal(p0.grade, 'dobre');

  const neg = expectOk(await c.post('/api/remarks', { studentId: KAROLINA, kind: 'negative', text: 'Korzystała z telefonu podczas lekcji mimo upomnienia.', points: 5, date: '2026-10-20' }));
  assert.equal(neg.applied, -5);
  assert.equal(neg.points.total, 95);
  assert.equal(neg.points.grade, 'poprawne');
  assert.equal(neg.remark.kindLabel, 'uwaga');

  const pos = expectOk(await c.post('/api/remarks', { studentId: KAROLINA, kind: 'positive', text: 'Przygotowała i poprowadziła apel z okazji Dnia Edukacji Narodowej.', points: 50, date: '2026-10-21' }));
  assert.equal(pos.applied, 50);
  assert.equal(pos.points.total, 145);
  assert.equal(pos.points.grade, 'bardzo dobre');

  const neu = expectOk(await c.post('/api/remarks', { studentId: KAROLINA, kind: 'neutral', text: 'Przyniosła zwolnienie z zajęć wychowania fizycznego.', points: 20, date: '2026-10-22' }));
  assert.equal(neu.applied, 0, 'wpis informacyjny nie zmienia punktów');
  assert.equal(neu.points.total, 145);
  assert.equal(S.db.get('students', KAROLINA).behaviorPoints, 145);

  assert.equal((await c.post('/api/remarks', { studentId: KAROLINA, kind: 'negative', text: 'Zbyt duża kara.', points: 80 })).status, 400);
  assert.equal((await c.post('/api/remarks', { studentId: KAROLINA, kind: 'positive', text: 'ok' })).status, 400);

  const list = expectOk(await c.get('/api/remarks?classId=7b'));
  assert.equal(list.remarks.filter((x) => x.studentId === KAROLINA).length, 3);
  assert.equal(list.students.find((x) => x.studentId === KAROLINA).total, 145);
  assert.equal(list.students.find((x) => x.studentId === KAROLINA).positive, 1);
  const kacper = list.students.find((x) => x.studentId === 'st_zieliski_kacper');
  const kacperRemarks = list.remarks.filter((x) => x.studentId === 'st_zieliski_kacper');
  assert.ok(kacperRemarks.some((x) => x.id === 'g_rem_2' && x.points === -10), 'uwaga z dziennika: −10 pkt');
  assert.equal(kacper.total, 100 + kacperRemarks.reduce((a, x) => a + x.points, 0));
  assert.ok(kacper.total <= 90);
  assert.ok(S.db.col('audit').some((a) => a.action === 'remark_create'));

  const single = expectOk(await c.get('/api/remarks?studentId=' + KAROLINA));
  assert.equal(single.remarks.length, 3);
  const foreign = await S.as('i.kaczmarek');    // nauczycielka klasy 1a nie uczy w 7b
  assert.equal((await foreign.post('/api/remarks', { studentId: KAROLINA, kind: 'negative', text: 'Brak podstawy do wpisu.' })).status, 403);
  const parent = await S.as('rodzic.nowak');
  assert.equal((await parent.get('/api/remarks?studentId=' + KAROLINA)).status, 403);
});

test('[3.1.24] eksport ocen cząstkowych i frekwencji do arkusza, z anonimizacją', async () => {
  const c = await S.as('j.nowak');
  const plain = await c.get('/api/grades/export.csv?classId=7b&subjectId=mat&semester=1');
  assert.equal(plain.status, 200);
  assert.match(plain.headers.get('content-type'), /text\/csv/);
  assert.match(plain.headers.get('content-disposition'), /oceny-7b-mat-sem1\.csv/);
  const bytes = Buffer.from(await (await fetch(S.base + '/api/grades/export.csv?classId=7b&subjectId=mat&semester=1', { headers: { Cookie: c.cookie } })).arrayBuffer());
  assert.deepEqual([...bytes.slice(0, 3)], [0xEF, 0xBB, 0xBF], 'CSV w UTF-8 z BOM');
  assert.ok(plain.body.includes(';'), 'separator średnik');
  assert.match(plain.body, /Kowalczyk Anna/);
  assert.match(plain.body, /Frekwencja %/);
  assert.match(plain.body, /Średnia ważona/);

  const anon = await c.get('/api/grades/export.csv?classId=7b&subjectId=mat&semester=1&anonymize=1');
  assert.equal(anon.status, 200);
  assert.equal(anon.body.split('\r\n')[0].replace('\uFEFF', ''), 'Dane zanonimizowane');
  assert.ok(!/Kowalczyk/.test(anon.body), 'brak nazwisk w eksporcie zanonimizowanym');
  assert.ok(!/Szymańska/.test(anon.body));
  assert.match(anon.body, /uczeń nr 7/);
  assert.match(anon.body, /Identyfikator/);
  assert.match(anon.headers.get('content-disposition'), /oceny-7b-mat-sem1-anon\.csv/);
  const dataRows = anon.body.split('\r\n').filter((l) => /^\d+;/.test(l));
  assert.ok(dataRows.length > 12);
  assert.ok(S.db.col('audit').some((a) => a.action === 'grades_export' && a.after.anonymized === true));
});

/* --- przegląd pedagogiczny (docs/review/pedagogy.md) ------------------------------------- */

test('[3.1.7] limit nieprzygotowań w semestrze: trzecie np z przedmiotu jest odrzucane', async () => {
  const c = await S.as('e.krol');
  const base = { studentId: EMILIA, subjectId: 'ang', categoryId: 'cat_odp', value: 'np' };
  expectOk(await c.post('/api/grades', Object.assign({}, base, { date: '2026-10-05' })));
  expectOk(await c.post('/api/grades', Object.assign({}, base, { date: '2026-10-12' })));
  const third = await c.post('/api/grades', Object.assign({}, base, { date: '2026-10-19' }));
  assert.equal(third.status, 409);
  assert.equal(third.body.code, 'np_limit');
  assert.equal(third.body.limit, 2);
  assert.equal(third.body.used, 2);
  assert.match(third.body.error, /limit 2/);
  // „bz” ma własną pulę, a inny przedmiot liczy się osobno
  expectOk(await c.post('/api/grades', Object.assign({}, base, { value: 'bz', date: '2026-10-19' })));
  const st = expectOk(await c.get('/api/grades/statistics?classId=7b&subjectId=ang&semester=1'));
  assert.equal(st.npLimit, 2);
  const row = st.students.find((x) => x.studentId === EMILIA);
  assert.equal(row.np, 2); assert.equal(row.npLeft, 0); assert.equal(row.bzLeft, 1);
});

test('[3.1.8] druga poprawa tej samej pracy jest odrzucana, bo liczyłaby się podwójnie', async () => {
  const c = await S.as('t.gorski');   // 14. Szymańska Karolina nie ma jeszcze ocen z chemii
  const orig = expectOk(await c.post('/api/grades', { studentId: KAROLINA, subjectId: 'che', categoryId: 'cat_spr', value: '2', date: '2026-10-05' }));
  const first = expectOk(await c.post('/api/grades', { studentId: KAROLINA, subjectId: 'che', categoryId: 'cat_spr', value: '3', date: '2026-10-12', retakeOfId: orig.grade.id }));
  const second = await c.post('/api/grades', { studentId: KAROLINA, subjectId: 'che', categoryId: 'cat_spr', value: '5', date: '2026-10-19', retakeOfId: orig.grade.id });
  assert.equal(second.status, 409);
  assert.equal(second.body.code, 'retake_exists');
  assert.equal(second.body.retakeId, first.grade.id);
  assert.equal(expectOk(await c.get('/api/grades/student/' + KAROLINA + '?subjectId=che')).average, 3, 'przed poprawką: liczy się wyższa z pary');
  // po cofnięciu pierwszej poprawy kolejna przechodzi i liczy się tylko ona
  expectOk(await c.delete('/api/grades/' + first.grade.id, { reason: 'Praca oddana ponownie po konsultacjach' }));
  const again = expectOk(await c.post('/api/grades', { studentId: KAROLINA, subjectId: 'che', categoryId: 'cat_spr', value: '5', date: '2026-10-19', retakeOfId: orig.grade.id }));
  assert.equal(again.grade.retakeOfId, orig.grade.id);
  const view = expectOk(await c.get('/api/grades/student/' + KAROLINA + '?subjectId=che'));
  assert.equal(view.grades.filter((g) => !g.retakeOfId || g.id === again.grade.id).length, 2, 'obie wartości zostają w dzienniku');
  assert.equal(view.average, 5, 'w średniej liczy się tylko wyższa z pary, nie dwie poprawy');
});

test('[3.1.21] ocena klasyfikacyjna: pełne brzmienie, właściwy semestr, bez np i bez cyfr w klasach 1–3', async () => {
  const c = await S.as('j.nowak');
  S.db.data.config.today = '2026-12-01';   // [P26] okno wystawiania propozycji śródrocznych
  const plusMinus = await c.post('/api/grades/proposed', { studentId: ZOFIA, subjectId: 'mat', value: '4+', semester: 1 });
  assert.equal(plusMinus.status, 400);
  assert.equal(plusMinus.body.code, 'modifier_not_allowed');
  assert.match(plusMinus.body.error, /pełnym brzmieniu/);
  const np = await c.post('/api/grades/proposed', { studentId: ZOFIA, subjectId: 'mat', value: 'np', semester: 1 });
  assert.equal(np.status, 400); assert.equal(np.body.code, 'bad_classification_value');
  expectOk(await c.post('/api/grades/proposed', { studentId: ZOFIA, subjectId: 'mat', value: '4', semester: 1 }));
  S.db.data.config.today = S.TODAY;

  // nieznany rodzaj wpisu i rodzaj niezgodny z semestrem nie przechodzą
  const junk = await c.post('/api/grades', { studentId: ZOFIA, subjectId: 'mat', value: '4', kind: 'cokolwiek', semester: 1 });
  assert.equal(junk.status, 400); assert.equal(junk.body.code, 'bad_kind');
  const wrongSem = await c.post('/api/grades', { studentId: ZOFIA, subjectId: 'mat', value: '4', kind: 'final', semester: 1 });
  assert.equal(wrongSem.status, 400); assert.equal(wrongSem.body.code, 'kind_semester_mismatch');
  const wrongDate = await c.post('/api/grades', { studentId: ZOFIA, subjectId: 'mat', categoryId: 'cat_zd', value: '4', date: '2026-10-20', semester: 2 });
  assert.equal(wrongDate.status, 400); assert.equal(wrongDate.body.code, 'date_semester_mismatch');

  // ocena śródroczna z właściwym semestrem wchodzi i jest widoczna jako klasyfikacyjna
  const mid = expectOk(await c.post('/api/grades', { studentId: ZOFIA, subjectId: 'mat', value: '5', kind: 'midterm', semester: 1 }));
  assert.equal(mid.grade.kind, 'midterm');
  assert.equal(mid.grade.categoryName, 'ocena śródroczna');
  assert.equal(mid.grade.countsInAverage, false);
  // „nieklasyfikowany” i „zwolniony” to dopuszczalne wpisy klasyfikacyjne
  const nk = expectOk(await c.post('/api/grades', { studentId: FILIP, subjectId: 'mat', value: 'nk', kind: 'midterm', semester: 1 }));
  assert.equal(nk.grade.value, 'nk');
  const zw = expectOk(await (await S.as('a.mazur')).post('/api/grades', { studentId: FILIP, subjectId: 'wf', value: 'zw', kind: 'midterm', semester: 1 }));
  assert.equal(zw.grade.value, 'zw');

  // klasy 1–3: ocena klasyfikacyjna jest opisowa, cyfra nie przechodzi
  const k = await S.as('i.kaczmarek');
  const first = S.db.get('classes', '1a').studentIds[0];
  const digit = await k.post('/api/grades', { studentId: first, subjectId: 'edw', value: '5', kind: 'midterm', semester: 1 });
  assert.equal(digit.status, 400); assert.equal(digit.body.code, 'descriptive_required');
  expectOk(await k.post('/api/grades', { studentId: first, subjectId: 'edw', categoryId: 'cat_zd', value: '5', date: '2026-10-20' }));
});

test('[3.1.22] po terminie klasyfikacji ocenę po egzaminie poprawkowym wpisuje wyłącznie dyrektor, i to w semestrze odblokowanym', async () => {
  const c = await S.as('j.nowak'); const p = await S.as('dyrektor');
  const entry = { studentId: 'st_nowak_jan', subjectId: 'mat', categoryId: 'cat_zd', value: '3', date: '2026-10-20' };
  S.db.data.config.today = '2027-02-20';       // po 26.01.2027
  assert.equal((await c.post('/api/grades', entry)).status, 403);
  const principalBlocked = await p.post('/api/grades', entry);
  assert.equal(principalBlocked.status, 403, 'bez formalnego odblokowania także dyrektor nie wpisuje');
  assert.equal(principalBlocked.body.code, 'classification_deadline');
  assert.match(principalBlocked.body.error, /odblokowaniu semestru/);

  S.db.col('semesterLocks').push({ id: 'g_lock_reopen', semester: 1, classId: '7b', byUserId: 'u_dyrektor', at: '2027-01-26T10:00:00Z', reopened: true, reopenedBy: 'u_dyrektor', reason: 'Egzamin poprawkowy — uchwała rady pedagogicznej' });
  const ok = expectOk(await p.post('/api/grades', Object.assign({}, entry, { reason: 'Wynik egzaminu poprawkowego' })));
  assert.equal(ok.grade.value, '3');
  assert.equal((await c.post('/api/grades', entry)).status, 403, 'nauczyciel nadal nie wpisuje po terminie');
  assert.ok(S.db.col('audit').some((a) => a.action === 'grade_create' && a.entityId === ok.grade.id && a.userId === 'u_dyrektor'));
  const locks = S.db.col('semesterLocks'); locks.splice(locks.findIndex((l) => l.id === 'g_lock_reopen'), 1);
  S.db.data.config.today = S.TODAY;
});

test('[3.1.6] próg procentowy liczy się z dokładnego wyniku, nie z zaokrąglonego procentu', async () => {
  const c = await S.as('e.krol');
  const r = expectOk(await c.post('/api/grades', { studentId: KAROLINA, subjectId: 'ang', categoryId: 'cat_spr', points: 17.99, maxPoints: 20, date: '2026-10-21' }));
  assert.equal(r.percent, 90, 'na świadectwie pokazujemy zaokrąglone 90,0 %');
  assert.equal(r.suggestedGrade, 4, '89,95 % to jeszcze nie próg 90 % na piątkę');
  const exact = expectOk(await c.post('/api/grades', { studentId: KAROLINA, subjectId: 'ang', categoryId: 'cat_spr', points: 18, maxPoints: 20, date: '2026-10-22' }));
  assert.equal(exact.suggestedGrade, 5, 'dokładnie 90 % to piątka');
});

test('[P25] dzień z przerwy międzysemestralnej ma jeden semestr: odczyt patrzy wstecz, nowy wpis do przodu', async () => {
  const D = require('../server/lib/domain');
  const gap = '2027-02-05';                       // 30.01–14.02 nie należy do żadnego zakresu w konfiguracji
  assert.equal(S.db.data.config.semesters.some((s) => gap >= s.from && gap <= s.to), false);
  assert.equal(D.semesterOf(S.db, gap), 1, 'odczyt klasyfikacyjny: semestr, który właśnie się skończył');
  assert.equal(D.semesterOf(S.db, gap, 'entry'), 2, 'nowy wpis: semestr, który się zaczyna');
  assert.equal(D.semesterOf(S.db, '2026-08-20'), 1, 'wakacje przed rokiem szkolnym → pierwszy semestr');
  assert.equal(D.semesterOf(S.db, '2027-08-20'), 2, 'po zakończeniu roku → ostatni semestr');
  for (const d of ['2026-09-01', '2027-01-29', '2027-01-30', '2027-02-14', '2027-02-15', '2027-06-25'])
    assert.ok([1, 2].includes(D.semesterOf(S.db, d)), `data ${d} musi mieć semestr`);

  // konfiguracja z jednym semestrem nie wywraca się na gałęzi awaryjnej
  const one = { data: { config: { semesters: [{ id: 1, name: 'Rok', from: '2026-09-01', to: '2027-06-25' }] } } };
  assert.equal(D.semesterOf(one, '2027-07-10'), 1);
  assert.equal(D.semesterOf(one, '2026-08-01'), 1);

  // wpis z dnia przerwy trafia do semestru 2
  const c = await S.as('t.gorski');
  const g = expectOk(await c.post('/api/grades', { studentId: OLIWIA, subjectId: 'che', categoryId: 'cat_spr', value: '4', date: gap }));
  assert.equal(g.grade.semester, 2, 'ocena wystawiona w ferie należy do drugiego półrocza');
  expectOk(await c.delete('/api/grades/' + g.grade.id, { reason: 'Wpis testowy przerwy międzysemestralnej' }));

  const rem = expectOk(await c.post('/api/remarks', { studentId: OLIWIA, kind: 'neutral', text: 'Wpis z dnia przerwy międzysemestralnej.', date: gap }));
  assert.equal(rem.remark.semester, 2);
  expectOk(await c.delete('/api/remarks/' + rem.remark.id, { reason: 'Wpis testowy przerwy międzysemestralnej' }));
});

test('[P28] ocena klasyfikacyjna wskazuje propozycję, którą potwierdza, a widok pokazuje odstępstwo', async () => {
  const c = await S.as('a.wojcik');
  S.db.data.config.today = '2026-12-01';        // okno propozycji śródrocznych (P26)
  const prop = expectOk(await c.post('/api/grades/proposed', { studentId: OLIWIA, subjectId: 'fiz', value: '3', semester: 1 }));
  const mid = expectOk(await c.post('/api/grades', { studentId: OLIWIA, subjectId: 'fiz', value: '4', kind: 'midterm', semester: 1 }));
  assert.equal(mid.grade.proposedId, prop.grade.id, 'ocena śródroczna zapamiętuje propozycję, którą potwierdza');
  assert.equal(mid.classification.changedFromProposal, true);
  assert.equal(mid.classification.lowerThanProposal, false);

  const view = expectOk(await c.get('/api/grades/student/' + OLIWIA + '?subjectId=fiz'));
  assert.equal(view.final, '4');
  assert.equal(view.proposedId, prop.grade.id);
  assert.equal(view.changedFromProposal, true);

  // obniżenie względem propozycji jest widoczne osobno — statut wymaga uzasadnienia
  const prop2 = expectOk(await c.post('/api/grades/proposed', { studentId: KAROLINA, subjectId: 'fiz', value: '5', semester: 1 }));
  const mid2 = expectOk(await c.post('/api/grades', { studentId: KAROLINA, subjectId: 'fiz', value: '4', kind: 'midterm', semester: 1, reason: 'Wynik sprawdzianu poprawkowego' }));
  assert.equal(mid2.grade.proposedId, prop2.grade.id);
  assert.equal(mid2.classification.lowerThanProposal, true);

  const grid = expectOk(await c.get('/api/grades/grid?classId=7b&subjectId=fiz&semester=1'));
  const row = grid.students.find((r) => r.studentId === KAROLINA);
  assert.equal(row.changedFromProposal, true);
  assert.equal(row.lowerThanProposal, true);
  assert.equal(row.proposedValue, '5');
  const untouched = grid.students.find((r) => r.studentId === FILIP);
  assert.equal(untouched.changedFromProposal, null, 'bez oceny klasyfikacyjnej nie ma z czym porównywać');

  // wskazanie cudzej propozycji jest odrzucane
  const wrong = await c.post('/api/grades', { studentId: OLIWIA, subjectId: 'fiz', value: '5', kind: 'midterm', semester: 1, proposedId: prop2.grade.id });
  assert.equal(wrong.status, 400);
  assert.equal(wrong.body.code, 'bad_proposed');
  S.db.data.config.today = S.TODAY;
});

test('[P28] para propozycja → ocena śródroczna jest w danych demonstracyjnych', async () => {
  const pairs = S.db.col('grades').filter((g) => g.kind === 'midterm' && g.proposedId && !g.deleted);
  assert.ok(pairs.length >= 1, 'seed zawiera co najmniej jedną parę propozycja → ocena klasyfikacyjna');
  const changed = pairs.find((g) => { const p = S.db.get('grades', g.proposedId); return p && p.value !== g.value; });
  const kept = pairs.find((g) => { const p = S.db.get('grades', g.proposedId); return p && p.value === g.value; });
  assert.ok(changed && kept, 'demo pokazuje i ocenę zgodną z propozycją, i odbiegającą od niej');
});

test('[P27] demo zawiera kategorię przeliczoną po zmianie wagi, z listą ocen i średnimi klasy', async () => {
  const row = S.db.col('audit').find((a) => a.action === 'grade_category_update' && a.after && a.after.recalculated);
  assert.ok(row, 'rejestr zmian ma wpis o przeliczeniu kategorii');
  assert.ok(row.after.gradeIds.length >= 1);
  assert.equal(row.before.weight, 1);
  assert.equal(row.after.weight, 2);
  assert.ok(row.before.classAverages && row.after.classAverages);
  for (const gid of row.after.gradeIds) {
    assert.ok(S.db.col('audit').some((a) => a.action === 'grade_update' && a.entityId === gid && a.before.weight === 1 && a.after.weight === 2), 'każda przeliczona ocena ma własny ślad: ' + gid);
  }
});

test('[P29] nieznany status frekwencji nie obniża procentu — liczy się osobno jako „unknown”', async () => {
  const D = require('../server/lib/domain');
  const st = D.attendanceStats([{ status: 'ob' }, { status: 'xx' }]);
  assert.equal(st.percent, 100, 'status z importu, którego dziennik nie zna, wypada z podstawy');
  assert.equal(st.unknown, 1);
  assert.deepEqual(st.unknownStatuses, ['xx']);
  assert.equal(st.total, 1);
  assert.equal(D.attendanceStats([{ status: 'ob' }, { status: 'nb' }]).percent, 50, 'znane statusy liczą się jak dotąd');
  assert.equal(D.attendanceStats([]).unknown, 0);

  // ta sama reguła na trasie: wydruk dla rodzica nie pokazuje zaniżonej frekwencji
  const att = S.db.col('attendance');
  const sample = att.find((a) => a.studentId === ANNA && a.subjectId === 'mat' && !a.draft);
  assert.ok(sample);
  const c = await S.as('j.nowak');
  const clean = String(expectOk(await c.get('/api/grades/record/' + ANNA + '?subjectId=mat')));
  const pct = /frekwencja: ([0-9,]+) %/.exec(clean);
  assert.ok(pct, 'wydruk podaje frekwencję');
  att.push(Object.assign({}, sample, { id: 'g_att_unknown_test', status: 'xx' }));
  const withJunk = String(expectOk(await c.get('/api/grades/record/' + ANNA + '?subjectId=mat')));
  assert.equal(/frekwencja: ([0-9,]+) %/.exec(withJunk)[1], pct[1], 'wiersz z nieznanym statusem nie rusza procentu');
  att.splice(att.findIndex((a) => a.id === 'g_att_unknown_test'), 1);
});

test('[OPS-20] imiennicy z jednego oddziału są rozróżnieni numerem w dzienniku', async () => {
  const D = require('../server/lib/domain');
  const jan = S.db.get('students', 'st_nowak_jan');
  assert.ok(jan);
  const students = S.db.col('students');
  assert.equal(D.studentLabel(jan, S.db), `${jan.rollNo}. Nowak Jan`, 'bez imiennika etykieta się nie zmienia');

  const twin = Object.assign({}, jan, { id: 'st_nowak_jan_2', rollNo: 21, birthDate: '2013-04-02', registerNo: '21/2026' });
  students.push(twin);
  try {
    assert.equal(D.studentLabel(jan, S.db), `Nowak Jan (nr ${jan.rollNo})`);
    assert.equal(D.studentLabel(twin, S.db), 'Nowak Jan (nr 21)');
    assert.equal(D.studentLabel(jan), `${jan.rollNo}. Nowak Jan`, 'bez bazy zostaje stare zachowanie');
    const noRoll = Object.assign({}, twin, { rollNo: null });
    assert.equal(D.studentLabel(noRoll, S.db), 'Nowak Jan (ur. 2013)', 'bez numeru w dzienniku rozróżnia rok urodzenia');

    const c = await S.as('j.nowak');
    const grid = expectOk(await c.get('/api/grades/grid?classId=7b&subjectId=mat&semester=1'));
    const names = grid.students.filter((r) => r.name.startsWith('Nowak Jan')).map((r) => r.name);
    assert.deepEqual(names.sort(), ['Nowak Jan (nr 21)', `Nowak Jan (nr ${jan.rollNo})`].sort());
    const print = String(expectOk(await c.get('/api/grades/record/st_nowak_jan?subjectId=mat')));
    assert.ok(print.includes(`Nowak Jan (nr ${jan.rollNo})`), 'wydruk też rozróżnia imienników');
  } finally {
    students.splice(students.findIndex((s) => s.id === 'st_nowak_jan_2'), 1);
  }
});

test('[3.9.1] tabele wydruku mają podpis i nagłówki związane z komórkami (scope)', async () => {
  const c = await S.as('j.nowak');
  const html = String(expectOk(await c.get('/api/grades/record/' + ANNA)));
  assert.match(html, /<caption>Oceny · /, 'każda tabela ocen ma podpis');
  assert.match(html, /<th scope="col">Kategoria<\/th>/);
  assert.match(html, /<th scope="row">/);
  assert.match(html, /<caption>Uwagi i pochwały z dziennika lekcyjnego<\/caption>/);
  const heads = html.match(/<th\b[^>]*>/g) || [];
  assert.ok(heads.length > 0);
  assert.equal(heads.filter((t) => !/scope="(col|row)"/.test(t)).length, 0, 'każdy <th> ma scope');
  assert.equal((html.match(/<table>/g) || []).length, (html.match(/<caption>/g) || []).length, 'każda tabela ma <caption>');
});
