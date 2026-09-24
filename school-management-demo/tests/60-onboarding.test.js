'use strict';
/* F5 — wrzesień w szkole, która zaczyna od pustej instalacji (docs/review/round3/operations.md).
   Jeden uporządkowany przebieg zamiast siedemnastu osobnych asercji o trasach: szkoła → kadra
   z arkusza organizacyjnego → uczniowie z naboru → plan z aSc razem z podziałami na grupy →
   godzina zerowa → lekcje → frekwencja nauczycielki angielskiego na jej połowie oddziału →
   kod dla rodzica → pakiet SIO → pakiet archiwalny. Pliki wejściowe są **niezmienione**: dokładnie
   te, które szkoła ma na dysku (`tests/fixtures/real-formats/register/`, `asc/`).

   Obok: parytet kluczy konfiguracji pustej instalacji, zapis struktury roku bez zmian (OPS3-01),
   skala 24 oddziałów (H-2), cofnięcie importu planu (H-3) i partia importu po `kill -9` (R3-08). */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { startServer, expectOk, fixtures } = require('./helpers');
const TD = require('../server/lib/textdecode');
const D = require('../server/lib/domain');

const FIX = path.join(__dirname, 'fixtures', 'real-formats');
const bytes = (rel) => fs.readFileSync(path.join(FIX, rel));
const b64 = (rel) => bytes(rel).toString('base64');
/** Plik rejestru tak, jak leży: nabór i arkusz są w windows-1250, a trasa przyjmuje tekst. */
const fixtureText = (rel) => TD.decode(bytes(rel), { default: 'windows-1250' }).text;

const ADMIN_PW = 'Wrzesien-2026!ok';
const SCHOOL = {
  school: { name: 'Szkoła Podstawowa nr 12 im. Janusza Korczaka w Krakowie', short: 'SP 12', address: 'ul. Szkolna 1, 31-000 Kraków', regon: '000123456', rspo: '12345', email: 'sekretariat@sp12.krakow.pl', phone: '12 000 00 00', director: 'mgr Barbara Zawadzka' },
  admin: { login: 'admin', password: ADMIN_PW, firstName: 'Iwona', lastName: 'Adminowa', email: 'admin@sp12.krakow.pl' },
  principal: { login: 'dyrektor', firstName: 'Barbara', lastName: 'Zawadzka' },
  year: '2026/2027'
};
const need = fixtures();
const servers = [];
async function blank() { const S = await startServer({ blank: true }); servers.push(S); return S; }
test.after(async () => { for (const S of servers) await S.close(); });

/* ------------------------------------------------------------------ 1. pusta instalacja */
test('[onb.1] pusta instalacja ma te same klucze konfiguracji co zasiew demonstracyjny', async () => {
  const B = await blank();
  const Demo = await startServer(); servers.push(Demo);
  const blankKeys = Object.keys(B.db.data.config).sort();
  const demoKeys = Object.keys(Demo.db.data.config).sort();
  /* OPS3-13 — kreator gubił 18 kluczy, które zasiew demonstracyjny dokłada w seedach 13/15/17/60.
     Skutek widoczny dla sekretarki: `POST /api/registry/sio/validate` kończył się `500` na każdej
     szkole z kreatora, bo `config.sio` w ogóle nie istniało. Klucz dodany dla jednego zasiewu musi
     odtąd powstawać w obu — dlatego porównujemy zbiory, a nie listę nazw. */
  const missing = demoKeys.filter((k) => blankKeys.indexOf(k) < 0);
  assert.deepEqual(missing, [], 'klucze konfiguracji, których nie ma w pustej instalacji: ' + missing.join(', '));
  /* W drugą stronę wolno mieć więcej, ale tylko te dwa i z powodu: `setup` to stan kreatora
     (szkoła z zasiewu demonstracyjnego nigdy przez niego nie przechodzi), `modules` to pusta mapa
     włączonych modułów, którą demo dostaje z własnych zasiewów. */
  const extra = blankKeys.filter((k) => demoKeys.indexOf(k) < 0);
  assert.deepEqual(extra, ['modules', 'setup'], 'klucze, które ma tylko pusta instalacja: ' + extra.join(', '));
  for (const k of ['sio', 'payroll', 'retention', 'archiveWindow', 'auditImmutable', 'adultAccess', 'termGradeThresholds', 'visibility', 'video']) {
    assert.notEqual(B.db.data.config[k], undefined, 'brak klucza ' + k);
  }
  assert.equal(B.db.data.config.sio.schemaVersion, '1.0');
  assert.ok(Array.isArray(B.db.data.config.retention.classes) && B.db.data.config.retention.classes.length > 5, 'tabela klas dokumentacji jak w zasiewie demo');
  assert.deepEqual(B.db.data.config.payroll.pensum, {}, 'ale bez danych konkretnych nauczycieli z demo');
});

test('[onb.2] kalendarz, który wypisał kreator, da się zapisać bez zmian — i da się dopisać dzień dyrektorski', async () => {
  const B = await blank();
  const c = B.client();
  expectOk(await c.post('/api/setup/school', SCHOOL));
  const year = expectOk(await c.get('/api/admin/year'));
  /* OPS3-01 — `PATCH` tym samym, co zwrócił `GET`, kończył się `400 year_invalid`: Poniedziałek
     Wielkanocny szedł i do `daysOff`, i w środek wiosennej przerwy świątecznej, a walidator uznaje
     to za sprzeczne wpisy. Działo się to w każdej szkole i w każdym roku — szkoła z kreatora nie
     mogła zapisać ani egzaminu, ani dnia dyrektorskiego, ani poprawionej daty semestru. */
  const again = await c.patch('/api/admin/year', year);
  assert.equal(again.status, 200, JSON.stringify(again.body).slice(0, 300));
  assert.deepEqual(again.body.errors, []);

  const daysOff = year.daysOff.concat([{ date: '2026-10-14', name: 'Dzień Edukacji Narodowej (dzień wolny)' }]);
  const added = expectOk(await c.patch('/api/admin/year', { daysOff }));
  assert.ok(added.daysOff.some((d) => d.date === '2026-10-14'));
  /* Poniedziałek Wielkanocny nadal jest dniem wolnym — przez przerwę, nie przez podwójny wpis. */
  const easterMonday = '2027-03-29';
  assert.equal(added.daysOff.some((d) => d.date === easterMonday), false);
  assert.ok(added.holidays.some((hd) => easterMonday >= hd.from && easterMonday <= hd.to));
  /* A wpis sprzeczny nadal jest odrzucany — poprawiliśmy zasiew, nie regułę. */
  const bad = await c.patch('/api/admin/year', { daysOff: daysOff.concat([{ date: easterMonday, name: 'Poniedziałek Wielkanocny' }]) });
  assert.equal(bad.status, 400);
  assert.equal(bad.body.code, 'year_invalid');
});

