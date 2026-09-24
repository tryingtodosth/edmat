'use strict';
/* Shared domain helpers used by every route module. Keep these the single source of truth for averages, attendance, access and notifications. */
const { average, attendanceStats: rawAttendanceStats, parseGrade, now, id, today: wallToday , localDate, localTime, toInstant, addDays, DEFAULT_TZ } = require('./util');
/* ---- czas szkoły (REL-08/REL-09, P24, P31) --------------------------------------------------
   Strefa szkoły jest jedna dla całej logiki: config.timezone, domyślnie Europe/Warsaw. `today`
   to dzień ścienny w tej strefie (w demo przypięty przez config.today), a `schoolNow` — jedyne
   źródło „pory dnia” dla wszystkich progów godzinowych. */
/** Strefa czasowa szkoły. */
const tz = (db) => ((db && db.data && db.data.config && db.data.config.timezone) || DEFAULT_TZ);
/** Dzień szkolny: przypięty w demo (config.today), inaczej data ścienna w strefie szkoły. */
const today = (db) => (db && db.data && db.data.config && db.data.config.today) || wallToday(tz(db));
/**
 * Jedno „teraz w szkole” dla wszystkich progów godzinowych (P31):
 *   { date: 'RRRR-MM-DD', time: 'GG:MM', instant: ISO z przesunięciem }.
 * Data i godzina zawsze pochodzą z tej samej strefy, a instant jest z nimi zgodny — również gdy
 * demo przypina dzień przez `config.today` (wtedy instant składa się z przypiętej daty i bieżącej
 * godziny lokalnej, zamiast sklejać datę szkolną z porą dnia w UTC).
 */
function schoolNow(db, instant) {
  const z = tz(db);
  const at = instant == null ? now() : (instant instanceof Date ? instant.toISOString() : String(instant));
  const realDate = localDate(at, z); const time = localTime(at, z);
  const pinned = (db && db.data && db.data.config && db.data.config.today) || null;
  const date = pinned || realDate;
  return { date, time, instant: date === realDate ? at : (toInstant(date, localTime(at, z, true), z) || at) };
}
/** Czy szkolny zegar ścienny nie minął jeszcze progu „GG:MM” (odwołanie obiadu, zgłoszenia). */
function isBeforeCutoff(db, cutoff, instant) {
  /* „9:00” wpisane w konfiguracji to literówka, nie wyłącznik progu: dopisujemy zero wiodące,
     zamiast po cichu przepuszczać odwołania obiadu przez całą dobę. */
  const m = /^(\d{1,2}):(\d{2})$/.exec(String(cutoff == null ? '' : cutoff).trim());
  if (!m || +m[1] > 23 || +m[2] > 59) return true;
  return schoolNow(db, instant).time < `${String(m[1]).padStart(2, '0')}:${m[2]}`;
}
/** Cisza nocna liczona w strefie szkoły (okno bywa przez północ: 21:00–06:30). */
function inQuietHours(user, db, instant) {
  const q = user && user.quietHours;
  if (!q || !q.from || !q.to || q.from === q.to) return false;
  const t = localTime(instant == null ? now() : instant, tz(db));
  return q.from < q.to ? (t >= q.from && t < q.to) : (t >= q.from || t < q.to);
}
/** Semestry z konfiguracji uporządkowane po dacie początkowej (konfiguracja bywa wpisana ręcznie). */
const semesterList = (db) => ((db.data.config || {}).semesters || []).slice().sort((a, b) => (a.from < b.from ? -1 : a.from > b.from ? 1 : 0));
/**
 * P25 — do którego semestru należy data. Dzień z przerwy międzysemestralnej (30.01–14.02) nie
 * mieści się w żadnym zakresie z konfiguracji, a mimo to musi dostać jednoznaczną odpowiedź:
 *
 *  - `mode` pominięty (odczyt klasyfikacyjny, domyślny) → semestr, który właśnie się **skończył**.
 *    Oceny, frekwencja i punkty zachowania oglądane w ferie dotyczą zamkniętego półrocza, więc
 *    arkusz, statystyki i wydruki pokazują dalej semestr 1, a nie pusty semestr 2.
 *  - `mode === 'entry'` (nowy wpis) → semestr, który się **zaczyna**. Ocena, uwaga czy wpis
 *    wystawiony w ferie należy już do drugiego półrocza — inaczej wpadałby do klasyfikacji
 *    zamkniętej uchwałą rady pedagogicznej.
 *
 * Żadna data nie daje „semestru nieokreślonego”: przed rokiem szkolnym to pierwszy semestr
 * z konfiguracji, po jego końcu — ostatni. Konfiguracja z jednym semestrem też jest bezpieczna
 * (dawna gałąź awaryjna czytała `semesters[1].from` i rzucała wyjątkiem).
 */
function semesterOf(db, date, mode) {
  const list = semesterList(db);
  if (!list.length) return 1;
  const d = date || today(db);
  const hit = list.find((x) => d >= x.from && d <= x.to);
  if (hit) return hit.id;
  if (d < list[0].from) return list[0].id;
  const next = list.find((x) => x.from > d);
  const prev = list.filter((x) => x.to < d).pop();
  if (!next) return (prev || list[list.length - 1]).id;
  return mode === 'entry' ? next.id : (prev || next).id;
}
const semester = (db, idv) => db.data.config.semesters.find((s) => s.id === +idv);
/** Statusy frekwencji, które zna dziennik; wszystko inne pochodzi z importu i jest błędem danych. */
const ATTENDANCE_STATUSES = ['ob', 'nb', 'sp', 'zw', 'u', 'rs', 'w'];
const warnedStatuses = new Set();
/**
 * P29 — `attendanceStats` z util.js wliczał nieznany status (np. „xx” z importu z innego dziennika)
 * do podstawy procentu, nie licząc go ani do obecności, ani do nieobecności: frekwencja po cichu
 * spadała. Tutaj nieznane statusy wypadają z podstawy (`percent` nigdy nie maleje przez błąd
 * danych), są liczone osobno w `unknown` / `unknownStatuses` i raz na proces trafiają do logu,
 * żeby administrator zobaczył, że import wymaga poprawki.
 */
