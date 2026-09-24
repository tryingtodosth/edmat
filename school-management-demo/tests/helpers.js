'use strict';
const { createApp } = require('../server/index');
const { DEMO_PASSWORD, TODAY } = require('../server/seed/00-base');

/* ------------------------------------------------------------------ what may be replayed
   Exactly the failures that mean „the server never read this request" — the only case in which
   replaying a POST is safe. Anything else (a timeout after the request went out, a half-written
   body, an HTTP error) is a real failure and is rethrown with the route and the cause spelled out,
   so a broken handler can never be mistaken for a flake, and a flake can never be mistaken for a
   broken handler.
   The predicate reads BOTH halves: the old one was `e.cause.code || e.message`, so once undici set
   a code the message was never consulted and the string 'fetch failed' in its alternation was dead
   code — while UND_ERR_SOCKET („other side closed"), the commonest shape of the keep-alive race,
   fell straight through to `throw`. */
const REPLAYABLE_CODE = /^(ECONNRESET|ECONNREFUSED|EPIPE|UND_ERR_SOCKET)$/;
const REPLAYABLE_TEXT = /ECONNRESET|ECONNREFUSED|EPIPE|other side closed|socket hang up/i;
/** RFC 9110 idempotent methods: only these may be replayed after a connect timeout. */
const IDEMPOTENT = new Set(['GET', 'HEAD', 'OPTIONS', 'PUT', 'DELETE']);
function causeOf(e) { return (e && e.cause) || null; }
function replayable(e, method) {
  const c = causeOf(e);
  const code = String((c && c.code) || (e && e.code) || '');
  const text = String((e && e.message) || '') + ' ' + String((c && c.message) || '');
  if (REPLAYABLE_CODE.test(code) || REPLAYABLE_TEXT.test(text)) return true;
  /* The connect never completed, so nothing was written: safe to replay, but only for a method
     that may be repeated. (`docs/review/regressions.md` §6: „the first fetch after app.listen(0)
     never connects" — the accept queue not drained while the loop is starved.) */
  return code === 'UND_ERR_CONNECT_TIMEOUT' && IDEMPOTENT.has(String(method || '').toUpperCase());
}
/** The failure a test finally sees: the route, the cause code and how many replays it took. */
function requestError(method, path, e, attempt) {
  const c = causeOf(e);
  const code = String((c && c.code) || (e && e.code) || '');
  const why = String((c && c.message) || (e && e.message) || e);
  return new Error(`${method} ${path}: ${(e && e.message) || e}${code ? ' [' + code + ']' : ''}${code || why === ((e && e.message) || '') ? '' : ' — ' + why}${attempt ? ' (po ' + attempt + ' ponowieniach)' : ''}`, { cause: e });
}

