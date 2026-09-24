'use strict';
/* Sekcja 3.6 — widok ucznia (anna.kowalczyk, 7b) i ucznia pełnoletniego (aleksandra.borowska, 8b). */
const test = require('node:test'); const assert = require('node:assert/strict');
const fs = require('node:fs'); const path = require('node:path');
const { startServer, expectOk , loadClient, withConfig } = require('./helpers');
const util = require('../server/lib/util');
const D = require('../server/lib/domain');

let S, anna, ola;
test.before(async () => { S = await startServer(); anna = await S.as('anna.kowalczyk'); ola = await S.as('aleksandra.borowska'); });
test.after(() => S.close());

const ANNA = 'st_kowalczyk_anna';
const noContacts = (payload) => {
  const blob = JSON.stringify(payload);
  assert.ok(!/@sp12\.krakow\.pl/.test(blob), 'payload nie może zawierać adresów e-mail');
  assert.ok(!/"email"\s*:\s*"[^"]/.test(blob), 'payload nie może zawierać pola email');
  assert.ok(!/"phone"\s*:\s*"[^"]/.test(blob), 'payload nie może zawierać numeru telefonu');
};

test('[3.6.1] uczeń widzi pulpit: plan na dziś z odwołaniem i zmianą sali, zapowiedzi i zadania na jutro', async () => {
  const d = expectOk(await anna.get('/api/student/dashboard'));
  assert.equal(d.today, S.TODAY);
  assert.equal(d.student.classId, '7b');
  assert.ok(d.lessons.length >= 5, 'plan na dziś');
  for (const l of d.lessons) { assert.match(l.start, /^\d{2}:\d{2}$/); assert.ok(l.subject); assert.ok(l.teacher && l.teacher.name); }
  assert.ok(d.lessons.some((l) => l.state === 'cancel'), 'odwołana lekcja w planie');
  const room = d.lessons.find((l) => l.state === 'room');
  assert.ok(room && room.roomChangedFrom && room.roomChangedFrom !== room.room, 'zmiana sali');
  assert.ok(d.upcomingTests.length >= 1 && d.upcomingTests.every((t) => 'scope' in t));
  const tomorrow = util.addDays(S.TODAY, 1);
  assert.ok(d.homeworkTomorrow.length >= 1, 'zadania na jutro');
  assert.ok(d.homeworkTomorrow.every((h) => h.dueDate === tomorrow));
  assert.equal(d.entitlements.paywall, false);
  noContacts(d);
});

test('[3.6.2] oceny cząstkowe z wagą, kolorem kategorii i średnią; cudze oceny są niedostępne', async () => {
  const g = expectOk(await anna.get('/api/student/grades'));
  assert.equal(g.studentId, ANNA);
  const mat = g.subjects.find((s) => s.subjectId === 'mat');
  assert.ok(mat, 'matematyka w wykazie');
  for (const x of mat.grades) { assert.ok(x.weight >= 1); assert.match(x.color, /^cat-\d$/); assert.ok(x.categoryName); assert.match(x.date, /^\d{4}-\d{2}-\d{2}$/); }
  assert.ok(mat.grades.some((x) => x.id === 'st_gr_a_mat_1' && x.value === '5' && x.weight === 3));
  const expected = D.studentGrades(S.db, ANNA, 'mat', g.semester).average;
  assert.equal(mat.average, expected, 'średnia liczona regułą szkoły');
  assert.equal(mat.averageText, util.fmtAvg(expected));
  // żadna ocena innego ucznia nie może pojawić się w odpowiedzi
  const mine = new Set(S.db.col('grades').filter((x) => x.studentId === ANNA).map((x) => x.id));
  for (const s of g.subjects) for (const x of s.grades) assert.ok(mine.has(x.id), 'ocena spoza konta ucznia: ' + x.id);
  const foreign = await anna.get('/api/student/grades?studentId=st_nowak_jan');
  assert.equal(foreign.status, 403); assert.equal(foreign.body.code, 'forbidden');
  const foreignGoal = await anna.post('/api/student/goal/simulate', { studentId: 'st_nowak_jan', subjectId: 'mat', target: 5 });
  assert.equal(foreignGoal.status, 403);
});

test('[3.6.3] uczeń oddaje zadanie domowe (tekst i zdjęcie) i dostaje potwierdzenie z czasem serwera', async () => {
  const hw = expectOk(await anna.get('/api/student/homework'));
  const task = hw.dueTomorrow.find((x) => x.subjectId === 'mat') || hw.dueTomorrow[0];
  assert.ok(task, 'zadanie na jutro');
  const before = util.now();
  const r = await anna.post(task.submitPath, {
    text: 'Zadanie 4: x = 3; zadanie 5: x = −2.',
    files: [{ name: 'IMG_2026.jpg', type: 'image/jpeg', size: 1200, dataUrl: 'data:image/jpeg;base64,/9j/4AAQSkZJRg==' }]
  });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  const receivedAt = r.body.receivedAt || (r.body.submission && r.body.submission.receivedAt);
  assert.ok(receivedAt >= before && receivedAt <= util.now(), 'czas odbioru nadaje serwer');
  assert.ok(String(r.body.receipt || '').length > 10, 'czytelne potwierdzenie odbioru');
  const row = S.db.one('homeworkSubmissions', (x) => x.homeworkId === task.id && x.studentId === ANNA);
  assert.ok(row && row.receivedAt === receivedAt && (row.files || []).length === 1);
  const after = expectOk(await anna.get('/api/student/homework'));
  assert.equal(after.upcoming.find((x) => x.id === task.id).submitted, true);
});

