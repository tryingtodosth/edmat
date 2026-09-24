'use strict';
/* R5 + runda 3 — retencja ułożona wokół kategorii archiwalnych (JRWA), nie wokół „liczby lat dla
   logów”, i JEDNA reguła dla brakowania oraz dla art. 17 RODO.

   Co jest tu dowodzone: reguła zegara (1 stycznia po roku szkolnym) na granicy roku kalendarzowego;
   KAŻDA tablica w magazynie ma klasę dokumentacji, a kolekcja bez klasy wywraca ten plik (D3-13);
   kategoria A i księga uczniów nigdy nie trafiają do brakowania; zatwierdzenie wymaga drugiej pary
   oczu (S3-11) i sygnatury zgody Archiwum Państwowego, a wykonanie — jednorazowego potwierdzenia;
   zwykłe uruchomienie zadania sprząta wyłącznie klasy operacyjne; propozycja niesie liczby, nie
   listy identyfikatorów (R3-03); protokół brakowania jest na dysku ZANIM cokolwiek zniknie, więc
   kill -9 w trakcie sprzątania zostawia ślad (R3-02); stary kształt `config.retention` migruje przy
   odczycie. Opis tabeli, macierzy usuwania i ścieżki zatwierdzania: docs/RETENTION.md. */
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs'); const path = require('node:path'); const os = require('node:os');
const { spawn } = require('node:child_process');
const { startServer, expectOk, fixtures } = require('./helpers');
const RET = require('../server/routes/retention');
const { Store } = require('../server/lib/store');

const ROOT = path.join(__dirname, '..');
let S;
test.before(async () => { S = await startServer(); });
test.after(() => S && S.close());

const need = fixtures();
/* Jeden serwer na wszystkie testy czytające; testy, które kasują dane, biorą własny (patrz niżej). */
const admin = () => need('admin', () => S.as('admin'));
const principal = () => need('principal', () => S.as('dyrektor'));

const cls = (db, id) => RET.policy(db).classes.find((c) => c.class === id);

/* ------------------------------------------------------------------ reguła zegara (1 stycznia) -- */
test('retentionDeadline: zegar klas archiwalnych rusza 1 stycznia po roku szkolnym, nie w dniu wpisu', () => {
  const db = S.db;
  const dziennik = cls(db, 'dziennik-lekcyjny');
  assert.equal(dziennik.category, 'B5');

  /* 23.10.2026 i 15.01.2027 to ten sam rok szkolny 2026/2027 → ten sam termin, mimo granicy roku. */
  assert.equal(RET.retentionDeadline(dziennik, { date: '2026-10-23' }, db), '2033-01-01');
  assert.equal(RET.retentionDeadline(dziennik, { date: '2027-01-15' }, db), '2033-01-01');
  assert.equal(RET.retentionDeadline(dziennik, { date: '2027-06-25' }, db), '2033-01-01');
  /* 02.09.2027 to już rok 2027/2028 → o rok później. */
  assert.equal(RET.retentionDeadline(dziennik, { date: '2027-09-02' }, db), '2034-01-01');
  /* Wakacje: helper roku szkolnego przesuwa granicę na 1 sierpnia, więc lipiec to jeszcze 2026/2027. */
  assert.equal(RET.retentionDeadline(dziennik, { date: '2027-07-31' }, db), '2033-01-01');
  assert.equal(RET.retentionDeadline(dziennik, { date: '2027-08-01' }, db), '2034-01-01');

  /* B50 z tego samego wpisu: 2027 + 1 + 50. */
  assert.equal(RET.retentionDeadline(cls(db, 'arkusze-ocen'), { date: '2026-10-23' }, db), '2078-01-01');
  /* Nazwa klasy jako tekst działa tak samo (funkcja sama sięga po politykę). */
  assert.equal(RET.retentionDeadline('arkusze-ocen', { date: '2026-10-23' }, db), '2078-01-01');

  /* 20 lat dokumentacji medycznej też zaokrągla się do 1 stycznia (art. 29 u.p.p. liczy od końca roku). */
  assert.equal(RET.retentionDeadline(cls(db, 'dokumentacja-medyczna'), { date: '2026-03-02' }, db), '2047-01-01');
  assert.equal(RET.retentionDeadline(cls(db, 'rejestr-wypadkow'), { at: '2026-03-02T09:00:00Z' }, db), '2052-01-01');
});

