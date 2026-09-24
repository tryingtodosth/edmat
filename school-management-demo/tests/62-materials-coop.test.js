'use strict';
/* Współpraca nad materiałami z lekcji (routes/materials.js) — na wzór strony treści w 2donet: materiał ma właściciela,
   flagę `coopAllowed` (domyślnie tak), zgłoszenia współpracowników („claim”), dyskusję przez log-comments i oś czasu
   z rejestru zdarzeń. Plik i pobieranie zostają w routes/student.js i nie zmieniają się. */
const test = require('node:test'); const assert = require('node:assert/strict');
const { startServer, expectOk } = require('./helpers');
let S, NOWAK, WOJCIK, KROL, DYR, SEK, ANNA;
test.before(async () => { S = await startServer(); [NOWAK, WOJCIK, KROL, DYR, SEK, ANNA] = await Promise.all(['j.nowak', 'a.wojcik', 'e.krol', 'dyrektor', 'sekretariat', 'anna.kowalczyk'].map((l) => S.as(l))); });
test.after(() => S.close());

test('the cooperation list shows metadata only, with owner, claims, comments and per-viewer flags', async () => {
  const r = expectOk(await NOWAK.get('/api/materials'));
  assert.ok(r.stats.total >= 4); assert.ok(r.stats.mine >= 1); assert.equal(typeof r.stats.contributors, 'number');
  for (const m of r.materials) { assert.equal(m.dataUrl, undefined, 'no file bytes in the list'); assert.equal(typeof m.coopAllowed, 'boolean'); assert.ok(m.owner && m.owner.name); }
  const seed = r.materials.find((m) => m.id === 'st_mt_mat');
  assert.equal(seed.coopAllowed, true); assert.equal(seed.mine, true); assert.equal(seed.canClaim, false, 'the owner does not claim her own material');
  assert.equal(seed.claims.length, 1); assert.equal(seed.claims[0].user.id, 'u_wojcik'); assert.match(seed.claims[0].note, /klucz odpowiedzi/);
  assert.equal(seed.commentCount, 1); assert.match(seed.description, /Karta pracy/); assert.equal(seed.subject, 'Matematyka');
  const open = expectOk(await NOWAK.get('/api/materials?filter=open')); assert.ok(open.materials.every((m) => m.coopAllowed && !m.mine));
  const mine = expectOk(await WOJCIK.get('/api/materials?filter=claimed')); assert.ok(mine.materials.some((m) => m.id === 'st_mt_mat' && m.claimedByMe));
  assert.equal((await SEK.get('/api/materials')).status, 403, 'the registrar does not cooperate on teaching materials');
  assert.equal((await ANNA.get('/api/materials')).status, 403);
});

test('a teacher claims a material with a note, the owner is notified, a second claim and an own claim are refused, a claim can be released', async () => {
  const c = expectOk(await KROL.post('/api/materials/st_mt_mat/claim', { note: '  Przetłumaczę polecenia dla grupy z j. angielskim jako wsparciem.  ' }));
  assert.equal(c.material.claimedByMe, true); assert.equal(c.material.claims.length, 2); assert.equal(c.material.claims[1].note, 'Przetłumaczę polecenia dla grupy z j. angielskim jako wsparciem.');
  const again = await KROL.post('/api/materials/st_mt_mat/claim', {}); assert.equal(again.status, 409); assert.equal(again.body.code, 'already_claimed');
  const own = await NOWAK.post('/api/materials/st_mt_mat/claim', {}); assert.equal(own.status, 409); assert.equal(own.body.code, 'own_material');
  const n = S.db.col('notifications').find((x) => x.userId === 'u_nowak' && x.kind === 'material'); assert.ok(n, 'owner notified'); assert.equal(n.link, '#/wspolpraca?m=st_mt_mat'); assert.match(n.text, /Król/);
  assert.ok(S.db.col('audit').some((a) => a.action === 'material_claimed' && a.entityId === 'st_mt_mat' && a.userId === 'u_krol'));
  const rel = expectOk(await KROL.delete('/api/materials/st_mt_mat/claim')); assert.equal(rel.material.claimedByMe, false); assert.equal(rel.material.claims.length, 1);
  const relAgain = await KROL.delete('/api/materials/st_mt_mat/claim'); assert.equal(relAgain.status, 404); assert.equal(relAgain.body.code, 'no_claim');
});

