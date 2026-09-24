'use strict';
/* Seed 3.7 (rodzic) i 3.8 (moduły szkolne): konta stołówkowe, opłaty, zebrania i konsultacje,
   upoważnienia do odbioru ze świetlicy, komplet podręczników i wypożyczenia, wizyta w gabinecie,
   karta wycieczki w wersji roboczej oraz kody kreskowe legitymacji uczniów.
   Wszystkie identyfikatory mają przedrostek `pm_`, żeby nie kolidowały z innymi sekcjami. */
const { addDays } = require('../lib/util');

function seed(db) {
  const cfg = db.data.config;
  const TODAY = cfg.today;

  /* --- reguły szkolne używane przez widok rodzica i moduły --- */
  cfg.parentCouncilFee = 50;                     // składka na radę rodziców (zł / rok)
  cfg.cafeteriaOverdueDays = 14;                 // po ilu dniach zaległość blokuje wydawanie
  cfg.consultationSlotMinutes = 20;              // długość jednego terminu konsultacji
  cfg.tripConsentMethod = 'app-auth';            // zgoda na wycieczkę podpisywana hasłem do konta
  cfg.careOpenUntil = '17:00';                   // świetlica czynna do
  if (cfg.visibility.classAverage === undefined) cfg.visibility.classAverage = true;

  /* --- dane kontaktowe opiekunów (rozdzielone konta rodziców po rozwodzie) ------------------ */
  const contact = (id, phone, email, address) => { const u = db.get('users', id); if (u) { u.phone = phone; u.email = email; u.address = address; } };
  contact('u_p_kowalczyk', '601 111 222', 'marta.kowalczyk@example.org', 'ul. Lipowa 8/3, 31-021 Kraków');
  contact('u_p_kowalczyk2', '602 333 444', 'tomasz.kowalczyk@example.org', 'ul. Wrzosowa 15, 31-115 Kraków');
  contact('u_p_nowak', '603 555 666', 'k.nowak@example.org', 'ul. Polna 2, 31-030 Kraków');
  contact('u_p_lewandowski', '604 777 888', 'm.lewandowska@example.org', 'ul. Słoneczna 11, 31-044 Kraków');
  contact('u_p_zielinski', '605 999 000', 'a.zielinska@example.org', 'ul. Cicha 4, 31-052 Kraków');
  contact('u_p_adamczyk', '606 121 212', 'k.adamczyk@example.org', 'ul. Długa 90, 31-146 Kraków');
  const marta = db.get('users', 'u_p_kowalczyk'); if (marta) marta.custodyNote = 'pełnia władzy rodzicielskiej; korespondencja rozdzielona';

  /* --- kody kreskowe legitymacji (3.8.1) — tylko jeśli 3.5 nie wydała legitymacji cyfrowej -- */
  db.col('studentIds');
  for (const s of db.data.students) {
    if (s.barcode) continue;
    const no = s.rollNo || s.registerNo || 0;
    s.barcode = String(s.classId || 'XX').toUpperCase() + '-' + String(no).padStart(3, '0');
  }

  /* --- konta stołówkowe (3.8.3, 3.8.4, 3.7.10) --------------------------------------------- */
  const accounts = db.col('cafeteriaAccounts');
  const account = (studentId, balance, opts) => {
    const o = opts || {}; const s = db.get('students', studentId); if (!s) return null;
    if (accounts.some((a) => a.studentId === studentId)) return null;
    const row = {
      id: 'pm_caf_' + studentId, studentId, classId: s.classId, parentUserIds: (s.parentIds || []).slice(),
      mealPlan: o.mealPlan === undefined ? 'obiad' : o.mealPlan, active: o.active !== false,
      mealPrice: cfg.mealPrice, balance, currency: 'PLN', period: o.period || 'październik 2026',
      overdueSince: balance < 0 ? (o.overdueSince || '2026-09-30') : null,
      blocked: false, blockedAt: null, blockedByUserId: null, blockReason: null,
      entries: (o.entries || []).slice(), createdAt: '2026-09-01T07:00:00.000Z'
    };
    accounts.push(row); return row;
  };
  const CAF_7B = ['st_adamczyk_maja', 'st_dbrowski_micha', 'st_kowalczyk_anna', 'st_lewandowski_piotr', 'st_dbrowska_emilia', 'st_nowak_jan', 'st_szymaska_karolina', 'st_winiewska_zofia', 'st_szymaski_tomasz', 'st_zieliski_kacper', 'st_kaczmarek_oliwia', 'st_woniak_filip'];
  for (const sid of CAF_7B) account(sid, 0);
  for (const sid of ['st_kowalczyk_piotr', 'st_kowalczyk_pola', 'st_sowa_franciszek', 'st_wrona_zuzanna']) account(sid, 0);
  for (const sid of ['st_adamczyk_leon', 'st_bednarek_alicja']) account(sid, 0);
  // jedno konto z zaległością (blokada wydawania + dyskretne powiadomienie rodzica — 3.8.4)
  const kacper = accounts.find((a) => a.studentId === 'st_zieliski_kacper');
  if (kacper) {
    kacper.balance = -168;
    kacper.overdueSince = '2026-09-15';
    kacper.period = 'wrzesień–październik 2026';
    kacper.entries = [
      { id: 'pm_cafe_k1', date: '2026-09-01', kind: 'charge', amount: -84, note: 'Obiady wrzesień', month: '2026-09' },
      { id: 'pm_cafe_k2', date: '2026-10-01', kind: 'charge', amount: -84, note: 'Obiady październik', month: '2026-10' }
    ];
  }
  const maja = accounts.find((a) => a.studentId === 'st_adamczyk_maja');
  if (maja) {
    maja.balance = -84;
    maja.overdueSince = '2026-09-30';
    maja.entries = [{ id: 'pm_cafe_m1', date: '2026-10-01', kind: 'charge', amount: -84, note: 'Obiady październik', month: '2026-10' }];
  }
  const anna = accounts.find((a) => a.studentId === 'st_kowalczyk_anna');
  if (anna) anna.entries = [{ id: 'pm_cafe_a1', date: '2026-10-01', kind: 'charge', amount: -84, note: 'Obiady październik', month: '2026-10' }, { id: 'pm_cafe_a2', date: '2026-10-02', kind: 'payment', amount: 84, note: 'Wpłata rodzica', month: '2026-10' }];
  db.col('cafeteriaCancellations');

  /* --- opłaty do zapłaty z natychmiastowym potwierdzeniem (3.7.9) --------------------------- */
  const payments = db.col('payments');
  const payment = (id, studentId, parentUserId, kind, title, amount, dueDate) => {
    if (payments.some((p) => p.id === id)) return;
    payments.push({
      id, studentId, parentUserId, kind, title, amount, currency: 'PLN', dueDate,
      status: 'due', paidAt: null, receiptNo: null, method: null, createdAt: '2026-10-01T06:00:00.000Z'
    });
  };
  payment('pm_pay_anna_obiady', 'st_kowalczyk_anna', 'u_p_kowalczyk', 'lunch', 'Obiady listopad 2026 · Anna Kowalczyk', 84, '2026-10-31');
  payment('pm_pay_anna_rada', 'st_kowalczyk_anna', 'u_p_kowalczyk', 'council', 'Rada Rodziców 2026/2027 · Anna Kowalczyk', 50, '2026-11-30');
  payment('pm_pay_piotr_obiady', 'st_kowalczyk_piotr', 'u_p_kowalczyk', 'lunch', 'Obiady listopad 2026 · Piotr Kowalczyk', 84, '2026-10-31');
  payment('pm_pay_jan_rada', 'st_nowak_jan', 'u_p_nowak', 'council', 'Rada Rodziców 2026/2027 · Jan Nowak', 50, '2026-11-30');
  db.col('receipts');

  /* --- zebrania, dni otwarte i terminy konsultacji (3.7.8) --------------------------------- */
  const meetings = db.col('meetings');
  const meeting = (m) => { if (!meetings.some((x) => x.id === m.id)) meetings.push(Object.assign({ audience: ['parent'], note: '', createdAt: '2026-10-05T08:00:00.000Z' }, m)); };
  meeting({ id: 'pm_meet_7b', kind: 'meeting', title: 'Zebranie z wychowawcą klasy 7b', date: '2026-11-05', start: '17:00', end: '18:00', classId: '7b', room: '12', teacherId: 'u_nowak', note: 'Wyniki po pierwszym okresie, wycieczka listopadowa, sprawy organizacyjne.' });
  meeting({ id: 'pm_meet_3a', kind: 'meeting', title: 'Zebranie z wychowawcą klasy 3a', date: '2026-11-05', start: '17:00', end: '18:00', classId: '3a', room: '4', teacherId: 'u_mazur', note: 'Ocena opisowa, świetlica, obiady.' });
  meeting({ id: 'pm_meet_open', kind: 'openDay', title: 'Dzień otwarty — konsultacje z nauczycielami przedmiotów', date: '2026-11-05', start: '18:00', end: '19:30', classId: null, room: 'sale przedmiotowe', teacherId: null, note: 'Konsultacje po 20 minut; termin rezerwuje się w dzienniku.' });

  const slots = db.col('consultationSlots');
  const slot = (id, teacherId, subjectId, start, end, extra) => {
    if (slots.some((x) => x.id === id)) return;
    slots.push(Object.assign({
      id, meetingId: 'pm_meet_open', teacherId, subjectId, date: '2026-11-05', start, end,
      durationMin: cfg.consultationSlotMinutes, room: null,
      bookedByUserId: null, bookedForStudentId: null, bookedAt: null, createdAt: '2026-10-05T08:05:00.000Z'
    }, extra || {}));
  };
  slot('pm_slot_1', 'u_nowak', 'mat', '18:00', '18:20', { room: '12' });
  slot('pm_slot_2', 'u_nowak', 'mat', '18:20', '18:40', { room: '12' });
  slot('pm_slot_3', 'u_nowak', 'mat', '18:40', '19:00', { room: '12' });
  slot('pm_slot_4', 'u_wojcik', 'fiz', '18:00', '18:20', { room: '24' });
  slot('pm_slot_5', 'u_wojcik', 'fiz', '18:20', '18:40', { room: '24' });
  slot('pm_slot_6', 'u_krol', 'ang', '18:00', '18:20', { room: '15' });
  slot('pm_slot_7', 'u_mazur', 'wf', '18:00', '18:20', { room: 'sala gim.' });
  slot('pm_slot_8', 'u_mazur', 'wf', '18:20', '18:40', { room: 'sala gim.' });

  /* --- świetlica: upoważnienia do odbioru (3.8.2) ------------------------------------------ */
  const pickups = db.col('careAuthorizedPickups');
  const pickup = (id, studentId, name, relation, extra) => {
    if (pickups.some((x) => x.id === id)) return;
    pickups.push(Object.assign({
      id, studentId, name, relation, idNote: 'dowód osobisty okazany w sekretariacie',
      validFrom: '2026-09-01', validTo: null, addedByUserId: 'u_sekretariat', revoked: false, at: '2026-09-01T07:30:00.000Z'
    }, extra || {}));
  };
  pickup('pm_pick_anna_matka', 'st_kowalczyk_anna', 'Marta Kowalczyk', 'matka', { userId: 'u_p_kowalczyk' });
  pickup('pm_pick_anna_ojciec', 'st_kowalczyk_anna', 'Tomasz Kowalczyk', 'ojciec', { userId: 'u_p_kowalczyk2' });
  pickup('pm_pick_piotr_matka', 'st_kowalczyk_piotr', 'Marta Kowalczyk', 'matka', { userId: 'u_p_kowalczyk' });
  pickup('pm_pick_piotr_babcia', 'st_kowalczyk_piotr', 'Halina Kowalczyk', 'babcia', {});
  pickup('pm_pick_jan_dziadek', 'st_nowak_jan', 'Jan Nowak (senior)', 'dziadek', {});
  pickup('pm_pick_maja_sasiad', 'st_adamczyk_maja', 'Piotr Lewandowski', 'sąsiad', { validTo: '2026-11-30' });
  db.col('careCheckins'); db.col('carePickups');

  /* --- biblioteka: komplety podręczników i wypożyczenia (3.8.8, 3.8.9) --------------------- */
  const items = db.col('libraryItems');
  const item = (barcode, title, author, subjectId, level, setName) => {
    const id = 'pm_li_' + barcode;
    if (items.some((x) => x.id === id)) return;
    items.push({ id, barcode, title, author, kind: 'textbook', subjectId, level, setName, status: 'available', studentId: null, addedAt: '2026-08-28T09:00:00.000Z' });
  };
  item('9788301234567', 'Matematyka 7 · podręcznik', 'M. Braun', 'mat', 7, 'Komplet klasy 7');
  item('9788301234574', 'Matematyka 7 · zbiór zadań', 'M. Braun', 'mat', 7, 'Komplet klasy 7');
  item('9788301234581', 'Fizyka 7 · podręcznik', 'G. Francuz-Ornat', 'fiz', 7, 'Komplet klasy 7');
  item('9788301234598', 'Język polski 7 · podręcznik', 'A. Klimowicz', 'pol', 7, 'Komplet klasy 7');
  item('9788301234604', 'Historia 7 · podręcznik', 'S. Roszak', 'his', 7, 'Komplet klasy 7');
  item('9788301234611', 'Edukacja wczesnoszkolna 3 · podręcznik', 'J. Faliszewska', 'edw', 3, 'Komplet klasy 3');

  const loans = db.col('libraryLoans');
  const loan = (id, studentId, title, author, barcode, loanedAt, dueDate, extra) => {
    if (loans.some((l) => l.id === id)) return;
    loans.push(Object.assign({ id, studentId, title, author, barcode, itemId: null, loanedAt, dueDate, returnedAt: null, extendedCount: 0, byUserId: 'u_biblioteka', createdAt: loanedAt + 'T09:00:00.000Z' }, extra || {}));
  };
  // Anna ma wypożyczenie z terminem przed końcem semestru (29.01.2027)
  loan('pm_loan_anna_mat', 'st_kowalczyk_anna', 'Matematyka 7 · podręcznik', 'M. Braun', '9788301234567', '2026-09-04', '2026-12-18');
  loan('pm_loan_kacper_mat', 'st_zieliski_kacper', 'Matematyka 7 · podręcznik', 'M. Braun', '9788301234567', '2026-09-04', '2026-12-18');
  loan('pm_loan_kacper_fiz', 'st_zieliski_kacper', 'Fizyka 7 · podręcznik', 'G. Francuz-Ornat', '9788301234581', '2026-09-04', '2026-12-18');
  loan('pm_loan_jan_zwrot', 'st_nowak_jan', 'Język polski 7 · podręcznik', 'A. Klimowicz', '9788301234598', '2026-09-04', '2026-12-18', { returnedAt: '2026-10-20T10:15:00.000Z' });

  /* --- gabinet profilaktyki: wizyta pierwszej pomocy (3.8.10) ------------------------------ */
  const visits = db.col('nurseVisits');
  if (!visits.some((v) => v.id === 'pm_visit_jan')) {
    visits.push({
      id: 'pm_visit_jan', no: 'GAB/2026/117', studentId: 'st_nowak_jan', classId: '7b',
      date: '2026-10-22', time: '09:40', kind: 'zle', kindLabel: 'Złe samopoczucie',
      description: 'Ból głowy po lekcji wychowania fizycznego.',
      aid: 'Odpoczynek 20 minut, pomiar temperatury 36,8 °C, powrót na lekcję.',
      outcome: 'return', byUserId: 'u_pielegniarka', parentNotified: true, parentNotifiedAt: '2026-10-22T09:55:00.000Z',
      at: '2026-10-22T09:42:00.000Z', createdAt: '2026-10-22T09:42:00.000Z'
    });
  }
  db.col('nurseVisitAccessLog');

  /* --- karta wycieczki w wersji roboczej (3.8.5) ------------------------------------------- */
  const trips = db.col('trips');
  if (!trips.some((t) => t.id === 'pm_trip_wieliczka')) {
    trips.push({
      id: 'pm_trip_wieliczka', name: 'Wycieczka klasy 7b — Kopalnia Soli w Wieliczce',
      from: '2026-11-05', to: '2026-11-06', leaderId: 'u_mazur', classIds: ['7b'],
      studentIds: ['st_kowalczyk_anna', 'st_nowak_jan', 'st_lewandowski_piotr', 'st_winiewska_zofia', 'st_szymaski_tomasz', 'st_kaczmarek_oliwia', 'st_woniak_filip', 'st_dbrowska_emilia', 'st_dbrowski_micha', 'st_szymaska_karolina'],
      chaperones: [{ userId: 'u_mazur', groupNo: 1 }, { userId: 'u_wojcik', groupNo: 2 }],
      insurance: { insurer: 'PZU SA', policyNo: 'POL/2026/114/901', validFrom: '2026-11-05', validTo: '2026-11-06' },
      transport: 'Autokar · przewoźnik Trans-Bus', cost: 65, costDue: '2026-10-30',
      schedule: [
        { day: '2026-11-05', text: 'Wyjazd 7:30 spod szkoły, zwiedzanie trasy turystycznej, obiad, zakwaterowanie' },
        { day: '2026-11-06', text: 'Muzeum Żup Krakowskich, warsztaty, powrót o 17:30' }],
      status: 'draft', consents: {}, nonParticipants: {}, createdAt: '2026-10-20T11:00:00.000Z'
    });
  }

  /* --- formalne zawiadomienie o zagrożeniu oceną niedostateczną (3.7.14) -------------------- */
  const msgs = db.col('messages');
  if (!msgs.some((m) => m.id === 'pm_msg_warning_anna')) {
    const meetingDate = (cfg.semesters[0] || {}).classificationMeeting || '2027-01-26';
    msgs.push({
      id: 'pm_msg_warning_anna', fromUserId: 'u_nowak', toUserIds: ['u_p_kowalczyk', 'u_p_kowalczyk2'],
      subject: 'Zawiadomienie o zagrożeniu oceną niedostateczną — fizyka, Anna Kowalczyk',
      body: `Informuję, że na ${cfg.warningDaysBeforeClassification || 30} dni przed klasyfikacją (posiedzenie rady pedagogicznej ${meetingDate}) uczennica Anna Kowalczyk jest zagrożona oceną niedostateczną z fizyki. Proszę o potwierdzenie odbioru zawiadomienia w dzienniku.`,
      at: '2026-10-22T10:30:00.000Z', kind: 'warning', confidential: false, requiresAck: true,
      readBy: {}, deliveredTo: ['u_p_kowalczyk', 'u_p_kowalczyk2'],
      deliveredAt: { u_p_kowalczyk: '2026-10-22T10:30:00.000Z', u_p_kowalczyk2: '2026-10-22T10:30:00.000Z' },
      ackBy: {}, attachments: [], threadId: 'pm_msg_warning_anna',
      classId: '7b', studentId: 'st_kowalczyk_anna', subjectId: 'fiz', semester: 1,
      classificationMeeting: meetingDate, createdAt: '2026-10-22T10:30:00.000Z'
    });
  }

  /* --- zaległe wpisy frekwencji: nieobecność na 1. lekcji dnia (3.7.2) --------------------- */
  // Nic nie dopisujemy „na siłę”: alert powstaje z realnych wpisów 3.1; tu zostawiamy tylko kolekcje.
  ['notifications', 'excuses', 'trips', 'payments', 'meetings', 'consultationSlots', 'cafeteriaAccounts', 'careCheckins', 'carePickups', 'careAuthorizedPickups', 'libraryItems', 'libraryLoans', 'nurseVisits'].forEach((c) => db.col(c));
  void TODAY; void addDays;
}
module.exports = { seed };
