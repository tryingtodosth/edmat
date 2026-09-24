'use strict';
/* R2/R3 — roczny pakiet archiwalny jako plik do podpisania (§ 22 rozporządzenia o dokumentacji).
   Co tu jest sprawdzane: pakiet ZIP daje się rozpakować z powrotem (CRC, rozmiary, katalog
   centralny), manifest mówi prawdę o zawartości, **pakiet jest dziennikiem** (lekcje z tematem i
   obecnością każdego ucznia, uwagi, oceny opisowe, zachowanie, usprawiedliwienia, świadectwa) i
   **jest przypisany do rocznika** (ocena z poprzedniego roku szkolnego w nim nie leży), bajty leżą
   na dysku, a nie w kolekcji, podpis złożony poza dziennikiem jest przyjmowany i opisywany
   uczciwie („skrót się zgadza” vs „przyjęty, niezweryfikowany” — i to drugie NIE ucisza terminu),
   termin z § 22 zmienia status na granicy 10 dni **od 31 sierpnia**, przypomnienia idą przez
   `D.notify`, a `…/verify` niczego nie zapisuje.
   Opis pakietu i otwarte pytanie prawne: docs/ARCHIVE.md. */
const { test } = require('node:test');
const assert = require('node:assert');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { startServer, expectOk, fixtures, withConfig } = require('./helpers');
const C = require('../server/lib/crypto');
const AR = require('../server/lib/archive');
const B = require('../server/lib/blobs');

let S, P;
test.before(async () => { S = await startServer(); P = await S.as('dyrektor'); });
test.after(() => S.close());

const need = fixtures();

/* Kilka wierszy, których zasiew demo nie ma, a które dziennik MUSI umieć zarchiwizować: ocena
   opisowa (klasy I–III) i ocena z POPRZEDNIEGO roku szkolnego, która w pakiecie leżeć nie może. */
const OLD_GRADE_ID = 't52_grade_2025_2026';
const DESC_ID = 't52_desc_kowalczyk';
const CERT_ID = 't52_cert_2026_2027';
const seeded = () => need('seeded', async () => {
  S.db.insert('reportCardHistory', { id: CERT_ID, studentId: 'st_kowalczyk_anna', schoolYear: '2026/2027', className: '7b',
    schoolName: 'Szkoła Podstawowa nr 1', grades: [{ subjectId: 'mat', value: '5' }, { subjectId: 'pol', value: '4' }],
    behavior: 'wzorowe', note: null, source: 'classification', byUserId: 'u_nowak', at: '2027-06-20T10:00:00Z' });
  S.db.insert('descriptiveGrades', { id: DESC_ID, studentId: 'st_kowalczyk_anna', semester: 1, area: 'Edukacja polonistyczna',
    text: 'Czyta ze zrozumieniem teksty na poziomie klasy, wypowiada się pełnymi zdaniami.', phraseIds: [], teacherId: 'u_sikora', at: '2026-10-20T10:00:00Z' });
  S.db.insert('grades', { id: OLD_GRADE_ID, studentId: 'st_kowalczyk_anna', subjectId: 'mat', classId: '7b', categoryName: 'Sprawdzian',
    weight: 3, value: '2', date: '2026-05-12', teacherId: 'u_nowak', kind: 'partial', semester: 2, deleted: false, countsInAverage: true });
  return true;
});
/* Rocznik wygenerowany poza oknem (demo stoi na 23.10.2026) — jeden na cały plik. */
const built = () => need('archive', async () => {
  await seeded();
  return expectOk(await P.post('/api/principal/archive', { year: '2026/2027', force: true, reason: 'Test pakietu archiwalnego' }));
});
const downloaded = () => need('zip', async () => {
  const pkg = await built();
  const res = await P.get('/api/principal/archive/' + pkg.id + '/package');
  assert.equal(res.status, 200, 'pakiet się pobiera');
  return { pkg, res, zip: res.body, entries: unzip(res.body) };
});

const sha256 = (b) => crypto.createHash('sha256').update(b).digest('hex');
const b64sha256 = (b) => crypto.createHash('sha256').update(b).digest('base64');
/** Plik podpisu, który przechodzi przez sniffer i przez minimalny rozmiar — jak każdy prawdziwy. */
function xadesOver(digestB64, uri) {
  return `<?xml version="1.0" encoding="UTF-8"?>
<ds:Signature xmlns:ds="http://www.w3.org/2000/09/xmldsig#"><ds:SignedInfo>
  <ds:Reference URI="${uri || 'manifest.sha256'}">
    <ds:DigestMethod Algorithm="http://www.w3.org/2001/04/xmlenc#sha256"/>
    <ds:DigestValue>${digestB64}</ds:DigestValue>
  </ds:Reference>
</ds:SignedInfo><ds:SignatureValue>${Buffer.alloc(200, 0x41).toString('base64')}</ds:SignatureValue></ds:Signature>`;
}

/** Czytnik ZIP napisany od zera: katalog centralny, nagłówki lokalne i dane, bez żadnej biblioteki. */
function unzip(buf) {
  assert.ok(Buffer.isBuffer(buf), 'odpowiedź przyszła jako bajty, nie jako tekst');
  let e = buf.length - 22;
  while (e >= 0 && buf.readUInt32LE(e) !== 0x06054b50) e--;
  assert.ok(e >= 0, 'jest stopka katalogu centralnego (EOCD)');
  const count = buf.readUInt16LE(e + 10);
  assert.equal(buf.readUInt16LE(e + 8), count, 'liczba wpisów na dysku = liczba wpisów łącznie');
  const cdSize = buf.readUInt32LE(e + 12), cdOff = buf.readUInt32LE(e + 16);
  const out = []; let p = cdOff;
  for (let i = 0; i < count; i++) {
    assert.equal(buf.readUInt32LE(p), 0x02014b50, 'sygnatura wpisu katalogu centralnego');
    const flags = buf.readUInt16LE(p + 8), method = buf.readUInt16LE(p + 10);
    const time = buf.readUInt16LE(p + 12), date = buf.readUInt16LE(p + 14);
    const crc = buf.readUInt32LE(p + 16), csize = buf.readUInt32LE(p + 20), usize = buf.readUInt32LE(p + 24);
    const nlen = buf.readUInt16LE(p + 28), elen = buf.readUInt16LE(p + 30), clen = buf.readUInt16LE(p + 32);
    const lho = buf.readUInt32LE(p + 42);
    const name = buf.slice(p + 46, p + 46 + nlen).toString('utf8');
    assert.equal(buf.readUInt32LE(lho), 0x04034b50, 'sygnatura nagłówka lokalnego ' + name);
    const lnlen = buf.readUInt16LE(lho + 26), lelen = buf.readUInt16LE(lho + 28);
    assert.equal(buf.slice(lho + 30, lho + 30 + lnlen).toString('utf8'), name, 'nazwa w nagłówku lokalnym = nazwa w katalogu');
    assert.equal(buf.readUInt32LE(lho + 14), crc, 'CRC w nagłówku lokalnym = CRC w katalogu (' + name + ')');
    const start = lho + 30 + lnlen + lelen;
    out.push({ name, flags, method, crc, csize, usize, time, date, content: buf.slice(start, start + csize) });
    p += 46 + nlen + elen + clen;
  }
  assert.equal(p - cdOff, cdSize, 'katalog centralny ma zapowiedzianą długość');
  return out;
}

/* ---------------------------------------------------------------- zapis ZIP ------------------- */

test('archive: the zip writer round-trips — stored entries, real CRC-32, UTF-8 names', () => {
  /* CRC-32 policzony osobno: znana wartość dla „hello” i zgodność z tym, co ląduje w nagłówku. */
  assert.equal(AR.crc32(Buffer.from('hello')).toString(16), '3610a686');
  assert.equal(AR.crc32(Buffer.alloc(0)), 0);

  const zip = AR.zipStore([
    { name: 'manifest.json', content: '{"a":1}\n' },
    { name: 'oceny-końcowe.xml', content: '<x>ą</x>' },
    { name: 'pusty.txt', content: '' }
  ], { date: '2027-06-25', time: '13:45:07' });
  const entries = unzip(zip);
  assert.deepEqual(entries.map((x) => x.name), ['manifest.json', 'oceny-końcowe.xml', 'pusty.txt']);
  for (const x of entries) {
    assert.equal(x.method, 0, 'metoda „stored” — nic nie jest kompresowane');
    assert.equal(x.flags & 0x0800, 0x0800, 'bit 11 flagi: nazwa w UTF-8');
    assert.equal(x.csize, x.usize, 'rozmiar spakowany = rozmiar pliku');
    assert.equal(AR.crc32(x.content), x.crc, 'CRC-32 policzone z odczytanych bajtów zgadza się z zapisanym');
  }
  assert.equal(entries[1].content.toString('utf8'), '<x>ą</x>', 'polskie znaki przeżywają round-trip');
  assert.equal(entries[2].usize, 0, 'pusty plik ma zerowy rozmiar i zerowe CRC');
  /* Znacznik czasu w formacie DOS — z lokalnej daty szkoły, z rozdzielczością 2 sekund. */
  const st = AR.dosStamp('2027-06-25', '13:45:07');
  assert.equal(entries[0].date, st.date); assert.equal(entries[0].time, st.time);
  assert.equal((st.date >> 9) + 1980, 2027); assert.equal((st.date >> 5) & 0x0f, 6); assert.equal(st.date & 0x1f, 25);
  assert.equal(st.time >> 11, 13); assert.equal((st.time >> 5) & 0x3f, 45); assert.equal((st.time & 0x1f) * 2, 6);
});

