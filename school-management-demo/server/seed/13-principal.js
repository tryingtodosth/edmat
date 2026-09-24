'use strict';
/* Seed for section 3.3 (Dyrekcja): supervision duties, payroll rates per Karta Nauczyciela, one settled substitution,
   a global announcement waiting for acknowledgment, the archive window, test load and parent login history.
   Rows this file adds to collections owned by other sections use the `p_` prefix. */
const { addDays, weekday } = require('../lib/util');
const { audit } = require('../lib/audit');

const TEACHER_LEVELS = {
  u_nowak: 'dyplomowany', u_wojcik: 'mianowany', u_krol: 'mianowany', u_sikora: 'dyplomowany',
  u_gorski: 'mianowany', u_lis: 'dyplomowany', u_mazur: 'poczatkujacy', u_kaczmarek: 'dyplomowany', u_dyrektor: 'dyplomowany'
};
const STAFF_ROLES = ['teacher', 'principal', 'counselor', 'psychologist', 'specialEducator', 'speechTherapist',
  'supportTeacher', 'registrar', 'admin', 'careEducator', 'cafeteria', 'librarian', 'nurse', 'dpo'];
const PENSUM = { u_dyrektor: 8, u_mazur: 8, u_kaczmarek: 16 }; /* dyrektor – obniżone pensum, wf i edukacja wczesnoszkolna – niepełny wymiar */

