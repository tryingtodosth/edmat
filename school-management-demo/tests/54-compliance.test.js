'use strict';
/*
 * Pakiet zgodności (R4) — trzy dokumenty generowane z działającej instancji:
 * ocena skutków (DPIA), deklaracja dostępności, szkielet umowy powierzenia.
 *
 * Testy pilnują tego, co odróżnia generowanie od pisania prozy: w dokumencie mają być prawdziwe
 * nazwy kolekcji z prawdziwymi licznikami wierszy, prawdziwa odpowiedź bramy odczytu karty ucznia
 * i prawdziwy wynik skanu śledzenia — a nie zdania, które ktoś kiedyś wpisał i które przestały być
 * prawdziwe. Nazwy testów celowo nie niosą identyfikatora historyjki: pakiet nie dokłada historyjek
 * do listy kontrolnej.
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { startServer, expectOk, fixtures, withConfig, loadClient } = require('./helpers');

let S, IOD;
test.before(async () => { S = await startServer(); IOD = await S.as('iod'); });
test.after(() => S.close());

const need = fixtures();
const KINDS = ['dpia', 'accessibility', 'dpa'];
const LOCALES = ['pl', 'en'];

/** Wszystkie sześć par (dokument × język) w obu postaciach, zbudowane raz na cały plik. */
const documents = () => need('documents', async () => {
  const out = {};
  for (const kind of KINDS) {
    for (const locale of LOCALES) {
      const md = await IOD.get(`/api/compliance/${kind}?locale=${locale}`);
      const html = await IOD.get(`/api/compliance/${kind}?locale=${locale}&format=html`);
      expectOk(md, `${kind}/${locale} markdown`); expectOk(html, `${kind}/${locale} html`);
      out[kind + ':' + locale] = { md, html };
    }
  }
  return out;
});

