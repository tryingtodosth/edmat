'use strict';
const test = require('node:test'); const assert = require('node:assert/strict');
const { startServer, expectOk, fixtures, withConfig, DEMO_PASSWORD } = require('./helpers');
const D = require('../server/lib/domain');
const C = require('../server/lib/crypto');
const { audit } = require('../server/lib/audit');

let S, P; /* P = dyrektor */
test.before(async () => { S = await startServer(); P = await S.as('dyrektor'); });
test.after(() => S.close());

const lesson = (pred) => S.db.col('lessons').find(pred);
const lessonsOf = (pred) => S.db.col('lessons').filter(pred);
const notifs = (pred) => S.db.col('notifications').filter(pred);
const audits = (pred) => S.db.col('audit').filter(pred);

/* ------------------------------------------------------------------ 3.3.1–3.3.7 zastępstwa i rozliczenie */
let absenceId; /* nieobecność fizyka 26–28.10 */
let thuFriId;  /* nieobecność fizyka 29–30.10: odwołanie, łączenie klas, publikacja */

/* Kroki, na których opierają się późniejsze historyjki, są budowane leniwie i tylko raz: w pełnym
   przebiegu tworzy je test, do którego należą, a przy `--test-name-pattern` — pierwszy test, który
   ich potrzebuje. Dzięki temu każdy z tych testów przechodzi także uruchomiony sam. */
const need = fixtures();
const absence = () => need('absence', async () => expectOk(await P.post('/api/substitutions', { teacherId: 'u_wojcik', from: '2026-10-26', to: '2026-10-28', reason: 'Zwolnienie lekarskie (L4)' })));
const thuFri = () => need('thuFri', async () => expectOk(await P.post('/api/substitutions', { teacherId: 'u_wojcik', from: '2026-10-29', to: '2026-10-30', reason: 'Zwolnienie lekarskie (L4)' })));
const cancelledFirst = () => need('cancelFirst', async () => {
  const sub = await thuFri();
  const first = sub.lessons.find((l) => l.classId === '7b' && l.date === '2026-10-29');
  const before = notifs((n) => n.kind === 'schedule').length;
  const after = expectOk(await P.post(`/api/substitutions/${sub.id}/assign`, { lessonId: first.id, kind: 'cancel' }));
  return { sub, first, assignment: after.assignments.find((x) => x.lessonId === first.id), fresh: notifs((n) => n.kind === 'schedule').slice(before) };
});
const combinedClasses = () => need('combine', async () => {
  const sub = expectOk(await P.get('/api/substitutions/' + (await thuFri()).id));
  const a7b = sub.lessons.find((l) => l.classId === '7b' && l.date === '2026-10-30');
  const a8b = sub.lessons.find((l) => l.classId === '8b' && l.date === '2026-10-30');
  const who = a7b.suggestions[0].teacherId;
  const after = expectOk(await P.post(`/api/substitutions/${sub.id}/assign`, { lessonId: a7b.id, kind: 'combine', combineWithLessonId: a8b.id, substituteTeacherId: who, room: 'aula' }));
  return { sub, a7b, a8b, who, after };
});
const publishedPlan = () => need('publish', async () => {
  await cancelledFirst(); await combinedClasses();
  const id = (await thuFri()).id;
  const sub = expectOk(await P.get('/api/substitutions/' + id));
  for (const l of sub.lessons) {
    const a = sub.assignments.find((x) => x.lessonId === l.id);
    if (a.substituteTeacherId || a.kind === 'cancel') continue;
    expectOk(await P.post(`/api/substitutions/${id}/assign`, { lessonId: l.id, substituteTeacherId: l.suggestions[0].teacherId }));
  }
  /* publikacja zaplanowana na później nie zmienia jeszcze planu */
  const scheduled = expectOk(await P.post(`/api/substitutions/${id}/publish`, { publishAt: new Date(Date.now() + 3600e3).toISOString() }));
  const cancelled = sub.lessons.find((l) => l.classId === '7b' && l.date === '2026-10-29');
  const statusBeforeDue = S.db.get('lessons', cancelled.id).status;
  /* nadchodzi ustawiona godzina */
  S.db.get('substitutions', id).publishAt = new Date(Date.now() - 1000).toISOString();
  const before = notifs(() => true).length;
  const run = expectOk(await P.post('/api/substitutions/publish-due'));
  return { id, sub, scheduled, cancelled, statusBeforeDue, run, fresh: S.db.col('notifications').slice(before) };
});
const invalidatedGrade = () => need('invalidated', async () => {
  const g = S.db.insert('grades', { studentId: 'st_kowalczyk_anna', subjectId: 'fiz', classId: '7b', categoryId: null, categoryName: 'klasyfikacja', weight: 1, color: 'cat-1', value: '2', kind: 'midterm', semester: 1, countsInAverage: false, locked: true, deleted: false, teacherId: 'u_wojcik', date: '2026-10-20' });
  const noMinutes = await P.post(`/api/principal/grades/${g.id}/invalidate`, { value: '3', protocolNo: '12/2026/2027', reason: 'wniosek komisji' });
  const before = notifs((n) => n.userId === 'u_p_kowalczyk').length;
  const r = expectOk(await P.post(`/api/principal/grades/${g.id}/invalidate`, {
    value: '4', protocolNo: '12/2026/2027', reason: 'Wniosek komisji odwoławczej z 22.10.2026 – egzamin sprawdzający zdany.',
    minutes: { name: 'protokol-komisji.pdf', dataUrl: 'data:application/pdf;base64,JVBERi0xLjQK', size: 240000 }, examDate: '2026-10-22'
  }));
  return { g, r, noMinutes, before };
});

test('[3.3.1] trzydniowe zwolnienie nauczyciela fizyki tworzy zgłoszenie z listą wszystkich lekcji w tym okresie', async () => {
  const expected = lessonsOf((l) => l.teacherId === 'u_wojcik' && l.date >= '2026-10-26' && l.date <= '2026-10-28');
  assert.ok(expected.length >= 6, 'w planie muszą być lekcje fizyka w tym okresie');
  const body = await absence(); absenceId = body.id;
  assert.equal(body.teacherName, 'mgr Adam Wójcik');
  assert.equal(body.assignments.length, expected.length);
  assert.equal(body.lessons.length, expected.length);
  assert.deepEqual([...new Set(body.lessons.map((l) => l.date))].sort(), ['2026-10-26', '2026-10-27', '2026-10-28']);
  assert.ok(body.lessons.every((l) => l.suggestions && l.suggestions.length), 'każda lekcja dostaje propozycje obsady');
  assert.equal(body.stats.open, expected.length);
  const row = S.db.get('substitutions', absenceId);
  assert.equal(row.published, false); assert.equal(row.byUserId, 'u_dyrektor');
  assert.ok(audits((a) => a.action === 'substitution_created' && a.entityId === absenceId).length === 1);
  const bad = await P.post('/api/substitutions', { teacherId: 'u_wojcik', from: '2026-10-28', to: '2026-10-26', reason: 'x' });
  assert.equal(bad.status, 400);
});