test('retentionDeadline: kategoria A, księga uczniów i dane robocze nie mają terminu; PPP czeka na odejście ucznia', () => {
  const db = S.db;
  /* Protokoły brakowania to kategoria A — zostają na zawsze. */
  assert.equal(RET.retentionDeadline(cls(db, 'protokoly-brakowania'), { at: '2000-01-02T08:00:00Z' }, db), null);
  assert.equal(cls(db, 'ksiega-uczniow').archiveCategoryA, true);
  assert.equal(RET.retentionDeadline(cls(db, 'ksiega-uczniow'), { departureDate: '2000-06-30', registerNo: 1, pesel: null }, db), null);
  /* Dane robocze programu (kind: 'reference') nie mają zegara w ogóle. */
  assert.equal(cls(db, 'konfiguracja-szkoly').kind, 'reference');
  assert.equal(RET.retentionDeadline(cls(db, 'konfiguracja-szkoly'), { at: '2000-01-02T08:00:00Z' }, db), null);
  assert.equal(RET.neverDeleteOf(cls(db, 'konta-uzytkownikow')), true);

  const ppp = cls(db, 'dokumentacja-ppp');
  const staying = db.col('students').find((s) => !s.departureDate && !s.leftAt);
  assert.equal(RET.retentionDeadline(ppp, { studentId: staying.id }, db), null, 'uczeń w szkole — okres jeszcze nie rusza');
  /* Odejście 25.06.2027 → zegar 1.01.2028, B5 mija 1.01.2033. */
  const fake = { get: (col, id) => (col === 'students' && id === 'st_x' ? { id: 'st_x', departureDate: '2027-06-25' } : null) };
  assert.equal(RET.retentionDeadline(ppp, { studentId: 'st_x' }, fake), '2033-01-01');
  /* D3-14: droga administracyjna zapisywała tylko `leftAt`, a wtedy zegar nie ruszał nigdy. */
  const left = { get: (col, id) => (col === 'students' && id === 'st_y' ? { id: 'st_y', leftAt: '2027-06-25' } : null) };
  assert.equal(RET.retentionDeadline(ppp, { studentId: 'st_y' }, left), '2033-01-01', 'leftAt też zamyka sprawę');
});

test('retentionDeadline: klasy operacyjne liczą okres wprost od wpisu i muszą go przeżyć w całości', () => {
  const db = S.db;
  const audit = cls(db, 'dziennik-zdarzen');
  assert.equal(audit.kind, 'operational');
  assert.equal(audit.years, db.data.config.logRetentionYears);
  assert.equal(RET.retentionDeadline(audit, { at: '2020-10-23T08:00:00Z' }, db), '2025-10-24');
  const sesje = cls(db, 'sesje');
  assert.equal(sesje.days, 90);
  assert.equal(RET.retentionDeadline(sesje, { lastActivity: '2026-01-01T08:00:00Z', createdAt: '2020-01-01T08:00:00Z' }, db),
    '2026-04-02', 'sesja liczy się od ostatniej aktywności, nie od założenia');
});

/* ------------------------------------------------------- jedna reguła: żadnej kolekcji bez klasy -- */
test('każda tablica w magazynie ma klasę dokumentacji — kolekcja bez klasy wywraca ten test (D3-13)', async () => {
  const db = S.db;
  const catalogue = RET.classifyAll(db);
  const arrays = Object.keys(db.data).filter((k) => Array.isArray(db.data[k]));
  assert.ok(arrays.length >= 70, 'zaseedowana szkoła ma kilkadziesiąt kolekcji, nie kilka');
  for (const name of arrays) {
    const row = catalogue.find((x) => x.collection === name);
    assert.ok(row, name + ' nie ma wiersza w classifyAll');
    assert.equal(row.uncovered, false,
      `kolekcja „${name}” nie należy do żadnej klasy dokumentacji. Dopisz ją do DEFAULT_CLASSES w server/routes/retention.js (kategoria, zegar, podstawa prawna, erasure) albo zapisz decyzję, że jest poza zakresem — docs/RETENTION.md.`);
    assert.ok(row.class && row.category && row.kind && row.erasure, name + ' ma niepełną klasę');
  }
  const uncovered = RET.uncoveredCollections(db);
  assert.deepEqual(uncovered, [], 'lista kolekcji bez klasy: ' + uncovered.join(', '));

  /* policyFor() to ta sama reguła, czytana po kolekcji — z niej korzysta art. 17 (privacy.js). */
  assert.equal(RET.policyFor(db, 'grades').class, 'arkusze-ocen');
  assert.equal(RET.policyFor(db, 'audit').class, 'dziennik-zdarzen');
  assert.equal(RET.policyFor(db, 'nie-ma-takiej'), null);

  /* Dopisanie kolekcji bez klasy MUSI być widać — także w raporcie administratora. */
  const s = await startServer();
  try {
    s.db.data.nowaKolekcjaBezKlasy = [{ id: 'x1', studentId: 'st_kowalczyk_anna' }];
    s.db.save();
    assert.deepEqual(RET.uncoveredCollections(s.db), ['nowaKolekcjaBezKlasy']);
    const c = await s.as('admin');
    const rep = expectOk(await c.get('/api/admin/retention/report'));
    assert.deepEqual(rep.uncovered, ['nowaKolekcjaBezKlasy']);
    assert.equal(rep.uncoveredCount, 1);
    assert.equal(rep.uncoveredRows, 1);
    assert.match(rep.uncoveredWarning, /nowaKolekcjaBezKlasy/);
  } finally { await s.close(); }
});

