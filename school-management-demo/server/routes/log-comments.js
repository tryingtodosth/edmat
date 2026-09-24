'use strict';
/* Komentarze i notatki prywatne do wpisów dowolnego dziennika/rejestru — patrz lib/log-access.js.
   • komentarz (`private: false`) widzi każdy, kto widzi wpis;
   • notatka prywatna (`private: true`) — wyłącznie autor;
   • pisać może każdy, kto widzi wpis; usuwać (miękko) — tylko autor;
   • dodanie i usunięcie trafia do rejestru zdarzeń, bo komentarz do dokumentacji sam jest dokumentacją. */
const { httpError } = require('../lib/router');
const LA = require('../lib/log-access');
const D = require('../lib/domain');
const { id, now } = require('../lib/util');

const MAX_TEXT = 2000;

function view(db, c, user) {
  const u = db.get('users', c.userId);
  return { id: c.id, kind: c.kind, entryId: c.entryId, at: c.at, text: c.text, private: !!c.private, userId: c.userId, author: u ? D.userLabel(u) : 'system', role: u ? u.role : null, mine: c.userId === user.id };
}
/** Komentarze wpisu widoczne dla użytkownika: cudze publiczne + własne (także prywatne). */
function visibleFor(db, user, kind, entryId) {
  return db.col('logComments').filter((c) => c.kind === kind && c.entryId === entryId && !c.deleted && (!c.private || c.userId === user.id)).sort((a, b) => (a.at < b.at ? -1 : 1));
}
/** Liczniki do list (np. „2 komentarze · 1 notatka”) — dla ekranów, które chcą pokazać znacznik przy wierszu. */
function countsFor(db, user, kind, entryIds) {
  const out = {}; for (const e of entryIds) out[e] = { comments: 0, notes: 0 };
  for (const c of db.col('logComments')) {
    if (c.kind !== kind || c.deleted || !out[c.entryId]) continue;
    if (c.private) { if (c.userId === user.id) out[c.entryId].notes++; } else out[c.entryId].comments++;
  }
  return out;
}

function register(r) {
  r.get('/api/log-comments/kinds', (ctx) => ({ kinds: LA.kinds() }));

  r.get('/api/log-comments/:kind/:entryId', (ctx) => {
    const { kind } = LA.resolve(ctx.db, ctx.user, ctx.params.kind, ctx.params.entryId);
    return { kind: kind.kind, label: kind.label, entryId: ctx.params.entryId, canComment: true, maxLength: MAX_TEXT, comments: visibleFor(ctx.db, ctx.user, kind.kind, ctx.params.entryId).map((c) => view(ctx.db, c, ctx.user)) };
  });

  r.post('/api/log-comments/:kind/:entryId', (ctx) => {
    const { kind } = LA.resolve(ctx.db, ctx.user, ctx.params.kind, ctx.params.entryId);
    const text = String((ctx.body && ctx.body.text) || '').trim();
    if (!text) throw httpError(400, 'Treść komentarza nie może być pusta.', { code: 'empty_text' });
    if (text.length > MAX_TEXT) throw httpError(400, `Komentarz może mieć najwyżej ${MAX_TEXT} znaków.`, { code: 'text_too_long', maxLength: MAX_TEXT });
    const c = { id: id('lc'), kind: kind.kind, entryId: ctx.params.entryId, userId: ctx.user.id, at: now(), text, private: !!(ctx.body && ctx.body.private), deleted: false };
    ctx.db.col('logComments').push(c); ctx.db.save();
    ctx.audit({ action: c.private ? 'log_note_added' : 'log_comment_added', entity: 'logComments', entityId: c.id, after: { kind: c.kind, entryId: c.entryId, private: c.private, length: text.length } });
    return { ok: true, comment: view(ctx.db, c, ctx.user) };
  });

  r.delete('/api/log-comments/:kind/:entryId/:id', (ctx) => {
    LA.resolve(ctx.db, ctx.user, ctx.params.kind, ctx.params.entryId);
    const c = ctx.db.get('logComments', ctx.params.id);
    if (!c || c.deleted || c.kind !== ctx.params.kind || c.entryId !== ctx.params.entryId) throw httpError(404, 'Nie znaleziono komentarza.', { code: 'comment_not_found' });
    if (c.userId !== ctx.user.id) throw httpError(403, 'Usunąć komentarz może tylko jego autor.', { code: 'not_author' });
    ctx.db.update('logComments', c.id, { deleted: true, deletedAt: now() });
    ctx.audit({ action: c.private ? 'log_note_deleted' : 'log_comment_deleted', entity: 'logComments', entityId: c.id, before: { kind: c.kind, entryId: c.entryId, private: !!c.private } });
    return { ok: true };
  });
}

module.exports = { register, visibleFor, countsFor, MAX_TEXT };
