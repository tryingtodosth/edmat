'use strict';
/* R1 — import planu lekcji z aSc Timetables (Eksport → XML).
   Co naprawdę jest w pliku i czego importer musi się spodziewać: tests/fixtures/real-formats/README.md
   §1–§3. Najważniejsze: identyfikatory (`*17`) są lokalne dla eksportu i zmieniają się przy każdym
   zapisie, więc dopasowanie do naszej bazy idzie po **skrócie i nazwie**, nie po id. Ten moduł nie
   dotyka bazy — zwraca „obcy” plan (nazwy i skróty) plus listę encji do zmapowania; dopasowanie i
   zapis robi `server/routes/admin.js`.

   Parser XML jest własny (zasada zerowych zależności): mały tokenizer ze stanem, a nie wyrażenie
   regularne — atrybuty potrafią zawierać `>` i encje, tagi bywają samozamykające, plik bywa z BOM-em
   i z CRLF-ami. Nieznane elementy i atrybuty są **po cichu pomijane**: zestaw kolekcji zależy od
   wersji aSc i od licencji. `termsdefs` ignorujemy świadomie (patrz `warnings`). */

const TD = require('./textdecode');

/* ------------------------------------------------------------------------ tokenizer XML */
const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };
function unescapeXml(s) {
  return String(s).replace(/&(#x?[0-9a-fA-F]+|[a-zA-Z]+);/g, (m, g) => {
    /* S3-19 — `String.fromCodePoint` rzuca `RangeError: Invalid code point 4294967295` na encji
       `&#xFFFFFFFF;`, a trasa oddawała ten komunikat V8 w treści odpowiedzi. Punkt kodowy spoza
       zakresu Unicode nie jest znakiem: zostawiamy encję jako zwykły tekst, dokładnie tak samo jak
       nieznaną encję nazwaną. */
    if (g[0] === '#') { const n = g[1] === 'x' || g[1] === 'X' ? parseInt(g.slice(2), 16) : parseInt(g.slice(1), 10); return Number.isInteger(n) && n >= 0 && n <= 0x10FFFF && !(n >= 0xD800 && n <= 0xDFFF) ? String.fromCodePoint(n) : m; }
    return ENTITIES[g] !== undefined ? ENTITIES[g] : (ENTITIES[g.toLowerCase()] !== undefined ? ENTITIES[g.toLowerCase()] : m);
  });
}
const NAME_CHAR = /[A-Za-z0-9_:.\-]/;

/**
 * tokenize(text, on) — wywołuje on.open(name, attrs, selfClosing), on.close(name), on.text(s).
 * Obsługuje: deklarację `<?xml …?>`, komentarze, CDATA, DOCTYPE, atrybuty w `"` i `'` oraz bez
 * cudzysłowów, tagi samozamykające, `>` wewnątrz wartości atrybutu.
 */
function tokenize(text, on) {
  const s = text;
  let i = 0;
  const n = s.length;
  while (i < n) {
    const lt = s.indexOf('<', i);
    if (lt < 0) { if (on.text) on.text(s.slice(i)); break; }
    if (lt > i && on.text) on.text(s.slice(i, lt));
    if (s.startsWith('<!--', lt)) { const e = s.indexOf('-->', lt + 4); i = e < 0 ? n : e + 3; continue; }
    if (s.startsWith('<![CDATA[', lt)) { const e = s.indexOf(']]>', lt + 9); const body = s.slice(lt + 9, e < 0 ? n : e); if (on.text) on.text(body); i = e < 0 ? n : e + 3; continue; }
    if (s.startsWith('<?', lt)) { const e = s.indexOf('?>', lt + 2); i = e < 0 ? n : e + 2; continue; }
    if (s.startsWith('<!', lt)) {
      /* DOCTYPE (może mieć wewnętrzny podzbiór w nawiasach kwadratowych) */
      let depth = 0, j = lt + 2;
      for (; j < n; j++) { const c = s[j]; if (c === '[') depth++; else if (c === ']') depth--; else if (c === '>' && depth <= 0) break; }
      i = j + 1; continue;
    }
    let j = lt + 1;
    const closing = s[j] === '/';
    if (closing) j++;
    let name = '';
    while (j < n && NAME_CHAR.test(s[j])) name += s[j++];
    if (!name) { i = lt + 1; if (on.text) on.text('<'); continue; }
    if (closing) { const e = s.indexOf('>', j); i = e < 0 ? n : e + 1; if (on.close) on.close(name); continue; }
    const attrs = {};
    let selfClosing = false;
    for (;;) {
      while (j < n && /\s/.test(s[j])) j++;
      if (j >= n) { i = n; break; }
      if (s[j] === '/' && s[j + 1] === '>') { selfClosing = true; j += 2; i = j; break; }
      if (s[j] === '>') { j++; i = j; break; }
      let an = '';
      while (j < n && NAME_CHAR.test(s[j])) an += s[j++];
      if (!an) { j++; continue; }                                   // śmieć w tagu — pomijamy znak
      while (j < n && /\s/.test(s[j])) j++;
      let av = '';
      if (s[j] === '=') {
        j++;
        while (j < n && /\s/.test(s[j])) j++;
        const q = s[j];
        if (q === '"' || q === "'") { j++; const e = s.indexOf(q, j); av = s.slice(j, e < 0 ? n : e); j = e < 0 ? n : e + 1; }
        else { while (j < n && !/[\s>]/.test(s[j]) && !(s[j] === '/' && s[j + 1] === '>')) av += s[j++]; }
      }
      attrs[an.toLowerCase()] = unescapeXml(av);
    }
    if (on.open) on.open(name, attrs, selfClosing);
    if (selfClosing && on.close) on.close(name);
  }
}