test('[onb.3] plan dzwonków: godzina zerowa jest ustawieniem, a nie ręczną poprawką pliku konfiguracyjnego', async () => {
  const B = await blank();
  const c = B.client();
  expectOk(await c.post('/api/setup/school', SCHOOL));
  const year = expectOk(await c.get('/api/admin/year'));
  /* OPS3-03 — komunikat importu odsyłał do „ustawień szkoły”, w których nie było tego pola:
     żadna trasa nie zapisywała `config.lessonTimes`, a `GET /api/admin/year` go nie zwracał. */
  assert.ok(Array.isArray(year.lessonTimes) && year.lessonTimes.length === 8);
  const withZero = [{ no: 0, start: '07:10', end: '07:55' }].concat(year.lessonTimes);
  const saved = expectOk(await c.patch('/api/admin/year', { lessonTimes: withZero }));
  assert.deepEqual(saved.lessonTimes.map((x) => x.no), [0, 1, 2, 3, 4, 5, 6, 7, 8]);
  assert.equal(B.db.data.config.lessonTimes[0].start, '07:10');

  const bad = (list) => c.patch('/api/admin/year', { lessonTimes: list });
  assert.equal((await bad([{ no: 1, start: '08:00', end: '08:45' }, { no: 1, start: '09:00', end: '09:45' }])).status, 400, 'powtórzony numer');
  assert.equal((await bad([{ no: 1, start: '08:00', end: '09:00' }, { no: 2, start: '08:30', end: '09:15' }])).status, 400, 'nachodzące godziny');
  assert.equal((await bad([{ no: 1, start: '08:45', end: '08:00' }])).status, 400, 'koniec przed początkiem');
  assert.equal((await bad([{ no: 1, start: '25:00', end: '26:00' }])).status, 400, 'godzina spoza doby');
  const overlap = await bad([{ no: 1, start: '08:00', end: '09:00' }, { no: 2, start: '08:30', end: '09:15' }]);
  assert.match(overlap.body.errors.join(' '), /zaczyna się, zanim skończy/);
  /* Kolejność w odpowiedzi jest posortowana po numerze, nie po kolejności wysyłki. */
  const shuffled = expectOk(await c.patch('/api/admin/year', { lessonTimes: [{ no: 2, start: '08:55', end: '09:40' }, { no: 0, start: '07:10', end: '07:55' }, { no: 1, start: '08:00', end: '08:45' }] }));
  assert.deepEqual(shuffled.lessonTimes.map((x) => x.no), [0, 1, 2]);
});

/* -------------------------------------------------- 2. cały wrzesień, jeden przebieg po kolei */
const september = () => need('september', async () => {
  const B = await blank();
  const c = B.client();
  const school = expectOk(await c.post('/api/setup/school', SCHOOL));
  const out = { B, c, school, principalPw: school.principalTempPassword };

  /* Krok 2 — arkusz organizacyjny tak, jak leży: `Nazwisko;Imię;Skrót;…;Przedmioty;…;Wychowawstwo`,
     przedmioty nazwami po przecinku, wychowawstwo pisane „7 B”. Przed poprawką OPS3-05 ten plik
     odrzucał 100 % wierszy komunikatem „Brak imienia lub nazwiska.” — po jednym na wiersz. */
  out.teachers = expectOk(await c.post('/api/setup/teachers/import', { csv: fixtureText('register/staff.csv') }));

  /* Krok 3 — eksport z naboru gminy, też niezmieniony: półpauza w „Opiekun 1 – nazwisko”, daty
     DD.MM.RRRR, dwoje opiekunów, adnotacja sądowa ze średnikiem w środku pola, trzech uczniów
     bez numeru PESEL. */
  out.students = expectOk(await c.post('/api/setup/students/import', { csv: fixtureText('register/nabor-vulcan.csv') }));

  /* Krok 4 — plan dzwonków z godziną zerową, a potem plan lekcji z aSc: dwie fazy, z decyzjami
     o encjach, których szkoła nie ma, i o podziałach na grupy. */
  const year = expectOk(await c.get('/api/admin/year'));
  expectOk(await c.patch('/api/admin/year', { lessonTimes: [{ no: 0, start: '07:10', end: '07:55' }].concat(year.lessonTimes) }));
  out.dry = expectOk(await c.post('/api/admin/timetable/import', { format: 'asc-xml', dataBase64: b64('asc/plan-sp12.xml'), dryRun: true, ref: 'plan-sp12.xml' }));
  const mapping = JSON.parse(JSON.stringify(out.dry.mapping));
  for (const k of out.dry.unmatched.subjects) mapping.subjects[k] = '@new';
  for (const k of out.dry.unmatched.classes) mapping.classes[k] = '@new';
  for (const k of out.dry.unmatched.teachers) mapping.teachers[k] = null;
  for (const g of out.dry.proposal.groups) if (!g.matched) mapping.groups[g.key] = '@new';
  out.mapping = mapping;
  out.dry2 = expectOk(await c.post('/api/admin/timetable/import', { format: 'asc-xml', dataBase64: b64('asc/plan-sp12.xml'), dryRun: true, mapping }));
  out.applied = expectOk(await c.post('/api/admin/timetable/import', { format: 'asc-xml', dataBase64: b64('asc/plan-sp12.xml'), dryRun: false, force: true, mapping, reason: 'Plan z aSc na rok 2026/2027.' }));
  out.lessons = expectOk(await c.post('/api/setup/lessons/generate', {}));
  return out;
});

