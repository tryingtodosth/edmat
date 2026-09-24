'use strict';
/* Komentarze i notatki prywatne do rejestrów dyrektora i do rejestru wglądów gabinetu:
   `audit` (rejestr zdarzeń), `parent-logins`, `specialist-log`, `nurse-access-log`.
   Mechanizm sprawdza tests/59-log-comments.test.js — tutaj sprawdzamy, czy bramka każdego
   rodzaju powtarza dokładnie bramkę trasy GET, która ten rejestr wypisuje. */
const test = require('node:test'); const assert = require('node:assert/strict');
const { startServer, expectOk } = require('./helpers');
const C = require('../server/lib/crypto');

let S, P, P2, IOD, T, PAR, NURSE, ADMIN;
test.before(async () => {
  S = await startServer();
  /* Rejestry widoczne wyłącznie dla roli „principal” trzeba obejrzeć w dwie osoby — w zasiewie
     jest jeden dyrektor, więc na czas tego pliku dokładamy wicedyrektora z tą samą rolą. */
  const d = S.db.get('users', 'u_dyrektor');
  S.db.col('users').push({ id: 'u_wicedyrektor', login: 'wicedyrektor', role: 'principal', title: 'wicedyr.', firstName: 'Anna', lastName: 'Zastępcza', name: 'Anna Zastępcza',
    passwordHash: d.passwordHash, mustChangePassword: false, totpEnabled: false, blocked: false, quietHours: null, createdAt: '2026-08-20T08:00:00Z' });
  P = await S.as('dyrektor'); P2 = await S.as('wicedyrektor'); IOD = await S.as('iod');
  T = await S.as('j.nowak'); PAR = await S.as('rodzic.mazurek'); NURSE = await S.as('pielegniarka'); ADMIN = await S.as('admin');
});
test.after(() => S.close());

const path = (kind, id) => '/api/log-comments/' + kind + '/' + encodeURIComponent(id);

/* ------------------------------------------------------------------ rejestr zdarzeń (3.3.16) */
test('rejestr zdarzeń: komentuje dyrektor i IOD, notatka prywatna zostaje przy autorze', async () => {
  const list = expectOk(await P.get('/api/principal/audit?limit=500'));
  const row = list.rows[list.rows.length - 1];                       // najstarszy wiersz — nowe komentarze go nie przesuną
  assert.ok(row && row.id, 'rejestr zdarzeń ma wpisy');
  assert.ok(list.comments, 'lista niesie liczniki komentarzy');
  assert.deepEqual(list.comments[row.id], { comments: 0, notes: 0 });

  expectOk(await P.post(path('audit', row.id), { text: 'Sprawdzone z sekretariatem — wpis zgodny z protokołem.' }));
  const seenByIod = expectOk(await IOD.get(path('audit', row.id)));
  assert.equal(seenByIod.comments.length, 1);
  assert.equal(seenByIod.comments[0].mine, false);
  assert.equal(seenByIod.comments[0].author.includes('Wiśniewski'), true);
  assert.equal(seenByIod.kind, 'audit'); assert.equal(seenByIod.label, 'Rejestr zdarzeń');

  const note = expectOk(await IOD.post(path('audit', row.id), { text: 'Do sprawdzenia przy przeglądzie rejestru czynności.', private: true }));
  assert.ok(expectOk(await IOD.get(path('audit', row.id))).comments.some((x) => x.id === note.comment.id));
  assert.ok(!expectOk(await P.get(path('audit', row.id))).comments.some((x) => x.id === note.comment.id), 'notatki IOD dyrektor nie widzi');

  /* rola spoza rejestru → 403; wpis, którego nie ma → 404 (tak samo jak brak prawa) */
  assert.equal((await T.get(path('audit', row.id))).status, 403);
  assert.equal((await PAR.post(path('audit', row.id), { text: 'x' })).status, 403);
  assert.equal((await ADMIN.get(path('audit', row.id))).status, 403);
  const ghost = await P.get(path('audit', 'aud_nie_ma_takiego'));
  assert.equal(ghost.status, 404); assert.equal(ghost.body.code, 'log_entry_not_found');

  const forP = expectOk(await P.get('/api/principal/audit?limit=500'));
  assert.deepEqual(forP.comments[row.id], { comments: 1, notes: 0 });
  const forIod = expectOk(await IOD.get('/api/principal/audit?limit=500'));
  assert.deepEqual(forIod.comments[row.id], { comments: 1, notes: 1 }, 'własną notatkę widać tylko we własnym zestawieniu');
});

