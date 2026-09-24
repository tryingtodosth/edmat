'use strict';
/* Seed for 3.2 (wychowawca klasy 7b): wnioski o usprawiedliwienie, Rada Rodziców klasy, uczeń przeniesiony
   w trakcie cyklu wraz z historią świadectw, osiągnięcia, uwagi do oceny zachowania oraz — gdy 3.1 nie
   dołożyło jeszcze frekwencji — garść wpisów nb/u/sp/zw, żeby ekran wychowawcy miał co pokazać. */

const PESEL = (yy, mm, dd, serial, male) => {
  const base = `${String(yy).padStart(2, '0')}${String(mm + 20).padStart(2, '0')}${String(dd).padStart(2, '0')}${String(serial).padStart(3, '0')}${male ? 1 : 2}`;
  const w = [1, 3, 7, 9, 1, 3, 7, 9, 1, 3]; const sum = w.reduce((s, wi, i) => s + wi * +base[i], 0);
  return base + ((10 - (sum % 10)) % 10);
};

function seed(db) {
  const cls = db.get('classes', '7b');

  /* --- Rada Rodziców klasy (3.2.13) --- */
  cls.councilParentIds = ['u_p_kowalczyk', 'u_p_nowak', 'u_p_lewandowski'];
  cls.councilNote = 'Rada Rodziców klasy 7b wybrana na zebraniu 15.09.2026.';
  if (!cls.logbookStatus) cls.logbookStatus = 'open';

  /* --- kontakty rodziców do strony alarmowej dziennika (3.2.17) --- */
  const PHONES = { u_p_kowalczyk: '600 100 201', u_p_kowalczyk2: '600 100 202', u_p_nowak: '601 220 340', u_p_lewandowski: '602 330 450', u_p_wisniewska: '603 440 560', u_p_zielinski: '604 550 670', u_p_adamczyk: '605 660 780' };
  for (const [uid, phone] of Object.entries(PHONES)) { const u = db.get('users', uid); if (u && !u.phone) { u.phone = phone; if (!u.email) u.email = uid.replace('u_p_', '') + '@example.com'; } }

  /* --- uczeń przeniesiony w trakcie cyklu (3.2.7, 3.2.15) --- */
  if (!db.get('students', 'st_h_mazurek_oskar')) {
    const st = {
      id: 'st_h_mazurek_oskar', rollNo: null, firstName: 'Oskar', lastName: 'Mazurek', sex: 'M', classId: '7b',
      pesel: PESEL(13, 4, 15, 150, true), birthDate: '2013-04-15', birthPlace: 'Zakopane', birthPlaceLocative: null,
      status: 'active', registerNo: 1290, parentIds: ['u_h_p_mazurek'], adult: false, adultSelfExcuse: false,
      parentAccessBlocked: false, socialWelfare: false, achievements: [], declension: { firstNameLocative: null, lastNameLocative: null },
      joinedAt: '2026-10-05', transferredFrom: 'Szkoła Podstawowa nr 3 w Zakopanem'
    };
    db.data.students.push(st); cls.studentIds.push(st.id);
    const base = db.get('users', 'u_nowak');
    db.col('users').push({ id: 'u_h_p_mazurek', login: 'rodzic.mazurek', role: 'parent', title: '', firstName: 'Iwona', lastName: 'Mazurek', name: 'Iwona Mazurek', childrenIds: [st.id], email: 'i.mazurek@example.com', phone: '606 770 890', passwordHash: base.passwordHash, mustChangePassword: false, totpEnabled: false, blocked: false, quietHours: null, createdAt: '2026-10-05T08:00:00Z' });
    db.col('users').push({ id: 'u_' + st.id, login: 'oskar.mazurek', role: 'student', title: '', firstName: 'Oskar', lastName: 'Mazurek', name: 'Oskar Mazurek', studentId: st.id, classId: '7b', passwordHash: base.passwordHash, mustChangePassword: false, totpEnabled: false, blocked: false, quietHours: null, createdAt: '2026-10-05T08:00:00Z' });
    /* historia świadectw z poprzedniej szkoły (3.2.7) */
    db.col('reportCardHistory').push({
      id: 'h_hist_mazurek_2025', studentId: st.id, schoolYear: '2025/2026', className: '6a',
      schoolName: 'Szkoła Podstawowa nr 3 w Zakopanem', grades: [{ subjectId: 'mat', value: '4' }, { subjectId: 'pol', value: '4' }, { subjectId: 'ang', value: '5' }, { subjectId: 'his', value: '4' }],
      behavior: 'bardzo dobre', source: 'transfer', note: 'Świadectwo promocyjne nr 118/2026.', byUserId: 'u_nowak', at: '2026-10-05T09:12:00Z'
    });
  }

  /* --- osiągnięcia szczególne (3.2.10) --- */
  const ach = (sid, a) => { const s = db.get('students', sid); if (!s) return; s.achievements = s.achievements || []; if (!s.achievements.some((x) => x.id === a.id)) s.achievements.push(Object.assign({ archived: false, byUserId: 'u_nowak', at: '2026-10-12T10:00:00Z' }, a)); };
  ach('st_kowalczyk_anna', { id: 'h_ach_kowalczyk_1', kind: 'konkurs_wojewodzki', title: 'Finalistka Małopolskiego Konkursu Matematycznego', level: 'wojewódzki', date: '2026-10-09', onCertificate: true });
  ach('st_dbrowska_emilia', { id: 'h_ach_dabrowska_1', kind: 'wolontariat', title: 'Wolontariat w szkolnym kole PCK', level: 'szkolny', date: '2026-10-02', onCertificate: true });
  ach('st_szymaski_tomasz', { id: 'h_ach_szymanski_1', kind: 'konkurs_szkolny', title: 'II miejsce w szkolnym konkursie recytatorskim', level: 'szkolny', date: '2026-09-28', onCertificate: false });

  /* --- uwagi (punkty do oceny zachowania, 3.2.2) --- */
  const remark = (r) => { if (!db.get('remarks', r.id)) db.col('remarks').push(Object.assign({ lessonId: null }, r)); };
  remark({ id: 'h_rem_1', studentId: 'st_nowak_jan', teacherId: 'u_wojcik', kind: 'negative', text: 'Przeszkadzał w prowadzeniu lekcji fizyki.', points: -10, date: '2026-09-18' });
  remark({ id: 'h_rem_2', studentId: 'st_nowak_jan', teacherId: 'u_sikora', kind: 'negative', text: 'Brak pracy domowej mimo upomnień.', points: -5, date: '2026-10-01' });
  remark({ id: 'h_rem_3', studentId: 'st_nowak_jan', teacherId: 'u_krol', kind: 'negative', text: 'Spóźnienia na pierwsze lekcje.', points: -5, date: '2026-10-15' });
  remark({ id: 'h_rem_4', studentId: 'st_kowalczyk_anna', teacherId: 'u_gorski', kind: 'positive', text: 'Pomoc koleżeńska w przygotowaniu doświadczenia.', points: 10, date: '2026-09-22' });
  remark({ id: 'h_rem_5', studentId: 'st_kowalczyk_anna', teacherId: 'u_lis', kind: 'positive', text: 'Przygotowanie gazetki historycznej.', points: 10, date: '2026-10-06' });
  remark({ id: 'h_rem_6', studentId: 'st_kowalczyk_anna', teacherId: 'u_nowak', kind: 'positive', text: 'Reprezentowanie klasy w konkursie matematycznym.', points: 15, date: '2026-10-09' });
  remark({ id: 'h_rem_7', studentId: 'st_woniak_filip', teacherId: 'u_mazur', kind: 'negative', text: 'Niewłaściwe zachowanie w szatni.', points: -10, date: '2026-10-12' });
  remark({ id: 'h_rem_8', studentId: 'st_dbrowska_emilia', teacherId: 'u_sikora', kind: 'positive', text: 'Wzorowe prowadzenie zeszytu i aktywność.', points: 10, date: '2026-10-07' });

  /* --- frekwencja demonstracyjna, tylko jeśli 3.1 nie dołożyło własnej --- */
  if (db.col('attendance').length === 0) {
    const rows = [];
    const put = (l, studentId, status, minutes) => rows.push({ id: `h_att_${studentId}_${l.id}`, lessonId: l.id, studentId, date: l.date, lessonNo: l.lessonNo, classId: l.classId, subjectId: l.subjectId, status, minutes: minutes || 0, draft: false, byUserId: l.teacherId, at: l.date + 'T09:00:00Z', excuseId: null });
    const held = db.col('lessons').filter((l) => l.classId === '7b' && l.status === 'held');
    let i = 0;
    for (const l of held) {
      i++;
      // Jan Nowak: ponad połowa godzin fizyki nieusprawiedliwiona (3.2.3)
      put(l, 'st_nowak_jan', l.subjectId === 'fiz' ? (i % 3 === 0 ? 'ob' : 'nb') : (i % 11 === 0 ? 'nb' : 'ob'));
      put(l, 'st_kowalczyk_anna', i % 17 === 0 ? 'u' : i % 23 === 0 ? 'sp' : 'ob', i % 23 === 0 ? 10 : 0);
      put(l, 'st_zieliski_kacper', i % 7 === 0 ? 'nb' : i % 9 === 0 ? 'zw' : 'ob');
      put(l, 'st_lewandowski_piotr', i % 13 === 0 ? 'u' : 'ob');
    }
    for (const r of rows) db.col('attendance').push(r);
  }

  /* --- 3.2.3: dwa powody nieklasyfikowania widoczne w demo (art. 44k) ---
     Jan Nowak — ponad połowa godzin fizyki nieusprawiedliwiona (egzamin klasyfikacyjny tylko za
     zgodą rady pedagogicznej); Piotr Lewandowski — ponad połowa godzin języka polskiego opuszczona,
     ale usprawiedliwiona (egzamin klasyfikacyjny przysługuje mu z mocy przepisów). Oba przedmioty
     mają w dzienniku dość godzin, żeby proporcja cokolwiek znaczyła. */
  const markAbsences = (studentId, subjectId, status, count) => {
    const rows = db.col('attendance')
      .filter((a) => a.studentId === studentId && a.subjectId === subjectId && !a.draft)
      .sort((a, b) => (a.date === b.date ? a.lessonNo - b.lessonNo : a.date < b.date ? -1 : 1));
    const take = Math.min(count, Math.max(0, rows.length - 1)); // zawsze zostaje choć jedna obecność
    for (let i = 0; i < take; i++) { rows[i].status = status; rows[i].minutes = null; }
    return take;
  };
  markAbsences('st_nowak_jan', 'fiz', 'nb', 6);
  markAbsences('st_lewandowski_piotr', 'pol', 'u', 10);

  /* --- wnioski o usprawiedliwienie (3.2.4) --- */
  const excuse = (e) => { if (!db.get('excuses', e.id)) db.col('excuses').push(Object.assign({ lessonNos: [], attachment: null, planned: false, rejectReason: null, decidedBy: null, decidedAt: null }, e)); };
  excuse({ id: 'h_exc_1', studentId: 'st_kowalczyk_anna', from: '2026-10-19', to: '2026-10-21', reason: 'Choroba, zwolnienie lekarskie w załączniku.', attachment: { name: 'zwolnienie-lekarskie.pdf', size: 84213, type: 'application/pdf' }, byUserId: 'u_p_kowalczyk', at: '2026-10-22T07:12:00Z', status: 'pending' });
  excuse({ id: 'h_exc_2', studentId: 'st_nowak_jan', from: '2026-10-20', to: '2026-10-20', reason: 'Wizyta u lekarza specjalisty.', byUserId: 'u_p_nowak', at: '2026-10-21T18:40:00Z', status: 'pending' });
  excuse({ id: 'h_exc_3', studentId: 'st_lewandowski_piotr', from: '2026-10-16', to: '2026-10-16', reason: 'Sprawy rodzinne.', byUserId: 'u_p_lewandowski', at: '2026-10-19T08:05:00Z', status: 'pending' });
  excuse({ id: 'h_exc_4', studentId: 'st_zieliski_kacper', from: '2026-10-09', to: '2026-10-09', reason: 'Zawody sportowe — reprezentacja szkoły.', byUserId: 'u_p_zielinski', at: '2026-10-08T15:20:00Z', status: 'approved', decidedBy: 'u_nowak', decidedAt: '2026-10-08T16:00:00Z' });
  excuse({ id: 'h_exc_5', studentId: 'st_nowak_jan', from: '2026-10-02', to: '2026-10-02', reason: 'Bez podanej przyczyny.', byUserId: 'u_p_nowak', at: '2026-10-05T09:00:00Z', status: 'rejected', rejectReason: 'Wniosek bez podania przyczyny nieobecności. Proszę o uzupełnienie.', decidedBy: 'u_nowak', decidedAt: '2026-10-05T12:00:00Z' });
  /* Wychowawca rozpatruje wnioski hurtowo, więc demo musi mieć ich tyle, żeby „zaznacz wszystkie
     oczekujące” miało sens: pięć oczekujących wniosków w 7b (trzy powyżej + dwa poniżej). */
  excuse({ id: 'h_exc_6', studentId: 'st_dbrowska_emilia', from: '2026-10-14', to: '2026-10-15', reason: 'Angina — zwolnienie lekarskie.', attachment: { name: 'zwolnienie-emilia.pdf', size: 51204, type: 'application/pdf' }, byUserId: 'u_p_kowalczyk', at: '2026-10-16T06:50:00Z', status: 'pending' });
  excuse({ id: 'h_exc_7', studentId: 'st_woniak_filip', from: '2026-10-22', to: '2026-10-22', reason: 'Badania kontrolne w poradni.', byUserId: 'u_p_nowak', at: '2026-10-22T19:15:00Z', status: 'pending' });

  /* --- pulpit rodzica w demo: nieobecność na 1. lekcji „dzisiaj” (3.7.2) ---
     Bez tego `/api/parent/overview` zwraca `absenceAlerts: []` i pierwszy krok ścieżki rodzica
     (alert o nieobecności na pierwszej lekcji) nie ma w prezentacji czego pokazać. Zapis frekwencji
     sam budzi powiadomienie, więc wiersz z zasiewu wystarczy — skan robi resztę przy pierwszym odczycie.
     Wiersz dostaje Anna Kowalczyk: to jej konto (`rodzic.kowalczyk`) jest personą rodzica w demo. */
  const demoDay = db.data.config.today;
  const firstLesson = demoDay && db.col('lessons').find((l) => l.classId === '7b' && l.date === demoDay && l.lessonNo === 1 && !l.groupId);
  if (firstLesson) {
    const row = db.one('attendance', (a) => a.lessonId === firstLesson.id && a.studentId === 'st_kowalczyk_anna');
    if (row) { row.status = 'nb'; row.minutes = 0; row.draft = false; row.excuseId = null; }
    else db.col('attendance').push({ id: `h_att_st_kowalczyk_anna_${firstLesson.id}`, lessonId: firstLesson.id, studentId: 'st_kowalczyk_anna', date: firstLesson.date, lessonNo: 1, classId: '7b', subjectId: firstLesson.subjectId, status: 'nb', minutes: 0, draft: false, byUserId: firstLesson.teacherId, at: firstLesson.date + 'T08:05:00Z', excuseId: null });
  }

  /* --- godzina zapisana ponad plan: materiał do kontroli liczby godzin (3.2.19) --- */
  if (!db.get('lessons', 'h_les_7b_2026-09-11_7')) {
    db.col('lessons').push({ id: 'h_les_7b_2026-09-11_7', date: '2026-09-11', lessonNo: 7, classId: '7b', groupId: null, subjectId: 'mat', teacherId: 'u_nowak', room: '12', topic: 'Zajęcia dodatkowe — powtórzenie przed sprawdzianem', curriculumItemIds: [], status: 'held', substituteTeacherId: null, combinedWith: null, attendanceDraft: false });
  }

  /* --- oceny demonstracyjne: cząstkowe tylko gdy 3.1 nic nie wpisało, a propozycje śródroczne
         tylko dla przedmiotów, których 3.1 nie używa w swoich testach (pol, ang, his, geo) --- */
  /* Oskar Mazurek dołączył 05.10 i nie ma jeszcze żadnej oceny cząstkowej — świadomie zostaje bez
     propozycji, żeby tablica klasyfikacji i lista zagrożonych pokazywały „brak podstaw do oceny”. */
  const PLAN = { st_kowalczyk_anna: 5, st_adamczyk_maja: 5, st_dbrowski_micha: 4, st_lewandowski_piotr: 4, st_dbrowska_emilia: 5, st_nowak_jan: 2, st_szymaska_karolina: 4, st_winiewska_zofia: 5, st_szymaski_tomasz: 3, st_zieliski_kacper: 2, st_kaczmarek_oliwia: 4, st_woniak_filip: 3 };
  const TEACHER = { pol: 'u_sikora', ang: 'u_krol', his: 'u_lis', geo: 'u_lis' };
  const grade = (o) => db.col('grades').push(Object.assign({ categoryId: null, categoryName: null, weight: 1, color: null, points: null, maxPoints: null, percent: null, comment: '', retakeOfId: null, makeup: false, lessonId: null, countsInAverage: true, locked: false, deleted: false, classId: '7b', semester: 1 }, o));
  if (!db.col('grades').some((g) => g.classId === '7b' && g.kind === 'partial')) {
    for (const [sid, v] of Object.entries(PLAN)) {
      if (!db.get('students', sid)) continue;
      for (const sub of Object.keys(TEACHER)) {
        grade({ id: `h_g_${sid}_${sub}_p1`, studentId: sid, subjectId: sub, categoryId: 'cat_spr', categoryName: 'sprawdzian', weight: 3, color: 'cat-1', value: String(v), date: '2026-09-25', teacherId: TEACHER[sub], kind: 'partial' });
        grade({ id: `h_g_${sid}_${sub}_p2`, studentId: sid, subjectId: sub, categoryId: 'cat_odp', categoryName: 'odpowiedź ustna', weight: 2, color: 'cat-6', value: String(Math.min(6, v + (sid.length % 2))), date: '2026-10-09', teacherId: TEACHER[sub], kind: 'partial' });
      }
    }
  }
  if (!db.col('grades').some((g) => g.classId === '7b' && (g.kind === 'proposedMid' || g.kind === 'midterm'))) {
    for (const [sid, v] of Object.entries(PLAN)) {
      if (!db.get('students', sid)) continue;
      for (const sub of Object.keys(TEACHER)) {
        grade({ id: `h_g_${sid}_${sub}_prop`, studentId: sid, subjectId: sub, value: String(v), weight: 1, countsInAverage: false, comment: 'Ocena proponowana śródroczna', date: '2026-10-16', teacherId: TEACHER[sub], kind: 'proposedMid' });
      }
    }
  }

  /* --- propozycje ocen zachowania (kolekcja 3.2) --- */
  if (!db.col('behaviorGrades').some((b) => db.get('students', b.studentId) && db.get('students', b.studentId).classId === '7b')) {
    const BEH = { st_kowalczyk_anna: 'wzorowe', st_adamczyk_maja: 'bardzo dobre', st_dbrowski_micha: 'dobre', st_lewandowski_piotr: 'dobre', st_dbrowska_emilia: 'bardzo dobre', st_nowak_jan: 'nieodpowiednie', st_szymaska_karolina: 'bardzo dobre', st_winiewska_zofia: 'wzorowe', st_szymaski_tomasz: 'dobre', st_zieliski_kacper: 'poprawne', st_kaczmarek_oliwia: 'bardzo dobre', st_woniak_filip: 'dobre', st_h_mazurek_oskar: 'dobre' };
    for (const [sid, value] of Object.entries(BEH)) {
      if (!db.get('students', sid)) continue;
      db.col('behaviorGrades').push({ id: `h_beh_${sid}_1`, studentId: sid, semester: 1, kind: 'proposed', value, points: 100, suggested: value, override: false, reason: null, byUserId: 'u_nowak', at: '2026-10-20T12:00:00Z' });
    }
  }

  ['excuses', 'behaviorGrades', 'remarks', 'semesterLocks', 'documents', 'reportCardHistory'].forEach((c) => db.col(c));
}
module.exports = { seed };
