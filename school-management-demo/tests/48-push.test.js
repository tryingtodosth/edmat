'use strict';
/* Web Push: dostarczanie powiadomień na telefon rodzica bez żadnej zależności npm.
   Sprawdzamy kolejno: wektor testowy szyfrowania z RFC 8291 Appendix A (bajt w bajt oraz przez
   niezależny deszyfrator napisany z treści RFC), strukturę i podpis tokenu VAPID (RFC 8292),
   rejestr subskrypcji, całą drogę powiadomienia z `push:true` przez podstawiony transport,
   ciszę nocną (odłożenie i przepuszczenie sprawy kryzysowej), sprzątanie po 410, wyłącznik
   `config.push.enabled`, minimalizację ładunku (R6: `{v, kind, id, ts}` i nic więcej), pobranie
   treści przez service worker z `GET /api/notifications/:id/render`, rozrzut czasowy
   (`jitterSeconds`) oraz obsługę zdarzenia `push` w service workerze (node:vm).
   Opis działania i uwagi o prywatności: docs/PUSH.md. */
const { test } = require('node:test');
const assert = require('node:assert');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { startServer, expectOk, withConfig, fixtures } = require('./helpers');
const webpush = require('../server/lib/webpush');
const N = require('../server/routes/notifications');

let S;
test.before(async () => { S = await startServer(); });
test.after(() => { webpush.transport = null; return S.close(); });

/* Push włącza szkoła — każdy test, który go potrzebuje, prosi o ten krok, więc plik da się
   uruchomić także po jednym teście naraz (--test-name-pattern). */
const need = fixtures();
const pushOn = () => need('pushOn', async () => {
  const admin = await S.as('admin');
  return expectOk(await admin.post('/api/push/config', { enabled: true, subject: 'mailto:sekretariat@sp12.krakow.pl' }), 'włączenie push');
});

/* ---------------------------------------------------------------- atrapa usługi push */
/** Podstawiony transport: zapamiętuje żądania i odpowiada tym, co ustawi test. */
function fakeService(reply) {
  const calls = [];
  const answer = typeof reply === 'function' ? reply : () => (reply || { status: 201, headers: {} });
  webpush.transport = async (endpoint, req) => { calls.push({ endpoint, req }); return answer(endpoint, req, calls.length); };
  return calls;
}

/* Subskrypcja „przeglądarki”: prawdziwa para P-256 + 16-bajtowy sekret auth, jak z PushManagera. */
function browserSubscription(host) {
  const ec = crypto.createECDH('prime256v1'); ec.generateKeys();
  const auth = crypto.randomBytes(16);
  return {
    endpoint: 'https://' + (host || 'fcm.googleapis.com') + '/push/' + crypto.randomBytes(8).toString('hex'),
    keys: { p256dh: webpush.b64url(ec.getPublicKey()), auth: webpush.b64url(auth) },
    private: ec.getPrivateKey(), authRaw: auth
  };
}

/* ---------------------------------------------------------------- niezależny deszyfrator
   Napisany wyłącznie z treści RFC 8188 §2 (nagłówek rekordu) i RFC 8291 §3.4 (wyprowadzenie
   klucza), żeby wynik `encrypt()` dało się sprawdzić w drugą stronę, a nie tylko porównać z samym
   sobą. Celowo nie korzysta z niczego w server/lib/webpush.js poza dekodowaniem base64url. */
function decryptAes128gcm(body, sub) {
  const hmac = (key, data) => crypto.createHmac('sha256', key).update(data).digest();
  const salt = body.subarray(0, 16);
  const recordSize = body.readUInt32BE(16);
  const idLen = body[20];
  const asPublic = body.subarray(21, 21 + idLen);
  const payload = body.subarray(21 + idLen);
  const ecdh = crypto.createECDH('prime256v1'); ecdh.setPrivateKey(sub.private);
  const shared = ecdh.computeSecret(asPublic);
  const prkKey = hmac(sub.authRaw, shared);
  const keyInfo = Buffer.concat([Buffer.from('WebPush: info', 'ascii'), Buffer.from([0]), ecdh.getPublicKey(), asPublic, Buffer.from([1])]);
  const prk = hmac(salt, hmac(prkKey, keyInfo));
  const cek = hmac(prk, Buffer.concat([Buffer.from('Content-Encoding: aes128gcm', 'ascii'), Buffer.from([0, 1])])).subarray(0, 16);
  const nonce = hmac(prk, Buffer.concat([Buffer.from('Content-Encoding: nonce', 'ascii'), Buffer.from([0, 1])])).subarray(0, 12);
  const decipher = crypto.createDecipheriv('aes-128-gcm', cek, nonce);
  decipher.setAuthTag(payload.subarray(payload.length - 16));
  const plain = Buffer.concat([decipher.update(payload.subarray(0, payload.length - 16)), decipher.final()]);
  let end = plain.length; while (end > 0 && plain[end - 1] === 0) end--;      // dopełnienie zerami
  assert.equal(plain[end - 1], 2, 'ostatni rekord kończy ogranicznik 0x02');
  return { text: plain.subarray(0, end - 1).toString('utf8'), recordSize, salt: webpush.b64url(salt), asPublic: webpush.b64url(asPublic) };
}
/** Ładunek, który naprawdę poszedł do usługi push — odszyfrowany kluczami „przeglądarki”. */
function sentPayload(call, sub) { return JSON.parse(decryptAes128gcm(call.req.body, sub).text); }

/* ================================================================ szyfrowanie (RFC 8291) */
test('push: the RFC 8291 Appendix A vector is reproduced byte for byte', () => {
  /* Wektor z RFC 8291 Appendix A: klucze obu stron, sól, sekret auth i oczekiwany szyfrogram.
     `encrypt()` dostaje sól i klucz prywatny serwera, więc wynik jest w pełni deterministyczny. */
  const V = {
    plaintext: 'When I grow up, I want to be a watermelon',
    uaPublic: 'BCVxsr7N_eNgVRqvHtD0zTZsEc6-VV-JvLexhqUzORcxaOzi6-AYWXvTBHm4bjyPjs7Vd8pZGH6SRpkNtoIAiw4',
    uaPrivate: 'q1dXpw3UpT5VOmu_cf_v6ih07Aems3njxI-JWgLcM94',
    asPublic: 'BP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27mlmlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A8',
    asPrivate: 'yfWPiYE-n46HLnH0KqZOF1fJJU3MYrct3AELtAQ-oRw',
    auth: 'BTBZMqHH6r4Tts7J_aSIgg',
    salt: 'DGv6ra1nlYgDCS1FRnbzlw',
    expected: 'DGv6ra1nlYgDCS1FRnbzlwAAEABBBP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27mlmlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A_yl95bQpu6cVPTpK4Mqgkf1CXztLVBSt2Ks3oZwbuwXPXLWyouBWLVWGNWQexSgSxsj_Qulcy4a-fN'
  };
  /* Sam wektor też musi się trzymać kupy: oba klucze publiczne wynikają z podanych prywatnych. */
  const ua = crypto.createECDH('prime256v1'); ua.setPrivateKey(webpush.unb64url(V.uaPrivate));
  const as = crypto.createECDH('prime256v1'); as.setPrivateKey(webpush.unb64url(V.asPrivate));
  assert.equal(webpush.b64url(ua.getPublicKey()), V.uaPublic, 'klucz publiczny przeglądarki z wektora');
  assert.equal(webpush.b64url(as.getPublicKey()), V.asPublic, 'klucz publiczny serwera z wektora');

  const body = webpush.encrypt(V.plaintext, { p256dh: V.uaPublic, auth: V.auth, salt: V.salt, asPrivateKey: V.asPrivate });
  assert.equal(webpush.b64url(body), V.expected, 'szyfrogram co do bajtu jak w RFC 8291 Appendix A');

  /* i druga strona: niezależny deszyfrator z treści RFC odzyskuje jawny tekst z wektora */
  const back = decryptAes128gcm(body, { private: ua.getPrivateKey(), authRaw: webpush.unb64url(V.auth) });
  assert.equal(back.text, V.plaintext);
  assert.equal(back.recordSize, 4096, 'rs = 4096 w nagłówku rekordu');
  assert.equal(back.asPublic, V.asPublic, 'identyfikatorem klucza w nagłówku jest klucz publiczny serwera');
});

test('push: a random salt and server key still round-trip, and an oversized payload is refused', () => {
  const sub = browserSubscription();
  const body = webpush.encrypt('Nieobecność na 1. lekcji · Anna Kowalczyk · 08:00.', { p256dh: sub.keys.p256dh, auth: sub.keys.auth });
  const back = decryptAes128gcm(body, sub);
  assert.equal(back.text, 'Nieobecność na 1. lekcji · Anna Kowalczyk · 08:00.');
  assert.notEqual(back.salt, decryptAes128gcm(webpush.encrypt('x', { p256dh: sub.keys.p256dh, auth: sub.keys.auth }), sub).salt, 'sól jest losowa dla każdej wiadomości');
  assert.throws(() => webpush.encrypt('x'.repeat(5000), { p256dh: sub.keys.p256dh, auth: sub.keys.auth }), /za duży/);
  assert.throws(() => webpush.encrypt('x', { p256dh: sub.keys.p256dh, auth: webpush.b64url(Buffer.alloc(8)) }), /auth/);
});

