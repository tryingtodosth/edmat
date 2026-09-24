'use strict';
/* Web Push bez żadnej zależności npm — VAPID (RFC 8292) + szyfrowanie ładunku (RFC 8291/8188).
 *
 * Co robi ten plik i dlaczego tak:
 *  - klucze VAPID (P-256) generuje `node:crypto`; publiczny trzymamy jako surowy punkt 65 B w
 *    base64url (tego oczekuje przeglądarka w `applicationServerKey`), prywatny jako PEM (PKCS#8),
 *    żeby dało się go włożyć do pliku konfiguracyjnego albo do sejfu;
 *  - token VAPID to JWT ES256 podpisany `crypto.sign(..., { dsaEncoding: 'ieee-p1363' })` — JWT chce
 *    surowego r‖s, a nie DER-a, więc bez tej opcji podpis byłby nie do zweryfikowania po stronie
 *    usługi push;
 *  - ładunek szyfrujemy end-to-end kluczem subskrypcji (`p256dh` + sekret `auth`): usługa push
 *    (Google/Mozilla/Apple) widzi wyłącznie szyfrogram i adres endpointu. Szkoła nie oddaje danych
 *    ucznia dostawcy przeglądarki.
 *
 * Co jest w środku szyfrogramu, decyduje `pushPayload()` w server/routes/notifications.js: od R6
 * domyślnie `{v:2, kind, id, ts}` i nic więcej — tytuł i treść service worker pobiera z serwera
 * szkoły po odebraniu powiadomienia (docs/PUSH.md). Ten plik jest i zostaje wyłącznie kryptografią
 * i wysyłką: nie składa treści, nie zna ucznia i nie ma prawa niczego do ładunku dokładać.
 *
 * RFC 8291 §3.4, krok po kroku (tak jak w `encrypt()`):
 *   ecdh_secret = ECDH(as_private, ua_public)
 *   PRK_key     = HMAC-SHA-256(auth_secret, ecdh_secret)
 *   key_info    = "WebPush: info" || 0x00 || ua_public || as_public
 *   IKM         = HMAC-SHA-256(PRK_key, key_info || 0x01)
 *   PRK         = HMAC-SHA-256(salt, IKM)                              (RFC 8188)
 *   CEK         = HMAC-SHA-256(PRK, "Content-Encoding: aes128gcm" || 0x00 || 0x01)[0..16]
 *   NONCE       = HMAC-SHA-256(PRK, "Content-Encoding: nonce"     || 0x00 || 0x01)[0..12]
 * Rekord: nagłówek (salt 16 B ‖ rs 4 B ‖ długość klucza 1 B ‖ as_public 65 B) ‖ AES-128-GCM(
 * jawny tekst ‖ 0x02) ‖ tag 16 B. Ogranicznik 0x02 znaczy „ostatni rekord”.
 *
 * `encrypt()` przyjmuje `salt` i `asPrivateKey`, więc jest deterministyczne — dzięki temu wektor
 * testowy z RFC 8291 Appendix A sprawdzamy bajt w bajt (tests/48-push.test.js). */
const crypto = require('node:crypto');
const https = require('node:https');
const http = require('node:http');

const P256 = 'prime256v1';
const RECORD_SIZE = 4096;
const TAG_BYTES = 16;

/* ------------------------------------------------------------------ base64url */
function b64url(buf) { return Buffer.from(buf).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''); }
function unb64url(s) {
  if (Buffer.isBuffer(s)) return s;
  const t = String(s || '').replace(/-/g, '+').replace(/_/g, '/');
  return Buffer.from(t + '='.repeat((4 - (t.length % 4)) % 4), 'base64');
}
const hmac = (key, data) => crypto.createHmac('sha256', key).update(data).digest();
const infoBlock = (label) => Buffer.concat([Buffer.from('Content-Encoding: ' + label, 'ascii'), Buffer.from([0]), Buffer.from([1])]);
function u32(n) { const b = Buffer.alloc(4); b.writeUInt32BE(n, 0); return b; }