/* ---------------------------------------------------------------- pakiet ----------------------- */

test('archive: the package builds and parses back with the manifest hashes matching the files', async () => {
  const { pkg, res, entries } = await downloaded();
  assert.match(res.headers.get('content-type'), /application\/zip/);
  assert.match(res.headers.get('content-disposition'), /^attachment; filename="dziennik-2026-2027-archiwum\.zip"/, 'nazwa pliku bezpieczna dla nagłówka');

  const byName = new Map(entries.map((x) => [x.name, x.content]));
  assert.deepEqual([...byName.keys()].sort(), ['dziennik-2026-2027.html', 'dziennik-2026-2027.xml', 'manifest.json', 'manifest.sha256', 'seal.json']);

  const manifest = JSON.parse(byName.get('manifest.json').toString('utf8'));
  assert.equal(manifest.format, 'edmat-archive/1');
  assert.equal(manifest.year, '2026/2027');
  assert.equal(manifest.hashAlgorithm, 'sha256');
  assert.equal(manifest.generatedAt, pkg.at, 'manifest niesie czas wygenerowania pakietu');
  assert.equal(manifest.school.rspo, S.db.data.config.school.rspo);
  assert.equal(manifest.software.name, 'EdMat');
  assert.ok(manifest.software.version, 'manifest mówi, która wersja oprogramowania to zapisała');
  assert.equal(manifest.signature.signThisFile, 'manifest.sha256');

  /* Skróty z manifestu policzone jeszcze raz z bajtów wyjętych z ZIP-a. */
  assert.deepEqual(manifest.files.map((f) => f.name).sort(), ['dziennik-2026-2027.html', 'dziennik-2026-2027.xml']);
  for (const f of manifest.files) {
    const content = byName.get(f.name);
    assert.equal(content.length, f.bytes, 'rozmiar ' + f.name);
    assert.equal(sha256(content), f.sha256, 'SHA-256 ' + f.name);
  }
  /* Liczności kolekcji: manifest mówi, co pakiet obejmuje. */
  assert.equal(manifest.collections.students, S.db.col('students').length);
  assert.equal(manifest.collections.grades, S.db.col('grades').length);

  /* manifest.sha256 to jedna linia w formacie sha256sum — to ją podpisuje dyrektor. */
  const sum = byName.get('manifest.sha256').toString('utf8');
  assert.equal(sum, sha256(byName.get('manifest.json')) + '  manifest.json\n');

  /* Pieczęć szkoły stoi nad manifestem i weryfikuje się kluczem publicznym szkoły. */
  const seal = JSON.parse(byName.get('seal.json').toString('utf8'));
  assert.equal(seal.over, 'manifest.json');
  assert.equal(seal.alg, 'RSA-SHA256');
  assert.equal(seal.digest, sha256(byName.get('manifest.json')));
  assert.equal(C.verifySeal(byName.get('manifest.json').toString('utf8'), seal, S.db.data.config.schoolPublicKey), true);
  assert.match(seal.note, /NIE jest podpisem/i, 'pieczęć sama mówi, że nie jest podpisem z § 22');

  /* XML w pakiecie to ten sam eksport § 21, który wydaje GET …/xml. */
  const xml = await P.get('/api/principal/archive/' + pkg.id + '/xml');
  assert.equal(byName.get('dziennik-2026-2027.xml').toString('utf8'), xml.body);
  assert.match(byName.get('dziennik-2026-2027.html').toString('utf8'), /Pakiet archiwalny dziennika/);
});

/* ------------------------------------------------- D3-19/D3-20: pakiet JEST dziennikiem -------- */

test('archive: the XML is the logbook — lessons with topics, per-pupil attendance, remarks, descriptive and behaviour grades', async () => {
  const { pkg } = await downloaded();
  const xml = (await P.get('/api/principal/archive/' + pkg.id + '/xml')).body;

  /* Korzeń i kształt, na którym opiera się [3.3.17], zostają nietknięte. */
  assert.match(xml, /^<\?xml version="1\.0" encoding="UTF-8"\?>\n<DziennikElektroniczny rok="2026\/2027" /, 'korzeń dokumentu bez zmian');
  assert.match(xml, /<Klasa id="7b"/); assert.match(xml, /<Uczen id="st_kowalczyk_anna"/);
  assert.match(xml, /<Oceny liczba=/); assert.match(xml, /<Frekwencja wpisow=/);

  /* Zakres rocznika stoi w dokumencie — czytelnik nie musi go zgadywać (D3-20). */
  const range = AR.schoolYearRange(S.db, '2026/2027');
  assert.equal(range.from, '2026-09-01'); assert.equal(range.to, '2027-08-31', 'rok szkolny trwa do 31 sierpnia');
  assert.ok(xml.includes(`odDnia="${range.from}" doDnia="${range.to}"`), 'XML mówi, jaki zakres dat obejmuje');
  assert.match(xml, /<Semestry>[\s\S]*<Semestr id="1" [^>]*od="2026-09-01"/, 'semestry z datami — po nich czytelnik rozdziela roczniki');

  /* D3-25: słowniki, żeby `przedmiot="mat"` i `status="nb"` dały się odczytać bez kodu źródłowego. */
  assert.match(xml, /<Przedmiot id="mat" nazwa="Matematyka"\/>/);
  assert.match(xml, /<Status id="nb" opis="nieobecny nieusprawiedliwiony"\/>/);
  assert.equal(/<Obecnosc [^>]*opis=/.test(xml), false, 'opis statusu stoi raz w słowniku, nie przy każdym z setek tysięcy wpisów');
  assert.match(xml, /<Rodzaj id="final" opis="ocena roczna \(klasyfikacyjna\)"\/>/);

  /* Przebieg zajęć: konkretna lekcja z zasiewu, z tematem i z obecnością KAŻDEGO ucznia. */
  const lesson = S.db.col('lessons').find((l) => l.classId === '7b' && l.topic && S.db.col('attendance').some((a) => a.lessonId === l.id));
  assert.ok(lesson, 'zasiew ma lekcję 7b z tematem i z frekwencją');
  const block = xml.slice(xml.indexOf(`<Lekcja id="${lesson.id}"`));
  assert.ok(block.startsWith(`<Lekcja id="${lesson.id}"`), 'lekcja jest w pakiecie: ' + lesson.id);
  const lessonXml = block.slice(0, block.indexOf('</Lekcja>'));
  assert.ok(lessonXml.includes(`data="${lesson.date}"`) && lessonXml.includes(`nrLekcji="${lesson.lessonNo}"`), 'data i numer lekcji');
  assert.ok(lessonXml.includes(`przedmiot="${lesson.subjectId}"`), 'przedmiot lekcji');
  assert.ok(lessonXml.includes('nauczyciel="'), 'nauczyciel prowadzący');
  assert.ok(lessonXml.includes(`<Temat>${lesson.topic}</Temat>`), 'temat lekcji — bez niego to nie jest dziennik');
  const perLesson = S.db.col('attendance').filter((a) => a.lessonId === lesson.id && !a.draft);
  assert.ok(perLesson.length >= 3, 'lekcja ma frekwencję kilku uczniów');
  for (const a of perLesson) {
    assert.ok(lessonXml.includes(`<Obecnosc uczen="${a.studentId}" status="${a.status}"`), `obecność ${a.studentId} przy lekcji`);
  }
  assert.ok(lessonXml.includes(`<Frekwencja wpisow="${perLesson.length}">`), 'liczba wpisów frekwencji przy lekcji');

  /* Uwaga, ocena opisowa, zachowanie, usprawiedliwienie, świadectwo — po jednym prawdziwym wierszu. */
  const remark = S.db.col('remarks').find((r) => r.studentId === 'st_kowalczyk_anna' && !r.deleted);
  assert.ok(xml.includes(`<Uwaga data="${remark.date}" rodzaj="${remark.kind}"`), 'uwaga jest w pakiecie');
  assert.ok(xml.includes(remark.text.slice(0, 40)), 'treść uwagi jest w pakiecie');
  const desc = S.db.get('descriptiveGrades', DESC_ID);
  assert.ok(xml.includes(`<OcenaOpisowa semestr="${desc.semester}" obszar="${desc.area}"`), 'ocena opisowa jest w pakiecie');
  assert.ok(xml.includes('Czyta ze zrozumieniem'), 'treść oceny opisowej jest w pakiecie');
  const beh = S.db.col('behaviorGrades').find((b) => b.studentId === 'st_kowalczyk_anna');
  assert.ok(xml.includes(`<OcenaZachowania semestr="${beh.semester}" rodzaj="${beh.kind}"`), 'ocena zachowania jest w pakiecie');
  const exc = S.db.col('excuses').find((e) => e.studentId === 'st_kowalczyk_anna');
  assert.ok(xml.includes(`<Usprawiedliwienie od="${exc.from}" do="${exc.to}"`), 'usprawiedliwienie jest w pakiecie');
  const cert = S.db.get('reportCardHistory', CERT_ID);
  assert.ok(xml.includes(`<Swiadectwo rok="2026/2027" klasa="7b"`), 'dane świadectwa tego rocznika są w pakiecie');
  assert.ok(xml.includes('<OcenaSwiadectwa przedmiot="mat">5</OcenaSwiadectwa>'), 'oceny ze świadectwa tak, jak wydrukowane');
  assert.ok(xml.includes(`zachowanie="${cert.behavior}"`), 'ocena zachowania ze świadectwa');
  const oldCert = S.db.col('reportCardHistory').find((hh) => hh.schoolYear === '2025/2026');
  assert.equal(xml.includes('<Swiadectwo rok="2025/2026"'), false, 'świadectwo z poprzedniego rocznika nie wchodzi do tego pakietu');
  assert.ok(oldCert, 'zasiew ma świadectwo z 2025/2026, więc filtr naprawdę coś odcina');
  /* Księga uczniów: data i miejsce urodzenia, których do R3 w pakiecie nie było. */
  const anna = S.db.get('students', 'st_kowalczyk_anna');
  assert.ok(xml.includes(`dataUrodzenia="${anna.birthDate}" miejsceUrodzenia="${anna.birthPlace}"`), 'dane z księgi uczniów');

  /* D3-20: ocena z POPRZEDNIEGO roku szkolnego nie może wejść do tego pakietu. */
  const old = S.db.get('grades', OLD_GRADE_ID);
  assert.equal(old.date, '2026-05-12');
  assert.equal(xml.includes(`data="${old.date}"`), false, 'ocena z 2025/2026 nie leży w pakiecie 2026/2027');
  const thisYear = S.db.col('grades').find((g) => g.studentId === 'st_kowalczyk_anna' && g.date >= '2026-09-01' && !g.deleted);
  assert.ok(xml.includes(`data="${thisYear.date}"`), 'ocena z tego rocznika leży w pakiecie');
  /* A filtr jest rzeczywisty także na poziomie biblioteki, nie tylko w tym jednym XML-u. */
  assert.equal(AR.inYear(old, range, '2026/2027'), false);
  assert.equal(AR.inYear(thisYear, range, '2026/2027'), true);
  assert.equal(AR.inYear({ schoolYear: '2025/2026' }, range, '2026/2027'), false, 'świadectwo datuje się polem schoolYear');
});

