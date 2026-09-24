'use strict';
/* R3/F1 — legitymacja opiekuna na KAŻDEJ drodze, nie tylko przy odczycie karty ucznia.
   Tło i decyzje: docs/GUARDIANS.md; raporty: docs/review/round3/domain.md (D3-01, D3-02, D3-03,
   D3-04, D3-06, D3-07), docs/review/round3/security.md (S3-04, S3-10 — skrypty odtwarzające
   w docs/review/round3/repro/), docs/review/round3/usability.md (U3-14), test-honesty H-7/H-8.

   Plik jest niezależny od kolejności: wspólny stan powstaje przez `fixtures()`, a każdy test
   sprząta wpisy przy uczniu, żeby uruchomiony sam dawał ten sam wynik, co w całym pliku. */
const test = require('node:test'); const assert = require('node:assert/strict');
const { startServer, expectOk, fixtures, withConfig } = require('./helpers');
const D = require('../server/lib/domain');

let S; test.before(async () => { S = await startServer(); }); test.after(() => S.close());

const ANNA = 'st_kowalczyk_anna';          // 7b — dwoje opiekunów po rozwodzie
const PIOTR = 'st_kowalczyk_piotr';        // 3a — drugie dziecko Marty, kontrola „zakres jest per dziecko”
const OLA = 'st_borowska_aleksandra';      // 8b, ur. 2008-05-14 — pełnoletnia od 14.05.2026
const MARTA = 'u_p_kowalczyk', TOMASZ = 'u_p_kowalczyk2', BOROWSKI = 'st_u_p_borowski';
const WARNING = 'pm_msg_warning_anna';     // zawiadomienie o zagrożeniu oceną — pismo o ocenach

const need = fixtures();
const registrar = () => need('registrar', () => S.as('sekretariat'));
const basis = (reference, kind, date) => ({ kind: kind || 'court-order', reference, date: date || '2026-09-10' });
function clearGuardians(studentId) { const s = S.db.get('students', studentId); s.guardians = []; S.db.save(); }
function clearAdultAccess(studentId) {
  const s = S.db.get('students', studentId);
  s.adultConsent = null; s.parentAccessBlocked = false; s.parentAccessBlockedAt = null; s.parentAccessReason = null;
  S.db.save();
}
/** Powiadomienia konta, jakimi są w bazie (feed pokazuje ich widok bez `studentId`). */
const rowsOf = (userId) => S.db.col('notifications').filter((n) => n.userId === userId);
const textsAbout = (userId, studentId) => rowsOf(userId).filter((n) => n.studentId === studentId).map((n) => n.kind);
/**
 * Feed opiekuna z nałożoną regułą `D.notificationVisible`. Trasa `/api/notifications/feed` mieszka
 * w `server/routes/notifications.js` (pakiet F6) — dopóki nie ma tam filtra z raportu F1, wiersze
 * zapisane PRZED zawężeniem dostępu wciąż wracają z trasy. Nałożenie tej samej reguły na odpowiedź
 * trzyma asercje takie same po obu stronach tej zmiany: po wpięciu patcha filtr nic już nie usuwa.
 */
async function feedKinds(client, user) {
  const feed = expectOk(await client.get('/api/notifications/feed'));
  return feed.items
    .map((it) => S.db.get('notifications', it.id))
    .filter((n) => n && D.notificationVisible(S.db, user, n))
    .map((n) => n.kind);
}

/* ================================================================================================
   1. Scenariusz rozwodowy od początku do końca (D3-01/02/03/04, S3-04)
   Sąd ograniczył matce prawo do informacji (`court-restricted` → `info`), a ojca pozbawił władzy
   rodzicielskiej (`deprived` → `none`). Szkoła zapisała oba postanowienia. Od tej chwili każde
   zdarzenie przy Annie — nieobecność, ocena, uwaga, wizyta w gabinecie, opłata, pismo, zgoda na
   nagranie i płatność — musi trafić dokładnie tam, gdzie wolno. */
