'use strict';
/* R3 (reliability § 5, R3-09/R3-13) — jedna bramka do plików, które NIE są dokumentami.
 *
 * Magazyn EdMat jest silnikiem dokumentowym: jednostką zapisu jest cały wiersz, więc 4,6 MB XML-a
 * albo 5 MB podpisu na wierszu `archives` sprawia, że KAŻDY zapis dotykający tego wiersza kosztuje
 * setki milisekund (log całego dokumentu → kompaktacja → przepisanie migawki), a mała kolekcja
 * poniżej `hotBytes` jest dodatkowo porównywana przy każdym flushu. Żaden z tych bajtów nigdy nie
 * jest odpytywany: zapisujemy je raz i oddajemy bajt w bajt. To są pliki udające dokumenty.
 *
 * Więc leżą na dysku, obok kolekcji, a w wierszu zostaje sam opis:
 *
 *   data/school/files/<kolekcja>/<id>/<nazwa>      ← bajty
 *   { name, bytes, sha256, path: 'files/<kolekcja>/<id>/<nazwa>' }   ← wiersz
 *
 * Reguły, których ten plik pilnuje (CONTRIBUTING.md: „nigdy nie pisz sam do data/”):
 *   · każdy segment ścieżki musi pasować do /^[A-Za-z0-9._-]+$/ — nazwa z żądania nigdy nie buduje
 *     ścieżki inaczej niż przez `safeName`, „..” i separatory są odrzucane, nie „czyszczone”;
 *   · zapis idzie przez plik tymczasowy i `rename`, więc czytelnik nigdy nie widzi połowy pliku;
 *   · SHA-256 liczy się w trakcie zapisu, ze strumienia — nie trzymamy drugiej kopii w pamięci;
 *   · kasowanie wiersza kasuje jego katalog (`del`), bo inaczej zostają sieroty;
 *   · `scripts/backup.js` kopiuje `files/` razem z danymi, a `Store._sweepOrphans` go nie rusza.
 */
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');

const SEGMENT = /^[A-Za-z0-9._-]+$/;
/** Katalogi robocze wystawione dla magazynu bez katalogu danych (testy) — sprzątane przy wyjściu. */
const TEMP_ROOTS = [];
let exitHooked = false;

/** Nazwa pliku sprowadzona do jednego bezpiecznego segmentu — ta sama reguła, co w `Content-Disposition`. */
function safeName(raw, fallback) {
  const n = String(raw == null ? '' : raw).normalize('NFKD').split(/[\\/]/).pop()
    .replace(/[^A-Za-z0-9._-]+/g, '-').replace(/^[-.]+/, '').replace(/-+/g, '-').slice(0, 120);
  return SEGMENT.test(n) ? n : (fallback || 'plik');
}
/** Segment ścieżki przyjęty tylko wtedy, gdy już jest bezpieczny — inaczej wyjątek, nie „naprawa”. */
function segment(raw, what) {
  const s = String(raw == null ? '' : raw);
  if (!SEGMENT.test(s) || s === '.' || s === '..') throw new Error(`Niedozwolona nazwa ${what || 'segmentu'}: „${s}”.`);
  return s;
}

/** Katalog plików tego magazynu: `<data>/school/files`, a bez katalogu danych — katalog tymczasowy. */
function root(db) {
  if (db && typeof db.blobDir === 'function') { const d = db.blobDir(); if (d) return d; }
  if (db && db.dir) return path.join(db.dir, 'files');
  if (!db) throw new Error('blobs: brak magazynu.');
  if (!db._blobRoot) {
    const d = fs.mkdtempSync(path.join(os.tmpdir(), 'edmat-files-'));
    Object.defineProperty(db, '_blobRoot', { value: d, writable: true, enumerable: false, configurable: true });
    TEMP_ROOTS.push(d);
    if (!exitHooked) { exitHooked = true; process.on('exit', () => { for (const t of TEMP_ROOTS) { try { fs.rmSync(t, { recursive: true, force: true }); } catch (e) {} } }); }
  }
  return db._blobRoot;
}
/** Katalog jednego wiersza. */
function dirOf(db, collection, id) { return path.join(root(db), segment(collection, 'kolekcji'), segment(id, 'identyfikatora')); }
/** Ścieżka względem katalogu magazynu — to ona ląduje w wierszu i w kopii zapasowej. */
const relPath = (collection, id, name) => `files/${collection}/${id}/${name}`;
/** Bezwzględna ścieżka z opisu zapisanego w wierszu (albo z trójki kolekcja/id/nazwa). */
function absPath(db, descriptorOrCollection, id, name) {
  if (descriptorOrCollection && typeof descriptorOrCollection === 'object') {
    const parts = String(descriptorOrCollection.path || '').split('/');
    if (parts.length !== 4 || parts[0] !== 'files') throw new Error(`blobs: nieznana ścieżka pliku „${descriptorOrCollection.path}”.`);
    return path.join(root(db), segment(parts[1], 'kolekcji'), segment(parts[2], 'identyfikatora'), segment(parts[3], 'pliku'));
  }
  return path.join(dirOf(db, descriptorOrCollection, id), segment(name, 'pliku'));
}

