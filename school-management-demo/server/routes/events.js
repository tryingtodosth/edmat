'use strict';
/* 3.10 — wydarzenia szkolne od strony organizatora: dzień otwarty, festyn, uroczystość, zebranie
   ogólne. To NIE jest wycieczka (karta wycieczki żyje w 3.8 — kolekcja `trips`) ani widok rodzica
   na zebrania i dni otwarte (3.7.8 — kolekcja `meetings`, tylko do odczytu). Tu mieszka to, czego
   żadna z tych dwóch stron nie prowadzi: karta wydarzenia z celem i granicami, plan sal z
   pojemnością użytkową, grafik dyżurów z ochroną małoletnich wolontariuszy, instruktaże w
   warstwach, wejściówki i skanowanie offline, liczby cateringowe wyłącznie zbiorczo, rejestr
   ryzyka blokujący zatwierdzenie oraz usunięcie danych ulotnych 30 dni po wydarzeniu.

   Kolekcje (prefiks identyfikatorów `ev_`): schoolEvents, eventShifts, eventBriefings,
   eventBriefingAcks, eventConsents, eventPasses, eventScans, eventDietary, eventRisks.
   Retencja: klasy `wydarzenia-szkolne` (B5) i `wydarzenia-dane-ulotne` (Bc, 30 dni) w
   server/routes/retention.js — bez nich kolekcje byłyby „bez klasy”. */
const crypto = require('node:crypto');
const D = require('../lib/domain');
const U = require('../lib/util');
const { httpError } = require('../lib/router');

const EV_READ = { roles: ['staff'] };
const EV_WRITE = { roles: ['teacher', 'principal', 'registrar', 'admin'] };
const EV_APPROVE = { roles: ['principal'] };
const EV_PURGE = { roles: ['dpo', 'principal'] };
/* Skanuje ten, kto stoi na wejściu: pracownik albo uczeń wolontariusz z dyżurem na tym wydarzeniu. */
const EV_SCAN = { roles: ['staff', 'student'] };
const EV_BRIEFING_READ = { roles: ['staff', 'student', 'parent'] };

const KINDS = {
  openDay: 'Dzień otwarty', fete: 'Festyn szkolny', ceremony: 'Uroczystość szkolna',
  parentEvening: 'Zebranie ogólne z rodzicami', competition: 'Konkurs lub zawody', other: 'Inne wydarzenie'
};
const STATUS = { draft: 'Wersja robocza', submitted: 'Złożona do zatwierdzenia', approved: 'Zatwierdzone', closed: 'Zamknięte' };

/* Układy sal i powierzchnia użytkowa na osobę (m²). Wartości z praktyki organizacji wydarzeń —
   NIE są to limity przeciwpożarowe. Limit pożarowy sali podaje szkoła (`fireCapacity`) i to on
   zawsze wygrywa: pojemność użytkowa nigdy go nie przekracza. */
const LAYOUTS = {
  theatre: { pl: 'Rzędy krzeseł', en: 'Theatre rows', m2: 0.85 },
  classroom: { pl: 'Stoliki szkolne', en: 'Classroom tables', m2: 1.5 },
  banquet: { pl: 'Stoły okrągłe', en: 'Banquet rounds', m2: 1.2 },
  ushape: { pl: 'Podkowa', en: 'U-shape', m2: 2.3 },
  standing: { pl: 'Miejsca stojące', en: 'Standing', m2: 0.65 }
};

/* 14 alergenów z załącznika II rozporządzenia (UE) nr 1169/2011 (EU FIC). Lista jest zamknięta:
   catering szkolny oznacza dokładnie te pozycje, a moduł liczy je wyłącznie zbiorczo. */
const ALLERGENS = {
  gluten: 'Zboża zawierające gluten', skorupiaki: 'Skorupiaki', jaja: 'Jaja', ryby: 'Ryby',
  orzeszki: 'Orzeszki ziemne', soja: 'Soja', mleko: 'Mleko', orzechy: 'Orzechy',
  seler: 'Seler', gorczyca: 'Gorczyca', sezam: 'Nasiona sezamu', siarczyny: 'Dwutlenek siarki i siarczyny',
  lubin: 'Łubin', mieczaki: 'Mięczaki'
};
const DIETS = { standard: 'Standardowa', vegetarian: 'Wegetariańska', vegan: 'Wegańska', glutenFree: 'Bezglutenowa', lactoseFree: 'Bez laktozy', halal: 'Halal', other: 'Inna' };

const RISK_CATEGORIES = { human: 'Ludzkie (tłum, zachowanie, zdrowie)', technical: 'Techniczne (prąd, sieć, sprzęt)', natural: 'Naturalne (pogoda, budynek)', environmental: 'Środowiskowe (żywność, wentylacja)' };

const EVENT_DEFAULTS = {
  minorUnderAge: 16,            // poniżej tego wieku obowiązują reguły ochronne
  minorMaxHoursPerDay: 7,       // dobowy limit dyżurów małoletniego wolontariusza
  minorCurfewFrom: '22:00',     // cisza nocna — dyżur nie może jej dotknąć
  minorCurfewTo: '06:00',
  minShiftGapMin: 15,           // minimalna przerwa między dyżurami tej samej osoby
  shiftDropCutoffHours: 4,      // na tyle godzin przed dyżurem nie można się już wypisać samodzielnie
  accessibilityBufferPct: 12,   // zapas na ciągi komunikacyjne, miejsca dla wózków i stanowisko obsługi
  riskAcceptMax: 12,            // 15–25 w matrycy 5×5 to pasmo nieakceptowalne
  scanCollisionWindowMin: 5,    // ten sam bilet na dwóch bramkach w tym oknie to kolizja, nie duplikat
  retentionDays: 30             // po tylu dniach znikają wejściówki, skany i dane o dietach
};
function evCfg(db) {
  const raw = (db.data.config && db.data.config.events) || {};
  return Object.assign({}, EVENT_DEFAULTS, raw);
}

/* ------------------------------------------------------------------ drobiazgi czasu i wieku */
const HHMM = /^([01]\d|2[0-3]):([0-5]\d)$/;
function mins(hhmm) { const m = HHMM.exec(String(hhmm || '')); return m ? +m[1] * 60 + +m[2] : null; }
function hhmm(v) { const n = Math.max(0, Math.round(v)); return String(Math.floor(n / 60)).padStart(2, '0') + ':' + String(n % 60).padStart(2, '0'); }
/** Wiek ukończony w dniu `date` (ISO). Bez biblioteki: porównanie „miesiąc-dzień”. */
function ageOn(birthDate, date) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(birthDate || '')) || !/^\d{4}-\d{2}-\d{2}$/.test(String(date || ''))) return null;
  let a = +date.slice(0, 4) - +birthDate.slice(0, 4);
  if (date.slice(5) < birthDate.slice(5)) a -= 1;
  return a;
}
const isoDate = (s) => /^\d{4}-\d{2}-\d{2}$/.test(String(s || ''));
const sName = (s) => (s ? `${s.firstName} ${s.lastName}` : '');
const userOfStudent = (db, studentId) => db.col('users').find((u) => u.role === 'student' && u.studentId === studentId) || null;

/* ------------------------------------------------------------------------------- widoki */
function roomPlan(db, e, room) {
  const cfg = evCfg(db);
  const layout = LAYOUTS[room.layout] ? room.layout : 'theatre';
  const area = Math.max(0, Number(room.areaM2) || 0);
  const buffer = room.bufferPct == null ? cfg.accessibilityBufferPct : Math.max(0, Math.min(50, Number(room.bufferPct) || 0));
  const usableM2 = area * (1 - buffer / 100);
  const byLayout = Math.floor(usableM2 / LAYOUTS[layout].m2);
  const fire = room.fireCapacity == null ? null : Math.max(0, Math.floor(Number(room.fireCapacity) || 0));
  /* Limit przeciwpożarowy zawsze wygrywa z arytmetyką powierzchni. */
  const seated = fire == null ? byLayout : Math.min(byLayout, fire);
  const expected = Math.max(0, Math.floor(Number(room.expected) || 0));
  return {
    roomId: room.roomId || room.name, name: room.name, layout,
    layoutLabel: LAYOUTS[layout].pl, areaM2: area, bufferPct: buffer,
    usableM2: Math.round(usableM2 * 10) / 10, m2PerPerson: LAYOUTS[layout].m2,
    byLayout, fireCapacity: fire, capacity: seated, expected,
    /* Dwa różne pytania: czy mieści się w planie i czy nie łamie limitu pożarowego. */
    overCapacity: expected > seated,
    overFire: fire != null && expected > fire,
    headroom: seated - expected,
    note: room.note || ''
  };
}

function shiftMinutes(sh) { const a = mins(sh.start), b = mins(sh.end); return a == null || b == null ? 0 : Math.max(0, b - a); }

function assigneeView(db, a) {
  const s = a.studentId ? db.get('students', a.studentId) : null;
  const u = a.userId ? db.get('users', a.userId) : null;
  return {
    kind: a.kind, userId: a.userId || null, studentId: a.studentId || null,
    name: s ? D.studentLabel(s, db) : D.userLabel(u),
    status: a.status || 'confirmed', pendingReason: a.pendingReason || null,
    minor: !!a.minor, at: a.at, byUserId: a.byUserId
  };
}

