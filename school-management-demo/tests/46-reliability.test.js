'use strict';
/* Reliability: health endpoint, the per-collection storage engine (incremental flush, append log,
   compaction, recovery, migration from the single file), shutdown flush, data-directory lock,
   backup/restore round trip, per-user offline queue, audit retention.
   See docs/review/reliability.md and docs/STORAGE.md. */
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');
const { spawnSync, spawn } = require('node:child_process');
const { startServer, withConfig } = require('./helpers');
const { Store, readLayout, writeLayout } = require('../server/lib/store');

/** The store keeps one file per collection under <data>/school/ — read it back as one document. */
function onDisk(dataFile) { const out = readLayout(dataFile.replace(/\.json$/, '')); return out ? out.data : null; }
function fileOf(dataFile, name) { return path.join(dataFile.replace(/\.json$/, ''), name); }
function mtimes(dir) { const m = {}; for (const f of fs.readdirSync(dir)) m[f] = fs.statSync(path.join(dir, f)).mtimeMs; return m; }

const ROOT = path.join(__dirname, '..');
const tmpDirs = [];
function tmp(name) { const d = fs.mkdtempSync(path.join(os.tmpdir(), 'edmat-' + name + '-')); tmpDirs.push(d); return d; }
test.after(() => { for (const d of tmpDirs) { try { fs.rmSync(d, { recursive: true, force: true }); } catch (e) {} } });

/* ---------------------------------------------------------------- health ---------------- */
test('health: /api/health is public, answers 200 and carries no school data', async () => {
  const S = await startServer();
  try {
    const anon = S.client();
    const r = await anon.get('/api/health');
    assert.equal(r.status, 200);
    assert.equal(r.body.status, 'ok');
    assert.equal(typeof r.body.schemaVersion, 'number');
    assert.ok(r.body.uptimeSec >= 0);
    const text = JSON.stringify(r.body);
    for (const leak of ['school', 'users', 'students', 'config', 'name']) assert.ok(!text.includes('"' + leak + '"'), 'health leaks ' + leak + ': ' + text);
  } finally { await S.close(); }
});

test('health: answers before the school is configured (blank install, setup_required everywhere else)', async () => {
  const S = await startServer({ blank: true });
  try {
    const anon = S.client();
    assert.equal((await anon.get('/api/health')).status, 200);
    const other = await anon.get('/api/lessons');
    assert.equal(other.status, 503);
    assert.equal(other.body.code, 'setup_required');
  } finally { await S.close(); }
});

/* ------------------------------------------------------------- migrations -------------- */
test('migrations: a fresh store is stamped with meta.version and re-opening applies nothing', async () => {
  const dir = tmp('migrate');
  const file = path.join(dir, 'school.json');
  const { createApp } = require('../server/index');
  const a = createApp({ dataFile: file, blank: true, quiet: true });
  assert.equal(a.migration.to, require('../server/lib/migrate').SCHEMA_VERSION);
  assert.equal(a.migration.from, 0);
  assert.equal(a.db.data.meta.version, a.migration.to);
  a.db.close();
  const b = createApp({ dataFile: file, quiet: true });
  assert.equal(b.migration.changed, false, 'second open must not re-run migrations');
  assert.deepEqual(b.migration.applied, []);
  b.db.close();
});

/* ------------------------------------------------------- the storage engine ------------ */
/* REL-05: one JSON document rewritten on every save reached 117 MB after five months and 209 MB
   after a year, and every write blocked the whole school for 1.9–3.7 s. The store now keeps one
   file per collection and an append log for the hot ones. docs/STORAGE.md has the measurements. */

test('store: a flush writes only the collections that changed', () => {
  const dir = tmp('incremental');
  const file = path.join(dir, 'school.json');
  const db = new Store(file);
  db.data = {};
  db.data.config = { school: { name: 'Szkoła' } };
  for (let i = 0; i < 5; i++) db.col('students').push({ id: 'st' + i, firstName: 'A', lastName: 'B' + i });
  for (let i = 0; i < 5; i++) db.col('attendance').push({ id: 'att' + i, lessonId: 'les1', studentId: 'st' + i, status: 'ob' });
  db.flush();
  const storeDir = fileOf(file, '');
  assert.ok(fs.existsSync(path.join(storeDir, 'students.json')), 'every collection gets its own file');
  assert.ok(fs.existsSync(path.join(storeDir, 'attendance.json')));
  assert.ok(fs.existsSync(path.join(storeDir, 'config.json')), 'config is a file of its own');

  const before = mtimes(storeDir);
  const row = db.get('attendance', 'att3');
  row.status = 'nb';                                  // the way every route writes: mutate what it found
  db.flush();
  const after = mtimes(storeDir);
  assert.equal(after['students.json'], before['students.json'], 'an attendance write must not rewrite the pupils');
  assert.equal(after['config.json'], before['config.json'], 'nor the configuration');
  assert.equal(after['attendance.json'], before['attendance.json'], 'nor the attendance snapshot — the change is appended');
  assert.ok(fs.existsSync(path.join(storeDir, 'attendance.jsonl')), 'the change went into the append log');
  db.close();

  const again = new Store(file); again.load();
  assert.equal(again.get('attendance', 'att3').status, 'nb', 'the appended change comes back');
  assert.equal(again.col('students').length, 5);
  again.close();
});

test('store: a hot collection appends, compacts, and survives a torn last log line', () => {
  const dir = tmp('appendlog');
  const file = path.join(dir, 'school.json');
  const db = new Store(file, { compactOps: 40 });
  db.data = {};
  db.data.config = { school: { name: 'Szkoła' } };
  db.col('attendance').push({ id: 'att0', status: 'ob' });
  db.flush();                                         // snapshot: one row
  for (let i = 1; i <= 9; i++) { db.col('attendance').push({ id: 'att' + i, status: 'ob' }); db.flush(); }
  assert.equal(JSON.parse(fs.readFileSync(fileOf(file, 'attendance.json'), 'utf8')).length, 1, 'the snapshot was not rewritten');
  const log = fs.readFileSync(fileOf(file, 'attendance.jsonl'), 'utf8').trim().split('\n');
  assert.equal(log.length, 9, 'one line per appended row');
  assert.deepEqual(JSON.parse(log[0]), { op: 'i', doc: { id: 'att1', status: 'ob' } });
  db.close();

  // a crash in the middle of an append leaves half a line; everything before it is still a record
  fs.appendFileSync(fileOf(file, 'attendance.jsonl'), '{"op":"i","doc":{"id":"att_urwan","sta');
  const recovered = new Store(file, { compactOps: 40, quiet: true });
  assert.equal(recovered.load(), true);
  assert.equal(recovered.col('attendance').length, 10, 'the torn last line is ignored, the rest is replayed');
  assert.equal(recovered.col('attendance').some((a) => a.id === 'att_urwan'), false);

  // past the threshold the log is folded back into the snapshot
  for (let i = 10; i < 60; i++) { recovered.col('attendance').push({ id: 'att' + i, status: 'ob' }); recovered.flush(); }
  const snapshot = JSON.parse(fs.readFileSync(fileOf(file, 'attendance.json'), 'utf8'));
  assert.ok(snapshot.length >= 41, `compaction rewrote the snapshot from memory (${snapshot.length} rows)`);
  const afterCompaction = fs.existsSync(fileOf(file, 'attendance.jsonl')) ? fs.readFileSync(fileOf(file, 'attendance.jsonl'), 'utf8').trim() : '';
  assert.ok(afterCompaction.split('\n').filter(Boolean).length < 40, 'and dropped the ops it had folded in');
  assert.equal(recovered.col('attendance').length, 60);
  recovered.close();

  const reread = new Store(file); reread.load();
  assert.equal(reread.col('attendance').length, 60);
  reread.close();
});