test('remapowane klasy: protokoły rady pedagogicznej znikają, pakiet archiwalny i uchwały dostają swoje (D3-15)', () => {
  const db = S.db;
  assert.equal(cls(db, 'protokoly-rady-pedagogicznej'), undefined, 'EdMat nie prowadzi protokołów rady pedagogicznej');
  const uchwaly = cls(db, 'uchwaly-klasyfikacyjne');
  assert.deepEqual(uchwaly.collections, ['semesterLocks']);
  assert.equal(uchwaly.category, 'B5');
  assert.equal(RET.neverDeleteOf(uchwaly), false);
  const pakiet = cls(db, 'pakiet-archiwalny');
  assert.deepEqual(pakiet.collections, ['archives']);
  assert.equal(pakiet.category, 'B5', 'kopia robocza pakietu nie jest kategorią A — kategorię wyznacza jego treść');
  assert.equal(RET.neverDeleteOf(pakiet), false);
  assert.match(pakiet.note, /podpisany oryginał na nośniku przechowuje SZKOŁA/i);
  /* Kategoria A w programie została tam, gdzie jej miejsce: przy protokołach brakowania. */
  assert.equal(cls(db, 'protokoly-brakowania').category, 'A');
  assert.deepEqual(cls(db, 'protokoly-brakowania').collections, ['retentionRuns', 'retentionProposals']);
});

/* --------------------------------------------------------------------- tabela, raport, UI ------ */
test('GET /api/admin/retention niesie klasy dokumentacji z kategoriami, flagą weryfikacji i regułą usuwania', async () => {
  const c = await admin();
  const d = expectOk(await c.get('/api/admin/retention'));
  assert.equal(d.immutable, true);
  assert.equal(d.retention.version, 3);
  const byId = Object.fromEntries(d.retention.classes.map((x) => [x.class, x]));
  assert.equal(byId['dziennik-lekcyjny'].category, 'B5');
  assert.equal(byId['arkusze-ocen'].category, 'B50');
  assert.equal(byId['ksiega-uczniow'].category, 'B50');
  assert.equal(byId['ksiega-uczniow'].archiveCategoryA, true);
  assert.equal(byId['protokoly-brakowania'].category, 'A');
  assert.equal(byId['dokumentacja-ppp'].clock, 'pupil-left');
  assert.equal(byId['dokumentacja-medyczna'].years, 20);
  assert.equal(byId['rejestr-wypadkow'].category, 'B25');
  for (const id of ['dziennik-zdarzen', 'wiadomosci', 'powiadomienia', 'doreczenia-push', 'sesje', 'opinie', 'kody-i-importy']) {
    assert.equal(byId[id].kind, 'operational', id + ' jest klasą operacyjną');
  }
  for (const id of ['konfiguracja-szkoly', 'konta-uzytkownikow', 'materialy-dydaktyczne', 'dostep-techniczny']) {
    assert.equal(byId[id].kind, 'reference', id + ' to dane robocze, nie dokumentacja');
    assert.equal(byId[id].neverDelete, true, id + ' nie jest nigdy brakowany');
  }
  /* macierz art. 17 jedzie tą samą tabelą */
  assert.equal(byId['arkusze-ocen'].erasure, 'anonymise');
  assert.equal(byId['dokumentacja-ppp'].erasure, 'anonymise');
  assert.equal(byId['dokumentacja-ppp'].article9, true);
  assert.equal(byId['dziennik-zdarzen'].erasure, 'keep');
  assert.equal(byId['wiadomosci'].erasure, 'delete');
  for (const x of d.retention.classes) assert.ok(x.legalBasis && x.rule, x.class + ' ma podstawę i regułę');
  assert.deepEqual(d.retention.uncovered, []);
  /* wiersz 7 triażu ma ocenę B — kategorie JRWA zostają nieweryfikowane do czasu porównania z JRWA szkoły */
  for (const id of ['dziennik-lekcyjny', 'arkusze-ocen', 'ksiega-uczniow', 'pakiet-archiwalny', 'dokumentacja-ppp', 'rejestr-wypadkow']) {
    assert.equal(byId[id].verified, false, id + ' czeka na weryfikację JRWA');
    assert.ok(d.retention.unverified.includes(id));
  }
});

