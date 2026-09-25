#!/usr/bin/env node
/* verify-static.js — walk the BUILT static demo the way a visitor would and fail if any screen is
 * dead. This is the regression test for the snapshot.
 *
 *   node scripts/verify-static.js [--dir dist-static] [--port 8123] [--settle=3500]
 *
 * What it asserts, per role, over every route that role's own navigation offers:
 *   - no uncaught exception and no console error,
 *   - no snapshot MISS (`window.EdSnapshot.misses` stays empty),
 *   - the page rendered something — an <h1> with text,
 *   - no raw "undefined"/"NaN"/"[object Object]" leaked into the rendered text.
 *
 * Why this exists separately from `record-snapshot.js`, when both walk the navigation: the recorder
 * asks the real server and can therefore never miss. This one asks the SHIPPED FILE, with no server
 * running at all, which is the only configuration that answers the question people actually care
 * about — is the page anybody will visit complete? A snapshot that was recorded correctly and then
 * built wrongly looks identical until somebody clicks.
 *
 * It serves the build itself, on a threaded server. `python3 -m http.server` is single-threaded and
 * a browser opens several connections at once, so the page simply never finishes loading behind it
 * — an hour was lost to that before it was noticed.
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
const DIR = path.resolve(ROOT, arg('dir', 'dist-static'));
const PORT = +arg('port', String(8200 + Math.floor(Math.random() * 500)));
const SETTLE = +arg('settle', '3500');
const BASE = '/dziennik';

const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.svg': 'image/svg+xml', '.webmanifest': 'application/manifest+json', '.png': 'image/png', '.woff2': 'font/woff2' };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function serve() {
  const server = http.createServer((req, res) => {
    let p = decodeURIComponent(req.url.split('?')[0]);
    if (!p.startsWith(BASE)) { res.writeHead(404); return res.end('not found'); }
    p = p.slice(BASE.length) || '/';
    let file = path.join(DIR, path.normalize(p).replace(/^(\.\.[/\\])+/, ''));
    if (!file.startsWith(DIR)) { res.writeHead(403); return res.end('no'); }
    if (fs.existsSync(file) && fs.statSync(file).isDirectory()) file = path.join(file, 'index.html');
    if (!fs.existsSync(file)) { res.writeHead(404); return res.end('not found'); }
    res.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream' });
    res.end(fs.readFileSync(file));
  });
  return new Promise((r) => server.listen(PORT, '127.0.0.1', () => r(server)));
}

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
  const port = 9600 + Math.floor(Math.random() * 300);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'edmat-ver-'));
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
  const ws = new WebSocket(targets.find((t) => t.type === 'page').webSocketDebuggerUrl);
  let id = 0; const pending = new Map(); const problems = [];
  ws.addEventListener('message', (ev) => {
    const msg = JSON.parse(ev.data);
    if (msg.id && pending.has(msg.id)) { pending.get(msg.id)(msg.result); pending.delete(msg.id); }
    if (msg.method === 'Runtime.consoleAPICalled' && msg.params.type === 'error') {
      problems.push('console: ' + (msg.params.args || []).map((a) => a.value ?? a.description ?? '').join(' ').slice(0, 200));
    }
    if (msg.method === 'Runtime.exceptionThrown') {
      problems.push('exception: ' + String(msg.params.exceptionDetails?.exception?.description || msg.params.exceptionDetails?.text).slice(0, 200));
    }
  });
  await deadline(new Promise((r) => ws.addEventListener('open', r)), 20000, 'the devtools socket to open');
  const send = (method, params) => new Promise((resolve) => { const myId = ++id; pending.set(myId, resolve); ws.send(JSON.stringify({ id: myId, method, params: params || {} })); });
  const evaluate = async (e) => (await send('Runtime.evaluate', { expression: e, returnByValue: true }))?.result?.value;
  try { return await fn({ send, evaluate, problems }); }
  finally { try { ws.close(); } catch (e) {} chrome.kill(); try { fs.rmSync(dir, { recursive: true, force: true }); } catch (e) {} }
}

async function main() {
  const chromePath = pdf.chromePath();
  if (!chromePath) { console.error('No headless Chromium (set EDMAT_CHROME).'); process.exit(2); }
  if (!fs.existsSync(path.join(DIR, 'app', 'demo-snapshot.js'))) {
    console.error(`No built demo at ${path.relative(ROOT, DIR)} — run scripts/build-static.js first.`); process.exit(2);
  }
  const server = await serve();
  const origin = `http://127.0.0.1:${PORT}${BASE}`;
  const snap = JSON.parse(fs.readFileSync(path.join(ROOT, 'public', 'demo-snapshot.json'), 'utf8'));
  const roles = snap.logins;
  console.log(`verifying ${path.relative(ROOT, DIR)} — ${roles.length} roles, served at ${origin}`);

  let failures = 0, screens = 0;
  for (const role of roles) {
    const bad = await withChrome(chromePath, async ({ send, evaluate, problems }) => {
      await send('Page.enable'); await send('Runtime.enable');
      await send('Page.navigate', { url: origin + '/' });
      await sleep(SETTLE);
      // Become this role the way the page's own switcher does, then reload into it.
      await evaluate(`localStorage.setItem('edmat.demo.role', ${JSON.stringify(role)})`);
      await send('Page.navigate', { url: origin + '/' });
      await sleep(SETTLE);
      const routes = JSON.parse(await evaluate(
        '(function(){var s=new Set();document.querySelectorAll(\'a[href^="#/"]\').forEach(function(a){s.add(a.getAttribute("href").replace(/^#/,""))});return JSON.stringify([...s])})()'
      ) || '[]');
      const found = [];
      for (const route of routes) {
        await send('Page.navigate', { url: `${origin}/#${route}` });
        await sleep(SETTLE);
        screens++;
        const h1 = (await evaluate('(document.querySelector("h1")||{}).textContent||""')) || '';
        const text = (await evaluate('document.body.innerText||""')) || '';
        if (!h1.trim()) found.push(`${route}: no <h1>`);
        for (const junk of ['undefined', 'NaN', '[object Object]']) {
          if (text.includes(junk)) { found.push(`${route}: rendered literal "${junk}"`); break; }
        }
      }
      const misses = JSON.parse((await evaluate('JSON.stringify((window.EdSnapshot&&window.EdSnapshot.misses)||[])')) || '[]');
      for (const m of misses) found.push(`MISS ${m}`);
      for (const p of problems) found.push(p);
      return { routes: routes.length, found };
    });
    const mark = bad.found.length ? 'FAIL' : ' OK ';
    console.log(`  [${mark}] ${role.padEnd(20)} ${String(bad.routes).padStart(2)} routes`);
    for (const f of bad.found) console.log(`         ${f}`);
    failures += bad.found.length;
  }
  server.close();
  console.log(`\n${screens} screens walked, ${failures} problem(s)`);
  process.exit(failures ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(1); });