test('[r4.1] każdy z trzech dokumentów renderuje się w obu językach, jako Markdown i jako wydruk', async () => {
  const docs = await documents();
  for (const kind of KINDS) {
    for (const locale of LOCALES) {
      const { md, html } = docs[kind + ':' + locale];
      assert.match(md.headers.get('content-type'), /text\/markdown/, `${kind}/${locale}: Markdown ma swój typ MIME`);
      assert.match(html.headers.get('content-type'), /text\/html/, `${kind}/${locale}: wydruk ma typ HTML`);
      assert.ok(md.body.length > 2000, `${kind}/${locale}: dokument nie może być pustym szkicem (${md.body.length} B)`);
      assert.match(md.body, /^# .+/m, `${kind}/${locale}: dokument ma nagłówek pierwszego poziomu`);
      assert.ok(md.body.split('\n## ').length > 4, `${kind}/${locale}: dokument ma sekcje`);
      /* Wydruk czyta też czytnik ekranu: każda tabela z podpisem, każdy nagłówek z zakresem (3.9.1). */
      assert.match(html.body, /^<!doctype html>/, `${kind}/${locale}: dokument do druku`);
      assert.equal((html.body.match(/<h1[ >]/g) || []).length, 1, `${kind}/${locale}: dokładnie jeden nagłówek h1`);
      const tables = html.body.match(/<table[\s\S]*?<\/table>/g) || [];
      assert.ok(tables.length >= 1, `${kind}/${locale}: wydruk zawiera tabelę`);
      for (const tb of tables) {
        assert.match(tb, /<caption>/, `${kind}/${locale}: tabela bez <caption>`);
        for (const th of tb.match(/<th(?=[\s>])[^>]*>/g) || []) assert.match(th, /scope="(col|row)"/, `${kind}/${locale}: nagłówek bez scope — ${th}`);
      }
    }
  }
});

test('[r4.2] w żadnym dokumencie nie ma „undefined”, „NaN” ani „[object Object]”', async () => {
  const docs = await documents();
  for (const key of Object.keys(docs)) {
    for (const [what, body] of [['markdown', docs[key].md.body], ['html', docs[key].html.body]]) {
      for (const needle of ['undefined', 'NaN', '[object Object]']) {
        assert.ok(!String(body).includes(needle), `${key} (${what}): w dokumencie została dziura „${needle}”`);
      }
    }
  }
});

test('[r4.3] dokumenty niosą prawdziwe nazwy zbiorów i prawdziwe liczby wierszy', async () => {
  const docs = await documents();
  const dpia = docs['dpia:pl'].md.body;
  /* Spis zbiorów pochodzi z magazynu, a nie z listy w kodzie: sprawdzamy wiersz po wierszu. */
  const collections = Object.keys(S.db.data).filter((k) => Array.isArray(S.db.data[k]));
  assert.ok(collections.length > 40, 'instancja ma z czego zbudować spis (' + collections.length + ' kolekcji)');
  for (const name of collections) {
    assert.ok(dpia.includes('| ' + name + ' | '), 'DPIA pomija zbiór ' + name);
  }
  for (const name of ['attendance', 'grades', 'students', 'users', 'audit']) {
    const rows = S.db.col(name).length;
    assert.ok(dpia.includes('| ' + name + ' | ' + rows + ' |'), `DPIA podaje inną liczbę wierszy dla ${name} niż magazyn (${rows})`);
  }
  assert.ok(dpia.includes(S.db.data.config.school.name), 'DPIA nosi nazwę tej szkoły');
  /* Umowa powierzenia opisuje rodzaje danych tym samym spisem. */
  const dpa = docs['dpa:pl'].md.body;
  for (const name of ['attendance', 'grades', 'nurseVisits']) assert.ok(dpa.includes(name), 'umowa powierzenia pomija zbiór ' + name);
});

test('[r4.4] DPIA oznacza zbiory z danymi art. 9 i pokazuje macierz „rola → dane” z prawdziwej bramy', async () => {
  const docs = await documents();
  const pl = docs['dpia:pl'].md.body; const en = docs['dpia:en'].md.body;
  assert.match(pl, /art\. 9/, 'DPIA mówi o danych szczególnych kategorii');
  assert.match(en, /art\. 9/, 'wersja angielska też');
  const facts = expectOk(await IOD.get('/api/compliance/facts'));
  const art9 = facts.art9.map((i) => i.collection);
  assert.ok(art9.length >= 5, 'instancja ma zbiory art. 9 (' + art9.join(', ') + ')');
  for (const name of ['supportDocuments', 'incidents', 'nurseVisits', 'confidentialNotes', 'ipet']) {
    assert.ok(art9.includes(name), name + ' musi być oznaczony jako dane art. 9');
  }
  /* Sekcja 3 to lista zbiorów art. 9 — każdy z nich musi w niej wystąpić. */
  const section = pl.slice(pl.indexOf('## 3.'), pl.indexOf('## 4.'));
  for (const name of art9) assert.ok(section.includes(name), 'sekcja art. 9 pomija ' + name);
  for (const name of ['attendance', 'lessons']) assert.ok(!section.includes('| ' + name + ' |'), name + ' nie jest zbiorem art. 9');

  /* Macierz ról: odpowiedź bramy, nie opowieść o niej. IOD i stołówka nie czytają ocen; */
  const matrix = pl.slice(pl.indexOf('## 4.'), pl.indexOf('## 5.'));
  for (const role of ['dpo', 'cafeteria', 'librarian', 'nurse', 'careEducator', 'registrar', 'admin']) {
    const row = matrix.split('\n').find((x) => x.startsWith('| ' + role + ' |') && x.includes('record_scope'));
    assert.ok(row, 'macierz nie pokazuje odmowy „record_scope” dla roli ' + role);
  }
  assert.ok(matrix.includes('not_teaching_pupil'), 'macierz pokazuje odmowę dla ucznia, którego nauczyciel nie uczy');
  assert.ok(matrix.includes('guardian_scope'), 'macierz pokazuje odmowę dla cudzego dziecka');
  /* Liczba punktów API pochodzi z rejestru tras uruchomionej aplikacji. */
  const dpoRow = facts.roles.find((r) => r.role === 'dpo');
  assert.ok(dpoRow && dpoRow.endpoints > 0, 'zasięg roli IOD policzony z rejestru tras');
  assert.ok(matrix.includes('| dpo | konto tej roli istnieje | ' + dpoRow.endpoints + ' |'), 'macierz podaje tę samą liczbę punktów API co rejestr tras');
  /* S3-01 — macierz opisuje regułę, więc nie nosi loginu żadnego prawdziwego konta. */
  assert.equal(dpoRow.sampleLogin, undefined, 'wiersz macierzy nie niesie loginu konta');
  assert.equal(dpoRow.hasAccount, true, 'niesie natomiast sam fakt, że szkoła ma konto tej roli');
  for (const r of facts.roles) assert.equal(r.sampleLogin, undefined, 'fakty nie niosą loginu dla roli ' + r.role);
  /* Ta macierz jechała publiczną trasą deklaracji przy `facts=1` — gotowa lista kont szkoły. */
  /* `admin` jest w tym seedzie i loginem, i nazwą roli — nazwa roli w macierzy to nie wyciek. */
  const roleNames = facts.roles.map((r) => r.role);
  const logins = S.db.col('users').map((u) => u.login).filter((l) => l && !roleNames.includes(l));
  assert.ok(logins.includes('iod'), 'sanity: login IOD jest na liście, bo nie jest nazwą roli');
  for (const kind of KINDS) {
    for (const locale of LOCALES) {
      const body = docs[kind + ':' + locale].md.body;
      const tables = body.split('\n').filter((x) => x.startsWith('| '));
      for (const l of logins) {
        const cell = tables.find((x) => x.split('|').some((c) => c.trim() === l));
        assert.equal(cell, undefined, kind + '/' + locale + ': tabela dokumentu niesie login konta „' + l + '”');
      }
    }
  }
});

test('[r4.5] DPIA niesie retencję, fakty kryptograficzne, transport i wynik skanu śledzenia', async () => {
  const docs = await documents();
  const pl = docs['dpia:pl'].md.body;
  const cfg = S.db.data.config;
  assert.ok(pl.includes('logRetentionYears'), 'DPIA wymienia politykę retencji rejestru zdarzeń');
  assert.ok(pl.includes(String(cfg.gradesArchiveRetentionYears != null ? cfg.gradesArchiveRetentionYears : 50)), 'DPIA podaje okres przechowywania arkuszy ocen z konfiguracji');
  assert.ok(pl.includes('scrypt'), 'DPIA podaje algorytm skrótu hasła odczytany z lib/crypto');
  assert.ok(pl.includes('AES-256-GCM+RSA-OAEP'), 'DPIA podaje kopertę notatek poufnych');
  assert.ok(pl.includes('RSA-SHA256'), 'DPIA podaje pieczęć pakietu archiwalnego');
  assert.ok(pl.includes(String(cfg.sessionTimeoutMin)), 'DPIA podaje czas wygaśnięcia sesji z konfiguracji');
  assert.ok(/default-src/.test(pl), 'DPIA cytuje politykę bezpieczeństwa treści z serwera');
  /* Bez włączonego push i bez wskazanego serwera wideo podprocesorów nie ma — i tak ma być napisane. */
  const facts = expectOk(await IOD.get('/api/compliance/facts'));
  assert.equal(facts.subProcessors.length, 0, 'seed demonstracyjny nie ma skonfigurowanych podprocesorów');
  assert.equal(facts.transports.push.enabled, false, 'push jest wyłączony, dopóki szkoła go nie włączy');
  assert.equal(facts.transports.video.configured, false, 'domena wideo w seedzie jest przykładowa, więc nie liczy się jako skonfigurowana');
  const sub = pl.slice(pl.indexOf('## 5.'), pl.indexOf('## 6.'));
  assert.ok(/brak/.test(sub), 'sekcja podprocesorów mówi wprost, że ich nie ma');
  assert.ok(facts.trackers.ok === true, 'skan śledzenia przeszedł');
  assert.ok(pl.includes(facts.trackers.verdict), 'DPIA cytuje werdykt skanu śledzenia');
});

test('[r4.6] deklaracja dostępności ma strukturę ustawową i wymienia kryteria, których nie zbadano', async () => {
  const docs = await documents();
  const pl = docs['accessibility:pl'].md.body;
  const en = docs['accessibility:en'].md.body;
  for (const needle of ['4 kwietnia 2019', 'WCAG 2.1', 'częściowo zgodna', '7 dni', '2 miesiące', 'Rzecznika Praw Obywatelskich', 'PFRON', 'samoocena']) {
    assert.ok(pl.includes(needle), 'deklaracja nie zawiera elementu ustawowego: ' + needle);
  }
  for (const needle of ['4 April 2019', 'WCAG 2.1', '7 days', '2 months', 'Commissioner for Human Rights']) {
    assert.ok(en.includes(needle), 'wersja angielska nie zawiera: ' + needle);
  }
  assert.ok(pl.includes(S.db.data.config.school.name), 'deklaracja nosi nazwę szkoły z konfiguracji');
  assert.ok(pl.includes(S.db.data.config.school.address), 'deklaracja nosi adres szkoły z konfiguracji');

  const facts = expectOk(await IOD.get('/api/compliance/facts'));
  assert.ok(facts.a11y.tested.length >= 5, 'co najmniej pięć obszarów ma dowód w tests/39-nonfunctional.test.js');
  assert.equal(facts.a11y.missingEvidence.length, 0, 'każdy deklarowany dowód istnieje w pliku testów');
  for (const t of facts.a11y.tested) assert.ok(pl.includes(t.id), 'deklaracja nie powołuje się na test ' + t.id);
  assert.ok(pl.includes('39-nonfunctional.test.js'), 'deklaracja wskazuje plik dowodowy');
  /* Sedno: to, czego NIE zbadano, musi być wypisane, a nie przemilczane. */
  assert.ok(facts.a11y.untested.length >= 6, 'lista kryteriów bez dowodu nie może być pusta');
  const untested = pl.slice(pl.indexOf('## 4.'), pl.indexOf('## 5.'));
  for (const u of facts.a11y.untested) {
    assert.ok(untested.includes(u.what.pl), 'deklaracja nie wymienia niezbadanego kryterium: ' + u.what.pl);
  }
  for (const wcag of ['1.4.3', '2.1.4', '3.3.1', '4.1.3']) assert.ok(untested.includes(wcag), 'brak kryterium ' + wcag + ' na liście niezbadanych');
  assert.ok(/czytnik|czytnika ekranu/i.test(untested), 'deklaracja przyznaje brak badania z czytnikiem ekranu');
  assert.ok(/audyt/i.test(untested), 'deklaracja przyznaje brak audytu zewnętrznego');

  /* H-4 — „zbadane” musi znaczyć „test przeszedł w prawdziwym przebiegu”, a nie „w pliku testów
     jest taki napis”. Źródłem jest odhaczony kwadrat w liście akceptacyjnej, którą
     `scripts/checklist-status.js` odhacza wyłącznie z zielonego przebiegu (ok, bez SKIP/TODO,
     plik bez błędu). Test cofa jeden odhaczony kwadrat na kopii listy i sprawdza, że kryterium
     schodzi z „zbadanych” na „bez dowodu” — czego grep po źródle nigdy by nie zauważył. */
  const CP = require('../server/lib/compliance');
  const fs = require('node:fs'); const os = require('node:os'); const path = require('node:path');
  assert.equal(CP.a11y().evidenceRun, 'checklist.md', 'deklaracja czyta wynik zapisanego przebiegu');
  assert.ok(CP.a11y().tested.some((t) => t.id === '3.9.2'), 'sanity: [3.9.2] jest dziś odhaczone');
  /* Beside the demo, not above it: the checklist moved inside when the prototype came into the
     edmat repo as school-management-demo/ (2026-09-24). server/lib/compliance.js ROOT does the same. */
  const real = path.join(__dirname, '..', 'checklist.md');
  const copy = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'edmat-cl-')), 'checklist.md');
  const src = fs.readFileSync(real, 'utf8');
  const lines = src.split('\n');
  /* Druga historyjka sekcji 3.9 to [3.9.2] — ta sama arytmetyka, której używa checklist-status.js. */
  let sec = null, n = 0, hit = -1;
  for (let i = 0; i < lines.length; i++) {
    const hm = /^##\s+(3\.\d+)\b/.exec(lines[i]); if (hm) { sec = hm[1]; n = 0; continue; }
    if (!/^- \[( |x|X)\]\s/.test(lines[i]) || !sec) continue;
    n++; if (sec === '3.9' && n === 2) { hit = i; break; }
  }
  assert.ok(hit >= 0, 'nie znaleziono historyjki [3.9.2] w liście akceptacyjnej');
  lines[hit] = lines[hit].replace(/^- \[[xX]\]/, '- [ ]');
  fs.writeFileSync(copy, lines.join('\n'), 'utf8');
  const degraded = CP.a11y({ checklistFile: copy });
  assert.ok(!degraded.tested.some((t) => t.id === '3.9.2'), 'test bez zielonego przebiegu nie może liczyć się jako dowód');
  assert.ok(degraded.notGreen.some((t) => t.id === '3.9.2' && t.reason === 'not-green'), 'i musi być wymieniony z powodem');
  assert.ok(degraded.untested.some((u) => /ostatni zapisany przebieg/.test(u.why.pl)), 'deklaracja mówi wprost, dlaczego kryterium zeszło z listy zbadanych');
  assert.deepEqual(degraded.missingEvidence, [], 'test nadal istnieje w pliku — to nie jest ten sam zarzut');
  /* Bez żadnego zapisanego przebiegu deklaracja nie powołuje się na nic. */
  const blind = CP.a11y({ checklistFile: path.join(os.tmpdir(), 'edmat-brak-listy-' + Date.now() + '.md') });
  assert.deepEqual(blind.tested, [], 'bez zapisanego przebiegu nie ma kryteriów „zbadanych”');
  assert.equal(blind.evidenceRun, null);
});

