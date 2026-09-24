'use strict';
/*
 * Powierzchnia publiczna (F2, runda 3).
 *
 * Wszystko, co ten serwer odpowiada BEZ sesji, plus jedna rzecz, którą oddaje każdemu zalogowanemu
 * koncu — łącznie z trzynastolatkiem: `config` z `GET /api/auth/session`.
 *
 * Trzy rzeczy, których pilnuje ten plik, bo każda z nich wróciła w rundzie 3 jako osobne znalezisko:
 *   1. trasa publiczna nie oddaje faktów o instancji (S3-01) ani loginu żadnego konta,
 *   2. trasa publiczna nie jest przyciskiem „wyłącz szkołę”: liczy się z pamięci i ma ogranicznik
 *      tempa (S3-03, R3-07) — w procesie jednoszkolnym anonimowa pętla z internetu to była awaria,
 *   3. `publicConfig` to lista dozwolonych kluczy, a nie „config minus trzy pola” (S3-02) — klucz
 *      dodany jutro przez czyjś seed nie staje się przez to publiczny.
 *
 * Nazwy testów celowo nie niosą identyfikatora historyjki: to nie są nowe historyjki z listy.
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { startServer, expectOk, fixtures } = require('./helpers');

let S; test.before(async () => { S = await startServer(); }); test.after(() => S.close());
const need = fixtures();

/** Każda trasa zarejestrowana z `{ public: true }` — czytana z rejestru tras, nie z listy w teście. */
const publicRoutes = () => S.app.router.routes.filter((r) => r.opts && r.opts.public);

/* ------------------------------------------------------------------ 1. dostęp anonimowy --------- */

test('public surface: every route that answers without a session is one we decided on', () => {
  const got = publicRoutes().map((r) => r.method + ' ' + r.pattern).sort();
  /* Trasa publiczna w tym produkcie to wyjątek, nie wygoda: każda nowa musi tu trafić świadomie.
     `/api/dev/login` istnieje wyłącznie przy EDMAT_DEV=1 i nie ma go w tym przebiegu. */
  const expected = [
    'GET /api/auth/policy',              // polityka haseł na ekranie logowania
    'GET /api/compliance/accessibility', // deklaracja dostępności — publiczna z mocy ustawy
    'GET /api/demo/personas',            // tryb demonstracyjny (404, gdy wyłączony)
    'GET /api/health',                   // liveness kontenera
    'GET /api/setup/status',             // kreator pierwszego uruchomienia
    'POST /api/auth/login',
    'POST /api/meetings/:id/events',     // webhook serwera wideo, uwierzytelniony sekretem
    'POST /api/register',                // rejestracja opiekuna kodem
    'POST /api/setup/school',
    'GET /api/admin/anonymized-sample',
    'GET /api/auth/sso',                 // punkt wejścia logowania zewnętrznego (odpowiada „niedostępne”)
    'POST /api/demo/switch',             // przełączenie persony w trybie demonstracyjnym
    /* Zgłoszenie błędu bez sesji jest decyzją, nie wygodą: osoba, która nie potrafi przejść ekranu
       logowania, ma do powiedzenia najwięcej. Zapis anonimowy, więc trasa ma `rateLimit: true`
       (server/routes/report-issue.js) — bez ogranicznika byłaby pętlą zapisu z internetu. */
    'POST /api/report-issue',
  ].sort();
  for (const r of got) assert.ok(expected.includes(r), 'nowa trasa publiczna bez decyzji: ' + r);
});

test('public surface: nothing anonymous leaks a login, a pupil or the instance’s facts', async () => {
  const anon = S.client();
  /* Loginy kont osobowych — `j.nowak`, `rodzic.kowalczyk`, `anna.kowalczyk`. Generyczne loginy ról
     (`dyrektor`, `admin`, `sekretariat`, `biblioteka`) są zwykłymi polskimi rzeczownikami i pojawią
     się w prozie dokumentu z powodów, które nie mają nic wspólnego z kontem; to loginy osób są tym,
     co S3-01 wydawało obcemu z internetu. `iod` dopisujemy jawnie — to skrót, nie słowo. */
  const logins = S.db.col('users').map((u) => u.login).filter((l) => l && (l.includes('.') || l === 'iod'));
  assert.ok(logins.length > 20, 'sanity: sprawdzamy loginy osobowe, jest ich ' + logins.length);
  const pupils = S.db.col('students').map((s) => s.lastName).filter(Boolean);
  for (const r of publicRoutes()) {
    if (r.method !== 'GET') continue;
    const res = await anon.get(r.pattern.replace(/:[a-zA-Z]+/g, 'x'));
    if (res.status === 429) { S.app.publicRateLimit.reset(); continue; }
    const body = typeof res.body === 'string' ? res.body : JSON.stringify(res.body || {});
    for (const l of logins) {
      assert.equal(new RegExp('(^|[^\\w.@-])' + l.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '([^\\w.@-]|$)').test(body), false,
        r.pattern + ' oddaje login konta „' + l + '” bez sesji');
    }
    for (const p of pupils) assert.equal(body.includes(p), false, r.pattern + ' oddaje nazwisko ucznia „' + p + '” bez sesji');
  }
});