test('[3.3.2] ranking: najpierw ten sam przedmiot z wolną godziną, potem przedmiot pokrewny, na końcu nauczyciel z dyżuru', async () => {
  /* fizyka 7a, poniedziałek 1. lekcja — nie ma drugiego fizyka, więc pokrewni przed dyżurnym */
  const sub = expectOk(await P.get('/api/substitutions/' + (await absence()).id));
  const fiz7a = sub.lessons.find((l) => l.classId === '7a' && l.subjectId === 'fiz' && l.date === '2026-10-26');
  const tiers = fiz7a.suggestions.map((s) => s.tier);
  assert.deepEqual(tiers, tiers.slice().sort((a, b) => a - b), 'lista jest uporządkowana wg podstawy doboru');
  const related = fiz7a.suggestions.filter((s) => s.tier === 1);
  const duty = fiz7a.suggestions.find((s) => s.teacherId === 'u_krol');
  assert.ok(related.length >= 1 && related.some((s) => s.teacherId === 'u_gorski'), 'chemik jest przedmiotem pokrewnym fizyki');
  assert.equal(duty.tier, 2); assert.equal(duty.duty, 'szatnia');
  assert.ok(fiz7a.suggestions.indexOf(duty) > fiz7a.suggestions.indexOf(related[0]), 'dyżur dopiero po przedmiotach pokrewnych');
  /* matematyka 7b — jest drugi matematyk (dyrektor) z wolną godziną: trafia na pierwsze miejsce */
  const mat = expectOk(await P.post('/api/substitutions', { teacherId: 'u_nowak', from: '2026-10-29', to: '2026-10-29', reason: 'Szkolenie' }));
  const mat7b = mat.lessons.find((l) => l.classId === '7b' && l.subjectId === 'mat');
  assert.equal(mat7b.suggestions[0].teacherId, 'u_dyrektor');
  assert.equal(mat7b.suggestions[0].tier, 0);
  assert.match(mat7b.suggestions[0].tierLabel, /ten sam przedmiot/);
});

test('[3.3.3] pierwsza lekcja klasy może zostać odwołana, a rodzice wszystkich uczniów dostają powiadomienie', async () => {
  const { sub: r, first, assignment: a, fresh } = await cancelledFirst();
  thuFriId = r.id;
  assert.equal(first.lessonNo, 1); assert.equal(first.first, true);
  assert.equal(a.kind, 'cancel'); assert.equal(a.edge, 'first'); assert.equal(a.paid, false);
  const parents = new Set();
  for (const sid of S.db.get('classes', '7b').studentIds) (S.db.get('students', sid).parentIds || []).forEach((p) => parents.add(p));
  assert.ok(parents.size >= 5);
  assert.equal(fresh.length, a.parentsNotified);
  assert.equal(new Set(fresh.map((n) => n.userId)).size, parents.size, 'powiadomienie dostaje każdy rodzic uczniów klasy');
  assert.ok(fresh.every((n) => parents.has(n.userId) && /odwołana/.test(n.text)));
  /* lekcji w środku planu odwołać nie można */
  const absId = (await absence()).id;
  const middle = expectOk(await P.get('/api/substitutions/' + absId)).lessons.find((l) => l.classId === '7b' && l.lessonNo === 4);
  const no = await P.post(`/api/substitutions/${absId}/assign`, { lessonId: middle.id, kind: 'cancel' });
  assert.equal(no.status, 400); assert.equal(no.body.code, 'not_edge');
});

test('[3.3.4] połączenie dwóch klas w auli pod opieką jednego nauczyciela to jedna płatna godzina doraźna', async () => {
  const { sub, a7b, a8b, who, after } = await combinedClasses();
  assert.equal(a7b.lessonNo, a8b.lessonNo, 'obie lekcje odbywają się o tej samej godzinie');
  const primary = after.assignments.find((x) => x.lessonId === a7b.id), secondary = after.assignments.find((x) => x.lessonId === a8b.id);
  assert.equal(primary.kind, 'combine'); assert.equal(secondary.kind, 'combine');
  assert.equal(primary.substituteTeacherId, who); assert.equal(secondary.substituteTeacherId, who);
  assert.equal(primary.paid, true); assert.equal(secondary.paid, false, 'druga klasa nie generuje drugiej płatnej godziny');
  assert.equal(primary.room, 'aula'); assert.equal(primary.combinedWithLessonId, a8b.id);
  const rates = expectOk(await P.get('/api/payroll/rates'));
  assert.equal(rates.payroll.combinedPay, 1);
  assert.ok(rates.rules.some((x) => /połączone/i.test(x) && /płatna godzina doraźna, a nie dwie/.test(x)));
  assert.ok(rates.teachers.find((t) => t.userId === who).rate > 0);
  /* nie można łączyć lekcji o różnych godzinach */
  const other = sub.lessons.find((l) => l.date === '2026-10-29' && l.classId === '7a');
  const bad = await P.post(`/api/substitutions/${sub.id}/assign`, { lessonId: other.id, kind: 'combine', combineWithLessonId: a8b.id, substituteTeacherId: who });
  assert.equal(bad.status, 400); assert.equal(bad.body.code, 'not_parallel');
});

test('[3.3.5] publikacja planu o ustawionej godzinie zmienia lekcje i powiadamia uczniów, nauczycieli i rodziców', async () => {
  const { id: subId, scheduled: sched, cancelled, statusBeforeDue, run, fresh } = await publishedPlan();
  thuFriId = subId;
  assert.equal(sched.scheduled, true, 'publikacja na później nie zmienia jeszcze planu');
  assert.notEqual(statusBeforeDue, 'cancelled');
  assert.ok(run.published >= 1);
  const row = S.db.get('substitutions', thuFriId);
  assert.equal(row.published, true); assert.ok(row.publishedAt);
  assert.equal(S.db.get('lessons', cancelled.id).status, 'cancelled');
  for (const a of row.assignments.filter((x) => x.substituteTeacherId)) {
    const l = S.db.get('lessons', a.lessonId);
    assert.equal(l.status, 'substituted'); assert.equal(l.substituteTeacherId, a.substituteTeacherId);
  }
  assert.ok(fresh.length > 10);
  assert.ok(fresh.some((n) => n.userId === 'u_p_kowalczyk'), 'rodzice widzą zmianę');
  assert.ok(fresh.some((n) => n.userId === 'u_st_kowalczyk_anna' || S.db.get('users', n.userId).role === 'student'), 'uczniowie widzą zmianę');
  assert.ok(fresh.some((n) => n.userId === 'u_wojcik'), 'nieobecny nauczyciel dostaje informację o publikacji');
  /* plan na dzień uwzględnia zastępstwa */
  const tt = expectOk(await P.get('/api/substitutions/timetable/2026-10-29?classId=7b'));
  assert.equal(tt.date, '2026-10-29');
  assert.equal(tt.lessons.find((l) => l.lessonNo === 1).status, 'cancelled');
  assert.ok(tt.changed >= 1);
  const tt8b = expectOk(await P.get('/api/substitutions/timetable/2026-10-30?classId=8b'));
  const combined = tt8b.lessons.find((l) => l.subjectId === 'fiz');
  assert.equal(combined.status, 'substituted'); assert.equal(combined.room, 'aula'); assert.ok(combined.substituteName);
});

/* Opublikowane zastępstwo to zmiana w planie ucznia. Dopóki publikacja nie stemplowała lekcji
   (`changedAt`), ekran „zmiany w planie” (3.6.5) pokazywał wyłącznie zmiany wpisane ręcznie
   w zasiewie demo, a prawdziwe zastępstwo docierało do ucznia tylko powiadomieniem. */