test('[r4.7] umowa powierzenia rozdziela to, co wymusza program, od tego, co należy do hostującego', async () => {
  const docs = await documents();
  const pl = docs['dpa:pl'].md.body;
  const en = docs['dpa:en'].md.body;
  assert.ok(pl.includes('art. 28'), 'umowa powołuje się na art. 28 RODO');
  assert.ok(en.includes('art. 28'), 'wersja angielska też');
  for (const letter of ['lit. a', 'lit. b', 'lit. c', 'lit. d', 'lit. e', 'lit. f', 'lit. g', 'lit. h']) {
    assert.ok(pl.includes(letter), 'umowa pomija wymóg art. 28 ust. 3 ' + letter);
  }
  assert.ok(pl.includes('scripts/backup.js'), 'usunięcie i zwrot danych wskazuje skrypt kopii zapasowej');
  assert.ok(pl.includes('/api/privacy/forget'), 'pomoc w realizacji praw osób wskazuje trasę usunięcia danych');
  assert.ok(/pieczęć|pieczęci/i.test(pl), 'umowa wskazuje pakiet archiwalny z pieczęcią');
  assert.ok(/audyt/i.test(pl), 'umowa mówi o prawie do audytu');
  assert.ok(/Europejski Obszar Gospodarczy/.test(pl), 'umowa mówi o miejscu przetwarzania');
  const parties = pl.slice(0, pl.indexOf('## 2.'));
  assert.ok(parties.includes(S.db.data.config.school.name), 'administratorem jest ta szkoła');
  assert.ok(parties.includes(S.db.data.config.school.director), 'reprezentacja szkoły z konfiguracji');
});

