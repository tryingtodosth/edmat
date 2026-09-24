'use strict';
const test = require('node:test'); const assert = require('node:assert/strict');
const { startServer, expectOk, fixtures } = require('./helpers');
const C = require('../server/lib/crypto');

let S; test.before(async () => { S = await startServer(); }); test.after(() => S.close());
const JAN = 'st_nowak_jan';

test('[3.4.1] psycholog prowadzi dziennik zajęć innych z celami terapeutycznymi i tygodniowymi tematami', async () => {
  const c = await S.as('e.zielinska');
  const g = expectOk(await c.post('/api/support/other-activities', {
    name: 'Zajęcia rozwijające kompetencje emocjonalno-społeczne · 7a', form: 'emo',
    goals: ['Rozpoznawanie emocji', 'Współpraca w grupie'],
    studentIds: ['st_baran_julia', 'st_duda_lena']
  }), 'create group');
  assert.equal(g.goals.length, 2); assert.equal(g.specialistId, 'u_zielinska'); assert.deepEqual(g.classIds, ['7a']);

  const s1 = expectOk(await c.post('/api/support/other-activities/' + g.id + '/sessions', {
    date: '2026-10-06', topic: 'Rozpoznawanie emocji na podstawie sytuacji z życia klasy', goal: 'Rozwijanie kompetencji emocjonalno-społecznych',
    attendance: [{ studentId: 'st_baran_julia', status: 'ob' }, { studentId: 'st_duda_lena', status: 'nb' }]
  }), 'session 1');
  assert.equal(s1.attendance.length, 2);
  expectOk(await c.post('/api/support/other-activities/' + g.id + '/sessions', { date: '2026-10-13', topic: 'Strategie radzenia sobie z napięciem', goal: 'Redukcja lęku szkolnego' }), 'session 2');

  const fresh = S.db.get('otherActivities', g.id);
  assert.equal(fresh.sessions.length, 2);
  assert.equal(fresh.sessions[1].attendance.every((a) => a.status === 'ob'), true, 'domyślnie wszyscy obecni');
  // the seeded group for Jan has the four weekly meetings
  const seeded = S.db.get('otherActivities', 's_oa_emo_7b');
  assert.equal(seeded.sessions.length, 4);
  assert.ok(S.db.col('audit').some((a) => a.action === 'other_activities_session'));
});

test('[3.4.2] pedagog specjalny zaprasza wychowawcę do wspólnej redakcji WOPFU; zakres sekcji jest egzekwowany', async () => {
  const spec = await S.as('pedagog.specjalny');
  const w = expectOk(await spec.get('/api/support/wopfu?studentId=' + JAN)).item;
  assert.ok(w && w.sections.mocne);

  const inv = expectOk(await spec.post('/api/support/wopfu/' + w.id + '/invite', { userId: 'u_nowak', scope: 'sections', sections: ['mocne', 'bariery'] }), 'invite');
  assert.ok(inv.editors.some((e) => e.userId === 'u_nowak'));
  assert.ok(S.db.col('notifications').some((n) => n.userId === 'u_nowak' && n.kind === 'wopfu-invite'), 'wychowawca dostał powiadomienie');

  const teacher = await S.as('j.nowak');
  const before = w.sections.bariery;
  const after = before + ' Męczliwość narasta po 5. lekcji (obserwacja X 2026).';
  const upd = expectOk(await teacher.patch('/api/support/wopfu/' + w.id, { sections: { bariery: after }, reason: 'Obserwacja na lekcjach matematyki' }), 'teacher edit');
  assert.equal(upd.sections.bariery, after);
  const v = upd.versions[upd.versions.length - 1];
  assert.equal(v.byUserId, 'u_nowak'); assert.equal(v.before, before); assert.equal(v.after, after);

  const denied = await teacher.patch('/api/support/wopfu/' + w.id, { sections: { zalecenia: 'próba edycji poza zakresem' } });
  assert.equal(denied.status, 403); assert.equal(denied.body.code, 'section_forbidden');
  assert.notEqual(S.db.get('wopfu', w.id).sections.zalecenia, 'próba edycji poza zakresem');
});

