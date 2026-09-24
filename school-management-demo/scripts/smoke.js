#!/usr/bin/env node
/* Smoke test: opens every screen as a real demo user in both languages with the local headless Chromium and
   reports (1) browser console errors/warnings incl. CSP violations and uncaught exceptions, (2) server log lines
   with status >= 400, (3) a screenshot per pair in smoke-out/, (4) a DOM sanity check (one <h1>, no literal
   "undefined" / "NaN" / "[object Object]" in the rendered text).

   Usage: npm run smoke  ·  node scripts/smoke.js [--only=<substring>] [--keep] [--budget=30000]
   Exits non-zero when any pair reports a problem. Zero npm dependencies. */
'use strict';
const { spawn, execFile } = require('node:child_process');
const fs = require('node:fs'); const os = require('node:os'); const path = require('node:path');
const pdf = require('../server/lib/pdf');

const ROOT = path.join(__dirname, '..');
const OUT = path.join(ROOT, 'smoke-out');
const argv = process.argv.slice(2);
const arg = (name, dflt) => { const a = argv.find((x) => x.startsWith('--' + name + '=')); return a ? a.split('=').slice(1).join('=') : dflt; };
const ONLY = arg('only', '');
const BUDGET = arg('budget', '30000');
const LANGS = (arg('langs', 'pl,en')).split(',');

/* (login, hash) matrix — every screen of the app, as the user who really owns it. */
const MATRIX = [
  { id: 'teacher-lesson', login: 'j.nowak', hash: '/lekcja' },
  { id: 'teacher-grades', login: 'j.nowak', hash: '/oceny' },
  { id: 'curriculum', login: 'j.nowak', hash: '/podstawa' },
  { id: 'homeroom', login: 'j.nowak', hash: '/wychowawca' },
  { id: 'modules', login: 'j.nowak', hash: '/moduly' },
  /* Zakładki modułów są różne dla różnych ról — formularze GAP-5 (konta stołówkowe, stan
     biblioteki) widzi wyłącznie intendent i bibliotekarka, więc mają własne pary. */
  { id: 'modules-cafeteria', login: 'stolowka', hash: '/moduly' },
  { id: 'modules-library', login: 'biblioteka', hash: '/moduly' },
  { id: 'courses', login: 'j.nowak', hash: '/kursy' },
  { id: 'meetings', login: 'j.nowak', hash: '/spotkania' },
  { id: 'principal', login: 'dyrektor', hash: '/dyrekcja' },
  { id: 'support', login: 'pedagog', hash: '/pomoc' },
  { id: 'registrar', login: 'sekretariat', hash: '/sekretariat' },
  { id: 'admin', login: 'admin', hash: '/administracja' },
  { id: 'compliance', login: 'iod', hash: '/dostepnosc' },
  { id: 'student', login: 'anna.kowalczyk', hash: '/uczen' },
  { id: 'parent', login: 'rodzic.kowalczyk', hash: '/rodzic', width: 390, height: 1800 },
  { id: 'messages', login: 'j.nowak', hash: '/wiadomosci' },
  { id: 'settings', login: 'j.nowak', hash: '/ustawienia' },
  { id: 'student-courses', login: 'anna.kowalczyk', hash: '/kursy' },
  { id: 'parent-meetings', login: 'rodzic.kowalczyk', hash: '/spotkania', width: 390, height: 1800 },
  /* Strony poza powłoką aplikacji mają własny adres i nie potrzebują logowania (public/projekt/ — strona projektu). */
  { id: 'coop', login: 'j.nowak', hash: '/wspolpraca' },
  { id: 'coop-detail', login: 'a.wojcik', hash: '/wspolpraca?m=st_mt_mat' },
  { id: 'landing', url: '/projekt/' },
  { id: 'landing-phone', url: '/projekt/', width: 390, height: 2600 },
];

/* ---------- chrome stderr → console problems ----------------------------------------------------
   This build logs every page console message at INFO level as `…:INFO:CONSOLE:<line>] "text", source: …`,
   so the severity in the prefix says nothing; the app itself never calls console.* (grep public/app),
   which means any console line is the browser complaining: CSP violation, failed subresource, uncaught
   exception or a React warning. We keep those and drop the headless build's own font/GPU/DevTools noise. */
const CONSOLE_RE = /:(INFO|WARNING|ERROR|FATAL):CONSOLE[:(](\d+)\)?\]\s*(.*)$/;
/* Noise from the headless build itself and from fonts/devtools — never from the app. */
const NOISE = [
  /Fontconfig|fontconfig|FontService|font_service|Failed to load font|DirectWrite/i,
  /DevTools listening|devtools|Inspector/i,
  /GPU|gpu_|Gpu|SharedImage|gl_display|EGL|vulkan|Vulkan|swiftshader/i,
  /InitializeSandbox|sandbox|seccomp/i,
  /dbus|bluez|Bluetooth|floss|udev|libva|vaapi|ALSA|audio/i,
  /Failed to create GLES|ContextResult|viz\./i,
  /registration_protocol_win|network_change_notifier/i,
];
const isNoise = (s) => NOISE.some((re) => re.test(s));

