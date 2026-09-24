'use strict';
/* 3.7 — konto rodzica: jedno logowanie i przełączanie między dziećmi, alert o nieobecności na 1. lekcji,
   elektroniczne usprawiedliwienia (bezpłatne), stały wgląd w oceny i frekwencję, cisza nocna,
   zebrania i konsultacje, płatności z natychmiastowym potwierdzeniem, odwołanie obiadu przed progiem,
   e-podpis zgód na wycieczkę, rozdzielone konta opiekunów oraz zawiadomienia o zagrożeniu z potwierdzeniem odbioru. */
const D = require('../lib/domain');
const U = require('../lib/util');
const C = require('../lib/crypto');
const N = require('./notifications');
const { httpError } = require('../lib/router');

const PARENT = { roles: ['parent'] };
const STATUS_LABEL = { ob: 'obecny', nb: 'nieobecny', sp: 'spóźniony', zw: 'zwolniony', u: 'usprawiedliwiony', rs: 'reprezentuje szkołę', w: 'wycieczka' };
const EXCUSE_LABEL = { pending: 'Oczekuje', approved: 'Zatwierdzone', rejected: 'Odrzucone' };
const PAYMENT_LABEL = { lunch: 'Obiady', council: 'Rada Rodziców', trip: 'Wycieczka', other: 'Inna opłata' };

/* ---------------------------------------------------------------- pomocnicze */
const sName = (s) => (s ? `${s.firstName} ${s.lastName}` : '');
const money = (v) => U.fmtAvg(Number(v || 0)) + ' zł';

/* ---------------------------------------------------------------- OPS-17 zakres dostępu opiekuna */
/** `D.guardianScope` zwraca `'full' | 'info' | 'none'` dla pary (opiekun, dziecko); `D.assertMayReadPupilRecord`
    jest jedną bramką na odczyt karty ucznia (`'grades'` → dane o uczeniu się, `'attendance'`, `'directory'`).
    Zakres zapisuje sekretariat przez `POST /api/registry/students/:id/guardians`. */
function childrenOf(db, user) {
  return (user.childrenIds || []).map((id) => db.get('students', id)).filter(Boolean)
    .filter((s) => D.guardianScope(db, user, s.id) !== 'none');
}
/** Dziecko wskazane przez ?studentId= (domyślnie pierwsze) + kontrola dostępu. */
function pickStudent(ctx) {
  const db = ctx.db;
  const wanted = ctx.query.studentId || (ctx.body && ctx.body.studentId) || null;
  const kids = childrenOf(db, ctx.user);
  const sid = wanted || (kids[0] && kids[0].id);
  if (!sid) throw httpError(404, 'Do tego konta nie przypisano żadnego dziecka.', { code: 'no_children' });
  const s = db.get('students', sid);
  if (!s) throw httpError(404, 'Nie ma takiego ucznia.');
  D.assertMayReadPupilRecord(db, ctx.user, sid, 'attendance');
  return s;
}
/* ---------------------------------------------------------------- F1: kto może DECYDOWAĆ, nie tylko czytać
   Zgoda, płatność, usprawiedliwienie i potwierdzenie odbioru to oświadczenia woli opiekuna prawnego,
   a nie odczyt danych. Składa je wyłącznie opiekun w pełnej legitymacji (`scope: 'full'`): rodzic,
   któremu sąd zawęził prawo do informacji (`info`), widzi frekwencję i plan, ale nie decyduje za
   dziecko — a rodzic pozbawiony władzy (`none`) nie widzi go wcale (D3-03, docs/GUARDIANS.md § 1). */
function assertMayDecide(ctx, studentId, what) {
  const st = D.guardianStanding(ctx.db, ctx.user, studentId);
  if (st.ok && st.scope === 'full') return st;
  throw httpError(403, st.scope === 'info'
    ? `Zakres dostępu tego opiekuna jest informacyjny — ${what} składa opiekun w pełni uprawniony do decyzji o dziecku.`
    : 'Dostęp do danych dziecka został ograniczony decyzją zapisaną w dokumentacji szkoły.',
  { code: 'forbidden', deny: 'guardian_scope', scope: st.scope, guardianStatus: st.status, decision: what });
}
function groupIdsOf(db, studentId) { return db.col('groups').filter((g) => (g.studentIds || []).includes(studentId)).map((g) => g.id); }
/** Lekcje ucznia danego dnia (z uwzględnieniem grup językowych i laboratoryjnych). */
function lessonsOfStudent(db, s, date) {
  const groups = groupIdsOf(db, s.id);
  return db.col('lessons').filter((l) => l.date === date && l.classId === s.classId && (!l.groupId || groups.includes(l.groupId)))
    .sort((a, b) => a.lessonNo - b.lessonNo);
}
function attendanceOf(db, lessonId, studentId) { return db.one('attendance', (a) => a.lessonId === lessonId && a.studentId === studentId); }
function lessonLine(db, l, studentId) {
  const a = attendanceOf(db, l.id, studentId); const t = D.lessonTime(db, l.lessonNo);
  const teacher = db.get('users', l.substituteTeacherId || l.teacherId);
  return {
    id: l.id, lessonNo: l.lessonNo, start: t.start, end: t.end, subjectId: l.subjectId,
    subject: (db.get('subjects', l.subjectId) || {}).name || l.subjectId, room: l.room,
    teacher: D.userLabel(teacher), group: l.groupId ? (db.get('groups', l.groupId) || {}).name : null,
    status: l.status, substitute: !!l.substituteTeacherId,
    attendance: a && !a.draft ? { status: a.status, label: STATUS_LABEL[a.status], minutes: a.minutes || null } : { status: 'none', label: 'brak wpisu', minutes: null }
  };
}
/** Nauczyciele uczący ucznia w podanych dniach — adresaci zgłoszenia nieobecności planowanej. */
function teachersOnDays(db, s, from, to) {
  const groups = groupIdsOf(db, s.id); const ids = new Set();
  for (const l of db.col('lessons')) {
    if (l.classId !== s.classId || l.date < from || l.date > to) continue;
    if (l.groupId && !groups.includes(l.groupId)) continue;
    if (l.substituteTeacherId) ids.add(l.substituteTeacherId); else if (l.teacherId) ids.add(l.teacherId);
  }
  return [...ids];
}
function homeroomOf(db, s) { const c = db.get('classes', s.classId); return c ? (c.actingHomeroomTeacherId || c.homeroomTeacherId) : null; }

/* ---------------------------------------------------------------- 3.7.2 alert o 1. lekcji */
/** Skanuje wpisy frekwencji z 1. lekcji danego dnia i tworzy rodzicom powiadomienie push (idempotentnie).
    Drugi argument to data (zgodność wstecz) albo `{ date, studentIds }` — zawężenie do uczniów, których
    właśnie dotknął zapis frekwencji; z tej postaci korzysta trasa zapisu w `routes/attendance.js`. */
function scanFirstPeriodAbsences(db, opts) {
  const o = typeof opts === 'string' ? { date: opts } : (opts || {});
  const day = o.date || D.today(db);
  const only = Array.isArray(o.studentIds) ? new Set(o.studentIds) : null;
  const out = [];
  for (const a of db.col('attendance')) {
    if (a.date !== day || a.lessonNo !== 1 || a.draft || a.status !== 'nb') continue;
    if (only && !only.has(a.studentId)) continue;
    const s = db.get('students', a.studentId); if (!s) continue;
    const t = D.lessonTime(db, 1);
    const text = `Nieobecność na 1. lekcji · ${sName(s)} · ${t.start}. Jeśli to pomyłka, zgłoś ją wychowawcy lub zadzwoń do sekretariatu.`;
    const created = [];
    /* D3-02 — alert o 1. lekcji chodził własną pętlą po `parentIds` i patrzył wyłącznie na
       `parentAccessBlocked`: opiekun z zakresem `none` dostawał go mimo postanowienia sądu, a uczeń
       pełnoletni w trybie „zgoda wymagana” miał nieobecność wysłaną opiekunom przed swoją zgodą.
       Jedna bramka na każdą rozsyłkę: `D.guardianStanding` + reguła rodzaju powiadomienia. */
    for (const p of s.parentIds || []) {
      const st = D.guardianStanding(db, p, s.id);
      if (!st.ok || !D.guardianKindAllowed(st.scope, 'absence')) continue;
      const n = N.createNotification(db, p, 'absence', text, { crisis: true, push: true, link: '/rodzic?studentId=' + s.id, dedupeKey: 'first-period:' + a.id, studentId: s.id });
      if (n) created.push(n.id);
    }
    out.push({ attendanceId: a.id, studentId: s.id, student: sName(s), classId: s.classId, date: day, lessonNo: 1, at: a.at, notified: created.length, notificationIds: created });
  }
  return out;
}

