'use strict';
/* Oceny cząstkowe: kategorie i wagi, wpis pojedynczy i seryjny, tryb punktowy, np/bz, poprawy,
   komentarze dla ucznia i rodzica, cofanie i zmiana kategorii z powodem, oceny proponowane,
   blokada po klasyfikacji, ocena opisowa klas 1–3, statystyki, eksport CSV i wydruk dla rodzica. */
const D = require('../lib/domain');
const U = require('../lib/util');
const { httpError } = require('../lib/router');

const COLOR_RE = /^cat-[1-8]$/;
const catNo = (color) => { const m = COLOR_RE.exec(color || ''); return m ? +m[0].slice(4) : 8; };
const PROPOSED_KIND = { 1: 'proposedMid', 2: 'proposedFinal' };
/** Wolno wpisać tylko te rodzaje; każdy klasyfikacyjny należy do jednego semestru. */
const KINDS = { partial: null, proposedMid: 1, midterm: 1, proposedFinal: 2, final: 2 };
const KIND_LABEL = { partial: 'ocena cząstkowa', proposedMid: 'propozycja śródroczna', midterm: 'ocena śródroczna', proposedFinal: 'propozycja roczna', final: 'ocena roczna' };
/** Ile „np”/„bz” z jednego przedmiotu wolno uczniowi w semestrze (statut; domyślnie 2). */
const npLimit = (cfg) => { const n = cfg.npLimitPerSemester; return Number.isInteger(n) && n >= 0 ? n : 2; };
const RETAKE_LABEL = { higher: 'Liczy się wyższa ocena', average: 'Średnia obu ocen', regulation: 'Poprawa zastępuje ocenę pierwotną (wg statutu)' };
const cap = (s) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : '');
/** Ile dni przed terminem propozycji wolno je wystawiać (statut; domyślnie 30). */
const proposalWindowDays = (cfg) => { const n = cfg.proposalWindowDays; return Number.isInteger(n) && n >= 0 ? n : 30; };
/** Jak D.studentLabel, ale bez „null.” dla ucznia bez numeru w dzienniku.
    Z bazą (`db`) dokłada rozróżnienie imienników z jednego oddziału — OPS-20. */
const sLabel = (s, db) => {
  if (!s) return '';
  const mark = db ? D.sameNameMark(db, s) : null;
  if (mark) return `${s.lastName} ${s.firstName} (${mark})`;
  return (s.rollNo ? s.rollNo + '. ' : '') + s.lastName + ' ' + s.firstName;
};

/* ---------- dostęp ---------- */
/** 403 dla ucznia/rodzica spoza kręgu dostępu (D.assertCanSeeStudent rzuca zwykły Error). */
function assertCanSee(db, user, studentId) {
  const v = D.visibleStudentIds(db, user);
  if (v && !v.includes(studentId)) throw httpError(403, 'Brak dostępu do danych tego ucznia.', { code: 'forbidden' });
}
/** S-10 — pełna bramka odczytu karty ucznia (rola + zakres opiekuna), jedna dla wszystkich modułów. */
const assertRead = (db, user, studentId, kind) => D.assertMayReadPupilRecord(db, user, studentId, kind || 'grades');
/** Ten sam warunek dla odczytu obejmującego cały oddział. Dla pracownika szkoły wynik zależy od
    oddziału (i ewentualnej grupy, która dostęp wyłącznie poszerza), więc wystarczy jedno sprawdzenie
    na oddział — bez niego arkusz przeglądałby listę lekcji raz na ucznia. */
function assertReadAll(db, user, studentIds, kind) {
  const staff = !D.visibleStudentIds(db, user);
  const done = new Set();
  for (const sid of studentIds) {
    const s = db.get('students', sid);
    if (staff && s && done.has(s.classId)) continue;
    assertRead(db, user, sid, kind);
    if (staff && s) done.add(s.classId);
  }
}
function assertTeaches(db, user, subjectId, classId) {
  if (!db.get('subjects', subjectId)) throw httpError(404, 'Nie znaleziono przedmiotu.');
  if (!D.teacherTeaches(db, user, subjectId, classId)) throw httpError(403, 'Nie uczysz tego przedmiotu w tej klasie — wpis ocen jest niedostępny.', { code: 'not_teaching' });
}
/** Czy dyrekcja formalnie otworzyła semestr z powrotem (egzamin klasyfikacyjny, poprawkowy, odwołanie)? */
function reopened(db, semester, classId) {
  return db.col('semesterLocks').some((l) => +l.semester === +semester && (l.classId === classId || !l.classId) && l.reopened);
}
/** 3.1.22 — semestr zamknięty przez dyrekcję albo po terminie klasyfikacji */
function assertOpen(db, semester, classId, user) {
  const sem = D.semester(db, semester);
  if (D.isSemesterLocked(db, semester, classId)) throw httpError(403, `Klasyfikacja ${sem ? sem.name.toLowerCase() : 'semestru'} dla klasy ${classId} została zamknięta — edycja ocen cząstkowych jest zablokowana. Odblokowanie wymaga decyzji dyrekcji.`, { code: 'semester_locked' });
  if (sem && sem.classificationDeadline && D.today(db) > sem.classificationDeadline) {
    // Po terminie oceny zmienia się już tylko w trybie egzaminu klasyfikacyjnego, poprawkowego albo
    // odwołania (art. 44l–44n) — decyduje dyrektor i tylko w semestrze formalnie odblokowanym.
    const byPrincipal = user && user.role === 'principal' && reopened(db, semester, classId);
    if (!byPrincipal) throw httpError(403, `Termin klasyfikacji (${U.fmtDate(sem.classificationDeadline)}) minął — edycja ocen cząstkowych w ${sem.name.toLowerCase()} jest zablokowana.${user && user.role === 'principal' ? ' Dyrektor może wpisać ocenę po egzaminie klasyfikacyjnym lub poprawkowym dopiero po odblokowaniu semestru.' : ''}`, { code: 'classification_deadline' });
  }
}
/** 3.1.2 — potwierdzona nieobecność (nb) na tej godzinie lekcyjnej */
function absentOnLesson(db, studentId, input) {
  let rows = [];
  if (input.lessonId) rows = db.col('attendance').filter((a) => a.lessonId === input.lessonId && a.studentId === studentId && !a.draft);
  else if (input.date && input.lessonNo != null) rows = db.col('attendance').filter((a) => a.studentId === studentId && a.date === input.date && a.lessonNo === +input.lessonNo && !a.draft);
  // Bez wskazania lekcji blokada nadal obowiązuje: liczy się nieobecność z tego przedmiotu tego dnia,
  // inaczej wystarczyłoby pominąć lessonId, żeby ominąć regułę 3.1.2.
  else if (input.date && input.subjectId) rows = db.col('attendance').filter((a) => a.studentId === studentId && a.date === input.date && a.subjectId === input.subjectId && !a.draft);
  return rows.find((a) => a.status === 'nb') || null;
}

