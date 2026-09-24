'use strict';
const { now, id } = require('./util');
/** Dokument prosto ze store'u jest Proxy śledzącym zmiany (server/lib/store.js). */
const RAW = Symbol.for('edmat.store.raw');
/** S-15: `Object.freeze` jest płytkie — `before`/`after` zostawały zapisywalne, więc dowód dawał się
    przepisać w pamięci procesu. Zamrażamy wiersz wgłąb. Nie ma wyjątku od „tylko dopisujemy”:
    żądanie z art. 17 RODO nie rusza rejestru — protokół usunięcia danych sam jest w nim wpisem
    (docs/RETENTION.md §3). */
function deepFreeze(o) {
  if (o && typeof o === 'object' && !Object.isFrozen(o)) { Object.freeze(o); for (const k of Object.keys(o)) deepFreeze(o[k]); }
  return o;
}
/**
 * Wołający często podaje `before`/`after` przez referencję do żywego rekordu (`after: cat`).
 * Zamrożenie tamtego obiektu unieruchomiłoby dziennik, więc do rejestru trafia odcięta kopia.
 *
 * Kopiujemy sami, bo obie gotowe drogi przewracały się na tym, co trasy naprawdę podają:
 * `structuredClone` rzuca `DataCloneError` na każdym dokumencie ze store'u (to Proxy), a `JSON`
 * rzuca `TypeError` na strukturze z odwołaniem wstecznym. Audyt nie może przewrócić żądania,
 * którego jest jedynym śladem — więc Proxy jest rozwijany, cykl zapisany jako `'[cykl]'`,
 * a Date/Map/Set/BigInt sprowadzone do postaci, którą store zapisze i odczyta bez zmiany.
 */
function snapshot(e) { return copy(e, new Map()); }
function copy(v, seen) {
  if (v === null || v === undefined) return v;
  const t = typeof v;
  if (t === 'bigint') return String(v);
  if (t === 'function' || t === 'symbol') return undefined;
  if (t !== 'object') return v;
  let raw = v;
  try { const inner = v[RAW]; if (inner !== undefined) raw = inner; } catch (err) { /* getter, który rzuca, nie kończy audytu */ }
  if (raw instanceof Date) return isNaN(raw.getTime()) ? null : raw.toISOString();
  if (seen.has(raw)) return '[cykl]';
  seen.set(raw, true);
  let out;
  try {
    if (Array.isArray(raw)) out = raw.map((x) => copy(x, seen));
    else if (raw instanceof Map) out = Object.fromEntries([...raw.entries()].map(([k, x]) => [String(k), copy(x, seen)]));
    else if (raw instanceof Set) out = [...raw].map((x) => copy(x, seen));
    else if (raw instanceof Error) out = { name: raw.name, message: raw.message };
    else if (Buffer.isBuffer(raw)) out = `[${raw.length} B]`;
    else { out = {}; for (const k of Object.keys(raw)) { const x = copy(raw[k], seen); if (x !== undefined) out[k] = x; } }
  } finally { seen.delete(raw); }
  return out;
}
/** Append-only audit log. Entries are never edited or deleted; retention is enforced by policy, never by users. */
function audit(db, entry) {
  const e = deepFreeze(snapshot(Object.assign({ id: id('aud'), at: now() }, entry)));
  db.col('audit').push(e); db.save(); return e;
}
/** Te same słowa, którymi `routes/principal.js` (`kindOf`) rozpoznaje zmianę i usunięcie — filtr
    biblioteki i filtr ekranu dyrektora muszą odpowiadać tak samo. Bez tego `edit_or_delete` mijał
    m.in. `grade_value_edit`, `student_removed`, `classification_grade_invalidated`,
    `right_to_be_forgotten`, `import_undone` i `grade_superseded`. */
const EDIT_OR_DELETE = /delete|remove|invalid|revert|forgotten|superseded|undone|update|edit|assign|change|patch/;
/** Górna granica zakresu: 'RRRR-MM-DD' oznacza cały dzień, pełny instant zostaje sobą (sklejenie
    'RRRR-MM-DDTHH:MM:SSZ' + 'T23:59:59.999Z' dawało napis, który nie pasował do niczego). */
const dayEnd = (to) => (/^\d{4}-\d{2}-\d{2}$/.test(String(to)) ? to + 'T23:59:59.999Z' : String(to));
function query(db, f) {
  const q = f || {};
  const hi = q.to ? dayEnd(q.to) : null;
  return db.col('audit').filter((e) =>
    (!q.ip || (e.ip || '').startsWith(q.ip)) &&
    (!q.userId || e.userId === q.userId) &&
    (!q.from || e.at >= q.from) && (!hi || e.at <= hi) &&
    (!q.action || e.action === q.action || (q.action === 'edit_or_delete' && EDIT_OR_DELETE.test(String(e.action || '')))) &&
    (!q.entity || e.entity === q.entity)
  ).sort((a, b) => (a.at < b.at ? 1 : -1));
}
module.exports = { audit, query, deepFreeze, snapshot, EDIT_OR_DELETE };
