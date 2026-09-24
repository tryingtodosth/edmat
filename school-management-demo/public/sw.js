/* EdMat service worker: offline app shell + last-seen API responses (GET) so a teacher can open the logbook without network. Writes are queued by the client (core.js) in localStorage and replayed when online. */
const VERSION = 'edmat-v3';  /* v3: the shell gained app/report-issue.js — a returning browser must not keep serving a cached index.html that never loads it */
const SHELL_CACHE = VERSION + '-shell';
const API_PREFIX = VERSION + '-api-';
const SESSION_CACHE = VERSION + '-session';
const SESSION_KEY = '/__edmat-session';
const LOCALE_KEY = '/__edmat-locale';
const SHELL = ['/', '/index.html', '/edmat/tokens.css', '/edmat/bundle.css', '/edmat/bundle.js', '/app/app.css', '/app/theme.js', '/app/i18n.js', '/app/core.js', '/app/print.js', '/app/screens.js', '/app/report-issue.js', '/app/shell.js', '/vendor/react.js', '/vendor/react-dom.js', '/icon.svg', '/manifest.webmanifest', '/edmat/fonts/IBMPlexSans-400.woff', '/edmat/fonts/IBMPlexSans-500.woff', '/edmat/fonts/IBMPlexSans-600.woff', '/edmat/fonts/IBMPlexMono-400.woff', '/edmat/fonts/IBMPlexMono-500.woff'];
self.addEventListener('install', (e) => { e.waitUntil(caches.open(SHELL_CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting())); });
self.addEventListener('activate', (e) => { e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k.indexOf(VERSION) !== 0).map((k) => caches.delete(k)))).then(() => self.clients.claim())); });

/* REL-18 / S-09 — Cache Storage is per BROWSER, not per account, exactly like the offline queue was.
   On a shared staffroom PC that meant teacher A's class data was still readable through teacher B's
   session (and after a browser restart, with no logout at all). So: API responses live in a cache
   named after the signed-in account, the page tells us which account that is ({type:'session', userId}
   from core.js on every session load and on logout), every OTHER account's cache is dropped the
   moment the account changes, and with no known account nothing is cached at all.
   Some reads are never worth caching in any case: credentials and session state, private
   correspondence, the support team's confidential material and the nurse's office. */
