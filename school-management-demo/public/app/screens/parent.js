/* Ekran rodzica (3.7): przełączanie dzieci, alert o nieobecności na 1. lekcji, plan dnia z frekwencją,
   oceny z komentarzami i średnią, tydzień frekwencji, usprawiedliwienia (także planowane), wiadomości
   z potwierdzeniem odbioru i wiadomością poufną do pedagoga, płatności z potwierdzeniem i odwołaniem
   obiadu, e-podpis zgód na wycieczkę, rezerwacja konsultacji, cisza nocna i eksport roczny.
   Port ../design-system/components/ParentMobile/preview.html podłączony do /api/parent/*. */
(function () {
  var E = window.EdMat, A = window.EdApp, h = React.createElement, F = React.Fragment;

  window.EdI18n.add({
    pl: {
      'pa.title': 'Dziennik rodzica', 'pa.loadingKids': 'Wczytywanie danych dzieci…', 'pa.opFailed': 'Nie udało się wykonać operacji.',
      'pa.ownAccount': 'moje konto i ustawienia — otwiera ekran Ustawienia', 'pa.activeProfile': 'Aktywny profil: {name} · {class} · wychowawca {homeroom}',
      'pa.absenceAlert': 'Powiadomienie push · nieobecność na 1. lekcji',
      'pa.absenceText': '{student} — {date}, 1. lekcja. Jeśli to pomyłka, napisz do wychowawcy lub zadzwoń do sekretariatu.',
      'pa.warnTitle': 'Zawiadomienie formalne czeka na potwierdzenie odbioru',
      'pa.warnText': 'Liczba zawiadomień do potwierdzenia: {n}. Potwierdzenie zapisujemy z datą i godziną.',
      'pa.todayTitle': 'Dzisiaj · {name} ({class})', 'pa.loadingDay': 'Wczytywanie planu dnia…', 'pa.noLessons': 'W tym dniu nie ma zaplanowanych lekcji.',
      'pa.gradesTitle': 'Oceny, średnie i komentarze', 'pa.loadingGrades': 'Wczytywanie ocen…',
      'pa.subjAvg': '{subject} · średnia {avg}', 'pa.classAvg': ' · klasa {v}', 'pa.rank': ' · miejsce {n} z {of}',
      'pa.proposed': ' · propozycja {v}', 'pa.final': ' · ocena {v}',
      'pa.weightedAvg': 'Średnia ważona', 'pa.allSubjectsAsOf': 'wszystkie przedmioty · stan na {date}',
      'pa.attTitle': 'Frekwencja · ten tydzień', 'pa.loadingAtt': 'Wczytywanie frekwencji…',
      'pa.statusLegend': 'Statusy: ob obecny, nb nieobecny, sp spóźnienie, u usprawiedliwiona, zw zwolniony, w wycieczka. Frekwencja w tygodniu: {pct}.',
      'pa.excuses': 'Usprawiedliwienia', 'pa.excCaption': 'Wnioski o usprawiedliwienie · {name}', 'pa.period': 'Okres',
      'pa.plannedNote': 'nieobecność planowana', 'pa.homeroomTeacher': 'Wychowawca', 'pa.loadingExc': 'Wczytywanie wniosków…',
      'pa.jump': 'Skocz do sekcji',
      'pa.jump.today': 'Dzisiaj', 'pa.jump.grades': 'Oceny', 'pa.jump.att': 'Frekwencja', 'pa.jump.exc': 'Usprawiedliwienia', 'pa.jump.msg': 'Wiadomości', 'pa.jump.pay': 'Płatności', 'pa.jump.cons': 'Zgody', 'pa.jump.meet': 'Spotkania',
      'pa.goExcuse': 'Wyślij usprawiedliwienie',
      'pa.goWarnings': 'Przejdź do zawiadomień',
      'pa.newExcuse': 'Nowe usprawiedliwienie', 'pa.sendRequest': 'Wyślij wniosek',
      'pa.absFrom': 'Nieobecność od', 'pa.absTo': 'Nieobecność do', 'pa.noteLabel': 'Komentarz dla wychowawcy',
      'pa.notePh': 'np. zabieg planowany w poradni', 'pa.planned': 'Nieobecność planowana — powiadom nauczycieli przedmiotów',
      'pa.excNote': 'Wniosek jest bezpłatny. Decyzję podejmuje wychowawca; przy odmowie zobaczysz jej powód.',
      'pa.exc.approved': 'Zatwierdzone', 'pa.exc.rejected': 'Odrzucone', 'pa.exc.pending': 'Oczekuje',
      'pa.reason.illness': 'Choroba', 'pa.reason.doctor': 'Wizyta u lekarza', 'pa.reason.family': 'Sprawy rodzinne', 'pa.reason.trip': 'Wyjazd planowany',
      'pa.msgTitle': 'Wiadomości i zawiadomienia', 'pa.formalNotice': 'zawiadomienie formalne', 'pa.daysBefore': 'Na {n} dni przed klasyfikacją. ',
      'pa.ackReceipt': 'Potwierdzam odbiór', 'pa.ackedAt': 'Odbiór potwierdzony {at}', 'pa.noWarnings': 'Brak zawiadomień formalnych.',
      'pa.openInbox': 'Otwórz skrzynkę', 'pa.guardianNoteTitle': 'Konto opiekuna z pełnią władzy rodzicielskiej', 'pa.onlyYou': 'tylko Ty',
      'pa.guardianNoteBody': 'Korespondencja i dane kontaktowe tego konta nie są widoczne dla drugiego opiekuna. Wiadomości poufne czyta wyłącznie adresat.',
      'pa.confTitle': 'Wiadomość poufna do pedagoga', 'pa.sendConfidential': 'Wyślij poufnie', 'pa.recipient': 'Odbiorca',
      'pa.subject': 'Temat', 'pa.body': 'Treść',
      'pa.confHint': 'Wiadomość poufną czyta wyłącznie adresat — nie widzą jej pozostali pracownicy szkoły ani dyrekcja.',
      'pa.payments': 'Płatności', 'pa.feesCaption': 'Opłaty szkolne', 'pa.feeTitle': 'Tytuł', 'pa.amount': 'Kwota', 'pa.due': 'Termin', 'pa.payment': 'Płatność',
      'pa.paidNo': 'Opłacono · nr {no}', 'pa.receipt': 'Potwierdzenie', 'pa.payAria': 'Zapłać: {title}', 'pa.pay': 'Zapłać',
      'pa.loadingPay': 'Wczytywanie opłat…', 'pa.cancelLunch': 'Odwołaj dzisiejszy obiad (do {time})', 'pa.lunchBalance': 'Saldo konta obiadowego',
      'pa.payTitle': 'Zapłać: {title}', 'pa.payAmount': 'Zapłać {amount}', 'pa.payLine': 'Kwota {amount}, tytuł: {title} · {student}.',
      'pa.payMethod': 'Forma płatności', 'pa.pm.transfer': 'Przelew online', 'pa.pm.blik': 'BLIK', 'pa.pm.card': 'Karta płatnicza',
      'pa.payNote': 'Po autoryzacji potwierdzenie z numerem pojawi się na liście i w wersji gotowej do wydruku. Połączenie jest szyfrowane.',
      'pa.consents': 'Zgody na wycieczki', 'pa.leader': 'Kierownik: {name}', 'pa.insurance': ' · ubezpieczenie {insurer}, polisa {policy}',
      'pa.cost': ' · koszt {cost}', 'pa.noConsents': 'Brak zgód oczekujących na podpis.', 'pa.signInApp': 'Podpisz w aplikacji',
      'pa.consentTitle': 'Podpis zgody: {name}',
      'pa.consentAgree': 'Zapoznałam/em się z regulaminem i wyrażam zgodę na udział dziecka',
      'pa.consentHint': 'Podpis w aplikacji jest równoważny podpisowi na papierze.',
      'pa.password': 'Hasło do konta w dzienniku', 'pa.passwordHint': 'Powtórne podanie hasła autoryzuje podpis.',
      'pa.meetings': 'Zebrania, dni otwarte i konsultacje', 'pa.roomSuffix': ', sala {room}', 'pa.slotsCaption': 'Wolne terminy konsultacji',
      'pa.when': 'Termin', 'pa.booking': 'Rezerwacja', 'pa.yourBooking': 'Twoja rezerwacja', 'pa.taken': 'Zajęty',
      'pa.bookAria': 'Zarezerwuj termin {when}', 'pa.book': 'Zarezerwuj', 'pa.loadingMeet': 'Wczytywanie terminów…',
      'pa.settingsExport': 'Ustawienia i eksport', 'pa.quietLabel': 'Tryb nocny {from}–{to} (alerty kryzysowe zawsze)',
      'pa.off': 'wył.', 'pa.on': 'wł.', 'pa.deferred': ' Odłożonych powiadomień: {n}.',
      'pa.export': 'Eksportuj historię ocen i frekwencji (PDF)',
      'pa.exportNote': 'Eksport obejmuje oceny, średnie, komentarze i frekwencję z całego roku szkolnego; dokument otwiera się w nowej karcie gotowy do wydruku.',
      'pa.footer': 'Dostęp do ocen i frekwencji jest bezpłatny i bezterminowy. Aplikacja nie zawiera reklam ani modułów śledzących.'
    },
    en: {
      'pa.title': 'Parent logbook', 'pa.loadingKids': 'Loading your children’s data…', 'pa.opFailed': 'The operation could not be completed.',
      'pa.ownAccount': 'my account and settings — opens the Settings screen', 'pa.activeProfile': 'Active profile: {name} · {class} · homeroom teacher {homeroom}',
      'pa.absenceAlert': 'Push notification · absence in lesson 1',
      'pa.absenceText': '{student} — {date}, lesson 1. If this is a mistake, message the homeroom teacher or call the school office.',
      'pa.warnTitle': 'A formal notice is waiting for your confirmation of receipt',
      'pa.warnText': 'Notices awaiting confirmation: {n}. The confirmation is recorded with date and time.',
      'pa.todayTitle': 'Today · {name} ({class})', 'pa.loadingDay': 'Loading the day’s timetable…', 'pa.noLessons': 'No lessons are scheduled for this day.',
      'pa.gradesTitle': 'Grades, averages and comments', 'pa.loadingGrades': 'Loading grades…',
      'pa.subjAvg': '{subject} · average {avg}', 'pa.classAvg': ' · class {v}', 'pa.rank': ' · rank {n} of {of}',
      'pa.proposed': ' · proposed {v}', 'pa.final': ' · final {v}',
      'pa.weightedAvg': 'Weighted average', 'pa.allSubjectsAsOf': 'all subjects · as of {date}',
      'pa.attTitle': 'Attendance · this week', 'pa.loadingAtt': 'Loading attendance…',
      'pa.statusLegend': 'Statuses: ob present, nb absent, sp late, u excused, zw released, w school trip. Attendance this week: {pct}.',
      'pa.excuses': 'Excuses', 'pa.excCaption': 'Excuse requests · {name}', 'pa.period': 'Period',
      'pa.plannedNote': 'planned absence', 'pa.homeroomTeacher': 'Homeroom teacher', 'pa.loadingExc': 'Loading requests…',
      'pa.jump': 'Jump to a section',
      'pa.jump.today': 'Today', 'pa.jump.grades': 'Grades', 'pa.jump.att': 'Attendance', 'pa.jump.exc': 'Absence notes', 'pa.jump.msg': 'Messages', 'pa.jump.pay': 'Payments', 'pa.jump.cons': 'Consents', 'pa.jump.meet': 'Meetings',
      'pa.goExcuse': 'Send an absence note',
      'pa.goWarnings': 'Go to the notices',
      'pa.newExcuse': 'New excuse', 'pa.sendRequest': 'Send request',
      'pa.absFrom': 'Absent from', 'pa.absTo': 'Absent to', 'pa.noteLabel': 'Comment for the homeroom teacher',
      'pa.notePh': 'e.g. procedure scheduled at the clinic', 'pa.planned': 'Planned absence — notify subject teachers',
      'pa.excNote': 'The request is free. The homeroom teacher decides; if refused, you will see the reason.',
      'pa.exc.approved': 'Approved', 'pa.exc.rejected': 'Rejected', 'pa.exc.pending': 'Pending',
      'pa.reason.illness': 'Illness', 'pa.reason.doctor': 'Doctor’s appointment', 'pa.reason.family': 'Family matters', 'pa.reason.trip': 'Planned trip',
      'pa.msgTitle': 'Messages and notices', 'pa.formalNotice': 'formal notice', 'pa.daysBefore': '{n} days before classification. ',
      'pa.ackReceipt': 'I confirm receipt', 'pa.ackedAt': 'Receipt confirmed {at}', 'pa.noWarnings': 'No formal notices.',
      'pa.openInbox': 'Open the inbox', 'pa.guardianNoteTitle': 'Guardian account with full parental authority', 'pa.onlyYou': 'you only',
      'pa.guardianNoteBody': 'The correspondence and contact details of this account are not visible to the other guardian. Confidential messages are read only by the addressee.',
      'pa.confTitle': 'Confidential message to the counsellor', 'pa.sendConfidential': 'Send confidentially', 'pa.recipient': 'Recipient',
      'pa.subject': 'Subject', 'pa.body': 'Message',
      'pa.confHint': 'A confidential message is read only by the addressee — other school staff and the principal cannot see it.',
      'pa.payments': 'Payments', 'pa.feesCaption': 'School fees', 'pa.feeTitle': 'Title', 'pa.amount': 'Amount', 'pa.due': 'Due date', 'pa.payment': 'Payment',
      'pa.paidNo': 'Paid · no. {no}', 'pa.receipt': 'Receipt', 'pa.payAria': 'Pay: {title}', 'pa.pay': 'Pay',
      'pa.loadingPay': 'Loading fees…', 'pa.cancelLunch': 'Cancel today’s lunch (until {time})', 'pa.lunchBalance': 'Lunch account balance',
      'pa.payTitle': 'Pay: {title}', 'pa.payAmount': 'Pay {amount}', 'pa.payLine': 'Amount {amount}, title: {title} · {student}.',
      'pa.payMethod': 'Payment method', 'pa.pm.transfer': 'Online transfer', 'pa.pm.blik': 'BLIK', 'pa.pm.card': 'Payment card',
      'pa.payNote': 'After authorisation a numbered receipt appears in the list and in a print-ready version. The connection is encrypted.',
      'pa.consents': 'School trip consents', 'pa.leader': 'Trip leader: {name}', 'pa.insurance': ' · insurer {insurer}, policy {policy}',
      'pa.cost': ' · cost {cost}', 'pa.noConsents': 'No consents are waiting for a signature.', 'pa.signInApp': 'Sign in the app',
      'pa.consentTitle': 'Consent signature: {name}',
      'pa.consentAgree': 'I have read the rules and consent to my child taking part',
      'pa.consentHint': 'A signature in the app is equivalent to a signature on paper.',
      'pa.password': 'Your logbook account password', 'pa.passwordHint': 'Entering the password again authorises the signature.',
      'pa.meetings': 'Parent meetings, open days and consultations', 'pa.roomSuffix': ', room {room}', 'pa.slotsCaption': 'Free consultation slots',
      'pa.when': 'Slot', 'pa.booking': 'Booking', 'pa.yourBooking': 'Your booking', 'pa.taken': 'Taken',
      'pa.bookAria': 'Book the slot {when}', 'pa.book': 'Book', 'pa.loadingMeet': 'Loading slots…',
      'pa.settingsExport': 'Settings and export', 'pa.quietLabel': 'Quiet hours {from}–{to} (crisis alerts always get through)',
      'pa.off': 'off', 'pa.on': 'on', 'pa.deferred': ' Deferred notifications: {n}.',
      'pa.export': 'Export the grade and attendance history (PDF)',
      'pa.exportNote': 'The export covers grades, averages, comments and attendance for the whole school year; the document opens in a new tab ready to print.',
      'pa.footer': 'Access to grades and attendance is free and unlimited in time. The app contains no ads and no tracking modules.'
    }
  });

  var EXC_TONE = { approved: 'success', rejected: 'danger', pending: 'accent' };
  /* Wartości trafiają na serwer jako treść powodu — zostają po polsku; tłumaczymy tylko etykiety. */
  var REASONS = [
    { value: 'Choroba', key: 'pa.reason.illness' },
    { value: 'Wizyta u lekarza', key: 'pa.reason.doctor' },
    { value: 'Sprawy rodzinne', key: 'pa.reason.family' },
    { value: 'Wyjazd planowany', key: 'pa.reason.trip' }
  ];
  function reasons() { return REASONS.map(function (r) { return { value: r.value, label: A.t(r.key) }; }); }
  /* Native date inputs follow the BROWSER locale, so repeat the chosen day in the interface locale. */
  var JUMPS = [['dzisiaj', 'pa.jump.today'], ['oceny', 'pa.jump.grades'], ['frekwencja', 'pa.jump.att'], ['usprawiedliwienia', 'pa.jump.exc'], ['wiadomosci', 'pa.jump.msg'], ['platnosci', 'pa.jump.pay'], ['zgody', 'pa.jump.cons'], ['spotkania', 'pa.jump.meet']];

  function Section(p) {
    return h('section', { className: 'card', 'aria-labelledby': p.hid, id: p.id },
      h('h2', { className: 'heading', id: p.hid }, p.title), p.children);
  }
  /* Gdy w dzienniku jest alert o nieobecności, a telefon nic nie zadzwonił — podpowiedz włączenie
     push dokładnie tam, gdzie to widać. Prośba znika sama, kiedy subskrypcja już jest, kiedy
     szkoła push nie włączyła i kiedy przeglądarka odmówiła zgody (wtedy prosi się w ustawieniach). */
  function PushPrompt(p) {
    var st = React.useState(null); var s = st[0], set = st[1];
    React.useEffect(function () { A.push.status().then(set).catch(function () { set({ supported: false }); }); }, []);
    if (!p.show || !s || !s.supported || !s.schoolEnabled || s.subscribed || s.permission === 'denied') return null;
    function enable() {
      A.push.subscribe()
        .then(function () { A.toast(A.t('push.on'), 'success'); set(Object.assign({}, s, { subscribed: true })); })
        .catch(function (e) { A.toast(e.message || A.t('common.error'), 'danger'); });
    }
    return h(E.Alert, { tone: 'info', title: A.t('push.promptTitle') },
      h('p', { style: { margin: 0 } }, A.t('push.promptText')),
      h('div', { className: 'row mt-2' },
        h(E.Button, { size: 'sm', variant: 'primary', icon: 'bell', onClick: enable }, A.t('push.promptCta')),
        h(E.Button, { size: 'sm', onClick: function () { A.navigate('/ustawienia'); } }, A.t('shell.settings'))));
  }

  function err(e) { A.toast(e.message || A.t('pa.opFailed'), 'danger'); }
  function tripMeta(t) {
    return (t.insurance ? A.t('pa.insurance', { insurer: t.insurance.insurer, policy: t.insurance.policyNo }) : '')
      + (t.cost != null ? A.t('pa.cost', { cost: A.fmtMoney(t.cost) }) : '');
  }

  /* ---------------------------------------------------------------- usprawiedliwienia */
  function ExcuseDialog(p) {
    var st = React.useState({ from: p.today, to: p.today, reason: REASONS[0].value, note: '', planned: false, busy: false }), f = st[0], set = st[1];
    var s2 = React.useState(null), e2 = s2[0], setE = s2[1];
    function send() {
      if (f.busy) return;
      setE(null); set(Object.assign({}, f, { busy: true }));
      A.api.post('/api/parent/excuses', {
        studentId: p.studentId, from: f.from, to: f.to, planned: f.planned,
        reason: f.reason + (f.note ? ' — ' + f.note : ''), channel: 'mobile'
      }).then(function (r) { A.toast(r.receipt, 'success'); p.onDone(); }).catch(function (x) { set(Object.assign({}, f, { busy: false })); setE(x.message); });
    }
    return h(E.Dialog, {
      title: A.t('pa.newExcuse'), onClose: p.onClose, initialFocus: '#exc-from',
      actions: [h(E.Button, { key: 'c', variant: 'secondary', onClick: p.onClose }, A.t('common.cancel')),
        h(E.Button, { key: 'o', variant: 'primary', icon: 'check', loading: f.busy, disabled: f.busy, onClick: send }, A.t('pa.sendRequest'))]
    },
      e2 ? h(E.Alert, { tone: 'danger' }, e2) : null,
      h('div', { className: 'stack' },
        h(E.TextField, Object.assign({ id: 'exc-from', label: A.t('pa.absFrom'), type: 'date', value: f.from, hint: A.dateHint(f.from), onChange: function (ev) { set(Object.assign({}, f, { from: ev.target.value })); } }, A.dateInputProps())),
        h(E.TextField, Object.assign({ label: A.t('pa.absTo'), type: 'date', value: f.to, hint: A.dateHint(f.to), onChange: function (ev) { set(Object.assign({}, f, { to: ev.target.value })); } }, A.dateInputProps())),
        h(E.Select, { label: A.t('common.reason'), value: f.reason, options: reasons(), onChange: function (ev) { set(Object.assign({}, f, { reason: ev.target.value })); } }),
        h(E.TextField, { label: A.t('pa.noteLabel'), value: f.note, placeholder: A.t('pa.notePh'), onChange: function (ev) { set(Object.assign({}, f, { note: ev.target.value })); } }),
        h(E.Checkbox, { label: A.t('pa.planned'), checked: f.planned, onChange: function (ev) { set(Object.assign({}, f, { planned: ev.target.checked })); } }),
        h('p', { className: 'caption muted' }, A.t('pa.excNote'))));
  }

  /* ---------------------------------------------------------------- płatności */
  function PayDialog(p) {
    var st = React.useState('przelew online'), method = st[0], setMethod = st[1];
    var b = React.useState(false), busy = b[0], setBusy = b[1];
    var amount = A.fmtMoney(p.payment.amount);
    return h(E.Dialog, {
      title: A.t('pa.payTitle', { title: p.payment.title }), onClose: p.onClose,
      actions: [h(E.Button, { key: 'c', variant: 'secondary', onClick: p.onClose }, A.t('common.cancel')),
        h(E.Button, { key: 'o', variant: 'primary', icon: 'check', loading: busy, disabled: busy, onClick: function () {
          setBusy(true);
          A.api.post('/api/parent/payments/' + p.payment.id + '/pay', { method: method })
            .then(function (r) { A.toast(r.receipt, 'success'); p.onDone(r); }).catch(function (e) { setBusy(false); err(e); });
        } }, A.t('pa.payAmount', { amount: amount }))]
    },
      h('p', null, A.t('pa.payLine', { amount: amount, title: p.payment.title, student: p.payment.student })),
      h(E.Select, {
        label: A.t('pa.payMethod'), value: method, onChange: function (e) { setMethod(e.target.value); },
        options: [{ value: 'przelew online', label: A.t('pa.pm.transfer') }, { value: 'BLIK', label: A.t('pa.pm.blik') }, { value: 'karta', label: A.t('pa.pm.card') }]
      }),
      h('p', { className: 'caption muted' }, A.t('pa.payNote')));
  }

  /* ---------------------------------------------------------------- zgoda na wycieczkę */
  function ConsentDialog(p) {
    var st = React.useState({ agree: false, password: '', busy: false }), f = st[0], set = st[1];
    var s2 = React.useState(null), e2 = s2[0], setE = s2[1];
    return h(E.Dialog, {
      title: A.t('pa.consentTitle', { name: p.trip.name }), onClose: p.onClose, initialFocus: '#cons-agree',
      actions: [h(E.Button, { key: 'c', variant: 'secondary', onClick: p.onClose }, A.t('common.cancel')),
        h(E.Button, { key: 'o', variant: 'primary', icon: 'edit', loading: f.busy, disabled: f.busy || !f.agree || !f.password, onClick: function () {
          setE(null); set(Object.assign({}, f, { busy: true }));
          A.api.post('/api/parent/trips/' + p.trip.tripId + '/consent', { studentId: p.studentId, agree: true, password: f.password })
            .then(function (r) { A.toast(r.confirmation, 'success'); p.onDone(); }).catch(function (x) { set(Object.assign({}, f, { busy: false })); setE(x.message); });
        } }, A.t('pa.signInApp'))]
    },
      e2 ? h(E.Alert, { tone: 'danger' }, e2) : null,
      h('p', { className: 'caption muted' }, p.trip.period + tripMeta(p.trip)),
      h('div', { className: 'stack' },
        h(E.Checkbox, { id: 'cons-agree', label: A.t('pa.consentAgree'), hint: A.t('pa.consentHint'), checked: f.agree, onChange: function (e) { set(Object.assign({}, f, { agree: e.target.checked })); } }),
        h(E.TextField, { label: A.t('pa.password'), type: 'password', autoComplete: 'current-password', value: f.password, hint: A.t('pa.passwordHint'), onChange: function (e) { set(Object.assign({}, f, { password: e.target.value })); } })));
  }

  /* ---------------------------------------------------------------- wiadomość poufna */
  function CounselorDialog(p) {
    var st = React.useState({ to: '', subject: '', body: '', busy: false }), f = st[0], set = st[1];
    var s2 = React.useState(null), e2 = s2[0], setE = s2[1];
    var list = (p.recipients || []).filter(function (r) { return r.role === 'counselor' || r.role === 'psychologist'; });
    React.useEffect(function () { if (!f.to && list.length) set(Object.assign({}, f, { to: list[0].id })); }, [list.length]);
    return h(E.Dialog, {
      title: A.t('pa.confTitle'), onClose: p.onClose, initialFocus: '#conf-to',
      actions: [h(E.Button, { key: 'c', variant: 'secondary', onClick: p.onClose }, A.t('common.cancel')),
        h(E.Button, { key: 'o', variant: 'primary', icon: 'lock', loading: f.busy, disabled: f.busy || !f.to || !f.subject.trim() || !f.body.trim(), onClick: function () {
          setE(null); set(Object.assign({}, f, { busy: true }));
          A.api.post('/api/messages', { toUserIds: [f.to], subject: f.subject, body: f.body, confidential: true })
            .then(function (r) { A.toast(r.receipt, 'success'); p.onDone(); }).catch(function (x) { set(Object.assign({}, f, { busy: false })); setE(x.message); });
        } }, A.t('pa.sendConfidential'))]
    },
      e2 ? h(E.Alert, { tone: 'danger' }, e2) : null,
      h('div', { className: 'stack' },
        h(E.Select, { id: 'conf-to', label: A.t('pa.recipient'), value: f.to, options: list.map(function (r) { return { value: r.id, label: r.name + ' – ' + A.t('role.' + r.role) }; }), onChange: function (e) { set(Object.assign({}, f, { to: e.target.value })); } }),
        h(E.TextField, { label: A.t('pa.subject'), value: f.subject, onChange: function (e) { set(Object.assign({}, f, { subject: e.target.value })); } }),
        h(E.TextField, { label: A.t('pa.body'), multiline: 5, value: f.body, hint: A.t('pa.confHint'), onChange: function (e) { set(Object.assign({}, f, { body: e.target.value })); } })));
  }

  A.screen({
    id: 'parent', path: '/rodzic', title: 'Dziennik rodzica', roles: ['parent'], module: 'parent',
    nav: { key: 'nav.logbook', label: 'Dziennik', order: 10 },
    component: function ParentScreen(props) {
      var q = props.route.query || {};
      var kids = A.useApi('/api/parent/children', []);
      var first = kids.data && kids.data.children.length ? kids.data.children[0].studentId : null;
      var st = React.useState(q.studentId || null), picked = st[0], setPicked = st[1];
      var sid = picked || q.studentId || first;

      var over = A.useApi(sid ? '/api/parent/overview?studentId=' + sid : null, [sid]);
      var exc = A.useApi(sid ? '/api/parent/excuses?studentId=' + sid : null, [sid]);
      var warn = A.useApi('/api/parent/warnings', []);
      var pay = A.useApi(sid ? '/api/parent/payments?studentId=' + sid : null, [sid]);
      var caf = A.useApi(sid ? '/api/parent/cafeteria?studentId=' + sid : null, [sid]);
      var cons = A.useApi(sid ? '/api/parent/consents?studentId=' + sid : null, [sid]);
      var meet = A.useApi('/api/parent/meetings', []);
      var quiet = A.useApi('/api/parent/quiet-hours', []);
      var recip = A.useApi('/api/messages/recipients', []);

      var d1 = React.useState(false), excOpen = d1[0], setExcOpen = d1[1];
      var d2 = React.useState(null), payOpen = d2[0], setPayOpen = d2[1];
      var d3 = React.useState(null), consOpen = d3[0], setConsOpen = d3[1];
      var d4 = React.useState(false), confOpen = d4[0], setConfOpen = d4[1];
      var d5 = React.useState(''), line = d5[0], setLine = d5[1];

      if (kids.error) return h('div', null, h('h1', { className: 'display app-title' }, A.t('pa.title')), h(E.Alert, { tone: 'danger' }, kids.error.message));
      if (!kids.data) return h('div', null, h('h1', { className: 'display app-title' }, A.t('pa.title')), h('p', { className: 'muted' }, A.t('pa.loadingKids')));

      var children = kids.data.children;
      var kid = children.filter(function (c) { return c.studentId === sid; })[0] || children[0];
      var o = over.data;
      var accounts = children.map(function (c) { return { id: c.studentId, name: c.label, meta: c.className + ' · ' + c.school, kind: 'child' }; })
        .concat([{ id: 'me', name: kids.data.parent.name, meta: A.t('pa.ownAccount'), kind: 'user' }]);

      function reloadAll() { over.reload(); exc.reload(); pay.reload(); caf.reload(); cons.reload(); warn.reload(); }

      return h('div', { className: 'stack' },
        h('div', null,
          h('h1', { className: 'display app-title' }, A.t('pa.title')),
          h('p', { className: 'app-sub' }, (o ? A.fmtDate(o.date) : '') + ' · ' + (props.config ? props.config.school.name : ''))),

        h(E.AccountSwitcher, {
          accounts: accounts, current: sid,
          onSelect: function (id) { if (id === 'me') { A.navigate('/ustawienia'); return; } setPicked(id); A.navigate('/rodzic', { studentId: id }); }
        }),
        h('p', { className: 'caption muted', 'aria-live': 'polite' }, kid ? A.t('pa.activeProfile', { name: kid.label, 'class': kid.className, homeroom: kid.homeroom }) : ''),

        /* Nine stacked sections on a 390 px phone: give the thumb a way to jump. */
        h('nav', { className: 'app-jump', 'aria-label': A.t('pa.jump') }, JUMPS.map(function (j) {
          return h('a', { key: j[0], href: '#' + j[0], onClick: function (ev) { ev.preventDefault(); var el = document.getElementById(j[0]); if (el) { el.scrollIntoView({ block: 'start' }); var hd = el.querySelector('h2'); if (hd) { hd.tabIndex = -1; hd.focus(); } } } }, A.t(j[1]));
        })),

        o && o.absenceAlerts.length
          ? h(E.Alert, { tone: 'danger', title: A.t('pa.absenceAlert') },
            h('p', { style: { margin: 0 } }, o.absenceAlerts.map(function (a) { return A.t('pa.absenceText', { student: a.student, date: A.fmtDate(a.date) }); }).join(' ')),
            h('div', { className: 'row mt-2' }, h(E.Button, { size: 'sm', variant: 'primary', icon: 'plus', onClick: function () { setExcOpen(true); } }, A.t('pa.goExcuse'))))
          : null,
        h(PushPrompt, { show: !!(o && o.absenceAlerts.length) }),
        o && o.warningsToAck ? h(E.Alert, { tone: 'warning', title: A.t('pa.warnTitle') },
          h('p', { style: { margin: 0 } }, A.t('pa.warnText', { n: o.warningsToAck })),
          h('div', { className: 'row mt-2' }, h(E.Button, { size: 'sm', icon: 'check', onClick: function () { var el = document.getElementById('wiadomosci'); if (el) el.scrollIntoView({ block: 'start' }); } }, A.t('pa.goWarnings')))) : null,

        /* ---- dzisiaj ---- */
        h(Section, { id: 'dzisiaj', hid: 'h-dzis', title: A.t('pa.todayTitle', { name: kid ? kid.name : '', 'class': kid ? kid.className : '' }) },
          !o ? h('p', { className: 'muted' }, A.t('pa.loadingDay'))
            : !o.lessons.length ? h('p', { className: 'muted' }, A.t('pa.noLessons'))
              : h('div', { className: 'stack', style: { gap: 'var(--space-3)' } }, o.lessons.map(function (l) {
                return h('div', { key: l.id, className: 'stack', style: { gap: 'var(--space-1)' } },
                  h(E.LessonCard, { no: l.lessonNo, start: l.start, end: l.end, subject: A.subjectName(l.subjectId, l.subject), group: l.group || kid.className, room: l.room, teacher: l.teacher, state: l.substitute ? 'sub' : 'normal' }),
                  h('div', { className: 'row', style: { gap: 'var(--space-2)' } },
                    h('span', { className: 'label', style: { color: 'var(--ink-muted)' } }, A.t('common.attendance')),
                    h(E.AttendanceChip, { status: l.attendance.status, minutes: l.attendance.minutes || undefined, word: true })));
              }))),

        /* ---- oceny ---- */
        h(Section, { id: 'oceny', hid: 'h-oceny', title: A.t('pa.gradesTitle') },
          !o ? h('p', { className: 'muted' }, A.t('pa.loadingGrades')) : h(F, null,
            o.grades.subjects.map(function (s) {
              return h('div', { key: s.subjectId, className: 'row', style: { alignItems: 'flex-end', marginBottom: 'var(--space-3)' } },
                h('span', { className: 'caption', style: { flex: '0 0 100%', color: 'var(--ink-muted)' } },
                  A.t('pa.subjAvg', { subject: A.subjectName(s.subjectId, s.subject), avg: A.fmtNum(s.average) })
                  + (s.classAverage != null ? A.t('pa.classAvg', { v: A.fmtNum(s.classAverage) }) : '')
                  + (s.rank ? A.t('pa.rank', { n: s.rank, of: s.rankOf }) : '')
                  + (s.proposed ? A.t('pa.proposed', { v: s.proposed }) : '')
                  + (s.final ? A.t('pa.final', { v: s.final }) : '')),
                s.grades.map(function (g, i) {
                  return h(E.GradeCell, { key: g.id || i, value: g.value, showWeight: true, weight: g.weight, categoryName: g.categoryName, comment: !!g.comment, student: kid.label, date: A.fmtDate(g.date) });
                }),
                s.grades.filter(function (g) { return g.comment; }).map(function (g, i) {
                  return h('p', { key: 'c' + i, className: 'caption muted', style: { flex: '0 0 100%', margin: 0 } }, A.fmtDate(g.date) + ' · ' + g.value + ': ' + g.comment);
                }));
            }),
            h(E.StatTile, { label: A.t('pa.weightedAvg'), value: A.fmtNum(o.grades.average), hint: A.t('pa.allSubjectsAsOf', { date: A.fmtDate(o.date) }) }),
            h('p', { className: 'caption muted' }, o.grades.access.note))),

        /* ---- frekwencja ---- */
        h(Section, { id: 'frekwencja', hid: 'h-frek', title: A.t('pa.attTitle') },
          !o ? h('p', { className: 'muted' }, A.t('pa.loadingAtt')) : h(F, null,
            h('div', { className: 'grid-3' }, o.attendanceWeek.days.map(function (d) {
              return h('div', { key: d.date, className: 'card', style: { alignItems: 'center', display: 'flex', flexDirection: 'column', gap: 'var(--space-1)' } },
                h('span', { className: 'caption' }, A.fmtDate(d.date).slice(0, 5)),
                h(E.AttendanceChip, { status: d.status, minutes: d.minutes || undefined }));
            })),
            h('p', { className: 'caption muted' }, A.t('pa.statusLegend', { pct: A.fmtPct(o.attendanceWeek.percent) })))),

        /* ---- usprawiedliwienia ---- */
        h(Section, { id: 'usprawiedliwienia', hid: 'h-uspr', title: A.t('pa.excuses') },
          exc.data ? h(E.Table, {
            caption: A.t('pa.excCaption', { name: kid ? kid.label : '' }),
            columns: [
              { key: 'period', title: A.t('pa.period') },
              { key: 'reason', title: A.t('common.reason'), render: function (r) { return h(F, null, r.reason, r.planned ? h('div', { className: 'caption muted' }, A.t('pa.plannedNote')) : null); } },
              { key: 'status', title: A.t('common.status'), render: function (r) {
                return h('div', { className: 'stack', style: { gap: 'var(--space-1)' } },
                  h(E.Badge, { tone: EXC_TONE[r.status] || 'outline' }, EXC_TONE[r.status] ? A.t('pa.exc.' + r.status) : r.status),
                  r.rejectReason ? h('div', { className: 'caption muted' }, (r.decidedBy || A.t('pa.homeroomTeacher')) + ': ' + r.rejectReason) : null);
              } }],
            rows: exc.data.excuses
          }) : h('p', { className: 'muted' }, A.t('pa.loadingExc')),
          h('div', { className: 'row mt-4' },
            h(E.Button, { variant: 'primary', icon: 'plus', onClick: function () { setExcOpen(true); } }, A.t('pa.newExcuse'))),
          h('p', { className: 'caption muted' }, exc.data ? exc.data.note : '')),

        /* ---- wiadomości i zawiadomienia ---- */
        h(Section, { id: 'wiadomosci', hid: 'h-msg', title: A.t('pa.msgTitle') },
          warn.data && warn.data.warnings.length ? warn.data.warnings.map(function (w) {
            return h('div', { key: w.id, className: 'stack', style: { gap: 'var(--space-2)', marginBottom: 'var(--space-3)' } },
              h(E.MessageItem, {
                from: w.from, role: A.t('pa.formalNotice'), kind: 'staff', subject: w.subject,
                preview: A.t('pa.daysBefore', { n: w.daysBeforeClassification }) + w.body.slice(0, 120),
                time: A.fmtDate(w.at), unread: !w.read,
                receipt: w.acked ? 'read' : w.read ? 'delivered' : 'pending',
                receiptDetail: w.statusLabel
              }),
              w.requiresAck && !w.acked
                ? h(E.Button, { variant: 'secondary', icon: 'check', onClick: function () {
                  A.api.post('/api/parent/warnings/' + w.id + '/ack').then(function (r) { A.toast(r.receipt, 'success'); warn.reload(); over.reload(); }).catch(err);
                } }, A.t('pa.ackReceipt'))
                : h(E.Badge, { tone: 'success', icon: 'check' }, A.t('pa.ackedAt', { at: w.ackAt ? A.fmtDateTime(w.ackAt) : '' })));
          }) : h('p', { className: 'muted' }, A.t('pa.noWarnings')),
          h('div', { className: 'row mt-4' },
            h(E.Button, { icon: 'lock', onClick: function () { setConfOpen(true); } }, A.t('pa.confTitle')),
            h(E.Button, { icon: 'mail', onClick: function () { A.navigate('/wiadomosci'); } }, A.t('pa.openInbox'))),
          h(E.ConfidentialNote, { title: A.t('pa.guardianNoteTitle'), readers: A.t('pa.onlyYou'), author: A.t('role.registrar'), date: A.fmtDate('2026-09-01') },
            A.t('pa.guardianNoteBody'))),

        /* ---- płatności ---- */
        h(Section, { id: 'platnosci', hid: 'h-pay', title: A.t('pa.payments') },
          pay.data ? h(E.Table, {
            caption: A.t('pa.feesCaption'),
            columns: [
              { key: 'title', title: A.t('pa.feeTitle') },
              { key: 'amount', title: A.t('pa.amount'), num: true, render: function (r) { return A.fmtMoney(r.amount); } },
              { key: 'dueDate', title: A.t('pa.due'), render: function (r) { return A.fmtDate(r.dueDate); } },
              { key: 'akcja', title: A.t('pa.payment'), render: function (r) {
                return r.status === 'paid'
                  ? h('div', { className: 'stack', style: { gap: 'var(--space-1)' } },
                    h(E.Badge, { tone: 'success', icon: 'check' }, A.t('pa.paidNo', { no: r.receiptNo })),
                    h(E.Button, { size: 'sm', icon: 'download', onClick: function () { A.openPrint(r.receiptPath); } }, A.t('pa.receipt')))
                  : h(E.Button, { size: 'sm', variant: 'primary', 'aria-label': A.t('pa.payAria', { title: r.title }), onClick: function () { setPayOpen(r); } }, A.t('pa.pay'));
              } }],
            rows: pay.data.payments
          }) : h('p', { className: 'muted' }, A.t('pa.loadingPay')),
          caf.data && caf.data.account ? h('div', { className: 'row mt-4' },
            h(E.Button, { icon: 'clock', onClick: function () {
              A.api.post('/api/parent/lunch/cancel', { studentId: sid })
                .then(function (r) { setLine(r.confirmation); A.toast(r.confirmation, 'success'); caf.reload(); })
                .catch(function (x) { setLine(x.message); A.toast(x.message, 'danger'); });
            } }, A.t('pa.cancelLunch', { time: caf.data.cutoff })),
            h(E.StatTile, { label: A.t('pa.lunchBalance'), value: A.fmtMoney(caf.data.account.balance), hint: caf.data.account.period })) : null,
          h('p', { className: 'caption muted', 'aria-live': 'polite' }, line || (caf.data ? caf.data.note : ''))),

        /* ---- zgody ---- */
        h(Section, { id: 'zgody', hid: 'h-zgody', title: A.t('pa.consents') },
          cons.data && cons.data.trips.length ? cons.data.trips.map(function (t) {
            return h('div', { key: t.tripId, className: 'stack', style: { gap: 'var(--space-2)', marginBottom: 'var(--space-3)' } },
              h('p', { className: 'body-strong', style: { margin: 0 } }, t.name + ' · ' + t.period),
              h('p', { className: 'caption muted', style: { margin: 0 } }, A.t('pa.leader', { name: t.leader }) + tripMeta(t)),
              t.signed
                ? h(E.Badge, { tone: 'success', icon: 'check' }, t.signedLabel)
                : h(E.Button, { variant: 'primary', icon: 'edit', onClick: function () { setConsOpen(t); } }, A.t('pa.signInApp')));
          }) : h('p', { className: 'muted' }, A.t('pa.noConsents')),
          h('p', { className: 'caption muted' }, cons.data ? cons.data.note : '')),

        /* ---- spotkania ---- */
        h(Section, { id: 'spotkania', hid: 'h-spot', title: A.t('pa.meetings') },
          meet.data ? h(F, null,
            h('ul', { style: { margin: '0 0 var(--space-3)', paddingLeft: 'var(--space-5)' } }, meet.data.meetings.map(function (m) {
              return h('li', { key: m.id }, m.kindLabel + ': ' + m.title + ' — ' + A.fmtDate(m.date) + ', ' + m.start + (m.room ? A.t('pa.roomSuffix', { room: m.room }) : '') + (m.note ? '. ' + m.note : ''));
            })),
            h(E.Table, {
              caption: A.t('pa.slotsCaption'),
              columns: [
                { key: 'when', title: A.t('pa.when'), render: function (r) { return A.fmtDate(r.date) + ', ' + r.start; } },
                { key: 'teacher', title: A.t('common.teacher'), render: function (r) { return r.teacher + (r.subjectId ? ' · ' + A.subjectName(r.subjectId, r.subject) : ''); } },
                { key: 'akcja', title: A.t('pa.booking'), render: function (r) {
                  return r.mine ? h(E.Badge, { tone: 'success', icon: 'check' }, A.t('pa.yourBooking'))
                    : r.booked ? h(E.Badge, { tone: 'outline', icon: 'lock' }, A.t('pa.taken'))
                      : h(E.Button, { size: 'sm', 'aria-label': A.t('pa.bookAria', { when: A.fmtDate(r.date) + ', ' + r.start }), onClick: function () {
                        A.api.post('/api/parent/consultation-slots/' + r.id + '/book', { studentId: sid })
                          .then(function (x) { A.toast(x.confirmation, 'success'); meet.reload(); }).catch(err);
                      } }, A.t('pa.book'));
                } }],
              rows: meet.data.slots
            }),
            h('p', { className: 'caption muted' }, meet.data.note)) : h('p', { className: 'muted' }, A.t('pa.loadingMeet'))),

        /* ---- ustawienia ---- */
        h(Section, { id: 'ustawienia', hid: 'h-set', title: A.t('pa.settingsExport') },
          quiet.data ? h(F, null,
            h(E.Switch, {
              label: A.t('pa.quietLabel', {
                from: (quiet.data.quietHours || quiet.data.default || { from: '21:00', to: '06:30' }).from,
                to: (quiet.data.quietHours || quiet.data.default || { from: '21:00', to: '06:30' }).to
              }),
              checked: !!quiet.data.quietHours, states: [A.t('pa.off'), A.t('pa.on')],
              onChange: function (on) {
                var def = quiet.data.default || { from: '21:00', to: '06:30' };
                A.api.patch('/api/parent/quiet-hours', on ? { from: def.from, to: def.to } : { enabled: false })
                  .then(function (r) { A.toast(r.message, 'success'); quiet.reload(); }).catch(err);
              }
            }),
            h('p', { className: 'caption muted', 'aria-live': 'polite' }, quiet.data.note + (quiet.data.deferred ? A.t('pa.deferred', { n: quiet.data.deferred }) : ''))) : null,
          h('div', { className: 'row mt-4' },
            h(E.Button, { icon: 'download', onClick: function () { A.openPrint('/api/parent/export?studentId=' + sid); } }, A.t('pa.export'))),
          h('p', { className: 'caption muted' }, A.t('pa.exportNote'))),

        h('p', { className: 'caption muted' }, A.t('pa.footer')),

        excOpen && o ? h(ExcuseDialog, { studentId: sid, today: o.date, onClose: function () { setExcOpen(false); }, onDone: function () { setExcOpen(false); reloadAll(); } }) : null,
        payOpen ? h(PayDialog, { payment: payOpen, onClose: function () { setPayOpen(null); }, onDone: function (r) { setPayOpen(null); if (r && r.receipt) setLine(r.receipt); pay.reload(); caf.reload(); } }) : null,
        consOpen ? h(ConsentDialog, { trip: consOpen, studentId: sid, onClose: function () { setConsOpen(null); }, onDone: function () { setConsOpen(null); cons.reload(); } }) : null,
        confOpen ? h(CounselorDialog, { recipients: recip.data ? recip.data.recipients : [], onClose: function () { setConfOpen(false); }, onDone: function () { setConfOpen(false); } }) : null);
    }
  });
})();
