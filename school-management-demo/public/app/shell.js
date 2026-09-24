/* App shell: login gates, top bar built from the screen registry, session timeout dialog, offline sync bar, toasts, shortcuts, theme, language, demo layer. */
(function () {
  var React = window.React, h = React.createElement, E = window.EdMat, A = window.EdApp, t = A.t;
  A.ROLE_LABEL = new Proxy({}, { get: function (_, k) { return t('role.' + k); } });

  function Login() {
    var st = React.useState({ login: '', password: '', error: null, busy: false }); var f = st[0], set = st[1];
    var app = A.useAppState();
    var submit = function (e) { e.preventDefault(); set(Object.assign({}, f, { busy: true, error: null })); A.login(f.login, f.password).catch(function (err) { set(Object.assign({}, f, { busy: false, error: err.message })); }); };
    return h('div', { className: 'login' }, h('form', { className: 'card', onSubmit: submit, 'aria-labelledby': 'login-title' },
      h('div', { className: 'row', style: { justifyContent: 'space-between' } }, h('a', { className: 'ed-wordmark', href: '#/', 'aria-label': 'EdMat' }, h('i', { 'aria-hidden': 'true' }), 'EdMat'), h(LangSwitch, null)),
      h('h1', { id: 'login-title', className: 'title', style: { margin: '0 0 var(--space-1)' } }, t('shell.loginTitle')),
      h('p', { className: 'muted', style: { marginTop: 0 } }, t('shell.loginSub')),
      f.error ? h(E.Alert, { tone: 'danger' }, f.error)
        /* m4: an 8 s toast is not an explanation. The reason the session ended stays on the card. */
        : (app.signedOutReason ? h(E.Alert, { tone: app.signedOutReason === 'logout' ? 'success' : 'warning' }, t('shell.out.' + app.signedOutReason)) : null),
      h('div', { className: 'stack', style: { marginTop: 'var(--space-3)' } },
        h(E.TextField, { label: t('shell.user'), value: f.login, autoComplete: 'username', required: true, autoFocus: true, onChange: function (e) { set(Object.assign({}, f, { login: e.target.value })); } }),
        h(E.TextField, { label: t('shell.password'), type: 'password', value: f.password, autoComplete: 'current-password', required: true, onChange: function (e) { set(Object.assign({}, f, { password: e.target.value })); } }),
        h(E.Button, { variant: 'primary', type: 'submit', loading: f.busy }, t('shell.login')),
        h('p', { className: 'muted' }, t('shell.demoAccounts')),
        h('p', { className: 'muted' }, h('a', { className: 'app-link', href: (A.base || '') + '/api/compliance/accessibility?format=html', target: '_blank', rel: 'noopener' }, t('shell.accessibility'))),
        h('p', { className: 'muted' }, h('a', { className: 'app-link', href: (A.base || '') + '/projekt/' }, t('shell.about')))),
      h(DemoPersonas, { compact: true })));
  }
  function LangSwitch() {
    var app = A.useAppState();
    return h('div', { role: 'group', 'aria-label': t('common.language'), className: 'row', style: { gap: 'var(--space-1)' } }, ['pl', 'en'].map(function (l) { return h(E.Button, { key: l, size: 'sm', variant: app.locale === l ? 'primary' : 'quiet', 'aria-pressed': app.locale === l ? 'true' : 'false', onClick: function () { A.setLocale(l); } }, l.toUpperCase()); }));
  }
  function TotpGate() {
    var st = React.useState({ code: '', error: null }); var f = st[0], set = st[1];
    var submit = function (e) { e.preventDefault(); A.api.post('/api/auth/totp', { code: f.code }).then(function () { A.setState({ totpRequired: false }); A.loadSession(); }).catch(function (err) { set(Object.assign({}, f, { error: err.message })); }); };
    return h('div', { className: 'login' }, h('form', { className: 'card', onSubmit: submit }, h('h1', { className: 'title' }, t('shell.totpTitle')), h('p', null, t('shell.totpText')), f.error && h(E.Alert, { tone: 'danger' }, f.error), h(E.TextField, { label: t('shell.code'), mono: true, inputMode: 'numeric', autoFocus: true, value: f.code, onChange: function (e) { set(Object.assign({}, f, { code: e.target.value })); } }), h('div', { className: 'row mt-4' }, h(E.Button, { variant: 'primary', type: 'submit' }, t('common.confirm')), h(E.Button, { variant: 'quiet', onClick: A.logout }, t('shell.logout')))));
  }
  function PasswordGate() {
    var st = React.useState({ next: '', again: '', error: null }); var f = st[0], set = st[1];
    var submit = function (e) { e.preventDefault(); if (f.next !== f.again) return set(Object.assign({}, f, { error: t('shell.pwMismatch') })); A.api.post('/api/auth/password', { next: f.next }).then(function () { A.setState({ mustChangePassword: false }); A.toast(t('shell.pwChanged'), 'success'); A.loadSession(); }).catch(function (err) { set(Object.assign({}, f, { error: err.message })); }); };
    return h('div', { className: 'login' }, h('form', { className: 'card', onSubmit: submit }, h('h1', { className: 'title' }, t('shell.pwTitle')), h('p', { className: 'muted' }, t('shell.pwText')), f.error && h(E.Alert, { tone: 'danger' }, f.error), h('div', { className: 'stack' }, h(E.TextField, { label: t('shell.pwNew'), type: 'password', autoComplete: 'new-password', value: f.next, onChange: function (e) { set(Object.assign({}, f, { next: e.target.value })); } }), h(E.TextField, { label: t('shell.pwAgain'), type: 'password', autoComplete: 'new-password', value: f.again, onChange: function (e) { set(Object.assign({}, f, { again: e.target.value })); } }), h(E.Button, { variant: 'primary', type: 'submit' }, t('shell.pwSave')))));
  }
  function TimeoutDialog(p) {
    var s = p.remaining; var mm = Math.floor(s / 60), ss = s % 60;
    return h(E.Dialog, { title: t('shell.sessionTitle'), timeout: mm + ':' + String(ss).padStart(2, '0'), actions: [h(E.Button, { key: 'stay', variant: 'primary', 'data-autofocus': true, onClick: function () { A.touch(); } }, t('shell.stay')), h(E.Button, { key: 'out', onClick: A.logout }, t('shell.logout'))] }, h('p', null, t('shell.sessionText')));
  }
  function ShortcutsDialog(p) {
    var rows = [['Alt', '1…9', t('sc.sections')], ['?', '', t('sc.list')], ['/', '', t('sc.search')], ['Ctrl', 'S', t('sc.save')], ['A', '', t('sc.rowPresent')], ['N S Z U', '', t('sc.status')], ['R W', '', t('sc.statusRsW')], ['↑ ↓', '', t('sc.arrows')], ['Enter', '', t('sc.enter')], ['Esc', '', t('sc.esc')]];
    return h(E.Dialog, { title: t('shell.shortcuts'), onClose: p.onClose, actions: h(E.Button, { onClick: p.onClose }, t('common.close')) }, h('table', { className: 'ed-table' }, h('tbody', null, rows.map(function (r, i) { return h('tr', { key: i }, h('td', null, h(E.Kbd, { keys: r[1] ? [r[0], r[1]] : r[0].split(' ') })), h('td', null, r[2])); }))));
  }
  /* B3 — the ack is the only way out of a blocking dialog: Escape is disabled, there is no close
     button and every click behind the scrim is swallowed. Without a .catch a failed ack (offline,
     expired session, server down) left the evaluator locked in the app. So the failure is stated,
     the ack can be retried, and "Wyloguj" is always there as an escape hatch. Both actions sit in
     the dialog's action row, which is where Dialog puts the initial focus and traps Tab. */
  function Announcement(p) {
    var st = React.useState({ busy: false, error: null }); var f = st[0], set = st[1];
    var ack = function () {
      set({ busy: true, error: null });
      A.api.post('/api/announcements/' + p.a.id + '/ack')
        .then(function () { A.loadSession(); })
        .catch(function (e) { set({ busy: false, error: (e && e.message) || t('common.error') }); });
    };
    return h(E.Dialog, { title: p.a.title || t('shell.announcement'), blocking: true, actions: [
      h(E.Button, { key: 'ack', variant: 'primary', loading: f.busy, 'data-autofocus': true, onClick: ack }, f.error ? t('shell.ackRetry') : t('shell.ack')),
      f.error ? h(E.Button, { key: 'out', icon: 'log-out', onClick: A.logout }, t('shell.logout')) : null
    ].filter(Boolean) },
      h('p', null, p.a.body),
      f.error ? h(E.Alert, { tone: 'danger', title: t('shell.ackFailed') }, f.error) : null,
      h('p', { className: 'muted' }, t('shell.announcementNote')));
  }
  /* ---------- demo layer ---------- */
  function DemoPersonas(p) {
    var app = A.useAppState(); var st = React.useState(null); var personas = st[0], set = st[1];
    React.useEffect(function () { A.api.get('/api/demo/personas').then(function (d) { set(d.personas); }).catch(function () { set([]); }); }, []);
    if (!personas || !personas.length) return null;
    var pick = function (login) { A.api.post('/api/demo/switch', { login: login }).then(function () { return A.loadSession(); }).then(function () { A.navigate('/'); if (p.onDone) p.onDone(); }).catch(function (e) { A.toast(e.message, 'danger'); }); };
    return h('div', { className: p.compact ? 'mt-4' : '' }, h('h2', { className: 'subheading', style: { margin: '0 0 var(--space-2)' } }, t('demo.roleTitle')),
      h('div', { className: 'stack', style: { gap: 'var(--space-1)' } }, personas.map(function (ps) { return h('button', { key: ps.login, type: 'button', className: 'ed-switcher-item', 'aria-current': app.user && app.user.login === ps.login ? 'true' : undefined, onClick: function () { pick(ps.login); } }, h(E.Avatar, { name: ps.login.replace(/\./g, ' '), size: 'sm', kind: ps.role === 'student' ? 'child' : 'staff' }), h('span', null, ps[app.locale] || ps.pl, h('span', { className: 'ed-meta' }, t('role.' + ps.role) + ' · ' + ps.login))); })));
  }
  function FeedbackDialog(p) {
    var app = A.useAppState(); var st = React.useState({ rating: '4', kind: 'idea', body: '', contact: '', busy: false }); var f = st[0], set = st[1];
    var send = function () { set(Object.assign({}, f, { busy: true })); A.api.post('/api/feedback', { rating: +f.rating, kind: f.kind, body: f.body, contact: f.contact, screen: app.route.path, locale: app.locale }).then(function () { A.toast(t('demo.fbSent'), 'success'); p.onClose(); }).catch(function (e) { set(Object.assign({}, f, { busy: false })); A.toast(e.message, 'danger'); }); };
    return h(E.Dialog, { title: t('demo.fbTitle'), onClose: p.onClose, actions: [h(E.Button, { key: 'c', onClick: p.onClose }, t('common.cancel')), h(E.Button, { key: 's', variant: 'primary', loading: f.busy, onClick: send, disabled: f.body.trim().length < 3 }, t('common.send'))] },
      h('p', null, t('demo.fbText')),
      h(E.RadioGroup, { legend: t('demo.fbRating'), row: true, value: f.rating, options: ['1', '2', '3', '4', '5'].map(function (v) { return { value: v, label: v }; }), onChange: function (v) { set(Object.assign({}, f, { rating: v })); } }),
      h(E.Select, { label: t('demo.fbKind'), value: f.kind, options: ['bug', 'idea', 'praise', 'question'].map(function (k) { return { value: k, label: t('demo.fbKind.' + k) }; }), onChange: function (e) { set(Object.assign({}, f, { kind: e.target.value })); } }),
      h(E.TextField, { label: t('demo.fbBody'), multiline: 4, required: true, value: f.body, onChange: function (e) { set(Object.assign({}, f, { body: e.target.value })); } }),
      h(E.TextField, { label: t('demo.fbContact'), value: f.contact, onChange: function (e) { set(Object.assign({}, f, { contact: e.target.value })); } }),
      h('p', { className: 'muted' }, (app.user ? t('role.' + app.user.role) + ' · ' : '') + app.route.path));
  }
  function GuideDialog(p) {
    var app = A.useAppState(); var g = A.useApi('/api/demo/guide?locale=' + app.locale, [app.locale]);
    return h(E.Dialog, { title: t('demo.guideTitle'), onClose: p.onClose, actions: h(E.Button, { onClick: p.onClose }, t('common.close')) },
      g.loading ? h('p', null, t('common.loading')) : (g.data && g.data.sections || []).map(function (s) { return h('div', { key: s.id, className: 'mb-4' }, h('h3', { className: 'subheading' }, s.title), h('ol', { style: { paddingLeft: '1.2em', margin: 0 } }, s.items.map(function (it) { return h('li', { key: it.id, style: { marginBottom: 4 } }, it.text, it.done && h(E.Badge, { tone: 'success', icon: 'check', className: 'ml-2' }, it.id)); }))); }),
      h('p', { className: 'muted' }, t('demo.guideDone')));
  }
  function DemoBar(p) {
    var st = React.useState(null); var open = st[0], setOpen = st[1];
    return h('div', { className: 'app-demo', role: 'region', 'aria-label': 'Demo' },
      h('span', null, t('demo.banner')),
      h('span', { className: 'row', style: { gap: 'var(--space-2)' } },
        h(E.Button, { size: 'sm', onClick: function () { setOpen('switch'); } }, t('demo.switch')),
        h(E.Button, { size: 'sm', onClick: function () { setOpen('guide'); } }, t('demo.guide')),
        h(E.Button, { size: 'sm', variant: 'primary', onClick: function () { setOpen('feedback'); } }, t('demo.feedback'))),
      open === 'feedback' && h(FeedbackDialog, { onClose: function () { setOpen(null); } }),
      open === 'guide' && h(GuideDialog, { onClose: function () { setOpen(null); } }),
      open === 'switch' && h(E.Dialog, { title: t('demo.roleTitle'), onClose: function () { setOpen(null); }, actions: h(E.Button, { onClick: function () { setOpen(null); } }, t('common.close')) }, h(DemoPersonas, { onDone: function () { setOpen(null); } })));
  }
  function UserMenu(p) {
    var st = React.useState(false); var open = st[0], setOpen = st[1]; var u = p.user; var theme = document.documentElement.dataset.theme; var app = A.useAppState();
    return h('div', { className: 'ed-switcher' },
      h('button', { type: 'button', className: 'ed-switcher-btn', 'aria-haspopup': 'menu', 'aria-expanded': open ? 'true' : 'false', onClick: function () { setOpen(!open); } }, h(E.Avatar, { name: u.firstName + ' ' + u.lastName, size: 'sm', kind: u.role === 'student' ? 'child' : 'staff' }), h('span', null, u.firstName + ' ' + u.lastName), h(E.Icon, { name: open ? 'chevron-up' : 'chevron-down' })),
      open && h('ul', { role: 'menu', className: 'ed-switcher-menu', style: { right: 0, left: 'auto' } },
        h('li', { role: 'none' }, h('div', { className: 'ed-switcher-item', style: { cursor: 'default' } }, h('span', null, t('role.' + u.role), h('span', { className: 'ed-meta' }, u.login)))),
        h('li', { role: 'none' }, h('div', { className: 'ed-switcher-sep' })),
        ['pl', 'en'].map(function (l) { return h('li', { key: l, role: 'none' }, h('button', { role: 'menuitemradio', 'aria-checked': app.locale === l ? 'true' : 'false', className: 'ed-switcher-item', 'aria-current': app.locale === l ? 'true' : undefined, onClick: function () { A.setLocale(l); setOpen(false); } }, h(E.Icon, { name: 'file' }), h('span', null, t('common.' + l)))); }),
        h('li', { role: 'none' }, h('div', { className: 'ed-switcher-sep' })),
        ['light', 'dark', 'hc'].map(function (th) { return h('li', { key: th, role: 'none' }, h('button', { role: 'menuitemradio', 'aria-checked': theme === th ? 'true' : 'false', className: 'ed-switcher-item', 'aria-current': theme === th ? 'true' : undefined, onClick: function () { A.setTheme(th); setOpen(false); } }, h(E.Icon, { name: th === 'dark' ? 'eye-off' : th === 'hc' ? 'shield' : 'home' }), h('span', null, { light: t('shell.themeLight'), dark: t('shell.themeDark'), hc: t('shell.themeHc') }[th]))); }),
        h('li', { role: 'none' }, h('button', { role: 'menuitem', className: 'ed-switcher-item', onClick: function () { setOpen(false); A.navigate('/ustawienia'); } }, h(E.Icon, { name: 'keyboard' }), h('span', null, t('shell.settings')))),
        h('li', { role: 'none' }, h('div', { className: 'ed-switcher-sep' })),
        h('li', { role: 'none' }, h('button', { role: 'menuitem', className: 'ed-switcher-item', onClick: A.logout }, h(E.Icon, { name: 'log-out' }), h('span', null, t('shell.logout'))))));
  }
  function Frame(p) {
    var s = p.state, u = s.user; var navs = A.screensFor(u).filter(function (x) { return x.nav; });
    var current = A.matchScreen(u, s.route.path);
    React.useEffect(function () { if (s.route.path === '/' && navs.length) A.navigate(navs[0].path); }, [s.route.path]);
    var unread = A.useApi('/api/notifications/unread-count', [s.route.path]);
    var pending = s.pendingAnnouncement;
    return h(React.Fragment, null,
      s.demo && h(DemoBar, null),
      h(E.TopBar, { items: navs.map(function (n, i) { return { href: '#' + n.path, label: n.nav.key ? t(n.nav.key) : n.nav.label, current: current && current.id === n.id, key: String(i + 1) }; }), context: (s.config && s.config.school.short) + ' · ' + t('role.' + u.role), notifications: unread.data ? unread.data.count : 0, extra: h(React.Fragment, null, h(A.reportIssue.TopBarButton, null), h(UserMenu, { user: u })) }),
      (!s.online || s.queue.length || s.syncing || s.syncError) && h('div', { className: 'app-sync' }, h(E.SyncStatus, { state: s.syncError ? 'error' : s.syncing ? 'pending' : !s.online ? 'offline' : s.queue.length ? 'pending' : 'synced', pending: s.queue.length || undefined, detail: !s.online ? t('shell.offlineDetail') : s.syncError || undefined, action: (s.online && s.queue.length) ? t('shell.sendNow') : undefined, onAction: A.flushQueue })),
      h('main', { id: 'main', className: 'app-main', tabIndex: -1 }, current ? h(current.component, { user: u, route: s.route, config: s.config, key: s.locale }) : h('div', null, h('h1', { className: 'display app-title' }, t('shell.notFound')), h('p', null, t('shell.pickSection')))),
      s.remainingSeconds != null && s.remainingSeconds <= 120 && s.remainingSeconds > 0 && h(TimeoutDialog, { remaining: s.remainingSeconds }),
      s.showShortcuts && h(ShortcutsDialog, { onClose: function () { A.setState({ showShortcuts: false }); } }),
      pending && h(Announcement, { a: pending }));
  }
  function App() {
    var s = A.useAppState(); var init = React.useState(false);
    var setup = React.useState(null);
    React.useEffect(function () { A.api.get('/api/setup/status').then(function (st) { setup[1](st); if (st.needed) { init[1](true); return null; } return A.loadSession(); }).catch(function () { return A.loadSession(); }).then(function () { init[1](true); }); if ('serviceWorker' in navigator) navigator.serviceWorker.register((A.base || '') + '/sw.js').catch(function () {}); }, []);
    React.useEffect(function () { if (s.remainingSeconds != null && s.remainingSeconds <= 120 && s.remainingSeconds > 0) { var tm = setInterval(function () { A.setState({ remainingSeconds: Math.max(0, A.state.remainingSeconds - 1) }); }, 1000); return function () { clearInterval(tm); }; } if (s.remainingSeconds === 0 && s.user) { A.setState({ user: null, remainingSeconds: null, signedOutReason: 'timeout' }); A.toast(t('shell.loggedOut'), 'danger'); } }, [s.remainingSeconds != null && s.remainingSeconds <= 120, s.remainingSeconds === 0]);
    var body;
    if (!init[0]) body = h('div', { className: 'login' }, h('p', { className: 'muted' }, t('common.loading')));
    else if (!s.user && setup[0] && setup[0].needed && A.SetupWizard) body = h(A.SetupWizard, { status: setup[0] });
    else if (!s.user) body = h('main', { id: 'main' }, h(Login));   // U3-20: cel dla linku „przejdź do treści”
    else if (s.user.role === 'admin' && s.config && s.config.setup && !s.config.setup.done && s.route.path !== '/setup' && A.SetupWizard) body = h(A.SetupWizard, { status: { needed: false } });
    else if (s.totpRequired) body = h(TotpGate);
    else if (s.mustChangePassword) body = h(PasswordGate);
    else body = h(Frame, { state: s });
    /* Frame gives the screen component key: s.locale, which is the documented remount. Keying the
       whole shell as well threw away the top bar, the toast stack and any open dialog (P2). */
    return h(React.Fragment, null, body,   // U3-29: TopBar ma własny skip link; drugi był martwym pierwszym tabem
      h(A.reportIssue.Footer, { config: s.config }),
      s.reportIssue && h(A.reportIssue.Dialog, { at: s.reportIssue }),
      h('div', { className: 'app-fixed-toasts', 'aria-live': 'polite' }, s.toasts.map(function (tt) { return h(E.Toast, { key: tt.id, tone: tt.tone, static: true, action: tt.action && tt.action.label, onAction: tt.action && tt.action.fn, onClose: function () { A.dismissToast(tt.id); } }, tt.text); })));
  }
  ReactDOM.createRoot(document.getElementById('root')).render(h(App));
})();