test('store: a removed row is deleted on replay, not resurrected', () => {
  const dir = tmp('removals');
  const file = path.join(dir, 'school.json');
  const db = new Store(file);
  db.data = {};
  for (let i = 0; i < 6; i++) db.col('notifications').push({ id: 'n' + i, read: false });
  db.flush();
  db.remove('notifications', 'n2');
  db.update('notifications', 'n4', { read: true });
  db.col('notifications').push({ id: 'n9', read: false });
  db.flush();
  db.close();
  const back = new Store(file); back.load();
  assert.deepEqual(back.col('notifications').map((n) => n.id), ['n0', 'n1', 'n3', 'n4', 'n5', 'n9']);
  assert.equal(back.get('notifications', 'n4').read, true);
  back.close();
});

test('store: `db.data = {}` (demo reset, --reseed) replaces everything and removes the old files', () => {
  const dir = tmp('replaceall');
  const file = path.join(dir, 'school.json');
  const db = new Store(file);
  db.data = {};
  db.data.config = { school: { name: 'Pierwsza' } };
  db.col('students').push({ id: 'st1' });
  db.col('attendance').push({ id: 'att1', status: 'ob' });
  db.flush();
  assert.ok(fs.existsSync(fileOf(file, 'students.json')));

  db.data = {};                                       // replace-all, exactly like /api/demo/reset
  db.data.config = { school: { name: 'Druga' } };
  db.col('classes').push({ id: '7b' });
  db.flush();
  assert.equal(fs.existsSync(fileOf(file, 'students.json')), false, 'the old collection files are gone');
  assert.equal(fs.existsSync(fileOf(file, 'attendance.jsonl')), false);
  assert.ok(fs.existsSync(fileOf(file, 'classes.json')));
  db.close();

  const back = new Store(file); back.load();
  assert.deepEqual(Object.keys(back.data).sort(), ['classes', 'config']);
  assert.equal(back.data.config.school.name, 'Druga');
  back.close();
});

test('store: a school still kept as one school.json is imported into the new layout once', () => {
  const dir = tmp('legacy');
  const file = path.join(dir, 'school.json');
  const legacy = {
    meta: { version: 1, seededAt: '2026-09-01T06:00:00.000Z' },
    config: { school: { name: 'Stara Szkoła' }, today: '2026-10-23' },
    users: [{ id: 'u1', login: 'admin', role: 'admin' }],
    students: [{ id: 'st1', firstName: 'Ala', lastName: 'Kowalska' }],
    attendance: [{ id: 'a1', lessonId: 'l1', studentId: 'st1', status: 'ob' }],
  };
  fs.writeFileSync(file, JSON.stringify(legacy));

  const db = new Store(file, { quiet: true });
  assert.equal(db.load(), true);
  assert.equal(db.col('students').length, 1);
  assert.equal(db.data.config.school.name, 'Stara Szkoła');
  assert.ok(fs.existsSync(fileOf(file, '_store.json')), 'the per-collection layout was written');
  assert.equal(fs.existsSync(file), false, 'the old document is not left where it would be re-imported');
  assert.ok(fs.readdirSync(dir).some((f) => /^school\.json\.migrated-\d{4}-\d{2}-\d{2}/.test(f)), 'it is kept next to it');
  db.close();

  // the schema migration runs on top of the import and is not repeated
  const { createApp } = require('../server/index');
  const app = createApp({ dataFile: file, quiet: true });
  assert.equal(app.migration.from, 1);
  assert.equal(app.migration.to, require('../server/lib/migrate').SCHEMA_VERSION);
  assert.equal(app.db.col('students')[0].firstName, 'Ala');
  app.db.close();
  const app2 = createApp({ dataFile: file, quiet: true });
  assert.equal(app2.migration.changed, false, 'the import and the migration both happen once');
  assert.equal(app2.db.col('attendance').length, 1);
  app2.db.close();
});

test('store: a collection behaves exactly like the array it wraps', () => {
  const db = new Store(null);                         // in-memory: the tracking Proxy is still there
  db.data = {};
  const rows = [{ id: 'a', n: 1, tags: ['x'] }, { id: 'b', n: 2, tags: [] }, { id: 'c', n: 3, tags: [] }];
  for (const r of rows) db.col('grades').push(r);
  const col = db.col('grades');

  assert.ok(Array.isArray(col), 'Array.isArray');
  assert.equal(col.length, 3);
  assert.equal(JSON.stringify(col), JSON.stringify(rows), 'JSON.stringify of a collection is the plain data');
  assert.equal(JSON.stringify(db.data.grades), JSON.stringify(rows));
  assert.deepEqual(JSON.parse(JSON.stringify(db.data)), { grades: rows });
  const seen = []; for (const g of col) seen.push(g.n);
  assert.deepEqual(seen, [1, 2, 3], 'for…of');
  assert.deepEqual([...col].map((g) => g.id), ['a', 'b', 'c'], 'spread');
  assert.equal(col.find((g) => g.id === 'b').n, 2, '.find');
  assert.equal(col.filter((g) => g.n > 1).length, 2, '.filter');
  assert.deepEqual(col.map((g) => g.id), ['a', 'b', 'c'], '.map');
  assert.equal(col.some((g) => g.n === 3), true);
  assert.equal(col.every((g) => g.n > 0), true);
  assert.equal(col.reduce((s, g) => s + g.n, 0), 6);
  assert.equal(col[1].id, 'b', 'index access');
  assert.equal(col.at(-1).id, 'c');
  assert.deepEqual(Object.keys(col), ['0', '1', '2']);
  assert.deepEqual(col.slice(1).map((g) => g.id), ['b', 'c']);
  assert.deepEqual(col.sort((x, y) => y.n - x.n).map((g) => g.id), ['c', 'b', 'a'], 'even a mutator behaves');

  // and the documents it hands out are still ordinary documents to write to
  const g = db.get('grades', 'b');
  g.n = 20; g.tags.push('nowy');
  assert.equal(db.col('grades').find((x) => x.id === 'b').n, 20);
  assert.deepEqual(db.col('grades').find((x) => x.id === 'b').tags, ['nowy']);
  assert.equal(JSON.stringify(db.snapshot().grades.find((x) => x.id === 'b').tags), '["nowy"]');
});

