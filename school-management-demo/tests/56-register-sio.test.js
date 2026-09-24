'use strict';
/* R7 — księga uczniów bez numeru PESEL, kontrola własna pakietu SIO, mapowanie kodów frekwencji
   i znacznik „to nie jest doręczenie” przy wiadomościach o charakterze decyzji.
   Tło: docs/SIO.md, docs/research/2026-09-23-gemini-triage.md (wiersze 2, 4 i 24) oraz
   tests/fixtures/real-formats/README.md §5 i §6.
   Testy są niezależne od kolejności: wspólny stan powstaje przez `fixtures()`, a każdy test
   sprząta po sobie wpisy, które założył. */
const test = require('node:test'); const assert = require('node:assert/strict');
const fs = require('node:fs'); const path = require('node:path');
const { startServer, expectOk, fixtures, loadClient } = require('./helpers');
const D = require('../server/lib/domain');
const ID = require('../server/lib/identity');
const XC = require('../server/lib/xmlcheck');

let S; test.before(async () => { S = await startServer(); }); test.after(() => S.close());

const need = fixtures();
const registrar = () => need('registrar', () => S.as('sekretariat'));
const FIX = (...p) => path.join(__dirname, 'fixtures', 'real-formats', ...p);

/** Usuwa ucznia założonego przez test razem z jego kontem i wpisem w oddziale. */
function removeStudent(id) {
  const s = S.db.get('students', id); if (!s) return;
  const cls = S.db.get('classes', s.classId);
  if (cls) cls.studentIds = (cls.studentIds || []).filter((x) => x !== id);
  for (const u of S.db.col('users')) if (u.role === 'student' && u.studentId === id) S.db.remove('users', u.id);
  S.db.remove('students', id);
  S.db.save();
}

/* ------------------------------------------------------- 1. uczeń bez numeru PESEL (§ 4) */
test('R7 register: uczeń bez numeru PESEL wchodzi do księgi wyłącznie z rodzajem i numerem dokumentu', async () => {
  const c = await registrar();
  const base = { firstName: 'Alesia', lastName: 'Shcharbakova', identityKind: 'passport', birthDate: '2017-12-27', birthPlace: 'Mińsk', classId: '3a', mother: 'Shcharbakova Volha' };
  let created = null;
  try {
    // 1. bez dokumentu — odmowa z kodem i nazwą pola
    const none = await c.post('/api/registry/students', base);
    assert.equal(none.status, 400);
    assert.equal(none.body.code, 'document_number_required');
    assert.match(none.body.error, /dokumentu tożsamości/);

    // 2. numer bez kraju wydania — pakiet SIO nie przyjąłby takiego wpisu
    const noCountry = await c.post('/api/registry/students', Object.assign({}, base, { identityDocument: { type: 'residence-card', number: '0012345' } }));
    assert.equal(noCountry.status, 400);
    assert.equal(noCountry.body.code, 'document_country_required');
    assert.equal(noCountry.body.field, 'identityDocument.country');

    // 3. wymyślony rodzaj dokumentu — odmowa z listą dopuszczalnych
    const badType = await c.post('/api/registry/students', Object.assign({}, base, { identityDocument: { type: 'dowod', number: '0012345', country: 'BY' } }));
    assert.equal(badType.status, 400);
    assert.equal(badType.body.code, 'document_type_unknown');
    assert.deepEqual(badType.body.allowed, ['passport', 'residence-card', 'other']);

    // 4. karta pobytu — rodzaj, którego księga do R7 nie umiała zapisać
    const ok = expectOk(await c.post('/api/registry/students', Object.assign({}, base, { identityDocument: { type: 'residence-card', number: '0012345', country: 'BY' } })));
    created = ok.student.id;
    assert.equal(ok.student.pesel, null);
    assert.deepEqual(ok.student.identityDocument, { type: 'residence-card', number: '0012345', country: 'BY' });
    assert.equal(ok.student.passport, '0012345', 'pole zgodności dla pakietu SIO zapisane razem z dokumentem');
    assert.equal(ok.student.foreigner, true);

    const stored = S.db.get('students', created);
    assert.equal(ID.identityLabel(stored), 'karta pobytu 0012345 (BY)');
    assert.ok(!/undefined/.test(ID.identityLabel(stored)));

    // 5. księga uczniów pokazuje dokument tam, gdzie u innych jest PESEL
    const book = expectOk(await c.get('/api/registry/students'));
    const row = book.students.find((x) => x.id === created);
    assert.deepEqual(row.identityDocument, { type: 'residence-card', number: '0012345', country: 'BY' });
    assert.equal(row.identityLabel, 'karta pobytu 0012345 (BY)');
    const flags = expectOk(await c.get('/api/registry/students/' + created + '/flags'));
    assert.equal(flags.hasPesel, false);
    assert.equal(flags.hasPassport, true);
    assert.equal(flags.identityLabel, 'karta pobytu 0012345 (BY)');

    // 6. poprawka dokumentu po imporcie (rozbicie wolnego pola bywa błędne) zostawia wiersz audytu
    const fixed = expectOk(await c.patch('/api/registry/students/' + created + '/flags', {
      identityDocument: { type: 'passport', number: 'AB9988776', country: 'BY' }, reason: 'poprawka po imporcie z naboru'
    }));
    assert.ok(fixed.changed.includes('identityDocument'));
    assert.deepEqual(fixed.flags.identityDocument, { type: 'passport', number: 'AB9988776', country: 'BY' });
    assert.equal(S.db.get('students', created).passport, 'AB9988776', 'pole zgodności idzie za dokumentem');
    const aud = S.db.col('audit').filter((a) => a.action === 'student_flags_changed' && a.entityId === created).pop();
    assert.deepEqual(aud.before.identityDocument, { type: 'residence-card', number: '0012345', country: 'BY' });
    const short = await c.patch('/api/registry/students/' + created + '/flags', { identityDocument: { type: 'passport', number: 'AB1', country: 'BY' } });
    assert.equal(short.status, 400);
    assert.equal(short.body.code, 'document_number_short');
    const wipe = await c.patch('/api/registry/students/' + created + '/flags', { identityDocument: null });
    assert.equal(wipe.status, 400, 'ucznia bez numeru PESEL nie da się zostawić bez dokumentu');
    assert.equal(wipe.body.code, 'no_identity');

    // 7. numer PESEL, gdy jest, dalej idzie przez sumę kontrolną
    const badPesel = await c.post('/api/registry/students', { firstName: 'Jan', lastName: 'Testowy', identityKind: 'pesel', pesel: '13241512848', birthDate: '2013-04-15', birthPlace: 'Kraków', classId: '3a', mother: 'Testowa Anna' });
    assert.equal(badPesel.status, 400);
    assert.equal(badPesel.body.code, 'pesel_invalid');
  } finally { if (created) removeStudent(created); }
});