/* ---------------------------------------------------------------- oceny i frekwencja */
function gradesView(db, s, sem) {
  const cfg = db.data.config; const vis = cfg.visibility || {};
  const subjects = D.subjectsOfClass(db, s.classId);
  const rows = [];
  for (const subjectId of subjects) {
    const sg = D.studentGrades(db, s.id, subjectId, sem);
    if (!sg.grades.length) continue;
    const row = {
      subjectId, subject: (db.get('subjects', subjectId) || {}).name || subjectId,
      grades: sg.partial.map((g) => ({
        id: g.id, value: g.value, weight: g.weight, categoryName: g.categoryName, color: g.color,
        percent: g.percent, points: g.points, maxPoints: g.maxPoints, comment: g.comment || '',
        date: g.date, countsInAverage: g.countsInAverage !== false, retakeOfId: g.retakeOfId || null,
        teacher: D.userLabel(db.get('users', g.teacherId))
      })),
      average: vis.averagesToParents === false ? null : sg.average,
      proposed: sg.proposed ? sg.proposed.value : null, final: sg.final ? sg.final.value : null
    };
    if (vis.classAverage) {
      const cls = db.get('classes', s.classId) || { studentIds: [] };
      const vals = cls.studentIds.map((sid) => D.studentGrades(db, sid, subjectId, sem).average).filter((x) => x != null);
      row.classAverage = vals.length ? Math.round((vals.reduce((a, b) => a + b, 0) / vals.length) * 100) / 100 : null;
    }
    if (vis.rankings) {
      const cls = db.get('classes', s.classId) || { studentIds: [] };
      const ranked = cls.studentIds.map((sid) => ({ sid, avg: D.studentGrades(db, sid, subjectId, sem).average })).filter((x) => x.avg != null).sort((a, b) => b.avg - a.avg);
      row.rank = ranked.findIndex((x) => x.sid === s.id) + 1 || null;
      row.rankOf = ranked.length;
    }
    rows.push(row);
  }
  const all = D.studentGrades(db, s.id, null, sem);
  return {
    studentId: s.id, student: sName(s), classId: s.classId, semester: sem,
    subjects: rows,
    average: vis.averagesToParents === false ? null : all.average,
    visibility: { classAverage: !!vis.classAverage, rankings: !!vis.rankings, averagesToParents: vis.averagesToParents !== false },
    access: { free: true, cost: 0, currency: 'PLN', permanent: true, channel: 'przeglądarka i aplikacja', note: 'Wgląd w oceny, średnie, komentarze i frekwencję jest bezpłatny i bezterminowy — bez abonamentu i wersji premium.' }
  };
}
/** OPS-17 — widok ocen dla opiekuna z zakresem `'info'`: sam nagłówek, bez przedmiotów i średnich. */
function restrictedGrades(db, s, sem) {
  return {
    studentId: s.id, student: sName(s), classId: s.classId, semester: sem, subjects: [], average: null,
    restricted: true, accessScope: 'info',
    visibility: { classAverage: false, rankings: false, averagesToParents: false },
    note: 'Zakres dostępu tego opiekuna nie obejmuje ocen, uwag ani prac domowych. Widoczne pozostają frekwencja, plan lekcji i korespondencja ze szkołą.'
  };
}
function attendanceView(db, s, from, to) {
  const a = D.attendanceFor(db, s.id, from, to);
  const byDate = {};
  for (const e of a.entries) (byDate[e.date] = byDate[e.date] || []).push(e);
  const days = Object.keys(byDate).sort().map((d) => {
    const list = byDate[d].slice().sort((x, y) => x.lessonNo - y.lessonNo);
    const worst = ['nb', 'sp', 'u', 'zw', 'w', 'rs', 'ob'].find((st) => list.some((e) => e.status === st)) || 'ob';
    const late = list.filter((e) => e.status === 'sp').reduce((n, e) => n + (e.minutes || 0), 0);
    return { date: d, status: worst, label: STATUS_LABEL[worst], minutes: late || null, lessons: list.map((e) => ({ lessonNo: e.lessonNo, subjectId: e.subjectId, status: e.status, minutes: e.minutes || null })) };
  });
  return {
    studentId: s.id, student: sName(s), from, to, days,
    counts: { ob: a.ob, nb: a.nb, sp: a.sp, zw: a.zw, u: a.u, rs: a.rs, w: a.w },
    total: a.total, percent: a.percent, unexcusedPercent: a.unexcusedPercent, lateMinutes: a.lateMinutes
  };
}

/* ---------------------------------------------------------------- płatności i stołówka */
function receiptNo(db) {
  const year = (D.today(db) || '2026').slice(0, 4);
  const n = db.col('payments').filter((p) => p.receiptNo && String(p.receiptNo).startsWith(year)).length + 1042;
  return `${year}-${n}`;
}
function paymentView(db, p) {
  const s = db.get('students', p.studentId);
  return {
    id: p.id, studentId: p.studentId, student: sName(s), kind: p.kind, kindLabel: PAYMENT_LABEL[p.kind] || p.kind,
    title: p.title, amount: p.amount, amountText: money(p.amount), currency: p.currency || 'PLN',
    dueDate: p.dueDate, status: p.status, statusLabel: p.status === 'paid' ? 'Opłacone' : 'Do zapłaty',
    paidAt: p.paidAt || null, receiptNo: p.receiptNo || null, method: p.method || null,
    receiptPath: p.receiptNo ? '/api/parent/payments/' + p.id + '/receipt' : null
  };
}
function accountOf(db, studentId) { return db.one('cafeteriaAccounts', (a) => a.studentId === studentId); }
function accountView(db, acc) {
  if (!acc) return null;
  const credits = (acc.entries || []).filter((e) => e.kind === 'credit');
  return {
    id: acc.id, studentId: acc.studentId, mealPlan: acc.mealPlan, active: acc.active !== false,
    balance: acc.balance, balanceText: money(acc.balance), mealPrice: acc.mealPrice || db.data.config.mealPrice,
    period: acc.period, overdue: acc.balance < 0, overdueSince: acc.overdueSince || null, blocked: !!acc.blocked,
    credits: credits.map((e) => ({ id: e.id, date: e.date, amount: e.amount, amountText: money(e.amount), note: e.note, month: e.month })),
    creditTotal: credits.reduce((n, e) => n + e.amount, 0),
    entries: (acc.entries || []).slice(-20)
  };
}
const nextMonthOf = (date) => { const y = +date.slice(0, 4), m = +date.slice(5, 7); return m === 12 ? `${y + 1}-01` : `${y}-${String(m + 1).padStart(2, '0')}`; };