function attendanceStats(entries) {
  const known = [], bad = [];
  for (const e of entries || []) { if (e && !e.draft && !ATTENDANCE_STATUSES.includes(e.status)) bad.push(e); else known.push(e); }
  const st = rawAttendanceStats(known);
  st.unknown = bad.length;
  st.unknownStatuses = [...new Set(bad.map((e) => String(e.status)))].sort();
  for (const code of st.unknownStatuses) {
    if (warnedStatuses.has(code)) continue;
    warnedStatuses.add(code);
    try { console.warn(`EdMat: nieznany status frekwencji „${code}” w danych (dopuszczalne: ${ATTENDANCE_STATUSES.join(', ')}). Wiersze z tym statusem nie są liczone do frekwencji — popraw import.`); } catch (_) { /* log nie może przerwać odczytu */ }
  }
  return st;
}
/**
 * R7 — mapowanie kodu frekwencji z obcego dziennika na nasz status. **Nic nie zgaduje.** Kod, który
 * nie jest naszym statusem i nie ma wpisu w mapowaniu, wraca jako `{ ok: false, reason: 'unknown' }`
 * — import ma go pokazać wychowawcy, a nie po cichu pominąć (archiwum z `tests/fixtures/real-formats`
 * używa `ns` = „nieobecność z przyczyn szkolnych”, którego nasz dziennik nie zna, a `attendanceStats`
 * zobaczyłby go dopiero jako spadek frekwencji).
 *
 * `mapping` to `{ 'ns': 'zw' }` — wartość `null` znaczy „świadomie pomijamy ten kod”.
 * Zwraca `{ ok, code, raw, source: 'native'|'mapping', skipped?, reason? }`.
 */
function mapAttendanceCode(code, mapping) {
  const raw = String(code == null ? '' : code).trim();
  const key = raw.toLowerCase();
  if (!key) return { ok: false, code: null, raw, reason: 'empty' };
  const m = mapping && typeof mapping === 'object'
    ? (Object.prototype.hasOwnProperty.call(mapping, raw) ? mapping[raw] : (Object.prototype.hasOwnProperty.call(mapping, key) ? mapping[key] : undefined))
    : undefined;
  if (m !== undefined) {
    if (m === null || m === false || m === '') return { ok: true, code: null, raw, source: 'mapping', skipped: true };
    const target = String(m).toLowerCase();
    if (!ATTENDANCE_STATUSES.includes(target)) return { ok: false, code: null, raw, target, reason: 'target_unknown' };
    return { ok: true, code: target, raw, source: 'mapping' };
  }
  if (ATTENDANCE_STATUSES.includes(key)) return { ok: true, code: key, raw, source: 'native' };
  return { ok: false, code: null, raw, reason: 'unknown' };
}
const classOf = (db, studentId) => { const s = db.get('students', studentId); return s ? db.get('classes', s.classId) : null; };
const student = (db, idv) => db.get('students', idv);
const teacherTeaches = (db, user, subjectId, classId) => user.role === 'principal' || (user.subjects || []).includes(subjectId) && (!classId || db.col('timetable').some((t) => t.teacherId === user.id && t.subjectId === subjectId && t.classId === classId) || db.col('lessons').some((l) => (l.teacherId === user.id || l.substituteTeacherId === user.id) && l.subjectId === subjectId && l.classId === classId));
/**
 * Wychowawca oddziału — powołany na stałe albo p.o. (REG-12).
 *
 * Decyzja produktowa: **powierzenie obowiązków działa wyłącznie w swoim terminie** `[actingFrom,
 * actingTo]` (obie daty włącznie, liczone dniem szkolnym `today(db)`). Powierzenie podpisane
 * z wyprzedzeniem nie daje praw przed pierwszym dniem, a wygasłe przestaje je dawać samo —
 * bez czekania, aż dyrektor je cofnie ręcznie. Wychowawca powołany na stałe nie ma terminu
 * i jest wychowawcą zawsze.
 */
const isHomeroomOf = (db, user, classId) => {
  const c = db.get('classes', classId);
  if (!c || !user) return false;
  if (c.homeroomTeacherId === user.id) return true;
  if (c.actingHomeroomTeacherId !== user.id) return false;
  const d = today(db);
  return (!c.actingFrom || d >= c.actingFrom) && (!c.actingTo || d <= c.actingTo);
};
/** Which students may this user see? returns array of studentIds or null for "all" */
function visibleStudentIds(db, user) {
  if (user.role === 'student') return [user.studentId];
  /* R3/F1 — jedna bramka: sprzeciw i zgoda ucznia pełnoletniego (config.adultAccess) ORAZ zakres
     władzy rodzicielskiej. Dziecko, przy którym opiekun ma zakres `none`, znika z jego konta na
     każdej trasie chronionej `assertCanSeeStudent` — nie tylko na ekranie ocen (D3-03, S3-04). */
  if (user.role === 'parent') return (user.childrenIds || []).filter((sid) => guardianStanding(db, user, sid).ok);
  return null;
}
/**
 * Krąg dostępu: czyje dane w ogóle wolno komuś oglądać. Odmowa niesie ten sam komplet pól, co
 * `assertMayReadPupilRecord` (`code` + `deny` + `scope`) — inaczej klient dostawał `deny: undefined`
 * akurat w dwóch przypadkach, które musi rozróżnić: „to nie twoje dziecko” i „uczeń pełnoletni
 * wniósł sprzeciw wobec dostępu opiekunów”.
 */
function assertCanSeeStudent(db, user, studentId) {
  const v = visibleStudentIds(db, user);
  if (!v || v.includes(studentId)) return;
  const httpError = require('./router').httpError;
  if (user.role === 'parent') {
    const st = guardianStanding(db, user, studentId);
    if (st.reason === 'parent_access_blocked')
      throw httpError(403, 'Uczeń pełnoletni wniósł sprzeciw wobec dostępu opiekunów do jego danych.', { code: 'forbidden', deny: 'guardian_scope', scope: 'none', parentAccessBlocked: true });
    if (st.reason === 'consent_required')
      throw httpError(403, `Uczeń jest pełnoletni od ${st.since || '—'}. Szkoła udostępnia jego dane opiekunom dopiero po jego zgodzie (ustawienie szkoły: zgoda wymagana).`, { code: 'forbidden', deny: 'guardian_scope', scope: 'none', adultAccess: st.adultAccess, adultSince: st.since });
    if (st.reason === 'guardian_scope')
      throw httpError(403, 'Dostęp do danych dziecka został ograniczony decyzją zapisaną w dokumentacji szkoły.', { code: 'forbidden', deny: 'guardian_scope', scope: 'none', guardianStatus: st.status });
    throw httpError(403, 'Brak dostępu do danych tego ucznia.', { code: 'forbidden', deny: 'guardian_scope', scope: 'none' });
  }
  throw httpError(403, 'Brak dostępu do danych tego ucznia.', { code: 'forbidden', deny: 'record_scope' });
}
/* ---------- S-10: kto czyta kartę ucznia (decyzja produktowa z docs/review/FIXPLAN.md) ---------- */
/** Rodzaje danych ucznia rozróżniane przy odczycie. */
const RECORD_KINDS = ['grades', 'remarks', 'homework', 'descriptive', 'attendance', 'directory'];
/** Dane o uczeniu się: ocen, uwag, zadań i oceny opisowej nie czyta stołówka, biblioteka, świetlica, pielęgniarka ani IOD. */
const LEARNING_KINDS = ['grades', 'remarks', 'homework', 'descriptive'];
/** Zespół wspierający — czyta kartę ucznia w całej szkole (pomoc psychologiczno-pedagogiczna). */
const SUPPORT_ROLES = ['counselor', 'psychologist', 'specialEducator', 'speechTherapist', 'supportTeacher'];
/* ---- R3: władza rodzicielska i uczeń pełnoletni (docs/GUARDIANS.md) --------------------------
   Raport z 23.09.2026 (wiersze 9 i 10 triage'u) mieszał dwie rzeczy: rodzica *pozbawionego* władzy
   z rodzicem o władzy *ograniczonej*. Praktyka MEN rozdziela je tak, jak poniższa tabela, a decyzję
   o uczniu pełnoletnim zostawiamy szkole jako przełącznik konfiguracji. Oba ustawienia są jawne. */
