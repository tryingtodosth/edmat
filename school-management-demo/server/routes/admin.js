'use strict';
/* 3.5 — Administrator: struktura roku szkolnego (3.5.4), import planu lekcji (3.5.5), reset hasła (3.5.6),
   wymuszenie 2FA dla edytujących oceny i frekwencję (3.5.7), uprawnienia wiadomości (3.5.9),
   kody rejestracyjne dla rodziców klas pierwszych + rejestracja konta (3.5.11), lista dozwolonych IP (3.5.12),
   anonimizowana kopia bazy dla środowisk testowych (3.5.13), retencja i niezmienność logów (3.5.15). */
const D = require('../lib/domain');
const { httpError } = require('../lib/router');
const U = require('../lib/util');
const C = require('../lib/crypto');
const auth = require('../auth');
const { makeCode, sendHtml } = require('./registry');
const { syncLessons, lessonHorizon, recordImport } = require('./setup');
const RET = require('./retention');                     // klasy dokumentacji i reguła zegara (R5, docs/RETENTION.md)
const TT = require('../lib/timetable');                 // model pozycji planu: tydzień A/B, grupy, źródło (R1)
const TD = require('../lib/textdecode');                // BOM + <meta charset> + własna tablica cp1250 (R1)
const CSVP = require('../lib/csv');                     // CSV z cudzysłowami (RFC 4180), separator wykrywany (R1)
const ASC = require('../lib/import-asc');               // aSc Timetables XML (R1)
const OPT = require('../lib/import-optivum');           // publikacja HTML „Plan lekcji Optivum” (R1)
const crypto = require('node:crypto');

const ADMIN = ['admin'];
let APP = null;                    // do dziennika serwera (S3-19): szczegóły błędu parsera nie wychodzą w odpowiedzi
const ISO = /^\d{4}-\d{2}-\d{2}$/;

/* ------------------------------------------------------------- GAP-1: konta pracowników (3.5.6) */
const STAFF_ROLES = auth.STAFF;
/** Role, które prowadzą notatki szyfrowane end-to-end — konto powstaje z parą kluczy RSA, jak w zasiewie. */
const KEY_ROLES = ['counselor', 'psychologist', 'specialEducator', 'speechTherapist', 'supportTeacher', 'nurse'];
const LOGIN_RE = /^[a-z0-9.]{3,32}$/;
const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[a-z]{2,}$/i;
const staffSlug = (x) => String(x || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/ł/g, 'l').replace(/[^a-z0-9]+/g, '.').replace(/^\.|\.$/g, '');
const uniqueLogin = (db, base) => { let l = base || 'pracownik', i = 1; while (db.one('users', (u) => u.login === l)) l = `${base}${++i}`; return l; };
/** Ilu administratorów naprawdę może się jeszcze zalogować — szkoła bez żadnego jest nie do odzyskania. */
const activeAdmins = (db) => db.col('users').filter((u) => u.role === 'admin' && !u.blocked).length;
function assertAdminRemains(db, u, next) {
  if (u.role !== 'admin') return;
  const stillAdmin = next.role === 'admin' && !next.blocked;
  if (!stillAdmin && activeAdmins(db) <= 1) throw httpError(409, 'To jedyne czynne konto administratora — najpierw załóż albo odblokuj inne, inaczej szkoła zostanie bez administracji.', { code: 'last_admin' });
}
/** Ta sama operacja, co `POST /api/principal/users/:id/block` (3.3.18); tamta nie jest eksportowana. */
function cutSessions(db, userId) {
  let web = 0, mobile = 0;
  for (const ses of db.col('sessions')) { if (ses.userId !== userId || ses.revoked) continue; ses.revoked = true; ses.revokedReason = 'blocked'; ses.revokedAt = U.now(); if (ses.client === 'mobile') mobile++; else web++; }
  return { total: web + mobile, web, mobile };
}
function staffView(db, u) {
  return { id: u.id, login: u.login, role: u.role, title: u.title || '', firstName: u.firstName || '', lastName: u.lastName || '',
    name: D.userLabel(u), email: u.email || '', phone: u.phone || '', subjects: u.subjects || [], homeroomOf: u.homeroomOf || null,
    blocked: !!u.blocked, blockedReason: u.blockedReason || null, mustChangePassword: !!u.mustChangePassword,
    totpEnabled: !!u.totpEnabled, hasKeys: !!u.publicKey, lastLogin: u.lastLogin || null, createdAt: u.createdAt || null,
    sessions: db.col('sessions').filter((x) => x.userId === u.id && !x.revoked).length };
}
/** Wychowawstwo jest jedno na oddział: przejęcie czyści wpis u poprzednika (tak samo robi import kreatora). */
function setHomeroom(db, u, classId) {
  const out = { released: null, taken: null };
  if (u.homeroomOf && u.homeroomOf !== classId) { const old = db.get('classes', u.homeroomOf); if (old && old.homeroomTeacherId === u.id) old.homeroomTeacherId = null; out.released = u.homeroomOf; }
  u.homeroomOf = classId || null;
  if (classId) {
    const cls = db.get('classes', classId); if (!cls) throw httpError(400, 'Nie ma takiego oddziału: ' + classId + '.', { field: 'homeroomOf' });
    const prev = cls.homeroomTeacherId && db.get('users', cls.homeroomTeacherId);
    if (prev && prev.id !== u.id) prev.homeroomOf = null;
    cls.homeroomTeacherId = u.id; out.taken = { classId: cls.id, from: prev ? D.userLabel(prev) : null };
  }
  return out;
}
function checkSubjects(db, list) {
  const ids = (Array.isArray(list) ? list : String(list || '').split('|')).map((x) => String(x).trim()).filter(Boolean);
  const unknown = ids.filter((id) => !db.get('subjects', id));
  if (unknown.length) throw httpError(400, 'Nieznane przedmioty: ' + unknown.join(', ') + '.', { field: 'subjects', unknown });
  return ids;
}
const overlap = (a, b) => a.from <= b.to && b.from <= a.to;

/* --------------------------------------------------------------- struktura roku (3.5.4) */
function validateYear(next) {
  const errors = [];
  const ranges = [];
  const push = (kind, name, from, to) => {
    if (!ISO.test(String(from || '')) || !ISO.test(String(to || ''))) { errors.push(`${name}: daty muszą mieć format RRRR-MM-DD.`); return; }
    if (from > to) { errors.push(`${name}: data początkowa ${U.fmtDate(from)} jest późniejsza niż końcowa ${U.fmtDate(to)}.`); return; }
    ranges.push({ kind, name, from, to });
  };
  (next.semesters || []).forEach((s, i) => push('semester', s.name || `Semestr ${s.id || i + 1}`, s.from, s.to));
  if (next.winterBreak) push('break', next.winterBreak.name || 'Ferie zimowe', next.winterBreak.from, next.winterBreak.to);
  (next.holidays || []).forEach((hd) => push('break', hd.name || 'Przerwa świąteczna', hd.from, hd.to));
  const sem = ranges.filter((r) => r.kind === 'semester'), brk = ranges.filter((r) => r.kind === 'break');
  for (let i = 0; i < sem.length; i++) for (let j = i + 1; j < sem.length; j++) if (overlap(sem[i], sem[j])) errors.push(`Semestry nachodzą na siebie: „${sem[i].name}” (${U.fmtDate(sem[i].from)}–${U.fmtDate(sem[i].to)}) i „${sem[j].name}” (${U.fmtDate(sem[j].from)}–${U.fmtDate(sem[j].to)}).`);
  for (let i = 0; i < brk.length; i++) for (let j = i + 1; j < brk.length; j++) if (overlap(brk[i], brk[j])) errors.push(`Przerwy nachodzą na siebie: „${brk[i].name}” i „${brk[j].name}”.`);
  const seen = new Set();
  for (const d of next.daysOff || []) {
    if (!ISO.test(String(d.date || ''))) { errors.push(`Dzień wolny „${d.name || ''}”: data musi mieć format RRRR-MM-DD.`); continue; }
    if (seen.has(d.date)) errors.push(`Dzień wolny ${U.fmtDate(d.date)} jest wpisany dwa razy.`); seen.add(d.date);
    const inside = brk.find((b) => d.date >= b.from && d.date <= b.to);
    if (inside) errors.push(`Dzień wolny ${U.fmtDate(d.date)} („${d.name || ''}”) mieści się w przerwie „${inside.name}” — usuń jeden z wpisów.`);
  }
  return errors;
}

/* ------------------------------------------------------------ import planu lekcji (3.5.5) */
const CSV_HEADER = 'class;weekday;lessonNo;subject;teacherLogin;room;group';
const FORMATS = ['csv', 'json', 'asc-xml', 'optivum-html'];

/* Numer lekcji sprawdzamy po **istnieniu dzwonka o tym numerze**, a nie po długości tablicy.
   Dawne `no >= 1 && no <= lessonTimes.length` miało dwie wady: godziny „0” (7:10 — realny kształt
   w eksportach aSc, patrz `asc/plan-extra.xml`) nie dało się wgrać przy żadnej konfiguracji, a po
   dopisaniu `{ no: 0 }` do ośmioelementowej listy przechodził numer 9, którego nie ma.
   `server/routes/parent.js` liczył tę samą granicę przez `max(t.no)` — te dwa miejsca się rozjeżdżały. */
const bells = (db) => (db.data.config.lessonTimes || []);
const knownLessonNo = (db, no) => Number.isInteger(no) && bells(db).some((t) => +t.no === no);
const bellList = (db) => bells(db).map((t) => t.no).sort((a, b) => a - b);
function lessonNoError(db, where, raw) {
  const nos = bellList(db);
  const zero = Number(raw) === 0
    ? ' Plik ma „godzinę 0” (zwykle 7:10) — dopisz ją do planu dzwonków: PATCH /api/admin/year z polem lessonTimes (karta „Struktura roku szkolnego” → „Plan dzwonków”, przycisk „Dodaj godzinę 0”), a potem wgraj plan jeszcze raz.'
    : '';
  return `${where}: numer lekcji „${raw}” nie ma odpowiednika w planie dzwonków (są: ${nos.length ? nos.join(', ') : 'brak'}).${zero}`;
}

/* ----------------------------------------------------------- R1: prawdziwe formaty szkół
   Nasz CSV (`class;weekday;…`) jest formatem wymyślonym — szkoły mają eksport XML z aSc Timetables
   albo publikację HTML „Plan lekcji Optivum”. Oba wchodzą tą samą trasą; rozpoznajemy je po treści,
   a dekodowanie (BOM, `<meta charset>`, windows-1250) robi `server/lib/textdecode.js`.
   Pełny opis: docs/IMPORT.md. */
function detectFormat(payload) {
  if (Array.isArray(payload)) return 'json';
  if (payload && typeof payload === 'object' && !Buffer.isBuffer(payload)) return 'optivum-html';   // mapa plików z katalogu
  const head = TD.decode(TD.toBuffer(payload), { default: 'utf-8' }).text.slice(0, 8000);
  if (ASC.looksLikeAsc(head)) return 'asc-xml';
  if (OPT.looksLikeOptivum(head)) return 'optivum-html';
  if (/^\s*[[{]/.test(head.trim())) return 'json';
  return 'csv';
}

/* Dopasowanie encji obcego pliku do naszej bazy. W aSc identyfikatory (`*17`) są lokalne dla eksportu
   i zmieniają się przy każdym zapisie, a Optivum nie ma ich wcale — zostaje skrót („KE”), nazwa
   („Matematyka”) i nazwa oddziału („7 A”). Dopasowujemy więc po kolei: skrót → nazwa → klucz →
   dopasowanie miękkie (bez diakrytyków, po tokenach: „j.polski” ↔ „Język polski”, „w-f” ↔ „wf”). */
const nrm = (s) => String(s == null ? '' : s).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/ł/g, 'l').replace(/[^a-z0-9]+/g, '');
const toks = (s) => String(s == null ? '' : s).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/ł/g, 'l').split(/[^a-z0-9]+/).filter(Boolean);
/** Skrót, jakim posługują się aSc i Optivum: pierwsza litera nazwiska + pierwsza litera imienia. */
const teacherShort = (u) => String(u.short || ((u.lastName || '')[0] || '') + ((u.firstName || '')[0] || ''));
function localCandidates(db, kind) {
  /* S3-18 — kandydatami na nauczyciela lekcji były **wszystkie** konta poza uczniem i rodzicem, więc
     mapowanie mogło wpisać do dziennika inspektora ochrony danych albo bibliotekarkę jako nauczyciela
     matematyki 7b (a `teachersOfStudent()` otwiera im wtedy graf korespondencji). Lekcję może
     prowadzić tylko ten, kto może ją ocenić. */
  if (kind === 'teachers') return db.col('users').filter((u) => auth.GRADE_EDITORS.includes(u.role))
    .map((u) => ({ id: u.id, label: D.userLabel(u), keys: [u.login, teacherShort(u), `${u.lastName} ${u.firstName}`, `${u.firstName} ${u.lastName}`], toks: toks(`${u.lastName} ${u.firstName}`) }));
  if (kind === 'classes') return db.col('classes').map((c) => ({ id: c.id, label: c.name, keys: [c.id, c.name], toks: toks(c.name) }));
  if (kind === 'subjects') return db.col('subjects').map((s) => ({ id: s.id, label: s.name, keys: [s.id, s.name], toks: toks(s.name) }));
  if (kind === 'groups') return db.col('groups').map((g) => ({ id: g.id, label: g.name, classIds: g.classIds || [], keys: [g.id, g.name], toks: toks(g.name) }));
  if (kind === 'rooms') return [...new Set(db.col('timetable').map((t) => t.room).filter(Boolean))].map((r) => ({ id: r, label: r, keys: [r], toks: toks(r) }));
  return [];
}
/** Każdy token obcej nazwy musi być przedrostkiem odpowiadającego tokenu naszej — i tyle samo tokenów.
    Dopasowanie miękkie wymaga choć jednego tokenu ≥ 4 znaków i nie działa na samych cyfrach, inaczej
    sala „3” wskoczyłaby na salę „30”, a oddział „1” na „1a”. */
function tokenPrefix(a, b) {
  if (!a.length || a.length !== b.length) return false;
  if (!a.some((t) => t.length >= 4 && /[a-z]/.test(t))) return false;
  return a.every((t, i) => b[i].startsWith(t));
}
function matchEntity(cands, ent) {
  const tiers = [['short', ent.short], ['name', ent.name], ['key', ent.key]];
  let ambiguous = null;
  /* Niejednoznaczność na jednym poziomie nie kończy szukania: skrót „SB” pasuje do dwóch kont, ale
     imię i nazwisko z pliku (aSc ma `firstname` + `lastname`) rozstrzyga to na następnym poziomie. */
  for (const [how, value] of tiers) {
    const v = nrm(value);
    if (!v) continue;
    const hits = cands.filter((c) => c.keys.some((k) => nrm(k) === v));
    if (hits.length === 1) return { matched: hits[0].id, how, candidates: hits };
    if (hits.length > 1 && !ambiguous) ambiguous = hits;
  }
  for (const value of [ent.name, ent.key, ent.short]) {
    const t = toks(value);
    if (!t.length) continue;
    const hits = cands.filter((c) => tokenPrefix(t, c.toks) || c.keys.some((k) => tokenPrefix(t, toks(k))));
    if (hits.length === 1) return { matched: hits[0].id, how: 'fuzzy', candidates: hits };
    if (hits.length > 1 && !ambiguous) ambiguous = hits;
  }
  if (ambiguous) return { matched: null, how: 'ambiguous', candidates: ambiguous };
  return { matched: null, how: 'unmatched', candidates: [] };
}
/** Ile wierszy pliku dotyka każdej encji — po to, żeby człowiek wiedział, co odpada bez mapowania. */
function entityUsage(parsed) {
  const u = { teachers: {}, classes: {}, subjects: {}, rooms: {}, groups: {} };
  const bump = (k, key) => { if (key) u[k][key] = (u[k][key] || 0) + 1; };
  for (const r of parsed.rows) { bump('classes', r.classKey); bump('subjects', r.subjectKey); bump('rooms', r.roomKey); bump('groups', groupEntityKey(r)); for (const t of r.teacherKeys || []) bump('teachers', t); }
  return u;
}
/* OPS3-02 — podział z pliku jako piąty rodzaj dopasowania. Do tej pory `groupLabel` („1. grupa”,
   „Chłopcy”) jechał w wierszu planu jako napis, a `groupId` zostawał `null`: `rosterIds()`
   (server/routes/attendance.js) klucza wyłącznie po `groupId`, więc nauczycielka angielskiego
   otwierała lekcję grupy i widziała **cały oddział**. Etykieta jest lokalna dla oddziału (każda klasa
   ma swoją „1. grupę”), więc kluczem dopasowania jest `oddział-z-pliku|etykieta`. */