test('[3.6.4] frekwencja z dzisiejszych lekcji zgodna z wpisami nauczycieli', async () => {
  const a = expectOk(await anna.get('/api/student/attendance/today'));
  assert.equal(a.date, S.TODAY);
  const lessons = S.db.col('lessons').filter((l) => l.classId === '7b' && l.date === S.TODAY);
  assert.equal(a.lessons.length, a.lessons.length && lessons.filter((l) => !l.groupId || (S.db.get('groups', l.groupId) || { studentIds: [] }).studentIds.includes(ANNA)).length);
  for (const l of a.lessons) {
    const lesson = lessons.find((x) => x.lessonNo === l.lessonNo);
    const rows = S.db.col('attendance').filter((x) => x.lessonId === lesson.id && x.studentId === ANNA && !x.draft);
    assert.equal(l.status, rows.length ? rows[rows.length - 1].status : 'none', 'lekcja ' + l.lessonNo);
    if (rows.length) assert.ok(l.recordedBy && l.recordedBy.name, 'kto wpisał frekwencję');
  }
  assert.ok(a.lessons.some((l) => l.status !== 'none'), 'co najmniej jedna lekcja z wpisem');
  assert.ok(a.stats.percent === null || (a.stats.percent >= 0 && a.stats.percent <= 100));
  assert.ok(a.legend.sp && a.legend.nb, 'legenda statusów');
});

test('[3.6.5] odwołanie lekcji i zmiana sali tworzą powiadomienia dla całej klasy', async () => {
  const future = S.db.col('lessons').find((l) => l.classId === '7b' && l.date > S.TODAY && l.subjectId === 'pol');
  future.status = 'cancelled'; future.changedAt = util.now(); future.changeReason = 'Wyjazd nauczyciela na konferencję.';
  S.db.save();
  const r = expectOk(await anna.get('/api/student/changes'));
  const ch = r.changes.find((c) => c.lessonId === future.id);
  assert.ok(ch, 'zmiana w kanale'); assert.equal(ch.kind, 'cancel');
  assert.match(ch.text, /Odwołana lekcja/);
  const forAnna = S.db.col('notifications').filter((n) => n.userId === 'u_' + ANNA && n.dedupeKey === 'lesson:' + future.id + ':' + future.changedAt);
  assert.equal(forAnna.length, 1, 'powiadomienie dla ucznia');
  const classmate = S.db.col('notifications').filter((n) => n.userId === 'u_st_nowak_jan' && n.dedupeKey === 'lesson:' + future.id + ':' + future.changedAt);
  assert.equal(classmate.length, 1, 'powiadomienie dla kolegi z klasy');
  expectOk(await anna.get('/api/student/changes'));
  assert.equal(S.db.col('notifications').filter((n) => n.userId === 'u_' + ANNA && n.dedupeKey === 'lesson:' + future.id + ':' + future.changedAt).length, 1, 'bez duplikatów');
  const roomChange = r.changes.find((c) => c.kind === 'room');
  assert.ok(roomChange && roomChange.previousRoom, 'zmiana sali w kanale');
  const count = expectOk(await anna.get('/api/notifications/unread-count'));
  assert.ok(count.count >= 1);
});

test('[3.6.6] miesięczny kalendarz sprawdzianów z zakresem i kontrolą 7-dniowej zapowiedzi', async () => {
  const cal = expectOk(await anna.get('/api/student/tests/calendar?month=2026-10'));
  const on = (date) => cal.days.find((d) => d.date === date);
  assert.equal(cal.month, '2026-10');
  assert.equal(cal.daysInMonth, 31);
  assert.equal(cal.noticeRule, 7);
  /* 1 października 2026 to czwartek: siatka zaczyna się od poniedziałku 28 września (dzień wolny),
     a pełne tygodnie dopełnia 1 listopada — razem 35 komórek. */
  assert.equal(cal.days.length, 35);
  assert.equal(cal.leading, 3);
  assert.equal(cal.days[0].date, '2026-09-28');
  assert.equal(cal.days[0].d, 28);
  assert.equal(cal.days[0].inMonth, false);
  assert.equal(cal.days[0].off, true, 'dni z września są oznaczone jako wolne');
  assert.equal(cal.days[3].date, '2026-10-01', 'czwartek 1 października stoi w czwartej kolumnie');
  assert.equal(cal.days[cal.days.length - 1].date, '2026-11-01');
  assert.equal(cal.days.filter((d) => d.inMonth).length, 31);
  assert.ok(on('2026-10-23').today, 'dzisiaj zaznaczone');
  assert.equal(cal.days.filter((d) => d.today).length, 1);
  const spr = cal.tests.find((t) => t.id === 'st_test_mat_30');
  assert.ok(spr && spr.scope.length > 10, 'zakres materiału');
  assert.equal(spr.compliant, true); assert.ok(spr.noticeDays >= 7);
  const late = cal.tests.find((t) => t.id === 'st_test_ang_26');
  assert.equal(late.compliant, false); assert.equal(late.noticeDays, 3);
  assert.match(late.noticeNote, /mniej niż 7 dni/);
  assert.ok(cal.violations.some((t) => t.id === 'st_test_ang_26'));
  const day30 = on('2026-10-30');
  assert.ok(day30.events.length >= 2 && day30.limit, 'przekroczony limit sprawdzianów w jednym dniu');
  assert.ok(on('2026-10-24').off, 'sobota oznaczona jako wolna');
});