/** Status władzy rodzicielskiej zapisany przy wpisie opiekuna (`students[].guardians[].status`). */
const GUARDIAN_STATUSES = ['full', 'limited', 'deprived', 'court-restricted'];
/** Zakres, który wynika z samego statusu, gdy sekretariat nie nadpisał go ręcznie. */
const GUARDIAN_STATUS_SCOPE = { full: 'full', limited: 'full', deprived: 'none', 'court-restricted': 'info' };
/** Status wpisu opiekuna; dane sprzed tej zmiany (bez pola `status`) zachowują się jak `full`. */
const guardianStatus = (g) => (g && GUARDIAN_STATUSES.includes(g.status) ? g.status : 'full');
/** Domyślny zakres dla statusu: pełna i ograniczona władza → `full`, sąd → `info`, pozbawienie → `none`. */
const guardianStatusScope = (status) => GUARDIAN_STATUS_SCOPE[GUARDIAN_STATUSES.includes(status) ? status : 'full'];
/** Tryby dostępu opiekunów do danych ucznia pełnoletniego (`config.adultAccess`). */
const ADULT_ACCESS_MODES = ['until-objection', 'consent-required'];
/** Który tryb obowiązuje w tej szkole; domyślnie „do sprzeciwu” — dotychczasowe zachowanie dziennika. */
const adultAccessMode = (db) => {
  const m = db && db.data && db.data.config ? db.data.config.adultAccess : null;
  return ADULT_ACCESS_MODES.includes(m) ? m : 'until-objection';
};
/** Dzień 18. urodzin z daty urodzenia (29 lutego → 28 lutego w roku nieprzestępnym); `null` bez daty. */
function adultFrom(s) {
  const b = String((s && s.birthDate) || '');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(b)) return null;
  const year = +b.slice(0, 4) + 18, month = b.slice(5, 7), day = +b.slice(8, 10);
  const lastDay = new Date(Date.UTC(year, +month, 0)).getUTCDate();
  return `${year}-${month}-${String(Math.min(day, lastDay)).padStart(2, '0')}`;
}
/**
 * Reguła dostępu opiekunów do danych ucznia pełnoletniego — jedna dla całego dziennika, żeby uczeń,
 * opiekun i wychowawca widzieli to samo zdanie i tę samą datę. Zwraca:
 *   { mode, adult, adultFrom, guardianAccess: 'open'|'blocked'|'pending-consent', since, consent, objection }
 * `blocked` to sprzeciw ucznia (3.6.12) — działa w obu trybach; `pending-consent` występuje tylko
 * w trybie `consent-required` i znaczy „od 18. urodzin bez zgody ucznia opiekun nie widzi nic”.
 * Pełnoletność liczymy z daty urodzenia i dnia szkolnego `today(db)`; flaga `students[].adult`
 * zostaje awaryjnym źródłem dla wpisów bez daty urodzenia.
 */
function adultAccessState(db, s, date) {
  const mode = adultAccessMode(db);
  const day = date || today(db);
  const from = adultFrom(s);
  const adult = from ? day >= from : !!(s && s.adult);
  const consent = (s && s.adultConsent) || null;
  const given = !!(consent && consent.given);
  const objection = !!(s && s.parentAccessBlocked);
  let guardianAccess = 'open', since = null;
  if (objection) { guardianAccess = 'blocked'; since = (s && s.parentAccessBlockedAt) || null; }
  else if (mode === 'consent-required' && adult) {
    if (given) since = (consent && consent.at) || null;
    else { guardianAccess = 'pending-consent'; since = from || null; }
  }
  return {
    mode, adult, adultFrom: from, adultSince: adult ? from : null, guardianAccess, since,
    consent: { given, at: (consent && consent.at) || null, byUserId: (consent && consent.byUserId) || null, reason: (consent && consent.reason) || null },
    objection: { blocked: objection, at: (s && s.parentAccessBlockedAt) || null, reason: (s && s.parentAccessReason) || null }
  };
}
/**
 * Jedyne miejsce, w którym zapisuje się zgoda albo sprzeciw ucznia pełnoletniego — zgoda i sprzeciw
 * są swoimi odwrotnościami, więc trzymają się jednej pary pól (`parentAccessBlocked` + `adultConsent`),
 * żeby przełączenie `config.adultAccess` nie zostawiło szkoły z dwoma sprzecznymi zapisami.
 * `{ consent: true }` = zgoda (i cofnięcie sprzeciwu), `{ blocked: true }` = sprzeciw (i brak zgody).
 * Zwraca `{ before, after, state }` — `before`/`after` idą wprost do wiersza audytowego; powiadomienia
 * zostawia warstwie tras (to ona zna teksty i adresatów).
 */
