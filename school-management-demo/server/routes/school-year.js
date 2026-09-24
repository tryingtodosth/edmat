'use strict';
/* Przejście na nowy rok szkolny: promocja oddziałów (7b → 8b), absolwenci, nowe klasy pierwsze,
   przenumerowanie dziennika, wyczyszczenie planu i lekcji, przestawienie roku i semestrów.
   Poza tym modułem istnieje tylko przeniesienie dokumentacji pomocy p-p (POST /api/support/rollover). */
const D = require('../lib/domain');
const { httpError } = require('../lib/router');
const U = require('../lib/util');
const { schoolYearFor } = require('../lib/blank-seed');

const ROLES = ['admin', 'principal'];
const nextYearLabel = (year) => { const a = +String(year).split('/')[0]; return `${a + 1}/${a + 2}`; };
const levelOf = (cls) => (Number.isInteger(cls.level) ? cls.level : +String(cls.id).replace(/\D/g, '') || 0);
const letterOf = (cls) => String(cls.id).replace(/^\d+/, '') || '';
/** Najwyższy poziom w szkole = rocznik, który kończy naukę (SP: 8, liceum: 4 …). */
const topLevel = (db) => db.col('classes').reduce((m, c) => Math.max(m, levelOf(c)), 0);

/** Kto idzie dalej, kto kończy, kto zostaje — bez zapisywania czegokolwiek. */
function plan(db, opts) {
  const o = opts || {}; const top = o.topLevel || topLevel(db);
  const retain = new Set(o.retainStudentIds || db.col('students').filter((s) => s.retainedForYear === db.data.config.year).map((s) => s.id));
  const classes = db.col('classes').slice().sort((a, b) => levelOf(a) - levelOf(b) || letterOf(a).localeCompare(letterOf(b)));
  const rows = classes.map((c) => {
    const students = db.col('students').filter((s) => s.classId === c.id && s.status === 'active');
    const lvl = levelOf(c); const graduating = lvl >= top;
    const stay = students.filter((s) => retain.has(s.id));
    return {
      classId: c.id, name: c.name, level: lvl, homeroomTeacherId: c.homeroomTeacherId || null,
      homeroomTeacher: D.userLabel(db.get('users', c.homeroomTeacherId)),
      students: students.length, graduating,
      becomes: graduating ? null : `${lvl + 1}${letterOf(c)}`,
      promoted: students.length - stay.length,
      retained: stay.map((s) => ({ id: s.id, name: `${s.lastName} ${s.firstName}`, rollNo: s.rollNo }))
    };
  });
  const cfg = db.data.config;
  const year = o.year || nextYearLabel(cfg.year);
  const structure = schoolYearFor(`${String(year).split('/')[0]}-09-01`);
  const blockers = [];
  const AR = require('../lib/archive');
  if (!db.col('archives').some((a) => a.year === cfg.year && AR.closesDeadline(a))) blockers.push(`Nie ma podpisanego pakietu archiwalnego za rok ${cfg.year} — wygeneruj go i dołącz podpis w „Dyrekcji” przed zamknięciem roku (POST /api/principal/archive).`);
  const noHomeroom = rows.filter((r) => !r.graduating && !r.homeroomTeacherId);
  for (const r of noHomeroom) blockers.push(`Oddział ${r.name} nie ma wychowawcy — po promocji stanie się ${r.becomes} bez przypisanej osoby.`);
  return {
    fromYear: cfg.year, toYear: year, topLevel: top, classes: rows,
    graduating: rows.filter((r) => r.graduating).reduce((n, r) => n + r.students, 0),
    promoting: rows.filter((r) => !r.graduating).reduce((n, r) => n + r.promoted, 0),
    retaining: rows.reduce((n, r) => n + r.retained.length, 0),
    timetableEntries: db.col('timetable').length,
    futureLessons: db.col('lessons').filter((l) => l.date > D.today(db)).length,
    structure: { semesters: structure.semesters, winterBreak: structure.winterBreak, holidays: structure.holidays, daysOff: structure.daysOff },
    blockers
  };
}