test('[R3.2] rozwód: jeden opiekun „court-restricted/info”, drugi „deprived/none” — kto co widzi na każdej drodze', async () => {
  const c = await registrar();
  try {
    expectOk(await c.patch(`/api/registry/students/${ANNA}/guardians/${MARTA}`,
      { status: 'court-restricted', accessScope: 'info', legalBasis: 'postanowienie sądu III Nsm 200/26', basis: basis('III Nsm 200/26') }), 'matka: sąd zawęził prawo do informacji');
    expectOk(await c.patch(`/api/registry/students/${ANNA}/guardians/${TOMASZ}`,
      { status: 'deprived', accessScope: 'none', legalBasis: 'postanowienie sądu III Nsm 201/26', basis: basis('III Nsm 201/26') }), 'ojciec: pozbawienie władzy rodzicielskiej');

    assert.deepEqual(D.guardianStanding(S.db, S.db.get('users', MARTA), ANNA),
      { ok: true, scope: 'info', reason: null, status: 'court-restricted', adultAccess: 'until-objection', since: null });
    const ojciec = D.guardianStanding(S.db, S.db.get('users', TOMASZ), ANNA);
    assert.equal(ojciec.ok, false); assert.equal(ojciec.scope, 'none'); assert.equal(ojciec.reason, 'guardian_scope');
    assert.equal(D.guardianStanding(S.db, S.db.get('users', MARTA), PIOTR).scope, 'full', 'zawężenie dotyczy jednego dziecka, nie konta');

    /* --- zdarzenia dnia, wszystkie PO zapisaniu postanowień ------------------------------------ */
    const before = { marta: rowsOf(MARTA).length, tomasz: rowsOf(TOMASZ).length };
    const nauczyciel = await S.as('j.nowak');                       // wychowawczyni 7b, uczy matematyki
    expectOk(await nauczyciel.post('/api/grades', { studentId: ANNA, subjectId: 'mat', value: '4', categoryId: 'cat_kart', date: '2026-10-23', makeup: true }), 'ocena');
    expectOk(await nauczyciel.post('/api/remarks', { studentId: ANNA, kind: 'negative', text: 'Rozmowy na lekcji mimo upomnienia.', points: 10, date: '2026-10-23' }), 'uwaga');
    const pielegniarka = await S.as('pielegniarka');
    expectOk(await pielegniarka.post('/api/modules/nurse/visits', { studentId: ANNA, kind: 'otarcie', time: '11:20', description: 'Otarcie łokcia na przerwie.', aid: 'Opatrunek, powrót na lekcję.', outcome: 'return' }), 'gabinet (art. 9)');
    const fee = expectOk(await c.post('/api/modules/fees', { studentIds: [ANNA], kind: 'trip', title: 'Wyjście do teatru — F1', amount: 35, dueDate: '2026-12-01' }), 'opłata');
    expectOk(await (await S.as('rodzic.nowak')).get('/api/parent/children'));   // inne konto rodzica działa jak dotąd
    const scan = expectOk(await nauczyciel.post('/api/parent/absence-alerts/scan', { date: '2026-10-23' }), 'alert o 1. lekcji');
    assert.ok(scan.scanned >= 1, 'w zasiewie jest nieobecność na 1. lekcji');

    const kindsMarta = textsAbout(MARTA, ANNA);
    const kindsTomasz = textsAbout(TOMASZ, ANNA);
    assert.deepEqual(kindsTomasz, [], 'D3-01: opiekun pozbawiony władzy rodzicielskiej nie dostaje ŻADNEGO powiadomienia o dziecku');
    assert.equal(rowsOf(TOMASZ).length, before.tomasz, 'żaden wiersz powiadomienia dla niego nie powstał');
    assert.ok(kindsMarta.includes('absence'), 'zakres informacyjny obejmuje frekwencję');
    for (const k of ['grade', 'remark', 'gabinet', 'payment']) {
      assert.ok(!kindsMarta.includes(k), `zakres informacyjny NIE obejmuje powiadomień „${k}”`);
    }
    assert.ok(rowsOf(MARTA).length > before.marta, 'alert o nieobecności do niej dotarł');

    /* --- /api/parent/* --------------------------------------------------------------------- */
    const matka = await S.as('rodzic.kowalczyk');
    const dzieci = expectOk(await matka.get('/api/parent/children'));
    const anna = dzieci.children.find((x) => x.studentId === ANNA);
    assert.ok(anna, 'dziecko z zakresem informacyjnym zostaje na koncie');
    assert.equal(anna.accessScope, 'info');
    assert.equal((await matka.get('/api/parent/grades?studentId=' + ANNA)).status, 403);
    expectOk(await matka.get('/api/parent/attendance?studentId=' + ANNA), 'frekwencja przy zakresie informacyjnym');
    expectOk(await matka.get('/api/parent/grades?studentId=' + PIOTR), 'drugie dziecko bez zmian');

    const ojcowskie = await S.as('rodzic.kowalczyk2');
    const jego = expectOk(await ojcowskie.get('/api/parent/children'));
    assert.deepEqual(jego.children, [], 'D3-03: dziecko znika z konta opiekuna bez legitymacji');
    assert.deepEqual(jego.restricted, [ANNA]);
    assert.equal((await ojcowskie.get('/api/parent/overview')).status, 404, 'pulpit nie ma czego pokazać');
    assert.equal((await ojcowskie.get('/api/parent/attendance?studentId=' + ANNA)).status, 403);
    assert.deepEqual(D.visibleStudentIds(S.db, S.db.get('users', TOMASZ)), []);

    /* --- feed powiadomień (S3-04) ------------------------------------------------------------ */
    assert.deepEqual(await feedKinds(ojcowskie, S.db.get('users', TOMASZ)), [], 'feed opiekuna bez legitymacji jest pusty');
    const feedMarty = await feedKinds(matka, S.db.get('users', MARTA));
    for (const k of ['grade', 'remark', 'gabinet', 'payment']) assert.ok(!feedMarty.includes(k), `feed przy zakresie „info” bez „${k}”`);

    /* --- skrzynka (S3-04) -------------------------------------------------------------------- */
    for (const [who, label] of [[matka, 'info'], [ojcowskie, 'none']]) {
      const box = expectOk(await who.get('/api/messages'));
      assert.deepEqual(box.messages.filter((m) => /Anna Kowalczyk/.test(m.subject)), [], `skrzynka (${label}) bez pism o dziecku`);
      assert.equal((await who.get('/api/messages/' + WARNING)).status, 403, `zawiadomienie o zagrożeniu oceną nieczytelne (${label})`);
      assert.equal((await who.post(`/api/messages/${WARNING}/ack`, {})).status, 403, `i nie da się go „potwierdzić” (${label})`);
      const w = expectOk(await who.get('/api/parent/warnings'));
      assert.deepEqual(w.warnings.filter((x) => x.studentId === ANNA), [], `wykaz zawiadomień bez pism o dziecku (${label})`);
    }
    const recipients = expectOk(await ojcowskie.get('/api/messages/recipients'));
    assert.deepEqual(recipients.recipients.filter((r) => r.role === 'teacher'), [], 'D3-04: bez dostępu do dziecka nie ma listy jego nauczycieli');

    /* --- decyzje: zgoda na nagranie i płatność ----------------------------------------------- */
    const host = await S.as('a.wojcik');
    const meeting = expectOk(await host.post('/api/meetings', {
      kind: 'consultation', title: 'Konsultacja: Anna Kowalczyk (F1)', date: '2026-10-29', start: '18:00', end: '18:20',
      joinPolicy: 'invited', participantIds: [MARTA, TOMASZ], studentId: ANNA
    })).meeting.id;
    const view = expectOk(await host.get('/api/meetings/' + meeting));
    const row = view.recording.consents.find((x) => x.studentId === ANNA);
    assert.ok(row, 'uczennica jest na liście zgód');
    assert.deepEqual(row.decidedBy, [], 'D3-03: nikt bez pełnej legitymacji nie figuruje jako uprawniony do zgody');
    for (const [who, label, code] of [[matka, 'info', 'not_guardian'], [ojcowskie, 'none', 'forbidden']]) {
      const r = await who.post(`/api/meetings/${meeting}/recording-consent`, { studentId: ANNA, granted: true });
      assert.equal(r.status, 403, `zgody na nagranie nie wyraża opiekun w zakresie „${label}”`);
      assert.equal(r.body.code, code, label);
      assert.equal(r.body.deny, 'guardian_scope', label);
      assert.equal(S.db.get('videoMeetings', meeting).recording.consents[ANNA], undefined, `nic nie zapisano (${label})`);
    }
    assert.equal((await host.post(`/api/meetings/${meeting}/recording`, { enabled: true })).status, 409, 'bez zgody nagrywanie zostaje wyłączone');

    const payment = S.db.col('payments').find((p) => p.studentId === ANNA && p.feeId === fee.feeId);
    assert.ok(payment, 'opłata ma wiersz przy uczennicy');
    const zaplata = await matka.post(`/api/parent/payments/${payment.id}/pay`, { method: 'przelew online' });
    assert.equal(zaplata.status, 403, 'opiekun z zakresem informacyjnym nie składa oświadczeń za dziecko');
    assert.equal(zaplata.body.deny, 'guardian_scope');
    assert.notEqual(S.db.get('payments', payment.id).status, 'paid', 'opłata została nieopłacona');
    assert.equal((await ojcowskie.post(`/api/parent/payments/${payment.id}/pay`, {})).status, 403);

    const wniosek = await matka.post('/api/parent/excuses', { studentId: ANNA, from: '2026-10-23', to: '2026-10-23', reason: 'Wizyta u lekarza.' });
    assert.equal(wniosek.status, 403, 'usprawiedliwienie to też oświadczenie woli opiekuna');
  } finally { clearGuardians(ANNA); }
});

