#!/usr/bin/env node
/* top-up-snapshot.js — add specific (role, path) answers to an existing snapshot.
 *
 *   node scripts/top-up-snapshot.js "anna.kowalczyk=/api/events" [more...]
 *
 * `verify-static.js` reports a miss as `role` + `path`. Healing that with a full re-record costs
 * twenty minutes and re-rolls every other answer for one gap; this asks the server the one question
 * that was missed and merges the answer in. No browser: a miss is a known URL, and the only thing a
 * browser was ever needed for was DISCOVERING which URLs a screen asks for.
 *
 * A gap happens when a screen asks for something after the recorder's settle window — a panel that
 * loads late, or one behind a tab that was never opened. Raising `--settle` reduces it and cannot
 * eliminate it, because "how long is long enough" is not a question with an answer.
 */
'use strict';
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const SNAP = path.join(ROOT, 'public', 'demo-snapshot.json');
const FROZEN_TODAY = '2026-10-23';   // must match record-snapshot.js, or the answers disagree

const pairs = process.argv.slice(2).filter((a) => a.includes('=')).map((a) => {
  const i = a.indexOf('=');
  return { role: a.slice(0, i), path: a.slice(i + 1) };
});
if (!pairs.length) { console.error('usage: top-up-snapshot.js "<role>=<path>" [...]'); process.exit(2); }

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  if (!fs.existsSync(SNAP)) { console.error(`no snapshot at ${SNAP}`); process.exit(2); }
  const snap = JSON.parse(fs.readFileSync(SNAP, 'utf8'));
  const port = 41500 + Math.floor(Math.random() * 6000);
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'edmat-top-'));
  const srv = spawn(process.execPath, [path.join(ROOT, 'server', 'index.js')], {
    cwd: ROOT,
    env: Object.assign({}, process.env, {
      PORT: String(port), EDMAT_DATA: dataDir, EDMAT_DEV: '1',
      EDMAT_TODAY: FROZEN_TODAY, EDMAT_ISSUES_FORWARD: '0',
    }),
    stdio: ['ignore', 'ignore', 'ignore'],
  });
  let up = false;
  for (let i = 0; i < 150 && !up; i++) {
    try { up = (await fetch(`http://127.0.0.1:${port}/api/auth/policy`)).ok; } catch (e) { await sleep(200); }
  }
  if (!up) { srv.kill(); console.error('server did not start'); process.exit(2); }

  let added = 0;
  for (const { role, path: p } of pairs) {
    /* `redirect: 'manual'` so the dev-login's 302 hands back its Set-Cookie instead of being
       followed into the shell HTML, which carries no session. */
    const login = await fetch(`http://127.0.0.1:${port}/api/dev/login?as=${encodeURIComponent(role)}&to=/`, { redirect: 'manual' });
    const cookie = (login.headers.getSetCookie?.() || []).map((c) => c.split(';')[0]).join('; ');
    if (!cookie) { console.error(`  ${role}: dev-login returned no cookie (is EDMAT_DEV=1 honoured?)`); continue; }
    const res = await fetch(`http://127.0.0.1:${port}${p}`, { headers: { cookie } });
    const body = await res.text();
    if (!res.ok && !(res.status >= 400 && res.status < 500)) { console.error(`  ${role} ${p}: HTTP ${res.status} — not added`); continue; }
    let parsed;
    try { parsed = JSON.parse(body); } catch (e) { console.error(`  ${role} ${p}: not JSON — not added`); continue; }
    snap.responses[role] = snap.responses[role] || {};
    // A refusal is an answer: stored with its status so the page reproduces it (see snapshot.js).
    snap.responses[role][p] = res.ok ? parsed : { __status: res.status, __data: parsed };
    if (!snap.logins.includes(role)) snap.logins.push(role);
    added++;
    console.log(`  ${role} ${p}: added as HTTP ${res.status} (${body.length} bytes)`);
  }
  srv.kill();
  if (added) {
    snap.toppedUpAt = new Date().toISOString();
    fs.writeFileSync(SNAP, JSON.stringify(snap));
    const total = snap.logins.reduce((a, l) => a + Object.keys(snap.responses[l] || {}).length, 0);
    console.log(`\nwrote ${path.relative(ROOT, SNAP)} — ${snap.logins.length} roles, ${total} responses, ${Math.round(fs.statSync(SNAP).size / 1024)} KB`);
  }
  process.exit(added === pairs.length ? 0 : 1);
})().catch((e) => { console.error(e); process.exit(1); });
