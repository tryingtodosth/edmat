'use strict';
/* Powiadomienia w dzienniku — wspólne dla wszystkich ról.
   Cisza nocna (users[].quietHours {from,to}) wstrzymuje powiadomienie push do końca okna;
   powiadomienia kryzysowe (crisis) przechodzą zawsze.

   Dostarczanie push (Web Push, RFC 8030/8291/8292) robi `server/lib/webpush.js` — bez żadnej
   zależności npm i bez SDK dostawcy. Tu jest wszystko, co wokół: rejestr subskrypcji, kolejka
   z ponawianiem, rejestr doręczeń (`pushDeliveries`) i zwalnianie powiadomień odłożonych przez
   ciszę nocną. Wyłącznik jest jeden: `config.push.enabled` (domyślnie false) — przy wyłączonym
   push z procesu nie wychodzi ani jeden bajt. Szczegóły i prywatność: docs/PUSH.md. */
const { httpError } = require('../lib/router');
const util = require('../lib/util');
const D = require('../lib/domain');
const webpush = require('../lib/webpush');
const { audit } = require('../lib/audit');

/* GAP-7 — jedna droga powiadomień. Cisza nocna, deduplikacja i `deliverAt` mieszkają teraz
   w `server/lib/domain.js` (`D.notify`), żeby `D.notify` i `createNotification` nie mogły się
   rozjechać: przedtem pierwsza nie znała ciszy nocnej, a druga ją honorowała, więc opiekun był
   wyciszony tylko w połowie dziennika. Tutaj zostaje to, co należy do warstwy tras — kolejka
   Web Push — podpięta przez `D.onNotify`, oraz cienkie opakowania dla zgodności wstecz. */

/** Czy godzina „GG:MM” mieści się w oknie ciszy (obsługa okna przez północ). */
function inQuietHours(time, q) {
  if (!q || !q.from || !q.to) return false;
  if (q.from === q.to) return false;
  return q.from < q.to ? (time >= q.from && time < q.to) : (time >= q.from || time < q.to);
}
function quietHoursOf(db, user) { return (user && user.quietHours) || null; }
/**
 * Koniec ciszy nocnej po instancie `at` — moment dostarczenia odłożonego powiadomienia.
 * Liczony w strefie szkoły, więc okno przez północ (21:00–06:30) kończy się rano następnego dnia,
 * a w noc zmiany czasu „06:30” to naprawdę 6:30 na ścianie, nie 5:30 ani 7:30.
 */
const endOfQuiet = D.endOfQuiet;
/** Zgodność wstecz: obie nazwy prowadzą do tej samej ścieżki w server/lib/domain.js. */
const createNotification = (db, userId, kind, text, opts) => D.notify(db, userId, kind, text, opts);
/* Wiersz z `push:true`, który nie czeka na koniec ciszy, trafia od razu do kolejki wysyłki;
   przy okazji sprawdzamy, czy coś odłożonego już nie dojrzało. */
D.onNotify((db, n) => {
  if (!n) return;
  if (n.push && !n.deferred) enqueuePush(db, n);
  else sweepDeferred(db);
});
function view(n) { return { id: n.id, kind: n.kind, text: n.text, at: n.at, read: !!n.read, crisis: !!n.crisis, link: n.link || null, deferred: !!n.deferred, deliverAt: n.deliverAt || n.at, push: !!n.push }; }

/* ==================================================================== dostarczanie Web Push ====
   Kolejka żyje w procesie (WeakMap po instancji bazy — testy uruchamiają wiele serwerów obok
   siebie). Trwały ślad jest w bazie: każda próba to wiersz `pushDeliveries`, więc po restarcie
   widać, co poszło, a co nie, nawet jeśli sama kolejka zniknęła razem z procesem. */
const PUSH_DEFAULTS = { enabled: false, ttl: 86400, maxAttempts: 5, releaseWindowHours: 24, payload: 'minimal', jitterSeconds: 0 };
/** Kopia konfiguracji push z domyślnymi wartościami — nigdy nie modyfikujemy jej w miejscu. */
function pushConfig(db) { return Object.assign({}, PUSH_DEFAULTS, (db.data.config && db.data.config.push) || {}); }
/**
 * Klucze VAPID NIE mogą mieszkać w `db.data.config`: cały config (poza dwoma polami wyciętymi
 * w server/index.js) jedzie do każdego zalogowanego klienta w `/api/auth/session`, a klucz
 * prywatny szkoły pozwoliłby wysyłać powiadomienia w jej imieniu. Trzymamy je więc w osobnej
 * kolekcji `pushKeys` (jeden wiersz, id `vapid`); w konfiguracji zostaje wyłącznie to, co
 * publiczne: włącznik, kontakt `mailto:` i klucz publiczny.
 */
function vapidKeys(db) { return db.get('pushKeys', 'vapid'); }
/** Push działa dopiero, gdy szkoła go włączyła I ma klucze VAPID. Inaczej: cisza, bez wyjątku. */
function pushEnabled(db) { const k = vapidKeys(db); return !!(pushConfig(db).enabled && k && k.publicKey && k.privateKey); }
/** Klucze VAPID powstają raz, przy włączaniu push (kreator albo administrator), i zostają w bazie. */
function ensureVapid(db, subject) {
  const school = db.data.config.school || {};
  const want = subject || pushConfig(db).subject || (school.email ? 'mailto:' + school.email : 'mailto:admin@example.invalid');
  let row = vapidKeys(db);
  if (!row || !row.publicKey || !row.privateKey) {
    const gen = webpush.generateVapidKeys(want);
    if (row) db.remove('pushKeys', 'vapid');
    row = db.insert('pushKeys', { id: 'vapid', publicKey: gen.publicKey, privateKey: gen.privateKey, subject: gen.subject, createdAt: gen.createdAt });
  } else if (row.subject !== want) { row.subject = want; }
  const cfg = Object.assign({}, PUSH_DEFAULTS, db.data.config.push || {});
  delete cfg.vapid;                     // starsze instalacje: klucz nigdy więcej w konfiguracji
  cfg.subject = row.subject; cfg.publicKey = row.publicKey;
  db.data.config.push = cfg; db.save();
  return { publicKey: row.publicKey, privateKey: row.privateKey, subject: row.subject };
}
/* Tytuł powiadomienia na ekranie blokady — w OBU językach, bo od R6 składa go serwer w odpowiedzi
   na `GET /api/notifications/:id/render`, a nie ładunek push. Ładunek nie niesie już ani tytułu,
   ani treści (patrz `pushPayload`). */
