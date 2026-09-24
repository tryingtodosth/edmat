#!/usr/bin/env node
/*
 * Storage benchmark — the numbers in docs/STORAGE.md come from here.
 *
 *   node --max-old-space-size=4096 scripts/bench.js            # both engines, 5 months of attendance
 *   node scripts/bench.js --attendance 100000 --clients 20
 *   node scripts/bench.js --engine legacy                      # one engine only
 *   node scripts/bench.js --proxy                              # only the Proxy micro-benchmark
 *
 * `legacy` is the pre-2 store: one `data/school.json` rewritten in full on every flush
 * (EDMAT_STORE=legacy still selects it at runtime). `store` is the per-collection engine.
 *
 * The fixture is the seeded demo school (real classes, timetable, lessons, teachers — so the real
 * endpoints work) with the attendance collection inflated to the size a 600-pupil school reaches:
 * 600 pupils × 5 lessons × 108 school days ≈ 324 000 rows at the end of January, 612 000 at the end
 * of the year. Every row has the shape the attendance route writes (~320 B), so the file sizes match
 * the ones measured in docs/review/reliability.md §2.
 */
'use strict';
const fs = require('node:fs'); const os = require('node:os'); const path = require('node:path');

const ROOT = path.join(__dirname, '..');
function arg(name, def) { const i = process.argv.indexOf('--' + name); return i > 0 && process.argv[i + 1] && !process.argv[i + 1].startsWith('--') ? process.argv[i + 1] : def; }
function flag(name) { return process.argv.includes('--' + name); }

const ATT = +arg('attendance', 324000);
const CLIENTS = +arg('clients', 20);
const ROUNDS = +arg('rounds', 12);              // requests per client per phase
const ENGINES = arg('engine', '') ? [arg('engine', '')] : ['legacy', 'store'];

const ms = (n) => (n >= 1000 ? (n / 1000).toFixed(2) + ' s' : n.toFixed(0) + ' ms');
const MB = (n) => (n / 1048576).toFixed(1) + ' MB';
function pct(list, p) { if (!list.length) return 0; const s = list.slice().sort((a, b) => a - b); return s[Math.min(s.length - 1, Math.floor((p / 100) * s.length))]; }
function dirBytes(p) {
  let total = 0;
  const stat = fs.existsSync(p) ? fs.statSync(p) : null;
  if (!stat) return 0;
  if (stat.isFile()) return stat.size;
  for (const f of fs.readdirSync(p)) total += dirBytes(path.join(p, f));
  return total;
}
async function timed(fn) { const t = process.hrtime.bigint(); const v = await fn(); return { v, ms: Number(process.hrtime.bigint() - t) / 1e6 }; }

/* ------------------------------------------------------------------ the Proxy question
   Change tracking has to be invisible on the read paths. This is the measurement that decided how
   the collection Proxy in server/lib/store.js forwards array methods to the raw array. */
function proxyBench(n) {
  const rows = [];
  for (let i = 0; i < n; i++) rows.push({ id: 'att_' + i, lessonId: 'les_' + (i % 30600), studentId: 'st_' + (i % 600), date: '2027-01-29', lessonNo: (i % 7) + 1, classId: 'c' + (i % 30), subjectId: 'mat', status: 'ob', minutes: null, draft: false, byUserId: 'u_1', at: '2027-01-29T08:00:00.000Z', atClient: false, excuseId: null });
  const best = (fn, reps = 5) => { let t = Infinity; for (let r = 0; r < reps; r++) { const s = process.hrtime.bigint(); fn(); t = Math.min(t, Number(process.hrtime.bigint() - s) / 1e6); } return t; };
  const h = { set(t, k, v) { t[k] = v; return true; } };
  const perElement = new Proxy(rows, { get: (t, k) => t[k] });
  const forwarding = new Proxy(rows, { get: (t, k) => { const v = t[k]; return typeof v === 'function' ? v.bind(t) : v; } });
  const wrapped = rows.map((r) => new Proxy(r, h));
  const raw = best(() => rows.filter((x) => x.lessonId === 'les_7'));
  const out = [
    ['raw array (baseline)', best(() => rows.filter((x) => x.lessonId === 'les_7'))],
    ['Proxy, per-element get trap', best(() => Array.prototype.filter.call(perElement, (x) => x.lessonId === 'les_7'))],
    ['Proxy, method forwarded to the raw array', best(() => forwarding.filter((x) => x.lessonId === 'les_7'))],
    ['every document wrapped in a Proxy', best(() => wrapped.filter((x) => x.lessonId === 'les_7'))],
    ['wrapping ' + n + ' documents once', best(() => { for (const r of rows) new Proxy(r, h); })],
    ['JSON.stringify of the whole collection', best(() => JSON.stringify(rows), 3)],
  ];
  console.log(`\n## Proxy overhead on a ${n}-row filter\n`);
  console.log('| variant | time | vs raw |');
  console.log('| --- | ---: | ---: |');
  for (const [name, t] of out) console.log(`| ${name} | ${t.toFixed(1)} ms | ${(t / raw).toFixed(1)}× |`);
  return out;
}

