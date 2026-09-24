'use strict';
/* 3.1 — dziennik lekcyjny: plan dnia nauczyciela i klasy, temat lekcji powiązany z podstawą
   programową, realizacja podstawy w czasie rzeczywistym, terminarz sprawdzianów z limitem szkolnym. */
const D = require('../lib/domain');
const { httpError } = require('../lib/router');
const util = require('../lib/util');
const A = require('./attendance');
const LA = require('../lib/log-access');
const { countsFor } = require('./log-comments');

const TEST_KINDS = ['sprawdzian', 'kartkówka'];
/** Only announced written tests (sprawdziany) count against config.testLimits; short quizzes do not. */
const LIMITED = 'sprawdzian';

function weekRange(date) { const wd = util.weekday(date); const from = util.addDays(date, 1 - wd); return { from, to: util.addDays(from, 6) }; }
function classLevel(db, classId) { const c = db.get('classes', classId); return c ? c.level : null; }
function curriculumFor(db, subjectId, level) { return db.col('curriculum').filter((x) => x.subjectId === subjectId && (level == null || x.level === level)); }
function canEditLesson(db, user, lesson) { return user.role === 'principal' || lesson.teacherId === user.id || lesson.substituteTeacherId === user.id; }

function lessonRow(db, l) {
  const v = A.lessonView(db, l);
  const ids = A.combinedLessons(db, l).map((x) => x.id);
  const rows = db.col('attendance').filter((a) => ids.includes(a.lessonId));
  const total = A.combinedLessons(db, l).reduce((n, x) => n + A.rosterIds(db, x).length, 0);
  v.attendance = { saved: rows.filter((a) => !a.draft).length, drafts: rows.filter((a) => a.draft).length, total };
  v.hasTopic = !!l.topic;
  return v;
}

/** Realizacja podstawy programowej: per item and in total, computed from the linked lessons right now. */
function completion(db, subjectId, classId) {
  const level = classLevel(db, classId);
  const items = curriculumFor(db, subjectId, level);
  const lessons = db.col('lessons').filter((l) => l.classId === classId && l.subjectId === subjectId);
  const held = lessons.filter((l) => l.status === 'held' || l.date < D.today(db));
  const itemRows = items.map((it) => {
    const linked = held.filter((l) => (l.curriculumItemIds || []).includes(it.id));
    const covered = linked.length;
    return {
      id: it.id, code: it.code, title: it.title, hours: it.hours, covered,
      percent: it.hours ? Math.min(100, Math.round((covered / it.hours) * 1000) / 10) : 0,
      remaining: Math.max(0, it.hours - covered),
      lastDate: linked.length ? linked.map((l) => l.date).sort().slice(-1)[0] : null
    };
  });
  const hours = itemRows.reduce((n, x) => n + x.hours, 0);
  const covered = itemRows.reduce((n, x) => n + Math.min(x.covered, x.hours), 0);
  const linkedLessons = held.filter((l) => (l.curriculumItemIds || []).length).length;
  /* GAP-2: pusta instalacja nie ma jeszcze ani jednego punktu podstawy. „Zero godzin” nie może
     dawać `NaN %` na ekranie ani `null` w liczniku — realizacja pustego planu to 0 %, a `hasItems`
     mówi ekranowi, żeby zamiast paska pokazał zaproszenie do wpisania podstawy. */
  return {
    subjectId, classId, level, items: itemRows, hours, covered,
    percent: hours ? Math.round((covered / hours) * 1000) / 10 : 0,
    hasItems: itemRows.length > 0,
    lessonsHeld: held.length, lessonsLinked: linkedLessons,
    lessonsWithoutItem: held.filter((l) => !(l.curriculumItemIds || []).length).map((l) => ({ id: l.id, date: l.date, lessonNo: l.lessonNo, topic: l.topic || null })),
    asOf: D.today(db)
  };
}

