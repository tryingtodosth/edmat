'use strict';
/* Strona projektu (/projekt/, budowana z ../landing do public/projekt/): zwykły katalog statyczny obok powłoki
   aplikacji. Sprawdzamy kontrakt serwera, nie treść strony: bez <base>, przekierowanie na ukośnik, skrót skryptu
   startowego w nagłówku CSP, status.json, działanie pod EDMAT_BASE_PATH i flaga `demo` w /api/health. */
const test = require('node:test'); const assert = require('node:assert/strict'); const fs = require('node:fs'); const path = require('node:path');
const { startServer } = require('./helpers');
let S; test.before(async () => { S = await startServer(); }); test.after(() => S.close());
const built = fs.existsSync(path.join(__dirname, '..', 'public', 'projekt', 'index.html'));

test('the app shell at / still carries <base> and base.js; /api/health says whether demo mode is on', async () => {
  const r = await fetch(S.base + '/'); const html = await r.text();
  assert.match(html, /<base href="\/">/); assert.match(html, /app\/base\.js/); assert.match(html, /<div id="root">/);
  const h = await (await fetch(S.base + '/api/health')).json(); assert.equal(typeof h.demo, 'boolean');
});
test('/projekt redirects to /projekt/ and the page is served without <base>, with its CSP hash merged into the header', { skip: !built && 'landing not built (cd landing && npm run build)' }, async () => {
  const red = await fetch(S.base + '/projekt', { redirect: 'manual' }); assert.equal(red.status, 302); assert.equal(red.headers.get('location'), '/projekt/');
  const r = await fetch(S.base + '/projekt/'); assert.equal(r.status, 200); assert.match(r.headers.get('content-type'), /text\/html/);
  const html = await r.text();
  assert.doesNotMatch(html, /<base /); assert.doesNotMatch(html, /app\/base\.js/);
  assert.match(html, /<html lang="pl"/); assert.match(html, /<h1[^>]*>/, 'prerendered h1');
  const meta = /content-security-policy" content="([^"]+)"/.exec(html); assert.ok(meta, 'SvelteKit CSP meta present');
  for (const hash of meta[1].match(/'sha256-[^']+'/g)) assert.ok(r.headers.get('content-security-policy').includes(hash), 'header carries ' + hash);
  assert.match(r.headers.get('content-security-policy'), /script-src 'self' 'sha256-/);
  const en = await fetch(S.base + '/projekt/en/'); assert.equal(en.status, 200); assert.match(await en.text(), /<html lang="en"/);
  const st = await (await fetch(S.base + '/projekt/status.json')).json(); assert.equal(st.stories.total, 145); assert.equal(st.sections.length, 9); assert.equal(typeof st.run.clean, 'boolean');
});
test('an unknown path and a folder without its own index.html still fall back to the app shell', async () => {
  const r = await fetch(S.base + '/nie-ma-takiej-strony'); assert.equal(r.status, 200); assert.match(await r.text(), /<base href="\/">/);
  const d = await fetch(S.base + '/edmat/', { redirect: 'manual' }); assert.equal(d.status, 200); assert.match(await d.text(), /<div id="root">/);
});
test('under EDMAT_BASE_PATH the page lives at <base>/projekt/ and its relative asset links resolve', { skip: !built && 'landing not built' }, async () => {
  const B = await startServer({ basePath: '/dziennik' });
  try {
    const red = await fetch(B.base + '/dziennik/projekt', { redirect: 'manual' }); assert.equal(red.status, 302); assert.equal(red.headers.get('location'), '/dziennik/projekt/');
    const r = await fetch(B.base + '/dziennik/projekt/'); assert.equal(r.status, 200); const html = await r.text(); assert.doesNotMatch(html, /<base /);
    const css = /href="([^"]+\.css)"/.exec(html)[1]; assert.ok(css.startsWith('.'), 'relative stylesheet link: ' + css);
    const cssRes = await fetch(new URL(css, B.base + '/dziennik/projekt/')); assert.equal(cssRes.status, 200); assert.match(cssRes.headers.get('content-type'), /text\/css/);
    assert.equal((await fetch(B.base + '/projekt/')).status, 404, 'outside the base path nothing is served');
  } finally { await B.close(); }
});
