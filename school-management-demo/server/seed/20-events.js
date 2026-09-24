'use strict';
/* Moduł „events” (3.10) — wydarzenia szkolne od strony organizatora. Zasiew stawia dwa wydarzenia:

   1. „Dzień otwarty” 5.11.2026 — przyszły, w trakcie przygotowań. Wisi przy zebraniu `pm_meet_open`
      z 3.7, więc rodzic widzi je w swoim kalendarzu, a organizator prowadzi tu całą resztę: plan
      sal, grafik dyżurów uczniów-wolontariuszy, instruktaże w warstwach i rejestr ryzyka.
      Jedno ryzyko zostaje celowo w paśmie nieakceptowalnym (ocena 16), żeby było widać, że
      zatwierdzenie jest zablokowane, dopóki ktoś się nim nie zajmie.
   2. „Festyn rodzinny” 12.09.2026 — przeszły i zamknięty, po terminie retencji (30 dni), więc
      widać na nim, co robi usunięcie danych ulotnych.

   Wszyscy uczniowie tej szkoły podstawowej mają poniżej 16 lat, więc reguły ochronne (dobowy limit,
   cisza nocna, przerwa, dorosły na dyżurze, zgoda opiekuna) są tu ścieżką zwykłą, nie wyjątkiem. */

const OPEN_DAY = '2026-11-05';        // ten sam dzień co zebranie pm_meet_open z 3.7
const FETE = '2026-09-12';            // przeszły festyn — poza 30-dniowym oknem retencji