function testsIn(db, classId, from, to, kind) {
  return db.col('tests').filter((t) => t.classId === classId && t.date >= from && t.date <= to && (!kind || t.kind === kind)).sort((a, b) => (a.date < b.date ? -1 : 1));
}
/** Ile dni wcześniej statut każe zapowiedzieć sprawdzian (domyślnie tydzień). */
const noticeDays = (db) => { const n = db.data.config.testNoticeDays; return Number.isInteger(n) && n >= 0 ? n : 7; };
/** Limit check for a class on a date: {perDay, perWeek, dayCount, weekCount, limitReached, warning} */
function limitCheck(db, classId, date, kind, exceptId) {
  const lim = db.data.config.testLimits || { perDay: 1, perWeek: 3 };
  const wk = weekRange(date);
  const day = testsIn(db, classId, date, date, LIMITED).filter((t) => t.id !== exceptId);
  const week = testsIn(db, classId, wk.from, wk.to, LIMITED).filter((t) => t.id !== exceptId);
  const counts = { dayCount: day.length, weekCount: week.length };
  const dayFull = counts.dayCount >= lim.perDay, weekFull = counts.weekCount >= lim.perWeek;
  const limited = kind === LIMITED;
  const today = D.today(db);
  const daysAhead = util.daysBetween(today, date);
  const out = {
    classId, date, kind: kind || LIMITED, perDay: lim.perDay, perWeek: lim.perWeek,
    dayCount: counts.dayCount, weekCount: counts.weekCount, weekFrom: wk.from, weekTo: wk.to,
    limitReached: limited && (dayFull || weekFull), dayFull: limited && dayFull, weekFull: limited && weekFull,
    tests: week.map((t) => ({ id: t.id, date: t.date, subjectId: t.subjectId, kind: t.kind, scope: t.scope })),
    today, daysAhead, noticeDays: noticeDays(db), inPast: daysAhead < 0,
    /** zapowiedź krótsza niż wymaga statut — dopuszczalna tylko za wiedzą klasy, stąd ostrzeżenie */
    shortNotice: limited && daysAhead >= 0 && daysAhead < noticeDays(db),
    notice: null, warning: null
  };
  if (out.inPast) out.notice = `Termin ${util.fmtDate(date)} już minął — sprawdzianu nie można zapowiedzieć wstecz.`;
  else if (out.shortNotice) out.notice = `Statut wymaga zapowiedzi na ${out.noticeDays} ${util.plural(out.noticeDays, 'dzień', 'dni', 'dni')} przed sprawdzianem, a do ${util.fmtDate(date)} ${util.plural(daysAhead, 'został', 'zostały', 'zostało')} ${daysAhead} ${util.plural(daysAhead, 'dzień', 'dni', 'dni')}.`;
  if (!limited) out.warning = 'Kartkówki nie są objęte limitem sprawdzianów.';
  else if (dayFull) out.warning = `Limit szkolny: ${lim.perDay} ${util.plural(lim.perDay, 'sprawdzian', 'sprawdziany', 'sprawdzianów')} dziennie dla oddziału ${classId}. Na ${util.fmtDate(date)} termin jest już zajęty.`;
  else if (weekFull) out.warning = `Limit szkolny: ${lim.perWeek} ${util.plural(lim.perWeek, 'sprawdzian', 'sprawdziany', 'sprawdzianów')} w tygodniu dla oddziału ${classId}. W tygodniu ${util.fmtDate(wk.from)}–${util.fmtDate(wk.to)} zapisano już ${counts.weekCount}.`;
  else out.warning = `W tygodniu ${util.fmtDate(wk.from)}–${util.fmtDate(wk.to)}: ${counts.weekCount + 1}/${lim.perWeek} sprawdzianów dla oddziału ${classId}.`;
  return out;
}

/* ================================================================ podstawa programowa (GAP-2) ==
   `curriculum` to lista punktów podstawy: { id, subjectId, level, code, title, hours }. Pusta
   instalacja dostaje ją pustą — i dopóki nie było trasy zapisu, nie miała jak jej wypełnić. */
