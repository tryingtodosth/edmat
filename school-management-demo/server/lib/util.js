'use strict';
const crypto = require('node:crypto');

const id = (prefix) => (prefix ? prefix + '_' : '') + crypto.randomBytes(6).toString('hex');
/* ---- czas i strefa czasowa ------------------------------------------------------------------
   `now()` to instant (ISO, UTC) — moment na osi czasu, nigdy „pora dnia”.
   Wszystko, co znaczy „dzień w życiu szkoły” (today, termin zadania, próg godzinowy), to czas
   ścienny w strefie szkoły. Domyślnie Europe/Warsaw; proces może ją nadpisać (EDMAT_TZ/TZ),
   a szkoła — kluczem config.timezone (patrz domain.tz). Arytmetyka na datach (addDays, weekday,
   daysBetween) pozostaje zakotwiczona w T00:00:00Z i jest odporna na zmianę czasu. */
const DEFAULT_TZ = 'Europe/Warsaw';
const envTimezone = () => process.env.EDMAT_TZ || process.env.TZ || DEFAULT_TZ;
const now = () => new Date().toISOString();
const _dtfCache = new Map();
function _dtf(tz) {
  let f = _dtfCache.get(tz);
  if (!f) { f = new Intl.DateTimeFormat('en-US', { timeZone: tz, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' }); _dtfCache.set(tz, f); }
  return f;
}
const _pad = (n) => String(n).padStart(2, '0');
function _date(instant) { const d = instant == null ? new Date() : (instant instanceof Date ? instant : new Date(instant)); return isNaN(d.getTime()) ? null : d; }
/** Rozbicie instantu na części kalendarzowe w podanej strefie. */
function _parts(instant, tz) {
  const d = _date(instant); if (!d) return null;
  const p = {};
  for (const x of _dtf(tz || envTimezone()).formatToParts(d)) if (x.type !== 'literal') p[x.type] = x.value;
  if (p.hour === '24') p.hour = '00'; // starsze ICU potrafi zwrócić 24 dla północy
  return p;
}
/** Instant → 'RRRR-MM-DD' w strefie szkoły. */
function localDate(instant, tz) { const p = _parts(instant, tz); return p ? `${p.year}-${p.month}-${p.day}` : ''; }
/** Instant → 'GG:MM' (albo 'GG:MM:SS' przy withSeconds) w strefie szkoły. */
function localTime(instant, tz, withSeconds) { const p = _parts(instant, tz); return p ? `${p.hour}:${p.minute}${withSeconds ? ':' + p.second : ''}` : ''; }
/** Przesunięcie strefy względem UTC w minutach dla danego instantu (Warszawa: 60 zimą, 120 latem). */
function zoneOffsetMinutes(instant, tz) {
  const d = _date(instant); if (!d) return 0;
  const p = _parts(d, tz); if (!p) return 0;
  const asUtc = Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute, +p.second);
  return Math.round((asUtc - (d.getTime() - d.getMilliseconds())) / 60000);
}
/**
 * Czas ścienny szkoły → instant ISO z przesunięciem, np. ('2026-10-28','20:00') → '2026-10-28T20:00:00+01:00'.
 * Wyszukiwanie przesunięcia (dwa kroki + kontrola), więc zmiana czasu jest obsłużona:
 *  - godzina, która w dniu zmiany występuje dwa razy (25.10.2026, 02:30), zostaje rozstrzygnięta na
 *    późniejsze, zimowe wystąpienie — termin nie skraca się uczniowi o godzinę;
 *  - godzina, której nie ma (28.03.2027, 02:30), przesuwa się o brakującą godzinę do przodu.
 */
function toInstant(localDateStr, localTimeStr, tz) {
  const z = tz || envTimezone();
  const dm = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(localDateStr || '').trim()); if (!dm) return null;
  const tm = /^(\d{1,2}):(\d{2})(?::(\d{2}))?$/.exec(String(localTimeStr == null || localTimeStr === '' ? '00:00' : localTimeStr).trim()); if (!tm) return null;
  /* „2026-02-30” i „2026-13-01” przechodziły przez wzorzec i cicho przewijały się na inny dzień
     (2 marca, 1 stycznia następnego roku). Data z formularza ma być odrzucona, nie przesunięta. */
  const y = +dm[1], mo = +dm[2], da = +dm[3];
  const probe = new Date(Date.UTC(y, mo - 1, da));
  if (probe.getUTCFullYear() !== y || probe.getUTCMonth() !== mo - 1 || probe.getUTCDate() !== da) return null;
  if (+tm[1] > 23 || +tm[2] > 59 || +(tm[3] || 0) > 59) return null;
  const wall = Date.UTC(y, mo - 1, da, +tm[1], +tm[2], +(tm[3] || 0));
  const guess = zoneOffsetMinutes(new Date(wall), z);
  let ts = wall - guess * 60000;
  const off2 = zoneOffsetMinutes(new Date(ts), z);
  if (off2 !== guess) ts = wall - off2 * 60000;
  /* Przesunięcie do wypisania bierzemy z **ustalonego instantu**, nie z kroku wyszukiwania. Dla
     godziny, której nie ma (28.03.2027, 02:30 → 03:30), krok wyszukiwania kończył się na +01:00,
     a wypisywana godzina lokalna już na letniej: powstawał napis „2027-03-28T03:30:00+01:00”,
     czyli instant o godzinę późniejszy, niż mówi jego własny zapis. */
  const off = zoneOffsetMinutes(new Date(ts), z);
  const sign = off < 0 ? '-' : '+'; const abs = Math.abs(off);
  return `${localDate(ts, z)}T${localTime(ts, z, true)}${sign}${_pad(Math.floor(abs / 60))}:${_pad(abs % 60)}`;
}
/** Dzisiejsza data w strefie szkoły — nigdy UTC (po północy w Warszawie UTC to jeszcze wczoraj). */
const today = (tz) => localDate(new Date(), tz || envTimezone());
const clone = (v) => JSON.parse(JSON.stringify(v));

/** dd.mm.yyyy for display */
function fmtDate(iso) { if (!iso) return ''; const [y, m, d] = iso.slice(0, 10).split('-'); return `${d}.${m}.${y}`; }
/** Kalendarzowa połowa API przyjmuje 'RRRR-MM-DD'. Instant ('…T10:00:00Z') bywa podany przez
    pomyłkę — wtedy liczy się jego dzień, zamiast wysypywać żądanie „Invalid time value”. */
function _day(iso) {
  const s = String(iso == null ? '' : iso).slice(0, 10);
  const d = new Date(s + 'T00:00:00Z');
  if (isNaN(d.getTime())) { const e = new RangeError(`Nieprawidłowa data „${String(iso).slice(0, 30)}” — oczekiwano RRRR-MM-DD.`); e.code = 'EDMAT_BAD_DATE'; throw e; }
  return d;
}
function addDays(iso, n) { const d = _day(iso); d.setUTCDate(d.getUTCDate() + (+n || 0)); return d.toISOString().slice(0, 10); }
function weekday(iso) { const d = _day(iso).getUTCDay(); return d === 0 ? 7 : d; } // 1=Mon..7=Sun
function daysBetween(a, b) { return Math.round((_day(b) - _day(a)) / 86400000); }
function minutesBetween(aIso, bIso) { return Math.round((new Date(bIso) - new Date(aIso)) / 60000); }

/** Polish plural: plural(3, 'wpis', 'wpisy', 'wpisów') */
function plural(n, one, few, many) {
  if (n === 1) return one;
  const m10 = n % 10, m100 = n % 100;
  if (m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14)) return few;
  return many;
}

