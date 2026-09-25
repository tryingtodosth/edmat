/* snapshot.js — the serverless engine behind edmat.net/dziennik.
 *
 * Loaded ONLY by the static build (scripts/build-static.js). When it is present it defines
 * `window.EdSnapshot`, and `core.js`'s single `rawFetch` hands every request here instead of to the
 * network. When it is absent — running the demo normally, `npm start` — nothing here exists and the
 * app talks to its real server exactly as before.
 *
 * WHAT THIS PAGE IS ALLOWED TO DO, in full:
 *
 *   GET  /api/...          answered from a recorded file. No logic, no store, no session.
 *   POST /api/report-issue translated and forwarded to the site's own /api/issues/ — SAME ORIGIN,
 *                          because the page is served from edmat.net. This is the one and only
 *                          request that leaves the browser.
 *   anything else          refused locally with `demo_read_only`. Nothing is queued, nothing is
 *                          retried, nothing is stored.
 *
 * Why refusing writes is the right shape rather than a limitation to apologise for: there is no
 * server to write to. A demo that faked a successful save would be lying about the one thing a
 * school most needs to trust, and a demo that queued the write would be holding a stranger's
 * invented pupil data in their browser for a sync that can never happen.
 *
 * The role is chosen, not authenticated. `/api/auth/session` is a recorded answer like any other,
 * so "signing in" is picking whose recording to read. There is no password to get wrong, no token
 * to steal and no privilege to escalate — the worst a visitor can do is read a different part of a
 * file that was public the moment it was published.
 */