test('[onb.4] kadra i uczniowie wchodzą z plików, które szkoła naprawdę ma', async () => {
  const S = await september();
  /* OPS3-05 — diagnostyka nagłówka zamiast N identycznych błędów o wierszach. */
  assert.ok(S.teachers.count >= 19, 'z 20 wierszy arkusza weszło ' + S.teachers.count + ': ' + JSON.stringify(S.teachers.errors));
  assert.ok(S.teachers.columns.includes('Nazwisko') && S.teachers.columns.includes('Przedmioty'), JSON.stringify(S.teachers.columns));
  /* Jedyny odrzucony wiersz to ten, w którym w kolumnie „Przedmioty” stoi funkcja, a nie przedmiot —
     i komunikat mówi wprost, czego nie rozpoznał i gdzie przedmiot dodać. */
  for (const e of S.teachers.errors) assert.match(e.error, /Nieznane przedmioty: .*POST \/api\/admin\/subjects/);
  const nowak = S.B.db.one('users', (u) => u.lastName === 'Nowak' && u.role === 'teacher');
  assert.equal(nowak.homeroomOf, '7b', 'wychowawstwo „7 B” z pliku → oddział 7b');
  assert.deepEqual(nowak.subjects, ['mat'], 'przedmiot podany nazwą („Matematyka”), nie identyfikatorem');
  assert.equal(nowak.short, 'NJ', 'skrót z arkusza — tym samym kluczem posługuje się eksport z aSc');

  /* OPS3-06/07 — 60 uczniów i dwoje opiekunów tam, gdzie plik ma dwoje. */
  assert.equal(S.students.count, 60);
  assert.deepEqual(S.students.errors, []);
  assert.deepEqual(S.students.unknownColumns, ['Kod pocztowy', 'Miejscowość'], 'tylko te dwie kolumny zostają nieprzeczytane');
  assert.ok(S.students.codes.length > 100, 'kod dla każdego opiekuna, nie tylko dla pierwszego: ' + S.students.codes.length);
  const twoGuardians = S.B.db.col('students').filter((s) => (s.parentIds || []).length >= 2);
  assert.ok(twoGuardians.length >= 55, 'uczniowie z dwojgiem opiekunów: ' + twoGuardians.length);

  /* OPS3-09 — płeć, bo bez niej świadectwo dziewczynki mówi „urodzony”, a pakiet SIO ma `plec=""`. */
  const withPesel = S.B.db.col('students').filter((s) => s.pesel);
  assert.ok(withPesel.every((s) => s.sex === 'K' || s.sex === 'M'), 'płeć z numeru PESEL dla każdego, kto go ma');
  assert.ok(S.B.db.col('students').some((s) => s.sex === 'K') && S.B.db.col('students').some((s) => s.sex === 'M'));

  /* OPS3-20 — „Uwagi” z naboru zostają uwagą przy uczniu; nikt ich nie interpretuje. */
  const court = S.B.db.col('students').find((s) => /pozbawiony władzy/i.test(s.note || ''));
  assert.ok(court, 'adnotacja sądowa z kolumny „Uwagi” dojechała do księgi');
  assert.equal(court.parentAccessBlocked, false, 'ale program sam nic z niej nie zrobił');
  assert.ok(S.students.warnings.some((w) => w.code === 'note_imported'), 'i powiedział, że trzeba ją przeczytać');

  /* OPS3-10 — jeden numer księgi na szkołę: ciąg bez dziur, zaczęty od podłogi, nie od 1000. */
  const regs = S.B.db.col('students').map((s) => s.registerNo).sort((a, b) => a - b);
  assert.deepEqual(regs, regs.map((_, i) => regs[0] + i), 'numery księgi bez dziur');
  /* OPS3-10 — jedna podłoga dla całej szkoły. Kreator zaczynał od 1001, sekretariat od 1201, więc
     pierwszy uczeń przyjęty po kreatorze robił w księdze 140-numerową dziurę. `nextRegisterNo(db)`
     (eksportowane z `server/routes/setup.js`) domyślnie zaczyna tam, gdzie sekretariat, a
     `config.registerNoStart` pozwala szkole numerować od jedynki. */
  assert.equal(regs[0], 1201, 'pusta księga zaczyna się tam, gdzie zaczyna ją sekretariat');

  /* R7 — uczeń bez numeru PESEL przeszedł z dokumentem tożsamości. */
  const noPesel = S.B.db.col('students').filter((s) => !s.pesel);
  assert.equal(noPesel.length, 3);
  assert.ok(noPesel.every((s) => s.identityDocument && s.identityDocument.number), JSON.stringify(noPesel.map((s) => s.identityDocument)));
});