/* ------------------------------------------------------------------------- pomocnicze */
const list = (v) => String(v == null ? '' : v).split(',').map((x) => x.trim()).filter(Boolean);
/** Maska dni aSc: "10000" = poniedziałek. Daysdef może trzymać kilka masek po przecinku. */
function daysFromMask(mask) {
  const out = [];
  for (const m of list(mask)) for (let i = 0; i < m.length && i < 7; i++) if (m[i] === '1') out.push(i + 1);
  return [...new Set(out)].sort((a, b) => a - b);
}
/** "11" = każdy tydzień (null), "10" = tydzień I (A), "01" = tydzień II (B), "10,01" = oba osobno.
    `longMasks` (opcjonalnie) zbiera maski dłuższe niż dwa tygodnie — D3-53: rota 3- albo
    4-tygodniowa („0010”) była czytana po cichu jako „co tydzień” albo, co gorsza, jako sam tydzień A,
    i lekcje wypadały w tygodniach, w których ich nie ma. Naszego modelu to nie mieści: mamy A i B.
    Zwracamy więc „co tydzień” **jawnie** i mówimy o tym w ostrzeżeniach. */
function weeksFromMask(mask, longMasks) {
  const masks = list(mask);
  if (!masks.length) return [null];
  const set = new Set();
  for (const m of masks) {
    if (m.length > 2) { if (longMasks) longMasks.add(m); set.add(null); continue; }
    if (/^1+$/.test(m) && m.length >= 2) { set.add(null); continue; }
    if (m === '1') { set.add(null); continue; }
    if (m[0] === '1' && m[1] === '1') { set.add(null); continue; }
    if (m[0] === '1') set.add('A');
    if (m[1] === '1') set.add('B');
    if (!m.includes('1')) set.add(null);
  }
  if (set.has(null)) return [null];
  const out = [...set];
  return out.length ? out : [null];
}

/* --------------------------------------------------------------------------- parser */
/**
 * parseAsc(input, { ref }) → {
 *   tool, version, displayName, ref,
 *   rows: [{ classKey, classLabel, weekday, lessonNo, subjectKey, subjectLabel,
 *            teacherKeys: [key], teacherLabels: [name], roomKey, roomLabel,
 *            week, groupLabel, entireClass, source: {tool, ref} }],
 *   entities: { teachers, classes, subjects, rooms },   // [{ key, short, name }]
 *   warnings: [string], stats: {…}
 * }
 * Nic nie rzuca na brakujących identyfikatorach — zgłasza je w `warnings`.
 */