const PUSH_TITLES = {
  pl: {
    absence: 'Nieobecność w szkole', message: 'Nowa wiadomość', excuse: 'Usprawiedliwienie',
    grade: 'Nowa ocena', timetable: 'Zmiana w planie lekcji', library: 'Biblioteka',
    payment: 'Płatność', cafeteria: 'Stołówka', trip: 'Wycieczka', meeting: 'Spotkanie',
    homework: 'Zadanie domowe', rights: 'Uprawnienia konta', ack: 'Potwierdzenie odbioru',
    test: 'Powiadomienie testowe'
  },
  en: {
    absence: 'Absence from school', message: 'New message', excuse: 'Absence note',
    grade: 'New grade', timetable: 'Timetable change', library: 'Library',
    payment: 'Payment', cafeteria: 'Canteen', trip: 'School trip', meeting: 'Meeting',
    homework: 'Homework', rights: 'Account permissions', ack: 'Confirmation of receipt',
    test: 'Test notification'
  }
};
/* Które rodzaje powiadomień w ogóle wolno wysłać na ekran blokady. Lista jest pozytywna:
   nowy, nieznany rodzaj nie zacznie po cichu wyświetlać się nad zablokowanym telefonem. Szkoła
   może ją zawęzić albo poszerzyć przez `config.push.kinds`. Sprawa kryzysowa (dziś: nieobecność
   na 1. lekcji) idzie zawsze — po to jest. */
const PUSH_KINDS = ['absence', 'timetable', 'excuse', 'payment', 'cafeteria', 'trip', 'meeting', 'library', 'homework', 'ack', 'message', 'test'];
/* Rodzaje, które szkoła podnosi do sprawy kryzysowej (`crisis: true`): nieobecność na 1. lekcji
   u opiekuna i alert frekwencyjny u pedagoga. JEDNA lista po obu stronach — `public/sw.js` ma jej
   kopię (`CRISIS_KINDS`) i `tests/48-push.test.js` pilnuje, że są identyczne. Service worker
   potrzebuje jej wtedy, gdy nie dostał flagi w ładunku (starszy ładunek `v:2` jej nie niósł), żeby
   alert nie wyświetlił się jak zwykłe powiadomienie — bez wibracji i bez „· pilne”.
   Bycie na tej liście NIE czyni rodzaju wysyłalnym: o tym decyduje wyłącznie PUSH_KINDS. */
const CRISIS_KINDS = ['absence', 'attendance-alert'];
/* Co naprawdę widać na ekranie blokady. Powiadomienie w dzienniku niesie treść, która bywa
   prywatna — temat wiadomości („Prośba o rozmowę — sytuacja rodzinna”), powód nieobecności, kwotę
   zaległości za obiady, imię i nazwisko ucznia. Ekran blokady widzi każdy, kto stoi obok telefonu,
   więc na niego idzie zdanie neutralne dla KAŻDEGO rodzaju; szczegóły czekają w dzienniku.
   Zasada (pilnowana testem): żaden wiersz nie nazywa ucznia, nie podaje kwoty ani powodu. */
const PUSH_NEUTRAL = {
  pl: {
    absence: 'Nowy wpis o frekwencji. Szczegóły zobaczysz w dzienniku.',
    message: 'Masz nową wiadomość w dzienniku. Treść otworzysz po zalogowaniu.',
    excuse: 'Jest nowa informacja o usprawiedliwieniu. Szczegóły w dzienniku.',
    grade: 'Jest nowa ocena. Zobaczysz ją po zalogowaniu.',
    timetable: 'Zmiana w planie lekcji. Szczegóły w dzienniku.',
    library: 'Nowa informacja z biblioteki. Szczegóły w dzienniku.',
    payment: 'Nowa informacja o płatności. Szczegóły w dzienniku.',
    cafeteria: 'Nowa informacja ze stołówki. Szczegóły w dzienniku.',
    trip: 'Nowa informacja o wycieczce. Szczegóły w dzienniku.',
    meeting: 'Nowa informacja o spotkaniu. Szczegóły w dzienniku.',
    homework: 'Nowa informacja o zadaniu domowym. Szczegóły w dzienniku.',
    rights: 'Zmieniły się uprawnienia konta. Szczegóły po zalogowaniu.',
    ack: 'Wiadomość czeka na potwierdzenie odbioru. Otwórz dziennik.',
    test: 'Powiadomienie testowe z dziennika. Jeśli je widzisz, push działa na tym urządzeniu.'
  },
  en: {
    absence: 'A new attendance entry. Open the logbook for the details.',
    message: 'You have a new message in the logbook. Sign in to read it.',
    excuse: 'There is news about an absence note. Open the logbook for the details.',
    grade: 'There is a new grade. Sign in to see it.',
    timetable: 'The timetable has changed. Open the logbook for the details.',
    library: 'News from the library. Open the logbook for the details.',
    payment: 'News about a payment. Open the logbook for the details.',
    cafeteria: 'News from the canteen. Open the logbook for the details.',
    trip: 'News about a school trip. Open the logbook for the details.',
    meeting: 'News about a meeting. Open the logbook for the details.',
    homework: 'News about homework. Open the logbook for the details.',
    rights: 'Your account permissions have changed. Sign in for the details.',
    ack: 'A message is waiting for a confirmation of receipt. Open the logbook.',
    test: 'A test notification from the logbook. If you can see it, push works on this device.'
  }
};
/** Zdanie dla rodzaju, którego nie ma w tabelce — nadal neutralne, nigdy treść z dziennika. */
const PUSH_NEUTRAL_FALLBACK = {
  pl: 'Masz nowe powiadomienie. Otwórz dziennik, żeby zobaczyć szczegóły.',
  en: 'You have a new notification. Open the logbook for the details.'
};
/** Język odpowiedzi: to, o co poprosił service worker, a jak nie poprosił — język konta. */
function localeOf(user, asked) { return asked === 'en' || asked === 'pl' ? asked : ((user && user.locale) === 'en' ? 'en' : 'pl'); }
function notificationTitle(kind, crisis, locale) {
  const table = PUSH_TITLES[locale] || PUSH_TITLES.pl;
  return (table[kind] || (locale === 'en' ? 'Notification' : 'Powiadomienie')) + (crisis ? (locale === 'en' ? ' · urgent' : ' · pilne') : '');
}
function notificationBody(n, locale) {
  const table = PUSH_NEUTRAL[locale] || PUSH_NEUTRAL.pl;
  /* Nigdy `n.text`: to jest zdanie z dziennika i to właśnie ono nazywa ucznia (S3-16, D3-34). */
  return String(table[n.kind] || PUSH_NEUTRAL_FALLBACK[locale] || PUSH_NEUTRAL_FALLBACK.pl).slice(0, 300);
}
/**
 * To, co service worker naprawdę pokaże: tytuł, treść i odnośnik — złożone TUTAJ, po zalogowanym
 * kanale szkoły, a nie w ładunku, który przechodzi przez cudzy serwer.
 */
