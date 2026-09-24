'use strict';
const test = require('node:test'); const assert = require('node:assert/strict');
const { startServer, expectOk } = require('./helpers');
let S; test.before(async () => { process.env.EDMAT_DEMO = '1'; process.env.EDMAT_SSO_SECRET = 'test-secret'; S = await startServer(); }); test.after(() => { delete process.env.EDMAT_DEMO; delete process.env.EDMAT_SSO_SECRET; return S.close(); });

test('modules: registry lists modules, required ones cannot be disabled, disabling hides routes and screens', async () => {
  const c = await S.as('admin'); const list = expectOk(await c.get('/api/modules')); assert.ok(list.modules.find((m) => m.id === 'courses'));
  assert.equal((await c.patch('/api/admin/modules', { enabled: { core: false } })).status, 400);
  expectOk(await c.patch('/api/admin/modules', { enabled: { support: false } }));
  const off = await (await S.as('e.zielinska')).get('/api/support/students'); assert.equal(off.status, 404); assert.equal(off.body.code, 'module_disabled');
  const js = await (await fetch(S.base + '/app/screens.js')).text(); assert.match(js, /setModules\(\{.*"support":false/);
  expectOk(await c.patch('/api/admin/modules', { enabled: { support: true } }));
  assert.equal((await (await S.as('e.zielinska')).get('/api/support/students')).status, 200);
});
test('locale: per-user locale is stored and returned with the session; bundle and i18n files are served', async () => {
  const c = await S.as('j.nowak'); expectOk(await c.post('/api/auth/locale', { locale: 'en' })); assert.equal(expectOk(await c.get('/api/auth/session')).user.locale, 'en');
  const i18n = await (await fetch(S.base + '/app/i18n.js')).text(); assert.match(i18n, /'nav\.grades': 'Grades'/); assert.match(i18n, /'nav\.grades': 'Oceny'/);
  const bundle = await (await fetch(S.base + '/edmat/bundle.js')).text(); assert.match(bundle, /setLocale: function/); assert.match(bundle, /allPresent: 'All present'/);
});
test('sso: a signed token signs the user in once; bad signature, expiry and replay are rejected', async () => {
  const mint = (p) => S.app.ssoToken(p, 'test-secret'); const exp = Math.floor(Date.now() / 1000) + 60;
  const c = S.client(); const r = await c.get('/api/auth/sso?token=' + mint({ login: 'a.wojcik', exp, nonce: 'n1', locale: 'en', to: '/lekcja' }));
  assert.equal(r.status, 302); assert.equal(r.headers.get('location'), '/#/lekcja'); assert.equal(expectOk(await c.get('/api/auth/session')).user.login, 'a.wojcik'); assert.equal(expectOk(await c.get('/api/auth/session')).user.locale, 'en');
  assert.equal((await S.client().get('/api/auth/sso?token=' + mint({ login: 'a.wojcik', exp, nonce: 'n1' }))).status, 401, 'replay');
  assert.equal((await S.client().get('/api/auth/sso?token=' + mint({ login: 'a.wojcik', exp: exp - 120, nonce: 'n2' }))).status, 401, 'expired');
  assert.equal((await S.client().get('/api/auth/sso?token=' + mint({ login: 'a.wojcik', exp, nonce: 'n3' }).slice(0, -3) + 'abc')).status, 401, 'bad signature');
  assert.equal((await S.client().get('/api/auth/sso?token=' + mint({ login: 'nobody', exp, nonce: 'n4' }))).status, 403);
});
test('demo: personas are public, switching creates a session, guide lists the role stories, feedback is stored and exported', async () => {
  const p = expectOk(await S.client().get('/api/demo/personas')); assert.ok(p.personas.some((x) => x.login === 'rodzic.kowalczyk'));
  const c = S.client(); expectOk(await c.post('/api/demo/switch', { login: 'rodzic.kowalczyk' })); const ses = expectOk(await c.get('/api/auth/session')); assert.equal(ses.user.role, 'parent'); assert.equal(ses.demo.enabled, true);
  const g = expectOk(await c.get('/api/demo/guide?locale=en')); assert.ok(g.sections.some((s) => s.id === '3.7' && s.items.length === 15)); assert.match(g.sections[0].items[0].text, /As a Parent/);
  const gpl = expectOk(await c.get('/api/demo/guide?locale=pl')); assert.match(gpl.sections[0].items[0].text, /Jako Rodzic/);
  expectOk(await c.post('/api/feedback', { rating: 4, kind: 'idea', body: 'Chciałbym widzieć plan na cały tydzień.', screen: '/rodzic', locale: 'pl' }));
  assert.equal((await c.post('/api/feedback', { body: 'x' })).status, 400);
  const admin = await S.as('admin'); const fb = expectOk(await admin.get('/api/feedback')); assert.equal(fb.count, 1); assert.equal(fb.items[0].role, 'parent');
  const csv = await admin.get('/api/feedback/export.csv'); assert.equal(csv.status, 200); assert.match(csv.body, /at;role;login;screen/); assert.match(csv.body, /cały tydzień/);
  assert.equal((await (await S.as('j.nowak')).get('/api/feedback')).status, 403);
});
test('base path: the app can be mounted under a prefix (assets relative, API prefixed, service worker scope)', async () => {
  const { createApp } = require('../server/index'); const app = createApp({ dataFile: null, quiet: true, basePath: '/dziennik' }); const port = await app.listen(0); const base = `http://127.0.0.1:${port}`;
  try {
    const home = await fetch(base + '/dziennik/'); assert.equal(home.status, 200); const html = await home.text(); assert.match(html, /<base href="\/dziennik\/">/); assert.match(html, /src="app\/base.js"/); assert.match(html, /src="app\/core.js"/);
    assert.equal((await fetch(base + '/dziennik', { redirect: 'manual' })).status, 302);
    assert.equal((await fetch(base + '/dziennik/edmat/tokens.css')).status, 200);
    assert.equal((await fetch(base + '/other/')).status, 404);
    const login = await fetch(base + '/dziennik/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ login: 'j.nowak', password: S.DEMO_PASSWORD }) }); assert.equal(login.status, 200);
    const sw = await fetch(base + '/dziennik/sw.js'); assert.equal(sw.headers.get('service-worker-allowed'), '/dziennik/');
    assert.equal(await (await fetch(base + '/dziennik/app/base.js')).text(), 'window.EDMAT_BASE="/dziennik";'); assert.match(html, /src="app\/base.js"/); assert.doesNotMatch(html, /<script>window/);
    assert.equal((await fetch(base + '/app/autoprint.js')).status, 200, 'print documents load the auto-print script from the unprefixed path');
  } finally { await app.close(); }
});
test('[REL-17] log żądań to jedna ustrukturyzowana linia: czas ISO, metoda, ścieżka bez query, status, czas, konto, id żądania i kod błędu', async () => {
  /* nagłówek X-Request-Id jest na każdej odpowiedzi, a poprawny przychodzący jest uszanowany */
  const ID = /^[A-Za-z0-9._-]{4,64}$/;
  const plain = await fetch(S.base + '/api/health');
  assert.match(plain.headers.get('x-request-id') || '', ID);
  const given = await fetch(S.base + '/api/health', { headers: { 'X-Request-Id': 'proxy-7f3a.2_x' } });
  assert.equal(given.headers.get('x-request-id'), 'proxy-7f3a.2_x');
  const bogus = await fetch(S.base + '/api/health', { headers: { 'X-Request-Id': 'ala ma kota' } });
  assert.notEqual(bogus.headers.get('x-request-id'), 'ala ma kota', 'podejrzany identyfikator zastępujemy własnym');
  assert.match(bogus.headers.get('x-request-id') || '', ID);

  /* EDMAT_LOG=1 włącza `log` w createApp — tu ten sam przełącznik, z podstawionym console.log */
  const { createApp } = require('../server/index');
  const app = createApp({ dataFile: null, quiet: true, log: true });
  const port = await app.listen(0); const base = `http://127.0.0.1:${port}`;
  const lines = []; const realLog = console.log;
  console.log = (...a) => { lines.push(a.map(String).join(' ')); };
  try {
    await fetch(base + '/api/health?pesel=90010112345');
    const login = await fetch(base + '/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ login: 'sekretariat', password: S.DEMO_PASSWORD }) });
    const cookie = String(login.headers.get('set-cookie') || '').split(';')[0];
    await fetch(base + '/api/auth/session', { headers: { Cookie: cookie, 'X-Request-Id': 'sesja-1234' } });
    await fetch(base + '/api/auth/session');                       // bez sesji → 401 unauthenticated
    await fetch(base + '/api/nie-ma-takiej-sciezki');
    /* S3-15: w tym schemacie identyfikator ucznia JEST nazwiskiem. */
    await fetch(base + '/api/registry/students/st_kowalczyk_anna/guardians', { headers: { Cookie: cookie } });
  } finally { console.log = realLog; await app.close(); }

  const line = (needle) => lines.find((l) => l.includes(' ' + needle + ' '));
  const health = line('/api/health');
  assert.ok(health, 'żądanie zapisane w logu');
  assert.match(health, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z GET \/api\/health 200 \d+ms user=- req=[A-Za-z0-9._-]{4,64}$/);
  assert.equal(health.includes('pesel'), false, 'query string nie trafia do logu');

  const session = lines.find((l) => l.includes('req=sesja-1234'));
  assert.match(session, / GET \/api\/auth\/session 200 \d+ms user=u_sekretariat req=sesja-1234$/, 'konto i przychodzące id żądania');

  const denied = lines.find((l) => l.includes('/api/auth/session') && l.includes(' 401 '));
  assert.match(denied, /user=- req=[A-Za-z0-9._-]{4,64} code=unauthenticated$/, 'kod błędu JSON w linii');

  /* S3-15 — w logu stoi WZORZEC trasy, a nie ścieżka. Wycinanie query stringu niczego nie chroniło,
     dopóki `st_kowalczyk_anna` jechało w ścieżce: log operacyjny jest zwykłym plikiem poza sklepem,
     poza audytem i poza retencją, i to on najczęściej trafia do hostującego albo do monitoringu. */
  const guardians = line('/api/registry/students/:id/guardians');
  assert.ok(guardians, 'w logu stoi wzorzec trasy: ' + JSON.stringify(lines));
  assert.match(guardians, / GET \/api\/registry\/students\/:id\/guardians 200 \d+ms user=u_sekretariat req=[A-Za-z0-9._-]{4,64}$/);
  assert.equal(lines.join('\n').includes('st_kowalczyk_anna'), false, 'identyfikator ucznia (czyli jego nazwisko) nie trafia do logu');

  /* Żądanie, które nie trafiło w żadną trasę, nie ma wzorca — wtedy ścieżka idzie zredagowana. */
  const unknown = lines.find((l) => l.includes(' 404 '));
  assert.match(unknown, / GET \/api\/:x 404 \d+ms user=- req=[A-Za-z0-9._-]{4,64} code=http_404$/, 'nietrafiona ścieżka zredagowana');
  assert.equal(unknown.includes('nie-ma-takiej-sciezki'), false);

  assert.equal(lines.length, 6, 'jedna linia na żądanie');
  assert.equal(new RegExp(String.fromCharCode(27)).test(lines.join('\n')), false, 'log bez kolorów');
});
