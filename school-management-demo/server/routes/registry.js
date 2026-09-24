'use strict';
/* 3.5 — Sekretariat: księga uczniów (3.5.1), legitymacja cyfrowa mObywatel (3.5.2), pakiet SIO (3.5.3),
   przeniesienie do innej szkoły z odpisem arkusza ocen (3.5.8), duplikaty świadectw (3.5.10),
   rejestr obwodowy przygotowania przedszkolnego (3.5.14). */
const D = require('../lib/domain');
const { httpError } = require('../lib/router');
const U = require('../lib/util');
const ID = require('../lib/identity');          // R7 — PESEL albo dokument tożsamości (§ 4 rozporządzenia)
const XC = require('../lib/xmlcheck');          // R7 — poprawność składniowa pakietu SIO (docs/SIO.md)
const CSV = require('../lib/csv');
const crypto = require('node:crypto');
const LA = require('../lib/log-access');        // rejestracja rodzajów dzienników do komentarzy
const LC = require('./log-comments');           // liczniki komentarzy przy wierszach list

const ROLES = ['registrar', 'admin', 'principal'];
/* Kto poprawia dane ucznia w księdze: sekretariat i administracja zawsze, wychowawca — swojego oddziału. */
const ROLES_HR = ['registrar', 'admin', 'principal', 'homeroom'];
const SCOPES = ['full', 'info', 'none'];
/* R3 — status władzy rodzicielskiej przy wpisie opiekuna i rodzaj podstawy, z której wynika. */
const STATUSES = D.GUARDIAN_STATUSES;                 // full | limited | deprived | court-restricted
const BASIS_KINDS = D.GUARDIAN_BASIS_KINDS;           // court-order | declaration (jedna lista, w domain.js)
const CODE_ALPHABET = 'ACDEFGHJKLMNPQRTUVWXY34679'; // bez znaków mylących (0/O, 1/I, S/5, B/8, Z/2)

/** Jednorazowy kod w grupach po `size` znaków, np. "9K4T-2M8R-QX57". */
function makeCode(groups, size, prefix) {
  const bytes = crypto.randomBytes(groups * size); const out = [];
  for (let g = 0; g < groups; g++) { let s = ''; for (let i = 0; i < size; i++) s += CODE_ALPHABET[bytes[g * size + i] % CODE_ALPHABET.length]; out.push(s); }
  return (prefix ? prefix + '-' : '') + out.join('-');
}
const slug = (s) => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/ł/g, 'l').replace(/[^a-z0-9]/g, '');
/* OPS3-10 — jedna podłoga numerów księgi dla całej szkoły. Sekretariat i kreator liczyły to
   osobno: import z kreatora startował od `config.registerNoStart`, a ta trasa zawsze od 1200, więc
   pierwszy uczeń przyjęty po kreatorze robił w księdze stuczterdziestonumerową dziurę. Funkcja
   mieszka w `routes/setup.js` (właściciel kreatora); `setup.js` nie wymaga `registry.js`, więc
   nie ma tu cyklu. */
const { nextRegisterNo } = require('./setup');
const yearEnd = (db) => +String(db.data.config.year || '2026/2027').split('/')[1];

/** Pełna walidacja numeru PESEL wraz z porównaniem z datą urodzenia z formularza. */
function checkPesel(pesel, birthDate) {
  const r = U.validatePesel(String(pesel || '').trim());
  if (!r.ok) return r;
  if (birthDate && r.birthDate !== birthDate) {
    return { ok: false, position: 1, expectedBirthDate: r.birthDate,
      error: `Z pozycji 1–6 numeru PESEL wynika data urodzenia ${U.fmtDate(r.birthDate)}, a w formularzu wpisano ${U.fmtDate(birthDate)}. Popraw jedno z pól.` };
  }
  return r;
}

/* ------------------------------------------------ GAP-3 / REG-17: zakres dostępu per dziecko ------- */
/** `students[].guardians[]` to lista `{userId, accessScope, since, legalBasis}` — kształt, którego
    `D.guardianScope` szuka jako pierwszego. `users[].accessScope` zostaje wyłącznie domyślną wartością
    konta, bo zakres jest parą (opiekun, dziecko), a nie właściwością konta. */
function scopeList(s) { if (!Array.isArray(s.guardians)) s.guardians = []; return s.guardians; }
const scopeEntry = (s, userId) => (Array.isArray(s.guardians) ? s.guardians : []).find((x) => x && (x.userId || x.id) === userId) || null;
function setScope(db, s, userId, patch) {
  const list = scopeList(s);
  let e = list.find((x) => x && (x.userId || x.id) === userId);
  if (!e) { e = { userId, accessScope: 'full', status: 'full', basis: null, scopeSource: 'derived', since: D.today(db), legalBasis: null, note: null }; list.push(e); }
  return Object.assign(e, patch);
}
/** Jak widzi to dziecko ten opiekun: wpis przy uczniu, a gdy go nie ma — domyślny zakres konta. */
const effectiveScope = (s, u) => { const e = scopeEntry(s, u.id); const v = (e && e.accessScope) || (e ? D.guardianStatusScope(D.guardianStatus(e)) : null) || u.accessScope || 'full'; return SCOPES.includes(v) ? v : 'full'; };

/* ---------------------------------------------- R3: status władzy rodzicielskiej (docs/GUARDIANS.md)
   Reguła przejścia mieszka w `server/lib/domain.js` (`D.guardianTransition`), bo obowiązuje na każdej
   drodze, nie tylko na tej trasie: nałożenie `deprived`/`court-restricted` wymaga postanowienia sądu,
   **zdjęcie ich wymaga nowego dokumentu**, podstawa nie przechodzi przez zmianę statusu, a ręcznie
   nadpisany zakres przeżywa zmianę statusu albo żądanie zostaje odrzucone (S3-10, D3-06, D3-07).
   Tu zostaje tylko wywołanie i zapis. */
const readBasis = (raw, fallbackReference) => D.readGuardianBasis(raw, fallbackReference);
/** Przejście wpisu opiekuna; `D.guardianTransition` rzuca 400 ze stabilnym `code`. */
const transition = (entry, next, body) => D.guardianTransition(entry, next, body);
/** Jedno zdanie po polsku o tym, co status znaczy — pokazuje je i sekretariat, i wiersz audytu. */
const STATUS_LABEL = {
  full: 'władza rodzicielska pełna',
  limited: 'władza rodzicielska ograniczona (prawo do informacji zostaje)',
  deprived: 'rodzic pozbawiony władzy rodzicielskiej',
  'court-restricted': 'dostęp do informacji ograniczony orzeczeniem sądu'
};

/** Jednorazowa normalizacja przy starcie: pole `guardians` na uczniu było wizytówką kontaktową
    sekretariatu (obiekt `{mother, father, phone, email, address}`) — dokładnie tam, gdzie
    `D.guardianScope` szuka listy zakresów. Wizytówka przenosi się raz do `guardianContact`, żeby
    lista mogła zamieszkać pod `guardians`. Świadomie NIE w `server/lib/migrate.js`: tamten plik
    jest importem starego pliku `school.json` i należy do kogoś innego (patrz raport). */
function normaliseGuardians(db) {
  let moved = 0;
  for (const s of db.col('students')) {
    const g = s.guardians;
    if (g && !Array.isArray(g) && typeof g === 'object') { if (!s.guardianContact) s.guardianContact = g; s.guardians = []; moved++; }
  }
  if (moved) db.save();
  return moved;
}

/* ------------------------------------------------------ GAP-6: jedna data przyjęcia ucznia -------- */
/** `enrolledAt` jest jedynym polem daty przyjęcia; `joinedAt` zostaje aliasem, który czyta
    `enrolledOn()` w routes/attendance.js. Sekretariat wpisujący ucznia dziś stempluje dzień dzisiejszy,
    ale może podać datę z decyzji o przyjęciu. */
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const admittedOn = (db, raw) => (ISO_DATE.test(String(raw || '')) ? String(raw) : D.today(db));
/* OPS3-16 — kod rejestracyjny dla opiekuna ważny 30 dni **od pierwszego dnia ucznia**, a nie od dnia
   wpisu do księgi. Uczennica przyjęta w lutym bywa wpisywana w styczniu; kod z zegarem liczonym od
   dnia wpisu potrafił umrzeć, zanim dziecko pierwszy raz przyszło do szkoły. Liczymy od późniejszej
   z dwóch dat: dzisiaj albo data przyjęcia. */
const codeExpiry = (db, days, enrolledAt) => {
  const today = D.today(db);
  const from = ISO_DATE.test(String(enrolledAt || '')) && String(enrolledAt) > today ? String(enrolledAt) : today;
  return U.addDays(from, days);
};
/* --------------------------------------------------- historia tożsamości jako wpisy rejestru ----
   „Historia tożsamości” nie jest osobną kolekcją, tylko listą przy uczniu (§ 4), a komentarz musi
   mieć do czego przylgnąć. Identyfikator liczymy z treści wpisu i z ucznia: ten sam wpis zawsze daje
   ten sam napis, a dopisanie kolejnej zmiany nie przenumerowuje poprzednich. (Lista jest przycinana
   do 50 wpisów — po przekroczeniu tej granicy najstarsze znikają razem ze swoimi komentarzami.) */
function identityEntryId(studentId, entry, i) {
  return 'ih_' + crypto.createHash('sha256').update(`${studentId}|${i}|${JSON.stringify(entry)}`).digest('hex').slice(0, 12);
}
const identityHistoryOf = (s) => (Array.isArray(s.identityHistory) ? s.identityHistory : [])
  .map((e, i) => Object.assign({ id: identityEntryId(s.id, e, i), studentId: s.id }, e));
/** Wpis historii tożsamości widoczny dla TEGO użytkownika — ta sama bramka co GET …/flags. */
function findIdentityEntry(db, user, id) {
  for (const s of db.col('students')) {
    const hit = identityHistoryOf(s).find((e) => e.id === id);
    if (!hit) continue;
    if (user.role === 'teacher' && !D.isHomeroomOf(db, user, s.classId)) return null;
    return hit;
  }
  return null;
}
/** Wszystkie identyfikatory wpisów historii tożsamości w szkole — do liczników przy liście. */
const allIdentityEntryIds = (db) => db.col('students').flatMap((s) => identityHistoryOf(s).map((e) => e.id));

/** Flagi ucznia w jednym kształcie — ten sam obiekt czyta ekran sekretariatu i wychowawcy. */
const flagsView = (s) => ({
  studentId: s.id, socialWelfare: !!s.socialWelfare, adult: !!s.adult, adultSelfExcuse: !!s.adultSelfExcuse,
  parentAccessBlocked: !!s.parentAccessBlocked, nationality: s.nationality || null,
  identityKind: s.identityKind || (s.pesel ? 'pesel' : 'passport'), foreigner: !!s.foreigner,
  /* R7: uczeń bez numeru PESEL legitymuje się dokumentem — rodzaj, numer i kraj w jednym polu.
     `identityLabel` jest jedynym podpisem tożsamości, jakiego używają wydruki i pakiet SIO (D3-57 d). */
  identityDocument: ID.documentOf(s), identityLabel: ID.identityLabel(s),
  pesel: s.pesel || null,
  /* Poprzednie numery i dokumenty zostają w księdze — § 4 rozporządzenia o dokumentacji. */
  identityHistory: identityHistoryOf(s),
  previousNames: Array.isArray(s.previousNames) ? s.previousNames : [],
  enrolledAt: s.enrolledAt || s.joinedAt || null
});
/** Wpis do historii tożsamości ucznia: co było, co jest, kto i na jakiej podstawie (§ 4). */
function pushIdentityHistory(s, entry) {
  const list = Array.isArray(s.identityHistory) ? s.identityHistory : [];
  s.identityHistory = list.concat([entry]).slice(-50);
  return entry;
}
/** R3 — reguła dostępu opiekunów do danych ucznia pełnoletniego, w jednym kształcie dla API i ekranu. */
function adultAccessView(db, s) {
  const a = D.adultAccessState(db, s);
  const rule = a.mode === 'consent-required'
    ? 'Od 18. urodzin opiekunowie nie widzą danych ucznia, dopóki uczeń nie wyrazi zgody (ustawienie szkoły: „zgoda wymagana”).'
    : 'Opiekunowie widzą dane ucznia pełnoletniego do chwili, w której uczeń wniesie sprzeciw (ustawienie szkoły: „do sprzeciwu”).';
  const state = a.guardianAccess === 'blocked' ? 'W dokumentacji jest zapisany sprzeciw ucznia — konta opiekunów nie mają wglądu.'
    : a.guardianAccess === 'pending-consent' ? 'Nie ma jeszcze zapisanej zgody ucznia — konta opiekunów nie mają wglądu.'
      : a.adult ? 'Opiekunowie mają wgląd zgodny z zapisanym zakresem.' : 'Uczeń nie jest jeszcze pełnoletni — obowiązuje zwykły zakres opiekuna.';
  return Object.assign({ studentId: s.id, rule, state, statusText: rule + ' ' + state }, a);
}