test('archive: the downloaded file is exactly the one the record describes, twice over', async () => {
  const { pkg, zip } = await downloaded();
  assert.equal(pkg.package.sha256, sha256(zip), 'skrót zapisany przy generowaniu = skrót pobranego pliku');
  assert.equal(pkg.package.bytes, zip.length);
  assert.equal(pkg.package.name, 'dziennik-2026-2027-archiwum.zip');
  const again = await P.get('/api/principal/archive/' + pkg.id + '/package');
  assert.equal(sha256(again.body), sha256(zip), 'pakiet odtwarza się bajt w bajt przy każdym pobraniu');
  const listed = expectOk(await P.get('/api/principal/archive')).packages.find((x) => x.id === pkg.id);
  assert.equal(listed.package.sha256, sha256(zip));
  assert.equal(listed.package.manifestSha256, pkg.package.manifestSha256);
  const audit = S.db.col('audit').filter((a) => a.action === 'archive_exported' && a.after && a.after.format === 'zip');
  assert.ok(audit.length >= 1, 'pobranie pakietu zostawia wpis w rejestrze audytowym');
});

/* ------------------------------------------------- R3-09/R3-13: bajty leżą na dysku ------------ */

test('archive: the bytes live on disk and the row carries a descriptor, never base64', async () => {
  const { pkg, zip } = await downloaded();
  const row = S.db.get('archives', pkg.id);

  /* Wiersz jest opisem pakietu, nie pakietem. */
  assert.equal(row.xml, undefined, 'XML nie leży w kolekcji');
  assert.equal(row.html, undefined, 'wydruk nie leży w kolekcji');
  assert.equal(row.package.manifestJson, undefined);
  assert.equal(row.package.sealJson, undefined);
  const serialised = JSON.stringify(row);
  assert.ok(serialised.length < 8 * 1024, 'wiersz mieści się w kilku kilobajtach, a nie w megabajtach (' + serialised.length + ' B)');
  assert.equal(/[A-Za-z0-9+/]{2000,}/.test(serialised), false, 'w wierszu nie ma bloku base64');

  /* Opis niesie dokładnie cztery pola i wskazuje na plik, który naprawdę istnieje. */
  for (const key of ['xml', 'html', 'manifest', 'seal', 'zip']) {
    const ref = row.files[key];
    assert.deepEqual(Object.keys(ref).sort(), ['bytes', 'name', 'path', 'sha256'], key + ': { name, bytes, sha256, path }');
    assert.match(ref.path, new RegExp('^files/archives/' + pkg.id + '/[A-Za-z0-9._-]+$'), key + ': ścieżka pod katalogiem wiersza');
    assert.equal(B.has(S.db, ref), true, key + ': plik leży na dysku');
    assert.equal(B.sha256Of(S.db, ref), ref.sha256, key + ': skrót z dysku = skrót z wiersza');
    assert.equal(fs.statSync(B.absPath(S.db, ref)).size, ref.bytes, key + ': rozmiar z dysku = rozmiar z wiersza');
  }
  assert.equal(row.files.zip.sha256, sha256(zip), 'ZIP na dysku to ten sam plik, który pobiera dyrektor');
  assert.equal(row.bytes, row.files.xml.bytes);
  const onDisk = B.list(S.db, 'archives', pkg.id).map((f) => f.name).sort();
  assert.deepEqual(onDisk, ['dziennik-2026-2027-archiwum.zip', 'dziennik-2026-2027.html', 'dziennik-2026-2027.xml', 'manifest.json', 'seal.json']);

  /* Ścieżka nigdy nie pochodzi z wejścia użytkownika poza [A-Za-z0-9._-]. */
  assert.throws(() => B.put(S.db, 'archives', '../../etc', 'x', 'y'), /Niedozwolona nazwa/);
  assert.throws(() => B.absPath(S.db, { path: 'files/archives/id/../../../etc/passwd' }), /nieznana ścieżka|Niedozwolona/);
  assert.equal(B.put(S.db, 'archives', pkg.id, '../../../evil.sh', 'x').path, 'files/archives/' + pkg.id + '/evil.sh');
  B.del(S.db, 'archives', pkg.id, 'evil.sh');
});

