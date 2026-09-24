'use strict';
/* Seed for 3.6 (uczeń) and 3.9 (wymagania niefunkcjonalne).
   Adds: oceny cząstkowe 7b/8b, frekwencja na dziś, zapowiedzi sprawdzianów, zadania domowe,
   materiały z lekcji, wypożyczenia biblioteczne, wiadomości startowe i opiekun ucznia pełnoletniego.
   Wszystkie wiersze mają identyfikatory z przedrostkiem "st_", żeby nie kolidowały z innymi sekcjami. */
const { addDays } = require('../lib/util');

const PDF_B64 = 'JVBERi0xLjQKMSAwIG9iajw8L1R5cGUvQ2F0YWxvZy9QYWdlcyAyIDAgUj4+ZW5kb2JqCjIgMCBvYmo8PC9UeXBlL1BhZ2VzL0tpZHNbMyAwIFJdL0NvdW50IDE+PmVuZG9iagozIDAgb2JqPDwvVHlwZS9QYWdlL1BhcmVudCAyIDAgUi9NZWRpYUJveFswIDAgMzAwIDEyMF0vQ29udGVudHMgNCAwIFIvUmVzb3VyY2VzPDwvRm9udDw8L0YxIDUgMCBSPj4+Pj4+ZW5kb2JqCjQgMCBvYmo8PC9MZW5ndGggNjA+PnN0cmVhbQpCVCAvRjEgMTIgVGYgMjAgNjAgVGQgKEVkTWF0IC0gbWF0ZXJpYWwgeiBsZWtjamkpIFRqIEVUCmVuZHN0cmVhbSBlbmRvYmoKNSAwIG9iajw8L1R5cGUvRm9udC9TdWJ0eXBlL1R5cGUxL0Jhc2VGb250L0hlbHZldGljYT4+ZW5kb2JqCnRyYWlsZXI8PC9Sb290IDEgMCBSPj4=';
const PDF_URL = 'data:application/pdf;base64,' + PDF_B64;