/* ------------------------------------------------------------------ logowania rodziców (3.3.19) */
test('logowania rodziców: wiersz ma stały identyfikator, komentarz widzi drugi dyrektor', async () => {
  const list = expectOk(await P.get('/api/principal/parent-logins'));
  const row = list.rows.find((x) => x.userId === 'u_p_adamczyk') || list.rows[0];
  assert.equal(row.entryId, row.userId, 'identyfikatorem wpisu jest konto rodzica');
  assert.deepEqual(list.comments[row.entryId], { comments: 0, notes: 0 });

  expectOk(await P.post(path('parent-logins', row.entryId), { text: 'Rodzic poinformowany listownie o dostępie do dziennika.' }));
  const seen = expectOk(await P2.get(path('parent-logins', row.entryId)));
  assert.equal(seen.comments.length, 1); assert.equal(seen.comments[0].mine, false);

  const note = expectOk(await P2.post(path('parent-logins', row.entryId), { text: 'Zapytać wychowawcę o numer telefonu.', private: true }));
  assert.ok(!expectOk(await P.get(path('parent-logins', row.entryId))).comments.some((x) => x.id === note.comment.id));

  assert.equal((await IOD.get(path('parent-logins', row.entryId))).status, 403, 'IOD nie jest adresatem tego zestawienia');
  assert.equal((await T.get(path('parent-logins', row.entryId))).status, 403);
  const notParent = await P.get(path('parent-logins', 'u_nowak'));      // rola dobra, wpis spoza zestawienia
  assert.equal(notParent.status, 404); assert.equal(notParent.body.code, 'log_entry_not_found');
  assert.equal((await P.get(path('parent-logins', 'u_nie_ma'))).status, 404);

  const again = expectOk(await P.get('/api/principal/parent-logins'));
  assert.deepEqual(again.comments[row.entryId], { comments: 1, notes: 0 });
  assert.deepEqual(expectOk(await P2.get('/api/principal/parent-logins')).comments[row.entryId], { comments: 1, notes: 1 });
});

/* ------------------------------------------------------------------ dziennik specjalistów (3.3.13) */
test('dziennik specjalistów: komentarz do specjalisty, dokumentu i pieczęci notatki — bez treści notatki', async () => {
  const psych = S.db.get('users', 'u_zielinska');
  const secret = 'Uczeń zgłosił konflikt w domu; ustalono plan wsparcia na dwa tygodnie.';
  S.db.col('confidentialNotes').push({ id: 'lc_note_seal', studentId: 'st_nowak_jan', authorId: 'u_zielinska', kind: 'interwencja', title: 'Notatka z interwencji',
    at: '2026-10-20T10:00:00Z', readerIds: ['u_zielinska'], envelope: C.encryptForReaders(secret, [{ userId: psych.id, publicKey: psych.publicKey }]) });

  const list = expectOk(await P.get('/api/principal/specialist-log'));
  const spec = list.specialists.find((s) => s.userId === 'u_zielinska');
  const note = list.notes.find((n) => n.id === 'lc_note_seal');
  const doc = list.documents[0];
  assert.equal(spec.entryId, 'spec:u_zielinska');
  assert.equal(note.entryId, 'note:lc_note_seal'); assert.equal(note.sealed, true);
  assert.equal(doc.entryId, 'doc:' + doc.id);
  assert.deepEqual(list.comments[spec.entryId], { comments: 0, notes: 0 });
  assert.deepEqual(list.comments[note.entryId], { comments: 0, notes: 0 });
  assert.ok(!JSON.stringify(list).includes(secret), 'zestawienie nadal bez treści notatki');

  for (const eid of [spec.entryId, doc.entryId, note.entryId]) {
    const c = expectOk(await P.post(path('specialist-log', eid), { text: 'Omówione na radzie pedagogicznej 23.10.' }));
    assert.equal(c.comment.private, false);
    const seen = expectOk(await P2.get(path('specialist-log', eid)));
    assert.equal(seen.comments.length, 1); assert.equal(seen.comments[0].mine, false);
    /* odpowiedź komentarzy nie niesie ani treści pieczętowanej notatki, ani materiału kryptograficznego */
    const json = JSON.stringify(seen);
    assert.ok(!json.includes(secret) && !json.includes('ciphertext') && !json.includes('wrappedKeys'), 'komentarz nie wynosi treści spod pieczęci: ' + eid);
  }

  const priv = expectOk(await P2.post(path('specialist-log', note.entryId), { text: 'Sprawdzić podstawę prawną przechowywania.', private: true }));
  assert.ok(!expectOk(await P.get(path('specialist-log', note.entryId))).comments.some((x) => x.id === priv.comment.id));

  assert.equal((await IOD.get(path('specialist-log', spec.entryId))).status, 403);
  assert.equal((await T.post(path('specialist-log', spec.entryId), { text: 'x' })).status, 403);
  assert.equal((await P.get(path('specialist-log', 'spec:u_nowak'))).status, 404, 'nauczyciel nie jest specjalistą');
  assert.equal((await P.get(path('specialist-log', 'doc:s_doc_chroniony'))).status, 404);
  assert.equal((await P.get(path('specialist-log', 'note:nie_ma'))).status, 404);
  assert.equal((await P.get(path('specialist-log', 'u_zielinska'))).status, 404, 'bez przedrostka nie ma wpisu');

  const again = expectOk(await P.get('/api/principal/specialist-log'));
  assert.deepEqual(again.comments['spec:u_zielinska'], { comments: 1, notes: 0 });
  assert.deepEqual(expectOk(await P2.get('/api/principal/specialist-log')).comments['note:lc_note_seal'], { comments: 1, notes: 1 });
});