function seed(db, ctx) {
  const cfg = db.data.config; const TODAY = cfg.today;

  /* ---------------------------------------------------------------- 3.3.6/3.3.7 payroll (Karta Nauczyciela) */
  cfg.payroll = {
    currency: 'PLN',
    legalBasis: 'Karta Nauczyciela art. 35 ust. 2a i 3 – godziny ponadwymiarowe i godziny doraźnych zastępstw',
    defaultPensum: 18, defaultLevel: 'mianowany', pensum: PENSUM, levels: TEACHER_LEVELS,
    /* stawka za jedną godzinę ponadwymiarową / doraźnego zastępstwa, wg roli i stopnia awansu zawodowego */
    overtimeRate: {
      teacher: { poczatkujacy: 42.5, mianowany: 52.8, dyplomowany: 64.9 },
      principal: { poczatkujacy: 48, mianowany: 58.4, dyplomowany: 71.4 },
      supportTeacher: { poczatkujacy: 38.2, mianowany: 46.1, dyplomowany: 55.3 }
    },
    adHocFactor: 1, /* godzina doraźnego zastępstwa płatna jak godzina ponadwymiarowa */
    combinedPay: 1, /* dwie klasy połączone w auli = jedna płatna godzina doraźna */
    maxOvertimePerWeek: 9, settlementDay: 5,
    exportFormats: ['csv', 'xml']
  };

  /* ---------------------------------------------------------------- 3.3.17 archive window: year end … +10 days */
  const yearEnd = cfg.semesters[cfg.semesters.length - 1].to;
  /* § 22 liczy 10 dni od zakończenia ROKU SZKOLNEGO (31 sierpnia), nie od zakończenia zajęć (D3-22).
     `from` zostaje końcem zajęć — to najwcześniejszy dzień, w którym pakiet ma sens. */
  const schoolYearEnd = `${String(cfg.year).slice(5)}-08-31`;
  cfg.archiveWindow = { from: yearEnd, yearEnd: schoolYearEnd, to: addDays(schoolYearEnd, 10), days: 10, basis: 'Rozporządzenie MEN o dokumentacji przebiegu nauczania – pakiet archiwalny w ciągu 10 dni od zakończenia roku szkolnego (31 sierpnia).' };

  /* ---------------------------------------------------------------- 3.3.2 supervision duties (ostatnia deska ratunku) */
  const duty = (teacherId, weekdayNo, lessonNo, place) => db.col('duties').push({ id: `duty_${teacherId}_${weekdayNo}_${lessonNo}`, teacherId, weekday: weekdayNo, lessonNo, place });
  for (const wd of [1, 2, 3, 4, 5]) {
    duty('u_lis', wd, 4, 'korytarz I piętra');
    duty('u_gorski', wd, 5, 'świetlica');
    duty('u_krol', wd, 1, 'szatnia');
    duty('u_mazur', wd, 2, 'boisko szkolne');
    duty('u_kaczmarek', wd, 6, 'stołówka');
  }

  /* ---------------------------------------------------------------- topics, core-curriculum items and attendance for 7a and 8b
     (7b is left untouched for the teacher/homeroom sections). Deliberate gaps feed the completeness audit 3.3.8:
     – język polski w 7a nie ma wpisanych tematów,
     – środy w 8b nie mają wpisanej frekwencji. */
  const fourWeeksAgo = addDays(TODAY, -28);
  const counters = {};
  for (const l of db.col('lessons')) {
    if (l.date >= TODAY || !['7a', '8b'].includes(l.classId)) continue;
    const cls = db.get('classes', l.classId); if (!cls) continue;
    const items = db.col('curriculum').filter((i) => i.subjectId === l.subjectId && i.level === cls.level);
    const gapTopic = l.classId === '7a' && l.subjectId === 'pol';
    if (!l.topic && !gapTopic) {
      const k = l.classId + l.subjectId; const n = (counters[k] = (counters[k] || 0) + 1);
      const item = items.length ? items[Math.floor((n - 1) / 4) % items.length] : null;
      l.topic = item ? `${item.title} – zajęcia ${n}` : `Zajęcia ${n} – ${(db.get('subjects', l.subjectId) || {}).name || l.subjectId}`;
      if (item && !(l.curriculumItemIds || []).length) l.curriculumItemIds = [item.id];
    }
    const gapAttendance = l.classId === '8b' && weekday(l.date) === 3;
    if (l.date >= fourWeeksAgo && !gapTopic && !gapAttendance) {
      for (const sid of cls.studentIds) {
        if (l.groupId) { const g = db.get('groups', l.groupId); if (g && !g.studentIds.includes(sid)) continue; }
        if (db.col('attendance').some((a) => a.lessonId === l.id && a.studentId === sid)) continue;
        db.col('attendance').push({ id: `p_att_${l.id}_${sid}`, lessonId: l.id, studentId: sid, date: l.date, lessonNo: l.lessonNo, classId: l.classId, subjectId: l.subjectId, status: 'ob', minutes: 0, draft: false, byUserId: l.teacherId, at: l.date + 'T08:00:00Z', excuseId: null });
      }
    }
  }

  /* ---------------------------------------------------------------- 3.3.1/3.3.6 one settled (published) substitution: mgr Ewa Król, 5–6.10.2026 */
  const subFrom = '2026-10-05', subTo = '2026-10-06';
  const krolLessons = db.col('lessons').filter((l) => l.teacherId === 'u_krol' && l.date >= subFrom && l.date <= subTo);
  const assignments = krolLessons.map((l) => {
    const substituteTeacherId = l.classId === '7a' ? 'u_lis' : 'u_sikora';
    l.status = 'substituted'; l.substituteTeacherId = substituteTeacherId;
    return { lessonId: l.id, substituteTeacherId, kind: 'sub', combinedWithLessonId: null, paid: true, room: l.room, tier: 1, reasonText: 'przedmiot pokrewny, wolna godzina' };
  });
  db.col('substitutions').push({
    id: 'p_sub_krol_1005', teacherId: 'u_krol', from: subFrom, to: subTo, reason: 'Zwolnienie lekarskie (L4)', byUserId: 'u_dyrektor',
    createdAt: '2026-10-04T18:10:00Z', assignments, published: true, publishedAt: '2026-10-04T15:00:00Z', publishAt: '2026-10-04T15:00:00Z', notifiedAt: '2026-10-04T15:00:00Z'
  });

  /* ---------------------------------------------------------------- 3.3.14 announced tests (kolekcja sekcji 3.1 – tylko wiersze `p_`) */
  const t = (idv, classId, subjectId, teacherId, date, kind, scope) => db.col('tests').push({ id: idv, classId, subjectId, teacherId, date, scope, kind });
  t('p_test_8b_1', '8b', 'fiz', 'u_wojcik', '2026-10-13', 'sprawdzian', 'Ruch jednostajny');
  t('p_test_8b_2', '8b', 'his', 'u_lis', '2026-10-13', 'sprawdzian', 'II wojna światowa – przyczyny');
  t('p_test_8b_3', '8b', 'pol', 'u_sikora', '2026-10-14', 'sprawdzian', 'Lektura: Kamienie na szaniec');
  t('p_test_8b_4', '8b', 'mat', 'u_nowak', '2026-10-15', 'sprawdzian', 'Wyrażenia algebraiczne');
  t('p_test_8b_5', '8b', 'che', 'u_gorski', '2026-10-16', 'sprawdzian', 'Tlenki i wodorotlenki');
  t('p_test_7a_1', '7a', 'fiz', 'u_wojcik', '2026-10-20', 'sprawdzian', 'Pomiary i niepewności');
  t('p_test_7a_2', '7a', 'mat', 'u_dyrektor', '2026-10-20', 'sprawdzian', 'Potęgi');
  t('p_test_7a_3', '7a', 'pol', 'u_sikora', '2026-10-22', 'kartkówka', 'Części mowy');

  /* ---------------------------------------------------------------- 3.3.12 global announcement waiting for acknowledgment
     Kierujemy go do rodziców i uczniów: w demie blokuje wyłącznie te dwa widoki, a pracownicy szkoły
     (dyrektor, nauczyciele, specjaliści) wchodzą na swoje ekrany bez okna potwierdzenia. */
  /* Potwierdzili już wszyscy poza Martą Kowalczyk (rodzic.kowalczyk) — to jej konto pokazuje okno blokujące. */
  const annAcks = {};
  for (const u of db.col('users')) {
    if (u.blocked || u.id === 'u_p_kowalczyk') continue;
    if (u.role === 'parent') annAcks[u.id] = '2026-10-22T18:41:00Z';
    if (u.role === 'student') annAcks[u.id] = '2026-10-22T20:05:00Z';
  }
  db.col('announcements').push({
    id: 'p_ann_regulamin', title: 'Nowy regulamin oceniania od 2 listopada 2026',
    body: 'Od 2 listopada 2026 obowiązuje regulamin oceniania przyjęty uchwałą rady pedagogicznej nr 14/2026/2027. Prosimy o zapoznanie się z dokumentem i potwierdzenie odczytu.',
    requiresAck: true, audience: ['parent', 'student'], byUserId: 'u_dyrektor', at: '2026-10-22T15:24:00Z',
    ackBy: annAcks, attachments: []
  });

  /* Drugi komunikat — dla pracowników, potwierdzony już przez wszystkich. Dzięki niemu karta statystyk
     potwierdzeń ma dane kadrowe (100 %), a żaden pracownik nie zaczyna demonstracji od okna blokującego. */
  const staffAckAt = '2026-10-21T09:15:00Z';
  const staffAck = {};
  for (const u of db.col('users')) if (STAFF_ROLES.includes(u.role) && !u.blocked) staffAck[u.id] = staffAckAt;
  db.col('announcements').push({
    id: 'p_ann_rada_kalendarz', title: 'Kalendarz rady pedagogicznej na I semestr',
    body: 'Terminy posiedzeń rady pedagogicznej: 20.10.2026, 17.11.2026, 15.12.2026 i 19.01.2027, każdorazowo o 15:00 w sali 12. Obecność obowiązkowa; usprawiedliwienia przyjmuje sekretariat.',
    requiresAck: true, audience: ['staff'], byUserId: 'u_dyrektor', at: '2026-10-20T08:00:00Z', ackBy: staffAck, attachments: []
  });

  /* ---------------------------------------------------------------- 3.3.15 trip waiting for approval (kolekcja sekcji 3.8 – wiersz `p_`) */
  if (!db.col('trips').some((x) => x.status === 'submitted')) {
    db.col('trips').push({
      id: 'p_trip_zakopane', name: 'Wycieczka klasy 7b – Zakopane', from: '2026-11-05', to: '2026-11-06', leaderId: 'u_nowak',
      classIds: ['7b'], studentIds: ['st_kowalczyk_anna', 'st_nowak_jan', 'st_zieliski_kacper', 'st_adamczyk_maja', 'st_dbrowski_micha'],
      chaperones: [{ userId: 'u_gorski', groupNo: 1 }], insurance: { insurer: 'PZU SA', policyNo: 'POL/2026/114/778' },
      schedule: [{ day: '2026-11-05', text: 'Wyjazd 7:00, Dolina Kościeliska, zakwaterowanie' }, { day: '2026-11-06', text: 'Gubałówka, muzeum, powrót 18:00' }],
      status: 'submitted', consents: {}, createdAt: '2026-10-19T09:00:00Z'
    });
  }

  /* ---------------------------------------------------------------- 3.3.19 parent login history */
  const loginHistory = {
    u_p_kowalczyk: { lastLogin: '2026-10-22T07:41:00Z', loginCount: 46 },
    u_p_kowalczyk2: { lastLogin: '2026-10-11T20:14:00Z', loginCount: 12 },
    u_p_nowak: { lastLogin: '2026-09-12T19:02:00Z', loginCount: 2 },
    u_p_lewandowski: { lastLogin: '2026-10-21T21:07:00Z', loginCount: 31 },
    u_p_wisniewska: { lastLogin: '2026-09-08T08:15:00Z', loginCount: 1 },
    u_p_zielinski: { lastLogin: '2026-10-20T06:58:00Z', loginCount: 27 },
    u_p_adamczyk: { lastLogin: null, loginCount: 0 }
  };
  for (const [uid, hist] of Object.entries(loginHistory)) { const u = db.get('users', uid); if (u) Object.assign(u, hist); }

  /* ---------------------------------------------------------------- 3.3.16 kilka zdarzeń w rejestrze audytowym (wpisywane wyłącznie przez lib/audit) */
  audit(db, { action: 'grade_value_edit', entity: 'grades', entityId: 'p_gr_demo_1', userId: 'u_nowak', ip: '10.0.12.44', client: 'Chrome · Windows', at: '2026-10-20T09:13:00Z', before: { value: '3' }, after: { value: '4' }, reason: 'Pomyłka przy wpisie – właściwa ocena ze sprawdzianu' });
  audit(db, { action: 'attendance_entry_delete', entity: 'attendance', entityId: 'p_att_demo_1', userId: 'u_wojcik', ip: '10.0.12.51', client: 'Firefox · Windows', at: '2026-10-21T14:41:00Z', before: { status: 'nb' }, after: null, reason: 'Uczeń reprezentował szkołę na zawodach – wpis zastąpiony statusem rs' });
  audit(db, { action: 'grades_export', entity: 'grades', entityId: '7b/mat', userId: 'u_nowak', ip: '10.0.12.44', client: 'Chrome · Windows', at: '2026-10-22T16:22:00Z', after: { format: 'csv', anonymized: true } });

  ['duties', 'substitutions', 'announcements', 'archives', 'trips', 'tests', 'confidentialNotes'].forEach((c) => db.col(c));
  void ctx;
}
module.exports = { seed };