/**
 * Zapisuje bajty i oddaje opis do wstawienia w wiersz.
 * `content` to Buffer, napis albo iterowalny ciąg kawałków (generator) — wtedy plik powstaje
 * strumieniowo i nigdy nie ma całości w pamięci naraz.
 * @returns {{name:string, bytes:number, sha256:string, path:string}}
 */
function put(db, collection, id, name, content) {
  const col = segment(collection, 'kolekcji'), rid = segment(id, 'identyfikatora'), file = segment(safeName(name), 'pliku');
  const dir = dirOf(db, col, rid);
  fs.mkdirSync(dir, { recursive: true });
  const target = path.join(dir, file);
  const tmp = target + '.tmp-' + process.pid + '-' + Math.random().toString(36).slice(2, 8);
  const hash = crypto.createHash('sha256');
  let bytes = 0;
  const fd = fs.openSync(tmp, 'w');
  try {
    const chunks = Buffer.isBuffer(content) || typeof content === 'string' ? [content] : content;
    for (const c of chunks) {
      const b = Buffer.isBuffer(c) ? c : Buffer.from(String(c), 'utf8');
      if (!b.length) continue;
      hash.update(b); bytes += b.length;
      fs.writeSync(fd, b);
    }
  } finally { fs.closeSync(fd); }
  try { fs.renameSync(tmp, target); } catch (e) { try { fs.unlinkSync(tmp); } catch (_) {} throw e; }
  return { name: file, bytes, sha256: hash.digest('hex'), path: relPath(col, rid, file) };
}

/** Bajty z opisu zapisanego w wierszu. Rzuca, gdy pliku nie ma — wiersz kłamie i trzeba to widzieć. */
function get(db, descriptorOrCollection, id, name) {
  return fs.readFileSync(absPath(db, descriptorOrCollection, id, name));
}
/** Strumień do wysłania wprost do klienta (bez wciągania 5 MB do pamięci). */
function stream(db, descriptorOrCollection, id, name) {
  return fs.createReadStream(absPath(db, descriptorOrCollection, id, name));
}
/** Czy plik z opisu naprawdę leży na dysku. */
function has(db, descriptorOrCollection, id, name) {
  try { return fs.statSync(absPath(db, descriptorOrCollection, id, name)).isFile(); } catch (e) { return false; }
}
/** Co naprawdę leży pod wierszem — do kopii zapasowej, do testów i do wykrycia sierot. */
function list(db, collection, id) {
  if (collection == null) {
    const out = [];
    let cols = []; try { cols = fs.readdirSync(root(db)); } catch (e) { return out; }
    for (const c of cols) if (SEGMENT.test(c)) out.push(...list(db, c));
    return out;
  }
  if (id == null) {
    const out = [];
    let ids = []; try { ids = fs.readdirSync(dirOfCollection(db, collection)); } catch (e) { return out; }
    for (const i of ids) if (SEGMENT.test(i)) out.push(...list(db, collection, i));
    return out;
  }
  const dir = dirOf(db, collection, id);
  let files = []; try { files = fs.readdirSync(dir); } catch (e) { return []; }
  const out = [];
  for (const f of files.sort()) {
    if (!SEGMENT.test(f) || /\.tmp-/.test(f)) continue;
    let st; try { st = fs.statSync(path.join(dir, f)); } catch (e) { continue; }
    if (!st.isFile()) continue;
    out.push({ collection: String(collection), id: String(id), name: f, bytes: st.size, path: relPath(collection, id, f) });
  }
  return out;
}
function dirOfCollection(db, collection) { return path.join(root(db), segment(collection, 'kolekcji')); }

/** Kasuje jeden plik albo (bez `name`) cały katalog wiersza. Kasowanie idzie za wierszem. */
function del(db, collection, id, name) {
  const dir = dirOf(db, collection, id);
  if (name != null) { try { fs.unlinkSync(path.join(dir, segment(safeName(name), 'pliku'))); return 1; } catch (e) { return 0; } }
  const n = list(db, collection, id).length;
  try { fs.rmSync(dir, { recursive: true, force: true }); } catch (e) {}
  return n;
}

/** Skrót policzony z tego, co NAPRAWDĘ leży na dysku — dowód spójności dla `…/verify`. */
function sha256Of(db, descriptorOrCollection, id, name) {
  const hash = crypto.createHash('sha256');
  const fd = fs.openSync(absPath(db, descriptorOrCollection, id, name), 'r');
  try {
    const buf = Buffer.alloc(1024 * 256);
    for (;;) { const n = fs.readSync(fd, buf, 0, buf.length, null); if (!n) break; hash.update(buf.slice(0, n)); }
  } finally { fs.closeSync(fd); }
  return hash.digest('hex');
}

module.exports = { put, get, stream, has, list, del, sha256Of, root, dirOf, absPath, relPath, safeName, segment, SEGMENT };