test('[3.3.5] opublikowane zastępstwo pojawia się na ekranie zmian ucznia, nie tylko w powiadomieniu', async () => {
  const { cancelled } = await publishedPlan();
  const anna = await S.as('anna.kowalczyk');
  const seen = expectOk(await anna.get('/api/student/changes'));
  const row = seen.changes.find((x) => x.lessonId === cancelled.id);
  assert.ok(row, 'odwołana lekcja jest na liście zmian ucznia: ' + JSON.stringify(seen.changes.map((x) => x.lessonId)));
  assert.equal(row.kind, 'cancel');
  assert.ok(row.changedAt, 'zmiana ma znacznik czasu');
  const sub = seen.changes.find((x) => x.kind === 'sub');
  assert.ok(sub, 'zastępstwa też są widoczne jako zmiana planu');
  assert.match(sub.text, /Zastępstwo/);
  const lesson = S.db.get('lessons', cancelled.id);
  assert.ok(lesson.changeReason, 'powód zmiany zapisany przy lekcji');
});

test('[3.3.6] miesięczne rozliczenie godzin ponadwymiarowych i doraźnych zastępstw wg Karty Nauczyciela', async () => {
  await publishedPlan();                     // rozliczenie obejmuje opłacone zastępstwa z 3.3.5
  const s = expectOk(await P.get('/api/payroll/settlement?month=2026-10'));
  assert.equal(s.month, '2026-10'); assert.equal(s.from, '2026-10-01'); assert.equal(s.to, '2026-10-31');
  assert.match(s.legalBasis, /Karta Nauczyciela/);
  const sikora = s.rows.find((r) => r.teacherId === 'u_sikora');
  assert.ok(sikora.adHocHours >= 4, 'zastępstwa za mgr Król z 5–6.10 są rozliczone');
  assert.equal(sikora.adHocAmount, Math.round(sikora.adHocHours * sikora.adHocRate * 100) / 100);
  assert.equal(sikora.level, 'dyplomowany');
  assert.equal(sikora.total, Math.round((sikora.overtimeAmount + sikora.adHocAmount) * 100) / 100);
  const overtime = s.rows.find((r) => r.overtimeHours > 0);
  assert.ok(overtime, 'ktoś pracuje ponad pensum');
  assert.equal(overtime.overtimeAmount, Math.round(overtime.overtimeHours * overtime.rate * 100) / 100);
  /* połączone klasy: jedna płatna godzina, druga policzona jako oszczędność */
  const combinedRow = s.rows.find((r) => r.combinedSaved > 0);
  assert.ok(combinedRow && combinedRow.combinedSaved >= 1);
  assert.equal(s.totals.amount, Math.round(s.rows.reduce((x, r) => x + r.total, 0) * 100) / 100);
  const bad = await P.get('/api/payroll/settlement?month=pazdziernik'); assert.equal(bad.status, 400);
});

test('[3.3.7] eksport rozliczenia do systemu kadrowo-płacowego: CSV i XML', async () => {
  const csv = await P.get('/api/payroll/settlement/export?month=2026-10&format=csv');
  assert.equal(csv.status, 200);
  assert.match(csv.headers.get('content-disposition'), /rozliczenie-2026-10\.csv/);
  const bytes = Buffer.from(await (await fetch(S.base + '/api/payroll/settlement/export?month=2026-10&format=csv', { headers: { Cookie: P.cookie } })).arrayBuffer());
  assert.equal(bytes.subarray(0, 3).toString('hex'), 'efbbbf', 'CSV w UTF-8 z BOM dla arkuszy kadrowych');
  assert.match(csv.body.split('\r\n')[0], /Nauczyciel;Rola;Stopień awansu;Pensum/);
  assert.match(csv.body, /mgr Beata Sikora/);
  assert.match(csv.body, /RAZEM/);
  const xml = await P.get('/api/payroll/settlement/export?month=2026-10&format=xml');
  assert.equal(xml.status, 200);
  assert.match(xml.headers.get('content-disposition'), /rozliczenie-2026-10\.xml/);
  assert.match(xml.body, /^<\?xml version="1\.0" encoding="UTF-8"\?>/);
  assert.match(xml.body, /<Rozliczenie okres="2026-10"/);
  assert.match(xml.body, /<GodzinyDorazne stawka="[\d.]+">\d+<\/GodzinyDorazne>/);
  assert.match(xml.body, /<Podsumowanie /);
  assert.ok(audits((a) => a.action === 'payroll_exported').length >= 2);
  const print = await P.get('/api/payroll/settlement/print?month=2026-10');
  assert.match(print.headers.get('content-type'), /text\/html/);
  assert.match(print.body, /Rozliczenie godzin ponadwymiarowych/);
});

/* ------------------------------------------------------------------ 3.3.8–3.3.20 nadzór, audyt, komunikaty */

test('[3.3.8] audyt kompletności tematów i frekwencji za miniony tydzień z nazwiskami nauczycieli', async () => {
  /* przygotowanie: lekcja z minionego tygodnia bez tematu i bez frekwencji */
  const gap = lesson((l) => l.classId === '7b' && l.subjectId === 'mat' && l.date >= '2026-10-16' && l.date < '2026-10-23');
  gap.topic = null;
  S.db.data.attendance = S.db.col('attendance').filter((a) => a.lessonId !== gap.id);
  const r = expectOk(await P.get('/api/principal/completeness'));
  assert.equal(r.to, '2026-10-22'); assert.equal(r.from, '2026-10-16');
  const row = r.rows.find((x) => x.lessonId === gap.id);
  assert.ok(row, 'lekcja z brakami trafia na listę rozbieżności');
  assert.equal(row.missingTopic, true); assert.equal(row.missingAttendance, true);
  assert.equal(row.teacherName, 'mgr Joanna Nowak');
  assert.equal(row.className, '7b');
  assert.ok(r.totals.missingTopic >= 1 && r.totals.missingAttendance >= 1);
  const group = r.groups.find((g) => g.teacherId === 'u_nowak' && g.classId === '7b');
  assert.ok(group && group.missingTopic >= 1);
  const scoped = expectOk(await P.get('/api/principal/completeness?from=2026-10-19&to=2026-10-20'));
  assert.ok(scoped.rows.every((x) => x.date >= '2026-10-19' && x.date <= '2026-10-20'));
  assert.equal((await (await S.as('j.nowak')).get('/api/principal/completeness')).status, 403);
});

/* OPS-13 w audycie kompletności: `studentsOfLesson` liczył cały oddział, a listę obecności
   wypełniają tylko ci uczniowie, którzy danego dnia byli już uczniami szkoły. Uczeń przyjęty
   w listopadzie robił więc z każdej wrześniowej lekcji „frekwencję częściową” — i to na zawsze.
   Data przyjęcia liczy się tak samo, gdy zapisał ją sekretariat (`enrolledAt`) i gdy wychowawca
   dopisał ucznia w trakcie roku (`joinedAt`). */