/* ------------------------------------------------------------------ klucze VAPID */
/** Para kluczy serwera aplikacji: publiczny jako surowy punkt base64url, prywatny jako PEM + `d`. */
function generateVapidKeys(subject) {
  const { publicKey, privateKey } = crypto.generateKeyPairSync('ec', { namedCurve: P256 });
  const jwk = privateKey.export({ format: 'jwk' });
  return {
    publicKey: b64url(rawPublicFromJwk(jwk)),
    privateKey: privateKey.export({ type: 'pkcs8', format: 'pem' }),
    privateKeyD: jwk.d,
    subject: subject || 'mailto:admin@example.invalid',
    createdAt: new Date().toISOString(),
    publicKeyPem: publicKey.export({ type: 'spki', format: 'pem' })
  };
}
function rawPublicFromJwk(jwk) { return Buffer.concat([Buffer.from([4]), unb64url(jwk.x), unb64url(jwk.y)]); }

/** Surowy 32-bajtowy skalar prywatny z PEM-a, JWK-a, Buffera albo base64url — cokolwiek przyszło. */
function rawPrivateKey(key) {
  if (Buffer.isBuffer(key)) return key;
  if (key && typeof key === 'object') return unb64url(key.d || key.privateKeyD || key.privateKey);
  const s = String(key || '');
  if (s.includes('-----BEGIN')) return unb64url(crypto.createPrivateKey(s).export({ format: 'jwk' }).d);
  const raw = unb64url(s);
  if (raw.length === 32) return raw;
  throw new Error('Nieznany format klucza prywatnego VAPID.');
}
/** KeyObject z surowego skalara — potrzebny do podpisu ES256 (ECDH liczymy przez createECDH). */
function privateKeyObject(key) {
  const s = typeof key === 'string' ? key : '';
  if (s.includes('-----BEGIN')) return crypto.createPrivateKey(s);
  const d = rawPrivateKey(key);
  const ec = crypto.createECDH(P256); ec.setPrivateKey(d);
  const pub = ec.getPublicKey();
  return crypto.createPrivateKey({ key: { kty: 'EC', crv: 'P-256', d: b64url(d), x: b64url(pub.subarray(1, 33)), y: b64url(pub.subarray(33, 65)) }, format: 'jwk' });
}
/** KeyObject z surowego punktu publicznego (65 B, base64url) — do weryfikacji tokenu VAPID. */
function publicKeyObject(pub) {
  const raw = unb64url(pub);
  if (raw.length !== 65 || raw[0] !== 4) throw new Error('Klucz publiczny VAPID musi być punktem nieskompresowanym (65 B).');
  return crypto.createPublicKey({ key: { kty: 'EC', crv: 'P-256', x: b64url(raw.subarray(1, 33)), y: b64url(raw.subarray(33, 65)) }, format: 'jwk' });
}

/* ------------------------------------------------------------------ token VAPID (RFC 8292) */
/** `aud` tokenu to ORIGIN usługi push, nie cały endpoint — inaczej token zostanie odrzucony. */
function audienceOf(endpoint) { const u = new URL(endpoint); return u.origin; }
/**
 * JWT ES256: { typ, alg } . { aud, exp, sub } . podpis(r‖s).
 * `exp` nie może przekroczyć 24 h (RFC 8292 §2); domyślnie 12 h, z sufitem na wszelki wypadek.
 */
