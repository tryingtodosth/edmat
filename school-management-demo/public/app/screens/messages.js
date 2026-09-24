/* Wiadomości w dzienniku (wspólne dla wszystkich ról): skrzynka odbiorcza i wysłane,
   potwierdzenia dostarczenia i odczytu, potwierdzanie upomnień, wiadomości poufne.
   Nigdzie nie pokazujemy numerów telefonów ani adresów e-mail — rozmowa zostaje w dzienniku (3.6.9). */
(function () {
  var E = window.EdMat, A = window.EdApp, h = React.createElement, F = React.Fragment;

  window.EdI18n.add({
    pl: {
      'ms.sub': 'Korespondencja w dzienniku. {note}', 'ms.new': 'Nowa wiadomość',
      'ms.toAck': 'Do potwierdzenia: {n}', 'ms.unread': 'Nieprzeczytane: {n}',
      'ms.boxLabel': 'Skrzynka', 'ms.inbox': 'Odebrane', 'ms.sent': 'Wysłane',
      'ms.inboxList': 'Wiadomości odebrane', 'ms.sentList': 'Wiadomości wysłane',
      'ms.empty': 'Brak wiadomości w tej skrzynce.', 'ms.requiresAck': ' · wymaga potwierdzenia', 'ms.requiresAckShort': 'wymaga potwierdzenia',
      'ms.bodyAria': 'Treść wiadomości', 'ms.pick': 'Wybierz wiadomość',
      'ms.backToList': '← Wróć do listy',
      'ms.sendFail': 'Nie udało się zapisać potwierdzenia odczytu.',
      'ms.pickHint': 'Kliknij pozycję na liście, aby przeczytać treść i zobaczyć potwierdzenia odbioru.',
      'ms.to': 'Do kogo', 'ms.pickRecipient': 'Wybierz odbiorcę', 'ms.subject': 'Temat', 'ms.subjectPh': 'np. trudność z zadaniem 6',
      'ms.body': 'Treść', 'ms.bodyHint': 'Nie udostępniamy numerów telefonów ani adresów e-mail — rozmowa zostaje w dzienniku.',
      'ms.bodyPh': 'Opisz, czego nie rozumiesz', 'ms.attachment': 'Załącznik',
      'ms.confidential': 'Wiadomość poufna', 'ms.confidentialHint': 'Treść widzą wyłącznie nadawca i adresaci; nie trafia do wglądu dyrekcji.',
      'ms.detailAria': 'Wiadomość: {subject}', 'ms.toPrefix': 'Do: ', 'ms.fromPrefix': 'Od: ', 'ms.confidentialBadge': 'Poufne',
      'ms.ackTitle': 'Wymagane potwierdzenie odbioru', 'ms.ackBtn': 'Potwierdzam odbiór',
      'ms.ackText': 'Nadawca prosi o potwierdzenie przeczytania tej wiadomości.', 'ms.acked': 'Odbiór potwierdzony.',
      'ms.receipts': 'Potwierdzenia', 'ms.recipient': 'Odbiorca', 'ms.delivered': 'Dostarczono', 'ms.read': 'Odczytano',
      'ms.notRead': 'nie odczytano', 'ms.ack': 'Potwierdzenie odbioru',
      'ms.receipt.read': 'Odczytano', 'ms.receipt.delivered': 'Dostarczono', 'ms.receipt.pending': 'Wysłano',
      'ms.receiptDetail': '{state}: {read} z {total}',
      /* R7 — wiersz 24 triage'u: dziennik nie doręcza pism w rozumieniu KPA. */
      'ms.kind': 'Rodzaj pisma',
      'ms.kindHint': 'Rodzaj „decyzyjny” oznacza wiadomość jako pismo o rozstrzygnięciu i może go wybrać wyłącznie dyrektor.',
      'ms.kind.message': 'Zwykła wiadomość',
      'ms.kind.warning': 'Upomnienie',
      'ms.kind.broadcast': 'Komunikat do wielu odbiorców',
      'ms.kind.decision': 'Decyzja administracyjna',
      'ms.kind.expulsion': 'Skreślenie z listy uczniów',
      'ms.kind.scholarship': 'Stypendium',
      'ms.kind.appeal': 'Odwołanie',
      'ms.kind.disciplinary': 'Sprawa dyscyplinarna',
      'ms.formal.title': 'Pismo doręczone osobno',
      'ms.formal.banner': 'To nie jest doręczenie administracyjne (e-Doręczenia). Decyzje formalne doręcza się w trybie KPA.',
      'ms.formal.what': 'Decyzję otrzymasz na piśmie albo przez e-Doręczenia. Ta wiadomość jest wyłącznie informacją — terminy biegną od doręczenia w trybie Kodeksu postępowania administracyjnego (KPA).',
      'ms.formal.badge': 'Doręczenie poza dziennikiem',
      'ms.opened': 'Otwarto: {subject}',
      'ms.formal.switch': 'Pismo o rozstrzygnięciu',
      'ms.formal.switchHint': 'Zaznacz, gdy treść dotyczy decyzji doręczonej osobno — wiadomość dostanie ostrzeżenie i wpis w rejestrze.'
    },
    en: {
      'ms.sub': 'Correspondence inside the logbook. {note}', 'ms.new': 'New message',
      'ms.toAck': 'To confirm: {n}', 'ms.unread': 'Unread: {n}',
      'ms.boxLabel': 'Mailbox', 'ms.inbox': 'Inbox', 'ms.sent': 'Sent',
      'ms.inboxList': 'Received messages', 'ms.sentList': 'Sent messages',
      'ms.empty': 'No messages in this mailbox.', 'ms.requiresAck': ' · confirmation required', 'ms.requiresAckShort': 'confirmation required',
      'ms.bodyAria': 'Message body', 'ms.pick': 'Choose a message',
      'ms.pickHint': 'Click an item in the list to read it and see the delivery receipts.',
      'ms.backToList': '← Back to the list',
      'ms.sendFail': 'The read receipt could not be saved.',
      'ms.to': 'Recipient', 'ms.pickRecipient': 'Choose a recipient', 'ms.subject': 'Subject', 'ms.subjectPh': 'e.g. trouble with task 6',
      'ms.body': 'Message', 'ms.bodyHint': 'We never share phone numbers or e-mail addresses — the conversation stays in the logbook.',
      'ms.bodyPh': 'Describe what you do not understand', 'ms.attachment': 'Attachment',
      'ms.confidential': 'Confidential message', 'ms.confidentialHint': 'Only the sender and the addressees see the content; the principal has no access.',
      'ms.detailAria': 'Message: {subject}', 'ms.toPrefix': 'To: ', 'ms.fromPrefix': 'From: ', 'ms.confidentialBadge': 'Confidential',
      'ms.ackTitle': 'Confirmation of receipt required', 'ms.ackBtn': 'I confirm receipt',
      'ms.ackText': 'The sender asks you to confirm that you have read this message.', 'ms.acked': 'Receipt confirmed.',
      'ms.receipts': 'Receipts', 'ms.recipient': 'Recipient', 'ms.delivered': 'Delivered', 'ms.read': 'Read',
      'ms.notRead': 'not read', 'ms.ack': 'Confirmation of receipt',
      'ms.receipt.read': 'Read', 'ms.receipt.delivered': 'Delivered', 'ms.receipt.pending': 'Sent',
      'ms.receiptDetail': '{state}: {read} of {total}',
      'ms.kind': 'Kind of letter',
      'ms.kindHint': 'A decision-like kind marks the message as a letter about a ruling and only the principal may pick one.',
      'ms.kind.message': 'Ordinary message',
      'ms.kind.warning': 'Warning',
      'ms.kind.broadcast': 'Announcement to many recipients',
      'ms.kind.decision': 'Administrative decision',
      'ms.kind.expulsion': 'Removal from the register of pupils',
      'ms.kind.scholarship': 'Scholarship',
      'ms.kind.appeal': 'Appeal',
      'ms.kind.disciplinary': 'Disciplinary case',
      'ms.formal.title': 'The letter is delivered separately',
      'ms.formal.banner': 'This is not an administrative delivery (e-Doręczenia). Formal decisions must be delivered under KPA.',
      'ms.formal.what': 'You will receive the decision on paper or through the official e-delivery service (e-Doręczenia). This message is information only — the time limits run from that delivery, made under the Code of Administrative Procedure (KPA).',
      'ms.formal.badge': 'Delivered outside the logbook',
      'ms.opened': 'Opened: {subject}',
      'ms.formal.switch': 'Letter about a ruling',
      'ms.formal.switchHint': 'Tick this when the message concerns a decision delivered separately — it gets the warning and an entry in the audit log.'
    }
  });

  /* R7 — rodzaje pism, które wyglądają na rozstrzygnięcie administracyjne. Lista jest ta sama, co
     na serwerze (`FORMAL_KINDS` w server/routes/messages.js); serwer i tak decyduje. */
  var FORMAL_KINDS = ['decision', 'expulsion', 'scholarship', 'appeal', 'disciplinary'];
  var PLAIN_KINDS = ['message', 'warning', 'broadcast'];
  var isFormalKind = function (kind, flag) { return flag === true || FORMAL_KINDS.indexOf(kind) >= 0; };
  /** Baner „to nie jest doręczenie” — ten sam tekst w oknie pisania i przy gotowej wiadomości. */
  /* U3-15 — jedno miejsce, w którym pismo o rozstrzygnięciu tłumaczy się czytelnikowi: co to
     znaczy („to nie jest doręczenie administracyjne” — zdanie wspólne z serwerem, `FORMAL_NOTICE`)
     ORAZ co się wobec tego stanie i od kiedy biegną terminy. Wcześniej to samo zdanie stało trzy
     razy na jednej karcie, a żadne nie mówiło, skąd przyjdzie decyzja. */
  function FormalBanner() {
    return h(E.Alert, { tone: 'warning', title: A.t('ms.formal.title') },
      h('span', null, A.t('ms.formal.what')), ' ', h('span', { className: 'muted' }, A.t('ms.formal.banner')));
  }

  function Compose(p) {
    var st = React.useState({ to: '', subject: '', body: '', kind: 'message', formal: false, confidential: false, files: [], busy: false }), f = st[0], set = st[1];
    var s2 = React.useState(null), err = s2[0], setErr = s2[1];
    var rec = p.recipients || { recipients: [], rule: '' };
    var policy = p.policy || {};
    var staff = p.user && ['student', 'parent'].indexOf(p.user.role) < 0;
    var principal = p.user && p.user.role === 'principal';
    var formal = isFormalKind(f.kind, f.formal);
    function onFiles(e) {
      var chosen = Array.prototype.slice.call(e.target.files || []);
      Promise.all(chosen.map(function (file) {
        return new Promise(function (res) { var fr = new FileReader(); fr.onload = function () { res({ name: file.name, size: file.size, type: file.type, dataUrl: fr.result }); }; fr.readAsDataURL(file); });
      })).then(function (out) { set(Object.assign({}, f, { files: f.files.concat(out) })); });
    }
    function send() {
      if (f.busy) return;
      setErr(null); set(Object.assign({}, f, { busy: true }));
      A.api.post('/api/messages', { toUserIds: [f.to], subject: f.subject, body: f.body, kind: f.kind, formal: f.formal, confidential: f.confidential, attachments: f.files })
        .then(function (r) { A.toast(r.receipt, 'success'); p.onSent(); })
        .catch(function (e) { set(Object.assign({}, f, { busy: false })); setErr(e.message); });
    }
    return h(E.Dialog, {
      title: A.t('ms.new'), onClose: p.onClose, initialFocus: '#msg-to',
      actions: [h(E.Button, { key: 'c', variant: 'secondary', onClick: p.onClose }, A.t('common.cancel')),
        h(E.Button, { key: 's', variant: 'primary', icon: 'check', loading: f.busy, disabled: f.busy || !f.to || !f.subject.trim() || !f.body.trim(), onClick: send }, A.t('common.send'))]
    },
      err ? h(E.Alert, { tone: 'danger' }, err) : null,
      h('div', { className: 'stack' },
        h(E.Select, {
          id: 'msg-to', label: A.t('ms.to'), value: f.to, width: '100%', placeholder: A.t('ms.pickRecipient'),
          hint: rec.rule, options: rec.recipients.map(function (r) { return { value: r.id, label: r.name + ' – ' + A.t('role.' + r.role) + (r.context ? ' (' + r.context + ')' : '') }; }),
          onChange: function (e) { set(Object.assign({}, f, { to: e.target.value })); }
        }),
        h(E.TextField, { label: A.t('ms.subject'), value: f.subject, width: '100%', placeholder: A.t('ms.subjectPh'), onChange: function (e) { set(Object.assign({}, f, { subject: e.target.value })); } }),
        h(E.TextField, {
          label: A.t('ms.body'), multiline: 5, value: f.body, width: '100%',
          hint: A.t('ms.bodyHint'),
          placeholder: A.t('ms.bodyPh'), onChange: function (e) { set(Object.assign({}, f, { body: e.target.value })); }
        }),
        h('div', { className: 'row' },
          h('label', { className: 'label', htmlFor: 'msg-files' }, A.t('ms.attachment')),
          h('input', { id: 'msg-files', type: 'file', multiple: true, onChange: onFiles }),
          f.files.map(function (x, i) { return h(E.Badge, { key: i, tone: 'outline', icon: 'file' }, x.name); })),
        /* Rodzaj pisma wybiera pracownik szkoły; rodzaje „decyzyjne” widzi wyłącznie dyrektor.
           U3-44: podpowiedź o rodzajach decyzyjnych czyta wyłącznie ten, kto je w ogóle widzi. */
        staff ? h(E.Select, {
          label: A.t('ms.kind'), value: f.kind, width: '100%', hint: principal ? A.t('ms.kindHint') : undefined,
          options: PLAIN_KINDS.concat(principal ? (policy.formalKinds || FORMAL_KINDS) : []).map(function (k) { return { value: k, label: A.t('ms.kind.' + k) }; }),
          onChange: function (e) { set(Object.assign({}, f, { kind: e.target.value })); }
        }) : null,
        /* U3-26 — ostrzeżenie stoi PRZY wyborze rodzaju, a nie na górze okna (na telefonie było
           poza ekranem), a jego pojemnik jest zamontowany zawsze, więc czytnik ekranu ogłasza samą
           zmianę treści, a nie pojawienie się całego obszaru. */
        h('div', { role: 'status' }, formal ? h(FormalBanner) : null),
        principal ? h(E.Checkbox, { label: A.t('ms.formal.switch'), hint: A.t('ms.formal.switchHint'), checked: f.formal, onChange: function (e) { set(Object.assign({}, f, { formal: e.target.checked })); } }) : null,
        h(E.Checkbox, { label: A.t('ms.confidential'), hint: A.t('ms.confidentialHint'), checked: f.confidential, onChange: function (e) { set(Object.assign({}, f, { confidential: e.target.checked })); } })));
  }

  function Detail(p) {
    var m = p.message;
    /* Below 720 px the two panes stack, so opening a message scrolls nothing and looks like a no-op. */
    var ref = React.useRef(null);
    React.useEffect(function () { if (ref.current && window.innerWidth <= 720) ref.current.scrollIntoView({ block: 'start' }); if (ref.current) ref.current.focus(); }, [m.id]);
    return h('div', { ref: ref, tabIndex: -1, className: 'card', 'aria-label': A.t('ms.detailAria', { subject: m.subject }) },
      h(E.Button, { className: 'app-backlink', size: 'sm', variant: 'quiet', onClick: p.onBack }, A.t('ms.backToList')),
      h('h2', { className: 'heading' }, m.subject),
      h('p', { className: 'caption muted' },
        (m.box === 'sent' ? A.t('ms.toPrefix') + m.to.map(function (x) { return x.name; }).join(', ') : A.t('ms.fromPrefix') + m.from.name + ' · ' + (m.from.role ? A.t('role.' + m.from.role) : m.from.roleLabel)) + ' · ' + A.fmtDateTime(m.at)),
      m.confidential ? h(E.Badge, { tone: 'danger', icon: 'lock' }, A.t('ms.confidentialBadge')) : null,
      /* R7/U3-15: przy piśmie o rozstrzygnięciu adresat czyta RAZ, co się właściwie stanie —
         wcześniej to samo zdanie stało na odznace, w alercie i w stopce, a żadne nie mówiło,
         skąd przyjdzie decyzja. Odznaka zostaje na liście, gdzie niesie informację. */
      m.formal ? h(FormalBanner) : null,
      h('p', { style: { whiteSpace: 'pre-wrap' } }, m.body),
      m.attachments.length ? h('div', { className: 'row' }, m.attachments.map(function (a, i) {
        return h(E.Button, { key: i, size: 'sm', icon: 'download', href: a.dataUrl || undefined, download: a.name }, a.name);
      })) : null,
      m.ackRequiredFromMe ? h(E.Alert, { tone: 'warning', title: A.t('ms.ackTitle'), actions: h(E.Button, { size: 'sm', variant: 'primary', onClick: function () {
        A.api.post('/api/messages/' + m.id + '/ack')
          .then(function (r) { A.toast(r.receipt, 'success'); p.reload(); })
          .catch(function (e) { A.toast(e.message || A.t('ms.sendFail'), 'danger'); });
      } }, A.t('ms.ackBtn')) }, A.t('ms.ackText')) : null,
      m.acked ? h(E.Alert, { tone: 'success' }, A.t('ms.acked')) : null,
      m.receipts && m.box === 'sent' ? h(E.Table, {
        caption: A.t('ms.receipts'), hideCaption: true,
        columns: [
          { key: 'u', title: A.t('ms.recipient'), render: function (r) { return r.user.name; } },
          { key: 'd', title: A.t('ms.delivered'), render: function (r) { return r.delivered ? A.fmtDateTime(r.delivered) : '—'; } },
          { key: 'r', title: A.t('ms.read'), render: function (r) { return r.read ? A.fmtDateTime(r.read) : A.t('ms.notRead'); } },
          { key: 'a', title: A.t('ms.ack'), render: function (r) { return r.ack ? A.fmtDateTime(r.ack) : '—'; } }],
        rows: m.receipts
      }) : null,
      /* Stopka serwera powtarzałaby przy piśmie formalnym zdanie z alertu (serwer wysyła tam
         `FORMAL_NOTICE`), więc przy nim jej nie pokazujemy. */
      m.formal ? null : h('p', { className: 'caption muted' }, m.note));
  }

  A.screen({
    id: 'messages', path: '/wiadomosci', title: 'Wiadomości', module: 'messages',
    nav: { key: 'nav.messages', label: 'Wiadomości', order: 90 },
    component: function MessagesScreen(props) {
      var st = React.useState(props.route.query.box === 'sent' ? 'sent' : 'inbox'), box = st[0], setBox0 = st[1];
      function setBox(v) { setBox0(v); A.navigate('/wiadomosci', { box: v }); }
      var s2 = React.useState(false), compose = s2[0], setCompose = s2[1];
      var s3 = React.useState(props.route.query.id || null), openId = s3[0], setOpen = s3[1];
      var list = A.useApi('/api/messages?box=' + box, [box]);
      var recipients = A.useApi('/api/messages/recipients', []);
      var detail = A.useApi(openId ? '/api/messages/' + openId : null, [openId]);
      var data = list.data || { messages: [], counts: { inbox: 0, sent: 0, unread: 0, toAck: 0 }, policy: {} };
      var qid = props.route.query.id || null;
      React.useEffect(function () { if (qid !== openId) setOpen(qid); }, [qid]);
      function reloadAll() { list.reload(); detail.reload(); }
      return h('div', { className: 'stack' },
        h('div', null,
          h('h1', { className: 'display app-title' }, A.t('common.messages')),
          h('p', { className: 'app-sub' }, A.t('ms.sub', { note: data.policy.note || '' }))),
        h('div', { className: 'row' },
          h(E.Button, { variant: 'primary', icon: 'plus', onClick: function () { setCompose(true); } }, A.t('ms.new')),
          data.counts.toAck ? h(E.Badge, { tone: 'danger', icon: 'warning' }, A.t('ms.toAck', { n: data.counts.toAck })) : null,
          data.counts.unread ? h(E.Badge, { tone: 'info', icon: 'bell' }, A.t('ms.unread', { n: data.counts.unread })) : null),
        /* U3-17 — zakładki dostają swój panel jako dzieci. Bez nich `E.Tabs` nie tworzy
           `role="tabpanel"`, a każda zakładka i tak wskazuje `aria-controls` na identyfikator,
           którego nie ma w drzewie: czytnik ekranu przechodzi donikąd. */
        h(E.Tabs, {
          label: A.t('ms.boxLabel'), value: box, onChange: function (id) { setBox0(id); setOpen(null); A.navigate('/wiadomosci', { box: id }); },
          tabs: [{ id: 'inbox', label: A.t('ms.inbox'), count: data.counts.inbox }, { id: 'sent', label: A.t('ms.sent'), count: data.counts.sent }]
        },
        h('div', { className: 'grid-2' },
          h('div', { 'aria-label': box === 'sent' ? A.t('ms.sentList') : A.t('ms.inboxList'), style: { border: 'var(--border) solid var(--line)', borderRadius: 'var(--radius-md)', overflow: 'hidden' } },
            list.loading ? h('p', { className: 'muted', style: { padding: 'var(--space-4)' } }, A.t('common.loading')) : null,
            !list.loading && !data.messages.length ? h('p', { className: 'muted', style: { padding: 'var(--space-4)' } }, A.t('ms.empty')) : null,
            data.messages.map(function (m) {
              var other = box === 'sent' ? (m.to[0] || { name: '—', roleLabel: '' }) : m.from;
              return h(E.MessageItem, {
                key: m.id, from: (box === 'sent' ? A.t('ms.toPrefix') : '') + other.name,
                role: [other.context || (other.role ? A.t('role.' + other.role) : other.roleLabel), m.formal ? A.t('ms.formal.badge') : null, m.requiresAck ? A.t('ms.requiresAckShort') : null].filter(Boolean).join(' · '),
                kind: other.role === 'student' || other.role === 'parent' ? 'child' : 'staff',
                /* R7: pismo o rozstrzygnięciu jest oznaczone już na liście, a nie dopiero po otwarciu. */
                /* U3-43 — znaczniki nie wchodzą już do samego tematu (czytały się jak jego ciąg
                   dalszy, tą samą pogrubioną czcionką); stoją przy roli nadawcy, gdzie `E.MessageItem`
                   trzyma podpowiedzi. Docelowo `E.MessageItem` powinien przyjmować `badges` — patrz
                   raport F6. */
                subject: m.subject, preview: m.preview, time: A.fmtDate(m.at),
                unread: m.unread, confidential: m.confidential,
                receipt: m.receipt ? m.receipt.state : undefined,
                receiptDetail: m.receipt ? A.t('ms.receiptDetail', { state: A.t('ms.receipt.' + m.receipt.state), read: m.receipt.read, total: m.receipt.recipients }) : undefined,
                href: '#/wiadomosci?id=' + m.id
              });
            })),
          /* U3-25 — otwarcie wiadomości przenosi fokus na kartę (to jest właściwe zachowanie),
             więc pojemnik NIE jest obszarem `aria-live`: inaczej czytnik ogłaszał wiadomość dwa
             razy, za drugim razem całą kartę z odznakami, banerem i tabelą potwierdzeń. Krótkie
             „Otwarto: <temat>” w `role="status"` wystarczy. */
          h('div', { 'aria-label': A.t('ms.bodyAria') },
            h('p', { role: 'status', className: 'ed-sr' }, openId && detail.data ? A.t('ms.opened', { subject: detail.data.subject }) : ''),
            openId && detail.data ? h(Detail, { message: detail.data, reload: reloadAll, onBack: function () { A.navigate('/wiadomosci', { box: box }); } })
              : h('div', { className: 'card' }, h('h2', { className: 'heading' }, A.t('ms.pick')), h('p', { className: 'muted' }, A.t('ms.pickHint')))))),
        compose ? h(Compose, { recipients: recipients.data, user: props.user, policy: data.policy, onClose: function () { setCompose(false); }, onSent: function () { setCompose(false); setBox('sent'); list.reload(); } }) : null);
    }
  });
})();