function setAdultParentAccess(db, s, opts) {
  const o = opts || {}; const at = o.at || now();
  const mode = adultAccessMode(db);
  const before = { parentAccessBlocked: !!s.parentAccessBlocked, consent: !!(s.adultConsent && s.adultConsent.given), mode };
  const reason = String(o.reason || '').trim().slice(0, 300) || null;
  const given = o.consent !== undefined && o.consent !== null ? !!o.consent : !o.blocked;
  s.adultConsent = { given, at, byUserId: o.byUserId || null, reason };
  s.parentAccessBlocked = !given;
  s.parentAccessBlockedAt = given ? null : at;
  s.parentAccessReason = given ? null : (reason || 'Sprzeciw ucznia pełnoletniego');
  db.save();
  return { before, after: { parentAccessBlocked: !!s.parentAccessBlocked, consent: given, mode }, state: adultAccessState(db, s) };
}
/**
 * Zakres dostępu opiekuna: `full` (wszystko), `info` (frekwencja, plan, wiadomości, ogłoszenia —
 * bez ocen), `none` (nic). Czytany z `students[].guardians[]` (gdy szkoła prowadzi listę opiekunów
 * przy uczniu), inaczej z konta opiekuna (`users[].accessScope`); brak zapisu = `full`. Gdy przy
 * wpisie jest status władzy rodzicielskiej, a nie ma jawnego zakresu — zakres wynika ze statusu.
 * Uczeń pełnoletni w trybie `consent-required` odcina opiekunów do dnia swojej zgody.
 */
function guardianScope(db, user, studentId) {
  if (!user || user.role !== 'parent') return 'full';
  return guardianStanding(db, user, studentId).scope;
}
/** Wpis opiekuna przy uczniu (`students[].guardians[]`); `null`, gdy szkoła nie prowadzi listy. */
function guardianEntry(s, userId) {
  const list = s && Array.isArray(s.guardians) ? s.guardians : null;
  return list ? (list.find((x) => x && (x.userId || x.id) === userId) || null) : null;
}
/**
 * D3-09 — zakres zapisany przy wpisie nie może być szerszy, niż pozwala status. Seed, migracja albo
 * import mogą wpisać sprzeczną parę (`{status:'deprived', accessScope:'full'}`); odczyt ją przycina,
 * bo walidacja przy zapisie (`guardianTransition`) chroni tylko trasę sekretariatu.
 */
function clampGuardianScope(status, scope) {
  const s = scope === 'info' || scope === 'none' ? scope : 'full';
  if (status === 'deprived') return 'none';
  if (status === 'court-restricted') return s === 'full' ? 'info' : s;
  return s;
}
/* ---- F1: JEDNA bramka „czy ten opiekun ma legitymację przy tym dziecku” ----------------------
   D3-01/02/03 i S3-04 to jeden defekt widziany z czterech stron: zakres władzy rodzicielskiej był
   czytany tylko przy odczycie karty ucznia, a powiadomienia, wiadomości, zgody i decyzje szły
   obok niego. Od R3/F1 każda z tych dróg pyta `guardianStanding`, a nie własny warunek. */
/**
 * Legitymacja opiekuna przy jednym dziecku. Zwraca:
 *   { ok, scope: 'full'|'info'|'none', reason, status, adultAccess, since }
 * `reason` (gdy `ok` jest fałszem): `'no_account'`, `'no_student'`, `'not_guardian'`,
 * `'parent_access_blocked'` (sprzeciw ucznia pełnoletniego), `'consent_required'` (tryb
 * `consent-required` przed zgodą) albo `'guardian_scope'` (sąd odebrał wgląd).
 * Dla pracownika szkoły i ucznia zwraca `{ ok: true, scope: 'full' }` — bramką ról zajmują się trasy.
 * `user` może być kontem albo samym `userId` (fan-out po `s.parentIds` zna tylko identyfikatory).
 */
function guardianStanding(db, user, studentId) {
  const u = typeof user === 'string' ? db.get('users', user) : user;
  if (!u) return { ok: false, scope: 'none', reason: 'no_account', status: null, adultAccess: null, since: null };
  if (u.role !== 'parent') return { ok: true, scope: 'full', reason: null, status: null, adultAccess: null, since: null };
  const s = db.get('students', studentId);
  if (!s) return { ok: false, scope: 'none', reason: 'no_student', status: null, adultAccess: null, since: null };
  /* Opiekunem czyni albo konto (childrenIds), albo księga ucznia (parentIds) — fan-out idzie po drugiej. */
  if (!(u.childrenIds || []).includes(s.id) && !(s.parentIds || []).includes(u.id))
    return { ok: false, scope: 'none', reason: 'not_guardian', status: null, adultAccess: null, since: null };
  const entry = guardianEntry(s, u.id);
  const status = guardianStatus(entry);
  const adult = adultAccessState(db, s);
  const base = { status, adultAccess: adult.mode, since: adult.since };
  if (adult.guardianAccess === 'blocked') return Object.assign({ ok: false, scope: 'none', reason: 'parent_access_blocked' }, base);
  if (adult.guardianAccess === 'pending-consent') return Object.assign({ ok: false, scope: 'none', reason: 'consent_required' }, base);
  const stored = (entry && entry.accessScope) || (entry ? guardianStatusScope(status) : null) || u.accessScope || 'full';
  const scope = clampGuardianScope(status, stored);
  if (scope === 'none') return Object.assign({ ok: false, scope: 'none', reason: 'guardian_scope' }, base, { since: null });
  return Object.assign({ ok: true, scope, reason: null }, base, { since: null });
}
/**
 * Rodzaje powiadomień i pism, które opiekun z zakresem `info` dostaje nadal: frekwencja, plan lekcji
 * i zastępstwa, ogłoszenia, korespondencja ze szkołą, zebrania i pisma o jego własnych prawach.
 * Lista jest pozytywna z rozmysłem: nowy rodzaj powiadomienia domyślnie NIE idzie do opiekuna,
 * któremu sąd zawęził prawo do informacji. Poza listą zostają oceny, uwagi, zachowanie, gabinet
 * profilaktyczny, pomoc psychologiczno-pedagogiczna i pieniądze (docs/GUARDIANS.md § 1).
 */
const GUARDIAN_INFO_KINDS = ['absence', 'attendance-alert', 'excuse', 'schedule', 'timetable', 'substitution',
  'announcement', 'message', 'broadcast', 'ack', 'meeting', 'rights', 'semester'];
/** Czy zakres `scope` przepuszcza powiadomienie/pismo rodzaju `kind`? `none` nie przepuszcza nic. */
function guardianKindAllowed(scope, kind) {
  if (scope === 'none') return false;
  if (scope !== 'info') return true;
  return GUARDIAN_INFO_KINDS.includes(String(kind || 'message'));
}
/**
 * Czy opiekun może dziś zobaczyć to powiadomienie? Powiadomienia o danych ucznia niosą `studentId`
 * (zapisuje je `notify`), więc feed odfiltrowuje te, które powstały, zanim sąd zawęził dostęp.
 * Dla pozostałych ról i powiadomień bez `studentId` zawsze `true`.
 */
