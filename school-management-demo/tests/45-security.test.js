'use strict';
/* Regression tests for the security review in docs/review/security.md.
   Every test here failed against the code as it stood before that review. */
const test = require('node:test'); const assert = require('node:assert/strict');
const fs = require('node:fs'); const path = require('node:path');
const { startServer, expectOk, DEMO_PASSWORD } = require('./helpers');
const auth = require('../server/auth');
const { totpCode } = require('../server/lib/crypto');

let S;
test.before(async () => { S = await startServer(); });
test.after(() => S.close());
/* The brute-force window is process-wide, so each test starts from a clean slate and uses
   its own client IP (X-Forwarded-For reaches auth.ipOf) to stay independent of the others. */
test.beforeEach(() => auth.resetRateLimits());
const from = (ip) => ({ 'X-Forwarded-For': ip });
const audits = (pred) => S.db.col('audit').filter(pred);

/* ================================================================= S-01 brute force ==== */

test('[sec.1] repeated wrong passwords lock the login out with a Polish 429 and an audit row', async () => {
  const c = S.client(); const ip = '198.51.100.11';
  for (let i = 0; i < 10; i++) {
    const r = await c.post('/api/auth/login', { login: 'j.nowak', password: 'zle' + i }, from(ip));
    assert.equal(r.status, 401, 'attempt ' + i + ' should still be a plain 401');
  }
  const locked = await c.post('/api/auth/login', { login: 'j.nowak', password: 'zle' }, from(ip));
  assert.equal(locked.status, 429);
  assert.equal(locked.body.code, 'rate_limited');
  assert.match(locked.body.error, /Zbyt wiele nieudanych prób/);
  assert.match(locked.body.error, /spróbuj ponownie za \d+ minut/);
  assert.ok(locked.body.retryAfterSeconds > 0);
  /* the correct password is refused too while the window is locked — that is the point */
  const rightButLocked = await c.post('/api/auth/login', { login: 'j.nowak', password: DEMO_PASSWORD }, from(ip));
  assert.equal(rightButLocked.status, 429);
  const a = audits((x) => x.action === 'login_rate_limited' && x.ip === ip);
  assert.equal(a.length, 1, 'the lockout is audited exactly once, not once per rejected attempt');
  assert.match(a[0].note, /login:j\.nowak/);
  assert.match(a[0].reason, /limit nieudanych prób/);
});

test('[sec.1b] the window is per IP + login: another address and another account still get in', async () => {
  const c = S.client();
  for (let i = 0; i < 10; i++) await c.post('/api/auth/login', { login: 'e.krol', password: 'zle' + i }, from('198.51.100.12'));
  assert.equal((await c.post('/api/auth/login', { login: 'e.krol', password: DEMO_PASSWORD }, from('198.51.100.12'))).status, 429);
  const other = await S.client().post('/api/auth/login', { login: 'e.krol', password: DEMO_PASSWORD }, from('198.51.100.13'));
  assert.equal(other.status, 200, 'a different address is not punished for someone else’s attempts');
  const otherAccount = await S.client().post('/api/auth/login', { login: 'a.wojcik', password: DEMO_PASSWORD }, from('198.51.100.12'));
  assert.equal(otherAccount.status, 200, 'a different account from the same address still works');
});

test('[sec.1c] a successful login clears the window, so ordinary typos never lock anyone out', async () => {
  const c = S.client(); const ip = '198.51.100.14';
  for (let i = 0; i < 9; i++) assert.equal((await c.post('/api/auth/login', { login: 'k.lis', password: 'zle' + i }, from(ip))).status, 401);
  assert.equal((await c.post('/api/auth/login', { login: 'k.lis', password: DEMO_PASSWORD }, from(ip))).status, 200);
  for (let i = 0; i < 9; i++) assert.equal((await c.post('/api/auth/login', { login: 'k.lis', password: 'znowu' + i }, from(ip))).status, 401);
});

test('[sec.2] the second factor is rate limited too — a 6-digit code is not brute-forceable', async () => {
  const u = S.db.one('users', (x) => x.login === 't.gorski');
  u.totpSecret = u.totpSecret || require('../server/lib/crypto').totpSecret(); u.totpEnabled = true; S.db.save();
  const ip = '198.51.100.21';
  const c = S.client();
  assert.equal((await c.post('/api/auth/login', { login: 't.gorski', password: DEMO_PASSWORD }, from(ip))).body.totpRequired, true);
  for (let i = 0; i < 5; i++) assert.equal((await c.post('/api/auth/totp', { code: '00000' + i }, from(ip))).status, 401);
  const locked = await c.post('/api/auth/totp', { code: '123456' }, from(ip));
  assert.equal(locked.status, 429); assert.equal(locked.body.code, 'rate_limited');
  assert.ok(audits((x) => x.action === 'login_rate_limited' && x.note.startsWith('totp:')).length >= 1);
  /* after the window is reset the genuine code still works and rotates the session token */
  auth.resetRateLimits();
  const before = c.cookie;
  expectOk(await c.post('/api/auth/totp', { code: totpCode(u.totpSecret) }, from(ip)));
  assert.notEqual(c.cookie, before, 'clearing the second factor rotates the session token');
  assert.equal((await c.get('/api/auth/session', from(ip))).body.totpRequired, false);
});