test('archive: a pre-R3 row with the bytes inline is migrated to disk on the first read', async () => {
  const at = '2026-10-23T08:00:00Z';
  const inline = AR.buildArchivePackage(S.db, '2026/2027', { at });
  const sig = Buffer.from(xadesOver(b64sha256(Buffer.from(inline.manifestSum, 'utf8'))), 'utf8');
  /* Dokładnie taki wiersz, jaki pisała trasa przed R3: wszystko w kolekcji, podpis w base64. */
  const row = S.db.insert('archives', {
    year: '2026/2027', at, byUserId: P.user.id, forced: true, forceNote: 'stary wiersz',
    xml: inline.xml, html: inline.html, seal: C.sealDocument(inline.xml, S.db.data.config.schoolPrivateKey), bytes: Buffer.byteLength(inline.xml, 'utf8'),
    package: { name: inline.zipName, bytes: inline.bytes, sha256: inline.zipSha256, manifestSha256: inline.manifestSha256, manifestJson: inline.manifestJson, sealJson: inline.sealJson, files: inline.files, at },
    signature: { name: 'podpis-stary.xml', type: 'application/xml', bytes: sig.length, sha256: sha256(sig), contentBase64: sig.toString('base64'),
      kind: 'zaufany', signedFile: 'manifest.sha256', at, by: P.user.id, byName: 'Dyrektor', verification: 'digest-matched', matched: [{ file: 'manifest.sha256', sha256: 'x' }], checks: {}, note: '' }
  });
  try {
    assert.ok(row.xml, 'przed migracją XML jest w kolekcji');
    expectOk(await P.get('/api/principal/archive'));                       // pierwszy odczyt migruje
    const after = S.db.get('archives', row.id);
    assert.equal(after.xml, undefined, 'po migracji XML zniknął z kolekcji');
    assert.equal(after.html, undefined);
    assert.equal(after.package.manifestJson, undefined);
    assert.equal(after.signature.contentBase64, undefined, 'podpis też zszedł na dysk');
    assert.ok(after.migratedAt, 'wiersz mówi, kiedy go przeniesiono');
    for (const key of ['xml', 'html', 'manifest', 'seal', 'zip']) assert.equal(B.has(S.db, after.files[key]), true, key + ' na dysku po migracji');
    assert.equal(B.sha256Of(S.db, after.files.xml), sha256(Buffer.from(inline.xml, 'utf8')), 'przeniesione bajty to te same bajty');
    assert.equal(after.signature.sha256, sha256(sig));
    assert.equal(B.sha256Of(S.db, after.signature), sha256(sig), 'plik podpisu na dysku to ten sam plik');

    /* Pakiet i podpis dalej się pobierają — migracja jest niewidoczna dla dyrektora. */
    const zip = await P.get('/api/principal/archive/' + row.id + '/package');
    assert.equal(zip.status, 200); assert.equal(sha256(zip.body), inline.zipSha256, 'ZIP z odtworzonych składników ma ten sam skrót');
    const dl = await P.get('/api/principal/archive/' + row.id + '/signature');
    assert.equal(dl.status, 200);
    assert.equal(sha256(Buffer.isBuffer(dl.body) ? dl.body : Buffer.from(dl.body, 'utf8')), sha256(sig));
  } finally {
    B.del(S.db, 'archives', row.id);
    S.db.remove('archives', row.id);
  }
});

/* ---------------------------------------------------------------- termin z § 22 ---------------- */

test('archive: the deadline is ten days after 31 August and the status turns over on that boundary', async () => {
  /* Zbudowany po to, żeby ten test nie zależał od kolejności: własny serwer, własny pakiet.
     Wcześniej ta asercja przechodziła tylko dlatego, że testy podpisu stały niżej w pliku. */
  const own = await startServer();
  try {
    const p = await own.as('dyrektor');
    const cfg = own.db.data.config;

    const blank = expectOk(await p.get('/api/principal/archive')).window;
    assert.equal(blank.status, 'not-started', 'świeża instalacja: rocznik bez pakietu');
    assert.equal(blank.packageId, null);
    assert.equal(blank.signed, false);
    assert.equal(blank.teachingEnd, cfg.semesters[cfg.semesters.length - 1].to, 'zajęcia kończą się 25.06.2027');
    assert.equal(blank.from, '2027-06-25', 'najwcześniejszy dzień, w którym pakiet ma sens');
    assert.equal(blank.yearEnd, '2027-08-31', '§ 22 liczy od zakończenia ROKU SZKOLNEGO, nie zajęć');
    assert.equal(blank.deadline, '2027-09-10', '31 sierpnia + 10 dni');
    assert.equal(blank.days, 10);
    assert.equal(blank.daysLeft, 322, 'z dnia demo (23.10.2026) do 10.09.2027 jest 322 dni');
    assert.equal(blank.open, false);
    assert.equal(blank.notYetOpen, true, 'okno się jeszcze nie otworzyło — to nie to samo, co „po terminie”');
    assert.match(blank.basis, /roku szkolnego \(31 sierpnia\)/);

    const closed = await p.post('/api/principal/archive', { year: '2026/2027' });
    assert.equal(closed.status, 403); assert.equal(closed.body.code, 'window_closed');
    assert.match(closed.body.error, /Okno na pakiet archiwalny otwiera się 2027-06-25/, 'komunikat mówi, że okno się jeszcze nie otworzyło');

    const pkg = expectOk(await p.post('/api/principal/archive', { year: '2026/2027', force: true, reason: 'test granicy terminu' }));
    const ready = expectOk(await p.get('/api/principal/archive')).window;
    assert.equal(ready.status, 'package-ready');
    assert.equal(ready.packageId, pkg.id);

    /* Obie strony granicy, na pakiecie, o którym ten test wie wszystko. */
    for (const [today, open, daysLeft, status] of [['2027-06-24', false, 78, 'package-ready'], ['2027-06-25', true, 77, 'package-ready'],
      ['2027-09-10', true, 0, 'package-ready'], ['2027-09-11', false, -1, 'overdue']]) {
      await withConfig(own.db, { today }, async () => {
        const w = expectOk(await p.get('/api/principal/archive')).window;
        assert.equal(w.open, open, today + ': okno');
        assert.equal(w.daysLeft, daysLeft, today + ': dni do terminu');
        assert.equal(w.status, status, today + ': status');
      });
    }
    /* Po terminie komunikat jest inny niż przed otwarciem okna (U3-06 po stronie serwera). */
    await withConfig(own.db, { today: '2027-09-11' }, async () => {
      const w = expectOk(await p.get('/api/principal/archive')).window;
      assert.equal(w.notYetOpen, false);
      const late = await p.post('/api/principal/archive', { year: '2026/2027' });
      assert.equal(late.status, 403);
      assert.match(late.body.error, /Termin z § 22 .* minął 2027-09-10/);
      /* S3-13: poza terminem zawsze z uzasadnieniem, i okno zostaje w wierszu. */
      const noReason = await p.post('/api/principal/archive', { year: '2026/2027', force: true });
      assert.equal(noReason.status, 400); assert.equal(noReason.body.code, 'no_reason');
      const forced = expectOk(await p.post('/api/principal/archive', { year: '2026/2027', force: true, reason: 'egzamin poprawkowy 30.08' }));
      assert.equal(forced.forced, true);
      assert.match(forced.forceNote, /poza ustawowym terminem/);
      assert.equal(own.db.get('archives', forced.id).window.to, '2027-09-10', 'wiersz pamięta okno, które wtedy obowiązywało');
      assert.equal(own.db.get('archives', forced.id).window.yearEnd, '2027-08-31');
      const a = own.db.col('audit').filter((x) => x.action === 'archive_generated').pop();
      assert.equal(a.after.window.to, '2027-09-10', 'rejestr audytowy też pamięta okno');
      assert.match(a.reason, /egzamin poprawkowy/);
    });
    /* S3-09: rok idzie w nazwę pliku i w nagłówek — jeden kształt, bez wyjątków. */
    for (const bad of ['x"; filename="oceny-7b.html', '2026/2027\r\nX: y', 'A'.repeat(200), '2026-2027']) {
      const r = await p.post('/api/principal/archive', { year: bad, force: true, reason: 'test' });
      assert.equal(r.status, 400, 'odrzucony rok: ' + JSON.stringify(bad).slice(0, 40));
      assert.equal(r.body.code, 'bad_year');
    }
  } finally { own.close(); }
});

test('archive: the principal is reminded on day 3 and day 8 after 31 August, through the notification gate, once each', async () => {
  await built();
  const mine = () => S.db.col('notifications').filter((n) => n.kind === 'archive' && n.userId === P.user.id);
  for (const n of mine()) S.db.remove('notifications', n.id);            // czysty start, niezależnie od kolejności testów
  const before = mine().length;

  await withConfig(S.db, { today: '2027-09-02' }, async () => {          // koniec roku + 2 — jeszcze cisza
    expectOk(await P.get('/api/principal/archive'));
    assert.equal(mine().length, before, 'w drugim dniu nic nie przypominamy');
  });
  await withConfig(S.db, { today: '2027-09-03' }, async () => {          // + 3
    expectOk(await P.get('/api/principal/archive'));
    expectOk(await P.get('/api/principal/archive'));                     // drugie wejście na ekran
    const ns = mine();
    assert.equal(ns.length, before + 1, 'przypomnienie z 3. dnia leci raz, deduplikacja po dedupeKey');
    const n = ns[ns.length - 1];
    assert.equal(n.dedupeKey, 'archive-2026/2027-d3');
    assert.equal(n.push, false, 'to nie jest powiadomienie na ekran blokady');
    assert.match(n.text, /nie jest jeszcze podpisany/);
    assert.match(n.text, /2027-09-10/);
    assert.equal(n.link, '/dyrekcja');
  });
  await withConfig(S.db, { today: '2027-09-08' }, async () => {          // + 8
    expectOk(await P.get('/api/principal/archive'));
    const ns = mine();
    assert.equal(ns.length, before + 2);
    assert.equal(ns[ns.length - 1].dedupeKey, 'archive-2026/2027-d8');
  });
  await withConfig(S.db, { today: '2027-09-25' }, async () => {          // po terminie: treść mówi wprost
    for (const n of S.db.col('notifications')) if (n.dedupeKey === 'archive-2026/2027-d8') n.dedupeKey = 'archive-zuzyte';
    S.db.save();
    expectOk(await P.get('/api/principal/archive'));
    assert.match(mine()[mine().length - 1].text, /Minął ustawowy termin/);
  });
});

