'use strict';
const { httpError } = require('./lib/router');
const C = require('./lib/crypto'); const { now, id, minutesBetween } = require('./lib/util'); const { audit } = require('./lib/audit');
const STAFF = ['teacher', 'principal', 'counselor', 'psychologist', 'specialEducator', 'speechTherapist', 'supportTeacher', 'registrar', 'admin', 'careEducator', 'cafeteria', 'librarian', 'nurse', 'dpo'];
const GRADE_EDITORS = ['teacher', 'principal', 'supportTeacher'];
function publicUser(u) { if (!u) return null; const { passwordHash, totpSecret, totpPendingSecret, privateKey, ...rest } = u; return rest; }
function ipOf(req) { return (req.headers['x-forwarded-for'] || '').split(',')[0].trim() || (req.socket && req.socket.remoteAddress) || ''; }
function ipAllowed(ip, list) { if (!list || !list.length) return true; const norm = ip.replace(/^::ffff:/, ''); return list.some((rule) => { if (rule.includes('/')) { const [net, bits] = rule.split('/'); const toN = (a) => a.split('.').reduce((s, o) => (s << 8) + (+o), 0) >>> 0; const mask = bits === '0' ? 0 : (~0 << (32 - +bits)) >>> 0; return (toN(norm) & mask) === (toN(net) & mask); } return rule === norm || (norm === '127.0.0.1' && rule === 'localhost') || norm === '::1' && rule === 'localhost'; }); }
/** Resolve session; enforce inactivity timeout (config.sessionTimeoutMin) and revocation. */
function resolveSession(db, req) {
  const cookies = require('./lib/router').parseCookies(req.headers.cookie); const sid = cookies.edmat_sid; if (!sid) return null;
  const s = db.one('sessions', (x) => x.token === sid && !x.revoked); if (!s) return null;
  const limit = (db.data.config.sessionTimeoutMin || 15);
  if (minutesBetween(s.lastActivity, now()) >= limit) { s.revoked = true; s.revokedReason = 'timeout'; s.revokedAt = now(); db.save(); return { expired: true }; }
  const u = db.get('users', s.userId); if (!u || u.blocked) { s.revoked = true; s.revokedReason = 'blocked'; db.save(); return null; }
  return { session: s, user: u };
}
const otpauthFor = (u, secret) => `otpauth://totp/EdMat:${u.login}?secret=${secret}&issuer=EdMat`;
function cookieHeader(token, secure, maxAgeSec) { return `edmat_sid=${token}; Path=/; HttpOnly; SameSite=Strict${secure ? '; Secure' : ''}${maxAgeSec != null ? '; Max-Age=' + maxAgeSec : ''}`; }

/* =======================================================================================
   Brute-force protection for the credential endpoints.
   In-memory sliding window, two keys per attempt: (bucket, IP, login) and (bucket, IP).
   Only failures count; a success clears the window, so normal use never trips it.
   Single-node prototype ⇒ single-process Map is enough; behind more than one node this
   has to move to the shared store.
   ======================================================================================= */
const MAX_KEYS = 20000;
const attempts = new Map();                                   // key → { hits: [ms], lockedUntil, audited }
/* `limit` is the window for one (IP, subject) pair, `ipLimit` the window for the address as a
   whole. For a login the subject is the account under attack, so the address may hold several
   of them before it is cut off; for a registration code or an SSO token the *subject is the
   secret being guessed*, so the address-wide window has to be the tight one. */
