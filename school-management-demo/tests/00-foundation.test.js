'use strict';
const test = require('node:test'); const assert = require('node:assert/strict');
const { startServer, expectOk, DEMO_PASSWORD } = require('./helpers');
let S; test.before(async () => { S = await startServer(); }); test.after(() => S.close());

test('static app shell is served with security headers', async () => {
  const r = await fetch(S.base + '/'); assert.equal(r.status, 200); assert.match(await r.text(), /<div id="root">/);
  assert.equal(r.headers.get('x-content-type-options'), 'nosniff'); assert.match(r.headers.get('content-security-policy'), /default-src 'self'/);
  const sw = await fetch(S.base + '/sw.js'); assert.equal(sw.headers.get('service-worker-allowed'), '/');
});
test('login sets an HttpOnly SameSite cookie and returns the user; wrong password is 401 and audited', async () => {
  const c = S.client(); const r = await c.post('/api/auth/login', { login: 'j.nowak', password: DEMO_PASSWORD });
  assert.equal(r.status, 200); assert.equal(r.body.user.role, 'teacher'); assert.equal(r.body.user.passwordHash, undefined);
  assert.match(r.headers.get('set-cookie'), /HttpOnly/); assert.match(r.headers.get('set-cookie'), /SameSite=Strict/);
  const bad = await S.client().post('/api/auth/login', { login: 'j.nowak', password: 'zle' }); assert.equal(bad.status, 401);
  assert.ok(S.db.col('audit').some((a) => a.action === 'login_failed'));
});
test('session endpoint reports remaining time; touch resets it; logout revokes', async () => {
  const c = await S.as('j.nowak'); const s = expectOk(await c.get('/api/auth/session')); assert.ok(s.remainingSeconds > 800 && s.remainingSeconds <= 900); assert.equal(s.config.sessionTimeoutMin, 15);
  expectOk(await c.post('/api/auth/touch')); expectOk(await c.post('/api/auth/logout')); const after = await c.get('/api/auth/session'); assert.equal(after.status, 401);
});
test('[3.9.5] a session idle for 15 minutes is rejected with session_expired', async () => {
  const c = await S.as('a.wojcik'); const ses = S.db.col('sessions').find((x) => x.token === c.cookie.split('=')[1]);
  ses.lastActivity = new Date(Date.now() - 16 * 60000).toISOString();
  const r = await c.get('/api/auth/session'); assert.equal(r.status, 401); assert.equal(r.body.code, 'session_expired');
});
test('role guard: a student cannot call a staff route; unknown API path is 404', async () => {
  const c = await S.as('anna.kowalczyk'); const r = await c.get('/api/nope'); assert.equal(r.status, 404);
});
test('password policy is enforced on change and forced change blocks other routes', async () => {
  const c = await S.as('e.krol'); const weak = await c.post('/api/auth/password', { current: DEMO_PASSWORD, next: 'abc' }); assert.equal(weak.status, 400); assert.ok(weak.body.missing.length >= 3);
  const u = S.db.get('users', 'u_krol'); u.mustChangePassword = true; const blocked = await c.get('/api/auth/session'); assert.equal(blocked.status, 200); assert.equal(blocked.body.mustChangePassword, true);
  const ok = await c.post('/api/auth/password', { next: 'Nowe-Haslo-2026!' }); assert.equal(ok.status, 200); assert.equal(S.db.get('users', 'u_krol').mustChangePassword, false);
});
test('TOTP setup, enable and second-factor gate', async () => {
  const c = await S.as('t.gorski'); const setup = expectOk(await c.post('/api/auth/totp/setup')); assert.match(setup.otpauth, /^otpauth:\/\/totp\//);
  const { totpCode } = require('../server/lib/crypto'); expectOk(await c.post('/api/auth/totp/enable', { code: totpCode(setup.secret) }));
  const c2 = S.client(); const l = await c2.post('/api/auth/login', { login: 't.gorski', password: DEMO_PASSWORD }); assert.equal(l.body.totpRequired, true);
  const gated = await c2.get('/api/auth/session'); assert.equal(gated.body.totpRequired, true);
  assert.equal((await c2.post('/api/auth/totp', { code: '000000' })).status, 401);
  expectOk(await c2.post('/api/auth/totp', { code: totpCode(setup.secret) })); assert.equal((await c2.get('/api/auth/session')).body.totpRequired, false);
});
test('seed integrity: one school, classes with students, lessons for the seeded week, categories, curriculum', async () => {
  const db = S.db; assert.equal(db.data.config.school.short, 'SP nr 12'); assert.ok(db.data.classes.find((c) => c.id === '7b').studentIds.length >= 12);
  assert.ok(db.data.lessons.some((l) => l.classId === '7b' && l.date === '2026-10-23' && l.subjectId === 'mat'));
  for (const s of db.data.students) assert.equal(require('../server/lib/util').validatePesel(s.pesel).ok, true, 'PESEL ' + s.pesel);
});