const studentLine = (db, s) => `${s.registerNo}. ${s.lastName} ${s.firstName}` + (s.classId ? ` · ${s.classId}` : '');
const uniqueLogin = (db, base) => { let l = base || 'user', i = 1; while (db.one('users', (u) => u.login === l)) l = `${base}${++i}`; return l; };
const loginSlug = (s) => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/ł/g, 'l').replace(/[^a-z0-9]+/g, '.').replace(/^\.|\.$/g, '');

/** Zamknięcie wpisu w księdze musi odciąć ucznia od bieżącego dziennika — inaczej do końca roku stoi na
    listach obecności, ma czynny login, a opiekun czyta oceny cudzej klasy. Dane historyczne zostają. */
function closeEnrolment(db, s, opts) {
  const o = opts || {}; const out = { groups: [], parents: [], codes: 0, sessions: 0, studentUserId: null };
  const cls = db.get('classes', s.classId);
  if (cls) cls.studentIds = (cls.studentIds || []).filter((x) => x !== s.id);
  for (const g of db.col('groups')) if ((g.studentIds || []).includes(s.id)) { g.studentIds = g.studentIds.filter((x) => x !== s.id); out.groups.push(g.id); }
  const su = db.one('users', (u) => u.role === 'student' && u.studentId === s.id);
  if (su) { su.blocked = true; su.blockedAt = U.now(); su.blockedReason = o.reason || 'zamknięcie wpisu w księdze uczniów'; out.studentUserId = su.id;
    for (const ses of db.col('sessions')) if (ses.userId === su.id && !ses.revoked) { ses.revoked = true; ses.revokedReason = 'enrolment_closed'; ses.revokedAt = U.now(); out.sessions++; } }
  s.formerParentIds = [...new Set([...(s.formerParentIds || []), ...(s.parentIds || [])])];
  for (const pid of s.parentIds || []) {
    const p = db.get('users', pid); if (!p) continue;
    p.childrenIds = (p.childrenIds || []).filter((x) => x !== s.id);
    out.parents.push({ id: p.id, login: p.login, remainingChildren: p.childrenIds.length });
    if (!p.childrenIds.length) { p.blocked = true; p.blockedAt = U.now(); p.blockedReason = o.reason || 'brak dzieci w tej szkole'; for (const ses of db.col('sessions')) if (ses.userId === p.id && !ses.revoked) { ses.revoked = true; ses.revokedReason = 'enrolment_closed'; ses.revokedAt = U.now(); out.sessions++; } }
  }
  s.parentIds = [];
  if (Array.isArray(s.guardians)) s.guardians = [];              // zakresy per dziecko znikają razem z dostępem
  for (const rc of db.col('registrationCodes')) if (rc.studentId === s.id && !rc.usedAt && !rc.voidedAt) { rc.voidedAt = U.now(); rc.voidReason = o.reason || 'zamknięcie wpisu w księdze uczniów'; out.codes++; }
  for (const sid of db.col('studentIds')) if (sid.studentId === s.id && sid.status === 'issued') { sid.status = 'revoked'; sid.revokedAt = U.now(); }
  return out;
}

/** Dokument do druku odsyłamy inline (przeglądarka drukuje do PDF), nie jako załącznik.
    Piszemy nagłówki wprost, bo `{__raw:true}` bez `filename` ustawia Content-Disposition: undefined
    i przewraca odpowiedź w server/index.js (patch zgłoszony właścicielowi pliku). */
function sendHtml(ctx, html) {
  ctx.res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
  ctx.res.end(html);
}

/* ------------------------------------------------------------------ pakiet SIO (3.5.3) */
/** Zwraca {xml, counts, errors} — XML jest poprawny składniowo zawsze; `errors` blokują wysyłkę. */
function buildSio(db) {
  const cfg = db.data.config; const anon = !!cfg.anonymized; const X = D.xmlEsc;
  const errors = []; const classes = db.col('classes'); const students = db.col('students').filter((s) => s.status === 'active');
  const perClass = [];
  for (const c of classes) {
    const list = students.filter((s) => s.classId === c.id).sort((a, b) => (a.rollNo || 0) - (b.rollNo || 0));
    const homeroom = db.get('users', c.homeroomTeacherId) || db.get('users', c.actingHomeroomTeacherId);
    if (!homeroom) errors.push(`Oddział „${c.name}” nie ma przypisanego wychowawcy (kod SIO 3.2.1).`);
    perClass.push({ cls: c, list, homeroom });
  }
  const orphans = students.filter((s) => !classes.some((c) => c.id === s.classId));
  for (const s of orphans) errors.push(`Uczeń ${studentLine(db, s)} nie jest przypisany do istniejącego oddziału (kod SIO 3.1.2).`);
  for (const s of students) {
    const doc = ID.documentOf(s);
    if (!s.pesel && !doc) errors.push(`Uczeń nr księgi ${s.registerNo} nie ma numeru PESEL — wymagany rodzaj i numer dokumentu tożsamości (paszport, karta pobytu) oraz kod kraju wydania (kod SIO 2.1.4).`);
    if (s.pesel && !U.validatePesel(s.pesel).ok) errors.push(`Uczeń nr księgi ${s.registerNo} ma numer PESEL niezgodny z sumą kontrolną (kod SIO 2.1.1).`);
    if (!s.birthPlace) errors.push(`Puste pole „miejsceUrodzenia” dla ucznia z numerem księgi ${s.registerNo} (kod SIO 2.3.9).`);
    if (doc && !doc.country) errors.push(`Uczeń nr księgi ${s.registerNo} ma ${ID.TYPE_PL[doc.type]} bez kodu kraju wydania (kod SIO 2.1.5).`);
  }
  const counts = { classes: classes.length, students: students.length, perClass: perClass.map((p) => ({ classId: p.cls.id, count: p.list.length })) };
  const body = perClass.map((p) => {
    const uczniowie = p.list.map((s) => {
      const doc = ID.documentOf(s);
      /* Kopia anonimizowana nie niesie ani nazwiska, ani numeru PESEL — tylko numer księgi. */
      const attrs = [`numerKsiegi="${X(s.registerNo)}"`, `nazwisko="${anon ? '' : X(s.lastName || '')}"`, `imie="${anon ? '' : X(s.firstName || '')}"`];
      if (anon) attrs.push('pesel="" anonimizacja="tak"');
      else if (s.pesel) attrs.push(`pesel="${X(s.pesel)}"`);
      /* R7 — uczeń bez numeru PESEL: rodzaj dokumentu jedzie osobnym atrybutem, bo `paszport` nie
         opisuje karty pobytu. Pole `paszport` zostaje dla zgodności z dotychczasowym odbiorcą. */
      else if (doc) attrs.push(`rodzajDokumentu="${X(doc.type)}" numerDokumentu="${X(doc.number)}" paszport="${X(doc.number)}" krajWydania="${X(doc.country || '')}"`);
      else attrs.push('rodzajDokumentu="" numerDokumentu="" paszport="" krajWydania=""');
      attrs.push(`dataUrodzenia="${X(s.birthDate)}"`, `miejsceUrodzenia="${X(s.birthPlace || '')}"`, `plec="${X(s.sex || '')}"`,
        `dataPrzyjecia="${X(s.enrolledAt || s.joinedAt || '')}"`, `dataOdejscia="${X(s.departureDate || '')}"`);
      return `      <uczen ${attrs.join(' ')}/>`;
    }).join('\n');
    return `    <oddzial id="${X(p.cls.id)}" nazwa="${X(p.cls.name)}" poziom="${X(p.cls.level)}" liczbaUczniow="${p.list.length}" wychowawca="${X(D.userLabel(p.homeroom))}">\n` +
      `      <liczbaUczniow>${p.list.length}</liczbaUczniow>\n${uczniowie}${uczniowie ? '\n' : ''}    </oddzial>`;
  }).join('\n');
  const xml = `<?xml version="1.0" encoding="UTF-8"?>\n` +
    `<sio wersja="${X(cfg.sio ? cfg.sio.schemaVersion : '1.0')}" dataSprawozdania="${X(D.today(db))}" anonimizacja="${anon ? 'tak' : 'nie'}">\n` +
    `  <szkola rspo="${X(cfg.school.rspo)}" regon="${X(cfg.school.regon)}" nazwa="${X(cfg.school.name)}" rokSzkolny="${X(cfg.year)}"/>\n` +
    `  <podsumowanie liczbaOddzialow="${counts.classes}" liczbaUczniow="${counts.students}"/>\n` +
    `  <oddzialy>\n${body}${body ? '\n' : ''}  </oddzialy>\n</sio>\n`;
  return { xml, counts, errors };
}

/* ---------------------------------------- R7: kontrola własna pakietu SIO (docs/SIO.md) ----------
   Schematu XSD z CIE nie mamy — nie jest publicznie dostępny stąd, gdzie ten prototyp powstawał
   (wiersz 4 triage'u). Zamiast udawać walidację schematem robimy **kontrolę własną**: poprawność
   składniowa pliku, komplet pól wymaganych przy każdym uczniu, brak powtórzonych numerów PESEL
   i daty w ISO. Odpowiedź niesie `schema: 'not-validated-against-cie-xsd'`, żeby nikt nie wziął
   tego za zgodność ze schematem. */
const SIO_SCHEMA_MARK = 'not-validated-against-cie-xsd';
/** Pola, bez których odbiorca sprawozdania nie zidentyfikuje ucznia (docs/SIO.md §3). */
const SIO_REQUIRED = [
  ['lastName', 'nazwisko'], ['firstName', 'imie'], ['birthDate', 'dataUrodzenia'],
  ['birthPlace', 'miejsceUrodzenia'], ['classId', 'oddzial']
];
const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * selfCheck(db, xml) → `warnings[]` — każdy wpis ma `code`, `level` ('error' blokuje wysyłkę tak
 * samo jak dotychczasowe `errors`, 'warning' nie), zdanie po polsku i, jeśli dotyczy ucznia, jego id.
 */
function sioSelfCheck(db, xml) {
  const w = []; const anon = !!db.data.config.anonymized;
  const add = (code, level, message, extra) => w.push(Object.assign({ code, level, message }, extra || {}));

  const form = XC.wellFormed(xml);
  if (!form.ok) for (const e of form.errors) add('xml_not_well_formed', 'error', `Linia ${e.line}, kolumna ${e.column}: ${e.message}`, { detail: e.code });
  if (form.ok && form.root !== 'sio') add('xml_root_unexpected', 'warning', `Element główny pakietu to „${form.root}”, a odbiorca spodziewa się „sio”.`);

  const students = db.col('students').filter((s) => s.status === 'active');
  const byPesel = new Map();
  for (const s of students) {
    const who = `nr księgi ${s.registerNo}`;
    for (const [field, tag] of SIO_REQUIRED) {
      if (anon && (field === 'lastName' || field === 'firstName')) continue;     // kopia anonimizowana nie niesie nazwiska
      if (!String(s[field] || '').trim()) add('missing_field', 'error', `Uczeń ${who}: puste pole wymagane „${tag}”.`, { studentId: s.id, field: tag });
    }
    const doc = ID.documentOf(s);
    if (!s.pesel && !doc) add('no_identity', 'error', `Uczeń ${who}: brak numeru PESEL i dokumentu tożsamości (rodzaj + numer + kraj wydania).`, { studentId: s.id });
    if (doc && !doc.country) add('document_no_country', 'error', `Uczeń ${who}: ${ID.TYPE_PL[doc.type]} bez kodu kraju wydania.`, { studentId: s.id });
    if (s.pesel) {
      const v = U.validatePesel(s.pesel);
      if (!v.ok) add('pesel_checksum', 'error', `Uczeń ${who}: numer PESEL niezgodny z sumą kontrolną.`, { studentId: s.id });
      const prev = byPesel.get(s.pesel);
      if (prev) add('duplicate_pesel', 'error', `Numer PESEL powtarza się w sprawozdaniu: uczeń ${who} i uczeń nr księgi ${prev.registerNo}.`, { studentId: s.id, otherStudentId: prev.id });
      else byPesel.set(s.pesel, s);
    }
    for (const [field, tag] of [['birthDate', 'dataUrodzenia'], ['enrolledAt', 'dataPrzyjecia'], ['departureDate', 'dataOdejscia']]) {
      const v = s[field] || (field === 'enrolledAt' ? s.joinedAt : null);
      if (v && !ISO_DATE_RE.test(String(v))) add('bad_date', 'error', `Uczeń ${who}: data „${tag}” („${v}”) nie jest zapisana w formacie RRRR-MM-DD.`, { studentId: s.id, field: tag });
    }
    /* Data przyjęcia jest w księdze uczniów obowiązkowa, ale wpisy sprzed GAP-6 jej nie mają:
       brak jest ostrzeżeniem (sekretariat uzupełnia), a nie powodem, żeby wstrzymać sprawozdanie. */
    if (!s.enrolledAt && !s.joinedAt) add('missing_enrolment', 'warning', `Uczeń ${who}: brak daty przyjęcia do szkoły — uzupełnij ją w księdze uczniów.`, { studentId: s.id, field: 'dataPrzyjecia' });
  }
  const closed = db.col('students').filter((s) => s.status !== 'active' && s.departureDate && !ISO_DATE_RE.test(String(s.departureDate)));
  for (const s of closed) add('bad_date', 'error', `Uczeń nr księgi ${s.registerNo}: data odejścia „${s.departureDate}” nie jest zapisana w formacie RRRR-MM-DD.`, { studentId: s.id, field: 'dataOdejscia' });
  return w;
}