test('R7 register: odpis arkusza ocen i pakiet SIO pokazują dokument zamiast pustego pola po numerze PESEL', async () => {
  const c = await registrar();
  let created = null;
  try {
    const ok = expectOk(await c.post('/api/registry/students', {
      firstName: 'Thi Mai', lastName: 'Nguyen', identityKind: 'passport', birthDate: '2013-06-18', birthPlace: 'Hanoi', classId: '7b', mother: 'Nguyen Van Hung',
      identityDocument: { type: 'passport', number: 'N1234567', country: 'VN' }
    }));
    created = ok.student.id;

    const transcript = (await c.get('/api/registry/students/' + created + '/transcript')).body;
    assert.match(transcript, /paszport N1234567 \(VN\)/, 'odpis arkusza niesie rodzaj, numer i kraj dokumentu');
    assert.ok(!/undefined/.test(transcript), 'odpis nigdy nie drukuje „undefined” w miejscu numeru PESEL');

    const xml = (await c.get('/api/registry/sio/package')).body;
    assert.match(xml, /rodzajDokumentu="passport" numerDokumentu="N1234567" paszport="N1234567" krajWydania="VN"/);
    assert.ok(!/undefined/.test(xml), 'pakiet SIO nie niesie „undefined”');
    assert.equal(XC.wellFormed(xml).ok, true, 'pakiet jest poprawnym dokumentem XML');
  } finally { if (created) removeStudent(created); }
});

/* ---------------------------------------- 2. import listy z naboru (fixture z prawdziwym kształtem) */
test('R7 register: import listy z naboru mapuje trzech uczniów bez numeru PESEL na dokument tożsamości', async () => {
  const c = await registrar();
  const csv = fs.readFileSync(FIX('register', 'nabor-vulcan.utf8.csv'), 'utf8');
  const r = expectOk(await c.post('/api/registry/students/import', { csv }));

  assert.equal(r.dryRun, true, 'faza dopasowania nigdy nie zapisuje');
  assert.equal(r.count, 60);
  assert.equal(r.separator, ';');
  assert.equal(r.withDocument, 3, 'trzech uczniów z fixture’u nie ma numeru PESEL');
  assert.equal(r.withPesel, 57);

  const docs = r.rows.filter((x) => !x.pesel);
  assert.deepEqual(docs.map((x) => x.lastName).sort(), ['Kovalenko', 'Nguyen', 'Shcharbakova']);
  const byName = Object.fromEntries(docs.map((x) => [x.lastName, x]));
  assert.deepEqual(byName.Kovalenko.identityDocument, { type: 'passport', number: 'FL123456', country: 'UA' });
  assert.deepEqual(byName.Shcharbakova.identityDocument, { type: 'residence-card', number: '0012345', country: 'BY' }, 'karta pobytu nie jest paszportem');
  assert.deepEqual(byName.Nguyen.identityDocument, { type: 'passport', number: 'N1234567', country: 'VN' });
  // rozbicie jednego wolnego pola jest heurystyką — każdy taki wiersz wraca do przejrzenia
  for (const x of docs) {
    assert.equal(x.review, true);
    assert.ok(x.issues.some((i) => i.code === 'document_needs_review' && i.level === 'warning'));
    assert.equal(x.ok, true, 'ostrzeżenie nie blokuje wpisu');
  }
  assert.equal(r.needsReview, 3);

  // daty DD.MM.RRRR sprowadzone do ISO, oddziały odczytane z kolumny z polskim „ł”
  assert.equal(byName.Nguyen.birthDate, '2013-06-18');
  assert.equal(byName.Nguyen.classId, '7b');
  assert.ok(r.missingClasses.includes('1b') && r.missingClasses.includes('3b') && r.missingClasses.includes('8a'), 'brakujące oddziały zgłoszone przed zapisem: ' + r.missingClasses.join(','));

  // pole z średnikiem w cudzysłowach nie rozwala wiersza (adnotacja sądowa z README §5)
  assert.ok(r.rows.every((x) => x.lastName), 'każdy wiersz ma nazwisko — parser CSV zna cudzysłowy');
  // uczniowie już w księdze są wychwyceni, a nie wpisani drugi raz
  assert.equal(S.db.col('students').filter((x) => x.lastName === 'Kovalenko').length, 0, 'próbny import niczego nie zapisał');
});

test('R7 register: bliźniak UTF-8 i plik windows-1250 dają to samo mapowanie dokumentów', () => {
  const utf8 = require('../server/lib/csv').parseObjects(fs.readFileSync(FIX('register', 'nabor-vulcan.utf8.csv'), 'utf8'));
  const raw = require('../server/lib/textdecode').decodeText(fs.readFileSync(FIX('register', 'nabor-vulcan.csv')), { default: 'windows-1250' });
  const cp = require('../server/lib/csv').parseObjects(raw);
  const docs = (p) => p.rows.map(ID.mapRegisterRow).filter((x) => !x.pesel).map((x) => x.identityDocument);
  assert.deepEqual(docs(cp), docs(utf8), 'kodowanie pliku nie zmienia odczytanego dokumentu');
  assert.equal(docs(utf8).length, 3);
});