test('[r4.8] pola, których program znać nie może, są wprost oznaczone do uzupełnienia', async () => {
  const docs = await documents();
  for (const kind of KINDS) {
    const pl = docs[kind + ':pl'].md.body; const en = docs[kind + ':en'].md.body;
    const plMarks = (pl.match(/\[\[ do uzupełnienia przez szkołę \]\]/g) || []).length;
    const enMarks = (en.match(/\[\[ to be completed by the school \]\]/g) || []).length;
    assert.ok(plMarks >= 3, kind + ': za mało pól oznaczonych do uzupełnienia (' + plMarks + ')');
    assert.ok(enMarks >= 3, kind + ' (en): za mało pól oznaczonych do uzupełnienia (' + enMarks + ')');
    assert.ok(!en.includes('[[ do uzupełnienia przez szkołę ]]'), kind + ': wersja angielska ma polski znacznik');
  }
  const dpia = docs['dpia:pl'].md.body;
  for (const what of ['Inspektor Ochrony Danych', 'hosting', 'Podstawa prawna']) {
    assert.ok(new RegExp(what, 'i').test(dpia), 'DPIA nie pyta o: ' + what);
  }
  /* Zdanie o braku porady prawnej stoi w każdym dokumencie i w spisie. */
  for (const kind of KINDS) assert.match(docs[kind + ':pl'].md.body, /nie jest porad/i, kind + ': brak zastrzeżenia o poradzie prawnej');
  const list = expectOk(await IOD.get('/api/compliance'));
  assert.match(list.note, /porad/i, 'spis dokumentów niesie to samo zastrzeżenie');
  assert.equal(list.documents.length, 3, 'spis wymienia trzy dokumenty');
});

