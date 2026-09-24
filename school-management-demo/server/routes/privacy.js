'use strict';
/* Ochrona danych (IOD/administrator): prawo do bycia zapomnianym (3.9.9) oraz dowód, że aplikacja
   nie ładuje żadnych bibliotek śledzących ani reklamowych (3.9.8).

   Art. 17 RODO nie jest osobną regułą. Obowiązuje ta sama tabela klas dokumentacji, co brakowanie
   (server/routes/retention.js, docs/RETENTION.md): klasa mówi, czy jej wiersze wolno USUNĄĆ, czy
   tylko ZANONIMIZOWAĆ, czy nie wolno ruszyć w ogóle. Stąd:

     * klasy archiwalne (dziennik lekcyjny B5, arkusze ocen B50, księga uczniów B50/A, dokumentacja
       PPP i medyczna — dane z art. 9 RODO) są ANONIMIZOWANE w miejscu: pola tożsamości zastępuje
       trwały pseudonim, a daty, oceny i frekwencja zostają. Nic z nich nie znika;
     * klasy operacyjne (wiadomości, powiadomienia, sesje, doręczenia push, kody rejestracyjne)
       są USUWANE — to nie jest dokumentacja przebiegu nauczania;
     * rejestr zdarzeń NIE JEST ruszany w ogóle. Protokół usunięcia danych sam jest wpisem w tym
       rejestrze (S3-05: wcześniej jedno żądanie potrafiło zredagować 100 % rejestru).
     * `force` przełamuje wyłącznie bramkę „to konto testowe”. Nie przełamuje reguły klas —
       nie istnieje żądanie, które usunie arkusz ocen albo księgę uczniów.

   Dopasowanie danych osobowych jest STRUKTURALNE: igły biorą się z pól firstName, lastName, login,
   email, pesel, phone, mają co najmniej 3 znaki i pasują do CAŁEJ wartości pola — nigdy do
   `JSON.stringify(wiersz).includes(igła)`. Osobny, wąski przebieg redaguje pola tekstu swobodnego
   (text/body/subject/comment/reason/note) dopasowaniem do całego słowa i jest liczony osobno. */
const fs = require('node:fs'); const path = require('node:path'); const crypto = require('node:crypto');
const { httpError } = require('../lib/router');
const util = require('../lib/util');
const RET = require('./retention');
const LA = require('../lib/log-access');        // rejestracja rodzajów dzienników do komentarzy
const LC = require('./log-comments');           // liczniki komentarzy przy wierszach list

const PUBLIC = path.join(__dirname, '..', '..', 'public');
const REDACTED = '(dane zredagowane na żądanie – RODO art. 17)';

