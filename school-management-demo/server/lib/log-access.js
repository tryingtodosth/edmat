'use strict';
/* Komentarze i notatki prywatne do wpisów dzienników/rejestrów (rejestr zdarzeń, dziennik
   wychowawcy, protokoły usunięć, historia tożsamości, …).

   Jedna zasada dla wszystkich: komentować może KAŻDY, kto ma prawo ZOBACZYĆ dany wpis — więc
   bramka odczytu komentarzy jest dokładnie tą samą bramką, którą przechodzi ekran pokazujący wpis.
   Każdy rodzaj dziennika rejestruje tu „resolver”: role dopuszczone do rejestru (jak w `roles:`
   trasy GET) oraz funkcję `find(db, user, entryId)`, która zwraca wpis, gdy TEN użytkownik może go
   zobaczyć, albo `null`. Sam mechanizm komentarzy (`routes/log-comments.js`) niczego o rejestrach
   nie wie. Wpis rejestru zdarzeń jest zamrożony (S-15) — komentarze żyją obok, w `logComments`. */
const { httpError } = require('./router');
const auth = require('../auth');

const KINDS = new Map();

/**
 * register('audit', { roles: ['principal', 'dpo'], label: 'Rejestr zdarzeń',
 *   find: (db, user, id) => entry | null })
 * `roles` — jak w opcjach trasy: role, 'staff', 'gradeEditors', 'homeroom' (wychowawca). Pusta
 * lista = każdy zalogowany. `find` dostaje użytkownika i MUSI sam zwęzić widok (np. do klasy
 * wychowawcy, do dziecka rodzica); zwraca `null`, gdy wpisu nie ma albo nie wolno go pokazać.
 */
function register(kind, spec) {
  if (!/^[a-z][a-z0-9-]{1,40}$/.test(String(kind))) throw new Error('log-access: zły identyfikator rodzaju: ' + kind);
  if (!spec || typeof spec.find !== 'function') throw new Error('log-access: resolver ' + kind + ' bez find()');
  KINDS.set(kind, { kind, label: spec.label || kind, roles: spec.roles || [], find: spec.find });
  return spec;
}
function kinds() { return [...KINDS.keys()]; }
function has(kind) { return KINDS.has(kind); }

function roleAllowed(roles, user) {
  if (!roles || !roles.length) return true;
  const flat = roles.flatMap((x) => (x === 'staff' ? auth.STAFF : x === 'gradeEditors' ? auth.GRADE_EDITORS : [x]));
  return flat.includes(user.role) || (roles.includes('homeroom') && !!user.homeroomOf);
}

/** Zwraca wpis, gdy użytkownik może go zobaczyć; 404 dla nieznanego rodzaju, 403 dla roli spoza
    rejestru, 404 (nie 403) gdy resolver nie zwraca wpisu — brak wpisu i brak prawa wyglądają tak samo. */
function resolve(db, user, kind, entryId) {
  const k = KINDS.get(String(kind));
  if (!k) throw httpError(404, 'Nieznany rodzaj dziennika.', { code: 'unknown_log_kind', kind: String(kind), known: kinds() });
  if (!roleAllowed(k.roles, user)) throw httpError(403, 'Brak uprawnień do tego rejestru.', { code: 'forbidden', kind: k.kind });
  const entry = k.find(db, user, String(entryId));
  if (!entry) throw httpError(404, 'Nie znaleziono wpisu albo nie masz do niego dostępu.', { code: 'log_entry_not_found', kind: k.kind });
  return { kind: k, entry };
}
/** Czy użytkownik widzi wpis — bez wyjątku (do zliczania komentarzy w listach). */
function mayView(db, user, kind, entryId) { try { resolve(db, user, kind, entryId); return true; } catch (e) { return false; } }

module.exports = { register, resolve, mayView, kinds, has, roleAllowed };
