'use strict';
/*
 * Pakiet zgodności (R4) — trzy dokumenty **generowane z działającej instancji**, nie pisane ręcznie:
 *
 *   ocena skutków (DPIA)   · deklaracja dostępności · umowa powierzenia (art. 28 RODO)
 *
 * Zasada: każdy fakt w dokumencie pochodzi z kodu albo z danych tej szkoły — spis kolekcji z licznikami
 * wierszy czytamy ze sklepu, macierz „rola → dane” z rejestru tras (`app.router.routes`) i z prawdziwych
 * wywołań `D.assertMayReadPupilRecord`, retencję z `config`, fakty kryptograficzne z `lib/crypto` (przez
 * wykonanie funkcji, nie przez opis), transport z `config.push` / `config.video` / `lib/pdf`, a wynik skanu
 * śledzenia z `routes/privacy.scanTrackers()`. To, czego kod wiedzieć nie może (imię IOD, hosting, wybrana
 * podstawa prawna), zostaje wprost oznaczone jako pole do uzupełnienia przez szkołę.
 *
 * Żaden z tych dokumentów nie jest poradą prawną — patrz docs/compliance/README.md.
 */
const fs = require('node:fs');
const path = require('node:path');
const util = require('./util');
const D = require('./domain');
const C = require('./crypto');
const auth = require('../auth');
const modules = require('../modules');
const pdf = require('./pdf');
const privacy = require('../routes/privacy');
const RET = require('../routes/retention');

const ROOT = path.join(__dirname, '..', '..');
const LOCALES = ['pl', 'en'];
const FILL_MARK = { pl: '[[ do uzupełnienia przez szkołę ]]', en: '[[ to be completed by the school ]]' };
const lc = (l) => (l === 'en' ? 'en' : 'pl');
const pick = (v, l) => (v && typeof v === 'object' && !Array.isArray(v) ? (v[lc(l)] !== undefined ? v[lc(l)] : v.pl) : v);

/* ------------------------------------------------------------------ spis kolekcji (inwentarz) ---
   Kategorie: identity (dane identyfikacyjne), learning (przebieg nauczania), attendance (frekwencja),
   support/health/safety (art. 9 RODO), communication, modules, courses, technical, reference.
   `art9: true` — kolekcja z założenia niesie dane szczególnej kategorii; `art9: 'incidental'` — może je
   nieść w polu opisowym (np. powód zwolnienia). Kolekcja nieopisana niżej trafia do spisu jako „inne”. */
const CATALOG = {
  users: { cat: 'identity', who: ['staff', 'guardians', 'pupils'], purpose: { pl: 'konta i uprawnienia (login, rola, kontakt, hasło w postaci skrótu)', en: 'accounts and permissions (login, role, contact, hashed password)' } },
  students: { cat: 'identity', who: ['pupils'], art9: 'incidental', purpose: { pl: 'księga uczniów: dane identyfikacyjne, PESEL, adres, opiekunowie; pole pomocy socjalnej', en: 'pupil register: identity, PESEL, address, guardians; social-welfare flag' } },
  sessions: { cat: 'technical', who: ['staff', 'guardians', 'pupils'], purpose: { pl: 'sesje zalogowanych kont (token, adres IP, aktywność)', en: 'signed-in sessions (token, IP address, activity)' } },
  audit: { cat: 'technical', who: ['staff', 'guardians', 'pupils'], purpose: { pl: 'rejestr zdarzeń: kto, kiedy i co zmienił (WORM)', en: 'audit log: who changed what and when (WORM)' } },
  grades: { cat: 'learning', who: ['pupils'], purpose: { pl: 'oceny cząstkowe, propozycje i oceny klasyfikacyjne', en: 'partial, proposed and final grades' } },
  descriptiveGrades: { cat: 'learning', who: ['pupils'], purpose: { pl: 'oceny opisowe klas 1–3', en: 'descriptive assessments, grades 1–3' } },
  behaviorGrades: { cat: 'learning', who: ['pupils'], purpose: { pl: 'oceny zachowania', en: 'behaviour grades' } },
  remarks: { cat: 'learning', who: ['pupils'], purpose: { pl: 'uwagi i pochwały', en: 'remarks and commendations' } },
  homework: { cat: 'learning', who: ['pupils'], purpose: { pl: 'zadania domowe', en: 'homework assignments' } },
  homeworkSubmissions: { cat: 'learning', who: ['pupils'], purpose: { pl: 'prace oddane przez uczniów wraz z załącznikami', en: 'work submitted by pupils, with attachments' } },
  tests: { cat: 'learning', who: ['pupils'], purpose: { pl: 'zapowiedzi sprawdzianów i kartkówek', en: 'announced tests' } },
  lessons: { cat: 'learning', who: ['staff'], purpose: { pl: 'tematy lekcji i ich realizacja', en: 'lesson topics and delivery' } },
  attendance: { cat: 'attendance', who: ['pupils'], purpose: { pl: 'frekwencja: jeden wiersz na ucznia i lekcję', en: 'attendance: one row per pupil per lesson' } },
  excuses: { cat: 'attendance', who: ['pupils', 'guardians'], art9: 'incidental', purpose: { pl: 'usprawiedliwienia — powód bywa informacją o zdrowiu', en: 'absence excuses — the reason can be health information' } },
  attendanceAlerts: { cat: 'attendance', who: ['pupils'], purpose: { pl: 'alerty o nieobecności na pierwszej lekcji', en: 'first-period absence alerts' } },
  supportDocuments: { cat: 'support', who: ['pupils'], art9: true, purpose: { pl: 'dokumentacja pomocy psychologiczno-pedagogicznej (opinie, orzeczenia)', en: 'psychological and pedagogical support documentation (opinions, rulings)' } },
  supportSessions: { cat: 'support', who: ['pupils'], art9: true, purpose: { pl: 'zajęcia i konsultacje specjalistów', en: 'specialist sessions and consultations' } },
  speechSessions: { cat: 'support', who: ['pupils'], art9: true, purpose: { pl: 'zajęcia logopedyczne', en: 'speech-therapy sessions' } },
  supportEvaluations: { cat: 'support', who: ['pupils'], art9: true, purpose: { pl: 'oceny efektywności pomocy', en: 'evaluations of support effectiveness' } },
  communityInterviews: { cat: 'support', who: ['pupils', 'guardians'], art9: true, purpose: { pl: 'wywiady środowiskowe', en: 'home/community interviews' } },
  wopfu: { cat: 'support', who: ['pupils'], art9: true, purpose: { pl: 'wielospecjalistyczna ocena poziomu funkcjonowania ucznia', en: 'multi-specialist assessment of the pupil’s functioning' } },
  ipet: { cat: 'support', who: ['pupils'], art9: true, purpose: { pl: 'indywidualny program edukacyjno-terapeutyczny', en: 'individual educational and therapeutic programme' } },
  ipetImplementations: { cat: 'support', who: ['pupils'], art9: true, purpose: { pl: 'realizacja IPET', en: 'IPET delivery records' } },
  confidentialNotes: { cat: 'support', who: ['pupils'], art9: true, purpose: { pl: 'notatki poufne specjalistów — przechowywane w postaci zaszyfrowanej', en: 'specialists’ confidential notes — stored encrypted' } },
  incidents: { cat: 'safety', who: ['pupils'], art9: true, purpose: { pl: 'rejestr zdarzeń i interwencji (Niebieska Karta, sąd rodzinny)', en: 'register of incidents and interventions' } },
  nurseVisits: { cat: 'health', who: ['pupils'], art9: true, purpose: { pl: 'gabinet profilaktyki zdrowotnej: wizyty i udzielona pomoc', en: 'school nurse: visits and aid given' } },
  nurseVisitAccessLog: { cat: 'health', who: ['pupils', 'staff'], art9: true, purpose: { pl: 'rejestr wglądów do dokumentacji gabinetu', en: 'access log for nurse records' } },
  messages: { cat: 'communication', who: ['staff', 'guardians', 'pupils'], art9: 'incidental', purpose: { pl: 'wiadomości w dzienniku, także oznaczone jako poufne', en: 'in-app messages, including ones marked confidential' } },
  notifications: { cat: 'communication', who: ['staff', 'guardians', 'pupils'], purpose: { pl: 'powiadomienia w dzienniku', en: 'in-app notifications' } },
  announcements: { cat: 'communication', who: ['staff', 'guardians', 'pupils'], purpose: { pl: 'ogłoszenia szkoły i potwierdzenia odbioru', en: 'school announcements and acknowledgements' } },
  pushSubscriptions: { cat: 'communication', who: ['staff', 'guardians', 'pupils'], purpose: { pl: 'subskrypcje push: identyfikator urządzenia i klucze przeglądarki', en: 'push subscriptions: device endpoint and browser keys' } },
  pushDeliveries: { cat: 'communication', who: ['staff', 'guardians', 'pupils'], purpose: { pl: 'dziennik doręczeń push (status, bez treści)', en: 'push delivery log (status only, no content)' } },
  trips: { cat: 'modules', who: ['pupils', 'guardians'], purpose: { pl: 'karty wycieczek, zgody opiekunów, ubezpieczenie', en: 'trip cards, guardian consents, insurance' } },
  careCheckins: { cat: 'modules', who: ['pupils'], purpose: { pl: 'świetlica: wejścia', en: 'after-school care: check-ins' } },
  carePickups: { cat: 'modules', who: ['pupils', 'guardians'], purpose: { pl: 'świetlica: wydania dziecka', en: 'after-school care: hand-overs' } },
  careAuthorizedPickups: { cat: 'modules', who: ['guardians'], purpose: { pl: 'osoby upoważnione do odbioru dziecka', en: 'people authorised to collect a child' } },
  cafeteriaAccounts: { cat: 'modules', who: ['pupils', 'guardians'], purpose: { pl: 'konta stołówkowe i salda', en: 'cafeteria accounts and balances' } },
  payments: { cat: 'modules', who: ['guardians'], purpose: { pl: 'zapisane wpłaty (system niczego nie rozlicza ani nie przetwarza płatności)', en: 'recorded payments (the system neither settles nor processes payments)' } },
  libraryLoans: { cat: 'modules', who: ['pupils'], purpose: { pl: 'wypożyczenia biblioteczne', en: 'library loans' } },
  meetings: { cat: 'modules', who: ['staff', 'guardians'], purpose: { pl: 'spotkania i konsultacje, także wideo', en: 'meetings and consultations, including video' } },
  meetingAttendance: { cat: 'modules', who: ['staff', 'guardians'], purpose: { pl: 'obecność na spotkaniach', en: 'meeting attendance' } },
  courseEnrollments: { cat: 'courses', who: ['pupils'], purpose: { pl: 'zapisy na kursy', en: 'course enrolments' } },
  courseProgress: { cat: 'courses', who: ['pupils'], purpose: { pl: 'postęp w kursie', en: 'course progress' } },
  quizAttempts: { cat: 'courses', who: ['pupils'], purpose: { pl: 'podejścia do testów w kursie', en: 'quiz attempts' } },
  coursePosts: { cat: 'courses', who: ['pupils', 'staff'], purpose: { pl: 'wpisy w dyskusjach kursu', en: 'course discussion posts' } },
  archives: { cat: 'technical', who: ['pupils'], purpose: { pl: 'roczne pakiety archiwalne z pieczęcią elektroniczną', en: 'year-end archive packages with an electronic seal' } },
  retentionRuns: { cat: 'technical', who: [], purpose: { pl: 'protokoły brakowania', en: 'retention (culling) protocols' } },
  logComments: { cat: 'technical', who: ['staff', 'guardians', 'pupils'], purpose: { pl: 'komentarze i notatki prywatne do wpisów dzienników i rejestrów (dzielą los wpisu)', en: 'comments and private notes on log and register entries (follow the entry)' } },
  registrationCodes: { cat: 'identity', who: ['guardians', 'pupils'], purpose: { pl: 'kody rejestracyjne kont', en: 'account registration codes' } },
  districtChildren: { cat: 'identity', who: ['pupils'], purpose: { pl: 'dzieci z obwodu szkoły (obowiązek szkolny)', en: 'children in the school’s catchment area' } },
  duplicates: { cat: 'identity', who: ['pupils'], purpose: { pl: 'wnioski o duplikaty dokumentów', en: 'requests for duplicate documents' } },
  reportCardHistory: { cat: 'learning', who: ['pupils'], purpose: { pl: 'historia wydanych świadectw', en: 'history of issued certificates' } },
  feedback: { cat: 'technical', who: ['staff', 'guardians', 'pupils'], purpose: { pl: 'opinie zbierane w trybie demonstracyjnym', en: 'feedback collected in demo mode' } },
  pushKeys: { cat: 'technical', who: [], purpose: { pl: 'para kluczy VAPID szkoły (osobna kolekcja, nie trafia do klienta)', en: 'the school’s VAPID key pair (kept out of the client payload)' } },
};
/* Kolekcje słownikowe — bez danych osobowych. */
const REFERENCE = ['subjects', 'classes', 'groups', 'timetable', 'gradeCategories', 'curriculum', 'phraseBank', 'developmentAreas', 'developmentalAreas', 'libraryItems', 'materials', 'courses', 'courseUnits', 'courseItems', 'courseThreads', 'lessonTimes', 'duties', 'otherActivities', 'consultationSlots', 'semesterLocks', 'daysOff', 'studentIds', 'documents', 'receipts', 'cafeteriaCancellations', 'reportRequests', 'substitutions', 'videoMeetings'];
const CAT_LABEL = {
  identity: { pl: 'dane identyfikacyjne', en: 'identification data' },
  learning: { pl: 'przebieg nauczania', en: 'learning record' },
  attendance: { pl: 'frekwencja', en: 'attendance' },
  support: { pl: 'pomoc psychologiczno-pedagogiczna (art. 9)', en: 'psychological and pedagogical support (art. 9)' },
  health: { pl: 'zdrowie (art. 9)', en: 'health (art. 9)' },
  safety: { pl: 'bezpieczeństwo i interwencje (art. 9)', en: 'safety and interventions (art. 9)' },
  communication: { pl: 'komunikacja', en: 'communication' },
  modules: { pl: 'moduły szkolne', en: 'school modules' },
  courses: { pl: 'kursy i materiały', en: 'courses and materials' },
  technical: { pl: 'dane techniczne', en: 'technical data' },
  reference: { pl: 'dane słownikowe (bez danych osobowych)', en: 'reference data (no personal data)' },
  other: { pl: 'inne', en: 'other' },
};
const WHO_LABEL = {
  pupils: { pl: 'uczniowie', en: 'pupils' },
  guardians: { pl: 'rodzice i opiekunowie', en: 'parents and guardians' },
  staff: { pl: 'pracownicy szkoły', en: 'school staff' },
};

/**
 * Które zbiory niosą dane szczególnych kategorii — **odczytane z tabeli klas dokumentacji**
 * (`config.retention`, pakiet R5), a nie z listy pisanej ręcznie obok. Lista w kodzie rozjechała się
 * z rzeczywistością w obie strony naraz: wymieniała `healthVisits`, kolekcję, której nie ma (a którą
 * `db.col()` tworzyło pustą w chwili sprawdzania), i pomijała kolekcje, które art. 9 niosą naprawdę.
 * Tabela klas jest tym, co szkoła utrzymuje i potwierdza własnym JRWA, więc to ona rozstrzyga (D3-29).
 */
function article9Collections(db) {
  const out = new Set();
  try { for (const c of RET.policy(db).classes) if (c.article9) for (const col of c.collections || []) out.add(col); }
  catch (e) { for (const [name, meta] of Object.entries(CATALOG)) if (meta.art9 === true) out.add(name); }
  return out;
}
/** Spis kolekcji tej instancji z licznikami wierszy — czytany ze sklepu, nie z listy w kodzie. */
function inventory(db) {
  const out = [];
  const art9 = article9Collections(db);
  for (const name of Object.keys(db.data)) {
    const val = db.data[name];
    if (!Array.isArray(val)) continue;
    const meta = CATALOG[name] || (REFERENCE.includes(name) ? { cat: 'reference', who: [] } : null);
    out.push({
      collection: name,
      rows: val.length,
      category: meta ? meta.cat : 'other',
      art9: art9.has(name) ? true : (meta && meta.art9 === 'incidental' ? 'incidental' : false),
      personal: meta ? (meta.cat !== 'reference' && (meta.who || []).length > 0) : true,
      who: (meta && meta.who) || [],
      purpose: (meta && meta.purpose) || { pl: 'kolekcja bez opisu w katalogu zgodności — do opisania przy przeglądzie', en: 'collection not yet described in the compliance catalogue — to be described at the next review' },
    });
  }
  return out.sort((a, b) => (a.collection < b.collection ? -1 : 1));
}

