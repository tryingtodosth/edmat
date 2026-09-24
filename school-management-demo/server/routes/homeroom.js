'use strict';
/* 3.2 — Wychowawca klasy. Klasyfikacja, zachowanie, usprawiedliwienia, dokumenty i świadectwa,
   zamknięcie semestru, raporty frekwencji, komunikacja z Radą Rodziców, numery w dzienniku,
   wypisanie ucznia, grupy międzyoddziałowe, kontrola liczby godzin i przekazanie dziennika dyrekcji. */
const D = require('../lib/domain');
const U = require('../lib/util');
const { httpError } = require('../lib/router');
const LA = require('../lib/log-access');
const { countsFor } = require('./log-comments');

const HR = { roles: ['homeroom', 'principal'] };
const PRINCIPAL = { roles: ['principal'] };

/* Katalog osiągnięć, które wolno umieścić na świadectwie (§ 20 rozporządzenia o świadectwach). */
const ACHIEVEMENT_KINDS = [
  { id: 'konkurs_wojewodzki', label: 'Konkurs przedmiotowy o zasięgu co najmniej wojewódzkim', onCertificate: true },
  { id: 'konkurs_ponadwojewodzki', label: 'Konkurs ponadwojewódzki lub ogólnopolski', onCertificate: true },
  { id: 'zawody_sportowe', label: 'Zawody sportowe co najmniej na szczeblu powiatowym', onCertificate: true },
  { id: 'osiagniecia_artystyczne', label: 'Osiągnięcia artystyczne co najmniej na szczeblu powiatowym', onCertificate: true },
  { id: 'wolontariat', label: 'Aktywność na rzecz środowiska szkolnego, wolontariat', onCertificate: true },
  { id: 'konkurs_szkolny', label: 'Konkurs szkolny', onCertificate: false },
  { id: 'inne', label: 'Inne osiągnięcie (tylko do kartoteki)', onCertificate: false }];

/* ---------------------------------------------------------------- odmiana przez przypadki (miejscownik) */
const SOFT = [['ch', 'sze'], ['st', 'ście'], ['sł', 'śle'], ['zd', 'ździe'], ['sn', 'śnie'], ['ł', 'le'], ['t', 'cie'], ['d', 'dzie'], ['r', 'rze'], ['k', 'ce'], ['g', 'dze'], ['n', 'nie'], ['m', 'mie'], ['p', 'pie'], ['b', 'bie'], ['w', 'wie'], ['f', 'fie'], ['s', 'sie'], ['z', 'zie']];
function soften(stem) {
  if (/(sz|cz|rz|dz|ż|ź|ś|ć|ń|c|j|l)$/.test(stem)) return stem + 'i';
  for (const [end, rep] of SOFT) if (stem.endsWith(end)) return stem.slice(0, -end.length) + rep;
  return stem + 'ie';
}
function locMasc(w) {
  if (/ek$/.test(w) && w.length > 3) return w.slice(0, -2) + 'ku';
  if (/(k|g|ch|h|sz|cz|rz|ż|dz|c|j|l|ń|ś|ź|ć)$/.test(w)) return w + 'u';
  return soften(w);
}
function locFem(w) {
  if (/ia$/.test(w)) return w.slice(0, -1) + 'i';
  if (/ja$/.test(w)) return w.slice(0, -2) + 'i';
  if (/(ska|cka|dzka)$/.test(w)) return w.slice(0, -1) + 'iej';
  if (/a$/.test(w)) return soften(w.slice(0, -1));
  return w; // żeńskie nazwisko zakończone spółgłoską jest nieodmienne
}
/** Miejscownik imienia/nazwiska: locative('Anna','K') → 'Annie', locative('Piotr','M') → 'Piotrze'. */
function locative(word, sex) {
  const w = String(word == null ? '' : word).trim(); if (!w) return '';
  if (sex === 'K') return locFem(w);
  if (/(ski|cki|dzki)$/.test(w)) return w + 'm';
  if (/a$/.test(w)) return locFem(w); // Sikora, Zaręba — nazwiska męskie na -a
  return locMasc(w);
}
/** Miejscownik nazwy miejscowości: 'Kraków' → 'Krakowie', 'Zakopane' → 'Zakopanem'. */
function locativePlace(place) {
  const w = String(place == null ? '' : place).trim().replace(/^w(e)?\s+/i, ''); if (!w) return '';
  if (/ów$/.test(w)) return w.slice(0, -2) + 'owie';
  if (/ia$/.test(w)) return w.slice(0, -1) + 'i';
  if (/a$/.test(w)) return locFem(w);
  if (/e$/.test(w)) return w + 'm';
  if (/o$/.test(w)) return w.slice(0, -1) + 'u';
  if (/(k|g|ch|h|sz|cz|rz|ż|dz|c|j|l)$/.test(w)) return w + 'u';
  if (/ń$/.test(w)) return w.slice(0, -1) + 'niu';
  if (/(w|m|b|p)$/.test(w)) return w + 'iu';
  return soften(w);
}
const stripPrep = (s) => String(s == null ? '' : s).trim().replace(/^w(e)?\s+/i, '');

/* ---------------------------------------------------------------- pomocnicze */
function classIdOf(ctx) {
  const cid = (ctx.params && ctx.params.classId) || (ctx.query && ctx.query.classId) || (ctx.body && ctx.body.classId) || ctx.user.homeroomOf || (ctx.user.role === 'principal' ? (ctx.db.col('classes')[0] || {}).id : null);
  if (!cid) throw httpError(400, 'Nie wskazano klasy.', { code: 'no_class' });
  return cid;
}
/** Dostęp: wychowawca (także pełniący obowiązki) tej klasy albo dyrekcja. */
function scope(ctx) {
  const cid = classIdOf(ctx); const cls = ctx.db.get('classes', cid);
  if (!cls) throw httpError(404, 'Nie ma takiej klasy.');
  if (ctx.user.role !== 'principal' && !D.isHomeroomOf(ctx.db, ctx.user, cid)) throw httpError(403, `Dostęp do dziennika klasy ${cls.name} ma wychowawca tej klasy i dyrekcja.`, { code: 'not_homeroom' });
  return { cid, cls, db: ctx.db, cfg: ctx.db.data.config };
}
function roster(db, classId, opts) {
  const o = opts || {};
  return db.col('students').filter((s) => s.classId === classId && (o.all || s.status !== 'removed'))
    .sort((a, b) => ((a.rollNo || 900) - (b.rollNo || 900)) || a.lastName.localeCompare(b.lastName, 'pl'));
}
const sname = (s) => (s ? (s.rollNo ? s.rollNo + '. ' : '') + s.lastName + ' ' + s.firstName : '');
/** OPS-03 — wypisanie decyzją administracyjną musi odciąć ucznia od bieżącego dziennika dokładnie tak,
    jak robi to zamknięcie wpisu w księdze przy przeniesieniu: sam `status: 'removed'` zostawiał ucznia
    na listach obecności, w grupach, z czynnym loginem i z dostępem opiekuna do ocen klasy. Dane
    historyczne (oceny, frekwencja, uwagi) zostają nietknięte. Jedna implementacja dla obu ścieżek
    mieszka w księdze uczniów — tu tylko z niej korzystamy. */