const CURRICULUM_WRITE = { roles: ['teacher', 'principal', 'admin'] };
/** Kolumny importu — w tej kolejności; `GET /api/curriculum/format` podaje je ekranowi i szkole. */
const CURRICULUM_COLUMNS = [
  { name: 'subject', required: true, desc: 'identyfikator przedmiotu z dziennika, np. mat, pol, ang' },
  { name: 'level', required: true, desc: 'poziom klasy: liczba 1–8' },
  { name: 'code', required: true, desc: 'oznaczenie punktu z rozporządzenia, np. I.1, VIII.2' },
  { name: 'title', required: true, desc: 'treść wymagania, np. „Twierdzenie Pitagorasa”' },
  { name: 'hours', required: false, desc: 'planowana liczba godzin (liczba całkowita ≥ 0; domyślnie 0)' }
];
const CURRICULUM_EXAMPLE = ['subject;level;code;title;hours', 'mat;7;I.1;Potęgi o podstawach wymiernych;10', 'mat;7;VIII.1;Twierdzenie Pitagorasa;10', 'pol;7;I.1;Kształcenie literackie;40'].join('\n');
const CURRICULUM_MAX_LEVEL = 8;
/** Dyrektor i administrator prowadzą całą podstawę; nauczyciel — punkty swoich przedmiotów. */
const canEditCurriculum = (user) => ['teacher', 'principal', 'admin'].includes(user.role);
function editableSubjects(db, user) {
  const all = db.col('subjects').map((x) => ({ id: x.id, name: x.name }));
  if (user.role === 'principal' || user.role === 'admin') return all;
  const own = new Set(user.subjects || []);
  return all.filter((x) => own.has(x.id));
}
/** Nauczyciel wpisuje podstawę tylko dla przedmiotów, których uczy — dyrekcja i administracja dla wszystkich. */
function assertMaySubject(db, user, subjectId) {
  if (user.role === 'principal' || user.role === 'admin') return;
  if ((user.subjects || []).includes(subjectId)) return;
  throw httpError(403, 'Podstawę programową swojego przedmiotu prowadzi jego nauczyciel; pozostałe przedmioty — dyrekcja albo administrator.', { code: 'not_subject_teacher', subjectId });
}
const curriculumOrder = (a, b) => (a.subjectId === b.subjectId ? (a.level === b.level ? String(a.code).localeCompare(String(b.code), 'pl', { numeric: true }) : a.level - b.level) : String(a.subjectId).localeCompare(String(b.subjectId), 'pl'));
function curriculumView(db, x) {
  const linked = db.col('lessons').filter((l) => (l.curriculumItemIds || []).includes(x.id));
  return Object.assign({}, x, {
    subjectName: (db.get('subjects', x.subjectId) || {}).name || x.subjectId,
    lessonsLinked: linked.length
  });
}
/** Wspólna walidacja wiersza (formularz i import) — zwraca gotowy dokument bez `id`. */
function validateCurriculum(db, user, b, existing) {
  const subjectId = String(b.subjectId || b.subject || '').trim();
  if (!subjectId) throw httpError(400, 'Podaj przedmiot punktu podstawy programowej.', { code: 'no_subject' });
  if (!db.get('subjects', subjectId)) throw httpError(400, `Nie ma przedmiotu o identyfikatorze „${subjectId}”.`, { code: 'unknown_subject', subjectId });
  assertMaySubject(db, user, subjectId);
  const level = Number(b.level);
  if (!Number.isInteger(level) || level < 1 || level > CURRICULUM_MAX_LEVEL) throw httpError(400, `Poziom klasy musi być liczbą od 1 do ${CURRICULUM_MAX_LEVEL}.`, { code: 'bad_level', level: b.level });
  const code = String(b.code || '').trim();
  if (!code) throw httpError(400, 'Podaj oznaczenie punktu podstawy (np. I.1).', { code: 'no_code' });
  if (code.length > 20) throw httpError(400, 'Oznaczenie punktu jest za długie (maksymalnie 20 znaków).', { code: 'code_too_long' });
  const title = String(b.title || '').trim();
  if (!title) throw httpError(400, 'Podaj treść wymagania.', { code: 'no_title' });
  if (title.length > 300) throw httpError(400, 'Treść wymagania jest za długa (maksymalnie 300 znaków).', { code: 'title_too_long' });
  const rawHours = b.hours === '' || b.hours == null ? (existing ? existing.hours : 0) : b.hours;
  const hours = Number(rawHours);
  if (!Number.isInteger(hours) || hours < 0 || hours > 1000) throw httpError(400, 'Liczba godzin musi być liczbą całkowitą od 0 do 1000.', { code: 'bad_hours', hours: b.hours });
  return { subjectId, level, code, title, hours };
}
/** CSV podstawy: `subject;level;code;title;hours`, nagłówek opcjonalny, BOM i CRLF dopuszczalne. */
function parseCurriculumCsv(text) {
  const names = CURRICULUM_COLUMNS.map((c) => c.name);
  const lines = String(text || '').replace(/^\ufeff/, '').split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  const rows = [], errors = [];
  if (!lines.length) return { rows, errors: [{ line: 0, error: 'Wklejony tekst jest pusty — skopiuj arkusz razem z wierszem nagłówka.', code: 'empty_csv' }] };
  let header = names, start = 0;
  const first = lines[0].split(';').map((c) => c.trim().toLowerCase());
  if (first[0] === 'subject' || first[0] === 'przedmiot') { header = first.map((c) => ({ przedmiot: 'subject', poziom: 'level', kod: 'code', 'tytuł': 'title', tytul: 'title', godziny: 'hours' }[c] || c)); start = 1; }
  lines.slice(start).forEach((l, i) => {
    const line = i + start + 1;
    const cells = l.split(';').map((c) => c.trim().replace(/^"|"$/g, ''));
    if (cells.length < 4) { errors.push({ line, error: `Oczekiwano kolumn ${names.join(';')}, znaleziono ${cells.length} — popraw wiersz, zanim go zaimportujesz.`, code: 'column_count', expected: names.length, actual: cells.length }); return; }
    const o = { _line: line };
    header.forEach((hname, k) => { if (cells[k] !== undefined) o[hname] = cells[k]; });
    rows.push(o);
  });
  return { rows, errors };
}

