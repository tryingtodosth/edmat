'use strict';
/* 3.3.1–3.3.7 — zastępstwa doraźne, odwołania i łączenie klas, publikacja planu, rozliczenie godzin wg Karty Nauczyciela. */
const D = require('../lib/domain');
const { httpError } = require('../lib/router');
const U = require('../lib/util');
const { addDays, weekday, now } = U;

/* Pokrewieństwo przedmiotów dla doboru zastępstw (symetryczne). */
const RELATED = {
  fiz: ['mat', 'che', 'inf'], mat: ['fiz', 'inf'], che: ['fiz', 'bio'], bio: ['che', 'geo'], geo: ['his', 'bio'],
  his: ['pol', 'geo'], pol: ['his', 'ang'], ang: ['pol'], inf: ['mat', 'fiz'], muz: ['pla'], pla: ['muz'], wf: [], edw: []
};
const isRelated = (a, b) => a !== b && ((RELATED[a] || []).includes(b) || (RELATED[b] || []).includes(a));
const TIERS = ['Wolna godzina · ten sam przedmiot', 'Przedmiot pokrewny', 'Dyżur', 'Wolna godzina · inny przedmiot'];
const TIER_TONE = ['brand', 'accent', 'outline', 'outline'];
const TEACHING_ROLES = ['teacher', 'principal', 'supportTeacher'];
const LEVEL_LABEL = { poczatkujacy: 'początkujący', mianowany: 'mianowany', dyplomowany: 'dyplomowany' };

function lastDayOf(month) { let d = month + '-28'; while (addDays(d, 1).slice(0, 7) === month) d = addDays(d, 1); return d; }

/* ---------------------------------------------------------------- wspólne pomocniki (używa ich też principal.js) */
function lessonsOfClassOnDate(db, classId, date) { return db.col('lessons').filter((l) => l.classId === classId && l.date === date && l.status !== 'cancelled'); }
function isEdgeLesson(db, lesson) {
  const day = lessonsOfClassOnDate(db, lesson.classId, lesson.date); if (!day.length) return { first: false, last: false };
  const nos = day.map((l) => l.lessonNo);
  return { first: lesson.lessonNo === Math.min(...nos), last: lesson.lessonNo === Math.max(...nos) };
}
function absentOn(db, teacherId, date) { return db.col('substitutions').some((s) => s.teacherId === teacherId && s.from <= date && s.to >= date); }
function dutyAt(db, teacherId, date, lessonNo) { return db.col('duties').find((d) => d.teacherId === teacherId && d.weekday === weekday(date) && d.lessonNo === lessonNo) || null; }
/** Zajęty o tej godzinie: własna lekcja, przypisane zastępstwo albo przydział z niedopublikowanego arkusza. */
function busyAt(db, teacherId, date, lessonNo, skipLessonId) {
  const hit = db.col('lessons').some((l) => l.date === date && l.lessonNo === lessonNo && l.id !== skipLessonId && l.status !== 'cancelled' && ((l.teacherId === teacherId && !l.substituteTeacherId) || l.substituteTeacherId === teacherId));
  if (hit) return true;
  return db.col('substitutions').some((s) => !s.published && s.assignments.some((a) => {
    if (a.substituteTeacherId !== teacherId || a.lessonId === skipLessonId) return false;
    const l = db.get('lessons', a.lessonId); return !!l && l.date === date && l.lessonNo === lessonNo;
  }));
}
/** Godziny doraźne przydzielone nauczycielowi w tygodniu (pon.–niedz.) danej daty — do sprawiedliwego rozdziału. */
function adHocHoursInWeek(db, teacherId, date) {
  const monday = addDays(date, -(weekday(date) - 1)), sunday = addDays(monday, 6); let n = 0;
  for (const s of db.col('substitutions')) for (const a of s.assignments) {
    if (a.substituteTeacherId !== teacherId || a.paid === false || a.kind === 'cancel') continue;
    const l = db.get('lessons', a.lessonId); if (l && l.date >= monday && l.date <= sunday) n++;
  }
  return n;
}
/** 3.3.2 — ranking kandydatów na zastępstwo dla jednej lekcji. */
function rankCandidates(db, lesson, absentTeacherId) {
  const out = [];
  for (const u of db.col('users')) {
    if (!TEACHING_ROLES.includes(u.role) || u.blocked || u.id === absentTeacherId) continue;
    if (absentOn(db, u.id, lesson.date)) continue;
    const subjects = u.subjects || [];
    const duty = dutyAt(db, u.id, lesson.date, lesson.lessonNo);
    const busy = busyAt(db, u.id, lesson.date, lesson.lessonNo, lesson.id);
    if (busy) continue;
    let tier = 3, why = 'wolna godzina';
    if (subjects.includes(lesson.subjectId)) { tier = 0; why = `wolna ${lesson.lessonNo}. lekcja, kwalifikacje z przedmiotu`; }
    else if (subjects.some((s) => isRelated(s, lesson.subjectId))) { tier = 1; why = `przedmiot pokrewny (${subjects.filter((s) => isRelated(s, lesson.subjectId)).join(', ')}), wolna ${lesson.lessonNo}. lekcja`; }
    else if (duty) { tier = 2; why = `dyżur: ${duty.place}, ${lesson.lessonNo}. lekcja`; }
    out.push({ teacherId: u.id, name: D.userLabel(u), role: u.role, subjects, tier, tierLabel: TIERS[tier], tone: TIER_TONE[tier], why, duty: duty ? duty.place : null, adHocHours: adHocHoursInWeek(db, u.id, lesson.date) });
  }
  return out.sort((a, b) => a.tier - b.tier || a.adHocHours - b.adHocHours || a.name.localeCompare(b.name, 'pl'));
}
function lessonView(db, l) {
  const cls = db.get('classes', l.classId); const t = db.get('users', l.teacherId); const sub = l.substituteTeacherId ? db.get('users', l.substituteTeacherId) : null;
  const edge = isEdgeLesson(db, l); const time = D.lessonTime(db, l.lessonNo);
  return { id: l.id, date: l.date, weekday: weekday(l.date), lessonNo: l.lessonNo, start: time.start, end: time.end, classId: l.classId, className: cls ? cls.name : l.classId, groupId: l.groupId, groupName: l.groupId ? (db.get('groups', l.groupId) || {}).name : null, subjectId: l.subjectId, subjectName: (db.get('subjects', l.subjectId) || {}).name || l.subjectId, teacherId: l.teacherId, teacherName: D.userLabel(t), substituteTeacherId: l.substituteTeacherId || null, substituteName: sub ? D.userLabel(sub) : null, room: l.room, status: l.status, combinedWith: l.combinedWith || null, first: edge.first, last: edge.last, movedFrom: l.movedFrom || null, topic: l.topic || null };
}
/** OPS-13 — uczeń należy do lekcji tylko w dniach, w których był uczniem szkoły. Ta sama zasada,
    której pilnuje lista obecności (`routes/attendance.js`): bez niej audyt kompletności dyrektora
    liczył „21 z 20 wpisów” dla każdej lekcji sprzed przyjęcia ucznia w trakcie roku, a zawiadomienie
    o zastępstwie szło do rodzica dziecka, którego jeszcze (albo już) w klasie nie było. */