const { closeEnrolment } = require('./registry');
const semOf = (ctx) => +(ctx.query.semester || (ctx.body && ctx.body.semester) || D.semesterOf(ctx.db));
function subjectsOf(db, classId) {
  return D.subjectsOfClass(db, classId).map((id) => db.data.subjects.find((s) => s.id === id) || { id, name: id })
    .sort((a, b) => a.name.localeCompare(b.name, 'pl'));
}
function gradeOf(db, sid, subjectId, sem) {
  const g = D.studentGrades(db, sid, subjectId, sem);
  const proposed = g.proposed ? g.proposed.value : null, final = g.final ? g.final.value : null;
  return { subjectId, proposed, final, value: final || proposed, average: g.average, partials: g.partial.length, missing: !final };
}
function behaviorOf(db, sid, sem) {
  const rows = db.col('behaviorGrades').filter((b) => b.studentId === sid && +b.semester === +sem);
  const proposed = rows.filter((b) => b.kind === 'proposed').slice(-1)[0] || null;
  const final = rows.filter((b) => b.kind === 'final').slice(-1)[0] || null;
  return { proposed: proposed ? proposed.value : null, final: final ? final.value : null, value: (final && final.value) || (proposed && proposed.value) || null };
}
function gradeNumber(value, cfg) { const p = D.parseGrade(value, cfg); return p && p.base != null ? p.base : (p && p.value != null ? p.value : null); }
function averageOfGrades(values, cfg) {
  const nums = values.map((v) => gradeNumber(v, cfg)).filter((n) => n != null);
  return nums.length ? Math.round((nums.reduce((a, b) => a + b, 0) / nums.length) * 100) / 100 : null;
}
function honoursFor(avg, behavior, cfg) { return avg != null && avg >= cfg.honorsAverage && !!behavior && cfg.honorsBehavior.includes(behavior); }
function lockFor(db, sem, classId) { return db.col('semesterLocks').find((l) => +l.semester === +sem && (l.classId === classId || !l.classId) && !l.reopened) || null; }
function assertOpen(db, sem, classId, what) {
  if (D.isSemesterLocked(db, sem, classId)) throw httpError(409, `Semestr ${sem} w klasie ${classId} jest zamknięty — ${what || 'zmiana'} wymaga odblokowania przez dyrekcję.`, { code: 'semester_locked' });
}
/** Wysyła gotowy do druku dokument HTML bezpośrednio (otwierany w nowej karcie, nie pobierany). */
function sendHtml(ctx, html) { ctx.res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' }); ctx.res.end(html); }
function docOpts(db, extra) {
  const cfg = db.data.config; const today = D.today(db);
  return Object.assign({ school: cfg.school.name, schoolMeta: cfg.school.address + ' · RSPO ' + cfg.school.rspo, date: 'Kraków, ' + U.fmtDate(today), printed: U.fmtDate(today) }, extra || {});
}
const esc = D.xmlEsc;

function register(r, app) { /* eslint-disable-line no-unused-vars */

  /* ---------------------------------------------------------------- komentarze do wpisów dziennika
     Ta sama bramka, co w `scope()`: wychowawca klasy (także p.o.) albo dyrekcja — nikt więcej. */
  LA.register('homeroom-logbook', {
    label: 'Dziennik wychowawcy',
    roles: ['homeroom', 'principal'],
    find: (db, user, entryId) => {
      const cls = db.get('classes', entryId);
      if (!cls) return null;
      if (user.role !== 'principal' && !D.isHomeroomOf(db, user, cls.id)) return null;
      return { id: cls.id, classId: cls.id, className: cls.name, status: cls.logbookStatus || 'open' };
    }
  });
  /* Wiersz historii ucznia. Identyfikator jest złożony (`<kolekcja>:<id>`), żeby przetrwał dopisanie
     do historii innych źródeł niż świadectwa z poprzedniej szkoły. */
  LA.register('pupil-history', {
    label: 'Historia ucznia',
    roles: ['homeroom', 'principal'],
    find: (db, user, entryId) => {
      const m = /^([a-zA-Z]+):(.+)$/.exec(String(entryId));
      if (!m || m[1] !== 'reportCardHistory') return null;
      const row = db.get('reportCardHistory', m[2]);
      if (!row) return null;
      const s = db.get('students', row.studentId);
      if (!s) return null;
      if (user.role !== 'principal' && !D.isHomeroomOf(db, user, s.classId)) return null;
      return Object.assign({ entryId: String(entryId) }, row);
    }
  });
  /** Wiersze historii ucznia z trwałym identyfikatorem wpisu i licznikiem komentarzy. */
  function historyRows(db, user, studentId) {
    const rows = db.col('reportCardHistory').filter((h) => h.studentId === studentId)
      .map((h) => Object.assign({ entryId: 'reportCardHistory:' + h.id }, h));
    const counts = countsFor(db, user, 'pupil-history', rows.map((h) => h.entryId));
    return rows.map((h) => Object.assign({ comments: counts[h.entryId] }, h));
  }

  /* ---------------------------------------------------------------- przegląd (nagłówek ekranu) */
  r.get('/api/homeroom/overview', (ctx) => {
    const { db, cid, cls, cfg } = scope(ctx); const sem = semOf(ctx);
    const list = roster(db, cid); const subjects = subjectsOf(db, cid);
    let sum = 0, n = 0, atRisk = 0, missing = 0;
    const att = { total: 0, present: 0 };
    for (const s of list) {
      const values = subjects.map((sub) => gradeOf(db, s.id, sub.id, sem));
      missing += values.filter((v) => !v.final).length;
      if (values.some((v) => v.value === '1')) atRisk++;
      let a = averageOfGrades(values.map((v) => v.value), cfg);
      if (a == null) { const run = values.map((v) => v.average).filter((x) => x != null); a = run.length ? run.reduce((x, y) => x + y, 0) / run.length : null; }
      if (a != null) { sum += a; n++; }
      const st = D.attendanceFor(db, s.id, D.semester(db, sem).from, D.today(db));
      att.total += st.counted; att.present += st.present; // zwolnienia poza podstawą, jak w statystyce ucznia
    }
    const warnings = db.col('messages').filter((m) => m.kind === 'warning' && m.classId === cid);
    return {
      classId: cid, className: cls.name, semester: sem, today: D.today(db), year: cfg.year,
      homeroomTeacher: D.userLabel(db.get('users', cls.homeroomTeacherId)),
      students: list.length, subjects: subjects.length,
      classAverage: n ? Math.round((sum / n) * 100) / 100 : null,
      attendancePercent: att.total ? Math.round((att.present / att.total) * 1000) / 10 : null,
      atRisk, missingFinals: missing,
      pendingExcuses: db.col('excuses').filter((e) => e.status === 'pending' && list.some((s) => s.id === e.studentId)).length,
      unreadWarnings: warnings.reduce((acc, m) => acc + m.toUserIds.filter((u) => !m.readBy[u]).length, 0),
      locked: D.isSemesterLocked(db, sem, cid), lock: lockFor(db, sem, cid),
      logbookStatus: cls.logbookStatus || 'open', councilMembers: (cls.councilParentIds || []).length,
      classificationMeeting: D.semester(db, sem).classificationMeeting
    };
  }, HR);

  /* ---------------------------------------------------------------- 3.2.1 tablica klasyfikacji */
  r.get('/api/homeroom/classification', (ctx) => {
    const { db, cid, cls, cfg } = scope(ctx); const sem = semOf(ctx);
    const subjects = subjectsOf(db, cid);
    const warnings = [];
    const students = roster(db, cid).map((s) => {
      const bySubject = {}; const values = [];
      for (const sub of subjects) {
        const g = gradeOf(db, s.id, sub.id, sem); bySubject[sub.id] = g; values.push(g.value);
        if (g.value === '1') warnings.push({ studentId: s.id, student: sname(s), subjectId: sub.id, subject: sub.name, value: g.value, kind: g.final ? 'failing' : 'failingProposed' });
      }
      const avg = averageOfGrades(values, cfg); const beh = behaviorOf(db, s.id, sem);
      const running = subjects.map((sub) => bySubject[sub.id].average).filter((a) => a != null);
      return {
        studentId: s.id, name: sname(s), rollNo: s.rollNo, firstName: s.firstName, lastName: s.lastName,
        subjects: bySubject, average: avg, behavior: beh, honours: honoursFor(avg, beh.value, cfg),
        runningAverage: running.length ? Math.round((running.reduce((a, b) => a + b, 0) / running.length) * 100) / 100 : null,
        missing: subjects.filter((sub) => !bySubject[sub.id].final).length,
        failing: subjects.filter((sub) => bySubject[sub.id].value === '1').map((sub) => sub.name),
        complete: subjects.every((sub) => bySubject[sub.id].final)
      };
    });
    const avgs = students.map((s) => (s.average != null ? s.average : s.runningAverage)).filter((a) => a != null);
    return {
      classId: cid, className: cls.name, semester: sem, semesterName: D.semester(db, sem).name,
      classificationMeeting: D.semester(db, sem).classificationMeeting, proposedDeadline: D.semester(db, sem).proposedDeadline,
      subjects, students, warnings,
      summary: {
        students: students.length, subjects: subjects.length,
        missingFinals: students.reduce((a, s) => a + s.missing, 0),
        atRisk: students.filter((s) => s.failing.length).length,
        honours: students.filter((s) => s.honours).length,
        classAverage: avgs.length ? Math.round((avgs.reduce((a, b) => a + b, 0) / avgs.length) * 100) / 100 : null,
        locked: D.isSemesterLocked(db, sem, cid)
      }
    };
  }, HR);

  /* ---------------------------------------------------------------- 3.2.2 ocena zachowania */
  function behaviorProposal(db, s, sem) {
    const cfg = db.data.config; const period = D.semester(db, sem);
    // Uwaga wycofana (z powodem, w rejestrze zmian) nie może dalej obniżać oceny zachowania.
    const remarks = db.col('remarks').filter((x) => x.studentId === s.id && !x.deleted && (!x.date || (x.date >= period.from && x.date <= period.to)));
    const positive = remarks.filter((x) => x.kind === 'positive'), negative = remarks.filter((x) => x.kind === 'negative');
    const points = (cfg.behaviorPoints.start || 100) + remarks.reduce((a, x) => a + (x.points || 0), 0);
    const att = D.attendanceFor(db, s.id, period.from, period.to);
    const scale = cfg.behaviorScale;
    // Progi czyta się od najwyższego — kolejność w konfiguracji szkoły nie może o tym decydować.
    const base = (cfg.behaviorPoints.thresholds.slice().sort((a, b) => b.min - a.min).find((t) => points >= t.min) || { grade: scale[scale.length - 1] }).grade;
    let idx = Math.max(0, scale.indexOf(base)); const basis = [`punkty: ${points}`];
    if (att.percent != null && att.percent < 85) { idx++; basis.push(`frekwencja ${U.fmtAvg(att.percent)} % poniżej 85 %`); }
    if (att.unexcusedPercent != null && att.unexcusedPercent > 10) { idx++; basis.push(`nieusprawiedliwione ${U.fmtAvg(att.unexcusedPercent)} % godzin`); }
    if (negative.length >= 3) { idx++; basis.push(`uwagi negatywne: ${negative.length}`); }
    if (positive.length >= 3 && idx > 0) { idx--; basis.push(`uwagi pozytywne: ${positive.length}`); }
    idx = Math.max(0, Math.min(scale.length - 1, idx));
    return {
      studentId: s.id, name: sname(s), points, positive: positive.length, negative: negative.length,
      attendancePercent: att.percent, unexcusedPercent: att.unexcusedPercent, suggested: scale[idx], basis,
      teacherRemarks: remarks.map((x) => ({ id: x.id, kind: x.kind, points: x.points, text: x.text, date: x.date, teacher: D.userLabel(db.get('users', x.teacherId)) })),
      current: behaviorOf(db, s.id, sem)
    };
  }
  r.get('/api/homeroom/behavior', (ctx) => {
    const { db, cid, cfg } = scope(ctx); const sem = semOf(ctx);
    return { classId: cid, semester: sem, kindLabel: sem === 1 ? 'śródroczna' : 'roczna', scale: cfg.behaviorScale, thresholds: cfg.behaviorPoints, students: roster(db, cid).map((s) => behaviorProposal(db, s, sem)) };
  }, HR);
  r.post('/api/homeroom/behavior', (ctx) => {
    const { db, cid, cfg } = scope(ctx); const b = ctx.body || {}; const sem = +(b.semester || D.semesterOf(db));
    const s = db.get('students', b.studentId);
    if (!s || s.classId !== cid) throw httpError(404, 'Uczeń nie należy do tej klasy.');
    assertOpen(db, sem, cid, 'zmiana oceny zachowania');
    const kind = b.kind === 'final' ? 'final' : 'proposed';
    const proposal = behaviorProposal(db, s, sem);
    const value = b.value || proposal.suggested;
    if (!cfg.behaviorScale.includes(value)) throw httpError(400, `Ocena zachowania musi być jedną z: ${cfg.behaviorScale.join(', ')}.`, { code: 'bad_behavior_value' });
    const override = value !== proposal.suggested;
    if (override && !String(b.reason || '').trim()) throw httpError(400, `Ocena inna niż wyliczona (${proposal.suggested}) wymaga uzasadnienia.`, { code: 'reason_required' });
    const existing = db.col('behaviorGrades').find((x) => x.studentId === s.id && +x.semester === sem && x.kind === kind);
    const before = existing ? { value: existing.value, points: existing.points } : null;
    const row = existing
      ? db.update('behaviorGrades', existing.id, { value, points: proposal.points, suggested: proposal.suggested, override, reason: b.reason || null, byUserId: ctx.user.id, at: U.now() })
      : db.insert('behaviorGrades', { id: U.id('beh'), studentId: s.id, semester: sem, kind, value, points: proposal.points, suggested: proposal.suggested, override, reason: b.reason || null, basis: proposal.basis, byUserId: ctx.user.id, at: U.now() });
    ctx.audit({ action: existing ? 'behavior_grade_updated' : 'behavior_grade_set', entity: 'behaviorGrades', entityId: row.id, before, after: { value, kind, semester: sem, override }, reason: b.reason || null });
    if (kind === 'final' || b.notify) D.notifyParentsOf(db, s.id, 'behavior', `Ocena zachowania (${sem === 1 ? 'śródroczna' : 'roczna'}): ${value}.`, { link: '/oceny' });
    return { ok: true, grade: row, proposal };
  }, HR);

  /* ---------------------------------------------------------------- 3.2.3 zagrożeni nieklasyfikowaniem */
  /** Kto może nie zostać klasyfikowany i dlaczego — wspólna podstawa listy 3.2.3 i pism 3.2.14. */
  function notClassifiedRisk(db, cid, sem) {
    const cfg = db.data.config; const threshold = cfg.unexcusedThresholdPercent;
    const names = Object.fromEntries(db.data.subjects.map((s) => [s.id, s.name]));
    const subjects = subjectsOf(db, cid);
    const period = D.semester(db, sem) || {};
    const today = D.today(db);
    /** Poniżej tylu zapisanych godzin proporcja nic nie znaczy (2 z 3 lekcji w październiku to nie
     *  „połowa czasu przeznaczonego na zajęcia”), więc kryterium absencji jeszcze nie działa. */
    const minHours = Number.isInteger(cfg.classificationMinHours) ? cfg.classificationMinHours : 10;
    /** Brak ocen jest sygnałem dopiero po terminie propozycji albo u ucznia dopisanego w trakcie. */
    const gradesDue = !period.proposedDeadline || today >= period.proposedDeadline;
    const students = [];
    for (const s of roster(db, cid)) {
      const by = D.attendanceBySubject(db, s.id, sem);
      /* GAP-6 — jedna data przyjęcia: `enrolledAt` jest kanoniczne, `joinedAt` zostaje aliasem
         (czyta je jeszcze `enrolledOn()` w routes/attendance.js). Import kreatora stempluje teraz
         początek roku szkolnego, a nie dzień wgrania pliku, więc wrześniowy rocznik nie wygląda już
         na dopisany w trakcie roku — „dopisany w trakcie” to data przyjęcia po początku semestru. */
      const joined = s.enrolledAt || s.joinedAt || null;
      const joinedMidYear = !!(joined && period.from && joined > period.from);
      const over = [];
      for (const sub of subjects) {
        const st = by[sub.id];
        const g = gradeOf(db, s.id, sub.id, sem);
        const label = names[sub.id] || sub.id;
        // Art. 44k ust. 1: podstawą nieklasyfikowania jest nieobecność (usprawiedliwiona czy nie) na
        // ponad połowie godzin. Nieusprawiedliwione powyżej progu decydują tylko o tym, czy egzamin
        // klasyfikacyjny wymaga zgody rady pedagogicznej (ust. 3).
        const absentPercent = st ? st.absentPercent : null;
        const unexcusedPercent = st ? st.unexcusedPercent : null;
        const hours = st ? st.counted : 0;
        const enough = hours >= minHours;
        const overAbsence = enough && absentPercent != null && absentPercent > 50;
        const overUnexcused = enough && unexcusedPercent != null && unexcusedPercent > threshold;
        const noBasis = g.partials === 0 && !g.final && hours > 0 && (gradesDue || joinedMidYear);
        if (!overAbsence && !overUnexcused && !noBasis) continue;
        over.push({
          subjectId: sub.id, subject: label,
          unexcused: st ? st.nb : 0, excusedAbsence: st ? st.u : 0, absent: st ? st.absent : 0,
          total: hours, percent: unexcusedPercent, absentPercent, grades: g.partials,
          reason: overAbsence ? 'absence' : overUnexcused ? 'unexcused' : 'noGrades',
          /** true → egzamin klasyfikacyjny tylko za zgodą rady pedagogicznej (art. 44k ust. 3) */
          consentRequired: overUnexcused,
          hours: noBasis && !overAbsence
            ? `brak ocen cząstkowych z ${hours} ${U.plural(hours, 'godziny', 'godzin', 'godzin')} (${label})`
            : `${st ? st.nb : 0} z ${hours} ${U.plural(hours, 'godziny', 'godzin', 'godzin')} (${label})`
        });
      }
      over.sort((a, b) => (b.absentPercent || 0) - (a.absentPercent || 0) || (b.percent || 0) - (a.percent || 0));
      if (over.length) students.push({
        studentId: s.id, name: sname(s), joinedAt: joined, joinedMidYear, subjects: over, worst: over[0],
        consentRequired: over.some((x) => x.consentRequired),
        withoutGrades: over.filter((x) => x.reason === 'noGrades').map((x) => x.subject)
      });
    }
    return { threshold, minHours, gradesDue, students };
  }
  r.get('/api/homeroom/at-risk', (ctx) => {
    const { db, cid } = scope(ctx); const sem = semOf(ctx);
    const r1 = notClassifiedRisk(db, cid, sem);
    return {
      classId: cid, semester: sem, threshold: r1.threshold, minHours: r1.minHours, gradesDue: r1.gradesDue,
      students: r1.students, count: r1.students.length,
      withoutGrades: r1.students.filter((x) => x.withoutGrades.length).length,
      consentRequired: r1.students.filter((x) => x.consentRequired).length,
      note: `Uczeń nieobecny na ponad połowie godzin z przedmiotu — także usprawiedliwiony — może nie zostać klasyfikowany (art. 44k ust. 1); przed radą należy ustalić termin egzaminu klasyfikacyjnego. Przy ponad ${r1.threshold} % godzin nieusprawiedliwionych egzamin wymaga zgody rady pedagogicznej.`
    };
  }, HR);

  /* ---------------------------------------------------------------- 3.2.4 usprawiedliwienia */
  function excuseRow(db, e) {
    const s = db.get('students', e.studentId); const by = db.get('users', e.byUserId);
    return Object.assign({}, e, { student: sname(s), studentId: e.studentId, from: e.from, to: e.to || e.from, byName: D.userLabel(by), days: U.daysBetween(e.from, e.to || e.from) + 1 });
  }
  /* P30 — wiersz roboczy (`draft`) nie jest jeszcze wpisem w dzienniku: decyzja o usprawiedliwieniu
     nie może go dotknąć, bo nauczyciel dopiero kończy sprawdzanie listy obecności. */
  function matchingAttendance(db, e) {
    const to = e.to || e.from;
    return db.col('attendance').filter((a) => a.studentId === e.studentId && !a.draft && a.date >= e.from && a.date <= to && (!e.lessonNos || !e.lessonNos.length || e.lessonNos.includes(a.lessonNo)));
  }
  r.get('/api/homeroom/excuses', (ctx) => {
    const { db, cid } = scope(ctx); const ids = roster(db, cid, { all: true }).map((s) => s.id);
    const status = ctx.query.status;
    const list = db.col('excuses').filter((e) => ids.includes(e.studentId) && (!status || e.status === status))
      .sort((a, b) => (a.at < b.at ? 1 : -1))
      .map((e) => Object.assign(excuseRow(db, e), { affectedLessons: matchingAttendance(db, e).filter((a) => a.status === 'nb').length }));
    return { classId: cid, excuses: list, pending: list.filter((e) => e.status === 'pending').length };
  }, HR);
  function decide(ctx, ids, decision, reason) {
    const { db, cid } = scope(ctx);
    const students = roster(db, cid, { all: true }).map((s) => s.id);
    if (!ids.length) throw httpError(400, 'Nie wskazano wniosków do rozpatrzenia.', { code: 'no_ids' });
    if (decision !== 'approve' && decision !== 'reject') throw httpError(400, 'Decyzja musi być typu approve albo reject.');
    if (decision === 'reject' && !String(reason || '').trim()) throw httpError(400, 'Odrzucenie wniosku wymaga podania powodu — rodzic zobaczy go w wiadomości.', { code: 'reason_required' });
    const out = [];
    for (const id of ids) {
      const e = db.get('excuses', id);
      if (!e || !students.includes(e.studentId)) throw httpError(404, `Nie ma wniosku ${id} w tej klasie.`);
      const sem = D.semesterOf(db, e.from);
      assertOpen(db, sem, cid, 'usprawiedliwienie nieobecności');
      const before = { status: e.status, rejectReason: e.rejectReason };
      let changed = 0;
      if (decision === 'approve') {
        for (const a of matchingAttendance(db, e)) {
          if (a.status !== 'nb') continue;
          const ab = { status: a.status, excuseId: a.excuseId || null };
          a.status = 'u'; a.excuseId = e.id; a.byUserId = ctx.user.id; a.at = U.now(); changed++;
          ctx.audit({ action: 'attendance_excused', entity: 'attendance', entityId: a.id, before: ab, after: { status: 'u', excuseId: e.id }, reason: 'Usprawiedliwienie ' + e.id });
        }
        e.status = 'approved'; e.rejectReason = null;
      } else {
        // Wycofanie wcześniejszej zgody musi przywrócić nieobecności nieusprawiedliwione —
        // inaczej pomyłkowe „przyjmij” zostawiałoby godziny usprawiedliwione na zawsze.
        for (const a of matchingAttendance(db, e)) {
          if (a.excuseId !== e.id) continue;
          const ab = { status: a.status, excuseId: a.excuseId };
          a.status = 'nb'; a.excuseId = null; a.byUserId = ctx.user.id; a.at = U.now(); changed++;
          ctx.audit({ action: 'attendance_unexcused', entity: 'attendance', entityId: a.id, before: ab, after: { status: 'nb', excuseId: null }, reason: 'Cofnięcie usprawiedliwienia ' + e.id });
        }
        e.status = 'rejected'; e.rejectReason = String(reason).trim();
      }
      e.decidedBy = ctx.user.id; e.decidedAt = U.now(); db.save();
      const s = db.get('students', e.studentId);
      const subject = decision === 'approve' ? `Usprawiedliwienie przyjęte — ${s.firstName} ${s.lastName}` : `Usprawiedliwienie odrzucone — ${s.firstName} ${s.lastName}`;
      const body = decision === 'approve'
        ? `Wniosek z ${U.fmtDate(e.from)}${e.to && e.to !== e.from ? '–' + U.fmtDate(e.to) : ''} został przyjęty. Nieobecności (${changed}) zapisano jako usprawiedliwione.`
        : `Wniosek z ${U.fmtDate(e.from)}${e.to && e.to !== e.from ? '–' + U.fmtDate(e.to) : ''} został odrzucony. Powód: ${String(reason).trim()}`;
      if (e.byUserId) {
        D.sendMessage(db, { fromUserId: ctx.user.id, toUserIds: [e.byUserId], subject, body, kind: 'message', classId: cid, studentId: e.studentId, excuseId: e.id });
        D.notify(db, e.byUserId, 'excuse', subject, { link: '/wiadomosci' });
      }
      ctx.audit({ action: decision === 'approve' ? 'excuse_approved' : 'excuse_rejected', entity: 'excuses', entityId: e.id, before, after: { status: e.status, rejectReason: e.rejectReason }, reason: reason || null });
      out.push(Object.assign(excuseRow(db, e), { changedAttendance: changed }));
    }
    return { ok: true, decision, count: out.length, excuses: out, changedAttendance: out.reduce((a, e) => a + (e.changedAttendance || 0), 0) };
  }
  r.post('/api/homeroom/excuses/decide', (ctx) => {
    const b = ctx.body || {}; const ids = b.ids && b.ids.length ? b.ids : (b.id ? [b.id] : []);
    return decide(ctx, ids, b.decision, b.reason);
  }, HR);
  r.post('/api/homeroom/excuses/:id/decision', (ctx) => {
    const b = ctx.body || {};
    return decide(ctx, [ctx.params.id], b.decision, b.reason);
  }, HR);

  /* ---------------------------------------------------------------- 3.2.5 odmiana nazwisk (miejscownik) */
  function declensionRow(db, s) {
    const d = s.declension || {};
    const suggested = { firstNameLocative: locative(s.firstName, s.sex), lastNameLocative: locative(s.lastName, s.sex), birthPlaceLocative: locativePlace(s.birthPlace) };
    const issues = [];
    const check = (field, stored, suggestion, label) => {
      const cur = stripPrep(stored);
      if (!cur) { issues.push({ field, status: 'missing', text: `${label}: brak formy miejscownika` }); return 'missing'; }
      if (cur.toLowerCase() === String(field === 'birthPlaceLocative' ? s.birthPlace : s[field.replace('Locative', '')] || '').toLowerCase()) { issues.push({ field, status: 'suspect', text: `${label}: forma nieodmieniona („${cur}”)` }); return 'suspect'; }
      if (cur.toLowerCase() !== suggestion.toLowerCase()) { issues.push({ field, status: 'suspect', text: `${label}: „${cur}” różni się od formy z reguły („${suggestion}”)` }); return 'suspect'; }
      return 'ok';
    };
    const status = {
      firstNameLocative: check('firstNameLocative', d.firstNameLocative, suggested.firstNameLocative, 'Imię'),
      lastNameLocative: check('lastNameLocative', d.lastNameLocative, suggested.lastNameLocative, 'Nazwisko'),
      birthPlaceLocative: check('birthPlaceLocative', s.birthPlaceLocative, suggested.birthPlaceLocative, 'Miejsce urodzenia')
    };
    return {
      studentId: s.id, name: sname(s), firstName: s.firstName, lastName: s.lastName, sex: s.sex, birthPlace: s.birthPlace,
      stored: { firstNameLocative: d.firstNameLocative || null, lastNameLocative: d.lastNameLocative || null, birthPlaceLocative: s.birthPlaceLocative || null },
      suggested, status, issues, confirmed: !!d.confirmedAt,
      ok: issues.length === 0,
      formula: `…o ${suggested.firstNameLocative} ${suggested.lastNameLocative}…, urodzon${s.sex === 'K' ? 'ej' : 'ym'} w ${suggested.birthPlaceLocative}`
    };
  }
  r.get('/api/homeroom/declension', (ctx) => {
    const { db, cid } = scope(ctx);
    const rows = roster(db, cid).map((s) => declensionRow(db, s));
    const flagged = rows.filter((x) => !x.ok);
    return { classId: cid, students: ctx.query.all === '1' ? rows : flagged, all: rows.length, flagged: flagged.length, note: 'Blankiet MEN nie pozwala na korektę po wydruku — formy miejscownika sprawdza się przed generowaniem świadectw.' };
  }, HR);
  r.patch('/api/homeroom/declension/:studentId', (ctx) => {
    const { db, cid } = scope(ctx); const b = ctx.body || {};
    const s = db.get('students', ctx.params.studentId);
    if (!s || s.classId !== cid) throw httpError(404, 'Uczeń nie należy do tej klasy.');
    const before = { declension: Object.assign({}, s.declension), birthPlaceLocative: s.birthPlaceLocative };
    const suggested = { firstNameLocative: locative(s.firstName, s.sex), lastNameLocative: locative(s.lastName, s.sex), birthPlaceLocative: locativePlace(s.birthPlace) };
    s.declension = Object.assign({}, s.declension, {
      firstNameLocative: stripPrep(b.firstNameLocative) || (b.accept ? suggested.firstNameLocative : s.declension && s.declension.firstNameLocative) || null,
      lastNameLocative: stripPrep(b.lastNameLocative) || (b.accept ? suggested.lastNameLocative : s.declension && s.declension.lastNameLocative) || null,
      confirmedBy: ctx.user.id, confirmedAt: U.now()
    });
    const bp = stripPrep(b.birthPlaceLocative) || (b.accept ? suggested.birthPlaceLocative : stripPrep(s.birthPlaceLocative));
    if (bp) s.birthPlaceLocative = 'w ' + bp;
    db.save();
    ctx.audit({ action: 'declension_confirmed', entity: 'students', entityId: s.id, before, after: { declension: s.declension, birthPlaceLocative: s.birthPlaceLocative }, reason: b.reason || 'Weryfikacja odmiany przed wydrukiem świadectw' });
    return { ok: true, student: declensionRow(db, s) };
  }, HR);

  /* ---------------------------------------------------------------- 3.2.6 / 3.2.7 świadectwa i historia */
  function reportCardData(db, s, sem, cfg, resolution) {
    const subjects = subjectsOf(db, s.classId);
    const grades = subjects.map((sub) => { const g = gradeOf(db, s.id, sub.id, sem); return { subjectId: sub.id, subject: sub.name, value: g.value || '—', proposed: g.proposed, final: g.final }; });
    const cls = db.get('classes', s.classId);
    const early = (cls.level || 0) <= 3;                 // klasy 1–3: świadectwo opisowe
    const finals = grades.filter((g) => g.final);
    const missingFinals = grades.filter((g) => !g.final).map((g) => g.subject);
    // Średnia i wyróżnienie liczą się wyłącznie z ustalonych ocen klasyfikacyjnych — propozycja nie
    // jest oceną i nie może trafić na świadectwo.
    const avg = missingFinals.length ? null : averageOfGrades(finals.map((g) => g.final), cfg);
    const beh = behaviorOf(db, s.id, sem);
    const failing = grades.filter((g) => g.final === '1').map((g) => g.subject);
    const notClassified = grades.filter((g) => g.final === 'nk').map((g) => g.subject);
    const honours = !early && !missingFinals.length && !failing.length && honoursFor(avg, beh.final, cfg);
    const next = (cls.level || 0) + 1;
    const finishes = (cls.level || 0) >= 8;              // ósmoklasista kończy szkołę, nie jest promowany
    const descriptive = db.col('descriptiveGrades').filter((d) => d.studentId === s.id && +d.semester === +sem);
    let promotion;
    if (notClassified.length) promotion = `Uczeń nie został klasyfikowany z ${notClassified.join(', ')} — o ${finishes ? 'ukończeniu szkoły' : 'promocji'} rozstrzygnie egzamin klasyfikacyjny.`;
    else if (failing.length) promotion = `Uczeń otrzymał ocenę niedostateczną z ${failing.join(', ')} — nie ${finishes ? 'kończy szkoły' : `otrzymuje promocji do klasy ${next}`} bez zdanego egzaminu poprawkowego.`;
    else if (missingFinals.length) promotion = `Klasyfikacja niekompletna — brak ocen rocznych z ${missingFinals.join(', ')}.`;
    else if (sem === 1) promotion = 'Klasyfikacja śródroczna — o promocji rozstrzyga klasyfikacja roczna.';
    else promotion = finishes ? 'Uczeń ukończył szkołę podstawową.' : `Uczeń otrzymuje promocję do klasy ${next}.`;
    return {
      studentId: s.id, student: `${s.firstName} ${s.lastName}`, name: sname(s), classId: s.classId, className: cls.name,
      birthDate: s.birthDate, birthPlace: s.birthPlace, birthPlaceLocative: stripPrep(s.birthPlaceLocative) || locativePlace(s.birthPlace),
      grades, average: avg, behavior: beh.value || '—', honours,
      early, descriptive: descriptive.map((d) => ({ area: d.area, text: d.text })),
      missingFinals, failing, notClassified, complete: !missingFinals.length,
      promotion,
      honoursClause: honours ? `Średnia ocen ${U.fmtAvg(avg)} i zachowanie ${beh.value} — uczeń otrzymuje ${finishes ? 'świadectwo ukończenia szkoły' : `promocję do klasy ${next}`} z wyróżnieniem.` : null,
      resolution, history: db.col('reportCardHistory').filter((h) => h.studentId === s.id),
      achievements: (s.achievements || []).filter((a) => a.onCertificate && !a.archived).map((a) => a.title)
    };
  }
  r.post('/api/homeroom/report-cards', (ctx) => {
    const { db, cid, cls, cfg } = scope(ctx); const b = ctx.body || {}; const sem = +(b.semester || D.semesterOf(db));
    const meeting = D.semester(db, sem).classificationMeeting;
    const resolution = `Uchwała Rady Pedagogicznej nr ${b.resolutionNo || '1/' + cfg.year} z dnia ${U.fmtDate(b.resolutionDate || meeting)}`;
    const docs = [];
    for (const s of roster(db, cid)) {
      const data = reportCardData(db, s, sem, cfg, resolution);
      const existing = db.col('documents').find((d) => d.kind === 'reportCard' && d.studentId === s.id && +d.semester === sem && d.schoolYear === cfg.year);
      const row = existing
        ? db.update('documents', existing.id, { data, honours: data.honours, resolution, byUserId: ctx.user.id, at: U.now() })
        : db.insert('documents', { id: U.id('doc_rc'), kind: 'reportCard', classId: cid, studentId: s.id, title: `Świadectwo ${sem === 2 ? 'promocyjne' : 'śródroczne'} — ${data.student}`, semester: sem, schoolYear: cfg.year, honours: data.honours, resolution, data, byUserId: ctx.user.id, at: U.now() });
      ctx.audit({ action: 'report_card_generated', entity: 'documents', entityId: row.id, after: { studentId: s.id, honours: data.honours, average: data.average }, reason: resolution });
      docs.push(row);
    }
    return { ok: true, classId: cid, className: cls.name, semester: sem, resolution, count: docs.length, honours: docs.filter((d) => d.honours).length, documents: docs.map((d) => ({ id: d.id, studentId: d.studentId, title: d.title, honours: d.honours, average: d.data.average, behavior: d.data.behavior })) };
  }, HR);
  r.get('/api/homeroom/report-cards', (ctx) => {
    const { db, cid } = scope(ctx);
    const docs = db.col('documents').filter((d) => d.kind === 'reportCard' && d.classId === cid);
    return { classId: cid, count: docs.length, documents: docs };
  }, HR);
  function certificateHtml(db, data, cfg, opts) {
    const o = opts || {};
    // Klasy 1–3: jedna ocena opisowa zamiast tabeli stopni (§ 21 rozporządzenia o świadectwach).
    const body = data.early
      ? `<table><caption>Ocena opisowa — obszary edukacji</caption><thead><tr><th scope="col">Obszar edukacji</th><th scope="col">Osiągnięcia ucznia</th></tr></thead><tbody>
${data.descriptive.length ? data.descriptive.map((d) => `<tr><th scope="row">${esc(d.area)}</th><td>${esc(d.text)}</td></tr>`).join('') : '<tr><td colspan="2">Ocena opisowa nie została jeszcze sporządzona.</td></tr>'}
<tr><th scope="row">Zachowanie</th><td>${esc(data.behavior)}</td></tr></tbody></table>`
      : `<table><caption>Oceny klasyfikacyjne — obowiązkowe zajęcia edukacyjne</caption><thead><tr><th scope="col">Obowiązkowe zajęcia edukacyjne</th><th scope="col">Ocena</th></tr></thead><tbody>
${data.grades.map((g) => `<tr><th scope="row">${esc(g.subject)}</th><td>${esc(g.value)}</td></tr>`).join('')}
<tr><th scope="row">Zachowanie</th><td>${esc(data.behavior)}</td></tr>
<tr><th scope="row">Średnia ocen</th><td>${esc(U.fmtAvg(data.average))}</td></tr></tbody></table>`;
    return `<section class="cert"${o.first ? '' : ' style="page-break-before:always"'}>
<h1>${esc(o.title || (data.honours ? 'Świadectwo z wyróżnieniem' : 'Świadectwo'))}</h1>
<p class="lead">${esc(data.student)}, urodzon${esc(data.sex === 'K' ? 'a' : 'y')} ${esc(U.fmtDate(data.birthDate))} w ${esc(data.birthPlaceLocative)}, uczeń klasy ${esc(data.className)} ${esc(cfg.school.name)}, uzyskał w roku szkolnym ${esc(cfg.year)} następujące ${data.early ? 'osiągnięcia' : 'oceny'}.</p>
${body}
${data.complete ? '' : `<p class="note"><b>Dokument roboczy — nie do wydruku na blankiecie:</b> brak ocen klasyfikacyjnych z ${esc(data.missingFinals.join(', '))}.</p>`}
${data.achievements.length ? `<p><b>Szczególne osiągnięcia:</b> ${esc(data.achievements.join('; '))}.</p>` : ''}
${data.history.length ? `<p class="note">Historia świadectw (szkoła poprzednia): ${data.history.map((h) => esc(`${h.schoolYear} ${h.className} — ${h.schoolName}`)).join('; ')}.</p>` : ''}
<p>${esc(data.honoursClause || data.promotion)}</p>
<p class="note">${esc(data.resolution)}.</p>
<div class="sign"><span>Wychowawca klasy</span><span>Dyrektor szkoły</span></div></section>`;
  }
  r.get('/api/homeroom/report-cards/print', (ctx) => {
    const { db, cid, cls, cfg } = scope(ctx); const sem = semOf(ctx);
    const meeting = D.semester(db, sem).classificationMeeting;
    const only = ctx.query.studentId ? [db.get('students', ctx.query.studentId)] : roster(db, cid);
    if (!only[0] || only[0].classId !== cid) throw httpError(404, 'Uczeń nie należy do tej klasy.');
    const resolution = `Uchwała Rady Pedagogicznej nr ${ctx.query.resolutionNo || '1/' + cfg.year} z dnia ${U.fmtDate(meeting)}`;
    const body = only.map((s, i) => certificateHtml(db, Object.assign(reportCardData(db, s, sem, cfg, resolution), { sex: s.sex }), cfg, { first: i === 0 })).join('\n');
    ctx.audit({ action: 'report_card_printed', entity: 'documents', entityId: cid, after: { students: only.length, semester: sem } });
    return sendHtml(ctx, D.printHtml(`Świadectwa — klasa ${cls.name}`, body, docOpts(db, { docNo: 'Blankiet MEN-I/1a-w/2', margin: '18mm' })));
  }, HR);
  r.get('/api/homeroom/history/:studentId', (ctx) => {
    const { db, cid } = scope(ctx); const s = db.get('students', ctx.params.studentId);
    if (!s || s.classId !== cid) throw httpError(404, 'Uczeń nie należy do tej klasy.');
    return { studentId: s.id, name: sname(s), transferredFrom: s.transferredFrom || null, joinedAt: s.enrolledAt || s.joinedAt || null, history: historyRows(db, ctx.user, s.id) };
  }, HR);
  r.post('/api/homeroom/history', (ctx) => {
    const { db, cid, cfg } = scope(ctx); const b = ctx.body || {};
    const s = db.get('students', b.studentId);
    if (!s || s.classId !== cid) throw httpError(404, 'Uczeń nie należy do tej klasy.');
    if (!b.schoolYear || !b.className) throw httpError(400, 'Podaj rok szkolny i klasę, z których pochodzą oceny.');
    const grades = (b.grades || []).map((g) => {
      const p = D.parseGrade(g.value, cfg);
      if (!p) throw httpError(400, `Ocena „${g.value}” z przedmiotu ${g.subjectId} nie jest poprawna.`, { code: 'bad_grade' });
      if (!db.data.subjects.some((x) => x.id === g.subjectId)) throw httpError(400, `Nie ma przedmiotu ${g.subjectId}.`);
      return { subjectId: g.subjectId, value: p.text };
    });
    if (!grades.length) throw httpError(400, 'Podaj co najmniej jedną ocenę z poprzedniej szkoły.');
    const row = db.insert('reportCardHistory', { id: U.id('hist'), studentId: s.id, schoolYear: b.schoolYear, className: b.className, schoolName: b.schoolName || s.transferredFrom || 'Szkoła poprzednia', grades, behavior: b.behavior || null, note: b.note || null, source: 'transfer', byUserId: ctx.user.id, at: U.now() });
    ctx.audit({ action: 'report_card_history_added', entity: 'reportCardHistory', entityId: row.id, after: { studentId: s.id, schoolYear: b.schoolYear, grades: grades.length }, reason: b.note || 'Uczeń przeniesiony w trakcie cyklu kształcenia' });
    return { ok: true, entry: row, history: historyRows(db, ctx.user, s.id) };
  }, HR);

  /* ---------------------------------------------------------------- 3.2.8 wydruk próbny na blankiet MEN */
  r.get('/api/homeroom/print/test-certificate', (ctx) => {
    const { db, cid, cls, cfg } = scope(ctx); const sem = semOf(ctx);
    const s = ctx.query.studentId ? db.get('students', ctx.query.studentId) : roster(db, cid)[0];
    if (!s || s.classId !== cid) throw httpError(404, 'Uczeń nie należy do tej klasy.');
    const data = Object.assign(reportCardData(db, s, sem, cfg, `Uchwała Rady Pedagogicznej nr 1/${cfg.year} z dnia ${U.fmtDate(D.semester(db, sem).classificationMeeting)}`), { sex: s.sex });
    const geometry = `<div class="geom"><h2>Geometria blankietu MEN-I/1a-w/2</h2><ul>
<li>Marginesy strony: <b>18 mm</b> z każdej strony (górny, dolny, lewy, prawy).</li>
<li>Blok danych ucznia: 42 mm od górnej krawędzi, wysokość 24 mm.</li>
<li>Tabela ocen: szerokość 174 mm, wiersz 8 mm, obramowanie 0,3 mm.</li>
<li>Linie podpisów: 25 mm od dolnej krawędzi, długość 60 mm, odstęp 14 mm.</li>
<li>Znacznik pasowania: krzyżyki w rogach pola zadruku (18 mm od krawędzi).</li></ul>
<p class="note">Wydruk próbny na czystej kartce A4: przyłóż arkusz do oryginalnego blankietu pod światło i sprawdź, czy tekst oraz linie podpisów pokrywają się z polami blankietu. Blankiet MEN nie pozwala na korektę po wydruku.</p></div>`;
    const css = '.geom ul{font-size:9pt}.mark{position:fixed;width:6mm;height:6mm;border:0.3mm solid #000}.m1{top:0;left:0;border-right:0;border-bottom:0}.m2{top:0;right:0;border-left:0;border-bottom:0}.m3{bottom:0;left:0;border-right:0;border-top:0}.m4{bottom:0;right:0;border-left:0;border-top:0}';
    const body = '<div class="mark m1"></div><div class="mark m2"></div><div class="mark m3"></div><div class="mark m4"></div>' + geometry + certificateHtml(db, data, cfg, { first: true, title: 'Świadectwo promocyjne — WYDRUK PRÓBNY' });
    ctx.audit({ action: 'certificate_test_print', entity: 'students', entityId: s.id, after: { margin: '18mm', blank: 'MEN-I/1a-w/2' } });
    return sendHtml(ctx, D.printHtml(`Wydruk próbny świadectwa — ${cls.name}`, body, docOpts(db, { margin: '18mm', docNo: 'Blankiet MEN-I/1a-w/2 · marginesy 18 mm', css })));
  }, HR);

  /* ---------------------------------------------------------------- 3.2.9 świadectwa z wyróżnieniem (seria) */
  r.get('/api/homeroom/print/honours', (ctx) => {
    const { db, cid, cls, cfg } = scope(ctx); const sem = semOf(ctx);
    const meeting = D.semester(db, sem).classificationMeeting;
    const resolution = `Uchwała Rady Pedagogicznej nr ${ctx.query.resolutionNo || '1/' + cfg.year} z dnia ${U.fmtDate(meeting)}`;
    const list = roster(db, cid).map((s) => Object.assign(reportCardData(db, s, sem, cfg, resolution), { sex: s.sex })).filter((d) => d.honours);
    const head = `<h1>Świadectwa z wyróżnieniem — klasa ${esc(cls.name)}</h1><p class="note">Kryterium: średnia ocen co najmniej ${esc(U.fmtAvg(cfg.honorsAverage))} oraz zachowanie ${esc(cfg.honorsBehavior.join(' lub '))}. Zakwalifikowanych: ${list.length}.</p>`;
    const body = head + (list.length ? list.map((d) => certificateHtml(db, d, cfg, { title: 'Świadectwo z wyróżnieniem' })).join('\n') : '<p>Żaden uczeń nie spełnia w tej chwili kryteriów świadectwa z wyróżnieniem.</p>');
    ctx.audit({ action: 'honours_certificates_printed', entity: 'classes', entityId: cid, after: { count: list.length, semester: sem } });
    return sendHtml(ctx, D.printHtml(`Świadectwa z wyróżnieniem — ${cls.name}`, body, docOpts(db, { margin: '18mm', docNo: 'Blankiet MEN-I/1a-w/2' })));
  }, HR);
  r.get('/api/homeroom/honours', (ctx) => {
    const { db, cid, cfg } = scope(ctx); const sem = semOf(ctx);
    const rows = roster(db, cid).map((s) => {
      const data = reportCardData(db, s, sem, cfg, null);
      // Podgląd na bieżąco (z propozycji) obok rozstrzygnięcia z ustalonych ocen klasyfikacyjnych —
      // wyróżnienie przyznaje się wyłącznie na podstawie tych drugich.
      const running = averageOfGrades(data.grades.map((g) => g.value), cfg);
      const beh = behaviorOf(db, s.id, sem);
      return {
        studentId: s.id, name: sname(s), average: data.average != null ? data.average : running, behavior: beh.value,
        complete: data.complete, missingFinals: data.missingFinals,
        honours: data.honours, provisional: !data.complete,
        honoursPreview: honoursFor(running, beh.value, cfg)
      };
    });
    return { classId: cid, semester: sem, honorsAverage: cfg.honorsAverage, honorsBehavior: cfg.honorsBehavior, students: rows, count: rows.filter((x) => x.honours).length, preview: rows.filter((x) => x.honoursPreview).length };
  }, HR);

  /* ---------------------------------------------------------------- 3.2.10 osiągnięcia szczególne */
  r.get('/api/homeroom/achievements', (ctx) => {
    const { db, cid } = scope(ctx);
    const rows = [];
    for (const s of roster(db, cid, { all: true })) for (const a of (s.achievements || [])) rows.push(Object.assign({ studentId: s.id, student: sname(s) }, a));
    return { classId: cid, kinds: ACHIEVEMENT_KINDS, achievements: rows, onCertificate: rows.filter((a) => a.onCertificate && !a.archived).length };
  }, HR);
  r.post('/api/homeroom/achievements', (ctx) => {
    const { db, cid } = scope(ctx); const b = ctx.body || {};
    const s = db.get('students', b.studentId);
    if (!s || s.classId !== cid) throw httpError(404, 'Uczeń nie należy do tej klasy.');
    const kind = ACHIEVEMENT_KINDS.find((k) => k.id === b.kind);
    if (!kind) throw httpError(400, `Nieznany rodzaj osiągnięcia. Dozwolone: ${ACHIEVEMENT_KINDS.map((k) => k.id).join(', ')}.`, { code: 'bad_kind' });
    if (!String(b.title || '').trim()) throw httpError(400, 'Podaj treść osiągnięcia, która ma trafić do kartoteki.');
    const wants = !!b.onCertificate;
    if (wants && !kind.onCertificate) throw httpError(400, `Osiągnięcie „${kind.label}” nie może być wpisane na świadectwie — przepisy dopuszczają tylko osiągnięcia co najmniej na szczeblu powiatowym oraz aktywność na rzecz środowiska szkolnego.`, { code: 'not_certifiable' });
    const row = { id: U.id('ach'), kind: kind.id, kindLabel: kind.label, title: String(b.title).trim(), level: b.level || null, date: b.date || D.today(db), onCertificate: wants, archived: false, byUserId: ctx.user.id, at: U.now() };
    s.achievements = s.achievements || []; s.achievements.push(row); db.save();
    ctx.audit({ action: 'achievement_added', entity: 'students', entityId: s.id, after: row, reason: wants ? 'Wpis na świadectwie' : 'Wpis do kartoteki' });
    return { ok: true, achievement: row, allowedOnCertificate: kind.onCertificate };
  }, HR);

  /* ---------------------------------------------------------------- 3.2.11 zamknięcie i odblokowanie semestru */
  r.get('/api/homeroom/semester/status', (ctx) => {
    const { db, cid } = scope(ctx);
    return { classId: cid, semesters: db.data.config.semesters.map((s) => ({ id: s.id, name: s.name, from: s.from, to: s.to, classificationMeeting: s.classificationMeeting, locked: D.isSemesterLocked(db, s.id, cid), lock: lockFor(db, s.id, cid) })) };
  }, HR);
  r.post('/api/homeroom/semester/close', (ctx) => {
    const { db, cid, cls } = scope(ctx); const b = ctx.body || {}; const sem = +(b.semester || D.semesterOf(db));
    if (!db.data.config.semesters.some((s) => s.id === sem)) throw httpError(400, 'Nie ma takiego semestru.');
    if (lockFor(db, sem, cid)) throw httpError(409, `Semestr ${sem} w klasie ${cls.name} jest już zamknięty.`, { code: 'already_locked' });
    /* Zamknięcie semestru zamraża wszystkie oceny, frekwencję i uwagi oddziału, a odblokowuje je
       wyłącznie dyrekcja. Jedno kliknięcie w połowie półrocza potrafiło więc unieruchomić dziennik
       całej klasy na miesiące — bez żadnego pytania. Przed posiedzeniem rady zamknięcie wymaga
       świadomego potwierdzenia (`force`) i uzasadnienia, które trafia do rejestru zmian. */
    const period = D.semester(db, sem) || {};
    const due = period.classificationMeeting || period.classificationDeadline || period.to || null;
    const today = D.today(db);
    if (due && today < due && !b.force) {
      throw httpError(409, `Klasyfikacja ${sem === 1 ? 'śródroczna' : 'roczna'} w klasie ${cls.name} jest zaplanowana na ${U.fmtDate(due)}, a dziś jest ${U.fmtDate(today)}. Zamknięcie semestru zablokuje oceny i frekwencję całego oddziału — jeżeli rada pedagogiczna podjęła uchwałę wcześniej, potwierdź to (force) i podaj podstawę.`,
        { code: 'too_early', classificationMeeting: due, today, semester: sem, classId: cid });
    }
    if (due && today < due && !String(b.reason || '').trim()) throw httpError(400, 'Wcześniejsze zamknięcie semestru wymaga podania podstawy — trafi ona do rejestru zmian.', { code: 'reason_required' });
    const reason = String(b.reason || '').trim() || `Klasyfikacja ${sem === 1 ? 'śródroczna' : 'roczna'} zatwierdzona na posiedzeniu rady pedagogicznej.`;
    const early = !!(due && today < due);
    const lock = db.insert('semesterLocks', { id: U.id('lock'), semester: sem, classId: cid, byUserId: ctx.user.id, at: U.now(), reopened: false, reopenedBy: null, reason, resolutionNo: b.resolutionNo || null, early, closedOn: today, classificationMeeting: due });
    ctx.audit({ action: 'semester_closed', entity: 'semesterLocks', entityId: lock.id, after: { semester: sem, classId: cid, early, closedOn: today, classificationMeeting: due }, reason });
    const teachers = [...new Set(db.col('timetable').filter((t) => t.classId === cid).map((t) => t.teacherId))];
    for (const t of teachers) D.notify(db, t, 'semester', `Semestr ${sem} w klasie ${cls.name} został zamknięty — wpisy wsteczne wymagają zgody dyrekcji.`, { link: '/oceny' });
    return { ok: true, lock, lockedTeachers: teachers.length, note: 'Nauczyciele przedmiotów nie zmienią ocen z datą wstecz bez formalnej zgody dyrekcji.' };
  }, HR);
  r.post('/api/homeroom/semester/reopen', (ctx) => {
    const db = ctx.db; const b = ctx.body || {};
    const cid = b.classId || ctx.params.classId; const sem = +(b.semester || D.semesterOf(db));
    if (!cid) throw httpError(400, 'Wskaż klasę do odblokowania.');
    const lock = lockFor(db, sem, cid);
    if (!lock) throw httpError(404, `Semestr ${sem} w klasie ${cid} nie jest zamknięty.`);
    const reason = String(b.reason || '').trim();
    if (!reason) throw httpError(400, 'Odblokowanie semestru wymaga uzasadnienia (formalna zgoda dyrekcji).', { code: 'reason_required' });
    const before = { reopened: lock.reopened };
    db.update('semesterLocks', lock.id, { reopened: true, reopenedBy: ctx.user.id, reopenedAt: U.now(), reopenReason: reason });
    ctx.audit({ action: 'semester_reopened', entity: 'semesterLocks', entityId: lock.id, before, after: { reopened: true, reopenedBy: ctx.user.id }, reason });
    const cls = db.get('classes', cid);
    if (cls && cls.homeroomTeacherId) D.notify(db, cls.homeroomTeacherId, 'semester', `Dyrekcja odblokowała semestr ${sem} w klasie ${cls.name}. Powód: ${reason}`, { link: '/wychowawca' });
    return { ok: true, lock: db.get('semesterLocks', lock.id), locked: D.isSemesterLocked(db, sem, cid) };
  }, PRINCIPAL);

  /* ---------------------------------------------------------------- 3.2.12 miesięczny raport frekwencji */
  r.get('/api/homeroom/attendance/monthly', (ctx) => {
    const { db, cid, cls } = scope(ctx);
    const month = /^\d{4}-\d{2}$/.test(ctx.query.month || '') ? ctx.query.month : D.today(db).slice(0, 7);
    const from = month + '-01', to = month + '-31';
    const rows = roster(db, cid).map((s) => {
      const st = D.attendanceFor(db, s.id, from, to);
      return { studentId: s.id, rollNo: s.rollNo || null, name: sname(s), excused: st.u + st.zw, unexcused: st.nb, late: st.sp, lateMinutes: st.lateMinutes, earlyLeave: st.zw, hours: st.total, countedHours: st.counted, percent: st.percent };
    });
    const totals = rows.reduce((a, x) => ({ excused: a.excused + x.excused, unexcused: a.unexcused + x.unexcused, late: a.late + x.late, earlyLeave: a.earlyLeave + x.earlyLeave, hours: a.hours + x.hours }), { excused: 0, unexcused: 0, late: 0, earlyLeave: 0, hours: 0 });
    ctx.audit({ action: 'attendance_report_exported', entity: 'classes', entityId: cid, after: { month, format: ctx.query.format || 'json' } });
    if (ctx.query.format === 'csv') {
      const header = ['Nr', 'Uczeń', 'Usprawiedliwione', 'Nieusprawiedliwione', 'Spóźnienia', 'Zwolnienia (zw)', 'Godziny razem', 'Frekwencja %'];
      const body = D.csv(rows.map((x) => [x.rollNo || '', x.name, x.excused, x.unexcused, x.late, x.earlyLeave, x.hours, U.fmtAvg(x.percent)]), header);
      return { __raw: true, body, contentType: 'text/csv; charset=utf-8', filename: `frekwencja-${cls.name}-${month}.csv` };
    }
    return { classId: cid, className: cls.name, month, from, to, rows, totals, legend: { u: 'usprawiedliwiona', nb: 'nieusprawiedliwiona', sp: 'spóźnienie', zw: 'zwolnienie / wyjście wcześniejsze' } };
  }, HR);
  r.get('/api/homeroom/print/attendance', (ctx) => {
    const { db, cid, cls } = scope(ctx);
    const month = /^\d{4}-\d{2}$/.test(ctx.query.month || '') ? ctx.query.month : D.today(db).slice(0, 7);
    const from = month + '-01', to = month + '-31';
    const rows = roster(db, cid).map((s) => { const st = D.attendanceFor(db, s.id, from, to); return `<tr><th scope="row">${esc(sname(s))}</th><td>${st.u + st.zw}</td><td>${st.nb}</td><td>${st.sp}</td><td>${st.zw}</td><td>${st.total}</td><td>${esc(U.fmtAvg(st.percent))}</td></tr>`; }).join('');
    const body = `<h1>Miesięczny raport frekwencji — klasa ${esc(cls.name)}</h1><p class="note">Okres: ${esc(month)} · na posiedzenie rady pedagogicznej.</p>
<table><caption>Miesięczny raport frekwencji — ${esc(month)}</caption><thead><tr><th scope="col">Uczeń</th><th scope="col">Usprawiedliwione</th><th scope="col">Nieusprawiedliwione</th><th scope="col">Spóźnienia</th><th scope="col">Zwolnienia (zw)</th><th scope="col">Godziny</th><th scope="col">Frekwencja %</th></tr></thead><tbody>${rows}</tbody></table>
<div class="sign"><span>Wychowawca klasy</span><span>Dyrektor szkoły</span></div>`;
    return sendHtml(ctx, D.printHtml(`Frekwencja ${cls.name} — ${month}`, body, docOpts(db, { docNo: 'Raport frekwencji' })));
  }, HR);

  /* ---------------------------------------------------------------- 3.2.13 wiadomość do Rady Rodziców */
  r.get('/api/homeroom/council', (ctx) => {
    const { db, cid, cls } = scope(ctx);
    const members = (cls.councilParentIds || []).map((uid) => { const u = db.get('users', uid); const kids = (u && u.childrenIds || []).map((k) => db.get('students', k)).filter((s) => s && s.classId === cid); return { userId: uid, name: D.userLabel(u), email: u && u.email, children: kids.map((k) => sname(k)) }; });
    return { classId: cid, className: cls.name, note: cls.councilNote || null, members, count: members.length, allParents: [...new Set(roster(db, cid).flatMap((s) => (s.parentIds || []).filter((p) => D.guardianStanding(db, p, s.id).ok)))].length };
  }, HR);
  r.post('/api/homeroom/broadcast', (ctx) => {
    const { db, cid, cls } = scope(ctx); const b = ctx.body || {};
    const audience = b.audience === 'allParents' ? 'allParents' : 'council';
    const to = audience === 'council' ? (cls.councilParentIds || [])
      : [...new Set(roster(db, cid).flatMap((s) => (s.parentIds || []).filter((p) => D.guardianStanding(db, p, s.id).ok)))];   // F1: legitymacja opiekuna
    if (!to.length) throw httpError(400, audience === 'council' ? 'Rada Rodziców tej klasy nie ma jeszcze wskazanych członków.' : 'Brak kont rodziców w tej klasie.', { code: 'no_recipients' });
    if (!String(b.subject || '').trim()) throw httpError(400, 'Podaj temat wiadomości.');
    const attachments = (b.attachments || []).map((a) => ({ name: a.name, size: a.size || 0, type: a.type || 'application/pdf' }));
    const msg = D.sendMessage(db, {
      id: U.id('msg'), fromUserId: ctx.user.id, toUserIds: to, subject: String(b.subject).trim(),
      body: String(b.body || '').trim() || 'Porządek najbliższego zebrania z rodzicami w załączniku.',
      kind: 'broadcast', confidential: false, requiresAck: !!b.requiresAck, attachments, classId: cid, audience
    });
    for (const uid of to) D.notify(db, uid, 'message', `Wiadomość do Rady Rodziców klasy ${cls.name}: ${msg.subject}`, { link: '/wiadomosci' });
    ctx.audit({ action: 'council_broadcast_sent', entity: 'messages', entityId: msg.id, after: { audience, recipients: to.length, attachments: attachments.length }, reason: msg.subject });
    return { ok: true, message: msg, recipients: to.length, audience };
  }, HR);

  /* ---------------------------------------------------------------- 3.2.14 ostrzeżenia o zagrożeniu i potwierdzenia odczytu */
  function riskRoster(db, cid, sem) {
    const subjects = subjectsOf(db, cid); const names = Object.fromEntries(subjects.map((s) => [s.id, s.name]));
    // Pismo do rodziców ostrzega o dwóch rzeczach naraz: o ocenie niedostatecznej i o nieklasyfikowaniu.
    const risk = notClassifiedRisk(db, cid, sem);
    const byStudent = Object.fromEntries(risk.students.map((x) => [x.studentId, x]));
    return roster(db, cid).map((s) => {
      const failing = subjects.map((sub) => gradeOf(db, s.id, sub.id, sem)).filter((g) => g.value === '1').map((g) => names[g.subjectId]);
      const row = byStudent[s.id];
      const absence = row ? row.subjects.filter((x) => x.reason !== 'noGrades').map((x) => x.subject) : [];
      const noGrades = row ? row.withoutGrades : [];
      const consentRequired = !!(row && row.consentRequired);
      return { student: s, failing, absence, noGrades, consentRequired };
    }).filter((x) => x.failing.length || x.absence.length || x.noGrades.length);
  }
  r.post('/api/homeroom/warnings', (ctx) => {
    const { db, cid, cls, cfg } = scope(ctx); const b = ctx.body || {}; const sem = +(b.semester || D.semesterOf(db));
    const meeting = D.semester(db, sem).classificationMeeting;
    const deadline = U.addDays(meeting, -(cfg.warningDaysBeforeClassification || 30));
    const today = D.today(db);
    const risky = riskRoster(db, cid, sem);
    if (!risky.length) return { ok: true, sent: 0, students: 0, deadline, classificationMeeting: meeting, note: 'Nie ma uczniów zagrożonych — nie wysłano ostrzeżeń.' };
    const sent = [];
    for (const { student: s, failing, absence, noGrades, consentRequired } of risky) {
      const parents = (s.parentIds || []).filter((p) => db.get('users', p) && D.guardianStanding(db, p, s.id).scope === 'full');   // F1: pismo o ocenach — tylko pełna legitymacja
      if (!parents.length) continue;
      const kindOfRisk = failing.length && (absence.length || noGrades.length) ? 'oceną niedostateczną i nieklasyfikowaniem'
        : failing.length ? 'oceną niedostateczną' : 'nieklasyfikowaniem';
      const subject = `Zagrożenie ${kindOfRisk} — ${s.firstName} ${s.lastName}`;
      const body = [`Informujemy o zagrożeniu ${sem === 1 ? 'śródroczną' : 'roczną'} ${kindOfRisk}.`,
        failing.length ? `Ocena niedostateczna grozi z przedmiotów: ${failing.join(', ')}.` : null,
        absence.length ? `Nieobecność na ponad połowie godzin (art. 44k ust. 1 ustawy o systemie oświaty): ${absence.join(', ')}.` : null,
        noGrades.length ? `Brak ocen cząstkowych, a więc podstaw do ustalenia oceny: ${noGrades.join(', ')}.` : null,
        consentRequired ? `Ponad ${cfg.unexcusedThresholdPercent} % godzin jest nieusprawiedliwionych — egzamin klasyfikacyjny wymaga zgody rady pedagogicznej.` : null,
        `Posiedzenie klasyfikacyjne: ${U.fmtDate(meeting)}. Pismo wysłano ${U.fmtDate(today)}, na ${U.daysBetween(today, meeting)} dni przed klasyfikacją.`,
        'Prosimy o potwierdzenie odczytu.'].filter(Boolean).join(' ');
      const msg = D.sendMessage(db, { id: U.id('msg'), fromUserId: ctx.user.id, toUserIds: parents, subject, body, kind: 'warning', confidential: false, requiresAck: true, classId: cid, studentId: s.id, semester: sem });
      for (const p of parents) D.notify(db, p, 'warning', subject, { link: '/wiadomosci' });
      ctx.audit({ action: 'failing_warning_sent', entity: 'messages', entityId: msg.id, after: { studentId: s.id, failing, absence, noGrades, consentRequired, recipients: parents.length }, reason: `Ostrzeżenie na ${U.daysBetween(today, meeting)} dni przed klasyfikacją` });
      sent.push({ messageId: msg.id, studentId: s.id, student: sname(s), recipients: parents.length, failing, absence, noGrades, consentRequired });
    }
    return { ok: true, sent: sent.length, students: risky.length, messages: sent, deadline, classificationMeeting: meeting, onTime: today <= deadline, className: cls.name };
  }, HR);
  r.get('/api/homeroom/warnings', (ctx) => {
    const { db, cid, cfg } = scope(ctx); const sem = semOf(ctx);
    const meeting = D.semester(db, sem).classificationMeeting;
    const rows = db.col('messages').filter((m) => m.kind === 'warning' && m.classId === cid).sort((a, b) => (a.at < b.at ? 1 : -1)).map((m) => {
      const s = m.studentId ? db.get('students', m.studentId) : null;
      const recipients = m.toUserIds.map((uid) => {
        const u = db.get('users', uid);
        return { userId: uid, name: D.userLabel(u), role: 'rodzic' + (s ? ' · ' + sname(s) : ''), receipt: m.readBy[uid] ? 'read' : ((m.deliveredTo || []).includes(uid) ? 'delivered' : 'pending'), receiptAt: m.readBy[uid] || null };
      });
      return { messageId: m.id, subject: m.subject, preview: String(m.body || '').slice(0, 160), at: m.at, studentId: m.studentId || null, student: s ? sname(s) : null, requiresAck: !!m.requiresAck, recipients, read: recipients.filter((x) => x.receipt === 'read').length, pending: recipients.filter((x) => x.receipt !== 'read').length };
    });
    return {
      classId: cid, semester: sem, classificationMeeting: meeting,
      deadline: U.addDays(meeting, -(cfg.warningDaysBeforeClassification || 30)),
      daysBefore: cfg.warningDaysBeforeClassification || 30,
      warnings: rows, sent: rows.length,
      read: rows.reduce((a, x) => a + x.read, 0), unread: rows.reduce((a, x) => a + x.pending, 0)
    };
  }, HR);

  /* ---------------------------------------------------------------- 3.2.15 numery w dzienniku */
  r.get('/api/homeroom/roll-call', (ctx) => {
    const { db, cid } = scope(ctx);
    const list = roster(db, cid);
    const alpha = list.slice().sort((a, b) => a.lastName.localeCompare(b.lastName, 'pl') || a.firstName.localeCompare(b.firstName, 'pl'));
    return {
      classId: cid,
      students: alpha.map((s, i) => ({ studentId: s.id, name: `${s.lastName} ${s.firstName}`, rollNo: s.rollNo || null, alphabeticalNo: i + 1, joinedAt: s.enrolledAt || s.joinedAt || null, transferredFrom: s.transferredFrom || null, needsNumber: !s.rollNo })),
      missing: list.filter((s) => !s.rollNo).length,
      nextFree: Math.max(0, ...list.map((s) => s.rollNo || 0)) + 1,
      note: 'Uczeń dopisany w trakcie roku otrzymuje kolejny wolny numer; pozostali zachowują swoje numery, a wpisy w dzienniku nadal wskazują tego samego ucznia.'
    };
  }, HR);
  r.post('/api/homeroom/roll-call', (ctx) => {
    const { db, cid } = scope(ctx); const b = ctx.body || {};
    const mode = b.mode === 'renumber' ? 'renumber' : 'assign';
    if (mode === 'renumber' && !String(b.reason || '').trim()) throw httpError(400, 'Pełne przenumerowanie klasy wymaga uzasadnienia — numery są powiązane z wpisami w dzienniku.', { code: 'reason_required' });
    const list = roster(db, cid);
    const alpha = list.slice().sort((a, b2) => a.lastName.localeCompare(b2.lastName, 'pl') || a.firstName.localeCompare(b2.firstName, 'pl'));
    const changes = [];
    if (mode === 'renumber') {
      alpha.forEach((s, i) => { if (s.rollNo !== i + 1) { changes.push({ studentId: s.id, name: sname(s), from: s.rollNo || null, to: i + 1 }); s.rollNo = i + 1; } });
    } else {
      let next = Math.max(0, ...list.map((s) => s.rollNo || 0));
      for (const s of alpha) { if (!s.rollNo) { next++; changes.push({ studentId: s.id, name: `${s.lastName} ${s.firstName}`, from: null, to: next }); s.rollNo = next; } }
    }
    db.save();
    for (const c of changes) ctx.audit({ action: 'roll_number_assigned', entity: 'students', entityId: c.studentId, before: { rollNo: c.from }, after: { rollNo: c.to }, reason: b.reason || (mode === 'assign' ? 'Nadanie numeru uczniowi dopisanemu w trakcie roku' : 'Przenumerowanie alfabetyczne') });
    return { ok: true, mode, changed: changes.length, changes, students: roster(db, cid).map((s) => ({ studentId: s.id, name: `${s.lastName} ${s.firstName}`, rollNo: s.rollNo })) };
  }, HR);

  /* ---------------------------------------------------------------- 3.2.16 wypisanie ucznia decyzją administracyjną */
  r.post('/api/homeroom/students/:studentId/remove', (ctx) => {
    const { db, cid, cls } = scope(ctx); const b = ctx.body || {};
    const s = db.get('students', ctx.params.studentId);
    if (!s || s.classId !== cid) throw httpError(404, 'Uczeń nie należy do tej klasy.');
    if (s.status === 'removed') throw httpError(409, 'Uczeń jest już wypisany z klasy.', { code: 'already_removed' });
    const decisionNo = String(b.decisionNo || '').trim(); const date = String(b.date || '').trim();
    if (!decisionNo) throw httpError(400, 'Podaj numer decyzji administracyjnej.', { code: 'decision_required' });
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw httpError(400, 'Podaj datę decyzji w formacie RRRR-MM-DD.', { code: 'date_required' });
    const before = { status: s.status, achievements: (s.achievements || []).length, classId: cid };
    s.status = 'removed';
    s.removal = { date, decisionNo, reason: b.reason || null, byUserId: ctx.user.id, at: U.now(), classId: cid };
    s.leftAt = date;
    s.departureDate = date;                                   // D3-14: zegar retencji (klasa dokumentacja-ppp) rusza od odejścia ucznia — bez tej daty nie ruszy nigdy
    s.achievements = (s.achievements || []).map((a) => Object.assign({}, a, { archived: true, archivedAt: U.now(), archivedReason: `Wypisanie z klasy — decyzja ${decisionNo}` }));
    const cut = closeEnrolment(db, s, { reason: `wypisanie z klasy — decyzja ${decisionNo}` });
    db.save();
    ctx.audit({ action: 'student_removed', entity: 'students', entityId: s.id, before, after: { status: 'removed', decisionNo, date, archivedAchievements: s.achievements.length, removedFromGroups: cut.groups, parentsDetached: cut.parents.length, codesVoided: cut.codes, sessionsRevoked: cut.sessions }, reason: b.reason || `Decyzja administracyjna ${decisionNo} z ${U.fmtDate(date)}` });
    D.notify(db, cls.homeroomTeacherId, 'roster', `${sname(s)} wypisany z klasy ${cls.name} (decyzja ${decisionNo}).`, { link: '/wychowawca' });
    return {
      ok: true, student: { studentId: s.id, name: sname(s), status: s.status, removal: s.removal },
      archivedAchievements: s.achievements.length, access: cut,
      note: 'Oceny, frekwencja i osiągnięcia pozostają w bazie — dane zostały zarchiwizowane, nie usunięte.'
    };
  }, HR);

  /* ---------------------------------------------------------------- 3.2.17 strona dziennika na wypadek sytuacji alarmowej */
  r.get('/api/homeroom/print/emergency', (ctx) => {
    const { db, cid, cls } = scope(ctx);
    const rows = roster(db, cid).map((s) => {
      const parents = (s.parentIds || []).map((p) => db.get('users', p)).filter(Boolean)
        .map((p) => Object.assign({}, p, { restricted: !D.guardianStanding(db, p, s.id).ok }));   // F1: wydruk alarmowy z adnotacją
      const contacts = parents.length ? parents.map((p) => `${esc(D.userLabel(p))} — ${esc(p.phone || 'brak telefonu')}${p.email ? ' · ' + esc(p.email) : ''}${p.restricted ? ' — <b>ograniczenie sądowe: nie informować</b>' : ''}`).join('<br>') : '<i>brak kontaktu opiekuna w systemie</i>';
      return `<tr><th scope="row">${esc(sname(s))}</th><td>${esc(U.fmtDate(s.birthDate))}</td><td>${contacts}</td></tr>`;
    }).join('');
    const gdpr = 'Wydruk zawiera dane osobowe uczniów i opiekunów (art. 6 ust. 1 lit. c i e RODO) i służy wyłącznie prowadzeniu ewakuacji lub akcji ratunkowej. Nie wolno go kopiować ani przekazywać osobom nieuprawnionym; po zakończeniu działań należy go zniszczyć w niszczarce i odnotować ten fakt u administratora danych.';
    const body = `<h1>Strona dziennika — sytuacja alarmowa · klasa ${esc(cls.name)}</h1>
<p class="note">Wychowawca: ${esc(D.userLabel(db.get('users', cls.homeroomTeacherId)))} · uczniów: ${roster(db, cid).length} · wydruk: ${esc(U.fmtDate(D.today(db)))}</p>
<table><caption>Lista alarmowa klasy — uczniowie i kontakt do opiekunów</caption><thead><tr><th scope="col">Uczeń</th><th scope="col">Data urodzenia</th><th scope="col">Kontakt do opiekunów</th></tr></thead><tbody>${rows}</tbody></table>
<p class="note"><b>Klauzula poufności (RODO):</b> ${esc(gdpr)}</p>`;
    ctx.audit({ action: 'emergency_page_printed', entity: 'classes', entityId: cid, after: { students: roster(db, cid).length }, reason: 'Wydruk kontaktów na wypadek sytuacji alarmowej' });
    return sendHtml(ctx, D.printHtml(`Sytuacja alarmowa — ${cls.name}`, body, docOpts(db, { docNo: 'Wydruk alarmowy', gdpr })));
  }, HR);

  /* ---------------------------------------------------------------- 3.2.18 grupy międzyoddziałowe */
  r.get('/api/homeroom/groups', (ctx) => {
    const { db, cid } = scope(ctx);
    const mine = roster(db, cid).map((s) => s.id);
    const groups = db.col('groups').filter((g) => g.kind === 'cross-class').map((g) => ({
      id: g.id, name: g.name, kind: g.kind, subjectId: g.subjectId, classIds: g.classIds || [],
      members: (g.studentIds || []).length,
      myStudents: (g.studentIds || []).filter((id) => mine.includes(id)).map((id) => ({ studentId: id, name: sname(db.get('students', id)) }))
    }));
    return { classId: cid, groups, students: roster(db, cid).map((s) => ({ studentId: s.id, name: sname(s) })) };
  }, HR);
  r.post('/api/homeroom/groups/:groupId/members', (ctx) => {
    const { db, cid } = scope(ctx); const b = ctx.body || {};
    const g = db.get('groups', ctx.params.groupId);
    if (!g) throw httpError(404, 'Nie ma takiej grupy.');
    if (g.kind !== 'cross-class') throw httpError(400, 'Do grupy wewnątrzklasowej uczniów przypisuje nauczyciel przedmiotu; wychowawca zarządza tylko grupami międzyoddziałowymi.', { code: 'not_cross_class' });
    const ids = (b.studentIds || []).filter(Boolean);
    if (!ids.length) throw httpError(400, 'Nie wskazano uczniów.');
    for (const id of ids) { const s = db.get('students', id); if (!s || s.classId !== cid || s.status === 'removed') throw httpError(403, 'Wychowawca przypisuje do grup wyłącznie uczniów swojej klasy.', { code: 'not_my_student' }); }
    const before = { studentIds: (g.studentIds || []).slice(), classIds: (g.classIds || []).slice() };
    g.studentIds = g.studentIds || []; g.classIds = g.classIds || [];
    if (b.action === 'remove') g.studentIds = g.studentIds.filter((x) => !ids.includes(x));
    else for (const id of ids) if (!g.studentIds.includes(id)) g.studentIds.push(id);
    if (g.studentIds.some((id) => (db.get('students', id) || {}).classId === cid)) { if (!g.classIds.includes(cid)) g.classIds.push(cid); }
    else g.classIds = g.classIds.filter((c) => c !== cid);
    db.save();
    ctx.audit({ action: b.action === 'remove' ? 'group_members_removed' : 'group_members_added', entity: 'groups', entityId: g.id, before, after: { studentIds: g.studentIds, classIds: g.classIds }, reason: b.reason || `Grupa międzyoddziałowa ${g.name}` });
    return { ok: true, group: { id: g.id, name: g.name, classIds: g.classIds, members: g.studentIds.length, studentIds: g.studentIds } };
  }, HR);

  /* ---------------------------------------------------------------- 3.2.19 kontrola liczby godzin */
  r.get('/api/homeroom/hours-check', (ctx) => {
    const { db, cid, cls, cfg } = scope(ctx); const sem = semOf(ctx);
    const period = D.semester(db, sem);
    const from = ctx.query.from || period.from, to = ctx.query.to || (D.today(db) < period.to ? D.today(db) : period.to);
    const plannedBy = {}; // weekday -> distinct lesson numbers
    for (const t of db.col('timetable').filter((t2) => t2.classId === cid)) (plannedBy[t.weekday] = plannedBy[t.weekday] || new Set()).add(t.lessonNo);
    const isOff = (d) => cfg.daysOff.some((x) => x.date === d) || cfg.holidays.some((h) => d >= h.from && d <= h.to) || (cfg.winterBreak && d >= cfg.winterBreak.from && d <= cfg.winterBreak.to);
    const days = []; const discrepancies = [];
    for (let d = from; d <= to; d = U.addDays(d, 1)) {
      const wd = U.weekday(d);
      const recorded = db.col('lessons').filter((l) => l.classId === cid && l.date === d && l.status !== 'cancelled');
      const recordedNos = new Set(recorded.map((l) => l.lessonNo));
      const planned = wd <= 5 && !isOff(d) ? (plannedBy[wd] ? plannedBy[wd].size : 0) : 0;
      if (!planned && !recordedNos.size) continue;
      const missingTopics = recorded.filter((l) => l.status === 'held' && !l.topic).length;
      const row = { date: d, weekday: wd, dayOff: isOff(d) || wd > 5, planned, recorded: recordedNos.size, lessonNos: [...recordedNos].sort((a, b) => a - b), missingTopics, status: 'ok' };
      if (row.dayOff && row.recorded) row.status = 'onDayOff';
      else if (row.recorded > row.planned) row.status = 'extra';
      else if (row.recorded < row.planned) row.status = 'missing';
      days.push(row);
      if (row.status !== 'ok') discrepancies.push(Object.assign({}, row, {
        text: row.status === 'onDayOff' ? `${U.fmtDate(d)}: ${row.recorded} godz. zapisane w dniu wolnym od zajęć`
          : row.status === 'extra' ? `${U.fmtDate(d)}: zapisano ${row.recorded} godz., plan przewiduje ${row.planned}`
            : `${U.fmtDate(d)}: zapisano ${row.recorded} godz., brakuje ${row.planned - row.recorded} wobec planu (${row.planned})`
      }));
    }
    return {
      classId: cid, className: cls.name, from, to, semester: sem,
      days, discrepancies, ok: discrepancies.length === 0,
      checkedDays: days.length, plannedHours: days.reduce((a, x) => a + x.planned, 0), recordedHours: days.reduce((a, x) => a + x.recorded, 0),
      missingTopics: days.reduce((a, x) => a + x.missingTopics, 0)
    };
  }, HR);

  /* ---------------------------------------------------------------- 3.2.20 przekazanie dziennika dyrekcji */
  r.get('/api/homeroom/logbook', (ctx) => {
    const { db, cid, cls } = scope(ctx);
    return { classId: cid, className: cls.name, comments: countsFor(db, ctx.user, 'homeroom-logbook', [cid])[cid], status: cls.logbookStatus || 'open', submittedAt: cls.logbookSubmittedAt || null, submittedBy: D.userLabel(db.get('users', cls.logbookSubmittedBy)) || null, approvedAt: cls.logbookApprovedAt || null, approvedBy: D.userLabel(db.get('users', cls.logbookApprovedBy)) || null, note: cls.logbookNote || null, semesters: db.data.config.semesters.map((s) => ({ id: s.id, locked: D.isSemesterLocked(db, s.id, cid) })) };
  }, HR);
  r.post('/api/homeroom/logbook/submit', (ctx) => {
    const { db, cid, cls } = scope(ctx); const b = ctx.body || {};
    const locked = db.data.config.semesters.filter((s) => D.isSemesterLocked(db, s.id, cid));
    if (!locked.length) throw httpError(409, 'Dziennik można przekazać dyrekcji dopiero po zamknięciu semestru.', { code: 'not_closed' });
    if (cls.logbookStatus === 'submitted') throw httpError(409, 'Dziennik czeka już na zatwierdzenie dyrektora.', { code: 'already_submitted' });
    const before = { logbookStatus: cls.logbookStatus || 'open' };
    cls.logbookStatus = 'submitted'; cls.logbookSubmittedAt = U.now(); cls.logbookSubmittedBy = ctx.user.id; cls.logbookNote = b.note || null; db.save();
    ctx.audit({ action: 'logbook_submitted', entity: 'classes', entityId: cid, before, after: { logbookStatus: 'submitted', semesters: locked.map((s) => s.id) }, reason: b.note || 'Zakończenie rocznych zajęć dydaktycznych' });
    const principal = db.one('users', (u) => u.role === 'principal');
    if (principal) D.notify(db, principal.id, 'logbook', `Dziennik klasy ${cls.name} przekazany do zatwierdzenia.`, { link: '/dyrektor' });
    return { ok: true, classId: cid, status: cls.logbookStatus, submittedAt: cls.logbookSubmittedAt, closedSemesters: locked.map((s) => s.id) };
  }, HR);
  r.post('/api/homeroom/logbook/approve', (ctx) => {
    const db = ctx.db; const b = ctx.body || {};
    const cid = b.classId || ctx.params.classId; const cls = db.get('classes', cid);
    if (!cls) throw httpError(404, 'Nie ma takiej klasy.');
    if (cls.logbookStatus !== 'submitted') throw httpError(409, 'Dziennik tej klasy nie został przekazany do zatwierdzenia.', { code: 'not_submitted' });
    const before = { logbookStatus: cls.logbookStatus };
    cls.logbookStatus = 'approved'; cls.logbookApprovedAt = U.now(); cls.logbookApprovedBy = ctx.user.id; db.save();
    ctx.audit({ action: 'logbook_approved', entity: 'classes', entityId: cid, before, after: { logbookStatus: 'approved' }, reason: b.note || 'Zatwierdzenie dziennika po zakończeniu zajęć' });
    if (cls.homeroomTeacherId) D.notify(db, cls.homeroomTeacherId, 'logbook', `Dyrektor zatwierdził dziennik klasy ${cls.name}.`, { link: '/wychowawca' });
    return { ok: true, classId: cid, status: cls.logbookStatus, approvedAt: cls.logbookApprovedAt };
  }, PRINCIPAL);
}

module.exports = { register, locative, locativePlace, ACHIEVEMENT_KINDS };