/* ---------------------------------------------------------------- podpis zewnętrzny ------------ */

test('archive: a XAdES-like signature whose DigestValue is ours verifies as digest-matched', async () => {
  const { pkg, entries } = await downloaded();
  const sum = entries.find((x) => x.name === 'manifest.sha256').content;
  const xades = xadesOver(b64sha256(sum), 'manifest.sha256');
  const r = expectOk(await P.post('/api/principal/archive/' + pkg.id + '/signature', {
    name: 'podpis dyrektora.xades', contentBase64: Buffer.from(xades, 'utf8').toString('base64'), kind: 'zaufany', signedFile: 'manifest.sha256'
  }));
  assert.equal(r.signature.verification, 'digest-matched');
  assert.equal(r.signature.state, 'signed');
  assert.equal(r.signature.attests, true);
  assert.deepEqual(r.signature.matched.map((m) => m.file), ['manifest.sha256'], 'wiemy, który plik pakietu został podpisany');
  assert.equal(r.signature.kind, 'zaufany');
  assert.equal(r.signature.name, 'podpis-dyrektora.xades', 'nazwa przeszła przez czyszczenie bramki załączników');
  assert.equal(r.signature.sha256, sha256(Buffer.from(xades, 'utf8')));
  assert.ok(r.signature.by, 'podpis wie, kto go dołączył');
  assert.equal(r.signature.checks.certificateChain, 'nie sprawdzamy');
  assert.match(r.signature.note, /nie jest usługą zaufania/i);
  assert.equal(r.window.status, 'signed', 'dołączony podpis o zgodnym skrócie zamyka termin z § 22');
  assert.equal(r.window.signed, true);

  /* Bajty podpisu też leżą na dysku, nie w kolekcji. */
  const row = S.db.get('archives', pkg.id);
  assert.equal(row.signature.contentBase64, undefined, 'podpis nie jest base64 na wierszu');
  assert.match(row.signature.path, /^files\/archives\//);
  assert.equal(B.sha256Of(S.db, row.signature), sha256(Buffer.from(xades, 'utf8')));

  /* /verify niesie ten sam obraz, a plik podpisu da się pobrać z powrotem. */
  const v = expectOk(await P.get('/api/principal/archive/' + pkg.id + '/verify'));
  assert.equal(v.valid, true, 'pieczęć nad XML-em nadal się weryfikuje');
  assert.equal(expectOk(await P.get('/api/principal/archive/' + pkg.id + '/verify?deep=1')).filesIntact, true, 'każdy plik pakietu na dysku ma skrót zapisany w wierszu');
  assert.deepEqual({ present: v.signature.present, kind: v.signature.kind, verification: v.signature.verification },
    { present: true, kind: 'zaufany', verification: 'digest-matched' });
  assert.equal(v.signature.at, r.signature.at);
  assert.equal(v.signature.by, r.signature.by);
  assert.match(v.sealMeaning, /nie jest kwalifikowaną usługą zaufania/);
  const dl = await P.get('/api/principal/archive/' + pkg.id + '/signature');
  assert.equal(dl.status, 200);
  assert.match(dl.headers.get('content-disposition'), /filename="podpis-dyrektora\.xades"/);
  assert.equal(typeof dl.body === 'string' ? dl.body : dl.body.toString('utf8'), xades);
  const a = S.db.col('audit').filter((x) => x.action === 'archive_signature_attached');
  assert.equal(a[a.length - 1].after.verification, 'digest-matched');

  /* Skrót całego pakietu też jest rozpoznawany, gdy dyrektor podpisał cały ZIP. */
  const overZip = xadesOver(b64sha256((await downloaded()).zip), 'package');
  const r2 = expectOk(await P.post('/api/principal/archive/' + pkg.id + '/signature', {
    name: 'podpis.xml', contentBase64: Buffer.from(overZip, 'utf8').toString('base64'), kind: 'qualified', signedFile: 'package'
  }));
  assert.equal(r2.signature.verification, 'digest-matched');
  assert.deepEqual(r2.signature.matched.map((m) => m.file), ['package']);
  assert.deepEqual(B.list(S.db, 'archives', pkg.id).map((f) => f.name).filter((n) => /podpis/.test(n)), ['podpis.xml'],
    'poprzedni plik podpisu nie zostaje na dysku jako sierota');
});

test('archive: an opaque signature file is stored, said to be unverified, and does NOT silence the § 22 reminder', async () => {
  /* Własny pakiet: ten test dotyka stanu podpisu, więc nie może się opierać o wspólny `built()`. */
  const own = await startServer();
  try {
    const p = await own.as('dyrektor');
    const pkg = expectOk(await p.post('/api/principal/archive', { year: '2026/2027', force: true, reason: 'test podpisu nieweryfikowalnego' }));
    const pades = Buffer.concat([Buffer.from('%PDF-1.7\n'), crypto.randomBytes(2048)]);
    const r = expectOk(await p.post('/api/principal/archive/' + pkg.id + '/signature', {
      name: 'archiwum-podpisane.pdf', contentBase64: pades.toString('base64'), kind: 'pades', signedFile: 'package'
    }));
    assert.equal(r.signature.verification, 'stored-unverified');
    assert.equal(r.signature.state, 'stored-unverified');
    assert.equal(r.signature.attests, false);
    assert.equal(r.signature.closesDeadline, false);
    assert.deepEqual(r.signature.matched, []);
    assert.equal(r.signature.sha256, sha256(pades), 'własny skrót pliku podpisu jest zapisany');
    assert.equal(r.signature.bytes, pades.length);
    assert.match(r.signature.checks.digest, /nie znaleziono/);

    /* S3-08: to jest sedno. Plik, który niczego nie potwierdza, NIE zamyka terminu. */
    assert.equal(r.window.signed, false, 'pakiet nie jest podpisany');
    assert.equal(r.window.status, 'signature-unverified');
    const mine = () => own.db.col('notifications').filter((n) => n.kind === 'archive' && n.userId === p.user.id);
    await withConfig(own.db, { today: '2027-09-03' }, async () => {
      expectOk(await p.get('/api/principal/archive'));
      const n = mine().pop();
      assert.ok(n, 'przypomnienie z § 22 nadal przychodzi');
      assert.match(n.text, /przyjęty, niezweryfikowany/, 'i mówi wprost, dlaczego nie milknie');
    });

    /* Zupełnie obcy plik XML z cudzym skrótem: też „przyjęty, niezweryfikowany”. */
    const alien = xadesOver(crypto.randomBytes(32).toString('base64'), 'cudzy-plik.txt');
    const r2 = expectOk(await p.post('/api/principal/archive/' + pkg.id + '/signature', {
      name: 'obcy.xml', contentBase64: Buffer.from(alien, 'utf8').toString('base64'), kind: 'osobisty', signedFile: 'manifest.sha256'
    }));
    assert.equal(r2.signature.verification, 'stored-unverified', 'skrót z cudzego dokumentu nie jest naszym skrótem');
    assert.equal(expectOk(await p.get('/api/principal/archive/' + pkg.id + '/verify')).signature.verification, 'stored-unverified');

    /* …a dyrektor może wziąć odpowiedzialność — z uzasadnieniem i z wpisem w rejestrze. */
    const noReason = await p.post('/api/principal/archive/' + pkg.id + '/accept-unverified', {});
    assert.equal(noReason.status, 400); assert.equal(noReason.body.code, 'no_reason');
    const acc = expectOk(await p.post('/api/principal/archive/' + pkg.id + '/accept-unverified', { reason: 'Zweryfikowano w walidatorze Certum 12.09.2027, protokół 8/2027.' }));
    assert.equal(acc.signature.state, 'accepted-unverified');
    assert.equal(acc.signature.verification, 'stored-unverified', 'nadal NIE mówimy „skrót się zgadza”');
    assert.equal(acc.signature.attests, false);
    assert.equal(acc.signature.closesDeadline, true);
    assert.equal(acc.window.signed, true, 'dopiero ta decyzja zamyka termin');
    assert.equal(acc.window.status, 'signed');
    assert.match(acc.signature.accepted.reason, /Certum/);
    assert.ok(acc.signature.accepted.by && acc.signature.accepted.at);
    const audit = own.db.col('audit').filter((x) => x.action === 'archive_signature_accepted_unverified').pop();
    assert.ok(audit, 'przyjęcie bez weryfikacji zostawia wpis w rejestrze');
    assert.match(audit.reason, /Certum/);
    assert.equal(audit.before.closedDeadline, false);
    assert.equal(audit.after.closedDeadline, true);

    /* …i przypomnienie w końcu milknie. */
    for (const n of mine()) own.db.remove('notifications', n.id);
    await withConfig(own.db, { today: '2027-09-08' }, async () => {
      expectOk(await p.get('/api/principal/archive'));
      assert.equal(mine().length, 0, 'po odnotowanym przyjęciu przypomnienie milczy');
    });
    /* Podpisu ze zgodnym skrótem nie ma czego „przyjmować bez weryfikacji”. */
    const sum = Buffer.from(own.db.get('archives', pkg.id).package.manifestSha256 + '  manifest.json\n', 'utf8');
    expectOk(await p.post('/api/principal/archive/' + pkg.id + '/signature', {
      name: 'dobry.xml', contentBase64: Buffer.from(xadesOver(b64sha256(sum)), 'utf8').toString('base64'), kind: 'zaufany', signedFile: 'manifest.sha256'
    }));
    const again = await p.post('/api/principal/archive/' + pkg.id + '/accept-unverified', { reason: 'nie trzeba' });
    assert.equal(again.status, 400); assert.equal(again.body.code, 'already_matched');
  } finally { own.close(); }
});

test('archive: the signature must be a real file — a string, big enough, and of a type a signature can have', async () => {
  const { pkg } = await downloaded();
  const post = (b) => P.post('/api/principal/archive/' + pkg.id + '/signature', b);
  const real = Buffer.from(xadesOver(crypto.randomBytes(32).toString('base64')), 'utf8').toString('base64');
  const ok = { name: 'podpis.xml', contentBase64: real, kind: 'zaufany', signedFile: 'manifest.sha256' };

  const badKind = await post(Object.assign({}, ok, { kind: 'odreczny' }));
  assert.equal(badKind.status, 400); assert.equal(badKind.body.code, 'bad_signature_kind');
  const badTarget = await post(Object.assign({}, ok, { signedFile: 'dziennik.xml' }));
  assert.equal(badTarget.status, 400); assert.equal(badTarget.body.code, 'bad_signed_file');

  /* S3-08 (b): `contentBase64: true` dawało 3-bajtowy „podpis kwalifikowany”. Teraz to 400. */
  for (const value of [true, 123, ['QUJD'], { a: 1 }, null, undefined]) {
    const r = await post(Object.assign({}, ok, { contentBase64: value }));
    assert.equal(r.status, 400, 'contentBase64 = ' + JSON.stringify(value === undefined ? 'brak' : value));
    assert.equal(r.body.code, 'bad_signature_content');
  }
  /* S3-08: żaden podpis elektroniczny nie ma 12 bajtów. */
  const tiny = await post(Object.assign({}, ok, { contentBase64: Buffer.from('<Signature/>').toString('base64') }));
  assert.equal(tiny.status, 400); assert.equal(tiny.body.code, 'signature_too_small');
  assert.equal(tiny.body.minBytes, 256);
  const empty = await post(Object.assign({}, ok, { contentBase64: '' }));
  assert.equal(empty.status, 400); assert.equal(empty.body.code, 'signature_too_small');

  /* S3-08 (a): JPEG „podpisywał” pakiet i uciszał termin. Typ bierzemy z bajtów. */
  const jpeg = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), crypto.randomBytes(2048)]);
  const asJpeg = await post(Object.assign({}, ok, { name: 'kotek.p7s', contentBase64: jpeg.toString('base64') }));
  assert.equal(asJpeg.status, 415); assert.equal(asJpeg.body.code, 'signature_type_unknown');
  const asText = await post(Object.assign({}, ok, { contentBase64: Buffer.alloc(1024, 0x41).toString('base64') }));
  assert.equal(asText.status, 415); assert.equal(asText.body.code, 'signature_type_unknown');
  const asZip = await post(Object.assign({}, ok, { name: 'podpis.zip', contentBase64: Buffer.concat([Buffer.from('PK\x03\x04'), crypto.randomBytes(1024)]).toString('base64') }));
  assert.equal(asZip.status, 415); assert.equal(asZip.body.code, 'signature_type_unknown');

  /* Trzy rodziny, które podpis naprawdę ma — rozpoznane z bajtów, nie z rozszerzenia. */
  assert.equal(AR.sniffSignature(Buffer.concat([Buffer.from([0x30, 0x82, 0x04, 0x00]), crypto.randomBytes(512)])).family, 'cades');
  assert.equal(AR.sniffSignature(Buffer.from('%PDF-1.7\n')).family, 'pades');
  assert.equal(AR.sniffSignature(Buffer.from('﻿  <?xml version="1.0"?><x/>')).family, 'xades', 'BOM i białe znaki nie psują rozpoznania');
  assert.equal(AR.sniffSignature(Buffer.from('to zwykły tekst')), null);
  const p7s = Buffer.concat([Buffer.from([0x30, 0x82, 0x04, 0x00]), crypto.randomBytes(2048)]);
  const good = expectOk(await post(Object.assign({}, ok, { name: 'podpis.p7s', contentBase64: p7s.toString('base64'), kind: 'qualified' })));
  assert.equal(good.signature.verification, 'stored-unverified');

  const notBase64 = await post(Object.assign({}, ok, { contentBase64: 'to nie jest base64!!!' }));
  assert.equal(notBase64.status, 400, 'treść, która nie jest base64, nie przejdzie');

  await withConfig(S.db, { archiveSignatureMaxMB: 0.001 }, async () => {
    const big = await post(Object.assign({}, ok, { contentBase64: Buffer.from(xadesOver(crypto.randomBytes(32).toString('base64')) + 'x'.repeat(4096), 'utf8').toString('base64') }));
    assert.equal(big.status, 413); assert.equal(big.body.code, 'attachment_too_large');
  });

  /* S3-07: skanowanie pliku podpisu jest liniowe — 5 MB patologicznego wejścia to milisekundy. */
  for (const bomb of [Buffer.from('<DigestValue>'.repeat(400000)), Buffer.from('<Reference URI'.repeat(380000)), Buffer.from('<a>'.repeat(1700000))]) {
    const t = process.hrtime.bigint();
    AR.readSignedDigests(bomb);
    const ms = Number(process.hrtime.bigint() - t) / 1e6;
    assert.ok(ms < 2000, `readSignedDigests na ${(bomb.length / 1048576).toFixed(1)} MB: ${ms.toFixed(0)} ms (przed R3: dziesiątki sekund)`);
  }
});

