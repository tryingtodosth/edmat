#!/usr/bin/env node
/*
 * Backup and restore for the JSON store — no dependencies, safe to run while the server is up.
 *
 *   node scripts/backup.js backup  [--data <dir>] [--out <dir>] [--keep 30] [--label nocny]
 *   node scripts/backup.js list    [--out <dir>]
 *   node scripts/backup.js verify  [plik.json[.gz]]
 *   node scripts/backup.js restore <plik.json[.gz]> [--data <dir>] [--yes]
 *   node scripts/backup.js prune   [--out <dir>] [--keep 30]
 *
 * Defaults: --data = $EDMAT_DATA or ./data (the store itself lives in <data>/school/), --out = $EDMAT_BACKUP_DIR or <data>/backups, --keep 30.
 *
 * Since the store went per-collection (docs/STORAGE.md) the data directory is `data/school/` — one
 * JSON file per collection plus an append log for the hot ones, **plus `files/`**: the bytes that
 * are not documents (the § 22 archive packages and the signature files, `server/lib/blobs.js`).
 * A backup reads that directory back into one document and writes it as a single gzipped
 * `.json.gz` bundle: one file to rsync off the host, one file to verify, and the same shape the
 * anonymised export produces, so both restore through the same path. The files ride along as
 * `_files: { "files/<kolekcja>/<id>/<plik>": "<base64>" }` — a backup that silently stopped
 * containing the signed archive package would be worse than no backup (reliability.md § 5).
 *
 * Every file is written with tmp+rename and the logs are append-only, so a
 * reader always sees whole, consistent rows; a backup never needs the server stopped.
 * A restore DOES need the server stopped: it refuses to run while the data-directory lock is held.
 *
 * Daily rotation (cron on the VPS, 02:30, keeps 30 days ≈ one month of school):
 *   30 2 * * *  cd /srv/edmat && /usr/bin/node scripts/backup.js backup --keep 30 >> /var/log/edmat-backup.log 2>&1
 * or, with the container:
 *   30 2 * * *  docker compose exec -T edmat node scripts/backup.js backup --keep 30
 * Copy the backup directory off the VPS daily (rsync/restic to a second host) — a backup on the same
 * disk as the database is not a backup. Test a restore into a throwaway directory once a term.
 */
'use strict';
const fs = require('node:fs'); const path = require('node:path'); const zlib = require('node:zlib'); const os = require('node:os');
const { readLayout, writeLayout, BLOB_DIR } = require('../server/lib/store');

function arg(name, def) { const i = process.argv.indexOf('--' + name); return i > 0 && process.argv[i + 1] && !process.argv[i + 1].startsWith('--') ? process.argv[i + 1] : def; }
function flag(name) { return process.argv.includes('--' + name); }
const cmd = process.argv[2] || 'backup';
const DATA_DIR = path.resolve(arg('data', process.env.EDMAT_DATA || path.join(__dirname, '..', 'data')));
const FILE = path.join(DATA_DIR, 'school.json');      // the lock lives here, and pre-2 data still does
const STORE_DIR = path.join(DATA_DIR, 'school');
const OUT_DIR = path.resolve(arg('out', process.env.EDMAT_BACKUP_DIR || path.join(DATA_DIR, 'backups')));
const KEEP = Math.max(1, +arg('keep', 30) || 30);
const MB = (n) => (n / 1048576).toFixed(1) + ' MB';

