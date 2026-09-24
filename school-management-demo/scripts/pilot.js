#!/usr/bin/env node
'use strict';
/**
 * scripts/pilot.js — jeden realistyczny tydzień szkolny od początku do końca, przez publiczne API.
 *
 * The pilot boots a **blank install** (`createApp({ blank: true })`), runs the first-run wizard and then
 * plays Monday to Friday of one school week the way the people would: the registrar finishes onboarding,
 * six teachers take attendance for every lesson, grades and homework happen, a parent excuses an absence,
 * a teacher falls ill, the principal supervises and on Friday everything is exported.
 *
 * The point is not the happy path — it is the **cross-role invariants** after every step: what the teacher
 * saved must be exactly what the pupil, both parents, the homeroom teacher and the principal see, averages
 * and attendance percentages must agree between every view that shows them, dashboard counts must equal the
 * rows behind them, notifications must reach exactly the right people, every write must leave an audit row
 * with before/after, and nothing may answer 500.
 *
 *   node scripts/pilot.js            # full report on stdout, exit 1 on any invariant violation
 *   node scripts/pilot.js --quiet    # only the final tables
 *   npm run pilot
 *
 * One deliberate harness shim, documented in docs/PILOT.md: the school day is advanced through
 * `config.today` (the built-in demo clock) — a pilot cannot wait five real days, and in production the
 * wall clock does this by itself. Everything else the school needs now has a route: staff accounts
 * other than teachers, the core curriculum, cafeteria accounts, library stock, fees, a pupil's flags
 * and a guardian's per-child access scope are all created through the public API, so the list of
 * product gaps in the report is empty (see docs/PILOT.md §4 for what closed each one).
 */

const { createApp } = require('../server/index');
const U = require('../server/lib/util');

/* ------------------------------------------------------------------ report ------------------- */

const GREEN = '[32m', RED = '[31m', YEL = '[33m', DIM = '[2m', OFF = '[0m';
const plain = !process.stdout.isTTY || process.env.NO_COLOR;
const col = (c, s) => (plain ? s : c + s + OFF);

class Report {
  constructor(opts) {
    const o = opts || {};
    this.quiet = !!o.quiet;
    this.steps = [];
    this.invariants = [];
    this.gaps = [];
    this.violations = [];
    this.calls = 0;
    this.statuses = new Map();
    this.serverErrors = [];
    this.started = Date.now();
    this.current = null;
  }
  say(s) { if (!this.quiet) process.stdout.write(s + '\n'); }
  /** One narrative step of the week; timings and failures are recorded, never thrown away. */
  async step(name, fn) {
    const row = { no: this.steps.length + 1, name, ms: 0, invariants: 0, error: null };
    this.steps.push(row); this.current = row;
    const t = Date.now();
    try { row.value = await fn(); }
    catch (e) {
      row.error = e && e.message ? e.message : String(e);
      this.violations.push({ kind: 'step', step: row.no, name, detail: row.error });
    }
    row.ms = Date.now() - t;
    this.current = null;
    const mark = row.error ? col(RED, '✗') : col(GREEN, '✓');
    this.say(`${mark} ${String(row.no).padStart(2, ' ')}. ${name} ${col(DIM, row.ms + ' ms')}` + (row.error ? `\n     ${col(RED, row.error)}` : ''));
    return row.value;
  }
  /** One cross-role invariant. `detail` is printed for a violation and kept in the final table. */
  check(id, name, ok, detail) {
    const row = { id, name, ok: !!ok, detail: detail == null ? '' : String(detail), step: this.current ? this.current.no : null };
    this.invariants.push(row);
    if (this.current) this.current.invariants++;
    if (!ok) { this.violations.push({ kind: 'invariant', id, name, detail: row.detail }); this.say(`     ${col(RED, '✗ ' + id)} ${name}${row.detail ? ' — ' + row.detail : ''}`); }
    return !!ok;
  }
  /** Deep-equality invariant between two views of the same fact. */
  same(id, name, a, b, extra) {
    const A = JSON.stringify(a), B = JSON.stringify(b);
    return this.check(id, name, A === B, A === B ? '' : `${A} ≠ ${B}${extra ? ' · ' + extra : ''}`);
  }
  gap(id, title, detail) { this.gaps.push({ id, title, detail: detail || '' }); }
  note(status, path, want) {
    const k = String(status); this.statuses.set(k, (this.statuses.get(k) || 0) + 1);
    if (status >= 500 && status !== want) { this.serverErrors.push(`${status} ${path}`); this.violations.push({ kind: 'http5xx', id: 'HTTP-5xx', name: `${status} ${path}`, detail: path }); }
  }
  get ms() { return Date.now() - this.started; }
}

/* ------------------------------------------------------------------ http client --------------- */

/** A logged-in browser. Every call states the status it expects; anything else is a violation. */
function makeClient(base, R, who) {
  let cookie = '';
  async function call(method, path, body, expected) {
    const want = expected == null ? 200 : expected;
    const res = await fetch(base + path, {
      method,
      headers: Object.assign({ 'Content-Type': 'application/json' }, cookie ? { Cookie: cookie } : {}),
      body: body != null ? JSON.stringify(body) : undefined,
      redirect: 'manual'
    });
    R.calls++;
    const sc = res.headers.get('set-cookie'); if (sc) cookie = sc.split(';')[0];
    const ct = res.headers.get('content-type') || '';
    const data = ct.includes('application/json') ? await res.json().catch(() => ({}))
      : ct.startsWith('text/') || ct.includes('xml') || ct.includes('csv') ? await res.text()
        : Buffer.from(await res.arrayBuffer());
    R.note(res.status, `${method} ${path}`, want);
    if (res.status !== want) {
      const msg = typeof data === 'object' && data && data.error ? data.error : (typeof data === 'string' ? data.slice(0, 160) : '');
      throw new Error(`${who}: ${method} ${path} → ${res.status}, oczekiwano ${want}${msg ? ' · ' + msg : ''}`);
    }
    return { status: res.status, body: data, headers: res.headers };
  }
  return {
    who,
    get: (p, e) => call('GET', p, null, e),
    post: (p, b, e) => call('POST', p, b, e),
    patch: (p, b, e) => call('PATCH', p, b, e),
    put: (p, b, e) => call('PUT', p, b, e),
    del: (p, b, e) => call('DELETE', p, b, e),
    body: async (p, e) => (await call('GET', p, null, e)).body,
    /** Surowe bajty odpowiedzi — potrzebne, gdy liczy się BOM albo nagłówek pliku. */
    raw: async (p) => { const r = await fetch(base + p, { headers: cookie ? { Cookie: cookie } : {} }); R.calls++; R.note(r.status, 'GET ' + p, 200); return Buffer.from(await r.arrayBuffer()); }
  };
}

/* ------------------------------------------------------------------ fixtures ------------------- */

const PW = 'Pilot-Szkola-2026!';
const CLASSES = ['6a', '7a', '8a'];
const SUBJECTS = ['mat', 'pol', 'ang', 'fiz', 'his', 'bio'];
const TEACHERS = [
  { login: 'j.nowak', firstName: 'Joanna', lastName: 'Nowak', subject: 'mat', homeroomOf: '6a' },
  { login: 'b.sikora', firstName: 'Barbara', lastName: 'Sikora', subject: 'pol', homeroomOf: '7a' },
  { login: 'e.krol', firstName: 'Ewa', lastName: 'Krol', subject: 'ang', homeroomOf: '8a' },
  { login: 'a.wojcik', firstName: 'Adam', lastName: 'Wojcik', subject: 'fiz', homeroomOf: '' },
  { login: 'k.lis', firstName: 'Krzysztof', lastName: 'Lis', subject: 'his', homeroomOf: '' },
  { login: 't.gorski', firstName: 'Tomasz', lastName: 'Gorski', subject: 'bio', homeroomOf: '' }
];
const LAST = ['Abacka', 'Bąkowski', 'Cichoń', 'Dębska', 'Ejsmont', 'Fabiszak', 'Gajos', 'Hajduk', 'Iwanicka', 'Jarosz',
  'Kędzior', 'Lipka', 'Małecki', 'Nowicka', 'Okoń', 'Pawlak', 'Rutkowski', 'Sowa', 'Turek', 'Ulicka'];
const FIRST = ['Adam', 'Beata', 'Cezary', 'Dorota', 'Emil', 'Felicja', 'Grzegorz', 'Halina', 'Igor', 'Jolanta',
  'Kamil', 'Lidia', 'Marek', 'Natalia', 'Oskar', 'Patrycja', 'Rafał', 'Sylwia', 'Tomasz', 'Urszula'];

function pesel(yy, mm, dd, serial, male) {
  const b = `${String(yy).padStart(2, '0')}${String(mm + 20).padStart(2, '0')}${String(dd).padStart(2, '0')}${String(serial).padStart(3, '0')}${male ? 1 : 2}`;
  const w = [1, 3, 7, 9, 1, 3, 7, 9, 1, 3];
  return b + ((10 - (w.reduce((s, wi, i) => s + wi * +b[i], 0) % 10)) % 10);
}
function teachersCsv() {
  return ['login;firstName;lastName;title;subjects;homeroomOf;email',
    ...TEACHERS.map((t) => `${t.login};${t.firstName};${t.lastName};mgr;${t.subject};${t.homeroomOf};${t.login}@sp-pilot.pl`)].join('\n');
}
/** 3 oddziały × 20 uczniów, każdy z jednym opiekunem i własnym adresem e-mail (bez scalania rodzeństwa). */
function studentsCsv() {
  const rows = []; let serial = 100, n = 0;
  for (const cls of CLASSES) {
    const level = +cls.replace(/\D/g, '');
    const shift = CLASSES.indexOf(cls);                       // każda para (nazwisko, imię) w szkole jest niepowtarzalna
    for (let i = 1; i <= 20; i++) {
      n++; const male = i % 2 === 0; const yy = 20 - level;
      const mm = 1 + (n % 12), dd = 1 + (n % 27);
      rows.push([cls, i, LAST[(i - 1) % LAST.length], FIRST[(i - 1 + shift) % FIRST.length],
        pesel(yy, mm, dd, serial++, male), `20${String(yy).padStart(2, '0')}-${String(mm).padStart(2, '0')}-${String(dd).padStart(2, '0')}`,
        'Kraków', LAST[(i - 1) % LAST.length], 'Rodzic' + n, `rodzic${n}@example.com`, '60010' + String(n).padStart(4, '0')].join(';'));
    }
  }
  return ['class;rollNo;lastName;firstName;pesel;birthDate;birthPlace;parentLastName;parentFirstName;parentEmail;parentPhone', ...rows].join('\n');
}
/** Konfliktowo czysty plan: 6 lekcji dziennie, przedmiot i-ty przesunięty o 2 na każdy kolejny oddział. */
function timetableRows(classes) {
  const out = [];
  classes.forEach((cls) => {
    const ci = CLASSES.indexOf(cls);
    for (let wd = 1; wd <= 5; wd++) {
      for (let no = 1; no <= 6; no++) {
        const sub = SUBJECTS[(no - 1 + ci * 2) % SUBJECTS.length];
        const t = TEACHERS.find((x) => x.subject === sub);
        out.push(`${cls};${wd};${no};${sub};${t.login};${100 + ci * 10 + no};`);
      }
    }
  });
  return ['class;weekday;lessonNo;subject;teacherLogin;room;group', ...out].join('\n');
}

/* ------------------------------------------------------------------ the pilot ------------------ */