function register(r, app) {
  /* Komentarze do wpisu dziennika lekcyjnego (temat lekcji). `GET /api/lessons` i `/api/lessons/:id`
     stoją na `roles: staff` i nie zawężają wpisu do własnych lekcji (każdy pracownik może zapytać
     o plan klasy), więc bramka komentarza jest taka sama: pracownik szkoły widzi każdą lekcję. */
  LA.register('lesson-log', {
    label: 'Dziennik lekcyjny (temat lekcji)',
    roles: ['staff'],
    find: (db, user, entryId) => db.get('lessons', entryId) || null
  });

  /* ---- plan lekcji: nauczyciela albo klasy ------------------------------------------- */
  r.get('/api/lessons', (ctx) => {
    const db = ctx.db;
    const date = ctx.query.date || D.today(db);
    const from = ctx.query.from || date, to = ctx.query.to || date;
    const classId = ctx.query.classId || null;
    let teacherId = ctx.query.teacherId || null;
    if (!classId && !teacherId) teacherId = ctx.user.id;
    if (teacherId && teacherId !== ctx.user.id && !['principal', 'registrar', 'admin'].includes(ctx.user.role)) throw httpError(403, 'Plan innego nauczyciela widzi tylko dyrekcja.', { code: 'forbidden' });
    const rows = db.col('lessons')
      .filter((l) => l.date >= from && l.date <= to && (!classId || l.classId === classId) && (!teacherId || l.teacherId === teacherId || l.substituteTeacherId === teacherId))
      .sort((a, b) => (a.date === b.date ? a.lessonNo - b.lessonNo : a.date < b.date ? -1 : 1))
      .map((l) => lessonRow(db, l));
    const counts = countsFor(db, ctx.user, 'lesson-log', rows.map((l) => l.id));
    rows.forEach((l) => { l.comments = counts[l.id]; });
    return { from, to, date, classId, teacherId, today: D.today(db), lessons: rows };
  }, { roles: ['staff'] });

  r.get('/api/lessons/:id', (ctx) => {
    const l = ctx.db.get('lessons', ctx.params.id); if (!l) throw httpError(404, 'Nie ma takiej lekcji.');
    const v = lessonRow(ctx.db, l);
    v.canEdit = canEditLesson(ctx.db, ctx.user, l);
    v.comments = countsFor(ctx.db, ctx.user, 'lesson-log', [l.id])[l.id];
    v.curriculum = curriculumFor(ctx.db, l.subjectId, classLevel(ctx.db, l.classId));
    return v;
  }, { roles: ['staff'] });

  /* ---- temat lekcji + powiązanie z podstawą programową (3.1.3) ------------------------ */
  r.patch('/api/lessons/:id', (ctx) => {
    const db = ctx.db; const l = db.get('lessons', ctx.params.id);
    if (!l) throw httpError(404, 'Nie ma takiej lekcji.');
    if (!canEditLesson(db, ctx.user, l)) throw httpError(403, 'Temat lekcji może zapisać tylko nauczyciel prowadzący lub jego zastępca.', { code: 'not_lesson_teacher' });
    const b = ctx.body || {};
    const clientAt = typeof b.at === 'string' && b.at.length >= 10 ? b.at : null;
    const at = clientAt || util.now();
    if (clientAt && l.topicAtClient && clientAt < l.topicAt) return { ok: true, skipped: true, lesson: lessonRow(db, l) }; // older replayed write
    const before = { topic: l.topic || null, curriculumItemIds: (l.curriculumItemIds || []).slice(), status: l.status };
    if (b.topic !== undefined) {
      const topic = String(b.topic || '').trim();
      if (!topic) throw httpError(400, 'Temat lekcji nie może być pusty.', { code: 'empty_topic' });
      l.topic = topic;
    }
    if (b.curriculumItemIds !== undefined) {
      const ids = Array.isArray(b.curriculumItemIds) ? b.curriculumItemIds : [];
      const level = classLevel(db, l.classId);
      for (const idv of ids) {
        const it = db.get('curriculum', idv);
        if (!it) throw httpError(400, `Nie ma punktu podstawy programowej o identyfikatorze ${idv}.`, { code: 'unknown_curriculum_item' });
        if (it.subjectId !== l.subjectId) throw httpError(400, `Punkt ${it.code} należy do innego przedmiotu niż lekcja.`, { code: 'curriculum_subject_mismatch' });
        if (level != null && it.level !== level) throw httpError(400, `Punkt ${it.code} dotyczy klasy ${it.level}, a lekcja klasy ${level}.`, { code: 'curriculum_level_mismatch' });
      }
      l.curriculumItemIds = [...new Set(ids)];
    }
    if (l.topic && l.date <= D.today(db)) l.status = 'held';
    l.topicAt = at; l.topicAtClient = !!clientAt; l.topicByUserId = ctx.user.id;
    db.save();
    ctx.audit({ action: 'lesson_topic', entity: 'lesson', entityId: l.id, before, after: { topic: l.topic, curriculumItemIds: l.curriculumItemIds, status: l.status }, reason: b.reason || null });
    return { ok: true, lesson: lessonRow(db, l), completion: completion(db, l.subjectId, l.classId) };
  }, { roles: ['teacher', 'principal', 'supportTeacher'] });

  /* ---- podstawa programowa ------------------------------------------------------------ */
  r.get('/api/curriculum/completion', (ctx) => {
    const { subjectId, classId } = ctx.query;
    if (!subjectId || !classId) throw httpError(400, 'Podaj subjectId i classId.');
    if (!ctx.db.get('classes', classId)) throw httpError(404, 'Nie ma takiej klasy.');
    return completion(ctx.db, subjectId, classId);
  }, { roles: ['staff'] });

  r.get('/api/curriculum', (ctx) => {
    const db = ctx.db;
    const level = ctx.query.classId ? classLevel(db, ctx.query.classId) : (ctx.query.level ? +ctx.query.level : null);
    const items = curriculumFor(db, ctx.query.subjectId || null, level).filter((x) => !ctx.query.subjectId || x.subjectId === ctx.query.subjectId)
      .slice().sort(curriculumOrder);
    return {
      items: items.map((x) => curriculumView(db, x)),
      total: db.col('curriculum').length,
      levels: [...new Set(db.col('curriculum').map((x) => x.level))].sort((a, b) => a - b),
      subjects: editableSubjects(db, ctx.user),
      canEdit: canEditCurriculum(ctx.user),
      formatPath: '/api/curriculum/format'
    };
  }, { roles: ['staff'] });

  /* ---- GAP-2: podstawę programową wpisuje się w aplikacji ------------------------------
     Pusta instalacja ma pustą kolekcję `curriculum`, więc „temat lekcji powiązany z podstawą”
     (3.1.3) i ekran realizacji podstawy (3.3.9) nie mają z czym pracować. Nauczyciel prowadzi
     punkty swoich przedmiotów, dyrektor i administrator — całą szkołę; wklejenie arkusza
     z wydawnictwa (CSV) załatwia rocznik w jednym ruchu. Każdy zapis zostawia wiersz audytu. */

  /** Opis formatu importu — to jest ta „instrukcja na pięć minut” dla nowej szkoły. */
  r.get('/api/curriculum/format', (ctx) => ({
    separator: ';',
    encoding: 'UTF-8',
    columns: CURRICULUM_COLUMNS,
    header: CURRICULUM_COLUMNS.map((c) => c.name).join(';'),
    example: CURRICULUM_EXAMPLE,
    duplicates: 'Wiersz o tym samym przedmiocie, poziomie i kodzie aktualizuje istniejący punkt (tytuł i liczbę godzin) — nie powstaje drugi taki sam.',
    dryRun: 'Wyślij `dryRun: true`, żeby zobaczyć, co zostanie zapisane, zanim cokolwiek trafi do dziennika.',
    subjects: ctx.db.col('subjects').map((x) => ({ id: x.id, name: x.name })),
    note: 'Plik zapisany z arkusza kalkulacyjnego jako CSV (średnik) można wkleić w całości razem z wierszem nagłówka.'
  }), { roles: ['staff'] });

  r.post('/api/curriculum', (ctx) => {
    const db = ctx.db; const b = ctx.body || {};
    const item = validateCurriculum(db, ctx.user, b, null);
    const dup = db.one('curriculum', (x) => x.subjectId === item.subjectId && x.level === item.level && x.code === item.code);
    if (dup) throw httpError(409, `Punkt ${item.code} dla przedmiotu ${item.subjectId} na poziomie ${item.level} już istnieje.`, { code: 'duplicate_item', id: dup.id });
    const row = db.insert('curriculum', Object.assign({ id: util.id('cur') }, item));
    ctx.audit({ action: 'curriculum_create', entity: 'curriculum', entityId: row.id, before: null, after: row, reason: b.reason || null });
    return { ok: true, item: curriculumView(db, row) };
  }, CURRICULUM_WRITE);

  r.patch('/api/curriculum/:id', (ctx) => {
    const db = ctx.db; const b = ctx.body || {};
    const row = db.get('curriculum', ctx.params.id); if (!row) throw httpError(404, 'Nie ma takiego punktu podstawy programowej.');
    assertMaySubject(db, ctx.user, row.subjectId);
    const patch = validateCurriculum(db, ctx.user, Object.assign({}, row, b), row);
    const dup = db.one('curriculum', (x) => x.id !== row.id && x.subjectId === patch.subjectId && x.level === patch.level && x.code === patch.code);
    if (dup) throw httpError(409, `Punkt ${patch.code} dla przedmiotu ${patch.subjectId} na poziomie ${patch.level} już istnieje.`, { code: 'duplicate_item', id: dup.id });
    const before = Object.assign({}, row);
    db.update('curriculum', row.id, patch);
    const after = db.get('curriculum', row.id);
    ctx.audit({ action: 'curriculum_update', entity: 'curriculum', entityId: row.id, before, after, reason: b.reason || null });
    return { ok: true, item: curriculumView(db, after) };
  }, CURRICULUM_WRITE);

  r.delete('/api/curriculum/:id', (ctx) => {
    const db = ctx.db; const b = ctx.body || {};
    const row = db.get('curriculum', ctx.params.id); if (!row) throw httpError(404, 'Nie ma takiego punktu podstawy programowej.');
    assertMaySubject(db, ctx.user, row.subjectId);
    /* Punkt bywa już wpisany w tematach lekcji. Usunięcie go z kolekcji, ale nie z lekcji,
       zostawiłoby w dzienniku odwołanie donikąd, więc odpinamy go i mówimy z ilu lekcji. */
    const unlinked = [];
    for (const l of db.col('lessons')) {
      if (!(l.curriculumItemIds || []).includes(row.id)) continue;
      l.curriculumItemIds = l.curriculumItemIds.filter((x) => x !== row.id);
      unlinked.push(l.id);
    }
    db.remove('curriculum', row.id); db.save();
    ctx.audit({ action: 'curriculum_delete', entity: 'curriculum', entityId: row.id, before: row, after: { unlinkedLessons: unlinked.length }, reason: b.reason || null });
    return { ok: true, removed: row.id, unlinkedLessons: unlinked.length };
  }, CURRICULUM_WRITE);

  /** Import z arkusza: `subject;level;code;title;hours`. Bez `dryRun` zapisuje, z nim tylko liczy. */
  r.post('/api/curriculum/import', (ctx) => {
    const db = ctx.db; const b = ctx.body || {};
    const parsed = parseCurriculumCsv(String(b.csv || ''));
    const errors = parsed.errors.slice();
    const created = [], updated = [], skipped = [];
    const seen = new Set();
    for (const raw of parsed.rows) {
      let item;
      try { item = validateCurriculum(db, ctx.user, raw, null); }
      catch (e) { errors.push({ line: raw._line, error: e.message, code: (e.extra && e.extra.code) || 'invalid' }); continue; }
      const key = item.subjectId + '|' + item.level + '|' + item.code;
      if (seen.has(key)) { skipped.push({ line: raw._line, code: item.code, reason: 'duplicate_in_file' }); continue; }
      seen.add(key);
      const dup = db.one('curriculum', (x) => x.subjectId === item.subjectId && x.level === item.level && x.code === item.code);
      if (dup) updated.push({ line: raw._line, id: dup.id, before: { title: dup.title, hours: dup.hours }, after: item });
      else created.push({ line: raw._line, item });
    }
    const summary = { rows: parsed.rows.length, created: created.length, updated: updated.length, skipped: skipped.length, errors };
    if (b.dryRun) {
      return Object.assign({ ok: errors.length === 0, dryRun: true, applied: false }, summary, {
        preview: created.map((c) => c.item).concat(updated.map((u) => u.after)).slice(0, 200),
        note: 'Nic nie zostało zapisane. Wyślij ten sam plik bez `dryRun`, żeby wprowadzić podstawę.'
      });
    }
    if (errors.length && !b.force) throw httpError(400, `Import wstrzymany: ${errors.length} ${util.plural(errors.length, 'wiersz ma błąd', 'wiersze mają błędy', 'wierszy ma błędy')}. Popraw plik albo wyślij `+ '`force: true`' + `, żeby zapisać resztę.`, { code: 'import_errors', errors });
    const items = [];
    for (const c of created) items.push(db.insert('curriculum', Object.assign({ id: util.id('cur') }, c.item)));
    for (const u of updated) { db.update('curriculum', u.id, u.after); items.push(db.get('curriculum', u.id)); }
    db.save();
    ctx.audit({
      action: 'curriculum_import', entity: 'curriculum', entityId: 'import',
      before: { existing: db.col('curriculum').length - created.length },
      after: { created: created.length, updated: updated.length, skipped: skipped.length, errors: errors.length },
      reason: b.reason || 'Import podstawy programowej z arkusza'
    });
    return Object.assign({ ok: true, dryRun: false, applied: true }, summary, {
      items: items.map((x) => curriculumView(db, x)),
      confirmation: `Zapisano podstawę programową: ${created.length} ${util.plural(created.length, 'nowy punkt', 'nowe punkty', 'nowych punktów')}, ${updated.length} ${util.plural(updated.length, 'zaktualizowany', 'zaktualizowane', 'zaktualizowanych')}.`
    });
  }, Object.assign({ maxBody: 4 * 1024 * 1024 }, CURRICULUM_WRITE));

  /* ---- sprawdziany zapowiedziane (3.1.19) --------------------------------------------- */
  r.get('/api/tests/check', (ctx) => {
    const classId = ctx.query.classId, date = ctx.query.date || D.today(ctx.db);
    if (!classId) throw httpError(400, 'Podaj classId.');
    return limitCheck(ctx.db, classId, date, ctx.query.kind || LIMITED);
  }, { roles: ['staff'] });

  r.get('/api/tests', (ctx) => {
    const db = ctx.db; const classId = ctx.query.classId || null;
    const from = ctx.query.from || util.addDays(D.today(db), -7), to = ctx.query.to || util.addDays(D.today(db), 30);
    const rows = db.col('tests').filter((t) => (!classId || t.classId === classId) && t.date >= from && t.date <= to)
      .sort((a, b) => (a.date < b.date ? -1 : 1))
      .map((t) => Object.assign({}, t, { subjectName: (db.get('subjects', t.subjectId) || {}).name, teacherName: D.userLabel(db.get('users', t.teacherId)) }));
    return { from, to, classId, limits: db.data.config.testLimits, tests: rows, check: classId ? limitCheck(db, classId, ctx.query.date || D.today(db), LIMITED) : null };
  }, { roles: ['staff', 'student', 'parent'] });

  r.post('/api/tests', (ctx) => {
    const db = ctx.db; const b = ctx.body || {};
    const classId = b.classId, subjectId = b.subjectId, date = b.date;
    const kind = TEST_KINDS.includes(b.kind) ? b.kind : LIMITED;
    if (!classId || !subjectId || !date) throw httpError(400, 'Podaj klasę, przedmiot i datę sprawdzianu.');
    if (!db.get('classes', classId)) throw httpError(404, 'Nie ma takiej klasy.');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw httpError(400, 'Data musi mieć format RRRR-MM-DD.');
    if (!D.teacherTeaches(db, ctx.user, subjectId, classId)) throw httpError(403, 'Sprawdzian może zapowiedzieć tylko nauczyciel uczący tego przedmiotu w tym oddziale.', { code: 'not_subject_teacher' });
    const check = limitCheck(db, classId, date, kind);
    if (check.inPast) throw httpError(400, check.notice, Object.assign({ code: 'test_in_past' }, check));
    if (check.limitReached) throw httpError(409, check.warning, Object.assign({ code: 'test_limit' }, check));
    // Krótsza zapowiedź jest dopuszczalna (np. termin przesunięty na prośbę klasy), ale zostaje
    // odnotowana w rejestrze zmian i wraca do nauczyciela jako ostrzeżenie.
    const row = db.insert('tests', { id: util.id('tst'), classId, subjectId, teacherId: ctx.user.id, date, scope: String(b.scope || '').trim(), kind, announcedOn: D.today(db), daysAhead: check.daysAhead, shortNotice: check.shortNotice });
    ctx.audit({ action: 'test_announce', entity: 'test', entityId: row.id, before: null, after: row, reason: check.shortNotice ? check.notice : null });
    return { ok: true, test: row, check: limitCheck(db, classId, date, kind), warning: check.warning, notice: check.notice, shortNotice: check.shortNotice };
  }, { roles: ['teacher', 'principal'] });

  r.delete('/api/tests/:id', (ctx) => {
    const db = ctx.db; const t = db.get('tests', ctx.params.id);
    if (!t) throw httpError(404, 'Nie ma takiego sprawdzianu.');
    if (t.teacherId !== ctx.user.id && ctx.user.role !== 'principal') throw httpError(403, 'Termin może odwołać tylko jego autor lub dyrekcja.', { code: 'forbidden' });
    db.remove('tests', t.id);
    ctx.audit({ action: 'test_cancel', entity: 'test', entityId: t.id, before: t, after: null, reason: (ctx.body && ctx.body.reason) || null });
    return { ok: true };
  }, { roles: ['teacher', 'principal'] });
}

module.exports = { register, completion, limitCheck, weekRange, parseCurriculumCsv, CURRICULUM_COLUMNS };
