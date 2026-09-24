'use strict';
/* 3.8 — moduły szkolne w jednym dzienniku: świetlica (zapis z czytnika legitymacji, upoważnieni do odbioru),
   stołówka (liczba obiadów z porannej frekwencji, blokada przy zaległości z dyskretnym powiadomieniem rodzica),
   wycieczki (karta wycieczki, zatwierdzenie przez dyrekcję, uczniowie pozostający w szkole),
   biblioteka (wypożyczenie kompletu podręczników z czytnika, rozliczenie przed świadectwami)
   oraz gabinet profilaktyki (wizyty pierwszej pomocy z ochroną danych o zdrowiu). */
const D = require('../lib/domain');
const U = require('../lib/util');
const N = require('./notifications');
const { httpError } = require('../lib/router');
const LA = require('../lib/log-access');
const { countsFor } = require('./log-comments');
const MOD = require('../modules');

const CARE_READ = { roles: ['careEducator', 'principal', 'teacher', 'registrar'] };
const CARE_WRITE = { roles: ['careEducator', 'principal'] };
const CAFE = { roles: ['cafeteria', 'principal'] };
/* GAP-5 — trasy zakładania danych modułów. Konta stołówkowe, stan biblioteki i opłaty dało się
   dotąd wypełnić wyłącznie zasiewem demo, więc w nowej szkole moduły 3.7.9, 3.7.10, 3.8.3, 3.8.4
   i 3.8.8 czytały puste kolekcje. Administrator jest tu dopuszczony obok osoby prowadzącej moduł,
   bo w małej szkole to on uruchamia dziennik. Każdy zapis zostawia wiersz audytu. */
const CAFE_SETUP = { roles: ['cafeteria', 'principal', 'admin'] };
const LIB_SETUP = { roles: ['librarian', 'principal', 'admin'] };
const FEES = { roles: ['registrar', 'admin', 'principal'] };
const TRIP_READ = { roles: ['teacher', 'principal', 'careEducator', 'registrar'] };
const TRIP_WRITE = { roles: ['teacher', 'principal'] };
const LIB_WRITE = { roles: ['librarian', 'principal'] };
const SETTLE_READ = { roles: ['librarian', 'registrar', 'admin', 'principal', 'teacher'] };
const NURSE_WRITE = { roles: ['nurse'] };

const VISIT_KIND = { otarcie: 'Otarcie lub skaleczenie', uraz: 'Uraz kończyny', zle: 'Złe samopoczucie', lek: 'Podanie leku na wniosek rodzica', inne: 'Inne zdarzenie' };
const OUTCOME = { return: 'Powrót na lekcję', home: 'Odbiór przez opiekuna', ambulance: 'Wezwano pogotowie' };
/* Pierwsze dwie lekcje wg planu dzwonków (nie `<= 2`): szkoła z godziną 0 ma poranek 0 i 1. */
function morningNos(db) { return ((db.data.config && db.data.config.lessonTimes) || []).map((t) => +t.no).filter((n) => Number.isInteger(n)).sort((a, b) => a - b).slice(0, 2); }
const MORNING_PRESENT = ['ob', 'sp'];

const sName = (s) => (s ? `${s.firstName} ${s.lastName}` : '');
const money = (v) => U.fmtAvg(Number(v || 0)) + ' zł';
const studentRef = (db, id) => { const s = db.get('students', id); return s ? { studentId: s.id, name: sName(s), label: D.studentLabel(s), classId: s.classId, rollNo: s.rollNo || null, barcode: s.barcode || null } : { studentId: id, name: id, label: id, classId: null, rollNo: null, barcode: null }; };

/** Kod z czytnika → uczeń: najpierw legitymacja cyfrowa 3.5, potem kod kreskowy z seedu 3.8. */
function studentByCode(db, code) {
  const key = String(code || '').trim().toUpperCase();
  if (!key) return null;
  const sid = db.col('studentIds').find((x) => String(x.code || '').toUpperCase() === key && x.status !== 'revoked');
  if (sid) return db.get('students', sid.studentId);
  return db.col('students').find((s) => String(s.barcode || '').toUpperCase() === key) || null;
}

/* ---------------------------------------------------------------- świetlica */
function checkinView(db, c) {
  return Object.assign(studentRef(db, c.studentId), {
    id: c.id, date: c.date, inAt: c.inAt, outAt: c.outAt || null, method: c.method,
    methodLabel: c.method === 'barcode' ? 'czytnik legitymacji' : 'lista klasy',
    byUserId: c.byUserId, by: D.userLabel(db.get('users', c.byUserId)),
    present: !c.outAt, pickupId: c.pickupId || null
  });
}
function authorizedFor(db, studentId) {
  return db.col('careAuthorizedPickups').filter((p) => p.studentId === studentId && !p.revoked);
}
function pickupValid(db, p, date) {
  if (p.revoked) return false;
  if (p.validFrom && date < p.validFrom) return false;
  if (p.validTo && date > p.validTo) return false;
  return true;
}

/* ---------------------------------------------------------------- stołówka */
function accountsOfClass(db, classId) { return db.col('cafeteriaAccounts').filter((a) => a.classId === classId && a.active !== false && a.mealPlan); }
function presentInMorning(db, studentId, date) {
  return db.col('attendance').some((a) => a.studentId === studentId && a.date === date && morningNos(db).includes(a.lessonNo) && !a.draft && MORNING_PRESENT.includes(a.status));
}
function hasMorningEntry(db, studentId, date) {
  return db.col('attendance').some((a) => a.studentId === studentId && a.date === date && morningNos(db).includes(a.lessonNo) && !a.draft);
}
function cancelledToday(db, studentId, date) { return db.col('cafeteriaCancellations').some((c) => c.studentId === studentId && c.date === date); }
function servingLine(db, acc, date) {
  const present = presentInMorning(db, acc.studentId, date);
  const entry = hasMorningEntry(db, acc.studentId, date);
  const cancelled = cancelledToday(db, acc.studentId, date);
  const serve = !acc.blocked && !cancelled && (present || !entry);
  return Object.assign(studentRef(db, acc.studentId), {
    accountId: acc.id, serve, blocked: !!acc.blocked, cancelled, presentMorning: present, morningEntry: entry,
    reason: acc.blocked ? 'brak rozliczenia konta' : cancelled ? 'obiad odwołany przez opiekuna' : (!present && entry) ? 'nieobecny rano' : null
  });
}

/* ---------------------------------------------------------------- wycieczka */
function tripView(db, t) {
  /* Lista uczestników pomija identyfikatory bez wpisu w księdze uczniów (dane z innych sekcji). */
  const participants = ((t.studentIds && t.studentIds.length) ? t.studentIds : db.col('students').filter((s) => (t.classIds || []).includes(s.classId)).map((s) => s.id)).filter((id) => db.get('students', id));
  const consents = t.consents || {};
  return {
    id: t.id, name: t.name, from: t.from, to: t.to, status: t.status,
    statusLabel: { draft: 'Wersja robocza', submitted: 'Złożona do zatwierdzenia', approved: 'Zatwierdzona' }[t.status] || t.status,
    period: U.fmtDate(t.from) + (t.to !== t.from ? ' – ' + U.fmtDate(t.to) : ''),
    leaderId: t.leaderId, leader: D.userLabel(db.get('users', t.leaderId)),
    classIds: t.classIds || [], studentIds: participants,
    students: participants.map((id) => Object.assign(studentRef(db, id), {
      groupNo: ((t.groups || {})[id]) || null,
      consent: consents[id] || null, signed: !!consents[id]
    })),
    chaperones: (t.chaperones || []).map((c) => ({ userId: c.userId, groupNo: c.groupNo, name: D.userLabel(db.get('users', c.userId)) })),
    insurance: t.insurance || null, transport: t.transport || null, cost: t.cost != null ? t.cost : null,
    schedule: t.schedule || [], consents,
    consentCount: Object.keys(consents).length, participantCount: participants.length,
    nonParticipants: t.nonParticipants || {},
    approvedBy: t.approvedBy ? D.userLabel(db.get('users', t.approvedBy)) : null, approvedAt: t.approvedAt || null,
    days: (() => { const out = []; for (let d = t.from; d <= t.to; d = U.addDays(d, 1)) out.push(d); return out; })()
  };
}
/** S-17: kto prowadzi kartę wycieczki. `allowApproved` zostawia otwarte te czynności, które po
    zatwierdzeniu wyjazdu dopiero się zaczynają (opieka nad uczniami pozostającymi w szkole). */
function assertTripEditable(ctx, t, opts) {
  if (ctx.user.role !== 'principal' && t.leaderId !== ctx.user.id && !(t.chaperones || []).some((c) => c.userId === ctx.user.id)) {
    throw httpError(403, 'Kartę wycieczki prowadzi jej kierownik (albo opiekun wpisany do karty).', { code: 'not_trip_leader' });
  }
  if (t.status === 'approved' && !(opts && opts.allowApproved)) throw httpError(409, 'Wycieczka jest zatwierdzona — zmiany wprowadza dyrekcja.', { code: 'approved' });
}

/* ---------------------------------------------------------------- biblioteka */
function loanView(db, l) {
  return Object.assign(studentRef(db, l.studentId), {
    id: l.id, title: l.title, author: l.author || '', barcode: l.barcode || null, itemId: l.itemId || null,
    loanedAt: l.loanedAt, dueDate: l.dueDate || null, returnedAt: l.returnedAt || null,
    open: !l.returnedAt, by: D.userLabel(db.get('users', l.byUserId))
  });
}
function settlementOf(db, studentId) {
  const open = db.col('libraryLoans').filter((l) => l.studentId === studentId && !l.returnedAt);
  const today = D.today(db);
  return Object.assign(studentRef(db, studentId), {
    settled: open.length === 0,
    outstanding: open.map((l) => ({ id: l.id, title: l.title, barcode: l.barcode || null, dueDate: l.dueDate || null, overdue: !!(l.dueDate && l.dueDate < today) })),
    outstandingCount: open.length,
    detail: open.length ? `${open.length} ${U.plural(open.length, 'pozycja', 'pozycje', 'pozycji')}: ${open.map((l) => '„' + l.title + '”').join(', ')}` : 'komplet zwrócony',
    certificateBlocked: open.length > 0
  });
}

