'use strict';
/* Base seed: ONE school (single node). Other seed files (10-*.js …) add their domains on top and may reference these ids. */
const C = require('../lib/crypto'); const { addDays, weekday, today } = require('../lib/util');
const { DEFAULT_RETENTION } = require('../routes/retention');   // tabela klas dokumentacji (JRWA) — docs/RETENTION.md
const DEMO_PASSWORD = 'Szkola-2026!';
const KEY_CACHE = {}; let PW_CACHE = null; // per-process caches: RSA keys and the scrypt hash are the slow parts of seeding
const YEAR_START = '2026-09-01'; const TODAY = process.env.EDMAT_TODAY || '2026-10-23'; // a Friday in the seeded week
function seed(db, ctx) {
  const pw = PW_CACHE || (PW_CACHE = C.hashPassword(DEMO_PASSWORD));
  const schoolKeys = C.generateKeyPair();
  db.data.config = {
    school: { name: 'Szkoła Podstawowa nr 12 im. Marii Skłodowskiej-Curie w Krakowie', short: 'SP nr 12', address: 'ul. Szkolna 4, 31-000 Kraków', regon: '357123456', rspo: '12345', email: 'sekretariat@sp12.krakow.pl', phone: '12 555 01 02', director: 'dyr. Piotr Wiśniewski' },
    year: '2026/2027', today: TODAY, timezone: 'Europe/Warsaw',
    semesters: [
      { id: 1, name: 'Semestr 1', from: '2026-09-01', to: '2027-01-29', proposedDeadline: '2026-12-12', classificationMeeting: '2027-01-26', classificationDeadline: '2027-01-26', locked: false },
      { id: 2, name: 'Semestr 2', from: '2027-02-15', to: '2027-06-25', proposedDeadline: '2027-05-14', classificationMeeting: '2027-06-18', classificationDeadline: '2027-06-18', locked: false }],
    winterBreak: { from: '2027-02-01', to: '2027-02-14' }, holidays: [{ from: '2026-12-23', to: '2026-12-31', name: 'Zimowa przerwa świąteczna' }, { from: '2027-04-01', to: '2027-04-06', name: 'Wiosenna przerwa świąteczna' }],
    daysOff: [{ date: '2026-11-02', name: 'Dzień wolny od zajęć dydaktycznych' }, { date: '2027-05-04', name: 'Dzień wolny (egzamin ósmoklasisty)' }],
    lessonTimes: [{ no: 1, start: '08:00', end: '08:45' }, { no: 2, start: '08:55', end: '09:40' }, { no: 3, start: '09:50', end: '10:35' }, { no: 4, start: '10:45', end: '11:30' }, { no: 5, start: '11:45', end: '12:30' }, { no: 6, start: '12:45', end: '13:30' }, { no: 7, start: '13:40', end: '14:25' }, { no: 8, start: '14:35', end: '15:20' }],
    plusMinus: { plus: 0.5, minus: -0.25 }, percentScale: [{ min: 96, grade: 6 }, { min: 90, grade: 5 }, { min: 75, grade: 4 }, { min: 50, grade: 3 }, { min: 30, grade: 2 }, { min: 0, grade: 1 }],
    testLimits: { perDay: 1, perWeek: 3 }, retakeRule: 'higher', honorsAverage: 4.75, honorsBehavior: ['wzorowe', 'bardzo dobre'], behaviorScale: ['wzorowe', 'bardzo dobre', 'dobre', 'poprawne', 'nieodpowiednie', 'naganne'],
    behaviorPoints: { start: 100, thresholds: [{ min: 180, grade: 'wzorowe' }, { min: 140, grade: 'bardzo dobre' }, { min: 100, grade: 'dobre' }, { min: 60, grade: 'poprawne' }, { min: 20, grade: 'nieodpowiednie' }, { min: -999, grade: 'naganne' }] },
    unexcusedThresholdPercent: 50, warningDaysBeforeClassification: 30, sessionTimeoutMin: 15, sessionWarnBeforeMin: 2, logRetentionYears: 5, gradesArchiveRetentionYears: 50,
    retention: DEFAULT_RETENTION(),                                     // klasy dokumentacji z kategoriami archiwalnymi; okresy liczy server/routes/retention.js
    ipAllowlist: [], require2FAForGradeEditors: true, visibility: { classAverage: true, rankings: false, averagesToParents: true }, messaging: { parentsCanMessage: 'homeroomAndSubject' },
    /* R3 — dostęp opiekunów do danych ucznia pełnoletniego. 'until-objection' (domyślnie): opiekun
       widzi dane do chwili sprzeciwu ucznia; 'consent-required': od 18. urodzin nie widzi nic, dopóki
       uczeń nie zapisze zgody. Decyzja prawna należy do szkoły — patrz docs/GUARDIANS.md. */
    adultAccess: 'until-objection',
    mealPrice: 4.2, lunchCancelCutoff: '08:00', quietHoursDefault: { from: '21:00', to: '06:30' }, homeworkMaxAttachmentMB: 10,
    schoolPublicKey: schoolKeys.publicKey, schoolPrivateKey: schoolKeys.privateKey, anonymized: false
  };
  db.data.subjects = [
    { id: 'mat', name: 'Matematyka' }, { id: 'pol', name: 'Język polski' }, { id: 'ang', name: 'Język angielski' }, { id: 'fiz', name: 'Fizyka' }, { id: 'his', name: 'Historia' }, { id: 'bio', name: 'Biologia' }, { id: 'che', name: 'Chemia' }, { id: 'geo', name: 'Geografia' }, { id: 'inf', name: 'Informatyka' }, { id: 'wf', name: 'Wychowanie fizyczne' }, { id: 'muz', name: 'Muzyka' }, { id: 'pla', name: 'Plastyka' }, { id: 'edw', name: 'Edukacja wczesnoszkolna' }];
  const keys = (k) => (KEY_CACHE[k] = KEY_CACHE[k] || C.generateKeyPair());
  const user = (o) => { const u = Object.assign({ passwordHash: pw, mustChangePassword: false, totpEnabled: false, blocked: false, title: '', quietHours: null, createdAt: '2026-08-20T08:00:00Z' }, o); u.name = `${u.firstName} ${u.lastName}`; if (u.withKeys) { const k = keys(u.id); u.publicKey = k.publicKey; u.privateKey = k.privateKey; delete u.withKeys; } db.col('users').push(u); return u; };
  // staff
  user({ id: 'u_nowak', login: 'j.nowak', role: 'teacher', title: 'mgr', firstName: 'Joanna', lastName: 'Nowak', subjects: ['mat'], homeroomOf: '7b', email: 'j.nowak@sp12.krakow.pl', totpEnabled: false });
  user({ id: 'u_wojcik', login: 'a.wojcik', role: 'teacher', title: 'mgr', firstName: 'Adam', lastName: 'Wójcik', subjects: ['fiz', 'inf'] });
  user({ id: 'u_krol', login: 'e.krol', role: 'teacher', title: 'mgr', firstName: 'Ewa', lastName: 'Król', subjects: ['ang'] });
  user({ id: 'u_sikora', login: 'b.sikora', role: 'teacher', title: 'mgr', firstName: 'Beata', lastName: 'Sikora', subjects: ['pol'], homeroomOf: '7a' });
  user({ id: 'u_gorski', login: 't.gorski', role: 'teacher', title: 'mgr', firstName: 'Tomasz', lastName: 'Górski', subjects: ['che', 'bio'] });
  user({ id: 'u_lis', login: 'k.lis', role: 'teacher', title: 'mgr', firstName: 'Krzysztof', lastName: 'Lis', subjects: ['his', 'geo'], homeroomOf: '8b' });
  user({ id: 'u_mazur', login: 'a.mazur', role: 'teacher', title: 'mgr', firstName: 'Anna', lastName: 'Mazur', subjects: ['wf'], homeroomOf: '3a' });
  user({ id: 'u_kaczmarek', login: 'i.kaczmarek', role: 'teacher', title: 'mgr', firstName: 'Iwona', lastName: 'Kaczmarek', subjects: ['edw'], homeroomOf: '1a' });
  user({ id: 'u_dyrektor', login: 'dyrektor', role: 'principal', title: 'dyr.', firstName: 'Piotr', lastName: 'Wiśniewski', subjects: ['mat'] });
  user({ id: 'u_zielinska', login: 'e.zielinska', role: 'psychologist', title: 'mgr', firstName: 'Ewa', lastName: 'Zielińska', withKeys: true });
  user({ id: 'u_pedagog', login: 'pedagog', role: 'counselor', title: 'mgr', firstName: 'Marek', lastName: 'Dąbrowski', withKeys: true });
  user({ id: 'u_specjalny', login: 'pedagog.specjalny', role: 'specialEducator', title: 'mgr', firstName: 'Karolina', lastName: 'Lis', withKeys: true });
  user({ id: 'u_logopeda', login: 'logopeda', role: 'speechTherapist', title: 'mgr', firstName: 'Olga', lastName: 'Pawlak', withKeys: true });
  user({ id: 'u_wspomagajacy', login: 'n.wspomagajacy', role: 'supportTeacher', title: 'mgr', firstName: 'Rafał', lastName: 'Sobczak', withKeys: true });
  user({ id: 'u_sekretariat', login: 'sekretariat', role: 'registrar', firstName: 'Anna', lastName: 'Bąk' });
  user({ id: 'u_admin', login: 'admin', role: 'admin', firstName: 'Michał', lastName: 'Admin' });
  user({ id: 'u_iod', login: 'iod', role: 'dpo', firstName: 'Justyna', lastName: 'Ochrona' });
  user({ id: 'u_swietlica', login: 'swietlica', role: 'careEducator', firstName: 'Dorota', lastName: 'Kubiak' });
  user({ id: 'u_stolowka', login: 'stolowka', role: 'cafeteria', firstName: 'Halina', lastName: 'Kowal' });
  user({ id: 'u_biblioteka', login: 'biblioteka', role: 'librarian', firstName: 'Barbara', lastName: 'Szymańska' });
  user({ id: 'u_pielegniarka', login: 'pielegniarka', role: 'nurse', firstName: 'Renata', lastName: 'Zdrowa', withKeys: true });
  // classes
  db.data.classes = [
    { id: '1a', name: '1a', level: 1, homeroomTeacherId: 'u_kaczmarek', studentIds: [] },
    { id: '3a', name: '3a', level: 3, homeroomTeacherId: 'u_mazur', studentIds: [] },
    { id: '7a', name: '7a', level: 7, homeroomTeacherId: 'u_sikora', studentIds: [] },
    { id: '7b', name: '7b', level: 7, homeroomTeacherId: 'u_nowak', studentIds: [] },
    { id: '8b', name: '8b', level: 8, homeroomTeacherId: 'u_lis', studentIds: [] }];
  // students (7b in full; others smaller). PESELs are synthetic but checksum-valid.
  const pesel = (yy, mm, dd, serial, male) => { const m = mm + 20; let base = `${String(yy).padStart(2, '0')}${String(m).padStart(2, '0')}${String(dd).padStart(2, '0')}${String(serial).padStart(3, '0')}${male ? 1 : 2}`; const w = [1, 3, 7, 9, 1, 3, 7, 9, 1, 3]; const sum = w.reduce((s, wi, i) => s + wi * +base[i], 0); return base + ((10 - sum % 10) % 10); };
  let regNo = 1200; const students = [];
  const addStudent = (cls, rollNo, first, last, male, extra) => { const yy = { 1: 19, 3: 17, 7: 13, 8: 12 }[db.data.classes.find((c) => c.id === cls).level]; const mm = 1 + (rollNo % 12), dd = 1 + ((rollNo * 7) % 27); const serial = 100 + rollNo + 40 * Math.max(0, db.data.classes.findIndex((c) => c.id === cls)); const s = Object.assign({ id: 'st_' + last.toLowerCase().replace(/[^a-z]/g, '') + '_' + first.toLowerCase().replace(/[^a-z]/g, ''), rollNo, firstName: first, lastName: last, sex: male ? 'M' : 'K', classId: cls, pesel: pesel(yy, mm, dd, serial, male), birthDate: `20${yy}-${String(mm).padStart(2, '0')}-${String(dd).padStart(2, '0')}`, birthPlace: 'Kraków', birthPlaceLocative: 'w Krakowie', status: 'active', registerNo: ++regNo, parentIds: [], adult: false, adultSelfExcuse: false, parentAccessBlocked: false, socialWelfare: false, achievements: [], declension: { firstNameLocative: null, lastNameLocative: null } }, extra || {}); students.push(s); db.data.classes.find((c) => c.id === cls).studentIds.push(s.id); return s; };
  const b7 = [[3, 'Maja', 'Adamczyk', 0], [5, 'Michał', 'Dąbrowski', 1], [7, 'Anna', 'Kowalczyk', 0], [9, 'Piotr', 'Lewandowski', 1], [11, 'Emilia', 'Dąbrowska', 0], [12, 'Jan', 'Nowak', 1, { socialWelfare: true }], [14, 'Karolina', 'Szymańska', 0], [15, 'Zofia', 'Wiśniewska', 0], [16, 'Tomasz', 'Szymański', 1], [18, 'Kacper', 'Zieliński', 1], [19, 'Oliwia', 'Kaczmarek', 0], [20, 'Filip', 'Woźniak', 1]];
  b7.forEach(([no, f, l, m, x]) => addStudent('7b', no, f, l, m, x));
  [[1, 'Julia', 'Baran', 0], [2, 'Igor', 'Cichoń', 1], [3, 'Lena', 'Duda', 0], [4, 'Antoni', 'Grabowski', 1], [5, 'Hanna', 'Jasińska', 0], [6, 'Marcel', 'Krawczyk', 1]].forEach(([no, f, l, m]) => addStudent('7a', no, f, l, m));
  [[1, 'Aleksandra', 'Borowska', 0], [2, 'Szymon', 'Czarnecki', 1], [3, 'Natalia', 'Mróz', 0], [4, 'Wiktor', 'Olszewski', 1]].forEach(([no, f, l, m]) => addStudent('8b', no, f, l, m));
  [[1, 'Pola', 'Kowalczyk', 0], [2, 'Franciszek', 'Sowa', 1], [3, 'Zuzanna', 'Wrona', 0]].forEach(([no, f, l, m]) => addStudent('3a', no, f, l, m));
  [[1, 'Leon', 'Adamczyk', 1], [2, 'Alicja', 'Bednarek', 0], [3, 'Stanisław', 'Kot', 1]].forEach(([no, f, l, m]) => addStudent('1a', no, f, l, m));
  // Piotr Kowalczyk in 3a is Anna's brother: rename Pola -> keep Pola, add Piotr
  addStudent('3a', 4, 'Piotr', 'Kowalczyk', 1);
  db.data.students = students;
  // parents
  const parent = (id, login, first, last, childIds, extra) => { const u = user(Object.assign({ id, login, role: 'parent', firstName: first, lastName: last, childrenIds: childIds }, extra || {})); childIds.forEach((c) => { const s = students.find((x) => x.id === c); if (!s) throw new Error('seed: unknown student id ' + c); s.parentIds.push(id); }); return u; };
  parent('u_p_kowalczyk', 'rodzic.kowalczyk', 'Marta', 'Kowalczyk', ['st_kowalczyk_anna', 'st_kowalczyk_piotr']);
  parent('u_p_kowalczyk2', 'rodzic.kowalczyk2', 'Tomasz', 'Kowalczyk', ['st_kowalczyk_anna'], { custodyNote: 'rozwód; pełnia praw obojga', separateAccount: true });
  parent('u_p_nowak', 'rodzic.nowak', 'Katarzyna', 'Nowak', ['st_nowak_jan']);
  parent('u_p_lewandowski', 'rodzic.lewandowski', 'Magdalena', 'Lewandowska', ['st_lewandowski_piotr']);
  parent('u_p_wisniewska', 'rodzic.wisniewska', 'Robert', 'Wiśniewski', ['st_winiewska_zofia']);
  parent('u_p_zielinski', 'rodzic.zielinski', 'Agnieszka', 'Zielińska', ['st_zieliski_kacper']);
  parent('u_p_adamczyk', 'rodzic.adamczyk', 'Katarzyna', 'Adamczyk', ['st_adamczyk_maja', 'st_adamczyk_leon']);
  // student accounts for every student (login = first.last)
  for (const s of students) user({ id: 'u_' + s.id, login: (s.firstName + '.' + s.lastName).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/ł/g, 'l'), role: 'student', firstName: s.firstName, lastName: s.lastName, studentId: s.id, classId: s.classId });
  // an adult student in 8b (Aleksandra, 18)
  const adult = students.find((s) => s.id === 'st_borowska_aleksandra'); adult.adult = true; adult.birthDate = '2008-05-14';
  // groups
  db.data.groups = [
    { id: 'g_7b_ang1', name: '7b / j. ang. gr. 1', kind: 'language', classIds: ['7b'], subjectId: 'ang', studentIds: b7.slice(0, 6).map(([, f, l]) => 'st_' + l.toLowerCase().replace(/[^a-z]/g, '') + '_' + f.toLowerCase().replace(/[^a-z]/g, '')) },
    { id: 'g_7b_ang2', name: '7b / j. ang. gr. 2', kind: 'language', classIds: ['7b'], subjectId: 'ang', studentIds: b7.slice(6).map(([, f, l]) => 'st_' + l.toLowerCase().replace(/[^a-z]/g, '') + '_' + f.toLowerCase().replace(/[^a-z]/g, '')) },
    { id: 'g_7a_ang2', name: '7a / j. ang. gr. 2', kind: 'language', classIds: ['7a'], subjectId: 'ang', studentIds: ['st_duda_lena', 'st_grabowski_antoni', 'st_jasiska_hanna'] },
    { id: 'g_lab_che', name: '7b / chemia lab.', kind: 'lab', classIds: ['7b'], subjectId: 'che', studentIds: b7.slice(0, 6).map(([, f, l]) => 'st_' + l.toLowerCase().replace(/[^a-z]/g, '') + '_' + f.toLowerCase().replace(/[^a-z]/g, '')) },
    { id: 'g_cross_inf', name: 'Koło informatyczne 7a+7b', kind: 'cross-class', classIds: ['7a', '7b'], subjectId: 'inf', studentIds: ['st_kowalczyk_anna', 'st_nowak_jan', 'st_grabowski_antoni'] }];
  // timetable for 7b (weekday 1..5, lessonNo) and a few for others
  const tt = []; const addTT = (cls, wd, no, sub, t, room, groupId) => tt.push({ id: `tt_${cls}_${wd}_${no}${groupId ? '_' + groupId : ''}`, classId: cls, weekday: wd, lessonNo: no, subjectId: sub, teacherId: t, room, groupId: groupId || null });
  const wk7b = { 1: [['mat', 'u_nowak', '12'], ['pol', 'u_sikora', '8'], ['ang', 'u_krol', '15', 'g_7b_ang1'], ['fiz', 'u_wojcik', '24'], ['his', 'u_lis', '9'], ['wf', 'u_mazur', 'sala gim.']],
    2: [['pol', 'u_sikora', '8'], ['mat', 'u_nowak', '12'], ['bio', 'u_gorski', '21'], ['ang', 'u_krol', '15', 'g_7b_ang1'], ['geo', 'u_lis', '9']],
    3: [['mat', 'u_nowak', '12'], ['che', 'u_gorski', '21', 'g_lab_che'], ['pol', 'u_sikora', '8'], ['inf', 'u_wojcik', '30'], ['muz', 'u_mazur', '5']],
    4: [['fiz', 'u_wojcik', '24'], ['mat', 'u_nowak', '12'], ['ang', 'u_krol', '15', 'g_7b_ang1'], ['pol', 'u_sikora', '8'], ['wf', 'u_mazur', 'sala gim.'], ['pla', 'u_mazur', '5']],
    5: [['mat', 'u_nowak', '12'], ['fiz', 'u_wojcik', '24'], ['mat', 'u_nowak', '12'], ['his', 'u_lis', '9'], ['pol', 'u_sikora', '8']] };
  for (const wd of [1, 2, 3, 4, 5]) wk7b[wd].forEach(([sub, t, room, g], i) => { addTT('7b', wd, i + 1, sub, t, room, g); if (g === 'g_7b_ang1') addTT('7b', wd, i + 1, 'ang', 'u_krol', '16', 'g_7b_ang2'); });
  for (const wd of [1, 2, 3, 4, 5]) { addTT('7a', wd, 1, 'fiz', 'u_wojcik', '24'); addTT('7a', wd, 2, 'pol', 'u_sikora', '8'); addTT('7a', wd, 3, 'mat', 'u_dyrektor', '11'); addTT('7a', wd, 4, 'ang', 'u_krol', '16', 'g_7a_ang2'); addTT('8b', wd, 2, 'fiz', 'u_wojcik', '24'); addTT('8b', wd, 3, 'his', 'u_lis', '9'); addTT('3a', wd, 1, 'wf', 'u_mazur', 'sala gim.'); addTT('1a', wd, 1, 'edw', 'u_kaczmarek', '2'); addTT('1a', wd, 2, 'edw', 'u_kaczmarek', '2'); }
  db.data.timetable = tt;
  // lesson instances for the school days from year start up to TODAY (held) + next 2 weeks (planned)
  const lessons = []; const isSchoolDay = (d) => weekday(d) <= 5 && !db.data.config.daysOff.some((x) => x.date === d) && !db.data.config.holidays.some((h) => d >= h.from && d <= h.to);
  for (let d = YEAR_START; d <= addDays(TODAY, 14); d = addDays(d, 1)) { if (!isSchoolDay(d)) continue; const wd = weekday(d); for (const t of tt.filter((x) => x.weekday === wd)) lessons.push({ id: `les_${t.id}_${d}`, date: d, lessonNo: t.lessonNo, classId: t.classId, groupId: t.groupId, subjectId: t.subjectId, teacherId: t.teacherId, room: t.room, topic: d < TODAY ? null : null, curriculumItemIds: [], status: d < TODAY ? 'held' : 'planned', substituteTeacherId: null, combinedWith: null, attendanceDraft: false }); }
  db.data.lessons = lessons;
  // grade categories (school-wide defaults; teachers may add their own)
  db.data.gradeCategories = [
    { id: 'cat_spr', name: 'sprawdzian', weight: 3, color: 'cat-1', countsInAverage: true, subjectId: null },
    { id: 'cat_kart', name: 'kartkówka', weight: 2, color: 'cat-2', countsInAverage: true, subjectId: null },
    { id: 'cat_zd', name: 'zadanie domowe', weight: 1, color: 'cat-3', countsInAverage: true, subjectId: null },
    { id: 'cat_akt', name: 'aktywność', weight: 1, color: 'cat-4', countsInAverage: false, subjectId: null },
    { id: 'cat_proj', name: 'projekt', weight: 4, color: 'cat-5', countsInAverage: true, subjectId: null },
    { id: 'cat_odp', name: 'odpowiedź ustna', weight: 2, color: 'cat-6', countsInAverage: true, subjectId: null },
    { id: 'cat_lab', name: 'laboratorium', weight: 2, color: 'cat-7', countsInAverage: true, subjectId: 'che' }];
  // core curriculum items (MEN) for math 7 with result plan
  db.data.curriculum = [
    { id: 'cur_mat7_1', subjectId: 'mat', level: 7, code: 'I.1', title: 'Potęgi o podstawach wymiernych', hours: 10 }, { id: 'cur_mat7_2', subjectId: 'mat', level: 7, code: 'II.1', title: 'Pierwiastki', hours: 8 },
    { id: 'cur_mat7_3', subjectId: 'mat', level: 7, code: 'III.2', title: 'Ułamki zwykłe – działania', hours: 12 }, { id: 'cur_mat7_4', subjectId: 'mat', level: 7, code: 'III.3', title: 'Ułamki dziesiętne', hours: 8 },
    { id: 'cur_mat7_5', subjectId: 'mat', level: 7, code: 'IV.1', title: 'Wyrażenia algebraiczne', hours: 14 }, { id: 'cur_mat7_6', subjectId: 'mat', level: 7, code: 'VI.1', title: 'Równania z jedną niewiadomą', hours: 12 },
    { id: 'cur_mat7_7', subjectId: 'mat', level: 7, code: 'VII.1', title: 'Proporcjonalność prosta', hours: 6 }, { id: 'cur_mat7_8', subjectId: 'mat', level: 7, code: 'VIII.1', title: 'Twierdzenie Pitagorasa', hours: 10 },
    { id: 'cur_fiz7_1', subjectId: 'fiz', level: 7, code: 'I.1', title: 'Wymagania przekrojowe – pomiary', hours: 6 }, { id: 'cur_fiz7_2', subjectId: 'fiz', level: 7, code: 'II.1', title: 'Ruch i siły', hours: 20 }, { id: 'cur_fiz7_3', subjectId: 'fiz', level: 7, code: 'III.1', title: 'Energia', hours: 12 },
    { id: 'cur_pol7_1', subjectId: 'pol', level: 7, code: 'I.1', title: 'Kształcenie literackie', hours: 40 }, { id: 'cur_pol7_2', subjectId: 'pol', level: 7, code: 'II.1', title: 'Kształcenie językowe', hours: 30 }];
  // descriptive assessment phrase bank for grades 1–3
  db.data.phraseBank = [
    { id: 'ph1', area: 'Edukacja polonistyczna', text: 'Czyta płynnie i ze zrozumieniem krótkie teksty.' }, { id: 'ph2', area: 'Edukacja polonistyczna', text: 'Wypowiada się pełnymi zdaniami na podany temat.' }, { id: 'ph3', area: 'Edukacja matematyczna', text: 'Dodaje i odejmuje w zakresie 20 z przekroczeniem progu dziesiątkowego.' }, { id: 'ph4', area: 'Edukacja matematyczna', text: 'Rozwiązuje proste zadania tekstowe.' }, { id: 'ph5', area: 'Edukacja społeczna', text: 'Współpracuje w grupie i przestrzega ustalonych zasad.' }, { id: 'ph6', area: 'Edukacja przyrodnicza', text: 'Rozpoznaje pory roku i związane z nimi zjawiska.' }, { id: 'ph7', area: 'Edukacja artystyczna', text: 'Chętnie podejmuje działania plastyczne, dba o estetykę prac.' }, { id: 'ph8', area: 'Wychowanie fizyczne', text: 'Uczestniczy w zabawach ruchowych, przestrzega zasad bezpieczeństwa.' }];
  db.data.developmentAreas = ['Edukacja polonistyczna', 'Edukacja matematyczna', 'Edukacja społeczna', 'Edukacja przyrodnicza', 'Edukacja artystyczna', 'Wychowanie fizyczne', 'Zachowanie'];
  ['sessions', 'audit', 'attendance', 'grades', 'notifications', 'messages'].forEach((c) => db.col(c));
}
module.exports = { seed, DEMO_PASSWORD, TODAY, YEAR_START };