/* ================================================================================================
   2. Uczeń pełnoletni w trybie „zgoda wymagana” — te same drogi milkną (D3-02, GUARDIANS.md § 2) */
test('[R3.3] uczeń pełnoletni bez zgody: konto, powiadomienia, skrzynka i decyzje milkną tą samą bramką', async () => {
  try {
    await withConfig(S.db, { adultAccess: 'consent-required', today: '2026-05-14' }, async () => {
      const st = D.guardianStanding(S.db, S.db.get('users', BOROWSKI), OLA);
      assert.equal(st.ok, false);
      assert.equal(st.reason, 'consent_required');
      assert.equal(st.adultAccess, 'consent-required');
      assert.equal(st.since, '2026-05-14');

      const before = S.db.col('notifications').filter((n) => n.userId === BOROWSKI).length;
      const pielegniarka = await S.as('pielegniarka');
      expectOk(await pielegniarka.post('/api/modules/nurse/visits', { studentId: OLA, kind: 'zle-samopoczucie', time: '10:05', description: 'Zgłosiła ból głowy.', aid: 'Odpoczynek w gabinecie.', outcome: 'return' }));
      assert.deepEqual(D.notifyParentsOf(S.db, OLA, 'absence', 'Nieobecność na 1. lekcji'), [], 'D3-02: nawet alert kryzysowy nie omija reguły');
      assert.equal(S.db.col('notifications').filter((n) => n.userId === BOROWSKI).length, before, 'żadne powiadomienie o danych ucznia nie powstało');

      const opiekun = await S.as('rodzic.borowska');
      assert.deepEqual(expectOk(await opiekun.get('/api/parent/children')).children, []);
      assert.equal((await opiekun.get('/api/parent/attendance?studentId=' + OLA)).status, 403);
      const denied = await opiekun.get('/api/parent/grades?studentId=' + OLA);
      assert.equal(denied.body.adultAccess, 'consent-required');
      assert.equal(denied.body.adultSince, '2026-05-14');
      assert.deepEqual(await feedKinds(opiekun, S.db.get('users', BOROWSKI)), []);
      assert.deepEqual(expectOk(await opiekun.get('/api/messages')).messages.filter((m) => m.kind === 'warning' && /Borowska/.test(m.subject)), []);

      // zgoda uczennicy przyjęta w sekretariacie przywraca wszystkie drogi naraz
      const c = await registrar();
      expectOk(await c.post(`/api/registry/students/${OLA}/adult-access`, { consent: true, reason: 'pismo uczennicy z 14.05.2026' }));
      assert.equal(D.guardianStanding(S.db, S.db.get('users', BOROWSKI), OLA).ok, true);
      const po = await S.as('rodzic.borowska');
      assert.equal(expectOk(await po.get('/api/parent/children')).children.length, 1);
      assert.equal(D.notifyParentsOf(S.db, OLA, 'absence', 'Nieobecność na 1. lekcji').length, 1);
    });
  } finally { clearAdultAccess(OLA); }
});