function register(r, app) {
  r.get('/api/school-year/plan', (ctx) => plan(ctx.db, { year: ctx.query.year, topLevel: ctx.query.topLevel ? +ctx.query.topLevel : null }), { roles: ROLES });

  /** Uczeń pozostaje na drugi rok w tym samym oddziale — decyzja rady, więc z podstawą i w audycie. */
  r.post('/api/school-year/students/:id/retain', (ctx) => {
    const db = ctx.db; const b = ctx.body || {}; const s = db.get('students', ctx.params.id);
    if (!s) throw httpError(404, 'Nie ma takiego ucznia w księdze.');
    if (s.status !== 'active') throw httpError(400, 'Wpis tego ucznia jest zamknięty.', { code: 'student_inactive' });
    const keep = b.retained !== false;
    const reason = String(b.reason || '').trim();
    if (keep && !reason) throw httpError(400, 'Pozostawienie ucznia na drugi rok wymaga podstawy (uchwała rady pedagogicznej).', { field: 'reason' });
    const before = { retainedForYear: s.retainedForYear || null };
    if (keep) { s.retainedForYear = db.data.config.year; s.retainedReason = reason; s.retainedByUserId = ctx.user.id; }
    else { s.retainedForYear = null; s.retainedReason = null; }
    db.save();
    ctx.audit({ action: keep ? 'student_retained' : 'student_retain_cancelled', entity: 'students', entityId: s.id, before, after: { retainedForYear: s.retainedForYear }, reason: reason || 'cofnięcie decyzji' });
    return { ok: true, studentId: s.id, retainedForYear: s.retainedForYear, message: keep ? `${s.lastName} ${s.firstName} pozostaje w oddziale ${s.classId} także w roku ${nextYearLabel(db.data.config.year)}.` : 'Decyzja cofnięta — uczeń zostanie promowany.' };
  }, { roles: ROLES });

  r.post('/api/school-year/rollover', (ctx) => {
    const db = ctx.db; const b = ctx.body || {}; const cfg = db.data.config;
    const p = plan(db, { year: b.year, topLevel: b.topLevel });
    if (p.blockers.length && !b.force) throw httpError(409, p.blockers[0], { code: 'rollover_blocked', blockers: p.blockers, plan: p });
    if (b.dryRun) return Object.assign({ dryRun: true }, p, { message: `Podgląd: ${p.promoting} uczniów awansuje, ${p.graduating} kończy szkołę, ${p.retaining} zostaje na drugi rok. Nic nie zostało zapisane.` });
    const reason = String(b.reason || '').trim() || `Przejście na rok szkolny ${p.toYear}`;
    const today = D.today(db);
    const graduationDate = /^\d{4}-\d{2}-\d{2}$/.test(String(b.graduationDate || '')) ? b.graduationDate : (cfg.semesters[cfg.semesters.length - 1].to || today);
    const before = { year: cfg.year, classes: db.col('classes').length, timetable: db.col('timetable').length, lessons: db.col('lessons').length };
    const out = { graduated: [], promoted: [], retained: [], newClasses: [], renumbered: 0 };

    /* 1. absolwenci: wpis w księdze zamknięty, konta i dostęp opiekunów odcięte tak samo jak przy przeniesieniu */
    const { closeEnrolment } = require('./registry');
    for (const row of p.classes.filter((x) => x.graduating)) {
      const cls = db.get('classes', row.classId);
      for (const s of db.col('students').filter((x) => x.classId === row.classId && x.status === 'active')) {
        s.status = 'graduated'; s.departureDate = graduationDate; s.graduatedFromClassId = row.classId; s.graduatedYear = cfg.year;
        s.registerClosedAt = U.now(); s.registerClosedByUserId = ctx.user.id;
        closeEnrolment(db, s, { reason: `Ukończenie szkoły w roku ${cfg.year}` });
        out.graduated.push({ id: s.id, name: `${s.lastName} ${s.firstName}`, registerNo: s.registerNo, from: row.classId });
      }
      if (cls) { cls.archivedYear = cfg.year; cls.studentIds = []; if (cls.homeroomTeacherId) { const t = db.get('users', cls.homeroomTeacherId); if (t && t.homeroomOf === cls.id) t.homeroomOf = null; } db.remove('classes', cls.id); }
    }

    /* 2. promocja: oddział zmienia identyfikator o jeden poziom w górę, uczniowie idą razem z nim */
    const promoting = p.classes.filter((x) => !x.graduating).sort((a, b2) => b2.level - a.level);   // od najstarszych, żeby nie nadpisać istniejącego id
    for (const row of promoting) {
      const cls = db.get('classes', row.classId); if (!cls) continue;
      const newId = row.becomes;
      if (db.get('classes', newId)) throw httpError(409, `Oddział ${newId} już istnieje — przerwano przed zmianą danych.`, { code: 'class_exists' });
      const retained = db.col('students').filter((s) => s.classId === cls.id && s.status === 'active' && s.retainedForYear === cfg.year);
      const moving = db.col('students').filter((s) => s.classId === cls.id && s.status === 'active' && s.retainedForYear !== cfg.year);
      cls.id = newId; cls.name = newId; cls.level = row.level + 1;
      cls.studentIds = moving.map((s) => s.id);
      for (const s of moving) { s.classId = newId; s.promotedFrom = row.classId; s.promotedAt = today; out.promoted.push(s.id); }
      for (const g of db.col('groups')) { if ((g.classIds || []).includes(row.classId)) g.classIds = g.classIds.map((x) => (x === row.classId ? newId : x)); }
      if (cls.homeroomTeacherId) { const t = db.get('users', cls.homeroomTeacherId); if (t) t.homeroomOf = newId; }
      if (cls.actingHomeroomTeacherId) { cls.actingHomeroomTeacherId = null; cls.actingHomeroomFrom = null; cls.actingHomeroomTo = null; }
      if (retained.length) {                                            // powtarzający rok wracają do oddziału o starym poziomie
        let repeat = db.get('classes', row.classId);
        if (!repeat) { repeat = { id: row.classId, name: row.classId, level: row.level, homeroomTeacherId: null, studentIds: [] }; db.col('classes').push(repeat); out.newClasses.push(row.classId); }
        for (const s of retained) { s.classId = repeat.id; s.retainedForYear = null; s.repeatedYear = cfg.year; if (!repeat.studentIds.includes(s.id)) repeat.studentIds.push(s.id); out.retained.push(s.id); }
      }
    }

    /* 3. nowe klasy pierwsze */
    for (const nc of Array.isArray(b.newClasses) ? b.newClasses : []) {
      const id = String(nc.id || nc).trim(); if (!id) continue;
      if (db.get('classes', id)) { continue; }
      const cls = { id, name: nc.name || id, level: +String(id).replace(/\D/g, '') || 1, homeroomTeacherId: null, studentIds: [] };
      if (nc.homeroomTeacherId) { const t = db.get('users', nc.homeroomTeacherId); if (!t) throw httpError(400, 'Nie ma takiego nauczyciela: ' + nc.homeroomTeacherId + '.', { field: 'newClasses' }); cls.homeroomTeacherId = t.id; t.homeroomOf = id; }
      db.col('classes').push(cls); out.newClasses.push(id);
    }

    /* 4. numery w dzienniku nadawane od nowa, alfabetycznie, w każdym oddziale */
    if (b.renumber !== false) for (const cls of db.col('classes')) {
      const list = db.col('students').filter((s) => s.classId === cls.id && s.status === 'active').sort((a, b2) => a.lastName.localeCompare(b2.lastName, 'pl') || a.firstName.localeCompare(b2.firstName, 'pl'));
      list.forEach((s, i) => { if (s.rollNo !== i + 1) { s.rollNo = i + 1; out.renumbered++; } });
      cls.studentIds = list.map((s) => s.id);
    }

    /* 5. nowy rok: plan i przyszłe lekcje znikają (plan układa się od nowa), historia zostaje nietknięta */
    const structure = schoolYearFor(`${String(p.toYear).split('/')[0]}-09-01`);
    const removedLessons = db.col('lessons').filter((l) => l.date > graduationDate).length;
    if (b.keepTimetable !== true) { db.data.timetable = []; db.data.lessons = db.col('lessons').filter((l) => l.date <= graduationDate); }
    cfg.year = p.toYear; cfg.semesters = structure.semesters; cfg.winterBreak = structure.winterBreak; cfg.holidays = structure.holidays; cfg.daysOff = structure.daysOff;
    for (const g of db.col('groups')) g.studentIds = (g.studentIds || []).filter((sid) => { const s = db.get('students', sid); return s && s.status === 'active'; });
    db.save();

    ctx.audit({ action: 'school_year_rollover', entity: 'config', entityId: 'year', before, after: { year: cfg.year, graduated: out.graduated.length, promoted: out.promoted.length, retained: out.retained.length, newClasses: out.newClasses, renumbered: out.renumbered, removedLessons, timetableCleared: b.keepTimetable !== true }, reason });
    for (const g of out.graduated) ctx.audit({ action: 'registry_entry_closed', entity: 'student', entityId: g.id, after: { status: 'graduated', departureDate: graduationDate, fromClass: g.from }, reason: `Ukończenie szkoły w roku ${before.year}` });
    return Object.assign({ ok: true, fromYear: before.year, year: cfg.year, semesters: cfg.semesters, daysOff: cfg.daysOff, removedLessons, timetableCleared: b.keepTimetable !== true }, out, {
      graduated: out.graduated.length, graduatedStudents: out.graduated, promoted: out.promoted.length, retained: out.retained.length,
      classes: db.col('classes').map((c) => ({ id: c.id, name: c.name, level: c.level, students: (c.studentIds || []).length, homeroomTeacherId: c.homeroomTeacherId || null })),
      message: `Rok ${before.year} zamknięty. ${out.graduated.length} ${U.plural(out.graduated.length, 'uczeń ukończył', 'uczniów ukończyło', 'uczniów ukończyło')} szkołę, ${out.promoted.length} awansowało, ${out.retained.length} ${U.plural(out.retained.length, 'powtarza', 'powtarza', 'powtarza')} rok. Rozpoczęty rok ${cfg.year}: wgraj nowy plan lekcji i wygeneruj lekcje (POST /api/admin/timetable/import, POST /api/setup/lessons/generate).`
    });
  }, { roles: ROLES });
}

module.exports = { register, plan, nextYearLabel, topLevel };