/* ------------------------------------------------------------------ macierz „rola → dane” ---------
   Dwa niezależne źródła, oba odczytane z kodu w czasie generowania dokumentu:
   (1) rejestr tras — ile i jakich punktów API rola w ogóle może wywołać, w rozbiciu na moduły;
   (2) prawdziwe wywołania `D.assertMayReadPupilRecord` na kontach z tej instalacji — co rola
       naprawdę przeczyta z karty ucznia i z jakim powodem odmowy. */
const ALL_ROLES = ['teacher', 'principal', 'counselor', 'psychologist', 'specialEducator', 'speechTherapist', 'supportTeacher', 'registrar', 'admin', 'student', 'parent', 'careEducator', 'cafeteria', 'librarian', 'nurse', 'dpo'];

function expandRoles(list) {
  const out = [];
  for (const x of list || []) {
    if (x === 'staff') out.push(...auth.STAFF);
    else if (x === 'gradeEditors') out.push(...auth.GRADE_EDITORS);
    else out.push(x);
  }
  return out;
}
function routeAllows(route, role, homeroom) {
  if (route.opts.public) return true;
  const roles = route.opts.roles;
  if (!roles || !roles.length) return true;
  const ex = expandRoles(roles);
  return ex.includes(role) || (roles.includes('homeroom') && homeroom);
}
/** Przykładowe konto tej instalacji dla danej roli (albo konto syntetyczne, gdy szkoła takiego nie ma). */
function sampleUser(db, role) {
  const users = db.col('users');
  const real = users.find((u) => u.role === role && !u.erased && !u.blocked) || users.find((u) => u.role === role);
  if (real) return Object.assign({}, real, { __real: true });
  return { id: 'probe_' + role, role, login: null, childrenIds: [], firstName: '?', lastName: '?', __real: false };
}
/** Uczeń „w zasięgu” danego konta i uczeń spoza zasięgu — do pokazania obu stron reguły. */
function samplePupils(db, user) {
  const students = db.col('students').filter((s) => !s.erased);
  if (!students.length) return { own: null, other: null };
  let own = null;
  if (user.role === 'student') own = students.find((s) => s.id === user.studentId) || null;
  else if (user.role === 'parent') own = students.find((s) => (user.childrenIds || []).includes(s.id)) || null;
  else if (user.role === 'teacher') own = students.find((s) => D.teachesPupil(db, user, s.id)) || null;
  if (!own) own = students[0];
  let other = null;
  if (user.role === 'teacher') other = students.find((s) => !D.teachesPupil(db, user, s.id)) || null;
  else other = students.find((s) => s.id !== own.id) || null;
  return { own, other };
}
function probeKind(db, user, studentId, kind) {
  if (!studentId) return { allowed: false, deny: 'no_sample' };
  try { D.assertMayReadPupilRecord(db, user, studentId, kind); return { allowed: true, deny: null }; }
  catch (e) { return { allowed: false, deny: (e.extra && e.extra.deny) || (e.extra && e.extra.code) || 'forbidden' }; }
}
/** Nieidentyfikujące oznaczenie ucznia użytego do sprawdzenia reguły (oddział + numer w dzienniku). */
function pupilRef(s) { return s ? { classId: s.classId || '—', rollNo: s.rollNo != null ? s.rollNo : null } : null; }
/* S3-01 — macierz opisuje REGUŁĘ, więc nie ma w niej ani ucznia z imienia, ani loginu pracownika.
   Wcześniej każdy wiersz niósł `sampleLogin` prawdziwego konta tej roli, a cała macierz jechała
   publiczną trasą deklaracji przy `facts=1`: gotowa lista kont szkoły dla kogoś z internetu.
   Zostaje sama informacja, czy szkoła w ogóle ma konto tej roli — tyle DPIA potrzebuje. */
const ROLE_PRESENT = { pl: { yes: 'konto tej roli istnieje', no: 'brak konta tej roli' }, en: { yes: 'an account of this role exists', no: 'no account of this role' } };
function roleMatrix(db, app) {
  const routes = app && app.router ? app.router.routes : [];
  const rows = [];
  for (const role of ALL_ROLES) {
    const user = sampleUser(db, role);
    const homeroom = !!user.homeroomOf;
    const allowed = routes.filter((r) => routeAllows(r, role, homeroom));
    const byModule = {};
    for (const r of allowed) byModule[r.module || 'core'] = (byModule[r.module || 'core'] || 0) + 1;
    const { own, other } = samplePupils(db, user);
    const kinds = {};
    for (const k of D.RECORD_KINDS) kinds[k] = probeKind(db, user, own && own.id, k);
    const otherPupil = other ? Object.fromEntries(D.RECORD_KINDS.map((k) => [k, probeKind(db, user, other.id, k)])) : null;
    rows.push({
      role, hasAccount: !!user.__real, homeroom,
      endpoints: allowed.length, writes: allowed.filter((r) => r.method !== 'GET').length,
      modules: byModule, kinds, otherPupil,
      /* Uczeń w macierzy nie jest nazwany: dokument opisuje regułę, a nie konkretne dziecko. */
      samplePupil: pupilRef(own),
      otherPupilLabel: pupilRef(other),
    });
  }
  return rows;
}

/* ------------------------------------------------------------------ retencja ---------------------- */
function retention(db) {
  const c = db.data.config || {};
  const rows = [];
  const add = (key, value, unit, note) => rows.push({ key, value, unit, note });
  /* Tabela klas dokumentacji jest jednostką retencji; poniższe ustawienia skalarne zostają, bo
     sterują sprzątaniem dzienników technicznych. Czytamy ją przez `RET.policy(db)`, a nie wprost
     z `config.retention`: to `policy()` scala tabelę domyślną z tym, co szkoła zmieniła, i to ono
     wie o klasach wycofanych i o migracji. Jedno źródło dla operacji i dla dokumentu. */
  let r = null;
  try { r = RET.policy(db); } catch (e) { r = c.retention && typeof c.retention === 'object' && !Array.isArray(c.retention) ? c.retention : null; }
  const classes = (r && Array.isArray(r.classes) ? r.classes : []).map((x) => ({
    class: x.class || '—',
    label: x.label || x.class || '—',
    category: x.category || '—',
    period: x.years != null ? String(x.years) : (x.days != null ? String(x.days) : '—'),
    periodUnit: x.years != null ? { pl: 'lat', en: 'years' } : (x.days != null ? { pl: 'dni', en: 'days' } : { pl: 'wieczyście', en: 'permanent' }),
    clock: x.clock || '—',
    kind: x.kind || '—',
    collections: Array.isArray(x.collections) ? x.collections : [],
    verified: x.verified === true,
    article9: !!x.article9,
    erasure: x.erasure || '—',
    legalBasis: x.legalBasis || '—',
  }));
  /* „Ile zbiorów tej instancji nie należy do żadnej klasy” — liczba, którą raport domenowy wskazał
     jako niewidoczną: 46 kolekcji było poza retencją i nic tego nie pokazywało (D3-13). */
  let coverage = null;
  try {
    const all = RET.classifyAll(db);
    coverage = { collections: all.length, covered: all.filter((x) => !x.uncovered).length, uncovered: all.filter((x) => x.uncovered).map((x) => x.collection) };
  } catch (e) { coverage = null; }
  if (r) {
    if (r.version != null) add('retention.version', String(r.version), '', { pl: 'wersja tabeli klas dokumentacji', en: 'version of the documentation-class table' });
    add('retention.jrwaVerified', r.jrwaVerified === true ? 'true' : 'false', '', { pl: 'czy szkoła potwierdziła tabelę własnym JRWA', en: 'whether the school has confirmed the table against its own retention schedule' });
  }
  add('logRetentionYears', String(c.logRetentionYears != null ? c.logRetentionYears : 5), { pl: 'lat', en: 'years' }, { pl: 'rejestr zdarzeń; brakowanie całymi rocznikami przez /api/admin/retention/run', en: 'audit log; culled whole years through /api/admin/retention/run' });
  add('logRetentionMinYears', String(c.logRetentionMinYears != null ? c.logRetentionMinYears : 5), { pl: 'lat', en: 'years' }, { pl: 'minimum, poniżej którego polityki ustawić się nie da', en: 'floor the policy cannot go below' });
  add('gradesArchiveRetentionYears', String(c.gradesArchiveRetentionYears != null ? c.gradesArchiveRetentionYears : 50), { pl: 'lat', en: 'years' }, { pl: 'arkusze ocen (kategoria archiwalna B50)', en: 'grade sheets (archive category B50)' });
  add('gradesArchiveRetentionMinYears', String(c.gradesArchiveRetentionMinYears != null ? c.gradesArchiveRetentionMinYears : 50), { pl: 'lat', en: 'years' }, { pl: 'minimum ustawowe', en: 'statutory floor' });
  add('sessionRetentionDays', String(c.sessionRetentionDays != null ? c.sessionRetentionDays : 90), { pl: 'dni', en: 'days' }, { pl: 'sesje techniczne (nie są dokumentacją przebiegu nauczania)', en: 'technical sessions (not documentation of the course of teaching)' });
  const w = c.archiveWindow || {};
  add('archiveWindow', (w.from || '—') + ' … ' + (w.to || '—'), { pl: 'termin', en: 'window' }, w.basis ? { pl: String(w.basis), en: String(w.basis) } : { pl: 'pakiet archiwalny po zakończeniu roku', en: 'archive package after the school year ends' });
  return {
    rows, classes, coverage,
    erasurePolicy: (() => { try { return privacy.describeErasure(db); } catch (e) { return null; } })(),
    jrwaVerified: !!(r && r.jrwaVerified === true),
    jrwaNote: (r && r.note) || '',
    culling: { pl: 'Brakowanie nigdy nie usuwa pojedynczego wpisu: znika cały rocznik starszy niż polityka, zawsze na polecenie administratora, zawsze z protokołem w kolekcji retentionRuns i wpisem audytowym.', en: 'Culling never deletes a single entry: a whole year older than the policy goes, always on an administrator’s command, always with a protocol row in retentionRuns and an audit entry.' },
    /* D3-29 — to zdanie było nieprawdziwe: obiecywało, że „dane osobowe znikają z kolekcji”, podczas
       gdy lista w kodzie wymieniała trzy nieistniejące zbiory i pomijała wszystkie zbiory art. 9,
       a arkusze ocen (B50) i księgę uczniów kasowała na wylot. Nie opisujemy więc usuwania z pamięci:
       czytamy je z `routes/privacy.describeErasure(db)`, czyli z tego samego miejsca, z którego
       bierze je sama operacja. Dokument nie ma jak się rozjechać z kodem, bo to jest ten sam kod. */
    erasure: erasureSentence(db),
  };
}
/** Jedno zdanie o art. 17 — złożone z prawdziwej tabeli klas, nie z pamięci autora dokumentu. */
function erasureSentence(db) {
  let e = null;
  try { e = privacy.describeErasure(db); } catch (err) { e = null; }
  if (!e) return { pl: 'Żądanie usunięcia danych (art. 17 RODO) obsługuje POST /api/privacy/forget; zakres operacji opisuje GET /api/privacy/erasure-policy.', en: 'An erasure request (art. 17 GDPR) is served by POST /api/privacy/forget; what it does is described by GET /api/privacy/erasure-policy.' };
  const names = (list) => (list && list.length ? list.map((c) => c.label || c.class).join(', ') : null);
  const anon = names(e.anonymised), del = names(e.deleted), unl = names(e.unlinked), keep = names(e.neverTouched);
  const pl = ['Żądanie usunięcia danych (art. 17 RODO) obsługuje POST /api/privacy/forget, a o tym, co się stanie z danym zbiorem, decyduje jego klasa dokumentacji, nie lista w kodzie.'];
  const en = ['An erasure request (art. 17 GDPR) is served by POST /api/privacy/forget, and what happens to a given collection is decided by its documentation class, not by a list in the code.'];
  if (anon) { pl.push('Anonimizowane w miejscu (pola tożsamości zastąpione pseudonimem, daty, oceny i frekwencja zostają): ' + anon + '.'); en.push('Anonymised in place (identity fields replaced with a pseudonym; dates, grades and attendance stay): ' + anon + '.'); }
  if (del) { pl.push('Usuwane: ' + del + '.'); en.push('Deleted: ' + del + '.'); }
  if (unl) { pl.push('Tracące powiązanie z osobą: ' + unl + '.'); en.push('Unlinked from the person: ' + unl + '.'); }
  if (keep) { pl.push('Nietykane, bo prawo każe je zachować: ' + keep + '.'); en.push('Left untouched, because the law requires them to be kept: ' + keep + '.'); }
  pl.push(e.audit && e.audit.note ? String(e.audit.note) : 'Rejestr zdarzeń nie jest redagowany ani usuwany.');
  en.push('The audit log is neither redacted nor deleted; the erasure protocol is itself an entry in it.');
  pl.push('Pełny opis operacji wraz z listą klas: GET /api/privacy/erasure-policy.');
  en.push('The full description, with the list of classes: GET /api/privacy/erasure-policy.');
  return { pl: pl.join(' '), en: en.join(' ') };
}

/* ------------------------------------------------------------------ środki techniczne -------------
   Fakty kryptograficzne czytamy przez wykonanie funkcji z lib/crypto, a nie przez opis w komentarzu. */
/* S3-03/R3-07 — te trzy fakty są stałymi tej kompilacji, nie danymi żądania: `hashPassword`
   naprawdę uruchamia scrypt (≈70 ms), `sealDocument` naprawdę podpisuje kluczem RSA. Za publiczną
   trasą deklaracji był to przycisk „wyłącz szkołę”: 20 żądań pod rząd zajmowało proces na 4 sekundy.
   Sondujemy je RAZ na proces (nazwa algorytmu nie zależy od tego, który klucz szkoła ma w konfiguracji
   — zależy od niej tylko przypis `note`, więc pamiętamy dwa warianty: z kluczem i bez). */
let CRYPTO_PROBE = null;
function cryptoFacts(privateKey) {
  if (!CRYPTO_PROBE) {
    let passwordAlg = 'scrypt';
    try { passwordAlg = String(C.hashPassword('r4-probe')).split('$')[0] || 'scrypt'; } catch (e) { passwordAlg = 'scrypt'; }
    let noteAlg = 'AES-256-GCM+RSA-OAEP';
    try { noteAlg = C.encryptForReaders('r4-probe', []).alg || noteAlg; } catch (e) { /* zostaje wartość domyślna */ }
    CRYPTO_PROBE = { passwordAlg, noteAlg, seal: new Map() };
  }
  const key = privateKey ? 'with-key' : 'no-key';
  if (!CRYPTO_PROBE.seal.has(key)) {
    let sealAlg = 'RSA-SHA256'; let sealNote = '';
    try { const s = C.sealDocument('r4-probe', privateKey); sealAlg = s.alg || sealAlg; sealNote = s.note || ''; } catch (e) { sealNote = ''; }
    CRYPTO_PROBE.seal.set(key, { sealAlg, sealNote });
  }
  const seal = CRYPTO_PROBE.seal.get(key);
  return { passwordAlg: CRYPTO_PROBE.passwordAlg, noteAlg: CRYPTO_PROBE.noteAlg, sealAlg: seal.sealAlg, sealNote: seal.sealNote };
}
/* Skan `public/` czyta i przeszukuje regexami każdy plik statyczny, w tym megabajtowy bundle (≈100 ms).
   `public/` nie zmienia się bez wdrożenia, więc wynik zostaje na czas życia procesu.
   D3-28: politykę CSP bierzemy z budowniczego w `server/index.js` (app.contentSecurityPolicy),
   a nie z regexa po źródle tego pliku — tamten wariant wsypywał do DPIA trzy kilobajty kodu serwera. */
let TRACKER_SCAN = null;
function trackerScan(app) {
  if (!TRACKER_SCAN) TRACKER_SCAN = privacy.scanTrackers(app);
  const csp = app && typeof app.contentSecurityPolicy === 'function' ? app.contentSecurityPolicy() : (TRACKER_SCAN.csp || '');
  return Object.assign({}, TRACKER_SCAN, { csp });
}
function security(db) {
  const c = db.data.config || {};
  const { passwordAlg: pwAlg, noteAlg, sealAlg, sealNote } = cryptoFacts(c.schoolPrivateKey);
  const encryptedNotes = db.col('confidentialNotes').filter((n) => n && n.envelope).length;
  const keyHolders = db.col('users').filter((u) => u.publicKey).length;
  return {
    passwordAlg: pwAlg,
    passwordPolicy: C.PASSWORD_POLICY,
    noteAlg, encryptedNotes, keyHolders,
    sealAlg, sealNote,
    sessionTimeoutMin: c.sessionTimeoutMin != null ? c.sessionTimeoutMin : 15,
    twoFactorForGradeEditors: c.require2FAForGradeEditors === true,
    ipAllowlist: Array.isArray(c.ipAllowlist) && c.ipAllowlist.length > 0,
    auditImmutable: c.auditImmutable !== false,
    auditRows: db.col('audit').length,
    atRest: { pl: 'Magazyn to pliki JSON w katalogu danych (docs/STORAGE.md); szyfrowanie nośnika należy do hostującego.', en: 'The store is JSON files in the data directory (docs/STORAGE.md); disk encryption belongs to the host.' },
  };
}

