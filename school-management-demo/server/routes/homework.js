'use strict';
/* 3.1.17/3.1.18 (+3.6 po stronie ucznia) — zadania domowe: publikacja z terminem, limitem załącznika
   i blokadą po terminie; oddanie pracy przez ucznia z potwierdzeniem odbioru; przegląd pracy
   przez nauczyciela w przeglądarce (treść pliku inline, bez pobierania na dysk). */
const D = require('../lib/domain');
const { httpError } = require('../lib/router');
const util = require('../lib/util');

/* S-13 — załączniki oddanej pracy sprawdza wspólny walidator (nagłówek data:, deklarowany typ,
   magic bytes, rozmiar liczony z base64, odrzucenie typów wykonywalnych w przeglądarce). */
const { validateUploads } = require('../lib/uploads');

/**
 * P24 — termin oddania nauczyciel wpisuje jako czas ścienny szkoły ('RRRR-MM-DD' albo
 * 'RRRR-MM-DDTGG:MM'). Trzymamy jedno i drugie: `dueAt` to instant ISO **z przesunięciem strefy**
 * (po nim liczy się blokada i spóźnienie), a `dueLocal` to godzina, którą naprawdę wpisał
 * nauczyciel — dzięki temu uczeń, rodzic i nauczyciel widzą tę samą godzinę.
 * `opts.storedLegacy` czyta stare wiersze: `…Z` bez `dueLocal` powstało z czasu lokalnego
 * ostemplowanego jako UTC, więc odczytujemy je z powrotem jako czas ścienny szkoły.
 */
function normalizeDueParts(v, tz, opts) {
  const s = String(v || '').trim(); if (!s) return null;
  const m = /^(\d{4}-\d{2}-\d{2})(?:[T ](\d{2}):(\d{2})(?::(\d{2}))?(?:\.\d+)?(Z|[+-]\d{2}:?\d{2})?)?$/.exec(s);
  if (!m) return null;
  const legacy = !!(opts && opts.storedLegacy) && m[5] === 'Z';
  const time = m[2] == null ? '23:59:59' : `${m[2]}:${m[3]}:${m[4] || '00'}`;
  if (m[5] && !legacy) return { dueAt: s, dueLocal: `${util.localDate(s, tz)}T${util.localTime(s, tz)}` };
  const dueAt = util.toInstant(m[1], time, tz);
  return dueAt ? { dueAt, dueLocal: `${m[1]}T${time.slice(0, 5)}` } : null;
}
/** Zgodność wstecz (używa też courses.js): sam instant terminu. */
function normalizeDue(v, tz) { const p = normalizeDueParts(v, tz || util.DEFAULT_TZ); return p ? p.dueAt : null; }
/** Termin wiersza zadania: {dueAt, dueLocal}, z naprawą starych wpisów ostemplowanych jako UTC. */
function dueOf(db, hw) {
  const tz = D.tz(db);
  if (hw && hw.dueLocal && hw.dueAt) return { dueAt: hw.dueAt, dueLocal: hw.dueLocal };
  return (hw && normalizeDueParts(hw.dueAt, tz, { storedLegacy: true })) || { dueAt: (hw && hw.dueAt) || null, dueLocal: String((hw && hw.dueAt) || '').slice(0, 16) };
}
function dataUrlBytes(dataUrl) {
  const s = String(dataUrl || ''); const i = s.indexOf(',');
  if (i < 0) return s.length;
  const b64 = s.slice(i + 1); const pad = (b64.endsWith('==') ? 2 : b64.endsWith('=') ? 1 : 0);
  return Math.max(0, Math.floor((b64.length * 3) / 4) - pad);
}
function fileMeta(f) { return { name: f.name, size: f.size, type: f.type }; }
/** Po terminie? Porównanie instantów (P31: jedno „teraz w szkole”), nie napisów. */
function isPastDue(db, hw, instant) {
  const d = dueOf(db, hw); if (!d.dueAt) return false;
  const nowTs = Date.parse(D.schoolNow(db, instant).instant), dueTs = Date.parse(d.dueAt);
  return Number.isFinite(nowTs) && Number.isFinite(dueTs) && nowTs > dueTs;
}
function isLocked(db, hw, instant) { return !!hw.lockAfterDue && isPastDue(db, hw, instant); }
function studentsOf(db, hw) {
  if (hw.groupId) { const g = db.get('groups', hw.groupId); if (g) return g.studentIds.slice(); }
  const c = db.get('classes', hw.classId); return c ? c.studentIds.slice() : [];
}
function canReview(db, user, hw) { return user.role === 'principal' || hw.teacherId === user.id || D.isHomeroomOf(db, user, hw.classId); }
function hwView(db, hw, opts) {
  const o = opts || {};
  const subs = db.col('homeworkSubmissions').filter((s) => s.homeworkId === hw.id);
  const due = dueOf(db, hw);
  return Object.assign({}, hw, {
    dueAt: due.dueAt, dueLocal: due.dueLocal, dueDate: due.dueLocal.slice(0, 10), dueTime: due.dueLocal.slice(11, 16), timezone: D.tz(db),
    subjectName: (db.get('subjects', hw.subjectId) || {}).name,
    teacherName: D.userLabel(db.get('users', hw.teacherId)),
    groupName: hw.groupId ? (db.get('groups', hw.groupId) || {}).name : null,
    attachments: (hw.attachments || []).map(fileMeta),
    pastDue: isPastDue(db, hw), locked: isLocked(db, hw),
    expectedCount: studentsOf(db, hw).length,
    submittedCount: subs.length, reviewedCount: subs.filter((s) => s.reviewedAt).length,
    mySubmission: o.studentId ? (subs.find((s) => s.studentId === o.studentId) || null) : undefined
  });
}
/* S-10 — treść oddanej pracy to dokumentacja ucznia. Poza nauczycielem prowadzącym zadanie
   i wychowawcą o dostępie decyduje wspólna kontrola zakresu dokumentacji (uczeń, opiekun z pełnym
   zakresem, dyrektor, zespół wsparcia, nauczyciel uczący ucznia) — biblioteka, stołówka, świetlica
   czy sekretariat dostają 403. */
