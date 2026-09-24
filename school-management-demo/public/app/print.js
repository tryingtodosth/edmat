/* EdApp.openPrint(path): opens a server print-ready document as a real PDF when the server can render one
   (GET /api/pdf?path=…), and otherwise opens the print-ready HTML exactly as before. The availability probe is
   asked once per page load; the target tab is opened synchronously so pop-up blockers behave as they did. */
(function () {
  var A = window.EdApp;
  if (!A) return;
  var probing = null;

  function abs(p) { return (A.base || '') + p; }
  function pdfUrl(path) { return abs('/api/pdf?path=' + encodeURIComponent(path)); }

  /** Promise<boolean> — does this server render PDFs? Cached for the page's lifetime. */
  function pdfAvailable(path) {
    if (probing) return probing;
    probing = fetch(abs('/api/pdf?probe=1&path=' + encodeURIComponent(path || '/api/auth/session')), { credentials: 'same-origin' })
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (d) { return !!(d && d.available); })
      .catch(function () { return false; });
    return probing;
  }

  /** Open a print-ready document: PDF when available, otherwise the HTML the server already served. */
  function openPrint(path) {
    if (!path) return Promise.resolve(false);
    var w = window.open('', '_blank');
    return pdfAvailable(path).then(function (ok) {
      var url = ok ? pdfUrl(path) : abs(path);
      if (w && !w.closed) { try { w.location.replace(url); return ok; } catch (e) {} }
      window.open(url, '_blank', 'noopener');
      return ok;
    }).catch(function () {
      if (w && !w.closed) { try { w.location.replace(abs(path)); } catch (e) {} } else window.open(abs(path), '_blank', 'noopener');
      return false;
    });
  }

  A.openPrint = openPrint;
  A.pdfAvailable = pdfAvailable;
})();