test('[3.6.7] symulacja celu liczy oceny potrzebne do oceny semestralnej', async () => {
  const sim = expectOk(await anna.post('/api/student/goal/simulate', { subjectId: 'mat', target: 5, plannedCount: 2, plannedWeight: 3 }));
  const cfg = S.db.data.config;
  assert.equal(sim.threshold, cfg.termGradeThresholds[5]);
  assert.equal(sim.current.average, D.studentGrades(S.db, ANNA, 'mat', sim.semester).average);
  assert.equal(sim.planned.count, 2); assert.equal(sim.planned.weight, 3);
  assert.equal(sim.options.length, 6);
  /* Scenariusz przypięty: przy średniej Anny z matematyki cel 5 MUSI być osiągalny, inaczej symulacja
     nie liczy tego, co obiecuje historyjka. Warunkowe `if (sim.reachable)` przepuszczało oba wyniki. */
  assert.equal(sim.reachable, true, 'cel 5 z matematyki jest osiągalny przy średniej ' + sim.current.average);
  assert.ok(sim.needed >= 1 && sim.needed <= 6, 'symulacja podaje konkretną ocenę do zdobycia: ' + sim.needed);
  const best = sim.options.find((o) => o.grade === sim.needed);
  assert.ok(best, 'proponowana ocena jest jedną z policzonych opcji');
  assert.ok(best.average >= sim.threshold, 'proponowana ocena ' + sim.needed + ' daje średnią ' + best.average + ' ≥ próg ' + sim.threshold);
  const lower = sim.options.find((o) => o.grade === sim.needed - 1);
  assert.ok(lower, 'w opcjach jest też ocena o jeden niższa (' + (sim.needed - 1) + ')');
  assert.ok(lower.average < sim.threshold, 'ocena ' + (sim.needed - 1) + ' daje ' + lower.average + ' — za mało na próg ' + sim.threshold + ', więc „needed” jest najniższą wystarczającą');
  /* opcje muszą być monotoniczne i spójne z progiem — inaczej „needed” jest przypadkiem */
  assert.deepEqual(sim.options.map((o) => o.grade), [1, 2, 3, 4, 5, 6]);
  for (let i = 1; i < sim.options.length; i++) assert.ok(sim.options[i].average > sim.options[i - 1].average, 'wyższa ocena musi dawać wyższą średnią (' + sim.options[i - 1].grade + '→' + sim.options[i].grade + ')');
  for (const o of sim.options) assert.equal(o.reaches, o.average >= sim.threshold, 'opcja ' + o.grade + ': flaga „reaches” musi wynikać ze średniej i progu');
  assert.equal(sim.needed, sim.options.find((o) => o.reaches).grade, '„needed” to najniższa wystarczająca ocena');
  assert.ok(sim.options[sim.options.length - 1].average > sim.current.average, 'szóstka podnosi średnią powyżej obecnej');
  assert.match(sim.advice, /średnia/);
  // druga strona symulacji: cel 6 z jednej oceny o wadze 1 jest poza zasięgiem i musi być tak nazwany
  const unreachable = expectOk(await anna.post('/api/student/goal/simulate', { subjectId: 'mat', target: 6, plannedCount: 1, plannedWeight: 1 }));
  assert.equal(unreachable.reachable, false);
  assert.equal(unreachable.needed, null);
  assert.ok(unreachable.options.every((o) => !o.reaches), 'żadna pojedyncza ocena nie dowozi celu 6');
  assert.match(unreachable.advice, /nie da się osiągnąć/);
  if (unreachable.minimumSixes != null) assert.ok(unreachable.minimumSixes > unreachable.planned.count, 'potrzeba więcej ocen niż zaplanowano');
  const low = expectOk(await anna.post('/api/student/goal/simulate', { subjectId: 'mat', target: 3, plannedCount: 2, plannedWeight: 3 }));
  assert.equal(low.reachable, true);
  const bad = await anna.post('/api/student/goal/simulate', { subjectId: 'mat', target: 9 });
  assert.equal(bad.status, 400);
});

test('[3.6.8] uczeń pobiera materiały z historii lekcji; materiały innej klasy są niedostępne', async () => {
  const list = expectOk(await anna.get('/api/student/materials'));
  const fiz = list.materials.find((m) => m.id === 'st_mt_fiz');
  assert.ok(fiz && fiz.lesson && fiz.lesson.date === S.TODAY, 'materiał z historii lekcji');
  assert.ok(!list.materials.some((m) => m.id === 'st_mt_his_8b'), 'materiał klasy 8b niewidoczny');
  const file = expectOk(await anna.get('/api/materials/st_mt_fiz'));
  assert.match(file.dataUrl, /^data:application\/pdf;base64,/);
  assert.equal(file.name, 'Prawo Ohma – prezentacja');
  assert.equal((await anna.get('/api/materials/st_mt_his_8b')).status, 403);
  // nauczyciel dokłada materiał do swojej lekcji i uczeń od razu go widzi
  const teacher = await S.as('a.wojcik');
  const lesson = S.db.col('lessons').find((l) => l.teacherId === 'u_wojcik' && l.classId === '7b' && l.date === S.TODAY);
  const up = expectOk(await teacher.post('/api/materials', { lessonId: lesson.id, name: 'Karta pracy – opór zastępczy', type: 'text/plain', dataUrl: 'data:text/plain;base64,T3Bvcg==' }));
  const again = expectOk(await anna.get('/api/student/materials'));
  assert.ok(again.materials.some((m) => m.id === up.material.id));
  const other = await (await S.as('e.krol')).post('/api/materials', { lessonId: lesson.id, name: 'Nie moja lekcja', dataUrl: 'data:text/plain;base64,eA==' });
  assert.equal(other.status, 403);
});