function readSnapshot(file) {
  const raw = fs.readFileSync(file);
  const buf = file.endsWith('.gz') ? zlib.gunzipSync(raw) : raw;
  return { text: buf.toString('utf8'), rawBytes: raw.length };
}
const FILES_KEY = '_files';
const SEGMENT = /^[A-Za-z0-9._-]+$/;
/** Every blob under `<store>/files`, keyed by its path relative to the store directory. */
function readBlobs(storeDir) {
  const out = {}; const base = path.join(storeDir, BLOB_DIR);
  const walk = (abs, rel) => {
    let names = []; try { names = fs.readdirSync(abs); } catch (e) { return; }
    for (const n of names.sort()) {
      if (!SEGMENT.test(n) || /\.tmp-/.test(n)) continue;
      const full = path.join(abs, n);
      let st; try { st = fs.statSync(full); } catch (e) { continue; }
      if (st.isDirectory()) walk(full, rel + n + '/');
      else if (st.isFile()) out[rel + n] = fs.readFileSync(full).toString('base64');
    }
  };
  walk(base, BLOB_DIR + '/');
  return out;
}
/** Writes the blobs back under `<store>/files`, refusing any path that is not a clean segment run. */
function writeBlobs(storeDir, files) {
  const base = path.join(storeDir, BLOB_DIR);
  fs.rmSync(base, { recursive: true, force: true });          // a restore replaces, it does not merge
  let n = 0, bytes = 0;
  for (const [rel, b64] of Object.entries(files || {})) {
    const parts = String(rel).split('/');
    if (parts[0] !== BLOB_DIR || parts.length < 2 || !parts.every((x) => SEGMENT.test(x))) {
      console.error('Pomijam plik o niedozwolonej ścieżce w kopii: ' + rel); continue;
    }
    const target = path.join(storeDir, ...parts);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    const buf = Buffer.from(String(b64), 'base64');
    fs.writeFileSync(target, buf); n++; bytes += buf.length;
  }
  return { files: n, bytes };
}
/** The live data: the per-collection directory if it is there, otherwise a pre-2 single document. */
function readData() {
  const out = readLayout(STORE_DIR);
  if (out) {
    const blobs = readBlobs(STORE_DIR);
    const doc = Object.keys(blobs).length ? Object.assign({}, out.data, { [FILES_KEY]: blobs }) : out.data;
    return { text: JSON.stringify(doc), from: STORE_DIR };
  }
  if (fs.existsSync(FILE)) return { text: readSnapshot(FILE).text, from: FILE };
  return null;
}
/** A backup is only a backup if it parses and carries the collections the app needs. */
function verify(text) {
  const data = JSON.parse(text);
  const problems = [];
  if (!data.config) problems.push('brak config');
  if (!Array.isArray(data.users)) problems.push('brak kolekcji users');
  if (data.config && !data.config.school) problems.push('brak config.school');
  const rows = {}; let total = 0;
  for (const [k, v] of Object.entries(data)) if (Array.isArray(v)) { rows[k] = v.length; total += v.length; }
  if (!problems.length && !(rows.users > 0)) problems.push('zero kont użytkowników');
  /* The § 22 packages live as files next to the collections; a backup that lost them is not a backup. */
  const blobs = data[FILES_KEY] && typeof data[FILES_KEY] === 'object' ? Object.keys(data[FILES_KEY]) : [];
  const blobBytes = blobs.reduce((sum, k) => sum + Math.floor(String(data[FILES_KEY][k]).length * 3 / 4), 0);
  /* Only rows that actually point at files: a pre-R3 backup keeps the bytes inline and is fine. */
  const want = new Set();
  for (const [col, rowsOf] of Object.entries(data)) {
    if (!Array.isArray(rowsOf)) continue;
    for (const row of rowsOf) {
      if (!row || typeof row !== 'object') continue;
      for (const f of Object.values(row.files || {})) if (f && typeof f.path === 'string' && f.path.startsWith(BLOB_DIR + '/')) want.add(f.path);
      if (row.signature && typeof row.signature.path === 'string' && row.signature.path.startsWith(BLOB_DIR + '/')) want.add(row.signature.path);
      void col;
    }
  }
  const missing = [...want].filter((x) => !blobs.includes(x));
  if (missing.length) problems.push(`w kopii brakuje ${missing.length} plików, na które wskazują wiersze (np. ${missing[0]})`);
  return { ok: !problems.length, problems, rows, totalRows: total, files: blobs.length, fileBytes: blobBytes, missingFiles: missing.length, meta: data.meta || null, anonymized: !!(data.config && data.config.anonymized), school: (data.config && data.config.school && data.config.school.name) || '' };
}
function lockHeld() {
  const lf = FILE + '.lock';
  if (!fs.existsSync(lf)) return null;
  let held = null; try { held = JSON.parse(fs.readFileSync(lf, 'utf8')); } catch (e) { return { pid: null, host: null, stale: false }; }
  let alive = true; try { process.kill(held.pid, 0); } catch (e) { alive = e.code === 'EPERM'; }
  return Object.assign({}, held, { stale: held.host === os.hostname() && !alive });
}
function list() {
  if (!fs.existsSync(OUT_DIR)) return [];
  return fs.readdirSync(OUT_DIR).filter((f) => /^school-.*\.json(\.gz)?$/.test(f))
    .map((f) => ({ name: f, file: path.join(OUT_DIR, f), size: fs.statSync(path.join(OUT_DIR, f)).size, mtime: fs.statSync(path.join(OUT_DIR, f)).mtime }))
    .sort((a, b) => b.name.localeCompare(a.name));
}