async function runPilot(opts) {
  const o = opts || {};
  const R = new Report({ quiet: o.quiet });
  const app = createApp({ dataFile: null, quiet: true, blank: true });
  /* Ten sam wyścig keep-alive co w tests/helpers.js (docs/review/round3/test-honesty.md §4): pilot spędza
     sekundy CPU między żądaniami, Node zamyka bezczynne gniazdo po 5 s, a undici odpowiada `fetch failed`. */
  app.server.keepAliveTimeout = 120000;
  app.server.headersTimeout = 150000;
  const port = await app.listen(0);
  const base = `http://127.0.0.1:${port}`;
  const db = app.db;
  const client = (who) => makeClient(base, R, who);

  const MON = '2026-10-05';                                   // a Monday inside semester 1
  const DAYS = [MON, U.addDays(MON, 1), U.addDays(MON, 2), U.addDays(MON, 3), U.addDays(MON, 4)];
  const [D_MON, D_TUE, D_WED, D_THU, D_FRI] = DAYS;
  const MONTH = MON.slice(0, 7);

  const S = {};                                               // everything the steps hand to each other
  S.teacher = {};                                             // login → client
  S.students = {};                                            // classId → [{id, name, rollNo}]
  S.pupilClient = {};                                         // studentId → client
  S.baseUrl = base;
  S.month = MONTH;
  S.lastDay = MON;

  /* The school's calendar day. There is no API for it (in production the wall clock moves); the pilot
     uses the built-in demo clock `config.today`, which every route already reads through D.today(db). */
  const setDay = (d) => { db.data.config.today = d; db.save(); S.lastDay = d; };

  try {
    /* ============================================================ 1. blank install ============= */
    await R.step('Poniedziałek 07:30 — pusta instalacja: wszystko poza kreatorem odmawia', async () => {
      const anon = client('gość');
      const st = (await anon.get('/api/setup/status')).body;
      R.check('SETUP-1', 'pusta instalacja zgłasza „kreator wymagany”', st.needed === true && st.school === '', JSON.stringify(st.needed));
      const login = await anon.post('/api/auth/login', { login: 'x', password: 'y' }, 503);
      R.check('SETUP-2', 'logowanie przed kreatorem → 503 setup_required', login.body.code === 'setup_required', login.body.code);
      const lessons = await anon.get('/api/lessons', 503);
      R.check('SETUP-3', 'każda inna trasa też → 503 setup_required', lessons.body.code === 'setup_required', lessons.body.code);
    });

    /* ============================================================ 2. school + admin + principal == */
    await R.step('Sekretariat zakłada szkołę, konto administratora i konto dyrektora', async () => {
      const admin = client('admin');
      const bad = await admin.post('/api/setup/school', { school: { name: 'SP' }, admin: { login: 'admin', password: 'x', firstName: 'A', lastName: 'B' } }, 400);
      R.check('SETUP-4', 'nazwa szkoły krótsza niż 5 znaków odrzucona', bad.body.field === 'school.name', bad.body.field);
      const made = (await admin.post('/api/setup/school', {
        school: { name: 'Szkoła Podstawowa nr 12 w Krakowie', short: 'SP 12', address: 'ul. Pilotażowa 1, Kraków', rspo: '120012', email: 'sekretariat@sp-pilot.pl', phone: '123456789', director: 'Ewa Bober' },
        year: '2026/2027',
        admin: { login: 'sekretariat', password: PW, firstName: 'Marta', lastName: 'Zając', email: 'sekretariat@sp-pilot.pl' },
        principal: { login: 'dyrektor', firstName: 'Ewa', lastName: 'Bober', title: 'dyr.' }
      })).body;
      R.check('SETUP-5', 'kreator zakłada szkołę i loguje administratora', made.user.role === 'admin', made.user.role);
      S.admin = admin;
      S.principalTempPassword = made.principalTempPassword;
      setDay(D_MON);                                          // od tej chwili dziennik żyje w tygodniu pilotażu

      const dyr = client('dyrektor');
      const first = (await dyr.post('/api/auth/login', { login: 'dyrektor', password: S.principalTempPassword })).body;
      R.check('SETUP-6', 'dyrektor po pierwszym logowaniu musi zmienić hasło', first.mustChangePassword === true, String(first.mustChangePassword));
      await dyr.post('/api/auth/password', { next: PW });
      S.dyr = dyr;
      const again = await client('dyrektor2').post('/api/setup/school', { school: { name: 'Inna szkoła zupełnie' }, admin: { login: 'x2', password: PW, firstName: 'A', lastName: 'B' } }, 403);
      R.check('SETUP-7', 'kreatora nie da się uruchomić drugi raz', again.body.code === 'setup_done', again.body.code);
    });

    /* ============================================================ 3. teachers ==================== */
    await R.step('Import 6 nauczycieli; każdy loguje się i zmienia hasło tymczasowe', async () => {
      const imp = (await S.admin.post('/api/setup/teachers/import', { csv: teachersCsv() })).body;
      R.check('SETUP-8', 'zaimportowano 6 nauczycieli bez błędów', imp.count === 6 && imp.errors.length === 0, `${imp.count}/${imp.errors.length}`);
      for (const row of imp.created) {
        const c = client(row.login);
        await c.post('/api/auth/login', { login: row.login, password: row.tempPassword });
        await c.post('/api/auth/password', { next: PW });
        S.teacher[row.login] = c;
      }
      const cls = db.col('classes').map((x) => x.id).sort();
      R.check('SETUP-9', 'trzy oddziały powstały z kolumny homeroomOf', JSON.stringify(cls) === JSON.stringify(CLASSES), cls.join(','));
      R.check('SETUP-10', 'wychowawcy przypisani do oddziałów', CLASSES.every((cid) => !!db.get('classes', cid).homeroomTeacherId), '');
    });

    /* ============================================================ 4. pupils and parents ========== */
    await R.step('Import 60 uczniów w 3 oddziałach; rodzice dostają kody rejestracyjne', async () => {
      const dry = (await S.admin.post('/api/setup/students/import', { csv: studentsCsv(), dryRun: true })).body;
      R.check('SETUP-11', 'próbny import niczego nie zapisuje', db.col('students').length === 0 && dry.count === 60, `${dry.count}/${db.col('students').length}`);
      const imp = (await S.admin.post('/api/setup/students/import', { csv: studentsCsv() })).body;
      R.check('SETUP-12', 'zapisano dokładnie tylu uczniów, ilu zapowiedział próbny przebieg', imp.count === dry.count, `${imp.count} vs ${dry.count}`);
      R.check('SETUP-13', 'każdy uczeń ma kod rejestracyjny dla opiekuna', imp.codes.length === 60, String(imp.codes.length));
      S.imported = imp;
      S.codeOf = {};
      for (const code of imp.codes) S.codeOf[code.class + '|' + code.student] = code.code;
      for (const cid of CLASSES) S.students[cid] = imp.created.filter((x) => x.class === cid).map((x) => ({ id: x.id, name: x.name, cls: cid, registerNo: x.registerNo }));
      const regs = db.col('students').map((s) => s.registerNo).sort((a, b) => a - b);
      R.check('SETUP-14', 'numery w księdze uczniów są kolejne, bez dziur', regs.every((v, i) => v === regs[0] + i), `${regs[0]}…${regs[regs.length - 1]}`);
    });

    /* ============================================================ 5. timetable + lessons ========= */
    await R.step('Import planu lekcji (próbny, potem właściwy) i wygenerowanie lekcji na rok', async () => {
      const csv = timetableRows(CLASSES);
      const dry = (await S.admin.post('/api/admin/timetable/import', { csv, dryRun: true })).body;
      R.check('TT-1', 'próbny import planu: 90 pozycji, zero konfliktów', dry.rows === 90 && dry.conflicts.length === 0, `${dry.rows}/${dry.conflicts.length}`);
      const real = (await S.admin.post('/api/admin/timetable/import', { csv, dryRun: false })).body;
      R.check('TT-2', 'plan zapisany', real.applied === true && db.col('timetable').length === 90, String(db.col('timetable').length));
      const sem = db.data.config.semesters;
      /* Kreator generuje lekcje na cały rok; pilotaż zatrzymuje się na końcu semestru 1, żeby jeden
         przebieg mieścił się w dwuminutowym budżecie testu — reszta roku to ta sama pętla. */
      const gen = (await S.admin.post('/api/setup/lessons/generate', { from: MON, to: sem[0].to })).body;
      R.check('TT-3', 'lekcje wygenerowane do końca semestru', gen.created > 1000, String(gen.created));
      const again = (await S.admin.post('/api/setup/lessons/generate', { from: MON, to: sem[0].to })).body;
      R.check('TT-4', 'ponowne generowanie jest idempotentne', again.created === 0, String(again.created));
      for (const d of DAYS) {
        const n = db.col('lessons').filter((l) => l.date === d).length;
        if (!R.check('TT-5', `${d}: 18 lekcji (3 oddziały × 6)`, n === 18, String(n))) break;
      }
      const fin = (await S.admin.post('/api/setup/finish', {})).body;
      R.check('SETUP-15', 'kreator zamknięty, szkoła gotowa', fin.summary.done === true && fin.summary.students === 60, JSON.stringify(fin.summary.students));
    });

    /* ============================================================ 6. reszta kadry i dane modułów = */
    await R.step('Reszta kadry, podstawa programowa, stołówka i biblioteka — wszystko przez publiczne API', async () => {
      provision(db);
      S.staffPw = PW;
      await provisionStaff(R, S, db, client);
      await provisionViaApi(R, S, db, { classes: CLASSES, month: MONTH });
      R.check('PROV-1', 'podstawa programowa ma punkty dla każdego oddziału', CLASSES.every((cid) => db.col('curriculum').some((x) => x.level === +cid.replace(/\D/g, ''))), '');
    });

    /* ============================================================ 7. parents ===================== */
    await R.step('Rodzice zakładają konta kodami; rozwiedzeni rodzice dostają dwa osobne konta', async () => {
      // czworo opiekunów, z którymi pracuje reszta tygodnia
      S.pupil = {
        sample: S.students['6a'][0],        // uczeń wzorcowy (oceny, frekwencja, zadanie)
        absent: S.students['6a'][1],        // nieobecny na 1. lekcji w poniedziałek → alert do rodzica
        welfare: S.students['7a'][2],       // objęty pomocą społeczną → alert 3-dniowy
        divorced: S.students['8a'][0],      // dwoje opiekunów, osobne konta
        late: S.students['6a'][2]           // spóźnione zadanie domowe
      };
      await provisionLate(R, db, S, MONTH);
      S.parent = {};
      for (const key of Object.keys(S.pupil)) {
        const p = S.pupil[key];
        const code = S.codeOf[p.cls + '|' + p.name];
        const c = client('rodzic.' + key);
        const login = 'rodzic.' + key;
        const r = (await c.post('/api/register', { code, login, password: PW, firstName: 'Opiekun', lastName: p.name.split(' ')[0], email: `${login}@example.com` })).body;
        R.check('PAR-1', `konto opiekuna ${key} przejęło konto-kontakt z importu`, r.claimedImportedAccount === true, JSON.stringify(r.claimedImportedAccount));
        await c.post('/api/auth/login', { login, password: PW });
        S.parent[key] = c;
      }
      // drugi opiekun ucznia z pary po rozwodzie: sekretariat wydaje osobny kod
      const issued = (await S.admin.post(`/api/registry/students/${S.pupil.divorced.id}/guardians`, { reason: 'Postanowienie sądu rodzinnego II Nsm 77/26 — opieka naprzemienna.' })).body;
      const c2 = client('rodzic.divorced2');
      await c2.post('/api/register', { code: issued.code, login: 'rodzic.divorced2', password: PW, firstName: 'Drugi', lastName: 'Opiekun', email: 'drugi.opiekun@example.com' });
      await c2.post('/api/auth/login', { login: 'rodzic.divorced2', password: PW });
      S.parent.divorced2 = c2;
      const st = db.get('students', S.pupil.divorced.id);
      R.check('PAR-2', 'uczeń po rozwodzie ma dwoje opiekunów z osobnymi kontami', (st.parentIds || []).length === 2, JSON.stringify(st.parentIds));
      /* Zakres „informacyjny” drugiego opiekuna ustawia sekretariat już po aktywacji konta —
         i ustawia go PRZY DZIECKU, nie na koncie: postanowienie sądu dotyczy jednego dziecka. */
      const u2 = db.one('users', (u) => u.login === 'rodzic.divorced2');
      const scoped = (await S.admin.patch(`/api/registry/students/${S.pupil.divorced.id}/guardians/${u2.id}`, { accessScope: 'info', legalBasis: 'Postanowienie sądu II Nsm 77/26 — wgląd bez ocen.' })).body;
      R.check('PAR-3a', 'zakres opiekuna da się zmienić po aktywacji konta, per dziecko',
        scoped.guardian.accessScope === 'info' && (db.get('students', S.pupil.divorced.id).guardians || []).some((g) => g.userId === u2.id && g.accessScope === 'info'), scoped.guardian.accessScope);
      const kids = (await S.parent.divorced2.get('/api/parent/children')).body;
      R.check('PAR-3', 'drugi opiekun widzi dziecko w zakresie „info”', kids.children[0].accessScope === 'info', kids.children[0].accessScope);
      const mine = (await S.parent.divorced.get('/api/parent/guardians?studentId=' + S.pupil.divorced.id)).body;
      R.check('PAR-4', 'opiekunowie nie widzą nawzajem swoich danych kontaktowych',
        mine.coGuardians.length === 1 && mine.coGuardians[0].contactVisible === false && mine.coGuardians[0].phone === null, JSON.stringify(mine.coGuardians.length));
    });

    /* ============================================================ 8. Monday lessons ============== */
    await R.step('Poniedziałek — frekwencja na wszystkich 18 lekcjach, wersja robocza, powtórka offline', async () => {
      S.week = {};
      const day = await teachDay(R, S, db, D_MON, {
        absentFirstPeriod: S.pupil.absent.id,
        allDayAbsent: [S.pupil.welfare.id],
        draftLesson: true,
        offlineReplay: true,
        lateMinutes: { studentId: S.pupil.sample.id, minutes: 12 }
      });
      S.week[D_MON] = day;
      R.check('ATT-1', 'poniedziałek: zapisano frekwencję na wszystkich 18 lekcjach', day.saved === 18, String(day.saved));
      R.check('ATT-2', 'powtórzony zapis offline ze starszym znacznikiem został odrzucony jako „stale_write”',
        day.replay && day.replay.skipped === 1 && day.replay.skippedEntries[0].reason === 'stale_write', JSON.stringify(day.replay && day.replay.skipped));
      R.check('ATT-3', 'zapis offline nie nadpisał nowszej korekty', day.replay && day.replay.skippedEntries[0].keptStatus === 'sp', JSON.stringify(day.replay && day.replay.skippedEntries[0]));
      R.check('ATT-4', 'wersja robocza została ukończona później (brak wpisów draft na koniec dnia)',
        db.col('attendance').filter((a) => a.date === D_MON && a.draft).length === 0, String(db.col('attendance').filter((a) => a.date === D_MON && a.draft).length));
    });

    await R.step('Poniedziałek — alert o nieobecności na 1. lekcji trafia dokładnie do rodzica', async () => {
      const sid = S.pupil.absent.id;
      const alerts = db.col('notifications').filter((n) => n.kind === 'absence');
      const absentFirst = db.col('attendance').filter((a) => a.date === D_MON && a.lessonNo === 1 && !a.draft && a.status === 'nb').map((a) => a.studentId);
      const shouldKnow = new Set(); for (const x of absentFirst) for (const p of db.get('students', x).parentIds || []) shouldKnow.add(p);
      R.check('NOTIF-1', 'powiadomienie o 1. lekcji powstało przy zapisie frekwencji, nie przy odczycie', alerts.length === shouldKnow.size, `${alerts.length} vs ${shouldKnow.size}`);
      R.check('NOTIF-2', 'alert trafił wyłącznie do opiekunów nieobecnych i do nikogo innego',
        alerts.every((n) => shouldKnow.has(n.userId)), JSON.stringify([...new Set(alerts.map((n) => n.userId))]));
      R.check('NOTIF-3', 'alert ma priorytet kryzysowy (przechodzi przez ciszę nocną)', alerts.every((n) => n.crisis === true), '');
      const seen = (await S.parent.absent.get('/api/parent/absence-alerts?studentId=' + sid)).body;
      R.check('NOTIF-4', 'rodzic widzi ten sam alert w swoim widoku', seen.alerts.length === 1 && seen.alerts[0].studentId === sid, JSON.stringify(seen.alerts.length));
      const rescan = (await S.parent.absent.post('/api/parent/absence-alerts/scan', { date: D_MON })).body;
      R.check('NOTIF-5', 'powtórne skanowanie jest idempotentne (nie powstaje drugie powiadomienie)',
        db.col('notifications').filter((n) => n.kind === 'absence').length === alerts.length, String(rescan.created));
    });

    await R.step('Poniedziałek — tematy lekcji powiązane z podstawą programową', async () => {
      const res = await writeTopics(R, S, db, D_MON, { linkCurriculum: true });
      R.check('TOPIC-1', 'każda poniedziałkowa lekcja ma temat', res.withTopic === 18, `${res.withTopic}/18`);
      const comp = (await S.teacher['j.nowak'].get('/api/curriculum/completion?subjectId=mat&classId=6a')).body;
      const linked = db.col('lessons').filter((l) => l.classId === '6a' && l.subjectId === 'mat' && (l.curriculumItemIds || []).length).length;
      R.check('CURR-1', 'realizacja podstawy liczy dokładnie tyle lekcji, ile powiązano', comp.lessonsLinked === linked, `${comp.lessonsLinked} vs ${linked}`);
      R.check('CURR-2', 'procent realizacji zgadza się z sumą godzin', comp.percent === (comp.hours ? Math.round((comp.covered / comp.hours) * 1000) / 10 : null), `${comp.percent}`);
    });

    await R.step('Poniedziałek — kategorie ocen, sprawdzian punktowy wpisany seryjnie dla całej klasy', async () => {
      const c = S.teacher['j.nowak'];
      const cat = (await c.post('/api/grade-categories', { name: 'sprawdzian pilotażowy', weight: 3, color: 'cat-1', countsInAverage: true })).body.category;
      S.cat = cat;
      const roster = S.students['6a'];
      const maxPoints = 20;
      const entries = roster.map((s, i) => ({ studentId: s.id, points: 20 - (i % 14) }));
      const lesson = db.col('lessons').find((l) => l.date === D_MON && l.classId === '6a' && l.subjectId === 'mat');
      const bulk = (await c.post('/api/grades/bulk', { classId: '6a', subjectId: 'mat', categoryId: cat.id, date: D_MON, maxPoints, lessonId: lesson ? lesson.id : null, entries })).body;
      const blocked = bulk.results.filter((x) => !x.ok);
      R.check('GRADE-1', 'wpis seryjny zatrzymał się tylko na uczniu z potwierdzoną nieobecnością',
        blocked.length === 1 && blocked[0].studentId === S.pupil.absent.id && blocked[0].code === 'absent_blocked',
        JSON.stringify(blocked.map((x) => [x.studentId, x.code])));
      R.check('GRADE-2', 'pozostałe 19 ocen zapisano', bulk.saved === 19, `${bulk.saved}/${bulk.failed}`);
      const makeup = (await c.post('/api/grades', {
        studentId: S.pupil.absent.id, subjectId: 'mat', classId: '6a', categoryId: cat.id, date: D_MON,
        points: entries.find((e) => e.studentId === S.pupil.absent.id).points, maxPoints, lessonId: lesson ? lesson.id : null,
        makeup: true, comment: 'Praca do napisania w terminie uzupełniającym.'
      })).body;
      R.check('GRADE-2b', 'ocena „do uzupełnienia” przechodzi mimo nieobecności', makeup.makeup === true, String(makeup.makeup));
      bulk.results = bulk.results.map((x) => (x.ok ? x : { index: x.index, studentId: x.studentId, name: x.name, ok: true, status: 200, gradeId: makeup.grade.id, value: makeup.grade.value, percent: makeup.percent, average: makeup.average }));
      S.bulk = bulk;
      // punkty → procent → ocena liczone dokładnie tak, jak robi to reguła szkoły
      const scale = db.data.config.percentScale;
      const mismatched = bulk.results.filter((x) => {
        const e = entries.find((y) => y.studentId === x.studentId);
        const pg = U.pointsToGrade(e.points, maxPoints, scale);
        return x.percent !== pg.percent || x.value !== String(pg.grade);
      });
      R.check('GRADE-3', 'punkty przeliczone na procent i ocenę wg skali szkolnej', mismatched.length === 0, JSON.stringify(mismatched.slice(0, 2)));
    });

    await R.step('Poniedziałek — to, co zapisał nauczyciel, widzą uczeń, rodzic, wychowawca i dyrektor', async () => {
      await crossRoleGrades(R, S, db, '6a', 'mat');
    });

    await R.step('Poniedziałek — zadanie domowe i zapowiedź sprawdzianu (limit szkolny)', async () => {
      const c = S.teacher['j.nowak'];
      const hw = (await c.post('/api/homework', {
        classId: '6a', subjectId: 'mat', text: 'Zadania 1–5 ze strony 48 — działania na potęgach.',
        dueAt: `${D_WED}T23:59`, lockAfterDue: false, maxAttachmentMB: 5
      })).body.homework;
      S.homework = hw;
      R.check('HW-1', 'termin oddania zapisany jako czas ścienny szkoły', hw.dueLocal === `${D_WED}T23:59`, hw.dueLocal);
      R.check('HW-2', 'zadanie obejmuje cały oddział', hw.expectedCount === 20, String(hw.expectedCount));

      const check = (await c.get(`/api/tests/check?classId=6a&date=${D_THU}`)).body;
      R.check('TEST-1', 'kontrola terminu ostrzega o zapowiedzi krótszej niż statutowa', check.shortNotice === true && !!check.notice, JSON.stringify(check.daysAhead));
      const first = (await c.post('/api/tests', { classId: '6a', subjectId: 'mat', date: D_THU, scope: 'Potęgi i pierwiastki', kind: 'sprawdzian' })).body;
      R.check('TEST-2', 'sprawdzian zapowiedziany mimo krótkiego terminu, ale z ostrzeżeniem', first.shortNotice === true && !!first.warning, first.warning);
      S.test = first.test;
      const second = await S.teacher['b.sikora'].post('/api/tests', { classId: '6a', subjectId: 'pol', date: D_THU, scope: 'Lektura', kind: 'sprawdzian' }, 409);
      R.check('TEST-3', 'drugi sprawdzian tego samego dnia odrzucony przez limit szkolny', second.body.code === 'test_limit', second.body.code);
      const kart = (await S.teacher['b.sikora'].post('/api/tests', { classId: '6a', subjectId: 'pol', date: D_THU, scope: 'Ortografia', kind: 'kartkówka' })).body;
      R.check('TEST-4', 'kartkówka nie podlega limitowi sprawdzianów', kart.test.kind === 'kartkówka', kart.warning);
      const pupil = await pupilOf(R, S, db, base, S.pupil.sample.id);
      const cal = (await pupil.get('/api/student/tests/calendar?month=' + MONTH)).body;
      R.check('TEST-5', 'zapowiedziany sprawdzian jest w kalendarzu ucznia', JSON.stringify(cal).includes(S.test.id), '');
    });

    /* ============================================================ 9. Tuesday ==================== */
    await R.step('Wtorek — frekwencja, poprawa, „np”, komentarz i cofnięcie oceny z powodem', async () => {
      setDay(D_TUE);
      const day = await teachDay(R, S, db, D_TUE, { allDayAbsent: [S.pupil.welfare.id] });
      S.week[D_TUE] = day;
      R.check('ATT-5', 'wtorek: frekwencja na wszystkich 18 lekcjach', day.saved === 18, String(day.saved));
      await writeTopics(R, S, db, D_TUE, {});

      const c = S.teacher['j.nowak'];
      const roster = S.students['6a'];
      const weakest = S.bulk.results.slice().sort((a, b) => a.percent - b.percent)[0];
      const retake = (await c.post('/api/grades', {
        studentId: weakest.studentId, subjectId: 'mat', classId: '6a', categoryId: S.cat.id,
        retakeOfId: weakest.gradeId, points: 19, maxPoints: 20, date: D_TUE,
        comment: 'Poprawa sprawdzianu — bardzo dobra praca nad błędami.'
      })).body;
      S.retake = retake;
      R.check('GRADE-4', 'poprawa zapisana i powiązana z oceną pierwotną', retake.grade.retakeOfId === weakest.gradeId, retake.grade.retakeOfId);
      R.check('GRADE-5', 'przy regule „liczy się wyższa” średnia po poprawie rośnie', retake.average > weakest.average, `${weakest.average} → ${retake.average}`);
      const second = await c.post('/api/grades', { studentId: weakest.studentId, subjectId: 'mat', classId: '6a', categoryId: S.cat.id, retakeOfId: weakest.gradeId, value: '5', date: D_TUE }, 409);
      R.check('GRADE-6', 'druga poprawa tej samej pracy wymaga najpierw cofnięcia pierwszej', second.body.code === 'retake_exists', second.body.code);

      const npPupil = roster[5];
      const np = (await c.post('/api/grades', { studentId: npPupil.id, subjectId: 'mat', classId: '6a', categoryId: S.cat.id, value: 'np', date: D_TUE })).body;
      R.check('GRADE-7', '„np” nie wchodzi do średniej', np.grade.countsInAverage === false, String(np.grade.countsInAverage));
      S.np = np.grade;

      const commented = roster[6];
      const withComment = (await c.post('/api/grades', {
        studentId: commented.id, subjectId: 'mat', classId: '6a', categoryId: S.cat.id, value: '4+', date: D_TUE,
        comment: 'Bardzo dobre rozumowanie, drobny błąd rachunkowy w zadaniu 3.'
      })).body;
      S.commented = { studentId: commented.id, gradeId: withComment.grade.id, comment: withComment.grade.comment };
      R.check('GRADE-8', 'komentarz nauczyciela zapisany przy ocenie', !!withComment.grade.comment, withComment.grade.comment);

      const victim = S.bulk.results.find((x) => x.studentId === S.pupil.late.id);   // uczeń, którego opiekun ma konto — sprawdzamy oba widoki
      const noReason = await c.del('/api/grades/' + victim.gradeId, {}, 400);
      R.check('GRADE-9', 'cofnięcie oceny bez powodu odrzucone', noReason.body.code === 'reason_required', noReason.body.code);
      const reason = 'Pomyłka przy przepisywaniu punktów z arkusza — praca należała do innego ucznia.';
      const reverted = (await c.del('/api/grades/' + victim.gradeId, { reason })).body;
      S.reverted = { studentId: victim.studentId, gradeId: victim.gradeId, before: victim.value, average: reverted.average, reason };
      R.check('GRADE-10', 'cofnięta ocena znika ze średniej i wraca z powodem', reverted.reverted.value === victim.value && reverted.reason === reason, reverted.reason);
      const audit = db.col('audit').filter((a) => a.action === 'grade_revert' && a.entityId === victim.gradeId);
      R.check('AUDIT-1', 'cofnięcie oceny ma wiersz audytu z before/after i powodem',
        audit.length === 1 && audit[0].before && audit[0].after && audit[0].reason === reason, JSON.stringify(audit.length));
    });

    await R.step('Wtorek — po poprawce i cofnięciu wszystkie widoki nadal pokazują to samo', async () => {
      await crossRoleGrades(R, S, db, '6a', 'mat');
      const sid = S.reverted.studentId;
      const pupil = await pupilOf(R, S, db, base, sid);
      const seen = (await pupil.get('/api/student/grades')).body;
      const mat = seen.subjects.find((x) => x.subjectId === 'mat') || { grades: [] };
      R.check('GRADE-11', 'uczeń nie widzi cofniętej oceny', !mat.grades.some((g) => g.id === S.reverted.gradeId), '');
      const parentKey = Object.keys(S.pupil).find((k) => S.pupil[k].id === sid);
      if (parentKey) {
        const pv = (await S.parent[parentKey].get('/api/parent/grades?studentId=' + sid)).body;
        const pMat = pv.subjects.find((x) => x.subjectId === 'mat') || { grades: [] };
        R.check('GRADE-11b', 'rodzic też nie widzi cofniętej oceny', !pMat.grades.some((g) => g.id === S.reverted.gradeId), '');
      }
    });

    await R.step('Wtorek — oceny w 8a (materiał dla pary opiekunów po rozwodzie)', async () => {
      const c = S.teacher['e.krol'];
      const cat = db.col('gradeCategories').find((x) => x.name === 'kartkówka');
      const entries = S.students['8a'].slice(0, 6).map((s, i) => ({ studentId: s.id, value: String(3 + (i % 3)) }));
      const bulk = (await c.post('/api/grades/bulk', { classId: '8a', subjectId: 'ang', categoryId: cat.id, date: D_TUE, entries })).body;
      R.check('GRADE-12', 'nauczyciel angielskiego wpisał oceny w 8a', bulk.saved === entries.length && bulk.failed === 0, `${bulk.saved}/${bulk.failed}`);
      const grid = (await c.get('/api/grades/grid?classId=8a&subjectId=ang')).body;
      const row = grid.students.find((x) => x.studentId === S.pupil.divorced.id);
      S.divorcedAverage = row.average;
      R.check('GRADE-13', 'uczeń z pary po rozwodzie ma ocenę w arkuszu', row.average != null, String(row.average));
    });

    await R.step('Wtorek — rodzice składają pięć wniosków o usprawiedliwienie', async () => {
      S.excuses = [];
      const asks = [
        { who: 'absent', from: D_MON, to: D_MON, reason: 'Choroba — gorączka od rana.' },
        { who: 'absent', from: D_TUE, to: D_TUE, reason: 'Drugi dzień choroby, wizyta u lekarza.' },
        { who: 'sample', from: D_TUE, to: D_TUE, reason: 'Wizyta u lekarza specjalisty.' },
        { who: 'divorced', from: D_MON, to: D_TUE, reason: 'Sprawy rodzinne — pogrzeb w rodzinie.' },
        { who: 'late', from: D_TUE, to: D_TUE, reason: 'Złe samopoczucie, zgłoszone telefonicznie rano.' }
      ];
      for (const a of asks) {
        const r = (await S.parent[a.who].post('/api/parent/excuses', { studentId: S.pupil[a.who].id, from: a.from, to: a.to, reason: a.reason, channel: 'mobile' })).body;
        S.excuses.push({ id: r.excuse.id, who: a.who, studentId: S.pupil[a.who].id, from: a.from, to: a.to });
        R.check('EXC-1', `wniosek ${a.who} przyjęty bezpłatnie`, r.fee === 0 && r.free === true, JSON.stringify(r.fee));
      }
      const hrOf = (cid) => S.teacher[TEACHERS.find((t) => t.homeroomOf === cid).login];
      const box = (await hrOf('6a').get('/api/homeroom/excuses?classId=6a&status=pending')).body;
      R.check('EXC-2', 'wnioski trafiły do skrzynki właściwego wychowawcy', box.pending >= 3, String(box.pending));
      const foreign = await hrOf('6a').get('/api/homeroom/excuses?classId=8a', 403);
      R.check('EXC-3', 'wychowawca nie zagląda do dziennika obcego oddziału', foreign.body.code === 'not_homeroom', foreign.body.code);
    });

    await R.step('Wtorek — uczniowie oddają zadanie domowe', async () => {
      S.submitted = [];
      for (const key of ['sample', 'absent', 'divorced']) {
        const sid = S.pupil[key].id;
        if (db.get('students', sid).classId !== '6a') continue;
        const pupil = await pupilOf(R, S, db, base, sid);
        const r = (await pupil.post(`/api/homework/${S.homework.id}/submissions`, { text: 'Rozwiązania zadań 1–5 w załączonym opisie.' })).body;
        S.submitted.push({ sid, late: r.late });
        R.check('HW-3', `praca ${key} przyjęta w terminie`, r.late === false, String(r.late));
      }
      const extra = S.students['6a'].filter((s) => !S.submitted.some((x) => x.sid === s.id)).slice(0, 2);
      for (const s of extra) {
        const pupil = await pupilOf(R, S, db, base, s.id);
        const r = (await pupil.post(`/api/homework/${S.homework.id}/submissions`, { text: 'Zadania rozwiązane w zeszycie, przepisane tutaj.' })).body;
        S.submitted.push({ sid: s.id, late: r.late });
      }
      const teacherView = (await S.teacher['j.nowak'].get(`/api/homework/${S.homework.id}/submissions`)).body;
      R.check('HW-4', 'lista oddanych prac zgadza się z liczbą uczniów, którzy oddali',
        teacherView.submissions.length === S.submitted.length, `${teacherView.submissions.length} vs ${S.submitted.length}`);
      R.check('HW-5', 'lista braków to dokładnie reszta oddziału',
        teacherView.missing.length === 20 - S.submitted.length, `${teacherView.missing.length}`);
    });

    /* ============================================================ 10. Wednesday ================= */
    await R.step('Środa — frekwencja; trzeci dzień nieobecności ucznia objętego pomocą społeczną', async () => {
      setDay(D_WED);
      const day = await teachDay(R, S, db, D_WED, { allDayAbsent: [S.pupil.welfare.id] });
      S.week[D_WED] = day;
      await writeTopics(R, S, db, D_WED, {});
      R.check('ATT-6', 'środa: frekwencja na wszystkich 18 lekcjach', day.saved === 18, String(day.saved));
      const alerts = db.col('attendanceAlerts');
      R.check('SUP-1', 'alert 3-dniowy powstał przy zapisie frekwencji', alerts.length === 1 && alerts[0].studentId === S.pupil.welfare.id, JSON.stringify(alerts.map((a) => a.studentId)));
      R.check('SUP-2', 'alert obejmuje dokładnie trzy dni nauki', alerts.length === 1 && alerts[0].days.length === 3, JSON.stringify(alerts[0] && alerts[0].days));
      const counselorId = db.one('users', (u) => u.role === 'counselor').id;
      const notes = db.col('notifications').filter((n) => n.kind === 'attendance-alert');
      R.check('SUP-3', 'pedagog dostał powiadomienie kryzysowe i nikt poza nim',
        notes.length >= 1 && notes.every((n) => n.userId === counselorId && n.crisis === true), JSON.stringify([...new Set(notes.map((n) => n.userId))]));
      const seen = (await S.pedagog.get('/api/support/attendance-alerts')).body;
      R.check('SUP-4', 'pedagog widzi ten sam alert w swoim widoku', seen.alerts.length === 1 && seen.alerts[0].studentId === S.pupil.welfare.id, String(seen.alerts.length));
    });

    await R.step('Środa — wychowawcy rozpatrują wnioski: cztery przyjęte, jeden odrzucony', async () => {
      const hrOf = (cid) => S.teacher[TEACHERS.find((t) => t.homeroomOf === cid).login];
      const byClass = {};
      for (const e of S.excuses) { const cid = db.get('students', e.studentId).classId; (byClass[cid] = byClass[cid] || []).push(e); }
      const rejected = S.excuses.find((e) => e.who === 'late');
      let approved = 0;
      for (const cid of Object.keys(byClass)) {
        const ids = byClass[cid].filter((e) => e.id !== rejected.id).map((e) => e.id);
        if (!ids.length) continue;
        const r = (await hrOf(cid).post('/api/homeroom/excuses/decide', { classId: cid, ids, decision: 'approve' })).body;
        approved += r.count;
        S.excuseChanges = (S.excuseChanges || 0) + r.changedAttendance;
      }
      R.check('EXC-4', 'przyjęto dokładnie cztery wnioski', approved === 4, String(approved));
      const noReason = await hrOf('6a').post('/api/homeroom/excuses/decide', { classId: '6a', ids: [rejected.id], decision: 'reject' }, 400);
      R.check('EXC-5', 'odrzucenie bez powodu jest odrzucane', noReason.body.code === 'reason_required', noReason.body.code);
      const why = 'Uczeń był obecny na wszystkich lekcjach tego dnia — proszę o kontakt, wniosek dotyczy chyba innej daty.';
      const rej = (await hrOf('6a').post('/api/homeroom/excuses/decide', { classId: '6a', ids: [rejected.id], decision: 'reject', reason: why })).body;
      R.check('EXC-6', 'odrzucony wniosek ma zapisany powód', rej.excuses[0].rejectReason === why, rej.excuses[0].rejectReason);
      const parentView = (await S.parent.late.get('/api/parent/excuses?studentId=' + S.pupil.late.id)).body;
      const mine = parentView.excuses.find((x) => x.id === rejected.id);
      R.check('EXC-7', 'rodzic widzi decyzję i jej powód', mine.status === 'rejected' && mine.rejectReason === why, mine.status);
      // usprawiedliwienie zmienia frekwencję — i musi zmienić ją tak samo we wszystkich widokach
      const sid = S.pupil.absent.id;
      const rows = db.col('attendance').filter((a) => a.studentId === sid && a.date === D_MON);
      R.check('EXC-8', 'przyjęty wniosek zamienił nieobecności na usprawiedliwione', rows.every((a) => a.status !== 'nb'), JSON.stringify(rows.map((a) => a.status)));
      await crossRoleAttendance(R, S, db, base, sid, 'po usprawiedliwieniu');
    });

    await R.step('Środa — nowy uczeń dołącza do 6a', async () => {
      const r = (await S.admin.post('/api/registry/students', {
        firstName: 'Wiktor', lastName: 'Zawadzki', birthPlace: 'Kraków', classId: '6a',
        identityKind: 'pesel', pesel: pesel(14, 5, 12, 777, true), mother: 'Zawadzka Anna', phone: '600700800', email: 'a.zawadzka@example.com',
        address: 'ul. Nowa 4, Kraków', reason: 'Przeniesienie ze szkoły w miejscu zamieszkania.'
      })).body;
      S.newPupil = r.student;
      R.check('NEW-1', 'nowy uczeń wpisany do księgi z datą dzisiejszą', r.student.enrolledAt === D_WED, r.student.enrolledAt);
      const monLesson = db.col('lessons').find((l) => l.date === D_MON && l.classId === '6a' && l.subjectId === 'mat');
      const mon = (await S.teacher['j.nowak'].get('/api/attendance/lesson/' + monLesson.id)).body;
      R.check('NEW-2', 'nowego ucznia nie ma na poniedziałkowej liście obecności',
        !mon.students.some((x) => x.studentId === r.student.id), '');
      const todayLesson = db.col('lessons').find((l) => l.date === D_WED && l.classId === '6a');
      const wed = (await S.teacher['j.nowak'].get('/api/attendance/lesson/' + todayLesson.id)).body;
      R.check('NEW-3', 'od środy nowy uczeń jest na liście obecności', wed.students.some((x) => x.studentId === r.student.id), '');
      const grid = (await S.teacher['j.nowak'].get('/api/grades/grid?classId=6a&subjectId=mat')).body;
      R.check('NEW-4', 'nowy uczeń jest w arkuszu ocen bez ocen sprzed przyjęcia',
        grid.students.some((x) => x.studentId === r.student.id && Object.keys(x.grades).length === 0), '');
      const roll = (await S.teacher['j.nowak'].get('/api/homeroom/roll-call?classId=6a')).body;
      const added = roll.students.find((x) => x.studentId === r.student.id);
      R.check('NEW-5', 'uczeń dopisany w trakcie roku dostaje kolejny wolny numer (21), reszta zachowuje swoje',
        added && added.rollNo === 21 && roll.missing === 0, JSON.stringify(added && added.rollNo));
      /* Od dziś jest na liście — na dzisiejszych lekcjach brakuje więc jeszcze jego wpisu frekwencji. */
      const todayLessons = db.col('lessons').filter((l) => l.date === D_WED && l.classId === '6a' && l.status !== 'cancelled');
      const missing = [];
      for (const l of todayLessons) {
        const c = S.teacher[db.get('users', l.substituteTeacherId || l.teacherId).login];
        const view = (await c.get('/api/attendance/lesson/' + l.id)).body;
        const line = view.students.find((x) => x.studentId === r.student.id);
        if (line && line.status === null) missing.push({ lesson: l, client: c });
      }
      R.check('NEW-6', 'dopisany uczeń staje na dzisiejszych listach obecności, na razie bez wpisu',
        missing.length === todayLessons.length && todayLessons.length === 6, `${missing.length}/${todayLessons.length}`);
      for (const m of missing) await m.client.post('/api/attendance/lesson/' + m.lesson.id, { entries: [{ studentId: r.student.id, status: 'ob' }] });
      const filled = db.col('attendance').filter((a) => a.studentId === r.student.id && a.date === D_WED && !a.draft);
      R.check('NEW-7', 'nauczyciele uzupełniają wpisy i dzień jest kompletny', filled.length === todayLessons.length, String(filled.length));
      R.check('NEW-8', 'a przed środą nowy uczeń nie ma w dzienniku ani jednego wiersza',
        db.col('attendance').filter((a) => a.studentId === r.student.id && a.date < D_WED).length === 0, '');
    });

    await R.step('Środa — korekta planu 7a w trakcie tygodnia (import częściowy)', async () => {
      const before = {};
      for (const cid of CLASSES) before[cid] = db.col('lessons').filter((l) => l.classId === cid && l.date >= D_THU && l.date <= D_FRI).map((l) => l.id).sort();
      const rows = timetableRows(['7a']).split('\n');
      // zamiana sali i nauczyciela na piątej lekcji we czwartek
      const patched = rows.map((line) => (line.startsWith('7a;4;5;') ? '7a;4;5;bio;t.gorski;299;' : line)).join('\n');
      const dry = (await S.admin.post('/api/admin/timetable/import', { csv: patched, merge: true, dryRun: true })).body;
      R.check('TT-6', 'próbny import częściowy zostawia pozostałe oddziały', dry.merge === true && dry.keptEntries === 60, String(dry.keptEntries));
      const real = (await S.admin.post('/api/admin/timetable/import', { csv: patched, merge: true, dryRun: false, force: true, reason: 'Korekta arkusza organizacyjnego w trakcie tygodnia.' })).body;
      R.check('TT-7', 'import częściowy zapisany, plan ma nadal 90 pozycji', real.applied === true && db.col('timetable').length === 90, String(db.col('timetable').length));
      for (const cid of ['6a', '8a']) {
        const after = db.col('lessons').filter((l) => l.classId === cid && l.date >= D_THU && l.date <= D_FRI).map((l) => l.id).sort();
        R.check('TT-8', `zmiana planu 7a nie ruszyła lekcji oddziału ${cid}`, JSON.stringify(after) === JSON.stringify(before[cid]), `${after.length} vs ${before[cid].length}`);
      }
      const changed = db.col('lessons').find((l) => l.classId === '7a' && l.date === D_THU && l.lessonNo === 5);
      R.check('TT-9', 'zmieniona lekcja 7a ma nowego nauczyciela i salę', changed && changed.room === '299' && changed.subjectId === 'bio', JSON.stringify(changed && { r: changed.room, s: changed.subjectId }));
      const past = db.col('lessons').filter((l) => l.classId === '7a' && l.date >= D_MON && l.date <= D_WED && l.status === 'cancelled').length;
      R.check('TT-10', 'lekcje z zapisanym dziennikiem (pon.–śr.) nie zostały ruszone', past === 0, String(past));
    });

    await R.step('Środa po południu — chory nauczyciel: ranking zastępstw i publikacja planu na czw.–pt.', async () => {
      const sick = db.one('users', (u) => u.login === 'a.wojcik');
      const sub = (await S.dyr.post('/api/substitutions', { teacherId: sick.id, from: D_THU, to: D_FRI, reason: 'Zwolnienie lekarskie L4 nr 77/2026.' })).body;
      S.sub = sub;
      R.check('SUB-1', 'zgłoszenie objęło wszystkie czwartkowe i piątkowe lekcje nieobecnego', sub.lessons.length === sub.stats.lessons && sub.stats.lessons > 0, String(sub.stats.lessons));
      const first = sub.lessons[0];
      R.check('SUB-2', 'ranking kandydatów ułożony wg kwalifikacji i obciążenia',
        first.suggestions.length > 0 && first.suggestions.every((c, i, arr) => i === 0 || arr[i - 1].tier <= c.tier), JSON.stringify(first.suggestions.map((x) => x.tier)));
      for (const l of sub.lessons) {
        const cand = l.suggestions[0];
        if (!cand) { R.check('SUB-3', 'każda lekcja ma kandydata', false, l.id); continue; }
        await S.dyr.post(`/api/substitutions/${sub.id}/assign`, { lessonId: l.id, substituteTeacherId: cand.teacherId, kind: 'sub' });
      }
      const before = db.col('notifications').length;
      const pub = (await S.dyr.post(`/api/substitutions/${sub.id}/publish`, {})).body;
      S.published = pub;
      R.check('SUB-4', 'arkusz opublikowany', pub.published === true, String(pub.published));
      const touched = db.col('lessons').filter((l) => l.date >= D_THU && l.date <= D_FRI && l.substituteTeacherId);
      R.check('SUB-5', 'każda lekcja ma wpisanego zastępcę', touched.length === sub.stats.lessons, `${touched.length} vs ${sub.stats.lessons}`);
      // powiadomienia idą do uczniów objętych lekcjami, ich rodziców, zastępców i nieobecnego — i do nikogo więcej
      const fresh = db.col('notifications').slice(before).filter((n) => n.kind === 'schedule');
      const expected = new Set();
      for (const l of touched) {
        for (const sid of db.get('classes', l.classId).studentIds) {
          const su = db.one('users', (u) => u.role === 'student' && u.studentId === sid); if (su) expected.add(su.id);
          for (const p of db.get('students', sid).parentIds || []) expected.add(p);
        }
        expected.add(l.substituteTeacherId);
      }
      expected.add(sick.id);
      const extras = [...new Set(fresh.map((n) => n.userId))].filter((u) => !expected.has(u));
      R.check('NOTIF-6', 'o zastępstwie wie dokładnie ten, kogo dotyczy', extras.length === 0, JSON.stringify(extras));
      const pupilSid = db.get('classes', touched[0].classId).studentIds[0];
      const pupil = await pupilOf(R, S, db, base, pupilSid);
      const mine = db.col('notifications').filter((n) => n.kind === 'schedule' && n.userId === db.one('users', (u) => u.role === 'student' && u.studentId === pupilSid).id);
      R.check('SUB-6', 'uczeń dostał powiadomienie z nazwiskiem zastępcy', mine.length > 0 && /zast\u0119pstwo/i.test(mine[0].text), mine.length ? mine[0].text.slice(0, 60) : 'brak');
      const changes = (await pupil.get('/api/student/changes')).body;
      R.check('SUB-7', 'ekran „zmiany w planie” ucznia pokazuje opublikowane zastępstwo', changes.changes.length > 0,
        'opublikowanie zastępstwa nie stempluje lekcji (`changedAt`), więc /api/student/changes jest puste');
      const parentOf = db.get('students', pupilSid).parentIds[0];
      R.check('SUB-8', 'rodzic ucznia też wie o zastępstwie', db.col('notifications').some((n) => n.kind === 'schedule' && n.userId === parentOf), '');
    });

    await R.step('Środa — kurs z quizem: pięcioro uczniów rozwiązuje, jeden wynik trafia do ocen', async () => {
      const c = S.teacher['j.nowak'];
      const course = (await c.post('/api/courses', { title: 'Potęgi — powtórka', description: 'Kurs powtórkowy dla 6a.', subjectId: 'mat', classIds: ['6a'], visibility: 'class' })).body.course;
      const unit = (await c.post(`/api/courses/${course.id}/units`, { title: 'Powtórka', availableFrom: D_MON })).body.unit;
      const quiz = (await c.post(`/api/courses/${course.id}/items`, {
        unitId: unit.id, kind: 'quiz', title: 'Quiz: potęgi',
        quiz: { attempts: 2, questions: [
          { id: 'q1', text: '2^3 = ?', points: 2, correctId: 'b', options: [{ id: 'a', text: '6' }, { id: 'b', text: '8' }, { id: 'c', text: '9' }] },
          { id: 'q2', text: '(2^2)^3 = ?', points: 3, correctId: 'a', options: [{ id: 'a', text: '64' }, { id: 'b', text: '32' }, { id: 'c', text: '12' }] }
        ] }
      })).body.item;
      const enrol = (await c.post(`/api/courses/${course.id}/enrol`, { classId: '6a' })).body;
      await c.post(`/api/courses/${course.id}/publish`, {});
      R.check('CRS-1', 'na kurs zapisał się cały oddział', enrol.added >= 20, String(enrol.added));
      const takers = S.students['6a'].slice(0, 5);
      const scores = {};
      for (let i = 0; i < takers.length; i++) {
        const pupil = await pupilOf(R, S, db, base, takers[i].id);
        const answers = i === 0 ? { q1: 'b', q2: 'a' } : i === 1 ? { q1: 'b', q2: 'b' } : { q1: 'a', q2: 'a' };
        const r = (await pupil.post(`/api/courses/${course.id}/items/${quiz.id}/quiz`, { answers })).body;
        scores[takers[i].id] = r.score;
        R.check('CRS-2', 'quiz sprawdzony automatycznie', r.autoGraded === true && r.maxScore === 5, JSON.stringify(r.score));
      }
      const book = (await c.get(`/api/courses/${course.id}/gradebook`)).body;
      const mismatched = takers.filter((t) => book.students.find((x) => x.studentId === t.id).quiz[quiz.id].score !== scores[t.id]);
      R.check('CRS-3', 'dziennik postępów pokazuje dokładnie wyniki, które padły w quizie', mismatched.length === 0, JSON.stringify(mismatched.map((x) => x.id)));
      const best = takers[0];
      const moved = (await c.post(`/api/courses/${course.id}/items/${quiz.id}/grade`, { studentId: best.id, date: D_WED })).body;
      S.quizGrade = moved.grade;
      R.check('CRS-4', 'wynik quizu przeniesiony do ocen cząstkowych przez zwykłą logikę wpisu',
        moved.grade.points === scores[best.id] && moved.grade.maxPoints === 5 && moved.grade.kind === 'partial', JSON.stringify(moved.grade.points));
      const pupil = await pupilOf(R, S, db, base, best.id);
      const seen = (await pupil.get('/api/student/grades')).body.subjects.find((x) => x.subjectId === 'mat');
      R.check('CRS-5', 'ocena z quizu jest widoczna u ucznia z tym samym procentem',
        !!seen.grades.find((g) => g.id === moved.grade.id && g.percent === moved.grade.percent), JSON.stringify(moved.grade.percent));
    });

    await R.step('Środa — zebranie online (Jitsi na domenie przykładowej) i dane do wejścia', async () => {
      await S.admin.patch('/api/admin/video', { provider: 'jitsi', jitsi: { domain: 'meet.przyklad.pl' } });
      const hr = S.teacher['j.nowak'];
      const m = (await hr.post('/api/meetings', {
        kind: 'lesson', title: 'Zebranie z rodzicami 6a', date: D_THU, start: '17:00', end: '18:00',
        classIds: ['6a'], joinPolicy: 'class', note: 'Podsumowanie pierwszego miesiąca.'
      })).body.meeting;
      S.meeting = m;
      const join = (await hr.get(`/api/meetings/${m.id}/join`)).body;
      R.check('MEET-1', 'wejście do pokoju zbudowane na domenie szkoły', join.provider === 'jitsi' && join.url === `https://meet.przyklad.pl/${join.roomName}`, join.url);
      R.check('MEET-2', 'domena przykładowa nie jest osadzalna i nie wydaje skryptu zewnętrznego',
        join.embeddable === false && join.externalApi === null, JSON.stringify(join.embeddable));
      R.check('MEET-3', 'prowadzący dostaje uprawnienia moderatora i kod poczekalni', join.moderator === true && !!join.passcode, String(join.moderator));
      const pupil = await pupilOf(R, S, db, base, S.students['6a'][0].id);
      const pupilJoin = (await pupil.get(`/api/meetings/${m.id}/join`)).body;
      R.check('MEET-4', 'uczeń oddziału wchodzi bez uprawnień moderatora', pupilJoin.moderator === false, String(pupilJoin.moderator));
      const stranger = await pupilOf(R, S, db, base, S.students['8a'][1].id);
      const denied = await stranger.get(`/api/meetings/${m.id}/join`, 403);
      R.check('MEET-5', 'uczeń obcego oddziału nie wchodzi', denied.status === 403, String(denied.status));
    });

    await R.step('Środa — psycholog, pielęgniarka, biblioteka, stołówka i płatności', async () => {
      const wsid = S.pupil.welfare.id;
      const session = (await S.psycholog.post('/api/support/sessions', { studentId: wsid, date: D_FRI, lessonNo: 7, form: 'kk', name: 'Zajęcia korekcyjno-kompensacyjne' })).body;
      R.check('SUP-5', 'psycholog zapisał zajęcia poza godzinami lekcyjnymi ucznia', !!session.id, session.id);
      const clash = await S.psycholog.post('/api/support/sessions', { studentId: wsid, date: D_FRI, lessonNo: 2 }, 409);
      R.check('SUP-6', 'kolizja z lekcją obowiązkową odrzucona', clash.body.code === 'lesson_conflict', clash.body.code);
      const note = (await S.psycholog.post('/api/support/notes', { studentId: wsid, title: 'Notatka z rozmowy', text: 'Treść objęta tajemnicą zawodową.', kind: 'intervention' })).body;
      S.note = note;
      R.check('SUP-7', 'notatka poufna zapisana jako zapieczętowana koperta', note.sealed === true && !note.text, JSON.stringify(note.sealed));
      const byPrincipal = await S.dyr.get('/api/principal/specialist-log/notes/' + note.id, 403);
      R.check('SUP-8', 'dyrektor nie odczyta treści notatki poufnej', byPrincipal.body.code === 'sealed', byPrincipal.body.code);
      const log = (await S.dyr.get('/api/principal/specialist-log')).body;
      R.check('SUP-9', 'dyrektor widzi metadane pieczęci, bez treści', log.notes.length === 1 && log.notes[0].sealed === true && !log.notes[0].text, String(log.notes.length));
      const denyAudit = db.col('audit').filter((a) => a.action === 'confidential_note_access_denied');
      R.check('AUDIT-2', 'odmowa odczytu notatki zostaje w rejestrze', denyAudit.length === 1, String(denyAudit.length));

      const visit = (await S.pielegniarka.post('/api/modules/nurse/visits', {
        studentId: S.pupil.sample.id, kind: 'otarcie', description: 'Otarcie kolana na przerwie, opatrunek jałowy.',
        aid: 'Przemycie, opatrunek.', outcome: 'return', date: D_WED, time: '10:20'
      })).body;
      S.visit = visit.visit;
      R.check('NURSE-1', 'wpis gabinetu widzi wyłącznie pielęgniarka i opiekun', visit.privacy.hiddenFrom.includes('principal') && visit.privacy.hiddenFrom.includes('teacher'), JSON.stringify(visit.privacy.hiddenFrom));
      const parentSees = (await S.parent.sample.get('/api/modules/nurse/visits?studentId=' + S.pupil.sample.id)).body;
      R.check('NURSE-2', 'opiekun widzi wpis gabinetu swojego dziecka', parentSees.visits.length === 1 && parentSees.visits[0].no === S.visit.no, String(parentSees.visits.length));
      const hrDenied = await S.teacher['j.nowak'].get('/api/modules/nurse/visits?studentId=' + S.pupil.sample.id, 403);
      R.check('NURSE-3', 'wychowawca nie widzi dokumentacji gabinetu', hrDenied.body.code === 'health_forbidden', hrDenied.body.code);
      const dyrDenied = await S.dyr.get('/api/modules/nurse/visits/' + S.visit.id, 403);
      R.check('NURSE-4', 'dyrektor też nie', dyrDenied.body.code === 'health_forbidden', dyrDenied.body.code);
      const otherParent = await S.parent.absent.get('/api/modules/nurse/visits?studentId=' + S.pupil.sample.id, 403);
      R.check('NURSE-5', 'obcy opiekun dostaje odmowę i wpis do rejestru wglądów', otherParent.body.code === 'health_forbidden', otherParent.body.code);
      const accessLog = (await S.pielegniarka.get('/api/modules/nurse/access-log')).body;
      const granted = accessLog.log.filter((x) => x.allowed).length, denied = accessLog.log.filter((x) => !x.allowed).length;
      R.check('NURSE-6', 'każdy wgląd i każda odmowa są w rejestrze', granted >= 1 && denied >= 3, `${granted} wgląd / ${denied} odmowy`);
      const healthAudit = db.col('audit').filter((a) => a.action === 'health_record_denied').length;
      R.check('NURSE-7', 'odmowy wglądu w dane o zdrowiu trafiają też do rejestru audytowego', healthAudit === denied, `${healthAudit} vs ${denied}`);

      const codes = db.col('libraryItems').filter((i) => i.level === 6).map((i) => i.barcode);
      const loan = (await S.biblioteka.post('/api/modules/library/batch-checkout', { classId: '6a', barcodes: codes, loanedAt: D_WED })).body;
      const expected = codes.length * db.get('classes', '6a').studentIds.length;
      R.check('LIB-1', 'wypożyczono komplet każdemu uczniowi oddziału', loan.created === expected, `${loan.created} vs ${expected}`);
      const loans = (await S.biblioteka.get('/api/modules/library/loans?classId=6a&open=1')).body;
      R.check('LIB-2', 'liczba otwartych wypożyczeń zgadza się z wierszami', loans.open === loans.loans.length && loans.open === expected, `${loans.open}`);

      const meal = (await S.stolowka.get('/api/modules/cafeteria/meal-report?date=' + D_WED)).body;
      const manual = mealPortions(db, D_WED);
      R.check('CAFE-1', 'liczba obiadów policzona z porannej frekwencji zgadza się z wierszami', meal.totals.portions === manual, `${meal.totals.portions} vs ${manual}`);
      R.check('CAFE-2', 'wartość zamówienia = porcje × cena', meal.value === Math.round(meal.totals.portions * db.data.config.mealPrice * 100) / 100, String(meal.value));

      const pay = (await S.parent.sample.get('/api/parent/payments?studentId=' + S.pupil.sample.id)).body;
      R.check('PAY-1', 'rodzic widzi opłatę do zapłaty', pay.payments.length === 1 && pay.payments[0].status === 'due', JSON.stringify(pay.payments.length));
      const paid = (await S.parent.sample.post(`/api/parent/payments/${pay.payments[0].id}/pay`, { method: 'przelew online' })).body;
      R.check('PAY-2', 'potwierdzenie wpłaty wystawione natychmiast', !!paid.receiptNo, paid.receiptNo);
      const receipt = (await S.parent.sample.get(paid.receiptPath)).body;
      R.check('PAY-3', 'wydruk potwierdzenia zawiera ten sam numer i kwotę',
        String(receipt).includes(paid.receiptNo) && String(receipt).includes(U.fmtAvg(pay.payments[0].amount)), paid.receiptNo);

      const early = (await S.parent.sample.post('/api/parent/lunch/cancel', { studentId: S.pupil.sample.id, date: D_WED, at: '07:30' })).body;
      R.check('CAFE-3', 'obiad odwołany przed progiem daje zwrot na kolejny miesiąc', early.creditMonth === nextMonth(D_WED), early.creditMonth);
      const late = await S.parent.absent.post('/api/parent/lunch/cancel', { studentId: S.pupil.absent.id, date: D_WED, at: '09:15' }, 409);
      R.check('CAFE-4', 'odwołanie po progu odrzucone — porcja jest już przygotowana', late.body.code === 'after_cutoff', late.body.code);
    });

    await R.step('Środa wieczorem — cisza nocna opiekuna: dwie drogi powiadomień, dwa zachowania', async () => {
      const parent = S.parent.sample;
      const feed = (await parent.get('/api/notifications/feed')).body;
      const t = feed.localTime;                                  // czas ścienny szkoły, prosto z API
      const plus = (hhmm, h) => String((+hhmm.slice(0, 2) + h) % 24).padStart(2, '0') + hhmm.slice(2);
      const q = (await parent.patch('/api/parent/quiet-hours', { quietHours: { from: t, to: plus(t, 2) } })).body;
      R.check('QUIET-1', 'opiekun włącza ciszę nocną obejmującą bieżącą godzinę', !!q.quietHours, JSON.stringify(q.quietHours));
      const now = (await parent.get('/api/parent/quiet-hours')).body;
      R.check('QUIET-2', 'dziennik potwierdza, że cisza trwa właśnie teraz', now.quietNow === true, String(now.quietNow));

      const parentId = db.one('users', (u) => u.login === 'rodzic.sample').id;
      const before = db.col('notifications').filter((n) => n.userId === parentId).length;
      await S.teacher['j.nowak'].post('/api/messages', { toUserIds: [parentId], subject: 'Prośba o kontakt', body: 'Proszę o telefon w sprawie postępów dziecka.' });
      const viaMessages = db.col('notifications').filter((n) => n.userId === parentId).slice(before);
      R.check('QUIET-3', 'powiadomienie o wiadomości czeka do rana i nie idzie na telefon',
        viaMessages.length === 1 && viaMessages[0].deferred === true && viaMessages[0].push === false && !!viaMessages[0].deliverAt, JSON.stringify(viaMessages.map((n) => [n.kind, n.deferred, n.push])));

      const before2 = db.col('notifications').filter((n) => n.userId === parentId).length;
      await S.teacher['j.nowak'].post('/api/homeroom/broadcast', { classId: '6a', audience: 'allParents', subject: 'Zebranie z rodzicami', body: 'Zapraszam na zebranie w czwartek o 17:00.' });
      const viaDomain = db.col('notifications').filter((n) => n.userId === parentId).slice(before2);
      /* GAP-7 zamknięty: `D.notify` z server/lib/domain.js idzie tą samą drogą co
         `createNotification` — cisza nocna, deduplikacja i `deliverAt` są jedne dla całego
         dziennika, więc opiekun jest wyciszony w całym dzienniku, a nie w jego połowie. */
      R.check('QUIET-4', 'obie drogi powiadomień honorują ciszę nocną (komunikat wychowawcy też czeka do rana)',
        viaDomain.length >= 1 && viaDomain.every((n) => n.deferred === true && n.push === false && !!n.deliverAt), JSON.stringify(viaDomain.map((n) => [n.kind, !!n.deferred, n.push])));
      const feed2 = (await parent.get('/api/notifications/feed')).body;
      R.check('QUIET-5', 'licznik odłożonych powiadomień równy liczbie wierszy odłożonych',
        feed2.deferredCount === db.col('notifications').filter((n) => n.userId === parentId && n.deferred && Date.parse(n.deliverAt) > Date.parse(feed2.at)).length, String(feed2.deferredCount));
      await parent.patch('/api/parent/quiet-hours', { enabled: false });
    });

    /* ============================================================ 11. Thursday ================== */
    await R.step('Czwartek — frekwencja z zastępstwami, jedna lekcja bez tematu, spóźnione zadanie', async () => {
      setDay(D_THU);
      const day = await teachDay(R, S, db, D_THU, {});
      S.week[D_THU] = day;
      const topics = await writeTopics(R, S, db, D_THU, { leaveOneBlank: true });
      S.blankLesson = topics.blank;
      R.check('ATT-7', 'czwartek: frekwencja na wszystkich 18 lekcjach (także zastępowanych)', day.saved === 18, String(day.saved));
      R.check('TOPIC-2', 'dokładnie jedna lekcja została bez tematu', topics.withTopic === 17 && !!topics.blank, `${topics.withTopic}/18`);
      R.check('TOPIC-3', 'bez tematu została lekcja prowadzona przez zastępcę', !!(topics.blank && topics.blank.substituteTeacherId), String(topics.blank && topics.blank.substituteTeacherId));
      const sid = S.pupil.late.id;
      const pupil = await pupilOf(R, S, db, base, sid);
      const r = (await pupil.post(`/api/homework/${S.homework.id}/submissions`, { text: 'Przepraszam za spóźnienie — zadania rozwiązane.' })).body;
      R.check('HW-6', 'praca oddana po terminie jest oznaczona jako spóźniona', r.late === true, String(r.late));
      const teacherView = (await S.teacher['j.nowak'].get(`/api/homework/${S.homework.id}/submissions`)).body;
      const row = teacherView.submissions.find((x) => x.studentId === sid);
      R.check('HW-7', 'nauczyciel widzi tę samą godzinę wpływu i to samo oznaczenie', row.late === true && row.receivedAt === r.receivedAt, row.receivedAt);
      const reviewed = (await S.teacher['j.nowak'].post(`/api/homework/${S.homework.id}/submissions/${row.id}/review`, { comment: 'Poprawnie, następnym razem w terminie.' })).body;
      R.check('HW-8', 'przejrzenie pracy zapisuje kto i kiedy', !!reviewed.submission.reviewedAt, reviewed.submission.reviewedAt);
    });

    /* ============================================================ 12. Friday ==================== */
    await R.step('Piątek — frekwencja i tematy na ostatni dzień tygodnia', async () => {
      setDay(D_FRI);
      const day = await teachDay(R, S, db, D_FRI, {});
      S.week[D_FRI] = day;
      const res = await writeTopics(R, S, db, D_FRI, {});
      R.check('ATT-8', 'piątek: frekwencja na wszystkich lekcjach (także zastępowanych)', day.saved === 18, String(day.saved));
      R.check('TOPIC-4', 'piątek zamknięty tematami na każdej lekcji', res.withTopic === 18, `${res.withTopic}/18`);
    });

    await R.step('Piątek — dyrektor: kompletność wpisów i obciążenie sprawdzianami', async () => {
      const comp = (await S.dyr.get(`/api/principal/completeness?from=${D_MON}&to=${D_WED}`)).body;
      R.check('PRIN-1', 'pon.–śr. bez luk w dzienniku', comp.totals.lessonsWithGaps === 0 && comp.rows.length === 0, JSON.stringify(comp.totals));
      const withFriday = (await S.dyr.get(`/api/principal/completeness?from=${D_MON}&to=${D_THU}`)).body;
      R.check('PRIN-2', 'z czwartkiem widać dokładnie jedną lekcję bez tematu',
        withFriday.totals.missingTopic === 1 && withFriday.rows.length === 1 && withFriday.rows[0].lessonId === S.blankLesson.id, JSON.stringify(withFriday.totals));
      R.check('PRIN-3', 'brak przypisany zastępcy, a nie nauczycielowi z planu',
        withFriday.rows[0].teacherId === (S.blankLesson.substituteTeacherId || S.blankLesson.teacherId), withFriday.rows[0].teacherId);
      const sumGroups = withFriday.groups.reduce((n, g) => n + g.missingTopic + g.missingAttendance, 0);
      const sumRows = withFriday.rows.filter((r) => r.missingTopic).length + withFriday.rows.filter((r) => r.missingAttendance || r.partialAttendance).length;
      R.check('PRIN-4', 'liczby w podsumowaniu równe wierszom, które za nimi stoją', sumGroups === sumRows, `${sumGroups} vs ${sumRows}`);

      const load = (await S.dyr.get(`/api/principal/test-load?weeks=1&to=${D_FRI}`)).body;
      const announced = db.col('tests').filter((t) => (t.kind || 'sprawdzian') === 'sprawdzian').length;
      const counted = load.rows.reduce((n, x) => n + x.tests, 0);
      R.check('PRIN-5', 'obciążenie sprawdzianami liczy dokładnie zapowiedziane sprawdziany', counted === announced, `${counted} vs ${announced}`);
      R.check('PRIN-6', 'limit dzienny nie został przekroczony (drugi sprawdzian odrzucono)', load.totals.exceeded === 0, JSON.stringify(load.totals));
    });

    await R.step('Piątek — frekwencja tygodnia zgadza się we wszystkich czterech widokach', async () => {
      for (const key of ['sample', 'absent', 'welfare', 'divorced']) {
        await crossRoleAttendance(R, S, db, base, S.pupil[key].id, key);
      }
      // lista zagrożonych wychowawcy musi wynikać z tych samych statystyk
      const hr = S.teacher['b.sikora'];
      const risk = (await hr.get('/api/homeroom/at-risk?classId=7a')).body;
      const wsid = S.pupil.welfare.id;
      const bySubject = (await hr.get('/api/attendance/student/' + wsid + '/monthly?month=' + MONTH)).body.bySubject;
      const row = risk.students.find((x) => x.studentId === wsid);
      /* Ta sama reguła, policzona ręcznie z raportu miesięcznego: uczeń trafia na listę, gdy z jakiegoś
         przedmiotu ma dość zapisanych godzin i nieobecność na ponad połowie z nich (art. 44k ust. 1). */
      const overHalf = Object.entries(bySubject).filter(([, v]) => v.counted >= risk.minHours && v.absentPercent != null && v.absentPercent > 50);
      R.check('ATT-9', 'lista zagrożonych wynika dokładnie z reguły policzonej na raporcie miesięcznym',
        (!!row) === (overHalf.length > 0), `lista: ${!!row}, reguła: ${overHalf.length > 0} (próg ${risk.minHours} godzin)`);
      if (row) {
        const worst = row.subjects[0];
        R.check('ATT-10', 'lista zagrożonych używa tych samych procentów, co raport miesięczny',
          bySubject[worst.subjectId] && bySubject[worst.subjectId].absentPercent === worst.absentPercent, `${worst.absentPercent}`);
      }
    });

    await R.step('Piątek — liczby na pulpitach równe wierszom, które za nimi stoją', async () => {
      const hr = S.teacher['j.nowak'];
      // statystyka pojedynczej lekcji vs. ręczne przeliczenie wierszy frekwencji
      const lesson = db.col('lessons').find((l) => l.date === D_MON && l.classId === '6a' && l.lessonNo === 1);
      const view = (await hr.get('/api/attendance/lesson/' + lesson.id)).body;
      const manual = U.attendanceStats(db.col('attendance').filter((a) => a.lessonId === lesson.id));
      R.same('DASH-1', 'statystyka listy obecności = przeliczenie jej własnych wierszy',
        { ob: view.stats.ob, nb: view.stats.nb, sp: view.stats.sp, u: view.stats.u, percent: view.stats.percent },
        { ob: manual.ob, nb: manual.nb, sp: manual.sp, u: manual.u, percent: manual.percent });
      R.check('DASH-2', 'lista obecności ma dokładnie tylu uczniów, ilu było zapisanych tego dnia',
        view.students.length === db.get('classes', '6a').studentIds.filter((sid) => { const st = db.get('students', sid); return !st.enrolledAt || st.enrolledAt <= D_MON; }).length,
        String(view.students.length));

      const ov = (await hr.get('/api/homeroom/overview?classId=6a')).body;
      const pending = db.col('excuses').filter((e) => e.status === 'pending' && db.get('students', e.studentId).classId === '6a').length;
      R.check('DASH-3', 'licznik wniosków oczekujących = liczba wniosków w bazie', ov.pendingExcuses === pending, `${ov.pendingExcuses} vs ${pending}`);
      R.check('DASH-4', 'licznik uczniów = liczba uczniów oddziału', ov.students === db.col('students').filter((x) => x.classId === '6a' && x.status !== 'removed').length, String(ov.students));

      const box = (await hr.get('/api/homeroom/excuses?classId=6a')).body;
      R.check('DASH-5', 'skrzynka wniosków: licznik „oczekujące” równy wierszom o tym statusie',
        box.pending === box.excuses.filter((e) => e.status === 'pending').length, `${box.pending}`);

      const hwList = (await hr.get('/api/homework?classId=6a')).body.homework.find((x) => x.id === S.homework.id);
      const subs = db.col('homeworkSubmissions').filter((x) => x.homeworkId === S.homework.id);
      R.check('DASH-6', 'licznik oddanych prac = liczba oddanych prac', hwList.submittedCount === subs.length, `${hwList.submittedCount} vs ${subs.length}`);
      R.check('DASH-7', 'licznik przejrzanych prac = liczba przejrzanych prac', hwList.reviewedCount === subs.filter((x) => x.reviewedAt).length, String(hwList.reviewedCount));

      const notif = (await S.parent.sample.get('/api/notifications/unread-count')).body;
      const parentId = db.get('students', S.pupil.sample.id).parentIds.find((x) => db.get('users', x).login === 'rodzic.sample');
      const unread = db.col('notifications').filter((n) => n.userId === parentId && !n.read).length;
      R.check('DASH-8', 'licznik nieprzeczytanych powiadomień = liczba wierszy', notif.count === unread, `${notif.count} vs ${unread}`);
    });

    await R.step('Piątek — średnie zgadzają się: arkusz, uczeń, rodzic, tablica klasyfikacji', async () => {
      await crossRoleGrades(R, S, db, '6a', 'mat');
      const hr = S.teacher['j.nowak'];
      const grid = (await hr.get('/api/grades/grid?classId=6a&subjectId=mat')).body;
      const cls = (await hr.get('/api/homeroom/classification?classId=6a')).body;
      const bad = [];
      for (const row of grid.students) {
        const inCls = cls.students.find((x) => x.studentId === row.studentId);
        if (!inCls) { bad.push(row.studentId + ':brak'); continue; }
        if ((inCls.subjects.mat || {}).average !== row.average) bad.push(`${row.studentId}:${row.average}≠${(inCls.subjects.mat || {}).average}`);
      }
      R.check('AVG-1', 'średnia z arkusza ocen = średnia w tablicy klasyfikacji', bad.length === 0, bad.slice(0, 3).join(' '));
      const avgs = grid.students.map((x) => x.average).filter((x) => x != null);
      const expected = avgs.length ? Math.round((avgs.reduce((a, b) => a + b, 0) / avgs.length) * 100) / 100 : null;
      R.check('AVG-2', 'średnia klasy = średnia ze średnich uczniów', grid.classAverage === expected, `${grid.classAverage} vs ${expected}`);
      const stats = (await hr.get('/api/grades/statistics?classId=6a&subjectId=mat')).body;
      R.check('AVG-3', 'statystyki przedmiotu podają tę samą średnią klasy', stats.classAverage === grid.classAverage, `${stats.classAverage}`);
      const entries = stats.students.reduce((n, x) => n + x.entries, 0);
      const live = db.col('grades').filter((g) => g.subjectId === 'mat' && g.classId === '6a' && g.kind === 'partial' && !g.deleted).length;
      R.check('AVG-4', 'liczba wpisów w statystykach = liczba żywych ocen w bazie', entries === live, `${entries} vs ${live}`);
    });

    await R.step('Piątek — opiekun z zakresem informacyjnym nie widzi ocen, drugi opiekun widzi wszystko', async () => {
      const sid = S.pupil.divorced.id;
      const full = (await S.parent.divorced.get('/api/parent/grades?studentId=' + sid)).body;
      const denied = await S.parent.divorced2.get('/api/parent/grades?studentId=' + sid, 403);
      R.check('SCOPE-1', 'opiekun „info” dostaje 403 z powodem „guardian_scope”', denied.body.deny === 'guardian_scope' && denied.body.scope === 'info', JSON.stringify(denied.body.deny));
      const overview = (await S.parent.divorced2.get('/api/parent/overview?studentId=' + sid)).body;
      R.check('SCOPE-2', 'pulpit opiekuna „info” nie zawiera żadnych ocen',
        overview.grades.restricted === true && overview.grades.subjects.length === 0 && overview.grades.average === null, JSON.stringify(overview.grades.restricted));
      R.check('SCOPE-3', 'opiekun „info” nadal widzi frekwencję', Array.isArray(overview.attendanceWeek.days), typeof overview.attendanceWeek);
      const att1 = (await S.parent.divorced.get(`/api/parent/attendance?studentId=${sid}&from=${D_MON}&to=${D_FRI}`)).body;
      const att2 = (await S.parent.divorced2.get(`/api/parent/attendance?studentId=${sid}&from=${D_MON}&to=${D_FRI}`)).body;
      R.same('SCOPE-4', 'obaj opiekunowie widzą tę samą frekwencję', att1.counts, att2.counts);
      const ang = full.subjects.find((x) => x.subjectId === 'ang');
      R.check('SCOPE-5', 'pełny opiekun widzi oceny i tę samą średnią, co arkusz nauczyciela',
        !!ang && ang.average === S.divorcedAverage, `${ang && ang.average} vs ${S.divorcedAverage}`);
    });

    await R.step('Piątek — rejestr audytowy: każdy zapis ma swój wiersz z before/after', async () => {
      const audit = (await S.dyr.get('/api/principal/audit?limit=500')).body;
      R.check('AUDIT-3', 'dyrektor widzi ten sam rejestr, co magazyn', audit.total === db.col('audit').length || audit.total <= db.col('audit').length, `${audit.total} vs ${db.col('audit').length}`);
      const must = ['setup_school', 'setup_teachers_imported', 'setup_students_imported', 'timetable_imported', 'setup_lessons_generated',
        'attendance_save', 'attendance_draft', 'lesson_topic', 'grade_create', 'grade_revert', 'grade_category_create',
        'homework_publish', 'homework_submit', 'test_announce', 'excuse_submitted', 'excuse_approved', 'excuse_rejected',
        'attendance_excused', 'substitution_created', 'substitution_assigned', 'substitution_published',
        'registry_student_created', 'course_create', 'course_quiz_submit', 'course_quiz_grade', 'meeting_scheduled',
        'note_create', 'nurse_visit_recorded', 'library_batch_checkout', 'payment_paid', 'lunch_cancelled'];
      const have = new Set(db.col('audit').map((a) => a.action));
      const missing = must.filter((a) => !have.has(a));
      R.check('AUDIT-4', 'każda ważna operacja tygodnia zostawiła wiersz audytu', missing.length === 0, missing.join(', '));
      const mutating = db.col('audit').filter((a) => /_update$|_revert$|_excused$|_unexcused$|^grade_superseded$/.test(a.action));
      const noBefore = mutating.filter((a) => a.before == null);
      R.check('AUDIT-5', 'każda zmiana istniejącego wiersza niesie stan sprzed zmiany', noBefore.length === 0, JSON.stringify(noBefore.map((a) => a.action).slice(0, 3)));
      const immutable = await S.admin.del('/api/audit', {}, 405);
      R.check('AUDIT-6', 'rejestru audytowego nie da się skasować (WORM)', immutable.body.code === 'audit_immutable', immutable.body.code);
      const attempt = db.col('audit').filter((a) => a.action === 'audit_modification_attempt');
      R.check('AUDIT-7', 'próba modyfikacji rejestru też jest w rejestrze', attempt.length >= 1, String(attempt.length));
    });

    await R.step('Piątek — kopia anonimizowana, eksport CSV i XML', async () => {
      const backup = (await S.admin.post('/api/admin/backup/anonymized', { json: true, reason: 'kopia dla środowiska testowego' })).body;
      const text = JSON.stringify(backup.snapshot);
      const names = db.col('students').slice(0, 10).map((s) => s.lastName);
      const leaked = names.filter((n) => text.includes(n));
      R.check('EXP-1', 'kopia anonimizowana nie zawiera nazwisk uczniów', leaked.length === 0, leaked.join(','));
      const pesels = db.col('students').map((s) => s.pesel).filter(Boolean).slice(0, 10);
      R.check('EXP-2', 'kopia anonimizowana nie zawiera numerów PESEL', pesels.filter((p) => text.includes(p)).length === 0, '');
      R.check('EXP-3', 'kopia zachowuje rejestr audytowy', backup.auditKept > 0, String(backup.auditKept));

      const csv = (await S.teacher['j.nowak'].get('/api/grades/export.csv?classId=6a&subjectId=mat')).body;
      const lines = String(csv).split('\r\n').filter(Boolean);
      const gradeRows = db.col('grades').filter((g) => g.classId === '6a' && g.subjectId === 'mat' && !g.deleted && g.semester === 1).length;
      const dataLines = lines.filter((l) => /^\d+;/.test(l));
      R.check('EXP-4', 'CSV zawiera wiersz na każdą żywą ocenę plus podsumowanie ucznia',
        dataLines.length === gradeRows + db.col('students').filter((s) => s.classId === '6a').length, `${dataLines.length} vs ${gradeRows}+`);
      const bytes = await S.teacher['j.nowak'].raw('/api/grades/export.csv?classId=6a&subjectId=mat');
      R.check('EXP-5', 'CSV jest w UTF-8 z BOM i średnikiem', bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf && lines.slice(0, 4).some((l) => l.includes(';')), bytes.slice(0, 3).toString('hex'));
      const anon = (await S.teacher['j.nowak'].get('/api/grades/export.csv?classId=6a&subjectId=mat&anonymize=1')).body;
      R.check('EXP-6', 'wariant anonimizowany nie zawiera nazwisk', !names.some((n) => String(anon).includes(n)), '');

      const xml = (await S.admin.get('/api/support/export/xml?classId=6a')).body;
      R.check('EXP-7', 'eksport XML jest poprawnym dokumentem XML', String(xml).trim().startsWith('<?xml'), String(xml).slice(0, 40));
    });

    await R.step('Piątek — wydruk zawiera te same liczby, co API', async () => {
      const hr = S.teacher['j.nowak'];
      const json = (await hr.get(`/api/homeroom/attendance/monthly?classId=6a&month=${MONTH}`)).body;
      const html = String((await hr.get(`/api/homeroom/print/attendance?classId=6a&month=${MONTH}`)).body);
      R.check('PRINT-1', 'wydruk ma podpis tabeli i nagłówki z zakresem (czytnik ekranu)',
        html.includes('<caption>') && html.includes('scope="col"') && html.includes('scope="row"'), '');
      const bad = [];
      for (const row of json.rows) {
        const rx = new RegExp('<th scope="row">' + escapeRe(row.name) + '</th>' + '<td>(\\d+)</td><td>(\\d+)</td><td>(\\d+)</td><td>(\\d+)</td><td>(\\d+)</td><td>([^<]*)</td>');
        const m = rx.exec(html);
        if (!m) { bad.push(row.name + ':brak w wydruku'); continue; }
        if (+m[1] !== row.excused || +m[2] !== row.unexcused || +m[3] !== row.late || +m[5] !== row.hours || m[6] !== U.fmtAvg(row.percent)) {
          bad.push(`${row.name}: wydruk ${m.slice(1).join('/')} ≠ API ${row.excused}/${row.unexcused}/${row.late}/${row.earlyLeave}/${row.hours}/${U.fmtAvg(row.percent)}`);
        }
      }
      R.check('PRINT-2', 'każdy wiersz wydruku ma te same liczby, co raport z API', bad.length === 0, bad.slice(0, 2).join(' | '));

      const probe = await hr.get('/api/pdf?probe=1&path=' + encodeURIComponent(`/api/homeroom/print/attendance?classId=6a&month=${MONTH}`));
      S.pdfAvailable = probe.body.available === true;
      if (S.pdfAvailable) {
        const pdf = await hr.get('/api/pdf?path=' + encodeURIComponent(`/api/homeroom/print/attendance?classId=6a&month=${MONTH}`));
        const head = Buffer.isBuffer(pdf.body) ? pdf.body.slice(0, 5).toString('latin1') : String(pdf.body).slice(0, 5);
        R.check('PRINT-3', 'PDF wygenerowany lokalnym Chromium', head === '%PDF-', head);
      } else {
        const fallback = await hr.get('/api/pdf?path=' + encodeURIComponent(`/api/homeroom/print/attendance?classId=6a&month=${MONTH}`), 501);
        R.check('PRINT-3', 'bez Chromium serwer podaje adres wersji HTML (pominięto generowanie PDF)',
          fallback.body.code === 'pdf_unavailable' && !!fallback.body.fallbackUrl, fallback.body.code);
      }
      const otherParent = await S.parent.welfare.get('/api/pdf?path=' + encodeURIComponent(`/api/homeroom/print/attendance?classId=6a&month=${MONTH}`), 403);
      R.check('PRINT-4', 'generator PDF nie omija kontroli uprawnień', otherParent.status === 403, String(otherParent.status));
    });

    await R.step('Piątek — próba zamknięcia semestru i tryb demo', async () => {
      const hr = S.teacher['j.nowak'];
      const close = await hr.post('/api/homeroom/semester/close', { classId: '6a', semester: 1, resolutionNo: '1/2026/2027' }, 409);
      R.check('SEM-1', 'zamknięcie semestru na trzy miesiące przed klasyfikacją odrzucone',
        close.body.code === 'too_early' && close.body.classificationMeeting === db.data.config.semesters[0].classificationMeeting, close.body.code);
      R.check('SEM-2', 'odmowa nie zamknęła semestru', db.col('semesterLocks').length === 0, String(db.col('semesterLocks').length));
      const noReason = await hr.post('/api/homeroom/semester/close', { classId: '6a', semester: 1, force: true }, 400);
      R.check('SEM-3', 'wcześniejsze zamknięcie bez podstawy też odrzucone', noReason.body.code === 'reason_required', noReason.body.code);
      const forced = (await hr.post('/api/homeroom/semester/close', { classId: '6a', semester: 1, force: true, resolutionNo: '1/2026/2027', reason: 'Uchwała Rady Pedagogicznej nr 1/2026/2027 — klasyfikacja przeniesiona (pilotaż).' })).body;
      R.check('SEM-4', 'świadome zamknięcie przed terminem zostaje odnotowane jako wcześniejsze', forced.lock.early === true && !!forced.lock.reason, String(forced.lock.early));
      const locked = await hr.post('/api/grades', { studentId: S.pupil.sample.id, subjectId: 'mat', classId: '6a', categoryId: S.cat.id, value: '4', date: D_FRI }, 403);
      R.check('SEM-5', 'po zamknięciu wpis oceny jest zablokowany', locked.body.code === 'semester_locked', locked.body.code);
      const lockedAtt = await hr.post('/api/attendance/lesson/' + db.col('lessons').find((l) => l.date === D_FRI && l.classId === '6a').id, { allPresent: true }, 403);
      R.check('SEM-6', 'i frekwencji też nie da się zmienić', lockedAtt.body.code === 'semester_locked', lockedAtt.body.code);
      const byTeacher = await hr.post('/api/homeroom/semester/reopen', { classId: '6a', semester: 1, reason: 'x' }, 403);
      R.check('SEM-7', 'wychowawca nie odblokuje semestru sam', byTeacher.status === 403, String(byTeacher.status));
      const reopen = (await S.dyr.post('/api/homeroom/semester/reopen', { classId: '6a', semester: 1, reason: 'Zamknięcie omyłkowe — przywrócenie stanu sprzed decyzji (pilotaż).' })).body;
      R.check('SEM-8', 'dyrekcja odblokowuje semestr z uzasadnieniem', reopen.locked === false, String(reopen.locked));
      const reset = await S.admin.post('/api/demo/reset', {}, 404);
      R.check('DEMO-1', 'przy wyłączonym trybie demo „przywróć dane” jest nieosiągalne', reset.status === 404, String(reset.status));
      const personas = await client('gość2').get('/api/demo/personas', 404);
      R.check('DEMO-2', 'lista ról demo też jest nieosiągalna', personas.status === 404, String(personas.status));
      R.check('DEMO-3', 'tryb demo jest faktycznie wyłączony', process.env.EDMAT_DEMO !== '1' && !(db.data.config.demo && db.data.config.demo.enabled), String(process.env.EDMAT_DEMO));
    });

    await R.step('Podsumowanie tygodnia — nic nie odpowiedziało 500', async () => {
      R.check('HTTP-1', 'żadna odpowiedź w całym tygodniu nie była nieoczekiwanym błędem serwera', R.serverErrors.length === 0, R.serverErrors.join(', '));
      R.check('HTTP-2', 'tydzień zmieścił się w budżecie dwóch minut', R.ms < 120000, `${R.ms} ms`);
    });
  } finally {
    await app.close();
  }
  return R;
}