const groupEntityKey = (r) => (r.groupLabel ? `${r.classKey}|${r.groupLabel}` : null);
/** Encje „podziałów” zbierane z wierszy — parser ich nie wypisuje, bo w pliku nie są słownikiem. */
function groupEntities(parsed) {
  const seen = new Map();
  for (const r of parsed.rows) {
    const key = groupEntityKey(r); if (!key) continue;
    if (!seen.has(key)) seen.set(key, { key, short: '', name: r.groupLabel, classKey: r.classKey, label: r.groupLabel, subjectKeys: new Set() });
    if (r.subjectKey) seen.get(key).subjectKeys.add(r.subjectKey);
  }
  return [...seen.values()];
}
const MAP_KINDS = ['teachers', 'classes', 'subjects', 'rooms', 'groups'];
const BLOCKING = ['teachers', 'classes', 'subjects'];                 // sala i podział to wolny tekst — nigdy nie blokują
/** Żądanie „załóż to u nas” z tabeli dopasowania; osobna wartość, żeby nie mylić jej z identyfikatorem. */
const NEW_TARGET = '@new';
const CREATABLE = ['subjects', 'classes', 'groups'];
/**
 * Propozycja dopasowania do przejrzenia przez człowieka + gotowe `mapping`, które klient może
 * poprawić i odesłać przy właściwym imporcie. `null` w `mapping` = „pomiń wiersze tej encji”.
 */
function buildProposal(db, parsed, mapping) {
  const m = mapping || {};
  const usage = entityUsage(parsed);
  const out = { tool: parsed.tool, ref: parsed.ref, unmatched: {}, options: {}, pending: { subjects: [], classes: [], groups: [] } };
  const resolved = {};
  const entitiesOf = (kind) => (kind === 'groups' ? groupEntities(parsed) : (parsed.entities[kind] || []));
  for (const kind of MAP_KINDS) {
    const allCands = localCandidates(db, kind);
    out.options[kind] = allCands.map((c) => ({ id: c.id, label: c.label }));
    const has = m[kind] && typeof m[kind] === 'object';
    out[kind] = entitiesOf(kind).map((ent) => {
      /* Podział należy do oddziału: kandydatami są tylko grupy tego oddziału (albo międzyoddziałowe). */
      const localClass = kind === 'groups' ? ((resolved.classes || {})[ent.classKey] || {}).matched || null : null;
      const cands = kind === 'groups' ? allCands.filter((c) => !c.classIds.length || !localClass || c.classIds.includes(localClass)) : allCands;
      const matchArg = kind === 'groups' ? { short: '', name: ent.name, key: ent.name } : ent;
      const given = has && Object.prototype.hasOwnProperty.call(m[kind], ent.key) ? m[kind][ent.key] : undefined;
      let r;
      if (given === undefined) r = matchEntity(cands, matchArg);
      else if (given === NEW_TARGET && CREATABLE.includes(kind)) r = { matched: null, how: 'create', candidates: [] };
      else if (given === null && kind === 'rooms') r = { matched: null, how: 'verbatim', candidates: [] };
      else if (given === null || given === '') r = { matched: null, how: 'skipped', candidates: [] };
      else r = { matched: String(given), how: 'mapping', candidates: [] };
      if (r.how === 'mapping' && kind !== 'rooms' && !cands.some((c) => c.id === r.matched)) r = { matched: null, how: 'unknown_target', candidates: [], badTarget: String(given) };
      /* „Załóż u nas” — identyfikator liczymy tu, żeby wiersze planu mogły go już użyć, ale nic nie
         zapisujemy: gotowy dokument leży w `proposal.pending` i wchodzi do bazy dopiero przy zapisie
         planu, po wszystkich kontrolach. Próba pokazuje więc dokładnie to, co zrobi zapis. */
      if (r.how === 'create') {
        const made = pendingEntity(db, kind, ent, out, resolved, parsed);
        if (made) { r = { matched: made.id, how: 'create', candidates: [], created: made }; out.pending[kind].push(made); }
        else r = { matched: null, how: 'unknown_target', candidates: [], badTarget: NEW_TARGET };
      }
      const local = r.matched ? cands.find((c) => c.id === r.matched) : null;
      resolved[kind] = resolved[kind] || {};
      resolved[kind][ent.key] = r;
      return { key: ent.key, short: ent.short || '', name: ent.name || '', label: ent.name || ent.short || ent.key,
        classKey: kind === 'groups' ? ent.classKey : undefined, classId: kind === 'groups' ? localClass : undefined,
        matched: r.matched || null, matchedLabel: local ? local.label : (r.created ? r.created.name : (kind === 'rooms' && r.matched ? r.matched : null)),
        how: r.how, badTarget: r.badTarget || null, creates: r.created ? { id: r.created.id, name: r.created.name, members: (r.created.studentIds || []).length } : null,
        candidates: (r.candidates || []).map((c) => ({ id: c.id, label: c.label })), rows: usage[kind][ent.key] || 0 };
    });
    out.unmatched[kind] = out[kind].filter((x) => !x.matched && x.how !== 'skipped' && kind !== 'rooms' && kind !== 'groups').map((x) => x.key);
  }
  /* D3-51/OPS3-12 — `mapping` odsyłane bez zmian (to robi ekran i to pokazuje docs/IMPORT.md) nie może
     niczego stracić. Encji bez dopasowania **nie wpisujemy** jako `null`, bo `null` znaczy „człowiek
     zdecydował: pomiń”: klucza po prostu nie ma i encja dalej blokuje import. Dla sal `null` znaczy
     „zostaw tekst z pliku” — wcześniej kasował on numer sali we wszystkich wierszach naraz. */
  const decided = (kind, x) => (kind === 'rooms' ? true : !!x.matched || x.how === 'skipped');
  out.mapping = Object.fromEntries(MAP_KINDS.map((k) => [k, Object.fromEntries(out[k].filter((x) => decided(k, x)).map((x) => [x.key, x.matched]))]));
  out.exactMatches = Object.fromEntries(MAP_KINDS.map((k) => [k, out[k].filter((x) => ['short', 'name', 'key'].includes(x.how)).length]));
  out.blocking = BLOCKING.flatMap((k) => out.unmatched[k].map((key) => ({ kind: k, key })));
  out.creates = { subjects: out.pending.subjects.length, classes: out.pending.classes.length, groups: out.pending.groups.length };
  out._resolved = resolved;
  return out;
}
/** Dokument, który powstanie przy zapisie planu, gdy człowiek wybrał „załóż u nas”. Nic nie zapisuje. */
function pendingEntity(db, kind, ent, out, resolved, parsed) {
  const taken = (coll, id) => db.get(coll, id) || out.pending[kind].some((x) => x.id === id);
  if (kind === 'subjects') {
    const name = String(ent.name || ent.short || ent.key).trim();
    const base = nrm(name).slice(0, 12) || 'przedmiot';
    let id = base, n = 1; while (taken('subjects', id)) id = base.slice(0, 20) + (++n);
    const row = { id, name }; if (ent.short && ent.short !== name) row.short = String(ent.short).slice(0, 8);
    return row;
  }
  if (kind === 'classes') {
    const raw = String(ent.name || ent.short || ent.key).trim();
    const id = raw.toLowerCase().replace(/\s+/g, '').replace(/[^0-9a-z]/g, '');
    if (!/^[0-9]{1,2}[a-z]?$/.test(id) || taken('classes', id)) return null;
    return { id, name: raw.replace(/\s+/g, ''), level: +id.replace(/\D/g, '') || 1, homeroomTeacherId: null, studentIds: [] };
  }
  /* Grupa z pliku. Skład: plik nie mówi, kto jest w której połowie, więc rozdajemy listę oddziału
     po kolei (wg numerów w dzienniku) między wszystkie etykiety tego samego oddziału i przedmiotu —
     dwie etykiety dają dwie połowy. To jest propozycja: raport mówi wprost, że skład trzeba
     sprawdzić w „Grupach w oddziale”. Grupy już istniejące zachowują swój skład. */
  const classId = ((resolved.classes || {})[ent.classKey] || {}).matched;
  if (!classId) return null;
  const subjectKeys = [...(ent.subjectKeys || [])];
  const subjectId = subjectKeys.map((k) => ((resolved.subjects || {})[k] || {}).matched).filter(Boolean)[0] || null;
  const id0 = `g_${classId}_${TT.slugGroup(ent.label)}`;
  let id = id0, n = 1; while (taken('groups', id)) id = id0 + '_' + (++n);
  const siblings = groupEntities(parsed)
    .filter((g) => g.classKey === ent.classKey && subjectKeys.some((k) => g.subjectKeys.has(k)))
    .map((g) => g.label).sort((a, b) => String(a).localeCompare(String(b), 'pl'));
  const slot = Math.max(0, siblings.indexOf(ent.label));
  const parts = Math.max(1, siblings.length);
  const roster = db.col('students').filter((x) => x.classId === classId && x.status === 'active').sort((a, b) => (a.rollNo || 99) - (b.rollNo || 99));
  const studentIds = roster.filter((_, i) => i % parts === slot).map((x) => x.id);
  const cls = db.get('classes', classId);
  return { id, name: `${(cls && cls.name) || classId} / ${ent.label}`, kind: 'language', subjectId, classIds: [classId], studentIds, fromImport: true, labelFromFile: ent.label };
}
/** Obcy plan + zatwierdzone mapowanie → wiersze kolekcji `timetable` (nasze identyfikatory). */
function rowsFromForeign(db, parsed, proposal) {
  const rows = []; const errors = []; const skipped = { classes: 0, teachers: 0, subjects: 0, rows: 0 };
  const pick = (kind, key) => (proposal._resolved[kind] && proposal._resolved[kind][key]) || { matched: null, how: 'unmatched' };
  parsed.rows.forEach((r, i) => {
    const line = i + 1;
    const cls = pick('classes', r.classKey);
    if (!cls.matched) { skipped.rows++; if (cls.how === 'skipped') skipped.classes++; return; }
    const subj = pick('subjects', r.subjectKey);
    if (!subj.matched) { skipped.rows++; if (subj.how === 'skipped') skipped.subjects++; return; }
    const teacherIds = (r.teacherKeys || []).map((k) => pick('teachers', k).matched).filter(Boolean);
    if (!teacherIds.length) { skipped.rows++; skipped.teachers++; return; }
    if (!(r.weekday >= 1 && r.weekday <= 7)) { errors.push(`Wiersz ${line}: dzień tygodnia poza zakresem 1–7 (${r.weekday}).`); return; }
    if (!knownLessonNo(db, r.lessonNo)) { errors.push(lessonNoError(db, `Wiersz ${line}`, r.lessonNo)); return; }
    const roomHit = r.roomKey ? pick('rooms', r.roomKey) : { matched: null, how: 'skipped' };
    /* Sala nigdy nie blokuje i nigdy nie znika sama: bez dopasowania wjeżdża tekst z pliku
       (docs/IMPORT.md § 5). Skasować numer sali można wyłącznie jawnym `""` w `mapping.rooms`. */
    const room = r.roomKey ? (roomHit.matched || (roomHit.how === 'skipped' ? '' : r.roomKey)) : '';
    /* OPS3-02 — podział z pliku wiąże się z naszą grupą tylko wtedy, gdy dopasowanie to rozstrzygnęło
       (samo, mapowaniem albo „załóż u nas”). Bez tego zostaje sama etykieta, dokładnie jak przedtem. */
    const groupId = r.groupLabel ? (pick('groups', `${r.classKey}|${r.groupLabel}`).matched || null) : null;
    const row = { classId: cls.matched, weekday: r.weekday, lessonNo: r.lessonNo, subjectId: subj.matched,
      teacherId: teacherIds[0], teacherIds, room: String(room || ''), groupId, groupLabel: r.groupLabel || null,
      week: r.week || null, source: Object.assign({ tool: parsed.tool, ref: parsed.ref }, r.source || {}), line };
    row.id = TT.entryId(row);
    rows.push(row);
  });
  return { rows, errors, skipped };
}

function parseTimetablePayload(db, payload, format, opts) {
  const o = opts || {};
  const fmt = format || detectFormat(payload);
  if (fmt === 'asc-xml' || fmt === 'optivum-html') {
    let parsed;
    try {
      parsed = fmt === 'asc-xml' ? ASC.parseAsc(Buffer.isBuffer(payload) ? payload : TD.toBuffer(payload), { ref: o.ref })
        : OPT.parseOptivum(payload, { ref: o.ref });
    } catch (e) {
      /* S3-19 — komunikat V8 („Invalid code point 4294967295”, „Maximum call stack size exceeded”)
         nie mówi administratorowi nic i wypuszcza szczegóły silnika; do dziennika idzie `e.message`,
         do odpowiedzi jedno zdanie po polsku. */
      if (APP && APP.options && !APP.options.quiet) console.error('timetable import parse failed (' + fmt + '): ' + e.message);
      throw httpError(400, `Nie udało się odczytać pliku planu (${fmt === 'asc-xml' ? 'aSc XML' : 'publikacja Optivum'}). Sprawdź, czy to pełny, niezmieniony eksport z programu układającego plan.`, { code: 'parse_failed', format: fmt });
    }
    const proposal = buildProposal(db, parsed, o.mapping);
    const built = rowsFromForeign(db, parsed, proposal);
    delete proposal._resolved;
    return { rows: built.rows, errors: built.errors, format: fmt, parsed, proposal,
      warnings: parsed.warnings.slice(), skipped: built.skipped };
  }
  const rows = []; const errors = [];
  /* D3-56 — informacja o odgadniętym kodowaniu („plik wygląda na windows-1250”) była produkowana
     przez `textdecode`, przekazywana dalej przez oba importery XML/HTML i **gubiona** w gałęzi
     CSV/JSON: sekretarka wklejająca CSV w cp1250 widziała rozsypane polskie nazwiska bez słowa
     wyjaśnienia. */
  const warnings = [];
  const resolve = (raw, lineNo) => {
    const cls = db.get('classes', String(raw.class || raw.classId || '').trim());
    const wd = +raw.weekday, no = +raw.lessonNo;
    const subjRaw = String(raw.subject || raw.subjectId || '').trim();
    const subject = db.get('subjects', subjRaw) || db.one('subjects', (s) => s.name.toLowerCase() === subjRaw.toLowerCase());
    const loginRaw = String(raw.teacherLogin || raw.teacher || '').trim();
    const teacher = db.one('users', (u) => u.login === loginRaw) || db.get('users', loginRaw);
    const groupRaw = String(raw.group || raw.groupId || '').trim();
    const group = groupRaw && groupRaw !== '-' ? (db.get('groups', groupRaw) || db.one('groups', (g) => g.name === groupRaw)) : null;
    const where = `Wiersz ${lineNo}`;
    if (!cls) { errors.push(`${where}: nieznany oddział „${raw.class || ''}”.`); return null; }
    if (!(wd >= 1 && wd <= 7)) { errors.push(`${where}: dzień tygodnia musi być liczbą 1–7 (podano „${raw.weekday}”).`); return null; }
    if (!knownLessonNo(db, no)) { errors.push(lessonNoError(db, where, raw.lessonNo)); return null; }
    if (!subject) { errors.push(`${where}: nieznany przedmiot „${subjRaw}”.`); return null; }
    if (!teacher) { errors.push(`${where}: nieznany nauczyciel „${loginRaw}”.`); return null; }
    if (groupRaw && groupRaw !== '-' && !group) { errors.push(`${where}: nieznana grupa „${groupRaw}”.`); return null; }
    /* R1 — `week` i `groupLabel` wolno podać także w CSV/JSON (kolumny `week` i `groupLabel`);
       puste = stare zachowanie, czyli „co tydzień, podział po identyfikatorze grupy”. */
    const weekRaw = String(raw.week || '').trim().toUpperCase();
    if (weekRaw && !TT.WEEKS.includes(weekRaw)) { errors.push(`${where}: kolumna „week” przyjmuje tylko A albo B (podano „${raw.week}”).`); return null; }
    const row = { classId: cls.id, weekday: wd, lessonNo: no, subjectId: subject.id,
      teacherId: teacher.id, teacherIds: [teacher.id], room: String(raw.room || '').trim(),
      groupId: group ? group.id : null, groupLabel: String(raw.groupLabel || '').trim() || null,
      week: weekRaw || null, source: null, line: lineNo };
    row.id = TT.entryId(row);
    return row;
  };
  if (fmt === 'json' || Array.isArray(payload)) {
    let text = null;
    if (!Array.isArray(payload)) { const dec = TD.decode(TD.toBuffer(payload), { default: 'utf-8' }); text = dec.text; if (dec.note) warnings.push(dec.note); }
    const list = Array.isArray(payload) ? payload : JSON.parse(text);
    list.forEach((raw, i) => { const row = resolve(raw, i + 1); if (row) rows.push(row); });
  } else {
    /* Prawdziwy parser CSV zamiast `split(';')`: pole w cudzysłowach z separatorem w środku psuje
       każdy eksport z arkusza (patrz server/lib/csv.js i README fixture’ów §5). */
    const dec = TD.decode(TD.toBuffer(payload), { default: 'utf-8' });
    if (dec.note) warnings.push(dec.note);
    const parsedCsv = CSVP.parse(dec.text, { allowed: [';', ','] });
    parsedCsv.rows.forEach((parts, i) => {
      if (!parts.length || parts.every((p) => !p)) return;
      if (i === 0 && /^(class|klasa|oddzial|oddział)$/i.test(parts[0])) return; // nagłówek
      if (parts.length < 5) { errors.push(`Wiersz ${i + 1}: oczekiwano formatu ${CSV_HEADER}.`); return; }
      const row = resolve({ class: parts[0], weekday: parts[1], lessonNo: parts[2], subject: parts[3], teacherLogin: parts[4], room: parts[5], group: parts[6], week: parts[7], groupLabel: parts[8] }, i + 1);
      if (row) rows.push(row);
    });
  }
  return { rows, errors, format: fmt, warnings };
}
const WD_NAME = ['', 'poniedziałek', 'wtorek', 'środa', 'czwartek', 'piątek', 'sobota', 'niedziela'];
const ttWho = (db, r) => `${r.classId}${r.groupId ? ' / ' + r.groupId : (r.groupLabel ? ' / ' + r.groupLabel : '')}${r.week ? ' (tydz. ' + r.week + ')' : ''} ${(db.get('subjects', r.subjectId) || { name: r.subjectId }).name} (${(r.teacherIds && r.teacherIds.length ? r.teacherIds : [r.teacherId]).map((id) => D.userLabel(db.get('users', id))).join(' + ')})`;
/* R1 — konflikt to dopiero **nachodzenie w czasie i w składzie uczniów**. Dwie pozycje w tym samym
   `(classId, weekday, lessonNo)` kolidują tylko wtedy, gdy ich tygodnie nachodzą na siebie (`null`
   = co tydzień, nachodzi na wszystko) **i** ich grupy nachodzą na siebie (cały oddział vs dowolna
   grupa = kolizja, dwie różne grupy = nie). Tak samo nauczyciel i sala. Bez tego każdy prawdziwy
   plan z aSc zgłaszał setki fałszywych konfliktów (README fixture'ów, „Trzy rzeczy…” pkt 2). */
