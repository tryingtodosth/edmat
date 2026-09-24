'use strict';
/*
 * Pakiet zgodności (R4): trzy dokumenty generowane z działającej instancji — ocena skutków (DPIA),
 * deklaracja dostępności i szkielet umowy powierzenia (art. 28 RODO). Fakty zbiera
 * `server/lib/compliance.js`; tutaj są tylko trasy i wybór postaci dokumentu.
 *
 *   GET /api/compliance                              spis dokumentów + fakty (JSON)
 *   GET /api/compliance/facts                        same fakty (JSON) — podgląd dla IOD
 *   GET /api/compliance/dpia?locale=pl|en&format=…   ocena skutków
 *   GET /api/compliance/accessibility?locale=…       deklaracja dostępności
 *   GET /api/compliance/dpa?locale=…                 umowa powierzenia
 *
 * `format`: `md` (domyślnie, text/markdown), `html` (dokument gotowy do druku, ten sam, który
 * `/api/pdf?path=…` zamienia na PDF) albo `json` (dokument jako struktura + obie postacie).
 * `download=1` każe przeglądarce zapisać plik zamiast go pokazywać; `facts=1` dokłada do postaci
 * JSON komplet faktów (to samo, co `/api/compliance/facts`).
 *
 * Dostęp: IOD, administrator i dyrektor. **Deklaracja dostępności jest publiczna z mocy ustawy**
 * (`{ public: true }`, wyjęta z bramy `setup_required` w `server/index.js`), więc obowiązują ją trzy
 * dodatkowe reguły — patrz `publicAccessibility` niżej: nigdy `facts`, nigdy loginy, i zawsze
 * z pamięci podręcznej za ogranicznikiem tempa. Pozostałe dwa dokumenty stoją za rolami.
 */
const { httpError } = require('../lib/router');
const CP = require('../lib/compliance');

const ROLES = { roles: ['dpo', 'admin', 'principal'] };
const FORMATS = ['md', 'html', 'json'];
const TITLE = {
  dpia: { pl: 'Ocena skutków dla ochrony danych (DPIA)', en: 'Data protection impact assessment (DPIA)' },
  accessibility: { pl: 'Deklaracja dostępności', en: 'Accessibility statement' },
  dpa: { pl: 'Umowa powierzenia (art. 28 RODO)', en: 'Processing agreement (art. 28 GDPR)' },
};

function localeOf(ctx) { return ctx.query.locale === 'en' ? 'en' : 'pl'; }
function formatOf(ctx) {
  const f = String(ctx.query.format || 'md').toLowerCase();
  if (!FORMATS.includes(f)) throw httpError(400, 'Nieznana postać dokumentu. Dopuszczalne: ' + FORMATS.join(', ') + '.', { code: 'bad_format', format: f });
  return f;
}
function fileName(kind, locale, ext) { return 'edmat-' + kind + '-' + locale + '.' + ext; }
/* Dokument ustawowy, publikowany i cytowany — pięć minut w pamięci przeglądarki i pośrednika zdejmuje
   z jednoprocesowego serwera szkoły całą powtarzalną pracę przy odświeżeniach. */
const PUBLIC_CACHE_CONTROL = 'public, max-age=300';

/** Jedna postać odpowiedzi dla obu dokumentów za rolami i dla publicznej deklaracji. */
function render(ctx, kind, built, withFacts, cacheControl) {
  const locale = built.locale; const format = formatOf(ctx);
  const download = ctx.query.download === '1' || ctx.query.download === 'true';
  if (format === 'json') {
    const out = { kind: built.kind, locale: built.locale, title: built.title, doc: built.doc, markdown: built.markdown, html: built.html };
    /* `facts` to najcięższa część odpowiedzi i ma własną trasę — ekran jej nie potrzebuje. */
    if (withFacts && ctx.query.facts === '1') out.facts = built.facts;
    return out;
  }
  const raw = format === 'html'
    ? { __raw: true, contentType: 'text/html; charset=utf-8', body: built.html, inline: !download, filename: download ? fileName(kind, locale, 'html') : undefined }
    : { __raw: true, contentType: 'text/markdown; charset=utf-8', body: built.markdown, inline: !download, filename: download ? fileName(kind, locale, 'md') : undefined };
  if (cacheControl) raw.cacheControl = cacheControl;
  return raw;
}
function serve(kind) {
  return (ctx) => render(ctx, kind, CP.build(kind, ctx.db, ctx.app, localeOf(ctx)), true, null);
}

