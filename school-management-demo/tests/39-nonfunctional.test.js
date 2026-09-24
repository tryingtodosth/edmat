'use strict';
/* Sekcja 3.9 — wymagania niefunkcjonalne: dostępność, bezpieczeństwo, wydajność, prywatność.
   (3.9.5 — wygaśnięcie sesji — jest sprawdzane w tests/00-foundation.test.js). */
const test = require('node:test'); const assert = require('node:assert/strict');
const fs = require('node:fs'); const path = require('node:path');
const { startServer, expectOk, loadClient, chromium, inChromium, domOf } = require('./helpers');

const ROOT = path.join(__dirname, '..');
const PUBLIC = path.join(ROOT, 'public');
const SCREENS = path.join(PUBLIC, 'app', 'screens');
const read = (p) => fs.readFileSync(p, 'utf8');
/* Pliki `00-*.js` to wspólne komponenty (np. panel komentarzy do wpisów dzienników) sklejane przed ekranami — nie rejestrują ekranu. */
const screenFiles = () => fs.readdirSync(SCREENS).filter((f) => f.endsWith('.js') && !/^00-/.test(f)).sort();

process.env.EDMAT_DEV = '1';           // /api/dev/login — tak samo jak w scripts/smoke.js
let S; test.before(async () => { S = await startServer(); }); test.after(() => S.close());

/* ------------------------------------------------------------------ prawdziwy klient, nie grep
   Kilka historyjek z 3.9 mówi o zachowaniu przeglądarki. Zamiast dowodzić go dopasowaniem wzorca do
   źródła (nasłuch, który nic nie robi, też by przeszedł), uruchamiamy pliki klienta naprawdę:
   lekkie — w piaskownicy node:vm (loadClient), ciężkie — w tym samym headless Chromium, którego
   używa `npm run smoke`. Bez Chromium podtest jest pomijany, sama historyjka pozostaje zielona. */
const noChrome = () => (chromium() ? false : 'brak lokalnego headless Chromium (EDMAT_CHROME)');
/** DOM prawdziwego ekranu + pomiar w przeglądarce; zwraca to, co policzył skrypt strony. */
async function measureScreen(login, hash, body, size) {
  const to = hash + (hash.indexOf('?') >= 0 ? '&' : '?') + 'lang=pl';
  const dom = await domOf(`${S.base}/api/dev/login?as=${encodeURIComponent(login)}&to=${encodeURIComponent(to)}`, size);
  /* Pusty zrzut to zagłodzona przeglądarka, nie zepsuty ekran: `domOf` ponawia raz i dopiero
     potem mówi wprost, że przekroczyła własny limit (EDMAT_UI_TIMEOUT go podnosi). Tutaj
     zostaje odróżnienie „nic nie przyszło” od „przyszło, ale bez ekranu” — bez tego test
     czytał się jako wina aplikacji za każdym razem, gdy maszyna była obciążona. */
  assert.ok(dom.length > 0, 'Chromium nie oddał ani bajtu dla ' + hash + ' — maszyna jest obciążona, to nie jest wynik testu aplikacji (EDMAT_UI_TIMEOUT podnosi limit)');
  assert.match(dom, /app-title/, 'Chromium wyrenderował ekran ' + hash);
  /* Skrypty wyciągamy: mierzymy ułożenie gotowego drzewa, a nie boot aplikacji od nowa.
     <base> zostawia arkusze, czcionki i obrazki na serwerze testowym. */
  const page = dom.replace(/<script\b[\s\S]*?<\/script>/g, '').replace(/<head>/, `<head><base href="${S.base}/">`);
  return inChromium(page, body, size);
}
/** Elementy wystające poza okno, które nie siedzą we własnym kontenerze z przewijaniem w poziomie. */
const ESCAPES = `
  var d = document.documentElement, b = document.body;
  function metrics() { void b.offsetWidth; return { inner: innerWidth, body: b.scrollWidth, doc: d.scrollWidth, client: d.clientWidth }; }
  function escaping() {
    return [].slice.call(document.querySelectorAll('body *')).filter(function (e) {
      if (e.getBoundingClientRect().right <= innerWidth + 1) return false;
      for (var a = e.parentElement; a; a = a.parentElement) { var ox = getComputedStyle(a).overflowX; if (ox === 'auto' || ox === 'scroll' || ox === 'hidden') return false; }
      return true;
    }).slice(0, 8).map(function (e) { return e.tagName.toLowerCase() + '.' + String(e.className || '').slice(0, 40) + ' @' + Math.round(e.getBoundingClientRect().right); });
  }`;