/* --------------------------------------------------------------- shutdown -------------- */
/**
 * Czeka na wyjście dziecka po SIGTERM — ale NIGDY bez końca. Pod obciążeniem zdarzyło się, że
 * dziecko nie zareagowało na pierwszy sygnał, a `await new Promise((r) => p.on('exit', r))`
 * zamieniał to w zawieszony `node --test`: na maszynie recenzenta żyły trzy takie procesy,
 * najstarszy prawie siedem godzin (docs/review/round3/test-honesty.md §4.1). W CI to limit
 * czasu zadania i brak werdyktu, czyli coś gorszego niż czerwony test. Po 10 s wysyłamy drugi
 * sygnał, po kolejnych 5 s SIGKILL — i zgłaszamy nazwany błąd zamiast wisieć.
 */
/**
 * Ostatnia deska ratunku: cokolwiek się w teście wydarzyło, dziecko NIE zostaje przy życiu.
 * Osierocony proces trzyma odziedziczone `stderr` biegu testów, więc `node --test` nie kończy
 * się wcale — i tak właśnie wygląda zawieszony przebieg z §4.1 raportu (asercja wywalała się
 * przed `p.kill`, a wraz z nią przepadało sprzątanie).
 */
function reap(p) { try { if (p.exitCode === null && !p.signalCode) p.kill('SIGKILL'); } catch (e) {} }
async function killAndWait(p, what) {
  const exited = (ms) => new Promise((resolve) => {
    if (p.exitCode !== null || p.signalCode) return resolve(true);
    const t = setTimeout(() => resolve(false), ms);
    p.on('exit', () => { clearTimeout(t); resolve(true); });
  });
  p.kill('SIGTERM');
  if (await exited(10000)) return true;
  p.kill('SIGTERM');                       // drugi sygnał: pierwszy bywa gubiony przy zagłodzonej pętli
  if (await exited(5000)) { assert.fail('dziecko zareagowało dopiero na DRUGI SIGTERM — ' + what); }
  p.kill('SIGKILL');
  await exited(5000);
  assert.fail('dziecko nie zareagowało na SIGTERM w ciągu 15 s — ' + what);
  return false;
}
test('shutdown: SIGTERM flushes a debounced write instead of losing it', async () => {
  const dir = tmp('sigterm');
  const file = path.join(dir, 'school.json');
  const child = path.join(dir, 'child.js');
  fs.writeFileSync(child, `
    const { Store } = require(${JSON.stringify(path.join(ROOT, 'server/lib/store'))});
    /* Odstęp zapisu liczony w minutach, nie w 50 ms: na obciążonej maszynie domyślny debounce
       zdążył wystrzelić, zanim rodzic zdążył zajrzeć na dysk, i test przewracał się na
       „the write must still be pending” — kolejne założenie o zegarze, a nie o kodzie
       (docs/review/round3/test-honesty.md §4.1). Z długim odstępem JEDYNĄ drogą tego wiersza
       na dysk jest zrzut przy SIGTERM, czyli dokładnie to, co ten test bada. */
    const db = new Store(${JSON.stringify(file)}, { saveDelayMs: 600000, maxSaveDelayMs: 600000 });
    db.data = { rows: [] };
    db.flush();
    db.col('rows').push({ id: 'nie-zgub-mnie' });
    db.save();              // debounced: nothing on disk yet
    console.log('ready');
    setInterval(() => {}, 1000);
  `);
  const p = spawn(process.execPath, [child], { stdio: ['ignore', 'pipe', 'inherit'] });
  try {
    await new Promise((resolve, reject) => { p.stdout.on('data', (b) => { if (String(b).includes('ready')) resolve(); }); p.on('error', reject); });
    assert.equal(onDisk(file).rows.length, 0, 'the write must still be pending');
    await killAndWait(p, 'zapis mógł nie zostać zrzucony');
    const after = onDisk(file);
    assert.equal(after.rows.length, 1, 'SIGTERM must flush the pending write');
    assert.equal(after.rows[0].id, 'nie-zgub-mnie');
    assert.equal(fs.existsSync(file + '.lock'), false, 'the lock must be released on shutdown');
  } finally { reap(p); }
});

test('shutdown: the debounce is capped, so continuous traffic cannot starve the write', async () => {
  const dir = tmp('debounce');
  const never = new Store(path.join(dir, 'a.json'), { lock: false, maxSaveDelayMs: 1e9 });
  const capped = new Store(path.join(dir, 'b.json'), { lock: false, maxSaveDelayMs: 100 });
  for (const s of [never, capped]) { s.data = { rows: [] }; s.flush(); }
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const until = Date.now() + 400;
  while (Date.now() < until) { for (const s of [never, capped]) { s.col('rows').push({ t: Date.now() }); s.save(); } await sleep(10); }
  const rowsOnDisk = (s) => onDisk(s.file).rows.length;
  assert.equal(rowsOnDisk(never), 0, 'unbounded debounce keeps the store empty while writes keep coming');
  assert.ok(rowsOnDisk(capped) > 0, 'capped debounce writes even under continuous traffic');
  never.close(); capped.close();
});

/* ------------------------------------------------------------------- lock -------------- */
test('lock: a second process refuses to open the same data directory, a dead one is reclaimed', () => {
  const dir = tmp('lock');
  const file = path.join(dir, 'school.json');
  const a = new Store(file); a.data = { rows: [] }; a.flush();
  assert.ok(fs.existsSync(file + '.lock'));
  assert.throws(() => new Store(file), (e) => e.code === 'EDMAT_LOCKED');
  a.close();
  const b = new Store(file); b.close();               // released → free again
  // a lock left behind by a process that no longer exists is reclaimed
  fs.writeFileSync(file + '.lock', JSON.stringify({ pid: 999999, host: os.hostname(), startedAt: new Date().toISOString() }));
  const c = new Store(file);
  assert.equal(JSON.parse(fs.readFileSync(file + '.lock', 'utf8')).pid, process.pid);
  c.close();
});