/* ================================================================================================
   3. S3-04 jako test: skrypt z docs/review/round3/repro/s3-11-scope-leak.js przełożony na asercje */
test('[R3.4] S3-04: przy obu statusach sądowych oceny, zawiadomienia i alerty idą tą samą regułą', async () => {
  const c = await registrar();
  try {
    for (const [status, scope, kinds] of [['court-restricted', 'info', ['absence']], ['deprived', 'none', []]]) {
      expectOk(await c.patch(`/api/registry/students/${ANNA}/guardians/${MARTA}`,
        { status, accessScope: scope, legalBasis: 'postanowienie', basis: basis('III Nsm 99/26') }));
      const p = await S.as('rodzic.kowalczyk');
      assert.equal((await p.get('/api/parent/grades?studentId=' + ANNA)).status, 403, status);

      const box = expectOk(await p.get('/api/messages'));
      assert.deepEqual(box.messages.filter((m) => /Anna/.test(m.subject + ' ' + m.preview)).map((m) => m.subject), [], `skrzynka (${status})`);
      assert.equal((await p.get('/api/messages/' + WARNING)).status, 403, `pełna treść pisma (${status})`);

      const alerts = await p.get('/api/parent/absence-alerts?studentId=' + ANNA);
      const seen = alerts.status === 200 ? alerts.body.notifications.map((n) => n.kind || 'absence') : [];
      assert.deepEqual([...new Set(seen)], kinds, `alerty o nieobecności (${status})`);
      assert.deepEqual([...new Set(await feedKinds(p, S.db.get('users', MARTA)))].filter((k) => ['grade', 'remark', 'gabinet', 'payment'].includes(k)), [], `feed (${status})`);
      assert.deepEqual(expectOk(await p.get('/api/parent/warnings')).warnings.filter((w) => w.studentId === ANNA), [], `wykaz zawiadomień (${status})`);
    }
  } finally { clearGuardians(ANNA); }
});