function notificationVisible(db, user, n) {
  if (!n || !user || user.role !== 'parent' || !n.studentId) return true;
  const st = guardianStanding(db, user, n.studentId);
  return st.ok && guardianKindAllowed(st.scope, n.kind);
}
/* ---- F1: przejścia między statusami władzy rodzicielskiej (S3-10, D3-06, D3-07) -------------- */
/** Rodzaje podstawy zapisanej przy wpisie opiekuna. */
const GUARDIAN_BASIS_KINDS = ['court-order', 'declaration'];
/** Statusy, których nie da się nałożyć ani zdjąć bez dokumentu. */
const GUARDIAN_COURT_STATUSES = ['deprived', 'court-restricted'];
/** Odczyt `basis` z żądania; `fallbackReference` (opis podstawy) wypełnia sygnaturę, gdy jej nie podano. */
function readGuardianBasis(raw, fallbackReference) {
  const httpError = require('./router').httpError;
  const b = raw && typeof raw === 'object' ? raw : {};
  if (b.kind && !GUARDIAN_BASIS_KINDS.includes(String(b.kind)))
    throw httpError(400, 'Rodzaj podstawy to „court-order” (postanowienie sądu) albo „declaration” (oświadczenie opiekuna).', { field: 'basis.kind', code: 'guardian_basis_kind', allowed: GUARDIAN_BASIS_KINDS });
  const kind = b.kind ? String(b.kind) : null;
  const reference = String(b.reference == null ? (fallbackReference || '') : b.reference).trim().slice(0, 200) || null;
  const date = /^\d{4}-\d{2}-\d{2}$/.test(String(b.date || '')) ? String(b.date) : null;
  return kind || reference || date ? { kind, reference, date } : null;
}
/**
 * Jedno przejście wpisu opiekuna: ze stanu `entry` do `next` (`{status, accessScope}`) na podstawie
 * żądania `body` (`basis`, `legalBasis`/`reason`). Zwraca
 *   { status, scope, derived, explicit, scopeSource, basis, basisCleared, carriedScope, transition }
 * albo rzuca 400 ze stabilnym `code` (docs/GUARDIANS.md § 3). Reguły:
 *  - **nałożenie** `deprived`/`court-restricted` wymaga `basis.kind === 'court-order'` z sygnaturą;
 *  - **zdjęcie** ich wymaga NOWEJ podstawy w tym żądaniu (postanowienie sądu albo oświadczenie
 *    sekretariatu z sygnaturą pisma) i **kasuje** poprzednią — inaczej wiersz audytu przywracający
 *    dostęp powołuje się na postanowienie, które go odbierało (S3-10, D3-07);
 *  - podstawa nigdy nie przechodzi przez zmianę statusu; przy zmianie samego zakresu zostaje;
 *  - ręcznie nadpisany zakres (`scopeSource: 'explicit'`) **przeżywa** zmianę statusu, a gdy nowy
 *    status go nie dopuszcza — żądanie jest odrzucane (`guardian_scope_conflict`), a nie po cichu
 *    nadpisywane (D3-06).
 */