/* -------------------------------------------- H-9: przebudowa podpisanego rocznika ------------- */

test('archive: rebuilding a signed year needs a reason and loudly supersedes the old signature', async () => {
  const own = await startServer();
  try {
    const p = await own.as('dyrektor');
    const first = expectOk(await p.post('/api/principal/archive', { year: '2026/2027', force: true, reason: 'pierwszy pakiet' }));
    const sum = Buffer.from(first.package.manifestSha256 + '  manifest.json\n', 'utf8');
    expectOk(await p.post('/api/principal/archive/' + first.id + '/signature', {
      name: 'podpis.xml', contentBase64: Buffer.from(xadesOver(b64sha256(sum)), 'utf8').toString('base64'), kind: 'zaufany', signedFile: 'manifest.sha256'
    }));
    assert.equal(expectOk(await p.get('/api/principal/archive')).window.status, 'signed');

    /* Do R3 wystarczyło kliknąć „Generuj” drugi raz — status po cichu spadał do „package-ready”. */
    const silent = await p.post('/api/principal/archive', { year: '2026/2027', force: true, reason: 'poprawka' });
    assert.equal(silent.status, 409); assert.equal(silent.body.code, 'year_signed');
    assert.equal(silent.body.packageId, first.id);
    assert.match(silent.body.error, /Przebudowa unieważnia ten podpis/);
    assert.equal(own.db.col('archives').length, 1, 'odmowa nie zostawia pół-pakietu w kolekcji');

    const noReason = await p.post('/api/principal/archive', { year: '2026/2027', force: true, rebuild: true });
    assert.equal(noReason.status, 400, 'przebudowa bez uzasadnienia jest odmawiana');

    const second = expectOk(await p.post('/api/principal/archive', { year: '2026/2027', force: true, rebuild: true, reason: 'Wynik egzaminu poprawkowego z 28.08.2027.' }));
    assert.equal(second.supersededPackageId, first.id);
    const w = expectOk(await p.get('/api/principal/archive')).window;
    assert.equal(w.status, 'package-ready', 'termin znów jest otwarty i widać to wprost');
    assert.equal(w.signed, false);
    assert.equal(w.packageId, second.id);

    /* Stary pakiet zostaje w kolekcji, da się go pobrać i sam mówi, że nie zamyka już terminu. */
    const rows = expectOk(await p.get('/api/principal/archive')).packages;
    const old = rows.find((x) => x.id === first.id);
    assert.equal(old.superseded, true);
    assert.equal(old.supersededBy, second.id);
    assert.match(old.supersededReason, /egzaminu poprawkowego/);
    assert.equal(old.signature.verification, 'digest-matched', 'podpis pod poprzednią wersją nadal jest zgodny');
    assert.equal(old.signature.state, 'superseded');
    assert.equal(old.signature.closesDeadline, false, '…ale już nie zamyka terminu z § 22');
    assert.equal(old.signature.attested, true, '…i nadal jest dowodem, więc skasować go nie wolno');
    const cannotDelete = await p.delete('/api/principal/archive/' + first.id, { reason: 'sprzątanie' });
    assert.equal(cannotDelete.status, 409, 'unieważniony, ale podpisany pakiet zostaje');
    assert.match(old.signature.superseded.note, /nie zamyka terminu z § 22/);
    assert.equal((await p.get('/api/principal/archive/' + first.id + '/package')).status, 200, 'podpisany pakiet jest nadal do pobrania');

    const a = own.db.col('audit').filter((x) => x.action === 'archive_signature_superseded').pop();
    assert.ok(a, 'unieważnienie podpisu jest w rejestrze audytowym');
    assert.equal(a.entityId, first.id);
    assert.equal(a.before.closedDeadline, true); assert.equal(a.after.closedDeadline, false);
    assert.equal(a.after.supersededBy, second.id);

    /* …a przypomnienia wracają, bo rocznik znów nie jest podpisany. */
    await withConfig(own.db, { today: '2027-09-03' }, async () => {
      expectOk(await p.get('/api/principal/archive'));
      assert.ok(own.db.col('notifications').some((n) => n.kind === 'archive'), 'przypomnienie z § 22 wraca po przebudowie');
    });
  } finally { own.close(); }
});