function renderNotification(n, locale) {
  return {
    id: n.id, kind: n.kind, locale,
    title: notificationTitle(n.kind, n.crisis, locale),
    body: notificationBody(n, locale),
    link: n.link || '/', crisis: !!n.crisis, at: n.at, read: !!n.read
  };
}
/**
 * Czy ten wiersz w ogóle opuszcza szkołę jako powiadomienie na telefon.
 *
 * Lista jest POZYTYWNA i sprawdzana jako pierwsza — także dla sprawy kryzysowej. Do tej rundy
 * `if (n.crisis) return true;` omijało ją w całości, więc alert frekwencyjny pedagoga
 * (`attendance-alert`: „Uczeń objęty pomocą społeczną: <imię nazwisko> …”) trafiał na ekran
 * blokady z pełną treścią, o każdej porze i z `Urgency: high` (D3-33). Kryzys omija wyłącznie
 * ciszę nocną — i to robi `D.notify`, nie ta funkcja.
 *
 * `config.push.kinds` może listę wyłącznie ZAWĘZIĆ (D3-37): szkoła, która wpisze tam
 * `['gabinet','speech']`, nie zacznie wysyłać powiadomień z gabinetu pielęgniarki.
 */
function pushableKind(db, n) {
  const cfg = pushConfig(db).kinds;
  const kinds = Array.isArray(cfg) ? cfg.filter((k) => PUSH_KINDS.includes(k)) : PUSH_KINDS;
  return kinds.includes(n.kind);
}
/* Co jedzie w zaszyfrowanym ładunku (R6, raport Gemini #20).
   `minimal` (domyślnie): `{v, kind, id, ts}` — ani imienia, ani przedmiotu, ani jednego zdania
   treści. Service worker po odebraniu pyta szkołę `GET /api/notifications/:id/render` i dopiero
   stamtąd bierze tytuł i treść; pośrednik widzi wyłącznie szyfrogram stałej, kilkudziesięciobajtowej
   wielkości. `neutral` przywraca stan sprzed R6 (tytuł + neutralna treść + odnośnik w ładunku) dla
   szkoły, która woli, żeby powiadomienie pokazało się także wtedy, gdy telefon nie ma zasięgu do
   szkolnego serwera — kosztem tego, że treść trafia (zaszyfrowana, ale jednak) do ładunku, który
   przechodzi przez FCM/APNs i leży w kolejce pośrednika do końca TTL. */
const PAYLOAD_MODES = ['minimal', 'neutral'];
function payloadMode(db) { return pushConfig(db).payload === 'neutral' ? 'neutral' : 'minimal'; }
function pushPayload(n, db) {
  if (db && payloadMode(db) === 'neutral') {
    return {
      title: notificationTitle(n.kind, n.crisis, 'pl'),
      body: notificationBody(n, 'pl'),
      link: n.link || '/',
      tag: n.id, kind: n.kind, crisis: !!n.crisis, at: n.at
    };
  }
  /* `crisis` to jeden bit, a nie dana osobowa: pośrednik i tak widzi `Urgency: high`. Bez niego
     service worker, który nie zdołał dopytać szkoły o treść (brak sieci, wygasła sesja), pokazywał
     alert o nieobecności na 1. lekcji jak zwykłe powiadomienie — bez wibracji, bez `renotify`
     i bez dopisku „· pilne”, czyli milczał dokładnie w tym przypadku, dla którego istnieje
     (D3-35). */
  return { v: 2, kind: n.kind, id: n.id, ts: Date.parse(n.at) || Date.now(), crisis: !!n.crisis };
}
/* ==================================================================== indeks powiadomień ======
   R3-10. Po porannym zamiataniu nieobecności w bazie jest kilkadziesiąt tysięcy wierszy
   `notifications`, a każdy telefon, który dostał push, zaraz potem pyta `GET …/:id/render`.
   `db.get('notifications', id)` to liniowe `arr.find` (4 ms przy 80 000 wierszy), a `unread-count`
   i `feed` filtrują całą kolekcję — 600 jednoczesnych renderów blokowało proces na 4,2 s.
   Magazyn nie ma indeksu po id (server/lib/store.js: `get` = `arr.find`), więc trzymamy go tutaj:
   dwie mapy (id → pozycja, konto → pozycje) budowane PRZYROSTOWO — nowe wiersze dopisujemy przy
   następnym odczycie, nie przebudowując niczego. Pozycję sprawdzamy przy każdym odczycie
   (`row.id === id`); gdy kolekcja się skurczyła albo wiersze się przesunęły (usunięcie przez
   art. 17), indeks budujemy od nowa — poprawność nie zależy od tego, kto i jak usuwa wiersze. */
const INDEX = new WeakMap();
function rebuildIndex(ix, col) {
  ix.byId.clear(); ix.byUser.clear(); ix.deferred.clear(); ix.scanned = 0;
  scanInto(ix, col);
}
function scanInto(ix, col) {
  for (let i = ix.scanned; i < col.length; i++) {
    const n = col[i]; if (!n) continue;
    ix.byId.set(n.id, i);
    const list = ix.byUser.get(n.userId); if (list) list.push(i); else ix.byUser.set(n.userId, [i]);
    if (n.deferred && !n.pushQueuedAt) ix.deferred.add(n.id);
  }
  ix.scanned = col.length;
  ix.tailId = col.length ? col[col.length - 1].id : null;
}
/**
 * Indeks zgodny z kolekcją, w stałym czasie. Nowe wiersze dopisujemy przyrostowo; krótsza
 * kolekcja albo INNY ostatni wiersz przy tej samej długości (usunięcie i dopisanie między dwoma
 * odczytami) oznaczają, że pozycje się przesunęły — wtedy budujemy indeks od nowa.
 */