test('[r4.9] konto bez uprawnień nie dostaje żadnego z dokumentów', async () => {
  const forbidden = ['j.nowak', 'anna.kowalczyk', 'rodzic.kowalczyk', 'sekretariat', 'pielegniarka', 'pedagog', 'biblioteka'];
  for (const login of forbidden) {
    const c = await S.as(login);
    for (const path of ['/api/compliance', '/api/compliance/facts', '/api/compliance/dpia', '/api/compliance/dpa?format=html']) {
      const r = await c.get(path);
      assert.equal(r.status, 403, login + ' nie może czytać ' + path);
      assert.equal(r.body.code, 'forbidden', login + ': kod odmowy');
    }
  }
  /* Dyrektor i administrator mogą — pakiet jest dla IOD, administratora i dyrekcji. */
  for (const login of ['dyrektor', 'admin', 'iod']) {
    const c = await S.as(login);
    assert.equal((await c.get('/api/compliance/dpia')).status, 200, login + ' ma dostęp do pakietu');
  }
  /* Deklaracja dostępności jest publiczna z mocy ustawy: bez sesji, w obu językach; reszta pakietu nadal wymaga logowania. */
  const anon = S.client();
  const r = await anon.get('/api/compliance/accessibility?locale=en');
  assert.equal(r.status, 200, 'deklaracja dostępności jest osiągalna bez logowania');
  assert.match(String(r.body), /WCAG 2\.1/, 'deklaracja niesie standard');
  assert.equal((await anon.get('/api/compliance/dpia')).status, 401, 'DPIA bez sesji pozostaje niedostępna');
});