test('[3.3.8] OPS-13: uczeń przyjęty w trakcie roku nie robi braków w lekcjach sprzed przyjęcia', async () => {
  const B = await startServer();
  try {
    const P2 = await B.as('dyrektor');
    const U = require('../server/lib/util');
    const DAY = '2026-10-19', NEXT = '2026-10-20';
    const cls = B.db.get('classes', '7b');
    const mine = B.db.col('lessons').filter((l) => l.classId === '7b' && (l.date === DAY || l.date === NEXT) && !l.groupId && l.teacherId === 'u_nowak');
    const first = mine.find((l) => l.date === DAY), second = mine.find((l) => l.date === NEXT);
    assert.ok(first && second, 'dwie lekcje matematyki w 7b: ' + mine.map((l) => l.date).join(','));
    const t = await B.as('j.nowak');
    for (const l of [first, second]) {
      expectOk(await t.patch('/api/lessons/' + l.id, { topic: 'Lekcja kontrolna do audytu kompletności.' }));
      expectOk(await t.post('/api/attendance/lesson/' + l.id, { allPresent: true }));
    }
    const before = expectOk(await P2.get(`/api/principal/completeness?from=${DAY}&to=${NEXT}`));
    assert.ok(!before.rows.some((x) => x.lessonId === first.id || x.lessonId === second.id), 'obie lekcje są kompletne: ' + JSON.stringify(before.rows.map((x) => x.lessonId)));

    /* uczeń przyjęty nazajutrz po pierwszej lekcji */
    B.db.col('students').push({ id: 'st_pilot_nowy', rollNo: 99, firstName: 'Nowy', lastName: 'Uczen', classId: '7b',
      status: 'active', enrolledAt: NEXT, registerNo: 9999, parentIds: [], achievements: [], declension: {} });
    cls.studentIds.push('st_pilot_nowy'); B.db.save();

    const after = expectOk(await P2.get(`/api/principal/completeness?from=${DAY}&to=${NEXT}`));
    const one = after.rows.find((x) => x.lessonId === first.id);
    assert.ok(!one, 'lekcja sprzed przyjęcia zostaje kompletna');
    const two = after.rows.find((x) => x.lessonId === second.id);
    assert.ok(two && two.partialAttendance, 'od dnia przyjęcia brakujący wpis jest zgłaszany');
    assert.equal(two.expected, two.entries + 1);
    /* ta sama zasada dla `joinedAt`, którym posługuje się wychowawca */
    const s2 = B.db.get('students', 'st_pilot_nowy');
    delete s2.enrolledAt; s2.joinedAt = NEXT; B.db.save();
    const viaJoined = expectOk(await P2.get(`/api/principal/completeness?from=${DAY}&to=${DAY}`));
    assert.ok(!viaJoined.rows.some((x) => x.lessonId === first.id), '`joinedAt` działa tak samo jak `enrolledAt`');
    assert.ok(U.addDays(DAY, 1) === NEXT);
  } finally { await B.close(); }
});

/* REL-01 — audyt kompletności był O(lekcje × frekwencja): 571 lekcji semestru przeglądanych przy
   50 000 wpisów frekwencji kosztowało ~0,7–0,9 s w jednym wątku (a przy pełnym roczniku szkoły —
   minuty, w czasie których nikt inny nie jest obsługiwany). Ten test broni indeksu na Mapach:
   własny serwer, żeby 50 tysięcy wierszy nie zostało w bazie pozostałych testów. */
/* Budżet w milisekundach na współdzielonej maszynie nie jest dowodem na istnienie indeksu:
   ten test przewracał się na 621 ms wobec zaszytych 500 ms w trzech z sześciu równoległych
   przebiegów (docs/review/round3/test-honesty.md §4.1) — i przewróciłby się tak samo, gdyby
   indeks był na miejscu. Mierzymy więc KSZTAŁT pracy względem punktu odniesienia wziętego
   w tym samym przebiegu: jednego liniowego przejścia po kolekcji frekwencji. Audyt sprawdza
   ponad 500 lekcji; bez indeksu na Mapie kosztowałby jedno takie przejście NA LEKCJĘ. */
test('[3.3.8] REL-01: audyt kompletności szuka frekwencji po indeksie, a nie przechodzi kolekcji raz na lekcję', async () => {
  const B = await startServer();
  try {
    const att = B.db.col('attendance'), lessons = B.db.col('lessons');
    assert.ok(lessons.length > 500, 'rocznik ma z czego liczyć');
    for (let i = att.length; i < 50000; i++) {
      const l = lessons[i % lessons.length];
      att.push({ id: 'perf_' + i, lessonId: l.id, studentId: 'st_perf_' + (i % 300), date: l.date, lessonNo: l.lessonNo,
        classId: l.classId, subjectId: l.subjectId, status: 'ob', minutes: 0, draft: false, byUserId: 'u_nowak', at: l.date + 'T08:00:00.000Z' });
    }
    B.db.save();
    assert.ok(B.db.col('attendance').length >= 50000);
    const cfg = B.db.data.config;
    const from = cfg.semesters[0].from, to = cfg.semesters[cfg.semesters.length - 1].to;
    const dyr = await B.as('dyrektor');
    const url = (a, b) => `/api/principal/completeness?from=${a}&to=${b}`;
    const twoDays = from.slice(0, 8) + String(+from.slice(8, 10) + 1).padStart(2, '0');
    expectOk(await dyr.get(url(from, to)), 'rozgrzewka');           // pierwszy przebieg pomijamy (JIT)
    /* Ten sam audyt na całym roku i na dwóch dniach, na przemian, żeby obciążenie maszyny
       dotykało obu pomiarów tak samo. Interesuje nas NACHYLENIE: ile kosztuje każda kolejna
       sprawdzana lekcja. */
    let full = Infinity, short = Infinity, nFull = 0, nShort = 0;
    for (let k = 0; k < 3; k++) {
      let t0 = Date.now(); let r = expectOk(await dyr.get(url(from, to)));
      full = Math.min(full, Date.now() - t0); nFull = r.lessonsChecked;
      assert.ok(r.lessonsChecked > 500, 'liczony jest cały semestr, nie tydzień');
      t0 = Date.now(); r = expectOk(await dyr.get(url(from, twoDays)));
      short = Math.min(short, Date.now() - t0); nShort = r.lessonsChecked;
    }
    assert.ok(nShort > 0 && nFull / nShort > 10, `krótki zakres ma być naprawdę krótki (${nShort} z ${nFull} lekcji)`);
    /* punkt odniesienia: JEDNO przejście po tych samych 50 000 wierszach, tu i teraz */
    let pass = Infinity;
    for (let k = 0; k < 3; k++) {
      const t0 = process.hrtime.bigint();
      B.db.col('attendance').filter((a) => a.lessonId === 'nie-ma-takiej-lekcji');
      pass = Math.min(pass, Number(process.hrtime.bigint() - t0) / 1e6);
    }
    const perLesson = (full - short) / (nFull - nShort);
    /* Bez indeksu każda dodatkowa lekcja kosztuje CO NAJMNIEJ jedno takie przejście —
       to jest cała treść tej asercji, niezależna od tego, jak zajęta jest maszyna. */
    assert.ok(perLesson < pass,
      `każda kolejna sprawdzana lekcja kosztuje ${perLesson.toFixed(2)} ms, a jedno przejście po kolekcji frekwencji ${pass.toFixed(2)} ms ` +
      `(${nFull} lekcji: ${full} ms, ${nShort} lekcji: ${short} ms) — tak wygląda skan zamiast indeksu na Mapie`);
  } finally { await B.close(); }
});