test('[sec.3] registration codes cannot be guessed in bulk', async () => {
  const c = S.client(); const ip = '198.51.100.31';
  for (let i = 0; i < 10; i++) assert.equal((await c.post('/api/register', { code: 'AAAA-BBB' + i, login: 'x', firstName: 'a', lastName: 'b', password: 'x' }, from(ip))).status, 400);
  const locked = await c.post('/api/register', { code: 'AAAA-CCCC', login: 'x', firstName: 'a', lastName: 'b', password: 'x' }, from(ip));
  assert.equal(locked.status, 429); assert.match(locked.body.error, /Zbyt wiele nieudanych prób/);
});

test('[sec.4] SSO tokens cannot be brute-forced either', async () => {
  S.db.data.config.sso = { secret: 'sekret-sso-do-testu' }; S.db.save();
  const c = S.client(); const ip = '198.51.100.41';
  for (let i = 0; i < 10; i++) assert.equal((await c.get('/api/auth/sso?token=eyJ4IjoxfQ.AAAA' + i, from(ip))).status, 401);
  assert.equal((await c.get('/api/auth/sso?token=eyJ4IjoxfQ.ZZZZ', from(ip))).status, 429);
  delete S.db.data.config.sso;
});

/* ============================================================= S-06 / S-12 request body ==== */

test('[sec.5] a state-changing API call is refused unless it is really JSON (415)', async () => {
  const c = await S.as('j.nowak');
  for (const ct of ['text/plain', 'application/x-www-form-urlencoded', 'multipart/form-data; boundary=x', 'text/html']) {
    const r = await c.call('POST', '/api/auth/touch', 'login=x&password=y', { 'Content-Type': ct });
    assert.equal(r.status, 415, ct + ' must not be accepted');
    assert.equal(r.body.code, 'unsupported_media_type');
  }
  /* the same request as a cross-site form would send it must not change preferences either */
  const before = JSON.stringify(S.db.get('users', 'u_nowak').preferences || null);
  const forged = await c.call('PATCH', '/api/me/preferences', '{"theme":"dark"}', { 'Content-Type': 'text/plain' });
  assert.equal(forged.status, 415);
  assert.equal(JSON.stringify(S.db.get('users', 'u_nowak').preferences || null), before);
  /* proper JSON is unaffected */
  expectOk(await c.patch('/api/me/preferences', { theme: 'dark' }));
  assert.equal(S.db.get('users', 'u_nowak').preferences.theme, 'dark');
  /* a body that claims JSON but is not gets a 400, never a 500 */
  const broken = await c.call('POST', '/api/auth/touch', '{not json', { 'Content-Type': 'application/json' });
  assert.equal(broken.status, 400); assert.equal(broken.body.code, 'bad_json');
});

test('[sec.6] request bodies are capped per route type', async () => {
  const { bodyLimitFor, BODY_LIMITS } = require('../server/lib/router');
  assert.equal(bodyLimitFor({ pattern: '/api/feedback', opts: {} }), BODY_LIMITS.json);
  assert.equal(bodyLimitFor({ pattern: '/api/homework/:id/submissions', opts: {} }), BODY_LIMITS.upload);
  assert.equal(bodyLimitFor({ pattern: '/api/materials', opts: {} }), BODY_LIMITS.upload);
  assert.ok(BODY_LIMITS.json < BODY_LIMITS.upload);
  const c = await S.as('admin');
  /* an oversized body on an ordinary JSON route is rejected (413, or the socket is torn down) */
  let status = 0;
  try { status = (await c.post('/api/feedback', { body: 'x'.repeat(BODY_LIMITS.json + 50000) })).status; }
  catch (e) { status = 413; }
  assert.equal(status, 413);
  /* the attachment routes keep their headroom */
  const teacher = await S.as('j.nowak');
  const lesson = S.db.col('lessons').find((l) => l.teacherId === 'u_nowak');
  const big = await teacher.post('/api/materials', { lessonId: lesson.id, name: 'duzy.bin', type: 'application/octet-stream', dataUrl: 'data:application/octet-stream;base64,' + 'A'.repeat(900 * 1024) });
  assert.notEqual(big.status, 413, 'a material upload must not hit the plain-JSON cap');
});

/* ================================================================= S-05 sessions ==== */