/* ---------- zapis oceny ---------- */
function writeGrade(ctx, input) {
  const db = ctx.db, cfg = db.data.config, user = ctx.user;
  const student = db.get('students', input.studentId);
  if (!student) throw httpError(404, 'Nie znaleziono ucznia.');
  const classId = input.classId || student.classId;
  const subjectId = input.subjectId;
  assertTeaches(db, user, subjectId, classId);
  const date = input.date || D.today(db);
  const kind = input.kind || 'partial';
  if (!(kind in KINDS)) throw httpError(400, `Nieznany rodzaj wpisu „${kind}”. Dozwolone: ${Object.keys(KINDS).join(', ')}.`, { code: 'bad_kind' });
  // P25 — nowy wpis z dnia przerwy międzysemestralnej należy do semestru, który się zaczyna.
  const dateSemester = D.semesterOf(db, date, 'entry');
  let semester = input.semester != null && input.semester !== '' ? +input.semester : dateSemester;
  if (KINDS[kind]) {
    // Ocena klasyfikacyjna należy do swojego semestru z definicji — inaczej nie znalazłby jej ani
    // arkusz ocen, ani tablica klasyfikacji wychowawcy.
    if (semester !== KINDS[kind]) throw httpError(400, `${cap(KIND_LABEL[kind])} dotyczy semestru ${KINDS[kind]}, a wskazano ${semester}.`, { code: 'kind_semester_mismatch' });
  } else if (semester !== dateSemester) {
    throw httpError(400, `Data ${U.fmtDate(date)} należy do semestru ${dateSemester} — nie można zapisać oceny cząstkowej w semestrze ${semester}.`, { code: 'date_semester_mismatch' });
  }
  assertOpen(db, semester, classId, user);

  let cat = null;
  if (input.categoryId) { cat = db.get('gradeCategories', input.categoryId); if (!cat) throw httpError(404, 'Nie znaleziono kategorii ocen.'); }
  else if (kind === 'partial') throw httpError(400, 'Wybierz kategorię oceny (np. sprawdzian, kartkówka).');

  // 3.1.6 — tryb punktowy: punkty → procent → proponowana ocena wg skali szkolnej
  let points = null, maxPoints = null, percent = null, suggested = null, value = input.value;
  if (input.points != null && input.points !== '') {
    points = Number(input.points); maxPoints = Number(input.maxPoints);
    if (!isFinite(points) || points < 0) throw httpError(400, 'Liczba punktów musi być liczbą nieujemną.');
    if (!isFinite(maxPoints) || maxPoints <= 0) throw httpError(400, 'Podaj maksymalną liczbę punktów za pracę.');
    if (points > maxPoints) throw httpError(400, `Liczba punktów (${points}) przekracza maksimum (${maxPoints}).`);
    const pg = U.pointsToGrade(points, maxPoints, cfg.percentScale);
    percent = pg.percent; suggested = pg.grade;
    if (value == null || value === '') value = String(pg.grade);
  }
  const parsed = U.parseGrade(value, cfg);
  if (!parsed) throw httpError(400, 'Nieprawidłowa ocena. Wpisz 1–6, opcjonalnie z + lub −, albo np (nieprzygotowanie) lub bz (brak zadania).', { code: 'bad_value' });

  if (kind === 'partial') {
    // 3.1.7 — statut ogranicza liczbę nieprzygotowań i braków zadania w semestrze
    if (parsed.special === 'np' || parsed.special === 'bz') {
      const limit = npLimit(cfg);
      const used = db.col('grades').filter((g) => g.studentId === student.id && g.subjectId === subjectId && g.semester === semester && !g.deleted && U.parseGrade(g.value, cfg) && U.parseGrade(g.value, cfg).special === parsed.special).length;
      if (used >= limit) throw httpError(409, `${sLabel(student, db)} wykorzystał(a) już limit ${limit} ${U.plural(limit, 'wpisu', 'wpisów', 'wpisów')} „${parsed.special}” z tego przedmiotu w ${(D.semester(db, semester) || {}).name || 'semestrze'} — kolejne nieprzygotowanie wymaga oceny albo zgody wychowawcy.`, { code: 'np_limit', special: parsed.special, used, limit });
    }
  } else {
    // Śródroczną i roczną ocenę klasyfikacyjną ustala się w pełnym brzmieniu — bez plusów i minusów
    // i bez wpisów pomocniczych (np/bz). Dopuszczalne są „nk” i „zw”.
    if (parsed.special === 'np' || parsed.special === 'bz') throw httpError(400, `${cap(KIND_LABEL[kind])} nie może mieć wartości „${parsed.special}”. Dozwolone: 1–6, nk (nieklasyfikowany) albo zw (zwolniony).`, { code: 'bad_classification_value' });
    if (parsed.mod) throw httpError(400, `${cap(KIND_LABEL[kind])} ustala się w pełnym brzmieniu — „${parsed.text}” nie jest dopuszczalne, wpisz ${parsed.base}.`, { code: 'modifier_not_allowed' });
    const cls = db.get('classes', classId);
    if (cls && cls.level != null && cls.level <= 3 && !parsed.special) throw httpError(400, `W klasach 1–3 ocena klasyfikacyjna jest opisowa — wpis cyfrowy jest niedopuszczalny. Użyj oceny opisowej dla klasy ${cls.name}.`, { code: 'descriptive_required' });
  }

  // 3.1.2 — blokada wpisu przy potwierdzonej nieobecności
  const nb = kind !== 'partial' ? null : absentOnLesson(db, student.id, { lessonId: input.lessonId, date, lessonNo: input.lessonNo, subjectId });
  const makeup = !!input.makeup;
  if (nb && !makeup) throw httpError(409, `${sLabel(student, db)} ma potwierdzoną nieobecność (nb) na tej godzinie lekcyjnej — nie można wpisać oceny cząstkowej. Zaznacz „do uzupełnienia w późniejszym terminie”, aby wpisać ją mimo to.`, { code: 'absent_blocked', attendanceId: nb.id });

  // 3.1.8 — poprawa istniejącej oceny
  let retakeOfId = input.retakeOfId || null;
  if (retakeOfId) {
    const orig = db.get('grades', retakeOfId);
    if (!orig || orig.deleted) throw httpError(404, 'Nie znaleziono poprawianej oceny.');
    if (orig.studentId !== student.id || orig.subjectId !== subjectId) throw httpError(400, 'Poprawa musi dotyczyć oceny tego samego ucznia z tego samego przedmiotu.');
    if (orig.retakeOfId) throw httpError(400, 'Nie można poprawiać oceny, która sama jest poprawą.');
    // Druga poprawa tej samej pracy liczyłaby się podwójnie w średniej — najpierw wycofaj poprzednią.
    const prevRetake = db.col('grades').find((g) => g.retakeOfId === orig.id && !g.deleted);
    if (prevRetake) throw httpError(409, `Ocena z ${U.fmtDate(orig.date)} ma już poprawę (${prevRetake.value} z ${U.fmtDate(prevRetake.date)}). Cofnij ją z podaniem powodu, zanim wpiszesz kolejną.`, { code: 'retake_exists', retakeId: prevRetake.id });
  }

  let weight = input.weight != null ? +input.weight : (cat ? cat.weight : 1);
  if (!(weight >= 1 && weight <= 10)) throw httpError(400, 'Waga oceny musi mieścić się w przedziale 1–10.');
  const special = !!parsed.special;
  const countsInAverage = special || kind !== 'partial' ? false : (input.countsInAverage != null ? !!input.countsInAverage : (cat ? cat.countsInAverage !== false : true));

  // P28 — ocena klasyfikacyjna wskazuje propozycję, którą potwierdza (albo od której odbiega).
  let proposedId = null;
  if (kind === 'midterm' || kind === 'final') {
    if (input.proposedId) {
      const p = db.get('grades', input.proposedId);
      if (!p || p.deleted || p.studentId !== student.id || p.subjectId !== subjectId || p.semester !== semester || p.kind !== PROPOSED_KIND[semester]) throw httpError(400, 'Wskazana ocena proponowana nie pasuje do tego ucznia, przedmiotu i semestru.', { code: 'bad_proposed' });
      proposedId = p.id;
    } else {
      const p = db.col('grades').find((g) => g.studentId === student.id && g.subjectId === subjectId && g.semester === semester && g.kind === PROPOSED_KIND[semester] && !g.deleted);
      proposedId = p ? p.id : null;
    }
  }

  if (kind !== 'partial') {
    const prev = db.col('grades').find((g) => g.studentId === student.id && g.subjectId === subjectId && g.semester === semester && g.kind === kind && !g.deleted);
    if (prev) {
      const before = Object.assign({}, prev);
      prev.deleted = true; prev.deletedReason = 'Zastąpiona nowym wpisem'; db.save();
      ctx.audit({ action: 'grade_superseded', entity: 'grade', entityId: prev.id, before, after: { deleted: true, value: parsed.special || parsed.text }, reason: input.reason || 'Nowy wpis tego samego rodzaju' });
    }
  }

  const g = db.insert('grades', {
    studentId: student.id, subjectId, classId, categoryId: cat ? cat.id : null, categoryName: cat ? cat.name : (kind === 'partial' ? null : KIND_LABEL[kind]),
    weight, color: cat ? cat.color : null, value: parsed.special || parsed.text, points, maxPoints, percent,
    comment: (input.comment || '').trim() || null, retakeOfId, makeup, lessonId: input.lessonId || null,
    date, teacherId: user.id, kind, semester, countsInAverage, proposedId, locked: false, deleted: false, deletedReason: null
  });
  ctx.audit({ action: 'grade_create', entity: 'grade', entityId: g.id, after: Object.assign({}, g), reason: input.reason || null });
  const sg = D.studentGrades(db, student.id, subjectId, semester);
  return Object.assign({ grade: g, percent, suggestedGrade: suggested, numericValue: parsed.value != null ? parsed.value : null, average: sg.average, count: sg.count, makeup, student: sLabel(student, db) }, kind === 'midterm' || kind === 'final' ? { classification: proposalView(db, sg) } : {});
}