/* ---------------------------------------------------------------- zawiadomienia (3.7.14) */
function warningView(db, m, userId) {
  const cfg = db.data.config; const sem = cfg.semesters.find((x) => x.id === (m.semester || 1)) || cfg.semesters[0];
  const meeting = m.classificationMeeting || (sem && sem.classificationMeeting) || null;
  const sentDay = String(m.at).slice(0, 10);
  return {
    id: m.id, subject: m.subject, body: m.body, at: m.at, from: D.userLabel(db.get('users', m.fromUserId)),
    studentId: m.studentId || null, student: sName(db.get('students', m.studentId)),
    subjectId: m.subjectId || null, requiresAck: !!m.requiresAck,
    delivered: !!((m.deliveredTo || []).includes(userId)), deliveredAt: (m.deliveredAt || {})[userId] || m.at,
    read: !!(m.readBy || {})[userId], readAt: (m.readBy || {})[userId] || null,
    acked: !!(m.ackBy || {})[userId], ackAt: (m.ackBy || {})[userId] || null,
    status: (m.ackBy || {})[userId] ? 'acked' : (m.readBy || {})[userId] ? 'read' : 'delivered',
    statusLabel: (m.ackBy || {})[userId] ? 'Odbiór potwierdzony' : (m.readBy || {})[userId] ? 'Odczytane' : 'Dostarczone',
    classificationMeeting: meeting,
    daysBeforeClassification: meeting ? U.daysBetween(sentDay, meeting) : null,
    inTime: meeting ? U.daysBetween(sentDay, meeting) >= (cfg.warningDaysBeforeClassification || 30) : null,
    requiredDaysBefore: cfg.warningDaysBeforeClassification || 30
  };
}

