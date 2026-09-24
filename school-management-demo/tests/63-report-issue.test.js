'use strict';
/* "Zgłoś błąd" — what this demo stores, and what it hands to the EdMat site.
 *
 * The forwarding half is tested against a stub that stands in for Django: what matters here is the
 * shape of the hand-off (source, area, the role the server attaches rather than trusts) and that a
 * site which is simply not there loses nobody's report.
 */
const test = require('node:test'); const assert = require('node:assert/strict');
const http = require('node:http');
const { startServer, expectOk } = require('./helpers');
const modules = require('../server/modules');
const { issuePayload } = require('../server/routes/report-issue');

let S, T, ADMIN;

/** A stand-in for /api/issues/ that records what it was sent. */
async function stubApi(reply) {
  const seen = [];
  const srv = http.createServer((req, res) => {
    let raw = '';
    req.on('data', (c) => { raw += c; });
    req.on('end', () => {
      seen.push({ url: req.url, body: JSON.parse(raw || '{}') });
      const r = reply || { status: 201, body: { id: 4242 } };
      res.writeHead(r.status, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(r.body));
    });
  });
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  return { seen, base: `http://127.0.0.1:${srv.address().port}/api`, close: () => new Promise((r) => srv.close(r)) };
}

/** Runs `fn` with the forwarding env pointed wherever the test needs, then puts it back. */
async function withEnv(vars, fn) {
  const before = {};
  for (const k of Object.keys(vars)) { before[k] = process.env[k]; if (vars[k] == null) delete process.env[k]; else process.env[k] = vars[k]; }
  try { return await fn(); } finally {
    for (const k of Object.keys(before)) { if (before[k] == null) delete process.env[k]; else process.env[k] = before[k]; }
  }
}

test.before(async () => {
  S = await startServer();
  T = await S.as('j.nowak');      // nauczycielka, wychowawczyni 7b
  ADMIN = await S.as('admin');
});
test.after(() => S.close());

const reports = () => S.db.col('issueReports');

test('[ri.1] każdy może zgłosić błąd — także bez zalogowania', async () => {
  await withEnv({ EDMAT_ISSUES_FORWARD: '0' }, async () => {
    const guest = S.client();
    const before = reports().length;
    const out = expectOk(await guest.post('/api/report-issue', { kind: 'bug', title: 'Nie da się zalogować', body: 'Po wpisaniu hasła nic się nie dzieje.', screen: '/', area: 'core' }));
    assert.equal(out.ok, true);
    assert.equal(out.forwarded, false);              // forwarding is off in this case
    assert.equal(reports().length, before + 1);
    const row = reports()[reports().length - 1];
    assert.equal(row.area, 'core');
    assert.equal(row.role, '');                      // a guest has no role
    assert.equal(row.login, null);
  });
});

test('[ri.2] tytuł jest wymagany', async () => {
  const res = await T.post('/api/report-issue', { title: 'ab', body: 'za krótki tytuł' });
  assert.equal(res.status, 400);
  assert.equal(res.body.code, 'title_required');
});

test('[ri.3] rolę dopisuje serwer z sesji, a nie zgłaszający', async () => {
  await withEnv({ EDMAT_ISSUES_FORWARD: '0' }, async () => {
    expectOk(await T.post('/api/report-issue', { title: 'Oceny nie sumują się', area: 'grades', role: 'principal' }));
    const row = reports()[reports().length - 1];
    assert.equal(row.role, 'teacher');               // not 'principal', whatever the body claimed
    assert.equal(row.login, 'j.nowak');
  });
});

test('[ri.4] nieznany moduł nie staje się kategorią', async () => {
  await withEnv({ EDMAT_ISSUES_FORWARD: '0' }, async () => {
    expectOk(await T.post('/api/report-issue', { title: 'Coś dziwnego', area: 'nie-ma-takiego' }));
    assert.equal(reports()[reports().length - 1].area, '');
  });
});

