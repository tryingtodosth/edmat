'use strict';
/* First-run wizard for a single school: create the school and the first admin, then import staff, students (with parent codes) and the timetable, and generate lesson instances. Public only while no admin exists.
   The import endpoints stay usable after the wizard closes — that is how a school adds a teacher or a pupil in February. They therefore validate duplicates, record every batch in `imports` and can be undone. */
const { httpError } = require('../lib/router'); const C = require('../lib/crypto'); const U = require('../lib/util'); const D = require('../lib/domain'); const { audit } = require('../lib/audit');
const auth = require('../auth');
const TT = require('../lib/timetable');                 // R1: cykl dwutygodniowy A/B i grupy w planie
const CSV = require('../lib/csv');                     // R1: parser CSV z cudzysłowami (nabór, UONET+)
const ID = require('../lib/identity');                 // R7: dokument tożsamości ucznia bez PESEL
function needed(db) { return !db.col('users').some((u) => u.role === 'admin'); }
/** config.setup exists only in schools born from the wizard; every other school (demo seed, migrated base) must not crash the importers. */
function steps(db) { const c = db.data.config; if (!c.setup) c.setup = { done: !!db.col('users').some((u) => u.role === 'admin'), startedAt: U.now(), steps: {} }; if (!c.setup.steps) c.setup.steps = {}; return c.setup.steps; }
function slug(s) { return String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/ł/g, 'l').replace(/[^a-z0-9]+/g, '.').replace(/^\.|\.$/g, ''); }
function uniqueLogin(db, base) { let l = base || 'user', i = 1; while (db.one('users', (u) => u.login === l)) l = `${base}${++i}`; return l; }
function tempPassword() { const a = 'ABCDEFGHJKLMNPQRSTUVWXYZ', b = 'abcdefghjkmnpqrstuvwxyz', d = '23456789', sp = '!#$%'; const pick = (s, n) => Array.from({ length: n }, () => s[Math.floor(Math.random() * s.length)]).join(''); return pick(a, 3) + pick(b, 5) + '-' + pick(d, 4) + pick(sp, 1); }
/* P8: wiersz o innej liczbie kolumn niż nagłówek przesuwał pola po cichu (klasa lądowała w imieniu,
   data urodzenia w nazwisku). Teraz taki wiersz nie wchodzi do importu, tylko wraca jako błąd
   z numerem linii oraz liczbą kolumn oczekiwaną i znalezioną. */
function parseCsv(text) {
  /* R1/R7 — parser RFC-4180 z server/lib/csv.js: cudzysłowy, średnik w polu (uwaga sądowa w
     eksporcie naboru), każda komórka w cudzysłowie (UONET+), BOM, CRLF. Kontrakt bez zmian:
     `{header, rows, errors}`, błąd `column_count` na wiersz o złej liczbie kolumn. */
  const parsed = CSV.parseObjects(String(text || ''), { strict: true });
  const header = parsed.header;
  const rows = parsed.rows.map((r) => { const o = { _line: r._line }; header.forEach((h) => { o[h] = String(r[h] == null ? '' : r[h]).trim(); }); return o; });
  const errors = parsed.errors.map((e) => (e.code === 'column_count' ? Object.assign({}, e, { error: `Oczekiwano ${e.expected} ${U.plural(e.expected, 'kolumny', 'kolumn', 'kolumn')}, znaleziono ${e.actual} — popraw wiersz, zanim go zaimportujesz.` }) : e));
  return { header, rows, errors };
}
/* GAP-6 — jedna data przyjęcia. Import stemplujący cały rocznik dniem wgrania pliku robił z całej
   szkoły uczniów „dopisanych w trakcie roku”; datą domyślną jest więc początek roku szkolnego, a nie
   dzień importu. Wiersz z własną kolumną `enrolledAt` (uczeń przyjęty w lutym) ma pierwszeństwo. */
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const yearStart = (db) => { const sem = db.data.config.semesters || []; return (sem[0] && sem[0].from) || D.today(db); };
function enrolledAtOf(db, raw, line, errors) {
  const v = String(raw || '').trim();
  if (!v) return yearStart(db);
  if (!ISO_DATE.test(v)) { errors.push({ line, error: `„${v}” nie wygląda jak data przyjęcia — użyj formatu RRRR-MM-DD w kolumnie „enrolledAt”.`, code: 'bad_date' }); return null; }
  return v;
}

/* ------------------------------------------------------------------ nagłówki plików szkoły (OPS3-05)
   Kreator szukał dosłownie kolumn `firstName`/`lastName`/`class`. Szkoła ma `Nazwisko;Imię;…`
   (arkusz organizacyjny) i `Opiekun 1 – nazwisko;…` (eksport naboru), więc oba importy odrzucały
   100 % wierszy komunikatem „Brak imienia lub nazwiska.” — jednym na wiersz, bez słowa o tym, jakiej
   kolumny brakuje ani jakie są dozwolone. Tabela aliasów rejestru (`server/lib/identity.js COLUMNS`)
   już istniała; tu dokładamy to, czego ona nie zna: kadrę, drugiego opiekuna, płeć i uwagi.
   Dopasowanie idzie przez `CSV.headerKey`, więc półpauza w „Opiekun 1 – nazwisko”, wielkość liter
   i polskie znaki nie mają znaczenia. */
const TEACHER_COLUMNS = {
  login: ['login', 'uzytkownik', 'nazwa uzytkownika', 'username'],
  firstName: ['firstname', 'imie', 'imie nauczyciela', 'first name'],
  lastName: ['lastname', 'nazwisko', 'nazwisko nauczyciela', 'last name'],
  title: ['title', 'tytul', 'stopien', 'stopien awansu zawodowego', 'stopien awansu'],
  subjects: ['subjects', 'przedmioty', 'przedmiot', 'nauczane przedmioty'],
  homeroomOf: ['homeroomof', 'wychowawstwo', 'wychowawca', 'oddzial wychowawcy', 'wychowawstwo oddzialu'],
  /* Skrót z arkusza organizacyjnego („NJ”) to dokładnie ten klucz, którym posługują się aSc i Optivum
     (`admin.js teacherShort`), więc zapisany przy koncie robi z importu planu dopasowanie dokładne. */
  short: ['short', 'skrot', 'skrót', 'inicjaly', 'kod nauczyciela'],
  email: ['email', 'e-mail', 'adres e-mail', 'poczta', 'mail']
};
/* OPS3-06/20 — aliasy kolumn (także blok opiekunów, `sex`, `note`, `enrolledAt`) mieszkają teraz
   w `server/lib/identity.js` i są wspólne dla kreatora oraz dla próbnego dopasowania w sekretariacie.
   Tutaj zostaje wyłącznie to, co jest specyficzne dla kreatora: własna nazwa kolumny `class`. */
