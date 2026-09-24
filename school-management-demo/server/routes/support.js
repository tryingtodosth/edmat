'use strict';
/* 3.4 — Zespół pomocy psychologiczno-pedagogicznej: WOPFU, IPET, dziennik zajęć innych,
   notatki poufne (szyfrowanie asymetryczne), rejestr zdarzeń (Niebieska Karta / nadzór kuratora),
   terapia logopedyczna, ewaluacja skuteczności pomocy, monitoring frekwencji.
   Właściciel kolekcji: otherActivities, wopfu, ipet, confidentialNotes, speechSessions,
   ipetImplementations, supportEvaluations, supportDocuments, incidents, supportSessions,
   communityInterviews, reportRequests, attendanceAlerts. */
const nodeCrypto = require('node:crypto');
const D = require('../lib/domain');
const C = require('../lib/crypto');
const { httpError } = require('../lib/router');
const { validateUpload } = require('../lib/uploads');
const U = require('../lib/util');
const LA = require('../lib/log-access');
const { countsFor } = require('./log-comments');

const SPECIALISTS = ['counselor', 'psychologist', 'specialEducator', 'speechTherapist', 'supportTeacher'];
const TEAM = SPECIALISTS.concat(['principal']);
const ADMINISTRATION = ['registrar', 'admin', 'principal'];
const DOC_EDITORS = ['specialEducator', 'psychologist', 'counselor'];
const NOTE_AUTHORS = ['psychologist', 'counselor', 'specialEducator', 'speechTherapist'];
const SESSION_PLANNERS = ['specialEducator', 'psychologist', 'counselor', 'speechTherapist', 'supportTeacher'];

/* ---------- small helpers ---------- */
const nextYear = (y) => { const p = String(y).split('/').map(Number); return (p[0] + 1) + '/' + (p[1] + 1); };
const yearOf = (db) => db.data.config.year;
function mustStudent(db, studentId) { const s = db.get('students', studentId); if (!s) throw httpError(404, 'Nie ma takiego ucznia.'); return s; }
function userName(db, uid) { return D.userLabel(db.get('users', uid)); }
function studentName(db, sid) { const s = db.get('students', sid); return s ? `${s.lastName} ${s.firstName}` : ''; }
/** Everyone in the support team has an RSA key pair; subject teachers get one the first time a note is addressed to them. */
function ensureKeys(db, userId) {
  const u = db.get('users', userId); if (!u) throw httpError(404, 'Nie ma takiego użytkownika.');
  if (!u.publicKey || !u.privateKey) { const k = C.generateKeyPair(); u.publicKey = k.publicKey; u.privateKey = k.privateKey; db.save(); }
  return u;
}
function isSchoolDay(db, d) { const cfg = db.data.config; return U.weekday(d) <= 5 && !(cfg.daysOff || []).some((x) => x.date === d) && !(cfg.holidays || []).some((h) => d >= h.from && d <= h.to); }
function studentInLesson(db, lesson, studentId) { if (!lesson.groupId) return true; const g = db.get('groups', lesson.groupId); return !!g && (g.studentIds || []).includes(studentId); }
function parentOf(db, user, studentId) { return user.role === 'parent' && (user.childrenIds || []).includes(studentId); }
/** Dokumentacja pomocy p-p to dane szczególnej kategorii (art. 9 RODO): zawsze dotyczy jednego
    wskazanego ucznia, a nauczyciel przedmiotu widzi ją tylko dla uczniów, których faktycznie uczy. */
function assertSupportSubject(ctx, studentId) {
  const db = ctx.db, user = ctx.user;
  if (!studentId) throw httpError(400, 'Wskaż ucznia (studentId) — dokumentacja pomocy psychologiczno-pedagogicznej nie jest udostępniana zbiorczo.', { code: 'no_student' });
  const s = mustStudent(db, studentId);
  if (TEAM.includes(user.role)) return s;
  const teaches = D.isHomeroomOf(db, user, s.classId)
    || db.col('timetable').some((t) => t.classId === s.classId && t.teacherId === user.id)
    || db.col('lessons').some((l) => l.classId === s.classId && (l.teacherId === user.id || l.substituteTeacherId === user.id));
  if (!teaches) throw httpError(403, 'Dokumentację pomocy psychologiczno-pedagogicznej widzi zespół pomocy oraz nauczyciele uczący tego ucznia.', { code: 'forbidden' });
  return s;
}
/* Ta sama bramka, ale bez wyjątku — dla resolverów komentarzy (lib/log-access), które zamiast
   403/404 oddają po prostu `null`. Zawsze przez `assertSupportSubject`, żeby nie rozjechać się z trasą. */
function maySeeSupportSubject(db, user, studentId) {
  try { assertSupportSubject({ db, user }, studentId); return true; } catch (e) { return false; }
}
/** Identyfikator wpisu „Historii wersji” WOPFU dla komentarzy: <id dokumentu>:<nr wersji>. */
const wopfuVersionEntryId = (w, v) => w.id + ':' + v.no;
const wopfuVersionEntryIds = (w) => (w && w.versions ? w.versions.map((v) => wopfuVersionEntryId(w, v)) : []);

function teachersOfClass(db, classId) {
  const ids = [...new Set(db.col('timetable').filter((t) => t.classId === classId).map((t) => t.teacherId))];
  const cls = db.get('classes', classId); if (cls && cls.homeroomTeacherId && !ids.includes(cls.homeroomTeacherId)) ids.push(cls.homeroomTeacherId);
  return ids.map((i) => db.get('users', i)).filter(Boolean).map((u) => ({ id: u.id, name: D.userLabel(u), role: u.role, subjects: u.subjects || [] }));
}

/* ---------- 3.4.4 confidential notes ---------- */
function sealedNote(db, n) {
  return { id: n.id, studentId: n.studentId, studentName: studentName(db, n.studentId), title: n.title, kind: n.kind, at: n.at,
    authorId: n.authorId, authorName: userName(db, n.authorId), readerIds: n.readerIds, readers: n.readerIds.map((r) => userName(db, r)).join(', '),
    alg: (n.envelope && n.envelope.alg) || 'AES-256-GCM+RSA-OAEP', sealed: true,
    sealedText: 'Notatka poufna. Treść jest zaszyfrowana kluczem publicznym uprawnionych czytelników i nie może zostać odczytana przez inne konta.' };
}
/** S-08: każdy odszyfrowany odczyt notatki poufnej zostawia ślad — jeden wiersz na notatkę i żądanie. */
function auditOpenedNotes(ctx, views, where) {
  for (const v of views) {
    if (v.sealed !== false) continue;
    ctx.audit({ action: 'note_read', entity: 'confidentialNotes', entityId: v.id, after: { studentId: v.studentId, via: where }, reason: where === 'list' ? 'Odczyt notatki poufnej z listy' : 'Odczyt notatki poufnej w karcie ucznia' });
  }
  return views;
}
function openNote(db, user, n) {
  const view = sealedNote(db, n);
  if (!n.readerIds.includes(user.id)) return view;
  const me = db.get('users', user.id); if (!me || !me.privateKey) return view;
  const text = C.decryptFor(n.envelope, user.id, me.privateKey);
  if (text == null) return view;
  return Object.assign(view, { sealed: false, sealedText: undefined, text });
}

/* ---------- 3.4.12 password-protected attachment ---------- */
function encryptWithPassword(buf, password) {
  const salt = nodeCrypto.randomBytes(16); const key = nodeCrypto.scryptSync(String(password), salt, 32); const iv = nodeCrypto.randomBytes(12);
  const c = nodeCrypto.createCipheriv('aes-256-gcm', key, iv); const ct = Buffer.concat([c.update(buf), c.final()]);
  return { alg: 'AES-256-GCM/scrypt', salt: salt.toString('hex'), iv: iv.toString('base64'), tag: c.getAuthTag().toString('base64'), data: ct.toString('base64'), size: buf.length };
}
function decryptWithPassword(enc, password) {
  try {
    const key = nodeCrypto.scryptSync(String(password), Buffer.from(enc.salt, 'hex'), 32);
    const d = nodeCrypto.createDecipheriv('aes-256-gcm', key, Buffer.from(enc.iv, 'base64')); d.setAuthTag(Buffer.from(enc.tag, 'base64'));
    return Buffer.concat([d.update(Buffer.from(enc.data, 'base64')), d.final()]);
  } catch (e) { return null; }
}

