'use strict';
/* Moduł „Kursy” (lekki LMS w dzienniku): nauczyciel publikuje ustrukturyzowane treści (jednostki i elementy:
   tekst, materiał, odnośnik, zadanie domowe, quiz, spotkanie), zapisuje klasę albo otwiera kurs na zapisy własne,
   a uczeń przechodzi kurs krok po kroku. Quiz jest sprawdzany automatycznie, wynik można przenieść do dziennika
   ocen (kategoria „quiz”) przez logikę modułu ocen. Rodzic widzi wyłącznie postęp swojego dziecka.
   Każdy zapis trafia do rejestru audytowego. */
const D = require('../lib/domain');
const U = require('../lib/util');
const { httpError } = require('../lib/router');
const { validateUpload } = require('../lib/uploads');
const { writeGrade } = require('./grades');

const KINDS = ['text', 'material', 'link', 'assignment', 'quiz', 'meeting'];
const STATUSES = ['draft', 'published', 'archived'];
const COVER_RE = /^cat-[1-8]$/;
const KIND_LABEL_PL = { text: 'materiał tekstowy', material: 'plik do pobrania', link: 'odnośnik', assignment: 'zadanie domowe', quiz: 'quiz', meeting: 'spotkanie' };
const QUIZ_CATEGORY = { id: 'cat_quiz', name: 'quiz', weight: 2, color: 'cat-8', countsInAverage: true, subjectId: null };
const byOrder = (a, b) => (a.order - b.order) || String(a.id).localeCompare(String(b.id));
const str = (v, max) => String(v == null ? '' : v).trim().slice(0, max || 4000);

/* ---------- dostęp ---------- */
const isCourseTeacher = (user, course) => (course.teacherIds || []).includes(user.id);
function assertEdit(user, course) {
  if (!isCourseTeacher(user, course)) throw httpError(403, 'Kurs może zmieniać wyłącznie nauczyciel prowadzący lub współprowadzący.', { code: 'not_course_teacher' });
}
function getCourse(db, id) { const c = db.get('courses', id); if (!c) throw httpError(404, 'Nie ma takiego kursu.', { code: 'no_course' }); return c; }
function enrollmentOf(db, courseId, studentId) { return db.one('courseEnrollments', (e) => e.courseId === courseId && e.studentId === studentId); }
/** Uczniowie „z automatu”: wszyscy z oddziałów i grup przypisanych do kursu. */
function autoStudentIds(db, course) {
  const out = new Set();
  for (const cid of course.classIds || []) { const c = db.get('classes', cid); if (c) (c.studentIds || []).forEach((s) => out.add(s)); }
  for (const gid of course.groupIds || []) { const g = db.get('groups', gid); if (g) (g.studentIds || []).forEach((s) => out.add(s)); }
  return [...out];
}
function enrolledIds(db, courseId) { return db.col('courseEnrollments').filter((e) => e.courseId === courseId).map((e) => e.studentId); }

/* ---------- spotkania wideo kursu (logika modułu „meetings”, wołana przez jedną ścieżkę) ---------- */

/** Konta uczniów zapisanych na kurs — to jest publiczność spotkania kursu. */
function courseAudienceUserIds(db, courseId) {
  const ids = new Set(enrolledIds(db, courseId));
  return db.col('users').filter((u) => u.role === 'student' && ids.has(u.studentId) && !u.blocked).map((u) => u.id);
}
/** `start`/`end` elementu kursu → znaczniki ISO; brak końca = domyślna długość zajęć. */
function meetingWindow(src) {
  const iso = /^(\d{4}-\d{2}-\d{2})[T ](\d{2}):(\d{2})/.exec(String(src.start || ''));
  if (!iso) throw httpError(400, 'Podaj początek spotkania w formacie RRRR-MM-DDTGG:MM.', { code: 'bad_time' });
  const start = `${iso[1]}T${iso[2]}:${iso[3]}`;
  let end = String(src.end || '');
  if (!end) {
    const mins = (+iso[2]) * 60 + (+iso[3]) + (Number(src.durationMin) > 0 ? Math.round(+src.durationMin) : 45);
    end = `${iso[1]}T${String(Math.min(23, Math.floor(mins / 60))).padStart(2, '0')}:${String(mins % 60).padStart(2, '0')}`;
  }
  return { start, end };
}
/** Nowe spotkanie kursu: gospodarzem jest nauczyciel, publicznością wyłącznie zapisani uczniowie. */
function createCourseMeeting(ctx, course, src, fallbackTitle) {
  const db = ctx.db;
  const { createMeeting } = require('./meetings');
  const participantIds = courseAudienceUserIds(db, course.id);
  if (!participantIds.length) throw httpError(400, 'Zapisz uczniów na kurs, zanim zaplanujesz zajęcia — spotkanie widzą wyłącznie zapisani uczniowie.', { code: 'no_audience' });
  const w = meetingWindow(src);
  const made = createMeeting(ctx, {
    kind: 'course', title: str(src.title || fallbackTitle || course.title, 200), start: w.start, end: w.end,
    joinPolicy: 'invited', participantIds, courseId: course.id, note: str(src.note, 500),
    waitingRoom: src.waitingRoom !== false
  });
  return made.meeting;
}
/** Spotkanie wie, z którego elementu kursu pochodzi (odwrotne powiązanie do /api/meetings/:id/link-course). */
function linkMeetingToItem(db, course, item) {
  if (item.kind !== 'meeting' || !item.meetingId) return null;
  const m = db.get('videoMeetings', item.meetingId);
  if (!m) return null;
  if (m.courseId !== course.id || m.courseItemId !== item.id) { m.courseId = m.courseId || course.id; m.courseItemId = item.id; db.save(); }
  return m;
}
/** Zmiana terminu istniejącego spotkania kursu (dopóki się nie zaczęło) — bez zakładania drugiego pokoju. */
function rescheduleCourseMeeting(ctx, m, src, fallbackTitle) {
  const db = ctx.db;
  const w = meetingWindow(src);
  const before = { start: m.start, end: m.end, title: m.title };
  m.start = w.start + ':00.000Z'; m.end = w.end + ':00.000Z';
  m.title = str(src.title || fallbackTitle || m.title, 200);
  m.participantIds = courseAudienceUserIds(db, m.courseId);
  db.save();
  ctx.audit({ action: 'meeting_rescheduled', entity: 'videoMeetings', entityId: m.id, before, after: { start: m.start, end: m.end, title: m.title }, reason: null });
  return m;
}

/** Kogo dotyczy żądanie ucznia/rodzica: uczeń — siebie, rodzic — wskazane (albo pierwsze) dziecko. */
function subjectStudentId(ctx, explicit) {
  const db = ctx.db, user = ctx.user;
  if (user.role === 'student') return user.studentId;
  /* OPS-17/S-10: postęp w kursie i wyniki quizów to dane o uczeniu się — opiekun z dostępem
     informacyjnym („info”) widzi frekwencję, plan i wiadomości, ale nie oceny ani wyniki prac. */
  if (user.role === 'parent') { const sid = explicit || (user.childrenIds || [])[0] || null; if (sid) D.assertMayReadPupilRecord(db, user, sid, 'grades'); return sid; }
  if (explicit) { D.assertCanSeeStudent(db, user, explicit); return explicit; }
  return null;
}

/* ---------- widoki ---------- */
function teacherRefs(db, course) { return (course.teacherIds || []).map((id) => { const u = db.get('users', id); return { id, name: D.userLabel(u) }; }); }
function unitsOf(db, courseId) { return db.col('courseUnits').filter((u) => u.courseId === courseId).sort(byOrder); }
function itemsOf(db, courseId, unitId) { return db.col('courseItems').filter((i) => i.courseId === courseId && (!unitId || i.unitId === unitId)).sort(byOrder); }
function unitLocked(db, unit) { return !!unit.availableFrom && unit.availableFrom > D.today(db); }
function requiredItems(db, courseId) { return itemsOf(db, courseId).filter((i) => i.required !== false); }

function progressOf(db, courseId, studentId) {
  const req = requiredItems(db, courseId);
  const done = new Set(db.col('courseProgress').filter((p) => p.courseId === courseId && p.studentId === studentId && p.status === 'done').map((p) => p.itemId));
  const doneCount = req.filter((i) => done.has(i.id)).length;
  return { done: doneCount, total: req.length, percent: req.length ? Math.round((doneCount / req.length) * 1000) / 10 : 0, complete: req.length > 0 && doneCount === req.length };
}