test('[r4.10] nieznana postać dokumentu to 400, a nie zgadywanie', async () => {
  const r = await IOD.get('/api/compliance/dpia?format=pdf');
  assert.equal(r.status, 400);
  assert.equal(r.body.code, 'bad_format');
  const j = expectOk(await IOD.get('/api/compliance/dpia?format=json'));
  assert.equal(j.kind, 'dpia');
  assert.equal(j.locale, 'pl');
  assert.ok(j.doc && Array.isArray(j.doc.sections) && j.doc.sections.length >= 5, 'postać JSON niesie strukturę sekcji dla ekranu');
  assert.ok(j.markdown.length > 1000 && j.html.length > 1000, 'postać JSON niesie też obie postacie dokumentu');
  /* Nieznany język cofa się do polskiego zamiast zwracać pustą stronę. */
  const de = expectOk(await IOD.get('/api/compliance/dpia?locale=de&format=json'));
  assert.equal(de.locale, 'pl');
  /* download=1 daje plik do zapisania. */
  const dl = await IOD.get('/api/compliance/accessibility?locale=en&download=1');
  assert.equal(dl.status, 200);
  assert.match(dl.headers.get('content-disposition') || '', /attachment; filename="edmat-accessibility-en\.md"/);
});

test('[r4.11] moduł „compliance” daje się wyłączyć w rejestrze modułów', async () => {
  const before = expectOk(await IOD.get('/api/modules'));
  assert.ok(before.modules.some((m) => m.id === 'compliance'), 'moduł jest w rejestrze');
  assert.ok(before.modules.find((m) => m.id === 'compliance').enabled, 'i jest domyślnie włączony');
  await withConfig(S.db, { modules: { enabled: Object.assign({}, (S.db.data.config.modules || {}).enabled, { compliance: false }) } }, async () => {
    for (const path of ['/api/compliance', '/api/compliance/dpia', '/api/compliance/accessibility', '/api/compliance/dpa', '/api/compliance/facts']) {
      const r = await IOD.get(path);
      assert.equal(r.status, 404, 'wyłączony moduł: ' + path);
      assert.equal(r.body.code, 'module_disabled');
      assert.equal(r.body.module, 'compliance');
    }
    /* Ekran też znika: rejestr modułów wysyłany do klienta ma go na „false”. */
    const screens = (await IOD.get('/app/screens.js')).body;   // shared client: retry + keep-alive
    assert.match(screens, /"compliance":false/, 'klient dostaje informację o wyłączonym module');
  });
  const after = await IOD.get('/api/compliance/dpia');
  assert.equal(after.status, 200, 'po przywróceniu modułu dokument znów się generuje');
});

