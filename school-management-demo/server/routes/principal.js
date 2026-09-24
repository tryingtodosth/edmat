'use strict';
/* 3.3.8–3.3.20 — nadzór pedagogiczny, odwołania od ocen, komunikaty, audyt, archiwum roczne, konta i widoczność. */
const D = require('../lib/domain');
const C = require('../lib/crypto');
const { httpError } = require('../lib/router');
const { query: auditQuery } = require('../lib/audit');
const { addDays, weekday, now, daysBetween } = require('../lib/util');
const S = require('./substitutions');
const LA = require('../lib/log-access');
const { countsFor } = require('./log-comments');
const MOD = require('../modules');

const SPECIALIST_ROLES = ['psychologist', 'counselor', 'specialEducator', 'speechTherapist', 'supportTeacher'];
const STAFF_ROLES = ['teacher', 'principal', 'counselor', 'psychologist', 'specialEducator', 'speechTherapist', 'supportTeacher', 'registrar', 'admin', 'careEducator', 'cafeteria', 'librarian', 'nurse', 'dpo'];
const audienceOf = (user) => (user.role === 'parent' ? 'parent' : user.role === 'student' ? 'student' : 'staff');
const isSchoolDay = (cfg, d) => weekday(d) <= 5 && !cfg.daysOff.some((x) => x.date === d) && !cfg.holidays.some((hh) => d >= hh.from && d <= hh.to);
const mondayOf = (d) => addDays(d, -(weekday(d) - 1));