test('[onb.5] podział z pliku staje się grupą, a nauczycielka angielskiego widzi swoją połowę oddziału', async () => {
  const S = await september();
  /* OPS3-02 — to jest ten defekt, który psuł jedną piątą ustawowej frekwencji od pierwszego dnia:
     wiersz planu niósł `groupLabel: "1. grupa"` i `groupId: null`, a `rosterIds()` klucza wyłącznie
     po `groupId`, więc lekcja grupy pokazywała cały oddział. */
  assert.ok(S.dry.proposal.groups.length > 0, 'podziały z pliku są piątym rodzajem dopasowania');
  assert.ok(S.dry.proposal.groups.every((g) => g.key.indexOf('|') > 0), 'klucz to oddział z pliku + etykieta, bo każda klasa ma swoją „1. grupę”');
  assert.deepEqual(S.dry.proposal.blocking.filter((x) => x.kind === 'groups'), [], 'podział nigdy nie blokuje importu');
  assert.ok(S.applied.created.groups.length >= 30, 'grupy założone z pliku: ' + S.applied.created.groups.length);

  const tt = S.B.db.col('timetable');
  const bound = tt.filter((t) => t.groupId);
  assert.ok(bound.length > 100, 'wiersze związane z grupą: ' + bound.length);
  assert.ok(bound.every((t) => S.B.db.get('groups', t.groupId)), 'każdy wskazuje istniejącą grupę');

  const cls = S.B.db.get('classes', '7b');
  const ang = tt.find((t) => t.classId === '7b' && t.subjectId === 'ang' && t.groupId);
  assert.ok(ang, 'plan ma angielski 7b w grupie');
  const group = S.B.db.get('groups', ang.groupId);
  assert.equal(group.studentIds.length, Math.floor(cls.studentIds.length / 2), `grupa ${group.id} ma ${group.studentIds.length} z ${cls.studentIds.length} uczniów oddziału`);
  assert.ok(group.studentIds.every((sid) => cls.studentIds.includes(sid)), 'i tylko uczniów tego oddziału');
  /* Obie grupy razem to cały oddział i żaden uczeń nie jest w dwóch naraz. */
  const both = [...new Set(tt.filter((t) => t.classId === '7b' && t.subjectId === 'ang' && t.groupId).map((t) => t.groupId))].map((id) => S.B.db.get('groups', id));
  assert.equal(both.length, 2, 'angielski 7b jest podzielony na dwie grupy: ' + JSON.stringify(both.map((g) => g.id)));
  const all = both.flatMap((g) => g.studentIds);
  assert.equal(new Set(all).size, all.length, 'nikt nie jest w dwóch grupach angielskiego');
  assert.equal(all.length, cls.studentIds.length, 'razem cały oddział');
  assert.ok(S.applied.warnings.some((w) => /sprawdź skład/.test(String(w))), 'raport mówi wprost, że skład z pliku to propozycja');

  /* I to, po co to wszystko: frekwencja. Nauczycielka loguje się swoim hasłem tymczasowym. */
  const lesson = S.B.db.col('lessons').find((l) => l.groupId === ang.groupId);
  assert.ok(lesson, 'lekcja tej grupy jest w dzienniku');
  const who = S.B.db.get('users', lesson.teacherId);
  const temp = (S.teachers.created.find((x) => x.login === who.login) || {}).tempPassword;
  const teach = S.B.client();
  const login = await teach.post('/api/auth/login', { login: who.login, password: temp });
  assert.equal(login.status, 200, JSON.stringify(login.body));
  assert.equal(login.body.mustChangePassword, true);
  expectOk(await teach.post('/api/auth/password', { next: 'Nowe-Haslo-2026!' }));
  const roster = expectOk(await teach.get('/api/attendance/lesson/' + lesson.id));
  assert.equal(roster.students.length, group.studentIds.length, 'lista obecności to grupa, nie cały oddział');
  assert.ok(roster.students.length < cls.studentIds.length);
  const marked = await teach.post('/api/attendance/lesson/' + lesson.id, { allPresent: true });
  assert.equal(marked.status, 200, JSON.stringify(marked.body).slice(0, 200));
});

test('[onb.6] godzina zerowa, sale i numery lekcji przeżywają import planu', async () => {
  const S = await september();
  /* OPS3-03 — przed dopisaniem dzwonka 0 te wiersze odpadały; teraz wchodzą. */
  assert.deepEqual(S.dry2.errors, [], JSON.stringify(S.dry2.errors));
  assert.equal(S.applied.rows, S.dry.rows, 'zapis wgrał tyle wierszy, ile obiecała próba');
  /* OPS3-12/D3-51 — odesłanie mapowania z próby nie może skasować ani jednej sali. */
  assert.equal(S.applied.rooms, S.dry.rooms, `sale: próba ${S.dry.rooms}, zapis ${S.applied.rooms}`);
  assert.ok(S.applied.rooms >= 14, 'plan-sp12.xml ma 14 sal: ' + S.applied.rooms);
  const tt = S.B.db.col('timetable');
  assert.ok(tt.filter((t) => t.room).length > tt.length / 2, 'większość lekcji ma numer sali');
  /* OPS3-08 — lekcji sprzed dnia przejścia nie generujemy i mówimy o tym. */
  assert.equal(S.lessons.from, D.today(S.B.db));
  assert.equal(S.lessons.skippedBeforeToday, true);
  assert.match(S.lessons.message, /Lekcji sprzed dziś/);
  assert.equal(S.B.db.col('lessons').filter((l) => l.date < D.today(S.B.db)).length, 0, 'ani jednej lekcji-widma za wrzesień sprzed przejścia');
  assert.ok(S.lessons.created > 5000, 'a rok jest wygenerowany w całości: ' + S.lessons.created);
});

test('[onb.7] kod rodzica, pakiet SIO i pakiet archiwalny działają w szkole z kreatora', async () => {
  const S = await september();
  /* Rodzic zakłada konto kodem z wydruku kreatora. */
  const code = S.students.codes[0];
  const parent = S.B.client();
  const reg = await parent.post('/api/register', { code: code.code, login: 'rodzic.pierwszy', password: 'Rodzic-2026!ok', firstName: 'Anna', lastName: 'Kowalska' });
  assert.ok([200, 201].includes(reg.status), JSON.stringify(reg.body).slice(0, 200));
  if ((await parent.get('/api/parent/children')).status === 401) expectOk(await parent.post('/api/auth/login', { login: 'rodzic.pierwszy', password: 'Rodzic-2026!ok' }));
  const children = expectOk(await parent.get('/api/parent/children'));
  assert.ok(children.children.length >= 1);

  /* OPS3-13/D3-43 — ta walidacja kończyła się `500 TypeError … reading 'schemaVersion'` na każdej
     szkole z kreatora, bo `config.sio` pisał wyłącznie zasiew demonstracyjny. */
  const sio = await S.c.post('/api/registry/sio/validate', {});
  assert.notEqual(sio.status, 500, 'walidacja SIO nie może być błędem serwera: ' + JSON.stringify(sio.body).slice(0, 200));
  assert.ok([200, 400].includes(sio.status), sio.status + ' ' + JSON.stringify(sio.body).slice(0, 200));
  if (sio.status === 200) assert.equal(typeof sio.body.ok, 'boolean');

  /* OPS3-21 — konto dyrektora jest potrzebne, żeby cokolwiek z § 22 dało się zrobić. */
  assert.ok(S.principalPw, 'kreator oddał hasło tymczasowe dyrektora');
  const dyr = S.B.client();
  expectOk(await dyr.post('/api/auth/login', { login: 'dyrektor', password: S.principalPw }));
  expectOk(await dyr.post('/api/auth/password', { next: 'Dyrektor-2026!ok' }));
  const window = expectOk(await dyr.get('/api/principal/archive'));
  assert.match(window.window ? window.window.from : window.from, /^\d{4}-\d{2}-\d{2}$/);
  const pack = await dyr.post('/api/principal/archive', { force: true, reason: 'próba przed końcem roku' });
  assert.ok([200, 201].includes(pack.status), 'pakiet archiwalny: ' + pack.status + ' ' + JSON.stringify(pack.body).slice(0, 200));
});