function consoleProblems(stderr) {
  const out = [];
  for (const line of String(stderr || '').split('\n')) {
    const m = CONSOLE_RE.exec(line);
    let text = null;
    if (m) text = 'console:' + m[2] + ' ' + m[3];
    else if (/Uncaught \w*Error|Uncaught \(in promise\)|Refused to (load|execute|connect|apply)/.test(line)) text = line.trim();
    if (!text) continue;
    if (isNoise(text)) continue;
    out.push(text.replace(/\s+/g, ' ').slice(0, 300));
  }
  return [...new Set(out)];
}

/* ---------- DOM sanity ------------------------------------------------------------------------- */
function domProblems(dom) {
  if (!dom || dom.indexOf('<html') < 0) return ['no DOM dumped'];
  const problems = [];
  if (!/<h1[\s>]/i.test(dom)) problems.push('no <h1> in the rendered page');
  const text = dom
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"');
  for (const bad of ['undefined', 'NaN', '[object Object]']) {
    const re = bad === '[object Object]' ? /\[object Object\]/g : new RegExp('\\b' + bad + '\\b', 'g');
    const hits = text.match(re);
    if (hits) {
      const i = text.search(re);
      problems.push(`literal "${bad}" ×${hits.length} — …${text.slice(Math.max(0, i - 60), i + 60).replace(/\s+/g, ' ').trim()}…`);
    }
  }
  return problems;
}

