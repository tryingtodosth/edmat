'use strict';
/* Komentarze i notatki prywatne przy rejestrach zgodności, retencji i sekretariatu
   (lib/log-access + routes/log-comments, wpięte w privacy.js, retention.js i registry.js).

   Dowodzone jest jedno zdanie w czterech miejscach: komentować może KAŻDY, kto ma prawo ZOBACZYĆ
   dany wpis — a notatkę prywatną widzi wyłącznie jej autor. Bramka komentarzy jest dokładnie bramką
   listy, z której wpis pochodzi: protokoły usunięcia danych (IOD i administrator), protokoły
   brakowania (administrator), historia tożsamości (sekretariat, dyrekcja, administracja i wychowawca
   SWOJEGO oddziału), rejestr obwodowy (sekretariat, dyrekcja, administracja).

   Druga połowa pliku to los komentarza w czasie: komentarz nie jest samodzielnym dokumentem, więc
   znika razem z wpisem, pod którym stał (brakowanie), a żądanie z art. 17 RODO zabiera komentarze
   usuniętej osoby i redaguje jej dane w cudzych. Oba przebiegi liczą, ile ich ubyło — IOD ma to
   widzieć w protokole, nie domyślać się. */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { startServer, expectOk } = require('./helpers');

const SEVEN_B = 'st_adamczyk_maja';          // oddział 7b — wychowawczyni: j.nowak
const SEVEN_A = 'st_baran_julia';            // inny oddział — ta sama rola, inny zakres

/** Wpis historii tożsamości przy uczniu (§ 4) — droga danych, nie droga ekranu. */
function seedIdentity(db, studentId, reason) {
  const s = db.get('students', studentId);
  s.identityHistory = [{ at: '2026-11-02T09:00:00Z', byUserId: 'u_sekretariat', date: '2026-11-02', change: 'pesel',
    from: { pesel: null, identityDocument: { type: 'passport', number: 'EA1234567', country: 'UA' } }, to: { pesel: '19310100005' }, reason }];
  db.save();
}

let S, IOD, ADMIN, DYR, SEKR, NAUCZ, RODZIC;
test.before(async () => {
  S = await startServer();
  seedIdentity(S.db, SEVEN_B, 'nadanie numeru PESEL w trakcie roku szkolnego');
  seedIdentity(S.db, SEVEN_A, 'sprostowanie dokumentu tożsamości po imporcie');
  /* Protokół usunięcia danych musi w ogóle powstać — konto testowe zakładamy na tę jedną potrzebę. */
  S.db.col('users').push({ id: 'u_lc_zapomniany', login: 'lc.zapomniany', role: 'parent', firstName: 'Zenobiusz', lastName: 'Niebywalski',
    name: 'Zenobiusz Niebywalski', email: null, phone: null, passwordHash: '', blocked: false, testAccount: true, childrenIds: [], createdAt: '2026-09-01T08:00:00Z' });
  S.db.save();
  IOD = await S.as('iod'); ADMIN = await S.as('admin'); DYR = await S.as('dyrektor');
  SEKR = await S.as('sekretariat'); NAUCZ = await S.as('j.nowak'); RODZIC = await S.as('rodzic.mazurek');
  expectOk(await IOD.post('/api/privacy/forget', { userId: 'u_lc_zapomniany', reason: 'wniosek o usunięcie danych – RODO art. 17' }));
});
test.after(() => S && S.close());

const lc = (kind, id) => '/api/log-comments/' + kind + '/' + encodeURIComponent(id);

/**
 * Jeden scenariusz dla każdego rejestru: widzący komentuje, drugi widzący to czyta, notatki
 * prywatnej nie widzi, a rola spoza rejestru dostaje 403. Na koniec liczniki przy liście.
 */