/* ------------------------------------------------------------------ the fixture */
/** Inflates the seeded school's attendance to `target` rows, reusing its real lessons and pupils. */
function inflate(db, target) {
  const col = db.col('attendance');
  const have = col.length;
  if (have >= target) return 0;
  const lessons = db.col('lessons').map((l) => ({ id: l.id, date: l.date, lessonNo: l.lessonNo, classId: l.classId, subjectId: l.subjectId }));
  const students = db.col('students').map((s) => s.id);
  const rows = [];
  for (let i = 0; i < target - have; i++) {
    const l = lessons[i % lessons.length]; const sid = students[(i / lessons.length | 0) % students.length];
    rows.push({
      id: 'att_bench_' + i, lessonId: l.id, studentId: sid, date: l.date, lessonNo: l.lessonNo,
      classId: l.classId, subjectId: l.subjectId, status: i % 17 === 0 ? 'nb' : 'ob', minutes: null,
      draft: false, byUserId: 'u_nowak', at: l.date + 'T08:00:00.000Z', atClient: false, excuseId: null,
    });
    if (rows.length === 20000) { col.push(...rows); rows.length = 0; }
  }
  if (rows.length) col.push(...rows);
  return target - have;
}

/* ------------------------------------------------------------------ one engine, end to end */
async function runEngine(engine) {
  process.env.EDMAT_STORE = engine === 'legacy' ? 'legacy' : '';
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'edmat-bench-' + engine + '-'));
  const dataFile = path.join(dir, 'school.json');
  const out = { engine, dir };

  delete require.cache[require.resolve(path.join(ROOT, 'server/index.js'))];
  const { createApp } = require(path.join(ROOT, 'server/index.js'));
  const { DEMO_PASSWORD } = require(path.join(ROOT, 'server/seed/00-base.js'));

  const boot = await timed(() => createApp({ dataFile, quiet: true }));
  const app = boot.v; const db = app.db;
  out.seedMs = boot.ms;

  const built = await timed(() => inflate(db, ATT));
  out.buildMs = built.ms; out.rows = db.stats().totalRows;

  /* a full write of everything — what the legacy engine did on every single save */
  out.bulkFlushMs = (await timed(() => { db.flush(); return 1; })).ms;
  out.bytes = dirBytes(engine === 'legacy' ? dataFile : path.join(dir, 'school'));

  /* one attendance row changed, then written: the cost the school actually pays per click */
  const single = [];
  for (let i = 0; i < 20; i++) {
    const row = db.get('attendance', 'att_bench_' + (i * 997));
    if (row) { row.status = i % 2 ? 'nb' : 'ob'; row.at = new Date().toISOString(); }
    single.push((await timed(() => { db.flush(); return 1; })).ms);
  }
  out.singleFlushMs = pct(single, 50);
  out.singleFlushP95Ms = pct(single, 95);

  /* how long a restart takes before the first request can be served */
  db.close();
  const { Store } = require(path.join(ROOT, 'server/lib/store.js'));
  const reload = await timed(() => { const s = new Store(dataFile, { quiet: true }); s.load(); const n = s.stats().totalRows; s.close(); return n; });
  out.startupMs = reload.ms; out.reloadedRows = reload.v;

  /* latency under load, through the real HTTP stack */
  const app2 = createApp({ dataFile, quiet: true });
  const port = await app2.listen(0);
  const base = `http://127.0.0.1:${port}`;
  const today = app2.db.data.config.today;
  const lessons = app2.db.col('lessons').filter((l) => l.date === today && l.teacherId === 'u_nowak' && l.status !== 'cancelled').map((l) => l.id);
  async function login(loginName) {
    const r = await fetch(base + '/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ login: loginName, password: DEMO_PASSWORD }) });
    const sc = r.headers.get('set-cookie'); await r.json();
    return sc ? sc.split(';')[0] : '';
  }
  const cookie = await login('j.nowak');
  async function call(method, p, body) {
    const t = process.hrtime.bigint();
    const r = await fetch(base + p, { method, headers: { 'Content-Type': 'application/json', Cookie: cookie }, body: body ? JSON.stringify(body) : undefined });
    await r.arrayBuffer();
    return { ms: Number(process.hrtime.bigint() - t) / 1e6, status: r.status };
  }
  async function phase(make) {
    const times = []; let bad = 0;
    await Promise.all(Array.from({ length: CLIENTS }, async (_, c) => {
      for (let i = 0; i < ROUNDS; i++) { const r = await make(lessons[(c + i) % lessons.length]); times.push(r.ms); if (r.status >= 400) bad++; }
    }));
    return { p50: pct(times, 50), p95: pct(times, 95), bad, n: times.length };
  }
  await phase((id) => call('GET', '/api/attendance/lesson/' + id));            // warm-up
  out.read = await phase((id) => call('GET', '/api/attendance/lesson/' + id));
  out.write = await phase((id) => call('POST', '/api/attendance/lesson/' + id, { allPresent: true, draft: true }));
  await app2.close();
  try { fs.rmSync(dir, { recursive: true, force: true }); } catch (e) {}
  return out;
}