test('[sec.7] logging in rotates the session token and kills the one the caller brought', async () => {
  const c = await S.as('e.zielinska');
  const first = c.cookie;
  expectOk(await c.get('/api/auth/session'));
  await c.login('e.zielinska');                         // same browser, logs in again
  assert.notEqual(c.cookie, first, 'a new token is issued');
  const old = S.db.one('sessions', (s) => s.token === first.split('=')[1]);
  assert.equal(old.revoked, true); assert.equal(old.revokedReason, 'reauth');
  const replay = S.client(); replay.cookie = first;
  assert.equal((await replay.get('/api/auth/session')).status, 401, 'the presented session id is dead');
});

test('[sec.8] changing the password logs the account out of every other session', async () => {
  const laptop = await S.as('pedagog');
  const phone = await S.as('pedagog');
  const stolen = await S.as('pedagog');
  assert.equal((await laptop.get('/api/auth/session')).status, 200);
  const r = expectOk(await phone.post('/api/auth/password', { current: DEMO_PASSWORD, next: 'Nowe-Haslo-Pedagog-2026!' }));
  assert.equal(r.revokedSessions, 2);
  assert.match(r.message, /Wylogowano pozostałe sesje/);
  assert.equal((await phone.get('/api/auth/session')).status, 200, 'the session that changed the password survives');
  assert.equal((await laptop.get('/api/auth/session')).status, 401);
  assert.equal((await stolen.get('/api/auth/session')).status, 401);
  assert.ok(S.db.col('sessions').filter((s) => s.userId === 'u_pedagog' && s.revokedReason === 'password_changed').length === 2);
  const a = audits((x) => x.action === 'password_changed' && x.entityId === 'u_pedagog')[0];
  assert.equal(a.after.revokedSessions, 2);
});

test('[sec.9] the number of live sessions per account is bounded', async () => {
  S.db.data.config.maxSessionsPerUser = 3; S.db.save();
  for (let i = 0; i < 6; i++) await S.as('logopeda');
  const live = S.db.col('sessions').filter((s) => s.userId === 'u_logopeda' && !s.revoked);
  assert.equal(live.length, 3);
  assert.ok(S.db.col('sessions').some((s) => s.userId === 'u_logopeda' && s.revokedReason === 'session_cap'));
  delete S.db.data.config.maxSessionsPerUser; S.db.save();
});

test('[sec.16] a non-string password is a 401, not a 500', async () => {
  const c = S.client(); const ip = '198.51.100.51';
  for (const pw of [{ a: 1 }, ['x'], 42, true, null]) {
    const r = await c.post('/api/auth/login', { login: 'j.nowak', password: pw }, from(ip));
    assert.equal(r.status, 401, 'password ' + JSON.stringify(pw));
    assert.equal(r.body.error, 'Nieprawidłowy login lub hasło.');
  }
  const bad = await S.client().post('/api/auth/password', { current: { a: 1 }, next: 'Cos-Innego-2026!' });
  assert.equal(bad.status, 401, 'unauthenticated callers never reach the hasher');
});

/* ================================================================= IDOR fixes ==== */

test('[sec.10] descriptive assessments are no longer readable school-wide by pupils and parents', async () => {
  const cls = S.db.col('classes').find((c) => c.level <= 3);
  const kid = S.db.col('students').find((s) => s.classId === cls.id);
  const area = (S.db.data.developmentAreas || [])[0];
  const teacher = await S.as('i.kaczmarek');
  expectOk(await teacher.post('/api/descriptive-grades', { studentId: kid.id, area, text: 'Opis rozwoju dziecka — dane wrażliwe.' }));

  const pupil = await S.as('anna.kowalczyk');                       // an unrelated pupil from 7b
  const unscoped = await pupil.get('/api/descriptive-grades');
  assert.equal(unscoped.status, 400); assert.equal(unscoped.body.code, 'no_scope');
  const byClass = await pupil.get('/api/descriptive-grades?classId=' + cls.id);
  assert.equal(byClass.status, 403); assert.equal(byClass.body.code, 'forbidden');
  const byId = await pupil.get('/api/descriptive-grades?studentId=' + kid.id);
  assert.equal(byId.status, 403);

  const parent = await S.as('rodzic.nowak');
  assert.equal((await parent.get('/api/descriptive-grades')).status, 400);
  assert.equal((await parent.get('/api/descriptive-grades?classId=' + cls.id)).status, 403);

  /* staff keep the view they need */
  const own = expectOk(await teacher.get('/api/descriptive-grades?classId=' + cls.id));
  assert.ok(own.descriptive.some((d) => d.studentId === kid.id));
});

