'use strict';
/* Widok ucznia (3.6): pulpit na dziś, moje oceny, zadania domowe, frekwencja, zmiany w planie,
   kalendarz sprawdzianów, symulacja celu, materiały z lekcji, biblioteka, prawa ucznia pełnoletniego.
   Uczeń widzi wyłącznie własne dane — każdy odczyt jest ograniczony do user.studentId. */
const { httpError } = require('../lib/router');
const D = require('../lib/domain');
const util = require('../lib/util');
const N = require('./notifications');
const HW = require('./homework');

const MB = 1024 * 1024;
const WEEKDAYS = ['poniedziałek', 'wtorek', 'środa', 'czwartek', 'piątek', 'sobota', 'niedziela'];
const MONTHS = ['stycznia', 'lutego', 'marca', 'kwietnia', 'maja', 'czerwca', 'lipca', 'sierpnia', 'września', 'października', 'listopada', 'grudnia'];
const MONTH_NOM = ['Styczeń', 'Luty', 'Marzec', 'Kwiecień', 'Maj', 'Czerwiec', 'Lipiec', 'Sierpień', 'Wrzesień', 'Październik', 'Listopad', 'Grudzień'];

function meStudent(ctx) {
  const s = ctx.user.studentId ? ctx.db.get('students', ctx.user.studentId) : null;
  if (!s) throw httpError(403, 'To konto nie jest powiązane z uczniem.', { code: 'no_student' });
  return s;
}
/** 403 dla każdego cudzego identyfikatora ucznia (3.6.2). */
function assertOwn(ctx, studentId) {
  if (studentId && studentId !== ctx.user.studentId) throw httpError(403, 'Widzisz wyłącznie własne dane. Oceny innych uczniów nie są dostępne w widoku ucznia.', { code: 'forbidden' });
  return ctx.user.studentId;
}
const groupsOf = (db, studentId) => db.col('groups').filter((g) => (g.studentIds || []).includes(studentId)).map((g) => g.id);
function lessonsForStudent(db, studentId, date) {
  const s = db.get('students', studentId); const gs = groupsOf(db, studentId);
  return db.col('lessons').filter((l) => l.classId === s.classId && l.date === date && (!l.groupId || gs.includes(l.groupId))).sort((a, b) => a.lessonNo - b.lessonNo);
}
function attendanceOf(db, studentId, lessonId) {
  const rows = db.col('attendance').filter((a) => a.lessonId === lessonId && a.studentId === studentId && !a.draft);
  return rows.length ? rows[rows.length - 1] : null;
}
const subjectName = (db, id) => (db.get('subjects', id) || { name: id }).name;
function teacherRef(db, id) { const u = db.get('users', id); return u ? { id: u.id, name: D.userLabel(u) } : null; }
function lessonState(db, l, nowHm, isToday) {
  if (l.status === 'cancelled' || l.status === 'cancel') return 'cancel';
  if (l.substituteTeacherId) return 'sub';
  if (l.roomChangedFrom && l.roomChangedFrom !== l.room) return 'room';
  if (isToday) { const t = D.lessonTime(db, l.lessonNo); if (t.start && nowHm >= t.start && nowHm <= t.end) return 'now'; }
  return 'normal';
}
function lessonView(db, l, studentId, nowHm, isToday) {
  const t = D.lessonTime(db, l.lessonNo); const a = attendanceOf(db, studentId, l.id);
  return {
    id: l.id, date: l.date, lessonNo: l.lessonNo, start: t.start, end: t.end,
    subjectId: l.subjectId, subject: subjectName(db, l.subjectId), room: l.room, roomChangedFrom: l.roomChangedFrom || null,
    group: l.groupId ? (db.get('groups', l.groupId) || { name: l.groupId }).name : null,
    teacher: teacherRef(db, l.substituteTeacherId || l.teacherId), plannedTeacher: teacherRef(db, l.teacherId),
    substitute: l.substituteTeacherId ? teacherRef(db, l.substituteTeacherId) : null,
    status: l.status, state: lessonState(db, l, nowHm, isToday), note: l.changeReason || l.note || null, topic: l.topic || null,
    changedAt: l.changedAt || null,
    attendance: a ? { status: a.status, minutes: a.minutes || 0, at: a.at, byUserId: a.byUserId } : { status: 'none', minutes: 0 }
  };
}
/** Zapowiedziane sprawdziany dla klasy/grup ucznia z oceną zachowania terminu zapowiedzi. */
function testsFor(db, studentId, from, to) {
  const s = db.get('students', studentId); const gs = groupsOf(db, studentId); const cfg = db.data.config;
  const notice = cfg.testNoticeDays || 7;
  return db.col('tests').filter((t) => t.classId === s.classId && (!t.groupId || gs.includes(t.groupId)) && (!from || t.date >= from) && (!to || t.date <= to))
    .map((t) => {
      const announced = (t.announcedAt || t.createdAt || '').slice(0, 10) || null;
      const noticeDays = announced ? util.daysBetween(announced, t.date) : null;
      return {
        id: t.id, date: t.date, kind: t.kind || 'sprawdzian', subjectId: t.subjectId, subject: subjectName(db, t.subjectId),
        teacher: teacherRef(db, t.teacherId), scope: t.scope || '', announcedAt: t.announcedAt || t.createdAt || null, noticeDays,
        noticeRule: notice, compliant: noticeDays == null ? null : noticeDays >= notice,
        noticeNote: noticeDays == null ? 'Brak daty zapowiedzi w dzienniku.' : noticeDays >= notice
          ? `Zapowiedziano ${noticeDays} ${util.plural(noticeDays, 'dzień', 'dni', 'dni')} wcześniej — zgodnie z zasadą ${notice} dni.`
          : `Zapowiedziano tylko ${noticeDays} ${util.plural(noticeDays, 'dzień', 'dni', 'dni')} wcześniej — mniej niż ${notice} dni wymagane przez statut. Możesz poprosić wychowawcę o przeniesienie.`
      };
    }).sort((a, b) => (a.date < b.date ? -1 : 1));
}
function homeworkFor(db, studentId, from, to) {
  /* Termin zadania to czas ścienny szkoły (P24): dzień i godzina biorą się z `dueLocal`,
     a nie z instantu — inaczej „do 23:59” w kwietniu pokazywałoby uczniowi 1:59 następnego dnia. */
  const s = db.get('students', studentId); const gs = groupsOf(db, studentId);
  return db.col('homework').filter((h) => h.classId === s.classId && (!h.groupId || gs.includes(h.groupId)))
    .map((h) => Object.assign({ row: h }, HW.dueOf(db, h)))
    .filter((h) => (!from || h.dueLocal.slice(0, 10) >= from) && (!to || h.dueLocal.slice(0, 10) <= to))
    .map(({ row: h, dueAt, dueLocal }) => {
      const sub = db.one('homeworkSubmissions', (x) => x.homeworkId === h.id && x.studentId === studentId);
      return {
        id: h.id, subjectId: h.subjectId, subject: subjectName(db, h.subjectId), teacher: teacherRef(db, h.teacherId), text: h.text,
        dueAt, dueLocal, dueDate: dueLocal.slice(0, 10), dueTime: dueLocal.slice(11, 16), maxAttachmentMB: h.maxAttachmentMB || db.data.config.homeworkMaxAttachmentMB || 10,
        submitted: !!sub, submission: sub ? { id: sub.id, receivedAt: sub.receivedAt, files: (sub.files || []).map((f) => ({ name: f.name, size: f.size, type: f.type })), text: sub.text, reviewedAt: sub.reviewedAt || null } : null,
        submitPath: '/api/homework/' + h.id + '/submissions'
      };
    }).sort((a, b) => (Date.parse(a.dueAt) < Date.parse(b.dueAt) ? -1 : 1));
}
function materialsFor(db, studentId) {
  const s = db.get('students', studentId); const gs = groupsOf(db, studentId);
  return db.col('materials').filter((m) => {
    const l = m.lessonId ? db.get('lessons', m.lessonId) : null;
    const classId = m.classId || (l && l.classId);
    if (classId !== s.classId) return false;
    if (l && l.groupId && !gs.includes(l.groupId)) return false;
    return true;
  }).map((m) => {
    const l = m.lessonId ? db.get('lessons', m.lessonId) : null;
    return {
      id: m.id, name: m.name, type: m.type, size: m.size || (m.dataUrl || '').length, subjectId: m.subjectId || (l && l.subjectId) || null,
      subject: subjectName(db, m.subjectId || (l && l.subjectId)), at: m.at || m.createdAt,
      lesson: l ? { id: l.id, date: l.date, lessonNo: l.lessonNo, label: util.fmtDate(l.date) + ' · ' + l.lessonNo + '. lekcja' } : null,
      teacher: teacherRef(db, m.byUserId), downloadPath: '/api/materials/' + m.id
    };
  }).sort((a, b) => (a.at < b.at ? 1 : -1));
}
function loansFor(db, studentId) {
  return db.col('libraryLoans').filter((l) => l.studentId === studentId && !l.returnedAt).map((l) => ({
    id: l.id, title: l.title || l.bookTitle || l.name || 'Wypożyczenie', author: l.author || '', dueDate: l.dueDate || l.dueAt || l.due || null,
    loanedAt: l.loanedAt || l.at || null, barcode: l.barcode || null
  }));
}
/** Powiadomienia o terminie zwrotu przed końcem semestru (3.6.13) — idempotentne. */
function libraryNotices(db, studentId, userId) {
  const cfg = db.data.config; const today = D.today(db);
  const sem = D.semester(db, D.semesterOf(db, today)) || { to: today };
  const window = cfg.libraryNoticeDaysBeforeSemesterEnd || 60;
  const out = [];
  for (const l of loansFor(db, studentId)) {
    if (!l.dueDate) continue;
    const days = util.daysBetween(today, l.dueDate);
    const beforeSemesterEnd = l.dueDate <= sem.to;
    if (!beforeSemesterEnd || days > window) continue;
    const text = days < 0
      ? `Termin zwrotu książki „${l.title}” minął ${util.fmtDate(l.dueDate)}. Rozlicz się z biblioteką przed końcem semestru.`
      : `Termin zwrotu książki „${l.title}” mija ${util.fmtDate(l.dueDate)}, przed końcem semestru (${util.fmtDate(sem.to)}). Zostało ${days} ${util.plural(days, 'dzień', 'dni', 'dni')}.`;
    const n = N.createNotification(db, userId, 'library', text, { link: '/uczen', dedupeKey: 'loan:' + l.id });
    out.push(Object.assign({}, l, { daysLeft: days, overdue: days < 0, text, notified: !!n }));
  }
  return out;
}
/** Zmiany w planie (odwołania, zmiany sal, zastępstwa) + powiadomienia dla całej klasy (3.6.5). */
function lessonChanges(db, classId, since) {
  const today = D.today(db);
  const students = (db.get('classes', classId) || { studentIds: [] }).studentIds;
  const userOf = {}; for (const u of db.col('users')) if (u.role === 'student' && u.studentId) userOf[u.studentId] = u.id;
  const changed = db.col('lessons').filter((l) => l.classId === classId && l.changedAt && l.date >= today && (!since || l.changedAt >= since))
    .sort((a, b) => (a.changedAt < b.changedAt ? 1 : -1));
  const out = [];
  for (const l of changed) {
    const t = D.lessonTime(db, l.lessonNo); const subj = subjectName(db, l.subjectId);
    const kind = (l.status === 'cancelled' || l.status === 'cancel') ? 'cancel' : l.substituteTeacherId ? 'sub' : (l.roomChangedFrom && l.roomChangedFrom !== l.room) ? 'room' : 'other';
    const when = `${util.fmtDate(l.date)}, ${l.lessonNo}. lekcja (${t.start}–${t.end})`;
    const text = kind === 'cancel' ? `Odwołana lekcja: ${subj}, ${when}.${l.changeReason ? ' ' + l.changeReason : ''}`
      : kind === 'room' ? `Zmiana sali: ${subj}, ${when} — sala ${l.room} zamiast ${l.roomChangedFrom}.${l.changeReason ? ' ' + l.changeReason : ''}`
        : kind === 'sub' ? `Zastępstwo: ${subj}, ${when} — uczy ${(teacherRef(db, l.substituteTeacherId) || {}).name || 'nauczyciel zastępujący'}.`
          : `Zmiana w planie: ${subj}, ${when}.`;
    let created = 0;
    for (const sid of students) {
      const uid = userOf[sid]; if (!uid) continue;
      if (N.createNotification(db, uid, 'timetable', text, { link: '/uczen', dedupeKey: 'lesson:' + l.id + ':' + l.changedAt })) created++;
    }
    out.push({ lessonId: l.id, date: l.date, lessonNo: l.lessonNo, subjectId: l.subjectId, subject: subj, kind, room: l.room, previousRoom: l.roomChangedFrom || null, changedAt: l.changedAt, reason: l.changeReason || null, text, notified: created });
  }
  return out;
}
/** Symulacja celu: ile jeszcze trzeba dostać, żeby wyjść na ocenę docelową (3.6.7). */
function simulate(db, studentId, subjectId, target, plannedCount, plannedWeight, sem) {
  const cfg = db.data.config; const opts = { retakeRule: cfg.retakeRule, plusMinus: cfg.plusMinus };
  const thresholds = cfg.termGradeThresholds || { 3: 2.51, 4: 3.51, 5: 4.51, 6: 5.51 };
  const g = D.studentGrades(db, studentId, subjectId, sem);
  const base = g.partial.map((x) => Object.assign({}, x, { countsInAverage: x.countsInAverage !== false }));
  const current = util.average(base, opts);
  const threshold = thresholds[target];
  if (threshold == null) throw httpError(400, 'Cel musi być oceną od 2 do 6.', { code: 'bad_target' });
  const hyp = (value, count) => {
    const extra = []; for (let i = 0; i < count; i++) extra.push({ id: 'sim_' + i, value: String(value), weight: plannedWeight, countsInAverage: true, deleted: false });
    return util.average(base.concat(extra), opts).average;
  };
  const options = [];
  for (let v = 1; v <= 6; v++) { const a = hyp(v, plannedCount); options.push({ grade: v, average: a, reaches: a != null && a >= threshold }); }
  const needed = options.find((o) => o.reaches) || null;
  let minCount = null;
  if (!needed) { for (let k = plannedCount + 1; k <= plannedCount + 30; k++) { const a = hyp(6, k); if (a != null && a >= threshold) { minCount = k; break; } } }
  return {
    subjectId, subject: subjectName(db, subjectId), semester: sem, target, threshold, thresholds,
    current: { average: current.average, count: current.count, text: util.fmtAvg(current.average) },
    planned: { count: plannedCount, weight: plannedWeight },
    reachable: !!needed, needed: needed ? needed.grade : null, options,
    advice: needed
      ? `Aktualna średnia ${util.fmtAvg(current.average)}. Aby mieć ${target} na koniec semestru, potrzebujesz oceny ${needed.grade} z ${plannedCount} ${util.plural(plannedCount, 'zapowiedzianego sprawdzianu', 'zapowiedzianych sprawdzianów', 'zapowiedzianych sprawdzianów')} (waga ${plannedWeight}) — wtedy średnia wyniesie ${util.fmtAvg(needed.average)}, a próg to ${util.fmtAvg(threshold)}.`
      : `Aktualna średnia ${util.fmtAvg(current.average)}. Celu ${target} nie da się osiągnąć ${plannedCount} ${util.plural(plannedCount, 'oceną', 'ocenami', 'ocenami')} o wadze ${plannedWeight}; potrzeba co najmniej ${minCount || 'więcej'} ocen 6. Porozmawiaj z nauczycielem o poprawach.`,
    minimumSixes: minCount
  };
}

