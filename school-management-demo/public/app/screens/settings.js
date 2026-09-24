/* Ustawienia i dostępność (3.9.1–3.9.5): motyw, język, powiększenie tekstu, ograniczenie animacji,
   cisza nocna, skróty klawiszowe, film instruktażowy z napisami i transkrypcją oraz zasady sesji.
   Ekran bez pozycji w nawigacji — otwiera go menu użytkownika w pasku górnym. */
(function () {
  var E = window.EdMat, A = window.EdApp, h = React.createElement, F = React.Fragment;

  window.EdI18n.add({
    pl: {
      'se.sub': 'Ustawienia zapisujemy na tym urządzeniu i na koncie, więc wracają po zalogowaniu na innym komputerze.',
      'se.appearance': 'Wygląd i czytelność', 'se.theme': 'Motyw interfejsu',
      'se.theme.light': 'Jasny', 'se.theme.lightHint': 'Domyślny motyw dzienny.',
      'se.theme.dark': 'Ciemny', 'se.theme.darkHint': 'Mniej męczy wzrok wieczorem.',
      'se.theme.hc': 'Wysoki kontrast', 'se.theme.hcHint': 'Grubsze obramowania i maksymalny kontrast tekstu.',
      'se.textSize': 'Wielkość tekstu', 'se.zoom.100': '100 % – domyślne', 'se.zoom.150': '150 % – powiększone', 'se.zoom.200': '200 % – bardzo duże',
      'se.zoomNote': 'Układ jest płynny: przy 200 % treść nadal mieści się w oknie, bez przewijania w poziomie.',
      'se.reduceMotion': 'Ogranicz animacje', 'se.reduceMotionHint': 'Wyłącza przejścia i animacje w całym dzienniku (respektuje też ustawienie systemowe).',
      'se.off': 'wył.', 'se.on': 'wł.',
      'se.appearanceLine': 'Motyw: {theme} · tekst {zoom} · animacje {motion}.',
      'se.motion.reduced': 'ograniczone', 'se.motion.default': 'domyślne',
      'se.themeName.light': 'jasny', 'se.themeName.dark': 'ciemny', 'se.themeName.hc': 'wysoki kontrast',
      'se.language': 'Język interfejsu', 'se.languageLegend': 'Język dziennika',
      'se.languageHint': 'Wybór zapisujemy na koncie — dziennik otworzy się w tym języku także na innym urządzeniu. Dane szkoły (statusy, nazwy dokumentów) pozostają po polsku.',
      'se.quiet': 'Cisza nocna', 'se.quietLabel': 'Wstrzymuj powiadomienia w wybranych godzinach',
      'se.quietHint': 'Powiadomienia z okresu ciszy czekają do jej końca. Komunikaty kryzysowe docierają zawsze.',
      'se.from': 'Od', 'se.to': 'Do',
      'se.quietOnToast': 'Cisza nocna: {from}–{to}.', 'se.quietOffToast': 'Cisza nocna wyłączona.',
      'se.quietOnLine': 'Powiadomienia z godzin {from}–{to} zobaczysz rano, w zbiorczym podsumowaniu.',
      'se.quietOffLine': 'Powiadomienia docierają na bieżąco.',
      'se.video': 'Film instruktażowy z napisami', 'se.videoFallback': 'Twoja przeglądarka nie odtwarza wideo. Skorzystaj z transkrypcji obok.',
      'se.videoNote': 'Napisy w języku polskim (plik /help/intro.vtt) włączasz przyciskiem „CC” w odtwarzaczu. Film jest hostowany na serwerze szkoły — nie korzystamy z zewnętrznych serwisów wideo.',
      'se.transcript': 'Transkrypcja tekstowa',
      'se.videoMissing': 'Nagranie nie zostało jeszcze opublikowane na serwerze szkoły. Pełna treść filmu jest obok, w transkrypcji; odtwarzacz pojawi się, gdy administrator wskaże plik (config.helpVideoUrl).',
      'se.videoPosterAlt': 'Plansza tytułowa filmu instruktażowego EdMat.',
      'se.transcriptNote': 'Transkrypcja zawiera pełną treść nagrania — nic nie jest przekazywane wyłącznie dźwiękiem.',
      'se.videoPolish': '', 'se.shortcutsCaption': 'Skróty klawiszowe dziennika',
      'se.shortcut': 'Skrót', 'se.action': 'Działanie', 'se.scope': 'Gdzie działa',
      'se.scNote': 'Cała nawigacja działa bez myszy; fokus jest zawsze widoczny.',
      'se.scSkip': 'Pierwszy Tab na stronie otwiera odnośnik „Przejdź do treści”.',
      'se.session': 'Bezpieczeństwo sesji',
      'se.sessionText': 'Po {min} minutach bez aktywności dziennik wylogowuje konto. Na {warn} minuty wcześniej pokazujemy okno z licznikiem i przyciskiem „Pozostań zalogowany”.',
      'se.sessionNote': 'Niezapisane wpisy zostają w przeglądarce jako wersja robocza i wracają po ponownym zalogowaniu. Połączenie jest szyfrowane (HTTPS/HSTS), a ciasteczko sesji ma atrybuty HttpOnly, SameSite i Secure.',
      'se.extend': 'Przedłuż sesję teraz', 'se.extended': 'Sesja przedłużona.'
    },
    en: {
      'se.sub': 'We save the settings on this device and in your account, so they come back when you sign in on another computer.',
      'se.appearance': 'Appearance and readability', 'se.theme': 'Interface theme',
      'se.theme.light': 'Light', 'se.theme.lightHint': 'The default daytime theme.',
      'se.theme.dark': 'Dark', 'se.theme.darkHint': 'Easier on the eyes in the evening.',
      'se.theme.hc': 'High contrast', 'se.theme.hcHint': 'Thicker borders and maximum text contrast.',
      'se.textSize': 'Text size', 'se.zoom.100': '100 % – default', 'se.zoom.150': '150 % – enlarged', 'se.zoom.200': '200 % – very large',
      'se.zoomNote': 'The layout is fluid: at 200 % the content still fits the window, with no horizontal scrolling.',
      'se.reduceMotion': 'Reduce motion', 'se.reduceMotionHint': 'Turns off transitions and animations across the logbook (it also respects your system setting).',
      'se.off': 'off', 'se.on': 'on',
      'se.appearanceLine': 'Theme: {theme} · text {zoom} · motion {motion}.',
      'se.motion.reduced': 'reduced', 'se.motion.default': 'default',
      'se.themeName.light': 'light', 'se.themeName.dark': 'dark', 'se.themeName.hc': 'high contrast',
      'se.language': 'Interface language', 'se.languageLegend': 'Logbook language',
      'se.languageHint': 'We save the choice in your account — the logbook opens in this language on other devices too. School data (statuses, document names) stays in Polish.',
      'se.quiet': 'Quiet hours', 'se.quietLabel': 'Hold notifications during the chosen hours',
      'se.quietHint': 'Notifications from the quiet period wait until it ends. Crisis messages always get through.',
      'se.from': 'From', 'se.to': 'To',
      'se.quietOnToast': 'Quiet hours: {from}–{to}.', 'se.quietOffToast': 'Quiet hours switched off.',
      'se.quietOnLine': 'Notifications from {from}–{to} arrive in the morning, in one summary.',
      'se.quietOffLine': 'Notifications arrive as they happen.',
      'se.video': 'Instructional video with subtitles', 'se.videoFallback': 'Your browser cannot play the video. Use the transcript next to it.',
      'se.videoNote': 'Polish subtitles (the file /help/intro.vtt) are switched on with the “CC” button in the player. The video is hosted on the school server — we do not use external video services.',
      'se.transcript': 'Text transcript',
      'se.videoMissing': 'The recording has not been published on the school server yet. The full content is next to this, in the transcript; the player appears once an administrator points to a file (config.helpVideoUrl).',
      'se.videoPosterAlt': 'Title frame of the EdMat instructional video.',
      'se.transcriptNote': 'The transcript carries the full content of the recording — nothing is conveyed by sound alone.',
      'se.videoPolish': 'Video and subtitles are in Polish', 'se.shortcutsCaption': 'Logbook keyboard shortcuts',
      'se.shortcut': 'Shortcut', 'se.action': 'Action', 'se.scope': 'Where it works',
      'se.scNote': 'The whole app works without a mouse; focus is always visible.',
      'se.scSkip': 'The first Tab on a page opens the “Skip to content” link.',
      'se.session': 'Session security',
      'se.sessionText': 'After {min} minutes without activity the logbook signs the account out. {warn} minutes earlier we show a dialog with a countdown and a “Stay signed in” button.',
      'se.sessionNote': 'Unsaved entries stay in the browser as a draft and come back after you sign in again. The connection is encrypted (HTTPS/HSTS) and the session cookie carries the HttpOnly, SameSite and Secure attributes.',
      'se.extend': 'Extend the session now', 'se.extended': 'Session extended.'
    }
  });

  function zooms() { return ['100%', '150%', '200%'].map(function (v) { return { value: v, label: A.t('se.zoom.' + v.replace('%', '')) }; }); }
  function themes() { return ['light', 'dark', 'hc'].map(function (v) { return { value: v, label: A.t('se.theme.' + v), hint: A.t('se.theme.' + v + 'Hint') }; }); }
  /* Serwer oddaje każdy skrót dwujęzycznie ({ keys, pl, en, scope, scopeEn }) — bierzemy pole bieżącego języka. */
  function scWhat(r) { return (A.state.locale === 'en' ? r.en : r.pl) || r.text || r.what || ''; }
  function scScope(r) { return (A.state.locale === 'en' ? r.scopeEn : r.scope) || r.scope || ''; }

  function themeName(v) { var k = 'se.themeName.' + v, s = A.t(k); return s === k ? v : s; }
  /* Film i napisy są po polsku — transkrypcja zostaje w oryginale. */
  var TRANSCRIPT = [
    ['00:00', 'Witamy w dzienniku EdMat. W tym filmie pokazujemy, jak zacząć pracę z dziennikiem.'],
    ['00:05', 'Po zalogowaniu widzisz pasek sekcji. Do sekcji przechodzisz myszą albo skrótem Alt i cyfra.'],
    ['00:11', 'Na pulpicie ucznia znajdziesz plan na dziś, frekwencję z każdej lekcji oraz zadania na jutro.'],
    ['00:18', 'Zakładka „Moje oceny” pokazuje oceny cząstkowe z wagą, kategorią i średnią ważoną przedmiotu.'],
    ['00:25', 'W sekcji „Cel na koniec semestru” wybierasz ocenę docelową, a dziennik liczy, jakich ocen jeszcze potrzebujesz.'],
    ['00:32', 'Zadanie domowe wysyłasz jako tekst albo zdjęcie. Po wysłaniu zobaczysz potwierdzenie z czasem serwera.'],
    ['00:39', 'Wiadomości do nauczycieli piszesz w dzienniku. Nie udostępniamy numerów telefonów ani adresów e-mail.'],
    ['00:46', 'Wygląd dziennika zmienisz w Ustawieniach: motyw jasny, ciemny lub wysoki kontrast, powiększenie tekstu i ograniczenie animacji.'],
    ['00:54', 'Po piętnastu minutach bez aktywności dziennik wylogowuje konto. Ostrzeżenie pojawi się dwie minuty wcześniej.']];

  function read(key, fallback) { try { return localStorage.getItem(key) || fallback; } catch (e) { return fallback; } }
  function write(key, value) { try { if (value == null) localStorage.removeItem(key); else localStorage.setItem(key, value); } catch (e) {} }
  function savePrefs(patch) { A.api.patch('/api/me/preferences', patch).catch(function () {}); }

  function Appearance() {
    var st = React.useState(document.documentElement.dataset.theme || 'light'), theme = st[0], setTheme = st[1];
    var s2 = React.useState(read('edmat.textZoom', '100%')), zoom = s2[0], setZoom = s2[1];
    var s3 = React.useState(read('edmat.reduceMotion', '0') === '1'), motion = s3[0], setMotion = s3[1];
    function pickTheme(v) { setTheme(v); A.setTheme(v); savePrefs({ theme: v }); }
    function pickZoom(v) { setZoom(v); document.documentElement.style.fontSize = v === '100%' ? '' : v; write('edmat.textZoom', v === '100%' ? null : v); savePrefs({ textZoom: v }); }
    function pickMotion(v) { setMotion(v); if (v) document.documentElement.dataset.reduceMotion = '1'; else delete document.documentElement.dataset.reduceMotion; write('edmat.reduceMotion', v ? '1' : null); savePrefs({ reduceMotion: v }); }
    return h('section', { className: 'card', 'aria-labelledby': 'h-wyglad' },
      h('h2', { className: 'heading', id: 'h-wyglad' }, A.t('se.appearance')),
      h(E.RadioGroup, { legend: A.t('se.theme'), name: 'theme', value: theme, options: themes(), onChange: pickTheme }),
      h('div', { className: 'mt-4' },
        h(E.RadioGroup, { legend: A.t('se.textSize'), name: 'zoom', row: true, value: zoom, options: zooms(), onChange: pickZoom })),
      h('p', { className: 'caption muted' }, A.t('se.zoomNote')),
      h('div', { className: 'mt-4' },
        h(E.Switch, { label: A.t('se.reduceMotion'), hint: A.t('se.reduceMotionHint'), checked: motion, states: [A.t('se.off'), A.t('se.on')], onChange: pickMotion })),
      h('p', { className: 'caption muted', 'aria-live': 'polite' }, A.t('se.appearanceLine', {
        theme: themeName(theme), zoom: zoom,
        motion: motion ? A.t('se.motion.reduced') : A.t('se.motion.default')
      })));
  }

  function Language() {
    var app = A.useAppState();
    return h('section', { className: 'card', 'aria-labelledby': 'h-jezyk' },
      h('h2', { className: 'heading', id: 'h-jezyk' }, A.t('se.language')),
      h(E.RadioGroup, {
        legend: A.t('se.languageLegend'), name: 'locale', row: true, value: app.locale,
        options: [{ value: 'pl', label: A.t('common.pl') }, { value: 'en', label: A.t('common.en') }],
        onChange: function (v) { A.setLocale(v); }
      }),
      h('p', { className: 'caption muted', 'aria-live': 'polite' }, A.t('se.languageHint')));
  }

  function QuietHours(p) {
    var prefs = p.prefs || {}; var q = prefs.quietHours || null;
    var st = React.useState({ on: !!q, from: (q && q.from) || (prefs.quietHoursDefault && prefs.quietHoursDefault.from) || '21:00', to: (q && q.to) || (prefs.quietHoursDefault && prefs.quietHoursDefault.to) || '06:30' });
    var f = st[0], set = st[1];
    function save(next) {
      set(next);
      A.api.patch('/api/me/preferences', { quietHours: next.on ? { from: next.from, to: next.to } : null })
        .then(function () { A.toast(next.on ? A.t('se.quietOnToast', { from: next.from, to: next.to }) : A.t('se.quietOffToast'), 'success'); })
        .catch(function (e) { A.toast(e.message, 'danger'); });
    }
    return h('section', { className: 'card', 'aria-labelledby': 'h-cisza' },
      h('h2', { className: 'heading', id: 'h-cisza' }, A.t('se.quiet')),
      h(E.Switch, { label: A.t('se.quietLabel'), hint: A.t('se.quietHint'), checked: f.on, states: [A.t('se.off'), A.t('se.on')], onChange: function (v) { save(Object.assign({}, f, { on: v })); } }),
      h('div', { className: 'row mt-4' },
        h(E.TextField, Object.assign({ label: A.t('se.from'), type: 'time', value: f.from, width: 160, disabled: !f.on, onChange: function (e) { set(Object.assign({}, f, { from: e.target.value })); }, onBlur: function () { if (f.on) save(f); }, hint: A.dateHint(f.from, 'time') }, A.dateInputProps('time'))),
        h(E.TextField, Object.assign({ label: A.t('se.to'), type: 'time', value: f.to, width: 160, disabled: !f.on, onChange: function (e) { set(Object.assign({}, f, { to: e.target.value })); }, onBlur: function () { if (f.on) save(f); }, hint: A.dateHint(f.to, 'time') }, A.dateInputProps('time')))),
      h('p', { className: 'caption muted', 'aria-live': 'polite' }, f.on ? A.t('se.quietOnLine', { from: f.from, to: f.to }) : A.t('se.quietOffLine')));
  }

  /* m2 — a <video> with no src still renders an enabled play button that does nothing at all. Until
     the school publishes a file (config.helpVideoUrl) we show the poster frame, say plainly that the
     recording is not there yet, and leave the transcript — which carries the whole content — beside it. */
  function Video() {
    var polishNote = A.t('se.videoPolish');
    var frame = { width: '100%', borderRadius: 'var(--radius-md)', border: 'var(--border) solid var(--line)' };
    var src = (A.state.config && A.state.config.helpVideoUrl) || '';
    return h('section', { className: 'card', 'aria-labelledby': 'h-film' },
      h('h2', { className: 'heading', id: 'h-film' }, A.t('se.video')),
      h('div', { className: 'grid-2' },
        h('div', null,
          src
            ? h('video', { controls: true, preload: 'none', poster: '/help/intro-poster.svg', src: src, style: frame, 'aria-describedby': 'transkrypcja' },
              h('track', { key: 'pl', kind: 'subtitles', srcLang: 'pl', src: '/help/intro.vtt', label: 'Polski', default: true }),
              A.t('se.videoFallback'))
            : h('img', { src: '/help/intro-poster.svg', alt: A.t('se.videoPosterAlt'), style: frame }),
          src ? null : h(E.Alert, { tone: 'info', className: 'mt-2' }, A.t('se.videoMissing')),
          src ? h('p', { className: 'caption muted' }, A.t('se.videoNote')) : null),
        h('div', null,
          h('h3', { className: 'subheading', id: 'transkrypcja' }, A.t('se.transcript')),
          h('dl', { style: { display: 'grid', gap: 'var(--space-2)', margin: 0 } }, TRANSCRIPT.map(function (r, i) {
            return h('div', { key: i, className: 'row', style: { gap: 'var(--space-3)', alignItems: 'baseline' } },
              h('dt', { className: 'code', style: { margin: 0, color: 'var(--ink-muted)' } }, r[0]),
              h('dd', { style: { margin: 0 } }, r[1]));
          })),
          polishNote ? h('p', { className: 'caption muted', lang: 'en' }, polishNote) : null,
          h('p', { className: 'caption muted' }, A.t('se.transcriptNote')))));
  }

  /* Karta „Powiadomienia push”: stan zgody przeglądarki, włącznik subskrypcji i próbne
     powiadomienie. Każdy nieobsługiwany przypadek (brak wsparcia przeglądarki, wyłączony push
     w szkole, odmowa zgody) ma własne zdanie — nigdy wyszarzony przycisk bez wyjaśnienia. */
  function PushCard() {
    var st = React.useState({ loading: true, busy: false, supported: false, permission: 'default', schoolEnabled: false, subscribed: false, note: '' });
    var s = st[0], set = st[1];
    function apply(patch) { set(function (prev) { return Object.assign({}, prev, patch); }); }
    function refresh(extra) {
      A.push.status().then(function (x) { apply(Object.assign({ loading: false, busy: false }, x, extra || {})); })
        .catch(function () { apply({ loading: false, busy: false }); });
    }
    React.useEffect(function () { refresh(); }, []);
    function toggle(on) {
      apply({ busy: true, note: '' });
      var p = on ? A.push.subscribe() : A.push.unsubscribe();
      p.then(function () { A.toast(A.t(on ? 'push.on' : 'push.off'), 'success'); refresh({ note: '' }); })
        .catch(function (e) { A.toast(e.message || A.t('common.error'), 'danger'); refresh({ note: e.message || '' }); });
    }
    function sendTest() {
      apply({ busy: true });
      A.push.test().then(function (r) { A.toast(A.t('push.tested', { n: r.sent }), r.sent ? 'success' : 'danger'); apply({ busy: false }); })
        .catch(function (e) { A.toast(e.message || A.t('push.testFailed'), 'danger'); apply({ busy: false }); });
    }
    var permKey = 'push.perm.' + (['granted', 'denied', 'default', 'unsupported'].indexOf(s.permission) >= 0 ? s.permission : 'default');
    var blocked = !s.supported ? 'push.unsupportedHint' : !s.schoolEnabled ? 'push.schoolOffHint' : s.permission === 'denied' ? 'push.deniedHint' : null;
    return h('section', { className: 'card', 'aria-labelledby': 'h-push' },
      h('h2', { className: 'heading', id: 'h-push' }, A.t('push.title')),
      h('p', null, A.t('push.intro')),
      blocked ? h(E.Alert, { tone: 'info' }, A.t(blocked)) : null,
      h('div', { className: 'mt-4' },
        h(E.Switch, {
          label: A.t('push.section'), hint: A.t('push.quietNote'), checked: !!s.subscribed,
          states: [A.t('se.off'), A.t('se.on')], disabled: s.loading || s.busy || !s.supported || !s.schoolEnabled || s.permission === 'denied',
          onChange: toggle
        })),
      h('p', { className: 'caption muted', 'aria-live': 'polite' },
        A.t('push.state') + ': ' + A.t(s.subscribed ? 'push.stateOn' : 'push.stateOff') + ' · ' + A.t('push.perm') + ': ' + A.t(permKey)),
      s.subscribed ? h('div', { className: 'row mt-2' }, h(E.Button, { icon: 'bell', size: 'sm', disabled: s.busy, onClick: sendTest }, A.t('push.test'))) : null,
      h('p', { className: 'caption muted' }, A.t('push.privacy')));
  }

  function Shortcuts(p) {
    var rows = (p.shortcuts && p.shortcuts.shortcuts) || [];
    return h('section', { className: 'card', 'aria-labelledby': 'h-skroty' },
      h('h2', { className: 'heading', id: 'h-skroty' }, A.t('shell.shortcuts')),
      h(E.Table, {
        caption: A.t('se.shortcutsCaption'), hideCaption: true,
        columns: [
          { key: 'keys', title: A.t('se.shortcut'), render: function (r) { return h(E.Kbd, { keys: r.keys, label: r.label }); } },
          { key: 'what', title: A.t('se.action'), render: scWhat },
          { key: 'scope', title: A.t('se.scope'), render: scScope }],
        rows: rows
      }),
      h('p', { className: 'caption muted' }, rows.length ? A.t('se.scNote') : ''),
      h('p', { className: 'caption muted' }, rows.length ? A.t('se.scSkip') : ''));
  }

  function Session(p) {
    var min = (p.config && p.config.sessionTimeoutMin) || 15;
    var warn = (p.config && p.config.sessionWarnBeforeMin) || 2;
    return h('section', { className: 'card', 'aria-labelledby': 'h-sesja' },
      h('h2', { className: 'heading', id: 'h-sesja' }, A.t('se.session')),
      h('p', null, A.t('se.sessionText', { min: min, warn: warn })),
      h('p', { className: 'caption muted' }, A.t('se.sessionNote')),
      h(E.Button, { icon: 'refresh', onClick: function () { A.touch().then(function () { A.toast(A.t('se.extended'), 'success'); }); } }, A.t('se.extend')));
  }

  A.screen({
    id: 'settings', path: '/ustawienia', title: 'Ustawienia i dostępność', module: 'core',
    component: function SettingsScreen(props) {
      var prefs = A.useApi('/api/me/preferences', []);
      var shortcuts = A.useApi('/api/shortcuts', []);
      var showQuiet = props.user.role === 'parent' || props.user.role === 'student';
      return h('div', { className: 'stack' },
        h('div', null,
          h('h1', { className: 'display app-title' }, A.t('shell.settings')),
          h('p', { className: 'app-sub' }, A.t('se.sub'))),
        h('div', { className: 'grid-2' },
          h(Appearance, null),
          h('div', { className: 'stack' },
            h(Language, null),
            showQuiet ? h(QuietHours, { prefs: prefs.data }) : null,
            h(PushCard, null),
            h(Session, { config: props.config }))),
        h(Video, null),
        h(Shortcuts, { shortcuts: shortcuts.data }));
    }
  });
})();