/**
 * H-4 w raporcie uczciwości testów: ten test był `readFileSync` + `assert.match` po źródle ekranu,
 * a CONTRIBUTING.md mówi wprost „zachowanie klienta się uruchamia, nie grepuje”. Przemianowany prop,
 * ekran zarejestrowany dwa razy albo lista ról, którą powłoka filtruje inaczej, przechodziły taki
 * grep bez mrugnięcia. Teraz ekran naprawdę się renderuje w `loadClient()` — dla IOD i dla ucznia.
 */
function complianceScreen(session, extra) {
  const fs = require('node:fs'); const path = require('node:path'); const vm = require('node:vm');
  const ui = loadClient(Object.assign({ hash: '#/dostepnosc', session }, extra || {}));
  vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'public', 'app', 'screens', 'compliance.js'), 'utf8'), ui.sandbox, { filename: 'compliance.js' });
  return ui;
}
const SESSION = (role, login) => ({ user: { id: 'u_' + login, login, role, name: login }, config: { school: { short: 'SP12' } }, remainingSeconds: 900 });

test('[r4.12] ekran „Zgodność i dostępność” naprawdę renderuje się dla IOD i nie istnieje dla ucznia', async () => {
  const ui = complianceScreen(SESSION('dpo', 'iod'));
  const screen = ui.A.state.screens.filter((x) => x.id === 'compliance');
  assert.equal(screen.length, 1, 'ekran zarejestrowany dokładnie raz');
  assert.equal(screen[0].path, '/dostepnosc');
  assert.equal(screen[0].module, 'compliance', 'ekran należy do modułu, który da się wyłączyć');
  assert.deepEqual(Array.from(screen[0].roles), ['dpo', 'admin', 'principal']);
  await ui.render();
  /* Nie „w źródle jest taki napis”, tylko „powłoka wyrenderowała ten komponent”. */
  const names = ui.names();
  assert.ok(names.includes('Screen'), 'powłoka wyrenderowała ekran zgodności: ' + names.join(', '));
  assert.ok(names.includes('PackCard'), 'karta pakietu jest na ekranie');
  /* U3-02 — tabela dokumentów musi jechać przez E.Table (przewijak i układ telefonowy). */
  const tables = ui.all('Table');
  assert.ok(tables.length >= 1, 'karta pakietu renderuje E.Table, a nie surowe <table>');
  const docTable = tables.find((x) => (x.props.rows || []).some((r) => r.id === 'accessibility'));
  assert.ok(docTable, 'tabela wymienia deklarację dostępności');
  assert.deepEqual(Array.from(docTable.props.rows).map((r) => r.id), ['accessibility', 'dpia', 'dpa'], 'wszystkie trzy dokumenty, deklaracja dostępności pierwsza — to ona trafia na stronę szkoły');
  /* U3-16 — trzy przyciski „Pokaż” muszą mieć różne nazwy dostępne. */
  const buttons = ui.all('Button').filter((b) => b.props['aria-label']);
  const showLabels = buttons.map((b) => b.props['aria-label']).filter((x) => /poka|show/i.test(x));
  assert.equal(new Set(showLabels).size, showLabels.length, 'nazwy przycisków „Pokaż” powtarzają się: ' + showLabels.join(' | '));
  /* WCAG 2.5.3 — widoczny napis musi być częścią nazwy dostępnej. */
  for (const b of buttons) {
    const visible = typeof b.props.children === 'string' ? b.props.children : null;
    if (visible && /Markdown|Druk|Print/.test(visible)) assert.ok(b.props['aria-label'].includes(visible), 'nazwa dostępna nie zawiera napisu „' + visible + '”: ' + b.props['aria-label']);
  }
  /* U3-03 — dokument nie siedzi w obszarze aria-live; jest tam jedno krótkie zdanie o stanie. */
  const live = ui.all('p').concat(ui.all('div')).concat(ui.all('article'))
    .filter((n) => n.props && n.props['aria-live'] && n.props.className !== 'app-fixed-toasts');   // pasek toastów to powłoka
  assert.equal(live.length, 1, 'dokładnie jeden obszar aria-live na ekranie zgodności');
  assert.equal(live[0].props.role, 'status');
  assert.ok(String(live[0].props.children).length < 120, 'obszar aria-live niesie zdanie o stanie, nie cały dokument: ' + String(live[0].props.children).slice(0, 80));
  const article = ui.find('article');
  if (article) assert.equal(article.props['aria-live'], undefined, 'sam dokument nie jest obszarem aria-live');

  /* Uczeń nie ma tego ekranu w ogóle — sprawdzamy to na wyrenderowanej powłoce, nie na liście ról. */
  const pupil = complianceScreen(SESSION('student', 'anna.kowalczyk'));
  await pupil.render();
  assert.ok(!pupil.names().includes('PackCard'), 'uczeń nie dostaje karty pakietu zgodności');
});