/* ----------------------------------------------------------------- backup -------------- */
function backupCli(args, env) {
  return spawnSync(process.execPath, [path.join(ROOT, 'scripts', 'backup.js')].concat(args), { encoding: 'utf8', env: Object.assign({}, process.env, env || {}) });
}

test('backup/restore: round trip keeps every row and refuses to overwrite a running instance', async () => {
  const dataDir = tmp('backup-data');
  const outDir = tmp('backup-out');
  const file = path.join(dataDir, 'school.json');
  const { createApp } = require('../server/index');
  const app = createApp({ dataFile: file, blank: true, quiet: true });
  app.db.col('students').push({ id: 'st_test', firstName: 'Anna', lastName: 'Testowa', classId: '7b' });
  app.db.col('users').push({ id: 'u_test', login: 'test', role: 'admin', firstName: 'A', lastName: 'T' });
  app.db.flush();
  const before = app.db.stats().totalRows;

  // the server is up: restore must refuse, backup must not
  const b = backupCli(['backup', '--data', dataDir, '--out', outDir]);
  assert.equal(b.status, 0, b.stderr);
  const backups = fs.readdirSync(outDir).filter((f) => f.endsWith('.json.gz'));
  assert.equal(backups.length, 1);
  const archive = path.join(outDir, backups[0]);

  const refused = backupCli(['restore', archive, '--data', dataDir, '--yes']);
  assert.equal(refused.status, 4, 'restore must refuse while the data directory is locked');
  assert.match(refused.stderr, /działa|trzyma/);

  // stop the server, wreck the data, restore
  app.db.close();
  writeLayout(path.join(dataDir, 'school'), { config: { school: { name: 'zepsute' } }, users: [], students: [] });
  const dry = backupCli(['restore', archive, '--data', dataDir]);
  assert.equal(dry.status, 1, 'without --yes it is a dry run');
  assert.equal(onDisk(file).students.length, 0);
  const done = backupCli(['restore', archive, '--data', dataDir, '--yes']);
  assert.equal(done.status, 0, done.stderr);
  const restored = onDisk(file);
  assert.equal(restored.students.length, 1);
  assert.equal(restored.students[0].id, 'st_test');
  assert.equal(Object.values(restored).reduce((n, v) => n + (Array.isArray(v) ? v.length : 0), 0), before);
  assert.ok(fs.readdirSync(dataDir).some((f) => f.startsWith('school-przed-odtworzeniem-')), 'the replaced file is kept');

  // the restored file opens as a working school
  const app2 = createApp({ dataFile: file, quiet: true });
  assert.equal(app2.db.col('students').length, 1);
  app2.db.close();

  // a corrupt archive is rejected, never written
  const bad = path.join(outDir, 'school-bad.json');
  fs.writeFileSync(bad, '{"users":[]}');
  assert.equal(backupCli(['restore', bad, '--data', dataDir, '--yes']).status, 3);
  assert.equal(backupCli(['verify', archive]).status, 0);
});

test('backup/restore: an anonymised backup restores into a test data directory', async () => {
  const S = await startServer();
  let snapshot;
  try {
    const admin = await S.as('admin');
    const r = await admin.post('/api/admin/backup/anonymized', { json: true, reason: 'środowisko testowe' });
    assert.equal(r.status, 200, JSON.stringify(r.body).slice(0, 200));
    snapshot = r.body.snapshot;
    assert.ok(snapshot && snapshot.config, 'the endpoint returns a whole store document');
  } finally { await S.close(); }

  const dataDir = tmp('anon-data');
  const file = path.join(dataDir, 'kopia.json');
  fs.writeFileSync(file, JSON.stringify(snapshot));
  const out = backupCli(['restore', file, '--data', dataDir, '--yes']);
  assert.equal(out.status, 0, out.stderr);
  const { createApp } = require('../server/index');
  const app = createApp({ dataFile: path.join(dataDir, 'school.json'), quiet: true });
  assert.ok(app.db.col('students').length > 0, 'the anonymised copy still has a school in it');
  assert.equal(app.db.data.config.anonymized, true);
  app.db.close();
});

/* ------------------------------------------------------- offline queue keying ---------- */
/** Loads public/app/core.js in a vm with just enough browser to exercise the queue. */
function loadCore() {
  const store = {};
  const listeners = [];
  const sandbox = {
    console,
    localStorage: {
      getItem: (k) => (k in store ? store[k] : null),
      setItem: (k, v) => { store[k] = String(v); },
      removeItem: (k) => { delete store[k]; },
    },
    navigator: { onLine: true, userAgent: 'node', serviceWorker: null },
    location: { hash: '#/', search: '' },
    document: { addEventListener() {}, documentElement: { dataset: {} }, querySelector: () => null },
    fetch: async () => { throw new Error('offline'); },
    setInterval: () => 0, setTimeout: (fn) => { listeners.push(fn); return 0; }, clearTimeout: () => {},
    React: { createElement: () => null, useState: () => [null, () => {}], useEffect: () => {}, useCallback: (f) => f },
    Date, Object, JSON, Math, Promise, Error, String, Number, Array, Boolean, Set, encodeURIComponent, decodeURIComponent,
  };
  sandbox.window = sandbox;
  sandbox.window.addEventListener = () => {};
  vm.createContext(sandbox);
  vm.runInContext(fs.readFileSync(path.join(ROOT, 'public', 'app', 'core.js'), 'utf8'), sandbox);
  return { A: sandbox.window.EdApp, store, sandbox };
}

test('offline queue: a queue is keyed by user and is never replayed in another teacher\'s session', async () => {
  const { A, store } = loadCore();
  // teacher A signs in and queues an attendance write while offline
  A.setQueueUser('u_nowak');
  const queued = await A.api.post('/api/attendance/lesson/les_1', { allPresent: true }, { queueable: true, label: '7b' });
  assert.deepEqual(queued, { queued: true });
  assert.equal(A.state.queue.length, 1);
  assert.equal(A.state.queue[0].userId, 'u_nowak');
  assert.ok(store['edmat.queue.u_nowak'], 'the queue is stored under the user key');
  assert.equal(store['edmat.queue'], undefined, 'no shared, unkeyed queue any more');

  // teacher B takes over the same classroom PC
  A.setQueueUser('u_wojcik');
  assert.equal(A.state.queue.length, 0, "teacher B must not inherit teacher A's queue");
  await A.api.post('/api/attendance/lesson/les_2', { allPresent: true }, { queueable: true });
  assert.equal(A.state.queue.length, 1);
  assert.equal(A.state.queue[0].userId, 'u_wojcik');
  assert.equal(JSON.parse(store['edmat.queue.u_nowak']).length, 1, "teacher A's queue survives untouched");

  // and flushing in B's session never sends A's item
  const sent = [];
  A.state.user = { id: 'u_wojcik' };
  A.state.online = true;
  A.state.queue = JSON.parse(store['edmat.queue.u_nowak']).concat(A.state.queue);  // even if both ended up in memory
  await A.flushQueue();
  assert.equal(A.state.queue.filter((it) => it.userId === 'u_nowak').length, 0, "another user's items are dropped, not sent");

  // teacher A comes back: the queue is still there
  A.setQueueUser('u_nowak');
  assert.equal(A.state.queue.length, 1);
  assert.equal(A.state.queue[0].path, '/api/attendance/lesson/les_1');
  // logging out unbinds the queue and refuses to take new writes
  A.setQueueUser(null);
  assert.equal(A.state.queue.length, 0);
  await assert.rejects(() => A.api.post('/api/attendance/lesson/les_3', {}, { queueable: true }), (e) => e.offline === true);
});