test('[sec.11] support documentation (IPET/WOPFU) is scoped to one named pupil the reader is entitled to see', async () => {
  const stranger = await S.as('i.kaczmarek');                        // grade 1a teacher, teaches nothing in 7b
  for (const p of ['/api/support/ipet', '/api/support/wopfu']) {
    const all = await stranger.get(p);
    assert.equal(all.status, 400, p + ' must not answer without a studentId');
    assert.equal(all.body.code, 'no_student');
    const one = await stranger.get(p + '?studentId=st_nowak_jan');
    assert.equal(one.status, 403, p + ' must not expose a pupil this teacher does not teach');
    assert.equal(one.body.code, 'forbidden');
  }
  assert.equal((await stranger.get('/api/support/ipet-implementation?studentId=st_nowak_jan')).status, 403);
  /* the support team and the pupil's own teachers still get the documents */
  const spec = await S.as('pedagog.specjalny');
  assert.ok(expectOk(await spec.get('/api/support/ipet?studentId=st_nowak_jan')).item);
  const homeroom = await S.as('j.nowak');                           // homeroom of 7b, teaches Jan
  assert.ok(expectOk(await homeroom.get('/api/support/wopfu?studentId=st_nowak_jan')).item);
});

test('[sec.12] only a guardian (or an adult pupil) can consent to recording a lesson', async () => {
  const teacher = await S.as('j.nowak');
  const made = expectOk(await teacher.post('/api/meetings', { kind: 'lesson', title: 'Lekcja zdalna 7b', date: S.TODAY, start: '09:00', end: '09:45', joinPolicy: 'class', classIds: ['7b'] }));
  const id = made.meeting.id;
  assert.ok(made.meeting.recording.missingConsents > 0);

  const forged = await teacher.post(`/api/meetings/${id}/recording-consent`, { studentId: 'st_kowalczyk_anna', granted: true });
  assert.equal(forged.status, 403); assert.equal(forged.body.code, 'not_guardian');
  const byPrincipal = await (await S.as('dyrektor')).post(`/api/meetings/${id}/recording-consent`, { studentId: 'st_kowalczyk_anna', granted: true });
  assert.equal(byPrincipal.status, 403);
  assert.equal((await teacher.post(`/api/meetings/${id}/recording`, { enabled: true })).status, 409, 'recording stays off without real consents');

  const guardian = await S.as('rodzic.kowalczyk');
  expectOk(await guardian.post(`/api/meetings/${id}/recording-consent`, { studentId: 'st_kowalczyk_anna', granted: true }));
  assert.equal((await guardian.post(`/api/meetings/${id}/recording-consent`, { studentId: 'st_nowak_jan', granted: true })).status, 403, 'and only for their own child');
});

test('[sec.13] a pupil’s submitted homework is not readable by unrelated staff', async () => {
  const sub = S.db.col('homeworkSubmissions')[0];
  assert.ok(sub, 'seed has at least one submission');
  const url = `/api/homework/${sub.homeworkId}/submissions/${sub.id}`;
  for (const login of ['biblioteka', 'stolowka', 'swietlica', 'sekretariat']) {
    const r = await (await S.as(login)).get(url);
    assert.equal(r.status, 403, login + ' must not read a pupil’s submitted work');
    assert.equal(r.body.code, 'forbidden');
  }
  /* the teacher who set the task, the pupil and the pupil's parent still see it */
  const hw = S.db.get('homework', sub.homeworkId);
  const teacher = S.db.get('users', hw.teacherId);
  const t = await S.as(teacher.login);
  assert.ok(expectOk(await t.get(url)).submission.files);
  const pupilAccount = S.db.one('users', (u) => u.role === 'student' && u.studentId === sub.studentId);
  if (pupilAccount) assert.equal((await (await S.as(pupilAccount.login)).get(url)).status, 200);
});

/* ================================================================= S-07 CSV ==== */