const STUDENT_COLUMNS = Object.assign({}, ID.COLUMNS, {
  class: ID.COLUMNS.classId.concat(['class'])
});
/** Wartość kolumny po dowolnym z jej aliasów; `row[field]` (nasz własny nagłówek) ma pierwszeństwo. */
function cellOf(table, row, field) {
  if (row[field] !== undefined && String(row[field]).trim()) return String(row[field]).trim();
  for (const alias of table[field] || []) { const v = CSV.column(row, alias); if (v !== undefined && String(v).trim()) return String(v).trim(); }
  return '';
}
const aliasHit = (table, field, head) => (table[field] || []).some((a) => CSV.headerKey(a) === CSV.headerKey(head)) || CSV.headerKey(field) === CSV.headerKey(head);
/** Diagnostyka nagłówka: co plik ma, czego brakuje i jakie nazwy są przyjmowane. */
function headerDiagnostics(header, table, required) {
  const known = Object.keys(table);
  const missing = required.filter((f) => !header.some((hd) => aliasHit(table, f, hd)));
  const unknownColumns = header.filter((hd) => hd && !known.some((f) => aliasHit(table, f, hd)));
  return { columns: header.slice(), missing, unknownColumns };
}
function headerError(diag, table) {
  const names = diag.missing.map((f) => `„${f}”`).join(', ');
  const aliases = diag.missing.map((f) => `${f}: ${(table[f] || []).slice(0, 6).join(', ')}`).join(' · ');
  return { error: `W pliku nie ma ${diag.missing.length === 1 ? 'kolumny' : 'kolumn'} ${names}. Plik ma kolumny: ${diag.columns.join(', ') || '(brak nagłówka)'}. Przyjmowane nazwy — ${aliases}. Popraw nagłówek albo wgraj plik z tymi kolumnami; reszta pliku jest czytelna.`,
    code: 'header_missing', missing: diag.missing, columns: diag.columns };
}
/* OPS3-10 — jeden numer księgi uczniów dla całej szkoły. Kreator zaczynał od 1000, sekretariat od
   1200, więc pierwszy uczeń przyjęty po kreatorze dostawał 1201 przy roczniku kończącym się na 1060:
   140-numerowa dziura w księdze, dokładnie ten defekt, który OPS-09 zamknął wewnątrz jednej trasy.
   Podłogę (gdy księga jest pusta) ustawia `config.registerNoStart`, domyślnie 1.
   Używa tego także `server/routes/registry.js` — jedna funkcja, jedna podłoga. */
function nextRegisterNo(db) {
  const cfg = db.data.config || {};
  /* Domyślna podłoga 1201 to dokładnie to, co liczył sekretariat (`reduce(…, 1200) + 1`), więc
     dopóki `registry.js` nie zacznie wołać tej funkcji, obie trasy i tak dają ten sam ciąg i żadna
     dziura nie powstaje. Szkoła, która chce numerować od jedynki, ustawia `config.registerNoStart`. */
  const floor = Number.isInteger(cfg.registerNoStart) ? cfg.registerNoStart : 1201;
  const max = db.col('students').reduce((m, s) => Math.max(m, +s.registerNo || 0), 0);
  return Math.max(max + 1, floor);
}
/* OPS3-15 — numery w dzienniku liczone tak samo w próbie i w zapisie. W `dryRun` nic nie wchodzi do
   bazy, więc „następny wolny numer” wypadał 1 dla każdego wiersza i próba wypisywała 58 ostrzeżeń
   „numer zajęty”, których właściwy import już nie miał. Stan trzymamy w pamięci przebiegu. */
function rollTracker(db) {
  const state = new Map();
  return function take(classId, wanted) {
    if (!state.has(classId)) {
      const rows = db.col('students').filter((s) => s.classId === classId && s.status === 'active');
      state.set(classId, { max: rows.reduce((m, s) => Math.max(m, s.rollNo || 0), 0), taken: new Set(rows.map((s) => s.rollNo)) });
    }
    const st = state.get(classId);
    const rollNo = wanted ? +wanted : st.max + 1;
    const clash = st.taken.has(rollNo);
    st.taken.add(rollNo); if (rollNo > st.max) st.max = rollNo;
    return { rollNo, clash };
  };
}
/* OPS3-09 — płeć. Kreator nie zapisywał jej nigdy, choć sprawdzał PESEL, który ją niesie: pakiet SIO
   szedł z `plec=""` dla całej szkoły, a `homeroom.js` drukował „urodzony” na świadectwie każdej
   dziewczynki. Kolumna „Płeć”/„sex” ma pierwszeństwo, bo uczeń bez numeru PESEL nie ma skąd jej wziąć. */
function sexOf(raw, pesel) {
  const v = String(raw || '').trim().toUpperCase();
  if (/^(K|F|KOBIETA|DZIEWCZYNKA|GIRL|FEMALE)$/.test(v)) return 'K';
  if (/^(M|MEZCZYZNA|MĘŻCZYZNA|CHLOPIEC|CHŁOPIEC|BOY|MALE)$/.test(v)) return 'M';
  if (pesel) { const p = U.validatePesel(pesel); if (p.ok && p.sex) return p.sex; }
  return null;
}
const CLASS_ID = /^[0-9]{1,2}[a-zA-Z]?$/;                                  // 1a … 8c, ewentualnie sam poziom
const email = (v) => String(v || '').trim().toLowerCase();                 // scalanie rodzeństwa po adresie: bez wielkości liter i spacji
function isSchoolDay(db, d) { const c = db.data.config; return U.weekday(d) <= 5 && !(c.daysOff || []).some((x) => x.date === d) && !(c.holidays || []).some((h) => d >= h.from && d <= h.to) && !(c.winterBreak && d >= c.winterBreak.from && d <= c.winterBreak.to); }
/** Generate lesson instances from the timetable for [from, to]; idempotent (skips existing lesson ids). */
function generateLessons(db, from, to) {
  let created = 0; const tt = db.col('timetable').map(TT.normalize); const existing = new Set(db.col('lessons').map((l) => l.id));
  /* R1 — jedna pozycja planu to jedna lekcja **dla swojej grupy i w swoim tygodniu**: pozycja
     z `week: 'A'` wypada tylko w tygodniach A (parzystość liczona od `TT.weekAnchor(db)`, domyślnie
     od pierwszego poniedziałku roku szkolnego — `config.weekCycleAnchor`), a pozycja bez `week`
     co tydzień, dokładnie jak przed zmianą. Podział na grupy jedzie dalej w `groupId`, a gdy plan
     zna tylko etykietę z pliku („chłopcy”, „1/2”) — w `groupLabel`. */
  for (let d = from; d <= to; d = U.addDays(d, 1)) { if (!isSchoolDay(db, d)) continue; const wd = U.weekday(d); const wk = TT.weekOf(db, d); for (const t of tt) { if (t.weekday !== wd || (t.week && t.week !== wk)) continue; const id = `les_${t.id}_${d}`; if (existing.has(id)) continue; const les = { id, date: d, lessonNo: t.lessonNo, classId: t.classId, groupId: t.groupId || null, subjectId: t.subjectId, teacherId: t.teacherId, room: t.room, topic: null, curriculumItemIds: [], status: d < D.today(db) ? 'held' : 'planned', substituteTeacherId: null, combinedWith: null, attendanceDraft: false }; if (t.groupLabel) les.groupLabel = t.groupLabel; if (t.week) les.week = t.week; if (t.teacherIds.length > 1) les.teacherIds = t.teacherIds.slice(); db.col('lessons').push(les); existing.add(id); created++; } }
  /* Zapamiętany horyzont, a nie „najpóźniejsza lekcja”: po skasowaniu dnia wolnego z końca zakresu
     inaczej skurczyłby się na trwałe i cofnięcie decyzji nie odtworzyłoby lekcji. */
  const cfg = db.data.config; if (!cfg.lessonsGeneratedTo || cfg.lessonsGeneratedTo < to) cfg.lessonsGeneratedTo = to;
  db.save(); return created;
}

/* ------------------------------------------------------------------ uzgadnianie lekcji z planem i kalendarzem */
/* R3-01 — `hasJournal()` odpowiadało na pytanie „czy w tej lekcji cokolwiek zapisano?” czterema
   pełnymi przeglądami kolekcji (`attendance`, `grades`, `homework`, `substitutions`). `.some()` kończy
   wcześnie tylko wtedy, gdy **znajdzie**, więc odpowiedź „nic tu nie ma” — ta najczęstsza — zawsze
   kosztowała pełny przebieg: 33–63 ms na lekcję przy 300–564 tys. wierszy. Korekta arkusza
   organizacyjnego w lutym (2 112 lekcji) blokowała proces na 76 s w próbie i 160 s przy zapisie.
   Teraz jeden przebieg na import buduje `Set` identyfikatorów lekcji, w których cokolwiek jest,
   a pytanie o pojedynczą lekcję to `written.has(l.id)`. */
