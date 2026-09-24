/* EdApp core: API client with offline queue, session handling, hash router, screen registry, small hooks. Classic script; no build step. */
(function () {
  var React = window.React, h = React.createElement;
  var listeners = new Set();
  var BASE = window.EDMAT_BASE || '';
  var I = window.EdI18n;
  var state = { user: null, config: null, screens: [], route: parseHash(), online: navigator.onLine, queue: [], queueUser: null, unclaimedQueue: 0, queueRejected: [], syncing: false, syncError: null, lastSync: null, toasts: [], remainingSeconds: null, totpRequired: false, mustChangePassword: false, signedOutReason: null, locale: I ? I.get() : 'pl', modules: {}, demo: null };
  function setState(patch) { Object.assign(state, patch); listeners.forEach(function (l) { l(state); }); }
  function parseHash() { var hsh = location.hash.replace(/^#/, '') || '/'; var q = {}; var qi = hsh.indexOf('?'); var path = hsh; if (qi >= 0) { path = hsh.slice(0, qi); hsh.slice(qi + 1).split('&').forEach(function (kv) { var p = kv.split('='); if (p[0]) q[decodeURIComponent(p[0])] = decodeURIComponent(p[1] || ''); }); } return { path: path, query: q }; }
  window.addEventListener('hashchange', function () { setState({ route: parseHash() }); });
  function navigate(path, query) { var qs = query ? '?' + Object.keys(query).map(function (k) { return encodeURIComponent(k) + '=' + encodeURIComponent(query[k]); }).join('&') : ''; location.hash = path + qs; }

  /* ---------- offline queue (writes made while offline are replayed in order, per user) ----------
     localStorage is per BROWSER, not per user. On a shared classroom PC an unkeyed queue meant that
     teacher A's unsent attendance was replayed inside teacher B's session and saved under B's name.
     So: one queue per account (`edmat.queue.<userId>`), every item carries its author, and nothing is
     ever replayed for anyone else. A queue left by an older build (unkeyed `edmat.queue`) has no known
     author — it is moved to `edmat.queue.__unclaimed` and replayed only if a signed-in user claims it.
     Replay is last-write-wins on the server: each item carries the client `at` of the moment the
     teacher pressed save, and the server keeps the newest client-stamped write (attendance.js). */
  var QUEUE_PREFIX = 'edmat.queue.', LEGACY_QUEUE_KEY = 'edmat.queue', UNCLAIMED_QUEUE_KEY = 'edmat.queue.__unclaimed';
  function lsGet(k) { try { return JSON.parse(localStorage.getItem(k) || '[]'); } catch (e) { return []; } }
  function lsSet(k, v) { try { if (v && v.length) localStorage.setItem(k, JSON.stringify(v)); else localStorage.removeItem(k); } catch (e) {} }
  function queueKey(userId) { return userId ? QUEUE_PREFIX + userId : null; }
  function loadQueue(userId) { var k = queueKey(userId); return k ? lsGet(k).filter(function (it) { return !it.userId || it.userId === userId; }) : []; }
  function saveQueue(q) { var k = queueKey(state.queueUser); if (k) lsSet(k, q); setState({ queue: q }); }
  /** Moves a queue written by a pre-keying build out of the way; its author cannot be established. */
  function stashLegacyQueue() {
    var old = lsGet(LEGACY_QUEUE_KEY);
    if (old.length) lsSet(UNCLAIMED_QUEUE_KEY, lsGet(UNCLAIMED_QUEUE_KEY).concat(old));
    try { localStorage.removeItem(LEGACY_QUEUE_KEY); } catch (e) {}
  }
  /** Binds the queue to the signed-in account. Call with null on logout. */
  function setQueueUser(userId) {
    stashLegacyQueue();
    var uid = userId || null;
    state.queueUser = uid;
    setState({ queueUser: uid, queue: loadQueue(uid), unclaimedQueue: lsGet(UNCLAIMED_QUEUE_KEY).length });
    if (uid && state.online) flushQueue();
  }
  /** Explicit rescue of an unattributable queue: the signed-in user takes responsibility for it. */
  function adoptUnclaimedQueue() {
    var un = lsGet(UNCLAIMED_QUEUE_KEY); if (!un.length || !state.queueUser) return 0;
    var owner = state.queueUser;
    saveQueue(state.queue.concat(un.map(function (it) { return Object.assign({}, it, { userId: owner, adopted: true }); })));
    lsSet(UNCLAIMED_QUEUE_KEY, []); setState({ unclaimedQueue: 0 }); flushQueue(); return un.length;
  }
  /** Appends a write to the signed-in user's queue. Returns null when there is nobody to attribute it to. */
  function enqueue(method, path, body, opts) {
    if (!state.queueUser) return null;
    saveQueue(state.queue.concat([{ id: Date.now() + Math.random().toString(16).slice(2), userId: state.queueUser, method: method, path: path, body: body, at: new Date().toISOString(), label: (opts && opts.label) || path }]));
    return { queued: true };
  }
  async function flushQueue() {
    if (!state.online || state.syncing || !state.queue.length) return;
    var owner = state.queueUser;
    /* Never replay one account's writes inside another's session. */
    if (!owner || !state.user || state.user.id !== owner) return;
    setState({ syncing: true, syncError: null });
    var q = state.queue.slice(); var rejected = [];
    while (q.length) {
      if (state.queueUser !== owner) { setState({ syncing: false }); return; }
      var item = q[0];
      if (item.userId && item.userId !== owner) { q.shift(); saveQueue(q); continue; }
      try {
        var r = await rawFetch(item.method, item.path, item.body);
        if (r.status >= 500 || r.status === 0) throw new Error('server');
        /* 4xx means the server will never accept this write (locked semester, no longer the lesson's
           teacher, a student who left). Dropping it silently loses a teacher's entry without a word,
           so it leaves the queue and is reported. */
        if (r.status >= 400) rejected.push({ item: item, status: r.status, error: (r.data && r.data.error) || null });
        q.shift(); saveQueue(q);
      } catch (e) { setState({ syncing: false, syncError: t('shell.syncFail') }); return; }
    }
    setState({ syncing: false, lastSync: new Date(), queueRejected: state.queueRejected.concat(rejected) });
    if (rejected.length) toast(t('shell.syncRejected', { n: rejected.length, first: rejected[0].item.label }), 'danger');
    else toast(t('shell.synced'), 'success');
  }
  stashLegacyQueue();
  setState({ unclaimedQueue: lsGet(UNCLAIMED_QUEUE_KEY).length });
  window.addEventListener('online', function () { setState({ online: true }); flushQueue(); });
  window.addEventListener('offline', function () { setState({ online: false }); });

  /* ---------- API ---------- */
  async function rawFetch(method, path, body) {
    var res = await fetch(BASE + path, { method: method, credentials: 'same-origin', headers: body != null ? { 'Content-Type': 'application/json' } : {}, body: body != null ? JSON.stringify(body) : undefined });
    var ct = res.headers.get('content-type') || ''; var data = null;
    if (ct.indexOf('application/json') >= 0) data = await res.json(); else data = await res.text();
    return { status: res.status, ok: res.ok, data: data, headers: res.headers };
  }
  /** api(method, path, body, {queueable:true}) → data; throws {status, message, data} */
  async function api(method, path, body, opts) {
    opts = opts || {};
    var r;
    try { r = await rawFetch(method, path, body); }
    catch (e) { if (opts.queueable) { var qd = enqueue(method, path, body, opts); if (qd) { setState({ online: false }); return qd; } } throw { status: 0, message: t('shell.noNet'), offline: true }; }
    if (r.status === 503 && r.data && r.data.offline) { if (opts.queueable) { var qd2 = enqueue(method, path, body, opts); if (qd2) return qd2; } throw { status: 0, message: t('shell.offlineNoData'), offline: true }; }
    /* A sign-out has a reason and the login card has to be able to say it (usability m4/P2): the
       15-minute timeout, the user's own "Wyloguj", or a session the server revoked under us (a
       blocked account, a password changed elsewhere). A toast that lasts 8 s is not an explanation. */
    if (r.status === 401 && r.data && (r.data.code === 'session_expired' || r.data.code === 'unauthenticated')) { if (state.user) { setState({ user: null, signedOutReason: r.data.code === 'session_expired' ? 'timeout' : 'blocked' }); if (r.data.code === 'session_expired') toast(t('shell.sessionExpired'), 'danger'); } throw { status: 401, message: r.data.error, data: r.data }; }
    if (r.status === 401 && r.data && r.data.code === 'totp_required') { setState({ totpRequired: true }); throw { status: 401, message: r.data.error, data: r.data }; }
    if (r.status === 403 && r.data && r.data.code === 'password_change_required') { setState({ mustChangePassword: true }); throw { status: 403, message: r.data.error, data: r.data }; }
    if (!r.ok) throw { status: r.status, message: (r.data && r.data.error) || ('Błąd ' + r.status), data: r.data };
    return r.data;
  }
  var apiObj = { get: function (p) { return api('GET', p); }, post: function (p, b, o) { return api('POST', p, b, o); }, put: function (p, b, o) { return api('PUT', p, b, o); }, patch: function (p, b, o) { return api('PATCH', p, b, o); }, delete: function (p, b, o) { return api('DELETE', p, b, o); }, raw: rawFetch };

  /* ---------- session ---------- */
  async function loadSession() { try { var s = await api('GET', '/api/auth/session'); if (s.user && s.user.locale && s.user.locale !== state.locale) setLocale(s.user.locale, true); setQueueUser(s.user && s.user.id); swSession(s.user && s.user.id); setState({ user: s.user, config: s.config, remainingSeconds: s.remainingSeconds, totpRequired: s.totpRequired, mustChangePassword: s.mustChangePassword, pendingAnnouncement: s.pendingAnnouncement || null, demo: s.demo && s.demo.enabled ? s.demo : (s.config && s.config.demo && s.config.demo.enabled ? s.config.demo : null) }); if (s.user) setState({ signedOutReason: null }); return s; } catch (e) { setQueueUser(null); swSession(null); setState({ user: null }); return null; } }
  async function login(loginName, password) { setState({ signedOutReason: null }); var r = await api('POST', '/api/auth/login', { login: loginName, password: password, client: /Mobi|Android/i.test(navigator.userAgent) ? 'mobile' : 'web' }); await loadSession(); return r; }
  /** Drops the offline copies of API responses held by the service worker (shared computers). */
  function purgeOfflineCache() { try { if (navigator.serviceWorker && navigator.serviceWorker.controller) navigator.serviceWorker.controller.postMessage({ type: 'logout' }); } catch (e) {} }
  /** Tells the worker whose cache it is now writing (REL-18 / S-09): the API cache is named after the
      account, other accounts' caches are dropped on a switch, and with no account nothing is cached. */
  function swSession(userId) {
    try {
      var sw = navigator.serviceWorker; if (!sw) return;
      var msg = { type: 'session', userId: userId || null, locale: state.locale };
      if (sw.controller) sw.controller.postMessage(msg);
      if (sw.ready && sw.ready.then) sw.ready.then(function (reg) { if (reg && reg.active && reg.active !== sw.controller) reg.active.postMessage(msg); }).catch(function () {});
    } catch (e) {}
  }
  async function logout() { try { await api('POST', '/api/auth/logout'); } catch (e) {} purgeOfflineCache(); swSession(null); setQueueUser(null); setState({ user: null, totpRequired: false, mustChangePassword: false, signedOutReason: 'logout' }); navigate('/'); }
  function touch() { return api('POST', '/api/auth/touch').then(function () { return loadSession(); }); }
  setInterval(function () { if (state.user) api('GET', '/api/auth/session').then(function (s) { setState({ remainingSeconds: s.remainingSeconds }); }).catch(function () {}); }, 30000);

  /* ---------- toasts ---------- */
  var toastId = 0;
  function toast(text, tone, action) { var t = { id: ++toastId, text: text, tone: tone || 'neutral', action: action }; setState({ toasts: state.toasts.concat([t]) }); setTimeout(function () { dismissToast(t.id); }, 8000); return t.id; }
  function dismissToast(idv) { setState({ toasts: state.toasts.filter(function (t) { return t.id !== idv; }) }); }

  /* ---------- screens registry ---------- */
  /** EdApp.screen({ id, path:'/oceny', title, roles:['teacher'], nav:{label, order, section?}, component }) */
  function screen(def) { state.screens.push(def); state.screens.sort(function (a, b) { return ((a.nav && a.nav.order) || 999) - ((b.nav && b.nav.order) || 999); }); }
  function setModules(m) { state.modules = m || {}; }
  function moduleEnabled(id) { return !id || state.modules[id] !== false; }
  function screensFor(user) { return state.screens.filter(function (s) { return moduleEnabled(s.module) && (!s.roles || s.roles.indexOf(user.role) >= 0 || (s.roles.indexOf('homeroom') >= 0 && user.homeroomOf) || (s.roles.indexOf('staff') >= 0 && ['student', 'parent'].indexOf(user.role) < 0)); }); }
  function matchScreen(user, path) { var list = screensFor(user); return list.find(function (s) { return s.path === path; }) || list.find(function (s) { return s.match && s.match(path); }) || null; }

  /* ---------- hooks ---------- */
  function useAppState() { var st = React.useState(state); React.useEffect(function () { var l = function (s) { st[1](Object.assign({}, s)); }; listeners.add(l); return function () { listeners.delete(l); }; }, []); return st[0]; }
  /** useApi(path, deps) → {data, error, loading, reload} */
  function useApi(path, deps) { var st = React.useState({ data: null, error: null, loading: !!path }); var tick = React.useState(0); var load = React.useCallback(function () { if (!path) return; st[1](function (s) { return Object.assign({}, s, { loading: true }); }); api('GET', path).then(function (d) { st[1]({ data: d, error: null, loading: false }); }).catch(function (e) { st[1]({ data: null, error: e, loading: false }); }); }, [path].concat(deps || [])); React.useEffect(function () { load(); }, [load, tick[0]]); return { data: st[0].data, error: st[0].error, loading: st[0].loading, reload: function () { tick[1](function (x) { return x + 1; }); } }; }

  /* ---------- keyboard shortcuts (Alt+1..9 sections, ? list, / search, Ctrl+S save) ---------- */
  var shortcutHandlers = {};
  /* m13 — Ctrl+S used to belong to whichever card registered it (the attendance roster), so a
     teacher typing the lesson topic saved *attendance* instead. A handler may now name the card
     it belongs to; the one containing the focus wins, and the screen-wide handler is the default. */
  var saveScopes = [];
  document.addEventListener('keydown', function (e) {
    var tag = (e.target.tagName || '').toLowerCase(); var typing = tag === 'input' || tag === 'textarea' || tag === 'select' || e.target.isContentEditable;
    if (e.altKey && !e.ctrlKey && /^[1-9]$/.test(e.key) && state.user) { var navs = screensFor(state.user).filter(function (s) { return s.nav; }); var s = navs[+e.key - 1]; if (s) { e.preventDefault(); navigate(s.path); } return; }
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
      var fn = null;
      for (var si = saveScopes.length - 1; si >= 0 && !fn; si--) { var el = saveScopes[si].ref && saveScopes[si].ref.current; if (el && el.contains && el.contains(e.target)) fn = saveScopes[si].fn; }
      if (!fn) fn = shortcutHandlers.save;
      if (fn) { e.preventDefault(); fn(); } return;
    }
    if (typing) return;
    if (e.key === '?' ) { e.preventDefault(); setState({ showShortcuts: !state.showShortcuts }); }
    if (e.key === '/') { var s2 = document.querySelector('[data-app-search]'); if (s2) { e.preventDefault(); s2.focus(); } }
  });
  /** onSave(fn) binds Ctrl+S for the screen; onSave(fn, ref) only while the focus is inside ref's element. */
  function onSave(fn, ref) {
    React.useEffect(function () {
      if (ref) { var entry = { fn: fn, ref: ref }; saveScopes.push(entry); return function () { var i = saveScopes.indexOf(entry); if (i >= 0) saveScopes.splice(i, 1); }; }
      shortcutHandlers.save = fn; return function () { if (shortcutHandlers.save === fn) delete shortcutHandlers.save; };
    }, [fn, ref]);
  }

  /* ---------- powiadomienia push (Web Push, RFC 8030/8291) ----------
     Cała kryptografia jest po stronie szkolnego serwera (server/lib/webpush.js); przeglądarka
     dokłada tylko subskrypcję: adres endpointu usługi push i dwa klucze (p256dh, auth), którymi
     serwer szyfruje ładunek. Dostawca przeglądarki przenosi wyłącznie szyfrogram — docs/PUSH.md.
     Bez zgody na powiadomienia i bez włączenia push w szkole nic się nie dzieje. */
  function b64ToBytes(b64) { var s = String(b64 || '').replace(/-/g, '+').replace(/_/g, '/'); s += new Array((4 - (s.length % 4)) % 4 + 1).join('='); var raw = atob(s); var out = new Uint8Array(raw.length); for (var i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i); return out; }
  function bytesToB64(buf) { var b = new Uint8Array(buf || 0); var s = ''; for (var i = 0; i < b.length; i++) s += String.fromCharCode(b[i]); return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''); }
  function pushSupported() { try { return !!(navigator.serviceWorker && window.PushManager && window.Notification); } catch (e) { return false; } }
  function pushPermission() { try { return window.Notification ? window.Notification.permission : 'unsupported'; } catch (e) { return 'unsupported'; } }
  function swReady() { return navigator.serviceWorker.ready; }
  /** Bieżąca subskrypcja tej przeglądarki albo null (także gdy worker jeszcze nie wstał). */
  function currentSubscription() { return swReady().then(function (reg) { return reg.pushManager.getSubscription(); }).catch(function () { return null; }); }
  /** status() → {supported, permission, schoolEnabled, subscribed, endpoint} — nic nie zmienia. */
  function pushStatus() {
    var out = { supported: pushSupported(), permission: pushPermission(), schoolEnabled: false, subscribed: false, endpoint: null, publicKey: null };
    return api('GET', '/api/push/vapid-public-key').catch(function () { return {}; }).then(function (k) {
      out.schoolEnabled = !!(k && k.enabled); out.publicKey = (k && k.publicKey) || null;
      if (!out.supported || !out.schoolEnabled) return out;   // bez włączonego push nie budzimy workera
      return currentSubscription().then(function (sub) { if (sub) { out.subscribed = true; out.endpoint = sub.endpoint; } return out; });
    });
  }
  /** subscribe() — pyta o zgodę, tworzy subskrypcję i oddaje ją szkolnemu serwerowi. */
  function pushSubscribe() {
    if (!pushSupported()) return Promise.reject({ status: 0, message: t('push.unsupported') });
    return api('GET', '/api/push/vapid-public-key').then(function (k) {
      if (!k || !k.enabled || !k.publicKey) throw { status: 409, message: t('push.schoolOff') };
      return window.Notification.requestPermission().then(function (perm) {
        if (perm !== 'granted') throw { status: 0, message: t('push.denied'), permission: perm };
        return swReady().then(function (reg) {
          return reg.pushManager.getSubscription().then(function (sub) {
            return sub || reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64ToBytes(k.publicKey) });
          });
        });
      }).then(function (sub) {
        var json = (sub.toJSON && sub.toJSON()) || {};
        var keys = json.keys && json.keys.p256dh ? json.keys : { p256dh: bytesToB64(sub.getKey('p256dh')), auth: bytesToB64(sub.getKey('auth')) };
        return api('POST', '/api/push/subscribe', { endpoint: sub.endpoint, keys: keys, userAgent: String(navigator.userAgent || '').slice(0, 120) })
          .then(function (r) { return Object.assign({ endpoint: sub.endpoint }, r); });
      });
    });
  }
  /** unsubscribe() — zdejmuje subskrypcję w przeglądarce i kasuje ją na serwerze. */
  function pushUnsubscribe() {
    var endpoint = null;
    return currentSubscription().then(function (sub) {
      if (!sub) return null;
      endpoint = sub.endpoint;
      return sub.unsubscribe().catch(function () { return null; });
    }).then(function () { return api('DELETE', '/api/push/subscribe', endpoint ? { endpoint: endpoint } : {}); });
  }
  function pushTest() { return api('POST', '/api/push/test', {}); }
  /* Przeglądarka bywa, że sama wymienia subskrypcję (rotacja kluczy). Worker daje znać stronie,
     a strona rejestruje nową — stara i tak odpowie 410 i zniknie z bazy. */
  try {
    if (navigator.serviceWorker && navigator.serviceWorker.addEventListener) {
      navigator.serviceWorker.addEventListener('message', function (e) {
        if (e && e.data && e.data.type === 'push-subscription-change' && state.user && pushPermission() === 'granted') pushSubscribe().catch(function () {});
      });
    }
  } catch (e) {}
  var pushApi = { supported: pushSupported, permission: pushPermission, status: pushStatus, subscribe: pushSubscribe, unsubscribe: pushUnsubscribe, test: pushTest };

  /* ---------- formatting helpers shared by screens ---------- */
  function fmtDate(iso) { return I ? I.fmtDate(iso) : String(iso || '').slice(0, 10); }
  function fmtDateTime(iso) { if (!iso) return ''; var d = new Date(iso); return fmtDate(d.toISOString()) + ' ' + String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0'); }
  /** The browser's own calendar day as ISO. `new Date().toISOString().slice(0,10)` is UTC, i.e. still
      yesterday in Warsaw between midnight and 02:00 — the client half of REL-08/09. */
  function isoToday(d) { var x = d ? new Date(d) : new Date(); return new Date(x.getTime() - x.getTimezoneOffset() * 60000).toISOString().slice(0, 10); }
  /* Native date/time pickers render in the BROWSER's locale, never in document.lang, and no page can
     override that (usability M4/P3). So every native field states the expected format and echoes the
     chosen value back in the UI locale; `kind` is 'date' (default), 'time' or 'datetime'. */
  function dateMask(kind) { return t(kind === 'time' ? 'common.timeMask' : kind === 'datetime' ? 'common.dateTimeMask' : 'common.dateMask'); }
  function dateHint(value, kind) {
    var mask = dateMask(kind);
    var shown = !value ? '' : kind === 'time' ? String(value).slice(0, 5) : kind === 'datetime' ? fmtDateTime(value) : fmtDate(value);
    return shown ? t('common.dateHint', { mask: mask, d: shown }) : t('common.dateHintEmpty', { mask: mask });
  }
  /** Props every native date/time input gets: the UI language and the expected format as a placeholder. */
  function dateInputProps(kind) { return { lang: I ? I.get() : 'pl', placeholder: dateMask(kind) }; }
  function fmtNum(v, digits) { return I ? I.fmtNum(v, digits) : String(v); }
  function fmtPct(v) { return I ? I.fmtPct(v) : String(v); }
  function fmtMoney(v) { return I ? I.fmtMoney(v) : String(v); }
  function t(key, vars) { return I ? I.t(key, vars) : key; }
  function plural(n, key) { return I ? I.plural(n, key) : n + ' ' + key; }
  function subjectName(id, fallback) { var k = 'subject.' + id; var v = t(k); return v === k ? (fallback || id) : v; }
  function setLocale(l, silent) { var loc = I ? I.set(l) : l; if (!silent && state.user) api('POST', '/api/auth/locale', { locale: loc }).catch(function () {}); setState({ locale: loc }); swSession(state.user && state.user.id); }
  function studentName(s) { return s ? (s.rollNo ? s.rollNo + '. ' : '') + s.lastName + ' ' + s.firstName : ''; }
  function userName(u) { return u ? ((u.title ? u.title + ' ' : '') + u.firstName + ' ' + u.lastName) : ''; }
  function setTheme(t) { document.documentElement.dataset.theme = t; try { localStorage.setItem('edmat.theme', t); } catch (e) {} setState({ theme: t }); }

  window.EdApp = { t: t, plural: plural, subjectName: subjectName, setLocale: setLocale, setModules: setModules, moduleEnabled: moduleEnabled, base: BASE, state: state, setState: setState, subscribe: function (l) { listeners.add(l); return function () { listeners.delete(l); }; }, api: apiObj, navigate: navigate, screen: screen, screensFor: screensFor, matchScreen: matchScreen, useAppState: useAppState, useApi: useApi, onSave: onSave, toast: toast, dismissToast: dismissToast, loadSession: loadSession, login: login, logout: logout, setQueueUser: setQueueUser, adoptUnclaimedQueue: adoptUnclaimedQueue, queueKey: queueKey, purgeOfflineCache: purgeOfflineCache, push: pushApi, touch: touch, flushQueue: flushQueue, fmtDate: fmtDate, fmtDateTime: fmtDateTime, dateHint: dateHint, dateInputProps: dateInputProps, isoToday: isoToday, fmtNum: fmtNum, fmtPct: fmtPct, fmtMoney: fmtMoney, studentName: studentName, userName: userName, setTheme: setTheme, h: h };
})();