function seed(db) {
  const cfg = db.data.config; const TODAY = cfg.today;
  /* --- reguły szkolne używane przez widok ucznia --- */
  cfg.adultSelfExcuseAllowed = true;                 // statut §24 ust. 3: uczeń pełnoletni usprawiedliwia się sam
  cfg.testNoticeDays = 7;                            // zapowiedź sprawdzianu z tygodniowym wyprzedzeniem
  cfg.termGradeThresholds = { 2: 1.75, 3: 2.51, 4: 3.51, 5: 4.51, 6: 5.51 }; // średnia ważona → ocena semestralna
  cfg.libraryNoticeDaysBeforeSemesterEnd = 60;       // przypomnienie o zwrocie przed końcem semestru
  if (!cfg.studentShortcuts) cfg.studentShortcuts = true;

  const catOf = (id) => db.data.gradeCategories.find((c) => c.id === id);
  const lessonId = (cls, wd, no, date, group) => `les_tt_${cls}_${wd}_${no}${group ? '_' + group : ''}_${date}`;

  /* --- oceny cząstkowe (semestr 1) --- */
  const G = [];
  const grade = (key, studentId, classId, subjectId, teacherId, catId, value, date, extra) => {
    const c = catOf(catId);
    G.push(Object.assign({
      id: 'st_gr_' + key, studentId, subjectId, classId, categoryId: catId, categoryName: c.name, weight: c.weight, color: c.color,
      value, points: null, maxPoints: null, percent: null, comment: '', retakeOfId: null, makeup: false, lessonId: null,
      date, teacherId, kind: 'partial', semester: 1, countsInAverage: c.countsInAverage, locked: false, deleted: false, createdAt: date + 'T12:00:00.000Z'
    }, extra || {}));
  };
  const A = 'st_kowalczyk_anna';
  grade('a_mat_1', A, '7b', 'mat', 'u_nowak', 'cat_spr', '5', '2026-10-08');
  grade('a_mat_2', A, '7b', 'mat', 'u_nowak', 'cat_kart', '4', '2026-10-14');
  grade('a_mat_3', A, '7b', 'mat', 'u_nowak', 'cat_zd', '3+', '2026-10-19', { comment: 'Poprawnie rozwiązane 3 z 4 zadań.' });
  grade('a_mat_4', A, '7b', 'mat', 'u_nowak', 'cat_akt', '3', '2026-10-22');
  grade('a_pol_1', A, '7b', 'pol', 'u_sikora', 'cat_spr', '4', '2026-10-09');
  grade('a_pol_2', A, '7b', 'pol', 'u_sikora', 'cat_kart', '5', '2026-10-20');
  grade('a_pol_3', A, '7b', 'pol', 'u_sikora', 'cat_odp', '4+', '2026-10-23', { comment: 'Bardzo dobra analiza środków stylistycznych.' });
  grade('a_fiz_1', A, '7b', 'fiz', 'u_wojcik', 'cat_spr', '4', '2026-10-07');
  grade('a_fiz_2', A, '7b', 'fiz', 'u_wojcik', 'cat_kart', '3', '2026-10-15');
  grade('a_fiz_3', A, '7b', 'fiz', 'u_wojcik', 'cat_zd', 'np', '2026-10-21');
  grade('a_ang_1', A, '7b', 'ang', 'u_krol', 'cat_spr', '5', '2026-10-06');
  grade('a_ang_2', A, '7b', 'ang', 'u_krol', 'cat_kart', '5', '2026-10-13');
  grade('a_ang_3', A, '7b', 'ang', 'u_krol', 'cat_akt', '4+', '2026-10-22');
  grade('a_his_1', A, '7b', 'his', 'u_lis', 'cat_spr', '4', '2026-10-02');
  grade('a_his_2', A, '7b', 'his', 'u_lis', 'cat_zd', 'bz', '2026-10-12');
  grade('a_his_3', A, '7b', 'his', 'u_lis', 'cat_odp', '3+', '2026-10-21');
  // koledzy z klasy — żeby test „nie widzę cudzych ocen” miał co chronić
  grade('j_mat_1', 'st_nowak_jan', '7b', 'mat', 'u_nowak', 'cat_spr', '2', '2026-10-08');
  grade('j_mat_2', 'st_nowak_jan', '7b', 'mat', 'u_nowak', 'cat_kart', '3', '2026-10-14');
  grade('m_mat_1', 'st_adamczyk_maja', '7b', 'mat', 'u_nowak', 'cat_spr', '6', '2026-10-08');
  // uczennica pełnoletnia z 8b
  grade('b_his_1', 'st_borowska_aleksandra', '8b', 'his', 'u_lis', 'cat_spr', '4', '2026-10-05');
  grade('b_his_2', 'st_borowska_aleksandra', '8b', 'his', 'u_lis', 'cat_odp', '5', '2026-10-19');
  grade('b_fiz_1', 'st_borowska_aleksandra', '8b', 'fiz', 'u_wojcik', 'cat_kart', '4', '2026-10-16');
  const grades = db.col('grades');
  for (const g of G) if (!grades.some((x) => x.id === g.id)) grades.push(g);

  /* --- zmiany w planie na dziś (7b): zmiana sali i odwołana lekcja --- */
  const todays7b = db.col('lessons').filter((l) => l.date === TODAY && l.classId === '7b');
  const fiz = todays7b.find((l) => l.subjectId === 'fiz');
  if (fiz && !fiz.roomChangedFrom) { fiz.roomChangedFrom = fiz.room; fiz.room = '26'; fiz.changedAt = TODAY + 'T07:12:00.000Z'; fiz.changeReason = 'Remont w sali 24 – zajęcia w sali 26.'; }
  const his = todays7b.find((l) => l.subjectId === 'his');
  if (his && his.status !== 'cancelled') { his.status = 'cancelled'; his.changedAt = TODAY + 'T07:20:00.000Z'; his.changeReason = 'Nieobecność nauczyciela – klasa czeka w czytelni pod opieką bibliotekarza.'; }

  /* --- frekwencja ucznia na dzisiejszych lekcjach --- */
  const att = db.col('attendance');
  const statuses = { 1: ['ob', 0], 2: ['sp', 6], 3: ['ob', 0], 5: ['ob', 0] };
  for (const l of todays7b) {
    if (l.status === 'cancelled') continue;
    const [status, minutes] = statuses[l.lessonNo] || ['ob', 0];
    for (const sid of db.get('classes', '7b').studentIds) {
      if (l.groupId && !(db.get('groups', l.groupId) || { studentIds: [] }).studentIds.includes(sid)) continue;
      if (att.some((a) => a.lessonId === l.id && a.studentId === sid)) continue;
      const mine = sid === A;
      att.push({ id: 'st_att_' + l.id + '_' + sid, lessonId: l.id, studentId: sid, date: l.date, lessonNo: l.lessonNo, classId: l.classId, subjectId: l.subjectId,
        status: mine ? status : (sid === 'st_nowak_jan' && l.lessonNo === 2 ? 'nb' : 'ob'), minutes: mine ? minutes : 0, draft: false, byUserId: l.teacherId, at: l.date + 'T08:05:00.000Z', excuseId: null });
    }
  }

  /* --- zapowiedziane sprawdziany i kartkówki --- */
  const tests = db.col('tests');
  const addTest = (id, classId, subjectId, teacherId, date, scope, kind, announced) => {
    if (tests.some((t) => t.id === id)) return;
    tests.push({ id, classId, subjectId, teacherId, date, scope, kind, createdAt: announced + 'T09:00:00.000Z', announcedAt: announced + 'T09:00:00.000Z' });
  };
  addTest('st_test_mat_30', '7b', 'mat', 'u_nowak', '2026-10-30', 'Równania z jedną niewiadomą: rozwiązywanie, zadania tekstowe, przekształcanie wzorów.', 'sprawdzian', '2026-10-09');
  addTest('st_test_fiz_30', '7b', 'fiz', 'u_wojcik', '2026-10-30', 'Prawo Ohma, opór zastępczy, jednostki. Zadania z karty pracy.', 'sprawdzian', '2026-10-13');
  addTest('st_test_pol_28', '7b', 'pol', 'u_sikora', '2026-10-28', 'Środki stylistyczne w liryce, analiza wiersza.', 'sprawdzian', '2026-10-12');
  addTest('st_test_ang_26', '7b', 'ang', 'u_krol', '2026-10-26', 'Unit 3 – słownictwo i czasy przeszłe.', 'kartkówka', '2026-10-23');
  addTest('st_test_mat_06', '7b', 'mat', 'u_nowak', '2026-11-06', 'Proporcjonalność prosta – zadania.', 'sprawdzian', '2026-10-20');
  addTest('st_test_his_29', '8b', 'his', 'u_lis', '2026-10-29', 'II wojna światowa – przyczyny i przebieg kampanii wrześniowej.', 'sprawdzian', '2026-10-15');

  /* --- zadania domowe i oddane rozwiązania --- */
  const hw = db.col('homework');
  const addHw = (id, classId, subjectId, teacherId, text, dueAt, groupId) => { if (!hw.some((x) => x.id === id)) hw.push({ id, classId, groupId: groupId || null, subjectId, teacherId, text, dueAt, maxAttachmentMB: cfg.homeworkMaxAttachmentMB || 10, lockAfterDue: false, attachments: [], createdAt: '2026-10-22T14:00:00.000Z' }); };
  addHw('st_hw_mat', '7b', 'mat', 'u_nowak', 'Zadania 4–7, s. 112 (równania z jedną niewiadomą)', addDays(TODAY, 1) + 'T23:59:00.000Z');
  addHw('st_hw_ang', '7b', 'ang', 'u_krol', 'Unit 3 – słownictwo, ćwiczenie 5', addDays(TODAY, 1) + 'T23:59:00.000Z', 'g_7b_ang1');
  addHw('st_hw_fiz', '7b', 'fiz', 'u_wojcik', 'Sprawozdanie z doświadczenia „Prawo Ohma”', addDays(TODAY, 3) + 'T23:59:00.000Z');
  addHw('st_hw_his_8b', '8b', 'his', 'u_lis', 'Notatka: skutki kampanii wrześniowej', addDays(TODAY, 1) + 'T23:59:00.000Z');
  const subs = db.col('homeworkSubmissions');
  if (!subs.some((s) => s.id === 'st_sub_fiz_anna')) subs.push({ id: 'st_sub_fiz_anna', homeworkId: 'st_hw_fiz', studentId: A, text: 'Sprawozdanie w załączniku – pomiary i wykres U(I).', files: [], receivedAt: '2026-10-23T18:02:11.000Z', gradeId: null, reviewedAt: null, createdAt: '2026-10-23T18:02:11.000Z' });

  /* --- materiały z lekcji --- */
  const mats = db.col('materials');
  /* Współpraca nad materiałami (routes/materials.js): każdy materiał demo jest otwarty (`coopAllowed`), jeden ma już
     zgłoszenie współpracownika i opis, żeby ekran „Współpraca” miał co pokazać. */
  const addMat = (id, lid, subjectId, classId, name, teacherId, at, extra) => { if (!mats.some((m) => m.id === id)) mats.push(Object.assign({ id, lessonId: lid, classId, subjectId, name, type: 'application/pdf', dataUrl: PDF_URL, size: PDF_URL.length, byUserId: teacherId, at, createdAt: at, coopAllowed: true, description: '', coopClaims: [] }, extra || {})); };
  addMat('st_mt_fiz', lessonId('7b', 5, 2, TODAY), 'fiz', '7b', 'Prawo Ohma – prezentacja', 'u_wojcik', TODAY + 'T10:00:00.000Z');
  addMat('st_mt_mat', lessonId('7b', 5, 1, TODAY), 'mat', '7b', 'Równania – karta pracy', 'u_nowak', TODAY + 'T08:40:00.000Z', {
    description: 'Karta pracy do równań pierwszego stopnia: 12 zadań, w tym 4 z treścią. Brakuje wersji dla grupy z dostosowaniem (mniej zadań, większa czcionka) i klucza odpowiedzi.',
    coopClaims: [{ userId: 'u_wojcik', at: TODAY + 'T12:10:00.000Z', note: 'Zrobię klucz odpowiedzi i dwa zadania z fizyki (droga, prędkość) na tę samą kartę.' }]
  });
  const lc = db.col('logComments');
  if (!lc.some((c) => c.id === 'lc_mat_coop_1')) lc.push({ id: 'lc_mat_coop_1', kind: 'materials', entryId: 'st_mt_mat', userId: 'u_wojcik', at: TODAY + 'T12:12:00.000Z', text: 'Zadania z treścią przydadzą się też u mnie na fizyce — podeślę wersję z jednostkami do końca tygodnia.', private: false, deleted: false });
  addMat('st_mt_pol', lessonId('7b', 4, 4, '2026-10-22'), 'pol', '7b', 'Środki stylistyczne – notatka', 'u_sikora', '2026-10-22T11:20:00.000Z');
  addMat('st_mt_his_8b', lessonId('8b', 5, 3, TODAY), 'his', '8b', 'Kampania wrześniowa – oś czasu', 'u_lis', TODAY + 'T10:30:00.000Z');

  /* --- biblioteka: wypożyczenia (jeśli sekcja 3.8 jeszcze ich nie zasiała) --- */
  const loans = db.col('libraryLoans');
  const addLoan = (id, studentId, title, author, loanedAt, dueDate) => { if (!loans.some((l) => l.id === id)) loans.push({ id, studentId, title, author, barcode: id.toUpperCase(), loanedAt, dueDate, returnedAt: null, extendedCount: 0, byUserId: 'u_biblioteka', createdAt: loanedAt + 'T09:00:00.000Z' }); };
  if (!loans.some((l) => l.studentId === A && !l.returnedAt)) addLoan('st_loan_anna', A, 'Pan Tadeusz', 'Adam Mickiewicz', '2026-09-25', '2026-12-15');
  if (!loans.some((l) => l.studentId === 'st_borowska_aleksandra' && !l.returnedAt)) addLoan('st_loan_borowska', 'st_borowska_aleksandra', 'Zbrodnia i kara', 'Fiodor Dostojewski', '2026-10-02', '2026-12-18');

  /* --- opiekun uczennicy pełnoletniej (potrzebny do sprzeciwu z 3.6.12) --- */
  if (!db.one('users', (u) => u.id === 'st_u_p_borowski')) {
    db.col('users').push({ id: 'st_u_p_borowski', login: 'rodzic.borowska', role: 'parent', firstName: 'Marek', lastName: 'Borowski', name: 'Marek Borowski',
      childrenIds: ['st_borowska_aleksandra'], passwordHash: db.one('users', (u) => u.login === 'rodzic.kowalczyk').passwordHash,
      mustChangePassword: false, totpEnabled: false, blocked: false, title: '', quietHours: null, createdAt: '2026-08-20T08:00:00Z' });
    const ola = db.get('students', 'st_borowska_aleksandra'); if (ola && !ola.parentIds.includes('st_u_p_borowski')) ola.parentIds.push('st_u_p_borowski');
  }

  /* --- wiadomości startowe w skrzynce ucznia --- */
  const msgs = db.col('messages');
  const uid = (sid) => 'u_' + sid;
  const addMsg = (m) => { if (!msgs.some((x) => x.id === m.id)) msgs.push(Object.assign({ kind: 'message', confidential: false, requiresAck: false, readBy: {}, deliveredTo: m.toUserIds.slice(), deliveredAt: {}, ackBy: {}, attachments: [], threadId: m.id }, m)); };
  addMsg({ id: 'st_msg_1', fromUserId: 'u_nowak', toUserIds: [uid(A)], subject: 'Odp.: pytanie o zadanie 6', body: 'Podpowiedź: najpierw wyłącz wspólny czynnik przed nawias, potem rozwiąż równanie iloczynowe. Gdyby dalej nie wychodziło, zostań po lekcji w poniedziałek.', at: '2026-10-23T15:10:00.000Z', readBy: { [uid(A)]: '2026-10-23T15:40:00.000Z' } });
  addMsg({ id: 'st_msg_2', fromUserId: 'u_wojcik', toUserIds: db.get('classes', '7b').studentIds.map(uid), subject: 'Zakres sprawdzianu 30.10.2026', body: 'Prawo Ohma, opór zastępczy, jednostki. Zadania z karty pracy oraz przykłady 1–5 z podręcznika.', at: '2026-10-22T13:05:00.000Z', kind: 'broadcast' });
  addMsg({ id: 'st_msg_3', fromUserId: 'u_biblioteka', toUserIds: [uid(A)], subject: 'Termin zwrotu: „Pan Tadeusz”', body: 'Książkę należy zwrócić do 15.12.2026, przed końcem semestru. Wypożyczenie można przedłużyć w bibliotece.', at: '2026-10-20T09:30:00.000Z' });
  addMsg({ id: 'st_msg_4', fromUserId: 'u_nowak', toUserIds: ['u_p_kowalczyk'], subject: 'Upomnienie: nieobecności nieusprawiedliwione', body: 'Proszę o potwierdzenie odbioru informacji o nieobecnościach nieusprawiedliwionych w październiku.', at: '2026-10-21T09:15:00.000Z', kind: 'warning', requiresAck: true });

  ['materials', 'libraryLoans', 'homework', 'homeworkSubmissions', 'tests', 'pushSubscriptions'].forEach((c) => db.col(c));
}
module.exports = { seed };