/* ================================================================ VAPID (RFC 8292) */
test('push: the VAPID token is an ES256 JWT for the push service origin, verifiable with node:crypto', () => {
  const keys = webpush.generateVapidKeys('mailto:sekretariat@sp12.krakow.pl');
  assert.equal(webpush.unb64url(keys.publicKey).length, 65, 'klucz publiczny to surowy punkt 65 B');
  assert.equal(webpush.unb64url(keys.publicKey)[0], 4, 'punkt nieskompresowany');
  assert.match(keys.privateKey, /BEGIN PRIVATE KEY/, 'klucz prywatny jako PEM');

  const endpoint = 'https://updates.push.services.mozilla.com/wpush/v2/gAAAA-xyz';
  const token = webpush.vapidToken({ endpoint, subject: keys.subject, privateKey: keys.privateKey, expiresIn: 12 * 3600 });
  const [h64, p64, s64] = token.split('.');
  const header = JSON.parse(webpush.unb64url(h64).toString('utf8'));
  const claims = JSON.parse(webpush.unb64url(p64).toString('utf8'));
  assert.deepEqual(header, { typ: 'JWT', alg: 'ES256' });
  assert.equal(claims.aud, 'https://updates.push.services.mozilla.com', 'aud to ORIGIN usługi push, nie cały endpoint');
  assert.equal(claims.sub, 'mailto:sekretariat@sp12.krakow.pl');
  const now = Math.floor(Date.now() / 1000);
  assert.ok(claims.exp > now && claims.exp <= now + 24 * 3600, 'exp nie przekracza 24 godzin');

  /* podpis weryfikowany niezależnie: surowe r‖s (ieee-p1363) kluczem publicznym z JWK */
  const raw = webpush.unb64url(keys.publicKey);
  const pub = crypto.createPublicKey({ key: { kty: 'EC', crv: 'P-256', x: webpush.b64url(raw.subarray(1, 33)), y: webpush.b64url(raw.subarray(33, 65)) }, format: 'jwk' });
  assert.equal(webpush.unb64url(s64).length, 64, 'podpis to 64 bajty r‖s, a nie DER');
  assert.ok(crypto.verify('sha256', Buffer.from(h64 + '.' + p64, 'ascii'), { key: pub, dsaEncoding: 'ieee-p1363' }, webpush.unb64url(s64)), 'podpis ES256 się zgadza');
  assert.ok(!crypto.verify('sha256', Buffer.from(h64 + '.' + p64 + 'x', 'ascii'), { key: pub, dsaEncoding: 'ieee-p1363' }, webpush.unb64url(s64)), 'zmieniony ładunek unieważnia podpis');

  /* inny klucz szkoły nie przechodzi — token jest związany z kluczem z `k=` */
  const other = webpush.generateVapidKeys('mailto:x@y.z');
  assert.equal(webpush.verifyVapidToken(token, other.publicKey).ok, false);

  const authz = webpush.vapidAuthorization({ endpoint, subject: keys.subject, privateKey: keys.privateKey, publicKey: keys.publicKey });
  assert.match(authz, /^vapid t=[\w-]+\.[\w-]+\.[\w-]+, k=[\w-]+$/, 'nagłówek Authorization w schemacie „vapid”');
  assert.ok(authz.endsWith(keys.publicKey));
});

/* ================================================================ subskrypcje */
test('push: subscribe stores one row per endpoint, refreshes a duplicate, unsubscribe removes it', async () => {
  await pushOn();
  const parent = await S.as('rodzic.kowalczyk');

  const key = expectOk(await parent.get('/api/push/vapid-public-key'));
  assert.equal(key.enabled, true);
  assert.equal(webpush.unb64url(key.publicKey).length, 65, 'klient dostaje klucz gotowy dla applicationServerKey');

  const sub = browserSubscription();
  const first = expectOk(await parent.post('/api/push/subscribe', { endpoint: sub.endpoint, keys: sub.keys, userAgent: 'Mozilla/5.0 (Android 14; Pixel)' }));
  assert.equal(first.created, true);
  assert.equal(first.subscriptions, 1);
  assert.ok(!JSON.stringify(first).includes(sub.endpoint), 'odpowiedź nie odsyła pełnego adresu urządzenia');

  const again = expectOk(await parent.post('/api/push/subscribe', { endpoint: sub.endpoint, keys: sub.keys, userAgent: 'Mozilla/5.0 (Android 14; Pixel)' }));
  assert.equal(again.created, false, 'ten sam endpoint to ta sama subskrypcja');
  assert.equal(again.subscriptions, 1);
  assert.equal(S.db.col('pushSubscriptions').filter((p) => p.userId === 'u_p_kowalczyk' && !p.revoked).length, 1, 'bez duplikatów w bazie');

  const second = expectOk(await parent.post('/api/push/subscribe', { endpoint: browserSubscription('android.googleapis.com').endpoint, keys: browserSubscription().keys, userAgent: 'laptop' }));
  assert.equal(second.subscriptions, 2, 'drugie urządzenie to druga subskrypcja');

  assert.equal((await parent.post('/api/push/subscribe', { endpoint: 'nie-adres', keys: sub.keys })).status, 400);
  assert.equal((await parent.post('/api/push/subscribe', { endpoint: 'https://push.example/x', keys: { p256dh: 'AAAA', auth: sub.keys.auth } })).status, 400, 'klucz p256dh jest sprawdzany od razu');

  expectOk(await parent.delete('/api/push/subscribe', { endpoint: sub.endpoint }));
  assert.equal(S.db.col('pushSubscriptions').filter((p) => p.userId === 'u_p_kowalczyk').length, 1, 'wypisanie usuwa wiersz, nie chowa go');
  expectOk(await parent.delete('/api/push/subscribe', {}));
  assert.equal(S.db.col('pushSubscriptions').filter((p) => p.userId === 'u_p_kowalczyk').length, 0, 'bez argumentu wypisujemy wszystkie urządzenia konta');
  assert.ok(S.db.col('audit').some((a) => a.action === 'push_unsubscribed'), 'wypisanie zostawia ślad w audycie');
});

/* ================================================================ dostarczanie */
test('push: a notification with push:true reaches the push service encrypted and lands in pushDeliveries', async () => {
  await pushOn();
  const parent = await S.as('rodzic.kowalczyk');
  const sub = browserSubscription();
  expectOk(await parent.post('/api/push/subscribe', { endpoint: sub.endpoint, keys: sub.keys, userAgent: 'Pixel' }));
  const calls = fakeService({ status: 201, headers: {} });

  const n = N.createNotification(S.db, 'u_p_kowalczyk', 'absence', 'Nieobecność na 1. lekcji · Anna Kowalczyk · 08:00.', { crisis: true, push: true, link: '/rodzic?studentId=st_kowalczyk_anna' });
  await N.flushPush(S.db);

  assert.equal(calls.length, 1, 'jedno żądanie do usługi push');
  const req = calls[0].req;
  assert.equal(calls[0].endpoint, sub.endpoint);
  assert.equal(req.headers['Content-Encoding'], 'aes128gcm');
  assert.equal(req.headers['Content-Type'], 'application/octet-stream');
  assert.equal(req.headers.TTL, '86400');
  assert.equal(req.headers.Urgency, 'high', 'alert kryzysowy idzie z priorytetem');
  assert.match(req.headers.Authorization, /^vapid t=[\w-]+\.[\w-]+\.[\w-]+, k=[\w-]+$/);
  assert.ok(Buffer.isBuffer(req.body) && req.body.length > 100);
  assert.ok(!req.body.toString('latin1').includes('Kowalczyk'), 'usługa push dostaje wyłącznie szyfrogram');

  const payload = sentPayload(calls[0], sub);
  assert.deepEqual(Object.keys(payload).sort(), ['crisis', 'id', 'kind', 'ts', 'v'], 'ładunek to sam identyfikator zdarzenia — bez tytułu, treści i odnośnika');
  assert.equal(payload.v, 2);
  assert.equal(payload.kind, 'absence');
  assert.equal(payload.id, n.id);
  assert.equal(payload.ts, Date.parse(n.at));

  const rows = S.db.col('pushDeliveries').filter((d) => d.notificationId === n.id);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].status, 'sent');
  assert.equal(rows[0].attempts, 1);
  assert.equal(rows[0].code, 201);
  assert.equal(rows[0].endpoint, sub.endpoint, 'rejestr doręczeń wskazuje urządzenie');
  assert.ok(S.db.get('notifications', n.id).pushQueuedAt, 'powiadomienie wie, że poszło do kolejki');

  /* to samo powiadomienie utworzone drugi raz nie wysyła się drugi raz */
  const before = calls.length;
  await N.flushPush(S.db);
  assert.equal(calls.length, before, 'kolejka jest pusta — nic nie leci ponownie');
  expectOk(await parent.delete('/api/push/subscribe', {}));
});

test('push: a 5xx is retried with backoff and a 4xx is not, both visible in the log', async () => {
  await pushOn();
  const parent = await S.as('rodzic.kowalczyk');
  const sub = browserSubscription();
  expectOk(await parent.post('/api/push/subscribe', { endpoint: sub.endpoint, keys: sub.keys, userAgent: 'Pixel' }));
  let status = 503;
  const calls = fakeService(() => ({ status, headers: { 'retry-after': '1' } }));

  const n = N.createNotification(S.db, 'u_p_kowalczyk', 'message', 'Nowa wiadomość od wychowawcy.', { push: true, link: '/wiadomosci' });
  await N.flushPush(S.db);
  let row = S.db.col('pushDeliveries').filter((d) => d.notificationId === n.id)[0];
  assert.equal(row.status, 'retry', 'usługa push miała awarię — próbujemy dalej');
  assert.equal(row.attempts, 1);
  assert.equal(N.pushQueueLength(S.db), 1, 'zadanie czeka w kolejce');

  status = 201;
  await N.flushPush(S.db);
  row = S.db.get('pushDeliveries', row.id);
  assert.equal(row.status, 'sent');
  assert.equal(row.attempts, 2, 'druga próba, nie nowe powiadomienie');
  assert.equal(calls.length, 2);

  status = 400;
  const bad = N.createNotification(S.db, 'u_p_kowalczyk', 'message', 'Druga wiadomość.', { push: true, link: '/wiadomosci' });
  await N.flushPush(S.db);
  const badRow = S.db.col('pushDeliveries').filter((d) => d.notificationId === bad.id)[0];
  assert.equal(badRow.status, 'failed', '400 to błąd trwały — bez ponawiania');
  assert.equal(N.pushQueueLength(S.db), 0);
  expectOk(await parent.delete('/api/push/subscribe', {}));
});

test('push: a subscription the service reports as gone (410) is removed with an audit trail', async () => {
  await pushOn();
  const parent = await S.as('rodzic.kowalczyk');
  const sub = browserSubscription();
  expectOk(await parent.post('/api/push/subscribe', { endpoint: sub.endpoint, keys: sub.keys, userAgent: 'stary telefon' }));
  const id = S.db.col('pushSubscriptions').filter((p) => p.userId === 'u_p_kowalczyk')[0].id;
  fakeService({ status: 410, headers: {} });

  const n = N.createNotification(S.db, 'u_p_kowalczyk', 'payment', 'Opłata za obiady zaksięgowana.', { push: true, link: '/rodzic' });
  await N.flushPush(S.db);

  assert.equal(S.db.get('pushSubscriptions', id), null, 'martwa subskrypcja znika z bazy');
  assert.equal(S.db.col('pushDeliveries').filter((d) => d.notificationId === n.id)[0].status, 'gone');
  const row = S.db.col('audit').filter((a) => a.action === 'push_subscription_gone').slice(-1)[0];
  assert.ok(row, 'usunięcie subskrypcji jest audytowane');
  assert.equal(row.entityId, id);
  assert.ok(!JSON.stringify(row).includes(sub.endpoint.split('/').pop()), 'w audycie zostaje host, nie adres urządzenia');
  assert.equal(expectOk(await parent.get('/api/push/subscriptions')).subscriptions.length, 0);
});