/* S-16 — hasło do skanu weryfikuje `scryptSync`, więc każda próba kosztuje pełne wyprowadzenie
   klucza: bez okna prób jeden pracownik z dostępem do wywiadu zgaduje hasło w pętli i przy okazji
   zajmuje proces. Przesuwane okno w pamięci, osobne dla każdej pary (użytkownik, wywiad):
   ATT_LIMIT nieudanych prób w ATT_WINDOW_MS blokuje odczyt na ATT_LOCK_MS, blokada jest audytowana
   raz. Poprawne hasło czyści okno, więc normalna praca nigdy go nie dotknie.
   Styl jak limiter logowania w `server/auth.js`; celowo bez importu stamtąd — ten plik zostaje
   samodzielny. Prototyp jednoprocesowy ⇒ Map w pamięci wystarcza; przy wielu węzłach okno musi
   przenieść się do wspólnego magazynu. */
const ATT_LIMIT = 5, ATT_WINDOW_MS = 15 * 60000, ATT_LOCK_MS = 15 * 60000, ATT_MAX_KEYS = 5000;
const attachmentAttempts = new Map();                         // 'userId|interviewId' → { hits: [ms], lockedUntil, audited }
const attachmentKey = (ctx, row) => String(ctx.user ? ctx.user.id : '') + '|' + String(row.id);
function pruneAttachmentAttempts() {
  const t = Date.now();
  for (const [k, e] of attachmentAttempts) { const last = e.hits.length ? e.hits[e.hits.length - 1] : 0; if (e.lockedUntil < t && t - last > ATT_WINDOW_MS) attachmentAttempts.delete(k); }
  if (attachmentAttempts.size >= ATT_MAX_KEYS) attachmentAttempts.clear();
}
/** Throws 429 while this user is locked out of this interview's scan. */
function assertAttachmentNotLocked(ctx, row) {
  const t = Date.now(); const e = attachmentAttempts.get(attachmentKey(ctx, row));
  if (!e || e.lockedUntil <= t) return;
  const mins = Math.max(1, Math.ceil((e.lockedUntil - t) / 60000));
  throw httpError(429, `Zbyt wiele nieudanych prób podania hasła do skanu. Ze względów bezpieczeństwa odczyt tego wywiadu został tymczasowo zablokowany — spróbuj ponownie za ${mins} ${mins === 1 ? 'minutę' : mins < 5 ? 'minuty' : 'minut'}.`,
    { code: 'rate_limited', retryAfterSeconds: Math.ceil((e.lockedUntil - t) / 1000) });
}
/** Records one wrong password; locks the window (and audits it once) when the limit is hit. */
function noteAttachmentFailure(ctx, row) {
  const t = Date.now(); const key = attachmentKey(ctx, row);
  let e = attachmentAttempts.get(key);
  if (!e) { if (attachmentAttempts.size >= ATT_MAX_KEYS) pruneAttachmentAttempts(); e = { hits: [], lockedUntil: 0, audited: false }; attachmentAttempts.set(key, e); }
  e.hits = e.hits.filter((x) => t - x < ATT_WINDOW_MS); e.hits.push(t);
  if (e.hits.length >= ATT_LIMIT && e.lockedUntil <= t) {
    e.lockedUntil = t + ATT_LOCK_MS;
    if (!e.audited) {
      e.audited = true;
      ctx.audit({ action: 'community_interview_attachment_rate_limited', entity: 'communityInterviews', entityId: row.id,
        after: { attempts: e.hits.length, lockedForMinutes: Math.round(ATT_LOCK_MS / 60000) },
        reason: 'Przekroczono limit nieudanych prób podania hasła do skanu' });
    }
  }
  if (attachmentAttempts.size > ATT_MAX_KEYS / 2) pruneAttachmentAttempts();
}
function clearAttachmentFailures(ctx, row) { const key = attachmentKey(ctx, row); const e = attachmentAttempts.get(key); if (e && e.lockedUntil <= Date.now()) attachmentAttempts.delete(key); }

/* ---------- 3.4.15 attendance monitoring ---------- */
function absentAllDay(db, studentId, date) {
  const rows = db.col('attendance').filter((a) => a.studentId === studentId && a.date === date && !a.draft);
  return rows.length > 0 && rows.every((a) => a.status === 'nb');
}
/** A parent notification = any excuse / planned absence row covering the day (not rejected). */
function parentNotified(db, studentId, date) {
  return db.col('excuses').some((e) => e.studentId === studentId && e.from <= date && (e.to || e.from) >= date && e.status !== 'rejected');
}
/** Consecutive school days with a full unexcused absence, ending on or before today. */
function absenceRun(db, studentId) {
  const t = D.today(db); const days = []; let d = t;
  for (let i = 0; i < 60 && days.length < 25; i++) { if (isSchoolDay(db, d)) days.push(d); d = U.addDays(d, -1); }
  let run = [];
  for (const day of days) {
    if (absentAllDay(db, studentId, day) && !parentNotified(db, studentId, day)) run.push(day);
    else { if (run.length >= 3) break; run = []; }
  }
  return run.slice().reverse();
}
/** Re-scan welfare students; create (once) an alert row + a notification for the counselor. Returns the open alerts. */
function scanAttendanceAlerts(db) {
  const open = [];
  for (const s of db.col('students').filter((x) => x.socialWelfare && x.status === 'active')) {
    const run = absenceRun(db, s.id);
    if (run.length < 3) continue;
    const key = s.id + ':' + run[run.length - 1];
    let a = db.one('attendanceAlerts', (x) => x.key === key);
    if (!a) {
      a = db.insert('attendanceAlerts', { key, studentId: s.id, classId: s.classId, kind: 'welfare-3-days', days: run, at: U.now(), resolved: false, notifiedUserIds: [], contacts: [] });
      const text = `Uczeń objęty pomocą społeczną: ${studentName(db, s.id)} (${s.classId}) — ${run.length} dni nieobecności bez informacji od rodzica (${run.map(U.fmtDate).join(', ')}).`;
      for (const c of db.col('users').filter((u) => u.role === 'counselor')) { D.notify(db, c.id, 'attendance-alert', text, { crisis: true, link: '/pomoc?studentId=' + s.id }); a.notifiedUserIds.push(c.id); }
      db.save();
    } else if (a.days.join() !== run.join()) { a.days = run; db.save(); }
    open.push(a);
  }
  return open.filter((a) => !a.resolved);
}
function alertView(db, a) {
  return Object.assign({}, a, { studentName: studentName(db, a.studentId), daysText: a.days.map(U.fmtDate).join(', ') });
}

/** Print-ready HTML must render in the browser tab, not download. `{__raw:true}` without a filename
    currently throws in server/index.js (Content-Disposition: undefined), so the response is written here.
    See the patch requested for server/index.js. */
function sendHtml(ctx, html) {
  ctx.res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
  ctx.res.end(html);
}

