'use strict';
/* R2 — roczny pakiet archiwalny jako plik do podpisania.
 *
 * § 22 rozporządzenia o dokumentacji każe w ciągu 10 dni od zakończenia roku szkolnego zapisać dane
 * dziennika na informatycznym nośniku i **podpisać** je podpisem kwalifikowanym, pieczęcią
 * kwalifikowaną albo podpisem osobistym (czy podpis zaufany też — patrz docs/ARCHIVE.md, pytanie do
 * prawnika). Żadnego z tych podpisów nie złożymy za szkołę: dyrektor podpisuje **na zewnątrz**
 * (gov.pl, e-Dowód, aplikacja dostawcy kwalifikowanego). Rola dziennika kończy się na dwóch
 * rzeczach: wydać jeden plik, który da się podpisać, i przyjąć z powrotem to, co wróciło.
 *
 * Pakiet to zwykły ZIP (metoda „stored”, bez kompresji — patrz `zipStore` niżej):
 *
 *   dziennik-<rok>.xml    eksport § 21 (ten sam bajt w bajt, co GET …/xml)
 *   dziennik-<rok>.html   wydruk (ten sam, co GET …/print)
 *   manifest.json         szkoła, rok, czas, lista plików z SHA-256 i rozmiarem, liczności kolekcji, wersja
 *   manifest.sha256       jedna linia w formacie `sha256sum` — TO jest plik, który dyrektor podpisuje
 *   seal.json             pieczęć kluczem szkoły nad manifest.json — dowód spójności, NIE podpis ustawowy
 *
 * Pakiet jest odtwarzalny: przy tych samych zapisanych składnikach (xml, html, manifest.json,
 * seal.json, znacznik czasu) `buildArchivePackage` daje bajt w bajt ten sam ZIP, więc skrót
 * zapisany w chwili wygenerowania zgadza się ze skrótem pliku pobranego pół roku później.
 */
const crypto = require('node:crypto');
const D = require('./domain');
const ID = require('./identity');
const U = require('./util');

const SOFTWARE = (() => { try { const p = require('../../package.json'); return { name: 'EdMat', version: p.version || '0.0.0' }; } catch (e) { return { name: 'EdMat', version: '0.0.0' }; } })();

const sha256 = (buf) => crypto.createHash('sha256').update(Buffer.isBuffer(buf) ? buf : Buffer.from(String(buf), 'utf8')).digest('hex');
const bytesOf = (s) => (Buffer.isBuffer(s) ? s.length : Buffer.byteLength(String(s), 'utf8'));
/** Nazwa pliku, która przeżyje nagłówek `Content-Disposition` i każdy system plików. */
function safeFileName(raw, fallback) {
  const n = String(raw == null ? '' : raw).normalize('NFKD').replace(/[^A-Za-z0-9._-]+/g, '-').replace(/^[-.]+/, '').replace(/-+/g, '-').slice(0, 120);
  return n || fallback || 'plik';
}
/** „2026/2027” → „2026-2027”; używane w nazwach plików pakietu. */
const yearSlug = (year) => safeFileName(String(year).replace(/\//g, '-'), 'rok');

/* ------------------------------------------------------------------ minimalny zapis ZIP ---------
 * Zero zależności, więc ZIP piszemy sami. Świadome ograniczenia (docs/ARCHIVE.md § „Granice”):
 *   · tylko metoda 0 (stored) — pakiet nie jest kompresowany, ZIP jest workiem, nie archiwizatorem;
 *   · brak ZIP64 — łącznie < 4 GiB i < 65 535 wpisów (rocznik szkoły to setki kilobajtów);
 *   · brak katalogów, atrybutów, komentarzy, „data descriptor”, szyfrowania i pól „extra”;
 *   · nazwy w UTF-8 przez bit 11 flagi ogólnej (EFS), bez CP437;
 *   · czas w formacie DOS: rozdzielczość 2 s, lata 1980–2107, zawsze czas lokalny szkoły.
 */
const CRC_TABLE = (() => {
  const t = new Int32Array(256);
  for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c; }
  return t;
})();
function crc32(buf) {
  let c = 0 ^ -1;
  for (let i = 0; i < buf.length; i++) c = (c >>> 8) ^ CRC_TABLE[(c ^ buf[i]) & 0xff];
  return (c ^ -1) >>> 0;
}
/** Data i czas w formacie MS-DOS z lokalnej daty szkoły — nigdy z `new Date()`. */
function dosStamp(date, time) {
  const dm = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(date || '')) || ['', '1980', '01', '01'];
  const tm = /^(\d{2}):(\d{2})(?::(\d{2}))?/.exec(String(time || '')) || ['', '00', '00', '00'];
  const y = Math.min(2107, Math.max(1980, +dm[1]));
  return {
    date: (((y - 1980) & 0x7f) << 9) | ((+dm[2] & 0x0f) << 5) | (+dm[3] & 0x1f),
    time: ((+tm[1] & 0x1f) << 11) | ((+tm[2] & 0x3f) << 5) | ((Math.floor(+(tm[3] || 0) / 2)) & 0x1f)
  };
}
/**
 * ZIP bez kompresji z listy `[{name, content}]`.
 * @param {{name:string, content:(string|Buffer)}[]} entries
 * @param {{date:string, time:string}} stamp  lokalny dzień i godzina szkoły
 * @returns {Buffer}
 */