test('offline queue: a write the server refuses (4xx) is reported, not dropped in silence', async () => {
  const { A, sandbox } = loadCore();
  A.setQueueUser('u_nowak');
  await A.api.post('/api/attendance/lesson/les_1', { allPresent: true }, { queueable: true, label: '7b · matematyka' });
  assert.equal(A.state.queue.length, 1);
  sandbox.fetch = async () => ({ status: 403, ok: false, headers: { get: () => 'application/json' }, json: async () => ({ error: 'Semestr jest zamknięty.' }) });
  A.state.user = { id: 'u_nowak' }; A.state.online = true;
  await A.flushQueue();
  assert.equal(A.state.queue.length, 0, 'the item leaves the queue — the server will never take it');
  assert.equal(A.state.queueRejected.length, 1, 'but it is kept and reported');
  assert.equal(A.state.queueRejected[0].status, 403);
  assert.equal(A.state.queueRejected[0].item.label, '7b · matematyka');
});

test('offline queue: a queue left by an older build is quarantined, not replayed under a new user', async () => {
  const { A, store, sandbox } = loadCore();
  store['edmat.queue'] = JSON.stringify([{ id: '1', method: 'POST', path: '/api/attendance/lesson/les_old', body: {}, at: '2026-10-23T08:00:00.000Z' }]);
  A.setQueueUser('u_wojcik');
  assert.equal(A.state.queue.length, 0, 'an unattributable queue is not adopted silently');
  assert.equal(store['edmat.queue'], undefined);
  assert.equal(A.state.unclaimedQueue, 1);
  assert.equal(JSON.parse(store['edmat.queue.__unclaimed']).length, 1);
  const n = A.adoptUnclaimedQueue();   // only on an explicit decision
  assert.equal(n, 1);
  assert.equal(A.state.queue.length, 1);
  assert.equal(A.state.queue[0].userId, 'u_wojcik');
  assert.ok(sandbox);
});

/* -------------------------------------------------------------- retention -------------- */
test('retention: the job deletes audit rows past the policy, reports counts and leaves a protocol', async () => {
  const S = await startServer();
  try {
    const admin = await S.as('admin');
    const teacher = await S.as('j.nowak');           // generates fresh audit rows
    await teacher.get('/api/auth/session');

    const today = S.db.data.config.today;
    const years = S.db.data.config.logRetentionYears || 5;
    const old = new Date(today + 'T00:00:00Z'); old.setUTCFullYear(old.getUTCFullYear() - years - 1);
    const oldAt = old.toISOString();
    for (let i = 0; i < 3; i++) S.db.col('audit').push({ id: 'aud_old_' + i, at: oldAt, userId: 'u_nowak', action: 'grade_update', entity: 'grades', entityId: 'g' + i });
    const totalBefore = S.db.col('audit').length;

    const dry = await admin.post('/api/admin/retention/run', {});
    assert.equal(dry.status, 200);
    assert.equal(dry.body.dryRun, true);
    assert.equal(dry.body.audit.expiring, 3);
    assert.equal(dry.body.deleted.audit, 0);
    assert.equal(S.db.col('audit').length, totalBefore, 'a dry run deletes nothing');

    const noReason = await admin.post('/api/admin/retention/run', { confirm: true });
    assert.equal(noReason.status, 400, 'a deletion without a reason is refused');

    const run = await admin.post('/api/admin/retention/run', { confirm: true, reason: 'brakowanie wg polityki 5 lat' });
    assert.equal(run.status, 200);
    assert.equal(run.body.deleted.audit, 3);
    assert.equal(run.body.byAction.grade_update, 3);
    assert.equal(S.db.col('audit').some((a) => a.id === 'aud_old_0'), false, 'expired rows are gone');
    assert.ok(S.db.col('audit').some((a) => a.action === 'retention_executed'), 'the deletion itself is audited');
    assert.equal(S.db.col('retentionRuns').length, 1);
    assert.equal(S.db.col('retentionRuns')[0].deleted.audit, 3);

    const again = await admin.post('/api/admin/retention/run', { confirm: true, reason: 'powtórzenie' });
    assert.equal(again.body.deleted.audit, 0, 'nothing left to delete');

    const runs = await admin.get('/api/admin/retention/runs');
    assert.equal(runs.status, 200);
    assert.equal(runs.body.runs.length, 2);

    const forbidden = await teacher.post('/api/admin/retention/run', { confirm: true, reason: 'nie wolno' });
    assert.equal(forbidden.status, 403, 'only an admin may run the job');
  } finally { await S.close(); }
});

test('retention: stale sessions are pruned so the login log cannot grow without bound', async () => {
  const S = await startServer();
  try {
    const admin = await S.as('admin');
    const old = '2020-01-01T08:00:00.000Z';
    for (let i = 0; i < 5; i++) S.db.col('sessions').push({ id: 'ses_old_' + i, token: 'x' + i, userId: 'u_nowak', createdAt: old, lastActivity: old, revoked: true });
    const before = S.db.col('sessions').length;
    const run = await admin.post('/api/admin/retention/run', { confirm: true, reason: 'sprzątanie sesji' });
    assert.equal(run.body.deleted.sessions, 5);
    assert.equal(S.db.col('sessions').length, before - 5);
    assert.ok(S.db.col('sessions').some((s) => !s.revoked), 'live sessions are kept');
  } finally { await S.close(); }
});

/* ================================================================================================
   Second-pass regression tests for the storage engine (docs/review/regressions.md).
   Each one reproduces a defect the first round left behind; they stay here as the proof it is gone. */