/**
 * P28 — ocena śródroczna/roczna zapamiętuje `proposedId`: propozycję, którą potwierdza. Widok
 * klasyfikacji pokazuje `changedFromProposal` (i `lowerThanProposal`), bo statut zwykle wymaga
 * pisemnego uzasadnienia, gdy ocena klasyfikacyjna jest niższa od proponowanej.
 * `changedFromProposal === null` znaczy „nie ma z czym porównać” (brak oceny albo brak propozycji).
 */
function proposalView(db, sg) {
  const fin = sg.final;
  if (!fin) return { final: null, proposedId: null, changedFromProposal: null, lowerThanProposal: null };
  const src = (fin.proposedId && db.get('grades', fin.proposedId)) || sg.proposed || null;
  if (!src) return { final: fin.value, proposedId: fin.proposedId || null, proposedValue: null, changedFromProposal: null, lowerThanProposal: null };
  const cfg = db.data.config;
  const pf = U.parseGrade(fin.value, cfg), pp = U.parseGrade(src.value, cfg);
  return {
    final: fin.value, proposedId: src.id, proposedValue: src.value,
    changedFromProposal: String(fin.value) !== String(src.value),
    lowerThanProposal: !!(pf && pp && pf.value != null && pp.value != null && pf.value < pp.value)
  };
}

/* ---------- siatka ocen ---------- */
function gridFor(db, classId, subjectId, semester, user) {
  const cfg = db.data.config, rule = cfg.retakeRule || 'higher';
  const cls = db.get('classes', classId);
  if (!cls) throw httpError(404, 'Nie znaleziono klasy.');
  const subject = db.get('subjects', subjectId);
  const students = db.col('students').filter((s) => s.classId === classId).sort((a, b) => (a.rollNo || 99) - (b.rollNo || 99));
  if (user) assertReadAll(db, user, students.map((s) => s.id), 'grades');
  const ids = new Set(students.map((s) => s.id));
  const all = db.col('grades').filter((g) => g.subjectId === subjectId && g.semester === semester && !g.deleted && ids.has(g.studentId));
  const byId = Object.fromEntries(all.map((g) => [g.id, g]));
  const cols = []; const colIndex = {};
  const addCol = (id, make) => { if (!colIndex[id]) { colIndex[id] = Object.assign({ id }, make()); cols.push(colIndex[id]); } return colIndex[id]; };
  const colOf = (g) => {
    if (g.kind !== 'partial') return addCol('col_' + g.kind, () => ({ title: g.kind === 'proposedMid' || g.kind === 'proposedFinal' ? 'Proponowana' : 'Końcowa', categoryName: g.kind === 'proposedMid' || g.kind === 'proposedFinal' ? 'ocena proponowana' : 'ocena końcowa', excluded: true, proposedCol: true, sort: '9999' }));
    const cat = g.categoryId ? db.get('gradeCategories', g.categoryId) : null;
    const key = 'col_' + (g.retakeOfId ? 'p_' : '') + (g.categoryId || 'inne') + '_' + g.date;
    return addCol(key, () => ({
      title: g.retakeOfId ? 'Poprawa' : cap(cat ? cat.name : 'Inne'), categoryId: g.categoryId,
      categoryName: (cat ? cat.name : 'inne') + (g.retakeOfId ? ' · poprawa' : ''), category: catNo(cat ? cat.color : g.color),
      weight: g.weight, date: U.fmtDate(g.date), iso: g.date, retakeCol: !!g.retakeOfId,
      excluded: (cat ? cat.countsInAverage === false : false) || (!!g.retakeOfId && rule !== 'average'), sort: g.date + (g.retakeOfId ? '1' : '0')
    }));
  };
  const rows = students.map((s, i) => ({ studentId: s.id, no: s.rollNo || i + 1, name: sLabel(s, db).replace(/^\d+\.\s*/, ''), grades: {}, absent: [], absentStatus: 'nb' }));
  const rowOf = Object.fromEntries(rows.map((r) => [r.studentId, r]));
  for (const g of all) {
    const col = colOf(g); const row = rowOf[g.studentId]; if (!row) continue;
    row.grades[col.id] = {
      gradeId: g.id, value: g.value, comment: !!g.comment, commentText: g.comment || null, locked: !!g.locked,
      proposed: g.kind === 'proposedMid' || g.kind === 'proposedFinal', weight: g.weight, makeup: !!g.makeup,
      points: g.points, maxPoints: g.maxPoints, percent: g.percent, date: U.fmtDate(g.date), retakeOfId: g.retakeOfId || null, kind: g.kind
    };
  }
  // 3.1.8 — obie wartości widoczne: w kolumnie pierwotnej strzałka „pierwotna → licząca się”
  for (const g of all) {
    if (!g.retakeOfId || !byId[g.retakeOfId] || rule === 'average') continue;
    const orig = byId[g.retakeOfId]; const row = rowOf[g.studentId]; if (!row) continue;
    const origCol = colOf(orig), po = U.parseGrade(orig.value, cfg), pr = U.parseGrade(g.value, cfg);
    const keepOriginal = rule === 'higher' && po && pr && po.value != null && pr.value != null && po.value >= pr.value;
    const cell = row.grades[origCol.id];
    if (cell) cell.retake = { from: orig.value, to: keepOriginal ? orig.value : g.value };
  }
  cols.sort((a, b) => (a.sort < b.sort ? -1 : a.sort > b.sort ? 1 : 0));
  // frekwencja: chip nb w pustych komórkach dnia, w którym uczeń był nieobecny
  for (const col of cols) {
    if (!col.iso) continue;
    for (const row of rows) {
      if (row.grades[col.id]) continue;
      const nb = db.col('attendance').find((a) => a.studentId === row.studentId && a.date === col.iso && a.subjectId === subjectId && !a.draft && a.status === 'nb');
      if (nb) row.absent.push(col.id);
    }
  }
  for (const row of rows) { const sg = D.studentGrades(db, row.studentId, subjectId, semester); row.average = sg.average; row.count = sg.count; row.proposed = sg.proposed ? sg.proposed.value : null; Object.assign(row, proposalView(db, sg)); }
  const avgs = rows.map((r) => r.average).filter((x) => x != null);
  return {
    classId, className: cls.name, subjectId, subjectName: subject ? subject.name : subjectId, semester,
    semesterName: (D.semester(db, semester) || {}).name, locked: D.isSemesterLocked(db, semester, classId) || D.today(db) > (D.semester(db, semester) || {}).classificationDeadline,
    retakeRule: rule, retakeRuleLabel: RETAKE_LABEL[rule] || rule, today: D.today(db),
    columns: cols.map(({ sort, ...c }) => c), students: rows,
    classAverage: avgs.length ? Math.round((avgs.reduce((a, b) => a + b, 0) / avgs.length) * 100) / 100 : null
  };
}