test('public surface: the accessibility statement never carries facts, in any shape', async () => {
  const anon = S.client();
  S.app.publicRateLimit.reset();
  /* S3-01: `?facts=1` był czystym obejściem bramy ról — identyczne dane stoją o jedną trasę dalej
     za `['dpo','admin','principal']`, a tędy wychodziły bez żadnego ciasteczka. */
  for (const q of ['', '?facts=1', '?format=json&facts=1', '?format=json&facts=true&locale=en', '?format=html&facts=1']) {
    const res = await anon.get('/api/compliance/accessibility' + q);
    assert.equal(res.status, 200, 'GET …/accessibility' + q);
    const body = typeof res.body === 'string' ? res.body : JSON.stringify(res.body);
    assert.equal(body.includes('"facts"'), false, 'facts w odpowiedzi na ' + q);
    if (res.body && typeof res.body === 'object') {
      assert.equal(res.body.facts, undefined, 'pole facts na ' + q);
      assert.deepEqual(Object.keys(res.body).sort(), ['doc', 'html', 'kind', 'locale', 'markdown', 'title']);
      /* `doc` to sekcje samej deklaracji i nic poza nimi. */
      assert.equal(res.body.doc.id, 'accessibility');
      assert.ok(res.body.doc.sections.length >= 8, 'osiem punktów deklaracji ustawowej');
    }
    /* Liczniki wierszy art. 9 w 30-osobowej szkole są bliskie identyfikacji — nie ma ich tu w ogóle. */
    for (const needle of ['nurseVisits', 'confidentialNotes', 'ipet', 'passwordPolicy', 'ipAllowlist', 'roleMatrix', 'sampleLogin']) {
      assert.equal(body.includes(needle), false, needle + ' w publicznej deklaracji (' + q + ')');
    }
  }
  /* Sąsiednie dokumenty zostają za rolami — także przed pierwszym uruchomieniem szkoły. */
  for (const kind of ['dpia', 'dpa']) {
    assert.equal((await anon.get('/api/compliance/' + kind)).status, 401, kind + ' bez sesji');
  }
  assert.equal((await anon.get('/api/compliance/facts')).status, 401);
});

test('public surface: the statement is served from a cache keyed by the store version, and is rate limited', async () => {
  const anon = S.client();
  S.app.publicRateLimit.reset();
  /* R3-07: jedno żądanie kosztowało ~200 ms procesora (scrypt, podpis RSA, skan całego public/,
     macierz ról × 16 kont). Mierzymy to, co da się zmierzyć bez zegara: ten sam bajt w odpowiedzi,
     dopóki sklep się nie zmienił, i nowy dokument, gdy się zmienił. */
  const first = await anon.get('/api/compliance/accessibility');
  assert.equal(first.status, 200);
  assert.equal(first.headers.get('cache-control'), 'public, max-age=300', 'dokument ustawowy da się zbuforować');
  const second = await anon.get('/api/compliance/accessibility');
  assert.equal(second.body, first.body, 'druga odpowiedź pochodzi z pamięci, co do bajtu');

  const before = S.db.version;
  S.db.data.config.school.phone = String(S.db.data.config.school.phone || '') + ' ';
  S.db.save();
  assert.notEqual(S.db.version, before, 'sanity: zapis podbija licznik wersji sklepu');
  const third = await anon.get('/api/compliance/accessibility');
  assert.notEqual(third.body, first.body, 'po zmianie w sklepie dokument powstaje od nowa');
  S.db.data.config.school.phone = String(S.db.data.config.school.phone).trim(); S.db.save();

  /* Ogranicznik tempa — ten sam pomysł, co okno na trasie logowania, tylko per adres. */
  S.app.publicRateLimit.reset();
  const limit = S.app.publicRateLimit.limit;
  const codes = [];
  for (let i = 0; i < limit + 12; i++) codes.push((await anon.get('/api/compliance/accessibility')).status);
  assert.equal(codes.filter((c) => c === 200).length, limit, 'przepuszczamy dokładnie tyle, ile mówi limit');
  const blocked = codes.filter((c) => c === 429);
  assert.ok(blocked.length >= 10, 'reszta dostaje 429, a nie zajmuje procesu');
  const last = await anon.get('/api/compliance/accessibility');
  assert.equal(last.status, 429);
  assert.equal(last.body.code, 'rate_limited');
  assert.equal(last.body.limitPerMinute, limit);
  /* Sonda żywotności kontenera nie może paść ofiarą ogranicznika założonego na deklarację. */
  assert.equal((await anon.get('/api/health')).status, 200, 'liveness kontenera nie jest ograniczany');
  S.app.publicRateLimit.reset();
});

