'use strict';
/* 3.1 — frekwencja: lista obecności lekcji, zapis zbiorczy i indywidualny, wersja robocza,
   lekcje łączone (dwie grupy językowe → jedna lista, wiersze zostają przy klasie macierzystej),
   statystyki miesięczne z minutami spóźnień, idempotentny zapis dla kolejki offline. */
const D = require('../lib/domain');
const { httpError } = require('../lib/router');
const util = require('../lib/util');
/* Alerts are raised where the data changes, not when a reader happens to ask (3.7.2, 3.4.15).
   Neither module requires this one, so the plain require is cycle-free. */
const parentRoutes = require('./parent');
const supportRoutes = require('./support');

const STATUSES = ['ob', 'nb', 'sp', 'zw', 'u', 'rs', 'w'];
const STATUS_LABEL = { ob: 'obecny', nb: 'nieobecny', sp: 'spóźniony', zw: 'zwolniony', u: 'usprawiedliwiony', rs: 'reprezentuje szkołę', w: 'wycieczka' };
/** Statuses that do not lower the attendance percentage (see util.attendanceStats). */
const PRESENT = ['ob', 'sp', 'rs', 'w'];

/** Demo clock: the school day is config.today, the time of day comes from the real clock. */
function schoolNow(db) { return D.schoolNow(db).instant; }

/** The lesson rows that make up one combined roster (a lesson plus its combinedWith partner). */
function combinedLessons(db, lesson) {
  const out = [lesson];
  if (lesson.combinedWith) { const p = db.get('lessons', lesson.combinedWith); if (p && p.id !== lesson.id) out.push(p); }
  return out;
}
/** OPS-13 — a pupil belongs to a lesson only on the days they were enrolled. `enrolledAt` is written
    when the entry in the register is opened, `leftAt` by the administrative removal and `departureDate`
    by a transfer. Without this a pupil admitted on 20 October stands on the list of a lesson from
    7 September and can be marked absent for a day they were not a pupil of the school yet. */
function enrolledOn(db, studentId, date) {
  const s = db.get('students', studentId);
  if (!s) return false;
  /* Dwie nazwy tego samego faktu: księga uczniów pisze `enrolledAt`, wychowawca dopisujący ucznia
     w trakcie roku — `joinedAt`. Liczy się wcześniejsza z nich, żeby data przyjęcia obowiązywała
     niezależnie od tego, którą drogą uczeń trafił do oddziału. */
  const admitted = s.enrolledAt && s.joinedAt ? (s.enrolledAt < s.joinedAt ? s.enrolledAt : s.joinedAt) : (s.enrolledAt || s.joinedAt);
  if (admitted && date < admitted) return false;
  if (s.leftAt && date > s.leftAt) return false;
  if (s.departureDate && date > s.departureDate) return false;
  return true;
}
/** Students of a lesson: the language/lab group when the lesson has one, otherwise the whole class. */
function rosterIds(db, lesson) {
  const enrolled = (sid) => enrolledOn(db, sid, lesson.date);
  if (lesson.groupId) { const g = db.get('groups', lesson.groupId); if (g) return g.studentIds.filter(enrolled); }
  const c = db.get('classes', lesson.classId);
  return c ? c.studentIds.filter(enrolled) : [];
}
function attendanceRow(db, lessonId, studentId) { return db.one('attendance', (a) => a.lessonId === lessonId && a.studentId === studentId); }