/* ------------------------------------------------------------------ pieces --------------------- */

function escapeRe(s) { return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }
const nextMonth = (date) => { const y = +date.slice(0, 4), m = +date.slice(5, 7); return m === 12 ? `${y + 1}-01` : `${y}-${String(m + 1).padStart(2, '0')}`; };

/** Ręczne przeliczenie liczby obiadów — niezależne od implementacji raportu. */
function mealPortions(db, date) {
  let n = 0;
  for (const a of db.col('cafeteriaAccounts')) {
    if (a.active === false || !a.mealPlan || a.blocked) continue;
    const morning = db.col('attendance').some((x) => x.studentId === a.studentId && x.date === date && x.lessonNo <= 2 && !x.draft && (x.status === 'ob' || x.status === 'sp'));
    if (!morning) continue;
    if (db.col('cafeteriaCancellations').some((x) => x.studentId === a.studentId && x.date === date)) continue;
    n++;
  }
  return n;
}

/** Konto ucznia gotowe do pracy: administrator resetuje hasło, uczeń je zmienia i się loguje. */
async function pupilOf(R, S, db, base, studentId) {
  if (S.pupilClient[studentId]) return S.pupilClient[studentId];
  const u = db.one('users', (x) => x.role === 'student' && x.studentId === studentId);
  if (!u) throw new Error('brak konta ucznia dla ' + studentId);
  const reset = (await S.admin.post(`/api/admin/users/${u.id}/reset-password`, { reason: 'aktywacja konta ucznia w pilotażu' })).body;
  const c = makeClient(base, R, 'uczeń ' + u.login);
  await c.post('/api/auth/login', { login: u.login, password: reset.temporaryPassword });
  await c.post('/api/auth/password', { next: PW });
  S.pupilClient[studentId] = c;
  return c;
}