function zipStore(entries, stamp) {
  const st = dosStamp((stamp || {}).date, (stamp || {}).time);
  if (entries.length > 0xffff) throw new Error('Pakiet ZIP bez ZIP64 mieści najwyżej 65535 plików.');
  const local = [], central = [];
  let offset = 0;
  for (const e of entries) {
    const name = Buffer.from(String(e.name), 'utf8');
    const data = Buffer.isBuffer(e.content) ? e.content : Buffer.from(String(e.content), 'utf8');
    const crc = crc32(data);
    const lh = Buffer.alloc(30);
    lh.writeUInt32LE(0x04034b50, 0); lh.writeUInt16LE(20, 4); lh.writeUInt16LE(0x0800, 6); lh.writeUInt16LE(0, 8);
    lh.writeUInt16LE(st.time, 10); lh.writeUInt16LE(st.date, 12);
    lh.writeUInt32LE(crc, 14); lh.writeUInt32LE(data.length, 18); lh.writeUInt32LE(data.length, 22);
    lh.writeUInt16LE(name.length, 26); lh.writeUInt16LE(0, 28);
    local.push(lh, name, data);
    const ch = Buffer.alloc(46);
    ch.writeUInt32LE(0x02014b50, 0); ch.writeUInt16LE(20, 4); ch.writeUInt16LE(20, 6); ch.writeUInt16LE(0x0800, 8); ch.writeUInt16LE(0, 10);
    ch.writeUInt16LE(st.time, 12); ch.writeUInt16LE(st.date, 14);
    ch.writeUInt32LE(crc, 16); ch.writeUInt32LE(data.length, 20); ch.writeUInt32LE(data.length, 24);
    ch.writeUInt16LE(name.length, 28); ch.writeUInt16LE(0, 30); ch.writeUInt16LE(0, 32);
    ch.writeUInt16LE(0, 34); ch.writeUInt16LE(0, 36); ch.writeUInt32LE(0, 38); ch.writeUInt32LE(offset, 42);
    central.push(ch, name);
    offset += lh.length + name.length + data.length;
    if (offset > 0xffffffff) throw new Error('Pakiet ZIP bez ZIP64 mieści najwyżej 4 GiB.');
  }
  const cd = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(0, 4); end.writeUInt16LE(0, 6);
  end.writeUInt16LE(entries.length, 8); end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(cd.length, 12); end.writeUInt32LE(offset, 16); end.writeUInt16LE(0, 20);
  return Buffer.concat([...local, cd, end]);
}

/* ------------------------------------------------------------------ eksport § 21 ---------------
 * D3-19/D3-20: pakiet ma BYĆ dziennikiem, a nie spisem ocen.
 *
 * Rozporządzenie o dokumentacji przebiegu nauczania wymaga od dziennika lekcyjnego: przebiegu zajęć
 * (data, numer lekcji, przedmiot, nauczyciel, temat), obecności KAŻDEGO ucznia na KAŻDEJ lekcji,
 * ocen bieżących z kategorią, wagą, datą i nauczycielem, ocen śródrocznych i rocznych, oceny
 * zachowania, ocen opisowych w klasach I–III, uwag, usprawiedliwień, notatek wychowawcy i danych
 * świadectwa. Do 23.09.2026 XML miał jedenaście rodzajów elementów i ani jednej lekcji.
 *
 * D3-20: wszystko jest filtrowane rokiem szkolnym. Każda kolekcja datuje się inaczej, więc
 * `rowYearDate` czyta ją tak, jak sama się opisuje (`date`, `from`, `schoolYear`, `at`), a nie
 * jednym uniwersalnym polem, którego nie ma.
 *
 * Korzeń dokumentu i kształt, na którym opiera się [3.3.17], zostają — elementy dochodzą, nic nie
 * zmienia nazwy.
 */

/** Słownik statusów frekwencji — pakiet ma się dać odczytać bez kodu źródłowego (D3-25). */
const ATTENDANCE_CODES = {
  ob: 'obecny', nb: 'nieobecny nieusprawiedliwiony', sp: 'spóźnienie', zw: 'zwolniony z zajęć',
  u: 'nieobecny usprawiedliwiony', rs: 'nieobecność z przyczyn szkolnych', w: 'wycieczka lub zawody'
};
/** Słownik rodzajów ocen. */
const GRADE_KINDS = {
  partial: 'ocena bieżąca', proposedMid: 'propozycja oceny śródrocznej', midterm: 'ocena śródroczna (klasyfikacyjna)',
  proposedFinal: 'propozycja oceny rocznej', final: 'ocena roczna (klasyfikacyjna)'
};

/** „2026/2027” → `{ from:'2026-09-01', to:'2027-08-31' }`. Rok szkolny trwa do 31 sierpnia. */
function schoolYearRange(db, year) {
  const m = /^(\d{4})\/(\d{4})$/.exec(String(year || ''));
  const cfg = (db && db.data && db.data.config) || {};
  if (!m) {
    const s = (cfg.semesters || [])[0], e = (cfg.semesters || [])[(cfg.semesters || []).length - 1];
    return { from: (s && s.from) || '0000-01-01', to: (e && e.to) || '9999-12-31', start: (s && s.from) || null };
  }
  const start = `${m[1]}-09-01`, end = `${m[2]}-08-31`;
  /* Rok bieżący ma swoje semestry w konfiguracji — jeśli zaczyna się wcześniej niż 1 września
     (np. szkoła podała własne daty), bierzemy datę z konfiguracji, nigdy późniejszą. */
  if (String(cfg.year) === String(year) && (cfg.semesters || []).length) {
    const first = cfg.semesters[0].from;
    return { from: first && first < start ? first : start, to: end, start: first || start };
  }
  return { from: start, to: end, start };
}
/** Data, po której wiersz należy do roku szkolnego — czytana tak, jak dana kolekcja się datuje. */
function rowYearDate(row, tz) {
  if (!row || typeof row !== 'object') return null;
  if (typeof row.schoolYear === 'string' && /^\d{4}\/\d{4}$/.test(row.schoolYear)) return row.schoolYear;   // świadectwa
  for (const k of ['date', 'from', 'day']) if (typeof row[k] === 'string' && /^\d{4}-\d{2}-\d{2}/.test(row[k])) return row[k].slice(0, 10);
  for (const k of ['at', 'createdAt', 'decidedAt', 'dueAt']) {
    const v = row[k];
    if (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}/.test(v)) return tz ? U.localDate(v, tz) : v.slice(0, 10);
  }
  return null;
}
/** Czy wiersz należy do tego rocznika. Wiersz bez daty zostaje (lepiej za dużo niż luka w dzienniku). */
function inYear(row, range, year, tz) {
  const d = rowYearDate(row, tz);
  if (d == null) return true;
  if (/^\d{4}\/\d{4}$/.test(d)) return d === String(year);
  return d >= range.from && d <= range.to;
}
/** Indeks `klucz → [wiersze]` z jednego przejścia po kolekcji, już przefiltrowanej rokiem. */
function indexBy(rows, key, keep) {
  const m = new Map();
  for (const r of rows) {
    if (keep && !keep(r)) continue;
    const k = r[key]; if (k == null) continue;
    let v = m.get(k); if (!v) m.set(k, v = []); v.push(r);
  }
  return m;
}