test('[3.6.9] uczeń pisze do nauczyciela w dzienniku, bez numerów telefonów i adresów e-mail', async () => {
  const rec = expectOk(await anna.get('/api/messages/recipients'));
  noContacts(rec);
  assert.ok(rec.recipients.some((x) => x.id === 'u_nowak'), 'wychowawczyni na liście');
  assert.ok(!rec.recipients.some((x) => x.role === 'parent' || x.role === 'student'), 'tylko pracownicy szkoły');
  assert.ok(!rec.recipients.some((x) => x.id === 'u_kaczmarek'), 'nauczycielka spoza klasy poza listą');
  const sent = await anna.post('/api/messages', { toUserIds: ['u_nowak'], subject: 'Trudność z zadaniem 6', body: 'Nie rozumiem drugiego kroku.' });
  assert.equal(sent.status, 200);
  noContacts(sent.body);
  assert.match(sent.body.receipt, /Wysłano/);
  const blocked = await anna.post('/api/messages', { toUserIds: ['u_p_nowak'], subject: 'x', body: 'y' });
  assert.equal(blocked.status, 403); assert.equal(blocked.body.code, 'messaging_not_allowed');
  assert.equal((await anna.post('/api/messages', { toUserIds: ['u_kaczmarek'], subject: 'x', body: 'y' })).status, 403);
  const teacher = await S.as('j.nowak');
  const inbox = expectOk(await teacher.get('/api/messages?box=inbox'));
  const got = inbox.messages.find((m) => m.id === sent.body.message.id);
  assert.ok(got && got.unread === true, 'wiadomość u nauczycielki');
  noContacts(inbox);
  const detail = expectOk(await teacher.get('/api/messages/' + got.id));
  assert.equal(detail.body, 'Nie rozumiem drugiego kroku.');
  const mine = expectOk(await anna.get('/api/messages?box=sent'));
  const receipt = mine.messages.find((m) => m.id === got.id).receipt;
  assert.equal(receipt.read, 1); assert.equal(receipt.state, 'read');
  const outsider = await (await S.as('t.gorski')).get('/api/messages/' + got.id);
  assert.equal(outsider.status, 403, 'osoba postronna nie czyta korespondencji');
});