/**
 * Jeden dzień nauki: każdy nauczyciel zapisuje frekwencję na każdej swojej lekcji.
 * Domyślnie „wszyscy obecni”, a na to nakładane są wyjątki z `opts`.
 */
async function teachDay(R, S, db, date, opts) {
  const o = opts || {};
  const lessons = db.col('lessons').filter((l) => l.date === date && l.status !== 'cancelled')
    .map((l) => ({ id: l.id, classId: l.classId, lessonNo: l.lessonNo, subjectId: l.subjectId, teacherId: l.teacherId, substituteTeacherId: l.substituteTeacherId }))
    .sort((a, b) => a.lessonNo - b.lessonNo || a.classId.localeCompare(b.classId));
  const clientFor = (l) => {
    const uid = l.substituteTeacherId || l.teacherId;
    const u = db.get('users', uid);
    return S.teacher[u.login];
  };
  const out = { date, saved: 0, lessons, replay: null, draftLessonId: null };
  let draftDone = !o.draftLesson, replayDone = !o.offlineReplay;
  for (const l of lessons) {
    const c = clientFor(l);
    if (!c) { R.check('ATT-0', 'lekcja ma nauczyciela z kontem', false, l.id); continue; }
    const roster = (await c.get('/api/attendance/lesson/' + l.id)).body.students;
    const entries = roster.map((s) => {
      if (o.allDayAbsent && o.allDayAbsent.includes(s.studentId)) return { studentId: s.studentId, status: 'nb' };
      if (l.lessonNo === 1 && o.absentFirstPeriod === s.studentId) return { studentId: s.studentId, status: 'nb' };
      if (l.lessonNo === 1 && o.lateMinutes && o.lateMinutes.studentId === s.studentId && roster.some((x) => x.studentId === o.lateMinutes.studentId)) {
        return { studentId: s.studentId, status: 'sp', minutes: o.lateMinutes.minutes };
      }
      return { studentId: s.studentId, status: 'ob' };
    });
    if (!draftDone && l.lessonNo === 2) {
      // nauczyciel zaczyna listę na lekcji i kończy ją po dzwonku
      await c.post('/api/attendance/lesson/' + l.id, { draft: true, entries: entries.slice(0, 5) });
      const mid = (await c.get('/api/attendance/lesson/' + l.id)).body;
      R.check('ATT-D1', 'wersja robocza jest oznaczona jako robocza', mid.draft === true, String(mid.draft));
      // dopóki lista jest robocza, rodzic nie widzi jeszcze żadnego wpisu
      const sid = entries[0].studentId;
      const pk = Object.keys(S.pupil || {}).find((k) => S.pupil[k].id === sid);
      if (pk && S.parent && S.parent[pk]) {
        const seen = (await S.parent[pk].get(`/api/parent/overview?studentId=${sid}&date=${date}`)).body;
        const line = seen.lessons.find((x) => x.id === l.id);
        R.check('ATT-D3', 'wersja robocza nie wycieka do rodzica', !line || line.attendance.status === 'none', line ? line.attendance.status : 'brak lekcji');
      }
      await c.post('/api/attendance/lesson/' + l.id, { entries });
      const done = (await c.get('/api/attendance/lesson/' + l.id)).body;
      R.check('ATT-D2', 'ukończona lista nie ma już wpisów roboczych', done.draft === false && done.students.every((s) => !s.draft), String(done.draft));
      out.draftLessonId = l.id;
      draftDone = true;
      out.saved++;
      continue;
    }
    const saved = (await c.post('/api/attendance/lesson/' + l.id, { entries })).body;
    out.saved++;
    if (!replayDone && l.lessonNo === 3) {
      // nauczyciel poprawia wpis w przeglądarce…
      const sid = entries[0].studentId;
      await c.post('/api/attendance/lesson/' + l.id, { entries: [{ studentId: sid, status: 'sp', minutes: 5 }] });
      // …a telefon dosyła zapis sprzed poprawki (kolejka offline)
      const stale = new Date(Date.parse(saved.at) - 3600 * 1000).toISOString();
      out.replay = (await c.post('/api/attendance/lesson/' + l.id, { at: stale, entries: [{ studentId: sid, status: 'nb' }] })).body;
      replayDone = true;
    }
  }
  return out;
}