/* ------------------------------------------------------------------ rejestr wglądów do gabinetu (3.8.10) */
test('rejestr wglądów gabinetu: komentują pielęgniarka, IOD i dyrektor; nauczyciel nie', async () => {
  expectOk(await NURSE.get('/api/modules/nurse/visits/pm_visit_jan'));   // wgląd dozwolony → wiersz rejestru
  assert.equal((await T.get('/api/modules/nurse/visits/pm_visit_jan')).status, 403);  // odmowa → też wiersz

  const list = expectOk(await NURSE.get('/api/modules/nurse/access-log'));
  assert.ok(list.log.length >= 2);
  const row = list.log.find((x) => x.allowed === false) || list.log[0];
  assert.ok(row.id, 'wiersz rejestru ma identyfikator');
  assert.deepEqual(list.comments[row.id], { comments: 0, notes: 0 });

  expectOk(await NURSE.post(path('nurse-access-log', row.id), { text: 'Odmowa zgodna z art. 9 RODO — zgłoszone dyrekcji.' }));
  const seen = expectOk(await IOD.get(path('nurse-access-log', row.id)));
  assert.equal(seen.comments.length, 1); assert.equal(seen.comments[0].mine, false);
  assert.equal(seen.label, 'Rejestr wglądów do dokumentacji gabinetu');

  const note = expectOk(await IOD.post(path('nurse-access-log', row.id), { text: 'Wpisać do rejestru naruszeń do oceny.', private: true }));
  assert.ok(!expectOk(await P.get(path('nurse-access-log', row.id))).comments.some((x) => x.id === note.comment.id));

  assert.equal((await T.get(path('nurse-access-log', row.id))).status, 403);
  assert.equal((await PAR.get(path('nurse-access-log', row.id))).status, 403);
  assert.equal((await NURSE.get(path('nurse-access-log', 'hlog_nie_ma'))).status, 404);

  const forNurse = expectOk(await NURSE.get('/api/modules/nurse/access-log'));
  assert.deepEqual(forNurse.comments[row.id], { comments: 1, notes: 0 });
  assert.deepEqual(expectOk(await IOD.get('/api/modules/nurse/access-log')).comments[row.id], { comments: 1, notes: 1 });
});

/* ------------------------------------------------------------------ wyłączony moduł chowa rejestr razem z komentarzami */
test('wyłączony moduł zabiera i rejestr, i komentarze do jego wpisów', async () => {
  const log = expectOk(await NURSE.get('/api/modules/nurse/access-log'));
  const id = log.log[0].id;
  const cfg = S.db.data.config; const before = cfg.modules ? JSON.parse(JSON.stringify(cfg.modules)) : null;
  cfg.modules = { enabled: Object.assign({}, (cfg.modules || {}).enabled, { school: false }) };
  try {
    assert.equal((await NURSE.get('/api/modules/nurse/access-log')).status, 404, 'trasa rejestru znika');
    const c = await NURSE.get(path('nurse-access-log', id));
    assert.equal(c.status, 404); assert.equal(c.body.code, 'log_entry_not_found');
  } finally { if (before) cfg.modules = before; else delete cfg.modules; }
  expectOk(await NURSE.get(path('nurse-access-log', id)), 'po włączeniu modułu komentarze wracają');
});