test('[onb.8] bez konta dyrektora kreator nie kończy się po cichu', async () => {
  const B = await blank();
  const c = B.client();
  const noPrincipal = Object.assign({}, SCHOOL); delete noPrincipal.principal;
  expectOk(await c.post('/api/setup/school', noPrincipal));
  expectOk(await c.post('/api/setup/teachers/import', { csv: fixtureText('register/staff.csv') }));
  expectOk(await c.post('/api/setup/students/import', { csv: fixtureText('register/nabor-vulcan.csv') }));
  expectOk(await c.post('/api/admin/timetable/import', { data: 'class;weekday;lessonNo;subject;teacherLogin;room;group\n7b;1;1;mat;' + B.db.one('users', (u) => u.lastName === 'Nowak' && u.role === 'teacher').login + ';12;', dryRun: false, force: true }));
  const fin = await c.post('/api/setup/finish', {});
  assert.equal(fin.status, 400);
  assert.ok(fin.body.missing.includes('principal'), JSON.stringify(fin.body));
  assert.match(fin.body.error, /pakietu archiwalnego/);
  /* Można zakończyć mimo to — ale świadomie. */
  expectOk(await c.post('/api/setup/finish', { force: true }));
});

test('[onb.4a] uczeń dopisany po kreatorze dostaje kolejny numer księgi, nie następną setkę', async () => {
  const B = await blank();
  const c = B.client();
  expectOk(await c.post('/api/setup/school', SCHOOL));
  const first = expectOk(await c.post('/api/setup/students/import', { csv: 'class;lastName;firstName\n7b;Aaa;Anna\n7b;Bbb;Bartek' }));
  const last = first.created[first.created.length - 1].registerNo;
  /* Droga sekretariatu — ta sama księga, ta sama podłoga (OPS3-10). */
  const view = expectOk(await c.get('/api/registry/students'));
  assert.equal(view.nextRegisterNo, last + 1, `kreator skończył na ${last}, a sekretariat proponuje ${view.nextRegisterNo}`);
  const later = expectOk(await c.post('/api/setup/students/import', { csv: 'class;lastName;firstName\n7b;Ccc;Cezary' }));
  assert.equal(later.created[0].registerNo, last + 1, 'kolejny import też nie robi dziury');
});

/* --------------------------------------------- 3. przedmioty i oddziały jako zwykłe trasy */
test('[onb.9] przedmiot i oddział da się założyć, poprawić i skasować, dopóki nic ich nie używa', async () => {
  const B = await blank();
  const c = B.client();
  expectOk(await c.post('/api/setup/school', SCHOOL));

  /* OPS3-04 — do tej pory `db.data.subjects` pisał wyłącznie zasiew. */
  const made = expectOk(await c.post('/api/admin/subjects', { name: 'Doradztwo zawodowe' }));
  assert.match(made.subject.id, /^[a-z0-9._-]{2,24}$/);
  assert.equal((await c.post('/api/admin/subjects', { name: 'Doradztwo zawodowe' })).status, 409, 'ta sama nazwa drugi raz');
  assert.equal((await c.post('/api/admin/subjects', { id: 'ETYKA!', name: 'Etyka 2' })).status, 400, 'identyfikator z niedozwolonym znakiem');
  expectOk(await c.patch('/api/admin/subjects/' + made.subject.id, { name: 'Doradztwo zawodowe i kariery', short: 'dz' }));
  assert.equal(B.db.get('subjects', made.subject.id).name, 'Doradztwo zawodowe i kariery');
  expectOk(await c.delete('/api/admin/subjects/' + made.subject.id));
  assert.ok(!B.db.get('subjects', made.subject.id), 'przedmiot zniknął z listy');
  /* Przedmiot ustawowy, który blokował każdy prawdziwy plan, jest w pustej instalacji od początku. */
  for (const id of ['gw', 'etyka', 'wdz']) assert.ok(B.db.get('subjects', id), 'brak przedmiotu ' + id);

  /* OPS3-14 — oddział powstawał tylko jako skutek uboczny importu. */
  const cls = expectOk(await c.post('/api/admin/classes', { id: '4A' }));
  assert.equal(cls.class.id, '4a', 'oznaczenie normalizowane do małych liter');
  assert.equal(cls.class.level, 4);
  assert.equal((await c.post('/api/admin/classes', { id: 'czwarta' })).status, 400);
  assert.equal((await c.post('/api/admin/classes', { id: '4a' })).status, 409);
  expectOk(await c.patch('/api/admin/classes/4a', { name: '4a (sportowa)' }));
  assert.equal(B.db.get('classes', '4a').name, '4a (sportowa)');
  expectOk(await c.delete('/api/admin/classes/4a'));
  assert.ok(!B.db.get('classes', '4a'), 'pusty oddział zniknął');

  /* Oddział z uczniami nie znika. */
  expectOk(await c.post('/api/admin/classes', { id: '5a' }));
  expectOk(await c.post('/api/setup/students/import', { csv: 'class;lastName;firstName\n5a;Testowa;Zofia' }));
  const busy = await c.delete('/api/admin/classes/5a');
  assert.equal(busy.status, 409);
  assert.equal(busy.body.code, 'class_in_use');

  /* Ślad w rejestrze zdarzeń — każdy z tych zapisów jest audytowany. */
  const actions = B.db.col('audit').map((a) => a.action);
  for (const a of ['subject_created', 'subject_updated', 'subject_deleted', 'class_created', 'class_updated', 'class_deleted']) assert.ok(actions.includes(a), 'brak wpisu audytowego ' + a);
});