test('[ri.5] zgłoszenie trafia do EdMata z własnym źródłem i modułem', async () => {
  const api = await stubApi();
  try {
    await withEnv({ EDMAT_ISSUES_API: api.base, EDMAT_ISSUES_FORWARD: undefined }, async () => {
      const out = expectOk(await T.post('/api/report-issue', {
        kind: 'content', title: 'Zła nazwa przedmiotu', body: 'W planie widnieje „Matematyka 2”.',
        area: 'logbook', screen: '/dziennik', pageTitle: 'Dziennik', locale: 'pl', viewport: '1280×800',
        contact: 'nauczycielka@example.test', isPublic: true,
      }));
      assert.equal(out.forwarded, true);
      assert.equal(out.remoteId, '4242');

      assert.equal(api.seen.length, 1);
      assert.equal(api.seen[0].url, '/api/issues/');
      const sent = api.seen[0].body;
      assert.equal(sent.source, 'school_demo');
      assert.equal(sent.area, 'logbook');
      assert.equal(sent.kind, 'content');
      assert.equal(sent.context.role, 'teacher');
      assert.equal(sent.context.path, '/dziennik');
      assert.equal(sent.contact_email, 'nauczycielka@example.test');
      assert.equal(sent.is_public, true);

      const row = reports()[reports().length - 1];
      assert.equal(row.forwarded, true);
      assert.equal(row.remoteId, '4242');
      assert.equal(row.forwardError, null);
    });
  } finally { await api.close(); }
});

test('[ri.6] zgłoszenie anonimowe nie niesie adresu do EdMata', async () => {
  const api = await stubApi();
  try {
    await withEnv({ EDMAT_ISSUES_API: api.base, EDMAT_ISSUES_FORWARD: undefined }, async () => {
      expectOk(await T.post('/api/report-issue', { title: 'Anonimowo', anonymous: true, contact: 'zostaw@mnie.test' }));
      const sent = api.seen[api.seen.length - 1].body;
      assert.equal(sent.anonymous, true);
      assert.equal(sent.contact_email, '');
      assert.equal(reports()[reports().length - 1].contact, '');
    });
  } finally { await api.close(); }
});

test('[ri.7] gdy EdMat nie odpowiada, zgłoszenie i tak zostaje zapisane', async () => {
  await withEnv({ EDMAT_ISSUES_API: 'http://127.0.0.1:1/api', EDMAT_ISSUES_FORWARD: undefined }, async () => {
    const before = reports().length;
    const out = expectOk(await T.post('/api/report-issue', { title: 'Serwis niedostępny' }));
    assert.equal(out.ok, true);
    assert.equal(out.forwarded, false);              // told honestly, rather than claimed
    assert.equal(reports().length, before + 1);
    assert.ok(reports()[reports().length - 1].forwardError, 'the reason the hand-off failed is kept');
  });
});

test('[ri.8] odmowa EdMata jest zapisana wraz z powodem', async () => {
  const api = await stubApi({ status: 400, body: { area: ["'grades' is not an area of 'site'."] } });
  try {
    await withEnv({ EDMAT_ISSUES_API: api.base, EDMAT_ISSUES_FORWARD: undefined }, async () => {
      const out = expectOk(await T.post('/api/report-issue', { title: 'Odrzucone' }));
      assert.equal(out.forwarded, false);
      assert.match(reports()[reports().length - 1].forwardError, /^http_400: /);
    });
  } finally { await api.close(); }
});

test('[ri.9] listę i eksport widzi dyrekcja i administrator, nie nauczyciel', async () => {
  assert.equal((await T.get('/api/report-issue')).status, 403);
  const list = expectOk(await ADMIN.get('/api/report-issue'));
  assert.equal(list.count, reports().length);
  assert.ok(list.count > 0);
  const csv = await ADMIN.get('/api/report-issue/export.csv');
  assert.equal(csv.status, 200);
  assert.match(csv.headers.get('content-type'), /text\/csv/);
  assert.match(csv.body.split('\n')[0], /^at;kind;area;role;login;title/);
});

test('[ri.10] lista modułów do wyboru jest listą modułów tej szkoły', async () => {
  // The dialog offers the same ids the backend files under; a module added here without being
  // added there would arrive as an area the site has never heard of.
  const { AREAS } = require('../server/routes/report-issue');
  assert.deepEqual(AREAS.slice().sort(), modules.MODULES.map((m) => m.id).sort());
});

test('[ri.11] ładunek dla EdMata nie niesie niczego poza dozwolonym kontekstem', () => {
  const sent = issuePayload({ kind: 'bug', area: 'grades', title: 't', body: 'b', screen: '/oceny', pageTitle: 'Oceny', locale: 'pl', viewport: '800×600', userAgent: 'ua', role: 'teacher', contact: 'a@b.test' });
  assert.deepEqual(Object.keys(sent.context).sort(), ['locale', 'page_title', 'path', 'role', 'user_agent', 'viewport']);
  assert.equal(sent.source, 'school_demo');
});
