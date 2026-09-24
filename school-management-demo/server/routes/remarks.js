'use strict';
/* 3.1.23 — uwagi i pochwały z dziennika lekcyjnego wraz z punktami zachowania (config.behaviorPoints). */
const D = require('../lib/domain');
const U = require('../lib/util');
const { httpError } = require('../lib/router');
const { sLabel } = require('./grades');
const LA = require('../lib/log-access');
const { countsFor } = require('./log-comments');
/** S-10 — ta sama bramka odczytu karty ucznia, co w ocenach (D.assertMayReadPupilRecord). */
const assertRead = (db, user, studentId) => D.assertMayReadPupilRecord(db, user, studentId, 'remarks');
/** Kto w ogóle czyta uwagi (S-10): nauczyciele z prawem wpisu, wychowawca, zespół wspierający,
    opiekun z pełnym zakresem i sam uczeń. Bibliotekarz, świetlica czy IOD — nie, stąd 403. */
const REMARK_READERS = ['gradeEditors', 'homeroom', 'parent', 'student', 'counselor', 'psychologist', 'specialEducator', 'speechTherapist'];

const KINDS = { positive: 'pochwała', negative: 'uwaga', neutral: 'informacja' };
const MAX_POINTS = 50;

function teachesClass(db, user, classId) {
  if (user.role === 'principal') return true;
  if (D.isHomeroomOf(db, user, classId)) return true;
  return db.col('timetable').some((t) => t.classId === classId && t.teacherId === user.id) || db.col('lessons').some((l) => l.classId === classId && (l.teacherId === user.id || l.substituteTeacherId === user.id));
}
/**
 * Suma punktów zachowania ucznia: punkt startowy z konfiguracji + uwagi z semestru.
 * Ocena zachowania jest śródroczna albo roczna, więc punkty liczą się w granicach semestru
 * i po jego zakończeniu wracają do puli startowej. `sem` domyślnie: semestr bieżącego dnia szkolnego.
 */
function pointsOf(db, studentId, sem) {
  const cfg = db.data.config.behaviorPoints || { start: 100, thresholds: [] };
  const period = D.semester(db, sem || D.semesterOf(db)) || { from: '0000-01-01', to: '9999-12-31' };
  const list = db.col('remarks').filter((x) => x.studentId === studentId && !x.deleted && (!x.date || (x.date >= period.from && x.date <= period.to)));
  const delta = list.reduce((s, x) => s + (x.points || 0), 0);
  const total = (cfg.start || 0) + delta;
  const hit = (cfg.thresholds || []).slice().sort((a, b) => b.min - a.min).find((t) => total >= t.min);
  return { start: cfg.start || 0, delta, total, grade: hit ? hit.grade : null, positive: list.filter((x) => x.kind === 'positive').length, negative: list.filter((x) => x.kind === 'negative').length, neutral: list.filter((x) => x.kind === 'neutral').length, count: list.length };
}
function view(db, x) {
  return Object.assign({}, x, { student: sLabel(db.get('students', x.studentId), db), teacher: D.userLabel(db.get('users', x.teacherId)), kindLabel: KINDS[x.kind] || x.kind });
}

