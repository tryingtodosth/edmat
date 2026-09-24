/* Komentarze i notatki prywatne do wpisu dziennika/rejestru — wspólny panel dla wszystkich ekranów.
   Plik zaczyna się od "00-", więc w sklejonym app/screens.js ładuje się przed każdym ekranem.
   Użycie w ekranie:  h(window.EdLogComments.Panel, { kind: 'audit', entryId: row.id })
   albo zwinięty znacznik z licznikiem:  h(window.EdLogComments.Toggle, { kind, entryId, counts })  */
(function () {
  var React = window.React, h = React.createElement, E = window.EdMat, A = window.EdApp;

  window.EdI18n.add({
    pl: {
      'lc.title': 'Komentarze i notatki',
      'lc.empty': 'Brak komentarzy. Każdy, kto widzi ten wpis, może go skomentować.',
      'lc.loadError': 'Nie udało się wczytać komentarzy: {m}',
      'lc.placeholder': 'Napisz komentarz do tego wpisu…',
      'lc.private': 'Notatka prywatna (widzę tylko ja)',
      'lc.privateBadge': 'notatka prywatna',
      'lc.send': 'Dodaj',
      'lc.sending': 'Zapisywanie…',
      'lc.delete': 'Usuń',
      'lc.added': 'Komentarz dodany.',
      'lc.noteAdded': 'Notatka zapisana.',
      'lc.deleted': 'Usunięto.',
      'lc.opFailed': 'Nie udało się zapisać: {m}',
      'lc.toggle': 'Komentarze',
      'lc.count': '{n} kom.',
      'lc.notes': '{n} not.',
      'lc.hide': 'Zwiń komentarze',
      'lc.chars': '{n}/{max}'
    },
    en: {
      'lc.title': 'Comments and notes',
      'lc.empty': 'No comments yet. Anyone who can see this entry can comment on it.',
      'lc.loadError': 'Could not load comments: {m}',
      'lc.placeholder': 'Write a comment on this entry…',
      'lc.private': 'Private note (only I can see it)',
      'lc.privateBadge': 'private note',
      'lc.send': 'Add',
      'lc.sending': 'Saving…',
      'lc.delete': 'Delete',
      'lc.added': 'Comment added.',
      'lc.noteAdded': 'Note saved.',
      'lc.deleted': 'Deleted.',
      'lc.opFailed': 'Could not save: {m}',
      'lc.toggle': 'Comments',
      'lc.count': '{n} comments',
      'lc.notes': '{n} notes',
      'lc.hide': 'Hide comments',
      'lc.chars': '{n}/{max}'
    }
  });
  var t = function (k, v) { return A.t(k, v); };
  var msg = function (e) { return (e && e.message) || String(e); };

  function Panel(p) {
    var path = p.kind && p.entryId ? '/api/log-comments/' + encodeURIComponent(p.kind) + '/' + encodeURIComponent(p.entryId) : null;
    var q = A.useApi(path, [p.kind, p.entryId]);
    var st = React.useState({ text: '', priv: false, busy: false });
    var s = st[0], set = function (patch) { st[1](function (x) { return Object.assign({}, x, patch); }); };
    var max = (q.data && q.data.maxLength) || 2000;

    function submit(ev) {
      if (ev && ev.preventDefault) ev.preventDefault();
      var text = s.text.trim(); if (!text || s.busy) return;
      set({ busy: true });
      A.api.post(path, { text: text, private: s.priv }).then(function () {
        set({ text: '', busy: false }); A.toast(t(s.priv ? 'lc.noteAdded' : 'lc.added'), 'success'); q.reload();
        if (p.onChange) p.onChange();
      }).catch(function (e) { set({ busy: false }); A.toast(t('lc.opFailed', { m: msg(e) }), 'danger'); });
    }
    function remove(c) {
      A.api.delete(path + '/' + encodeURIComponent(c.id)).then(function () { A.toast(t('lc.deleted'), 'neutral'); q.reload(); if (p.onChange) p.onChange(); })
        .catch(function (e) { A.toast(t('lc.opFailed', { m: msg(e) }), 'danger'); });
    }

    var list = q.data ? q.data.comments : [];
    return h('section', { className: 'lc-panel', 'aria-label': t('lc.title'), style: { marginTop: 8, padding: '8px 12px', borderLeft: '3px solid var(--ed-border, #d9dee5)' } },
      p.hideTitle ? null : h('h4', { style: { margin: '0 0 6px', fontSize: 14 } }, t('lc.title')),
      q.error ? h(E.Alert, { tone: 'danger' }, t('lc.loadError', { m: msg(q.error) })) : null,
      !q.error && !q.loading && !list.length ? h('p', { className: 'lc-empty', style: { margin: '4px 0', opacity: 0.75, fontSize: 13 } }, t('lc.empty')) : null,
      list.length ? h('ul', { className: 'lc-list', style: { listStyle: 'none', margin: 0, padding: 0 } }, list.map(function (c) {
        return h('li', { key: c.id, className: 'lc-item' + (c.private ? ' lc-private' : ''), style: { padding: '6px 0', borderBottom: '1px solid var(--ed-border-subtle, #eef1f4)' } },
          h('div', { style: { display: 'flex', gap: 8, alignItems: 'center', fontSize: 12, opacity: 0.85 } },
            h('strong', null, c.author), h('span', null, A.fmtDateTime(c.at)),
            c.private ? h(E.Badge, { tone: 'warning' }, t('lc.privateBadge')) : null,
            c.mine ? h(E.Button, { variant: 'ghost', size: 'sm', onClick: function () { remove(c); }, 'aria-label': t('lc.delete') + ': ' + A.fmtDateTime(c.at) }, t('lc.delete')) : null),
          h('div', { style: { whiteSpace: 'pre-wrap', fontSize: 14, marginTop: 2 } }, c.text));
      })) : null,
      q.data && q.data.canComment ? h('form', { onSubmit: submit, style: { marginTop: 8, display: 'grid', gap: 6 } },
        h('textarea', { className: 'ed-textarea lc-text', rows: 2, maxLength: max, value: s.text, placeholder: t('lc.placeholder'), 'aria-label': t('lc.placeholder'), disabled: s.busy, onChange: function (ev) { set({ text: ev.target.value }); }, style: { width: '100%', font: 'inherit', padding: 8, borderRadius: 6, border: '1px solid var(--ed-border, #c9d1da)' } }),
        h('div', { style: { display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' } },
          h(E.Checkbox, { label: t('lc.private'), checked: s.priv, onChange: function (ev) { set({ priv: !!(ev && ev.target ? ev.target.checked : ev) }); } }),
          h('span', { style: { fontSize: 12, opacity: 0.7, marginLeft: 'auto' } }, t('lc.chars', { n: s.text.length, max: max })),
          h(E.Button, { type: 'submit', variant: s.priv ? 'secondary' : 'primary', size: 'sm', disabled: s.busy || !s.text.trim() }, t(s.busy ? 'lc.sending' : 'lc.send')))) : null);
  }

  /** Zwinięty przycisk pod wierszem listy; `counts` = {comments, notes} z serwera (opcjonalnie). */
  function Toggle(p) {
    var st = React.useState(!!p.open); var open = st[0];
    var c = p.counts || {};
    var label = t('lc.toggle') + (c.comments ? ' · ' + t('lc.count', { n: c.comments }) : '') + (c.notes ? ' · ' + t('lc.notes', { n: c.notes }) : '');
    return h('div', { className: 'lc-toggle' },
      h(E.Button, { variant: 'ghost', size: 'sm', 'aria-expanded': open, onClick: function () { st[1](!open); } }, open ? t('lc.hide') : label),
      open ? h(Panel, { kind: p.kind, entryId: p.entryId, hideTitle: true, onChange: p.onChange }) : null);
  }

  window.EdLogComments = { Panel: Panel, Toggle: Toggle };
})();