test('only the owner or the principal changes coopAllowed; a closed material refuses new claims; the timeline records it', async () => {
  const forbidden = await KROL.patch('/api/materials/st_mt_fiz', { coopAllowed: false }); assert.equal(forbidden.status, 403);
  const closed = expectOk(await WOJCIK.patch('/api/materials/st_mt_fiz', { coopAllowed: false, description: 'Prezentacja z prawa Ohma, 14 slajdów.' }));
  assert.equal(closed.material.coopAllowed, false); assert.equal(closed.material.description, 'Prezentacja z prawa Ohma, 14 slajdów.');
  const refused = await KROL.post('/api/materials/st_mt_fiz/claim', { note: 'x' }); assert.equal(refused.status, 409); assert.equal(refused.body.code, 'coop_closed');
  const reopened = expectOk(await DYR.patch('/api/materials/st_mt_fiz', { coopAllowed: true })); assert.equal(reopened.material.coopAllowed, true);
  const noName = await WOJCIK.patch('/api/materials/st_mt_fiz', { name: '   ' }); assert.equal(noName.status, 400);
  const d = expectOk(await KROL.get('/api/materials/st_mt_fiz/details'));
  assert.equal(d.dataUrl, undefined); assert.equal(typeof d.downloads, 'number'); assert.equal(d.commentsPath, '/api/log-comments/materials/st_mt_fiz');
  const actions = d.timeline.map((x) => x.action);
  assert.equal(actions[0], 'material_uploaded', 'the upload opens the timeline even for seeded rows');
  assert.equal(actions.filter((a) => a === 'material_updated').length, 2);
  assert.ok(d.timeline.some((x) => x.action === 'material_updated' && x.coopAllowed === false && x.user.id === 'u_wojcik'));
  assert.equal(d.canClaim, true);
});

test('a new upload is open for cooperation by default and can be closed at upload time', async () => {
  const lesson = S.db.col('lessons').find((l) => l.teacherId === 'u_nowak');
  const a = expectOk(await NOWAK.post('/api/materials', { lessonId: lesson.id, name: 'Ułamki – zadania', type: 'text/plain', dataUrl: 'data:text/plain;base64,eA==', description: 'Do sprawdzenia przez drugiego matematyka.' }));
  assert.equal(a.material.coopAllowed, true); assert.equal(a.material.description, 'Do sprawdzenia przez drugiego matematyka.');
  const b = expectOk(await NOWAK.post('/api/materials', { lessonId: lesson.id, name: 'Kartkówka – wersja robocza', type: 'text/plain', dataUrl: 'data:text/plain;base64,eA==', coopAllowed: false }));
  assert.equal(b.material.coopAllowed, false);
  const seenByWojcik = expectOk(await WOJCIK.get('/api/materials'));
  assert.equal(seenByWojcik.materials.find((m) => m.id === a.material.id).canClaim, true);
  assert.equal(seenByWojcik.materials.find((m) => m.id === b.material.id).canClaim, false);
  const byLesson = expectOk(await NOWAK.get('/api/materials?lessonId=' + lesson.id)); assert.ok(byLesson.materials.every((m) => m.lesson && m.lesson.id === lesson.id)); assert.ok(byLesson.materials.length >= 2);
  assert.ok(S.db.col('audit').some((x) => x.action === 'material_uploaded' && x.entityId === b.material.id && x.after.coopAllowed === false));
});

test('the discussion under a material goes through log-comments; roles outside cooperation get 403; pupils keep their download list', async () => {
  const seen = expectOk(await WOJCIK.get('/api/log-comments/materials/st_mt_mat')); assert.equal(seen.comments.length, 1); assert.match(seen.comments[0].text, /fizyce/);
  const added = expectOk(await KROL.post('/api/log-comments/materials/st_mt_mat', { text: 'Wersję z większą czcionką mogę złożyć w piątek.' })); assert.equal(added.comment.private, false);
  assert.equal(expectOk(await NOWAK.get('/api/materials/st_mt_mat/details')).commentCount, 2);
  assert.equal((await SEK.get('/api/log-comments/materials/st_mt_mat')).status, 403);
  assert.equal((await ANNA.get('/api/log-comments/materials/st_mt_mat')).status, 403);
  const mats = expectOk(await ANNA.get('/api/student/materials')); assert.ok(mats.materials.some((m) => m.id === 'st_mt_mat')); assert.equal(mats.materials[0].coopClaims, undefined, 'pupils do not see cooperation internals');
  const file = expectOk(await ANNA.get('/api/materials/st_mt_mat')); assert.ok(file.dataUrl, 'download unchanged');
});