function noteIndex(db) {
  const col = db.col('notifications');
  let ix = INDEX.get(db);
  if (!ix) { ix = { byId: new Map(), byUser: new Map(), deferred: new Set(), scanned: 0, tailId: null }; INDEX.set(db, ix); }
  if (col.length < ix.scanned) rebuildIndex(ix, col);
  else if (col.length > ix.scanned) scanInto(ix, col);
  else if (col.length && col[col.length - 1].id !== ix.tailId) rebuildIndex(ix, col);
  return ix;
}
/** Powiadomienie po id — jedno odpytanie mapy zamiast przejścia całej kolekcji. */
function notificationById(db, id) {
  const col = db.col('notifications');
  const i = noteIndex(db).byId.get(id);
  const row = i === undefined ? null : col[i];
  return row && row.id === id ? row : null;
}
/** Powiadomienia konta — pozycje z indeksu, bez filtrowania całej kolekcji. */
function notificationsOf(db, userId) {
  const col = db.col('notifications');
  const ix = noteIndex(db);
  const pos = ix.byUser.get(userId) || [];
  const out = []; let drift = false;
  for (const i of pos) { const n = col[i]; if (n && n.userId === userId) out.push(n); else drift = true; }
  if (!drift) return out;
  /* Wiersze się przesunęły (usunięcie) — jedno przebudowanie i odpowiadamy z pewnego indeksu. */
  rebuildIndex(ix, col);
  return (ix.byUser.get(userId) || []).map((i) => col[i]).filter((n) => n && n.userId === userId);
}
const QUEUES = new WeakMap();
function pushState(db) {
  if (!QUEUES.has(db)) QUEUES.set(db, { jobs: [], running: null, timer: null, timerAt: 0, sweptAt: 0 });
  return QUEUES.get(db);
}
/** Odstępy kolejnych prób: 1 s, 5 s, 30 s, 2 min, 10 min — po `maxAttempts` wiersz to `failed`. */
const BACKOFF = [1000, 5000, 30000, 120000, 600000];
function backoffMs(attempts, retryAfterSec) {
  const base = BACKOFF[Math.min(attempts, BACKOFF.length) - 1] || BACKOFF[BACKOFF.length - 1];
  return Math.max(base, (+retryAfterSec || 0) * 1000);
}
/** Subskrypcje konta, które da się zaszyfrować (stare zaślepki bez kluczy pomijamy). */
function liveSubscriptions(db, userId) {
  return db.find('pushSubscriptions', (p) => p.userId === userId && !p.revoked && p.keys && p.keys.p256dh && p.keys.auth);
}
/** Wstawia po jednym wierszu `pushDeliveries` na subskrypcję i budzi kolejkę. */
function enqueuePush(db, n, opts) {
  const o = opts || {};
  if (!n || !pushEnabled(db) || !pushableKind(db, n)) return [];
  const subs = liveSubscriptions(db, n.userId);
  const made = [];
  /* Rozrzut czasowy (`config.push.jitterSeconds`, domyślnie 0 = wyłączony). Cisza nocna i przepustka
     kryzysowa zostają nietknięte — sprawa kryzysowa NIGDY nie czeka. Losujemy raz na powiadomienie,
     nie raz na urządzenie, żeby wszystkie telefony jednego konta zabrzęczały razem. */
  const delay = pushDelay(db, n);
  for (const s of subs) {
    const d = db.insert('pushDeliveries', {
      id: util.id('pd'), notificationId: n.id, userId: n.userId, subscriptionId: s.id, endpoint: s.endpoint,
      status: 'pending', at: util.now(), attempts: 0, code: null, error: null, kind: n.kind, crisis: !!n.crisis,
      /* zapamiętany termin rozrzutu — po restarcie `resumePending` wraca do niego zamiast wysyłać burzą */
      notBefore: delay ? new Date(Date.now() + delay).toISOString() : null
    });
    pushState(db).jobs.push({
      deliveryId: d.id, payload: pushPayload(n, db), notBefore: delay ? Date.now() + delay : 0,
      urgency: o.urgency || (n.crisis ? 'high' : 'normal'), ttl: o.ttl == null ? pushConfig(db).ttl : o.ttl, topic: o.topic || null
    });
    made.push(d);
  }
  const row = notificationById(db, n.id) || db.get('notifications', n.id);
  if (row) { row.pushQueuedAt = util.now(); row.pushTargets = subs.length; }
  db.save();
  if (made.length) schedulePump(db, delay);
  return made;
}
/** Ile milisekund poczekać z wysyłką tego powiadomienia. Kryzys: zero, zawsze. */
function pushDelay(db, n) {
  if (n.crisis) return 0;
  const jitter = Math.max(0, Math.min(+pushConfig(db).jitterSeconds || 0, 3600));
  if (!jitter) return 0;
  const delay = Math.floor(Math.random() * (jitter * 1000 + 1));
  /* Cisza nocna jest rozstrzygana raz, przy tworzeniu powiadomienia (`D.notify`), a rozrzut losuje
     się dopiero tutaj — więc powiadomienie z 20:58 potrafiło zabrzęczeć o 21:58, w środku okna
     ciszy (D3-36). Chwilę dostarczenia sprawdzamy w strefie SZKOŁY (`D.inQuietHours` liczy po
     `config.timezone`, nie po zegarze serwera) i gdy wypada w ciszy, wysyłamy od razu: „teraz”
     z definicji jest poza oknem, bo inaczej powiadomienie byłoby odłożone. */
  const u = db.get('users', n.userId);
  if (u && u.quietHours && D.inQuietHours(u, db, new Date(Date.now() + delay).toISOString())) return 0;
  return delay;
}
/**
 * R3-11 — kolejka z rozrzutem przeżywa restart. Zadanie czeka w pamięci procesu, ale jego ślad,
 * wiersz `pushDeliveries` ze statusem `pending`, jest w bazie: po starcie (przy pierwszym zamiataniu)
 * wracamy do tych wierszy i albo kolejkujemy je jeszcze raz — z zapamiętanym `notBefore`, żeby
 * rozrzut nie zaczynał się od zera — albo, gdy powiadomienie wypadło już z okna `releaseWindowHours`,
 * zamykamy wiersz jako `failed` z powodem. „Pending na zawsze” czytałoby się jak „wysłaliśmy
 * i nie znamy odpowiedzi”, a to nieprawda: nigdy nie wyszło.
 */