/* ---------------------------------------------------------------- gabinet */
function canReadHealth(db, user, studentId) {
  if (user.role === 'nurse') return true;
  if (user.role === 'parent') return (user.childrenIds || []).includes(studentId);
  return false;
}
function visitView(db, v) {
  return Object.assign(studentRef(db, v.studentId), {
    id: v.id, no: v.no || null, date: v.date, time: v.time, kind: v.kind, kindLabel: VISIT_KIND[v.kind] || v.kind,
    description: v.description, aid: v.aid || '', outcome: v.outcome || 'return', outcomeLabel: OUTCOME[v.outcome] || v.outcome,
    nurse: D.userLabel(db.get('users', v.byUserId)), parentNotified: !!v.parentNotified, parentNotifiedAt: v.parentNotifiedAt || null, at: v.at,
    readers: 'pielęgniarka i opiekunowie ucznia',
    legalBasis: 'art. 9 ust. 2 lit. h RODO — dane o zdrowiu; wpis nie trafia do dziennika lekcyjnego ani do eksportów.'
  });
}
function logHealthAccess(ctx, visitId, studentId, allowed) {
  ctx.db.insert('nurseVisitAccessLog', { id: U.id('hlog'), visitId, studentId, userId: ctx.user.id, role: ctx.user.role, at: U.now(), allowed, ip: ctx.ip || null });
  ctx.audit({ action: allowed ? 'health_record_read' : 'health_record_denied', entity: 'nurseVisits', entityId: visitId || studentId, after: { studentId, role: ctx.user.role, allowed }, reason: allowed ? 'Wgląd w dokumentację gabinetu' : 'Odmowa: dane o zdrowiu poza kręgiem uprawnionych' });
}

/* ---------------------------------------------------------------- GAP-5: zakładanie danych */
/** Rodzaje opłat, które rozpoznaje konto rodzica (`PAYMENT_LABEL` w routes/parent.js). */
const FEE_KINDS = ['lunch', 'council', 'trip', 'other'];
/** Rodzaje pozycji bibliotecznych. `textbook` (komplet podręczników) to domyślny. */
const LIBRARY_KINDS = ['textbook', 'book', 'reading', 'other'];
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
/** Kwota w złotych: dwa miejsca po przecinku, nigdy ujemna, przecinek dziesiętny dopuszczalny. */
function money2(v, label) {
  const n = Number(String(v == null ? '' : v).replace(',', '.'));
  if (!Number.isFinite(n) || n < 0) throw httpError(400, `${label} musi być liczbą nieujemną.`, { code: 'bad_amount' });
  return Math.round(n * 100) / 100;
}
function cafeteriaAccountView(db, a) {
  return Object.assign(studentRef(db, a.studentId), {
    id: a.id, mealPlan: a.mealPlan, mealPrice: a.mealPrice, mealPriceText: money(a.mealPrice),
    balance: a.balance, balanceText: money(a.balance), period: a.period, active: a.active !== false,
    blocked: !!a.blocked, currency: a.currency || 'PLN'
  });
}
function libraryItemView(db, i) {
  return Object.assign({}, i, { subject: (db.get('subjects', i.subjectId) || {}).name || i.subjectId || null });
}
/** CSV stanu biblioteki: `barcode;title;kind` (+ opcjonalnie author;subject;level;set). */
const LIBRARY_COLUMNS = ['barcode', 'title', 'kind', 'author', 'subject', 'level', 'set'];
function parseLibraryCsv(text) {
  const lines = String(text || '').replace(/^﻿/, '').split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  const rows = [], errors = [];
  if (!lines.length) return { rows, errors: [{ line: 0, error: 'Wklejony tekst jest pusty — skopiuj arkusz razem z wierszem nagłówka.', code: 'empty_csv' }] };
  let header = LIBRARY_COLUMNS, start = 0;
  const first = lines[0].split(';').map((c) => c.trim().toLowerCase());
  if (first[0] === 'barcode' || first[0] === 'kod') { header = first.map((c) => ({ kod: 'barcode', 'tytuł': 'title', tytul: 'title', rodzaj: 'kind', autor: 'author', przedmiot: 'subject', poziom: 'level', komplet: 'set' }[c] || c)); start = 1; }
  lines.slice(start).forEach((l, i) => {
    const line = i + start + 1;
    const cells = l.split(';').map((c) => c.trim().replace(/^"|"$/g, ''));
    if (cells.length < 2) { errors.push({ line, error: 'Oczekiwano co najmniej kolumn barcode;title — popraw wiersz, zanim go zaimportujesz.', code: 'column_count', actual: cells.length }); return; }
    const o = { _line: line };
    header.forEach((hname, k) => { if (cells[k] !== undefined) o[hname] = cells[k]; });
    rows.push(o);
  });
  return { rows, errors };
}
/** Wspólna walidacja pozycji biblioteki (formularz i import) — zwraca dokument bez `id`. */
function validateLibraryItem(db, b) {
  const barcode = String(b.barcode || '').trim();
  if (!barcode) throw httpError(400, 'Podaj kod kreskowy pozycji.', { code: 'no_barcode' });
  if (barcode.length > 40) throw httpError(400, 'Kod kreskowy jest za długi (maksymalnie 40 znaków).', { code: 'barcode_too_long' });
  const title = String(b.title || '').trim();
  if (!title) throw httpError(400, 'Podaj tytuł pozycji.', { code: 'no_title' });
  const kindRaw = String(b.kind || 'textbook').trim();
  const kind = LIBRARY_KINDS.includes(kindRaw) ? kindRaw : null;
  if (!kind) throw httpError(400, `Rodzaj pozycji: ${LIBRARY_KINDS.join(', ')}.`, { code: 'bad_kind', kind: kindRaw });
  const subjectId = String(b.subjectId || b.subject || '').trim() || null;
  if (subjectId && !db.get('subjects', subjectId)) throw httpError(400, `Nie ma przedmiotu o identyfikatorze „${subjectId}”.`, { code: 'unknown_subject', subjectId });
  const levelRaw = b.level === '' || b.level == null ? null : Number(b.level);
  if (levelRaw != null && (!Number.isInteger(levelRaw) || levelRaw < 1 || levelRaw > 8)) throw httpError(400, 'Poziom klasy musi być liczbą od 1 do 8.', { code: 'bad_level', level: b.level });
  return {
    barcode, title, kind, author: String(b.author || '').trim(), subjectId, level: levelRaw,
    setName: String(b.setName || b.set || '').trim() || null, status: 'available', studentId: null
  };
}