function assertMayReadSubmission(db, user, hw, sub) {
  if (canReview(db, user, hw)) return;
  D.assertMayReadPupilRecord(db, user, sub.studentId, 'homework');
}
function subView(db, s, inline) {
  const st = db.get('students', s.studentId);
  return {
    id: s.id, homeworkId: s.homeworkId, studentId: s.studentId, studentName: D.studentLabel(st), classId: st ? st.classId : null,
    text: s.text || '', receivedAt: s.receivedAt, late: !!s.late, gradeId: s.gradeId || null, reviewedAt: s.reviewedAt || null,
    reviewedBy: s.reviewedBy || null,
    files: (s.files || []).map((f) => (inline
      ? { name: f.name, size: f.size, type: f.type, dataUrl: f.dataUrl, inline: true, viewable: /^(image\/|text\/|application\/pdf)/.test(f.type || '') }
      : fileMeta(f)))
  };
}

function register(r, app) {
  /* ---- publikacja zadania domowego (3.1.17) ------------------------------------------- */
  r.post('/api/homework', (ctx) => {
    const db = ctx.db; const b = ctx.body || {};
    const classId = b.classId, subjectId = b.subjectId;
    if (!classId || !subjectId) throw httpError(400, 'Podaj klasę i przedmiot zadania.');
    if (!db.get('classes', classId)) throw httpError(404, 'Nie ma takiej klasy.');
    const text = String(b.text || '').trim();
    if (!text) throw httpError(400, 'Treść zadania domowego nie może być pusta.', { code: 'empty_text' });
    if (!D.teacherTeaches(db, ctx.user, subjectId, classId)) throw httpError(403, 'Zadanie domowe może opublikować tylko nauczyciel uczący tego przedmiotu w tym oddziale.', { code: 'not_subject_teacher' });
    const due = normalizeDueParts(b.dueAt || b.due, D.tz(db));
    if (!due) throw httpError(400, 'Podaj termin oddania w formacie RRRR-MM-DD lub RRRR-MM-DDTGG:MM.', { code: 'bad_due' });
    const maxDefault = db.data.config.homeworkMaxAttachmentMB || 10;
    const maxAttachmentMB = b.maxAttachmentMB == null ? maxDefault : Math.round(Number(b.maxAttachmentMB));
    if (!Number.isFinite(maxAttachmentMB) || maxAttachmentMB <= 0 || maxAttachmentMB > maxDefault) throw httpError(400, `Limit załącznika musi mieścić się w przedziale 1–${maxDefault} MB.`, { code: 'bad_limit', max: maxDefault });
    if (b.groupId && !db.get('groups', b.groupId)) throw httpError(400, 'Nie ma takiej grupy.');
    const row = db.insert('homework', {
      id: util.id('hw'), classId, groupId: b.groupId || null, subjectId, teacherId: ctx.user.id, text,
      dueAt: due.dueAt, dueLocal: due.dueLocal, maxAttachmentMB, lockAfterDue: b.lockAfterDue !== false, attachments: Array.isArray(b.attachments) ? b.attachments : [],
      lessonId: b.lessonId || null, createdAt: util.now()
    });
    ctx.audit({ action: 'homework_publish', entity: 'homework', entityId: row.id, before: null, after: { classId, subjectId, dueAt: due.dueAt, dueLocal: due.dueLocal, maxAttachmentMB, lockAfterDue: row.lockAfterDue }, reason: null });
    return { ok: true, homework: hwView(db, row) };
  }, { roles: ['teacher', 'principal', 'supportTeacher'] });

  /* ---- lista zadań ------------------------------------------------------------------- */
  r.get('/api/homework', (ctx) => {
    const db = ctx.db; const q = ctx.query;
    let rows = db.col('homework').slice();
    if (q.classId) rows = rows.filter((x) => x.classId === q.classId);
    if (q.subjectId) rows = rows.filter((x) => x.subjectId === q.subjectId);
    if (q.lessonId) rows = rows.filter((x) => x.lessonId === q.lessonId);
    let studentId = q.studentId || null;
    if (ctx.user.role === 'student') studentId = ctx.user.studentId;
    if (ctx.user.role === 'parent' && !studentId) studentId = (ctx.user.childrenIds || [])[0] || null;
    if (studentId) {
      D.assertMayReadPupilRecord(db, ctx.user, studentId, 'homework');
      rows = rows.filter((x) => studentsOf(db, x).includes(studentId));
    } else if (ctx.user.role === 'teacher' && q.mine !== '0') {
      rows = rows.filter((x) => x.teacherId === ctx.user.id);
    }
    rows.sort((a, b) => (Date.parse(dueOf(db, a).dueAt) < Date.parse(dueOf(db, b).dueAt) ? 1 : -1));
    return { homework: rows.map((x) => hwView(db, x, { studentId })) };
  }, { roles: ['staff', 'student', 'parent'] });

  r.get('/api/homework/:id', (ctx) => {
    const db = ctx.db; const hw = db.get('homework', ctx.params.id);
    if (!hw) throw httpError(404, 'Nie ma takiego zadania domowego.');
    let studentId = ctx.query.studentId || null;
    if (ctx.user.role === 'student') studentId = ctx.user.studentId;
    if (studentId) D.assertMayReadPupilRecord(db, ctx.user, studentId, 'homework');
    const out = hwView(db, hw, { studentId });
    if (canReview(db, ctx.user, hw)) out.submissions = db.col('homeworkSubmissions').filter((s) => s.homeworkId === hw.id).map((s) => subView(db, s, false));
    return out;
  }, { roles: ['staff', 'student', 'parent'] });

  /* ---- oddanie pracy przez ucznia (używane też przez 3.6) ------------------------------ */
  r.post('/api/homework/:id/submissions', (ctx) => {
    const db = ctx.db; const hw = db.get('homework', ctx.params.id);
    if (!hw) throw httpError(404, 'Nie ma takiego zadania domowego.');
    const b = ctx.body || {};
    let studentId = b.studentId || null;
    if (ctx.user.role === 'student') studentId = ctx.user.studentId;
    else if (ctx.user.role === 'parent') { studentId = studentId || (ctx.user.childrenIds || [])[0]; D.assertMayReadPupilRecord(db, ctx.user, studentId, 'homework'); }
    else if (!canReview(db, ctx.user, hw)) throw httpError(403, 'Pracę oddaje uczeń albo nauczyciel prowadzący zadanie.', { code: 'forbidden' });
    if (!studentId) throw httpError(400, 'Podaj ucznia oddającego pracę.');
    if (!studentsOf(db, hw).includes(studentId)) throw httpError(400, 'Ten uczeń nie należy do oddziału ani grupy, dla której opublikowano zadanie.', { code: 'not_in_class' });
    const due = dueOf(db, hw);
    if (isLocked(db, hw)) throw httpError(403, `Oddawanie pracy zostało zablokowane po terminie ${util.fmtDate(due.dueLocal)} ${due.dueLocal.slice(11, 16)}.`, { code: 'homework_locked', dueAt: due.dueAt, dueLocal: due.dueLocal });

    const files = Array.isArray(b.files) ? b.files : [];
    const maxMB = hw.maxAttachmentMB || db.data.config.homeworkMaxAttachmentMB || 10;
    const clean = validateUploads(files, { maxMB, maxTotalMB: maxMB, fallbackName: 'praca' })
      .map((f) => ({ name: f.name, size: f.size, type: f.type, dataUrl: f.dataUrl }));
    const text = String(b.text || '').trim();
    if (!text && !clean.length) throw httpError(400, 'Dołącz plik albo wpisz treść pracy.', { code: 'empty_submission' });

    const receivedAt = util.now();
    const late = isPastDue(db, hw, receivedAt);
    const existing = db.one('homeworkSubmissions', (s) => s.homeworkId === hw.id && s.studentId === studentId);
    let row;
    if (existing) { Object.assign(existing, { text, files: clean, receivedAt, late, reviewedAt: null, reviewedBy: null }); db.save(); row = existing; }
    else row = db.insert('homeworkSubmissions', { id: util.id('sub'), homeworkId: hw.id, studentId, text, files: clean, receivedAt, late, gradeId: null, reviewedAt: null, reviewedBy: null });
    ctx.audit({ action: existing ? 'homework_resubmit' : 'homework_submit', entity: 'homeworkSubmission', entityId: row.id, before: existing ? { receivedAt: existing.receivedAt } : null, after: { homeworkId: hw.id, studentId, files: clean.map(fileMeta), receivedAt }, reason: null });
    const tz = D.tz(db);
    return { ok: true, submission: subView(db, row, false), receivedAt, late, dueAt: due.dueAt, dueLocal: due.dueLocal, receipt: `Praca przyjęta ${util.fmtDate(util.localDate(receivedAt, tz))} ${util.localTime(receivedAt, tz)}.` };
  }, { roles: ['student', 'parent', 'teacher', 'principal', 'supportTeacher'] });

  /* ---- przegląd prac przez nauczyciela ------------------------------------------------- */
  r.get('/api/homework/:id/submissions', (ctx) => {
    const db = ctx.db; const hw = db.get('homework', ctx.params.id);
    if (!hw) throw httpError(404, 'Nie ma takiego zadania domowego.');
    if (!canReview(db, ctx.user, hw)) throw httpError(403, 'Prace widzi nauczyciel prowadzący zadanie lub wychowawca.', { code: 'forbidden' });
    const subs = db.col('homeworkSubmissions').filter((s) => s.homeworkId === hw.id);
    const done = subs.map((s) => s.studentId);
    return {
      homework: hwView(db, hw),
      submissions: subs.sort((a, b) => (a.receivedAt < b.receivedAt ? -1 : 1)).map((s) => subView(db, s, false)),
      missing: studentsOf(db, hw).filter((sid) => !done.includes(sid)).map((sid) => ({ studentId: sid, name: D.studentLabel(db.get('students', sid)) }))
    };
  }, { roles: ['staff'] });

  /** Podgląd pracy w przeglądarce: treść pliku wraca inline jako dataUrl (bez pobierania na dysk). */
  r.get('/api/homework/:id/submissions/:submissionId', (ctx) => {
    const db = ctx.db; const hw = db.get('homework', ctx.params.id);
    if (!hw) throw httpError(404, 'Nie ma takiego zadania domowego.');
    const s = db.get('homeworkSubmissions', ctx.params.submissionId);
    if (!s || s.homeworkId !== hw.id) throw httpError(404, 'Nie ma takiej pracy.');
    /* Treść oddanej pracy (pliki inline) widzi nauczyciel prowadzący zadanie lub wychowawca,
       a poza nimi wyłącznie sam uczeń i jego opiekun — nie każdy pracownik szkoły. */
    assertMayReadSubmission(db, ctx.user, hw, s);
    return { homework: hwView(db, hw), submission: subView(db, s, true) };
  }, { roles: ['staff', 'student', 'parent'] });

  /** Oznaczenie pracy jako przejrzanej; zwraca treść plików inline do wyświetlenia (3.1.18). */
  r.post('/api/homework/:id/submissions/:submissionId/review', (ctx) => {
    const db = ctx.db; const hw = db.get('homework', ctx.params.id);
    if (!hw) throw httpError(404, 'Nie ma takiego zadania domowego.');
    const s = db.get('homeworkSubmissions', ctx.params.submissionId);
    if (!s || s.homeworkId !== hw.id) throw httpError(404, 'Nie ma takiej pracy.');
    if (!canReview(db, ctx.user, hw)) throw httpError(403, 'Pracę ocenia nauczyciel prowadzący zadanie.', { code: 'forbidden' });
    const before = { reviewedAt: s.reviewedAt || null };
    s.reviewedAt = util.now(); s.reviewedBy = ctx.user.id;
    if (ctx.body && ctx.body.gradeId) s.gradeId = ctx.body.gradeId;
    if (ctx.body && ctx.body.comment !== undefined) s.reviewComment = String(ctx.body.comment || '').trim();
    db.save();
    ctx.audit({ action: 'homework_review', entity: 'homeworkSubmission', entityId: s.id, before, after: { reviewedAt: s.reviewedAt, reviewedBy: s.reviewedBy, gradeId: s.gradeId || null }, reason: null });
    return { ok: true, submission: subView(db, s, true) };
  }, { roles: ['teacher', 'principal', 'supportTeacher'] });
}

module.exports = { register, normalizeDue, normalizeDueParts, dueOf, dataUrlBytes, isPastDue, isLocked, studentsOf };