/* -------------------------------------------- S3-13: usunięcie pakietu ------------------------- */

test('archive: an unsigned package can be deleted with a reason; a signed one cannot', async () => {
  const own = await startServer();
  try {
    const p = await own.as('dyrektor');
    const pkg = expectOk(await p.post('/api/principal/archive', { year: '2026/2027', force: true, reason: 'literówka w roku' }));
    const dir = B.list(own.db, 'archives', pkg.id);
    assert.equal(dir.length, 5, 'pakiet ma pięć plików na dysku');

    const noReason = await p.delete('/api/principal/archive/' + pkg.id, {});
    assert.equal(noReason.status, 400); assert.equal(noReason.body.code, 'no_reason');
    assert.equal(own.db.get('archives', pkg.id) !== null, true, 'odmowa nic nie kasuje');

    const gone = expectOk(await p.delete('/api/principal/archive/' + pkg.id, { reason: 'Pakiet wygenerowany przez pomyłkę na niepełnych danych.' }));
    assert.equal(gone.deleted, true);
    assert.equal(gone.removedFiles, 5, 'kasowanie idzie za wierszem — katalog znika razem z nim');
    assert.equal(own.db.get('archives', pkg.id), null);
    assert.equal(B.list(own.db, 'archives', pkg.id).length, 0, 'na dysku nie zostaje sierota');
    const a = own.db.col('audit').filter((x) => x.action === 'archive_deleted').pop();
    assert.ok(a, 'usunięcie jest audytowane');
    assert.equal(a.entityId, pkg.id);
    assert.match(a.reason, /przez pomyłkę/);
    assert.equal(a.before.year, '2026/2027');
    assert.ok(a.before.package.sha256, 'rejestr pamięta, co zniknęło');

    /* Podpisanego pakietu ta trasa nie rusza. */
    const signedPkg = expectOk(await p.post('/api/principal/archive', { year: '2026/2027', force: true, reason: 'właściwy pakiet' }));
    const sum = Buffer.from(signedPkg.package.manifestSha256 + '  manifest.json\n', 'utf8');
    expectOk(await p.post('/api/principal/archive/' + signedPkg.id + '/signature', {
      name: 'podpis.xml', contentBase64: Buffer.from(xadesOver(b64sha256(sum)), 'utf8').toString('base64'), kind: 'zaufany', signedFile: 'manifest.sha256'
    }));
    const refused = await p.delete('/api/principal/archive/' + signedPkg.id, { reason: 'nieważne' });
    assert.equal(refused.status, 409); assert.equal(refused.body.code, 'package_signed');
    assert.equal(own.db.get('archives', signedPkg.id) !== null, true);
    assert.equal(B.list(own.db, 'archives', signedPkg.id).length, 6, 'pliki podpisanego pakietu zostają nietknięte');
    assert.equal((await p.delete('/api/principal/archive/nie-ma-takiego', { reason: 'x' })).status, 404);
  } finally { own.close(); }
});

/* -------------------------------------------- R3-09: GET, który nic nie zapisuje --------------- */

test('archive: GET …/verify computes and writes nothing — the row and the store file stand still', async () => {
  /* R3-09: do R3 ta trasa pisała `a.verified`, więc jedno kliknięcie „zweryfikuj” logowało cały
     wiersz (z 5 MB podpisu) i wywracało kompaktację: 290–336 ms na wywołanie. Dowód jest tutaj
     twardy: prawdziwy katalog danych i czas modyfikacji pliku `archives.json`. */
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'edmat-f4-verify-'));
  const own = await startServer({ dataFile: path.join(dir, 'school.json') });
  try {
    const p = await own.as('dyrektor');
    const pkg = expectOk(await p.post('/api/principal/archive', { year: '2026/2027', force: true, reason: 'pomiar zapisu' }));
    own.db.flush();
    const file = path.join(dir, 'school', 'archives.json');
    const before = fs.statSync(file);
    const row = JSON.stringify(own.db.get('archives', pkg.id));
    const keys = Object.keys(own.db.get('archives', pkg.id)).sort();

    const v1 = expectOk(await p.get('/api/principal/archive/' + pkg.id + '/verify?deep=1'));
    for (let i = 0; i < 4; i++) expectOk(await p.get('/api/principal/archive/' + pkg.id + '/verify'));
    own.db.flush();

    const after = fs.statSync(file);
    assert.equal(after.mtimeMs, before.mtimeMs, 'pięć weryfikacji nie przepisało archives.json');
    assert.equal(after.size, before.size);
    assert.equal(JSON.stringify(own.db.get('archives', pkg.id)), row, 'wiersz jest bajt w bajt ten sam');
    assert.deepEqual(Object.keys(own.db.get('archives', pkg.id)).sort(), keys, 'żadnego nowego pola (kiedyś dopisywało się `verified`)');
    assert.equal(own.db.get('archives', pkg.id).verified, undefined, '`verified` jest wyliczane, nie zapisywane');

    /* A wynik jest prawdziwy: skrót policzony z bajtów leżących na dysku. */
    assert.equal(v1.valid, true);
    assert.equal(v1.digest, own.db.get('archives', pkg.id).seal.digest);
    assert.equal(v1.deep, true);
    assert.equal(v1.filesIntact, true); assert.equal(v1.filesPresent, true);
    assert.deepEqual(v1.files.map((f) => f.part).sort(), ['html', 'manifest', 'seal', 'xml', 'zip']);
    for (const f of v1.files) { assert.equal(f.present, true); assert.equal(f.intact, true); assert.equal(f.sizeMatches, true); }
    /* Bez `deep` mówimy „nie sprawdzaliśmy”, a nie „w porządku”. */
    const shallow = expectOk(await p.get('/api/principal/archive/' + pkg.id + '/verify'));
    assert.equal(shallow.deep, false);
    assert.equal(shallow.files.find((f) => f.part === 'zip').intact, null, 'null znaczy „nie liczyliśmy”, nie „zgadza się”');
    assert.equal(shallow.files.find((f) => f.part === 'xml').intact, true, 'XML i tak jest przeliczany — na nim stoi pieczęć');
    /* Pliki naprawdę leżą w katalogu danych, obok kolekcji — i kopia zapasowa je widzi. */
    assert.equal(fs.existsSync(path.join(dir, 'school', 'files', 'archives', pkg.id, 'manifest.json')), true);
    assert.deepEqual(own.db.blobFiles().map((f) => f.path).sort(), Object.values(own.db.get('archives', pkg.id).files).map((f) => f.path).sort());

    /* Naruszenie pliku na dysku jest widoczne — i dopiero wtedy `verify` mówi „nie”. */
    fs.appendFileSync(path.join(dir, 'school', 'files', 'archives', pkg.id, 'seal.json'), ' ');
    const v2 = expectOk(await p.get('/api/principal/archive/' + pkg.id + '/verify?deep=1'));
    assert.equal(v2.filesIntact, false, 'podmieniony plik pakietu jest widoczny');
    assert.equal(expectOk(await p.get('/api/principal/archive/' + pkg.id + '/verify')).filesPresent, false, 'zmiana rozmiaru widać nawet bez pełnego przeliczania');
    assert.equal(v2.files.find((f) => f.part === 'seal').intact, false);
    assert.equal(v2.valid, true, 'a pieczęć nad XML-em to osobna sprawa i nadal się zgadza');

    /* Lista też wylicza `verified`, a nie czyta zapisanego pola. */
    assert.equal(expectOk(await p.get('/api/principal/archive')).packages.find((x) => x.id === pkg.id).verified, true);
  } finally { own.close(); fs.rmSync(dir, { recursive: true, force: true }); }
});