function maxScoreOf(quiz) { return ((quiz && quiz.questions) || []).reduce((s, q) => s + (q.points == null ? 1 : +q.points), 0); }
/** Automatyczne sprawdzenie quizu: punkt za pytanie, poprawność pojedynczych pytań tylko po oddaniu. */
function gradeQuiz(quiz, answers) {
  const a = answers || {}; let score = 0, maxScore = 0;
  const results = ((quiz && quiz.questions) || []).map((q) => {
    const points = q.points == null ? 1 : +q.points; maxScore += points;
    const picked = a[q.id] == null ? null : String(a[q.id]);
    const correct = picked != null && picked === q.correctId;
    if (correct) score += points;
    return { questionId: q.id, picked, correct, correctId: q.correctId, points: correct ? points : 0, maxPoints: points };
  });
  return { score, maxScore, results, percent: maxScore ? Math.round((score / maxScore) * 1000) / 10 : 0 };
}
function attemptView(db, att, item) {
  const g = gradeQuiz(item.quiz, att.answers);
  return { id: att.id, at: att.at, score: att.score, maxScore: att.maxScore, percent: att.maxScore ? Math.round((att.score / att.maxScore) * 1000) / 10 : 0, answers: att.answers, results: g.results, autoGraded: true };
}

function itemView(db, item, o) {
  const opt = o || {};
  const out = {
    id: item.id, courseId: item.courseId, unitId: item.unitId, order: item.order, kind: item.kind,
    title: item.title, body: item.body || '', url: item.url || null, required: item.required !== false,
    materialId: item.materialId || null, homeworkId: item.homeworkId || null, meetingId: item.meetingId || null
  };
  if (item.meetingId) {
    const m = db.get('videoMeetings', item.meetingId);
    out.meeting = m ? {
      id: m.id, title: m.title, kind: m.kind, status: m.status, start: m.start, end: m.end,
      date: (m.start || '').slice(0, 10), startTime: (m.start || '').slice(11, 16), endTime: (m.end || '').slice(11, 16),
      joinPath: '#/spotkania?meeting=' + m.id
    } : null;
  }
  if (item.materialId) {
    const m = db.get('materials', item.materialId);
    out.material = m ? { id: m.id, name: m.name, type: m.type, size: m.size || (m.dataUrl || '').length, downloadPath: '/api/materials/' + m.id } : null;
  }
  if (item.homeworkId) {
    const hw = db.get('homework', item.homeworkId);
    out.homework = hw ? { id: hw.id, text: hw.text, dueAt: hw.dueAt, subjectId: hw.subjectId, submitLink: '#/uczen' } : null;
    if (opt.studentId && hw) {
      const sub = db.one('homeworkSubmissions', (s) => s.homeworkId === hw.id && s.studentId === opt.studentId);
      out.submission = sub ? { id: sub.id, receivedAt: sub.receivedAt, reviewedAt: sub.reviewedAt || null, gradeId: sub.gradeId || null } : null;
    }
  }
  if (item.kind === 'quiz') {
    const q = item.quiz || { questions: [], attempts: 1, timeLimitMin: null };
    out.maxScore = maxScoreOf(q);
    out.quiz = opt.reveal ? q : {
      attempts: q.attempts || 1, timeLimitMin: q.timeLimitMin || null,
      questions: (q.questions || []).map((x) => ({ id: x.id, text: x.text, points: x.points == null ? 1 : +x.points, options: (x.options || []).map((op) => ({ id: op.id, text: op.text })) }))
    };
    if (opt.studentId) {
      const atts = db.col('quizAttempts').filter((x) => x.itemId === item.id && x.studentId === opt.studentId).sort((x, y) => (x.at < y.at ? -1 : 1));
      out.attemptsUsed = atts.length; out.attemptsLeft = Math.max(0, (q.attempts || 1) - atts.length);
      out.bestScore = atts.length ? Math.max.apply(null, atts.map((x) => x.score)) : null;
      out.lastAttempt = atts.length ? attemptView(db, atts[atts.length - 1], item) : null;
    }
  }
  if (opt.studentId) {
    const p = db.one('courseProgress', (x) => x.itemId === item.id && x.studentId === opt.studentId);
    out.status = p ? p.status : 'new'; out.score = p && p.score != null ? p.score : null; out.doneAt = p ? p.at : null;
  }
  return out;
}

function courseCard(db, c, o) {
  const opt = o || {};
  const items = itemsOf(db, c.id);
  const out = {
    id: c.id, title: c.title, description: c.description || '', subjectId: c.subjectId,
    subjectName: (db.get('subjects', c.subjectId) || {}).name || c.subjectId,
    classIds: c.classIds || [], groupIds: c.groupIds || [], teacherIds: c.teacherIds || [], teachers: teacherRefs(db, c),
    visibility: c.visibility, enrollmentOpen: !!c.enrollmentOpen, status: c.status, createdAt: c.createdAt,
    coverColor: c.coverColor || 'cat-1', language: c.language || 'pl',
    unitCount: unitsOf(db, c.id).length, itemCount: items.length, requiredCount: items.filter((i) => i.required !== false).length,
    enrolledCount: enrolledIds(db, c.id).length
  };
  if (opt.studentId) {
    out.progress = progressOf(db, c.id, opt.studentId);
    const e = enrollmentOf(db, c.id, opt.studentId);
    out.enrolled = !!e; out.enrolledAt = e ? e.at : null; out.enrollmentSource = e ? e.source : null;
    out.canSelfEnrol = !e && c.visibility === 'open' && !!c.enrollmentOpen && c.status === 'published';
    out.certificatePath = out.progress.complete ? `/api/courses/${c.id}/certificate?studentId=${opt.studentId}` : null;
  }
  return out;
}

/** Przedmioty i oddziały, z których nauczyciel może zbudować kurs (z planu lekcji; dyrekcja — wszystkie). */
function teacherContext(db, user) {
  const pairs = {};
  for (const tt of db.col('timetable')) if (user.role === 'principal' || tt.teacherId === user.id) (pairs[tt.subjectId] = pairs[tt.subjectId] || new Set()).add(tt.classId);
  for (const sid of user.subjects || []) if (!pairs[sid]) pairs[sid] = new Set();
  const subjects = Object.keys(pairs).map((id) => ({ id, name: (db.get('subjects', id) || {}).name || id, classIds: [...pairs[id]] }))
    .sort((a, b) => a.name.localeCompare(b.name, 'pl'));
  const classIds = [...new Set(subjects.reduce((acc, s) => acc.concat(s.classIds), []))];
  const classes = classIds.map((id) => ({ id, name: (db.get('classes', id) || {}).name || id })).sort((a, b) => a.name.localeCompare(b.name, 'pl'));
  const groups = db.col('groups').filter((g) => user.role === 'principal' || (user.subjects || []).includes(g.subjectId)).map((g) => ({ id: g.id, name: g.name, subjectId: g.subjectId }));
  return { subjects, classes, groups, covers: ['cat-1', 'cat-2', 'cat-3', 'cat-4', 'cat-5', 'cat-6', 'cat-7', 'cat-8'], kinds: KINDS };
}

/* ---------- forum kursu ---------- */
function threadsOf(db, courseId, opt) {
  const o = opt || {};
  return db.col('courseThreads').filter((t) => t.courseId === courseId)
    .sort((a, b) => (a.pinned === b.pinned ? (a.at < b.at ? 1 : -1) : a.pinned ? -1 : 1))
    .map((t) => ({
      id: t.id, courseId: t.courseId, title: t.title, at: t.at, byUserId: t.byUserId,
      author: D.userLabel(db.get('users', t.byUserId)) || t.authorName || '', pinned: !!t.pinned, locked: !!t.locked,
      canModerate: !!o.canModerate,
      posts: db.col('coursePosts').filter((p) => p.threadId === t.id).sort((a, b) => (a.at < b.at ? -1 : 1))
        .map((p) => ({ id: p.id, threadId: p.threadId, parentId: p.parentId || null, body: p.body, at: p.at, byUserId: p.byUserId, author: D.userLabel(db.get('users', p.byUserId)) || p.authorName || '' }))
    }));
}

