'use strict';
const fs = require('node:fs'); const path = require('node:path'); const os = require('node:os');
const { id, now, clone } = require('./util');

/* Every store that owns a file registers here, so one signal handler can flush them all. */
const OPEN = new Set();
let handlersInstalled = false;
/** Flushes every open store. Called on SIGTERM/SIGINT/beforeExit/exit — never leaves a debounced write on the floor. */
function flushAll(why) {
  let n = 0;
  for (const s of OPEN) { try { if (s.flush()) n++; } catch (e) { try { console.error(`EdMat: nie udało się zapisać danych przy zamknięciu (${why}): ${e.message}`); } catch (_) {} } }
  return n;
}
function installHandlers() {
  if (handlersInstalled) return; handlersInstalled = true;
  process.on('beforeExit', () => flushAll('beforeExit'));
  process.on('exit', () => { flushAll('exit'); for (const s of Array.from(OPEN)) s.release(); });
  for (const sig of ['SIGTERM', 'SIGINT']) {
    process.on(sig, () => {
      flushAll(sig); for (const s of Array.from(OPEN)) s.release();
      /* Only we listen → nobody is going to shut the server down gracefully, so end the process here. */
      if (process.listenerCount(sig) <= 1) process.exit(0);
    });
  }
}

/** Reads a lock file; returns null when it is missing or unreadable. */
function readLock(p) { try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch (e) { return null; } }
function pidAlive(pid) { try { process.kill(pid, 0); return true; } catch (e) { return e.code === 'EPERM'; } }

/* ------------------------------------------------------------------ the on-disk layout (format 2)
 *
 *   data/school/_store.json        manifest: format, time of the last write, rows/bytes per collection
 *   data/school/<collection>.json  one JSON array per collection — the snapshot
 *   data/school/<collection>.jsonl one op per line for a collection that is written to often
 *   data/school/config.json        every non-array top-level value (config, meta) gets its own file
 *   data/school.json.lock          unchanged: one data directory = one process
 *
 * A write touches only what changed, so an attendance entry appends ~300 bytes instead of rewriting
 * the school. See docs/STORAGE.md for the design, the recovery rules and the measurements.
 */
const FORMAT = 2;
const MARKER = '_store.json';
/* Katalog bajtów, które nie są dokumentami (podpisy, pakiety archiwalne) — patrz server/lib/blobs.js. */
const BLOB_DIR = 'files';
/* Collections that are written to constantly and grow without bound get an append log from the
   start; everything else is promoted automatically once its snapshot passes `hotBytes`.
   `archives` is deliberately NOT here: reliability.md § 5 proposed adding it as an interim measure
   while a single row carried 5–12 MB of XML and base64. Since R3 the bytes live in `files/`
   (server/lib/blobs.js) and an `archives` row is ~3 kB, so the collection is cheap to re-serialise
   and the cold path costs nothing — measured at 600 pupils: archives.json 5.2 MB → 0.0 MB, one
   attendance write + flush 13 ms → 11 ms, a row touch 315 ms → 11 ms. */
const HOT = new Set(['attendance', 'audit', 'notifications', 'lessons', 'grades', 'sessions', 'messages']);
const FSYNC = process.env.EDMAT_FSYNC === '1';

const RAW = Symbol.for('edmat.store.raw');
/** Documents leave the store wrapped in a change-tracking Proxy; unwrap before storing one again. */
function unwrap(v) { return v !== null && typeof v === 'object' && v[RAW] !== undefined ? v[RAW] : v; }
function unwrapAll(v) { return Array.isArray(v) ? v.map(unwrap) : unwrap(v); }