function journalIndex(db) {
  const written = new Set();
  for (const a of db.col('attendance')) written.add(a.lessonId);
  for (const g of db.col('grades')) if (!g.deleted) written.add(g.lessonId);
  for (const h of db.col('homework')) written.add(h.lessonId);
  for (const s of db.col('substitutions')) for (const a of s.assignments || []) written.add(a.lessonId);
  written.delete(undefined); written.delete(null);
  return written;
}
/** Czy w lekcji jest już cokolwiek zapisane — wtedy wolno ją tylko odwołać, nigdy skasować.
    `written` = indeks z `journalIndex(db)`; podaje go każdy, kto pyta o więcej niż jedną lekcję.
    Bez indeksu zostaje stara ścieżka z `.some()`: dla jednego pytania jest tańsza niż zbudowanie
    zbioru z pół miliona wierszy, a odpowiedź jest ta sama. */
function hasJournal(db, l, written) {
  if (l.topic || (l.curriculumItemIds || []).length || l.substituteTeacherId || l.movedFrom) return true;
  if (['held', 'substituted', 'rescheduled'].includes(l.status)) return true;
  if (written) return written.has(l.id);
  if (db.col('attendance').some((a) => a.lessonId === l.id)) return true;
  if (db.col('grades').some((g) => g.lessonId === l.id && !g.deleted)) return true;
  if (db.col('homework').some((h) => h.lessonId === l.id)) return true;
  if (db.col('substitutions').some((s) => (s.assignments || []).some((a) => a.lessonId === l.id))) return true;
  return false;
}
/** Dokąd sięga już wygenerowany dziennik — po zmianie planu odtwarzamy dokładnie ten sam horyzont.
    `empty` znaczy, że lekcji jeszcze nie ma (pierwszy import w kreatorze): nie ma czego uzgadniać. */
function lessonHorizon(db) {
  const cfg = db.data.config; const sem = cfg.semesters || []; const today = D.today(db);
  const from = U.addDays(today, 1);
  const last = db.col('lessons').reduce((m, l) => (l.date > m ? l.date : m), cfg.lessonsGeneratedTo || '');
  return { from, to: last || (sem.length ? sem[sem.length - 1].to : from), empty: !last };
}
/** Uzgadnia lekcje w [from,to] z bieżącym planem i kalendarzem. Nic nie kasuje, jeśli w lekcji coś zapisano. */
function syncLessons(db, opts) {
  const o = opts || {}; const h = lessonHorizon(db);
  if (h.empty && !o.to) return { from: h.from, to: h.to, skipped: true, created: 0, removed: 0, removedIds: [], cancelled: 0, cancelledLessons: [], restored: 0 };
  const from = o.from || h.from, to = o.to || h.to, reason = o.reason || 'timetable_changed';
  /* OPS-21 — identyfikator pozycji planu to `tt_<oddział>_<dzień>_<nr>[_<grupa>]`: nie ma w nim ani
     przedmiotu, ani nauczyciela, ani sali. Po korekcie arkusza organizacyjnego („piątą godzinę we
     czwartek prowadzi teraz kto inny, w innej sali”) slot zostaje ten sam, więc lekcja nie była ani
     usuwana, ani dogenerowana — i do końca roku wisiała ze starym nauczycielem. Uzgadniamy więc
     także **treść** slotu: lekcję bez wpisów w dzienniku dociągamy do planu, lekcję z wpisami
     zostawiamy nietkniętą i raportujemy w `conflicts` (historii dziennika nie wolno przepisywać). */
  const tt = new Set(db.col('timetable').map((t) => t.id));
  const ttById = new Map(db.col('timetable').map((t) => [t.id, TT.normalize(t)]));
  const written = journalIndex(db);                       // R3-01: jeden indeks na cały przebieg
  const idOf = (l) => l.id.replace(/^les_/, '').replace(new RegExp('_' + l.date + '$'), '');
  const removed = [], cancelled = [], restored = [], changed = [], keptWithJournal = [];
  const lessons = db.col('lessons');
  for (let i = lessons.length - 1; i >= 0; i--) {
    const l = lessons[i]; if (l.date < from || l.date > to) continue;
    const ttRow = ttById.get(idOf(l));
    const stillPlanned = tt.has(idOf(l)) && isSchoolDay(db, l.date) && (!ttRow || !ttRow.week || ttRow.week === TT.weekOf(db, l.date));
    if (stillPlanned) {
      const t = ttRow;
      if (t) {
        const before = { subjectId: l.subjectId, teacherId: l.teacherId, room: l.room, groupId: l.groupId || null };
        const after = { subjectId: t.subjectId, teacherId: t.teacherId, room: t.room, groupId: t.groupId || null };
        if (JSON.stringify(before) !== JSON.stringify(after)) {
          if (hasJournal(db, l, written)) keptWithJournal.push({ id: l.id, date: l.date, classId: l.classId, lessonNo: l.lessonNo, before, after });
          else { Object.assign(l, after); l.changedAt = U.now(); l.changeReason = 'Korekta planu lekcji.'; changed.push({ id: l.id, date: l.date, classId: l.classId, lessonNo: l.lessonNo, before, after }); }
        }
      }
      if (l.status === 'cancelled' && l.cancelledBy === 'calendar' ) { l.status = 'planned'; delete l.cancelledBy; delete l.cancelledReason; restored.push(l.id); }
      continue;
    }
    if (hasJournal(db, l, written)) { if (l.status !== 'cancelled') { l.status = 'cancelled'; l.cancelledBy = isSchoolDay(db, l.date) ? 'timetable' : 'calendar'; l.cancelledReason = reason; cancelled.push({ id: l.id, date: l.date, classId: l.classId, lessonNo: l.lessonNo, subjectId: l.subjectId }); } continue; }
    lessons.splice(i, 1); removed.push(l.id);
  }
  const created = generateLessons(db, from, to);
  db.save();
  return {
    from, to, created, removed: removed.length, removedIds: removed.slice(0, 50),
    cancelled: cancelled.length, cancelledLessons: cancelled.slice(0, 50), restored: restored.length,
    changed: changed.length, changedLessons: changed.slice(0, 50),
    keptWithJournal: keptWithJournal.length, keptWithJournalLessons: keptWithJournal.slice(0, 50)
  };
}

/* ------------------------------------------------------------------ partie importu (cofanie pomyłki) */
/* REL-15: import to jeden synchroniczny handler — przy 100 uczniach z rodzicami proces nie oddawał
   pętli zdarzeń przez kilkanaście sekund, a Node zamykał w tym czasie bezczynne połączenia keep-alive
   (każdy inny użytkownik dostawał zerwane połączenie). Przetwarzamy więc wiersze porcjami i między
   nimi oddajemy sterowanie. Semantyka zostaje ta sama: wiersz błędny jest pomijany i wraca w `errors`,
   reszta zapisuje się w jednym batchu, który nadal da się cofnąć w całości. */
const IMPORT_CHUNK = 50;
const breathe = () => new Promise((resolve) => setImmediate(resolve));

function recordImport(db, entry) { return db.insert('imports', Object.assign({ at: U.now(), undoneAt: null }, entry)); }
/** Co stoi na przeszkodzie cofnięciu partii — pusta lista znaczy „można”. */
function undoBlockers(db, batch) {
  const out = [];
  if (batch.kind === 'timetable') {
    /* Plan wolno cofnąć, dopóki nikt nie zdążył nic zapisać w lekcjach, które ten import dołożył. */
    const before = new Set((batch.previousTimetable || []).map((t) => t.id));
    const written = journalIndex(db);
    for (const l of db.col('lessons')) {
      const slot = l.id.replace(/^les_/, '').replace(new RegExp('_' + l.date + '$'), '');
      if (before.has(slot)) continue;
      if (hasJournal(db, l, written)) { out.push(`Lekcja ${l.classId} ${U.fmtDate(l.date)} (nr ${l.lessonNo}) z tego importu ma już wpisy w dzienniku.`); if (out.length >= 10) break; }
    }
    return out;
  }
  for (const sid of batch.studentIds || []) {
    const s = db.get('students', sid); if (!s) continue;
    const label = `${s.lastName} ${s.firstName} (nr księgi ${s.registerNo})`;
    if (db.col('grades').some((g) => g.studentId === sid && !g.deleted)) out.push(`${label}: ma wpisane oceny.`);
    else if (db.col('attendance').some((a) => a.studentId === sid)) out.push(`${label}: ma wpisy frekwencji.`);
    else if (s.status !== 'active') out.push(`${label}: wpis w księdze został już zamknięty.`);
  }
  for (const uid of batch.userIds || []) { const u = db.get('users', uid); if (u && u.lastLogin) out.push(`Konto ${u.login} było już używane (ostatnie logowanie ${U.fmtDate(u.lastLogin)}).`); }
  for (const cid of batch.codeIds || []) { const c = db.get('registrationCodes', cid); if (c && c.usedAt) out.push(`Kod rejestracyjny ${c.code} został wykorzystany do założenia konta.`); }
  return out;
}