test('[3.4.3] pedagog specjalny przygotowuje IPET: działania zintegrowane, formy pomocy, godziny rewalidacji, dostosowania egzaminu', async () => {
  const c = await S.as('pedagog.specjalny');
  const jan = expectOk(await c.get('/api/support/ipet?studentId=' + JAN)).item;
  assert.equal(jan.rehabHoursPerWeek, 2);
  assert.deepEqual(jan.examAccommodations, ['wydłużony czas pracy', 'osobna sala']);
  assert.ok(jan.supportForms.some((f) => f.form === 'kk' && f.hoursPerWeek === 2));
  assert.equal((await c.post('/api/support/ipet', { studentId: JAN })).status, 409, 'IPET na ten rok już istnieje');

  const made = expectOk(await c.post('/api/support/ipet', {
    studentId: 'st_lewandowski_piotr', basis: 'Orzeczenie nr 18/2026',
    integratedActions: ['Wspólne planowanie lekcji z nauczycielem wspomagającym'],
    supportForms: [{ form: 'dydaktyczno', name: 'Zajęcia dydaktyczno-wyrównawcze', hoursPerWeek: 2 }],
    rehabHoursPerWeek: 3, examAccommodations: ['wydłużony czas pracy', 'arkusz dostosowany'],
    recommendations: [{ id: 'rec_czas', text: 'Wydłużony czas na zadania' }],
    goals: [{ id: 'goal1', title: 'Czytanie ze zrozumieniem', target: 80, level: 55 }]
  }), 'create ipet');
  assert.equal(made.rehabHoursPerWeek, 3); assert.equal(made.supportForms[0].hoursPerWeek, 2);
  assert.equal(made.examAccommodations.length, 2); assert.equal(made.versions[0].kind, 'create');
  assert.ok(S.db.col('audit').some((a) => a.action === 'ipet_create' && a.entityId === made.id));

  const teacher = await S.as('j.nowak');
  assert.equal((await teacher.post('/api/support/ipet', { studentId: 'st_szymanska_karolina' })).status, 403, 'nauczyciel nie zakłada IPET');
});

test('[3.4.4] notatka z interwencji jest szyfrowana asymetrycznie: czyta autor i upoważniony zastępca, inni dostają 403 i tylko metadane', async () => {
  const psy = await S.as('e.zielinska');
  const created = expectOk(await psy.post('/api/support/notes', {
    studentId: JAN, title: 'Notatka z interwencji · test', text: 'TAJNA-TRESC-INTERWENCJI rozmowa wspierająca po zgłoszeniu wychowawcy.',
    readerIds: ['u_pedagog']
  }), 'create note');
  assert.equal(created.sealed, true); assert.equal(created.text, undefined, 'POST nie zwraca jawnej treści');

  const row = S.db.get('confidentialNotes', created.id);
  assert.ok(row.envelope.ciphertext && row.envelope.wrappedKeys.u_zielinska && row.envelope.wrappedKeys.u_pedagog);
  assert.equal(JSON.stringify(row.envelope).includes('TAJNA-TRESC'), false, 'treść nie leży w bazie jawnie');

  const mine = expectOk(await psy.get('/api/support/notes/' + created.id));
  assert.equal(mine.sealed, false); assert.match(mine.text, /TAJNA-TRESC-INTERWENCJI/);
  const deputy = await S.as('pedagog');
  assert.match(expectOk(await deputy.get('/api/support/notes/' + created.id)).text, /TAJNA-TRESC-INTERWENCJI/);

  const other = await S.as('pedagog.specjalny');
  const denied = await other.get('/api/support/notes/' + created.id);
  assert.equal(denied.status, 403); assert.equal(denied.body.code, 'not_a_reader');
  assert.equal(denied.body.sealed.sealed, true); assert.equal(denied.body.sealed.text, undefined);
  const list = expectOk(await other.get('/api/support/notes?studentId=' + JAN));
  assert.equal(list.every((n) => n.sealed === true && n.text === undefined), true, 'lista pokazuje wyłącznie zapieczętowane metadane');
  assert.ok(S.db.col('audit').some((a) => a.action === 'note_access_denied' && a.entityId === created.id));

  // real cryptography: the specialist's own private key cannot open the envelope
  const specKey = S.db.get('users', 'u_specjalny').privateKey;
  assert.equal(C.decryptFor(row.envelope, 'u_specjalny', specKey), null);
  assert.throws(() => C.decryptFor(row.envelope, 'u_zielinska', specKey), 'cudzy klucz prywatny nie odszyfruje koperty');
  assert.match(C.decryptFor(row.envelope, 'u_pedagog', S.db.get('users', 'u_pedagog').privateKey), /TAJNA-TRESC-INTERWENCJI/);
});