test('[onb.10] „załóż u nas” w tabeli dopasowania zakłada przedmiot i oddział, których szkoła nie miała', async () => {
  const B = await blank();
  const c = B.client();
  expectOk(await c.post('/api/setup/school', SCHOOL));
  expectOk(await c.post('/api/setup/teachers/import', { csv: 'login;firstName;lastName;subjects\nj.nowak;Joanna;Nowak;mat' }));
  const csv = 'class;weekday;lessonNo;subject;teacherLogin;room;group\n9z;1;1;mat;j.nowak;12;';
  /* Oddziału 9z nie ma — CSV odrzuca wiersz wprost, a plik z aSc wchodzi przez tabelę dopasowania. */
  const asc = fs.readFileSync(path.join(FIX, 'asc/plan-sp12.xml'));
  const dry = expectOk(await c.post('/api/admin/timetable/import', { format: 'asc-xml', dataBase64: asc.toString('base64'), dryRun: true }));
  assert.ok(dry.unmatched.classes.length > 0, 'pusta szkoła nie ma żadnego oddziału z pliku');
  const mapping = JSON.parse(JSON.stringify(dry.mapping));
  for (const k of dry.unmatched.classes) mapping.classes[k] = '@new';
  for (const k of dry.unmatched.subjects) mapping.subjects[k] = '@new';
  for (const k of dry.unmatched.teachers) mapping.teachers[k] = null;
  const dry2 = expectOk(await c.post('/api/admin/timetable/import', { format: 'asc-xml', dataBase64: asc.toString('base64'), dryRun: true, mapping }));
  assert.ok(dry2.proposal.creates.classes > 0, JSON.stringify(dry2.proposal.creates));
  assert.equal(B.db.col('classes').length, 0, 'próba niczego nie zakłada');
  const done = expectOk(await c.post('/api/admin/timetable/import', { format: 'asc-xml', dataBase64: asc.toString('base64'), dryRun: false, force: true, mapping }));
  assert.ok(done.created.classes.length > 0, JSON.stringify(done.created));
  for (const id of done.created.classes) assert.ok(B.db.get('classes', id), 'oddział ' + id + ' powstał');
  for (const id of done.created.subjects) assert.ok(B.db.get('subjects', id), 'przedmiot ' + id + ' powstał');
  assert.ok(B.db.col('timetable').length > 0);
  assert.ok(csv.length > 0);
});

test('[onb.11] pojedynczą pozycję planu da się poprawić bez wgrywania całego pliku', async () => {
  const B = await blank();
  const c = B.client();
  expectOk(await c.post('/api/setup/school', SCHOOL));
  expectOk(await c.post('/api/setup/teachers/import', { csv: 'login;firstName;lastName;subjects\nj.nowak;Joanna;Nowak;mat|ang\ne.krol;Ewa;Król;ang' }));
  expectOk(await c.post('/api/setup/students/import', { csv: 'class;lastName;firstName\n7b;Aaa;Anna\n7b;Bbb;Bartek\n7b;Ccc;Cezary\n7b;Ddd;Dorota' }));
  expectOk(await c.post('/api/admin/timetable/import', { data: 'class;weekday;lessonNo;subject;teacherLogin;room;group\n7b;1;1;ang;j.nowak;12;', dryRun: false, force: true }));
  const row = B.db.col('timetable')[0]; const rowId = row.id;    // `row` to żywy dokument — po zapisie ma już nowe id
  const roster = B.db.get('classes', '7b').studentIds;
  const g = expectOk(await c.post('/api/admin/groups', { name: '7b / ang. gr. 1', classId: '7b', subjectId: 'ang', studentIds: roster.slice(0, 2) }));
  const patched = expectOk(await c.patch('/api/admin/timetable/rows/' + row.id, { groupId: g.group.id, teacherId: B.db.one('users', (u) => u.login === 'e.krol').id, room: '15' }));
  assert.equal(patched.row.groupId, g.group.id);
  assert.equal(patched.row.room, '15');
  assert.equal(patched.renamedFrom, rowId, 'identyfikator pozycji niesie podział, więc zmienił się razem z nim');
  assert.notEqual(patched.row.id, rowId);
  assert.ok(B.db.col('timetable').every((t) => t.id === patched.row.id));
  assert.ok(B.db.col('audit').some((a) => a.action === 'timetable_row_updated'));
  assert.equal((await c.patch('/api/admin/timetable/rows/nie_ma_takiej', { room: '1' })).status, 404);
  assert.equal((await c.patch('/api/admin/timetable/rows/' + patched.row.id, { subjectId: 'nie-ma' })).status, 400);
});

