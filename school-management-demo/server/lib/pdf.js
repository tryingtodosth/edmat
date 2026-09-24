'use strict';
/* Real PDF output. The print-ready HTML the routes build (D.printHtml) is handed to a local headless Chromium,
   which prints it to A4 exactly as the browser's own "Print → PDF" would. When no Chromium is installed the
   caller keeps serving the HTML (see server/routes/pdf.js → 501 pdf_unavailable + fallbackUrl). Zero npm deps. */
const { execFile } = require('node:child_process');
const fs = require('node:fs'); const os = require('node:os'); const path = require('node:path');

/** Same candidates as scripts/screenshot.js, plus EDMAT_CHROME for a custom install. */
function candidates() {
  return [
    process.env.EDMAT_CHROME,
    path.join(os.homedir(), '.cache/ms-playwright/chromium_headless_shell-1234/chrome-headless-shell-linux64/chrome-headless-shell'),
    '/usr/bin/chromium',
    '/usr/bin/google-chrome',
    '/usr/bin/chromium-browser',
  ].filter(Boolean);
}
let cached; // undefined = not probed yet, null = none found
/** Absolute path of the headless Chromium, or null. Cached; reset() re-probes (tests). */
function chromePath() {
  if (cached === undefined) cached = candidates().find((p) => { try { return fs.statSync(p).isFile(); } catch (e) { return false; } }) || null;
  return cached;
}
function available() { return !!chromePath(); }
function reset() { cached = undefined; }

const TIMEOUT_MS = +(process.env.EDMAT_PDF_TIMEOUT || 30000);

/** renderPdf(html, { margin, timeout }) → Promise<Buffer>. Throws when no Chromium is available. */
function renderPdf(html, opts) {
  const o = opts || {};
  const chrome = chromePath();
  if (!chrome) return Promise.reject(Object.assign(new Error('Brak przeglądarki do generowania PDF.'), { code: 'pdf_unavailable' }));
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'edmat-pdf-'));
  const src = path.join(dir, 'doc.html'); const out = path.join(dir, 'doc.pdf');
  // The route templates already carry `@page{size:A4;margin:…}`; a caller-supplied margin wins because it comes last.
  const doc = o.margin ? String(html) + `<style>@page{margin:${String(o.margin).replace(/[^0-9a-z. ]/gi, '')}}</style>` : String(html);
  fs.writeFileSync(src, doc, 'utf8');
  const args = ['--headless', '--no-sandbox', '--disable-gpu', '--disable-dev-shm-usage', '--no-pdf-header-footer',
    '--user-data-dir=' + path.join(dir, 'profile'), '--print-to-pdf=' + out, 'file://' + src];
  return new Promise((resolve, reject) => {
    execFile(chrome, args, { timeout: o.timeout || TIMEOUT_MS, maxBuffer: 4 * 1024 * 1024 }, (err) => {
      let buf = null;
      try { if (fs.existsSync(out)) buf = fs.readFileSync(out); } catch (e) { /* fall through to the error below */ }
      try { fs.rmSync(dir, { recursive: true, force: true }); } catch (e) {}
      if (buf && buf.length > 4 && buf.slice(0, 4).toString('latin1') === '%PDF') return resolve(buf);
      reject(Object.assign(new Error('Nie udało się wygenerować PDF' + (err ? ': ' + (err.killed ? 'przekroczono limit czasu' : err.message) : '.')), { code: 'pdf_failed' }));
    });
  });
}
module.exports = { renderPdf, available, chromePath, reset, candidates };