function register(r, app) {
  const EDITORS = { roles: ['gradeEditors'] };

  /* Komentarze do uwagi — dokładnie ta sama bramka, co przy odczycie listy: karta ucznia (S-10). */
  LA.register('remarks', {
    label: 'Uwagi i pochwały',
    roles: REMARK_READERS,
    find: (db, user, entryId) => {
      const x = db.get('remarks', entryId);
      if (!x || x.deleted) return null;
      try { assertRead(db, user, x.studentId); } catch (e) { return null; }
      return x;
    }
  });

  r.get('/api/remarks', (ctx) => {
    const db = ctx.db, sid = ctx.query.studentId, classId = ctx.query.classId;
    if (!sid && !classId) throw httpError(400, 'Podaj ucznia lub klasę.');
    if (sid) assertRead(db, ctx.user, sid);
    const ids = sid ? [sid] : db.col('students').filter((s) => s.classId === classId).sort((a, b) => a.rollNo - b.rollNo).map((s) => s.id);
    if (!sid) { const v = D.visibleStudentIds(db, ctx.user); if (v) throw httpError(403, 'Brak dostępu do uwag całej klasy.'); for (const id of ids) assertRead(db, ctx.user, id); }
    const sem = +(ctx.query.semester || D.semesterOf(db));
    const list = db.col('remarks').filter((x) => !x.deleted && ids.includes(x.studentId)).sort((a, b) => (a.date < b.date ? 1 : -1));
    const counts = countsFor(db, ctx.user, 'remarks', list.map((x) => x.id));
    return {
      semester: sem,
      remarks: list.map((x) => Object.assign(view(db, x), { comments: counts[x.id] })),
      students: ids.map((id) => Object.assign({ studentId: id, student: sLabel(db.get('students', id), db) }, pointsOf(db, id, sem))),
      scale: (db.data.config.behaviorPoints || {}).thresholds || [], start: (db.data.config.behaviorPoints || {}).start
    };
  });

  r.get('/api/remarks/points/:studentId', (ctx) => {
    assertRead(ctx.db, ctx.user, ctx.params.studentId);
    const sem = +(ctx.query.semester || D.semesterOf(ctx.db));
    return Object.assign({ studentId: ctx.params.studentId, semester: sem, student: sLabel(ctx.db.get('students', ctx.params.studentId), ctx.db) }, pointsOf(ctx.db, ctx.params.studentId, sem));
  });

  r.post('/api/remarks', (ctx) => {
    const db = ctx.db, b = ctx.body || {};
    const student = db.get('students', b.studentId);
    if (!student) throw httpError(404, 'Nie znaleziono ucznia.');
    if (!teachesClass(db, ctx.user, student.classId)) throw httpError(403, `Nie prowadzisz zajęć w klasie ${student.classId} — nie możesz wpisać uwagi.`, { code: 'forbidden' });
    const kind = b.kind || 'neutral';
    if (!KINDS[kind]) throw httpError(400, 'Rodzaj wpisu musi być jednym z: positive, negative, neutral.', { code: 'bad_kind' });
    const text = String(b.text || '').trim();
    if (text.length < 3) throw httpError(400, 'Wpisz treść uwagi — jest widoczna dla rodzica i ucznia.', { code: 'text_required' });
    let points = 0;
    if (b.points != null && b.points !== '' && kind !== 'neutral') {
      const p = Number(b.points);
      if (!Number.isInteger(p)) throw httpError(400, 'Punkty zachowania muszą być liczbą całkowitą.', { code: 'bad_points' });
      if (Math.abs(p) > MAX_POINTS) throw httpError(400, `Pojedynczy wpis może zmienić punkty zachowania najwyżej o ${MAX_POINTS}.`, { code: 'bad_points' });
      points = kind === 'negative' ? -Math.abs(p) : Math.abs(p);
    }
    const date = b.date || D.today(db);
    // P25 — uwaga z dnia przerwy międzysemestralnej należy do semestru, który się zaczyna.
    const sem = D.semesterOf(db, date, 'entry');
    // Uwaga zmienia punkty zachowania, czyli podstawę oceny — po zamknięciu semestru jest za późno.
    if (D.isSemesterLocked(db, sem, student.classId)) throw httpError(403, `Semestr ${sem} w klasie ${student.classId} jest zamknięty — ocena zachowania została już ustalona, wpisu z datą ${U.fmtDate(date)} nie można dodać.`, { code: 'semester_locked' });
    const before = pointsOf(db, student.id, sem);
    const doc = db.insert('remarks', {
      studentId: student.id, classId: student.classId, teacherId: ctx.user.id, kind, text, points,
      date, semester: sem, lessonId: b.lessonId || null, subjectId: b.subjectId || null, at: U.now(), deleted: false
    });
    const after = pointsOf(db, student.id, sem);
    db.update('students', student.id, { behaviorPoints: after.total });
    ctx.audit({ action: 'remark_create', entity: 'remark', entityId: doc.id, after: Object.assign({}, doc), before: { behaviorPoints: before.total }, reason: b.reason || null });
    if (kind === 'negative') D.notifyParentsOf(db, student.id, 'remark', `Nowa uwaga dla ${sLabel(student, db)}: ${text} (${points} pkt zachowania, razem ${after.total}).`, { link: '/oceny' });
    return { remark: view(db, doc), points: after, pointsBefore: before.total, applied: points };
  }, EDITORS);

  r.delete('/api/remarks/:id', (ctx) => {
    const db = ctx.db, b = ctx.body || {};
    const x = db.get('remarks', ctx.params.id);
    if (!x || x.deleted) throw httpError(404, 'Nie znaleziono uwagi.');
    const reason = String(b.reason || '').trim();
    if (reason.length < 3) throw httpError(400, 'Podaj powód usunięcia uwagi — trafi on do rejestru zmian.', { code: 'reason_required' });
    const student = db.get('students', x.studentId) || {};
    const isHomeroom = student.classId && D.isHomeroomOf(db, ctx.user, student.classId);
    if (ctx.user.role !== 'principal' && !isHomeroom && x.teacherId !== ctx.user.id) throw httpError(403, 'Uwagę może wycofać jej autor, wychowawca klasy lub dyrekcja.', { code: 'forbidden' });
    // Wycofanie działa na semestr, w którym uwagę zapisano (P25: data z przerwy międzysemestralnej).
    const sem = x.semester != null ? +x.semester : D.semesterOf(db, x.date || D.today(db), 'entry');
    if (D.isSemesterLocked(db, sem, student.classId)) throw httpError(403, `Semestr ${sem} w klasie ${student.classId} jest zamknięty — wycofanie uwagi wymaga odblokowania przez dyrekcję.`, { code: 'semester_locked' });
    const before = Object.assign({}, x);
    db.update('remarks', x.id, { deleted: true, deletedReason: reason, deletedBy: ctx.user.id, deletedAt: U.now() });
    const after = pointsOf(db, x.studentId, sem);
    db.update('students', x.studentId, { behaviorPoints: after.total });
    ctx.audit({ action: 'remark_delete', entity: 'remark', entityId: x.id, before, after: { behaviorPoints: after.total }, reason });
    return { ok: true, points: after };
  }, EDITORS);
}

module.exports = { register, pointsOf };