const BUCKETS = {
  'POST /api/auth/login': { name: 'login', limit: 10, ipLimit: 50, windowMs: 15 * 60000, lockMs: 15 * 60000 },
  'POST /api/auth/totp': { name: 'totp', limit: 5, ipLimit: 25, windowMs: 10 * 60000, lockMs: 15 * 60000 },
  'POST /api/register': { name: 'register', limit: 10, ipLimit: 10, windowMs: 60 * 60000, lockMs: 30 * 60000 },
  'GET /api/auth/sso': { name: 'sso', limit: 10, ipLimit: 10, windowMs: 15 * 60000, lockMs: 15 * 60000 },
};
/** The identifier the window is scoped to next to the IP (login, registration code, account). */
function subjectOf(bucket, ctx) {
  const b = ctx.body && typeof ctx.body === 'object' && !Array.isArray(ctx.body) ? ctx.body : {};
  if (bucket.name === 'login') return String(b.login == null ? '' : b.login).toLowerCase().slice(0, 64);
  if (bucket.name === 'totp') return ctx.user ? ctx.user.id : '';
  if (bucket.name === 'register') return String(b.code == null ? '' : b.code).toUpperCase().slice(0, 64);
  return '';
}
function keysFor(bucket, ctx) {
  const ip = String(ctx.ip || '').slice(0, 64);
  const subject = subjectOf(bucket, ctx);
  const keys = [`${bucket.name}|${ip}|`];                     // per IP, whatever login is tried
  if (subject) keys.unshift(`${bucket.name}|${ip}|${subject}`);
  return keys;
}
function entryOf(key) { let e = attempts.get(key); if (!e) { if (attempts.size >= MAX_KEYS) pruneAttempts(true); e = { hits: [], lockedUntil: 0, audited: false }; attempts.set(key, e); } return e; }
function pruneAttempts(force) {
  const t = Date.now();
  for (const [k, e] of attempts) { const last = e.hits.length ? e.hits[e.hits.length - 1] : 0; if (e.lockedUntil < t && t - last > 60 * 60000) attempts.delete(k); }
  if (force && attempts.size >= MAX_KEYS) attempts.clear();
}
const lockMinutes = (until) => Math.max(1, Math.ceil((until - Date.now()) / 60000));
/** Throws 429 while the caller is locked out; the message is the one the user sees. */
function assertNotLocked(bucket, ctx) {
  const t = Date.now();
  for (const key of keysFor(bucket, ctx)) {
    const e = attempts.get(key);
    if (e && e.lockedUntil > t) {
      const mins = lockMinutes(e.lockedUntil);
      throw httpError(429, `Zbyt wiele nieudanych prób. Ze względów bezpieczeństwa dostęp z tego adresu został tymczasowo zablokowany — spróbuj ponownie za ${mins} ${mins === 1 ? 'minutę' : mins < 5 ? 'minuty' : 'minut'}.`,
        { code: 'rate_limited', retryAfterSeconds: Math.ceil((e.lockedUntil - t) / 1000) });
    }
  }
}
/** Records one failed attempt; locks the window out (and audits it once) when the limit is hit. */
function noteFailure(bucket, ctx) {
  const t = Date.now();
  const keys = keysFor(bucket, ctx);
  keys.forEach((key, i) => {
    const e = entryOf(key);
    const perSubject = keys.length > 1 && i === 0;
    const limit = perSubject ? bucket.limit : (bucket.ipLimit || bucket.limit);
    e.hits = e.hits.filter((x) => t - x < bucket.windowMs); e.hits.push(t);
    if (e.hits.length >= limit && e.lockedUntil <= t) {
      e.lockedUntil = t + bucket.lockMs;
      if (!e.audited) {
        e.audited = true;
        audit(ctx.db, { action: 'login_rate_limited', userId: ctx.user ? ctx.user.id : null, ip: ctx.ip, entity: 'session', note: `${bucket.name}:${subjectOf(bucket, ctx) || '(dowolne konto)'}`, after: { attempts: e.hits.length, lockedForMinutes: Math.round(bucket.lockMs / 60000) }, reason: 'Przekroczono limit nieudanych prób uwierzytelnienia' });
      }
    }
  });
  if (attempts.size > MAX_KEYS / 2) pruneAttempts(false);
}
function clearFailures(bucket, ctx) { for (const key of keysFor(bucket, ctx)) { const e = attempts.get(key); if (e && e.lockedUntil <= Date.now()) attempts.delete(key); } }
/** Wraps a route handler with the brute-force window when the route is a credential endpoint. */
async function guarded(route, ctx) {
  const bucket = BUCKETS[route.method + ' ' + route.pattern];
  if (!bucket) return route.handler(ctx);
  assertNotLocked(bucket, ctx);
  try { const out = await route.handler(ctx); clearFailures(bucket, ctx); return out; }
  catch (e) { const s = e && e.status; if (s === 400 || s === 401 || s === 403) noteFailure(bucket, ctx); throw e; }
}
/** Test/ops hook: forget every recorded attempt. */
function resetRateLimits() { attempts.clear(); }