function register(r, app) {
  /* ================================================================ komentarze do rejestru wglądów (lib/log-access)
     Ta sama bramka, co w GET /api/modules/nurse/access-log: moduł „school” włączony i rola z listy. */
  LA.register('nurse-access-log', { label: 'Rejestr wglądów do dokumentacji gabinetu', roles: ['nurse', 'dpo', 'principal'], find: (db, user, entryId) => {
    if (!MOD.isEnabled(db, 'school')) return null;
    const x = db.get('nurseVisitAccessLog', entryId);
    return x ? { id: x.id, at: x.at, visitId: x.visitId || null, studentId: x.studentId || null, allowed: !!x.allowed } : null;
  } });

  /* ================================================================ zakładki dostępne dla roli */
  r.get('/api/modules/tabs', (ctx) => {
    const role = ctx.user.role;
    const all = [
      { id: 'swietlica', label: 'Świetlica', roles: ['careEducator', 'principal'] },
      { id: 'stolowka', label: 'Stołówka', roles: ['cafeteria', 'principal'] },
      { id: 'wycieczka', label: 'Wycieczka', roles: ['teacher', 'principal', 'careEducator'] },
      { id: 'biblioteka', label: 'Biblioteka', roles: ['librarian', 'principal', 'registrar', 'teacher'] },
      { id: 'gabinet', label: 'Gabinet', roles: ['nurse', 'principal'] }
    ];
    /* Pierwsza zakładka to moduł prowadzony przez tę rolę — reszta jest tylko do wglądu. */
    const PRIMARY = { careEducator: 'swietlica', cafeteria: 'stolowka', teacher: 'wycieczka', principal: 'swietlica', librarian: 'biblioteka', registrar: 'biblioteka', nurse: 'gabinet' };
    const mine = all.filter((t) => t.roles.includes(role));
    mine.sort((a, b) => (a.id === PRIMARY[role] ? -1 : 0) - (b.id === PRIMARY[role] ? -1 : 0));
    return { role, primary: PRIMARY[role] || (mine[0] && mine[0].id) || null, tabs: mine.map((t) => ({ id: t.id, label: t.label })), today: D.today(ctx.db) };
  }, { roles: ['careEducator', 'cafeteria', 'librarian', 'nurse', 'teacher', 'principal', 'registrar'] });

  /* ================================================================ 3.8.1 zapis do świetlicy */
  r.get('/api/modules/care/roster', (ctx) => {
    const db = ctx.db; const date = ctx.query.date || D.today(db);
    const classId = ctx.query.classId || null;
    const students = db.col('students').filter((s) => s.status !== 'removed' && (!classId || s.classId === classId));
    const checkins = db.col('careCheckins').filter((c) => c.date === date);
    return {
      date, classId,
      classes: db.col('classes').map((c) => ({ id: c.id, name: c.name, students: (c.studentIds || []).length })),
      students: students.map((s) => {
        const c = checkins.find((x) => x.studentId === s.id);
        return Object.assign(studentRef(db, s.id), { checkedIn: !!c && !c.outAt, checkinId: c ? c.id : null, inAt: c ? c.inAt : null, outAt: c ? c.outAt || null : null });
      }).sort((a, b) => (a.classId + String(a.rollNo).padStart(3, '0')).localeCompare(b.classId + String(b.rollNo).padStart(3, '0'), 'pl')),
      present: checkins.filter((c) => !c.outAt).length,
      openUntil: db.data.config.careOpenUntil || '17:00'
    };
  }, CARE_READ);

  r.post('/api/modules/care/checkin', (ctx) => {
    const db = ctx.db; const b = ctx.body || {}; const date = String(b.date || D.today(db)).slice(0, 10);
    let s = null; let method = 'roster';
    if (b.barcode) {
      s = studentByCode(db, b.barcode); method = 'barcode';
      if (!s) throw httpError(404, `Nie znaleziono legitymacji „${String(b.barcode).trim()}”. Sprawdź kod albo odszukaj ucznia na liście klasy.`, { code: 'unknown_barcode' });
    } else if (b.studentId) {
      s = db.get('students', b.studentId);
      if (!s) throw httpError(404, 'Nie ma takiego ucznia.');
    } else throw httpError(400, 'Podaj kod legitymacji albo wybierz ucznia z listy klasy.', { code: 'no_student' });
    const open = db.one('careCheckins', (c) => c.studentId === s.id && c.date === date && !c.outAt);
    if (open) throw httpError(409, `${sName(s)} jest już zapisany w świetlicy (wejście ${open.inAt}).`, { code: 'already_checked_in', checkinId: open.id });
    const inAt = /^\d{2}:\d{2}$/.test(String(b.at || '')) ? String(b.at) : D.schoolNow(db).time;
    const row = db.insert('careCheckins', {
      id: U.id('care'), studentId: s.id, classId: s.classId, date, inAt, outAt: null,
      method, code: method === 'barcode' ? String(b.barcode).trim().toUpperCase() : null,
      byUserId: ctx.user.id, at: U.now(), pickupId: null
    });
    ctx.audit({ action: 'care_checkin', entity: 'careCheckins', entityId: row.id, after: { studentId: s.id, date, inAt, method }, reason: 'Zapis do świetlicy' });
    return {
      ok: true, checkin: checkinView(db, row), method,
      present: db.col('careCheckins').filter((c) => c.date === date && !c.outAt).length,
      confirmation: `Zapisano: ${D.studentLabel(s)} (${s.classId}) · wejście ${inAt} · ${method === 'barcode' ? 'czytnik legitymacji' : 'lista klasy'}.`
    };
  }, CARE_WRITE);

  r.get('/api/modules/care/checkins', (ctx) => {
    const db = ctx.db; const date = ctx.query.date || D.today(db);
    const rows = db.col('careCheckins').filter((c) => c.date === date).map((c) => checkinView(db, c));
    return { date, checkins: rows, present: rows.filter((c) => c.present).length, released: rows.filter((c) => !c.present).length };
  }, CARE_READ);

  /* ================================================================ 3.8.2 odbiór dziecka */
  r.get('/api/modules/care/pickups', (ctx) => {
    const db = ctx.db; const date = ctx.query.date || D.today(db);
    const studentId = ctx.query.studentId || null;
    const checkins = db.col('careCheckins').filter((c) => c.date === date && (!studentId || c.studentId === studentId));
    return {
      date,
      authorized: (studentId ? authorizedFor(db, studentId) : db.col('careAuthorizedPickups').filter((p) => !p.revoked)).map((p) => Object.assign(studentRef(db, p.studentId), {
        pickupId: p.id, person: p.name, relation: p.relation, note: p.validTo ? 'upoważnienie do ' + U.fmtDate(p.validTo) : 'upoważnienie stałe',
        validTo: p.validTo || null, valid: pickupValid(db, p, date), idNote: p.idNote || null
      })),
      inCare: checkins.filter((c) => !c.outAt).map((c) => checkinView(db, c)),
      log: db.col('carePickups').filter((p) => p.date === date).sort((a, b) => (a.at < b.at ? 1 : -1)).map((p) => Object.assign(studentRef(db, p.studentId), {
        id: p.id, at: p.at, time: p.time, person: p.person, relation: p.relation, pickupId: p.pickupId,
        by: D.userLabel(db.get('users', p.byUserId)), note: p.note || ''
      }))
    };
  }, CARE_READ);

  r.post('/api/modules/care/pickup', (ctx) => {
    const db = ctx.db; const b = ctx.body || {}; const date = String(b.date || D.today(db)).slice(0, 10);
    const s = db.get('students', b.studentId); if (!s) throw httpError(404, 'Nie ma takiego ucznia.');
    const checkin = db.one('careCheckins', (c) => c.studentId === s.id && c.date === date && !c.outAt);
    if (!checkin) throw httpError(409, `${sName(s)} nie jest obecnie zapisany w świetlicy.`, { code: 'not_in_care' });
    const list = authorizedFor(db, s.id);
    const p = b.pickupId ? list.find((x) => x.id === b.pickupId) : list.find((x) => String(x.name || '').toLowerCase() === String(b.person || '').toLowerCase());
    if (!p) throw httpError(403, `Osoba wskazana do odbioru nie figuruje na liście upoważnionych dla ucznia ${sName(s)}. Dziecka nie wydajemy.`, { code: 'not_authorized' });
    if (!pickupValid(db, p, date)) throw httpError(403, `Upoważnienie dla „${p.name}” straciło ważność ${U.fmtDate(p.validTo)}.`, { code: 'authorization_expired' });
    const time = /^\d{2}:\d{2}$/.test(String(b.at || '')) ? String(b.at) : D.schoolNow(db).time;
    const at = U.now();
    checkin.outAt = time; checkin.pickupId = p.id; db.save();
    const row = db.insert('carePickups', {
      id: U.id('pick'), studentId: s.id, classId: s.classId, checkinId: checkin.id, date, time, at,
      pickupId: p.id, person: p.name, relation: p.relation, identityCheck: String(b.identityCheck || 'Tożsamość potwierdzona na miejscu').slice(0, 200),
      byUserId: ctx.user.id, note: String(b.note || '').slice(0, 300)
    });
    ctx.audit({ action: 'care_pickup', entity: 'carePickups', entityId: row.id, after: { studentId: s.id, person: p.name, relation: p.relation, time, at }, reason: 'Wydanie dziecka ze świetlicy osobie upoważnionej' });
    D.notifyParentsOf(db, s.id, 'swietlica', `${sName(s)} odebrany ze świetlicy o ${time} przez: ${p.name} (${p.relation}).`, { link: '/rodzic?studentId=' + s.id });
    return {
      ok: true, pickup: Object.assign(studentRef(db, s.id), { id: row.id, time, at, person: p.name, relation: p.relation }),
      checkin: checkinView(db, checkin),
      confirmation: `Wydano ${sName(s)} o ${time} · ${p.name} (${p.relation}). Zapisano godzinę i tożsamość osoby odbierającej.`
    };
  }, CARE_WRITE);

  /* ================================================================ 3.8.3 liczba obiadów z porannej frekwencji */
  r.get('/api/modules/cafeteria/meal-report', (ctx) => {
    const db = ctx.db; const date = ctx.query.date || D.today(db);
    const rows = db.col('classes').map((c) => {
      const accounts = accountsOfClass(db, c.id);
      const lines = accounts.map((a) => servingLine(db, a, date));
      return {
        classId: c.id, className: c.name,
        enrolled: accounts.length,
        presentMorning: lines.filter((l) => l.presentMorning).length,
        absentMorning: lines.filter((l) => l.morningEntry && !l.presentMorning).length,
        cancelled: lines.filter((l) => l.cancelled).length,
        blocked: lines.filter((l) => l.blocked).length,
        portions: lines.filter((l) => l.serve).length
      };
    }).filter((x) => x.enrolled > 0);
    const sum = (k) => rows.reduce((n, x) => n + x[k], 0);
    return {
      date, dateLabel: U.fmtDate(date), rows,
      totals: { enrolled: sum('enrolled'), presentMorning: sum('presentMorning'), absentMorning: sum('absentMorning'), cancelled: sum('cancelled'), blocked: sum('blocked'), portions: sum('portions') },
      mealPrice: db.data.config.mealPrice, value: Math.round(sum('portions') * db.data.config.mealPrice * 100) / 100,
      source: 'poranna frekwencja z dziennika (1.–2. lekcja, statusy „ob” i „sp”) skrzyżowana z kontami stołówkowymi',
      note: 'Raport liczy porcje dla uczniów z aktywną umową obiadową, obecnych rano, bez odwołanych obiadów i bez kont zablokowanych.'
    };
  }, CAFE);

  /* ================================================================ 3.8.4 blokada przy zaległości */
  r.get('/api/modules/cafeteria/accounts', (ctx) => {
    const db = ctx.db; const onlyOverdue = ctx.query.overdue === '1';
    const rows = db.col('cafeteriaAccounts').filter((a) => (onlyOverdue ? a.balance < 0 : true)).map((a) => Object.assign(studentRef(db, a.studentId), {
      id: a.id, balance: a.balance, balanceText: money(a.balance), debt: a.balance < 0 ? -a.balance : 0, debtText: money(a.balance < 0 ? -a.balance : 0),
      period: a.period, overdue: a.balance < 0, overdueSince: a.overdueSince || null,
      blocked: !!a.blocked, blockedAt: a.blockedAt || null, blockReason: a.blockReason || null,
      mealPlan: a.mealPlan, active: a.active !== false,
      parents: (a.parentUserIds || []).map((id) => D.userLabel(db.get('users', id))).filter(Boolean)
    })).sort((a, b) => a.balance - b.balance);
    return {
      accounts: rows, overdueCount: rows.filter((x) => x.overdue).length, blockedCount: rows.filter((x) => x.blocked).length,
      /* Ekran zakładania kont (GAP-5) potrzebuje listy oddziałów, a rola „stołówka” nie czyta
         listy świetlicy — dokładamy ją tutaj zamiast otwierać jej cudzą trasę. */
      classes: db.col('classes').map((c) => ({ id: c.id, name: c.name, students: (c.studentIds || []).length, withAccount: db.col('cafeteriaAccounts').filter((a) => a.classId === c.id).length })),
      mealPrice: db.data.config.mealPrice || 0
    };
  }, CAFE);

  /* ---- GAP-5: konto stołówkowe zakłada się w aplikacji ---------------------------------
     Pojedynczemu uczniowi (`studentId`) albo całemu oddziałowi (`classId`) naraz — z planem
     posiłku i ceną. Uczeń, który konto już ma, nie dostaje drugiego: jest liczony w `skipped`. */
  r.post('/api/modules/cafeteria/accounts', (ctx) => {
    const db = ctx.db; const b = ctx.body || {};
    const cfg = db.data.config;
    const mealPlan = String(b.mealPlan == null ? 'obiad' : b.mealPlan).trim();
    if (!mealPlan) throw httpError(400, 'Podaj plan posiłku (np. „obiad”) albo załóż konto nieaktywne.', { code: 'no_meal_plan' });
    const mealPrice = money2(b.mealPrice == null ? cfg.mealPrice : b.mealPrice, 'Cena posiłku');
    const period = String(b.period || '').trim() || U.fmtDate(D.today(db)).slice(3);
    let students;
    if (b.studentId) {
      const s = db.get('students', b.studentId); if (!s) throw httpError(404, 'Nie ma takiego ucznia.');
      students = [s];
    } else if (b.classId) {
      const cls = db.get('classes', b.classId); if (!cls) throw httpError(404, 'Nie ma takiej klasy.');
      students = (cls.studentIds || []).map((id) => db.get('students', id)).filter((s) => s && s.status !== 'removed');
      if (!students.length) throw httpError(400, 'W tej klasie nie ma uczniów, dla których można założyć konto.', { code: 'no_students' });
    } else throw httpError(400, 'Wskaż ucznia (`studentId`) albo oddział (`classId`).', { code: 'no_target' });
    const created = [], skipped = [];
    for (const s of students) {
      const existing = db.one('cafeteriaAccounts', (a) => a.studentId === s.id);
      if (existing) { skipped.push({ studentId: s.id, accountId: existing.id, reason: 'already_exists' }); continue; }
      created.push(db.insert('cafeteriaAccounts', {
        id: U.id('caf'), studentId: s.id, classId: s.classId, parentUserIds: (s.parentIds || []).slice(),
        mealPlan, active: b.active !== false, mealPrice, balance: money2(b.balance == null ? 0 : b.balance, 'Saldo'),
        currency: 'PLN', period, overdueSince: null, blocked: false, blockedAt: null, blockedByUserId: null,
        blockReason: null, entries: [], createdAt: U.now()
      }));
    }
    ctx.audit({
      action: 'cafeteria_accounts_created', entity: 'cafeteriaAccounts', entityId: b.classId || b.studentId,
      before: null, after: { created: created.length, skipped: skipped.length, mealPlan, mealPrice, period },
      reason: b.reason || 'Założenie kont stołówkowych'
    });
    return {
      ok: true, created: created.length, skipped: skipped.length, skippedRows: skipped,
      accounts: created.map((a) => cafeteriaAccountView(db, a)),
      confirmation: `Założono ${created.length} ${U.plural(created.length, 'konto stołówkowe', 'konta stołówkowe', 'kont stołówkowych')} (plan: ${mealPlan}, cena ${money(mealPrice)}).`
    };
  }, CAFE_SETUP);

  /** Zmiana planu, ceny, okresu rozliczeniowego albo salda konta stołówkowego. */
  r.patch('/api/modules/cafeteria/accounts/:id', (ctx) => {
    const db = ctx.db; const b = ctx.body || {};
    const acc = db.get('cafeteriaAccounts', ctx.params.id);
    if (!acc) throw httpError(404, 'Nie ma takiego konta stołówkowego.');
    const before = { mealPlan: acc.mealPlan, mealPrice: acc.mealPrice, period: acc.period, active: acc.active !== false, balance: acc.balance };
    const patch = {};
    if (b.mealPlan !== undefined) { const v = String(b.mealPlan || '').trim(); if (!v) throw httpError(400, 'Plan posiłku nie może być pusty.', { code: 'no_meal_plan' }); patch.mealPlan = v; }
    if (b.mealPrice !== undefined) patch.mealPrice = money2(b.mealPrice, 'Cena posiłku');
    if (b.period !== undefined) patch.period = String(b.period || '').trim();
    if (b.active !== undefined) patch.active = !!b.active;
    if (b.balance !== undefined) {
      /* Saldo bywa ujemne (zaległość) — tu jedyne miejsce, gdzie ujemna kwota jest poprawna. */
      const n = Number(String(b.balance).replace(',', '.'));
      if (!Number.isFinite(n)) throw httpError(400, 'Saldo musi być liczbą.', { code: 'bad_amount' });
      patch.balance = Math.round(n * 100) / 100;
      patch.overdueSince = patch.balance < 0 ? (acc.overdueSince || D.today(db)) : null;
    }
    if (!Object.keys(patch).length) throw httpError(400, 'Nie podano żadnej zmiany.', { code: 'nothing_to_change' });
    db.update('cafeteriaAccounts', acc.id, patch);
    const after = db.get('cafeteriaAccounts', acc.id);
    ctx.audit({ action: 'cafeteria_account_update', entity: 'cafeteriaAccounts', entityId: acc.id, before, after: patch, reason: b.reason || null });
    return { ok: true, account: cafeteriaAccountView(db, after) };
  }, CAFE_SETUP);

  r.post('/api/modules/cafeteria/accounts/:id/block', (ctx) => {
    const db = ctx.db; const acc = db.get('cafeteriaAccounts', ctx.params.id);
    if (!acc) throw httpError(404, 'Nie ma takiego konta stołówkowego.');
    if (acc.balance >= 0) throw httpError(400, 'Konto nie ma zaległości — nie blokujemy wydawania posiłków.', { code: 'no_debt' });
    if (acc.blocked) throw httpError(409, 'Wydawanie posiłków na tym koncie jest już wstrzymane.', { code: 'already_blocked' });
    const s = db.get('students', acc.studentId);
    const before = { blocked: false };
    acc.blocked = true; acc.blockedAt = U.now(); acc.blockedByUserId = ctx.user.id;
    acc.blockReason = String((ctx.body || {}).reason || `Zaległość ${money(-acc.balance)} za ${acc.period}`).slice(0, 200);
    db.save();
    /* Dyskrecja: informujemy wyłącznie opiekunów w aplikacji. Uczeń nie dostaje żadnego powiadomienia
       i nie widzi powodu przy okienku — na liście wydawania jest tylko informacja dla obsługi. */
    const parents = (s ? (s.parentIds || []).filter((p) => { const st = D.guardianStanding(db, p, s.id); return st.ok && D.guardianKindAllowed(st.scope, 'cafeteria'); })   // F1: legitymacja opiekuna
      : (acc.parentUserIds || []));
    const notified = [];
    for (const p of parents) {
      const n = N.createNotification(db, p, 'cafeteria', `Konto obiadowe dziecka wymaga uregulowania: ${money(-acc.balance)} (${acc.period}). Do czasu wpłaty wydawanie posiłków jest wstrzymane. Wiadomość jest widoczna wyłącznie dla opiekunów.`, { link: '/rodzic?studentId=' + acc.studentId });
      if (n) notified.push(p);
    }
    ctx.audit({ action: 'cafeteria_blocked', entity: 'cafeteriaAccounts', entityId: acc.id, before, after: { blocked: true, debt: -acc.balance, parentsNotified: notified.length }, reason: acc.blockReason });
    return {
      ok: true, accountId: acc.id, studentId: acc.studentId, blocked: true, blockedAt: acc.blockedAt, reason: acc.blockReason,
      parentsNotified: notified.length, parentUserIds: notified, studentNotified: false, discreet: true,
      confirmation: 'Wydawanie wstrzymane. Powiadomienie trafiło wyłącznie do opiekunów w aplikacji — przy okienku nie podajemy powodu.'
    };
  }, CAFE);

  r.post('/api/modules/cafeteria/accounts/:id/unblock', (ctx) => {
    const db = ctx.db; const acc = db.get('cafeteriaAccounts', ctx.params.id);
    if (!acc) throw httpError(404, 'Nie ma takiego konta stołówkowego.');
    const before = { blocked: !!acc.blocked };
    acc.blocked = false; acc.blockedAt = null; acc.blockReason = null; db.save();
    ctx.audit({ action: 'cafeteria_unblocked', entity: 'cafeteriaAccounts', entityId: acc.id, before, after: { blocked: false }, reason: (ctx.body || {}).reason || 'Zaległość uregulowana' });
    return { ok: true, accountId: acc.id, blocked: false };
  }, CAFE);

  r.get('/api/modules/cafeteria/serving-list', (ctx) => {
    const db = ctx.db; const date = ctx.query.date || D.today(db);
    const classId = ctx.query.classId || null;
    const rows = db.col('cafeteriaAccounts').filter((a) => a.active !== false && a.mealPlan && (!classId || a.classId === classId)).map((a) => servingLine(db, a, date));
    return {
      date, rows, portions: rows.filter((x) => x.serve).length,
      note: 'Lista wydawania nie pokazuje kwot ani powodów uczniowi — powód blokady widzi wyłącznie obsługa stołówki.'
    };
  }, CAFE);

  /* ================================================================ 3.8.5 karta wycieczki */
  r.get('/api/modules/trips', (ctx) => {
    const db = ctx.db;
    const rows = db.col('trips').map((t) => tripView(db, t)).sort((a, b) => (a.from < b.from ? -1 : 1));
    return { trips: ctx.query.mine === '1' ? rows.filter((t) => t.leaderId === ctx.user.id) : rows };
  }, TRIP_READ);

  r.get('/api/modules/trips/:id', (ctx) => {
    const t = ctx.db.get('trips', ctx.params.id); if (!t) throw httpError(404, 'Nie ma takiej wycieczki.');
    return { trip: tripView(ctx.db, t) };
  }, TRIP_READ);

  r.post('/api/modules/trips', (ctx) => {
    const db = ctx.db; const b = ctx.body || {};
    const name = String(b.name || '').trim(); if (name.length < 3) throw httpError(400, 'Podaj cel (nazwę) wycieczki.', { code: 'no_name' });
    const from = String(b.from || '').slice(0, 10); const to = String(b.to || from).slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to) || to < from) throw httpError(400, 'Podaj poprawny termin wycieczki (od–do).', { code: 'bad_dates' });
    const classIds = Array.isArray(b.classIds) ? b.classIds.filter((c) => db.get('classes', c)) : [];
    if (!classIds.length) throw httpError(400, 'Wskaż co najmniej jedną klasę uczestniczącą.', { code: 'no_class' });
    const ins = b.insurance || {};
    if (!String(ins.insurer || '').trim() || !String(ins.policyNo || '').trim()) throw httpError(400, 'Karta wycieczki wymaga danych ubezpieczenia: nazwy ubezpieczyciela i numeru polisy.', { code: 'no_insurance' });
    const studentIds = Array.isArray(b.studentIds) && b.studentIds.length
      ? b.studentIds.filter((id) => { const s = db.get('students', id); return s && classIds.includes(s.classId); })
      : db.col('students').filter((s) => classIds.includes(s.classId)).map((s) => s.id);
    const chaperones = (Array.isArray(b.chaperones) ? b.chaperones : []).map((c, i) => ({ userId: c.userId, groupNo: +c.groupNo || i + 1 })).filter((c) => db.get('users', c.userId));
    if (!chaperones.some((c) => c.userId === ctx.user.id)) chaperones.unshift({ userId: ctx.user.id, groupNo: 1 });
    const groups = {};
    for (const [sid, g] of Object.entries(b.groups || {})) if (studentIds.includes(sid)) groups[sid] = +g || 1;
    const t = db.insert('trips', {
      id: U.id('trip'), name, from, to, leaderId: b.leaderId && db.get('users', b.leaderId) ? b.leaderId : ctx.user.id,
      classIds, studentIds, chaperones, groups,
      insurance: { insurer: String(ins.insurer).trim(), policyNo: String(ins.policyNo).trim(), validFrom: ins.validFrom || from, validTo: ins.validTo || to },
      transport: String(b.transport || '').slice(0, 200) || null, cost: b.cost != null ? Number(b.cost) : null, costDue: b.costDue || null,
      schedule: (Array.isArray(b.schedule) ? b.schedule : []).map((x) => ({ day: String(x.day || from).slice(0, 10), text: String(x.text || '').slice(0, 500) })),
      status: 'draft', consents: {}, nonParticipants: {}
    });
    ctx.audit({ action: 'trip_created', entity: 'trips', entityId: t.id, after: { name, from, to, classIds, students: studentIds.length, insurance: t.insurance }, reason: 'Karta wycieczki' });
    return { ok: true, trip: tripView(db, t) };
  }, TRIP_WRITE);

  r.patch('/api/modules/trips/:id', (ctx) => {
    const db = ctx.db; const t = db.get('trips', ctx.params.id); if (!t) throw httpError(404, 'Nie ma takiej wycieczki.');
    assertTripEditable(ctx, t);
    const b = ctx.body || {}; const before = { name: t.name, schedule: t.schedule, chaperones: t.chaperones, groups: t.groups, insurance: t.insurance };
    if (b.name) t.name = String(b.name).trim();
    if (b.transport !== undefined) t.transport = String(b.transport || '').slice(0, 200) || null;
    if (b.cost !== undefined) t.cost = b.cost == null ? null : Number(b.cost);
    if (Array.isArray(b.schedule)) t.schedule = b.schedule.map((x) => ({ day: String(x.day || t.from).slice(0, 10), text: String(x.text || '').slice(0, 500) }));
    if (Array.isArray(b.chaperones)) t.chaperones = b.chaperones.map((c, i) => ({ userId: c.userId, groupNo: +c.groupNo || i + 1 })).filter((c) => db.get('users', c.userId));
    if (b.insurance) t.insurance = Object.assign({}, t.insurance, { insurer: String(b.insurance.insurer || (t.insurance || {}).insurer || '').trim(), policyNo: String(b.insurance.policyNo || (t.insurance || {}).policyNo || '').trim() });
    if (b.groups) { t.groups = t.groups || {}; for (const [sid, g] of Object.entries(b.groups)) if ((t.studentIds || []).includes(sid)) t.groups[sid] = +g || 1; }
    if (Array.isArray(b.studentIds)) t.studentIds = b.studentIds.filter((id) => { const s = db.get('students', id); return s && (t.classIds || []).includes(s.classId); });
    db.save();
    ctx.audit({ action: 'trip_updated', entity: 'trips', entityId: t.id, before, after: { name: t.name, chaperones: t.chaperones, groups: t.groups, insurance: t.insurance } });
    return { ok: true, trip: tripView(db, t) };
  }, TRIP_WRITE);

  r.post('/api/modules/trips/:id/submit', (ctx) => {
    const db = ctx.db; const t = db.get('trips', ctx.params.id); if (!t) throw httpError(404, 'Nie ma takiej wycieczki.');
    assertTripEditable(ctx, t);
    if (t.status === 'submitted') throw httpError(409, 'Karta wycieczki została już złożona do zatwierdzenia.', { code: 'already_submitted' });
    if (!t.insurance || !t.insurance.policyNo) throw httpError(400, 'Przed złożeniem uzupełnij dane ubezpieczenia.', { code: 'no_insurance' });
    if (!(t.chaperones || []).length) throw httpError(400, 'Przed złożeniem przypisz opiekunów do grup.', { code: 'no_chaperones' });
    t.status = 'submitted'; t.submittedAt = U.now(); t.submittedBy = ctx.user.id; db.save();
    N.createNotification(db, 'u_dyrektor', 'trip', `Karta wycieczki „${t.name}” (${U.fmtDate(t.from)}–${U.fmtDate(t.to)}) czeka na zatwierdzenie.`, { link: '/dyrekcja' });
    ctx.audit({ action: 'trip_submitted', entity: 'trips', entityId: t.id, after: { status: 'submitted' }, reason: 'Złożenie karty wycieczki do zatwierdzenia' });
    return { ok: true, trip: tripView(db, t), message: `Karta wysłana do zatwierdzenia ${U.fmtDate(t.submittedAt)} ${t.submittedAt.slice(11, 16)}. Po zatwierdzeniu uczestnicy mają status „w” na wszystkich lekcjach z dni wycieczki.` };
  }, TRIP_WRITE);

  /* 3.8.6 — zatwierdzenie prowadzi dyrekcja (3.3). Jeśli ta trasa istnieje, delegujemy do niej,
     żeby nie dublować logiki nadawania statusu „w” i zastępstw. */
  r.post('/api/trips/:id/approve', (ctx) => {
    const owner = ctx.app.router.routes.find((x) => x.method === 'POST' && x.pattern === '/api/principal/trips/:id/approve');
    if (owner) return owner.handler(ctx);
    const db = ctx.db; const t = db.get('trips', ctx.params.id); if (!t) throw httpError(404, 'Nie ma takiej wycieczki.');
    if (t.status === 'approved') throw httpError(409, 'Ta wycieczka jest już zatwierdzona.', { code: 'already_approved' });
    if (t.status === 'draft') throw httpError(400, 'Plan wycieczki nie został jeszcze złożony przez kierownika.', { code: 'not_submitted' });
    const participants = (t.studentIds && t.studentIds.length) ? t.studentIds : db.col('students').filter((s) => (t.classIds || []).includes(s.classId)).map((s) => s.id);
    let marked = 0;
    for (let d = t.from; d <= t.to; d = U.addDays(d, 1)) {
      for (const sid of participants) {
        const s = db.get('students', sid); if (!s) continue;
        const groups = db.col('groups').filter((g) => (g.studentIds || []).includes(sid)).map((g) => g.id);
        for (const l of db.col('lessons').filter((x) => x.date === d && x.classId === s.classId && x.status !== 'cancelled' && (!x.groupId || groups.includes(x.groupId)))) {
          const ex = db.one('attendance', (a) => a.lessonId === l.id && a.studentId === sid);
          if (ex) Object.assign(ex, { status: 'w', draft: false, byUserId: ctx.user.id, at: U.now(), tripId: t.id });
          else db.col('attendance').push({ id: `att_trip_${t.id}_${l.id}_${sid}`, lessonId: l.id, studentId: sid, date: l.date, lessonNo: l.lessonNo, classId: l.classId, subjectId: l.subjectId, status: 'w', minutes: 0, draft: false, byUserId: ctx.user.id, at: U.now(), excuseId: null, tripId: t.id });
          marked++;
        }
      }
    }
    Object.assign(t, { status: 'approved', approvedBy: ctx.user.id, approvedAt: U.now() }); db.save();
    ctx.audit({ action: 'trip_approved', entity: 'trips', entityId: t.id, after: { status: 'approved', attendanceMarked: marked } });
    return { trip: tripView(db, t), attendanceMarked: marked, participants: participants.length };
  }, { roles: ['principal'] });

  /* ================================================================ 3.8.7 uczniowie pozostający w szkole */
  r.get('/api/modules/trips/:id/non-participants', (ctx) => {
    const db = ctx.db; const t = db.get('trips', ctx.params.id); if (!t) throw httpError(404, 'Nie ma takiej wycieczki.');
    const going = new Set(t.studentIds || []);
    const staying = db.col('students').filter((s) => (t.classIds || []).includes(s.classId) && !going.has(s.id));
    const np = t.nonParticipants || {};
    const options = [
      { value: '', label: 'Nieprzypisany' },
      ...db.col('classes').filter((c) => !(t.classIds || []).includes(c.id)).map((c) => ({ value: 'class:' + c.id, label: c.name + ' · zajęcia z klasą równoległą' })),
      { value: 'biblioteka', label: 'Biblioteka · praca własna' },
      { value: 'swietlica', label: 'Świetlica' }
    ];
    return {
      tripId: t.id, trip: t.name, days: tripView(db, t).days, classIds: t.classIds || [],
      students: staying.map((s) => Object.assign(studentRef(db, s.id), {
        reason: (np[s.id] || {}).reason || null,
        tempGroup: (np[s.id] || {}).tempGroup || null,
        tempGroupLabel: (options.find((o) => o.value === ((np[s.id] || {}).tempGroup || '')) || {}).label || 'Nieprzypisany',
        assignedBy: (np[s.id] || {}).assignedBy ? D.userLabel(db.get('users', np[s.id].assignedBy)) : null,
        assignedAt: (np[s.id] || {}).at || null
      })),
      unassigned: staying.filter((s) => !(np[s.id] || {}).tempGroup).length,
      options,
      note: 'Lista trafia do nauczycieli, którzy w dniach wycieczki przyjmują uczniów pozostających w szkole.'
    };
  }, TRIP_READ);

  r.post('/api/modules/trips/:id/non-participants', (ctx) => {
    const db = ctx.db; const t = db.get('trips', ctx.params.id); if (!t) throw httpError(404, 'Nie ma takiej wycieczki.');
    assertTripEditable(ctx, t, { allowApproved: true });     // S-17: grupy tymczasowe układa kierownik, opiekun albo dyrekcja
    const b = ctx.body || {};
    const entries = Array.isArray(b.assignments) ? b.assignments : [{ studentId: b.studentId, tempGroup: b.tempGroup, reason: b.reason }];
    t.nonParticipants = t.nonParticipants || {};
    const out = [];
    for (const e of entries) {
      const s = db.get('students', e.studentId);
      if (!s || !(t.classIds || []).includes(s.classId)) throw httpError(400, 'Uczeń spoza klas objętych wycieczką nie może dostać grupy tymczasowej.', { code: 'not_in_trip_class', studentId: e.studentId });
      if ((t.studentIds || []).includes(s.id)) throw httpError(400, `${sName(s)} jest na liście uczestników wycieczki.`, { code: 'is_participant', studentId: s.id });
      t.nonParticipants[s.id] = { reason: String(e.reason || '').slice(0, 200) || 'Brak zgłoszenia na wycieczkę', tempGroup: String(e.tempGroup || '').slice(0, 60), assignedBy: ctx.user.id, at: U.now() };
      out.push(Object.assign(studentRef(db, s.id), t.nonParticipants[s.id]));
    }
    db.save();
    ctx.audit({ action: 'trip_non_participants_assigned', entity: 'trips', entityId: t.id, after: { assigned: out.length, nonParticipants: t.nonParticipants }, reason: 'Opieka nad uczniami pozostającymi w szkole' });
    return { ok: true, tripId: t.id, assigned: out, unassigned: db.col('students').filter((s) => (t.classIds || []).includes(s.classId) && !(t.studentIds || []).includes(s.id) && !(t.nonParticipants[s.id] || {}).tempGroup).length };
  }, TRIP_WRITE);

  r.get('/api/modules/trips/:id/print', (ctx) => {
    const db = ctx.db; const t = db.get('trips', ctx.params.id); if (!t) throw httpError(404, 'Nie ma takiej wycieczki.');
    const v = tripView(db, t); const cfg = db.data.config;
    const rows = v.students.map((s) => `<tr><td>${D.xmlEsc(s.label)}</td><td>${D.xmlEsc(s.classId)}</td><td>${D.xmlEsc(String(s.groupNo || '—'))}</td><td>${s.signed ? 'tak' : 'nie'}</td></tr>`).join('');
    const sched = (v.schedule || []).map((x) => `<tr><td>${D.xmlEsc(U.fmtDate(x.day))}</td><td>${D.xmlEsc(x.text)}</td></tr>`).join('');
    const body = `<h1>Karta wycieczki</h1>
      <table><caption>Karta wycieczki — dane podstawowe</caption><tbody>
        <tr><th scope="row">Cel</th><td>${D.xmlEsc(v.name)}</td></tr>
        <tr><th scope="row">Termin</th><td>${D.xmlEsc(v.period)}</td></tr>
        <tr><th scope="row">Kierownik</th><td>${D.xmlEsc(v.leader)}</td></tr>
        <tr><th scope="row">Klasy</th><td>${D.xmlEsc(v.classIds.join(', '))}</td></tr>
        <tr><th scope="row">Transport</th><td>${D.xmlEsc(v.transport || '—')}</td></tr>
        <tr><th scope="row">Ubezpieczenie</th><td>${D.xmlEsc((v.insurance || {}).insurer || '—')} · polisa ${D.xmlEsc((v.insurance || {}).policyNo || '—')}</td></tr>
        <tr><th scope="row">Opiekunowie</th><td>${D.xmlEsc(v.chaperones.map((c) => c.name + ' (grupa ' + c.groupNo + ')').join(', ') || '—')}</td></tr>
        <tr><th scope="row">Status</th><td>${D.xmlEsc(v.statusLabel)}</td></tr>
      </tbody></table>
      <h2>Harmonogram</h2><table><caption>Harmonogram wycieczki</caption><thead><tr><th scope="col">Dzień</th><th scope="col">Przebieg</th></tr></thead><tbody>${sched || '<tr><td colspan="2">—</td></tr>'}</tbody></table>
      <h2>Uczestnicy (${v.participantCount}) · zgody: ${v.consentCount}</h2>
      <table><caption>Uczestnicy i zgody opiekunów</caption><thead><tr><th scope="col">Uczeń</th><th scope="col">Klasa</th><th scope="col">Grupa</th><th scope="col">Zgoda</th></tr></thead><tbody>${rows}</tbody></table>`;
    return {
      __raw: true, contentType: 'text/html; charset=utf-8',
      body: D.printHtml('Karta wycieczki — ' + v.name, body, { school: cfg.school.name, schoolMeta: cfg.school.address, docNo: 'Karta wycieczki', date: U.fmtDate(D.today(db)), printed: U.fmtDate(D.today(db)) })
    };
  }, TRIP_READ);

  /* ================================================================ 3.8.8 wypożyczenie kompletu podręczników */
  r.get('/api/modules/library/items', (ctx) => {
    const db = ctx.db; const level = ctx.query.level ? +ctx.query.level : null;
    return {
      items: db.col('libraryItems').filter((i) => (level ? i.level === level : true)).map((i) => Object.assign({}, i, { subject: (db.get('subjects', i.subjectId) || {}).name || i.subjectId })),
      sets: [...new Set(db.col('libraryItems').map((i) => i.setName).filter(Boolean))]
    };
  }, { roles: ['librarian', 'principal', 'registrar', 'teacher'] });

  /* ---- GAP-5: stan biblioteki wprowadza się w aplikacji --------------------------------
     Pojedyncza pozycja albo cały arkusz wklejony jako CSV `barcode;title;kind`. Kod kreskowy
     jest kluczem: ten sam kod aktualizuje pozycję, zamiast zakładać drugą obok. */
  r.post('/api/modules/library/items', (ctx) => {
    const db = ctx.db; const b = ctx.body || {};
    if (b.csv !== undefined) {
      const parsed = parseLibraryCsv(String(b.csv || ''));
      const errors = parsed.errors.slice();
      const created = [], updated = [], skipped = [];
      const seen = new Set();
      for (const raw of parsed.rows) {
        let item;
        try { item = validateLibraryItem(db, raw); }
        catch (e) { errors.push({ line: raw._line, error: e.message, code: (e.extra && e.extra.code) || 'invalid' }); continue; }
        if (seen.has(item.barcode)) { skipped.push({ line: raw._line, barcode: item.barcode, reason: 'duplicate_in_file' }); continue; }
        seen.add(item.barcode);
        const dup = db.one('libraryItems', (x) => x.barcode === item.barcode);
        if (dup) updated.push({ line: raw._line, id: dup.id, item });
        else created.push({ line: raw._line, item });
      }
      const summary = { rows: parsed.rows.length, created: created.length, updated: updated.length, skipped: skipped.length, errors };
      if (b.dryRun) return Object.assign({ ok: errors.length === 0, dryRun: true, applied: false }, summary, { preview: created.map((c) => c.item).concat(updated.map((u) => u.item)).slice(0, 200), note: 'Nic nie zostało zapisane. Wyślij ten sam plik bez `dryRun`, żeby wprowadzić stan biblioteki.' });
      if (errors.length && !b.force) throw httpError(400, `Import wstrzymany: ${errors.length} ${U.plural(errors.length, 'wiersz ma błąd', 'wiersze mają błędy', 'wierszy ma błędy')}. Popraw plik albo wyślij \`force: true\`, żeby zapisać resztę.`, { code: 'import_errors', errors });
      const rows = [];
      for (const c of created) rows.push(db.insert('libraryItems', Object.assign({ id: U.id('li'), addedAt: U.now(), addedByUserId: ctx.user.id }, c.item)));
      /* Aktualizacja nie rusza `status`/`studentId` — pozycja może być właśnie wypożyczona. */
      for (const u of updated) { const { status, studentId, ...rest } = u.item; db.update('libraryItems', u.id, rest); rows.push(db.get('libraryItems', u.id)); }
      db.save();
      ctx.audit({ action: 'library_items_import', entity: 'libraryItems', entityId: 'import', before: null, after: { created: created.length, updated: updated.length, skipped: skipped.length, errors: errors.length }, reason: b.reason || 'Import stanu biblioteki z arkusza' });
      return Object.assign({ ok: true, dryRun: false, applied: true }, summary, {
        items: rows.map((x) => libraryItemView(db, x)),
        confirmation: `Zapisano stan biblioteki: ${created.length} ${U.plural(created.length, 'nowa pozycja', 'nowe pozycje', 'nowych pozycji')}, ${updated.length} ${U.plural(updated.length, 'zaktualizowana', 'zaktualizowane', 'zaktualizowanych')}.`
      });
    }
    const item = validateLibraryItem(db, b);
    const dup = db.one('libraryItems', (x) => x.barcode === item.barcode);
    if (dup) throw httpError(409, `Kod kreskowy ${item.barcode} jest już w bibliotece („${dup.title}”).`, { code: 'duplicate_barcode', id: dup.id });
    const row = db.insert('libraryItems', Object.assign({ id: U.id('li'), addedAt: U.now(), addedByUserId: ctx.user.id }, item));
    ctx.audit({ action: 'library_item_create', entity: 'libraryItems', entityId: row.id, before: null, after: row, reason: b.reason || null });
    return { ok: true, item: libraryItemView(db, row), confirmation: `Dodano do biblioteki: ${row.title} (${row.barcode}).` };
  }, Object.assign({ maxBody: 4 * 1024 * 1024 }, LIB_SETUP));

  r.post('/api/modules/library/batch-checkout', (ctx) => {
    const db = ctx.db; const b = ctx.body || {};
    const cls = db.get('classes', b.classId); if (!cls) throw httpError(404, 'Nie ma takiej klasy.');
    const codes = (Array.isArray(b.barcodes) ? b.barcodes : String(b.barcodes || '').split(/[\s,;]+/)).map((x) => String(x).trim()).filter(Boolean);
    if (!codes.length) throw httpError(400, 'Zeskanuj co najmniej jeden kod kreskowy podręcznika.', { code: 'no_barcodes' });
    const items = [];
    for (const code of codes) {
      const it = db.col('libraryItems').find((i) => i.barcode === code);
      if (!it) throw httpError(404, `Kod ${code} nie należy do żadnego kompletu w bibliotece.`, { code: 'unknown_barcode', barcode: code });
      items.push(it);
    }
    const studentIds = Array.isArray(b.studentIds) && b.studentIds.length ? b.studentIds.filter((id) => (cls.studentIds || []).includes(id)) : (cls.studentIds || []).slice();
    if (!studentIds.length) throw httpError(400, 'W tej klasie nie ma uczniów do wypożyczenia.', { code: 'no_students' });
    const loanedAt = String(b.loanedAt || D.today(db)).slice(0, 10);
    const sem = D.semester(db, D.semesterOf(db, loanedAt)) || { to: loanedAt };
    const dueDate = String(b.dueDate || sem.to).slice(0, 10);
    const created = []; let skipped = 0;
    for (const sid of studentIds) {
      for (const it of items) {
        if (db.col('libraryLoans').some((l) => l.studentId === sid && l.barcode === it.barcode && !l.returnedAt)) { skipped++; continue; }
        created.push(db.insert('libraryLoans', {
          id: U.id('loan'), studentId: sid, classId: cls.id, itemId: it.id, barcode: it.barcode,
          title: it.title, author: it.author || '', setName: it.setName || null,
          loanedAt, dueDate, returnedAt: null, extendedCount: 0, byUserId: ctx.user.id, batchId: 'batch_' + cls.id + '_' + loanedAt
        }));
      }
    }
    ctx.audit({ action: 'library_batch_checkout', entity: 'libraryLoans', entityId: 'batch_' + cls.id + '_' + loanedAt, after: { classId: cls.id, students: studentIds.length, titles: items.length, created: created.length, skipped }, reason: 'Wypożyczenie kompletu podręczników dla klasy' });
    return {
      ok: true, classId: cls.id, students: studentIds.length, titles: items.map((i) => ({ barcode: i.barcode, title: i.title })),
      created: created.length, skipped, dueDate,
      loans: created.map((l) => loanView(db, l)),
      confirmation: `Wypożyczono ${created.length} ${U.plural(created.length, 'pozycję', 'pozycje', 'pozycji')} dla ${studentIds.length} ${U.plural(studentIds.length, 'ucznia', 'uczniów', 'uczniów')} klasy ${cls.name}. Termin zwrotu: ${U.fmtDate(dueDate)}.`
    };
  }, LIB_WRITE);

  r.get('/api/modules/library/loans', (ctx) => {
    const db = ctx.db; const classId = ctx.query.classId || null; const studentId = ctx.query.studentId || null;
    const rows = db.col('libraryLoans').filter((l) => {
      if (studentId && l.studentId !== studentId) return false;
      if (classId) { const s = db.get('students', l.studentId); if (!s || s.classId !== classId) return false; }
      if (ctx.query.open === '1' && l.returnedAt) return false;
      return true;
    }).map((l) => loanView(db, l)).sort((a, b) => (a.loanedAt < b.loanedAt ? 1 : -1));
    return { loans: rows, open: rows.filter((l) => l.open).length };
  }, { roles: ['librarian', 'principal', 'registrar', 'teacher'] });

  r.post('/api/modules/library/loans/:id/return', (ctx) => {
    const db = ctx.db; const l = db.get('libraryLoans', ctx.params.id); if (!l) throw httpError(404, 'Nie ma takiego wypożyczenia.');
    if (l.returnedAt) throw httpError(409, 'Ta pozycja jest już zwrócona.', { code: 'already_returned' });
    l.returnedAt = U.now(); l.returnedTo = ctx.user.id; db.save();
    ctx.audit({ action: 'library_return', entity: 'libraryLoans', entityId: l.id, after: { returnedAt: l.returnedAt }, reason: 'Zwrot materiałów' });
    return { ok: true, loan: loanView(db, l), settlement: settlementOf(db, l.studentId) };
  }, LIB_WRITE);

  /* ================================================================ 3.8.9 rozliczenie przed świadectwami */
  r.get('/api/modules/library/settlement', (ctx) => {
    const db = ctx.db;
    if (ctx.query.studentId) {
      const s = db.get('students', ctx.query.studentId); if (!s) throw httpError(404, 'Nie ma takiego ucznia.');
      return { student: settlementOf(db, s.id) };
    }
    const classId = ctx.query.classId;
    const cls = classId ? db.get('classes', classId) : null;
    if (classId && !cls) throw httpError(404, 'Nie ma takiej klasy.');
    const ids = cls ? (cls.studentIds || []) : db.col('students').map((s) => s.id);
    const rows = ids.map((id) => settlementOf(db, id));
    return {
      classId: classId || null, students: rows,
      settled: rows.filter((x) => x.settled).length, unsettled: rows.filter((x) => !x.settled).length,
      blockedStudentIds: rows.filter((x) => !x.settled).map((x) => x.studentId),
      note: 'Sekretariat sprawdza tę listę przed wydrukiem świadectw: uczeń z niezwróconymi materiałami wymaga rozliczenia.'
    };
  }, SETTLE_READ);

  /* ================================================================ GAP-5: opłaty (3.7.9) ====
     Opłatę wystawia sekretariat, administrator albo dyrekcja — dla oddziału albo dla całej
     szkoły — a opiekun widzi ją natychmiast w zakładce „Płatności” swojego konta. Jeden wiersz
     `payments` na ucznia, bo konto rodzica rozlicza się po dziecku, nie po rodzicu. */
  r.get('/api/modules/fees', (ctx) => {
    const db = ctx.db; const classId = ctx.query.classId || null;
    const rows = db.col('payments').filter((p) => {
      if (!classId) return true;
      const s = db.get('students', p.studentId); return !!s && s.classId === classId;
    });
    const byBatch = new Map();
    for (const p of rows) {
      const key = p.feeId || p.id;
      let v = byBatch.get(key);
      if (!v) byBatch.set(key, v = { feeId: key, title: p.title, kind: p.kind, amount: p.amount, dueDate: p.dueDate, issuedAt: p.createdAt, students: 0, paid: 0, due: 0 });
      v.students++; if (p.status === 'paid') v.paid++; else v.due++;
    }
    return {
      classId, kinds: FEE_KINDS,
      fees: [...byBatch.values()].sort((a, b) => (a.dueDate < b.dueDate ? 1 : -1)),
      totals: { rows: rows.length, paid: rows.filter((p) => p.status === 'paid').length, due: rows.filter((p) => p.status !== 'paid').length }
    };
  }, FEES);

  r.post('/api/modules/fees', (ctx) => {
    const db = ctx.db; const b = ctx.body || {};
    const title = String(b.title || '').trim();
    if (!title) throw httpError(400, 'Podaj nazwę opłaty (widzi ją opiekun).', { code: 'no_title' });
    const kind = FEE_KINDS.includes(String(b.kind || '').trim()) ? String(b.kind).trim() : 'other';
    const amount = money2(b.amount, 'Kwota opłaty');
    if (!amount) throw httpError(400, 'Kwota opłaty musi być większa od zera.', { code: 'bad_amount' });
    const dueDate = String(b.dueDate || '').slice(0, 10);
    if (!ISO_DATE.test(dueDate)) throw httpError(400, 'Podaj termin płatności w formacie RRRR-MM-DD.', { code: 'bad_due_date' });
    if (dueDate < D.today(db)) throw httpError(400, `Termin płatności ${U.fmtDate(dueDate)} już minął — opłaty nie wystawia się wstecz.`, { code: 'due_date_in_past' });
    let students, scope;
    if (Array.isArray(b.studentIds) && b.studentIds.length) {
      students = b.studentIds.map((id) => db.get('students', id)).filter(Boolean);
      scope = 'wybrani uczniowie';
      if (students.length !== b.studentIds.length) throw httpError(404, 'Na liście jest identyfikator, którego nie ma w księdze uczniów.', { code: 'unknown_student' });
    } else if (b.classId) {
      const cls = db.get('classes', b.classId); if (!cls) throw httpError(404, 'Nie ma takiej klasy.');
      students = (cls.studentIds || []).map((id) => db.get('students', id)).filter((s) => s && s.status !== 'removed');
      scope = `oddział ${cls.name}`;
    } else if (b.scope === 'school') {
      students = db.col('students').filter((s) => s.status !== 'removed');
      scope = 'cała szkoła';
    } else throw httpError(400, 'Wskaż oddział (`classId`), listę uczniów (`studentIds`) albo całą szkołę (`scope: "school"`).', { code: 'no_target' });
    if (!students.length) throw httpError(400, 'Nie ma uczniów, którym można wystawić tę opłatę.', { code: 'no_students' });
    const feeId = U.id('fee');
    const created = [];
    for (const s of students) {
      created.push(db.insert('payments', {
        id: U.id('pay'), feeId, studentId: s.id, parentUserId: (s.parentIds || [])[0] || null,
        kind, title, amount, currency: 'PLN', dueDate, status: 'due', paidAt: null, receiptNo: null,
        method: null, issuedByUserId: ctx.user.id, createdAt: U.now()
      }));
    }
    /* Opiekun ma się dowiedzieć o opłacie z dziennika, a nie z wywiadówki. Cisza nocna i tak
       odłoży powiadomienie do rana — obie drogi powiadomień honorują ją od GAP-7. */
    const notified = new Set();
    for (const s of students) {
      for (const n of D.notifyParentsOf(db, s.id, 'payment', `Nowa opłata „${title}” — ${money(amount)}, termin ${U.fmtDate(dueDate)}.`, { link: '/rodzic?studentId=' + s.id, dedupeKey: 'fee:' + feeId + ':' + s.id })) notified.add(n.userId);
    }
    ctx.audit({
      action: 'fee_issued', entity: 'payments', entityId: feeId, before: null,
      after: { title, kind, amount, dueDate, students: created.length, scope, parentsNotified: notified.size },
      reason: b.reason || `Wystawienie opłaty: ${scope}`
    });
    return {
      ok: true, feeId, kind, title, amount, amountText: money(amount), dueDate, scope,
      students: created.length, parentsNotified: notified.size,
      payments: created.map((p) => ({ id: p.id, studentId: p.studentId, amount: p.amount, dueDate: p.dueDate, status: p.status })),
      confirmation: `Wystawiono opłatę „${title}” (${money(amount)}, termin ${U.fmtDate(dueDate)}) dla ${created.length} ${U.plural(created.length, 'ucznia', 'uczniów', 'uczniów')} — ${scope}. Opiekunowie widzą ją w zakładce Płatności.`
    };
  }, FEES);

  /* ================================================================ 3.8.10 gabinet profilaktyki */
  r.post('/api/modules/nurse/visits', (ctx) => {
    const db = ctx.db; const b = ctx.body || {};
    const s = db.get('students', b.studentId); if (!s) throw httpError(404, 'Nie ma takiego ucznia.');
    const description = String(b.description || '').trim();
    if (description.length < 3) throw httpError(400, 'Opisz zdarzenie i udzieloną pomoc.', { code: 'no_description' });
    const kind = VISIT_KIND[b.kind] ? b.kind : 'inne';
    const date = String(b.date || D.today(db)).slice(0, 10);
    const time = /^\d{2}:\d{2}$/.test(String(b.time || '')) ? String(b.time) : D.schoolNow(db).time;
    const year = date.slice(0, 4);
    const no = `GAB/${year}/${db.col('nurseVisits').filter((v) => String(v.date).startsWith(year)).length + 118}`;
    const v = db.insert('nurseVisits', {
      id: U.id('visit'), no, studentId: s.id, classId: s.classId, date, time, kind, kindLabel: VISIT_KIND[kind],
      description, aid: String(b.aid || '').slice(0, 1000), outcome: OUTCOME[b.outcome] ? b.outcome : 'return',
      byUserId: ctx.user.id, parentNotified: b.notifyParents !== false, parentNotifiedAt: b.notifyParents !== false ? U.now() : null, at: U.now()
    });
    if (b.notifyParents !== false) {
      D.notifyParentsOf(db, s.id, 'gabinet', `Wizyta w gabinecie profilaktyki ${U.fmtDate(date)} o ${time}: ${VISIT_KIND[kind]}. Szczegóły widoczne wyłącznie dla opiekunów i pielęgniarki.`, { link: '/rodzic?studentId=' + s.id });
    }
    ctx.audit({ action: 'nurse_visit_recorded', entity: 'nurseVisits', entityId: v.id, after: { studentId: s.id, date, time, kind, no }, reason: 'Wpis do dokumentacji gabinetu profilaktyki (art. 9 RODO)' });
    return {
      ok: true, visit: visitView(db, v),
      privacy: { readers: ['nurse', 'parent'], hiddenFrom: ['teacher', 'principal', 'registrar'], inLessonLog: false },
      confirmation: `Zapisano wizytę ${no}. Dostęp mają wyłącznie pielęgniarka i opiekunowie ucznia; w dzienniku lekcyjnym widnieje najwyżej status „zw”.`
    };
  }, NURSE_WRITE);

  r.get('/api/modules/nurse/visits', (ctx) => {
    const db = ctx.db; const studentId = ctx.query.studentId || null;
    if (ctx.user.role === 'nurse') {
      const rows = db.col('nurseVisits').filter((v) => !studentId || v.studentId === studentId).sort((a, b) => (a.at < b.at ? 1 : -1));
      logHealthAccess(ctx, null, studentId || 'all', true);
      return { visits: rows.map((v) => visitView(db, v)), kinds: Object.entries(VISIT_KIND).map(([value, label]) => ({ value, label })), outcomes: Object.entries(OUTCOME).map(([value, label]) => ({ value, label })) };
    }
    if (ctx.user.role === 'parent') {
      const mine = (ctx.user.childrenIds || []).filter((id) => !studentId || id === studentId);
      if (studentId && !mine.length) { logHealthAccess(ctx, null, studentId, false); throw httpError(403, 'Dokumentacja gabinetu jest dostępna wyłącznie pielęgniarce i opiekunom ucznia.', { code: 'health_forbidden' }); }
      logHealthAccess(ctx, null, studentId || mine.join(','), true);
      return { visits: db.col('nurseVisits').filter((v) => mine.includes(v.studentId)).sort((a, b) => (a.at < b.at ? 1 : -1)).map((v) => visitView(db, v)) };
    }
    logHealthAccess(ctx, null, studentId || 'all', false);
    throw httpError(403, 'Wpisy gabinetu to dane o zdrowiu (art. 9 RODO). Widzi je wyłącznie pielęgniarka i opiekunowie ucznia; nauczyciel widzi w dzienniku najwyżej status „zw”.', { code: 'health_forbidden' });
  });

  r.get('/api/modules/nurse/visits/:id', (ctx) => {
    const db = ctx.db; const v = db.get('nurseVisits', ctx.params.id); if (!v) throw httpError(404, 'Nie ma takiego wpisu.');
    if (!canReadHealth(db, ctx.user, v.studentId)) {
      logHealthAccess(ctx, v.id, v.studentId, false);
      throw httpError(403, 'Wpisy gabinetu to dane o zdrowiu (art. 9 RODO). Widzi je wyłącznie pielęgniarka i opiekunowie ucznia.', { code: 'health_forbidden' });
    }
    logHealthAccess(ctx, v.id, v.studentId, true);
    return { visit: visitView(db, v) };
  });

  r.get('/api/modules/nurse/access-log', (ctx) => {
    const log = ctx.db.col('nurseVisitAccessLog').slice().sort((a, b) => (a.at < b.at ? 1 : -1)).slice(0, +ctx.query.limit || 100)
      .map((x) => Object.assign({}, x, { user: D.userLabel(ctx.db.get('users', x.userId)) }));
    return { log, comments: countsFor(ctx.db, ctx.user, 'nurse-access-log', log.map((x) => x.id)),
      note: 'Każdy wgląd w dokumentację gabinetu — także odmowa — zostaje w rejestrze i w dzienniku zdarzeń.' };
  }, { roles: ['nurse', 'dpo', 'principal'] });

  void app;
}
module.exports = { register, studentByCode, settlementOf, servingLine };
