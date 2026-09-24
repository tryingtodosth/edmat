'use strict';
/* Komentarze i notatki prywatne do rejestrów ekranu pomocy psychologiczno-pedagogicznej:
   `support-incidents` (Niebieska Karta / nadzór kuratora) i `wopfu-versions` (Historia wersji).
   Mechanizm sprawdza tests/59-log-comments.test.js — tutaj sprawdzamy, czy bramka każdego rodzaju
   powtarza dokładnie bramkę trasy GET, która ten rejestr wypisuje, i czy spod zamknięcia nic nie cieknie. */
const test = require('node:test'); const assert = require('node:assert/strict');
const { startServer, expectOk } = require('./helpers');

const JAN = 'st_nowak_jan';
const WOPFU = 's_wopfu_nowak_2026';
const path = (kind, id) => '/api/log-comments/' + kind + '/' + encodeURIComponent(id);

let S, PED, PSY, SPEC, LOG, SUP, DYR, T7B, TOTHER, IOD, PAR;
test.before(async () => {
  S = await startServer();
  PED = await S.as('pedagog'); PSY = await S.as('e.zielinska'); SPEC = await S.as('pedagog.specjalny');
  LOG = await S.as('logopeda'); SUP = await S.as('n.wspomagajacy'); DYR = await S.as('dyrektor');
  T7B = await S.as('j.nowak'); TOTHER = await S.as('i.kaczmarek'); IOD = await S.as('iod'); PAR = await S.as('rodzic.mazurek');
});
test.after(() => S.close());

/* ------------------------------------------------------------------ rejestr zdarzeń (3.4.10) */
test('rejestr zdarzeń: komentuje pedagog i czytelnik wskazany imiennie, notatka zostaje przy autorze', async () => {
  const SECRET = 'NIEBIESKA-KARTA-KOMENTARZE: opis zdarzenia z 19.10.2026, zespół interwencyjny.';
  const inc = expectOk(await PED.post('/api/support/incidents', {
    studentId: JAN, kind: 'blueCard', caseNo: 'NK-59D/2026', institution: 'KMP Kraków',
    text: SECRET, readerIds: ['u_zielinska']                       // psycholog dopisany imiennie do sprawy
  }), 'create incident');
  assert.ok(inc.readerIds.includes('u_pedagog') && inc.readerIds.includes('u_dyrektor') && inc.readerIds.includes('u_zielinska'));

  /* wykaz niesie liczniki przy wpisach otwartych dla pytającego */
  const list = expectOk(await PED.get('/api/support/incidents?studentId=' + JAN));
  const row = list.find((x) => x.id === inc.id);
  assert.equal(row.locked, false);
  assert.deepEqual(row.comments, { comments: 0, notes: 0 });

  const c = expectOk(await PED.post(path('support-incidents', inc.id), { text: 'Kopia karty przekazana do zespołu interdyscyplinarnego 22.10.' }));
  assert.equal(c.comment.private, false); assert.equal(c.comment.mine, true);

  const seen = expectOk(await PSY.get(path('support-incidents', inc.id)));
  assert.equal(seen.comments.length, 1); assert.equal(seen.comments[0].mine, false);
  assert.equal(seen.comments[0].author.includes('Dąbrowski'), true);
  assert.equal(seen.kind, 'support-incidents');
  assert.equal(seen.label, 'Rejestr zdarzeń · Niebieska Karta i nadzór kuratora');
  /* odpowiedź komentarzy nie wynosi treści wpisu ani numeru sprawy spod zamknięcia */
  const json = JSON.stringify(seen);
  assert.ok(!json.includes(SECRET) && !json.includes('NK-59D') && !json.includes('accessLog') && !json.includes('sealedText'), 'komentarze nie niosą treści wpisu');

  const note = expectOk(await PSY.post(path('support-incidents', inc.id), { text: 'Zapytać dyrektora o rozszerzenie listy czytelników.', private: true }));
  assert.ok(expectOk(await PSY.get(path('support-incidents', inc.id))).comments.some((x) => x.id === note.comment.id));
  assert.ok(!expectOk(await PED.get(path('support-incidents', inc.id))).comments.some((x) => x.id === note.comment.id), 'notatki psychologa pedagog nie widzi');

  /* dyrektor jest dopisywany do czytelników przy założeniu wpisu — więc wpis widzi i komentuje */
  expectOk(await DYR.get(path('support-incidents', inc.id)));

  /* specjalista z zespołu pomocy, ale spoza listy czytelników → 404 (brak prawa wygląda jak brak wpisu) */
  for (const cl of [SPEC, LOG, SUP]) {
    const r = await cl.get(path('support-incidents', inc.id));
    assert.equal(r.status, 404); assert.equal(r.body.code, 'log_entry_not_found');
    assert.equal((await cl.post(path('support-incidents', inc.id), { text: 'x' })).status, 404);
  }
  /* rola spoza rejestru → 403 */
  for (const cl of [T7B, IOD, PAR]) assert.equal((await cl.get(path('support-incidents', inc.id))).status, 403);
  assert.equal((await PAR.post(path('support-incidents', inc.id), { text: 'x' })).status, 403);
  assert.equal((await PED.get(path('support-incidents', 'inc_nie_ma'))).status, 404);

  /* liczniki: cudze komentarze wszyscy czytelnicy, notatkę tylko jej autor */
  const again = expectOk(await PED.get('/api/support/incidents?studentId=' + JAN));
  assert.deepEqual(again.find((x) => x.id === inc.id).comments, { comments: 1, notes: 0 });
  const forPsy = expectOk(await PSY.get('/api/support/incidents?studentId=' + JAN));
  assert.deepEqual(forPsy.find((x) => x.id === inc.id).comments, { comments: 1, notes: 1 });

  /* karta ucznia (ekran) niesie te same liczniki, a zamknięty wpis licznika nie dostaje */
  const ov = expectOk(await PED.get('/api/support/overview?studentId=' + JAN));
  assert.deepEqual(ov.comments.incidents[inc.id], { comments: 1, notes: 0 });
  const ovSpec = expectOk(await SPEC.get('/api/support/overview?studentId=' + JAN));
  assert.equal(ovSpec.comments.incidents[inc.id], undefined, 'kto nie widzi wpisu, nie widzi też licznika');
  assert.equal(ovSpec.incidents.find((x) => x.id === inc.id).locked, true);
});