/* ---------- server ------------------------------------------------------------------------------ */
function startServer(port, dataDir) {
  const srv = spawn(process.execPath, [path.join(ROOT, 'server', 'index.js')], {
    // NO_COLOR/FORCE_COLOR=0: console.log() in the server colours the status code when a colour-forcing
    // environment is inherited, which would hide "… 403 …" from the parser below.
    env: Object.assign({}, process.env, { EDMAT_DEV: '1', EDMAT_LOG: '1', PORT: String(port), EDMAT_DATA: dataDir, NO_COLOR: '1', FORCE_COLOR: '0' }),
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const lines = [];
  const feed = (buf) => { for (const l of String(buf).replace(/\u001b\[[0-9;]*m/g, '').split('\n')) if (l.trim()) lines.push(l.trim()); };
  srv.stdout.on('data', feed); srv.stderr.on('data', feed);
  return { srv, lines };
}
/* REL-17: linia logu żądania zaczyna się od znacznika czasu ISO, dalej metoda, ścieżka, status,
   czas, `user=`, `req=` i ewentualnie `code=`. Prefiks czasu jest opcjonalny, żeby parser przetrwał
   też starszy format. */
const LOG_RE = /^(?:\S+Z\s+)?(GET|POST|PUT|PATCH|DELETE|HEAD)\s+(\S+)\s+(\d{3})\b/;
function serverProblems(lines) {
  const out = [];
  for (const l of lines) {
    const m = LOG_RE.exec(l);
    if (m && +m[3] >= 400) out.push(`${m[3]} ${m[1]} ${m[2]}`);
    else if (!m && /Error|error:|at \w+ \(/.test(l) && !/EDMAT|EdMat ·/.test(l)) out.push('server: ' + l.slice(0, 200));
  }
  return [...new Set(out)];
}
async function waitReady(port) {
  for (let i = 0; i < 100; i++) {
    try { const r = await fetch(`http://127.0.0.1:${port}/api/auth/policy`); if (r.ok) return true; } catch (e) {}
    await new Promise((r) => setTimeout(r, 300));
  }
  return false;
}

/* ---------- one pair ----------------------------------------------------------------------------
   Asynchronous on purpose: a synchronous spawn would block this process's event loop, so the server's
   stdout (the request log we grade below) would never be read while the page is loading. */
const settle = (ms) => new Promise((r) => setTimeout(r, ms || 250));
function runChrome(chrome, url, extra, width, height) {
  const args = [
    '--headless', '--no-sandbox', '--disable-gpu', '--hide-scrollbars', '--run-all-compositor-stages-before-draw',
    '--enable-logging=stderr', '--v=0', '--virtual-time-budget=' + BUDGET,
    '--user-data-dir=' + fs.mkdtempSync(path.join(os.tmpdir(), 'edmat-smoke-')),
    `--window-size=${width},${height}`,
  ].concat(extra, [url]);
  return new Promise((resolve) => {
    execFile(chrome, args, { encoding: 'utf8', timeout: 120000, maxBuffer: 64 * 1024 * 1024 },
      (err, stdout, stderr) => resolve({ stdout: stdout || '', stderr: stderr || '', error: err || null }));
  });
}

async function main() {
  const chrome = pdf.chromePath();
  if (!chrome) { console.error('No headless Chromium found (set EDMAT_CHROME). Candidates:\n  ' + pdf.candidates().join('\n  ')); process.exit(2); }
  const port = 41000 + Math.floor(Math.random() * 20000);
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'edmat-smoke-data-'));
  fs.rmSync(OUT, { recursive: true, force: true }); fs.mkdirSync(OUT, { recursive: true });
  const { srv, lines } = startServer(port, dataDir);
  const ok = await waitReady(port);
  if (!ok) { srv.kill(); console.error('server did not start:\n' + lines.join('\n').slice(-2000)); process.exit(2); }

  const pairs = [];
  for (const s of MATRIX) for (const lang of LANGS) if (!ONLY || (s.id + '-' + lang).includes(ONLY)) pairs.push({ s, lang });
  console.log(`EdMat smoke · ${pairs.length} pairs · chrome ${path.basename(chrome)} · port ${port}\n`);

  const results = [];
  for (const { s, lang } of pairs) {
    const name = `${s.id}-${lang}`;
    const width = s.width || 1280, height = s.height || 1600;
    const to = s.hash ? s.hash + (s.hash.indexOf('?') >= 0 ? '&' : '?') + 'lang=' + lang : null;
    const url = s.url ? `http://127.0.0.1:${port}${lang === 'en' ? s.url + 'en/' : s.url}` : `http://127.0.0.1:${port}/api/dev/login?as=${encodeURIComponent(s.login)}&to=${encodeURIComponent(to)}`;
    const shot = path.join(OUT, name + '.png');
    const mark = lines.length;

    let r = await runChrome(chrome, url, ['--screenshot=' + shot, '--dump-dom'], width, height);
    let dom = r.stdout || '';
    if (dom.indexOf('<html') < 0) { // a build that honours only one action per run — take the DOM separately
      const r2 = await runChrome(chrome, url, ['--dump-dom'], width, height);
      dom = r2.stdout || '';
      r = { stderr: (r.stderr || '') + (r2.stderr || '') };
    }
    await settle(); // let the server's log lines for this page arrive before grading them
    fs.writeFileSync(path.join(OUT, name + '.chrome.log'), r.stderr || '');
    const consoleErrs = consoleProblems(r.stderr);
    const serverErrs = serverProblems(lines.slice(mark));
    const domErrs = domProblems(dom);
    if (!fs.existsSync(shot)) domErrs.push('no screenshot written');
    fs.writeFileSync(path.join(OUT, name + '.html'), dom);
    const row = { name, login: s.login, hash: s.hash, consoleErrs, serverErrs, domErrs };
    row.bad = consoleErrs.length + serverErrs.length + domErrs.length;
    results.push(row);
    process.stdout.write(`${row.bad ? '✗' : '✓'} ${name}\n`);
    for (const e of consoleErrs) console.log('    console  ' + e);
    for (const e of serverErrs) console.log('    server   ' + e);
    for (const e of domErrs) console.log('    dom      ' + e);
  }
  await settle();
  srv.kill();
  fs.writeFileSync(path.join(OUT, 'server.log'), lines.join('\n'));

  const pad = (s, n) => String(s).padEnd(n);
  console.log('\n' + pad('screen', 22) + pad('console', 9) + pad('server≥400', 12) + pad('dom', 6) + 'result');
  console.log('-'.repeat(60));
  for (const r of results) console.log(pad(r.name, 22) + pad(r.consoleErrs.length, 9) + pad(r.serverErrs.length, 12) + pad(r.domErrs.length, 6) + (r.bad ? 'FAIL' : 'ok'));

  /* Distinct problems, so one app-wide defect is not read as 32 unrelated ones. */
  const distinct = new Map();
  for (const r of results) for (const [kind, list] of [['console', r.consoleErrs], ['server', r.serverErrs], ['dom', r.domErrs]])
    for (const e of list) { const k = kind + ' · ' + e; distinct.set(k, (distinct.get(k) || []).concat(r.name)); }
  if (distinct.size) {
    console.log('\nDistinct problems (' + distinct.size + '):');
    for (const [k, where] of [...distinct.entries()].sort((a, b) => b[1].length - a[1].length))
      console.log(`  [${where.length}/${results.length}] ${k}\n      on: ${where.slice(0, 6).join(', ')}${where.length > 6 ? ', …' : ''}`);
  }
  /* A parser that matches nothing would report a false green — say so loudly. */
  const seen = lines.filter((l) => LOG_RE.test(l)).length;
  if (!seen) console.log('\nWARNING: no request log line was parsed — the server log format changed, status >= 400 was NOT checked.');

  const failed = results.filter((r) => r.bad);
  console.log(`\n${results.length - failed.length}/${results.length} clean · ${seen} server requests seen · artefacts in ${path.relative(ROOT, OUT)}/`);
  if (!argv.includes('--keep')) fs.rmSync(dataDir, { recursive: true, force: true });
  process.exit(failed.length || !seen ? 1 : 0);
}
main().catch((e) => { console.error(e); process.exit(2); });