/** P27 — średnie klasy z par przedmiot|semestr, których dotyka zmiana kategorii, przed i po zmianie. */
function classAverageOf(db, classId, grades) {
  const pairs = [...new Set(grades.filter((g) => g.classId === classId).map((g) => g.subjectId + '|' + g.semester))];
  const out = {};
  for (const key of pairs) {
    const [subjectId, sem] = key.split('|');
    const avgs = db.col('students').filter((s) => s.classId === classId).map((s) => D.studentGrades(db, s.id, subjectId, +sem).average).filter((x) => x != null);
    out[key] = avgs.length ? Math.round((avgs.reduce((a, b) => a + b, 0) / avgs.length) * 100) / 100 : null;
  }
  return out;
}

/* ---------- statystyki ---------- */
function statsFor(db, classId, subjectId, semester, user) {
  const cfg = db.data.config;
  const students = db.col('students').filter((s) => s.classId === classId).sort((a, b) => (a.rollNo || 99) - (b.rollNo || 99));
  if (user) assertReadAll(db, user, students.map((s) => s.id), 'grades');
  const distribution = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0, 6: 0 };
  let np = 0, bz = 0, total = 0;
  const perStudent = students.map((s, i) => {
    const sg = D.studentGrades(db, s.id, subjectId, semester);
    let sNp = 0, sBz = 0;
    for (const g of sg.partial) {
      total++;
      const p = U.parseGrade(g.value, cfg);
      if (!p) continue;
      if (p.special === 'np') { np++; sNp++; } else if (p.special === 'bz') { bz++; sBz++; } else if (p.base) distribution[p.base]++;
    }
    return { studentId: s.id, no: s.rollNo || i + 1, name: sLabel(s, db).replace(/^\d+\.\s*/, ''), average: sg.average, count: sg.count, entries: sg.partial.length, np: sNp, bz: sBz, npLeft: Math.max(0, npLimit(cfg) - sNp), bzLeft: Math.max(0, npLimit(cfg) - sBz), atRisk: sg.average != null && sg.average < 2 };
  });
  const avgs = perStudent.map((x) => x.average).filter((x) => x != null);
  return {
    classId, subjectId, semester, total, npCount: np, bzCount: bz, distribution, npLimit: npLimit(cfg),
    classAverage: avgs.length ? Math.round((avgs.reduce((a, b) => a + b, 0) / avgs.length) * 100) / 100 : null,
    withoutGrades: perStudent.filter((x) => x.entries === 0).length, atRisk: perStudent.filter((x) => x.atRisk).length,
    students: perStudent
  };
}