/* ================================================================================================
   4. Tabela przejść (S3-10, D3-06, D3-07) — `D.guardianTransition`; trasę sekretariatu wpina F2. */
test('[R3.5] guardianTransition: nałożyć i zdjąć można tylko na dokumencie, a ręczny zakres przeżywa zmianę statusu', () => {
  const at = (entry, next, body) => D.guardianTransition(entry, next, body);
  const code = (entry, next, body) => { try { at(entry, next, body); return null; } catch (e) { return e.extra && e.extra.code; } };
  const court = (ref) => ({ kind: 'court-order', reference: ref, date: '2026-09-01' });
  const deprived = { status: 'deprived', accessScope: 'none', scopeSource: 'derived', basis: court('III Nsm 45/26') };

  // nałożenie: postanowienie sądu z sygnaturą, nic innego
  assert.equal(code(null, { status: 'deprived' }, { legalBasis: 'rozmowa telefoniczna' }), 'guardian_basis_required');
  assert.equal(code(null, { status: 'court-restricted' }, { basis: { kind: 'declaration', reference: 'pismo matki' } }), 'guardian_basis_required');
  assert.equal(code(null, { status: 'deprived' }, { basis: { kind: 'court-order', reference: '   ' } }), 'guardian_basis_reference_required');
  assert.equal(code(null, { status: 'kurator' }, { legalBasis: 'x' }), 'guardian_status_unknown');
  const imposed = at(null, { status: 'court-restricted' }, { basis: court('III Nsm 45/26'), legalBasis: 'postanowienie' });
  assert.deepEqual([imposed.status, imposed.scope, imposed.derived, imposed.scopeSource, imposed.transition], ['court-restricted', 'info', 'info', 'derived', 'impose']);

  // zdjęcie: S3-10 — wolna ręka kończy się na dokumencie, a stara podstawa nie jedzie dalej
  assert.equal(code(deprived, { status: 'full', accessScope: 'full' }, { legalBasis: 'rodzic prosił' }), 'guardian_basis_required');
  assert.equal(code(deprived, { status: 'full' }, { basis: { kind: 'declaration' }, legalBasis: 'oświadczenie' }), 'guardian_basis_reference_required');
  const lifted = at(deprived, { status: 'full' }, { basis: { kind: 'declaration', reference: 'oświadczenie sekretariatu 12/2026' }, legalBasis: 'oświadczenie' });
  assert.equal(lifted.transition, 'lift');
  assert.equal(lifted.basisCleared, true, 'D3-07: postanowienie odbierające dostęp nie zostaje przy wpisie przywracającym go');
  assert.equal(lifted.basis.reference, 'oświadczenie sekretariatu 12/2026');
  assert.notEqual(lifted.basis.reference, deprived.basis.reference);
  const liftedByCourt = at(deprived, { status: 'limited' }, { basis: court('III Nsm 77/26'), legalBasis: 'postanowienie zmieniające' });
  assert.deepEqual([liftedByCourt.status, liftedByCourt.scope, liftedByCourt.basis.reference], ['limited', 'full', 'III Nsm 77/26']);

  // D3-06: ręcznie nadpisany zakres przeżywa zmianę statusu…
  const explicitNone = { status: 'court-restricted', accessScope: 'none', scopeSource: 'explicit', basis: court('III Nsm 45/26') };
  const survives = at(explicitNone, { status: 'limited' }, { basis: { kind: 'declaration', reference: 'pismo 3/2026' }, legalBasis: 'oświadczenie' });
  assert.deepEqual([survives.scope, survives.derived, survives.scopeSource, survives.carriedScope], ['none', 'full', 'explicit', true]);
  // …chyba że nowy status go nie dopuszcza — wtedy odmowa, a nie ciche nadpisanie
  const explicitInfo = { status: 'limited', accessScope: 'info', scopeSource: 'explicit' };
  assert.equal(code(explicitInfo, { status: 'deprived' }, { basis: court('III Nsm 88/26'), legalBasis: 'postanowienie' }), 'guardian_scope_conflict');
  assert.equal(code(null, { status: 'court-restricted', accessScope: 'full' }, { basis: court('III Nsm 89/26') }), 'guardian_scope_conflict');

  // zmiana samego zakresu przy tym samym statusie nie kasuje postanowienia, na którym wpis stoi
  const narrowed = at({ status: 'court-restricted', accessScope: 'info', scopeSource: 'derived', basis: court('III Nsm 45/26') }, { accessScope: 'none' }, { legalBasis: 'doprecyzowanie' });
  assert.deepEqual([narrowed.transition, narrowed.scope, narrowed.scopeSource, narrowed.basisCleared, narrowed.basis.reference], ['none', 'none', 'explicit', false, 'III Nsm 45/26']);

  // D3-09: sprzeczna para zapisana z pominięciem walidacji jest przycinana przy odczycie
  assert.equal(D.clampGuardianScope('deprived', 'full'), 'none');
  assert.equal(D.clampGuardianScope('court-restricted', 'full'), 'info');
  assert.equal(D.clampGuardianScope('limited', 'info'), 'info');
});