function summary(db) {
  const c = db.data.config; const users = db.col('users');
  return { done: !!(c.setup && c.setup.done), school: !!(c.school && c.school.name), admin: users.some((u) => u.role === 'admin'), teachers: users.filter((u) => u.role === 'teacher').length, classes: db.col('classes').length, students: db.col('students').filter((s) => s.status === 'active').length, parents: users.filter((u) => u.role === 'parent').length, registrationCodes: db.col('registrationCodes').filter((x) => !x.usedAt).length, timetable: db.col('timetable').length, lessons: db.col('lessons').length, video: !!(c.video && c.video.jitsi && c.video.jitsi.domain), year: c.year, semesters: c.semesters };
}
function register(r, app) {
  r.get('/api/setup/status', (ctx) => ({ needed: needed(ctx.db), done: !!(ctx.db.data.config.setup && ctx.db.data.config.setup.done), school: ctx.db.data.config.school && ctx.db.data.config.school.name || '', year: ctx.db.data.config.year, semesters: ctx.db.data.config.semesters, policy: C.PASSWORD_POLICY }), { public: true });
  r.post('/api/setup/school', (ctx) => {
    const db = ctx.db; if (!needed(db)) throw httpError(403, 'Szkoła jest już skonfigurowana.', { code: 'setup_done' });
    const b = ctx.body || {}; const s = b.school || {}; const a = b.admin || {};
    if (!s.name || String(s.name).trim().length < 5) throw httpError(400, 'Podaj pełną nazwę szkoły.', { field: 'school.name' });
    if (!a.login || !/^[a-z0-9.]{3,32}$/.test(a.login)) throw httpError(400, 'Login administratora: 3–32 znaki, małe litery, cyfry i kropki.', { field: 'admin.login' });
    const pol = C.checkPasswordPolicy(a.password); if (!pol.ok) throw httpError(400, 'Hasło administratora nie spełnia polityki: ' + pol.missing.join(', ') + '.', { field: 'admin.password', missing: pol.missing });
    if (!a.firstName || !a.lastName) throw httpError(400, 'Podaj imię i nazwisko administratora.', { field: 'admin.firstName' });
    Object.assign(db.data.config.school, { name: String(s.name).trim(), short: String(s.short || s.name).trim().slice(0, 40), address: String(s.address || '').trim(), regon: String(s.regon || '').trim(), rspo: String(s.rspo || '').trim(), email: String(s.email || '').trim(), phone: String(s.phone || '').trim(), director: String(s.director || '').trim() });
    if (b.year && /^\d{4}\/\d{4}$/.test(b.year)) { const start = +b.year.slice(0, 4); const yr = require('../lib/blank-seed').schoolYearFor(`${start}-09-01`); db.data.config.year = b.year; db.data.config.semesters = yr.semesters; db.data.config.winterBreak = yr.winterBreak; db.data.config.holidays = yr.holidays; db.data.config.daysOff = yr.daysOff; }
    if (Array.isArray(b.semesters) && b.semesters.length === 2) b.semesters.forEach((sem, i) => { if (sem.from && sem.to) Object.assign(db.data.config.semesters[i], { from: sem.from, to: sem.to, proposedDeadline: sem.proposedDeadline || db.data.config.semesters[i].proposedDeadline, classificationDeadline: sem.classificationDeadline || db.data.config.semesters[i].classificationDeadline, classificationMeeting: sem.classificationMeeting || sem.classificationDeadline || db.data.config.semesters[i].classificationMeeting }); });
    if (b.locale === 'en' || b.locale === 'pl') db.data.config.defaultLocale = b.locale;
    const admin = { id: 'u_' + slug(a.login), login: a.login, role: 'admin', firstName: String(a.firstName).trim(), lastName: String(a.lastName).trim(), name: `${a.firstName} ${a.lastName}`.trim(), email: String(a.email || '').trim(), passwordHash: C.hashPassword(a.password), mustChangePassword: false, totpEnabled: false, blocked: false, locale: b.locale === 'en' ? 'en' : 'pl', quietHours: null, createdAt: U.now() };
    db.col('users').push(admin);
    if (b.principal && b.principal.login && b.principal.firstName) { const pw = tempPassword(); db.col('users').push({ id: 'u_' + slug(b.principal.login), login: uniqueLogin(db, b.principal.login), role: 'principal', title: b.principal.title || 'dyr.', firstName: b.principal.firstName, lastName: b.principal.lastName || '', name: `${b.principal.firstName} ${b.principal.lastName || ''}`.trim(), email: b.principal.email || '', passwordHash: C.hashPassword(pw), mustChangePassword: true, totpEnabled: false, blocked: false, createdAt: U.now(), subjects: [] }); db.data.config.setup.principalTempPassword = pw; }
    db.data.config.setup = Object.assign(db.data.config.setup || {}, { startedAt: U.now(), steps: { school: U.now() }, principalTempPassword: db.data.config.setup && db.data.config.setup.principalTempPassword });
    db.save(); audit(db, { action: 'setup_school', userId: admin.id, ip: ctx.ip, entity: 'config', entityId: 'school', after: { name: db.data.config.school.name, year: db.data.config.year } });
    const ses = { id: U.id('ses'), token: C.token(), userId: admin.id, createdAt: U.now(), lastActivity: U.now(), ip: ctx.ip, client: 'web', totpPending: false, revoked: false }; db.col('sessions').push(ses); db.save();
    ctx.setCookie(auth.cookieHeader(ses.token, !!app.options.secureCookies, 60 * 60 * 12));
    const out = { ok: true, user: auth.publicUser(admin), summary: summary(db) }; if (db.data.config.setup.principalTempPassword) { out.principalTempPassword = db.data.config.setup.principalTempPassword; delete db.data.config.setup.principalTempPassword; db.save(); } return out;
  }, { public: true });
  const ADMIN = { roles: ['admin'] };
  r.get('/api/setup/summary', (ctx) => summary(ctx.db), ADMIN);
  r.get('/api/setup/formats', () => ({ teachers: { header: 'login;firstName;lastName;title;subjects;homeroomOf;email', example: 'j.nowak;Joanna;Nowak;mgr;mat|fiz;7b;j.nowak@szkola.pl', note: 'subjects: identyfikatory przedmiotów rozdzielone |; homeroomOf: oddział, którego jest wychowawcą (może być pusty).' }, students: { header: 'class;rollNo;lastName;firstName;pesel;birthDate;birthPlace;enrolledAt;parentLastName;parentFirstName;parentEmail;parentPhone', example: '7b;1;Kowalczyk;Anna;13241512849;2013-04-15;Kraków;2026-09-01;Kowalczyk;Marta;m.kowalczyk@example.com;600100201', note: 'pesel pusty = obcokrajowiec bez PESEL — wtedy wymagane kolumny documentType (passport|residence-card|other), documentNumber, documentCountry albo jedna kolumna „Dokument tożsamości”; birthDate RRRR-MM-DD; enrolledAt (data przyjęcia, RRRR-MM-DD) jest opcjonalna — pusta oznacza początek roku szkolnego, a nie dzień wgrania pliku, więc wrześniowy import nie robi z całego rocznika uczniów dopisanych w trakcie roku; rodzic opcjonalny — gdy podany, powstaje konto rodzica i jednorazowy kod rejestracyjny. Każdy import można najpierw uruchomić próbnie (dryRun:true), a po zapisie cofnąć (POST /api/setup/imports/:id/undo), dopóki nic nie zostało wpisane na utworzonych kontach.' }, timetable: { header: 'class;weekday;lessonNo;subject;teacherLogin;room;group', example: '7b;1;1;mat;j.nowak;12;', note: 'weekday 1–5 (pon.–pt.); subject = identyfikator przedmiotu; group pusty = cały oddział. Import przez POST /api/admin/timetable/import.' } }), ADMIN);

  r.post('/api/setup/teachers/import', async (ctx) => {
    const db = ctx.db; const b = ctx.body || {}; const dryRun = b.dryRun === true;
    const parsed = parseCsv(b.csv); const rows = parsed.rows;
    const created = [], errors = parsed.errors.slice(), warnings = []; const seenLogins = new Set();
    const userIds = [], classIds = [];
    const diag = headerDiagnostics(parsed.header, TEACHER_COLUMNS, ['firstName', 'lastName']);
    if (diag.missing.length) {
      /* OPS3-05 — jeden błąd o nagłówku zamiast N identycznych o wierszach. */
      const e = headerError(diag, TEACHER_COLUMNS);
      return { dryRun, created: [], errors: [e], warnings: [], count: 0, columns: diag.columns, unknownColumns: diag.unknownColumns, message: e.error };
    }
    const cell = (row, f) => cellOf(TEACHER_COLUMNS, row, f);
    /* Przedmioty wolno podać naszymi identyfikatorami (`mat|fiz`) albo nazwami, jakie ma arkusz
       organizacyjny („Matematyka, Fizyka”) — rozdzielone `|`, `,` albo `;`. Przedmiot, którego nie ma
       na liście szkoły, jest nazwany po imieniu razem z podpowiedzią, gdzie go dodać (OPS3-04). */
    const subjectByName = new Map();
    for (const x of db.col('subjects')) {
      const keys = [x.name].concat(String(x.name).split('/'));      // „Religia / etyka” to także „Religia”
      for (const k of keys) { const kk = slug(k).replace(/\./g, ''); if (kk && !subjectByName.has(kk)) subjectByName.set(kk, x.id); }
    }
    const batch = dryRun ? null : recordImport(db, { id: 'imp_' + U.id().slice(0, 10), kind: 'teachers', status: 'running', byUserId: ctx.user.id, userIds, classIds, studentIds: [], codeIds: [], counts: { created: 0, errors: 0 } });
    if (batch) db.save();                       // R3-08: partia na dysku, zanim powstanie pierwsze konto
    for (let ri = 0; ri < rows.length; ri++) {
      const row = rows[ri];
      if (ri && ri % IMPORT_CHUNK === 0) await breathe();     // REL-15
      const firstName = cell(row, 'firstName'), lastName = cell(row, 'lastName');
      if (!firstName || !lastName) { errors.push({ line: row._line, error: `Wiersz bez imienia albo nazwiska (kolumny „${TEACHER_COLUMNS.firstName[1]}”/„${TEACHER_COLUMNS.lastName[1]}”).` }); continue; }
      const subjects = []; const unknown = [];
      for (const raw of String(cell(row, 'subjects')).split(/[|,;]/).map((x) => x.trim()).filter(Boolean)) {
        const byId = db.one('subjects', (x) => x.id === raw);
        const byName = subjectByName.get(slug(raw).replace(/\./g, ''));
        if (byId) subjects.push(byId.id); else if (byName) subjects.push(byName); else unknown.push(raw);
      }
      if (unknown.length) { errors.push({ line: row._line, error: `Nieznane przedmioty: ${unknown.join(', ')}. Dodaj je w administracji (POST /api/admin/subjects) albo popraw nazwę.`, code: 'unknown_subjects', unknown }); continue; }
      const wanted = slug(cell(row, 'login')) || slug(firstName[0] + '.' + lastName);
      if (db.one('users', (u) => u.login === wanted) || seenLogins.has(wanted)) warnings.push({ line: row._line, warning: `Login „${wanted}” jest już zajęty — konto dostanie kolejny wolny login.` });
      const homeroomOf = cell(row, 'homeroomOf').replace(/\s+/g, '').toLowerCase();
      if (homeroomOf && !CLASS_ID.test(homeroomOf)) { errors.push({ line: row._line, error: `„${cell(row, 'homeroomOf')}” nie wygląda jak oznaczenie oddziału (np. 7b).` }); continue; }
      if (dryRun) { seenLogins.add(wanted); created.push({ login: wanted, name: `${firstName} ${lastName}`, subjects, homeroomOf: homeroomOf || null }); continue; }
      const login = uniqueLogin(db, wanted); const pw = tempPassword();
      const u = { id: 'u_' + slug(login).replace(/\./g, '_'), login, role: 'teacher', title: cell(row, 'title') || '', firstName, lastName, name: `${firstName} ${lastName}`, subjects, homeroomOf: homeroomOf || null, email: email(cell(row, 'email')), passwordHash: C.hashPassword(pw), mustChangePassword: true, totpEnabled: false, blocked: false, createdAt: U.now() };
      if (cell(row, 'short')) u.short = cell(row, 'short').slice(0, 8);
      db.col('users').push(u); userIds.push(u.id);
      if (u.homeroomOf) {
        let cls = db.get('classes', u.homeroomOf);
        if (!cls) { cls = { id: u.homeroomOf, name: u.homeroomOf, level: +String(u.homeroomOf).replace(/\D/g, '') || 1, homeroomTeacherId: u.id, studentIds: [] }; db.col('classes').push(cls); classIds.push(cls.id); }
        else {
          const prev = cls.homeroomTeacherId && db.get('users', cls.homeroomTeacherId);
          if (prev && prev.id !== u.id) { prev.homeroomOf = null; warnings.push({ line: row._line, warning: `Wychowawstwo oddziału ${cls.name} przejęte po ${D.userLabel(prev)} — poprzedni wpis wyczyszczony.` }); }
          cls.homeroomTeacherId = u.id;
        }
      }
      created.push({ login, name: u.name, tempPassword: pw, homeroomOf: u.homeroomOf });
    }
    if (dryRun) return { dryRun: true, created, errors, warnings, count: created.length, columns: diag.columns, unknownColumns: diag.unknownColumns, message: `Próbny import: ${created.length} nauczycieli, ${errors.length} błędnych wierszy. Nic nie zostało zapisane.` };
    batch.status = 'done'; batch.counts = { created: created.length, errors: errors.length };
    steps(db).teachers = U.now(); db.save(); audit(db, { action: 'setup_teachers_imported', userId: ctx.user.id, ip: ctx.ip, entity: 'users', entityId: batch.id, after: { created: created.length, errors: errors.length } });
    return { created, errors, warnings, count: created.length, importId: batch.id, columns: diag.columns, unknownColumns: diag.unknownColumns };
  }, ADMIN);

  r.post('/api/setup/students/import', async (ctx) => {
    const db = ctx.db; const b = ctx.body || {}; const dryRun = b.dryRun === true;
    const parsed = parseCsv(b.csv); const rows = parsed.rows;
    const created = [], errors = parsed.errors.slice(), codes = [], warnings = [];
    const diag = headerDiagnostics(parsed.header, STUDENT_COLUMNS, ['class', 'lastName', 'firstName']);
    if (diag.missing.length) {
      const e = headerError(diag, STUDENT_COLUMNS);
      return { dryRun, created: [], codes: [], errors: [e], warnings: [], classesCreated: [], count: 0, columns: diag.columns, unknownColumns: diag.unknownColumns, message: e.error };
    }
    const cell = (row, f) => cellOf(STUDENT_COLUMNS, row, f);
    let regNo = nextRegisterNo(db) - 1;                        // OPS3-10: jedna podłoga dla całej szkoły
    const takeRoll = rollTracker(db);                          // OPS3-15: te same numery w próbie i w zapisie
    const expiresAt = U.addDays(D.today(db), 60);
    const seenPesel = new Map(), seenPerson = new Map();
    const studentIds = [], userIds = [], codeIds = [], newClassIds = [];
    const batch = dryRun ? null : recordImport(db, { id: 'imp_' + U.id().slice(0, 10), kind: 'students', status: 'running', byUserId: ctx.user.id, studentIds, userIds, codeIds, classIds: newClassIds, counts: { created: 0, codes: 0, errors: 0 } });
    if (batch) db.save();                       // R3-08: partia na dysku, zanim powstanie pierwszy uczeń
    for (let ri = 0; ri < rows.length; ri++) {
      const row = rows[ri];
      if (ri && ri % IMPORT_CHUNK === 0) await breathe();     // REL-15
      const line = row._line;
      const lastName = cell(row, 'lastName'), firstName = cell(row, 'firstName');
      if (!cell(row, 'class') || !lastName || !firstName) { errors.push({ line, error: 'Wymagane: oddział, nazwisko i imię ucznia.' }); continue; }
      const classId = cell(row, 'class').replace(/\s+/g, '').toLowerCase();
      if (!CLASS_ID.test(classId)) { errors.push({ line, error: `„${classId}” nie wygląda jak oznaczenie oddziału (np. 7b) — popraw kolumnę „class”.` }); continue; }
      let pesel = cell(row, 'pesel').replace(/\s/g, '');
      if (pesel) {
        const v = U.validatePesel(pesel); if (!v.ok) { errors.push({ line, error: v.error }); continue; }
        const dup = db.one('students', (s) => s.pesel === pesel);
        if (dup) { errors.push({ line, error: `PESEL ${pesel} należy już do ucznia ${dup.lastName} ${dup.firstName} (nr księgi ${dup.registerNo}) — wiersz pominięty.` }); continue; }
        if (seenPesel.has(pesel)) { errors.push({ line, error: `PESEL ${pesel} powtarza się w tym pliku (pierwszy raz w wierszu ${seenPesel.get(pesel)}) — wiersz pominięty.` }); continue; }
        seenPesel.set(pesel, line);
      }
      /* R7 — uczeń bez numeru PESEL musi mieć rodzaj i numer dokumentu (§ 4 rozporządzenia o dokumentacji). */
      let doc = null;
      if (!pesel) {
        const combined = ID.cell(row, 'documentText');
        const parts = { type: ID.cell(row, 'documentType'), number: ID.cell(row, 'documentNumber'), country: ID.cell(row, 'documentCountry') };
        if (!combined && !parts.type && !parts.number && !parts.country) {
          /* Stary kontrakt kreatora („pesel pusty = obcokrajowiec”) zostaje: plik bez kolumn dokumentu przechodzi z ostrzeżeniem, a dokument uzupełnia sekretariat w księdze (PATCH …/flags). */
          warnings.push({ line, warning: `${lastName} ${firstName}: brak numeru PESEL i brak dokumentu tożsamości w pliku — uzupełnij rodzaj i numer dokumentu w księdze uczniów (§ 4).`, code: 'document_missing' });
        } else {
          const parsedDoc = combined ? ID.parseDocumentString(combined) : null;
          const rd = ID.readDocument({ identityDocument: parsedDoc || { type: parts.type || 'passport', number: parts.number, country: parts.country } });
          if (!rd.ok) { errors.push({ line, error: rd.error, code: rd.code }); continue; }
          doc = rd.doc;
          if (parsedDoc && !parsedDoc.confident) warnings.push({ line, warning: `Pole „Dokument tożsamości” („${combined}”) rozbito automatycznie — sprawdź rodzaj, kraj i numer w księdze uczniów.` });
        }
      }
      const birthDate = ID.isoDate(cell(row, 'birthDate')) || (cell(row, 'birthDate') ? null : '');
      if (birthDate === null) { errors.push({ line, error: `„${cell(row, 'birthDate')}” nie wygląda jak data urodzenia — dopuszczalne są formaty DD.MM.RRRR i RRRR-MM-DD.`, code: 'bad_date' }); continue; }
      const sex = sexOf(cell(row, 'sex'), pesel);              // OPS3-09
      if (!sex) warnings.push({ line, warning: `${lastName} ${firstName}: nie znamy płci (brak kolumny „Płeć” i brak numeru PESEL) — świadectwo i pakiet SIO potrzebują jej, uzupełnij w księdze uczniów.`, code: 'sex_missing' });
      const person = [classId, slug(lastName), slug(firstName), birthDate || ''].join('|');
      const twin = db.one('students', (s) => s.classId === classId && s.status === 'active' && slug(s.lastName) === slug(lastName) && slug(s.firstName) === slug(firstName) && (!birthDate || !s.birthDate || s.birthDate === birthDate));
      if (twin && !b.allowDuplicates) { errors.push({ line, error: `${lastName} ${firstName} jest już w oddziale ${classId} (nr księgi ${twin.registerNo}). Jeżeli to naprawdę dwie różne osoby, wyślij allowDuplicates:true.`, code: 'duplicate_person' }); continue; }
      if (seenPerson.has(person) && !b.allowDuplicates) { errors.push({ line, error: `Ten sam uczeń występuje w pliku dwa razy (wiersz ${seenPerson.get(person)}).`, code: 'duplicate_row' }); continue; }
      seenPerson.set(person, line);
      let cls = db.get('classes', classId);
      if (!cls) { if (dryRun) cls = { id: classId, name: classId, studentIds: [], _new: true }; else { cls = { id: classId, name: classId, level: +classId.replace(/\D/g, '') || 1, homeroomTeacherId: null, studentIds: [] }; db.col('classes').push(cls); newClassIds.push(classId); } }
      const enrolledAt = enrolledAtOf(db, cell(row, 'enrolledAt'), line, errors);
      if (!enrolledAt) continue;
      const roll = takeRoll(classId, cell(row, 'rollNo'));
      if (roll.clash) warnings.push({ line, warning: `Numer ${roll.rollNo} w oddziale ${classId} jest już zajęty — nadaj numery ponownie w widoku wychowawcy.` });
      const rollNo = roll.rollNo;
      /* OPS3-07 — nabór niesie dwoje opiekunów dla prawie każdego ucznia; kreator umiał zapisać
         jednego, a drugiego (~570 wierszy w szkole na 600 uczniów) trzeba było wklepać ręcznie
         albo stracić. Oba bloki idą tą samą drogą: konto kontaktowe bez hasła + jednorazowy kod. */
      const guardians = [1, 2].map((n) => ({
        no: n,
        lastName: cell(row, n === 1 ? 'parentLastName' : 'parent2LastName'),
        firstName: cell(row, n === 1 ? 'parentFirstName' : 'parent2FirstName'),
        email: email(cell(row, n === 1 ? 'parentEmail' : 'parent2Email')),
        phone: cell(row, n === 1 ? 'parentPhone' : 'parent2Phone')
      })).filter((g) => g.lastName || g.email);
      const note = cell(row, 'note');                          // OPS3-20 — „Uwagi” z naboru nie giną
      regNo++;
      if (dryRun) {
        created.push({ name: `${lastName} ${firstName}`, class: classId, rollNo, registerNo: regNo, enrolledAt, sex, note: note || null, guardians: guardians.length, newClass: !!cls._new });
        for (const g of guardians) codes.push({ student: `${lastName} ${firstName}`, class: classId, parent: `${g.firstName || ''} ${g.lastName || lastName}`.trim(), email: g.email, guardianNo: g.no });
        continue;
      }
      let base = 'st_' + slug(lastName).replace(/\./g, '') + '_' + slug(firstName).replace(/\./g, ''), sid = base, n = 1;
      while (db.get('students', sid)) sid = base + '_' + (++n);
      const st = { id: sid, rollNo, firstName, lastName, classId: cls.id, pesel: pesel || null, identityKind: pesel ? 'pesel' : 'passport', sex, birthDate: birthDate || null, birthPlace: cell(row, 'birthPlace'), status: 'active', registerNo: regNo, enrolledAt, parentIds: [], adult: false, adultSelfExcuse: false, parentAccessBlocked: false, socialWelfare: false, achievements: [], declension: {}, createdAt: U.now() };
      if (cell(row, 'secondName')) st.secondName = cell(row, 'secondName');
      if (cell(row, 'address')) st.address = cell(row, 'address');
      /* Uwaga z pliku zostaje uwagą: nikt jej nie interpretuje. To tędy do szkoły trafia zdanie
         „ojciec pozbawiony władzy rodzicielskiej”, o którym decyduje człowiek w księdze uczniów. */
      if (note) { st.note = note; warnings.push({ line, warning: `${lastName} ${firstName}: uwaga z pliku („${note.slice(0, 120)}”) zapisana przy uczniu — przeczytaj ją i zdecyduj, co z niej wynika. Program nic z nią sam nie robi.`, code: 'note_imported' }); }
      if (doc) Object.assign(st, ID.documentFields(doc));
      db.col('students').push(st); cls.studentIds.push(st.id); studentIds.push(st.id);
      /* Konta zakładane importem nie mają hasła: uczeń aktywuje je resetem administratora, rodzic kodem rejestracyjnym.
         Dzięki temu import 400 uczniów nie liczy 800 hashów scrypt (37 s → ułamek sekundy), a logowanie i tak odrzuca puste hasło. */
      const su = { id: 'u_' + sid, login: uniqueLogin(db, slug(firstName + '.' + lastName)), role: 'student', firstName, lastName, name: `${firstName} ${lastName}`, studentId: sid, classId: cls.id, passwordHash: null, mustActivate: true, mustChangePassword: false, totpEnabled: false, blocked: false, createdAt: U.now() };
      db.col('users').push(su); userIds.push(su.id);
      for (const g of guardians) {
        let parent = g.email ? db.one('users', (u) => u.role === 'parent' && email(u.email) === g.email) : null;
        if (!parent) { parent = { id: 'u_p_' + slug(g.lastName || lastName).replace(/\./g, '') + '_' + slug(g.firstName || 'rodzic').replace(/\./g, '') + '_' + regNo + (g.no === 2 ? '_2' : ''), login: uniqueLogin(db, 'rodzic.' + slug(g.lastName || lastName)), role: 'parent', firstName: g.firstName || '', lastName: g.lastName || lastName, name: `${g.firstName || ''} ${g.lastName || lastName}`.trim(), email: g.email, phone: g.phone || '', childrenIds: [], passwordHash: null, mustActivate: true, mustChangePassword: false, totpEnabled: false, blocked: false, pendingActivation: true, createdAt: U.now() }; db.col('users').push(parent); userIds.push(parent.id); }
        if (!parent.childrenIds.includes(sid)) parent.childrenIds.push(sid);
        if (!st.parentIds.includes(parent.id)) st.parentIds.push(parent.id);
        const code = `${cls.name.toUpperCase()}-${C.token().replace(/[^A-Z0-9]/gi, '').slice(0, 4).toUpperCase()}-${String(regNo).slice(-3)}`;
        const rc = { id: 'rc_' + U.id().slice(0, 10), code, studentId: sid, classId: cls.id, parentUserId: parent.id, byUserId: ctx.user.id, expiresAt, usedAt: null, usedByUserId: null };
        db.col('registrationCodes').push(rc); codeIds.push(rc.id);
        codes.push({ student: `${lastName} ${firstName}`, class: cls.name, parent: parent.name, email: parent.email, code, guardianNo: g.no });
      }
      created.push({ id: sid, name: `${lastName} ${firstName}`, class: cls.name, rollNo: st.rollNo, registerNo: st.registerNo, enrolledAt: st.enrolledAt, sex: st.sex, guardians: guardians.length });
    }
    const classesCreated = dryRun ? [...new Set(created.filter((x) => x.newClass).map((x) => x.class))] : newClassIds;
    for (const cid of classesCreated) { const n = created.filter((x) => x.class === cid).length; if (n <= 2) warnings.push({ warning: `Oddział „${cid}” powstał dla ${n} ${U.plural(n, 'ucznia', 'uczniów', 'uczniów')} — sprawdź, czy to nie literówka w kolumnie „class”.` }); }
    if (dryRun) return { dryRun: true, created, codes, errors, warnings, classesCreated, count: created.length, columns: diag.columns, unknownColumns: diag.unknownColumns, nextRegisterNo: created.length ? created[0].registerNo : regNo + 1, message: `Próbny import: ${created.length} uczniów, ${codes.length} kodów dla rodziców, ${errors.length} błędnych wierszy. Nic nie zostało zapisane.` };
    batch.status = 'done'; batch.counts = { created: created.length, codes: codes.length, errors: errors.length };
    steps(db).students = U.now(); db.save(); audit(db, { action: 'setup_students_imported', userId: ctx.user.id, ip: ctx.ip, entity: 'students', entityId: batch.id, after: { created: created.length, codes: codes.length, errors: errors.length, classesCreated } });
    return { created, codes, errors, warnings, classesCreated, count: created.length, codesExpireAt: expiresAt, importId: batch.id, columns: diag.columns, unknownColumns: diag.unknownColumns };
  }, ADMIN);

  /* --- cofnięcie pomyłkowego importu ---------------------------------------------------- */
  /* Lista partii bez ich ładunku: `previousTimetable` potrafi mieć 720 wierszy i nikomu nie jest
     potrzebny na ekranie — pokazujemy jego rozmiar. */
  r.get('/api/setup/imports', (ctx) => ({ imports: ctx.db.col('imports').slice().reverse().map((b) => {
    const o = Object.assign({}, b); delete o.previousTimetable;
    return Object.assign(o, { byName: D.userLabel(ctx.db.get('users', b.byUserId)), students: (b.studentIds || []).length, users: (b.userIds || []).length,
      timetableRestores: b.kind === 'timetable' ? (b.previousTimetable || []).length : undefined,
      undoable: !b.undoneAt && !undoBlockers(ctx.db, b).length });
  }) }), ADMIN);
  r.post('/api/setup/imports/:id/undo', (ctx) => {
    const db = ctx.db; const b = db.get('imports', ctx.params.id);
    if (!b) throw httpError(404, 'Nie ma takiej partii importu.');
    if (b.undoneAt) throw httpError(400, 'Ta partia została już cofnięta ' + U.fmtDate(b.undoneAt) + '.', { code: 'already_undone' });
    const blockers = undoBlockers(db, b);
    if (blockers.length) throw httpError(409, `Nie można cofnąć importu — w dzienniku są już zapisy na utworzonych kontach (${blockers.length}).`, { code: 'import_in_use', blockers });
    /* H-3 — cofnięcie importu planu lekcji. Partia niesie cały poprzedni plan, więc odtwarzamy go co
       do wiersza i uzgadniamy dziennik tą samą drogą co import (lekcja z wpisami zostaje odwołana,
       nigdy skasowana). Grupy, przedmioty i oddziały założone tym importem znikają razem z nim —
       o ile nic ich nie używa. */
    if (b.kind === 'timetable') {
      db.data.timetable = JSON.parse(JSON.stringify(b.previousTimetable || []));
      const gone = { groups: 0, subjects: 0, classes: 0 };
      for (const gid of b.groupIds || []) { const g = db.get('groups', gid); if (g && !db.col('timetable').some((t) => t.groupId === gid)) { db.remove('groups', gid); gone.groups++; } }
      for (const sid of b.subjectIds || []) { if (!db.col('timetable').some((t) => t.subjectId === sid) && !db.col('lessons').some((l) => l.subjectId === sid) && !db.col('grades').some((g) => g.subjectId === sid && !g.deleted)) { if (db.remove('subjects', sid)) gone.subjects++; } }
      for (const cid of b.classIds || []) { const cls = db.get('classes', cid); if (cls && !(cls.studentIds || []).length && !db.col('timetable').some((t) => t.classId === cid)) { db.remove('classes', cid); gone.classes++; } }
      b.undoneAt = U.now(); b.undoneByUserId = ctx.user.id; b.undoneRemoved = gone; db.save();
      const lessons = syncLessons(db, { reason: 'timetable_import_undone' });
      audit(db, { action: 'import_undone', userId: ctx.user.id, ip: ctx.ip, entity: 'timetable', entityId: b.id, before: b.counts, after: Object.assign({ entries: db.data.timetable.length, lessons }, gone), reason: (ctx.body || {}).reason || 'cofnięcie pomyłkowego importu planu lekcji' });
      return { ok: true, importId: b.id, removed: gone, lessons, timetable: db.data.timetable.length,
        message: `Cofnięto import planu: plan ma znowu ${db.data.timetable.length} ${U.plural(db.data.timetable.length, 'pozycję', 'pozycje', 'pozycji')}. Usunięto ${gone.groups} ${U.plural(gone.groups, 'grupę', 'grupy', 'grup')}, ${gone.subjects} ${U.plural(gone.subjects, 'przedmiot', 'przedmioty', 'przedmiotów')}, ${gone.classes} ${U.plural(gone.classes, 'oddział', 'oddziały', 'oddziałów')}. Dziennik uzgodniony: odwołano ${lessons.cancelled}, usunięto ${lessons.removed} pustych, dogenerowano ${lessons.created}.` };
    }
    const removed = { students: 0, users: 0, codes: 0, classes: 0 };
    for (const cid of b.codeIds || []) if (db.remove('registrationCodes', cid)) removed.codes++;
    for (const sid of b.studentIds || []) { const s = db.get('students', sid); if (!s) continue; const cls = db.get('classes', s.classId); if (cls) cls.studentIds = (cls.studentIds || []).filter((x) => x !== sid); for (const g of db.col('groups')) g.studentIds = (g.studentIds || []).filter((x) => x !== sid); for (const u of db.col('users')) if (u.role === 'parent') u.childrenIds = (u.childrenIds || []).filter((x) => x !== sid); if (db.remove('students', sid)) removed.students++; }
    for (const uid of b.userIds || []) { const u = db.get('users', uid); if (!u) continue; if (u.role === 'parent' && (u.childrenIds || []).length) continue; for (const s of db.col('sessions')) if (s.userId === uid && !s.revoked) { s.revoked = true; s.revokedReason = 'import_undone'; } const cls = u.homeroomOf && db.get('classes', u.homeroomOf); if (cls && cls.homeroomTeacherId === uid) cls.homeroomTeacherId = null; if (db.remove('users', uid)) removed.users++; }
    for (const cid of b.classIds || []) { const cls = db.get('classes', cid); if (cls && !(cls.studentIds || []).length && !db.col('timetable').some((t) => t.classId === cid)) { db.remove('classes', cid); removed.classes++; } }
    b.undoneAt = U.now(); b.undoneByUserId = ctx.user.id; b.undoneRemoved = removed; db.save();
    audit(db, { action: 'import_undone', userId: ctx.user.id, ip: ctx.ip, entity: 'imports', entityId: b.id, before: b.counts, after: removed, reason: (ctx.body || {}).reason || 'cofnięcie pomyłkowego importu' });
    return { ok: true, importId: b.id, removed, message: `Cofnięto import: ${removed.students} ${U.plural(removed.students, 'uczeń', 'uczniowie', 'uczniów')}, ${removed.users} ${U.plural(removed.users, 'konto', 'konta', 'kont')}, ${removed.codes} ${U.plural(removed.codes, 'kod', 'kody', 'kodów')}, ${removed.classes} ${U.plural(removed.classes, 'oddział', 'oddziały', 'oddziałów')}.` };
  }, ADMIN);

  /* OPS3-08 — szkoła przechodząca na EdMat 23 września dostawała 805 lekcji z datami 1–22 września,
     wszystkie ze statusem „odbyła się”, bez tematu i bez frekwencji, a pierwszy audyt kompletności
     dyrektora zarzucał 17 nauczycielom 250 braków za tydzień, w którym szkoła była jeszcze na starym
     dzienniku. `syncLessons` rusza dopiero od jutra, więc nic już ich nie usuwało. Domyślny początek
     generowania to teraz **późniejsza** z dwóch dat: początek roku szkolnego albo dziś; własne `from`
     (np. 1 września, gdy szkoła zaczyna z EdMat od pierwszego dnia) ma pierwszeństwo. */
  r.post('/api/setup/lessons/generate', (ctx) => {
    const db = ctx.db; const b = ctx.body || {}; const sem = db.data.config.semesters;
    const today = D.today(db);
    const defaultFrom = today > sem[0].from && today <= sem[sem.length - 1].to ? today : sem[0].from;
    const from = b.from || defaultFrom, to = b.to || sem[sem.length - 1].to;
    if (b.from && !ISO_DATE.test(String(b.from))) throw httpError(400, 'Data początkowa musi mieć format RRRR-MM-DD.', { field: 'from' });
    if (!db.col('timetable').length) throw httpError(400, 'Najpierw zaimportuj plan lekcji.', { code: 'no_timetable' });
    const created = generateLessons(db, from, to); steps(db).lessons = U.now(); db.save();
    audit(db, { action: 'setup_lessons_generated', userId: ctx.user.id, ip: ctx.ip, entity: 'lessons', after: { created, from, to } });
    const skipped = !b.from && defaultFrom !== sem[0].from;
    return { created, from, to, total: db.col('lessons').length, defaultFrom, yearStart: sem[0].from, skippedBeforeToday: skipped,
      message: `Utworzono ${created} ${U.plural(created, 'lekcję', 'lekcje', 'lekcji')} od ${U.fmtDate(from)} do ${U.fmtDate(to)}.` + (skipped ? ` Lekcji sprzed dziś (od ${U.fmtDate(sem[0].from)}) nie generujemy — dziennik prowadziła wtedy inna książka. Podaj „from”, jeżeli szkoła ma je mieć.` : '') };
  }, ADMIN);
  r.post('/api/setup/finish', (ctx) => { const db = ctx.db; const s = summary(db); const missing = []; if (!s.school) missing.push('school'); if (!s.teachers) missing.push('teachers'); if (!s.students) missing.push('students'); if (!s.timetable) missing.push('timetable');
    /* OPS3-21 — konto dyrektora jest w kreatorze opcjonalne, a bez roli `principal` cała dyrekcja
       (audyt kompletności, zamknięcie semestru, pakiet archiwalny § 22) odpowiada administratorowi
       403 i nic nie mówi, czego brakuje. Kończyć konfigurację wolno, ale nie po cichu. */
    if (!db.col('users').some((u) => u.role === 'principal')) missing.push('principal'); if (missing.length && !(ctx.body || {}).force) throw httpError(400, 'Brakuje: ' + missing.join(', ') + '. ' + (missing.includes('principal') ? 'Bez konta dyrektora nie da się zamknąć semestru ani złożyć pakietu archiwalnego — załóż je w „Kontach pracowników” (POST /api/admin/staff, rola principal). ' : '') + 'Możesz zakończyć mimo to (force).', { code: 'setup_incomplete', missing }); steps(db); db.data.config.setup.done = true; db.data.config.setup.finishedAt = U.now(); db.save(); audit(db, { action: 'setup_finished', userId: ctx.user.id, ip: ctx.ip, entity: 'config', entityId: 'setup', after: s }); return { ok: true, summary: summary(db) }; }, ADMIN);
}
module.exports = { register, needed, generateLessons, syncLessons, lessonHorizon, hasJournal, journalIndex, isSchoolDay, parseCsv, summary, steps, slug, uniqueLogin, tempPassword, yearStart, recordImport, nextRegisterNo };
