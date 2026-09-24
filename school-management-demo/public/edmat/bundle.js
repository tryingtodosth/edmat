/* @ds-bundle: {"format":4,"namespace":"EdMat","components":[{"name":"Button"},{"name":"Kbd"},{"name":"TextField"},{"name":"Select"},{"name":"Checkbox"},{"name":"RadioGroup"},{"name":"Switch"},{"name":"GradeInput"},{"name":"AttendanceChip"},{"name":"AttendanceRoster"},{"name":"GradeCell"},{"name":"GradeGrid"},{"name":"Badge"},{"name":"ProgressBar"},{"name":"StatTile"},{"name":"SyncStatus"},{"name":"Alert"},{"name":"Toast"},{"name":"Dialog"},{"name":"Tabs"},{"name":"AccountSwitcher"},{"name":"Avatar"},{"name":"SkipLink"},{"name":"TopBar"},{"name":"Table"},{"name":"AuditEntry"},{"name":"Calendar"},{"name":"LessonCard"},{"name":"MessageItem"},{"name":"ConfidentialNote"},{"name":"PrintSheet"},{"name":"Icon"}]} */
(function () {
  var React = window.React, h = React.createElement, F = React.Fragment;
  function cx() { var out = []; for (var i = 0; i < arguments.length; i++) if (arguments[i]) out.push(arguments[i]); return out.join(' '); }
  var uid = 0; function useId(given) { var ref = React.useRef(null); if (ref.current === null) ref.current = given || ('ed-' + (++uid)); return ref.current; }


  /* Locale: pl (default) and en. EdMat.setLocale('en') re-renders nothing by itself; the app re-renders after switching. */
  var STR = {
    pl: { on: 'wł.', off: 'wył.', countsAs: 'liczy się jako ', weight: 'waga ', npOut: 'nieprzygotowanie · poza średnią', bzOut: 'brak zadania · poza średnią', hintPoints: 'Punkty; Enter przechodzi do następnego ucznia', hintGrade: 'Cyfra 1–6, opcjonalnie + lub −; np, bz; Enter przechodzi do następnego ucznia', grade: 'Ocena', blockedReason: 'Uczeń ma nieobecność na tej lekcji. Zaznacz „do uzupełnienia”, aby wpisać ocenę mimo to.', makeup: 'Do uzupełnienia w późniejszym terminie',
      att: { ob: 'obecny', nb: 'nieobecny', sp: 'spóźnienie', zw: 'zwolniony', u: 'nieobecność usprawiedliwiona', rs: 'reprezentuje szkołę', w: 'wycieczka', draft: 'wersja robocza', none: 'brak wpisu' }, draftShort: 'rob.',
      noEntries: 'brak wpisów', rosterTitle: 'Frekwencja', draftBadge: 'Wersja robocza', allPresent: 'Wszyscy obecni', markAllPresent: 'Zaznacz wszystkich obecnych', rosterCaption: 'Lista obecności; w każdym wierszu przyciski statusów. Strzałki góra/dół przechodzą między uczniami, lewo/prawo między statusami; na zaznaczonym uczniu klawisze A, N, S, Z, U, R, W ustawiają status', no: 'Nr', student: 'Uczeń', status: 'Status', statusOf: 'Status: ', lateMinutes: 'Minuty spóźnienia', min: 'min',
      cat: { 1: 'sprawdzian', 2: 'kartkówka', 3: 'zadanie domowe', 4: 'aktywność', 5: 'projekt', 6: 'odpowiedź ustna', 7: 'laboratorium', 8: 'inne' }, plus: ' plus', minus: ' minus', retake: 'poprawa: ', retakeTo: ' poprawione na ', np: 'nieprzygotowany', bz: 'brak zadania', noGrade: 'brak oceny', proposedGrade: 'ocena proponowana ', gradeWord: 'ocena ', comment: 'komentarz', locked: 'zablokowana', excluded: 'poza średnią', average: 'Średnia', legend: 'Legenda kategorii', noGradeAbsent: 'brak oceny: nieobecność', npbzOut: 'np / bz poza średnią', deltaUp: 'wzrost ', deltaDown: 'spadek ',
      synced: 'Zsynchronizowano', pending: 'Oczekuje na synchronizację', offline: 'Tryb offline', syncError: 'Synchronizacja nie powiodła się', entry1: 'wpis', entry2: 'wpisy', entry5: 'wpisów', toSend: ' do wysłania', close: 'Zamknij', notifications: 'Powiadomienia', logoutIn: 'Wylogowanie za ', activeAccount: 'Aktywne konto: ', pickProfile: 'Wybierz profil', skip: 'Przejdź do treści', home: 'EdMat, strona główna', mainNav: 'Główna', newNotif: ' nowe', selectedRow: 'Zaznaczony wiersz: ', oldValue: 'wartość pierwotna ', newValue: 'nowa wartość ', reason: 'Powód', dow: ['pon.', 'wt.', 'śr.', 'czw.', 'pt.', 'sob.', 'niedz.'], prevMonth: 'Poprzedni miesiąc', nextMonth: 'Następny miesiąc', today: ', dziś', overLimit: ', przekroczony limit sprawdzianów', testsShort: ' spr.',
      cancelled: 'Odwołana', substitution: 'Zastępstwo', roomChange: 'Zmiana sali', now: 'Trwa', lesson: '. lekcja, ', room: 'sala ', subBy: 'Zastępstwo: ', read: 'Przeczytano', delivered: 'Dostarczono', awaitingAck: 'Oczekuje na potwierdzenie', unread: 'Nieprzeczytana. ', confidentialF: 'Poufna', confidential: 'Poufne', confidentialNote: 'Notatka poufna: ', visibleTo: ' Widoczne dla: ', sealed: 'Treść zaszyfrowana. ', noRights: 'Nie masz uprawnień do odczytu tej notatki.', noExport: 'Nie trafia do eksportów XML ani PDF',
      gdpr: 'Dokument zawiera dane osobowe przetwarzane na podstawie art. 6 ust. 1 lit. c RODO. Po wykorzystaniu należy go zniszczyć lub zabezpieczyć zgodnie z polityką ochrony danych szkoły.', page1: 'Strona 1 z 1', printed: 'Wydruk: ' },
    en: { on: 'on', off: 'off', countsAs: 'counts as ', weight: 'weight ', npOut: 'unprepared · not in average', bzOut: 'missing assignment · not in average', hintPoints: 'Points; Enter moves to the next student', hintGrade: 'Digit 1–6, optional + or −; np, bz; Enter moves to the next student', grade: 'Grade', blockedReason: 'The student is marked absent for this lesson. Tick "to make up" to enter the grade anyway.', makeup: 'To be made up later',
      att: { ob: 'present', nb: 'absent', sp: 'late', zw: 'released', u: 'excused absence', rs: 'representing the school', w: 'school trip', draft: 'draft', none: 'no entry' }, draftShort: 'draft',
      noEntries: 'no entries', rosterTitle: 'Attendance', draftBadge: 'Draft', allPresent: 'All present', markAllPresent: 'Mark all present', rosterCaption: 'Attendance list; each row has status buttons. Up/down arrows move between students, left/right between statuses; on a focused student the keys A, N, S, Z, U, R, W set the status', no: 'No.', student: 'Student', status: 'Status', statusOf: 'Status: ', lateMinutes: 'Minutes late', min: 'min',
      cat: { 1: 'test', 2: 'quiz', 3: 'homework', 4: 'activity', 5: 'project', 6: 'oral answer', 7: 'lab', 8: 'other' }, plus: ' plus', minus: ' minus', retake: 'retake: ', retakeTo: ' improved to ', np: 'unprepared', bz: 'missing assignment', noGrade: 'no grade', proposedGrade: 'proposed grade ', gradeWord: 'grade ', comment: 'comment', locked: 'locked', excluded: 'not in average', average: 'Average', legend: 'Category legend', noGradeAbsent: 'no grade: absent', npbzOut: 'np / bz not in average', deltaUp: 'up ', deltaDown: 'down ',
      synced: 'Synced', pending: 'Waiting to sync', offline: 'Offline mode', syncError: 'Sync failed', entry1: 'entry', entry2: 'entries', entry5: 'entries', toSend: ' to send', close: 'Close', notifications: 'Notifications', logoutIn: 'Logout in ', activeAccount: 'Active account: ', pickProfile: 'Choose a profile', skip: 'Skip to content', home: 'EdMat, home', mainNav: 'Main', newNotif: ' new', selectedRow: 'Selected row: ', oldValue: 'previous value ', newValue: 'new value ', reason: 'Reason', dow: ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'], prevMonth: 'Previous month', nextMonth: 'Next month', today: ', today', overLimit: ', test limit exceeded', testsShort: ' tests',
      cancelled: 'Cancelled', substitution: 'Substitution', roomChange: 'Room change', now: 'In progress', lesson: '. lesson, ', room: 'room ', subBy: 'Substitute: ', read: 'Read', delivered: 'Delivered', awaitingAck: 'Awaiting confirmation', unread: 'Unread. ', confidentialF: 'Confidential', confidential: 'Confidential', confidentialNote: 'Confidential note: ', visibleTo: ' Visible to: ', sealed: 'Content is encrypted. ', noRights: 'You are not authorised to read this note.', noExport: 'Never included in XML or PDF exports',
      gdpr: 'This document contains personal data processed under Art. 6(1)(c) GDPR. After use, destroy it or secure it according to the school\'s data-protection policy.', page1: 'Page 1 of 1', printed: 'Printed: ' }
  };
  var locale = 'pl';
  function T(k) { var d = STR[locale] || STR.pl; return d[k] !== undefined ? d[k] : STR.pl[k]; }
  /* Icons: single-ink 24px stroke paths, the same as assets/Icons. */
  var PATHS = {
    check: 'M5 12.5l4.5 4.5L19 7',
    'check-all': 'M2 12.5l4 4L14 8M9 16.5l1 1L20 8',
    x: 'M6 6l12 12M18 6L6 18',
    plus: 'M12 5v14M5 12h14',
    minus: 'M5 12h14',
    clock: 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zM12 7v5l3 2',
    lock: 'M6 11h12v10H6zM8 11V7a4 4 0 0 1 8 0v4',
    'lock-open': 'M6 11h12v10H6zM8 11V7a4 4 0 0 1 7.5-1.9',
    warning: 'M12 3l10 18H2zM12 10v4M12 17.5v.5',
    info: 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zM12 11v5M12 7.5v.5',
    'alert-circle': 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zM12 8v4M12 16v.5',
    bell: 'M6 16V11a6 6 0 0 1 12 0v5l2 2H4zM10 20a2 2 0 0 0 4 0',
    calendar: 'M4 6h16v14H4zM4 10h16M8 3v4M16 3v4',
    download: 'M12 4v11M7 10l5 5 5-5M4 20h16',
    print: 'M7 8V4h10v4M5 8h14v8h-3v4H8v-4H5zM8 16h8',
    search: 'M10.5 4a6.5 6.5 0 1 0 0 13 6.5 6.5 0 0 0 0-13zM15.5 15.5L20 20',
    keyboard: 'M3 7h18v10H3zM6 10h1M9 10h1M12 10h1M15 10h1M18 10h1M6 13h1M9 13h1M12 13h1M15 13h1M18 13h1M8 16h8',
    'eye-off': 'M3 3l18 18M10 6.5A10 10 0 0 1 22 12a11 11 0 0 1-3 3.5M6 8a11 11 0 0 0-4 4 10 10 0 0 0 12 5M9.5 9.5a3.5 3.5 0 0 0 5 5',
    'cloud-off': 'M3 3l18 18M8 18h9a4 4 0 0 0 1.5-7.7A6 6 0 0 0 9 8M5.5 9.5A4.5 4.5 0 0 0 8 18',
    cloud: 'M8 18h9a4 4 0 0 0 .5-8A6 6 0 0 0 6 10.5 4 4 0 0 0 8 18z',
    refresh: 'M20 12a8 8 0 1 1-2.3-5.7M20 4v5h-5',
    user: 'M12 4a4 4 0 1 1 0 8 4 4 0 0 1 0-8zM4 21a8 8 0 0 1 16 0',
    users: 'M9 5a3.5 3.5 0 1 1 0 7 3.5 3.5 0 0 1 0-7zM2 20a7 7 0 0 1 14 0M16 5.5a3.5 3.5 0 0 1 0 6.5M22 20a7 7 0 0 0-5-6.7',
    'chevron-down': 'M6 9l6 6 6-6',
    'chevron-up': 'M6 15l6-6 6 6',
    'chevron-left': 'M15 6l-6 6 6 6',
    'chevron-right': 'M9 6l6 6-6 6',
    'arrow-up': 'M12 19V5M6 11l6-6 6 6',
    'arrow-down': 'M12 5v14M6 13l6 6 6-6',
    edit: 'M4 20h4l11-11-4-4L4 16zM13 7l4 4',
    trash: 'M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13M10 11v6M14 11v6',
    file: 'M6 3h8l4 4v14H6zM14 3v4h4M9 13h6M9 17h6',
    shield: 'M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6z',
    'log-out': 'M10 4H4v16h6M14 8l4 4-4 4M8 12h10',
    home: 'M3 11l9-8 9 8v10h-6v-6H9v6H3z',
    barcode: 'M3 5v14M7 5v14M10 5v14M13 5v14M17 5v14M21 5v14',
    'map-pin': 'M12 21s-7-6-7-11a7 7 0 0 1 14 0c0 5-7 11-7 11zM12 7a3 3 0 1 1 0 6 3 3 0 0 1 0-6'
  };
  function Icon(p) {
    var d = PATHS[p.name] || PATHS.info;
    return h('svg', { className: cx('ed-icon', p.className), viewBox: '0 0 24 24', width: p.size, height: p.size, style: p.size ? { width: p.size, height: p.size } : undefined, 'aria-hidden': p.label ? undefined : 'true', role: p.label ? 'img' : undefined, 'aria-label': p.label, focusable: 'false' }, h('path', { d: d }));
  }

  /* Button */
  function Button(p) {
    var variant = p.variant || 'secondary', size = p.size, icon = p.icon, loading = p.loading, children = p.children, iconOnly = p.iconOnly, href = p.href, label = p.label;
    var rest = {}; for (var k in p) if (!/^(variant|size|icon|loading|children|iconOnly|href|label|className|disabled)$/.test(k)) rest[k] = p[k];
    var cls = cx('ed-btn', 'ed-btn-' + variant, size === 'sm' && 'ed-btn-sm', iconOnly && 'ed-btn-icon', p.className);
    var content = [loading ? h('span', { key: 's', className: 'ed-spin', 'aria-hidden': 'true' }) : (icon ? h(Icon, { key: 'i', name: icon }) : null), iconOnly ? h('span', { key: 'l', className: 'ed-sr' }, label || children) : children];
    if (href) return h('a', Object.assign({ href: href, className: cls, 'aria-label': iconOnly ? label : undefined }, rest), content);
    return h('button', Object.assign({ type: p.type || 'button', className: cls, 'aria-busy': loading ? 'true' : undefined, disabled: p.disabled || loading, 'aria-label': iconOnly ? label : undefined }, rest), content);
  }

  /* Kbd */
  function Kbd(p) {
    var keys = p.keys || (typeof p.children === 'string' ? [p.children] : []);
    return h('span', { className: 'ed-kbd-seq', 'aria-label': (p.label || keys.join(' plus ')) }, keys.map(function (k, i) { return h(F, { key: i }, i > 0 && h('span', { 'aria-hidden': 'true' }, p.sep || '+'), h('kbd', { className: 'ed-kbd', 'aria-hidden': 'true' }, k)); }));
  }

  /* Field wrapper shared by inputs */
  function Field(p) {
    return h('div', { className: cx('ed-field', p.className), style: p.width ? { width: p.width } : undefined },
      p.label ? h('label', { className: 'ed-label', htmlFor: p.id }, p.label, p.required && h('span', { className: 'ed-req', 'aria-hidden': 'true' }, '*')) : null,
      p.children,
      p.hint && !p.error && h('div', { className: 'ed-hint', id: p.id + '-hint' }, p.hint),
      p.error && h('div', { className: 'ed-error', id: p.id + '-err', role: 'alert' }, h(Icon, { name: 'alert-circle' }), h('span', null, p.error)));
  }
  function describedBy(id, hint, error) { var a = []; if (error) a.push(id + '-err'); else if (hint) a.push(id + '-hint'); return a.length ? a.join(' ') : undefined; }

  function TextField(p) {
    var id = useId(p.id);
    var rest = {}; for (var k in p) if (!/^(label|hint|error|required|mono|affix|id|width|className|multiline)$/.test(k)) rest[k] = p[k];
    var common = { id: id, className: cx('ed-input', p.mono && 'ed-input-mono'), 'aria-invalid': p.error ? 'true' : undefined, 'aria-describedby': describedBy(id, p.hint, p.error), 'aria-required': p.required ? 'true' : undefined };
    var ml = p.multiline || (p.rows > 1 ? p.rows : false); delete rest.rows;
    var input = ml ? h('textarea', Object.assign(common, { rows: typeof ml === 'number' ? ml : 3 }, rest)) : h('input', Object.assign(common, { type: p.type || 'text' }, rest));
    return h(Field, { id: id, label: p.label, hint: p.hint, error: p.error, required: p.required, width: p.width, className: p.className }, p.affix ? h('div', { className: 'ed-input-wrap' }, input, h('span', { className: 'ed-affix', 'aria-hidden': 'true' }, p.affix)) : input);
  }

  function Select(p) {
    var id = useId(p.id);
    var rest = {}; for (var k in p) if (!/^(label|hint|error|required|options|id|width|className|placeholder)$/.test(k)) rest[k] = p[k];
    return h(Field, { id: id, label: p.label, hint: p.hint, error: p.error, required: p.required, width: p.width, className: p.className },
      h('select', Object.assign({ id: id, className: 'ed-select', 'aria-invalid': p.error ? 'true' : undefined, 'aria-describedby': describedBy(id, p.hint, p.error) }, rest),
        p.placeholder && h('option', { value: '' }, p.placeholder),
        (p.options || []).map(function (o) { return h('option', { key: o.value, value: o.value, disabled: o.disabled }, o.label); })));
  }

  function Checkbox(p) {
    var id = useId(p.id);
    var rest = {}; for (var k in p) if (!/^(label|hint|id|indeterminate|className)$/.test(k)) rest[k] = p[k];
    var ref = React.useRef(null);
    React.useEffect(function () { if (ref.current) ref.current.indeterminate = !!p.indeterminate; }, [p.indeterminate]);
    return h('label', { className: cx('ed-check', p.className), htmlFor: id },
      h('input', Object.assign({ ref: ref, id: id, type: 'checkbox', 'aria-describedby': p.hint ? id + '-hint' : undefined }, rest)),
      p.label ? h('span', { className: 'ed-check-text' }, h('span', null, p.label), p.hint && h('span', { className: 'ed-hint', id: id + '-hint' }, p.hint)) : null);
  }

  function RadioGroup(p) {
    var name = useId(p.name);
    return h('fieldset', { className: cx('ed-radiogroup', p.row && 'ed-radiogroup-row', p.className) },
      h('legend', null, p.legend),
      (p.options || []).map(function (o) {
        var id = name + '-' + o.value;
        return h('label', { key: o.value, className: 'ed-check', htmlFor: id },
          h('input', { id: id, type: 'radio', name: name, value: o.value, checked: p.value === o.value, disabled: o.disabled, onChange: function () { p.onChange && p.onChange(o.value); } }),
          h('span', { className: 'ed-check-text' }, h('span', null, o.label), o.hint && h('span', { className: 'ed-hint' }, o.hint)));
      }));
  }

  function Switch(p) {
    var id = useId(p.id);
    var on = !!p.checked;
    var btn = h('button', { type: 'button', role: 'switch', id: id, 'aria-checked': on ? 'true' : 'false', 'aria-describedby': p.hint ? id + '-hint' : undefined, className: cx('ed-switch', p.className), disabled: p.disabled, onClick: function () { p.onChange && p.onChange(!on); }, style: { background: 'none', border: 0, padding: 0, font: 'inherit', color: 'inherit', borderRadius: 'var(--radius-full)' } },
      h('span', { className: 'ed-switch-track', 'aria-hidden': 'true' }),
      h('span', null, p.label),
      p.states && h('span', { className: 'ed-switch-state', 'aria-hidden': 'true' }, on ? (p.states[1] || T('on')) : (p.states[0] || T('off'))));
    if (!p.hint) return btn;
    return h('div', { className: 'ed-field' }, btn, h('div', { className: 'ed-hint', id: id + '-hint' }, p.hint));
  }

  /* GradeInput: digits 1–6, optional + / -, np, bz; Enter commits. */
  function parseGrade(s) {
    s = (s || '').trim().toLowerCase().replace(/−/g, '-');
    if (s === 'np' || s === 'bz') return { special: s, text: s };
    var m = /^([1-6])([+-])?$/.exec(s); if (!m) return null;
    var v = +m[1], mod = m[2] || '';
    var num = v + (mod === '+' ? 0.5 : mod === '-' ? -0.25 : 0);
    return { value: num, text: m[1] + mod };
  }
  function GradeInput(p) {
    var id = useId(p.id);
    var st = React.useState(p.value || ''), text = st[0], setText = st[1];
    var parsed = parseGrade(text);
    var blocked = p.blocked && !p.makeup;
    var preview = null;
    if (p.pointsMax) { var pts = parseFloat(text); if (!isNaN(pts)) { var pct = Math.round(pts / p.pointsMax * 100); var g = pct >= 90 ? 5 : pct >= 75 ? 4 : pct >= 50 ? 3 : pct >= 30 ? 2 : 1; preview = pts + '/' + p.pointsMax + ' · ' + pct + ' % → ' + g; } }
    else if (parsed && parsed.value != null) preview = T('countsAs') + String(parsed.value).replace('.', ',') + (p.weight ? ' · ' + T('weight') + p.weight : '');
    else if (parsed && parsed.special) preview = parsed.special === 'np' ? T('npOut') : T('bzOut');
    var hint = p.hint || (p.pointsMax ? T('hintPoints') : T('hintGrade'));
    return h('div', { className: cx('ed-gradeinput', p.className) },
      h('label', { className: 'ed-label', htmlFor: id }, p.label || T('grade')),
      h('div', { className: 'ed-gradeinput-box' },
        h('input', { id: id, className: 'ed-input', inputMode: 'decimal', autoComplete: 'off', value: text, disabled: blocked, 'aria-describedby': id + '-hint' + (blocked ? ' ' + id + '-block' : ''), 'aria-invalid': text && !parsed && !p.pointsMax ? 'true' : undefined,
          onChange: function (e) { var v = e.target.value.replace(/−/g, '-'); setText(v); p.onChange && p.onChange(v); },
          onKeyDown: function (e) { if (e.key === 'Enter') { e.preventDefault(); if (parsed || p.pointsMax) { p.onCommit && p.onCommit(parsed || text); if (p.clearOnCommit !== false) setText(''); } } if (e.key === 'Escape') { setText(p.value || ''); p.onCancel && p.onCancel(); } } }),
        preview && h('span', { className: 'ed-gradeinput-preview', 'aria-live': 'polite' }, preview)),
      h('div', { className: 'ed-hint', id: id + '-hint' }, hint),
      p.blocked && h('div', { className: 'ed-gradeinput-block', id: id + '-block', role: blocked ? 'alert' : undefined }, h(Icon, { name: 'alert-circle' }), h('span', null, p.blockedReason || T('blockedReason'))),
      p.blocked && h(Checkbox, { label: T('makeup'), checked: !!p.makeup, onChange: function (e) { p.onMakeup && p.onMakeup(e.target.checked); } }));
  }

  /* Attendance */
  var ATT = new Proxy({}, { get: function (_, k) { return T('att')[k]; }, ownKeys: function () { return Object.keys(STR.pl.att); }, getOwnPropertyDescriptor: function () { return { enumerable: true, configurable: true }; } });
  function AttendanceChip(p) {
    var s = p.status || 'none';
    var word = ATT[s] || s;
    var minutes = s === 'sp' && p.minutes != null ? ' ' + p.minutes + ' min' : '';
    var name = word + minutes;
    var body = [h('span', { key: 'c', className: 'ed-att-code', 'aria-hidden': 'true' }, s === 'draft' ? T('draftShort') : s === 'none' ? '—' : s + minutes), p.word && h('span', { key: 'w', className: 'ed-att-word', 'aria-hidden': 'true' }, word), h('span', { key: 's', className: 'ed-sr' }, name)];
    var cls = cx('ed-att', 'ed-att-' + s, p.className);
    if (p.onClick || p.as === 'button') return h('button', { type: 'button', className: cls, 'aria-pressed': p.pressed != null ? String(p.pressed) : undefined, tabIndex: p.tabIndex, onClick: p.onClick, title: name }, body);
    return h('span', { className: cls, title: name }, body);
  }
  var ORDER = ['ob', 'nb', 'sp', 'zw', 'u', 'rs', 'w'];
  function AttendanceRoster(p) {
    var tid = useId(p.id) + '-title';
    var st = React.useState(p.students || []), students = st[0], setStudents = st[1];
    var srcRef = React.useRef(p.students);
    React.useEffect(function () { if (srcRef.current !== p.students) { srcRef.current = p.students; setStudents(p.students || []); } }, [p.students]);
    var counts = {}; students.forEach(function (s) { counts[s.status || 'none'] = (counts[s.status || 'none'] || 0) + 1; });
    function set(i, status, minutes) { var next = students.map(function (s, j) { return j === i ? Object.assign({}, s, { status: status, minutes: minutes }) : s; }); setStudents(next); p.onChange && p.onChange(next); }
    function allPresent() { var next = students.map(function (s) { return Object.assign({}, s, { status: 'ob', minutes: undefined }); }); setStudents(next); p.onChange && p.onChange(next); }
    var summary = ORDER.filter(function (k) { return counts[k]; }).map(function (k) { return k + ' ' + counts[k]; }).join(' · ') || T('noEntries');
    return h('section', { className: cx('ed-roster', p.className), 'aria-labelledby': tid, onKeyDown: function (e) { if ((e.key === 'a' || e.key === 'A') && !e.ctrlKey && !e.altKey && !e.metaKey && e.target.tagName !== 'INPUT' && !e.target.closest('tbody')) { e.preventDefault(); allPresent(); } } },
      h('div', { className: 'ed-roster-head' },
        h('h3', { id: tid }, p.title || T('rosterTitle'), p.lesson && h('span', { className: 'ed-roster-count' }, ' · ', p.lesson)),
        p.draft && h(Badge, { tone: 'accent', icon: 'edit' }, T('draftBadge')),
        h('span', { className: 'ed-roster-count', 'aria-live': 'polite' }, summary),
        h(Button, { size: 'sm', icon: 'check-all', onClick: allPresent, accessKey: 'a' }, T('markAllPresent'))),
      h('table', null,
        h('caption', { className: 'ed-sr' }, T('rosterCaption')),
        h('thead', null, h('tr', null, h('th', { scope: 'col', className: 'ed-sr' }, T('no')), h('th', { scope: 'col', className: 'ed-sr' }, T('student')), h('th', { scope: 'col', className: 'ed-sr' }, T('status')))),
        h('tbody', { onKeyDown: function (e) {
          var row = e.target.closest('tr'); if (!row) return; var rows = Array.prototype.slice.call(e.currentTarget.children); var i = rows.indexOf(row); if (i < 0) return;
          if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { var n = i + (e.key === 'ArrowDown' ? 1 : -1); if (n < 0 || n >= rows.length) return; e.preventDefault(); var chips = row.querySelectorAll('.ed-att'), ci = Array.prototype.indexOf.call(chips, e.target); var t = rows[n].querySelectorAll('.ed-att')[ci < 0 ? 0 : ci]; if (t) t.focus(); return; }
          /* The row is one composite widget (roving tabindex), so left/right walk the statuses. */
          if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') { var row2 = row.querySelectorAll('.ed-att'), at = Array.prototype.indexOf.call(row2, e.target); if (at < 0) return; var to = at + (e.key === 'ArrowRight' ? 1 : -1); if (to < 0 || to >= row2.length) return; e.preventDefault(); row2[to].focus(); return; }
          if (e.ctrlKey || e.altKey || e.metaKey || e.target.tagName === 'INPUT') return;
          var map = { a: 'ob', n: 'nb', s: 'sp', z: 'zw', u: 'u', r: 'rs', w: 'w' }, k = map[e.key.toLowerCase()]; if (!k) return; e.preventDefault(); set(i, k, k === 'sp' ? (students[i].minutes || 5) : undefined);
          if (k === 'sp') setTimeout(function () { var m = rows[i].querySelector('.ed-late-min input'); if (m) m.focus(); }, 0);
        } }, students.map(function (s, i) {
          return h('tr', { key: s.no, className: cx(s.status === 'nb' && 'ed-nb') },
            h('td', { className: 'ed-no' }, s.no + '.'),
            h('th', { scope: 'row' }, s.name),
            h('td', null,
              h('div', { className: 'ed-att-group', role: 'group', 'aria-label': T('statusOf') + s.name },
                /* One tab stop per pupil — the status that is set (or 'ob' before anything is) — instead
                   of seven, which put 91 stops between the top of a 13-pupil card and "Zapisz". */
                ORDER.map(function (k) { return h(AttendanceChip, { key: k, status: k, pressed: s.status === k, tabIndex: k === (ORDER.indexOf(s.status) >= 0 ? s.status : 'ob') ? 0 : -1, onClick: function () { set(i, k, k === 'sp' ? (s.minutes || 5) : undefined); } }); })),
              s.status === 'sp' && h('span', { className: 'ed-late-min' }, h('label', { className: 'ed-sr', htmlFor: tid + '-late-' + s.no }, T('lateMinutes')), h('input', { id: tid + '-late-' + s.no, className: 'ed-input', type: 'number', min: 1, max: 44, value: s.minutes || '', inputMode: 'numeric', onChange: function (e) { set(i, 'sp', +e.target.value || undefined); } }), h('span', { className: 'ed-hint' }, T('min')))));
        }))));
  }

  /* Grades */
  var CATN = new Proxy({}, { get: function (_, k) { return T('cat')[k]; } });
  function speak(v) { return String(v).replace('+', T('plus')).replace('-', T('minus')).replace('−', T('minus')); }
  function GradeCell(p) {
    var v = p.value, special = p.special || (v === 'np' || v === 'bz' ? v : null);
    var fail = !special && /^1/.test(String(v || ''));
    var catName = p.categoryName || CATN[p.category];
    var parts = [];
    if (p.student) parts.push(p.student);
    if (catName) parts.push(catName);
    if (p.weight) parts.push(T('weight') + p.weight);
    if (p.retake) parts.push(T('retake') + speak(p.retake.from) + T('retakeTo') + speak(p.retake.to));
    else if (special) parts.push(special === 'np' ? T('np') : T('bz'));
    else if (v == null || v === '') parts.push(T('noGrade'));
    else parts.push((p.proposed ? T('proposedGrade') : T('gradeWord')) + speak(v));
    if (p.comment) parts.push(T('comment'));
    if (p.locked) parts.push(T('locked'));
    if (p.date) parts.push(p.date);
    var label = parts.join(', ');
    var content = p.retake ? [h('span', { key: 'o', className: 'ed-old' }, p.retake.from), h('span', { key: 'a', className: 'ed-arrow' }, '→'), h('span', { key: 'n' }, p.retake.to)] : (special ? special : (v == null || v === '' ? '·' : v));
    var cls = cx('ed-grade', p.category && 'ed-cat-' + p.category, fail && 'ed-grade-fail', special && 'ed-grade-special', p.proposed && 'ed-grade-proposed', (v == null || v === '') && !special && !p.retake && 'ed-grade-empty', p.retake && 'ed-grade-retake', p.comment && 'ed-grade-comment', p.locked && 'ed-grade-lock', p.className);
    var cell = h(p.onClick && !p.locked ? 'button' : 'span', { type: p.onClick && !p.locked ? 'button' : undefined, className: cls, 'aria-label': label, title: label, 'aria-readonly': p.locked ? 'true' : undefined, tabIndex: p.locked ? 0 : undefined, onClick: p.locked ? undefined : p.onClick }, content, p.locked && h(Icon, { name: 'lock' }));
    if (p.weight && p.showWeight) return h('span', { className: 'ed-grade-wrap' }, h('span', { className: 'ed-grade-w', 'aria-hidden': 'true' }, 'w' + p.weight), cell);
    return cell;
  }
  function avg(grades, columns) {
    var num = 0, den = 0;
    columns.forEach(function (c) { var g = grades[c.id]; if (!g) return; var val = g.retake ? parseGrade(g.retake.to) : parseGrade(String(g.value || '')); if (!val || val.value == null || c.excluded) return; var w = c.weight || 1; num += val.value * w; den += w; });
    return den ? (num / den).toFixed(2).replace('.', ',') : '—';
  }
  function GradeGrid(p) {
    var cols = p.columns || [], rows = p.students || [];
    return h('div', { className: cx('ed-grid-scroll', p.className), role: 'region', 'aria-label': p.caption, tabIndex: 0 },
      h('table', { className: 'ed-grid' },
        h('caption', null, p.caption),
        h('thead', null, h('tr', null,
          h('th', { scope: 'col', className: 'ed-grid-corner' }, T('student')),
          cols.map(function (c) { return h('th', { key: c.id, scope: 'col', 'aria-label': [(c.categoryName || CATN[c.category] || c.title), c.weight ? T('weight') + c.weight : null, c.date || null, c.excluded ? T('excluded') : null].filter(Boolean).join(', ') }, c.title, c.weight && h('span', { className: 'ed-grid-w', 'aria-hidden': 'true' }, 'w' + c.weight), c.category && h('span', { className: 'ed-grid-cat', 'aria-hidden': 'true', style: { background: 'var(--cat-' + c.category + ')', border: '1px solid var(--line-strong)' } })); }),
          p.showAverage !== false && h('th', { scope: 'col', className: 'ed-grid-avg' }, T('average')))),
        h('tbody', null, rows.map(function (s) {
          var absent = s.absent || [];
          return h('tr', { key: s.no, className: cx(absent.length && 'ed-nb') },
            h('th', { scope: 'row' }, h('span', { className: 'ed-no' }, s.no + '.'), s.name),
            cols.map(function (c) {
              var g = (s.grades || {})[c.id];
              if (!g && absent.indexOf(c.id) >= 0) return h('td', { key: c.id, className: 'ed-grid-blocked' }, p.onCell ? h('button', { type: 'button', className: 'ed-grid-blockedbtn', 'aria-label': s.name + ', ' + (c.categoryName || CATN[c.category] || c.title) + ', ' + ATT[s.absentStatus || 'nb'] + ', ' + T('noGrade'), onClick: function () { p.onCell(s, c); } }, h(AttendanceChip, { status: s.absentStatus || 'nb' })) : h(AttendanceChip, { status: s.absentStatus || 'nb' }));
              return h('td', { key: c.id }, h(GradeCell, Object.assign({ category: c.category, categoryName: c.categoryName, weight: c.weight, student: s.name, date: c.date, onClick: p.onCell ? function () { p.onCell(s, c); } : undefined }, g || {})));
            }),
            p.showAverage !== false && h('td', { className: 'ed-grid-avg' }, avg(s.grades || {}, cols)));
        }))),
      p.legend !== false && h('div', { className: 'ed-legend', 'aria-label': T('legend') },
        cols.reduce(function (acc, c) { if (c.category && !acc.some(function (a) { return a.category === c.category; })) acc.push(c); return acc; }, []).map(function (c) { return h('span', { key: c.category }, h('i', { style: { background: 'var(--cat-' + c.category + ')' } }), (c.categoryName || CATN[c.category]) + (c.weight ? ' · ' + T('weight') + c.weight : '')); }),
        h('span', null, h(AttendanceChip, { status: 'nb' }), T('noGradeAbsent')), h('span', null, T('npbzOut'))));
  }

  /* Status */
  function Badge(p) { return h('span', { className: cx('ed-badge', p.tone && 'ed-badge-' + p.tone, p.className) }, p.icon && h(Icon, { name: p.icon }), p.children); }
  function ProgressBar(p) {
    var max = p.max || 100, val = Math.max(0, Math.min(p.value || 0, max)), pct = Math.round(val / max * 100);
    var id = useId(p.id);
    return h('div', { className: cx('ed-progress', p.tone === 'warning' && 'ed-progress-warn', p.tone === 'danger' && 'ed-progress-danger', p.className) },
      h('div', { className: 'ed-progress-head' }, h('b', { id: id }, p.label), h('span', null, p.valueText || (pct + ' %'))),
      h('div', { className: cx('ed-progress-track', p.mark != null && 'ed-progress-mark'), role: 'progressbar', 'aria-labelledby': id, 'aria-valuemin': 0, 'aria-valuemax': max, 'aria-valuenow': val, 'aria-valuetext': p.valueText || (pct + ' %'), style: p.mark != null ? { '--ed-mark': Math.round(p.mark / max * 100) + '%' } : undefined },
        h('div', { className: 'ed-progress-fill', style: { width: pct + '%' } })),
      p.hint && h('div', { className: 'ed-hint' }, p.hint));
  }
  function StatTile(p) {
    var d = p.delta;
    return h('div', { className: cx('ed-stat', p.alert && 'ed-stat-alert', p.className) },
      h('span', { className: 'ed-stat-label' }, p.label),
      h('span', { className: 'ed-stat-value' }, p.value),
      d && h('span', { className: cx('ed-stat-delta', 'ed-stat-' + (d.dir || 'flat')) }, d.dir === 'up' && h(Icon, { name: 'arrow-up', size: 14 }), d.dir === 'down' && h(Icon, { name: 'arrow-down', size: 14 }), h('span', { className: 'ed-sr' }, d.dir === 'up' ? T('deltaUp') : d.dir === 'down' ? T('deltaDown') : ''), d.text),
      p.hint && h('span', { className: 'ed-hint' }, p.hint));
  }
  var SYNC = { synced: ['cloud', 'synced'], pending: ['refresh', 'pending'], offline: ['cloud-off', 'offline'], error: ['warning', 'syncError'] };
  function SyncStatus(p) {
    var s = SYNC[p.state] || SYNC.synced;
    return h('div', { className: cx('ed-sync', 'ed-sync-' + (p.state || 'synced'), p.className), role: 'status', 'aria-live': 'polite' },
      h(Icon, { name: s[0] }), h('b', null, T(s[1])), p.detail && h('span', null, '· ', p.detail),
      p.pending != null && h('span', { className: 'ed-sync-count' }, p.pending + ' ' + (p.pending === 1 ? T('entry1') : (p.pending % 10 >= 2 && p.pending % 10 <= 4 && (p.pending % 100 < 12 || p.pending % 100 > 14)) ? T('entry2') : T('entry5')) + T('toSend')),
      p.action && h(Button, { size: 'sm', onClick: p.onAction, icon: 'refresh' }, p.action));
  }

  /* Feedback */
  var ALERT_ICON = { info: 'info', success: 'check', warning: 'warning', danger: 'alert-circle', crisis: 'bell' };
  function Alert(p) {
    var tone = p.tone || 'info';
    return h('div', { className: cx('ed-alert', 'ed-alert-' + tone, p.className), role: tone === 'danger' || tone === 'crisis' ? 'alert' : 'status' },
      h(Icon, { name: ALERT_ICON[tone] }),
      h('div', { className: 'ed-alert-body' }, p.title && h('p', { className: 'ed-alert-title' }, p.title), typeof p.children === 'string' ? h('p', null, p.children) : p.children, p.actions && h('div', { className: 'ed-alert-actions' }, p.actions)),
      p.onClose && h(Button, { size: 'sm', variant: 'quiet', iconOnly: true, icon: 'x', label: T('close'), onClick: p.onClose, style: { color: 'inherit' } }));
  }
  function Toast(p) {
    var tone = p.tone || 'neutral';
    return h('div', { className: cx('ed-toast', 'ed-toast-' + tone, p.static && 'ed-toast-static', p.className), role: 'status' },
      tone === 'success' && h(Icon, { name: 'check' }), tone === 'danger' && h(Icon, { name: 'alert-circle' }),
      h('div', { className: 'ed-toast-body' }, p.title && h('b', null, p.title, ' '), p.children),
      p.action && h(Button, { variant: 'quiet', size: 'sm', onClick: p.onAction }, p.action),
      p.onClose && h(Button, { variant: 'quiet', size: 'sm', iconOnly: true, icon: 'x', label: T('close'), onClick: p.onClose }));
  }
  function ToastRegion(p) { return h('div', { className: 'ed-toast-region', 'aria-live': 'polite', 'aria-label': T('notifications') }, p.children); }
  var FOCUSABLE = 'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';
  function Dialog(p) {
    var id = useId(p.id);
    var ref = React.useRef(null);
    React.useEffect(function () {
      var prev = document.activeElement, el = ref.current;
      if (el && !p.static) {
        var f = (p.initialFocus && el.querySelector(p.initialFocus)) || el.querySelector('[data-autofocus]') || el.querySelector('.ed-dialog-actions .ed-btn-primary') || el.querySelector(FOCUSABLE);
        if (f) f.focus();
      }
      return function () { if (!p.static && prev && prev.focus) prev.focus(); };
    }, []);
    function onKeyDown(e) {
      if (e.key === 'Escape') { if (!p.blocking && !p.timeout) { e.stopPropagation(); p.onClose && p.onClose(); } return; }
      if (e.key === 'Tab' && ref.current) {
        var f = ref.current.querySelectorAll(FOCUSABLE); if (!f.length) return;
        var first = f[0], last = f[f.length - 1];
        if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
        else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
      }
    }
    var role = p.blocking || p.timeout ? 'alertdialog' : 'dialog';
    return h('div', { className: cx('ed-scrim', p.static && 'ed-scrim-static', (p.blocking || p.timeout) && 'ed-scrim-blocking'), onKeyDown: onKeyDown },
      h('div', { ref: ref, className: cx('ed-dialog', p.blocking && 'ed-dialog-blocking', p.timeout && 'ed-dialog-timeout', p.className), role: role, 'aria-modal': 'true', 'aria-labelledby': id + '-t', 'aria-describedby': id + '-d' },
        h('h2', { id: id + '-t' }, p.title),
        h('div', { className: 'ed-dialog-body', id: id + '-d' }, p.timeout && h('div', { className: 'ed-dialog-timer', 'aria-live': 'polite' }, T('logoutIn'), p.timeout), typeof p.children === 'string' ? h('p', null, p.children) : p.children),
        p.actions && h('div', { className: 'ed-dialog-actions' }, p.actions)));
  }

  /* Navigation */
  function Tabs(p) {
    var tabs = p.tabs || [], value = p.value != null ? p.value : (tabs[0] && tabs[0].id);
    var base = useId(p.id);
    return h('div', { className: cx('ed-tabs', p.className) },
      h('div', { role: 'tablist', className: 'ed-tablist', 'aria-label': p.label, onKeyDown: function (e) { var i = tabs.findIndex(function (t) { return t.id === value; }); var n = e.key === 'ArrowRight' ? i + 1 : e.key === 'ArrowLeft' ? i - 1 : e.key === 'Home' ? 0 : e.key === 'End' ? tabs.length - 1 : -1; if (n < 0 || n >= tabs.length) return; e.preventDefault(); p.onChange && p.onChange(tabs[n].id); var el = e.currentTarget.children[n]; if (el) el.focus(); } },
        tabs.map(function (t) { var sel = t.id === value; return h('button', { key: t.id, role: 'tab', type: 'button', id: base + '-' + t.id, className: 'ed-tab', 'aria-selected': sel ? 'true' : 'false', 'aria-controls': base + '-p-' + t.id, tabIndex: sel ? 0 : -1, onClick: function () { p.onChange && p.onChange(t.id); } }, t.label, t.count != null && h(Badge, { tone: sel ? 'brand' : undefined }, t.count)); })),
      p.children != null && h('div', { role: 'tabpanel', id: base + '-p-' + value, 'aria-labelledby': base + '-' + value, className: 'ed-tabpanel', tabIndex: 0 }, typeof p.children === 'function' ? p.children(value) : p.children));
  }
  function initials(name) { return (name || '').split(/\s+/).filter(function (s) { return /^\p{L}/u.test(s) && !/^(mgr|dr|hab|prof|ks|inż|p\.o)\.?$/i.test(s); }).slice(0, 2).map(function (s) { return s[0]; }).join('').toUpperCase(); }
  function Avatar(p) { return h('span', { className: cx('ed-avatar', p.size && 'ed-avatar-' + p.size, p.kind && 'ed-avatar-' + p.kind, p.className), role: 'img', 'aria-label': p.name }, h('span', { 'aria-hidden': 'true' }, initials(p.name))); }
  function AccountSwitcher(p) {
    var st = React.useState(!!p.open), open = st[0], setOpen = st[1];
    var accounts = p.accounts || [], cur = accounts.find(function (a) { return a.id === p.current; }) || accounts[0];
    var id = useId(p.id);
    return h('div', { className: cx('ed-switcher', p.className) },
      h('button', { type: 'button', className: 'ed-switcher-btn', 'aria-haspopup': 'listbox', 'aria-expanded': (open || p.static) ? 'true' : 'false', 'aria-controls': id, onClick: function () { setOpen(!open); } },
        cur && h(Avatar, { name: cur.name, kind: cur.kind, size: 'sm' }), h('span', null, h('span', { className: 'ed-sr' }, T('activeAccount')), cur && cur.name), h(Icon, { name: open ? 'chevron-up' : 'chevron-down' })),
      (open || p.static) && h('ul', { id: id, role: 'listbox', 'aria-label': T('pickProfile'), className: cx('ed-switcher-menu', p.static && 'ed-switcher-menu-static') },
        accounts.map(function (a, i) { var isCur = cur && a.id === cur.id; return h('li', { key: a.id, role: 'none' }, i > 0 && accounts[i - 1].kind !== a.kind && h('div', { className: 'ed-switcher-sep', role: 'separator' }), h('button', { type: 'button', role: 'option', 'aria-selected': isCur ? 'true' : 'false', 'aria-current': isCur ? 'true' : undefined, className: 'ed-switcher-item', onClick: function () { setOpen(false); p.onSelect && p.onSelect(a.id); } }, h(Avatar, { name: a.name, kind: a.kind }), h('span', null, a.name, a.meta && h('span', { className: 'ed-meta' }, a.meta)), isCur && h(Icon, { name: 'check', className: 'ed-check-mark' }))); })));
  }
  function SkipLink(p) { return h('a', { href: p.href || '#main', className: cx('ed-skip', p.static && 'ed-skip-static', p.className) }, p.children || T('skip')); }
  function TopBar(p) {
    return h('header', { className: cx('ed-topbar', p.static && 'ed-topbar-static', p.className) },
      h(SkipLink, { static: false }),
      h('a', { href: p.homeHref || '#', className: 'ed-wordmark', 'aria-label': T('home') }, h('i', { 'aria-hidden': 'true' }), 'EdMat'),
      p.context && h('span', { className: 'ed-context' }, p.context),
      h('nav', { 'aria-label': T('mainNav') }, (p.items || []).map(function (it, i) { return h('a', { key: it.href || i, href: it.href || '#', 'aria-current': it.current ? 'page' : undefined, accessKey: it.key }, it.label); })),
      h('div', { className: 'ed-topbar-right' },
        p.extra,
        h('span', { className: 'ed-notif' }, h(Button, { iconOnly: true, icon: 'bell', variant: 'quiet', label: p.notifications ? T('notifications') + ', ' + p.notifications + T('newNotif') : T('notifications'), style: { color: 'var(--ink)' } }), p.notifications ? h('span', { className: 'ed-dot', 'aria-hidden': 'true' }) : null),
        p.user && h(Button, { variant: 'quiet', style: { color: 'var(--ink)', paddingLeft: 4 } }, h(Avatar, { name: p.user.name, kind: p.user.kind, size: 'sm' }), h('span', null, p.user.name), h(Icon, { name: 'chevron-down' }))));
  }

  /* Data */
  function Table(p) {
    var cols = p.columns || [];
    return h('div', { className: cx('ed-table-wrap', p.className), role: 'region', 'aria-label': p.caption, tabIndex: 0 },
      h('table', { className: cx('ed-table', p.stack !== false && 'ed-table-stack') },
        p.caption && h('caption', { className: p.hideCaption ? 'ed-sr' : undefined }, p.caption),
        h('thead', null, h('tr', null, cols.map(function (c) {
          var sorted = p.sort && p.sort.key === c.key;
          return h('th', { key: c.key, scope: 'col', className: cx(c.num && 'ed-num'), 'aria-sort': sorted ? (p.sort.dir === 'desc' ? 'descending' : 'ascending') : undefined },
            c.sortable ? h('button', { type: 'button', onClick: function () { p.onSort && p.onSort(c.key, sorted && p.sort.dir === 'asc' ? 'desc' : 'asc'); } }, c.title, h(Icon, { name: sorted ? (p.sort.dir === 'desc' ? 'arrow-down' : 'arrow-up') : 'chevron-down', size: 12 })) : c.title);
        }))),
        h('tbody', null, (p.rows || []).map(function (r, i) {
          return h('tr', { key: r.id || i, className: cx(r.selected && 'ed-row-selected') }, cols.map(function (c, j) {
            var cell = typeof c.render === 'function' ? c.render(r) : r[c.key];
            return h(j === 0 ? 'th' : 'td', { key: c.key, scope: j === 0 ? 'row' : undefined, className: cx(c.num && 'ed-num', c.className), 'data-label': c.title, style: j === 0 ? { fontWeight: 400 } : undefined }, j === 0 && r.selected ? h('span', { className: 'ed-sr' }, T('selectedRow')) : null, j === 0 ? cell : h('span', { className: 'ed-cell' }, cell));
          }));
        }))));
  }
  var AUDIT_ICON = { edit: 'edit', delete: 'trash', create: 'plus', login: 'user', lock: 'lock', export: 'download' };
  function AuditEntry(p) {
    return h('article', { className: cx('ed-audit', 'ed-audit-' + (p.kind || 'edit'), p.className) },
      h(Icon, { name: AUDIT_ICON[p.kind] || 'edit', label: p.kind }),
      h('div', null,
        h('div', { className: 'ed-audit-head' }, h('b', null, p.actor), h('span', null, p.action), p.target && h('span', null, '· ', p.target), h('time', { dateTime: p.iso }, p.time)),
        (p.from != null || p.to != null) && h('div', { className: 'ed-audit-diff' }, p.from != null && h('del', null, h('span', { className: 'ed-sr' }, T('oldValue')), p.from), p.from != null && p.to != null && h('span', { 'aria-hidden': 'true' }, '→'), p.to != null && h('ins', null, h('span', { className: 'ed-sr' }, T('newValue')), p.to)),
        p.reason && h('p', { className: 'ed-audit-reason', 'data-label': T('reason') + ': ' }, p.reason),
        p.meta && h('div', { className: 'ed-audit-meta' }, p.meta.ip && h('span', null, 'IP ', h('code', null, p.meta.ip)), p.meta.id && h('span', null, p.meta.ip ? ' · ' : '', 'ID ', h('code', null, p.meta.id)), p.meta.device && h('span', null, (p.meta.ip || p.meta.id) ? ' · ' : '', p.meta.device))));
  }
  var DOW = new Proxy([], { get: function (_, k) { return k === 'map' ? Array.prototype.map.bind(T('dow')) : T('dow')[k]; } });
  function Calendar(p) {
    var days = p.days || [];
    var titleId = useId(p.id && p.id + '-title');
    var focusIdx = days.reduce(function (acc, x, ix) { return acc < 0 && x.today ? ix : acc; }, -1); if (focusIdx < 0) focusIdx = days.findIndex(function (x) { return !x.off; });
    var weeks = []; for (var i = 0; i < days.length; i += 7) weeks.push(days.slice(i, i + 7));
    return h('div', { className: cx('ed-cal', p.className) },
      h('div', { className: 'ed-cal-head' }, h(Button, { iconOnly: true, icon: 'chevron-left', size: 'sm', label: T('prevMonth'), onClick: p.onPrev }), h('h3', { id: titleId }, p.month), h(Button, { iconOnly: true, icon: 'chevron-right', size: 'sm', label: T('nextMonth'), onClick: p.onNext })),
      h('table', { role: 'grid', 'aria-labelledby': titleId, onKeyDown: function (e) { var step = { ArrowRight: 1, ArrowLeft: -1, ArrowDown: 7, ArrowUp: -7 }[e.key]; if (step == null && e.key !== 'Home' && e.key !== 'End') return; var btns = Array.prototype.slice.call(e.currentTarget.querySelectorAll('.ed-cal-day')); var i = btns.indexOf(document.activeElement); if (i < 0) return; var n = e.key === 'Home' ? i - (i % 7) : e.key === 'End' ? i - (i % 7) + 6 : i + step; if (n < 0 || n >= btns.length) return; e.preventDefault(); btns[i].tabIndex = -1; btns[n].tabIndex = 0; btns[n].focus(); } },
        h('thead', null, h('tr', null, DOW.map(function (d, i) { return h('th', { key: i, scope: 'col', abbr: d }, d); }))),
        h('tbody', null, weeks.map(function (w, wi) {
          return h('tr', { key: wi }, w.map(function (d, di) {
            var evs = d.events || [], tests = evs.filter(function (e) { return e.kind === 'test'; }).length;
            var lbl = (d.label || (d.d + ' ' + (p.monthName || ''))) + (d.today ? T('today') : '') + (evs.length ? ', ' + evs.map(function (e) { return e.text; }).join(', ') : '') + (d.limit ? T('overLimit') : '');
            return h('td', { key: di, role: 'gridcell', 'aria-selected': d.today ? 'true' : undefined },
              h('button', { type: 'button', className: cx('ed-cal-day', d.today && 'ed-today', d.off && 'ed-off', d.limit && 'ed-limit'), 'aria-label': lbl, tabIndex: days.indexOf(d) === focusIdx ? 0 : -1, onClick: function () { p.onDay && p.onDay(d); } },
                h('span', { className: 'ed-d', 'aria-hidden': 'true' }, d.d),
                d.limit && h('span', { className: 'ed-limit-note', 'aria-hidden': 'true' }, h(Icon, { name: 'warning' }), tests + '/' + (p.testLimit || 1) + T('testsShort')),
                evs.slice(0, 3).map(function (e, k) { return h('span', { key: k, className: cx('ed-cal-ev', 'ed-cal-ev-' + (e.kind || 'test')), 'aria-hidden': 'true' }, e.text); }),
                evs.length > 3 && h('span', { className: 'ed-hint', 'aria-hidden': 'true' }, '+' + (evs.length - 3))));
          }));
        }))));
  }
  function LessonCard(p) {
    var state = p.state || 'normal';
    var status = state === 'cancel' ? T('cancelled') : state === 'sub' ? T('substitution') : state === 'room' ? T('roomChange') : state === 'now' ? T('now') : null;
    return h('article', { className: cx('ed-lesson', 'ed-lesson-' + (state === 'sub' ? 'subbed' : state), p.className), 'aria-label': (p.no ? p.no + T('lesson') : '') + p.subject + (status ? ', ' + status : '') },
      h('div', { className: 'ed-lesson-time' }, h('b', null, p.no ? p.no + '.' : ''), p.start, '–', p.end),
      h('div', { className: 'ed-lesson-main' },
        h('span', { className: 'ed-lesson-subject' }, p.subject),
        h('span', { className: 'ed-lesson-meta' }, p.group && h('span', null, p.group), state === 'room' ? h('span', { className: 'ed-lesson-room' }, T('room'), h('del', null, p.room), ' ', h('span', { className: 'ed-lesson-newroom' }, p.newRoom)) : p.room && h('span', null, T('room'), p.room), state === 'sub' ? h('span', { className: 'ed-lesson-sub' }, T('subBy'), p.sub) : p.teacher && h('span', null, p.teacher)),
        p.note && h('span', { className: 'ed-hint' }, p.note)),
      h('div', { className: 'ed-lesson-side' }, status && h(Badge, { tone: state === 'cancel' ? 'danger' : state === 'sub' ? 'accent' : state === 'room' ? 'info' : 'brand' }, status), p.action && h(Button, { size: 'sm', variant: state === 'now' ? 'primary' : 'secondary', onClick: p.onAction }, p.action)));
  }
  var RECEIPT = { read: ['check-all', 'read', 'ed-receipt-read'], delivered: ['check', 'delivered', 'ed-receipt-delivered'], pending: ['clock', 'awaitingAck', 'ed-receipt-pending'] };
  function MessageItem(p) {
    var r = p.receipt && RECEIPT[p.receipt];
    return h('a', { href: p.href || '#', className: cx('ed-msg', p.unread && 'ed-msg-unread', p.className), 'aria-label': (p.unread ? T('unread') : '') + p.from + ': ' + p.subject + (r ? '. ' + T(r[1]) + (p.receiptDetail ? ' ' + p.receiptDetail : '') : '') + (p.confidential ? '. ' + T('confidentialF') : '') },
      h(Avatar, { name: p.from, kind: p.kind }),
      h('span', { className: 'ed-msg-main' },
        h('span', { className: 'ed-msg-from' }, h('b', null, p.from), p.role && h('span', { className: 'ed-hint' }, p.role), p.confidential && h(Badge, { tone: 'info', icon: 'lock' }, T('confidentialF')),
          (p.badges || []).map(function (b, i) { return h(Badge, { key: i, tone: b.tone || 'outline' }, b.label); })),
        h('span', { className: 'ed-msg-subject' }, p.subject),
        p.preview && h('span', { className: 'ed-msg-preview' }, p.preview)),
      h('span', { className: 'ed-msg-side' }, h('time', null, p.time), r && h('span', { className: cx('ed-receipt', r[2]) }, h(Icon, { name: r[0] }), T(r[1]), p.receiptDetail && ' ' + p.receiptDetail)));
  }
  function ConfidentialNote(p) {
    return h('section', { className: cx('ed-conf', p.className), 'aria-label': T('confidentialNote') + (p.title || '') },
      h('div', { className: 'ed-conf-head' }, h('b', null, h(Icon, { name: 'lock' }), T('confidential')), h('span', null, p.title), p.readers && h('span', { className: 'ed-conf-readers' }, h(Icon, { name: 'eye-off' }), T('visibleTo'), p.readers)),
      p.sealed ? h('div', { className: 'ed-conf-sealed' }, h(Icon, { name: 'shield' }), h('span', null, T('sealed'), p.sealedText || T('noRights'))) : h('div', { className: 'ed-conf-body' }, typeof p.children === 'string' ? h('p', null, p.children) : p.children),
      h('div', { className: 'ed-conf-foot' }, p.author && h('span', null, p.author), p.date && h('span', null, p.date), p.meta && h('span', null, p.meta), h('span', null, T('noExport'))));
  }
  function PrintSheet(p) {
    return h('div', { className: cx('ed-sheet', p.className), role: 'document', 'aria-label': p.docTitle },
      h('div', { className: 'ed-sheet-head' }, h('div', null, h('b', null, p.school), h('br'), h('span', null, p.schoolMeta)), h('div', { style: { textAlign: 'right' } }, h('span', null, p.docNo), h('br'), h('span', null, p.date))),
      h(p.headingLevel || 'h1', { className: 'ed-sheet-title' }, p.docTitle),
      h('div', { className: 'ed-sheet-body' }, p.children),
      p.signatures && h('div', { className: 'ed-sheet-sign' }, p.signatures.map(function (s) { return h('span', { key: s }, s); })),
      h('div', { className: 'ed-sheet-foot' }, h('span', { className: 'ed-gdpr' }, p.gdpr || T('gdpr')), h('span', null, p.page || T('page1'), h('br'), T('printed'), p.printed)));
  }

  window.EdMat = Object.assign(window.EdMat || {}, {
    Icon: Icon, Button: Button, Kbd: Kbd, TextField: TextField, Select: Select, Checkbox: Checkbox, RadioGroup: RadioGroup, Switch: Switch, GradeInput: GradeInput,
    AttendanceChip: AttendanceChip, AttendanceRoster: AttendanceRoster, GradeCell: GradeCell, GradeGrid: GradeGrid, Badge: Badge, ProgressBar: ProgressBar, StatTile: StatTile, SyncStatus: SyncStatus,
    Alert: Alert, Toast: Toast, ToastRegion: ToastRegion, Dialog: Dialog, Tabs: Tabs, AccountSwitcher: AccountSwitcher, Avatar: Avatar, SkipLink: SkipLink, TopBar: TopBar,
    Table: Table, AuditEntry: AuditEntry, Calendar: Calendar, LessonCard: LessonCard, MessageItem: MessageItem, ConfidentialNote: ConfidentialNote, PrintSheet: PrintSheet,
    parseGrade: parseGrade, ATTENDANCE: ATT, CATEGORIES: CATN, STRINGS: STR,
    setLocale: function (l) { locale = STR[l] ? l : 'pl'; return locale; }, getLocale: function () { return locale; }, t: T
  });
})();