function seed(db, ctx) {
  const cfg = db.data.config;

  /* --- progi modułu (czyta je server/routes/events.js przez evCfg) ------------------------- */
  cfg.events = Object.assign({
    minorUnderAge: 16,
    minorMaxHoursPerDay: 7,
    minorCurfewFrom: '22:00',
    minorCurfewTo: '06:00',
    minShiftGapMin: 15,
    shiftDropCutoffHours: 4,
    accessibilityBufferPct: 12,
    riskAcceptMax: 12,
    scanCollisionWindowMin: 5,
    retentionDays: 30,
    note: 'Progi ochrony małoletnich wolontariuszy ustala szkoła w regulaminie wolontariatu; wartości domyślne są ostrożne, nie są cytatem z przepisu.'
  }, cfg.events || {});
  /* Klasa retencyjna `wydarzenia-dane-ulotne` czyta ten klucz (configDays). */
  if (cfg.eventDataRetentionDays == null) cfg.eventDataRetentionDays = 30;

  const events = db.col('schoolEvents');
  const shifts = db.col('eventShifts');
  const briefings = db.col('eventBriefings');
  const acks = db.col('eventBriefingAcks');
  const consents = db.col('eventConsents');
  const risks = db.col('eventRisks');
  const passes = db.col('eventPasses');
  db.col('eventScans');
  db.col('eventDietary');

  const has = (col, id) => col.some((x) => x.id === id);
  const at = (d, t) => `${d}T${t}:00.000Z`;

  /* ================================================================= 1. dzień otwarty */
  if (!has(events, 'ev_open_2026')) {
    events.push({
      id: 'ev_open_2026', name: 'Dzień otwarty szkoły 2026', kind: 'openDay',
      date: OPEN_DAY, start: '16:00', end: '19:30',
      leaderId: 'u_nowak', meetingId: db.get('meetings', 'pm_meet_open') ? 'pm_meet_open' : null,
      objective: 'Pokazać rodzicom przyszłych pierwszoklasistów, jak wygląda dzień w naszej szkole, i odpowiedzieć na pytania o zapisy.',
      outcome: 'Rodzic wychodzi, wiedząc, jak wygląda plan dnia, kto uczy jego dziecko i jak zapisać je do klasy pierwszej.',
      measure: 'Co najmniej 60 wypełnionych kart zgłoszeniowych oraz komplet obsadzonych dyżurów przy stanowiskach.',
      redLines: [
        'Żadne stanowisko nie zbiera numerów PESEL ani danych kontaktowych „na kartce” — zapisy idą wyłącznie przez sekretariat.',
        'Uczniowie wolontariusze nie zostają sami w sali z osobą spoza szkoły.',
        'Sale lekcyjne są otwarte wyłącznie w obecności nauczyciela.'
      ],
      audience: ['parent', 'public'], expectedVisitors: 180,
      rooms: [
        { roomId: 'aula', name: 'Aula', layout: 'theatre', areaM2: 180, bufferPct: null, fireCapacity: 200, expected: 150, note: 'Prezentacja otwierająca o 16:15 i 17:30.' },
        { roomId: 's12', name: 'Sala 12 — matematyka', layout: 'classroom', areaM2: 52, bufferPct: null, fireCapacity: 32, expected: 24, note: 'Pokaz zadań i gier logicznych.' },
        { roomId: 'swietlica', name: 'Świetlica', layout: 'standing', areaM2: 90, bufferPct: 15, fireCapacity: 120, expected: 80, note: 'Kącik dla dzieci i poczęstunek.' },
        { roomId: 'hol', name: 'Hol główny — rejestracja', layout: 'standing', areaM2: 120, bufferPct: 20, fireCapacity: 200, expected: 180, note: 'Dwa stanowiska wejściowe, żeby kolejka nie sięgała na zewnątrz.' }
      ],
      status: 'draft', createdAt: at('2026-10-05', '09:00'), approvedBy: null, approvedAt: null, purgedAt: null
    });
  }

  /* --- instruktaże w warstwach ------------------------------------------------------------- */
  const brief = (id, title, tier, body, extra) => {
    if (has(briefings, id)) return;
    briefings.push(Object.assign({
      id, eventId: 'ev_open_2026', title, tier, body, requiresAck: true, version: 1,
      at: at('2026-10-08', '10:00'), byUserId: 'u_nowak'
    }, extra || {}));
  };
  brief('ev_brief_program', 'Program dnia otwartego', 'public',
    'Godz. 16:00 — otwarcie i rejestracja w holu. 16:15 i 17:30 — prezentacja w auli. 16:45–19:00 — sale przedmiotowe i świetlica. 19:30 — zakończenie.',
    { requiresAck: false });
  brief('ev_brief_parents', 'Informacje dla rodziców kandydatów', 'participant',
    'Zapisy do klas pierwszych prowadzi sekretariat (pokój 3) w godzinach 8:00–15:00. Na dniu otwartym odbieramy wyłącznie wypełnione karty zgłoszeniowe — nie zbieramy numerów PESEL przy stanowiskach.',
    { requiresAck: false });
  brief('ev_brief_crew', 'Instruktaż dla obsługi i wolontariuszy', 'staff',
    'Zasady bezpieczeństwa: nie zostawiamy stanowiska bez obsady; osoba dorosła jest zawsze na tym samym stanowisku co wolontariusz; gości nie prowadzimy samodzielnie do sal lekcyjnych. Droga ewakuacyjna z auli prowadzi wyjściem wschodnim — nie zastawiamy go sprzętem. W razie zdarzenia medycznego: gabinet profilaktyki, parter, obok sekretariatu. Skaner wejściówek działa także bez sieci — skanuj dalej, wyniki rozliczą się same.',
    { requiresAck: true });
  brief('ev_brief_organizers', 'Notatka organizacyjna — kosztorys i kontakty awaryjne', 'organizer',
    'Kontakt do firmy cateringowej i do konserwatora: w sekretariacie. Limit wydatków na poczęstunek uzgodniony z radą rodziców. Klucz do wyjścia wschodniego ma woźny i kierownik wydarzenia.',
    { requiresAck: false });

  /* Nauczyciel prowadzący ma instruktaż obsługi już potwierdzony — reszta dopiero go przeczyta. */
  if (!has(acks, 'ev_ack_nowak')) {
    acks.push({ id: 'ev_ack_nowak', briefingId: 'ev_brief_crew', eventId: 'ev_open_2026', userId: 'u_nowak', studentId: null, version: 1, at: at('2026-10-08', '11:00') });
  }

  /* --- dyżury na stanowiskach --------------------------------------------------------------- */
  const shift = (id, station, start, end, needed, assignees, extra) => {
    if (has(shifts, id)) return;
    shifts.push(Object.assign({
      id, eventId: 'ev_open_2026', station, date: OPEN_DAY, start, end,
      needed, adultRequired: true, assignees: assignees || [], note: '', createdAt: at('2026-10-08', '12:00')
    }, extra || {}));
  };
  const staffOn = (userId) => ({ kind: 'staff', userId, studentId: null, status: 'confirmed', pendingReason: null, minor: false, at: at('2026-10-08', '12:05'), byUserId: 'u_nowak' });
  const pupilOn = (studentId, status) => ({ kind: 'student', userId: null, studentId, status: status || 'confirmed', pendingReason: status === 'pending' ? 'no_adult' : null, minor: true, at: at('2026-10-09', '08:00'), byUserId: 'u_nowak' });

  shift('ev_sh_hol_1', 'Wejście główne — rejestracja', '15:45', '17:45', 3, [staffOn('u_wojcik'), pupilOn('st_kowalczyk_anna')]);
  shift('ev_sh_hol_2', 'Wejście główne — rejestracja', '17:45', '19:30', 3, [staffOn('u_mazur')]);
  shift('ev_sh_aula', 'Aula — obsługa prezentacji', '16:00', '19:00', 2, [staffOn('u_nowak')]);
  /* Dyżur bez dorosłego: zapis wolontariuszki czeka („oczekuje”), dopóki ktoś dorosły nie dołączy. */
  shift('ev_sh_swietlica', 'Świetlica — kącik dla dzieci', '16:00', '18:00', 2, [pupilOn('st_nowak_jan', 'pending')]);
  shift('ev_sh_szatnia', 'Szatnia', '15:45', '19:30', 2, []);

  /* --- zgody opiekunów na wolontariat -------------------------------------------------------- */
  const consent = (id, studentId, byUserId, ts) => {
    if (has(consents, id)) return;
    consents.push({ id, eventId: 'ev_open_2026', studentId, scope: 'volunteer', byUserId, by: '', at: ts, note: 'Zgoda złożona w dzienniku.' });
  };
  consent('ev_con_anna', 'st_kowalczyk_anna', 'u_p_kowalczyk', at('2026-10-09', '07:30'));
  consent('ev_con_jan', 'st_nowak_jan', 'u_p_nowak', at('2026-10-09', '07:40'));

  /* --- rejestr ryzyka ------------------------------------------------------------------------ */
  const risk = (id, hazard, category, likelihood, severity, control, fallback, ownerId) => {
    if (has(risks, id)) return;
    risks.push({ id, eventId: 'ev_open_2026', hazard, category, likelihood, severity, control, fallback, ownerId: ownerId || null, at: at('2026-10-10', '09:00'), byUserId: 'u_nowak' });
  };
  risk('ev_risk_tlok', 'Zator przy wejściu w pierwszym kwadransie', 'human', 4, 2,
    'Dwa stanowiska rejestracji i osobne wejście dla rodzin z wózkami; otwarcie drzwi 15 minut przed prezentacją.',
    'Trzecie stanowisko uruchamiane na sygnał z holu; prezentacja opóźniona o 10 minut.', 'u_wojcik');
  risk('ev_risk_alergia', 'Reakcja alergiczna po poczęstunku', 'environmental', 2, 4,
    'Oznaczenie 14 alergenów na każdym stanowisku wydawania; osobny stół bezglutenowy z własnymi szczypcami.',
    'Pielęgniarka na miejscu do 19:00; numer alarmowy przy stanowisku.', 'u_dyrektor');
  risk('ev_risk_prad', 'Zanik zasilania w auli w trakcie prezentacji', 'technical', 2, 3,
    'Prezentacja skopiowana na laptop z naładowaną baterią; oświetlenie awaryjne sprawdzone przez konserwatora.',
    'Prezentacja prowadzona bez rzutnika, przy oświetleniu awaryjnym.', null);
  /* Celowo w paśmie nieakceptowalnym (4 × 4 = 16): dopóki tu jest, dyrekcja nie zatwierdzi karty. */
  risk('ev_risk_ewakuacja', 'Zastawione wyjście ewakuacyjne przy auli (sprzęt nagłośnieniowy)', 'human', 4, 4,
    '', 'Brak — do ustalenia przed zatwierdzeniem karty.', null);

  /* --- wejściówki: pula dla gości, bez żadnych danych osobowych ------------------------------ */
  const pass = (id, token, kind, label) => {
    if (has(passes, id)) return;
    passes.push({ id, eventId: 'ev_open_2026', token, kind, label, issuedAt: at('2026-10-12', '10:00'), issuedBy: 'u_nowak', revoked: false, inside: false });
  };
  /* Tokeny demo są stałe, żeby dało się je zeskanować w trybie demonstracyjnym; w działającej
     szkole nadaje je serwer losowo (24 losowe bajty → 32 znaki URL-safe). */
  for (let i = 1; i <= 8; i++) {
    pass(`ev_pass_demo_${i}`, `demo-open-day-token-${String(i).padStart(2, '0')}-xxxxxx`, 'visitor', 'Pula wejściowa');
  }

  /* ================================================================= 2. przeszły festyn */
  if (!has(events, 'ev_festyn_2026')) {
    events.push({
      id: 'ev_festyn_2026', name: 'Festyn rodzinny „Pożegnanie lata”', kind: 'fete',
      date: FETE, start: '11:00', end: '16:00',
      leaderId: 'u_mazur', meetingId: null,
      objective: 'Zebrać społeczność szkolną na początku roku i wesprzeć zbiórkę rady rodziców na sprzęt sportowy.',
      outcome: 'Rodzice poznają wychowawców klas poza sytuacją zebrania.',
      measure: 'Frekwencja powyżej 250 osób i domknięta zbiórka na sprzęt.',
      redLines: ['Teren festynu jest bezalkoholowy.', 'Dmuchańce wyłącznie pod opieką operatora firmy zewnętrznej.'],
      audience: ['parent', 'student', 'public'], expectedVisitors: 300,
      rooms: [{ roomId: 'boisko', name: 'Boisko szkolne', layout: 'standing', areaM2: 800, bufferPct: 20, fireCapacity: null, expected: 300, note: 'Teren otwarty.' }],
      status: 'closed', createdAt: at('2026-08-20', '09:00'),
      approvedBy: 'u_dyrektor', approvedAt: at('2026-09-01', '10:00'), purgedAt: null
    });
    risks.push({ id: 'ev_risk_festyn_pogoda', eventId: 'ev_festyn_2026', hazard: 'Burza w trakcie festynu na otwartym terenie', category: 'natural', likelihood: 2, severity: 4, control: 'Prognoza sprawdzana rano; namioty z atestem; sala gimnastyczna gotowa jako schronienie.', fallback: 'Przeniesienie festynu do sali gimnastycznej i skrócenie programu.', ownerId: 'u_mazur', at: at('2026-08-25', '09:00'), byUserId: 'u_mazur' });
    briefings.push({ id: 'ev_brief_festyn', eventId: 'ev_festyn_2026', title: 'Instruktaż dla obsługi festynu', tier: 'staff', body: 'Stanowiska, punkt medyczny przy wejściu od ulicy, zbiórka w razie burzy — sala gimnastyczna.', requiresAck: true, version: 1, at: at('2026-08-26', '09:00'), byUserId: 'u_mazur' });
    /* Wejściówki, skany i zgłoszenia żywieniowe festynu: zostawiamy je, żeby było co usunąć —
       termin retencji (12.09 + 30 dni = 12.10) minął przed dniem demonstracyjnym 23.10.2026. */
    for (let i = 1; i <= 5; i++) {
      passes.push({ id: `ev_pass_festyn_${i}`, eventId: 'ev_festyn_2026', token: `demo-festyn-token-${String(i).padStart(2, '0')}-xxxxxxx`, kind: 'visitor', label: 'Wejście na festyn', issuedAt: at('2026-09-10', '09:00'), issuedBy: 'u_mazur', revoked: false, inside: false });
    }
    const scans = db.col('eventScans');
    for (let i = 1; i <= 4; i++) {
      scans.push({ id: `ev_scan_festyn_${i}`, eventId: 'ev_festyn_2026', passId: `ev_pass_festyn_${i}`, token: `demo-festyn-token-${String(i).padStart(2, '0')}-xxxxxxx`, direction: 'in', at: at(FETE, `1${i}:0${i}`), nonce: `seed-festyn-${i}`, deviceId: 'bramka-1', status: 'ok', code: null, byUserId: 'u_mazur' });
    }
    const dietary = db.col('eventDietary');
    dietary.push({ id: 'ev_diet_festyn_1', eventId: 'ev_festyn_2026', passId: 'ev_pass_festyn_1', diet: 'vegetarian', allergens: [], at: at('2026-09-05', '12:00'), byUserId: 'u_mazur' });
    dietary.push({ id: 'ev_diet_festyn_2', eventId: 'ev_festyn_2026', passId: 'ev_pass_festyn_2', diet: 'glutenFree', allergens: ['gluten'], at: at('2026-09-05', '12:10'), byUserId: 'u_mazur' });
    dietary.push({ id: 'ev_diet_festyn_3', eventId: 'ev_festyn_2026', passId: 'ev_pass_festyn_3', diet: 'standard', allergens: ['orzechy', 'mleko'], at: at('2026-09-05', '12:20'), byUserId: 'u_mazur' });
  }

  void ctx;
}

module.exports = { seed };