test('[sec.14] CSV exports cannot smuggle spreadsheet formulas', async () => {
  const D = require('../server/lib/domain');
  assert.equal(D.csvCell('=cmd|\' /C calc\'!A1'), "'=cmd|' /C calc'!A1");
  assert.equal(D.csvCell('+1+1'), "'+1+1");
  assert.equal(D.csvCell('@SUM(A1)'), "'@SUM(A1)");
  assert.equal(D.csvCell('-2+3+cmd'), "'-2+3+cmd");
  assert.equal(D.csvCell('-12,5'), '-12,5', 'plain numbers stay numbers');
  assert.equal(D.csvCell('4+'), '4+', 'a grade like 4+ is untouched');

  const teacher = await S.as('b.sikora');
  const pupil = S.db.col('students').find((s) => s.classId === '7a');
  expectOk(await teacher.post('/api/grades', {
    studentId: pupil.id, subjectId: 'pol', classId: '7a', categoryId: S.db.col('gradeCategories')[0].id,
    value: '4', comment: '=cmd|\' /C calc\'!A1'
  }));
  const csv = String((await teacher.get('/api/grades/export.csv?classId=7a&subjectId=pol')).body);
  assert.ok(csv.includes('cmd'), 'the comment is still exported');
  assert.ok(!/(^|;|\n)"?=cmd/.test(csv), 'but never as a live formula');
  assert.ok(csv.includes("'=cmd"), 'it is neutralised with a leading apostrophe');

  const admin = await S.as('admin');
  expectOk(await admin.post('/api/feedback', { body: '=HYPERLINK("http://zly.example","klik")', kind: 'idea' }));
  const fb = String((await admin.get('/api/feedback/export.csv')).body);
  assert.ok(!/(^|;|\n)"?=HYPERLINK/.test(fb));
  assert.ok(fb.includes("'=HYPERLINK"));
});

/* ================================================================= S-09 offline cache ==== */

test('[sec.15] the service worker drops cached API responses when the page reports a logout', async () => {
  const swSource = fs.readFileSync(path.join(__dirname, '..', 'public', 'sw.js'), 'utf8');
  const core = fs.readFileSync(path.join(__dirname, '..', 'public', 'app', 'core.js'), 'utf8');
  assert.match(core, /postMessage\(\{ type: 'logout' \}\)/, 'logout() tells the service worker');
  assert.match(core, /async function logout\(\)[\s\S]*purgeOfflineCache\(\)/);

  /* drive the worker's message handler against a stub Cache Storage */
  const store = {
    'edmat-v1': ['https://szkola.example/api/grades/student/st_x', 'https://szkola.example/api/auth/session', 'https://szkola.example/app/core.js', 'https://szkola.example/index.html'],
    'edmat-old': ['https://szkola.example/api/modules/nurse/visits']
  };
  const listeners = {};
  const sandbox = {
    self: {
      addEventListener: (name, fn) => { listeners[name] = fn; },
      skipWaiting: () => {}, clients: { claim: () => {}, matchAll: async () => [] }
    },
    caches: {
      keys: async () => Object.keys(store),
      open: async (name) => ({
        keys: async () => store[name].map((url) => ({ url })),
        delete: async (req) => { const i = store[name].indexOf(req.url); if (i >= 0) store[name].splice(i, 1); return i >= 0; },
        put: async () => {}, addAll: async () => {}
      }),
      match: async () => undefined, delete: async () => true
    },
    location: { origin: 'https://szkola.example' },
    URL, Response, fetch: async () => { throw new Error('offline'); }
  };
  sandbox.self.caches = sandbox.caches;
  require('node:vm').runInNewContext(swSource, sandbox);
  assert.ok(listeners.message, 'sw.js registers a message handler');

  const replies = [];
  const waits = [];
  listeners.message({ data: { type: 'logout' }, ports: [{ postMessage: (m) => replies.push(m) }], waitUntil: (p) => waits.push(p) });
  await Promise.all(waits);

  const left = Object.values(store).flat();
  assert.deepEqual(left.filter((u) => u.includes('/api/')), [], 'no API response survives the logout');
  assert.ok(left.includes('https://szkola.example/app/core.js'), 'the app shell stays cached so the login page works offline');
  assert.ok(left.includes('https://szkola.example/index.html'));
  assert.equal(replies[0].type, 'logout-done');
  assert.equal(replies[0].removed, 3);

  /* an unrelated message must not wipe anything */
  store['edmat-v1'].push('https://szkola.example/api/auth/session');
  listeners.message({ data: { type: 'ping' }, ports: [] });
  assert.ok(Object.values(store).flat().some((u) => u.includes('/api/')));
});

/* ================================================================= S-11, S-13, S-15, S-17, S-19 ==== */

test('[sec.19] an enrolled account cannot pull its live TOTP secret out of a borrowed session', async () => {
  const u = S.db.one('users', (x) => x.login === 'a.wojcik');
  u.totpSecret = require('../server/lib/crypto').totpSecret(); u.totpEnabled = true; S.db.save();
  const live = u.totpSecret;
  const c = await S.as('a.wojcik');
  expectOk(await c.post('/api/auth/totp', { code: totpCode(live) }));

  const denied = await c.post('/api/auth/totp/setup', {});
  assert.equal(denied.status, 401);
  assert.equal(denied.body.code, 'reauth_required');
  assert.match(denied.body.error, /Potwierdź hasłem/);
  assert.equal(denied.body.secret, undefined, 'odmowa nie wycieka sekretu');
  assert.ok(audits((x) => x.action === 'totp_setup_denied' && x.entityId === u.id).length >= 1, 'próba bez hasła jest odnotowana');
  assert.equal(S.db.get('users', u.id).totpSecret, live, 'działający drugi składnik nie został ruszony');

  const wrong = await c.post('/api/auth/totp/setup', { password: 'nie-to-haslo' });
  assert.equal(wrong.status, 401);

  const ok = expectOk(await c.post('/api/auth/totp/setup', { password: DEMO_PASSWORD }));
  assert.equal(ok.rebinding, true);
  assert.notEqual(ok.secret, live, 'powiązanie nowej aplikacji wydaje świeży sekret');
  assert.match(ok.otpauth, /^otpauth:\/\/totp\/EdMat:a\.wojcik\?/);
  assert.ok(audits((x) => x.action === 'totp_secret_issued' && x.entityId === u.id).length >= 1);
  assert.equal(S.db.get('users', u.id).totpSecret, live, 'stara aplikacja działa do potwierdzenia nowej');

  /* nowy sekret wchodzi w życie dopiero, gdy nowa aplikacja poda kod */
  expectOk(await c.post('/api/auth/totp/enable', { code: totpCode(ok.secret) }));
  assert.equal(S.db.get('users', u.id).totpSecret, ok.secret);
  assert.equal(S.db.get('users', u.id).totpPendingSecret, null);
  assert.equal((await c.get('/api/auth/session')).body.user.totpPendingSecret, undefined, 'sekret nie wycieka widokiem sesji');
});

test('[sec.20] uploads are validated server-side: declared type, magic bytes, size and file name', async () => {
  const c = await S.as('j.nowak');
  const to = ['u_zielinska'];
  const b64 = (t) => Buffer.from(t).toString('base64');
  const send = (attachments) => c.post('/api/messages', { toUserIds: to, subject: 'Załącznik', body: 'W załączeniu.', attachments });

  const html = await send([{ name: 'oceny.html', type: 'text/html', dataUrl: 'data:text/html;base64,' + b64('<script>fetch("/api/grades")</script>') }]);
  assert.equal(html.status, 415); assert.equal(html.body.code, 'file_type_not_allowed');

  const svg = await send([{ name: 'logo.svg', type: 'image/svg+xml', dataUrl: 'data:image/svg+xml;base64,' + b64('<svg onload="x()"/>') }]);
  assert.equal(svg.status, 415); assert.equal(svg.body.code, 'file_type_not_allowed');

  const lying = await send([{ name: 'foto.png', type: 'image/png', dataUrl: 'data:text/html;base64,' + b64('<b>hi</b>') }]);
  assert.equal(lying.status, 415); assert.equal(lying.body.code, 'type_mismatch');

  const notPng = await send([{ name: 'foto.png', type: 'image/png', dataUrl: 'data:image/png;base64,' + b64('<svg onload="x()"/>') }]);
  assert.equal(notPng.status, 415); assert.equal(notPng.body.code, 'content_mismatch');

  const junk = await send([{ name: 'plik', type: 'application/pdf', dataUrl: 'JVBERi0x' }]);
  assert.equal(junk.status, 400); assert.equal(junk.body.code, 'bad_data_url');

  /* rozmiar liczony z treści, nie z pola `size` przysłanego przez klienta */
  const big = 'data:application/pdf;base64,' + Buffer.concat([Buffer.from('%PDF-1.4\n'), Buffer.alloc(11 * 1024 * 1024, 0x41)]).toString('base64');
  const tooBig = await send([{ name: 'wielki.pdf', type: 'application/pdf', size: 12, dataUrl: big }]);
  assert.equal(tooBig.status, 413); assert.equal(tooBig.body.code, 'attachment_too_large');

  const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.from('IHDR-fake-body')]);
  const nasty = '../../etc/passwd' + String.fromCharCode(0) + '.png';
  const ok = expectOk(await send([{ name: nasty, type: 'image/png', size: 999999, dataUrl: 'data:image/png;base64,' + PNG.toString('base64') }]));
  const a = ok.message.attachments[0];
  assert.equal(a.name, 'passwd.png', 'nazwa traci separatory ścieżki i znaki sterujące');
  assert.equal(a.type, 'image/png');
  assert.equal(a.size, PNG.length, 'rozmiar pochodzi z treści, nie z deklaracji klienta');
  assert.equal(S.db.get('messages', ok.message.id).attachments[0].name, 'passwd.png');
});