/* ------------------------------------------------------ 3. kontrola własna pakietu SIO */
test('R7 SIO: walidacja zgłasza brakujące pola, powtórzony PESEL i znaczy odpowiedź „not-validated-against-cie-xsd”', async () => {
  const c = await registrar();
  const clean = expectOk(await c.post('/api/registry/sio/validate'));
  assert.equal(clean.ok, true, 'zasiew przechodzi walidację: ' + JSON.stringify(clean.errors));
  assert.equal(clean.schema, 'not-validated-against-cie-xsd', 'odpowiedź nie udaje walidacji schematem CIE');
  assert.match(clean.note, /NIE sprawdzono wobec schematu XSD/);
  for (const ch of ['well-formed-xml', 'required-fields-per-pupil', 'identity-pesel-or-document', 'no-duplicate-pesel', 'iso-dates']) assert.ok(clean.checks.includes(ch), 'brak kontroli ' + ch);
  assert.ok(Array.isArray(clean.warnings));
  assert.ok(clean.warnings.every((w) => w.code && w.level), 'każde ostrzeżenie ma kod i poziom');
  // wpisy sprzed GAP-6 nie mają daty przyjęcia — to ostrzeżenie, a nie blokada
  assert.ok(clean.warnings.some((w) => w.code === 'missing_enrolment' && w.level === 'warning'));
  assert.ok(!clean.warnings.some((w) => w.code === 'xml_not_well_formed'), 'pakiet zasiewu jest składniowo poprawny');

  const victim = S.db.get('students', 'st_mrz_natalia');
  const keep = { pesel: victim.pesel, birthPlace: victim.birthPlace, birthDate: victim.birthDate };
  const twin = S.db.get('students', 'st_adamczyk_maja'); const keepTwin = twin.pesel;
  try {
    // brak tożsamości i puste miejsce urodzenia
    victim.pesel = null; victim.birthPlace = ''; victim.birthDate = '12.04.2013';
    // ten sam numer PESEL przy dwóch uczniach
    twin.pesel = S.db.get('students', 'st_nowak_jan').pesel;
    S.db.save();
    const bad = expectOk(await c.post('/api/registry/sio/validate'));
    assert.equal(bad.ok, false);
    assert.equal(bad.schema, 'not-validated-against-cie-xsd');
    const codes = bad.warnings.map((w) => w.code);
    assert.ok(codes.includes('no_identity'), 'brak PESEL-u i dokumentu: ' + codes.join(','));
    assert.ok(codes.includes('missing_field'), 'puste pole wymagane');
    assert.ok(codes.includes('duplicate_pesel'), 'powtórzony numer PESEL');
    assert.ok(codes.includes('bad_date'), 'data spoza formatu ISO');
    const dup = bad.warnings.find((w) => w.code === 'duplicate_pesel');
    assert.equal(dup.level, 'error');
    assert.ok(dup.studentId, 'ostrzeżenie wskazuje ucznia');
    assert.equal((await c.get('/api/registry/sio/package')).status, 400, 'pakietu z błędami nie da się pobrać');
  } finally {
    Object.assign(victim, keep); twin.pesel = keepTwin; S.db.save();
  }
});

test('R7 SIO: skaner składni znajduje niedomknięty znacznik, dwa korzenie i nagi znak &', () => {
  assert.equal(XC.wellFormed('<?xml version="1.0"?><sio><a/></sio>').ok, true);
  const unclosed = XC.wellFormed('<sio>\n  <oddzial>\n</sio>');
  assert.equal(unclosed.ok, false);
  assert.equal(unclosed.errors[0].code, 'tag_mismatch');
  assert.equal(unclosed.errors[0].line, 3, 'błąd wskazuje linię');
  assert.equal(XC.wellFormed('<a/><b/>').errors[0].code, 'multiple_roots');
  assert.equal(XC.wellFormed('<a>Kowalski & Syn</a>').errors[0].code, 'raw_ampersand');
  assert.equal(XC.wellFormed('<a x=1/>').errors[0].code, 'unquoted_attribute');
  assert.equal(XC.wellFormed('').errors[0].code, 'no_root');
  // prawdziwe archiwum z fixture'ów przechodzi
  assert.equal(XC.wellFormed(fs.readFileSync(FIX('archive', 'dziennik-2025-2026-sample.xml'), 'utf8')).ok, true);
});

/* -------------------------------------------------- 4. kody frekwencji z cudzego dziennika */
test('R7 attendance: import odmawia przy kodzie „ns” z archiwum i wymienia go, zamiast pominąć', async () => {
  const c = await registrar();
  const xml = fs.readFileSync(FIX('archive', 'dziennik-2025-2026-sample.xml'), 'utf8');

  const refused = await c.post('/api/registry/attendance/import', { xml });
  assert.equal(refused.status, 400);
  assert.equal(refused.body.code, 'attendance_codes_unmapped');
  assert.deepEqual(refused.body.unknown, ['ns'], 'nieznany kod wymieniony z nazwy');
  assert.match(refused.body.error, /„ns”/);
  const ns = refused.body.codes.find((x) => x.code === 'ns');
  assert.equal(ns.rows, 5, 'liczba wierszy z tym kodem jest podana');
  assert.equal(ns.ok, false); assert.equal(ns.reason, 'unknown');
  assert.ok(refused.body.codes.some((x) => x.code === 'ob' && x.ok && x.source === 'native'));
  assert.equal(S.db.col('attendance').some((a) => a.status === 'ns'), false, 'nic nie zostało zapisane');

  // z jawnym mapowaniem import przechodzi — i dalej niczego nie zapisuje
  const mapped = expectOk(await c.post('/api/registry/attendance/import', { xml, mapping: { ns: 'zw' } }));
  assert.equal(mapped.ok, true);
  assert.equal(mapped.dryRun, true);
  assert.deepEqual(mapped.unknown, []);
  assert.equal(mapped.codes.find((x) => x.code === 'ns').mapped, 'zw');
  assert.equal(mapped.codes.find((x) => x.code === 'ns').source, 'mapping');
  assert.equal(S.db.col('attendance').some((a) => a.status === 'ns'), false);

  // świadome pominięcie kodu jest decyzją, którą trzeba zapisać wprost
  const skipped = expectOk(await c.post('/api/registry/attendance/import', { xml, mapping: { ns: null } }));
  assert.equal(skipped.codes.find((x) => x.code === 'ns').skipped, true);
  assert.ok(S.db.col('audit').some((a) => a.action === 'attendance_import_checked'));
});