function register(r, app) {
  /* ---- 3.6.1 pulpit ---------------------------------------------------------------------- */
  r.get('/api/student/dashboard', (ctx) => {
    /* P31 — jedno źródło pory dnia: D.schoolNow(db) w strefie szkoły, nigdy zegar procesu. */
    const db = ctx.db; const s = meStudent(ctx); const sn = D.schoolNow(db); const today = sn.date;
    const tomorrow = util.addDays(today, 1);
    const nowHm = sn.time;
    const lessons = lessonsForStudent(db, s.id, today).map((l) => lessonView(db, l, s.id, nowHm, true));
    const changes = lessonChanges(db, s.classId, null);
    const cls = db.get('classes', s.classId);
    const unread = db.col('messages').filter((m) => (m.toUserIds || []).includes(ctx.user.id) && !(m.readBy || {})[ctx.user.id]).length;
    return {
      today, todayLabel: `${WEEKDAYS[util.weekday(today) - 1]}, ${util.fmtDate(today)}`, semester: D.semesterOf(db, today),
      student: { id: s.id, firstName: s.firstName, lastName: s.lastName, classId: s.classId, className: cls ? cls.name : s.classId, adult: !!s.adult, adultSelfExcuse: !!s.adultSelfExcuse, parentAccessBlocked: !!s.parentAccessBlocked },
      school: { name: db.data.config.school.name, short: db.data.config.school.short },
      homeroom: teacherRef(db, cls && (cls.actingHomeroomTeacherId || cls.homeroomTeacherId)),
      lessons, changes,
      attendanceSummary: util.attendanceStats(lessons.filter((l) => l.attendance.status !== 'none').map((l) => ({ status: l.attendance.status, minutes: l.attendance.minutes }))),
      upcomingTests: testsFor(db, s.id, today, util.addDays(today, 30)),
      homeworkTomorrow: homeworkFor(db, s.id, tomorrow, tomorrow),
      homeworkUpcoming: homeworkFor(db, s.id, today, util.addDays(today, 7)),
      library: libraryNotices(db, s.id, ctx.user.id),
      unreadMessages: unread,
      notifications: db.col('notifications').filter((n) => n.userId === ctx.user.id && !n.read).sort((a, b) => (a.at < b.at ? 1 : -1)).slice(0, 5).map((n) => ({ id: n.id, kind: n.kind, text: n.text, at: n.at, crisis: !!n.crisis, deferred: !!n.deferred })),
      entitlements: { free: true, paywall: false }
    };
  }, { roles: ['student'] });

  /* ---- 3.6.2 moje oceny ------------------------------------------------------------------ */
  r.get('/api/student/grades', (ctx) => {
    const db = ctx.db; const s = meStudent(ctx);
    assertOwn(ctx, ctx.query.studentId);
    const sem = +ctx.query.semester || D.semesterOf(db, D.today(db));
    const cfg = db.data.config;
    const subjectIds = [...new Set(db.col('grades').filter((g) => g.studentId === s.id && g.semester === sem && !g.deleted).map((g) => g.subjectId))];
    const order = db.data.subjects.map((x) => x.id);
    subjectIds.sort((a, b) => order.indexOf(a) - order.indexOf(b));
    const subjects = subjectIds.map((sid) => {
      const gs = D.studentGrades(db, s.id, sid, sem);
      const teacherIds = [...new Set(db.col('timetable').filter((t) => t.classId === s.classId && t.subjectId === sid).map((t) => t.teacherId))];
      return {
        subjectId: sid, subject: subjectName(db, sid), teachers: teacherIds.map((id) => teacherRef(db, id)).filter(Boolean),
        average: gs.average, averageText: util.fmtAvg(gs.average), count: gs.count,
        proposed: gs.proposed ? gs.proposed.value : null, final: gs.final ? gs.final.value : null,
        grades: gs.partial.map((g) => ({
          id: g.id, value: g.value, weight: g.weight, categoryId: g.categoryId, categoryName: g.categoryName, color: g.color,
          category: +String(g.color || '').replace('cat-', '') || undefined, date: g.date, comment: g.comment || '',
          countsInAverage: g.countsInAverage !== false, points: g.points, maxPoints: g.maxPoints, percent: g.percent,
          teacher: teacherRef(db, g.teacherId), retakeOfId: g.retakeOfId || null
        })).sort((a, b) => (a.date < b.date ? -1 : 1))
      };
    });
    const all = subjects.flatMap((x) => x.grades.filter((g) => g.countsInAverage).map((g) => ({ id: g.id, value: g.value, weight: g.weight, countsInAverage: true, deleted: false })));
    const overall = util.average(all, { retakeRule: cfg.retakeRule, plusMinus: cfg.plusMinus });
    return {
      studentId: s.id, student: { firstName: s.firstName, lastName: s.lastName, classId: s.classId }, semester: sem,
      subjects, overallAverage: overall.average, overallAverageText: util.fmtAvg(overall.average),
      categories: db.data.gradeCategories.map((c) => ({ id: c.id, name: c.name, weight: c.weight, color: c.color, countsInAverage: c.countsInAverage })),
      rules: { plusMinus: cfg.plusMinus, retakeRule: cfg.retakeRule, thresholds: cfg.termGradeThresholds },
      note: 'Widzisz tylko swoje oceny. Widok ucznia nie zawiera ocen innych osób ani średniej klasy.'
    };
  }, { roles: ['student'] });

  /* wydruk wykazu ocen (drukowany do PDF w przeglądarce) */
  r.get('/api/student/grades/print', (ctx) => {
    const db = ctx.db; const s = meStudent(ctx); const sem = +ctx.query.semester || D.semesterOf(db, D.today(db));
    const rows = db.col('grades').filter((g) => g.studentId === s.id && g.semester === sem && !g.deleted && g.kind === 'partial').sort((a, b) => (a.date < b.date ? -1 : 1));
    const body = `<h1>Wykaz ocen cząstkowych</h1><p>${D.xmlEsc(s.lastName + ' ' + s.firstName)} · klasa ${D.xmlEsc(s.classId)} · semestr ${sem}</p>`
      + `<table><caption>Oceny cząstkowe — semestr ${sem}</caption><thead><tr><th scope="col">Data</th><th scope="col">Przedmiot</th><th scope="col">Kategoria</th><th scope="col">Waga</th><th scope="col">Ocena</th></tr></thead><tbody>`
      + rows.map((g) => `<tr><th scope="row">${util.fmtDate(g.date)}</th><td>${D.xmlEsc(subjectName(db, g.subjectId))}</td><td>${D.xmlEsc(g.categoryName || '')}</td><td>${g.weight}</td><td>${D.xmlEsc(g.value)}</td></tr>`).join('')
      + '</tbody></table>';
    const html = D.printHtml('Wykaz ocen', body, { school: db.data.config.school.name, schoolMeta: db.data.config.school.address, date: util.fmtDate(D.today(db)), printed: util.fmtDate(D.today(db)) });
    // wypisujemy odpowiedź wprost: dokument do wydruku otwieramy w nowej karcie, a nie pobieramy jako plik
    ctx.res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' }); ctx.res.end(html); return undefined;
  }, { roles: ['student'] });

  /* ---- 3.6.3 zadania domowe -------------------------------------------------------------- */
  r.get('/api/student/homework', (ctx) => {
    const db = ctx.db; const s = meStudent(ctx); const today = D.today(db);
    return {
      today, tomorrow: util.addDays(today, 1),
      dueTomorrow: homeworkFor(db, s.id, util.addDays(today, 1), util.addDays(today, 1)),
      upcoming: homeworkFor(db, s.id, today, util.addDays(today, 14)),
      past: homeworkFor(db, s.id, util.addDays(today, -21), util.addDays(today, -1)),
      maxAttachmentMB: db.data.config.homeworkMaxAttachmentMB || 10
    };
  }, { roles: ['student'] });

  /* Rezerwowa obsługa oddawania prac — rejestrujemy ją tylko wtedy, gdy sekcja 3.1 jeszcze jej nie ma. */
  const SUB_PATTERN = '/api/homework/:id/submissions';
  if (!app.router.routes.some((x) => x.pattern === SUB_PATTERN && x.method === 'POST')) {
    const fallback = (ctx) => {
      const other = app.router.routes.find((x) => x.pattern === SUB_PATTERN && x.method === 'POST' && x.handler !== fallback);
      if (other) return other.handler(ctx);                                  // sekcja 3.1 dołożyła swoją trasę później
      const db = ctx.db; const s = meStudent(ctx); const hw = db.get('homework', ctx.params.id);
      if (!hw) throw httpError(404, 'Nie ma takiego zadania domowego.');
      const b = ctx.body || {}; const text = String(b.text || '').trim();
      const limit = (hw.maxAttachmentMB || db.data.config.homeworkMaxAttachmentMB || 10) * MB;
      const files = (Array.isArray(b.files) ? b.files : []).map((f) => {
        const size = +f.size || Math.round(((String(f.dataUrl || '').split(',')[1] || '').length) * 0.75);
        if (size > limit) throw httpError(413, `Plik „${f.name}” przekracza limit ${hw.maxAttachmentMB || 10} MB.`, { code: 'attachment_too_large' });
        return { name: String(f.name || 'plik'), size, type: String(f.type || 'application/octet-stream'), dataUrl: String(f.dataUrl || '') };
      });
      if (!text && !files.length) throw httpError(400, 'Dołącz plik albo wpisz treść pracy.', { code: 'empty_submission' });
      const receivedAt = util.now();
      const existing = db.one('homeworkSubmissions', (x) => x.homeworkId === hw.id && x.studentId === s.id);
      const row = existing ? Object.assign(existing, { text, files, receivedAt, reviewedAt: null }) : db.insert('homeworkSubmissions', { id: util.id('sub'), homeworkId: hw.id, studentId: s.id, text, files, receivedAt, gradeId: null, reviewedAt: null });
      db.save();
      ctx.audit({ action: existing ? 'homework_resubmit' : 'homework_submit', entity: 'homeworkSubmission', entityId: row.id, after: { homeworkId: hw.id, studentId: s.id, receivedAt } });
      N.createNotification(db, hw.teacherId, 'homework', `Praca oddana: ${D.studentLabel(s)} — ${hw.text.slice(0, 60)}`, { link: '/zadania' });
      return { ok: true, submission: { id: row.id, receivedAt, files: files.map((f) => ({ name: f.name, size: f.size })) }, receivedAt, receipt: `Praca przyjęta ${util.fmtDate(receivedAt)} ${receivedAt.slice(11, 16)} (czas serwera).` };
    };
    r.post(SUB_PATTERN, fallback, { roles: ['student'] });
  }

  /* ---- 3.6.4 frekwencja na dziś ----------------------------------------------------------- */
  r.get('/api/student/attendance/today', (ctx) => {
    const db = ctx.db; const s = meStudent(ctx); const sn = D.schoolNow(db); const date = ctx.query.date || sn.date;
    const nowHm = sn.time;
    const lessons = lessonsForStudent(db, s.id, date).map((l) => lessonView(db, l, s.id, nowHm, date === sn.date));
    const entries = lessons.filter((l) => l.attendance.status !== 'none').map((l) => ({ status: l.attendance.status, minutes: l.attendance.minutes }));
    return {
      date, lessons: lessons.map((l) => ({ lessonNo: l.lessonNo, start: l.start, end: l.end, subject: l.subject, subjectId: l.subjectId, room: l.room, teacher: l.teacher, state: l.state, status: l.attendance.status, minutes: l.attendance.minutes, recordedAt: l.attendance.at || null, recordedBy: l.attendance.byUserId ? teacherRef(db, l.attendance.byUserId) : null })),
      stats: util.attendanceStats(entries),
      legend: { ob: 'obecny', nb: 'nieobecny', sp: 'spóźnienie', zw: 'zwolniony', u: 'usprawiedliwiony', rs: 'reprezentuje szkołę', w: 'wycieczka', none: 'brak wpisu' },
      note: 'Frekwencja pochodzi z wpisów nauczycieli. Jeśli wpis jest błędny, napisz do wychowawcy przez dziennik.'
    };
  }, { roles: ['student'] });

  /* ---- 3.6.5 zmiany w planie -------------------------------------------------------------- */
  r.get('/api/student/changes', (ctx) => {
    const db = ctx.db; const s = meStudent(ctx);
    const changes = lessonChanges(db, s.classId, ctx.query.since || null);
    return { classId: s.classId, since: ctx.query.since || null, changes, note: 'O odwołanych lekcjach i zmianach sal informujemy powiadomieniem, żeby nie czekać pod salą.' };
  }, { roles: ['student'] });

  /* ---- 3.6.6 kalendarz sprawdzianów ------------------------------------------------------- */
  r.get('/api/student/tests/calendar', (ctx) => {
    const db = ctx.db; const s = meStudent(ctx); const today = D.today(db);
    const month = /^\d{4}-\d{2}$/.test(ctx.query.month || '') ? ctx.query.month : today.slice(0, 7);
    const [y, m] = month.split('-').map(Number);
    const daysIn = new Date(Date.UTC(y, m, 0)).getUTCDate();
    const from = `${month}-01`, to = `${month}-${String(daysIn).padStart(2, '0')}`;
    const tests = testsFor(db, s.id, from, to);
    const hw = homeworkFor(db, s.id, from, to);
    const cfg = db.data.config; const perDay = (cfg.testLimits || {}).perDay || 1;
    /* Siatka miesiąca układa się po prawdziwych dniach tygodnia (poniedziałek pierwszy): dni dobiegające
       z sąsiednich miesięcy uzupełniają pierwszy i ostatni tydzień i są oznaczone jako wolne. */
    const cell = (date, inMonth) => {
      const d = +date.slice(8, 10);
      const label = `${d} ${MONTHS[+date.slice(5, 7) - 1]}`;
      if (!inMonth) return { d, date, label, inMonth: false, off: true, today: date === today, events: [], limit: false };
      const dayTests = tests.filter((t) => t.date === date);
      const dayHw = hw.filter((x) => x.dueDate === date);
      const events = dayTests.map((t) => ({ kind: t.kind === 'kartkówka' ? 'quiz' : 'test', text: (t.kind === 'kartkówka' ? 'Kartkówka: ' : 'Sprawdzian: ') + t.subject, testId: t.id, scope: t.scope, compliant: t.compliant, noticeDays: t.noticeDays }))
        .concat(dayHw.length ? [{ kind: 'hw', text: `Zadania na ten dzień: ${dayHw.length}` }] : []);
      const off = util.weekday(date) > 5 || (cfg.daysOff || []).some((x) => x.date === date) || (cfg.holidays || []).some((h) => date >= h.from && date <= h.to);
      return { d, date, label, inMonth: true, off, today: date === today, events, limit: dayTests.filter((t) => t.kind !== 'kartkówka').length > perDay };
    };
    const days = [];
    const leading = util.weekday(from) - 1;                       // 1 = poniedziałek
    for (let i = leading; i > 0; i--) days.push(cell(util.addDays(from, -i), false));
    for (let d = 1; d <= daysIn; d++) days.push(cell(`${month}-${String(d).padStart(2, '0')}`, true));
    const trailing = (7 - (days.length % 7)) % 7;
    for (let i = 1; i <= trailing; i++) days.push(cell(util.addDays(to, i), false));
    return {
      month, monthName: MONTHS[m - 1], monthLabel: `${MONTH_NOM[m - 1]} ${y}`, days, testLimit: perDay,
      weekStart: 1, leading, trailing, daysInMonth: daysIn, today,
      tests, noticeRule: cfg.testNoticeDays || 7,
      violations: tests.filter((t) => t.compliant === false),
      note: `Statut szkoły: sprawdzian zapowiadamy co najmniej ${cfg.testNoticeDays || 7} dni wcześniej, najwyżej ${perDay} dziennie i ${(cfg.testLimits || {}).perWeek || 3} w tygodniu.`
    };
  }, { roles: ['student'] });

  /* ---- 3.6.7 symulacja celu --------------------------------------------------------------- */
  r.get('/api/student/goal', (ctx) => {
    const db = ctx.db; const s = meStudent(ctx); const today = D.today(db);
    const sem = +ctx.query.semester || D.semesterOf(db, today);
    const subjectId = ctx.query.subjectId || (db.col('grades').find((g) => g.studentId === s.id && g.semester === sem && !g.deleted) || { subjectId: 'mat' }).subjectId;
    const upcoming = testsFor(db, s.id, today, util.addDays(today, 60)).filter((t) => t.subjectId === subjectId);
    const catSpr = db.data.gradeCategories.find((c) => c.name === 'sprawdzian') || { weight: 3 };
    const count = Math.max(1, +ctx.query.plannedCount || upcoming.length || 1);
    const weight = +ctx.query.plannedWeight || catSpr.weight;
    const out = simulate(db, s.id, subjectId, +ctx.query.target || 5, count, weight, sem);
    out.upcomingTests = upcoming;
    return out;
  }, { roles: ['student'] });
  r.post('/api/student/goal/simulate', (ctx) => {
    const db = ctx.db; const s = meStudent(ctx); const b = ctx.body || {};
    assertOwn(ctx, b.studentId);
    const today = D.today(db); const sem = +b.semester || D.semesterOf(db, today);
    const subjectId = b.subjectId || 'mat';
    const upcoming = testsFor(db, s.id, today, util.addDays(today, 60)).filter((t) => t.subjectId === subjectId);
    const catSpr = db.data.gradeCategories.find((c) => c.name === 'sprawdzian') || { weight: 3 };
    const count = Math.max(1, +b.plannedCount || upcoming.length || 1);
    const weight = +b.plannedWeight || catSpr.weight;
    const out = simulate(db, s.id, subjectId, +b.target || 5, count, weight, sem);
    out.upcomingTests = upcoming;
    return out;
  }, { roles: ['student'] });

  /* ---- 3.6.8 materiały z lekcji ------------------------------------------------------------ */
  r.get('/api/student/materials', (ctx) => {
    const db = ctx.db; const s = meStudent(ctx);
    let list = materialsFor(db, s.id);
    if (ctx.query.subjectId) list = list.filter((m) => m.subjectId === ctx.query.subjectId);
    return { materials: list, note: 'Materiały zostają w dzienniku do końca roku szkolnego.' };
  }, { roles: ['student'] });
  r.get('/api/materials/:id', (ctx) => {
    const db = ctx.db; const m = db.get('materials', ctx.params.id);
    if (!m) throw httpError(404, 'Nie ma takiego materiału.');
    if (ctx.user.role === 'student') { if (!materialsFor(db, ctx.user.studentId).some((x) => x.id === m.id)) throw httpError(403, 'Materiał udostępniono innej klasie.', { code: 'forbidden' }); }
    else if (ctx.user.role === 'parent') {
      const ok = (ctx.user.childrenIds || []).some((sid) => { const st = db.get('students', sid); return st && !st.parentAccessBlocked && materialsFor(db, sid).some((x) => x.id === m.id); });
      if (!ok) throw httpError(403, 'Materiał udostępniono innej klasie.', { code: 'forbidden' });
    }
    ctx.audit({ action: 'material_downloaded', entity: 'material', entityId: m.id, after: { name: m.name } });
    return { id: m.id, name: m.name, type: m.type, size: m.size || (m.dataUrl || '').length, dataUrl: m.dataUrl, lessonId: m.lessonId || null };
  }, { roles: ['staff', 'student', 'parent'] });
  r.post('/api/materials', (ctx) => {
    const db = ctx.db; const b = ctx.body || {};
    const l = b.lessonId ? db.get('lessons', b.lessonId) : null;
    if (!l) throw httpError(400, 'Wskaż lekcję, do której dołączasz materiał.', { code: 'no_lesson' });
    if (ctx.user.role === 'teacher' && l.teacherId !== ctx.user.id && l.substituteTeacherId !== ctx.user.id) throw httpError(403, 'Materiały dołącza nauczyciel prowadzący lekcję.', { code: 'forbidden' });
    const name = String(b.name || '').trim(); if (!name) throw httpError(400, 'Podaj nazwę materiału.', { code: 'no_name' });
    const dataUrl = String(b.dataUrl || ''); if (!dataUrl) throw httpError(400, 'Dołącz plik materiału.', { code: 'no_file' });
    const size = +b.size || Math.round(((dataUrl.split(',')[1] || '').length) * 0.75);
    if (size > 20 * MB) throw httpError(413, 'Materiał przekracza 20 MB.', { code: 'file_too_large' });
    /* Współpraca (routes/materials.js): `coopAllowed` domyślnie tak — formularz ma przełącznik, a autor może to
       zmienić później; `description` mówi współpracownikom, co to jest i czego brakuje. */
    const coopAllowed = b.coopAllowed !== false; const description = String(b.description || '').trim().slice(0, 1000);
    const m = db.insert('materials', { id: util.id('mat'), lessonId: l.id, classId: l.classId, subjectId: l.subjectId, name, type: String(b.type || 'application/octet-stream'), dataUrl, size, byUserId: ctx.user.id, at: util.now(), coopAllowed, description, coopClaims: [] });
    ctx.audit({ action: 'material_uploaded', entity: 'material', entityId: m.id, after: { lessonId: l.id, name, size, coopAllowed } });
    return { ok: true, material: { id: m.id, name: m.name, type: m.type, size: m.size, lessonId: m.lessonId, coopAllowed: m.coopAllowed, description: m.description } };
  }, { roles: ['teacher', 'principal', 'supportTeacher', 'librarian'] });

  /* ---- 3.6.10 bez opłat -------------------------------------------------------------------- */
  r.get('/api/student/entitlements', () => ({
    free: true, paywall: false, price: 0, currency: 'PLN', trial: false, subscription: null,
    features: ['plan lekcji', 'oceny i średnie', 'frekwencja', 'zadania domowe', 'materiały z lekcji', 'wiadomości', 'powiadomienia'],
    note: 'Dostęp do dziennika jest bezpłatny dla uczniów i rodziców — aplikacja nie zawiera mikropłatności ani wersji premium.'
  }), { roles: ['student', 'parent'] });

  /* ---- 3.6.11 samodzielne usprawiedliwienie ucznia pełnoletniego --------------------------- */
  r.get('/api/student/excuses', (ctx) => {
    const db = ctx.db; const s = meStudent(ctx);
    return {
      allowed: !!(db.data.config.adultSelfExcuseAllowed && s.adult), adult: !!s.adult, schoolAllows: !!db.data.config.adultSelfExcuseAllowed,
      excuses: db.col('excuses').filter((e) => e.studentId === s.id).sort((a, b) => (a.from < b.from ? 1 : -1)).map((e) => ({ id: e.id, from: e.from, to: e.to, lessonNos: e.lessonNos || null, reason: e.reason, status: e.status, at: e.at, self: e.byUserId === ctx.user.id, rejectReason: e.rejectReason || null })),
      rule: 'Statut szkoły §24 ust. 3: uczeń pełnoletni może usprawiedliwiać własne nieobecności.'
    };
  }, { roles: ['student'] });
  r.post('/api/student/excuses', (ctx) => {
    const db = ctx.db; const s = meStudent(ctx); const b = ctx.body || {};
    if (!db.data.config.adultSelfExcuseAllowed) throw httpError(403, 'Statut szkoły nie przewiduje samodzielnego usprawiedliwiania nieobecności.', { code: 'not_allowed_by_school' });
    if (!s.adult) throw httpError(403, 'Własne nieobecności usprawiedliwia uczeń pełnoletni. Za Ciebie robi to opiekun.', { code: 'not_adult' });
    const from = String(b.from || '').slice(0, 10); const to = String(b.to || from).slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to)) throw httpError(400, 'Podaj daty nieobecności (od–do).', { code: 'bad_dates' });
    if (to < from) throw httpError(400, 'Data „do” nie może być wcześniejsza niż „od”.', { code: 'bad_range' });
    const reason = String(b.reason || '').trim(); if (reason.length < 3) throw httpError(400, 'Podaj powód nieobecności.', { code: 'no_reason' });
    const e = db.insert('excuses', {
      id: util.id('exc'), studentId: s.id, from, to, lessonNos: Array.isArray(b.lessonNos) && b.lessonNos.length ? b.lessonNos.map(Number) : null,
      reason, attachment: b.attachment || null, byUserId: ctx.user.id, at: util.now(), planned: !!b.planned,
      status: 'pending', rejectReason: null, decidedBy: null, decidedAt: null, selfExcuse: true
    });
    const cls = db.get('classes', s.classId); const homeroom = cls && (cls.actingHomeroomTeacherId || cls.homeroomTeacherId);
    if (homeroom) N.createNotification(db, homeroom, 'excuse', `Usprawiedliwienie własne (uczeń pełnoletni): ${D.studentLabel(s)}, ${util.fmtDate(from)}–${util.fmtDate(to)}.`, { link: '/frekwencja' });
    if (!s.adultSelfExcuse) { s.adultSelfExcuse = true; db.save(); }
    ctx.audit({ action: 'excuse_self_submitted', entity: 'excuse', entityId: e.id, after: { studentId: s.id, from, to, reason }, reason: 'Uczeń pełnoletni — statut §24 ust. 3' });
    return { ok: true, excuse: { id: e.id, from: e.from, to: e.to, status: e.status, at: e.at }, receipt: `Usprawiedliwienie złożone ${util.fmtDate(e.at)} ${e.at.slice(11, 16)}. Decyzję podejmuje wychowawca.` };
  }, { roles: ['student'] });

  /* ---- 3.6.12 sprzeciw wobec dostępu opiekunów --------------------------------------------- */
  r.get('/api/student/parent-access', (ctx) => {
    const db = ctx.db; const s = meStudent(ctx);
    return {
      /* R3 — która reguła obowiązuje i od kiedy: `until-objection` albo `consent-required`
         (docs/GUARDIANS.md). Uczeń czyta tu to samo zdanie, co sekretariat i wychowawca. */
      adultAccess: D.adultAccessState(db, s),
      adult: !!s.adult, parentAccessBlocked: !!s.parentAccessBlocked, blockedAt: s.parentAccessBlockedAt || null, reason: s.parentAccessReason || null,
      parents: (s.parentIds || []).map((id) => { const u = db.get('users', id); return u ? { id: u.id, name: D.userLabel(u) } : null; }).filter(Boolean),
      note: 'Sprzeciw obejmuje oceny, frekwencję i uwagi. Szkoła nadal kontaktuje się z opiekunami w sprawach bezpieczeństwa.'
    };
  }, { roles: ['student'] });
  r.post('/api/student/parent-access', (ctx) => {
    const db = ctx.db; const s = meStudent(ctx); const b = ctx.body || {};
    /* R3 — pełnoletność liczy się z daty urodzenia i dnia szkolnego, a nie z flagi na koncie,
       i jest tą samą regułą, którą czyta sekretariat (`D.adultAccessState`). */
    if (!D.adultAccessState(db, s).adult) throw httpError(403, 'Sprzeciw wobec dostępu opiekunów może złożyć wyłącznie uczeń pełnoletni.', { code: 'not_adult' });
    /* `consent: true` = zgoda (tryb „zgoda wymagana”), `blocked: true` = sprzeciw (oba tryby);
       jeden zapis w `D.setAdultParentAccess`, żeby przełączenie trybu nie zostawiło dwóch prawd. */
    const blocked = b.consent !== undefined ? !b.consent : b.blocked !== false;
    const w = D.setAdultParentAccess(db, s, { consent: !blocked, byUserId: ctx.user.id, reason: b.reason });
    const before = w.before;
    const cls = db.get('classes', s.classId); const homeroom = cls && (cls.actingHomeroomTeacherId || cls.homeroomTeacherId);
    const text = blocked
      ? `${D.studentLabel(s)} (uczeń pełnoletni) wniósł sprzeciw wobec dostępu opiekunów do ocen i frekwencji. Dostęp kont opiekunów został wyłączony.`
      : `${D.studentLabel(s)} przywrócił dostęp opiekunów do ocen i frekwencji.`;
    if (homeroom) N.createNotification(db, homeroom, 'rights', text, { link: '/wychowawca' });
    for (const p of s.parentIds || []) N.createNotification(db, p, 'rights', blocked
      ? 'Uczeń pełnoletni skorzystał z prawa sprzeciwu: dostęp do ocen i frekwencji w dzienniku został wyłączony. W sprawach bezpieczeństwa szkoła nadal kontaktuje się z opiekunami.'
      : 'Uczeń pełnoletni przywrócił dostęp opiekunów do ocen i frekwencji.', { link: '/rodzic' });
    ctx.audit({ action: blocked ? 'parent_access_blocked' : 'parent_access_restored', entity: 'student', entityId: s.id, before, after: w.after, reason: s.parentAccessReason });
    const sn = D.schoolNow(db);                                              // potwierdzenie w czasie ściennym szkoły
    return { ok: true, parentAccessBlocked: blocked, at: s.parentAccessBlockedAt, affectedParents: (s.parentIds || []).length, adultAccess: D.adultAccessState(db, s), confirmation: blocked ? `Sprzeciw zapisano ${util.fmtDate(sn.date)} ${sn.time}. Konta opiekunów straciły wgląd natychmiast.` : 'Dostęp opiekunów przywrócony.' };
  }, { roles: ['student'] });

  /* Wspólne sprawdzenie dostępu do danych ucznia — używane m.in. przez konta opiekunów. */
  r.get('/api/access/student/:studentId', (ctx) => {
    const db = ctx.db; const sid = ctx.params.studentId;
    const s = db.get('students', sid); if (!s) throw httpError(404, 'Nie ma takiego ucznia.');
    D.assertCanSeeStudent(db, ctx.user, sid);   // REG-08: bramka niesie już powód, `deny`/`scope` i `parentAccessBlocked`
    return { allowed: true, studentId: sid, visibleStudentIds: D.visibleStudentIds(db, ctx.user) };
  });

  /* ---- 3.6.13 biblioteka -------------------------------------------------------------------- */
  r.get('/api/student/library', (ctx) => {
    const db = ctx.db; const s = meStudent(ctx);
    const sem = D.semester(db, D.semesterOf(db, D.today(db)));
    return { loans: loansFor(db, s.id), notices: libraryNotices(db, s.id, ctx.user.id), semesterEnd: sem ? sem.to : null, note: 'Rozliczenie z biblioteką jest warunkiem wydania świadectwa na koniec roku.' };
  }, { roles: ['student'] });

  /* ---- 3.6.15 skróty klawiszowe (lista dla każdego konta, dwujęzyczna) ----------------------- */
  /* Każdy wiersz niesie opis po polsku i po angielsku; `text` zostaje dla starszych klientów. */
  const SHORTCUTS = [
    { keys: ['Alt', '1…9'], pl: 'Przejście do sekcji z paska nawigacji', en: 'Jump to a section in the navigation bar', scope: 'wszędzie', scopeEn: 'everywhere' },
    { keys: ['?'], pl: 'Lista skrótów klawiszowych', en: 'List of keyboard shortcuts', scope: 'wszędzie', scopeEn: 'everywhere', label: 'pytajnik' },
    { keys: ['/'], pl: 'Ustawienie kursora w polu wyszukiwania', en: 'Put the cursor in the search field', scope: 'wszędzie', scopeEn: 'everywhere', label: 'ukośnik' },
    { keys: ['Ctrl', 'S'], pl: 'Zapisanie bieżącego formularza', en: 'Save the current form', scope: 'formularze', scopeEn: 'forms' },
    { keys: ['Tab'], pl: 'Następny element; Shift + Tab — poprzedni', en: 'Next element; Shift + Tab — previous', scope: 'wszędzie', scopeEn: 'everywhere' },
    { keys: ['Enter'], pl: 'Zatwierdzenie pola i przejście dalej', en: 'Confirm the field and move on', scope: 'formularze', scopeEn: 'forms' },
    { keys: ['Esc'], pl: 'Zamknięcie okna lub anulowanie edycji', en: 'Close the dialog or cancel the edit', scope: 'okna dialogowe', scopeEn: 'dialogs' },
    { keys: ['A'], pl: 'Frekwencja: wszyscy obecni', en: 'Attendance: everyone present', scope: 'lekcja', scopeEn: 'lesson' },
    { keys: ['N', 'S', 'Z', 'U'], pl: 'Frekwencja: status zaznaczonego ucznia', en: 'Attendance: status of the focused student', scope: 'lekcja', scopeEn: 'lesson' }
  ];
  r.get('/api/shortcuts', () => ({
    shortcuts: SHORTCUTS.map((x) => Object.assign({}, x, { text: x.pl, what: x.pl })),
    note: 'Cała nawigacja działa bez myszy; fokus jest zawsze widoczny.',
    noteEn: 'The whole logbook works without a mouse; focus is always visible.',
    skipLink: 'Pierwszy Tab na stronie otwiera odnośnik „Przejdź do treści”.',
    skipLinkEn: 'The first Tab on a page reveals the “Skip to content” link.'
  }));
}
module.exports = { register, simulate, lessonChanges, libraryNotices };