/* Wzór z 2do.net (ContentSettingsView → zakładka „Audit Log”): dziennik audytu widzi każdy, kto ma do niego
   prawo, w sekcji, w której już pracuje — nie tylko rola, do której należy ekran. Trasa wpuszcza IOD-a,
   więc IOD dostaje rejestr na ekranie zgodności; dyrektor ma go w swojej zakładce, nie tutaj. */
test('[LC-A] IOD widzi rejestr zdarzeń na ekranie zgodności — ten sam komponent, co zakładka „Audyt” dyrekcji', async () => {
  const fs = require('node:fs'); const path = require('node:path'); const vm = require('node:vm');
  const withPrincipal = (ui) => { for (const f of ['00-log-comments.js', 'principal.js']) vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'public', 'app', 'screens', f), 'utf8'), ui.sandbox, { filename: f }); return ui; };
  const dpo = withPrincipal(complianceScreen(SESSION('dpo', 'iod')));
  await dpo.render();
  assert.ok(dpo.names().includes('RejestrZdarzen'), 'IOD ma rejestr zdarzeń na ekranie zgodności: ' + dpo.names().join(', '));
  const principal = withPrincipal(complianceScreen(SESSION('principal', 'dyr')));
  await principal.render();
  assert.ok(!principal.names().includes('RejestrZdarzen'), 'dyrektor czyta rejestr w zakładce „Audyt”, nie na ekranie zgodności');
  /* Sam komponent: bez listy kadry (IOD nie ma /api/principal/staff) filtr użytkownika bierze aktorów z wpisów. */
  const src = fs.readFileSync(path.join(__dirname, '..', 'public', 'app', 'screens', 'principal.js'), 'utf8');
  assert.match(src, /window\.EdPrincipal = \{ AuditRegister: RejestrZdarzen \}/, 'principal.js eksportuje rejestr dla ekranu zgodności');
});