test('[sec.21] an audit row is frozen all the way down, and it never freezes the record it describes', async () => {
  const cat = S.db.col('gradeCategories')[0];
  const row = require('../server/lib/audit').audit(S.db, { action: 'sec21_probe', entity: 'gradeCategory', entityId: cat.id, before: null, after: cat });
  assert.equal(Object.isFrozen(row), true);
  assert.equal(Object.isFrozen(row.after), true, 'sub-objects are frozen too, not just the row');
  assert.throws(() => { row.after.weight = 99; }, TypeError, 'evidence cannot be rewritten in-process');
  assert.throws(() => { row.action = 'nothing_happened'; }, TypeError);
  /* the live record the caller passed by reference must stay writable */
  assert.equal(Object.isFrozen(cat), false, 'auditing a row must not immobilise the journal');
  const stored = S.db.col('audit').find((x) => x.id === row.id);
  assert.equal(Object.isFrozen(stored.after), true);
  assert.equal(stored.after.weight, cat.weight);
});

test('[sec.22] the CSP forbids plugins outright (object-src none)', async () => {
  const r = await S.client().get('/api/auth/policy');
  const csp = r.headers.get('content-security-policy');
  assert.match(csp, /object-src 'none'/);
  assert.match(csp, /frame-ancestors 'none'/);
  assert.match(csp, /base-uri 'self'/);
});

