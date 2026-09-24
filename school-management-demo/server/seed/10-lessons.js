'use strict';
/* Seed 3.1 — dziennik lekcyjny: frekwencja 7b z ostatnich tygodni, tematy lekcji matematyki
   powiązane z podstawą programową, zapowiedziane sprawdziany w bieżącym tygodniu,
   zadanie domowe z oddaną pracą oraz jedna lekcja łączona dwóch grup językowych.
   Wszystkie własne identyfikatory zaczynają się od `l_`. */
const { addDays } = require('../lib/util');

/** Deterministic pseudo-random so every reseed produces the same journal. */
function hash(s) { let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; }
const pick = (s, n) => hash(s) % n;

const TOPICS = {
  pol: ['Charakterystyka bohatera literackiego', 'Środki stylistyczne w liryce', 'Zdanie złożone współrzędnie', 'Redagowanie rozprawki', 'Lektura – omówienie fragmentu'],
  fiz: ['Pomiar i niepewność pomiaru', 'Prędkość w ruchu jednostajnym', 'Siła wypadkowa', 'Praca, moc, energia', 'Zadania rachunkowe – powtórzenie'],
  his: ['Rewolucja francuska – przyczyny', 'Epoka napoleońska', 'Kongres wiedeński', 'Powstanie listopadowe', 'Praca ze źródłem historycznym'],
  geo: ['Współrzędne geograficzne', 'Klimat Polski', 'Rzeki i jeziora', 'Ludność Polski', 'Praca z mapą'],
  bio: ['Układ krwionośny człowieka', 'Serce i naczynia krwionośne', 'Odporność organizmu', 'Układ oddechowy', 'Powtórzenie działu'],
  che: ['Mieszaniny jednorodne i niejednorodne', 'Rozdzielanie mieszanin – laboratorium', 'Budowa atomu', 'Układ okresowy pierwiastków', 'Ćwiczenia laboratoryjne'],
  ang: ['Present Perfect – zastosowanie', 'Słownictwo: podróże', 'Czytanie ze zrozumieniem', 'Opis miejsca – wypowiedź pisemna', 'Powtórzenie słownictwa'],
  inf: ['Algorytmy sortowania', 'Arkusz kalkulacyjny – formuły', 'Bezpieczeństwo w sieci', 'Programowanie w Pythonie', 'Grafika komputerowa'],
  wf: ['Gry zespołowe – piłka siatkowa', 'Lekkoatletyka – bieg na 60 m', 'Gimnastyka podstawowa', 'Test sprawności fizycznej', 'Piłka koszykowa – kozłowanie'],
  muz: ['Rytm i metrum', 'Muzyka klasycyzmu', 'Śpiew zespołowy'],
  pla: ['Barwy ciepłe i zimne', 'Perspektywa zbieżna', 'Kompozycja otwarta i zamknięta']
};

/** 1×1 PNG – a stand-in for the photo of a handwritten exercise, small enough to keep in the seed. */
const PNG_1PX = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

