'use strict';
/* R1 — wspólny model pozycji planu lekcji.
   Kolekcja `timetable` miała siedem kolumn (`classId, weekday, lessonNo, subjectId, teacherId, room,
   groupId`). Prawdziwy plan z aSc albo z Optivum niesie jeszcze trzy rzeczy, bez których każdy import
   zgłasza setki fałszywych konfliktów (patrz tests/fixtures/real-formats/README.md, „Trzy rzeczy…”):

     week       'A' | 'B' | null   — cykl dwutygodniowy; null = co tydzień (stare zachowanie),
     teacherIds [id, …]            — lekcja z nauczycielem wspomagającym; teacherId = teacherIds[0],
     groupLabel 'chłopcy', '1/2'   — nazwa podziału z pliku, gdy nie ma u nas grupy o tym id,
     source     { tool, ref }      — skąd wiersz pochodzi (aSc/Optivum + identyfikator z pliku).

   Wiersze zapisane wcześniej nie mają tych pól: `normalize()` dokłada je przy odczycie, więc stary
   plan zachowuje się dokładnie jak przedtem. Dokumentacja: docs/IMPORT.md. */

const U = require('./util');

const WEEKS = ['A', 'B'];

/** Pozycja planu w pełnym kształcie — bez mutowania dokumentu w bazie. */
function normalize(t) {
  if (!t) return t;
  const teacherIds = Array.isArray(t.teacherIds) && t.teacherIds.length ? t.teacherIds.slice() : (t.teacherId ? [t.teacherId] : []);
  return {
    id: t.id, classId: t.classId, weekday: t.weekday, lessonNo: t.lessonNo,
    subjectId: t.subjectId, teacherId: teacherIds[0] || t.teacherId || null, teacherIds,
    room: t.room || '', groupId: t.groupId || null,
    groupLabel: t.groupLabel || null,
    week: WEEKS.includes(t.week) ? t.week : null,
    source: t.source || null,
    line: t.line
  };
}

/** Tożsamość podziału: id naszej grupy, a gdy go nie ma — etykieta z pliku. `null` = cały oddział. */
const groupKey = (t) => t.groupId || t.groupLabel || null;

/** Czy dwa wiersze mogą zderzyć się w czasie: `null` (co tydzień) nachodzi na wszystko. */
const weeksOverlap = (a, b) => !a || !b || a === b;

/** Czy dwa wiersze tego samego oddziału dotyczą tych samych uczniów.
    Cały oddział nachodzi na każdą grupę; dwie różne grupy są rozłączne. */
function groupsOverlap(a, b) {
  const ga = groupKey(a), gb = groupKey(b);
  if (!ga || !gb) return true;
  return ga === gb;
}

const slugGroup = (label) => String(label || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
  .replace(/ł/g, 'l').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 24);

/** Identyfikator pozycji planu. Bez tygodnia i bez etykiety grupy wychodzi dokładnie stary kształt
    `tt_<oddział>_<dzień>_<nr>[_<grupa>]`, więc już wygenerowane lekcje zachowują swoje id. */
function entryId(t) {
  let id = `tt_${t.classId}_${t.weekday}_${t.lessonNo}`;
  if (t.groupId) id += '_' + t.groupId;
  else if (t.groupLabel) id += '_g-' + slugGroup(t.groupLabel);
  if (t.week) id += '_w' + t.week;
  return id;
}

/* --------------------------------------------------------------- cykl dwutygodniowy A/B */
/** Poniedziałek tygodnia, w którym leży `date`. */
function mondayOf(date) {
  const wd = U.weekday(date);                                  // 1 = poniedziałek … 7 = niedziela
  return U.addDays(date, 1 - wd);
}
/**
 * Kotwica cyklu A/B: `config.weekCycleAnchor` (data, RRRR-MM-DD), a domyślnie **pierwszy poniedziałek
 * roku szkolnego** — poniedziałek tygodnia, w którym zaczyna się pierwszy semestr. Tydzień kotwicy to
 * zawsze tydzień **A**. Szkoła, która liczy inaczej (bo zaczęła od tygodnia II), przestawia jedną
 * wartość w konfiguracji zamiast poprawiać plan.
 */