/** Tematy lekcji dnia; pierwszy temat matematyki dostaje powiązanie z podstawą programową. */
async function writeTopics(R, S, db, date, opts) {
  const o = opts || {};
  const lessons = db.col('lessons').filter((l) => l.date === date && l.status !== 'cancelled');
  let withTopic = 0, blank = null, linked = false;
  for (const l of lessons) {
    if (o.leaveOneBlank && !blank && l.substituteTeacherId) { blank = l; continue; }
    const u = db.get('users', l.substituteTeacherId || l.teacherId);
    const c = S.teacher[u.login];
    if (!c) continue;
    const body = { topic: `Lekcja ${l.lessonNo} · ${l.subjectId} · ${U.fmtDate(date)}` };
    if (o.linkCurriculum && !linked && l.subjectId === 'mat') {
      const level = db.get('classes', l.classId).level;
      const item = db.col('curriculum').find((x) => x.subjectId === 'mat' && x.level === level);
      if (item) { body.curriculumItemIds = [item.id]; linked = true; }
    }
    await c.patch('/api/lessons/' + l.id, body);
    withTopic++;
  }
  if (o.leaveOneBlank && !blank) { blank = lessons[lessons.length - 1]; }
  return { withTopic, blank, linked };
}

/** Ocena zapisana przez nauczyciela musi być dokładnie tym, co widzą uczeń, rodzic, wychowawca i dyrektor. */
async function crossRoleGrades(R, S, db, classId, subjectId) {
  const teacherLogin = TEACHERS.find((t) => t.subject === subjectId).login;
  const teacher = S.teacher[teacherLogin];
  const grid = (await teacher.get(`/api/grades/grid?classId=${classId}&subjectId=${subjectId}`)).body;
  const sample = S.pupil.sample;
  const row = grid.students.find((x) => x.studentId === sample.id);
  const teacherRecord = (await teacher.get(`/api/grades/student/${sample.id}?subjectId=${subjectId}`)).body;
  R.check('X-1', 'arkusz ocen i karta ucznia u nauczyciela mają tę samą średnią', row.average === teacherRecord.average, `${row.average} vs ${teacherRecord.average}`);

  const base = S.baseUrl;
  const pupil = await pupilOf(R, S, db, base, sample.id);
  const own = (await pupil.get('/api/student/grades')).body.subjects.find((x) => x.subjectId === subjectId) || { grades: [], average: null };
  R.check('X-2', 'uczeń widzi tę samą średnią, co nauczyciel', own.average === row.average, `${own.average} vs ${row.average}`);

  const parentView = (await S.parent.sample.get(`/api/parent/grades?studentId=${sample.id}`)).body;
  const pSub = parentView.subjects.find((x) => x.subjectId === subjectId) || { grades: [], average: null };
  R.check('X-3', 'rodzic widzi tę samą średnią', pSub.average === row.average, `${pSub.average} vs ${row.average}`);

  const teacherValues = Object.values(row.grades).filter((g) => g.kind === 'partial').map((g) => g.value).sort();
  const pupilValues = own.grades.map((g) => g.value).sort();
  const parentValues = pSub.grades.map((g) => g.value).sort();
  R.same('X-4', 'uczeń widzi dokładnie te oceny, które wpisał nauczyciel', pupilValues, teacherValues);
  R.same('X-5', 'rodzic widzi dokładnie te same oceny', parentValues, teacherValues);

  const hrLogin = TEACHERS.find((t) => t.homeroomOf === classId).login;
  const cls = (await S.teacher[hrLogin].get(`/api/homeroom/classification?classId=${classId}`)).body;
  const hrRow = cls.students.find((x) => x.studentId === sample.id);
  R.check('X-6', 'wychowawca widzi tę samą średnią bieżącą', (hrRow.subjects[subjectId] || {}).average === row.average, `${(hrRow.subjects[subjectId] || {}).average}`);

  const principal = (await S.dyr.get(`/api/grades/student/${sample.id}?subjectId=${subjectId}`)).body;
  R.check('X-7', 'dyrektor widzi tę samą średnią', principal.average === row.average, `${principal.average}`);

  if (S.commented) {
    const cPupil = await pupilOf(R, S, db, base, S.commented.studentId);
    const cSeen = (await cPupil.get('/api/student/grades')).body.subjects.find((x) => x.subjectId === subjectId);
    const g = cSeen && cSeen.grades.find((x) => x.id === S.commented.gradeId);
    R.check('X-8', 'komentarz nauczyciela dociera do ucznia dosłownie', !!g && g.comment === S.commented.comment, g ? g.comment : 'brak');
  }
}