(function () {
  'use strict';

  var DATA = window.__EDMAT_SNAPSHOT__;
  if (!DATA || !DATA.responses) return;   // no data baked in → leave the real fetch alone

  var ROLE_KEY = 'edmat.demo.role';
  var ROLES = DATA.logins || Object.keys(DATA.responses);

  /* Labels come from each role's own recorded session, so this list cannot drift from the data:
     a role with no recording simply is not offered. */
  function labelFor(login) {
    try {
      var s = DATA.responses[login]['/api/auth/session'];
      if (s && s.user) return (s.user.name || login) + ' — ' + (s.user.role || '');
    } catch (e) {}
    return login;
  }

  function storedRole() {
    var r = null;
    try { r = window.localStorage.getItem(ROLE_KEY); } catch (e) {}
    return (r && DATA.responses[r]) ? r : null;
  }
  /* `dyrektor` first: the head teacher sees the widest slice of the product, so somebody who opens
     the link cold lands on the most representative screen rather than one class's register. */
  var role = storedRole() || (DATA.responses['dyrektor'] ? 'dyrektor' : ROLES[0]);

  function setRole(next) {
    if (!DATA.responses[next]) return;
    try { window.localStorage.setItem(ROLE_KEY, next); } catch (e) {}
    window.location.reload();
  }

  /* --- the response shape core.js expects ------------------------------------------------------
     `rawFetch` returns {status, ok, data, headers} and callers use `headers.get(...)`, so the stub
     has to answer that too rather than hand back a bare object that throws two frames later. */
  function reply(status, data) {
    return { status: status, ok: status >= 200 && status < 300, data: data, headers: { get: function () { return 'application/json'; } } };
  }

  /* The issue report, translated into what `issues.Issue` accepts. The field names are the ones
     `server/routes/report-issue.js` used — mirrored here rather than imported, because that file is
     not shipped, and pinned by the note in it. `source` must stay 'school_demo': it is what tells
     whoever triages /issues which product the report came from. */
  function issuePayload(b) {
    return {
      kind: ['bug', 'content', 'idea', 'other'].indexOf(b.kind) >= 0 ? b.kind : 'bug',
      source: 'school_demo',
      area: b.area || '',
      title: String(b.title || '').slice(0, 200),
      body: String(b.body || '').slice(0, 4000),
      context: {
        path: b.screen || '', page_title: b.pageTitle || '', locale: b.locale === 'en' ? 'en' : 'pl',
        viewport: b.viewport || '', user_agent: String(navigator.userAgent || '').slice(0, 500),
        role: role
      },
      anonymous: !!b.anonymous,
      contact_email: b.anonymous ? '' : String(b.contact || '').slice(0, 200),
      is_public: !!b.isPublic
    };
  }

  async function forwardIssue(body) {
    try {
      var res = await fetch('/api/issues/', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(issuePayload(body || {}))
      });
      var text = await res.text();
      if (!res.ok) return reply(200, { ok: true, forwarded: false, forwardError: 'http_' + res.status, remoteId: null });
      var id = null;
      try { id = String(JSON.parse(text).id); } catch (e) {}
      return reply(200, { ok: true, forwarded: true, forwardError: null, remoteId: id });
    } catch (e) {
      /* The demo's own contract (§17BJ): failing to forward is not failing to report. Here there is
         nowhere local to keep it, so this says so honestly rather than claiming a save. */
      return reply(200, { ok: true, forwarded: false, forwardError: 'unreachable', remoteId: null });
    }
  }

  var READ_ONLY = {
    error: 'To jest zapisana wersja demonstracyjna — dane są wpisane na stałe i nic się w niej nie zapisuje. Pełna wersja zapisuje wszystko normalnie.',
    code: 'demo_read_only'
  };
  var NOT_RECORDED = {
    error: 'Tego ekranu nie ma w zapisanej wersji demo. Pełna wersja pokazuje go normalnie.',
    code: 'snapshot_miss'
  };

  var misses = [];

  function handle(method, path, body) {
    if (method === 'POST' && path === '/api/report-issue') return forwardIssue(body);
    if (method !== 'GET') return Promise.resolve(reply(405, READ_ONLY));

    var bucket = DATA.responses[role] || {};
    if (path in bucket) {
      var rec = bucket[path];
      /* A recorded REFUSAL is replayed as the refusal it was. A 200 is stored as its bare body;
         anything else is wrapped, because the status is the answer. Without this, "this role may
         not see that" arrived as "not recorded in this demo", which blames the snapshot for the
         product behaving exactly as designed — the student really is refused the staff events
         list, and the demo should show that rather than hide it. */
      if (rec && typeof rec === 'object' && typeof rec.__status === 'number') return Promise.resolve(reply(rec.__status, rec.__data));
      return Promise.resolve(reply(200, rec));
    }
    /* A recorded answer for the same endpoint under a different role is NOT served as a fallback:
       that is precisely how a demo would show one person another person's pupils. A miss stays a
       miss. */
    if (misses.indexOf(path) < 0) { misses.push(path); if (window.console) console.info('[demo snapshot] not recorded:', method, path); }
    return Promise.resolve(reply(501, NOT_RECORDED));
  }

  /* --- the strip ------------------------------------------------------------------------------
     Says what this is and lets a visitor change role. Built in plain DOM rather than through the
     app's React, because it has to be there even if a screen fails to render. */
  function mountBar() {
    var bar = document.createElement('div');
    bar.setAttribute('data-demo-bar', '');
    bar.style.cssText = 'position:sticky;top:0;z-index:99999;display:flex;gap:.75rem;align-items:center;flex-wrap:wrap;'
      + 'padding:.5rem .75rem;background:#24603f;color:#fff;font:500 13px/1.4 system-ui,sans-serif';

    var label = document.createElement('span');
    label.textContent = 'Wersja demonstracyjna — dane przykładowe, nic się nie zapisuje.';
    label.style.cssText = 'flex:1 1 auto;min-width:12rem';

    var who = document.createElement('label');
    who.style.cssText = 'display:flex;gap:.4rem;align-items:center';
    var whoText = document.createElement('span');
    whoText.textContent = 'Zobacz jako';
    var sel = document.createElement('select');
    sel.style.cssText = 'font:inherit;padding:.15rem .3rem;border-radius:.25rem;border:1px solid rgba(255,255,255,.5);background:#fff;color:#111;max-width:18rem';
    ROLES.forEach(function (r) {
      var o = document.createElement('option');
      o.value = r; o.textContent = labelFor(r); if (r === role) o.selected = true;
      sel.appendChild(o);
    });
    sel.addEventListener('change', function () { setRole(sel.value); });
    who.appendChild(whoText); who.appendChild(sel);

    var back = document.createElement('a');
    back.href = '/';
    back.textContent = '← EdMat';
    back.style.cssText = 'color:#fff;text-decoration:underline;white-space:nowrap';

    bar.appendChild(label); bar.appendChild(who); bar.appendChild(back);
    document.body.insertBefore(bar, document.body.firstChild);
  }

  /* The service worker caches API responses for offline use. With no server there is nothing to be
     offline FROM, and a stale cache from an earlier visit would answer over the snapshot — so any
     worker registered for this scope is removed rather than trusted. */
  function dropServiceWorker() {
    try {
      if (!navigator.serviceWorker) return;
      navigator.serviceWorker.getRegistrations().then(function (rs) { rs.forEach(function (r) { r.unregister(); }); }).catch(function () {});
    } catch (e) {}
  }

  window.EdSnapshot = {
    handle: handle, role: role, roles: ROLES, setRole: setRole,
    recordedAt: DATA.recordedAt, misses: misses
  };

  dropServiceWorker();
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', mountBar);
  else mountBar();
})();