/* ---------- certyfikat ---------- */
function certificateHtml(db, course, student) {
  const cfg = db.data.config; const p = progressOf(db, course.id, student.id);
  const items = requiredItems(db, course.id);
  const rows = items.map((i) => {
    const pr = db.one('courseProgress', (x) => x.itemId === i.id && x.studentId === student.id);
    const score = pr && pr.score != null ? `${pr.score} / ${maxScoreOf(i.quiz)} pkt` : '—';
    return `<tr><td>${D.xmlEsc(i.title)}</td><td>${D.xmlEsc(KIND_LABEL_PL[i.kind] || i.kind)}</td><td>${D.xmlEsc(score)}</td><td>${pr ? U.fmtDate(pr.at) : '—'}</td></tr>`;
  }).join('');
  const body = `<h1>Zaświadczenie o ukończeniu kursu</h1>
<p>Zaświadcza się, że <b>${D.xmlEsc(student.firstName + ' ' + student.lastName)}</b>, uczeń klasy ${D.xmlEsc(student.classId)}, ukończył(a) kurs:</p>
<h2>${D.xmlEsc(course.title)}</h2>
<p class="note">Przedmiot: ${D.xmlEsc((db.get('subjects', course.subjectId) || {}).name || course.subjectId)} · Prowadzący: ${D.xmlEsc(teacherRefs(db, course).map((t) => t.name).join(', '))}</p>
<p>Zrealizowano ${p.done} z ${p.total} elementów obowiązkowych (${D.xmlEsc(String(p.percent).replace('.', ','))} %).</p>
<table><caption>Elementy kursu i wyniki ucznia</caption><thead><tr><th scope="col">Element kursu</th><th scope="col">Rodzaj</th><th scope="col">Wynik</th><th scope="col">Data zaliczenia</th></tr></thead><tbody>${rows}</tbody></table>
<div class="sign"><span>Nauczyciel prowadzący</span><span>Dyrektor szkoły</span></div>`;
  return D.printHtml('Zaświadczenie o ukończeniu kursu — ' + course.title, body, {
    school: cfg.school.name, schoolMeta: cfg.school.address, docNo: 'Kurs / ' + course.id, date: U.fmtDate(D.today(db)), printed: U.fmtDate(D.today(db)),
    gdpr: 'Zaświadczenie wydane na wniosek ucznia; zawiera dane osobowe przetwarzane na podstawie art. 6 ust. 1 lit. c RODO.'
  });
}

/* =====================================================================================
   Trasy
   ===================================================================================== */