/* ================================================================ cisza nocna */
test('push: quiet hours hold the delivery until morning, a crisis alert goes through at once', async () => {
  await pushOn();
  const parent = await S.as('rodzic.kowalczyk');
  const sub = browserSubscription();
  expectOk(await parent.post('/api/push/subscribe', { endpoint: sub.endpoint, keys: sub.keys, userAgent: 'Pixel' }));
  const calls = fakeService({ status: 201, headers: {} });
  const util = require('../server/lib/util');
  const D = require('../server/lib/domain');
  const pad = (n) => String(n).padStart(2, '0');
  const hour = +util.localTime(util.now(), D.tz(S.db)).slice(0, 2);
  expectOk(await parent.patch('/api/me/preferences', { quietHours: { from: pad(hour) + ':00', to: pad((hour + 2) % 24) + ':00' } }));
  try {
    const quiet = N.createNotification(S.db, 'u_p_kowalczyk', 'message', 'Wiadomość w środku nocy.', { push: true, link: '/wiadomosci' });
    await N.flushPush(S.db);
    assert.equal(quiet.deferred, true, 'zwykłe powiadomienie czeka do końca ciszy');
    assert.equal(quiet.push, false);
    assert.equal(calls.length, 0, 'w czasie ciszy nic nie wychodzi z procesu');
    assert.equal(S.db.col('pushDeliveries').filter((d) => d.notificationId === quiet.id).length, 0);

    const crisis = N.createNotification(S.db, 'u_p_kowalczyk', 'absence', 'Nieobecność na 1. lekcji · Anna Kowalczyk.', { crisis: true, push: true, link: '/rodzic' });
    await N.flushPush(S.db);
    assert.equal(crisis.deferred, false, 'sprawa kryzysowa omija ciszę nocną');
    assert.equal(calls.length, 1);
    assert.equal(sentPayload(calls[0], sub).id, crisis.id, 'to ten kryzysowy wiersz — po identyfikatorze, bo treści w ładunku nie ma');

    /* rano: koniec ciszy sprawdzamy leniwie — przy najbliższym żądaniu kanału powiadomień */
    const row = S.db.get('notifications', quiet.id);
    row.deliverAt = new Date(Date.now() - 60000).toISOString(); S.db.save();
    expectOk(await parent.get('/api/notifications/feed'));
    await N.flushPush(S.db);
    assert.equal(calls.length, 2, 'po ciszy odłożone powiadomienie jednak wychodzi');
    assert.equal(sentPayload(calls[1], sub).id, quiet.id, 'po ciszy wychodzi dokładnie to odłożone powiadomienie');
    assert.ok(!JSON.stringify(sentPayload(calls[1], sub)).includes('Wiadomość'), 'i nadal bez jednego słowa treści');
    assert.equal(S.db.col('pushDeliveries').filter((d) => d.notificationId === quiet.id)[0].status, 'sent');

    /* i tylko raz — kolejne żądanie nie wysyła tego samego drugi raz */
    expectOk(await parent.get('/api/notifications/feed'));
    await N.flushPush(S.db);
    assert.equal(calls.length, 2);
  } finally {
    expectOk(await parent.patch('/api/me/preferences', { quietHours: null }));
    expectOk(await parent.delete('/api/push/subscribe', {}));
  }
});

test('push: a deferred notification older than the release window is never pushed', async () => {
  await pushOn();
  const parent = await S.as('rodzic.kowalczyk');
  const sub = browserSubscription();
  expectOk(await parent.post('/api/push/subscribe', { endpoint: sub.endpoint, keys: sub.keys, userAgent: 'Pixel' }));
  const calls = fakeService({ status: 201, headers: {} });
  const stale = S.db.insert('notifications', {
    id: 'not_stale_push_test', userId: 'u_p_kowalczyk', kind: 'message', text: 'Wiadomość sprzed tygodnia.',
    at: new Date(Date.now() - 8 * 24 * 3600 * 1000).toISOString(), read: false, crisis: false, link: '/wiadomosci',
    push: false, deferred: true, deliverAt: new Date(Date.now() - 7 * 24 * 3600 * 1000).toISOString()
  });
  N.sweepDeferred(S.db, true);
  await N.flushPush(S.db);
  assert.equal(calls.length, 0, 'alert sprzed tygodnia nie ma prawa zabrzęczeć w telefonie');
  assert.equal(S.db.col('pushDeliveries').filter((d) => d.notificationId === stale.id).length, 0);
  S.db.remove('notifications', stale.id);
  expectOk(await parent.delete('/api/push/subscribe', {}));
});

test('push: only the allowed kinds leave the school, and a message subject never reaches a lock screen', async () => {
  await pushOn();
  const parent = await S.as('rodzic.kowalczyk');
  const sub = browserSubscription();
  expectOk(await parent.post('/api/push/subscribe', { endpoint: sub.endpoint, keys: sub.keys, userAgent: 'Pixel' }));
  const calls = fakeService({ status: 201, headers: {} });
  try {
    /* rodzaj spoza listy (notatka zespołu pomocy, gabinet, ocena z uzasadnieniem) zostaje w dzienniku */
    const priv = N.createNotification(S.db, 'u_p_kowalczyk', 'support', 'Notatka ze spotkania z psychologiem.', { push: true, link: '/pomoc' });
    await N.flushPush(S.db);
    assert.equal(calls.length, 0, 'nieznany/wrażliwy rodzaj nie wychodzi na telefon');
    assert.equal(S.db.col('pushDeliveries').filter((d) => d.notificationId === priv.id).length, 0);
    assert.ok(S.db.get('notifications', priv.id), 'ale w dzienniku jest');

    const msg = N.createNotification(S.db, 'u_p_kowalczyk', 'message', 'Nowa wiadomość: Prośba o rozmowę — sytuacja rodzinna', { push: true, link: '/wiadomosci?id=abc' });
    await N.flushPush(S.db);
    assert.equal(calls.length, 1);
    const payload = sentPayload(calls[0], sub);
    assert.deepEqual(Object.keys(payload).sort(), ['crisis', 'id', 'kind', 'ts', 'v']);
    assert.ok(!JSON.stringify(payload).includes('sytuacja rodzinna'), 'temat wiadomości nie idzie na ekran blokady');
    /* treść service worker bierze dopiero stąd — po zalogowanym kanale szkoły */
    const rendered = expectOk(await parent.get('/api/notifications/' + payload.id + '/render'));
    assert.match(rendered.body, /Masz nową wiadomość/, 'neutralna treść przychodzi z serwera szkoły');
    assert.ok(!rendered.body.includes('sytuacja rodzinna'));
    assert.equal(rendered.link, '/wiadomosci?id=abc', 'ale odnośnik prowadzi prosto do niej');
    assert.equal(S.db.get('notifications', msg.id).text, 'Nowa wiadomość: Prośba o rozmowę — sytuacja rodzinna', 'w dzienniku temat zostaje');
  } finally { expectOk(await parent.delete('/api/push/subscribe', {})); }
});

/* ================================================================ wyłącznik szkoły */
test('push: with config.push.enabled false nothing leaves the process', async () => {
  await pushOn();
  const parent = await S.as('rodzic.kowalczyk');
  const sub = browserSubscription();
  expectOk(await parent.post('/api/push/subscribe', { endpoint: sub.endpoint, keys: sub.keys, userAgent: 'Pixel' }));
  const calls = fakeService({ status: 201, headers: {} });
  const on = S.db.data.config.push;
  await withConfig(S.db, { push: Object.assign({}, on, { enabled: false }) }, async () => {
    assert.equal(expectOk(await parent.get('/api/push/vapid-public-key')).enabled, false);
    assert.equal((await parent.post('/api/push/subscribe', { endpoint: sub.endpoint, keys: sub.keys })).status, 409);
    assert.equal((await parent.post('/api/push/test', {})).status, 409);
    const n = N.createNotification(S.db, 'u_p_kowalczyk', 'absence', 'Nieobecność na 1. lekcji.', { crisis: true, push: true, link: '/rodzic' });
    await N.flushPush(S.db);
    assert.equal(calls.length, 0, 'przy wyłączonym push nie wychodzi ani jeden bajt');
    assert.equal(S.db.col('pushDeliveries').filter((d) => d.notificationId === n.id).length, 0, 'i nie powstaje wiersz doręczenia');
    assert.ok(S.db.get('notifications', n.id), 'powiadomienie w dzienniku powstaje mimo to');
  });
  assert.equal(expectOk(await parent.get('/api/push/vapid-public-key')).enabled, true, 'po przywróceniu konfiguracji push znowu działa');
  expectOk(await parent.delete('/api/push/subscribe', {}));
});

test('push: only an admin or the principal sees the statistics, and they carry no device addresses', async () => {
  await pushOn();
  const parent = await S.as('rodzic.kowalczyk');
  const sub = browserSubscription();
  expectOk(await parent.post('/api/push/subscribe', { endpoint: sub.endpoint, keys: sub.keys, userAgent: 'Pixel' }));
  fakeService({ status: 201, headers: {} });
  N.createNotification(S.db, 'u_p_kowalczyk', 'absence', 'Nieobecność na 1. lekcji.', { crisis: true, push: true, link: '/rodzic' });
  await N.flushPush(S.db);

  assert.equal((await parent.get('/api/push/stats')).status, 403, 'rodzic nie ogląda statystyk szkoły');
  const stats = expectOk(await (await S.as('dyrektor')).get('/api/push/stats'));
  assert.equal(stats.enabled, true);
  assert.ok(stats.subscriptions >= 1 && stats.subscribers >= 1);
  assert.ok(stats.byStatus.sent >= 1);
  assert.ok(stats.pushServices['fcm.googleapis.com'] >= 1, 'widać, do których usług push chodzimy');
  assert.ok(!JSON.stringify(stats).includes(sub.endpoint), 'statystyki nie ujawniają adresów urządzeń');
  assert.ok(stats.last.every((d) => /^[a-z.]+\/[0-9a-f]{8}$/.test(d.endpoint)), 'w rejestrze zostaje host + skrót');

  const testRun = expectOk(await parent.post('/api/push/test', {}));
  assert.equal(testRun.ok, true);
  assert.equal(testRun.sent, 1);
  expectOk(await parent.delete('/api/push/subscribe', {}));
});

test('push: the VAPID private key stays on the server', async () => {
  await pushOn();
  const parent = await S.as('rodzic.kowalczyk');
  const keys = S.db.get('pushKeys', 'vapid');
  assert.ok(keys && keys.privateKey && keys.publicKey, 'klucze szkoły leżą w osobnej kolekcji, nie w config');
  assert.equal(S.db.data.config.push.vapid, undefined, 'w konfiguracji nie ma pary kluczy');
  /* `/api/auth/session` oddaje klientowi całą konfigurację poza dwoma polami wyciętymi w
     server/index.js — klucz prywatny VAPID nie ma prawa się w niej znaleźć. */
  const session = JSON.stringify(expectOk(await parent.get('/api/auth/session')));
  assert.ok(!session.includes(keys.privateKey), 'klucz prywatny nie jedzie do przeglądarki');
  assert.ok(!session.includes('PRIVATE KEY'), 'ani żaden inny klucz prywatny w PEM');
  assert.equal(JSON.parse(session).config.push.publicKey, keys.publicKey, 'klucz publiczny może jechać — jest publiczny');
  const advertised = JSON.stringify(expectOk(await parent.get('/api/push/vapid-public-key')));
  assert.ok(!advertised.includes('PRIVATE'));
});