test('store: the Proxy is transparent to everything routes and libraries do to a document', () => {
  const db = new Store(null);
  db.data = { students: [{ id: 's1', firstName: 'Ala', parentIds: ['p1'], guardians: { mother: 'Ewa' } }], config: { a: 1 } };
  const s = db.get('students', 's1');

  assert.equal(JSON.stringify(db.data), '{"students":[{"id":"s1","firstName":"Ala","parentIds":["p1"],"guardians":{"mother":"Ewa"}}],"config":{"a":1}}');
  assert.deepEqual(Object.keys(db.data), ['students', 'config'], 'top-level key order survives');
  assert.deepEqual(Object.keys(s), ['id', 'firstName', 'parentIds', 'guardians'], 'and so does the document key order');
  assert.ok(s instanceof Object);
  assert.ok(Array.isArray(s.parentIds) && s.parentIds instanceof Array, 'a nested array is still an array');
  assert.equal(Array.isArray(db.col('students')), true);

  /* structuredClone refuses a Proxy outright — anything that clones a document (the audit log did)
     has to know that, so the behaviour is pinned here rather than discovered in production. */
  assert.throws(() => structuredClone(s), (e) => e.name === 'DataCloneError', 'structuredClone(doc) throws');
  assert.throws(() => structuredClone(db.data), (e) => e.name === 'DataCloneError');
  assert.deepEqual(JSON.parse(JSON.stringify(s)), { id: 's1', firstName: 'Ala', parentIds: ['p1'], guardians: { mother: 'Ewa' } }, 'the JSON route works');

  delete s.firstName;
  assert.deepEqual(Object.keys(db.snapshot().students[0]), ['id', 'parentIds', 'guardians'], 'delete reaches the raw document');
});

test('store: mutations buried inside a document are tracked, appended and come back', () => {
  const dir = tmp('nested');
  const file = path.join(dir, 'school.json');
  const db = new Store(file, { quiet: true });
  db.data = {
    students: [{ id: 's1', parentIds: ['p1'] }],
    classes: [{ id: '7b', studentIds: ['a', 'b', 'c'] }],
    messages: [{ id: 'm1', readBy: {} }],                     // hot: goes through the append log
    meetings: [{ id: 'mt1', consents: {} }],
  };
  db.compact();

  db.get('students', 's1').parentIds.push('p2');              // students[].parentIds.push
  db.col('classes')[0].studentIds.splice(1, 1);               // classes[].studentIds.splice
  db.get('messages', 'm1').readBy['u9'] = '2027-01-29T10:00:00Z';   // messages[].readBy[userId] = …
  db.get('meetings', 'mt1').consents.s1 = { ok: true, at: '2027-01-29' };
  db.flush();
  db.close();

  const back = new Store(file, { quiet: true }); back.load();
  assert.deepEqual(back.get('students', 's1').parentIds, ['p1', 'p2']);
  assert.deepEqual(back.col('classes')[0].studentIds, ['a', 'c']);
  assert.deepEqual(back.get('messages', 'm1').readBy, { u9: '2027-01-29T10:00:00Z' }, 'a nested write on a hot collection is logged too');
  assert.deepEqual(back.get('meetings', 'mt1').consents, { s1: { ok: true, at: '2027-01-29' } });
  back.close();
});

test('store: sorting, truncating and replacing a hot collection all survive a reload', () => {
  const dir = tmp('bulk');
  const file = path.join(dir, 'school.json');
  const db = new Store(file, { quiet: true });
  db.data = { messages: [{ id: 'm3', n: 3 }, { id: 'm1', n: 1 }, { id: 'm2', n: 2 }], notifications: [{ id: 'n1' }, { id: 'n2' }], students: [{ id: 's1' }] };
  db.compact();
  db.col('messages').sort((a, b) => a.n - b.n);               // in place, on a hot collection
  db.col('notifications').length = 0;                         // truncate
  db.data.students = [{ id: 's9' }];                          // replace-all
  db.flush();
  db.close();

  const back = new Store(file, { quiet: true }); back.load();
  assert.deepEqual(back.col('messages').map((m) => m.id), ['m1', 'm2', 'm3'], 'an in-place sort forces a snapshot');
  assert.equal(back.col('notifications').length, 0);
  assert.deepEqual(back.col('students').map((s) => s.id), ['s9']);
  back.close();
});

test('store: an id removed and inserted again inside one flush window keeps the new row', () => {
  const dir = tmp('reinsert');
  const file = path.join(dir, 'school.json');
  const db = new Store(file, { quiet: true });
  db.data = { messages: [{ id: 'm1', v: 'stare' }, { id: 'm2' }] };
  db.compact();
  /* The log is insert-then-update-then-delete, not a journal: replayed in that order the delete ate
     the row that had just been written under the same id. Now the clash forces a full snapshot. */
  db.remove('messages', 'm1');
  db.col('messages').push({ id: 'm1', v: 'nowe' });
  db.flush();
  db.close();

  const back = new Store(file, { quiet: true }); back.load();
  assert.deepEqual(back.col('messages').map((m) => m.id + ':' + (m.v || '')), ['m2:', 'm1:nowe']);
  back.close();
});

test('store: two rows that share an id both keep their own edit', () => {
  const dir = tmp('dupids');
  const file = path.join(dir, 'school.json');
  const db = new Store(file, { quiet: true });
  db.data = { messages: [{ id: 'm1', v: 'A' }, { id: 'm1', v: 'B' }] };   // a bad import, a bad merge
  db.compact();
  db.col('messages')[0].v = 'A2';
  db.col('messages')[1].v = 'B2';
  db.flush();
  db.close();

  const back = new Store(file, { quiet: true }); back.load();
  assert.deepEqual(back.col('messages').map((m) => m.v), ['A2', 'B2'], 'the dirty set is keyed by document, not by id');
  back.close();
});

test('store: a torn collection file is quarantined instead of taking the school down', () => {
  const dir = tmp('torn-snapshot');
  const file = path.join(dir, 'school.json');
  const db = new Store(file, { quiet: true });
  db.data = { students: [{ id: 's1' }, { id: 's2' }], config: { school: { name: 'Szkoła' } } };
  db.compact();
  db.close();
  fs.writeFileSync(fileOf(file, 'students.json'), '[{"id":"s1"},{"id');   // power loss on a full disk

  const back = new Store(file, { quiet: true });
  assert.equal(back.load(), true, 'load() must not throw on a torn snapshot');
  assert.equal(back.col('students').length, 0, 'the unreadable collection comes back empty');
  assert.deepEqual(back.damaged.map((d) => d.name), ['students'], 'and the store says which file it was');
  assert.deepEqual(back.data.config, { school: { name: 'Szkoła' } }, 'the rest of the school is untouched');
  const kept = back.damaged[0].kept;
  assert.ok(kept && fs.existsSync(kept), 'the damaged file is kept for a look, outside the data directory');
  assert.equal(kept.startsWith(fileOf(file, '') + path.sep), false, 'so a flush cannot sweep it away');
  back.col('students').push({ id: 's3' });
  back.flush();
  assert.ok(fs.existsSync(kept), 'still there after a flush');
  back.close();
});

