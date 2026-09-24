'use strict';
/* R1 — import publikacji „Plan lekcji Optivum” (VULCAN): drzewo HTML `index.html` + `lista.html` +
   `plany/o*.html` (oddziały), `n*.html` (nauczyciele), `s*.html` (sale). Setki szkół mają dokładnie to
   na swojej stronie WWW; opis kształtu i pułapek: tests/fixtures/real-formats/README.md §4.

   Wejście: mapa `{ 'plany/o1.html': <bajty albo base64> }` (upload katalogu bez pakowania w zip)
   albo pojedynczy plik `oN.html`. Każdy plik dekodujemy **osobno** (`<meta charset>`), bo starsze
   buildy piszą windows-1250, a nowsze UTF-8 — i w jednym katalogu potrafią być oba.

   Model wyjściowy jest ten sam co w `import-asc.js`: obce nazwy i skróty plus lista encji do
   zmapowania. Nic tu nie zna naszej bazy. */

const TD = require('./textdecode');
const { tokenize, unescapeXml } = require('./import-asc');

const VOID = new Set(['br', 'hr', 'img', 'meta', 'link', 'input', 'col', 'base', 'area', 'param', 'source', 'embed', 'wbr']);
/* Optivum publikuje HTML-a bez domykania `<p>` i `<td>`; domykamy je sami, gdy zaczyna się kolejny. */
const AUTO_CLOSE = { p: ['p'], td: ['td', 'th'], th: ['td', 'th'], tr: ['tr', 'td', 'th'], li: ['li'] };

/* S3-19 — głębokość drzewa. `textOf`, `walk` i `cellEntries` schodzą rekurencyjnie, więc publikacja
   z 20 000 zagnieżdżonych `<div>` kończyła się `RangeError: Maximum call stack size exceeded` —
   złapanym jako 400, ale z komunikatem V8 w treści i po 0,6–1,5 s zablokowanej pętli zdarzeń.
   Prawdziwa publikacja Optivum ma kilkanaście poziomów; 500 to granica z ogromnym zapasem. */
const MAX_DEPTH = 500;
/** Minimalne drzewo dokumentu: { tag, attrs, children: [węzeł | {text}] }. */
function parseHtml(text) {
  const root = { tag: '#root', attrs: {}, children: [] };
  const stack = [root];
  const top = () => stack[stack.length - 1];
  tokenize(text, {
    open(name, attrs, selfClosing) {
      const tag = name.toLowerCase();
      const auto = AUTO_CLOSE[tag];
      if (auto) { while (stack.length > 1 && auto.includes(top().tag)) stack.pop(); }
      const node = { tag, attrs, children: [] };
      top().children.push(node);
      if (!selfClosing && !VOID.has(tag)) {
        if (stack.length > MAX_DEPTH) throw new Error(`Strona planu jest zagnieżdżona głębiej niż ${MAX_DEPTH} poziomów — to nie jest publikacja Optivum.`);
        stack.push(node);
      }
    },
    close(name) {
      const tag = name.toLowerCase();
      if (VOID.has(tag)) return;
      for (let i = stack.length - 1; i > 0; i--) if (stack[i].tag === tag) { stack.length = i; return; }
    },
    text(s) { if (s) top().children.push({ text: s }); }
  });
  return root;
}
const isEl = (n) => n && n.tag;
function* walk(node) { for (const c of node.children || []) { if (isEl(c)) { yield c; yield* walk(c); } } }
function find(node, pred) { for (const el of walk(node)) if (pred(el)) return el; return null; }
function findAll(node, pred) { const out = []; for (const el of walk(node)) if (pred(el)) out.push(el); return out; }
const cls = (el) => String((el.attrs && el.attrs.class) || '').trim().split(/\s+/);
const hasClass = (el, c) => cls(el).includes(c);
const NBSP = /[ \s]+/g;
function textOf(node) {
  let out = '';
  const rec = (n) => { for (const c of n.children || []) { if (c.text !== undefined) out += c.text; else if (c.tag === 'br') out += '\n'; else rec(c); } };
  if (node.text !== undefined) return node.text;
  rec(node);
  return out;
}
const clean = (s) => unescapeXml(String(s || '')).replace(/&nbsp;/g, ' ').replace(NBSP, ' ').trim();