function register(r, app) {
  /* ================================================================ komentarze do wpisów rejestrów (lib/log-access)
     Każdy resolver powtarza dokładnie bramkę trasy GET, która wypisuje rejestr — łącznie z tym, że
     wyłączony moduł „principal” chowa cały rejestr (server/index.js → modules.isEnabled). */
  const onModule = (db) => MOD.isEnabled(db, 'principal');

  /* Wiersz rejestru zdarzeń jest zamrożony (S-15), więc resolver oddaje tylko jego metrykę. */
  LA.register('audit', { label: 'Rejestr zdarzeń', roles: ['principal', 'dpo'], find: (db, user, entryId) => {
    if (!onModule(db)) return null;
    const a = db.get('audit', entryId);
    return a ? { id: a.id, at: a.at, action: a.action, entity: a.entity || null, entityId: a.entityId || null } : null;
  } });

  /* Zestawienie logowań rodziców: wierszem jest konto rodzica, więc jego identyfikator jest wpisem. */
  LA.register('parent-logins', { label: 'Logowania rodziców', roles: ['principal'], find: (db, user, entryId) => {
    if (!onModule(db)) return null;
    const u = db.get('users', entryId);
    return u && u.role === 'parent' ? { id: u.id, login: u.login, name: D.userLabel(u) } : null;
  } });

  /* Dziennik specjalistów: wpis to specjalista („spec:”), jawny dokument wsparcia („doc:”) albo
     pieczęć notatki poufnej („note:”). Zwracamy wyłącznie metadane — tyle, ile widać w zestawieniu;
     treść notatki jest zaszyfrowana kluczem autora i nie przechodzi tędy nawet przypadkiem. */
  LA.register('specialist-log', { label: 'Dziennik specjalistów', roles: ['principal'], find: (db, user, entryId) => {
    if (!onModule(db)) return null;
    const m = /^(spec|doc|note):(.+)$/.exec(String(entryId)); if (!m) return null;
    if (m[1] === 'spec') { const u = db.get('users', m[2]); return u && SPECIALIST_ROLES.includes(u.role) ? { id: entryId, userId: u.id, name: D.userLabel(u), role: u.role } : null; }
    if (m[1] === 'note') { const n = db.get('confidentialNotes', m[2]); return n ? { id: entryId, noteId: n.id, at: n.at || n.createdAt || null, sealed: true } : null; }
    const d = db.get('supportDocuments', m[2]);
    if (d) return d.confidential || d.protected ? null : { id: entryId, docId: d.id, kind: d.kind || d.type || 'dokument' };
    const w = db.get('wopfu', m[2]); if (w) return { id: entryId, docId: w.id, kind: 'WOPFU' };
    const ip = db.get('ipet', m[2]); return ip ? { id: entryId, docId: ip.id, kind: 'IPET' } : null;
  } });

  /* ================================================================ 3.3.12 komunikat globalny (sessionExtras + ack) */
  app.sessionExtras.push((ctx) => {
    try {
      const u = ctx.user; if (!u) return {};
      const aud = audienceOf(u);
      const a = ctx.db.col('announcements').filter((x) => x.requiresAck && (x.audience || []).includes(aud) && !(x.ackBy || {})[u.id] && !x.withdrawn)
        .sort((x, y) => (y.at || '').localeCompare(x.at || ''))[0];
      return a ? { pendingAnnouncement: { id: a.id, title: a.title, body: a.body, at: a.at, by: D.userLabel(ctx.db.get('users', a.byUserId)) } } : {};
    } catch (e) { return {}; }
  });

  r.post('/api/announcements', (ctx) => {
    const b = ctx.body || {};
    if (!String(b.title || '').trim() || !String(b.body || '').trim()) throw httpError(400, 'Komunikat musi mieć tytuł i treść.', { code: 'empty' });
    const audience = Array.isArray(b.audience) && b.audience.length ? b.audience.filter((x) => ['parent', 'staff', 'student'].includes(x)) : ['parent', 'staff'];
    /* autor komunikatu ma go potwierdzony z urzędu — dyrektor nie blokuje sobie własnych widoków */
    const row = ctx.db.insert('announcements', { title: String(b.title).trim(), body: String(b.body).trim(), requiresAck: b.requiresAck !== false, audience, byUserId: ctx.user.id, at: now(), ackBy: { [ctx.user.id]: now() }, attachments: b.attachments || [] });
    let sent = 0;
    for (const u of ctx.db.col('users')) { if (!audience.includes(audienceOf(u)) || u.blocked) continue; D.notify(ctx.db, u.id, 'announcement', `Komunikat dyrekcji: ${row.title}`, { link: '/' }); sent++; }
    row.recipients = sent; ctx.db.save();
    ctx.audit({ action: 'announcement_published', entity: 'announcements', entityId: row.id, after: { title: row.title, audience, requiresAck: row.requiresAck, recipients: sent } });
    return row;
  }, { roles: ['principal'] });

  r.post('/api/announcements/:id/ack', (ctx) => {
    const a = ctx.db.get('announcements', ctx.params.id); if (!a) throw httpError(404, 'Nie ma takiego komunikatu.');
    a.ackBy = a.ackBy || {};
    if (!a.ackBy[ctx.user.id]) { a.ackBy[ctx.user.id] = now(); ctx.db.save(); ctx.audit({ action: 'announcement_acknowledged', entity: 'announcements', entityId: a.id, after: { userId: ctx.user.id, at: a.ackBy[ctx.user.id] } }); }
    return { ok: true, at: a.ackBy[ctx.user.id] };
  });

  const ackStats = (db, a) => {
    const audienceUsers = db.col('users').filter((u) => (a.audience || []).includes(audienceOf(u)) && !u.blocked);
    const acked = audienceUsers.filter((u) => (a.ackBy || {})[u.id]);
    const byRole = {};
    for (const u of audienceUsers) { const k = audienceOf(u); byRole[k] = byRole[k] || { total: 0, acked: 0 }; byRole[k].total++; if ((a.ackBy || {})[u.id]) byRole[k].acked++; }
    return { audienceCount: audienceUsers.length, ackedCount: acked.length, percent: audienceUsers.length ? Math.round((acked.length / audienceUsers.length) * 1000) / 10 : null, byRole,
      acked: acked.map((u) => ({ userId: u.id, name: D.userLabel(u), role: u.role, at: a.ackBy[u.id] })).sort((x, y) => (y.at || '').localeCompare(x.at || '')),
      pending: audienceUsers.filter((u) => !(a.ackBy || {})[u.id]).map((u) => ({ userId: u.id, name: D.userLabel(u), role: u.role })) };
  };

  r.get('/api/announcements', (ctx) => {
    const all = ctx.db.col('announcements').slice().sort((a, b) => (b.at || '').localeCompare(a.at || ''));
    if (ctx.user.role === 'principal') return { announcements: all.map((a) => Object.assign({}, a, { byName: D.userLabel(ctx.db.get('users', a.byUserId)), stats: ackStats(ctx.db, a) })) };
    const aud = audienceOf(ctx.user);
    return { announcements: all.filter((a) => (a.audience || []).includes(aud)).map((a) => ({ id: a.id, title: a.title, body: a.body, at: a.at, requiresAck: a.requiresAck, acked: !!(a.ackBy || {})[ctx.user.id] })) };
  });

  r.get('/api/announcements/:id/acks', (ctx) => {
    const a = ctx.db.get('announcements', ctx.params.id); if (!a) throw httpError(404, 'Nie ma takiego komunikatu.');
    return Object.assign({ id: a.id, title: a.title, at: a.at, requiresAck: a.requiresAck, audience: a.audience }, ackStats(ctx.db, a));
  }, { roles: ['principal'] });

  /* ================================================================ 3.3.8 audyt kompletności wpisów */
  r.get('/api/principal/completeness', (ctx) => {
    const today = D.today(ctx.db);
    const to = (ctx.query.to || addDays(today, -1)).slice(0, 10);
    const from = (ctx.query.from || addDays(to, -6)).slice(0, 10);
    const classId = ctx.query.classId || null;
    const lessons = ctx.db.col('lessons').filter((l) => l.date >= from && l.date <= to && l.date < today && l.status !== 'cancelled' && (!classId || l.classId === classId));
    /* REL-01: jeden przebieg po frekwencji na żądanie zamiast filtrowania całej kolekcji przy każdej lekcji.
       Wcześniej audyt kompletności był O(lekcje × frekwencja) i przy semestralnym oknie blokował cały proces. */
    const audited = new Set(lessons.map((l) => l.id));
    const entriesByLesson = new Map();
    for (const a of ctx.db.col('attendance')) { if (a.draft || !audited.has(a.lessonId)) continue; entriesByLesson.set(a.lessonId, (entriesByLesson.get(a.lessonId) || 0) + 1); }
    const expectedByRoster = new Map();               // klasa|grupa → liczba uczniów na lekcji
    const userCache = new Map(); const classCache = new Map(); const subjectCache = new Map();
    const cached = (map, col, idv) => { if (!map.has(idv)) map.set(idv, ctx.db.get(col, idv)); return map.get(idv); };
    const byTeacher = new Map(); const rows = [];
    let missingTopic = 0, missingAttendance = 0;
    for (const l of lessons) {
      /* Lista uczniów lekcji zależy też od DNIA (uczeń przyjęty w trakcie roku, uczeń wypisany):
         klucz bez daty sprawiał, że cały tydzień dostawał liczebność pierwszej napotkanej lekcji,
         a audyt raportował „12 z 13 wpisów” dla dni, w których uczniów było dwunastu. */
      const rosterKey = l.classId + '|' + (l.groupId || '') + '|' + l.date;
      if (!expectedByRoster.has(rosterKey)) expectedByRoster.set(rosterKey, S.studentsOfLesson(ctx.db, l).length);
      const expected = expectedByRoster.get(rosterKey);
      const entries = entriesByLesson.get(l.id) || 0;
      const noTopic = !l.topic || !String(l.topic).trim();
      const noAtt = expected > 0 && entries === 0;
      const partial = expected > 0 && entries > 0 && entries < expected;
      if (!noTopic && !noAtt && !partial) continue;
      const responsibleId = l.substituteTeacherId || l.teacherId; const t = cached(userCache, 'users', responsibleId);
      const cls = cached(classCache, 'classes', l.classId);
      if (noTopic) missingTopic++; if (noAtt || partial) missingAttendance++;
      const row = { lessonId: l.id, date: l.date, lessonNo: l.lessonNo, classId: l.classId, className: cls ? cls.name : l.classId, subjectId: l.subjectId, subjectName: (cached(subjectCache, 'subjects', l.subjectId) || {}).name || l.subjectId, teacherId: responsibleId, teacherName: D.userLabel(t), missingTopic: noTopic, missingAttendance: noAtt, partialAttendance: partial, entries, expected };
      rows.push(row);
      const key = responsibleId + '|' + l.classId;
      const g = byTeacher.get(key) || { teacherId: responsibleId, teacherName: D.userLabel(t), classId: l.classId, className: row.className, missingTopic: 0, missingAttendance: 0, lessons: 0, subjects: [] };
      if (noTopic) g.missingTopic++; if (noAtt || partial) g.missingAttendance++; g.lessons++;
      if (!g.subjects.includes(row.subjectName)) g.subjects.push(row.subjectName);
      byTeacher.set(key, g);
    }
    const groups = [...byTeacher.values()].sort((a, b) => (b.missingTopic + b.missingAttendance) - (a.missingTopic + a.missingAttendance) || a.className.localeCompare(b.className, 'pl'));
    const classesAudited = [...new Set(lessons.map((l) => l.classId))];
    return { from, to, lessonsChecked: lessons.length, totals: { missingTopic, missingAttendance, lessonsWithGaps: rows.length, classes: classesAudited.length, teachers: new Set(groups.map((g) => g.teacherId)).size }, groups, rows: rows.sort((a, b) => a.date.localeCompare(b.date) || a.lessonNo - b.lessonNo) };
  }, { roles: ['principal'] });

  /* ================================================================ 3.3.9 realizacja podstawy programowej */
  r.get('/api/principal/curriculum', (ctx) => {
    const cfg = ctx.db.data.config; const today = D.today(ctx.db);
    const semId = +(ctx.query.semester || D.semesterOf(ctx.db, today));
    const sem = D.semester(ctx.db, semId); if (!sem) throw httpError(400, 'Nie ma takiego semestru.');
    const to = today < sem.to ? today : sem.to;
    let elapsed = 0, total = 0;
    for (let d = sem.from; d <= sem.to; d = addDays(d, 1)) { if (!isSchoolDay(cfg, d)) continue; total++; if (d <= to) elapsed++; }
    const expectedPercent = total ? Math.round((elapsed / total) * 1000) / 10 : 0;
    const rows = [];
    /* REL-01 (ten sam kształt): plan, lekcje i podstawa programowa indeksowane raz na żądanie
       zamiast pełnego filtra kolekcji przy każdej parze oddział × przedmiot. */
    const subjectsByClass = new Map();
    for (const t of ctx.db.col('timetable')) { let v = subjectsByClass.get(t.classId); if (!v) subjectsByClass.set(t.classId, v = new Set()); v.add(t.subjectId); }
    const lessonsByClassSubject = new Map();
    for (const l of ctx.db.col('lessons')) {
      if (l.status === 'cancelled' || l.date < sem.from || l.date > to) continue;
      const k = l.classId + '|' + l.subjectId; let v = lessonsByClassSubject.get(k); if (!v) lessonsByClassSubject.set(k, v = []); v.push(l);
    }
    const curriculumBySubjectLevel = new Map();
    for (const i of ctx.db.col('curriculum')) { const k = i.subjectId + '|' + i.level; let v = curriculumBySubjectLevel.get(k); if (!v) curriculumBySubjectLevel.set(k, v = []); v.push(i); }
    for (const cls of ctx.db.col('classes')) {
      const subjects = [...(subjectsByClass.get(cls.id) || [])];
      for (const subjectId of subjects) {
        const items = curriculumBySubjectLevel.get(subjectId + '|' + cls.level) || [];
        if (!items.length) continue;
        const plannedHours = items.reduce((s, i) => s + (i.hours || 0), 0);
        const lessons = lessonsByClassSubject.get(cls.id + '|' + subjectId) || [];
        const done = lessons.filter((l) => (l.curriculumItemIds || []).length > 0);
        const covered = new Set(); done.forEach((l) => (l.curriculumItemIds || []).forEach((i) => covered.add(i)));
        const percent = plannedHours ? Math.round((done.length / plannedHours) * 1000) / 10 : null;
        rows.push({ classId: cls.id, className: cls.name, level: cls.level, subjectId, subjectName: (ctx.db.get('subjects', subjectId) || {}).name || subjectId,
          plannedHours, doneHours: done.length, heldLessons: lessons.length, percent, expectedPercent, behind: percent != null && percent + 5 < expectedPercent,
          itemsTotal: items.length, itemsCovered: covered.size,
          items: items.map((i) => ({ id: i.id, code: i.code, title: i.title, hours: i.hours, covered: covered.has(i.id), lessons: done.filter((l) => (l.curriculumItemIds || []).includes(i.id)).length })) });
      }
    }
    rows.sort((a, b) => (a.percent == null ? 999 : a.percent) - (b.percent == null ? 999 : b.percent));
    return { semester: semId, from: sem.from, to, expectedPercent, schoolDays: { elapsed, total }, rows };
  }, { roles: ['principal'] });

  /* ================================================================ 3.3.10 unieważnienie oceny klasyfikacyjnej */
  r.post('/api/principal/grades/:id/invalidate', (ctx) => {
    const g = ctx.db.get('grades', ctx.params.id); if (!g) throw httpError(404, 'Nie ma takiej oceny.');
    const b = ctx.body || {};
    if (!['midterm', 'final'].includes(g.kind)) throw httpError(400, 'Unieważnić można tylko zatwierdzoną ocenę klasyfikacyjną (śródroczną lub roczną).', { code: 'not_classification' });
    if (g.deleted) throw httpError(409, 'Ta ocena została już unieważniona.', { code: 'already_invalidated' });
    const parsed = D.parseGrade(b.value, ctx.db.data.config);
    if (!parsed || parsed.value == null) throw httpError(400, 'Podaj ocenę z egzaminu sprawdzającego (1–6).', { code: 'bad_grade' });
    if (!String(b.protocolNo || '').trim()) throw httpError(400, 'Podaj numer protokołu komisji.', { code: 'no_protocol' });
    const minutes = b.minutes || null;
    if (!minutes || !minutes.dataUrl) throw httpError(400, 'Załącz protokół z posiedzenia komisji (skan).', { code: 'no_minutes' });
    if (!String(b.reason || '').trim()) throw httpError(400, 'Podaj powód unieważnienia — trafi do rejestru audytowego.', { code: 'no_reason' });
    const before = Object.assign({}, g);
    Object.assign(g, { deleted: true, deletedReason: String(b.reason).trim(), invalidated: true, invalidatedBy: ctx.user.id, invalidatedAt: now(), appealProtocolNo: String(b.protocolNo).trim() });
    const fresh = ctx.db.insert('grades', {
      studentId: g.studentId, subjectId: g.subjectId, classId: g.classId, categoryId: null, categoryName: 'egzamin sprawdzający', weight: g.weight || 1, color: g.color || 'cat-1',
      value: parsed.text, points: null, maxPoints: null, percent: null, comment: `Ocena z egzaminu sprawdzającego, protokół komisji nr ${String(b.protocolNo).trim()}`,
      retakeOfId: null, makeup: false, lessonId: null, date: (b.examDate || D.today(ctx.db)).slice(0, 10), teacherId: ctx.user.id, kind: g.kind, semester: g.semester,
      countsInAverage: false, locked: true, deleted: false, deletedReason: null,
      appeal: { ofGradeId: g.id, protocolNo: String(b.protocolNo).trim(), minutes: { name: minutes.name || 'protokol-komisji.pdf', dataUrl: minutes.dataUrl, size: minutes.size || null }, decidedBy: ctx.user.id, at: now(), basis: 'art. 44n ustawy o systemie oświaty' }
    });
    ctx.db.save();
    ctx.audit({ action: 'classification_grade_invalidated', entity: 'grades', entityId: g.id, before: { value: before.value, kind: before.kind, deleted: before.deleted }, after: { value: fresh.value, kind: fresh.kind, newGradeId: fresh.id, protocolNo: fresh.appeal.protocolNo }, reason: String(b.reason).trim() });
    const st = ctx.db.get('students', g.studentId);
    const subjName = (ctx.db.get('subjects', g.subjectId) || {}).name || g.subjectId;
    const text = `Ocena klasyfikacyjna z przedmiotu ${subjName} została unieważniona przez dyrektora; po egzaminie sprawdzającym wpisano ocenę ${fresh.value} (protokół nr ${fresh.appeal.protocolNo}).`;
    D.notifyParentsOf(ctx.db, g.studentId, 'grade', `${st ? st.firstName + ' ' + st.lastName + ': ' : ''}${text}`, { link: '/oceny' });
    const su = ctx.db.one('users', (u) => u.studentId === g.studentId); if (su) D.notify(ctx.db, su.id, 'grade', text, { link: '/oceny' });
    return { invalidated: Object.assign({}, g), grade: fresh };
  }, { roles: ['principal'] });

  /* lista zatwierdzonych ocen klasyfikacyjnych — źródło wyboru dla wniosku komisji odwoławczej */
  r.get('/api/principal/classification-grades', (ctx) => ({
    grades: ctx.db.col('grades').filter((g) => ['midterm', 'final'].includes(g.kind) && !g.deleted).map((g) => {
      const st = ctx.db.get('students', g.studentId);
      return { id: g.id, studentId: g.studentId, studentName: D.studentLabel(st), classId: st ? st.classId : g.classId, subjectId: g.subjectId, subjectName: (ctx.db.get('subjects', g.subjectId) || {}).name || g.subjectId, value: g.value, kind: g.kind, semester: g.semester, date: g.date };
    }).sort((a, b) => a.classId.localeCompare(b.classId, 'pl') || a.studentName.localeCompare(b.studentName, 'pl'))
  }), { roles: ['principal'] });

  /* ================================================================ 3.3.11 powierzenie p.o. wychowawcy */
  r.post('/api/principal/classes/:id/acting-homeroom', (ctx) => {
    const cls = ctx.db.get('classes', ctx.params.id); if (!cls) throw httpError(404, 'Nie ma takiej klasy.');
    const b = ctx.body || {}; const t = ctx.db.get('users', b.teacherId);
    if (!t || !['teacher', 'principal', 'supportTeacher'].includes(t.role)) throw httpError(400, 'Wskaż nauczyciela, któremu powierzasz obowiązki.', { code: 'no_teacher' });
    if (t.id === cls.homeroomTeacherId) throw httpError(400, 'To już wychowawca tej klasy.', { code: 'same_teacher' });
    const from = (b.from || D.today(ctx.db)).slice(0, 10), to = (b.to || '').slice(0, 10);
    if (!to || to < from) throw httpError(400, 'Podaj datę zakończenia powierzenia (nie wcześniejszą niż początek).', { code: 'bad_range' });
    const before = { actingHomeroomTeacherId: cls.actingHomeroomTeacherId || null, actingFrom: cls.actingFrom || null, actingTo: cls.actingTo || null };
    Object.assign(cls, { actingHomeroomTeacherId: t.id, actingFrom: from, actingTo: to, actingReason: b.reason || null, actingByUserId: ctx.user.id });
    t.actingHomeroomOf = cls.id; ctx.db.save();
    ctx.audit({ action: 'acting_homeroom_assigned', entity: 'classes', entityId: cls.id, before, after: { actingHomeroomTeacherId: t.id, actingFrom: from, actingTo: to }, reason: b.reason || null });
    D.notify(ctx.db, t.id, 'role', `Powierzono Ci obowiązki wychowawcy klasy ${cls.name} na okres ${from} – ${to}. Odpowiedzialność wychowawcy pozostaje przy ${D.userLabel(ctx.db.get('users', cls.homeroomTeacherId))}.`, { link: '/wychowawca' });
    if (cls.homeroomTeacherId) D.notify(ctx.db, cls.homeroomTeacherId, 'role', `Na czas Twojej nieobecności obowiązki wychowawcy klasy ${cls.name} pełni ${D.userLabel(t)} (${from} – ${to}).`, { link: '/wychowawca' });
    return actingView(ctx.db, cls);
  }, { roles: ['principal'] });

  r.delete('/api/principal/classes/:id/acting-homeroom', (ctx) => {
    const cls = ctx.db.get('classes', ctx.params.id); if (!cls) throw httpError(404, 'Nie ma takiej klasy.');
    const before = { actingHomeroomTeacherId: cls.actingHomeroomTeacherId || null, actingFrom: cls.actingFrom || null, actingTo: cls.actingTo || null };
    const prev = cls.actingHomeroomTeacherId ? ctx.db.get('users', cls.actingHomeroomTeacherId) : null;
    if (prev && prev.actingHomeroomOf === cls.id) delete prev.actingHomeroomOf;
    Object.assign(cls, { actingHomeroomTeacherId: null, actingFrom: null, actingTo: null, actingReason: null }); ctx.db.save();
    ctx.audit({ action: 'acting_homeroom_revoked', entity: 'classes', entityId: cls.id, before, after: { actingHomeroomTeacherId: null } });
    return actingView(ctx.db, cls);
  }, { roles: ['principal'] });

  function actingView(db, cls) {
    const home = db.get('users', cls.homeroomTeacherId), acting = cls.actingHomeroomTeacherId ? db.get('users', cls.actingHomeroomTeacherId) : null;
    return { classId: cls.id, className: cls.name, homeroomTeacherId: cls.homeroomTeacherId, homeroomTeacherName: D.userLabel(home),
      actingHomeroomTeacherId: cls.actingHomeroomTeacherId || null, actingHomeroomTeacherName: acting ? D.userLabel(acting) : null, actingFrom: cls.actingFrom || null, actingTo: cls.actingTo || null,
      responsibility: 'Odpowiedzialność prawna wychowawcy (klasyfikacja, dokumentacja) pozostaje przy wychowawcy wskazanym w arkuszu organizacyjnym; p.o. prowadzi bieżące sprawy klasy.' };
  }

  r.get('/api/principal/classes', (ctx) => ({ classes: ctx.db.col('classes').map((c) => Object.assign(actingView(ctx.db, c), { students: (c.studentIds || []).length, level: c.level })) }), { roles: ['principal'] });

  /* ================================================================ 3.3.13 dziennik psychologa i pedagoga */
  r.get('/api/principal/specialist-log', (ctx) => {
    const today = D.today(ctx.db);
    const to = (ctx.query.to || today).slice(0, 10), from = (ctx.query.from || addDays(to, -30)).slice(0, 10);
    const inRange = (d) => !!d && String(d).slice(0, 10) >= from && String(d).slice(0, 10) <= to;
    /* dziennik zajęć specjalistów: wpisy zbiorcze (z zagnieżdżonymi spotkaniami) i pojedyncze sesje */
    const sources = ['otherActivities', 'supportSessions', 'speechSessions', 'consultations', 'counselorLog'].flatMap((c) => ctx.db.col(c));
    const ownerOf = (x) => x.specialistId || x.userId || x.byUserId || x.teacherId || x.authorId || null;
    const specialists = ctx.db.col('users').filter((u) => SPECIALIST_ROLES.includes(u.role)).map((u) => {
      const byKind = {}; const students = new Set(); let entries = 0, consultations = 0, minutes = 0;
      const add = (kind, when, mins, studentIds, text) => {
        if (!inRange(when)) return;
        entries++; byKind[kind] = (byKind[kind] || 0) + 1; minutes += mins || 45;
        (studentIds || []).forEach((x) => students.add(x));
        if (/konsultac|spotkan|rozmow|porad|interwencj/i.test(kind + ' ' + (text || ''))) consultations++;
      };
      for (const a of sources) {
        const owner = ownerOf(a); const kind = a.kind || a.type || a.form || a.name || 'zajęcia';
        const studentIds = a.studentIds || (a.studentId ? [a.studentId] : []);
        if (Array.isArray(a.sessions) && a.sessions.length) {
          for (const ses of a.sessions) { if ((ses.byUserId || owner) !== u.id) continue; add(kind, ses.date || ses.at, ses.minutes, studentIds, ses.topic || ses.note); }
          continue;
        }
        if (owner !== u.id) continue;
        add(kind, a.date || a.at, a.minutes, studentIds, a.topic || a.name || a.note);
      }
      return { userId: u.id, entryId: 'spec:' + u.id, name: D.userLabel(u), role: u.role, activities: entries, consultations, students: students.size, byKind, hours: Math.round((minutes / 60) * 10) / 10 };
    });
        /* dokumenty wsparcia: tylko jawne (opinie, WOPFU, IPET); dokumenty chronione pozostają u specjalisty */
    const docs = ctx.db.col('supportDocuments').filter((d) => !d.confidential && !d.protected)
      .map((d) => ({ id: d.id, kind: d.kind || d.type || 'dokument', title: d.title || d.name || 'Dokument wsparcia', studentId: d.studentId || null, at: d.date || d.at || d.createdAt || null, authorId: d.authorId || d.byUserId || null, authorName: D.userLabel(ctx.db.get('users', d.authorId || d.byUserId)) }))
      .concat(ctx.db.col('wopfu').map((d) => ({ id: d.id, kind: 'WOPFU', title: 'Wielospecjalistyczna ocena poziomu funkcjonowania ucznia', studentId: d.studentId, at: d.createdAt || null, authorId: d.byUserId || null, authorName: D.userLabel(ctx.db.get('users', d.byUserId)) })))
      .concat(ctx.db.col('ipet').map((d) => ({ id: d.id, kind: 'IPET', title: 'Indywidualny program edukacyjno-terapeutyczny', studentId: d.studentId, at: d.createdAt || null, authorId: d.byUserId || null, authorName: D.userLabel(ctx.db.get('users', d.byUserId)) })));
    docs.forEach((d) => { d.entryId = 'doc:' + d.id; });                      // identyfikator wpisu dla komentarzy
    const protectedDocs = ctx.db.col('supportDocuments').filter((d) => d.confidential || d.protected).length;
    /* Notatki poufne: wyłącznie metadane pieczęci — treść jest zaszyfrowana kluczem specjalisty i dyrektor jej nie odczytuje. */
    const notes = ctx.db.col('confidentialNotes').map((n) => {
      const env = n.envelope || n.encrypted || n.cipher || {};
      const readerIds = n.readerIds || n.readers || Object.keys(env.wrappedKeys || {});
      return { id: n.id, entryId: 'note:' + n.id, at: n.at || n.createdAt || null, authorId: n.authorId || n.byUserId || null, authorName: D.userLabel(ctx.db.get('users', n.authorId || n.byUserId)), kind: n.kind || 'notatka', title: n.title || 'Notatka poufna',
        sealed: true, alg: env.alg || 'AES-256-GCM+RSA-OAEP', readers: readerIds.length,
        readerNames: readerIds.map((uid) => D.userLabel(ctx.db.get('users', uid))).filter(Boolean).join(', '),
        note: 'Dyrektor widzi statystyki i metadane pieczęci, bez treści notatki. Odczyt wymaga klucza autora.' };
    });
    const totals = { activities: specialists.reduce((s, x) => s + x.activities, 0), consultations: specialists.reduce((s, x) => s + x.consultations, 0), hours: Math.round(specialists.reduce((s, x) => s + x.hours, 0) * 10) / 10, students: specialists.reduce((s, x) => s + x.students, 0), documents: docs.length, protectedDocuments: protectedDocs, sealedNotes: notes.length };
    return { from, to, specialists, documents: docs, notes, totals,
      comments: countsFor(ctx.db, ctx.user, 'specialist-log', specialists.map((s) => s.entryId).concat(docs.map((d) => d.entryId), notes.map((n) => n.entryId))),
      access: 'Zakres dostępu dyrektora: statystyki konsultacji, harmonogram i dokumentacja wsparcia (WOPFU, IPET). Treści notatek poufnych nie obejmuje.' };
  }, { roles: ['principal'] });

  r.get('/api/principal/specialist-log/notes/:id', (ctx) => {
    const n = ctx.db.get('confidentialNotes', ctx.params.id);
    ctx.audit({ action: 'confidential_note_access_denied', entity: 'confidentialNotes', entityId: ctx.params.id, after: { role: ctx.user.role }, reason: 'Próba odczytu treści notatki poufnej przez dyrektora' });
    throw httpError(403, 'Treść notatki poufnej jest zaszyfrowana kluczem specjalisty i nie jest dostępna dla dyrektora. Widoczne są wyłącznie metadane pieczęci.', { code: 'sealed', exists: !!n });
  }, { roles: ['principal'] });

  /* ================================================================ 3.3.14 obciążenie sprawdzianami */
  r.get('/api/principal/test-load', (ctx) => {
    const cfg = ctx.db.data.config; const today = D.today(ctx.db);
    const weeks = Math.min(12, Math.max(1, +(ctx.query.weeks || 4)));
    const to = (ctx.query.to || today).slice(0, 10); const from = addDays(mondayOf(to), -7 * (weeks - 1));
    const limits = cfg.testLimits || { perDay: 1, perWeek: 3 };
    const tests = ctx.db.col('tests').filter((t) => t.date >= from && t.date <= to);
    const rows = [];
    for (const cls of ctx.db.col('classes')) {
      const mine = tests.filter((t) => t.classId === cls.id && (t.kind || 'sprawdzian') === 'sprawdzian');
      const days = {}, wks = {};
      for (const t of mine) { days[t.date] = (days[t.date] || 0) + 1; const w = mondayOf(t.date); wks[w] = (wks[w] || 0) + 1; }
      const overDays = Object.entries(days).filter(([, n]) => n > limits.perDay).map(([date, count]) => ({ date, count, limit: limits.perDay }));
      const overWeeks = Object.entries(wks).filter(([, n]) => n > limits.perWeek).map(([wfrom, count]) => ({ from: wfrom, to: addDays(wfrom, 6), count, limit: limits.perWeek }));
      if (!mine.length) continue;
      rows.push({ classId: cls.id, className: cls.name, tests: mine.length, maxPerDay: Math.max(0, ...Object.values(days)), maxPerWeek: Math.max(0, ...Object.values(wks)),
        overDays, overWeeks, violations: overDays.length + overWeeks.length, exceeded: overDays.length + overWeeks.length > 0,
        detail: mine.map((t) => ({ id: t.id, date: t.date, subjectId: t.subjectId, subjectName: (ctx.db.get('subjects', t.subjectId) || {}).name || t.subjectId, teacherName: D.userLabel(ctx.db.get('users', t.teacherId)), scope: t.scope })).sort((a, b) => a.date.localeCompare(b.date)) });
    }
    rows.sort((a, b) => b.violations - a.violations || b.maxPerWeek - a.maxPerWeek);
    return { from, to, weeks, limits, rows, totals: { classes: rows.length, exceeded: rows.filter((x) => x.exceeded).length, tests: tests.length } };
  }, { roles: ['principal'] });

  /* ================================================================ 3.3.15 zatwierdzenie wycieczki */
  r.get('/api/principal/trips', (ctx) => ({
    trips: ctx.db.col('trips').map((t) => Object.assign({}, t, { leaderName: D.userLabel(ctx.db.get('users', t.leaderId)), chaperoneNames: (t.chaperones || []).map((c) => D.userLabel(ctx.db.get('users', c.userId))), students: (t.studentIds || []).length }))
  }), { roles: ['principal'] });

  r.post('/api/principal/trips/:id/approve', (ctx) => {
    const trip = ctx.db.get('trips', ctx.params.id); if (!trip) throw httpError(404, 'Nie ma takiego planu wycieczki.');
    if (trip.status === 'approved') throw httpError(409, 'Ta wycieczka jest już zatwierdzona.', { code: 'already_approved' });
    if (trip.status === 'draft') throw httpError(400, 'Plan wycieczki nie został jeszcze złożony przez kierownika.', { code: 'not_submitted' });
    const before = { status: trip.status };
    const dates = []; for (let d = trip.from; d <= trip.to; d = addDays(d, 1)) dates.push(d);
    /* uczestnicy: status „w” (wycieczka) na wszystkich lekcjach w dniach wyjazdu — nie obniża frekwencji */
    let marked = 0;
    const participants = trip.studentIds && trip.studentIds.length ? trip.studentIds : ctx.db.col('students').filter((s) => (trip.classIds || []).includes(s.classId)).map((s) => s.id);
    /* REL-01 (ten sam kształt): lekcje i frekwencja indeksowane raz, a nie przeszukiwane
       dla każdego uczestnika i każdego dnia wyjazdu z osobna. */
    const dateSet = new Set(dates);
    const lessonsByClassDate = new Map();
    for (const l of ctx.db.col('lessons')) {
      if (l.status === 'cancelled' || !dateSet.has(l.date)) continue;
      const k = l.classId + '|' + l.date; let v = lessonsByClassDate.get(k); if (!v) lessonsByClassDate.set(k, v = []); v.push(l);
    }
    const rosterOfLesson = new Map();
    const attendanceByKey = new Map();
    for (const a of ctx.db.col('attendance')) attendanceByKey.set(a.lessonId + '|' + a.studentId, a);
    for (const sid of participants) {
      const st = ctx.db.get('students', sid); if (!st) continue;
      for (const date of dates) {
        for (const l of lessonsByClassDate.get(st.classId + '|' + date) || []) {
          if (!rosterOfLesson.has(l.id)) rosterOfLesson.set(l.id, new Set(S.studentsOfLesson(ctx.db, l)));
          if (!rosterOfLesson.get(l.id).has(sid)) continue;
          const ex = attendanceByKey.get(l.id + '|' + sid);
          if (ex) { ex.status = 'w'; ex.byUserId = ctx.user.id; ex.at = now(); ex.draft = false; ex.tripId = trip.id; }
          else { const fresh = { id: `att_trip_${trip.id}_${l.id}_${sid}`, lessonId: l.id, studentId: sid, date: l.date, lessonNo: l.lessonNo, classId: l.classId, subjectId: l.subjectId, status: 'w', minutes: 0, draft: false, byUserId: ctx.user.id, at: now(), excuseId: null, tripId: trip.id }; ctx.db.col('attendance').push(fresh); attendanceByKey.set(l.id + '|' + sid, fresh); }
          marked++;
        }
      }
      D.notifyParentsOf(ctx.db, sid, 'trip', `Wycieczka „${trip.name}” (${trip.from} – ${trip.to}) została zatwierdzona przez dyrektora. Uczeń ma na czas wyjazdu status „w” — nie obniża on frekwencji.`, { link: '/wycieczki' });
    }
    /* opiekunowie i kierownik: arkusz zastępstw z automatycznie dobraną obsadą */
    const staffIds = [...new Set([trip.leaderId].concat((trip.chaperones || []).map((c) => c.userId)).filter(Boolean))];
    const created = [];
    for (const uid of staffIds) {
      const lessons = ctx.db.col('lessons').filter((l) => l.teacherId === uid && l.date >= trip.from && l.date <= trip.to && l.status !== 'cancelled');
      if (!lessons.length) continue;
      const row = ctx.db.insert('substitutions', { teacherId: uid, from: trip.from, to: trip.to, reason: `Opieka nad wycieczką: ${trip.name}`, byUserId: ctx.user.id, tripId: trip.id, assignments: [], published: false, publishedAt: null, publishAt: null });
      row.assignments = lessons.map((l) => {
        const best = S.rankCandidates(ctx.db, l, uid).filter((c) => !staffIds.includes(c.teacherId))[0];
        return { lessonId: l.id, substituteTeacherId: best ? best.teacherId : null, kind: 'sub', combinedWithLessonId: null, paid: true, room: l.room, tier: best ? best.tier : null, reasonText: best ? best.why : 'brak wolnego nauczyciela — wymaga decyzji dyrektora' };
      });
      ctx.db.save();
      created.push({ id: row.id, teacherId: uid, teacherName: D.userLabel(ctx.db.get('users', uid)), lessons: row.assignments.length, filled: row.assignments.filter((a) => a.substituteTeacherId).length });
      D.notify(ctx.db, uid, 'trip', `Wycieczka „${trip.name}” zatwierdzona. Przygotowano zastępstwa za ${row.assignments.length} Twoich lekcji — do publikacji przez dyrekcję.`, { link: '/dyrekcja' });
    }
    Object.assign(trip, { status: 'approved', approvedBy: ctx.user.id, approvedAt: now(), approvalNote: (ctx.body || {}).reason || null, substitutionIds: created.map((c) => c.id) });
    ctx.db.save();
    ctx.audit({ action: 'trip_approved', entity: 'trips', entityId: trip.id, before, after: { status: 'approved', attendanceMarked: marked, substitutions: created.length }, reason: (ctx.body || {}).reason || null });
    return { trip, attendanceMarked: marked, participants: participants.length, days: dates, substitutions: created };
  }, { roles: ['principal'] });

  /* ================================================================ 3.3.16 rejestr audytowy */
  r.get('/api/principal/audit', (ctx) => {
    const q = ctx.query || {};
    /* REG-10 — `edit_or_delete` idzie teraz prosto do biblioteki (`lib/audit.js`), zamiast być
       tłumaczone na `action: null` i przefiltrowane jeszcze raz tutaj. Oba słowniki (regex
       `EDIT_OR_DELETE` i `kindOf` poniżej) rozpoznają te same słowa, więc filtr biblioteki
       i kolumna „rodzaj” odpowiadają tak samo; `kindOf` zostaje wyłącznie dla tej kolumny. */
    const entries = auditQuery(ctx.db, { ip: q.ip || null, userId: q.userId || null, from: q.from || null, to: q.to || null, action: q.action || null, entity: q.entity || null });
    const limit = Math.min(500, Math.max(1, +(q.limit || 100)));
    const kindOf = (a) => (/delete|remove|invalid|revert|forgotten|undone/.test(a.action) ? 'delete' : /update|edit|assign|change|patch|superseded/.test(a.action) ? 'edit' : /login|logout|session/.test(a.action) ? 'login' : /export|archive/.test(a.action) ? 'export' : /lock|block|denied|seal/.test(a.action) ? 'lock' : 'create');
    const rows = entries.slice(0, limit).map((a) => {
      const u = a.userId ? ctx.db.get('users', a.userId) : null;
      return { id: a.id, at: a.at, action: a.action, kind: kindOf(a), entity: a.entity, entityId: a.entityId, userId: a.userId, actor: u ? D.userLabel(u) : 'system', role: u ? u.role : null, ip: a.ip || null, reason: a.reason || null, before: a.before == null ? null : a.before, after: a.after == null ? null : a.after, client: a.client || null };
    });
    return { total: entries.length, shown: rows.length, filters: { ip: q.ip || '', userId: q.userId || '', from: q.from || '', to: q.to || '', action: q.action || '', entity: q.entity || '' },
      actions: [...new Set(ctx.db.col('audit').map((a) => a.action))].sort(), entities: [...new Set(ctx.db.col('audit').map((a) => a.entity).filter(Boolean))].sort(), rows,
      comments: countsFor(ctx.db, ctx.user, 'audit', rows.map((a) => a.id)) };
  }, { roles: ['principal', 'dpo'] });

  /* ================================================================ 3.3.17 roczny pakiet archiwalny z pieczęcią */
  /* R2 (raport Gemini #6/#13) — pieczęć kluczem szkoły zostaje jako dowód spójności, ale § 22 żąda
     podpisu, którego dziennik nie złoży: kwalifikowanego, pieczęci kwalifikowanej albo podpisu
     osobistego (podpis zaufany — pytanie do prawnika, docs/ARCHIVE.md). Dyrektor podpisuje NA
     ZEWNĄTRZ, więc zadaniem dziennika jest wydać jeden plik do podpisania i przyjąć z powrotem to,
     co wróciło. Budowa pakietu i minimalny zapis ZIP: server/lib/archive.js.

     Runda 3 zmienia trzy rzeczy i wszystkie trzy są konsekwencją jednego zdania: pakiet ma BYĆ
     dziennikiem, ma leżeć na dysku i ma się liczyć za podpisany tylko wtedy, gdy naprawdę jest.
       · D3-19/D3-20 — zawartość i filtr rocznika są w `server/lib/archive.js`;
       · R3-09/R3-13 — bajty (XML, wydruk, ZIP, podpis) leżą w `data/school/files/archives/<id>/`,
         a w wierszu zostaje `{ name, bytes, sha256, path }`; stary wiersz z base64 migruje przy
         pierwszym odczycie. Dzięki temu `GET …/package` oddaje gotowy plik zamiast składać ZIP od
         nowa, a dotknięcie wiersza nie przepisuje 5 MB;
       · S3-08/S3-13/H-9 — `signed` wyłącznie przy `digest-matched`, „przyjęty bez weryfikacji”
         jest osobną, audytowaną decyzją dyrektora, przebudowa podpisanego rocznika wymaga
         `rebuild` z uzasadnieniem i głośno unieważnia poprzedni podpis, a `DELETE` istnieje. */
  const AR = require('../lib/archive');
  const B = require('../lib/blobs');
  const fs = require('node:fs');
  const UP = require('../lib/uploads');
  /* Rok szkolny ma dokładnie jeden kształt: „2026/2027”. Grupy są potrzebne — z drugiej bierze się
     31 sierpnia, czyli koniec roku szkolnego, od którego § 22 liczy dziesięć dni. */
  const ARCHIVE_YEAR = /^(\d{4})\/(\d{4})$/;
  /** Ostatni pakiet danego rocznika (albo w ogóle, gdy rocznika nie podano). */
  function latestArchive(db, year) {
    const rows = db.col('archives').filter((a) => (year == null || String(a.year) === String(year)) && !a.superseded);
    return rows.length ? rows[rows.length - 1] : null;
  }
  /** Ostatni pakiet rocznika, który zamyka termin — także wtedy, gdy powstał już nowszy. */
  const signedArchive = (db, year) => db.col('archives').filter((a) => String(a.year) === String(year) && !a.superseded && AR.closesDeadline(a)).pop() || null;

  /**
   * Okno i termin z § 22.
   *
   * D3-22: § 22 liczy dziesięć dni od zakończenia **roku szkolnego**, a rok szkolny trwa do
   * **31 sierpnia** — nie do ostatniego dnia zajęć. Termin liczony od zakończenia zajęć był o dwa
   * miesiące za wczesny i zamykał pakiet przed sierpniowymi egzaminami poprawkowymi i przed radą,
   * która kończy rok. Dlatego:
   *   `from`     — koniec zajęć dydaktycznych: najwcześniejszy dzień, w którym pakiet ma sens;
   *   `yearEnd`  — koniec roku szkolnego (31 sierpnia): od niego liczy się termin i przypomnienia;
   *   `to`/`deadline` — `yearEnd` + `days` (10);
   *   `open`     — czy dziś mieści się między `from` a `to`.
   * Wszystko nadpisywalne przez `config.archiveWindow` (`from`, `yearEnd`, `to`, `days`, `basis`).
   * `status`: not-started → package-ready → signature-unverified → signed; po terminie bez podpisu
   * zamykającego — overdue.
   */
  function archiveWindow(db) {
    const cfg = db.data.config; const w = cfg.archiveWindow || {};
    const today = D.today(db);
    const year = String(cfg.year);
    const teachingEnd = w.from || cfg.semesters[cfg.semesters.length - 1].to;
    const m = ARCHIVE_YEAR.exec(year);
    const yearEnd = w.yearEnd || (m ? `${m[2]}-08-31` : teachingEnd);
    const days = w.days || 10;
    /* Szkoła może podać własny `to`, ale termin z § 22 nie może wypaść PRZED końcem roku, który
       certyfikuje. Taki zapis (a taki właśnie siedzi w zasiewie sprzed R3: koniec zajęć + 10 dni)
       jest pozostałością po liczeniu terminu od zakończenia zajęć — przeliczamy go z `yearEnd`. */
    const stored = w.to && w.to >= yearEnd ? w.to : null;
    const to = stored || addDays(yearEnd, days);
    const from = teachingEnd;
    const pkg = latestArchive(db, year);
    const closing = signedArchive(db, year);
    const signed = !!closing;
    const state = AR.signatureState(pkg || {});
    const status = signed ? 'signed' : today > to ? 'overdue' : state === 'stored-unverified' ? 'signature-unverified' : pkg ? 'package-ready' : 'not-started';
    return {
      from, teachingEnd, yearEnd, to, deadline: to, days, daysLeft: daysBetween(today, to),
      open: today >= from && today <= to, notYetOpen: today < from, today,
      /* D3-22/D3-42: jedna podstawa prawna, zawsze ta sama i zawsze poprawna. Cokolwiek szkoła
         wpisała sobie w `config.archiveWindow.basis`, jedzie obok jako notatka, a nie zamiast. */
      basis: 'Termin z § 22 rozporządzenia o dokumentacji przebiegu nauczania: 10 dni od zakończenia roku szkolnego (31 sierpnia).',
      schoolNote: w.basis || null,
      year, status, signed, signatureState: state, packageId: pkg ? pkg.id : null, signedPackageId: closing ? closing.id : null,
      signatureKinds: AR.SIGNATURE_KINDS, signedFiles: AR.SIGNED_FILES
    };
  }
  /** Przypomnienie dla dyrekcji w 3. i 8. dniu po zakończeniu roku szkolnego, dopóki termin nie zamknięty. */
  function remindArchive(db) {
    const w = archiveWindow(db);
    if (w.signed) return [];
    const out = [];
    for (const step of [3, 8]) {
      if (w.today < addDays(w.yearEnd, step)) continue;
      /* S3-08: plik, który niczego nie potwierdza, NIE ucisza przypomnienia — mówimy dlaczego. */
      const tail = w.signatureState === 'stored-unverified'
        ? ' Dołączony plik podpisu nie potwierdza tego pakietu („przyjęty, niezweryfikowany”) — dołącz właściwy podpis albo odnotuj przyjęcie bez weryfikacji z uzasadnieniem.'
        : '';
      const text = (w.daysLeft >= 0
        ? `Pakiet archiwalny dziennika ${w.year} nie jest jeszcze podpisany. Do ustawowego terminu (${w.deadline}) ${w.daysLeft === 0 ? 'został ostatni dzień' : 'zostało dni: ' + w.daysLeft}.`
        : `Minął ustawowy termin (${w.deadline}) zapisania i podpisania pakietu archiwalnego dziennika ${w.year}.`) + tail;
      for (const u of db.col('users')) {
        if (u.role !== 'principal' || u.blocked) continue;
        const n = D.notify(db, u.id, 'archive', text, { link: '/dyrekcja', push: false, dedupeKey: `archive-${w.year}-d${step}` });
        if (n) out.push(n);
      }
    }
    return out;
  }

  /* ---------------------------------------------------------------- bajty pakietu na dysku ------ */
  /** Opis pliku pakietu: `{ name, bytes, sha256, path }` albo `null`, gdy wiersz go nie ma. */
  const fileRef = (a, key) => ((a.files && a.files[key]) || null);
  /** Bajty składnika pakietu: z wiersza, gdy stary wiersz jeszcze je trzyma, inaczej z dysku. */
  function partBytes(db, a, key, inlineField) {
    if (inlineField && a[inlineField] != null) return Buffer.from(String(a[inlineField]), 'utf8');
    const ref = fileRef(a, key);
    if (!ref) throw httpError(410, `Pakiet ${a.year} nie ma już pliku „${key}” — odtwórz go z kopii zapasowej.`, { code: 'blob_missing', part: key });
    return B.get(db, ref);
  }
  /**
   * Odpowiedź pliku pakietu: strumieniem, gdy plik naprawdę leży na dysku, a bajtami, gdy wiersz jest
   * jeszcze sprzed R3 i niesie treść w sobie. Roczny pakiet dziennika idzie w dziesiątki megabajtów,
   * a proces jest jeden na całą szkołę — nie ma powodu wciągać go w całości do pamięci
   * (`server/index.js` obsługuje `{ __raw: true, stream }`).
   */
  function partResponse(db, a, key, inlineField, rest) {
    const ref = fileRef(a, key);
    const base = Object.assign({ __raw: true }, rest);
    if (!(inlineField && a[inlineField] != null) && ref && B.has(db, ref)) return Object.assign(base, { stream: B.stream(db, ref), bytes: ref.bytes });
    return Object.assign(base, { body: partBytes(db, a, key, inlineField) });
  }
  /**
   * Migracja wiersza sprzed R3: XML, wydruk, manifest, pieczęć i podpis siedziały w kolekcji jako
   * napisy i base64 (5,2 MB na wiersz, 11,8 MB z podpisem). Przy pierwszym odczycie zapisujemy je
   * na dysk i **kasujemy z wiersza**. Wywoływana z tras, które i tak piszą — nigdy z `…/verify`.
   * @returns {boolean} czy coś przeniesiono
   */
  function ensureBlobs(db, a) {
    if (!a) return false;
    const slug = AR.yearSlug(a.year);
    let moved = false;
    const files = Object.assign({}, a.files || {});
    if (a.xml != null && !files.xml) { files.xml = B.put(db, 'archives', a.id, `dziennik-${slug}.xml`, String(a.xml)); moved = true; }
    if (a.html != null && !files.html) { files.html = B.put(db, 'archives', a.id, `dziennik-${slug}.html`, String(a.html)); moved = true; }
    const pk = a.package || {};
    if (pk.manifestJson != null && !files.manifest) { files.manifest = B.put(db, 'archives', a.id, 'manifest.json', String(pk.manifestJson)); moved = true; }
    if (pk.sealJson != null && !files.seal) { files.seal = B.put(db, 'archives', a.id, 'seal.json', String(pk.sealJson)); moved = true; }
    if (!moved && !(a.signature && a.signature.contentBase64 != null)) return false;
    if (moved) {
      a.files = files;
      /* ZIP odtwarzamy ze składników (ten sam bajt w bajt) i zapisujemy jako pamięć podręczną (R3-13). */
      if (!files.zip) {
        const pkg = AR.buildArchivePackage(db, a.year, { at: a.at, xml: B.get(db, files.xml), html: B.get(db, files.html), manifestJson: B.get(db, files.manifest).toString('utf8'), sealJson: B.get(db, files.seal).toString('utf8') });
        a.files = Object.assign({}, a.files, { zip: B.put(db, 'archives', a.id, pkg.zipName, pkg.zip) });
        a.package = Object.assign({}, a.package || {}, { name: pkg.zipName, bytes: pkg.bytes, sha256: pkg.zipSha256, manifestSha256: pkg.manifestSha256, files: pkg.files, digests: pkg.digests, at: a.at });
      }
      delete a.xml; delete a.html;
      if (a.package) { delete a.package.manifestJson; delete a.package.sealJson; }
    }
    if (a.signature && a.signature.contentBase64 != null) {
      const buf = Buffer.from(String(a.signature.contentBase64), 'base64');
      const ref = B.put(db, 'archives', a.id, a.signature.name || 'podpis', buf);
      Object.assign(a.signature, { path: ref.path, bytes: ref.bytes, sha256: ref.sha256 });
      delete a.signature.contentBase64;
    }
    a.migratedAt = now();
    db.save();
    return true;
  }
  /** Migruje wszystko, co jeszcze trzyma bajty w kolekcji. Wołane z tras, które i tak piszą. */
  function ensureAllBlobs(db) { let n = 0; for (const a of db.col('archives')) if (ensureBlobs(db, a)) n++; return n; }

  /** Pakiet odtworzony ze składników — używany tylko wtedy, gdy nie ma jeszcze pamięci podręcznej ZIP. */
  function packageOf(db, a) {
    const ref = fileRef(a, 'zip');
    if (ref && B.has(db, ref)) return { zip: B.get(db, ref), zipName: ref.name, zipSha256: ref.sha256, bytes: ref.bytes, digests: (a.package || {}).digests || [] };
    const pk = a.package || {};
    const built = AR.buildArchivePackage(db, a.year, {
      at: a.at, xml: partBytes(db, a, 'xml', 'xml'), html: partBytes(db, a, 'html', 'html'),
      manifestJson: pk.manifestJson != null ? pk.manifestJson : partBytes(db, a, 'manifest').toString('utf8'),
      sealJson: pk.sealJson != null ? pk.sealJson : partBytes(db, a, 'seal').toString('utf8')
    });
    return built;
  }
  /** Skróty, o które może zahaczyć podpis. Z wiersza — bez odbudowywania 4,7 MB ZIP-a (R3-13). */
  const digestsOf = (db, a) => (((a.package || {}).digests || []).length ? a.package.digests : packageOf(db, a).digests);

  const signatureView = (a) => (a.signature
    ? { present: true, name: a.signature.name, kind: a.signature.kind, signedFile: a.signature.signedFile, bytes: a.signature.bytes, sha256: a.signature.sha256,
      verification: a.signature.verification, attests: a.signature.verification === 'digest-matched', matched: a.signature.matched || [], at: a.signature.at, by: a.signature.byName,
      checks: a.signature.checks, note: a.signature.note,
      state: AR.signatureState(a), closesDeadline: AR.closesDeadline(a), attested: AR.attested(a),
      accepted: a.signature.accepted ? { at: a.signature.accepted.at, by: a.signature.accepted.byName, reason: a.signature.accepted.reason } : null,
      superseded: a.signature.superseded || null }
    : { present: false, kind: null, verification: null, at: null, by: null, state: 'none', closesDeadline: false, attested: false, accepted: null, superseded: null });
  const packageView = (a) => (a.package
    ? { name: a.package.name, bytes: a.package.bytes, sha256: a.package.sha256, manifestSha256: a.package.manifestSha256, files: a.package.files, url: `/api/principal/archive/${a.id}/package` }
    : null);
  /* `verified` jest WYLICZANE, nigdy zapisywane (R3-09). Na liście kosztuje zero: skrót zapisany
     przy generowaniu musi się zgadzać z pieczęcią. Pełny dowód (przeliczenie bajtów z dysku i
     weryfikacja pieczęci kluczem szkoły) robi `GET …/verify`. */
  const sealedDigestOk = (a) => !a.seal || !fileRef(a, 'xml') ? a.verified !== false : fileRef(a, 'xml').sha256 === a.seal.digest;
  const archiveRow = (db, a) => ({
    id: a.id, year: a.year, at: a.at, byUserId: a.byUserId, byName: D.userLabel(db.get('users', a.byUserId)),
    forced: !!a.forced, forceNote: a.forceNote || null, window: a.window || null, bytes: a.bytes, seal: a.seal,
    verified: sealedDigestOk(a), superseded: !!a.superseded, supersededBy: a.supersededBy || null, supersededReason: a.supersededReason || null,
    files: a.files || null, package: packageView(a), signature: signatureView(a)
  });

  r.get('/api/principal/archive', (ctx) => {
    ensureAllBlobs(ctx.db);
    const reminded = remindArchive(ctx.db);
    return {
      window: archiveWindow(ctx.db), year: ctx.db.data.config.year, reminders: reminded.length,
      packages: ctx.db.col('archives').map((a) => archiveRow(ctx.db, a))
    };
  }, { roles: ['principal'] });

  r.post('/api/principal/archive', (ctx) => {
    const b = ctx.body || {}; const cfg = ctx.db.data.config;
    const year = String(b.year || cfg.year); const w = archiveWindow(ctx.db);
    const force = !!b.force;
    const reason = String(b.reason == null ? '' : b.reason).trim();
    /* S3-09: `year` wchodzi w nazwy plików i w nagłówek `Content-Disposition` — jeden kształt, bez wyjątków. */
    if (!ARCHIVE_YEAR.test(year)) throw httpError(400, `Rok szkolny zapisuje się jako „2026/2027”, a nie „${year}”.`, { code: 'bad_year', year });
    if (!w.open && !force) {
      throw httpError(403, w.notYetOpen
        ? `Okno na pakiet archiwalny otwiera się ${w.from} (termin z § 22 mija ${w.to}). Dziś jest ${w.today}.`
        : `Termin z § 22 na zapisanie i podpisanie pakietu minął ${w.to}. Dziś jest ${w.today}.`,
      { code: 'window_closed', window: w });
    }
    /* S3-13: poza terminem zawsze z uzasadnieniem, a wiersz zapamiętuje, jakie okno wtedy obowiązywało. */
    if (!w.open && force && !reason) throw httpError(400, 'Pakiet poza ustawowym terminem wymaga uzasadnienia — trafia ono do rejestru audytowego.', { code: 'no_reason' });
    /* H-9: przebudowa podpisanego rocznika nie może po cichu odwiesić przypomnień. */
    const prevSigned = signedArchive(ctx.db, year);
    if (prevSigned && !(b.rebuild === true && reason)) {
      throw httpError(409, `Pakiet ${year} jest już podpisany (${prevSigned.id}). Przebudowa unieważnia ten podpis — powtórz żądanie z „rebuild": true i uzasadnieniem.`,
        { code: 'year_signed', packageId: prevSigned.id, signature: signatureView(prevSigned) });
    }
    const at = now();
    const slug = AR.yearSlug(year);
    /* Wiersz najpierw, bo to on daje identyfikator katalogu plików. */
    const row = ctx.db.insert('archives', { year, at, byUserId: ctx.user.id, forced: !w.open && force, forceNote: null, window: null, files: null, package: null, seal: null, bytes: 0, signature: null });
    try {
      /* XML leci na dysk kawałek po kawałku — przy 24 oddziałach nie ma momentu, w którym cały
         rocznik jest napisem w pamięci (R3-09). */
      const xmlRef = B.put(ctx.db, 'archives', row.id, `dziennik-${slug}.xml`, AR.archiveXml(ctx.db, year, at));
      const htmlRef = B.put(ctx.db, 'archives', row.id, `dziennik-${slug}.html`, AR.archiveHtml(ctx.db, year, at));
      const xmlBuf = B.get(ctx.db, xmlRef), htmlBuf = B.get(ctx.db, htmlRef);
      const pkg = AR.buildArchivePackage(ctx.db, year, { at, xml: xmlBuf, html: htmlBuf });
      const manifestRef = B.put(ctx.db, 'archives', row.id, 'manifest.json', pkg.manifestJson);
      const sealRef = B.put(ctx.db, 'archives', row.id, 'seal.json', pkg.sealJson);
      const zipRef = B.put(ctx.db, 'archives', row.id, pkg.zipName, pkg.zip);
      const seal = C.sealDocument(xmlBuf, cfg.schoolPrivateKey);
      Object.assign(row, {
        forceNote: !w.open && force ? `Wygenerowano poza ustawowym terminem (${w.from} – ${w.to}) — odnotowano w rejestrze audytowym.` : null,
        window: { from: w.from, teachingEnd: w.teachingEnd, yearEnd: w.yearEnd, to: w.to, open: w.open, today: w.today },
        /* D3-21: pakiet opisuje rok, nie chwilę kliknięcia — `asOf` mówi, do jakiego dnia sięga. */
        asOf: AR.schoolYearRange(ctx.db, year).to,
        files: { xml: xmlRef, html: htmlRef, manifest: manifestRef, seal: sealRef, zip: zipRef },
        seal, bytes: xmlRef.bytes,
        package: { name: pkg.zipName, bytes: pkg.bytes, sha256: pkg.zipSha256, manifestSha256: pkg.manifestSha256, files: pkg.files, digests: pkg.digests, at }
      });
      ctx.db.save();
      if (prevSigned) {
        /* Głośno, nie po cichu: poprzedni podpis zostaje w kolekcji i jest do pobrania, ale mówi
           wprost, że nie zamyka już terminu (H-9). */
        prevSigned.superseded = true; prevSigned.supersededBy = row.id; prevSigned.supersededAt = at; prevSigned.supersededReason = reason;
        if (prevSigned.signature) prevSigned.signature.superseded = { by: row.id, at, reason, note: 'Rocznik przebudowano po podpisaniu — ten podpis dotyczy poprzedniej wersji pakietu i nie zamyka terminu z § 22.' };
        ctx.db.save();
        ctx.audit({ action: 'archive_signature_superseded', entity: 'archives', entityId: prevSigned.id, before: { verification: prevSigned.signature ? prevSigned.signature.verification : null, closedDeadline: true }, after: { supersededBy: row.id, closedDeadline: false }, reason });
      }
      ctx.audit({ action: 'archive_generated', entity: 'archives', entityId: row.id, after: { year, bytes: row.bytes, digest: seal.digest, forced: row.forced, window: row.window, asOf: row.asOf, supersedes: prevSigned ? prevSigned.id : null, package: { bytes: pkg.bytes, sha256: pkg.zipSha256, manifestSha256: pkg.manifestSha256, files: pkg.files.map((f) => f.name) } }, reason: reason || row.forceNote || null });
      return Object.assign(archiveRow(ctx.db, row), {
        window: archiveWindow(ctx.db), supersededPackageId: prevSigned ? prevSigned.id : null,
        files: [{ name: xmlRef.name, url: `/api/principal/archive/${row.id}/xml`, bytes: xmlRef.bytes, sha256: xmlRef.sha256 },
          { name: htmlRef.name, url: `/api/principal/archive/${row.id}/print`, print: true, bytes: htmlRef.bytes },
          { name: zipRef.name, url: `/api/principal/archive/${row.id}/package`, bytes: zipRef.bytes, sha256: zipRef.sha256 }]
      });
    } catch (e) {
      /* Nie zostawiamy pół-pakietu w kolekcji: wiersz i jego katalog znikają razem. */
      try { B.del(ctx.db, 'archives', row.id); } catch (_) {}
      ctx.db.remove('archives', row.id);
      throw e;
    }
  }, { roles: ['principal'] });

  /* S3-09: `year` jest wolnym tekstem z żądania, a lądował wprost w nagłówku `Content-Disposition`
     — `{"year":"x\"; filename=\"oceny-7b.html"}` dawało dwa parametry `filename`, a CRLF w roku
     trwale psuł `GET …/xml` (500 z Node). Teraz rok jest walidowany przy tworzeniu pakietu, a
     nazwa pliku przechodzi przez `safeFileName` na KAŻDEJ z czterech tras pobierania (do R3
     przechodziła przez niego tylko `/package`). Sam nagłówek składa `safeContentDisposition`
     w `server/lib/router.js` (F2) — trasa oddaje czystą nazwę, nie gotowy nagłówek. */
  const dispositionName = (raw, fallback) => AR.safeFileName(raw, fallback);

  r.get('/api/principal/archive/:id/xml', (ctx) => {
    const a = ctx.db.get('archives', ctx.params.id); if (!a) throw httpError(404, 'Nie ma takiego pakietu.');
    ensureBlobs(ctx.db, a);
    ctx.audit({ action: 'archive_exported', entity: 'archives', entityId: a.id, after: { format: 'xml' } });
    return partResponse(ctx.db, a, 'xml', 'xml', { contentType: 'application/xml; charset=utf-8', filename: dispositionName(`dziennik-${AR.yearSlug(a.year)}.xml`, 'dziennik.xml') });
  }, { roles: ['principal'] });

  r.get('/api/principal/archive/:id/print', (ctx) => {
    const a = ctx.db.get('archives', ctx.params.id); if (!a) throw httpError(404, 'Nie ma takiego pakietu.');
    ensureBlobs(ctx.db, a);
    return partResponse(ctx.db, a, 'html', 'html', { contentType: 'text/html; charset=utf-8', inline: true, filename: dispositionName(`dziennik-${AR.yearSlug(a.year)}.html`, 'dziennik.html') });
  }, { roles: ['principal'] });

  /* Jeden plik do zabrania na nośnik i do podpisania: ZIP (stored) z XML-em, wydrukiem, manifestem,
     `manifest.sha256` i pieczęcią szkoły. R3-13: ZIP powstał raz, przy generowaniu, i leży na dysku
     — nie składamy go od nowa (CRC-32 w czystym JS) przy każdym pobraniu. */
  r.get('/api/principal/archive/:id/package', (ctx) => {
    const a = ctx.db.get('archives', ctx.params.id); if (!a) throw httpError(404, 'Nie ma takiego pakietu.');
    ensureBlobs(ctx.db, a);
    const ref = fileRef(a, 'zip');
    /* Gotowy ZIP leży na dysku (R3-13) — idzie strumieniem, bez wciągania go do pamięci procesu. */
    if (ref && B.has(ctx.db, ref)) {
      ctx.audit({ action: 'archive_exported', entity: 'archives', entityId: a.id, after: { format: 'zip', bytes: ref.bytes, sha256: ref.sha256, cached: true } });
      return { __raw: true, stream: B.stream(ctx.db, ref), contentType: 'application/zip', filename: dispositionName(ref.name, 'archiwum.zip') };
    }
    const pkg = packageOf(ctx.db, a);
    ctx.audit({ action: 'archive_exported', entity: 'archives', entityId: a.id, after: { format: 'zip', bytes: pkg.bytes, sha256: pkg.zipSha256, cached: false } });
    return { __raw: true, body: pkg.zip, contentType: 'application/zip', filename: dispositionName(pkg.zipName, 'archiwum.zip') };
  }, { roles: ['principal'] });

  /**
   * Podpis złożony poza dziennikiem (gov.pl, e-Dowód, aplikacja kwalifikowana) wraca tutaj.
   *
   * S3-08 — trzy rzeczy, których do R3 nie sprawdzaliśmy i które sprawiały, że JPEG uciszał termin:
   *   1. `contentBase64` musi być NAPISEM (`true` dawało 3-bajtowy „podpis kwalifikowany”);
   *   2. plik musi mieć rozmiar, jaki podpis w ogóle może mieć (sam blok RSA-2048 to 256 bajtów);
   *   3. typ bierzemy z BAJTÓW (PKCS#7 DER / XML / PDF), nie z rozszerzenia nazwy.
   * A potem: sprawdzamy wyłącznie, czy w pliku jest skrót naszego pakietu. Łańcucha certyfikatów,
   * odwołań ani znacznika czasu NIE weryfikujemy i nie udajemy, że weryfikujemy.
   */
  r.post('/api/principal/archive/:id/signature', (ctx) => {
    const a = ctx.db.get('archives', ctx.params.id); if (!a) throw httpError(404, 'Nie ma takiego pakietu.');
    ensureBlobs(ctx.db, a);
    const b = ctx.body || {};
    const kind = String(b.kind || '').toLowerCase();
    if (!AR.SIGNATURE_KINDS.includes(kind)) throw httpError(400, `Nieznany rodzaj podpisu „${kind || '—'}”. Dozwolone: ${AR.SIGNATURE_KINDS.join(', ')}.`, { code: 'bad_signature_kind', kinds: AR.SIGNATURE_KINDS });
    const signedFile = String(b.signedFile || 'manifest.sha256');
    if (!AR.SIGNED_FILES.includes(signedFile)) throw httpError(400, 'Podpisać można „manifest.sha256” albo cały pakiet („package”).', { code: 'bad_signed_file', signedFiles: AR.SIGNED_FILES });
    if (typeof b.contentBase64 !== 'string') throw httpError(400, 'Treść podpisu musi przyjść jako napis w base64.', { code: 'bad_signature_content', received: b.contentBase64 === undefined ? 'brak' : typeof b.contentBase64 });
    const name = String(b.name || 'podpis.xml');
    /* Typ z bajtów, zanim cokolwiek innego go dotknie — nazwa pliku niczego tu nie dowodzi. */
    const rawBytes = Buffer.from(b.contentBase64.replace(/\s+/g, ''), 'base64');
    if (rawBytes.length < AR.SIGNATURE_MIN_BYTES) {
      throw httpError(400, `Plik podpisu ma ${rawBytes.length} B — żaden podpis elektroniczny nie jest krótszy niż ${AR.SIGNATURE_MIN_BYTES} B. To nie jest plik podpisu.`,
        { code: 'signature_too_small', bytes: rawBytes.length, minBytes: AR.SIGNATURE_MIN_BYTES });
    }
    const sniffed = AR.sniffSignature(rawBytes);
    if (!sniffed) {
      throw httpError(415, 'Treść pliku nie wygląda na podpis elektroniczny. Przyjmujemy XML (XAdES, opakowanie gov.pl), PDF (PAdES) i PKCS#7/CMS w DER (CAdES, .p7s).',
        { code: 'signature_type_unknown', accepted: ['application/xml', 'application/pdf', 'application/pkcs7-signature'] });
    }
    const maxMB = ctx.db.data.config.archiveSignatureMaxMB || 5;
    /* S-13: także ten plik idzie przez jedną bramkę załączników — rozmiar z bajtów, nie z deklaracji.
       Typ podajemy ten rozpoznany z bajtów, więc `content_mismatch` nie może już zależeć od nazwy. */
    const file = UP.validateUpload({ name, type: sniffed.type, dataUrl: `data:${sniffed.type};base64,${b.contentBase64.replace(/\s+/g, '')}` },
      { allow: ['application/xml', 'application/pdf', 'application/pkcs7-signature'], maxMB, fallbackName: 'podpis' });
    const content = Buffer.from(file.dataUrl.slice(file.dataUrl.indexOf(',') + 1), 'base64');
    const v = AR.verifySignature(content, { digests: digestsOf(ctx.db, a) });
    const before = a.signature ? { name: a.signature.name, kind: a.signature.kind, verification: a.signature.verification, state: AR.signatureState(a) } : null;
    if (a.signature && a.signature.name && a.signature.name !== file.name) B.del(ctx.db, 'archives', a.id, a.signature.name);
    const ref = B.put(ctx.db, 'archives', a.id, file.name, content);
    a.signature = { name: ref.name, type: sniffed.type, family: sniffed.family, typeLabel: sniffed.label, bytes: ref.bytes, sha256: ref.sha256, path: ref.path,
      kind, signedFile, at: now(), by: ctx.user.id, byName: D.userLabel(ctx.user),
      verification: v.verification, matched: v.matched, references: v.references, checks: v.checks, note: v.note, accepted: null };
    ctx.db.save();
    ctx.audit({ action: 'archive_signature_attached', entity: 'archives', entityId: a.id, before, after: { name: ref.name, kind, signedFile, bytes: ref.bytes, sha256: ref.sha256, type: sniffed.type, verification: v.verification, state: AR.signatureState(a), matched: v.matched } });
    return { id: a.id, year: a.year, signature: signatureView(a), package: packageView(a), window: archiveWindow(ctx.db) };
  }, { roles: ['principal'] });

  /**
   * „Przyjmuję ten podpis bez weryfikacji skrótu” — decyzja dyrektora, nie domyślne zachowanie.
   * Do tej pory JPEG uciszał termin z § 22 sam z siebie (S3-08). Teraz uciszyć go może wyłącznie
   * `digest-matched` albo ten wpis: z uzasadnieniem, z nazwiskiem i z wierszem w rejestrze.
   */
  r.post('/api/principal/archive/:id/accept-unverified', (ctx) => {
    const a = ctx.db.get('archives', ctx.params.id); if (!a) throw httpError(404, 'Nie ma takiego pakietu.');
    const b = ctx.body || {};
    const reason = String(b.reason == null ? '' : b.reason).trim();
    if (!a.signature) throw httpError(400, 'Do tego pakietu nie dołączono jeszcze pliku podpisu.', { code: 'no_signature' });
    if (a.signature.verification === 'digest-matched') throw httpError(400, 'Ten podpis ma już zgodny skrót — nie ma czego przyjmować bez weryfikacji.', { code: 'already_matched' });
    if (!reason) throw httpError(400, 'Podaj, na jakiej podstawie przyjmujesz podpis bez weryfikacji skrótu (np. „zweryfikowano w walidatorze dostawcy zaufania”).', { code: 'no_reason' });
    if (reason.length > 500) throw httpError(400, 'Uzasadnienie może mieć najwyżej 500 znaków.', { code: 'reason_too_long' });
    a.signature.accepted = { at: now(), by: ctx.user.id, byName: D.userLabel(ctx.user), reason };
    ctx.db.save();
    ctx.audit({ action: 'archive_signature_accepted_unverified', entity: 'archives', entityId: a.id,
      before: { state: 'stored-unverified', closedDeadline: false },
      after: { state: 'accepted-unverified', closedDeadline: true, signature: { name: a.signature.name, sha256: a.signature.sha256, kind: a.signature.kind, verification: a.signature.verification } }, reason });
    return { id: a.id, year: a.year, signature: signatureView(a), window: archiveWindow(ctx.db),
      note: 'Odnotowano przyjęcie podpisu bez weryfikacji skrótu. Dziennik nadal nie twierdzi, że podpis jest ważny — twierdzi, że dyrektor wziął za to odpowiedzialność.' };
  }, { roles: ['principal'] });

  r.get('/api/principal/archive/:id/signature', (ctx) => {
    const a = ctx.db.get('archives', ctx.params.id); if (!a) throw httpError(404, 'Nie ma takiego pakietu.');
    ensureBlobs(ctx.db, a);
    if (!a.signature) throw httpError(404, 'Do tego pakietu nie dołączono jeszcze podpisu.', { code: 'no_signature' });
    ctx.audit({ action: 'archive_exported', entity: 'archives', entityId: a.id, after: { format: 'signature', name: a.signature.name } });
    const body = a.signature.contentBase64 != null ? Buffer.from(a.signature.contentBase64, 'base64') : B.get(ctx.db, a.signature);
    return { __raw: true, body, contentType: a.signature.type || 'application/octet-stream', filename: dispositionName(a.signature.name, 'podpis') };
  }, { roles: ['principal'] });

  /**
   * S3-13: pakiet, który nie jest podpisany, musi dać się usunąć — inaczej literówka w roku albo
   * zacięty przycisk zostają w kolekcji na zawsze. Podpisanego (albo przyjętego bez weryfikacji)
   * pakietu ta trasa nie rusza: najpierw przebudowa z `rebuild`, która głośno unieważnia podpis.
   */
  r.delete('/api/principal/archive/:id', (ctx) => {
    const a = ctx.db.get('archives', ctx.params.id); if (!a) throw httpError(404, 'Nie ma takiego pakietu.');
    const reason = String((ctx.body || {}).reason == null ? '' : ctx.body.reason).trim();
    if (AR.attested(a)) throw httpError(409, `Pakiet ${a.year} jest podpisany i zamyka termin z § 22 — usunąć go nie można. Przebuduj rocznik („rebuild": true), jeśli podpis dotyczy nieaktualnych danych.`, { code: 'package_signed', signature: signatureView(a) });
    if (!reason) throw httpError(400, 'Podaj powód usunięcia pakietu — trafia do rejestru audytowego.', { code: 'no_reason' });
    const before = { year: a.year, at: a.at, bytes: a.bytes, files: a.files || null, package: a.package ? { name: a.package.name, sha256: a.package.sha256 } : null, signature: a.signature ? { name: a.signature.name, sha256: a.signature.sha256, verification: a.signature.verification } : null };
    const removedFiles = B.del(ctx.db, 'archives', a.id);          // kasowanie idzie za wierszem
    ctx.db.remove('archives', a.id);
    ctx.audit({ action: 'archive_deleted', entity: 'archives', entityId: a.id, before, after: { removedFiles }, reason });
    return { id: a.id, deleted: true, removedFiles, window: archiveWindow(ctx.db),
      note: 'Pakiet usunięty razem z plikami. Wpis w rejestrze audytowym z powodem zostaje na zawsze.' };
  }, { roles: ['principal'] });

  /* R3-09: to jest GET i NIC nie zapisuje. `verified` jest wyliczane — liczymy skrót bajtów
     leżących na dysku i sprawdzamy pieczęć kluczem szkoły. Wcześniej ta trasa pisała `a.verified`,
     przez co pojedyncze kliknięcie „zweryfikuj” kosztowało 290–336 ms (log całego wiersza z 5 MB
     podpisu → natychmiastowa kompaktacja). Migracji też tu nie robimy — GET nie zmienia danych. */
  r.get('/api/principal/archive/:id/verify', (ctx) => {
    const a = ctx.db.get('archives', ctx.params.id); if (!a) throw httpError(404, 'Nie ma takiego pakietu.');
    const xml = partBytes(ctx.db, a, 'xml', 'xml');
    const valid = C.verifySeal(xml, a.seal, ctx.db.data.config.schoolPublicKey);
    const digest = require('node:crypto').createHash('sha256').update(xml).digest('hex');
    /* Domyślnie: pieczęć nad XML-em (to jest dowód spójności pakietu) plus rozmiar każdego pliku na
       dysku. `?deep=1` przelicza SHA-256 każdego składnika — przy roczniku to ponad sto megabajtów
       odczytu, więc nie robimy tego przy każdym wejściu na ekran. */
    const deep = String((ctx.query || {}).deep || '') === '1';
    const files = [];
    for (const key of ['xml', 'html', 'manifest', 'seal', 'zip']) {
      const ref = fileRef(a, key);
      if (!ref) continue;
      const present = B.has(ctx.db, ref);
      const onDisk = present ? fs.statSync(B.absPath(ctx.db, ref)).size : null;
      const rehashed = present && (deep || key === 'xml') ? (key === 'xml' ? digest : B.sha256Of(ctx.db, ref)) : null;
      files.push({ part: key, name: ref.name, bytes: ref.bytes, sha256: ref.sha256, path: ref.path,
        present, bytesOnDisk: onDisk, sizeMatches: onDisk === ref.bytes,
        /* `null` znaczy „nie sprawdzaliśmy”, nie „w porządku” — to jest cały sens tego pola. */
        intact: rehashed == null ? null : rehashed === ref.sha256 });
    }
    return { id: a.id, year: a.year, valid: valid && digest === a.seal.digest, signatureValid: valid, digest, sealedDigest: a.seal.digest, alg: a.seal.alg, sealedAt: a.seal.sealedAt, note: a.seal.note,
      deep, files, filesPresent: files.every((f) => f.present && f.sizeMatches), filesIntact: files.every((f) => f.intact !== false),
      package: packageView(a), signature: signatureView(a), window: archiveWindow(ctx.db),
      sealMeaning: 'Pieczęć kluczem szkoły potwierdza spójność pakietu. Podpisem w rozumieniu § 22 jest wyłącznie podpis dołączony przez dyrektora — dziennik nie jest kwalifikowaną usługą zaufania.' };
  }, { roles: ['principal', 'dpo'] });

  /* ================================================================ 3.3.18 natychmiastowa blokada konta pracownika */
  r.post('/api/principal/users/:id/block', (ctx) => {
    const u = ctx.db.get('users', ctx.params.id); if (!u) throw httpError(404, 'Nie ma takiego użytkownika.');
    const b = ctx.body || {}; const blocked = b.blocked !== false;
    if (u.id === ctx.user.id) throw httpError(400, 'Nie można zablokować własnego konta.', { code: 'self' });
    if (!STAFF_ROLES.includes(u.role)) throw httpError(400, 'Ta operacja dotyczy kont pracowników.', { code: 'not_staff' });
    if (blocked && !String(b.reason || '').trim()) throw httpError(400, 'Podaj powód blokady (np. rozwiązanie umowy).', { code: 'no_reason' });
    const before = { blocked: !!u.blocked, sessions: ctx.db.col('sessions').filter((s) => s.userId === u.id && !s.revoked).length };
    let web = 0, mobile = 0;
    if (blocked) {
      for (const s of ctx.db.col('sessions')) { if (s.userId !== u.id || s.revoked) continue; s.revoked = true; s.revokedReason = 'blocked'; s.revokedAt = now(); if (s.client === 'mobile') mobile++; else web++; }
      Object.assign(u, { blocked: true, blockedAt: now(), blockedBy: ctx.user.id, blockedReason: String(b.reason).trim() });
    } else Object.assign(u, { blocked: false, unblockedAt: now(), unblockedBy: ctx.user.id, blockedReason: null });
    ctx.db.save();
    ctx.audit({ action: blocked ? 'account_blocked' : 'account_unblocked', entity: 'users', entityId: u.id, before, after: { blocked, revokedSessions: web + mobile, web, mobile }, reason: b.reason || null });
    return { userId: u.id, name: D.userLabel(u), role: u.role, blocked: !!u.blocked, blockedReason: u.blockedReason || null, revokedSessions: { total: web + mobile, web, mobile }, note: 'Wpisy nauczyciela w dzienniku pozostają nienaruszone; konto traci dostęp natychmiast w aplikacji webowej i mobilnej.' };
  }, { roles: ['principal'] });

  r.get('/api/principal/staff', (ctx) => ({
    staff: ctx.db.col('users').filter((u) => STAFF_ROLES.includes(u.role)).map((u) => ({ userId: u.id, login: u.login, name: D.userLabel(u), role: u.role, subjects: u.subjects || [], homeroomOf: u.homeroomOf || null, blocked: !!u.blocked, blockedReason: u.blockedReason || null, lastLogin: u.lastLogin || null,
      sessions: ctx.db.col('sessions').filter((s) => s.userId === u.id && !s.revoked).length,
      sessionsMobile: ctx.db.col('sessions').filter((s) => s.userId === u.id && !s.revoked && s.client === 'mobile').length }))
  }), { roles: ['principal'] });

  /* ================================================================ 3.3.19 statystyki logowań rodziców */
  r.get('/api/principal/parent-logins', (ctx) => {
    const today = D.today(ctx.db);
    const parents = ctx.db.col('users').filter((u) => u.role === 'parent');
    const rows = parents.map((u) => {
      const children = (u.childrenIds || []).map((sid) => ctx.db.get('students', sid)).filter(Boolean);
      const last = u.lastLogin ? String(u.lastLogin).slice(0, 10) : null;
      const days = last ? daysBetween(last, today) : null;
      const flag = !last ? 'never' : days > 30 ? 'stale' : 'ok';
      /* `entryId` — stały identyfikator wiersza dla komentarzy: wierszem jest konto rodzica. */
      return { userId: u.id, entryId: u.id, login: u.login, name: D.userLabel(u), lastLogin: u.lastLogin || null, daysSinceLogin: days, loginCount: u.loginCount || 0, flag, risk: flag !== 'ok',
        children: children.map((s) => ({ id: s.id, name: (s.rollNo ? s.rollNo + '. ' : '') + s.lastName + ' ' + s.firstName, classId: s.classId })) };
    });
    /* gospodarstwo domowe = konta rodziców połączone wspólnym dzieckiem */
    const parentOf = {}; parents.forEach((p) => (p.childrenIds || []).forEach((sid) => (parentOf[sid] = parentOf[sid] || []).push(p.id)));
    const seen = new Set(); const households = [];
    for (const p of parents) {
      if (seen.has(p.id)) continue;
      const stack = [p.id], members = []; seen.add(p.id);
      while (stack.length) {
        const pid = stack.pop(); members.push(pid);
        const u = ctx.db.get('users', pid);
        for (const sid of u.childrenIds || []) for (const other of parentOf[sid] || []) if (!seen.has(other)) { seen.add(other); stack.push(other); }
      }
      const mem = members.map((idv) => rows.find((x) => x.userId === idv)).filter(Boolean);
      const kids = [...new Set(members.flatMap((idv) => (ctx.db.get('users', idv).childrenIds || [])))].map((sid) => ctx.db.get('students', sid)).filter(Boolean);
      const bestDays = mem.map((m) => (m.lastLogin ? m.daysSinceLogin : null)).filter((x) => x != null);
      households.push({ id: 'hh_' + members.slice().sort()[0], name: [...new Set(kids.map((s) => s.lastName))].join(' / '), accounts: mem, students: kids.map((s) => ({ id: s.id, name: (s.rollNo ? s.rollNo + '. ' : '') + s.lastName + ' ' + s.firstName, classId: s.classId })),
        lastLogin: mem.map((m) => m.lastLogin).filter(Boolean).sort().slice(-1)[0] || null, loginCount: mem.reduce((s, m) => s + m.loginCount, 0),
        daysSinceLogin: bestDays.length ? Math.min(...bestDays) : null, risk: !bestDays.length || Math.min(...bestDays) > 30 });
    }
    households.sort((a, b) => (b.risk ? 1 : 0) - (a.risk ? 1 : 0) || a.name.localeCompare(b.name, 'pl'));
    return { today, thresholdDays: 30, rows: rows.sort((a, b) => (b.risk ? 1 : 0) - (a.risk ? 1 : 0) || a.name.localeCompare(b.name, 'pl')), households,
      comments: countsFor(ctx.db, ctx.user, 'parent-logins', rows.map((x) => x.entryId)),
      totals: { parents: rows.length, never: rows.filter((x) => x.flag === 'never').length, stale: rows.filter((x) => x.flag === 'stale').length, ok: rows.filter((x) => x.flag === 'ok').length, householdsAtRisk: households.filter((h) => h.risk).length,
        activePercent: rows.length ? Math.round((rows.filter((x) => x.flag === 'ok').length / rows.length) * 1000) / 10 : null } };
  }, { roles: ['principal'] });

  /* ================================================================ 3.3.20 globalne ustawienia widoczności */
  r.get('/api/principal/visibility', (ctx) => ({ visibility: ctx.db.data.config.visibility, note: 'Ustawienia obowiązują wszystkie konta rodziców i uczniów w szkole.' }), { roles: ['principal'] });

  r.patch('/api/principal/visibility', (ctx) => {
    const b = ctx.body || {}; const cfg = ctx.db.data.config;
    const before = Object.assign({}, cfg.visibility);
    const allowed = ['classAverage', 'rankings', 'averagesToParents'];
    const patch = {};
    for (const k of allowed) if (typeof b[k] === 'boolean') patch[k] = b[k];
    if (!Object.keys(patch).length) throw httpError(400, 'Podaj przynajmniej jedno ustawienie widoczności (classAverage, rankings, averagesToParents).', { code: 'empty' });
    cfg.visibility = Object.assign({}, cfg.visibility, patch); ctx.db.save();
    ctx.audit({ action: 'visibility_changed', entity: 'config', entityId: 'visibility', before, after: Object.assign({}, cfg.visibility), reason: b.reason || 'Polityka szkoły dotycząca porównywania uczniów' });
    return { visibility: cfg.visibility };
  }, { roles: ['principal'] });
}

module.exports = { register, audienceOf, SPECIALIST_ROLES };
