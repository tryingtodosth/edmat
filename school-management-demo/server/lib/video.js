'use strict';
/* Self-hosted video meetings for the `meetings` module.
   Providers (see docs/VIDEO.md): 'jitsi' (default), 'bbb' (BigBlueButton), 'none' (link-only, external host).

   Design rule: NOTHING here talks to the network. Every function only *builds* a URL, a JWT or a checksum,
   or *verifies* a signature that the provider sent us. That keeps the module testable offline and keeps the
   school's data flow inside the school: the browser is the only thing that ever contacts the video server.

   Crypto is node:crypto only (zero npm dependencies, like the rest of the prototype). */
const crypto = require('node:crypto');

const PROVIDERS = ['jitsi', 'bbb', 'none'];
/* The seed ships an example domain so nobody accidentally dials a stranger's server. */
const PLACEHOLDER_DOMAIN = /przykład|przyklad|example|zmień|zmien|<.*>/i;
const DOMAIN_RE = /^(?=.{1,253}$)([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,}$/i;
const ROOM_RE = /^[A-Za-z0-9][A-Za-z0-9_-]{2,63}$/;

/* --------------------------------------------------------------- config */

/** The video block of db.data.config, with defaults filled in. Env overrides win (docker-compose). */
function videoConfig(db) {
  const raw = (db.data.config && db.data.config.video) || {};
  const jitsi = Object.assign({ domain: '', appId: '', appSecret: '' }, raw.jitsi || {});
  const bbb = Object.assign({ url: '', secret: '' }, raw.bbb || {});
  if (process.env.EDMAT_JITSI_DOMAIN) jitsi.domain = process.env.EDMAT_JITSI_DOMAIN;
  if (process.env.EDMAT_JITSI_APP_ID) jitsi.appId = process.env.EDMAT_JITSI_APP_ID;
  if (process.env.EDMAT_JITSI_APP_SECRET) jitsi.appSecret = process.env.EDMAT_JITSI_APP_SECRET;
  return {
    provider: PROVIDERS.includes(raw.provider) ? raw.provider : 'jitsi',
    jitsi, bbb,
    eventSecret: process.env.EDMAT_VIDEO_EVENT_SECRET || raw.eventSecret || '',
    recordingConsentRequired: raw.recordingConsentRequired !== false,
    storedAt: raw.storedAt || 'school-server'
  };
}
/** True when the configured domain is still the seed's example (never load a script from it). */
function isPlaceholderDomain(domain) { return !domain || PLACEHOLDER_DOMAIN.test(String(domain)) || !DOMAIN_RE.test(String(domain).trim()); }
/** A real, usable Jitsi host? */
function jitsiReady(cfg) { return cfg.provider === 'jitsi' && !isPlaceholderDomain(cfg.jitsi.domain); }

/** Format-only validation (no network call, ever). Returns { ok, errors:[], warnings:[] }. */
function validateConfig(next) {
  const errors = []; const warnings = [];
  const provider = next.provider;
  if (!PROVIDERS.includes(provider)) errors.push(`Nieznany dostawca „${provider}”. Dozwolone: ${PROVIDERS.join(', ')}.`);
  if (provider === 'jitsi') {
    const d = String((next.jitsi && next.jitsi.domain) || '').trim();
    if (!d) errors.push('Podaj domenę serwera Jitsi szkoły, np. meet.sp12.krakow.pl.');
    else if (/^https?:/i.test(d)) errors.push('Wpisz samą domenę, bez „https://”.');
    else if (/[/?#]/.test(d)) errors.push('Domena nie może zawierać ścieżki ani parametrów.');
    else if (!DOMAIN_RE.test(d)) errors.push(`„${d}” nie wygląda jak nazwa domeny.`);
    else if (PLACEHOLDER_DOMAIN.test(d)) warnings.push('To wciąż domena przykładowa — wpisz adres serwera szkoły.');
    else if (/(^|\.)(meet\.jit\.si|8x8\.vc)$/i.test(d)) warnings.push('meet.jit.si to serwer publiczny (8x8). Dane uczniów powinny zostać na serwerze szkoły.');
    const appId = String((next.jitsi && next.jitsi.appId) || '').trim();
    const secret = next.jitsi && next.jitsi.appSecret;
    if (appId && secret !== undefined && secret !== null && String(secret).length && String(secret).length < 16) errors.push('Sekret JWT (app secret) powinien mieć co najmniej 16 znaków.');
    if (!appId) warnings.push('Bez app ID i sekretu pokój nie będzie chroniony tokenem JWT — każdy, kto zna adres, wejdzie do pokoju (chroni go wtedy tylko lobby i kod dostępu).');
  }
  if (provider === 'bbb') {
    const u = String((next.bbb && next.bbb.url) || '').trim();
    if (!u) errors.push('Podaj adres API BigBlueButton, np. https://bbb.sp12.krakow.pl/bigbluebutton.');
    else if (!/^https:\/\/[^\s/]+(\/[^\s?#]*)?$/.test(u)) errors.push('Adres API musi zaczynać się od https:// i nie może zawierać parametrów.');
    const s = next.bbb && next.bbb.secret;
    if (s !== undefined && s !== null && String(s).length && String(s).length < 16) errors.push('Sekret API BigBlueButton powinien mieć co najmniej 16 znaków.');
  }
  if (provider === 'none') warnings.push('Tryb „tylko link”: spotkania odbywają się u zewnętrznego dostawcy, poza kontrolą szkoły. Dane uczestników opuszczają serwer szkoły.');
  return { ok: errors.length === 0, errors, warnings };
}

/* --------------------------------------------------------------- JWT (HS256, RFC 7519) */

const b64url = (buf) => Buffer.from(buf).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const b64urlDecode = (s) => Buffer.from(String(s).replace(/-/g, '+').replace(/_/g, '/'), 'base64');

/** header.payload.signature with HMAC-SHA256 — the token format Jitsi's prosody token plugin expects. */
function signJwt(payload, secret, header) {
  const h = b64url(JSON.stringify(Object.assign({ alg: 'HS256', typ: 'JWT' }, header || {})));
  const p = b64url(JSON.stringify(payload));
  const sig = b64url(crypto.createHmac('sha256', String(secret)).update(h + '.' + p).digest());
  return `${h}.${p}.${sig}`;
}
function decodeJwt(token) {
  const parts = String(token || '').split('.');
  if (parts.length !== 3) return null;
  try { return { header: JSON.parse(b64urlDecode(parts[0]).toString('utf8')), payload: JSON.parse(b64urlDecode(parts[1]).toString('utf8')), signature: parts[2] }; } catch (e) { return null; }
}
function verifyJwt(token, secret) {
  const parts = String(token || '').split('.');
  if (parts.length !== 3) return false;
  const expected = b64url(crypto.createHmac('sha256', String(secret)).update(parts[0] + '.' + parts[1]).digest());
  const a = Buffer.from(expected), b = Buffer.from(parts[2]);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

/* --------------------------------------------------------------- Jitsi Meet */

/** A room name safe for a URL and for prosody: ASCII, no spaces, stable per meeting. */
function roomName(meeting) {
  const raw = meeting.room || meeting.id || '';
  const slug = String(raw).normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/ł/gi, 'l').replace(/[^A-Za-z0-9_-]/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '');
  return ROOM_RE.test(slug) ? slug : 'edmat-' + crypto.createHash('sha1').update(String(raw)).digest('hex').slice(0, 16);
}

/** Build the Jitsi join payload. `user` = { id, name, email?, avatar? }. No network. */
function jitsiJoin(cfg, meeting, user, opts) {
  const o = opts || {};
  const domain = String(cfg.jitsi.domain || '').trim();
  const room = roomName(meeting);
  const out = {
    provider: 'jitsi', domain, roomName: room,
    url: `https://${domain}/${room}`,
    displayName: user.name, moderator: !!o.moderator,
    jwt: null,
    embeddable: !isPlaceholderDomain(domain),
    externalApi: isPlaceholderDomain(domain) ? null : `https://${domain}/external_api.js`,
    lobby: meeting.waitingRoom !== false, passcode: o.revealPasscode ? (meeting.lobbyPasscode || null) : null
  };
  if (cfg.jitsi.appId && cfg.jitsi.appSecret) {
    const exp = o.exp || Math.floor(Date.now() / 1000) + (o.ttlSeconds || 4 * 3600);
    const payload = {
      iss: cfg.jitsi.appId,
      aud: 'jitsi',
      sub: domain,
      room,
      exp,
      nbf: Math.floor(Date.now() / 1000) - 30,
      context: {
        user: Object.assign({ name: user.name, id: user.id, moderator: o.moderator ? 'true' : 'false' }, user.email ? { email: user.email } : {}),
        features: { recording: !!o.canRecord, livestreaming: false, transcription: !!o.canRecord, 'outbound-call': false },
        group: meeting.id
      },
      moderator: !!o.moderator
    };
    out.jwt = signJwt(payload, cfg.jitsi.appSecret);
    out.url += '?jwt=' + encodeURIComponent(out.jwt);
    out.exp = exp;
  }
  return out;
}

/* --------------------------------------------------------------- BigBlueButton */

/* BBB API: every call is <apiUrl>/<callName>?<query>&checksum=SHA1(callName + query + sharedSecret).
   The query used for the checksum is the *encoded* query string WITHOUT the checksum parameter,
   in exactly the order it is sent. (BBB 2.6+ also accepts SHA-256; SHA-1 stays the interoperable default.) */
function bbbQuery(params) {
  return Object.keys(params).filter((k) => params[k] !== undefined && params[k] !== null && params[k] !== '')
    .map((k) => encodeURIComponent(k) + '=' + encodeURIComponent(String(params[k]))).join('&');
}
function bbbChecksum(callName, query, secret, algo) {
  return crypto.createHash(algo === 'sha256' ? 'sha256' : 'sha1').update(String(callName) + String(query) + String(secret)).digest('hex');
}
function bbbUrl(cfg, callName, params, algo) {
  const base = String(cfg.bbb.url || '').replace(/\/+$/, '');
  const query = bbbQuery(params);
  const sum = bbbChecksum(callName, query, cfg.bbb.secret || '', algo);
  return `${base}/api/${callName}?${query}${query ? '&' : ''}checksum=${sum}`;
}
const bbbMeetingId = (meeting) => 'edmat-' + String(meeting.id);
function bbbPasswords(meeting) {
  const seed = (s) => crypto.createHash('sha256').update(String(meeting.id) + '|' + s).digest('hex').slice(0, 12);
  return { moderatorPW: meeting.bbbModeratorPW || seed('mod'), attendeePW: meeting.bbbAttendeePW || seed('att') };
}
function bbbCreateUrl(cfg, meeting, opts) {
  const o = opts || {}; const pw = bbbPasswords(meeting);
  return bbbUrl(cfg, 'create', {
    name: meeting.title, meetingID: bbbMeetingId(meeting),
    moderatorPW: pw.moderatorPW, attendeePW: pw.attendeePW,
    record: meeting.recording && meeting.recording.enabled ? 'true' : 'false',
    autoStartRecording: 'false', allowStartStopRecording: meeting.recording && meeting.recording.enabled ? 'true' : 'false',
    muteOnStart: 'true', guestPolicy: meeting.waitingRoom === false ? 'ALWAYS_ACCEPT' : 'ASK_MODERATOR',
    welcome: o.welcome || undefined, logoutURL: o.logoutURL || undefined, meta_edmat_kind: meeting.kind
  });
}
function bbbJoinUrl(cfg, meeting, user, opts) {
  const o = opts || {}; const pw = bbbPasswords(meeting);
  return bbbUrl(cfg, 'join', {
    fullName: user.name, meetingID: bbbMeetingId(meeting),
    password: o.moderator ? pw.moderatorPW : pw.attendeePW,
    role: o.moderator ? 'MODERATOR' : 'VIEWER',
    userID: user.id, redirect: 'true', guest: o.guest ? 'true' : undefined
  });
}
function bbbEndUrl(cfg, meeting) { return bbbUrl(cfg, 'end', { meetingID: bbbMeetingId(meeting), password: bbbPasswords(meeting).moderatorPW }); }
function bbbInfoUrl(cfg, meeting) { return bbbUrl(cfg, 'getMeetingInfo', { meetingID: bbbMeetingId(meeting), password: bbbPasswords(meeting).moderatorPW }); }
function bbbJoin(cfg, meeting, user, opts) {
  const o = opts || {};
  return {
    provider: 'bbb', domain: String(cfg.bbb.url || '').replace(/^https?:\/\//, '').split('/')[0], roomName: bbbMeetingId(meeting),
    url: bbbJoinUrl(cfg, meeting, user, o), createUrl: o.moderator ? bbbCreateUrl(cfg, meeting) : null,
    displayName: user.name, moderator: !!o.moderator, jwt: null, embeddable: false, externalApi: null,
    lobby: meeting.waitingRoom !== false, passcode: null
  };
}

/* --------------------------------------------------------------- provider events (attendance) */

/** Jitsi webhook: the school's prosody/jicofo module signs the raw JSON body with HMAC-SHA256 (shared secret).
    We only verify — we never call out. Returns { ok, reason }. */
function verifyJitsiWebhook(secret, rawBody, signature) {
  if (!secret) return { ok: false, reason: 'no_secret' };
  if (!signature) return { ok: false, reason: 'no_signature' };
  const sig = String(signature).replace(/^sha256=/i, '');
  const expected = crypto.createHmac('sha256', String(secret)).update(typeof rawBody === 'string' ? rawBody : JSON.stringify(rawBody || {})).digest('hex');
  const a = Buffer.from(expected), b = Buffer.from(sig);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return { ok: false, reason: 'bad_signature' };
  return { ok: true };
}
/** BigBlueButton callback: same checksum scheme as the API, over the callback name and its query. */
function bbbCallback(secret, callName, query, checksum) {
  if (!secret) return { ok: false, reason: 'no_secret' };
  if (!checksum) return { ok: false, reason: 'no_checksum' };
  for (const algo of ['sha1', 'sha256']) {
    const expected = bbbChecksum(callName, query, secret, algo);
    const a = Buffer.from(expected), b = Buffer.from(String(checksum));
    if (a.length === b.length && crypto.timingSafeEqual(a, b)) return { ok: true, algo };
  }
  return { ok: false, reason: 'bad_checksum' };
}
/** Plain shared-secret header check for the simple `POST /api/meetings/:id/events` path. */
function verifyEventSecret(secret, presented) {
  if (!secret) return false;
  const a = Buffer.from(String(secret)), b = Buffer.from(String(presented || ''));
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

/* --------------------------------------------------------------- dispatch */

/** joinPayload(cfg, meeting, user, { moderator, canRecord }) → { provider, url, jwt?, domain, roomName, displayName, moderator } */
function joinPayload(cfg, meeting, user, opts) {
  const provider = meeting.provider || cfg.provider;
  if (provider === 'bbb') return bbbJoin(cfg, meeting, user, opts);
  if (provider === 'none') {
    return {
      provider: 'none', domain: null, roomName: meeting.room || meeting.id, url: meeting.externalUrl || meeting.room || '',
      displayName: user.name, moderator: !!(opts && opts.moderator), jwt: null, embeddable: false, externalApi: null,
      external: true, lobby: false, passcode: null,
      warning: 'Spotkanie u zewnętrznego dostawcy — poza serwerem szkoły. Nie nagrywaj i nie udostępniaj danych uczniów.'
    };
  }
  return jitsiJoin(cfg, meeting, user, opts);
}

module.exports = {
  PROVIDERS, videoConfig, isPlaceholderDomain, jitsiReady, validateConfig,
  b64url, signJwt, decodeJwt, verifyJwt,
  roomName, jitsiJoin,
  bbbQuery, bbbChecksum, bbbUrl, bbbMeetingId, bbbPasswords, bbbCreateUrl, bbbJoinUrl, bbbEndUrl, bbbInfoUrl, bbbJoin,
  verifyJitsiWebhook, bbbCallback, verifyEventSecret,
  joinPayload
};