test('R7 attendance: D.mapAttendanceCode niczego nie zgaduje', () => {
  assert.deepEqual(D.mapAttendanceCode('ns'), { ok: false, code: null, raw: 'ns', reason: 'unknown' });
  assert.equal(D.mapAttendanceCode('ns', { ns: 'zw' }).code, 'zw');
  assert.equal(D.mapAttendanceCode('NS', { ns: 'zw' }).code, 'zw', 'wielkość liter nie jest częścią kodu');
  assert.equal(D.mapAttendanceCode('ob').source, 'native');
  assert.equal(D.mapAttendanceCode('ns', { ns: 'xx' }).reason, 'target_unknown', 'mapowanie na nieistniejący status to błąd');
  assert.equal(D.mapAttendanceCode('ns', { ns: null }).skipped, true);
  assert.equal(D.mapAttendanceCode('').reason, 'empty');
  // statystyki dalej zgłaszają nieznany kod, ale nie obniżają przez niego frekwencji
  const st = D.attendanceStats([{ status: 'ob' }, { status: 'ns' }]);
  assert.equal(st.unknown, 1);
  assert.deepEqual(st.unknownStatuses, ['ns']);
});

/* --------------------------------- 5. znacznik „to nie jest doręczenie” przy wiadomościach */
const M = require('../server/routes/messages');

test('R7 messages: pismo o charakterze decyzji wysyła wyłącznie dyrektor i zostaje odnotowane', async () => {
  const teacher = await S.as('j.nowak');
  const dyr = await S.as('dyrektor');
  const parent = 'u_p_kowalczyk';

  // nauczyciel nie wyśle decyzji, choćby podał rodzaj z listy
  const denied = await teacher.post('/api/messages', { toUserIds: [parent], subject: 'Decyzja o skreśleniu', body: 'Treść rozstrzygnięcia.', kind: 'expulsion' });
  assert.equal(denied.status, 403);
  assert.equal(denied.body.code, 'formal_requires_principal');
  assert.match(denied.body.error, /e-Doręczenia/);
  assert.deepEqual(denied.body.formalKinds, M.FORMAL_KINDS);

  // dyrektor może — wiadomość jest oznaczona, niesie ostrzeżenie i zostawia wiersz audytu
  const sent = expectOk(await dyr.post('/api/messages', { toUserIds: [parent], subject: 'Informacja o decyzji', body: 'Decyzja doręczona odrębnie.', kind: 'decision' }));
  assert.equal(sent.formal, true);
  assert.equal(sent.message.formal, true);
  assert.match(sent.formalNotice, /^To nie jest doręczenie administracyjne \(e-Doręczenia\)\./);
  assert.match(sent.message.note, /KPA/);
  assert.match(sent.receipt, /KPA/);
  assert.equal(S.db.get('messages', sent.message.id).formal, true);
  const row = S.db.col('audit').filter((a) => a.action === 'formal_notice_sent' && a.entityId === sent.message.id).pop();
  assert.ok(row, 'pismo o rozstrzygnięciu zostawia wiersz „formal_notice_sent”');
  assert.equal(row.after.kind, 'decision');
  assert.match(row.after.notice, /KPA/);

  // adresat czyta ten sam znacznik
  const rodzic = await S.as('rodzic.kowalczyk');
  const got = expectOk(await rodzic.get('/api/messages/' + sent.message.id));
  assert.equal(got.formal, true);
  assert.match(got.formalNotice, /e-Doręczenia/);
  const box = expectOk(await rodzic.get('/api/messages?box=inbox'));
  assert.equal(box.messages.find((m) => m.id === sent.message.id).formal, true);

  // jawna flaga `formal` działa tak samo jak rodzaj z listy
  const flagged = expectOk(await dyr.post('/api/messages', { toUserIds: [parent], subject: 'Pismo dyrektora', body: 'W sprawie stypendium.', formal: true }));
  assert.equal(flagged.message.formal, true);
});