test('[3.6.10] dostęp ucznia jest bezpłatny — brak progu płatności i odpowiedzi 402', async () => {
  const e = expectOk(await anna.get('/api/student/entitlements'));
  assert.equal(e.free, true); assert.equal(e.paywall, false); assert.equal(e.price, 0); assert.equal(e.subscription, null);
  assert.ok(e.features.includes('oceny i średnie') && e.features.includes('plan lekcji'));
  const dir = path.join(__dirname, '..', 'server');
  const files = []; (function walk(d) { for (const f of fs.readdirSync(d, { withFileTypes: true })) { const p = path.join(d, f.name); if (f.isDirectory()) walk(p); else if (p.endsWith('.js')) files.push(p); } })(dir);
  for (const f of files) assert.ok(!/httpError\(\s*402|payment required/i.test(fs.readFileSync(f, 'utf8')), 'brak odpowiedzi 402 w ' + path.basename(f));
});

test('[3.6.11] uczeń pełnoletni sam składa usprawiedliwienie, gdy pozwala na to statut', async () => {
  const meta = expectOk(await ola.get('/api/student/excuses'));
  assert.equal(meta.adult, true); assert.equal(meta.schoolAllows, true); assert.equal(meta.allowed, true);
  const r = expectOk(await ola.post('/api/student/excuses', { from: '2026-10-20', to: '2026-10-21', reason: 'Wizyta u lekarza specjalisty' }));
  assert.match(r.receipt, /Usprawiedliwienie złożone/);
  const row = S.db.get('excuses', r.excuse.id);
  assert.equal(row.studentId, 'st_borowska_aleksandra'); assert.equal(row.status, 'pending');
  assert.equal(row.byUserId, 'u_st_borowska_aleksandra'); assert.equal(row.selfExcuse, true);
  assert.ok(S.db.col('audit').some((a) => a.action === 'excuse_self_submitted' && a.entityId === r.excuse.id));
  assert.ok(S.db.col('notifications').some((n) => n.userId === 'u_lis' && n.kind === 'excuse'), 'wychowawca dostaje powiadomienie');
  const minor = await anna.post('/api/student/excuses', { from: '2026-10-20', to: '2026-10-20', reason: 'Choroba' });
  assert.equal(minor.status, 403); assert.equal(minor.body.code, 'not_adult');
  /* withConfig przywraca ustawienie także wtedy, gdy asercja rzuci — inaczej wyłączona zgoda szkoły
     zostałaby w konfiguracji na wszystkie dalsze testy w tym pliku. */
  const off = await withConfig(S.db, { adultSelfExcuseAllowed: false }, () =>
    ola.post('/api/student/excuses', { from: '2026-10-22', to: '2026-10-22', reason: 'Sprawy urzędowe' }));
  assert.equal(off.status, 403); assert.equal(off.body.code, 'not_allowed_by_school');
  assert.equal(S.db.data.config.adultSelfExcuseAllowed, true, 'ustawienie szkoły wróciło na miejsce');
});

test('[3.6.12] sprzeciw ucznia pełnoletniego natychmiast odcina konta opiekunów', async () => {
  const parent = await S.as('rodzic.borowska');
  assert.equal((await parent.get('/api/access/student/st_borowska_aleksandra')).status, 200);
  const r = expectOk(await ola.post('/api/student/parent-access', { blocked: true, reason: 'Sprzeciw ucznia pełnoletniego' }));
  assert.equal(r.parentAccessBlocked, true); assert.ok(r.affectedParents >= 1);
  assert.equal(S.db.get('students', 'st_borowska_aleksandra').parentAccessBlocked, true);
  const denied = await parent.get('/api/access/student/st_borowska_aleksandra');
  assert.equal(denied.status, 403); assert.equal(denied.body.parentAccessBlocked, true);
  assert.deepEqual(D.visibleStudentIds(S.db, S.db.get('users', 'st_u_p_borowski')), []);
  assert.ok(S.db.col('audit').some((a) => a.action === 'parent_access_blocked' && a.entityId === 'st_borowska_aleksandra'));
  assert.ok(S.db.col('notifications').some((n) => n.userId === 'st_u_p_borowski' && n.kind === 'rights'));
  const minor = await anna.post('/api/student/parent-access', { blocked: true });
  assert.equal(minor.status, 403); assert.equal(minor.body.code, 'not_adult');
  expectOk(await ola.post('/api/student/parent-access', { blocked: false }));
  assert.equal((await parent.get('/api/access/student/st_borowska_aleksandra')).status, 200);
});

/* R7/R3 — przełącznik `config.adultAccess` (docs/GUARDIANS.md, wiersz 10 triage'u). Test sprząta po
   sobie zapis zgody/sprzeciwu, żeby uruchomiony sam dawał ten sam wynik, co w całym pliku. */
function clearAdultAccess(studentId) {
  const s = S.db.get('students', studentId);
  s.adultConsent = null; s.parentAccessBlocked = false; s.parentAccessBlockedAt = null; s.parentAccessReason = null;
  S.db.save();
}

/* Historyjka 3.6.12 mówi o SPRZECIWIE ucznia pełnoletniego; tryb „zgoda wymagana” to osobna
   funkcja z rundy R3 (`config.adultAccess`), więc nosi własny znacznik. Dowód dla 3.6.12
   zostaje w tym samym pliku — przy teście sprzeciwu (docs/review/round3/test-honesty.md §7). */
test('[R3.1] tryb „zgoda wymagana”: opiekun czeka na zgodę ucznia pełnoletniego, a jej cofnięcie znowu zamyka wgląd', async () => {
  const OLA = 'st_borowska_aleksandra';                       // ur. 2008-05-14 — pełnoletnia od 14.05.2026
  const parent = await S.as('rodzic.borowska');
  clearAdultAccess(OLA);
  try {
    await withConfig(S.db, { adultAccess: 'consent-required' }, async () => {
      // 1. sama pełnoletność wystarczy, żeby opiekun stracił wgląd — bez żadnego pisma ucznia
      const before = expectOk(await ola.get('/api/student/parent-access'));
      assert.equal(before.adultAccess.mode, 'consent-required');
      assert.equal(before.adultAccess.adult, true);
      assert.equal(before.adultAccess.guardianAccess, 'pending-consent');
      for (const path of ['/api/parent/grades?studentId=' + OLA, '/api/parent/attendance?studentId=' + OLA]) {
        const blocked = await parent.get(path);
        assert.equal(blocked.status, 403, 'bez zgody opiekun nie widzi danych ucznia pełnoletniego: ' + path);
        assert.equal(blocked.body.scope, 'none');
      }
      assert.equal(D.guardianScope(S.db, S.db.get('users', 'st_u_p_borowski'), OLA), 'none');

      // 2. zgoda ucznia otwiera wgląd i zostawia wiersz audytu ze stanem przed i po
      const yes = expectOk(await ola.post('/api/student/parent-access', { consent: true, reason: 'Zgoda z 23.10.2026' }));
      assert.equal(yes.parentAccessBlocked, false);
      assert.equal(yes.adultAccess.guardianAccess, 'open');
      assert.equal(yes.adultAccess.consent.given, true);
      const open = await S.as('rodzic.borowska');
      expectOk(await open.get('/api/parent/grades?studentId=' + OLA), 'po zgodzie wgląd wraca');
      const row = S.db.col('audit').filter((a) => a.entityId === OLA && a.action === 'parent_access_restored').pop();
      assert.ok(row, 'zgoda zostawia wiersz audytu');
      assert.equal(row.after.consent, true);
      assert.equal(row.after.mode, 'consent-required');

      // 3. cofnięcie zgody zamyka wgląd natychmiast
      const no = expectOk(await ola.post('/api/student/parent-access', { consent: false, reason: 'Cofnięcie zgody' }));
      assert.equal(no.parentAccessBlocked, true);
      assert.equal(no.adultAccess.guardianAccess, 'blocked');
      const again = await S.as('rodzic.borowska');
      assert.equal((await again.get('/api/parent/grades?studentId=' + OLA)).status, 403);
    });
  } finally { clearAdultAccess(OLA); }
});

test('[3.6.12] tryb „do sprzeciwu” zostaje bez zmian: opiekun widzi dane, dopóki uczeń nie wniesie sprzeciwu', async () => {
  const OLA = 'st_borowska_aleksandra';
  const parent = await S.as('rodzic.borowska');
  clearAdultAccess(OLA);
  try {
    await withConfig(S.db, { adultAccess: 'until-objection' }, async () => {
      const state = expectOk(await ola.get('/api/student/parent-access'));
      assert.equal(state.adultAccess.mode, 'until-objection');
      assert.equal(state.adultAccess.guardianAccess, 'open', 'bez sprzeciwu wgląd zostaje');
      expectOk(await parent.get('/api/parent/grades?studentId=' + OLA), 'bez sprzeciwu opiekun widzi oceny');

      const r = expectOk(await ola.post('/api/student/parent-access', { blocked: true, reason: 'Sprzeciw ucznia pełnoletniego' }));
      assert.equal(r.parentAccessBlocked, true);
      assert.equal(r.adultAccess.guardianAccess, 'blocked');
      assert.equal((await (await S.as('rodzic.borowska')).get('/api/parent/grades?studentId=' + OLA)).status, 403);
      expectOk(await ola.post('/api/student/parent-access', { blocked: false }));
      expectOk(await (await S.as('rodzic.borowska')).get('/api/parent/grades?studentId=' + OLA), 'cofnięcie sprzeciwu wraca do stanu sprzed');
    });
  } finally { clearAdultAccess(OLA); }
});

test('[3.6.13] uczeń dostaje przypomnienie o zwrocie książki przed końcem semestru', async () => {
  const cfg = S.db.data.config;
  const window = cfg.libraryNoticeDaysBeforeSemesterEnd || 60;
  const D2 = require('../server/lib/domain');
  const semEnd = D2.semester(S.db, D2.semesterOf(S.db, S.TODAY)).to;

  /* Dwa wypożyczenia postawione na przeciwnych brzegach okna przypomnień: jedno MUSI dać
     przypomnienie, drugie NIE. Stary test brał dowolne przypomnienie z zasiewu. */
  const mk = (id, title, dueDate) => { S.db.col('libraryLoans').push({ id, studentId: ANNA, itemId: 'li_' + id, title, author: 'test', barcode: '999' + id, lentAt: '2026-09-02', dueDate, returnedAt: null, byUserId: 'u_biblioteka' }); return id; };
  const soon = util.addDays(S.TODAY, Math.max(1, window - 2));        // w oknie i przed końcem semestru
  const late = util.addDays(semEnd, 30);                              // po końcu semestru — poza zakresem historyjki
  assert.ok(soon <= semEnd, 'termin „w oknie” mieści się przed końcem semestru');
  mk('t_loan_in', 'Lalka — test w oknie', soon);
  mk('t_loan_out', 'Quo vadis — test poza oknem', late);
  S.db.save();

  const lib = expectOk(await anna.get('/api/student/library'));
  assert.ok(lib.loans.length >= 3, 'wypożyczenia ucznia');
  assert.equal(lib.semesterEnd, semEnd);
  const inWindow = lib.notices.find((n) => n.id === 't_loan_in');
  assert.ok(inWindow, 'książka z terminem ' + soon + ' (okno ' + window + ' dni przed końcem semestru) daje przypomnienie');
  assert.equal(inWindow.daysLeft, util.daysBetween(S.TODAY, soon));
  assert.equal(inWindow.overdue, false);
  assert.match(inWindow.text, /Termin zwrotu/);
  assert.ok(inWindow.text.includes(util.fmtDate(semEnd)), 'przypomnienie nazywa koniec semestru');
  assert.ok(!lib.notices.some((n) => n.id === 't_loan_out'), 'książka z terminem po końcu semestru nie generuje przypomnienia');
  assert.ok(lib.notices.every((n) => n.dueDate <= lib.semesterEnd), 'wszystkie przypomnienia dotyczą terminów przed końcem semestru');

  const notif = S.db.col('notifications').filter((n) => n.userId === 'u_' + ANNA && n.kind === 'library');
  assert.ok(notif.some((n) => n.dedupeKey === 'loan:t_loan_in'), 'powiadomienie w dzienniku dla książki z okna');
  assert.ok(!notif.some((n) => n.dedupeKey === 'loan:t_loan_out'), 'brak powiadomienia dla książki spoza okna');
  expectOk(await anna.get('/api/student/library'));
  assert.equal(S.db.col('notifications').filter((n) => n.userId === 'u_' + ANNA && n.kind === 'library').length, notif.length, 'bez duplikatów');
});

test('[3.6.14] uczeń zapisuje tryb ciemny i pozostałe preferencje na koncie', async () => {
  const r = expectOk(await anna.patch('/api/me/preferences', { theme: 'dark', reduceMotion: true, textZoom: '150%' }));
  assert.equal(r.preferences.theme, 'dark'); assert.equal(r.preferences.reduceMotion, true); assert.equal(r.preferences.textZoom, '150%');
  assert.equal(S.db.get('users', 'u_' + ANNA).preferences.theme, 'dark');
  const back = expectOk(await anna.get('/api/me/preferences'));
  assert.equal(back.preferences.theme, 'dark');
  assert.equal((await anna.patch('/api/me/preferences', { theme: 'neon' })).status, 400);
  assert.equal((await anna.patch('/api/me/preferences', { textZoom: '320%' })).status, 400);
  assert.ok(S.db.col('audit').some((a) => a.action === 'preferences_updated' && a.entityId === 'u_' + ANNA));

  /* Historyjka mówi o PRZEŁĄCZENIU INTERFEJSU, nie o zapisaniu łańcucha znaków na koncie.
     Sprawdzamy całą drogę: wybór na ekranie → A.setTheme → data-theme na <html> → paleta w tokenach,
     i przywrócenie motywu przed pierwszym malowaniem po ponownym wejściu. */
  const fs = require('node:fs'); const path = require('node:path');
  const rd = (...p) => fs.readFileSync(path.join(__dirname, '..', 'public', ...p), 'utf8');
  const core = rd('app', 'core.js');
  assert.match(core, /function setTheme\(t\) \{ document\.documentElement\.dataset\.theme = t;/, 'setTheme przestawia motyw na elemencie html');
  assert.match(core, /localStorage\.setItem\('edmat\.theme', t\)/, 'wybór motywu przeżywa przeładowanie strony');
  const settings = rd('app', 'screens', 'settings.js');
  assert.match(settings, /function pickTheme\(v\) \{[^}]*A\.setTheme\(v\)[^}]*savePrefs\(\{ theme: v \}\)/, 'ekran ustawień przełącza motyw i zapisuje go na koncie');
  assert.match(settings, /value: 'dark'|'light', 'dark', 'hc'/, 'ciemny jest jedną z opcji motywu');
  const boot = rd('app', 'theme.js');
  assert.match(boot, /localStorage\.getItem\('edmat\.theme'\)/, 'motyw wczytywany przed pierwszym malowaniem');
  assert.match(boot, /document\.documentElement\.dataset\.theme = t/, 'i od razu nakładany na dokument');
  assert.match(boot, /prefers-color-scheme: dark/, 'bez wyboru użytkownika bierzemy preferencję systemu');
  const tokens = rd('edmat', 'tokens.css');
  const dark = tokens.slice(tokens.indexOf('[data-theme="dark"]'), tokens.indexOf('[data-theme="dark"]') + 1200);
  assert.ok(dark.startsWith('[data-theme="dark"]'), 'tokeny definiują paletę ciemną');
  assert.match(dark, /--surface: #[0-9a-f]{6}/, 'ciemny motyw przedefiniowuje tło powierzchni');
  assert.match(dark, /--ink: #[0-9a-f]{6}/, 'ciemny motyw przedefiniowuje kolor tekstu');
  const hex = (css, name) => (new RegExp('--' + name + ': #([0-9a-f]{6})').exec(css) || [])[1];
  const lum = (h) => { const c = [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16) / 255).map((v) => (v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4))); return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]; };
  const light = tokens.slice(0, tokens.indexOf('[data-theme="dark"]'));
  assert.ok(lum(hex(dark, 'surface')) < lum(hex(light, 'surface')), 'tło w trybie ciemnym jest ciemniejsze niż w jasnym');
  assert.ok(lum(hex(dark, 'ink')) > lum(hex(dark, 'surface')), 'tekst jest jaśniejszy od tła — motyw naprawdę jest odwrócony');
  assert.ok(rd('index.html').includes('app/theme.js'), 'skrypt motywu jest wczytywany w powłoce');
  // cisza nocna liczona w strefie szkoły: powiadomienia poza kryzysowymi czekają do rana
  const pad = (n) => String(n).padStart(2, '0');
  const hourNow = +util.localTime(util.now(), D.tz(S.db)).slice(0, 2);
  const from = pad(hourNow) + ':00', to = pad((hourNow + 2) % 24) + ':00';
  expectOk(await anna.patch('/api/me/preferences', { quietHours: { from, to } }));
  const N = require('../server/routes/notifications');
  assert.equal(N.createNotification(S.db, 'u_' + ANNA, 'test', 'Cisza nocna', {}).deferred, true);
  assert.equal(N.createNotification(S.db, 'u_' + ANNA, 'test', 'Sprawa pilna', { crisis: true }).deferred, false);
  const feed = expectOk(await anna.get('/api/notifications/feed'));
  assert.equal(feed.quietNow, true); assert.ok(feed.deferredCount >= 1);
  expectOk(await anna.post('/api/notifications/push/register', { endpoint: 'https://push.example.invalid/abc', device: 'telefon' }));
  assert.ok(S.db.col('pushSubscriptions').some((p) => p.userId === 'u_' + ANNA));
  expectOk(await anna.patch('/api/me/preferences', { quietHours: null, theme: 'light' }));
});