test('store: a reader that arrives in the middle of a compaction loses nothing', () => {
  const dir = tmp('mid-compaction');
  const file = path.join(dir, 'school.json');
  const db = new Store(file, { quiet: true });
  db.data = { attendance: [{ id: 'att0', status: 'ob' }], config: { school: { name: 'Szkoła' } }, users: [{ id: 'u1' }] };
  db.compact();
  for (let i = 1; i <= 5; i++) { db.col('attendance').push({ id: 'att' + i, status: 'ob' }); db.flush(); }
  assert.ok(fs.existsSync(fileOf(file, 'attendance.jsonl')), 'the five rows are in the log, not the snapshot');

  /* readLayout reads every log before it reads the snapshots. A compaction that lands between the
     two reads therefore hands the reader a newer snapshot plus an older log — an idempotent upsert.
     The other order (snapshot first) handed it an old snapshot and no log at all: five rows gone. */
  const logs = fs.readFileSync(fileOf(file, 'attendance.jsonl'), 'utf8');
  db.compact();                                                // the log is folded in and deleted
  assert.equal(fs.existsSync(fileOf(file, 'attendance.jsonl')), false);
  fs.writeFileSync(fileOf(file, 'attendance.jsonl'), logs);    // what a reader that was one step behind still holds
  const seen = readLayout(fileOf(file, ''));
  assert.deepEqual(seen.data.attendance.map((a) => a.id), ['att0', 'att1', 'att2', 'att3', 'att4', 'att5']);
  db.close();
});

test('store: a collection promoted to the append log mid-run keeps every row', () => {
  const dir = tmp('promotion');
  const file = path.join(dir, 'school.json');
  const db = new Store(file, { quiet: true, hotBytes: 2000 });
  db.data = { logbook: [] };
  db.compact();
  for (let i = 0; i < 40; i++) db.col('logbook').push({ id: 'e' + i, note: 'x'.repeat(100) });
  db.flush();                                                  // outgrows hotBytes → promoted here
  assert.equal(fs.existsSync(fileOf(file, 'logbook.jsonl')), false, 'the promoting flush still writes a snapshot');
  db.col('logbook').push({ id: 'po-awansie' });
  db.flush();
  assert.ok(fs.existsSync(fileOf(file, 'logbook.jsonl')), 'the next write is appended');
  db.close();

  const back = new Store(file, { quiet: true }); back.load();
  assert.equal(back.col('logbook').length, 41);
  assert.equal(back.col('logbook').at(-1).id, 'po-awansie');
  back.close();
});

test('store: a flush with nothing to write costs nothing, and the tracking maps do not grow', () => {
  const dir = tmp('idle');
  const file = path.join(dir, 'school.json');
  const db = new Store(file, { quiet: true });
  db.data = { messages: [{ id: 'm1', n: 0 }], students: [{ id: 's1' }], config: { a: 1 } };
  db.compact();
  assert.equal(db.flush(), false, 'an unchanged store writes nothing');
  const before = mtimes(fileOf(file, ''));
  db.flush();
  assert.deepEqual(mtimes(fileOf(file, '')), before, 'not even the manifest');

  const m = db.get('messages', 'm1');
  for (let i = 0; i < 100000; i++) m.n = i;
  assert.equal(db._col('messages').dirty.size, 1, '100 000 writes to one row are one dirty entry');
  db.flush();
  assert.equal(db._col('messages').dirty.size, 0, 'and the set is emptied by the flush');
  db.close();
  const back = new Store(file, { quiet: true }); back.load();
  assert.equal(back.get('messages', 'm1').n, 99999);
  back.close();
});

test('store: EDMAT_STORE=legacy still round-trips, and no longer rewrites what has not changed', () => {
  const dir = tmp('legacy');
  const file = path.join(dir, 'school.json');
  const db = new Store(file, { quiet: true, legacy: true });
  db.data = { students: [{ id: 's1', lastName: 'Żółkiewski' }], config: { a: 1 } };
  assert.equal(db.flush(), true);
  assert.deepEqual(fs.readdirSync(dir).filter((f) => !f.endsWith('.lock')), ['school.json'], 'one document, as before format 2');
  assert.equal(db.flush(), false, 'a second flush with nothing changed writes nothing');
  db.close();

  const back = new Store(file, { quiet: true, legacy: true });
  assert.equal(back.load(), true);
  assert.deepEqual(back.snapshot(), { students: [{ id: 's1', lastName: 'Żółkiewski' }], config: { a: 1 } });
  assert.equal(back.flush(), false, 'and nothing changed by loading it either');
  back.col('students').push({ id: 's2' });
  assert.equal(back.flush(), true);
  back.close();
});

test('shutdown: SIGTERM during a compaction leaves a complete store', async () => {
  const dir = tmp('sigterm-compact');
  const file = path.join(dir, 'school.json');
  const child = path.join(dir, 'child.js');
  fs.writeFileSync(child, `
    const { Store } = require(${JSON.stringify(path.join(ROOT, 'server/lib/store'))});
    const db = new Store(${JSON.stringify(file)}, { quiet: true });
    db.data = { attendance: [], config: { school: { name: 'Szkoła' } } };
    for (let i = 0; i < 4000; i++) db.col('attendance').push({ id: 'att' + i, studentId: 'st' + (i % 600), status: 'ob', note: 'x'.repeat(60) });
    db.flush();
    console.log('ready');
    /* keep compacting; a signal can only be delivered between two of these, never inside one */
    setInterval(() => { db.col('attendance').push({ id: 'att_' + Date.now() + '_' + Math.random() }); db.compact(); }, 5);
  `);
  const p = spawn(process.execPath, [child], { stdio: ['ignore', 'pipe', 'inherit'] });
  try {
    await new Promise((resolve, reject) => { p.stdout.on('data', (b) => { if (String(b).includes('ready')) resolve(); }); p.on('error', reject); });
    await new Promise((r) => setTimeout(r, 120));
    await killAndWait(p, 'kompaktowanie mogło zostać przerwane w połowie');

    const after = onDisk(file);
    assert.ok(after, 'the data directory is readable');
    assert.ok(after.attendance.length >= 4000, `every row is there (${after.attendance.length})`);
    assert.deepEqual(after.config, { school: { name: 'Szkoła' } });
    assert.equal(fs.existsSync(file + '.lock'), false, 'and the lock is released');
  } finally { reap(p); }
});