function vapidToken(opts) {
  const o = opts || {};
  const audience = o.audience || audienceOf(o.endpoint);
  const now = Math.floor((o.now ? Date.parse(o.now) : Date.now()) / 1000);
  const ttl = Math.min(Math.max(+o.expiresIn || 12 * 3600, 60), 24 * 3600);
  const header = b64url(JSON.stringify({ typ: 'JWT', alg: 'ES256' }));
  const payload = b64url(JSON.stringify({ aud: audience, exp: now + ttl, sub: o.subject || 'mailto:admin@example.invalid' }));
  const signingInput = header + '.' + payload;
  const sig = crypto.sign('sha256', Buffer.from(signingInput, 'ascii'), { key: privateKeyObject(o.privateKey), dsaEncoding: 'ieee-p1363' });
  return signingInput + '.' + b64url(sig);
}
/** Weryfikacja tokenu (używana w testach i przez `POST /api/push/test` w trybie diagnostycznym). */
function verifyVapidToken(token, publicKey) {
  const parts = String(token || '').split('.');
  if (parts.length !== 3) return { ok: false, reason: 'format' };
  const ok = crypto.verify('sha256', Buffer.from(parts[0] + '.' + parts[1], 'ascii'), { key: publicKeyObject(publicKey), dsaEncoding: 'ieee-p1363' }, unb64url(parts[2]));
  const header = JSON.parse(unb64url(parts[0]).toString('utf8'));
  const claims = JSON.parse(unb64url(parts[1]).toString('utf8'));
  return { ok, header, claims };
}
/** Nagłówek `Authorization: vapid t=…, k=…` (schemat „vapid”, RFC 8292 §3). */
function vapidAuthorization(opts) { return 'vapid t=' + vapidToken(opts) + ', k=' + (typeof opts.publicKey === 'string' ? opts.publicKey : b64url(opts.publicKey)); }

/* ------------------------------------------------------------------ szyfrowanie (RFC 8291) */
/**
 * encrypt(payload, { p256dh, auth, salt?, asPrivateKey?, recordSize? }) → Buffer `aes128gcm`.
 * Bez `salt`/`asPrivateKey` losujemy jedno i drugie; z nimi wynik jest powtarzalny, co pozwala
 * sprawdzić wektor z RFC 8291 Appendix A bajt w bajt.
 */
function encrypt(payload, opts) {
  const o = opts || {};
  const uaPublic = unb64url(o.p256dh);
  const auth = unb64url(o.auth);
  if (uaPublic.length !== 65 || uaPublic[0] !== 4) throw new Error('Klucz p256dh subskrypcji musi mieć 65 bajtów.');
  if (auth.length !== 16) throw new Error('Sekret auth subskrypcji musi mieć 16 bajtów.');
  const salt = o.salt ? unb64url(o.salt) : crypto.randomBytes(16);
  const ecdh = crypto.createECDH(P256);
  if (o.asPrivateKey) ecdh.setPrivateKey(rawPrivateKey(o.asPrivateKey)); else ecdh.generateKeys();
  const asPublic = ecdh.getPublicKey();
  const sharedSecret = ecdh.computeSecret(uaPublic);

  const prkKey = hmac(auth, sharedSecret);
  const keyInfo = Buffer.concat([Buffer.from('WebPush: info', 'ascii'), Buffer.from([0]), uaPublic, asPublic, Buffer.from([1])]);
  const ikm = hmac(prkKey, keyInfo);
  const prk = hmac(salt, ikm);
  const cek = hmac(prk, infoBlock('aes128gcm')).subarray(0, 16);
  const nonce = hmac(prk, infoBlock('nonce')).subarray(0, 12);

  const rs = o.recordSize || RECORD_SIZE;
  const plaintext = Buffer.isBuffer(payload) ? payload : Buffer.from(String(payload), 'utf8');
  /* Jeden rekord na wiadomość: powiadomienie ma kilkaset bajtów, a dzielenie na rekordy
     dokładałoby kodu, którego nikt tu nie przećwiczy. Za duży ładunek to błąd, nie cichy skrót. */
  if (plaintext.length + 1 + TAG_BYTES > rs) throw new Error('Ładunek powiadomienia jest za duży na jeden rekord (' + rs + ' B).');
  const cipher = crypto.createCipheriv('aes-128-gcm', cek, nonce);
  const body = Buffer.concat([cipher.update(Buffer.concat([plaintext, Buffer.from([2])])), cipher.final(), cipher.getAuthTag()]);
  const header = Buffer.concat([salt, u32(rs), Buffer.from([asPublic.length]), asPublic]);
  return Buffer.concat([header, body]);
}