/* ---------- 3.9.8: skaner zasobów zewnętrznych -------------------------------------------- */
const TEXT_EXT = ['.html', '.js', '.css', '.json', '.webmanifest', '.vtt', '.svg', '.txt'];
const TRACKERS = ['google-analytics.com', 'googletagmanager.com', 'doubleclick.net', 'facebook.net', 'facebook.com/tr', 'hotjar.com', 'mixpanel.com', 'segment.io', 'segment.com', 'amplitude.com', 'matomo.cloud', 'piwik.pro', 'clarity.ms', 'mc.yandex.ru', 'criteo.com', 'taboola.com', 'outbrain.com', 'newrelic.com', 'bugsnag.com', 'fullstory.com', 'intercom.io', 'sentry.io', 'adservice.google', 'quantserve.com', 'scorecardresearch.com', 'chartbeat.com', 'optimizely.com', 'mouseflow.com', 'smartlook.com', 'onesignal.com', 'firebaseio.com', 'appsflyer.com', 'branch.io', 'adsbygoogle'];
const TRACKER_GLOBALS = ['datalayer.push', 'gtag(', 'fbq(', '_gaq.push', 'ga(\'send', 'analytics.track(', 'mixpanel.init', 'amplitude.getinstance'];
const RESOURCE_PATTERNS = [
  { what: 'script src', re: /<script\b[^>]*\bsrc\s*=\s*["']([^"']+)["']/gi },
  { what: 'img src', re: /<img\b[^>]*\bsrc\s*=\s*["']([^"']+)["']/gi },
  { what: 'link href', re: /<link\b[^>]*\bhref\s*=\s*["']([^"']+)["']/gi },
  { what: 'iframe/embed src', re: /<(?:iframe|embed|object|video|audio|source|track)\b[^>]*\b(?:src|data)\s*=\s*["']([^"']+)["']/gi },
  { what: '@import', re: /@import\s+(?:url\()?\s*["']([^"')]+)/gi },
  { what: 'css url()', re: /url\(\s*["']?((?:https?:)?\/\/[^"')\s]+)/gi },
  { what: 'fetch()', re: /\bfetch\s*\(\s*["'`]([^"'`]+)/gi },
  { what: 'XMLHttpRequest.open', re: /\.open\s*\(\s*["'][A-Z]+["']\s*,\s*["']([^"']+)/gi },
  { what: 'importScripts', re: /importScripts\s*\(\s*["']([^"']+)/gi },
  { what: 'sendBeacon', re: /sendBeacon\s*\(\s*["']([^"']+)/gi }
];
function walk(dir, out) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out); else out.push(p);
  }
  return out;
}
function isExternal(u) { return /^(https?:)?\/\//i.test(u) && !/^\/\//.test(u) ? true : /^\/\//.test(u); }
function scanTrackers(app) {
  const files = walk(PUBLIC, []); const scanned = []; const external = []; const trackers = []; const mentions = [];
  for (const f of files) {
    const rel = '/' + path.relative(PUBLIC, f).split(path.sep).join('/');
    if (!TEXT_EXT.includes(path.extname(f).toLowerCase())) { scanned.push({ file: rel, binary: true }); continue; }
    const text = fs.readFileSync(f, 'utf8'); scanned.push({ file: rel, bytes: text.length });
    for (const { what, re } of RESOURCE_PATTERNS) {
      re.lastIndex = 0; let m;
      while ((m = re.exec(text))) { const url = m[1]; if (isExternal(url)) external.push({ file: rel, kind: what, url }); }
    }
    const low = text.toLowerCase();
    for (const t of TRACKERS) if (low.includes(t)) trackers.push({ file: rel, tracker: t, kind: 'domena' });
    for (const g of TRACKER_GLOBALS) if (low.includes(g)) trackers.push({ file: rel, tracker: g, kind: 'wywołanie' });
    const re2 = /https?:\/\/[^\s"'`)<>]+/gi; let m2;
    while ((m2 = re2.exec(text))) {
      const url = m2[0];
      if (/^https?:\/\/(www\.)?w3\.org\//i.test(url)) continue;               // przestrzenie nazw XML/SVG, nie zasoby sieciowe
      if (!mentions.some((x) => x.url === url)) mentions.push({ file: rel, url });
    }
  }
  const ok = external.length === 0 && trackers.length === 0;
  return {
    ok, checkedAt: util.now(), root: 'public/', filesScanned: scanned.length, textFilesScanned: scanned.filter((s) => !s.binary).length,
    externalResources: external, trackerLibraries: trackers,
    externalUrlMentions: mentions,                                            // np. adres dokumentacji w komunikacie błędu – nie jest pobierany
    /* F2 — polityka CSP z jej budowniczego (`app.contentSecurityPolicy()`), nie z wyrażenia regularnego po źródle index.js. */
    csp: app && typeof app.contentSecurityPolicy === 'function' ? app.contentSecurityPolicy() : '',
    verdict: ok
      ? 'Aplikacja ładuje wyłącznie zasoby z własnego serwera. Nie wykryto bibliotek analitycznych, sieci reklamowych ani telemetrii.'
      : 'Wykryto odwołania do zasobów spoza serwera szkoły — wymagają usunięcia przed wdrożeniem.',
    method: 'Statyczny skan plików public/ (HTML, JS, CSS, manifest, VTT, SVG): odwołania script/img/link/iframe/@import/url(), fetch, XMLHttpRequest, importScripts, sendBeacon oraz lista znanych bibliotek śledzących.'
  };
}

/* ---------- 3.9.9: prawo do bycia zapomnianym --------------------------------------------- */

/** Pola, z których wolno zbudować igłę. Nic poza nimi — i nic krótszego niż MIN_NEEDLE (S3-05). */
const NEEDLE_FIELDS = ['firstName', 'lastName', 'login', 'email', 'pesel', 'phone'];
const MIN_NEEDLE = 3;
/** Pola tożsamości w cudzych wierszach: zastępujemy pseudonimem albo czyścimy. */
const PSEUDONYM_FIELDS = ['firstName', 'lastName', 'name', 'fullName', 'studentName', 'parentName', 'guardianName', 'displayName', 'author', 'mother', 'father', 'firstNameLocative', 'lastNameLocative', 'student', 'pupil'];
const BLANK_FIELDS = ['login', 'email', 'phone', 'address', 'pesel', 'passport', 'identityDocument', 'idNote', 'birthPlace', 'birthPlaceLocative'];
/** Tekst swobodny — osobny, wąski przebieg dopasowania do całego słowa. */
const TEXT_FIELDS = ['text', 'body', 'subject', 'comment', 'reason', 'note', 'scope', 'description', 'summary', 'rejectReason', 'forceNote'];
/** Pola, po których poznajemy, że wiersz dotyczy tej osoby. `byUserId`/`teacherId` NIE są tu:
    one mówią, kto wpis zrobił, a nie kogo dotyczy — inaczej usunięcie konta nauczyciela zabrałoby
    dziennik całej klasy. */
const SUBJECT_ID_FIELDS = ['studentId', 'userId', 'parentUserId', 'fromUserId', 'bookedForStudentId', 'bookedByUserId'];
/** Listy członkostwa, z których osobę wypisujemy. */
const MEMBERSHIP_FIELDS = ['studentIds', 'parentIds', 'toUserIds', 'userIds', 'childrenIds', 'parentUserIds', 'deliveredTo'];

/** Trwały pseudonim: ten sam identyfikator zawsze daje ten sam napis, więc wiersze da się złożyć. */
function pseudonymFor(id) {
  return 'OSOBA-' + crypto.createHash('sha256').update('edmat-erasure:' + String(id)).digest('hex').slice(0, 8).toUpperCase();
}

/** Igły: wyłącznie pola strukturalne, przycięte, minimum 3 znaki, bez powtórzeń. */
function needlesFor(subjects) {
  const out = new Set();
  for (const s of subjects) {
    if (!s) continue;
    for (const f of NEEDLE_FIELDS) {
      const v = s[f];
      if (typeof v !== 'string') continue;
      const t = v.trim();
      if (t.length >= MIN_NEEDLE) out.add(t);
    }
  }
  return Array.from(out);
}

/** Dopasowanie do CAŁEJ wartości pola (bez względu na wielkość liter i spacje po bokach). */
function isWholeValue(value, needles) {
  if (typeof value !== 'string') return false;
  const t = value.trim().toLowerCase();
  if (t.length < MIN_NEEDLE) return false;
  return needles.some((n) => n.toLowerCase() === t);
}

const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
/** Tekst swobodny: dopasowanie do całego słowa, nigdy do fragmentu (S3-05). */
function redactWords(value, needles) {
  if (typeof value !== 'string' || !value) return null;
  let out = value; let hit = false;
  for (const n of needles) {
    if (n.length < MIN_NEEDLE) continue;
    const re = new RegExp('(^|[^\\p{L}\\p{N}])' + escapeRe(n) + '(?=$|[^\\p{L}\\p{N}])', 'giu');
    if (!re.test(out)) continue;
    re.lastIndex = 0;
    out = out.replace(re, (m, pre) => pre + REDACTED);
    hit = true;
  }
  return hit ? out : null;
}

/** Czy ten wiersz dotyczy usuwanej osoby (po polach strukturalnych, nie po tekście). */
function rowBelongsTo(row, ids) {
  if (!row || typeof row !== 'object') return false;
  for (const f of SUBJECT_ID_FIELDS) if (row[f] && ids.includes(row[f])) return true;
  return false;
}

/**
 * Anonimizacja wiersza w miejscu: tożsamość znika, daty i oceny zostają. Schodzimy też w zagnieżdżone
 * obiekty (np. `guardianContact`, `data` świadectwa) — tam też siedzą imiona i telefony.
 */
function anonymiseRow(row, pseudo, needles, counters, depth) {
  if (!row || typeof row !== 'object') return false;
  const d = depth || 0;
  let touched = false;
  for (const k of Object.keys(row)) {
    const v = row[k];
    if (v && typeof v === 'object') {
      if (d < 4 && anonymiseRow(v, pseudo, needles, counters, d + 1)) touched = true;
      continue;
    }
    if (typeof v !== 'string') continue;
    if (PSEUDONYM_FIELDS.includes(k)) { if (v !== pseudo) { row[k] = pseudo; touched = true; } continue; }
    if (BLANK_FIELDS.includes(k)) { if (v) { row[k] = null; touched = true; } continue; }
    if (isWholeValue(v, needles)) { row[k] = pseudo; touched = true; continue; }
    if (TEXT_FIELDS.includes(k)) {
      const next = redactWords(v, needles);
      if (next !== null) { row[k] = next; touched = true; counters.textRedacted++; }
    }
  }
  return touched;
}

/** Wypisanie osoby z list członkostwa (oddział, grupa, rozdzielnik wiadomości). */
function unlinkRow(row, ids) {
  if (!row || typeof row !== 'object') return false;
  let touched = false;
  for (const f of MEMBERSHIP_FIELDS) {
    const v = row[f];
    if (!Array.isArray(v)) continue;
    const keep = v.filter((x) => !ids.includes(x));
    if (keep.length !== v.length) { row[f] = keep; touched = true; }
  }
  for (const map of ['readBy', 'ackBy', 'deliveredAt', 'consents']) {
    const m = row[map];
    if (!m || typeof m !== 'object' || Array.isArray(m)) continue;
    for (const id of ids) if (m[id] !== undefined) { delete m[id]; touched = true; }
  }
  return touched;
}

/**
 * Co żądanie z art. 17 robi z którą klasą — jedna tabela, czytana z polityki retencji.
 * F2 (routes/compliance.js) opisuje tym art. 17 w DPIA i w umowie powierzenia, zamiast zgadywać.
 */
function describeErasure(db) {
  const pol = RET.policy(db);
  const by = (action) => pol.classes.filter((c) => c.erasure === action).map((c) => ({
    class: c.class, label: c.label, category: c.category, kind: c.kind, article9: !!c.article9,
    neverDelete: RET.neverDeleteOf(c), collections: c.collections.slice(),
    reason: c.erasureReason || null
  }));
  const uncovered = db ? RET.uncoveredCollections(db) : [];
  return {
    rule: 'Klasa dokumentacji decyduje. Klasy archiwalne są anonimizowane w miejscu (pola tożsamości → pseudonim; daty, oceny i frekwencja zostają), klasy operacyjne są usuwane, rejestr zdarzeń nie jest ruszany, a dane robocze programu tracą tylko powiązanie z osobą.',
    matching: { fields: NEEDLE_FIELDS.slice(), minLength: MIN_NEEDLE, mode: 'whole-value', freeText: { fields: TEXT_FIELDS.slice(), mode: 'whole-word' }, neverScanned: ['audit'] },
    anonymised: by('anonymise'),
    deleted: by('delete'),
    unlinked: by('unlink'),
    neverTouched: by('keep'),
    article9: pol.classes.filter((c) => c.article9).map((c) => c.class),
    audit: { touched: false, note: 'Rejestr zdarzeń nie jest redagowany ani usuwany. Protokół usunięcia danych (action: right_to_be_forgotten) sam jest wpisem w tym rejestrze.' },
    uncovered,
    force: 'Pole `force` przełamuje wyłącznie bramkę „to konto testowe”. Nie zmienia klasy ani tego, co wolno usunąć.'
  };
}

/** Kolekcje, których żądanie z art. 17 w ogóle dotyka — wyliczone z klas, nie z listy w kodzie (D3-29). */
function personalCollections(db) {
  return RET.classifyAll(db)
    .filter((x) => !x.uncovered && x.erasure && x.erasure !== 'keep')
    .map((x) => x.collection);
}

/* Komentarze i notatki prywatne do wpisów dzienników (routes/log-comments.js) idą tą samą regułą,
   co reszta — tylko trzy razy, bo komentarz ma trzy powiązania z osobą:
     • napisała go usuwana osoba → znika (to jej wypowiedź, nie dokumentacja przebiegu nauczania);
     • wisi pod wpisem, który to żądanie usunęło → znika razem z wpisem, do którego należał;
     • jest cudzy i zostaje → jego tekst przechodzi tę samą redakcję całych słów, co każdy inny
       tekst swobodny (`TEXT_FIELDS`), więc imię usuniętego ucznia nie zostaje w dopisku.
   Wpisy ANONIMIZOWANE (arkusz ocen, księga uczniów) zostają — i ich komentarze zostają razem z nimi,
   zredagowane; nic tu nie usuwa dokumentacji, której klasa nie pozwala usunąć. */
function eraseComments(db, ids, removedEntryIds, needles, counters) {
  const out = { byAuthor: 0, withEntry: 0, redacted: 0, remaining: 0 };
  if (!db.data.logComments) return out;
  const col = db.col('logComments');
  if (!col.length) return out;
  const keep = [];
  for (const c of col) {
    if (ids.includes(c.userId)) { out.byAuthor++; continue; }
    if (removedEntryIds.has(c.entryId)) { out.withEntry++; continue; }
    const next = redactWords(c.text, needles);
    if (next !== null) { c.text = next; out.redacted++; counters.textRedacted++; }
    keep.push(c);
  }
  if (out.byAuthor || out.withEntry) db.data.logComments = keep;
  out.remaining = keep.length;
  return out;
}

/** Wykonuje art. 17 na jednej osobie zgodnie z tabelą klas. Zwraca protokół z licznikami. */
function eraseSubject(db, { user, student }) {
  const ids = [user && user.id, student && student.id].filter(Boolean);
  const pseudo = pseudonymFor(ids[0]);
  const needles = needlesFor([user, student]);
  const counters = { textRedacted: 0 };
  const anonymised = {}; const deleted = {}; const unlinked = {}; const kept = {};
  const byClass = {};
  const catalogue = RET.classifyAll(db);
  const uncovered = [];
  /* Identyfikatory wierszy, które to żądanie USUNĘŁO — po nich poznajemy osierocone komentarze. */
  const removedEntryIds = new Set();

  for (const entry of catalogue) {
    const name = entry.collection;
    if (name === 'audit') continue;                                   // rejestr zdarzeń — nigdy
    if (name === 'logComments') continue;                             // osobny przebieg, niżej (trzy powiązania)
    if (entry.uncovered) { uncovered.push(name); continue; }
    if (entry.absent || !db.data[name]) continue;
    const action = entry.erasure;
    if (action === 'keep') { kept[entry.class] = kept[entry.class] || { collections: [], reason: entry.erasureReason }; kept[entry.class].collections.push(name); continue; }
    const col = db.col(name);
    if (!col.length) continue;

    if (action === 'delete') {
      const keep = col.filter((row) => { if (!rowBelongsTo(row, ids)) return true; if (row.id) removedEntryIds.add(row.id); return false; });
      const n = col.length - keep.length;
      if (n) { db.data[name] = keep; deleted[name] = (deleted[name] || 0) + n; byClass[entry.class] = (byClass[entry.class] || 0) + n; }
      /* rozdzielniki: adresata wypisujemy, wiadomości innych osób nie usuwamy */
      let un = 0;
      for (const row of db.col(name)) if (unlinkRow(row, ids)) un++;
      if (un) unlinked[name] = (unlinked[name] || 0) + un;
      continue;
    }
    if (action === 'unlink') {
      let un = 0;
      for (const row of col) if (unlinkRow(row, ids)) un++;
      if (un) { unlinked[name] = (unlinked[name] || 0) + un; byClass[entry.class] = (byClass[entry.class] || 0) + un; }
      continue;
    }
    /* action === 'anonymise' — wiersz zostaje, tożsamość znika */
    let n = 0;
    for (const row of col) {
      if (!rowBelongsTo(row, ids) && !ids.includes(row.id)) { if (unlinkRow(row, ids)) { unlinked[name] = (unlinked[name] || 0) + 1; } continue; }
      if (anonymiseRow(row, pseudo, needles, counters)) n++;
    }
    if (n) { anonymised[name] = (anonymised[name] || 0) + n; byClass[entry.class] = (byClass[entry.class] || 0) + n; }
  }

  /* Komentarze do wpisów — po całym katalogu, bo dopiero teraz wiadomo, które wpisy zniknęły. */
  const logComments = eraseComments(db, ids, removedEntryIds, needles, counters);
  const lcGone = logComments.byAuthor + logComments.withEntry;
  if (lcGone) { deleted.logComments = (deleted.logComments || 0) + lcGone; byClass['komentarze-do-wpisow'] = (byClass['komentarze-do-wpisow'] || 0) + lcGone; }

  /* Konto i wpis w księdze uczniów: poza pseudonimem trzeba jeszcze unieruchomić dostęp. */
  if (user) {
    Object.assign(user, { name: pseudo, login: util.id('usuniete'), email: null, phone: null, passwordHash: '', blocked: true, erased: true, erasedAt: util.now(), childrenIds: [], title: '' });
    delete user.totpSecret; delete user.totpPendingSecret; delete user.privateKey; delete user.publicKey; delete user.preferences; delete user.quietHours;
  }
  if (student) {
    Object.assign(student, { pesel: null, birthDate: null, birthPlace: null, birthPlaceLocative: null, address: null, parentIds: [], guardians: [], guardianContact: null, status: 'erased', erased: true, erasedAt: util.now(), achievements: [] });
    /* D3-14: odejście ucznia jest też zdarzeniem retencyjnym — bez daty zegar klasy PPP nigdy nie ruszy. */
    if (!student.departureDate) student.departureDate = String(util.now()).slice(0, 10);
  }
  db.save();

  const sum = (o) => Object.values(o).reduce((n, v) => n + v, 0);
  return {
    pseudonym: pseudo, needles: needles.length, ids,
    anonymised, deleted, unlinked, kept, byClass, uncovered,
    textRedacted: counters.textRedacted, logComments,
    totals: { anonymised: sum(anonymised), deleted: sum(deleted), unlinked: sum(unlinked), classes: Object.keys(byClass).length },
    /* kształt sprzed rundy 3 — karta IOD i testy czytają `removed.collections` */
    collections: Object.assign({}, deleted),
    messages: (deleted.messages || 0) + (unlinked.messages || 0),
    sessions: deleted.sessions || 0
  };
}

function register(r, app) {
  /* Protokół usunięcia danych jest wpisem rejestru zdarzeń, ale listuje go wyłącznie ta trasa i
     wyłącznie IOD-owi oraz administratorowi — bramka komentarzy jest dokładnie tą bramką. Sam wpis
     zostaje zamrożony (S-15): komentarz żyje obok, w `logComments`. */
  LA.register('erasures', {
    label: 'Protokoły usunięcia danych (RODO art. 17)', roles: ['dpo', 'admin'],
    find: (db, user, id) => { const e = db.get('audit', id); return e && e.action === 'right_to_be_forgotten' ? e : null; }
  });

  r.get('/api/privacy/trackers', (ctx) => scanTrackers(ctx.app), { roles: ['dpo', 'admin'] });

  /** Co art. 17 robi z którą klasą — czytane przez ekran IOD i przez dokumenty zgodności (F2). */
  r.get('/api/privacy/erasure-policy', (ctx) => describeErasure(ctx.db), { roles: ['dpo', 'admin', 'principal'] });

  r.post('/api/privacy/forget', (ctx) => {
    const db = ctx.db; const b = ctx.body || {};
    const user = b.userId ? db.get('users', b.userId) : null;
    const student = b.studentId ? db.get('students', b.studentId) : (user && user.studentId ? db.get('students', user.studentId) : null);
    if (!user && !student) throw httpError(404, 'Nie ma takiego konta ani ucznia.', { code: 'not_found' });
    if (user && user.id === ctx.user.id) throw httpError(400, 'Nie można usunąć danych własnego konta z poziomu tego widoku.', { code: 'self' });
    const isTest = !!((user && user.testAccount) || (student && student.testAccount));
    if (!isTest && b.force !== true) throw httpError(403, 'Usunięcie danych wykonujemy na kontach testowych. Dla konta rzeczywistego wymagana jest decyzja administratora danych (pole force).', { code: 'not_a_test_account' });
    const reason = String(b.reason || '').trim();
    if (!reason) throw httpError(400, 'Podaj podstawę żądania (np. „wniosek o usunięcie danych – RODO art. 17”).', { code: 'no_reason' });

    const auditBefore = db.col('audit').length;
    const removed = eraseSubject(db, { user, student });
    const policy = describeErasure(db);

    /* Rejestr zdarzeń zostaje nietknięty — to ten wpis jest protokołem usunięcia danych. */
    ctx.audit({
      action: 'right_to_be_forgotten', entity: 'user', entityId: (user && user.id) || (student && student.id),
      before: null,
      after: {
        removed: { collections: removed.collections, messages: removed.messages, sessions: removed.sessions },
        anonymised: removed.anonymised, deleted: removed.deleted, unlinked: removed.unlinked,
        byClass: removed.byClass, totals: removed.totals, textRedacted: removed.textRedacted,
        logComments: removed.logComments,
        pseudonym: removed.pseudonym, needles: removed.needles,
        auditRedacted: 0, auditTouched: false, testAccount: isTest, force: b.force === true,
        uncoveredCollections: removed.uncovered
      },
      reason
    });
    return {
      ok: true, erasedUserId: user ? user.id : null, erasedStudentId: student ? student.id : null,
      pseudonym: removed.pseudonym, removed,
      erasurePolicy: { anonymised: policy.anonymised.map((c) => c.class), deleted: policy.deleted.map((c) => c.class), neverTouched: policy.neverTouched.map((c) => c.class), rule: policy.rule },
      audit: { rowsBefore: auditBefore, rowsAfter: db.col('audit').length, redacted: 0, touched: false, note: 'Rejestr zdarzeń nie jest redagowany. Ten protokół usunięcia danych sam jest w nim wpisem — tak wygląda rozliczalność z art. 5 ust. 2 RODO.' },
      note: `Dokumentacja archiwalna (${policy.anonymised.map((c) => c.category).filter((v, i, a) => a.indexOf(v) === i).join(', ')}) została zanonimizowana, nie usunięta: oceny, frekwencja i daty zostają, imion i nazwisk w nich nie ma. Usunięto wyłącznie klasy operacyjne.`,
      confirmation: `Dane usunięto ${util.fmtDate(util.now())}. Podstawa: ${reason}.`
    };
  }, { roles: ['dpo', 'admin'] });

  r.get('/api/privacy/erasures', (ctx) => {
    const erasures = ctx.db.col('audit').filter((e) => e.action === 'right_to_be_forgotten').map((e) => ({ id: e.id, at: e.at, byUserId: e.userId, entityId: e.entityId, reason: e.reason, summary: e.after })).sort((a, b) => (a.at < b.at ? 1 : -1));
    return { erasures, comments: LC.countsFor(ctx.db, ctx.user, 'erasures', erasures.map((e) => e.id)) };
  }, { roles: ['dpo', 'admin'] });
}
module.exports = { register, scanTrackers, describeErasure, personalCollections, eraseSubject, pseudonymFor, needlesFor, isWholeValue, redactWords, NEEDLE_FIELDS, MIN_NEEDLE };