test('GET /api/admin/retention/report: wiersz na klasę z kategorią, regułą, liczbą po terminie i ostrzeżeniem', async () => {
  const c = await admin();
  const rep = expectOk(await c.get('/api/admin/retention/report'));
  assert.equal(rep.deleted, 0, 'raport niczego nie usuwa');
  assert.match(rep.message, /nic nie usuwa/);
  assert.ok(Array.isArray(rep.classes) && rep.classes.length >= 25);
  const row = rep.classes.find((x) => x.class === 'dziennik-lekcyjny');
  assert.equal(row.category, 'B5');
  assert.match(row.rule, /1 stycznia/);
  assert.equal(typeof row.due, 'number');
  assert.ok(row.nextDeadline, 'w zaseedowanej szkole jest co najmniej jeden przyszły termin');
  assert.equal(rep.classes.find((x) => x.class === 'protokoly-brakowania').neverDeletes, true);
  assert.equal(rep.classes.find((x) => x.class === 'ksiega-uczniow').neverDeletes, true);
  assert.ok(rep.jrwaWarning && /wykaz(em)? akt/.test(rep.jrwaWarning));
  assert.ok(rep.unverified.includes('rejestr-wypadkow'));
  /* wiersz „bez klasy” jest zawsze, nawet gdy jest pusty */
  assert.ok(Array.isArray(rep.uncovered));
  assert.equal(rep.uncoveredCount, 0);
  assert.equal(rep.uncoveredWarning, null);
  assert.ok(rep.collectionsTotal >= 70);
});

/* ------------------------------------------------------------------------ brakowanie: bramka --- */
/** Serwer z własnymi „przeterminowanymi” danymi — testy niżej kasują, więc każdy dostaje swój. */
async function serverWithExpired(opts) {
  const s = await startServer(opts);
  seedExpired(s.db);
  return s;
}
function seedExpired(db) {
  /* rok szkolny 2010/2011 → termin B5 minął 1.01.2017 */
  for (let i = 0; i < 4; i++) db.col('attendance').push({ id: 'att_r5_' + i, lessonId: 'les_r5', studentId: 'st_kowalczyk_anna', date: '2010-09-15', lessonNo: 1, classId: '7b', subjectId: 'mat', status: 'ob', byUserId: 'u_nowak', at: '2010-09-15T08:00:00Z' });
  db.col('remarks').push({ id: 'rem_r5_1', studentId: 'st_kowalczyk_anna', teacherId: 'u_nowak', kind: 'neutral', text: 'stara uwaga', date: '2010-09-15' });
  /* kategoria A i księga uczniów — równie stare, a mimo to nietykalne */
  db.col('retentionRuns').push({ id: 'run_r5_old', at: '2010-09-15T08:00:00Z', byUserId: 'u_admin', reason: 'stare brakowanie', deleted: {}, byClass: {} });
  db.col('students').push({ id: 'st_r5_old', firstName: 'Archiwalny', lastName: 'Absolwent', registerNo: 900, pesel: null, classId: null, status: 'transferred', departureDate: '2010-06-30', parentIds: [] });
  /* klasa operacyjna: wpisy audytowe sprzed polityki */
  const old = new Date(db.data.config.today + 'T00:00:00Z'); old.setUTCFullYear(old.getUTCFullYear() - (db.data.config.logRetentionYears || 5) - 1);
  for (let i = 0; i < 3; i++) db.col('audit').push({ id: 'aud_r5_' + i, at: old.toISOString(), userId: 'u_nowak', action: 'grade_update', entity: 'grades', entityId: 'g' + i });
  db.save();
}

test('propozycja brakowania: kategoria A, księga uczniów i dane robocze nie trafiają na listę nigdy', async () => {
  const s = await serverWithExpired();
  try {
    const c = await s.as('admin');
    const p = expectOk(await c.get('/api/admin/retention/proposal'));
    assert.equal(p.status, 'pending');
    assert.ok(p.total >= 5, 'stary dziennik lekcyjny jest po terminie');
    const ids = p.classes.map((x) => x.class);
    assert.ok(ids.includes('dziennik-lekcyjny'));
    assert.equal(ids.includes('protokoly-brakowania'), false, 'kategoria A nigdy nie jest proponowana');
    assert.equal(ids.includes('ksiega-uczniow'), false, 'księga uczniów może być kategorią A — nie proponujemy jej');
    assert.equal(ids.includes('dziennik-zdarzen'), false, 'klasy operacyjne nie idą przez brakowanie');
    assert.equal(ids.includes('konfiguracja-szkoly'), false, 'dane robocze programu nie są brakowane');
    const blocked = p.neverDeleted.map((x) => x.class);
    assert.ok(blocked.includes('protokoly-brakowania') && blocked.includes('ksiega-uczniow'));
    assert.equal(p.requiresConsent, true);
    assert.equal(p.requiresSecondPerson, true);
    assert.match(p.message, /druga osoba|drugiej osoby|zgody Archiwum Państwowego/);

    /* R3-03: propozycja niesie LICZBY i datę odcięcia, nigdy listy identyfikatorów. */
    const row = s.db.get('retentionProposals', p.proposalId);
    assert.equal(row.items, undefined, 'propozycja nie przechowuje listy identyfikatorów');
    assert.equal(row.cutoff, row.today);
    assert.equal(row.byClass['dziennik-lekcyjny'], 5);
    assert.equal(row.perCollection['dziennik-lekcyjny'].attendance, 4);
    assert.ok(JSON.stringify(row).length < 4000, 'wiersz propozycji zostaje mały niezależnie od liczby wierszy');

    /* dwa odczyty = jedna propozycja (idempotentnie), a nie dwa wiersze */
    const again = expectOk(await c.get('/api/admin/retention/proposal'));
    assert.equal(again.proposalId, p.proposalId);
    assert.equal(s.db.col('retentionProposals').length, 1);
  } finally { await s.close(); }
});