test('public surface: an unknown document shape is refused before anything is computed', async () => {
  const anon = S.client();
  S.app.publicRateLimit.reset();
  const bad = await anon.get('/api/compliance/accessibility?format=pdf');
  assert.equal(bad.status, 400);
  assert.equal(bad.body.code, 'bad_format');
  assert.equal(String(JSON.stringify(bad.body)).includes('facts'), false);
});

/* ------------------------------------------------------------------ 2. publicConfig ------------- */

/** Klucze, które `GET /api/auth/session` naprawdę oddaje kontu ucznia. */
const pupilConfig = () => need('pupilConfig', async () => {
  const pupil = await S.as('anna.kowalczyk');
  return expectOk(await pupil.get('/api/auth/session')).config;
});

test('publicConfig: an allowlist, snapshotted — a key added tomorrow is not public by accident', async () => {
  const cfg = await pupilConfig();
  /* To jest migawka. Gdy ten test zacznie przeszkadzać, dopisanie klucza jest decyzją: sprawdź
     najpierw, czy `public/app` naprawdę go czyta (grep po `config.` i `cfg.`), i czy nie jest
     to sekret ani opis postawy bezpieczeństwa szkoły. */
  assert.deepEqual(Object.keys(cfg).sort(), [
    'adultAccess', 'demo', 'helpVideoUrl', 'homeworkMaxAttachmentMB', 'messaging', 'push',
    'school', 'sessionTimeoutMin', 'sessionWarnBeforeMin', 'setup', 'testLimits', 'timezone',
    'today', 'visibility', 'year',
  ].filter((k) => k in cfg).sort());
  /* Lista dozwolonych jest krótsza od konfiguracji o rząd wielkości — to jest ten wynik. */
  assert.ok(Object.keys(cfg).length < Object.keys(S.db.data.config).length / 2,
    'uczeń dostaje ' + Object.keys(cfg).length + ' z ' + Object.keys(S.db.data.config).length + ' kluczy konfiguracji');
});

test('publicConfig: not one secret, not one line about the school’s security posture', async () => {
  const cfg = await pupilConfig();
  const blob = JSON.stringify(cfg);
  /* S3-02 — każdy z tych kluczy jechał do każdego ucznia i każdego rodzica. */
  for (const k of ['video', 'payroll', 'ipAllowlist', 'ipAllowlistNote', 'ipAllowlistExample', 'retention',
    'schoolPrivateKey', 'require2FAForGradeEditors', 'logRetentionYears', 'logRetentionMinYears',
    'gradesArchiveRetentionYears', 'archiveWindow', 'auditImmutable', 'sio', 'anonymized']) {
    assert.equal(cfg[k], undefined, 'publicConfig nadal oddaje „' + k + '”');
  }
  const c = S.db.data.config;
  /* Sekret webhooka wideo i klucz podpisujący żetony wejścia na spotkanie — dosłownie, po wartości. */
  const secrets = [c.video && c.video.eventSecret, c.video && c.video.jitsi && c.video.jitsi.appSecret,
    c.video && c.video.bbb && c.video.bbb.secret, c.schoolPrivateKey].filter((x) => x && String(x).length > 6);
  assert.ok(secrets.length >= 1, 'sanity: seed ma co najmniej jeden sekret w konfiguracji');
  for (const sec of secrets) assert.equal(blob.includes(sec), false, 'sekret z konfiguracji w sesji ucznia');
  assert.equal(/PRIVATE KEY/.test(blob), false);
  /* `config.push` zostaje, ale wyłącznie w publicznej części: włącznik, tryb ładunku, klucz PUBLICZNY. */
  if (cfg.push) for (const k of Object.keys(cfg.push)) assert.ok(['enabled', 'payload', 'publicKey', 'subject'].includes(k), 'config.push oddaje „' + k + '”');
});

test('publicConfig: the client still gets every key it actually reads', async () => {
  const cfg = await pupilConfig();
  /* Lista poniżej to wynik greppowania `public/app` po `props.config` / `A.state.config` / `cfg.`:
     jeżeli ekran zacznie czytać nowy klucz, ten test ma puścić dopiero po dopisaniu go do listy
     dozwolonych w `server/index.js`. `npm run smoke` renderuje każdy ekran w obu językach i jest
     drugą, grubszą siatką pod tym samym pytaniem. */
  for (const k of ['school', 'year', 'today', 'messaging', 'sessionTimeoutMin', 'sessionWarnBeforeMin',
    'homeworkMaxAttachmentMB', 'testLimits', 'visibility', 'adultAccess']) {
    assert.notEqual(cfg[k], undefined, 'klient czyta config.' + k + ', a sesja go nie oddaje');
  }
  assert.equal(typeof cfg.school.name, 'string');
  assert.equal(cfg.school.name, S.db.data.config.school.name);
  /* Konto pracownika dostaje dokładnie to samo — lista nie zależy od roli, bo nie jest uprawnieniem. */
  const staff = await S.as('sekretariat');
  const mine = expectOk(await staff.get('/api/auth/session')).config;
  assert.deepEqual(Object.keys(mine).sort(), Object.keys(cfg).sort());
});