/* ------------------------------------------------------------------ wysyłka */
/** Domyślny transport: zwykły POST po HTTPS. Testy podmieniają `webpush.transport`. */
function httpTransport(endpoint, req) {
  const u = new URL(endpoint);
  const lib = u.protocol === 'http:' ? http : https;
  return new Promise((resolve, reject) => {
    const r = lib.request({ protocol: u.protocol, hostname: u.hostname, port: u.port || undefined, path: u.pathname + u.search, method: req.method || 'POST', headers: req.headers, timeout: req.timeout || 10000 }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks).toString('utf8').slice(0, 500) }));
    });
    r.on('timeout', () => { r.destroy(new Error('timeout')); });
    r.on('error', reject);
    r.end(req.body);
  });
}

const api = {
  /** Podmieniane w testach na atrapę; `null` = prawdziwy HTTPS. */
  transport: null,
  b64url, unb64url, generateVapidKeys, rawPublicFromJwk, privateKeyObject, publicKeyObject,
  audienceOf, vapidToken, verifyVapidToken, vapidAuthorization, encrypt, RECORD_SIZE
};

/**
 * sendPush(subscription, payloadObj, { vapid, ttl, urgency, topic }) →
 *   { ok, status, gone, retry, retryAfter, error }
 * `gone` (404/410) znaczy „wypisz tę subskrypcję”, `retry` (429/5xx/błąd sieci) — „spróbuj później”.
 */
async function sendPush(subscription, payloadObj, opts) {
  const o = opts || {};
  const vapid = o.vapid || {};
  if (!subscription || !subscription.endpoint) throw new Error('Subskrypcja bez adresu endpointu.');
  const keys = subscription.keys || {};
  if (!keys.p256dh || !keys.auth) throw new Error('Subskrypcja bez kluczy p256dh/auth — nie da się zaszyfrować ładunku.');
  if (!vapid.publicKey || !vapid.privateKey) throw new Error('Brak kluczy VAPID szkoły.');

  const body = encrypt(typeof payloadObj === 'string' ? payloadObj : JSON.stringify(payloadObj), { p256dh: keys.p256dh, auth: keys.auth });
  const headers = {
    Authorization: vapidAuthorization({ endpoint: subscription.endpoint, subject: vapid.subject, privateKey: vapid.privateKey, publicKey: vapid.publicKey, expiresIn: o.expiresIn }),
    'Content-Encoding': 'aes128gcm',
    'Content-Type': 'application/octet-stream',
    'Content-Length': String(body.length),
    TTL: String(o.ttl == null ? 86400 : o.ttl),
    Urgency: o.urgency || 'normal'
  };
  if (o.topic) headers.Topic = String(o.topic).slice(0, 32);

  const transport = api.transport || httpTransport;
  let res;
  try { res = await transport(subscription.endpoint, { method: 'POST', headers, body }); }
  catch (e) { return { ok: false, status: 0, gone: false, retry: true, error: String((e && e.message) || e), bytes: body.length }; }
  const status = res && res.status;
  const retryAfter = res && res.headers ? +(res.headers['retry-after'] || res.headers['Retry-After'] || 0) || 0 : 0;
  return {
    ok: status === 200 || status === 201 || status === 202,
    status: status || 0,
    gone: status === 404 || status === 410,
    retry: status === 429 || (status >= 500 && status < 600),
    retryAfter,
    bytes: body.length,
    body: res && res.body ? String(res.body).slice(0, 200) : ''
  };
}
api.sendPush = sendPush;
module.exports = api;