function register(r, app) {
  /* ------------------------------------------------------- publiczna deklaracja (S3-01/S3-03/R3-07)
     Trasa bez sesji w procesie jednoszkolnym musi być tania i wąska. Wcześniej jedno anonimowe
     żądanie kosztowało ~200 ms procesora (scrypt, podpis RSA, skan całego `public/`, macierz ról
     × 16 kont), a `?format=json&facts=1` oddawało komuś z internetu spis wszystkich zbiorów
     z licznikami art. 9, politykę haseł i login prawdziwego konta każdej z 16 ról.
     Teraz: dokument powstaje z wąskiego zestawu faktów (`build(..., { facts: false })`), zostaje
     w pamięci do najbliższej zmiany w sklepie (`db.version`), `facts` nie ma jak się do niego
     dostać w żadnej postaci, a `{ rateLimit: true }` daje trasie ten sam rodzaj okna, co logowaniu.
     Pamięć podręczna wisi na domknięciu `register()`, czyli na instancji aplikacji — testy stawiają
     wiele serwerów obok siebie i nie mogą sobie nawzajem podać dokumentu innej szkoły. */
  const publicCache = new Map();
  function publicAccessibility(ctx) {
    const locale = localeOf(ctx); formatOf(ctx);                 // 400 bad_format zanim cokolwiek policzymy
    const version = ctx.db.version;
    let entry = publicCache.get(locale);
    if (!entry || entry.version !== version) {
      entry = { version, built: CP.build('accessibility', ctx.db, ctx.app, locale, { facts: false }) };
      publicCache.set(locale, entry);
    }
    return render(ctx, 'accessibility', entry.built, false, PUBLIC_CACHE_CONTROL);
  }
  if (app) app.complianceCache = { clear: () => publicCache.clear(), size: () => publicCache.size };

  r.get('/api/compliance', (ctx) => {
    const locale = localeOf(ctx);
    const facts = CP.facts(ctx.db, ctx.app);
    return {
      locale,
      documents: CP.KINDS.map((k) => ({
        kind: k, title: TITLE[k][locale],
        markdown: '/api/compliance/' + k + '?locale=' + locale,
        html: '/api/compliance/' + k + '?locale=' + locale + '&format=html',
        json: '/api/compliance/' + k + '?locale=' + locale + '&format=json',
      })),
      locales: CP.LOCALES,
      formats: FORMATS,
      fillMark: CP.FILL_MARK[locale],
      summary: {
        school: facts.school.name || null, year: facts.year, generatedAt: facts.generatedAt,
        collections: facts.counts.collections, personalCollections: facts.counts.personalCollections, personalRows: facts.personalRows,
        art9Collections: facts.art9.map((i) => i.collection), art9Rows: facts.art9.reduce((n, i) => n + i.rows, 0),
        students: facts.counts.students, guardians: facts.counts.guardians, staff: facts.counts.staff,
        subProcessors: facts.subProcessors.length, push: facts.transports.push.enabled, video: facts.transports.video.configured,
        trackersOk: facts.trackers.ok, a11yTested: facts.a11y.tested.length, a11yUntested: facts.a11y.untested.length,
        retentionClasses: facts.retention.classes.length, jrwaVerified: facts.retention.jrwaVerified,
      },
      note: locale === 'en'
        ? 'Generated from this running instance. None of it is legal advice — see docs/compliance/README.md.'
        : 'Dokumenty powstają z faktów tej instancji. Żaden z nich nie jest poradą prawną — patrz docs/compliance/README.md.',
    };
  }, ROLES);

  r.get('/api/compliance/facts', (ctx) => CP.facts(ctx.db, ctx.app), ROLES);

  /* Deklaracja dostępności jest z mocy ustawy publiczna — bez sesji i przed pierwszym uruchomieniem (server/index.js). */
  for (const kind of CP.KINDS) {
    if (kind === 'accessibility') r.get('/api/compliance/accessibility', publicAccessibility, { public: true, rateLimit: true });
    else r.get('/api/compliance/' + kind, serve(kind), ROLES);
  }
}

module.exports = { register, ROLES, FORMATS, TITLE, PUBLIC_CACHE_CONTROL };