/* ================================================================================================
   5. R7 — pismo „formalne” spod ręki nauczyciela (test-honesty H-7/H-8) */
test('[R3.6] flagi „formal” nie podniesie nauczyciel — ani rodzajem pisma, ani samą flagą', async () => {
  const nauczyciel = await S.as('j.nowak');
  for (const body of [
    { toUserIds: [MARTA], subject: 'Decyzja', body: 'Treść', kind: 'expulsion' },
    { toUserIds: [MARTA], subject: 'Zwykła wiadomość', body: 'Treść', kind: 'message', formal: true }
  ]) {
    const r = await nauczyciel.post('/api/messages', body);
    assert.equal(r.status, 403, JSON.stringify(body.kind) + ' / formal=' + !!body.formal);
    assert.equal(r.body.code, 'formal_requires_principal');
    assert.equal(r.body.notice, D.xmlEsc(r.body.notice), 'komunikat jest zwykłym zdaniem, bez znaczników');
    assert.ok(r.body.noticeEn.length > 20, 'odmowa niesie też zdanie po angielsku');
  }
  // dyrektor może — i pismo zostaje oznaczone oraz osobno zaudytowane
  const dyrektor = await S.as('dyrektor');
  const sent = expectOk(await dyrektor.post('/api/messages', { toUserIds: [MARTA], subject: 'Informacja o rozstrzygnięciu', body: 'Treść', kind: 'message', formal: true }));
  assert.equal(sent.formal, true);
  assert.ok(S.db.col('audit').some((a) => a.action === 'formal_notice_sent' && a.entityId === sent.message.id));
  // a odpowiedź na nie nie dziedziczy flagi
  const reply = expectOk(await dyrektor.post('/api/messages', { toUserIds: [MARTA], subject: 'Re: Informacja', body: 'Odpowiedź', threadId: sent.message.threadId }));
  assert.equal(reply.formal, false, 'flaga nie przechodzi na kolejne pismo w wątku');
});