test('[3.3.9] realizacja podstawy programowej w procentach dla przedmiotu i klasy', async () => {
  const mats = lessonsOf((l) => l.classId === '7b' && l.subjectId === 'mat' && l.date < '2026-10-23').slice(0, 3);
  mats.forEach((l, i) => { l.curriculumItemIds = ['cur_mat7_' + (i + 1)]; });
  const r = expectOk(await P.get('/api/principal/curriculum?semester=1'));
  assert.equal(r.semester, 1);
  assert.ok(r.expectedPercent > 0 && r.expectedPercent < 100);
  const row = r.rows.find((x) => x.classId === '7b' && x.subjectId === 'mat');
  assert.equal(row.plannedHours, 80, 'suma godzin jednostek tematycznych matematyki kl. 7');
  assert.ok(row.doneHours >= 3);
  assert.equal(row.percent, Math.round((row.doneHours / row.plannedHours) * 1000) / 10);
  assert.ok(row.itemsCovered >= 3 && row.itemsTotal === 8);
  assert.ok(row.items.find((i) => i.id === 'cur_mat7_1').covered);
  assert.equal(typeof row.behind, 'boolean');
  assert.ok(r.rows.some((x) => x.subjectId === 'fiz'), 'fizyka też jest monitorowana');
});

test('[3.3.10] unieważnienie oceny klasyfikacyjnej z egzaminem sprawdzającym i protokołem komisji', async () => {
  const { g, r, noMinutes: bad, before } = await invalidatedGrade();
  assert.equal(bad.status, 400); assert.equal(bad.body.code, 'no_minutes');
  const old = S.db.get('grades', g.id);
  assert.equal(old.deleted, true); assert.equal(old.invalidated, true); assert.equal(old.appealProtocolNo, '12/2026/2027');
  assert.equal(r.grade.value, '4'); assert.equal(r.grade.kind, 'midterm'); assert.equal(r.grade.semester, 1);
  assert.equal(r.grade.appeal.protocolNo, '12/2026/2027');
  assert.match(r.grade.appeal.minutes.dataUrl, /^data:application\/pdf/);
  const a = audits((x) => x.action === 'classification_grade_invalidated' && x.entityId === g.id)[0];
  assert.ok(a); assert.equal(a.before.value, '2'); assert.equal(a.after.value, '4'); assert.match(a.reason, /komisji odwoławczej/);
  assert.ok(notifs((n) => n.userId === 'u_p_kowalczyk').length > before, 'rodzic dostaje informację o zmianie oceny');
  const again = await P.post(`/api/principal/grades/${g.id}/invalidate`, { value: '5', protocolNo: '13', reason: 'x', minutes: { dataUrl: 'data:,' } });
  assert.equal(again.status, 409);
});

/* REG-12 — decyzja produktowa: powierzenie działa WYŁĄCZNIE w swoim terminie [from, to] (obie daty
   włącznie, liczone dniem szkolnym). Powierzenie podpisane z wyprzedzeniem nie daje praw przed
   pierwszym dniem, a wygasłe przestaje je dawać samo, bez ręcznego cofania przez dyrektora. */
test('[3.3.11] powierzenie obowiązków wychowawcy z terminami, bez przenoszenia odpowiedzialności', async () => {
  const gorski = () => S.db.get('users', 'u_gorski');
  const r = expectOk(await P.post('/api/principal/classes/7b/acting-homeroom', { teacherId: 'u_gorski', from: '2026-10-20', to: '2026-12-18', reason: 'Długotrwała nieobecność wychowawcy' }));
  const cls = S.db.get('classes', '7b');
  assert.equal(cls.actingHomeroomTeacherId, 'u_gorski');
  assert.equal(cls.actingFrom, '2026-10-20'); assert.equal(cls.actingTo, '2026-12-18');
  assert.equal(cls.homeroomTeacherId, 'u_nowak', 'wychowawca z arkusza organizacyjnego pozostaje bez zmian');
  assert.equal(r.homeroomTeacherName, 'mgr Joanna Nowak');
  assert.equal(r.actingHomeroomTeacherName, 'mgr Tomasz Górski');
  assert.match(r.responsibility, /Odpowiedzialność prawna/);
  assert.equal(D.isHomeroomOf(S.db, gorski(), '7b'), true, 'dzień szkoły (23.10) mieści się w terminie');
  assert.equal(S.db.get('users', 'u_gorski').actingHomeroomOf, '7b');
  assert.ok(notifs((n) => n.userId === 'u_gorski' && /wychowawcy klasy 7b/.test(n.text)).length >= 1);
  assert.ok(audits((x) => x.action === 'acting_homeroom_assigned' && x.entityId === '7b').length === 1);
  /* dzień po terminie: powierzenie wygasa samo */
  await withConfig(S.db, { today: '2026-12-19' }, () => {
    assert.equal(D.isHomeroomOf(S.db, gorski(), '7b'), false, 'po terminie powierzenie już nie działa');
  });

  /* powierzenie podpisane z wyprzedzeniem: prawa wchodzą dopiero w swoim terminie */
  expectOk(await P.post('/api/principal/classes/7b/acting-homeroom', { teacherId: 'u_gorski', from: '2026-11-02', to: '2026-11-30', reason: 'Zaplanowana nieobecność wychowawcy' }));
  assert.equal(D.isHomeroomOf(S.db, gorski(), '7b'), false, 'przed pierwszym dniem powierzenia — jeszcze nie');
  await withConfig(S.db, { today: '2026-11-10' }, () => {
    assert.equal(D.isHomeroomOf(S.db, gorski(), '7b'), true, 'w terminie — tak');
  });
  await withConfig(S.db, { today: '2026-11-30' }, () => {
    assert.equal(D.isHomeroomOf(S.db, gorski(), '7b'), true, 'ostatni dzień terminu należy jeszcze do powierzenia');
  });

  expectOk(await P.delete('/api/principal/classes/7b/acting-homeroom'));
  assert.equal(S.db.get('classes', '7b').actingHomeroomTeacherId, null);
  assert.equal(S.db.get('users', 'u_gorski').actingHomeroomOf, undefined);
});