async function sharedStory(kind, entryId, author, reader, outsider) {
  const c = expectOk(await author.post(lc(kind, entryId), { text: 'Sprawdzone z IOD-em.' }), kind + ': komentarz');
  assert.equal(c.comment.private, false);
  const seen = expectOk(await reader.get(lc(kind, entryId)), kind + ': odczyt przez drugiego widzącego');
  assert.ok(seen.comments.some((x) => x.id === c.comment.id), kind + ': cudzy komentarz jest widoczny');

  const n = expectOk(await author.post(lc(kind, entryId), { text: 'Do sprawdzenia w przyszłym tygodniu.', private: true }), kind + ': notatka');
  assert.equal(n.comment.private, true);
  const mine = expectOk(await author.get(lc(kind, entryId)));
  assert.ok(mine.comments.some((x) => x.id === n.comment.id), kind + ': autor widzi własną notatkę');
  const theirs = expectOk(await reader.get(lc(kind, entryId)));
  assert.ok(!theirs.comments.some((x) => x.id === n.comment.id), kind + ': notatka prywatna nie wychodzi poza autora');

  const no = await outsider.get(lc(kind, entryId));
  assert.equal(no.status, 403, kind + ': rola spoza rejestru nie komentuje');
  assert.equal(no.body.code, 'forbidden');
  const noWrite = await outsider.post(lc(kind, entryId), { text: 'nie wolno' });
  assert.equal(noWrite.status, 403);
  return { comment: c.comment, note: n.comment };
}

/* ------------------------------------------------------------ protokoły usunięcia danych (art. 17) */
test('erasures: protokół z art. 17 komentuje IOD i administrator, dyrektor go nie widzi', async () => {
  const list = expectOk(await IOD.get('/api/privacy/erasures'));
  assert.ok(list.erasures.length >= 1, 'jest protokół do skomentowania');
  assert.ok(list.comments, 'lista niesie liczniki komentarzy');
  const entry = list.erasures[0];

  await sharedStory('erasures', entry.id, IOD, ADMIN, DYR);

  const forIod = expectOk(await IOD.get('/api/privacy/erasures'));
  assert.equal(forIod.comments[entry.id].comments, 1);
  assert.equal(forIod.comments[entry.id].notes, 1, 'autor liczy swoją notatkę');
  const forAdmin = expectOk(await ADMIN.get('/api/privacy/erasures'));
  assert.equal(forAdmin.comments[entry.id].comments, 1);
  assert.equal(forAdmin.comments[entry.id].notes, 0, 'cudza notatka nie jest liczona');

  /* Nieistniejący protokół i zwykły wpis rejestru zdarzeń wyglądają tak samo: 404, nie 403. */
  const zwykly = S.db.col('audit').find((a) => a.action !== 'right_to_be_forgotten');
  assert.equal((await IOD.get(lc('erasures', zwykly.id))).status, 404);
  assert.equal((await IOD.get(lc('erasures', 'aud_nie_ma'))).status, 404);
});

/* --------------------------------------------------------------------- protokoły brakowania ----- */
test('retention-runs: protokół brakowania komentuje administrator; dyrektor i nauczyciel nie', async () => {
  const s = await startServer();
  try {
    s.db.col('retentionRuns').push({ id: 'run_lc_1', at: '2026-09-01T10:00:00Z', byUserId: 'u_admin', reason: 'nocne sprzątanie',
      status: 'completed', deleted: { audit: 3, sessions: 1 }, byClass: { 'dziennik-zdarzen': 3 } });
    s.db.save();
    const admin = await s.as('admin'); const dyr = await s.as('dyrektor'); const nauczyciel = await s.as('j.nowak');

    const runs = expectOk(await admin.get('/api/admin/retention/runs'));
    assert.ok(runs.runs.some((r) => r.id === 'run_lc_1'));
    assert.ok(runs.comments && runs.proposalComments, 'lista niesie liczniki dla protokołów i propozycji');

    const c = expectOk(await admin.post(lc('retention-runs', 'run_lc_1'), { text: 'Zgoda archiwum w segregatorze 3/2033.' }));
    const n = expectOk(await admin.post(lc('retention-runs', 'run_lc_1'), { text: 'Zapytać archiwum o kolejny rocznik.', private: true }));
    assert.equal((await dyr.get(lc('retention-runs', 'run_lc_1'))).status, 403, 'protokoły brakowania listuje wyłącznie administrator');
    assert.equal((await nauczyciel.get(lc('retention-runs', 'run_lc_1'))).status, 403);

    const after = expectOk(await admin.get('/api/admin/retention/runs'));
    assert.equal(after.comments['run_lc_1'].comments, 1);
    assert.equal(after.comments['run_lc_1'].notes, 1);
    assert.ok(c.comment.id && n.comment.id);

    /* Propozycja brakowania to osobny rodzaj, z tą samą bramką. */
    const p = expectOk(await admin.get('/api/admin/retention/proposal'));
    expectOk(await admin.post(lc('retention-proposals', p.proposalId), { text: 'Lista ułożona po przeglądzie rocznika 2010/2011.' }));
    const withProps = expectOk(await admin.get('/api/admin/retention/runs'));
    assert.equal(withProps.proposalComments[p.proposalId].comments, 1);
    assert.equal((await dyr.get(lc('retention-proposals', p.proposalId))).status, 403);
    assert.equal((await admin.get(lc('retention-runs', 'run_nie_ma'))).status, 404);
  } finally { await s.close(); }
});