/* --------------------------------------------------------------------- kształt publikacji */
const DAY_NAMES = ['poniedzialek', 'wtorek', 'sroda', 'czwartek', 'piatek', 'sobota', 'niedziela'];
const WD_SHORT = ['', 'pon.', 'wt.', 'śr.', 'czw.', 'pt.', 'sob.', 'niedz.'];
const deacc = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/ł/gi, 'l').toLowerCase();
const dayIndex = (label) => { const k = deacc(clean(label)); const i = DAY_NAMES.indexOf(k); return i < 0 ? -1 : i + 1; };
/** „4 A” → „4A”; „ 7 B ” → „7B”. Nasze oddziały to `7a`; dopasowanie normalizuje dalej. */
const classKeyOf = (label) => clean(label).replace(/\s+/g, '');
/* Sufiks po myślniku bywa dwiema zupełnie różnymi rzeczami i **nie da się ich odróżnić składniowo**:
   `j.angielski-1/2` to podział na grupy, a `informatyka-T1` to tydzień cyklu dwutygodniowego
   (README fixture'ów §4a, pułapka 1). Rozstrzygamy tak:
     * `-N/M`  → zawsze grupa (kształt twardy, nigdy nie jest tygodniem);
     * `-T1`, `-T2`, `-I`, `-II`, `-tyg.A`… → **prawdopodobnie** tydzień, ale tylko w kontekście
       (kilka lekcji w jednej komórce albo legenda `<p class="opis">` pod tabelą);
     * cokolwiek innego → zostaje etykietą podziału, jak dotąd.
   Markery nie są ustandaryzowane — to zwykły tekst wpisany przez planistę — więc wynik idzie do
   `warnings` i pod oko człowieka w kroku dopasowania, nigdy po cichu do bazy. */
const WEEK_MARKERS = [
  { re: /^t\s*\.?\s*1$/i, week: 'A' }, { re: /^t\s*\.?\s*2$/i, week: 'B' },
  { re: /^(tyg|tydz|tydzien)\.?\s*(i|1|a)$/i, week: 'A' }, { re: /^(tyg|tydz|tydzien)\.?\s*(ii|2|b)$/i, week: 'B' },
  { re: /^i$/i, week: 'A' }, { re: /^ii$/i, week: 'B' },
  { re: /^a$/i, week: 'A' }, { re: /^b$/i, week: 'B' }
];
const weekOfMarker = (m) => { const hit = WEEK_MARKERS.find((x) => x.re.test(deacc(m))); return hit ? hit.week : null; };
/**
 * splitGroupSuffix('j.angielski-1/2')   → { base: 'j.angielski', group: '1/2', weekMarker: null }
 * splitGroupSuffix('informatyka-T1', 1) → { base: 'informatyka', group: null, weekMarker: 'T1', week: 'A' }
 * Drugi argument (`mayBeWeek`) to kontekst: bez niego sufiks nigdy nie zostanie uznany za tydzień.
 */
function splitGroupSuffix(raw, mayBeWeek) {
  const s = clean(raw);
  const g = /^(.*?)[-–]\s*(\d+\s*\/\s*\d+)$/.exec(s);
  if (g) return { base: g[1].trim(), group: g[2].replace(/\s+/g, ''), weekMarker: null, week: null };
  const m = /^(.*?)[-–]\s*([^-–]{1,8})$/.exec(s);
  if (m && mayBeWeek) {
    const week = weekOfMarker(m[2].trim());
    if (week) return { base: m[1].trim(), group: null, weekMarker: m[2].trim(), week };
  }
  return { base: s, group: null, weekMarker: null, week: null };
}

