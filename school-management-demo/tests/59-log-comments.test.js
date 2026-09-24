'use strict';
/* Wspólny mechanizm komentarzy do wpisów dzienników (lib/log-access + routes/log-comments).
   Rejestr testowy „probe” udaje dziennik, którego wpisy widzi dyrektor i wychowawca klasy wpisu. */
const test = require('node:test'); const assert = require('node:assert/strict');
const { startServer, expectOk } = require('./helpers');
const LA = require('../server/lib/log-access');

LA.register('probe', { label: 'Rejestr próbny', roles: ['principal', 'homeroom'], find: (db, user, id) => {
  const m = /^probe-(\w+)$/.exec(id); if (!m) return null;
  return user.role === 'principal' || user.homeroomOf === m[1] ? { id, classId: m[1] } : null;
} });

let S, P, H7b, H7a, PARENT;
test.before(async () => { S = await startServer(); P = await S.as('dyrektor'); H7b = await S.as('j.nowak'); H7a = await S.as('b.sikora'); PARENT = await S.as('rodzic.mazurek'); });
test.after(() => S.close());

test('rodzaje dzienników są wyliczalne, nieznany rodzaj → 404', async () => {
  const k = expectOk(await P.get('/api/log-comments/kinds'));
  assert.ok(k.kinds.includes('probe'));
  const r = await P.get('/api/log-comments/nope/x'); assert.equal(r.status, 404); assert.equal(r.body.code, 'unknown_log_kind');
});

test('komentuje każdy, kto widzi wpis; kto nie widzi — 403 (rola) albo 404 (zakres)', async () => {
  const c = expectOk(await H7b.post('/api/log-comments/probe/probe-7b', { text: '  Sprawdzone z sekretariatem.  ' }));
  assert.equal(c.comment.text, 'Sprawdzone z sekretariatem.'); assert.equal(c.comment.private, false); assert.equal(c.comment.mine, true);
  const seenByP = expectOk(await P.get('/api/log-comments/probe/probe-7b'));
  assert.equal(seenByP.comments.length, 1); assert.equal(seenByP.comments[0].mine, false); assert.equal(seenByP.comments[0].author.includes('Nowak'), true);
  const other = await H7a.get('/api/log-comments/probe/probe-7b'); assert.equal(other.status, 404);   // wychowawca innej klasy
  const parent = await PARENT.get('/api/log-comments/probe/probe-7b'); assert.equal(parent.status, 403); // rola spoza rejestru
  const noText = await P.post('/api/log-comments/probe/probe-7b', { text: '   ' }); assert.equal(noText.status, 400);
  const tooLong = await P.post('/api/log-comments/probe/probe-7b', { text: 'x'.repeat(2001) }); assert.equal(tooLong.status, 400); assert.equal(tooLong.body.code, 'text_too_long');
});

test('notatka prywatna: widzi ją tylko autor, także w rejestrze zdarzeń jest tylko metadana', async () => {
  const n = expectOk(await P.post('/api/log-comments/probe/probe-7b', { text: 'Zapytać IOD o podstawę.', private: true }));
  assert.equal(n.comment.private, true);
  const mine = expectOk(await P.get('/api/log-comments/probe/probe-7b'));
  assert.ok(mine.comments.some((c) => c.id === n.comment.id));
  const theirs = expectOk(await H7b.get('/api/log-comments/probe/probe-7b'));
  assert.ok(!theirs.comments.some((c) => c.id === n.comment.id));
  const a = S.db.col('audit').find((e) => e.action === 'log_note_added' && e.entityId === n.comment.id);
  assert.ok(a); assert.equal(JSON.stringify(a).includes('Zapytać IOD'), false);
});

test('usuwa tylko autor; usunięcie jest miękkie i zaudytowane', async () => {
  const c = expectOk(await H7b.post('/api/log-comments/probe/probe-7b', { text: 'Do usunięcia.' }));
  const byOther = await P.delete('/api/log-comments/probe/probe-7b/' + c.comment.id); assert.equal(byOther.status, 403); assert.equal(byOther.body.code, 'not_author');
  expectOk(await H7b.delete('/api/log-comments/probe/probe-7b/' + c.comment.id));
  const after = expectOk(await P.get('/api/log-comments/probe/probe-7b')); assert.ok(!after.comments.some((x) => x.id === c.comment.id));
  const row = S.db.get('logComments', c.comment.id); assert.equal(row.deleted, true); assert.ok(row.text);
  assert.ok(S.db.col('audit').some((e) => e.action === 'log_comment_deleted' && e.entityId === c.comment.id));
  const again = await H7b.delete('/api/log-comments/probe/probe-7b/' + c.comment.id); assert.equal(again.status, 404);
});

test('countsFor liczy cudze komentarze i tylko własne notatki', async () => {
  const { countsFor } = require('../server/routes/log-comments');
  const p = S.db.col('users').find((u) => u.login === 'dyrektor'); const h = S.db.col('users').find((u) => u.login === 'j.nowak');
  const forP = countsFor(S.db, p, 'probe', ['probe-7b']); const forH = countsFor(S.db, h, 'probe', ['probe-7b']);
  assert.equal(forP['probe-7b'].notes, 1); assert.equal(forH['probe-7b'].notes, 0);
  assert.equal(forP['probe-7b'].comments, forH['probe-7b'].comments);
});