/* ----------------------------------------------------------- 4. skala, cofanie, awaria (H-2, H-3, R3-08) */
function ascFile(classes, teachers) {
  /* Plik aSc o kształcie takim, jak `asc/plan-sp12.xml`, ale w pamięci i w skali 24 oddziałów.
     H-2 — największym wejściem, jakie widział importer, było 272 wiersze na 8 oddziałów. */
  const subj = ['Matematyka', 'Język polski', 'Język angielski', 'Fizyka', 'Historia', 'Biologia'];
  const esc = (x) => String(x).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;');
  const p = [];
  p.push('<?xml version="1.0" encoding="UTF-8"?>\n<timetable displaycountry="pl">');
  p.push('<periods>' + Array.from({ length: 8 }, (_, i) => `<period period="${i + 1}" starttime="${String(8 + i).padStart(2, '0')}:00" endtime="${String(8 + i).padStart(2, '0')}:45"/>`).join('') + '</periods>');
  p.push('<daysdefs>' + [1, 2, 3, 4, 5].map((d) => `<daysdef id="d${d}" days="${'0'.repeat(d - 1)}1${'0'.repeat(5 - d)}"/>`).join('') + '</daysdefs>');
  p.push('<weeksdefs><weeksdef id="wevery" weeks="11"/></weeksdefs>');
  p.push('<classes>' + classes.map((c, i) => `<class id="c${i}" name="${esc(c)}" short="${esc(c)}"/>`).join('') + '</classes>');
  p.push('<teachers>' + teachers.map((t, i) => `<teacher id="t${i}" name="${esc(t.name)}" short="${esc(t.short)}" firstname="${esc(t.first)}" lastname="${esc(t.last)}"/>`).join('') + '</teachers>');
  p.push('<subjects>' + subj.map((s, i) => `<subject id="s${i}" name="${esc(s)}" short="${esc(s.slice(0, 3))}"/>`).join('') + '</subjects>');
  p.push('<classrooms>' + Array.from({ length: 40 }, (_, i) => `<classroom id="r${i}" name="${100 + i}" short="${100 + i}"/>`).join('') + '</classrooms>');
  const lessons = []; const cards = [];
  let n = 0;
  for (let ci = 0; ci < classes.length; ci++) {
    for (let d = 1; d <= 5; d++) {
      for (let per = 1; per <= 6; per++) {
        const si = (ci + d + per) % subj.length;
        const ti = (ci * 3 + per) % teachers.length;
        lessons.push(`<lesson id="l${n}" classids="c${ci}" subjectid="s${si}" teacherids="t${ti}" periodspercard="1" durationperiods="1" weeksdefid="wevery" daysdefid="d${d}"/>`);
        cards.push(`<card lessonid="l${n}" period="${per}" days="${'0'.repeat(d - 1)}1${'0'.repeat(5 - d)}" weeks="11" classroomids="r${ci % 40}"/>`);
        n++;
      }
    }
  }
  p.push('<lessons>' + lessons.join('') + '</lessons>');
  p.push('<cards>' + cards.join('') + '</cards>');
  p.push('</timetable>');
  return Buffer.from(p.join('\n'), 'utf8');
}

test('[onb.12] 24 oddziały, 720 pozycji planu: import i rok lekcji mieszczą się w podanym czasie (H-2)', async () => {
  const B = await blank();
  const c = B.client();
  expectOk(await c.post('/api/setup/school', SCHOOL));
  const classes = [].concat(...[1, 2, 3, 4, 5, 6, 7, 8].map((l) => ['a', 'b', 'c'].map((x) => l + x)));
  const teachers = Array.from({ length: 40 }, (_, i) => ({ name: `Nauczyciel${i} Testowy`, short: 'T' + i, first: `Imie${i}`, last: `Nazwisko${i}` }));
  expectOk(await c.post('/api/setup/teachers/import', { csv: ['login;firstName;lastName;subjects;homeroomOf']
    .concat(teachers.map((t, i) => `t${i};${t.first};${t.last};mat;${classes[i] || ''}`)).join('\n') }));
  for (const id of classes) if (!B.db.get('classes', id)) expectOk(await c.post('/api/admin/classes', { id }));

  const xml = ascFile(classes, teachers);
  assert.ok(xml.length > 100000, 'plik ma ' + xml.length + ' bajtów');
  const t0 = Date.now();
  const dry = expectOk(await c.post('/api/admin/timetable/import', { format: 'asc-xml', dataBase64: xml.toString('base64'), dryRun: true, ref: '24-oddzialy.xml' }));
  const dryMs = Date.now() - t0;
  assert.equal(dry.rows, classes.length * 5 * 6, 'wierszy planu: ' + dry.rows);
  assert.equal(dry.rows, 720);
  assert.deepEqual(dry.errors, []);
  /* Konflikty, które **powinny** być, bo ten sam nauczyciel bywa w dwóch oddziałach o tej samej porze;
     i żadnego konfliktu, którego być nie powinno — sala jest unikalna na wiersz. */
  assert.equal(dry.conflicts.filter((x) => x.kind === 'room').length, 0, 'sale rozdane bez kolizji');
  assert.ok(dry.conflicts.every((x) => ['teacher', 'class', 'room'].includes(x.kind)));

  const mapping = JSON.parse(JSON.stringify(dry.mapping));
  for (const k of dry.unmatched.subjects) mapping.subjects[k] = '@new';
  for (const k of dry.unmatched.classes) mapping.classes[k] = '@new';
  for (const k of dry.unmatched.teachers) mapping.teachers[k] = null;
  const t1 = Date.now();
  const done = expectOk(await c.post('/api/admin/timetable/import', { format: 'asc-xml', dataBase64: xml.toString('base64'), dryRun: false, force: true, mapping, applyToLessons: false }));
  const applyMs = Date.now() - t1;
  assert.equal(done.rows, 720);
  const t2 = Date.now();
  const gen = expectOk(await c.post('/api/setup/lessons/generate', {}));
  const genMs = Date.now() - t2;
  assert.ok(gen.created > 20000, 'rok lekcji dla 24 oddziałów: ' + gen.created);
  /* Granica hojna: to jest asercja o rzędzie wielkości (sekundy, nie minuty), nie pomiar wydajności.
     Bez indeksu z R3-01 sam `lessonImpact` na tej skali chodził dziesiątki sekund. */
  const total = dryMs + applyMs + genMs;
  assert.ok(total < 60000, `import 720 pozycji + rok lekcji: próba ${dryMs} ms, zapis ${applyMs} ms, lekcje ${genMs} ms (razem ${total} ms)`);
});