/**
 * XML dziennika (§ 21) w kawałkach — jeden plik XML na cały rocznik, nie jeden na oddział.
 * Generator, a nie jeden wielki napis: przy 24 oddziałach i pełnym roku bajty lecą wprost na dysk
 * (`server/lib/blobs.js`), więc szczyt pamięci nie rośnie z rozmiarem rocznika (R3-09).
 * Rozbicie na osobne pliki per oddział zmieniłoby korzeń dokumentu i kształt eksportu, który już
 * jest w umowie z resztą systemu (`GET …/xml`, testy [3.3.17]); oddziały są w środku jako `<Klasa>`.
 */
function* archiveXml(db, year, at) {
  const cfg = db.data.config; const x = D.xmlEsc; const stamp = at || U.now();
  const tz = D.tz(db);
  const range = schoolYearRange(db, year);
  const yr = String(year);
  const keep = (r) => inYear(r, range, yr, tz);

  const classes = db.col('classes'), students = db.col('students');
  /* Jedno przejście po każdej kolekcji, już z filtrem rocznika (D3-20, REL-01). */
  const lessonsByClass = indexBy(db.col('lessons'), 'classId', keep);
  const attByLesson = indexBy(db.col('attendance'), 'lessonId', (a) => !a.draft && keep(a));
  const attByStudent = indexBy(db.col('attendance'), 'studentId', (a) => !a.draft && keep(a));
  const gradesByStudent = indexBy(db.col('grades'), 'studentId', (g) => !g.deleted && keep(g));
  const remarksByStudent = indexBy(db.col('remarks'), 'studentId', (r) => !r.deleted && keep(r));
  const descByStudent = indexBy(db.col('descriptiveGrades'), 'studentId', keep);
  const behaviorByStudent = indexBy(db.col('behaviorGrades'), 'studentId', keep);
  const excusesByStudent = indexBy(db.col('excuses'), 'studentId', keep);
  const certByStudent = indexBy(db.col('reportCardHistory'), 'studentId', keep);
  const notesByStudent = indexBy(db.col('documents'), 'studentId', (d) => /wychowaw|notat/i.test(String(d.kind || d.type || '')) && keep(d));
  const studentsByClass = new Map();
  for (const st of students) { let v = studentsByClass.get(st.classId); if (!v) studentsByClass.set(st.classId, v = []); v.push(st); }

  /* Nazwisko nauczyciela pada przy każdej lekcji i przy każdej ocenie — przy pełnym roczniku to
     setki tysięcy wywołań, więc raz policzone zostaje policzone. */
  const labels = new Map();
  const who = (id) => { if (id == null) return ''; let v = labels.get(id); if (v === undefined) labels.set(id, v = D.userLabel(db.get('users', id))); return v; };
  const semesters = (cfg.semesters || []);

  yield `<?xml version="1.0" encoding="UTF-8"?>\n<DziennikElektroniczny rok="${x(yr)}" wygenerowano="${x(stamp)}" odDnia="${x(range.from)}" doDnia="${x(range.to)}">\n`;
  yield `  <Szkola nazwa="${x(cfg.school.name)}" regon="${x(cfg.school.regon)}" rspo="${x(cfg.school.rspo)}" adres="${x(cfg.school.address)}"/>\n`;
  /* D3-25: pakiet niesie własne słowniki, więc archiwum państwowe odczyta go bez kodu źródłowego. */
  yield `  <Slowniki>\n    <Przedmioty>\n` +
    db.col('subjects').map((s) => `      <Przedmiot id="${x(s.id)}" nazwa="${x(s.name)}"/>`).join('\n') +
    `\n    </Przedmioty>\n    <RodzajeOcen>\n` +
    Object.keys(GRADE_KINDS).map((k) => `      <Rodzaj id="${x(k)}" opis="${x(GRADE_KINDS[k])}"/>`).join('\n') +
    `\n    </RodzajeOcen>\n    <StatusyFrekwencji>\n` +
    Object.keys(ATTENDANCE_CODES).map((k) => `      <Status id="${x(k)}" opis="${x(ATTENDANCE_CODES[k])}"/>`).join('\n') +
    `\n    </StatusyFrekwencji>\n  </Slowniki>\n`;
  yield `  <Semestry>\n` + semesters.map((sm) => `    <Semestr id="${sm.id}" nazwa="${x(sm.name)}" od="${x(sm.from)}" do="${x(sm.to)}"/>`).join('\n') + `\n  </Semestry>\n`;

  /* D3-26: oddział usunięty przy przejściu na nowy rok nie może zabrać ze sobą absolwentów. */
  const orphans = students.filter((s) => !classes.some((c) => c.id === s.classId));
  const groups = classes.map((c) => ({ id: c.id, name: c.name, level: c.level, homeroomTeacherId: c.homeroomTeacherId, pupils: studentsByClass.get(c.id) || [] }))
    .concat(orphans.length ? [{ id: 'bez-oddzialu', name: 'Uczniowie bez oddziału (absolwenci, przeniesieni)', level: '', homeroomTeacherId: null, pupils: orphans }] : []);

  for (const c of groups) {
    const lessons = (lessonsByClass.get(c.id) || []).slice().sort((a, b) => (a.date === b.date ? (a.lessonNo || 0) - (b.lessonNo || 0) : a.date < b.date ? -1 : 1));
    yield `  <Klasa id="${x(c.id)}" nazwa="${x(c.name)}" poziom="${x(c.level)}" wychowawca="${x(who(c.homeroomTeacherId))}">\n`;
    /* Przebieg zajęć z obecnością przy każdej lekcji — serce dziennika lekcyjnego (D3-19). */
    yield `    <Lekcje liczba="${lessons.length}">\n`;
    for (const l of lessons) {
      const att = attByLesson.get(l.id) || [];
      yield `      <Lekcja id="${x(l.id)}" data="${x(l.date)}" nrLekcji="${l.lessonNo == null ? '' : l.lessonNo}" przedmiot="${x(l.subjectId)}" nauczyciel="${x(who(l.substituteTeacherId || l.teacherId))}" zastepstwo="${l.substituteTeacherId ? 'tak' : 'nie'}" sala="${x(l.room || '')}" status="${x(l.status || '')}" grupa="${x(l.groupId || '')}">\n` +
        `        <Temat>${x(l.topic || '')}</Temat>\n` +
        `        <Frekwencja wpisow="${att.length}">\n` +
        /* `status` rozwija `<StatusyFrekwencji>` na początku dokumentu — powtarzanie opisu przy
           każdym z setek tysięcy wpisów urosłoby o dziesiątki megabajtów i niczego by nie dodało. */
        att.map((a) => `          <Obecnosc uczen="${x(a.studentId)}" status="${x(a.status)}"${a.minutes ? ` spoznienieMin="${a.minutes}"` : ''}${a.excuseId ? ` usprawiedliwienie="${x(a.excuseId)}"` : ''}/>`).join('\n') +
        `${att.length ? '\n' : ''}        </Frekwencja>\n      </Lekcja>\n`;
    }
    yield `    </Lekcje>\n`;

    for (const s of c.pupils) {
      const grades = gradesByStudent.get(s.id) || [];
      const att = attByStudent.get(s.id) || [];
      const stats = U.attendanceStats(att);
      const doc = ID.documentOf(s);
      const remarks = remarksByStudent.get(s.id) || [];
      const desc = descByStudent.get(s.id) || [];
      const beh = behaviorByStudent.get(s.id) || [];
      const exc = excusesByStudent.get(s.id) || [];
      const cert = certByStudent.get(s.id) || [];
      const notes = notesByStudent.get(s.id) || [];
      yield `    <Uczen id="${x(s.id)}" nrWDzienniku="${s.rollNo}" nrKsiegi="${s.registerNo}">\n` +
        `      <Imie>${x(s.firstName)}</Imie>\n      <Nazwisko>${x(s.lastName)}</Nazwisko>\n      <Pesel>${x(s.pesel || '')}</Pesel>` +
        (doc ? `\n      <DokumentTozsamosci rodzaj="${x(doc.type)}" numer="${x(doc.number)}" kraj="${x(doc.country || '')}"/>` : '') +
        /* Dane z księgi uczniów, których brakowało w pakiecie (D3-19). */
        `\n      <DaneOsobowe dataUrodzenia="${x(s.birthDate || '')}" miejsceUrodzenia="${x(s.birthPlace || '')}" plec="${x(s.sex || '')}" adres="${x(s.address || '')}" przyjety="${x(s.enrolledAt || s.joinedAt || '')}" odszedl="${x(s.departureDate || s.leftAt || '')}" status="${x(s.status || '')}"/>\n` +
        `      <Oceny liczba="${grades.length}">\n` + grades.map((g) => `        <Ocena przedmiot="${x(g.subjectId)}" rodzaj="${x(g.kind)}" semestr="${g.semester}" data="${x(g.date || '')}" waga="${g.weight || 1}" kategoria="${x(g.categoryName || g.categoryId || '')}" nauczyciel="${x(who(g.teacherId))}" liczonaDoSredniej="${g.countsInAverage === false ? 'nie' : 'tak'}">${x(g.value)}</Ocena>`).join('\n') + `\n      </Oceny>\n` +
        `      <OcenyOpisowe liczba="${desc.length}">\n` + desc.map((d) => `        <OcenaOpisowa semestr="${d.semester == null ? '' : d.semester}" obszar="${x(d.area || '')}" nauczyciel="${x(who(d.teacherId))}" data="${x(rowYearDate(d, tz) || '')}">${x(d.text || '')}</OcenaOpisowa>`).join('\n') + `\n      </OcenyOpisowe>\n` +
        `      <Zachowanie liczba="${beh.length}">\n` + beh.map((b) => `        <OcenaZachowania semestr="${b.semester == null ? '' : b.semester}" rodzaj="${x(b.kind || '')}" punkty="${b.points == null ? '' : b.points}" wystawil="${x(who(b.byUserId))}" data="${x(rowYearDate(b, tz) || '')}">${x(b.value || '')}</OcenaZachowania>`).join('\n') + `\n      </Zachowanie>\n` +
        `      <Uwagi liczba="${remarks.length}">\n` + remarks.map((r) => `        <Uwaga data="${x(r.date || rowYearDate(r, tz) || '')}" rodzaj="${x(r.kind || '')}" punkty="${r.points == null ? '' : r.points}" nauczyciel="${x(who(r.teacherId))}">${x(r.text || '')}</Uwaga>`).join('\n') + `\n      </Uwagi>\n` +
        `      <Usprawiedliwienia liczba="${exc.length}">\n` + exc.map((e) => `        <Usprawiedliwienie od="${x(e.from || '')}" do="${x(e.to || '')}" godziny="${x((e.lessonNos || []).join(','))}" status="${x(e.status || '')}" zgloszone="${x(rowYearDate(e, tz) || '')}" przyjal="${x(who(e.decidedBy))}">${x(e.reason || '')}</Usprawiedliwienie>`).join('\n') + `\n      </Usprawiedliwienia>\n` +
        `      <NotatkiWychowawcy liczba="${notes.length}">\n` + notes.map((n) => `        <Notatka data="${x(rowYearDate(n, tz) || '')}" rodzaj="${x(n.kind || n.type || '')}" autor="${x(who(n.byUserId || n.teacherId))}">${x(n.text || n.note || n.title || '')}</Notatka>`).join('\n') + `\n      </NotatkiWychowawcy>\n` +
        `      <Swiadectwa liczba="${cert.length}">\n` + cert.map((hcert) => `        <Swiadectwo rok="${x(hcert.schoolYear || '')}" klasa="${x(hcert.className || '')}" szkola="${x(hcert.schoolName || '')}" zachowanie="${x(hcert.behavior || '')}" zrodlo="${x(hcert.source || '')}">` +
          (hcert.grades || []).map((g) => `<OcenaSwiadectwa przedmiot="${x(g.subjectId)}">${x(g.value)}</OcenaSwiadectwa>`).join('') + `</Swiadectwo>`).join('\n') + `\n      </Swiadectwa>\n` +
        `      <Frekwencja wpisow="${att.length}" obecnosc="${stats.percent == null ? '' : stats.percent}" nieusprawiedliwione="${stats.nb}" usprawiedliwione="${stats.u}" spoznienia="${stats.sp}" zwolnienia="${stats.zw}"/>\n    </Uczen>\n`;
    }
    yield `  </Klasa>\n`;
  }
  yield `</DziennikElektroniczny>\n`;
}