function guardianTransition(entry, next, body) {
  const httpError = require('./router').httpError;
  const n = next || {}; const b = body || {};
  const prevStatus = guardianStatus(entry);
  const status = n.status === undefined || n.status === null ? prevStatus : String(n.status);
  if (!GUARDIAN_STATUSES.includes(status)) throw httpError(400, `Status władzy rodzicielskiej może być: ${GUARDIAN_STATUSES.join(', ')}.`, { field: 'status', code: 'guardian_status_unknown', allowed: GUARDIAN_STATUSES });
  const legalBasis = String(b.legalBasis || b.reason || '').trim() || null;
  const sent = b.basis !== undefined;
  const imposing = GUARDIAN_COURT_STATUSES.includes(status);
  const lifting = GUARDIAN_COURT_STATUSES.includes(prevStatus) && !imposing;
  const changed = status !== prevStatus;
  /* Podstawa. Nakładamy i zdejmujemy wyłącznie na dokumencie; przy zmianie statusu stara podstawa
     nie jedzie dalej, przy zmianie samego zakresu zostaje. */
  let basis, inherited = false;
  if (lifting) {
    basis = readGuardianBasis(sent ? b.basis : null, null);
    if (!basis || !basis.kind) throw httpError(400, 'Zdjęcie ograniczenia orzeczonego przez sąd zapisuje się na dokumencie: podaj podstawę „court-order” (postanowienie zmieniające) albo „declaration” (oświadczenie przyjęte w sekretariacie) wraz z sygnaturą pisma.', { field: 'basis.kind', code: 'guardian_basis_required', status, previousStatus: prevStatus, transition: 'lift', allowed: GUARDIAN_BASIS_KINDS });
    if (!basis.reference) throw httpError(400, 'Podaj sygnaturę dokumentu, na podstawie którego zdejmujesz ograniczenie — bez niej zmiany nie da się obronić w dokumentacji szkoły.', { field: 'basis.reference', code: 'guardian_basis_reference_required', status, previousStatus: prevStatus, transition: 'lift' });
  } else if (imposing) {
    /* Zmiana samego zakresu przy tym samym statusie nie kasuje postanowienia, na którym stoi wpis. */
    if (sent) basis = readGuardianBasis(b.basis, legalBasis);
    else if (!changed && entry && entry.basis) { basis = entry.basis; inherited = true; }
    else basis = readGuardianBasis(null, legalBasis);
    if (!basis || basis.kind !== 'court-order') throw httpError(400, status === 'deprived'
      ? 'Pozbawienie władzy rodzicielskiej zapisuje się wyłącznie na podstawie postanowienia sądu — ustaw podstawę „court-order” i podaj sygnaturę.'
      : 'Ograniczenie dostępu do informacji orzeczeniem sądu wymaga podstawy „court-order” z sygnaturą postanowienia.',
    { field: 'basis.kind', code: 'guardian_basis_required', status, requiredKind: 'court-order', transition: changed ? 'impose' : 'keep' });
    if (!basis.reference) throw httpError(400, 'Podaj sygnaturę postanowienia sądu — bez niej zmiany statusu nie da się obronić w dokumentacji szkoły.', { field: 'basis.reference', code: 'guardian_basis_reference_required', status });
  } else if (changed) {
    basis = readGuardianBasis(sent ? b.basis : null, legalBasis);
  } else if (sent) {
    basis = readGuardianBasis(b.basis, legalBasis);
  } else if (entry && entry.basis) {
    basis = entry.basis; inherited = true;
  } else {
    basis = readGuardianBasis(null, legalBasis);
  }
  /* „Wyczyszczona” znaczy: poprzednia podstawa nie jedzie dalej — przy zmianie statusu nigdy nie jedzie. */
  const basisCleared = !!(entry && entry.basis) && !inherited;
  /* Zakres. Ręczne nadpisanie przeżywa zmianę statusu (D3-06); zakaz ze statusu jest mocniejszy. */
  const hasScope = n.accessScope !== undefined && n.accessScope !== null;
  if (hasScope && !['full', 'info', 'none'].includes(String(n.accessScope)))
    throw httpError(400, 'Zakres dostępu może być „full” (pełny), „info” (bez ocen) albo „none” (brak).', { field: 'accessScope', code: 'guardian_scope_unknown', allowed: ['full', 'info', 'none'] });
  const carried = !hasScope && !!(entry && entry.scopeSource === 'explicit' && entry.accessScope);
  const requested = hasScope ? String(n.accessScope) : (carried ? entry.accessScope : null);
  const derived = guardianStatusScope(status);
  const scope = requested || derived;
  const conflict = (allowed, msg) => { throw httpError(400, msg, { field: 'accessScope', code: 'guardian_scope_conflict', status, allowed, derived, requested: scope, carried }); };
  if (status === 'deprived' && scope !== 'none') conflict(['none'], carried
    ? `Przy tym opiekunie zapisano ręcznie zakres „${scope}”, a rodzic pozbawiony władzy rodzicielskiej może mieć wyłącznie „none”. Podaj zakres jawnie razem ze statusem.`
    : 'Rodzic pozbawiony władzy rodzicielskiej nie ma dostępu do danych ucznia — dopuszczalny zakres to „none”.');
  if (status === 'court-restricted' && scope === 'full') conflict(['info', 'none'], carried
    ? 'Przy tym opiekunie zapisano ręcznie zakres „full”, a przy ograniczeniu orzeczeniem sądu dopuszczalne są „info” albo „none”. Podaj zakres jawnie razem ze statusem.'
    : 'Przy ograniczeniu orzeczeniem sądu zakres to „info” (bez ocen) albo „none” — zgodnie z treścią postanowienia.');
  const explicit = (hasScope || carried) && scope !== derived;
  return { status, scope, derived, explicit, scopeSource: explicit ? 'explicit' : 'derived', basis, basisCleared, carriedScope: carried, previousStatus: prevStatus,
    transition: lifting ? 'lift' : imposing && changed ? 'impose' : changed ? 'change' : 'none' };
}
/** Czy nauczyciel uczy tego ucznia (oddział, grupa albo zastępstwo) lub jest jego wychowawcą? */
function teachesPupil(db, user, studentId) {
  const s = db.get('students', studentId);
  if (!s) return false;
  if (isHomeroomOf(db, user, s.classId)) return true;
  if (db.col('timetable').some((t) => t.classId === s.classId && t.teacherId === user.id)) return true;
  if (db.col('lessons').some((l) => l.classId === s.classId && (l.teacherId === user.id || l.substituteTeacherId === user.id))) return true;
  return db.col('groups').some((g) => (g.studentIds || []).includes(studentId) && (g.teacherId === user.id || (g.teacherIds || []).includes(user.id)));
}
/**
 * S-10 — jedna bramka na każdy odczyt karty ucznia. `kind` to rodzaj danych:
 * 'grades' | 'remarks' | 'homework' | 'descriptive' (dane o uczeniu się), 'attendance'
 * (obecność) albo 'directory' (dane kontaktowe i przydział do oddziału).
 *
 * Czytają: uczeń (swoje), opiekun z zakresem `full` (`info` — tylko frekwencja i katalog),
 * nauczyciel uczący tego ucznia, wychowawca (wszystkie przedmioty), dyrektor i zespół wspierający.
 * Świetlica, stołówka, biblioteka, pielęgniarka i IOD zostają przy katalogu ucznia i obecności
 * na dany dzień — ocen, uwag, zadań i oceny opisowej nie widzą.
 *
 * Odmowa to zawsze 403 z `code: 'forbidden'` (jak dotąd w całym API); powód rozróżnia pole `deny`:
 * 'guardian_scope' | 'not_teaching_pupil' | 'record_scope'.
 */
function assertMayReadPupilRecord(db, user, studentId, kind) {
  const httpError = require('./router').httpError;
  const k = RECORD_KINDS.includes(kind) ? kind : 'grades';
  assertCanSeeStudent(db, user, studentId);
  if (user.role === 'student') return k;
  if (user.role === 'parent') {
    const scope = guardianScope(db, user, studentId);
    if (scope === 'none') {
      /* R3 — uczeń pełnoletni w trybie „zgoda wymagana” to inna odmowa niż ograniczenie władzy
         rodzicielskiej: opiekun musi wiedzieć, że czeka na zgodę ucznia, a nie na decyzję szkoły. */
      const adultRule = adultAccessState(db, db.get('students', studentId));
      if (adultRule.guardianAccess === 'pending-consent') throw httpError(403, `Uczeń jest pełnoletni od ${adultRule.since || '—'}. Szkoła udostępnia jego dane opiekunom dopiero po jego zgodzie (ustawienie szkoły: zgoda wymagana).`, { code: 'forbidden', deny: 'guardian_scope', scope, adultAccess: adultRule.mode, adultSince: adultRule.since });
      throw httpError(403, 'Dostęp do danych dziecka został ograniczony decyzją zapisaną w dokumentacji szkoły.', { code: 'forbidden', deny: 'guardian_scope', scope });
    }
    if (scope === 'info' && LEARNING_KINDS.includes(k)) throw httpError(403, 'Konto opiekuna ma dostęp informacyjny: frekwencja, plan lekcji, wiadomości i ogłoszenia — bez ocen, uwag i zadań.', { code: 'forbidden', deny: 'guardian_scope', scope });
    return k;
  }
  if (!LEARNING_KINDS.includes(k)) return k;                      // katalog i obecność — każdy pracownik szkoły
  if (user.role === 'principal' || SUPPORT_ROLES.includes(user.role)) return k;
  if (user.role === 'teacher') {
    if (!teachesPupil(db, user, studentId)) throw httpError(403, 'Widzisz dane uczniów, których uczysz, oraz swojego oddziału wychowawczego.', { code: 'forbidden', deny: 'not_teaching_pupil' });
    return k;
  }
  throw httpError(403, 'Oceny, uwagi, zadania i oceny opisowe ucznia nie są dostępne dla tej roli.', { code: 'forbidden', deny: 'record_scope' });
}
/** Grades of a student for a subject/semester with the average computed by the school rule. */
function studentGrades(db, studentId, subjectId, sem) {
  const s = sem || semesterOf(db); const cfg = db.data.config;
  const list = db.col('grades').filter((g) => g.studentId === studentId && (!subjectId || g.subjectId === subjectId) && g.semester === s && !g.deleted);
  const partial = list.filter((g) => g.kind === 'partial');
  const avg = average(partial.map((g) => Object.assign({}, g, { countsInAverage: g.countsInAverage !== false })), { retakeRule: cfg.retakeRule, plusMinus: cfg.plusMinus });
  return { grades: list, partial, average: avg.average, count: avg.count, proposed: list.find((g) => g.kind === (s === 1 ? 'proposedMid' : 'proposedFinal')) || null, final: list.find((g) => g.kind === (s === 1 ? 'midterm' : 'final')) || null };
}
function subjectsOfClass(db, classId) { return [...new Set(db.col('timetable').filter((t) => t.classId === classId).map((t) => t.subjectId))]; }
/** Attendance entries for a student in a period (non-draft), with stats. */
function attendanceFor(db, studentId, from, to) { const e = db.col('attendance').filter((a) => a.studentId === studentId && !a.draft && (!from || a.date >= from) && (!to || a.date <= to)); return Object.assign({ entries: e }, attendanceStats(e)); }
/** P25 — poza zakresem semestru wpadają jeszcze dni przerwy międzysemestralnej; nie mogą wypaść
    z zestawienia, więc przypisuje je `semesterOf` (odczyt: semestr, który się skończył). */
