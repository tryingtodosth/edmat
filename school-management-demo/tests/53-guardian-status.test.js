'use strict';
/* R3 — status władzy rodzicielskiej przy opiekunie i reguła dostępu do danych ucznia pełnoletniego.
   Tło prawne i decyzje: docs/GUARDIANS.md, wiersze 9 i 10 w docs/research/2026-09-23-gemini-triage.md.
   Testy są niezależne od kolejności: wspólny stan powstaje przez `fixtures()`, a każdy test sprząta
   po sobie wpisy przy uczniu, żeby uruchomiony sam dawał ten sam wynik, co w całym pliku. */
const test = require('node:test'); const assert = require('node:assert/strict');
const { startServer, expectOk, fixtures, withConfig } = require('./helpers');
const D = require('../server/lib/domain');

let S; test.before(async () => { S = await startServer(); }); test.after(() => S.close());

const ANNA = 'st_kowalczyk_anna';          // 7b, dwoje opiekunów (rozwód)
const PIOTR = 'st_kowalczyk_piotr';        // 3a, ten sam opiekun co Anna
const OLA = 'st_borowska_aleksandra';      // 8b, ur. 2008-05-14 — pełnoletnia od 14.05.2026
const MARTA = 'u_p_kowalczyk', TOMASZ = 'u_p_kowalczyk2', BOROWSKI = 'st_u_p_borowski';

const need = fixtures();
const registrar = () => need('registrar', () => S.as('sekretariat'));
/** Czyści wpisy zakresów przy uczniu (kolekcje są Proxy — zapis przez podstawienie i db.save). */
function clearGuardians(studentId) {
  const s = S.db.get('students', studentId);
  s.guardians = [];
  S.db.save();
}
/** Stan dostępu opiekunów ucznia pełnoletniego przywracany po testach trybu „zgoda wymagana”. */
function clearAdultAccess(studentId) {
  const s = S.db.get('students', studentId);
  s.adultConsent = null; s.parentAccessBlocked = false; s.parentAccessBlockedAt = null; s.parentAccessReason = null;
  S.db.save();
}
const basis = (reference, kind, date) => ({ kind: kind || 'court-order', reference, date: date || '2026-09-10' });

test('guardians: zakres wynika ze statusu władzy rodzicielskiej, gdy sekretariat go nie nadpisze', async () => {
  const c = await registrar();
  try {
    const cases = [
      ['full', 'full', null],
      ['limited', 'full', null],
      ['court-restricted', 'info', basis('III Nsm 101/26')],
      ['deprived', 'none', basis('III Nsm 102/26')]
    ];
    for (const [status, derived, b] of cases) {
      const body = { status, legalBasis: 'postanowienie sądu / oświadczenie — ' + status };
      if (b) body.basis = b;
      const r = expectOk(await c.patch('/api/registry/students/' + PIOTR + '/guardians/' + MARTA, body), 'status ' + status);
      assert.equal(r.guardian.guardianStatus, status);
      assert.equal(r.guardian.derivedScope, derived, 'zakres domyślny dla statusu ' + status);
      assert.equal(r.guardian.accessScope, derived, 'bez nadpisania obowiązuje zakres domyślny');
      assert.equal(r.guardian.scopeSource, 'derived');
      const entry = S.db.get('students', PIOTR).guardians.find((g) => g.userId === MARTA);
      assert.equal(entry.status, status);
      assert.equal(entry.accessScope, derived);
      assert.equal(D.guardianStatusScope(status), derived, 'ta sama reguła w domenie i w API');
    }
    // jawne nadpisanie zakresu: „ograniczona” z prawem do informacji zamiast pełnego wglądu
    const over = expectOk(await c.patch('/api/registry/students/' + PIOTR + '/guardians/' + MARTA,
      { status: 'limited', accessScope: 'info', legalBasis: 'wniosek matki z 12.09.2026', basis: basis('oświadczenie matki', 'declaration') }));
    assert.equal(over.guardian.accessScope, 'info');
    assert.equal(over.guardian.derivedScope, 'full', 'zakres domyślny zostaje widoczny obok nadpisanego');
    assert.equal(over.guardian.scopeSource, 'explicit');
  } finally { clearGuardians(PIOTR); }
});