/** Wydruk pakietu — tabela kompletności dokumentacji, ten sam filtr rocznika, co XML. */
function archiveHtml(db, year, at) {
  const cfg = db.data.config; const x = D.xmlEsc; const stamp = at || U.now();
  const tz = D.tz(db);
  const range = schoolYearRange(db, year); const yr = String(year);
  const keep = (r) => inYear(r, range, yr, tz);
  const classes = db.col('classes');
  const lessonsByClass = indexBy(db.col('lessons'), 'classId', keep);
  const gradesByStudent = indexBy(db.col('grades'), 'studentId', (g) => !g.deleted && keep(g));
  const attByStudent = indexBy(db.col('attendance'), 'studentId', (a) => !a.draft && keep(a));
  const remarksByStudent = indexBy(db.col('remarks'), 'studentId', (r) => !r.deleted && keep(r));
  const studentsByClass = new Map();
  for (const st of db.col('students')) { let v = studentsByClass.get(st.classId); if (!v) studentsByClass.set(st.classId, v = []); v.push(st); }
  const body = `<h1>Pakiet archiwalny dziennika ${x(yr)}</h1>` +
    `<p class="note">${x(cfg.school.name)} · RSPO ${x(cfg.school.rspo)} · rok szkolny ${x(range.from)} – ${x(range.to)} · wygenerowano ${x(stamp)}</p>` +
    classes.map((c) => {
      const cs = studentsByClass.get(c.id) || [];
      const ls = lessonsByClass.get(c.id) || [];
      const held = ls.filter((l) => l.topic);
      return `<h2>Klasa ${x(c.name)} · wychowawca ${x(D.userLabel(db.get('users', c.homeroomTeacherId)))}</h2>` +
        `<p class="note">Zajęcia w roku: ${ls.length} · z zapisanym tematem: ${held.length}</p>` +
        `<table><caption>Kompletność dokumentacji — klasa ${x(c.name)}</caption><thead><tr><th scope="col">Nr</th><th scope="col">Uczeń</th><th scope="col">Ocen</th><th scope="col">Wpisów frekwencji</th><th scope="col">Uwag</th></tr></thead><tbody>` +
        cs.map((s) => `<tr><td>${s.rollNo}</td><td>${x(s.lastName + ' ' + s.firstName)}</td><td>${(gradesByStudent.get(s.id) || []).length}</td><td>${(attByStudent.get(s.id) || []).length}</td><td>${(remarksByStudent.get(s.id) || []).length}</td></tr>`).join('') + '</tbody></table>';
    }).join('');
  return D.printHtml(`Dziennik elektroniczny ${year} — pakiet archiwalny`, body,
    { school: cfg.school.name, schoolMeta: cfg.school.address, docNo: 'Archiwum ' + year, date: D.today(db), printed: stamp });
}