test('R7 messages: zwykła wiadomość zostaje bez zmian — formal:false i żadnego banera', async () => {
  const teacher = await S.as('j.nowak');
  const sent = expectOk(await teacher.post('/api/messages', { toUserIds: ['u_p_kowalczyk'], subject: 'Zebranie', body: 'Zapraszam na zebranie.' }));
  assert.equal(sent.formal, false);
  assert.equal(sent.formalNotice, null);
  assert.equal(sent.message.formal, false);
  assert.equal(S.db.get('messages', sent.message.id).formal, false);
  assert.ok(!/KPA/.test(sent.message.note), 'przy zwykłej wiadomości nie ma ostrzeżenia o KPA');
  assert.ok(!/KPA/.test(sent.receipt));

  // rodzic pisze do wychowawczyni jak dotąd; rodzaj „decision” od rodzica nie jest w ogóle rozważany
  const rodzic = await S.as('rodzic.kowalczyk');
  const plain = expectOk(await rodzic.post('/api/messages', { toUserIds: ['u_nowak'], subject: 'Pytanie', body: 'Proszę o kontakt.', kind: 'decision' }));
  assert.equal(plain.message.kind, 'message', 'rodzic nie ustawia rodzaju pisma');
  assert.equal(plain.message.formal, false);

  // polityka skrzynki mówi klientowi, które rodzaje są „decyzyjne” i kto może ich użyć
  const boxTeacher = expectOk(await teacher.get('/api/messages'));
  assert.deepEqual(boxTeacher.policy.formalKinds, M.FORMAL_KINDS);
  assert.equal(boxTeacher.policy.canSendFormal, false);
  const dyr = await S.as('dyrektor');
  assert.equal(expectOk(await dyr.get('/api/messages')).policy.canSendFormal, true);
});

test('R7 messages: baner „to nie jest doręczenie” ma tę samą treść po polsku i po angielsku', () => {
  /* Ekran uruchamiamy naprawdę (node:vm + prawdziwe i18n.js), a nie grepujemy — CONTRIBUTING.md. */
  const ui = loadClient();
  const vm = require('node:vm');
  vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'public', 'app', 'screens', 'messages.js'), 'utf8'), ui.sandbox, { filename: 'messages.js' });
  const A = ui.A;

  A.setLocale('pl');
  const pl = A.t('ms.formal.banner');
  assert.equal(pl, 'To nie jest doręczenie administracyjne (e-Doręczenia). Decyzje formalne doręcza się w trybie KPA.');
  assert.equal(pl, M.FORMAL_NOTICE, 'ten sam tekst po stronie serwera i klienta');
  assert.ok(A.t('ms.formal.badge') && A.t('ms.formal.badge') !== 'ms.formal.badge');
  for (const k of M.FORMAL_KINDS) assert.notEqual(A.t('ms.kind.' + k), 'ms.kind.' + k, 'brak polskiej nazwy rodzaju ' + k);

  A.setLocale('en');
  const en = A.t('ms.formal.banner');
  assert.equal(en, 'This is not an administrative delivery (e-Doręczenia). Formal decisions must be delivered under KPA.');
  assert.equal(en, M.FORMAL_NOTICE_EN);
  assert.notEqual(en, pl, 'baner jest przetłumaczony, a nie skopiowany');
  for (const k of M.FORMAL_KINDS) assert.notEqual(A.t('ms.kind.' + k), 'ms.kind.' + k, 'brak angielskiej nazwy rodzaju ' + k);
  A.setLocale('pl');
});

test('R7 register: ekran sekretariatu nazywa dokument tożsamości w obu językach', () => {
  const ui = loadClient();
  const vm = require('node:vm');
  vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'public', 'app', 'screens', 'registrar.js'), 'utf8'), ui.sandbox, { filename: 'registrar.js' });
  const A = ui.A;
  for (const locale of ['pl', 'en']) {
    A.setLocale(locale);
    for (const t of ID.DOCUMENT_TYPES) assert.notEqual(A.t('rg.doc.' + t), 'rg.doc.' + t, `brak nazwy rodzaju ${t} (${locale})`);
    assert.notEqual(A.t('rg.new.docType'), 'rg.new.docType', 'brak etykiety pola „rodzaj dokumentu” (' + locale + ')');
  }
  A.setLocale('en');
  assert.equal(A.t('rg.doc.residence-card'), 'Residence card');
  A.setLocale('pl');
  assert.equal(A.t('rg.doc.residence-card'), 'Karta pobytu');
});

/* ================================================================== runda 3 — poprawki F2 =======
   Numery PESEL do testów liczymy, zamiast wklejać: cyfra kontrolna musi zgadzać się z datą urodzenia,
   bo dokładnie to sprawdza `checkPesel` przy każdym zapisie w księdze. */
function peselFor(birthDate, serial, male) {
  const [y, m, d] = birthDate.split('-').map(Number);
  const mm = y >= 2000 ? m + 20 : m;
  const base = String(y % 100).padStart(2, '0') + String(mm).padStart(2, '0') + String(d).padStart(2, '0')
    + String(serial).padStart(3, '0').slice(-3) + (male ? '1' : '2');
  const w = [1, 3, 7, 9, 1, 3, 7, 9, 1, 3];
  return base + String((10 - w.reduce((a, wi, i) => a + wi * +base[i], 0) % 10) % 10);
}


