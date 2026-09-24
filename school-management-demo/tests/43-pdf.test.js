'use strict';
/* Real PDF output: GET /api/pdf?path=<internal print path> renders the print-ready HTML with a local headless
   Chromium. Without one the wrapper answers 501 pdf_unavailable + fallbackUrl and the client opens the HTML. */
const { test } = require('node:test');
const assert = require('node:assert');
const { startServer } = require('./helpers');
const pdfLib = require('../server/lib/pdf');

let S;
test.before(async () => { S = await startServer(); });
test.after(() => S.close());

const q = (p) => '/api/pdf?path=' + encodeURIComponent(p);

test('[pdf] probe reports whether this server can render PDFs, without rendering anything', async () => {
  const c = await S.as('anna.kowalczyk');
  const r = await c.get('/api/pdf?probe=1&path=' + encodeURIComponent('/api/student/grades/print'));
  assert.equal(r.status, 200);
  assert.equal(typeof r.body.available, 'boolean');
  assert.equal(r.body.available, pdfLib.available());
  assert.equal(r.body.fallbackUrl, '/api/student/grades/print');
});

test('[pdf] a print path renders a real PDF (or reports pdf_unavailable with a HTML fallback)', async (t) => {
  const c = await S.as('anna.kowalczyk');
  if (!pdfLib.available()) {
    const r = await c.get(q('/api/student/grades/print'));
    assert.equal(r.status, 501);
    assert.equal(r.body.code, 'pdf_unavailable');
    assert.equal(r.body.fallbackUrl, '/api/student/grades/print');
    return t.skip('no headless Chromium on this machine');
  }
  const r = await c.get(q('/api/student/grades/print'));
  assert.equal(r.status, 200, JSON.stringify(r.body).slice(0, 200));
  assert.match(r.headers.get('content-type') || '', /application\/pdf/);
  assert.ok(Buffer.isBuffer(r.body), 'expected a binary body');
  assert.equal(r.body.slice(0, 5).toString('latin1'), '%PDF-');
  assert.ok(r.body.length > 1024, 'PDF should be larger than 1 KB, got ' + r.body.length);
  assert.match(r.headers.get('content-disposition') || '', /inline; filename="print\.pdf"/);
});

test('[pdf] a print path with a query string renders too', async (t) => {
  if (!pdfLib.available()) return t.skip('no headless Chromium on this machine');
  const c = await S.as('j.nowak');
  const r = await c.get(q('/api/homeroom/print/attendance?month=2026-10'));
  assert.equal(r.status, 200, JSON.stringify(r.body).slice(0, 200));
  assert.equal(r.body.slice(0, 5).toString('latin1'), '%PDF-');
});

test('[pdf] the wrapper keeps the role guard: a student asking for a homeroom printout gets 403', async () => {
  const c = await S.as('anna.kowalczyk');
  const r = await c.get(q('/api/homeroom/print/emergency'));
  assert.equal(r.status, 403, 'expected the homeroom guard to reject the student, got ' + r.status);
  assert.equal(r.body.code, 'forbidden');
  const hr = await S.as('j.nowak');
  const ok = await hr.get('/api/pdf?probe=1&path=' + encodeURIComponent('/api/homeroom/print/emergency'));
  assert.equal(ok.status, 200);
});

test('[pdf] an unknown internal path is 404 and a non-print resource is rejected', async () => {
  const c = await S.as('j.nowak');
  const r = await c.get(q('/api/does/not/exist'));
  assert.equal(r.status, 404);
  assert.equal(r.body.code, 'unknown_path');
  const bad = await c.get('/api/pdf?path=' + encodeURIComponent('/nie-api'));
  assert.equal(bad.status, 400);
  const nested = await c.get(q('/api/pdf'));
  assert.equal(nested.status, 400);
  if (pdfLib.available()) {
    const json = await c.get(q('/api/auth/session'));
    assert.equal(json.status, 415);
    assert.equal(json.body.code, 'not_printable');
  }
});

test('[pdf] logging in is required', async () => {
  const anon = S.client();
  const r = await anon.get(q('/api/student/grades/print'));
  assert.equal(r.status, 401);
});

test('[pdf] renderPdf() produces a PDF buffer from print-ready HTML', async (t) => {
  if (!pdfLib.available()) return t.skip('no headless Chromium on this machine');
  const D = require('../server/lib/domain');
  const buf = await pdfLib.renderPdf(D.printHtml('Test', '<h1>Wydruk testowy</h1><p>Zażółć gęślą jaźń</p>'), { margin: '10mm' });
  assert.ok(Buffer.isBuffer(buf));
  assert.equal(buf.slice(0, 5).toString('latin1'), '%PDF-');
  assert.ok(buf.length > 1024);
});

test('[pdf] the client helper opens the PDF when available and the HTML when not (public/app/print.js)', async () => {
  const vm = require('node:vm'); const fs = require('node:fs'); const path = require('node:path');
  const src = fs.readFileSync(path.join(__dirname, '..', 'public', 'app', 'print.js'), 'utf8');
  function run(available) {
    const opened = []; const probes = [];
    const tab = { closed: false, location: { replace(u) { opened.push(u); } } };
    const sandbox = {
      EdApp: { base: '' },
      open: (u) => { opened.push(u || '(blank)'); return tab; },
      fetch: (u) => { probes.push(u); return Promise.resolve({ ok: true, json: () => Promise.resolve({ available }) }); },
    };
    sandbox.window = sandbox;
    vm.createContext(sandbox);
    vm.runInContext(src, sandbox);
    return { A: sandbox.EdApp, opened, probes, tab };
  }
  const yes = run(true);
  assert.equal(typeof yes.A.openPrint, 'function');
  await yes.A.openPrint('/api/student/grades/print?print=1');
  assert.equal(yes.probes.length, 1);
  assert.ok(yes.probes[0].startsWith('/api/pdf?probe=1&path='), yes.probes[0]);
  assert.equal(yes.opened[0], '(blank)'); // the tab is opened synchronously, then pointed at the document
  assert.equal(yes.opened[1], '/api/pdf?path=' + encodeURIComponent('/api/student/grades/print?print=1'));

  const no = run(false);
  await no.A.openPrint('/api/student/grades/print?print=1');
  assert.equal(no.opened[1], '/api/student/grades/print?print=1'); // unchanged behaviour without a PDF renderer
  await no.A.openPrint('/api/student/grades/print?print=1');
  assert.equal(no.probes.length, 1, 'availability is probed once per page load');
});