/** Starts an in-memory seeded server; returns { base, app, db, close, client(login) } */
async function startServer(opts) {
  const app = createApp(Object.assign({ dataFile: null, quiet: true }, opts || {}));
  /* Node closes an idle keep-alive socket after `server.keepAliveTimeout` (5 s by default). undici —
     the engine behind global `fetch` — keeps that socket in its pool, so a request written into it
     in the same tick the server sends FIN comes back as `TypeError: fetch failed`
     (cause ECONNRESET / UND_ERR_SOCKET). A test regularly leaves the pool idle for longer than 5 s:
     a 400-row import, a year of generated lessons, a Chromium run, or simply a starved event loop
     when six suites share six cores — and the starvation also delays undici's own close handler,
     which widens the window further. A test server lives for seconds, on loopback, for one client:
     let it hold the connection for the whole file instead of racing it. Production keep-alive is
     untouched (`server/index.js` is not edited), so this hides no product behaviour — it removes a
     property of the *test harness*.
     Repro: node docs/review/round3/repro/keepalive-race.js --rounds 20 --gap 5010 --burners 6 --block
     (10/20 ECONNRESET at 5 s, 0/20 at 120 s). */
  app.server.keepAliveTimeout = 120000;
  app.server.headersTimeout = 150000;                  // must stay above keepAliveTimeout, or Node warns
  const port = await app.listen(0); const base = `http://127.0.0.1:${port}`;
  function client() {
    let cookie = '';
    async function call(method, path, body, headers) {
      let res;
      for (let attempt = 0; ; attempt++) {
        try {
          res = await fetch(base + path, { method, headers: Object.assign({ 'Content-Type': 'application/json', Cookie: cookie }, headers || {}), body: body != null ? (typeof body === 'string' ? body : JSON.stringify(body)) : undefined, redirect: 'manual' });
          break;
        } catch (e) {
          if (attempt >= 4 || !replayable(e, method)) throw requestError(method, path, e, attempt);
          await new Promise((r) => setTimeout(r, 120 * (attempt + 1)));
        }
      }
      const sc = res.headers.get('set-cookie'); if (sc) cookie = sc.split(';')[0];
      const ct = res.headers.get('content-type') || ''; const data = ct.includes('application/json') ? await res.json() : ct.startsWith('text/') || ct.includes('xml') || ct.includes('csv') ? await res.text() : Buffer.from(await res.arrayBuffer());
      return { status: res.status, ok: res.ok, body: data, headers: res.headers };
    }
    const c = { get: (p, h) => call('GET', p, null, h), post: (p, b, h) => call('POST', p, b, h), put: (p, b, h) => call('PUT', p, b, h), patch: (p, b, h) => call('PATCH', p, b, h), delete: (p, b, h) => call('DELETE', p, b, h), call, get cookie() { return cookie; }, set cookie(v) { cookie = v; } };
    c.login = async (login, password) => { const r = await call('POST', '/api/auth/login', { login, password: password || DEMO_PASSWORD }); if (!r.ok) throw new Error('login failed for ' + login + ': ' + JSON.stringify(r.body)); c.user = r.body.user; return r.body; };
    return c;
  }
  async function as(login) { const c = client(); await c.login(login); return c; }
  return { app, db: app.db, base, client, as, close: () => app.close(), TODAY, DEMO_PASSWORD };
}
/** Expect helper for readable failures: expectOk(res) */
function expectOk(res, msg) { if (!res.ok) throw new Error((msg || 'request failed') + ': ' + res.status + ' ' + JSON.stringify(res.body).slice(0, 300)); return res.body; }
/* ------------------------------------------------------------------ fixtures shared between tests
   A test that needs state another test creates used to rely on file order, so `node --test
   --test-name-pattern='\[3.3.5\]'` failed on its own. `fixtures()` hands out a memoised builder:
   the first test that asks for a key builds it, every later one gets the same value. In a whole-file
   run that is the test that owned the step; alone, it is the test that needs it. */
function fixtures() {
  const made = new Map();
  /** need(key, build) — build() runs at most once per suite; every caller awaits the same result. */
  return function need(key, build) {
    if (!made.has(key)) made.set(key, Promise.resolve().then(build));
    return made.get(key);
  };
}

/** Sets db.data.config[key] for the duration of fn and restores it even when fn throws. */
async function withConfig(db, patch, fn) {
  /* A key the configuration did not have must come back ABSENT, not present-and-undefined:
     /api/auth/session hands the whole config to every signed-in client, and tests set keys the seed
     does not define (`archiveSignatureMaxMB` in tests/52-archive.test.js), so a future
     `'key' in config` or `Object.keys(config)` would read a leftover from a finished test. */
  const before = {}; const added = [];
  for (const k of Object.keys(patch)) { if (k in db.data.config) before[k] = db.data.config[k]; else added.push(k); }
  Object.assign(db.data.config, patch);
  try { return await fn(); } finally { Object.assign(db.data.config, before); for (const k of added) delete db.data.config[k]; }
}

/* ------------------------------------------------------------------ the real client in a sandbox
   loadClient() runs public/app/i18n.js, public/edmat/bundle.js, public/app/core.js and
   public/app/shell.js in a node:vm context on a minimal DOM stub, with a small React (hooks with
   per-component storage, re-render on setState) that is enough to render the shell. Tests can then
   press a real key and look at what the shell renders instead of grepping the sources. */
