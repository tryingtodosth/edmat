'use strict';
const crypto = require('node:crypto');
const PASSWORD_POLICY = { minLength: 12, upper: true, lower: true, digit: true, special: true };
function checkPasswordPolicy(pw) {
  const errs = [];
  if (!pw || pw.length < PASSWORD_POLICY.minLength) errs.push(`co najmniej ${PASSWORD_POLICY.minLength} znaków`);
  if (!/[A-ZĄĆĘŁŃÓŚŹŻ]/.test(pw || '')) errs.push('wielka litera');
  if (!/[a-ząćęłńóśźż]/.test(pw || '')) errs.push('mała litera');
  if (!/\d/.test(pw || '')) errs.push('cyfra');
  if (!/[^A-Za-z0-9ĄĆĘŁŃÓŚŹŻąćęłńóśźż]/.test(pw || '')) errs.push('znak specjalny');
  return { ok: errs.length === 0, missing: errs };
}
function hashPassword(pw) { const salt = crypto.randomBytes(16); const key = crypto.scryptSync(pw, salt, 32); return 'scrypt$' + salt.toString('hex') + '$' + key.toString('hex'); }
function verifyPassword(pw, stored) { if (!stored) return false; const [, salt, key] = stored.split('$'); const k = crypto.scryptSync(pw, Buffer.from(salt, 'hex'), 32); return crypto.timingSafeEqual(k, Buffer.from(key, 'hex')); }
/* TOTP (RFC 6238, SHA-1, 30 s, 6 digits) */
const B32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
function base32Encode(buf) { let bits = '', out = ''; for (const b of buf) bits += b.toString(2).padStart(8, '0'); for (let i = 0; i + 5 <= bits.length; i += 5) out += B32[parseInt(bits.slice(i, i + 5), 2)]; return out; }
function base32Decode(s) { let bits = ''; for (const ch of s.replace(/=+$/, '').toUpperCase()) { const v = B32.indexOf(ch); if (v < 0) continue; bits += v.toString(2).padStart(5, '0'); } const out = []; for (let i = 0; i + 8 <= bits.length; i += 8) out.push(parseInt(bits.slice(i, i + 8), 2)); return Buffer.from(out); }
function totpSecret() { return base32Encode(crypto.randomBytes(20)); }
function totpCode(secret, time, step) { const t = Math.floor((time == null ? Date.now() : time) / 1000 / (step || 30)); const msg = Buffer.alloc(8); msg.writeBigUInt64BE(BigInt(t)); const h = crypto.createHmac('sha1', base32Decode(secret)).update(msg).digest(); const o = h[19] & 0xf; const code = ((h[o] & 0x7f) << 24 | h[o + 1] << 16 | h[o + 2] << 8 | h[o + 3]) % 1000000; return String(code).padStart(6, '0'); }
function totpVerify(secret, code, time) { const t = time == null ? Date.now() : time; for (const d of [-1, 0, 1]) if (totpCode(secret, t + d * 30000) === String(code)) return true; return false; }
/* Asymmetric note encryption: each specialist has an RSA key pair; a note has one AES-256-GCM key wrapped for each reader. */
function generateKeyPair() { const { publicKey, privateKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048, publicKeyEncoding: { type: 'spki', format: 'pem' }, privateKeyEncoding: { type: 'pkcs8', format: 'pem' } }); return { publicKey, privateKey }; }
function encryptForReaders(plaintext, readers /* [{userId, publicKey}] */) {
  const key = crypto.randomBytes(32), iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv('aes-256-gcm', key, iv); const ct = Buffer.concat([c.update(String(plaintext), 'utf8'), c.final()]); const tag = c.getAuthTag();
  const wrapped = {}; for (const r of readers) wrapped[r.userId] = crypto.publicEncrypt({ key: r.publicKey, padding: crypto.constants.RSA_PKCS1_OAEP_PADDING, oaepHash: 'sha256' }, key).toString('base64');
  return { alg: 'AES-256-GCM+RSA-OAEP', iv: iv.toString('base64'), tag: tag.toString('base64'), ciphertext: ct.toString('base64'), wrappedKeys: wrapped };
}
function decryptFor(envelope, userId, privateKey) {
  const w = envelope.wrappedKeys[userId]; if (!w) return null;
  const key = crypto.privateDecrypt({ key: privateKey, padding: crypto.constants.RSA_PKCS1_OAEP_PADDING, oaepHash: 'sha256' }, Buffer.from(w, 'base64'));
  const d = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(envelope.iv, 'base64')); d.setAuthTag(Buffer.from(envelope.tag, 'base64'));
  return Buffer.concat([d.update(Buffer.from(envelope.ciphertext, 'base64')), d.final()]).toString('utf8');
}
/* Electronic seal for archive packages: SHA-256 digest signed with the school's RSA key (a stand-in for a qualified seal). */
function sealDocument(text, privateKey) { const digest = crypto.createHash('sha256').update(text).digest('hex'); const signature = crypto.sign('sha256', Buffer.from(text), privateKey).toString('base64'); return { digest, signature, alg: 'RSA-SHA256', sealedAt: new Date().toISOString(), note: 'Pieczęć elektroniczna szkoły (prototyp; w produkcji: kwalifikowana pieczęć/podpis)' }; }
function verifySeal(text, seal, publicKey) { return crypto.verify('sha256', Buffer.from(text), publicKey, Buffer.from(seal.signature, 'base64')); }
const token = () => crypto.randomBytes(24).toString('base64url');
const sha256 = (s) => crypto.createHash('sha256').update(s).digest('hex');
module.exports = { PASSWORD_POLICY, checkPasswordPolicy, hashPassword, verifyPassword, totpSecret, totpCode, totpVerify, generateKeyPair, encryptForReaders, decryptFor, sealDocument, verifySeal, token, sha256 };
