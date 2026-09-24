'use strict';
const http = require('node:http'); const fs = require('node:fs'); const path = require('node:path'); const url = require('node:url');
const { Store } = require('./lib/store'); const { Router, HttpError, httpError, parseCookies, readBody, readJsonBody, sendJson, sendFile, safeContentDisposition } = require('./lib/router');
const auth = require('./auth'); const { audit } = require('./lib/audit'); const util = require('./lib/util');
const PUBLIC = path.join(__dirname, '..', 'public');

function loadSeeds(db, ctx) {
  const dir = path.join(__dirname, 'seed'); const files = fs.readdirSync(dir).filter((f) => f.endsWith('.js')).sort();
  for (const f of files) require(path.join(dir, f)).seed(db, ctx);
  db.data.meta = { seededAt: util.now(), seeds: files }; db.flush();
}
const modules = require('./modules');
function loadRoutes(router, app) {
  auth.register(router, app);
  const dir = path.join(__dirname, 'routes'); const files = fs.readdirSync(dir).filter((f) => f.endsWith('.js')).sort();
  for (const f of files) { const before = router.routes.length; require(path.join(dir, f)).register(router, app); const mod = modules.moduleOfRouteFile(f); for (let i = before; i < router.routes.length; i++) router.routes[i].module = mod; }
}
/* -------------------------------------------------------------------- publicConfig (S3-02) ------
   `GET /api/auth/session` hands this object to **every** signed-in account, including a 13-year-old
   pupil and every guardian. It used to be `config` minus three keys, which shipped the school's video
   webhook secret and Jitsi JWT signing key (`video.*Secret`), the teachers' pay rates (`payroll`), a
   sentence stating in plain Polish that administrative logins are not IP-restricted
   (`ipAllowlistNote` / `ipAllowlistExample`) and the whole security posture (`require2FAForGradeEditors`,
   `sessionTimeoutMin`, `logRetentionYears`, the retention table). A deny list cannot hold: every key a
   future seed adds is public by default.
   So: an allowlist of the keys the client really reads. Adding a key here is a deliberate act — grep
   `public/app` for `config.`/`cfg.` first, and never put a secret in `db.data.config` at all
   (CONTRIBUTING.md; the VAPID pair lives in its own `pushKeys` collection for exactly this reason). */
const PUBLIC_CONFIG_KEYS = [
  'school',                  // shell.js (context), every screen subtitle, printouts
  'year', 'today', 'timezone',
  'demo', 'setup',           // core.js (demo banner), shell.js (first-run wizard gate)
  'messaging',               // admin.js „kto może pisać do nauczycieli”
  'visibility',              // parent/student views: class average and rankings switches
  'adultAccess',             // registrar + student: which rule applies after the 18th birthday
  'sessionTimeoutMin', 'sessionWarnBeforeMin',   // settings.js session card, shell timeout dialog
  'homeworkMaxAttachmentMB', 'testLimits',       // teacher-lesson.js homework and test cards
  'helpVideoUrl',            // settings.js tutorial video
];
/** `config.push` carries the school's public VAPID key and the payload mode — never a secret. */
const PUBLIC_PUSH_KEYS = ['enabled', 'payload', 'publicKey', 'subject'];
function publicConfig(db) {
  const c = db.data.config || {};
  const out = {};
  for (const k of PUBLIC_CONFIG_KEYS) if (c[k] !== undefined) out[k] = c[k];
  if (c.push && typeof c.push === 'object') { out.push = {}; for (const k of PUBLIC_PUSH_KEYS) if (c.push[k] !== undefined) out.push[k] = c.push[k]; }
  return out;
}