function writeAtomic(file, text) {
  const tmp = file + '.tmp';
  const fd = fs.openSync(tmp, 'w');
  try { fs.writeFileSync(fd, text); if (FSYNC) fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
  fs.renameSync(tmp, file);
}
function appendLines(file, text) {
  const fd = fs.openSync(file, 'a');
  try { fs.writeSync(fd, text); if (FSYNC) fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
}

/**
 * Replays `<collection>.jsonl` over the snapshot array, in file order.
 *   {"op":"i","doc":{…}}  insert (upsert by id — replaying a log over a newer snapshot is harmless)
 *   {"op":"u","id":…,"doc":{…}}  replace the document (`patch` is also accepted and is merged)
 *   {"op":"d","id":…}     delete
 * A line that does not parse is dropped: a crash in the middle of an append leaves a torn last line,
 * and everything before it is still a complete record. Returns { applied, skipped }.
 */
function replayLog(file, arr) {
  let text = ''; try { text = fs.readFileSync(file, 'utf8'); } catch (e) { return { applied: 0, skipped: 0 }; }
  return replayLogText(text, arr);
}
/** The same replay over a log that has already been read — see `readLayout`, which reads every log
 *  before it reads the snapshots so a compaction running in another process cannot make a reader
 *  (a backup) miss the ops the log held. */
function replayLogText(text, arr) {
  if (!text) return { applied: 0, skipped: 0 };
  const lines = text.split('\n');
  const index = new Map();
  for (let i = 0; i < arr.length; i++) if (arr[i] && arr[i].id !== undefined) index.set(arr[i].id, i);
  let applied = 0, skipped = 0, holes = false;
  for (const line of lines) {
    if (!line) continue;
    let op = null;
    try { op = JSON.parse(line); } catch (e) { skipped++; continue; }
    if (!op || typeof op !== 'object') { skipped++; continue; }
    const key = op.id !== undefined ? op.id : (op.doc && op.doc.id);
    if (op.op === 'd') { const at = index.get(key); if (at !== undefined) { arr[at] = undefined; index.delete(key); holes = true; } applied++; continue; }
    const at = key !== undefined ? index.get(key) : undefined;
    if (op.doc) {
      if (at !== undefined) arr[at] = op.doc;
      else { index.set(key, arr.length); arr.push(op.doc); }
    } else if (op.patch && at !== undefined) { Object.assign(arr[at], op.patch); }
    else { skipped++; continue; }
    applied++;
  }
  if (holes) { const kept = arr.filter((x) => x !== undefined); arr.length = 0; for (const x of kept) arr.push(x); }
  return { applied, skipped };
}

/** Moves a file that could not be parsed out of the data directory, so a flush cannot overwrite the
 *  evidence and `_sweepOrphans` cannot delete it. Returns the path it was moved to, or null. */
function quarantine(dir, file) {
  const to = path.join(path.dirname(dir), path.basename(dir) + '-uszkodzone');
  const target = path.join(to, path.basename(file) + '-' + new Date().toISOString().replace(/[:.]/g, '-'));
  try { fs.mkdirSync(to, { recursive: true }); fs.renameSync(file, target); return target; } catch (e) { return null; }
}
/**
 * Reads a format-2 directory back into a plain `{ collection: [...] }` document. Returns null when
 * there is none.
 *
 * Read order matters. Every append log is read **before** the snapshots, because a compaction in the
 * server process writes the new snapshot and only then deletes the log: a reader that took the
 * snapshot first and the log second (a backup running at 02:30 while the school is still clicking)
 * would get the old snapshot and no log at all, and lose everything the log held. Log first means
 * the worst case is an old log replayed over a newer snapshot, which is an idempotent upsert.
 *
 * A snapshot that does not parse — a torn write on a full disk, a truncated restore — no longer
 * takes the whole school down: the file is quarantined next to the data directory, the collection
 * comes back empty (so its append log can still be replayed) and the caller is told in `damaged`.
 */
function readLayout(dir) {
  if (!dir || !fs.existsSync(path.join(dir, MARKER))) return null;
  const data = {}; const files = fs.readdirSync(dir); const logs = {}; const damaged = [];
  let manifest = {};
  try { manifest = (JSON.parse(fs.readFileSync(path.join(dir, MARKER), 'utf8')) || {}).collections || {}; } catch (e) { manifest = {}; }
  const logText = new Map();
  for (const f of files) if (f.endsWith('.jsonl')) { try { logText.set(f.slice(0, -6), fs.readFileSync(path.join(dir, f), 'utf8')); } catch (e) { logText.set(f.slice(0, -6), ''); } }
  for (const f of files) {
    if (f === MARKER || !f.endsWith('.json') || f.endsWith('.tmp')) continue;
    const name = f.slice(0, -5); const file = path.join(dir, f);
    try { data[name] = JSON.parse(fs.readFileSync(file, 'utf8')); }
    catch (e) {
      /* A collection falls back to empty so its log can rebuild what it can; a non-array value
         (config, meta) falls back to null, because half a school's configuration is worse than none. */
      const wasArray = manifest[name] ? typeof manifest[name].rows === 'number' : true;
      data[name] = wasArray ? [] : null;
      damaged.push({ name, file, error: e.message, kept: quarantine(dir, file), rows: manifest[name] ? manifest[name].rows : null });
    }
  }
  for (const [name, text] of logText) {
    if (!Array.isArray(data[name])) data[name] = [];
    logs[name] = replayLogText(text, data[name]);
  }
  return { data, logs, damaged };
}
/** Writes a whole document as a format-2 directory (used by the restore path). */
function writeLayout(dir, data) {
  fs.mkdirSync(dir, { recursive: true });
  /* `files/` nie jest kolekcją — to bajty wierszy (server/lib/blobs.js). Zapis układu ich nie rusza;
     odtworzenie z kopii wpisuje je osobno (scripts/backup.js). */
  const keep = new Set([MARKER, BLOB_DIR]); const manifest = {};
  for (const [k, v] of Object.entries(data || {})) {
    const text = JSON.stringify(v === undefined ? null : v);
    writeAtomic(path.join(dir, k + '.json'), text);
    keep.add(k + '.json');
    manifest[k] = { rows: Array.isArray(v) ? v.length : null, bytes: Buffer.byteLength(text) };
  }
  for (const f of fs.readdirSync(dir)) if (!keep.has(f)) { try { fs.unlinkSync(path.join(dir, f)); } catch (e) {} }
  writeAtomic(path.join(dir, MARKER), JSON.stringify({ format: FORMAT, writtenAt: now(), collections: manifest }));
  return manifest;
}

/* ------------------------------------------------------------------ change tracking
 *
 * The routes never learned about the storage engine: they push into `db.col(name)` and assign
 * straight onto the documents they found. So `db.data`, every collection and every document the
 * store hands out are wrapped in a Proxy that records what changed.
 *
 * The one thing that must not cost anything is reading. A Proxy whose per-element `get` trap runs
 * inside `Array.prototype.filter` costs 8× on the hot path (324 000 attendance rows: 6.0 ms → 57.0 ms,
 * `scripts/bench.js --proxy`), so the collection Proxy never lets an array method iterate through
 * it: `filter`, `some`, `map`, `reduce`… are applied to the raw array and the callback sees raw
 * documents (6.3 ms — inside the noise). Only the *results* of a lookup, the elements yielded by
 * `for…of`/`forEach` and the documents returned by `get`/`one`/`find`/`insert`/`update` come back
 * wrapped, because those are the references a route mutates. Wrapping one document costs ~20 ns.
 *
 * The trade-off: a route that mutated a document from inside a `filter`/`map` callback would slip
 * past. Nothing in this codebase does that, and the fallback is not silent data loss — small
 * collections are verified by re-serialising them on every flush (they are ~1.5 MB in total, ~10 ms),
 * and a hot collection is rewritten in full at every compaction, which picks up anything missed.
 */
/* Only plain objects and arrays are wrapped. A Date, a Buffer or a Map handed back through a Proxy
   would lose its internal slot the moment a method was called on it. */
function trackable(v) {
  if (v === null || typeof v !== 'object' || Object.isFrozen(v)) return false;
  if (Array.isArray(v)) return true;
  const proto = Object.getPrototypeOf(v);
  return proto === Object.prototype || proto === null;
}

function makeCollection(store, name, arr) {
  const st = {
    name, arr, hot: HOT.has(name),
    loggedLen: 0,          // how many of the rows now in `arr` are already durable (snapshot + log)
    /* The documents changed in place since the last flush. Keyed by the document, not by its id:
       two rows that share an id (a bad import, a merge gone wrong) used to collapse into one entry
       and the earlier one's edit was dropped on the floor. Keyed by object, both survive — and
       `_flushHot` notices the clash and falls back to a full snapshot, which is unambiguous. */
    dirty: new Set(),
    removed: [],           // ids deleted from an already-logged part of the array
    force: true,           // rewrite the whole snapshot on the next flush
    logOps: 0, logBytes: 0, snapBytes: 0, lastJson: null, proxy: null,
  };
  const mark = (doc) => { if (doc && doc.id !== undefined) st.dirty.add(doc); else st.force = true; };

  function nested(owner, v) {
    return new Proxy(v, {
      get(t, k) { if (k === RAW) return t; const x = t[k]; return trackable(x) ? nested(owner, x) : x; },
      set(t, k, x) { t[k] = unwrap(x); mark(owner); return true; },
      deleteProperty(t, k) { delete t[k]; mark(owner); return true; },
      defineProperty(t, k, d) { Object.defineProperty(t, k, d); mark(owner); return true; },
    });
  }
  const docH = {
    get(t, k) { if (k === RAW) return t; const v = t[k]; return trackable(v) ? nested(t, v) : v; },
    set(t, k, v) { t[k] = unwrap(v); mark(t); return true; },
    deleteProperty(t, k) { delete t[k]; mark(t); return true; },
    defineProperty(t, k, d) { Object.defineProperty(t, k, d); mark(t); return true; },
  };
  /* Frozen documents (the audit log) are handed back untouched: they cannot change, and a Proxy that
     returned anything but the target's own value for a non-writable property would throw. */
  const wrap = (d) => (trackable(d) ? new Proxy(d, docH) : d);
  st.wrap = wrap;

  const colH = {
    get(t, k) {
      if (typeof k === 'string') {
        switch (k) {
          case 'find': case 'findLast': return (...a) => wrap(t[k](...a));
          case 'at': return (...a) => wrap(t.at(...a));
          case 'filter': return (...a) => t.filter(...a).map(wrap);
          case 'slice': return (...a) => t.slice(...a).map(wrap);
          case 'forEach': return function (cb, th) { for (let i = 0; i < t.length; i++) cb.call(th, wrap(t[i]), i, this); };
          case 'push': return (...a) => t.push(...a.map(unwrap));
          case 'pop': case 'shift': case 'unshift': case 'splice': case 'sort': case 'reverse': case 'fill': case 'copyWithin':
            return (...a) => { st.force = true; return t[k](...a.map(unwrap)); };
          default: break;
        }
        const c = k.charCodeAt(0);
        if (c >= 48 && c <= 57) return wrap(t[k]);        // arr[i] — the reference a route may mutate
      }
      if (k === RAW) return t;
      if (k === Symbol.iterator) return function* () { for (let i = 0; i < t.length; i++) yield wrap(t[i]); };
      const v = t[k];
      return typeof v === 'function' ? v.bind(t) : v;     // every other array method runs on the raw array
    },
    set(t, k, v) { t[k] = unwrapAll(v); st.force = true; return true; },
    deleteProperty(t, k) { delete t[k]; st.force = true; return true; },
  };
  st.proxy = new Proxy(arr, colH);
  st.mark = mark;
  return st;
}

/**
 * Document store. `db.data.<collection>` is an array, `save()` debounces, `flush()` writes only what
 * changed: a per-collection snapshot for the small collections, an append log for the hot ones.
 * One data directory = one process: a lock file next to it keeps two containers off the same volume.
 */
class Store {
  constructor(file, options) {
    const o = Object.assign({
      lock: true, saveDelayMs: 50, maxSaveDelayMs: +process.env.EDMAT_MAX_SAVE_DELAY_MS || 1000,
      warnBytes: 64 * 1024 * 1024, warnFlushMs: 400,
      hotBytes: +process.env.EDMAT_HOT_BYTES || 4 * 1024 * 1024,
      compactOps: +process.env.EDMAT_COMPACT_OPS || 20000,
      legacy: process.env.EDMAT_STORE === 'legacy',
      quiet: false,
    }, options || {});
    this.file = file;                                    // the legacy document path — still the lock's name
    this.dir = file ? file.replace(/\.json$/i, '') : null;
    this.legacy = !!o.legacy;
    this._timer = null; this._dirtySince = 0; this.opts = o;
    this._warnedBytes = 0; this._warnedFlushMs = false; this.lockFile = file ? file + '.lock' : null; this._locked = false;
    this._raw = {}; this._cols = new Map(); this._scalars = new Map(); this._sweep = true;
    this.version = 0;
    this.damaged = []; this._legacyJson = null;
    const self = this;
    this._dataH = {
      get(t, k) { if (k === RAW) return t; const v = t[k]; return Array.isArray(v) ? self._col(k).proxy : v; },
      set(t, k, v) { self._setTop(k, v); return true; },
      deleteProperty(t, k) { delete t[k]; self._cols.delete(k); self._scalars.delete(k); self._sweep = true; return true; },
    };
    this._proxy = new Proxy(this._raw, this._dataH);
    if (file) { if (o.lock) this.lock(); OPEN.add(this); installHandlers(); }
  }

  /* db.data is the same object graph it always was — only wrapped, so the store knows what changed. */
  get data() { return this._proxy; }
  /** `db.data = {}` (demo reset, --reseed, the first-run wizard) is a replace-all. */
  set data(v) {
    const o = unwrap(v) || {};
    for (const k of Object.keys(this._raw)) delete this._raw[k];
    this._cols.clear(); this._scalars.clear(); this._sweep = true;
    for (const [k, val] of Object.entries(o)) this._setTop(k, val);
  }
  _setTop(k, v) {
    const val = unwrapAll(v);
    this._raw[k] = val;
    if (Array.isArray(val)) { this._scalars.delete(k); this._cols.set(k, makeCollection(this, k, val)); }
    else { this._cols.delete(k); this._scalars.set(k, { name: k, lastJson: null }); }
    this._sweep = true;
  }
  /** The tracking state for a collection, created on first use. */
  _col(name) {
    let st = this._cols.get(name);
    if (!st) {
      if (!Array.isArray(this._raw[name])) { this._raw[name] = []; this._sweep = true; }
      st = makeCollection(this, name, this._raw[name]); this._cols.set(name, st);
    }
    return st;
  }

  /** Takes the data-directory lock. A lock left by a process that no longer exists is reclaimed with a warning. */
  lock() {
    if (!this.lockFile || this._locked) return true;
    fs.mkdirSync(path.dirname(this.lockFile), { recursive: true });
    const mine = { pid: process.pid, host: os.hostname(), startedAt: now(), file: this.file };
    for (let attempt = 0; attempt < 2; attempt++) {
      try { fs.writeFileSync(this.lockFile, JSON.stringify(mine), { flag: 'wx' }); this._locked = true; return true; }
      catch (e) {
        if (e.code !== 'EEXIST') throw e;
        const held = readLock(this.lockFile);
        if (held && held.host === mine.host && held.pid && !pidAlive(held.pid)) {
          console.warn(`EdMat: przejmuję osierocony plik blokady ${this.lockFile} (proces ${held.pid} już nie działa).`);
          try { fs.unlinkSync(this.lockFile); } catch (_) {} continue;
        }
        const who = held ? `proces ${held.pid} na ${held.host} od ${held.startedAt}` : 'inny proces';
        const err = new Error(`Katalog danych jest już używany przez ${who}. Jeden katalog danych = jeden proces EdMat (${this.lockFile}).`);
        err.code = 'EDMAT_LOCKED'; err.lock = held; throw err;
      }
    }
    return false;
  }
  /** Releases the lock — only if it is still ours. */
  release() {
    if (!this.lockFile || !this._locked) return;
    const held = readLock(this.lockFile);
    if (!held || held.pid === process.pid) { try { fs.unlinkSync(this.lockFile); } catch (_) {} }
    this._locked = false;
  }

  /**
   * Loads the data directory. A school still stored as one `school.json` is imported into the new
   * layout once (see migrate.js), and the old document is kept as `school.json.migrated-<date>`.
   */
  load() {
    if (!this.file) return false;
    if (this.legacy) { if (!fs.existsSync(this.file)) return false; this.data = JSON.parse(fs.readFileSync(this.file, 'utf8')); this._markClean(); return true; }
    const imported = require('./migrate').importLegacyFile(this, { quiet: this.opts.quiet });
    if (imported) return true;
    const out = readLayout(this.dir);
    if (!out) return false;
    this.data = out.data;
    this.damaged = out.damaged || [];
    if (!this.opts.quiet) for (const d of this.damaged) {
      console.warn(`EdMat: plik ${d.name}.json jest uszkodzony (${d.error}) — odłożyłem go do ${d.kept || 'katalogu obok'} i wczytałem pustą wartość${d.rows ? ` zamiast ${d.rows} wierszy` : ''}. Odtwórz dane z kopii: node scripts/backup.js restore <kopia>.`);
    }
    for (const st of this._cols.values()) { try { st.snapBytes = fs.statSync(path.join(this.dir, st.name + '.json')).size; } catch (e) { st.snapBytes = 0; } }
    for (const [name, r] of Object.entries(out.logs || {})) {
      const st = this._col(name);
      st.hot = true; st.logOps = r.applied; st.logBytes = 0;
      try { st.logBytes = fs.statSync(path.join(this.dir, name + '.jsonl')).size; } catch (e) {}
      if (r.skipped && !this.opts.quiet) console.warn(`EdMat: pominięto ${r.skipped} uszkodzon${r.skipped === 1 ? 'ą linię' : 'ych linii'} w dzienniku ${name}.jsonl (zapis przerwany w połowie) — reszta odtworzona.`);
    }
    this._markClean();
    return true;
  }
  /** Everything currently in memory came from disk: nothing to write until something changes. */
  _markClean() {
    for (const st of this._cols.values()) {
      st.force = false; st.loggedLen = st.arr.length; st.dirty.clear(); st.removed.length = 0;
      st.lastJson = st.hot ? null : JSON.stringify(st.arr);
    }
    for (const [name, sc] of this._scalars) sc.lastJson = JSON.stringify(this._raw[name] === undefined ? null : this._raw[name]);
    if (this.legacy) this._legacyJson = JSON.stringify(this._raw);
    this._sweep = false;
  }

  col(name) { return this._col(name).proxy; }
  get(name, idv) { const st = this._col(name); return st.wrap(st.arr.find((x) => x.id === idv)) || null; }
  find(name, pred) { const st = this._col(name); return st.arr.filter(pred || (() => true)).map(st.wrap); }
  one(name, pred) { const st = this._col(name); return st.wrap(st.arr.find(pred)) || null; }
  insert(name, doc) {
    const st = this._col(name);
    const d = Object.assign({ id: id(name.slice(0, 3)) }, unwrap(doc));
    if (d.createdAt === undefined) d.createdAt = now();
    st.arr.push(d); this.save(); return st.wrap(d);
  }
  update(name, idv, patch) {
    const st = this._col(name); const d = st.arr.find((x) => x.id === idv);
    if (!d) return null;
    Object.assign(d, unwrap(patch), { updatedAt: now() }); st.mark(d); this.save(); return st.wrap(d);
  }
  remove(name, idv) {
    const st = this._col(name); const i = st.arr.findIndex((x) => x.id === idv);
    if (i < 0) return false;
    const doc = st.arr[i];
    st.arr.splice(i, 1);
    /* A row that was already on disk needs a delete op; one that was still only in the pending tail
       just disappears, and `loggedLen` keeps pointing at the start of that tail. */
    if (i < st.loggedLen) { st.loggedLen--; st.removed.push(idv); }
    st.dirty.delete(doc);
    this.save(); return true;
  }

  /**
   * Schedules a write. The 50 ms debounce coalesces a burst, but it is capped: under continuous
   * traffic every save() used to re-arm the timer, so the file could go unwritten for as long as
   * the school kept clicking. After maxSaveDelayMs the write happens no matter what.
   */
  save() {
    /* Monotoniczny licznik zmian: „czy od ostatniego razu cokolwiek się zmieniło?”. Tyle wystarczy,
       żeby trasy mogły trzymać wyliczony wynik w pamięci i odświeżać go dopiero, gdy dane drgnęły
       (R3-03/R3-07). Rośnie także wtedy, gdy magazyn nie ma katalogu danych (testy). */
    this.version++;
    if (!this.file) return;
    const t = Date.now();
    if (!this._dirtySince) this._dirtySince = t;
    if (t - this._dirtySince >= this.opts.maxSaveDelayMs) { this.flush(); return; }
    clearTimeout(this._timer);
    this._timer = setTimeout(() => this.flush(), this.opts.saveDelayMs);
    if (this._timer.unref) this._timer.unref();
  }

  /** Writes everything that changed. Returns true when something was actually written. */
  flush(opts) {
    if (!this.file) return false;
    clearTimeout(this._timer); this._timer = null; this._dirtySince = 0;
    if (this.legacy) return this._legacyFlush();
    const o = opts || {};
    const started = Date.now();
    fs.mkdirSync(this.dir, { recursive: true });
    let wrote = false;
    const manifest = {};
    for (const [name, sc] of this._scalars) wrote = this._writeScalar(name, sc) || wrote;
    for (const [name, st] of this._cols) {
      const w = st.hot && !o.compact ? this._flushHot(st) : this._writeSnapshot(st);
      wrote = w || wrote;
      manifest[name] = { rows: st.arr.length, bytes: st.snapBytes, log: st.logOps || undefined };
    }
    for (const [name, sc] of this._scalars) manifest[name] = { bytes: sc.lastJson ? Buffer.byteLength(sc.lastJson) : 0 };
    if (this._sweep) { this._sweepOrphans(); wrote = true; }
    if (wrote) {
      writeAtomic(path.join(this.dir, MARKER), JSON.stringify({ format: FORMAT, writtenAt: now(), collections: manifest }));
      this._guard(this._bytes(), Date.now() - started);
    }
    return wrote;
  }
  /** Forces a full rewrite of every collection: the belt-and-braces path (close, backup, tests). */
  compact() { return this.flush({ compact: true }); }

  /** A small collection is cheap to re-serialise, so it is verified rather than tracked. */
  _writeSnapshot(st) {
    const text = JSON.stringify(st.arr);
    st.snapBytes = Buffer.byteLength(text);
    const changed = st.force || st.dirty.size > 0 || st.removed.length > 0 || st.loggedLen !== st.arr.length || text !== st.lastJson;
    st.force = false; st.dirty.clear(); st.removed.length = 0; st.loggedLen = st.arr.length;
    /* A collection that outgrows hotBytes gets an append log from now on — nothing else has to know. */
    if (!st.hot && st.snapBytes > this.opts.hotBytes) st.hot = true;
    st.lastJson = st.hot ? null : text;                  // a hot collection is tracked, not compared
    if (!changed) return false;
    writeAtomic(path.join(this.dir, st.name + '.json'), text);
    const log = path.join(this.dir, st.name + '.jsonl');
    if (st.logOps || fs.existsSync(log)) { try { fs.unlinkSync(log); } catch (e) {} }
    st.logOps = 0; st.logBytes = 0;
    return true;
  }
  /** A hot collection writes only the ops since the last flush; the snapshot is rebuilt at compaction. */
  _flushHot(st) {
    if (st.force) return this._writeSnapshot(st);
    const appended = st.arr.length > st.loggedLen ? st.arr.slice(st.loggedLen) : [];
    if (!appended.length && !st.dirty.size && !st.removed.length) { st.snapBytes = st.snapBytes || 0; return false; }
    /* The log records inserts, then updates, then deletes — it is not a chronological journal. Two
       cases make that order ambiguous, and both end in a full snapshot instead of a wrong replay:
       an id that was removed and inserted again inside the same flush window (the delete would win
       and eat the new row), and two rows in the window carrying the same id (one update would be
       replayed onto the other's slot). */
    const byId = new Map(); const removedIds = new Set(st.removed);
    for (const d of appended) { if (!d || d.id === undefined || removedIds.has(d.id) || byId.has(d.id)) return this._writeSnapshot(st); byId.set(d.id, d); }
    for (const d of st.dirty) { if (d.id === undefined || removedIds.has(d.id)) return this._writeSnapshot(st); const prev = byId.get(d.id); if (prev !== undefined && prev !== d) return this._writeSnapshot(st); byId.set(d.id, d); }
    const lines = [];
    for (const d of appended) lines.push(JSON.stringify({ op: 'i', doc: d }));
    for (const d of st.dirty) lines.push(JSON.stringify({ op: 'u', id: d.id, doc: d }));
    for (const rid of st.removed) lines.push(JSON.stringify({ op: 'd', id: rid }));
    const text = lines.join('\n') + '\n';
    appendLines(path.join(this.dir, st.name + '.jsonl'), text);
    st.logOps += lines.length; st.logBytes += Buffer.byteLength(text);
    st.loggedLen = st.arr.length; st.dirty.clear(); st.removed.length = 0;
    /* Compaction keeps startup and the log bounded — and rewrites the snapshot from memory, which is
       also what makes any change the tracker could not see durable. */
    if (st.logOps >= this.opts.compactOps || st.logBytes >= Math.max(st.snapBytes / 2, 256 * 1024)) this._writeSnapshot(st);
    return true;
  }
  _writeScalar(name, sc) {
    const text = JSON.stringify(this._raw[name] === undefined ? null : this._raw[name]);
    if (text === sc.lastJson) return false;
    writeAtomic(path.join(this.dir, name + '.json'), text);
    sc.lastJson = text; return true;
  }
  /**
   * Gdzie leżą bajty, które nie są dokumentami: `<data>/school/files/<kolekcja>/<id>/<plik>`.
   * Jedyna bramka do tego katalogu to `server/lib/blobs.js`; magazyn wie o nim po to, żeby
   * `scripts/backup.js` miał co skopiować, a `_sweepOrphans` wiedział, czego nie ruszać.
   */
  blobDir() { return this.dir ? path.join(this.dir, BLOB_DIR) : null; }
  /** Pliki wierszy do kopii zapasowej: `[{ path: 'files/<kolekcja>/<id>/<plik>', bytes }]`. */
  blobFiles() {
    const base = this.blobDir(); const out = [];
    if (!base) return out;
    const walk = (abs, rel) => {
      let names = []; try { names = fs.readdirSync(abs); } catch (e) { return; }
      for (const n of names.sort()) {
        if (!/^[A-Za-z0-9._-]+$/.test(n) || /\.tmp-/.test(n)) continue;
        let st; try { st = fs.statSync(path.join(abs, n)); } catch (e) { continue; }
        if (st.isDirectory()) walk(path.join(abs, n), rel + n + '/');
        else if (st.isFile()) out.push({ path: rel + n, bytes: st.size });
      }
    };
    walk(base, BLOB_DIR + '/');
    return out;
  }
  /** Removes the files of collections that no longer exist (a replace-all, a forgotten collection). */
  _sweepOrphans() {
    this._sweep = false;
    /* `files/` to nie kolekcja — trzyma bajty wierszy (server/lib/blobs.js) i sprzątanie po
       kolekcjach nigdy go nie dotyka. */
    const keep = new Set([MARKER, BLOB_DIR]);
    for (const k of Object.keys(this._raw)) { keep.add(k + '.json'); keep.add(k + '.jsonl'); }
    let files = []; try { files = fs.readdirSync(this.dir); } catch (e) { return; }
    for (const f of files) if (!keep.has(f)) { try { fs.unlinkSync(path.join(this.dir, f)); } catch (e) {} }
  }
  _bytes() {
    let total = 0;
    try { for (const f of fs.readdirSync(this.dir)) { try { total += fs.statSync(path.join(this.dir, f)).size; } catch (e) {} } } catch (e) {}
    return total;
  }
  /** The legacy single-document writer, kept behind EDMAT_STORE=legacy for the before/after benchmark. */
  _legacyFlush() {
    const started = Date.now();
    const json = JSON.stringify(this._raw);
    /* Nothing changed → no write. The engine under test has to be the only difference in the
       benchmark, and a flush() that rewrites 200 MB because a timer fired is not a measurement. */
    if (json === this._legacyJson && fs.existsSync(this.file)) return false;
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    const tmp = this.file + '.tmp';
    fs.writeFileSync(tmp, json); fs.renameSync(tmp, this.file);
    this._legacyJson = json;
    this._guard(Buffer.byteLength(json), Date.now() - started);
    return true;
  }

  /** Warns once per doubling when the store outgrows what a single Node process should carry. */
  _guard(bytes, ms) {
    if (bytes >= this.opts.warnBytes && bytes >= this._warnedBytes * 2) {
      this._warnedBytes = bytes;
      const rows = Object.values(this._raw).reduce((n, v) => n + (Array.isArray(v) ? v.length : 0), 0);
      console.warn(`EdMat: dane szkoły zajmują ${(bytes / 1048576).toFixed(0)} MB (${rows} wierszy). Powyżej ~100 MB / ~500 000 wierszy przenieś magazyn na SQLite — patrz docs/STORAGE.md.`);
    }
    if (ms >= this.opts.warnFlushMs && !this._warnedFlushMs) { this._warnedFlushMs = true; console.warn(`EdMat: zapis danych trwał ${ms} ms i blokuje na ten czas cały serwer (docs/STORAGE.md).`); }
  }

  /** Final flush + lock release. Safe to call twice. */
  close() { try { this.flush(); } finally { this.release(); OPEN.delete(this); } }
  snapshot() { return clone(this._raw); }
  /** Rough size report for /api/health and the size guard. */
  stats() {
    const rows = {}; let total = 0;
    for (const [k, v] of Object.entries(this._raw)) if (Array.isArray(v)) { rows[k] = v.length; total += v.length; }
    let bytes = null;
    try {
      if (this.legacy) bytes = this.file && fs.existsSync(this.file) ? fs.statSync(this.file).size : null;
      else bytes = this.dir && fs.existsSync(this.dir) ? this._bytes() : null;
    } catch (e) { bytes = null; }
    return { rows, totalRows: total, bytes };
  }
}
module.exports = { Store, flushAll, readLayout, writeLayout, replayLog, replayLogText, FORMAT, MARKER, BLOB_DIR, HOT, RAW, unwrap };