function register(r, app) {
  /* ================================================================ 3.7.1 dzieci i przełączanie profili */
  r.get('/api/parent/children', (ctx) => {
    const db = ctx.db; const kids = childrenOf(db, ctx.user);
    const school = db.data.config.school;
    return {
      parent: { id: ctx.user.id, name: D.userLabel(ctx.user), login: ctx.user.login, separateAccount: !!ctx.user.separateAccount },
      current: ctx.query.studentId || (kids[0] && kids[0].id) || null,
      children: kids.map((s) => {
        const cls = db.get('classes', s.classId) || {};
        return {
          studentId: s.id, name: sName(s), label: `${s.lastName} ${s.firstName}`, classId: s.classId,
          className: cls.name || s.classId, school: school.short, schoolName: school.name,
          homeroom: D.userLabel(db.get('users', cls.actingHomeroomTeacherId || cls.homeroomTeacherId)),
          barcode: s.barcode || null, accessBlocked: !!s.parentAccessBlocked,
          accessScope: D.guardianScope(db, ctx.user, s.id),
          dataPath: '/api/parent/overview?studentId=' + s.id
        };
      }),
      blocked: (ctx.user.childrenIds || []).filter((id) => { const s = db.get('students', id); return s && s.parentAccessBlocked; }),
      /** OPS-17 — dzieci, co do których sąd odebrał temu opiekunowi wgląd; konto ich nie pokazuje. */
      restricted: (ctx.user.childrenIds || []).filter((id) => D.guardianStanding(db, ctx.user, id).reason === 'guardian_scope'),
      accessScope: ctx.user.accessScope || 'full',
      note: 'Jedno logowanie obsługuje wszystkie dzieci. Każdy widok danych przyjmuje parametr studentId i sprawdza uprawnienia opiekuna.'
    };
  }, PARENT);

  /* ================================================================ pulpit dziecka */
  r.get('/api/parent/overview', (ctx) => {
    const db = ctx.db; const s = pickStudent(ctx); const day = ctx.query.date || D.today(db);
    scanFirstPeriodAbsences(db, day);                       // alert powstaje niezależnie od tego, kto pierwszy zajrzy
    const since = U.addDays(day, -1); const recentMs = Date.parse(U.now()) - 36 * 3600 * 1000; // demo: config.today is pinned while n.at is a real instant
    const mine = db.col('notifications').filter((n) => n.userId === ctx.user.id && n.kind === 'absence' && D.notificationVisible(db, ctx.user, n) && ((n.schoolDate && n.schoolDate >= since) || U.localDate(n.at, D.tz(db)) >= since || Date.parse(n.at) >= recentMs));
    const weekFrom = U.addDays(day, -(U.weekday(day) - 1));
    const acc = accountOf(db, s.id);
    return {
      student: { studentId: s.id, name: sName(s), classId: s.classId, barcode: s.barcode || null },
      date: day, dateLabel: U.fmtDate(day),
      lessons: lessonsOfStudent(db, s, day).map((l) => lessonLine(db, l, s.id)),
      absenceAlerts: scanFirstPeriodAbsences(db, day).filter((a) => a.studentId === s.id),
      pushNotifications: mine.map((n) => ({ id: n.id, text: n.text, at: n.at, crisis: !!n.crisis, push: !!n.push, deferred: !!n.deferred })),
      attendanceWeek: attendanceView(db, s, weekFrom, U.addDays(weekFrom, 6)),
      accessScope: D.guardianScope(db, ctx.user, s.id),
      grades: D.guardianScope(db, ctx.user, s.id) === 'info' ? restrictedGrades(db, s, D.semesterOf(db, day)) : gradesView(db, s, D.semesterOf(db, day)),
      excuses: db.col('excuses').filter((e) => e.studentId === s.id).length,
      paymentsDue: db.col('payments').filter((p) => p.studentId === s.id && p.status !== 'paid').length,
      cafeteria: accountView(db, acc),
      consentsPending: db.col('trips').filter((t) => (t.studentIds || []).includes(s.id) && !(t.consents || {})[s.id]).length,
      warningsToAck: db.col('messages').filter((m) => m.kind === 'warning' && (m.toUserIds || []).includes(ctx.user.id) && m.requiresAck && !(m.ackBy || {})[ctx.user.id]).length
    };
  }, PARENT);

  /* ================================================================ 3.7.2 nieobecność na 1. lekcji */
  r.post('/api/parent/absence-alerts/scan', (ctx) => {
    const alerts = scanFirstPeriodAbsences(ctx.db, ctx.query.date || (ctx.body || {}).date);
    const visible = D.visibleStudentIds(ctx.db, ctx.user);
    return {
      ok: true, scanned: alerts.length, created: alerts.reduce((n, a) => n + a.notified, 0),
      alerts: alerts.filter((a) => !visible || visible.includes(a.studentId)),
      note: 'Sprawdzenie jest idempotentne: powtórne wywołanie nie tworzy drugiego powiadomienia dla tej samej nieobecności.'
    };
  }, { roles: ['parent', 'staff'] });

  r.get('/api/parent/absence-alerts', (ctx) => {
    const db = ctx.db; const s = pickStudent(ctx); const day = ctx.query.date || D.today(db);
    const alerts = scanFirstPeriodAbsences(db, day).filter((a) => a.studentId === s.id);
    /* S3-04 — powiadomienie zapisane, zanim sąd zawęził dostęp, znika z listy razem z dostępem. */
    const notes = db.col('notifications').filter((n) => n.userId === ctx.user.id && n.kind === 'absence' && D.notificationVisible(db, ctx.user, n));
    return {
      studentId: s.id, date: day, alerts,
      notifications: notes.map((n) => ({ id: n.id, text: n.text, at: n.at, crisis: !!n.crisis, push: !!n.push, deferred: !!n.deferred, read: !!n.read })),
      schoolPhone: db.data.config.school.phone,
      note: 'Powiadomienie o nieobecności na pierwszej lekcji ma priorytet kryzysowy — dociera także w czasie ciszy nocnej.'
    };
  }, PARENT);

  /* ================================================================ 3.7.3 / 3.7.4 / 3.7.5 usprawiedliwienia */
  r.get('/api/parent/excuses', (ctx) => {
    const db = ctx.db; const s = pickStudent(ctx);
    const rows = db.col('excuses').filter((e) => e.studentId === s.id).sort((a, b) => (a.at < b.at ? 1 : -1)).map((e) => ({
      id: e.id, studentId: e.studentId, from: e.from, to: e.to || e.from,
      period: U.fmtDate(e.from) + (e.to && e.to !== e.from ? ' – ' + U.fmtDate(e.to) : ''),
      lessonNos: e.lessonNos && e.lessonNos.length ? e.lessonNos : null, reason: e.reason, planned: !!e.planned,
      status: e.status, statusLabel: EXCUSE_LABEL[e.status] || e.status,
      rejectReason: e.rejectReason || null,
      decidedBy: e.decidedBy ? D.userLabel(db.get('users', e.decidedBy)) : null, decidedAt: e.decidedAt || null,
      mine: e.byUserId === ctx.user.id, byName: D.userLabel(db.get('users', e.byUserId)), at: e.at,
      attachment: e.attachment ? { name: e.attachment.name, size: e.attachment.size } : null
    }));
    return {
      studentId: s.id, student: sName(s), excuses: rows,
      counts: { pending: rows.filter((e) => e.status === 'pending').length, approved: rows.filter((e) => e.status === 'approved').length, rejected: rows.filter((e) => e.status === 'rejected').length },
      reasons: [{ value: 'choroba', label: 'Choroba' }, { value: 'lekarz', label: 'Wizyta u lekarza' }, { value: 'rodzina', label: 'Sprawy rodzinne' }, { value: 'wyjazd', label: 'Wyjazd planowany' }],
      fee: 0, free: true,
      note: 'Wniosek składa się z telefonu lub przeglądarki. Usługa jest bezpłatna — dziennik nie pobiera opłat za usprawiedliwienia ani powiadomienia.'
    };
  }, PARENT);

  r.post('/api/parent/excuses', (ctx) => {
    const db = ctx.db; const b = ctx.body || {}; const s = pickStudent(ctx);
    assertMayDecide(ctx, s.id, 'wniosek o usprawiedliwienie');
    const from = String(b.from || '').slice(0, 10); const to = String(b.to || from).slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to)) throw httpError(400, 'Podaj daty nieobecności (od–do) w formacie RRRR-MM-DD.', { code: 'bad_dates' });
    if (to < from) throw httpError(400, 'Data „do” nie może być wcześniejsza niż „od”.', { code: 'bad_range' });
    const reason = String(b.reason || '').trim();
    if (reason.length < 3) throw httpError(400, 'Podaj powód nieobecności — wychowawca widzi go przy rozpatrywaniu wniosku.', { code: 'no_reason' });
    const today = D.today(db);
    const planned = b.planned !== undefined ? !!b.planned : from > today;
    /* P30 — jeden wniosek „od 1.09 do 25.06” usprawiedliwiał cały rok jednym kliknięciem wychowawcy.
       Wniosek obejmuje najwyżej `excuseMaxDays` dni, sięga w przyszłość na `excuseMaxFutureDays`
       (nieobecność planowana) i wstecz na `excusePastDays` — starsze nieobecności prostuje wychowawca
       w dzienniku, bo po klasyfikacji nie wolno ich już ruszać. */
    const cfg = db.data.config;
    const maxFuture = cfg.excuseMaxFutureDays != null ? +cfg.excuseMaxFutureDays : 30;
    const maxPast = cfg.excusePastDays != null ? +cfg.excusePastDays : 14;
    const maxDays = cfg.excuseMaxDays != null ? +cfg.excuseMaxDays : 30;
    if (U.daysBetween(today, to) > maxFuture) throw httpError(400, `Wniosek sięga dalej niż ${maxFuture} dni w przyszłość. Dłuższą nieobecność planowaną zgłoś wychowawcy — wymaga odrębnej zgody.`, { code: 'too_far_ahead', maxFutureDays: maxFuture, today });
    if (U.daysBetween(from, today) > maxPast) throw httpError(400, `Nieobecność sprzed ponad ${maxPast} dni usprawiedliwia wychowawca w dzienniku — wniosek z aplikacji obejmuje bieżący okres.`, { code: 'too_far_back', maxPastDays: maxPast, today });
    if (U.daysBetween(from, to) + 1 > maxDays) throw httpError(400, `Jeden wniosek obejmuje najwyżej ${maxDays} dni. Podziel dłuższą nieobecność na osobne wnioski.`, { code: 'range_too_long', maxDays });
    /* R1/hour 0 — numery lekcji sprawdzamy wobec planu dzwonków, nie wobec zakresu 1–max: godzina 0 (7:10) jest legalna, gdy szkoła ją zdefiniowała. */
    const bells = (cfg.lessonTimes || []).map((t) => +t.no).filter((n) => Number.isInteger(n)).sort((a, b2) => a - b2);
    const lessonNos = Array.isArray(b.lessonNos) && b.lessonNos.length ? b.lessonNos.map(Number).filter((n) => Number.isInteger(n)) : null;
    if (Array.isArray(b.lessonNos) && b.lessonNos.length) {
      if (!lessonNos.length || lessonNos.some((n) => !bells.includes(n))) throw httpError(400, `Numery lekcji muszą odpowiadać planowi dzwonków (są: ${bells.join(', ') || 'brak'}).`, { code: 'bad_lesson_nos', lessonNos: bells, maxLessonNo: bells.length ? bells[bells.length - 1] : 0 });
    }
    const e = db.insert('excuses', {
      id: U.id('exc'), studentId: s.id, from, to, lessonNos, reason,
      attachment: b.attachment ? { name: String(b.attachment.name || 'załącznik').slice(0, 200), size: +b.attachment.size || 0, type: String(b.attachment.type || 'application/octet-stream') } : null,
      byUserId: ctx.user.id, at: U.now(), planned,
      status: 'pending', rejectReason: null, decidedBy: null, decidedAt: null, channel: b.channel === 'mobile' ? 'mobile' : 'app', fee: 0
    });
    const hr = homeroomOf(db, s);
    const label = `${sName(s)} (${s.classId}), ${U.fmtDate(from)}${to !== from ? '–' + U.fmtDate(to) : ''}`;
    if (hr) N.createNotification(db, hr, 'excuse', `${planned ? 'Zgłoszenie planowanej nieobecności' : 'Wniosek o usprawiedliwienie'}: ${label}. Powód: ${reason}`, { link: '/wychowawca' });
    let notifiedTeachers = [];
    if (planned) {                                        // 3.7.5 — nauczyciele przedmiotów z objętych dni
      notifiedTeachers = teachersOnDays(db, s, from, to).filter((t) => t !== hr);
      for (const t of notifiedTeachers) {
        N.createNotification(db, t, 'excuse', `Planowana nieobecność: ${label}. Powód: ${reason}`, { link: '/lekcja' });
      }
    }
    N.createNotification(db, ctx.user.id, 'excuse', `Wniosek o usprawiedliwienie (${label}) trafił do wychowawcy. Status śledzisz w zakładce Usprawiedliwienia.`, { link: '/rodzic?studentId=' + s.id });
    ctx.audit({ action: planned ? 'excuse_planned_submitted' : 'excuse_submitted', entity: 'excuses', entityId: e.id, after: { studentId: s.id, from, to, reason, planned }, reason: 'Wniosek opiekuna złożony w aplikacji' });
    return {
      ok: true, excuse: { id: e.id, from: e.from, to: e.to, status: e.status, planned: e.planned, at: e.at },
      fee: 0, free: true,
      notifiedHomeroom: hr ? D.userLabel(db.get('users', hr)) : null,
      notifiedTeachers: notifiedTeachers.map((t) => D.userLabel(db.get('users', t))),
      notifiedTeacherIds: notifiedTeachers,
      receipt: `Wniosek wysłany ${U.fmtDate(e.at)} ${e.at.slice(11, 16)}. Opłata: 0,00 zł. Decyzję podejmuje wychowawca.`
    };
  }, PARENT);

  /* ================================================================ 3.7.6 oceny, średnie, komentarze, frekwencja */
  r.get('/api/parent/grades', (ctx) => {
    const db = ctx.db; const s = pickStudent(ctx);
    D.assertMayReadPupilRecord(db, ctx.user, s.id, 'grades');
    return gradesView(db, s, +(ctx.query.semester || D.semesterOf(db)));
  }, PARENT);

  r.get('/api/parent/attendance', (ctx) => {
    const db = ctx.db; const s = pickStudent(ctx); const day = ctx.query.date || D.today(db);
    const from = ctx.query.from || U.addDays(day, -(U.weekday(day) - 1));
    const to = ctx.query.to || U.addDays(from, 6);
    return Object.assign(attendanceView(db, s, from, to), {
      bySubject: Object.fromEntries(Object.entries(D.attendanceBySubject(db, s.id)).map(([k, v]) => [k, { subject: (db.get('subjects', k) || {}).name || k, total: v.total, nb: v.nb, u: v.u, sp: v.sp, percent: v.percent }])),
      access: { free: true, cost: 0, permanent: true }
    });
  }, PARENT);

  /* ================================================================ 3.7.7 cisza nocna */
  r.get('/api/parent/quiet-hours', (ctx) => {
    const db = ctx.db; const now = U.now();
    const q = ctx.user.quietHours || null;
    const mine = db.col('notifications').filter((n) => n.userId === ctx.user.id);
    return {
      quietHours: q, enabled: !!q, default: db.data.config.quietHoursDefault || null,
      quietNow: D.inQuietHours(ctx.user, db, now),
      deferred: mine.filter((n) => n.deferred).length,
      crisisDelivered: mine.filter((n) => n.crisis && !n.deferred).length,
      note: 'W czasie ciszy nocnej zwykłe powiadomienia czekają do rana. Alerty kryzysowe (np. nieobecność na 1. lekcji, komunikat dyrekcji) docierają zawsze.'
    };
  }, PARENT);

  r.patch('/api/parent/quiet-hours', (ctx) => {
    const b = ctx.body || {}; const u = ctx.user; const before = u.quietHours || null;
    if (b.enabled === false || b.quietHours === null) u.quietHours = null;
    else {
      const src = b.quietHours || b;
      const from = String(src.from || ''); const to = String(src.to || '');
      if (!/^\d{2}:\d{2}$/.test(from) || !/^\d{2}:\d{2}$/.test(to)) throw httpError(400, 'Podaj godziny ciszy nocnej w formacie GG:MM.', { code: 'bad_quiet_hours' });
      if (from === to) throw httpError(400, 'Początek i koniec ciszy nocnej muszą się różnić.', { code: 'bad_quiet_hours' });
      u.quietHours = { from, to };
    }
    ctx.db.save();
    ctx.audit({ action: 'quiet_hours_changed', entity: 'user', entityId: u.id, before: { quietHours: before }, after: { quietHours: u.quietHours }, reason: 'Tryb nocny konta opiekuna' });
    return {
      ok: true, quietHours: u.quietHours,
      message: u.quietHours ? `Cisza nocna ${u.quietHours.from}–${u.quietHours.to}. Alerty kryzysowe docierają mimo wyciszenia.` : 'Cisza nocna wyłączona — powiadomienia przychodzą o każdej porze.'
    };
  }, PARENT);

  /* ================================================================ 3.7.8 zebrania i konsultacje */
  function slotView(db, x) {
    const t = db.get('users', x.teacherId);
    return {
      id: x.id, meetingId: x.meetingId, date: x.date, start: x.start, end: x.end, room: x.room || null,
      when: `${U.fmtDate(x.date)}, ${x.start}`, teacherId: x.teacherId, teacher: D.userLabel(t),
      subjectId: x.subjectId || null, subject: x.subjectId ? (db.get('subjects', x.subjectId) || {}).name : null,
      booked: !!x.bookedByUserId, mine: x.bookedByUserId === null ? false : undefined,
      bookedForStudentId: x.bookedForStudentId || null, bookedAt: x.bookedAt || null
    };
  }
  r.get('/api/parent/meetings', (ctx) => {
    const db = ctx.db; const kids = childrenOf(db, ctx.user); const classIds = kids.map((s) => s.classId);
    const meetings = db.col('meetings').filter((m) => !m.classId || classIds.includes(m.classId)).sort((a, b) => (a.date + a.start < b.date + b.start ? -1 : 1));
    const slots = db.col('consultationSlots').filter((x) => meetings.some((m) => m.id === x.meetingId));
    return {
      meetings: meetings.map((m) => ({
        id: m.id, kind: m.kind, kindLabel: m.kind === 'openDay' ? 'Dzień otwarty' : 'Zebranie', title: m.title,
        date: m.date, dateLabel: U.fmtDate(m.date), start: m.start, end: m.end, classId: m.classId, room: m.room,
        teacher: m.teacherId ? D.userLabel(db.get('users', m.teacherId)) : null, note: m.note || ''
      })),
      slots: slots.map((x) => Object.assign(slotView(db, x), { mine: x.bookedByUserId === ctx.user.id })).sort((a, b) => (a.start + a.teacher < b.start + b.teacher ? -1 : 1)),
      myBookings: slots.filter((x) => x.bookedByUserId === ctx.user.id).map((x) => slotView(db, x)),
      note: 'Jeden termin przyjmuje jedną rezerwację. Zajęty termin zgłasza konflikt (409) i pozostaje przy pierwszym opiekunie.'
    };
  }, PARENT);

  r.post('/api/parent/consultation-slots/:id/book', (ctx) => {
    const db = ctx.db; const x = db.get('consultationSlots', ctx.params.id);
    if (!x) throw httpError(404, 'Nie ma takiego terminu konsultacji.');
    const s = pickStudent(ctx);
    if (x.bookedByUserId) {
      if (x.bookedByUserId === ctx.user.id) throw httpError(409, 'Ten termin jest już przez Ciebie zarezerwowany.', { code: 'already_mine' });
      throw httpError(409, `Termin ${U.fmtDate(x.date)} ${x.start} został właśnie zarezerwowany przez innego opiekuna. Wybierz inną godzinę.`, { code: 'slot_taken' });
    }
    x.bookedByUserId = ctx.user.id; x.bookedForStudentId = s.id; x.bookedAt = U.now(); db.save();
    N.createNotification(db, x.teacherId, 'meeting', `Rezerwacja konsultacji ${U.fmtDate(x.date)} ${x.start}: ${D.userLabel(ctx.user)} (${sName(s)}).`, { link: '/dyrekcja' });
    ctx.audit({ action: 'consultation_booked', entity: 'consultationSlots', entityId: x.id, after: { studentId: s.id, teacherId: x.teacherId, date: x.date, start: x.start } });
    return { ok: true, slot: Object.assign(slotView(db, x), { mine: true }), confirmation: `Zarezerwowano konsultację ${U.fmtDate(x.date)} o ${x.start} — ${D.userLabel(db.get('users', x.teacherId))}.` };
  }, PARENT);

  r.delete('/api/parent/consultation-slots/:id/book', (ctx) => {
    const db = ctx.db; const x = db.get('consultationSlots', ctx.params.id);
    if (!x) throw httpError(404, 'Nie ma takiego terminu konsultacji.');
    if (x.bookedByUserId !== ctx.user.id) throw httpError(403, 'Rezerwację odwołuje opiekun, który ją założył.', { code: 'not_owner' });
    const before = { bookedByUserId: x.bookedByUserId, bookedForStudentId: x.bookedForStudentId };
    x.bookedByUserId = null; x.bookedForStudentId = null; x.bookedAt = null; db.save();
    ctx.audit({ action: 'consultation_cancelled', entity: 'consultationSlots', entityId: x.id, before, after: { bookedByUserId: null } });
    return { ok: true, slot: slotView(db, x) };
  }, PARENT);

  /* ================================================================ 3.7.9 płatności i potwierdzenia */
  r.get('/api/parent/payments', (ctx) => {
    const db = ctx.db; const kids = childrenOf(db, ctx.user).map((s) => s.id);
    const wanted = ctx.query.studentId ? [pickStudent(ctx).id] : kids;
    const rows = db.col('payments').filter((p) => wanted.includes(p.studentId)).sort((a, b) => (a.dueDate < b.dueDate ? -1 : 1));
    return {
      payments: rows.map((p) => paymentView(db, p)),
      due: rows.filter((p) => p.status !== 'paid').reduce((n, p) => n + p.amount, 0),
      dueText: money(rows.filter((p) => p.status !== 'paid').reduce((n, p) => n + p.amount, 0)),
      kinds: Object.entries(PAYMENT_LABEL).map(([value, label]) => ({ value, label })),
      note: 'Płatność potwierdzamy natychmiast: potwierdzenie z numerem trafia na listę i do wydruku PDF.'
    };
  }, PARENT);

  r.post('/api/parent/payments/:id/pay', (ctx) => {
    const db = ctx.db; const p = db.get('payments', ctx.params.id);
    if (!p) throw httpError(404, 'Nie ma takiej opłaty.');
    D.assertMayReadPupilRecord(db, ctx.user, p.studentId, 'directory');
    assertMayDecide(ctx, p.studentId, 'opłatę za dziecko');
    if (p.status === 'paid') throw httpError(409, `Ta opłata została już opłacona — potwierdzenie nr ${p.receiptNo}.`, { code: 'already_paid', receiptNo: p.receiptNo });
    const before = { status: p.status };
    p.status = 'paid'; p.paidAt = U.now(); p.receiptNo = receiptNo(db);
    p.method = String((ctx.body || {}).method || 'przelew online').slice(0, 40);
    p.paidByUserId = ctx.user.id;
    if (p.kind === 'lunch') {                                  // wpłata zasila konto stołówkowe
      const acc = accountOf(db, p.studentId);
      if (acc) { acc.balance = Math.round((acc.balance + p.amount) * 100) / 100; (acc.entries = acc.entries || []).push({ id: U.id('cafe'), date: D.today(db), kind: 'payment', amount: p.amount, note: p.title, month: D.today(db).slice(0, 7) }); }
    }
    db.save();
    N.createNotification(db, ctx.user.id, 'payment', `Opłata „${p.title}” — ${money(p.amount)} zaksięgowana. Potwierdzenie nr ${p.receiptNo}.`, { link: '/rodzic?studentId=' + p.studentId });
    ctx.audit({ action: 'payment_paid', entity: 'payments', entityId: p.id, before, after: { status: 'paid', amount: p.amount, receiptNo: p.receiptNo }, reason: 'Płatność elektroniczna opiekuna' });
    return {
      ok: true, payment: paymentView(db, p),
      receiptNo: p.receiptNo, receiptPath: '/api/parent/payments/' + p.id + '/receipt',
      receipt: `Zapłacono ${money(p.amount)} — potwierdzenie nr ${p.receiptNo} z ${U.fmtDate(p.paidAt)} ${p.paidAt.slice(11, 16)}.`
    };
  }, PARENT);

  r.get('/api/parent/payments/:id/receipt', (ctx) => {
    const db = ctx.db; const p = db.get('payments', ctx.params.id);
    if (!p) throw httpError(404, 'Nie ma takiej opłaty.');
    D.assertMayReadPupilRecord(db, ctx.user, p.studentId, 'directory');
    if (p.status !== 'paid') throw httpError(400, 'Potwierdzenie wystawiamy dopiero po zaksięgowaniu wpłaty.', { code: 'not_paid' });
    const cfg = db.data.config; const s = db.get('students', p.studentId);
    const body = `<h1>Potwierdzenie wpłaty nr ${D.xmlEsc(p.receiptNo)}</h1>
      <table><caption>Potwierdzenie wpłaty — dane wpłaty</caption><tbody>
        <tr><th scope="row">Tytuł</th><td>${D.xmlEsc(p.title)}</td></tr>
        <tr><th scope="row">Uczeń</th><td>${D.xmlEsc(sName(s))} · klasa ${D.xmlEsc(s.classId)}</td></tr>
        <tr><th scope="row">Wpłacający</th><td>${D.xmlEsc(D.userLabel(ctx.user))}</td></tr>
        <tr><th scope="row">Kwota</th><td>${D.xmlEsc(money(p.amount))}</td></tr>
        <tr><th scope="row">Forma płatności</th><td>${D.xmlEsc(p.method || 'przelew online')}</td></tr>
        <tr><th scope="row">Data zaksięgowania</th><td>${D.xmlEsc(U.fmtDate(p.paidAt))} ${D.xmlEsc(String(p.paidAt).slice(11, 16))}</td></tr>
      </tbody></table>
      <p class="note">Potwierdzenie wygenerowane elektronicznie; nie wymaga podpisu. Dokument otwórz i wydrukuj do PDF (Ctrl+P).</p>`;
    return {
      __raw: true, contentType: 'text/html; charset=utf-8',
      body: D.printHtml(`Potwierdzenie ${p.receiptNo}`, body, { school: cfg.school.name, schoolMeta: cfg.school.address, docNo: 'Potwierdzenie nr ' + p.receiptNo, date: U.fmtDate(p.paidAt), printed: U.fmtDate(D.today(db)) })
    };
  }, PARENT);

  /* ================================================================ 3.7.10 odwołanie obiadu */
  r.get('/api/parent/cafeteria', (ctx) => {
    const db = ctx.db; const s = pickStudent(ctx); const acc = accountOf(db, s.id);
    const cancels = db.col('cafeteriaCancellations').filter((x) => x.studentId === s.id).sort((a, b) => (a.date < b.date ? 1 : -1));
    return {
      studentId: s.id, student: sName(s), account: accountView(db, acc),
      cutoff: db.data.config.lunchCancelCutoff, mealPrice: db.data.config.mealPrice,
      today: D.today(db), cancellations: cancels.slice(0, 20),
      note: `Obiad odwołany do godziny ${db.data.config.lunchCancelCutoff} daje zwrot na rachunku za kolejny miesiąc. Po tej godzinie porcja jest już przygotowana.`
    };
  }, PARENT);

  r.post('/api/parent/lunch/cancel', (ctx) => {
    const db = ctx.db; const b = ctx.body || {}; const s = pickStudent(ctx);
    assertMayDecide(ctx, s.id, 'odwołanie obiadu');
    const today = D.today(db);
    const date = String(b.date || today).slice(0, 10);
    if (date !== today) throw httpError(400, 'Przez aplikację odwołujesz wyłącznie obiad na dzisiaj.', { code: 'not_today', today });
    const acc = accountOf(db, s.id);
    if (!acc || acc.active === false || !acc.mealPlan) throw httpError(400, 'To dziecko nie jest zapisane na obiady.', { code: 'no_meal_plan' });
    const cutoff = db.data.config.lunchCancelCutoff || '08:00';
    /* Prototyp: `at` pozwala podać godzinę zgłoszenia z terminala; domyślnie liczy się zegar serwera.
       Bez podanej godziny pytamy o próg wspólny helper czasu szkolnego (`D.isBeforeCutoff`, W2) —
       zegar ścienny serwera bywa w innej strefie niż szkoła. Gdy helpera jeszcze nie ma, zostaje
       dotychczasowe porównanie na `U.now()`. */
    const given = /^\d{2}:\d{2}$/.test(String(b.at || '')) ? String(b.at) : null;
    const at = given || D.schoolNow(db).time;
    const before = given ? given < cutoff : (typeof D.isBeforeCutoff === 'function' ? !!D.isBeforeCutoff(db, cutoff) : at < cutoff);
    if (!before) throw httpError(409, `Zgłoszenie o ${at} wpłynęło po progu ${cutoff}. Porcja na ${U.fmtDate(date)} jest już przygotowana i nie podlega zwrotowi.`, { code: 'after_cutoff', cutoff, at });
    if (db.col('cafeteriaCancellations').some((x) => x.studentId === s.id && x.date === date)) throw httpError(409, `Obiad na ${U.fmtDate(date)} został już odwołany.`, { code: 'already_cancelled' });
    const amount = acc.mealPrice || db.data.config.mealPrice;
    const month = nextMonthOf(date);
    const credit = { id: U.id('cafe'), date, kind: 'credit', amount, note: `Zwrot za odwołany obiad ${U.fmtDate(date)}`, month };
    (acc.entries = acc.entries || []).push(credit);
    acc.balance = Math.round((acc.balance + amount) * 100) / 100;
    const row = db.insert('cafeteriaCancellations', { id: U.id('canc'), studentId: s.id, classId: s.classId, date, at: U.now(), reportedAt: at, byUserId: ctx.user.id, amount, creditId: credit.id, creditMonth: month });
    db.save();
    N.createNotification(db, ctx.user.id, 'cafeteria', `Obiad ${U.fmtDate(date)} odwołany. Zwrot ${money(amount)} trafi na rachunek za ${month}.`, { link: '/rodzic?studentId=' + s.id });
    N.createNotification(db, 'u_stolowka', 'cafeteria', `Odwołanie obiadu: ${sName(s)} (${s.classId}), ${U.fmtDate(date)}, zgłoszone o ${at}.`, { link: '/moduly' });
    ctx.audit({ action: 'lunch_cancelled', entity: 'cafeteriaAccounts', entityId: acc.id, after: { studentId: s.id, date, amount, creditMonth: month, reportedAt: at }, reason: 'Odwołanie obiadu przez opiekuna' });
    return {
      ok: true, cancellation: row, credit, creditMonth: month, amount, amountText: money(amount),
      balance: acc.balance, cutoff, reportedAt: at,
      confirmation: `Obiad na ${U.fmtDate(date)} odwołany o ${at}. Zwrot ${money(amount)} zostanie ujęty na rachunku za ${month}.`
    };
  }, PARENT);

  /* ================================================================ 3.7.12 e-podpis zgody na wycieczkę */
  function tripConsentView(db, t, studentId) {
    const c = (t.consents || {})[studentId] || null;
    return {
      tripId: t.id, name: t.name, from: t.from, to: t.to, status: t.status,
      period: U.fmtDate(t.from) + (t.to !== t.from ? ' – ' + U.fmtDate(t.to) : ''),
      leader: D.userLabel(db.get('users', t.leaderId)), insurance: t.insurance || null,
      cost: t.cost != null ? t.cost : null, costText: t.cost != null ? money(t.cost) : null,
      schedule: t.schedule || [], signed: !!c, consent: c,
      signedLabel: c ? `Podpisano ${U.fmtDate(c.at)} ${String(c.at).slice(11, 16)} (${c.method})` : null
    };
  }
  r.get('/api/parent/consents', (ctx) => {
    const db = ctx.db; const s = pickStudent(ctx);
    const trips = db.col('trips').filter((t) => (t.studentIds || []).includes(s.id) || (t.classIds || []).includes(s.classId));
    return {
      studentId: s.id, student: sName(s),
      trips: trips.map((t) => tripConsentView(db, t, s.id)),
      pending: trips.filter((t) => !(t.consents || {})[s.id]).length,
      method: db.data.config.tripConsentMethod || 'app-auth',
      note: 'Podpis w aplikacji jest równoważny podpisowi na papierze: autoryzujemy go powtórnym podaniem hasła do konta opiekuna.'
    };
  }, PARENT);

  r.post('/api/parent/trips/:id/consent', (ctx) => {
    const db = ctx.db; const b = ctx.body || {}; const t = db.get('trips', ctx.params.id);
    if (!t) throw httpError(404, 'Nie ma takiej wycieczki.');
    const s = pickStudent(ctx);
    assertMayDecide(ctx, s.id, 'zgodę na wycieczkę');
    if (!(t.studentIds || []).includes(s.id) && !(t.classIds || []).includes(s.classId)) throw httpError(400, 'To dziecko nie jest na liście uczestników tej wycieczki.', { code: 'not_participant' });
    if (b.agree === false) throw httpError(400, 'Zaznacz zapoznanie się z regulaminem i zgodę na udział dziecka.', { code: 'not_agreed' });
    if (!C.verifyPassword(String(b.password || ''), ctx.user.passwordHash)) {
      ctx.audit({ action: 'trip_consent_auth_failed', entity: 'trips', entityId: t.id, after: { studentId: s.id }, reason: 'Błędne hasło przy podpisie zgody' });
      throw httpError(401, 'Podpis wymaga potwierdzenia hasłem do konta opiekuna. Hasło jest nieprawidłowe.', { code: 'bad_password' });
    }
    t.consents = t.consents || {};
    if (t.consents[s.id]) throw httpError(409, 'Zgoda dla tego dziecka została już podpisana.', { code: 'already_signed', consent: t.consents[s.id] });
    const consent = { signedBy: ctx.user.id, signedByName: D.userLabel(ctx.user), at: U.now(), method: 'app-auth', ip: ctx.ip || null, agreedRegulations: true };
    t.consents[s.id] = consent; db.save();
    N.createNotification(db, t.leaderId, 'trip', `Zgoda podpisana: ${sName(s)} — „${t.name}”. Podpisanych zgód: ${Object.keys(t.consents).length} z ${(t.studentIds || []).length}.`, { link: '/moduly' });
    ctx.audit({ action: 'trip_consent_signed', entity: 'trips', entityId: t.id, after: { studentId: s.id, signedBy: ctx.user.id, method: 'app-auth' }, reason: 'Elektroniczna zgoda opiekuna (autoryzacja hasłem)' });
    return {
      ok: true, tripId: t.id, studentId: s.id, consent,
      signedCount: Object.keys(t.consents).length, participants: (t.studentIds || []).length,
      confirmation: `Zgoda podpisana ${U.fmtDate(consent.at)} ${consent.at.slice(11, 16)} przez ${consent.signedByName}. Autoryzacja: hasło do konta w dzienniku.`
    };
  }, PARENT);

  /* ================================================================ 3.7.13 rozdzielone konta opiekunów */
  r.get('/api/parent/profile', (ctx) => {
    const u = ctx.user;
    return {
      id: u.id, name: D.userLabel(u), login: u.login,
      contact: { phone: u.phone || null, email: u.email || null, address: u.address || null },
      separateAccount: !!u.separateAccount, custodyNote: u.custodyNote || null,
      children: childrenOf(ctx.db, u).map((s) => ({ studentId: s.id, name: sName(s), classId: s.classId })),
      note: 'Dane kontaktowe tego konta są widoczne wyłącznie dla Ciebie i dla szkoły. Drugi opiekun ich nie widzi.'
    };
  }, PARENT);

  r.get('/api/parent/guardians', (ctx) => {
    const db = ctx.db; const s = pickStudent(ctx);
    const others = (s.parentIds || []).filter((id) => id !== ctx.user.id).map((id) => db.get('users', id)).filter(Boolean);
    return {
      studentId: s.id, student: sName(s),
      me: { id: ctx.user.id, name: D.userLabel(ctx.user), contact: { phone: ctx.user.phone || null, email: ctx.user.email || null } },
      coGuardians: others.map((u) => ({
        id: u.id, name: D.userLabel(u), role: 'opiekun prawny', separateAccount: !!u.separateAccount,
        contactVisible: false, phone: null, email: null, address: null
      })),
      correspondenceSeparated: true,
      note: 'Każdy opiekun ma własne konto i własną skrzynkę. Korespondencja oraz dane kontaktowe drugiego opiekuna nie są udostępniane.'
    };
  }, PARENT);

  /* ================================================================ 3.7.14 zawiadomienia o zagrożeniu */
  r.get('/api/parent/warnings', (ctx) => {
    const db = ctx.db; const me = ctx.user.id;
    const kids = childrenOf(db, ctx.user).map((x) => x.id);
    const only = ctx.query.studentId ? pickStudent(ctx).id : null;
    const rows = db.col('messages')
      .filter((m) => m.kind === 'warning' && (m.toUserIds || []).includes(me))
      .filter((m) => (only ? m.studentId === only : (!m.studentId || kids.includes(m.studentId))))
      /* S3-04 — zawiadomienie o zagrożeniu oceną jest pismem o ocenach: opiekun z zakresem
         informacyjnym („court-restricted”) go nie czyta, tak samo jak nie czyta samych ocen. */
      .filter((m) => !m.studentId || D.guardianKindAllowed(D.guardianStanding(db, ctx.user, m.studentId).scope, m.kind))
      .sort((a, b) => (a.at < b.at ? 1 : -1))
      .map((m) => warningView(db, m, me));
    return {
      warnings: rows, toAck: rows.filter((w) => w.requiresAck && !w.acked).length,
      requiredDaysBefore: db.data.config.warningDaysBeforeClassification || 30,
      note: 'Zawiadomienie o zagrożeniu oceną niedostateczną wysyłamy najpóźniej 30 dni przed klasyfikacją. Dziennik śledzi dostarczenie, odczyt i potwierdzenie odbioru.'
    };
  }, PARENT);

  r.post('/api/parent/warnings/:id/ack', (ctx) => {
    const db = ctx.db; const m = db.get('messages', ctx.params.id);
    if (!m) throw httpError(404, 'Nie ma takiego zawiadomienia.');
    if (!(m.toUserIds || []).includes(ctx.user.id)) throw httpError(403, 'Potwierdzenie odbioru składa adresat zawiadomienia.', { code: 'forbidden' });
    if (m.studentId) assertMayDecide(ctx, m.studentId, 'potwierdzenie odbioru zawiadomienia');
    if (!m.requiresAck) throw httpError(400, 'To zawiadomienie nie wymaga potwierdzenia odbioru.', { code: 'ack_not_required' });
    m.ackBy = m.ackBy || {}; m.readBy = m.readBy || {};
    if (!m.ackBy[ctx.user.id]) {
      const at = U.now(); m.ackBy[ctx.user.id] = at; if (!m.readBy[ctx.user.id]) m.readBy[ctx.user.id] = at; db.save();
      N.createNotification(db, m.fromUserId, 'ack', `Potwierdzono odbiór zawiadomienia: ${m.subject}`, { link: '/wiadomosci?id=' + m.id });
    }
    ctx.audit({ action: 'warning_acked', entity: 'messages', entityId: m.id, after: { at: m.ackBy[ctx.user.id] }, reason: 'Potwierdzenie odbioru przez opiekuna' });
    const w = warningView(db, m, ctx.user.id);
    return { ok: true, warning: w, ackAt: w.ackAt, receipt: `Potwierdzenie odbioru zapisano ${U.fmtDate(w.ackAt)} ${String(w.ackAt).slice(11, 16)}.` };
  }, PARENT);

  /* ================================================================ 3.7.15 eksport roczny do PDF */
  r.get('/api/parent/export', (ctx) => {
    const db = ctx.db; const s = pickStudent(ctx); const cfg = db.data.config;
    D.assertMayReadPupilRecord(db, ctx.user, s.id, 'grades');
    const year = cfg.year; const from = cfg.semesters[0].from; const to = cfg.semesters[cfg.semesters.length - 1].to;
    const sections = cfg.semesters.map((sem) => {
      const g = gradesView(db, s, sem.id);
      const rows = g.subjects.map((x) => `<tr><td>${D.xmlEsc(x.subject)}</td><td>${D.xmlEsc(x.grades.map((y) => y.value + (y.weight ? ' (w' + y.weight + ')' : '')).join(', ') || '—')}</td><td>${D.xmlEsc(U.fmtAvg(x.average))}</td><td>${D.xmlEsc(x.final || x.proposed || '—')}</td></tr>`).join('');
      return `<h2>${D.xmlEsc(sem.name)} · ${D.xmlEsc(sem.from)} – ${D.xmlEsc(sem.to)}</h2>
        <table><caption>Oceny — ${D.xmlEsc(sem.name)}</caption><thead><tr><th scope="col">Przedmiot</th><th scope="col">Oceny cząstkowe</th><th scope="col">Średnia</th><th scope="col">Ocena</th></tr></thead>
        <tbody>${rows || '<tr><td colspan="4">Brak ocen w tym okresie.</td></tr>'}</tbody></table>`;
    }).join('');
    const att = D.attendanceFor(db, s.id, from, to);
    const comments = db.col('grades').filter((g) => g.studentId === s.id && !g.deleted && g.comment).map((g) => `<tr><td>${D.xmlEsc(U.fmtDate(g.date))}</td><td>${D.xmlEsc((db.get('subjects', g.subjectId) || {}).name || g.subjectId)}</td><td>${D.xmlEsc(g.value)}</td><td>${D.xmlEsc(g.comment)}</td></tr>`).join('');
    const body = `<h1>Historia ocen i frekwencji · ${D.xmlEsc(sName(s))}</h1>
      <p class="note">Klasa ${D.xmlEsc(s.classId)} · rok szkolny ${D.xmlEsc(year)} · wydruk na wniosek opiekuna ${D.xmlEsc(D.userLabel(ctx.user))}.</p>
      ${sections}
      <h2>Frekwencja ${D.xmlEsc(U.fmtDate(from))} – ${D.xmlEsc(U.fmtDate(to))}</h2>
      <table><caption>Frekwencja ${D.xmlEsc(U.fmtDate(from))} – ${D.xmlEsc(U.fmtDate(to))}</caption><thead><tr><th scope="col">Godziny</th><th scope="col">Obecności</th><th scope="col">Nieusprawiedliwione</th><th scope="col">Usprawiedliwione</th><th scope="col">Spóźnienia</th><th scope="col">Minuty spóźnień</th><th scope="col">Frekwencja</th></tr></thead>
      <tbody><tr><td>${att.total}</td><td>${att.ob}</td><td>${att.nb}</td><td>${att.u + att.zw}</td><td>${att.sp}</td><td>${att.lateMinutes}</td><td>${D.xmlEsc(U.fmtAvg(att.percent))} %</td></tr></tbody></table>
      ${comments ? `<h2>Komentarze nauczycieli do ocen</h2><table><caption>Komentarze nauczycieli do ocen</caption><thead><tr><th scope="col">Data</th><th scope="col">Przedmiot</th><th scope="col">Ocena</th><th scope="col">Komentarz</th></tr></thead><tbody>${comments}</tbody></table>` : ''}
      <p class="note">Dokument jest wydrukiem z dziennika elektronicznego (HTML gotowy do druku — zapisz jako PDF przez Ctrl+P → „Zapisz jako PDF”). Nie zastępuje świadectwa szkolnego.</p>`;
    ctx.audit({ action: 'parent_export', entity: 'student', entityId: s.id, after: { year, format: 'print-html' }, reason: 'Eksport historii ocen i frekwencji na koniec roku' });
    if (ctx.query.json === '1') return { studentId: s.id, year, from, to, attendance: att, html: body };
    return {
      __raw: true, contentType: 'text/html; charset=utf-8',
      body: D.printHtml(`Historia ocen i frekwencji — ${sName(s)}`, body, {
        school: cfg.school.name, schoolMeta: cfg.school.address, docNo: 'Wydruk dla opiekuna', date: U.fmtDate(D.today(db)), printed: U.fmtDate(D.today(db))
      })
    };
  }, PARENT);

  void app;
}
module.exports = { register, scanFirstPeriodAbsences, lessonsOfStudent, childrenOf };
