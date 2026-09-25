#!/usr/bin/env node
/* record-snapshot.js — capture every API response the app asks for, for every role, into one JSON
 * file, so the demo can be served as a static page with no server behind it.
 *
 *   node scripts/record-snapshot.js [--out public/demo-snapshot.json] [--jobs=4] [--settle=4500]
 *
 * Why record rather than reimplement. The demo's server is ~21,000 lines of route logic over a JSON
 * store. Shipping it to the browser would mean shimming `fs` and `crypto` and would put real
 * session and permission code on a public page; reimplementing it would mean writing it twice.
 * Recording asks the real server the real questions once, here, and ships only the answers — so the
 * published page carries data and no logic at all, and there is nothing in it to escalate into.
 *
 * WHAT MAKES THE CAPTURE COMPLETE, and why it is not `smoke.js`'s matrix.
 *
 * The first version of this reused `scripts/smoke.js`'s (login, screen) matrix, which pairs each
 * screen with the user who really owns it — right for a smoke test, wrong here. The published page
 * lets a visitor pick any role and then click anything that role's navigation offers, so a
 * recording keyed by role has to cover, for each role, every route THAT role can reach. Recording
 * `/lekcja` only as the teacher meant the head teacher opened it to "not recorded", which is
 * exactly the click a visitor makes first.
 *
 * So the walk is nav-driven: sign in as a role, read the hash links the app itself rendered, and
 * visit each one. The app's own navigation is the definition of "what this role can reach", which
 * is the same definition the published page will use — so the two cannot disagree.
 *
 * The recording is a proxy, not an edit to the server. Nothing in `server/` changes, so what is
 * recorded is exactly what a real run serves. Each role gets its own proxy port, so a response can
 * never be filed under the wrong role even though roles are walked in parallel.
 */
'use strict';
const { spawn } = require('node:child_process');
const http = require('node:http');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const pdf = require('../server/lib/pdf');

const ROOT = path.join(__dirname, '..');
const argv = process.argv.slice(2);
const arg = (n, d) => { const a = argv.find((x) => x.startsWith('--' + n + '=')); return a ? a.split('=').slice(1).join('=') : d; };
const OUT = path.resolve(ROOT, arg('out', 'public/demo-snapshot.json'));
const JOBS = +arg('jobs', '4');
const SETTLE = +arg('settle', '4500');   // ms to let a screen finish asking before moving on
const LANG = arg('lang', 'pl');          // the published default; see build-static.js

/* `EDMAT_TODAY` is pinned. The demo's whole school calendar hangs off "today", and a snapshot
   recorded against a moving date would answer questions the page stops asking tomorrow — the
   screens ask `/api/lessons?date=<today>` by name. Pinned here, and the recorded config carries
   the same date to the page, so question and answer agree forever. */
const FROZEN_TODAY = '2026-10-23';

/* Whose eyes to record. Read from smoke.js's matrix so there is one list of demo people, not two;
   the SCREENS each of them sees are discovered from the app, not listed here. */
function loginsFromSmoke() {
  const src = fs.readFileSync(path.join(__dirname, 'smoke.js'), 'utf8');
  const start = src.indexOf('const MATRIX = [');
  if (start < 0) throw new Error('scripts/smoke.js no longer declares `const MATRIX = [`.');
  const open = src.indexOf('[', start);
  let depth = 0, end = -1;
  for (let i = open; i < src.length; i++) {
    if (src[i] === '[') depth++;
    else if (src[i] === ']') { depth--; if (depth === 0) { end = i + 1; break; } }
  }
  // eslint-disable-next-line no-eval
  const matrix = eval(src.slice(open, end));
  const logins = [...new Set(matrix.map((m) => m.login).filter(Boolean))];
  if (!logins.length) throw new Error('smoke.js MATRIX named no logins');
  return logins;
}