function register(r, app) {
  /* ---- lista kursów ---------------------------------------------------------------- */
  r.get('/api/courses', (ctx) => {
    const db = ctx.db, user = ctx.user, q = ctx.query;
    if (user.role === 'student' || user.role === 'parent') {
      const sid = subjectStudentId(ctx, q.studentId);
      if (!sid) throw httpError(403, 'Brak przypisanego ucznia.', { code: 'forbidden' });
      const mine = db.col('courses').filter((c) => c.status === 'published' && enrollmentOf(db, c.id, sid));
      const available = user.role === 'student'
        ? db.col('courses').filter((c) => c.status === 'published' && c.visibility === 'open' && c.enrollmentOpen && !enrollmentOf(db, c.id, sid))
        : [];
      return {
        studentId: sid, student: D.studentLabel(db.get('students', sid)), readOnly: user.role === 'parent',
        courses: mine.map((c) => courseCard(db, c, { studentId: sid })),
        available: available.map((c) => courseCard(db, c, { studentId: sid })),
        today: D.today(db)
      };
    }
    let rows = db.col('courses').slice();
    if (user.role !== 'principal' && q.all !== '1') rows = rows.filter((c) => isCourseTeacher(user, c));
    if (q.status) rows = rows.filter((c) => c.status === q.status);
    rows.sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
    return { courses: rows.map((c) => courseCard(db, c)), canCreate: ['teacher', 'principal'].includes(user.role), today: D.today(db), context: teacherContext(db, user) };
  }, { roles: ['staff', 'student', 'parent'] });

  /* ---- utworzenie kursu ------------------------------------------------------------ */
  r.post('/api/courses', (ctx) => {
    const db = ctx.db, b = ctx.body || {};
    const title = str(b.title, 200);
    if (!title) throw httpError(400, 'Podaj tytuł kursu.', { code: 'empty_title' });
    const subjectId = b.subjectId;
    if (!db.get('subjects', subjectId)) throw httpError(400, 'Wybierz przedmiot kursu.', { code: 'bad_subject' });
    if (!D.teacherTeaches(db, ctx.user, subjectId, null)) throw httpError(403, 'Kurs może założyć tylko nauczyciel uczący tego przedmiotu.', { code: 'not_subject_teacher' });
    const classIds = (Array.isArray(b.classIds) ? b.classIds : []).filter((c) => db.get('classes', c));
    const groupIds = (Array.isArray(b.groupIds) ? b.groupIds : []).filter((g) => db.get('groups', g));
    const visibility = b.visibility === 'open' ? 'open' : 'class';
    if (visibility === 'class' && !classIds.length && !groupIds.length) throw httpError(400, 'Kurs dla klasy musi mieć wskazany oddział albo grupę.', { code: 'no_audience' });
    const teacherIds = [...new Set([ctx.user.id].concat(Array.isArray(b.teacherIds) ? b.teacherIds.filter((t) => db.get('users', t)) : []))];
    const coverColor = COVER_RE.test(b.coverColor || '') ? b.coverColor : 'cat-1';
    const row = db.insert('courses', {
      id: U.id('co'), title, description: str(b.description, 2000), subjectId, classIds, groupIds, teacherIds,
      visibility, enrollmentOpen: visibility === 'open' ? b.enrollmentOpen !== false : !!b.enrollmentOpen,
      status: 'draft', createdAt: U.now(), coverColor, language: b.language === 'en' ? 'en' : 'pl'
    });
    ctx.audit({ action: 'course_create', entity: 'course', entityId: row.id, before: null, after: { title, subjectId, classIds, visibility }, reason: null });
    return { ok: true, course: courseCard(db, row) };
  }, { roles: ['teacher', 'principal'] });

  /* ---- widok kursu ----------------------------------------------------------------- */
  r.get('/api/courses/:id', (ctx) => {
    const db = ctx.db, user = ctx.user; const c = getCourse(db, ctx.params.id);
    const staff = user.role !== 'student' && user.role !== 'parent';
    if (staff) {
      if (!isCourseTeacher(user, c) && user.role !== 'principal') throw httpError(403, 'Kurs widzi nauczyciel prowadzący albo dyrekcja.', { code: 'forbidden' });
      const canEdit = isCourseTeacher(user, c);
      return {
        role: canEdit ? 'teacher' : 'principal', canEdit, today: D.today(db),
        course: courseCard(db, c),
        units: unitsOf(db, c.id).map((u) => ({ id: u.id, courseId: u.courseId, order: u.order, title: u.title, summary: u.summary || '', availableFrom: u.availableFrom || null, lessonId: u.lessonId || null, locked: unitLocked(db, u), items: itemsOf(db, c.id, u.id).map((i) => itemView(db, i, { reveal: true })) })),
        enrollments: db.col('courseEnrollments').filter((e) => e.courseId === c.id).map((e) => ({ studentId: e.studentId, name: D.studentLabel(db.get('students', e.studentId)), at: e.at, source: e.source, progress: progressOf(db, c.id, e.studentId) })),
        autoStudentIds: autoStudentIds(db, c),
        discussion: threadsOf(db, c.id, { canModerate: canEdit })
      };
    }
    const sid = subjectStudentId(ctx, ctx.query.studentId);
    if (!sid) throw httpError(403, 'Brak przypisanego ucznia.', { code: 'forbidden' });
    if (c.status !== 'published') throw httpError(404, 'Kurs nie został jeszcze opublikowany.', { code: 'course_not_published' });
    if (!enrollmentOf(db, c.id, sid)) throw httpError(403, 'Nie jesteś zapisany na ten kurs.', { code: 'not_enrolled' });
    const units = unitsOf(db, c.id).map((u) => {
      const locked = unitLocked(db, u);
      return {
        id: u.id, courseId: u.courseId, order: u.order, title: u.title, summary: u.summary || '',
        availableFrom: u.availableFrom || null, lessonId: u.lessonId || null, locked,
        lockedNote: locked ? `Jednostka otworzy się ${U.fmtDate(u.availableFrom)}.` : null,
        items: locked ? [] : itemsOf(db, c.id, u.id).map((i) => itemView(db, i, { studentId: sid }))
      };
    });
    const p = progressOf(db, c.id, sid);
    return {
      role: user.role === 'parent' ? 'parent' : 'student', canEdit: false, readOnly: user.role === 'parent',
      studentId: sid, student: D.studentLabel(db.get('students', sid)), today: D.today(db),
      course: courseCard(db, c, { studentId: sid }), units, progress: p,
      certificatePath: p.complete ? `/api/courses/${c.id}/certificate?studentId=${sid}` : null,
      discussion: threadsOf(db, c.id, { canModerate: false })
    };
  }, { roles: ['staff', 'student', 'parent'] });

  /* ---- edycja kursu ---------------------------------------------------------------- */
  r.patch('/api/courses/:id', (ctx) => {
    const db = ctx.db, b = ctx.body || {}; const c = getCourse(db, ctx.params.id); assertEdit(ctx.user, c);
    const before = { title: c.title, description: c.description, visibility: c.visibility, enrollmentOpen: c.enrollmentOpen, classIds: c.classIds, coverColor: c.coverColor, language: c.language };
    if (b.title !== undefined) { const t = str(b.title, 200); if (!t) throw httpError(400, 'Tytuł kursu nie może być pusty.', { code: 'empty_title' }); c.title = t; }
    if (b.description !== undefined) c.description = str(b.description, 2000);
    if (b.visibility !== undefined) c.visibility = b.visibility === 'open' ? 'open' : 'class';
    if (b.enrollmentOpen !== undefined) c.enrollmentOpen = !!b.enrollmentOpen;
    if (Array.isArray(b.classIds)) c.classIds = b.classIds.filter((x) => db.get('classes', x));
    if (Array.isArray(b.groupIds)) c.groupIds = b.groupIds.filter((x) => db.get('groups', x));
    if (Array.isArray(b.teacherIds)) c.teacherIds = [...new Set([ctx.user.id].concat(b.teacherIds.filter((x) => db.get('users', x))))];
    if (b.coverColor !== undefined && COVER_RE.test(b.coverColor)) c.coverColor = b.coverColor;
    if (b.language !== undefined) c.language = b.language === 'en' ? 'en' : 'pl';
    db.save();
    ctx.audit({ action: 'course_update', entity: 'course', entityId: c.id, before, after: { title: c.title, description: c.description, visibility: c.visibility, enrollmentOpen: c.enrollmentOpen, classIds: c.classIds, coverColor: c.coverColor, language: c.language }, reason: str(b.reason, 300) || null });
    return { ok: true, course: courseCard(db, c) };
  }, { roles: ['teacher', 'principal'] });

  r.delete('/api/courses/:id', (ctx) => {
    const db = ctx.db; const c = getCourse(db, ctx.params.id); assertEdit(ctx.user, c);
    if (c.status !== 'draft') throw httpError(409, 'Usunąć można wyłącznie kurs w wersji roboczej — opublikowany kurs archiwizuje się.', { code: 'not_draft' });
    const before = { title: c.title, status: c.status };
    itemsOf(db, c.id).forEach((i) => db.remove('courseItems', i.id));
    unitsOf(db, c.id).forEach((u) => db.remove('courseUnits', u.id));
    db.col('courseEnrollments').filter((e) => e.courseId === c.id).forEach((e) => db.remove('courseEnrollments', e.id));
    db.remove('courses', c.id);
    ctx.audit({ action: 'course_delete', entity: 'course', entityId: c.id, before, after: null, reason: null });
    return { ok: true };
  }, { roles: ['teacher', 'principal'] });

  /* ---- publikacja i archiwizacja --------------------------------------------------- */
  r.post('/api/courses/:id/publish', (ctx) => {
    const db = ctx.db; const c = getCourse(db, ctx.params.id); assertEdit(ctx.user, c);
    if (!unitsOf(db, c.id).length) throw httpError(400, 'Kurs bez jednostek nie może zostać opublikowany.', { code: 'no_units' });
    const before = { status: c.status };
    c.status = 'published'; c.publishedAt = U.now(); db.save();
    ctx.audit({ action: 'course_publish', entity: 'course', entityId: c.id, before, after: { status: c.status, publishedAt: c.publishedAt }, reason: null });
    for (const sid of enrolledIds(db, c.id)) { const u = db.one('users', (x) => x.role === 'student' && x.studentId === sid); if (u) D.notify(db, u.id, 'course', `Kurs „${c.title}” jest już dostępny.`, { link: '#/kursy?course=' + c.id }); }
    return { ok: true, course: courseCard(db, c) };
  }, { roles: ['teacher', 'principal'] });

  r.post('/api/courses/:id/archive', (ctx) => {
    const db = ctx.db; const c = getCourse(db, ctx.params.id); assertEdit(ctx.user, c);
    const before = { status: c.status };
    c.status = 'archived'; c.archivedAt = U.now(); db.save();
    ctx.audit({ action: 'course_archive', entity: 'course', entityId: c.id, before, after: { status: c.status }, reason: str((ctx.body || {}).reason, 300) || null });
    return { ok: true, course: courseCard(db, c) };
  }, { roles: ['teacher', 'principal'] });

  /* ---- jednostki ------------------------------------------------------------------- */
  r.post('/api/courses/:id/units', (ctx) => {
    const db = ctx.db, b = ctx.body || {}; const c = getCourse(db, ctx.params.id); assertEdit(ctx.user, c);
    const title = str(b.title, 200);
    if (!title) throw httpError(400, 'Podaj tytuł jednostki.', { code: 'empty_title' });
    if (b.availableFrom && !/^\d{4}-\d{2}-\d{2}$/.test(b.availableFrom)) throw httpError(400, 'Data otwarcia jednostki musi mieć format RRRR-MM-DD.', { code: 'bad_date' });
    const order = b.order != null ? +b.order : unitsOf(db, c.id).length + 1;
    const row = db.insert('courseUnits', { id: U.id('cou'), courseId: c.id, order, title, summary: str(b.summary, 1000), availableFrom: b.availableFrom || null, lessonId: b.lessonId && db.get('lessons', b.lessonId) ? b.lessonId : null });
    ctx.audit({ action: 'course_unit_create', entity: 'courseUnit', entityId: row.id, before: null, after: { courseId: c.id, title, order, availableFrom: row.availableFrom }, reason: null });
    return { ok: true, unit: Object.assign({}, row, { locked: unitLocked(db, row), items: [] }) };
  }, { roles: ['teacher', 'principal'] });

  r.patch('/api/courses/:id/units/:unitId', (ctx) => {
    const db = ctx.db, b = ctx.body || {}; const c = getCourse(db, ctx.params.id); assertEdit(ctx.user, c);
    const u = db.get('courseUnits', ctx.params.unitId);
    if (!u || u.courseId !== c.id) throw httpError(404, 'Nie ma takiej jednostki kursu.', { code: 'no_unit' });
    const before = { title: u.title, order: u.order, availableFrom: u.availableFrom, summary: u.summary };
    if (b.title !== undefined) { const t = str(b.title, 200); if (!t) throw httpError(400, 'Tytuł jednostki nie może być pusty.', { code: 'empty_title' }); u.title = t; }
    if (b.summary !== undefined) u.summary = str(b.summary, 1000);
    if (b.order !== undefined) u.order = +b.order;
    if (b.availableFrom !== undefined) {
      if (b.availableFrom && !/^\d{4}-\d{2}-\d{2}$/.test(b.availableFrom)) throw httpError(400, 'Data otwarcia jednostki musi mieć format RRRR-MM-DD.', { code: 'bad_date' });
      u.availableFrom = b.availableFrom || null;
    }
    if (b.lessonId !== undefined) u.lessonId = b.lessonId && db.get('lessons', b.lessonId) ? b.lessonId : null;
    db.save();
    ctx.audit({ action: 'course_unit_update', entity: 'courseUnit', entityId: u.id, before, after: { title: u.title, order: u.order, availableFrom: u.availableFrom, summary: u.summary }, reason: null });
    return { ok: true, unit: Object.assign({}, u, { locked: unitLocked(db, u) }) };
  }, { roles: ['teacher', 'principal'] });

  r.delete('/api/courses/:id/units/:unitId', (ctx) => {
    const db = ctx.db; const c = getCourse(db, ctx.params.id); assertEdit(ctx.user, c);
    const u = db.get('courseUnits', ctx.params.unitId);
    if (!u || u.courseId !== c.id) throw httpError(404, 'Nie ma takiej jednostki kursu.', { code: 'no_unit' });
    itemsOf(db, c.id, u.id).forEach((i) => db.remove('courseItems', i.id));
    db.remove('courseUnits', u.id);
    ctx.audit({ action: 'course_unit_delete', entity: 'courseUnit', entityId: u.id, before: { title: u.title, courseId: c.id }, after: null, reason: null });
    return { ok: true };
  }, { roles: ['teacher', 'principal'] });

  /* ---- elementy jednostki ---------------------------------------------------------- */
  /** Walidacja quizu budowanego przez nauczyciela: pytania jednokrotnego wyboru z poprawną odpowiedzią. */
  function normalizeQuiz(q) {
    const src = q || {};
    const questions = (Array.isArray(src.questions) ? src.questions : []).map((x, n) => {
      const qid = str(x.id, 40) || 'q' + (n + 1);
      const options = (Array.isArray(x.options) ? x.options : []).map((op, k) => ({ id: str(op.id, 40) || 'o' + (k + 1), text: str(op.text, 400) }));
      if (options.length < 2) throw httpError(400, `Pytanie „${str(x.text, 60)}” musi mieć co najmniej dwie odpowiedzi.`, { code: 'bad_quiz' });
      const correctId = str(x.correctId, 40);
      if (!options.some((op) => op.id === correctId)) throw httpError(400, `Wskaż poprawną odpowiedź w pytaniu „${str(x.text, 60)}”.`, { code: 'bad_quiz' });
      const text = str(x.text, 1000);
      if (!text) throw httpError(400, 'Każde pytanie quizu musi mieć treść.', { code: 'bad_quiz' });
      const points = x.points == null ? 1 : Math.round(Number(x.points));
      if (!Number.isFinite(points) || points < 1 || points > 100) throw httpError(400, 'Punktacja pytania musi mieścić się w przedziale 1–100.', { code: 'bad_quiz' });
      return { id: qid, text, options, correctId, points };
    });
    if (!questions.length) throw httpError(400, 'Quiz musi mieć co najmniej jedno pytanie.', { code: 'bad_quiz' });
    const attempts = src.attempts == null ? 1 : Math.round(Number(src.attempts));
    if (!Number.isFinite(attempts) || attempts < 1 || attempts > 10) throw httpError(400, 'Liczba podejść musi mieścić się w przedziale 1–10.', { code: 'bad_quiz' });
    const timeLimitMin = src.timeLimitMin == null || src.timeLimitMin === '' ? null : Math.round(Number(src.timeLimitMin));
    if (timeLimitMin != null && (!Number.isFinite(timeLimitMin) || timeLimitMin < 1)) throw httpError(400, 'Limit czasu musi być liczbą minut.', { code: 'bad_quiz' });
    return { questions, attempts, timeLimitMin };
  }

  function itemPayload(ctx, c, b, base) {
    const db = ctx.db;
    const kind = b.kind || (base && base.kind);
    if (!KINDS.includes(kind)) throw httpError(400, 'Nieznany rodzaj elementu kursu.', { code: 'bad_kind' });
    const out = { kind, title: b.title !== undefined ? str(b.title, 200) : (base ? base.title : '') };
    if (!out.title) throw httpError(400, 'Podaj tytuł elementu kursu.', { code: 'empty_title' });
    out.body = b.body !== undefined ? str(b.body, 20000) : (base ? base.body : '');
    out.required = b.required !== undefined ? !!b.required : (base ? base.required !== false : true);
    out.materialId = null; out.url = null; out.homeworkId = null; out.quiz = null; out.meetingId = null;
    if (kind === 'material') {
      const mid = b.materialId !== undefined ? b.materialId : (base && base.materialId);
      const mat = mid ? db.get('materials', mid) : null;
      if (!mat) throw httpError(400, 'Wskaż materiał z dziennika.', { code: 'no_material' });
      /* S-13: kurs udostępnia plik uczniom całego oddziału, więc materiał przechodzi tę samą
         kontrolę co każdy inny załącznik — typ zgodny z treścią, bez HTML/SVG/skryptów. */
      validateUpload({ name: mat.name, type: mat.type, size: mat.size, dataUrl: mat.dataUrl },
        { maxMB: db.data.config.homeworkMaxAttachmentMB || 10, fallbackName: 'material' });
      out.materialId = mid;
    } else if (kind === 'link') {
      const url = str(b.url !== undefined ? b.url : (base && base.url), 500);
      if (!/^https?:\/\//i.test(url)) throw httpError(400, 'Odnośnik musi zaczynać się od http:// albo https://.', { code: 'bad_url' });
      out.url = url;
    } else if (kind === 'assignment') {
      let hwId = b.homeworkId !== undefined ? b.homeworkId : (base && base.homeworkId);
      if (!hwId && b.homework) {
        // zadanie tworzone razem z elementem — ta sama postać co POST /api/homework (3.1.17)
        const hb = b.homework;
        const classId = hb.classId || (c.classIds || [])[0];
        const text = str(hb.text, 4000);
        if (!classId || !db.get('classes', classId)) throw httpError(400, 'Podaj oddział zadania domowego.', { code: 'bad_class' });
        if (!text) throw httpError(400, 'Treść zadania domowego nie może być pusta.', { code: 'empty_text' });
        if (!D.teacherTeaches(db, ctx.user, c.subjectId, classId)) throw httpError(403, 'Zadanie domowe może opublikować tylko nauczyciel uczący tego przedmiotu w tym oddziale.', { code: 'not_subject_teacher' });
        const dueParts = require('./homework').normalizeDueParts(hb.dueAt || hb.due, D.tz(db)) || {}; const dueAt = dueParts.dueAt || null, dueLocal = dueParts.dueLocal || null;
        if (!dueAt) throw httpError(400, 'Podaj termin oddania w formacie RRRR-MM-DD lub RRRR-MM-DDTGG:MM.', { code: 'bad_due' });
        const hw = db.insert('homework', {
          id: U.id('hw'), classId, groupId: hb.groupId || null, subjectId: c.subjectId, teacherId: ctx.user.id, text,
          dueAt, dueLocal, maxAttachmentMB: db.data.config.homeworkMaxAttachmentMB || 10, lockAfterDue: hb.lockAfterDue !== false,
          attachments: [], lessonId: null, createdAt: U.now()
        });
        ctx.audit({ action: 'homework_publish', entity: 'homework', entityId: hw.id, before: null, after: { classId, subjectId: c.subjectId, dueAt, courseId: c.id }, reason: null });
        hwId = hw.id;
      }
      if (!hwId || !db.get('homework', hwId)) throw httpError(400, 'Wskaż zadanie domowe albo podaj jego treść i termin.', { code: 'no_homework' });
      out.homeworkId = hwId;
    } else if (kind === 'quiz') {
      out.quiz = b.quiz !== undefined ? normalizeQuiz(b.quiz) : (base && base.quiz) || normalizeQuiz(null);
    } else if (kind === 'meeting') {
      /* Termin zamiast identyfikatora: spotkanie zakłada (albo przestawia) moduł „meetings”. */
      const explicit = b.meetingId !== undefined ? (str(b.meetingId, 100) || null) : null;
      if (explicit && !db.get('videoMeetings', explicit)) throw httpError(400, 'Nie ma takiego spotkania wideo.', { code: 'no_meeting' });
      let meetingId = explicit || (base && base.meetingId) || null;
      const src = b.meeting && typeof b.meeting === 'object' ? b.meeting : b;
      if (!explicit && src.start) {
        const current = meetingId ? db.get('videoMeetings', meetingId) : null;
        const { isCancellable } = require('./meetings');
        meetingId = (current && current.courseId === c.id && isCancellable(current)
          ? rescheduleCourseMeeting(ctx, current, src, out.title)
          : createCourseMeeting(ctx, c, src, out.title)).id;
      }
      if (!meetingId) throw httpError(400, 'Wskaż spotkanie wideo albo podaj termin zajęć (start, end).', { code: 'no_meeting' });
      out.meetingId = meetingId;
    }
    return out;
  }

  r.post('/api/courses/:id/items', (ctx) => {
    const db = ctx.db, b = ctx.body || {}; const c = getCourse(db, ctx.params.id); assertEdit(ctx.user, c);
    const unit = db.get('courseUnits', b.unitId);
    if (!unit || unit.courseId !== c.id) throw httpError(404, 'Nie ma takiej jednostki kursu.', { code: 'no_unit' });
    const payload = itemPayload(ctx, c, b, null);
    const order = b.order != null ? +b.order : itemsOf(db, c.id, unit.id).length + 1;
    const row = db.insert('courseItems', Object.assign({ id: U.id('coi'), courseId: c.id, unitId: unit.id, order }, payload));
    linkMeetingToItem(db, c, row);
    ctx.audit({ action: 'course_item_create', entity: 'courseItem', entityId: row.id, before: null, after: { courseId: c.id, unitId: unit.id, kind: row.kind, title: row.title, required: row.required }, reason: null });
    return { ok: true, item: itemView(db, row, { reveal: true }) };
  }, { roles: ['teacher', 'principal'] });

  r.patch('/api/courses/:id/items/:itemId', (ctx) => {
    const db = ctx.db, b = ctx.body || {}; const c = getCourse(db, ctx.params.id); assertEdit(ctx.user, c);
    const it = db.get('courseItems', ctx.params.itemId);
    if (!it || it.courseId !== c.id) throw httpError(404, 'Nie ma takiego elementu kursu.', { code: 'no_item' });
    const before = { title: it.title, kind: it.kind, body: it.body, order: it.order, required: it.required };
    const payload = itemPayload(ctx, c, b, it);
    if (b.unitId !== undefined) { const u = db.get('courseUnits', b.unitId); if (!u || u.courseId !== c.id) throw httpError(404, 'Nie ma takiej jednostki kursu.', { code: 'no_unit' }); it.unitId = u.id; }
    if (b.order !== undefined) it.order = +b.order;
    Object.assign(it, payload); db.save();
    linkMeetingToItem(db, c, it);
    ctx.audit({ action: 'course_item_update', entity: 'courseItem', entityId: it.id, before, after: { title: it.title, kind: it.kind, body: it.body, order: it.order, required: it.required }, reason: null });
    return { ok: true, item: itemView(db, it, { reveal: true }) };
  }, { roles: ['teacher', 'principal'] });

  r.delete('/api/courses/:id/items/:itemId', (ctx) => {
    const db = ctx.db; const c = getCourse(db, ctx.params.id); assertEdit(ctx.user, c);
    const it = db.get('courseItems', ctx.params.itemId);
    if (!it || it.courseId !== c.id) throw httpError(404, 'Nie ma takiego elementu kursu.', { code: 'no_item' });
    /* Usunięcie elementu odwołuje spotkanie kursu, o ile jeszcze się nie zaczęło. */
    let meetingCancelled = null;
    if (it.kind === 'meeting' && it.meetingId) {
      const m = db.get('videoMeetings', it.meetingId);
      const { isCancellable, cancelMeeting } = require('./meetings');
      if (m && m.courseId === c.id && isCancellable(m)) { cancelMeeting(ctx, m, `Usunięto element kursu „${it.title}”.`); meetingCancelled = m.id; }
    }
    db.remove('courseItems', it.id);
    ctx.audit({ action: 'course_item_delete', entity: 'courseItem', entityId: it.id, before: { title: it.title, kind: it.kind, courseId: c.id, meetingId: it.meetingId || null }, after: null, reason: null });
    return { ok: true, meetingCancelled };
  }, { roles: ['teacher', 'principal'] });

  /* ---- zapisy ---------------------------------------------------------------------- */
  r.post('/api/courses/:id/enrol', (ctx) => {
    const db = ctx.db, b = ctx.body || {}; const c = getCourse(db, ctx.params.id); assertEdit(ctx.user, c);
    let ids;
    if (Array.isArray(b.studentIds) && b.studentIds.length) ids = b.studentIds.filter((s) => db.get('students', s));
    else if (b.classId) { const cls = db.get('classes', b.classId); if (!cls) throw httpError(404, 'Nie ma takiej klasy.', { code: 'no_class' }); ids = cls.studentIds.slice(); if (!(c.classIds || []).includes(cls.id)) { c.classIds = (c.classIds || []).concat([cls.id]); db.save(); } }
    else ids = autoStudentIds(db, c);
    if (!ids.length) throw httpError(400, 'Nie wskazano uczniów do zapisania — kurs nie ma przypisanego oddziału ani grupy.', { code: 'no_audience' });
    const added = [];
    for (const sid of ids) { if (enrollmentOf(db, c.id, sid)) continue; db.insert('courseEnrollments', { id: U.id('coe'), courseId: c.id, studentId: sid, at: U.now(), source: 'class' }); added.push(sid); }
    ctx.audit({ action: 'course_enrol', entity: 'course', entityId: c.id, before: null, after: { added, source: 'class', classId: b.classId || null }, reason: null });
    if (c.status === 'published') for (const sid of added) { const u = db.one('users', (x) => x.role === 'student' && x.studentId === sid); if (u) D.notify(db, u.id, 'course', `Zapisano Cię na kurs „${c.title}”.`, { link: '#/kursy?course=' + c.id }); }
    return { ok: true, added: added.length, enrolled: enrolledIds(db, c.id).length, course: courseCard(db, c) };
  }, { roles: ['teacher', 'principal'] });

  r.post('/api/courses/:id/enrol/self', (ctx) => {
    const db = ctx.db; const c = getCourse(db, ctx.params.id); const sid = ctx.user.studentId;
    if (c.status !== 'published') throw httpError(404, 'Kurs nie został jeszcze opublikowany.', { code: 'course_not_published' });
    if (c.visibility !== 'open' || !c.enrollmentOpen) throw httpError(403, 'Na ten kurs zapisuje nauczyciel — samodzielny zapis jest niedostępny.', { code: 'enrolment_closed' });
    if (enrollmentOf(db, c.id, sid)) return { ok: true, already: true, course: courseCard(db, c, { studentId: sid }) };
    db.insert('courseEnrollments', { id: U.id('coe'), courseId: c.id, studentId: sid, at: U.now(), source: 'self' });
    ctx.audit({ action: 'course_enrol_self', entity: 'course', entityId: c.id, before: null, after: { studentId: sid, source: 'self' }, reason: null });
    return { ok: true, course: courseCard(db, c, { studentId: sid }) };
  }, { roles: ['student'] });

  /* ---- postęp ucznia --------------------------------------------------------------- */
  function studentItem(ctx, requireUnlocked) {
    const db = ctx.db; const c = getCourse(db, ctx.params.id); const sid = ctx.user.studentId;
    if (c.status !== 'published') throw httpError(404, 'Kurs nie został jeszcze opublikowany.', { code: 'course_not_published' });
    if (!enrollmentOf(db, c.id, sid)) throw httpError(403, 'Nie jesteś zapisany na ten kurs.', { code: 'not_enrolled' });
    const it = db.get('courseItems', ctx.params.itemId);
    if (!it || it.courseId !== c.id) throw httpError(404, 'Nie ma takiego elementu kursu.', { code: 'no_item' });
    const unit = db.get('courseUnits', it.unitId);
    if (requireUnlocked && unit && unitLocked(db, unit)) throw httpError(403, `Ta jednostka otworzy się ${U.fmtDate(unit.availableFrom)}.`, { code: 'unit_locked', availableFrom: unit.availableFrom });
    return { course: c, item: it, studentId: sid };
  }

  r.post('/api/courses/:id/items/:itemId/done', (ctx) => {
    const db = ctx.db; const { course, item, studentId } = studentItem(ctx, true);
    const status = (ctx.body || {}).status === 'seen' ? 'seen' : 'done';
    const existing = db.one('courseProgress', (p) => p.itemId === item.id && p.studentId === studentId);
    const before = existing ? { status: existing.status, at: existing.at } : null;
    let row;
    if (existing) { existing.status = status; existing.at = U.now(); db.save(); row = existing; }
    else row = db.insert('courseProgress', { id: U.id('cop'), courseId: course.id, studentId, itemId: item.id, status, score: null, at: U.now() });
    ctx.audit({ action: 'course_item_progress', entity: 'courseProgress', entityId: row.id, before, after: { courseId: course.id, itemId: item.id, status, studentId }, reason: null });
    const p = progressOf(db, course.id, studentId);
    return { ok: true, progress: p, item: itemView(db, item, { studentId }), certificatePath: p.complete ? `/api/courses/${course.id}/certificate?studentId=${studentId}` : null };
  }, { roles: ['student'] });

  /* ---- quiz: oddanie i automatyczne sprawdzenie ------------------------------------ */
  r.post('/api/courses/:id/items/:itemId/quiz', (ctx) => {
    const db = ctx.db; const { course, item, studentId } = studentItem(ctx, true);
    if (item.kind !== 'quiz') throw httpError(400, 'Ten element kursu nie jest quizem.', { code: 'not_quiz' });
    const quiz = item.quiz || { questions: [], attempts: 1 };
    const used = db.col('quizAttempts').filter((a) => a.itemId === item.id && a.studentId === studentId).length;
    const limit = quiz.attempts || 1;
    if (used >= limit) throw httpError(409, `Wykorzystano wszystkie podejścia do quizu (${limit}).`, { code: 'attempts_exhausted', attempts: limit });
    const answers = {};
    const src = (ctx.body || {}).answers || {};
    for (const q of quiz.questions || []) if (src[q.id] != null) answers[q.id] = String(src[q.id]);
    const g = gradeQuiz(quiz, answers);
    const att = db.insert('quizAttempts', { id: U.id('coq'), itemId: item.id, courseId: course.id, studentId, answers, score: g.score, maxScore: g.maxScore, at: U.now(), autoGraded: true });
    const best = Math.max.apply(null, db.col('quizAttempts').filter((a) => a.itemId === item.id && a.studentId === studentId).map((a) => a.score));
    const existing = db.one('courseProgress', (p) => p.itemId === item.id && p.studentId === studentId);
    if (existing) { existing.status = 'done'; existing.score = best; existing.at = U.now(); db.save(); }
    else db.insert('courseProgress', { id: U.id('cop'), courseId: course.id, studentId, itemId: item.id, status: 'done', score: best, at: U.now() });
    ctx.audit({ action: 'course_quiz_submit', entity: 'quizAttempt', entityId: att.id, before: null, after: { courseId: course.id, itemId: item.id, studentId, score: g.score, maxScore: g.maxScore, autoGraded: true }, reason: null });
    const p = progressOf(db, course.id, studentId);
    return {
      ok: true, autoGraded: true, score: g.score, maxScore: g.maxScore, percent: g.percent,
      suggestedGrade: U.pointsToGrade(g.score, g.maxScore, db.data.config.percentScale).grade,
      results: g.results, attemptsUsed: used + 1, attemptsLeft: Math.max(0, limit - used - 1), bestScore: best,
      progress: p, certificatePath: p.complete ? `/api/courses/${course.id}/certificate?studentId=${studentId}` : null
    };
  }, { roles: ['student'] });

  /* ---- „wpisz ocenę z quizu”: wynik quizu → ocena cząstkowa przez logikę modułu ocen -- */
  r.post('/api/courses/:id/items/:itemId/grade', (ctx) => {
    const db = ctx.db, b = ctx.body || {}; const c = getCourse(db, ctx.params.id); assertEdit(ctx.user, c);
    const item = db.get('courseItems', ctx.params.itemId);
    if (!item || item.courseId !== c.id) throw httpError(404, 'Nie ma takiego elementu kursu.', { code: 'no_item' });
    if (item.kind !== 'quiz') throw httpError(400, 'Ocenę z quizu można wpisać tylko dla elementu typu quiz.', { code: 'not_quiz' });
    const studentId = b.studentId;
    const student = db.get('students', studentId);
    if (!student) throw httpError(404, 'Nie znaleziono ucznia.', { code: 'no_student' });
    const atts = db.col('quizAttempts').filter((a) => a.itemId === item.id && a.studentId === studentId);
    if (!atts.length) throw httpError(409, `${D.studentLabel(student)} nie rozwiązał(a) jeszcze tego quizu.`, { code: 'no_attempt' });
    const best = atts.reduce((a, x) => (x.score > a.score ? x : a), atts[0]);
    // kategoria „quiz” — tworzona przy pierwszym wpisie
    let cat = db.col('gradeCategories').find((x) => x.name === 'quiz');
    if (!cat) { cat = Object.assign({}, QUIZ_CATEGORY); db.col('gradeCategories').push(cat); db.save(); ctx.audit({ action: 'grade_category_create', entity: 'gradeCategory', entityId: cat.id, before: null, after: cat, reason: 'Kategoria dla ocen z quizów kursu' }); }
    const out = writeGrade(ctx, {
      studentId, subjectId: c.subjectId, classId: student.classId, categoryId: cat.id,
      points: best.score, maxPoints: best.maxScore, value: b.value || undefined,
      comment: str(b.comment, 500) || `Quiz „${item.title}” w kursie „${c.title}”`,
      date: b.date || D.today(db), kind: 'partial', reason: 'Wynik quizu z kursu ' + c.id,
      /* Quiz kursu rozwiązuje się asynchronicznie, poza godziną lekcyjną — blokada 3.1.2 („uczeń był
         nieobecny na tej lekcji”) nie ma tu zastosowania, więc wpis idzie jako uzupełnienie. */
      makeup: b.makeup === undefined ? true : !!b.makeup
    });
    const pr = db.one('courseProgress', (x) => x.itemId === item.id && x.studentId === studentId);
    if (pr) { pr.gradeId = out.grade.id; db.save(); }
    ctx.audit({ action: 'course_quiz_grade', entity: 'courseItem', entityId: item.id, before: null, after: { courseId: c.id, studentId, gradeId: out.grade.id, score: best.score, maxScore: best.maxScore }, reason: null });
    return Object.assign({ ok: true, courseId: c.id, itemId: item.id, attemptId: best.id }, out);
  }, { roles: ['teacher', 'principal'] });

  /* ---- dziennik postępów (gradebook) ----------------------------------------------- */
  r.get('/api/courses/:id/gradebook', (ctx) => {
    const db = ctx.db, user = ctx.user; const c = getCourse(db, ctx.params.id);
    if (!isCourseTeacher(user, c) && user.role !== 'principal') throw httpError(403, 'Dziennik postępów widzi nauczyciel prowadzący albo dyrekcja.', { code: 'forbidden' });
    const items = itemsOf(db, c.id);
    const quizzes = items.filter((i) => i.kind === 'quiz');
    const assignments = items.filter((i) => i.kind === 'assignment');
    const ids = enrolledIds(db, c.id);
    const students = ids.map((sid) => {
      const s = db.get('students', sid);
      const p = progressOf(db, c.id, sid);
      const quiz = {}; const assignment = {};
      for (const q of quizzes) {
        const atts = db.col('quizAttempts').filter((a) => a.itemId === q.id && a.studentId === sid);
        const max = maxScoreOf(q.quiz);
        const best = atts.length ? Math.max.apply(null, atts.map((a) => a.score)) : null;
        const pr = db.one('courseProgress', (x) => x.itemId === q.id && x.studentId === sid);
        const gradeRow = pr && pr.gradeId ? db.get('grades', pr.gradeId) : null;
        quiz[q.id] = { attempts: atts.length, score: best, maxScore: max, percent: best != null && max ? Math.round((best / max) * 1000) / 10 : null, gradeId: gradeRow && !gradeRow.deleted ? gradeRow.id : null, gradeValue: gradeRow && !gradeRow.deleted ? gradeRow.value : null };
      }
      for (const a of assignments) {
        const sub = a.homeworkId ? db.one('homeworkSubmissions', (x) => x.homeworkId === a.homeworkId && x.studentId === sid) : null;
        assignment[a.id] = { submitted: !!sub, receivedAt: sub ? sub.receivedAt : null, reviewedAt: sub ? sub.reviewedAt || null : null, gradeId: sub ? sub.gradeId || null : null, late: sub ? !!sub.late : false };
      }
      return { studentId: sid, name: D.studentLabel(s), classId: s ? s.classId : null, progress: p, quiz, assignment, complete: p.complete };
    }).sort((a, b) => a.name.localeCompare(b.name, 'pl'));
    const avg = students.length ? Math.round((students.reduce((s, x) => s + x.progress.percent, 0) / students.length) * 10) / 10 : 0;
    return {
      course: courseCard(db, c), today: D.today(db),
      items: items.map((i) => ({ id: i.id, unitId: i.unitId, title: i.title, kind: i.kind, required: i.required !== false, maxScore: i.kind === 'quiz' ? maxScoreOf(i.quiz) : null })),
      quizzes: quizzes.map((q) => ({ id: q.id, title: q.title, maxScore: maxScoreOf(q.quiz) })),
      assignments: assignments.map((a) => ({ id: a.id, title: a.title, homeworkId: a.homeworkId })),
      students, averagePercent: avg, completedCount: students.filter((s) => s.complete).length
    };
  }, { roles: ['staff'] });

  /* ---- dyskusja kursu -------------------------------------------------------------- */
  function discussionAccess(ctx) {
    const db = ctx.db, user = ctx.user; const c = getCourse(db, ctx.params.id);
    if (user.role === 'student') {
      if (c.status !== 'published') throw httpError(404, 'Kurs nie został jeszcze opublikowany.', { code: 'course_not_published' });
      if (!enrollmentOf(db, c.id, user.studentId)) throw httpError(403, 'Nie jesteś zapisany na ten kurs.', { code: 'not_enrolled' });
      return { course: c, canModerate: false };
    }
    if (user.role === 'parent') throw httpError(403, 'Rodzic ma wgląd wyłącznie w postępy dziecka.', { code: 'read_only' });
    if (!isCourseTeacher(user, c) && user.role !== 'principal') throw httpError(403, 'Brak dostępu do dyskusji tego kursu.', { code: 'forbidden' });
    return { course: c, canModerate: isCourseTeacher(user, c) };
  }

  r.get('/api/courses/:id/discussion', (ctx) => {
    const { course, canModerate } = discussionAccess(ctx);
    return { courseId: course.id, canModerate, threads: threadsOf(ctx.db, course.id, { canModerate }) };
  }, { roles: ['staff', 'student'] });

  r.post('/api/courses/:id/threads', (ctx) => {
    const db = ctx.db, b = ctx.body || {}; const { course, canModerate } = discussionAccess(ctx);
    const title = str(b.title, 200);
    if (!title) throw httpError(400, 'Podaj temat wątku.', { code: 'empty_title' });
    const row = db.insert('courseThreads', { id: U.id('cot'), courseId: course.id, title, byUserId: ctx.user.id, at: U.now(), pinned: canModerate ? !!b.pinned : false, locked: false });
    ctx.audit({ action: 'course_thread_create', entity: 'courseThread', entityId: row.id, before: null, after: { courseId: course.id, title }, reason: null });
    const body = str(b.body, 5000);
    if (body) db.insert('coursePosts', { id: U.id('cps'), threadId: row.id, courseId: course.id, parentId: null, body, byUserId: ctx.user.id, at: U.now() });
    return { ok: true, thread: threadsOf(db, course.id, { canModerate }).find((t) => t.id === row.id) };
  }, { roles: ['staff', 'student'] });

  r.post('/api/courses/:id/threads/:threadId/posts', (ctx) => {
    const db = ctx.db, b = ctx.body || {}; const { course, canModerate } = discussionAccess(ctx);
    const th = db.get('courseThreads', ctx.params.threadId);
    if (!th || th.courseId !== course.id) throw httpError(404, 'Nie ma takiego wątku.', { code: 'no_thread' });
    if (th.locked && !canModerate) throw httpError(403, 'Wątek został zamknięty przez nauczyciela — nie można dopisywać odpowiedzi.', { code: 'thread_locked' });
    const body = str(b.body, 5000);
    if (!body) throw httpError(400, 'Wpis nie może być pusty.', { code: 'empty_post' });
    const parentId = b.parentId && db.get('coursePosts', b.parentId) ? b.parentId : null;
    const row = db.insert('coursePosts', { id: U.id('cps'), threadId: th.id, courseId: course.id, parentId, body, byUserId: ctx.user.id, at: U.now() });
    ctx.audit({ action: 'course_post_create', entity: 'coursePost', entityId: row.id, before: null, after: { courseId: course.id, threadId: th.id, parentId }, reason: null });
    return { ok: true, post: { id: row.id, threadId: th.id, parentId, body, at: row.at, byUserId: ctx.user.id, author: D.userLabel(ctx.user) } };
  }, { roles: ['staff', 'student'] });

  r.patch('/api/courses/:id/threads/:threadId', (ctx) => {
    const db = ctx.db, b = ctx.body || {}; const { course, canModerate } = discussionAccess(ctx);
    if (!canModerate) throw httpError(403, 'Wątek przypina i zamyka nauczyciel prowadzący kurs.', { code: 'not_course_teacher' });
    const th = db.get('courseThreads', ctx.params.threadId);
    if (!th || th.courseId !== course.id) throw httpError(404, 'Nie ma takiego wątku.', { code: 'no_thread' });
    const before = { pinned: !!th.pinned, locked: !!th.locked };
    if (b.pinned !== undefined) th.pinned = !!b.pinned;
    if (b.locked !== undefined) th.locked = !!b.locked;
    db.save();
    ctx.audit({ action: 'course_thread_moderate', entity: 'courseThread', entityId: th.id, before, after: { pinned: th.pinned, locked: th.locked }, reason: str(b.reason, 300) || null });
    return { ok: true, thread: threadsOf(db, course.id, { canModerate: true }).find((t) => t.id === th.id) };
  }, { roles: ['staff'] });

  /* ---- zaświadczenie o ukończeniu (wydruk do PDF w przeglądarce) -------------------- */
  r.get('/api/courses/:id/certificate', (ctx) => {
    const db = ctx.db, user = ctx.user; const c = getCourse(db, ctx.params.id);
    let sid;
    if (user.role === 'student') sid = user.studentId;
    else if (user.role === 'parent') sid = subjectStudentId(ctx, ctx.query.studentId);
    else { sid = ctx.query.studentId; if (!isCourseTeacher(user, c) && user.role !== 'principal') throw httpError(403, 'Brak dostępu do tego kursu.', { code: 'forbidden' }); }
    const student = db.get('students', sid);
    if (!student) throw httpError(404, 'Nie znaleziono ucznia.', { code: 'no_student' });
    if (!enrollmentOf(db, c.id, sid)) throw httpError(403, 'Uczeń nie jest zapisany na ten kurs.', { code: 'not_enrolled' });
    const p = progressOf(db, c.id, sid);
    if (!p.complete) throw httpError(409, `Kurs nie został jeszcze ukończony (${p.done} z ${p.total} elementów obowiązkowych).`, { code: 'not_complete', progress: p });
    ctx.audit({ action: 'course_certificate', entity: 'course', entityId: c.id, before: null, after: { studentId: sid, percent: p.percent }, reason: null });
    return { __raw: true, contentType: 'text/html; charset=utf-8', inline: true, body: certificateHtml(db, c, student) };
  }, { roles: ['staff', 'student', 'parent'] });

  /* ---- postęp dziecka dla rodzica (tylko odczyt) ----------------------------------- */
  r.get('/api/courses/child/progress', (ctx) => {
    const db = ctx.db; const sid = subjectStudentId(ctx, ctx.query.studentId);
    if (!sid) throw httpError(403, 'Brak przypisanego dziecka.', { code: 'forbidden' });
    const rows = db.col('courses').filter((c) => c.status === 'published' && enrollmentOf(db, c.id, sid));
    return {
      readOnly: true, studentId: sid, student: D.studentLabel(db.get('students', sid)),
      courses: rows.map((c) => {
        const p = progressOf(db, c.id, sid);
        return Object.assign(courseCard(db, c, { studentId: sid }), {
          quiz: itemsOf(db, c.id).filter((i) => i.kind === 'quiz').map((i) => {
            const atts = db.col('quizAttempts').filter((a) => a.itemId === i.id && a.studentId === sid);
            return { itemId: i.id, title: i.title, attempts: atts.length, score: atts.length ? Math.max.apply(null, atts.map((a) => a.score)) : null, maxScore: maxScoreOf(i.quiz) };
          }),
          progress: p
        });
      })
    };
  }, { roles: ['parent', 'staff'] });
}

module.exports = { register, gradeQuiz, progressOf, autoStudentIds, unitLocked, certificateHtml, maxScoreOf, KINDS, STATUSES };
