'use strict';
/* Oceny cząstkowe 7b (semestr 1, wrzesień–październik 2026), frekwencja wrześniowych lekcji matematyki
   (potrzebna do blokady wpisu oceny przy potwierdzonej nieobecności) oraz kilka uwag z dziennika.
   Wszystkie id z prefiksem g_. Uczniowie identyfikowani numerem w dzienniku klasy 7b.

   Dwa wątki demonstracyjne poza 7b:
   – para „propozycja → ocena klasyfikacyjna” (P28) w 7a z polskiego. Nie może powstać w 7b, bo seed
     12-homeroom wystawia własne propozycje tylko wtedy, gdy w 7b nie ma jeszcze żadnej oceny
     proponowanej ani śródrocznej — wpis w 7b wyłączyłby tamten scenariusz.
   – kategoria przeliczona po zmianie wagi (P27): kartkówka 1 → 2 z 30.09.2026. */
const D = require('../lib/domain');
const { audit } = require('../lib/audit');

// zdolności uczniów 7b wg numeru w dzienniku (2–6) — na tej podstawie dobierane są realistyczne oceny
const ABILITY = { 3: 5, 5: 4, 7: 4, 9: 3, 11: 5, 12: 4, 14: 5, 15: 6, 16: 3, 18: 2, 19: 4 }; // nr 20 (nowy uczeń) bez ocen
const PALETTE = { 6: ['6', '5+', '5', '6'], 5: ['5', '5-', '4+', '5'], 4: ['4', '4+', '4', '3+'], 3: ['3', '3+', '3', '2+'], 2: ['2', '2+', '3-', '2'] };
// kolumny siatki: [przedmiot, nauczyciel, kategoria, data, lekcja?]
const COLUMNS = [
  ['mat', 'u_nowak', 'cat_zd', '2026-09-11'],
  ['mat', 'u_nowak', 'cat_spr', '2026-09-25', 'les_tt_7b_5_1_2026-09-25'],
  ['mat', 'u_nowak', 'cat_spr', '2026-10-09'],
  ['mat', 'u_nowak', 'cat_odp', '2026-10-13'],
  ['mat', 'u_nowak', 'cat_kart', '2026-10-16'],
  ['pol', 'u_sikora', 'cat_zd', '2026-09-18'],
  ['pol', 'u_sikora', 'cat_kart', '2026-10-02'],
  ['pol', 'u_sikora', 'cat_spr', '2026-10-16'],
  ['fiz', 'u_wojcik', 'cat_kart', '2026-09-24'],
  ['fiz', 'u_wojcik', 'cat_proj', '2026-10-08'],
  ['fiz', 'u_wojcik', 'cat_spr', '2026-10-15'],
  ['ang', 'u_krol', 'cat_kart', '2026-09-17'],
  ['ang', 'u_krol', 'cat_odp', '2026-10-01'],
  ['ang', 'u_krol', 'cat_spr', '2026-10-22']
];
// wpisy szczególne: przedmiot|data|nr w dzienniku
const SPECIAL = {
  'mat|2026-09-25|16': { skip: true }, // Szymański Tomasz — potwierdzona nieobecność (nb) na tej godzinie
  'mat|2026-10-09|18': { value: '1', comment: 'Nierozwiązane zadania 3 i 5 (równania z nawiasami). Poprawa możliwa do 21.10.2026.' },
  'mat|2026-10-09|7': { value: '4', comment: 'Poprawnie rozwiązane równania; błąd w zadaniu 4 — pomyłka przy zamianie jednostek.' },
  'mat|2026-10-09|12': { value: '3', comment: 'Dobrze opanowane procenty, do powtórki: obliczanie procentu składanego.' },
  'mat|2026-10-13|9': { value: 'np' },
  'mat|2026-10-13|18': { value: 'bz' },
  'pol|2026-10-02|16': { value: 'np' },
  'fiz|2026-10-08|19': { value: '5', comment: 'Bardzo staranna dokumentacja pomiarów; brakuje wniosku końcowego.' },
  'ang|2026-10-01|15': { value: '6', comment: 'Wzorowa wymowa i bogate słownictwo w opisie miejsca.' }
};
// frekwencja lekcji matematyki (piątek, 1. godzina) — wrzesień, poza zakresem seeda lekcji 10-*
const ATT_LESSONS = [
  { date: '2026-09-11', nb: [], u: [9], sp: {} },
  { date: '2026-09-18', nb: [18], u: [], sp: { 5: 6 } },
  { date: '2026-09-25', nb: [16], u: [], sp: { 15: 8 } }
];
const REMARKS = [
  { id: 'g_rem_1', no: 7, teacherId: 'u_sikora', kind: 'positive', text: 'Samodzielnie przygotowała gazetkę klasową o Marii Skłodowskiej-Curie.', points: 10, date: '2026-10-02', subjectId: 'pol' },
  { id: 'g_rem_2', no: 18, teacherId: 'u_nowak', kind: 'negative', text: 'Przeszkadzał w prowadzeniu lekcji mimo dwukrotnego upomnienia.', points: -10, date: '2026-10-09', subjectId: 'mat' },
  { id: 'g_rem_3', no: 12, teacherId: 'u_wojcik', kind: 'neutral', text: 'Zgłosił brak podręcznika — rodzic poinformowany przez dziennik.', points: 0, date: '2026-10-13', subjectId: 'fiz' }
];