function startServer(port, dataDir) {
  const srv = spawn(process.execPath, [path.join(ROOT, 'server', 'index.js')], {
    cwd: ROOT,
    env: Object.assign({}, process.env, {
      PORT: String(port), EDMAT_DATA: dataDir, EDMAT_DEV: '1',
      EDMAT_TODAY: FROZEN_TODAY, EDMAT_ISSUES_FORWARD: '0',
    }),
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const lines = [];
  srv.stdout.on('data', (b) => lines.push(String(b)));
  srv.stderr.on('data', (b) => lines.push(String(b)));
  return { srv, lines };
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function waitReady(port) {
  for (let i = 0; i < 150; i++) {
    try { const r = await fetch(`http://127.0.0.1:${port}/api/auth/policy`); if (r.ok) return true; } catch (e) {}
    await sleep(200);
  }
  return false;
}

/** A recording proxy bound to ONE role, on its own port, so parallel roles cannot mislabel. */
function startProxy(proxyPort, demoPort, state, login) {
  const server = http.createServer((req, res) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => {
      const body = Buffer.concat(chunks);
      const up = http.request({
        host: '127.0.0.1', port: demoPort, method: req.method, path: req.url,
        headers: Object.assign({}, req.headers, { host: `127.0.0.1:${demoPort}` }),
      }, (ur) => {
        const out = [];
        ur.on('data', (c) => out.push(c));
        ur.on('end', () => {
          const buf = Buffer.concat(out);
          const ct = String(ur.headers['content-type'] || '');
          /* Successful JSON GETs only. A write is never recorded — the published page refuses
             writes rather than pretending to have made one — and a CSV or PDF is a stream this
             format cannot hold. */
          /* 200s AND refusals. A 403 is a real answer — "this role may not see that" — and the
             published page should give it rather than say the screen was never recorded. A 200 is
             stored as its bare body; anything else is wrapped with its status, which is the shape
             `snapshot.js` replays. Writes are still never recorded. */
          if (req.method === 'GET' && ct.includes('application/json') && req.url.startsWith('/api/')
              && (ur.statusCode === 200 || (ur.statusCode >= 400 && ur.statusCode < 500))) {
            try {
              const parsed = JSON.parse(buf.toString('utf8'));
              const bucket = (state.snap[login] = state.snap[login] || {});
              if (!(req.url in bucket)) state.total++;
              bucket[req.url] = ur.statusCode === 200 ? parsed : { __status: ur.statusCode, __data: parsed };
            } catch (e) {}
          }
          res.writeHead(ur.statusCode, ur.headers);
          res.end(buf);
        });
      });
      up.on('error', () => { try { res.writeHead(502); res.end('proxy upstream'); } catch (e) {} });
      if (body.length) up.write(body);
      up.end();
    });
  });
  return new Promise((resolve) => server.listen(proxyPort, '127.0.0.1', () => resolve(server)));
}

/* --- one Chrome, driven over CDP -------------------------------------------------------------
   Chrome's `--screenshot`/`--dump-dom` never return for this app: its screens keep timers running,
   so the page never reaches the quiet state those flags wait for and the process is only ever
   killed by a timeout. Driving it over the DevTools protocol means navigating deliberately and
   deciding ourselves when a screen has finished asking — which is also the only way to read the
   navigation back out of the rendered page. Node >= 22 has a global WebSocket, so this needs no
   dependency. */
/* Every wait here is bounded. An unguarded `await` on a socket that never opens hangs the whole
   run with no output and no error — which is exactly what happened on the first full pass, and is
   worse than failing, because a wedged verifier looks like a slow one. */
function deadline(promise, ms, what) {
  return Promise.race([
    promise,
    new Promise((_, reject) => setTimeout(() => reject(new Error('timed out waiting for ' + what)), ms)),
  ]);
}

async function withChrome(chromePath, fn) {
  const port = 9400 + Math.floor(Math.random() * 500);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'edmat-rec-'));
  const chrome = spawn(chromePath, [
    '--headless', '--no-sandbox', '--disable-gpu', '--hide-scrollbars', '--no-first-run',
    '--disable-background-networking', '--disable-sync', '--disable-component-update',
    '--remote-debugging-port=' + port, '--window-size=1280,1600',
    '--user-data-dir=' + dir, 'about:blank',
  ], { stdio: ['ignore', 'ignore', 'ignore'] });

  let targets = null;
  for (let i = 0; i < 150; i++) {
    try { targets = await deadline((await fetch(`http://127.0.0.1:${port}/json/list`)).json(), 5000, 'the target list'); break; } catch (e) { await sleep(200); }
  }
  if (!targets) { chrome.kill(); throw new Error('chrome devtools did not come up'); }
  const page = targets.find((t) => t.type === 'page');
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  let id = 0;
  const pending = new Map();
  ws.addEventListener('message', (ev) => {
    const msg = JSON.parse(ev.data);
    if (msg.id && pending.has(msg.id)) { pending.get(msg.id)(msg.result); pending.delete(msg.id); }
  });
  await deadline(new Promise((r) => ws.addEventListener('open', r)), 20000, 'the devtools socket to open');
  const send = (method, params) => new Promise((resolve) => {
    const myId = ++id; pending.set(myId, resolve);
    ws.send(JSON.stringify({ id: myId, method, params: params || {} }));
  });
  const evaluate = async (expression) => (await send('Runtime.evaluate', { expression, returnByValue: true }))?.result?.value;
  try { return await fn({ send, evaluate }); }
  finally {
    try { ws.close(); } catch (e) {}
    chrome.kill();
    /* Best effort, and deliberately not fatal: Chrome goes on writing its profile for a moment
       after `kill`, so removing the directory races it and throws ENOTEMPTY. Thrown from a
       `finally` that would otherwise have returned cleanly, it replaced a successful walk with
       "FAILED" in the log while the recording had in fact already been captured by the proxy — a
       tidy-up step reporting a failure that did not happen. A few megabytes left in /tmp is the
       cheaper mistake. */
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch (e) {}
  }
}