test('brakowanie na cztery oczy: kto ułożył listę, ten jej nie zatwierdza (S3-11)', async () => {
  const s = await serverWithExpired();
  try {
    const c = await s.as('admin');
    const p = expectOk(await c.get('/api/admin/retention/proposal'));
    assert.equal(s.db.get('retentionProposals', p.proposalId).byUserId, 'u_admin');

    const self = await c.post('/api/admin/retention/approve', { proposalId: p.proposalId, archiveConsentReference: 'AP Kraków, zgoda nr 1/2033' });
    assert.equal(self.status, 409);
    assert.equal(self.body.code, 'same_actor');
    assert.equal(self.body.proposedBy, 'u_admin');
    assert.equal(s.db.get('retentionProposals', p.proposalId).status, 'pending', 'nic się nie zmieniło');

    const dyr = await s.as('dyrektor');
    const bare = await dyr.post('/api/admin/retention/approve', { proposalId: p.proposalId });
    assert.equal(bare.status, 400);
    assert.equal(bare.body.code, 'archive_consent_required');

    const ok = expectOk(await dyr.post('/api/admin/retention/approve', { proposalId: p.proposalId, archiveConsentReference: 'AP Kraków, zgoda nr 17/2033 z 12.01.2033' }));
    assert.equal(ok.status, 'approved');
    assert.equal(ok.proposedBy, 'u_admin');
    assert.equal(ok.approvedBy, 'u_dyrektor');
    assert.ok(ok.confirmationToken && ok.confirmationToken.length > 8, 'zatwierdzenie wydaje jednorazowe potwierdzenie');
    assert.equal(ok.byClass['dziennik-lekcyjny'], 5);

    const row = s.db.col('audit').find((a) => a.action === 'retention_proposal_approved');
    assert.ok(row, 'zatwierdzenie zostawia wpis audytowy');
    assert.equal(row.after.proposedBy, 'u_admin');
    assert.equal(row.after.approvedBy, 'u_dyrektor');
    assert.equal(row.after.archiveConsentReference, 'AP Kraków, zgoda nr 17/2033 z 12.01.2033');

    assert.equal((await dyr.post('/api/admin/retention/approve', { proposalId: p.proposalId, archiveConsentReference: 'x2' })).status, 409);
    assert.equal((await c.post('/api/admin/retention/approve', { proposalId: 'prop_nie_ma', archiveConsentReference: 'AP 1/2033' })).status, 404);
    const teacher = await s.as('j.nowak');
    assert.equal((await teacher.get('/api/admin/retention/proposal')).status, 403, 'nauczyciel nie brakuje akt');
  } finally { await s.close(); }
});

test('wykonanie wymaga jednorazowego potwierdzenia z zatwierdzenia i zużywa je (S3-11)', async () => {
  const s = await serverWithExpired();
  try {
    const c = await s.as('admin'); const dyr = await s.as('dyrektor');
    const p = expectOk(await c.get('/api/admin/retention/proposal'));
    const ap = expectOk(await dyr.post('/api/admin/retention/approve', { proposalId: p.proposalId, archiveConsentReference: 'AP Kraków, zgoda nr 5/2033' }));

    const noToken = await c.post('/api/admin/retention/run', { confirm: true, reason: 'brakowanie bez potwierdzenia', proposalId: p.proposalId });
    assert.equal(noToken.status, 403);
    assert.equal(noToken.body.code, 'confirmation_required');
    assert.ok(s.db.get('attendance', 'att_r5_0'), 'odmowa niczego nie usunęła');

    const wrong = await c.post('/api/admin/retention/run', { confirm: true, reason: 'brakowanie ze zmyślonym potwierdzeniem', proposalId: p.proposalId, confirmationToken: 'conf_zmyslone' });
    assert.equal(wrong.status, 403);
    assert.equal(wrong.body.code, 'confirmation_required');

    const run = expectOk(await c.post('/api/admin/retention/run', { confirm: true, reason: 'brakowanie wg protokołu 1/2033', proposalId: p.proposalId, confirmationToken: ap.confirmationToken }));
    assert.equal(run.archivalDeleted, 5);
    assert.equal(s.db.get('attendance', 'att_r5_0'), undefined);

    /* potwierdzenie jest jednorazowe: ta sama propozycja drugi raz to 409, a nie ciche powtórzenie */
    const replay = await c.post('/api/admin/retention/run', { confirm: true, reason: 'powtórka', proposalId: p.proposalId, confirmationToken: ap.confirmationToken });
    assert.equal(replay.status, 409);
    assert.equal(replay.body.code, 'proposal_executed');
    assert.equal(s.db.get('retentionProposals', p.proposalId).confirmationToken, null, 'potwierdzenie zużyte');
  } finally { await s.close(); }
});