/** PESEL: 11 digits, weights 1 3 7 9 1 3 7 9 1 3, control = (10 - sum % 10) % 10. Returns {ok, error, position, birthDate, sex}. */
function validatePesel(pesel) {
  if (typeof pesel !== 'string' || !/^\d{11}$/.test(pesel)) return { ok: false, error: 'PESEL musi mieć 11 cyfr.' };
  const w = [1, 3, 7, 9, 1, 3, 7, 9, 1, 3];
  const sum = w.reduce((s, wi, i) => s + wi * +pesel[i], 0);
  const control = (10 - (sum % 10)) % 10;
  if (control !== +pesel[10]) return { ok: false, error: `Błędna suma kontrolna: cyfra na pozycji 11 to ${pesel[10]}, a z pozostałych dziesięciu wynika ${control}.`, position: 11, expected: control };
  let yy = +pesel.slice(0, 2), mm = +pesel.slice(2, 4), dd = +pesel.slice(4, 6), century = 1900;
  if (mm > 80) { century = 1800; mm -= 80; } else if (mm > 60) { century = 2200; mm -= 60; } else if (mm > 40) { century = 2100; mm -= 40; } else if (mm > 20) { century = 2000; mm -= 20; }
  const birthDate = `${century + yy}-${String(mm).padStart(2, '0')}-${String(dd).padStart(2, '0')}`;
  const d = new Date(birthDate + 'T00:00:00Z');
  if (isNaN(d) || d.toISOString().slice(0, 10) !== birthDate) return { ok: false, error: 'Data urodzenia zakodowana w PESEL jest nieprawidłowa (pozycje 1–6).', position: 3 };
  return { ok: true, birthDate, sex: +pesel[9] % 2 === 1 ? 'M' : 'K' };
}

