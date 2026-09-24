#!/usr/bin/env node
/* Headless screenshot of a screen as a given demo user. Uses the Playwright chromium shell if present. */
'use strict';
const { spawn, spawnSync } = require('node:child_process'); const path = require('node:path'); const fs = require('node:fs'); const os = require('node:os');
const [login, hash, out, width] = process.argv.slice(2);
if (!login || !out) { console.error('usage: screenshot.js <login> <#path|-> <out.png> [width] [height]'); process.exit(1); }
const chrome = [path.join(os.homedir(), '.cache/ms-playwright/chromium_headless_shell-1234/chrome-headless-shell-linux64/chrome-headless-shell'), '/usr/bin/chromium', '/usr/bin/google-chrome'].find((p) => fs.existsSync(p));
if (!chrome) { console.error('no headless chromium found'); process.exit(2); }
const port = 41000 + Math.floor(Math.random() * 20000);
const logFile = fs.openSync(path.resolve(out) + '.log', 'w');
const srv = spawn(process.execPath, [path.join(__dirname, '..', 'server', 'index.js')], { env: Object.assign({}, process.env, { EDMAT_DEV: '1', EDMAT_LOG: '1', PORT: String(port), EDMAT_DATA: fs.mkdtempSync(path.join(os.tmpdir(), 'edmat-')) }), stdio: ['ignore', logFile, logFile] });
const ready = async () => { for (let i = 0; i < 80; i++) { try { const r = await fetch(`http://127.0.0.1:${port}/api/auth/policy`); if (r.ok) return; } catch (e) {} await new Promise((r) => setTimeout(r, 500)); } };
ready().then(() => {
  const url = login === '-' ? `http://127.0.0.1:${port}/${hash && hash !== '-' ? hash : ''}` : `http://127.0.0.1:${port}/api/dev/login?as=${encodeURIComponent(login)}${hash && hash !== '-' ? '&to=' + encodeURIComponent(hash.replace(/^#/, '')) : ''}`;
  const r = spawnSync(chrome, ['--headless', '--no-sandbox', '--disable-gpu', '--hide-scrollbars', '--run-all-compositor-stages-before-draw', '--virtual-time-budget=' + (process.env.SHOT_BUDGET || '30000'), `--window-size=${width || 1100},${process.argv[6] || 1600}`, `--screenshot=${path.resolve(out)}`, url], { encoding: 'utf8', timeout: 90000 });
  srv.kill(); console.log(r.status === 0 ? 'saved ' + out : 'chrome failed: ' + r.stderr.slice(-400));
});