/** Jedna komórka planu → lista wpisów rozdzielonych `<br>`. */
function cellEntries(td) {
  const groups = [[]];
  const rec = (n) => {
    for (const c of n.children || []) {
      if (c.text !== undefined) { if (clean(c.text)) groups[groups.length - 1].push({ kind: 'text', value: clean(c.text) }); continue; }
      if (c.tag === 'br') { groups.push([]); continue; }
      if (c.tag === 'span' && hasClass(c, 'p')) { groups[groups.length - 1].push({ kind: 'p', value: clean(textOf(c)) }); continue; }
      if (c.tag === 'a') {
        const k = cls(c).find((x) => ['n', 'o', 's'].includes(x));
        if (k) { groups[groups.length - 1].push({ kind: k, value: clean(textOf(c)), href: c.attrs.href || '' }); continue; }
      }
      rec(c);
    }
  };
  rec(td);
  return groups.map((parts) => {
    const pick = (k) => { const x = parts.find((p) => p.kind === k); return x ? x.value : ''; };
    const subject = pick('p'), teacher = pick('n'), klass = pick('o'), room = pick('s');
    if (!subject && !teacher && !klass && !room) return null;
    return { subject, teacher, klass, room, href: { n: (parts.find((p) => p.kind === 'n') || {}).href || '', o: (parts.find((p) => p.kind === 'o') || {}).href || '', s: (parts.find((p) => p.kind === 's') || {}).href || '' } };
  }).filter(Boolean);
}

/**
 * Jedna strona planu → { kind: 'class'|'teacher'|'room'|'unknown', title, short, homeroom,
 *                        slots: [{ weekday, lessonNo, time, entry }] }
 * `rowspan` prowadzimy licznikiem zajętych wierszy per kolumna — inaczej wiersz po lekcji podwójnej
 * ma mniej `<td>` niż dni tygodnia i cała reszta tabeli rozjeżdża się o jedną kolumnę (README §4 pkt 6).
 */