/* --------------------------------------------------------- odpis arkusza ocen (3.5.8) */
function transcriptHtml(db, s) {
  const cfg = db.data.config; const cls = db.get('classes', s.classId);
  const subjects = db.col('subjects').filter((su) => db.col('grades').some((g) => g.studentId === s.id && g.subjectId === su.id && !g.deleted) || D.subjectsOfClass(db, s.classId).includes(su.id));
  const rows = subjects.map((su) => {
    const s1 = D.studentGrades(db, s.id, su.id, 1), s2 = D.studentGrades(db, s.id, su.id, 2);
    return `<tr><th scope="row">${D.xmlEsc(su.name)}</th><td>${s1.final ? D.xmlEsc(s1.final.value) : '—'}</td><td>${U.fmtAvg(s1.average)}</td><td>${s2.final ? D.xmlEsc(s2.final.value) : '—'}</td><td>${U.fmtAvg(s2.average)}</td></tr>`;
  }).join('');
  const att = D.attendanceFor(db, s.id);
  const ident = D.xmlEsc(ID.identityLabel(s));     // R7: PESEL albo „paszport FL123456 (UA)” — nigdy puste pole
  const body = `<h1>Odpis arkusza ocen</h1>
<p><b>${D.xmlEsc(s.lastName)} ${D.xmlEsc(s.firstName)}</b> · numer księgi uczniów <b>${D.xmlEsc(s.registerNo)}</b> · oddział ${D.xmlEsc(cls ? cls.name : '—')}</p>
<p>${ident} · ur. ${U.fmtDate(s.birthDate)} ${D.xmlEsc(s.birthPlaceLocative || ('w ' + (s.birthPlace || '')))}</p>
<p>Wpis w księdze uczniów zamknięty ${U.fmtDate(s.departureDate || D.today(db))} z powodu przeniesienia do: <b>${D.xmlEsc(s.transferSchool || '—')}</b>.</p>
<h2>Oceny</h2>
<table><caption>Oceny w roku szkolnym</caption><thead><tr><th scope="col">Zajęcia edukacyjne</th><th scope="col">Semestr 1</th><th scope="col">Średnia sem. 1</th><th scope="col">Semestr 2</th><th scope="col">Średnia sem. 2</th></tr></thead><tbody>${rows || '<tr><td colspan="5">Brak ocen w bieżącym roku szkolnym.</td></tr>'}</tbody></table>
<h2>Frekwencja</h2>
<p>Zajęcia zarejestrowane: ${att.total} · obecności: ${att.present} · nieobecności nieusprawiedliwione: ${att.nb} · usprawiedliwione: ${att.excused} · frekwencja ${att.percent == null ? '—' : U.fmtAvg(att.percent) + ' %'}.</p>
<p class="note">Odpis wydaje się za potwierdzeniem odbioru. Dokument jest zgodny z wpisami w dzienniku elektronicznym na dzień wystawienia.</p>
<div class="sign"><span>Sekretariat</span><span>Dyrektor szkoły</span></div>`;
  return D.printHtml('Odpis arkusza ocen — ' + s.lastName + ' ' + s.firstName, body, {
    school: cfg.school.name, schoolMeta: cfg.school.address + ' · RSPO ' + cfg.school.rspo,
    docNo: 'Odpis nr ' + s.registerNo + '/' + String(cfg.year).replace('/', '-'), date: U.fmtDate(D.today(db)), printed: U.fmtDate(D.today(db))
  });
}