/* --------------------------------------------------------------------- historia tożsamości ------ */
test('identity-history: komentuje sekretariat i wychowawca SWOJEGO oddziału, rodzic nie', async () => {
  const reg = expectOk(await SEKR.get('/api/registry/students'));
  assert.ok(reg.identityComments, 'księga niesie liczniki komentarzy do historii tożsamości');
  const row7b = reg.students.find((s) => s.id === SEVEN_B);
  const row7a = reg.students.find((s) => s.id === SEVEN_A);
  assert.equal(row7b.identityHistory.length, 1, 'wpis historii ma stabilny identyfikator w liście');
  assert.match(row7b.identityHistory[0].id, /^ih_[0-9a-f]{12}$/);
  const id7b = row7b.identityHistory[0].id; const id7a = row7a.identityHistory[0].id;

  await sharedStory('identity-history', id7b, SEKR, NAUCZ, RODZIC);

  /* Wychowawczyni 7b widzi wpis swojej uczennicy, a wpisu z 7a — nie (404, nie 403: brak wpisu i
     brak prawa mają wyglądać tak samo). */
  assert.equal((await NAUCZ.get(lc('identity-history', id7a))).status, 404);
  expectOk(await DYR.get(lc('identity-history', id7a)), 'dyrektor widzi całą szkołę');

  const flags = expectOk(await SEKR.get('/api/registry/students/' + SEVEN_B + '/flags'));
  assert.equal(flags.identityHistory[0].id, id7b, 'ten sam identyfikator w karcie ucznia i w księdze');
  assert.equal(flags.identityComments[id7b].comments, 1);
  assert.equal(flags.identityComments[id7b].notes, 1, 'licznik liczy notatki czytającego — tu autorki');
  const mineAgain = expectOk(await SEKR.get('/api/registry/students'));
  assert.equal(mineAgain.identityComments[id7b].notes, 1, 'ten sam licznik w księdze i w karcie ucznia');
  const forTeacher = expectOk(await NAUCZ.get('/api/registry/students/' + SEVEN_B + '/flags'));
  assert.equal(forTeacher.identityComments[id7b].comments, 1);
  assert.equal(forTeacher.identityComments[id7b].notes, 0, 'cudzej notatki wychowawczyni nie liczy');
});

/* ------------------------------------------------------------------------- rejestr obwodowy ----- */
test('district-register: komentuje sekretariat i dyrekcja, nauczyciel dostaje 403', async () => {
  const d = expectOk(await SEKR.get('/api/registry/district'));
  assert.ok(d.children.length, 'rejestr obwodowy ma wiersze');
  assert.ok(d.comments, 'lista niesie liczniki');
  const child = d.children[0];

  await sharedStory('district-register', child.id, SEKR, DYR, NAUCZ);

  const after = expectOk(await SEKR.get('/api/registry/district'));
  assert.equal(after.comments[child.id].comments, 1);
  assert.equal(after.comments[child.id].notes, 1);
  const forDyr = expectOk(await DYR.get('/api/registry/district'));
  assert.equal(forDyr.comments[child.id].notes, 0);
  assert.equal((await SEKR.get(lc('district-register', 'dc_nie_ma'))).status, 404);
});

/* ------------------------------------------------------- brakowanie zabiera komentarze ze sobą -- */
function seedExpired(db) {
  const old = new Date(db.data.config.today + 'T00:00:00Z');
  old.setUTCFullYear(old.getUTCFullYear() - (db.data.config.logRetentionYears || 5) - 1);
  for (let i = 0; i < 3; i++) db.col('audit').push({ id: 'aud_lc_' + i, at: old.toISOString(), userId: 'u_nowak', action: 'grade_update', entity: 'grades', entityId: 'g' + i });
  for (let i = 0; i < 4; i++) db.col('attendance').push({ id: 'att_lc_' + i, lessonId: 'les_lc', studentId: 'st_kowalczyk_anna', date: '2010-09-15', lessonNo: 1, classId: '7b', subjectId: 'mat', status: 'ob', byUserId: 'u_nowak', at: '2010-09-15T08:00:00Z' });
  db.save();
}
const comment = (db, id, kind, entryId, userId, text, priv) => {
  db.col('logComments').push({ id, kind, entryId, userId, at: '2026-09-01T09:00:00Z', text, private: !!priv, deleted: false });
  db.save();
};