function parsePage(html, opts) {
  const o = opts || {};
  const doc = parseHtml(html);
  const titleEl = find(doc, (el) => el.tag === 'span' && hasClass(el, 'tytulnapis'));
  const title = titleEl ? clean(textOf(titleEl)) : clean(textOf(find(doc, (el) => el.tag === 'title') || { children: [] }));
  const opisAll = findAll(doc, (el) => hasClass(el, 'opis')).map((el) => clean(textOf(el)));
  const mHome = /Wychowawca:\s*(.+?)\s*$/.exec(opisAll.filter((t) => /Wychowawca:/.test(t)).join(' '));
  /* Legenda cyklu stoi **po** `</table>`, a przed stopką generatora — parser kończący czytanie na
     `</table>` nigdy jej nie zobaczy (README §4a, pułapka 2). */
  const legend = opisAll.filter((t) => !/Wychowawca:/.test(t) && /tyg|tydz|co 2|T1|T2/i.test(t)).join(' ') || null;
  const table = find(doc, (el) => el.tag === 'table' && hasClass(el, 'tabela'));
  const slots = [];
  const days = [];
  if (table) {
    const rows = findAll(table, (el) => el.tag === 'tr');
    const occupied = {};                                              // kolumna → ile wierszy jeszcze zajęte
    let headerDone = false;
    for (const tr of rows) {
      const cells = (tr.children || []).filter((c) => isEl(c) && (c.tag === 'td' || c.tag === 'th'));
      if (!headerDone && cells.some((c) => c.tag === 'th')) {
        cells.forEach((c, i) => { if (i >= 2) days.push(dayIndex(textOf(c))); });
        headerDone = true;
        continue;
      }
      let no = null, time = '';
      let col = 0;                                                    // indeks kolumny dnia (0 = poniedziałek)
      let ci = 0;
      /* Nr i Godz: pierwsze dwie komórki wiersza, o ile nie są przykryte rowspanem (nie bywają). */
      if (cells.length && hasClass(cells[0], 'nr')) { no = parseInt(clean(textOf(cells[0])), 10); ci = 1; }
      if (cells[ci] && hasClass(cells[ci], 'g')) { time = clean(textOf(cells[ci])); ci++; }
      if (no == null || !Number.isFinite(no)) { for (const k of Object.keys(occupied)) if (occupied[k] > 0) occupied[k]--; continue; }
      for (; ci < cells.length; ci++) {
        while (occupied[col] > 0) { occupied[col]--; col++; }
        const td = cells[ci];
        const span = Math.max(1, parseInt(td.attrs.rowspan || '1', 10) || 1);
        const weekday = days[col] > 0 ? days[col] : col + 1;
        const entries = cellEntries(td);
        for (const entry of entries) for (let k = 0; k < span; k++) slots.push({ weekday, lessonNo: no + k, time, entry, span, part: k, shared: entries.length });
        if (span > 1) occupied[col] = span - 1;
        col++;
      }
      while (occupied[col] > 0) { occupied[col]--; col++; }
      for (const k of Object.keys(occupied)) if (+k > col && occupied[k] > 0) occupied[k]--;
    }
  }
  const anyN = slots.some((s) => s.entry.teacher), anyO = slots.some((s) => s.entry.klass);
  let kind = 'unknown';
  const file = String(o.path || '').split('/').pop() || '';
  if (/^o\d+\.html?$/i.test(file)) kind = 'class';
  else if (/^n\d+\.html?$/i.test(file)) kind = 'teacher';
  else if (/^s\d+\.html?$/i.test(file)) kind = 'room';
  else if (anyN && !anyO) kind = 'class';
  else if (anyO) kind = 'teacher';
  const mShort = /\(([^)]+)\)\s*$/.exec(title);
  return { kind, title, short: mShort ? mShort[1].trim() : '', homeroom: mHome ? mHome[1] : null, legend, slots, path: o.path || '' };
}

/** `lista.html` → { teachers: {short: 'Nowak Joanna'}, classes: {plik: '4 A'}, rooms: {plik: 'Sala 12'} } */
function parseIndexList(html) {
  const doc = parseHtml(html);
  const out = { teachers: {}, classes: {}, rooms: {}, byFile: {} };
  for (const a of findAll(doc, (el) => el.tag === 'a' && el.attrs.href)) {
    const href = String(a.attrs.href).split('/').pop();
    const label = clean(textOf(a));
    if (!label) continue;
    out.byFile[href] = label;
    const m = /^(.*?)\s*\(([^)]+)\)\s*$/.exec(label);
    if (/^n\d+\.html?$/i.test(href) && m) out.teachers[m[2].trim()] = m[1].trim();
    else if (/^o\d+\.html?$/i.test(href)) out.classes[href] = label;
    else if (/^s\d+\.html?$/i.test(href)) out.rooms[href] = label;
  }
  return out;
}

/* ------------------------------------------------------------------------------ import */
/**
 * parseOptivum(input, { ref }) — `input` to mapa `{ ścieżka: bajty|base64 }` albo pojedynczy plik.
 * Zwraca ten sam kształt, co `parseAsc`.
 */