const pairsOf = (l) => { const out = []; for (let i = 0; i < l.length; i++) for (let j = i + 1; j < l.length; j++) out.push([l[i], l[j]]); return out; };
/** Jedna pozycja konfliktu na klucz (nauczyciel/sala/oddział) w danym okienku, z listą uwikłanych wierszy. */
function collide(list, clash) {
  const hit = new Set();
  for (const [a, b] of pairsOf(list)) if (TT.weeksOverlap(a.week, b.week) && clash(a, b)) { hit.add(a); hit.add(b); }
  return [...hit];
}
function findConflicts(db, rows) {
  const conflicts = []; const slots = {};
  const list0 = rows.map(TT.normalize);
  for (const row of list0) { const k = row.weekday + '|' + row.lessonNo; (slots[k] = slots[k] || []).push(row); }
  const who = (r) => ttWho(db, r);
  const sameLesson = (a, b) => a.room === b.room && a.subjectId === b.subjectId;                 // lekcja łączona
  const splitOfOneClass = (a, b) => a.classId === b.classId && a.subjectId === b.subjectId && TT.groupKey(a) && TT.groupKey(b);
  for (const k of Object.keys(slots)) {
    const inSlot = slots[k]; const [wd, no] = k.split('|');
    const at = `${WD_NAME[+wd]}, lekcja ${no}`;
    const byTeacher = {}, byRoom = {}, byClass = {};
    for (const r of inSlot) {
      for (const tid of r.teacherIds.length ? r.teacherIds : [r.teacherId]) (byTeacher[tid] = byTeacher[tid] || []).push(r);
      if (r.room) (byRoom[r.room] = byRoom[r.room] || []).push(r);
      (byClass[r.classId] = byClass[r.classId] || []).push(r);
    }
    for (const t of Object.keys(byTeacher)) {
      const l = collide(byTeacher[t], (a, b) => !sameLesson(a, b) && !splitOfOneClass(a, b));
      if (l.length) conflicts.push({ kind: 'teacher', weekday: +wd, lessonNo: +no, at, detail: `${D.userLabel(db.get('users', t))}: ${l.map(who).join(' oraz ')}.`, lines: l.map((x) => x.line) });
    }
    for (const rm of Object.keys(byRoom)) {
      const l = collide(byRoom[rm], (a, b) => !(a.teacherId === b.teacherId && a.subjectId === b.subjectId));
      if (l.length) conflicts.push({ kind: 'room', weekday: +wd, lessonNo: +no, at, detail: `Sala ${rm}: ${l.map(who).join(' oraz ')}.`, lines: l.map((x) => x.line) });
    }
    for (const c of Object.keys(byClass)) {
      const l = collide(byClass[c], (a, b) => TT.groupsOverlap(a, b));
      if (l.length) conflicts.push({ kind: 'class', weekday: +wd, lessonNo: +no, at, detail: `Oddział ${c} ma ${l.length} lekcje w tym samym czasie bez rozłącznego podziału na grupy: ${l.map(who).join(' oraz ')}.`, lines: l.map((x) => x.line) });
    }
  }
  return conflicts;
}

/* OPS-21 — import częściowy (`merge: true`) podmienia plan tylko dla wymienionych oddziałów, a
   pozycje pozostałych zostają w bazie. Sam `findConflicts` porównuje wgrywane wiersze wyłącznie
   między sobą, więc nie zauważyłby, że nauczyciel albo sala są o tej porze zajęte przez oddział
   spoza importu. Tu porównujemy wgrywane wiersze ze stanem zapisanym (`kept`) i sprawdzamy grupy
   całego planu po scaleniu. Każdy taki konflikt wraca w `conflicts` z `stored: true`. */
function findStoredConflicts(db, rows0, kept0) {
  const conflicts = [];
  const rows = rows0.map(TT.normalize), kept = kept0.map(TT.normalize);
  const bySlot = {};
  for (const t of kept) { const k = t.weekday + '|' + t.lessonNo; (bySlot[k] = bySlot[k] || []).push(t); }
  for (const row of rows) {
    const at = `${WD_NAME[row.weekday]}, lekcja ${row.lessonNo}`;
    for (const t of bySlot[row.weekday + '|' + row.lessonNo] || []) {
      if (!TT.weeksOverlap(row.week, t.week)) continue;               // R1: tydzień A nie koliduje z tygodniem B
      const sameLesson = t.teacherId === row.teacherId && t.subjectId === row.subjectId && t.room === row.room;
      if (t.teacherIds.some((x) => row.teacherIds.includes(x)) && !sameLesson) {
        conflicts.push({ kind: 'teacher', stored: true, weekday: row.weekday, lessonNo: row.lessonNo, at,
          detail: `${D.userLabel(db.get('users', row.teacherId))}: ${ttWho(db, row)} oraz ${ttWho(db, t)} — ta druga pozycja zostaje w planie, bo oddział ${t.classId} nie jest częścią tego importu.`,
          lines: [row.line], storedEntryId: t.id });
      }
      if (row.room && t.room === row.room && !sameLesson) {
        conflicts.push({ kind: 'room', stored: true, weekday: row.weekday, lessonNo: row.lessonNo, at,
          detail: `Sala ${row.room}: ${ttWho(db, row)} oraz ${ttWho(db, t)} — ta druga pozycja zostaje w planie, bo oddział ${t.classId} nie jest częścią tego importu.`,
          lines: [row.line], storedEntryId: t.id });
      }
    }
  }
  for (const row of rows.concat(kept)) {
    if (!row.groupId) continue;
    const g = db.get('groups', row.groupId);
    const at = `${WD_NAME[row.weekday]}, lekcja ${row.lessonNo}`;
    const lines = row.line ? [row.line] : [];
    if (!g) conflicts.push({ kind: 'group', stored: true, weekday: row.weekday, lessonNo: row.lessonNo, at, detail: `Grupa „${row.groupId}” nie istnieje w tej szkole (oddział ${row.classId}, ${ttWho(db, row)}).`, lines, storedEntryId: row.line ? null : row.id });
    else if (Array.isArray(g.classIds) && g.classIds.length && !g.classIds.includes(row.classId)) conflicts.push({ kind: 'group', stored: true, weekday: row.weekday, lessonNo: row.lessonNo, at, detail: `Grupa „${g.name}” należy do ${g.classIds.join(', ')}, a nie do oddziału ${row.classId}.`, lines, storedEntryId: row.line ? null : row.id });
  }
  return conflicts;
}

/** Co nowy plan zrobi z już wygenerowanymi lekcjami: ile zniknie, ile z nich ma wpisy, ile dojdzie. */
function lessonImpact(db, rows) {
  const { hasJournal, isSchoolDay, journalIndex } = require('./setup');
  const h = lessonHorizon(db); const next = new Set(rows.map((x) => x.id));
  if (h.empty) return { from: h.from, to: h.to, dropped: 0, withJournal: 0, added: 0, examples: [], firstImport: true };
  const idOf = (l) => l.id.replace(/^les_/, '').replace(new RegExp('_' + l.date + '$'), '');
  const written = journalIndex(db);                       // R3-01: jeden indeks zamiast skanu na lekcję
  let dropped = 0, withJournal = 0; const examples = [];
  for (const l of db.col('lessons')) {
    if (l.date < h.from || l.date > h.to || l.status === 'cancelled') continue;
    if (next.has(idOf(l))) continue;
    dropped++;
    if (hasJournal(db, l, written)) { withJournal++; if (examples.length < 10) examples.push({ id: l.id, date: l.date, classId: l.classId, lessonNo: l.lessonNo, subjectId: l.subjectId, status: l.status }); }
  }
  let added = 0; const have = new Set(db.col('lessons').map((l) => l.id));
  for (let d = h.from; d <= h.to; d = U.addDays(d, 1)) { if (!isSchoolDay(db, d)) continue; const wd = U.weekday(d); for (const t of rows) if (t.weekday === wd && TT.runsOn(db, t, d) && !have.has(`les_${t.id}_${d}`)) added++; }
  return { from: h.from, to: h.to, dropped, withJournal, added, examples };
}

/* --------------------------------------------------- anonimizacja kopii testowej (3.5.13) */
const SALT = 'edmat-anon-v1';
const hx = (kind, seed) => C.sha256(SALT + '|' + kind + '|' + String(seed));
const digits = (hex, n) => hex.replace(/[a-f]/g, (c) => String(c.charCodeAt(0) % 10)).slice(0, n);
const pseudoLast = (v) => 'Nazwisko' + digits(hx('last', v), 4);
const pseudoFirst = (v) => 'Imie' + digits(hx('first', v), 3);
const pseudoEmail = (v) => 'konto' + digits(hx('mail', v), 6) + '@example.invalid';
const pseudoPhone = (v) => '+48 500 ' + digits(hx('tel', v), 3) + ' ' + digits(hx('tel2', v), 3);
const pseudoAddress = (v) => 'ul. Testowa ' + (1 + (+digits(hx('addr', v), 2) % 80)) + ', 00-000 Miasto';
const pseudoLogin = (v) => 'konto.' + digits(hx('login', v), 5);
function pseudoPesel(v) {
  const d = digits(hx('pesel', v), 10).split('').map(Number);
  d[2] = 0; d[3] = 1 + (d[3] % 9); d[4] = 0; d[5] = 1 + (d[5] % 9);      // poprawny miesiąc i dzień
  const w = [1, 3, 7, 9, 1, 3, 7, 9, 1, 3];
  return d.join('') + ((10 - (w.reduce((s, wi, i) => s + wi * d[i], 0) % 10)) % 10);
}
const LETTER = 'A-Za-z0-9ĄĆĘŁŃÓŚŹŻąćęłńóśźż_';
const escRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
function anonymizedSnapshot(db) {
  const snap = db.snapshot();
  const pairs = new Map();                                              // token → zamiennik (deterministycznie z sha256)
  const add = (tok, rep) => { const t = String(tok || '').trim(); if (t.length >= 3 && !pairs.has(t)) pairs.set(t, rep); };
  for (const u of snap.users || []) {
    add(u.lastName, pseudoLast(u.lastName)); add(u.firstName, pseudoFirst(u.firstName));
    if (u.email) add(u.email, pseudoEmail(u.email));
    if (u.phone) add(u.phone, pseudoPhone(u.phone));
    if (String(u.login || '').includes('.')) add(u.login, pseudoLogin(u.login));
  }
  for (const s of snap.students || []) {
    add(s.lastName, pseudoLast(s.lastName)); add(s.firstName, pseudoFirst(s.firstName));
    if (s.pesel) add(s.pesel, pseudoPesel(s.pesel));
    if (s.passport) add(s.passport, 'PS' + digits(hx('pass', s.passport), 7));
    if (s.address) add(s.address, pseudoAddress(s.address));
    const g = (s.guardianContact || (Array.isArray(s.guardians) ? null : s.guardians)) || {};
    add(g.mother, pseudoLast(g.mother || '') + ' ' + pseudoFirst(g.mother || '')); add(g.father, pseudoLast(g.father || '') + ' ' + pseudoFirst(g.father || ''));
    if (g.phone) add(g.phone, pseudoPhone(g.phone)); if (g.email) add(g.email, pseudoEmail(g.email)); if (g.address) add(g.address, pseudoAddress(g.address));
  }
  for (const c of snap.districtChildren || []) { add(c.lastName, pseudoLast(c.lastName)); add(c.firstName, pseudoFirst(c.firstName)); if (c.address) add(c.address, pseudoAddress(c.address)); }
  // treści swobodne i sekrety znikają przed zamianą tokenów
  for (const u of snap.users || []) { delete u.passwordHash; delete u.totpSecret; delete u.totpPendingSecret; delete u.privateKey; delete u.publicKey; if (u.custodyNote) u.custodyNote = '[notatka zanonimizowana]'; }
  for (const m of snap.messages || []) { m.subject = '[temat zanonimizowany]'; m.body = '[treść zanonimizowana]'; m.attachments = []; }
  for (const n of snap.notifications || []) n.text = '[powiadomienie zanonimizowane]';
  for (const rm of snap.remarks || []) rm.text = '[uwaga zanonimizowana]';
  for (const dg of snap.descriptiveGrades || []) dg.text = '[ocena opisowa zanonimizowana]';
  for (const ex of snap.excuses || []) { ex.reason = '[powód zanonimizowany]'; ex.attachment = null; }
  for (const nt of snap.notes || []) if (nt.envelope) nt.envelope = { alg: nt.envelope.alg, anonymized: true };
  snap.sessions = [];
  if (snap.config) { delete snap.config.schoolPrivateKey; delete snap.config.schoolPublicKey; }
  // jeden przebieg po całym dokumencie: zamiana wszystkich pozostałych wystąpień danych osobowych
  let text = JSON.stringify(snap);
  const toks = [...pairs.keys()].sort((a, b) => b.length - a.length);
  for (const t of toks) {
    const wordish = /^[A-Za-zĄĆĘŁŃÓŚŹŻąćęłńóśźż0-9]/.test(t) && /[A-Za-zĄĆĘŁŃÓŚŹŻąćęłńóśźż0-9]$/.test(t);
    const re = wordish ? new RegExp(`(?<![${LETTER}])${escRe(t)}(?![${LETTER}])`, 'g') : new RegExp(escRe(t), 'g');
    text = text.replace(re, pairs.get(t));
  }
  const out = JSON.parse(text);
  out.config.anonymized = true;
  out.config.anonymizedAt = U.now();
  out.meta = Object.assign({}, out.meta, { anonymized: true, note: 'Kopia dla środowiska testowego: imiona, nazwiska, PESEL, kontakty i adresy zastąpiono pseudonimami (SHA-256, deterministycznie). Oceny, frekwencja, tematy lekcji i rejestr audytowy zachowane.' });
  return { snapshot: out, replaced: pairs.size, auditKept: (out.audit || []).length };
}

/* ------------------------------------------------------------------------------ helpers */
function tempPassword() {
  const up = 'ABCDEFGHJKLMNPQRSTUVWXYZ', lo = 'abcdefghijkmnopqrstuvwxyz', di = '23456789', sp = '!?@#$%-';
  const pick = (s, n) => Array.from(crypto.randomBytes(n)).map((b) => s[b % s.length]).join('');
  return pick(up, 2) + pick(lo, 4) + '-' + pick(di, 3) + pick(lo, 3) + pick(sp, 1) + pick(up, 1);
}
function validCidr(value) {
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})(?:\/(\d{1,2}))?$/.exec(String(value || '').trim());
  if (!m) return null;
  for (let i = 1; i <= 4; i++) if (+m[i] > 255 || (m[i].length > 1 && m[i][0] === '0')) return null;
  if (m[5] != null && (+m[5] > 32 || (m[5].length > 1 && m[5][0] === '0'))) return null;
  return String(value).trim();
}
const gradeEditors = (db) => db.col('users').filter((u) => auth.GRADE_EDITORS.includes(u.role));