function parseAsc(input, opts) {
  const o = opts || {};
  const dec = TD.decode(input, { default: 'utf-8' });
  const text = dec.text;
  const cols = {};                                       // element → tablica atrybutów
  const push = (k, a) => { (cols[k] = cols[k] || []).push(a); };
  let root = {};
  tokenize(text, {
    open(name, attrs) {
      const n = name.toLowerCase();
      if (n === 'timetable') { root = attrs; return; }
      push(n, attrs);
    }
  });
  if (!root || !Object.keys(root).length) {
    if (!cols.lesson && !cols.card) throw new Error('To nie wygląda na eksport XML z aSc Timetables: brak elementu <timetable>.');
  }
  const warnings = [];
  if (dec.note) warnings.push(dec.note);
  const version = root.ascttversion || '';
  /* README fixture'ów §1: brief prosił o `displaycountries`, plik ma `displaycountry`.
     Której pisowni używa prawdziwy eksport — nie wiadomo, więc przyjmujemy obie i obie ignorujemy. */
  const country = root.displaycountry || root.displaycountries || '';

  const byId = (arr, extra) => {
    const m = new Map();
    for (const a of arr || []) if (a.id) m.set(a.id, Object.assign({}, a, extra));
    return m;
  };
  const periods = cols.period || [];
  const daysdefs = byId(cols.daysdef);
  const weeksdefs = byId(cols.weeksdef);
  const termsdefs = byId(cols.termsdef);
  const subjects = byId(cols.subject);
  const teachers = byId(cols.teacher);
  const classrooms = byId(cols.classroom);
  const classes = byId(cols.class);
  const groups = byId(cols.group);
  const lessons = cols.lesson || [];
  const cards = cols.card || [];
  if (termsdefs.size) warnings.push(`Plik niesie ${termsdefs.size} ${termsdefs.size === 1 ? 'definicję okresu' : 'definicji okresów'} (<termsdefs>) — import je pomija: nasz plan nie zna podziału roku na okresy inne niż semestry.`);

  /* Numer lekcji bierzemy z atrybutu `period`, nigdy z pozycji na liście — w prawdziwych planach
     istnieje lekcja „0”. Gdy `period` nie jest liczbą, korzystamy z `name`/`short`. */
  const periodNo = new Map();
  periods.forEach((p, i) => {
    const raw = [p.period, p.name, p.short].find((x) => /^-?\d+$/.test(String(x || '').trim()));
    const no = raw != null ? +String(raw).trim() : i + 1;
    if (p.period != null && p.period !== '') periodNo.set(String(p.period), no);
    if (p.name) periodNo.set(String(p.name), no);
    if (p.short) periodNo.set(String(p.short), no);
  });
  const lessonNoOf = (period) => {
    const s = String(period == null ? '' : period).trim();
    if (periodNo.has(s)) return periodNo.get(s);
    return /^-?\d+$/.test(s) ? +s : null;
  };

  /* --- encje do zmapowania ------------------------------------------------------------ */
  const shortOf = (e, fallback) => {
    const s = String((e && e.short) || '').trim();
    return s || fallback || '';
  };
  const teacherName = (t) => {
    if (!t) return '';
    const both = [t.firstname, t.lastname].filter(Boolean).join(' ').trim();
    return both || String(t.name || '').trim();                    // eksport 2008: jedno pole `name`
  };
  const entTeachers = [], entClasses = [], entSubjects = [], entRooms = [];
  const teacherKey = new Map(), classKey = new Map(), subjectKey = new Map(), roomKey = new Map();
  let emptyShorts = 0;
  for (const [id, t] of teachers) {
    const name = teacherName(t);
    const short = shortOf(t, '');
    if (!short) emptyShorts++;
    const key = short || name || id;
    teacherKey.set(id, key);
    if (!entTeachers.some((x) => x.key === key)) entTeachers.push({ key, short, name, foreignId: id, email: t.email || '' });
  }
  if (emptyShorts) warnings.push(`${emptyShorts} ${emptyShorts === 1 ? 'nauczyciel nie ma skrótu' : 'nauczycieli nie ma skrótu'} w pliku — dopasowanie pójdzie po imieniu i nazwisku.`);
  for (const [id, c] of classes) {
    const name = String(c.name || '').trim(), short = shortOf(c, name);
    const key = short || name || id;
    classKey.set(id, key);
    if (!entClasses.some((x) => x.key === key)) entClasses.push({ key, short, name, foreignId: id });
  }
  for (const [id, s] of subjects) {
    const name = String(s.name || '').trim(), short = shortOf(s, name);
    const key = name || short || id;
    subjectKey.set(id, key);
    if (!entSubjects.some((x) => x.key === key)) entSubjects.push({ key, short, name, foreignId: id });
  }
  for (const [id, r] of classrooms) {
    const name = String(r.name || '').trim(), short = shortOf(r, name);
    const key = short || name || id;
    roomKey.set(id, key);
    if (!entRooms.some((x) => x.key === key)) entRooms.push({ key, short, name, foreignId: id });
  }

  /* --- karty po lekcjach --------------------------------------------------------------- */
  const lessonById = new Map();
  for (const l of lessons) if (l.id) lessonById.set(l.id, l);
  const missing = { classrooms: new Set(), lessons: new Set(), teachers: new Set(), subjects: new Set(), classes: new Set(), groups: new Set() };
  const rows = [];
  const seenCards = new Set();
  let duplicates = 0, doubles = 0, skipped = 0;
  const longWeekMasks = new Set();                 // D3-53: rota dłuższa niż dwutygodniowa

  /* Nieistniejące sale zbieramy po **wszystkich** kartach, także po tych, które zaraz odpadną jako
     duplikaty: w `plan-edge.xml` zepsuta sala `*9999` siedzi właśnie na zdublowanej karcie i gdyby
     nie ten przebieg, raport z próbnego importu milczałby o niej. */
  for (const card of cards.concat(lessons)) for (const rid of list(card.classroomids != null && card.classroomids !== '' ? card.classroomids : card.classroomid)) if (!classrooms.has(rid)) missing.classrooms.add(rid);

  for (const card of cards) {
    const lesson = lessonById.get(card.lessonid);
    if (!lesson) { missing.lessons.add(card.lessonid || '(brak)'); skipped++; continue; }
    /* Dedup: ta sama lekcja, ten sam dzień, ta sama godzina i ten sam tydzień to ta sama karta,
       nawet gdy różni je sala (fixture plan-edge.xml ma dokładnie taki wariant). */
    const dedupe = [card.lessonid, card.period, card.days || card.day || lesson.days || '', card.weeks || ''].join('|');
    if (seenCards.has(dedupe)) { duplicates++; continue; }
    seenCards.add(dedupe);

    const no = lessonNoOf(card.period);
    if (no == null) { skipped++; continue; }
    /* Dni: karta ma maskę `days` (2012) albo numer `day` (2008); gdy nie ma ani jednego, bierzemy
       maskę z `daysdefid` lekcji. */
    let days = [];
    if (card.days) days = daysFromMask(card.days);
    else if (card.day != null && card.day !== '') days = [+card.day].filter((x) => x >= 1 && x <= 7);
    else if (lesson.daysdefid && daysdefs.has(lesson.daysdefid)) days = daysFromMask(daysdefs.get(lesson.daysdefid).days);
    if (!days.length) { skipped++; continue; }

    let weeks = [null];
    if (card.weeks) weeks = weeksFromMask(card.weeks, longWeekMasks);
    else if (lesson.weeksdefid && weeksdefs.has(lesson.weeksdefid)) weeks = weeksFromMask(weeksdefs.get(lesson.weeksdefid).weeks, longWeekMasks);

    const span = Math.max(1, +(lesson.periodspercard || lesson.durationperiods || 1) || 1);
    if (span > 1) doubles++;

    const subjKey = subjectKey.get(lesson.subjectid);
    if (!subjKey) missing.subjects.add(lesson.subjectid || '(brak)');
    const tIds = list(lesson.teacherids || lesson.teacherid);
    const tKeys = [];
    for (const tid of tIds) { const k = teacherKey.get(tid); if (k) tKeys.push(k); else missing.teachers.add(tid); }

    /* Sala: lista z karty ma pierwszeństwo przed listą z lekcji; pusta lista jest normalna. */
    const roomIds = list(card.classroomids != null && card.classroomids !== '' ? card.classroomids : (card.classroomid || lesson.classroomids || lesson.classroomid));
    let rKey = '';
    for (const rid of roomIds) { const k = roomKey.get(rid); if (k) { rKey = k; break; } missing.classrooms.add(rid); }

    const classIds = list(lesson.classids || lesson.classid);
    const groupIds = list(lesson.groupids || lesson.groupid);
    for (const cid of classIds) {
      const cKey = classKey.get(cid);
      if (!cKey) { missing.classes.add(cid); continue; }
      /* Grupy tego oddziału z tej lekcji. `entireclass="1"` = cały oddział (bez etykiety).
         Eksport 2008 nie ma <groups> — podział siedzi jako `group="1"` na lekcji. */
      let labels = [];
      const mine = groupIds.filter((gid) => { const g = groups.get(gid); return g && (!g.classid || g.classid === cid); });
      for (const gid of groupIds) if (!groups.has(gid)) missing.groups.add(gid);
      if (mine.length) {
        labels = mine.map((gid) => { const g = groups.get(gid); return String(g.entireclass || '') === '1' ? null : (String(g.name || '').trim() || null); });
        labels = [...new Set(labels.map((x) => x || ''))].map((x) => x || null);
        if (labels.length > 1 && labels.includes(null)) labels = [null];       // cały oddział wchłania grupy
      } else if (lesson.group && String(lesson.group).trim() && String(lesson.group).trim() !== '0') {
        labels = [`gr. ${String(lesson.group).trim()}`];
      } else labels = [null];

      for (const week of weeks) for (const label of labels) for (const weekday of days) for (let k = 0; k < span; k++) {
        rows.push({
          classKey: cKey, weekday, lessonNo: no + k,
          subjectKey: subjKey || null, subjectLabel: subjKey || '',
          teacherKeys: tKeys.slice(), roomKey: rKey || '',
          week, groupLabel: label, entireClass: label == null,
          span, cardPeriod: no, foreignLessonId: lesson.id,
          source: { tool: 'asc', ref: o.ref || (root.displayname || 'aSc'), lessonId: lesson.id }
        });
      }
    }
  }

  if (missing.classrooms.size) warnings.push(`Karty wskazują ${missing.classrooms.size} ${missing.classrooms.size === 1 ? 'salę, której' : 'sal, których'} nie ma w <classrooms> (${[...missing.classrooms].join(', ')}) — te lekcje wjadą bez sali.`);
  if (missing.lessons.size) warnings.push(`${missing.lessons.size} ${missing.lessons.size === 1 ? 'karta wskazuje' : 'kart wskazuje'} nieistniejącą lekcję (${[...missing.lessons].join(', ')}) — pominięte.`);
  if (missing.teachers.size) warnings.push(`Lekcje wskazują ${missing.teachers.size} nieistniejących nauczycieli (${[...missing.teachers].join(', ')}).`);
  if (missing.subjects.size) warnings.push(`Lekcje wskazują ${missing.subjects.size} nieistniejących przedmiotów (${[...missing.subjects].join(', ')}).`);
  if (missing.classes.size) warnings.push(`Lekcje wskazują ${missing.classes.size} nieistniejących oddziałów (${[...missing.classes].join(', ')}).`);
  if (missing.groups.size) warnings.push(`Lekcje wskazują ${missing.groups.size} nieistniejących grup (${[...missing.groups].join(', ')}).`);
  if (duplicates) warnings.push(`${duplicates} ${duplicates === 1 ? 'zdublowana karta' : 'zdublowanych kart'} (ta sama lekcja, dzień, godzina i tydzień) — scalone w jedną pozycję.`);
  /* D3-53 — maska tygodnia dłuższa niż dwa znaki znaczy rotę 3- albo 4-tygodniową, której nasz model
     (A/B) nie ma. Takie pozycje wchodzą jako „co tydzień” i mówimy o tym wprost, zamiast po cichu
     gubić trzeci tydzień albo generować lekcje w tygodniach, w których ich nie ma. */
  if (longWeekMasks.size) warnings.push(`Plik używa maski tygodnia dłuższej niż dwutygodniowa (${[...longWeekMasks].sort().join(', ')}) — to rota, której nasz plan nie zna (mamy tylko tydzień A i B). Te pozycje wchodzą jako „co tydzień”; sprawdź je w planie przed zapisem.`);
  if (!cols.weeksdef && version && /^200[0-9]/.test(String(version))) warnings.push(`Eksport w formacie ${version}: brak <weeksdefs>, więc cały plan jest „co tydzień”. Cykl dwutygodniowy trzeba ustawić ręcznie.`);

  return {
    tool: 'asc', version, country, displayName: root.displayname || '', ref: o.ref || root.displayname || 'aSc Timetables',
    encoding: dec.encoding, encodingSource: dec.source,
    rows, entities: { teachers: entTeachers, classes: entClasses, subjects: entSubjects, rooms: entRooms },
    warnings,
    stats: { periods: periods.length, lessons: lessons.length, cards: cards.length, rows: rows.length, duplicates, doubles, skipped,
      weeks: { all: rows.filter((r) => !r.week).length, A: rows.filter((r) => r.week === 'A').length, B: rows.filter((r) => r.week === 'B').length } }
  };
}

/** Czy te bajty/ten tekst wyglądają na eksport z aSc. */
function looksLikeAsc(text) {
  const head = String(text || '').slice(0, 4000);
  return /<timetable\b/i.test(head) && (/ascttversion/i.test(head) || /<periods\b/i.test(head) || /<daysdefs\b/i.test(head));
}

module.exports = { parseAsc, looksLikeAsc, tokenize, unescapeXml, daysFromMask, weeksFromMask };