/* ------------------------------------------------------------------ transport i podprocesorzy ------ */
const DOMAIN_RE = /^(?=.{1,253}$)([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,}$/i;
/** Ten sam test, którym server/index.js decyduje o jedynym zewnętrznym źródle w CSP. */
function videoHost(db) {
  const v = (db.data.config && db.data.config.video) || {};
  const d = String(process.env.EDMAT_JITSI_DOMAIN || (v.jitsi && v.jitsi.domain) || '').trim();
  if (v.provider && v.provider !== 'jitsi') return null;
  if (!d || !DOMAIN_RE.test(d)) return null;
  return d;
}
function transports(db) {
  const c = db.data.config || {};
  const push = c.push || {};
  const keys = (db.data.pushKeys || []).length;
  const pushOn = push.enabled === true && keys > 0;
  const host = videoHost(db);
  let chrome = null;
  try { chrome = pdf.chromePath(); } catch (e) { chrome = null; }
  return {
    push: { enabled: pushOn, configured: push.enabled === true, keys, subscriptions: db.col('pushSubscriptions').length, kinds: Array.isArray(push.kinds) ? push.kinds.length : null },
    video: { provider: c.video ? (c.video.provider || 'jitsi') : 'jitsi', configured: !!host, host: host || null, recordingConsentRequired: !!(c.video && c.video.recordingConsentRequired), storedAt: (c.video && c.video.storedAt) || 'school-server' },
    pdf: { mode: 'local', chrome: !!chrome },
    mail: false, sms: false,
    sio: { mode: 'file', namespace: (c.sio && c.sio.namespace) || '—' },
  };
}
function subProcessors(db) {
  const t = transports(db);
  const list = [];
  if (t.push.enabled) list.push({ who: { pl: 'usługa push producenta przeglądarki (Google FCM, Mozilla autopush, Apple APNs)', en: 'the browser vendor’s push service (Google FCM, Mozilla autopush, Apple APNs)' }, what: { pl: 'doręczenie zaszyfrowanego ładunku na urządzenie; widzi metadane, nie widzi treści (docs/PUSH.md)', en: 'delivery of an encrypted payload to the device; sees metadata, not content (docs/PUSH.md)' } });
  if (t.video.configured) list.push({ who: { pl: 'operator serwera wideo ' + t.video.host, en: 'operator of the video server ' + t.video.host }, what: { pl: 'zestawianie spotkań wideo; gdy serwer prowadzi szkoła albo gmina, nie ma tu osobnego podmiotu przetwarzającego', en: 'hosting video meetings; when the school or the municipality runs the server there is no separate processor here' } });
  return list;
}

/* ------------------------------------------------------------------ dostępność --------------------
   Co jest naprawdę sprawdzane, wyczytane z tests/39-nonfunctional.test.js: bierzemy tylko te pozycje,
   których identyfikator historyjki w tym pliku istnieje. Reszta trafia na listę „nie zbadano”. */
const A11Y_TESTED = [
  { id: '3.9.1', wcag: '1.3.1, 2.4.6, 4.1.2', what: { pl: 'jeden nagłówek h1 na ekran, etykiety ARIA, odnośnik „przejdź do treści”, a w wydrukach serwera nagłówki tabel ze scope i podpisem caption', en: 'one h1 per screen, ARIA labels, a skip link, and server printouts whose tables carry captions and th scope' } },
  { id: '3.9.2', wcag: '1.4.4, 1.4.10, 1.4.12', what: { pl: 'skala typografii wyłącznie w rem, brak sztywnych szerokości, motyw wysokiego kontrastu i ciemny, 200 % tekstu bez przewijania w poziomie mierzone w przeglądarce przy 390 px', en: 'typography in rem only, no hard pixel widths, high-contrast and dark themes, 200 % text with no horizontal scrolling measured in a real browser at 390 px' } },
  { id: '3.9.3', wcag: '2.1.1, 2.4.3, 2.4.7', what: { pl: 'obsługa z klawiatury (skróty, zapis Ctrl+S, nawigacja Alt+cyfra) i widoczny pierścień fokusu policzony w przeglądarce', en: 'keyboard operation (shortcuts, Ctrl+S save, Alt+digit navigation) and a focus ring measured in a real browser' } },
  { id: '3.9.4', wcag: '1.2.2, 1.2.3', what: { pl: 'napisy WebVTT po polsku i transkrypcja tekstowa filmu instruktażowego, bez zewnętrznego serwisu wideo', en: 'Polish WebVTT captions and a text transcript for the tutorial video, with no external video service' } },
  { id: '3.9.8', wcag: '—', what: { pl: 'brak bibliotek śledzących i zasobów spoza serwera szkoły (skan public/ i CSP)', en: 'no tracker libraries and no resources from outside the school’s server (scan of public/ and the CSP)' } },
  { id: '3.9.10', wcag: '1.4.10', what: { pl: 'układ responsywny na telefonie 360 px i niezablokowane powiększanie strony', en: 'responsive layout at 360 px and page zoom that is not blocked' } },
];
const A11Y_UNTESTED = [
  { wcag: '1.1.1', what: { pl: 'teksty alternatywne obrazów', en: 'text alternatives for images' }, why: { pl: 'interfejs nie zawiera obrazów niosących treść (ikony są dekoracyjne albo opisane tekstem), więc nie ma testu, który by tego pilnował przy nowych ekranach', en: 'the interface carries no informative images (icons are decorative or accompanied by text), so nothing guards this for new screens' } },
  { wcag: '1.2.5', what: { pl: 'audiodeskrypcja nagrań', en: 'audio description for recordings' }, why: { pl: 'film instruktażowy ma napisy i transkrypcję, ale nie audiodeskrypcję', en: 'the tutorial video has captions and a transcript, but no audio description' } },
  { wcag: '1.4.3 / 1.4.11', what: { pl: 'zmierzony współczynnik kontrastu tekstu i elementów nietekstowych', en: 'measured contrast ratio of text and non-text elements' }, why: { pl: 'kontrast wynika z tokenów systemu projektowego i był sprawdzany przy ich powstaniu; w testach aplikacji nie ma automatycznego pomiaru (brak axe-core przy zasadzie zera zależności)', en: 'contrast comes from the design-system tokens and was checked when they were made; the application tests contain no automated measurement (no axe-core, by the zero-dependency rule)' } },
  { wcag: '2.1.4', what: { pl: 'skróty jednoznakowe (A, N, S, Z, U przy frekwencji)', en: 'single-character shortcuts (A, N, S, Z, U in the attendance roster)' }, why: { pl: 'działają tylko w kontekście listy obecności, ale nie ma testu potwierdzającego, że da się je wyłączyć albo przemapować', en: 'they only act inside the attendance roster, but no test confirms they can be turned off or remapped' } },
  { wcag: '2.4.5', what: { pl: 'wiele dróg dotarcia do strony', en: 'multiple ways to reach a page' }, why: { pl: 'nawigacja jest jedna (pasek górny); nie ma mapy serwisu ani wyszukiwarki obejmującej wszystkie ekrany', en: 'there is one navigation (the top bar); there is no site map and no search across all screens' } },
  { wcag: '3.3.1 / 3.3.3', what: { pl: 'identyfikacja błędów w formularzach i podpowiedź naprawy', en: 'error identification in forms and suggestions for fixing them' }, why: { pl: 'komunikaty serwera są po polsku i trafiają na ekran, ale żaden test nie sprawdza powiązania komunikatu z polem (aria-describedby, aria-invalid)', en: 'server messages are in Polish and do reach the screen, but no test checks that a message is tied to its field (aria-describedby, aria-invalid)' } },
  { wcag: '4.1.3', what: { pl: 'komunikaty o stanie (aria-live)', en: 'status messages (aria-live)' }, why: { pl: 'powłoka ma obszar aria-live dla powiadomień, ale nie ma testu pokrywającego wszystkie ekrany', en: 'the shell has an aria-live region for toasts, but no test covers every screen' } },
  { wcag: '—', what: { pl: 'badanie z użytkownikami korzystającymi z czytnika ekranu (NVDA, JAWS, VoiceOver, TalkBack)', en: 'testing with users of screen readers (NVDA, JAWS, VoiceOver, TalkBack)' }, why: { pl: 'nie przeprowadzono; samoocena opiera się na testach automatycznych i przeglądzie kodu', en: 'not performed; the self-assessment rests on automated tests and code review' } },
  { wcag: '—', what: { pl: 'zewnętrzny audyt dostępności', en: 'an external accessibility audit' }, why: { pl: 'nie zlecono', en: 'not commissioned' } },
];
/* -------- H-4: „zbadane” musi znaczyć „test przeszedł”, a nie „w pliku testów jest taki napis” -----
   Deklaracja dostępności jest dokumentem ustawowym i mówi wprost, że dowodem są testy uruchamiane
   przy każdej zmianie kodu. Dotąd `tested` powstawało z `src.includes('[3.9.2]')` — grepa po źródle.
   Test, który jest czerwony, jest oznaczony `# SKIP` (co spotyka połówki `[3.9.2]`/`[3.9.3]` na
   maszynie bez Chromium) albo którego plik wysypał się w `after`, liczył się tak samo jak zielony.

   Źródłem jest teraz **zapisany wynik prawdziwego przebiegu**: lista akceptacyjna `checklist.md`.
   `scripts/checklist-status.js --write` odhacza w niej historyjkę wyłącznie wtedy, gdy test z jej
   numerem zgłosił `ok`, nie miał dyrektywy `# SKIP`/`# TODO` **i** jego plik nie zakończył się
   błędem (nagłówek tego skryptu opisuje te trzy reguły). Odhaczony kwadrat jest więc protokołem
   zielonego przebiegu, a nie napisem w kodzie. Kryterium, którego ostatni przebieg nie potwierdził,
   schodzi z listy „zbadane” na listę „bez dowodu” z podaniem powodu — deklaracja woli powiedzieć
   „nie sprawdziliśmy” niż „sprawdziliśmy”, kiedy nie ma na to protokołu. */
const CHECKLIST_FILE = path.join(ROOT, 'checklist.md');  /* was ROOT/../: the checklist sat beside the prototype, and now lives inside it (2026-09-24) */
/** `{ '3.9.2': true|false }` — stan kwadratu każdej historyjki sekcji 3.x w liście akceptacyjnej. */
function checklistState(file) {
  const out = {};
  let src = '';
  try { src = fs.readFileSync(file || CHECKLIST_FILE, 'utf8'); } catch (e) { return null; }
  let section = null, n = 0;
  for (const line of src.split('\n')) {
    const hm = /^##\s+(3\.\d+)\b/.exec(line);
    if (hm) { section = hm[1]; n = 0; continue; }
    const im = /^- \[( |x|X)\]\s/.exec(line);
    if (!im || !section) continue;
    out[`${section}.${++n}`] = im[1].toLowerCase() === 'x';
  }
  return Object.keys(out).length ? out : null;
}
function a11y(opts) {
  const o = opts || {};
  let src = '';
  try { src = fs.readFileSync(path.join(ROOT, 'tests', '39-nonfunctional.test.js'), 'utf8'); } catch (e) { src = ''; }
  const state = checklistState(o.checklistFile);
  const tested = []; const missing = []; const notGreen = [];
  for (const t of A11Y_TESTED) {
    if (!src.includes('[' + t.id + ']')) { missing.push(Object.assign({ reason: 'declared' }, t)); continue; }
    if (!state) { notGreen.push(Object.assign({}, t, { reason: 'no-run' })); continue; }
    if (state[t.id] === true) tested.push(t);
    else notGreen.push(Object.assign({}, t, { reason: state[t.id] === false ? 'not-green' : 'unknown' }));
  }
  const why = (t) => (t.reason === 'no-run'
    ? { pl: 'nie ma zapisanego wyniku przebiegu testów (lista akceptacyjna niedostępna) — dopóki go nie ma, deklaracja nie powołuje się na ten test', en: 'no recorded test run is available (the acceptance checklist could not be read) — until there is one, the statement does not cite this test' }
    : { pl: 'test istnieje, ale ostatni zapisany przebieg go nie potwierdził (nie przeszedł, był pominięty albo jego plik zakończył się błędem)', en: 'the test exists, but the last recorded run did not confirm it (it failed, was skipped, or its file ended with an error)' });
  return {
    tested,
    untested: A11Y_UNTESTED.concat(notGreen.map((t) => ({ wcag: t.wcag, what: t.what, why: why(t) }))),
    missingEvidence: missing,
    notGreen,
    evidenceFile: 'tests/39-nonfunctional.test.js',
    evidenceRun: state ? 'checklist.md' : null,
    method: {
      pl: 'samoocena podmiotu publicznego wsparta testami automatycznymi uruchamianymi przy każdej zmianie kodu (node --test tests/39-nonfunctional.test.js), w tym pomiarami w przeglądarce headless (powiększenie 200 %, pierścień fokusu, szerokość telefonu) oraz skanem zasobów zewnętrznych. Za zbadane uznaje się wyłącznie te kryteria, których test potwierdził ostatni zapisany przebieg całego zestawu (node scripts/checklist-status.js): test zgłosił „ok”, nie był pominięty i jego plik nie zakończył się błędem.',
      en: 'a self-assessment by the public body, supported by automated tests run on every code change (node --test tests/39-nonfunctional.test.js), including measurements in a headless browser (200 % zoom, focus ring, phone width) and a scan for external resources. A criterion counts as verified only when the last recorded run of the whole suite (node scripts/checklist-status.js) confirmed its test: the test reported “ok”, was not skipped, and its file did not end with an error.',
    },
  };
}

/* ------------------------------------------------------------------ wszystkie fakty razem ---------
   To jest migawka stanu instancji, a nie odczyt na żywo: dopóki w sklepie nic nie drgnęło, drugie
   wywołanie ma oddać tę samą migawkę zamiast liczyć ją jeszcze raz (S3-03, R3-07). `db.version` jest
   monotonicznym licznikiem zmian sklepu, więc wystarczy za klucz; `app` jest w kluczu, bo macierz ról
   czyta rejestr tras tej aplikacji (w testach obok siebie stoi wiele serwerów). */
const FACTS_CACHE = new WeakMap();
function facts(db, app) {
  const hit = FACTS_CACHE.get(db);
  if (hit && hit.version === db.version && hit.app === app) return hit.value;
  const value = computeFacts(db, app);
  FACTS_CACHE.set(db, { version: db.version, app, value });
  return value;
}
/** Jedyne fakty, jakich potrzebuje deklaracja dostępności — i jedyne, jakie liczy publiczna trasa. */
function accessibilityFacts(db, app) {
  const c = db.data.config || {};
  const scan = trackerScan(app);
  return {
    generatedAt: util.now(), today: D.today(db), school: c.school || {}, year: c.year || '—',
    a11y: a11y(),
    trackers: { externalResources: scan.externalResources.length },
  };
}
function computeFacts(db, app) {
  const c = db.data.config || {};
  const inv = inventory(db);
  const scan = trackerScan(app);
  return {
    generatedAt: util.now(),
    today: D.today(db),
    school: c.school || {},
    year: c.year || '—',
    timezone: D.tz(db),
    adultAccess: D.adultAccessMode ? D.adultAccessMode(db) : (c.adultAccess || 'until-objection'),
    modules: modules.list(db).map((m) => ({ id: m.id, name: m.name, enabled: m.enabled, required: !!m.required })),
    inventory: inv,
    art9: inv.filter((i) => i.art9 === true),
    art9Incidental: inv.filter((i) => i.art9 === 'incidental'),
    personalRows: inv.filter((i) => i.personal).reduce((n, i) => n + i.rows, 0),
    counts: {
      collections: inv.length, personalCollections: inv.filter((i) => i.personal).length,
      students: db.col('students').length, users: db.col('users').length,
      guardians: db.col('users').filter((u) => u.role === 'parent').length,
      staff: db.col('users').filter((u) => auth.STAFF.includes(u.role)).length,
      pupilAccounts: db.col('users').filter((u) => u.role === 'student').length,
    },
    roles: roleMatrix(db, app),
    retention: retention(db),
    security: security(db),
    transports: transports(db),
    subProcessors: subProcessors(db),
    a11y: a11y(),
    trackers: { ok: scan.ok, verdict: scan.verdict, filesScanned: scan.filesScanned, externalResources: scan.externalResources.length, trackerLibraries: scan.trackerLibraries.length, checkedAt: scan.checkedAt, csp: scan.csp || '', method: scan.method },
  };
}

/* ------------------------------------------------------------------ mały DSL dokumentu ------------ */
const S = (h, ...blocks) => ({ h, blocks: blocks.filter(Boolean).flat() });
const P = (text) => ({ p: text });
const UL = (items) => ({ ul: items.filter(Boolean) });
const TBL = (caption, head, rows) => ({ table: { caption, head, rows } });
const FILL = (label) => ({ fill: label });
const yesNo = (v, l) => (v ? (l === 'en' ? 'yes' : 'tak') : (l === 'en' ? 'no' : 'nie'));

function mdEscape(s) { return String(s === undefined || s === null ? '—' : s).replace(/\|/g, '\\|').replace(/\n+/g, ' '); }
function toMarkdown(doc, locale) {
  const l = lc(locale);
  const out = ['# ' + doc.title, ''];
  if (doc.subtitle) out.push('> ' + doc.subtitle, '');
  for (const m of doc.meta || []) out.push('- **' + m[0] + ':** ' + (m[1] === undefined || m[1] === null || m[1] === '' ? '—' : m[1]));
  if ((doc.meta || []).length) out.push('');
  for (const sec of doc.sections) {
    out.push('## ' + sec.h, '');
    for (const b of sec.blocks) {
      if (b.p) out.push(String(b.p), '');
      else if (b.ul) { for (const it of b.ul) out.push('- ' + String(it)); out.push(''); }
      else if (b.fill) out.push('- **' + String(b.fill) + ':** ' + FILL_MARK[l], '');
      else if (b.table) {
        const t = b.table;
        out.push('**' + t.caption + '**', '');
        out.push('| ' + t.head.map(mdEscape).join(' | ') + ' |');
        out.push('| ' + t.head.map(() => '---').join(' | ') + ' |');
        for (const r of t.rows) out.push('| ' + r.map(mdEscape).join(' | ') + ' |');
        out.push('');
      }
    }
  }
  out.push('---', '', doc.footer);
  return out.join('\n');
}
function toHtml(doc, locale, facts_) {
  const e = D.xmlEsc;
  const l = lc(locale);
  const body = [];
  body.push('<h1>' + e(doc.title) + '</h1>');
  if (doc.subtitle) body.push('<p class="note">' + e(doc.subtitle) + '</p>');
  if ((doc.meta || []).length) {
    body.push('<table><caption>' + e(l === 'en' ? 'Document details' : 'Metryka dokumentu') + '</caption><tbody>');
    for (const m of doc.meta) body.push('<tr><th scope="row">' + e(m[0]) + '</th><td>' + e(m[1] === undefined || m[1] === null || m[1] === '' ? '—' : m[1]) + '</td></tr>');
    body.push('</tbody></table>');
  }
  for (const sec of doc.sections) {
    body.push('<h2>' + e(sec.h) + '</h2>');
    for (const b of sec.blocks) {
      if (b.p) body.push('<p>' + e(b.p) + '</p>');
      else if (b.ul) body.push('<ul>' + b.ul.map((x) => '<li>' + e(x) + '</li>').join('') + '</ul>');
      else if (b.fill) body.push('<p><b>' + e(b.fill) + ':</b> <span class="fill">' + e(FILL_MARK[l]) + '</span></p>');
      else if (b.table) {
        const t = b.table;
        body.push('<table><caption>' + e(t.caption) + '</caption><thead><tr>' + t.head.map((x) => '<th scope="col">' + e(x) + '</th>').join('') + '</tr></thead><tbody>');
        for (const r of t.rows) body.push('<tr>' + r.map((x, i) => (i === 0 ? '<th scope="row">' + e(x === undefined || x === null ? '—' : x) + '</th>' : '<td>' + e(x === undefined || x === null ? '—' : x) + '</td>')).join('') + '</tr>');
        body.push('</tbody></table>');
      }
    }
  }
  body.push('<p class="note">' + e(doc.footer) + '</p>');
  const school = (facts_ && facts_.school) || {};
  return D.printHtml(doc.title, body.join('\n'), {
    school: school.name || 'EdMat',
    schoolMeta: [school.address, school.email, school.phone].filter(Boolean).join(' · '),
    docNo: doc.docNo || '',
    date: util.fmtDate((facts_ && facts_.today) || util.now()),
    printed: util.fmtDate(util.now()),
    gdpr: l === 'en' ? 'Generated by EdMat from the running instance. Not legal advice — see docs/compliance/README.md.' : 'Dokument wygenerowany przez EdMat z działającej instancji. Nie stanowi porady prawnej — patrz docs/compliance/README.md.',
    css: '.fill{background:#ffe9a8;padding:0 2pt;font-weight:600}',
  });
}

/* ---- wspólny widok art. 17: tabela „klasa → co się z nią dzieje”, złożona z `describeErasure` ----
   Dokument nie opowiada o usuwaniu własnymi słowami; wypisuje to, co zwraca ta sama funkcja, z której
   korzysta `POST /api/privacy/forget`. Prawdziwe zdanie brzmi „dokumentacja archiwalna jest
   anonimizowana w miejscu, a nie usuwana, a rejestr zdarzeń nie jest ruszany” — i tak ma brzmieć
   w DPIA i w umowie powierzenia (D3-29). */
const ERASURE_ACTION = {
  anonymised: { pl: 'anonimizacja w miejscu (pola tożsamości → pseudonim; daty, oceny i frekwencja zostają)', en: 'anonymised in place (identity fields → a pseudonym; dates, grades and attendance stay)' },
  deleted: { pl: 'usunięcie wierszy', en: 'rows deleted' },
  unlinked: { pl: 'zerwanie powiązania z osobą (wiersz zostaje, osoba znika)', en: 'unlinked from the person (the row stays, the person goes)' },
  neverTouched: { pl: 'nietykane — prawo każe zachować', en: 'left untouched — the law requires them to be kept' },
};
function erasureBlocks(f, l) {
  const pl = l === 'pl'; const e = f.retention.erasurePolicy;
  if (!e) return [];
  const rows = [];
  for (const group of ['anonymised', 'deleted', 'unlinked', 'neverTouched']) {
    for (const c of e[group] || []) {
      rows.push([c.label || c.class, pick(ERASURE_ACTION[group], l),
        c.category || '—', c.article9 ? (pl ? 'tak' : 'yes') : (pl ? 'nie' : 'no'),
        (c.collections || []).join(', ') || '—', c.reason || (pl ? '—' : '—')]);
    }
  }
  const m = e.matching || {};
  return [
    P(String(e.rule || '')),
    TBL(pl ? 'Żądanie z art. 17 RODO — co dzieje się z każdą klasą dokumentacji' : 'An art. 17 GDPR request — what happens to each documentation class',
      [pl ? 'Klasa' : 'Class', pl ? 'Co się z nią dzieje' : 'What happens to it', pl ? 'Kategoria' : 'Category', pl ? 'Art. 9' : 'Art. 9', pl ? 'Zbiory' : 'Collections', pl ? 'Uzasadnienie' : 'Reason'],
      rows.length ? rows : [[pl ? '(brak)' : '(none)', '—', '—', '—', '—', '—']]),
    P(pl
      ? 'Dopasowanie osoby jest polowe, nie tekstowe: porównujemy całe wartości pól ' + (m.fields || []).join(', ') + ' (minimalna długość ' + String(m.minLength || '—') + ' znaków), a w polach opisowych ' + (m.freeText && m.freeText.fields ? (m.freeText.fields || []).join(', ') : '—') + ' — całe słowa. Zbiory nigdy nieprzeszukiwane: ' + ((m.neverScanned || []).join(', ') || '—') + '.'
      : 'Matching the data subject is by field, not by text: whole values of ' + (m.fields || []).join(', ') + ' (minimum length ' + String(m.minLength || '—') + ' characters) and, in free-text fields ' + (m.freeText && m.freeText.fields ? (m.freeText.fields || []).join(', ') : '—') + ', whole words. Never scanned: ' + ((m.neverScanned || []).join(', ') || '—') + '.'),
    P((e.audit && e.audit.note) ? String(e.audit.note) : (pl ? 'Rejestr zdarzeń nie jest redagowany ani usuwany.' : 'The audit log is neither redacted nor deleted.')),
    P(String(e.force || '')),
  ].filter((b) => !b.p || String(b.p).trim());
}

/* ------------------------------------------------------------------ 1. DPIA ------------------------ */
function dpia(f, locale) {
  const l = lc(locale);
  const pl = l === 'pl';
  const n = (x) => String(x);
  const catLabel = (id) => pick(CAT_LABEL[id] || CAT_LABEL.other, l);
  const pupilLabel = (p) => (p ? (pl ? 'oddział ' + p.classId + (p.rollNo != null ? ', nr ' + p.rollNo : '') : 'class ' + p.classId + (p.rollNo != null ? ', no. ' + p.rollNo : '')) : '—');
  const whoLabel = (arr) => (arr && arr.length ? arr.map((w) => pick(WHO_LABEL[w] || { pl: w, en: w }, l)).join(', ') : '—');
  const sections = [];

  sections.push(S(pl ? '1. Podstawowe informacje' : '1. Basic information',
    P(pl
      ? 'Dokument powstaje automatycznie z działającej instancji dziennika: spis zbiorów, liczby wierszy, uprawnienia ról, retencja i zabezpieczenia są odczytywane z kodu i z danych tej szkoły w chwili wygenerowania. Pola oznaczone jako do uzupełnienia zna wyłącznie szkoła.'
      : 'This document is generated from the running logbook instance: the inventory, row counts, role permissions, retention and safeguards are read from the code and from this school’s data at the moment of generation. Fields marked as to be completed are known only to the school.'),
    P(pl ? 'Układ odpowiada wytycznym Grupy Roboczej Art. 29 (WP 248 rev.01) oraz wykazowi rodzajów operacji wymagających oceny skutków ogłoszonemu przez Prezesa UODO. Dziennik elektroniczny trafia na ten wykaz co najmniej dwiema przesłankami: przetwarzanie danych dzieci i systematyczna ocena osób.' : 'The structure follows the Article 29 Working Party guidelines (WP 248 rev.01) and the list of processing operations requiring an assessment published by the President of UODO. An electronic school logbook lands on that list on at least two counts: processing children’s data and systematic evaluation of individuals.'),
    FILL(pl ? 'Administrator danych (pełna nazwa i adres szkoły, jeśli inne niż poniżej)' : 'Controller (full name and address of the school, if different from below)'),
    FILL(pl ? 'Inspektor Ochrony Danych — imię, nazwisko, adres kontaktowy' : 'Data Protection Officer — name and contact address'),
    FILL(pl ? 'Podmiot prowadzący hosting instancji (szkoła, gmina, CUW, dostawca zewnętrzny)' : 'Who hosts this instance (the school, the municipality, a shared service centre, an external provider)'),
    FILL(pl ? 'Data przeprowadzenia oceny i data następnego przeglądu' : 'Date of the assessment and date of the next review'),
    TBL(pl ? 'Instancja, z której wygenerowano dokument' : 'The instance this document was generated from',
      [pl ? 'Pozycja' : 'Item', pl ? 'Wartość' : 'Value'],
      [
        [pl ? 'Szkoła' : 'School', f.school.name || '—'],
        [pl ? 'Adres' : 'Address', f.school.address || '—'],
        [pl ? 'RSPO / REGON' : 'RSPO / REGON', (f.school.rspo || '—') + ' / ' + (f.school.regon || '—')],
        [pl ? 'Rok szkolny' : 'School year', f.year],
        [pl ? 'Strefa czasu szkoły' : 'School time zone', f.timezone],
        [pl ? 'Liczba uczniów w systemie' : 'Pupils in the system', n(f.counts.students)],
        [pl ? 'Liczba kont' : 'Accounts', n(f.counts.users)],
        [pl ? 'Zbiory (kolekcje) razem' : 'Collections in total', n(f.counts.collections)],
        [pl ? 'Zbiory z danymi osobowymi' : 'Collections holding personal data', n(f.counts.personalCollections)],
        [pl ? 'Wiersze z danymi osobowymi' : 'Rows holding personal data', n(f.personalRows)],
        [pl ? 'Wygenerowano' : 'Generated at', f.generatedAt],
      ])));

  sections.push(S(pl ? '2. Systematyczny opis operacji przetwarzania' : '2. Systematic description of the processing',
    P(pl ? 'Cel: prowadzenie dokumentacji przebiegu nauczania w postaci elektronicznej (dziennik lekcyjny, frekwencja, oceny, klasyfikacja), obsługa pomocy psychologiczno-pedagogicznej, komunikacja z opiekunami oraz moduły uzupełniające włączone przez szkołę.' : 'Purpose: keeping the documentation of the course of teaching in electronic form (lesson logbook, attendance, grades, classification), running psychological and pedagogical support, communicating with guardians and the supplementary modules the school has switched on.'),
    /* D3-27 — ta sama poprawka, co w umowie powierzenia § 6: „brak przekazywania do państw trzecich”
       przestaje być prawdą w chwili, gdy szkoła włączy push (FCM/APNs to operatorzy z USA). */
    P(pl ? 'Charakter: jeden proces aplikacji na szkołę, dane w plikach JSON na serwerze szkoły lub organu prowadzącego; brak wielodostępnej chmury.' : 'Nature: one application process per school, data in JSON files on the school’s or the governing body’s server; no multi-tenant cloud.'),
    P(f.transports.push.enabled
      ? (pl ? 'Przekazywanie do państw trzecich: szkoła włączyła powiadomienia push, więc doręczenie idzie przez usługę push producenta przeglądarki — Google LLC (FCM) i Apple Inc. (APNs) działają w Stanach Zjednoczonych. Pośrednik widzi adres punktu końcowego urządzenia i metadane wysyłki; treść jest zaszyfrowana kluczem przeglądarki (RFC 8291). Podstawę przekazania wskazuje szkoła w umowie powierzenia (§ 6).' : 'Transfers to third countries: the school has switched push notifications on, so delivery goes through the browser vendor’s push service — Google LLC (FCM) and Apple Inc. (APNs) operate in the United States. The intermediary sees the device endpoint and the send metadata; the content is encrypted with the browser’s own key (RFC 8291). The school states the transfer basis in the processing agreement (section 6).')
      : (pl ? 'Przekazywanie do państw trzecich: przy obecnej konfiguracji nie występuje — powiadomienia push są wyłączone. Ich włączenie oznacza doręczenie przez Google LLC (FCM) albo Apple Inc. (APNs) w Stanach Zjednoczonych i wymaga podstawy z rozdziału V RODO.' : 'Transfers to third countries: none in the present configuration — push notifications are off. Switching them on means delivery through Google LLC (FCM) or Apple Inc. (APNs) in the United States and needs a basis under chapter V GDPR.')),
    FILL(pl ? 'Podstawa prawna wybrana przez szkołę (art. 6 ust. 1 lit. c i e RODO w zw. z przepisami oświatowymi; dla danych art. 9 — art. 9 ust. 2 lit. b i g)' : 'Legal basis chosen by the school (art. 6(1)(c) and (e) GDPR together with education law; for art. 9 data — art. 9(2)(b) and (g))'),
    TBL(pl ? 'Włączone moduły' : 'Modules switched on',
      [pl ? 'Moduł' : 'Module', pl ? 'Nazwa' : 'Name', pl ? 'Stan' : 'State'],
      f.modules.map((m) => [m.id, pick(m.name, l), m.required ? (pl ? 'wymagany' : 'required') : (m.enabled ? (pl ? 'włączony' : 'enabled') : (pl ? 'wyłączony' : 'disabled'))])),
    TBL(pl ? 'Spis zbiorów danych z licznikami wierszy' : 'Inventory of data sets with row counts',
      [pl ? 'Zbiór' : 'Collection', pl ? 'Wiersze' : 'Rows', pl ? 'Kategoria' : 'Category', pl ? 'Art. 9' : 'Art. 9', pl ? 'Kogo dotyczy' : 'Data subjects', pl ? 'Po co' : 'Purpose'],
      f.inventory.map((i) => [i.collection, n(i.rows), catLabel(i.category), i.art9 === true ? (pl ? 'tak' : 'yes') : i.art9 === 'incidental' ? (pl ? 'możliwe' : 'possible') : (pl ? 'nie' : 'no'), whoLabel(i.who), pick(i.purpose, l)])),
    TBL(pl ? 'Kategorie osób, których dane dotyczą' : 'Categories of data subjects',
      [pl ? 'Kategoria' : 'Category', pl ? 'Liczba' : 'Count', pl ? 'Uwaga' : 'Note'],
      [
        [pick(WHO_LABEL.pupils, l), n(f.counts.students), pl ? 'w większości dzieci — przetwarzanie podlega wzmożonej ochronie (motyw 38 RODO)' : 'mostly children — processing calls for heightened protection (recital 38 GDPR)'],
        [pick(WHO_LABEL.guardians, l), n(f.counts.guardians), pl ? 'konta opiekunów z zakresem dostępu pełnym, informacyjnym albo żadnym' : 'guardian accounts with full, information-only or no access'],
        [pick(WHO_LABEL.staff, l), n(f.counts.staff), pl ? 'konta pracowników; kont uczniowskich: ' + n(f.counts.pupilAccounts) + ', kont razem: ' + n(f.counts.users) : 'staff accounts; pupil accounts: ' + n(f.counts.pupilAccounts) + ', accounts in total: ' + n(f.counts.users)],
      ])));

  sections.push(S(pl ? '3. Dane szczególnych kategorii (art. 9 RODO)' : '3. Special categories of data (art. 9 GDPR)',
    P(pl ? 'Zbiory poniżej z założenia niosą dane o zdrowiu, o pomocy psychologiczno-pedagogicznej albo o interwencjach — dostęp do nich jest zawężony rolą i regułą odczytu karty ucznia, a notatki poufne są dodatkowo szyfrowane kluczem czytelnika.' : 'The collections below carry, by design, data on health, on psychological and pedagogical support or on interventions — access to them is narrowed by role and by the pupil-record rule, and confidential notes are additionally encrypted for named readers.'),
    TBL(pl ? 'Zbiory z danymi art. 9' : 'Collections holding art. 9 data',
      [pl ? 'Zbiór' : 'Collection', pl ? 'Wiersze' : 'Rows', pl ? 'Kategoria' : 'Category', pl ? 'Po co' : 'Purpose'],
      f.art9.length ? f.art9.map((i) => [i.collection, n(i.rows), catLabel(i.category), pick(i.purpose, l)]) : [[pl ? '(brak)' : '(none)', '0', '—', pl ? 'w tej instancji nie ma takich zbiorów' : 'this instance holds no such collections']]),
    TBL(pl ? 'Zbiory, w których dane art. 9 mogą się pojawić w polu opisowym' : 'Collections where art. 9 data can appear in a free-text field',
      [pl ? 'Zbiór' : 'Collection', pl ? 'Wiersze' : 'Rows', pl ? 'Dlaczego' : 'Why'],
      f.art9Incidental.length ? f.art9Incidental.map((i) => [i.collection, n(i.rows), pick(i.purpose, l)]) : [[pl ? '(brak)' : '(none)', '0', '—']])));

  sections.push(S(pl ? '4. Macierz „rola → dane”' : '4. Role → data matrix',
    P(pl ? 'Pierwsza tabela liczy punkty API, które dana rola w ogóle może wywołać, wprost z rejestru tras uruchomionej aplikacji. Druga pokazuje wynik prawdziwych wywołań jedynej bramy odczytu karty ucznia (assertMayReadPupilRecord) na kontach tej szkoły — „tak” znaczy, że brama przepuściła, a wpisana odmowa to jej kod.' : 'The first table counts the API endpoints a role may call at all, straight from the running application’s route registry. The second shows the outcome of real calls to the single pupil-record gate (assertMayReadPupilRecord) using this school’s accounts — “yes” means the gate let the call through, and a refusal is quoted with its code.'),
    TBL(pl ? 'Zasięg ról w API' : 'Reach of each role in the API',
      [pl ? 'Rola' : 'Role', pl ? 'Konto w tej szkole' : 'Account in this school', pl ? 'Punkty API' : 'API endpoints', pl ? 'w tym zapisy' : 'of which writes', pl ? 'Moduły' : 'Modules'],
      f.roles.map((r) => [r.role, pick(ROLE_PRESENT, l)[r.hasAccount ? 'yes' : 'no'], n(r.endpoints), n(r.writes), Object.keys(r.modules).sort().join(', ') || '—'])),
    TBL(pl ? 'Odczyt karty ucznia — wynik wywołania bramy' : 'Reading a pupil’s record — the gate’s answer',
      [pl ? 'Rola' : 'Role'].concat(D.RECORD_KINDS).concat([pl ? 'Uczeń przykładowy' : 'Sample pupil']),
      f.roles.map((r) => [r.role].concat(D.RECORD_KINDS.map((k) => (r.kinds[k].allowed ? (pl ? 'tak' : 'yes') : (pl ? 'nie · ' : 'no · ') + r.kinds[k].deny))).concat([pupilLabel(r.samplePupil)]))),
    P(pl ? 'Uczeń spoza zasięgu konta (inny oddział, cudze dziecko) daje odmowę na tych samych rodzajach danych — poniżej ten sam test wykonany na drugim uczniu.' : 'A pupil outside the account’s reach (another class, somebody else’s child) is refused on the same kinds of data — below is the same probe run against a second pupil.'),
    TBL(pl ? 'Odczyt karty ucznia spoza zasięgu konta' : 'Reading the record of a pupil outside the account’s reach',
      [pl ? 'Rola' : 'Role'].concat(D.RECORD_KINDS).concat([pl ? 'Uczeń' : 'Pupil']),
      f.roles.filter((r) => r.otherPupil).map((r) => [r.role].concat(D.RECORD_KINDS.map((k) => (r.otherPupil[k].allowed ? (pl ? 'tak' : 'yes') : (pl ? 'nie · ' : 'no · ') + r.otherPupil[k].deny))).concat([pupilLabel(r.otherPupilLabel)]))),
    UL([
      pl ? 'Opiekun z zakresem „informacyjnym” widzi frekwencję, plan i katalog, a nie widzi ocen, uwag, zadań ani oceny opisowej; zakres „żaden” nie widzi nic.' : 'A guardian with the “information” scope sees attendance, the timetable and the directory, but not grades, remarks, homework or descriptive assessments; the “none” scope sees nothing.',
      pl ? 'Świetlica, stołówka, biblioteka, gabinet i IOD mają katalog i obecność dnia, a nie mają przebiegu nauczania.' : 'After-school care, the cafeteria, the library, the nurse’s office and the DPO get the directory and the day’s attendance, and no learning record.',
      pl ? 'Nauczyciel czyta dane uczniów, których uczy, oraz swojego oddziału wychowawczego.' : 'A teacher reads the records of the pupils they teach and of their own homeroom class.',
    ])));

  sections.push(S(pl ? '5. Przepływy danych, transport i podmioty przetwarzające' : '5. Data flows, transport and processors',
    TBL(pl ? 'Co opuszcza serwer szkoły' : 'What leaves the school’s server',
      [pl ? 'Kanał' : 'Channel', pl ? 'Stan' : 'State', pl ? 'Co widzi pośrednik' : 'What the intermediary sees'],
      [
        [pl ? 'Powiadomienia push' : 'Push notifications', f.transports.push.enabled ? (pl ? 'włączone' : 'enabled') : (pl ? 'wyłączone' : 'disabled'), f.transports.push.enabled ? (pl ? 'adres urządzenia, rozmiar i czas wysyłki, klucz publiczny VAPID szkoły; treść jest zaszyfrowana kluczem przeglądarki (RFC 8291) — docs/PUSH.md' : 'the device endpoint, the size and time of the send, the school’s VAPID public key; the content is encrypted with the browser’s own key (RFC 8291) — docs/PUSH.md') : (pl ? 'nic nie opuszcza procesu: bez config.push.enabled i bez pary kluczy VAPID kolejka nie wysyła' : 'nothing leaves the process: without config.push.enabled and a VAPID key pair the queue sends nothing')],
        [pl ? 'Spotkania wideo' : 'Video meetings', f.transports.video.configured ? (pl ? 'skonfigurowane: ' : 'configured: ') + f.transports.video.host : (pl ? 'niewskazany serwer (domena przykładowa)' : 'no server set (the domain is an example)'), f.transports.video.configured ? (pl ? 'operator serwera wideo widzi zestawienie spotkania; nagrania trafiają tam, gdzie wskazuje config.video.storedAt (' + f.transports.video.storedAt + ')' : 'the video server’s operator sees the meeting setup; recordings go where config.video.storedAt points (' + f.transports.video.storedAt + ')') : (pl ? 'nic — dopóki domena jest przykładowa, przeglądarka nie ładuje żadnego skryptu spoza serwera szkoły' : 'nothing — while the domain is an example the browser loads no script from outside the school’s server')],
        [pl ? 'Wydruki i PDF' : 'Printouts and PDF', pl ? 'lokalnie' : 'local', pl ? 'nic — dokument powstaje w procesie szkoły, a PDF drukuje lokalna przeglądarka headless' + (f.transports.pdf.chrome ? ' (zainstalowana)' : ' (niezainstalowana — zostaje HTML do druku)') : 'nothing — the document is built in the school’s process and the PDF is printed by a local headless browser' + (f.transports.pdf.chrome ? ' (installed)' : ' (not installed — print-ready HTML is served instead)')],
        [pl ? 'Poczta e-mail i SMS' : 'E-mail and SMS', pl ? 'brak' : 'none', pl ? 'system nie wysyła poczty ani SMS-ów; powiadomienia zostają w dzienniku' : 'the system sends neither e-mail nor SMS; notifications stay inside the logbook'],
        [pl ? 'Eksport SIO' : 'SIO export', pl ? 'plik' : 'file', pl ? 'plik XML pobiera uprawniony pracownik i sam przekazuje go do SIO — brak połączenia z zewnętrznym API' : 'an authorised member of staff downloads the XML and hands it to SIO — there is no connection to an external API'],
      ]),
    TBL(pl ? 'Podmioty przetwarzające (podprocesorzy)' : 'Processors (sub-processors)',
      [pl ? 'Podmiot' : 'Party', pl ? 'Zakres' : 'Scope'],
      f.subProcessors.length ? f.subProcessors.map((s) => [pick(s.who, l), pick(s.what, l)]) : [[pl ? 'brak' : 'none', pl ? 'przy obecnej konfiguracji oprogramowanie nie przekazuje danych żadnemu podmiotowi zewnętrznemu' : 'in the present configuration the software hands data to no external party']]),
    FILL(pl ? 'Podmioty przetwarzające spoza oprogramowania (hosting, kopie zapasowe poza szkołą, serwis)' : 'Processors outside the software (hosting, off-site backups, maintenance)'),
    TBL(pl ? 'Skan zasobów zewnętrznych i bibliotek śledzących' : 'Scan for external resources and tracker libraries',
      [pl ? 'Pozycja' : 'Item', pl ? 'Wynik' : 'Result'],
      [
        [pl ? 'Werdykt' : 'Verdict', f.trackers.verdict],
        [pl ? 'Przeskanowane pliki' : 'Files scanned', n(f.trackers.filesScanned)],
        [pl ? 'Zasoby spoza serwera szkoły' : 'Resources from outside the school’s server', n(f.trackers.externalResources)],
        [pl ? 'Biblioteki śledzące' : 'Tracker libraries', n(f.trackers.trackerLibraries)],
        [pl ? 'Data skanu' : 'Scan date', f.trackers.checkedAt],
        [pl ? 'Polityka bezpieczeństwa treści (CSP)' : 'Content Security Policy', f.trackers.csp || '—'],
      ])));

  sections.push(S(pl ? '6. Niezbędność i proporcjonalność' : '6. Necessity and proportionality',
    UL([
      pl ? 'Minimalizacja w odczycie: jedna brama (assertMayReadPupilRecord) decyduje, kto czyta kartę ucznia, zamiast reguły powtarzanej w każdym widoku.' : 'Minimisation on read: a single gate (assertMayReadPupilRecord) decides who reads a pupil’s record, instead of the rule being restated in every view.',
      pl ? 'Minimalizacja w powiadomieniach: na telefon idzie pozytywna lista rodzajów, a temat wiadomości zastępuje zdanie neutralne; notatki pomocy, gabinet i uzasadnienia ocen nie są na liście w ogóle.' : 'Minimisation in notifications: only a positive list of kinds goes to the phone and a message’s subject is replaced by a neutral sentence; support notes, the nurse’s office and grade justifications are not on the list at all.',
      pl ? 'Minimalizacja w załącznikach: każdy plik z przeglądarki przechodzi przez jedną bramę, która sprawdza typ deklarowany, bajty magiczne i rozmiar i odrzuca typy wykonywalne.' : 'Minimisation in attachments: every browser-sent file goes through one gate that checks the declared type, the magic bytes and the size, and refuses executable types.',
      pl ? 'Brak profilowania i brak reklamy: skan potwierdza zero bibliotek analitycznych i zero zasobów spoza serwera szkoły; dziennik nie liczy zachowań użytkownika.' : 'No profiling and no advertising: the scan confirms zero analytics libraries and zero resources from outside the school’s server; the logbook does not measure user behaviour.',
      pl ? 'Ograniczenie celu przez moduły: szkoła wyłącza cały obszar (np. kursy, spotkania) i wtedy ani API, ani ekran nie istnieje dla nikogo.' : 'Purpose limitation through modules: the school switches a whole area off (courses, meetings) and then neither the API nor the screen exists for anyone.',
      pl ? 'Prawa osób: dostęp i kopia — wydruki i eksporty w każdym widoku ucznia i opiekuna; usunięcie — POST /api/privacy/forget z protokołem; sprostowanie — zwykłe operacje sekretariatu z wpisem audytowym.' : 'Data-subject rights: access and a copy — printouts and exports in every pupil and guardian view; erasure — POST /api/privacy/forget with a protocol; rectification — ordinary registrar operations, each leaving an audit entry.',
    ]),
    FILL(pl ? 'Ocena proporcjonalności dokonana przez szkołę (czy wszystkie włączone moduły są potrzebne)' : 'The school’s proportionality assessment (whether every module switched on is needed)')));

  const risks = [
    { r: { pl: 'Nieuprawniony wgląd w dane ucznia przez pracownika szkoły', en: 'Unauthorised access to a pupil’s data by a member of staff' }, m: { pl: 'jedna brama odczytu karty ucznia, role w każdej trasie, rejestr zdarzeń WORM, wgląd do gabinetu osobno logowany', en: 'a single pupil-record gate, roles on every route, a WORM audit log, separate logging of access to nurse records' } },
    { r: { pl: 'Ujawnienie danych art. 9 (pomoc, zdrowie, interwencje)', en: 'Disclosure of art. 9 data (support, health, interventions)' }, m: { pl: 'notatki poufne szyfrowane kopertą ' + f.security.noteAlg + ' dla imiennie wskazanych czytelników (' + n(f.security.encryptedNotes) + ' notatek, ' + n(f.security.keyHolders) + ' kont z kluczem), zespół wspierający jako osobne role', en: 'confidential notes encrypted in a ' + f.security.noteAlg + ' envelope for named readers (' + n(f.security.encryptedNotes) + ' notes, ' + n(f.security.keyHolders) + ' accounts holding a key), the support team as separate roles' } },
    { r: { pl: 'Przejęcie konta (słabe hasło, współdzielony komputer w pokoju nauczycielskim)', en: 'Account takeover (a weak password, a shared staffroom computer)' }, m: { pl: 'hasła w postaci skrótu ' + f.security.passwordAlg + ', polityka minimum ' + n(f.security.passwordPolicy.minLength) + ' znaków, wygaśnięcie sesji po ' + n(f.security.sessionTimeoutMin) + ' min bezczynności, rotacja tokenu przy logowaniu, limit sesji na konto, okno ograniczające próby logowania, drugi składnik (' + (f.security.twoFactorForGradeEditors ? (pl ? 'wymagany dla osób wystawiających oceny' : 'required for grade editors') : (pl ? 'dostępny, niewymagany' : 'available, not required')) + ')', en: 'passwords hashed with ' + f.security.passwordAlg + ', a policy of at least ' + n(f.security.passwordPolicy.minLength) + ' characters, sessions expiring after ' + n(f.security.sessionTimeoutMin) + ' minutes of inactivity, token rotation on login, a cap on sessions per account, a rate-limiting window on login, a second factor (' + (f.security.twoFactorForGradeEditors ? 'required for grade editors' : 'available, not required') + ')' } },
    { r: { pl: 'Wyciek przez przeglądarkę (skrypt z zewnątrz, wstrzyknięcie treści)', en: 'Leak through the browser (an external script, content injection)' }, m: { pl: 'polityka CSP bez źródeł zewnętrznych poza serwerem wideo szkoły, brak wtyczek (object-src none), API wyłącznie na JSON (bez prostych żądań międzywitrynowych), skan potwierdzający zero zasobów zewnętrznych', en: 'a CSP with no external sources beyond the school’s own video server, no plugins (object-src none), an API that accepts JSON only (which rules out simple cross-site requests), and a scan confirming zero external resources' } },
    { r: { pl: 'Utrata danych (awaria dysku, błąd operatora)', en: 'Data loss (disk failure, operator error)' }, m: { pl: 'zapis pliku przez tmp+rename, dzienniki dopisywania dla kolekcji gorących, kopia zapasowa scripts/backup.js z weryfikacją i rotacją, kwarantanna pliku uszkodzonego', en: 'file writes through tmp+rename, append logs for the hot collections, backups via scripts/backup.js with verification and rotation, quarantine for a torn file' } },
    { r: { pl: 'Przetrzymywanie danych ponad okres', en: 'Keeping data beyond the retention period' }, m: { pl: 'polityka retencji w config, brakowanie rocznikami z protokołem, pakiet archiwalny roku z pieczęcią (' + f.security.sealAlg + ')', en: 'a retention policy in config, culling by whole years with a protocol, a sealed year-end archive package (' + f.security.sealAlg + ')' } },
    { r: { pl: 'Ujawnienie treści na ekranie blokady telefonu', en: 'Content shown on a phone’s lock screen' }, m: { pl: 'pozytywna lista rodzajów push, neutralna treść dla wiadomości, cisza nocna, szyfrowanie ładunku kluczem urządzenia', en: 'a positive list of push kinds, neutral text for messages, quiet hours, payload encryption with the device’s own key' } },
    /* D3-41 — rejestr ryzyk opisywał stan sprzed R3: same zakresy full/info/none i sprzeciw ucznia
       pełnoletniego. Statusy władzy rodzicielskiej, podstawa w postaci postanowienia sądu i tryb
       `config.adultAccess` są w kodzie od R3 i muszą być w dokumencie, który podpisuje IOD. */
    { r: { pl: 'Nadmiarowy dostęp opiekuna po zmianie sytuacji rodzinnej', en: 'A guardian keeping access after the family situation changes' }, m: { pl: 'status władzy rodzicielskiej przy każdym wpisie opiekuna (pełna, ograniczona, pozbawiony władzy, ograniczenie orzeczeniem sądu) i wynikający z niego zakres (pełny / informacyjny / żaden), zapisane przy uczniu, a nie na koncie; nałożenie i zdjęcie ograniczenia orzeczonego przez sąd wyłącznie na postanowieniu z sygnaturą, bez dziedziczenia starej podstawy przez zmianę statusu; jedna brama decyduje o widoczności ocen, wiadomości i powiadomień; dostęp opiekunów do danych ucznia pełnoletniego wedle ustawienia szkoły (' + (f.adultAccess === 'consent-required' ? 'zgoda wymagana' : 'do sprzeciwu') + '), sprzeciw ucznia blokuje konta opiekunów; każda zmiana z wpisem audytowym', en: 'a parental-authority status on every guardian entry (full, limited, deprived, court-restricted) and the scope that follows from it (full / information / none), recorded on the pupil rather than on the account; imposing and lifting a court-ordered restriction only on a court order with its reference, with no old basis carried across a status change; one gate decides the visibility of grades, messages and notifications; guardian access to an adult pupil’s data follows the school’s setting (' + (f.adultAccess === 'consent-required' ? 'consent required' : 'until objection') + '), and the pupil’s objection blocks the guardian accounts; every change leaves an audit entry' } },
  ];
  sections.push(S(pl ? '7. Ryzyka i środki' : '7. Risks and measures',
    P(pl ? 'Kolumny prawdopodobieństwa i wagi wypełnia szkoła — zależą od jej otoczenia (sprzęt, liczba użytkowników, sposób hostingu), a nie od kodu.' : 'The likelihood and severity columns are for the school to fill in — they depend on its surroundings (hardware, number of users, hosting), not on the code.'),
    TBL(pl ? 'Rejestr ryzyk' : 'Risk register',
      [pl ? 'Ryzyko' : 'Risk', pl ? 'Środki w oprogramowaniu' : 'Measures in the software', pl ? 'Prawdopodobieństwo' : 'Likelihood', pl ? 'Waga' : 'Severity', pl ? 'Ryzyko szczątkowe' : 'Residual risk'],
      risks.map((x) => [pick(x.r, l), pick(x.m, l), FILL_MARK[l], FILL_MARK[l], FILL_MARK[l]])),
    TBL(pl ? 'Zabezpieczenia odczytane z instancji' : 'Safeguards read from the instance',
      [pl ? 'Zabezpieczenie' : 'Safeguard', pl ? 'Stan' : 'State'],
      [
        [pl ? 'Skrót hasła' : 'Password hashing', f.security.passwordAlg],
        [pl ? 'Polityka hasła' : 'Password policy', (pl ? 'minimum ' : 'at least ') + n(f.security.passwordPolicy.minLength) + (pl ? ' znaków, wielka i mała litera, cyfra, znak specjalny' : ' characters, upper and lower case, a digit, a special character')],
        [pl ? 'Szyfrowanie notatek poufnych' : 'Encryption of confidential notes', f.security.noteAlg],
        [pl ? 'Notatki zaszyfrowane / konta z kluczem' : 'Encrypted notes / accounts holding a key', n(f.security.encryptedNotes) + ' / ' + n(f.security.keyHolders)],
        [pl ? 'Pieczęć pakietu archiwalnego' : 'Seal on the archive package', f.security.sealAlg + (f.security.sealNote ? ' — ' + f.security.sealNote : '')],
        [pl ? 'Wygaśnięcie sesji' : 'Session expiry', n(f.security.sessionTimeoutMin) + (pl ? ' min bezczynności' : ' minutes of inactivity')],
        [pl ? 'Drugi składnik dla osób wystawiających oceny' : 'Second factor for grade editors', yesNo(f.security.twoFactorForGradeEditors, l)],
        [pl ? 'Lista dozwolonych adresów IP' : 'IP allowlist', yesNo(f.security.ipAllowlist, l)],
        [pl ? 'Rejestr zdarzeń niezmienialny' : 'Audit log immutable', yesNo(f.security.auditImmutable, l) + ' · ' + n(f.security.auditRows) + (pl ? ' wpisów' : ' entries')],
        [pl ? 'Szyfrowanie nośnika' : 'Encryption at rest', pick(f.security.atRest, l)],
      ]),
    FILL(pl ? 'Zabezpieczenia po stronie hostingu (szyfrowanie dysku, zapora, kopie poza serwerem, dostęp administratora systemu)' : 'Safeguards on the hosting side (disk encryption, firewall, off-site copies, system administrator access)')));

  sections.push(S(pl ? '8. Przechowywanie i usuwanie' : '8. Storage and deletion',
    f.retention.classes.length
      ? TBL(pl ? 'Klasy dokumentacji z kategorią archiwalną (config.retention)' : 'Documentation classes with their archive category (config.retention)',
        [pl ? 'Klasa' : 'Class', pl ? 'Kategoria' : 'Category', pl ? 'Okres' : 'Period', pl ? 'Zegar' : 'Clock', pl ? 'Rodzaj' : 'Kind', pl ? 'Zbiory' : 'Collections', pl ? 'Potwierdzona JRWA' : 'Confirmed against the schedule'],
        f.retention.classes.map((x) => [x.label, x.category, x.period === '—' ? pick(x.periodUnit, l) : x.period + ' ' + pick(x.periodUnit, l), x.clock, x.kind, x.collections.join(', ') || '—', yesNo(x.verified, l)]))
      : null,
    f.retention.classes.length && !f.retention.jrwaVerified
      ? P(pl ? 'Uwaga: tabela klas nie została jeszcze potwierdzona jednolitym rzeczowym wykazem akt tej szkoły. ' + (f.retention.jrwaNote || '') : 'Note: the class table has not yet been confirmed against this school’s own retention schedule. ' + (f.retention.jrwaNote || ''))
      : null,
    f.retention.coverage
      ? P(pl
        ? 'Pokrycie: ' + n(f.retention.coverage.covered) + ' z ' + n(f.retention.coverage.collections) + ' zbiorów tej instancji należy do którejś z klas powyżej. Zbiory bez klasy: ' + (f.retention.coverage.uncovered.length ? f.retention.coverage.uncovered.join(', ') : 'brak') + '. Zbiór bez klasy nie jest liczony, nie jest proponowany do brakowania i nie zostaje usunięty — dlatego jest tu wymieniony z nazwy.'
        : 'Coverage: ' + n(f.retention.coverage.covered) + ' of ' + n(f.retention.coverage.collections) + ' collections in this instance belong to one of the classes above. Collections with no class: ' + (f.retention.coverage.uncovered.length ? f.retention.coverage.uncovered.join(', ') : 'none') + '. A collection with no class is never counted, never proposed for disposal and never deleted — which is why it is named here.')
      : null,
    TBL(pl ? 'Domyślne okresy z konfiguracji' : 'Default periods from the configuration',
      [pl ? 'Ustawienie' : 'Setting', pl ? 'Wartość' : 'Value', pl ? 'Jednostka' : 'Unit', pl ? 'Uwaga' : 'Note'],
      f.retention.rows.map((r) => [r.key, r.value, pick(r.unit, l) || '—', pick(r.note, l)])),
    P(pick(f.retention.culling, l)),
    P(pick(f.retention.erasure, l)),
    erasureBlocks(f, l),
    FILL(pl ? 'Kategorie archiwalne z jednolitego rzeczowego wykazu akt szkoły (B5, B50, A) przypisane do zbiorów powyżej' : 'Archive categories from the school’s own retention schedule (B5, B50, A) mapped onto the collections above')));

  sections.push(S(pl ? '9. Konsultacje, opinia IOD i zatwierdzenie' : '9. Consultation, the DPO’s opinion and approval',
    FILL(pl ? 'Opinia Inspektora Ochrony Danych (art. 35 ust. 2 RODO)' : 'The Data Protection Officer’s opinion (art. 35(2) GDPR)'),
    FILL(pl ? 'Czy zasięgnięto opinii osób, których dane dotyczą, lub ich przedstawicieli (rada rodziców, samorząd uczniowski)' : 'Whether the views of data subjects or their representatives were sought (the parents’ council, the pupils’ council)'),
    FILL(pl ? 'Decyzja: czy ryzyko szczątkowe wymaga uprzednich konsultacji z Prezesem UODO (art. 36 RODO)' : 'Decision: whether the residual risk calls for prior consultation with the President of UODO (art. 36 GDPR)'),
    FILL(pl ? 'Data i podpis dyrektora szkoły' : 'Date and signature of the head teacher'),
    FILL(pl ? 'Termin następnego przeglądu oceny' : 'Date of the next review of this assessment')));

  return {
    id: 'dpia',
    title: pl ? 'Ocena skutków dla ochrony danych — dziennik elektroniczny' : 'Data protection impact assessment — electronic school logbook',
    subtitle: pl ? 'Szablon wygenerowany z działającej instancji EdMat. Nie stanowi porady prawnej.' : 'A template generated from the running EdMat instance. Not legal advice.',
    docNo: 'DPIA / ' + (f.year || ''),
    meta: [
      [pl ? 'Szkoła' : 'School', f.school.name || '—'],
      [pl ? 'Rok szkolny' : 'School year', f.year],
      [pl ? 'Stan na dzień' : 'As at', util.fmtDate(f.today)],
      [pl ? 'Wygenerowano' : 'Generated at', f.generatedAt],
      [pl ? 'Źródło' : 'Source', 'GET /api/compliance/dpia?locale=' + l],
    ],
    sections,
    footer: pl
      ? 'Dokument wygenerowany automatycznie przez EdMat z faktów odczytanych z działającej instancji. Nie jest poradą prawną ani gotową oceną skutków — wypełnia go i zatwierdza szkoła wraz ze swoim Inspektorem Ochrony Danych.'
      : 'Generated automatically by EdMat from facts read out of the running instance. It is neither legal advice nor a finished assessment — the school completes and approves it together with its Data Protection Officer.',
  };
}

/* ------------------------------------------------------------------ 2. deklaracja dostępności ----- */
function accessibility(f, locale) {
  const l = lc(locale);
  const pl = l === 'pl';
  const sections = [];
  const school = f.school || {};

  sections.push(S(pl ? '1. Wstęp' : '1. Introduction',
    P((school.name || FILL_MARK[l]) + (pl
      ? ' zobowiązuje się zapewnić dostępność swojej aplikacji internetowej zgodnie z ustawą z dnia 4 kwietnia 2019 r. o dostępności cyfrowej stron internetowych i aplikacji mobilnych podmiotów publicznych. Niniejsza deklaracja dostępności dotyczy dziennika elektronicznego EdMat.'
      : ' undertakes to make its web application accessible in accordance with the Polish Act of 4 April 2019 on the digital accessibility of websites and mobile applications of public bodies. This accessibility statement applies to the EdMat electronic school logbook.')),
    TBL(pl ? 'Dane podmiotu' : 'Details of the public body',
      [pl ? 'Pozycja' : 'Item', pl ? 'Wartość' : 'Value'],
      [
        [pl ? 'Nazwa podmiotu publicznego' : 'Name of the public body', school.name || FILL_MARK[l]],
        [pl ? 'Adres' : 'Address', school.address || FILL_MARK[l]],
        [pl ? 'Adres e-mail' : 'E-mail', school.email || FILL_MARK[l]],
        [pl ? 'Telefon' : 'Telephone', school.phone || FILL_MARK[l]],
        [pl ? 'RSPO' : 'RSPO', school.rspo || FILL_MARK[l]],
        [pl ? 'Adres aplikacji' : 'Address of the application', FILL_MARK[l]],
      ]),
    /* Ustawa o dostępności cyfrowej wymienia te pola z osobna — data sporządzenia jest własnym
       polem deklaracji, nie zdaniem w opisie metody (raport domenowy § 1.1). */
    FILL(pl ? 'Data publikacji aplikacji (dzień uruchomienia dziennika w szkole)' : 'Date the application was published (the day the logbook went live in the school)'),
    FILL(pl ? 'Data ostatniej istotnej aktualizacji' : 'Date of the last substantial update'),
    FILL(pl ? 'Data sporządzenia deklaracji' : 'Date this statement was drawn up'),
    FILL(pl ? 'Data ostatniego przeglądu deklaracji' : 'Date of the last review of this statement'),
    FILL(pl ? 'Adres strony deklaracji w Biuletynie Informacji Publicznej (BIP)' : 'Address of this statement in the Public Information Bulletin (BIP)')));

  sections.push(S(pl ? '2. Status pod względem zgodności' : '2. Compliance status',
    P(pl
      /* D3-40 — § 2 nie może obiecywać „pełnej obsługi z klawiatury”, skoro § 4 tego samego dokumentu
         wymienia 2.1.4 i 4.1.3 jako kryteria bez dowodu. Mówimy dokładnie tyle, ile potwierdzają testy. */
      ? 'Aplikacja jest częściowo zgodna z ustawą z dnia 4 kwietnia 2019 r. o dostępności cyfrowej (WCAG 2.1 na poziomie AA) z powodu niezgodności i wyłączeń wymienionych w punkcie 4. Interfejs powstał na systemie projektowym o skali typografii w rem, z motywem wysokiego kontrastu; obsługa z klawiatury jest potwierdzona testami dla skrótów, kolejności fokusu i widocznego pierścienia fokusu, natomiast kryteria wymienione w punkcie 4 — w tym skróty jednoznakowe (2.1.4) i komunikaty o stanie (4.1.3) — nie mają dowodu automatycznego. Części kryteriów nie badali też użytkownicy technologii wspomagających.'
      : 'The application is partially compliant with the Act of 4 April 2019 on digital accessibility (WCAG 2.1 level AA) because of the non-compliances and exemptions listed in section 4. The interface is built on a design system with a rem-based type scale and a high-contrast theme; keyboard operation is confirmed by tests for shortcuts, focus order and a visible focus ring, while the criteria listed in section 4 — including single-character shortcuts (2.1.4) and status messages (4.1.3) — have no automated evidence. Some criteria have also not been tested by users of assistive technology.'),
    FILL(pl ? 'Ostateczny status wybrany przez szkołę (zgodna / częściowo zgodna / niezgodna) po własnym przeglądzie' : 'The final status chosen by the school (compliant / partially compliant / non-compliant) after its own review')));

  sections.push(S(pl ? '3. Metoda oceny i co zostało zbadane' : '3. Method of assessment and what was verified',
    P(pick(f.a11y.method, l)),
    P(pl ? 'Dowodem są testy z pliku ' + f.a11y.evidenceFile + ', uruchamiane przy każdej zmianie kodu; poniższa tabela wymienia tylko te, których obecność potwierdzono przy generowaniu tej deklaracji.' : 'The evidence is the tests in ' + f.a11y.evidenceFile + ', run on every code change; the table below lists only the ones whose presence was confirmed while this statement was generated.'),
    TBL(pl ? 'Zbadane automatycznie' : 'Verified automatically',
      [pl ? 'Test' : 'Test', pl ? 'Kryteria WCAG' : 'WCAG criteria', pl ? 'Co sprawdza' : 'What it checks'],
      f.a11y.tested.map((t) => [t.id, t.wcag, pick(t.what, l)])),
    P(pl ? 'Nie zlecono audytu zewnętrznego ani badania z udziałem użytkowników technologii wspomagających.' : 'No external audit and no testing with users of assistive technology has been commissioned.'),
    FILL(pl ? 'Data i wynik ewentualnego audytu zewnętrznego' : 'Date and result of an external audit, if one is commissioned')));

  sections.push(S(pl ? '4. Treści niedostępne i kryteria niezbadane' : '4. Inaccessible content and criteria not verified',
    P(pl ? 'Poniższe kryteria nie mają automatycznego dowodu w testach aplikacji. Nie znaczy to, że są naruszone — znaczy, że szkoła nie powinna ich deklarować jako sprawdzone bez własnego przeglądu.' : 'The criteria below have no automated evidence in the application’s tests. That does not mean they are violated — it means the school should not declare them verified without a review of its own.'),
    TBL(pl ? 'Kryteria bez dowodu w testach' : 'Criteria with no evidence in the tests',
      [pl ? 'WCAG' : 'WCAG', pl ? 'Czego dotyczy' : 'What it covers', pl ? 'Dlaczego nie zbadano' : 'Why it was not verified'],
      f.a11y.untested.map((u) => [u.wcag, pick(u.what, l), pick(u.why, l)])),
    f.a11y.missingEvidence.length
      ? TBL(pl ? 'Uwaga: testy, których nie odnaleziono w pliku dowodowym' : 'Note: tests not found in the evidence file',
        [pl ? 'Test' : 'Test', pl ? 'Kryteria' : 'Criteria'], f.a11y.missingEvidence.map((t) => [t.id, t.wcag]))
      : null,
    UL([
      pl ? 'Dokumenty do druku (świadectwa, odpisy, zestawienia) są stronami HTML drukowanymi przez przeglądarkę; ich tabele mają podpisy i nagłówki z zakresem, ale dokument PDF powstały z wydruku nie jest znakowany (brak PDF/UA).' : 'Printable documents (certificates, transcripts, summaries) are HTML pages printed by the browser; their tables carry captions and scoped headers, but the PDF that comes out of printing is not tagged (no PDF/UA).',
      pl ? 'Załączniki wgrane przez nauczycieli i opiekunów (zdjęcia, skany, dokumenty) nie są sprawdzane pod kątem dostępności — odpowiada za nie osoba, która je dodała.' : 'Attachments uploaded by teachers and guardians (photos, scans, documents) are not checked for accessibility — responsibility lies with whoever uploaded them.',
      pl ? 'Mapy i treści osadzone spoza serwera szkoły nie występują: skan potwierdził ' + String(f.trackers.externalResources) + ' zasobów zewnętrznych.' : 'There is no embedded content from outside the school’s server: the scan found ' + String(f.trackers.externalResources) + ' external resources.',
    ]),
    FILL(pl ? 'Inne treści niedostępne znane szkole (np. starsze skany w bibliotece dokumentów)' : 'Other inaccessible content known to the school (for example older scans in the document library)')));

  sections.push(S(pl ? '5. Skróty klawiszowe i ułatwienia' : '5. Keyboard shortcuts and aids',
    UL([
      pl ? 'Alt + cyfra — przejście do kolejnych sekcji z paska nawigacji.' : 'Alt + digit — jump to the sections of the navigation bar.',
      pl ? '? — lista skrótów, / — wyszukiwanie, Ctrl + S — zapis, Esc — zamknięcie okna.' : '? — the list of shortcuts, / — search, Ctrl + S — save, Esc — close a dialog.',
      pl ? 'A, N, S, Z, U, R, W — statusy frekwencji na liście obecności; strzałki przenoszą między uczniami.' : 'A, N, S, Z, U, R, W — attendance statuses in the roster; the arrow keys move between pupils.',
      pl ? 'Odnośnik „Przejdź do treści” jako pierwszy element strony.' : 'A “skip to content” link as the first element of the page.',
      pl ? 'W Ustawieniach: motyw jasny, ciemny i wysokiego kontrastu, powiększenie tekstu do 200 %, ograniczenie animacji, wybór języka (polski, angielski).' : 'In Settings: light, dark and high-contrast themes, text zoom up to 200 %, reduced motion, choice of language (Polish, English).',
    ])));

  sections.push(S(pl ? '6. Informacje zwrotne i dane kontaktowe' : '6. Feedback and contact details',
    P(pl
      ? 'Każdy ma prawo wystąpić z żądaniem zapewnienia dostępności cyfrowej aplikacji lub jej elementu, a także zażądać udostępnienia informacji w formie alternatywnej (odczytanie niedostępnego cyfrowo dokumentu, opis treści filmu bez audiodeskrypcji itp.).'
      : 'Anyone has the right to request that the application, or a part of it, be made digitally accessible, and to ask for information to be provided in an alternative form (reading out a document that is not digitally accessible, describing the content of a video without audio description, and so on).'),
    FILL(pl ? 'Osoba wyznaczona do kontaktu w sprawach dostępności (imię, nazwisko, stanowisko)' : 'The person responsible for accessibility (name, surname, position)'),
    FILL(pl ? 'Adres e-mail do zgłoszeń' : 'E-mail address for requests'),
    FILL(pl ? 'Numer telefonu do zgłoszeń' : 'Telephone number for requests'),
    P(pl
      ? 'Żądanie powinno zawierać dane osoby zgłaszającej, wskazanie, o który element aplikacji chodzi, oraz sposób kontaktu. Jeżeli osoba żądająca zgłasza potrzebę otrzymania informacji w formie alternatywnej, powinna określić dogodny dla siebie sposób przedstawienia tej informacji.'
      : 'A request should give the requester’s details, say which part of the application it concerns and how to reply. If the requester needs the information in an alternative form, they should say which form suits them.'),
    P(pl
      ? 'Podmiot publiczny realizuje żądanie niezwłocznie, nie później niż w ciągu 7 dni od dnia wystąpienia z żądaniem. Jeżeli dotrzymanie tego terminu nie jest możliwe, niezwłocznie informuje o tym wnoszącego i wskazuje nowy termin, nie dłuższy niż 2 miesiące od dnia wystąpienia z żądaniem. Jeżeli zapewnienie dostępności cyfrowej nie jest możliwe, podmiot proponuje alternatywny sposób dostępu do informacji.'
      : 'The public body fulfils the request without undue delay and no later than 7 days from the day it was made. Where that deadline cannot be met, it informs the requester without delay and gives a new deadline, no longer than 2 months from the day of the request. Where digital accessibility cannot be ensured, the body proposes an alternative way of accessing the information.')));

  sections.push(S(pl ? '7. Postępowanie odwoławcze' : '7. Complaints procedure',
    P(pl
      ? 'W przypadku odmowy realizacji żądania zapewnienia dostępności albo odmowy skorzystania z alternatywnego sposobu dostępu wnoszący może złożyć skargę do podmiotu publicznego, a po wyczerpaniu tej drogi — wniosek do Rzecznika Praw Obywatelskich (www.rpo.gov.pl).'
      : 'If the request is refused, or if the alternative means of access is refused, the requester may lodge a complaint with the public body and, once that route is exhausted, apply to the Polish Commissioner for Human Rights (www.rpo.gov.pl).'),
    /* D3-39 — droga odwoławcza z ustawy o dostępności cyfrowej kończy się na Rzeczniku Praw
       Obywatelskich. PFRON przyjmuje wnioski na podstawie INNEJ ustawy — o zapewnianiu dostępności
       osobom ze szczególnymi potrzebami (dostępność architektoniczna i informacyjno-komunikacyjna)
       — i mieszanie obu dróg w jednym akapicie wysyła obywatela pod zły adres. */
    P(pl
      ? 'Odrębną drogę — wniosek o zapewnienie dostępności architektonicznej lub informacyjno-komunikacyjnej — przewiduje ustawa z dnia 19 lipca 2019 r. o zapewnianiu dostępności osobom ze szczególnymi potrzebami; skargę na brak dostępności w tym trybie rozpatruje Państwowy Fundusz Rehabilitacji Osób Niepełnosprawnych (PFRON, www.pfron.org.pl). Nie dotyczy to dostępności cyfrowej tej aplikacji, opisanej wyżej.'
      : 'A separate route — a request to ensure architectural or communication accessibility — follows from the Act of 19 July 2019 on ensuring accessibility for people with special needs; a complaint about accessibility under that act is handled by the State Fund for the Rehabilitation of Disabled Persons (PFRON, www.pfron.org.pl). It does not cover the digital accessibility of this application, described above.'),
    FILL(pl ? 'Adres organu, do którego kieruje się skargę (dyrektor szkoły / organ prowadzący)' : 'The body a complaint is addressed to (the head teacher / the governing body)'),
    FILL(pl ? 'Odnośnik do procedury składania żądania zapewnienia dostępności i skargi (strona szkoły albo BIP)' : 'Link to the procedure for lodging an accessibility request and a complaint (the school’s site or the BIP)')));

  sections.push(S(pl ? '8. Dostępność architektoniczna i aplikacja mobilna' : '8. Architectural accessibility and the mobile application',
    P(pl
      ? 'Dziennik działa w przeglądarce także na telefonie (aplikacja progresywna instalowana z przeglądarki); nie ma osobnej aplikacji w sklepie Google Play ani App Store. Powiadomienia push są opcjonalne i wyłączane jednym przełącznikiem w ustawieniach konta.'
      : 'The logbook runs in a browser, on a phone as well (a progressive web app installed from the browser); there is no separate application in Google Play or the App Store. Push notifications are optional and can be switched off with a single toggle in the account settings.'),
    FILL(pl ? 'Opis dostępności architektonicznej budynku szkoły (wejścia, windy, toalety, miejsca parkingowe, pies asystujący, tłumacz języka migowego)' : 'A description of the architectural accessibility of the school building (entrances, lifts, toilets, parking, assistance dogs, a sign-language interpreter)')));

  return {
    id: 'accessibility',
    title: pl ? 'Deklaracja dostępności' : 'Accessibility statement',
    subtitle: pl ? 'Szablon zgodny z ustawą z dnia 4 kwietnia 2019 r. o dostępności cyfrowej, wygenerowany z działającej instancji EdMat.' : 'A template following the Polish Act of 4 April 2019 on digital accessibility, generated from the running EdMat instance.',
    docNo: pl ? 'Deklaracja dostępności' : 'Accessibility statement',
    meta: [
      [pl ? 'Podmiot' : 'Public body', school.name || FILL_MARK[l]],
      [pl ? 'Stan na dzień' : 'As at', util.fmtDate(f.today)],
      [pl ? 'Wygenerowano' : 'Generated at', f.generatedAt],
      [pl ? 'Standard' : 'Standard', 'WCAG 2.1 AA'],
      [pl ? 'Źródło' : 'Source', 'GET /api/compliance/accessibility?locale=' + l],
    ],
    sections,
    footer: pl
      ? 'Deklarację sporządza i publikuje szkoła. EdMat wypełnia w niej wyłącznie te pola, które da się odczytać z kodu i z konfiguracji instancji; pozostałe pozostają oznaczone jako do uzupełnienia. Dokument nie jest poradą prawną.'
      : 'The statement is drawn up and published by the school. EdMat fills in only the fields that can be read from the code and the instance’s configuration; the rest stay marked as to be completed. This document is not legal advice.',
  };
}

/* ------------------------------------------------------------------ 3. umowa powierzenia ---------- */
function dpa(f, locale) {
  const l = lc(locale);
  const pl = l === 'pl';
  const n = (x) => String(x);
  const sections = [];
  const catLabel = (id) => pick(CAT_LABEL[id] || CAT_LABEL.other, l);

  sections.push(S(pl ? '1. Strony umowy' : '1. The parties',
    P(pl
      ? 'Umowa powierzenia przetwarzania danych osobowych zawarta na podstawie art. 28 ust. 3 RODO. Administratorem danych jest szkoła; podmiotem przetwarzającym jest ten, kto prowadzi dla niej instancję dziennika (organ prowadzący, centrum usług wspólnych, dostawca hostingu albo serwisu).'
      : 'A data processing agreement concluded under art. 28(3) GDPR. The school is the controller; the processor is whoever runs the logbook instance for it (the governing body, a shared service centre, a hosting or maintenance provider).'),
    TBL(pl ? 'Administrator' : 'Controller',
      [pl ? 'Pozycja' : 'Item', pl ? 'Wartość' : 'Value'],
      [
        [pl ? 'Nazwa' : 'Name', f.school.name || FILL_MARK[l]],
        [pl ? 'Adres' : 'Address', f.school.address || FILL_MARK[l]],
        [pl ? 'REGON / RSPO' : 'REGON / RSPO', (f.school.regon || FILL_MARK[l]) + ' / ' + (f.school.rspo || FILL_MARK[l])],
        [pl ? 'Reprezentowana przez' : 'Represented by', f.school.director || FILL_MARK[l]],
        [pl ? 'Inspektor Ochrony Danych' : 'Data Protection Officer', FILL_MARK[l]],
      ]),
    FILL(pl ? 'Podmiot przetwarzający — nazwa, adres, NIP, osoba reprezentująca' : 'Processor — name, address, tax number, representative'),
    FILL(pl ? 'Inspektor Ochrony Danych albo osoba kontaktowa po stronie podmiotu przetwarzającego' : 'The processor’s Data Protection Officer or contact person'),
    FILL(pl ? 'Data zawarcia umowy i umowa podstawowa, do której jest załącznikiem' : 'Date of the agreement and the main contract it is annexed to')));

  sections.push(S(pl ? '2. Przedmiot, charakter, cel i czas trwania' : '2. Subject matter, nature, purpose and duration',
    UL([
      pl ? 'Przedmiot: przetwarzanie danych osobowych w systemie dziennika elektronicznego EdMat prowadzonym dla administratora.' : 'Subject matter: processing of personal data in the EdMat electronic logbook run for the controller.',
      pl ? 'Charakter: hosting jednego procesu aplikacji i katalogu danych, kopie zapasowe, utrzymanie i aktualizacje; przetwarzanie odbywa się wyłącznie na udokumentowane polecenie administratora.' : 'Nature: hosting one application process and one data directory, backups, maintenance and updates; processing takes place only on the controller’s documented instructions.',
      pl ? 'Cel: prowadzenie dokumentacji przebiegu nauczania i zadań szkoły wynikających z przepisów oświatowych.' : 'Purpose: keeping the documentation of the course of teaching and the school’s statutory tasks.',
      pl ? 'Czas trwania: na czas obowiązywania umowy podstawowej; po jej zakończeniu obowiązują postanowienia punktu 8.' : 'Duration: for the term of the main contract; once it ends, section 8 applies.',
    ]),
    FILL(pl ? 'Czas trwania powierzenia i tryb wypowiedzenia' : 'Duration of the entrustment and how it may be terminated')));

  sections.push(S(pl ? '3. Rodzaj danych i kategorie osób' : '3. Types of data and categories of data subjects',
    P(pl ? 'Zestawienie poniżej pochodzi ze spisu zbiorów działającej instancji — nie jest deklaracją, tylko odczytem stanu na dzień wygenerowania dokumentu.' : 'The summary below comes from the inventory of the running instance — it is not a declaration but a reading of the state on the day the document was generated.'),
    TBL(pl ? 'Rodzaje danych według kategorii' : 'Types of data by category',
      [pl ? 'Kategoria' : 'Category', pl ? 'Zbiory' : 'Collections', pl ? 'Wiersze' : 'Rows'],
      Object.keys(CAT_LABEL).map((cat) => {
        const items = f.inventory.filter((i) => i.category === cat);
        return items.length ? [catLabel(cat), items.map((i) => i.collection).join(', '), n(items.reduce((s, i) => s + i.rows, 0))] : null;
      }).filter(Boolean)),
    P(pl ? 'Powierzenie obejmuje dane szczególnych kategorii (art. 9 RODO): ' + (f.art9.length ? f.art9.map((i) => i.collection).join(', ') : '(w tej instancji brak)') + '. Wymaga to od podmiotu przetwarzającego środków adekwatnych do tej kategorii danych.' : 'The entrustment covers special categories of data (art. 9 GDPR): ' + (f.art9.length ? f.art9.map((i) => i.collection).join(', ') : '(none in this instance)') + '. This calls for measures on the processor’s side that match that category of data.'),
    TBL(pl ? 'Kategorie osób' : 'Categories of data subjects',
      [pl ? 'Kategoria' : 'Category', pl ? 'Liczba w instancji' : 'Count in the instance'],
      [
        [pick(WHO_LABEL.pupils, l), n(f.counts.students)],
        [pick(WHO_LABEL.guardians, l), n(f.counts.guardians)],
        [pick(WHO_LABEL.staff, l), n(f.counts.staff) + (pl ? ' (kont razem: ' + n(f.counts.users) + ')' : ' (accounts in total: ' + n(f.counts.users) + ')')],
      ])));

  sections.push(S(pl ? '4. Obowiązki podmiotu przetwarzającego' : '4. The processor’s obligations',
    P(pl ? 'Tabela rozdziela to, co wymusza samo oprogramowanie, od tego, co musi zapewnić podmiot prowadzący instancję. Wiersz bez wpisu w drugiej kolumnie znaczy, że oprogramowanie tego nie załatwia.' : 'The table separates what the software itself enforces from what the party running the instance must provide. A row with nothing in the second column means the software does not take care of it.'),
    TBL(pl ? 'Wymogi art. 28 ust. 3 RODO wobec oprogramowania i wobec hostującego' : 'The art. 28(3) GDPR requirements, against the software and against the host',
      [pl ? 'Wymóg' : 'Requirement', pl ? 'Co wymusza oprogramowanie' : 'What the software enforces', pl ? 'Co należy do hostującego' : 'What belongs to the host'],
      [
        [pl ? 'lit. a — przetwarzanie wyłącznie na polecenie' : '(a) — processing only on instructions', pl ? 'każda operacja przechodzi przez API z rolą i zostawia wpis w rejestrze zdarzeń (' + n(f.security.auditRows) + ' wpisów w tej instancji)' : 'every operation goes through the API with a role and leaves an entry in the audit log (' + n(f.security.auditRows) + ' entries in this instance)', pl ? 'brak dostępu do danych poza uzgodnionymi czynnościami utrzymaniowymi; polecenia na piśmie' : 'no access to the data beyond the agreed maintenance work; instructions in writing'],
        [pl ? 'lit. b — zobowiązanie osób do poufności' : '(b) — confidentiality undertakings', '—', pl ? 'upoważnienia i oświadczenia o poufności dla administratorów systemu' : 'authorisations and confidentiality undertakings for the system administrators'],
        [pl ? 'lit. c — środki bezpieczeństwa (art. 32)' : '(c) — security measures (art. 32)', pl ? 'skrót hasła ' + f.security.passwordAlg + ', koperta ' + f.security.noteAlg + ' na notatki poufne, sesja ' + n(f.security.sessionTimeoutMin) + ' min, drugi składnik, polityka CSP, jedna brama załączników, rejestr zdarzeń WORM' : 'passwords hashed with ' + f.security.passwordAlg + ', a ' + f.security.noteAlg + ' envelope on confidential notes, a ' + n(f.security.sessionTimeoutMin) + '-minute session, a second factor, a CSP, one attachment gate, a WORM audit log', pl ? 'szyfrowanie nośnika, zapora, TLS, kopie zapasowe poza serwerem, aktualizacje systemu operacyjnego' : 'disk encryption, a firewall, TLS, off-site backups, operating-system updates'],
        [pl ? 'lit. d — podpowierzenie' : '(d) — sub-processing', pl ? 'bez konfiguracji push i wideo oprogramowanie nie przekazuje danych nikomu (obecnie podprocesorów: ' + n(f.subProcessors.length) + ')' : 'with push and video unconfigured the software hands data to nobody (sub-processors at present: ' + n(f.subProcessors.length) + ')', pl ? 'zgoda administratora na każdego dalszego podprocesora i ta sama treść obowiązków' : 'the controller’s consent for every further sub-processor and the same obligations passed down'],
        [pl ? 'lit. e — pomoc w realizacji praw osób' : '(e) — assistance with data-subject rights', pl ? 'wydruki i eksporty w widokach ucznia i opiekuna, POST /api/privacy/forget z protokołem, rejestr usunięć /api/privacy/erasures' : 'printouts and exports in the pupil and guardian views, POST /api/privacy/forget with a protocol, the erasure register at /api/privacy/erasures', pl ? 'przekazywanie żądań administratorowi bez zwłoki' : 'passing requests on to the controller without delay'],
        [pl ? 'lit. f — pomoc przy art. 32–36' : '(f) — assistance with art. 32–36', pl ? 'ten pakiet zgodności: ocena skutków i spis zbiorów generowane z instancji' : 'this compliance pack: the impact assessment and the inventory generated from the instance', pl ? 'zgłaszanie administratorowi każdego naruszenia bez zbędnej zwłoki, wraz z zakresem' : 'reporting every breach to the controller without undue delay, with its scope'],
        [pl ? 'lit. g — usunięcie albo zwrot danych' : '(g) — deletion or return of the data', pl ? 'scripts/backup.js tworzy jeden zweryfikowany plik z całym katalogiem danych; pakiet archiwalny roku z pieczęcią ' + f.security.sealAlg + ' eksportuje dokumentację' : 'scripts/backup.js produces one verified file holding the whole data directory; the sealed year-end package (' + f.security.sealAlg + ') exports the documentation', pl ? 'trwałe skasowanie nośników i kopii po przekazaniu danych, z protokołem' : 'permanent erasure of media and copies once the data has been handed over, with a protocol'],
        [pl ? 'lit. h — audyt i kontrola' : '(h) — audits and inspections', pl ? 'rejestr zdarzeń do wglądu w widoku dyrekcji, /api/health, skan zasobów zewnętrznych /api/privacy/trackers' : 'the audit log readable in the principal’s view, /api/health, the external-resource scan at /api/privacy/trackers', pl ? 'udostępnienie informacji i pomieszczeń, udział w kontroli administratora' : 'making information and premises available, taking part in the controller’s inspection'],
      ]),
    FILL(pl ? 'Uzgodniony tryb i częstotliwość audytu' : 'The agreed manner and frequency of audits')));

  sections.push(S(pl ? '5. Podprocesorzy' : '5. Sub-processors',
    f.subProcessors.length
      ? TBL(pl ? 'Podmioty, którym oprogramowanie przekazuje dane przy obecnej konfiguracji' : 'Parties the software hands data to in the present configuration',
        [pl ? 'Podmiot' : 'Party', pl ? 'Zakres' : 'Scope'], f.subProcessors.map((s) => [pick(s.who, l), pick(s.what, l)]))
      : P(pl ? 'Przy obecnej konfiguracji oprogramowanie nie przekazuje danych żadnemu podmiotowi zewnętrznemu: powiadomienia push są wyłączone, a serwer wideo nie został wskazany. Włączenie któregokolwiek z nich dopisuje podprocesora i wymaga aktualizacji tej umowy.' : 'In the present configuration the software hands data to no external party: push notifications are off and no video server has been set. Switching either on adds a sub-processor and calls for this agreement to be updated.'),
    FILL(pl ? 'Lista podprocesorów po stronie hostującego (serwerownia, dostawca kopii zapasowych, serwis sprzętu)' : 'The host’s own list of sub-processors (data centre, backup provider, hardware maintenance)')));

  /* D3-27 — to jest umowa, którą szkoła podpisuje i składa do akt. Zdanie „nie przekazujemy danych
     poza EOG” było fałszywe dokładnie wtedy, gdy szkoła włączyła push: punkty końcowe Web Push to
     `fcm.googleapis.com` (Google LLC, USA) i `*.push.apple.com` (Apple Inc., USA), więc doręczenie
     wymienione w tym samym zdaniu JEST przekazaniem do państwa trzeciego. Zdanie jest teraz
     warunkowe i nazywa operatora oraz podstawę przekazania jako pole do uzupełnienia. */
  sections.push(S(pl ? '6. Miejsce przetwarzania' : '6. Place of processing',
    f.transports.push.enabled
      ? P(pl
        ? 'Uwaga: szkoła włączyła powiadomienia push, więc oprogramowanie wykonuje połączenia do usługi push producenta przeglądarki. Punkty końcowe Web Push prowadzą do Google LLC (Firebase Cloud Messaging, Stany Zjednoczone) dla Chrome i Androida oraz do Apple Inc. (Apple Push Notification service, Stany Zjednoczone) dla Safari i iOS; Mozilla autopush działa w EOG. Jest to przekazanie danych do państwa trzeciego w rozumieniu rozdziału V RODO — przekazywane są metadane doręczenia (adres punktu końcowego urządzenia, czas, rozmiar), a treść jedzie zaszyfrowana kluczem przeglądarki (RFC 8291), więc pośrednik jej nie czyta. Poza tym kanałem jedynym połączeniem wychodzącym jest serwer wideo szkoły (gdy zostanie wskazany).'
        : 'Note: the school has switched push notifications on, so the software makes connections to the browser vendor’s push service. Web Push endpoints lead to Google LLC (Firebase Cloud Messaging, United States) for Chrome and Android and to Apple Inc. (Apple Push Notification service, United States) for Safari and iOS; Mozilla autopush runs inside the EEA. That is a transfer to a third country within the meaning of chapter V GDPR — what is transferred is delivery metadata (the device endpoint, time, size), while the content travels encrypted with the browser’s own key (RFC 8291), so the intermediary cannot read it. Apart from that channel, the only outbound connection is the school’s video server, if one is set.')
      : P(pl
        ? 'Przy obecnej konfiguracji oprogramowanie nie przekazuje danych poza Europejski Obszar Gospodarczy: powiadomienia push są wyłączone, a serwer wideo nie został wskazany. Włączenie powiadomień push zmienia ten stan — punkty końcowe Web Push prowadzą do Google LLC (Stany Zjednoczone) i Apple Inc. (Stany Zjednoczone), a doręczenie staje się przekazaniem do państwa trzeciego wymagającym podstawy z rozdziału V RODO i aktualizacji tej umowy.'
        : 'In the present configuration the software transfers no data outside the European Economic Area: push notifications are off and no video server has been set. Switching push on changes that — Web Push endpoints lead to Google LLC (United States) and Apple Inc. (United States), and delivery becomes a transfer to a third country, which needs a basis under chapter V GDPR and an update to this agreement.'),
    f.transports.push.enabled
      ? FILL(pl ? 'Podstawa przekazania do państwa trzeciego dla doręczenia push (standardowe klauzule umowne, decyzja o adekwatności — EU–US Data Privacy Framework — albo wyjątek z art. 49 RODO) i data jej weryfikacji' : 'The basis for the third-country transfer involved in push delivery (standard contractual clauses, an adequacy decision — the EU–US Data Privacy Framework — or a derogation under art. 49 GDPR) and the date it was verified')
      : null,
    FILL(pl ? 'Miejsce (serwerownia, kraj) i potwierdzenie, że dane nie opuszczają EOG' : 'The place (data centre, country) and a confirmation that the data does not leave the EEA')));

  sections.push(S(pl ? '7. Zgłaszanie naruszeń' : '7. Breach notification',
    P(pl ? 'Podmiot przetwarzający zgłasza administratorowi każde naruszenie ochrony danych bez zbędnej zwłoki po jego stwierdzeniu, wskazując charakter naruszenia, kategorie i przybliżoną liczbę osób oraz wpisów, prawdopodobne konsekwencje i podjęte środki.' : 'The processor notifies the controller of any personal data breach without undue delay after becoming aware of it, stating the nature of the breach, the categories and approximate number of data subjects and records, the likely consequences and the measures taken.'),
    FILL(pl ? 'Termin umowny (np. 24 godziny) i kanał zgłoszenia' : 'The contractual deadline (for example 24 hours) and the reporting channel')));

  sections.push(S(pl ? '8. Zakończenie: zwrot i usunięcie danych' : '8. On termination: return and deletion of the data',
    UL([
      pl ? 'Zwrot: node scripts/backup.js backup — jeden spakowany plik z całym katalogiem danych, z weryfikacją (node scripts/backup.js verify) i odtworzeniem (restore) na wskazanym sprzęcie administratora.' : 'Return: node scripts/backup.js backup — one compressed file holding the whole data directory, with verification (node scripts/backup.js verify) and a restore onto hardware the controller names.',
      pl ? 'Dokumentacja roczna: pakiet archiwalny w widoku dyrekcji, wraz z pieczęcią elektroniczną (' + f.security.sealAlg + ') i eksportem XML oraz wydrukami.' : 'Year-end documentation: the archive package in the principal’s view, with an electronic seal (' + f.security.sealAlg + '), an XML export and printouts.',
      pl ? 'Usunięcie: po potwierdzeniu odbioru administrator poleca usunięcie katalogu danych i wszystkich kopii zapasowych; podmiot przetwarzający sporządza protokół.' : 'Deletion: once receipt is confirmed, the controller orders the data directory and every backup to be deleted; the processor draws up a protocol.',
      pl ? 'Wyjątek: dane, których dalsze przechowywanie nakazuje prawo, zostają wskazane z podstawą i okresem.' : 'Exception: data that the law requires to be kept is listed with its basis and its period.',
    ]),
    FILL(pl ? 'Wybór: zwrot czy usunięcie, termin i forma protokołu' : 'Choice: return or deletion, the deadline and the form of the protocol'),
    /* art. 28 ust. 3 lit. e mówi o pomocy w realizacji praw osób — a najczęściej realizowanym prawem
       jest art. 17. Umowa musi opisywać go tak, jak działa, a nie tak, jak brzmi ładniej. */
    P(pl ? 'Realizacja żądania z art. 17 RODO w samym oprogramowaniu (lit. e powyżej) przebiega tak:' : 'An art. 17 GDPR request inside the software itself (point (e) above) runs as follows:'),
    erasureBlocks(f, l)));

  sections.push(S(pl ? '9. Podpisy' : '9. Signatures',
    FILL(pl ? 'Administrator — data, imię i nazwisko, podpis' : 'Controller — date, name, signature'),
    FILL(pl ? 'Podmiot przetwarzający — data, imię i nazwisko, podpis' : 'Processor — date, name, signature')));

  return {
    id: 'dpa',
    title: pl ? 'Umowa powierzenia przetwarzania danych osobowych (art. 28 RODO) — szkielet' : 'Data processing agreement (art. 28 GDPR) — skeleton',
    subtitle: pl ? 'Szkielet wygenerowany z działającej instancji EdMat. Nie stanowi porady prawnej ani gotowej umowy.' : 'A skeleton generated from the running EdMat instance. Neither legal advice nor a finished contract.',
    docNo: pl ? 'Umowa powierzenia / ' + (f.year || '') : 'Processing agreement / ' + (f.year || ''),
    meta: [
      [pl ? 'Administrator' : 'Controller', f.school.name || FILL_MARK[l]],
      [pl ? 'Rok szkolny' : 'School year', f.year],
      [pl ? 'Stan na dzień' : 'As at', util.fmtDate(f.today)],
      [pl ? 'Wygenerowano' : 'Generated at', f.generatedAt],
      [pl ? 'Źródło' : 'Source', 'GET /api/compliance/dpa?locale=' + l],
    ],
    sections,
    footer: pl
      ? 'Szkielet umowy powierzenia wygenerowany przez EdMat z faktów o działającej instancji. Nie jest poradą prawną — treść umowy ustalają strony, a zapisy o hostingu, terminach i odpowiedzialności wypełnia szkoła wraz z obsługą prawną.'
      : 'A skeleton processing agreement generated by EdMat from facts about the running instance. It is not legal advice — the parties settle the wording, and the clauses on hosting, deadlines and liability are filled in by the school with its legal advisers.',
  };
}

const BUILDERS = { dpia, accessibility, dpa };
const KINDS = Object.keys(BUILDERS);

/**
 * Zbuduj dokument: { kind, locale, id, title, doc, markdown, html }. `kind` ∈ dpia | accessibility | dpa.
 * `opts.facts === false` — zbuduj z wąskiego zestawu faktów i **nie dołączaj** ich do wyniku. Tego
 * używa publiczna trasa deklaracji: pełny zestaw to spis wszystkich zbiorów z licznikami art. 9,
 * macierz ról i sondy kryptograficzne, czyli dokładnie to, czego nikt bez sesji widzieć nie ma (S3-01),
 * i zarazem cały koszt tej trasy (S3-03).
 */
function build(kind, db, app, locale, opts) {
  const k = KINDS.includes(kind) ? kind : 'dpia';
  const l = lc(locale);
  const withFacts = !(opts && opts.facts === false);
  const f = withFacts ? facts(db, app) : accessibilityFacts(db, app);
  const doc = BUILDERS[k](f, l);
  const out = { kind: k, locale: l, id: doc.id, title: doc.title, doc, markdown: toMarkdown(doc, l), html: toHtml(doc, l, f) };
  if (withFacts) out.facts = f;
  return out;
}

module.exports = { KINDS, LOCALES, FILL_MARK, CATALOG, CAT_LABEL, inventory, roleMatrix, retention, security, transports, subProcessors, a11y, checklistState, cryptoFacts, trackerScan, facts, accessibilityFacts, build, toMarkdown, toHtml };
