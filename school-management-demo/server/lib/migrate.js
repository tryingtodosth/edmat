'use strict';
/*
 * Schema / seed versioning for the store.
 *
 * `db.data.meta.version` is the number of the last migration applied to THIS data directory. A new
 * release that has to reshape stored documents adds one entry to MIGRATIONS with the next number
 * and an `up(db)` that is safe to run on data written by any earlier release; createApp() runs
 * everything above the stored number, in order, before the first request is served.
 *
 * Rules for a migration:
 *  - forward only, idempotent where it can be (a half-applied state must be repairable by re-running),
 *  - never delete a document — rename or add, and leave the old field in place for one release,
 *  - never touch the audit log,
 *  - keep it pure data: no HTTP, no config reading beyond db.data.config.
 *
 * Version 2 also has a file-level half: a school still stored as one `data/school.json` is imported
 * into the per-collection directory `data/school/` the first time the new build opens it. That part
 * runs inside `Store.load()` (the store cannot serve anything before it has data) — see
 * `importLegacyFile` below and docs/STORAGE.md.
 */
const fs = require('node:fs');
const path = require('node:path');
const { now } = require('./util');

const MIGRATIONS = [
  {
    version: 1,
    name: 'baseline',
    /* First numbered schema. Every file written before versioning carries the shape 1 already,
       so this only stamps the version — it is deliberately a no-op. */
    up() {},
  },
  {
    version: 2,
    name: 'per-collection-storage',
    /* The documents did not change — the layout did: one file per collection plus an append log for
       the hot ones. `importLegacyFile` has already done the copy by the time this runs; all that is
       left is to record which layout this data directory is in. */
    up(db) { const m = db.data.meta || (db.data.meta = {}); m.storage = 'per-collection'; },
  },
];

const SCHEMA_VERSION = MIGRATIONS.reduce((m, x) => Math.max(m, x.version), 0);

/**
 * Imports `data/school.json` into `data/school/` once, then renames the old document to
 * `school.json.migrated-<date>` so a downgrade still has it and a restart does not import twice.
 * Returns true when it imported something. Called by Store.load() before it looks for the directory.
 */
function importLegacyFile(store, opts) {
  const o = opts || {};
  if (!store.file || !store.dir || store.legacy) return false;
  if (fs.existsSync(path.join(store.dir, '_store.json'))) return false;   // already in the new layout
  let stat = null; try { stat = fs.statSync(store.file); } catch (e) { return false; }
  if (!stat.isFile()) return false;
  const started = Date.now();
  let doc = null;
  /* Bez tego uszkodzony `school.json` kończył start wyjątkiem „Unexpected token …” bez nazwy pliku
     — a to jedyny moment, w którym ktoś ma szansę sięgnąć po kopię zamiast szukać po omacku. */
  try { doc = JSON.parse(fs.readFileSync(store.file, 'utf8')); }
  catch (e) {
    const err = new Error(`Plik danych ${store.file} jest uszkodzony (${e.message}) i nie da się go przenieść do nowego układu. Odtwórz go z kopii: node scripts/backup.js restore <kopia> --data <katalog>.`);
    err.code = 'EDMAT_BAD_DATA_FILE'; err.cause = e; throw err;
  }
  if (!doc || typeof doc !== 'object' || Array.isArray(doc)) {
    const err = new Error(`Plik danych ${store.file} nie jest dokumentem szkoły (oczekiwano obiektu z kolekcjami). Odtwórz go z kopii: node scripts/backup.js restore <kopia> --data <katalog>.`);
    err.code = 'EDMAT_BAD_DATA_FILE'; throw err;
  }
  store.data = doc;
  store.compact();                                                        // full write of every collection
  const stamp = new Date().toISOString().slice(0, 10);
  let kept = store.file + '.migrated-' + stamp;
  for (let i = 2; fs.existsSync(kept); i++) kept = store.file + '.migrated-' + stamp + '-' + i;
  try { fs.renameSync(store.file, kept); } catch (e) { /* read-only volume: the marker file is enough */ }
  const rows = Object.values(doc).reduce((n, v) => n + (Array.isArray(v) ? v.length : 0), 0);
  if (!o.quiet) console.log(`EdMat: przeniosłem dane z ${path.basename(store.file)} do katalogu ${path.basename(store.dir)}/ (${rows} wierszy, ${Date.now() - started} ms). Stary plik: ${path.basename(kept)}.`);
  return true;
}

/**
 * Applies every migration newer than db.data.meta.version.
 * Returns { from, to, applied:[names], changed } — `changed` is false for up-to-date data.
 */
function migrate(db, opts) {
  const o = opts || {};
  const meta = db.data.meta = db.data.meta || {};
  const from = Number(meta.version) || 0;
  const applied = [];
  for (const m of MIGRATIONS.slice().sort((a, b) => a.version - b.version)) {
    if (m.version <= from) continue;
    m.up(db);
    applied.push(m.name);
    meta.version = m.version;
  }
  if (meta.version !== SCHEMA_VERSION) meta.version = SCHEMA_VERSION;
  const changed = from !== SCHEMA_VERSION;
  if (changed) {
    meta.migratedAt = now();
    meta.migratedFrom = from;
    if (db.file) db.flush();
    if (!o.quiet && applied.length && from > 0) console.log(`EdMat: migracja danych ${from} → ${SCHEMA_VERSION} (${applied.join(', ')}).`);
  }
  return { from, to: SCHEMA_VERSION, applied, changed };
}

module.exports = { migrate, MIGRATIONS, SCHEMA_VERSION, importLegacyFile };