/** Zgodność wstecz: całość w pamięci, gdy ktoś potrzebuje napisów, a nie strumienia. */
function buildArchive(db, year, at) {
  let xml = '';
  for (const chunk of archiveXml(db, year, at)) xml += chunk;
  return { xml, html: archiveHtml(db, year, at) };
}

/** Ile wierszy leży w każdej kolekcji w chwili pakowania — manifest mówi, co pakiet obejmuje. */
function collectionCounts(db) {
  const out = {};
  const data = (db && db.data) || {};
  for (const k of Object.keys(data).sort()) if (Array.isArray(data[k])) out[k] = data[k].length;
  return out;
}

/**
 * Pakiet archiwalny w pamięci.
 * @param {object} db
 * @param {string} year  „2026/2027”
 * @param {{xml, html, at, manifestJson, sealJson, privateKey, tz}} [opts]
 *        Podanie `xml`/`html`/`manifestJson`/`sealJson` odtwarza zapisany pakiet zamiast liczyć go
 *        od nowa — dzięki temu ZIP pobrany później ma ten sam skrót, co w chwili wygenerowania.
 * @returns {{year, at, files, manifest, manifestJson, manifestSha256, manifestSum, seal, sealJson,
 *            zip: Buffer, zipName, zipSha256, bytes, digests}}
 */