test('backup: a copy taken while the server is writing restores every row', () => {
  const dataDir = tmp('backup-live-data');
  const outDir = tmp('backup-live-out');
  const file = path.join(dataDir, 'school.json');
  const db = new Store(file, { quiet: true });
  db.data = { config: { school: { name: 'SP 12' } }, users: [{ id: 'u1', login: 'a' }], attendance: [] };
  db.compact();
  for (let i = 0; i < 30; i++) { db.col('attendance').push({ id: 'att' + i, status: 'ob' }); db.flush(); }

  const b = backupCli(['backup', '--data', dataDir, '--out', outDir]);
  assert.equal(b.status, 0, b.stderr);                         // the lock is held and that is fine
  const archive = path.join(outDir, fs.readdirSync(outDir).find((f) => f.endsWith('.json.gz')));
  assert.equal(backupCli(['verify', archive]).status, 0);
  assert.equal(backupCli(['restore', archive, '--data', dataDir, '--yes']).status, 4, 'a restore does need the server stopped');
  db.close();

  const target = tmp('backup-live-target');
  assert.equal(backupCli(['restore', archive, '--data', target, '--yes']).status, 0);
  const restored = onDisk(path.join(target, 'school.json'));
  assert.equal(restored.attendance.length, 30, 'the rows that were still only in the append log are in the copy');
  assert.equal(restored.config.school.name, 'SP 12');
});

test('bench: npm run bench finishes on a small fixture, well inside a minute', { timeout: 120000 }, () => {
  const started = Date.now();
  const r = spawnSync(process.execPath, [path.join(ROOT, 'scripts', 'bench.js'), '--engine', 'store', '--attendance', '400', '--clients', '1', '--rounds', '1'],
    { encoding: 'utf8', timeout: 60000, env: Object.assign({}, process.env, { EDMAT_STORE: '' }) });
  assert.equal(r.status, 0, (r.stderr || '').slice(-500));
  assert.ok(Date.now() - started < 60000, `the benchmark has to stay runnable (${Date.now() - started} ms)`);
  assert.match(r.stdout, /flush after one attendance write/);
  assert.match(r.stdout, /Proxy overhead/);
  assert.equal(/failed requests/.test(r.stdout), false, 'the benchmark must not count failed requests');
});

test('store: an unreadable pre-2 school.json names itself instead of dying as a SyntaxError', () => {
  const torn = path.join(tmp('badlegacy-torn'), 'school.json');
  fs.writeFileSync(torn, '{"config":{"school":{"name":"Szko');
  const db = new Store(torn, { quiet: true, lock: false });
  assert.throws(() => db.load(), (e) => e.code === 'EDMAT_BAD_DATA_FILE' && e.message.includes('school.json') && /backup\.js restore/.test(e.message));
  assert.equal(fs.existsSync(torn), true, 'and the file is left exactly where it was');

  const wrong = path.join(tmp('badlegacy-shape'), 'school.json');
  fs.writeFileSync(wrong, '[1,2,3]');
  const db2 = new Store(wrong, { quiet: true, lock: false });
  assert.throws(() => db2.load(), (e) => e.code === 'EDMAT_BAD_DATA_FILE', 'a document that parses but is not a school');
});

/* --------------------------------------------------------------- the harness itself ----------
   Trzy własności `tests/helpers.js`, na których opiera się cała reszta zestawu. Bez nich pod
   obciążeniem sypały się testy, które z badaną sprawą nie miały nic wspólnego
   (docs/review/round3/test-honesty.md §4), a raz — zamiast się wysypać — zestaw zawisał. */
test('harness: the test server keeps its socket, withConfig restores an absent key, a real failure keeps its status', async () => {
  /* `blank: true`: ten test nie potrzebuje szkoły demonstracyjnej, a pusty zasiew jest wielokrotnie
     tańszy (raport test-honesty §6 — zasiew jest głównym składnikiem 42-sekundowego przebiegu). */
  const S = await startServer({ blank: true });
  try {
    /* 1. Gniazdo keep-alive przeżywa zajętą pętlę. Node zamyka je po 5 s bezczynności, a undici
       trzyma je w puli: żądanie wpisane w to samo tiknięcie, w którym serwer wysyła FIN, wraca
       jako `TypeError: fetch failed`. Test, który buduje szkołę albo generuje rok lekcji, przekracza
       tę granicę regularnie. */
    assert.ok(S.app.server.keepAliveTimeout >= 120000, `serwer testowy trzyma połączenie (${S.app.server.keepAliveTimeout} ms)`);
    assert.ok(S.app.server.headersTimeout > S.app.server.keepAliveTimeout, 'headersTimeout musi zostać powyżej keepAliveTimeout, inaczej Node ostrzega');

    /* 2. Klucz, którego konfiguracja nie miała, wraca jako NIEOBECNY — cały config jedzie do
       każdego zalogowanego klienta w /api/auth/session. */
    assert.ok(!('archiveSignatureMaxMB' in S.db.data.config), 'zasiew nie zna tego klucza');
    await withConfig(S.db, { archiveSignatureMaxMB: 9 }, async () => {
      assert.equal(S.db.data.config.archiveSignatureMaxMB, 9);
    });
    assert.ok(!('archiveSignatureMaxMB' in S.db.data.config), 'i po teście dalej go nie ma (nie: „jest i jest undefined”)');
    const hadTz = S.db.data.config.timezone;
    await withConfig(S.db, { timezone: 'Pacific/Auckland' }, async () => { assert.equal(S.db.data.config.timezone, 'Pacific/Auckland'); });
    assert.equal(S.db.data.config.timezone, hadTz, 'a klucz, który był, wraca ze swoją wartością');

    /* 3. Ponawiamy WYŁĄCZNIE „serwer nigdy nie przeczytał tego żądania”. Odpowiedź HTTP — także
       błędna — jest wynikiem testu i nie wolno jej zamienić w ponowienie. */
    assert.equal((await S.client().get('/api/nie-ma-takiej-trasy')).status, 404);
  } finally { await S.close(); }
});

test('harness: a request to a server that is gone fails by name — route, cause and how many replays', async () => {
  const dead = await startServer({ blank: true });
  const c = dead.client();
  await dead.close();
  await assert.rejects(() => c.get('/api/auth/session'), (e) => {
    /* Wiadomość niesie trasę i powód: awaria trasy nigdy nie czyta się jak flake, a flake nigdy
       jak zepsuta trasa. */
    assert.match(e.message, /GET \/api\/auth\/session/);
    assert.match(e.message, /ECONNREFUSED/);
    assert.match(e.message, /ponowieniach/, 'i mówi, ile razy ponawialiśmy, zanim odpuściliśmy');
    assert.ok(e.cause, 'oryginalny błąd zostaje jako przyczyna');
    return true;
  });
});