function createApp(options) {
  const opts = Object.assign({ dataFile: null, seed: true, secureCookies: false, quiet: false }, options || {});
  const db = new Store(opts.dataFile); const app = { db, options: opts, router: new Router(), publicConfig: () => publicConfig(db), sessionExtras: [], hooks: {} };
  const loaded = db.load(); if (!loaded || opts.reseed) { db.data = {}; if (opts.blank || process.env.EDMAT_SEED === 'blank') { require('./lib/blank-seed').blankSeed(db); db.flush(); } else loadSeeds(db, { util }); }
  app.migration = require('./lib/migrate').migrate(db, { quiet: opts.quiet });
  loadRoutes(app.router, app);
  const screensJs = () => { const dir = path.join(PUBLIC, 'app', 'screens'); return `window.EdApp.setModules(${JSON.stringify(modules.enabledMap(db))});\n` + fs.readdirSync(dir).filter((f) => f.endsWith('.js')).sort().map((f) => `/* ${f} */\n` + fs.readFileSync(path.join(dir, f), 'utf8')).join('\n;\n'); };
  const BASE = (opts.basePath || process.env.EDMAT_BASE_PATH || '').replace(/\/+$/, '');
  app.basePath = BASE;
  /* The school's own video host is the single allowed external origin, and only when it is really configured (the seed ships an example domain on purpose). See docs/VIDEO.md. */
  const videoOrigin = () => {
    const v = (db.data.config && db.data.config.video) || {};
    const d = String((process.env.EDMAT_JITSI_DOMAIN || (v.jitsi && v.jitsi.domain) || '')).trim();
    if (v.provider && v.provider !== 'jitsi') return '';
    if (!d || !/^(?=.{1,253}$)([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,}$/i.test(d)) return '';
    return 'https://' + d;
  };
  /* D3-28 — the DPIA and the tracker scan quote this policy. They used to obtain it by running a
     regex over the source of this very file, and because the policy is a template literal the regex
     ran past the closing backtick and dumped three kilobytes of request-handling code into the
     document, in both locales. One named builder, exported as `app.contentSecurityPolicy`, is the
     source; `server/lib/compliance.js` reads it from there. (Keep the policy text itself out of the
     comments in this file — the old regex latched onto the first mention, comment or not.) */
  const contentSecurityPolicy = () => {
    const v = videoOrigin(); const w = v ? ' ' + v : ''; const ws = v ? ' ' + v.replace(/^https:/, 'wss:') : '';
    return `default-src 'self'; img-src 'self' data: blob:${w}; style-src 'self' 'unsafe-inline'; script-src 'self'${w}; connect-src 'self'${w}${ws}; media-src 'self' blob:${w}; frame-src 'self'${w}; font-src 'self'; object-src 'none'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'`;
  };
  app.contentSecurityPolicy = contentSecurityPolicy;
  const secHeaders = (res, isSecure) => {
    res.setHeader('X-Content-Type-Options', 'nosniff'); res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Referrer-Policy', 'same-origin'); res.setHeader('Permissions-Policy', 'camera=(self), microphone=(self), display-capture=(self), geolocation=()');
    res.setHeader('Content-Security-Policy', contentSecurityPolicy());
    if (isSecure) res.setHeader('Strict-Transport-Security', 'max-age=63072000; includeSubDomains; preload');
  };
  /* S3-03/R3-07 — the one route that answers without a session needs its own brake. The login route
     has `auth.guarded`; this is the same idea, per IP, for every `{ public: true }` GET: a token
     bucket that refills at PUBLIC_RATE requests per minute. Answering 429 costs nothing, and the
     cached document behind it costs nothing either, so a loop from the internet can no longer keep
     the single Node process busy while a teacher is taking attendance. */
  const PUBLIC_RATE = +(process.env.EDMAT_PUBLIC_RATE || 30);     // requests per minute per address
  const publicBuckets = new Map();
  const publicAllowed = (ip) => {
    const now = Date.now(); const key = ip || '-';
    let b = publicBuckets.get(key);
    if (!b) { b = { tokens: PUBLIC_RATE, at: now }; publicBuckets.set(key, b); }
    b.tokens = Math.min(PUBLIC_RATE, b.tokens + ((now - b.at) / 60000) * PUBLIC_RATE); b.at = now;
    if (publicBuckets.size > 5000) for (const [k, v] of publicBuckets) { if (now - v.at > 300000) publicBuckets.delete(k); }
    if (b.tokens < 1) return false;
    b.tokens -= 1; return true;
  };
  app.publicRateLimit = { limit: PUBLIC_RATE, allowed: publicAllowed, reset: () => publicBuckets.clear() };
  /* REL-17 / S3-15 — jedna ustrukturyzowana linia na żądanie: znacznik czasu ISO, metoda, **wzorzec
     trasy** (`/api/registry/students/:id/guardians`), status, czas obsługi, konto (albo `-`), krótki
     identyfikator żądania i kod błędu, jeśli poszła odpowiedź błędu JSON.
     Wzorzec, a nie ścieżka: identyfikatory w tym schemacie SĄ nazwiskami (`st_kowalczyk_anna`), a
     log operacyjny to zwykły plik — poza sklepem, poza audytem i poza polityką retencji, najchętniej
     wysyłany do hostującego. Wycinanie query stringu bez wycięcia ścieżki niczego nie chroniło.
     Dla zasobów statycznych i dla żądań, które nie trafiły w żadną trasę, ścieżka idzie przez
     `redactPath`: człon, który nie wygląda na nazwę pliku ani na segment API, zostaje `:x`.
     Identyfikator wraca w nagłówku `X-Request-Id`; przychodzący jest uszanowany, gdy wygląda
     bezpiecznie, dzięki czemu log serwera da się zestawić z logiem odwrotnego proxy.
     Bez kolorów i bez zmiennych ozdobników — linia ma się parsować. */
  const SAFE_SEG = /^[A-Za-z0-9][A-Za-z0-9.-]{0,15}$/;
  const redactPath = (p) => String(p || '/').split('/').map((seg) => (!seg || SAFE_SEG.test(seg) ? seg : ':x')).join('/') || '/';
  const REQ_ID = /^[A-Za-z0-9._-]{4,64}$/;
  const requestId = (req) => { const h = req.headers['x-request-id']; return typeof h === 'string' && REQ_ID.test(h) ? h : util.id(); };
  const server = http.createServer(async (req, res) => {
    const started = Date.now(); const u = url.parse(req.url, true); let pathname = u.pathname;
    const reqId = requestId(req); res.setHeader('X-Request-Id', reqId);
    let logUserId = null, logErrCode = null, logPath = null;
    if (BASE) { if (pathname === BASE) { res.writeHead(302, { Location: BASE + '/' }); return res.end(); } if (pathname.startsWith(BASE + '/')) pathname = pathname.slice(BASE.length); else if (!pathname.startsWith('/api/') && pathname !== '/app/autoprint.js') { res.writeHead(404, { 'Content-Type': 'text/plain' }); return res.end('Not found (base path ' + BASE + ')'); } }
    const isSecure = !!(req.socket.encrypted || req.headers['x-forwarded-proto'] === 'https'); secHeaders(res, isSecure);
    try {
      if (pathname.startsWith('/api/')) {
        const m = app.router.match(req.method, pathname);
        if (!m) throw httpError(404, 'Nie znaleziono zasobu API.'); if (m.methodNotAllowed) throw httpError(405, 'Metoda niedozwolona.');
        const { route, params } = m; const ip = auth.ipOf(req); logPath = route.pattern;
        if (route.module && !modules.isEnabled(db, route.module)) throw httpError(404, 'Moduł jest wyłączony w tej szkole.', { code: 'module_disabled', module: route.module });
        let body = null; if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method)) body = await readJsonBody(req, route);
        const setCookies = []; const ctx = { req, res, db, app, ip, body, query: u.query, params, user: null, session: null, util, publicConfig: app.publicConfig, setCookie: (c) => setCookies.push(c), audit: (e) => audit(db, Object.assign({ ip, userId: ctx.user ? ctx.user.id : null }, e)) };
        if (db.data.config && db.data.config.setup && !db.data.config.setup.done && !db.col('users').some((x) => x.role === 'admin') && !pathname.startsWith('/api/setup/') && pathname !== '/api/auth/policy' && pathname !== '/api/health' && pathname !== '/api/compliance/accessibility') throw httpError(503, 'Szkoła nie została jeszcze skonfigurowana. Uruchom kreator pierwszego uruchomienia.', { code: 'setup_required' });
        if (route.opts.rateLimit && !publicAllowed(ip)) throw httpError(429, 'Zbyt wiele żądań z tego adresu. Spróbuj ponownie za chwilę.', { code: 'rate_limited', limitPerMinute: PUBLIC_RATE });
        if (!route.opts.public) {
          const s = auth.resolveSession(db, req);
          if (!s) throw httpError(401, 'Wymagane logowanie.', { code: 'unauthenticated' });
          if (s.expired) throw httpError(401, 'Sesja wygasła po okresie bezczynności.', { code: 'session_expired' });
          ctx.user = s.user; ctx.session = s.session; logUserId = s.user.id;
          if (s.session.totpPending && !route.opts.allowPending) throw httpError(401, 'Wymagany kod 2FA.', { code: 'totp_required' });
          if (s.user.mustChangePassword && !route.opts.allowPending) throw httpError(403, 'Wymagana zmiana hasła.', { code: 'password_change_required' });
          if (!route.opts.noTouch) { s.session.lastActivity = util.now(); db.save(); }
          if (route.opts.roles && route.opts.roles.length) { const roles = route.opts.roles.flatMap((x) => (x === 'staff' ? auth.STAFF : x === 'gradeEditors' ? auth.GRADE_EDITORS : [x])); if (!roles.includes(s.user.role) && !(route.opts.roles.includes('homeroom') && s.user.homeroomOf)) throw httpError(403, 'Brak uprawnień do tej operacji.', { code: 'forbidden' }); }
        }
        const out = await auth.guarded(route, ctx);              // brute-force window on the credential routes
        if (!res.headersSent) { const h = {}; if (setCookies.length) h['Set-Cookie'] = setCookies; if (out && out.__raw) { const rh = Object.assign({ 'Content-Type': out.contentType || 'text/plain; charset=utf-8', 'Cache-Control': out.cacheControl || 'no-store' }, h); if (out.filename) rh['Content-Disposition'] = safeContentDisposition(out.filename, out.inline ? 'inline' : 'attachment'); else if (out.inline) rh['Content-Disposition'] = 'inline'; res.writeHead(out.status || 200, rh);
          /* Pakiet archiwalny roku waży dziesiątki megabajtów i leży na dysku (server/lib/blobs.js).
             `{ stream }` pozwala go wypuścić strumieniem, zamiast wciągać całość do pamięci
             jednego procesu, który obsługuje całą szkołę. Nagłówki — w tym Content-Disposition
             z `safeContentDisposition` — składają się tak samo jak dla `body`. */
          if (out.stream) { out.stream.on('error', (err) => { if (!opts.quiet) console.error(err); res.destroy(); }); res.on('close', () => out.stream.destroy && out.stream.destroy()); out.stream.pipe(res); }
          else res.end(out.body); } else sendJson(res, 200, out === undefined ? { ok: true } : out, h); }
      } else {
        if (req.method !== 'GET' && req.method !== 'HEAD') throw httpError(405, 'Metoda niedozwolona.');
        if (pathname === '/app/screens.js') { res.writeHead(200, { 'Content-Type': 'text/javascript; charset=utf-8', 'Cache-Control': 'no-cache' }); return res.end(screensJs()); }
        if (pathname === '/app/base.js') { res.writeHead(200, { 'Content-Type': 'text/javascript; charset=utf-8', 'Cache-Control': 'no-cache' }); return res.end(`window.EDMAT_BASE=${JSON.stringify(BASE)};`); }
        if (pathname === '/app/autoprint.js') { res.writeHead(200, { 'Content-Type': 'text/javascript; charset=utf-8', 'Cache-Control': 'public, max-age=3600' }); return res.end("if (location.search.indexOf('print=1') >= 0) window.addEventListener('load', function () { window.print(); });"); }
        const safe = path.normalize(pathname).replace(/^(\.\.[/\\])+/, ''); let file = path.join(PUBLIC, safe);
        if (!file.startsWith(PUBLIC)) throw httpError(403, 'Forbidden');
        /* Strony obok powłoki: katalog z własnym index.html (public/projekt/ — strona projektu budowana z ../landing)
           jest zwykłą stroną statyczną, nie ekranem dziennika — bez <base> i bez base.js, ze ścieżkami względnymi,
           więc działa też pod EDMAT_BASE_PATH; /projekt bez ukośnika dostaje 302 na /projekt/, żeby te ścieżki się
           zgadzały. Katalog bez własnego index.html i każda nieznana ścieżka trafiają jak dotąd do powłoki. Jedyny
           skrypt inline takiej strony (start SvelteKit) ma skrót w <meta http-equiv="Content-Security-Policy">;
           kopiujemy go do naszego nagłówka, bo przeglądarka stosuje część wspólną obu polityk. */
        const SHELL = path.join(PUBLIC, 'index.html');
        if (fs.existsSync(file) && fs.statSync(file).isDirectory()) {
          const own = path.join(file, 'index.html');
          if (path.resolve(file) !== path.resolve(PUBLIC) && fs.existsSync(own)) { if (!pathname.endsWith('/')) { res.writeHead(302, { Location: BASE + pathname + '/' }); return res.end(); } file = own; }
          else file = SHELL;
        } else if (!fs.existsSync(file)) file = SHELL;
        if (file === SHELL) { const html = fs.readFileSync(file, 'utf8').replace('<head>', `<head><base href="${BASE}/"><script src="app/base.js"></script>`); res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-cache' }); return res.end(html); }
        if (file.endsWith('.html')) { const hashes = [...new Set(fs.readFileSync(file, 'utf8').match(/'sha256-[A-Za-z0-9+/=]+'/g) || [])]; if (hashes.length) res.setHeader('Content-Security-Policy', contentSecurityPolicy().replace("script-src 'self'", "script-src 'self' " + hashes.join(' '))); }
        sendFile(res, file, pathname === '/sw.js' ? { 'Service-Worker-Allowed': BASE + '/' } : undefined);
      }
    } catch (e) {
      const status = e instanceof HttpError ? e.status : (Number.isInteger(e && e.status) && e.status >= 400 && e.status < 600) ? e.status : e instanceof SyntaxError ? 400 : 500;
      if (status === 500 && !opts.quiet) console.error(e);
      const extra = e.extra || {};
      logErrCode = extra.code || (status === 500 ? 'server_error' : 'http_' + status);
      sendJson(res, status, Object.assign({ error: status === 500 ? 'Błąd serwera.' : e.message }, extra));
    } finally {
      if (opts.log) console.log(`${util.now()} ${req.method} ${logPath || redactPath(pathname)} ${res.statusCode} ${Date.now() - started}ms user=${logUserId || '-'} req=${reqId}${logErrCode ? ' code=' + logErrCode : ''}`);
    }
  });
  app.server = server;
  /* Liveness/readiness for the container: public, no school data — only whether this process can serve requests. */
  app.router.get('/api/health', () => ({ status: (db.damaged || []).length ? 'degraded' : 'ok', damaged: (db.damaged || []).length, schemaVersion: app.migration.to, uptimeSec: Math.round(process.uptime()), at: util.now(),
    /* `demo` mówi stronie projektu (/projekt/), czy wolno jej zaproponować wejście bez hasła; to flaga instalacji, nie dane szkoły. */
    demo: process.env.EDMAT_DEMO === '1' || !!(db.data.config && db.data.config.demo && db.data.config.demo.enabled) }), { public: true });
  app.listen = (port) => new Promise((resolve) => server.listen(port, () => resolve(server.address().port)));
  app.close = () => new Promise((resolve) => { db.close(); server.close(() => resolve()); });
  /** Graceful stop: stop accepting connections, write the store, drop the data-dir lock. */
  app.shutdown = (why) => new Promise((resolve) => { if (app._stopping) return resolve(); app._stopping = true; if (!opts.quiet) console.log(`EdMat: zamykanie (${why || 'shutdown'})…`); server.close(() => { db.close(); resolve(); }); server.closeIdleConnections && server.closeIdleConnections(); setTimeout(() => { db.close(); resolve(); }, 10000).unref(); });
  return app;
}
module.exports = { createApp, reseed: (db) => loadSeeds(db, { util }) };
if (require.main === module) {
  const dataDir = process.env.EDMAT_DATA || path.join(__dirname, '..', 'data');
  const app = createApp({ dataFile: path.join(dataDir, 'school.json'), reseed: process.argv.includes('--reseed'), secureCookies: process.env.EDMAT_SECURE_COOKIES === '1', log: process.env.EDMAT_LOG === '1' });
  if (process.argv.includes('--exit')) { console.log('Seed zapisany:', path.join(dataDir, 'school')); process.exit(0); }
  app.listen(+process.env.PORT || 3000).then((port) => console.log(`EdMat · ${app.db.data.config.school.name} · http://localhost:${port}`));
  for (const sig of ['SIGTERM', 'SIGINT']) process.on(sig, () => { app.shutdown(sig).then(() => process.exit(0)); });
}