function buildArchivePackage(db, year, opts) {
  const o = opts || {};
  const cfg = db.data.config;
  const at = o.at || U.now();
  const slug = yearSlug(year);
  let xml = o.xml, html = o.html;
  if (xml == null || html == null) { const b = buildArchive(db, year, at); xml = b.xml; html = b.html; }
  const payload = [
    { name: `dziennik-${slug}.xml`, content: xml, contentType: 'application/xml' },
    { name: `dziennik-${slug}.html`, content: html, contentType: 'text/html' }
  ].map((f) => Object.assign(f, { bytes: bytesOf(f.content), sha256: sha256(f.content) }));

  const manifest = o.manifestJson ? JSON.parse(o.manifestJson) : {
    format: 'edmat-archive/1',
    school: { name: cfg.school.name, rspo: cfg.school.rspo, regon: cfg.school.regon, address: cfg.school.address },
    year: String(year),
    generatedAt: at,
    timezone: D.tz(db),
    hashAlgorithm: 'sha256',
    software: { name: SOFTWARE.name, version: SOFTWARE.version, node: process.version },
    files: payload.map((f) => ({ name: f.name, bytes: f.bytes, sha256: f.sha256, contentType: f.contentType })),
    collections: collectionCounts(db),
    signature: {
      signThisFile: 'manifest.sha256',
      accepted: ['podpis kwalifikowany', 'pieczęć kwalifikowana', 'podpis osobisty (e-Dowód)', 'podpis zaufany (gov.pl) — do potwierdzenia prawnie'],
      note: 'Podpis składa dyrektor poza systemem. seal.json to pieczęć kluczem szkoły — dowód spójności, nie podpis w rozumieniu § 22.'
    }
  };
  const manifestJson = o.manifestJson || (JSON.stringify(manifest, null, 2) + '\n');
  const manifestSha256 = sha256(manifestJson);
  const manifestSum = `${manifestSha256}  manifest.json\n`;

  const seal = o.sealJson ? JSON.parse(o.sealJson) : Object.assign(
    require('./crypto').sealDocument(manifestJson, o.privateKey || cfg.schoolPrivateKey),
    { over: 'manifest.json', sealedAt: at, note: 'Pieczęć elektroniczna szkoły nad manifestem (prototyp). Dowód spójności pakietu — NIE jest podpisem ani pieczęcią kwalifikowaną w rozumieniu § 22.' }
  );
  const sealJson = o.sealJson || (JSON.stringify(seal, null, 2) + '\n');

  const entries = payload.map((f) => ({ name: f.name, content: f.content }))
    .concat([{ name: 'manifest.json', content: manifestJson }, { name: 'manifest.sha256', content: manifestSum }, { name: 'seal.json', content: sealJson }]);
  const files = entries.map((e) => ({ name: e.name, bytes: bytesOf(e.content), sha256: sha256(e.content) }));

  const z = D.tz(db);
  const zip = zipStore(entries, { date: U.localDate(at, z), time: U.localTime(at, z, true) });
  const zipName = `dziennik-${slug}-archiwum.zip`;
  const zipSha256 = sha256(zip);
  return {
    year: String(year), at, xml, html, files, manifest, manifestJson, manifestSha256, manifestSum,
    seal, sealJson, zip, zipName, zipSha256, bytes: zip.length,
    /* Skróty, o które da się zahaczyć podpis: „co dokładnie podpisano”. */
    digests: files.map((f) => ({ file: f.name, sha256: f.sha256 })).concat([{ file: 'package', sha256: zipSha256 }])
  };
}

/* ------------------------------------------------------------------ podpis zewnętrzny -----------
 * S3-08: „podpisany” ma znaczyć „skrót się zgadza”, a nie „coś przyszło”. Plik podpisu powstaje
 * POZA dziennikiem (gov.pl, e-Dowód, aplikacja dostawcy), więc jest wejściem z zewnątrz jak każde
 * inne: typ rozpoznajemy z bajtów, nie z nazwy, wielkość ma sens fizyczny (żaden podpis nie ma
 * 3 bajtów), a `contentBase64`, które nie jest napisem, jest błędem żądania, nie „pustym plikiem”.
 * S3-07: skanowanie pliku jest liniowe i ograniczone — złośliwy plik nie zatrzyma szkoły.
 */