function attendanceBySubject(db, studentId, sem) { const s = semester(db, sem || semesterOf(db)); const inSem = (d) => (d >= s.from && d <= s.to) || (!semesterList(db).some((x) => d >= x.from && d <= x.to) && semesterOf(db, d) === s.id); const e = db.col('attendance').filter((a) => a.studentId === studentId && !a.draft && inSem(a.date)); const by = {}; for (const a of e) { (by[a.subjectId] = by[a.subjectId] || []).push(a); } return Object.fromEntries(Object.entries(by).map(([k, v]) => [k, attendanceStats(v)])); }
function isSemesterLocked(db, sem, classId) { const s = semester(db, sem); if (!s) return false; if (s.locked) return true; const lock = db.col('semesterLocks').find((l) => l.semester === +sem && (l.classId === classId || !l.classId) && !l.reopened); return !!lock; }
function lessonsOn(db, date, classId) { return db.col('lessons').filter((l) => l.date === date && (!classId || l.classId === classId)).sort((a, b) => a.lessonNo - b.lessonNo); }
function lessonTime(db, no) { return db.data.config.lessonTimes.find((t) => t.no === no) || { start: '', end: '' }; }
/* ---- GAP-7: jedna droga powiadomień ---------------------------------------------------------
   Do tej rundy dziennik miał dwie: `D.notify` wstawiał wiersz wprost do kolekcji (bez ciszy nocnej
   i bez deduplikacji), a `createNotification` z routes/notifications.js — z jednym i drugim.
   Opiekun z włączoną ciszą nocną był więc wyciszony tylko w połowie dziennika. Logika mieszka
   teraz tutaj (żeby nie robić zależności lib → routes), a routes/notifications.js ją re-eksportuje
   i dokłada to, co należy do warstwy tras: kolejkę Web Push. */

/** Koniec ciszy nocnej po instancie `at`, liczony w strefie szkoły (okno bywa przez północ). */
function endOfQuiet(at, q, zone) {
  const z = zone || DEFAULT_TZ;
  const day = localDate(at, z); const t = localTime(at, z);
  const sameDay = q.from < q.to ? (t >= q.from && t < q.to) : t < q.to;
  return toInstant(sameDay ? day : addDays(day, 1), q.to + ':00', z) || at;
}
/* Warstwa tras (routes/notifications.js) dokłada tu wysyłkę push; lib nie wie nic o kolejce. */
const notifyHooks = [];
/** Rejestruje obserwatora wywoływanego po wstawieniu wiersza: `(db, notification) => void`. */
function onNotify(fn) { if (typeof fn === 'function' && !notifyHooks.includes(fn)) notifyHooks.push(fn); return fn; }
/**
 * Jedyna droga tworzenia powiadomień. Honoruje ciszę nocną konta (`users[].quietHours`) — alert
 * kryzysowy przechodzi zawsze — i deduplikuje po `dedupeKey`. Zwraca wstawiony wiersz albo `null`,
 * gdy konta nie ma lub powiadomienie o tym samym kluczu już istnieje.
 */
function notify(db, userId, kind, text, opts) {
  const o = opts || {};
  const u = db.get('users', userId); if (!u) return null;
  if (o.dedupeKey && db.col('notifications').some((n) => n.userId === userId && n.dedupeKey === o.dedupeKey)) return null;
  const at = o.at || now();
  const q = u.quietHours || null;
  const deferred = !!(q && inQuietHours(u, db, at) && !o.crisis);
  const n = db.insert('notifications', {
    /* `studentId` niesie powiadomienie o danych ucznia — feed opiekuna czyta je przez
       `notificationVisible`, więc zawężenie dostępu działa też wstecz, na wiersze już zapisane. */
    id: id('not'), userId, kind, text, at, read: false, crisis: !!o.crisis, link: o.link || null, studentId: o.studentId || null,
    push: deferred ? false : o.push !== false, deferred,
    deliverAt: deferred ? endOfQuiet(at, q, tz(db)) : at,
    quietHours: q ? `${q.from}–${q.to}` : null,
    dedupeKey: o.dedupeKey || null, quietBypass: !!o.crisis
  });
  for (const fn of notifyHooks) { try { fn(db, n); } catch (e) { /* wysyłka push nie może przewrócić zapisu */ } }
  return n;
}
/**
 * Powiadomienie dla opiekunów ucznia — JEDYNA droga rozsyłki po `students[].parentIds`.
 * Każdy adresat przechodzi przez `guardianStanding` i regułę rodzaju: opiekun z zakresem `none`
 * (pozbawiony władzy, sprzeciw albo brak zgody ucznia pełnoletniego) nie dostaje nic, a opiekun
 * z zakresem `info` — tylko frekwencję, plan, ogłoszenia i korespondencję (D3-01, S3-04).
 * `notify` może zwrócić `null` (brak konta, deduplikacja).
 */