test('[3.6.15] lista skrótów klawiszowych i obsługa klawiatury w powłoce aplikacji', async () => {
  const s = expectOk(await anna.get('/api/shortcuts'));
  const labels = s.shortcuts.map((x) => x.keys.join('+'));
  for (const k of ['Alt+1…9', '?', '/', 'Ctrl+S', 'Esc']) assert.ok(labels.includes(k), 'brak skrótu ' + k);
  assert.ok(s.skipLink && /Przejdź do treści/.test(s.skipLink));

  /* Lista skrótów to obietnica — sprawdzamy, że powłoka jej dotrzymuje. Grep po core.js przechodziłby
     również dla nasłuchu, który nic nie robi, więc uruchamiamy prawdziwe pliki klienta
     (i18n.js + edmat/bundle.js + core.js + shell.js) w piaskownicy node:vm i naciskamy klawisze. */
  let saved = 0; let ui;
  ui = loadClient({
    session: { user: { id: 'u_st_kowalczyk_anna', login: 'anna.kowalczyk', role: 'student', name: 'Anna Kowalczyk' }, config: { school: { short: 'SP12' } }, remainingSeconds: 900 },
    screens: [
      { id: 'uczen', path: '/uczen', roles: ['student'], nav: { label: 'Pulpit', order: 1 }, component: function Pulpit() { ui.A.onSave(function () { saved++; }); return null; } },
      { id: 'oceny', path: '/oceny-ucznia', roles: ['student'], nav: { label: 'Oceny', order: 2 }, component: function Oceny() { return null; } },
    ],
  });
  await ui.render();
  assert.ok(ui.names().includes('Frame'), 'powłoka zbudowała ramkę dla ucznia');
  assert.equal(ui.hash, '#/uczen', 'pusta trasa prowadzi do pierwszej sekcji');

  ui.press('2', { altKey: true }); assert.equal(ui.hash, '#/oceny-ucznia', 'Alt+2 przenosi do drugiej sekcji');
  ui.press('1', { altKey: true }); assert.equal(ui.hash, '#/uczen');
  await ui.render();
  ui.press('s', { ctrlKey: true }); assert.equal(saved, 1, 'Ctrl+S wywołuje zapis ekranu');
  ui.press('/'); assert.deepEqual(ui.focused, ['search'], '„/” ustawia kursor w polu wyszukiwania');

  ui.press('?'); await ui.render();
  const dialog = ui.find('ShortcutsDialog');
  assert.ok(dialog, '„?” otwiera okno z listą skrótów');
  const shown = ui.all('Kbd').map((k) => (k.props.keys || []).join('+'));
  for (const k of ['Alt+1…9', '?', '/', 'Ctrl+S', 'Esc']) assert.ok(shown.includes(k), 'okno nie wymienia skrótu ' + k);
  const box = ui.all('Dialog').find((d) => typeof d.props.onClose === 'function');
  assert.ok(box, 'okno ma drogę wyjścia (Esc / przycisk zamknięcia)');
  box.props.onClose(); await ui.render();
  assert.ok(!ui.names().includes('ShortcutsDialog'), 'zamknięcie okna chowa listę skrótów');
  ui.press('?'); await ui.render(); assert.ok(ui.names().includes('ShortcutsDialog'));
  ui.press('?'); await ui.render(); assert.ok(!ui.names().includes('ShortcutsDialog'), 'drugie „?” zamyka okno');

  const settings = fs.readFileSync(path.join(__dirname, '..', 'public', 'app', 'screens', 'settings.js'), 'utf8');
  assert.match(settings, /E\.Kbd/, 'tabela skrótów na ekranie ustawień');
});