test('guardians: pozbawienie władzy bez postanowienia sądu jest odrzucane', async () => {
  const c = await registrar();
  try {
    const noBasis = await c.patch('/api/registry/students/' + PIOTR + '/guardians/' + MARTA, { status: 'deprived', legalBasis: 'rozmowa telefoniczna' });
    assert.equal(noBasis.status, 400);
    assert.equal(noBasis.body.code, 'guardian_basis_required');
    assert.match(noBasis.body.error, /postanowienia sądu/);

    const declaration = await c.patch('/api/registry/students/' + PIOTR + '/guardians/' + MARTA,
      { status: 'deprived', legalBasis: 'oświadczenie', basis: { kind: 'declaration', reference: 'pismo z 1.09.2026' } });
    assert.equal(declaration.status, 400);
    assert.equal(declaration.body.code, 'guardian_basis_required', 'oświadczenie nie zastępuje orzeczenia');

    const noRef = await c.patch('/api/registry/students/' + PIOTR + '/guardians/' + MARTA,
      { status: 'deprived', legalBasis: 'postanowienie', basis: { kind: 'court-order', reference: '   ' } });
    assert.equal(noRef.status, 400);
    assert.equal(noRef.body.code, 'guardian_basis_reference_required');

    const badScope = await c.patch('/api/registry/students/' + PIOTR + '/guardians/' + MARTA,
      { status: 'deprived', accessScope: 'info', legalBasis: 'postanowienie', basis: basis('III Nsm 103/26') });
    assert.equal(badScope.status, 400);
    assert.equal(badScope.body.code, 'guardian_scope_conflict');
    assert.deepEqual(badScope.body.allowed, ['none']);

    const fullForCourt = await c.patch('/api/registry/students/' + PIOTR + '/guardians/' + MARTA,
      { status: 'court-restricted', accessScope: 'full', legalBasis: 'postanowienie', basis: basis('III Nsm 104/26') });
    assert.equal(fullForCourt.status, 400);
    assert.equal(fullForCourt.body.code, 'guardian_scope_conflict');

    const unknown = await c.patch('/api/registry/students/' + PIOTR + '/guardians/' + MARTA, { status: 'pozbawiony', legalBasis: 'x' });
    assert.equal(unknown.status, 400);
    assert.equal(unknown.body.code, 'guardian_status_unknown');
    assert.deepEqual(unknown.body.allowed, ['full', 'limited', 'deprived', 'court-restricted']);

    assert.equal(S.db.get('students', PIOTR).guardians.length, 0, 'żadna odrzucona próba nic nie zapisała');
  } finally { clearGuardians(PIOTR); }
});

test('guardians: „court-restricted” z zakresem „none” zamyka oceny i frekwencję w prawdziwym API', async () => {
  const c = await registrar();
  try {
    const r = expectOk(await c.patch('/api/registry/students/' + ANNA + '/guardians/' + TOMASZ,
      { status: 'court-restricted', accessScope: 'none', legalBasis: 'postanowienie sądu III Nsm 105/26',
        basis: basis('III Nsm 105/26'), note: 'sąd wyłączył prawo do informacji' }));
    assert.equal(r.guardian.accessScope, 'none');
    assert.equal(r.guardian.guardianStatus, 'court-restricted');

    const parent = await S.as('rodzic.kowalczyk2');
    for (const path of ['/api/parent/grades?studentId=' + ANNA, '/api/parent/attendance?studentId=' + ANNA]) {
      const denied = await parent.get(path);
      assert.equal(denied.status, 403, path);
      assert.equal(denied.body.deny, 'guardian_scope');
      assert.equal(denied.body.scope, 'none');
    }
    assert.equal(expectOk(await parent.get('/api/parent/children')).children.length, 0, 'dziecko znika z konta opiekuna');

    // drugi opiekun, z pełną władzą, widzi to samo dziecko bez zmian
    const druga = await S.as('rodzic.kowalczyk');
    assert.ok(expectOk(await druga.get('/api/parent/grades?studentId=' + ANNA)).subjects.length >= 1);

    /* R3/F1 — „none” zamyka także kanały, którymi dane idą SAME: rozsyłkę powiadomień, skrzynkę
       i decyzje opiekuna (D3-01/02/03, S3-04). Odmowa niesie status, na którym stoi. */
    assert.ok(!D.notifyParentsOf(S.db, ANNA, 'absence', 'Nieobecność na 1. lekcji — test 53').some((n) => n.userId === TOMASZ),
      'nawet alert kryzysowy nie omija postanowienia sądu');
    assert.equal(D.guardianStanding(S.db, S.db.get('users', TOMASZ), ANNA).reason, 'guardian_scope');
    assert.deepEqual(D.visibleStudentIds(S.db, S.db.get('users', TOMASZ)), []);
    assert.equal((await parent.get('/api/messages/pm_msg_warning_anna')).status, 403, 'pismo o uczennicy jest zamknięte');
    assert.deepEqual(expectOk(await parent.get('/api/parent/warnings')).warnings.filter((w) => w.studentId === ANNA), []);

    // „info” z tego samego statusu zostawia frekwencję, zabiera oceny
    expectOk(await c.patch('/api/registry/students/' + ANNA + '/guardians/' + TOMASZ,
      { status: 'court-restricted', accessScope: 'info', legalBasis: 'postanowienie sądu III Nsm 105/26', basis: basis('III Nsm 105/26') }));
    const parent2 = await S.as('rodzic.kowalczyk2');
    assert.equal((await parent2.get('/api/parent/grades?studentId=' + ANNA)).status, 403);
    expectOk(await parent2.get('/api/parent/attendance?studentId=' + ANNA), 'frekwencja przy zakresie informacyjnym');
    // „info” przepuszcza frekwencję i plan, zatrzymuje oceny, uwagi, gabinet i opłaty
    assert.ok(D.notifyParentsOf(S.db, ANNA, 'absence', 'Nieobecność — test 53 info').some((n) => n.userId === TOMASZ));
    for (const kind of ['grade', 'remark', 'behavior', 'gabinet', 'payment']) {
      assert.ok(!D.notifyParentsOf(S.db, ANNA, kind, `Test 53 info (${kind})`).some((n) => n.userId === TOMASZ), kind);
    }
  } finally { clearGuardians(ANNA); }
});