function seed(db, ctx) {
  const cfg = db.data.config; const TODAY = cfg.today;
  const lessons = db.col('lessons');
  const attendance = db.col('attendance');

  /* ---- 1. lekcja łączona: 7b j.ang gr.2 + 7a j.ang gr.2, piątek, 6. godzina ------------ */
  const combA = 'l_les_7b_ang2_' + TODAY, combB = 'l_les_7a_ang2_' + TODAY;
  const combined = [
    { id: combA, date: TODAY, lessonNo: 6, classId: '7b', groupId: 'g_7b_ang2', subjectId: 'ang', teacherId: 'u_krol', room: '16', topic: null, curriculumItemIds: [], status: 'planned', substituteTeacherId: null, combinedWith: combB, attendanceDraft: false },
    { id: combB, date: TODAY, lessonNo: 6, classId: '7a', groupId: 'g_7a_ang2', subjectId: 'ang', teacherId: 'u_krol', room: '16', topic: null, curriculumItemIds: [], status: 'planned', substituteTeacherId: null, combinedWith: combA, attendanceDraft: false }
  ];
  combined.forEach((l) => { if (!db.get('lessons', l.id)) lessons.push(l); });

  /* ---- 2. tematy lekcji matematyki 7b powiązane z podstawą programową ------------------ */
  const matItems = db.col('curriculum').filter((c) => c.subjectId === 'mat' && c.level === 7);
  const heldMat = lessons.filter((l) => l.classId === '7b' && l.subjectId === 'mat' && l.date < TODAY).sort((a, b) => (a.date === b.date ? a.lessonNo - b.lessonNo : a.date < b.date ? -1 : 1));
  let idx = 0, used = 0;
  for (const l of heldMat) {
    const item = matItems[Math.min(idx, matItems.length - 1)];
    used++;
    l.topic = `${item.title} — zajęcia ${used} z ${item.hours}`;
    l.curriculumItemIds = [item.id];
    l.status = 'held';
    if (used >= item.hours && idx < matItems.length - 1) { idx++; used = 0; }
  }
  /* pozostałe odbyte lekcje 7b: temat bez powiązania z podstawą (inne przedmioty) */
  for (const l of lessons) {
    if (l.classId !== '7b' || l.date >= TODAY || l.topic) continue;
    const bank = TOPICS[l.subjectId]; if (!bank) continue;
    l.topic = bank[pick(l.id, bank.length)];
    l.status = 'held';
  }

  /* ---- 3. frekwencja 7b z ostatnich trzech tygodni ------------------------------------ */
  const from = addDays(TODAY, -21);
  const studentsOf = (l) => {
    if (l.groupId) { const g = db.get('groups', l.groupId); return g ? g.studentIds : []; }
    const c = db.get('classes', l.classId); return c ? c.studentIds : [];
  };
  const past7b = lessons.filter((l) => l.classId === '7b' && l.date >= from && l.date < TODAY).sort((a, b) => (a.date === b.date ? a.lessonNo - b.lessonNo : a.date < b.date ? -1 : 1));
  for (const l of past7b) {
    for (const sid of studentsOf(l)) {
      if (attendance.some((a) => a.lessonId === l.id && a.studentId === sid)) continue;
      const seedKey = l.id + '|' + sid; const rnd = pick(seedKey, 100);
      let status = 'ob', minutes = null;
      if (rnd >= 88 && rnd < 92) status = 'nb';
      else if (rnd >= 92 && rnd < 95) { status = 'sp'; minutes = 3 + pick('m' + seedKey, 13); }
      else if (rnd >= 95 && rnd < 98) status = 'u';
      else if (rnd >= 98) status = 'zw';
      const st = db.get('students', sid);
      attendance.push({
        id: 'l_att_' + l.id + '_' + sid, lessonId: l.id, studentId: sid, date: l.date, lessonNo: l.lessonNo,
        classId: st.classId, subjectId: l.subjectId, status, minutes, draft: false,
        byUserId: l.substituteTeacherId || l.teacherId, at: l.date + 'T09:12:00Z', excuseId: null
      });
    }
  }
  /* jeden uczeń reprezentował szkołę na konkursie matematycznym (status rs nie obniża frekwencji) */
  const rsDate = addDays(TODAY, -3);
  const kacper = db.one('students', (s) => s.classId === '7b' && s.firstName === 'Kacper');
  if (kacper) for (const l of lessons.filter((x) => x.classId === '7b' && x.date === rsDate)) {
    const row = attendance.find((a) => a.lessonId === l.id && a.studentId === kacper.id);
    if (row) { row.status = 'rs'; row.minutes = null; }
  }

  /* ---- 4. zapowiedziane sprawdziany w bieżącym tygodniu (limit prawie wyczerpany) ------ */
  const tests = db.col('tests');
  [
    { id: 'l_tst_7b_pol', classId: '7b', subjectId: 'pol', teacherId: 'u_sikora', date: addDays(TODAY, -3), scope: 'Lektura „Quo vadis” — sprawdzian działowy', kind: 'sprawdzian' },
    { id: 'l_tst_7b_bio', classId: '7b', subjectId: 'bio', teacherId: 'u_gorski', date: addDays(TODAY, -1), scope: 'Układ krwionośny człowieka', kind: 'sprawdzian' },
    { id: 'l_tst_7b_mat_k', classId: '7b', subjectId: 'mat', teacherId: 'u_nowak', date: TODAY, scope: 'Kartkówka: dodawanie ułamków', kind: 'kartkówka' }
  ].forEach((t) => { if (!db.get('tests', t.id)) tests.push(Object.assign({ createdAt: addDays(TODAY, -7) + 'T10:00:00Z' }, t)); });

  /* ---- 5. zadanie domowe z matematyki + oddana praca Anny Kowalczyk ------------------- */
  const homework = db.col('homework'); const submissions = db.col('homeworkSubmissions');
  const hwId = 'l_hw_mat_7b';
  if (!db.get('homework', hwId)) homework.push({
    id: hwId, classId: '7b', groupId: null, subjectId: 'mat', teacherId: 'u_nowak',
    text: 'Zadania 4–7 ze strony 61: dodawanie i odejmowanie ułamków zwykłych o różnych mianownikach. Pracę prześlij jako zdjęcie zeszytu albo wpisz rozwiązania w polu tekstowym.',
    dueAt: addDays(TODAY, 5) + 'T23:59:59Z', maxAttachmentMB: 10, lockAfterDue: true, attachments: [],
    lessonId: null, createdAt: addDays(TODAY, -1) + 'T12:10:00Z'
  });
  if (!db.get('homeworkSubmissions', 'l_sub_kowalczyk')) submissions.push({
    id: 'l_sub_kowalczyk', homeworkId: hwId, studentId: 'st_kowalczyk_anna',
    text: 'Zadania 4–7 rozwiązane w zeszycie, zdjęcie w załączniku. W zadaniu 6 nie jestem pewna skracania ułamka.',
    files: [{ name: 'zadania-4-7.png', size: 70, type: 'image/png', dataUrl: PNG_1PX }],
    receivedAt: addDays(TODAY, -1) + 'T18:14:00Z', late: false, gradeId: null, reviewedAt: null, reviewedBy: null
  });

  db.save();
}
module.exports = { seed };