/* -------------------------------------------- skala: 24 oddziały, pełny rok -------------------- */

test('archive: a 24-class year builds in bounded time and bounded memory', async () => {
  /* Budowniczy z `docs/review/round3/repro/reliability/fixture.js` przechodzi przez prawdziwe trasy
     kreatora i trwa minuty — do testu jednostkowego się nie nadaje, więc rocznik jest tu składany
     wprost w magazynie: 24 oddziały × 25 uczniów, 150 lekcji na oddział, frekwencja przy każdej.
     Granice są celowo luźne: chodzi o „czy to skaluje”, nie o mikrobenchmark. */
  const own = await startServer();
  try {
    const db = own.db;
    const CLASSES = 24, PUPILS = 25, LESSONS = 150;
    const classes = db.col('classes'), students = db.col('students'), lessons = db.col('lessons'), attendance = db.col('attendance');
    const teacher = db.col('users').find((u) => u.role === 'teacher').id;
    const subjects = db.col('subjects').map((s) => s.id).slice(0, 6);
    const days = [];
    for (let d = new Date('2026-09-01T00:00:00Z'); days.length < LESSONS; d.setUTCDate(d.getUTCDate() + 1)) {
      const iso = d.toISOString().slice(0, 10);
      if (d.getUTCDay() >= 1 && d.getUTCDay() <= 5) days.push(iso);
    }
    for (let c = 0; c < CLASSES; c++) {
      const cid = 'sk' + c;
      const ids = [];
      for (let s = 0; s < PUPILS; s++) {
        const sid = `st_sk_${c}_${s}`; ids.push(sid);
        students.push({ id: sid, rollNo: s + 1, firstName: 'Imie' + s, lastName: 'Nazwisko' + c, sex: s % 2 ? 'K' : 'M', classId: cid,
          pesel: null, birthDate: '2013-04-22', birthPlace: 'Kraków', status: 'active', registerNo: 9000 + c * 100 + s, parentIds: [] });
      }
      classes.push({ id: cid, name: cid, level: (c % 8) + 1, homeroomTeacherId: teacher, studentIds: ids });
      for (let l = 0; l < LESSONS; l++) {
        const lid = `les_sk_${c}_${l}`;
        lessons.push({ id: lid, date: days[l], lessonNo: (l % 7) + 1, classId: cid, groupId: null, subjectId: subjects[l % subjects.length],
          teacherId: teacher, room: String(100 + c), topic: 'Temat lekcji numer ' + l + ' w oddziale ' + cid, curriculumItemIds: [], status: 'held',
          substituteTeacherId: null, combinedWith: null, attendanceDraft: false });
        for (let s = 0; s < PUPILS; s++) {
          attendance.push({ id: `att_sk_${c}_${l}_${s}`, lessonId: lid, studentId: ids[s], date: days[l], lessonNo: (l % 7) + 1, classId: cid,
            subjectId: subjects[l % subjects.length], status: s % 9 === 0 ? 'nb' : 'ob', minutes: null, draft: false, byUserId: teacher, at: days[l] + 'T09:00:00Z', excuseId: null });
        }
      }
    }
    db.save();
    const rows = { lessons: lessons.length, attendance: attendance.length, students: students.length };
    assert.ok(rows.attendance >= 90000, 'rocznik ma sensowną skalę: ' + JSON.stringify(rows));

    if (global.gc) global.gc();
    const rssBefore = process.memoryUsage().rss;
    const t0 = process.hrtime.bigint();
    const p = await own.as('dyrektor');
    const pkg = expectOk(await p.post('/api/principal/archive', { year: '2026/2027', force: true, reason: 'pomiar skali' }));
    const ms = Number(process.hrtime.bigint() - t0) / 1e6;
    const rssDelta = process.memoryUsage().rss - rssBefore;

    const row = own.db.get('archives', pkg.id);
    assert.ok(row.files.xml.bytes > 5 * 1024 * 1024, 'XML rocznika ma megabajty: ' + row.files.xml.bytes);
    assert.ok(JSON.stringify(row).length < 8 * 1024, 'a wiersz nadal ma kilobajty: ' + JSON.stringify(row).length + ' B');
    assert.ok(ms < 60000, `budowa pakietu na 24 oddziałach: ${(ms / 1000).toFixed(1)} s (granica 60 s)`);
    assert.ok(rssDelta < 600 * 1024 * 1024, `przyrost RSS przy budowie: ${(rssDelta / 1048576).toFixed(0)} MB (granica 600 MB)`);

    /* Pobranie pakietu to odczyt pliku, a nie składanie ZIP-a od nowa (R3-13). */
    const t1 = process.hrtime.bigint();
    const zip = await p.get('/api/principal/archive/' + pkg.id + '/package');
    const dlMs = Number(process.hrtime.bigint() - t1) / 1e6;
    assert.equal(zip.status, 200);
    assert.equal(sha256(zip.body), row.files.zip.sha256);
    assert.ok(dlMs < 5000, `pobranie gotowego ZIP-a: ${dlMs.toFixed(0)} ms`);
    console.log(`  [skala] ${rows.lessons} lekcji, ${rows.attendance} wpisów frekwencji · budowa ${(ms / 1000).toFixed(2)} s · RSS +${(rssDelta / 1048576).toFixed(0)} MB · XML ${(row.files.xml.bytes / 1048576).toFixed(1)} MB · pobranie ZIP ${dlMs.toFixed(0)} ms`);
  } finally { own.close(); }
});

test('archive: only the principal may build, download, sign or delete the package', async () => {
  const { pkg } = await downloaded();
  for (const login of ['j.nowak', 'sekretariat', 'rodzic.kowalczyk']) {
    const c = await S.as(login);
    assert.equal((await c.get('/api/principal/archive')).status, 403, login + ' nie widzi archiwum');
    assert.equal((await c.get('/api/principal/archive/' + pkg.id + '/package')).status, 403, login + ' nie pobiera pakietu');
    assert.equal((await c.get('/api/principal/archive/' + pkg.id + '/signature')).status, 403, login + ' nie pobiera podpisu');
    assert.equal((await c.post('/api/principal/archive/' + pkg.id + '/signature', { name: 'x.xml', contentBase64: 'PHg+PC94Pg==', kind: 'zaufany' })).status, 403, login + ' nie dołącza podpisu');
    assert.equal((await c.post('/api/principal/archive/' + pkg.id + '/accept-unverified', { reason: 'x' })).status, 403, login + ' nie przyjmuje podpisu bez weryfikacji');
    assert.equal((await c.delete('/api/principal/archive/' + pkg.id, { reason: 'x' })).status, 403, login + ' nie usuwa pakietu');
  }
  /* Inspektor ochrony danych czyta weryfikację (tak jak dotąd), ale pakietu nie pobiera. */
  const iod = await S.as('iod');
  assert.equal((await iod.get('/api/principal/archive/' + pkg.id + '/verify')).status, 200);
  assert.equal((await iod.get('/api/principal/archive/' + pkg.id + '/package')).status, 403);
  assert.equal((await iod.delete('/api/principal/archive/' + pkg.id, { reason: 'x' })).status, 403);
  assert.equal((await P.get('/api/principal/archive/nie-ma-takiego/package')).status, 404);
});