function doBackup() {
  const src = readData();
  if (!src) { console.error('Nie ma danych do skopiowania: ' + STORE_DIR + ' ani ' + FILE); process.exit(2); }
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const { text } = src;
  const v = verify(text);
  if (!v.ok) { console.error('Plik danych jest niekompletny (' + v.problems.join(', ') + ') — kopia nie została zapisana.'); process.exit(3); }
  const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const label = arg('label', '') ? '-' + String(arg('label', '')).replace(/[^a-zA-Z0-9_-]/g, '') : '';
  const name = `school-${stamp}${label}.json.gz`;
  const target = path.join(OUT_DIR, name); const tmp = target + '.tmp';
  fs.writeFileSync(tmp, zlib.gzipSync(Buffer.from(text, 'utf8'), { level: 6 }));
  fs.renameSync(tmp, target);
  const size = fs.statSync(target).size;
  console.log(`Kopia: ${target} (${MB(size)}, źródło ${MB(Buffer.byteLength(text))}, ${v.totalRows} wierszy${v.files ? `, plików w ${BLOB_DIR}/: ${v.files} (${MB(v.fileBytes)})` : ''}, szkoła: ${v.school || '—'})`);
  const removed = prune();
  console.log(`Kopie w katalogu: ${list().length} (limit ${KEEP}${removed.length ? ', usunięto ' + removed.length : ''}).`);
  return target;
}
function prune() {
  const all = list(); const removed = [];
  for (const b of all.slice(KEEP)) { fs.unlinkSync(b.file); removed.push(b.name); }
  return removed;
}
function doRestore(src) {
  if (!src) { console.error('Podaj plik kopii: node scripts/backup.js restore <plik>'); process.exit(2); }
  const file = path.resolve(src);
  if (!fs.existsSync(file)) { console.error('Nie ma takiego pliku: ' + file); process.exit(2); }
  const held = lockHeld();
  if (held && !held.stale) { console.error(`Serwer EdMat działa (proces ${held.pid} na ${held.host}) i trzyma katalog danych. Zatrzymaj go przed odtworzeniem.`); process.exit(4); }
  const { text } = readSnapshot(file);
  const v = verify(text);
  if (!v.ok) { console.error('Kopia jest uszkodzona: ' + v.problems.join(', ')); process.exit(3); }
  if (!flag('yes')) {
    console.log(`Do odtworzenia: ${file}`);
    console.log(`  szkoła: ${v.school || '—'}${v.anonymized ? '  [KOPIA ZANONIMIZOWANA — dane osobowe zastąpione]' : ''}`);
    console.log(`  wiersze: ${v.totalRows} (${Object.entries(v.rows).filter(([, n]) => n).map(([k, n]) => k + ':' + n).join(', ')})`);
    if (v.files) console.log(`  pliki: ${v.files} w ${BLOB_DIR}/ (${MB(v.fileBytes)}) — pakiety archiwalne i pliki podpisów`);
    console.log(`  cel: ${STORE_DIR}`);
    console.error('Dopisz --yes, żeby nadpisać bieżące dane (poprzednia wersja zostanie zapisana obok jako school-przed-odtworzeniem-*.json).');
    process.exit(1);
  }
  fs.mkdirSync(DATA_DIR, { recursive: true });
  /* Whatever is being replaced is kept next to the data directory as one readable document. */
  let kept = null;
  const current = readData();
  if (current) {
    kept = path.join(DATA_DIR, `school-przed-odtworzeniem-${new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)}.json`);
    fs.writeFileSync(kept, current.text);
  }
  const doc = JSON.parse(text);
  const blobs = doc[FILES_KEY]; delete doc[FILES_KEY];
  writeLayout(STORE_DIR, doc);
  const wrote = writeBlobs(STORE_DIR, blobs);
  /* A pre-2 document left in the directory would be imported over the restore on the next start. */
  if (fs.existsSync(FILE)) { try { fs.unlinkSync(FILE); } catch (e) {} }
  console.log(`Odtworzono ${v.totalRows} wierszy do ${STORE_DIR}${v.anonymized ? ' (dane zanonimizowane — środowisko testowe)' : ''}.`);
  if (wrote.files) console.log(`Odtworzono ${wrote.files} plików (${MB(wrote.bytes)}) do ${path.join(STORE_DIR, BLOB_DIR)}.`);
  if (kept) console.log(`Poprzednia wersja: ${kept}`);
  return { file: STORE_DIR, kept, verify: v };
}

if (require.main === module) {
  try {
    if (cmd === 'backup') doBackup();
    else if (cmd === 'restore') doRestore(process.argv[3]);
    else if (cmd === 'prune') { const r = prune(); console.log(`Usunięto ${r.length} kopii, zostało ${list().length} (limit ${KEEP}).`); }
    else if (cmd === 'list') { const all = list(); if (!all.length) console.log('Brak kopii w ' + OUT_DIR); for (const b of all) console.log(`${b.name}  ${MB(b.size).padStart(9)}  ${b.mtime.toISOString()}`); }
    else if (cmd === 'verify') { const src = process.argv[3] ? readSnapshot(path.resolve(process.argv[3])) : readData(); if (!src) { console.error('Nie ma danych do sprawdzenia.'); process.exit(2); } const v = verify(src.text); console.log(JSON.stringify(v, null, 1)); process.exit(v.ok ? 0 : 3); }
    else { console.error('Użycie: node scripts/backup.js backup|restore|list|verify|prune [opcje]'); process.exit(2); }
  } catch (e) { console.error('Błąd: ' + e.message); process.exit(1); }
}
module.exports = { doBackup, doRestore, prune, list, verify, readSnapshot, readData, readBlobs, writeBlobs, lockHeld, DATA_DIR, OUT_DIR, FILE, STORE_DIR, FILES_KEY };