/* ------------------------------------------------------------------------------ routes */
function register(r, app) {
  normaliseGuardians(app.db);
  /* Komentarze do wpisów obu rejestrów sekretariatu. Bramka jest dokładnie bramką listy:
     • historia tożsamości — jak GET /api/registry/students/:id/flags: sekretariat, dyrekcja
       i administracja w całej szkole, wychowawca wyłącznie w swoim oddziale;
     • rejestr obwodowy — jak GET /api/registry/district: sekretariat, dyrekcja, administracja. */
  LA.register('identity-history', {
    label: 'Historia tożsamości ucznia', roles: ROLES_HR,
    find: (db, user, id) => findIdentityEntry(db, user, id)
  });
  LA.register('district-register', {
    label: 'Rejestr obwodowy', roles: ROLES,
    find: (db, user, id) => db.get('districtChildren', id)
  });
  /* R3 — uczeń i opiekun czytają regułę dostępu przy uczniu pełnoletnim w tym samym miejscu, w którym
     powłoka i tak pyta o sesję: nie trzeba dokładać ekranu, żeby wiedzieli, co obowiązuje i od kiedy.
     Wychowawca czyta to samo przez `/api/registry/students/:id/flags` i `.../adult-access`. */
  app.sessionExtras.push((ctx) => {
    const db = ctx.db; const u = ctx.user;
    if (u.role === 'student') { const s = db.get('students', u.studentId); return s ? { adultAccess: adultAccessView(db, s) } : {}; }
    if (u.role === 'parent') {
      const kids = (u.childrenIds || []).map((sid) => db.get('students', sid)).filter((s) => s && D.adultAccessState(db, s).adult)
        .map((s) => Object.assign({ name: `${s.firstName} ${s.lastName}` }, adultAccessView(db, s)));
      return kids.length ? { adultAccess: kids } : {};
    }
    return {};
  });
  /* --- 3.5.1 księga uczniów ------------------------------------------------------------ */
  r.get('/api/registry/students', (ctx) => {
    const db = ctx.db;
    const rows = db.col('students').map((s) => ({
      id: s.id, registerNo: s.registerNo, firstName: s.firstName, lastName: s.lastName, classId: s.classId,
      pesel: s.pesel || null, passport: s.passport || null, passportCountry: s.passportCountry || null,
      identityDocument: ID.documentOf(s), identityLabel: ID.identityLabel(s),
      birthDate: s.birthDate, birthPlace: s.birthPlace, status: s.status || 'active',
      departureDate: s.departureDate || null, transferSchool: s.transferSchool || null,
      guardianContact: s.guardianContact || null, guardianScopes: Array.isArray(s.guardians) ? s.guardians : [],
      /* § 4 — księga uczniów niesie także nazwisko poprzednie (D3-48). */
      previousNames: Array.isArray(s.previousNames) ? s.previousNames : [], nameChangedAt: s.nameChangedAt || null,
      socialWelfare: !!s.socialWelfare, adult: !!s.adult, adultSelfExcuse: !!s.adultSelfExcuse,
      parentAccessBlocked: !!s.parentAccessBlocked, nationality: s.nationality || null,
      identityKind: s.identityKind || (s.pesel ? 'pesel' : 'passport'), enrolledAt: s.enrolledAt || s.joinedAt || null,
      /* § 4 — historia tożsamości jedzie razem z wierszem księgi: to ona jest komentowanym wpisem. */
      identityHistory: identityHistoryOf(s),
      adultAccess: adultAccessView(db, s)
    })).sort((a, b) => (a.registerNo || 0) - (b.registerNo || 0));
    return { students: rows, classes: db.col('classes').map((c) => ({ id: c.id, name: c.name, level: c.level })), nextRegisterNo: nextRegisterNo(db), year: db.data.config.year,
      identityComments: LC.countsFor(db, ctx.user, 'identity-history', rows.flatMap((s) => s.identityHistory.map((e) => e.id))) };
  }, { roles: ROLES });

  /** Walidacja numeru PESEL na żywo (to samo, co przy zapisie): {ok, error, position, birthDate, sex}. */
  r.post('/api/registry/pesel/check', (ctx) => {
    const b = ctx.body || {}; const res = checkPesel(b.pesel, b.birthDate);
    return Object.assign({ pesel: String(b.pesel || '') }, res);
  }, { roles: ROLES });

  r.post('/api/registry/students', (ctx) => {
    const db = ctx.db; const b = ctx.body || {};
    const req = ['firstName', 'lastName', 'birthPlace', 'classId'];
    for (const k of req) if (!String(b[k] || '').trim()) throw httpError(400, 'Uzupełnij pole: ' + k + '.', { field: k });
    const cls = db.get('classes', b.classId); if (!cls) throw httpError(400, 'Nie ma takiego oddziału: ' + b.classId + '.', { field: 'classId' });
    const kind = b.identityKind === 'passport' ? 'passport' : 'pesel';
    let birthDate = b.birthDate || null, sex = b.sex || null, pesel = null, passport = null, passportCountry = null, document = null;
    if (kind === 'pesel') {
      const res = checkPesel(b.pesel, b.birthDate);
      if (!res.ok) throw httpError(400, res.error, { code: 'pesel_invalid', field: 'pesel', position: res.position || null, expected: res.expected, expectedBirthDate: res.expectedBirthDate });
      if (db.one('students', (s) => s.pesel === String(b.pesel).trim())) throw httpError(400, 'Uczeń z tym numerem PESEL jest już wpisany do księgi.', { field: 'pesel' });
      pesel = String(b.pesel).trim(); birthDate = res.birthDate; sex = res.sex;
    } else {
      /* R7 — uczeń bez numeru PESEL: § 4 rozporządzenia o dokumentacji chce **rodzaju i numeru**
         dokumentu, nie samego paszportu. Karta pobytu jest w naborze równie częsta jak paszport. */
      const r = ID.readDocument(b);
      if (!r.ok) throw httpError(400, r.error, { code: r.code, field: r.field, allowed: r.allowed });
      document = r.doc; passport = r.doc.number; passportCountry = r.doc.country;
      if (!/^\d{4}-\d{2}-\d{2}$/.test(String(birthDate || ''))) throw httpError(400, 'Podaj datę urodzenia w formacie RRRR-MM-DD.', { field: 'birthDate' });
    }
    let base = 'st_' + slug(b.lastName) + '_' + slug(b.firstName), sid = base, n = 1;
    while (db.get('students', sid)) sid = base + '_' + (++n);
    const rollNo = db.col('students').filter((s) => s.classId === cls.id).reduce((m, s) => Math.max(m, s.rollNo || 0), 0) + 1;
    const registerNo = nextRegisterNo(db);
    const student = {
      id: sid, rollNo, firstName: String(b.firstName).trim(), lastName: String(b.lastName).trim(), sex: sex || 'K', classId: cls.id,
      pesel, passport, passportCountry, identityDocument: document, identityKind: kind, foreigner: kind === 'passport',
      birthDate, birthPlace: String(b.birthPlace).trim(), birthPlaceLocative: b.birthPlaceLocative || ('w ' + String(b.birthPlace).trim()),
      status: 'active', registerNo, enrolledAt: admittedOn(db, b.enrolledAt), parentIds: [], adult: false, adultSelfExcuse: false, parentAccessBlocked: false,
      socialWelfare: false, nationality: String(b.nationality || '').trim() || null, achievements: [], declension: { firstNameLocative: null, lastNameLocative: null },
      address: String(b.address || '').trim(),
      /* `guardians` to lista zakresów per dziecko (GAP-3); wizytówka kontaktowa sekretariatu ma własne pole. */
      guardians: [],
      guardianContact: { mother: String(b.mother || '').trim(), father: String(b.father || '').trim(), phone: String(b.phone || '').trim(), email: String(b.email || '').trim(), address: String(b.address || '').trim() }
    };
    if (!student.guardianContact.mother && !student.guardianContact.father) throw httpError(400, 'Podaj dane matki lub innego opiekuna prawnego.', { field: 'mother' });
    db.col('students').push(student); cls.studentIds.push(sid);
    /* Wpis do księgi bez konta i bez opiekuna jest martwy: uczeń nie ma jak się zalogować, a rodzic nie ma jak
       założyć konta. Konto ucznia powstaje bez hasła (aktywacja resetem), opiekun dostaje jednorazowy kod. */
    const su = { id: 'u_' + sid, login: uniqueLogin(db, loginSlug(student.firstName + '.' + student.lastName)), role: 'student', firstName: student.firstName, lastName: student.lastName, name: `${student.firstName} ${student.lastName}`, studentId: sid, classId: cls.id, passwordHash: null, mustActivate: true, mustChangePassword: false, totpEnabled: false, blocked: false, createdAt: U.now() };
    db.col('users').push(su);
    let guardianCode = null;
    if (b.guardianCode !== false) {
      const expiresAt = codeExpiry(db, +b.codeValidDays > 0 ? +b.codeValidDays : 30, student.enrolledAt);
      guardianCode = { id: 'rc_' + U.id().slice(0, 10), code: makeCode(2, 4, String(cls.name).toUpperCase()), studentId: sid, classId: cls.id, byUserId: ctx.user.id, expiresAt, usedAt: null, usedByUserId: null };
      db.col('registrationCodes').push(guardianCode);
    }
    db.save();
    ctx.audit({ action: 'registry_student_created', entity: 'student', entityId: sid, after: { registerNo, classId: cls.id, identityKind: kind, identityDocument: document, studentUserId: su.id, guardianCodeId: guardianCode && guardianCode.id }, reason: b.reason || 'wpis do księgi uczniów' });
    return { ok: true, student, registerNo, studentLogin: su.login, guardianCode: guardianCode ? { code: guardianCode.code, expiresAt: guardianCode.expiresAt } : null,
      message: `Wpisano do księgi uczniów pod numerem ${registerNo}. Login ucznia: ${su.login} (hasło nadaje administrator).` + (guardianCode ? ` Kod rejestracyjny dla opiekuna: ${guardianCode.code}, ważny do ${U.fmtDate(guardianCode.expiresAt)}.` : '') +
        ' Pamiętaj o przypisaniu ucznia do grup językowych i o nadaniu numeru w dzienniku.' };
  }, { roles: ROLES });

  /* --- opiekunowie ucznia: przypięcie, odpięcie, nowy kod ------------------------------- */
  r.get('/api/registry/students/:id/guardians', (ctx) => {
    const db = ctx.db; const s = db.get('students', ctx.params.id); if (!s) throw httpError(404, 'Nie ma takiego ucznia w księdze.');
    const map = (id, former) => {
      const u = db.get('users', id); if (!u) return null;
      const e = scopeEntry(s, u.id);
      return { userId: u.id, login: u.login, name: D.userLabel(u), email: u.email || null, phone: u.phone || null, activated: !!u.passwordHash, blocked: !!u.blocked,
        /* zakres, który naprawdę obowiązuje przy TYM dziecku — wpis przy uczniu bije domyślny zakres konta */
        accessScope: effectiveScope(s, u), perChild: !!e, accountScope: u.accessScope || 'full',
        /* R3: status władzy rodzicielskiej, podstawa i zakres, który z samego statusu by wynikał */
        guardianStatus: D.guardianStatus(e), statusLabel: STATUS_LABEL[D.guardianStatus(e)],
        derivedScope: D.guardianStatusScope(D.guardianStatus(e)), scopeSource: (e && e.scopeSource) || 'derived',
        basis: (e && e.basis) || null,
        legalBasis: (e && e.legalBasis) || null, since: (e && e.since) || null, note: (e && e.note) || null,
        accessScopeReason: u.accessScopeReason || null, custodyNote: u.custodyNote || null, former: !!former };
    };
    return { studentId: s.id, student: studentLine(db, s), status: s.status || 'active',
      guardians: (s.parentIds || []).map((id) => map(id)).filter(Boolean),
      former: (s.formerParentIds || []).filter((id) => !(s.parentIds || []).includes(id)).map((id) => map(id, true)).filter(Boolean),
      codes: db.col('registrationCodes').filter((c) => c.studentId === s.id).map((c) => ({ id: c.id, code: c.usedAt || c.voidedAt ? null : c.code, expiresAt: c.expiresAt, usedAt: c.usedAt, voidedAt: c.voidedAt || null })),
      scopes: SCOPES, statuses: STATUSES, statusScopes: D.GUARDIAN_STATUS_SCOPE, basisKinds: BASIS_KINDS,
      adultAccess: adultAccessView(db, s), declaredGuardians: s.guardianContact || null };
  }, { roles: ROLES });

  r.post('/api/registry/students/:id/guardians', (ctx) => {
    const db = ctx.db; const b = ctx.body || {}; const s = db.get('students', ctx.params.id);
    if (!s) throw httpError(404, 'Nie ma takiego ucznia w księdze.');
    if (s.status !== 'active') throw httpError(400, 'Wpis tego ucznia w księdze jest zamknięty — opiekunów przypisuje się tylko uczniom szkoły.', { code: 'student_inactive' });
    const reason = String(b.reason || '').trim();
    if (!reason) throw httpError(400, 'Podaj podstawę zmiany opiekuna (np. numer postanowienia sądu, oświadczenie rodzica).', { field: 'reason' });
    if (b.userId) {                                                        // przypięcie istniejącego konta rodzica
      const u = db.get('users', b.userId);
      if (!u || u.role !== 'parent') throw httpError(400, 'To nie jest konto rodzica.', { field: 'userId' });
      if ((s.parentIds || []).includes(u.id)) throw httpError(409, 'Ten opiekun jest już przypisany do ucznia.', { code: 'already_guardian' });
      if (b.accessScope !== undefined && !SCOPES.includes(String(b.accessScope))) throw httpError(400, 'Zakres dostępu może być „full”, „info” albo „none”.', { field: 'accessScope', allowed: SCOPES });
      /* R3: status władzy rodzicielskiej rozstrzyga zakres domyślny; bez statusu zostaje dotychczasowa droga.
         Nowy wpis nie ma stanu poprzedniego, więc przejście liczy się od `full` (S3-10). */
      const resolved = b.status !== undefined
        ? transition(null, { status: String(b.status), accessScope: b.accessScope !== undefined ? String(b.accessScope) : undefined }, Object.assign({}, b, { legalBasis: reason }))
        : { status: 'full', scope: b.accessScope || u.accessScope || 'full', derived: 'full', explicit: b.accessScope !== undefined, basis: readBasis(b.basis, reason), scopeSource: b.accessScope !== undefined && b.accessScope !== 'full' ? 'explicit' : 'derived' };
      const basis = resolved.basis;
      s.parentIds = [...(s.parentIds || []), u.id];
      u.childrenIds = [...new Set([...(u.childrenIds || []), s.id])];
      /* Zakres jest parą (opiekun, dziecko), więc zapisuje się przy uczniu; konto zostaje domyślną wartością. */
      const entry = setScope(db, s, u.id, { accessScope: resolved.scope, status: resolved.status, basis, scopeSource: resolved.scopeSource || (resolved.explicit ? 'explicit' : 'derived'), since: D.today(db), legalBasis: reason, decidedByUserId: ctx.user.id, at: U.now() });
      if (b.custodyNote !== undefined) u.custodyNote = String(b.custodyNote || '').slice(0, 300) || null;
      db.save();
      ctx.audit({ action: 'guardian_attached', entity: 'student', entityId: s.id, after: { userId: u.id, accessScope: entry.accessScope, guardianStatus: entry.status, basis, derivedScope: resolved.derived, perChild: true }, reason });
      return { ok: true, guardian: { userId: u.id, login: u.login, name: D.userLabel(u), accessScope: entry.accessScope, guardianStatus: entry.status, derivedScope: resolved.derived, scopeSource: entry.scopeSource, basis: entry.basis, since: entry.since, legalBasis: entry.legalBasis }, message: `Zapisano dostęp do danych ucznia ${s.firstName} ${s.lastName} dla opiekuna ${D.userLabel(u)} w zakresie „${entry.accessScope}” (${STATUS_LABEL[entry.status]}).` };
    }
    const expiresAt = codeExpiry(db, +b.validDays > 0 ? +b.validDays : 30, s.enrolledAt || s.joinedAt);   // wydanie kodu dla nowego opiekuna
    const cls = db.get('classes', s.classId);
    const rc = { id: 'rc_' + U.id().slice(0, 10), code: makeCode(2, 4, String((cls && cls.name) || s.classId || 'OP').toUpperCase()), studentId: s.id, classId: s.classId, byUserId: ctx.user.id, expiresAt, usedAt: null, usedByUserId: null, note: reason };
    db.col('registrationCodes').push(rc); db.save();
    ctx.audit({ action: 'guardian_code_issued', entity: 'student', entityId: s.id, after: { codeId: rc.id, expiresAt }, reason });
    return { ok: true, code: rc.code, expiresAt, message: `Kod jednorazowy dla opiekuna: ${rc.code}. Ważny do ${U.fmtDate(expiresAt)}; opiekun, który ma już konto, dopisze nim kolejne dziecko do swojego konta.` };
  }, { roles: ROLES });

  /* --- GAP-3: zakres dostępu opiekuna przy JEDNYM dziecku (postanowienie sądu po aktywacji konta) --- */
  r.patch('/api/registry/students/:id/guardians/:userId', (ctx) => {
    const db = ctx.db; const b = ctx.body || {}; const s = db.get('students', ctx.params.id);
    if (!s) throw httpError(404, 'Nie ma takiego ucznia w księdze.');
    const u = db.get('users', ctx.params.userId);
    if (!u || !(s.parentIds || []).includes(u.id)) throw httpError(404, 'Ten opiekun nie jest przypisany do ucznia.', { code: 'not_guardian' });
    const prev = scopeEntry(s, u.id);
    const hasScope = b.accessScope !== undefined, hasStatus = b.status !== undefined;
    if (!hasScope && !hasStatus) throw httpError(400, 'Zakres dostępu może być „full” (pełny), „info” (bez ocen) albo „none” (brak).', { field: 'accessScope', allowed: SCOPES });
    if (hasScope && !SCOPES.includes(String(b.accessScope))) throw httpError(400, 'Zakres dostępu może być „full” (pełny), „info” (bez ocen) albo „none” (brak).', { field: 'accessScope', allowed: SCOPES });
    const legalBasis = String(b.legalBasis || b.reason || '').trim();
    if (!legalBasis) throw httpError(400, 'Podaj podstawę prawną zmiany zakresu (np. numer postanowienia sądu, oświadczenie rodzica).', { field: 'legalBasis' });
    /* Jedna brama na przejście: podstawa, zakres i ich zgodność ze statusem (S3-10/D3-06/D3-07). */
    const resolved = transition(prev, { status: hasStatus ? String(b.status) : undefined, accessScope: hasScope ? String(b.accessScope) : undefined }, Object.assign({}, b, { legalBasis }));
    const basis = resolved.basis;
    const before = { userId: u.id, accessScope: effectiveScope(s, u), guardianStatus: D.guardianStatus(prev), basis: (prev && prev.basis) || null, perChild: !!prev, legalBasis: (prev && prev.legalBasis) || null, accountScope: u.accessScope || 'full' };
    const entry = setScope(db, s, u.id, {
      accessScope: resolved.scope, status: resolved.status, basis, scopeSource: resolved.scopeSource,
      since: D.today(db), legalBasis,
      note: b.note !== undefined ? (String(b.note || '').slice(0, 300) || null) : ((prev && prev.note) || null),
      decidedByUserId: ctx.user.id, at: U.now()
    });
    db.save();
    const after = { userId: u.id, accessScope: entry.accessScope, guardianStatus: entry.status, basis, derivedScope: resolved.derived, scopeSource: entry.scopeSource, perChild: true, legalBasis, since: entry.since, transition: resolved.transition, basisCleared: !!resolved.basisCleared };
    if (before.guardianStatus !== after.guardianStatus) ctx.audit({ action: 'guardian_status_changed', entity: 'student', entityId: s.id, before, after, reason: legalBasis });
    ctx.audit({ action: 'guardian_scope_changed', entity: 'student', entityId: s.id, before, after, reason: legalBasis });
    const other = (u.childrenIds || []).filter((x) => x !== s.id).map((x) => { const o = db.get('students', x); return o ? { studentId: o.id, name: `${o.firstName} ${o.lastName}`, accessScope: effectiveScope(o, u) } : null; }).filter(Boolean);
    return { ok: true, studentId: s.id, guardian: { userId: u.id, name: D.userLabel(u), accessScope: entry.accessScope, guardianStatus: entry.status, derivedScope: resolved.derived, scopeSource: entry.scopeSource, basis: entry.basis, since: entry.since, legalBasis: entry.legalBasis, note: entry.note }, otherChildren: other,
      message: `${D.userLabel(u)} ma przy uczniu ${s.firstName} ${s.lastName} zakres „${entry.accessScope}” (${STATUS_LABEL[entry.status]}${entry.scopeSource === 'explicit' ? ', zakres nadpisany ręcznie' : ', zakres wynika ze statusu'}). Zakres dotyczy tylko tego dziecka; pozostałe dzieci na tym koncie zostają bez zmian. Podstawa: ${legalBasis}.` };
  }, { roles: ROLES });

  /* --- R3: uczeń pełnoletni — która reguła obowiązuje i od kiedy (wiersz 10 triage'u) ------------- */
  r.get('/api/registry/students/:id/adult-access', (ctx) => {
    const db = ctx.db; const s = db.get('students', ctx.params.id);
    if (!s) throw httpError(404, 'Nie ma takiego ucznia w księdze.');
    if (ctx.user.role === 'teacher' && !D.isHomeroomOf(db, ctx.user, s.classId)) throw httpError(403, 'Regułę dostępu opiekunów czyta wychowawca swojego oddziału albo sekretariat.', { code: 'not_homeroom' });
    return Object.assign({ student: studentLine(db, s), modes: D.ADULT_ACCESS_MODES,
      guardians: (s.parentIds || []).map((id) => { const u = db.get('users', id); return u ? { userId: u.id, name: D.userLabel(u) } : null; }).filter(Boolean) }, adultAccessView(db, s));
  }, { roles: ROLES_HR });

  /** Zgoda albo sprzeciw ucznia pełnoletniego przyjęte na piśmie w sekretariacie (ta sama para pól,
      co `POST /api/student/parent-access`, przez jeden zapis w `D.setAdultParentAccess`). */
  r.post('/api/registry/students/:id/adult-access', (ctx) => {
    const db = ctx.db; const b = ctx.body || {}; const s = db.get('students', ctx.params.id);
    if (!s) throw httpError(404, 'Nie ma takiego ucznia w księdze.');
    const state = D.adultAccessState(db, s);
    if (!state.adult) throw httpError(400, `Zgodę albo sprzeciw zapisuje uczeń pełnoletni — ten uczeń osiąga pełnoletność ${state.adultFrom ? U.fmtDate(state.adultFrom) : '(brak daty urodzenia w księdze)'}.`, { code: 'not_adult', adultFrom: state.adultFrom });
    if (b.consent === undefined && b.blocked === undefined) throw httpError(400, 'Podaj, co uczeń złożył: „consent: true” (zgoda na wgląd opiekunów) albo „blocked: true” (sprzeciw).', { field: 'consent', code: 'consent_missing' });
    const reason = String(b.reason || '').trim();
    if (!reason) throw httpError(400, 'Podaj, na jakiej podstawie sekretariat to zapisuje (np. numer pisma ucznia z datą).', { field: 'reason', code: 'no_reason' });
    const w = D.setAdultParentAccess(db, s, { consent: b.consent, blocked: b.blocked, byUserId: ctx.user.id, reason });
    const given = w.after.consent;
    const text = given
      ? `Uczeń pełnoletni ${D.studentLabel(s, db)}: zapisano zgodę na wgląd opiekunów w oceny i frekwencję.`
      : `Uczeń pełnoletni ${D.studentLabel(s, db)}: zapisano sprzeciw wobec wglądu opiekunów w oceny i frekwencję.`;
    const cls = db.get('classes', s.classId); const homeroom = cls && (cls.actingHomeroomTeacherId || cls.homeroomTeacherId);
    if (homeroom) D.notify(db, homeroom, 'rights', text, { link: '/wychowawca' });
    for (const p of s.parentIds || []) D.notify(db, p, 'rights', text, { link: '/rodzic' });
    const su = db.one('users', (u) => u.role === 'student' && u.studentId === s.id);
    if (su) D.notify(db, su.id, 'rights', `Sekretariat zapisał Twoje oświadczenie: ${given ? 'zgoda na wgląd opiekunów' : 'sprzeciw wobec wglądu opiekunów'} (${reason}).`, { link: '/uczen' });
    ctx.audit({ action: given ? 'adult_consent_recorded' : 'adult_consent_withdrawn', entity: 'student', entityId: s.id, before: w.before, after: w.after, reason });
    return Object.assign({ ok: true, message: text }, adultAccessView(db, s));
  }, { roles: ROLES });

  /* --- GAP-4: flagi ucznia (pomoc społeczna, pełnoletność, obywatelstwo, rodzaj dokumentu) --------- */
  const FLAGS = ['socialWelfare', 'adult', 'adultSelfExcuse', 'parentAccessBlocked'];
  r.get('/api/registry/students/:id/flags', (ctx) => {
    const db = ctx.db; const s = db.get('students', ctx.params.id);
    if (!s) throw httpError(404, 'Nie ma takiego ucznia w księdze.');
    if (ctx.user.role === 'teacher' && !D.isHomeroomOf(db, ctx.user, s.classId)) throw httpError(403, 'Flagi ucznia czyta wychowawca swojego oddziału albo sekretariat.', { code: 'not_homeroom' });
    const view = Object.assign({ name: `${s.lastName} ${s.firstName}`, classId: s.classId, hasPesel: !!s.pesel, hasPassport: !!ID.documentOf(s), documentTypes: ID.DOCUMENT_TYPES, adultAccess: adultAccessView(db, s) }, flagsView(s));
    return Object.assign(view, { identityComments: LC.countsFor(db, ctx.user, 'identity-history', view.identityHistory.map((e) => e.id)) });
  }, { roles: ROLES_HR });
  r.patch('/api/registry/students/:id/flags', (ctx) => {
    const db = ctx.db; const b = ctx.body || {}; const s = db.get('students', ctx.params.id);
    if (!s) throw httpError(404, 'Nie ma takiego ucznia w księdze.');
    /* Wychowawca poprawia flagi wyłącznie w swoim oddziale — sekretariat i administracja w całej szkole. */
    if (ctx.user.role === 'teacher' && !D.isHomeroomOf(db, ctx.user, s.classId)) throw httpError(403, 'Flagi ucznia zmienia wychowawca swojego oddziału albo sekretariat.', { code: 'not_homeroom' });
    const before = {}, after = {}; let identityChange = null;
    for (const k of FLAGS) if (b[k] !== undefined) { const v = !!b[k]; if (!!s[k] !== v) { before[k] = !!s[k]; after[k] = v; } }
    if (b.nationality !== undefined) { const v = String(b.nationality || '').trim().slice(0, 60) || null; if ((s.nationality || null) !== v) { before.nationality = s.nationality || null; after.nationality = v; } }
    /* ---- D3-45: numer PESEL nadany w trakcie roku -------------------------------------------
       Uczeń, który przyjechał we wrześniu na karcie pobytu i dostał PESEL w listopadzie, nie miał
       dotąd żadnej drogi: `pesel` nie był zapisywalny nigdzie, a komunikaty odsyłały sekretariat do
       nieistniejącej możliwości („najpierw uzupełnij go w księdze”). Jedyną ucieczką było usunięcie
       i ponowne wpisanie ucznia, co pali nowy numer księgi, nowe `id` (jest slugiem nazwiska), nowy
       login i osierocą wszystkie oceny i frekwencję.
       Zapis idzie przez tę samą kontrolę, co przy wpisie do księgi: suma kontrolna **oraz** zgodność
       z datą urodzenia z księgi, plus sprawdzenie, czy numer nie stoi już przy innym uczniu. Stary
       dokument zostaje: nie kasujemy go, tylko przenosimy do `identityHistory` (§ 4). Numer PESEL
       jest polem księgi uczniów, więc — inaczej niż reszta flag — nie wpisuje go wychowawca. */
    if (b.pesel !== undefined) {
      if (!ROLES.includes(ctx.user.role)) throw httpError(403, 'Numer PESEL w księdze uczniów wpisuje sekretariat albo administracja — wychowawca zgłasza zmianę do sekretariatu.', { field: 'pesel', code: 'registry_only' });
      const wanted = b.pesel === null ? null : String(b.pesel).trim();
      const prevDoc = ID.documentOf(s);
      if (!wanted) {
        if (!prevDoc) throw httpError(400, 'Uczeń bez numeru PESEL musi mieć w księdze dokument tożsamości — najpierw zapisz rodzaj, numer i kod kraju wydania.', { field: 'pesel', code: 'no_identity' });
        if (s.pesel) { before.pesel = s.pesel; after.pesel = null; }
      } else if (wanted !== (s.pesel || null)) {
        const res = checkPesel(wanted, s.birthDate);
        if (!res.ok) throw httpError(400, res.error, { code: 'pesel_invalid', field: 'pesel', position: res.position || null, expected: res.expected, expectedBirthDate: res.expectedBirthDate });
        const dup = db.one('students', (x) => x.id !== s.id && x.pesel === wanted);
        if (dup) throw httpError(409, `Ten numer PESEL jest już w księdze przy innym uczniu (nr księgi ${dup.registerNo}).`, { code: 'pesel_duplicate', field: 'pesel', registerNo: dup.registerNo });
        before.pesel = s.pesel || null; after.pesel = wanted;
        /* PESEL rozstrzyga płeć i datę urodzenia; datę mamy potwierdzoną wyżej, płeć uzupełniamy. */
        if (res.sex && s.sex !== res.sex) { before.sex = s.sex || null; after.sex = res.sex; }
        if (!s.birthDate && res.birthDate) { before.birthDate = s.birthDate || null; after.birthDate = res.birthDate; }
        /* Uczeń z numerem PESEL legitymuje się numerem; dokument zostaje w księdze jako historia. */
        if ((s.identityKind || null) !== 'pesel' && b.identityKind === undefined) { before.identityKind = s.identityKind || null; after.identityKind = 'pesel'; before.foreigner = !!s.foreigner; after.foreigner = false; }
      }
      if (after.pesel !== undefined) identityChange = {
        at: U.now(), byUserId: ctx.user.id, date: D.today(db), change: 'pesel',
        from: { pesel: before.pesel || null, identityDocument: prevDoc }, to: { pesel: after.pesel },
        reason: String(b.reason || '').trim() || 'nadanie numeru PESEL w trakcie roku szkolnego',
      };
    }
    /* R7 — poprawka dokumentu tożsamości po imporcie (rozbicie wolnego pola „Dokument tożsamości”
       jest heurystyką, więc sekretariat musi mieć gdzie je poprawić). `null` kasuje dokument. */
    if (b.identityDocument !== undefined) {
      const prev = ID.documentOf(s);
      if (b.identityDocument === null) {
        const peselNow = after.pesel !== undefined ? after.pesel : (s.pesel || null);
        if (!peselNow) throw httpError(400, 'Uczeń bez numeru PESEL musi mieć w księdze dokument tożsamości — wpisz numer PESEL w tym samym żądaniu (pole „pesel”), zanim usuniesz dokument.', { field: 'identityDocument', code: 'no_identity' });
        if (prev) { before.identityDocument = prev; after.identityDocument = null; Object.assign(after, ID.documentFields(null)); }
      } else {
        const r = ID.readDocument(b);
        if (!r.ok) throw httpError(400, r.error, { code: r.code, field: r.field, allowed: r.allowed });
        if (JSON.stringify(prev) !== JSON.stringify(r.doc)) { before.identityDocument = prev; Object.assign(after, ID.documentFields(r.doc)); }
      }
    }
    if (b.identityKind !== undefined) {
      const kind = b.identityKind === 'passport' ? 'passport' : 'pesel';
      const peselAfter = after.pesel !== undefined ? after.pesel : (s.pesel || null);
      if (kind === 'pesel' && !peselAfter) throw httpError(400, 'Uczeń nie ma zapisanego numeru PESEL — wpisz go w tym samym żądaniu (pole „pesel”) albo zostaw dokument tożsamości.', { field: 'identityKind', code: 'no_pesel' });
      /* Dokument dopisany w tym samym żądaniu liczy się tak samo jak zapisany wcześniej. */
      const docAfter = after.identityDocument !== undefined ? after.identityDocument : ID.documentOf(s);
      if (kind === 'passport' && !docAfter) throw httpError(400, 'Uczeń nie ma zapisanego dokumentu tożsamości — księga wymaga rodzaju, numeru i kodu kraju wydania.', { field: 'identityKind' });
      if ((s.identityKind || null) !== kind) { before.identityKind = s.identityKind || null; after.identityKind = kind; before.foreigner = !!s.foreigner; after.foreigner = kind === 'passport'; }
    }
    /* Pełnoletność zdjęta z konta zabiera to, co z niej wynika — inaczej uczeń niepełnoletni
       zostawałby z prawem do samodzielnego usprawiedliwiania się. */
    if (after.adult === false) for (const k of ['adultSelfExcuse', 'parentAccessBlocked']) if (b[k] === undefined && s[k]) { before[k] = true; after[k] = false; }
    const adultAfter = after.adult !== undefined ? after.adult : !!s.adult;
    const selfAfter = after.adultSelfExcuse !== undefined ? after.adultSelfExcuse : !!s.adultSelfExcuse;
    if (selfAfter && !adultAfter) throw httpError(400, 'Uczeń usprawiedliwia się sam dopiero jako pełnoletni — najpierw zaznacz pełnoletność.', { field: 'adultSelfExcuse', code: 'not_adult' });
    if (!Object.keys(after).length) return { ok: true, changed: [], flags: flagsView(s), message: 'Bez zmian.' };
    const changed = Object.keys(after);
    Object.assign(s, after);
    /* Historia tożsamości jest dopisywana obok `after`, a nie w nim: `after` jest łatką na uczniu. */
    if (identityChange) { pushIdentityHistory(s, identityChange); after.identityChange = identityChange; }
    db.save();
    ctx.audit({ action: 'student_flags_changed', entity: 'student', entityId: s.id, before, after, reason: String(b.reason || '').trim() || 'zmiana danych ucznia w księdze' });
    return { ok: true, changed, flags: flagsView(s),
      message: identityChange && identityChange.to.pesel
        ? `Zapisano numer PESEL przy uczniu ${s.firstName} ${s.lastName} (nr księgi ${s.registerNo}). Poprzedni dokument tożsamości został zachowany w historii wpisu.`
        : `Zapisano zmiany dla ucznia ${s.firstName} ${s.lastName}: ${changed.join(', ')}.` };
  }, { roles: ROLES_HR });

  /* ---- D3-48: zmiana imienia albo nazwiska ucznia (§ 4 rozporządzenia o dokumentacji) ----------
     Postanowienie sądu, zawarcie małżeństwa przez opiekuna, przysposobienie, decyzja kierownika USC
     albo zwykłe sprostowanie błędu w naborze — każde z nich zmienia nazwisko dziecka w trakcie roku,
     a § 4 wymaga, żeby księga uczniów niosła **także nazwisko poprzednie**. Dotąd nie było na to
     żadnej trasy: jedynym wyjściem była ręczna edycja pliku, po której nazwisko zostawało nieaktualne
     w koncie ucznia, a `s.id` i login (oba są slugiem nazwiska) i tak pamiętały stare.
     Dlatego: `id`, `registerNo` i `login` zostają nietknięte — to identyfikatory, nie dane osobowe,
     i przewieszenie ich osierociłoby oceny i frekwencję. Zmieniają się imię i nazwisko przy uczniu
     i w jego koncie, poprzednia para ląduje w `previousNames[]` z datą i podstawą, a odmiana przez
     przypadki (miejscownik na świadectwo) traci potwierdzenie, bo dotyczyła poprzedniego nazwiska. */
  const NAME_BASIS_KINDS = ['court-order', 'marriage', 'adoption', 'administrative-decision', 'correction'];
  const NAME_BASIS_PL = { 'court-order': 'postanowienie sądu', marriage: 'zawarcie małżeństwa', adoption: 'przysposobienie', 'administrative-decision': 'decyzja administracyjna (kierownik USC)', correction: 'sprostowanie błędu we wpisie' };
  r.patch('/api/registry/students/:id/name', (ctx) => {
    const db = ctx.db; const b = ctx.body || {}; const s = db.get('students', ctx.params.id);
    if (!s) throw httpError(404, 'Nie ma takiego ucznia w księdze.');
    const firstName = b.firstName === undefined ? s.firstName : String(b.firstName || '').trim();
    const lastName = b.lastName === undefined ? s.lastName : String(b.lastName || '').trim();
    if (!firstName || !lastName) throw httpError(400, 'Imię i nazwisko ucznia nie mogą być puste.', { field: b.firstName !== undefined && !firstName ? 'firstName' : 'lastName', code: 'name_required' });
    if (firstName === s.firstName && lastName === s.lastName) throw httpError(400, 'Imię i nazwisko są takie same jak w księdze — nie ma czego zmieniać.', { code: 'name_unchanged' });
    const kind = String((b.basis && b.basis.kind) || b.basisKind || '').trim();
    if (!NAME_BASIS_KINDS.includes(kind)) throw httpError(400, `Podaj rodzaj podstawy zmiany nazwiska: ${NAME_BASIS_KINDS.join(', ')} (${NAME_BASIS_KINDS.map((k) => NAME_BASIS_PL[k]).join(', ')}).`, { field: 'basis.kind', code: 'name_basis_kind', allowed: NAME_BASIS_KINDS });
    const reference = String((b.basis && b.basis.reference) || b.reference || '').trim().slice(0, 200);
    if (!reference) throw httpError(400, 'Podaj sygnaturę albo numer dokumentu, na podstawie którego zmieniasz nazwisko — księga uczniów musi wskazywać podstawę wpisu (§ 4).', { field: 'basis.reference', code: 'name_basis_reference' });
    const date = ISO_DATE.test(String((b.basis && b.basis.date) || b.date || '')) ? String((b.basis && b.basis.date) || b.date) : D.today(db);
    const basis = { kind, reference, date };
    const before = { firstName: s.firstName, lastName: s.lastName, declension: Object.assign({}, s.declension) };
    const entry = { firstName: s.firstName, lastName: s.lastName, until: date, at: U.now(), byUserId: ctx.user.id, basis, reason: String(b.reason || '').trim() || NAME_BASIS_PL[kind] };
    s.previousNames = (Array.isArray(s.previousNames) ? s.previousNames : []).concat([entry]).slice(-50);
    s.firstName = firstName; s.lastName = lastName; s.nameChangedAt = date; s.nameChangeBasis = basis;
    /* Miejscownik był sprawdzony dla poprzedniego nazwiska — wychowawca musi potwierdzić go ponownie
       zanim pójdą świadectwa (homeroom.js pilnuje `declension.confirmedAt`). */
    s.declension = Object.assign({}, s.declension, { firstNameLocative: null, lastNameLocative: null, confirmedAt: null, confirmedBy: null });
    /* Konto ucznia niesie własną kopię imienia i nazwiska — bez lustrzanego zapisu uczeń logowałby
       się pod starym nazwiskiem na każdym ekranie. Login i `id` zostają: to identyfikatory. */
    const su = db.one('users', (u) => u.role === 'student' && u.studentId === s.id);
    if (su) { su.firstName = firstName; su.lastName = lastName; su.name = `${firstName} ${lastName}`; }
    db.save();
    const after = { firstName, lastName, basis, previousName: `${entry.firstName} ${entry.lastName}`, userId: su ? su.id : null, declensionCleared: true };
    ctx.audit({ action: 'registry_student_renamed', entity: 'student', entityId: s.id, before, after, reason: `${NAME_BASIS_PL[kind]} ${reference}` });
    return { ok: true, student: { id: s.id, registerNo: s.registerNo, firstName, lastName, previousNames: s.previousNames, nameChangedAt: s.nameChangedAt, nameChangeBasis: basis },
      studentUserId: su ? su.id : null, loginUnchanged: su ? su.login : null,
      message: `Wpis nr ${s.registerNo}: ${entry.firstName} ${entry.lastName} → ${firstName} ${lastName} (${NAME_BASIS_PL[kind]} ${reference} z ${U.fmtDate(date)}). Poprzednie nazwisko zostało zachowane w księdze. Numer księgi, identyfikator i login ucznia są bez zmian; potwierdź ponownie odmianę nazwiska przed wydrukiem świadectw.` };
  }, { roles: ROLES });

  r.delete('/api/registry/students/:id/guardians/:userId', (ctx) => {
    const db = ctx.db; const b = ctx.body || {}; const s = db.get('students', ctx.params.id);
    if (!s) throw httpError(404, 'Nie ma takiego ucznia w księdze.');
    const u = db.get('users', ctx.params.userId);
    if (!u || !(s.parentIds || []).includes(u.id)) throw httpError(404, 'Ten opiekun nie jest przypisany do ucznia.');
    const reason = String(b.reason || '').trim();
    if (!reason) throw httpError(400, 'Odebranie dostępu opiekunowi wymaga podstawy (np. numer postanowienia sądu).', { field: 'reason' });
    if ((s.parentIds || []).length === 1 && !b.force) throw httpError(409, 'To jedyny opiekun ucznia — odpięcie zostawi ucznia bez kontaktu w systemie. Najpierw przypisz nowego opiekuna albo wyślij force:true.', { code: 'last_guardian' });
    const before = { parentIds: (s.parentIds || []).slice() };
    s.parentIds = s.parentIds.filter((x) => x !== u.id);
    if (Array.isArray(s.guardians)) s.guardians = s.guardians.filter((x) => !x || (x.userId || x.id) !== u.id);
    s.formerParentIds = [...new Set([...(s.formerParentIds || []), u.id])];
    u.childrenIds = (u.childrenIds || []).filter((x) => x !== s.id);
    let sessions = 0;
    for (const ses of db.col('sessions')) if (ses.userId === u.id && !ses.revoked) { ses.revoked = true; ses.revokedReason = 'guardian_detached'; ses.revokedAt = U.now(); sessions++; }
    if (!u.childrenIds.length) { u.blocked = true; u.blockedAt = U.now(); u.blockedReason = reason; }
    db.save();
    ctx.audit({ action: 'guardian_detached', entity: 'student', entityId: s.id, before, after: { userId: u.id, remainingChildren: u.childrenIds.length, blocked: !!u.blocked }, reason });
    return { ok: true, userId: u.id, name: D.userLabel(u), remainingChildren: u.childrenIds.length, accountBlocked: !!u.blocked, sessionsRevoked: sessions,
      /* OPS3-19 — bezosobowo: „stracił” było poprawne dla połowy opiekunów. */
      message: `Odebrano dostęp do danych ucznia ${s.firstName} ${s.lastName}: ${D.userLabel(u)}${u.blocked ? ' — konto zablokowane, bo nie ma już dzieci w tej szkole' : ''}. Podstawa: ${reason}.` };
  }, { roles: ROLES });

  /* --- 3.5.2 legitymacja cyfrowa (mObywatel) ------------------------------------------- */
  r.get('/api/registry/student-ids', (ctx) => ({
    studentIds: ctx.db.col('studentIds').map((x) => Object.assign({}, x, { student: (() => { const s = ctx.db.get('students', x.studentId); return s ? studentLine(ctx.db, s) : x.studentId; })() })).sort((a, b) => (a.issuedAt < b.issuedAt ? 1 : -1))
  }), { roles: ROLES });

  r.post('/api/registry/students/:id/student-id', (ctx) => {
    const db = ctx.db; const s = db.get('students', ctx.params.id);
    if (!s) throw httpError(404, 'Nie ma takiego ucznia w księdze.');
    if (s.status !== 'active') throw httpError(400, 'Legitymację wydaje się wyłącznie uczniom z otwartym wpisem w księdze.');
    for (const old of db.col('studentIds')) if (old.studentId === s.id && old.status === 'issued') { old.status = 'revoked'; old.revokedAt = U.now(); }
    const doc = db.insert('studentIds', {
      id: 'sid_' + U.id().slice(0, 10), studentId: s.id, code: makeCode(3, 4), issuedAt: U.now(), issuedByUserId: ctx.user.id,
      validTo: yearEnd(db) + '-09-30', status: 'issued', app: 'mObywatel'
    });
    ctx.audit({ action: 'student_id_issued', entity: 'studentId', entityId: doc.id, after: { studentId: s.id, validTo: doc.validTo }, reason: 'wydanie legitymacji cyfrowej' });
    D.notifyParentsOf(db, s.id, 'legitymacja', `Wydano legitymację cyfrową dla ucznia ${s.firstName} ${s.lastName}. Kod autoryzacyjny do aplikacji mObywatel odbierz w sekretariacie.`, { link: '/sekretariat' });
    return { ok: true, studentId: doc, code: doc.code, validTo: doc.validTo, message: `Kod autoryzacyjny mObywatel: ${doc.code}. Ważny do ${U.fmtDate(doc.validTo)}.` };
  }, { roles: ROLES });

  /* --- 3.5.3 pakiet SIO ----------------------------------------------------------------- */
  /* R3-05/D3-43/OPS3-13 — `config.sio` pisze wyłącznie seed demonstracyjny. Każda prawdziwa instalacja
     rodzi się z kreatora pierwszego uruchomienia, gdzie tego klucza nie ma, więc jedyna trasa, którą
     docs/SIO.md każe wywołać sekretariatowi, kończyła się pięćsetką bez kodu i bez wskazówki.
     Brakujący klucz jest teraz błędem 400 z instrukcją, a nie awarią serwera; domyślne wartości do
     konfiguracji dosypuje `server/lib/blank-seed.js` (pakiet F5). */
  const sioConfig = (db) => {
    const c = (db.data.config && db.data.config.sio) || null;
    if (!c || typeof c !== 'object') throw httpError(400, 'Szkoła nie ma jeszcze ustawień sprawozdania SIO. Uzupełnij wersję schematu w konfiguracji (config.sio.schemaVersion), zanim sprawdzisz pakiet — bez niej nie wiadomo, do której wersji sprawozdania go porównać.', { code: 'sio_not_configured', field: 'config.sio', setting: 'sio.schemaVersion' });
    return c;
  };
  r.post('/api/registry/sio/validate', (ctx) => {
    const db = ctx.db; const cfg = sioConfig(db);
    const { xml, counts, errors } = buildSio(db);
    const warnings = sioSelfCheck(db, xml);
    /* D3-44 — dokumentacja i docstring `sioSelfCheck` mówią, że `level: 'error'` blokuje wysyłkę
       „tak samo jak dotychczasowe errors”. Do tej pory blokowały tylko te drugie, więc dwoje uczniów
       z tym samym numerem PESEL albo uczeń z pustym nazwiskiem pobierał się czysto przy `ok: false`. */
    const blocking = errors.concat(warnings.filter((w) => w.level === 'error').map((w) => w.message));
    return {
      ok: blocking.length === 0, errors, warnings, counts,
      blocking, blockingCount: blocking.length,
      schemaVersion: cfg.schemaVersion || '1.0', anonymized: !!db.data.config.anonymized,
      /* NIE jest to walidacja wobec schematu CIE — patrz docs/SIO.md. */
      schema: SIO_SCHEMA_MARK,
      checks: ['well-formed-xml', 'required-fields-per-pupil', 'identity-pesel-or-document', 'no-duplicate-pesel', 'iso-dates'],
      note: 'Kontrola własna pakietu: składnia XML, komplet pól przy każdym uczniu, brak powtórzonych numerów PESEL, daty w formacie RRRR-MM-DD. Pakietu NIE sprawdzono wobec schematu XSD Centrum Informatycznego Edukacji — ten schemat trzeba pobrać i wpiąć osobno (docs/SIO.md).'
    };
  }, { roles: ROLES });

  /* Pakiet, który sekretariat pobiera, niesie ten sam znacznik — plik nie udaje sprawdzonego XSD. */
  r.get('/api/registry/sio/package', (ctx) => {
    const db = ctx.db; const { xml, counts, errors } = buildSio(db);
    const warnings = sioSelfCheck(db, xml);
    const selfErrors = warnings.filter((w) => w.level === 'error');
    const blocking = errors.concat(selfErrors.map((w) => w.message));
    const forced = ctx.query.force === '1';
    if (blocking.length && !forced) throw httpError(400, `Walidacja pakietu SIO zakończona ${blocking.length} ${U.plural(blocking.length, 'błędem', 'błędami', 'błędami')}; pakiet nie został pobrany. Popraw wpisy w księdze albo — świadomie i na własną odpowiedzialność — pobierz pakiet z parametrem force=1 (administrator; zostanie to odnotowane w rejestrze zdarzeń).`,
      { code: 'sio_blocking_findings', errors, blocking, codes: selfErrors.map((w) => w.code) });
    /* Obejście jest wyjątkiem, nie trybem pracy: pobranie pakietu, o którym system wie, że jest wadliwy
       (powtórzony PESEL, pusty wymagany element, plik niepoprawny składniowo), zostawia jawny ślad
       i może je zrobić wyłącznie administrator — nie sekretariat pod presją terminu. */
    if (blocking.length && ctx.user.role !== 'admin') throw httpError(403, 'Pakiet SIO z błędami może pobrać wyłącznie administrator, i tylko z wpisem do rejestru zdarzeń. Sekretariat najpierw poprawia wskazane wpisy w księdze uczniów.', { code: 'sio_force_admin_only', blocking });
    ctx.audit({ action: blocking.length ? 'sio_export_forced' : 'sio_export', entity: 'config', entityId: 'sio',
      after: Object.assign({}, counts, blocking.length ? { forced: true, blockingCount: blocking.length, codes: [...new Set(selfErrors.map((w) => w.code))], buildErrors: errors.length } : null),
      reason: blocking.length ? `eksport pakietu SIO mimo ${blocking.length} ${U.plural(blocking.length, 'błędu', 'błędów', 'błędów')} kontroli własnej (force=1)` : 'eksport pakietu SIO' });
    if (ctx.query.json === '1') return { xml, counts, errors, warnings, blocking, forced: blocking.length > 0, schema: SIO_SCHEMA_MARK };
    return { __raw: true, contentType: 'application/xml; charset=utf-8', filename: `sio-${D.today(db)}.xml`, body: xml };
  }, { roles: ROLES });

  /* --- R7: dopasowanie listy z naboru do księgi uczniów (faza 1, bez zapisu) ------------- */
  /**
   * `POST /api/registry/students/import` — **wyłącznie próbne**. Zwraca to, co importer zrozumiał
   * z pliku: kolumny, których nie rozpoznał, uczniów bez numeru PESEL z rozbitym dokumentem
   * tożsamości i wiersze do poprawki. Zapis robi się dopiero z przejrzanej listy
   * (`POST /api/registry/students` albo `POST /api/setup/students/import`), bo rozbicie pola
   * „Dokument tożsamości” z naboru jest heurystyką — README fixture'ów, §5 i „trzy rzeczy”, pkt 3.
   */
  r.post('/api/registry/students/import', (ctx) => {
    const db = ctx.db; const b = ctx.body || {};
    const text = String(b.csv || '');
    if (!text.trim()) throw httpError(400, 'Wklej albo wyślij zawartość pliku CSV w polu „csv”.', { field: 'csv', code: 'no_csv' });
    const parsed = CSV.parseObjects(text, { separator: b.separator || undefined });
    if (!parsed.rows.length) throw httpError(400, 'Plik nie ma ani jednego wiersza danych pod nagłówkiem.', { field: 'csv', code: 'empty_csv' });
    const known = new Set(Object.values(ID.COLUMNS).flat().map(CSV.headerKey));
    const unknownColumns = parsed.header.filter((hh) => hh && !known.has(CSV.headerKey(hh)));
    const namesVisible = ROLES.includes(ctx.user.role);
    const seenPesel = new Map();
    let matchedInRegister = 0;
    const rows = parsed.rows.map((row) => {
      const m = ID.mapRegisterRow(row);
      if (m.pesel) {
        const v = U.validatePesel(m.pesel);
        if (!v.ok) m.issues.push({ code: 'pesel_invalid', level: 'error', field: 'pesel', message: v.error });
        else if (m.birthDate && v.birthDate !== m.birthDate) m.issues.push({ code: 'pesel_birthdate', level: 'error', field: 'pesel', message: `Z numeru PESEL wynika data urodzenia ${U.fmtDate(v.birthDate)}, a w kolumnie „Data urodzenia” jest ${U.fmtDate(m.birthDate)}.` });
        const dup = db.one('students', (x) => x.pesel === m.pesel);
        if (dup) {
          matchedInRegister++;
          /* S3-14 — odpowiedź na wklejony plik nie może być wyszukiwarką po numerach PESEL. Numer
             księgi wystarczy sekretariatowi, żeby odnaleźć wpis; imię i nazwisko dokłada się tylko
             tam, gdzie i tak widać całą księgę (sekretariat, administracja, dyrekcja). */
          m.issues.push({ code: 'pesel_in_register', level: 'error', field: 'pesel', registerNo: dup.registerNo,
            message: namesVisible
              ? `Numer PESEL jest już w księdze przy uczniu ${dup.lastName} ${dup.firstName} (nr księgi ${dup.registerNo}).`
              : `Ten numer PESEL jest już w księdze uczniów (nr księgi ${dup.registerNo}).` });
        }
        if (seenPesel.has(m.pesel)) m.issues.push({ code: 'pesel_duplicate_row', level: 'error', field: 'pesel', message: `Ten numer PESEL jest w pliku po raz drugi (pierwszy raz w wierszu ${seenPesel.get(m.pesel)}).` });
        else seenPesel.set(m.pesel, m.line);
      }
      if (m.classId && !db.get('classes', m.classId)) m.issues.push({ code: 'class_missing', level: 'warning', field: 'classId', message: `Oddziału „${m.classId}” nie ma jeszcze w dzienniku — założy go zapis albo trzeba poprawić kolumnę.` });
      m.ok = !m.issues.some((x) => x.level === 'error');
      return m;
    });
    const documents = rows.filter((x) => !x.pesel && x.identityDocument);
    const out = {
      dryRun: true, separator: parsed.separator, columns: parsed.header, unknownColumns,
      count: rows.length, ok: rows.filter((x) => x.ok).length,
      withPesel: rows.filter((x) => x.pesel).length, withDocument: documents.length,
      needsReview: rows.filter((x) => x.review).length,
      missingClasses: [...new Set(rows.map((x) => x.classId).filter((c) => c && !db.get('classes', c)))],
      rows,
      message: `Dopasowano ${rows.length} ${U.plural(rows.length, 'wiersz', 'wiersze', 'wierszy')}: ${rows.filter((x) => x.ok).length} gotowych do wpisu, ${documents.length} ${U.plural(documents.length, 'uczeń bez numeru PESEL', 'uczniów bez numeru PESEL', 'uczniów bez numeru PESEL')} z dokumentem tożsamości do przejrzenia. Nic nie zostało zapisane — to jest faza dopasowania.`
    };
    /* S3-12 + S3-14 — wiersz audytu niesie **kształt**, nie ładunek: 400 zmyślonych nagłówków robiło
       z niego 85 kB, a o tym, co naprawdę sprawdzano — listę numerów PESEL odpytanych o księgę —
       nie mówił nic. Teraz zapisuje liczby i przyciętą próbkę nazw kolumn, plus ile numerów PESEL
       przepuszczono przez księgę i ile trafiło. Sam plik nadal nigdzie nie ląduje: to suchy bieg. */
    ctx.audit({ action: 'registry_import_checked', entity: 'students', after: {
      count: out.count, ok: out.ok, withPesel: out.withPesel, withDocument: out.withDocument,
      columns: parsed.header.length, unknownColumns: unknownColumns.length,
      unknownColumnsSample: unknownColumns.slice(0, 20).map((c) => String(c).slice(0, 40)),
      peselsProbed: out.withPesel, peselsMatchedInRegister: matchedInRegister, namesReturned: namesVisible,
    }, reason: 'próbne dopasowanie listy uczniów' });
    return out;
  }, { roles: ROLES });

  /* --- R7: kody frekwencji z obcego dziennika (faza 1, bez zapisu) ------------------------ */
  /**
   * `POST /api/registry/attendance/import` — **wyłącznie próbne**: odpowiada, jak wygląda mapowanie
   * kodów frekwencji z cudzego pliku na nasze statusy, i **odmawia**, dopóki choć jeden kod nie ma
   * odpowiednika (`ns` z archiwum). Nie zapisuje frekwencji; `D.attendanceStats` dalej umie zgłosić
   * nieznany status, ale import nie ma prawa zgubić go po cichu.
   * Wejście: `{ xml }` (eksport dziennika), `{ rows: [{status|code}] }` albo `{ codes: [] }`.
   */
  r.post('/api/registry/attendance/import', (ctx) => {
    const b = ctx.body || {};
    const mapping = b.mapping && typeof b.mapping === 'object' ? b.mapping : null;
    const raw = [];
    if (Array.isArray(b.codes)) for (const c of b.codes) raw.push(String(c));
    if (Array.isArray(b.rows)) for (const rrow of b.rows) raw.push(String((rrow && (rrow.status || rrow.code)) || ''));
    if (typeof b.xml === 'string' && b.xml.trim()) {
      const form = XC.wellFormed(b.xml);
      if (!form.ok) throw httpError(400, `Plik nie jest poprawnym dokumentem XML: ${form.errors[0].message} (linia ${form.errors[0].line}).`, { code: 'xml_not_well_formed', errors: form.errors.slice(0, 10) });
      const re = /\bstatus\s*=\s*"([^"]*)"/g; let m;
      while ((m = re.exec(b.xml))) raw.push(m[1]);
    }
    if (!raw.length) throw httpError(400, 'Nie znaleziono ani jednego wpisu frekwencji — wyślij „xml”, „rows” albo „codes”.', { code: 'no_rows' });
    const counts = new Map();
    for (const c of raw) counts.set(String(c).trim(), (counts.get(String(c).trim()) || 0) + 1);
    const codes = [...counts.entries()].sort((a, bb) => bb[1] - a[1]).map(([code, n]) => {
      const r2 = D.mapAttendanceCode(code, mapping);
      return { code, rows: n, mapped: r2.code, ok: r2.ok, source: r2.source || null, skipped: !!r2.skipped, reason: r2.reason || null };
    });
    const unknown = codes.filter((c) => !c.ok);
    const result = {
      dryRun: true, rows: raw.length, codes, unknown: unknown.map((c) => c.code),
      known: D.ATTENDANCE_STATUSES, mapping: mapping || null,
      note: 'To jest wyłącznie sprawdzenie mapowania — frekwencja nie została zapisana. Kod bez odpowiednika musi dostać go jawnie (np. {"ns": "zw"}) albo być jawnie pominięty ({"ns": null}); import nigdy nie zgaduje.'
    };
    if (unknown.length) {
      throw httpError(400, `Import frekwencji wstrzymany: ${unknown.length} ${U.plural(unknown.length, 'kod', 'kody', 'kodów')} bez odpowiednika w dzienniku (${unknown.map((c) => `„${c.code}” — ${c.rows} ${U.plural(c.rows, 'wpis', 'wpisy', 'wpisów')}`).join(', ')}). Podaj mapowanie na statusy: ${D.ATTENDANCE_STATUSES.join(', ')}.`,
        Object.assign({ code: 'attendance_codes_unmapped' }, result));
    }
    /* S3-12 — 6 000 zmyślonych kodów robiły z tego wiersza 124 kB w dzienniku zdarzeń, którego nic
       w produkcie nie umie usunąć przed upływem retencji. Kształt zamiast ładunku: liczby plus
       przycięta próbka kodów, która wystarcza, żeby rozpoznać, z jakiego programu był plik. */
    ctx.audit({ action: 'attendance_import_checked', entity: 'attendance', after: {
      rows: raw.length, distinctCodes: codes.length, unmapped: 0,
      codesSample: codes.slice(0, 20).map((c) => String(c.code).slice(0, 40)),
      mappingKeys: mapping ? Object.keys(mapping).length : 0,
    }, reason: 'próbne mapowanie kodów frekwencji' });
    return Object.assign({ ok: true, message: `Wszystkie ${codes.length} ${U.plural(codes.length, 'kod ma', 'kody mają', 'kodów ma')} odpowiednik w dzienniku. Frekwencja nie została zapisana — to jest sprawdzenie mapowania.` }, result);
  }, { roles: ROLES });

  /* --- 3.5.8 przeniesienie do innej szkoły ---------------------------------------------- */
  r.get('/api/registry/students/:id/transcript', (ctx) => {
    const s = ctx.db.get('students', ctx.params.id); if (!s) throw httpError(404, 'Nie ma takiego ucznia w księdze.');
    ctx.audit({ action: 'transcript_printed', entity: 'student', entityId: s.id, reason: 'odpis arkusza ocen' });
    return sendHtml(ctx, transcriptHtml(ctx.db, s));
  }, { roles: ROLES });

  r.post('/api/registry/students/:id/transfer', (ctx) => {
    const db = ctx.db; const b = ctx.body || {}; const s = db.get('students', ctx.params.id);
    if (!s) throw httpError(404, 'Nie ma takiego ucznia w księdze.');
    if (s.status === 'transferred') throw httpError(400, 'Wpis tego ucznia jest już zamknięty z datą ' + U.fmtDate(s.departureDate) + '.');
    const date = String(b.date || '').slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw httpError(400, 'Podaj datę odejścia w formacie RRRR-MM-DD.', { field: 'date' });
    const school = String(b.school || '').trim(); if (!school) throw httpError(400, 'Podaj nazwę szkoły docelowej.', { field: 'school' });
    const before = { status: s.status, departureDate: s.departureDate || null, classId: s.classId };
    s.status = 'transferred'; s.departureDate = date; s.transferSchool = school; s.transferReason = String(b.reason || '').trim() || 'przeniesienie do innej szkoły';
    s.registerClosedAt = U.now(); s.registerClosedByUserId = ctx.user.id;
    const cut = closeEnrolment(db, s, { reason: `przeniesienie do: ${school}` });
    db.save();
    ctx.audit({ action: 'registry_entry_closed', entity: 'student', entityId: s.id, before, after: { status: 'transferred', departureDate: date, transferSchool: school, removedFromGroups: cut.groups, parentsDetached: cut.parents.length, codesVoided: cut.codes, sessionsRevoked: cut.sessions }, reason: s.transferReason });
    return { ok: true, student: { id: s.id, registerNo: s.registerNo, status: s.status, departureDate: s.departureDate, transferSchool: s.transferSchool },
      transcriptUrl: `/api/registry/students/${s.id}/transcript`, access: cut,
      message: `Zamknięto wpis nr ${s.registerNo} z datą ${U.fmtDate(date)}. Odpis arkusza ocen jest gotowy do wydruku. Uczeń zszedł z list oddziału ${before.classId || s.classId} i ${cut.groups.length} ${U.plural(cut.groups.length, 'grupy', 'grup', 'grup')}, konto ucznia zablokowane, dostęp ${cut.parents.length} ${U.plural(cut.parents.length, 'opiekuna', 'opiekunów', 'opiekunów')} odebrany, ${cut.codes} ${U.plural(cut.codes, 'kod rejestracyjny unieważniony', 'kody rejestracyjne unieważnione', 'kodów rejestracyjnych unieważnionych')}.` };
  }, { roles: ROLES });

  /* --- 3.5.10 duplikaty świadectw -------------------------------------------------------- */
  r.get('/api/registry/duplicates', (ctx) => ({ duplicates: ctx.db.col('duplicates').slice().sort((a, b) => (a.issuedAt < b.issuedAt ? 1 : -1)) }), { roles: ROLES });

  r.post('/api/registry/duplicates/print', (ctx) => {
    const db = ctx.db; const b = ctx.body || {}; const cfg = db.data.config;
    const ids = Array.isArray(b.studentIds) ? b.studentIds : [];
    if (!ids.length) throw httpError(400, 'Zaznacz co najmniej jedno świadectwo do powtórnego wydania.', { field: 'studentIds' });
    const decisionNo = String(b.decisionNo || '').trim();
    if (!decisionNo) throw httpError(400, 'Podaj numer decyzji administracyjnej o wydaniu duplikatu.', { field: 'decisionNo' });
    const issueDate = /^\d{4}-\d{2}-\d{2}$/.test(String(b.issueDate || '')) ? b.issueDate : D.today(db);
    const title = String(b.certificate || 'świadectwo ukończenia klasy').trim();
    const schoolYear = String(b.schoolYear || cfg.year).trim();
    const sheets = []; const created = [];
    for (const sid of ids) {
      const s = db.get('students', sid); if (!s) throw httpError(404, 'Nie ma takiego ucznia w księdze: ' + sid + '.');
      const doc = db.insert('duplicates', { id: 'dup_' + U.id().slice(0, 10), studentId: s.id, registerNo: s.registerNo, certificate: title, schoolYear, decisionNo, issuedAt: issueDate, byUserId: ctx.user.id });
      created.push(doc);
      ctx.audit({ action: 'certificate_duplicate_issued', entity: 'student', entityId: s.id, after: { decisionNo, issuedAt: issueDate, certificate: title }, reason: 'wydanie duplikatu świadectwa' });
      sheets.push(`<section style="page-break-after:always">
<h1>DUPLIKAT</h1>
<h2>${D.xmlEsc(title)} · rok szkolny ${D.xmlEsc(schoolYear)}</h2>
<p><b>${D.xmlEsc(s.lastName)} ${D.xmlEsc(s.firstName)}</b> · numer księgi uczniów ${D.xmlEsc(s.registerNo)} · ur. ${U.fmtDate(s.birthDate)} ${D.xmlEsc(s.birthPlaceLocative || ('w ' + (s.birthPlace || '')))}</p>
<table><caption>Adnotacja o wydaniu duplikatu</caption><tbody>
<tr><th scope="row">Adnotacja</th><td><b>Duplikat</b> · data wydania duplikatu <b>${U.fmtDate(issueDate)}</b> · decyzja administracyjna nr <b>${D.xmlEsc(decisionNo)}</b></td></tr>
<tr><th scope="row">Podstawa</th><td>Duplikat wydany w miejsce oryginału; oryginał zachowuje moc dokumentu urzędowego.</td></tr>
<tr><th scope="row">Wydał</th><td>${D.xmlEsc(D.userLabel(ctx.user))} · sekretariat</td></tr>
</tbody></table>
<div class="sign"><span>Sekretariat</span><span>Dyrektor szkoły</span></div>
</section>`);
    }
    const html = D.printHtml(`Duplikaty świadectw · decyzja ${decisionNo}`, sheets.join('\n'), {
      school: cfg.school.name, schoolMeta: cfg.school.address + ' · RSPO ' + cfg.school.rspo,
      docNo: 'Decyzja nr ' + decisionNo, date: U.fmtDate(issueDate), printed: U.fmtDate(D.today(db)), page: `Arkuszy: ${sheets.length}`
    });
    if (b.json) return { ok: true, duplicates: created, html, count: created.length };
    return sendHtml(ctx, html);
  }, { roles: ROLES });

  /* --- 3.5.14 rejestr obwodowy: przygotowanie przedszkolne ------------------------------- */
  r.get('/api/registry/district', (ctx) => {
    const rows = ctx.db.col('districtChildren');
    const reported = rows.filter((c) => c.reported).length;
    const stats = { total: rows.length, reported, missing: rows.length - reported, summoned: rows.filter((c) => c.summonedAt).length,
      completeness: rows.length ? Math.round((reported / rows.length) * 1000) / 10 : null };
    const children = rows.slice().sort((a, b) => (a.lastName + a.firstName).localeCompare(b.lastName + b.firstName, 'pl'));
    return { children, stats, comments: LC.countsFor(ctx.db, ctx.user, 'district-register', children.map((c) => c.id)) };
  }, { roles: ROLES });

  r.post('/api/registry/district/:id/report', (ctx) => {
    const db = ctx.db; const b = ctx.body || {}; const c = db.get('districtChildren', ctx.params.id);
    if (!c) throw httpError(404, 'Nie ma takiego dziecka w rejestrze obwodowym.');
    const institution = String(b.institution || '').trim() || (db.data.config.school.short + ', oddział przedszkolny');
    const before = { reported: c.reported, institution: c.institution };
    c.reported = true; c.institution = institution; c.reportedAt = D.today(db); c.reportedByUserId = ctx.user.id; c.note = String(b.note || c.note || ''); db.save();
    ctx.audit({ action: 'district_child_reported', entity: 'districtChild', entityId: c.id, before, after: { reported: true, institution }, reason: 'rejestracja realizacji przygotowania przedszkolnego' });
    const rows = db.col('districtChildren'); const reported = rows.filter((x) => x.reported).length;
    return { ok: true, child: c, stats: { total: rows.length, reported, missing: rows.length - reported, completeness: Math.round((reported / rows.length) * 1000) / 10 } };
  }, { roles: ROLES });

  r.post('/api/registry/district/:id/summon', (ctx) => {
    const db = ctx.db; const c = db.get('districtChildren', ctx.params.id);
    if (!c) throw httpError(404, 'Nie ma takiego dziecka w rejestrze obwodowym.');
    if (c.reported) throw httpError(400, 'Dziecko ma potwierdzone zgłoszenie — wezwanie nie jest potrzebne.');
    c.summonedAt = D.today(db); db.save();
    ctx.audit({ action: 'district_child_summoned', entity: 'districtChild', entityId: c.id, after: { summonedAt: c.summonedAt }, reason: 'wezwanie opiekunów do wskazania placówki' });
    return { ok: true, child: c };
  }, { roles: ROLES });
}

module.exports = { register, buildSio, makeCode, checkPesel, sendHtml, closeEnrolment, normaliseGuardians, effectiveScope, scopeEntry, admittedOn, flagsView, CODE_ALPHABET, SCOPES };