const NEVER_CACHE = [/^\/api\/auth\//, /^\/api\/messages/, /^\/api\/support/, /^\/api\/modules\/.*nurse/];
/** The app can be mounted under a base path (/dziennik/), so match on the /api/ segment, not the start. */
function apiPath(pathname) { const i = pathname.indexOf('/api/'); return i < 0 ? null : pathname.slice(i); }
function apiCacheName(userId) { return API_PREFIX + userId; }

let sessionUser;                      // undefined = not told yet; null = signed out
let sessionRead = null;
let sessionLocale;                    // undefined = not told yet; null = we never learned one
let localeRead = null;
/** The worker is killed and restarted between events, so the current account is kept in a cache entry. */
function currentUser() {
  if (sessionUser !== undefined) return Promise.resolve(sessionUser);
  if (!sessionRead) sessionRead = caches.open(SESSION_CACHE)
    .then((c) => c.match(SESSION_KEY)).then((r) => (r ? r.text() : ''))
    .then((v) => { if (sessionUser === undefined) sessionUser = v || null; return sessionUser; })
    .catch(() => { if (sessionUser === undefined) sessionUser = null; return sessionUser; });
  return sessionRead;
}
/** The push event has no page to ask, so the language the app last ran in lives in the same cache. */
function currentLocale() {
  if (sessionLocale !== undefined) return Promise.resolve(sessionLocale);
  if (!localeRead) localeRead = caches.open(SESSION_CACHE)
    .then((c) => c.match(LOCALE_KEY)).then((r) => (r ? r.text() : ''))
    .then((v) => { if (sessionLocale === undefined) sessionLocale = v === 'en' || v === 'pl' ? v : null; return sessionLocale; })
    .catch(() => { if (sessionLocale === undefined) sessionLocale = null; return sessionLocale; });
  return localeRead;
}
async function setLocale(locale) {
  const next = locale === 'en' || locale === 'pl' ? locale : null;
  sessionLocale = next; localeRead = Promise.resolve(next);
  const c = await caches.open(SESSION_CACHE);
  if (next) await c.put(LOCALE_KEY, new Response(next)); else await c.delete(LOCALE_KEY);
  return next;
}
/** Drops every per-account API cache except `keep`; returns how many responses went with them. */
async function dropApiCaches(keep) {
  let removed = 0;
  for (const name of await caches.keys()) {
    if (name.indexOf(API_PREFIX) !== 0 || name === keep) continue;
    const cache = await caches.open(name);
    removed += (await cache.keys()).length;
    await caches.delete(name);
  }
  return removed;
}
async function setSession(userId) {
  const next = userId || null;
  const changed = sessionUser !== undefined && sessionUser !== next;
  sessionUser = next; sessionRead = Promise.resolve(next);
  const c = await caches.open(SESSION_CACHE);
  if (next) await c.put(SESSION_KEY, new Response(next)); else await c.delete(SESSION_KEY);
  const removed = await dropApiCaches(next ? apiCacheName(next) : null);
  return { removed, changed };
}
/* Logout must not leave a pupil's grades, attendance, messages or health data in the browser
   cache of a shared school computer. The page posts {type:'logout'} (core.js logout()) and we
   drop every cached /api/ response; the app shell stays so the login page still works offline. */
async function purgeApiCache() {
  sessionUser = null; sessionRead = Promise.resolve(null);
  sessionLocale = null; localeRead = Promise.resolve(null);
  await caches.open(SESSION_CACHE).then((c) => c.delete(LOCALE_KEY)).catch(() => {});
  let removed = await dropApiCaches(null);
  await caches.open(SESSION_CACHE).then((c) => c.delete(SESSION_KEY)).catch(() => {});
  /* older builds (and any stray entry) kept API responses next to the app shell */
  for (const name of await caches.keys()) {
    const cache = await caches.open(name);
    for (const req of await cache.keys()) {
      let p = ''; try { p = new URL(req.url).pathname; } catch (err) { p = ''; }
      if (p.indexOf('/api/') >= 0) { await cache.delete(req); removed++; }
    }
  }
  return removed;
}
self.addEventListener('message', (e) => {
  const data = e.data || {};
  if (data.type === 'locale') { const done = setLocale(data.locale); if (e.waitUntil) e.waitUntil(done); return; }
  if (data.type === 'session') {
    const done = Promise.resolve(data.locale === undefined ? null : setLocale(data.locale)).then(() => setSession(data.userId)).then((r) => {
      const reply = { type: 'session-done', userId: data.userId || null, removed: r.removed };
      if (e.ports && e.ports[0]) e.ports[0].postMessage(reply);
      return reply;
    });
    if (e.waitUntil) e.waitUntil(done);
    return;
  }
  if (data.type !== 'logout') return;
  const done = purgeApiCache().then((removed) => {
    const reply = { type: 'logout-done', removed: removed };
    if (e.ports && e.ports[0]) e.ports[0].postMessage(reply);
    return self.clients.matchAll({ includeUncontrolled: true }).then((cs) => cs.forEach((c) => c.postMessage(reply)));
  });
  if (e.waitUntil) e.waitUntil(done);
});
/** Network first, then this account's own cache; nothing is written without a known account. */
async function apiFetch(req, path) {
  const user = NEVER_CACHE.some((re) => re.test(path)) ? null : await currentUser();
  const name = user ? apiCacheName(user) : null;
  try {
    const r = await fetch(req);
    if (name) { const copy = r.clone(); caches.open(name).then((c) => c.put(req, copy)).catch(() => {}); }
    return r;
  } catch (err) {
    const cached = name ? await caches.match(req, { cacheName: name }) : undefined;
    return cached || new Response(JSON.stringify({ error: 'offline', offline: true }), { status: 503, headers: { 'Content-Type': 'application/json' } });
  }
}
self.addEventListener('fetch', (e) => {
  const req = e.request; const u = new URL(req.url);
  if (req.method !== 'GET') return; // writes go to the network; the client queues them when offline
  if (u.origin === location.origin && u.pathname.indexOf('/projekt/') >= 0) return; // strona projektu nie należy do powłoki offline — zawsze z sieci, żeby status.json nie zostawał w pamięci podręcznej
  const path = apiPath(u.pathname);
  if (path) { e.respondWith(apiFetch(req, path)); return; }
  e.respondWith(caches.match(req).then((r) => r || fetch(req).then((res) => { if (res.ok && u.origin === location.origin) { const copy = res.clone(); caches.open(SHELL_CACHE).then((c) => c.put(req, copy)); } return res; }).catch(() => (req.mode === 'navigate' ? caches.match('/index.html') : undefined))));
});

/* ---------------------------------------------------------------- Web Push (RFC 8030/8291)
   R6 — payload minimisation (docs/PUSH.md, "Co widzi pośrednik"). The encrypted body carries
   `{v:2, kind, id, ts}` and nothing else: no pupil name, no subject, no sentence of text. On
   receipt this worker asks the SCHOOL for the wording — GET /api/notifications/:id/render, with
   the session cookie (`credentials: 'include'`; the cookie is HttpOnly + SameSite=Strict and this
   is a same-origin request from the site's own worker, so it travels) — and shows what comes back
   in the account's language. When that fetch cannot happen (offline, session expired, 401/403) we
   still show something: the neutral title for the kind from the table below. A push event that
   shows no notification is punished by the browser (Chrome shows "This site has been updated in
   the background", Firefox drops the subscription after a few), so "nothing" is never an option.
   `config.push.payload: 'neutral'` puts the title/body/link back into the payload; a payload that
   carries them is handled below exactly as before. */
const PUSH_FALLBACK = {
  pl: {
    title: 'EdMat', body: 'Masz nowe powiadomienie. Otwórz dziennik, żeby zobaczyć szczegóły.',
    crisisBody: 'Pilna sprawa w dzienniku — otwórz, żeby sprawdzić frekwencję.',
    urgent: ' · pilne', open: 'Otwórz EdMat',
    kinds: {
      absence: 'Nieobecność w szkole', message: 'Nowa wiadomość', excuse: 'Usprawiedliwienie',
      grade: 'Nowa ocena', timetable: 'Zmiana w planie lekcji', library: 'Biblioteka',
      payment: 'Płatność', cafeteria: 'Stołówka', trip: 'Wycieczka', meeting: 'Spotkanie',
      homework: 'Zadanie domowe', rights: 'Uprawnienia konta', ack: 'Potwierdzenie odbioru',
      test: 'Powiadomienie testowe'
    }
  },
  en: {
    title: 'EdMat', body: 'You have a new notification. Open the logbook for the details.',
    crisisBody: 'An urgent matter in the logbook — open it to check the attendance.',
    urgent: ' \u00b7 urgent', open: 'Open EdMat',
    kinds: {
      absence: 'Absence from school', message: 'New message', excuse: 'Absence note',
      grade: 'New grade', timetable: 'Timetable change', library: 'Library',
      payment: 'Payment', cafeteria: 'Canteen', trip: 'School trip', meeting: 'Meeting',
      homework: 'Homework', rights: 'Account permissions', ack: 'Confirmation of receipt',
      test: 'Test notification'
    }
  }
};
/* The kinds the school raises as a crisis — the SAME list as `CRISIS_KINDS` in
   server/routes/notifications.js, and tests/48-push.test.js fails if the two ever differ. The
   payload carries `crisis` as a boolean; this list is what the worker falls back on when it does
   not (an older payload, or a rendering that came back without the flag), so a first-period
   absence alert never renders as an ordinary notification — silent, unvibrating and without the
   urgency marker — in exactly the case it exists for. */
const CRISIS_KINDS = ['absence', 'attendance-alert'];
function isCrisis(d) { return d && (d.crisis === true || (d.crisis === undefined && CRISIS_KINDS.indexOf(d.kind) >= 0)); }

/** The app is a hash-router SPA and may be mounted under a base path, so links resolve against the scope. */
function appUrl(link, opts) {
  const path = typeof link === 'string' && link.charAt(0) === '/' ? link : '/';
  /* The login gate renders over whatever route the hash holds, so the deep link IS the return
     path; `login=1` only tells the app the tap came from a notification whose session had gone. */
  const full = opts && opts.login ? path + (path.indexOf('?') >= 0 ? '&' : '?') + 'login=1' : path;
  return new URL('#' + full, self.registration.scope).href;
}
function pushData(event) {
  try { return (event && event.data && event.data.json()) || {}; }
  catch (e) { try { return { body: event.data.text() }; } catch (e2) { return {}; } }
}
/* How long the worker waits for the school before it shows the neutral fallback instead. The one
   case this exists for is „the school's own server is busy": a push fan-out is a synchronised
   stampede against the process that just sent it, and without a deadline the push event never
   settles — Chrome then replaces it with its own „This site has been updated in the background"
   (R3-10). Four seconds is well inside the few seconds a browser gives a push event. */
const RENDER_TIMEOUT_MS = 4000;
/** Asks the school what to show. Returns {ok, data} or {ok:false, status} — never throws. */
async function fetchRendered(id, locale) {
  const path = 'api/notifications/' + encodeURIComponent(id) + '/render' + (locale ? '?locale=' + locale : '');
  const init = { credentials: 'include', cache: 'no-store', headers: { Accept: 'application/json' } };
  /* AbortSignal.timeout is not in every engine that runs a service worker; without it the fetch
     simply keeps its old behaviour rather than throwing here. */
  try { if (typeof AbortSignal !== 'undefined' && AbortSignal.timeout) init.signal = AbortSignal.timeout(RENDER_TIMEOUT_MS); } catch (e) {}
  try {
    const res = await fetch(new URL(path, self.registration.scope).href, init);
    if (res && res.ok) return { ok: true, data: await res.json() };
    return { ok: false, status: (res && res.status) || 0 };
  } catch (e) {
    /* An abort is „the school did not answer in time", which is the fallback's case, not an error. */
    return { ok: false, status: 0, timeout: !!(e && (e.name === 'TimeoutError' || e.name === 'AbortError')) };
  }
}
/** The notification the payload asks for. Kept pure so a test can assert the options it builds. */
function notificationFrom(data, locale, opts) {
  const d = data || {}; const o = opts || {};
  const table = PUSH_FALLBACK[locale] || PUSH_FALLBACK.pl;
  const urgent = isCrisis(d);
  const link = typeof d.link === 'string' && d.link.charAt(0) === '/' ? d.link : '/';
  const at = d.at ? Date.parse(d.at) : typeof d.ts === 'number' ? d.ts : NaN;
  const options = {
    body: String(d.body || table.body).slice(0, 300),
    tag: String(d.tag || d.id || d.kind || 'edmat'),
    data: { link: link, kind: d.kind || null, at: d.at || null, login: !!o.login },
    icon: new URL('icon.svg', self.registration.scope).href,
    badge: new URL('icon.svg', self.registration.scope).href,
    lang: locale === 'en' ? 'en' : 'pl',
    /* A first-period absence stays on the lock screen until a parent touches it; everything else
       behaves like an ordinary notification. Vibration and re-alerting only for the urgent ones. */
    requireInteraction: urgent,
    renotify: urgent,
    vibrate: urgent ? [120, 60, 120] : undefined,
    timestamp: isNaN(at) ? undefined : at
  };
  /* Fallback: we do not know what happened, so we give the one action that always makes sense —
     and, for a crisis, we say plainly that it is one. The server appends the urgency marker to the
     title it renders; on this path the worker has to do it itself, or the alert reads as ordinary. */
  if (o.fallback) {
    options.actions = [{ action: 'open', title: table.open }];
    if (urgent) options.body = table.crisisBody;
  }
  const title = String(d.title || (table.kinds[d.kind] ? table.kinds[d.kind] + (urgent && o.fallback ? table.urgent : '') : table.title)).slice(0, 120);
  return { title: title, options: options };
}
/** Minimal payload → ask the school; neutral payload (or a broken one) → show what came. */
async function handlePush(event) {
  const d = pushData(event);
  /* Język znany workerowi jedzie w zapytaniu; jak go nie zna, niech zdecyduje język konta. */
  const known = await currentLocale();
  const locale = known || 'pl';
  if (d && d.id && !d.title && !d.body) {
    const r = await fetchRendered(d.id, known);
    const n = r.ok ? notificationFrom(r.data, r.data && r.data.locale === 'en' ? 'en' : locale) : null;
    if (n) return self.registration.showNotification(n.title, n.options);
    /* The crisis flag travels in the payload (one boolean, no personal data), so the fallback
       notification is still urgent when the school could not be asked for the wording. */
    const back = notificationFrom({ kind: d.kind, ts: d.ts, tag: d.id, crisis: d.crisis }, locale, { fallback: true, login: r.status === 401 || r.status === 403 });
    return self.registration.showNotification(back.title, back.options);
  }
  const n = notificationFrom(d, locale, { fallback: !d || (!d.title && !d.body) });
  return self.registration.showNotification(n.title, n.options);
}
self.addEventListener('push', (e) => {
  const done = handlePush(e);
  if (e.waitUntil) e.waitUntil(done);
});
/** A tap opens the logbook exactly where the notification points, reusing an open tab when there is one. */
async function openApp(link, opts) {
  const target = appUrl(link, opts);
  const clients = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
  for (const c of clients) {
    if (String(c.url).indexOf(self.registration.scope) !== 0) continue;
    if (typeof c.navigate === 'function') { try { await c.navigate(target); } catch (err) { /* cross-origin or bfcached */ } }
    return c.focus ? c.focus() : c;
  }
  return self.clients.openWindow(target);
}
/* Tap, or the "open EdMat" action of a fallback notification: the deep link either way. If the
   session was already gone when the push arrived, the same link lands on the login gate and the
   route waits in the hash — that is the return path. */
self.addEventListener('notificationclick', (e) => {
  if (e.notification && e.notification.close) e.notification.close();
  const d = (e.notification && e.notification.data) || {};
  const done = openApp(d.link || '/', { login: d.login === true });
  if (e.waitUntil) e.waitUntil(done);
});
/* The browser can rotate a subscription on its own; the page re-registers on its next load, and
   until then the old endpoint answers 410 and the server drops it. */
self.addEventListener('pushsubscriptionchange', (e) => {
  const done = self.clients.matchAll({ includeUncontrolled: true }).then((cs) => cs.forEach((c) => c.postMessage({ type: 'push-subscription-change' })));
  if (e.waitUntil) e.waitUntil(done);
});