test('[sec.23] supervision groups of a trip can only be moved by the people who run it', async () => {
  const TRIP = 'pm_trip_wieliczka';
  const t = S.db.get('trips', TRIP);
  const staying = S.db.col('students').find((s) => (t.classIds || []).includes(s.classId) && !(t.studentIds || []).includes(s.id));
  assert.ok(staying, 'ktoś z oddziału zostaje w szkole');

  const outsider = await S.as('k.lis');                     // nauczyciel spoza karty wycieczki
  const denied = await outsider.post(`/api/modules/trips/${TRIP}/non-participants`, { studentId: staying.id, tempGroup: 'biblioteka' });
  assert.equal(denied.status, 403); assert.equal(denied.body.code, 'not_trip_leader');
  assert.equal((S.db.get('trips', TRIP).nonParticipants || {})[staying.id], undefined, 'nic nie zostało zapisane');

  const leader = await S.as('a.mazur');
  expectOk(await leader.post(`/api/modules/trips/${TRIP}/non-participants`, { studentId: staying.id, tempGroup: 'biblioteka', reason: 'Brak zgody opiekuna' }));
  assert.equal(S.db.get('trips', TRIP).nonParticipants[staying.id].tempGroup, 'biblioteka');
});

test('[sec.24] a CSV row with the wrong number of columns is reported, never shifted into the wrong fields', async () => {
  const admin = await S.as('admin');
  const header = 'class;rollNo;lastName;firstName;pesel;birthDate;birthPlace;parentLastName;parentFirstName;parentEmail;parentPhone';
  const good = '7c;1;Testowy;Jan;;2013-04-15;Kraków;Testowy;Marta;;';
  const shifted = '1;Przesunięty;Ada;;2013-05-16;Kraków;Przesunięty;Ewa;;';        // brakuje kolumny „class”
  const r = expectOk(await admin.post('/api/setup/students/import', { csv: [header, good, shifted].join('\n'), dryRun: true }));
  assert.equal(r.created.length, 1, 'poprawny wiersz przechodzi');
  const err = r.errors.find((e) => e.line === 3);
  assert.ok(err, 'wiersz o złej liczbie kolumn wraca jako błąd z numerem linii');
  assert.equal(err.code, 'column_count');
  assert.equal(err.expected, 11); assert.equal(err.actual, 10);
  assert.match(err.error, /Oczekiwano 11/);
  assert.equal(r.created.some((x) => x.name.includes('Przesunięty')), false, 'przesunięty wiersz nie wchodzi do importu');
});

test('[sec.25] a bulk import yields the event loop between batches instead of blocking it end to end', async () => {
  /* REL-15: import był jednym synchronicznym blokiem — w jego trakcie proces nie obsługiwał nikogo
     innego, a Node zamykał bezczynne połączenia keep-alive. Liczymy obroty pętli zdarzeń w czasie
     pracy samego handlera: przy 1200 wierszach i porcjach po 50 musi ich być kilkanaście. */
  const route = S.app.router.routes.find((r) => r.method === 'POST' && r.pattern === '/api/setup/students/import');
  assert.ok(route, 'trasa importu uczniów jest zarejestrowana');
  const header = 'class;rollNo;lastName;firstName;pesel;birthDate;birthPlace;parentLastName;parentFirstName;parentEmail;parentPhone';
  const rows = [];
  for (let i = 0; i < 1200; i++) rows.push(`9z;${i + 1};Wsadowy${i};Test;;2013-04-15;Kraków;;;`.concat(';'));
  const csv = [header].concat(rows).join('\n');

  let turns = 0, stop = false;
  const tick = () => { if (!stop) { turns++; setImmediate(tick); } };
  setImmediate(tick);
  const ctx = { db: S.db, user: S.db.one('users', (u) => u.role === 'admin'), ip: '::1', body: { csv, dryRun: true }, query: {}, params: {}, audit: () => {} };
  const out = await route.handler(ctx);
  stop = true;

  assert.equal(out.dryRun, true);
  assert.equal(out.created.length, 1200, 'próbny przebieg przetwarza wszystkie wiersze');
  assert.equal(out.errors.length, 0);
  assert.ok(turns >= 15, `pętla zdarzeń obróciła się ${turns} razy w trakcie importu — za mało, żeby obsłużyć kogokolwiek innego`);
  assert.equal(S.db.col('students').some((s) => s.classId === '9z'), false, 'próbny przebieg niczego nie zapisuje');
});

/* ================================================= runda 3: powierzchnia publiczna i logi ==== */

test('[sec.26] a 413 on an oversized body reaches the caller as a Polish message, not a reset socket', async () => {
  /* R3-04/S3-21 — `readBody` odrzucało promesę i w tym samym takcie niszczyło gniazdo, więc
     przeglądarka pokazywała „połączenie przerwane” zamiast komunikatu. Dyrektor, który wgrywa
     podpis kwalifikowany w dziesiątym dniu terminu z § 22, nie ma jak się domyślić, co jest nie tak. */
  const c = await S.as('admin');
  const r = await c.post('/api/feedback', { body: 'x'.repeat(700 * 1024) });
  assert.equal(r.status, 413);
  assert.equal(r.body.code, 'payload_too_large');
  assert.match(r.body.error, /Zbyt duże żądanie/);
  assert.ok(r.body.maxBytes > 0);
});