function resumePending(db) {
  const st = pushState(db);
  if (st.resumed) return 0;
  st.resumed = true;
  const cfg = pushConfig(db);
  const windowMs = (cfg.releaseWindowHours || 24) * 3600 * 1000;
  const queued = new Set(st.jobs.map((j) => j.deliveryId));
  let back = 0, closed = 0;
  for (const d of db.find('pushDeliveries', (x) => x.status === 'pending')) {
    if (queued.has(d.id)) continue;
    const n = db.get('notifications', d.notificationId);
    const age = n ? Date.now() - (Date.parse(n.deliverAt || n.at) || 0) : Infinity;
    if (!n || age > windowMs) {
      d.status = 'failed'; d.at = util.now();
      d.error = n ? 'restart procesu poza oknem zwalniania — nie wysłano' : 'powiadomienia już nie ma — nie wysłano';
      closed++; continue;
    }
    st.jobs.push({
      deliveryId: d.id, payload: pushPayload(n, db), notBefore: Date.parse(d.notBefore || '') || 0,
      urgency: n.crisis ? 'high' : 'normal', ttl: cfg.ttl, topic: null
    });
    back++;
  }
  if (back || closed) db.save();
  if (back) schedulePump(db, Math.min.apply(null, st.jobs.map((j) => j.notBefore)) - Date.now());
  return back;
}
/* Budzik kolejki. Od czasu, gdy zadanie może mieć własny rozrzut (`jitterSeconds`), „jest już
   budzik” NIE wystarczy: gdyby alert kryzysowy trafił na nastawiony na 10 minut budzik zwykłego
   powiadomienia, czekałby razem z nim. Wcześniejszy termin zawsze wygrywa. */
function schedulePump(db, delay) {
  const st = pushState(db);
  const when = Date.now() + Math.max(0, delay || 0);
  if (st.timer) { if (st.timerAt <= when) return; clearTimeout(st.timer); st.timer = null; }
  st.timerAt = when;
  st.timer = setTimeout(() => { st.timer = null; runPump(db).catch(() => {}); }, Math.max(0, delay || 0));
  if (st.timer.unref) st.timer.unref();               // kolejka nigdy nie trzyma procesu przy życiu
}
/** Wykonuje zadania, których czas nadszedł; `force` pomija odczekiwanie (używane w testach). */
function runPump(db, force) {
  const st = pushState(db);
  if (st.running) return st.running;
  st.running = (async () => {
    /* Zadania, których czas nadszedł, zdejmujemy JEDNYM ruchem. Gdyby pętla czytała listę na
       bieżąco, zadanie odłożone po nieudanej próbie wróciłoby do niej natychmiast i cały odstęp
       między próbami przepadłby w jednym przebiegu. */
    const now = Date.now();
    const due = [];
    for (let i = 0; i < st.jobs.length;) { if (force || st.jobs[i].notBefore <= now) due.push(st.jobs.splice(i, 1)[0]); else i++; }
    for (const job of due) await deliverJob(db, job);
    if (st.jobs.length) schedulePump(db, Math.min.apply(null, st.jobs.map((j) => j.notBefore)) - Date.now());
  })();
  const p = st.running.then(() => { st.running = null; }, () => { st.running = null; });
  return p;
}
async function deliverJob(db, job) {
  const cfg = pushConfig(db);
  const d = db.get('pushDeliveries', job.deliveryId); if (!d) return;
  const sub = db.get('pushSubscriptions', d.subscriptionId);
  if (!sub || sub.revoked) { d.status = 'gone'; d.at = util.now(); d.error = 'subskrypcja wycofana'; db.save(); return; }
  d.attempts = (d.attempts || 0) + 1;
  let res;
  try {
    res = await webpush.sendPush({ endpoint: sub.endpoint, keys: sub.keys }, job.payload, { ttl: job.ttl, urgency: job.urgency, topic: job.topic, vapid: vapidKeys(db) });
  } catch (e) { res = { ok: false, status: 0, gone: false, retry: false, error: String((e && e.message) || e) }; }
  d.at = util.now(); d.code = res.status || 0; d.error = res.error || null; d.bytes = res.bytes || null;
  if (res.ok) d.status = 'sent';
  else if (res.gone) {
    /* 404/410 = subskrypcja już nie istnieje (wyczyszczone dane przeglądarki, odinstalowana
       aplikacja). Trzymanie jej dalej to tylko adres urządzenia w bazie — usuwamy. */
    d.status = 'gone';
    db.remove('pushSubscriptions', sub.id);
    audit(db, { userId: sub.userId, action: 'push_subscription_gone', entity: 'pushSubscription', entityId: sub.id, before: { host: hostOf(sub.endpoint), device: sub.device || null }, reason: 'Usługa push odpowiedziała ' + res.status + '.' });
  } else if (res.retry && d.attempts < (cfg.maxAttempts || 5)) {
    d.status = 'retry';
    job.notBefore = Date.now() + backoffMs(d.attempts, res.retryAfter);
    pushState(db).jobs.push(job);
    schedulePump(db, backoffMs(d.attempts, res.retryAfter));
  } else d.status = 'failed';
  db.save();
}
/**
 * Powiadomienia odłożone przez ciszę nocną nie mają własnego wątku: sprawdzamy je leniwie —
 * przy każdym żądaniu kanału/API push i przy tworzeniu kolejnego powiadomienia (nie częściej niż
 * raz na 30 s na proces). Zwalniamy tylko to, co dojrzało w ciągu ostatnich `releaseWindowHours`
 * godzin: alert sprzed tygodnia nie ma prawa zabrzęczeć w telefonie po włączeniu push.
 */