function shiftView(db, sh) {
  const assignees = (sh.assignees || []).map((a) => assigneeView(db, a));
  const confirmed = assignees.filter((a) => a.status === 'confirmed').length;
  const adults = (sh.assignees || []).filter((a) => a.kind === 'staff').length;
  return {
    id: sh.id, eventId: sh.eventId, station: sh.station, date: sh.date, dateLabel: U.fmtDate(sh.date),
    start: sh.start, end: sh.end, minutes: shiftMinutes(sh), needed: sh.needed,
    assignees, filled: confirmed, short: Math.max(0, sh.needed - confirmed),
    adultOnShift: adults > 0, adultRequired: sh.adultRequired !== false,
    pending: assignees.filter((a) => a.status === 'pending').length,
    note: sh.note || ''
  };
}

function briefingView(db, b, opts) {
  const acks = db.col('eventBriefingAcks').filter((x) => x.briefingId === b.id && x.version === b.version);
  return Object.assign({
    id: b.id, eventId: b.eventId, title: b.title, tier: b.tier, tierLabel: TIERS[b.tier] || b.tier,
    version: b.version, requiresAck: !!b.requiresAck, at: b.at,
    byUserId: b.byUserId, by: D.userLabel(db.get('users', b.byUserId)),
    ackCount: acks.length
  }, opts && opts.body ? { body: b.body } : {});
}

function riskView(db, x) {
  return {
    id: x.id, eventId: x.eventId, hazard: x.hazard, category: x.category,
    categoryLabel: RISK_CATEGORIES[x.category] || x.category,
    likelihood: x.likelihood, severity: x.severity, score: x.likelihood * x.severity,
    band: riskBand(db, x.likelihood * x.severity),
    control: x.control || '', fallback: x.fallback || '',
    ownerId: x.ownerId || null, owner: x.ownerId ? D.userLabel(db.get('users', x.ownerId)) : null,
    at: x.at, byUserId: x.byUserId
  };
}
function riskBand(db, score) {
  const max = evCfg(db).riskAcceptMax;
  if (score > max) return { id: 'unacceptable', label: 'Nieakceptowalne', blocksApproval: true };
  if (score >= 5) return { id: 'medium', label: 'Średnie', blocksApproval: false };
  return { id: 'low', label: 'Niskie', blocksApproval: false };
}

const TIERS = { public: 'Jawny', participant: 'Dla uczestników', staff: 'Dla obsługi', organizer: 'Dla organizatorów' };
const TIER_ORDER = ['public', 'participant', 'staff', 'organizer'];

function eventView(db, e, opts) {
  const shifts = db.col('eventShifts').filter((x) => x.eventId === e.id);
  const rooms = (e.rooms || []).map((rm) => roomPlan(db, e, rm));
  const risks = db.col('eventRisks').filter((x) => x.eventId === e.id).map((x) => riskView(db, x));
  const blocking = risks.filter((x) => x.band.blocksApproval);
  const short = shifts.reduce((n, sh) => n + shiftView(db, sh).short, 0);
  return Object.assign({
    id: e.id, name: e.name, kind: e.kind, kindLabel: KINDS[e.kind] || e.kind,
    date: e.date, dateLabel: U.fmtDate(e.date), start: e.start, end: e.end,
    status: e.status, statusLabel: STATUS[e.status] || e.status,
    leaderId: e.leaderId, leader: D.userLabel(db.get('users', e.leaderId)),
    meetingId: e.meetingId || null,
    objective: e.objective || '', outcome: e.outcome || '', measure: e.measure || '',
    redLines: e.redLines || [], audience: e.audience || [],
    expectedVisitors: e.expectedVisitors || 0,
    rooms, roomCapacity: rooms.reduce((n, r) => n + r.capacity, 0),
    roomsOverCapacity: rooms.filter((r) => r.overCapacity).map((r) => r.name),
    roomsOverFire: rooms.filter((r) => r.overFire).map((r) => r.name),
    shiftCount: shifts.length, shiftShortfall: short,
    riskCount: risks.length, blockingRisks: blocking.length,
    approvedBy: e.approvedBy ? D.userLabel(db.get('users', e.approvedBy)) : null, approvedAt: e.approvedAt || null,
    createdAt: e.createdAt, purgedAt: e.purgedAt || null,
    retentionDueOn: U.addDays(e.date, evCfg(db).retentionDays)
  }, opts && opts.risks ? { risks } : {});
}

/* --------------------------------------------------------------------------- uprawnienia */
function getEvent(db, id) { const e = db.get('schoolEvents', id); if (!e) throw httpError(404, 'Nie ma takiego wydarzenia.', { code: 'no_event' }); return e; }
const isOrganizer = (ctx, e) => ['principal', 'registrar', 'admin'].includes(ctx.user.role) || e.leaderId === ctx.user.id;
function assertOrganizer(ctx, e) {
  if (!isOrganizer(ctx, e)) throw httpError(403, 'Kartę wydarzenia prowadzi jego organizator albo dyrekcja.', { code: 'not_event_leader' });
}
/** Po zatwierdzeniu karta jest zamknięta na zmiany planu; dyżury i wejściówki żyją dalej. */
function assertEditable(ctx, e) {
  assertOrganizer(ctx, e);
  if (e.status === 'approved') throw httpError(409, 'Wydarzenie jest zatwierdzone — zmiany w karcie wprowadza dyrekcja.', { code: 'approved' });
  if (e.status === 'closed') throw httpError(409, 'Wydarzenie jest zamknięte.', { code: 'closed' });
}

/* -------------------------------------------------------- instruktaże: warstwy i potwierdzenia */
/** Najwyższa warstwa, którą widzi ta osoba na tym wydarzeniu. */
function tierFor(db, user, e) {
  if (isOrganizer({ user }, e)) return 'organizer';
  if (['principal', 'registrar', 'admin', 'dpo'].includes(user.role)) return 'organizer';
  if (user.role === 'student') {
    /* Uczeń wchodzi do warstwy obsługi, gdy ma już dyżur ALBO zgłoszenie do wolontariatu (zgoda
       opiekuna). Bez tego drugiego warunku powstałby zakleszczenie: instruktażu obsługi nie da się
       potwierdzić bez dyżuru, a dyżuru nie da się wziąć bez potwierdzonego instruktażu. Kolejność
       jest więc taka: zgoda opiekuna → instruktaż → dyżur. */
    const enrolled = db.col('eventConsents').some((c) => c.eventId === e.id && c.studentId === user.studentId);
    const onDuty = db.col('eventShifts').some((sh) => sh.eventId === e.id && (sh.assignees || []).some((a) => a.studentId === user.studentId));
    return enrolled || onDuty ? 'staff' : 'participant';
  }
  if (user.role === 'parent') return 'participant';
  return 'staff';
}
function visibleBriefings(db, user, e) {
  const max = TIER_ORDER.indexOf(tierFor(db, user, e));
  return db.col('eventBriefings').filter((b) => b.eventId === e.id && TIER_ORDER.indexOf(b.tier) <= max);
}
/** Instruktaże obowiązkowe dla obsługi, których ta osoba nie potwierdziła w bieżącej wersji. */
function unreadBriefings(db, userId, eventId) {
  const acks = db.col('eventBriefingAcks').filter((a) => a.userId === userId && a.eventId === eventId);
  return db.col('eventBriefings').filter((b) => b.eventId === eventId && b.requiresAck && TIER_ORDER.indexOf(b.tier) <= TIER_ORDER.indexOf('staff'))
    .filter((b) => !acks.some((a) => a.briefingId === b.id && a.version === b.version));
}
/** Bramka narzędziowa: bez potwierdzenia instruktażu narzędzia dyżurowe są zamknięte. */
function assertBriefingRead(ctx, e) {
  const unread = unreadBriefings(ctx.db, ctx.user.id, e.id);
  if (unread.length) {
    throw httpError(403, `Najpierw potwierdź zapoznanie się z instruktażem: ${unread.map((b) => `„${b.title}”`).join(', ')}.`,
      { code: 'briefing_unread', briefings: unread.map((b) => ({ id: b.id, title: b.title, version: b.version })) });
  }
}