/* ================================================================ droga od nieobecności */
test('push: the first-period absence alert really reaches the parent\'s phone', async () => {
  await pushOn();
  const parent = await S.as('rodzic.kowalczyk');
  const sub = browserSubscription();
  expectOk(await parent.post('/api/push/subscribe', { endpoint: sub.endpoint, keys: sub.keys, userAgent: 'Pixel' }));
  const calls = fakeService({ status: 201, headers: {} });

  /* ta sama droga co w [3.7.2]: nieobecność na 1. lekcji skanuje się sama */
  const anna = S.db.col('students').find((s) => s.id === 'st_kowalczyk_anna');
  const row = S.db.col('attendance').filter((a) => a.studentId === anna.id && a.date === S.TODAY && a.lessonNo === 1)[0];
  assert.ok(row, 'w seedzie jest wpis frekwencji z 1. lekcji');
  const was = { status: row.status, draft: row.draft };
  const live = S.db.get('attendance', row.id); live.status = 'nb'; live.draft = false; S.db.save();
  for (const n of S.db.col('notifications').filter((x) => x.dedupeKey === 'first-period:' + row.id)) S.db.remove('notifications', n.id);
  try {
    const scan = expectOk(await parent.post('/api/parent/absence-alerts/scan', {}));
    assert.ok(scan.created >= 1, 'skan utworzył powiadomienie dla opiekuna');
    await N.flushPush(S.db);
    const mine = calls.map((c) => sentPayload(c, sub)).filter((p) => p.v === 2 && p.kind === 'absence');
    assert.ok(mine.length >= 1, 'i to powiadomienie poszło na telefon');
    assert.ok(calls.every((c) => !/Kowalczyk|lekcji/.test(c.req.body.toString('latin1'))), 'przez usługę push nie przechodzi ani imię, ani treść');
    /* całą resztę — tytuł, treść, odnośnik — service worker dobiera sobie ze szkoły */
    const rendered = expectOk(await parent.get('/api/notifications/' + mine[0].id + '/render'));
    assert.match(rendered.title, /Nieobecność/);
    /* S3-16 — na ekran blokady, który widzi każdy przechodzień, idzie zdanie neutralne: ani
       imienia ucznia, ani numeru lekcji. Szczegóły czekają w dzienniku, pod odnośnikiem. */
    assert.ok(!/Kowalczyk|Anna|lekcji/.test(rendered.body), 'treść nie nazywa ucznia ani lekcji: ' + rendered.body);
    assert.match(rendered.body, /frekwencji/);
    assert.match(rendered.link, /^\/rodzic\?studentId=/);
    assert.equal(rendered.crisis, true);
    assert.equal(calls[calls.length - 1].req.headers.Urgency, 'high');
  } finally {
    const back = S.db.get('attendance', row.id); back.status = was.status; back.draft = was.draft; S.db.save();
    expectOk(await parent.delete('/api/push/subscribe', {}));
  }
});

/* ================================================================ minimalizacja ładunku (R6) */
test('push: the minimal payload carries no pupil name and no text, for an absence alert and for a message', async () => {
  await pushOn();
  const parent = await S.as('rodzic.kowalczyk');
  const sub = browserSubscription();
  expectOk(await parent.post('/api/push/subscribe', { endpoint: sub.endpoint, keys: sub.keys, userAgent: 'Pixel' }));
  const calls = fakeService({ status: 201, headers: {} });
  try {
    const absence = N.createNotification(S.db, 'u_p_kowalczyk', 'absence', 'Nieobecność na 1. lekcji · Anna Kowalczyk · 08:00.', { crisis: true, push: true, link: '/rodzic?studentId=st_kowalczyk_anna' });
    const message = N.createNotification(S.db, 'u_p_kowalczyk', 'message', 'Nowa wiadomość: Prośba o rozmowę — sytuacja rodzinna', { push: true, link: '/wiadomosci?id=abc' });
    await N.flushPush(S.db);
    assert.equal(calls.length, 2);

    for (const [call, n, kind] of [[calls[0], absence, 'absence'], [calls[1], message, 'message']]) {
      const p = sentPayload(call, sub);
      /* D3-35: do czterech pól doszedł JEDEN bit — `crisis` — bo bez niego service worker, który
         nie zdołał dopytać szkoły o treść, pokazywał alert o nieobecności jak zwykłe powiadomienie. */
      assert.deepEqual(Object.keys(p).sort(), ['crisis', 'id', 'kind', 'ts', 'v'], 'ładunek to {v, kind, id, ts, crisis}');
      assert.equal(p.crisis, kind === 'absence', 'i ten bit mówi prawdę');
      assert.equal(p.v, 2);
      assert.equal(p.kind, kind);
      assert.equal(p.id, n.id);
      assert.equal(p.ts, Date.parse(n.at));
      const text = JSON.stringify(p);
      for (const leak of ['Anna', 'Kowalczyk', 'lekcji', 'rodzinna', 'wiadomość', 'rodzic', 'wiadomosci']) {
        assert.ok(!text.includes(leak), 'w ładunku nie ma „' + leak + '”');
      }
      /* nawet po rozszyfrowaniu nie wynika z niego ani kogo, ani czego dotyczy */
      assert.ok(text.length < 120, 'kilkadziesiąt bajtów, nie kilkaset');
    }
    /* ładunek dla obu rodzajów jest tej samej budowy i niemal tej samej długości */
    const sizes = calls.map((c) => c.req.body.length);
    assert.ok(Math.abs(sizes[0] - sizes[1]) <= 8, 'z samego rozmiaru szyfrogramu niewiele wynika');
    assert.ok(S.db.get('notifications', absence.id).text.includes('Anna Kowalczyk'), 'w dzienniku treść zostaje');
  } finally { expectOk(await parent.delete('/api/push/subscribe', {})); }
});

test('push: config.push.payload = neutral restores the pre-R6 payload, and an unknown mode is refused', async () => {
  await pushOn();
  const parent = await S.as('rodzic.kowalczyk');
  const sub = browserSubscription();
  expectOk(await parent.post('/api/push/subscribe', { endpoint: sub.endpoint, keys: sub.keys, userAgent: 'Pixel' }));
  const calls = fakeService({ status: 201, headers: {} });
  const on = S.db.data.config.push;
  assert.equal(N.pushConfig(S.db).payload, 'minimal', 'domyślnie minimalny ładunek');
  try {
    await withConfig(S.db, { push: Object.assign({}, on, { payload: 'neutral' }) }, async () => {
      const msg = N.createNotification(S.db, 'u_p_kowalczyk', 'message', 'Nowa wiadomość: Prośba o rozmowę — sytuacja rodzinna', { push: true, link: '/wiadomosci?id=abc' });
      await N.flushPush(S.db);
      const p = sentPayload(calls[calls.length - 1], sub);
      assert.deepEqual(Object.keys(p).sort(), ['at', 'body', 'crisis', 'kind', 'link', 'tag', 'title'], 'stary ładunek wraca w całości');
      assert.match(p.title, /Nowa wiadomość/);
      assert.match(p.body, /Masz nową wiadomość/, 'ale neutralna treść dalej obowiązuje');
      assert.ok(!p.body.includes('sytuacja rodzinna'));
      assert.equal(p.link, '/wiadomosci?id=abc');
      assert.equal(p.tag, msg.id);
    });
    /* po wyjściu z trybu neutralnego znowu jedzie sam identyfikator */
    N.createNotification(S.db, 'u_p_kowalczyk', 'payment', 'Opłata za obiady zaksięgowana.', { push: true, link: '/rodzic' });
    await N.flushPush(S.db);
    assert.deepEqual(Object.keys(sentPayload(calls[calls.length - 1], sub)).sort(), ['crisis', 'id', 'kind', 'ts', 'v']);

    const admin = await S.as('admin');
    assert.equal((await admin.post('/api/push/config', { payload: 'wszystko' })).status, 400, 'tryb ładunku jest z listy');
    assert.equal(expectOk(await admin.post('/api/push/config', { payload: 'minimal' })).payload, 'minimal');
  } finally { expectOk(await parent.delete('/api/push/subscribe', {})); }
});

/* ================================================================ treść z serwera szkoły */
test('push: the render endpoint answers in the right language and never for another account', async () => {
  const parent = await S.as('rodzic.kowalczyk');
  const n = N.createNotification(S.db, 'u_p_kowalczyk', 'absence', 'Nieobecność na 1. lekcji · Anna Kowalczyk · 08:00.', { crisis: true, link: '/rodzic?studentId=st_kowalczyk_anna' });

  const pl = expectOk(await parent.get('/api/notifications/' + n.id + '/render'));
  assert.equal(pl.locale, 'pl');
  assert.equal(pl.title, 'Nieobecność w szkole · pilne');
  /* S3-16 — w dzienniku treść zostaje, na telefon idzie zdanie neutralne. */
  assert.equal(pl.body, 'Nowy wpis o frekwencji. Szczegóły zobaczysz w dzienniku.');
  assert.ok(!pl.body.includes('Kowalczyk'), 'ekran blokady nie nazywa ucznia');
  assert.equal(S.db.get('notifications', n.id).text, 'Nieobecność na 1. lekcji · Anna Kowalczyk · 08:00.', 'w dzienniku treść zostaje');
  assert.equal(pl.link, '/rodzic?studentId=st_kowalczyk_anna');
  assert.equal(pl.crisis, true);
  assert.equal(pl.kind, 'absence');

  const en = expectOk(await parent.get('/api/notifications/' + n.id + '/render?locale=en'));
  assert.equal(en.locale, 'en');
  assert.equal(en.title, 'Absence from school · urgent', 'tytuł w języku, o który poprosił service worker');
  assert.equal(en.link, pl.link, 'odnośnik jest ten sam');

  /* wiadomość: neutralna treść w obu językach, temat zostaje w dzienniku */
  const msg = N.createNotification(S.db, 'u_p_kowalczyk', 'message', 'Nowa wiadomość: Prośba o rozmowę — sytuacja rodzinna', { link: '/wiadomosci?id=abc' });
  const msgPl = expectOk(await parent.get('/api/notifications/' + msg.id + '/render?locale=pl'));
  const msgEn = expectOk(await parent.get('/api/notifications/' + msg.id + '/render?locale=en'));
  assert.equal(msgPl.title, 'Nowa wiadomość');
  assert.equal(msgEn.title, 'New message');
  assert.match(msgEn.body, /new message in the logbook/i);
  assert.ok(!msgPl.body.includes('sytuacja rodzinna') && !msgEn.body.includes('sytuacja rodzinna'), 'temat nie wychodzi nawet tędy');
  assert.equal(S.db.get('notifications', msg.id).text, 'Nowa wiadomość: Prośba o rozmowę — sytuacja rodzinna');

  /* cudze powiadomienie: 403, a nie treść; nieistniejące: 404 */
  const other = N.createNotification(S.db, 'u_p_nowak', 'absence', 'Nieobecność na 1. lekcji · Jan Nowak · 08:00.', { crisis: true, link: '/rodzic' });
  const denied = await parent.get('/api/notifications/' + other.id + '/render');
  assert.equal(denied.status, 403, 'po cudzym identyfikatorze nie wydajemy niczego');
  assert.equal(denied.body.code, 'forbidden');
  assert.ok(!JSON.stringify(denied.body).includes('Nowak'), 'i nie zdradzamy, czego dotyczyło');
  assert.equal((await parent.get('/api/notifications/not_nie_ma_takiego/render')).status, 404);

  /* samo wyświetlenie powiadomienia na telefonie nie jest przeczytaniem go w dzienniku */
  assert.equal(S.db.get('notifications', n.id).read, false);
});