/** One roster line per student; `lessonId` is the student's OWN lesson so grades stay in the home class. */
function roster(db, lesson) {
  const out = [];
  for (const les of combinedLessons(db, lesson)) {
    const rows = rosterIds(db, les).map((sid) => db.get('students', sid)).filter(Boolean).sort((a, b) => (a.rollNo || 99) - (b.rollNo || 99));
    for (const s of rows) {
      const a = attendanceRow(db, les.id, s.id);
      out.push({
        studentId: s.id, classId: s.classId, lessonId: les.id, no: s.rollNo || null,
        name: `${s.lastName} ${s.firstName}`, firstName: s.firstName, lastName: s.lastName,
        status: a ? a.status : null, minutes: a && a.minutes != null ? a.minutes : null,
        draft: a ? !!a.draft : false, at: a ? a.at : null, excuseId: a ? a.excuseId || null : null,
        own: les.id === lesson.id
      });
    }
  }
  return out;
}
function lessonStats(db, lesson) {
  const ids = combinedLessons(db, lesson).map((l) => l.id);
  return D.attendanceStats(db.col('attendance').filter((a) => ids.includes(a.lessonId)));
}
function canWriteLesson(db, user, lesson) {
  if (user.role === 'principal') return true;
  return combinedLessons(db, lesson).some((l) => l.teacherId === user.id || l.substituteTeacherId === user.id);
}
function assertCanWrite(db, user, lesson) {
  if (!canWriteLesson(db, user, lesson)) throw httpError(403, 'Frekwencję może zapisać tylko nauczyciel prowadzący tę lekcję lub jego zastępca.', { code: 'not_lesson_teacher' });
}
/** Frekwencja jest podstawą klasyfikacji (art. 44k) — po zamknięciu semestru nie wolno jej zmieniać. */
function assertPeriodOpen(db, lesson) {
  const sem = D.semesterOf(db, lesson.date);
  if (D.isSemesterLocked(db, sem, lesson.classId)) throw httpError(403, `Semestr ${sem} w klasie ${lesson.classId} jest zamknięty — frekwencji z ${util.fmtDate(lesson.date)} nie można już zmienić. Odblokowanie wymaga decyzji dyrekcji.`, { code: 'semester_locked' });
}
function lessonLabel(db, lesson) {
  const sub = db.get('subjects', lesson.subjectId); const t = D.lessonTime(db, lesson.lessonNo);
  return `${lesson.lessonNo}. ${sub ? sub.name : lesson.subjectId} · ${lesson.classId} · ${util.fmtDate(lesson.date)} ${t.start}–${t.end}`;
}
/** Public view of a lesson used by every screen in 3.1. */
function lessonView(db, lesson) {
  const sub = db.get('subjects', lesson.subjectId); const t = D.lessonTime(db, lesson.lessonNo);
  const g = lesson.groupId ? db.get('groups', lesson.groupId) : null;
  const partner = lesson.combinedWith ? db.get('lessons', lesson.combinedWith) : null;
  const teacher = db.get('users', lesson.substituteTeacherId || lesson.teacherId);
  return {
    id: lesson.id, date: lesson.date, lessonNo: lesson.lessonNo, classId: lesson.classId, groupId: lesson.groupId,
    groupName: g ? g.name : null, subjectId: lesson.subjectId, subjectName: sub ? sub.name : lesson.subjectId,
    teacherId: lesson.teacherId, substituteTeacherId: lesson.substituteTeacherId || null, teacherName: D.userLabel(teacher),
    room: lesson.room, start: t.start, end: t.end, topic: lesson.topic || null, curriculumItemIds: lesson.curriculumItemIds || [],
    status: lesson.status, attendanceDraft: !!lesson.attendanceDraft, combinedWith: lesson.combinedWith || null,
    combinedLabel: partner ? `${partner.classId}${partner.groupId ? ' · ' + (db.get('groups', partner.groupId) || {}).name : ''}` : null,
    label: lessonLabel(db, lesson)
  };
}

/** 3.7.2 + 3.4.15 — the two alerts the stories call "instant" and "real-time" belong to the write, not
    to the reader's GET. Both scans are idempotent (one notification per attendance row / per run of
    days), so calling them again from the parent's or the counsellor's screen creates nothing new.
    Guarded so that an ordinary save does not walk the attendance collection for nothing. */