test('guardians: zmiana statusu i zakresu zostawia wiersz audytu z podstawą, stanem przed i po', async () => {
  const c = await registrar();
  try {
    expectOk(await c.patch('/api/registry/students/' + PIOTR + '/guardians/' + MARTA,
      { status: 'deprived', legalBasis: 'postanowienie sądu III Nsm 106/26', basis: basis('III Nsm 106/26', 'court-order', '2026-09-02') }));
    const rows = S.db.col('audit').filter((a) => a.entityId === PIOTR && (a.action === 'guardian_status_changed' || a.action === 'guardian_scope_changed'));
    const statusRow = rows.filter((a) => a.action === 'guardian_status_changed').pop();
    const scopeRow = rows.filter((a) => a.action === 'guardian_scope_changed').pop();
    assert.ok(statusRow, 'zmiana statusu ma własny wiersz audytu');
    assert.equal(statusRow.before.guardianStatus, 'full');
    assert.equal(statusRow.after.guardianStatus, 'deprived');
    assert.equal(statusRow.after.basis.kind, 'court-order');
    assert.equal(statusRow.after.basis.reference, 'III Nsm 106/26');
    assert.equal(statusRow.after.basis.date, '2026-09-02');
    assert.equal(statusRow.reason, 'postanowienie sądu III Nsm 106/26');
    assert.equal(scopeRow.before.accessScope, 'full');
    assert.equal(scopeRow.after.accessScope, 'none');
    assert.equal(scopeRow.after.derivedScope, 'none');
  } finally { clearGuardians(PIOTR); }
});