function sweepDeferred(db, force) {
  const st = pushState(db);
  const nowMs = Date.now();
  if (pushEnabled(db)) resumePending(db);              // po restarcie: kolejka z rozrzutem wraca do gry
  if (!force && nowMs - st.sweptAt < 30000) return 0;
  st.sweptAt = nowMs;
  if (!pushEnabled(db)) return 0;
  const cfg = pushConfig(db);
  const windowMs = (cfg.releaseWindowHours || 24) * 3600 * 1000;
  /* Odłożone powiadomienia mamy w indeksie (zbiór identyfikatorów), więc zamiatanie nie przechodzi
     już całej kolekcji przy każdym żądaniu kanału — R3-10. */
  const ix = noteIndex(db);
  const due = [];
  for (const id of ix.deferred) {
    const n = notificationById(db, id);
    if (!n || !n.deferred || n.pushQueuedAt) { ix.deferred.delete(id); continue; }
    const at = Date.parse(n.deliverAt || n.at);
    if (!(at <= nowMs) || nowMs - at > windowMs) continue;
    due.push(n.id);
  }
  let released = 0;
  for (const id of due) {
    const n = notificationById(db, id); if (!n) { ix.deferred.delete(id); continue; }
    ix.deferred.delete(id);
    n.push = true; n.pushReleasedAt = util.now();
    if (enqueuePush(db, n).length) released++;
    else { n.pushQueuedAt = util.now(); db.save(); }   // brak subskrypcji: nie wracamy do niego co żądanie
  }
  return released;
}
function hostOf(endpoint) { try { return new URL(endpoint).host; } catch (e) { return '?'; } }
/** Skrót adresu subskrypcji do statystyk: host + 8 znaków skrótu, nigdy pełny adres urządzenia. */
function endpointFingerprint(endpoint) {
  return hostOf(endpoint) + '/' + require('node:crypto').createHash('sha256').update(String(endpoint)).digest('hex').slice(0, 8);
}
function subscriptionView(p) { return { id: p.id, device: p.device, at: p.at, host: hostOf(p.endpoint), fingerprint: endpointFingerprint(p.endpoint), encrypted: !!(p.keys && p.keys.p256dh && p.keys.auth) }; }
/** Zapisuje albo odświeża subskrypcję konta; deduplikacja po adresie endpointu. */
function saveSubscription(db, user, b) {
  const endpoint = String(b.endpoint || '').trim();
  if (!endpoint) throw httpError(400, 'Brak adresu subskrypcji push.', { code: 'no_endpoint' });
  if (!/^https?:\/\//i.test(endpoint)) throw httpError(400, 'Adres subskrypcji push musi być adresem HTTPS.', { code: 'bad_endpoint' });
  const keys = b.keys && b.keys.p256dh && b.keys.auth ? { p256dh: String(b.keys.p256dh), auth: String(b.keys.auth) } : null;
  if (keys) {
    /* Bez poprawnych kluczy nie da się zaszyfrować ładunku — lepiej odmówić teraz niż przy wysyłce. */
    if (webpush.unb64url(keys.p256dh).length !== 65) throw httpError(400, 'Klucz p256dh subskrypcji jest nieprawidłowy.', { code: 'bad_p256dh' });
    if (webpush.unb64url(keys.auth).length !== 16) throw httpError(400, 'Sekret auth subskrypcji jest nieprawidłowy.', { code: 'bad_auth' });
  }
  const device = String(b.userAgent || b.device || 'przeglądarka').slice(0, 120);
  const existing = db.one('pushSubscriptions', (p) => p.userId === user.id && p.endpoint === endpoint);
  if (existing) {
    existing.revoked = false; existing.at = util.now(); existing.device = device;
    if (keys) existing.keys = keys;
    db.save();
    return { row: existing, created: false };
  }
  return { row: db.insert('pushSubscriptions', { id: util.id('push'), userId: user.id, endpoint, keys, device, at: util.now(), revoked: false }), created: true };
}

function register(r, app) {
  /* F1/S3-04 — opiekun, któremu sąd zawęził dostęp, nie widzi w kanale wierszy zapisanych
     wcześniej: `D.notificationVisible` odsiewa powiadomienia niosące `studentId`, którego
     dziś nie wolno mu czytać. Dla pracowników szkoły i dla wierszy bez `studentId` helper
     zwraca `true` od razu, więc szybka ścieżka po indeksie zostaje szybka. */
  const mine = (db, userId) => { const u = db.get('users', userId); return notificationsOf(db, userId).filter((n) => D.notificationVisible(db, u, n)); };

  /* Pasek górny odpytuje ten adres co nawigację — musi być tani i dostępny dla każdej roli. */
  r.get('/api/notifications/unread-count', (ctx) => {
    const list = mine(ctx.db, ctx.user.id);
    return { count: list.filter((n) => !n.read).length, crisis: list.filter((n) => !n.read && n.crisis).length };
  }, { noTouch: true });

  r.get('/api/notifications/feed', (ctx) => {
    const db = ctx.db; const now = util.now();
    sweepDeferred(db, true);                           // koniec ciszy nocnej sprawdzamy leniwie, tutaj
    const list = mine(db, ctx.user.id).sort((a, b) => (a.at < b.at ? 1 : -1));
    const limit = +ctx.query.limit || 30;
    const q = quietHoursOf(db, ctx.user);
    return {
      at: now, items: list.slice(0, limit).map(view),
      unread: list.filter((n) => !n.read).length,
      deferredCount: list.filter((n) => n.deferred && Date.parse(n.deliverAt) > Date.parse(now)).length,
      quietHours: q, quietNow: D.inQuietHours(ctx.user, db, now), timezone: D.tz(db), localTime: util.localTime(now, D.tz(db)),
      pushRegistered: db.col('pushSubscriptions').filter((p) => p.userId === ctx.user.id && !p.revoked).length,
      pushEnabled: pushEnabled(db)
    };
  }, { noTouch: true });

  r.get('/api/notifications', (ctx) => {
    const list = mine(ctx.db, ctx.user.id).sort((a, b) => (a.at < b.at ? 1 : -1))
      .filter((n) => (ctx.query.unread === '1' ? !n.read : true))
      .filter((n) => (ctx.query.kind ? n.kind === ctx.query.kind : true));
    return { notifications: list.slice(0, +ctx.query.limit || 50).map(view), unread: mine(ctx.db, ctx.user.id).filter((n) => !n.read).length };
  });

  r.post('/api/notifications/read-all', (ctx) => {
    let n = 0; for (const x of mine(ctx.db, ctx.user.id)) if (!x.read) { x.read = true; x.readAt = util.now(); n++; }
    ctx.db.save(); return { ok: true, marked: n };
  });
  /* R6 — co service worker naprawdę pokaże. Ładunek push niesie sam identyfikator, więc tytuł
     i treść w języku konta wydaje szkoła po zalogowanym kanale. `noTouch`: powiadomienie o 3 w nocy
     nie ma przedłużać 15-minutowej sesji z wieczora. Cudze powiadomienie to 403, nie 404 — po id
     i tak nic nie zgadniesz, a odróżnienie „nie ma” od „nie twoje” ułatwia diagnozę w szkole. */
  r.get('/api/notifications/:id/render', (ctx) => {
    const n = notificationById(ctx.db, ctx.params.id);
    if (!n) throw httpError(404, 'Nie ma takiego powiadomienia.', { code: 'not_found' });
    if (n.userId !== ctx.user.id) throw httpError(403, 'To powiadomienie należy do innego konta.', { code: 'forbidden' });
    return renderNotification(n, localeOf(ctx.user, ctx.query.locale));
  }, { noTouch: true });

  r.post('/api/notifications/:id/read', (ctx) => {
    const n = notificationById(ctx.db, ctx.params.id);
    if (!n || n.userId !== ctx.user.id) throw httpError(404, 'Nie ma takiego powiadomienia.');
    n.read = true; n.readAt = util.now(); ctx.db.save(); return { ok: true, notification: view(n) };
  });

  /* ---- Web Push: klucz serwera, subskrypcje, test, statystyki ------------------------------- */
  /** Klucz publiczny VAPID dla `PushManager.subscribe({ applicationServerKey })`. */
  r.get('/api/push/vapid-public-key', (ctx) => {
    const db = ctx.db; const cfg = pushConfig(db);
    if (!cfg.enabled) return { enabled: false, publicKey: null, note: 'Powiadomienia push są wyłączone w tej szkole.' };
    const vapid = ensureVapid(db);
    return { enabled: true, publicKey: vapid.publicKey, subject: vapid.subject };
  });

  r.post('/api/push/subscribe', (ctx) => {
    const db = ctx.db;
    if (!pushConfig(db).enabled) throw httpError(409, 'Powiadomienia push są wyłączone w tej szkole.', { code: 'push_disabled' });
    const { row, created } = saveSubscription(db, ctx.user, ctx.body || {});
    ctx.audit({ action: created ? 'push_subscribed' : 'push_subscription_refreshed', entity: 'pushSubscription', entityId: row.id, after: { host: hostOf(row.endpoint), device: row.device } });
    sweepDeferred(db, true);
    return { ok: true, created, subscription: subscriptionView(row), subscriptions: liveSubscriptions(db, ctx.user.id).length };
  });

  /** Wypisanie: konkretny adres (body.endpoint / body.id) albo wszystkie subskrypcje konta. */
  r.delete('/api/push/subscribe', (ctx) => {
    const db = ctx.db; const b = ctx.body || {};
    const all = db.find('pushSubscriptions', (p) => p.userId === ctx.user.id);
    const target = b.endpoint ? all.filter((p) => p.endpoint === b.endpoint) : b.id ? all.filter((p) => p.id === b.id) : all;
    for (const p of target) { db.remove('pushSubscriptions', p.id); ctx.audit({ action: 'push_unsubscribed', entity: 'pushSubscription', entityId: p.id, before: { host: hostOf(p.endpoint), device: p.device } }); }
    return { ok: true, removed: target.length, subscriptions: liveSubscriptions(db, ctx.user.id).length };
  });

  r.get('/api/push/subscriptions', (ctx) => ({
    enabled: pushEnabled(ctx.db),
    subscriptions: ctx.db.find('pushSubscriptions', (p) => p.userId === ctx.user.id && !p.revoked).map(subscriptionView)
  }));

  /** Powiadomienie testowe na urządzenia właściciela konta — sprawdza całą drogę, łącznie z kluczami. */
  r.post('/api/push/test', async (ctx) => {
    const db = ctx.db;
    if (!pushEnabled(db)) throw httpError(409, 'Powiadomienia push są wyłączone w tej szkole.', { code: 'push_disabled' });
    const subs = liveSubscriptions(db, ctx.user.id);
    if (!subs.length) throw httpError(400, 'To konto nie ma jeszcze żadnej subskrypcji push.', { code: 'no_subscription' });
    const n = db.insert('notifications', {
      id: util.id('not'), userId: ctx.user.id, kind: 'test', text: 'Powiadomienie testowe z dziennika. Jeśli je widzisz, push działa na tym urządzeniu.',
      at: util.now(), read: false, crisis: false, link: '/ustawienia', push: true, deferred: false, deliverAt: util.now(), quietHours: null, dedupeKey: null
    });
    const made = enqueuePush(db, n, { ttl: 60, urgency: 'normal', topic: 'edmat-test' });
    await runPump(db, true);
    const rows = made.map((d) => db.get('pushDeliveries', d.id)).filter(Boolean);
    return {
      ok: rows.some((d) => d.status === 'sent'), sent: rows.filter((d) => d.status === 'sent').length, tried: rows.length,
      deliveries: rows.map((d) => ({ status: d.status, code: d.code, attempts: d.attempts, endpoint: endpointFingerprint(d.endpoint), error: d.error || null }))
    };
  });

  /** Statystyki dla dyrekcji/administratora: ile poszło, ile czeka, ile odpadło — bez adresów urządzeń. */
  r.get('/api/push/stats', (ctx) => {
    const db = ctx.db; sweepDeferred(db, true);
    const cfg = pushConfig(db); const st = pushState(db);
    const rows = db.col('pushDeliveries');
    const since = ctx.query.since || null;
    const window = since ? rows.filter((d) => d.at >= since) : rows;
    const byStatus = {};
    for (const d of window) byStatus[d.status] = (byStatus[d.status] || 0) + 1;
    const byKind = {};
    for (const d of window) byKind[d.kind || 'inne'] = (byKind[d.kind || 'inne'] || 0) + 1;
    const subs = db.col('pushSubscriptions').filter((p) => !p.revoked);
    const hosts = {};
    for (const p of subs) hosts[hostOf(p.endpoint)] = (hosts[hostOf(p.endpoint)] || 0) + 1;
    return {
      enabled: pushEnabled(db), configured: !!vapidKeys(db), subject: (vapidKeys(db) || {}).subject || null,
      subscriptions: subs.length, subscribers: new Set(subs.map((p) => p.userId)).size, pushServices: hosts,
      deliveries: window.length, byStatus, byKind, queued: st.jobs.length,
      deferredWaiting: [...noteIndex(db).deferred].filter((id) => { const n = notificationById(db, id); return n && n.deferred && !n.pushQueuedAt; }).length,
      last: window.slice(-10).map((d) => ({ at: d.at, status: d.status, code: d.code, attempts: d.attempts, kind: d.kind, endpoint: endpointFingerprint(d.endpoint) }))
    };
  }, { roles: ['admin', 'principal'] });

  /** Włącznik szkoły (kreator pierwszego uruchomienia / administracja). Klucze powstają tutaj. */
  r.post('/api/push/config', (ctx) => {
    const db = ctx.db; const b = ctx.body || {};
    const before = { enabled: pushConfig(db).enabled };
    const cfg = Object.assign({}, PUSH_DEFAULTS, db.data.config.push || {});
    if (b.enabled !== undefined) cfg.enabled = !!b.enabled;
    if (b.ttl !== undefined) cfg.ttl = Math.max(0, Math.min(+b.ttl || 0, 2419200));
    if (b.payload !== undefined) {
      if (!PAYLOAD_MODES.includes(String(b.payload))) throw httpError(400, 'Tryb ładunku push to „minimal” albo „neutral”.', { code: 'bad_payload_mode' });
      cfg.payload = String(b.payload);
    }
    if (b.jitterSeconds !== undefined) cfg.jitterSeconds = Math.max(0, Math.min(+b.jitterSeconds || 0, 3600));
    if (b.subject !== undefined) {
      if (!/^mailto:.+@.+$/.test(String(b.subject))) throw httpError(400, 'Kontakt VAPID musi mieć postać „mailto:adres@szkoła”.', { code: 'bad_subject' });
      cfg.subject = String(b.subject);
    }
    db.data.config.push = cfg; db.save();
    let vapid = vapidKeys(db);
    if (cfg.enabled) vapid = ensureVapid(db, cfg.subject);
    if (b.regenerateKeys) {
      db.remove('pushKeys', 'vapid'); vapid = ensureVapid(db, cfg.subject);
      /* D3-38 — nowa para kluczy unieważnia KAŻDĄ istniejącą subskrypcję: usługa push odrzuca
         odtąd każdą wysyłkę (403), a wiersz dalej pokazywałby się rodzicowi jako „urządzenie
         zarejestrowane”, choć nic już nie dochodzi. Usuwamy je razem z kluczem i zapisujemy to
         w rejestrze zdarzeń; przeglądarka zarejestruje się ponownie przy następnym otwarciu. */
      const dead = db.col('pushSubscriptions').slice();
      for (const p of dead) db.remove('pushSubscriptions', p.id);
      if (dead.length) ctx.audit({ action: 'push_subscriptions_invalidated', entity: 'pushSubscription', entityId: 'vapid', before: { subscriptions: dead.length }, reason: 'wymiana pary kluczy VAPID unieważnia wszystkie subskrypcje' });
    }
    ctx.audit({ action: 'push_config', entity: 'config', entityId: 'push', before, after: { enabled: pushConfig(db).enabled, keys: !!vapid }, reason: b.reason || null });
    return { ok: true, enabled: pushEnabled(db), publicKey: vapid ? vapid.publicKey : null, subject: vapid ? vapid.subject : null, payload: payloadMode(db), jitterSeconds: pushConfig(db).jitterSeconds || 0 };
  }, { roles: ['admin', 'principal'] });

  /* ---- rejestracja push (starsza ścieżka 3.6; ta sama kolekcja, te same reguły) ------------- */
  r.post('/api/notifications/push/register', (ctx) => {
    const { row, created } = saveSubscription(ctx.db, ctx.user, ctx.body || {});
    ctx.audit({ action: 'push_registered', entity: 'pushSubscription', entityId: row.id, after: { device: row.device } });
    return {
      ok: true, created, subscription: { id: row.id, device: row.device, at: row.at },
      note: pushEnabled(ctx.db)
        ? 'Powiadomienia wychodzą zaszyfrowane (RFC 8291) — usługa push widzi wyłącznie szyfrogram.'
        : 'Powiadomienia push są w tej szkole wyłączone — subskrypcja jest zapisana lokalnie i nic nie wychodzi poza szkolny serwer.'
    };
  });
  r.get('/api/notifications/push', (ctx) => ({ subscriptions: ctx.db.col('pushSubscriptions').filter((p) => p.userId === ctx.user.id && !p.revoked).map((p) => ({ id: p.id, device: p.device, at: p.at })) }));
  r.delete('/api/notifications/push/:id', (ctx) => {
    const p = ctx.db.get('pushSubscriptions', ctx.params.id); if (!p || p.userId !== ctx.user.id) throw httpError(404, 'Nie ma takiej subskrypcji.');
    p.revoked = true; ctx.db.save(); return { ok: true };
  });

  /* ---- preferencje konta: motyw, ograniczenie ruchu, powiększenie tekstu, cisza nocna --- */
  r.get('/api/me/preferences', (ctx) => ({
    preferences: Object.assign({ theme: 'light', reduceMotion: false, textZoom: '100%' }, ctx.user.preferences || {}),
    quietHours: ctx.user.quietHours || null,
    quietHoursDefault: ctx.db.data.config.quietHoursDefault || null,
    push: { enabled: pushEnabled(ctx.db), subscriptions: liveSubscriptions(ctx.db, ctx.user.id).length }
  }));
  r.patch('/api/me/preferences', (ctx) => {
    const b = ctx.body || {}; const u = ctx.user; const before = Object.assign({}, u.preferences || {}, { quietHours: u.quietHours || null });
    const p = Object.assign({ theme: 'light', reduceMotion: false, textZoom: '100%' }, u.preferences || {});
    if (b.theme !== undefined) { if (!['light', 'dark', 'hc'].includes(b.theme)) throw httpError(400, 'Dostępne motywy: jasny, ciemny, wysoki kontrast.', { code: 'bad_theme' }); p.theme = b.theme; }
    if (b.reduceMotion !== undefined) p.reduceMotion = !!b.reduceMotion;
    if (b.textZoom !== undefined) { const z = String(b.textZoom); if (!/^(100|125|150|175|200)%$/.test(z)) throw httpError(400, 'Powiększenie tekstu: 100 %, 150 % albo 200 %.', { code: 'bad_zoom' }); p.textZoom = z; }
    u.preferences = p;
    if (b.quietHours !== undefined) {
      if (b.quietHours === null) u.quietHours = null;
      else {
        const { from, to } = b.quietHours || {};
        if (!/^\d{2}:\d{2}$/.test(from || '') || !/^\d{2}:\d{2}$/.test(to || '')) throw httpError(400, 'Podaj godziny ciszy w formacie GG:MM.', { code: 'bad_quiet_hours' });
        u.quietHours = { from, to };
      }
    }
    ctx.db.save();
    ctx.audit({ action: 'preferences_updated', entity: 'user', entityId: u.id, before, after: Object.assign({}, p, { quietHours: u.quietHours || null }) });
    return { ok: true, preferences: p, quietHours: u.quietHours || null };
  });
}
module.exports = {
  register, createNotification, inQuietHours, endOfQuiet,
  /* na potrzeby testów i innych sekcji: kolejka i konfiguracja push */
  pushConfig, pushEnabled, ensureVapid, enqueuePush, sweepDeferred, pushPayload, PUSH_KINDS, PAYLOAD_MODES,
  renderNotification, notificationTitle, PUSH_TITLES, PUSH_NEUTRAL, CRISIS_KINDS, pushableKind,
  /* wznowienie kolejki po restarcie (R3-11) — wywoływane samo przy pierwszym zamiataniu */
  resumePending, notificationById,
  flushPush: (db, force) => runPump(db, force !== false), pushQueueLength: (db) => pushState(db).jobs.length,
  /* podgląd kolejki dla testów: co czeka i od kiedy wolno to wysłać */
  pushQueuePeek: (db) => pushState(db).jobs.map((j) => ({ deliveryId: j.deliveryId, notBefore: j.notBefore, urgency: j.urgency, payload: j.payload }))
};