async function recordRole(chromePath, login, base, state, log) {
  await withChrome(chromePath, async ({ send, evaluate }) => {
    await send('Page.enable');
    await send('Runtime.enable');
    const landing = `${base}/api/dev/login?as=${encodeURIComponent(login)}&to=${encodeURIComponent('/?lang=' + LANG)}`;
    await send('Page.navigate', { url: landing });
    await sleep(SETTLE);

    /* The routes this role can reach, as the app itself drew them. `[...new Set()]` because the
       same destination appears in both the desktop nav and the phone drawer. */
    const routes = (await evaluate(
      '(function(){var s=new Set();document.querySelectorAll(\'a[href^="#/"]\').forEach(function(a){s.add(a.getAttribute("href").replace(/^#/,""))});return JSON.stringify([...s])})()'
    )) || '[]';
    const list = JSON.parse(routes);
    log(`  ${login.padEnd(20)} ${String(list.length).padStart(2)} routes from its own navigation`);

    for (const route of list) {
      const sep = route.indexOf('?') >= 0 ? '&' : '?';
      await send('Page.navigate', { url: `${base}/#${route}${sep}lang=${LANG}` });
      /* A hash change does not reload, so give the screen the same settle time and then force the
         router to notice — navigating to the same document only fires `hashchange`. */
      await sleep(SETTLE);
    }
    return list.length;
  });
}

async function main() {
  const chromePath = pdf.chromePath();
  if (!chromePath) { console.error('No headless Chromium found (set EDMAT_CHROME).'); process.exit(2); }
  const logins = loginsFromSmoke();
  const demoPort = 41000 + Math.floor(Math.random() * 8000);
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'edmat-rec-data-'));
  const state = { snap: {}, total: 0 };

  const { srv, lines } = startServer(demoPort, dataDir);
  if (!await waitReady(demoPort)) { srv.kill(); console.error('server did not start:\n' + lines.join('').slice(-1500)); process.exit(2); }

  console.log(`recording ${logins.length} roles, ${JOBS} at a time, ${SETTLE} ms per screen, lang=${LANG}`);
  const log = (s) => process.stdout.write(s + '\n');

  let nextPort = demoPort + 1;
  const queue = logins.slice();
  await Promise.all(Array.from({ length: Math.min(JOBS, queue.length) }, async () => {
    while (queue.length) {
      const login = queue.shift();
      const myPort = (nextPort += 2);
      const proxy = await startProxy(myPort, demoPort, state, login);
      try { await recordRole(chromePath, login, `http://127.0.0.1:${myPort}`, state, log); }
      catch (e) { log(`  ${login.padEnd(20)} FAILED: ${e.message}`); }
      finally { proxy.close(); }
    }
  }));

  srv.kill();

  const recorded = Object.keys(state.snap).sort();
  const payload = {
    recordedAt: new Date().toISOString(),
    frozenToday: FROZEN_TODAY,
    note: 'Recorded answers only — no server logic. Written by scripts/record-snapshot.js.',
    logins: recorded,
    responses: state.snap,
  };
  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, JSON.stringify(payload));
  console.log(`\nwrote ${path.relative(ROOT, OUT)} — ${recorded.length} roles, ${state.total} responses, ${Math.round(fs.statSync(OUT).size / 1024)} KB`);
  for (const l of recorded) console.log(`  ${l.padEnd(22)} ${Object.keys(state.snap[l]).length}`);
  if (!state.total) { console.error('nothing recorded'); process.exit(1); }
}

main().catch((e) => { console.error(e); process.exit(1); });