/* ------------------------------------------------------- ochrona małoletnich wolontariuszy */
/** Wszystkie przeszkody dla przypisania ucznia do dyżuru. Pusta lista = wolno. */
function volunteerBlockers(db, e, shift, student) {
  const cfg = evCfg(db);
  const out = [];
  const age = ageOn(student.birthDate, shift.date);
  const minor = age != null && age < cfg.minorUnderAge;

  /* 1. Zgoda opiekuna — wymagana dla każdego niepełnoletniego ucznia. */
  if (!student.adult && !db.col('eventConsents').some((c) => c.eventId === e.id && c.studentId === student.id)) {
    out.push({ code: 'no_guardian_consent', message: `Brakuje zgody opiekuna na wolontariat ucznia ${D.studentLabel(student, db)}.` });
  }
  /* 2. Instruktaż — potwierdzony przez konto ucznia w bieżącej wersji. */
  const su = userOfStudent(db, student.id);
  if (!su) out.push({ code: 'no_account', message: `${D.studentLabel(student, db)} nie ma konta w dzienniku — nie potwierdzi instruktażu.` });
  else {
    const unread = unreadBriefings(db, su.id, e.id);
    if (unread.length) out.push({ code: 'briefing_unread', message: `${D.studentLabel(student, db)} nie potwierdził instruktażu: ${unread.map((b) => `„${b.title}”`).join(', ')}.` });
  }

  if (!minor) return out;   // dalsze reguły dotyczą wyłącznie małoletnich poniżej progu

  const newStart = mins(shift.start), newEnd = mins(shift.end), len = shiftMinutes(shift);
  /* 3. Cisza nocna — dyżur nie może jej dotknąć. */
  const from = mins(cfg.minorCurfewFrom), to = mins(cfg.minorCurfewTo);
  if (newEnd > from || newStart < to) {
    out.push({ code: 'curfew', message: `Dyżur ${shift.start}–${shift.end} wchodzi w godziny ciszy nocnej (${cfg.minorCurfewFrom}–${cfg.minorCurfewTo}) — wolontariusz poniżej ${cfg.minorUnderAge} lat nie może go pełnić.` });
  }
  /* Pozostałe dyżury tego ucznia w tym samym dniu (na wszystkich wydarzeniach). */
  const sameDay = db.col('eventShifts').filter((x) => x.id !== shift.id && x.date === shift.date && (x.assignees || []).some((a) => a.studentId === student.id));
  /* 4. Dobowy limit godzin. */
  const already = sameDay.reduce((n, x) => n + shiftMinutes(x), 0);
  const cap = cfg.minorMaxHoursPerDay * 60;
  if (already + len > cap) {
    out.push({ code: 'daily_cap', message: `Dobowy limit ${cfg.minorMaxHoursPerDay} h byłby przekroczony: ${hhmm(already)} już zapisane + ${hhmm(len)} tego dyżuru.`, alreadyMinutes: already, shiftMinutes: len, capMinutes: cap });
  }
  /* 5. Przerwa między dyżurami (nakładające się dyżury też łamią tę regułę). */
  for (const x of sameDay) {
    const s = mins(x.start), en = mins(x.end);
    if (s == null || en == null) continue;
    const gap = newStart >= en ? newStart - en : (s >= newEnd ? s - newEnd : -1);
    if (gap < cfg.minShiftGapMin) {
      out.push({ code: 'no_rest_gap', message: `Między dyżurami musi zostać co najmniej ${cfg.minShiftGapMin} min przerwy — dyżur ${x.start}–${x.end} na stanowisku „${x.station}” jest za blisko.`, otherShiftId: x.id });
      break;
    }
  }
  return out;
}

/* ------------------------------------------------------------------ wejściówki i skanowanie */
/** Token nieprzezroczysty: 32 znaki URL-safe, zero danych osobowych w kodzie QR. */
const newToken = () => crypto.randomBytes(24).toString('base64url');
function passView(db, p) {
  return { id: p.id, eventId: p.eventId, kind: p.kind, label: p.label || '', token: p.token, issuedAt: p.issuedAt, revoked: !!p.revoked, inside: !!p.inside };
}