function raiseAlerts(db, lesson, studentIds) {
  const out = { firstPeriod: [], welfare: 0 };
  if (!studentIds.length) return out;
  if (combinedLessons(db, lesson).some((l) => l.lessonNo === 1)) {
    out.firstPeriod = parentRoutes.scanFirstPeriodAbsences(db, { date: lesson.date, studentIds })
      .map((a) => ({ studentId: a.studentId, notified: a.notified }));
  }
  const welfare = studentIds.some((sid) => { const s = db.get('students', sid); return !!(s && s.socialWelfare && s.status === 'active'); });
  if (welfare) out.welfare = supportRoutes.scanAttendanceAlerts(db).length;
  return out;
}

function register(r, app) {
  /* ---- roster with the current statuses ------------------------------------------------ */
  r.get('/api/attendance/lesson/:lessonId', (ctx) => {
    const lesson = ctx.db.get('lessons', ctx.params.lessonId);
    if (!lesson) throw httpError(404, 'Nie ma takiej lekcji.');
    const list = roster(ctx.db, lesson);
    return {
      lesson: lessonView(ctx.db, lesson),
      combined: !!lesson.combinedWith,
      combinedLessons: combinedLessons(ctx.db, lesson).map((l) => lessonView(ctx.db, l)),
      students: list,
      draft: list.some((s) => s.draft),
      canWrite: canWriteLesson(ctx.db, ctx.user, lesson),
      statuses: STATUSES.map((s) => ({ value: s, label: STATUS_LABEL[s], present: PRESENT.includes(s), countsToBase: s !== 'zw' })),
      stats: lessonStats(ctx.db, lesson)
    };
  }, { roles: ['staff'] });

  /* ---- status of one student on one lesson (used by 3.1.2 before writing a grade) ------- */
  r.get('/api/attendance/status', (ctx) => {
    const { lessonId, studentId } = ctx.query;
    if (!lessonId || !studentId) throw httpError(400, 'Podaj lessonId i studentId.');
    const lesson = ctx.db.get('lessons', lessonId); if (!lesson) throw httpError(404, 'Nie ma takiej lekcji.');
    D.assertCanSeeStudent(ctx.db, ctx.user, studentId);
    let row = attendanceRow(ctx.db, lessonId, studentId);
    if (!row) for (const l of combinedLessons(ctx.db, lesson)) { const alt = attendanceRow(ctx.db, l.id, studentId); if (alt) { row = alt; break; } }
    const status = row ? row.status : null;
    return {
      lessonId, studentId, status, minutes: row && row.minutes != null ? row.minutes : null,
      draft: row ? !!row.draft : false, label: status ? STATUS_LABEL[status] : null,
      present: status ? PRESENT.includes(status) : null,
      /** true → a partial grade needs the "do uzupełnienia" (makeup) flag; owner of 3.1.2 enforces it. */
      blocked: !!row && !row.draft && row.status === 'nb'
    };
  }, { roles: ['staff'] });

  /* ---- save attendance (bulk / per student / draft); idempotent per lesson+student ------ */
  r.post('/api/attendance/lesson/:lessonId', (ctx) => {
    const db = ctx.db; const lesson = db.get('lessons', ctx.params.lessonId);
    if (!lesson) throw httpError(404, 'Nie ma takiej lekcji.');
    assertCanWrite(db, ctx.user, lesson);
    assertPeriodOpen(db, lesson);
    const body = ctx.body || {};
    /** A queued offline write carries its own `at`; only then does last-write-wins apply. */
    const clientAt = typeof body.at === 'string' && body.at.length >= 10 ? body.at : null;
    const at = clientAt || util.now();
    const draft = !!body.draft;
    const list = roster(db, lesson);
    const byId = {}; list.forEach((x) => { byId[x.studentId] = x; });

    const wanted = new Map();
    if (body.allPresent) for (const x of list) wanted.set(x.studentId, { status: 'ob', minutes: null });
    for (const e of (Array.isArray(body.entries) ? body.entries : [])) {
      const line = byId[e.studentId];
      if (!line) throw httpError(400, 'Uczeń spoza listy tej lekcji nie może mieć wpisu frekwencji.', { code: 'not_in_roster', studentId: e.studentId });
      if (!STATUSES.includes(e.status)) throw httpError(400, `Nieznany status frekwencji: ${e.status}. Dozwolone: ${STATUSES.join(', ')}.`, { code: 'bad_status' });
      let minutes = null;
      if (e.status === 'sp') {
        minutes = Math.round(Number(e.minutes));
        if (!Number.isFinite(minutes) || minutes <= 0) throw httpError(400, 'Przy spóźnieniu podaj liczbę minut.', { code: 'minutes_required', studentId: e.studentId });
      }
      wanted.set(e.studentId, { status: e.status, minutes });
    }
    if (!wanted.size && !body.finalize) throw httpError(400, 'Brak wpisów frekwencji do zapisania.', { code: 'empty' });

    const before = [], after = [];
    const skippedEntries = [];
    let written = 0, skipped = 0;
    for (const [studentId, v] of wanted) {
      const line = byId[studentId];
      const existing = attendanceRow(db, line.lessonId, studentId);
      /* REL-10 — last write wins by the client's `at`, per lesson+student; the row id
         `att_<lesson>_<student>` makes the replay idempotent. The comparison must NOT be limited to
         rows that were themselves client-stamped: a server `at` is a real instant too, so a queued
         08:00 write replayed at noon has to lose to the 10:00 correction the teacher made in the
         browser. A write with no client `at` is a fresh one and always wins. */
      if (existing && clientAt && existing.at && clientAt < existing.at) {
        skipped++;
        skippedEntries.push({ studentId, reason: 'stale_write', at: clientAt, storedAt: existing.at, keptStatus: existing.status });
        continue;
      }
      before.push(existing ? { studentId, status: existing.status, minutes: existing.minutes, draft: !!existing.draft } : { studentId, status: null });
      const patch = { status: v.status, minutes: v.minutes, draft, byUserId: ctx.user.id, at, atClient: !!clientAt };
      if (existing) Object.assign(existing, patch);
      else db.insert('attendance', Object.assign({
        id: 'att_' + line.lessonId + '_' + studentId, lessonId: line.lessonId, studentId, date: lesson.date,
        lessonNo: lesson.lessonNo, classId: line.classId, subjectId: lesson.subjectId, excuseId: null
      }, patch));
      after.push({ studentId, status: v.status, minutes: v.minutes, draft });
      written++;
    }
    if (!draft) { // completing a draft keeps every earlier entry and only clears the draft flag
      const ids = combinedLessons(db, lesson).map((l) => l.id);
      for (const a of db.col('attendance')) if (ids.includes(a.lessonId) && a.draft) { a.draft = false; }
    }
    for (const l of combinedLessons(db, lesson)) { l.attendanceDraft = draft; if (!draft) l.status = 'held'; }
    const alerts = draft ? { firstPeriod: [], welfare: 0 } : raiseAlerts(db, lesson, after.map((x) => x.studentId));
    db.save();
    ctx.audit({ action: draft ? 'attendance_draft' : 'attendance_save', entity: 'lesson', entityId: lesson.id, before, after, reason: body.reason || null });
    const out = roster(db, lesson);
    return { ok: true, lessonId: lesson.id, saved: written, skipped, skippedEntries, draft, students: out, stats: lessonStats(db, lesson), at, alerts };
  }, { roles: ['teacher', 'principal', 'supportTeacher'] });

  /* ---- a student's attendance in a period / month ------------------------------------- */
  r.get('/api/attendance/student/:studentId', (ctx) => {
    const db = ctx.db; const s = db.get('students', ctx.params.studentId);
    if (!s) throw httpError(404, 'Nie ma takiego ucznia.');
    D.assertMayReadPupilRecord(db, ctx.user, s.id, 'attendance');
    const from = ctx.query.from || null, to = ctx.query.to || null;
    const a = D.attendanceFor(db, s.id, from, to);
    return Object.assign({ studentId: s.id, from, to }, a);
  }, { roles: ['staff', 'student', 'parent'] });

  /** Monthly statistics incl. the exact minutes late (3.1.15). month = YYYY-MM, default: the current school month. */
  r.get('/api/attendance/student/:studentId/monthly', (ctx) => {
    const db = ctx.db; const s = db.get('students', ctx.params.studentId);
    if (!s) throw httpError(404, 'Nie ma takiego ucznia.');
    D.assertMayReadPupilRecord(db, ctx.user, s.id, 'attendance');
    const month = /^\d{4}-\d{2}$/.test(ctx.query.month || '') ? ctx.query.month : D.today(db).slice(0, 7);
    const from = month + '-01';
    const to = new Date(Date.UTC(+month.slice(0, 4), +month.slice(5, 7), 0)).toISOString().slice(0, 10);
    const entries = db.col('attendance').filter((x) => x.studentId === s.id && !x.draft && x.date >= from && x.date <= to);
    const stats = D.attendanceStats(entries);
    const bySubject = {};
    for (const e of entries) (bySubject[e.subjectId] = bySubject[e.subjectId] || []).push(e);
    const late = entries.filter((e) => e.status === 'sp').sort((a, b) => (a.date === b.date ? a.lessonNo - b.lessonNo : a.date < b.date ? -1 : 1))
      .map((e) => ({ date: e.date, lessonNo: e.lessonNo, subjectId: e.subjectId, minutes: e.minutes || 0 }));
    return {
      studentId: s.id, name: D.studentLabel(s), classId: s.classId, month, from, to,
      counts: { ob: stats.ob, nb: stats.nb, sp: stats.sp, zw: stats.zw, u: stats.u, rs: stats.rs, w: stats.w },
      total: stats.total, present: stats.present, excused: stats.excused, absent: stats.absent,
      /** podstawa procentów: godziny bez zwolnień (zw nie jest ani obecnością, ani nieobecnością) */
      counted: stats.counted, percent: stats.percent, unexcusedPercent: stats.unexcusedPercent, absentPercent: stats.absentPercent,
      /** Minutes late add up across the month; `rs`/`w` never lower the percentage (3.1.13). */
      lateCount: stats.sp, lateMinutes: stats.lateMinutes, late,
      representedSchool: stats.rs, trip: stats.w,
      bySubject: Object.fromEntries(Object.entries(bySubject).map(([k, v]) => [k, D.attendanceStats(v)]))
    };
  }, { roles: ['staff', 'student', 'parent'] });

  /* ---- monthly statistics for a whole class (homeroom view of the same numbers) -------- */
  r.get('/api/attendance/class/:classId/monthly', (ctx) => {
    const db = ctx.db; const c = db.get('classes', ctx.params.classId);
    if (!c) throw httpError(404, 'Nie ma takiej klasy.');
    const month = /^\d{4}-\d{2}$/.test(ctx.query.month || '') ? ctx.query.month : D.today(db).slice(0, 7);
    const from = month + '-01', to = month + '-31';
    return {
      classId: c.id, month,
      students: c.studentIds.map((sid) => {
        const s = db.get('students', sid);
        const e = db.col('attendance').filter((x) => x.studentId === sid && !x.draft && x.date >= from && x.date <= to);
        return Object.assign({ studentId: sid, no: s.rollNo, name: D.studentLabel(s) }, D.attendanceStats(e));
      })
    };
  }, { roles: ['staff'] });
}

module.exports = { register, roster, combinedLessons, rosterIds, enrolledOn, canWriteLesson, assertCanWrite, lessonView, schoolNow, raiseAlerts, STATUSES, STATUS_LABEL, PRESENT };