const SIGNATURE_KINDS = ['xades', 'pades', 'zaufany', 'qualified', 'osobisty'];
const SIGNED_FILES = ['manifest.sha256', 'package'];
/** Najmniejszy podpis, jaki w ogóle istnieje: sam blok RSA-2048 to 256 bajtów. */
const SIGNATURE_MIN_BYTES = 256;
/** Po czym poznajemy typ pliku podpisu — allowlista walidatora załączników jest po stronie trasy. */
const SIGNATURE_TYPES = {
  '.xml': 'application/xml', '.xades': 'application/xml', '.xsig': 'application/xml',
  '.pdf': 'application/pdf', '.sig': 'application/octet-stream', '.p7s': 'application/pkcs7-signature',
  '.pkcs7': 'application/pkcs7-signature', '.cades': 'application/octet-stream', '.zip': 'application/zip'
};
function signatureType(name) {
  const m = /(\.[A-Za-z0-9]+)$/.exec(String(name || ''));
  return (m && SIGNATURE_TYPES[m[1].toLowerCase()]) || 'application/octet-stream';
}
/**
 * Typ rozpoznany z BAJTÓW, nie z nazwy (S3-08). Trzy rodziny, które podpis naprawdę może mieć:
 *   · PKCS#7/CMS w DER (CAdES, `.p7s`) — sekwencja ASN.1 z długością w postaci długiej: 30 8x …;
 *   · XML (XAdES, opakowanie gov.pl) — deklaracja `<?xml` lub wprost element `…Signature`;
 *   · PDF (PAdES) — `%PDF-`.
 * Cokolwiek innego (JPEG, ZIP, tekst) nie jest podpisem i nie wejdzie do pakietu archiwalnego.
 * @returns {{type:string, family:string, label:string}|null}
 */
function sniffSignature(buf) {
  const b = Buffer.isBuffer(buf) ? buf : Buffer.from(String(buf || ''), 'utf8');
  if (b.length >= 5 && b.slice(0, 5).toString('latin1') === '%PDF-') return { type: 'application/pdf', family: 'pades', label: 'PDF (PAdES)' };
  if (b.length >= 4 && b[0] === 0x30 && b[1] >= 0x80 && b[1] <= 0x84) return { type: 'application/pkcs7-signature', family: 'cades', label: 'PKCS#7/CMS w DER (CAdES)' };
  /* XML bywa z BOM-em i z białymi znakami na początku — patrzymy na pierwsze 2 kB, nie na cały plik. */
  let head = b.slice(0, 2048).toString('utf8');
  if (head.charCodeAt(0) === 0xfeff) head = head.slice(1);
  head = head.replace(/^\s+/, '');
  if (/^<\?xml[\s?]/.test(head) || /^<(?:[A-Za-z0-9_.-]+:)?Signature[\s>]/.test(head) || /^<(?:[A-Za-z0-9_.-]+:)?(?:XAdES|SignedDoc|AsicManifest)[\s>]/.test(head)) {
    return { type: 'application/xml', family: 'xades', label: 'XML (XAdES / XML-DSig)' };
  }
  return null;
}

const HEX64 = /^[0-9a-f]{64}$/i;
/** base64 → hex, gdy to naprawdę 32 bajty; w przeciwnym razie null. */
function b64ToSha256Hex(s) {
  const t = String(s || '').replace(/\s+/g, '');
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(t)) return null;
  const b = Buffer.from(t, 'base64');
  return b.length === 32 ? b.toString('hex') : null;
}
/** Ile pliku podpisu w ogóle oglądamy i ile dopasowań zbieramy — S3-07. */
const SCAN_BYTES = 256 * 1024;
const SCAN_MAX_HITS = 256;
/**
 * Co da się wyczytać z pliku podpisu **bez** udawania walidacji podpisu.
 *
 * S3-07: poprzednia wersja używała `matchAll` z leniwym `[\s\S]*?` i `[^>]*` po CAŁYM pliku, więc
 * 369 kB `"<Reference URI"` zajmowało 12–22 s w jednym wątku — cała szkoła stała. Teraz: jedno
 * liniowe przejście `indexOf` po pierwszych 256 kB, ciało skrótu czytane do najbliższego `<`
 * z twardym limitem długości, liczba dopasowań ograniczona. Żadnego nawrotu, żadnego cofania.
 * @returns {{xml:boolean, digests:string[] (hex), references:string[], truncated:boolean}}
 */