test('uruchomienie bez zatwierdzenia sprząta wyłącznie klasy operacyjne', async () => {
  const s = await serverWithExpired();
  try {
    const c = await s.as('admin');
    const attBefore = s.db.col('attendance').length;
    const dry = expectOk(await c.post('/api/admin/retention/run', {}));
    assert.equal(dry.dryRun, true);
    assert.equal(dry.archivalDue >= 5, true);
    assert.equal(s.db.col('attendance').length, attBefore, 'podgląd niczego nie rusza');
    assert.ok(Array.isArray(dry.uncovered), 'podgląd też mówi, co jest bez klasy');

    const run = expectOk(await c.post('/api/admin/retention/run', { confirm: true, reason: 'nocne sprzątanie dzienników technicznych' }));
    assert.equal(run.deleted.audit, 3, 'rejestr zdarzeń po polityce znika');
    assert.equal(run.archivalDeleted, 0);
    assert.equal(run.proposalId, null);
    assert.equal(run.status, 'completed');
    assert.equal(s.db.col('attendance').length, attBefore, 'dziennik lekcyjny B5 zostaje — wymaga zgody archiwum');
    assert.ok(s.db.get('attendance', 'att_r5_0'), 'stara frekwencja nadal jest');
    assert.ok(s.db.get('retentionRuns', 'run_r5_old'), 'kategoria A nietknięta');
    assert.ok(s.db.get('students', 'st_r5_old'), 'księga uczniów nietknięta');
    assert.equal(run.byClass['dziennik-zdarzen'], 3);
    assert.equal(run.byClass['dziennik-lekcyjny'], undefined);

    /* propozycja niezatwierdzona nie da się wykonać */
    const p = expectOk(await c.get('/api/admin/retention/proposal'));
    const refused = await c.post('/api/admin/retention/run', { confirm: true, reason: 'próba bez zgody archiwum', proposalId: p.proposalId });
    assert.equal(refused.status, 403);
    assert.equal(refused.body.code, 'approval_required');
    assert.ok(s.db.get('attendance', 'att_r5_0'), 'odmowa niczego nie usunęła');
  } finally { await s.close(); }
});

test('wykonanie zatwierdzonego brakowania: usuwa klasy B, zostawia protokół i wpis audytowy z liczbami i zgodą', async () => {
  const s = await serverWithExpired();
  try {
    const c = await s.as('admin'); const dyr = await s.as('dyrektor');
    const p = expectOk(await c.get('/api/admin/retention/proposal'));
    const consent = 'AP Kraków, zgoda nr 42/2033 z 03.02.2033';
    const ap = expectOk(await dyr.post('/api/admin/retention/approve', { proposalId: p.proposalId, archiveConsentReference: consent }));

    const run = expectOk(await c.post('/api/admin/retention/run', { confirm: true, reason: 'brakowanie wg protokołu 1/2033', proposalId: p.proposalId, confirmationToken: ap.confirmationToken }));
    assert.equal(run.archivalDeleted, 5);
    assert.equal(run.byClass['dziennik-lekcyjny'], 5);
    assert.equal(run.archiveConsentReference, consent);
    assert.equal(s.db.get('attendance', 'att_r5_0'), undefined, 'frekwencja po terminie usunięta');
    assert.equal(s.db.get('remarks', 'rem_r5_1'), undefined);
    assert.ok(s.db.get('retentionRuns', 'run_r5_old'), 'kategoria A nadal nietknięta');
    assert.ok(s.db.get('students', 'st_r5_old'), 'księga uczniów nadal nietknięta');

    const protokol = s.db.col('retentionRuns').find((x) => x.id === run.runId);
    assert.equal(protokol.archiveConsentReference, consent);
    assert.equal(protokol.byClass['dziennik-lekcyjny'], 5);
    assert.equal(protokol.status, 'completed');
    assert.equal(protokol.proposedBy, 'u_admin');
    assert.equal(protokol.approvedBy, 'u_dyrektor');
    assert.equal(protokol.planned.archival, 5, 'protokół zapisuje, ile ZAMIERZAŁ usunąć, zanim usunął');
    const aud = s.db.col('audit').filter((a) => a.action === 'retention_executed').pop();
    assert.equal(aud.after.plannedArchival, 5);
    assert.equal(aud.after.archiveConsentReference, consent);
    assert.equal(aud.after.status, 'started', 'wpis audytowy powstaje PRZED usunięciem');
    assert.match(aud.reason, /zgoda archiwum/);
    const done = s.db.col('audit').filter((a) => a.action === 'retention_completed').pop();
    assert.equal(done.after.archivalDeleted, 5);
    assert.equal(s.db.get('retentionProposals', p.proposalId).status, 'executed');
  } finally { await s.close(); }
});

