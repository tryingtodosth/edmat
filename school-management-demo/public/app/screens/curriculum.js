/* Podstawa programowa (GAP-2): lista punktów podstawy, wklejenie arkusza jako CSV i okno
   dodawania/edycji pojedynczego punktu. Nauczyciel prowadzi przedmioty, których uczy; dyrekcja
   i administrator — całą szkołę. Ekran jest jedyną drogą wypełnienia pustej instalacji, więc
   trzyma przy sobie opis formatu z serwera (GET /api/curriculum/format). */
(function () {
  var E = window.EdMat, A = window.EdApp, h = React.createElement, F = React.Fragment;

  window.EdI18n.add({
    pl: {
      'cu.title': 'Podstawa programowa',
      'cu.sub': 'Punkty podstawy, z którymi nauczyciel wiąże temat lekcji. Bez nich realizacja podstawy nie ma czego liczyć.',
      'cu.empty': 'Podstawa programowa jest pusta',
      'cu.emptyText': 'Wklej arkusz z wydawnictwa albo dodaj pierwszy punkt ręcznie — to zajmuje kilka minut i uruchamia wiązanie tematów lekcji z podstawą oraz ekran realizacji podstawy dla dyrekcji.',
      'cu.filters': 'Zawężenie listy',
      'cu.subject': 'Przedmiot', 'cu.level': 'Poziom klasy', 'cu.allSubjects': 'Wszystkie przedmioty', 'cu.allLevels': 'Wszystkie poziomy',
      'cu.levelN': 'klasa {n}',
      'cu.tableCap': 'Punkty podstawy programowej',
      'cu.col.code': 'Kod', 'cu.col.title': 'Wymaganie', 'cu.col.hours': 'Godziny', 'cu.col.linked': 'Lekcje', 'cu.col.actions': 'Działanie',
      'cu.hours': '{n} godz.',
      'cu.linkedN': 'powiązane lekcje: {n}',
      'cu.add': 'Dodaj punkt', 'cu.editItem': 'Edytuj punkt {code}', 'cu.deleteItem': 'Usuń punkt {code}',
      'cu.dlg.addTitle': 'Nowy punkt podstawy', 'cu.dlg.editTitle': 'Punkt podstawy {code}',
      'cu.f.subject': 'Przedmiot', 'cu.f.level': 'Poziom klasy', 'cu.f.code': 'Kod punktu', 'cu.f.title': 'Treść wymagania', 'cu.f.hours': 'Planowane godziny',
      'cu.f.codeHint': 'Oznaczenie z rozporządzenia, np. I.1 albo VIII.2.',
      'cu.f.hoursHint': 'Liczba godzin przewidziana na to wymaganie; 0, gdy szkoła jej nie planuje.',
      'cu.saved': 'Punkt zapisany.', 'cu.deleted': 'Punkt usunięty; odpięto go od {n} lekcji.',
      'cu.confirmDelete': 'Usunąć punkt {code}?',
      'cu.confirmDeleteText': 'Punkt zniknie z listy i zostanie odpięty od tematów lekcji, w których go wpisano. Rejestr zmian zachowa jego treść.',
      'cu.importTitle': 'Wklej arkusz (CSV)',
      'cu.importHint': 'Kolumny {cols}, rozdzielone średnikiem. Wiersz nagłówka jest opcjonalny.',
      'cu.importPh': 'subject;level;code;title;hours',
      'cu.check': 'Sprawdź bez zapisywania', 'cu.apply': 'Zapisz podstawę',
      'cu.dryResult': 'Próbny przebieg: nowych {created}, aktualizowanych {updated}, pominiętych {skipped}.',
      'cu.applyResult': 'Zapisano: nowych {created}, aktualizowanych {updated}.',
      'cu.importErrors': 'Wiersze do poprawy',
      'cu.errLine': 'wiersz {line}: {error}',
      'cu.format': 'Format arkusza', 'cu.formatExample': 'Przykład',
      'cu.duplicatesNote': 'Wiersz o tym samym przedmiocie, poziomie i kodzie aktualizuje istniejący punkt — nie powstaje drugi taki sam.',
      'cu.noSubjects': 'Brak przedmiotów do prowadzenia',
      'cu.noSubjectsText': 'To konto nie uczy żadnego przedmiotu, więc nie ma podstawy do prowadzenia. Poproś dyrekcję albo administratora.',
      'cu.failed': 'Nie udało się zapisać podstawy programowej.',
      'cu.loading': 'Wczytywanie podstawy programowej…'
    },
    en: {
      'cu.title': 'National curriculum',
      'cu.sub': 'The curriculum points a teacher links a lesson topic to. Without them there is nothing for curriculum coverage to count.',
      'cu.empty': 'The curriculum is empty',
      'cu.emptyText': 'Paste the publisher’s sheet or add the first point by hand — it takes a few minutes and switches on both the topic-to-curriculum link and the principal’s coverage screen.',
      'cu.filters': 'Narrow the list',
      'cu.subject': 'Subject', 'cu.level': 'Class level', 'cu.allSubjects': 'All subjects', 'cu.allLevels': 'All levels',
      'cu.levelN': 'class {n}',
      'cu.tableCap': 'Curriculum points',
      'cu.col.code': 'Code', 'cu.col.title': 'Requirement', 'cu.col.hours': 'Hours', 'cu.col.linked': 'Lessons', 'cu.col.actions': 'Action',
      'cu.hours': '{n} h',
      'cu.linkedN': 'linked lessons: {n}',
      'cu.add': 'Add a point', 'cu.editItem': 'Edit point {code}', 'cu.deleteItem': 'Delete point {code}',
      'cu.dlg.addTitle': 'New curriculum point', 'cu.dlg.editTitle': 'Curriculum point {code}',
      'cu.f.subject': 'Subject', 'cu.f.level': 'Class level', 'cu.f.code': 'Point code', 'cu.f.title': 'Requirement text', 'cu.f.hours': 'Planned hours',
      'cu.f.codeHint': 'The code from the ministry regulation, e.g. I.1 or VIII.2.',
      'cu.f.hoursHint': 'Hours planned for this requirement; 0 when the school does not plan any.',
      'cu.saved': 'Point saved.', 'cu.deleted': 'Point deleted; it was unlinked from {n} lessons.',
      'cu.confirmDelete': 'Delete point {code}?',
      'cu.confirmDeleteText': 'The point leaves the list and is unlinked from the lesson topics that referenced it. The audit log keeps its text.',
      'cu.importTitle': 'Paste a sheet (CSV)',
      'cu.importHint': 'Columns {cols}, separated by a semicolon. The header row is optional.',
      'cu.importPh': 'subject;level;code;title;hours',
      'cu.check': 'Check without saving', 'cu.apply': 'Save the curriculum',
      'cu.dryResult': 'Dry run: {created} new, {updated} updated, {skipped} skipped.',
      'cu.applyResult': 'Saved: {created} new, {updated} updated.',
      'cu.importErrors': 'Rows to fix',
      'cu.errLine': 'row {line}: {error}',
      'cu.format': 'Sheet format', 'cu.formatExample': 'Example',
      'cu.duplicatesNote': 'A row with the same subject, level and code updates the existing point — no duplicate is created.',
      'cu.noSubjects': 'No subjects to maintain',
      'cu.noSubjectsText': 'This account teaches no subject, so it has no curriculum to maintain. Ask the principal or an administrator.',
      'cu.failed': 'The curriculum could not be saved.',
      'cu.loading': 'Loading the curriculum…'
    }
  });

  var t = function (k, v) { return A.t(k, v); };
  var err = function (e) { A.toast((e && e.message) || t('cu.failed'), 'danger'); };
  var LEVELS = [1, 2, 3, 4, 5, 6, 7, 8];

  /* ---------------- okno dodawania i edycji pojedynczego punktu ---------------- */
  function ItemDialog(p) {
    var init = p.item || { subjectId: (p.subjects[0] || {}).id || '', level: 7, code: '', title: '', hours: 0 };
    var s1 = React.useState({
      subjectId: init.subjectId, level: String(init.level), code: init.code, title: init.title, hours: String(init.hours == null ? 0 : init.hours)
    });
    var f = s1[0], set = s1[1];
    var upd = function (k) { return function (ev) { var o = {}; o[k] = ev.target.value; set(Object.assign({}, f, o)); }; };
    var valid = f.subjectId && f.code.trim() && f.title.trim();
    function save() {
      var body = { subjectId: f.subjectId, level: Number(f.level), code: f.code.trim(), title: f.title.trim(), hours: Number(f.hours || 0) };
      var call = p.item ? A.api.patch('/api/curriculum/' + p.item.id, body) : A.api.post('/api/curriculum', body);
      call.then(function () { A.toast(t('cu.saved'), 'success'); p.onDone(); }).catch(err);
    }
    return h(E.Dialog, {
      title: p.item ? t('cu.dlg.editTitle', { code: p.item.code }) : t('cu.dlg.addTitle'),
      onClose: p.onClose, initialFocus: '[data-autofocus]',
      actions: [
        h(E.Button, { key: 'c', variant: 'secondary', onClick: p.onClose }, t('common.cancel')),
        h(E.Button, { key: 'o', variant: 'primary', icon: 'check', disabled: !valid, onClick: save }, t('common.save'))]
    },
      h('div', { className: 'grid-2' },
        h(E.Select, {
          label: t('cu.f.subject'), value: f.subjectId, onChange: upd('subjectId'),
          options: p.subjects.map(function (x) { return { value: x.id, label: A.subjectName(x.id, x.name) }; })
        }),
        h(E.Select, {
          label: t('cu.f.level'), value: f.level, onChange: upd('level'),
          options: LEVELS.map(function (n) { return { value: String(n), label: t('cu.levelN', { n: n }) }; })
        })),
      h(E.TextField, { label: t('cu.f.code'), required: true, 'data-autofocus': true, mono: true, value: f.code, hint: t('cu.f.codeHint'), placeholder: 'I.1', onChange: upd('code') }),
      h(E.TextField, { label: t('cu.f.title'), required: true, multiline: 2, value: f.title, onChange: upd('title') }),
      h(E.TextField, { label: t('cu.f.hours'), value: f.hours, hint: t('cu.f.hoursHint'), inputMode: 'numeric', onChange: upd('hours') }));
  }

  /* ---------------- wklejony arkusz: najpierw próbny przebieg, potem zapis ---------------- */
  function ImportCard(p) {
    var s1 = React.useState(''), csv = s1[0], setCsv = s1[1];
    var s2 = React.useState(null), res = s2[0], setRes = s2[1];
    var cols = (p.format && p.format.columns ? p.format.columns.map(function (c) { return c.name; }) : ['subject', 'level', 'code', 'title', 'hours']).join(';');
    function send(dry) {
      A.api.post('/api/curriculum/import', { csv: csv, dryRun: !!dry })
        .then(function (r) {
          setRes(r);
          if (!dry) { A.toast(r.confirmation || t('cu.saved'), 'success'); setCsv(''); p.onDone(); }
        })
        .catch(function (e) { setRes((e && e.extra) || null); err(e); });
    }
    return h('section', { className: 'card', 'aria-labelledby': 'h-cu-import' },
      h('h2', { id: 'h-cu-import' }, t('cu.importTitle')),
      h(E.TextField, {
        label: t('cu.importTitle'), multiline: 6, mono: true, value: csv,
        placeholder: t('cu.importPh'), hint: t('cu.importHint', { cols: cols }),
        onChange: function (ev) { setCsv(ev.target.value); }
      }),
      h('div', { className: 'row mt-4' },
        h(E.Button, { variant: 'secondary', icon: 'eye', disabled: !csv.trim(), onClick: function () { send(true); } }, t('cu.check')),
        h(E.Button, { variant: 'primary', icon: 'upload', disabled: !csv.trim(), onClick: function () { send(false); } }, t('cu.apply'))),
      h('p', { className: 'caption muted', role: 'status', 'aria-live': 'polite' },
        res
          ? (res.dryRun
            ? t('cu.dryResult', { created: res.created || 0, updated: res.updated || 0, skipped: res.skipped || 0 })
            : t('cu.applyResult', { created: res.created || 0, updated: res.updated || 0 }))
          : t('cu.duplicatesNote')),
      res && res.errors && res.errors.length
        ? h(E.Alert, { tone: 'warning', title: t('cu.importErrors') },
          h('ul', { className: 'stack' }, res.errors.slice(0, 10).map(function (x, i) {
            return h('li', { key: i }, t('cu.errLine', { line: x.line, error: x.error }));
          })))
        : null,
      p.format ? h('details', null,
        h('summary', null, t('cu.format')),
        h('ul', { className: 'stack' }, (p.format.columns || []).map(function (c) {
          return h('li', { key: c.name }, h('code', null, c.name), ' — ' + c.desc);
        })),
        h('p', { className: 'caption muted' }, t('cu.formatExample')),
        h('pre', { className: 'ed-mono', style: { whiteSpace: 'pre-wrap' } }, p.format.example)) : null);
  }

  /* ---------------- ekran ---------------- */
  A.screen({
    id: 'curriculum', path: '/podstawa', title: 'Podstawa programowa', module: 'logbook',
    roles: ['teacher', 'principal', 'admin'],
    nav: { key: 'nav.curriculum', label: 'Podstawa', order: 15 },
    component: function CurriculumScreen(props) {
      /* Wejście z dziennika lekcyjnego („#/podstawa?subjectId=mat”) otwiera od razu ten przedmiot. */
      var fromLesson = (props.route && props.route.query && props.route.query.subjectId) || '';
      var s1 = React.useState(fromLesson), subject = s1[0], setSubject = s1[1];
      var s2 = React.useState(''), level = s2[0], setLevel = s2[1];
      var s3 = React.useState(null), dialog = s3[0], setDialog = s3[1];
      var s4 = React.useState(null), confirm = s4[0], setConfirm = s4[1];
      var query = (subject ? 'subjectId=' + encodeURIComponent(subject) : '') + (level ? (subject ? '&' : '') + 'level=' + level : '');
      var list = A.useApi('/api/curriculum' + (query ? '?' + query : ''), [subject, level]);
      var format = A.useApi('/api/curriculum/format', []);
      var d = list.data;
      var subjects = (d && d.subjects) || [];
      var items = (d && d.items) || [];

      function remove(item) {
        A.api.delete('/api/curriculum/' + item.id)
          .then(function (r) { setConfirm(null); A.toast(t('cu.deleted', { n: r.unlinkedLessons }), 'success'); list.reload(); })
          .catch(function (e) { setConfirm(null); err(e); });
      }

      return h('div', { className: 'stack' },
        h('div', null,
          h('h1', { className: 'display app-title' }, t('cu.title')),
          h('p', { className: 'app-sub' }, t('cu.sub'))),
        list.error ? h(E.Alert, { tone: 'danger' }, list.error.message) : null,
        !list.loading && d && !subjects.length
          ? h(E.Alert, { tone: 'info', title: t('cu.noSubjects') }, t('cu.noSubjectsText'))
          : null,
        h('section', { className: 'card', 'aria-labelledby': 'h-cu-list' },
          h('h2', { id: 'h-cu-list' }, t('cu.tableCap')),
          h('div', { className: 'grid-3' },
            h(E.Select, {
              label: t('cu.subject'), value: subject, placeholder: t('cu.allSubjects'),
              options: subjects.map(function (x) { return { value: x.id, label: A.subjectName(x.id, x.name) }; }),
              onChange: function (ev) { setSubject(ev.target.value); }
            }),
            h(E.Select, {
              label: t('cu.level'), value: level, placeholder: t('cu.allLevels'),
              options: LEVELS.map(function (n) { return { value: String(n), label: t('cu.levelN', { n: n }) }; }),
              onChange: function (ev) { setLevel(ev.target.value); }
            }),
            h('div', { className: 'row' },
              h(E.Button, {
                variant: 'primary', icon: 'plus', disabled: !subjects.length,
                onClick: function () { setDialog({ item: null }); }
              }, t('cu.add')))),
          list.loading ? h('p', { className: 'muted', 'aria-live': 'polite' }, t('cu.loading')) : null,
          !list.loading && !items.length
            ? h(E.Alert, { tone: 'info', title: t('cu.empty') }, t('cu.emptyText'))
            : null,
          items.length ? h(E.Table, {
            caption: t('cu.tableCap'), stack: true,
            columns: [
              { key: 'subjectName', title: t('cu.col.code'), render: function (r) { return h(F, null, h('span', { className: 'ed-mono' }, r.code), h('div', { className: 'caption muted' }, A.subjectName(r.subjectId, r.subjectName) + ' · ' + t('cu.levelN', { n: r.level }))); } },
              { key: 'title', title: t('cu.col.title') },
              { key: 'hours', title: t('cu.col.hours'), num: true, render: function (r) { return t('cu.hours', { n: r.hours }); } },
              { key: 'lessonsLinked', title: t('cu.col.linked'), num: true, render: function (r) { return h(E.Badge, { tone: r.lessonsLinked ? 'success' : 'outline' }, String(r.lessonsLinked)); } },
              { key: 'actions', title: t('cu.col.actions'), render: function (r) {
                return h('div', { className: 'row' },
                  h(E.Button, { size: 'sm', variant: 'quiet', icon: 'edit', 'aria-label': t('cu.editItem', { code: r.code }), onClick: function () { setDialog({ item: r }); } }, t('common.edit')),
                  h(E.Button, { size: 'sm', variant: 'quiet', icon: 'trash', 'aria-label': t('cu.deleteItem', { code: r.code }), onClick: function () { setConfirm(r); } }, t('common.delete')));
              } }],
            rows: items
          }) : null),
        h(ImportCard, { format: format.data, onDone: function () { list.reload(); } }),
        dialog ? h(ItemDialog, {
          item: dialog.item, subjects: subjects,
          onClose: function () { setDialog(null); },
          onDone: function () { setDialog(null); list.reload(); }
        }) : null,
        confirm ? h(E.Dialog, {
          title: t('cu.confirmDelete', { code: confirm.code }),
          onClose: function () { setConfirm(null); },
          actions: [
            h(E.Button, { key: 'c', variant: 'secondary', onClick: function () { setConfirm(null); } }, t('common.cancel')),
            h(E.Button, { key: 'o', variant: 'danger', icon: 'trash', onClick: function () { remove(confirm); } }, t('common.delete'))]
        }, h('p', null, t('cu.confirmDeleteText')),
          h('p', { className: 'caption muted' }, t('cu.linkedN', { n: confirm.lessonsLinked || 0 }))) : null);
    }
  });
})();