test('R7 register: uczeń dostaje numer PESEL w listopadzie i zachowuje numer księgi, konto i oceny (D3-45)', async () => {
  const c = await registrar();
  /* Ukraiński uczeń przyjeżdża we wrześniu na karcie pobytu i dostaje PESEL w trakcie roku. Do tej
     pory jedyną drogą było usunięcie i ponowne wpisanie: nowy numer księgi, nowy `id` (jest slugiem
     nazwiska), nowy login i osierocone oceny. */
  const created = expectOk(await c.post('/api/registry/students', {
    firstName: 'Danylo', lastName: 'Pryjezdny', identityKind: 'passport', documentType: 'residence-card',
    documentNumber: 'KP0099887', documentCountry: 'UA', birthDate: '2013-05-14', birthPlace: 'Lwów',
    classId: '7b', mother: 'Pryjezdna Olha', reason: 'przyjęcie w trakcie roku',
  }), 'wpis do księgi');
  const sid = created.student.id;
  try {
    const before = S.db.get('students', sid);
    assert.equal(before.pesel, null); assert.equal(before.identityDocument.number, 'KP0099887');
    const login = expectOk(await c.get('/api/registry/students/' + sid + '/flags')).identityLabel;
    assert.match(login, /karta pobytu KP0099887/);

    /* Suma kontrolna i zgodność z datą urodzenia z księgi — ta sama kontrola, co przy wpisie. */
    const wrongSum = await c.patch('/api/registry/students/' + sid + '/flags', { pesel: '13051412341' });
    assert.equal(wrongSum.status, 400); assert.equal(wrongSum.body.code, 'pesel_invalid');
    const otherBirth = await c.patch('/api/registry/students/' + sid + '/flags', { pesel: S.db.get('students', 'st_kowalczyk_anna').pesel });
    assert.equal(otherBirth.status, 400, 'numer stojący już przy innym uczniu albo z inną datą urodzenia');

    /* Numer zgodny z datą urodzenia 2013-05-14: 13 25 14, seria, płeć M, suma kontrolna. */
    const pesel = peselFor('2013-05-14', 1234, true);
    const r = expectOk(await c.patch('/api/registry/students/' + sid + '/flags', { pesel, reason: 'decyzja o nadaniu numeru PESEL z 12.11.2026' }));
    assert.ok(r.changed.includes('pesel'));
    assert.match(r.message, /Poprzedni dokument tożsamości został zachowany/);

    const after = S.db.get('students', sid);
    assert.equal(after.pesel, pesel);
    assert.equal(after.id, sid, 'ten sam identyfikator — oceny i frekwencja nie osierocone');
    assert.equal(after.registerNo, before.registerNo, 'ten sam numer księgi');
    assert.equal(after.identityKind, 'pesel');
    assert.equal(after.foreigner, false);
    assert.equal(after.identityDocument.number, 'KP0099887', 'dokument zostaje w księdze');
    assert.equal(S.db.one('users', (u) => u.studentId === sid).login, created.studentLogin, 'login bez zmian');
    /* § 4 — historia wpisu mówi, co było przedtem, kto i na jakiej podstawie. */
    const hist = after.identityHistory;
    assert.equal(hist.length, 1);
    assert.equal(hist[0].change, 'pesel');
    assert.equal(hist[0].from.identityDocument.number, 'KP0099887');
    assert.equal(hist[0].to.pesel, pesel);
    assert.match(hist[0].reason, /12\.11\.2026/);
    const a = S.db.col('audit').filter((x) => x.action === 'student_flags_changed' && x.entityId === sid).pop();
    assert.equal(a.before.pesel, null); assert.equal(a.after.pesel, pesel);

    /* Numeru PESEL w księdze uczniów nie wpisuje wychowawca — to pole sekretariatu. */
    const hr = await S.as('j.nowak');
    const denied = await hr.patch('/api/registry/students/' + sid + '/flags', { pesel });
    assert.equal(denied.status, 403); assert.equal(denied.body.code, 'registry_only');
    /* …ale zwykłą flagę swojego oddziału dalej zmienia. */
    expectOk(await hr.patch('/api/registry/students/' + sid + '/flags', { socialWelfare: true }));
  } finally { removeStudent(sid); }
});

test('R7 register: zmiana nazwiska zapisuje poprzednie, podstawę i datę, i nie rusza numeru księgi (D3-48)', async () => {
  const c = await registrar();
  const created = expectOk(await c.post('/api/registry/students', {
    firstName: 'Maja', lastName: 'Przedslubna', identityKind: 'pesel', pesel: peselFor('2013-04-15', 5551, false),
    birthDate: '2013-04-15', birthPlace: 'Kraków', classId: '3a', mother: 'Przedslubna Anna',
  }));
  const sid = created.student.id;
  try {
    /* Bez podstawy i bez sygnatury księga wpisu nie przyjmie — § 4 chce jednego i drugiego. */
    assert.equal((await c.patch('/api/registry/students/' + sid + '/name', { lastName: 'Poslubna' })).status, 400);
    const noRef = await c.patch('/api/registry/students/' + sid + '/name', { lastName: 'Poslubna', basis: { kind: 'marriage' } });
    assert.equal(noRef.status, 400); assert.equal(noRef.body.code, 'name_basis_reference');
    const badKind = await c.patch('/api/registry/students/' + sid + '/name', { lastName: 'Poslubna', basis: { kind: 'bo tak', reference: 'x' } });
    assert.equal(badKind.status, 400); assert.equal(badKind.body.code, 'name_basis_kind');
    assert.equal((await c.patch('/api/registry/students/' + sid + '/name', { basis: { kind: 'marriage', reference: 'USC 4/2026' } })).status, 400, 'nic się nie zmienia');

    const r = expectOk(await c.patch('/api/registry/students/' + sid + '/name', {
      lastName: 'Poslubna', basis: { kind: 'court-order', reference: 'III Nsm 501/26', date: '2026-11-03' },
    }));
    const s = S.db.get('students', sid);
    assert.equal(s.lastName, 'Poslubna');
    assert.equal(s.id, sid, 'identyfikator zostaje — jest kluczem ocen i frekwencji');
    assert.equal(s.registerNo, created.registerNo, 'numer księgi zostaje');
    assert.equal(S.db.one('users', (u) => u.studentId === sid).login, created.studentLogin, 'login zostaje');
    assert.equal(S.db.one('users', (u) => u.studentId === sid).lastName, 'Poslubna', 'konto ucznia przepisane');
    assert.equal(s.previousNames.length, 1);
    assert.equal(s.previousNames[0].lastName, 'Przedslubna');
    assert.equal(s.previousNames[0].until, '2026-11-03');
    assert.equal(s.previousNames[0].basis.reference, 'III Nsm 501/26');
    assert.equal(s.nameChangedAt, '2026-11-03');
    /* Miejscownik dotyczył poprzedniego nazwiska — wychowawca potwierdza go jeszcze raz. */
    assert.equal(s.declension.confirmedAt, null);
    assert.equal(s.declension.lastNameLocative, null);
    const a = S.db.col('audit').filter((x) => x.action === 'registry_student_renamed').pop();
    assert.equal(a.before.lastName, 'Przedslubna'); assert.equal(a.after.lastName, 'Poslubna');
    assert.match(a.reason, /III Nsm 501\/26/);
    /* Księga uczniów pokazuje poprzednie nazwisko — tego wymaga § 4. */
    const book = expectOk(await c.get('/api/registry/students')).students.find((x) => x.id === sid);
    assert.equal(book.previousNames[0].lastName, 'Przedslubna');
    assert.match(r.message, /Poprzednie nazwisko/);
  } finally { removeStudent(sid); }
});