/* --------------------------------------------------------------------------- trwałość (R3-02) -- */
/**
 * Protokół musi być na dysku, ZANIM cokolwiek zniknie. Dziecko wykonuje prawdziwe brakowanie,
 * a zabijamy je (SIGKILL) w chwili, gdy podmieniana jest pierwsza kolekcja — czyli w środku
 * sprzątania. Po ponownym otwarciu magazynu protokół i wpis audytowy mają tam być.
 */
test('kill -9 w środku sprzątania zostawia protokół brakowania i wpis audytowy (R3-02)', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'edmat-ret-crash-'));
  const file = path.join(dir, 'school.json');
  const childFile = path.join(dir, 'child.js');
  fs.writeFileSync(childFile, `
    const { startServer } = require(${JSON.stringify(path.join(ROOT, 'tests', 'helpers'))});
    const { Store } = require(${JSON.stringify(path.join(ROOT, 'server', 'lib', 'store'))});
    const SWEEP = new Set(['audit', 'attendance', 'remarks', 'sessions', 'notifications', 'messages']);
    const orig = Store.prototype._setTop;
    Store.prototype._setTop = function (k, v) {
      if (globalThis.__armed && SWEEP.has(k)) {
        process.kill(process.pid, 'SIGKILL');
        const until = Date.now() + 5000; while (Date.now() < until) { /* czekamy na sygnał */ }
      }
      return orig.call(this, k, v);
    };
    (async () => {
      const S = await startServer({ dataFile: ${JSON.stringify(file)} });
      const db = S.db;
      for (let i = 0; i < 4; i++) db.col('attendance').push({ id: 'att_r5_' + i, lessonId: 'les_r5', studentId: 'st_kowalczyk_anna', date: '2010-09-15', lessonNo: 1, classId: '7b', subjectId: 'mat', status: 'ob', byUserId: 'u_nowak', at: '2010-09-15T08:00:00Z' });
      db.col('remarks').push({ id: 'rem_r5_1', studentId: 'st_kowalczyk_anna', teacherId: 'u_nowak', kind: 'neutral', text: 'stara uwaga', date: '2010-09-15' });
      const old = new Date(db.data.config.today + 'T00:00:00Z'); old.setUTCFullYear(old.getUTCFullYear() - (db.data.config.logRetentionYears || 5) - 1);
      for (let i = 0; i < 3; i++) db.col('audit').push({ id: 'aud_r5_' + i, at: old.toISOString(), userId: 'u_nowak', action: 'grade_update', entity: 'grades', entityId: 'g' + i });
      db.flush();
      const a = await S.as('admin'); const d = await S.as('dyrektor');
      const p = (await a.get('/api/admin/retention/proposal')).body;
      const ap = (await d.post('/api/admin/retention/approve', { proposalId: p.proposalId, archiveConsentReference: 'AP 9/2033' })).body;
      console.log('ready ' + p.proposalId);
      globalThis.__armed = true;
      await a.post('/api/admin/retention/run', { confirm: true, reason: 'brakowanie przerwane awarią zasilania', proposalId: p.proposalId, confirmationToken: ap.confirmationToken });
      console.log('finished');
    })().catch((e) => { console.error(e); process.exit(3); });
  `);
  const kid = spawn(process.execPath, [childFile], { stdio: ['ignore', 'pipe', 'pipe'] });
  let out = ''; let err = '';
  kid.stdout.on('data', (b) => { out += String(b); });
  kid.stderr.on('data', (b) => { err += String(b); });
  const exit = await new Promise((resolve) => {
    const t = setTimeout(() => { kid.kill('SIGKILL'); resolve({ timedOut: true }); }, 60000);
    kid.on('exit', (code, signal) => { clearTimeout(t); resolve({ code, signal }); });
  });
  assert.ok(out.includes('ready'), 'dziecko musiało dojść do zatwierdzonego brakowania: ' + err.slice(0, 400));
  assert.equal(exit.timedOut, undefined, 'dziecko nie może wisieć');
  assert.equal(out.includes('finished'), false, 'brakowanie miało zostać przerwane w środku');
  assert.equal(exit.signal, 'SIGKILL', 'proces miał zginąć od kill -9, a nie zakończyć się sam');

  const db = new Store(file, { lock: false });
  try {
    db.load();
    const runs = db.data.retentionRuns || [];
    assert.equal(runs.length, 1, 'protokół brakowania przeżył awarię');
    assert.equal(runs[0].status, 'started', 'protokół mówi wprost, że brakowanie się nie domknęło');
    assert.equal(runs[0].archiveConsentReference, 'AP 9/2033');
    assert.ok(runs[0].planned.archival > 0);
    assert.equal(runs[0].proposedBy, 'u_admin');
    assert.equal(runs[0].approvedBy, 'u_dyrektor');
    const aud = (db.data.audit || []).filter((a) => a.action === 'retention_executed');
    assert.equal(aud.length, 1, 'wpis audytowy o brakowaniu przeżył awarię');
    assert.equal(aud[0].after.runId, runs[0].id);
    assert.equal((db.data.audit || []).filter((a) => a.action === 'retention_completed').length, 0, 'domknięcia nie było');
    const prop = (db.data.retentionProposals || [])[0];
    assert.equal(prop.status, 'approved', 'zatwierdzenie też jest trwałe — ekran nie zaprosi do ponownego zatwierdzania');
    assert.ok(prop.confirmationUsedAt, 'potwierdzenie zostało zużyte, więc nikt nie powtórzy tego brakowania po cichu');
  } finally { db.close(); fs.rmSync(dir, { recursive: true, force: true }); }
});