function readSignedDigests(buf) {
  const full = Buffer.isBuffer(buf) ? buf : Buffer.from(String(buf || ''), 'utf8');
  const truncated = full.length > SCAN_BYTES;
  const text = full.slice(0, SCAN_BYTES).toString('utf8');
  const xml = !!sniffSignature(full) && sniffSignature(full).family === 'xades';
  const digests = [], references = [];
  /* `<…DigestValue …>` → ciało do najbliższego `<`, najwyżej 200 znaków (skrót SHA-512 w base64
     ma 88). Jedno przejście, bez wyrażeń regularnych z nawrotami. */
  const scanTag = (tag, onHit) => {
    const needle = tag.toLowerCase();
    const lower = text.toLowerCase();
    let i = 0, hits = 0;
    while (hits < SCAN_MAX_HITS) {
      const at = lower.indexOf('<', i);
      if (at < 0) break;
      i = at + 1;
      /* Opcjonalny prefiks przestrzeni nazw: `ds:`, `xades:` … Szukamy dwukropka w oknie 32 znaków
         — `indexOf(':')` bez ograniczenia przeszukiwałby resztę pliku przy KAŻDYM `<`, co samo w
         sobie jest kwadratowe (plik `<a><a><a>…` bez ani jednego dwukropka). */
      const p = i;
      let colon = -1;
      for (let q = p, lim = Math.min(lower.length, p + 33); q < lim; q++) {
        const cc = lower[q];
        if (cc === ':') { colon = q; break; }
        if (!(cc >= 'a' && cc <= 'z') && !(cc >= '0' && cc <= '9') && cc !== '_' && cc !== '.' && cc !== '-') break;
      }
      const tagStart = colon > p ? colon + 1 : p;
      if (!lower.startsWith(needle, tagStart)) continue;
      const afterName = tagStart + needle.length;
      const ch = lower[afterName];
      if (ch !== '>' && ch !== ' ' && ch !== '\t' && ch !== '\n' && ch !== '\r' && ch !== '/') continue;
      const close = lower.indexOf('>', afterName);
      if (close < 0 || close - afterName > 4096) break;           // atrybut bez końca — dalej nie ma czego szukać
      hits++;
      onHit(text.slice(afterName, close), close + 1);
      i = close + 1;
    }
  };
  scanTag('digestvalue', (_attrs, from) => {
    const stop = text.indexOf('<', from);
    const raw = text.slice(from, stop < 0 ? Math.min(text.length, from + 200) : Math.min(stop, from + 200)).trim();
    const hex = HEX64.test(raw) ? raw.toLowerCase() : b64ToSha256Hex(raw);
    if (hex) digests.push(hex);
  });
  scanTag('reference', (attrs) => {
    const m = /\bURI\s*=\s*"([^"]{0,512})"/i.exec(attrs) || /\bURI\s*=\s*'([^']{0,512})'/i.exec(attrs);
    if (m) references.push(m[1]);
  });
  return { xml, digests: [...new Set(digests)], references: [...new Set(references)], truncated };
}
/**
 * Weryfikacja, do której naprawdę mamy podstawy.
 *   `digest-matched`     — w pliku podpisu jest skrót SHA-256 równy skrótowi naszego manifestu,
 *                          pliku `manifest.sha256` albo całego pakietu;
 *   `stored-unverified`  — plik przyjęliśmy i policzyliśmy jego własny skrót, ale nic w nim nie
 *                          wskazuje na nasz pakiet (PAdES, opakowanie gov.pl, surowe `.sig`).
 * Łańcucha certyfikatów, statusu OCSP/CRL, znacznika czasu ani ważności podpisu **nie sprawdzamy**.
 * @param {Buffer} content
 * @param {{digests:{file,sha256}[]}} pkg
 */
function verifySignature(content, pkg) {
  const read = readSignedDigests(content);
  const known = new Map();
  for (const d of (pkg && pkg.digests) || []) known.set(String(d.sha256).toLowerCase(), d.file);
  const matched = read.digests.map((h) => (known.has(h) ? { file: known.get(h), sha256: h } : null)).filter(Boolean);
  return {
    verification: matched.length ? 'digest-matched' : 'stored-unverified',
    attests: matched.length > 0,
    matched, digestsFound: read.digests.length, references: read.references, parsedAsXml: read.xml, scanTruncated: read.truncated,
    checks: { digest: matched.length ? 'ok' : 'nie znaleziono naszego skrótu w pliku podpisu', certificateChain: 'nie sprawdzamy', revocation: 'nie sprawdzamy', timestamp: 'nie sprawdzamy' },
    note: 'Dziennik nie jest usługą zaufania: sprawdzamy wyłącznie, czy podpisany skrót pasuje do pakietu. Ważności podpisu, łańcucha certyfikatów ani znacznika czasu nie weryfikujemy.'
  };
}

/**
 * Stan pakietu względem § 22 — jedno miejsce, z którego czytają trasa, przypomnienia i ekran.
 *   `none`                 — podpisu nie ma;
 *   `signed`               — skrót z pliku podpisu pasuje do pakietu (`digest-matched`);
 *   `accepted-unverified`  — dyrektor odnotował „przyjmuję bez weryfikacji” z uzasadnieniem (audyt);
 *   `stored-unverified`    — plik leży, ale niczego nie potwierdza — przypomnienie z § 22 NIE milknie.
 */
function signatureState(a) {
  const sig = a && a.signature;
  if (!sig) return 'none';
  /* H-9: rocznik przebudowany po podpisaniu. Podpis jest nadal prawdziwy i nadal zgodny — tylko
     dotyczy poprzedniej wersji pakietu, więc terminu już nie zamyka. Mówimy to wprost. */
  if (a.superseded || sig.superseded) return 'superseded';
  if (sig.verification === 'digest-matched') return 'signed';
  if (sig.accepted && sig.accepted.at) return 'accepted-unverified';
  return 'stored-unverified';
}
/** Czy ten pakiet zamyka termin z § 22. „Przyjęty, niezweryfikowany” sam z siebie go NIE zamyka. */
const closesDeadline = (a) => { const st = signatureState(a); return st === 'signed' || st === 'accepted-unverified'; };
/**
 * Czy pod tym pakietem leży podpis, za który ktoś wziął odpowiedzialność — zgodny skrót albo
 * odnotowane przyjęcie bez weryfikacji. Także wtedy, gdy rocznik przebudowano: takiego pakietu
 * nie wolno skasować, bo to jedyny ślad po tym, co dyrektor wtedy podpisał.
 */
const attested = (a) => { const sig = a && a.signature; return !!sig && (sig.verification === 'digest-matched' || !!(sig.accepted && sig.accepted.at)); };

module.exports = {
  buildArchive, archiveXml, archiveHtml, buildArchivePackage, collectionCounts,
  schoolYearRange, rowYearDate, inYear,
  zipStore, crc32, dosStamp, sha256, safeFileName, yearSlug,
  readSignedDigests, verifySignature, sniffSignature, signatureType, signatureState, closesDeadline, attested,
  SIGNATURE_KINDS, SIGNED_FILES, SIGNATURE_MIN_BYTES, ATTENDANCE_CODES, GRADE_KINDS, SOFTWARE
};