test('R7 SIO: „Sprawdź pakiet” na szkole z kreatora to 400 z instrukcją, nie pięćsetka (R3-05, D3-43, OPS3-13)', async () => {
  const T = await startServer({ blank: true });
  try {
    /* Każda prawdziwa instalacja rodzi się z kreatora, a kreator nie zapisuje `config.sio`. */
    expectOk(await T.client().post('/api/setup/school', {
      school: { name: 'Szkoła Podstawowa nr 9 w Krakowie', short: 'SP 9', address: 'ul. Nowa 1, Kraków' },
      admin: { login: 'm.admin', firstName: 'Maria', lastName: 'Admin', password: 'Szkola-2026!' },
    }), 'kreator');
    const a = await T.client(); await a.login('m.admin', 'Szkola-2026!');
    const sio = T.db.data.config.sio;
    const r = await a.post('/api/registry/sio/validate', {});
    if (sio) {
      /* Gdy blank-seed dosypał już domyślne ustawienia (pakiet F5), trasa po prostu działa. */
      assert.equal(r.status, 200, 'z ustawieniami SIO walidacja odpowiada normalnie');
      assert.equal(typeof r.body.schemaVersion, 'string');
    } else {
      assert.equal(r.status, 400, 'bez ustawień SIO: 400 z kodem, nigdy 500 „Błąd serwera.”');
      assert.equal(r.body.code, 'sio_not_configured');
      assert.match(r.body.error, /config\.sio\.schemaVersion/);
    }
    /* Niezależnie od stanu konfiguracji: nigdy pięćsetka bez kodu. */
    assert.notEqual(r.status, 500);
  } finally { await T.close(); }
});

test('R7 SIO: błąd kontroli własnej blokuje pobranie pakietu, a obejście jest administratora i jest odnotowane (D3-44)', async () => {
  const c = await registrar();
  const victim = S.db.get('students', 'st_duda_lena'); const keep = victim.pesel;
  victim.pesel = S.db.get('students', 'st_adamczyk_maja').pesel; S.db.save();   // dwoje uczniów, jeden PESEL
  try {
    const val = expectOk(await c.post('/api/registry/sio/validate', {}));
    assert.equal(val.errors.length, 0, 'buildSio tego nie widzi — widzi to dopiero kontrola własna');
    assert.equal(val.ok, false, 'a mimo to pakiet nie jest gotowy do wysyłki');
    assert.equal(val.blockingCount, 1);
    assert.ok(val.warnings.some((w) => w.code === 'duplicate_pesel' && w.level === 'error'));

    const blocked = await c.get('/api/registry/sio/package');
    assert.equal(blocked.status, 400, 'pakiet z powtórzonym numerem PESEL nie pobiera się „czysto”');
    assert.equal(blocked.body.code, 'sio_blocking_findings');
    assert.deepEqual(blocked.body.codes, ['duplicate_pesel']);

    /* Sekretariat pod presją terminu nie obchodzi tego sam. */
    const forcedBySek = await c.get('/api/registry/sio/package?force=1');
    assert.equal(forcedBySek.status, 403); assert.equal(forcedBySek.body.code, 'sio_force_admin_only');

    const admin = await S.as('admin');
    const forced = await admin.get('/api/registry/sio/package?force=1');
    assert.equal(forced.status, 200, 'administrator może — świadomie i na własną odpowiedzialność');
    const a = S.db.col('audit').filter((x) => x.action === 'sio_export_forced').pop();
    assert.ok(a, 'obejście zostawia własną akcję w rejestrze zdarzeń');
    assert.equal(a.after.forced, true);
    assert.equal(a.after.blockingCount, 1);
    assert.deepEqual(a.after.codes, ['duplicate_pesel']);
    assert.match(a.reason, /force=1/);
    /* Wiersz audytu niesie kody i liczby, nigdy treści sprawozdania. */
    assert.ok(JSON.stringify(a.after).length < 400, 'wiersz audytu jest krótki: ' + JSON.stringify(a.after).length + ' B');
  } finally { victim.pesel = keep; S.db.save(); }
});