/* ================================================================ rozrzut czasowy */
test('push: jitterSeconds delays an ordinary delivery and never a crisis alert', async () => {
  await pushOn();
  const parent = await S.as('rodzic.kowalczyk');
  const sub = browserSubscription();
  expectOk(await parent.post('/api/push/subscribe', { endpoint: sub.endpoint, keys: sub.keys, userAgent: 'Pixel' }));
  const calls = fakeService({ status: 201, headers: {} });
  const on = S.db.data.config.push;
  assert.equal(N.pushConfig(S.db).jitterSeconds, 0, 'domyślnie bez rozrzutu — powiadomienie idzie od razu');
  try {
    await withConfig(S.db, { push: Object.assign({}, on, { jitterSeconds: 600 }) }, async () => {
      const ordinary = N.createNotification(S.db, 'u_p_kowalczyk', 'payment', 'Opłata za obiady zaksięgowana.', { push: true, link: '/rodzic' });
      const crisis = N.createNotification(S.db, 'u_p_kowalczyk', 'absence', 'Nieobecność na 1. lekcji · Anna Kowalczyk.', { crisis: true, push: true, link: '/rodzic' });
      const before = Date.now();
      await N.flushPush(S.db, false);                  // tylko to, czego czas nadszedł
      assert.equal(calls.length, 1, 'alert kryzysowy nie czeka ani sekundy');
      assert.equal(sentPayload(calls[0], sub).id, crisis.id);

      const waiting = N.pushQueuePeek(S.db);
      assert.equal(waiting.length, 1, 'zwykłe powiadomienie zostało w kolejce');
      assert.equal(waiting[0].payload.id, ordinary.id);
      assert.ok(waiting[0].notBefore > before, 'z wylosowanym terminem w przyszłości');
      assert.ok(waiting[0].notBefore <= before + 600 * 1000 + 50, 'ale nie dalszym niż jitterSeconds');

      await N.flushPush(S.db);                         // sprzątamy kolejkę: wymuszona wysyłka
      assert.equal(calls.length, 2);
      assert.equal(sentPayload(calls[1], sub).id, ordinary.id);
      assert.equal(N.pushQueueLength(S.db), 0);
    });
  } finally { expectOk(await parent.delete('/api/push/subscribe', {})); }
});

/* ================================================================ service worker */
/** Uruchamia prawdziwy public/sw.js w piaskownicy node:vm i oddaje zarejestrowane nasłuchy. */
function loadWorker(clients, opts) {
  const o = opts || {};
  const code = fs.readFileSync(path.join(__dirname, '..', 'public', 'sw.js'), 'utf8');
  const listeners = {}; const shown = []; const opened = []; const focused = []; const navigated = []; const fetched = [];
  const noCache = { match: async () => undefined, put: async () => {}, keys: async () => [], delete: async () => {} };
  const sandbox = {
    console, URL, setTimeout, clearTimeout, Promise, Response: function Response() {},
    fetch: async (url, init) => { fetched.push({ url: String(url), init: init || {} }); return o.fetch ? o.fetch(String(url), init || {}) : {}; },
    caches: { open: async () => noCache, keys: async () => [], match: async () => undefined, delete: async () => {} },
    location: { origin: 'https://sp12.krakow.pl' },
    addEventListener: (ev, fn) => { (listeners[ev] = listeners[ev] || []).push(fn); },
    registration: { scope: 'https://sp12.krakow.pl/', showNotification: async (title, options) => { shown.push({ title, options }); } },
    clients: {
      claim: async () => {},
      matchAll: async () => (clients || []).map((c) => Object.assign({ focus: async () => { focused.push(c.url); return c; }, navigate: async (u) => { navigated.push(u); return c; } }, c)),
      openWindow: async (url) => { opened.push(url); return { url }; }
    },
    skipWaiting: async () => {}
  };
  sandbox.self = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(code, sandbox, { filename: 'sw.js' });
  return { listeners, shown, opened, focused, navigated, fetched, sandbox };
}
/** Stałą zadeklarowaną w sw.js przez `const` w kontekście vm czyta się wyrażeniem. */
function swConst(w, name) { return vm.runInContext(name, w.sandbox); }
/** Odpala zarejestrowany nasłuch i czeka na to, co oddał przez waitUntil. */
async function fire(w, type, event) {
  const waits = [];
  const e = Object.assign({ waitUntil: (p) => waits.push(p) }, event);
  for (const fn of w.listeners[type] || []) await fn(e);
  await Promise.all(waits);
}
/** Odpowiedź, jaką na żądanie renderowania dałby serwer szkoły. */
const RENDERED = {
  id: 'not_abc', kind: 'absence', locale: 'pl', title: 'Nieobecność w szkole · pilne',
  body: 'Nieobecność na 1. lekcji · Anna Kowalczyk · 08:00.', link: '/rodzic?studentId=st_kowalczyk_anna',
  crisis: true, at: '2026-10-23T06:05:00.000Z', read: false
};
/* Dokładnie to, co dziś jedzie w ładunku: cztery pola i jeden bit `crisis` (D3-35). */
const MINIMAL = { v: 2, kind: 'absence', id: 'not_abc', ts: Date.parse('2026-10-23T06:05:00.000Z'), crisis: true };

test('push: on receipt the service worker fetches the text from the school and shows it', async () => {
  const w = loadWorker([], { fetch: async () => ({ ok: true, status: 200, json: async () => RENDERED }) });
  assert.ok((w.listeners.push || []).length === 1, 'sw.js rejestruje obsługę zdarzenia push');

  await fire(w, 'push', { data: { json: () => MINIMAL } });
  assert.equal(w.fetched.length, 1, 'ładunek nie ma treści, więc worker pyta o nią szkołę');
  assert.equal(w.fetched[0].url, 'https://sp12.krakow.pl/api/notifications/not_abc/render', 'adres w zakresie workera; bez języka — wtedy decyduje język konta');
  assert.equal(w.fetched[0].init.credentials, 'include', 'ciasteczko sesji musi pojechać z żądaniem');
  assert.equal(w.fetched[0].init.cache, 'no-store');

  assert.equal(w.shown.length, 1);
  const n = w.shown[0];
  assert.equal(n.title, 'Nieobecność w szkole · pilne');
  assert.equal(n.options.body, 'Nieobecność na 1. lekcji · Anna Kowalczyk · 08:00.');
  assert.equal(n.options.tag, 'not_abc');
  assert.equal(n.options.data.link, '/rodzic?studentId=st_kowalczyk_anna');
  assert.equal(n.options.data.login, false);
  assert.equal(n.options.icon, 'https://sp12.krakow.pl/icon.svg', 'ikona z zakresu workera, nie z zewnętrznego serwisu');
  assert.equal(n.options.requireInteraction, true, 'pilne zostaje na ekranie do dotknięcia');
  assert.equal(n.options.timestamp, Date.parse('2026-10-23T06:05:00.000Z'));
  assert.ok(!n.options.actions, 'przy udanym pobraniu żadna dodatkowa akcja nie jest potrzebna');

  /* klik prowadzi tam, gdzie wskazuje powiadomienie */
  let closed = 0;
  await fire(w, 'notificationclick', { notification: { data: n.options.data, close: () => { closed++; } } });
  assert.equal(closed, 1, 'powiadomienie znika po kliknięciu');
  assert.deepEqual(w.opened, ['https://sp12.krakow.pl/#/rodzic?studentId=st_kowalczyk_anna']);
});

test('push: when the school cannot be reached the worker still shows the neutral title for the kind', async () => {
  /* offline: fetch odrzuca */
  const off = loadWorker([], { fetch: async () => { throw new Error('offline'); } });
  await fire(off, 'push', { data: { json: () => MINIMAL } });
  assert.equal(off.shown.length, 1, 'ciche powiadomienie nie wchodzi w grę — przeglądarka to karze');
  /* U3-27/D3-35 — alert kryzysowy zapasową drogą nadal jest alertem: dopisek pilności,
     zdanie o pilnej sprawie, wibracja i requireInteraction. Wcześniej wyglądał jak zwykłe
     powiadomienie dokładnie wtedy, gdy telefon nie mógł dopytać szkoły. */
  assert.equal(off.shown[0].title, 'Nieobecność w szkole · pilne', 'neutralny tytuł rodzaju z tabelki, z dopiskiem pilności');
  assert.equal(off.shown[0].options.body, 'Pilna sprawa w dzienniku — otwórz, żeby sprawdzić frekwencję.');
  assert.equal(off.shown[0].options.requireInteraction, true, 'zostaje na ekranie do dotknięcia');
  assert.deepEqual(off.shown[0].options.vibrate, [120, 60, 120]);
  assert.ok(!off.shown[0].options.body.includes('Kowalczyk'), 'i żadnej treści, której worker nie ma');
  assert.deepEqual(off.shown[0].options.actions, [{ action: 'open', title: 'Otwórz EdMat' }]);
  assert.equal(off.shown[0].options.data.login, false, 'brak sieci to nie brak sesji');

  /* zwykłe powiadomienie zapasową drogą zostaje zwykłe: bez dopisku i bez wibracji */
  const plain = loadWorker([], { fetch: async () => { throw new Error('offline'); } });
  await fire(plain, 'push', { data: { json: () => ({ v: 2, kind: 'payment', id: 'not_pay', ts: Date.now(), crisis: false }) } });
  assert.equal(plain.shown[0].title, 'Płatność');
  assert.equal(plain.shown[0].options.body, 'Masz nowe powiadomienie. Otwórz dziennik, żeby zobaczyć szczegóły.');
  assert.equal(plain.shown[0].options.requireInteraction, false);

  /* wygasła sesja: 401 — klik ma wylądować na logowaniu z trasą powrotu */
  const out = loadWorker([], { fetch: async () => ({ ok: false, status: 401 }) });
  await fire(out, 'push', { data: { json: () => ({ v: 2, kind: 'message', id: 'not_xyz', ts: Date.now() }) } });
  assert.equal(out.shown[0].title, 'Nowa wiadomość', 'rodzaj spoza listy kryzysowej zostaje zwykłym powiadomieniem');
  assert.equal(out.shown[0].options.tag, 'not_xyz');
  assert.equal(out.shown[0].options.data.login, true);
  await fire(out, 'notificationclick', { notification: { data: out.shown[0].options.data, close: () => {} } });
  assert.deepEqual(out.opened, ['https://sp12.krakow.pl/#/?login=1'], 'logowanie, a po nim trasa z powiadomienia');

  /* 403 też jest brakiem dostępu, nie awarią */
  const forbidden = loadWorker([], { fetch: async () => ({ ok: false, status: 403 }) });
  await fire(forbidden, 'push', { data: { json: () => MINIMAL } });
  assert.equal(forbidden.shown[0].options.data.login, true);
});