function table(results) {
  const h = (k, f) => results.map((r) => f(r[k], r)).join(' | ');
  console.log(`\n## ${ATT} attendance rows, ${CLIENTS} concurrent clients, ${ROUNDS} requests each\n`);
  console.log('| measurement | ' + results.map((r) => (r.engine === 'legacy' ? 'before (single file)' : 'after (per-collection)')).join(' | ') + ' |');
  console.log('| --- | ' + results.map(() => '---:').join(' | ') + ' |');
  console.log(`| rows in the store | ${h('rows', (v) => v.toLocaleString('en-US'))} |`);
  console.log(`| on disk | ${h('bytes', MB)} |`);
  console.log(`| full write (every collection) | ${h('bulkFlushMs', ms)} |`);
  console.log(`| **flush after one attendance write** | ${h('singleFlushMs', ms)} |`);
  console.log(`| flush after one attendance write, p95 | ${h('singleFlushP95Ms', ms)} |`);
  console.log(`| startup: load + index | ${h('startupMs', ms)} |`);
  console.log(`| \`GET /api/attendance/lesson/:id\` p50 | ${results.map((r) => ms(r.read.p50)).join(' | ')} |`);
  console.log(`| \`GET /api/attendance/lesson/:id\` p95 (${CLIENTS} clients) | ${results.map((r) => ms(r.read.p95)).join(' | ')} |`);
  console.log(`| \`POST /api/attendance/lesson/:id\` p50 | ${results.map((r) => ms(r.write.p50)).join(' | ')} |`);
  console.log(`| \`POST /api/attendance/lesson/:id\` p95 (${CLIENTS} clients) | ${results.map((r) => ms(r.write.p95)).join(' | ')} |`);
  const bad = results.reduce((n, r) => n + r.read.bad + r.write.bad, 0);
  console.log(`\nNode ${process.version} · ${os.cpus().length} cores · heap cap ${(require('node:v8').getHeapStatistics().heap_size_limit / 1048576).toFixed(0)} MB · peak RSS ${MB(process.memoryUsage().rss)}${bad ? ' · ' + bad + ' failed requests' : ''}`);
}

(async () => {
  if (flag('proxy')) { proxyBench(+arg('attendance', 324000)); return; }
  const results = [];
  for (const e of ENGINES) { process.stderr.write(`… ${e}\n`); results.push(await runEngine(e)); }
  table(results);
  proxyBench(Math.min(ATT, 324000));
})().catch((e) => { console.error(e); process.exit(1); });