test('[3.4.5] eksport XML klasy przez administrację zawiera tylko formalną frekwencję z dziennika zajęć innych, bez notatek terapeutycznych', async () => {
  const reg = await S.as('sekretariat');
  const r = await reg.get('/api/support/export/xml?classId=7b');
  assert.equal(r.status, 200);
  const xml = r.body;
  assert.match(xml, /^<\?xml version="1\.0" encoding="UTF-8"\?>/);
  assert.match(xml, /<dziennikZajecInnych>/);
  assert.match(xml, /<frekwencja uczen="st_nowak_jan" status="ob"\/>/);
  assert.match(xml, /<spotkanie data="2026-10-20" temat="/);
  for (const secret of ['TAJNA-TRESC-INTERWENCJI', 'Rozmowa wspierająca', 'WISC-V', 'Bardzo dobra pamięć wzrokowa', 'Trudność w utrzymaniu uwagi', 'notatka poufna']) {
    assert.equal(xml.includes(secret), false, 'eksport nie może zawierać: ' + secret);
  }
  assert.match(xml, /pominieto notatkiPoufne="\d+"/);
  assert.ok(S.db.col('audit').some((a) => a.action === 'support_export_xml'));
  const psy = await S.as('e.zielinska');
  assert.equal((await psy.get('/api/support/export/xml?classId=7b')).status, 403, 'eksport SIO robi administracja');
});

test('[3.4.6] wpis z terapii logopedycznej widzi wyłącznie rodzic tego ucznia', async () => {
  const log = await S.as('logopeda');
  const row = expectOk(await log.post('/api/support/speech-sessions', {
    studentId: JAN, date: '2026-10-19', attendance: 'ob',
    exercises: 'Głoska sz w izolacji i w sylabach otwartych, ćwiczenia pionizacji języka przed lustrem.',
    homeRecommendations: 'Codziennie 5 minut: sza, sze, szu przed lustrem. Czytanie na głos dwóch zdań z karty 12.'
  }), 'create speech session');
  assert.equal(row.attendance, 'ob');

  const parent = await S.as('rodzic.nowak');
  const mine = expectOk(await parent.get('/api/support/speech-sessions?studentId=' + JAN));
  assert.equal(mine.length >= 1, true);
  assert.match(mine[mine.length - 1].homeRecommendations, /sza, sze, szu/);

  const otherParent = await S.as('rodzic.kowalczyk');
  const d1 = await otherParent.get('/api/support/speech-sessions?studentId=' + JAN);
  assert.equal(d1.status, 403); assert.equal(d1.body.code, 'parent_only');

  const teacher = await S.as('j.nowak');
  assert.equal((await teacher.get('/api/support/speech-sessions?studentId=' + JAN)).status, 403, 'nauczyciel przedmiotu nie widzi wpisu');
  const psy = await S.as('e.zielinska');
  assert.equal((await psy.get('/api/support/speech-sessions?studentId=' + JAN)).status, 403);
});

const need = fixtures();
const ipetImplementation = () => need('ipetImplementation', async () => {
  const sup = await S.as('n.wspomagajacy');
  const view = expectOk(await sup.get('/api/support/ipet-implementation?studentId=' + JAN + '&date=' + S.TODAY));
  const lesson = view.lessons[0];
  const saved = expectOk(await sup.post('/api/support/ipet-implementation', { studentId: JAN, lessonId: lesson.lessonId, recommendations: ['rec_czas', 'rec_miejsce'], note: 'Praca w pierwszej ławce, zadania podzielone na etapy.' }), 'log implementation');
  return { sup, view, lesson, saved };
});

test('[3.4.7] nauczyciel wspomagający odnotowuje dzienną realizację zaleceń IPET z widoku dziennika lekcyjnego', async () => {
  const { sup, view, lesson, saved } = await ipetImplementation();
  assert.equal(view.date, S.TODAY);
  assert.ok(view.lessons.length >= 4, 'widok dziennika lekcyjnego z lekcjami dnia');
  assert.ok(view.recommendations.some((r) => r.id === 'rec_czas'));
  assert.deepEqual(saved.recommendations, ['rec_czas', 'rec_miejsce']);
  assert.equal(saved.date, S.TODAY);

  const again = expectOk(await sup.get('/api/support/ipet-implementation?studentId=' + JAN + '&date=' + S.TODAY));
  assert.deepEqual(again.lessons[0].applied, ['rec_czas', 'rec_miejsce']);

  const bogus = await sup.post('/api/support/ipet-implementation', { studentId: JAN, lessonId: lesson.lessonId, recommendations: ['rec_nieznane'] });
  assert.equal(bogus.status, 400); assert.equal(bogus.body.code, 'no_recommendations');
  assert.ok(S.db.col('audit').some((a) => a.action === 'ipet_implementation'));
});

test('[3.4.8] pedagog generuje okresową ewaluację skuteczności pomocy za semestr 1 i wydruk PDF na zespół', async () => {
  await ipetImplementation();
  const c = await S.as('pedagog');
  const ev = expectOk(await c.post('/api/support/evaluations', { studentId: JAN, semester: 1, conclusions: 'Kontynuacja zajęć, modyfikacja celu 3.' }), 'evaluation');
  assert.equal(ev.semester, 1);
  assert.equal(ev.attendance.planned, 4, 'cztery spotkania zajęć innych w semestrze 1');
  assert.equal(ev.attendance.present, 3);
  assert.equal(ev.attendance.percent, 75);
  assert.equal(ev.goals.length, 3);
  assert.equal(ev.goals.find((g) => g.id === 'goal2').met, true);
  assert.equal(ev.goals.find((g) => g.id === 'goal3').met, false);
  assert.ok(ev.implementationEntries >= 1, 'wpisy dziennej realizacji zaleceń wliczone');

  const print = await c.get('/api/support/evaluations/' + ev.id + '/print');
  assert.equal(print.status, 200);
  assert.equal(print.headers.get('content-type'), 'text/html; charset=utf-8');
  assert.match(print.body, /^<!doctype html>/);
  assert.match(print.body, /Okresowa wielospecjalistyczna ocena skuteczności pomocy/);
  assert.match(print.body, /Utrzymanie uwagi przez 20 minut/);
  assert.match(print.body, /app\/autoprint\.js/);
  assert.equal(print.body.includes('TAJNA-TRESC-INTERWENCJI'), false, 'wydruk nie zawiera notatek poufnych');
});

test('[3.4.9] rodzic widzi publiczną opinię i wyciąg, nigdy chronionej dokumentacji diagnostycznej', async () => {
  const psy = await S.as('e.zielinska');
  const extract = expectOk(await psy.post('/api/support/documents', { studentId: JAN, name: 'Wyciąg z IPET: zalecenia do pracy w domu', kind: 'ipetExtract', body: 'Polecenia dzielone na etapy, wydłużony czas pracy.' }), 'create extract');
  expectOk(await psy.post('/api/support/documents/' + extract.id + '/share', { shared: true }));

  const blocked = await psy.post('/api/support/documents/s_doc_diagnoza/share', { shared: true });
  assert.equal(blocked.status, 403); assert.equal(blocked.body.code, 'protected_document');

  const parent = await S.as('rodzic.nowak');
  const list = expectOk(await parent.get('/api/support/documents?studentId=' + JAN));
  assert.equal(list.some((x) => x.id === 's_doc_opinia'), true);
  assert.equal(list.some((x) => x.id === extract.id), true);
  assert.equal(list.some((x) => x.protected), false);
  assert.equal(list.some((x) => x.id === 's_doc_diagnoza'), false);

  const one = await parent.get('/api/support/documents/s_doc_diagnoza');
  assert.equal(one.status, 403); assert.equal(one.body.code, 'protected_document');
  // even if a protected document were flagged as shared, the parent is still refused
  S.db.get('supportDocuments', 's_doc_diagnoza').shared = true; S.db.save();
  const still = await parent.get('/api/support/documents/s_doc_diagnoza');
  assert.equal(still.status, 403);
  assert.equal(expectOk(await parent.get('/api/support/documents?studentId=' + JAN)).some((x) => x.id === 's_doc_diagnoza'), false);
  assert.ok(S.db.col('audit').some((a) => a.action === 'support_document_denied'));
});

test('[3.4.10] Niebieska Karta / nadzór kuratora w rejestrze zdarzeń: dostęp tylko dla pedagoga i czytelników dyrektora, każda próba audytowana', async () => {
  const ped = await S.as('pedagog');
  const inc = expectOk(await ped.post('/api/support/incidents', {
    studentId: JAN, kind: 'blueCard', caseNo: 'NK-14/2026', institution: 'KMP Kraków',
    text: 'NIEBIESKA-KARTA-TRESC: wszczęcie procedury, notatka zespołu interwencyjnego z 19.10.2026.'
  }), 'create incident');
  assert.equal(inc.text, undefined, 'POST zwraca wyłącznie metadane');
  assert.ok(inc.readerIds.includes('u_pedagog') && inc.readerIds.includes('u_dyrektor'));

  assert.match(expectOk(await ped.get('/api/support/incidents/' + inc.id)).text, /NIEBIESKA-KARTA-TRESC/);
  const dyr = await S.as('dyrektor');
  assert.match(expectOk(await dyr.get('/api/support/incidents/' + inc.id)).text, /NIEBIESKA-KARTA-TRESC/);

  const psy = await S.as('e.zielinska');
  const denied = await psy.get('/api/support/incidents/' + inc.id);
  assert.equal(denied.status, 403); assert.equal(denied.body.code, 'incident_restricted');
  const list = expectOk(await psy.get('/api/support/incidents?studentId=' + JAN));
  const locked = list.find((x) => x.id === inc.id);
  assert.equal(locked.locked, true); assert.equal(locked.text, undefined);

  const row = S.db.get('incidents', inc.id);
  assert.ok(row.accessLog.some((a) => a.userId === 'u_zielinska' && a.granted === false), 'każda próba dostępu jest rejestrowana');
  assert.ok(row.accessLog.some((a) => a.userId === 'u_dyrektor' && a.granted === true));
  assert.ok(S.db.col('audit').some((a) => a.action === 'incident_access_denied' && a.entityId === inc.id));
  assert.ok(S.db.col('audit').some((a) => a.action === 'incident_access' && a.entityId === inc.id));
});

test('[3.4.11] planowanie zajęć wyrównawczych wykrywa kolizję z obowiązkowymi lekcjami ucznia', async () => {
  const c = await S.as('pedagog.specjalny');
  const clash = await c.post('/api/support/sessions', { studentId: JAN, date: '2026-10-27', lessonNo: 3, form: 'kk' });
  assert.equal(clash.status, 409); assert.equal(clash.body.code, 'lesson_conflict');
  assert.equal(clash.body.conflict.lessonNo, 3);
  assert.equal(clash.body.conflict.date, '2026-10-27');
  assert.ok(clash.body.conflict.lessonId && clash.body.conflict.subject && clash.body.conflict.start);
  assert.match(clash.body.error, /zajęcia obowiązkowe/);
  assert.equal(S.db.col('supportSessions').some((x) => x.date === '2026-10-27' && x.lessonNo === 3), false, 'kolidujący termin nie został zapisany');

  const ok = expectOk(await c.post('/api/support/sessions', { studentId: JAN, date: '2026-10-27', lessonNo: 7, form: 'kk', room: '18' }), 'free slot');
  assert.equal(ok.lessonNo, 7);
  assert.ok(S.db.col('audit').some((a) => a.action === 'support_session_conflict'));
});

test('[3.4.12] wywiad środowiskowy z zaszyfrowanym hasłem skanem pisma przewodniego', async () => {
  const ped = await S.as('pedagog');
  const PW = 'Pismo-MOPS-2026!';
  /* S-13: skan przechodzi przez wspólny walidator, więc treść musi być tym, czym się deklaruje. */
  const SCAN_TEXT = '%PDF-1.4\nSKAN-PISMA-PRZEWODNIEGO-MOPS-KRAKOW-DZIELNICA-VII';
  const scan = Buffer.from(SCAN_TEXT).toString('base64');
  const weak = await ped.post('/api/support/interviews', { studentId: JAN, date: '2026-10-22', socialWorker: 'Barbara Sowa', password: 'krotkie', attachment: { name: 'pismo.pdf', data: scan } });
  assert.equal(weak.status, 400); assert.equal(weak.body.code, 'weak_password');

  const row = expectOk(await ped.post('/api/support/interviews', {
    studentId: JAN, date: '2026-10-22', socialWorker: 'Barbara Sowa · MOPS Kraków, Dzielnica VII',
    notes: 'Wywiad środowiskowy w miejscu zamieszkania, obecny opiekun prawny.', password: PW,
    attachment: { name: 'pismo-przewodnie.pdf', data: scan, contentType: 'application/pdf' }
  }), 'create interview');
  assert.equal(row.attachment.alg, 'AES-256-GCM/scrypt');
  assert.equal(row.attachment.data, undefined, 'szyfrogram nie wraca w odpowiedzi');

  const stored = S.db.get('communityInterviews', row.id);
  assert.equal(stored.attachment.data.includes('SKAN-PISMA'), false);
  assert.equal(Buffer.from(stored.attachment.data, 'base64').toString('utf8').includes('SKAN-PISMA'), false, 'skan leży w bazie zaszyfrowany');
  assert.equal(stored.password, undefined, 'hasła nie zapisujemy');

  assert.equal((await ped.post('/api/support/interviews/' + row.id + '/attachment', {})).status, 400);
  const bad = await ped.post('/api/support/interviews/' + row.id + '/attachment', { password: 'Zle-Haslo-2026!' });
  assert.equal(bad.status, 403); assert.equal(bad.body.code, 'bad_password');

  const good = expectOk(await ped.post('/api/support/interviews/' + row.id + '/attachment', { password: PW }), 'download');
  assert.equal(Buffer.from(good.data, 'base64').toString('utf8'), SCAN_TEXT);
  assert.ok(S.db.col('audit').some((a) => a.action === 'community_interview_attachment_denied'));

  /* S-13: „skan” będący stroną HTML nie wchodzi do dokumentacji, a PDF, który PDF-em nie jest, też nie. */
  const html = await ped.post('/api/support/interviews', { studentId: JAN, date: '2026-10-22', password: PW,
    attachment: { name: 'pismo.html', contentType: 'text/html', data: Buffer.from('<script>alert(1)</script>').toString('base64') } });
  assert.equal(html.status, 415); assert.equal(html.body.code, 'file_type_not_allowed');
  const fake = await ped.post('/api/support/interviews', { studentId: JAN, date: '2026-10-22', password: PW,
    attachment: { name: 'pismo.pdf', contentType: 'application/pdf', data: Buffer.from('<html>nie-pdf</html>').toString('base64') } });
  assert.equal(fake.status, 415); assert.equal(fake.body.code, 'content_mismatch');
  const traversal = expectOk(await ped.post('/api/support/interviews', { studentId: JAN, date: '2026-10-22', password: PW,
    attachment: { name: '../../etc/pismo.pdf', contentType: 'application/pdf', data: scan } }));
  assert.equal(traversal.attachment.name, 'pismo.pdf', 'nazwa pliku traci separatory ścieżki');
});

test('[S-16] hasło do skanu wywiadu ma okno prób: po 5 nieudanych próbach 429, audyt raz na blokadę', async () => {
  const ped = await S.as('pedagog');
  const PW = 'Pismo-MOPS-2026!';
  const scan = Buffer.from('%PDF-1.4\nSKAN-PISMA-DO-LIMITU').toString('base64');
  const row = expectOk(await ped.post('/api/support/interviews', {
    studentId: JAN, date: '2026-10-22', socialWorker: 'Barbara Sowa', password: PW,
    attachment: { name: 'pismo-limit.pdf', data: scan, contentType: 'application/pdf' }
  }), 'create interview');
  const url = '/api/support/interviews/' + row.id + '/attachment';

  /* pięć nieudanych prób mieści się w oknie i kończy się zwykłą odmową */
  for (let i = 0; i < 5; i++) {
    const r = await ped.post(url, { password: 'Zle-Haslo-' + i });
    assert.equal(r.status, 403, 'próba ' + (i + 1) + ' to jeszcze bad_password');
    assert.equal(r.body.code, 'bad_password');
  }
  /* szósta nie dochodzi już do scrypta */
  const locked = await ped.post(url, { password: 'Zle-Haslo-5' });
  assert.equal(locked.status, 429); assert.equal(locked.body.code, 'rate_limited');
  assert.ok(locked.body.retryAfterSeconds > 0 && locked.body.retryAfterSeconds <= 15 * 60);
  assert.match(locked.body.error || locked.body.message || '', /Zbyt wiele nieudanych prób/);

  /* w oknie blokady nie pomaga nawet poprawne hasło */
  assert.equal((await ped.post(url, { password: PW })).status, 429);

  /* blokada audytowana dokładnie raz, mimo kolejnych prób */
  await ped.post(url, { password: 'Zle-Haslo-x' });
  const limits = S.db.col('audit').filter((a) => a.action === 'community_interview_attachment_rate_limited' && a.entityId === row.id);
  assert.equal(limits.length, 1, 'jeden wpis audytu na blokadę');
  assert.equal(limits[0].userId, 'u_pedagog');
  assert.equal(limits[0].after.lockedForMinutes, 15);

  /* okno jest osobne dla pary (użytkownik, wywiad): inny wywiad tego samego pracownika i ten sam
     wywiad u innego uprawnionego użytkownika pozostają otwarte */
  const other = expectOk(await ped.post('/api/support/interviews', {
    studentId: JAN, date: '2026-10-22', socialWorker: 'Barbara Sowa', password: PW,
    attachment: { name: 'pismo-inne.pdf', data: scan, contentType: 'application/pdf' }
  }));
  assert.ok(expectOk(await ped.post('/api/support/interviews/' + other.id + '/attachment', { password: PW })).data);
  const dyr = await S.as('dyrektor');
  assert.ok(expectOk(await dyr.post(url, { password: PW }), 'dyrektor nie dziedziczy blokady').data);
});

test('[3.4.13] IPET i WOPFU przenoszą się na nowy rok szkolny z historią wersji', async () => {
  const c = await S.as('pedagog.specjalny');
  const before = S.db.get('wopfu', 's_wopfu_nowak_2026');
  const out = expectOk(await c.post('/api/support/rollover', { studentId: JAN }), 'rollover');
  assert.equal(out.year, '2027/2028');
  assert.equal(out.wopfu.year, '2027/2028'); assert.equal(out.wopfu.rolledFrom, 's_wopfu_nowak_2026');
  assert.equal(out.ipet.year, '2027/2028'); assert.equal(out.ipet.rolledFrom, 's_ipet_nowak_2026');
  assert.equal(out.wopfu.sections.mocne, before.sections.mocne, 'treść przeniesiona');
  assert.equal(out.wopfu.versions.length, before.versions.length + 1);
  const last = out.wopfu.versions[out.wopfu.versions.length - 1];
  assert.equal(last.kind, 'rollover'); assert.equal(last.before, '2026/2027'); assert.equal(last.after, '2027/2028');
  assert.equal(out.ipet.versions[out.ipet.versions.length - 1].kind, 'rollover');
  assert.ok(S.db.get('wopfu', 's_wopfu_nowak_2026'), 'wersja poprzedniego roku pozostaje w bazie');
  assert.ok(S.db.col('audit').some((a) => a.action === 'ipet_rollover'));
  const again = expectOk(await c.post('/api/support/rollover', { studentId: JAN }));
  assert.equal(again.wopfu.id, out.wopfu.id, 'ponowne przeniesienie nie duplikuje dokumentu');
});

test('[3.4.14] psycholog wysyła nauczycielowi zaszyfrowaną prośbę o opinię o funkcjonowaniu ucznia', async () => {
  const psy = await S.as('e.zielinska');
  const req = expectOk(await psy.post('/api/support/report-requests', {
    studentId: JAN, teacherId: 'u_nowak', scope: 'koncentracja i tempo pracy na lekcjach', meetingDate: '2026-11-12'
  }), 'send request');
  assert.equal(req.teacherId, 'u_nowak'); assert.equal(req.status, 'sent');

  const msg = S.db.get('messages', req.messageId);
  assert.ok(msg, 'prośba poszła kanałem wiadomości');
  assert.equal(msg.confidential, true); assert.equal(msg.encrypted, true);
  assert.deepEqual(msg.toUserIds, ['u_nowak']);
  assert.equal(msg.body.includes('koncentracja i tempo pracy'), false, 'treść zaszyfrowana w body');

  const env = JSON.parse(msg.body);
  assert.equal(env.alg, 'AES-256-GCM+RSA-OAEP');
  assert.deepEqual(Object.keys(env.wrappedKeys).sort(), ['u_nowak', 'u_zielinska']);
  const teacherKey = S.db.get('users', 'u_nowak').privateKey;
  const plain = C.decryptFor(env, 'u_nowak', teacherKey);
  assert.match(plain, /Proszę o opinię o funkcjonowaniu ucznia/);
  assert.match(plain, /koncentracja i tempo pracy na lekcjach/);
  assert.match(C.decryptFor(env, 'u_zielinska', S.db.get('users', 'u_zielinska').privateKey), /zespołu orzekającego/);
  assert.equal(C.decryptFor(env, 'u_wojcik', S.db.get('users', 'u_wojcik').privateKey || teacherKey), null, 'postronny nauczyciel nie ma klucza w kopercie');
  assert.ok(S.db.col('notifications').some((n) => n.userId === 'u_nowak' && n.kind === 'report-request'));
});

test('[3.4.15] 3 kolejne dni nieobecności ucznia objętego pomocą społeczną bez informacji od rodzica uruchamiają alert dla pedagoga', async () => {
  const db = S.db; const DAYS = ['2026-10-19', '2026-10-20', '2026-10-21'];
  // deterministic scenario: full unexcused absence on the three school days, no parent notification
  for (const date of DAYS) {
    const rows = db.col('attendance').filter((a) => a.studentId === JAN && a.date === date);
    if (!rows.length) {
      for (const l of db.col('lessons').filter((x) => x.date === date && x.classId === '7b')) {
        if (l.groupId) { const g = db.get('groups', l.groupId); if (!g || !g.studentIds.includes(JAN)) continue; }
        db.col('attendance').push({ id: 't_att_' + date + '_' + l.lessonNo, lessonId: l.id, studentId: JAN, date, lessonNo: l.lessonNo, classId: '7b', subjectId: l.subjectId, status: 'nb', minutes: 0, draft: false, byUserId: l.teacherId, at: date + 'T08:05:00Z', excuseId: null });
      }
    } else rows.forEach((a) => { a.status = 'nb'; a.draft = false; a.excuseId = null; });
  }
  db.data.excuses = db.col('excuses').filter((e) => !(e.studentId === JAN && e.from <= '2026-10-21' && (e.to || e.from) >= '2026-10-19'));
  db.save();

  /* W CZASIE RZECZYWISTYM: trzeci dzień nieobecności zapisujemy zwykłą trasą frekwencji i alert ma już
     istnieć — bez otwierania ekranu pomocy p-p przez pedagoga. */
  const teacher = await S.as('j.nowak');
  const third = db.col('lessons').find((l) => l.date === '2026-10-21' && l.classId === '7b' && l.teacherId === 'u_nowak' && !l.groupId);
  assert.ok(third, 'jest lekcja matematyki 7b w trzecim dniu');
  expectOk(await teacher.post('/api/attendance/lesson/' + third.id, { entries: [{ studentId: JAN, status: 'nb' }] }), 'zapis nb w trzecim dniu');
  assert.ok(db.col('attendanceAlerts').some((a) => a.studentId === JAN && a.kind === 'welfare-3-days' && !a.resolved),
    'trzeci dzień nieobecności musi utworzyć alert od razu przy zapisie frekwencji, a nie dopiero przy odczycie przez pedagoga');
  assert.ok(db.col('notifications').some((n) => n.userId === 'u_pedagog' && n.kind === 'attendance-alert' && n.crisis === true),
    'pedagog dostaje powiadomienie kryzysowe bez odpytywania');

  const ped = await S.as('pedagog');
  const out = expectOk(await ped.get('/api/support/attendance-alerts'));
  assert.equal(out.today, S.TODAY);
  const alert = out.alerts.find((a) => a.studentId === JAN);
  assert.ok(alert, 'alert dla ucznia objętego pomocą społeczną');
  assert.equal(alert.kind, 'welfare-3-days');
  assert.ok(alert.days.length >= 3);
  for (const d of DAYS) assert.ok(alert.days.includes(d), 'alert obejmuje ' + d);
  assert.match(alert.daysText, /19\.10\.2026/);
  assert.ok(db.col('notifications').some((n) => n.userId === 'u_pedagog' && n.kind === 'attendance-alert' && n.crisis === true), 'powiadomienie dla pedagoga');

  // a parent notification for one of the days clears the alert
  const other = expectOk(await ped.get('/api/support/attendance-alerts?studentId=' + JAN));
  assert.equal(other.alerts.length, 1);
  const contacted = expectOk(await ped.post('/api/support/attendance-alerts/' + alert.id + '/contact', { channel: 'phone', note: 'Kontakt z opiekunem', resolve: true }));
  assert.equal(contacted.resolved, true);
  assert.equal(expectOk(await ped.get('/api/support/attendance-alerts?studentId=' + JAN)).alerts.length, 0, 'obsłużony alert znika z listy');
});

/* ================================================================= S-08 / S-18 (przegląd bezpieczeństwa) */

test('[3.4.4] S-08: każdy odszyfrowany odczyt notatki poufnej zostawia wiersz w rejestrze — także z listy i z karty ucznia', async () => {
  const psy = await S.as('e.zielinska');
  const a = expectOk(await psy.post('/api/support/notes', { studentId: JAN, title: 'S-08 · notatka A', text: 'TRESC-A', readerIds: ['u_pedagog'] }));
  const b = expectOk(await psy.post('/api/support/notes', { studentId: JAN, title: 'S-08 · notatka B', text: 'TRESC-B', readerIds: ['u_pedagog'] }));
  const reads = (id) => S.db.col('audit').filter((x) => x.action === 'note_read' && x.entityId === id).length;
  const beforeA = reads(a.id), beforeB = reads(b.id);

  const list = expectOk(await psy.get('/api/support/notes?studentId=' + JAN));
  const opened = list.filter((n) => n.sealed === false).map((n) => n.id);
  assert.ok(opened.includes(a.id) && opened.includes(b.id), 'autorka widzi obie notatki odszyfrowane');
  assert.equal(reads(a.id), beforeA + 1, 'jeden wiersz na notatkę i żądanie');
  assert.equal(reads(b.id), beforeB + 1);
  const row = S.db.col('audit').filter((x) => x.action === 'note_read' && x.entityId === a.id).pop();
  assert.equal(row.userId, 'u_zielinska');
  assert.equal(row.entity, 'confidentialNotes');
  assert.equal(row.after.via, 'list');

  expectOk(await psy.get('/api/support/overview?studentId=' + JAN));
  assert.equal(reads(a.id), beforeA + 2, 'karta ucznia też się rozlicza');
  assert.equal(S.db.col('audit').filter((x) => x.action === 'note_read' && x.entityId === a.id).pop().after.via, 'overview');

  /* konto spoza listy czytelników dostaje same metadane — i nie generuje wpisu „odczytano” */
  const other = await S.as('pedagog.specjalny');
  const beforeSealed = reads(a.id);
  const sealed = expectOk(await other.get('/api/support/notes?studentId=' + JAN));
  assert.equal(sealed.every((n) => n.sealed === true), true);
  assert.equal(reads(a.id), beforeSealed, 'zapieczętowana notatka nie jest odczytem treści');
});

test('[3.4.10] S-08: karta ucznia rozlicza wgląd w rejestr zdarzeń tak samo jak wykaz', async () => {
  const ped = await S.as('pedagog');
  const inc = expectOk(await ped.post('/api/support/incidents', { studentId: JAN, kind: 'blueCard', text: 'S-08 · zdarzenie testowe' }));
  const hits = (action) => S.db.col('audit').filter((x) => x.action === action && x.entityId === inc.id).length;
  const before = hits('incident_access');
  expectOk(await ped.get('/api/support/overview?studentId=' + JAN));
  assert.equal(hits('incident_access'), before + 1);
  assert.ok(S.db.get('incidents', inc.id).accessLog.some((l) => l.userId === 'u_pedagog' && l.granted === true));

  const outsider = await S.as('logopeda');
  const beforeDenied = hits('incident_access_denied');
  const ov = expectOk(await outsider.get('/api/support/overview?studentId=' + JAN));
  assert.equal(ov.incidents.find((i) => i.id === inc.id).locked, true, 'treść pozostaje zamknięta');
  assert.equal(hits('incident_access_denied'), beforeDenied + 1);
});

test('[3.4.4] S-18: odrzucony czytelnik notatki nie kosztuje wygenerowania pary kluczy RSA', async () => {
  const psy = await S.as('e.zielinska');
  const withKeys = () => S.db.col('users').filter((u) => u.publicKey).length;
  const before = withKeys();
  const bad = await psy.post('/api/support/notes', { studentId: JAN, title: 'S-18', text: 'x', readerIds: ['u_biblioteka', 'u_swietlica', 'u_stolowka'] });
  assert.equal(bad.status, 400);
  assert.match(bad.body.error, /specjalista/);
  assert.equal(withKeys(), before, 'żadne konto nie dostało kluczy, zanim rola została sprawdzona');
  assert.equal(S.db.get('users', 'u_biblioteka').privateKey, undefined);

  const missing = await psy.post('/api/support/notes', { studentId: JAN, title: 'S-18', text: 'x', readerIds: ['u_nie_ma_takiego'] });
  assert.equal(missing.status, 404);
  assert.equal(withKeys(), before);
});

test('[3.4.9] S-13: skan dołączony do dokumentu pomocy przechodzi wspólną walidację', async () => {
  const c = await S.as('pedagog.specjalny');
  const pdf = 'data:application/pdf;base64,' + Buffer.from('%PDF-1.4\nopinia').toString('base64');
  const ok = expectOk(await c.post('/api/support/documents', { studentId: JAN, name: 'Opinia PPP', kind: 'opinion', attachment: { name: 'opinia.pdf', type: 'application/pdf', dataUrl: pdf } }));
  assert.equal(ok.attachment.type, 'application/pdf');
  assert.equal(ok.attachment.size, Buffer.byteLength('%PDF-1.4\nopinia'), 'rozmiar liczony z treści, nie z pola klienta');

  const svg = await c.post('/api/support/documents', { studentId: JAN, name: 'Opinia', kind: 'opinion',
    attachment: { name: 'opinia.svg', type: 'image/svg+xml', dataUrl: 'data:image/svg+xml;base64,' + Buffer.from('<svg onload="x()"/>').toString('base64') } });
  assert.equal(svg.status, 415); assert.equal(svg.body.code, 'file_type_not_allowed');
});