test('[3.9.1] każdy ekran ma jeden nagłówek h1 i etykiety ARIA; wydruk serwera ma nagłówek h1', async () => {
  for (const f of screenFiles()) {
    const src = read(path.join(SCREENS, f));
    // assert.match potwierdzałby tylko „co najmniej jeden” nagłówek. Historyjka mówi o jednym h1
    // na widok, więc liczymy: każdy h1 w pliku musi być nagłówkiem ekranu (app-title) i odwrotnie,
    // a plik rejestruje dokładnie jeden ekran.
    const titles = src.match(/className: 'display app-title'/g) || [];
    const h1s = src.match(/'h1'/g) || [];
    const regs = src.match(/A\.screen\(\{/g) || [];
    assert.equal(regs.length, 1, f + ': plik ekranu rejestruje dokładnie jeden ekran');
    assert.ok(titles.length >= 1, f + ': brak <h1 class="display app-title">');
    assert.equal(h1s.length, titles.length, f + ': każdy h1 w pliku musi być nagłówkiem ekranu (app-title), znaleziono ' + h1s.length + ' h1 i ' + titles.length + ' app-title');
    assert.match(src, /aria-label(ledby)?/, f + ': brak etykiet ARIA');
  }
  const shell = read(path.join(PUBLIC, 'app', 'shell.js'));
  /* Odnośnik „Przejdź do treści” żyje teraz w TopBarze systemu projektowego, nie w powłoce — patrz
     U3-29 w shell.js: druga kopia w powłoce była martwym pierwszym tabem. Asercja idzie więc za nim
     zamiast zniknąć: coś przed treścią musi ten odnośnik renderować, i to coś powłoka musi osadzić. */
  assert.match(shell, /E\.TopBar/, 'powłoka osadza górny pasek');
  assert.match(read(path.join(PUBLIC, 'edmat', 'bundle.js')), /h\(SkipLink,/, 'górny pasek renderuje odnośnik „Przejdź do treści”');
  assert.match(shell, /'main', \{ id: 'main'/, 'główna treść w elemencie main');
  const anna = await S.as('anna.kowalczyk');
  const print = await anna.get('/api/student/grades/print');
  assert.equal(print.status, 200);
  assert.match(print.headers.get('content-type'), /text\/html/);
  assert.equal((print.body.match(/<h1[ >]/g) || []).length, 1, 'wydruk ma dokładnie jeden nagłówek h1');
  assert.match(print.body, /<html lang="pl"/);
  assert.ok((print.body.match(/<th[ >]/g) || []).length >= 3, 'tabela ocen ma wiersz nagłówkowy th, nie same td');
  /* Sam <th> nie wystarczy czytnikowi ekranu: każdy nagłówek musi mówić, czego dotyczy (scope),
     a każda tabela — czym jest (caption). Sprawdzamy to na trzech dokumentach urzędowych. */
  const docs = [
    ['ocen ucznia', print.body],
    ['odpis arkusza ocen', (await (await S.as('sekretariat')).get('/api/registry/students/st_kowalczyk_anna/transcript')).body],
    ['kody rejestracyjne', (await (await S.as('admin')).post('/api/admin/registration-codes/print', {})).body],
  ];
  for (const [what, html] of docs) {
    const body = String(html);
    assert.match(body, /^<!doctype html>/, what + ': dokument do druku');
    const tables = body.match(/<table[\s\S]*?<\/table>/g) || [];
    assert.ok(tables.length >= 1, what + ': wydruk zawiera tabelę');
    for (const t of tables) {
      assert.match(t, /<caption>/, what + ': tabela bez <caption>');
      for (const th of t.match(/<th(?=[\s>])[^>]*>/g) || []) assert.match(th, /scope="(col|row)"/, what + ': nagłówek bez scope — ' + th);
    }
  }
});

test('[3.9.2] wysoki kontrast i skalowalna typografia: 200 % tekstu bez przewijania w poziomie', async (t) => {
  const tokens = read(path.join(PUBLIC, 'edmat', 'tokens.css'));
  assert.match(tokens, /\[data-theme="hc"\]/, 'motyw wysokiego kontrastu');
  assert.match(tokens, /\[data-theme="dark"\]/, 'motyw ciemny');
  const remSizes = tokens.match(/font-size:\s*[\d.]+rem/g) || [];
  assert.ok(remSizes.length >= 8, 'skala typografii w rem (znaleziono ' + remSizes.length + ')');
  assert.ok(!/font-size:\s*\d+px/.test(tokens), 'żaden rozmiar tekstu nie jest podany w px');
  const app = read(path.join(PUBLIC, 'app', 'app.css'));
  const widths = (app.match(/(^|[^-\w])width:\s*\d+px/gm) || []);
  assert.deepEqual(widths, [], 'brak sztywnych szerokości w px poza max-width: ' + widths.join(', '));
  assert.match(app, /max-width: var\(--content-max\)/);

  /* public/app/theme.js naprawdę uruchomione: zapamiętane powiększenie tekstu i preferencja kontrastu
     trafiają na <html> jeszcze przed pierwszym malowaniem. Grep po nazwie klucza tego nie dowodził. */
  const vm = require('node:vm');
  const runTheme = (stored, contrast) => {
    const html = { dataset: {}, style: {} };
    const sb = { document: { documentElement: html }, localStorage: { getItem: (k) => (k in stored ? stored[k] : null), setItem: () => {}, removeItem: () => {} }, matchMedia: (q) => ({ matches: /prefers-contrast: more/.test(q) ? contrast : false }) };
    sb.window = sb; vm.createContext(sb);
    vm.runInContext(read(path.join(PUBLIC, 'app', 'theme.js')), sb, { filename: 'theme.js' });
    return html;
  };
  assert.equal(runTheme({ 'edmat.textZoom': '200%' }, false).style.fontSize, '200%', 'zapamiętane 200 % tekstu wraca przed malowaniem');
  assert.equal(runTheme({}, true).dataset.theme, 'hc', 'systemowa preferencja kontrastu daje motyw wysokiego kontrastu');
  assert.equal(runTheme({ 'edmat.theme': 'dark' }, true).dataset.theme, 'dark', 'wybór użytkownika ma pierwszeństwo przed systemem');
  assert.equal(runTheme({ 'edmat.reduceMotion': '1' }, false).dataset.reduceMotion, '1');
  const settings = read(path.join(SCREENS, 'settings.js'));
  assert.match(settings, /200%/, 'ustawienie 200 % tekstu');
  assert.match(settings, /E\.RadioGroup/, 'wybór motywu jako grupa przycisków radio');

  /* „200 % powiększenia bez przewijania w poziomie” — zmierzone, nie opisane. */
  await t.test('200 % tekstu na telefonie nie tworzy poziomego paska przewijania', { skip: noChrome() }, async () => {
    const r = await measureScreen('anna.kowalczyk', '/uczen', ESCAPES + `
      var at100 = metrics();
      d.style.fontSize = '200%';
      var at200 = metrics();
      return { at100: at100, at200: at200, escaping: escaping(), nodes: document.querySelectorAll('body *').length };`, { width: 390, height: 844 });
    assert.ok(r.nodes > 100, 'zmierzony jest pełny ekran, nie pusta strona (' + r.nodes + ' węzłów)');
    assert.equal(r.at100.body, r.at100.inner, 'przy 100 % strona mieści się w oknie');
    assert.ok(r.at200.body <= r.at200.inner, `przy 200 % tekstu body ma ${r.at200.body}px na ${r.at200.inner}px okna`);
    assert.ok(r.at200.doc <= r.at200.inner, 'dokument też nie przewija się w poziomie');
    assert.deepEqual(r.escaping, [], 'każdy szerszy element siedzi we własnym kontenerze z przewijaniem');
  });
});

test('[3.9.3] pełna obsługa klawiatury i widoczny pierścień fokusu', async (t) => {
  /* Grep po źródłach przechodzi też dla nasłuchu, który nic nie robi. Uruchamiamy więc prawdziwe
     i18n.js + edmat/bundle.js + core.js + shell.js i naciskamy klawisze. */
  let saved = 0; let ui;
  const screen = (id, p2, label, order, body) => ({ id, path: p2, roles: ['teacher'], nav: { label, order }, component: body || function Empty() { return null; } });
  ui = loadClient({ screens: [
    screen('lekcja', '/lekcja', 'Lekcja', 1, function Lekcja() { ui.A.onSave(function () { saved++; }); return null; }),
    screen('oceny', '/oceny', 'Oceny', 2),
    screen('wychowawca', '/wychowawca', 'Wychowawca', 3),
  ] });
  await ui.render();
  assert.ok(ui.names().includes('Frame'), 'powłoka zalogowała użytkownika i zbudowała ramkę');

  /* Alt + cyfra przenosi do n-tej sekcji nawigacji — i robi to naprawdę. */
  assert.equal(ui.press('2', { altKey: true }), true, 'Alt+2 jest obsłużone (preventDefault)');
  assert.equal(ui.hash, '#/oceny');
  ui.press('3', { altKey: true }); assert.equal(ui.hash, '#/wychowawca');
  ui.press('1', { altKey: true }); assert.equal(ui.hash, '#/lekcja');
  ui.press('9', { altKey: true }); assert.equal(ui.hash, '#/lekcja', 'cyfra bez sekcji niczego nie przełącza');
  assert.equal(ui.press('2', {}), false, 'sama cyfra nie nawiguje');

  /* Ctrl+S / Cmd+S wywołuje zapis ekranu, który się pod skrót podpiął (A.onSave). */
  await ui.render();
  assert.equal(ui.press('s', { ctrlKey: true }), true); assert.equal(saved, 1);
  assert.equal(ui.press('S', { metaKey: true }), true); assert.equal(saved, 2);

  /* „/” ustawia fokus na polu wyszukiwania, „?” otwiera listę skrótów — ale nie w trakcie pisania. */
  ui.press('/'); assert.deepEqual(ui.focused, ['search']);
  ui.press('?', { target: { tagName: 'INPUT' } });
  assert.equal(ui.A.state.showShortcuts, undefined, 'w polu tekstowym „?” to zwykły znak');
  ui.press('?'); await ui.render();
  assert.ok(ui.names().includes('ShortcutsDialog'), 'powłoka pokazuje okno ze skrótami');
  ui.press('?'); await ui.render();
  assert.ok(!ui.names().includes('ShortcutsDialog'), 'drugie „?” zamyka okno');

  /* Pierścień fokusu: token istnieje w źródle, a w przeglądarce naprawdę się pojawia. */
  const tokens = read(path.join(PUBLIC, 'edmat', 'tokens.css'));
  assert.match(tokens, /--focus-ring/, 'token pierścienia fokusu');
  assert.match(read(path.join(PUBLIC, 'edmat', 'bundle.css')), /:focus-visible \{[^}]*box-shadow: var\(--focus-ring\)/, 'pierścień fokusu klawiaturowego z tokenu');
  await t.test('pierścień fokusu jest widoczny w prawdziwej przeglądarce', { skip: noChrome() }, async () => {
    const link = (f) => `<link rel="stylesheet" href="file://${path.join(PUBLIC, f)}">`;
    const html = `<!doctype html><html lang="pl" data-theme="light"><head><meta charset="utf-8">${link('edmat/tokens.css')}${link('edmat/bundle.css')}${link('app/app.css')}</head><body><main><input id="probe" class="ed-input" type="text"><input id="idle" class="ed-input" type="text"></main></body></html>`;
    const r = await inChromium(html, `
      var el = document.getElementById('probe'); el.focus();
      function ring(t) { document.documentElement.setAttribute('data-theme', t); return getComputedStyle(document.documentElement).getPropertyValue('--focus-ring').trim(); }
      var light = ring('light'), dark = ring('dark'), hc = ring('hc'); ring('light');
      return { focusVisible: el.matches(':focus-visible'), shadow: getComputedStyle(el).boxShadow,
               idle: getComputedStyle(document.getElementById('idle')).boxShadow, light: light, dark: dark, hc: hc };`);
    assert.equal(r.focusVisible, true, 'pole z fokusem klawiaturowym pasuje do :focus-visible');
    assert.ok(/ 4px| 5px/.test(r.shadow), 'policzony pierścień fokusu: ' + r.shadow);
    assert.notEqual(r.shadow, r.idle, 'pole bez fokusu nie ma pierścienia (' + r.idle + ')');
    assert.match(r.shadow, /rgb\(/, 'token rozwiązuje się do koloru, nie do pustej wartości');
    assert.ok(r.light && r.dark && r.hc && new Set([r.light, r.dark, r.hc]).size === 3, 'każdy motyw ma własny pierścień');
  });
});

test('[3.9.4] film instruktażowy ma napisy WebVTT i transkrypcję tekstową', async () => {
  const r = await fetch(S.base + '/help/intro.vtt');
  assert.equal(r.status, 200);
  const vtt = await r.text();
  assert.match(vtt, /^WEBVTT/);
  assert.match(vtt, /Language: pl/);
  /* Historyjka mówi o DOKŁADNYCH napisach i o tekstowej alternatywie — sama liczba wpisów tego nie
     pokazuje. Parsujemy więc napisy: czasy muszą rosnąć i nie zachodzić na siebie, a każda kwestia
     musi mieć swój odpowiednik w transkrypcji obok odtwarzacza (alternatywa = ta sama treść). */
  const secs = (t) => { const m = /^(\d\d):(\d\d):(\d\d)\.(\d{3})$/.exec(t); assert.ok(m, 'zły znacznik czasu: ' + t); return +m[1] * 3600 + +m[2] * 60 + +m[3] + +m[4] / 1000; };
  const lines = vtt.split(/\r?\n/);
  const cueList = [];
  for (let i = 0; i < lines.length; i++) {
    const m = /^(\S+) --> (\S+)/.exec(lines[i]); if (!m) continue;
    const text = []; for (let j = i + 1; j < lines.length && lines[j].trim(); j++) text.push(lines[j].trim());
    cueList.push({ from: secs(m[1]), to: secs(m[2]), text: text.join(' ') });
  }
  assert.ok(cueList.length >= 5, 'napisy mają co najmniej 5 kwestii (' + cueList.length + ')');
  for (let i = 0; i < cueList.length; i++) {
    assert.ok(cueList[i].to > cueList[i].from, 'kwestia ' + (i + 1) + ' kończy się przed początkiem');
    assert.ok(cueList[i].text.length > 10, 'kwestia ' + (i + 1) + ' jest pusta');
    if (i) assert.ok(cueList[i].from >= cueList[i - 1].to, 'kwestie ' + i + ' i ' + (i + 1) + ' nachodzą na siebie');
  }
  assert.match(vtt, /dzienniku EdMat/);
  const poster = await fetch(S.base + '/help/intro-poster.svg');
  assert.equal(poster.status, 200);
  const settings = read(path.join(SCREENS, 'settings.js'));
  assert.match(settings, /'video'/, 'odtwarzacz wideo na ekranie ustawień');
  assert.match(settings, /'track'/, 'ścieżka napisów');
  assert.match(settings, /kind: 'subtitles'/);
  assert.ok(/srcLang: 'pl'|srclang="pl"/.test(settings), 'napisy w języku polskim');
  assert.match(settings, /\/help\/intro\.vtt/);
  assert.match(settings, /Transkrypcja tekstowa/, 'transkrypcja obok odtwarzacza');
  const transcript = [...settings.matchAll(/\['(\d\d):(\d\d)', '((?:[^'\\]|\\.)*)'\]/g)]
    .map((m) => ({ at: +m[1] * 60 + +m[2], text: m[3].replace(/\\'/g, "'") }));
  assert.equal(transcript.length, cueList.length, 'transkrypcja ma tyle samo wierszy, co napisy');
  for (let i = 0; i < cueList.length; i++) {
    assert.ok(Math.abs(transcript[i].at - cueList[i].from) < 1, 'wiersz ' + (i + 1) + ' transkrypcji (' + transcript[i].at + ' s) rozjeżdża się z napisem (' + cueList[i].from + ' s)');
    assert.equal(transcript[i].text, cueList[i].text, 'wiersz ' + (i + 1) + ': transkrypcja nie jest tą samą treścią co napis');
  }
  assert.ok(!/https?:\/\/(?!www\.w3\.org)/.test(settings), 'żadnych zewnętrznych serwisów wideo');
});

test('[3.9.6] HSTS przy połączeniu HTTPS oraz ciasteczko sesji HttpOnly/SameSite/Secure', async () => {
  const plain = await fetch(S.base + '/');
  assert.equal(plain.headers.get('strict-transport-security'), null, 'bez HSTS na zwykłym HTTP w prototypie');
  const https = await fetch(S.base + '/', { headers: { 'x-forwarded-proto': 'https' } });
  const hsts = https.headers.get('strict-transport-security');
  assert.ok(hsts && /max-age=\d{7,}/.test(hsts) && /includeSubDomains/.test(hsts), 'HSTS: ' + hsts);
  assert.equal(https.headers.get('x-content-type-options'), 'nosniff');
  assert.match(https.headers.get('content-security-policy'), /default-src 'self'/);
  assert.equal(https.headers.get('x-frame-options'), 'DENY');
  const login = await S.client().post('/api/auth/login', { login: 'anna.kowalczyk', password: S.DEMO_PASSWORD });
  const cookie = login.headers.get('set-cookie');
  assert.match(cookie, /HttpOnly/); assert.match(cookie, /SameSite=Strict/);
  assert.ok(!/Secure/.test(cookie), 'prototyp na HTTP nie oznacza ciasteczka jako Secure');
  const secure = await startServer({ secureCookies: true });
  try {
    const l2 = await secure.client().post('/api/auth/login', { login: 'anna.kowalczyk', password: secure.DEMO_PASSWORD });
    const c2 = l2.headers.get('set-cookie');
    assert.match(c2, /Secure/, 'z secureCookies ciasteczko ma atrybut Secure');
    assert.match(c2, /HttpOnly/); assert.match(c2, /SameSite=Strict/);
  } finally { await secure.close(); }
});

test('[3.9.7] otwarcie dziennika i zapis frekwencji poniżej 2 s, także przy równoległych sesjach', async () => {
  /* Historyjka: „otworzyć dziennik i zapisać frekwencję w mniej niż 2 sekundy w godzinach szczytu”.
     Mierzymy oba kroki (odczyt ORAZ zapis) i medianę zamiast sumy — suma na obciążonej maszynie CI
     mierzy głównie sąsiednie procesy. Żadnej podmiany adresu w locie: jeśli nauczycielka nie może
     otworzyć własnej lekcji, to jest błąd, a nie powód do mierzenia innego ekranu. */
  const teacher = await S.as('j.nowak');
  const lesson = S.db.col('lessons').find((l) => l.classId === '7b' && l.date === S.TODAY && l.subjectId === 'mat');
  assert.ok(lesson, 'w planie jest lekcja matematyki 7b na dziś');
  const url = '/api/attendance/lesson/' + lesson.id;
  const first = await teacher.get(url);
  assert.equal(first.status, 200, 'nauczycielka otwiera własną lekcję: ' + JSON.stringify(first.body).slice(0, 200));
  assert.ok(first.body.students.length >= 12, 'dziennik wraca z pełną listą klasy');

  const median = (xs) => xs.slice().sort((a, b) => a - b)[Math.floor(xs.length / 2)];
  const timed = async (fn) => { const t0 = process.hrtime.bigint(); const r = await fn(); return { ms: Number(process.hrtime.bigint() - t0) / 1e6, r }; };

  for (let i = 0; i < 5; i++) expectOk(await teacher.get(url));            // rozgrzewka
  const reads = [];
  for (let i = 0; i < 50; i++) { const { ms, r } = await timed(() => teacher.get(url)); expectOk(r, 'odczyt ' + i); reads.push(ms); }
  const readMedian = median(reads);
  assert.ok(readMedian < 200, 'mediana odczytu dziennika ' + readMedian.toFixed(1) + ' ms (limit 200 ms)');
  assert.ok(Math.max(...reads) < 2000, 'najwolniejszy odczyt ' + Math.max(...reads).toFixed(0) + ' ms (limit 2000 ms z historyjki)');

  // to, czego stary test nie robił w ogóle: czasownik z historyjki, czyli ZAPIS frekwencji
  const roster = first.body.students.map((x) => x.studentId);
  const writes = [];
  for (let i = 0; i < 20; i++) {
    const { ms, r } = await timed(() => teacher.post(url, { allPresent: true, entries: [{ studentId: roster[i % roster.length], status: i % 2 ? 'ob' : 'sp', minutes: 5 }] }));
    expectOk(r, 'zapis ' + i); writes.push(ms);
  }
  const writeMedian = median(writes);
  assert.ok(writeMedian < 300, 'mediana zapisu frekwencji ' + writeMedian.toFixed(1) + ' ms (limit 300 ms)');
  assert.ok(Math.max(...writes) < 2000, 'najwolniejszy zapis ' + Math.max(...writes).toFixed(0) + ' ms (limit 2000 ms z historyjki)');

  // „godziny szczytu”: kilkanaście sesji naraz, każda dostaje poprawną odpowiedź
  const peak = await Promise.all(Array.from({ length: 10 }, () => S.as('j.nowak')));
  const t0 = Date.now();
  const answers = await Promise.all(peak.map((c) => c.get(url)));
  const peakMs = Date.now() - t0;
  assert.ok(answers.every((x) => x.status === 200 && x.body.students.length === roster.length), 'każda równoległa sesja dostaje pełny dziennik');
  assert.ok(peakMs < 2000, '10 równoległych otwarć dziennika zajęło ' + peakMs + ' ms (limit 2000 ms)');
});

test('[3.9.8] skan potwierdza brak bibliotek śledzących i zasobów spoza serwera szkoły', async () => {
  const iod = await S.as('iod');
  const scan = expectOk(await iod.get('/api/privacy/trackers'));
  assert.equal(scan.ok, true, JSON.stringify(scan.externalResources.concat(scan.trackerLibraries)));
  assert.deepEqual(scan.externalResources, []);
  assert.deepEqual(scan.trackerLibraries, []);
  assert.ok(scan.textFilesScanned >= 8, 'skan objął pliki aplikacji');
  assert.match(scan.csp, /default-src 'self'/);
  assert.match(scan.verdict, /Nie wykryto/);
  for (const m of scan.externalUrlMentions) assert.ok(!/analytics|tracking|ads/i.test(m.url), 'podejrzany adres: ' + m.url);
  const admin = await S.as('admin');
  assert.equal((await admin.get('/api/privacy/trackers')).status, 200);
  assert.equal((await (await S.as('anna.kowalczyk')).get('/api/privacy/trackers')).status, 403, 'skan dostępny tylko dla IOD i administratora');
  const manifest = JSON.parse(read(path.join(PUBLIC, 'manifest.webmanifest')));
  assert.equal(manifest.start_url, '/');
  const sw = read(path.join(PUBLIC, 'sw.js'));
  assert.ok(!/https?:\/\//.test(sw), 'service worker nie odwołuje się do adresów zewnętrznych');
});

test('[3.9.9] IOD usuwa dane konta testowego, zostawiając techniczny dziennik zdarzeń', async () => {
  const db = S.db;
  const student = { id: 'st_test_rodo', rollNo: 99, firstName: 'Testowy', lastName: 'Testowski', sex: 'M', classId: '7b',
    pesel: '13121012345', birthDate: '2013-01-10', status: 'active', registerNo: 9999, parentIds: [], adult: false,
    adultSelfExcuse: false, parentAccessBlocked: false, testAccount: true, achievements: [] };
  db.col('students').push(student);
  db.get('classes', '7b').studentIds.push(student.id);
  db.col('users').push({ id: 'u_st_test_rodo', login: 'test.rodo', role: 'student', firstName: 'Testowy', lastName: 'Testowski',
    name: 'Testowy Testowski', studentId: student.id, classId: '7b', email: 'test.rodo@example.invalid', phone: '600100200',
    testAccount: true, blocked: false, mustChangePassword: false, totpEnabled: false,
    passwordHash: db.one('users', (u) => u.login === 'anna.kowalczyk').passwordHash });
  db.col('grades').push({ id: 'st_gr_test_rodo', studentId: student.id, subjectId: 'mat', classId: '7b', value: '4', weight: 3,
    categoryName: 'sprawdzian', kind: 'partial', semester: 1, date: '2026-10-10', teacherId: 'u_nowak', deleted: false });
  db.save();

  const c = await S.as('test.rodo');
  expectOk(await c.post('/api/messages', { toUserIds: ['u_nowak'], subject: 'Pytanie od Testowski', body: 'Treść konta testowego.' }));
  const iod = await S.as('iod');
  const noReason = await iod.post('/api/privacy/forget', { userId: 'u_st_test_rodo' });
  assert.equal(noReason.status, 400);
  const notTest = await iod.post('/api/privacy/forget', { userId: 'u_nowak', reason: 'próba' });
  assert.equal(notTest.status, 403, 'konta rzeczywistego nie usuwamy bez decyzji administratora danych');
  assert.equal((await (await S.as('anna.kowalczyk')).post('/api/privacy/forget', { userId: 'u_st_test_rodo', reason: 'x' })).status, 403);
  const auditBefore = db.col('audit').length;
  const technical = db.col('audit').filter((a) => a.action === 'login').length;

  const gradesBefore = db.col('grades').filter((g) => g.studentId === 'st_test_rodo').length;
  const r = expectOk(await iod.post('/api/privacy/forget', { userId: 'u_st_test_rodo', reason: 'Wniosek o usunięcie danych – RODO art. 17' }));
  assert.equal(r.ok, true); assert.equal(r.erasedStudentId, 'st_test_rodo');
  const user = db.get('users', 'u_st_test_rodo'); const st = db.get('students', 'st_test_rodo');
  /* Klasa dokumentacji decyduje: konto i księga uczniów są ANONIMIZOWANE trwałym pseudonimem,
     nie usuwane (docs/RETENTION.md §3). */
  assert.equal(user.firstName, r.pseudonym); assert.equal(user.email, null); assert.equal(user.phone, null);
  assert.match(r.pseudonym, /^OSOBA-[0-9A-F]{8}$/);
  assert.equal(user.passwordHash, ''); assert.equal(user.blocked, true); assert.equal(user.erased, true);
  assert.ok(!/test\.rodo/.test(user.login), 'login zanonimizowany');
  assert.equal(st.pesel, null); assert.equal(st.lastName, r.pseudonym); assert.equal(st.status, 'erased');
  assert.ok(!db.get('classes', '7b').studentIds.includes('st_test_rodo'), 'usunięty z listy klasy');
  /* Arkusz ocen to kategoria B50: art. 17 go anonimizuje, nie kasuje — inaczej szkoła nie wyda
     duplikatu świadectwa, do którego jest zobowiązana (S3-06, H-1; tests/59-erasure.test.js). */
  assert.equal(db.col('grades').filter((g) => g.studentId === 'st_test_rodo').length, gradesBefore, 'oceny zostają — klasa B50');
  assert.ok(!/Testowski/.test(JSON.stringify(db.col('grades').filter((g) => g.studentId === 'st_test_rodo'))), 'ale bez nazwiska');
  const msg = db.col('messages').find((m) => m.fromUserId === 'u_st_test_rodo');
  assert.equal(msg, undefined, 'wiadomości to klasa operacyjna — wiersze nadawcy znikają');

  const audit = db.col('audit');
  assert.ok(audit.length > auditBefore, 'dziennik zdarzeń nie jest ruszany, rośnie o protokół (' + auditBefore + ' → ' + audit.length + ')');
  assert.equal(audit.filter((a) => a.action === 'login').length, technical, 'wpisy techniczne zachowane');
  assert.equal(audit.filter((a) => a.redacted).length, 0, 'art. 17 nie redaguje rejestru zdarzeń (S3-05)');
  assert.equal(r.audit.touched, false);
  assert.ok(audit.some((a) => a.userId === 'u_st_test_rodo'), 'identyfikator konta w dzienniku zdarzeń zostaje');
  assert.ok(audit.some((a) => a.action === 'right_to_be_forgotten' && a.entityId === 'u_st_test_rodo'));
  const log = expectOk(await iod.get('/api/privacy/erasures'));
  assert.ok(log.erasures.some((e) => e.entityId === 'u_st_test_rodo' && /RODO art\. 17/.test(e.reason)));
  const relogin = await S.client().post('/api/auth/login', { login: 'test.rodo', password: S.DEMO_PASSWORD });
  assert.equal(relogin.status, 401, 'konto testowe nie pozwala się już zalogować');
});

test('[3.9.10] interfejs mobilny bez progów płatności: układ responsywny i pełny zakres funkcji', async (t) => {
  for (const f of screenFiles()) {
    const src = read(path.join(SCREENS, f));
    assert.ok(/grid-2|grid-3|'stack'|className: 'row/.test(src), f + ': brak klas układu responsywnego');
  }
  const index = read(path.join(PUBLIC, 'index.html'));
  assert.match(index, /width=device-width, initial-scale=1/);
  assert.ok(!/maximum-scale|user-scalable=no/.test(index), 'powiększanie strony nie jest blokowane');
  const anna = await S.as('anna.kowalczyk');
  const e = expectOk(await anna.get('/api/student/entitlements'));
  assert.equal(e.paywall, false); assert.equal(e.free, true);
  const mobile = await S.client(); await mobile.login('anna.kowalczyk');
  for (const p of ['/api/student/dashboard', '/api/student/grades', '/api/student/attendance/today', '/api/messages', '/api/notifications/feed']) {
    assert.equal((await mobile.get(p)).status, 200, p + ' dostępne bez opłat');
  }
  /* „Układ responsywny” był dotąd dowodzony grepem po `min-width` i `@media` w app.css — przechodziłby
     też dla reguły, której nic nie używa. Mierzymy więc gotowe ekrany na szerokości telefonu. */
  await t.test('ekrany ucznia i rodzica mieszczą się w oknie telefonu 360 px', { skip: noChrome() }, async () => {
    for (const [login, hash] of [['anna.kowalczyk', '/uczen'], ['rodzic.kowalczyk', '/rodzic']]) {
      const r = await measureScreen(login, hash, ESCAPES + `
        var m = metrics();
        return { m: m, escaping: escaping(), nodes: document.querySelectorAll('body *').length,
                 main: (document.querySelector('main') || {}).scrollWidth || 0 };`, { width: 360, height: 1400 });
      assert.ok(r.nodes > 100, hash + ': zmierzony pełny ekran (' + r.nodes + ' węzłów)');
      assert.equal(r.m.body, r.m.inner, hash + `: body ma ${r.m.body}px przy oknie ${r.m.inner}px`);
      assert.ok(r.main <= r.m.inner, hash + ': treść główna nie wychodzi poza okno');
      assert.deepEqual(r.escaping, [], hash + ': elementy szersze od okna siedzą w kontenerach z przewijaniem');
    }
  });
});
