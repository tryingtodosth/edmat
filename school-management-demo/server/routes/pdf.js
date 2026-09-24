'use strict';
/* Generic "print-ready HTML → real PDF" wrapper.
   GET /api/pdf?path=/api/homeroom/print/attendance%3Fmonth%3D2026-10  → application/pdf
   GET /api/pdf?probe=1&path=…                                        → { available: true|false }

   The wrapper never bypasses a role guard: it re-runs the original request through the app's own HTTP stack
   (loopback to 127.0.0.1:<port> with the caller's Cookie), so exactly the same session, module and role checks
   apply, and a 403/404 from the inner route is passed through unchanged. Without a local Chromium the wrapper
   answers 501 { code:'pdf_unavailable', fallbackUrl } so the client opens the HTML instead. */
const { httpError } = require('../lib/router');
const pdf = require('../lib/pdf');

const MAX_HTML = 12 * 1024 * 1024;

function splitPath(raw) {
  const q = raw.indexOf('?');
  return { pathname: q < 0 ? raw : raw.slice(0, q), search: q < 0 ? '' : raw.slice(q) };
}
/** attendance.pdf from /api/homeroom/print/attendance, or the inner filename with a .pdf extension. */
function fileName(pathname, disposition) {
  const m = /filename="?([^";]+)"?/i.exec(disposition || '');
  let name = m ? m[1] : (pathname.split('/').filter(Boolean).pop() || 'wydruk');
  name = name.replace(/\.(html?|pdf)$/i, '').replace(/[^A-Za-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '') || 'wydruk';
  return name + '.pdf';
}

function register(r, app) {
  r.get('/api/pdf', async (ctx) => {
    const raw = String(ctx.query.path || '').trim();
    if (!raw) throw httpError(400, 'Brak parametru path.', { code: 'bad_path' });
    const base = app.basePath || '';
    const withoutBase = base && raw.startsWith(base + '/') ? raw.slice(base.length) : raw;
    const { pathname, search } = splitPath(withoutBase);
    if (!pathname.startsWith('/api/') || pathname.indexOf('..') >= 0) throw httpError(400, 'Parametr path musi wskazywać wydruk /api/….', { code: 'bad_path' });
    if (pathname === '/api/pdf') throw httpError(400, 'Nie można zagnieżdżać generatora PDF.', { code: 'bad_path' });
    const m = app.router.match('GET', pathname);
    if (!m || m.methodNotAllowed || !m.route) throw httpError(404, 'Nie znaleziono wydruku o tej ścieżce.', { code: 'unknown_path' });

    if (ctx.query.probe) return { available: pdf.available(), path: raw, fallbackUrl: raw };

    const addr = app.server && app.server.address();
    if (!addr || !addr.port) throw httpError(503, 'Serwer nie jest jeszcze gotowy.', { code: 'not_listening' });
    let res;
    try {
      res = await fetch(`http://127.0.0.1:${addr.port}${base}${pathname}${search}`, {
        // X-Forwarded-For keeps auth.ipOf() (IP allowlist, audit rows) on the real caller, not on 127.0.0.1.
        headers: Object.assign({ Cookie: ctx.req.headers.cookie || '', 'Accept-Language': ctx.req.headers['accept-language'] || 'pl' },
          ctx.ip ? { 'X-Forwarded-For': ctx.ip } : {}),
        redirect: 'manual',
      });
    } catch (e) { throw httpError(502, 'Nie udało się pobrać dokumentu do wydruku.', { code: 'fetch_failed' }); }
    const type = res.headers.get('content-type') || '';
    if (!res.ok) {
      let msg = 'Nie udało się pobrać dokumentu do wydruku.'; let extra = {};
      if (type.includes('application/json')) { const j = await res.json().catch(() => null); if (j) { msg = j.error || msg; extra = Object.assign({}, j); delete extra.error; } }
      throw httpError(res.status, msg, extra);
    }
    // The guard above runs first on purpose: a caller who may not see the document must get 403, not 501.
    if (!pdf.available()) { await res.arrayBuffer().catch(() => {}); throw httpError(501, 'Ten serwer nie ma przeglądarki do generowania PDF — otwórz wersję HTML i wydrukuj ją do PDF.', { code: 'pdf_unavailable', fallbackUrl: raw }); }
    if (!type.includes('text/html')) throw httpError(415, 'Ten zasób nie jest wydrukiem HTML.', { code: 'not_printable', contentType: type, fallbackUrl: raw });
    const html = await res.text();
    if (html.length > MAX_HTML) throw httpError(413, 'Dokument jest zbyt duży, aby wygenerować PDF.', { code: 'too_large', fallbackUrl: raw });

    let body;
    try { body = await pdf.renderPdf(html, { margin: ctx.query.margin }); }
    catch (e) { throw httpError(e.code === 'pdf_unavailable' ? 501 : 500, e.message, { code: e.code || 'pdf_failed', fallbackUrl: raw }); }
    return { __raw: true, contentType: 'application/pdf', inline: true, filename: fileName(pathname, res.headers.get('content-disposition')), body };
  });
}
module.exports = { register };