function register(r, app) {
  const EDITORS = { roles: ['gradeEditors'] };

  /* ---------- 3.1.4 kategorie ocen ---------- */
  r.get('/api/grade-categories', (ctx) => {
    const sub = ctx.query.subjectId;
    const list = ctx.db.col('gradeCategories').filter((c) => !c.deleted && (!sub || !c.subjectId || c.subjectId === sub));
    return { categories: list.map((c) => Object.assign({ colorNo: catNo(c.color) }, c)) };
  }, { roles: ['staff'] });

  r.post('/api/grade-categories', (ctx) => {
    const b = ctx.body || {};
    const name = String(b.name || '').trim();
    if (!name) throw httpError(400, 'Podaj nazwę kategorii ocen.');
    const weight = Number(b.weight);
    if (!Number.isInteger(weight) || weight < 1 || weight > 10) throw httpError(400, 'Waga kategorii musi być liczbą całkowitą od 1 do 10.', { code: 'bad_weight' });
    const color = b.color || 'cat-8';
    if (!COLOR_RE.test(color)) throw httpError(400, 'Kolor kategorii musi być jednym z cat-1 … cat-8.', { code: 'bad_color' });
    if (ctx.db.col('gradeCategories').some((c) => !c.deleted && c.name.toLowerCase() === name.toLowerCase() && (c.subjectId || null) === (b.subjectId || null))) throw httpError(400, `Kategoria „${name}” już istnieje.`);
    const cat = ctx.db.insert('gradeCategories', { name, weight, color, countsInAverage: b.countsInAverage !== false, subjectId: b.subjectId || null, teacherId: ctx.user.id });
    ctx.audit({ action: 'grade_category_create', entity: 'gradeCategory', entityId: cat.id, after: Object.assign({}, cat) });
    return { category: Object.assign({ colorNo: catNo(cat.color) }, cat) };
  }, EDITORS);

  r.patch('/api/grade-categories/:id', (ctx) => {
    const cat = ctx.db.get('gradeCategories', ctx.params.id);
    if (!cat) throw httpError(404, 'Nie znaleziono kategorii ocen.');
    const b = ctx.body || {}; const before = Object.assign({}, cat); const patch = {};
    if (b.name != null) { const n = String(b.name).trim(); if (!n) throw httpError(400, 'Nazwa kategorii nie może być pusta.'); patch.name = n; }
    if (b.weight != null) { const w = Number(b.weight); if (!Number.isInteger(w) || w < 1 || w > 10) throw httpError(400, 'Waga kategorii musi być liczbą całkowitą od 1 do 10.', { code: 'bad_weight' }); patch.weight = w; }
    if (b.color != null) { if (!COLOR_RE.test(b.color)) throw httpError(400, 'Kolor kategorii musi być jednym z cat-1 … cat-8.', { code: 'bad_color' }); patch.color = b.color; }
    if (b.countsInAverage != null) patch.countsInAverage = !!b.countsInAverage;
    /* P27 — zmiana wagi kategorii ruszała wagi wszystkich wystawionych już ocen (a więc i średnie)
       na podstawie jednego wpisu audytu o kategorii; pojedyncza ocena zmieniała się bez własnego
       śladu. Teraz ocena zostaje przy wadze, z jaką ją wystawiono, chyba że nauczyciel świadomie
       wybierze „przelicz istniejące” (`recalculate: true`) — wtedy każda przeliczona ocena dostaje
       własny wpis `grade_update`, a wpis o kategorii niesie listę ocen i średnie klas przed i po. */
    const affected = ctx.db.col('grades').filter((g) => g.categoryId === cat.id && !g.deleted && g.kind === 'partial');
    const touchesGrades = patch.weight != null || patch.countsInAverage != null;
    const recalculate = !!b.recalculate && touchesGrades;
    const classIds = [...new Set(affected.map((g) => g.classId))];
    const avgOf = () => Object.fromEntries(classIds.map((cid) => [cid, classAverageOf(ctx.db, cid, affected)]));
    const averagesBefore = touchesGrades ? avgOf() : null;
    const gradeBefore = recalculate ? affected.map((g) => Object.assign({}, g)) : [];
    const after = ctx.db.update('gradeCategories', cat.id, patch);
    if (recalculate) {
      for (const g of affected) {
        if (patch.weight != null) g.weight = patch.weight;
        if (patch.countsInAverage != null && !U.parseGrade(g.value, ctx.db.data.config).special) g.countsInAverage = patch.countsInAverage;
      }
      ctx.db.save();
    }
    const averagesAfter = touchesGrades ? avgOf() : null;
    if (recalculate) {
      const why = b.reason || `Przeliczenie ocen po zmianie kategorii „${after.name}”`;
      for (const g of affected) {
        const was = gradeBefore.find((x) => x.id === g.id);
        if (was && was.weight === g.weight && was.countsInAverage === g.countsInAverage) continue;
        ctx.audit({ action: 'grade_update', entity: 'grade', entityId: g.id, before: was, after: Object.assign({}, g), reason: why });
      }
    }
    ctx.audit({
      action: 'grade_category_update', entity: 'gradeCategory', entityId: cat.id,
      before: Object.assign({}, before, touchesGrades ? { classAverages: averagesBefore } : {}),
      after: Object.assign({}, after, touchesGrades ? { classAverages: averagesAfter, recalculated: recalculate, gradeIds: affected.map((g) => g.id) } : {}),
      reason: b.reason || null
    });
    return {
      category: Object.assign({ colorNo: catNo(after.color) }, after),
      recalculated: recalculate, affectedGrades: affected.length, gradeIds: affected.map((g) => g.id),
      classAverages: touchesGrades ? { before: averagesBefore, after: averagesAfter } : null,
      message: touchesGrades && !recalculate ? `Zmiana obowiązuje od nowych wpisów — ${affected.length} ${U.plural(affected.length, 'wystawiona ocena', 'wystawione oceny', 'wystawionych ocen')} zostaje przy dotychczasowej wadze. Zaznacz „przelicz istniejące”, aby zmienić także je.` : null
    };
  }, EDITORS);

  r.delete('/api/grade-categories/:id', (ctx) => {
    const cat = ctx.db.get('gradeCategories', ctx.params.id);
    if (!cat) throw httpError(404, 'Nie znaleziono kategorii ocen.');
    const used = ctx.db.col('grades').filter((g) => g.categoryId === cat.id && !g.deleted).length;
    if (used) throw httpError(400, `Kategoria „${cat.name}” jest użyta w ${used} ${U.plural(used, 'ocenie', 'ocenach', 'ocenach')} — nie można jej usunąć.`);
    const before = Object.assign({}, cat);
    ctx.db.update('gradeCategories', cat.id, { deleted: true });
    ctx.audit({ action: 'grade_category_delete', entity: 'gradeCategory', entityId: cat.id, before, reason: (ctx.body && ctx.body.reason) || null });
    return { ok: true };
  }, EDITORS);

  /* ---------- kontekst nauczyciela: klasy i przedmioty ---------- */
  r.get('/api/grades/context', (ctx) => {
    const db = ctx.db, user = ctx.user;
    const seen = {}; const pairs = [];
    const add = (classId, subjectId) => { const k = classId + '|' + subjectId; if (seen[k]) return; seen[k] = 1; const c = db.get('classes', classId), s = db.get('subjects', subjectId); if (c && s) pairs.push({ classId, className: c.name, subjectId, subjectName: s.name, level: c.level }); };
    for (const t of db.col('timetable')) if (user.role === 'principal' || t.teacherId === user.id) add(t.classId, t.subjectId);
    for (const l of db.col('lessons')) if (l.substituteTeacherId === user.id) add(l.classId, l.subjectId);
    pairs.sort((a, b) => (a.className + a.subjectName).localeCompare(b.className + b.subjectName, 'pl'));
    return {
      pairs, today: D.today(db), semester: D.semesterOf(db),
      // P26 — okno wystawiania propozycji: proposedFrom … proposedDeadline
      proposalWindowDays: proposalWindowDays(db.data.config),
      semesters: db.data.config.semesters.map((s) => ({ id: s.id, name: s.name, from: s.from, to: s.to, proposedDeadline: s.proposedDeadline, proposedFrom: s.proposedDeadline ? U.addDays(s.proposedDeadline, -proposalWindowDays(db.data.config)) : null, classificationDeadline: s.classificationDeadline, locked: s.locked })),
      retakeRule: db.data.config.retakeRule, retakeRules: Object.keys(RETAKE_LABEL).map((k) => ({ value: k, label: RETAKE_LABEL[k] })),
      groups: db.col('groups').map((g) => ({ id: g.id, name: g.name, subjectId: g.subjectId, classIds: g.classIds, studentIds: g.studentIds })),
      homeroomOf: user.homeroomOf || null
    };
  }, { roles: ['staff'] });

  /* ---------- siatka + statystyki ---------- */
  r.get('/api/grades/grid', (ctx) => {
    const { classId, subjectId } = ctx.query;
    if (!classId || !subjectId) throw httpError(400, 'Podaj klasę i przedmiot.');
    assertTeaches(ctx.db, ctx.user, subjectId, classId);
    const semester = +(ctx.query.semester || D.semesterOf(ctx.db));
    return gridFor(ctx.db, classId, subjectId, semester, ctx.user);
  }, EDITORS);

  r.get('/api/grades/statistics', (ctx) => {
    const db = ctx.db; const classId = ctx.query.classId;
    if (!classId) throw httpError(400, 'Podaj klasę.');
    const semester = +(ctx.query.semester || D.semesterOf(db));
    if (ctx.query.subjectId) { assertTeaches(db, ctx.user, ctx.query.subjectId, classId); return statsFor(db, classId, ctx.query.subjectId, semester, ctx.user); }
    const subjects = D.subjectsOfClass(db, classId).filter((s) => D.teacherTeaches(db, ctx.user, s, classId));
    return { classId, semester, bySubject: subjects.map((s) => statsFor(db, classId, s, semester, ctx.user)) };
  }, EDITORS);

  /* ---------- 3.1.5–3.1.8, 3.1.10 wpis oceny ---------- */
  r.post('/api/grades', (ctx) => writeGrade(ctx, ctx.body || {}), EDITORS);

  /* ---------- 3.1.9 wpis seryjny ---------- */
  r.post('/api/grades/bulk', (ctx) => {
    const b = ctx.body || {};
    const entries = Array.isArray(b.entries) ? b.entries : null;
    if (!entries || !entries.length) throw httpError(400, 'Przekaż listę wpisów (entries) w kolejności uczniów.');
    const common = { subjectId: b.subjectId, classId: b.classId, categoryId: b.categoryId, date: b.date, lessonId: b.lessonId, lessonNo: b.lessonNo, semester: b.semester, kind: b.kind, maxPoints: b.maxPoints, weight: b.weight };
    const results = entries.map((e, index) => {
      const input = Object.assign({}, common, e);
      const student = ctx.db.get('students', input.studentId);
      try {
        if ((input.value == null || input.value === '') && (input.points == null || input.points === '')) return { index, studentId: input.studentId, name: sLabel(student, ctx.db), ok: false, skipped: true, status: 0, error: 'Pominięto — pusta komórka.' };
        const out = writeGrade(ctx, input);
        return { index, studentId: input.studentId, name: out.student, ok: true, status: 200, gradeId: out.grade.id, value: out.grade.value, percent: out.percent, average: out.average };
      } catch (err) {
        return { index, studentId: input.studentId, name: sLabel(student, ctx.db), ok: false, status: err.status || 500, code: (err.extra && err.extra.code) || null, error: err.message };
      }
    });
    const saved = results.filter((x) => x.ok).length;
    return { results, saved, failed: results.filter((x) => !x.ok && !x.skipped).length, skipped: results.filter((x) => x.skipped).length, message: `Zapisano ${saved} ${U.plural(saved, 'ocenę', 'oceny', 'ocen')} z ${entries.length}.` };
  }, EDITORS);

  /* ---------- 3.1.11 zmiana i cofnięcie z powodem ---------- */
  r.patch('/api/grades/:id', (ctx) => {
    const db = ctx.db, b = ctx.body || {};
    const g = db.get('grades', ctx.params.id);
    if (!g || g.deleted) throw httpError(404, 'Nie znaleziono oceny.');
    const reason = String(b.reason || '').trim();
    if (reason.length < 3) throw httpError(400, 'Podaj powód zmiany oceny — trafi on do rejestru zmian.', { code: 'reason_required' });
    assertTeaches(db, ctx.user, g.subjectId, g.classId);
    assertOpen(db, g.semester, g.classId, ctx.user);
    if (g.locked) throw httpError(403, 'Wpis zablokowany — zmiana wymaga zgody dyrekcji.', { code: 'grade_locked' });
    const before = Object.assign({}, g); const patch = {};
    if (b.value != null) {
      const p = U.parseGrade(b.value, db.data.config);
      if (!p) throw httpError(400, 'Nieprawidłowa ocena. Wpisz 1–6 (z + lub −), np albo bz.', { code: 'bad_value' });
      if (g.kind !== 'partial') {
        if (p.special === 'np' || p.special === 'bz') throw httpError(400, `${cap(KIND_LABEL[g.kind] || 'ocena klasyfikacyjna')} nie może mieć wartości „${p.special}”.`, { code: 'bad_classification_value' });
        if (p.mod) throw httpError(400, `${cap(KIND_LABEL[g.kind] || 'ocena klasyfikacyjna')} ustala się w pełnym brzmieniu — wpisz ${p.base}.`, { code: 'modifier_not_allowed' });
      }
      patch.value = p.special || p.text; patch.countsInAverage = p.special ? false : g.countsInAverage;
    }
    if (b.categoryId != null) {
      const cat = db.get('gradeCategories', b.categoryId);
      if (!cat) throw httpError(404, 'Nie znaleziono kategorii ocen.');
      patch.categoryId = cat.id; patch.categoryName = cat.name; patch.color = cat.color;
      patch.weight = b.weight != null ? +b.weight : cat.weight;
      if (!U.parseGrade(patch.value || g.value, db.data.config).special) patch.countsInAverage = cat.countsInAverage !== false;
    } else if (b.weight != null) {
      const w = +b.weight; if (!(w >= 1 && w <= 10)) throw httpError(400, 'Waga oceny musi mieścić się w przedziale 1–10.');
      patch.weight = w;
    }
    if (b.comment != null) patch.comment = String(b.comment).trim() || null;
    if (b.countsInAverage != null) patch.countsInAverage = !!b.countsInAverage;
    const after = db.update('grades', g.id, patch);
    ctx.audit({ action: 'grade_update', entity: 'grade', entityId: g.id, before, after: Object.assign({}, after), reason });
    const sg = D.studentGrades(db, g.studentId, g.subjectId, g.semester);
    return { grade: after, before: { value: before.value, categoryName: before.categoryName, weight: before.weight }, reason, average: sg.average };
  }, EDITORS);

  r.delete('/api/grades/:id', (ctx) => {
    const db = ctx.db, b = ctx.body || {};
    const g = db.get('grades', ctx.params.id);
    if (!g || g.deleted) throw httpError(404, 'Nie znaleziono oceny.');
    const reason = String(b.reason || '').trim();
    if (reason.length < 3) throw httpError(400, 'Podaj powód cofnięcia oceny — trafi on do rejestru zmian.', { code: 'reason_required' });
    assertTeaches(db, ctx.user, g.subjectId, g.classId);
    assertOpen(db, g.semester, g.classId, ctx.user);
    if (g.locked) throw httpError(403, 'Wpis zablokowany — cofnięcie wymaga zgody dyrekcji.', { code: 'grade_locked' });
    const before = Object.assign({}, g);
    const after = db.update('grades', g.id, { deleted: true, deletedReason: reason, deletedBy: ctx.user.id, deletedAt: U.now() });
    ctx.audit({ action: 'grade_revert', entity: 'grade', entityId: g.id, before, after: Object.assign({}, after), reason });
    const sg = D.studentGrades(db, g.studentId, g.subjectId, g.semester);
    return { ok: true, reverted: { id: g.id, value: before.value, categoryName: before.categoryName, weight: before.weight, date: before.date }, reason, average: sg.average };
  }, EDITORS);

  /* ---------- 3.1.21 oceny proponowane ---------- */
  r.post('/api/grades/proposed', (ctx) => {
    const db = ctx.db, b = ctx.body || {};
    const student = db.get('students', b.studentId);
    if (!student) throw httpError(404, 'Nie znaleziono ucznia.');
    const semester = +(b.semester || D.semesterOf(db));
    const sem = D.semester(db, semester);
    const kind = b.kind || PROPOSED_KIND[semester];
    if (!PROPOSED_KIND[semester] || (kind !== 'proposedMid' && kind !== 'proposedFinal')) throw httpError(400, 'Nieprawidłowy rodzaj oceny proponowanej.');
    const today = D.today(db);
    if (sem && sem.proposedDeadline && today > sem.proposedDeadline) throw httpError(403, `Termin wystawiania ocen proponowanych (${U.fmtDate(sem.proposedDeadline)}) minął — wpis jest zablokowany.`, { code: 'proposed_deadline' });
    /* P26 — propozycja roczna dawała się wystawić we wrześniu: sprawdzany był wyłącznie górny
       termin. Propozycję wystawia się w oknie przed terminem (statut: `proposalWindowDays`,
       domyślnie 30 dni) — i to dotyczy tak samo propozycji śródrocznej, jak rocznej. */
    const windowDays = proposalWindowDays(db.data.config);
    const windowFrom = sem && sem.proposedDeadline ? U.addDays(sem.proposedDeadline, -windowDays) : null;
    if (windowFrom && today < windowFrom) throw httpError(403, `${cap(KIND_LABEL[kind])} dla ${(sem.name || 'semestru ' + semester).toLowerCase()} jest możliwa dopiero od ${U.fmtDate(windowFrom)} — ${windowDays} ${U.plural(windowDays, 'dzień', 'dni', 'dni')} przed terminem ${U.fmtDate(sem.proposedDeadline)}.`, { code: 'proposal_window', from: windowFrom, deadline: sem.proposedDeadline, windowDays });
    const out = writeGrade(ctx, Object.assign({}, b, { semester, kind, categoryId: null, weight: 1 }));
    const subject = db.get('subjects', b.subjectId);
    const who = D.userLabel(ctx.user);
    const text = `Ocena proponowana ${kind === 'proposedMid' ? 'śródroczna' : 'roczna'} z przedmiotu ${subject ? subject.name.toLowerCase() : b.subjectId}: ${out.grade.value} — ${sLabel(student, db)}.`;
    const notified = [];
    const su = db.one('users', (u) => u.role === 'student' && u.studentId === student.id);
    /* GAP-7: `D.notify` zwraca `null`, gdy konta nie ma albo powiadomienie o tym samym kluczu
       już istnieje — lista powiadomionych nie może się o to przewrócić. */
    const sn = su ? D.notify(db, su.id, 'grade', text, { link: '/oceny' }) : null;
    if (sn) notified.push(sn.userId);
    for (const n of D.notifyParentsOf(db, student.id, 'grade', text, { link: '/oceny' })) notified.push(n.userId);
    const toUserIds = notified.slice();
    const message = toUserIds.length ? D.sendMessage(db, {
      fromUserId: ctx.user.id, toUserIds, kind: 'message',
      subject: `Ocena proponowana — ${subject ? subject.name : b.subjectId}`,
      body: `${text}\n\nTermin wystawienia ocen proponowanych: ${U.fmtDate(sem.proposedDeadline)}. Wystawił(a): ${who}. Uwagi i prośbę o rozmowę można przesłać w odpowiedzi na tę wiadomość.`
    }) : null;
    ctx.audit({ action: 'grade_proposed', entity: 'grade', entityId: out.grade.id, after: Object.assign({}, out.grade), reason: b.reason || null });
    return { grade: out.grade, deadline: sem.proposedDeadline, windowFrom, windowDays, notified, messageId: message ? message.id : null, text };
  }, EDITORS);

  /* ---------- 3.1.10 / 3.6 / 3.7 — oceny ucznia z komentarzami ---------- */
  r.get('/api/grades/student/:studentId', (ctx) => {
    const db = ctx.db, sid = ctx.params.studentId;
    const student = db.get('students', sid);
    if (!student) throw httpError(404, 'Nie znaleziono ucznia.');
    assertRead(db, ctx.user, sid, 'grades');
    const semester = +(ctx.query.semester || D.semesterOf(db));
    const subjectId = ctx.query.subjectId || null;
    const sg = D.studentGrades(db, sid, subjectId, semester);
    const grades = sg.grades.map((g) => ({
      id: g.id, subjectId: g.subjectId, subjectName: (db.get('subjects', g.subjectId) || {}).name, categoryName: g.categoryName, weight: g.weight,
      value: g.value, points: g.points, maxPoints: g.maxPoints, percent: g.percent, comment: g.comment, date: g.date, kind: g.kind,
      countsInAverage: g.countsInAverage, retakeOfId: g.retakeOfId || null, proposedId: g.proposedId || null, makeup: !!g.makeup, teacher: D.userLabel(db.get('users', g.teacherId))
    })).sort((a, b) => (a.date < b.date ? -1 : 1));
    return Object.assign({ studentId: sid, student: sLabel(student, db), semester, subjectId, grades, average: sg.average, count: sg.count, proposed: sg.proposed ? sg.proposed.value : null, retakeRule: db.data.config.retakeRule }, proposalView(db, sg));
  });

  /* ---------- 3.1.16 ocena opisowa klas 1–3 ---------- */
  r.get('/api/phrase-bank', (ctx) => {
    const areas = ctx.db.data.developmentAreas || [];
    const bank = ctx.db.data.phraseBank || [];
    return { areas: areas.map((a) => ({ area: a, phrases: bank.filter((p) => p.area === a) })), phrases: bank };
  }, { roles: ['staff'] });

  r.get('/api/descriptive-grades', (ctx) => {
    const db = ctx.db; const sid = ctx.query.studentId, classId = ctx.query.classId;
    /* Bez zakresu zapytanie zwracało oceny opisowe wszystkich uczniów szkoły — także kontu ucznia i rodzica. */
    if (!sid && !classId) throw httpError(400, 'Podaj ucznia (studentId) albo oddział (classId).', { code: 'no_scope' });
    if (sid) assertRead(db, ctx.user, sid, 'descriptive');
    else if (D.visibleStudentIds(db, ctx.user)) throw httpError(403, 'Oceny opisowe całego oddziału widzi wyłącznie pracownik szkoły.', { code: 'forbidden' });
    else assertReadAll(db, ctx.user, db.col('students').filter((s) => s.classId === classId).map((s) => s.id), 'descriptive');
    const semester = +(ctx.query.semester || D.semesterOf(db));
    const list = db.col('descriptiveGrades').filter((d) => d.semester === semester && (!sid || d.studentId === sid) && (!classId || (db.get('students', d.studentId) || {}).classId === classId));
    return { semester, descriptive: list.map((d) => Object.assign({ student: sLabel(db.get('students', d.studentId), db) }, d)) };
  });

  r.post('/api/descriptive-grades', (ctx) => {
    const db = ctx.db, b = ctx.body || {};
    const student = db.get('students', b.studentId);
    if (!student) throw httpError(404, 'Nie znaleziono ucznia.');
    const cls = db.get('classes', student.classId);
    if (!cls || cls.level > 3) throw httpError(400, 'Ocena opisowa dotyczy wyłącznie klas 1–3 szkoły podstawowej.', { code: 'not_early_education' });
    if (ctx.user.role !== 'principal' && !D.isHomeroomOf(db, ctx.user, cls.id) && !(ctx.user.subjects || []).includes('edw')) throw httpError(403, 'Ocenę opisową wystawia nauczyciel edukacji wczesnoszkolnej lub wychowawca klasy.', { code: 'forbidden' });
    const areas = db.data.developmentAreas || [];
    const area = String(b.area || '').trim();
    if (!areas.includes(area)) throw httpError(400, `Nieznany obszar rozwoju. Dostępne: ${areas.join(', ')}.`, { code: 'bad_area' });
    const semester = +(b.semester || D.semesterOf(db));
    assertOpen(db, semester, cls.id, ctx.user);
    const phraseIds = Array.isArray(b.phraseIds) ? b.phraseIds : [];
    const phrases = phraseIds.map((pid) => { const p = (db.data.phraseBank || []).find((x) => x.id === pid); if (!p) throw httpError(400, `Nie znaleziono sformułowania ${pid} w banku zwrotów.`); if (p.area !== area) throw httpError(400, `Sformułowanie „${p.text}” należy do obszaru „${p.area}”, nie „${area}”.`); return p; });
    const text = [phrases.map((p) => p.text).join(' '), String(b.text || '').trim()].filter(Boolean).join(' ').trim();
    if (!text) throw httpError(400, 'Wybierz sformułowania z banku zwrotów lub wpisz własny opis.');
    const prev = db.col('descriptiveGrades').find((d) => d.studentId === student.id && d.semester === semester && d.area === area);
    let doc;
    if (prev) { const before = Object.assign({}, prev); doc = db.update('descriptiveGrades', prev.id, { text, phraseIds, teacherId: ctx.user.id, at: U.now() }); ctx.audit({ action: 'descriptive_grade_update', entity: 'descriptiveGrade', entityId: doc.id, before, after: Object.assign({}, doc), reason: b.reason || null }); }
    else { doc = db.insert('descriptiveGrades', { studentId: student.id, semester, area, text, phraseIds, teacherId: ctx.user.id, at: U.now() }); ctx.audit({ action: 'descriptive_grade_create', entity: 'descriptiveGrade', entityId: doc.id, after: Object.assign({}, doc) }); }
    const all = db.col('descriptiveGrades').filter((d) => d.studentId === student.id && d.semester === semester);
    return { descriptive: doc, student: sLabel(student, db), areas: areas.map((a) => ({ area: a, filled: all.some((d) => d.area === a) })), filled: all.length, total: areas.length };
  }, EDITORS);

  /* ---------- 3.1.24 eksport CSV z anonimizacją ---------- */
  r.get('/api/grades/export.csv', (ctx) => {
    const db = ctx.db, { classId, subjectId } = ctx.query;
    if (!classId || !subjectId) throw httpError(400, 'Podaj klasę i przedmiot.');
    assertTeaches(db, ctx.user, subjectId, classId);
    const semester = +(ctx.query.semester || D.semesterOf(db));
    const sem = D.semester(db, semester);
    const anon = ctx.query.anonymize === '1' || ctx.query.anonymize === 'true';
    const subject = db.get('subjects', subjectId);
    const students = db.col('students').filter((s) => s.classId === classId).sort((a, b) => a.rollNo - b.rollNo);
    assertReadAll(db, ctx.user, students.map((s) => s.id), 'grades');
    const label = (s) => (anon ? `uczeń nr ${s.rollNo}` : sLabel(s, db).replace(/^\d+\.\s*/, ''));
    const header = ['Nr w dzienniku', anon ? 'Identyfikator' : 'Uczeń', 'Przedmiot', 'Kategoria', 'Waga', 'Ocena', 'Punkty', 'Maks. punktów', 'Procent', 'Data', 'Liczy się do średniej', 'Komentarz'];
    const rows = [];
    for (const s of students) {
      const sg = D.studentGrades(db, s.id, subjectId, semester);
      for (const g of sg.grades) {
        rows.push([s.rollNo, label(s), subject ? subject.name : subjectId, g.categoryName || (g.kind === 'partial' ? 'inne' : 'ocena proponowana'), g.weight,
          g.value, g.points == null ? '' : g.points, g.maxPoints == null ? '' : g.maxPoints, g.percent == null ? '' : String(g.percent).replace('.', ','),
          U.fmtDate(g.date), g.countsInAverage ? 'tak' : 'nie', anon ? '' : (g.comment || '')]);
      }
    }
    rows.push([]);
    rows.push(['Nr w dzienniku', anon ? 'Identyfikator' : 'Uczeń', 'Średnia ważona', 'Liczba ocen', 'Obecności', 'Nieobecności', 'Spóźnienia', 'Usprawiedliwione', 'Frekwencja %']);
    for (const s of students) {
      const sg = D.studentGrades(db, s.id, subjectId, semester);
      const att = db.col('attendance').filter((a) => a.studentId === s.id && a.subjectId === subjectId && !a.draft && (!sem || (a.date >= sem.from && a.date <= sem.to)));
      const st = D.attendanceStats(att);
      rows.push([s.rollNo, label(s), sg.average == null ? '' : U.fmtAvg(sg.average), sg.count, st.ob, st.nb, st.sp, st.zw + st.u, st.percent == null ? '' : String(st.percent).replace('.', ',')]);
    }
    const title = `Oceny cząstkowe i frekwencja · ${subject ? subject.name : subjectId} · ${classId} · ${sem ? sem.name : 'semestr ' + semester}`;
    const body = anon
      ? D.csv([[title], [], header].concat(rows), ['Dane zanonimizowane'])
      : D.csv([[], header].concat(rows), [title]);
    ctx.audit({ action: 'grades_export', entity: 'class', entityId: classId, after: { subjectId, semester, anonymized: anon, rows: rows.length } });
    return { __raw: true, body, contentType: 'text/csv; charset=utf-8', filename: `oceny-${classId}-${subjectId}-sem${semester}${anon ? '-anon' : ''}.csv` };
  }, EDITORS);

  /* ---------- 3.1.20 wydruk dla rodzica ---------- */
  r.get('/api/grades/record/:studentId', (ctx) => {
    const db = ctx.db, sid = ctx.params.studentId;
    const student = db.get('students', sid);
    if (!student) throw httpError(404, 'Nie znaleziono ucznia.');
    assertRead(db, ctx.user, sid, 'grades');
    const semester = +(ctx.query.semester || D.semesterOf(db));
    const sem = D.semester(db, semester);
    const cfg = db.data.config;
    const subjectIds = ctx.query.subjectId ? [ctx.query.subjectId] : [...new Set(db.col('grades').filter((g) => g.studentId === sid && g.semester === semester && !g.deleted).map((g) => g.subjectId))];
    const esc = D.xmlEsc;
    let body = `<h1>Wykaz ocen i frekwencji · ${esc(sLabel(student, db))} · klasa ${esc(student.classId)}</h1>`;
    body += `<p class="note">${esc(sem ? sem.name : 'Semestr ' + semester)} roku szkolnego ${esc(cfg.year)} · dokument na indywidualne spotkanie z rodzicem · stan na ${esc(U.fmtDate(D.today(db)))}.</p>`;
    for (const subjectId of subjectIds) {
      const subject = db.get('subjects', subjectId);
      const sg = D.studentGrades(db, sid, subjectId, semester);
      body += `<h2>${esc(subject ? subject.name : subjectId)}</h2>`;
      // Tabela czytana na głos przez czytnik ekranu: <caption> mówi, czego dotyczy, a scope wiąże komórki z nagłówkami.
      body += `<table><caption>Oceny · ${esc(subject ? subject.name : subjectId)} · ${esc(sem ? sem.name : 'semestr ' + semester)}</caption><thead><tr><th scope="col">Kategoria</th><th scope="col">Waga</th><th scope="col">Ocena</th><th scope="col">Data</th><th scope="col">Komentarz nauczyciela</th></tr></thead><tbody>`;
      for (const g of sg.grades.slice().sort((a, b) => (a.date < b.date ? -1 : 1))) {
        body += `<tr><th scope="row">${esc(g.categoryName || (g.kind === 'partial' ? 'inne' : 'ocena proponowana'))}${g.retakeOfId ? ' (poprawa)' : ''}${g.countsInAverage ? '' : ' (poza średnią)'}</th><td>${esc(g.weight)}</td><td>${esc(g.value)}${g.percent != null ? ' · ' + esc(String(g.percent).replace('.', ',')) + ' %' : ''}</td><td>${esc(U.fmtDate(g.date))}</td><td>${esc(g.comment || '—')}</td></tr>`;
      }
      body += '</tbody></table>';
      const att = db.col('attendance').filter((a) => a.studentId === sid && a.subjectId === subjectId && !a.draft && (!sem || (a.date >= sem.from && a.date <= sem.to)));
      const st = D.attendanceStats(att);
      body += `<p>Średnia ważona: <b>${esc(U.fmtAvg(sg.average))}</b> z ${esc(sg.count)} ${esc(U.plural(sg.count, 'oceny', 'ocen', 'ocen'))} · frekwencja: ${esc(st.percent == null ? '—' : String(st.percent).replace('.', ',') + ' %')} (obecności ${esc(st.ob)}, nieobecności ${esc(st.nb)}, spóźnienia ${esc(st.sp)} · ${esc(st.lateMinutes)} min).</p>`;
    }
    const descriptive = db.col('descriptiveGrades').filter((d) => d.studentId === sid && d.semester === semester);
    if (descriptive.length) {
      body += '<h2>Ocena opisowa</h2><table><caption>Ocena opisowa — obszary rozwoju</caption><thead><tr><th scope="col">Obszar</th><th scope="col">Opis</th></tr></thead><tbody>';
      for (const d of descriptive) body += `<tr><th scope="row">${esc(d.area)}</th><td>${esc(d.text)}</td></tr>`;
      body += '</tbody></table>';
    }
    const remarks = db.col('remarks').filter((x) => x.studentId === sid);
    if (remarks.length) {
      body += '<h2>Uwagi</h2><table><caption>Uwagi i pochwały z dziennika lekcyjnego</caption><thead><tr><th scope="col">Data</th><th scope="col">Rodzaj</th><th scope="col">Treść</th><th scope="col">Punkty</th></tr></thead><tbody>';
      for (const x of remarks) body += `<tr><th scope="row">${esc(U.fmtDate(x.date))}</th><td>${esc({ positive: 'pochwała', negative: 'uwaga', neutral: 'informacja' }[x.kind] || x.kind)}</td><td>${esc(x.text)}</td><td>${esc(x.points || 0)}</td></tr>`;
      body += '</tbody></table>';
    }
    body += '<div class="sign"><span>Nauczyciel przedmiotu</span><span>Rodzic / opiekun prawny</span></div>';
    const html = D.printHtml(`Wykaz ocen · ${sLabel(student, db)}`, body, {
      school: cfg.school.name, schoolMeta: cfg.school.address, docNo: `Nr ${student.registerNo}/${cfg.year.replace('/', '-')}/${student.classId}`,
      date: `Kraków, ${U.fmtDate(D.today(db))}`, printed: U.fmtDate(D.today(db)),
      css: 'tbody th{background:#fff;font-weight:400}'
    });
    ctx.audit({ action: 'grades_record_print', entity: 'student', entityId: sid, after: { semester, subjectIds } });
    ctx.res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Content-Disposition': 'inline', 'Cache-Control': 'no-store' });
    ctx.res.end(html);
  });
}

module.exports = { register, gridFor, statsFor, writeGrade, assertCanSee, sLabel };
