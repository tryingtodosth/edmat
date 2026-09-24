/* Zgodność i dostępność (R4): deklaracja dostępności, ocena skutków (DPIA) i szkielet umowy
   powierzenia — wszystkie trzy generowane przez serwer z faktów tej instancji
   (GET /api/compliance/*). Ekran pokazuje kartę pakietu z przyciskami pobrania i druku w obu
   językach oraz renderuje treść wybranego dokumentu, żeby dało się ją przeczytać bez pobierania.
   Deklaracja dostępności jest pierwsza, bo to ona trafia na stronę szkoły. */
(function () {
  var E = window.EdMat, A = window.EdApp, h = React.createElement, F = React.Fragment;

  window.EdI18n.add({
    pl: {
      /* Rejestr zdarzeń dla IOD-a — ten sam komponent, co zakładka „Audyt” dyrekcji (screens/principal.js). */
      'cp.audit.title': 'Rejestr zdarzeń',
      'cp.audit.hint': 'Ten sam rejestr, który widzi dyrekcja. IOD czyta go tu, bo art. 39 RODO każe mu monitorować przestrzeganie zasad — a komentarze i notatki prywatne działają jak przy każdym innym wpisie.',
      'cp.title': 'Zgodność i dostępność',
      'cp.sub': 'Trzy dokumenty, które szkoła musi mieć przed wdrożeniem dziennika. Każdy powstaje z faktów tej instancji — spisu zbiorów, uprawnień ról, retencji i zabezpieczeń — a pola, których program znać nie może, są oznaczone do uzupełnienia.',
      'cp.pack': 'Pakiet zgodności',
      'cp.packHint': 'Dokumenty generujemy przy każdym otwarciu, więc pokazują stan na teraz, a nie stan z dnia wdrożenia.',
      'cp.doc': 'Dokument', 'cp.actions': 'Do pobrania i druku',
      'cp.docsCaption': 'Dokumenty pakietu zgodności',
      'cp.md': 'Markdown', 'cp.print': 'Druk', 'cp.show': 'Pokaż',
      /* WCAG 2.5.3 („etykieta w nazwie”): widoczny napis musi być częścią nazwy dostępnej, inaczej
         sterowanie głosem nie trafia w przycisk — stąd „{doc} — Markdown PL”, a nie „pobierz…”. */
      'cp.mdAria': '{doc} — Markdown {lang}', 'cp.printAria': '{doc} — Druk {lang}', 'cp.showAria': '{doc} — pokaż w aplikacji',
      'cp.notLegal': 'Żaden z tych dokumentów nie jest poradą prawną. Szablon wypełnia i zatwierdza szkoła wraz ze swoim Inspektorem Ochrony Danych; opis i zakres generowania: docs/compliance/README.md.',
      'cp.tabsLabel': 'Dokumenty pakietu zgodności',
      'cp.tab.accessibility': 'Deklaracja dostępności', 'cp.tab.dpia': 'Ocena skutków (DPIA)', 'cp.tab.dpa': 'Umowa powierzenia',
      'cp.langLegend': 'Język dokumentu',
      'cp.loading': 'Wczytywanie dokumentu…',
      'cp.said': 'Wczytano: {doc}, {lang}.', 'cp.saidLoading': 'Wczytywanie: {doc}, {lang}…', 'cp.saidError': 'Nie udało się wczytać: {doc}, {lang}.',
      'cp.docRegion': 'Treść dokumentu',
      'cp.error': 'Nie udało się wczytać dokumentu.',
      'cp.fill': 'do uzupełnienia przez szkołę',
      'cp.meta': 'Metryka dokumentu',
      'cp.stat.collections': 'Zbiory z danymi osobowymi', 'cp.stat.collectionsHint': '{all} kolekcji razem, {rows} wierszy z danymi osobowymi',
      'cp.stat.art9': 'Zbiory z danymi art. 9', 'cp.stat.art9Hint': 'pomoc p-p, gabinet, rejestr zdarzeń · {rows} wierszy',
      'cp.stat.sub': 'Podmioty przetwarzające', 'cp.stat.subNone': 'nic nie opuszcza serwera szkoły', 'cp.stat.subSome': 'push albo wideo są włączone',
      'cp.stat.a11y': 'Kryteria bez testu', 'cp.stat.a11yHint': '{tested} obszarów zbadanych automatycznie',
      'cp.gap': 'Publikacja deklaracji',
      'nav.compliance': 'Zgodność',
      /* Protokoły usunięcia danych — rejestr, który IOD czyta i komentuje (art. 17 RODO). */
      'cp.er.title': 'Protokoły usunięcia danych (RODO art. 17)',
      'cp.er.sub': 'Każde żądanie „prawa do bycia zapomnianym” zostawia protokół w rejestrze zdarzeń. Protokół jest zamrożony — uwagi do niego dopisuje się komentarzem obok, a notatkę prywatną widzi wyłącznie jej autor.',
      'cp.er.caption': 'Protokoły usunięcia danych',
      'cp.er.colAt': 'Data', 'cp.er.colWho': 'Kogo dotyczy', 'cp.er.colReason': 'Podstawa', 'cp.er.colCounts': 'Zakres', 'cp.er.colComments': 'Komentarze',
      'cp.er.counts': 'zanonimizowano {an} · usunięto {del} · komentarzy {lc}',
      'cp.er.none': 'Nie wykonano jeszcze żadnego żądania z art. 17.',
      'cp.er.loading': 'Wczytywanie protokołów…',
      'cp.gapText': 'Deklaracja jest już dostępna bez logowania — odnośnik stoi pod formularzem logowania, a sam dokument pod adresem /api/compliance/accessibility. Opublikuj ją także na stronie szkoły i w BIP (przycisk „Druk” albo „Markdown”) i wpisz adres tej publikacji w polu na BIP w punkcie 1 deklaracji.',
    },
    en: {
      'cp.audit.title': 'Audit register',
      'cp.audit.hint': 'The same register the head teacher sees. The DPO reads it here because Article 39 GDPR makes them monitor compliance; comments and private notes work as on any other entry.',
      'cp.title': 'Compliance and accessibility',
      'cp.sub': 'The three documents a school needs before it runs the logbook. Each is generated from this instance’s facts — the inventory, role permissions, retention and safeguards — and the fields the program cannot know are marked to be completed.',
      'cp.pack': 'Compliance pack',
      'cp.packHint': 'The documents are generated on every open, so they show the state now, not the state on the day of deployment.',
      'cp.doc': 'Document', 'cp.actions': 'Download and print',
      'cp.docsCaption': 'Documents in the compliance pack',
      'cp.md': 'Markdown', 'cp.print': 'Print', 'cp.show': 'Show',
      'cp.mdAria': '{doc} — Markdown {lang}', 'cp.printAria': '{doc} — Print {lang}', 'cp.showAria': '{doc} — show in the app',
      'cp.notLegal': 'None of these documents is legal advice. The template is completed and approved by the school together with its Data Protection Officer; what is generated and what is a template: docs/compliance/README.md.',
      'cp.tabsLabel': 'Documents in the compliance pack',
      'cp.tab.accessibility': 'Accessibility statement', 'cp.tab.dpia': 'Impact assessment (DPIA)', 'cp.tab.dpa': 'Processing agreement',
      'cp.langLegend': 'Language of the document',
      'cp.loading': 'Loading the document…',
      'cp.said': 'Loaded: {doc}, {lang}.', 'cp.saidLoading': 'Loading: {doc}, {lang}…', 'cp.saidError': 'Could not load: {doc}, {lang}.',
      'cp.docRegion': 'Document content',
      'cp.error': 'The document could not be loaded.',
      'cp.fill': 'to be completed by the school',
      'cp.meta': 'Document details',
      'cp.stat.collections': 'Collections with personal data', 'cp.stat.collectionsHint': '{all} collections in total, {rows} rows of personal data',
      'cp.stat.art9': 'Collections with art. 9 data', 'cp.stat.art9Hint': 'support, nurse, incidents · {rows} rows',
      'cp.stat.sub': 'Processors', 'cp.stat.subNone': 'nothing leaves the school’s server', 'cp.stat.subSome': 'push or video is switched on',
      'cp.stat.a11y': 'Criteria with no test', 'cp.stat.a11yHint': '{tested} areas verified automatically',
      'cp.gap': 'Publishing the statement',
      'nav.compliance': 'Compliance',
      'cp.er.title': 'Erasure protocols (GDPR art. 17)',
      'cp.er.sub': 'Every right-to-be-forgotten request leaves a protocol in the audit log. The protocol is frozen — remarks go beside it as a comment, and a private note is visible only to its author.',
      'cp.er.caption': 'Erasure protocols',
      'cp.er.colAt': 'Date', 'cp.er.colWho': 'Subject', 'cp.er.colReason': 'Legal basis', 'cp.er.colCounts': 'Scope', 'cp.er.colComments': 'Comments',
      'cp.er.counts': 'anonymised {an} · deleted {del} · comments {lc}',
      'cp.er.none': 'No art. 17 request has been carried out yet.',
      'cp.er.loading': 'Loading the protocols…',
      'cp.gapText': 'The statement is already reachable without signing in — the link sits under the login form and the document itself is at /api/compliance/accessibility. Publish it on the school’s website and in the public information bulletin as well (the “Print” or “Markdown” button), and put that address in the BIP field in section 1 of the statement.',
    },
  });
  var t = A.t;
  var KINDS = ['accessibility', 'dpia', 'dpa'];

  function docUrl(kind, locale, format) { return '/api/compliance/' + kind + '?locale=' + locale + (format ? '&format=' + format : ''); }

  /* ---------- karta pakietu: trzy dokumenty, pięć przycisków na każdy ----------
     U3-02 — tabela jedzie przez `E.Table`, a nie przez surowe `<table class="ed-table">`: to stamtąd
     bierze się poziomy przewijak z widocznym uchwytem i układ „wiersz pod wierszem” poniżej 720 px.
     Bez niego polska wersja rozpychała kartę do 423 px w oknie 390 px i cała strona jechała w bok —
     razem z nagłówkiem h1 i paskiem nawigacji (WCAG 1.4.10). Wersja angielska mieściła się o kilka
     pikseli, więc w buildzie „en” błędu nie było widać. */
  function PackCard(p) {
    var d = p.data;
    var rows = KINDS.map(function (kind) {
      var title = t('cp.tab.' + kind);
      return {
        id: kind, doc: title,
        actions: h('div', { className: 'row', style: { flexWrap: 'wrap', gap: 'var(--space-1)' } },
          ['pl', 'en'].map(function (lang) {
            return h(E.Button, {
              key: 'md-' + lang, size: 'sm', icon: 'download', href: (A.base || '') + docUrl(kind, lang) + '&download=1', target: '_blank',
              'aria-label': t('cp.mdAria', { doc: title, lang: lang.toUpperCase() }),
            }, t('cp.md') + ' ' + lang.toUpperCase());
          }),
          ['pl', 'en'].map(function (lang) {
            return h(E.Button, {
              key: 'pr-' + lang, size: 'sm', icon: 'print',
              'aria-label': t('cp.printAria', { doc: title, lang: lang.toUpperCase() }),
              onClick: function () { A.openPrint(docUrl(kind, lang, 'html') + '&print=1'); },
            }, t('cp.print') + ' ' + lang.toUpperCase());
          }),
          /* U3-16 — trzy przyciski o nazwie „Pokaż” brzmiały w czytniku ekranu identycznie. */
          h(E.Button, { key: 'show', size: 'sm', variant: 'quiet', icon: 'file', 'aria-label': t('cp.showAria', { doc: title }), onClick: function () { p.onShow(kind); } }, t('cp.show'))),
      };
    });
    var s = d && d.summary;
    return h('section', { className: 'card', 'aria-label': t('cp.pack') },
      h('h2', { className: 'subheading' }, t('cp.pack')),
      h('p', { className: 'muted' }, t('cp.packHint')),
      s ? h('div', { className: 'grid-3' },
        h(E.StatTile, { label: t('cp.stat.collections'), value: String(s.personalCollections), hint: t('cp.stat.collectionsHint', { all: s.collections, rows: s.personalRows }) }),
        h(E.StatTile, { label: t('cp.stat.art9'), value: String(s.art9Collections.length), hint: t('cp.stat.art9Hint', { rows: s.art9Rows }) }),
        h(E.StatTile, { label: t('cp.stat.sub'), value: String(s.subProcessors), hint: s.subProcessors ? t('cp.stat.subSome') : t('cp.stat.subNone') }),
        h(E.StatTile, { label: t('cp.stat.a11y'), value: String(s.a11yUntested), hint: t('cp.stat.a11yHint', { tested: s.a11yTested }) })) : null,
      h('div', { className: 'mt-4' }, h(E.Table, {
        caption: t('cp.docsCaption'), stack: true,
        columns: [{ key: 'doc', title: t('cp.doc') }, { key: 'actions', title: t('cp.actions'), render: function (row) { return row.actions; } }],
        rows: rows,
      })),
      h(E.Alert, { tone: 'info', className: 'mt-4' }, t('cp.notLegal')));
  }

  /* ---------- protokoły usunięcia danych (art. 17) z komentarzami ----------
     Wpis protokołu jest zamrożony (S-15), więc uwaga IOD-a nie zmienia protokołu — staje obok niego
     jako komentarz albo notatka prywatna. Komentować może każdy, kto ten protokół widzi, czyli IOD
     i administrator: dokładnie ta sama bramka, co GET /api/privacy/erasures. */
  function ErasuresCard() {
    var api = A.useApi('/api/privacy/erasures', []);
    var d = api.data;
    var rows = (d && d.erasures) || [];
    var counts = (d && d.comments) || {};
    var sum = function (o) { return Object.keys(o || {}).reduce(function (n, k) { return n + o[k]; }, 0); };
    var columns = [
      { key: 'at', title: t('cp.er.colAt'), render: function (r) { return A.fmtDateTime(r.at); } },
      { key: 'entityId', title: t('cp.er.colWho'), render: function (r) { return h('span', { className: 'ed-mono' }, r.entityId || '—'); } },
      { key: 'reason', title: t('cp.er.colReason'), render: function (r) { return r.reason || '—'; } },
      { key: 'counts', title: t('cp.er.colCounts'), render: function (r) {
        var s = r.summary || {};
        return h('span', { className: 'caption muted' }, t('cp.er.counts', {
          an: (s.totals && s.totals.anonymised) || sum(s.anonymised),
          del: (s.totals && s.totals.deleted) || sum(s.deleted),
          lc: (s.logComments && (s.logComments.byAuthor + s.logComments.withEntry)) || 0
        }));
      } },
      { key: 'comments', title: t('cp.er.colComments'), render: function (r) {
        return h(window.EdLogComments.Toggle, { kind: 'erasures', entryId: r.id, counts: counts[r.id], onChange: api.reload });
      } }
    ];
    return h('section', { className: 'card', 'aria-label': t('cp.er.title') },
      h('h2', { className: 'subheading' }, t('cp.er.title')),
      h('p', { className: 'muted' }, t('cp.er.sub')),
      api.error ? h(E.Alert, { tone: 'danger' }, api.error.message) : null,
      api.loading && !d ? h('p', { className: 'muted' }, t('cp.er.loading')) : null,
      d && !rows.length ? h(E.Alert, { tone: 'info' }, t('cp.er.none')) : null,
      rows.length ? h(E.Table, { caption: t('cp.er.caption'), hideCaption: true, stack: true, columns: columns, rows: rows }) : null);
  }

  /* ---------- renderer struktury dokumentu (ta sama, z której powstaje Markdown i wydruk) ---------- */
  function Block(p) {
    var b = p.b;
    if (b.p) return h('p', null, b.p);
    if (b.ul) return h('ul', null, b.ul.map(function (x, i) { return h('li', { key: i }, x); }));
    if (b.fill) return h('p', null, h('b', null, b.fill + ': '), h(E.Badge, { tone: 'info', icon: 'edit' }, t('cp.fill')));
    if (b.table) {
      var tb = b.table;
      return h('div', { style: { overflowX: 'auto' } }, h('table', { className: 'ed-table' },
        h('caption', null, tb.caption),
        h('thead', null, h('tr', null, tb.head.map(function (c, i) { return h('th', { key: i, scope: 'col' }, c); }))),
        h('tbody', null, tb.rows.map(function (r, i) {
          return h('tr', { key: i }, r.map(function (c, j) { return j === 0 ? h('th', { key: j, scope: 'row' }, c) : h('td', { key: j }, c); }));
        }))));
    }
    return null;
  }
  function DocView(p) {
    var d = p.doc;
    if (!d) return null;
    return h('article', { className: 'stack', tabIndex: -1, ref: p.innerRef, 'aria-label': t('cp.docRegion') },
      h('h2', { className: 'subheading' }, d.title),
      d.subtitle ? h('p', { className: 'muted' }, d.subtitle) : null,
      (d.meta || []).length ? h('table', { className: 'ed-table' },
        h('caption', null, t('cp.meta')),
        h('tbody', null, d.meta.map(function (m, i) { return h('tr', { key: i }, h('th', { scope: 'row' }, m[0]), h('td', null, m[1] === null || m[1] === '' ? '—' : m[1])); }))) : null,
      d.sections.map(function (s, i) {
        return h('section', { key: i, className: 'stack' },
          h('h3', { className: 'subheading' }, s.h),
          s.blocks.map(function (b, j) { return h(Block, { key: j, b: b }); }));
      }),
      h('p', { className: 'muted' }, d.footer));
  }

  function Screen(props) {
    var app = A.useAppState();
    var st = React.useState({ kind: (props.route.query.doc && KINDS.indexOf(props.route.query.doc) >= 0) ? props.route.query.doc : 'accessibility', lang: app.locale });
    var f = st[0], set = st[1];
    var list = A.useApi('/api/compliance?locale=' + app.locale, [app.locale]);
    var doc = A.useApi(docUrl(f.kind, f.lang, 'json'), [f.kind, f.lang]);
    /* U3-03 — cały dokument (8 483 znaków prawniczej prozy) siedział w jednym obszarze
       `aria-live="polite"`, więc każde przełączenie zakładki, każda zmiana języka i samo wejście na
       ekran czytały deklarację od nowa; do zakładek nie dało się dojść. Komunikat o stanie to jedno
       krótkie zdanie, a sam dokument jest zwykłą treścią — po przełączeniu przenosimy na niego fokus,
       więc czytnik zaczyna od jego nagłówka i można stamtąd czytać dalej albo wrócić Shift+Tab. */
    var docRef = React.useRef(null);
    var first = React.useRef(true);
    React.useEffect(function () {
      if (first.current) { first.current = false; return; }          // po wejściu na ekran fokus zostaje na h1
      if (!doc.loading && !doc.error && docRef.current && docRef.current.focus) docRef.current.focus();
    }, [f.kind, f.lang, doc.loading]);
    var docTitle = t('cp.tab.' + f.kind), langLabel = f.lang.toUpperCase();
    var said = doc.loading ? t('cp.saidLoading', { doc: docTitle, lang: langLabel })
      : doc.error ? t('cp.saidError', { doc: docTitle, lang: langLabel })
        : t('cp.said', { doc: docTitle, lang: langLabel });
    return h(F, null,
      h('h1', { className: 'display app-title' }, t('cp.title')),
      h('p', { className: 'app-sub' }, t('cp.sub')),
      h('div', { className: 'stack' },
        h(PackCard, { data: list.data, onShow: function (k) { set({ kind: k, lang: f.lang }); } }),
        h('section', { className: 'card', 'aria-label': t('cp.tabsLabel') },
          h('div', { className: 'row', style: { justifyContent: 'space-between', flexWrap: 'wrap', gap: 'var(--space-2)' } },
            h(E.Tabs, {
              tabs: KINDS.map(function (k) { return { id: k, label: t('cp.tab.' + k) }; }),
              value: f.kind, label: t('cp.tabsLabel'),
              onChange: function (k) { set({ kind: k, lang: f.lang }); A.navigate('/dostepnosc', { doc: k }); },
            }),
            h('div', { role: 'group', 'aria-label': t('cp.langLegend'), className: 'row', style: { gap: 'var(--space-1)' } },
              ['pl', 'en'].map(function (lang) {
                return h(E.Button, {
                  key: lang, size: 'sm', variant: f.lang === lang ? 'primary' : 'quiet',
                  'aria-pressed': f.lang === lang ? 'true' : 'false',
                  onClick: function () { set({ kind: f.kind, lang: lang }); },
                }, lang.toUpperCase());
              }))),
          h('p', { className: 'muted', role: 'status', 'aria-live': 'polite' }, said),
          h('div', { className: 'mt-4' },
            doc.loading ? h('p', { className: 'muted' }, t('cp.loading'))
              : doc.error ? h(E.Alert, { tone: 'danger' }, doc.error.message || t('cp.error'))
                : h(DocView, { doc: doc.data ? docOf(doc.data) : null, innerRef: docRef }))),
        f.kind === 'accessibility' ? h(E.Alert, { tone: 'info', title: t('cp.gap') }, t('cp.gapText')) : null,
        /* Lista protokołów jest dla IOD-a i administratora — dyrektor tej trasy nie czyta. */
        app.user && (app.user.role === 'dpo' || app.user.role === 'admin') ? h(ErasuresCard, null) : null,
        /* Rejestr zdarzeń: trasa GET /api/principal/audit wpuszcza IOD-a, więc ma go widzieć na ekranie, nie tylko
           przez API. Dyrektor ma ten sam komponent w zakładce „Audyt”; komponent dostarcza screens/principal.js. */
        app.user && app.user.role === 'dpo' && window.EdPrincipal ? h('section', { className: 'card', 'aria-label': t('cp.audit.title') },
          h('h2', { className: 'subheading' }, t('cp.audit.title')),
          h('p', { className: 'muted' }, t('cp.audit.hint')),
          h(window.EdPrincipal.AuditRegister, null)) : null));
  }
  /* Serwer zwraca w postaci JSON metadane, Markdown i HTML; strukturę sekcji bierzemy z pola `doc`,
     które `format=json` dokłada obok nich. */
  function docOf(payload) { return payload.doc || null; }

  A.screen({
    id: 'compliance', path: '/dostepnosc', title: 'Zgodność i dostępność', module: 'compliance',
    roles: ['dpo', 'admin', 'principal'],
    nav: { key: 'nav.compliance', label: 'Zgodność', order: 96 },
    component: Screen,
  });
})();
