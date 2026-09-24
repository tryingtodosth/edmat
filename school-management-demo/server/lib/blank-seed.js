'use strict';
/* Blank install (EDMAT_SEED=blank or createApp({ blank: true })): an empty school that the first-run wizard configures. Not loaded by the normal seed loader (no numeric prefix). */
const C = require('../lib/crypto'); const { today } = require('../lib/util');
/** Niedziela wielkanocna dla danego roku (algorytm Meeusa/Jonesa/Butchera, kalendarz gregoriański). */
function easter(year) {
  const a = year % 19, b = Math.floor(year / 100), c = year % 100;
  const d = Math.floor(b / 4), e = b % 4, f = Math.floor((b + 8) / 25), g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30, i = Math.floor(c / 4), k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7, m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31), day = ((h + l - 7 * m + 114) % 31) + 1;
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}
const shift = (iso, n) => { const d = new Date(iso + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
/** Ustawowe dni wolne od zajęć w roku szkolnym `start/start+1` (bez sobót i niedziel — te i tak nie są dniami nauki).
    OPS3-01 — `breaks` to przerwy tego samego roku (ferie, przerwy świąteczne). Walidator struktury roku
    (`server/routes/admin.js validateYear`) uznaje dzień wolny leżący wewnątrz przerwy za sprzeczny wpis,
    a Poniedziałek Wielkanocny **zawsze** leży w wiosennej przerwie świątecznej [Wielkanoc−3, Wielkanoc+2].
    Bez tego filtra kalendarz, który sam wypisał kreator, nie dawał się zapisać (400 `year_invalid`) —
    w żadnym roku i w żadnej szkole. Dzień w przerwie i tak jest wolny, więc nic się nie gubi. */
function statutoryDaysOff(start, breaks) {
  const next = start + 1, e = easter(next);
  const rows = [
    [`${start}-11-01`, 'Wszystkich Świętych'], [`${start}-11-11`, 'Narodowe Święto Niepodległości'],
    [`${next}-01-01`, 'Nowy Rok'], [`${next}-01-06`, 'Święto Trzech Króli'],
    [shift(e, 1), 'Poniedziałek Wielkanocny'],
    [`${next}-05-01`, 'Święto Pracy'], [`${next}-05-03`, 'Święto Konstytucji 3 Maja'],
    [shift(e, 60), 'Boże Ciało']
  ];
  const ranges = (breaks || []).filter((b) => b && b.from && b.to);
  const inBreak = (d) => ranges.some((b) => d >= b.from && d <= b.to);
  return rows.filter(([d]) => { const wd = new Date(d + 'T00:00:00Z').getUTCDay(); return wd !== 0 && wd !== 6; })
    .filter(([d]) => !inBreak(d))
    .map(([date, name]) => ({ date, name })).sort((a, b) => (a.date < b.date ? -1 : 1));
}
/** Struktura roku szkolnego: semestry, ferie zimowe, przerwy świąteczne i ustawowe dni wolne. */
function schoolYearFor(date) {
  const y = +date.slice(0, 4), m = +date.slice(5, 7); const start = m >= 8 ? y : y - 1; const next = start + 1;
  const e = easter(next);
  const winterBreak = { from: `${next}-02-01`, to: `${next}-02-14`, name: 'Ferie zimowe' };
  const holidays = [
    { from: `${start}-12-23`, to: `${start}-12-31`, name: 'Zimowa przerwa świąteczna' },
    { from: shift(e, -3), to: shift(e, 2), name: 'Wiosenna przerwa świąteczna' }];
  return {
    label: `${start}/${next}`, start,
    semesters: [
      { id: 1, name: 'Semestr 1', from: `${start}-09-01`, to: `${next}-01-29`, proposedDeadline: `${start}-12-12`, classificationMeeting: `${next}-01-26`, classificationDeadline: `${next}-01-26`, locked: false },
      { id: 2, name: 'Semestr 2', from: `${next}-02-15`, to: `${next}-06-25`, proposedDeadline: `${next}-05-14`, classificationMeeting: `${next}-06-18`, classificationDeadline: `${next}-06-18`, locked: false }],
    winterBreak, holidays,
    daysOff: statutoryDaysOff(start, [winterBreak].concat(holidays))
  };
}
/** Klucze konfiguracji, które w zasiewie demonstracyjnym dokładają seedy 13/15/17/60 — tu z sensownymi
    wartościami domyślnymi dla szkoły, która dopiero powstaje. `yr` = wynik `schoolYearFor`. */
function blankExtras(yr) {
  const yearEnd = yr.semesters[yr.semesters.length - 1].to;
  return {
    /* 15-registry.js */
    sio: { schemaVersion: '1.0', reportDate: `${yr.start}-09-30`, namespace: 'https://sio.men.gov.pl/schemat/1.0' },
    auditImmutable: true,
    ipAllowlistExample: ['193.219.28.14', '10.12.0.0/24', '83.16.204.7'],
    ipAllowlistNote: 'Lista jest pusta — logowania administracyjne nie są ograniczone adresem. Wzorzec wpisów: config.ipAllowlistExample.',
    logRetentionMinYears: 5,
    gradesArchiveRetentionMinYears: 50,
    /* R5 — klasy dokumentacji (JRWA). Ta sama tabela, którą wkłada zasiew demonstracyjny, żeby
       `PATCH /api/admin/retention` i raport retencji działały w szkole z kreatora od pierwszego dnia.
       Wymagane leniwie: server/routes/retention.js wymaga tego pliku (schoolYearFor). */
    retention: require('../routes/retention').DEFAULT_RETENTION(),
    /* 13-principal.js */
    payroll: { currency: 'PLN', legalBasis: 'Karta Nauczyciela art. 35 ust. 2a i 3 – godziny ponadwymiarowe i godziny doraźnych zastępstw',
      defaultPensum: 18, defaultLevel: 'mianowany', pensum: {}, levels: {},
      overtimeRate: { teacher: { poczatkujacy: 42.5, mianowany: 52.8, dyplomowany: 64.9 }, principal: { poczatkujacy: 48, mianowany: 58.4, dyplomowany: 71.4 }, supportTeacher: { poczatkujacy: 38.2, mianowany: 46.1, dyplomowany: 55.3 } },
      adHocFactor: 1, combinedPay: 1, maxOvertimePerWeek: 9, settlementDay: 5, exportFormats: ['csv', 'xml'] },
    archiveWindow: { from: yearEnd, yearEnd: `${yr.start + 1}-08-31`, to: shift(`${yr.start + 1}-08-31`, 10), days: 10, basis: 'Rozporządzenie MEN o dokumentacji przebiegu nauczania – pakiet archiwalny w ciągu 10 dni od zakończenia roku szkolnego (31 sierpnia).' },
    /* 17-parent-modules.js */
    parentCouncilFee: 50, cafeteriaOverdueDays: 14, consultationSlotMinutes: 20, tripConsentMethod: 'app-auth', careOpenUntil: '17:00',
    /* 60-student.js */
    termGradeThresholds: { 2: 1.75, 3: 2.51, 4: 3.51, 5: 4.51, 6: 5.51 },
    libraryNoticeDaysBeforeSemesterEnd: 60,
    studentShortcuts: true,
    /* 00-base.js — klucz dopisany przy R3, a kreator go nie miał */
    adultAccess: 'until-objection'
  };
}
function blankSeed(db) {
  const keys = C.generateKeyPair(); const now = today(); const yr = schoolYearFor(now);
  db.data.config = {
    school: { name: '', short: '', address: '', regon: '', rspo: '', email: '', phone: '', director: '' },
    year: yr.label, today: null, timezone: 'Europe/Warsaw', semesters: yr.semesters, winterBreak: yr.winterBreak, holidays: yr.holidays, daysOff: yr.daysOff,
    lessonTimes: [{ no: 1, start: '08:00', end: '08:45' }, { no: 2, start: '08:55', end: '09:40' }, { no: 3, start: '09:50', end: '10:35' }, { no: 4, start: '10:45', end: '11:30' }, { no: 5, start: '11:45', end: '12:30' }, { no: 6, start: '12:45', end: '13:30' }, { no: 7, start: '13:40', end: '14:25' }, { no: 8, start: '14:35', end: '15:20' }],
    plusMinus: { plus: 0.5, minus: -0.25 }, percentScale: [{ min: 96, grade: 6 }, { min: 90, grade: 5 }, { min: 75, grade: 4 }, { min: 50, grade: 3 }, { min: 30, grade: 2 }, { min: 0, grade: 1 }],
    testLimits: { perDay: 1, perWeek: 3 }, retakeRule: 'higher', honorsAverage: 4.75, honorsBehavior: ['wzorowe', 'bardzo dobre'], behaviorScale: ['wzorowe', 'bardzo dobre', 'dobre', 'poprawne', 'nieodpowiednie', 'naganne'],
    behaviorPoints: { start: 100, thresholds: [{ min: 180, grade: 'wzorowe' }, { min: 140, grade: 'bardzo dobre' }, { min: 100, grade: 'dobre' }, { min: 60, grade: 'poprawne' }, { min: 20, grade: 'nieodpowiednie' }, { min: -999, grade: 'naganne' }] },
    unexcusedThresholdPercent: 50, warningDaysBeforeClassification: 30, sessionTimeoutMin: 15, sessionWarnBeforeMin: 2, logRetentionYears: 5, gradesArchiveRetentionYears: 50,
    ipAllowlist: [], require2FAForGradeEditors: true, visibility: { classAverage: true, rankings: false, averagesToParents: true }, messaging: { parentsCanMessage: 'homeroomAndSubject' },
    mealPrice: 0, lunchCancelCutoff: '08:00', quietHoursDefault: { from: '21:00', to: '06:30' }, homeworkMaxAttachmentMB: 10, adultSelfExcuseAllowed: true, testNoticeDays: 7,
    schoolPublicKey: keys.publicKey, schoolPrivateKey: keys.privateKey, anonymized: false, modules: { enabled: {} },
    video: { provider: 'jitsi', jitsi: { domain: '', appId: '', appSecret: '' }, bbb: { url: '', secret: '' } },
    setup: { done: false, startedAt: null, steps: {} }
  };
  /* OPS3-01/OPS3-13 — parytet kluczy konfiguracji. Klucze, których nie ma w `00-base.js`, tylko
     w seedach demonstracyjnych (13-principal, 15-registry, 17-parent-modules, 60-student), nie
     powstawały w szkole z kreatora w ogóle: `POST /api/registry/sio/validate` kończył się wtedy
     `500 TypeError … reading 'schemaVersion'`, a nie komunikatem. Domyślne wartości są takie same
     jak w zasiewie demonstracyjnym, ale bez jego danych (payroll bez pensum i stopni konkretnych
     nauczycieli, okno archiwum policzone z tego roku szkolnego). Test parytetu:
     tests/60-onboarding.test.js. */
  Object.assign(db.data.config, blankExtras(yr));
  db.data.subjects = [{ id: 'mat', name: 'Matematyka' }, { id: 'pol', name: 'Język polski' }, { id: 'ang', name: 'Język angielski' }, { id: 'niem', name: 'Język niemiecki' }, { id: 'fiz', name: 'Fizyka' }, { id: 'his', name: 'Historia' }, { id: 'bio', name: 'Biologia' }, { id: 'che', name: 'Chemia' }, { id: 'geo', name: 'Geografia' }, { id: 'inf', name: 'Informatyka' }, { id: 'wf', name: 'Wychowanie fizyczne' }, { id: 'muz', name: 'Muzyka' }, { id: 'pla', name: 'Plastyka' }, { id: 'tech', name: 'Technika' }, { id: 'edw', name: 'Edukacja wczesnoszkolna' }, { id: 'wos', name: 'Wiedza o społeczeństwie' }, { id: 'edb', name: 'Edukacja dla bezpieczeństwa' }, { id: 'rel', name: 'Religia / etyka' },
    /* OPS3-04 — trzy przedmioty, na których zatrzymywał się każdy prawdziwy plan i każdy arkusz
       organizacyjny: godzina z wychowawcą (ustawowa), etyka i wychowanie do życia w rodzinie.
       Czego nie ma na liście, szkoła dopisuje sama (POST /api/admin/subjects). */
    { id: 'gw', name: 'Godzina z wychowawcą' }, { id: 'etyka', name: 'Etyka' }, { id: 'wdz', name: 'Wychowanie do życia w rodzinie' }];
  db.data.gradeCategories = [
    { id: 'cat_spr', name: 'sprawdzian', weight: 3, color: 'cat-1', countsInAverage: true, subjectId: null }, { id: 'cat_kart', name: 'kartkówka', weight: 2, color: 'cat-2', countsInAverage: true, subjectId: null },
    { id: 'cat_zd', name: 'zadanie domowe', weight: 1, color: 'cat-3', countsInAverage: true, subjectId: null }, { id: 'cat_akt', name: 'aktywność', weight: 1, color: 'cat-4', countsInAverage: false, subjectId: null },
    { id: 'cat_proj', name: 'projekt', weight: 4, color: 'cat-5', countsInAverage: true, subjectId: null }, { id: 'cat_odp', name: 'odpowiedź ustna', weight: 2, color: 'cat-6', countsInAverage: true, subjectId: null }];
  db.data.developmentAreas = ['Edukacja polonistyczna', 'Edukacja matematyczna', 'Edukacja społeczna', 'Edukacja przyrodnicza', 'Edukacja artystyczna', 'Wychowanie fizyczne', 'Zachowanie'];
  db.data.phraseBank = []; db.data.curriculum = [];
  for (const c of ['users', 'classes', 'students', 'groups', 'timetable', 'lessons', 'sessions', 'audit', 'attendance', 'grades', 'notifications', 'messages', 'registrationCodes']) db.col(c);
  db.data.meta = { seededAt: new Date().toISOString(), seeds: ['blank'] };
}
module.exports = { blankSeed, schoolYearFor, statutoryDaysOff, easter };