/* ------------------------------------------------------------------------------- routes */
function register(r, app) {
  APP = app;
  app.sessionExtras.push((ctx) => ({ mustSetup2FA: !!ctx.user.mustSetup2FA, totpRequiredByPolicy: !!ctx.user.totpRequired }));

  /* --- 3.5.4 struktura roku szkolnego -------------------------------------------------- */
  r.get('/api/admin/year', (ctx) => {
    const c = ctx.db.data.config;
    /* OPS3-03 — plan dzwonków wraca razem ze strukturą roku, żeby „odeślij to, co dostałeś”
       (co robi ekran i co pokazuje docs/IMPORT.md) obejmowało także godziny lekcyjne.
       OPS3-30 — `weekCycleAnchor` jest tu z tego samego powodu: szkoła zaczynająca rok od tygodnia II
       przestawiała dotąd jedną wartość w pliku konfiguracyjnym. */
    return { year: c.year, semesters: c.semesters, winterBreak: c.winterBreak, holidays: c.holidays, daysOff: c.daysOff, today: c.today,
      lessonTimes: c.lessonTimes || [], weekCycleAnchor: c.weekCycleAnchor || null, weekAnchor: TT.weekAnchor(ctx.db) };
  }, { roles: ADMIN });

  r.patch('/api/admin/year', (ctx) => {
    const db = ctx.db; const c = db.data.config; const b = ctx.body || {};
    const next = {
      semesters: b.semesters || c.semesters, winterBreak: b.winterBreak !== undefined ? b.winterBreak : c.winterBreak,
      holidays: b.holidays || c.holidays, daysOff: b.daysOff || c.daysOff
    };
    const errors = validateYear(next);
    /* OPS3-03 — plan dzwonków. `lessonTimes` wolno pominąć (wtedy zostaje ten, który jest); przysłany
       przechodzi przez `TT.validateLessonTimes`: numery unikalne, godziny GG:MM, bez nachodzenia,
       posortowane po numerze. Numer 0 jest dozwolony — to jest cała sprawa „godziny zerowej”. */
    let lessonTimes = null;
    if (b.lessonTimes !== undefined) {
      const v = TT.validateLessonTimes(b.lessonTimes);
      if (!v.ok) errors.push(...v.errors); else lessonTimes = v.lessonTimes;
    }
    let anchor;
    if (b.weekCycleAnchor !== undefined) {
      const raw = b.weekCycleAnchor === null || b.weekCycleAnchor === '' ? null : String(b.weekCycleAnchor);
      if (raw !== null && !ISO.test(raw)) errors.push('Kotwica cyklu A/B: data musi mieć format RRRR-MM-DD (pusta wartość = pierwszy poniedziałek roku szkolnego).');
      else anchor = raw;
    }
    if (errors.length) throw httpError(400, errors[0], { code: 'year_invalid', errors });
    const before = { semesters: c.semesters, winterBreak: c.winterBreak, holidays: c.holidays, daysOff: c.daysOff, lessonTimes: c.lessonTimes, weekCycleAnchor: c.weekCycleAnchor || null };
    c.semesters = next.semesters.map((s, i) => Object.assign({ id: i + 1, name: `Semestr ${i + 1}`, locked: false }, s));
    c.winterBreak = next.winterBreak; c.holidays = next.holidays; c.daysOff = next.daysOff;
    if (lessonTimes) c.lessonTimes = lessonTimes;
    if (anchor !== undefined) { if (anchor) c.weekCycleAnchor = anchor; else delete c.weekCycleAnchor; }
    db.save();
    /* Kalendarz bez lekcji jest tylko obietnicą: dzień wolny dopisany po wygenerowaniu lekcji musi je zdjąć z planu,
       a cofnięty — przywrócić. Lekcje z wpisami w dzienniku wyłącznie odwołujemy, nigdy nie kasujemy. */
    const lessons = b.applyToLessons === false ? null : syncLessons(db, { reason: 'calendar_changed' });
    ctx.audit({ action: 'school_year_updated', entity: 'config', entityId: 'year', before, after: Object.assign({}, next, { lessons }), reason: b.reason || 'aktualizacja struktury roku szkolnego' });
    return { ok: true, year: c.year, semesters: c.semesters, winterBreak: c.winterBreak, holidays: c.holidays, daysOff: c.daysOff, lessonTimes: c.lessonTimes, weekCycleAnchor: c.weekCycleAnchor || null, weekAnchor: TT.weekAnchor(db), errors: [], lessons,
      message: lessons ? `Struktura roku zapisana. Lekcje uzgodnione z kalendarzem: odwołano ${lessons.cancelled}, usunięto ${lessons.removed} pustych, przywrócono ${lessons.restored}, dogenerowano ${lessons.created}.` : 'Struktura roku zapisana; lekcje pozostawiono bez zmian.' };
  }, { roles: ADMIN });

  /* --- grupy w oddziale (podział na języki, laboratoria, grupy międzyoddziałowe) -------- */
  const groupView = (db, g) => ({ id: g.id, name: g.name, kind: g.kind, subjectId: g.subjectId, classIds: g.classIds || [], studentIds: g.studentIds || [], members: (g.studentIds || []).length,
    timetableEntries: db.col('timetable').filter((t) => t.groupId === g.id).length,
    students: (g.studentIds || []).map((sid) => { const s = db.get('students', sid); return s ? { id: s.id, name: `${s.lastName} ${s.firstName}`, rollNo: s.rollNo, classId: s.classId } : { id: sid, name: sid }; }) });
  r.get('/api/admin/groups', (ctx) => {
    const db = ctx.db; const classId = ctx.query.classId || null;
    const groups = db.col('groups').filter((g) => !classId || (g.classIds || []).includes(classId)).map((g) => groupView(db, g));
    return { groups, kinds: ['language', 'lab', 'cross-class', 'other'],
      classes: db.col('classes').map((c) => ({ id: c.id, name: c.name, students: db.col('students').filter((s) => s.classId === c.id && s.status === 'active').map((s) => ({ id: s.id, name: `${s.lastName} ${s.firstName}`, rollNo: s.rollNo, groupIds: db.col('groups').filter((g) => (g.studentIds || []).includes(s.id)).map((g) => g.id) })) })) };
  }, { roles: ADMIN });

  const checkMembers = (db, ids, classIds) => {
    const out = [];
    for (const sid of ids || []) {
      const s = db.get('students', sid);
      if (!s) throw httpError(400, 'Nie ma takiego ucznia: ' + sid + '.', { field: 'studentIds', value: sid });
      if (s.status !== 'active') throw httpError(400, `Uczeń ${s.lastName} ${s.firstName} ma zamknięty wpis w księdze — nie można go dopisać do grupy.`, { field: 'studentIds', value: sid });
      if (classIds && classIds.length && !classIds.includes(s.classId)) throw httpError(400, `Uczeń ${s.lastName} ${s.firstName} jest w oddziale ${s.classId}, a grupa obejmuje ${classIds.join(', ')}.`, { field: 'studentIds', value: sid });
      if (!out.includes(sid)) out.push(sid);
    }
    return out;
  };
  r.post('/api/admin/groups', (ctx) => {
    const db = ctx.db; const b = ctx.body || {};
    const name = String(b.name || '').trim(); if (name.length < 2) throw httpError(400, 'Podaj nazwę grupy, np. „7c / j. ang. gr. 1”.', { field: 'name' });
    const classIds = (Array.isArray(b.classIds) ? b.classIds : b.classId ? [b.classId] : []).map((x) => String(x).trim()).filter(Boolean);
    if (!classIds.length) throw httpError(400, 'Wskaż oddział (albo oddziały) grupy.', { field: 'classIds' });
    for (const cid of classIds) if (!db.get('classes', cid)) throw httpError(400, 'Nie ma takiego oddziału: ' + cid + '.', { field: 'classIds', value: cid });
    if (b.subjectId && !db.get('subjects', b.subjectId)) throw httpError(400, 'Nie ma takiego przedmiotu: ' + b.subjectId + '.', { field: 'subjectId' });
    const kind = b.kind || (classIds.length > 1 ? 'cross-class' : 'language');
    const id = String(b.id || `g_${classIds[0]}_${b.subjectId || kind}_${db.col('groups').length + 1}`).trim();
    if (db.get('groups', id)) throw httpError(409, 'Grupa o identyfikatorze ' + id + ' już istnieje.', { field: 'id' });
    const studentIds = checkMembers(db, b.studentIds, classIds);
    const g = { id, name, kind, subjectId: b.subjectId || null, classIds, studentIds };
    db.col('groups').push(g); db.save();
    ctx.audit({ action: 'group_created', entity: 'groups', entityId: g.id, after: { name, kind, classIds, members: studentIds.length }, reason: b.reason || 'utworzenie grupy zajęciowej' });
    return { ok: true, group: groupView(db, g), message: `Grupa „${name}” utworzona (${studentIds.length} ${U.plural(studentIds.length, 'uczeń', 'uczniowie', 'uczniów')}). Teraz wskaż ją w kolumnie „group” przy imporcie planu lekcji.` };
  }, { roles: ADMIN });

  r.patch('/api/admin/groups/:id', (ctx) => {
    const db = ctx.db; const b = ctx.body || {}; const g = db.get('groups', ctx.params.id);
    if (!g) throw httpError(404, 'Nie ma takiej grupy.');
    const before = { name: g.name, studentIds: (g.studentIds || []).slice(), classIds: (g.classIds || []).slice(), subjectId: g.subjectId };
    if (b.name !== undefined) g.name = String(b.name).trim() || g.name;
    if (b.subjectId !== undefined) { if (b.subjectId && !db.get('subjects', b.subjectId)) throw httpError(400, 'Nie ma takiego przedmiotu.', { field: 'subjectId' }); g.subjectId = b.subjectId || null; }
    if (Array.isArray(b.classIds)) { for (const cid of b.classIds) if (!db.get('classes', cid)) throw httpError(400, 'Nie ma takiego oddziału: ' + cid + '.', { field: 'classIds' }); g.classIds = b.classIds.slice(); }
    if (Array.isArray(b.studentIds)) g.studentIds = checkMembers(db, b.studentIds, g.classIds);
    if (Array.isArray(b.add)) for (const sid of checkMembers(db, b.add, g.classIds)) if (!g.studentIds.includes(sid)) g.studentIds.push(sid);
    if (Array.isArray(b.remove)) g.studentIds = g.studentIds.filter((x) => !b.remove.includes(x));
    db.save();
    ctx.audit({ action: 'group_updated', entity: 'groups', entityId: g.id, before, after: { name: g.name, studentIds: g.studentIds, classIds: g.classIds, subjectId: g.subjectId }, reason: b.reason || 'zmiana składu grupy' });
    return { ok: true, group: groupView(db, g) };
  }, { roles: ADMIN });

  r.delete('/api/admin/groups/:id', (ctx) => {
    const db = ctx.db; const g = db.get('groups', ctx.params.id);
    if (!g) throw httpError(404, 'Nie ma takiej grupy.');
    const tt = db.col('timetable').filter((t) => t.groupId === g.id).length;
    const les = db.col('lessons').filter((l) => l.groupId === g.id).length;
    if (tt || les) throw httpError(409, `Grupa „${g.name}” jest używana w planie (${tt} ${U.plural(tt, 'pozycja', 'pozycje', 'pozycji')}) i w dzienniku (${les} ${U.plural(les, 'lekcja', 'lekcje', 'lekcji')}). Najpierw wgraj plan bez tej grupy.`, { code: 'group_in_use', timetableEntries: tt, lessons: les });
    db.remove('groups', g.id);
    ctx.audit({ action: 'group_deleted', entity: 'groups', entityId: g.id, before: { name: g.name, members: (g.studentIds || []).length }, reason: (ctx.body || {}).reason || 'usunięcie nieużywanej grupy' });
    return { ok: true, deleted: g.id };
  }, { roles: ADMIN });

  /** Podział oddziału na dwie (lub więcej) grupy jednym wywołaniem — typowo języki obce po ułożeniu planu. */
  r.post('/api/admin/classes/:id/split', (ctx) => {
    const db = ctx.db; const b = ctx.body || {}; const cls = db.get('classes', ctx.params.id);
    if (!cls) throw httpError(404, 'Nie ma takiego oddziału.');
    if (b.subjectId && !db.get('subjects', b.subjectId)) throw httpError(400, 'Nie ma takiego przedmiotu.', { field: 'subjectId' });
    const parts = Array.isArray(b.groups) ? b.groups : [];
    if (parts.length < 2) throw httpError(400, 'Podaj co najmniej dwie grupy: [{ name, studentIds }].', { field: 'groups' });
    const roster = db.col('students').filter((s) => s.classId === cls.id && s.status === 'active').map((s) => s.id);
    const seen = new Set(); const made = [];
    for (const p of parts) for (const sid of p.studentIds || []) { if (seen.has(sid)) throw httpError(400, `Uczeń ${sid} został przypisany do dwóch grup naraz.`, { field: 'groups', value: sid }); seen.add(sid); }
    const missing = roster.filter((sid) => !seen.has(sid));
    if (missing.length && !b.allowUnassigned) throw httpError(400, `Poza podziałem zostało ${missing.length} ${U.plural(missing.length, 'uczeń', 'uczniowie', 'uczniów')} — każdy musi trafić do jednej z grup (albo wyślij allowUnassigned:true).`, { code: 'unassigned', unassigned: missing.map((sid) => { const s = db.get('students', sid); return { id: sid, name: `${s.lastName} ${s.firstName}` }; }) });
    parts.forEach((p, i) => {
      const id = String(p.id || `g_${cls.id}_${b.subjectId || 'gr'}${i + 1}`).trim();
      if (db.get('groups', id)) throw httpError(409, 'Grupa o identyfikatorze ' + id + ' już istnieje.', { field: 'groups' });
      const g = { id, name: String(p.name || `${cls.name} / gr. ${i + 1}`).trim(), kind: b.kind || 'language', subjectId: b.subjectId || null, classIds: [cls.id], studentIds: checkMembers(db, p.studentIds, [cls.id]) };
      db.col('groups').push(g); made.push(g);
    });
    db.save();
    ctx.audit({ action: 'class_split_into_groups', entity: 'classes', entityId: cls.id, after: { subjectId: b.subjectId || null, groups: made.map((g) => ({ id: g.id, members: g.studentIds.length })), unassigned: missing.length }, reason: b.reason || `Podział oddziału ${cls.name} na grupy` });
    return { ok: true, groups: made.map((g) => groupView(db, g)), unassigned: missing,
      message: `Oddział ${cls.name} podzielony na ${made.length} ${U.plural(made.length, 'grupę', 'grupy', 'grup')}. Wgraj plan lekcji z identyfikatorami ${made.map((g) => g.id).join(', ')} w kolumnie „group”.` };
  }, { roles: ADMIN });

  /* --- OPS3-04 przedmioty ---------------------------------------------------------------
     Do tej pory `db.data.subjects` zapisywał wyłącznie zasiew. Każdy prawdziwy plan lekcji i każdy
     arkusz organizacyjny zatrzymywał się na przedmiocie, którego nie ma na naszej liście („Etyka”,
     „Wychowanie do życia w rodzinie”, „Godzina z wychowawcą”), a jedyną legalną odpowiedzią w drugiej
     fazie importu było `null` = pomiń — czyli usunięcie ustawowej godziny z wychowawcą z dziennika
     wszystkich oddziałów. Identyfikator jest niezmienny (wiszą na nim plan, lekcje i oceny); zmienia
     się nazwę, nazwę angielską i skrót. Skasować wolno tylko przedmiot, którego nic nie używa. */
  const SUBJECT_ID = /^[a-z0-9][a-z0-9._-]{1,23}$/;
  const subjectUsage = (db, id) => ({
    timetable: db.col('timetable').filter((t) => t.subjectId === id).length,
    lessons: db.col('lessons').filter((l) => l.subjectId === id).length,
    grades: db.col('grades').filter((g) => g.subjectId === id && !g.deleted).length,
    groups: db.col('groups').filter((g) => g.subjectId === id).length,
    teachers: db.col('users').filter((u) => (u.subjects || []).includes(id)).length
  });
  const subjectView = (db, x) => Object.assign({ id: x.id, name: x.name, nameEn: x.nameEn || '', short: x.short || '' }, { usage: subjectUsage(db, x.id) });
  const subjectIdFrom = (db, name) => {
    const base = String(name || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/ł/g, 'l').replace(/[^a-z0-9]+/g, '').slice(0, 12) || 'przedmiot';
    let id = base, n = 1; while (db.get('subjects', id)) id = base.slice(0, 20) + (++n);
    return id;
  };
  r.get('/api/admin/subjects', (ctx) => ({ subjects: ctx.db.col('subjects').map((x) => subjectView(ctx.db, x)).sort((a, b) => a.name.localeCompare(b.name, 'pl')) }), { roles: ['admin', 'principal'] });
  r.post('/api/admin/subjects', (ctx) => {
    const db = ctx.db; const b = ctx.body || {};
    const name = String(b.name || '').trim();
    if (name.length < 2) throw httpError(400, 'Podaj nazwę przedmiotu, np. „Etyka”.', { field: 'name' });
    const id = String(b.id || '').trim() || subjectIdFrom(db, name);
    if (!SUBJECT_ID.test(id)) throw httpError(400, 'Identyfikator przedmiotu: 2–24 znaki, małe litery, cyfry, kropka, myślnik lub podkreślenie (np. „wdz”).', { field: 'id' });
    if (db.get('subjects', id)) throw httpError(409, `Przedmiot o identyfikatorze „${id}” już istnieje (${db.get('subjects', id).name}).`, { field: 'id', code: 'subject_exists' });
    const dup = db.one('subjects', (x) => nrm(x.name) === nrm(name));
    if (dup && !b.allowDuplicateName) throw httpError(409, `Przedmiot „${dup.name}” (${dup.id}) ma już tę nazwę. Wyślij allowDuplicateName:true, jeżeli to naprawdę dwa różne przedmioty.`, { field: 'name', code: 'subject_name_taken', existing: dup.id });
    const x = { id, name };
    if (b.nameEn) x.nameEn = String(b.nameEn).trim();
    if (b.short) x.short = String(b.short).trim().slice(0, 8);
    db.col('subjects').push(x); db.save();
    ctx.audit({ action: 'subject_created', entity: 'subjects', entityId: id, after: { id, name, nameEn: x.nameEn || null, short: x.short || null }, reason: b.reason || 'dodanie przedmiotu do listy szkoły' });
    return { ok: true, subject: subjectView(db, x), message: `Przedmiot „${name}” dodany pod identyfikatorem ${id}. Możesz go teraz wskazać w dopasowaniu importu planu i w kartach nauczycieli.` };
  }, { roles: ADMIN });
  r.patch('/api/admin/subjects/:id', (ctx) => {
    const db = ctx.db; const b = ctx.body || {}; const x = db.get('subjects', ctx.params.id);
    if (!x) throw httpError(404, 'Nie ma takiego przedmiotu.');
    const before = { name: x.name, nameEn: x.nameEn || null, short: x.short || null };
    if (b.name !== undefined) { const n = String(b.name).trim(); if (n.length < 2) throw httpError(400, 'Nazwa przedmiotu musi mieć co najmniej 2 znaki.', { field: 'name' }); x.name = n; }
    if (b.nameEn !== undefined) { const n = String(b.nameEn).trim(); if (n) x.nameEn = n; else delete x.nameEn; }
    if (b.short !== undefined) { const n = String(b.short).trim().slice(0, 8); if (n) x.short = n; else delete x.short; }
    db.save();
    ctx.audit({ action: 'subject_updated', entity: 'subjects', entityId: x.id, before, after: { name: x.name, nameEn: x.nameEn || null, short: x.short || null }, reason: b.reason || 'zmiana nazwy przedmiotu' });
    return { ok: true, subject: subjectView(db, x) };
  }, { roles: ADMIN });
  r.delete('/api/admin/subjects/:id', (ctx) => {
    const db = ctx.db; const x = db.get('subjects', ctx.params.id);
    if (!x) throw httpError(404, 'Nie ma takiego przedmiotu.');
    const use = subjectUsage(db, x.id); const total = Object.values(use).reduce((a, n) => a + n, 0);
    if (total) throw httpError(409, `Przedmiot „${x.name}” jest używany: ${use.timetable} pozycji planu, ${use.lessons} lekcji, ${use.grades} ocen, ${use.groups} grup, ${use.teachers} nauczycieli. Usuń te powiązania albo zostaw przedmiot na liście.`, { code: 'subject_in_use', usage: use });
    db.remove('subjects', x.id); db.save();
    ctx.audit({ action: 'subject_deleted', entity: 'subjects', entityId: x.id, before: { id: x.id, name: x.name }, reason: (ctx.body || {}).reason || 'usunięcie nieużywanego przedmiotu' });
    return { ok: true, deleted: x.id };
  }, { roles: ADMIN });

  /* --- OPS3-14 oddziały ------------------------------------------------------------------
     Oddział powstawał dotąd wyłącznie jako skutek uboczny importu (wiersz nauczyciela z
     `homeroomOf` albo wiersz ucznia z `class`). Publikacja Optivum wgrywana przed listą uczniów
     zatrzymywała się na `classes: ["4A","4B",…]` i administrator nie miał czym odpowiedzieć;
     literówki w nazwie oddziału nie dało się poprawić inaczej niż cofnięciem całego importu. */
  const classUsage = (db, id) => ({
    students: db.col('students').filter((s) => s.classId === id && s.status === 'active').length,
    allStudents: db.col('students').filter((s) => s.classId === id).length,
    timetable: db.col('timetable').filter((t) => t.classId === id).length,
    lessons: db.col('lessons').filter((l) => l.classId === id).length,
    groups: db.col('groups').filter((g) => (g.classIds || []).includes(id)).length
  });
  const classView = (db, c) => ({ id: c.id, name: c.name, level: c.level || null, homeroomTeacherId: c.homeroomTeacherId || null,
    homeroomTeacher: c.homeroomTeacherId ? D.userLabel(db.get('users', c.homeroomTeacherId)) : null, usage: classUsage(db, c.id) });
  r.get('/api/admin/classes', (ctx) => ({
    classes: ctx.db.col('classes').map((c) => classView(ctx.db, c)).sort((a, b) => a.id.localeCompare(b.id, 'pl')),
    teachers: ctx.db.col('users').filter((u) => u.role === 'teacher').map((u) => ({ id: u.id, label: D.userLabel(u), homeroomOf: u.homeroomOf || null })),
    idFormat: 'np. 7b — jedna lub dwie cyfry poziomu i opcjonalna litera oddziału'
  }), { roles: ['admin', 'principal'] });
  const CLASS_ID_RE = /^[0-9]{1,2}[a-zA-Z]?$/;
  r.post('/api/admin/classes', (ctx) => {
    const db = ctx.db; const b = ctx.body || {};
    const id = String(b.id || '').trim().toLowerCase().replace(/\s+/g, '');
    if (!CLASS_ID_RE.test(id)) throw httpError(400, `„${b.id || ''}” nie wygląda jak oznaczenie oddziału — podaj np. 7b.`, { field: 'id' });
    if (db.get('classes', id)) throw httpError(409, `Oddział ${id} już istnieje.`, { field: 'id', code: 'class_exists' });
    const level = b.level !== undefined && b.level !== null && b.level !== '' ? +b.level : (+id.replace(/\D/g, '') || 1);
    if (!Number.isInteger(level) || level < 0 || level > 12) throw httpError(400, 'Poziom oddziału musi być liczbą 0–12.', { field: 'level' });
    const cls = { id, name: String(b.name || id).trim(), level, homeroomTeacherId: null, studentIds: [] };
    db.col('classes').push(cls);
    if (b.homeroomTeacherId) {
      const u = db.get('users', b.homeroomTeacherId);
      if (!u || !['teacher', 'principal'].includes(u.role)) { db.remove('classes', id); throw httpError(400, 'Wychowawcą może być nauczyciel z tej szkoły.', { field: 'homeroomTeacherId' }); }
      setHomeroom(db, u, cls.id);
    }
    db.save();
    ctx.audit({ action: 'class_created', entity: 'classes', entityId: cls.id, after: { id: cls.id, name: cls.name, level: cls.level, homeroomTeacherId: cls.homeroomTeacherId }, reason: b.reason || 'utworzenie oddziału' });
    return { ok: true, class: classView(db, cls), message: `Oddział ${cls.name} utworzony. Uczniów dopisze sekretariat albo import; wychowawcę można wskazać w kartach pracowników.` };
  }, { roles: ADMIN });
  r.patch('/api/admin/classes/:id', (ctx) => {
    const db = ctx.db; const b = ctx.body || {}; const cls = db.get('classes', ctx.params.id);
    if (!cls) throw httpError(404, 'Nie ma takiego oddziału.');
    const before = { name: cls.name, level: cls.level, homeroomTeacherId: cls.homeroomTeacherId || null };
    if (b.name !== undefined) { const n = String(b.name).trim(); if (!n) throw httpError(400, 'Nazwa oddziału nie może być pusta.', { field: 'name' }); cls.name = n; }
    if (b.level !== undefined) { const l = +b.level; if (!Number.isInteger(l) || l < 0 || l > 12) throw httpError(400, 'Poziom oddziału musi być liczbą 0–12.', { field: 'level' }); cls.level = l; }
    if (b.homeroomTeacherId !== undefined) {
      if (b.homeroomTeacherId) { const u = db.get('users', b.homeroomTeacherId); if (!u || !['teacher', 'principal'].includes(u.role)) throw httpError(400, 'Wychowawcą może być nauczyciel z tej szkoły.', { field: 'homeroomTeacherId' }); setHomeroom(db, u, cls.id); }
      else { const prev = cls.homeroomTeacherId && db.get('users', cls.homeroomTeacherId); if (prev) prev.homeroomOf = null; cls.homeroomTeacherId = null; }
    }
    db.save();
    ctx.audit({ action: 'class_updated', entity: 'classes', entityId: cls.id, before, after: { name: cls.name, level: cls.level, homeroomTeacherId: cls.homeroomTeacherId || null }, reason: b.reason || 'zmiana danych oddziału' });
    return { ok: true, class: classView(db, cls) };
  }, { roles: ADMIN });
  r.delete('/api/admin/classes/:id', (ctx) => {
    const db = ctx.db; const cls = db.get('classes', ctx.params.id);
    if (!cls) throw httpError(404, 'Nie ma takiego oddziału.');
    const use = classUsage(db, cls.id); const total = use.allStudents + use.timetable + use.lessons + use.groups;
    if (total) throw httpError(409, `Oddział ${cls.name} nie jest pusty: ${use.allStudents} ${U.plural(use.allStudents, 'uczeń', 'uczniowie', 'uczniów')} w księdze, ${use.timetable} pozycji planu, ${use.lessons} lekcji, ${use.groups} grup.`, { code: 'class_in_use', usage: use });
    const prev = cls.homeroomTeacherId && db.get('users', cls.homeroomTeacherId); if (prev) prev.homeroomOf = null;
    db.remove('classes', cls.id); db.save();
    ctx.audit({ action: 'class_deleted', entity: 'classes', entityId: cls.id, before: { id: cls.id, name: cls.name }, reason: (ctx.body || {}).reason || 'usunięcie pustego oddziału' });
    return { ok: true, deleted: cls.id };
  }, { roles: ADMIN });

  /* --- 3.5.5 import planu lekcji ------------------------------------------------------- */
  r.get('/api/admin/timetable/format', (ctx) => ({
    format: CSV_HEADER, separator: ';', example: `${CSV_HEADER}\n7b;1;1;mat;j.nowak;12;\n7b;1;3;ang;e.krol;15;g_7b_ang1\n7b;1;3;ang;e.krol;16;g_7b_ang2`,
    note: 'Akceptowane są też tablice JSON o tych samych kluczach. Pusta kolumna „group” oznacza lekcję z całym oddziałem. Domyślnie import wymienia cały plan; `merge: true` podmienia tylko wymienione oddziały i wtedy konflikty liczymy także wobec planu już zapisanego (`stored: true`).',
    /* R1 — prawdziwe formaty szkół; CSV powyżej jest naszym wymysłem i zostaje tylko dla kreatora. */
    formats: [
      { id: 'csv', name: 'CSV EdMat', note: `Kolumny ${CSV_HEADER}, opcjonalnie jeszcze „week” (A/B) i „groupLabel”. Separator „;” albo „,”, cudzysłowy wg RFC 4180.` },
      { id: 'json', name: 'JSON', note: 'Tablica obiektów o tych samych kluczach co CSV.' },
      { id: 'asc-xml', name: 'aSc Timetables (XML)', note: 'Eksport „XML” z aSc (2012 i 2008). Czytamy periods/daysdefs/weeksdefs/classes/groups/lessons/cards; termsdefs pomijamy.' },
      { id: 'optivum-html', name: 'Plan lekcji Optivum (HTML)', note: 'Pojedyncze `oN.html` albo cały katalog publikacji jako `files: {ścieżka: base64}`. windows-1250 i UTF-8.' }
    ],
    twoPhase: 'Dla aSc i Optivum `dryRun: true` zwraca `proposal` — propozycję dopasowania nauczycieli, oddziałów, przedmiotów i sal wraz z gotowym `mapping`. Poprawiony `mapping` odsyła się przy właściwym imporcie; encja bez dopasowania i bez mapowania kończy się błędem 400, nigdy częściowym zapisem.',
    weekCycle: { anchor: TT.weekAnchor(ctx.db), note: 'Pierwszy poniedziałek roku szkolnego to tydzień A; zmienia to `config.weekCycleAnchor`.' },
    docs: 'docs/IMPORT.md'
  }), { roles: ADMIN });

  r.post('/api/admin/timetable/import', (ctx) => {
    const db = ctx.db; const b = ctx.body || {};
    /* R1 — wejście może przyjść na cztery sposoby: `data` (tekst albo tablica JSON), `dataBase64`
       (bajty pliku, gdy kodowanie nie jest UTF-8), `files` = mapa `{ścieżka: base64}` dla wgranego
       katalogu publikacji Optivum, oraz — wstecznie — `csv`. */
    let payload = b.files && typeof b.files === 'object' ? b.files : (b.data !== undefined ? b.data : b.csv);
    if (b.dataBase64) payload = TD.toBuffer(b.dataBase64, 'base64');
    const empty = payload == null || (typeof payload === 'string' && !payload.trim()) || (payload && typeof payload === 'object' && !Buffer.isBuffer(payload) && !Array.isArray(payload) && !Object.keys(payload).length);
    if (empty) throw httpError(400, 'Wklej dane planu lekcji albo wskaż plik (CSV, JSON, aSc XML, publikacja Optivum).', { field: 'data' });
    if (b.format && !FORMATS.includes(b.format)) throw httpError(400, `Nieznany format importu „${b.format}”.`, { field: 'format', allowed: FORMATS });
    const format = b.format || detectFormat(payload);
    const parsedOut = parseTimetablePayload(db, payload, format, { mapping: b.mapping, ref: b.ref || b.fileName || null });
    const rows = parsedOut.rows, errors = parsedOut.errors;
    const proposal = parsedOut.proposal || null;
    const warnings = parsedOut.warnings || [];
    /* OPS-21 — `merge: true` (albo `mode: 'merge'`) to import częściowy: podmienia plan wyłącznie dla
       oddziałów wymienionych we wgrywanych wierszach, pozostałe zostawia. Plan po zapisie to wtedy
       `kept + rows`, więc tak samo liczymy konflikty (także wobec stanu zapisanego) i wpływ na lekcje. */
    const merge = b.merge === true || b.mode === 'merge';
    const touched = [...new Set(rows.map((x) => x.classId))];
    const kept = merge ? db.col('timetable').filter((t) => !touched.includes(t.classId)) : [];
    const conflicts = findConflicts(db, rows).concat(merge ? findStoredConflicts(db, rows, kept) : []);
    /* Plan bez lekcji nikogo nie obchodzi: pokazujemy wprost, ile lekcji w już wygenerowanym horyzoncie
       zniknie z planu, ile trzeba będzie odwołać (bo mają wpisy albo zastępstwa) i ile dojdzie. */
    const impact = lessonImpact(db, merge ? kept.concat(rows) : rows);
    const report = {
      rows: rows.length, errors, conflicts, lessonImpact: impact,
      classes: [...new Set(rows.map((x) => x.classId))].sort(),
      teachers: new Set(rows.flatMap((x) => (x.teacherIds && x.teacherIds.length ? x.teacherIds : [x.teacherId]))).size,
      rooms: new Set(rows.map((x) => x.room).filter(Boolean)).size,
      groups: new Set(rows.map((x) => TT.groupKey(TT.normalize(x))).filter(Boolean)).size,
      replacing: db.col('timetable').length, merge, keptEntries: kept.length, dryRun: b.dryRun !== false,
      format, warnings,
      weeks: { every: rows.filter((x) => !x.week).length, A: rows.filter((x) => x.week === 'A').length, B: rows.filter((x) => x.week === 'B').length },
      groupLabels: [...new Set(rows.map((x) => x.groupLabel).filter(Boolean))].sort(),
      rowsPerClass: rows.reduce((m, x) => { m[x.classId] = (m[x.classId] || 0) + 1; return m; }, {}),
      multiTeacher: rows.filter((x) => (x.teacherIds || []).length > 1).length,
      roomless: rows.filter((x) => !x.room).length,
      sourceStats: parsedOut.parsed ? parsedOut.parsed.stats : null,
      weekMarkers: (parsedOut.parsed && parsedOut.parsed.weekMarkers) || [],
      crossMismatch: (parsedOut.parsed && parsedOut.parsed.crossMismatch) || [],
      skipped: parsedOut.skipped || null
    };
    if (proposal) { report.proposal = proposal; report.mapping = proposal.mapping; report.unmatched = proposal.unmatched; }
    const storedCount = conflicts.filter((x) => x.stored).length;
    const blocking = proposal ? proposal.blocking : [];
    if (b.dryRun !== false) return Object.assign({ ok: errors.length === 0 && conflicts.length === 0 && !blocking.length, applied: false, message: `Próbny import${merge ? ` częściowy (${report.classes.join(', ')}; ${kept.length} pozycji pozostałych oddziałów zostaje)` : ''}: ${rows.length} lekcji, ${conflicts.length} konfliktów${merge ? ` (w tym ${storedCount} wobec planu już zapisanego)` : ''}, ${errors.length} błędów. W dzienniku ubędzie ${impact.dropped} lekcji (w tym ${impact.withJournal} z wpisami — te zostaną odwołane, nie usunięte), dojdzie ${impact.added}.${proposal ? ` Dopasowanie: ${proposal.exactMatches.teachers} nauczycieli, ${proposal.exactMatches.classes} oddziałów, ${proposal.exactMatches.subjects} przedmiotów trafionych dokładnie; bez odpowiednika: ${blocking.length}.` : ''} Nic nie zostało zapisane.` }, report);
    if (blocking.length) throw httpError(400, `Import przerwany: ${blocking.length} ${U.plural(blocking.length, 'encja z pliku nie ma', 'encje z pliku nie mają', 'encji z pliku nie ma')} odpowiednika w tej szkole. Uzupełnij mapowanie (albo ustaw null, żeby pominąć) i wyślij ponownie — nic nie zostało zapisane.`,
      { code: 'unmatched_entities', unmatched: proposal.unmatched, blocking, mapping: proposal.mapping, proposal });
    if (errors.length) throw httpError(400, `Import przerwany: ${errors.length} ${U.plural(errors.length, 'błędny wiersz', 'błędne wiersze', 'błędnych wierszy')}.`, { errors, conflicts });
    if (conflicts.length && !b.force) throw httpError(409, `Import przerwany: ${conflicts.length} ${U.plural(conflicts.length, 'konflikt wymaga', 'konflikty wymagają', 'konfliktów wymaga')} decyzji.`, { errors, conflicts });
    if (impact.withJournal && !b.force) throw httpError(409, `Import przerwany: ${impact.withJournal} ${U.plural(impact.withJournal, 'lekcja ma', 'lekcje mają', 'lekcji ma')} już wpisy w dzienniku albo opublikowane zastępstwa i zostanie odwołana. Potwierdź wymuszeniem (force), żeby zapisać.`, { code: 'lessons_with_journal', errors, conflicts, lessonImpact: impact });
    const before = db.col('timetable').length;
    /* R3-08 + H-3 — partia importu **przed** pierwszym zapisem wiersza i z natychmiastowym zrzutem na
       dysk. Do tej pory plan lekcji nie zostawiał w `imports` żadnego śladu, więc `POST
       /api/setup/imports/:id/undo` nie miał czego cofać, a `docs/IMPORT.md` obiecywał, że „cofanie
       działa jak dotąd”. Poprzedni plan leży w partii w całości: cofnięcie odtwarza go co do wiersza
       i uzgadnia dziennik. */
    const previousTimetable = JSON.parse(JSON.stringify(db.col('timetable')));
    const batch = recordImport(db, { id: 'imp_' + U.id().slice(0, 10), kind: 'timetable', status: 'running', byUserId: ctx.user.id,
      studentIds: [], userIds: [], codeIds: [], classIds: [], subjectIds: [], groupIds: [],
      previousTimetable, merge, touchedClasses: merge ? touched : null,
      source: proposal ? { tool: proposal.tool, ref: proposal.ref } : { tool: format, ref: b.ref || b.fileName || null },
      counts: { rows: rows.length, replacing: previousTimetable.length } });
    db.save();
    /* „Załóż u nas” z tabeli dopasowania — przedmioty, oddziały i grupy powstają dopiero tutaj, po
       wszystkich kontrolach, i lądują w tej samej partii, więc cofnięcie zabiera je razem z planem. */
    const created = { subjects: [], classes: [], groups: [] };
    if (proposal && proposal.pending) {
      for (const x of proposal.pending.subjects) { if (!db.get('subjects', x.id)) { db.col('subjects').push(x); created.subjects.push(x.id); batch.subjectIds.push(x.id); } }
      for (const x of proposal.pending.classes) { if (!db.get('classes', x.id)) { db.col('classes').push(x); created.classes.push(x.id); batch.classIds.push(x.id); } }
      for (const x of proposal.pending.groups) {
        if (db.get('groups', x.id)) continue;
        const cls = db.get('classes', x.classIds[0]);
        const g = { id: x.id, name: x.name, kind: x.kind, subjectId: x.subjectId, classIds: x.classIds.slice(), studentIds: x.studentIds.slice(), fromImport: true, labelFromFile: x.labelFromFile };
        db.col('groups').push(g); created.groups.push(g.id); batch.groupIds.push(g.id);
        warnings.push(`Grupa „${g.name}” powstała z podziału w pliku i dostała ${g.studentIds.length} ${U.plural(g.studentIds.length, 'ucznia', 'uczniów', 'uczniów')} z ${cls ? cls.name : x.classIds[0]} rozdanych po kolei wg numerów w dzienniku — sprawdź skład w „Grupach w oddziale”, zanim nauczyciel sprawdzi obecność.`);
      }
      db.save();
    }
    /* R1 — zapisujemy pola nowego modelu tylko wtedy, gdy niosą treść: wiersz z CSV wygląda wtedy
       dokładnie tak jak przed zmianą, a `TT.normalize()` i tak dokłada brakujące przy odczycie. */
    const next = rows.map((x) => {
      const e = { id: x.id, classId: x.classId, weekday: x.weekday, lessonNo: x.lessonNo, subjectId: x.subjectId, teacherId: x.teacherId, room: x.room, groupId: x.groupId };
      if ((x.teacherIds || []).length > 1) e.teacherIds = x.teacherIds.slice();
      if (x.groupLabel) e.groupLabel = x.groupLabel;
      if (x.week) e.week = x.week;
      if (x.source) e.source = x.source;
      return e;
    });
    db.data.timetable = merge ? kept.concat(next) : next;
    batch.status = 'done'; batch.counts = Object.assign({}, batch.counts, { entries: db.data.timetable.length, created: { subjects: created.subjects.length, classes: created.classes.length, groups: created.groups.length } });
    db.save();
    const lessons = b.applyToLessons === false ? null : syncLessons(db, { reason: 'timetable_changed' });
    batch.lessonsTo = lessons ? lessons.to : null; db.save();
    ctx.audit({ action: 'timetable_imported', entity: 'timetable', entityId: merge ? touched.join(',') : 'all', before: { entries: before }, after: { entries: db.data.timetable.length, imported: rows.length, merge, classes: merge ? touched : 'all', groups: report.groups, rooms: report.rooms, lessons, format, weeks: report.weeks, importId: batch.id, created, source: proposal ? { tool: proposal.tool, ref: proposal.ref } : null }, reason: b.reason || (merge ? 'import częściowy planu dla wybranych oddziałów' : 'import planu z zewnętrznego programu układającego') });
    return Object.assign({ ok: true, applied: true, lessons, importId: batch.id, created, message: `Zaimportowano ${rows.length} ${U.plural(rows.length, 'lekcję', 'lekcje', 'lekcji')}${merge ? ` dla ${report.classes.join(', ')} (pozostałe oddziały bez zmian: ${kept.length} pozycji)` : ''}: ${report.groups} podziałów na grupy, ${report.rooms} sal, ${report.teachers} nauczycieli.` + (lessons ? ` Dziennik uzgodniony do ${U.fmtDate(lessons.to)}: dogenerowano ${lessons.created}, usunięto ${lessons.removed} pustych, odwołano ${lessons.cancelled}, poprawiono ${lessons.changed || 0} lekcji wg nowego planu${lessons.keptWithJournal ? `, ${lessons.keptWithJournal} zostawiono bez zmian (mają już wpisy w dzienniku)` : ''}.` : '') }, report, { dryRun: false });
  }, { roles: ADMIN });

  /* OPS3-02 — poprawka jednej pozycji planu. Do tej pory jedynym pisarzem kolekcji `timetable` był
     import całego pliku: żeby związać jeden wiersz z grupą, zmienić nauczyciela albo salę, trzeba
     było wgrać cały plan od nowa. Identyfikator pozycji niesie oddział, dzień, numer i podział, więc
     zmiana `groupId` zmienia też identyfikator — przepisujemy go razem z już wygenerowanymi lekcjami,
     żeby dziennik nie zgubił wpisów. */
  r.patch('/api/admin/timetable/rows/:id', (ctx) => {
    const db = ctx.db; const b = ctx.body || {};
    const row = db.col('timetable').find((t) => t.id === ctx.params.id);
    if (!row) throw httpError(404, 'Nie ma takiej pozycji planu.');
    const before = JSON.parse(JSON.stringify(row));
    if (b.subjectId !== undefined) { if (!db.get('subjects', b.subjectId)) throw httpError(400, 'Nie ma takiego przedmiotu: ' + b.subjectId + '.', { field: 'subjectId' }); row.subjectId = b.subjectId; }
    if (b.teacherId !== undefined || b.teacherIds !== undefined) {
      const ids = (b.teacherIds !== undefined ? b.teacherIds : [b.teacherId]).filter(Boolean).map(String);
      if (!ids.length) throw httpError(400, 'Lekcja musi mieć nauczyciela.', { field: 'teacherId' });
      for (const id of ids) { const u = db.get('users', id); if (!u || !auth.GRADE_EDITORS.concat(['supportTeacher']).includes(u.role)) throw httpError(400, 'Lekcję może prowadzić tylko nauczyciel tej szkoły: ' + id + '.', { field: 'teacherId', value: id }); }
      row.teacherId = ids[0]; if (ids.length > 1) row.teacherIds = ids; else delete row.teacherIds;
    }
    if (b.room !== undefined) row.room = String(b.room || '').trim().slice(0, 40);
    if (b.week !== undefined) { const w = String(b.week || '').toUpperCase(); if (w && !TT.WEEKS.includes(w)) throw httpError(400, 'Tydzień cyklu to A albo B (albo pusty = co tydzień).', { field: 'week' }); if (w) row.week = w; else delete row.week; }
    if (b.groupId !== undefined) {
      if (b.groupId) {
        const g = db.get('groups', b.groupId);
        if (!g) throw httpError(400, 'Nie ma takiej grupy: ' + b.groupId + '.', { field: 'groupId' });
        if ((g.classIds || []).length && !g.classIds.includes(row.classId)) throw httpError(400, `Grupa „${g.name}” należy do ${g.classIds.join(', ')}, a nie do oddziału ${row.classId}.`, { field: 'groupId' });
        row.groupId = g.id;
      } else row.groupId = null;
    }
    if (b.groupLabel !== undefined) { const l = String(b.groupLabel || '').trim(); if (l) row.groupLabel = l; else delete row.groupLabel; }
    const nextId = TT.entryId(TT.normalize(row));
    if (nextId !== row.id) {
      if (db.col('timetable').some((t) => t.id === nextId)) throw httpError(409, `W planie jest już pozycja ${nextId} — najpierw zwolnij to okienko.`, { code: 'entry_exists', id: nextId });
      /* Lekcje z tego slotu przenoszą się na nowy identyfikator razem z tym, co w nich zapisano. */
      const old = row.id;
      for (const l of db.col('lessons')) if (l.id === `les_${old}_${l.date}`) l.id = `les_${nextId}_${l.date}`;
      for (const coll of ['attendance', 'grades', 'homework']) for (const x of db.col(coll)) if (x.lessonId && x.lessonId.startsWith(`les_${old}_`)) x.lessonId = x.lessonId.replace(`les_${old}_`, `les_${nextId}_`);
      for (const sub of db.col('substitutions')) for (const a of sub.assignments || []) if (a.lessonId && a.lessonId.startsWith(`les_${old}_`)) a.lessonId = a.lessonId.replace(`les_${old}_`, `les_${nextId}_`);
      row.id = nextId;
    }
    db.save();
    const lessons = b.applyToLessons === false ? null : syncLessons(db, { reason: 'timetable_row_changed' });
    ctx.audit({ action: 'timetable_row_updated', entity: 'timetable', entityId: row.id, before, after: JSON.parse(JSON.stringify(row)), reason: b.reason || 'ręczna poprawka pozycji planu' });
    return { ok: true, row: TT.normalize(row), renamedFrom: before.id !== row.id ? before.id : null, lessons,
      message: `Pozycja planu ${row.classId} ${WD_NAME[row.weekday]}, lekcja ${row.lessonNo} poprawiona.` + (lessons ? ` Dziennik uzgodniony: poprawiono ${lessons.changed || 0}, dogenerowano ${lessons.created}, usunięto ${lessons.removed} pustych.` : '') };
  }, { roles: ADMIN });

  /* --- GAP-1 konta pracowników: kadra spoza kreatora (pedagog, psycholog, pielęgniarka, IOD…) ---- */
  r.get('/api/admin/staff', (ctx) => {
    const db = ctx.db;
    return {
      staff: db.col('users').filter((u) => STAFF_ROLES.includes(u.role)).map((u) => staffView(db, u)).sort((a, b) => a.name.localeCompare(b.name, 'pl')),
      roles: STAFF_ROLES, keyRoles: KEY_ROLES,
      subjects: db.col('subjects').map((x) => ({ id: x.id, name: x.name })),
      classes: db.col('classes').map((c) => ({ id: c.id, name: c.name, homeroomTeacherId: c.homeroomTeacherId || null })),
      activeAdmins: activeAdmins(db), passwordPolicy: C.PASSWORD_POLICY
    };
  }, { roles: ['admin', 'principal'] });

  r.post('/api/admin/staff', (ctx) => {
    const db = ctx.db; const b = ctx.body || {};
    const role = String(b.role || '');
    if (!STAFF_ROLES.includes(role)) throw httpError(400, 'Nieznana rola pracownika: ' + (role || '—') + '.', { field: 'role', allowed: STAFF_ROLES });
    const firstName = String(b.firstName || '').trim(), lastName = String(b.lastName || '').trim();
    if (!firstName || !lastName) throw httpError(400, 'Podaj imię i nazwisko pracownika.', { field: firstName ? 'lastName' : 'firstName' });
    const wanted = staffSlug(b.login) || staffSlug(firstName.slice(0, 1) + '.' + lastName);
    if (!LOGIN_RE.test(wanted)) throw httpError(400, 'Login: 3–32 znaki, małe litery, cyfry i kropki.', { field: 'login' });
    if (b.login && db.one('users', (u) => u.login === wanted)) throw httpError(409, `Login „${wanted}” jest już zajęty.`, { field: 'login', code: 'login_taken' });
    const email = String(b.email || '').trim();
    if (email && !EMAIL_RE.test(email)) throw httpError(400, 'Adres e-mail wygląda na niepoprawny.', { field: 'email' });
    const subjects = checkSubjects(db, b.subjects);
    if (subjects.length && role !== 'teacher' && role !== 'supportTeacher' && role !== 'principal') throw httpError(400, 'Przedmioty przypisuje się nauczycielom.', { field: 'subjects', code: 'not_teacher' });
    if (b.homeroomOf && role !== 'teacher') throw httpError(400, 'Wychowawcą oddziału może być nauczyciel.', { field: 'homeroomOf', code: 'not_teacher' });
    const login = uniqueLogin(db, wanted); const pw = tempPassword();
    const u = {
      id: 'u_' + staffSlug(login).replace(/\./g, '_'), login, role, title: String(b.title || '').trim(),
      firstName, lastName, name: `${firstName} ${lastName}`, email, phone: String(b.phone || '').trim(),
      subjects, homeroomOf: null, passwordHash: C.hashPassword(pw), mustChangePassword: true,
      totpEnabled: false, blocked: false, quietHours: null, locale: b.locale === 'en' ? 'en' : 'pl',
      createdAt: U.now(), createdByUserId: ctx.user.id
    };
    /* Notatki zespołu wspierającego i gabinetu pielęgniarki są szyfrowane do czytelników po kluczu
       publicznym — konto bez pary kluczy nigdy nie odczyta własnych wpisów (tak robi to zasiew). */
    if (KEY_ROLES.includes(role)) { const k = C.generateKeyPair(); u.publicKey = k.publicKey; u.privateKey = k.privateKey; }
    db.col('users').push(u);
    const hr = b.homeroomOf ? setHomeroom(db, u, String(b.homeroomOf).trim()) : { released: null, taken: null };
    db.save();
    ctx.audit({ action: 'staff_created', entity: 'user', entityId: u.id, after: { login, role, subjects, homeroomOf: u.homeroomOf, keys: !!u.publicKey }, reason: String(b.reason || '').trim() || 'założenie konta pracownika' });
    return { ok: true, user: auth.publicUser(u), temporaryPassword: pw, mustChangePassword: true, homeroom: hr, policy: C.PASSWORD_POLICY,
      message: `Konto ${D.userLabel(u)} (${login}) założone. Hasło jednorazowe pokazujemy tylko raz — przekaż je innym kanałem niż e-mail; przy pierwszym logowaniu wymagana jest zmiana.` };
  }, { roles: ADMIN });

  r.patch('/api/admin/staff/:id', (ctx) => {
    const db = ctx.db; const b = ctx.body || {};
    const u = db.get('users', ctx.params.id) || db.one('users', (x) => x.login === ctx.params.id);
    if (!u) throw httpError(404, 'Nie ma takiego konta.');
    if (!STAFF_ROLES.includes(u.role)) throw httpError(400, 'Ta operacja dotyczy kont pracowników.', { code: 'not_staff' });
    const before = staffView(db, u);
    const next = { role: u.role, blocked: !!u.blocked };
    if (b.role !== undefined) { if (!STAFF_ROLES.includes(String(b.role))) throw httpError(400, 'Nieznana rola pracownika.', { field: 'role', allowed: STAFF_ROLES }); next.role = String(b.role); }
    if (b.blocked !== undefined) next.blocked = !!b.blocked;
    if (b.blocked === true && u.id === ctx.user.id) throw httpError(400, 'Nie można zablokować własnego konta.', { code: 'self' });
    if (b.blocked === true && !String(b.reason || '').trim()) throw httpError(400, 'Podaj powód blokady (np. rozwiązanie umowy).', { code: 'no_reason', field: 'reason' });
    assertAdminRemains(db, u, next);
    if (b.email !== undefined) { const e = String(b.email || '').trim(); if (e && !EMAIL_RE.test(e)) throw httpError(400, 'Adres e-mail wygląda na niepoprawny.', { field: 'email' }); u.email = e; }
    if (b.phone !== undefined) u.phone = String(b.phone || '').trim();
    if (b.title !== undefined) u.title = String(b.title || '').trim();
    if (b.firstName !== undefined && String(b.firstName).trim()) u.firstName = String(b.firstName).trim();
    if (b.lastName !== undefined && String(b.lastName).trim()) u.lastName = String(b.lastName).trim();
    u.name = `${u.firstName} ${u.lastName}`.trim();
    if (b.subjects !== undefined) u.subjects = checkSubjects(db, b.subjects);
    if (b.role !== undefined) u.role = next.role;
    /* Rola inna niż nauczyciel nie prowadzi oddziału — wychowawstwo trzeba oddać, zanim zniknie z konta. */
    if (b.homeroomOf !== undefined) {
      const cid = b.homeroomOf === null || b.homeroomOf === '' ? null : String(b.homeroomOf).trim();
      if (cid && u.role !== 'teacher') throw httpError(400, 'Wychowawcą oddziału może być nauczyciel.', { field: 'homeroomOf', code: 'not_teacher' });
      setHomeroom(db, u, cid);
    } else if (u.role !== 'teacher' && u.homeroomOf) setHomeroom(db, u, null);
    if (KEY_ROLES.includes(u.role) && !u.publicKey) { const k = C.generateKeyPair(); u.publicKey = k.publicKey; u.privateKey = k.privateKey; }
    let sessions = { total: 0, web: 0, mobile: 0 };
    if (b.blocked !== undefined && !!b.blocked !== before.blocked) {
      if (b.blocked) { sessions = cutSessions(db, u.id); Object.assign(u, { blocked: true, blockedAt: U.now(), blockedBy: ctx.user.id, blockedReason: String(b.reason).trim() }); }
      else Object.assign(u, { blocked: false, unblockedAt: U.now(), unblockedBy: ctx.user.id, blockedReason: null });
    }
    db.save();
    const after = staffView(db, u);
    ctx.audit({ action: 'staff_updated', entity: 'user', entityId: u.id, before, after: Object.assign({}, after, { revokedSessions: sessions.total }), reason: String(b.reason || '').trim() || 'zmiana danych konta pracownika' });
    if (b.blocked !== undefined && !!b.blocked !== before.blocked) ctx.audit({ action: b.blocked ? 'account_blocked' : 'account_unblocked', entity: 'users', entityId: u.id, before: { blocked: before.blocked, sessions: before.sessions }, after: { blocked: !!u.blocked, revokedSessions: sessions.total, web: sessions.web, mobile: sessions.mobile }, reason: String(b.reason || '').trim() || null });
    return { ok: true, user: after, revokedSessions: sessions, message: `Konto ${after.name} zaktualizowane.` + (u.blocked ? ` Dostęp odebrany natychmiast (${sessions.total} ${U.plural(sessions.total, 'sesja', 'sesje', 'sesji')}); wpisy w dzienniku zostają nienaruszone.` : '') };
  }, { roles: ADMIN });

  /** Konta pracowników się nie kasuje — wpisy w dzienniku muszą zostać przypisane do autora. */
  r.delete('/api/admin/staff/:id', (ctx) => {
    const db = ctx.db; const b = ctx.body || {};
    const u = db.get('users', ctx.params.id) || db.one('users', (x) => x.login === ctx.params.id);
    if (!u) throw httpError(404, 'Nie ma takiego konta.');
    if (!STAFF_ROLES.includes(u.role)) throw httpError(400, 'Ta operacja dotyczy kont pracowników.', { code: 'not_staff' });
    if (u.id === ctx.user.id) throw httpError(400, 'Nie można dezaktywować własnego konta.', { code: 'self' });
    const reason = String(b.reason || '').trim();
    if (!reason) throw httpError(400, 'Podaj powód dezaktywacji (np. rozwiązanie umowy).', { code: 'no_reason', field: 'reason' });
    assertAdminRemains(db, u, { role: u.role, blocked: true });
    if (u.blocked) throw httpError(409, 'To konto jest już zablokowane.', { code: 'already_blocked' });
    const before = staffView(db, u);
    const sessions = cutSessions(db, u.id);
    Object.assign(u, { blocked: true, blockedAt: U.now(), blockedBy: ctx.user.id, blockedReason: reason, deactivatedAt: U.now() });
    db.save();
    ctx.audit({ action: 'staff_deactivated', entity: 'user', entityId: u.id, before, after: { blocked: true, revokedSessions: sessions.total }, reason });
    return { ok: true, user: staffView(db, u), revokedSessions: sessions,
      message: `Konto ${D.userLabel(u)} dezaktywowane — nie kasujemy go, bo wpisy w dzienniku muszą zostać przy autorze. Odebrano dostęp w ${sessions.total} ${U.plural(sessions.total, 'sesji', 'sesjach', 'sesjach')}. Podstawa: ${reason}.` };
  }, { roles: ADMIN });

  /* --- 3.5.6 reset hasła --------------------------------------------------------------- */
  r.get('/api/admin/users', (ctx) => ({
    users: ctx.db.col('users').map((u) => ({ id: u.id, login: u.login, role: u.role, name: D.userLabel(u), blocked: !!u.blocked, mustChangePassword: !!u.mustChangePassword, totpEnabled: !!u.totpEnabled, totpRequired: !!u.totpRequired, lastLogin: u.lastLogin || null })).sort((a, b) => a.name.localeCompare(b.name, 'pl')),
    passwordPolicy: C.PASSWORD_POLICY
  }), { roles: ADMIN });

  r.post('/api/admin/users/:id/reset-password', (ctx) => {
    const db = ctx.db; const u = db.get('users', ctx.params.id) || db.one('users', (x) => x.login === ctx.params.id);
    if (!u) throw httpError(404, 'Nie ma takiego konta.');
    const pw = tempPassword();
    u.passwordHash = C.hashPassword(pw); u.mustChangePassword = true; u.passwordResetAt = U.now(); u.passwordResetByUserId = ctx.user.id;
    for (const s of db.col('sessions')) if (s.userId === u.id && !s.revoked) { s.revoked = true; s.revokedReason = 'password_reset'; s.revokedAt = U.now(); }
    db.save();
    ctx.audit({ action: 'password_reset', entity: 'user', entityId: u.id, after: { mustChangePassword: true }, reason: (ctx.body || {}).reason || 'reset hasła przez administratora' });
    return { ok: true, login: u.login, name: D.userLabel(u), temporaryPassword: pw, mustChangePassword: true,
      message: 'Hasło jednorazowe pokazujemy tylko raz. Przekaż je innym kanałem niż e-mail; przy pierwszym logowaniu wymagana jest zmiana zgodna z polityką złożoności.',
      policy: C.PASSWORD_POLICY };
  }, { roles: ADMIN });

  /* --- 3.5.7 TOTP dla edytujących oceny i frekwencję ----------------------------------- */
  r.get('/api/admin/2fa', (ctx) => {
    const db = ctx.db;
    return {
      required: !!db.data.config.require2FAForGradeEditors,
      roles: auth.GRADE_EDITORS,
      users: gradeEditors(db).map((u) => ({ id: u.id, login: u.login, name: D.userLabel(u), role: u.role, subjects: u.subjects || [], homeroomOf: u.homeroomOf || null, totpRequired: !!u.totpRequired, totpEnabled: !!u.totpEnabled, mustSetup2FA: !!u.mustSetup2FA }))
        .sort((a, b) => a.name.localeCompare(b.name, 'pl'))
    };
  }, { roles: ADMIN });

  r.post('/api/admin/2fa/require', (ctx) => {
    const db = ctx.db; const b = ctx.body || {}; const required = b.required !== false;
    const before = !!db.data.config.require2FAForGradeEditors;
    db.data.config.require2FAForGradeEditors = required;
    const touched = [];
    for (const u of gradeEditors(db)) {
      u.totpRequired = required;
      u.mustSetup2FA = required && !u.totpEnabled;
      if (u.mustSetup2FA) D.notify(db, u.id, 'bezpieczenstwo', 'Wymagane jest powiązanie aplikacji uwierzytelniającej (2FA) — bez niej nie zapiszesz ocen ani frekwencji.', { link: '/ustawienia' });
      touched.push({ id: u.id, login: u.login, totpEnabled: !!u.totpEnabled, mustSetup2FA: !!u.mustSetup2FA });
    }
    db.save();
    ctx.audit({ action: 'totp_policy_changed', entity: 'config', entityId: 'require2FAForGradeEditors', before: { required: before }, after: { required, users: touched.length }, reason: b.reason || 'polityka drugiego składnika dla edytujących oceny i frekwencję' });
    return { ok: true, required, users: touched, pending: touched.filter((u) => u.mustSetup2FA).length,
      message: required ? `Wymaganie 2FA włączone dla ${touched.length} ${U.plural(touched.length, 'osoby', 'osób', 'osób')}; ${touched.filter((u) => u.mustSetup2FA).length} musi jeszcze powiązać aplikację.` : 'Wymaganie 2FA wyłączone.' };
  }, { roles: ADMIN });

  /* --- 3.5.9 uprawnienia wiadomości ---------------------------------------------------- */
  r.patch('/api/admin/messaging', (ctx) => {
    const db = ctx.db; const b = ctx.body || {};
    const value = String(b.parentsCanMessage || '');
    const allowed = ['all', 'homeroomAndSubject'];
    if (!allowed.includes(value)) throw httpError(400, 'Dozwolone wartości to: ' + allowed.join(', ') + '.', { field: 'parentsCanMessage', allowed });
    const before = Object.assign({}, db.data.config.messaging);
    db.data.config.messaging = Object.assign({}, db.data.config.messaging, { parentsCanMessage: value }); db.save();
    ctx.audit({ action: 'messaging_permissions_changed', entity: 'config', entityId: 'messaging', before, after: db.data.config.messaging, reason: b.reason || 'zmiana uprawnień wiadomości rodziców' });
    return { ok: true, messaging: db.data.config.messaging,
      message: value === 'all' ? 'Rodzice mogą pisać do wszystkich nauczycieli szkoły.' : 'Rodzice mogą pisać do wychowawcy i nauczycieli uczących ich dziecko.' };
  }, { roles: ADMIN });

  /* --- 3.5.11 kody rejestracyjne dla rodziców klas pierwszych -------------------------- */
  r.get('/api/admin/registration-codes', (ctx) => {
    const db = ctx.db;
    return { codes: db.col('registrationCodes').map((c) => { const s = db.get('students', c.studentId); return Object.assign({}, c, { student: s ? `${s.lastName} ${s.firstName}` : c.studentId, classId: c.classId || (s ? s.classId : null) }); }).sort((a, b) => a.student.localeCompare(b.student, 'pl')) };
  }, { roles: ADMIN });

  r.post('/api/admin/registration-codes', (ctx) => {
    const db = ctx.db; const b = ctx.body || {};
    const classId = String(b.classId || '').trim();
    const cls = db.get('classes', classId); if (!cls) throw httpError(400, 'Nie ma takiego oddziału: ' + classId + '.', { field: 'classId' });
    const ttl = Math.max(1, +b.expiresInDays || 30);
    const expiresAt = U.addDays(D.today(db), ttl);
    const created = [];
    for (const sid of cls.studentIds) {
      const s = db.get('students', sid); if (!s || s.status !== 'active') continue;
      if (db.one('registrationCodes', (c) => c.studentId === sid && !c.usedAt && c.expiresAt >= D.today(db))) continue;
      created.push(db.insert('registrationCodes', { id: 'rc_' + U.id().slice(0, 10), code: makeCode(2, 4, cls.name.toUpperCase()), studentId: sid, classId: cls.id, byUserId: ctx.user.id, expiresAt, usedAt: null, usedByUserId: null }));
    }
    ctx.audit({ action: 'registration_codes_generated', entity: 'class', entityId: cls.id, after: { count: created.length, expiresAt }, reason: b.reason || 'kody rejestracyjne dla rodziców klasy pierwszej' });
    return { ok: true, created, count: created.length, expiresAt, message: `Wygenerowano ${created.length} ${U.plural(created.length, 'kod', 'kody', 'kodów')} dla oddziału ${cls.name}. Każdy kod jest jednorazowy i wygasa ${U.fmtDate(expiresAt)}.` };
  }, { roles: ADMIN });

  r.post('/api/admin/registration-codes/print', (ctx) => {
    const db = ctx.db; const b = ctx.body || {}; const cfg = db.data.config;
    const classId = String(b.classId || '').trim();
    const list = db.col('registrationCodes').filter((c) => !c.usedAt && (!classId || c.classId === classId));
    if (!list.length) throw httpError(400, 'Brak niewykorzystanych kodów do wydruku.');
    const rows = list.map((c) => { const s = db.get('students', c.studentId); return `<tr><th scope="row">${D.xmlEsc(s ? s.lastName + ' ' + s.firstName : c.studentId)}</th><td>${D.xmlEsc(c.classId || '')}</td><td style="font-family:monospace;font-size:12pt">${D.xmlEsc(c.code)}</td><td>${U.fmtDate(c.expiresAt)}</td></tr>`; }).join('');
    const html = D.printHtml('Kody rejestracyjne dla rodziców', `<h1>Kody rejestracyjne dla rodziców</h1>
<p>Kod jest jednorazowy, wiąże konto rodzica z konkretnym uczniem i wygasa w podanym terminie. Kody wydaje się w zaklejonych kopertach za potwierdzeniem odbioru.</p>
<table><caption>Kody rejestracyjne dla rodziców</caption><thead><tr><th scope="col">Uczeń</th><th scope="col">Oddział</th><th scope="col">Kod rejestracyjny</th><th scope="col">Ważny do</th></tr></thead><tbody>${rows}</tbody></table>
<h2>Jak założyć konto</h2>
<p>1. Wejdź na stronę dziennika. 2. Wybierz „Załóż konto rodzica”. 3. Wpisz kod z koperty, swoje imię, nazwisko i adres e-mail. 4. Ustaw hasło (co najmniej 12 znaków, wielka i mała litera, cyfra, znak specjalny).</p>`, {
      school: cfg.school.name, schoolMeta: cfg.school.address, docNo: 'Kody ' + (classId || 'wszystkie oddziały'), date: U.fmtDate(D.today(db)), printed: U.fmtDate(D.today(db))
    });
    ctx.audit({ action: 'registration_codes_printed', entity: 'class', entityId: classId || 'all', after: { count: list.length }, reason: 'wydruk listy kodów' });
    return sendHtml(ctx, html);
  }, { roles: ADMIN });

  /** Publiczna rejestracja konta rodzica na podstawie jednorazowego kodu.
      Trzy przypadki: (1) zalogowany rodzic realizuje kolejny kod → dopisujemy drugie dziecko do jego konta;
      (2) import kreatora założył konto-kontakt rodzica (bez hasła) → przejmujemy je zamiast tworzyć drugie;
      (3) rodzic nieznany szkole → zakładamy konto od zera. */
  r.post('/api/register', (ctx) => {
    const db = ctx.db; const b = ctx.body || {};
    const code = String(b.code || '').trim().toUpperCase();
    const rc = db.one('registrationCodes', (c) => c.code.toUpperCase() === code);
    if (!rc) throw httpError(400, 'Kod rejestracyjny jest nieprawidłowy.', { field: 'code' });
    if (rc.usedAt) throw httpError(400, 'Ten kod został już wykorzystany ' + U.fmtDate(rc.usedAt) + '. Kod jest jednorazowy.', { field: 'code' });
    if (rc.voidedAt) throw httpError(400, 'Kod został unieważniony ' + U.fmtDate(rc.voidedAt) + '. Poproś sekretariat o nowy.', { field: 'code' });
    if (rc.expiresAt && rc.expiresAt < D.today(db)) throw httpError(400, 'Kod wygasł ' + U.fmtDate(rc.expiresAt) + '. Poproś sekretariat o nowy.', { field: 'code' });
    const student = db.get('students', rc.studentId); if (!student) throw httpError(400, 'Kod wskazuje ucznia, którego nie ma w księdze.', { field: 'code' });
    if (student.status !== 'active') throw httpError(400, `Wpis ucznia ${student.lastName} ${student.firstName} w księdze uczniów jest zamknięty — na tym kodzie nie można już założyć konta.`, { field: 'code', code: 'student_inactive' });
    const email = String(b.email || '').trim().toLowerCase();
    /* (1) zalogowany rodzic dopisuje kolejne dziecko */
    const ses = auth.resolveSession(db, ctx.req);
    if (ses && !ses.expired && ses.user.role === 'parent' && !ses.user.blocked) {
      const u = ses.user;
      if (!(u.childrenIds || []).includes(student.id)) { u.childrenIds = [...(u.childrenIds || []), student.id]; student.parentIds = [...new Set([...(student.parentIds || []), u.id])]; }
      rc.usedAt = U.now(); rc.usedByUserId = u.id; db.save();
      ctx.audit({ action: 'parent_child_linked', entity: 'user', entityId: u.id, after: { studentId: student.id, codeId: rc.id }, reason: 'realizacja kodu rejestracyjnego na istniejącym koncie rodzica' });
      return { ok: true, user: auth.publicUser(u), studentId: student.id, linkedToExisting: true, message: `Do Twojego konta dopisano ucznia ${student.firstName} ${student.lastName}. Masz teraz ${u.childrenIds.length} ${U.plural(u.childrenIds.length, 'dziecko', 'dzieci', 'dzieci')} w tej szkole.` };
    }
    /* OPS3-17 — rodzic dwojga dzieci realizował drugi kod bez zalogowania i dostawał „Login musi mieć
       co najmniej 4 znaki.”, bo wydrukowana instrukcja nie mówi, że najpierw trzeba się zalogować.
       Jeżeli któryś z opiekunów tego ucznia ma już **aktywne** konto, mówimy to wprost. */
    const active = (student.parentIds || []).map((id) => db.get('users', id)).filter((u) => u && u.role === 'parent' && !u.blocked && u.passwordHash);
    if (active.length && !b.login) throw httpError(409, `Opiekun ucznia ${student.firstName} ${student.lastName} ma już konto w tej szkole (${active.map((u) => u.login).join(', ')}). Zaloguj się na nie i wpisz ten kod jeszcze raz — dziecko dopisze się do konta, które już masz. Jeżeli to Twój pierwszy kontakt ze szkołą, podaj login i hasło, a założymy osobne konto.`, { code: 'login_first', logins: active.map((u) => u.login) });
    const login = String(b.login || '').trim().toLowerCase();
    if (login.length < 4) throw httpError(400, 'Login musi mieć co najmniej 4 znaki — albo zaloguj się na konto, które już masz, i wpisz kod jeszcze raz.', { field: 'login' });
    const firstName = String(b.firstName || '').trim(), lastName = String(b.lastName || '').trim();
    if (!firstName || !lastName) throw httpError(400, 'Podaj imię i nazwisko rodzica lub opiekuna prawnego.', { field: 'lastName' });
    const pol = C.checkPasswordPolicy(b.password);
    if (!pol.ok) throw httpError(400, 'Hasło nie spełnia polityki: ' + pol.missing.join(', ') + '.', { field: 'password', missing: pol.missing });
    /* (2) konto-kontakt założone importem: ten sam adres e-mail albo wskazanie w kodzie, wciąż bez hasła */
    let u = db.get('users', rc.parentUserId || '');
    if (!u && email) u = db.one('users', (x) => x.role === 'parent' && !x.passwordHash && String(x.email || '').toLowerCase() === email);
    const claimed = !!(u && u.role === 'parent' && !u.passwordHash && (u.childrenIds || []).includes(student.id));
    if (u && !claimed) u = null;
    const loginTaken = db.one('users', (x) => x.login === login && (!u || x.id !== u.id));
    if (loginTaken) throw httpError(400, 'Taki login jest już zajęty.', { field: 'login' });
    if (claimed) Object.assign(u, { login, firstName, lastName, name: firstName + ' ' + lastName, email: email || u.email, phone: String(b.phone || u.phone || '').trim(), passwordHash: C.hashPassword(b.password), mustActivate: false, pendingActivation: false, mustChangePassword: false, activatedAt: U.now(), createdFromCode: rc.id });
    else {
      u = { id: 'u_p_' + C.sha256(login).slice(0, 8), login, role: 'parent', firstName, lastName, name: firstName + ' ' + lastName,
        email, phone: String(b.phone || '').trim(), childrenIds: [student.id],
        passwordHash: C.hashPassword(b.password), mustChangePassword: false, totpEnabled: false, blocked: false, title: '', quietHours: null,
        createdAt: U.now(), createdFromCode: rc.id };
      db.col('users').push(u);
    }
    student.parentIds = [...new Set([...(student.parentIds || []), u.id])];
    rc.usedAt = U.now(); rc.usedByUserId = u.id; db.save();
    ctx.audit({ action: 'parent_account_created', entity: 'user', entityId: u.id, userId: u.id, after: { login, studentId: student.id, codeId: rc.id, claimedImported: claimed }, reason: claimed ? 'aktywacja konta rodzica założonego importem' : 'rejestracja z jednorazowego kodu' });
    return { ok: true, user: auth.publicUser(u), studentId: student.id, claimedImportedAccount: claimed, message: `Konto ${claimed ? 'aktywowane' : 'założone'}. Zaloguj się loginem ${login}; masz dostęp do danych ucznia ${student.firstName} ${student.lastName}.` };
  }, { public: true });

  /* --- 3.5.12 lista dozwolonych adresów IP --------------------------------------------- */
  r.get('/api/admin/ip-allowlist', (ctx) => ({
    ipAllowlist: ctx.db.data.config.ipAllowlist || [], example: ctx.db.data.config.ipAllowlistExample || [], yourIp: ctx.ip,
    note: (ctx.db.data.config.ipAllowlist || []).length ? 'Logowania na konta administracyjne spoza listy są odrzucane.' : 'Lista jest pusta — logowania administracyjne nie są ograniczone adresem.'
  }), { roles: ADMIN });

  r.patch('/api/admin/ip-allowlist', (ctx) => {
    const db = ctx.db; const b = ctx.body || {};
    const list = Array.isArray(b.ipAllowlist) ? b.ipAllowlist : Array.isArray(b.list) ? b.list : null;
    if (!list) throw httpError(400, 'Podaj listę adresów w polu „ipAllowlist” (pusta lista wyłącza ograniczenie).', { field: 'ipAllowlist' });
    const clean = [];
    for (const raw of list) {
      const v = validCidr(raw);
      if (!v) throw httpError(400, `„${raw}” nie jest adresem IPv4 ani zakresem CIDR (np. 193.219.28.14 albo 10.12.0.0/24).`, { field: 'ipAllowlist', value: raw });
      if (!clean.includes(v)) clean.push(v);
    }
    if (clean.length && !auth.ipAllowed(ctx.ip, clean) && !b.force) throw httpError(400, `Twój adres ${ctx.ip || '(nieznany)'} nie mieści się na tej liście — zapis odciąłby Cię od panelu administracyjnego. Dodaj swój adres albo wyślij force:true.`, { field: 'ipAllowlist', yourIp: ctx.ip });
    const before = (db.data.config.ipAllowlist || []).slice();
    db.data.config.ipAllowlist = clean; db.save();
    ctx.audit({ action: 'ip_allowlist_changed', entity: 'config', entityId: 'ipAllowlist', before: { ipAllowlist: before }, after: { ipAllowlist: clean }, reason: b.reason || 'zmiana listy dozwolonych adresów logowania administracyjnego' });
    return { ok: true, ipAllowlist: clean, count: clean.length,
      message: clean.length ? `Na liście jest ${clean.length} ${U.plural(clean.length, 'pozycja', 'pozycje', 'pozycji')}. Logowania administracyjne spoza listy będą odrzucane.` : 'Lista wyczyszczona — logowania administracyjne nie są ograniczone adresem.' };
  }, { roles: ADMIN });

  /* --- 3.5.13 anonimizowana kopia bazy ------------------------------------------------- */
  r.post('/api/admin/backup/anonymized', (ctx) => {
    const db = ctx.db; const { snapshot, replaced, auditKept } = anonymizedSnapshot(db);
    ctx.audit({ action: 'anonymized_backup_created', entity: 'config', entityId: 'backup', after: { replacedTokens: replaced, auditEntries: auditKept, anonymized: true }, reason: (ctx.body || {}).reason || 'kopia bazy dla środowiska testowego' });
    if ((ctx.body || {}).json) return { ok: true, replaced, auditKept, snapshot };
    return { __raw: true, contentType: 'application/json; charset=utf-8', filename: `edmat-kopia-anonimizowana-${D.today(db)}.json`, body: JSON.stringify(snapshot, null, 2) };
  }, { roles: ADMIN });

  /* --- 3.5.15 retencja i niezmienność logów -------------------------------------------- */
  r.get('/api/admin/retention', (ctx) => {
    const db = ctx.db; const c = db.data.config; const pol = RET.policy(db);
    return { logRetentionYears: c.logRetentionYears, logRetentionMinYears: c.logRetentionMinYears || 5,
      gradesArchiveRetentionYears: c.gradesArchiveRetentionYears, gradesArchiveRetentionMinYears: c.gradesArchiveRetentionMinYears || 50,
      immutable: true, note: 'Zapis jednokrotny, odczyt wielokrotny (WORM): wpisu audytowego nie można zmienić ani usunąć przez API — również z konta administratora.',
      /* R5: jednostką retencji jest klasa dokumentacji z kategorią archiwalną, nie „liczba lat dla logów”. */
      retention: { version: pol.version, migratedFrom: pol.migratedFrom, jrwaVerified: !!pol.jrwaVerified, source: pol.source,
        classes: pol.classes.map((x) => ({ class: x.class, label: x.label, category: x.category, years: x.years === undefined ? null : x.years, days: x.days === undefined ? null : x.days, clock: x.clock, kind: x.kind, verified: !!x.verified, archiveCategoryA: !!x.archiveCategoryA, neverDelete: RET.neverDeleteOf(x), erasure: x.erasure, erasureReason: x.erasureReason || null, article9: !!x.article9, collections: x.collections, legalBasis: x.legalBasis, note: x.note, rule: RET.ruleText(x) })),
        uncovered: RET.uncoveredCollections(db),
        unverified: pol.unverified, jrwaNote: pol.note } };
  }, { roles: ADMIN });

  r.patch('/api/admin/retention', (ctx) => {
    const db = ctx.db; const c = db.data.config; const b = ctx.body || {};
    const minLog = c.logRetentionMinYears || 5, minGrades = c.gradesArchiveRetentionMinYears || 50;
    const next = { logRetentionYears: b.logRetentionYears === undefined ? c.logRetentionYears : +b.logRetentionYears,
      gradesArchiveRetentionYears: b.gradesArchiveRetentionYears === undefined ? c.gradesArchiveRetentionYears : +b.gradesArchiveRetentionYears };
    if (!(next.logRetentionYears >= minLog)) throw httpError(400, `Okres przechowywania logów nie może być krótszy niż ${minLog} ${U.plural(minLog, 'rok', 'lata', 'lat')} — to minimum wymagane przepisami o rozliczalności.`, { field: 'logRetentionYears', min: minLog });
    if (!(next.gradesArchiveRetentionYears >= minGrades)) throw httpError(400, `Arkusze ocen i księgę uczniów przechowuje się co najmniej ${minGrades} lat.`, { field: 'gradesArchiveRetentionYears', min: minGrades });
    const before = { logRetentionYears: c.logRetentionYears, gradesArchiveRetentionYears: c.gradesArchiveRetentionYears };
    c.logRetentionYears = next.logRetentionYears; c.gradesArchiveRetentionYears = next.gradesArchiveRetentionYears; db.save();
    ctx.audit({ action: 'retention_policy_changed', entity: 'config', entityId: 'retention', before, after: next, reason: b.reason || 'zmiana polityki retencji' });
    return Object.assign({ ok: true, immutable: true }, next, { message: `Logi przechowujemy ${next.logRetentionYears} lat, arkusze ocen i księgę uczniów ${next.gradesArchiveRetentionYears} lat.` });
  }, { roles: ADMIN });

  /** Zadanie retencyjne: WYŁĄCZNIE raport — nic nie jest usuwane. */
  r.get('/api/admin/retention/report', (ctx) => {
    const db = ctx.db; const c = db.data.config; const years = c.logRetentionYears || 5; const today = D.today(db);
    const d = new Date(today + 'T00:00:00Z'); d.setUTCFullYear(d.getUTCFullYear() - years);
    const cutoff = d.toISOString().slice(0, 10);
    const rows = db.col('audit'); const expiring = rows.filter((a) => String(a.at).slice(0, 10) < cutoff);
    const byAction = {}; for (const a of expiring) byAction[a.action] = (byAction[a.action] || 0) + 1;
    const oldest = rows.reduce((m, a) => (!m || a.at < m ? a.at : m), null);
    /* R5: ta sama odpowiedź niesie teraz wiersz na każdą klasę dokumentacji — kategoria, reguła,
       liczba pozycji po terminie, najbliższy termin, ostatnie brakowanie i flaga „zweryfikowane”. */
    const runs = db.col('retentionRuns').slice().sort((a, b) => (a.at < b.at ? 1 : -1));
    const lastRunOf = (cls) => runs.find((run) => (run.byClass && run.byClass[cls] !== undefined) || (!run.byClass && (cls === 'dziennik-zdarzen' || cls === 'sesje'))) || null;
    const classes = RET.classPlans(db, today).map((row) => {
      const { _items, ...rest } = row; const last = lastRunOf(row.class);
      return Object.assign(rest, { lastRun: last ? { runId: last.id, at: last.at, deleted: last.byClass ? last.byClass[row.class] : null, archiveConsentReference: last.archiveConsentReference || null } : null });
    });
    const unverified = classes.filter((x) => !x.verified);
    const due = classes.reduce((n, x) => n + x.due, 0);
    /* D3-13: kolekcja bez klasy dokumentacji musi być widoczna, także gdy nie ma żadnej — ten
       wiersz nigdy nie znika z odpowiedzi ani z karty administratora. */
    const catalogue = RET.classifyAll(db);
    const uncovered = catalogue.filter((x) => x.uncovered);
    return { logRetentionYears: years, cutoff, total: rows.length, wouldExpire: expiring.length, byAction, oldestEntry: oldest, deleted: 0, immutable: true,
      today, classes, dueTotal: due,
      collectionsTotal: catalogue.filter((x) => !x.absent).length,
      uncovered: uncovered.map((x) => x.collection), uncoveredCount: uncovered.length,
      uncoveredRows: uncovered.reduce((n, x) => n + x.rows, 0),
      uncoveredWarning: uncovered.length
        ? `${uncovered.length} ${U.plural(uncovered.length, 'kolekcja nie należy', 'kolekcje nie należą', 'kolekcji nie należy')} do żadnej klasy dokumentacji, więc nie ma okresu przechowywania: ${uncovered.map((x) => x.collection).join(', ')}. Przypisz klasę w config.retention albo zapisz decyzję, że są poza zakresem.`
        : null,
      operationalDue: classes.filter((x) => x.kind === 'operational').reduce((n, x) => n + x.due, 0),
      archivalDue: classes.filter((x) => x.kind === 'archival').reduce((n, x) => n + x.due, 0),
      unverified: unverified.map((x) => x.class),
      jrwaWarning: unverified.length
        ? `${unverified.length} ${U.plural(unverified.length, 'klasa dokumentacji nie została', 'klasy dokumentacji nie zostały', 'klas dokumentacji nie zostało')} potwierdzona jednolitym rzeczowym wykazem akt tej szkoły. Do czasu weryfikacji traktuj kategorie jak propozycję, nie jak decyzję.`
        : null,
      message: `Raport retencji na ${U.fmtDate(today)}: ${expiring.length} z ${rows.length} wpisów audytowych przekroczyłoby okres ${years} lat (granica ${U.fmtDate(cutoff)}). Zadanie nic nie usuwa — usunięcie wymaga odrębnej decyzji i protokołu brakowania.` };
  }, { roles: ADMIN });

  /** Niezmienność (WORM): każda próba modyfikacji lub usunięcia wpisu audytowego kończy się 405. */
  const worm = (ctx) => {
    ctx.audit({ action: 'audit_modification_attempt', entity: 'audit', entityId: ctx.params.id || 'all', after: { method: ctx.req.method, path: ctx.req.url }, reason: 'próba modyfikacji rejestru audytowego (odrzucona)' });
    throw httpError(405, 'Rejestr audytowy jest niezmienny (WORM): wpisów nie można zmieniać ani usuwać. Próba została odnotowana.', { code: 'audit_immutable', allow: 'GET' });
  };
  for (const m of ['patch', 'put', 'delete', 'post']) r[m]('/api/audit/:id', worm);
  r.delete('/api/audit', worm);
}

module.exports = { register, validateYear, parseTimetablePayload, findConflicts, anonymizedSnapshot, validCidr, tempPassword, CSV_HEADER };