/* ----------------------------------------------------------------------- zgodność wstecz ------- */
test('stary kształt config.retention migruje przy odczycie (płaska mapa i lista bez kategorii)', async () => {
  const s = await startServer();
  try {
    /* 1. płaska mapa „klasa → liczba lat”, jaką trzymały wcześniejsze instalacje */
    s.db.data.config.retention = { audit: 7, sessions: 30, grades: 60, dziennik: 6, nurse: 30 };
    const flat = RET.policy(s.db);
    assert.equal(flat.version, 3);
    assert.equal(flat.migratedFrom, 'legacy-flat');
    assert.equal(flat.classes.find((x) => x.class === 'dziennik-lekcyjny').years, 6);
    assert.equal(flat.classes.find((x) => x.class === 'sesje').days, 30);
    assert.equal(flat.classes.find((x) => x.class === 'dokumentacja-medyczna').years, 30);
    /* config.logRetentionYears/gradesArchiveRetentionYears to żywe pokrętła (PATCH /api/admin/retention)
       i mają pierwszeństwo przed tym, co zapisała starsza wersja programu */
    assert.equal(flat.classes.find((x) => x.class === 'arkusze-ocen').years, s.db.data.config.gradesArchiveRetentionYears);
    assert.equal(flat.classes.find((x) => x.class === 'dziennik-zdarzen').years, s.db.data.config.logRetentionYears);
    assert.ok(flat.classes.every((x) => x.category && x.clock && x.collections.length));

    /* 2. sama lista klas, bez kategorii i bez kolekcji — z klasą wycofaną w rundzie 3 */
    s.db.data.config.retention = [{ class: 'dziennik-lekcyjny', years: 8 }, { class: 'sesje', days: 14 }, { class: 'protokoly-rady-pedagogicznej', years: null }];
    const list = RET.policy(s.db);
    const dz = list.classes.find((x) => x.class === 'dziennik-lekcyjny');
    assert.equal(dz.years, 8);
    assert.equal(dz.category, 'B5', 'kategoria uzupełniona z tabeli domyślnej');
    assert.ok(dz.collections.includes('attendance') && dz.collections.includes('excuses'));
    assert.equal(list.classes.find((x) => x.class === 'sesje').days, 14);
    assert.equal(list.classes.find((x) => x.class === 'protokoly-rady-pedagogicznej'), undefined, 'klasa wycofana znika przy odczycie');
    assert.ok(list.classes.find((x) => x.class === 'uchwaly-klasyfikacyjne'), 'jej miejsce zajmują nowe klasy');
    assert.ok(list.classes.find((x) => x.class === 'rejestr-wypadkow'), 'klasa dodana w nowszej wersji dochodzi sama');
    assert.deepEqual(RET.uncoveredCollections(s.db), [], 'po migracji nadal żadna kolekcja nie zostaje bez klasy');
    assert.equal(RET.retentionDeadline(dz, { date: '2026-10-23' }, s.db), '2036-01-01');

    /* 3. brak klucza w ogóle → czysta tabela domyślna, API nadal odpowiada */
    delete s.db.data.config.retention;
    assert.equal(RET.policy(s.db).migratedFrom, 'defaults');
    const c = await s.as('admin');
    const d = expectOk(await c.get('/api/admin/retention'));
    assert.equal(d.retention.classes.length, RET.DEFAULT_CLASSES.length);
    expectOk(await c.get('/api/admin/retention/report'));
  } finally { await s.close(); }
});

test('dyrektor widzi propozycję brakowania, ale nie uruchamia zadania retencyjnego', async () => {
  const c = await principal();
  const p = expectOk(await c.get('/api/admin/retention/proposal'));
  assert.equal(p.total, 0, 'w zaseedowanej szkole nic nie jest po terminie');
  assert.match(p.message, /nie ma czego brakować/);
  assert.equal((await c.post('/api/admin/retention/run', { confirm: true, reason: 'dyrektor nie uruchamia zadania' })).status, 403);
});