test('[3.3.12] komunikat globalny wymaga potwierdzenia i blokuje inne widoki do czasu odczytu', async () => {
  /* „Blokuje inne widoki” to nie jest samo pole w sesji — powłoka musi renderować komunikat
     ZAMIAST ekranu i w oknie modalnym bez wyjścia. Sprawdzamy jedno i drugie w public/app/shell.js. */
  const fs = require('node:fs'); const path = require('node:path');
  const shell = fs.readFileSync(path.join(__dirname, '..', 'public', 'app', 'shell.js'), 'utf8');
  const ann = shell.slice(shell.indexOf('function Announcement'), shell.indexOf('function Announcement') + 1200);
  assert.ok(ann.startsWith('function Announcement'), 'powłoka ma komponent Announcement');
  assert.match(ann, /E\.Dialog, \{[^}]*blocking: true/, 'komunikat jest oknem modalnym z blocking: true');
  assert.ok(!/onClose/.test(ann.split('actions:')[0]), 'okno komunikatu nie ma drogi wyjścia bez potwierdzenia');
  assert.match(ann, /\/ack'\)/, 'jedyny przycisk potwierdza komunikat');
  assert.match(shell, /var pending = s\.pendingAnnouncement;/, 'powłoka czyta pendingAnnouncement z sesji');
  assert.match(shell, /pending && h\(Announcement, \{ a: pending \}\)/, 'komunikat renderuje się zawsze, gdy sesja go zgłasza');
  /* a „blokuje” naprawdę blokuje: E.Dialog z blocking nie zamyka się Escapem i trzyma fokus w oknie */
  const bundle = fs.readFileSync(path.join(__dirname, '..', 'public', 'edmat', 'bundle.js'), 'utf8');
  assert.match(bundle, /if \(e\.key === 'Escape'\) \{ if \(!p\.blocking && !p\.timeout\)/, 'Escape nie zamyka okna blokującego');
  assert.match(bundle, /p\.blocking \|\| p\.timeout \? 'alertdialog' : 'dialog'/, 'okno blokujące ma rolę alertdialog');
  assert.match(bundle, /'aria-modal': 'true'/, 'okno jest modalne dla technologii asystujących');
  assert.match(bundle, /e\.key === 'Tab'/, 'fokus nie wychodzi poza okno');

  const parent = await S.as('rodzic.kowalczyk');
  let ses = expectOk(await parent.get('/api/auth/session'));
  assert.equal(ses.pendingAnnouncement.id, 'p_ann_regulamin', 'rodzic widzi zaległy komunikat');
  // dopóki nie ma potwierdzenia, KAŻDY odczyt sesji przypomina o komunikacie — pole nie znika po jednym renderze
  assert.equal(expectOk(await parent.get('/api/auth/session')).pendingAnnouncement.id, 'p_ann_regulamin');
  assert.equal(expectOk(await parent.get('/api/parent/children')).children.length, 2, 'dane wciąż są dostępne po API — blokada jest w powłoce, nie na trasach');
  expectOk(await parent.post('/api/announcements/p_ann_regulamin/ack'));
  ses = expectOk(await parent.get('/api/auth/session'));
  assert.equal(ses.pendingAnnouncement, undefined, 'po potwierdzeniu widoki są odblokowane');
  assert.ok(S.db.get('announcements', 'p_ann_regulamin').ackBy.u_p_kowalczyk);
  /* komunikat z zasiewu jest dla rodziców i uczniów — kadra nie zaczyna pracy od okna blokującego */
  assert.deepEqual(S.db.get('announcements', 'p_ann_regulamin').audience, ['parent', 'student']);
  assert.equal((await P.get('/api/auth/session')).body.pendingAnnouncement, undefined, 'dyrektor nie ma zaległego komunikatu');
  const teacher = await S.as('j.nowak');
  assert.equal((await teacher.get('/api/auth/session')).body.pendingAnnouncement, undefined, 'nauczyciel nie ma zaległego komunikatu');
  /* drugi komunikat kadrowy z zasiewu daje karcie statystyk dane pracownicze (potwierdzony w 100 %) */
  const staffStats = expectOk(await P.get('/api/announcements/p_ann_rada_kalendarz/acks'));
  assert.deepEqual(staffStats.audience, ['staff']);
  assert.ok(staffStats.audienceCount >= 10 && staffStats.byRole.staff.total === staffStats.byRole.staff.acked);
  assert.equal(staffStats.percent, 100);
  /* nowy komunikat dyrekcji */
  const a = expectOk(await P.post('/api/announcements', { title: 'Zebranie z rodzicami 12.11.2026', body: 'Zebrania odbędą się we wszystkich klasach o 17:00.', requiresAck: true, audience: ['parent', 'staff'] }));
  assert.equal(a.requiresAck, true); assert.ok(a.recipients > 5);
  const ses2 = expectOk(await parent.get('/api/auth/session'));
  assert.equal(ses2.pendingAnnouncement.id, a.id);
  assert.equal(ses2.pendingAnnouncement.title, 'Zebranie z rodzicami 12.11.2026');
  const stats0 = expectOk(await P.get(`/api/announcements/${a.id}/acks`));
  assert.equal(stats0.ackedCount, 1, 'autor komunikatu ma je potwierdzone z urzędu');
  expectOk(await parent.post(`/api/announcements/${a.id}/ack`));
  const stats = expectOk(await P.get(`/api/announcements/${a.id}/acks`));
  assert.equal(stats.ackedCount, 2);
  assert.ok(stats.audienceCount > stats.ackedCount);
  assert.ok(stats.percent > 0 && stats.percent < 100);
  assert.ok(stats.acked.some((x) => x.userId === 'u_p_kowalczyk'));
  assert.ok(stats.pending.some((x) => x.role === 'teacher'));
  assert.ok(stats.byRole.parent.total >= 7);
  assert.equal((await parent.get('/api/auth/session')).body.pendingAnnouncement, undefined);
  assert.ok(audits((x) => x.action === 'announcement_acknowledged' && x.userId === 'u_p_kowalczyk').length >= 2);
});

test('[3.3.13] dziennik psychologa i pedagoga: statystyki i dokumenty tak, treść notatek poufnych nie', async () => {
  const psych = S.db.get('users', 'u_zielinska');
  const secret = 'Uczeń zgłosił konflikt w domu; ustalono plan wsparcia.';
  S.db.col('confidentialNotes').push({ id: 'p_note_test', studentId: 'st_nowak_jan', authorId: 'u_zielinska', kind: 'interwencja', title: 'Notatka z interwencji', at: '2026-10-19T11:05:00Z', readers: ['u_zielinska'], envelope: C.encryptForReaders(secret, [{ userId: psych.id, publicKey: psych.publicKey }]) });
  const r = expectOk(await P.get('/api/principal/specialist-log'));
  const zielinska = r.specialists.find((s) => s.userId === 'u_zielinska');
  assert.ok(zielinska, 'psycholog jest w zestawieniu');
  assert.equal(typeof zielinska.consultations, 'number');
  assert.ok(zielinska.activities >= 0 && r.totals.consultations >= 0);
  const note = r.notes.find((n) => n.id === 'p_note_test');
  assert.equal(note.sealed, true); assert.equal(note.alg, 'AES-256-GCM+RSA-OAEP');
  assert.equal(note.authorName, 'mgr Ewa Zielińska'); assert.equal(note.readers, 1);
  const json = JSON.stringify(r);
  assert.ok(!json.includes(secret) && !json.includes('ciphertext') && !json.includes('wrappedKeys'), 'żadnej treści ani materiału kryptograficznego');
  assert.ok(Array.isArray(r.documents));
  assert.match(r.access, /Treści notatek poufnych nie obejmuje/);
  const denied = await P.get('/api/principal/specialist-log/notes/p_note_test');
  assert.equal(denied.status, 403); assert.equal(denied.body.code, 'sealed');
  assert.ok(audits((x) => x.action === 'confidential_note_access_denied' && x.entityId === 'p_note_test').length === 1);
});

test('[3.3.14] monitor obciążenia sprawdzianami wykrywa klasy ponad limitem w dniu i w tygodniu', async () => {
  const r = expectOk(await P.get('/api/principal/test-load?weeks=4'));
  assert.equal(r.limits.perDay, S.db.data.config.testLimits.perDay);
  assert.equal(r.limits.perWeek, S.db.data.config.testLimits.perWeek);
  const b8 = r.rows.find((x) => x.classId === '8b');
  assert.ok(b8.exceeded, 'klasa 8b przekracza limity');
  assert.ok(b8.overDays.some((d) => d.date === '2026-10-13' && d.count > r.limits.perDay));
  assert.ok(b8.overWeeks.some((w) => w.from === '2026-10-12' && w.count > r.limits.perWeek));
  assert.equal(r.rows[0].classId, '8b', 'klasy z największą liczbą naruszeń są na górze listy');
  assert.ok(b8.detail.every((d) => d.date >= r.from && d.date <= r.to));
  assert.ok(b8.detail.some((d) => d.teacherName && d.subjectName));
  assert.ok(r.totals.exceeded >= 1);
});

test('[3.3.15] zatwierdzenie wycieczki wpisuje uczniom status „w” i tworzy zastępstwa za opiekunów', async () => {
  const list = expectOk(await P.get('/api/principal/trips'));
  const trip = list.trips.find((t) => t.id === 'p_trip_zakopane') || list.trips.find((t) => t.status === 'submitted');
  assert.ok(trip, 'jest złożony plan wycieczki do zatwierdzenia');
  const r = expectOk(await P.post(`/api/principal/trips/${trip.id}/approve`, { reason: 'Zgodnie z regulaminem wycieczek' }));
  assert.equal(r.trip.status, 'approved'); assert.ok(r.trip.approvedAt);
  assert.ok(r.attendanceMarked > 0);
  const sid = trip.studentIds[0];
  const marks = S.db.col('attendance').filter((a) => a.studentId === sid && a.date >= trip.from && a.date <= trip.to);
  assert.ok(marks.length >= 1 && marks.every((m) => m.status === 'w'), 'uczeń ma status „w” na lekcjach w dniach wyjazdu');
  assert.equal(marks[0].tripId, trip.id);
  const leader = r.substitutions.find((x) => x.teacherId === trip.leaderId);
  assert.ok(leader && leader.lessons > 0, 'lekcje kierownika mają przygotowane zastępstwa');
  assert.equal(leader.filled, leader.lessons);
  const row = S.db.get('substitutions', leader.id);
  assert.ok(row.assignments.every((a) => a.substituteTeacherId && a.substituteTeacherId !== trip.leaderId));
  assert.equal(row.tripId, trip.id);
  assert.ok(notifs((n) => n.kind === 'trip' && n.userId === 'u_p_kowalczyk').length >= 1);
  assert.ok(audits((x) => x.action === 'trip_approved' && x.entityId === trip.id).length === 1);
  assert.equal((await P.post(`/api/principal/trips/${trip.id}/approve`, {})).status, 409);
});

test('[3.3.16] przegląd rejestru audytowego z filtrami: IP, data, użytkownik, edycje i usunięcia ocen i frekwencji', async () => {
  await invalidatedGrade();                  // wiersz classification_grade_invalidated z 3.3.10
  audit(S.db, { action: 'grade_update', entity: 'grades', entityId: 'gr_demo', userId: 'u_nowak', ip: '10.0.12.44', before: { value: '3' }, after: { value: '4' }, reason: 'Pomyłka przy wpisie' });
  audit(S.db, { action: 'attendance_delete', entity: 'attendance', entityId: 'att_demo', userId: 'u_wojcik', ip: '10.0.12.51', before: { status: 'nb' }, after: null, reason: 'Uczeń reprezentował szkołę' });
  const all = expectOk(await P.get('/api/principal/audit'));
  assert.equal(all.total, S.db.col('audit').length, 'bez filtru rejestr pokazuje całość historii');
  assert.ok(all.actions.includes('grade_update'));
  const byIp = expectOk(await P.get('/api/principal/audit?ip=10.0.12.4'));
  assert.ok(byIp.rows.length >= 1 && byIp.rows.every((x) => x.ip.startsWith('10.0.12.4')));
  assert.equal(byIp.rows[0].actor, 'mgr Joanna Nowak');
  const byUser = expectOk(await P.get('/api/principal/audit?userId=u_wojcik'));
  assert.ok(byUser.rows.length >= 1 && byUser.rows.every((x) => x.userId === 'u_wojcik'));
  const edits = expectOk(await P.get('/api/principal/audit?action=edit_or_delete'));
  assert.ok(edits.rows.some((x) => x.action === 'grade_update' && x.kind === 'edit'));
  assert.ok(edits.rows.some((x) => x.action === 'attendance_delete' && x.kind === 'delete'));
  assert.ok(edits.rows.some((x) => x.action === 'classification_grade_invalidated'));
  assert.ok(edits.rows.every((x) => ['edit', 'delete'].includes(x.kind)));
  const grades = expectOk(await P.get('/api/principal/audit?entity=grades&action=edit_or_delete'));
  assert.ok(grades.rows.length >= 2 && grades.rows.every((x) => x.entity === 'grades'));
  const row = grades.rows.find((x) => x.action === 'grade_update');
  assert.deepEqual(row.before, { value: '3' }); assert.deepEqual(row.after, { value: '4' });
  /* Filtr dat: zakres „od 2020 do dziś” obejmuje wszystko i nie dowodzi niczego. Sprawdzamy okno,
     które musi być puste, i okno jednodniowe, które musi zawierać wyłącznie wpisy z tego dnia. */
  const today = S.db.data.config.today;
  const everything = expectOk(await P.get('/api/principal/audit?limit=500'));
  const ancient = expectOk(await P.get('/api/principal/audit?from=2000-01-01&to=2000-12-31'));
  assert.equal(ancient.total, 0, 'okno sprzed istnienia szkoły nie może zwracać wpisów');
  const wallToday = new Date().toISOString().slice(0, 10);   // wpisy audytu mają znacznik zegara, nie „dziś” ze szkoły
  const oneDay = expectOk(await P.get(`/api/principal/audit?from=${wallToday}&to=${wallToday}&limit=500`));
  assert.ok(oneDay.total >= 1, 'dzisiejsze wpisy mieszczą się w oknie jednodniowym');
  assert.ok(oneDay.rows.every((x) => x.at.slice(0, 10) === wallToday), 'okno jednodniowe zwraca wyłącznie wpisy z tego dnia');
  assert.ok(oneDay.total <= everything.total);
  assert.equal(expectOk(await P.get(`/api/principal/audit?from=${today}&to=${today}`)).filters.from, today);
  const none = expectOk(await P.get('/api/principal/audit?ip=203.0.113.9'));
  assert.equal(none.rows.length, 0);
});

test('[3.3.17] roczny pakiet archiwalny XML + wydruk, opieczętowany i weryfikowalny, tylko w terminie', async () => {
  const w = expectOk(await P.get('/api/principal/archive'));
  assert.equal(w.window.from, S.db.data.config.semesters[1].to);
  assert.equal(w.window.open, false, 'poza oknem 10 dni od zakończenia zajęć');
  const closed = await P.post('/api/principal/archive', { year: '2026/2027' });
  assert.equal(closed.status, 403); assert.equal(closed.body.code, 'window_closed');
  const pkg = expectOk(await P.post('/api/principal/archive', { year: '2026/2027', force: true, reason: 'Prezentacja dla organu prowadzącego' }));
  assert.equal(pkg.forced, true); assert.match(pkg.forceNote, /poza ustawowym terminem/);
  assert.ok(pkg.bytes > 500); assert.equal(pkg.seal.alg, 'RSA-SHA256');
  const xml = await P.get(`/api/principal/archive/${pkg.id}/xml`);
  assert.match(xml.headers.get('content-type'), /xml/);
  assert.match(xml.body, /<DziennikElektroniczny rok="2026\/2027"/);
  assert.match(xml.body, /<Klasa id="7b"/); assert.match(xml.body, /<Uczen id="st_kowalczyk_anna"/);
  assert.match(xml.body, /<Frekwencja wpisow=/); assert.match(xml.body, /<Oceny liczba=/);
  assert.equal(C.verifySeal(xml.body, pkg.seal, S.db.data.config.schoolPublicKey), true, 'pieczęć weryfikuje się kluczem publicznym szkoły');
  const v = expectOk(await P.get(`/api/principal/archive/${pkg.id}/verify`));
  assert.equal(v.valid, true); assert.equal(v.digest, pkg.seal.digest);
  const html = await P.get(`/api/principal/archive/${pkg.id}/print`);
  assert.match(html.headers.get('content-type'), /text\/html/);
  assert.match(html.body, /Pakiet archiwalny dziennika/);
  const a = audits((x) => x.action === 'archive_generated')[0];
  assert.equal(a.after.forced, true); assert.match(a.reason, /Prezentacja/);
  /* naruszenie pakietu psuje weryfikację */
  S.db.get('archives', pkg.id).xml += '<!-- podmiana -->';
  assert.equal(expectOk(await P.get(`/api/principal/archive/${pkg.id}/verify`)).valid, false);
});

test('[3.3.18] natychmiastowa blokada konta pracownika unieważnia sesje web i mobile', async () => {
  const web = await S.as('k.lis');
  const mobile = S.client();
  await mobile.post('/api/auth/login', { login: 'k.lis', password: DEMO_PASSWORD, client: 'mobile' });
  assert.equal((await web.get('/api/auth/session')).status, 200);
  assert.equal((await mobile.get('/api/auth/session')).status, 200);
  const r = expectOk(await P.post('/api/principal/users/u_lis/block', { reason: 'Rozwiązanie umowy o pracę z 31.10.2026' }));
  assert.equal(r.blocked, true);
  assert.equal(r.revokedSessions.total, 2); assert.equal(r.revokedSessions.web, 1); assert.equal(r.revokedSessions.mobile, 1);
  assert.equal(S.db.get('users', 'u_lis').blocked, true);
  assert.ok(S.db.col('sessions').filter((s) => s.userId === 'u_lis').every((s) => s.revoked && s.revokedReason === 'blocked'));
  assert.equal((await web.get('/api/auth/session')).status, 401);
  assert.equal((await mobile.get('/api/auth/session')).status, 401);
  const relog = await S.client().post('/api/auth/login', { login: 'k.lis', password: DEMO_PASSWORD });
  assert.equal(relog.status, 403);
  const a = audits((x) => x.action === 'account_blocked' && x.entityId === 'u_lis')[0];
  assert.equal(a.before.blocked, false); assert.equal(a.after.blocked, true); assert.equal(a.after.revokedSessions, 2);
  assert.match(a.reason, /Rozwiązanie umowy/);
  assert.equal((await P.post('/api/principal/users/u_dyrektor/block', { reason: 'x' })).status, 400);
  assert.equal((await P.post('/api/principal/users/u_lis/block', { blocked: false })).status, 200);
  assert.equal(S.db.get('users', 'u_lis').blocked, false);
});

test('[3.3.19] statystyki logowań rodziców wskazują konta bez kontaktu ze szkołą', async () => {
  const r = expectOk(await P.get('/api/principal/parent-logins'));
  assert.equal(r.thresholdDays, 30);
  const never = r.rows.find((x) => x.userId === 'u_p_adamczyk');
  assert.equal(never.flag, 'never'); assert.equal(never.lastLogin, null); assert.equal(never.loginCount, 0); assert.equal(never.risk, true);
  assert.ok(never.children.some((c) => c.classId === '7b'));
  const stale = r.rows.find((x) => x.userId === 'u_p_nowak');
  assert.equal(stale.flag, 'stale'); assert.ok(stale.daysSinceLogin > 30); assert.equal(stale.loginCount, 2);
  const active = r.rows.find((x) => x.userId === 'u_p_lewandowski');
  assert.equal(active.flag, 'ok'); assert.equal(active.loginCount, 31);
  assert.equal(r.rows[0].risk, true, 'konta zagrożone wykluczeniem cyfrowym są na górze');
  assert.ok(r.totals.never >= 1 && r.totals.stale >= 1 && r.totals.parents >= 7);
  const household = r.households.find((h) => h.accounts.some((x) => x.userId === 'u_p_kowalczyk'));
  assert.ok(household.accounts.some((x) => x.userId === 'u_p_kowalczyk2'), 'oba konta rodziców Anny to jedno gospodarstwo domowe');
  assert.ok(household.students.some((s) => s.id === 'st_kowalczyk_anna'));
  assert.ok(r.households.some((h) => h.risk));
});

test('[3.3.20] globalne ustawienia widoczności średnich i rankingów na kontach rodziców', async () => {
  const before = Object.assign({}, S.db.data.config.visibility);
  const r = expectOk(await P.patch('/api/principal/visibility', { rankings: false, classAverage: false, averagesToParents: false }));
  assert.equal(r.visibility.rankings, false); assert.equal(r.visibility.classAverage, false); assert.equal(r.visibility.averagesToParents, false);
  const a = audits((x) => x.action === 'visibility_changed')[0];
  assert.equal(a.before.classAverage, before.classAverage); assert.equal(a.after.classAverage, false);
  const parent = await S.as('rodzic.lewandowski');
  const ses = expectOk(await parent.get('/api/auth/session'));
  assert.equal(ses.config.visibility.rankings, false, 'konto rodzica nie pokazuje rankingów');
  assert.equal(ses.config.visibility.classAverage, false);
  expectOk(await P.patch('/api/principal/visibility', { classAverage: true }));
  assert.equal(S.db.data.config.visibility.classAverage, true);
  assert.equal(S.db.data.config.visibility.rankings, false, 'pozostałe ustawienia bez zmian');
  assert.equal((await P.patch('/api/principal/visibility', {})).status, 400);
  assert.equal((await parent.patch('/api/principal/visibility', { rankings: true })).status, 403);
});

test('[3.3.4] godzina publikacji zastępstw to czas ścienny szkoły, także w dobie zmiany czasu', async () => {
  /* Przeglądarka przysyła `publishAtLocal` („15:00 dnia poprzedniego” tak, jak widzi je dyrektor);
     serwer zapisuje instant ze strefą szkoły. 28.03.2027 zegary idą o 2:00 do przodu, więc 15:00
     tego dnia to +02:00, a dzień wcześniej +01:00 — publikacje dzieli 23 h, nie 24. */
  const mk = async (date) => expectOk(await P.post('/api/substitutions', { teacherId: 'u_lis', from: date, to: date, reason: 'Szkolenie zewnętrzne' }));
  const before = await mk('2027-03-27');
  const after = await mk('2027-03-28');
  const r1 = expectOk(await P.post(`/api/substitutions/${before.id}/publish`, { publishAtLocal: '2027-03-27T15:00', force: true }));
  const r2 = expectOk(await P.post(`/api/substitutions/${after.id}/publish`, { publishAtLocal: '2027-03-28T15:00', force: true }));
  assert.equal(r1.scheduled, true); assert.equal(r2.scheduled, true);
  assert.equal(r1.publishAt, '2027-03-27T15:00:00+01:00');
  assert.equal(r2.publishAt, '2027-03-28T15:00:00+02:00');
  assert.equal(new Date(r1.publishAt).toISOString(), '2027-03-27T14:00:00.000Z');
  assert.equal(new Date(r2.publishAt).toISOString(), '2027-03-28T13:00:00.000Z');
  assert.equal((Date.parse(r2.publishAt) - Date.parse(r1.publishAt)) / 3600000, 23, 'doba zmiany czasu ma 23 godziny');
  assert.equal(S.db.get('substitutions', before.id).publishAt, r1.publishAt);
  assert.ok(r1.substitution && r1.substitution.id === before.id, 'kształt odpowiedzi bez zmian');
  // bez `publishAtLocal` zostaje instant policzony przez przeglądarkę
  const legacy = await mk('2027-04-03');
  const iso = new Date(Date.now() + 3600e3).toISOString();
  assert.equal(expectOk(await P.post(`/api/substitutions/${legacy.id}/publish`, { publishAt: iso, force: true })).publishAt, iso);
});