test('[sec.27] a file name from a request body cannot forge a second header or a second filename', () => {
  const { safeContentDisposition } = require('../server/lib/router');
  /* S3-09 — `filename="dziennik-${year}.xml"` z `year` prosto z treści żądania. Cudzysłów zamykał
     parametr i otwierał drugi (klienci nie zgadzają się, który wygrywa, więc plik lądował na dysku
     pod nazwą atakującego — a trasa `/print` jest `inline` i serwuje `text/html`), a CRLF robił
     z trasy ustawowego pobrania trwałą pięćsetkę, której nie dało się cofnąć: nie ma trasy
     usuwającej wiersz archiwum. */
  const h = safeContentDisposition('x"; filename="oceny-7b.html');
  assert.equal(h.split('filename=').length - 1, 2);
  assert.equal(/[\r\n]/.test(safeContentDisposition('a\r\nSet-Cookie: s=1')), false);
  assert.ok(safeContentDisposition('x'.repeat(50000)).length < 1200);
  assert.doesNotThrow(() => require('node:http').validateHeaderValue('Content-Disposition', safeContentDisposition('../../etc/pass"wd\r\n')));
});

test('[sec.28] the public accessibility statement is cheap, capped and fact-free', async () => {
  /* S3-01 + S3-03 — jedna trasa bez sesji, w procesie, który obsługuje całą szkołę. Ta sama trasa
     oddawała przy `facts=1` login prawdziwego konta każdej z 16 ról i liczniki wierszy art. 9. */
  const anon = S.client();
  S.app.publicRateLimit.reset();
  const r = await anon.get('/api/compliance/accessibility?format=json&facts=1');
  assert.equal(r.status, 200);
  assert.equal(r.body.facts, undefined);
  assert.equal(JSON.stringify(r.body).includes('sampleLogin'), false);
  assert.equal(JSON.stringify(r.body).includes('passwordPolicy'), false);

  const t0 = Date.now();
  for (let i = 0; i < 12; i++) expectOk(await anon.get('/api/compliance/accessibility'));
  const ms = Date.now() - t0;
  assert.ok(ms < 1500, '12 anonimowych żądań deklaracji trwało ' + ms + ' ms — trasa liczy z pamięci');

  S.app.publicRateLimit.reset();
  let blocked = 0;
  for (let i = 0; i < S.app.publicRateLimit.limit + 10; i++) if ((await anon.get('/api/compliance/accessibility')).status === 429) blocked++;
  assert.ok(blocked >= 8, 'trasa publiczna ma własne okno, tak jak logowanie');
  S.app.publicRateLimit.reset();
});

test('[sec.29] the config every pupil is handed is an allowlist, and holds no secret', async () => {
  /* S3-02 — `publicConfig` było „config minus trzy klucze”, więc każdy uczeń i każdy rodzic dostawał
     sekret webhooka serwera wideo (a po skonfigurowaniu Jitsi — klucz podpisujący żetony wejścia na
     spotkanie), pensum i stawki nauczycieli oraz zdanie mówiące wprost, że logowania administracyjne
     nie są ograniczone adresem IP. */
  const pupil = await S.as('anna.kowalczyk');
  const cfg = expectOk(await pupil.get('/api/auth/session')).config;
  const c = S.db.data.config;
  for (const k of ['video', 'payroll', 'ipAllowlistNote', 'ipAllowlistExample', 'require2FAForGradeEditors', 'logRetentionYears', 'retention', 'schoolPrivateKey', 'ipAllowlist']) {
    assert.equal(cfg[k], undefined, 'publicConfig nadal oddaje ' + k);
  }
  const blob = JSON.stringify(cfg);
  assert.ok(c.video && c.video.eventSecret, 'sanity: seed ma sekret webhooka wideo');
  assert.equal(blob.includes(c.video.eventSecret), false, 'sekret webhooka wideo w sesji ucznia');
  assert.equal(/PRIVATE KEY/.test(blob), false);
  /* Klucz dodany jutro przez czyjś seed nie staje się przez to publiczny. */
  await require('./helpers').withConfig(S.db, { nowyTajnySekret: 'abc-123-tajne' }, async () => {
    const again = expectOk(await (await S.as('anna.kowalczyk')).get('/api/auth/session')).config;
    assert.equal(again.nowyTajnySekret, undefined, 'nowy klucz konfiguracji nie jedzie do klienta bez decyzji');
  });
  /* …a to, czego klient naprawdę potrzebuje, zostaje. */
  for (const k of ['school', 'year', 'today', 'sessionTimeoutMin', 'visibility']) assert.notEqual(cfg[k], undefined, 'brak config.' + k);
});