function seed(db, ctx) {
  const roster = db.data.students.filter((s) => s.classId === '7b').sort((a, b) => a.rollNo - b.rollNo);
  const byNo = Object.fromEntries(roster.map((s) => [s.rollNo, s]));
  const graded = roster.filter((s) => ABILITY[s.rollNo]);
  const pick = (no, n) => { const p = PALETTE[ABILITY[no]]; return p[(n * 7 + no * 3) % p.length]; };
  const grades = db.col('grades');
  const push = (g) => grades.push(Object.assign({ points: null, maxPoints: null, percent: null, comment: null, retakeOfId: null, makeup: false, lessonId: null, kind: 'partial', semester: 1, locked: false, deleted: false, deletedReason: null, createdAt: '2026-10-16T07:00:00Z' }, g));

  COLUMNS.forEach(([subjectId, teacherId, categoryId, date, lessonId], ci) => {
    const cat = db.get('gradeCategories', categoryId);
    graded.forEach((s) => {
      const sp = SPECIAL[`${subjectId}|${date}|${s.rollNo}`] || {};
      if (sp.skip) return;
      const value = sp.value || pick(s.rollNo, ci);
      const special = value === 'np' || value === 'bz';
      push({
        id: `g_gr_${subjectId}_${s.rollNo}_${ci}`, studentId: s.id, subjectId, classId: '7b',
        categoryId: cat.id, categoryName: cat.name, weight: cat.weight, color: cat.color,
        value, comment: sp.comment || null, date, teacherId, lessonId: lessonId || null,
        countsInAverage: special ? false : cat.countsInAverage !== false
      });
    });
  });

  // 3.1.8 — poprawa sprawdzianu z matematyki: 1 → 4; obie oceny zostają w dzienniku
  push({
    id: 'g_gr_mat_18_retake', studentId: byNo[18].id, subjectId: 'mat', classId: '7b',
    categoryId: 'cat_spr', categoryName: 'sprawdzian', weight: 3, color: 'cat-1', value: '4',
    comment: 'Poprawa sprawdzianu z 09.10.2026 — równania rozwiązane samodzielnie.',
    retakeOfId: 'g_gr_mat_18_2', date: '2026-10-14', teacherId: 'u_nowak', countsInAverage: true
  });

  const attendance = db.col('attendance');
  for (const L of ATT_LESSONS) {
    const lessonId = `les_tt_7b_5_1_${L.date}`;
    for (const s of roster) {
      if (attendance.some((a) => a.lessonId === lessonId && a.studentId === s.id)) continue;
      const status = L.nb.includes(s.rollNo) ? 'nb' : L.u.includes(s.rollNo) ? 'u' : L.sp[s.rollNo] ? 'sp' : 'ob';
      attendance.push({
        id: `g_att_${s.rollNo}_${L.date}`, lessonId, studentId: s.id, date: L.date, lessonNo: 1, classId: '7b',
        subjectId: 'mat', status, minutes: L.sp[s.rollNo] || 0, draft: false, byUserId: 'u_nowak', at: `${L.date}T08:05:00Z`, excuseId: null
      });
    }
  }

  /* ---- P28: propozycja → ocena klasyfikacyjna (7a, język polski, mgr Beata Sikora) --------------
     Julia Baran potwierdza propozycję (changedFromProposal: false), Igor Cichoń dostaje ocenę wyższą
     od proponowanej po poprawie sprawdzianu (changedFromProposal: true, lowerThanProposal: false). */
  const PAIR = [
    { sid: 'st_baran_julia', partials: ['4', '4'], proposed: '4', finalValue: '4' },
    { sid: 'st_cicho_igor', partials: ['3', '4'], proposed: '3', finalValue: '4' }
  ];
  const pol7a = (o) => grades.push(Object.assign({
    subjectId: 'pol', classId: '7a', teacherId: 'u_sikora', points: null, maxPoints: null, percent: null,
    comment: null, retakeOfId: null, proposedId: null, makeup: false, lessonId: null, kind: 'partial',
    semester: 1, countsInAverage: true, locked: false, deleted: false, deletedReason: null, createdAt: '2026-10-20T07:00:00Z'
  }, o));
  if (!grades.some((g) => g.classId === '7a' && g.subjectId === 'pol')) {
    for (const P of PAIR) {
      if (!db.get('students', P.sid)) continue;
      P.partials.forEach((value, i) => pol7a({
        id: `g_gr_7a_pol_${P.sid}_${i}`, studentId: P.sid, categoryId: i ? 'cat_kart' : 'cat_spr',
        categoryName: i ? 'kartkówka' : 'sprawdzian', weight: i ? 2 : 3, color: i ? 'cat-2' : 'cat-1',
        value, date: i ? '2026-10-09' : '2026-09-25'
      }));
      const propId = `g_gr_7a_pol_${P.sid}_prop`;
      pol7a({ id: propId, studentId: P.sid, categoryId: null, categoryName: 'propozycja śródroczna', weight: 1, color: null, value: P.proposed, date: '2026-10-16', kind: 'proposedMid', countsInAverage: false, comment: 'Ocena proponowana śródroczna' });
      pol7a({ id: `g_gr_7a_pol_${P.sid}_mid`, studentId: P.sid, categoryId: null, categoryName: 'ocena śródroczna', weight: 1, color: null, value: P.finalValue, date: '2026-10-20', kind: 'midterm', countsInAverage: false, proposedId: propId, comment: P.proposed === P.finalValue ? null : 'Ocena wyższa od proponowanej — poprawa sprawdzianu działowego' });
    }
  }

  /* ---- P27: waga kartkówki podniesiona 30.09.2026 z 1 na 2 wraz z „przelicz istniejące” ---------
     Oceny wystawione przed tą datą mają dziś wagę 2 i każda ma własny wpis w rejestrze zmian;
     wpis o kategorii niesie listę przeliczonych ocen oraz średnie klasy przed i po przeliczeniu. */
  const KART_AT = '2026-09-30';
  const recalculated = grades.filter((g) => g.categoryId === 'cat_kart' && !g.deleted && g.date <= KART_AT);
  if (recalculated.length && !db.col('audit').some((a) => a.entityId === 'cat_kart')) {
    const pairs = [...new Set(recalculated.map((g) => g.subjectId + '|' + g.semester))];
    const averages = () => Object.fromEntries(pairs.map((key) => {
      const [subjectId, sem] = key.split('|');
      const list = roster.map((s) => D.studentGrades(db, s.id, subjectId, +sem).average).filter((x) => x != null);
      return [key, list.length ? Math.round((list.reduce((a, b) => a + b, 0) / list.length) * 100) / 100 : null];
    }));
    for (const g of recalculated) g.weight = 1;
    const classAveragesBefore = averages();
    for (const g of recalculated) g.weight = 2;
    const classAveragesAfter = averages();
    const reason = 'Uchwała zespołu przedmiotowego z 30.09.2026 — kartkówka liczy się z wagą 2';
    audit(db, {
      action: 'grade_category_update', entity: 'gradeCategory', entityId: 'cat_kart', userId: 'u_nowak',
      ip: '10.0.12.44', client: 'Chrome · Windows', at: KART_AT + 'T15:40:00Z',
      before: { name: 'kartkówka', weight: 1, countsInAverage: true, classAverages: classAveragesBefore },
      after: { name: 'kartkówka', weight: 2, countsInAverage: true, recalculated: true, gradeIds: recalculated.map((g) => g.id), classAverages: classAveragesAfter },
      reason
    });
    for (const g of recalculated) audit(db, {
      action: 'grade_update', entity: 'grade', entityId: g.id, userId: 'u_nowak', ip: '10.0.12.44',
      client: 'Chrome · Windows', at: KART_AT + 'T15:40:00Z',
      before: Object.assign({}, g, { weight: 1 }), after: Object.assign({}, g), reason
    });
  }

  const remarks = db.col('remarks');
  for (const rm of REMARKS) {
    const { no, ...rest } = rm;
    remarks.push(Object.assign({ studentId: byNo[no].id, classId: '7b', lessonId: null, at: `${rm.date}T10:00:00Z`, deleted: false }, rest));
  }
  db.col('descriptiveGrades'); db.col('semesterLocks');
}
module.exports = { seed };