test('push: the worker asks for and falls back to the language the app last ran in', async () => {
  const w = loadWorker([], { fetch: async () => ({ ok: false, status: 0 }) });
  await fire(w, 'message', { data: { type: 'locale', locale: 'en' } });
  await fire(w, 'push', { data: { json: () => ({ v: 2, kind: 'timetable', id: 'not_en', ts: Date.now() }) } });
  assert.equal(w.fetched[0].url, 'https://sp12.krakow.pl/api/notifications/not_en/render?locale=en', 'worker prosi o swój język');
  assert.equal(w.shown[0].title, 'Timetable change', 'a bez odpowiedzi bierze angielski tytuł z tabelki');
  assert.match(w.shown[0].options.body, /logbook/);
  assert.deepEqual(w.shown[0].options.actions, [{ action: 'open', title: 'Open EdMat' }]);
  assert.equal(w.shown[0].options.lang, 'en');
});

test('push: the worker ships a neutral fallback title for every kind on the positive list, in both languages', () => {
  const table = swConst(loadWorker([]), 'PUSH_FALLBACK');
  assert.deepEqual(Object.keys(table).sort(), ['en', 'pl'], 'obie wersje językowe są w pliku');
  for (const locale of ['pl', 'en']) {
    const t = table[locale];
    assert.ok(t.title && t.body && t.open, locale + ': tytuł zapasowy, treść zapasowa i etykieta akcji');
    for (const kind of N.PUSH_KINDS) {
      assert.ok(typeof t.kinds[kind] === 'string' && t.kinds[kind].length > 2, locale + ': brakuje tytułu zapasowego dla rodzaju „' + kind + '”');
    }
  }
  /* obie tabelki pokrywają dokładnie te same rodzaje — żaden nie wypadnie przy tłumaczeniu */
  assert.deepEqual(Object.keys(table.pl.kinds).sort(), Object.keys(table.en.kinds).sort());
  /* i dokładnie te same, co tytuły po stronie serwera */
  assert.deepEqual(Object.keys(table.pl.kinds).sort(), Object.keys(N.PUSH_TITLES.pl).sort());
});

test('push: a neutral-mode payload is shown as it comes, and a broken one still shows something', async () => {
  const w = loadWorker([{ url: 'https://sp12.krakow.pl/#/uczen' }]);
  /* config.push.payload = 'neutral': tytuł i treść są w ładunku, więc worker nikogo nie pyta */
  await fire(w, 'push', { data: { json: () => ({ title: 'Nowa wiadomość', body: 'Masz nową wiadomość w dzienniku.', link: '/wiadomosci?id=abc', tag: 'not_m', kind: 'message', crisis: false, at: '2026-10-23T09:00:00.000Z' }) } });
  assert.equal(w.fetched.length, 0, 'ładunek z treścią nie wymaga pytania szkoły');
  assert.equal(w.shown[0].title, 'Nowa wiadomość');
  assert.equal(w.shown[0].options.body, 'Masz nową wiadomość w dzienniku.');
  assert.equal(w.shown[0].options.data.link, '/wiadomosci?id=abc');

  /* pusty albo uszkodzony ładunek nadal daje sensowne powiadomienie (userVisibleOnly!) */
  await fire(w, 'push', { data: { json: () => { throw new Error('nie JSON'); }, text: () => 'Coś się wydarzyło.' } });
  assert.equal(w.shown[1].title, 'EdMat');
  assert.equal(w.shown[1].options.body, 'Coś się wydarzyło.');
  assert.equal(w.shown[1].options.requireInteraction, false);

  /* odnośnik spoza aplikacji jest ignorowany — klik nigdy nie wyprowadza poza dziennik */
  await fire(w, 'push', { data: { json: () => ({ title: 'x', body: 'y', link: 'https://zlosliwa.example/phish' }) } });
  assert.equal(w.shown[2].options.data.link, '/');

  /* z otwartą kartą dziennika klik przenosi tę kartę i ustawia na niej fokus */
  await fire(w, 'notificationclick', { notification: { data: { link: '/wiadomosci' }, close: () => {} } });
  assert.deepEqual(w.navigated, ['https://sp12.krakow.pl/#/wiadomosci']);
  assert.deepEqual(w.focused, ['https://sp12.krakow.pl/#/uczen']);
  assert.equal(w.opened.length, 0, 'nie otwieramy drugiej karty dziennika');
});

/* ================================================================ tabele: parzystość i neutralność
   Trzy tabele mówią o tym samym: tytuły serwera (PUSH_TITLES), neutralne zdania serwera
   (PUSH_NEUTRAL) i tabela zapasowa service workera (PUSH_FALLBACK). Rozjazd między nimi nie
   wywala niczego — po prostu na czyimś telefonie pojawia się „Powiadomienie” zamiast rodzaju albo,
   gorzej, zdanie z dziennika z imieniem ucznia. Dlatego parzystość jest testem, a nie zwyczajem. */
test('push: every pushable kind has a neutral sentence in both languages, and none of them names a pupil', async () => {
  const table = swConst(loadWorker([]), 'PUSH_FALLBACK');
  const keys = (o) => Object.keys(o).sort();
  assert.deepEqual(keys(N.PUSH_NEUTRAL.pl), keys(N.PUSH_TITLES.pl), 'neutralne zdania pokrywają dokładnie te rodzaje, co tytuły');
  assert.deepEqual(keys(N.PUSH_NEUTRAL.en), keys(N.PUSH_TITLES.en), 'to samo po angielsku');
  assert.deepEqual(keys(N.PUSH_NEUTRAL.pl), keys(N.PUSH_NEUTRAL.en), 'obie wersje językowe mają te same wiersze');
  assert.deepEqual(keys(N.PUSH_NEUTRAL.pl), keys(table.pl.kinds), 'i dokładnie te same, co tabela zapasowa w sw.js');
  for (const kind of N.PUSH_KINDS) {
    for (const locale of ['pl', 'en']) {
      const s = N.PUSH_NEUTRAL[locale][kind];
      assert.ok(typeof s === 'string' && s.length > 10, locale + ': brak neutralnego zdania dla rodzaju „' + kind + '”');
    }
    assert.notEqual(N.PUSH_NEUTRAL.pl[kind], N.PUSH_NEUTRAL.en[kind], 'zdanie jest przetłumaczone, a nie skopiowane: ' + kind);
  }

  /* i to, co naprawdę wychodzi z /render dla KAŻDEGO rodzaju: treść z dziennika nazywa ucznia,
     kwotę i powód — żadne z tych słów nie ma prawa pojawić się w odpowiedzi. */
  const parent = await S.as('rodzic.kowalczyk');
  const made = [];
  for (const kind of N.PUSH_KINDS) {
    made.push(N.createNotification(S.db, 'u_p_kowalczyk', kind, 'Anna Kowalczyk (7b): zaległość 128,50 zł — powód: choroba przewlekła.', { push: false, link: '/rodzic' }));
  }
  try {
    for (const n of made) {
      for (const locale of ['pl', 'en']) {
        const r = expectOk(await parent.get('/api/notifications/' + n.id + '/render?locale=' + locale), n.kind + '/' + locale);
        for (const leak of ['Anna', 'Kowalczyk', '128,50', 'choroba', '7b']) {
          assert.ok(!r.body.includes(leak) && !r.title.includes(leak), n.kind + '/' + locale + ': na ekranie blokady widać „' + leak + '”: ' + r.title + ' / ' + r.body);
        }
        assert.equal(r.body, N.PUSH_NEUTRAL[locale][n.kind], n.kind + '/' + locale + ': treść wprost z tabeli neutralnej');
      }
    }
  } finally { for (const n of made) S.db.remove('notifications', n.id); }
});

test('push: the crisis kind list is one list — the server and the service worker cannot drift apart', () => {
  const swCrisis = swConst(loadWorker([]), 'CRISIS_KINDS');
  assert.deepEqual(swCrisis.slice().sort(), N.CRISIS_KINDS.slice().sort(), 'sw.js i serwer mają tę samą listę rodzajów kryzysowych');
  assert.ok(N.CRISIS_KINDS.includes('absence'), 'nieobecność na 1. lekcji jest sprawą kryzysową');
  /* Bycie na liście kryzysowej nie czyni rodzaju wysyłalnym — o tym decyduje lista pozytywna. */
  assert.ok(!N.PUSH_KINDS.includes('attendance-alert'), 'alert frekwencyjny pedagoga zostaje w dzienniku');
});