test('[3.6.1] pulpit i frekwencja ucznia czytają porę dnia z jednego zegara szkoły (P31)', async () => {
  const sn = D.schoolNow(S.db);
  assert.equal(sn.date, S.TODAY);
  assert.equal(util.localTime(sn.instant, D.tz(S.db)), sn.time, 'instant zgadza się z godziną ścienną');

  const dash = expectOk(await anna.get('/api/student/dashboard'));
  const att = expectOk(await anna.get('/api/student/attendance/today'));
  assert.equal(dash.today, sn.date);
  assert.equal(att.date, sn.date);
  const nowNos = (rows) => rows.filter((l) => l.state === 'now').map((l) => l.lessonNo).sort();
  /* P31: dwa ekrany nie mogą uznać tej samej minuty raz za „przed”, raz za „po” progu. */
  assert.deepEqual(nowNos(dash.lessons), nowNos(att.lessons));
  for (const l of dash.lessons.filter((x) => x.state === 'now')) {
    assert.ok(sn.time >= l.start && sn.time <= l.end, `lekcja ${l.lessonNo} oznaczona „teraz” poza swoim oknem ${l.start}–${l.end}`);
  }
  // termin zadania to godzina ścienna nauczyciela, ta sama po stronie ucznia
  const hw = expectOk(await anna.get('/api/student/homework'));
  for (const h of [...hw.upcoming, ...hw.dueTomorrow]) {
    assert.match(h.dueLocal, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/);
    assert.equal(h.dueDate, h.dueLocal.slice(0, 10));
    assert.equal(h.dueTime, h.dueLocal.slice(11, 16));
    assert.equal(util.localDate(h.dueAt, D.tz(S.db)), h.dueDate, 'instant terminu i godzina ścienna mówią o tym samym dniu');
  }
});
