/* "Zgłoś błąd" — the site's own reporter, in this demo's top bar and footer.
 *
 * EdMat puts one button in two standing places on every page: under the wordmark in the top bar,
 * and in the footer. This is the same button, so somebody moving between the two products finds
 * the same thing in the same corner. What it files goes to the same table
 * (`backend/issues/models.py`) by way of this demo's own server
 * (`server/routes/report-issue.js` — the browser never talks to the site's API).
 *
 * Two things it does that the site's version cannot:
 *
 * - **It fills "what is this about" in by itself.** The screen you are on already names its module
 *   (`A.screen({ module: 'grades' })`), and that module is exactly the `area` the backend files
 *   under. It stays editable, because the person reporting knows better than the router does.
 * - **It carries the role.** In a school system the same screen is a different product to a parent
 *   and to a registrar, so the report is worth little without it. The server attaches it from the
 *   session rather than trusting the page, so it cannot be claimed.
 *
 * One dialog, mounted once by the shell, opened from both buttons through `A.reportIssue.open()` —
 * two copies of a form is two sets of half-typed text.
 */
(function () {
  var A = window.EdApp, E = window.EdMat, h = React.createElement;
  var t = EdI18n.t;

  EdI18n.add({
    pl: {
      'ri.open': 'Zgłoś błąd',
      'ri.title': 'Zgłoś błąd',
      'ri.intro': 'Napisz, co jest nie tak albo czego brakuje. Zgłoszenie trafia do zespołu EdMat razem z informacją, na którym ekranie jesteś i w jakiej roli.',
      'ri.kind': 'Rodzaj zgłoszenia',
      'ri.kind.bug': 'Coś nie działa',
      'ri.kind.content': 'Błędna lub myląca treść',
      'ri.kind.idea': 'Pomysł lub sugestia',
      'ri.kind.other': 'Coś innego',
      'ri.area': 'Czego dotyczy',
      'ri.area.none': 'Nie wiem / całość',
      'ri.subject': 'Tytuł',
      'ri.subjectPh': 'Jednym zdaniem, co się stało',
      'ri.body': 'Opis',
      'ri.bodyPh': 'Co robiłaś/robiłeś, czego się spodziewałaś/spodziewałeś i co się stało zamiast tego.',
      'ri.contact': 'E-mail do kontaktu (opcjonalnie)',
      'ri.contactHint': 'Tylko po to, żeby dopytać. Bez niego nikt nie odpisze.',
      'ri.anon': 'Zgłoś anonimowo',
      'ri.anonHint': 'Nie zapiszemy, kto to zgłosił, ani adresu e-mail. Nikt nie będzie mógł dopytać.',
      'ri.public': 'Zgadzam się, żeby to zgłoszenie było widoczne publicznie na stronie EdMat',
      'ri.context': 'Dołączamy: ekran ({screen}), rolę ({role}), język i przeglądarkę.',
      'ri.contextNoRole': 'Dołączamy: ekran ({screen}), język i przeglądarkę.',
      'ri.send': 'Wyślij zgłoszenie',
      'ri.sent': 'Dziękujemy — zgłoszenie zostało wysłane do zespołu EdMat.',
      'ri.savedOnly': 'Zgłoszenie zostało zapisane w tej instancji, ale nie udało się go teraz przekazać do EdMat. Nic nie przepadło — administrator może je wyeksportować.',
      'ri.needTitle': 'Wpisz krótki tytuł zgłoszenia.',
      'ri.footerReport': 'Zgłoś błąd',
      'ri.footerNote': 'Demonstracja dziennika EdMat — dane są zmyślone.'
    },
    en: {
      'ri.open': 'Report issue',
      'ri.title': 'Report issue',
      'ri.intro': 'Tell us what is wrong or missing. The report reaches the EdMat team together with which screen you are on and in which role.',
      'ri.kind': 'Kind of report',
      'ri.kind.bug': 'Something is broken',
      'ri.kind.content': 'Wrong or misleading content',
      'ri.kind.idea': 'An idea or suggestion',
      'ri.kind.other': 'Something else',
      'ri.area': 'What it is about',
      'ri.area.none': "I don't know / the whole thing",
      'ri.subject': 'Title',
      'ri.subjectPh': 'In one sentence, what happened',
      'ri.body': 'Description',
      'ri.bodyPh': 'What you were doing, what you expected, and what happened instead.',
      'ri.contact': 'Contact email (optional)',
      'ri.contactHint': 'Only so somebody can ask you more. Without it nobody can reply.',
      'ri.anon': 'Report anonymously',
      'ri.anonHint': 'We store neither who reported it nor an email address. Nobody will be able to follow up.',
      'ri.public': 'I agree this report may be shown publicly on the EdMat site',
      'ri.context': 'Attached: the screen ({screen}), your role ({role}), the language and the browser.',
      'ri.contextNoRole': 'Attached: the screen ({screen}), the language and the browser.',
      'ri.send': 'Send report',
      'ri.sent': 'Thank you — your report reached the EdMat team.',
      'ri.savedOnly': 'Your report was saved in this instance, but could not be handed to EdMat right now. Nothing is lost — an administrator can export it.',
      'ri.needTitle': 'Give the report a short title.',
      'ri.footerReport': 'Report issue',
      'ri.footerNote': 'An EdMat logbook demonstration — the data is invented.'
    }
  });

  /* The labels for `area`. Mirrors server/modules.js, whose ids are what the backend files under;
     `''` is offered first because "I don't know which part" is a legitimate and common answer, and
     forcing a guess produces a wrong category rather than no category. */
  var AREA_KEYS = ['core', 'logbook', 'grades', 'homeroom', 'principal', 'support', 'registry', 'student', 'parent', 'messages', 'school', 'courses', 'meetings', 'compliance', 'demo'];
  EdI18n.add({
    pl: { 'ri.a.core': 'Logowanie i konto', 'ri.a.logbook': 'Dziennik lekcyjny', 'ri.a.grades': 'Oceny i uwagi', 'ri.a.homeroom': 'Wychowawca', 'ri.a.principal': 'Dyrekcja', 'ri.a.support': 'Pomoc psychologiczno-pedagogiczna', 'ri.a.registry': 'Sekretariat', 'ri.a.student': 'Konto ucznia', 'ri.a.parent': 'Konto rodzica', 'ri.a.messages': 'Wiadomości', 'ri.a.school': 'Świetlica, stołówka, biblioteka', 'ri.a.courses': 'Kursy i materiały', 'ri.a.meetings': 'Spotkania wideo', 'ri.a.compliance': 'Zgodność i dostępność', 'ri.a.demo': 'Tryb demonstracyjny' },
    en: { 'ri.a.core': 'Signing in and the account', 'ri.a.logbook': 'Lesson logbook', 'ri.a.grades': 'Grades and remarks', 'ri.a.homeroom': 'Homeroom', 'ri.a.principal': 'Principal', 'ri.a.support': 'Psychological and pedagogical support', 'ri.a.registry': 'Registrar', 'ri.a.student': 'Student account', 'ri.a.parent': 'Parent account', 'ri.a.messages': 'Messages', 'ri.a.school': 'After-school care, cafeteria, library', 'ri.a.courses': 'Courses and materials', 'ri.a.meetings': 'Video meetings', 'ri.a.compliance': 'Compliance and accessibility', 'ri.a.demo': 'Demo mode' }
  });

  /** The module of the screen the person is looking at — the `area` the report files under. '' when
   *  nothing matches, which is the login screen and any unknown path. */
  function currentArea() {
    var s = A.state;
    if (!s.user) return 'core';
    var screen = A.matchScreen(s.user, s.route.path);
    return (screen && screen.module) || '';
  }

  /* Opening captures where the person was at the moment they asked, before the dialog renders over
     it — the same reason the site's own store does (frontend/src/lib/state/issueReport.svelte.ts). */
  function open() {
    A.setState({ reportIssue: { screen: (location.hash || '#/').slice(1), pageTitle: document.title, area: currentArea() } });
  }
  function close() { A.setState({ reportIssue: null }); }

  function ReportDialog(p) {
    var at = p.at;
    var st = React.useState({ kind: 'bug', area: at.area || '', title: '', body: '', contact: '', anonymous: false, isPublic: false, busy: false });
    var f = st[0], set = function (patch) { st[1](Object.assign({}, f, patch)); };

    var send = function () {
      if (f.title.trim().length < 3) { A.toast(t('ri.needTitle'), 'danger'); return; }
      set({ busy: true });
      A.api.post('/api/report-issue', {
        kind: f.kind, area: f.area, title: f.title.trim(), body: f.body,
        screen: at.screen, pageTitle: at.pageTitle, locale: EdI18n.get(),
        viewport: window.innerWidth + '×' + window.innerHeight,
        contact: f.contact, anonymous: f.anonymous, isPublic: f.isPublic
      }).then(function (r) {
        close();
        /* Two different true things, and the difference matters to somebody running a pilot: the
           report always survives, but it has not always been handed over. */
        A.toast(r && r.forwarded ? t('ri.sent') : t('ri.savedOnly'), r && r.forwarded ? 'success' : 'warning');
      }).catch(function (e) {
        set({ busy: false });
        A.toast((e && e.message) || t('common.error'), 'danger');
      });
    };

    var role = A.state.user ? t('role.' + A.state.user.role) : '';
    return h(E.Dialog, {
      title: t('ri.title'), onClose: close, initialFocus: '[data-autofocus]', actions: [
        h(E.Button, { key: 'c', onClick: close }, t('common.cancel')),
        h(E.Button, { key: 's', variant: 'primary', icon: 'check', loading: f.busy, disabled: f.busy || f.title.trim().length < 3, onClick: send }, t('ri.send'))]
    },
      h('div', { className: 'stack' },
        h('p', { className: 'muted' }, t('ri.intro')),
        h(E.TextField, {
          label: t('ri.subject'), 'data-autofocus': true, required: true, width: '100%',
          placeholder: t('ri.subjectPh'), value: f.title,
          onChange: function (e) { set({ title: e.target.value }); }
        }),
        h(E.Select, {
          label: t('ri.kind'), value: f.kind,
          options: ['bug', 'content', 'idea', 'other'].map(function (k) { return { value: k, label: t('ri.kind.' + k) }; }),
          onChange: function (e) { set({ kind: e.target.value }); }
        }),
        h(E.Select, {
          label: t('ri.area'), value: f.area,
          options: [{ value: '', label: t('ri.area.none') }].concat(AREA_KEYS.map(function (k) { return { value: k, label: t('ri.a.' + k) }; })),
          onChange: function (e) { set({ area: e.target.value }); }
        }),
        h(E.TextField, {
          label: t('ri.body'), multiline: 4, width: '100%', placeholder: t('ri.bodyPh'), value: f.body,
          onChange: function (e) { set({ body: e.target.value }); }
        }),
        h('p', { className: 'muted small' }, role ? t('ri.context', { screen: at.screen, role: role }) : t('ri.contextNoRole', { screen: at.screen })),
        h(E.Checkbox, {
          label: t('ri.anon'), checked: f.anonymous,
          onChange: function (e) { set({ anonymous: !!(e && e.target ? e.target.checked : e) }); }
        }),
        /* The email box disappears rather than being disabled when the box above is ticked: an
           anonymous report stores no address at all (backend/issues/models.py), and a greyed-out
           field that still holds what somebody typed suggests otherwise. */
        f.anonymous
          ? h('p', { className: 'muted small' }, t('ri.anonHint'))
          : h(E.TextField, {
              label: t('ri.contact'), type: 'email', width: '100%', value: f.contact,
              hint: t('ri.contactHint'),
              onChange: function (e) { set({ contact: e.target.value }); }
            }),
        h(E.Checkbox, {
          label: t('ri.public'), checked: f.isPublic,
          onChange: function (e) { set({ isPublic: !!(e && e.target ? e.target.checked : e) }); }
        })));
  }

  /** The top-bar button — quiet and small, because it sits beside the bell and the account menu and
   *  must not compete with the navigation it is next to. */
  /* The label goes in a <span>, and the name is also on the button itself.
   *
   * bundle.css: `@media (max-width: 560px) { .ed-topbar-right .ed-btn > span:not(.ed-avatar) {
   * display: none } }` is the design system's answer to a crowded top bar on a phone: a button
   * there collapses to its icon. It can only do that if the label IS a span — passed as a bare
   * string the text stayed, and one extra word pushed .ed-topbar-right to 564px inside a 390px
   * window, which is the horizontal scrollbar [3.9.2] and [3.9.10] measure.
   * `aria-label` because `display: none` takes the label out of the accessible name too, and a
   * button that reads as "" to a screen reader is a worse bug than the one being fixed. */
  function TopBarButton() {
    return h(E.Button, { variant: 'quiet', size: 'sm', icon: 'alert-circle', className: 'app-report-topbar', onClick: open, 'aria-label': t('ri.open'), style: { color: 'var(--ink)' } }, h('span', null, t('ri.open')));
  }

  /** The footer. The demo had none; the site's carries this same button beside its standing
   *  disclosures, and that is the other place a person looks for it. */
  function Footer(p) {
    var school = p.config && p.config.school ? (p.config.school.short || p.config.school.name) : '';
    return h('footer', { className: 'app-footer no-print' },
      h('p', { className: 'muted small' }, school ? school + ' · ' + t('ri.footerNote') : t('ri.footerNote')),
      h('p', { className: 'app-footer__links' },
        h('button', { type: 'button', className: 'app-linklike', onClick: open }, t('ri.footerReport')),
        h('a', { href: (A.base || '') + '/api/compliance/accessibility?format=html', target: '_blank', rel: 'noopener' }, t('shell.accessibility'))));
  }

  A.reportIssue = { open: open, close: close, Dialog: ReportDialog, TopBarButton: TopBarButton, Footer: Footer };
})();