function weekAnchor(db) {
  const cfg = (db && db.data && db.data.config) || {};
  if (/^\d{4}-\d{2}-\d{2}$/.test(String(cfg.weekCycleAnchor || ''))) return mondayOf(cfg.weekCycleAnchor);
  const sem = cfg.semesters || [];
  const start = (sem[0] && sem[0].from) || cfg.today || '2026-09-01';
  return mondayOf(start);
}
/** 'A' albo 'B' dla podanego dnia — parzystość liczby pełnych tygodni od kotwicy. */
function weekOf(db, date) {
  const anchor = weekAnchor(db);
  const n = Math.floor(U.daysBetween(anchor, mondayOf(date)) / 7);
  return ((n % 2) + 2) % 2 === 0 ? 'A' : 'B';
}
/** Czy pozycja planu obowiązuje w danym dniu (null = co tydzień). */
const runsOn = (db, t, date) => !t.week || t.week === weekOf(db, date);

/* --------------------------------------------------------------- plan dzwonków (OPS3-03)
   Numer lekcji w planie sprawdzamy po **istnieniu dzwonka o tym numerze** (`admin.js knownLessonNo`),
   więc szkoła z „godziną 0” (7:10 — realny kształt eksportów aSc) potrzebowała wpisu `{ no: 0 }`.
   Komunikat importu odsyłał do „ustawień szkoły”, w których nie było czego ustawić: żadna trasa nie
   zapisywała `config.lessonTimes`. Walidacja siedzi tutaj, bo to część modelu planu, a nie trasy. */
const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;
/** `{ ok, errors, lessonTimes }` — posortowany plan dzwonków albo lista zdań po polsku. */
function validateLessonTimes(list) {
  const errors = [];
  if (!Array.isArray(list) || !list.length) return { ok: false, errors: ['Plan dzwonków musi mieć co najmniej jedną pozycję { no, start, end }.'], lessonTimes: null };
  if (list.length > 20) errors.push('Plan dzwonków ma najwyżej 20 pozycji.');
  const seen = new Set(); const rows = [];
  for (const raw of list) {
    const t = raw || {}; const no = Number(t.no);
    if (!Number.isInteger(no) || no < 0 || no > 19) { errors.push(`Numer lekcji „${t.no}” jest spoza zakresu 0–19 (0 to „godzina zerowa”).`); continue; }
    if (!HHMM.test(String(t.start || '')) || !HHMM.test(String(t.end || ''))) { errors.push(`Lekcja ${no}: godziny muszą mieć format GG:MM (podano „${t.start}”–„${t.end}”).`); continue; }
    if (String(t.start) >= String(t.end)) { errors.push(`Lekcja ${no}: początek ${t.start} nie jest wcześniejszy niż koniec ${t.end}.`); continue; }
    if (seen.has(no)) { errors.push(`Numer lekcji ${no} występuje dwa razy.`); continue; }
    seen.add(no); rows.push({ no, start: String(t.start), end: String(t.end) });
  }
  rows.sort((a, b) => a.no - b.no);
  for (let i = 1; i < rows.length; i++) {
    if (rows[i].start < rows[i - 1].end) errors.push(`Lekcja ${rows[i].no} (${rows[i].start}) zaczyna się, zanim skończy się lekcja ${rows[i - 1].no} (${rows[i - 1].end}).`);
  }
  return { ok: !errors.length, errors, lessonTimes: errors.length ? null : rows };
}

module.exports = { normalize, normalizeAll: (list) => list.map(normalize), groupKey, groupsOverlap, weeksOverlap, entryId, slugGroup, weekAnchor, weekOf, runsOn, mondayOf, WEEKS, validateLessonTimes };