/* ================================================================ lista pozytywna przed kryzysem */
test('push: the positive list decides first — a crisis notification of an unlisted kind stays in the logbook', async () => {
  await pushOn();
  const counselor = await S.as('pedagog');
  const sub = browserSubscription();
  expectOk(await counselor.post('/api/push/subscribe', { endpoint: sub.endpoint, keys: sub.keys, userAgent: 'Pixel' }));
  const calls = fakeService({ status: 201, headers: {} });
  try {
    /* Dokładnie ten wiersz, który produkuje server/routes/support.js: kryzysowy `attendance-alert`
       z imieniem ucznia i jego sytuacją socjalną. Do tej rundy `if (n.crisis) return true;`
       przepuszczał go na ekran blokady o każdej porze (D3-33). */
    const alert = N.createNotification(S.db, 'u_pedagog', 'attendance-alert',
      'Uczeń objęty pomocą społeczną: Anna Kowalczyk (7b) — 5 dni nieobecności bez informacji od rodzica.',
      { crisis: true, push: true, link: '/pomoc?studentId=st_kowalczyk_anna' });
    await N.flushPush(S.db);
    assert.equal(calls.length, 0, 'rodzaj spoza listy pozytywnej nie wychodzi nawet jako kryzys');
    assert.equal(S.db.col('pushDeliveries').filter((d) => d.notificationId === alert.id).length, 0, 'i nie powstaje wiersz doręczenia');
    assert.ok(S.db.get('notifications', alert.id), 'w dzienniku pedagog widzi go tak jak dotąd');
    assert.equal(N.pushableKind(S.db, { kind: 'attendance-alert', crisis: true }), false);

    /* config.push.kinds wolno wyłącznie ZAWĘZIĆ listę (D3-37). */
    const on = S.db.data.config.push;
    await withConfig(S.db, { push: Object.assign({}, on, { kinds: ['gabinet', 'speech', 'absence'] }) }, async () => {
      assert.equal(N.pushableKind(S.db, { kind: 'gabinet' }), false, 'konfiguracja nie dopisuje rodzajów spoza listy');
      assert.equal(N.pushableKind(S.db, { kind: 'absence' }), true);
      assert.equal(N.pushableKind(S.db, { kind: 'payment' }), false, 'a zawęzić — owszem');
    });
    assert.equal(N.pushableKind(S.db, { kind: 'payment' }), true, 'po zdjęciu zawężenia wraca pełna lista');
  } finally { expectOk(await counselor.delete('/api/push/subscribe', {})); }
});

/* ================================================================ indeks powiadomień (R3-10) */
test('push: the render endpoint reads the notification through an index, not a scan of the collection', async () => {
  /* Po porannym zamiataniu nieobecności kolekcja ma dziesiątki tysięcy wierszy, a każdy telefon,
     który dostał push, zaraz potem pyta o treść. `db.get` to liniowe `arr.find` — przy 600
     jednoczesnych renderach proces stał 4,2 s i nie obsługiwał nikogo innego. Test mierzy kształt
     pracy (wyszukanie po indeksie kontra przejście kolekcji) WZGLĘDEM siebie, w tym samym
     przebiegu, zamiast pilnować bezwzględnego budżetu, który na obciążonej maszynie nic nie mówi. */
  const B = await startServer();
  try {
    const col = B.db.col('notifications');
    const ids = [];
    for (let i = 0; i < 20000; i++) {
      const id = 'not_idx_' + i;
      col.push({ id, userId: i % 2 ? 'u_p_kowalczyk' : 'u_p_nowak', kind: 'payment', text: 'wiersz ' + i, at: '2026-10-23T09:00:00.000Z', read: false, crisis: false, link: '/rodzic', push: false, deferred: false });
      if (i % 2) ids.push(id);
    }
    B.db.save();
    assert.ok(B.db.col('notifications').length >= 20000);

    /* poprawność: pierwszy, ostatni i wiersz ze środka */
    const parent = await B.as('rodzic.kowalczyk');
    for (const id of [ids[0], ids[ids.length - 1], ids[Math.floor(ids.length / 2)]]) {
      const r = expectOk(await parent.get('/api/notifications/' + id + '/render'));
      assert.equal(r.id, id);
    }
    assert.equal((await parent.get('/api/notifications/not_idx_nie_ma/render')).status, 404, 'nieznane id to nadal 404, a nie cudza treść');

    const sample = Array.from({ length: 200 }, (_, i) => ids[(i * 37) % ids.length]);
    const timeOf = (fn) => { const t = process.hrtime.bigint(); for (const id of sample) assert.ok(fn(id)); return Number(process.hrtime.bigint() - t) / 1e6; };
    timeOf((id) => N.notificationById(B.db, id));                       // rozgrzewka (indeks buduje się raz)
    const indexed = timeOf((id) => N.notificationById(B.db, id));
    const scan = timeOf((id) => B.db.get('notifications', id));
    assert.ok(indexed * 5 < scan, `odczyt po indeksie ma być wielokrotnie tańszy od przejścia kolekcji (indeks ${indexed.toFixed(1)} ms, skan ${scan.toFixed(1)} ms na 200 odczytów)`);

    /* usunięcie wiersza przesuwa pozycje — indeks musi to zauważyć, a nie wydać cudzy wiersz */
    B.db.remove('notifications', ids[10]);
    assert.equal(N.notificationById(B.db, ids[10]), null, 'usuniętego wiersza nie ma');
    for (const id of [ids[9], ids[11], ids[ids.length - 1]]) assert.equal(N.notificationById(B.db, id).id, id, 'a sąsiednie wiersze dalej są sobą');
    const after = expectOk(await parent.get('/api/notifications/' + ids[ids.length - 1] + '/render'));
    assert.equal(after.id, ids[ids.length - 1]);

    /* licznik nieprzeczytanych czyta ten sam indeks i liczy wyłącznie swoje wiersze */
    const mineCount = expectOk(await parent.get('/api/notifications/unread-count'));
    assert.equal(mineCount.count, B.db.col('notifications').filter((n) => n.userId === 'u_p_kowalczyk' && !n.read).length);
  } finally { await B.close(); }
});

/* ================================================================ service worker: czas oczekiwania */
test('push: the worker gives the school four seconds and then shows the neutral notification', async () => {
  /* R3-10 — fan-out push to zsynchronizowana lawina żądań do tego samego procesu, który przed
     chwilą je wysłał. Bez terminu zdarzenie `push` nigdy się nie kończy, a przeglądarka podmienia
     je na własne „ta strona została zaktualizowana w tle”. */
  const seen = [];
  const w = loadWorker([], {
    fetch: (url, init) => new Promise((_, reject) => {
      seen.push(init);
      if (!init || !init.signal) return;                    // bez sygnału zawisłoby tu na zawsze
      init.signal.onabort = () => reject(Object.assign(new Error('przerwane'), { name: 'TimeoutError' }));
    })
  });
  w.sandbox.AbortSignal = { timeout: (ms) => { const s = { ms: ms, onabort: null }; setTimeout(() => { if (s.onabort) s.onabort(); }, 5); return s; } };
  assert.equal(swConst(w, 'RENDER_TIMEOUT_MS'), 4000, 'termin jest nazwany w kodzie, a nie zaszyty w wywołaniu');

  await fire(w, 'push', { data: { json: () => MINIMAL } });
  assert.equal(seen.length, 1);
  assert.ok(seen[0].signal, 'żądanie do szkoły idzie z sygnałem przerwania');
  assert.equal(seen[0].signal.ms, 4000, 'i z czterosekundowym terminem');
  assert.equal(w.shown.length, 1, 'po przekroczeniu terminu i tak pokazujemy powiadomienie');
  assert.equal(w.shown[0].title, 'Nieobecność w szkole · pilne');
  assert.equal(w.shown[0].options.data.login, false, 'zajęty serwer to nie wygasła sesja — nie prowadzimy na logowanie');
  assert.deepEqual(w.shown[0].options.actions, [{ action: 'open', title: 'Otwórz EdMat' }]);
});

/* ================================================================ zwalnianie rozrzutu i restart */
test('push: a jittered delivery is released by the queue itself, with nobody forcing it (H-6)', async () => {
  await pushOn();
  const parent = await S.as('rodzic.kowalczyk');
  const sub = browserSubscription();
  expectOk(await parent.post('/api/push/subscribe', { endpoint: sub.endpoint, keys: sub.keys, userAgent: 'Pixel' }));
  const calls = fakeService({ status: 201, headers: {} });
  const on = S.db.data.config.push;
  try {
    await withConfig(S.db, { push: Object.assign({}, on, { jitterSeconds: 1 }) }, async () => {
      const n = N.createNotification(S.db, 'u_p_kowalczyk', 'payment', 'Opłata za obiady zaksięgowana.', { push: true, link: '/rodzic' });
      assert.equal(calls.length, 0, 'z rozrzutem nic nie wychodzi od razu');
      /* nikt nie woła flushPush: budzik kolejki musi zadziałać sam — tego dotąd nie sprawdzał
         żaden test, a to jest zachowanie, od którego zależy telefon rodzica */
      const until = Date.now() + 5000;
      while (calls.length === 0 && Date.now() < until) await new Promise((r) => setTimeout(r, 25));
      assert.equal(calls.length, 1, 'po upływie rozrzutu kolejka zwolniła je sama');
      assert.equal(sentPayload(calls[0], sub).id, n.id);
      assert.equal(N.pushQueueLength(S.db), 0);
      assert.equal(S.db.col('pushDeliveries').filter((d) => d.notificationId === n.id)[0].status, 'sent');
    });
  } finally { expectOk(await parent.delete('/api/push/subscribe', {})); }
});