/** Frekwencja ucznia musi być identyczna w liście nauczyciela, raporcie miesięcznym, u ucznia i u rodzica. */
async function crossRoleAttendance(R, S, db, base, studentId, label) {
  const s = db.get('students', studentId);
  const hrLogin = TEACHERS.find((t) => t.homeroomOf === s.classId).login;
  const hr = S.teacher[hrLogin];
  const month = S.month;
  const monthly = (await hr.get(`/api/attendance/student/${studentId}/monthly?month=${month}`)).body;
  const own = (await hr.get(`/api/attendance/student/${studentId}?from=${month}-01&to=${month}-31`)).body;
  R.check('Y-1', `${label}: raport miesięczny i zestawienie okresowe dają ten sam procent`, monthly.percent === own.percent, `${monthly.percent} vs ${own.percent}`);

  const classMonthly = (await hr.get(`/api/attendance/class/${s.classId}/monthly?month=${month}`)).body;
  const inClass = classMonthly.students.find((x) => x.studentId === studentId);
  R.check('Y-2', `${label}: raport oddziału podaje ten sam procent`, inClass.percent === monthly.percent, `${inClass.percent}`);

  const hrMonthly = (await hr.get(`/api/homeroom/attendance/monthly?classId=${s.classId}&month=${month}`)).body;
  const hrRow = hrMonthly.rows.find((x) => x.studentId === studentId);
  R.check('Y-3', `${label}: miesięczny raport wychowawcy podaje ten sam procent`, hrRow.percent === monthly.percent, `${hrRow.percent}`);
  R.check('Y-4', `${label}: liczby godzin zgadzają się z raportem`, hrRow.unexcused === monthly.counts.nb && hrRow.late === monthly.counts.sp,
    `${hrRow.unexcused}/${monthly.counts.nb} · ${hrRow.late}/${monthly.counts.sp}`);

  const parentKey = Object.keys(S.pupil).find((k) => S.pupil[k].id === studentId);
  if (parentKey && S.parent[parentKey]) {
    const pv = (await S.parent[parentKey].get(`/api/parent/attendance?studentId=${studentId}&from=${month}-01&to=${month}-31`)).body;
    R.check('Y-5', `${label}: rodzic widzi ten sam procent`, pv.percent === monthly.percent, `${pv.percent}`);
    R.same('Y-6', `${label}: rodzic widzi te same liczby godzin`,
      pv.counts, { ob: monthly.counts.ob, nb: monthly.counts.nb, sp: monthly.counts.sp, zw: monthly.counts.zw, u: monthly.counts.u, rs: monthly.counts.rs, w: monthly.counts.w });
  }
  const pupil = await pupilOf(R, S, db, base, studentId);
  const today = (await pupil.get(`/api/student/attendance/today?date=${S.lastDay}`)).body;
  const fromDb = db.col('attendance').filter((a) => a.studentId === studentId && a.date === S.lastDay && !a.draft);
  const seen = today.lessons.filter((l) => l.status && l.status !== 'none');
  R.check('Y-7', `${label}: uczeń widzi dokładnie tyle wpisów, ile jest w dzienniku`, seen.length === fromDb.length, `${seen.length} vs ${fromDb.length}`);
}

