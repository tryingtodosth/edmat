/* Ekran „Wydarzenia” (moduł events, 3.10): karta wydarzenia od strony organizatora — cel i granice,
   plan sal z pojemnością użytkową, grafik dyżurów z ochroną małoletnich wolontariuszy, instruktaże
   w warstwach, bramka wejściowa działająca bez sieci, liczby cateringowe i rejestr ryzyka.
   Wycieczki prowadzi ekran „Moduły” (3.8), a widok rodzica na zebrania — ekran rodzica (3.7.8). */
(function () {
  var E = window.EdMat, A = window.EdApp, h = React.createElement;
  var t = function (k, v) { return A.t(k, v); };

  window.EdI18n.add({
    pl: {
      'ev.title': 'Wydarzenia szkolne', 'ev.sub': 'Dni otwarte, festyny i uroczystości: karta wydarzenia, sale, dyżury, instruktaże i wejścia.',
      'ev.loading': 'Wczytywanie wydarzeń…', 'ev.none': 'Nie ma jeszcze żadnego wydarzenia.', 'ev.err': 'Nie udało się wykonać operacji.',
      'ev.back': 'Wszystkie wydarzenia', 'ev.open': 'Otwórz kartę',
      'ev.stat.events': 'Wydarzenia', 'ev.stat.short': 'Nieobsadzone dyżury', 'ev.stat.risks': 'Ryzyko do zamknięcia', 'ev.stat.capacity': 'Pojemność sal',
      'ev.status.draft': 'Wersja robocza', 'ev.status.submitted': 'Złożone do zatwierdzenia', 'ev.status.approved': 'Zatwierdzone', 'ev.status.closed': 'Zamknięte',
      'ev.tab.brief': 'Karta', 'ev.tab.rooms': 'Sale', 'ev.tab.rota': 'Grafik', 'ev.tab.briefings': 'Instruktaże', 'ev.tab.gate': 'Bramka', 'ev.tab.catering': 'Catering', 'ev.tab.risks': 'Ryzyko',
      'ev.f.objective': 'Cel wydarzenia', 'ev.f.outcome': 'Co się zmienia po wydarzeniu', 'ev.f.measure': 'Miara celu',
      'ev.f.redLines': 'Granice nienegocjowalne', 'ev.f.expected': 'Przewidywana frekwencja', 'ev.f.leader': 'Organizator',
      'ev.redLine': 'Granica', 'ev.noRedLines': 'Nie zapisano granic nienegocjowalnych.',
      'ev.rooms.caption': 'Sale wydarzenia, pojemność użytkowa i limit przeciwpożarowy',
      'ev.rooms.name': 'Sala', 'ev.rooms.layout': 'Układ', 'ev.rooms.area': 'Powierzchnia', 'ev.rooms.capacity': 'Pojemność', 'ev.rooms.fire': 'Limit ppoż.', 'ev.rooms.expected': 'Frekwencja',
      'ev.rooms.none': 'Nie zaplanowano jeszcze sal.', 'ev.rooms.over': 'Ponad pojemność', 'ev.rooms.overFire': 'Ponad limit ppoż.', 'ev.rooms.ok': 'Mieści się',
      'ev.rooms.buffer': 'Pojemność liczy się z powierzchni pomniejszonej o zapas na ciągi komunikacyjne i miejsca dla osób poruszających się na wózku. Limit przeciwpożarowy sali zawsze ją ogranicza.',
      'ev.rota.caption': 'Dyżury na stanowiskach', 'ev.rota.station': 'Stanowisko', 'ev.rota.time': 'Godziny', 'ev.rota.people': 'Osoby', 'ev.rota.need': 'Obsada',
      'ev.rota.none': 'Nie ma jeszcze żadnego dyżuru.', 'ev.rota.short': 'Brakuje {n}', 'ev.rota.full': 'Obsadzony', 'ev.rota.pending': 'Oczekuje na dorosłego',
      'ev.rota.claim': 'Zapisz mnie', 'ev.rota.release': 'Wypisz mnie', 'ev.rota.claimed': 'Zapis potwierdzony.', 'ev.rota.released': 'Wypisano z dyżuru.',
      'ev.rota.noAdult': 'Na tym dyżurze nie ma jeszcze osoby dorosłej.',
      'ev.rota.minorRules': 'Wolontariusz poniżej {age} lat: najwyżej {hours} h dziennie, nie w godzinach {from}–{to}, co najmniej {gap} min przerwy między dyżurami i zawsze z osobą dorosłą na stanowisku.',
      'ev.brief.none': 'Nie opublikowano instruktaży dla Twojej roli.', 'ev.brief.tier': 'Warstwa', 'ev.brief.version': 'Wersja',
      'ev.brief.ack': 'Potwierdzam zapoznanie się', 'ev.brief.acked': 'Potwierdzone', 'ev.brief.hidden': 'Instruktaże poza Twoją warstwą: {n}',
      'ev.brief.unread': 'Masz {n} niepotwierdzonych instruktaży — narzędzia dyżurowe pozostają zamknięte.',
      'ev.brief.done': 'Potwierdzenie zapisane.', 'ev.brief.myTier': 'Twoja warstwa dostępu',
      'ev.gate.title': 'Bramka wejściowa', 'ev.gate.scan': 'Kod z wejściówki', 'ev.gate.add': 'Zarejestruj wejście',
      'ev.gate.queue': 'W kolejce: {n}', 'ev.gate.send': 'Wyślij kolejkę', 'ev.gate.sent': 'Kolejka rozliczona.',
      'ev.gate.inside': 'W środku', 'ev.gate.issued': 'Wydane wejściówki',
      'ev.gate.offline': 'Brak sieci — skany czekają w przeglądarce i rozliczą się same po jej powrocie.',
      'ev.gate.online': 'Połączenie jest — skany rozliczają się na bieżąco.',
      'ev.gate.blocked': 'Najpierw potwierdź instruktaż obsługi w zakładce „Instruktaże”.',
      'ev.gate.r.ok': 'Wejście zarejestrowane', 'ev.gate.r.duplicate': 'Już w środku', 'ev.gate.r.collision': 'Kolizja — zatrzymaj i wyjaśnij',
      'ev.gate.r.unknown': 'Wejściówka spoza tego wydarzenia', 'ev.gate.r.revoked': 'Wejściówka unieważniona', 'ev.gate.r.rejected': 'Skan odrzucony',
      'ev.gate.device': 'Oznaczenie bramki', 'ev.gate.privacy': 'Kod QR niesie wyłącznie losowy token. Imię, nazwisko ani numer PESEL nie są w nim zapisane.',
      'ev.cat.caption': 'Zgłoszenia żywieniowe — wyłącznie liczby', 'ev.cat.diet': 'Dieta', 'ev.cat.allergen': 'Alergen', 'ev.cat.count': 'Liczba',
      'ev.cat.declared': 'Zgłoszenia', 'ev.cat.undeclared': 'Bez zgłoszenia', 'ev.cat.none': 'Nie ma jeszcze zgłoszeń żywieniowych.',
      'ev.cat.privacy': 'Raport jest zbiorczy — imienna lista diet i alergii nie opuszcza dziennika.',
      'ev.risk.caption': 'Rejestr ryzyka wydarzenia', 'ev.risk.hazard': 'Zagrożenie', 'ev.risk.cat': 'Kategoria',
      'ev.risk.p': 'Prawdopodobieństwo', 'ev.risk.s': 'Skutek', 'ev.risk.score': 'Ocena', 'ev.risk.band': 'Pasmo', 'ev.risk.control': 'Środek zaradczy',
      'ev.risk.none': 'Rejestr ryzyka jest pusty.', 'ev.risk.low': 'Niskie', 'ev.risk.medium': 'Średnie', 'ev.risk.unacceptable': 'Nieakceptowalne',
      'ev.risk.blocks': '{n} pozycji w paśmie nieakceptowalnym — dopóki tam są, dyrekcja nie zatwierdzi wydarzenia.',
      'ev.approve': 'Zatwierdź wydarzenie', 'ev.approved': 'Wydarzenie zatwierdzone.',
      'ev.print': 'Karta przebiegu (wydruk)', 'ev.retention': 'Dane ulotne znikają {date}'
    },
    en: {
      'ev.title': 'School events', 'ev.sub': 'Open days, fetes and ceremonies: the event brief, rooms, shifts, briefings and entry.',
      'ev.loading': 'Loading events…', 'ev.none': 'No events yet.', 'ev.err': 'The operation failed.',
      'ev.back': 'All events', 'ev.open': 'Open the brief',
      'ev.stat.events': 'Events', 'ev.stat.short': 'Unfilled shifts', 'ev.stat.risks': 'Risks to close', 'ev.stat.capacity': 'Room capacity',
      'ev.status.draft': 'Draft', 'ev.status.submitted': 'Submitted for approval', 'ev.status.approved': 'Approved', 'ev.status.closed': 'Closed',
      'ev.tab.brief': 'Brief', 'ev.tab.rooms': 'Rooms', 'ev.tab.rota': 'Rota', 'ev.tab.briefings': 'Briefings', 'ev.tab.gate': 'Gate', 'ev.tab.catering': 'Catering', 'ev.tab.risks': 'Risk',
      'ev.f.objective': 'Objective', 'ev.f.outcome': 'What changes afterwards', 'ev.f.measure': 'How we measure it',
      'ev.f.redLines': 'Non-negotiable constraints', 'ev.f.expected': 'Expected attendance', 'ev.f.leader': 'Organiser',
      'ev.redLine': 'Constraint', 'ev.noRedLines': 'No non-negotiable constraints recorded.',
      'ev.rooms.caption': 'Event rooms, usable capacity and fire limit',
      'ev.rooms.name': 'Room', 'ev.rooms.layout': 'Layout', 'ev.rooms.area': 'Floor area', 'ev.rooms.capacity': 'Capacity', 'ev.rooms.fire': 'Fire limit', 'ev.rooms.expected': 'Attendance',
      'ev.rooms.none': 'No rooms planned yet.', 'ev.rooms.over': 'Over capacity', 'ev.rooms.overFire': 'Over fire limit', 'ev.rooms.ok': 'Fits',
      'ev.rooms.buffer': 'Capacity comes from the floor area less a buffer for circulation routes and wheelchair spaces. The room’s fire limit always caps it.',
      'ev.rota.caption': 'Shifts by station', 'ev.rota.station': 'Station', 'ev.rota.time': 'Hours', 'ev.rota.people': 'People', 'ev.rota.need': 'Staffing',
      'ev.rota.none': 'No shifts yet.', 'ev.rota.short': '{n} short', 'ev.rota.full': 'Filled', 'ev.rota.pending': 'Waiting for an adult',
      'ev.rota.claim': 'Sign me up', 'ev.rota.release': 'Drop out', 'ev.rota.claimed': 'Sign-up confirmed.', 'ev.rota.released': 'Removed from the shift.',
      'ev.rota.noAdult': 'No adult is on this shift yet.',
      'ev.rota.minorRules': 'A volunteer under {age}: at most {hours} h a day, never between {from} and {to}, at least {gap} min between shifts, and always with an adult on the station.',
      'ev.brief.none': 'No briefings published for your role.', 'ev.brief.tier': 'Tier', 'ev.brief.version': 'Version',
      'ev.brief.ack': 'I have read this', 'ev.brief.acked': 'Acknowledged', 'ev.brief.hidden': 'Briefings outside your tier: {n}',
      'ev.brief.unread': 'You have {n} unacknowledged briefings — the shift tools stay locked.',
      'ev.brief.done': 'Acknowledgment recorded.', 'ev.brief.myTier': 'Your access tier',
      'ev.gate.title': 'Entry gate', 'ev.gate.scan': 'Pass code', 'ev.gate.add': 'Record entry',
      'ev.gate.queue': 'Queued: {n}', 'ev.gate.send': 'Send the queue', 'ev.gate.sent': 'Queue settled.',
      'ev.gate.inside': 'Inside', 'ev.gate.issued': 'Passes issued',
      'ev.gate.offline': 'No network — scans wait in the browser and settle on their own once it returns.',
      'ev.gate.online': 'Connected — scans settle as they come.',
      'ev.gate.blocked': 'Acknowledge the crew briefing on the “Briefings” tab first.',
      'ev.gate.r.ok': 'Entry recorded', 'ev.gate.r.duplicate': 'Already inside', 'ev.gate.r.collision': 'Collision — stop and check',
      'ev.gate.r.unknown': 'Pass is not from this event', 'ev.gate.r.revoked': 'Pass revoked', 'ev.gate.r.rejected': 'Scan rejected',
      'ev.gate.device': 'Gate name', 'ev.gate.privacy': 'The QR code carries a random token only. No name and no national ID number are written into it.',
      'ev.cat.caption': 'Dietary declarations — counts only', 'ev.cat.diet': 'Diet', 'ev.cat.allergen': 'Allergen', 'ev.cat.count': 'Count',
      'ev.cat.declared': 'Declarations', 'ev.cat.undeclared': 'Not declared', 'ev.cat.none': 'No dietary declarations yet.',
      'ev.cat.privacy': 'The report is aggregate — no attendee-level diet or allergy list leaves the logbook.',
      'ev.risk.caption': 'Event risk register', 'ev.risk.hazard': 'Hazard', 'ev.risk.cat': 'Category',
      'ev.risk.p': 'Likelihood', 'ev.risk.s': 'Severity', 'ev.risk.score': 'Score', 'ev.risk.band': 'Band', 'ev.risk.control': 'Control',
      'ev.risk.none': 'The risk register is empty.', 'ev.risk.low': 'Low', 'ev.risk.medium': 'Medium', 'ev.risk.unacceptable': 'Unacceptable',
      'ev.risk.blocks': '{n} entries in the unacceptable band — while they are there, the principal cannot approve the event.',
      'ev.approve': 'Approve the event', 'ev.approved': 'Event approved.',
      'ev.print': 'Run sheet (print)', 'ev.retention': 'Transient data is deleted on {date}'
    }
  });

  var STATUS_TONE = { draft: 'outline', submitted: 'info', approved: 'success', closed: 'outline' };
  var BAND_TONE = { low: 'success', medium: 'info', unacceptable: 'danger' };

  function StatusBadge(p) {
    /* Każdy status ma słowo, nie tylko kolor — wymóg [3.9.x]. */
    return h(E.Badge, { tone: STATUS_TONE[p.status] || 'outline', icon: p.status === 'approved' ? 'check' : p.status === 'closed' ? 'lock' : 'file' }, t('ev.status.' + p.status));
  }

  /* ------------------------------------------------------------------ lista wydarzeń */
  function EventList() {
    var list = A.useApi('/api/events', []);
    var events = (list.data && list.data.events) || [];
    if (list.loading && !events.length) return h('p', { className: 'muted' }, t('ev.loading'));
    return h('div', null,
      h('div', { className: 'grid-3 mb-4' },
        h(E.StatTile, { label: t('ev.stat.events'), value: String(events.length) }),
        h(E.StatTile, { label: t('ev.stat.short'), value: String(events.reduce(function (n, e) { return n + e.shiftShortfall; }, 0)), alert: events.some(function (e) { return e.shiftShortfall > 0; }) }),
        h(E.StatTile, { label: t('ev.stat.risks'), value: String(events.reduce(function (n, e) { return n + e.blockingRisks; }, 0)), alert: events.some(function (e) { return e.blockingRisks > 0; }) })),
      list.error ? h(E.Alert, { tone: 'danger' }, list.error.message) : null,
      !events.length && !list.loading ? h('p', { className: 'muted' }, t('ev.none')) : null,
      h('div', { className: 'grid-2' }, events.map(function (e) {
        return h('section', { key: e.id, className: 'card' },
          h('div', { className: 'row', style: { justifyContent: 'space-between' } },
            h(E.Badge, { tone: 'brand', icon: 'calendar' }, e.kindLabel), h(StatusBadge, { status: e.status })),
          h('h2', { style: { margin: 'var(--space-2) 0 0', fontSize: '1.0625rem' } }, e.name),
          h('p', { className: 'caption muted', style: { margin: 0 } }, e.dateLabel + ' · ' + e.start + '–' + e.end + ' · ' + e.leader),
          h('p', { style: { margin: 'var(--space-2) 0 0' } }, e.objective),
          h('div', { className: 'row mt-4' },
            e.shiftShortfall > 0 ? h(E.Badge, { tone: 'accent', icon: 'users' }, t('ev.rota.short', { n: e.shiftShortfall })) : null,
            e.blockingRisks > 0 ? h(E.Badge, { tone: 'danger', icon: 'alert' }, t('ev.risk.unacceptable')) : null,
            h(E.Button, { size: 'sm', onClick: function () { A.navigate('/wydarzenia', { e: e.id }); } }, t('ev.open'))));
      })));
  }

  /* ------------------------------------------------------------------ karta: cel i granice */
  function BriefTab(p) {
    var e = p.event;
    return h('div', { className: 'stack' },
      h('section', { className: 'card', 'aria-labelledby': 'ev-h-objective' },
        h('h2', { id: 'ev-h-objective', style: { marginTop: 0, fontSize: '1rem' } }, t('ev.f.objective')),
        h('p', null, e.objective),
        e.outcome ? h('p', { className: 'muted' }, h('b', null, t('ev.f.outcome') + ': '), e.outcome) : null,
        h('p', null, h('b', null, t('ev.f.measure') + ': '), e.measure)),
      h('section', { className: 'card', 'aria-labelledby': 'ev-h-redlines' },
        h('h2', { id: 'ev-h-redlines', style: { marginTop: 0, fontSize: '1rem' } }, t('ev.f.redLines')),
        (e.redLines || []).length
          ? h('ul', { className: 'stack', style: { margin: 0, paddingLeft: '1.2em' } }, e.redLines.map(function (x, i) { return h('li', { key: i }, x); }))
          : h('p', { className: 'muted' }, t('ev.noRedLines'))),
      h('p', { className: 'caption muted' }, t('ev.retention', { date: A.fmtDate(e.retentionDueOn) })));
  }

  /* ------------------------------------------------------------------ sale i pojemność */
  function RoomsTab(p) {
    var rooms = p.event.rooms || [];
    if (!rooms.length) return h('p', { className: 'muted' }, t('ev.rooms.none'));
    return h('div', null,
      h(E.Table, {
        caption: t('ev.rooms.caption'), stack: true,
        columns: [
          { key: 'name', title: t('ev.rooms.name') },
          { key: 'layoutLabel', title: t('ev.rooms.layout') },
          { key: 'areaM2', title: t('ev.rooms.area'), num: true, render: function (r) { return A.fmtNum(r.areaM2) + ' m²'; } },
          { key: 'capacity', title: t('ev.rooms.capacity'), num: true },
          { key: 'fireCapacity', title: t('ev.rooms.fire'), num: true, render: function (r) { return r.fireCapacity == null ? '—' : String(r.fireCapacity); } },
          { key: 'expected', title: t('ev.rooms.expected'), num: true },
          { key: 'fit', title: '', render: function (r) {
            return r.overFire ? h(E.Badge, { tone: 'danger', icon: 'alert' }, t('ev.rooms.overFire'))
              : r.overCapacity ? h(E.Badge, { tone: 'accent', icon: 'alert' }, t('ev.rooms.over'))
                : h(E.Badge, { tone: 'success', icon: 'check' }, t('ev.rooms.ok'));
          } }
        ],
        rows: rooms.map(function (r) { return Object.assign({ id: r.roomId }, r); })
      }),
      h('p', { className: 'caption muted mt-4' }, t('ev.rooms.buffer')));
  }

  /* ------------------------------------------------------------------ grafik dyżurów */
  function RotaTab(p) {
    var rota = A.useApi('/api/events/' + p.event.id + '/rota', [p.event.id]);
    var shifts = (rota.data && rota.data.shifts) || [];
    var cfg = (p.config && p.config.events) || {};
    function act(shiftId, path) {
      A.api.post('/api/events/' + p.event.id + '/shifts/' + shiftId + '/' + path, {})
        .then(function () { A.toast(t(path === 'claim' ? 'ev.rota.claimed' : 'ev.rota.released'), 'success'); rota.reload(); })
        .catch(function (err) { A.toast(err.message || t('ev.err'), 'danger'); });
    }
    if (rota.loading && !shifts.length) return h('p', { className: 'muted' }, t('ev.loading'));
    if (!shifts.length) return h('p', { className: 'muted' }, t('ev.rota.none'));
    return h('div', null,
      h(E.Alert, { tone: 'info' }, t('ev.rota.minorRules', {
        age: cfg.minorUnderAge || 16, hours: cfg.minorMaxHoursPerDay || 7,
        from: cfg.minorCurfewFrom || '22:00', to: cfg.minorCurfewTo || '06:00', gap: cfg.minShiftGapMin || 15
      })),
      h('ul', { className: 'stack mt-4', style: { listStyle: 'none', margin: 0, padding: 0 } }, shifts.map(function (s) {
        return h('li', { key: s.id, className: 'card' },
          h('div', { className: 'row', style: { justifyContent: 'space-between' } },
            h('div', null,
              h('b', null, s.station),
              h('div', { className: 'caption muted' }, s.dateLabel + ' · ' + s.start + '–' + s.end)),
            h('div', { className: 'row' },
              s.short > 0 ? h(E.Badge, { tone: 'accent', icon: 'users' }, t('ev.rota.short', { n: s.short })) : h(E.Badge, { tone: 'success', icon: 'check' }, t('ev.rota.full')),
              !s.adultOnShift ? h(E.Badge, { tone: 'danger', icon: 'alert' }, t('ev.rota.noAdult')) : null)),
          h('p', { className: 'caption', style: { margin: 'var(--space-2) 0 0' } },
            t('ev.rota.people') + ': ' + (s.assignees.length
              ? s.assignees.map(function (a) { return a.name + (a.status === 'pending' ? ' (' + t('ev.rota.pending') + ')' : ''); }).join(', ')
              : '—')),
          h('div', { className: 'row mt-4' },
            h(E.Button, { size: 'sm', onClick: function () { act(s.id, 'claim'); } }, t('ev.rota.claim')),
            h(E.Button, { size: 'sm', variant: 'quiet', onClick: function () { act(s.id, 'release'); } }, t('ev.rota.release'))));
      })));
  }

  /* ------------------------------------------------------------------ instruktaże warstwami */
  function BriefingsTab(p) {
    var api = A.useApi('/api/events/' + p.event.id + '/briefings', [p.event.id]);
    var d = api.data || {};
    var rows = d.briefings || [];
    function ack(id) {
      A.api.post('/api/events/' + p.event.id + '/briefings/' + id + '/ack', {})
        .then(function () { A.toast(t('ev.brief.done'), 'success'); api.reload(); })
        .catch(function (err) { A.toast(err.message || t('ev.err'), 'danger'); });
    }
    if (api.loading && !rows.length) return h('p', { className: 'muted' }, t('ev.loading'));
    return h('div', { className: 'stack' },
      h('p', { className: 'caption muted' }, t('ev.brief.myTier') + ': ' + (d.myTierLabel || '—')),
      (d.unread || []).length ? h(E.Alert, { tone: 'warning' }, t('ev.brief.unread', { n: d.unread.length })) : null,
      !rows.length ? h('p', { className: 'muted' }, t('ev.brief.none')) : null,
      rows.map(function (b) {
        return h('section', { key: b.id, className: 'card' },
          h('div', { className: 'row', style: { justifyContent: 'space-between' } },
            h('b', null, b.title),
            h('div', { className: 'row' },
              h(E.Badge, { tone: 'outline' }, b.tierLabel),
              b.acknowledged ? h(E.Badge, { tone: 'success', icon: 'check' }, t('ev.brief.acked')) : null)),
          h('p', { style: { whiteSpace: 'pre-wrap' } }, b.body),
          h('p', { className: 'caption muted', style: { margin: 0 } }, t('ev.brief.version') + ' ' + b.version + ' · ' + b.by),
          b.requiresAck && !b.acknowledged
            ? h('div', { className: 'row mt-4' }, h(E.Button, { size: 'sm', variant: 'primary', onClick: function () { ack(b.id); } }, t('ev.brief.ack')))
            : null);
      }),
      d.hidden ? h('p', { className: 'caption muted' }, t('ev.brief.hidden', { n: d.hidden })) : null);
  }

  /* ------------------------------------------------ bramka wejściowa (kolejka offline) */
  function GateTab(p) {
    var s1 = React.useState([]), queue = s1[0], setQueue = s1[1];
    var s2 = React.useState(''), code = s2[0], setCode = s2[1];
    var s3 = React.useState([]), log = s3[0], setLog = s3[1];
    var s4 = React.useState('bramka-1'), device = s4[0], setDevice = s4[1];
    var s5 = React.useState(typeof navigator !== 'undefined' ? navigator.onLine !== false : true), online = s5[0], setOnline = s5[1];
    var s6 = React.useState(null), blocked = s6[0], setBlocked = s6[1];

    React.useEffect(function () {
      function up() { setOnline(true); } function down() { setOnline(false); }
      window.addEventListener('online', up); window.addEventListener('offline', down);
      return function () { window.removeEventListener('online', up); window.removeEventListener('offline', down); };
    }, []);

    function enqueue() {
      var token = code.trim(); if (!token) return;
      /* Nonce nadaje klient: dzięki niemu powtórzona wysyłka tej samej paczki nie wpuszcza nikogo
         drugi raz, a skan przetrwa brak sieci. */
      var nonce = (Date.now().toString(36) + Math.random().toString(36).slice(2, 10));
      setQueue(queue.concat([{ token: token, at: new Date().toISOString(), nonce: nonce, direction: 'in' }]));
      setCode('');
    }
    function flush() {
      if (!queue.length) return;
      var batch = queue.slice();
      A.api.post('/api/events/' + p.event.id + '/scans', { deviceId: device, scans: batch })
        .then(function (r) {
          setQueue(queue.slice(batch.length));
          setLog((r.results || []).map(function (x, i) { return { id: batch[i].nonce, status: x.status, code: x.code }; }).concat(log).slice(0, 20));
          setBlocked(null);
          A.toast(t('ev.gate.sent'), 'success');
        })
        .catch(function (err) {
          if (err && err.code === 'briefing_unread') setBlocked(t('ev.gate.blocked'));
          else A.toast(err.message || t('ev.err'), 'danger');
        });
    }

    return h('div', { className: 'stack' },
      h(E.SyncStatus, { state: online ? (queue.length ? 'pending' : 'synced') : 'offline', pending: queue.length, detail: online ? t('ev.gate.online') : t('ev.gate.offline') }),
      blocked ? h(E.Alert, { tone: 'warning' }, blocked) : null,
      h('section', { className: 'card', 'aria-labelledby': 'ev-h-gate' },
        h('h2', { id: 'ev-h-gate', style: { marginTop: 0, fontSize: '1rem' } }, t('ev.gate.title')),
        h(E.TextField, { label: t('ev.gate.device'), value: device, onChange: function (ev) { setDevice(ev.target.value); } }),
        h(E.TextField, { label: t('ev.gate.scan'), value: code, onChange: function (ev) { setCode(ev.target.value); }, hint: t('ev.gate.privacy') }),
        h('div', { className: 'row mt-4' },
          h(E.Button, { variant: 'primary', onClick: enqueue, disabled: !code.trim() }, t('ev.gate.add')),
          h(E.Button, { onClick: flush, disabled: !queue.length }, t('ev.gate.send') + ' · ' + t('ev.gate.queue', { n: queue.length })))),
      /* Wynik skanu musi dotrzeć do osoby, która nie patrzy na ekran — bramka jest głośnym miejscem. */
      log.length ? h('ul', { className: 'stack', 'aria-live': 'polite', 'aria-label': t('ev.gate.title'), style: { listStyle: 'none', margin: 0, padding: 0 } }, log.map(function (x) {
        var tone = x.status === 'ok' ? 'success' : x.status === 'collision' ? 'danger' : 'accent';
        return h('li', { key: x.id, className: 'row' }, h(E.Badge, { tone: tone, icon: x.status === 'ok' ? 'check' : 'alert' }, t('ev.gate.r.' + x.status)));
      })) : null);
  }

  /* ------------------------------------------------------------------ catering: liczby */
  function CateringTab(p) {
    var api = A.useApi('/api/events/' + p.event.id + '/catering', [p.event.id]);
    var d = api.data || {};
    if (api.loading && !d.diets) return h('p', { className: 'muted' }, t('ev.loading'));
    var diets = d.diets || [], allergens = d.allergens || [];
    return h('div', { className: 'stack' },
      h('div', { className: 'grid-3' },
        h(E.StatTile, { label: t('ev.cat.declared'), value: String((d.headcount && d.headcount.declared) || 0) }),
        h(E.StatTile, { label: t('ev.f.expected'), value: String((d.headcount && d.headcount.expected) || 0) }),
        h(E.StatTile, { label: t('ev.cat.undeclared'), value: String((d.headcount && d.headcount.undeclared) || 0) })),
      diets.length ? h(E.Table, {
        caption: t('ev.cat.caption'), stack: true,
        columns: [{ key: 'label', title: t('ev.cat.diet') }, { key: 'count', title: t('ev.cat.count'), num: true }],
        rows: diets.map(function (x) { return { id: x.id, label: x.label, count: x.count }; })
      }) : h('p', { className: 'muted' }, t('ev.cat.none')),
      allergens.length ? h(E.Table, {
        caption: t('ev.cat.allergen'), stack: true,
        columns: [{ key: 'label', title: t('ev.cat.allergen') }, { key: 'count', title: t('ev.cat.count'), num: true }],
        rows: allergens.map(function (x) { return { id: x.id, label: x.label, count: x.count }; })
      }) : null,
      h('p', { className: 'caption muted' }, t('ev.cat.privacy')));
  }

  /* ------------------------------------------------------------------ rejestr ryzyka */
  function RisksTab(p) {
    var api = A.useApi('/api/events/' + p.event.id + '/risks', [p.event.id]);
    var d = api.data || {};
    var risks = d.risks || [];
    if (api.loading && !risks.length) return h('p', { className: 'muted' }, t('ev.loading'));
    if (!risks.length) return h('p', { className: 'muted' }, t('ev.risk.none'));
    return h('div', null,
      (d.blocking || []).length ? h(E.Alert, { tone: 'danger' }, t('ev.risk.blocks', { n: d.blocking.length })) : null,
      h('div', { className: 'mt-4' }, h(E.Table, {
        caption: t('ev.risk.caption'), stack: true,
        columns: [
          { key: 'hazard', title: t('ev.risk.hazard') },
          { key: 'categoryLabel', title: t('ev.risk.cat') },
          { key: 'likelihood', title: t('ev.risk.p'), num: true },
          { key: 'severity', title: t('ev.risk.s'), num: true },
          { key: 'score', title: t('ev.risk.score'), num: true },
          { key: 'band', title: t('ev.risk.band'), render: function (r) { return h(E.Badge, { tone: BAND_TONE[r.bandId] || 'outline', icon: r.bandId === 'unacceptable' ? 'alert' : 'check' }, t('ev.risk.' + r.bandId)); } },
          { key: 'control', title: t('ev.risk.control'), render: function (r) { return r.control || '—'; } }
        ],
        rows: risks.map(function (x) { return Object.assign({ id: x.id, bandId: x.band.id }, x); })
      })));
  }

  /* ------------------------------------------------------------------ szczegóły wydarzenia */
  function EventDetail(p) {
    var api = A.useApi('/api/events/' + p.id, [p.id]);
    var s = React.useState('brief'), tab = s[0], setTab = s[1];
    var e = api.data && api.data.event;
    if (api.error) return h(E.Alert, { tone: 'danger' }, api.error.message);
    if (!e) return h('p', { className: 'muted' }, t('ev.loading'));

    function approve() {
      A.api.post('/api/events/' + e.id + '/approve', {})
        .then(function () { A.toast(t('ev.approved'), 'success'); api.reload(); })
        .catch(function (err) { A.toast(err.message || t('ev.err'), 'danger'); });
    }

    var tabs = [
      { id: 'brief', label: t('ev.tab.brief') }, { id: 'rooms', label: t('ev.tab.rooms'), count: (e.rooms || []).length },
      { id: 'rota', label: t('ev.tab.rota'), count: e.shiftCount }, { id: 'briefings', label: t('ev.tab.briefings') },
      { id: 'gate', label: t('ev.tab.gate') }, { id: 'catering', label: t('ev.tab.catering') },
      { id: 'risks', label: t('ev.tab.risks'), count: e.riskCount }
    ];
    var body = tab === 'rooms' ? h(RoomsTab, { event: e })
      : tab === 'rota' ? h(RotaTab, { event: e, config: p.config })
        : tab === 'briefings' ? h(BriefingsTab, { event: e })
          : tab === 'gate' ? h(GateTab, { event: e })
            : tab === 'catering' ? h(CateringTab, { event: e })
              : tab === 'risks' ? h(RisksTab, { event: e })
                : h(BriefTab, { event: e });

    return h('div', null,
      h('div', { className: 'row mb-4', style: { justifyContent: 'space-between' } },
        h(E.Button, { size: 'sm', variant: 'quiet', icon: 'arrow-left', onClick: function () { A.navigate('/wydarzenia'); } }, t('ev.back')),
        h('div', { className: 'row' },
          h(E.Badge, { tone: 'brand', icon: 'calendar' }, e.kindLabel), h(StatusBadge, { status: e.status }))),
      h('h2', { style: { margin: 0 } }, e.name),
      h('p', { className: 'caption muted' }, e.dateLabel + ' · ' + e.start + '–' + e.end + ' · ' + t('ev.f.leader') + ': ' + e.leader),
      h('div', { className: 'row mb-4' },
        h(E.Button, { size: 'sm', onClick: function () { A.openPrint('/api/events/' + e.id + '/run-sheet/print'); } }, t('ev.print')),
        p.user.role === 'principal' && e.status !== 'approved' && e.status !== 'closed'
          ? h(E.Button, { size: 'sm', variant: 'primary', onClick: approve }, t('ev.approve')) : null),
      h(E.Tabs, { label: t('ev.title'), value: tab, onChange: setTab, tabs: tabs }),
      h('div', { className: 'mt-4' }, body));
  }

  function Screen(props) {
    var id = props.route.query.e;
    return h('div', null,
      h('h1', { className: 'display app-title' }, t('ev.title')),
      h('p', { className: 'app-sub', style: { maxWidth: '70ch', fontSize: '0.9375rem' } }, t('ev.sub')),
      id ? h(EventDetail, { id: id, user: props.user, config: props.config }) : h(EventList, null));
  }

  A.screen({
    id: 'events', path: '/wydarzenia', title: 'Wydarzenia', module: 'events',
    roles: ['staff', 'student', 'parent'],
    nav: { key: 'nav.events', label: 'Wydarzenia', order: 27 },
    component: Screen
  });
})();