test('push: the jitter queue survives a restart, and what can never be sent stops reading as pending (R3-11)', async () => {
  const os = require('node:os');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'edmat-push-restart-'));
  const dataFile = path.join(dir, 'school.json');
  let first = await startServer({ dataFile });
  const sub = browserSubscription();
  let notificationId;
  try {
    const admin = await first.as('admin');
    expectOk(await admin.post('/api/push/config', { enabled: true, subject: 'mailto:sekretariat@sp12.krakow.pl', jitterSeconds: 3600 }), 'włączenie push z rozrzutem');
    const parent = await first.as('rodzic.kowalczyk');
    expectOk(await parent.post('/api/push/subscribe', { endpoint: sub.endpoint, keys: sub.keys, userAgent: 'Pixel' }));
    const calls = fakeService({ status: 201, headers: {} });
    const n = N.createNotification(first.db, 'u_p_kowalczyk', 'payment', 'Opłata za obiady zaksięgowana.', { push: true, link: '/rodzic' });
    notificationId = n.id;
    assert.equal(calls.length, 0, 'godzinny rozrzut trzyma je w kolejce');
    assert.equal(N.pushQueueLength(first.db), 1);
    const row = first.db.col('pushDeliveries').filter((d) => d.notificationId === n.id)[0];
    assert.equal(row.status, 'pending');
    assert.ok(row.notBefore, 'termin rozrzutu jest zapisany w bazie, nie tylko w pamięci procesu');
  } finally { await first.close(); }

  /* restart: nowy proces, ta sama baza. Kolejka w pamięci zniknęła razem z poprzednim procesem. */
  const back = await startServer({ dataFile });
  try {
    const pending = back.db.col('pushDeliveries').filter((d) => d.status === 'pending');
    assert.equal(pending.length, 1, 'wiersz doręczenia przetrwał restart');
    /* wiersz sprzed tygodnia, którego nikt już nie powinien wysłać */
    const stale = back.db.insert('notifications', { id: 'not_stale_restart', userId: 'u_p_kowalczyk', kind: 'payment', text: 'stara sprawa', at: '2025-10-01T09:00:00.000Z', deliverAt: '2025-10-01T09:00:00.000Z', read: false, crisis: false, link: '/rodzic', push: true, deferred: false });
    const staleRow = back.db.insert('pushDeliveries', { id: 'pd_stale_restart', notificationId: stale.id, userId: stale.userId, subscriptionId: 'nie-ma', endpoint: 'https://push.example/stale', status: 'pending', at: stale.at, attempts: 0, kind: 'payment', crisis: false, notBefore: null });

    const calls = fakeService({ status: 201, headers: {} });
    const parent = await back.as('rodzic.kowalczyk');
    expectOk(await parent.get('/api/notifications/feed'));        // pierwsze żądanie po starcie wznawia kolejkę
    assert.equal(N.pushQueueLength(back.db), 1, 'zadanie wróciło do kolejki po restarcie');
    assert.equal(back.db.get('pushDeliveries', staleRow.id).status, 'failed', 'a to, czego już nie wolno wysłać, nie udaje „czekającego”');
    assert.match(back.db.get('pushDeliveries', staleRow.id).error, /poza oknem zwalniania/);

    await N.flushPush(back.db, true);
    assert.equal(calls.length, 1, 'po restarcie powiadomienie naprawdę wychodzi');
    assert.equal(sentPayload(calls[0], sub).id, notificationId);
    assert.equal(back.db.col('pushDeliveries').filter((d) => d.notificationId === notificationId)[0].status, 'sent');
  } finally {
    await back.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

/* ================================================================ czas szkoły, nie czas serwera */
test('push: quiet hours and the jitter window are read in the school time zone, not the process one', async () => {
  /* Serwer bywa w innej strefie niż szkoła (kontener w UTC, hosting w innym kraju, laptop
     administratora w podróży). Cisza nocna „21:00–06:30” to godziny na ŚCIANIE W SZKOLE, więc
     wszystko po tej drodze liczy `D.schoolNow`/`D.inQuietHours` po `config.timezone`. Test ustawia
     strefę procesu na antypody: implementacja, która czyta zegar serwera, wypadnie z okna. */
  await pushOn();
  const D = require('../server/lib/domain');
  const wasEnv = process.env.EDMAT_TZ;
  process.env.EDMAT_TZ = 'Pacific/Auckland';
  const parent = await S.as('rodzic.kowalczyk');
  const sub = browserSubscription();
  expectOk(await parent.post('/api/push/subscribe', { endpoint: sub.endpoint, keys: sub.keys, userAgent: 'Pixel' }));
  const calls = fakeService({ status: 201, headers: {} });
  const user = S.db.get('users', 'u_p_kowalczyk');
  const hadQuiet = user.quietHours || null;
  const on = S.db.data.config.push;
  try {
    assert.equal(D.tz(S.db), S.db.data.config.timezone || 'Europe/Warsaw', 'strefa bierze się z konfiguracji szkoły');
    assert.notEqual(D.schoolNow(S.db).time, require('../server/lib/util').localTime(new Date().toISOString(), 'Pacific/Auckland'), 'i nie ze strefy procesu');

    /* okno ciszy zaczyna się za minutę czasu SZKOŁY i trwa dwie godziny */
    const plus = (time, minutes) => { const [h, m] = time.split(':').map(Number); const t = (h * 60 + m + minutes + 1440) % 1440; return String(Math.floor(t / 60)).padStart(2, '0') + ':' + String(t % 60).padStart(2, '0'); };
    const nowSchool = D.schoolNow(S.db).time;
    user.quietHours = { from: plus(nowSchool, 1), to: plus(nowSchool, 120) };
    S.db.save();
    assert.equal(D.inQuietHours(user, S.db), false, 'teraz jeszcze nie ma ciszy');
    assert.equal(D.inQuietHours(user, S.db, new Date(Date.now() + 30 * 60000).toISOString()), true, 'za pół godziny już tak');

    await withConfig(S.db, { push: Object.assign({}, on, { jitterSeconds: 3600 }) }, async () => {
      /* D3-36 — rozrzut losuje się PO rozstrzygnięciu ciszy nocnej, więc powiadomienie z 20:58
         potrafiło zabrzęczeć o 21:58, w środku okna. Teraz termin, który wypadłby w ciszy,
         jest przycinany do zera: „teraz” z definicji leży poza oknem. */
      const n = N.createNotification(S.db, 'u_p_kowalczyk', 'payment', 'Opłata za obiady zaksięgowana.', { push: true, link: '/rodzic' });
      assert.equal(S.db.get('notifications', n.id).deferred, false, 'tworzone przed ciszą — nie jest odkładane');
      const waiting = N.pushQueuePeek(S.db).filter((j) => j.payload.id === n.id);
      assert.equal(waiting.length, 1);
      assert.equal(waiting[0].notBefore, 0, 'rozrzut nie przenosi wysyłki w ciszę nocną');
      await N.flushPush(S.db, false);
      assert.equal(calls.length, 1, 'idzie od razu, zanim cisza się zacznie');
      assert.equal(sentPayload(calls[0], sub).id, n.id);
    });

    /* a powiadomienie utworzone w ciszy (czas szkoły) czeka do jej końca — też liczonego w szkole */
    const inQuiet = new Date(Date.now() + 30 * 60000).toISOString();
    const later = N.createNotification(S.db, 'u_p_kowalczyk', 'payment', 'Druga opłata.', { push: true, at: inQuiet, link: '/rodzic' });
    assert.equal(later.deferred, true, 'w ciszy powiadomienie czeka');
    assert.equal(require('../server/lib/util').localTime(later.deliverAt, D.tz(S.db)), user.quietHours.to, 'a termin dostarczenia to koniec okna na zegarze szkoły');
    S.db.remove('notifications', later.id);
  } finally {
    if (wasEnv === undefined) delete process.env.EDMAT_TZ; else process.env.EDMAT_TZ = wasEnv;
    user.quietHours = hadQuiet; S.db.save();
    expectOk(await parent.delete('/api/push/subscribe', {}));
  }
});

/* ================================================================ słowniki ekranów F6 (U3-14/45/46)
   Angielski build szkoły pokazywał polskie zdania serwera na /wiadomosci, a w kilku miejscach
   „tłumaczenie” było kopią polskiego oryginału. Test ładuje PRAWDZIWE słowniki (i18n.js + ekrany
   wiadomości i ustawień w node:vm, jak każe CONTRIBUTING.md) i pilnuje trzech rzeczy: obie wersje
   mają te same klucze, żadna angielska wartość nie jest kopią polskiej i żadna nie niesie polskiej
   litery poza nazwami własnymi wymienionymi niżej. */
test('push/shell/messages/settings: the English dictionary has every key, no copies and no Polish text', () => {
  const { loadClient } = require('./helpers');
  const ui = loadClient();
  for (const screen of ['messages', 'settings']) {
    vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'public', 'app', 'screens', screen + '.js'), 'utf8'), ui.sandbox, { filename: screen + '.js' });
  }
  const dict = ui.I.dict;
  /* klucze ekranów, które należą do tego pakietu: powłoka, push, wiadomości, ustawienia */
  const MINE = ['shell.', 'push.', 'ms.', 'se.'];
  const mine = (k) => MINE.some((p) => k.indexOf(p) === 0);
  const pl = Object.keys(dict.pl).filter(mine).sort();
  const en = Object.keys(dict.en).filter(mine).sort();
  assert.ok(pl.length > 150, 'słowniki się wczytały (' + pl.length + ' kluczy)');
  assert.deepEqual(pl, en, 'każdy klucz ma obie wersje językowe');

  /* Nazwy własne, które po angielsku zostają po polsku — świadomie i wyliczone z imienia. */
  const PROPER_NOUNS = ['Kraków', 'e-Doręczenia', 'Szkoła Podstawowa', 'Szkola-2026!'];
  const POLISH_LETTER = /[ąćęłńóśźżĄĆĘŁŃÓŚŹŻ]/;
  for (const key of en) {
    assert.notEqual(dict.en[key], dict.pl[key], 'angielska wartość „' + key + '” to kopia polskiej, nie tłumaczenie');
    let value = dict.en[key];
    for (const noun of PROPER_NOUNS) value = value.split(noun).join('');
    assert.ok(!POLISH_LETTER.test(value), 'polski tekst w angielskim buildzie, klucz „' + key + '”: ' + dict.en[key]);
  }

  /* U3-45 — jedno pojęcie, jedna nazwa: potwierdzenie odbioru w powiadomieniu push, na ekranie
     wiadomości i w tabeli potwierdzeń nazywa się tak samo. */
  const table = swConst(loadWorker([]), 'PUSH_FALLBACK');
  assert.equal(dict.pl['ms.ack'], table.pl.kinds.ack);
  assert.equal(dict.en['ms.ack'], table.en.kinds.ack);
  assert.equal(dict.pl['ms.ack'], N.PUSH_TITLES.pl.ack);
  assert.equal(dict.en['ms.ack'], N.PUSH_TITLES.en.ack, 'tytuł powiadomienia i kolumna w dzienniku mowia to samo');
  assert.ok(dict.en['ms.ackTitle'].indexOf(dict.en['ms.ack']) === 0, 'nagłówek żądania zaczyna się tym samym pojęciem');

  /* U3-46 — obietnica prywatności zgadza się z tym, co naprawdę jedzie w ładunku. */
  for (const locale of ['pl', 'en']) {
    const s = dict[locale]['push.privacy'];
    assert.ok(!/tytuł|title/i.test(s), locale + ': push.privacy nadal obiecuje tytuł w ładunku');
    assert.match(s, locale === 'pl' ? /identyfikator/ : /identifier/);
  }
});

test('push: regenerating the VAPID pair really invalidates the devices, instead of leaving dead rows on screen', async () => {
  /* D3-38 — docs/PUSH.md obiecywało „podmiana unieważnia wszystkie istniejące subskrypcje”, a kod
     zostawiał wiersze w bazie: rodzic dalej widział „urządzenie zarejestrowane”, choć od tej chwili
     każda wysyłka kończyła się 403 i wierszem `failed`. */
  await pushOn();
  const parent = await S.as('rodzic.kowalczyk');
  const sub = browserSubscription();
  expectOk(await parent.post('/api/push/subscribe', { endpoint: sub.endpoint, keys: sub.keys, userAgent: 'Pixel' }));
  assert.equal(expectOk(await parent.get('/api/push/subscriptions')).subscriptions.length, 1);
  const before = S.db.get('pushKeys', 'vapid').publicKey;
  const admin = await S.as('admin');
  const r = expectOk(await admin.post('/api/push/config', { regenerateKeys: true, reason: 'podejrzenie wycieku klucza' }));
  assert.notEqual(r.publicKey, before, 'para kluczy jest nowa');
  assert.equal(expectOk(await parent.get('/api/push/subscriptions')).subscriptions.length, 0, 'martwe subskrypcje znikają razem z kluczem');
  assert.ok(S.db.col('audit').some((a) => a.action === 'push_subscriptions_invalidated'), 'i zostaje po tym ślad w rejestrze zdarzeń');
});