/** Values that are entries, not marks: np (nieprzygotowanie), bz (brak zadania),
 *  nk (nieklasyfikowany — art. 44k ustawy), zw (zwolniony — § 5 rozporządzenia o ocenianiu). */
const SPECIAL_VALUES = ['np', 'bz', 'nk', 'zw'];
/** Grade maths. A value is "1".."6" with optional + or -, or np / bz / nk / zw. */
function parseGrade(text, cfg) {
  const s = String(text == null ? '' : text).trim().toLowerCase().replace(/−/g, '-');
  if (SPECIAL_VALUES.includes(s)) return { special: s, text: s };
  const m = /^([1-6])([+-])?$/.exec(s); if (!m) return null;
  const plus = cfg && cfg.plusMinus ? cfg.plusMinus.plus : 0.5, minus = cfg && cfg.plusMinus ? cfg.plusMinus.minus : -0.25;
  const v = +m[1], mod = m[2] || '';
  let num = v + (mod === '+' ? plus : mod === '-' ? minus : 0);
  if (v === 6 && mod === '+') num = 6; if (v === 1 && mod === '-') num = 1;
  return { value: num, text: m[1] + mod, base: v, mod };
}
/** points → percent → grade by the school scale [{min, grade}] descending.
 *  The threshold is compared against the exact ratio, never against the rounded percent, so
 *  89,96 % stays a 4 instead of being rounded up into the 90 % band for a 5. */
function pointsToGrade(points, max, scale) {
  const exact = max > 0 ? (points / max) * 100 : 0;
  const pct = Math.round(exact * 10) / 10;
  const s = (scale || []).slice().sort((a, b) => b.min - a.min);
  const hit = s.find((x) => exact >= x.min - 1e-9); // 1e-9: a binary-fraction miss, not a real 0,000 000 1 pp
  return { percent: pct, grade: hit ? hit.grade : 1 };
}
/**
 * Weighted (or arithmetic) average of grades. Each grade {value, weight, countsInAverage, retakeOfId, id, deleted}.
 * Retake rule: 'higher' (only the higher of original/retake), 'average' (both count), 'regulation' (retake replaces original).
 */