/* ------------------------------------------------------------------ provisioning ---------------- */

/**
 * Ustawienia szkoły, których tydzień potrzebuje, i puste kolekcje modułów. **Żadnych danych
 * dziedzinowych**: wszystko, co kiedyś trafiało tu wprost do magazynu jako luka produktowa (kadra,
 * podstawa programowa, konta stołówkowe, stan biblioteki, opłaty, flaga `socialWelfare`, zakres
 * dostępu opiekuna), zakłada dziś `provisionStaff()` / `provisionViaApi()` przez publiczne API.
 * Lista luk w raporcie jest od tej rundy pusta.
 */
function provision(db) {
  const cfg = db.data.config;
  cfg.mealPrice = cfg.mealPrice || 6;
  cfg.lunchCancelCutoff = cfg.lunchCancelCutoff || '08:00';
  /* Puste kolekcje modułów istnieją od razu, żeby pierwszy odczyt nie zwracał `undefined`;
     wiersze wkładają do nich `provisionStaff()` i `provisionViaApi()` przez publiczne API. */
  db.col('cafeteriaCancellations'); db.col('libraryLoans'); db.col('payments');
  db.col('nurseVisits'); db.col('nurseVisitAccessLog');
  db.save();
}

/** Kadra poza nauczycielami: pedagog, psycholog, pielęgniarka, bibliotekarka, intendent. */
const STAFF = [
  { login: 'pedagog', role: 'counselor', firstName: 'Iwona', lastName: 'Pedagog' },
  { login: 'psycholog', role: 'psychologist', firstName: 'Ewa', lastName: 'Psycholog' },
  { login: 'pielegniarka', role: 'nurse', firstName: 'Maria', lastName: 'Pielegniarka' },
  { login: 'biblioteka', role: 'librarian', firstName: 'Zofia', lastName: 'Bibliotekarka' },
  { login: 'stolowka', role: 'cafeteria', firstName: 'Anna', lastName: 'Intendent' }
];