/* ================================================================================================
   6. U3-14 — zdania serwera w wiadomościach idą w języku czytelnika */
test('[R3.7] „to nie jest doręczenie” i nota o danych kontaktowych idą w języku konta', async () => {
  const dyrektor = await S.as('dyrektor');
  const pl = expectOk(await dyrektor.get('/api/messages'));
  assert.match(pl.policy.note, /Dane kontaktowe/);
  assert.equal(pl.policy.locale, 'pl');
  const en = expectOk(await dyrektor.get('/api/messages?locale=en'));
  assert.match(en.policy.note, /^Contact details/);
  assert.ok(!/[ąćęłńóśżź]/i.test(en.policy.note), 'w buildzie angielskim nie ma polskiego zdania');

  const sent = expectOk(await dyrektor.post('/api/messages?locale=en', { toUserIds: [MARTA], subject: 'Formal notice', body: 'Body', kind: 'decision' }));
  assert.match(sent.formalNotice, /^This is not an administrative delivery/);
  assert.match(sent.message.note, /^This is not an administrative delivery/);
  assert.ok(!/Rozmowa zostaje w dzienniku/.test(sent.message.note), 'U3-14: angielski baner i polska stopka nie stoją już obok siebie');
  const detail = expectOk(await dyrektor.get('/api/messages/' + sent.message.id + '?locale=en'));
  assert.match(detail.note, /logbook/);
  const detailPl = expectOk(await dyrektor.get('/api/messages/' + sent.message.id + '?locale=pl'));
  assert.match(detailPl.note, /Rozmowa zostaje w dzienniku/);

  // język konta wystarcza, bez parametru w adresie (POST /api/auth/locale)
  expectOk(await dyrektor.post('/api/auth/locale', { locale: 'en' }));
  try {
    assert.match(expectOk(await dyrektor.get('/api/messages')).policy.note, /^Contact details/);
  } finally { expectOk(await dyrektor.post('/api/auth/locale', { locale: 'pl' })); }
});