test('guardians: wpis bez pola „status” zachowuje się jak pełna władza rodzicielska', async () => {
  const anna = S.db.get('students', ANNA);
  try {
    // czysty odczyt domeny: dane sprzed R3 nie mają statusu
    assert.equal(D.guardianStatus({ userId: TOMASZ, accessScope: 'full' }), 'full');
    assert.equal(D.guardianStatus(null), 'full');
    assert.equal(D.guardianStatusScope(undefined), 'full');

    // wpis w starym kształcie — sam userId, bez statusu i bez zakresu
    anna.guardians = [{ userId: TOMASZ }];
    S.db.save();
    let parent = await S.as('rodzic.kowalczyk2');
    expectOk(await parent.get('/api/parent/grades?studentId=' + ANNA), 'brak statusu = pełny dostęp');

    // stary wpis z zakresem „info” działa tak, jak działał
    anna.guardians = [{ userId: TOMASZ, accessScope: 'info', legalBasis: 'postanowienie sądu III Nsm 88/26' }];
    S.db.save();
    parent = await S.as('rodzic.kowalczyk2');
    assert.equal((await parent.get('/api/parent/grades?studentId=' + ANNA)).status, 403);
    expectOk(await parent.get('/api/parent/attendance?studentId=' + ANNA));

    // sekretariat widzi taki wpis jako „full” i może zmienić sam zakres, bez podawania statusu
    const c = await registrar();
    const view = expectOk(await c.get('/api/registry/students/' + ANNA + '/guardians'));
    const g = view.guardians.find((x) => x.userId === TOMASZ);
    assert.equal(g.guardianStatus, 'full');
    assert.equal(g.derivedScope, 'full');
    assert.deepEqual(view.scopes, ['full', 'info', 'none']);
    assert.deepEqual(view.statuses, ['full', 'limited', 'deprived', 'court-restricted']);
    expectOk(await c.patch('/api/registry/students/' + ANNA + '/guardians/' + TOMASZ, { accessScope: 'full', legalBasis: 'oświadczenie ojca z 21.10.2026' }));
  } finally { clearGuardians(ANNA); }
});

test('adult: tryb „do sprzeciwu” zostawia opiekunowi wgląd po 18. urodzinach', async () => {
  try {
    assert.equal(S.db.data.config.adultAccess, 'until-objection', 'domyślne ustawienie szkoły');
    assert.equal(D.adultFrom({ birthDate: '2008-05-14' }), '2026-05-14');
    await withConfig(S.db, { adultAccess: 'until-objection', today: '2026-05-14' }, async () => {
      const parent = await S.as('rodzic.borowska');
      expectOk(await parent.get('/api/parent/grades?studentId=' + OLA), 'w dniu 18. urodzin nic się nie zmienia');
      const state = D.adultAccessState(S.db, S.db.get('students', OLA));
      assert.equal(state.adult, true);
      assert.equal(state.guardianAccess, 'open');
    });
  } finally { clearAdultAccess(OLA); }
});

test('adult: tryb „zgoda wymagana” odcina opiekuna w dniu 18. urodzin i wraca po zapisaniu zgody', async () => {
  try {
    await withConfig(S.db, { adultAccess: 'consent-required', today: '2026-05-13' }, async () => {
      const parent = await S.as('rodzic.borowska');
      expectOk(await parent.get('/api/parent/grades?studentId=' + OLA), 'dzień przed 18. urodzinami — bez zmian');
      assert.equal(D.adultAccessState(S.db, S.db.get('students', OLA)).adult, false);
    });

    await withConfig(S.db, { adultAccess: 'consent-required', today: '2026-05-14' }, async () => {
      const parent = await S.as('rodzic.borowska');
      for (const path of ['/api/parent/grades?studentId=' + OLA, '/api/parent/attendance?studentId=' + OLA]) {
        const denied = await parent.get(path);
        assert.equal(denied.status, 403, path);
        assert.equal(denied.body.deny, 'guardian_scope');
        assert.equal(denied.body.scope, 'none');
        assert.equal(denied.body.adultAccess, 'consent-required');
        assert.equal(denied.body.adultSince, '2026-05-14');
      }
      assert.equal(D.guardianScope(S.db, S.db.get('users', BOROWSKI), OLA), 'none');
      assert.deepEqual(D.notifyParentsOf(S.db, OLA, 'rights', 'test'), [], 'powiadomienia milkną razem z dostępem');

      // uczennica składa zgodę w sekretariacie
      const c = await registrar();
      const rec = expectOk(await c.post('/api/registry/students/' + OLA + '/adult-access', { consent: true, reason: 'pismo uczennicy z 14.05.2026' }));
      assert.equal(rec.guardianAccess, 'open');
      assert.equal(rec.consent.given, true);
      assert.equal(S.db.get('students', OLA).adultConsent.given, true);

      const after = await S.as('rodzic.borowska');
      expectOk(await after.get('/api/parent/grades?studentId=' + OLA), 'po zgodzie wgląd wraca');

      const audit = S.db.col('audit').filter((a) => a.action === 'adult_consent_recorded' && a.entityId === OLA).pop();
      assert.ok(audit, 'zapis zgody zostawia wiersz audytu');
      assert.equal(audit.before.consent, false);
      assert.equal(audit.after.consent, true);
      assert.equal(audit.after.mode, 'consent-required');

      // cofnięcie zgody to ten sam zapis, co sprzeciw — druga strona tej samej pary pól
      const back = expectOk(await c.post('/api/registry/students/' + OLA + '/adult-access', { consent: false, reason: 'pismo uczennicy z 20.05.2026' }));
      assert.equal(back.guardianAccess, 'blocked');
      assert.equal(S.db.get('students', OLA).parentAccessBlocked, true);
      const blocked = await S.as('rodzic.borowska');
      assert.equal((await blocked.get('/api/parent/grades?studentId=' + OLA)).status, 403);
    });
  } finally { clearAdultAccess(OLA); }
});