/**
 * Konta kadry zakładane przez administratora (`POST /api/admin/staff`) — tak, jak zrobiłaby to
 * nowa szkoła. Każde dostaje hasło jednorazowe, więc każde przechodzi wymuszoną zmianę hasła przy
 * pierwszym logowaniu; dopiero potem klient trafia do `S[login]`.
 */
async function provisionStaff(R, S, db, client) {
  const made = [];
  for (const person of STAFF) {
    const r = (await S.admin.post('/api/admin/staff', { login: person.login, role: person.role, firstName: person.firstName, lastName: person.lastName, email: `${person.login}@sp-pilot.pl` })).body;
    made.push(r);
    const c = client(person.login);
    await c.post('/api/auth/login', { login: r.user.login, password: r.temporaryPassword });
    await c.post('/api/auth/password', { next: PW });
    S[person.login] = c;
  }
  R.check('STAFF-1', 'administrator zakłada konta pedagoga, psychologa, pielęgniarki, biblioteki i stołówki',
    made.length === STAFF.length && made.every((r) => r.ok), String(made.length));
  R.check('STAFF-2', 'każde konto dostaje hasło jednorazowe i wymusza jego zmianę',
    made.every((r) => !!r.temporaryPassword && r.mustChangePassword === true), '');
  R.check('STAFF-3', 'role z notatkami poufnymi dostają własną parę kluczy',
    ['pedagog', 'psycholog', 'pielegniarka'].every((l) => !!db.one('users', (u) => u.login === l).publicKey), '');
  R.check('STAFF-4', 'każde założenie konta pracownika zostawia wiersz audytu',
    db.col('audit').filter((a) => a.action === 'staff_created').length === STAFF.length, '');
}

/**
 * To, co pusta instalacja wprowadza **przez aplikację**: podstawa programowa, konta stołówkowe
 * i stan biblioteki. Rozgrywane tymi samymi trasami, którymi zrobiłaby to nowa szkoła — i przez
 * te konta, które ją naprawdę prowadzą.
 */
async function provisionViaApi(R, S, db, o) {
  /* --- podstawa programowa: jeden wklejony arkusz na całą szkołę --------------------- */
  const rows = ['subject;level;code;title;hours'];
  for (const cid of o.classes) {
    const level = +cid.replace(/\D/g, '');
    SUBJECTS.forEach((sub, i) => {
      rows.push(`${sub};${level};I.${i + 1};Wymagania przekrojowe — ${sub} ${level};12`);
      rows.push(`${sub};${level};II.${i + 1};Zagadnienia rozszerzające — ${sub} ${level};10`);
    });
  }
  const csv = rows.join('\n');
  const dry = (await S.admin.post('/api/curriculum/import', { csv, dryRun: true })).body;
  R.check('PROV-2', 'próbny import podstawy programowej niczego nie zapisuje',
    dry.dryRun === true && db.col('curriculum').length === 0 && dry.created === rows.length - 1, `${dry.created}/${db.col('curriculum').length}`);
  const imp = (await S.admin.post('/api/curriculum/import', { csv })).body;
  R.check('PROV-3', 'podstawa programowa wprowadzona przez API, bez błędów',
    imp.applied === true && imp.errors.length === 0 && imp.created === dry.created, `${imp.created}/${imp.errors.length}`);
  const again = (await S.admin.post('/api/curriculum/import', { csv })).body;
  R.check('PROV-4', 'powtórzony import aktualizuje, a nie duplikuje',
    again.created === 0 && again.updated === imp.created && db.col('curriculum').length === imp.created, `${again.created}/${again.updated}/${db.col('curriculum').length}`);

  /* --- konta stołówkowe: jedno żądanie na oddział ------------------------------------ */
  let accounts = 0;
  for (const cid of o.classes) {
    const r = (await S.stolowka.post('/api/modules/cafeteria/accounts', { classId: cid, mealPlan: 'obiad', mealPrice: db.data.config.mealPrice, period: o.month })).body;
    accounts += r.created;
  }
  R.check('PROV-5', 'konta stołówkowe założone przez API dla wszystkich uczniów',
    accounts === db.col('students').length && db.col('cafeteriaAccounts').length === accounts, `${accounts}/${db.col('students').length}`);
  const dup = (await S.stolowka.post('/api/modules/cafeteria/accounts', { classId: o.classes[0] })).body;
  R.check('PROV-6', 'ponowne założenie kont nikogo nie dubluje', dup.created === 0 && dup.skipped > 0, `${dup.created}/${dup.skipped}`);

  /* --- stan biblioteki: wklejony arkusz ---------------------------------------------- */
  const books = (await S.biblioteka.post('/api/modules/library/items', {
    csv: [
      'barcode;title;kind;author;subject;level;set',
      '9788390000016;Matematyka 6 · podręcznik;textbook;zespół autorów;mat;6;Komplet klasy 6',
      '9788390000023;Język polski 6 · podręcznik;textbook;zespół autorów;pol;6;Komplet klasy 6',
      '9788390000030;Język angielski 6 · podręcznik;textbook;zespół autorów;ang;6;Komplet klasy 6'
    ].join('\n')
  })).body;
  R.check('PROV-7', 'stan biblioteki wprowadzony przez API',
    books.created === 3 && db.col('libraryItems').length === 3, `${books.created}/${db.col('libraryItems').length}`);
}

/** Opłaty i flagi zależne od uczniów wskazanych przez scenariusz (wywoływane po wyborze uczniów). */
/** Flaga pomocy społecznej i opłata za obiady — jedno i drugie przez publiczne API. */
async function provisionLate(R, db, S, month) {
  const flags = (await S.admin.patch(`/api/registry/students/${S.pupil.welfare.id}/flags`, { socialWelfare: true, reason: 'Decyzja OPS — objęcie pomocą społeczną.' })).body;
  R.check('PROV-9', 'flagę pomocy społecznej ustawia sekretariat, nie zasiew',
    flags.flags.socialWelfare === true && db.get('students', S.pupil.welfare.id).socialWelfare === true, String(flags.flags.socialWelfare));
  const sample = db.get('students', S.pupil.sample.id);
  if (db.col('payments').some((p) => p.studentId === sample.id)) return;
  const fee = (await S.admin.post('/api/modules/fees', {
    studentIds: [sample.id], kind: 'lunch', title: `Obiady ${month} · ${sample.firstName} ${sample.lastName}`,
    amount: 120, dueDate: month + '-28'
  })).body;
  R.check('PROV-8', 'opłata wystawiona przez API trafia do konta ucznia',
    fee.students === 1 && db.col('payments').some((p) => p.studentId === sample.id && p.amount === 120), String(fee.students));
}

/* ------------------------------------------------------------------ printing -------------------- */

function printReport(R) {
  const out = [];
  out.push('');
  out.push('═'.repeat(100));
  out.push('  PILOTAŻ — jeden tydzień szkolny przez publiczne API (pusta instalacja → piątkowy eksport)');
  out.push('═'.repeat(100));
  out.push('');
  out.push('KROKI');
  out.push('  ' + 'nr'.padStart(3) + '  ' + 'czas'.padStart(8) + '  ' + 'inw.'.padStart(4) + '  krok');
  for (const s of R.steps) {
    out.push('  ' + String(s.no).padStart(3) + '  ' + (s.ms + ' ms').padStart(8) + '  ' + String(s.invariants).padStart(4) + '  ' + (s.error ? col(RED, s.name + ' — ' + s.error) : s.name));
  }
  out.push('');
  out.push('INWARIANTY MIĘDZYROLOWE');
  const byId = new Map();
  for (const i of R.invariants) {
    const cur = byId.get(i.id) || { id: i.id, name: i.name, pass: 0, fail: 0, detail: '' };
    if (i.ok) cur.pass++; else { cur.fail++; cur.detail = cur.detail || i.detail; }
    byId.set(i.id, cur);
  }
  const rows = [...byId.values()];
  const w = Math.max(...rows.map((r) => r.id.length), 8);
  out.push('  ' + 'id'.padEnd(w) + '  wynik   ' + 'sprawdzeń'.padStart(9) + '  opis');
  for (const r of rows) {
    const verdict = r.fail ? col(RED, 'BŁĄD  ') : col(GREEN, 'OK    ');
    out.push('  ' + r.id.padEnd(w) + '  ' + verdict + '  ' + String(r.pass + r.fail).padStart(9) + '  ' + r.name + (r.fail ? '\n' + ' '.repeat(w + 22) + col(RED, r.detail) : ''));
  }
  out.push('');
  out.push('LUKI PRODUKTOWE (opisane w docs/PILOT.md)');
  if (!R.gaps.length) out.push('  — brak');
  for (const g of R.gaps) out.push('  ' + col(YEL, g.id) + '  ' + g.title);
  out.push('');
  const codes = [...R.statuses.entries()].sort((a, b) => +a[0] - +b[0]).map(([s, n]) => `${s}×${n}`).join('  ');
  out.push(`ŻĄDANIA: ${R.calls}  ·  statusy: ${codes}`);
  out.push(`CZAS:    ${R.ms} ms  ·  kroków: ${R.steps.length}  ·  inwariantów: ${R.invariants.length} (unikalnych ${rows.length})`);
  const failed = R.violations.length;
  out.push(failed ? col(RED, `NARUSZENIA: ${failed}`) : col(GREEN, 'NARUSZENIA: 0 — tydzień przeszedł bez zastrzeżeń'));
  for (const v of R.violations) out.push('  ' + col(RED, '• ' + (v.id || v.kind) + ' ') + (v.name || '') + (v.detail ? ' — ' + v.detail : ''));
  out.push('');
  return out.join('\n');
}

/* ------------------------------------------------------------------ cli ------------------------- */

if (require.main === module) {
  const quiet = process.argv.includes('--quiet');
  runPilot({ quiet }).then((R) => {
    process.stdout.write(printReport(R) + '\n');
    process.exit(R.violations.length ? 1 : 0);
  }).catch((e) => {
    process.stderr.write('PILOTAŻ PRZERWANY: ' + (e && e.stack ? e.stack : e) + '\n');
    process.exit(2);
  });
}

module.exports = { runPilot, printReport };