/* ---------- registration ---------- */
function register(r, app) {
  /* ================================================================ komentarze do wpisów rejestrów (lib/log-access)
     Każdy resolver powtarza dokładnie bramkę trasy GET, która ten rejestr wypisuje, zwężoną do
     pytającego, i oddaje wyłącznie metrykę wpisu — treść spod zamknięcia tędy nie przechodzi. */

  /* Rejestr zdarzeń (3.4.10): baza zamyka wpis na liście czytelników — pedagog prowadzący sprawę,
     dyrektorzy dopisani przy założeniu wpisu i osoby wskazane imiennie. Rola z zespołu pomocy sama
     niczego nie otwiera, więc resolver pyta wyłącznie o `readerIds`, tak jak guardIncident. */
  LA.register('support-incidents', { label: 'Rejestr zdarzeń · Niebieska Karta i nadzór kuratora', roles: TEAM, find: (db, user, entryId) => {
    const i = db.get('incidents', entryId);
    if (!i || !(i.readerIds || []).includes(user.id)) return null;
    return { id: i.id, studentId: i.studentId, classId: i.classId, kind: i.kind, openedAt: i.openedAt, caseNo: i.caseNo || '' };
  } });

  /* Historia wersji WOPFU (3.4.2): wersje widzi ten, kto może czytać dokument — czyli zespół pomocy
     oraz nauczyciel uczący tego ucznia (assertSupportSubject, jak w GET /api/support/wopfu). */
  LA.register('wopfu-versions', { label: 'Historia wersji WOPFU', roles: TEAM.concat(['teacher']), find: (db, user, entryId) => {
    const m = /^(.+):(\d+)$/.exec(String(entryId)); if (!m) return null;
    const w = db.get('wopfu', m[1]); if (!w) return null;
    const v = (w.versions || []).find((x) => String(x.no) === m[2]); if (!v) return null;
    if (!maySeeSupportSubject(db, user, w.studentId)) return null;
    return { id: entryId, wopfuId: w.id, no: v.no, at: v.at, kind: v.kind, section: v.section || null, byUserId: v.byUserId };
  } });

  /* ===== student picker + overview for the screen ===== */
  r.get('/api/support/students', (ctx) => {
    const db = ctx.db;
    return db.col('students').filter((s) => s.status === 'active').map((s) => ({
      id: s.id, name: `${s.lastName} ${s.firstName}`, rollNo: s.rollNo, classId: s.classId, socialWelfare: !!s.socialWelfare,
      hasIpet: db.col('ipet').some((x) => x.studentId === s.id), hasWopfu: db.col('wopfu').some((x) => x.studentId === s.id),
      incidents: db.col('incidents').filter((x) => x.studentId === s.id).length
    })).sort((a, b) => (a.classId + a.name).localeCompare(b.classId + b.name, 'pl'));
  }, { roles: TEAM });

  r.get('/api/support/overview', (ctx) => {
    const db = ctx.db, user = ctx.user; const sid = ctx.query.studentId; const s = mustStudent(db, sid);
    const year = ctx.query.year || yearOf(db);
    const cls = db.get('classes', s.classId);
    const notes = auditOpenedNotes(ctx, db.col('confidentialNotes').filter((n) => n.studentId === sid).map((n) => openNote(db, user, n)).sort((a, b) => (a.at < b.at ? 1 : -1)), 'overview');
    const incidents = db.col('incidents').filter((i) => i.studentId === sid);
    const canSeeIncidents = incidents.filter((i) => (i.readerIds || []).includes(user.id));
    /* S-08: karta ucznia odsłania rejestr zdarzeń tak samo jak wykaz — więc i rozlicza się tak samo. */
    for (const i of incidents) {
      const granted = canSeeIncidents.includes(i);
      i.accessLog = i.accessLog || []; i.accessLog.push({ at: U.now(), userId: user.id, ip: ctx.ip, granted });
      ctx.audit({ action: granted ? 'incident_access' : 'incident_access_denied', entity: 'incidents', entityId: i.id, reason: granted ? 'Wgląd w rejestr zdarzeń w karcie ucznia' : 'Karta ucznia: konto spoza listy czytelników' });
    }
    if (incidents.length) db.save();
    const wopfuNow = db.col('wopfu').find((w) => w.studentId === sid && w.year === year) || null;
    return {
      student: { id: s.id, name: `${s.lastName} ${s.firstName}`, rollNo: s.rollNo, classId: s.classId, socialWelfare: !!s.socialWelfare,
        homeroom: cls ? userName(db, cls.homeroomTeacherId) : '', parents: (s.parentIds || []).map((p) => userName(db, p)).join(', ') },
      year, nextYear: nextYear(year),
      wopfu: wopfuNow,
      ipet: db.col('ipet').find((i) => i.studentId === sid && i.year === year) || null,
      otherActivities: db.col('otherActivities').filter((g) => (g.studentIds || []).includes(sid)),
      notes,
      speechSessions: db.col('speechSessions').filter((x) => x.studentId === sid),
      documents: db.col('supportDocuments').filter((d) => d.studentId === sid),
      sessions: db.col('supportSessions').filter((x) => x.studentId === sid),
      interviews: db.col('communityInterviews').filter((x) => x.studentId === sid).map((x) => ({ id: x.id, date: x.date, socialWorker: x.socialWorker, notes: x.notes, attachment: x.attachment ? { name: x.attachment.name, alg: x.attachment.alg, size: x.attachment.size } : null })),
      evaluations: db.col('supportEvaluations').filter((x) => x.studentId === sid),
      implementations: db.col('ipetImplementations').filter((x) => x.studentId === sid),
      requests: db.col('reportRequests').filter((x) => x.studentId === sid),
      incidents: incidents.map((i) => (canSeeIncidents.includes(i)
        ? Object.assign({}, i, { locked: false })
        : { id: i.id, studentId: i.studentId, kind: i.kind, openedAt: i.openedAt, locked: true, sealedText: 'Dostęp ograniczony na poziomie bazy danych: rejestr widzą wyłącznie pedagog prowadzący sprawę i czytelnicy wskazani przez dyrektora.' })),
      /* liczniki komentarzy dla wierszy obu rejestrów ekranu; zamknięty wpis rejestru zdarzeń
         licznika nie dostaje — kto nie widzi wpisu, nie widzi też, ile go skomentowano. */
      comments: {
        incidents: countsFor(db, user, 'support-incidents', canSeeIncidents.map((i) => i.id)),
        wopfuVersions: countsFor(db, user, 'wopfu-versions', wopfuVersionEntryIds(wopfuNow))
      },
      alerts: scanAttendanceAlerts(db).map((a) => alertView(db, a)),
      teachers: teachersOfClass(db, s.classId),
      specialists: db.col('users').filter((u) => SPECIALISTS.includes(u.role) && u.publicKey).map((u) => ({ id: u.id, name: D.userLabel(u), role: u.role }))
    };
  }, { roles: TEAM });

  /* ===== 3.4.1 Dziennik zajęć innych ===== */
  r.get('/api/support/other-activities', (ctx) => {
    const db = ctx.db; const sid = ctx.query.studentId, cid = ctx.query.classId;
    return db.col('otherActivities').filter((g) => (!sid || (g.studentIds || []).includes(sid)) && (!cid || g.classIds.includes(cid)));
  }, { roles: TEAM });

  r.post('/api/support/other-activities', (ctx) => {
    const db = ctx.db; const b = ctx.body || {};
    if (!b.name) throw httpError(400, 'Podaj nazwę zajęć.');
    const studentIds = (b.studentIds || []).filter((x) => db.get('students', x));
    if (!studentIds.length) throw httpError(400, 'Wskaż co najmniej jednego ucznia.');
    const g = db.insert('otherActivities', {
      id: U.id('oa'), name: b.name, form: b.form || 'emo', specialistId: ctx.user.id, year: yearOf(db),
      classIds: [...new Set(studentIds.map((x) => db.get('students', x).classId))],
      goals: b.goals || [], studentIds, sessions: []
    });
    ctx.audit({ action: 'other_activities_create', entity: 'otherActivities', entityId: g.id, after: { name: g.name, studentIds } });
    return g;
  }, { roles: SPECIALISTS });

  r.post('/api/support/other-activities/:id/sessions', (ctx) => {
    const db = ctx.db; const g = db.get('otherActivities', ctx.params.id); if (!g) throw httpError(404, 'Nie ma takiego dziennika zajęć.');
    const b = ctx.body || {};
    if (!b.date || !b.topic) throw httpError(400, 'Podaj datę i temat zajęć.');
    const attendance = (b.attendance || g.studentIds.map((sid) => ({ studentId: sid, status: 'ob' })))
      .filter((a) => g.studentIds.includes(a.studentId))
      .map((a) => ({ studentId: a.studentId, status: ['ob', 'nb', 'u', 'zw', 'sp'].includes(a.status) ? a.status : 'ob' }));
    const ses = { id: U.id('oas'), date: b.date, topic: b.topic, goal: b.goal || '', note: b.note || '', attendance, byUserId: ctx.user.id, at: U.now() };
    g.sessions.push(ses); db.save();
    ctx.audit({ action: 'other_activities_session', entity: 'otherActivities', entityId: g.id, after: { date: ses.date, topic: ses.topic, attendance } });
    return ses;
  }, { roles: SPECIALISTS });

  /* ===== 3.4.2 WOPFU ===== */
  const WOPFU_SECTIONS = ['mocne', 'bariery', 'zalecenia'];
  function canEditWopfu(db, user, w, section) {
    if (DOC_EDITORS.includes(user.role) || user.id === w.createdBy) return true;
    const e = (w.editors || []).find((x) => x.userId === user.id);
    if (!e) return false;
    return e.scope === 'all' || (e.sections || []).includes(section);
  }
  r.get('/api/support/wopfu', (ctx) => {
    const db = ctx.db; const sid = ctx.query.studentId; const year = ctx.query.year || yearOf(db);
    assertSupportSubject(ctx, sid);
    const list = db.col('wopfu').filter((w) => w.studentId === sid && (!ctx.query.year || w.year === year));
    /* liczniki komentarzy do „Historii wersji”; klucz wiersza = <id dokumentu>:<nr wersji> */
    return { items: list, item: list.find((w) => w.year === year) || null,
      comments: countsFor(db, ctx.user, 'wopfu-versions', list.flatMap((w) => wopfuVersionEntryIds(w))) };
  }, { roles: TEAM.concat(['teacher']) });

  r.post('/api/support/wopfu', (ctx) => {
    const db = ctx.db; const b = ctx.body || {}; const s = mustStudent(db, b.studentId);
    const year = b.year || yearOf(db);
    if (db.col('wopfu').some((w) => w.studentId === s.id && w.year === year)) throw httpError(409, 'WOPFU dla tego ucznia w tym roku już istnieje.', { code: 'exists' });
    const w = db.insert('wopfu', {
      id: U.id('wop'), studentId: s.id, classId: s.classId, year, basis: b.basis || '',
      sections: Object.assign({ mocne: '', bariery: '', zalecenia: '' }, b.sections || {}),
      editors: [{ userId: ctx.user.id, scope: 'all', invitedBy: ctx.user.id, invitedAt: U.now(), accepted: true }],
      versions: [{ no: 1, at: U.now(), byUserId: ctx.user.id, kind: 'create', section: null, before: null, after: null, reason: 'Utworzenie dokumentu' }],
      createdBy: ctx.user.id, rolledFrom: null
    });
    ctx.audit({ action: 'wopfu_create', entity: 'wopfu', entityId: w.id, after: { studentId: s.id, year } });
    return w;
  }, { roles: DOC_EDITORS });

  r.patch('/api/support/wopfu/:id', (ctx) => {
    const db = ctx.db; const w = db.get('wopfu', ctx.params.id); if (!w) throw httpError(404, 'Nie ma takiego dokumentu WOPFU.');
    const b = ctx.body || {}; const sections = b.sections || {};
    const changed = [];
    for (const k of Object.keys(sections)) {
      if (!WOPFU_SECTIONS.includes(k)) throw httpError(400, 'Nieznana sekcja dokumentu: ' + k + '.');
      if (!canEditWopfu(db, ctx.user, w, k)) throw httpError(403, `Nie masz uprawnień do edycji sekcji „${k}”.`, { code: 'section_forbidden' });
      const before = w.sections[k] || '';
      const after = String(sections[k]);
      if (before === after) continue;
      w.sections[k] = after;
      const v = { no: w.versions.length + 1, at: U.now(), byUserId: ctx.user.id, kind: 'edit', section: k, before, after, reason: b.reason || 'Edycja zespołowa' };
      w.versions.push(v); changed.push(v);
    }
    db.save();
    if (changed.length) ctx.audit({ action: 'wopfu_update', entity: 'wopfu', entityId: w.id, before: changed.map((v) => v.before), after: changed.map((v) => v.after), reason: b.reason || null });
    return w;
  }, { roles: TEAM.concat(['teacher']) });

  r.post('/api/support/wopfu/:id/invite', (ctx) => {
    const db = ctx.db; const w = db.get('wopfu', ctx.params.id); if (!w) throw httpError(404, 'Nie ma takiego dokumentu WOPFU.');
    const b = ctx.body || {}; const t = db.get('users', b.userId);
    if (!t || !['teacher', 'principal', 'supportTeacher'].includes(t.role)) throw httpError(400, 'Do wspólnej redakcji można zaprosić nauczyciela uczącego w tej klasie.');
    const scope = b.scope === 'all' ? 'all' : 'sections';
    const sections = scope === 'all' ? WOPFU_SECTIONS.slice() : (b.sections && b.sections.length ? b.sections : ['mocne', 'bariery']);
    const existing = (w.editors || []).find((e) => e.userId === t.id);
    if (existing) { existing.scope = scope; existing.sections = sections; } else w.editors.push({ userId: t.id, scope, sections, invitedBy: ctx.user.id, invitedAt: U.now(), accepted: false });
    w.versions.push({ no: w.versions.length + 1, at: U.now(), byUserId: ctx.user.id, kind: 'invite', section: null, before: null, after: D.userLabel(t), reason: 'Zaproszenie do wspólnej redakcji' });
    db.save();
    D.notify(db, t.id, 'wopfu-invite', `Zaproszenie do wspólnej edycji WOPFU ucznia ${studentName(db, w.studentId)} (${w.classId}). Zakres: ${scope === 'all' ? 'cały dokument' : sections.join(', ')}.`, { link: '/pomoc?studentId=' + w.studentId });
    ctx.audit({ action: 'wopfu_invite', entity: 'wopfu', entityId: w.id, after: { userId: t.id, scope, sections } });
    return { ok: true, editors: w.editors };
  }, { roles: DOC_EDITORS });

  /* ===== 3.4.3 IPET ===== */
  r.get('/api/support/ipet', (ctx) => {
    const db = ctx.db; const sid = ctx.query.studentId; const year = ctx.query.year || yearOf(db);
    assertSupportSubject(ctx, sid);
    const list = db.col('ipet').filter((i) => i.studentId === sid);
    return { items: list, item: list.find((i) => i.year === year) || null };
  }, { roles: TEAM.concat(['teacher']) });

  r.post('/api/support/ipet', (ctx) => {
    const db = ctx.db; const b = ctx.body || {}; const s = mustStudent(db, b.studentId); const year = b.year || yearOf(db);
    if (db.col('ipet').some((i) => i.studentId === s.id && i.year === year)) throw httpError(409, 'IPET dla tego ucznia w tym roku już istnieje.', { code: 'exists' });
    const doc = db.insert('ipet', {
      id: U.id('ipe'), studentId: s.id, classId: s.classId, year, basis: b.basis || '',
      integratedActions: b.integratedActions || [],
      supportForms: (b.supportForms || []).map((f) => ({ form: f.form, name: f.name || f.form, hoursPerWeek: +f.hoursPerWeek || 0 })),
      rehabHoursPerWeek: +b.rehabHoursPerWeek || 0,
      examAccommodations: b.examAccommodations || [],
      recommendations: b.recommendations || [],
      goals: (b.goals || []).map((g, i) => ({ id: g.id || 'goal' + (i + 1), title: g.title, target: +g.target || 0, level: g.level == null ? null : +g.level })),
      versions: [{ no: 1, at: U.now(), byUserId: ctx.user.id, kind: 'create', before: null, after: null, reason: 'Utworzenie IPET' }],
      createdBy: ctx.user.id, rolledFrom: null
    });
    ctx.audit({ action: 'ipet_create', entity: 'ipet', entityId: doc.id, after: { studentId: s.id, year, supportForms: doc.supportForms, rehabHoursPerWeek: doc.rehabHoursPerWeek, examAccommodations: doc.examAccommodations } });
    return doc;
  }, { roles: DOC_EDITORS });

  r.patch('/api/support/ipet/:id', (ctx) => {
    const db = ctx.db; const doc = db.get('ipet', ctx.params.id); if (!doc) throw httpError(404, 'Nie ma takiego IPET.');
    const b = ctx.body || {}; const before = {}; const after = {};
    for (const k of ['integratedActions', 'supportForms', 'rehabHoursPerWeek', 'examAccommodations', 'recommendations', 'goals', 'basis']) {
      if (b[k] === undefined) continue; before[k] = doc[k]; doc[k] = b[k]; after[k] = b[k];
    }
    doc.versions.push({ no: doc.versions.length + 1, at: U.now(), byUserId: ctx.user.id, kind: 'edit', before, after, reason: b.reason || 'Modyfikacja IPET' });
    db.save();
    ctx.audit({ action: 'ipet_update', entity: 'ipet', entityId: doc.id, before, after, reason: b.reason || null });
    return doc;
  }, { roles: DOC_EDITORS });

  /* ===== 3.4.4 notatki poufne ===== */
  r.get('/api/support/notes', (ctx) => {
    const db = ctx.db; const sid = ctx.query.studentId;
    const list = db.col('confidentialNotes').filter((n) => !sid || n.studentId === sid).map((n) => openNote(db, ctx.user, n)).sort((a, b) => (a.at < b.at ? 1 : -1));
    return auditOpenedNotes(ctx, list, 'list');
  }, { roles: TEAM });

  r.get('/api/support/notes/:id', (ctx) => {
    const db = ctx.db; const n = db.get('confidentialNotes', ctx.params.id); if (!n) throw httpError(404, 'Nie ma takiej notatki.');
    if (!n.readerIds.includes(ctx.user.id)) {
      ctx.audit({ action: 'note_access_denied', entity: 'confidentialNotes', entityId: n.id, reason: 'Konto spoza listy uprawnionych czytelników' });
      throw httpError(403, 'Notatka jest zaszyfrowana dla innych odbiorców. Widoczne są wyłącznie metadane.', { code: 'not_a_reader', sealed: sealedNote(db, n) });
    }
    ctx.audit({ action: 'note_read', entity: 'confidentialNotes', entityId: n.id });
    return openNote(db, ctx.user, n);
  }, { roles: TEAM });

  r.post('/api/support/notes', (ctx) => {
    const db = ctx.db; const b = ctx.body || {}; mustStudent(db, b.studentId);
    if (!b.text || !String(b.text).trim()) throw httpError(400, 'Notatka nie może być pusta.');
    const readerIds = [...new Set([ctx.user.id].concat(b.readerIds || []))];
    /* S-18: najpierw rola, dopiero potem klucze — błędne żądanie nie kosztuje generowania RSA-2048 na każdy id. */
    const candidates = readerIds.map((uid) => {
      const u = db.get('users', uid); if (!u) throw httpError(404, 'Nie ma takiego użytkownika.');
      if (!SPECIALISTS.includes(u.role) && u.role !== 'principal') throw httpError(400, 'Czytelnikiem notatki poufnej może być wyłącznie specjalista lub wskazany zastępca.');
      return u;
    });
    const readers = candidates.map((u) => { const k = ensureKeys(db, u.id); return { userId: k.id, publicKey: k.publicKey }; });
    const envelope = C.encryptForReaders(String(b.text), readers);
    const n = db.insert('confidentialNotes', {
      id: U.id('cnote'), studentId: b.studentId, title: b.title || 'Notatka z interwencji', kind: b.kind || 'intervention',
      authorId: ctx.user.id, readerIds, envelope, at: U.now(), exportable: false
    });
    ctx.audit({ action: 'note_create', entity: 'confidentialNotes', entityId: n.id, after: { studentId: b.studentId, readerIds, encrypted: true } });
    return sealedNote(db, n);
  }, { roles: NOTE_AUTHORS });

  /* ===== 3.4.5 eksport XML klasy (administracja) ===== */
  r.get('/api/support/export/xml', (ctx) => {
    const db = ctx.db; const classId = ctx.query.classId; const cls = db.get('classes', classId);
    if (!cls) throw httpError(404, 'Nie ma takiej klasy.');
    const x = D.xmlEsc; const cfg = db.data.config;
    const groups = db.col('otherActivities').filter((g) => g.studentIds.some((sid) => (cls.studentIds || []).includes(sid)));
    const lines = [];
    lines.push('<?xml version="1.0" encoding="UTF-8"?>');
    lines.push(`<eksportKlasy szkola="${x(cfg.school.name)}" rspo="${x(cfg.school.rspo)}" klasa="${x(cls.name)}" rok="${x(cfg.year)}" wygenerowano="${x(U.now())}" przez="${x(D.userLabel(ctx.user))}">`);
    lines.push('  <!-- Eksport obejmuje wyłącznie formalne wpisy frekwencji i tematy z dziennika zajęć innych. Notatki z interwencji, diagnozy, WOPFU/IPET oraz wpisy logopedyczne nie są przekazywane. -->');
    lines.push('  <uczniowie>');
    for (const sid of cls.studentIds || []) { const s = db.get('students', sid); lines.push(`    <uczen id="${x(s.id)}" nr="${s.rollNo}" nazwisko="${x(s.lastName)}" imie="${x(s.firstName)}"/>`); }
    lines.push('  </uczniowie>');
    lines.push('  <dziennikZajecInnych>');
    for (const g of groups) {
      lines.push(`    <zajecia id="${x(g.id)}" nazwa="${x(g.name)}" forma="${x(g.form)}">`);
      for (const ses of g.sessions || []) {
        lines.push(`      <spotkanie data="${x(ses.date)}" temat="${x(ses.topic)}">`);
        for (const a of ses.attendance || []) { if (!(cls.studentIds || []).includes(a.studentId)) continue; lines.push(`        <frekwencja uczen="${x(a.studentId)}" status="${x(a.status)}"/>`); }
        lines.push('      </spotkanie>');
      }
      lines.push('    </zajecia>');
    }
    lines.push('  </dziennikZajecInnych>');
    lines.push(`  <pominieto notatkiPoufne="${db.col('confidentialNotes').filter((n) => (cls.studentIds || []).includes(n.studentId)).length}" dokumentacjaChroniona="${db.col('supportDocuments').filter((d) => d.protected && (cls.studentIds || []).includes(d.studentId)).length}" powod="Dane wrażliwe pomocy psychologiczno-pedagogicznej nie podlegają eksportowi."/>`);
    lines.push('</eksportKlasy>');
    ctx.audit({ action: 'support_export_xml', entity: 'classes', entityId: cls.id, after: { groups: groups.length, notesExcluded: true } });
    return { __raw: true, contentType: 'application/xml; charset=utf-8', filename: `zajecia-inne-${cls.id}.xml`, body: lines.join('\n') };
  }, { roles: ADMINISTRATION });

  /* ===== 3.4.6 terapia logopedyczna (widoczna wyłącznie dla rodzica) ===== */
  r.post('/api/support/speech-sessions', (ctx) => {
    const db = ctx.db; const b = ctx.body || {}; const s = mustStudent(db, b.studentId);
    if (!b.date) throw httpError(400, 'Podaj datę zajęć.');
    const row = db.insert('speechSessions', {
      id: U.id('spe'), studentId: s.id, classId: s.classId, date: b.date, attendance: ['ob', 'nb', 'u', 'zw'].includes(b.attendance) ? b.attendance : 'ob',
      exercises: b.exercises || '', homeRecommendations: b.homeRecommendations || '', byUserId: ctx.user.id, at: U.now(),
      visibleTo: ['parent', 'speechTherapist']
    });
    ctx.audit({ action: 'speech_session_create', entity: 'speechSessions', entityId: row.id, after: { studentId: s.id, date: b.date, attendance: row.attendance } });
    D.notifyParentsOf(db, s.id, 'speech', `Nowy wpis z terapii logopedycznej z ${U.fmtDate(b.date)} — zalecenia do ćwiczeń w domu.`, { link: '/pomoc?studentId=' + s.id });   // F1: przez bramkę legitymacji opiekuna
    return row;
  }, { roles: ['speechTherapist'] });

  r.get('/api/support/speech-sessions', (ctx) => {
    const db = ctx.db, user = ctx.user; const sid = ctx.query.studentId;
    if (!sid) throw httpError(400, 'Wskaż ucznia.');
    const allowed = user.role === 'speechTherapist' || parentOf(db, user, sid);
    if (!allowed) {
      ctx.audit({ action: 'speech_session_access_denied', entity: 'speechSessions', entityId: sid, reason: 'Wpisy logopedyczne są widoczne wyłącznie na koncie rodzica tego ucznia.' });
      throw httpError(403, 'Wpisy z terapii logopedycznej są widoczne wyłącznie na koncie rodzica tego ucznia oraz logopedy.', { code: 'parent_only' });
    }
    return db.col('speechSessions').filter((x) => x.studentId === sid).map((x) => Object.assign({}, x, { therapist: userName(db, x.byUserId) }));
  }, { roles: ['speechTherapist', 'parent'] });

  /* ===== 3.4.7 dzienna realizacja zaleceń IPET ===== */
  r.get('/api/support/ipet-implementation', (ctx) => {
    const db = ctx.db; const sid = ctx.query.studentId; const s = assertSupportSubject(ctx, sid); const date = ctx.query.date || D.today(db);
    const ipet = db.col('ipet').find((i) => i.studentId === sid && i.year === yearOf(db));
    const rows = db.col('ipetImplementations').filter((x) => x.studentId === sid && x.date === date);
    const lessons = D.lessonsOn(db, date, s.classId).filter((l) => studentInLesson(db, l, sid)).map((l) => {
      const t = D.lessonTime(db, l.lessonNo); const done = rows.find((x) => x.lessonId === l.id);
      return { lessonId: l.id, lessonNo: l.lessonNo, start: t.start, end: t.end, subjectId: l.subjectId,
        subject: (db.get('subjects', l.subjectId) || {}).name || l.subjectId, room: l.room, teacher: userName(db, l.substituteTeacherId || l.teacherId),
        applied: done ? done.recommendations : [], note: done ? done.note : '', loggedAt: done ? done.at : null };
    });
    return { date, recommendations: (ipet && ipet.recommendations) || [], lessons, rows };
  }, { roles: TEAM.concat(['teacher']) });

  r.post('/api/support/ipet-implementation', (ctx) => {
    const db = ctx.db; const b = ctx.body || {}; const s = mustStudent(db, b.studentId);
    const lesson = db.get('lessons', b.lessonId); if (!lesson) throw httpError(404, 'Nie ma takiej lekcji.');
    if (lesson.classId !== s.classId) throw httpError(400, 'Lekcja nie dotyczy klasy tego ucznia.');
    const ipet = db.col('ipet').find((i) => i.studentId === s.id && i.year === yearOf(db));
    if (!ipet) throw httpError(400, 'Uczeń nie ma IPET w tym roku szkolnym.', { code: 'no_ipet' });
    const known = (ipet.recommendations || []).map((x) => (typeof x === 'string' ? x : x.id));
    const recs = (b.recommendations || []).filter((x) => known.includes(x));
    if (!recs.length) throw httpError(400, 'Zaznacz co najmniej jedno zrealizowane zalecenie z IPET.', { code: 'no_recommendations' });
    const existing = db.one('ipetImplementations', (x) => x.studentId === s.id && x.lessonId === b.lessonId);
    const before = existing ? existing.recommendations : null;
    const row = existing
      ? db.update('ipetImplementations', existing.id, { recommendations: recs, note: b.note || '', byUserId: ctx.user.id, at: U.now() })
      : db.insert('ipetImplementations', { id: U.id('ipi'), studentId: s.id, classId: s.classId, lessonId: lesson.id, date: lesson.date, lessonNo: lesson.lessonNo, subjectId: lesson.subjectId, recommendations: recs, note: b.note || '', byUserId: ctx.user.id, at: U.now() });
    ctx.audit({ action: 'ipet_implementation', entity: 'ipetImplementations', entityId: row.id, before, after: recs });
    return row;
  }, { roles: ['supportTeacher', 'specialEducator'] });

  /* ===== 3.4.8 okresowa ocena skuteczności pomocy ===== */
  function buildEvaluation(db, user, b) {
    const s = mustStudent(db, b.studentId); const sem = +b.semester || 1;
    const semCfg = D.semester(db, sem) || { from: db.data.config.semesters[0].from, to: D.today(db), name: 'Semestr ' + sem };
    const to = D.today(db) < semCfg.to ? D.today(db) : semCfg.to;
    const ipet = db.col('ipet').find((i) => i.studentId === s.id && i.year === yearOf(db));
    const groups = db.col('otherActivities').filter((g) => g.studentIds.includes(s.id));
    let planned = 0, present = 0;
    for (const g of groups) for (const ses of g.sessions || []) {
      if (ses.date < semCfg.from || ses.date > to) continue;
      const a = (ses.attendance || []).find((x) => x.studentId === s.id); if (!a) continue;
      planned++; if (a.status === 'ob' || a.status === 'sp') present++;
    }
    const goals = (b.goals && b.goals.length ? b.goals : ((ipet && ipet.goals) || [])).map((g) => {
      const level = g.level == null ? 0 : +g.level; const target = +g.target || 0;
      return { id: g.id, title: g.title, level, target, met: target > 0 && level >= target, conclusion: g.conclusion || (target > 0 && level >= target ? 'Cel osiągnięty — kontynuacja.' : 'Cel wymaga modyfikacji w semestrze 2.') };
    });
    const impl = db.col('ipetImplementations').filter((x) => x.studentId === s.id && x.date >= semCfg.from && x.date <= to);
    return {
      id: U.id('sev'), studentId: s.id, classId: s.classId, semester: sem, year: yearOf(db), period: { from: semCfg.from, to },
      basis: (ipet && ipet.basis) || b.basis || '', goals,
      attendance: { planned, present, percent: planned ? Math.round((present / planned) * 1000) / 10 : null },
      supportForms: (ipet && ipet.supportForms) || [], examAccommodations: (ipet && ipet.examAccommodations) || [],
      implementationEntries: impl.length,
      conclusions: b.conclusions || 'Zalecana kontynuacja zajęć z modyfikacją celów nieosiągniętych.',
      byUserId: user.id, at: U.now(), teamMeeting: b.teamMeeting || null
    };
  }
  r.get('/api/support/evaluations', (ctx) => ctx.db.col('supportEvaluations').filter((e) => !ctx.query.studentId || e.studentId === ctx.query.studentId), { roles: TEAM });
  r.post('/api/support/evaluations', (ctx) => {
    const db = ctx.db; const e = buildEvaluation(db, ctx.user, ctx.body || {});
    const row = db.insert('supportEvaluations', e);
    ctx.audit({ action: 'support_evaluation_create', entity: 'supportEvaluations', entityId: row.id, after: { studentId: row.studentId, semester: row.semester } });
    return row;
  }, { roles: TEAM });
  r.get('/api/support/evaluations/:id/print', (ctx) => {
    const db = ctx.db; const e = db.get('supportEvaluations', ctx.params.id); if (!e) throw httpError(404, 'Nie ma takiej ewaluacji.');
    const x = D.xmlEsc; const s = db.get('students', e.studentId); const cfg = db.data.config;
    const rows = e.goals.map((g) => `<tr><th scope="row">${x(g.title)}</th><td>${g.level} %</td><td>${g.target} %</td><td>${x(g.conclusion)}</td></tr>`).join('');
    const body = `<h1>Okresowa wielospecjalistyczna ocena skuteczności pomocy psychologiczno-pedagogicznej</h1>
<p><b>Uczeń:</b> ${x(s.lastName + ' ' + s.firstName)}, klasa ${x(s.classId)} · <b>Okres:</b> ${x(U.fmtDate(e.period.from))} – ${x(U.fmtDate(e.period.to))} (semestr ${e.semester})</p>
<p><b>Podstawa:</b> ${x(e.basis || 'orzeczenie o potrzebie kształcenia specjalnego')}</p>
<h2>Realizacja celów IPET</h2><table><caption>Realizacja celów IPET</caption><thead><tr><th scope="col">Cel</th><th scope="col">Poziom</th><th scope="col">Cel zakładany</th><th scope="col">Wniosek</th></tr></thead><tbody>${rows || '<tr><td colspan="4">Brak zdefiniowanych celów.</td></tr>'}</tbody></table>
<h2>Frekwencja na zajęciach</h2><p>${e.attendance.present} z ${e.attendance.planned} spotkań (${e.attendance.percent == null ? '—' : String(e.attendance.percent).replace('.', ',') + ' %'}). Odnotowane wpisy dziennej realizacji zaleceń: ${e.implementationEntries}.</p>
<h2>Formy pomocy i dostosowania</h2><p>${x(e.supportForms.map((f) => `${f.name || f.form} — ${f.hoursPerWeek} godz. tyg.`).join('; ') || 'brak')}. Dostosowania egzaminu zewnętrznego: ${x(e.examAccommodations.join(', ') || 'brak')}.</p>
<h2>Wnioski zespołu</h2><p>${x(e.conclusions)}</p>
<p class="note">Dokument nie zawiera treści notatek poufnych ani dokumentacji diagnostycznej poradni.</p>
<div class="sign"><span>Pedagog specjalny</span><span>Psycholog</span><span>Wychowawca</span></div>`;
    const html = D.printHtml('Ewaluacja pomocy p-p · ' + s.lastName + ' ' + s.firstName, body, {
      school: cfg.school.name, schoolMeta: cfg.school.address, docNo: 'Nr EWAL-' + e.semester + '/' + cfg.year.replace('/', '-') + '/' + s.classId,
      date: 'Kraków, ' + U.fmtDate(D.today(db)), printed: U.fmtDate(D.today(db))
    });
    ctx.audit({ action: 'support_evaluation_print', entity: 'supportEvaluations', entityId: e.id });
    return sendHtml(ctx, html);
  }, { roles: TEAM });

  /* ===== 3.4.9 udostępnianie dokumentów rodzicowi ===== */
  r.get('/api/support/documents', (ctx) => {
    const db = ctx.db, user = ctx.user; const sid = ctx.query.studentId;
    let list = db.col('supportDocuments').filter((d) => !sid || d.studentId === sid);
    if (user.role === 'parent') {
      const mine = (user.childrenIds || []);
      list = list.filter((d) => mine.includes(d.studentId) && d.shared && !d.protected);
      return list.map((d) => ({ id: d.id, studentId: d.studentId, name: d.name, kind: d.kind, date: d.date, body: d.body, shared: true, protected: false }));
    }
    return list;
  }, { roles: TEAM.concat(['parent']) });

  r.get('/api/support/documents/:id', (ctx) => {
    const db = ctx.db, user = ctx.user; const d = db.get('supportDocuments', ctx.params.id); if (!d) throw httpError(404, 'Nie ma takiego dokumentu.');
    if (user.role === 'parent') {
      if (!(user.childrenIds || []).includes(d.studentId)) throw httpError(403, 'Brak dostępu do danych tego ucznia.', { code: 'forbidden' });
      if (d.protected) {
        ctx.audit({ action: 'support_document_denied', entity: 'supportDocuments', entityId: d.id, reason: 'Dokumentacja diagnostyczna nie jest udostępniana przez dziennik.' });
        throw httpError(403, 'Dokumentacja badań diagnostycznych nie jest udostępniana przez dziennik. Rodzic odbiera ją w poradni psychologiczno-pedagogicznej.', { code: 'protected_document' });
      }
      if (!d.shared) throw httpError(403, 'Dokument nie został udostępniony.', { code: 'not_shared' });
    }
    ctx.audit({ action: 'support_document_read', entity: 'supportDocuments', entityId: d.id });
    return d;
  }, { roles: TEAM.concat(['parent']) });

  r.post('/api/support/documents', (ctx) => {
    const db = ctx.db; const b = ctx.body || {}; const s = mustStudent(db, b.studentId);
    const isProtected = b.kind === 'diagnosis' || !!b.protected;
    /* S-13: dokument może nieść skan opinii — ten sam walidator co wszędzie indziej. */
    const file = b.attachment ? validateUpload(b.attachment, { maxMB: 20, allow: ['application/pdf', 'image/png', 'image/jpeg', 'image/webp'], fallbackName: 'opinia.pdf' }) : null;
    const d = db.insert('supportDocuments', { id: U.id('sdoc'), studentId: s.id, name: b.name || 'Dokument', kind: b.kind || 'opinion', protected: isProtected, shared: isProtected ? false : !!b.shared, body: b.body || '', date: b.date || D.today(db), byUserId: ctx.user.id, attachment: file });
    ctx.audit({ action: 'support_document_create', entity: 'supportDocuments', entityId: d.id, after: { name: d.name, kind: d.kind, protected: d.protected, attachment: file ? { name: file.name, type: file.type, size: file.size } : null } });
    return d;
  }, { roles: DOC_EDITORS });

  r.post('/api/support/documents/:id/share', (ctx) => {
    const db = ctx.db; const d = db.get('supportDocuments', ctx.params.id); if (!d) throw httpError(404, 'Nie ma takiego dokumentu.');
    const shared = (ctx.body || {}).shared !== false;
    if (d.protected && shared) throw httpError(403, 'Dokumentacja diagnostyczna nie może zostać udostępniona rodzicowi przez dziennik.', { code: 'protected_document' });
    const before = d.shared; d.shared = shared; db.save();
    ctx.audit({ action: 'support_document_share', entity: 'supportDocuments', entityId: d.id, before, after: shared });
    if (shared) D.notifyParentsOf(db, d.studentId, 'document', `Udostępniono dokument: ${d.name}.`, { link: '/pomoc?studentId=' + d.studentId });
    return d;
  }, { roles: DOC_EDITORS });

  /* ===== 3.4.10 rejestr zdarzeń: Niebieska Karta / nadzór kuratora ===== */
  function incidentReaders(db, ctx, b) {
    const designated = (b.readerIds || []).filter((x) => db.get('users', x));
    const principals = db.col('users').filter((u) => u.role === 'principal').map((u) => u.id);
    return [...new Set([ctx.user.id].concat(principals).concat(designated))];
  }
  r.post('/api/support/incidents', (ctx) => {
    const db = ctx.db; const b = ctx.body || {}; const s = mustStudent(db, b.studentId);
    if (!b.text) throw httpError(400, 'Opisz zdarzenie.');
    const row = db.insert('incidents', {
      id: U.id('inc'), studentId: s.id, classId: s.classId, kind: b.kind === 'probation' ? 'probation' : 'blueCard',
      title: b.title || (b.kind === 'probation' ? 'Nadzór kuratora' : 'Procedura „Niebieska Karta”'),
      text: b.text, caseNo: b.caseNo || '', openedAt: b.openedAt || D.today(db), institution: b.institution || '',
      readerIds: incidentReaders(db, ctx, b), ownerId: ctx.user.id, restricted: true, accessLog: []
    });
    ctx.audit({ action: 'incident_create', entity: 'incidents', entityId: row.id, after: { studentId: s.id, kind: row.kind, readerIds: row.readerIds } });
    return { id: row.id, studentId: row.studentId, kind: row.kind, title: row.title, openedAt: row.openedAt, readerIds: row.readerIds };
  }, { roles: ['counselor'] });

  function guardIncident(ctx, row) {
    const granted = (row.readerIds || []).includes(ctx.user.id);
    row.accessLog.push({ at: U.now(), userId: ctx.user.id, ip: ctx.ip, granted });
    ctx.db.save();
    ctx.audit({ action: granted ? 'incident_access' : 'incident_access_denied', entity: 'incidents', entityId: row.id, reason: granted ? null : 'Konto spoza listy czytelników wskazanych przez dyrektora' });
    if (!granted) throw httpError(403, 'Rejestr zdarzeń jest ograniczony na poziomie bazy danych: dostęp mają wyłącznie pedagog prowadzący sprawę i czytelnicy wskazani przez dyrektora. Próba dostępu została zarejestrowana.', { code: 'incident_restricted' });
  }
  r.get('/api/support/incidents', (ctx) => {
    const db = ctx.db; const sid = ctx.query.studentId;
    const all = db.col('incidents').filter((i) => !sid || i.studentId === sid);
    const out = [];
    for (const i of all) {
      const granted = (i.readerIds || []).includes(ctx.user.id);
      i.accessLog.push({ at: U.now(), userId: ctx.user.id, ip: ctx.ip, granted });
      ctx.audit({ action: granted ? 'incident_access' : 'incident_access_denied', entity: 'incidents', entityId: i.id, reason: granted ? null : 'Wykaz rejestru zdarzeń' });
      out.push(granted ? Object.assign({}, i, { locked: false }) : { id: i.id, studentId: i.studentId, kind: i.kind, openedAt: i.openedAt, locked: true, sealedText: 'Dostęp ograniczony na poziomie bazy danych.' });
    }
    db.save();
    /* licznik komentarzy tylko przy wpisach otwartych dla pytającego */
    const cnt = countsFor(db, ctx.user, 'support-incidents', out.filter((x) => !x.locked).map((x) => x.id));
    out.forEach((x) => { if (!x.locked) x.comments = cnt[x.id]; });
    return out;
  }, { roles: TEAM });
  r.get('/api/support/incidents/:id', (ctx) => {
    const db = ctx.db; const row = db.get('incidents', ctx.params.id); if (!row) throw httpError(404, 'Nie ma takiego wpisu.');
    guardIncident(ctx, row);
    return row;
  }, { roles: TEAM });

  /* ===== 3.4.11 zajęcia wyrównawcze z wykrywaniem kolizji ===== */
  r.get('/api/support/sessions', (ctx) => ctx.db.col('supportSessions').filter((x) => !ctx.query.studentId || x.studentId === ctx.query.studentId), { roles: TEAM });
  r.post('/api/support/sessions', (ctx) => {
    const db = ctx.db; const b = ctx.body || {}; const s = mustStudent(db, b.studentId);
    const date = b.date, lessonNo = +b.lessonNo;
    if (!date || !lessonNo) throw httpError(400, 'Podaj datę i numer lekcji.');
    const clash = D.lessonsOn(db, date, s.classId).find((l) => l.lessonNo === lessonNo && l.status !== 'cancelled' && studentInLesson(db, l, s.id));
    if (clash) {
      const t = D.lessonTime(db, clash.lessonNo);
      ctx.audit({ action: 'support_session_conflict', entity: 'supportSessions', entityId: clash.id, after: { date, lessonNo } });
      throw httpError(409, `Kolizja: ${(db.get('subjects', clash.subjectId) || {}).name || clash.subjectId} (${clash.lessonNo}. lekcja, ${t.start}–${t.end}) to zajęcia obowiązkowe ucznia.`, {
        code: 'lesson_conflict',
        conflict: { lessonId: clash.id, date: clash.date, lessonNo: clash.lessonNo, subjectId: clash.subjectId, subject: (db.get('subjects', clash.subjectId) || {}).name || clash.subjectId, start: t.start, end: t.end, teacher: userName(db, clash.teacherId), room: clash.room }
      });
    }
    const row = db.insert('supportSessions', { id: U.id('ssn'), studentId: s.id, classId: s.classId, date, lessonNo, form: b.form || 'kk', name: b.name || 'Zajęcia korekcyjno-kompensacyjne', room: b.room || '', specialistId: ctx.user.id, at: U.now() });
    ctx.audit({ action: 'support_session_create', entity: 'supportSessions', entityId: row.id, after: { date, lessonNo, form: row.form } });
    D.notifyParentsOf(db, s.id, 'session', `Zaplanowano zajęcia: ${row.name} — ${U.fmtDate(date)}, ${lessonNo}. lekcja.`, { link: '/pomoc?studentId=' + s.id });
    return row;
  }, { roles: SESSION_PLANNERS });

  /* ===== 3.4.12 wywiad środowiskowy + skan chroniony hasłem ===== */
  r.post('/api/support/interviews', (ctx) => {
    const db = ctx.db; const b = ctx.body || {}; const s = mustStudent(db, b.studentId);
    let attachment = null;
    if (b.attachment) {
      const pw = b.password || '';
      if (String(pw).length < 8) throw httpError(400, 'Hasło do skanu musi mieć co najmniej 8 znaków.', { code: 'weak_password' });
      /* S-13: skan pisma przewodniego przechodzi przez wspólny walidator — typ deklarowany musi zgadzać
         się z treścią, a HTML-a ani SVG do dokumentacji nie przyjmujemy. */
      const contentType = String(b.attachment.contentType || 'application/pdf');
      const file = validateUpload({ name: b.attachment.name, type: contentType, dataUrl: `data:${contentType};base64,${String(b.attachment.data || '')}` },
        { maxMB: 20, allow: ['application/pdf', 'image/png', 'image/jpeg', 'image/webp'], fallbackName: 'pismo-przewodnie.pdf' });
      const buf = Buffer.from(file.dataUrl.slice(file.dataUrl.indexOf(',') + 1), 'base64');
      attachment = Object.assign({ name: file.name, contentType: file.type }, encryptWithPassword(buf, pw));
    }
    const row = db.insert('communityInterviews', {
      id: U.id('cin'), studentId: s.id, date: b.date || D.today(db), socialWorker: b.socialWorker || '', institution: b.institution || '',
      notes: b.notes || '', attachment, byUserId: ctx.user.id, at: U.now()
    });
    ctx.audit({ action: 'community_interview_create', entity: 'communityInterviews', entityId: row.id, after: { studentId: s.id, date: row.date, attachment: attachment ? { name: attachment.name, alg: attachment.alg } : null } });
    return { id: row.id, studentId: row.studentId, date: row.date, socialWorker: row.socialWorker, notes: row.notes, attachment: attachment ? { name: attachment.name, alg: attachment.alg, size: attachment.size } : null };
  }, { roles: ['counselor'] });

  r.post('/api/support/interviews/:id/attachment', (ctx) => {
    const db = ctx.db; const row = db.get('communityInterviews', ctx.params.id); if (!row) throw httpError(404, 'Nie ma takiego wywiadu.');
    if (!row.attachment) throw httpError(404, 'Do wywiadu nie dołączono skanu.');
    const pw = (ctx.body || {}).password;
    if (!pw) throw httpError(400, 'Podaj hasło do skanu.', { code: 'password_required' });
    assertAttachmentNotLocked(ctx, row);                      // S-16: zanim ruszy scrypt
    const buf = decryptWithPassword(row.attachment, pw);
    if (!buf) {
      ctx.audit({ action: 'community_interview_attachment_denied', entity: 'communityInterviews', entityId: row.id, reason: 'Nieprawidłowe hasło do skanu' });
      noteAttachmentFailure(ctx, row);                       // piąta próba to jeszcze 403, każda kolejna 429
      throw httpError(403, 'Nieprawidłowe hasło do skanu pisma przewodniego.', { code: 'bad_password' });
    }
    clearAttachmentFailures(ctx, row);
    ctx.audit({ action: 'community_interview_attachment_read', entity: 'communityInterviews', entityId: row.id });
    return { name: row.attachment.name, contentType: row.attachment.contentType, data: buf.toString('base64') };
  }, { roles: ['counselor', 'principal'] });

  /* ===== 3.4.13 przeniesienie IPET/WOPFU na nowy rok szkolny ===== */
  r.post('/api/support/rollover', (ctx) => {
    const db = ctx.db; const b = ctx.body || {}; const s = mustStudent(db, b.studentId);
    const from = b.fromYear || yearOf(db); const to = b.year || nextYear(from);
    const out = { year: to, wopfu: null, ipet: null };
    const oldW = db.col('wopfu').find((w) => w.studentId === s.id && w.year === from);
    if (oldW && !db.col('wopfu').some((w) => w.studentId === s.id && w.year === to)) {
      out.wopfu = db.insert('wopfu', Object.assign(U.clone(oldW), {
        id: U.id('wop'), year: to, rolledFrom: oldW.id, createdBy: ctx.user.id,
        versions: oldW.versions.concat([{ no: oldW.versions.length + 1, at: U.now(), byUserId: ctx.user.id, kind: 'rollover', section: null, before: from, after: to, reason: `Automatyczne przeniesienie dokumentacji na rok ${to}; wersja ${from} zachowana w historii.` }])
      }));
      ctx.audit({ action: 'wopfu_rollover', entity: 'wopfu', entityId: out.wopfu.id, before: from, after: to });
    } else out.wopfu = db.col('wopfu').find((w) => w.studentId === s.id && w.year === to) || null;
    const oldI = db.col('ipet').find((i) => i.studentId === s.id && i.year === from);
    if (oldI && !db.col('ipet').some((i) => i.studentId === s.id && i.year === to)) {
      out.ipet = db.insert('ipet', Object.assign(U.clone(oldI), {
        id: U.id('ipe'), year: to, rolledFrom: oldI.id, createdBy: ctx.user.id,
        versions: oldI.versions.concat([{ no: oldI.versions.length + 1, at: U.now(), byUserId: ctx.user.id, kind: 'rollover', before: from, after: to, reason: `Automatyczne przeniesienie IPET na rok ${to}; wersja ${from} zachowana w historii.` }])
      }));
      ctx.audit({ action: 'ipet_rollover', entity: 'ipet', entityId: out.ipet.id, before: from, after: to });
    } else out.ipet = db.col('ipet').find((i) => i.studentId === s.id && i.year === to) || null;
    if (!out.wopfu && !out.ipet) throw httpError(400, 'Uczeń nie ma dokumentacji do przeniesienia.', { code: 'nothing_to_roll' });
    return out;
  }, { roles: SPECIALISTS });

  /* ===== 3.4.14 zaszyfrowana prośba o opinię o funkcjonowaniu ucznia ===== */
  r.get('/api/support/report-requests', (ctx) => ctx.db.col('reportRequests').filter((x) => (!ctx.query.studentId || x.studentId === ctx.query.studentId)).map((x) => Object.assign({}, x, { teacherName: userName(ctx.db, x.teacherId) })), { roles: TEAM });
  r.post('/api/support/report-requests', (ctx) => {
    const db = ctx.db; const b = ctx.body || {}; const s = mustStudent(db, b.studentId);
    const t = db.get('users', b.teacherId);
    if (!t || !['teacher', 'supportTeacher', 'principal'].includes(t.role)) throw httpError(400, 'Prośbę można wysłać do nauczyciela uczącego.');
    if (!b.scope || !String(b.scope).trim()) throw httpError(400, 'Opisz, czego dotyczy prośba.');
    const teacher = ensureKeys(db, t.id); const me = ensureKeys(db, ctx.user.id);
    const text = b.text || `Proszę o opinię o funkcjonowaniu ucznia ${s.lastName} ${s.firstName} (${s.classId}) na lekcjach. Zakres: ${b.scope}. Opinia jest potrzebna na posiedzenie zespołu orzekającego poradni psychologiczno-pedagogicznej${b.meetingDate ? ' w dniu ' + U.fmtDate(b.meetingDate) : ''}.`;
    const envelope = C.encryptForReaders(text, [{ userId: teacher.id, publicKey: teacher.publicKey }, { userId: me.id, publicKey: me.publicKey }]);
    const msg = D.sendMessage(db, {
      id: U.id('msg'), fromUserId: ctx.user.id, toUserIds: [teacher.id],
      subject: `Prośba o opinię o funkcjonowaniu ucznia: ${b.scope}`,
      body: JSON.stringify(envelope), encrypted: true, confidential: true, requiresAck: true, kind: 'message'
    });
    const row = db.insert('reportRequests', { id: U.id('rrq'), studentId: s.id, teacherId: teacher.id, fromUserId: ctx.user.id, scope: b.scope, messageId: msg.id, meetingDate: b.meetingDate || null, at: U.now(), status: 'sent' });
    D.notify(db, teacher.id, 'report-request', `Zaszyfrowana prośba o opinię o funkcjonowaniu ucznia ${s.lastName} ${s.firstName} (${s.classId}).`, { link: '/wiadomosci' });
    ctx.audit({ action: 'report_request_send', entity: 'reportRequests', entityId: row.id, after: { teacherId: teacher.id, encrypted: true, messageId: msg.id } });
    return Object.assign({}, row, { teacherName: D.userLabel(teacher) });
  }, { roles: ['psychologist', 'counselor', 'specialEducator'] });

  /* ===== 3.4.15 monitoring frekwencji uczniów objętych pomocą społeczną ===== */
  r.get('/api/support/attendance-alerts', (ctx) => {
    const db = ctx.db; const alerts = scanAttendanceAlerts(db).filter((a) => !ctx.query.studentId || a.studentId === ctx.query.studentId);
    return { today: D.today(db), alerts: alerts.map((a) => alertView(db, a)) };
  }, { roles: TEAM });
  r.post('/api/support/attendance-alerts/scan', (ctx) => ({ alerts: scanAttendanceAlerts(ctx.db).map((a) => alertView(ctx.db, a)) }), { roles: TEAM });
  r.post('/api/support/attendance-alerts/:id/contact', (ctx) => {
    const db = ctx.db; const a = db.get('attendanceAlerts', ctx.params.id); if (!a) throw httpError(404, 'Nie ma takiego alertu.');
    const b = ctx.body || {};
    a.contacts.push({ at: U.now(), byUserId: ctx.user.id, channel: b.channel || 'phone', note: b.note || '' });
    if (b.resolve) a.resolved = true;
    db.save();
    ctx.audit({ action: 'attendance_alert_contact', entity: 'attendanceAlerts', entityId: a.id, after: { channel: b.channel || 'phone', resolved: !!b.resolve } });
    return alertView(db, a);
  }, { roles: ['counselor', 'psychologist', 'principal'] });
}
module.exports = { register, scanAttendanceAlerts, SPECIALISTS, TEAM };