test('brakowanie usuwa komentarze brakowanych wpisów i liczy je w protokole', async () => {
  const s = await startServer();
  try {
    const db = s.db;
    seedExpired(db);
    const swiezy = db.col('audit').find((a) => !String(a.id).startsWith('aud_lc_')).id;
    comment(db, 'lc_old_1', 'audit', 'aud_lc_0', 'u_dyrektor', 'Ten wpis dotyczy poprawki oceny z 2020 r.');
    comment(db, 'lc_old_2', 'audit', 'aud_lc_1', 'u_admin', 'Notatka do rocznika.', true);
    comment(db, 'lc_arch', 'probe', 'att_lc_0', 'u_dyrektor', 'Frekwencja sprawdzona z dziennikiem papierowym.');
    comment(db, 'lc_zywy', 'audit', swiezy, 'u_dyrektor', 'Ten wpis jeszcze żyje.');

    const admin = await s.as('admin'); const dyr = await s.as('dyrektor');
    /* 1. klasy operacyjne — bez zgody archiwum: z rejestru zdarzeń znikają wpisy i ich komentarze. */
    const run = expectOk(await admin.post('/api/admin/retention/run', { confirm: true, reason: 'nocne sprzątanie rejestru zdarzeń' }));
    assert.equal(run.deleted.audit, 3);
    assert.equal(run.deleted.logComments, 2, 'komentarz i notatka brakowanych wpisów znikają razem z nimi');
    assert.equal(run.byClass['komentarze-do-wpisow'], 2);
    assert.equal(run.logComments.byKind.audit, 2);
    assert.equal(db.get('logComments', 'lc_old_1'), null);
    assert.equal(db.get('logComments', 'lc_old_2'), null, 'notatka prywatna też nie ma już do czego wisieć');
    assert.ok(db.get('logComments', 'lc_zywy'), 'komentarz żywego wpisu zostaje');
    assert.ok(db.get('logComments', 'lc_arch'), 'wpis dziennika lekcyjnego jeszcze nie został zbrakowany');
    const protokol = db.get('retentionRuns', run.runId);
    assert.equal(protokol.logComments.removed, 2, 'protokół niesie licznik — IOD widzi, ile dopisków ubyło');
    assert.equal(protokol.deleted.logComments, 2);
    assert.equal(typeof protokol.remaining.logComments, 'number');

    /* 2. klasy archiwalne — po zatwierdzeniu na cztery oczy; komentarz idzie za wpisem bez względu
          na rodzaj dziennika, bo reguła jest po identyfikatorze wpisu, a nie po nazwie rejestru. */
    const p = expectOk(await admin.get('/api/admin/retention/proposal'));
    const ap = expectOk(await dyr.post('/api/admin/retention/approve', { proposalId: p.proposalId, archiveConsentReference: 'AP Kraków, zgoda nr 7/2033' }));
    const run2 = expectOk(await admin.post('/api/admin/retention/run', { confirm: true, reason: 'brakowanie wg protokołu 7/2033', proposalId: p.proposalId, confirmationToken: ap.confirmationToken }));
    assert.equal(db.get('attendance', 'att_lc_0'), null);
    assert.equal(run2.deleted.logComments, 1);
    assert.equal(run2.logComments.byKind.probe, 1);
    assert.equal(db.get('logComments', 'lc_arch'), null);
    assert.ok(db.get('logComments', 'lc_zywy'), 'komentarz wpisu, którego nikt nie brakował, nadal jest');
    assert.match(run2.message, /komentarz/);
  } finally { await s.close(); }
});

