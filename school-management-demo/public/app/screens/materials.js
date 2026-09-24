/* Współpraca nad materiałami — ekran „/wspolpraca” i karta materiałów w panelu lekcji. Wzór: strona treści w 2donet
   (ContentDetail): nagłówek z odznakami i autorem, opis, sekcja współpracy ze zgłoszeniami („claim”), dyskusja,
   boczna kolumna z kartami Przegląd / Oś czasu / Zasoby; lista z nagłówkiem-eksploratorem (definicja + liczniki +
   filtry). Dane wyłącznie z routes/materials.js; plik przez routes/student.js (`/api/materials/:id`). */
(function () {
  var React = window.React, h = React.createElement, F = React.Fragment, E = window.EdMat, A = window.EdApp, LC = window.EdLogComments;
  var COOP_ROLES = ['teacher', 'principal', 'supportTeacher', 'librarian', 'counselor', 'psychologist', 'specialEducator', 'speechTherapist'];
  window.EdI18n.add({
    pl: {
      'nav.coop': 'Współpraca',
      'mc.title': 'Współpraca nad materiałami', 'mc.def': 'Materiały z lekcji, które nauczyciele udostępniają sobie do wspólnej pracy: klucz odpowiedzi, wersja z dostosowaniem, tłumaczenie poleceń, druga para oczu. Autor decyduje, czy materiał jest otwarty; współpracownik zgłasza się i mówi, co zrobi.',
      'mc.stat.open': 'otwartych na współpracę', 'mc.stat.mine': 'moich materiałów', 'mc.stat.claimed': 'moich zgłoszeń', 'mc.stat.contributors': 'współpracowników',
      'mc.f.all': 'Wszystkie', 'mc.f.open': 'Otwarte na współpracę', 'mc.f.mine': 'Moje', 'mc.f.claimed': 'Zgłoszone przeze mnie', 'mc.filters': 'Filtry materiałów', 'mc.subject': 'Przedmiot', 'mc.allSubjects': 'Wszystkie przedmioty',
      'mc.open': 'Otwarty na współpracę', 'mc.closed': 'Zamknięty na współpracę', 'mc.material': 'Materiał', 'mc.mine': 'Mój', 'mc.claimedByMe': 'Zgłoszono',
      'mc.claims': '{n} zgłoszeń', 'mc.claims1': '1 zgłoszenie', 'mc.comments': '{n} komentarzy', 'mc.comments1': '1 komentarz', 'mc.details': 'Szczegóły', 'mc.back': 'Wróć do listy',
      'mc.empty': 'Brak materiałów w tym widoku.', 'mc.loading': 'Wczytywanie materiałów…', 'mc.by': 'Dodał(a)', 'mc.lesson': 'Lekcja', 'mc.class': 'Oddział', 'mc.size': 'Rozmiar', 'mc.type': 'Typ pliku', 'mc.added': 'Dodano', 'mc.downloads': 'Pobrania', 'mc.download': 'Pobierz plik', 'mc.openLesson': 'Otwórz lekcję w dzienniku',
      'mc.desc': 'Opis dla współpracowników', 'mc.descHint': 'Co to jest, dla kogo i czego brakuje — to czytają współpracownicy przed zgłoszeniem.', 'mc.noDesc': 'Autor nie dodał jeszcze opisu.', 'mc.saveDesc': 'Zapisz opis', 'mc.descSaved': 'Opis zapisany.',
      'mc.coop': 'Współpraca', 'mc.coopOpenText': 'Każdy nauczyciel może zgłosić się do pracy nad tym materiałem. Zgłoszenie to zobowiązanie, nie prośba o dostęp — plik i tak jest w dzienniku.', 'mc.coopClosedText': 'Autor zamknął materiał na współpracę. Zgłoszenia już złożone zostają, nowych nie da się dodać.',
      'mc.claim': 'Zgłoś się do współpracy', 'mc.release': 'Wycofaj zgłoszenie', 'mc.claimTitle': 'Zgłoszenie do współpracy', 'mc.claimNote': 'Co zrobisz?', 'mc.claimNoteHint': 'Jedno zdanie, np. „Zrobię klucz odpowiedzi” — autor dostanie powiadomienie z tą treścią.', 'mc.claimSend': 'Zgłoś się', 'mc.claimed': 'Zgłoszenie zapisane — autor został powiadomiony.', 'mc.released': 'Zgłoszenie wycofane.',
      'mc.contributors': 'Współpracownicy', 'mc.noClaims': 'Nikt się jeszcze nie zgłosił.', 'mc.ownerNote': 'To Twój materiał — zgłaszają się do niego inni.',
      'mc.settings': 'Ustawienia autora', 'mc.coopSwitch': 'Otwarty na współpracę', 'mc.coopSwitchHint': 'Wyłączenie blokuje nowe zgłoszenia; dyskusja i pobieranie działają dalej.', 'mc.coopChanged': 'Ustawienie zapisane.',
      'mc.tab.overview': 'Przegląd', 'mc.tab.timeline': 'Oś czasu', 'mc.tab.resources': 'Zasoby', 'mc.side': 'Informacje o materiale',
      'mc.tl.material_uploaded': 'dodano materiał', 'mc.tl.material_claimed': 'zgłoszenie do współpracy', 'mc.tl.material_claim_released': 'wycofano zgłoszenie', 'mc.tl.material_updated': 'zmieniono ustawienia', 'mc.tl.opened': 'otwarto na współpracę', 'mc.tl.closed': 'zamknięto na współpracę',
      'mc.discussion': 'Dyskusja', 'mc.discussionHint': 'Komentarze widzą nauczyciele i kadra pedagogiczna; uczniowie i rodzice ich nie widzą.',
      'mc.card.title': 'Materiały z lekcji', 'mc.card.add': 'Dodaj materiał', 'mc.card.file': 'Plik (do 20 MB)', 'mc.card.name': 'Nazwa materiału', 'mc.card.save': 'Zapisz materiał', 'mc.card.saved': 'Materiał zapisany.', 'mc.card.none': 'Do tej lekcji nie ma jeszcze materiałów.', 'mc.card.tooBig': 'Plik {name} ma {size} — limit to 20 MB.', 'mc.card.noFile': 'Wskaż plik.', 'mc.card.coopHint': 'Inni nauczyciele zobaczą materiał na ekranie „Współpraca” i będą mogli się zgłosić.', 'mc.card.forStudents': 'Uczniowie tej lekcji pobierają materiał ze swojego ekranu; współpraca dotyczy nauczycieli.'
    },
    en: {
      'nav.coop': 'Cooperation',
      'mc.title': 'Cooperation on materials', 'mc.def': 'Lesson materials that teachers open to each other for joint work: an answer key, an adapted version, translated instructions, a second pair of eyes. The author decides whether a material is open; a contributor claims it and says what they will do.',
      'mc.stat.open': 'open for cooperation', 'mc.stat.mine': 'my materials', 'mc.stat.claimed': 'my claims', 'mc.stat.contributors': 'contributors',
      'mc.f.all': 'All', 'mc.f.open': 'Open for cooperation', 'mc.f.mine': 'Mine', 'mc.f.claimed': 'Claimed by me', 'mc.filters': 'Material filters', 'mc.subject': 'Subject', 'mc.allSubjects': 'All subjects',
      'mc.open': 'Open for cooperation', 'mc.closed': 'Closed for cooperation', 'mc.material': 'Material', 'mc.mine': 'Mine', 'mc.claimedByMe': 'Claimed',
      'mc.claims': '{n} claims', 'mc.claims1': '1 claim', 'mc.comments': '{n} comments', 'mc.comments1': '1 comment', 'mc.details': 'Details', 'mc.back': 'Back to the list',
      'mc.empty': 'No materials in this view.', 'mc.loading': 'Loading materials…', 'mc.by': 'Added by', 'mc.lesson': 'Lesson', 'mc.class': 'Class', 'mc.size': 'Size', 'mc.type': 'File type', 'mc.added': 'Added', 'mc.downloads': 'Downloads', 'mc.download': 'Download file', 'mc.openLesson': 'Open the lesson in the logbook',
      'mc.desc': 'Description for contributors', 'mc.descHint': 'What it is, who it is for and what is missing. Contributors read this before claiming.', 'mc.noDesc': 'The author has not added a description yet.', 'mc.saveDesc': 'Save description', 'mc.descSaved': 'Description saved.',
      'mc.coop': 'Cooperation', 'mc.coopOpenText': 'Any teacher can claim work on this material. A claim is a commitment, not an access request: the file is in the logbook anyway.', 'mc.coopClosedText': 'The author closed this material for cooperation. Existing claims stay; new ones cannot be added.',
      'mc.claim': 'Claim work on this material', 'mc.release': 'Withdraw my claim', 'mc.claimTitle': 'Claim work', 'mc.claimNote': 'What will you do?', 'mc.claimNoteHint': 'One sentence, e.g. “I will write the answer key”. The author is notified with this text.', 'mc.claimSend': 'Claim', 'mc.claimed': 'Claim saved and the author notified.', 'mc.released': 'Claim withdrawn.',
      'mc.contributors': 'Contributors', 'mc.noClaims': 'Nobody has claimed work yet.', 'mc.ownerNote': 'This is your material; others claim work on it.',
      'mc.settings': 'Author settings', 'mc.coopSwitch': 'Open for cooperation', 'mc.coopSwitchHint': 'Switching it off blocks new claims; discussion and downloads keep working.', 'mc.coopChanged': 'Setting saved.',
      'mc.tab.overview': 'Overview', 'mc.tab.timeline': 'Timeline', 'mc.tab.resources': 'Resources', 'mc.side': 'About this material',
      'mc.tl.material_uploaded': 'material added', 'mc.tl.material_claimed': 'work claimed', 'mc.tl.material_claim_released': 'claim withdrawn', 'mc.tl.material_updated': 'settings changed', 'mc.tl.opened': 'opened for cooperation', 'mc.tl.closed': 'closed for cooperation',
      'mc.discussion': 'Discussion', 'mc.discussionHint': 'Comments are visible to teachers and pedagogical staff; pupils and parents do not see them.',
      'mc.card.title': 'Lesson materials', 'mc.card.add': 'Add material', 'mc.card.file': 'File (up to 20 MB)', 'mc.card.name': 'Material name', 'mc.card.save': 'Save material', 'mc.card.saved': 'Material saved.', 'mc.card.none': 'This lesson has no materials yet.', 'mc.card.tooBig': 'File {name} is {size}; the limit is 20 MB.', 'mc.card.noFile': 'Choose a file.', 'mc.card.coopHint': 'Other teachers will see the material on the “Cooperation” screen and can claim work on it.', 'mc.card.forStudents': 'Pupils of this lesson download the material from their own screen; cooperation is between teachers.'
    }
  });
  var t = function (k, v) { return A.t(k, v); };
  function fileSize(n) { n = +n || 0; return n >= 1048576 ? A.fmtNum(n / 1048576, 1) + ' MB' : n >= 1024 ? Math.round(n / 1024) + ' kB' : n + ' B'; }
  function plural(n, one, many) { return n === 1 ? t(one) : t(many, { n: n }); }
  function lessonLabel(l) { return l ? A.fmtDate(l.date) + ' · ' + l.lessonNo + '. ' + (A.state.locale === 'en' ? 'lesson' : 'lekcja') : ''; }
  function CoopBadge(p) { var m = p.material; return h(E.Badge, { tone: m.coopAllowed ? 'success' : 'outline', icon: m.coopAllowed ? 'users' : 'lock' }, t(m.coopAllowed ? 'mc.open' : 'mc.closed')); }
  function Person(p) { var u = p.user || {}; return h('span', { className: 'row', style: { gap: 'var(--space-2)', display: 'inline-flex' } }, h(E.Avatar, { name: u.name || '?', size: 'sm', kind: 'staff' }), h('span', null, u.name || '—')); }

  /* ---------- karta na liście ---------- */
  function MaterialCard(p) {
    var m = p.material;
    return h('article', { className: 'card', style: { display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' } },
      h('div', { className: 'row', style: { justifyContent: 'space-between' } }, h(E.Badge, { tone: 'brand', icon: 'file' }, t('mc.material')), h(CoopBadge, { material: m })),
      h('h3', { className: 'heading', style: { margin: 0 } }, m.name),
      h('p', { className: 'muted', style: { margin: 0 } }, m.subject + (m.classId ? ' · ' + m.classId : '') + (m.lesson ? ' · ' + lessonLabel(m.lesson) : '')),
      m.description ? h('p', { style: { margin: 0, fontSize: '0.9375rem' } }, m.description.length > 140 ? m.description.slice(0, 140) + '…' : m.description) : null,
      h('div', { className: 'row', style: { justifyContent: 'space-between', marginTop: 'auto' } },
        h(Person, { user: m.owner }),
        h('span', { className: 'caption muted' }, plural(m.claimCount, 'mc.claims1', 'mc.claims') + ' · ' + plural(m.commentCount, 'mc.comments1', 'mc.comments'))),
      h('div', { className: 'row' },
        m.mine ? h(E.Badge, { tone: 'info' }, t('mc.mine')) : null, m.claimedByMe ? h(E.Badge, { tone: 'accent', icon: 'check' }, t('mc.claimedByMe')) : null,
        h(E.Button, { size: 'sm', icon: 'chevron-right', onClick: function () { A.navigate('/wspolpraca', { m: m.id }); } }, t('mc.details'))));
  }

  /* ---------- zgłoszenie ---------- */
  function ClaimDialog(p) {
    var st = React.useState({ note: '', busy: false, error: null }); var f = st[0], set = st[1];
    var send = function () { set(Object.assign({}, f, { busy: true, error: null })); A.api.post('/api/materials/' + p.material.id + '/claim', { note: f.note }).then(function () { A.toast(t('mc.claimed'), 'success'); p.onDone(); }).catch(function (e) { set(Object.assign({}, f, { busy: false, error: e.message })); }); };
    return h(E.Dialog, { title: t('mc.claimTitle'), onClose: p.onClose, actions: [h(E.Button, { key: 'c', onClick: p.onClose }, t('common.cancel')), h(E.Button, { key: 's', variant: 'primary', loading: f.busy, onClick: send }, t('mc.claimSend'))] },
      h('p', { style: { marginTop: 0 } }, h('b', null, p.material.name)), f.error ? h(E.Alert, { tone: 'danger' }, f.error) : null,
      h(E.TextField, { label: t('mc.claimNote'), multiline: 3, value: f.note, maxLength: 300, hint: t('mc.claimNoteHint'), autoFocus: true, onChange: function (e) { set(Object.assign({}, f, { note: e.target.value })); } }));
  }

  /* ---------- szczegóły (ContentDetail) ---------- */
  function Detail(p) {
    var d = A.useApi('/api/materials/' + p.id + '/details', [p.id]); var m = d.data;
    var s1 = React.useState(false), claiming = s1[0], setClaiming = s1[1];
    var s2 = React.useState('overview'), tab = s2[0], setTab = s2[1];
    var s3 = React.useState(null), desc = s3[0], setDesc = s3[1];
    var back = h(E.Button, { variant: 'quiet', icon: 'chevron-left', onClick: function () { A.navigate('/wspolpraca'); } }, t('mc.back'));
    if (d.error) return h('div', null, back, h(E.Alert, { tone: 'danger' }, d.error.message));
    if (!m) return h('div', null, back, h('p', { className: 'muted' }, t('mc.loading')));
    var release = function () { A.api.delete('/api/materials/' + m.id + '/claim').then(function () { A.toast(t('mc.released'), 'success'); d.reload(); }).catch(function (e) { A.toast(e.message, 'danger'); }); };
    var setCoop = function (v) { A.api.patch('/api/materials/' + m.id, { coopAllowed: v }).then(function () { A.toast(t('mc.coopChanged'), 'success'); d.reload(); }).catch(function (e) { A.toast(e.message, 'danger'); }); };
    var saveDesc = function () { A.api.patch('/api/materials/' + m.id, { description: desc }).then(function () { A.toast(t('mc.descSaved'), 'success'); setDesc(null); d.reload(); }).catch(function (e) { A.toast(e.message, 'danger'); }); };
    var tabs = [{ id: 'overview', label: t('mc.tab.overview') }, { id: 'timeline', label: t('mc.tab.timeline'), count: m.timeline.length }, { id: 'resources', label: t('mc.tab.resources') }];
    return h('div', null,
      h('div', { className: 'row mb-4', style: { justifyContent: 'space-between' } }, back, h('div', { className: 'row' }, h(E.Badge, { tone: 'brand', icon: 'file' }, t('mc.material')), h(CoopBadge, { material: m }), m.mine ? h(E.Badge, { tone: 'info' }, t('mc.mine')) : null, m.claimedByMe ? h(E.Badge, { tone: 'accent', icon: 'check' }, t('mc.claimedByMe')) : null)),
      h('h1', { className: 'display app-title' }, m.name),
      h('p', { className: 'app-sub row', style: { gap: 'var(--space-3)' } }, h(Person, { user: m.owner }), h('span', null, A.fmtDateTime(m.at)), h('span', null, m.subject + (m.classId ? ' · ' + m.classId : '')), m.lesson ? h('span', null, lessonLabel(m.lesson)) : null),
      h('div', { className: 'grid-2', style: { gridTemplateColumns: 'minmax(0, 2fr) minmax(280px, 1fr)' } },
        h('div', { className: 'stack' },
          /* opis = „Description” z 2donet; autor edytuje w miejscu */
          h('section', { className: 'card', 'aria-labelledby': 'mc-h-desc' }, h('h2', { id: 'mc-h-desc' }, t('mc.desc')),
            desc != null ? h('div', { className: 'stack' }, h(E.TextField, { label: t('mc.desc'), multiline: 4, maxLength: m.maxDescription, value: desc, hint: t('mc.descHint'), onChange: function (e) { setDesc(e.target.value); } }), h('div', { className: 'row' }, h(E.Button, { variant: 'primary', onClick: saveDesc }, t('mc.saveDesc')), h(E.Button, { variant: 'quiet', onClick: function () { setDesc(null); } }, t('common.cancel'))))
              : h(F, null, h('p', { style: { marginTop: 0, whiteSpace: 'pre-wrap' }, className: m.description ? '' : 'muted' }, m.description || t('mc.noDesc')), m.canEdit ? h(E.Button, { size: 'sm', icon: 'edit', onClick: function () { setDesc(m.description || ''); } }, t('common.edit')) : null)),
          /* współpraca = „Action items” + „Roles” z 2donet: kto się zgłosił, co zrobi, przycisk zgłoszenia */
          h('section', { className: 'card', 'aria-labelledby': 'mc-h-coop' }, h('h2', { id: 'mc-h-coop' }, t('mc.coop')),
            h(E.Alert, { tone: m.coopAllowed ? 'success' : 'warning' }, t(m.coopAllowed ? 'mc.coopOpenText' : 'mc.coopClosedText')),
            h('div', { className: 'row mt-4' },
              m.canClaim ? h(E.Button, { variant: 'primary', icon: 'users', onClick: function () { setClaiming(true); } }, t('mc.claim')) : null,
              m.claimedByMe ? h(E.Button, { icon: 'x', onClick: release }, t('mc.release')) : null,
              m.mine ? h('span', { className: 'muted' }, t('mc.ownerNote')) : null),
            h('h3', { className: 'subheading', style: { margin: 'var(--space-4) 0 var(--space-2)' } }, t('mc.contributors') + ' (' + m.claims.length + ')'),
            m.claims.length ? h('ul', { className: 'stack', style: { listStyle: 'none', padding: 0, margin: 0, gap: 'var(--space-2)' } }, m.claims.map(function (c) { return h('li', { key: c.userId, className: 'row', style: { alignItems: 'flex-start' } }, h(E.Avatar, { name: c.user ? c.user.name : '?', kind: 'staff' }), h('div', null, h('b', null, c.user ? c.user.name : '—'), h('span', { className: 'muted' }, ' · ' + A.fmtDateTime(c.at)), c.note ? h('div', { style: { fontSize: '0.9375rem' } }, c.note) : null)); })) : h('p', { className: 'muted' }, t('mc.noClaims')),
            m.canEdit ? h('div', { className: 'mt-4', style: { borderTop: 'var(--border) solid var(--line)', paddingTop: 'var(--space-3)' } }, h('h3', { className: 'subheading', style: { margin: '0 0 var(--space-2)' } }, t('mc.settings')), h(E.Switch, { label: t('mc.coopSwitch'), checked: m.coopAllowed, hint: t('mc.coopSwitchHint'), onChange: setCoop })) : null),
          /* dyskusja = wspólny mechanizm komentarzy dzienników */
          h('section', { className: 'card', 'aria-labelledby': 'mc-h-disc' }, h('h2', { id: 'mc-h-disc' }, t('mc.discussion')), h('p', { className: 'muted', style: { marginTop: 0 } }, t('mc.discussionHint')), LC ? h(LC.Panel, { kind: 'materials', entryId: m.id }) : null)),
        /* boczna kolumna = Przegląd / Oś czasu / Zasoby */
        h('aside', { 'aria-label': t('mc.side') }, h('div', { className: 'card' }, h(E.Tabs, { tabs: tabs, value: tab, onChange: setTab, label: t('mc.side') }, function (v) {
          if (v === 'overview') return h('dl', { className: 'stack', style: { margin: 0, gap: 'var(--space-2)' } },
            [[t('mc.by'), m.owner ? m.owner.name : '—'], [t('mc.subject'), m.subject], [t('mc.class'), m.classId || '—'], [t('mc.lesson'), m.lesson ? lessonLabel(m.lesson) + (m.lesson.topic ? ' · ' + m.lesson.topic : '') : '—'], [t('mc.type'), m.type], [t('mc.size'), fileSize(m.size)], [t('mc.added'), A.fmtDateTime(m.at)], [t('mc.downloads'), String(m.downloads)]].map(function (kv) { return h('div', { key: kv[0] }, h('dt', { className: 'caption muted' }, kv[0]), h('dd', { style: { margin: 0 } }, kv[1])); }));
          if (v === 'timeline') return h('ol', { className: 'stack', style: { listStyle: 'none', margin: 0, padding: 0, gap: 'var(--space-2)' } }, m.timeline.map(function (x, i) { var what = x.action === 'material_updated' && typeof x.coopAllowed === 'boolean' ? t(x.coopAllowed ? 'mc.tl.opened' : 'mc.tl.closed') : t('mc.tl.' + x.action); return h('li', { key: i, style: { borderLeft: '2px solid var(--line)', paddingLeft: 'var(--space-3)' } }, h('div', { className: 'caption muted' }, A.fmtDateTime(x.at)), h('div', null, h('b', null, what), x.user ? ' · ' + x.user.name : ''), x.note ? h('div', { className: 'muted' }, x.note) : null); }));
          return h('div', { className: 'stack' }, h(E.Button, { icon: 'download', href: A.base + m.downloadPath, target: '_blank' }, t('mc.download') + ' (' + fileSize(m.size) + ')'), m.lesson ? h(E.Button, { icon: 'calendar', variant: 'quiet', onClick: function () { A.navigate('/lekcja', { lesson: m.lesson.id }); } }, t('mc.openLesson')) : null);
        })))),
      claiming ? h(ClaimDialog, { material: m, onClose: function () { setClaiming(false); }, onDone: function () { setClaiming(false); d.reload(); } }) : null);
  }

  /* ---------- karta w panelu lekcji: lista + formularz dodawania z przełącznikiem współpracy ---------- */
  function LessonCard(p) {
    var lesson = p.lesson; var list = A.useApi('/api/materials?lessonId=' + lesson.id, [lesson.id]);
    var st = React.useState({ open: false, file: null, name: '', description: '', coopAllowed: true, busy: false, error: null }); var f = st[0], set = st[1];
    var pick = function (e) {
      var file = e.target.files && e.target.files[0]; e.target.value = ''; if (!file) return;
      if (file.size > 20 * 1048576) { set(Object.assign({}, f, { error: t('mc.card.tooBig', { name: file.name, size: fileSize(file.size) }) })); return; }
      var fr = new FileReader(); fr.onload = function () { set(Object.assign({}, f, { error: null, file: { name: file.name, size: file.size, type: file.type || 'application/octet-stream', dataUrl: fr.result }, name: f.name || file.name.replace(/\.[^.]+$/, '') })); }; fr.readAsDataURL(file);
    };
    var save = function () {
      if (!f.file) return set(Object.assign({}, f, { error: t('mc.card.noFile') }));
      set(Object.assign({}, f, { busy: true, error: null }));
      A.api.post('/api/materials', { lessonId: lesson.id, name: f.name, type: f.file.type, dataUrl: f.file.dataUrl, size: f.file.size, coopAllowed: f.coopAllowed, description: f.description })
        .then(function () { A.toast(t('mc.card.saved'), 'success'); set({ open: false, file: null, name: '', description: '', coopAllowed: true, busy: false, error: null }); list.reload(); })
        .catch(function (e) { set(Object.assign({}, f, { busy: false, error: e.message })); });
    };
    var items = (list.data && list.data.materials) || [];
    return h('section', { className: 'card mt-4', 'aria-labelledby': 'h-materials' },
      h('div', { className: 'row', style: { justifyContent: 'space-between' } }, h('h2', { id: 'h-materials', style: { margin: 0 } }, t('mc.card.title')), !f.open ? h(E.Button, { size: 'sm', icon: 'plus', onClick: function () { set(Object.assign({}, f, { open: true })); } }, t('mc.card.add')) : null),
      items.length ? h('ul', { className: 'stack mt-4', style: { listStyle: 'none', margin: 'var(--space-3) 0 0', padding: 0, gap: 'var(--space-2)' } }, items.map(function (m) { return h('li', { key: m.id, className: 'row', style: { justifyContent: 'space-between' } }, h('div', null, h('b', null, m.name), h('div', { className: 'caption muted' }, fileSize(m.size) + ' · ' + plural(m.claimCount, 'mc.claims1', 'mc.claims'))), h('div', { className: 'row' }, h(CoopBadge, { material: m }), h(E.Button, { size: 'sm', onClick: function () { A.navigate('/wspolpraca', { m: m.id }); } }, t('mc.details')))); })) : h('p', { className: 'muted' }, list.loading ? t('mc.loading') : t('mc.card.none')),
      f.open ? h('div', { className: 'stack mt-4' },
        f.error ? h(E.Alert, { tone: 'danger' }, f.error) : null,
        h(E.TextField, { label: t('mc.card.file'), type: 'file', onChange: pick, hint: f.file ? f.file.name + ' · ' + fileSize(f.file.size) : undefined }),
        h(E.TextField, { label: t('mc.card.name'), value: f.name, required: true, onChange: function (e) { set(Object.assign({}, f, { name: e.target.value })); } }),
        h(E.TextField, { label: t('mc.desc'), multiline: 3, value: f.description, hint: t('mc.descHint'), onChange: function (e) { set(Object.assign({}, f, { description: e.target.value })); } }),
        h(E.Switch, { label: t('mc.coopSwitch'), checked: f.coopAllowed, hint: t('mc.card.coopHint'), onChange: function (v) { set(Object.assign({}, f, { coopAllowed: v })); } }),
        h('div', { className: 'row' }, h(E.Button, { variant: 'primary', loading: f.busy, disabled: !f.file || !f.name.trim(), onClick: save }, t('mc.card.save')), h(E.Button, { variant: 'quiet', onClick: function () { set(Object.assign({}, f, { open: false, error: null })); } }, t('common.cancel'))),
        h('p', { className: 'caption muted', style: { margin: 0 } }, t('mc.card.forStudents'))) : null);
  }

  /* ---------- ekran: eksplorator (nagłówek + liczniki + filtry) albo szczegóły ---------- */
  function Screen(props) {
    var id = props.route.query.m;
    var s1 = React.useState('all'), filter = s1[0], setFilter = s1[1];
    var s2 = React.useState(''), subj = s2[0], setSubj = s2[1];
    var all = A.useApi(id ? null : '/api/materials', [id]);
    if (id) return h(Detail, { id: id });
    var stats = (all.data && all.data.stats) || {}; var items = (all.data && all.data.materials) || [];
    var subjects = []; items.forEach(function (m) { if (m.subjectId && !subjects.some(function (s) { return s.value === m.subjectId; })) subjects.push({ value: m.subjectId, label: m.subject }); });
    var shown = items.filter(function (m) { return (filter === 'all' || (filter === 'open' && m.coopAllowed && !m.mine) || (filter === 'mine' && m.mine) || (filter === 'claimed' && m.claimedByMe)) && (!subj || m.subjectId === subj); });
    return h('div', null,
      h('h1', { className: 'display app-title' }, t('mc.title')),
      h('p', { className: 'app-sub', style: { maxWidth: '70ch', fontSize: '0.9375rem' } }, t('mc.def')),
      h('div', { className: 'grid-3 mb-4' },
        h(E.StatTile, { label: t('mc.stat.open'), value: String(stats.open != null ? stats.open : '—') }),
        h(E.StatTile, { label: t('mc.stat.mine'), value: String(stats.mine != null ? stats.mine : '—') }),
        h(E.StatTile, { label: t('mc.stat.claimed'), value: String(stats.claimed != null ? stats.claimed : '—') }),
        h(E.StatTile, { label: t('mc.stat.contributors'), value: String(stats.contributors != null ? stats.contributors : '—') })),
      h('div', { className: 'row mb-4', style: { justifyContent: 'space-between', alignItems: 'flex-end' } },
        h(E.Tabs, { label: t('mc.filters'), value: filter, onChange: setFilter, tabs: [{ id: 'all', label: t('mc.f.all'), count: items.length }, { id: 'open', label: t('mc.f.open'), count: stats.open }, { id: 'mine', label: t('mc.f.mine'), count: stats.mine }, { id: 'claimed', label: t('mc.f.claimed'), count: stats.claimed }] }),
        h(E.Select, { label: t('mc.subject'), value: subj, options: [{ value: '', label: t('mc.allSubjects') }].concat(subjects), onChange: function (e) { setSubj(e.target.value); } })),
      all.error ? h(E.Alert, { tone: 'danger' }, all.error.message) : null,
      all.loading && !items.length ? h('p', { className: 'muted' }, t('mc.loading')) : null,
      !all.loading && !shown.length ? h('p', { className: 'muted' }, t('mc.empty')) : null,
      h('div', { className: 'grid-3' }, shown.map(function (m) { return h(MaterialCard, { key: m.id, material: m }); })));
  }

  window.EdMaterials = { LessonCard: LessonCard, Detail: Detail };
  A.screen({ id: 'materials-coop', path: '/wspolpraca', title: 'Współpraca', roles: COOP_ROLES, module: 'logbook', nav: { key: 'nav.coop', label: 'Współpraca', order: 26 }, component: Screen });
})();