function studentsOfLesson(db, l) {
  const cls = db.get('classes', l.classId); if (!cls) return [];
  const enrolled = (sid) => require('./attendance').enrolledOn(db, sid, l.date);
  if (l.groupId) { const g = db.get('groups', l.groupId); if (g) return cls.studentIds.filter((s) => g.studentIds.includes(s) && enrolled(s)); }
  return cls.studentIds.filter(enrolled);
}
/* ---------------------------------------------------------------- stawki (Karta Nauczyciela) */
function payroll(db) { return db.data.config.payroll || { defaultPensum: 18, defaultLevel: 'mianowany', overtimeRate: {}, pensum: {}, levels: {}, adHocFactor: 1, combinedPay: 1 }; }
function levelOf(db, u) { const p = payroll(db); return (p.levels || {})[u.id] || p.defaultLevel; }
function pensumOf(db, u) { const p = payroll(db); const v = (p.pensum || {})[u.id]; return v == null ? p.defaultPensum : v; }
function rateFor(db, u) { const p = payroll(db); const byRole = (p.overtimeRate || {})[u.role] || (p.overtimeRate || {}).teacher || {}; const r = byRole[levelOf(db, u)]; return r == null ? (byRole[p.defaultLevel] || 0) : r; }

function register(r, app) {

  const subDetail = (dbx, s, opts) => {
    const o = opts || {}; const t = dbx.get('users', s.teacherId);
    const lessons = s.assignments.map((a) => {
      const l = dbx.get('lessons', a.lessonId); if (!l) return null;
      const view = lessonView(dbx, l);
      return Object.assign(view, { assignment: a, substituteName: a.substituteTeacherId ? D.userLabel(dbx.get('users', a.substituteTeacherId)) : null, suggestions: o.suggestions === false ? undefined : rankCandidates(dbx, l, s.teacherId).slice(0, 6), students: studentsOfLesson(dbx, l).length });
    }).filter(Boolean).sort((a, b) => (a.date + String(a.lessonNo).padStart(2, '0')).localeCompare(b.date + String(b.lessonNo).padStart(2, '0')));
    const paidHours = s.assignments.filter((a) => a.substituteTeacherId && a.paid !== false && a.kind !== 'cancel').length;
    const open = s.assignments.filter((a) => !a.substituteTeacherId && a.kind !== 'cancel' && a.kind !== 'reschedule').length;
    return Object.assign({}, s, { teacherName: D.userLabel(t), lessons, stats: { lessons: s.assignments.length, open, filled: s.assignments.filter((a) => !!a.substituteTeacherId).length, cancelled: s.assignments.filter((a) => a.kind === 'cancel').length, rescheduled: s.assignments.filter((a) => a.kind === 'reschedule').length, combined: s.assignments.filter((a) => a.kind === 'combine').length, paidHours } });
  };

  /* ------------------------------------------------ 3.3.1 zgłoszenie nieobecności + dobór zastępstw */
  r.post('/api/substitutions', (ctx) => {
    const b = ctx.body || {}; const t = ctx.db.get('users', b.teacherId);
    if (!t) throw httpError(400, 'Nie ma takiego nauczyciela.', { code: 'no_teacher' });
    const from = String(b.from || '').slice(0, 10), to = String(b.to || from).slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to) || to < from) throw httpError(400, 'Podaj poprawny zakres nieobecności (od – do).', { code: 'bad_range' });
    if (!String(b.reason || '').trim()) throw httpError(400, 'Podaj podstawę nieobecności (np. zwolnienie lekarskie).', { code: 'no_reason' });
    const lessons = ctx.db.col('lessons').filter((l) => l.teacherId === t.id && l.date >= from && l.date <= to && l.status !== 'cancelled');
    const row = ctx.db.insert('substitutions', {
      teacherId: t.id, from, to, reason: String(b.reason).trim(), byUserId: ctx.user.id,
      assignments: lessons.map((l) => ({ lessonId: l.id, substituteTeacherId: null, kind: 'sub', combinedWithLessonId: null, paid: true, room: l.room, tier: null, reasonText: null })),
      published: false, publishedAt: null, publishAt: null
    });
    ctx.audit({ action: 'substitution_created', entity: 'substitutions', entityId: row.id, after: { teacherId: t.id, from, to, lessons: lessons.length }, reason: row.reason });
    D.notify(ctx.db, t.id, 'substitution', `Zarejestrowano nieobecność ${from} – ${to}. Dobór zastępstw uruchomiony dla ${lessons.length} lekcji.`, { link: '/dyrekcja' });
    return subDetail(ctx.db, row);
  }, { roles: ['principal'] });

  r.get('/api/substitutions', (ctx) => {
    const list = ctx.db.col('substitutions').slice().sort((a, b) => (b.from || '').localeCompare(a.from || ''));
    return { substitutions: list.map((s) => subDetail(ctx.db, s, { suggestions: false })), today: D.today(ctx.db) };
  }, { roles: ['principal', 'registrar'] });

  r.get('/api/substitutions/:id', (ctx) => {
    const s = ctx.db.get('substitutions', ctx.params.id); if (!s) throw httpError(404, 'Nie ma takiego zgłoszenia zastępstw.');
    return subDetail(ctx.db, s);
  }, { roles: ['principal', 'registrar'] });

  /* ------------------------------------------------ 3.3.2/3.3.3/3.3.4 obsada pojedynczej lekcji */
  r.post('/api/substitutions/:id/assign', (ctx) => {
    const s = ctx.db.get('substitutions', ctx.params.id); if (!s) throw httpError(404, 'Nie ma takiego zgłoszenia zastępstw.');
    if (s.published) throw httpError(409, 'Arkusz zastępstw został już opublikowany. Zarejestruj korektę nowym zgłoszeniem.', { code: 'published' });
    const b = ctx.body || {}; const kind = b.kind || 'sub';
    const a = s.assignments.find((x) => x.lessonId === b.lessonId); if (!a) throw httpError(404, 'Ta lekcja nie należy do zgłoszenia.');
    const lesson = ctx.db.get('lessons', a.lessonId); const before = Object.assign({}, a);
    const edge = isEdgeLesson(ctx.db, lesson);
    const cls = ctx.db.get('classes', lesson.classId);

    if (kind === 'cancel' || kind === 'reschedule') {
      if (!edge.first && !edge.last) throw httpError(400, 'Odwołać lub przenieść można tylko pierwszą albo ostatnią lekcję klasy w danym dniu — w środku planu uczniowie muszą mieć zapewnioną opiekę.', { code: 'not_edge' });
      a.kind = kind; a.substituteTeacherId = null; a.paid = false;
      a.edge = edge.first ? 'first' : 'last';
      a.note = kind === 'cancel'
        ? (edge.first ? 'Klasa przychodzi na kolejną lekcję.' : 'Klasa kończy zajęcia wcześniej.')
        : `Lekcja przeniesiona na ${b.newDate || lesson.date}, ${b.newLessonNo || lesson.lessonNo}. godzinę.`;
      if (kind === 'reschedule') { a.newDate = String(b.newDate || lesson.date).slice(0, 10); a.newLessonNo = +b.newLessonNo || lesson.lessonNo; }
      /* 3.3.3 — rodzice każdego ucznia klasy dostają informację o zmianie planu od razu, nie dopiero przy publikacji */
      const time = D.lessonTime(ctx.db, lesson.lessonNo);
      const text = kind === 'cancel'
        ? `Zmiana planu ${lesson.date}: ${lesson.lessonNo}. lekcja (${time.start}) klasy ${cls ? cls.name : lesson.classId} odwołana — ${edge.first ? 'uczniowie przychodzą na kolejną lekcję' : 'uczniowie kończą zajęcia wcześniej'}.`
        : `Zmiana planu ${lesson.date}: ${lesson.lessonNo}. lekcja klasy ${cls ? cls.name : lesson.classId} przeniesiona na ${a.newDate}, ${a.newLessonNo}. godzinę.`;
      let notified = 0;
      for (const sid of studentsOfLesson(ctx.db, lesson)) { notified += D.notifyParentsOf(ctx.db, sid, 'schedule', text, { link: '/plan' }).length; }
      a.parentsNotified = notified; a.parentsNotifiedAt = now();
    } else if (kind === 'combine') {
      const other = s.assignments.find((x) => x.lessonId === b.combineWithLessonId);
      if (!other) throw httpError(400, 'Wskaż drugą lekcję z tego zgłoszenia do połączenia.', { code: 'no_pair' });
      const ol = ctx.db.get('lessons', other.lessonId);
      if (ol.date !== lesson.date || ol.lessonNo !== lesson.lessonNo) throw httpError(400, 'Połączyć można tylko lekcje odbywające się w tym samym dniu i o tej samej godzinie.', { code: 'not_parallel' });
      if (!b.substituteTeacherId) throw httpError(400, 'Wskaż nauczyciela, który poprowadzi połączone klasy.', { code: 'no_teacher' });
      const room = b.room || 'aula';
      a.kind = 'combine'; a.substituteTeacherId = b.substituteTeacherId; a.combinedWithLessonId = ol.id; a.paid = true; a.room = room; a.primary = true;
      other.kind = 'combine'; other.substituteTeacherId = b.substituteTeacherId; other.combinedWithLessonId = lesson.id; other.paid = false; other.room = room; other.primary = false;
      const p = payroll(ctx.db);
      a.payNote = `Dwie klasy w auli pod opieką jednego nauczyciela — ${p.combinedPay} płatna godzina doraźna zamiast dwóch.`;
      other.payNote = a.payNote;
    } else {
      if (!b.substituteTeacherId) throw httpError(400, 'Wskaż nauczyciela na zastępstwo.', { code: 'no_teacher' });
      const cand = rankCandidates(ctx.db, lesson, s.teacherId).find((c) => c.teacherId === b.substituteTeacherId);
      if (!cand && !b.force) throw httpError(409, 'Ten nauczyciel ma w tym czasie własną lekcję lub jest nieobecny. Wybierz kandydata z listy albo użyj wymuszenia.', { code: 'busy' });
      a.kind = 'sub'; a.substituteTeacherId = b.substituteTeacherId; a.paid = true; a.combinedWithLessonId = null;
      a.tier = cand ? cand.tier : null; a.reasonText = cand ? cand.why : 'przydział ręczny dyrektora';
      if (b.room) a.room = b.room;
    }
    ctx.db.save();
    ctx.audit({ action: 'substitution_assigned', entity: 'substitutions', entityId: s.id, before, after: Object.assign({}, a), reason: b.reason || null });
    return subDetail(ctx.db, s);
  }, { roles: ['principal'] });

  r.post('/api/substitutions/:id/clear', (ctx) => {
    const s = ctx.db.get('substitutions', ctx.params.id); if (!s) throw httpError(404, 'Nie ma takiego zgłoszenia zastępstw.');
    if (s.published) throw httpError(409, 'Arkusz został opublikowany.', { code: 'published' });
    const a = s.assignments.find((x) => x.lessonId === (ctx.body || {}).lessonId); if (!a) throw httpError(404, 'Ta lekcja nie należy do zgłoszenia.');
    const before = Object.assign({}, a);
    if (a.combinedWithLessonId) { const o = s.assignments.find((x) => x.lessonId === a.combinedWithLessonId); if (o) Object.assign(o, { kind: 'sub', substituteTeacherId: null, combinedWithLessonId: null, paid: true, primary: undefined, payNote: undefined }); }
    Object.assign(a, { kind: 'sub', substituteTeacherId: null, combinedWithLessonId: null, paid: true, tier: null, reasonText: null, note: undefined, primary: undefined, payNote: undefined });
    ctx.db.save();
    ctx.audit({ action: 'substitution_cleared', entity: 'substitutions', entityId: s.id, before, after: Object.assign({}, a) });
    return subDetail(ctx.db, s);
  }, { roles: ['principal'] });

  /* ------------------------------------------------ 3.3.5 publikacja planu zastępstw */
  function applySubstitution(dbx, s, byUserId) {
    let notifications = 0; const touched = [];
    for (const a of s.assignments) {
      const l = dbx.get('lessons', a.lessonId); if (!l) continue;
      const cls = dbx.get('classes', l.classId); const className = cls ? cls.name : l.classId;
      const subj = (dbx.get('subjects', l.subjectId) || {}).name || l.subjectId;
      const time = D.lessonTime(dbx, l.lessonNo);
      let text = null;
      if (a.kind === 'cancel') { l.status = 'cancelled'; l.substituteTeacherId = null; text = `${l.date}: ${l.lessonNo}. lekcja (${subj}, ${className}) odwołana.`; }
      else if (a.kind === 'reschedule') { l.movedFrom = { date: l.date, lessonNo: l.lessonNo }; l.date = a.newDate || l.date; l.lessonNo = a.newLessonNo || l.lessonNo; l.status = 'rescheduled'; text = `${a.newDate}: ${subj} (${className}) przeniesiona na ${l.lessonNo}. godzinę.`; }
      else if (a.substituteTeacherId) {
        l.status = 'substituted'; l.substituteTeacherId = a.substituteTeacherId;
        if (a.room && a.room !== l.room) { l.roomChangedFrom = l.room; l.room = a.room; }
        if (a.kind === 'combine') l.combinedWith = a.combinedWithLessonId;
        text = `${l.date}: ${l.lessonNo}. lekcja (${subj}, ${className}, ${time.start}) — zastępstwo: ${D.userLabel(dbx.get('users', a.substituteTeacherId))}${a.kind === 'combine' ? ', klasy połączone w sali ' + (a.room || 'aula') : ''}.`;
      }
      if (!text) continue;
      /* Opublikowane zastępstwo to zmiana w planie ucznia — bez tego stempla ekran „zmiany w planie”
         (`GET /api/student/changes`, 3.6.5) pokazywał wyłącznie zmiany wpisane ręcznie w zasiewie demo,
         a prawdziwe zastępstwo docierało tylko powiadomieniem. */
      l.changedAt = now();
      l.changeReason = a.note || (a.kind === 'cancel' ? 'Lekcja odwołana — zastępstwo nie zostało obsadzone.' : `Zastępstwo za ${D.userLabel(dbx.get('users', s.teacherId))}.`);
      touched.push(l.id);
      for (const sid of studentsOfLesson(dbx, l)) {
        const su = dbx.one('users', (u) => u.studentId === sid);
        if (su) { D.notify(dbx, su.id, 'schedule', text, { link: '/plan' }); notifications++; }
        notifications += D.notifyParentsOf(dbx, sid, 'schedule', text, { link: '/plan' }).length;
      }
      if (a.substituteTeacherId) { D.notify(dbx, a.substituteTeacherId, 'schedule', `Przydzielono Ci zastępstwo: ${text}`, { link: '/plan' }); notifications++; }
    }
    D.notify(dbx, s.teacherId, 'schedule', `Plan zastępstw za Twoją nieobecność ${s.from} – ${s.to} został opublikowany.`, { link: '/plan' }); notifications++;
    s.published = true; s.publishedAt = now(); s.publishedBy = byUserId; s.notifications = notifications; s.touchedLessonIds = touched;
    dbx.save();
    return { notifications, lessons: touched.length };
  }

  r.post('/api/substitutions/:id/publish', (ctx) => {
    const s = ctx.db.get('substitutions', ctx.params.id); if (!s) throw httpError(404, 'Nie ma takiego zgłoszenia zastępstw.');
    if (s.published) throw httpError(409, 'Ten arkusz jest już opublikowany.', { code: 'published' });
    const b = ctx.body || {};
    const open = s.assignments.filter((a) => !a.substituteTeacherId && a.kind !== 'cancel' && a.kind !== 'reschedule');
    if (open.length && !b.force) throw httpError(400, `Publikacja będzie możliwa po obsadzeniu wszystkich lekcji — bez obsady: ${open.length}.`, { code: 'open_lessons', open: open.length });
    /* Godzinę publikacji (zwykle 15:00 dnia poprzedniego) przeglądarka przysyła jako czas ścienny
       szkoły w `publishAtLocal`; zapisujemy instant ze strefą, więc doba zmiany czasu nie przesuwa
       publikacji o godzinę. `publishAt` policzone w przeglądarce zostaje drogą zapasową. */
    const local = String(b.publishAtLocal || '');
    s.publishAt = (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(local) ? U.toInstant(local.slice(0, 10), local.slice(11, 16), D.tz(ctx.db)) : null) || b.publishAt || now();
    ctx.db.save();
    if (Date.parse(s.publishAt) > Date.parse(now())) {
      ctx.audit({ action: 'substitution_publish_scheduled', entity: 'substitutions', entityId: s.id, after: { publishAt: s.publishAt } });
      return { scheduled: true, publishAt: s.publishAt, substitution: subDetail(ctx.db, s, { suggestions: false }) };
    }
    const res = applySubstitution(ctx.db, s, ctx.user.id);
    ctx.audit({ action: 'substitution_published', entity: 'substitutions', entityId: s.id, after: { publishedAt: s.publishedAt, lessons: res.lessons, notifications: res.notifications } });
    return { published: true, publishedAt: s.publishedAt, notifications: res.notifications, substitution: subDetail(ctx.db, s, { suggestions: false }) };
  }, { roles: ['principal'] });

  /* Wyzwalacz harmonogramu: publikuje wszystkie arkusze, których godzina publikacji już minęła (np. 15:00 dnia poprzedniego). */
  r.post('/api/substitutions/publish-due', (ctx) => {
    const due = ctx.db.col('substitutions').filter((s) => !s.published && s.publishAt && Date.parse(s.publishAt) <= Date.parse(now()));
    const out = due.map((s) => { const res = applySubstitution(ctx.db, s, ctx.user.id); ctx.audit({ action: 'substitution_published', entity: 'substitutions', entityId: s.id, after: { publishedAt: s.publishedAt, lessons: res.lessons, notifications: res.notifications }, reason: 'publikacja o zaplanowanej godzinie' }); return { id: s.id, lessons: res.lessons, notifications: res.notifications }; });
    return { published: out.length, substitutions: out };
  }, { roles: ['principal'] });

  /* ------------------------------------------------ 3.3.5 plan lekcji na dzień z uwzględnieniem zastępstw */
  r.get('/api/substitutions/timetable/:date', (ctx) => {
    const date = ctx.params.date; const q = ctx.query || {};
    let classId = q.classId || null;
    if (ctx.user.role === 'student') { const st = ctx.db.get('students', ctx.user.studentId); classId = st ? st.classId : classId; }
    let lessons = ctx.db.col('lessons').filter((l) => l.date === date);
    if (classId) lessons = lessons.filter((l) => l.classId === classId);
    if (q.teacherId) lessons = lessons.filter((l) => l.teacherId === q.teacherId || l.substituteTeacherId === q.teacherId);
    if (q.studentId) { D.assertCanSeeStudent(ctx.db, ctx.user, q.studentId); lessons = lessons.filter((l) => studentsOfLesson(ctx.db, l).includes(q.studentId)); }
    const rows = lessons.map((l) => lessonView(ctx.db, l)).sort((a, b) => a.lessonNo - b.lessonNo || a.className.localeCompare(b.className, 'pl'));
    return { date, weekday: weekday(date), classId, lessons: rows, changed: rows.filter((l) => ['substituted', 'cancelled', 'rescheduled'].includes(l.status)).length };
  });

  /* ------------------------------------------------ 3.3.6 rozliczenie miesięczne (Karta Nauczyciela) */
  function settlement(dbx, month) {
    const cfg = dbx.data.config; const p = payroll(dbx);
    const from = month + '-01', to = lastDayOf(month);
    const isSchoolDay = (d) => weekday(d) <= 5 && !cfg.daysOff.some((x) => x.date === d) && !cfg.holidays.some((hh) => d >= hh.from && d <= hh.to);
    const today = D.today(dbx);
    let schoolDays = 0, elapsedDays = 0;
    for (let d = from; d <= to; d = addDays(d, 1)) { if (!isSchoolDay(d)) continue; schoolDays++; if (d < today) elapsedDays++; }
    /* podstawa naliczenia obejmuje tylko dni, w których zajęcia już się odbyły */
    const weeks = Math.round((elapsedDays / 5) * 100) / 100;
    const inMonth = (d) => d >= from && d <= to;
    const rows = [];
    for (const u of dbx.col('users')) {
      if (!TEACHING_ROLES.includes(u.role)) continue;
      const own = dbx.col('lessons').filter((l) => l.teacherId === u.id && inMonth(l.date) && l.status !== 'cancelled' && l.status !== 'planned' && !l.substituteTeacherId).length;
      let adHoc = 0, combinedSaved = 0; const adHocDetail = [];
      for (const s of dbx.col('substitutions')) {
        if (!s.published) continue;
        for (const a of s.assignments) {
          if (a.substituteTeacherId !== u.id || a.kind === 'cancel' || a.kind === 'reschedule') continue;
          const l = dbx.get('lessons', a.lessonId); if (!l || !inMonth(l.date)) continue;
          if (a.paid === false) { combinedSaved++; continue; }
          adHoc++; adHocDetail.push({ date: l.date, lessonNo: l.lessonNo, classId: l.classId, subjectId: l.subjectId, combined: a.kind === 'combine' });
        }
      }
      const pensum = pensumOf(dbx, u); const base = Math.round(pensum * weeks * 10) / 10;
      const overtime = Math.max(0, Math.round((own - base) * 10) / 10);
      if (!own && !adHoc) continue;
      const rate = rateFor(dbx, u); const adHocRate = Math.round(rate * (p.adHocFactor == null ? 1 : p.adHocFactor) * 100) / 100;
      const overtimeAmount = Math.round(overtime * rate * 100) / 100, adHocAmount = Math.round(adHoc * adHocRate * 100) / 100;
      rows.push({ teacherId: u.id, name: D.userLabel(u), role: u.role, level: levelOf(dbx, u), levelName: LEVEL_LABEL[levelOf(dbx, u)] || levelOf(dbx, u), pensum, baseHours: base, heldHours: own, overtimeHours: overtime, adHocHours: adHoc, combinedSaved, rate, adHocRate, overtimeAmount, adHocAmount, total: Math.round((overtimeAmount + adHocAmount) * 100) / 100, adHocDetail });
    }
    rows.sort((a, b) => b.total - a.total || a.name.localeCompare(b.name, 'pl'));
    const sum = (k) => Math.round(rows.reduce((s, x) => s + x[k], 0) * 100) / 100;
    return { month, from, to, schoolDays, elapsedDays, weeks, legalBasis: p.legalBasis, currency: p.currency || 'PLN', rows, totals: { teachers: rows.length, overtimeHours: sum('overtimeHours'), adHocHours: sum('adHocHours'), combinedSaved: sum('combinedSaved'), amount: sum('total') } };
  }

  r.get('/api/payroll/rates', (ctx) => {
    const p = payroll(ctx.db);
    const teachers = ctx.db.col('users').filter((u) => TEACHING_ROLES.includes(u.role)).map((u) => ({ userId: u.id, name: D.userLabel(u), role: u.role, level: levelOf(ctx.db, u), levelName: LEVEL_LABEL[levelOf(ctx.db, u)] || levelOf(ctx.db, u), pensum: pensumOf(ctx.db, u), rate: rateFor(ctx.db, u) }));
    return { payroll: p, teachers, rules: [
      'Godziny ponadwymiarowe = godziny zrealizowane ponad pensum w okresie rozliczeniowym (pensum × liczba tygodni nauki).',
      `Godzina doraźnego zastępstwa jest płatna według stawki godziny ponadwymiarowej (współczynnik ${p.adHocFactor == null ? 1 : p.adHocFactor}).`,
      `Dwie klasy połączone w auli pod opieką jednego nauczyciela to ${p.combinedPay} płatna godzina doraźna, a nie dwie.`,
      'Lekcja odwołana lub przeniesiona nie jest godziną doraźną i nie podlega rozliczeniu.'
    ] };
  }, { roles: ['principal', 'registrar', 'admin'] });

  r.get('/api/payroll/settlement', (ctx) => {
    const month = (ctx.query.month || D.today(ctx.db).slice(0, 7)).slice(0, 7);
    if (!/^\d{4}-\d{2}$/.test(month)) throw httpError(400, 'Podaj okres rozliczeniowy w formacie RRRR-MM.', { code: 'bad_month' });
    return settlement(ctx.db, month);
  }, { roles: ['principal', 'registrar'] });

  /* ------------------------------------------------ 3.3.7 eksport do systemu kadrowo-płacowego */
  r.get('/api/payroll/settlement/export', (ctx) => {
    const month = (ctx.query.month || D.today(ctx.db).slice(0, 7)).slice(0, 7);
    const format = (ctx.query.format || 'csv').toLowerCase();
    const s = settlement(ctx.db, month); const school = ctx.db.data.config.school;
    ctx.audit({ action: 'payroll_exported', entity: 'payroll', entityId: month, after: { format, teachers: s.rows.length, amount: s.totals.amount } });
    if (format === 'xml') {
      const x = D.xmlEsc;
      const body = `<?xml version="1.0" encoding="UTF-8"?>\n<Rozliczenie okres="${x(month)}" od="${x(s.from)}" do="${x(s.to)}" waluta="${x(s.currency)}" podstawa="${x(s.legalBasis)}">\n  <Szkola nazwa="${x(school.name)}" regon="${x(school.regon)}" rspo="${x(school.rspo)}"/>\n  <TygodnieNauki>${s.weeks}</TygodnieNauki>\n` +
        s.rows.map((rr) => `  <Nauczyciel id="${x(rr.teacherId)}" stopien="${x(rr.level)}" rola="${x(rr.role)}">\n    <ImieNazwisko>${x(rr.name)}</ImieNazwisko>\n    <Pensum>${rr.pensum}</Pensum>\n    <GodzinyZrealizowane>${rr.heldHours}</GodzinyZrealizowane>\n    <GodzinyPonadwymiarowe stawka="${rr.rate}">${rr.overtimeHours}</GodzinyPonadwymiarowe>\n    <GodzinyDorazne stawka="${rr.adHocRate}">${rr.adHocHours}</GodzinyDorazne>\n    <KwotaPonadwymiarowe>${rr.overtimeAmount.toFixed(2)}</KwotaPonadwymiarowe>\n    <KwotaDorazne>${rr.adHocAmount.toFixed(2)}</KwotaDorazne>\n    <Razem>${rr.total.toFixed(2)}</Razem>\n  </Nauczyciel>`).join('\n') +
        `\n  <Podsumowanie nauczycieli="${s.totals.teachers}" godzinyPonadwymiarowe="${s.totals.overtimeHours}" godzinyDorazne="${s.totals.adHocHours}" kwota="${s.totals.amount.toFixed(2)}"/>\n</Rozliczenie>\n`;
      return { __raw: true, body, contentType: 'application/xml; charset=utf-8', filename: `rozliczenie-${month}.xml` };
    }
    const header = ['Nauczyciel', 'Rola', 'Stopień awansu', 'Pensum', 'Godziny zrealizowane', 'Godziny ponadwymiarowe', 'Godziny doraźne', 'Stawka', 'Kwota ponadwymiarowe', 'Kwota doraźne', 'Razem'];
    const rows = s.rows.map((rr) => [rr.name, rr.role, rr.levelName, rr.pensum, rr.heldHours, rr.overtimeHours, rr.adHocHours, String(rr.rate).replace('.', ','), rr.overtimeAmount.toFixed(2).replace('.', ','), rr.adHocAmount.toFixed(2).replace('.', ','), rr.total.toFixed(2).replace('.', ',')]);
    rows.push(['RAZEM', '', '', '', '', s.totals.overtimeHours, s.totals.adHocHours, '', '', '', s.totals.amount.toFixed(2).replace('.', ',')]);
    return { __raw: true, body: D.csv(rows, header), contentType: 'text/csv; charset=utf-8', filename: `rozliczenie-${month}.csv` };
  }, { roles: ['principal', 'registrar'] });

  /* ------------------------------------------------ trwałe przekazanie obowiązków (odejście nauczyciela w trakcie roku) */
  /** Zastępstwa są od kilku dni. Gdy nauczyciel odchodzi na stałe, plan musi wskazać następcę — inaczej do
      czerwca w dzienniku prowadzi lekcje zablokowane konto, a każda nowo wygenerowana lekcja jest bez obsady. */
  function handoverPlan(dbx, fromTeacher, date, opts) {
    const o = opts || {};
    const only = (t) => (!o.subjectIds || !o.subjectIds.length || o.subjectIds.includes(t.subjectId)) && (!o.classIds || !o.classIds.length || o.classIds.includes(t.classId));
    const slots = dbx.col('timetable').filter((t) => t.teacherId === fromTeacher.id && only(t));
    const slotIds = new Set(slots.map((t) => t.id));
    const lessons = dbx.col('lessons').filter((l) => l.date >= date && l.status !== 'cancelled' && (l.teacherId === fromTeacher.id || l.substituteTeacherId === fromTeacher.id) && only(l));
    const classes = [...new Set(slots.map((t) => t.classId).concat(lessons.map((l) => l.classId)))].sort();
    return { slots, slotIds, lessons, classes, subjects: [...new Set(slots.map((t) => t.subjectId).concat(lessons.map((l) => l.subjectId)))].sort() };
  }
  r.post('/api/substitutions/handover', (ctx) => {
    const db = ctx.db; const b = ctx.body || {};
    const from = db.get('users', b.fromTeacherId) || db.one('users', (u) => u.login === b.fromTeacherId);
    if (!from) throw httpError(400, 'Nie ma takiego nauczyciela (fromTeacherId).', { code: 'no_teacher' });
    const to = db.get('users', b.toTeacherId) || db.one('users', (u) => u.login === b.toTeacherId);
    if (!to) throw httpError(400, 'Wskaż następcę (toTeacherId).', { code: 'no_successor' });
    if (to.id === from.id) throw httpError(400, 'Następca musi być inną osobą.', { code: 'same_teacher' });
    if (!TEACHING_ROLES.includes(to.role)) throw httpError(400, 'Obowiązki dydaktyczne można przekazać wyłącznie nauczycielowi.', { code: 'not_teacher' });
    if (to.blocked) throw httpError(400, 'Konto następcy jest zablokowane.', { code: 'successor_blocked' });
    const date = String(b.from || D.today(db)).slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw httpError(400, 'Podaj datę przejęcia w formacie RRRR-MM-DD.', { code: 'bad_date' });
    const reason = String(b.reason || '').trim();
    if (!reason) throw httpError(400, 'Podaj podstawę przekazania (np. rozwiązanie umowy z 31.10).', { code: 'no_reason' });
    const plan = handoverPlan(db, from, date, b);
    const missing = plan.subjects.filter((s) => !(to.subjects || []).includes(s));
    if (missing.length && !b.force) throw httpError(409, `Następca nie ma w kartotece kwalifikacji z: ${missing.join(', ')}. Potwierdź wymuszeniem (force) albo uzupełnij przedmioty na koncie.`, { code: 'missing_qualifications', missing });
    if (b.dryRun) return { dryRun: true, from: D.userLabel(from), to: D.userLabel(to), date, slots: plan.slots.length, lessons: plan.lessons.length, classes: plan.classes, subjects: plan.subjects, missingQualifications: missing, homeroomOf: from.homeroomOf || null,
      message: `Podgląd: ${plan.slots.length} pozycji planu i ${plan.lessons.length} lekcji od ${date} przejmie ${D.userLabel(to)}. Nic nie zostało zapisane.` };
    const before = { timetableEntries: plan.slots.length, lessons: plan.lessons.length, homeroomOf: from.homeroomOf || null };
    for (const t of plan.slots) t.teacherId = to.id;
    let relieved = 0;
    for (const l of plan.lessons) { if (l.substituteTeacherId === from.id) { l.substituteTeacherId = null; if (l.status === 'substituted') l.status = 'planned'; relieved++; } l.teacherId = to.id; l.handoverAt = now(); l.handoverFromTeacherId = from.id; }
    /* niedopublikowane arkusze zastępstw za odchodzącego tracą sens — lekcje ma już następca */
    for (const s of db.col('substitutions')) if (!s.published && s.teacherId === from.id && s.to >= date) { s.assignments = s.assignments.filter((a) => { const l = db.get('lessons', a.lessonId); return !l || l.date < date; }); s.handoverNote = `Obowiązki przejął ${D.userLabel(to)} od ${date}.`; }
    const homeroom = [];
    if (from.homeroomOf && b.keepHomeroom !== true) {
      const cls = db.get('classes', from.homeroomOf);
      if (cls) { if (b.homeroomTeacherId) { const hr = db.get('users', b.homeroomTeacherId); if (!hr) throw httpError(400, 'Nie ma takiego nauczyciela (homeroomTeacherId).', { code: 'no_homeroom_teacher' }); cls.homeroomTeacherId = hr.id; hr.homeroomOf = cls.id; homeroom.push({ classId: cls.id, to: hr.id }); }
        else { cls.homeroomTeacherId = to.id; to.homeroomOf = cls.id; homeroom.push({ classId: cls.id, to: to.id }); } }
      from.homeroomOf = null;
    }
    for (const s of plan.subjects) if (!(to.subjects || []).includes(s)) to.subjects = [...(to.subjects || []), s];
    db.save();
    let notified = 0;
    D.notify(db, to.id, 'schedule', `Od ${date} przejmujesz zajęcia po ${D.userLabel(from)}: ${plan.subjects.join(', ')} w oddziałach ${plan.classes.join(', ')}.`, { link: '/plan' }); notified++;
    for (const cid of plan.classes) {
      const cls = db.get('classes', cid); if (!cls) continue;
      const text = `Zmiana w planie klasy ${cls.name}: od ${date} zajęcia (${plan.subjects.join(', ')}) prowadzi ${D.userLabel(to)} w miejsce ${D.userLabel(from)}.`;
      for (const sid of cls.studentIds || []) { const su = db.one('users', (u) => u.studentId === sid); if (su) { D.notify(db, su.id, 'schedule', text, { link: '/plan' }); notified++; } notified += D.notifyParentsOf(db, sid, 'schedule', text, { link: '/plan' }).length; }
    }
    ctx.audit({ action: 'teaching_handover', entity: 'users', entityId: from.id, before, after: { toTeacherId: to.id, date, timetableEntries: plan.slots.length, lessons: plan.lessons.length, relievedSubstitutions: relieved, homeroom, notifications: notified }, reason });
    return { ok: true, from: { id: from.id, name: D.userLabel(from) }, to: { id: to.id, name: D.userLabel(to) }, date,
      timetableEntries: plan.slots.length, lessons: plan.lessons.length, classes: plan.classes, subjects: plan.subjects, homeroom, notifications: notified,
      message: `${D.userLabel(to)} przejmuje od ${date} ${plan.slots.length} ${U.plural(plan.slots.length, 'pozycję planu', 'pozycje planu', 'pozycji planu')} i ${plan.lessons.length} ${U.plural(plan.lessons.length, 'lekcję', 'lekcje', 'lekcji')}${homeroom.length ? `, a także wychowawstwo oddziału ${homeroom[0].classId}` : ''}. Powiadomiono ${notified} ${U.plural(notified, 'osobę', 'osoby', 'osób')}.` };
  }, { roles: ['principal'] });

  /* raport wg Karty Nauczyciela do druku */
  r.get('/api/payroll/settlement/print', (ctx) => {
    const month = (ctx.query.month || D.today(ctx.db).slice(0, 7)).slice(0, 7);
    const s = settlement(ctx.db, month); const cfg = ctx.db.data.config; const x = D.xmlEsc;
    const body = `<h1>Rozliczenie godzin ponadwymiarowych i doraźnych zastępstw</h1><p class="note">Okres: ${x(s.from)} – ${x(s.to)} · ${s.weeks} tygodni nauki · ${x(s.legalBasis)}</p>` +
      `<table><caption>Rozliczenie godzin — ${x(s.from)} – ${x(s.to)}</caption><thead><tr><th scope="col">Nauczyciel</th><th scope="col">Stopień</th><th scope="col">Pensum</th><th scope="col">Zrealizowane</th><th scope="col">Ponadwymiarowe</th><th scope="col">Doraźne</th><th scope="col">Razem (zł)</th></tr></thead><tbody>` +
      s.rows.map((rr) => `<tr><td>${x(rr.name)}</td><td>${x(rr.levelName)}</td><td>${rr.pensum}</td><td>${rr.heldHours}</td><td>${rr.overtimeHours}</td><td>${rr.adHocHours}</td><td>${rr.total.toFixed(2)}</td></tr>`).join('') +
      `</tbody></table><p class="note">Razem do wypłaty: ${s.totals.amount.toFixed(2)} ${x(s.currency)}.</p><div class="sign"><span>Dyrektor szkoły</span><span>Główny księgowy</span></div>`;
    return { __raw: true, contentType: 'text/html; charset=utf-8', inline: true, filename: `rozliczenie-${month}.html`, body: D.printHtml('Rozliczenie ' + month, body, { school: cfg.school.name, schoolMeta: cfg.school.address, docNo: 'Rozliczenie ' + month, date: D.today(ctx.db), printed: now() }) };
  }, { roles: ['principal', 'registrar'] });
}

module.exports = { register, rankCandidates, lessonView, studentsOfLesson, isEdgeLesson, busyAt, absentOn, RELATED, isRelated, payroll, rateFor, pensumOf, levelOf, lastDayOf, TIERS };