test('logComments należy do klasy dokumentacji i nie ma własnego zegara', async () => {
  const RET = require('../server/routes/retention');
  const s = await startServer();
  try {
    comment(s.db, 'lc_klasa', 'audit', 'x', 'u_admin', 'Żeby kolekcja istniała.');
    const cls = RET.policyFor(s.db, 'logComments');
    assert.equal(cls.class, 'komentarze-do-wpisow');
    assert.equal(cls.erasure, 'delete');
    assert.equal(RET.neverDeleteOf(cls), true, 'komentarz nie ma własnego zegara — znika z wpisem, nigdy przed nim');
    assert.deepEqual(RET.uncoveredCollections(s.db), [], 'kolekcja komentarzy nie jest „bez klasy”');
    const admin = await s.as('admin');
    const rep = expectOk(await admin.get('/api/admin/retention/report'));
    const row = rep.classes.find((x) => x.class === 'komentarze-do-wpisow');
    assert.ok(row && row.collections.includes('logComments'), 'raport dla IOD wymienia kolekcję komentarzy');
    assert.equal(row.due, 0);
    assert.match(row.rule, /dzieli los wpisu/);
  } finally { await s.close(); }
});

/* ------------------------------------------------------------------- art. 17: komentarze osoby -- */
test('art. 17 usuwa komentarze usuniętej osoby, komentarze pod jej usuniętymi wpisami i redaguje resztę', async () => {
  const s = await startServer();
  try {
    const db = s.db;
    const D = require('../server/lib/domain');
    const parent = db.col('users').find((u) => u.id === 'u_p_kowalczyk');
    parent.testAccount = true; db.save();
    D.notify(db, parent.id, 'message', 'Powiadomienie do usunięcia', {});
    db.save();
    const notif = db.col('notifications').find((n) => n.userId === parent.id);
    assert.ok(notif, 'opiekun ma powiadomienie, które art. 17 usunie');
    const audytowy = db.col('audit')[0].id;

    comment(db, 'lc_autor', 'audit', audytowy, parent.id, 'Proszę o wyjaśnienie tego wpisu.');
    comment(db, 'lc_notatka', 'audit', audytowy, parent.id, 'Moja prywatna notatka.', true);
    comment(db, 'lc_pod_wpisem', 'powiadomienia', notif.id, 'u_dyrektor', 'Doręczone telefonicznie.');
    comment(db, 'lc_obcy', 'audit', audytowy, 'u_dyrektor', 'Sprawa zamknięta, bez danych osobowych.');
    comment(db, 'lc_do_redakcji', 'audit', audytowy, 'u_dyrektor', `Rozmowa z ${parent.firstName} ${parent.lastName} w sekretariacie.`);

    const c = await s.as('admin');
    const r = expectOk(await c.post('/api/privacy/forget', { userId: parent.id, reason: 'art. 17 – konto opiekuna' }));

    assert.equal(r.removed.logComments.byAuthor, 2, 'komentarz i notatka usuniętej osoby znikają');
    assert.equal(r.removed.logComments.withEntry, 1, 'komentarz pod usuniętym powiadomieniem idzie za nim');
    assert.equal(r.removed.logComments.redacted, 1, 'cudzy komentarz zostaje, ale bez nazwiska');
    assert.equal(r.removed.deleted.logComments, 3);
    assert.equal(r.removed.byClass['komentarze-do-wpisow'], 3);

    assert.equal(db.get('logComments', 'lc_autor'), null);
    assert.equal(db.get('logComments', 'lc_notatka'), null);
    assert.equal(db.get('logComments', 'lc_pod_wpisem'), null);
    assert.equal(db.get('logComments', 'lc_obcy').text, 'Sprawa zamknięta, bez danych osobowych.');
    const zredagowany = db.get('logComments', 'lc_do_redakcji').text;
    assert.equal(zredagowany.includes(parent.lastName), false, 'nazwisko znikło z cudzego komentarza');
    assert.match(zredagowany, /RODO art\. 17/);

    /* Protokół w rejestrze zdarzeń mówi to samo co odpowiedź — IOD czyta liczby, nie domysły. */
    const protokol = db.col('audit').filter((a) => a.action === 'right_to_be_forgotten').pop();
    assert.equal(protokol.after.logComments.byAuthor, 2);
    assert.equal(protokol.after.logComments.withEntry, 1);
    assert.equal(protokol.after.logComments.redacted, 1);
    assert.equal(protokol.after.deleted.logComments, 3);
    /* A polityka art. 17 wymienia klasę komentarzy wśród usuwanych. */
    const pol = expectOk(await c.get('/api/privacy/erasure-policy'));
    assert.ok(pol.deleted.some((x) => x.class === 'komentarze-do-wpisow'));
  } finally { await s.close(); }
});