test('R7 imports: wiersz audytu suchego biegu niesie kształt, nie ładunek — i mówi, ile PESEL-i odpytano (S3-12, S3-14)', async () => {
  const c = await registrar();
  const auditsAfter = (action) => S.db.col('audit').filter((x) => x.action === action).pop();

  /* 6 000 zmyślonych kodów robiło z jednego wiersza audytu 124 kB — w kolekcji, której nic w produkcie
     nie umie usunąć przed upływem retencji. */
  const codes = []; const mapping = {};
  for (let i = 0; i < 2000; i++) { codes.push('kod-' + i); mapping['kod-' + i] = 'ob'; }
  expectOk(await c.post('/api/registry/attendance/import', { codes, mapping }));
  const att = auditsAfter('attendance_import_checked');
  assert.equal(att.after.rows, 2000);
  assert.equal(att.after.distinctCodes, 2000);
  assert.equal(att.after.codesSample.length, 20, 'próbka, nie cała lista');
  assert.equal(att.after.mappingKeys, 2000);
  assert.equal(att.after.codes, undefined, 'lista kodów nie jedzie do dziennika zdarzeń');
  assert.ok(JSON.stringify(att.after).length < 1500, 'wiersz audytu: ' + JSON.stringify(att.after).length + ' B');

  /* Ten sam wzór po stronie listy uczniów — plus to, czego brakowało zupełnie: ślad, że ktoś
     przepuścił listę numerów PESEL przez księgę i ile z nich trafiło. */
  const junk = Array.from({ length: 200 }, (_, i) => 'Kolumna' + i).join(';');
  const known = S.db.get('students', 'st_kowalczyk_anna');
  const csv = 'PESEL;Imię;Nazwisko;' + junk + '\n' + known.pesel + ';X;Y;' + Array(200).fill('z').join(';');
  const dry = expectOk(await c.post('/api/registry/students/import', { csv }));
  const imp = auditsAfter('registry_import_checked');
  assert.equal(imp.after.unknownColumns, 200, 'liczba, nie lista');
  assert.equal(imp.after.unknownColumnsSample.length, 20);
  assert.equal(imp.after.peselsProbed, 1, 'ile numerów PESEL odpytano o księgę');
  assert.equal(imp.after.peselsMatchedInRegister, 1, 'i ile z nich trafiło');
  assert.equal(imp.after.namesReturned, true, 'wiersz mówi też, czy odpowiedź niosła nazwiska');
  assert.ok(JSON.stringify(imp.after).length < 2000, 'wiersz audytu: ' + JSON.stringify(imp.after).length + ' B');
  /* Sekretariat i tak widzi całą księgę, więc nazwisko w komunikacie niczego mu nie dodaje —
     ale numer księgi wystarcza, żeby odnaleźć wpis. */
  assert.match(dry.rows[0].issues.find((i) => i.code === 'pesel_in_register').message, new RegExp('nr księgi ' + known.registerNo));
  assert.equal(dry.rows[0].issues.find((i) => i.code === 'pesel_in_register').registerNo, known.registerNo);
});

test('R7 SIO: skaner składni nie jest kwadratowy i odmawia czysto przy bombie zagnieżdżeń i złym odwołaniu (R3-06, S3-19)', () => {
  /* R3-06: `tag_mismatch` wstawiał numer linii do komunikatu z góry, dla KAŻDEGO niedopasowania,
     a wyliczenie numeru kopiowało cały dotychczasowy tekst. Pół megabajta zepsutego eksportu
     wklejone do walidatora zajmowało jednoprocesowy serwer szkoły na ~7 sekund. */
  const t0 = Date.now(); const big = XC.wellFormed('<a></b>'.repeat(70000)); const ms = Date.now() - t0;
  assert.ok(ms < 1500, 'skan 70 000 niedopasowań trwał ' + ms + ' ms');
  assert.equal(big.errors.length, 50, 'lista błędów zamyka się na 50');
  assert.equal(big.stopped, 'too_many_errors', 'i skan przerywa się, zamiast przemiatać resztę');
  /* Pozycje dalej są prawdziwe — szybciej nie znaczy „mniej dokładnie”. */
  const pos = XC.wellFormed('<a>\n<b>\n</c>\n</a>');
  assert.equal(pos.errors[0].code, 'tag_mismatch');
  assert.equal(pos.errors[0].line, 3); assert.equal(pos.errors[0].column, 1);
  assert.match(pos.errors[0].message, /linia 2/);

  /* S3-19: odwołanie spoza zakresu Unicode wywracało parser aSc komunikatem „Invalid code point
     4294967295”, który szedł prosto do rozmówcy. */
  const ent = XC.wellFormed('<a>&#xFFFFFFFF;</a>');
  assert.equal(ent.ok, false);
  assert.equal(ent.errors[0].code, 'bad_entity');
  assert.match(ent.errors[0].message, /spoza zakresu Unicode/);
  assert.equal(/Invalid code point|RangeError/.test(ent.errors[0].message), false, 'komunikat po polsku, bez wnętrzności silnika');
  assert.equal(XC.wellFormed('<a>&#xD800;</a>').errors[0].code, 'bad_entity', 'połówka pary zastępczej też');
  assert.equal(XC.wellFormed('<a>&#x1F600; &amp; &#65;</a>').ok, true, 'poprawne odwołania przechodzą');

  const deep = XC.wellFormed('<d>'.repeat(20000));
  assert.equal(deep.errors[0].code, 'nesting_too_deep');
  assert.equal(deep.stopped, 'nesting_too_deep');
  assert.match(deep.errors[0].message, /Sprawdzanie przerwano/);
  assert.ok(XC.MAX_DEPTH >= 100 && XC.MAX_DEPTH <= 2000, 'próg zostawia zapas nad czterema poziomami sprawozdania');
  /* Prawdziwe sprawozdanie nadal przechodzi. */
  const ok = XC.wellFormed('<sio><oddzialy><oddzial><uczen nazwisko="Żółć"/></oddzial></oddzialy></sio>');
  assert.equal(ok.ok, true); assert.equal(ok.depth, 3); assert.equal(ok.stopped, null);
});

test('R7 attendance: bomba zagnieżdżeń w pliku frekwencji to 400 po polsku, nie zawieszony proces (S3-19)', async () => {
  const c = await registrar();
  const r = await c.post('/api/registry/attendance/import', { xml: '<d>'.repeat(20000) });
  assert.equal(r.status, 400);
  assert.equal(r.body.code, 'xml_not_well_formed');
  assert.match(r.body.error, /Plik nie jest poprawnym dokumentem XML/);
  assert.equal(/Maximum call stack|RangeError|undefined/.test(r.body.error), false, 'bez wnętrzności silnika w komunikacie');
  const bad = await c.post('/api/registry/attendance/import', { xml: '<a status="ob">&#xFFFFFFFF;</a>' });
  assert.equal(bad.status, 400);
  assert.match(bad.body.error, /spoza zakresu Unicode/);
});