/* ------------------------------------------------------------------ historia wersji WOPFU (3.4.2) */
test('historia wersji WOPFU: komentuje każdy, kto może czytać dokument; nauczyciel spoza klasy — 404', async () => {
  const w = expectOk(await SPEC.get('/api/support/wopfu?studentId=' + JAN)).item;
  assert.equal(w.id, WOPFU); assert.ok(w.versions.length >= 2);
  const eid = w.id + ':' + w.versions[0].no;
  assert.equal(eid, WOPFU + ':1', 'identyfikator wpisu jest wyliczalny: <id dokumentu>:<nr wersji>');

  const list = expectOk(await SPEC.get('/api/support/wopfu?studentId=' + JAN));
  assert.ok(list.comments, 'wykaz niesie liczniki komentarzy');
  assert.deepEqual(list.comments[eid], { comments: 0, notes: 0 });

  expectOk(await SPEC.post(path('wopfu-versions', eid), { text: 'Wersja 1 omówiona na zespole 03.09 — zgodna z orzeczeniem.' }));
  const seen = expectOk(await PSY.get(path('wopfu-versions', eid)));
  assert.equal(seen.comments.length, 1); assert.equal(seen.comments[0].mine, false);
  assert.equal(seen.comments[0].author.includes('Lis'), true);
  assert.equal(seen.label, 'Historia wersji WOPFU');

  const note = expectOk(await PSY.post(path('wopfu-versions', eid), { text: 'Sprawdzić datę kolejnej ewaluacji.', private: true }));
  assert.ok(expectOk(await PSY.get(path('wopfu-versions', eid))).comments.some((x) => x.id === note.comment.id));
  assert.ok(!expectOk(await SPEC.get(path('wopfu-versions', eid))).comments.some((x) => x.id === note.comment.id));

  /* dokument czyta też nauczyciel uczący ucznia (wychowawczyni 7b) i dyrektor */
  expectOk(await T7B.get(path('wopfu-versions', eid)));
  expectOk(await DYR.get(path('wopfu-versions', eid)));

  /* nauczycielka, która tego ucznia nie uczy → 404, dokładnie jak w GET /api/support/wopfu */
  assert.equal((await TOTHER.get('/api/support/wopfu?studentId=' + JAN)).status, 403, 'trasa wykazu odmawia');
  const other = await TOTHER.get(path('wopfu-versions', eid));
  assert.equal(other.status, 404); assert.equal(other.body.code, 'log_entry_not_found');
  assert.equal((await TOTHER.post(path('wopfu-versions', eid), { text: 'x' })).status, 404);

  /* rola spoza rejestru → 403 */
  for (const cl of [IOD, PAR]) assert.equal((await cl.get(path('wopfu-versions', eid))).status, 403);

  /* nieistniejąca wersja, nieistniejący dokument i identyfikator bez numeru wersji → 404 */
  assert.equal((await SPEC.get(path('wopfu-versions', WOPFU + ':99'))).status, 404);
  assert.equal((await SPEC.get(path('wopfu-versions', 'wop_nie_ma:1'))).status, 404);
  assert.equal((await SPEC.get(path('wopfu-versions', WOPFU))).status, 404);

  /* odpowiedź niesie tylko komentarze — bez treści sekcji dokumentu */
  const json = JSON.stringify(expectOk(await SPEC.get(path('wopfu-versions', eid))));
  assert.ok(!json.includes('pamięć wzrokowa') && !json.includes('sections'), 'komentarze nie niosą treści WOPFU');

  const forSpec = expectOk(await SPEC.get('/api/support/wopfu?studentId=' + JAN));
  assert.deepEqual(forSpec.comments[eid], { comments: 1, notes: 0 });
  const forPsy = expectOk(await PSY.get('/api/support/wopfu?studentId=' + JAN));
  assert.deepEqual(forPsy.comments[eid], { comments: 1, notes: 1 });

  /* karta ucznia niesie liczniki wszystkich wersji dokumentu bieżącego roku */
  const ov = expectOk(await SPEC.get('/api/support/overview?studentId=' + JAN));
  assert.deepEqual(ov.comments.wopfuVersions[eid], { comments: 1, notes: 0 });
  assert.deepEqual(Object.keys(ov.comments.wopfuVersions).length, ov.wopfu.versions.length);
});