function loadClient(opts) {
  const vm = require('node:vm'); const fs = require('node:fs'); const path = require('node:path');
  const o = opts || {}; const PUB = path.join(__dirname, '..', 'public');
  const read = (...p) => fs.readFileSync(path.join(PUB, ...p), 'utf8');

  const store = new Map(); let cur = null; let dirty = false; let effects = [];
  const hooksOf = (k) => { if (!store.has(k)) store.set(k, []); return store.get(k); };
  const same = (a, b) => !!a && !!b && a.length === b.length && a.every((x, i) => Object.is(x, b[i]));
  const el = function (type, props) { const kids = [].slice.call(arguments, 2); return { $ed: true, type, props: Object.assign({}, props || {}, kids.length ? { children: kids.length === 1 ? kids[0] : kids } : {}) }; };
  const React = {
    Fragment: 'ed:fragment', createElement: el,
    useState(init) { const hs = cur.hs, i = cur.i++; if (!(i in hs)) hs[i] = typeof init === 'function' ? init() : init; return [hs[i], (v) => { hs[i] = typeof v === 'function' ? v(hs[i]) : v; dirty = true; }]; },
    useEffect(fn, deps) { const hs = cur.hs, i = cur.i++; const prev = hs[i]; if (!prev || !deps || !same(prev.deps, deps)) { hs[i] = { deps }; effects.push(fn); } },
    useLayoutEffect(fn, deps) { return React.useEffect(fn, deps); },
    useRef(init) { const hs = cur.hs, i = cur.i++; if (!(i in hs)) hs[i] = { current: init }; return hs[i]; },
    useMemo(fn, deps) { const hs = cur.hs, i = cur.i++; const prev = hs[i]; if (!prev || !deps || !same(prev.deps, deps)) hs[i] = { deps, v: fn() }; return hs[i].v; },
    useCallback(fn, deps) { return React.useMemo(() => fn, deps); },
  };
  let root = null;
  const keys = {};                                   // event name -> [handler]
  const focused = [];
  const search = { tagName: 'INPUT', focus: () => focused.push('search') };
  const sandbox = {
    console, React, ReactDOM: { createRoot: () => ({ render: (e) => { root = e; } }) },
    setTimeout, clearTimeout, setInterval: () => 0, clearInterval: () => {}, queueMicrotask,
    localStorage: (() => { const s = {}; return { getItem: (k) => (k in s ? s[k] : null), setItem: (k, v) => { s[k] = String(v); }, removeItem: (k) => { delete s[k]; } }; })(),
    navigator: { onLine: true, userAgent: 'node' },
    location: (() => { let hash = o.hash || '#/'; return { get hash() { return hash; }, set hash(v) { const next = String(v).startsWith('#') ? String(v) : '#' + v; if (next === hash) return; hash = next; for (const fn of keys.hashchange || []) fn({ type: 'hashchange' }); }, search: '', pathname: '/' }; })(),
    matchMedia: () => ({ matches: false, addEventListener: () => {}, addListener: () => {} }),
    fetch: o.fetch || (async (url) => ({ status: 200, ok: true, headers: { get: () => 'application/json' }, json: async () => clientStub(String(url), o) })),
    addEventListener: (ev, fn) => { (keys[ev] = keys[ev] || []).push(fn); }, removeEventListener: () => {},
    document: {
      documentElement: { dataset: {}, style: {}, lang: 'pl' }, body: { dataset: {}, style: {} }, title: '',
      addEventListener: (ev, fn) => { (keys[ev] = keys[ev] || []).push(fn); }, removeEventListener: () => {},
      querySelector: (sel) => (sel === '[data-app-search]' ? search : null), querySelectorAll: () => [],
      getElementById: () => ({}), createElement: () => ({ style: {}, setAttribute() {}, appendChild() {} }),
    },
  };
  sandbox.window = sandbox;
  vm.createContext(sandbox);
  /* Same order as public/index.html: report-issue.js defines A.reportIssue, which the shell's
     footer and top bar both render, so a harness without it renders an undefined component. */
  for (const f of [['app', 'i18n.js'], ['edmat', 'bundle.js'], ['app', 'core.js'], ['app', 'report-issue.js']]) vm.runInContext(read(...f), sandbox, { filename: f.join('/') });
  const A = sandbox.EdApp;
  for (const s of o.screens || []) A.screen(s);
  vm.runInContext(read('app', 'shell.js'), sandbox, { filename: 'shell.js' });

  const DS = new Set(Object.values(sandbox.EdMat).filter((x) => typeof x === 'function'));
  let nodes = [];
  function walk(node, key) {
    if (Array.isArray(node)) { node.forEach((n, i) => walk(n, key + ':' + i)); return; }
    if (!node || typeof node !== 'object' || !node.$ed) return;
    nodes.push(node);
    if (typeof node.type !== 'function') return walk(node.props && node.props.children, key);
    if (DS.has(node.type)) return walk(node.props && node.props.children, key + '/' + (node.type.name || 'c'));
    const k = key + '/' + (node.type.name || 'anon'); const prev = cur;
    cur = { hs: hooksOf(k), i: 0 };
    let sub; try { sub = node.type(node.props || {}); } finally { cur = prev; }
    walk(sub, k);
  }
  /** One render pass plus the effects it schedules; repeated until the tree settles. */
  async function render(passes) {
    for (let i = 0; i < (passes || 8); i++) {
      dirty = false; nodes = []; effects = [];
      walk(root, '');
      const fx = effects; effects = [];
      for (const f of fx) { try { f(); } catch (e) { /* effects that need a real DOM are not the subject */ } }
      await new Promise((r) => setTimeout(r, 2));
    }
    return ui;
  }
  /** press('2', { altKey: true }) — dispatches a real keydown into the handler core.js registered. */
  function press(key, mods) {
    let prevented = false;
    const e = Object.assign({ key, target: { tagName: 'BODY' }, preventDefault: () => { prevented = true; } }, mods || {});
    for (const fn of keys.keydown || []) fn(e);
    return prevented;
  }
  const ui = {
    A, E: sandbox.EdMat, I: sandbox.EdI18n, sandbox, render, press, focused,
    fire: (ev) => Promise.all((keys[ev] || []).map((f) => f())),
    get hash() { return sandbox.location.hash; },
    /** Names of every component the last render produced. */
    names: () => [...new Set(nodes.map((n) => (typeof n.type === 'function' ? n.type.name || 'anon' : n.type)))],
    /** The rendered node of a component, by name (e.g. 'ShortcutsDialog'), or undefined. */
    find: (name) => nodes.find((n) => (typeof n.type === 'function' ? n.type.name : n.type) === name),
    /** Every rendered node of a component, by name. */
    all: (name) => nodes.filter((n) => (typeof n.type === 'function' ? n.type.name : n.type) === name),
  };
  return ui;
}
/** The handful of API answers the shell asks for while booting in the sandbox. */
function clientStub(url, o) {
  if (url.includes('/api/setup/status')) return { needed: false };
  if (url.includes('/api/auth/session')) return o.session || { user: { id: 'u_nowak', login: 'j.nowak', role: 'teacher', name: 'mgr Joanna Nowak' }, config: { school: { short: 'SP7' } }, remainingSeconds: 900 };
  if (url.includes('unread-count')) return { count: 0 };
  if (url.includes('personas')) return { personas: [] };
  return {};
}