function register(r, app) {
  /* ============================================================ 3.10.1 karta wydarzenia */
  r.get('/api/events', (ctx) => {
    const db = ctx.db;
    const rows = db.col('schoolEvents').slice().sort((a, b) => (a.date < b.date ? -1 : 1)).map((e) => eventView(db, e));
    return { events: ctx.query.mine === '1' ? rows.filter((e) => e.leaderId === ctx.user.id) : rows, kinds: KINDS, layouts: LAYOUTS, today: D.today(db) };
  }, EV_READ);

  r.get('/api/events/:id', (ctx) => {
    const db = ctx.db; const e = getEvent(db, ctx.params.id);
    return { event: eventView(db, e, { risks: true }), shifts: db.col('eventShifts').filter((x) => x.eventId === e.id).map((x) => shiftView(db, x)), mayEdit: isOrganizer(ctx, e) };
  }, EV_READ);

  r.post('/api/events', (ctx) => {
    const db = ctx.db; const b = ctx.body || {};
    const name = String(b.name || '').trim();
    if (name.length < 3) throw httpError(400, 'Podaj nazwę wydarzenia.', { code: 'no_name' });
    if (!KINDS[b.kind]) throw httpError(400, 'Wybierz rodzaj wydarzenia.', { code: 'bad_kind', kinds: Object.keys(KINDS) });
    if (!isoDate(b.date)) throw httpError(400, 'Podaj datę wydarzenia (RRRR-MM-DD).', { code: 'bad_date' });
    if (!HHMM.test(String(b.start || '')) || !HHMM.test(String(b.end || '')) || mins(b.end) <= mins(b.start)) {
      throw httpError(400, 'Podaj godziny wydarzenia (od–do).', { code: 'bad_time' });
    }
    /* Karta bez celu i bez miary to zaproszenie, nie karta — pilnujemy tego przy zakładaniu. */
    const objective = String(b.objective || '').trim();
    if (objective.length < 10) throw httpError(400, 'Karta wydarzenia zaczyna się od celu: po co je robimy i co ma się zmienić.', { code: 'no_objective' });
    const measure = String(b.measure || '').trim();
    if (measure.length < 3) throw httpError(400, 'Podaj miarę: po czym poznamy, że cel został osiągnięty.', { code: 'no_measure' });
    if (b.meetingId && !db.get('meetings', b.meetingId)) throw httpError(400, 'Nie ma takiego zebrania w kalendarzu 3.7.', { code: 'no_meeting' });

    const e = db.insert('schoolEvents', {
      id: U.id('ev'), name, kind: b.kind, date: b.date, start: b.start, end: b.end,
      leaderId: b.leaderId && db.get('users', b.leaderId) ? b.leaderId : ctx.user.id,
      meetingId: b.meetingId || null,
      objective, outcome: String(b.outcome || '').trim(), measure,
      redLines: Array.isArray(b.redLines) ? b.redLines.map((x) => String(x).slice(0, 200)).filter(Boolean).slice(0, 20) : [],
      audience: Array.isArray(b.audience) ? b.audience.filter((x) => ['parent', 'student', 'staff', 'public'].includes(x)) : ['parent'],
      expectedVisitors: Math.max(0, Math.floor(Number(b.expectedVisitors) || 0)),
      rooms: [], status: 'draft', createdAt: U.now(), approvedBy: null, approvedAt: null, purgedAt: null
    });
    ctx.audit({ action: 'event_created', entity: 'schoolEvents', entityId: e.id, after: { name, kind: e.kind, date: e.date, objective, measure }, reason: 'Karta wydarzenia szkolnego' });
    return { ok: true, event: eventView(db, e) };
  }, EV_WRITE);

  r.patch('/api/events/:id', (ctx) => {
    const db = ctx.db; const e = getEvent(db, ctx.params.id); assertEditable(ctx, e);
    const b = ctx.body || {};
    const before = { name: e.name, objective: e.objective, measure: e.measure, redLines: (e.redLines || []).slice(), expectedVisitors: e.expectedVisitors };
    if (b.name !== undefined) { const v = String(b.name).trim(); if (v.length < 3) throw httpError(400, 'Podaj nazwę wydarzenia.', { code: 'no_name' }); e.name = v; }
    if (b.objective !== undefined) { const v = String(b.objective).trim(); if (v.length < 10) throw httpError(400, 'Cel wydarzenia nie może zniknąć z karty.', { code: 'no_objective' }); e.objective = v; }
    if (b.measure !== undefined) { const v = String(b.measure).trim(); if (v.length < 3) throw httpError(400, 'Miara celu nie może zniknąć z karty.', { code: 'no_measure' }); e.measure = v; }
    if (b.outcome !== undefined) e.outcome = String(b.outcome).trim();
    if (b.redLines !== undefined) e.redLines = (Array.isArray(b.redLines) ? b.redLines : []).map((x) => String(x).slice(0, 200)).filter(Boolean).slice(0, 20);
    if (b.expectedVisitors !== undefined) e.expectedVisitors = Math.max(0, Math.floor(Number(b.expectedVisitors) || 0));
    if (b.status === 'submitted' && e.status === 'draft') e.status = 'submitted';
    db.save();
    ctx.audit({ action: 'event_updated', entity: 'schoolEvents', entityId: e.id, before, after: { name: e.name, objective: e.objective, measure: e.measure, redLines: e.redLines, expectedVisitors: e.expectedVisitors } });
    return { ok: true, event: eventView(db, e) };
  }, EV_WRITE);

  /* ============================================================ 3.10.2 plan sal i pojemność */
  r.put('/api/events/:id/rooms', (ctx) => {
    const db = ctx.db; const e = getEvent(db, ctx.params.id); assertEditable(ctx, e);
    const list = Array.isArray(ctx.body && ctx.body.rooms) ? ctx.body.rooms : null;
    if (!list) throw httpError(400, 'Podaj listę sal.', { code: 'no_rooms' });
    const rooms = list.map((rm, i) => {
      const name = String(rm.name || '').trim();
      if (!name) throw httpError(400, `Sala ${i + 1}: podaj nazwę.`, { code: 'no_room_name', index: i });
      if (rm.layout && !LAYOUTS[rm.layout]) throw httpError(400, `Sala „${name}”: nieznany układ.`, { code: 'bad_layout', index: i, layouts: Object.keys(LAYOUTS) });
      const area = Number(rm.areaM2);
      if (!(area > 0)) throw httpError(400, `Sala „${name}”: podaj powierzchnię w m².`, { code: 'no_area', index: i });
      return {
        roomId: String(rm.roomId || name).slice(0, 40), name, layout: LAYOUTS[rm.layout] ? rm.layout : 'theatre',
        areaM2: area, bufferPct: rm.bufferPct == null ? null : Math.max(0, Math.min(50, Number(rm.bufferPct) || 0)),
        fireCapacity: rm.fireCapacity == null || rm.fireCapacity === '' ? null : Math.max(0, Math.floor(Number(rm.fireCapacity) || 0)),
        expected: Math.max(0, Math.floor(Number(rm.expected) || 0)), note: String(rm.note || '').slice(0, 200)
      };
    });
    const before = (e.rooms || []).slice();
    e.rooms = rooms; db.save();
    const plans = rooms.map((rm) => roomPlan(db, e, rm));
    ctx.audit({ action: 'event_rooms_planned', entity: 'schoolEvents', entityId: e.id, before: { rooms: before }, after: { rooms, capacity: plans.reduce((n, p) => n + p.capacity, 0) }, reason: 'Plan sal wydarzenia' });
    return {
      ok: true, rooms: plans,
      totalCapacity: plans.reduce((n, p) => n + p.capacity, 0),
      totalExpected: plans.reduce((n, p) => n + p.expected, 0),
      warnings: plans.filter((p) => p.overCapacity || p.overFire).map((p) => ({
        room: p.name, overCapacity: p.overCapacity, overFire: p.overFire,
        message: p.overFire
          ? `Sala „${p.name}”: ${p.expected} osób przy limicie przeciwpożarowym ${p.fireCapacity}. Tej liczby nie wolno wpuścić.`
          : `Sala „${p.name}”: ${p.expected} osób przy pojemności użytkowej ${p.capacity} (układ „${p.layoutLabel}”, zapas ${p.bufferPct}% na dostępność).`
      })),
      note: `Pojemność użytkowa liczy się z powierzchni pomniejszonej o zapas na ciągi komunikacyjne i miejsca dla osób poruszających się na wózku, a limit przeciwpożarowy sali zawsze ją ogranicza.`
    };
  }, EV_WRITE);

  /* ============================================================ 3.10.3 grafik dyżurów */
  r.post('/api/events/:id/shifts', (ctx) => {
    const db = ctx.db; const e = getEvent(db, ctx.params.id); assertOrganizer(ctx, e);
    const b = ctx.body || {};
    const station = String(b.station || '').trim();
    if (!station) throw httpError(400, 'Podaj stanowisko (np. „Wejście główne”).', { code: 'no_station' });
    const date = isoDate(b.date) ? b.date : e.date;
    if (!HHMM.test(String(b.start || '')) || !HHMM.test(String(b.end || '')) || mins(b.end) <= mins(b.start)) {
      throw httpError(400, 'Podaj godziny dyżuru (od–do).', { code: 'bad_time' });
    }
    const sh = db.insert('eventShifts', {
      id: U.id('evsh'), eventId: e.id, station, date, start: b.start, end: b.end,
      needed: Math.max(1, Math.floor(Number(b.needed) || 1)),
      adultRequired: b.adultRequired !== false, assignees: [], note: String(b.note || '').slice(0, 200), createdAt: U.now()
    });
    ctx.audit({ action: 'event_shift_created', entity: 'eventShifts', entityId: sh.id, after: { eventId: e.id, station, date, start: sh.start, end: sh.end, needed: sh.needed } });
    return { ok: true, shift: shiftView(db, sh) };
  }, EV_WRITE);

  r.get('/api/events/:id/rota', (ctx) => {
    const db = ctx.db; const e = getEvent(db, ctx.params.id);
    const shifts = db.col('eventShifts').filter((x) => x.eventId === e.id)
      .map((x) => shiftView(db, x))
      .sort((a, b) => (a.date + a.start + a.station < b.date + b.start + b.station ? -1 : 1));
    const byStation = {};
    for (const s of shifts) { (byStation[s.station] = byStation[s.station] || []).push(s.id); }
    return {
      event: eventView(db, e), shifts, stations: Object.keys(byStation).sort(),
      shortfall: shifts.filter((s) => s.short > 0).map((s) => ({ shiftId: s.id, station: s.station, date: s.date, start: s.start, end: s.end, short: s.short })),
      totalShort: shifts.reduce((n, s) => n + s.short, 0),
      pendingAdult: shifts.filter((s) => s.pending > 0).map((s) => ({ shiftId: s.id, station: s.station, pending: s.pending })),
      note: 'Dyżur liczy się jako obsadzony dopiero przy potwierdzonym zapisie. Zapis małoletniego czeka („oczekuje”), dopóki na tym samym dyżurze nie ma osoby dorosłej.'
    };
  }, EV_READ);

  /* ================================ 3.10.4 + 3.10.5 zapis na dyżur: zgoda, instruktaż, ochrona */
  r.post('/api/events/:id/shifts/:shiftId/claim', (ctx) => {
    const db = ctx.db; const e = getEvent(db, ctx.params.id);
    const sh = db.get('eventShifts', ctx.params.shiftId);
    if (!sh || sh.eventId !== e.id) throw httpError(404, 'Nie ma takiego dyżuru.', { code: 'no_shift' });
    if (e.status === 'closed') throw httpError(409, 'Wydarzenie jest zamknięte.', { code: 'closed' });
    const b = ctx.body || {};

    /* Kto jest zapisywany: uczeń zapisuje siebie, organizator zapisuje kogokolwiek. */
    let studentId = null, userId = null, kind = 'staff';
    if (ctx.user.role === 'student') {
      if (b.studentId && b.studentId !== ctx.user.studentId) throw httpError(403, 'Na dyżur zapisujesz wyłącznie siebie.', { code: 'not_self' });
      studentId = ctx.user.studentId; kind = 'student';
    } else if (b.studentId) {
      if (!isOrganizer(ctx, e)) throw httpError(403, 'Ucznia na dyżur zapisuje organizator wydarzenia.', { code: 'not_event_leader' });
      studentId = b.studentId; kind = 'student';
    } else {
      userId = b.userId && isOrganizer(ctx, e) ? b.userId : ctx.user.id; kind = 'staff';
    }

    const assignees = (sh.assignees || []).slice();
    if (assignees.some((a) => (studentId && a.studentId === studentId) || (userId && a.userId === userId))) {
      throw httpError(409, 'Ten dyżur jest już zapisany na tę osobę.', { code: 'already_claimed' });
    }

    let status = 'confirmed', pendingReason = null, minor = false, blockers = [];
    if (kind === 'student') {
      const st = db.get('students', studentId);
      if (!st) throw httpError(404, 'Nie ma takiego ucznia.', { code: 'no_student' });
      const age = ageOn(st.birthDate, sh.date);
      minor = age != null && age < evCfg(db).minorUnderAge;
      blockers = volunteerBlockers(db, e, sh, st);
      if (blockers.length) {
        throw httpError(409, blockers[0].message, { code: blockers[0].code, blockers, studentId, minor, age });
      }
      /* Osoba dorosła na dyżurze: bez niej zapis małoletniego czeka, zamiast zostać odrzucony. */
      if (minor && sh.adultRequired !== false && !assignees.some((a) => a.kind === 'staff')) {
        status = 'pending'; pendingReason = 'no_adult';
      }
    } else {
      const u = db.get('users', userId);
      if (!u) throw httpError(404, 'Nie ma takiego konta.', { code: 'no_user' });
    }

    assignees.push({ kind, userId, studentId, status, pendingReason, minor, at: U.now(), byUserId: ctx.user.id });
    /* Dorosły domyka oczekujące zapisy małoletnich na tym samym dyżurze. */
    let released = 0;
    if (kind === 'staff') {
      for (const a of assignees) { if (a.status === 'pending' && a.pendingReason === 'no_adult') { a.status = 'confirmed'; a.pendingReason = null; released++; } }
    }
    db.update('eventShifts', sh.id, { assignees });
    ctx.audit({ action: 'event_shift_claimed', entity: 'eventShifts', entityId: sh.id, after: { eventId: e.id, kind, userId, studentId, status, pendingReason, releasedPending: released }, reason: 'Zapis na dyżur przy wydarzeniu' });

    const fresh = db.get('eventShifts', sh.id);
    return {
      ok: true, status, pendingReason, minor, releasedPending: released,
      shift: shiftView(db, fresh),
      message: status === 'pending'
        ? 'Zapis przyjęty warunkowo: dyżur małoletniego wolontariusza czeka na osobę dorosłą na tym samym stanowisku.'
        : 'Zapis potwierdzony.'
    };
  }, { roles: ['staff', 'student'] });

  r.post('/api/events/:id/shifts/:shiftId/release', (ctx) => {
    const db = ctx.db; const e = getEvent(db, ctx.params.id);
    const sh = db.get('eventShifts', ctx.params.shiftId);
    if (!sh || sh.eventId !== e.id) throw httpError(404, 'Nie ma takiego dyżuru.', { code: 'no_shift' });
    const b = ctx.body || {};
    const studentId = ctx.user.role === 'student' ? ctx.user.studentId : (b.studentId || null);
    const userId = studentId ? null : (b.userId || ctx.user.id);
    const idx = (sh.assignees || []).findIndex((a) => (studentId && a.studentId === studentId) || (userId && a.userId === userId));
    if (idx < 0) throw httpError(404, 'Ta osoba nie jest zapisana na ten dyżur.', { code: 'not_claimed' });
    const self = (studentId && studentId === ctx.user.studentId) || (userId && userId === ctx.user.id);
    /* Samodzielne wypisanie zamyka się na kilka godzin przed dyżurem — potem przepisuje organizator. */
    if (self && !isOrganizer(ctx, e)) {
      const cfg = evCfg(db);
      const nowS = D.schoolNow(db);
      const cutoffMin = mins(sh.start) - cfg.shiftDropCutoffHours * 60;
      if (nowS.date > sh.date || (nowS.date === sh.date && mins(nowS.time) >= cutoffMin)) {
        throw httpError(409, `Na ${cfg.shiftDropCutoffHours} h przed dyżurem wypisuje już tylko organizator — zgłoś się do niego.`, { code: 'drop_cutoff' });
      }
    }
    const assignees = (sh.assignees || []).slice();
    const [gone] = assignees.splice(idx, 1);
    /* Odejście ostatniego dorosłego cofa zapisy małoletnich do stanu oczekującego. */
    let heldBack = 0;
    if (gone.kind === 'staff' && !assignees.some((a) => a.kind === 'staff') && sh.adultRequired !== false) {
      for (const a of assignees) { if (a.kind === 'student' && a.minor && a.status === 'confirmed') { a.status = 'pending'; a.pendingReason = 'no_adult'; heldBack++; } }
    }
    db.update('eventShifts', sh.id, { assignees });
    ctx.audit({ action: 'event_shift_released', entity: 'eventShifts', entityId: sh.id, before: { assignee: gone }, after: { heldBackPending: heldBack }, reason: 'Wypisanie z dyżuru' });
    return { ok: true, shift: shiftView(db, db.get('eventShifts', sh.id)), heldBackPending: heldBack };
  }, { roles: ['staff', 'student'] });

  /* Zgoda opiekuna na wolontariat — opiekun podpisuje ją ze swojego konta. */
  r.post('/api/events/:id/consents', (ctx) => {
    const db = ctx.db; const e = getEvent(db, ctx.params.id);
    const b = ctx.body || {};
    const studentId = String(b.studentId || '');
    const st = db.get('students', studentId);
    if (!st) throw httpError(404, 'Nie ma takiego ucznia.', { code: 'no_student' });
    if (ctx.user.role === 'parent') {
      if (!(ctx.user.childrenIds || []).includes(studentId)) throw httpError(403, 'Zgodę podpisuje opiekun tego ucznia.', { code: 'not_guardian' });
    } else if (!isOrganizer(ctx, e)) {
      throw httpError(403, 'Zgodę opiekuna rejestruje opiekun albo organizator wydarzenia.', { code: 'not_event_leader' });
    }
    const had = db.col('eventConsents').find((c) => c.eventId === e.id && c.studentId === studentId);
    if (had) return { ok: true, consent: had, already: true };
    const c = db.insert('eventConsents', {
      id: U.id('evc'), eventId: e.id, studentId, scope: 'volunteer',
      byUserId: ctx.user.id, by: D.userLabel(ctx.user), at: U.now(),
      note: String(b.note || '').slice(0, 200)
    });
    ctx.audit({ action: 'event_consent_signed', entity: 'eventConsents', entityId: c.id, after: { eventId: e.id, studentId, byUserId: ctx.user.id }, reason: 'Zgoda opiekuna na wolontariat przy wydarzeniu' });
    return { ok: true, consent: c };
  }, { roles: ['parent', 'teacher', 'principal', 'registrar', 'admin'] });

  /* ============================================================ 3.10.6 instruktaże w warstwach */
  r.post('/api/events/:id/briefings', (ctx) => {
    const db = ctx.db; const e = getEvent(db, ctx.params.id); assertOrganizer(ctx, e);
    const b = ctx.body || {};
    const title = String(b.title || '').trim();
    if (title.length < 3) throw httpError(400, 'Podaj tytuł instruktażu.', { code: 'no_title' });
    if (!TIERS[b.tier]) throw httpError(400, 'Wybierz warstwę dostępu instruktażu.', { code: 'bad_tier', tiers: Object.keys(TIERS) });
    const body = String(b.body || '').trim();
    if (!body) throw httpError(400, 'Instruktaż bez treści nie ma czego przekazać.', { code: 'no_body' });
    /* Nowa wersja tego samego tytułu unieważnia dotychczasowe potwierdzenia — o to właśnie chodzi. */
    const prev = db.col('eventBriefings').find((x) => x.eventId === e.id && x.title === title);
    if (prev) {
      db.update('eventBriefings', prev.id, { tier: b.tier, body, requiresAck: b.requiresAck !== false, version: prev.version + 1, at: U.now(), byUserId: ctx.user.id });
      const upd = db.get('eventBriefings', prev.id);
      ctx.audit({ action: 'event_briefing_published', entity: 'eventBriefings', entityId: upd.id, before: { version: prev.version }, after: { version: upd.version, tier: upd.tier }, reason: 'Nowa wersja instruktażu' });
      return { ok: true, briefing: briefingView(db, upd, { body: true }), reacknowledgeRequired: true };
    }
    const x = db.insert('eventBriefings', {
      id: U.id('evb'), eventId: e.id, title, tier: b.tier, body,
      requiresAck: b.requiresAck !== false, version: 1, at: U.now(), byUserId: ctx.user.id
    });
    ctx.audit({ action: 'event_briefing_published', entity: 'eventBriefings', entityId: x.id, after: { eventId: e.id, title, tier: x.tier, version: 1 } });
    return { ok: true, briefing: briefingView(db, x, { body: true }) };
  }, EV_WRITE);

  r.get('/api/events/:id/briefings', (ctx) => {
    const db = ctx.db; const e = getEvent(db, ctx.params.id);
    const tier = tierFor(db, ctx.user, e);
    const rows = visibleBriefings(db, ctx.user, e);
    const acks = db.col('eventBriefingAcks').filter((a) => a.userId === ctx.user.id && a.eventId === e.id);
    return {
      eventId: e.id, myTier: tier, myTierLabel: TIERS[tier], tiers: TIERS,
      briefings: rows.map((b) => Object.assign(briefingView(db, b, { body: true }), {
        acknowledged: acks.some((a) => a.briefingId === b.id && a.version === b.version)
      })).sort((a, b) => TIER_ORDER.indexOf(a.tier) - TIER_ORDER.indexOf(b.tier)),
      hidden: db.col('eventBriefings').filter((b) => b.eventId === e.id).length - rows.length,
      unread: unreadBriefings(db, ctx.user.id, e.id).map((b) => ({ id: b.id, title: b.title, version: b.version })),
      note: 'Instruktaż widzi ten, kogo dotyczy. Warstwa wyższa zawiera wszystko z niższych.'
    };
  }, EV_BRIEFING_READ);

  r.post('/api/events/:id/briefings/:bid/ack', (ctx) => {
    const db = ctx.db; const e = getEvent(db, ctx.params.id);
    const b = db.get('eventBriefings', ctx.params.bid);
    if (!b || b.eventId !== e.id) throw httpError(404, 'Nie ma takiego instruktażu.', { code: 'no_briefing' });
    if (!visibleBriefings(db, ctx.user, e).some((x) => x.id === b.id)) throw httpError(403, 'Ten instruktaż nie jest przeznaczony dla Twojej roli.', { code: 'tier_forbidden' });
    const had = db.col('eventBriefingAcks').find((a) => a.briefingId === b.id && a.userId === ctx.user.id && a.version === b.version);
    if (had) return { ok: true, ack: had, already: true };
    const a = db.insert('eventBriefingAcks', {
      id: U.id('evba'), briefingId: b.id, eventId: e.id, userId: ctx.user.id,
      studentId: ctx.user.role === 'student' ? ctx.user.studentId : null,
      version: b.version, at: U.now()
    });
    ctx.audit({ action: 'event_briefing_acknowledged', entity: 'eventBriefingAcks', entityId: a.id, after: { briefingId: b.id, version: b.version, userId: ctx.user.id }, reason: 'Potwierdzenie zapoznania się z instruktażem' });
    return { ok: true, ack: a, remaining: unreadBriefings(db, ctx.user.id, e.id).length };
  }, EV_BRIEFING_READ);

  /* ============================================ 3.10.7 + 3.10.8 wejściówki i skanowanie offline */
  r.post('/api/events/:id/passes', (ctx) => {
    const db = ctx.db; const e = getEvent(db, ctx.params.id); assertOrganizer(ctx, e);
    const b = ctx.body || {};
    const count = Math.max(1, Math.min(2000, Math.floor(Number(b.count) || 1)));
    const kind = ['visitor', 'volunteer', 'guest'].includes(b.kind) ? b.kind : 'visitor';
    /* `label` jest jawnie nie-osobowe: „Rodzice 7b”, „Prasa”. Nazwisk tu nie trzymamy — kod QR
       niesie wyłącznie nieprzezroczysty token, a token nie jest kluczem do tożsamości. */
    const label = String(b.label || '').slice(0, 60);
    if (/\d{11}/.test(label)) throw httpError(400, 'Etykieta wejściówki nie może zawierać numeru PESEL.', { code: 'pii_in_label' });
    const made = [];
    for (let i = 0; i < count; i++) {
      made.push(db.insert('eventPasses', {
        id: U.id('evp'), eventId: e.id, token: newToken(), kind, label,
        issuedAt: U.now(), issuedBy: ctx.user.id, revoked: false, inside: false
      }));
    }
    ctx.audit({ action: 'event_passes_issued', entity: 'schoolEvents', entityId: e.id, after: { count: made.length, kind, label }, reason: 'Wydanie wejściówek' });
    return {
      ok: true, issued: made.length, passes: made.map((p) => passView(db, p)),
      note: 'Kod QR niesie wyłącznie losowy token (32 znaki, URL-safe). Imię, nazwisko ani żadna inna dana osobowa nie są w nim zapisane.'
    };
  }, EV_WRITE);

  r.get('/api/events/:id/passes', (ctx) => {
    const db = ctx.db; const e = getEvent(db, ctx.params.id); assertOrganizer(ctx, e);
    const passes = db.col('eventPasses').filter((p) => p.eventId === e.id);
    return { passes: passes.map((p) => passView(db, p)), issued: passes.length, inside: passes.filter((p) => p.inside && !p.revoked).length };
  }, EV_WRITE);

  /** Paczka skanów z bramki: kolejka offline wysyła je hurtem, kiedy sieć wróci.
      Każdy skan niesie własny `nonce`; powtórka tego samego nonce'a nie tworzy drugiego wiersza. */
  r.post('/api/events/:id/scans', (ctx) => {
    const db = ctx.db; const e = getEvent(db, ctx.params.id);
    /* Bramka dyżurowa otwiera się dopiero po potwierdzeniu instruktażu. */
    assertBriefingRead(ctx, e);
    const cfg = evCfg(db);
    const list = Array.isArray(ctx.body && ctx.body.scans) ? ctx.body.scans : null;
    if (!list) throw httpError(400, 'Podaj listę skanów.', { code: 'no_scans' });
    if (list.length > 500) throw httpError(413, 'Naraz przyjmujemy najwyżej 500 skanów — podziel paczkę.', { code: 'batch_too_large' });
    const deviceId = String((ctx.body && ctx.body.deviceId) || '').slice(0, 40) || 'nieznane';

    /* Kolejność rozstrzyga o tym, kto wszedł pierwszy — sortujemy po czasie skanu, nie po kolejności w paczce. */
    const ordered = list.map((x, i) => ({ x, i })).sort((a, b) => (String(a.x.at || '') < String(b.x.at || '') ? -1 : String(a.x.at || '') > String(b.x.at || '') ? 1 : a.i - b.i));
    const results = new Array(list.length);
    let accepted = 0, duplicates = 0, collisions = 0, replays = 0;

    for (const { x, i } of ordered) {
      const nonce = String(x.nonce || '').slice(0, 64);
      const at = String(x.at || '') || U.now();
      const direction = x.direction === 'out' ? 'out' : 'in';
      const token = String(x.token || '');

      if (!nonce) { results[i] = { status: 'rejected', code: 'no_nonce', message: 'Skan bez identyfikatora — kolejka offline musi go nadać.' }; continue; }
      const seen = db.col('eventScans').find((s) => s.eventId === e.id && s.nonce === nonce);
      if (seen) { replays++; results[i] = { status: seen.status, code: seen.code || null, replay: true, scanId: seen.id, at: seen.at }; continue; }

      const pass = db.col('eventPasses').find((p) => p.eventId === e.id && p.token === token);
      let status = 'ok', code = null, message = 'Wejście zarejestrowane.';
      if (!pass) { status = 'unknown'; code = 'unknown_pass'; message = 'Wejściówka nie należy do tego wydarzenia.'; }
      else if (pass.revoked) { status = 'revoked'; code = 'revoked'; message = 'Wejściówka została unieważniona.'; }
      else if (direction === 'in') {
        if (pass.inside) {
          /* Ten sam bilet na innej bramce i w krótkim oknie czasu to kolizja do rozstrzygnięcia
             przez człowieka; na tej samej bramce to po prostu drugi skan tej samej osoby. */
          const last = db.col('eventScans').filter((s) => s.passId === pass.id && s.status === 'ok' && s.direction === 'in').slice(-1)[0];
          const otherGate = last && last.deviceId !== deviceId;
          const within = last && Math.abs(new Date(at) - new Date(last.at)) <= cfg.scanCollisionWindowMin * 60000;
          if (otherGate && within) { status = 'collision'; code = 'collision'; message = `Ta wejściówka została przed chwilą użyta na innym wejściu (${last.deviceId}). Zatrzymaj i wyjaśnij.`; }
          else { status = 'duplicate'; code = 'already_in'; message = 'Ta wejściówka jest już w środku.'; }
        }
      } else if (!pass.inside) { status = 'duplicate'; code = 'not_inside'; message = 'Ta wejściówka nie była odnotowana w środku.'; }

      const row = db.insert('eventScans', {
        id: U.id('evs'), eventId: e.id, passId: pass ? pass.id : null, token: pass ? token : null,
        direction, at, nonce, deviceId, status, code, byUserId: ctx.user.id
      });
      if (status === 'ok') { db.update('eventPasses', pass.id, { inside: direction === 'in' }); accepted++; }
      else if (status === 'duplicate') duplicates++;
      else if (status === 'collision') collisions++;
      results[i] = { status, code, message, scanId: row.id, at };
    }

    const passes = db.col('eventPasses').filter((p) => p.eventId === e.id);
    return {
      ok: true, results, accepted, duplicates, collisions, replays,
      inside: passes.filter((p) => p.inside && !p.revoked).length,
      issued: passes.length,
      note: 'Skany rozliczają się po czasie skanu, nie po kolejności nadejścia. Powtórzony skan (ten sam nonce) zwraca pierwotny wynik i nie tworzy drugiego wpisu.'
    };
  }, EV_SCAN);

  r.get('/api/events/:id/scans', (ctx) => {
    const db = ctx.db; const e = getEvent(db, ctx.params.id); assertOrganizer(ctx, e);
    const rows = db.col('eventScans').filter((s) => s.eventId === e.id).slice().sort((a, b) => (a.at < b.at ? 1 : -1)).slice(0, Math.min(500, +ctx.query.limit || 100));
    return {
      scans: rows.map((s) => ({ id: s.id, at: s.at, direction: s.direction, status: s.status, code: s.code, deviceId: s.deviceId, passId: s.passId })),
      counts: ['ok', 'duplicate', 'collision', 'unknown', 'revoked', 'rejected'].reduce((o, k) => Object.assign(o, { [k]: db.col('eventScans').filter((s) => s.eventId === e.id && s.status === k).length }), {})
    };
  }, EV_WRITE);

  /* ============================================================ 3.10.9 catering: tylko zbiorczo */
  r.post('/api/events/:id/dietary', (ctx) => {
    const db = ctx.db; const e = getEvent(db, ctx.params.id);
    const b = ctx.body || {};
    const diet = DIETS[b.diet] ? b.diet : 'standard';
    const allergens = (Array.isArray(b.allergens) ? b.allergens : []).filter((a) => ALLERGENS[a]);
    const unknown = (Array.isArray(b.allergens) ? b.allergens : []).filter((a) => !ALLERGENS[a]);
    if (unknown.length) throw httpError(400, `Nieznany alergen: ${unknown.join(', ')}. Lista jest zamknięta — 14 pozycji z rozporządzenia (UE) nr 1169/2011.`, { code: 'bad_allergen', allergens: Object.keys(ALLERGENS) });
    /* Zgłoszenie wiąże się z wejściówką, nie z osobą: catering dostaje liczby, nie nazwiska. */
    const passId = b.passId ? String(b.passId) : null;
    if (passId && !db.col('eventPasses').some((p) => p.id === passId && p.eventId === e.id)) throw httpError(404, 'Nie ma takiej wejściówki.', { code: 'no_pass' });
    const row = db.insert('eventDietary', {
      id: U.id('evd'), eventId: e.id, passId, diet, allergens,
      at: U.now(), byUserId: ctx.user.id
    });
    ctx.audit({ action: 'event_dietary_declared', entity: 'eventDietary', entityId: row.id, after: { eventId: e.id, diet, allergens: allergens.length }, reason: 'Zgłoszenie żywieniowe do wydarzenia' });
    return { ok: true, id: row.id, diet, allergens };
  }, { roles: ['staff', 'student', 'parent'] });

  r.get('/api/events/:id/catering', (ctx) => {
    const db = ctx.db; const e = getEvent(db, ctx.params.id);
    const rows = db.col('eventDietary').filter((x) => x.eventId === e.id);
    const byDiet = {}; for (const k of Object.keys(DIETS)) byDiet[k] = 0;
    const byAllergen = {}; for (const k of Object.keys(ALLERGENS)) byAllergen[k] = 0;
    for (const x of rows) { byDiet[x.diet] = (byDiet[x.diet] || 0) + 1; for (const a of x.allergens || []) byAllergen[a] = (byAllergen[a] || 0) + 1; }
    const declared = rows.length;
    return {
      eventId: e.id, event: e.name, date: e.date,
      headcount: { expected: e.expectedVisitors || 0, declared, undeclared: Math.max(0, (e.expectedVisitors || 0) - declared) },
      diets: Object.entries(DIETS).map(([id, label]) => ({ id, label, count: byDiet[id] || 0 })).filter((d) => d.count > 0 || d.id === 'standard'),
      allergens: Object.entries(ALLERGENS).map(([id, label]) => ({ id, label, count: byAllergen[id] || 0 })).filter((a) => a.count > 0),
      allAllergens: Object.entries(ALLERGENS).map(([id, label]) => ({ id, label })),
      /* Minimalizacja danych: nie ma tu ani listy osób, ani identyfikatorów wejściówek. */
      note: 'Raport jest wyłącznie zbiorczy — z tego modułu nie wychodzi imienna lista diet ani alergii. Obsługa kuchni potrzebuje liczb i oznaczeń na stanowiskach, nie nazwisk.',
      labelling: 'Każde stanowisko wydawania oznacza się nazwami alergenów zgodnie z rozporządzeniem (UE) nr 1169/2011 (14 pozycji).'
    };
  }, { roles: ['staff'] });

  /* ============================================================ 3.10.10 rejestr ryzyka */
  r.post('/api/events/:id/risks', (ctx) => {
    const db = ctx.db; const e = getEvent(db, ctx.params.id); assertOrganizer(ctx, e);
    const b = ctx.body || {};
    const hazard = String(b.hazard || '').trim();
    if (hazard.length < 3) throw httpError(400, 'Opisz zagrożenie.', { code: 'no_hazard' });
    if (!RISK_CATEGORIES[b.category]) throw httpError(400, 'Wybierz kategorię zagrożenia.', { code: 'bad_category', categories: Object.keys(RISK_CATEGORIES) });
    const likelihood = Math.floor(Number(b.likelihood));
    const severity = Math.floor(Number(b.severity));
    if (!(likelihood >= 1 && likelihood <= 5) || !(severity >= 1 && severity <= 5)) {
      throw httpError(400, 'Prawdopodobieństwo i skutek oceniamy w skali 1–5.', { code: 'bad_score' });
    }
    const x = db.insert('eventRisks', {
      id: U.id('evr'), eventId: e.id, hazard, category: b.category, likelihood, severity,
      control: String(b.control || '').slice(0, 400), fallback: String(b.fallback || '').slice(0, 400),
      ownerId: b.ownerId && db.get('users', b.ownerId) ? b.ownerId : null,
      at: U.now(), byUserId: ctx.user.id
    });
    ctx.audit({ action: 'event_risk_added', entity: 'eventRisks', entityId: x.id, after: { eventId: e.id, hazard, likelihood, severity, score: likelihood * severity } });
    return { ok: true, risk: riskView(db, x) };
  }, EV_WRITE);

  r.patch('/api/events/:id/risks/:riskId', (ctx) => {
    const db = ctx.db; const e = getEvent(db, ctx.params.id); assertOrganizer(ctx, e);
    const x = db.get('eventRisks', ctx.params.riskId);
    if (!x || x.eventId !== e.id) throw httpError(404, 'Nie ma takiej pozycji w rejestrze ryzyka.', { code: 'no_risk' });
    const b = ctx.body || {}; const before = { likelihood: x.likelihood, severity: x.severity, control: x.control };
    const patch = {};
    if (b.likelihood !== undefined) { const v = Math.floor(Number(b.likelihood)); if (!(v >= 1 && v <= 5)) throw httpError(400, 'Prawdopodobieństwo oceniamy w skali 1–5.', { code: 'bad_score' }); patch.likelihood = v; }
    if (b.severity !== undefined) { const v = Math.floor(Number(b.severity)); if (!(v >= 1 && v <= 5)) throw httpError(400, 'Skutek oceniamy w skali 1–5.', { code: 'bad_score' }); patch.severity = v; }
    if (b.control !== undefined) patch.control = String(b.control).slice(0, 400);
    if (b.fallback !== undefined) patch.fallback = String(b.fallback).slice(0, 400);
    db.update('eventRisks', x.id, patch);
    const upd = db.get('eventRisks', x.id);
    ctx.audit({ action: 'event_risk_updated', entity: 'eventRisks', entityId: x.id, before, after: { likelihood: upd.likelihood, severity: upd.severity, score: upd.likelihood * upd.severity, control: upd.control }, reason: 'Aktualizacja rejestru ryzyka' });
    return { ok: true, risk: riskView(db, upd) };
  }, EV_WRITE);

  r.get('/api/events/:id/risks', (ctx) => {
    const db = ctx.db; const e = getEvent(db, ctx.params.id);
    const risks = db.col('eventRisks').filter((x) => x.eventId === e.id).map((x) => riskView(db, x)).sort((a, b) => b.score - a.score);
    return {
      risks, matrix: { likelihood: [1, 2, 3, 4, 5], severity: [1, 2, 3, 4, 5], acceptMax: evCfg(db).riskAcceptMax },
      blocking: risks.filter((x) => x.band.blocksApproval),
      categories: RISK_CATEGORIES,
      note: `Ocena to iloczyn prawdopodobieństwa i skutku w matrycy 5×5. Wynik powyżej ${evCfg(db).riskAcceptMax} jest nieakceptowalny: zagrożenie trzeba wyeliminować albo obniżyć, zanim dyrekcja zatwierdzi wydarzenie.`
    };
  }, EV_READ);

  r.post('/api/events/:id/approve', (ctx) => {
    const db = ctx.db; const e = getEvent(db, ctx.params.id);
    if (e.status === 'approved') throw httpError(409, 'To wydarzenie jest już zatwierdzone.', { code: 'already_approved' });
    if (e.status === 'closed') throw httpError(409, 'Wydarzenie jest zamknięte.', { code: 'closed' });
    const risks = db.col('eventRisks').filter((x) => x.eventId === e.id).map((x) => riskView(db, x));
    const blocking = risks.filter((x) => x.band.blocksApproval);
    if (blocking.length) {
      throw httpError(409, `Nie można zatwierdzić: ${blocking.length} ${U.plural(blocking.length, 'pozycja', 'pozycje', 'pozycji')} rejestru ryzyka w paśmie nieakceptowalnym (powyżej ${evCfg(db).riskAcceptMax} pkt). Obniż ocenę środkami zaradczymi albo wyeliminuj zagrożenie.`,
        { code: 'risk_unacceptable', blocking: blocking.map((x) => ({ id: x.id, hazard: x.hazard, score: x.score })) });
    }
    if (!risks.length) throw httpError(409, 'Rejestr ryzyka jest pusty — wydarzenie bez oceny ryzyka nie jest zatwierdzane.', { code: 'no_risk_register' });
    const rooms = (e.rooms || []).map((rm) => roomPlan(db, e, rm));
    const overFire = rooms.filter((p) => p.overFire);
    if (overFire.length) {
      throw httpError(409, `Nie można zatwierdzić: ${overFire.map((p) => `sala „${p.name}” (${p.expected} osób przy limicie ${p.fireCapacity})`).join(', ')} przekracza limit przeciwpożarowy.`, { code: 'over_fire_capacity', rooms: overFire.map((p) => p.name) });
    }
    db.update('schoolEvents', e.id, { status: 'approved', approvedBy: ctx.user.id, approvedAt: U.now() });
    const upd = db.get('schoolEvents', e.id);
    D.notify(db, e.leaderId, 'event', `Wydarzenie „${e.name}” (${U.fmtDate(e.date)}) zostało zatwierdzone.`, { link: '/wydarzenia' });
    ctx.audit({ action: 'event_approved', entity: 'schoolEvents', entityId: e.id, before: { status: e.status }, after: { status: 'approved', risks: risks.length }, reason: 'Zatwierdzenie wydarzenia przez dyrekcję' });
    return { ok: true, event: eventView(db, upd, { risks: true }), residualRisks: risks.length };
  }, EV_APPROVE);

  /* ============================================================ 3.10.11 karta przebiegu */
  r.get('/api/events/:id/run-sheet/print', (ctx) => {
    const db = ctx.db; const e = getEvent(db, ctx.params.id);
    const v = eventView(db, e, { risks: true });
    const shifts = db.col('eventShifts').filter((x) => x.eventId === e.id).map((x) => shiftView(db, x))
      .sort((a, b) => (a.date + a.start + a.station < b.date + b.start + b.station ? -1 : 1));
    const esc = D.xmlEsc;
    const cell = (s) => `<td>${esc(s)}</td>`;

    const schedule = `<h2>Harmonogram i obsada</h2><table><caption>Dyżury na stanowiskach — ${esc(v.dateLabel)}</caption><thead><tr>` +
      ['Godziny', 'Stanowisko', 'Potrzeba', 'Obsadzone', 'Osoby'].map((h) => `<th scope="col">${esc(h)}</th>`).join('') +
      `</tr></thead><tbody>${shifts.map((s) => `<tr><th scope="row">${esc(s.start + '–' + s.end)}</th>` +
        cell(s.station) + cell(String(s.needed)) + cell(`${s.filled}${s.short ? ` (brakuje ${s.short})` : ''}`) +
        cell(s.assignees.map((a) => a.name + (a.status === 'pending' ? ' — oczekuje' : '')).join(', ') || '—') + '</tr>').join('')}</tbody></table>`;

    const roomsTable = `<h2>Sale i pojemność</h2><table><caption>Plan sal, pojemność użytkowa i limit przeciwpożarowy</caption><thead><tr>` +
      ['Sala', 'Układ', 'Powierzchnia', 'Pojemność', 'Limit ppoż.', 'Przewidywana frekwencja'].map((h) => `<th scope="col">${esc(h)}</th>`).join('') +
      `</tr></thead><tbody>${v.rooms.map((rm) => `<tr><th scope="row">${esc(rm.name)}</th>` +
        cell(rm.layoutLabel) + cell(`${rm.areaM2} m²`) + cell(String(rm.capacity)) +
        cell(rm.fireCapacity == null ? '—' : String(rm.fireCapacity)) +
        cell(`${rm.expected}${rm.overCapacity ? ' — ponad pojemność' : ''}`) + '</tr>').join('')}</tbody></table>`;

    const risksTable = `<h2>Ryzyko resztkowe</h2><table><caption>Rejestr ryzyka po zastosowaniu środków zaradczych</caption><thead><tr>` +
      ['Zagrożenie', 'Kategoria', 'P', 'S', 'Ocena', 'Pasmo', 'Środek zaradczy', 'Wariant awaryjny'].map((h) => `<th scope="col">${esc(h)}</th>`).join('') +
      `</tr></thead><tbody>${(v.risks || []).map((x) => `<tr><th scope="row">${esc(x.hazard)}</th>` +
        cell(x.categoryLabel) + cell(String(x.likelihood)) + cell(String(x.severity)) + cell(String(x.score)) +
        cell(x.band.label) + cell(x.control || '—') + cell(x.fallback || '—') + '</tr>').join('')}</tbody></table>`;

    const redLines = (v.redLines || []).length
      ? `<h2>Granice nienegocjowalne</h2><ul>${v.redLines.map((x) => `<li>${esc(x)}</li>`).join('')}</ul>` : '';

    const body = `<h1>Karta przebiegu: ${esc(v.name)}</h1>` +
      `<p class="note">${esc(v.kindLabel)} · ${esc(v.dateLabel)} ${esc(v.start)}–${esc(v.end)} · organizator: ${esc(v.leader)} · status: ${esc(v.statusLabel)}</p>` +
      `<h2>Cel i miara</h2><p><b>Cel:</b> ${esc(v.objective)}</p>` + (v.outcome ? `<p><b>Zmiana po wydarzeniu:</b> ${esc(v.outcome)}</p>` : '') +
      `<p><b>Miara:</b> ${esc(v.measure)}</p>` + redLines + roomsTable + schedule + risksTable +
      `<div class="sign"><span>Organizator</span><span>Dyrektor szkoły</span></div>`;

    return {
      __raw: true, contentType: 'text/html; charset=utf-8', filename: `karta-przebiegu-${e.id}.html`,
      body: D.printHtml(`Karta przebiegu — ${v.name}`, body, {
        school: (db.data.config.school || {}).name || '', schoolMeta: (db.data.config.school || {}).address || '',
        docNo: `Wydarzenie ${e.id}`, date: U.fmtDate(v.date), printed: U.fmtDate(D.today(db))
      })
    };
  }, EV_READ);

  /* ============================================================ 3.10.12 usunięcie danych ulotnych */
  r.get('/api/events/:id/retention', (ctx) => {
    const db = ctx.db; const e = getEvent(db, ctx.params.id);
    const cfg = evCfg(db);
    const due = U.addDays(e.date, cfg.retentionDays);
    const today = D.today(db);
    return {
      eventId: e.id, event: e.name, date: e.date, retentionDays: cfg.retentionDays,
      dueOn: due, dueNow: today >= due, purgedAt: e.purgedAt || null,
      counts: {
        passes: db.col('eventPasses').filter((p) => p.eventId === e.id).length,
        scans: db.col('eventScans').filter((s) => s.eventId === e.id).length,
        dietary: db.col('eventDietary').filter((d) => d.eventId === e.id).length
      },
      keeps: ['schoolEvents', 'eventShifts', 'eventBriefings', 'eventBriefingAcks', 'eventRisks', 'eventConsents'],
      note: `Po ${cfg.retentionDays} dniach od wydarzenia znikają wejściówki, skany wejść i zgłoszenia żywieniowe. Liczby zbiorcze zostają w karcie wydarzenia, bo to one są dowodem organizacyjnym, a nie dane pojedynczych osób.`
    };
  }, EV_PURGE);

  r.post('/api/events/:id/purge', (ctx) => {
    const db = ctx.db; const e = getEvent(db, ctx.params.id);
    const b = ctx.body || {};
    if (b.confirm !== true) throw httpError(400, 'Potwierdź usunięcie danych ulotnych wydarzenia (`confirm: true`).', { code: 'no_confirm' });
    const reason = String(b.reason || '').trim();
    if (reason.length < 3) throw httpError(400, 'Podaj powód — trafi do dziennika zdarzeń.', { code: 'no_reason' });
    const cfg = evCfg(db);
    const due = U.addDays(e.date, cfg.retentionDays);
    const today = D.today(db);
    if (today < due && b.force !== true) {
      throw httpError(409, `Termin usunięcia przypada ${U.fmtDate(due)} (${cfg.retentionDays} dni po wydarzeniu). Wcześniejsze usunięcie wymaga „force”.`, { code: 'not_due', dueOn: due });
    }

    /* Liczby zbiorcze przepisujemy do karty PRZED usunięciem wierszy — po nim nie da się ich odtworzyć. */
    const passes = db.col('eventPasses').filter((p) => p.eventId === e.id);
    const scans = db.col('eventScans').filter((s) => s.eventId === e.id);
    const dietary = db.col('eventDietary').filter((d) => d.eventId === e.id);
    const byDiet = {}; const byAllergen = {};
    for (const d of dietary) { byDiet[d.diet] = (byDiet[d.diet] || 0) + 1; for (const a of d.allergens || []) byAllergen[a] = (byAllergen[a] || 0) + 1; }
    const summary = {
      passesIssued: passes.length,
      admitted: scans.filter((s) => s.status === 'ok' && s.direction === 'in').length,
      duplicates: scans.filter((s) => s.status === 'duplicate').length,
      collisions: scans.filter((s) => s.status === 'collision').length,
      dietaryDeclared: dietary.length, byDiet, byAllergen, at: U.now()
    };

    for (const p of passes.slice()) db.remove('eventPasses', p.id);
    for (const s of scans.slice()) db.remove('eventScans', s.id);
    for (const d of dietary.slice()) db.remove('eventDietary', d.id);
    db.update('schoolEvents', e.id, { status: e.status === 'closed' ? 'closed' : e.status, purgedAt: U.now(), summary });

    ctx.audit({
      action: 'event_data_purged', entity: 'schoolEvents', entityId: e.id,
      before: { passes: passes.length, scans: scans.length, dietary: dietary.length },
      after: { summary, forced: b.force === true }, reason
    });
    return {
      ok: true, removed: { passes: passes.length, scans: scans.length, dietary: dietary.length },
      summary, event: eventView(db, db.get('schoolEvents', e.id)),
      note: 'Wiersze osobowe zniknęły; w karcie wydarzenia zostały liczby zbiorcze i wiersz w dzienniku zdarzeń.'
    };
  }, EV_PURGE);

  void app;
}

module.exports = { register, LAYOUTS, ALLERGENS, DIETS, KINDS, RISK_CATEGORIES, EVENT_DEFAULTS, evCfg, ageOn, roomPlan, volunteerBlockers, riskBand, unreadBriefings, tierFor };