function average(grades, opts) {
  const cfg = opts || {}; const rule = cfg.retakeRule || 'higher'; const weighted = cfg.weighted !== false;
  const live = grades.filter((g) => !g.deleted && g.countsInAverage !== false);
  const byId = Object.fromEntries(live.map((g) => [g.id, g]));
  const skip = new Set();
  // One original may carry more than one retake row (a second sitting, a corrected entry). Only the
  // last of them is the retake; the earlier ones never count, whatever the school rule says.
  const retakesOf = new Map();
  for (const g of live) {
    if (!g.retakeOfId || !byId[g.retakeOfId]) continue;
    const p = parseGrade(g.value, cfg);
    if (!p || p.value == null) continue; // np/bz as a "retake" is not a mark — leave both rows alone
    (retakesOf.get(g.retakeOfId) || retakesOf.set(g.retakeOfId, []).get(g.retakeOfId)).push(g);
  }
  for (const [origId, list] of retakesOf) {
    const ordered = list.slice().sort((a, b) => (String(a.date || '') < String(b.date || '') ? -1 : String(a.date || '') > String(b.date || '') ? 1 : 0));
    const last = ordered[ordered.length - 1];
    for (const g of ordered) if (g !== last) skip.add(g.id);
    const orig = byId[origId];
    if (rule === 'average') continue;
    if (rule === 'regulation') { skip.add(orig.id); continue; }
    const pv = parseGrade(last.value, cfg), po = parseGrade(orig.value, cfg);
    if (po && po.value != null && po.value >= pv.value) skip.add(last.id); else skip.add(orig.id);
  }
  let num = 0, den = 0, n = 0;
  for (const g of live) {
    if (skip.has(g.id)) continue;
    const p = parseGrade(g.value, cfg); if (!p || p.value == null) continue;
    const w = weighted ? (g.weight || 1) : 1; num += p.value * w; den += w; n++;
  }
  return den ? { average: Math.round((num / den) * 100) / 100, count: n } : { average: null, count: 0 };
}
const fmtAvg = (v) => (v == null ? '—' : v.toFixed(2).replace('.', ','));
/**
 * Polish attendance arithmetic, counted in godziny lekcyjne (one row = one lesson hour).
 * present  = ob, sp (spóźnienie is an attendance), rs (reprezentuje szkołę), w (wycieczka)
 * absent   = nb (nieusprawiedliwiona) + u (usprawiedliwiona) — both are absences from the lesson
 * zw       = zwolniony (a release from the subject or an early leave signed off): the hour is not
 *            owed, so it leaves the base entirely instead of counting as an absence. Without this a
 *            pupil released from PE for the year would show 0 % attendance.
 * `counted` is the base of every percentage; `total` stays the raw number of rows.
 */
function attendanceStats(entries) {
  const c = { ob: 0, nb: 0, sp: 0, zw: 0, u: 0, rs: 0, w: 0, total: 0, lateMinutes: 0 };
  for (const e of entries) { if (e.draft) continue; c[e.status] = (c[e.status] || 0) + 1; c.total++; if (e.status === 'sp') c.lateMinutes += e.minutes || 0; }
  const present = c.ob + c.sp + c.rs + c.w, excused = c.zw + c.u, absent = c.nb + c.u;
  const counted = c.total - c.zw;
  const pct = (n) => (counted ? Math.round((n / counted) * 1000) / 10 : null);
  return Object.assign(c, {
    present, excused, absent, counted,
    percent: pct(present),
    /** nieusprawiedliwione godziny — decyduje o zgodzie rady na egzamin klasyfikacyjny */
    unexcusedPercent: pct(c.nb),
    /** wszystkie nieobecności — art. 44k: powyżej połowy godzin uczeń może nie być klasyfikowany */
    absentPercent: pct(absent)
  });
}

module.exports = { id, now, today, clone, fmtDate, addDays, weekday, daysBetween, minutesBetween, plural, validatePesel, parseGrade, pointsToGrade, average, fmtAvg, attendanceStats, DEFAULT_TZ, envTimezone, localDate, localTime, zoneOffsetMinutes, toInstant };