/* ------------------------------------------------------------------ 3. log żądań --------------- */

test('public surface: the request log carries the route pattern, never the identifier in the path', async () => {
  /* S3-15 — pełny dowód stoi w `[REL-17]` (tests/40-platform.test.js); tutaj tylko to, co dotyczy
     powierzchni publicznej: wzorzec trasy jest na trasie, a nie doklejany w logu. */
  for (const r of S.app.router.routes) {
    assert.equal(typeof r.pattern, 'string');
    assert.ok(r.pattern.startsWith('/api/'), 'trasa bez wzorca: ' + r.pattern);
  }
  const m = S.app.router.match('GET', '/api/registry/students/st_kowalczyk_anna/guardians');
  assert.ok(m && m.route, 'trasa dopasowana');
  assert.equal(m.route.pattern, '/api/registry/students/:id/guardians');
  assert.equal(m.route.pattern.includes('kowalczyk'), false, 'wzorzec nie niesie nazwiska, a ścieżka tak');
});

/* ------------------------------------------------------------------ 4. Content-Disposition ------ */

test('public surface: a file name can never open a second header or a second filename parameter', () => {
  const { safeContentDisposition } = require('../server/lib/router');
  /* S3-09 — `year` z treści żądania lądowało w nagłówku przez interpolację: cudzysłów zamykał
     parametr i otwierał drugi (klienci nie zgadzają się, który wygrywa), a CR/LF robił z trasy
     ustawowego pobrania trwałą pięćsetkę, bo Node odmawia zapisania takiego nagłówka. */
  const injected = safeContentDisposition('x"; filename="oceny-7b.html');
  assert.equal(injected.split('filename=').length - 1, 2, 'dokładnie dwa parametry: filename i filename*');
  assert.match(injected, /^attachment; filename="[^"]*"; filename\*=UTF-8''/);
  assert.equal(injected.includes('"; filename="oceny'), false);

  for (const evil of ['a\r\nSet-Cookie: x=1', 'a\nX-Injected: 1', 'a b', '../../etc/passwd']) {
    const h = safeContentDisposition(evil);
    assert.equal(/[\r\n ]/.test(h), false, 'znak sterujący w nagłówku dla „' + JSON.stringify(evil) + '”');
    assert.doesNotThrow(() => { require('node:http').validateHeaderValue ? require('node:http').validateHeaderValue('Content-Disposition', h) : null; });
  }
  /* Długość: 100 000 znaków `year` robiło 132 kB nagłówka, który standardowy klient odrzuca. */
  assert.ok(safeContentDisposition('ą'.repeat(100000)).length < 1200);
  /* Polskie nazwy przeżywają — po to jest `filename*`. */
  const pl = safeContentDisposition('odpis arkusza ocen — Żółć.pdf');
  assert.match(pl, /filename="odpis arkusza ocen [^"]*\.pdf"/);
  assert.match(pl, /filename\*=UTF-8''odpis%20arkusza%20ocen%20/);
  assert.equal(pl.startsWith('attachment;'), true);
  assert.equal(safeContentDisposition('x', 'inline').startsWith('inline;'), true);
  assert.equal(safeContentDisposition('').startsWith('attachment; filename="plik"'), true);
});

test('public surface: the archive signature route may carry a real signature', () => {
  const { bodyLimitFor, UPLOAD_ROUTES } = require('../server/lib/router');
  /* R3-04/S3-21 — trasa nie była na liście, więc obowiązywał limit 512 kB dla zwykłego JSON-a:
     podpis PAdES-LT ważący megabajty kończył się `ECONNRESET`, a nie polskim komunikatem.
     base64 rozdyma plik o 4/3, więc 5 MB podpisu to ~6,7 MB treści żądania. */
  const route = S.app.router.routes.find((r) => r.pattern === '/api/principal/archive/:id/signature');
  assert.ok(route, 'trasa podpisu istnieje');
  const limit = bodyLimitFor(route);
  assert.ok(limit >= Math.ceil(5 * 1024 * 1024 * 4 / 3), 'limit treści mieści 5 MB podpisu w base64, jest ' + limit);
  assert.ok(UPLOAD_ROUTES.some((re) => re.test(route.pattern)), 'trasa jest na liście tras z załącznikami');
});
