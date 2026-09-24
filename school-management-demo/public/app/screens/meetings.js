/* Ekran „Spotkania” (moduł meetings): spotkania wideo na serwerze szkoły — lekcje zdalne,
   konsultacje z rodzicami i spotkania zespołu. Dostawcy: Jitsi Meet (domyślny), BigBlueButton,
   „tylko link” (zewnętrzny). Szczegóły wdrożenia: docs/VIDEO.md. */
(function () {
  var E = window.EdMat, A = window.EdApp, h = React.createElement, F = React.Fragment;

  window.EdI18n.add({
    pl: {
      'me.title': 'Spotkania wideo', 'me.sub': 'Lekcje zdalne, konsultacje i spotkania zespołu na serwerze szkoły.',
      'me.tab.upcoming': 'Nadchodzące', 'me.tab.past': 'Zakończone', 'me.tab.cons': 'Konsultacje', 'me.tab.admin': 'Konfiguracja',
      'me.none': 'Brak spotkań w tej zakładce.', 'me.loading': 'Wczytywanie spotkań…',
      'me.kind.lesson': 'Lekcja zdalna', 'me.kind.consultation': 'Konsultacja', 'me.kind.staff': 'Spotkanie zespołu', 'me.kind.course': 'Zajęcia kursu',
      'me.status.scheduled': 'Zaplanowane', 'me.status.live': 'Trwa', 'me.status.ended': 'Zakończone', 'me.status.cancelled': 'Odwołane',
      'me.host': 'Prowadzi', 'me.when': 'Termin', 'me.provider': 'Dostawca', 'me.room': 'Pokój',
      'me.join': 'Dołącz', 'me.open': 'Otwórz w nowej karcie', 'me.leave': 'Zamknij okno spotkania',
      'me.oneTitle': 'Wybrane spotkanie', 'me.backToAll': 'Wszystkie spotkania', 'me.notFound': 'Nie ma takiego spotkania albo nie jesteś jego uczestnikiem.',
      'me.start': 'Rozpocznij', 'me.end': 'Zakończ', 'me.cancelMeeting': 'Odwołaj',
      'me.schedule': 'Zaplanuj spotkanie', 'me.scheduleTitle': 'Nowe spotkanie wideo',
      'me.f.kind': 'Rodzaj', 'me.f.title': 'Tytuł', 'me.f.date': 'Data', 'me.f.lessonNo': 'Numer lekcji', 'me.f.start': 'Początek', 'me.f.end': 'Koniec',
      'me.f.audience': 'Uczestnicy', 'me.f.class': 'Klasa', 'me.f.invited': 'Zaproszone osoby', 'me.f.provider': 'Dostawca wideo',
      'me.f.externalUrl': 'Adres spotkania (https://…)', 'me.f.note': 'Notatka dla uczestników',
      'me.f.custom': 'Godziny własne', 'me.f.policy': 'Kto może dołączyć',
      'me.policy.class': 'Uczniowie wskazanej klasy', 'me.policy.invited': 'Tylko zaproszeni', 'me.policy.staff': 'Pracownicy szkoły',
      'me.f.waiting': 'Poczekalnia — prowadzący wpuszcza uczestników', 'me.f.recording': 'Nagrywaj spotkanie',
      'me.consentNote': 'Nagrywanie wymaga zgody opiekunów wszystkich uczniów niepełnoletnich. Bez kompletu zgód pozostaje wyłączone, a nagranie zapisuje się wyłącznie na serwerze szkoły.',
      'me.scheduled': 'Spotkanie zaplanowane.', 'me.cancelReason': 'Powód odwołania', 'me.cancelTitle': 'Odwołaj spotkanie',
      'me.cancelled': 'Spotkanie odwołane, uczestnicy powiadomieni.', 'me.cancelHint': 'Uczestnicy zobaczą powód w powiadomieniu.',
      'me.rec.on': 'Nagrywane', 'me.rec.off': 'Bez nagrywania', 'me.rec.blocked': 'Nagrywanie zablokowane — brak zgód ({n})',
      'me.rec.title': 'Zgoda na nagrywanie', 'me.rec.grant': 'Wyrażam zgodę', 'me.rec.withdraw': 'Wycofaj zgodę',
      'me.rec.granted': 'Zgoda zapisana.', 'me.rec.withdrawn': 'Zgoda wycofana — nagrywanie wyłączone.',
      'me.rec.parentText': 'Prowadzący prosi o zgodę na nagranie spotkania z udziałem Twojego dziecka. Nagranie zostaje na serwerze szkoły; zgodę możesz wycofać.',
      'me.rec.storedAt': 'Miejsce zapisu nagrania: serwer szkoły.',
      'me.att.title': 'Obecność', 'me.att.present': 'Weszło', 'me.att.expected': 'Zaproszonych', 'me.att.minutes': 'Łączny czas (min)',
      'me.att.name': 'Osoba', 'me.att.joined': 'Wejście', 'me.att.left': 'Wyjście', 'me.att.via': 'Urządzenie', 'me.att.absent': 'Nie weszli',
      'me.embed.loading': 'Ładowanie okna spotkania z serwera szkoły…',
      'me.embed.failed': 'Nie udało się wczytać okna spotkania z serwera szkoły. Otwórz spotkanie w nowej karcie.',
      'me.embed.placeholder': 'Administrator nie wpisał jeszcze adresu serwera wideo szkoły — okno spotkania jest niedostępne.',
      'me.embed.note': 'Obraz i dźwięk idą bezpośrednio między przeglądarką a serwerem szkoły. Dziennik w tym nie pośredniczy.',
      'me.external': 'Dostawca zewnętrzny', 'me.externalWarn': 'Spotkanie poza serwerem szkoły — dane uczestników trafiają do zewnętrznej firmy.',
      'me.passcode': 'Kod do poczekalni', 'me.waitingOn': 'Poczekalnia włączona',
      'me.cons.title': 'Konsultacje wideo', 'me.cons.free': 'Wolne terminy', 'me.cons.book': 'Zarezerwuj', 'me.cons.mine': 'Twoja rezerwacja',
      'me.cons.taken': 'Zajęty', 'me.cons.cancel': 'Odwołaj rezerwację', 'me.cons.none': 'Brak wolnych terminów konsultacji wideo.',
      'me.cons.child': 'Dziecko', 'me.cons.booked': 'Termin zarezerwowany — spotkanie pojawi się na liście.',
      'me.adm.title': 'Konfiguracja wideo szkoły', 'me.adm.provider': 'Dostawca', 'me.adm.domain': 'Domena Jitsi', 'me.adm.appId': 'App ID (JWT)',
      'me.adm.secret': 'Sekret aplikacji', 'me.adm.secretSet': 'Sekret zapisany — nie jest nigdzie pokazywany.', 'me.adm.secretKeep': 'Puste pole = bez zmian.',
      'me.adm.bbbUrl': 'Adres API BigBlueButton', 'me.adm.bbbSecret': 'Sekret API BigBlueButton',
      'me.adm.test': 'Sprawdź konfigurację', 'me.adm.saved': 'Konfiguracja zapisana.',
      'me.adm.testNote': 'Test sprawdza wyłącznie format — dziennik nie wysyła żadnego zapytania do serwera wideo.',
      'me.adm.preview': 'Przykładowy adres pokoju', 'me.adm.csp': 'Pamiętaj o dodaniu domeny do nagłówka CSP (script-src, frame-src, connect-src, media-src).',
      'me.adm.envDomain': 'Domena pochodzi ze zmiennej środowiskowej EDMAT_JITSI_DOMAIN.',
      'me.selfHosted': 'Własny serwer szkoły', 'me.placeholderWarn': 'Adres serwera wideo jest wciąż przykładowy. Spotkania można planować, ale dołączanie zadziała dopiero po wpisaniu domeny szkoły.',
      'me.guardian': 'Podgląd opiekuna', 'me.guardianReason': 'Podgląd dla opiekuna — do pokoju wchodzi uczeń ze swojego konta. Tutaj decydujesz o zgodzie na nagrywanie.', 'me.err': 'Nie udało się wykonać operacji.'
    },
    en: {
      'me.title': 'Video meetings', 'me.sub': 'Remote lessons, consultations and staff meetings on the school’s own server.',
      'me.tab.upcoming': 'Upcoming', 'me.tab.past': 'Finished', 'me.tab.cons': 'Consultations', 'me.tab.admin': 'Configuration',
      'me.none': 'No meetings in this tab.', 'me.loading': 'Loading meetings…',
      'me.kind.lesson': 'Remote lesson', 'me.kind.consultation': 'Consultation', 'me.kind.staff': 'Staff meeting', 'me.kind.course': 'Course session',
      'me.status.scheduled': 'Scheduled', 'me.status.live': 'Live', 'me.status.ended': 'Finished', 'me.status.cancelled': 'Cancelled',
      'me.host': 'Host', 'me.when': 'When', 'me.provider': 'Provider', 'me.room': 'Room',
      'me.join': 'Join', 'me.open': 'Open in a new tab', 'me.leave': 'Close the meeting window',
      'me.oneTitle': 'Selected meeting', 'me.backToAll': 'All meetings', 'me.notFound': 'No such meeting, or you are not one of its participants.',
      'me.start': 'Start', 'me.end': 'End', 'me.cancelMeeting': 'Cancel',
      'me.schedule': 'Schedule a meeting', 'me.scheduleTitle': 'New video meeting',
      'me.f.kind': 'Kind', 'me.f.title': 'Title', 'me.f.date': 'Date', 'me.f.lessonNo': 'Lesson number', 'me.f.start': 'Start', 'me.f.end': 'End',
      'me.f.audience': 'Participants', 'me.f.class': 'Class', 'me.f.invited': 'Invited people', 'me.f.provider': 'Video provider',
      'me.f.externalUrl': 'Meeting URL (https://…)', 'me.f.note': 'Note for participants',
      'me.f.custom': 'Custom times', 'me.f.policy': 'Who may join',
      'me.policy.class': 'Students of the chosen class', 'me.policy.invited': 'Invited people only', 'me.policy.staff': 'School staff',
      'me.f.waiting': 'Waiting room — the host admits participants', 'me.f.recording': 'Record the meeting',
      'me.consentNote': 'Recording needs consent from the guardians of every child under 18. Without the full set it stays off, and any recording is stored only on the school’s server.',
      'me.scheduled': 'Meeting scheduled.', 'me.cancelReason': 'Reason for cancelling', 'me.cancelTitle': 'Cancel the meeting',
      'me.cancelled': 'Meeting cancelled, participants notified.', 'me.cancelHint': 'Participants will see the reason in their notification.',
      'me.rec.on': 'Recorded', 'me.rec.off': 'Not recorded', 'me.rec.blocked': 'Recording blocked — consents missing ({n})',
      'me.rec.title': 'Recording consent', 'me.rec.grant': 'I give consent', 'me.rec.withdraw': 'Withdraw consent',
      'me.rec.granted': 'Consent saved.', 'me.rec.withdrawn': 'Consent withdrawn — recording switched off.',
      'me.rec.parentText': 'The host asks for consent to record a meeting your child takes part in. The recording stays on the school’s server and you can withdraw consent.',
      'me.rec.storedAt': 'Recordings are stored on the school’s own server.',
      'me.att.title': 'Attendance', 'me.att.present': 'Joined', 'me.att.expected': 'Invited', 'me.att.minutes': 'Total time (min)',
      'me.att.name': 'Person', 'me.att.joined': 'Joined at', 'me.att.left': 'Left at', 'me.att.via': 'Device', 'me.att.absent': 'Did not join',
      'me.embed.loading': 'Loading the meeting window from the school server…',
      'me.embed.failed': 'The meeting window could not be loaded from the school server. Open the meeting in a new tab.',
      'me.embed.placeholder': 'The administrator has not set the school video server address yet — the embedded window is unavailable.',
      'me.embed.note': 'Audio and video go straight between your browser and the school server. The logbook is not in the middle.',
      'me.external': 'External provider', 'me.externalWarn': 'This meeting is outside the school server — participant data reaches an outside company.',
      'me.passcode': 'Lobby passcode', 'me.waitingOn': 'Waiting room on',
      'me.cons.title': 'Video consultations', 'me.cons.free': 'Free slots', 'me.cons.book': 'Book', 'me.cons.mine': 'Your booking',
      'me.cons.taken': 'Taken', 'me.cons.cancel': 'Cancel booking', 'me.cons.none': 'No free video consultation slots.',
      'me.cons.child': 'Child', 'me.cons.booked': 'Slot booked — the meeting will appear in your list.',
      'me.adm.title': 'School video configuration', 'me.adm.provider': 'Provider', 'me.adm.domain': 'Jitsi domain', 'me.adm.appId': 'App ID (JWT)',
      'me.adm.secret': 'App secret', 'me.adm.secretSet': 'A secret is stored — it is never shown anywhere.', 'me.adm.secretKeep': 'Leave empty to keep the current one.',
      'me.adm.bbbUrl': 'BigBlueButton API URL', 'me.adm.bbbSecret': 'BigBlueButton API secret',
      'me.adm.test': 'Test configuration', 'me.adm.saved': 'Configuration saved.',
      'me.adm.testNote': 'The test only checks the format — the logbook sends no request to the video server.',
      'me.adm.preview': 'Example room URL', 'me.adm.csp': 'Remember to add the domain to the CSP header (script-src, frame-src, connect-src, media-src).',
      'me.adm.envDomain': 'The domain comes from the EDMAT_JITSI_DOMAIN environment variable.',
      'me.selfHosted': 'School’s own server', 'me.placeholderWarn': 'The video server address is still the example one. You can schedule meetings, but joining will work only once the school domain is set.',
      'me.guardian': 'Guardian view', 'me.guardianReason': 'Guardian view — your child joins the room from their own account. Here you decide about recording consent.', 'me.err': 'Could not complete the operation.'
    }
  });

  var t = function (k, v) { return A.t(k, v); };
  function err(e) { A.toast((e && e.message) || t('me.err'), 'danger'); }
  var STATUS_TONE = { scheduled: 'info', live: 'success', ended: 'outline', cancelled: 'danger' };

  function Card(p) {
    return h('section', { className: 'card', 'aria-labelledby': p.hid, id: p.id },
      h('h2', { className: 'heading', id: p.hid }, p.title), p.children);
  }

  /* ------------------------------------------------------------------ okno spotkania (Jitsi) */
  /* JEDYNY zewnętrzny skrypt w całym dzienniku: external_api.js z WŁASNEGO serwera wideo szkoły.
     Ładujemy go leniwie i tylko wtedy, gdy (a) administrator wpisał prawdziwą domenę szkoły
     (nie „przykład”), (b) użytkownik naprawdę otwiera spotkanie. Gdy skrypt się nie wczyta
     (brak sieci, CSP, zła domena) pokazujemy zwykły link „otwórz w nowej karcie”.
     Domena musi być dopisana do nagłówka CSP w server/index.js — patrz docs/VIDEO.md. */
  function loadExternalApi(domain) {
    return new Promise(function (resolve, reject) {
      if (window.JitsiMeetExternalAPI) return resolve(window.JitsiMeetExternalAPI);
      var src = 'https://' + domain + '/external_api.js';
      var existing = document.querySelector('script[data-edmat-jitsi]');
      var s = existing || document.createElement('script');
      var done = false;
      var fail = function () { if (!done) { done = true; reject(new Error('external_api')); } };
      var ok = function () { if (done) return; if (window.JitsiMeetExternalAPI) { done = true; resolve(window.JitsiMeetExternalAPI); } else fail(); };
      s.addEventListener('load', ok); s.addEventListener('error', fail);
      setTimeout(fail, 8000);
      if (!existing) { s.src = src; s.async = true; s.setAttribute('data-edmat-jitsi', domain); document.head.appendChild(s); }
    });
  }

  function JitsiFrame(p) {
    var ref = React.useRef(null);
    var st = React.useState('loading'), phase = st[0], setPhase = st[1];
    React.useEffect(function () {
      var api = null, alive = true;
      loadExternalApi(p.join.domain).then(function (Api) {
        if (!alive || !ref.current) return;
        setPhase('ready');
        api = new Api(p.join.domain, {
          roomName: p.join.roomName, jwt: p.join.jwt || undefined, parentNode: ref.current,
          width: '100%', height: 520,
          userInfo: { displayName: p.join.displayName },
          configOverwrite: { prejoinPageEnabled: true, disableThirdPartyRequests: true, analytics: { disabled: true }, startWithAudioMuted: true, gravatar: { disabled: true } },
          interfaceConfigOverwrite: { SHOW_JITSI_WATERMARK: false, SHOW_CHROME_EXTENSION_BANNER: false, MOBILE_APP_PROMO: false }
        });
      }).catch(function () { if (alive) setPhase('failed'); });
      return function () { alive = false; try { if (api) api.dispose(); } catch (e) {} };
    }, [p.join.roomName, p.join.domain]);
    return h('div', { className: 'stack' },
      phase === 'loading' ? h('p', { className: 'muted', 'aria-live': 'polite' }, t('me.embed.loading')) : null,
      phase === 'failed' ? h(E.Alert, { tone: 'warning', title: t('me.embed.failed') },
        h(E.Button, { variant: 'primary', icon: 'chevron-right', onClick: function () { window.open(p.join.url, '_blank', 'noopener'); } }, t('me.open'))) : null,
      h('div', { ref: ref, className: 'me-frame', style: { minHeight: phase === 'ready' ? '520px' : '0' } }),
      phase === 'ready' ? h('p', { className: 'caption muted' }, t('me.embed.note')) : null);
  }

  function JoinPanel(p) {
    var j = p.join;
    if (!j) return null;
    if (j.provider === 'none' || j.external) {
      return h('div', { className: 'stack' },
        h(E.Alert, { tone: 'warning', title: t('me.external') }, t('me.externalWarn')),
        h(E.Button, { variant: 'primary', icon: 'chevron-right', onClick: function () { window.open(j.url, '_blank', 'noopener'); } }, t('me.open')));
    }
    if (j.provider === 'bbb') {
      return h('div', { className: 'stack' },
        h('p', null, t('me.room') + ': ' + j.roomName),
        h(E.Button, { variant: 'primary', icon: 'chevron-right', onClick: function () { window.open(j.url, '_blank', 'noopener'); } }, t('me.open')));
    }
    if (!j.embeddable) {
      return h('div', { className: 'stack' },
        h(E.Alert, { tone: 'warning' }, t('me.embed.placeholder')),
        h(E.Button, { variant: 'secondary', icon: 'chevron-right', disabled: true }, t('me.open')));
    }
    return h('div', { className: 'stack' },
      j.passcode ? h('p', { className: 'caption muted' }, t('me.passcode') + ': ' + j.passcode) : null,
      h(JitsiFrame, { join: j }),
      h(E.Button, { variant: 'secondary', icon: 'chevron-right', onClick: function () { window.open(j.url, '_blank', 'noopener'); } }, t('me.open')));
  }

  /* ------------------------------------------------------------------ planowanie */
  function ScheduleDialog(p) {
    var cfg = p.cfg || {};
    var st = React.useState({
      kind: 'lesson', title: '', date: cfg.today || '', lessonNo: '4', custom: false, start: '', end: '',
      classId: (p.classes[0] || {}).id || '', policy: 'class', invited: '', provider: cfg.provider || 'jitsi',
      externalUrl: '', waiting: true, recording: false, note: ''
    }), f = st[0], set = st[1];
    var s2 = React.useState(null), e2 = s2[0], setE = s2[1];
    var upd = function (k, v) { var n = Object.assign({}, f); n[k] = v; if (k === 'kind') n.policy = v === 'staff' ? 'staff' : v === 'consultation' ? 'invited' : 'class'; set(n); };
    var times = cfg.lessonTimes || [];
    function send() {
      setE(null);
      var body = {
        kind: f.kind, title: f.title, date: f.date, provider: f.provider,
        joinPolicy: f.policy, waitingRoom: f.waiting, recording: f.recording, note: f.note,
        externalUrl: f.provider === 'none' ? f.externalUrl : undefined
      };
      if (f.custom) { body.start = f.start; body.end = f.end; } else { body.lessonNo = +f.lessonNo; }
      if (f.policy === 'class') body.classIds = [f.classId];
      if (f.policy === 'invited') body.participantIds = f.invited.split(',').map(function (x) { return x.trim(); }).filter(Boolean);
      A.api.post('/api/meetings', body).then(function (r) {
        A.toast(r.confirmation || t('me.scheduled'), 'success');
        if (r.recording && r.recording.reason === 'recording_consent_missing') A.toast(t('me.rec.blocked', { n: r.recording.missing }), 'danger');
        p.onDone();
      }).catch(function (x) { setE(x.message); });
    }
    return h(E.Dialog, {
      title: t('me.scheduleTitle'), onClose: p.onClose, initialFocus: '#me-title',
      actions: [h(E.Button, { key: 'c', variant: 'secondary', onClick: p.onClose }, t('common.cancel')),
        h(E.Button, { key: 'o', variant: 'primary', icon: 'check', onClick: send }, t('common.save'))]
    },
      e2 ? h(E.Alert, { tone: 'danger' }, e2) : null,
      h('div', { className: 'stack' },
        h(E.Select, { label: t('me.f.kind'), value: f.kind, onChange: function (e) { upd('kind', e.target.value); },
          options: ['lesson', 'consultation', 'staff', 'course'].map(function (k) { return { value: k, label: t('me.kind.' + k) }; }) }),
        h(E.TextField, { id: 'me-title', label: t('me.f.title'), value: f.title, onChange: function (e) { upd('title', e.target.value); } }),
        h(E.TextField, Object.assign({ label: t('me.f.date'), type: 'date', value: f.date, onChange: function (e) { upd('date', e.target.value); }, hint: A.dateHint(f.date) }, A.dateInputProps())),
        h(E.Checkbox, { label: t('me.f.custom'), checked: f.custom, onChange: function (e) { upd('custom', e.target.checked); } }),
        f.custom
          ? h('div', { className: 'grid-2' },
            h(E.TextField, Object.assign({ label: t('me.f.start'), type: 'time', value: f.start, onChange: function (e) { upd('start', e.target.value); }, hint: A.dateHint(f.start, 'time') }, A.dateInputProps('time'))),
            h(E.TextField, Object.assign({ label: t('me.f.end'), type: 'time', value: f.end, onChange: function (e) { upd('end', e.target.value); }, hint: A.dateHint(f.end, 'time') }, A.dateInputProps('time'))))
          : h(E.Select, { label: t('me.f.lessonNo'), value: f.lessonNo, onChange: function (e) { upd('lessonNo', e.target.value); },
            options: times.map(function (x) { return { value: String(x.no), label: x.no + '. ' + x.start + '–' + x.end }; }) }),
        h(E.Select, { label: t('me.f.policy'), value: f.policy, onChange: function (e) { upd('policy', e.target.value); },
          options: [{ value: 'class', label: t('me.policy.class') }, { value: 'invited', label: t('me.policy.invited') }, { value: 'staff', label: t('me.policy.staff') }] }),
        f.policy === 'class'
          ? h(E.Select, { label: t('me.f.class'), value: f.classId, onChange: function (e) { upd('classId', e.target.value); },
            options: p.classes.map(function (c) { return { value: c.id, label: c.name }; }) })
          : f.policy === 'invited'
            ? h(E.TextField, { label: t('me.f.invited'), value: f.invited, placeholder: 'u_p_kowalczyk', hint: 'id, id, id', onChange: function (e) { upd('invited', e.target.value); } })
            : null,
        h(E.Select, { label: t('me.f.provider'), value: f.provider, onChange: function (e) { upd('provider', e.target.value); },
          options: [{ value: 'jitsi', label: 'Jitsi Meet (' + t('me.selfHosted') + ')' }, { value: 'bbb', label: 'BigBlueButton' }, { value: 'none', label: t('me.external') }] }),
        f.provider === 'none' ? h(E.TextField, { label: t('me.f.externalUrl'), value: f.externalUrl, onChange: function (e) { upd('externalUrl', e.target.value); } }) : null,
        h(E.Switch, { label: t('me.f.waiting'), checked: f.waiting, states: [t('common.no'), t('common.yes')], onChange: function (v) { upd('waiting', v); } }),
        h(E.Switch, { label: t('me.f.recording'), hint: t('me.consentNote'), checked: f.recording, states: [t('common.no'), t('common.yes')], onChange: function (v) { upd('recording', v); } }),
        h(E.TextField, { label: t('me.f.note'), multiline: 2, value: f.note, onChange: function (e) { upd('note', e.target.value); } })));
  }

  function CancelDialog(p) {
    var st = React.useState(''), reason = st[0], setReason = st[1];
    var s2 = React.useState(null), e2 = s2[0], setE = s2[1];
    return h(E.Dialog, {
      title: t('me.cancelTitle'), onClose: p.onClose, initialFocus: '#me-reason',
      actions: [h(E.Button, { key: 'c', variant: 'secondary', onClick: p.onClose }, t('common.close')),
        h(E.Button, { key: 'o', variant: 'primary', icon: 'warning', disabled: reason.trim().length < 3, onClick: function () {
          setE(null);
          A.api.post('/api/meetings/' + p.meeting.id + '/cancel', { reason: reason })
            .then(function () { A.toast(t('me.cancelled'), 'success'); p.onDone(); }).catch(function (x) { setE(x.message); });
        } }, t('me.cancelMeeting'))]
    },
      e2 ? h(E.Alert, { tone: 'danger' }, e2) : null,
      h(E.TextField, { id: 'me-reason', label: t('me.cancelReason'), value: reason, hint: t('me.cancelHint'), onChange: function (e) { setReason(e.target.value); } }));
  }

  /* ------------------------------------------------------------------ obecność dla prowadzącego */
  function Attendance(p) {
    var a = A.useApi('/api/meetings/' + p.meetingId + '/attendance', [p.meetingId]);
    if (a.error) return null;
    if (!a.data) return h('p', { className: 'muted' }, t('common.loading'));
    return h('div', { className: 'stack' },
      h('div', { className: 'grid-3' },
        h(E.StatTile, { label: t('me.att.present'), value: String(a.data.present) }),
        h(E.StatTile, { label: t('me.att.expected'), value: String(a.data.expected) }),
        h(E.StatTile, { label: t('me.att.minutes'), value: String(a.data.totalMinutes) })),
      h(E.Table, {
        caption: t('me.att.title'),
        columns: [
          { key: 'name', title: t('me.att.name') },
          { key: 'joinedAt', title: t('me.att.joined'), render: function (r) { return A.fmtDateTime(r.joinedAt); } },
          { key: 'leftAt', title: t('me.att.left'), render: function (r) { return r.leftAt ? A.fmtDateTime(r.leftAt) : '—'; } },
          { key: 'minutes', title: 'min', num: true, render: function (r) { return r.minutes == null ? '—' : String(r.minutes); } },
          { key: 'via', title: t('me.att.via') }],
        rows: a.data.rows.map(function (r) { return Object.assign({ id: r.userId }, r); })
      }),
      a.data.absent.length ? h('p', { className: 'caption muted' }, t('me.att.absent') + ': ' + a.data.absent.map(function (x) { return x.name; }).join(', ')) : null,
      h('p', { className: 'caption muted' }, a.data.note));
  }

  /* ------------------------------------------------------------------ zgoda rodzica */
  function ConsentCard(p) {
    var m = p.meeting;
    var mine = (m.recording.consents || []).filter(function (c) { return (p.childrenIds || []).indexOf(c.studentId) >= 0; });
    if (!mine.length) return null;
    function setConsent(studentId, granted) {
      A.api.post('/api/meetings/' + m.id + '/recording-consent', { studentId: studentId, granted: granted })
        .then(function () { A.toast(granted ? t('me.rec.granted') : t('me.rec.withdrawn'), 'success'); p.onDone(); }).catch(err);
    }
    return h(Card, { id: 'me-consent-' + m.id, hid: 'h-cons-' + m.id, title: t('me.rec.title') },
      h('p', null, t('me.rec.parentText')),
      h('ul', { className: 'stack', style: { listStyle: 'none', padding: 0 } }, mine.map(function (c) {
        return h('li', { key: c.studentId, className: 'row' },
          h('span', null, c.name + ' · '),
          c.granted ? h(E.Badge, { tone: 'success', icon: 'check' }, t('me.rec.grant')) : h(E.Badge, { tone: 'outline', icon: 'lock' }, t('me.rec.off')),
          c.granted
            ? h(E.Button, { size: 'sm', variant: 'secondary', onClick: function () { setConsent(c.studentId, false); } }, t('me.rec.withdraw'))
            : h(E.Button, { size: 'sm', variant: 'primary', icon: 'check', onClick: function () { setConsent(c.studentId, true); } }, t('me.rec.grant')));
      })),
      h('p', { className: 'caption muted' }, t('me.rec.storedAt')));
  }

  /* ------------------------------------------------------------------ pojedyncze spotkanie */
  function MeetingCard(p) {
    var m = p.meeting;
    var st = React.useState(null), join = st[0], setJoin = st[1];
    var s2 = React.useState(false), showAtt = s2[0], setShowAtt = s2[1];
    var s3 = React.useState(false), cancelling = s3[0], setCancelling = s3[1];
    function doJoin() {
      A.api.get('/api/meetings/' + m.id + '/join').then(function (r) { setJoin(r); }).catch(err);
    }
    function act(path) { A.api.post('/api/meetings/' + m.id + '/' + path, {}).then(function () { p.onDone(); }).catch(err); }
    var when = A.fmtDate(m.date) + ', ' + m.startTime + '–' + m.endTime;
    return h('article', { className: 'card', 'aria-labelledby': 'h-me-' + m.id },
      h('div', { className: 'row', style: { justifyContent: 'space-between', flexWrap: 'wrap', gap: 'var(--space-2)' } },
        h('h3', { className: 'heading', id: 'h-me-' + m.id, style: { margin: 0 } }, m.title),
        h('div', { className: 'row', style: { gap: 'var(--space-2)' } },
          h(E.Badge, { tone: STATUS_TONE[m.status] || 'outline' }, t('me.status.' + m.status)),
          h(E.Badge, { tone: 'outline' }, t('me.kind.' + m.kind)),
          m.provider === 'none' ? h(E.Badge, { tone: 'danger', icon: 'warning' }, t('me.external')) : h(E.Badge, { tone: 'info', icon: 'lock' }, t('me.selfHosted')),
          m.guardianView ? h(E.Badge, { tone: 'outline', icon: 'user' }, t('me.guardian')) : null,
          m.recording.enabled ? h(E.Badge, { tone: 'accent', icon: 'warning' }, t('me.rec.on'))
            : m.recording.requested && m.recording.missingConsents ? h(E.Badge, { tone: 'outline', icon: 'lock' }, t('me.rec.blocked', { n: m.recording.missingConsents }))
              : h(E.Badge, { tone: 'outline' }, t('me.rec.off')))),
      h('p', { className: 'muted', style: { margin: 'var(--space-1) 0' } },
        t('me.when') + ': ' + when + ' · ' + t('me.host') + ': ' + m.host + (m.waitingRoom ? ' · ' + t('me.waitingOn') : '')),
      m.note ? h('p', { className: 'caption muted' }, m.note) : null,
      !m.canJoin && (m.guardianView || m.joinReason) ? h(E.Alert, { tone: 'info' }, m.guardianView ? t('me.guardianReason') : m.joinReason) : null,
      h('div', { className: 'row', style: { gap: 'var(--space-2)', flexWrap: 'wrap' } },
        m.canJoin && m.status !== 'ended' && m.status !== 'cancelled'
          ? h(E.Button, { variant: 'primary', icon: 'users', onClick: doJoin }, t('me.join')) : null,
        m.isHost && m.status === 'scheduled' ? h(E.Button, { variant: 'secondary', onClick: function () { act('start'); } }, t('me.start')) : null,
        m.isHost && (m.status === 'live' || m.status === 'scheduled') ? h(E.Button, { variant: 'secondary', onClick: function () { act('end'); } }, t('me.end')) : null,
        m.isHost && m.status !== 'cancelled' && m.status !== 'ended' ? h(E.Button, { variant: 'quiet', onClick: function () { setCancelling(true); } }, t('me.cancelMeeting')) : null,
        m.isHost ? h(E.Button, { variant: 'quiet', onClick: function () { setShowAtt(!showAtt); } }, t('me.att.title') + ' (' + m.attendanceCount + ')') : null),
      join ? h('div', { className: 'stack', style: { marginTop: 'var(--space-3)' } },
        h(JoinPanel, { join: join }),
        h(E.Button, { variant: 'quiet', onClick: function () { setJoin(null); } }, t('me.leave'))) : null,
      showAtt ? h('div', { style: { marginTop: 'var(--space-3)' } }, h(Attendance, { meetingId: m.id })) : null,
      cancelling ? h(CancelDialog, { meeting: m, onClose: function () { setCancelling(false); }, onDone: function () { setCancelling(false); p.onDone(); } }) : null);
  }

  /* ------------------------------------------------------------------ konsultacje */
  function Consultations(p) {
    var c = A.useApi('/api/meetings/consultations', []);
    var kids = p.user.childrenIds || [];
    var st = React.useState(kids[0] || ''), child = st[0], setChild = st[1];
    if (!c.data) return h('p', { className: 'muted' }, t('common.loading'));
    var free = c.data.slots;
    if (!free.length) return h('p', { className: 'muted' }, t('me.cons.none'));
    return h('div', { className: 'stack' },
      p.user.role === 'parent' && kids.length > 1
        ? h(E.Select, { label: t('me.cons.child'), value: child, onChange: function (e) { setChild(e.target.value); },
          options: kids.map(function (k) { return { value: k, label: k }; }) }) : null,
      h(E.Table, {
        caption: t('me.cons.free'),
        columns: [
          { key: 'when', title: t('me.when') },
          { key: 'teacher', title: t('common.teacher'), render: function (r) { return r.teacher + (r.subject ? ' · ' + r.subject : ''); } },
          { key: 'act', title: t('me.cons.book'), render: function (r) {
            if (r.mine) return h('span', { className: 'row' }, h(E.Badge, { tone: 'success', icon: 'check' }, t('me.cons.mine')),
              h(E.Button, { size: 'sm', variant: 'quiet', onClick: function () {
                A.api.delete('/api/meetings/consultations/' + r.id + '/book').then(function () { c.reload(); p.onDone(); }).catch(err);
              } }, t('me.cons.cancel')));
            if (r.booked) return h(E.Badge, { tone: 'outline', icon: 'lock' }, t('me.cons.taken'));
            if (p.user.role !== 'parent') return h('span', { className: 'muted' }, '—');
            return h(E.Button, { size: 'sm', 'aria-label': t('me.cons.book') + ' ' + r.when, onClick: function () {
              A.api.post('/api/meetings/consultations/' + r.id + '/book', { studentId: child || undefined })
                .then(function (x) { A.toast(x.confirmation || t('me.cons.booked'), 'success'); c.reload(); p.onDone(); }).catch(err);
            } }, t('me.cons.book'));
          } }],
        rows: free.map(function (r) { return Object.assign({}, r); })
      }),
      h('p', { className: 'caption muted' }, c.data.note));
  }

  /* ------------------------------------------------------------------ karta administratora */
  function AdminCard() {
    var cfg = A.useApi('/api/admin/video', []);
    var st = React.useState(null), f = st[0], set = st[1];
    var s2 = React.useState(null), test = s2[0], setTest = s2[1];
    React.useEffect(function () {
      if (cfg.data && !f) set({ provider: cfg.data.provider, domain: cfg.data.jitsi.domain, appId: cfg.data.jitsi.appId, appSecret: '', bbbUrl: cfg.data.bbb.url, bbbSecret: '' });
    }, [cfg.data]);
    if (cfg.error) return null;
    if (!f) return h(Card, { id: 'me-admin', hid: 'h-me-admin', title: t('me.adm.title') }, h('p', { className: 'muted' }, t('common.loading')));
    var upd = function (k, v) { var n = Object.assign({}, f); n[k] = v; set(n); };
    var body = function () {
      return { provider: f.provider, jitsi: { domain: f.domain, appId: f.appId, appSecret: f.appSecret || undefined }, bbb: { url: f.bbbUrl, secret: f.bbbSecret || undefined } };
    };
    return h(Card, { id: 'me-admin', hid: 'h-me-admin', title: t('me.adm.title') },
      h('div', { className: 'stack' },
        h(E.Select, { label: t('me.adm.provider'), value: f.provider, onChange: function (e) { upd('provider', e.target.value); },
          options: [{ value: 'jitsi', label: 'Jitsi Meet' }, { value: 'bbb', label: 'BigBlueButton' }, { value: 'none', label: t('me.external') }] }),
        f.provider === 'jitsi' ? h(F, null,
          h(E.TextField, { label: t('me.adm.domain'), mono: true, value: f.domain, hint: cfg.data.jitsi.domainFromEnv ? t('me.adm.envDomain') : null, onChange: function (e) { upd('domain', e.target.value); } }),
          h(E.TextField, { label: t('me.adm.appId'), mono: true, value: f.appId, onChange: function (e) { upd('appId', e.target.value); } }),
          h(E.TextField, { label: t('me.adm.secret'), type: 'password', mono: true, value: f.appSecret,
            hint: (cfg.data.jitsi.appSecretSet ? t('me.adm.secretSet') + ' ' : '') + t('me.adm.secretKeep'),
            onChange: function (e) { upd('appSecret', e.target.value); } })) : null,
        f.provider === 'bbb' ? h(F, null,
          h(E.TextField, { label: t('me.adm.bbbUrl'), mono: true, value: f.bbbUrl, onChange: function (e) { upd('bbbUrl', e.target.value); } }),
          h(E.TextField, { label: t('me.adm.bbbSecret'), type: 'password', mono: true, value: f.bbbSecret,
            hint: (cfg.data.bbb.secretSet ? t('me.adm.secretSet') + ' ' : '') + t('me.adm.secretKeep'),
            onChange: function (e) { upd('bbbSecret', e.target.value); } })) : null,
        h('div', { className: 'row', style: { gap: 'var(--space-2)' } },
          h(E.Button, { variant: 'primary', icon: 'check', onClick: function () {
            A.api.patch('/api/admin/video', body()).then(function (r) { A.toast(t('me.adm.saved'), 'success'); setTest({ ok: true, warnings: r.warnings || [], errors: [] }); cfg.reload(); }).catch(err);
          } }, t('common.save')),
          h(E.Button, { variant: 'secondary', onClick: function () {
            A.api.post('/api/admin/video/test', body()).then(function (r) { setTest(r); }).catch(err);
          } }, t('me.adm.test'))),
        test ? h(E.Alert, { tone: test.ok ? 'success' : 'danger' },
          h('div', { className: 'stack' },
            (test.errors || []).length ? h('p', null, test.errors.join(' ')) : null,
            (test.warnings || []).length ? h('p', null, test.warnings.join(' ')) : null,
            test.preview ? h('p', { className: 'caption' }, t('me.adm.preview') + ': ' + test.preview) : null,
            h('p', { className: 'caption' }, t('me.adm.testNote')))) : null,
        cfg.data.csp ? h('p', { className: 'caption muted' }, t('me.adm.csp')) : null,
        h('p', { className: 'caption muted' }, cfg.data.note)));
  }

  /* ------------------------------------------------------------------ ekran */
  A.screen({
    id: 'meetings', path: '/spotkania', title: 'Spotkania', module: 'meetings',
    roles: ['teacher', 'principal', 'counselor', 'psychologist', 'specialEducator', 'speechTherapist', 'supportTeacher',
      'registrar', 'admin', 'student', 'parent', 'careEducator', 'cafeteria', 'librarian', 'nurse', 'dpo'],
    nav: { key: 'nav.meetings', label: 'Spotkania', order: 75 },
    component: function MeetingsScreen(props) {
      var list = A.useApi('/api/meetings', []);
      var cfg = A.useApi('/api/meetings/config', []);
      /* #/spotkania?meeting=<id> — wejście z kursu albo z powiadomienia otwiera od razu to spotkanie. */
      var focusId = (props.route && props.route.query && props.route.query.meeting) || '';
      var one = A.useApi(focusId ? '/api/meetings/' + encodeURIComponent(focusId) : null, [focusId]);
      var st = React.useState('upcoming'), tab = st[0], setTab = st[1];
      var s2 = React.useState(false), scheduling = s2[0], setScheduling = s2[1];
      var reload = function () { list.reload(); };
      var user = props.user;
      var isAdmin = user.role === 'admin';
      var canSchedule = list.data ? list.data.canSchedule : false;

      var tabs = [{ id: 'upcoming', label: t('me.tab.upcoming') }, { id: 'past', label: t('me.tab.past') }, { id: 'cons', label: t('me.tab.cons') }];
      if (isAdmin) tabs.push({ id: 'admin', label: t('me.tab.admin') });

      var rows = list.data ? (tab === 'past' ? list.data.past : list.data.upcoming) : [];
      var classList = (cfg.data && cfg.data.classes) || [];

      if (focusId) {
        return h('div', { className: 'stack' },
          h('h1', { className: 'display app-title' }, t('me.title')),
          h('p', { className: 'app-sub' }, t('me.oneTitle')),
          h('div', { className: 'row' },
            h(E.Button, { icon: 'chevron-left', variant: 'quiet', onClick: function () { A.navigate('/spotkania'); } }, t('me.backToAll'))),
          one.loading ? h('p', { className: 'muted', 'aria-live': 'polite' }, t('me.loading')) : null,
          one.error ? h(E.Alert, { tone: 'danger' }, one.error.message || t('me.notFound')) : null,
          one.data ? h(F, null,
            h(MeetingCard, { meeting: one.data, onDone: function () { one.reload(); } }),
            user.role === 'parent' && one.data.recording.requested && one.data.recording.missingConsents && one.data.status !== 'cancelled'
              ? h(ConsentCard, { meeting: one.data, childrenIds: user.childrenIds || [], onDone: function () { one.reload(); } }) : null) : null);
      }

      return h('div', { className: 'stack' },
        h('h1', { className: 'display app-title' }, t('me.title')),
        h('p', { className: 'app-sub' }, t('me.sub')),
        cfg.data && cfg.data.placeholderDomain && cfg.data.provider === 'jitsi'
          ? h(E.Alert, { tone: 'warning' }, t('me.placeholderWarn')) : null,
        canSchedule ? h('div', { className: 'row' },
          h(E.Button, { variant: 'primary', icon: 'plus', onClick: function () { setScheduling(true); } }, t('me.schedule'))) : null,
        h(E.Tabs, { tabs: tabs, value: tab, onChange: setTab, label: t('me.title') }),
        tab === 'admin' ? h(AdminCard, null)
          : tab === 'cons' ? h(Card, { id: 'me-cons', hid: 'h-me-cons', title: t('me.cons.title') }, h(Consultations, { user: user, onDone: reload }))
            : h('div', { className: 'stack' },
              list.loading ? h('p', { className: 'muted', 'aria-live': 'polite' }, t('me.loading')) : null,
              !list.loading && !rows.length ? h('p', { className: 'muted' }, t('me.none')) : null,
              rows.map(function (m) {
                return h(F, { key: m.id },
                  h(MeetingCard, { meeting: m, onDone: reload }),
                  user.role === 'parent' && m.recording.requested && m.recording.missingConsents && m.status !== 'cancelled'
                    ? h(ConsentCard, { meeting: m, childrenIds: user.childrenIds || [], onDone: reload }) : null);
              })),
        scheduling ? h(ScheduleDialog, {
          cfg: cfg.data || {}, classes: classList.length ? classList : [{ id: '7b', name: '7b' }],
          onClose: function () { setScheduling(false); },
          onDone: function () { setScheduling(false); reload(); }
        }) : null);
    }
  });
})();