function parseOptivum(input, opts) {
  const o = opts || {};
  const files = new Map();
  if (input && typeof input === 'object' && !Buffer.isBuffer(input) && !Array.isArray(input) && !(input.type === 'Buffer')) {
    for (const [p, v] of Object.entries(input)) files.set(String(p), TD.toBuffer(v, 'base64'));
  } else files.set(o.path || 'plan.html', TD.toBuffer(input));

  const warnings = [];
  const pages = [];
  let listing = null;
  const encodings = new Set();
  for (const [path, buf] of files) {
    const name = path.split('/').pop().toLowerCase();
    if (!/\.html?$/.test(name)) continue;
    const dec = TD.decode(buf, { default: 'windows-1250' });          // starsze buildy Optivum: cp1250
    encodings.add(dec.encoding);
    if (dec.note) warnings.push(`${path}: ${dec.note}`);
    if (/^lista\.html?$/.test(name)) { listing = parseIndexList(dec.text); continue; }
    if (/^index\.html?$/.test(name)) continue;                        // frameset, bez <body>
    const page = parsePage(dec.text, { path });
    if (!page.slots.length && page.kind === 'unknown') continue;
    pages.push(page);
  }
  if (!pages.length) throw new Error('W przesłanych plikach nie ma żadnej strony planu Optivum (<table class="tabela">).');

  /* Wgrany katalog potrafi zawierać **kilka publikacji naraz** (np. `plany/`, `utf8/plany/`,
     `ab/plany/` obok siebie — tak wygląda nasz katalog fixture'ów, a tak samo wygląda dysk szkoły,
     która trzyma archiwum poprzednich lat). Scalenie ich dałoby jeden plan złożony z kilku.
     Publikacja = katalog nadrzędny nad `plany/` (albo katalog samych stron). Bierzemy tę z największą
     liczbą stron oddziałów, a o pozostałych mówimy wprost. */
  const rootOf = (p) => { const parts = String(p).split('/'); parts.pop(); if (parts.length && /^plany$/i.test(parts[parts.length - 1])) parts.pop(); return parts.join('/'); };
  const byRoot = new Map();
  for (const page of pages) { const r = rootOf(page.path); if (!byRoot.has(r)) byRoot.set(r, []); byRoot.get(r).push(page); }
  if (byRoot.size > 1) {
    const score = (list) => [list.filter((x) => x.kind === 'class').length, list.length];
    const roots = [...byRoot.entries()].sort((a, b) => { const sa = score(a[1]), sb = score(b[1]); return (sb[0] - sa[0]) || (sb[1] - sa[1]) || (a[0].length - b[0].length); });
    const [chosen, mine] = roots[0];
    const dropped = roots.slice(1).map(([r, l]) => `${r || '.'} (${l.length})`);
    warnings.push(`We wgranych plikach jest ${byRoot.size} publikacji planu; wczytano „${chosen || '.'}” (${mine.length} stron), pominięto: ${dropped.join(', ')}. Wgraj katalog jednej publikacji, jeśli chodziło o inną.`);
    pages.length = 0; pages.push(...mine);
  }

  const teacherNames = (listing && listing.teachers) || {};
  const classPages = pages.filter((p) => p.kind === 'class');
  const otherPages = pages.filter((p) => p.kind !== 'class');
  const coveredClasses = new Set(classPages.map((p) => classKeyOf(p.title)));

  const rows = [];
  let doubles = 0;
  const homerooms = {};
  const seen = new Set();
  const addRow = (r) => {
    const k = [r.classKey, r.weekday, r.lessonNo, r.week || '', r.groupLabel || '', r.subjectKey, r.teacherKeys.join('+'), r.roomKey].join('|');
    if (seen.has(k)) return false;
    seen.add(k); rows.push(r); return true;
  };
  const ref = o.ref || 'Plan lekcji Optivum';
  const weekMarkers = new Map();                                      // marker → { week, rows, legend }
  const noteMarker = (m, week, legend) => { const e = weekMarkers.get(m) || { marker: m, week, rows: 0, legend: legend || null }; e.rows++; if (legend && !e.legend) e.legend = legend; weekMarkers.set(m, e); };

  for (const page of classPages) {
    const classKey = classKeyOf(page.title);
    if (page.homeroom) homerooms[classKey] = page.homeroom;
    for (const s of page.slots) {
      const { base, group, weekMarker, week } = splitGroupSuffix(s.entry.subject, s.shared > 1 || !!page.legend);
      if (weekMarker) noteMarker(weekMarker, week, page.legend);
      if (s.span > 1 && s.part === 0) doubles++;
      addRow({ classKey, classLabel: page.title, weekday: s.weekday, lessonNo: s.lessonNo,
        subjectKey: base, subjectLabel: base, teacherKeys: s.entry.teacher ? [s.entry.teacher] : [],
        roomKey: s.entry.room || '', week: week || null, groupLabel: group, entireClass: !group,
        weekMarker: weekMarker || null,
        source: { tool: 'optivum', ref, page: page.path } });
    }
  }
  /* Strony nauczycieli i sal: dla oddziałów bez własnej strony są jedynym źródłem, dla pozostałych
     kontrolą krzyżową. Obie role obsługujemy w jednym przebiegu. */
  const crossMismatch = [];
  const classSlots = new Map();
  for (const r of rows) { const k = `${r.classKey}|${r.weekday}|${r.lessonNo}`; if (!classSlots.has(k)) classSlots.set(k, []); classSlots.get(k).push(r); }
  for (const page of otherPages) {
    const who = page.short || page.title;
    for (const s of page.slots) {
      if (!s.entry.klass) continue;
      const { base: classLabel, group } = splitGroupSuffix(s.entry.klass, false);
      /* Marker tygodnia stoi przy przedmiocie także na stronach nauczycieli i sal. */
      const subj = splitGroupSuffix(s.entry.subject, s.shared > 1 || !!page.legend);
      const classKey = classKeyOf(classLabel);
      const teacher = page.kind === 'teacher' ? (page.short || page.title) : s.entry.teacher;
      const room = page.kind === 'room' ? (page.short || page.title.replace(/^Sala\s+/i, '')) : s.entry.room;
      if (!coveredClasses.has(classKey)) {
        if (s.span > 1 && s.part === 0) doubles++;
        if (subj.weekMarker) noteMarker(subj.weekMarker, subj.week, page.legend);
        addRow({ classKey, classLabel, weekday: s.weekday, lessonNo: s.lessonNo,
          subjectKey: subj.base, subjectLabel: subj.base,
          teacherKeys: teacher ? [teacher] : [], roomKey: room || '', week: subj.week || null,
          groupLabel: group || subj.group, entireClass: !(group || subj.group),
          weekMarker: subj.weekMarker || null,
          source: { tool: 'optivum', ref, page: page.path } });
        continue;
      }
      if (page.kind !== 'teacher') continue;
      /* Najpierw po nauczycielu **i przedmiocie** — inaczej komórka z dwiema lekcjami (cykl A/B)
         porównałaby wpis z tygodnia II z wierszem tygodnia I i zgłosiła fałszywą różnicę sal. */
      const here = classSlots.get(`${classKey}|${s.weekday}|${s.lessonNo}`) || [];
      const match = here.find((r) => r.teacherKeys.includes(teacher) && r.subjectKey === subj.base) || here.find((r) => r.teacherKeys.includes(teacher));
      if (!match) crossMismatch.push({ kind: 'teacher', page: page.path, teacher: who, classKey, weekday: s.weekday, lessonNo: s.lessonNo, subject: subj.base, onClassPage: here.map((r) => r.teacherKeys.join('+')).join(', ') || '—', onTeacherPage: who, note: 'na stronie oddziału nie ma tej godziny u tego nauczyciela' });
      else if (room && match.roomKey && room !== match.roomKey) crossMismatch.push({ kind: 'room', page: page.path, teacher: who, classKey, weekday: s.weekday, lessonNo: s.lessonNo, subject: match.subjectKey, onClassPage: match.roomKey, onTeacherPage: room, note: `sala ${room} na stronie nauczyciela, ${match.roomKey} na stronie oddziału` });
    }
  }
  if (crossMismatch.length) warnings.push(`Kontrola krzyżowa ze stronami nauczycieli: ${crossMismatch.length} ${crossMismatch.length === 1 ? 'rozbieżność' : 'rozbieżności'} — plan oddziału ma pierwszeństwo, ale która strona ma rację, rozstrzyga człowiek: ` + crossMismatch.map((m) => `${m.classKey} ${WD_SHORT[m.weekday] || m.weekday} godz. ${m.lessonNo} ${m.subject} (${m.note})`).join('; ') + '.');
  if (!classPages.length) warnings.push('W publikacji nie ma ani jednej strony oddziału (`plany/o*.html`) — plan odtworzono ze stron nauczycieli i sal, więc podziały na grupy mogą być niepełne.');
  if (!listing) warnings.push('Brak `lista.html` — nauczyciele są tylko skrótami (np. „KE”), bez imion i nazwisk.');
  const markers = [...weekMarkers.values()].sort((a, b) => (a.marker < b.marker ? -1 : 1));
  if (markers.length) warnings.push(`Cykl dwutygodniowy rozpoznany **heurystycznie** ze znaczników przy nazwie przedmiotu: ${markers.map((m) => `„-${m.marker}” → tydzień ${m.week} (${m.rows} ${m.rows === 1 ? 'pozycja' : 'pozycji'})`).join(', ')}.${markers.some((m) => m.legend) ? ` Legenda pod tabelą: „${markers.find((m) => m.legend).legend}”.` : ''} Publikacja Optivum nie ma własnego wymiaru tygodnia — „-1/2” to podział na grupy, a każdy inny sufiks **może** być tygodniem. Sprawdź to w tabeli dopasowania, zanim zapiszesz.`);
  else warnings.push('Publikacja Optivum nie niesie cyklu dwutygodniowego ani liczby nauczycieli na lekcji: wszystkie pozycje wjadą jako „co tydzień”, z jednym nauczycielem.');

  const uniq = (arr) => [...new Map(arr.map((x) => [x.key, x])).values()];
  const entities = {
    teachers: uniq(rows.flatMap((r) => r.teacherKeys).filter(Boolean).map((k) => ({ key: k, short: k, name: teacherNames[k] || '' }))),
    classes: uniq(rows.map((r) => ({ key: r.classKey, short: r.classKey, name: r.classLabel || r.classKey }))),
    subjects: uniq(rows.filter((r) => r.subjectKey).map((r) => ({ key: r.subjectKey, short: '', name: r.subjectKey }))),
    rooms: uniq(rows.filter((r) => r.roomKey).map((r) => ({ key: r.roomKey, short: r.roomKey, name: (listing && listing.byFile && Object.values(listing.rooms || {}).find((x) => x.replace(/^Sala\s+/i, '') === r.roomKey)) || r.roomKey })))
  };
  const byClass = {};
  for (const r of rows) byClass[r.classKey] = (byClass[r.classKey] || 0) + 1;

  return {
    tool: 'optivum', version: '', displayName: (classPages[0] && classPages[0].title) || '', ref,
    encoding: [...encodings].join('+'), encodingSource: 'meta',
    rows, entities, warnings, homerooms, crossMismatch, weekMarkers: [...weekMarkers.values()],
    stats: { files: files.size, pages: pages.length, classPages: classPages.length, teacherPages: otherPages.filter((p) => p.kind === 'teacher').length,
      roomPages: otherPages.filter((p) => p.kind === 'room').length, rows: rows.length, rowsPerClass: byClass, mismatches: crossMismatch.length, weekMarkers: markers.length,
      doubles,
      weeks: { all: rows.filter((r) => !r.week).length, A: rows.filter((r) => r.week === 'A').length, B: rows.filter((r) => r.week === 'B').length } }
  };
}

/** Czy ten tekst wygląda na stronę publikacji Optivum. */
function looksLikeOptivum(text) {
  const head = String(text || '').slice(0, 8000);
  return /class\s*=\s*["']tabela["']/i.test(head) || /Plan lekcji Optivum/i.test(head) || (/<table/i.test(head) && /class\s*=\s*["']p["']/i.test(head));
}

module.exports = { parseOptivum, parsePage, parseIndexList, parseHtml, looksLikeOptivum, splitGroupSuffix, classKeyOf, textOf };