function notifyParentsOf(db, studentId, kind, text, opts) {
  const s = db.get('students', studentId); if (!s) return [];
  const o = Object.assign({}, opts || {}, { studentId: s.id });
  return (s.parentIds || [])
    .filter((p) => { const st = guardianStanding(db, p, s.id); return st.ok && guardianKindAllowed(st.scope, kind); })
    .map((p) => notify(db, p, kind, text, o)).filter(Boolean);
}
function sendMessage(db, m) { return db.insert('messages', Object.assign({ at: now(), kind: 'message', confidential: false, requiresAck: false, readBy: {}, deliveredTo: m.toUserIds.slice(), attachments: [] }, m)); }
function userLabel(u) { return u ? ((u.title ? u.title + ' ' : '') + u.firstName + ' ' + u.lastName) : ''; }
/**
 * OPS-20 — dwoje uczniów o tym samym imieniu i nazwisku w jednym oddziale. Zwraca dopisek, który
 * ich rozróżnia: numer w dzienniku, a gdy uczeń go nie ma — rok urodzenia. `null`, gdy imiennika
 * nie ma albo wywołanie nie przekazało bazy (stare wywołania `studentLabel(s)` działają jak dotąd).
 */
function sameNameMark(db, s) {
  if (!s || !db || typeof db.col !== 'function') return null;
  const active = (x) => (x.status || 'active') === (s.status || 'active');
  const twin = db.col('students').some((x) => x.id !== s.id && x.classId === s.classId && x.lastName === s.lastName && x.firstName === s.firstName && active(x));
  if (!twin) return null;
  return s.rollNo != null ? `nr ${s.rollNo}` : (s.birthDate ? `ur. ${String(s.birthDate).slice(0, 4)}` : null);
}
function studentLabel(s, db) {
  if (!s) return '';
  const mark = sameNameMark(db, s);
  if (mark) return `${s.lastName} ${s.firstName} (${mark})`;
  return `${s.rollNo != null ? s.rollNo + '. ' : ''}${s.lastName} ${s.firstName}`;
}
/** CSV = UTF-8 with BOM and `;`. Cells that a spreadsheet would read as a formula (=, +, -, @,
    tab, CR) get a leading apostrophe so a grade comment or a feedback text can never become
    `=cmd|…` or `=HYPERLINK(…)` when the export is opened in Excel/LibreOffice (OWASP: CSV
    injection). Plain numbers such as -12,5 are left alone — they are data, not formulas. */
function csvCell(v) {
  let t = v == null ? '' : String(v);
  if (/^[=+\-@\t\r]/.test(t) && !/^[-+]?\d+(?:[.,]\d+)?$/.test(t)) t = "'" + t;
  return /[;"\n\r]/.test(t) ? '"' + t.replace(/"/g, '""') + '"' : t;
}
function csv(rows, header) { return '﻿' + [header, ...rows].map((r) => r.map(csvCell).join(';')).join('\r\n'); }
function xmlEsc(s) { return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }
/** Print-ready HTML document (browser prints to PDF). */
function printHtml(title, bodyHtml, opts) { const o = opts || {}; return `<!doctype html><html lang="pl"><head><meta charset="utf-8"><title>${xmlEsc(title)}</title><style>@page{size:A4;margin:${o.margin || '20mm'}}body{font-family:"IBM Plex Sans",Arial,sans-serif;font-size:11pt;color:#000;background:#fff;margin:0}h1{font-size:16pt;margin:0 0 8pt}h2{font-size:13pt;margin:14pt 0 6pt}table{border-collapse:collapse;width:100%}th,td{border:1px solid #000;padding:3pt 6pt;text-align:left;font-size:10pt}th{background:#f0f0f0}caption{caption-side:top;text-align:left;font-weight:600;font-size:10pt;padding:0 0 3pt}.head{display:flex;justify-content:space-between;border-bottom:1px solid #000;padding-bottom:6pt;margin-bottom:12pt}.foot{border-top:1px solid #000;margin-top:16pt;padding-top:6pt;font-size:8pt;color:#333;display:flex;justify-content:space-between;gap:12pt}.sign{display:flex;justify-content:space-between;margin-top:36pt}.sign span{flex:1;border-top:1px solid #000;text-align:center;font-size:9pt;padding-top:4pt;margin:0 12pt}.note{font-size:9pt;color:#333}${o.css || ''}</style></head><body>${o.noHeader ? '' : `<div class="head"><div><b>${xmlEsc(o.school || '')}</b><br><span class="note">${xmlEsc(o.schoolMeta || '')}</span></div><div style="text-align:right">${xmlEsc(o.docNo || '')}<br>${xmlEsc(o.date || '')}</div></div>`}${bodyHtml}${o.noFooter ? '' : `<div class="foot"><span>${xmlEsc(o.gdpr || 'Dokument zawiera dane osobowe przetwarzane na podstawie art. 6 ust. 1 lit. c RODO. Po wykorzystaniu należy go zniszczyć lub zabezpieczyć zgodnie z polityką ochrony danych szkoły.')}</span><span>${xmlEsc(o.page || 'Strona 1 z 1')}<br>Wydruk: ${xmlEsc(o.printed || '')}</span></div>`}<script src="/app/autoprint.js"></script></body></html>`; }
module.exports = { today, tz, schoolNow, isBeforeCutoff, inQuietHours, semesterOf, semester, classOf, student, teacherTeaches, isHomeroomOf, visibleStudentIds, assertCanSeeStudent, assertMayReadPupilRecord, guardianScope, guardianStanding, guardianEntry, clampGuardianScope, guardianKindAllowed, GUARDIAN_INFO_KINDS, notificationVisible, guardianTransition, readGuardianBasis, GUARDIAN_BASIS_KINDS, GUARDIAN_COURT_STATUSES, guardianStatus, guardianStatusScope, GUARDIAN_STATUSES, GUARDIAN_STATUS_SCOPE, ADULT_ACCESS_MODES, adultAccessMode, adultFrom, adultAccessState, setAdultParentAccess, teachesPupil, sameNameMark, attendanceStats, mapAttendanceCode, semesterList, ATTENDANCE_STATUSES, RECORD_KINDS, LEARNING_KINDS, SUPPORT_ROLES, studentGrades, subjectsOfClass, attendanceFor, attendanceBySubject, isSemesterLocked, lessonsOn, lessonTime, notify, notifyParentsOf, endOfQuiet, onNotify, sendMessage, userLabel, studentLabel, csv, csvCell, xmlEsc, printHtml, parseGrade };