/* ---- session hygiene ------------------------------------------------------------------ */
const MAX_SESSIONS_PER_USER = 30;
/** Revokes every live session of a user except `keepToken`; returns how many were revoked. */
function revokeOtherSessions(db, userId, keepToken, reason) {
  let n = 0;
  for (const s of db.col('sessions')) {
    if (s.userId !== userId || s.revoked || (keepToken && s.token === keepToken)) continue;
    s.revoked = true; s.revokedReason = reason || 'rotated'; s.revokedAt = now(); n++;
  }
  if (n) db.save();
  return n;
}
/** Keeps the number of live sessions per account bounded; oldest first. */
function capSessions(db, userId, keepToken) {
  const cap = db.data.config.maxSessionsPerUser || MAX_SESSIONS_PER_USER;
  const live = db.col('sessions').filter((s) => s.userId === userId && !s.revoked).sort((a, b) => (a.createdAt < b.createdAt ? -1 : 1));
  let n = 0;
  for (const s of live.slice(0, Math.max(0, live.length - cap))) { if (keepToken && s.token === keepToken) continue; s.revoked = true; s.revokedReason = 'session_cap'; s.revokedAt = now(); n++; }
  if (n) db.save();
  return n;
}
function register(r, app) {
  const secure = () => !!app.options.secureCookies;
  r.post('/api/auth/login', async (ctx) => {
    const b = ctx.body && typeof ctx.body === 'object' && !Array.isArray(ctx.body) ? ctx.body : {};
    const { login, client } = b;
    /* The password always goes to scrypt as a string: a JSON object or array here used to throw a 500. */
    const password = typeof b.password === 'string' ? b.password : '';
    const u = typeof login === 'string' && login ? ctx.db.one('users', (x) => x.login === login) : null;
    const fail = () => { audit(ctx.db, { action: 'login_failed', userId: u ? u.id : null, ip: ctx.ip, entity: 'session', note: typeof login === 'string' ? login.slice(0, 64) : null }); throw httpError(401, 'Nieprawidłowy login lub hasło.'); };
    if (!u || !C.verifyPassword(password, u.passwordHash)) fail();
    if (u.blocked) throw httpError(403, 'Konto zablokowane. Skontaktuj się z administracją.');
    if (u.role === 'admin' && !ipAllowed(ctx.ip, ctx.db.data.config.ipAllowlist)) { audit(ctx.db, { action: 'login_denied_ip', userId: u.id, ip: ctx.ip, entity: 'session' }); throw httpError(403, 'Logowanie administracyjne z tego adresu IP jest niedozwolone.'); }
    /* Session fixation: a session id the caller brought with them never survives a login —
       the browser always leaves with a freshly minted token. */
    const presented = require('./lib/router').parseCookies(ctx.req && ctx.req.headers ? ctx.req.headers.cookie : '').edmat_sid;
    if (presented) { const old = ctx.db.one('sessions', (x) => x.token === presented && !x.revoked); if (old) { old.revoked = true; old.revokedReason = 'reauth'; old.revokedAt = now(); ctx.db.save(); } }
    const s = { id: id('ses'), token: C.token(), userId: u.id, createdAt: now(), lastActivity: now(), ip: ctx.ip, client: client || 'web', totpPending: !!(u.totpEnabled), revoked: false };
    ctx.db.col('sessions').push(s); u.lastLogin = now(); u.loginCount = (u.loginCount || 0) + 1; ctx.db.save();
    capSessions(ctx.db, u.id, s.token);
    audit(ctx.db, { action: 'login', userId: u.id, ip: ctx.ip, entity: 'session', entityId: s.id, client: s.client });
    ctx.setCookie(cookieHeader(s.token, secure(), 60 * 60 * 12));
    return { user: publicUser(u), totpRequired: s.totpPending, mustChangePassword: !!u.mustChangePassword, sessionTimeoutMin: ctx.db.data.config.sessionTimeoutMin || 15 };
  }, { public: true });
  r.post('/api/auth/totp', (ctx) => {
    const { code } = (ctx.body && typeof ctx.body === 'object' ? ctx.body : {}); const u = ctx.user; if (!ctx.session.totpPending) return { ok: true };
    if (!C.totpVerify(u.totpSecret, code)) { audit(ctx.db, { action: 'totp_failed', userId: u.id, ip: ctx.ip, entity: 'session' }); throw httpError(401, 'Nieprawidłowy kod 2FA.'); }
    /* Second factor cleared = a privilege change, so the session token is rotated here too. */
    ctx.session.totpPending = false; ctx.session.token = C.token(); ctx.session.totpAt = now(); ctx.db.save();
    ctx.setCookie(cookieHeader(ctx.session.token, secure(), 60 * 60 * 12));
    audit(ctx.db, { action: 'totp_verified', userId: u.id, ip: ctx.ip, entity: 'session', entityId: ctx.session.id });
    return { ok: true, user: publicUser(u) };
  }, { allowPending: true });
  r.post('/api/auth/logout', (ctx) => { ctx.session.revoked = true; ctx.session.revokedReason = 'logout'; ctx.db.save(); ctx.setCookie(cookieHeader('', secure(), 0)); audit(ctx.db, { action: 'logout', userId: ctx.user.id, ip: ctx.ip, entity: 'session' }); return { ok: true }; }, { allowPending: true });
  r.get('/api/auth/session', (ctx) => { const limit = ctx.db.data.config.sessionTimeoutMin || 15; const remaining = Math.max(0, limit * 60 - Math.round((Date.now() - new Date(ctx.session.lastActivity)) / 1000)); const out = { user: publicUser(ctx.user), remainingSeconds: remaining, totpRequired: !!ctx.session.totpPending, mustChangePassword: !!ctx.user.mustChangePassword, config: ctx.publicConfig() }; for (const fn of app.sessionExtras || []) Object.assign(out, fn(ctx) || {}); return out; }, { allowPending: true, noTouch: true });
  /* Dev-only login shortcut for headless screenshots and manual QA: GET /api/dev/login?as=j.nowak (EDMAT_DEV=1). Never enabled in production. */
  if (process.env.EDMAT_DEV === '1') r.get('/api/dev/login', (ctx) => { const u = ctx.db.one('users', (x) => x.login === ctx.query.as); if (!u) throw httpError(404, 'Nie ma takiego użytkownika.'); const s = { id: id('ses'), token: C.token(), userId: u.id, createdAt: now(), lastActivity: now(), ip: ctx.ip, client: 'web', totpPending: false, revoked: false }; ctx.db.col('sessions').push(s); ctx.db.save(); ctx.res.writeHead(302, { 'Set-Cookie': cookieHeader(s.token, secure(), 3600), Location: (app.basePath || '') + '/' + (ctx.query.to ? '#' + ctx.query.to : '') }); ctx.res.end(); }, { public: true });
  r.post('/api/auth/touch', (ctx) => { ctx.session.lastActivity = now(); ctx.db.save(); return { ok: true }; }, { allowPending: true });
  r.post('/api/auth/password', (ctx) => {
    const b = ctx.body && typeof ctx.body === 'object' && !Array.isArray(ctx.body) ? ctx.body : {};
    const next = b.next; const current = typeof b.current === 'string' ? b.current : '';
    const u = ctx.user;
    if (!u.mustChangePassword && !C.verifyPassword(current, u.passwordHash)) throw httpError(400, 'Obecne hasło jest nieprawidłowe.');
    if (typeof next !== 'string') throw httpError(400, 'Podaj nowe hasło.', { code: 'no_password' });
    const pol = C.checkPasswordPolicy(next); if (!pol.ok) throw httpError(400, 'Hasło nie spełnia polityki: ' + pol.missing.join(', ') + '.', { missing: pol.missing });
    u.passwordHash = C.hashPassword(next); u.mustChangePassword = false; u.passwordChangedAt = now(); ctx.db.save();
    /* Changing the password logs the account out everywhere else — the whole point of changing it
       is usually that someone else may hold the old one (or a live session opened with it). */
    const revoked = revokeOtherSessions(ctx.db, u.id, ctx.session.token, 'password_changed');
    audit(ctx.db, { action: 'password_changed', userId: u.id, ip: ctx.ip, entity: 'user', entityId: u.id, after: { revokedSessions: revoked } });
    return { ok: true, revokedSessions: revoked, message: revoked ? `Hasło zmienione. Wylogowano pozostałe sesje tego konta (${revoked}).` : 'Hasło zmienione.' };
  }, { allowPending: true });
  /* S-11: na koncie z włączonym 2FA ta trasa wydawała sekret każdemu, kto trzymał sesję — przejęta
     sesja zamieniała się w trwały drugi składnik. Powiązanie nowej aplikacji wymaga teraz hasła,
     zostawia wiersz w rejestrze i wydaje świeży sekret; stary działa do potwierdzenia kodem. */
  r.post('/api/auth/totp/setup', (ctx) => {
    const u = ctx.user;
    if (!u.totpEnabled) { u.totpSecret = u.totpSecret || C.totpSecret(); ctx.db.save(); return { secret: u.totpSecret, otpauth: otpauthFor(u, u.totpSecret) }; }
    const b = ctx.body && typeof ctx.body === 'object' && !Array.isArray(ctx.body) ? ctx.body : {};
    const password = typeof b.password === 'string' ? b.password : '';
    if (!C.verifyPassword(password, u.passwordHash)) {
      audit(ctx.db, { action: 'totp_setup_denied', userId: u.id, ip: ctx.ip, entity: 'user', entityId: u.id, reason: 'Powiązanie nowej aplikacji 2FA bez potwierdzenia hasłem' });
      throw httpError(401, 'Potwierdź hasłem, zanim powiążesz nową aplikację uwierzytelniającą.', { code: 'reauth_required' });
    }
    u.totpPendingSecret = C.totpSecret(); ctx.db.save();
    audit(ctx.db, { action: 'totp_secret_issued', userId: u.id, ip: ctx.ip, entity: 'user', entityId: u.id, reason: 'Powiązanie nowej aplikacji uwierzytelniającej po potwierdzeniu hasłem' });
    return { secret: u.totpPendingSecret, otpauth: otpauthFor(u, u.totpPendingSecret), rebinding: true };
  });
  r.post('/api/auth/totp/enable', (ctx) => {
    const u = ctx.user; const code = (ctx.body || {}).code;
    /* Sekret wydany przy powiązaniu nowej aplikacji wchodzi w życie dopiero, gdy ta aplikacja poda kod —
       inaczej samo otwarcie ekranu odcinałoby użytkownika od jego działającego uwierzytelniacza. */
    if (u.totpPendingSecret && C.totpVerify(u.totpPendingSecret, code)) { u.totpSecret = u.totpPendingSecret; u.totpPendingSecret = null; }
    else if (!u.totpSecret || !C.totpVerify(u.totpSecret, code)) throw httpError(400, 'Kod z aplikacji nie zgadza się.');
    u.totpEnabled = true; ctx.db.save();
    audit(ctx.db, { action: 'totp_enabled', userId: u.id, ip: ctx.ip, entity: 'user', entityId: u.id });
    return { ok: true };
  });
  r.get('/api/auth/policy', () => ({ password: C.PASSWORD_POLICY }), { public: true });
  r.post('/api/auth/locale', (ctx) => { const l = (ctx.body || {}).locale === 'en' ? 'en' : 'pl'; ctx.user.locale = l; ctx.db.save(); return { locale: l }; }, { allowPending: true });
  /* SSO hand-off from a host platform: GET /api/auth/sso?token=<b64url(payload)>.<b64url(hmac-sha256)>; payload {login|email, exp (unix s), nonce, locale?, to?}. Secret: EDMAT_SSO_SECRET (or config.sso.secret). */
  r.get('/api/auth/sso', (ctx) => {
    const secret = process.env.EDMAT_SSO_SECRET || (ctx.db.data.config.sso && ctx.db.data.config.sso.secret); if (!secret) throw httpError(404, 'SSO nie jest skonfigurowane.', { code: 'sso_disabled' });
    const tok = String(ctx.query.token || ''); const [p, sig] = tok.split('.'); if (!p || !sig) throw httpError(400, 'Nieprawidłowy token SSO.', { code: 'sso_bad_token' });
    const expected = require('node:crypto').createHmac('sha256', secret).update(p).digest('base64url'); if (sig.length !== expected.length || !require('node:crypto').timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) { audit(ctx.db, { action: 'sso_failed', ip: ctx.ip, entity: 'session' }); throw httpError(401, 'Podpis tokenu SSO jest nieprawidłowy.', { code: 'sso_bad_signature' }); }
    let payload; try { payload = JSON.parse(Buffer.from(p, 'base64url').toString('utf8')); } catch (e) { throw httpError(400, 'Nieprawidłowy token SSO.', { code: 'sso_bad_token' }); }
    if (!payload.exp || payload.exp * 1000 < Date.now()) throw httpError(401, 'Token SSO wygasł.', { code: 'sso_expired' });
    const used = ctx.db.col('ssoNonces'); if (payload.nonce && used.includes(payload.nonce)) throw httpError(401, 'Token SSO został już użyty.', { code: 'sso_replay' }); if (payload.nonce) { used.push(payload.nonce); if (used.length > 5000) used.splice(0, 1000); }
    const u = ctx.db.one('users', (x) => x.login === payload.login || (payload.email && x.email === payload.email)); if (!u || u.blocked) throw httpError(403, 'Brak konta EdMat dla tego użytkownika.', { code: 'sso_no_account' });
    if (u.role === 'admin' && !ipAllowed(ctx.ip, ctx.db.data.config.ipAllowlist)) throw httpError(403, 'Logowanie administracyjne z tego adresu IP jest niedozwolone.');
    if (payload.locale === 'en' || payload.locale === 'pl') u.locale = payload.locale;
    const s = { id: id('ses'), token: C.token(), userId: u.id, createdAt: now(), lastActivity: now(), ip: ctx.ip, client: 'sso', totpPending: !!u.totpEnabled, revoked: false, via: 'sso' }; ctx.db.col('sessions').push(s); u.lastLogin = now(); u.loginCount = (u.loginCount || 0) + 1; ctx.db.save();
    audit(ctx.db, { action: 'login', userId: u.id, ip: ctx.ip, entity: 'session', entityId: s.id, client: 'sso' });
    const to = typeof payload.to === 'string' && /^\/[a-z0-9/?=&_-]*$/i.test(payload.to) ? payload.to : '';
    ctx.res.writeHead(302, { 'Set-Cookie': cookieHeader(s.token, secure(), 60 * 60 * 12), Location: (app.basePath || '') + '/' + (to ? '#' + to : '') }); ctx.res.end();
  }, { public: true });
  /** Helper for tests and host platforms: mint an SSO token. */
  app.ssoToken = (payload, secret) => { const p = Buffer.from(JSON.stringify(payload)).toString('base64url'); return p + '.' + require('node:crypto').createHmac('sha256', secret).update(p).digest('base64url'); };
}
module.exports = { register, resolveSession, publicUser, ipOf, ipAllowed, STAFF, GRADE_EDITORS, cookieHeader, guarded, resetRateLimits, revokeOtherSessions, capSessions, BUCKETS, MAX_SESSIONS_PER_USER };