/* ------------------------------------------------------------------ the real browser
   The same headless Chromium scripts/smoke.js uses. `chromium()` is null when none is installed —
   callers skip the sub-test rather than the story. */
function chromium() { return require('../server/lib/pdf').chromePath(); }
/** Runs `body` (a JS function body returning something JSON-serialisable) on `html` in the headless
    Chromium at the given viewport, and returns what it produced. Throws when the page script threw. */
async function inChromium(html, body, opts) {
  const { execFile } = require('node:child_process');
  const fs = require('node:fs'); const os = require('node:os'); const path = require('node:path');
  const o = opts || {}; const chrome = chromium(); if (!chrome) throw new Error('no chromium');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'edmat-ui-'));
  const probe = '<script>window.addEventListener("load", function () { setTimeout(function () { var r; try { r = { ok: true, value: (function () {' + body + '})() }; } catch (e) { r = { ok: false, error: String((e && e.stack) || e) }; } document.title = "EDMAT:" + btoa(unescape(encodeURIComponent(JSON.stringify(r)))); }, 60); });</script>';
  const page = html.includes('</body>') ? html.replace('</body>', probe + '</body>') : html + probe;
  const file = path.join(dir, 'probe.html');
  fs.writeFileSync(file, page, 'utf8');
  const args = ['--headless', '--no-sandbox', '--disable-gpu', '--hide-scrollbars', '--run-all-compositor-stages-before-draw',
    '--virtual-time-budget=' + (o.budget || 8000), '--user-data-dir=' + path.join(dir, 'profile'),
    `--window-size=${o.width || 390},${o.height || 844}`, '--dump-dom', 'file://' + file];
  const out = await runChromium(execFile, chrome, args, o);
  try { fs.rmSync(dir, { recursive: true, force: true }); } catch (e) {}
  const m = /<title>EDMAT:([A-Za-z0-9+/=]*)<\/title>/.exec(out);
  if (!m) throw new Error('the page never reported back (dump ' + out.length + ' bytes)');
  const r = JSON.parse(Buffer.from(m[1], 'base64').toString('utf8'));
  if (!r.ok) throw new Error('page script failed: ' + r.error);
  return r.value;
}
/** The DOM the real app renders for `url`, as the headless Chromium leaves it (same call smoke.js makes). */
async function domOf(url, opts) {
  const { execFile } = require('node:child_process');
  const fs = require('node:fs'); const os = require('node:os'); const path = require('node:path');
  const o = opts || {}; const chrome = chromium(); if (!chrome) throw new Error('no chromium');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'edmat-dom-'));
  const args = ['--headless', '--no-sandbox', '--disable-gpu', '--hide-scrollbars', '--run-all-compositor-stages-before-draw',
    '--virtual-time-budget=' + (o.budget || 12000), '--user-data-dir=' + path.join(dir, 'profile'),
    `--window-size=${o.width || 390},${o.height || 844}`, '--dump-dom', url];
  const out = await runChromium(execFile, chrome, args, o);
  try { fs.rmSync(dir, { recursive: true, force: true }); } catch (e) {}
  return out;
}
/**
 * One Chromium run, retried once when the browser was killed by its own timeout.
 * A Chromium killed by `execFile`'s timeout is a LOADED MACHINE, not a broken screen: without this,
 * `[3.9.10]` fails as „Chromium wyrenderował ekran /uczen" or „the page never reported back
 * (dump 0 bytes)", which blames the app for a starved browser. EDMAT_UI_TIMEOUT raises the limit.
 */
async function runChromium(execFile, chrome, args, o) {
  const limit = (o && o.timeout) || +process.env.EDMAT_UI_TIMEOUT || 60000;
  const run = () => new Promise((resolve) => execFile(chrome, args, { encoding: 'utf8', timeout: limit, maxBuffer: 32 * 1024 * 1024 }, (err, stdout) => resolve({ err, out: stdout || '' })));
  let r = await run();
  if (r.err && r.err.killed) r = await run();
  if (r.err && r.err.killed) throw new Error(`Chromium przekroczył ${limit} ms dwa razy z rzędu — maszyna jest obciążona (EDMAT_UI_TIMEOUT podnosi limit); to nie jest wynik testu aplikacji`);
  return r.out;
}
module.exports = { startServer, expectOk, fixtures, withConfig, loadClient, chromium, inChromium, domOf, DEMO_PASSWORD, TODAY };