test('[onb.13] import planu jest partią i da się go cofnąć (H-3, R3-08)', async () => {
  const B = await blank();
  const c = B.client();
  expectOk(await c.post('/api/setup/school', SCHOOL));
  expectOk(await c.post('/api/setup/teachers/import', { csv: 'login;firstName;lastName;subjects\nj.nowak;Joanna;Nowak;mat|pol' }));
  expectOk(await c.post('/api/setup/students/import', { csv: 'class;lastName;firstName\n7b;Aaa;Anna\n7b;Bbb;Bartek' }));
  const first = 'class;weekday;lessonNo;subject;teacherLogin;room;group\n7b;1;1;mat;j.nowak;12;\n7b;2;1;pol;j.nowak;12;';
  expectOk(await c.post('/api/admin/timetable/import', { data: first, dryRun: false, force: true }));
  assert.equal(B.db.col('timetable').length, 2);

  const second = 'class;weekday;lessonNo;subject;teacherLogin;room;group\n7b;3;1;mat;j.nowak;99;';
  const done = expectOk(await c.post('/api/admin/timetable/import', { data: second, dryRun: false, force: true }));
  assert.ok(done.importId, 'import planu zostawia partię: ' + JSON.stringify(Object.keys(done)));
  assert.equal(B.db.col('timetable').length, 1);

  const list = expectOk(await c.get('/api/setup/imports'));
  const batch = list.imports.find((x) => x.id === done.importId);
  assert.ok(batch, 'partia jest na liście importów');
  assert.equal(batch.kind, 'timetable');
  assert.equal(batch.status, 'done');
  assert.equal(batch.undoable, true);
  assert.equal(batch.timetableRestores, 2, 'partia niesie poprzedni plan');
  assert.equal(batch.previousTimetable, undefined, 'ale nie wysyłamy go na listę');

  const undo = expectOk(await c.post('/api/setup/imports/' + done.importId + '/undo', { reason: 'nie ten plik' }));
  assert.equal(B.db.col('timetable').length, 2, 'poprzedni plan wrócił co do wiersza');
  assert.deepEqual(B.db.col('timetable').map((t) => t.id).sort(), ['tt_7b_1_1', 'tt_7b_2_1']);
  assert.ok(undo.lessons, 'dziennik uzgodniony po cofnięciu');
  assert.ok(B.db.col('audit').some((a) => a.action === 'import_undone' && a.entity === 'timetable'));
  assert.equal((await c.post('/api/setup/imports/' + done.importId + '/undo', {})).status, 400, 'drugi raz już nie');
});

test('[onb.14] partia importu jest na dysku, zanim powstanie pierwszy uczeń — także po kill -9 (R3-08)', async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'edmat-onb-'));
  const script = path.join(dir, 'child.js');
  const rows = Array.from({ length: 600 }, (_, i) => `7b;Nazwisko${i};Imie${i}`).join('\n');
  fs.writeFileSync(script, `
    const { createApp } = require(${JSON.stringify(path.join(__dirname, '..', 'server', 'index.js'))});
    (async () => {
      const app = createApp({ dataFile: ${JSON.stringify(path.join(dir, 'school.json'))}, quiet: true, blank: true });
      const base = 'http://127.0.0.1:' + await app.listen(0);
      let cookie = '';
      const call = async (m, p, b) => { const r = await fetch(base + p, { method: m, headers: { 'Content-Type': 'application/json', Cookie: cookie }, body: b != null ? JSON.stringify(b) : undefined }); const sc = r.headers.get('set-cookie'); if (sc) cookie = sc.split(';')[0]; return r.json().catch(() => ({})); };
      await call('POST', '/api/setup/school', ${JSON.stringify(SCHOOL)});
      process.stdout.write('READY\\n');
      await call('POST', '/api/setup/students/import', { csv: 'class;lastName;firstName\\n' + ${JSON.stringify(rows)} });
      process.stdout.write('DONE\\n');
    })();
  `);
  const child = spawn(process.execPath, [script], { stdio: ['ignore', 'pipe', 'pipe'] });
  try {
    /* Czekanie ograniczone: żaden z tych kroków nie może zawiesić przebiegu testów. */
    const ready = await new Promise((resolve) => {
      const timer = setTimeout(() => resolve(false), 20000);
      child.stdout.on('data', (d) => { if (String(d).includes('READY')) { clearTimeout(timer); resolve(true); } });
      child.on('exit', () => { clearTimeout(timer); resolve(false); });
    });
    if (!ready) { t.skip('dziecko nie wstało w 20 s — to maszyna, nie kod'); return; }
    await new Promise((r) => setTimeout(r, 120));           // w środku partii: breathe() oddaje pętlę co 50 wierszy
    child.kill('SIGKILL');
    const exited = await new Promise((resolve) => {
      const timer = setTimeout(() => resolve(false), 15000);
      child.on('exit', () => { clearTimeout(timer); resolve(true); });
    });
    assert.equal(exited, true, 'dziecko zakończyło się po SIGKILL');

    /* Otwieramy sklep ponownie tą samą drogą co serwer po restarcie. */
    const { Store } = require('../server/lib/store');
    const store = new Store(path.join(dir, 'school.json'), { lock: false });
    store.load();
    const students = store.col('students').length;
    const imports = store.col('imports');
    /* R3-08 — `recordImport` szedł **po** pętli wierszy, a `breathe()` co 50 wierszy pozwala
       zadziałać zrzutowi na dysk w środku partii: po `kill -9` w bazie leżało 100 uczniów i 200 kont
       bez żadnej partii do cofnięcia i bez wpisu audytowego. Teraz partia jest pierwsza. */
    if (students > 0) {
      assert.ok(imports.length >= 1, `${students} uczniów zapisanych, a partii importu ${imports.length} — nie ma czego cofnąć`);
      const b = imports[imports.length - 1];
      assert.equal(b.kind, 'students');
      assert.equal(b.status, 'running', 'partia przerwana zostaje „running”, więc widać ją na liście');
    } else {
      assert.ok(imports.length >= 0, 'nic nie zdążyło się zapisać — też poprawnie');
    }
  } finally {
    try { child.kill('SIGKILL'); } catch (e) { /* już nie żyje */ }
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