test('adult: sprzeciw ucznia pełnoletniego działa tak samo w obu trybach', async () => {
  try {
    const student = await S.as('aleksandra.borowska');
    expectOk(await student.post('/api/student/parent-access', { blocked: true, reason: 'sprzeciw z 23.10.2026' }));
    for (const mode of ['until-objection', 'consent-required']) {
      await withConfig(S.db, { adultAccess: mode }, async () => {
        const parent = await S.as('rodzic.borowska');
        const denied = await parent.get('/api/parent/grades?studentId=' + OLA);
        assert.equal(denied.status, 403, mode);
        assert.equal(D.adultAccessState(S.db, S.db.get('students', OLA)).guardianAccess, 'blocked');
      });
    }
    expectOk(await student.post('/api/student/parent-access', { blocked: false }));
    const parent = await S.as('rodzic.borowska');
    expectOk(await parent.get('/api/parent/grades?studentId=' + OLA), 'cofnięcie sprzeciwu przywraca wgląd');
  } finally { clearAdultAccess(OLA); }
});

test('adult: uczeń, opiekun i wychowawca czytają tę samą regułę i tę samą datę', async () => {
  try {
    await withConfig(S.db, { adultAccess: 'consent-required' }, async () => {
      const student = await S.as('aleksandra.borowska');
      const ses = expectOk(await student.get('/api/auth/session'));
      assert.equal(ses.config.adultAccess, 'consent-required');
      assert.equal(ses.adultAccess.mode, 'consent-required');
      assert.equal(ses.adultAccess.adultSince, '2026-05-14');
      assert.equal(ses.adultAccess.guardianAccess, 'pending-consent');
      assert.match(ses.adultAccess.rule, /zgod/i);

      const parent = await S.as('rodzic.borowska');
      const pses = expectOk(await parent.get('/api/auth/session'));
      assert.equal(pses.adultAccess.length, 1);
      assert.equal(pses.adultAccess[0].studentId, OLA);
      assert.equal(pses.adultAccess[0].guardianAccess, 'pending-consent');
      assert.equal(pses.adultAccess[0].since, '2026-05-14');

      const homeroom = await S.as('k.lis');                       // wychowawca 8b
      const view = expectOk(await homeroom.get('/api/registry/students/' + OLA + '/adult-access'));
      assert.equal(view.mode, 'consent-required');
      assert.equal(view.guardianAccess, 'pending-consent');
      assert.equal(view.since, '2026-05-14');
      assert.deepEqual(view.modes, ['until-objection', 'consent-required']);
      assert.ok(view.statusText.length > 40, 'reguła i stan jednym zdaniem');
      assert.equal(expectOk(await homeroom.get('/api/registry/students/' + OLA + '/flags')).adultAccess.mode, 'consent-required');

      const obcy = await S.as('a.wojcik');                        // nauczyciel spoza wychowawstwa
      assert.equal((await obcy.get('/api/registry/students/' + OLA + '/adult-access')).status, 403);
    });
  } finally { clearAdultAccess(OLA); }
});

test('adult: zapisu zgody nie da się zrobić uczniowi niepełnoletniemu', async () => {
  const c = await registrar();
  const r = await c.post('/api/registry/students/' + ANNA + '/adult-access', { consent: true, reason: 'pomyłka sekretariatu' });
  assert.equal(r.status, 400);
  assert.equal(r.body.code, 'not_adult');
  const noReason = await c.post('/api/registry/students/' + OLA + '/adult-access', { consent: true });
  assert.equal(noReason.status, 400);
  assert.equal(noReason.body.code, 'no_reason');
  const nothing = await c.post('/api/registry/students/' + OLA + '/adult-access', { reason: 'bez treści' });
  assert.equal(nothing.status, 400);
  assert.equal(nothing.body.code, 'consent_missing');
});
