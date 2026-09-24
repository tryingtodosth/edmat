'use strict';
/* R1 — import planu lekcji z formatów, które szkoły naprawdę mają: eksport XML z aSc Timetables i
   publikacja HTML „Plan lekcji Optivum”. Dowód dla historyjki [3.5.5] (import planu lekcji) na
   plikach z `tests/fixtures/real-formats/`. Co w tych plikach jest schematem, a co rekonstrukcją,
   mówi ich README; **żadnego prawdziwego pliku ze szkoły jeszcze nie widzieliśmy** (docs/IMPORT.md).

   Każdy test musi przechodzić sam, więc wspólny stan idzie przez `fixtures()`. */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { startServer, expectOk, fixtures, withConfig } = require('./helpers');
const TD = require('../server/lib/textdecode');
const CSVP = require('../server/lib/csv');
const ASC = require('../server/lib/import-asc');
const OPT = require('../server/lib/import-optivum');
const TTL = require('../server/lib/timetable');
const { findConflicts } = require('../server/routes/admin');

const FIX = path.join(__dirname, 'fixtures', 'real-formats');
const bytes = (rel) => fs.readFileSync(path.join(FIX, rel));
const b64 = (rel) => bytes(rel).toString('base64');
/** Jedna publikacja Optivum jako mapa `{ścieżka: base64}` — dokładnie to, co wysyła przeglądarka:
    strony z korzenia katalogu (`index.html`, `lista.html`) plus `plany/`. Katalog fixture'ów trzyma
    obok siebie kilka publikacji (`utf8/`, `edge/`, `ab/`, `edge2/`), więc rekurencyjny spacer
    zlepiłby je w jeden plan; `wholeTree()` niżej robi to celowo, żeby sprawdzić, co wtedy robi import. */
function tree(rel) {
  const out = {}; const root = path.join(FIX, rel);
  const add = (dir, pre) => {
    if (!fs.existsSync(dir)) return;
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      if (!e.isFile() || !/\.html?$/i.test(e.name)) continue;
      out[pre ? pre + '/' + e.name : e.name] = fs.readFileSync(path.join(dir, e.name)).toString('base64');
    }
  };
  add(root, '');
  add(path.join(root, 'plany'), 'plany');
  return out;
}
/** Wszystko, co leży pod katalogiem — czyli kilka publikacji naraz (upload całego `optivum/`). */
function wholeTree(rel) {
  const out = {}; const root = path.join(FIX, rel);
  (function walk(dir, pre) {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name), k = pre ? pre + '/' + e.name : e.name;
      if (e.isDirectory()) walk(p, k); else if (/\.html?$/i.test(e.name)) out[k] = fs.readFileSync(p).toString('base64');
    }
  })(root, '');
  return out;
}

let S; const extra = [];
test.before(async () => { S = await startServer(); });
test.after(async () => { for (const x of extra) await x.close(); if (S) await S.close(); });
const spawn = async () => { const T = await startServer(); extra.push(T); return T; };

/* Szkoła, która naprawdę ma to, co jest w `asc/plan-sp12.xml`: 8 oddziałów, 20 nauczycieli i te
   przedmioty. Zasiew demo ma 5 oddziałów i 13 przedmiotów — plik i baza celowo się nie pokrywają
   (README fixture'ów, §1 „Zasięg”), więc pełne wczytanie planu wymaga albo mapowania, albo szkoły
   o tej kadrze. Tu budujemy tę drugą, żeby zobaczyć plan w całości. */
const need = fixtures();
async function richSchool() {
  return need('richSchool', async () => {
    const T = await spawn();
    for (const [id, name] of [['niem', 'Język niemiecki'], ['tec', 'Technika'], ['rel', 'Religia'], ['ety', 'Etyka'],
      ['wdz', 'Wychowanie do życia w rodzinie'], ['wych', 'Godzina z wychowawcą']]) T.db.col('subjects').push({ id, name });
    for (const [id, level] of [['1b', 1], ['3b', 3], ['8a', 8]]) T.db.col('classes').push({ id, name: id, level, homeroomTeacherId: null, studentIds: [] });
    for (const [id, firstName, lastName] of [['zak', 'Małgorzata', 'Żak'], ['cwikla', 'Halina', 'Ćwikła'], ['stec', 'Jacek', 'Stec'],
      ['dabrowski', 'Łukasz', 'Dąbrowski'], ['swiderska', 'Zofia', 'Świderska'], ['pajak', 'Grażyna', 'Pająk'],
      ['lecka', 'Urszula', 'Łęcka'], ['nowicka', 'Wanda', 'Nowicka'], ['borowiec', 'Jan', 'Borowiec'],
      ['akowalczyk', 'Agnieszka', 'Kowalczyk']]) T.db.col('users').push({ id: 'u_' + id, login: id, role: 'teacher', title: 'mgr', firstName, lastName, subjects: [], blocked: false });
    T.db.save();
    return { T, c: await T.as('admin') };
  });
}

/* ---------------------------------------------------------------------------- 1. dekodery */
test('[R1.1] dekodery bez npm-a: windows-1250 bajt po bajcie, BOM, <meta charset> i deklaracja XML', async () => {
  /* Bajty sprawdzone w README fixture'ów §4 pkt 1. Node 18 nie ma dekodera cp1250. */
  assert.equal(TD.decodeCp1250(Buffer.from([0xB3])), 'ł');
  assert.equal(TD.decodeCp1250(Buffer.from([0xB9])), 'ą');
  assert.equal(TD.decodeCp1250(Buffer.from([0x8C])), 'Ś');
  assert.equal(TD.decodeCp1250(Buffer.from([0x9C, 0xBF, 0xF3])), 'śżó');
  assert.equal(TD.CP1250.length, 128, 'tablica pokrywa dokładnie bajty 0x80–0xFF');

  const opt = TD.decode(bytes('optivum/plany/o1.html'), { default: 'utf-8' });
  assert.equal(opt.encoding, 'windows-1250');
  assert.equal(opt.source, 'meta', 'kodowanie wzięte z <meta http-equiv>, nie zgadywane');
  assert.match(opt.text, /Środa/); assert.match(opt.text, /j\.angielski/);
  assert.ok(!opt.text.includes('�'), 'żadnych znaków zastępczych');

  const utf = TD.decode(bytes('optivum/utf8/plany/o1.html'), { default: 'windows-1250' });
  assert.equal(utf.encoding, 'utf-8');
  assert.equal(utf.source, 'meta');
  assert.equal(utf.text.replace(/utf-8/gi, 'windows-1250'), opt.text, 'oba pliki niosą ten sam tekst');

  const edge = TD.decode(bytes('asc/plan-edge.xml'), { default: 'utf-8' });
  assert.equal(edge.source, 'bom', 'BOM ma pierwszeństwo przed deklaracją w treści');
  assert.ok(edge.text.startsWith('<?xml'), 'BOM usunięty: ' + JSON.stringify(edge.text.slice(0, 10)));
  assert.equal(TD.decode(bytes('asc/plan-sp12.xml'), { default: 'windows-1250' }).source, 'xml');

  /* CSV bez żadnej deklaracji: nabór jest w cp1250, Librus w UTF-8 — rozpoznajemy po bajtach. */
  assert.equal(TD.decode(bytes('register/nabor-vulcan.csv'), { default: 'utf-8' }).encoding, 'windows-1250');
  assert.equal(TD.decode(bytes('register/nabor-vulcan.utf8.csv'), { default: 'utf-8' }).source, 'bom');
  assert.equal(TD.decode(bytes('register/librus-uczniowie.csv'), { default: 'utf-8' }).encoding, 'utf-8');
});

/* ------------------------------------------------------------------------- 2. parser CSV */
test('[R1.2] parser CSV z cudzysłowami: adnotacja sądowa ze średnikiem i eksport UONET+ w cudzysłowach', async () => {
  const uonet = CSVP.parseObjects(TD.decode(bytes('register/uonet-uczniowie.csv'), { default: 'utf-8' }).text);
  assert.equal(uonet.separator, ';');
  assert.equal(uonet.header.length, 22);
  assert.equal(uonet.rows.length, 60);
  assert.equal(uonet.rows[0]['Nazwisko'], 'Kowalski', 'cudzysłowy zdjęte, nie wklejone do wartości');
  assert.equal(uonet.rows[0]['Data urodzenia'], '08.02.2019');
  assert.ok(uonet.rows.every((r) => Object.keys(r).length === 23), 'każdy wiersz ma komplet kolumn');

  const nabor = CSVP.parseObjects(TD.decode(bytes('register/nabor-vulcan.csv'), { default: 'utf-8' }).text);
  const court = nabor.rows.find((r) => /pozbawiony władzy/.test(CSVP.column(r, 'Uwagi') || ''));
  assert.ok(court, 'wiersz z adnotacją sądową');
  assert.match(CSVP.column(court, 'Uwagi'), /Nsm 412\/24.*kontakt wyłącznie z matką/s, 'średnik w środku pola nie rozbija wiersza');
  assert.equal(CSVP.column(court, 'Opiekun 1 – nazwisko'), 'Michalski', 'półpauza w nagłówku');
  assert.equal(CSVP.column(court, 'Opiekun 1 - nazwisko'), 'Michalski', 'ten sam nagłówek pisany dywizem');
  assert.equal(String(CSVP.column(court, 'Uwagi')).includes('"'), false);

  /* Przypadki RFC 4180 wprost: CRLF, BOM, podwojony cudzysłów, separator w polu, przecinek jako separator. */
  const one = CSVP.parse('﻿a;"b;c";"on ""cyt"""\r\nd;e;f\r\n');
  assert.deepEqual(one.rows, [['a', 'b;c', 'on "cyt"'], ['d', 'e', 'f']]);
  assert.deepEqual(CSVP.parse('a,b,"c,d"').rows, [['a', 'b', 'c,d']]);
  assert.deepEqual(CSVP.parse('a;b\r\n"wiersz\nz nową linią";x').rows, [['a', 'b'], ['wiersz\nz nową linią', 'x']]);
});

/* --------------------------------------------------------------------------- 3. aSc XML */
test('[R1.3] aSc: plan-sp12.xml → pary A/B, lekcje podwójne, dwóch nauczycieli, lekcje bez sali i podziały na grupy', async () => {
  const p = ASC.parseAsc(bytes('asc/plan-sp12.xml'), { ref: 'plan-sp12.xml' });
  assert.equal(p.tool, 'asc');
  assert.equal(p.version, '2012.3.2');
  assert.equal(p.encoding, 'utf-8');
  assert.equal(p.stats.lessons, 108);
  assert.equal(p.stats.cards, 264);
  assert.equal(p.stats.rows, 272, 'karty podwójne rozwinięte na dwie godziny');
  assert.equal(p.stats.doubles, 8, 'periodspercard="2" — 8 kart');
  assert.equal(p.stats.duplicates, 0);
  assert.deepEqual(p.stats.weeks, { all: 264, A: 4, B: 4 }, 'cykl dwutygodniowy: informatyka w czterech oddziałach');

  assert.equal(p.entities.teachers.length, 20);
  assert.equal(p.entities.classes.length, 8);
  assert.equal(p.entities.rooms.length, 14);
  assert.deepEqual(p.entities.classes.map((x) => x.key).sort(), ['1A', '1B', '3A', '3B', '7A', '7B', '8A', '8B']);
  assert.ok(p.entities.teachers.some((x) => x.key === 'ŻM' && x.name === 'Małgorzata Żak'), 'diakrytyki w skrótach');

  const perClass = {};
  for (const r of p.rows) perClass[r.classKey] = (perClass[r.classKey] || 0) + 1;
  assert.deepEqual(perClass, { '1A': 25, '1B': 25, '3A': 25, '3B': 25, '7A': 43, '7B': 43, '8A': 43, '8B': 43 });

  const two = p.rows.filter((r) => r.teacherKeys.length > 1);
  assert.equal(two.length, 4, 'matematyka 7b z nauczycielem wspomagającym');
  assert.deepEqual([...new Set(two.map((r) => r.teacherKeys.join('+')))], ['NJ+SR']);
  assert.deepEqual([...new Set(two.map((r) => r.classKey))], ['7B']);

  assert.equal(p.rows.filter((r) => !r.roomKey).length, 12, 'etyka bez sali (classroomids="")');
  assert.ok(p.rows.filter((r) => !r.roomKey).every((r) => r.subjectKey === 'Etyka'));

  const ab = p.rows.filter((r) => r.week);
  assert.equal(ab.length, 8);
  assert.deepEqual([...new Set(ab.map((r) => r.subjectKey))], ['Informatyka']);
  for (const cls of ['7A', '7B', '8A', '8B']) {
    const mine = ab.filter((r) => r.classKey === cls);
    assert.deepEqual(mine.map((r) => r.week).sort(), ['A', 'B'], cls + ': para tydzień I / tydzień II w tym samym okienku');
    assert.equal(mine[0].weekday, mine[1].weekday);
    assert.equal(mine[0].lessonNo, mine[1].lessonNo);
    assert.notEqual(mine[0].groupLabel, mine[1].groupLabel, 'dwie różne grupy informatyki');
  }

  const labels = [...new Set(p.rows.map((r) => r.groupLabel).filter(Boolean))].sort();
  assert.deepEqual(labels, ['1. grupa', '2. grupa', 'Chłopcy', 'Dziewczęta', 'Etyka', 'Religia']);
  assert.equal(p.rows.filter((r) => r.entireClass).length, 168);
  assert.ok(p.warnings.some((w) => /termsdefs/.test(w)), 'termsdefs pominięte z adnotacją: ' + JSON.stringify(p.warnings));

  /* `displaycountry` vs `displaycountries` — README §1 nie rozstrzyga, więc przyjmujemy obie. */
  assert.equal(p.country, 'pl');
  const alt = ASC.parseAsc(Buffer.from(bytes('asc/plan-sp12.xml').toString('utf8').replace('displaycountry=', 'displaycountries=')));
  assert.equal(alt.country, 'pl');
  assert.equal(alt.stats.rows, 272);
});

test('[R1.4] aSc: plan-edge.xml — BOM, CRLF, brakująca sala i zdublowana karta są raportowane, nie wywracają importu', async () => {
  const raw = bytes('asc/plan-edge.xml');
  assert.deepEqual([...raw.slice(0, 3)], [0xEF, 0xBB, 0xBF], 'fixture naprawdę ma BOM');
  assert.ok(raw.includes(Buffer.from('\r\n')), 'fixture naprawdę ma CRLF');

  const p = ASC.parseAsc(raw, { ref: 'plan-edge.xml' });
  assert.equal(p.stats.rows, 272, 'ten sam plan co plan-sp12.xml mimo BOM-u, CRLF-ów i pułapek');
  assert.equal(p.stats.cards, 266);
  assert.equal(p.stats.duplicates, 2, 'zdublowana karta scalona, nie policzona dwa razy');
  assert.ok(p.warnings.some((w) => /\*9999/.test(w)), 'nieistniejąca sala zgłoszona: ' + JSON.stringify(p.warnings));
  assert.ok(p.warnings.some((w) => /zdublowan/.test(w)));
  assert.ok(p.warnings.some((w) => /nie ma skrótu/.test(w)), 'pusty short ma plan B');
  const cwikla = p.entities.teachers.find((t) => t.name === 'Halina Ćwikła');
  assert.equal(cwikla.short, '');
  assert.equal(cwikla.key, 'Halina Ćwikła', 'bez skrótu kluczem jest imię i nazwisko');

  const base = ASC.parseAsc(bytes('asc/plan-sp12.xml'));
  const k = (r) => [r.classKey, r.weekday, r.lessonNo, r.week, r.groupLabel, r.subjectKey, r.roomKey].join('|');
  assert.deepEqual(p.rows.map(k).sort(), base.rows.map(k).sort(), 'oba pliki opisują ten sam plan');
});

test('[R1.5] aSc: starszy eksport „2008” (bez daysdefs/weeksdefs, day zamiast maski, durationperiods) daje się wczytać', async () => {
  const p = ASC.parseAsc(bytes('asc/plan-old-2008.xml'), { ref: 'plan-old-2008.xml' });
  assert.equal(p.version, '2008');
  assert.equal(p.stats.rows, 86);
  assert.equal(p.stats.duplicates, 0, 'karty tej samej lekcji w różne dni to nie duplikaty');
  assert.equal(p.stats.doubles, 4, 'durationperiods="2"');
  assert.deepEqual(p.entities.classes.map((x) => x.key).sort(), ['7A', '7B']);
  assert.ok(p.rows.every((r) => r.week === null), 'bez <weeksdefs> cały plan jest „co tydzień”');
  assert.ok(p.warnings.some((w) => /2008/.test(w) && /weeksdefs/.test(w)), JSON.stringify(p.warnings));
  assert.deepEqual([...new Set(p.rows.map((r) => r.groupLabel).filter(Boolean))].sort(), ['gr. 1', 'gr. 2'], 'podział z atrybutu group="1"');
  /* Nauczyciel ma tu jedno pole `name`, nie firstname + lastname. */
  assert.ok(p.entities.teachers.some((t) => t.key === 'NJ' && t.name === 'Joanna Nowak'));
  assert.ok(p.rows.every((r) => r.weekday >= 1 && r.weekday <= 5), 'day="1".."5" zamiast maski');
});

test('[3.5.5] aSc: plan-extra.xml — zajęcia międzyoddziałowe dają wiersz na oddział, godzina 0 wchodzi dopiero po dopisaniu jej do dzwonków', async () => {
  const p = ASC.parseAsc(bytes('asc/plan-extra.xml'), { ref: 'plan-extra.xml' });
  assert.equal(p.country, 'pl', 'druga pisownia atrybutu: displaycountries');
  assert.equal(p.stats.lessons, 7);
  assert.equal(p.stats.cards, 10);
  assert.equal(p.stats.rows, 15);

  /* Lekcja z dwoma `classids` to jedna lekcja w szkole, ale dwa wiersze planu — po jednym na
     oddział, z tą samą salą, tym samym nauczycielem i tą samą godziną. */
  const rel = p.rows.filter((r) => r.subjectKey === 'Religia');
  assert.equal(rel.length, 4, 'religia 7A+7B × dwie karty');
  assert.deepEqual([...new Set(rel.map((r) => r.classKey))].sort(), ['7A', '7B']);
  assert.deepEqual([...new Set(rel.map((r) => r.weekday))].sort(), [1, 3]);
  assert.ok(rel.every((r) => r.lessonNo === 3 && r.roomKey === '11' && r.teacherKeys.join('+') === 'ŻM'));
  assert.ok(rel.every((r) => r.groupLabel === 'Religia'), 'grupa tego oddziału, nie cudza');

  const wf = p.rows.filter((r) => r.subjectKey === 'Wychowanie fizyczne');
  assert.equal(wf.length, 4, '7B+8A × periodspercard="2"');
  assert.deepEqual([...new Set(wf.map((r) => r.classKey))].sort(), ['7B', '8A']);
  assert.deepEqual(wf.filter((r) => r.classKey === '8A').map((r) => r.lessonNo).sort(), [4, 5], 'karta podwójna rozwinięta');
  assert.ok(wf.every((r) => r.weekday === 2 && r.roomKey === 'sg' && r.groupLabel === 'Chłopcy'));

  /* Godzina 0 (7:10) — numer czytany z atrybutu `period`, nie z pozycji w liście. */
  const zero = p.rows.filter((r) => r.lessonNo === 0);
  assert.equal(zero.length, 2);
  assert.deepEqual(zero.map((r) => [r.classKey, r.weekday, r.subjectKey]).sort(), [['7A', 4, 'Język angielski'], ['8A', 5, 'Matematyka']]);

  /* Szkoła bez godziny 0 w planie dzwonków: te dwa wiersze odpadają z wyraźnym komunikatem,
     który mówi, jak ją dodać — a nie z „poza planem dzwonków” bez wskazówki. */
  const { T, c } = await richSchool();
  const dry = expectOk(await c.post('/api/admin/timetable/import', { format: 'asc-xml', dataBase64: b64('asc/plan-extra.xml'), dryRun: true }));
  assert.equal(dry.rows, 13);
  assert.equal(dry.errors.length, 2, JSON.stringify(dry.errors));
  assert.ok(dry.errors.every((e) => /numer lekcji „0”/.test(e) && /plan(ie)? dzwonków/.test(e)), JSON.stringify(dry.errors));
  assert.ok(dry.errors[0].includes('godzinę 0'), 'komunikat podpowiada, co zrobić: ' + dry.errors[0]);
  assert.ok(dry.errors[0].includes('1, 2, 3, 4, 5, 6, 7, 8'), 'i wymienia dostępne numery');
  assert.deepEqual(dry.proposal.blocking, [], 'ta szkoła ma wszystkie encje z pliku');
  /* Zajęcia międzyoddziałowe przeszły w obie strony — 8A ma swój WF. */
  assert.ok(dry.rowsPerClass['8a'] >= 2 && dry.rowsPerClass['7b'] >= 2, JSON.stringify(dry.rowsPerClass));
  assert.deepEqual(dry.conflicts, [], 'jedna lekcja w dwóch oddziałach to nie jest kolizja nauczyciela: ' + JSON.stringify(dry.conflicts));

  /* Po dopisaniu dzwonka `no: 0` ten sam plik wchodzi w całości. */
  const zeroBell = [{ no: 0, start: '07:10', end: '07:55' }].concat(T.db.data.config.lessonTimes);
  await withConfig(T.db, { lessonTimes: zeroBell }, async () => {
    const ok = expectOk(await c.post('/api/admin/timetable/import', { format: 'asc-xml', dataBase64: b64('asc/plan-extra.xml'), dryRun: true }));
    assert.deepEqual(ok.errors, []);
    assert.equal(ok.rows, 15);
    assert.equal(ok.ok, true, JSON.stringify(ok.conflicts));
  });
  /* …i znowu wypada, gdy szkoła wróci do ośmiu dzwonków. Granicą jest istnienie dzwonka o tym
     numerze, nie długość tablicy: numeru 9 nie ma nawet przy dziewięcioelementowej liście. */
  const nine = expectOk(await c.post('/api/admin/timetable/import', { data: 'class;weekday;lessonNo;subject;teacherLogin;room;group\n7a;1;9;mat;j.nowak;12;', dryRun: true }));
  assert.equal(nine.rows, 0);
  assert.ok(nine.errors[0].includes('„9”'), nine.errors[0]);
  await withConfig(T.db, { lessonTimes: zeroBell }, async () => {
    const still = expectOk(await c.post('/api/admin/timetable/import', { data: 'class;weekday;lessonNo;subject;teacherLogin;room;group\n7a;1;9;mat;j.nowak;12;', dryRun: true }));
    assert.equal(still.rows, 0, 'dziewięć dzwonków (0–8) to nadal brak numeru 9');
    const hour0 = expectOk(await c.post('/api/admin/timetable/import', { data: 'class;weekday;lessonNo;subject;teacherLogin;room;group\n7a;1;0;mat;j.nowak;12;', dryRun: true }));
    assert.deepEqual(hour0.errors, []);
    assert.equal(hour0.rows, 1);
    assert.equal(hour0.conflicts.length, 0);
  });
});

/* ------------------------------------------------------------------------ 4. Optivum HTML */
test('[R1.6] Optivum: publikacja w cp1250 i w UTF-8 daje ten sam plan, a strony brzegowe nie rozjeżdżają tabeli', async () => {
  const cp = OPT.parseOptivum(tree('optivum'), { ref: 'cp1250' });
  const utf = OPT.parseOptivum(tree('optivum/utf8'), { ref: 'utf8' });
  assert.equal(cp.encoding, 'windows-1250');
  assert.equal(utf.encoding, 'utf-8');
  const k = (r) => [r.classKey, r.weekday, r.lessonNo, r.groupLabel, r.subjectKey, r.teacherKeys.join('+'), r.roomKey].join('|');
  assert.deepEqual(cp.rows.map(k).sort(), utf.rows.map(k).sort(), 'oba drzewa niosą ten sam plan');
  assert.equal(cp.stats.rows, 112);
  assert.deepEqual(cp.stats.rowsPerClass, { '4A': 14, '4B': 14, '5A': 14, '5B': 14, '6A': 14, '7A': 14, '7B': 14, '8B': 14 });
  assert.equal(cp.stats.classPages, 8);
  assert.equal(cp.stats.mismatches, 0, 'kontrola krzyżowa ze stronami nauczycieli bez rozbieżności');
  assert.equal(cp.rows.filter((r) => r.groupLabel).length, 32, 'sufiksy -1/2 i -2/2');
  assert.deepEqual([...new Set(cp.rows.map((r) => r.groupLabel).filter(Boolean))].sort(), ['1/2', '2/2']);
  /* `lista.html` daje imiona i nazwiska do skrótów — bez niej zostaje samo „KE”. */
  assert.ok(cp.entities.teachers.some((t) => t.key === 'KE' && t.name === 'Król Ewa'));
  assert.deepEqual([...new Set(cp.rows.map((r) => r.subjectKey))].sort(), ['geografia', 'historia', 'j.angielski', 'j.polski', 'matematyka', 'w-f']);

  /* Strona brzegowa nauczyciela: lekcje podwójne przez rowspan i pusty piątek. */
  const edge = OPT.parseOptivum(tree('optivum/edge'), { ref: 'edge' });
  assert.equal(edge.stats.doubles, 7, 'siedem lekcji podwójnych zapisanych jako rowspan="2"');
  const wf = edge.rows.filter((r) => r.classKey === '5B');
  assert.deepEqual(wf.map((r) => r.lessonNo).sort(), [1, 2], 'rowspan rozwinięty na dwie kolejne godziny');
  assert.deepEqual([...new Set(wf.map((r) => r.weekday))], [2], 'kolejny wiersz ma mniej <td>, a kolumna się nie przesuwa');
  assert.equal(edge.rows.filter((r) => r.weekday === 5).length, 0, 'cała kolumna piątku jest pusta — to legalne');
  assert.equal(edge.homerooms['4A'], 'Sikora Beata', 'wiersz „Wychowawca:” ze strony oddziału');
  assert.ok(edge.warnings.some((w) => /lista\.html/.test(w)), 'brak lista.html zgłoszony: ' + JSON.stringify(edge.warnings));

  /* Pojedyncza strona oddziału też jest poprawnym wejściem. */
  const one = OPT.parseOptivum(bytes('optivum/plany/o1.html'), { path: 'o1.html' });
  assert.equal(one.stats.rows, 14);
  assert.deepEqual(Object.keys(one.stats.rowsPerClass), ['4A']);
});

test('[R1.7] Optivum: kontrola krzyżowa znajduje dokładnie dwie rozbieżności oddział ↔ nauczyciel i nie zgaduje, która strona ma rację', async () => {
  const p = OPT.parseOptivum(tree('optivum/edge2'), { ref: 'edge2' });
  assert.equal(p.stats.classPages, 2);
  assert.equal(p.stats.teacherPages, 2);
  assert.equal(p.stats.roomPages, 2);
  assert.equal(p.crossMismatch.length, 2, 'ani jednej więcej: ' + JSON.stringify(p.crossMismatch));

  /* M1 — sala: oddział i sala mówią 12, strona nauczyciela mówi 15. */
  const m1 = p.crossMismatch.find((m) => m.kind === 'room');
  assert.ok(m1, JSON.stringify(p.crossMismatch));
  assert.equal(m1.classKey, '7A'); assert.equal(m1.weekday, 1); assert.equal(m1.lessonNo, 2);
  assert.equal(m1.subject, 'matematyka'); assert.equal(m1.teacher, 'NJ');
  assert.equal(m1.onClassPage, '12'); assert.equal(m1.onTeacherPage, '15');

  /* M2 — nauczyciel: godzina 7B siedzi na stronie Nowak, a oddział i sala mówią SB. */
  const m2 = p.crossMismatch.find((m) => m.kind === 'teacher');
  assert.ok(m2, JSON.stringify(p.crossMismatch));
  assert.equal(m2.classKey, '7B'); assert.equal(m2.weekday, 3); assert.equal(m2.lessonNo, 1);
  assert.equal(m2.subject, 'j.polski');
  assert.equal(m2.onClassPage, 'SB'); assert.equal(m2.onTeacherPage, 'NJ');

  /* Plan bierzemy ze stron oddziałów — strony nauczycieli niczego nie nadpisują. */
  const mat = p.rows.find((r) => r.classKey === '7A' && r.weekday === 1 && r.lessonNo === 2);
  assert.equal(mat.roomKey, '12', 'strona oddziału wygrywa');
  const pol = p.rows.find((r) => r.classKey === '7B' && r.weekday === 3 && r.lessonNo === 1);
  assert.deepEqual(pol.teacherKeys, ['SB']);
  assert.equal(p.rows.filter((r) => r.classKey === '7B' && r.weekday === 3 && r.lessonNo === 1).length, 1, 'wersja z nauczyciela nie dokłada drugiego wiersza');
  assert.equal(p.stats.rows, 10);

  /* Rozbieżność ma trafić pod oko człowieka: jest w `warnings` i w raporcie próbnego importu. */
  const w = p.warnings.find((x) => /Kontrola krzyżowa/.test(x));
  assert.ok(w, JSON.stringify(p.warnings));
  assert.match(w, /rozstrzyga człowiek/);
  assert.match(w, /7A.*godz\. 2/);
  assert.match(w, /7B.*godz\. 1/);

  const { c } = await richSchool();
  const dry = expectOk(await c.post('/api/admin/timetable/import', { files: tree('optivum/edge2'), dryRun: true }));
  assert.equal(dry.crossMismatch.length, 2);
  assert.deepEqual(dry.crossMismatch.map((m) => m.kind).sort(), ['room', 'teacher']);
  assert.ok(dry.warnings.some((x) => /Kontrola krzyżowa/.test(x)));
});

test('[R1.8] Optivum: znaczniki tygodnia przy przedmiocie („-T1”/„-T2”) czytamy heurystycznie, z ostrzeżeniem, i nie mylimy ich z podziałem „-1/2”', async () => {
  const p = OPT.parseOptivum(tree('optivum/ab'), { ref: 'ab' });
  assert.equal(p.stats.rows, 24);
  assert.deepEqual(p.stats.rowsPerClass, { '7A': 6, '7B': 6, '8A': 6, '8B': 6 });
  assert.deepEqual(p.stats.weeks, { all: 16, A: 4, B: 4 }, 'po jednej parze A/B na oddział, reszta co tydzień');
  assert.equal(p.stats.weekMarkers, 2);

  /* Marker jest odczytany, nazwa przedmiotu z niego oczyszczona, a sufiks nie stał się grupą. */
  const pair = p.rows.filter((r) => r.classKey === '7A' && r.week);
  assert.equal(pair.length, 2);
  assert.deepEqual(pair.map((r) => [r.week, r.subjectKey, r.roomKey, r.weekMarker]).sort(),
    [['A', 'informatyka', 'sk', 'T1'], ['B', 'fizyka', '12', 'T2']]);
  assert.equal(pair[0].weekday, pair[1].weekday);
  assert.equal(pair[0].lessonNo, pair[1].lessonNo);
  assert.deepEqual([...new Set(p.rows.map((r) => r.groupLabel).filter(Boolean))], [], 'żaden marker tygodnia nie wylądował jako grupa');
  assert.ok(p.rows.filter((r) => !r.week).every((r) => !/-T\d$/.test(r.subjectKey)), 'nazwy przedmiotów bez ogonków');

  /* Heurystyka mówi o sobie głośno: marker, tydzień, liczba pozycji i legenda spod tabeli. */
  const w = p.warnings.find((x) => /heurystycznie/.test(x));
  assert.ok(w, JSON.stringify(p.warnings));
  assert.match(w, /„-T1” → tydzień A/);
  assert.match(w, /„-T2” → tydzień B/);
  assert.match(w, /tydzień nieparzysty/, 'legenda `<p class="opis">` stoi po </table> i musi być odczytana');
  assert.match(w, /-1\/2/, 'ostrzeżenie tłumaczy, czym marker różni się od podziału na grupy');
  assert.equal(p.warnings.some((x) => /nie niesie cyklu dwutygodniowego/.test(x)), false, 'nie twierdzimy jednocześnie, że cyklu nie ma');

  /* Publikacja bez markerów nadal jest „co tydzień” i mówi o tym wprost. */
  const plain = OPT.parseOptivum(tree('optivum'), { ref: 'plain' });
  assert.equal(plain.stats.weekMarkers, 0);
  assert.ok(plain.warnings.some((x) => /nie niesie cyklu dwutygodniowego/.test(x)));
  assert.ok(plain.rows.every((r) => !r.week));

  /* Sam sufiks bez kontekstu (jedna lekcja w komórce, bez legendy) nie staje się tygodniem. */
  assert.deepEqual(OPT.splitGroupSuffix('j.angielski-1/2', true), { base: 'j.angielski', group: '1/2', weekMarker: null, week: null });
  assert.deepEqual(OPT.splitGroupSuffix('informatyka-T1', false), { base: 'informatyka-T1', group: null, weekMarker: null, week: null });
  assert.deepEqual(OPT.splitGroupSuffix('informatyka-T1', true), { base: 'informatyka', group: null, weekMarker: 'T1', week: 'A' });
  assert.deepEqual(OPT.splitGroupSuffix('fizyka-II', true), { base: 'fizyka', group: null, weekMarker: 'II', week: 'B' });

  /* Przez trasę: pary A/B w raporcie, ostrzeżenie pod okiem człowieka, zero fałszywych konfliktów. */
  const { c } = await richSchool();
  const dry = expectOk(await c.post('/api/admin/timetable/import', { files: tree('optivum/ab'), dryRun: true }));
  assert.equal(dry.format, 'optivum-html');
  assert.deepEqual(dry.weeks, { every: 16, A: 4, B: 4 });
  assert.equal(dry.weekMarkers.length, 2);
  assert.deepEqual(dry.weekMarkers.map((m) => [m.marker, m.week, m.rows]).sort(), [['T1', 'A', 4], ['T2', 'B', 4]]);
  assert.ok(dry.warnings.some((x) => /heurystycznie/.test(x)));
  assert.deepEqual(dry.conflicts, [], 'informatyka w tygodniu A i fizyka w tygodniu B to nie kolizja: ' + JSON.stringify(dry.conflicts));
  assert.deepEqual(dry.proposal.blocking, []);
  assert.equal(dry.rows, 24);
});

test('[R1.9] wgrany katalog z kilkoma publikacjami naraz: import bierze jedną i mówi, które pominął', async () => {
  const all = wholeTree('optivum');
  assert.ok(Object.keys(all).length > 50, 'w katalogu fixture\'ów leży pięć publikacji obok siebie');
  const p = OPT.parseOptivum(all, { ref: 'wszystko' });
  assert.equal(p.stats.rows, 112, 'plan jednej publikacji, nie zlepek pięciu');
  assert.deepEqual(p.stats.rowsPerClass, { '4A': 14, '4B': 14, '5A': 14, '5B': 14, '6A': 14, '7A': 14, '7B': 14, '8B': 14 });
  const w = p.warnings.find((x) => /publikacji planu/.test(x));
  assert.ok(w, JSON.stringify(p.warnings));
  assert.match(w, /pominięto/);
  for (const name of ['utf8', 'ab', 'edge2', 'edge']) assert.ok(w.includes(name), name + ' powinien być wymieniony: ' + w);

  const { c } = await richSchool();
  const dry = expectOk(await c.post('/api/admin/timetable/import', { files: all, dryRun: true }));
  assert.ok(dry.warnings.some((x) => /publikacji planu/.test(x)));
  assert.equal(dry.sourceStats.rows, 112);
});

/* ------------------------------------------------------------------------- 5. konflikty */
test('[R1.10] konflikty planu liczą tydzień i grupę: rozłączne grupy i przeciwne tygodnie nie kolidują, cały oddział z grupą — tak', async () => {
  const row = (o) => Object.assign({ id: 'x', classId: '7b', weekday: 1, lessonNo: 1, subjectId: 'mat', teacherId: 'u_nowak', teacherIds: ['u_nowak'], room: '12', groupId: null, groupLabel: null, week: null, line: 1 }, o);

  /* WF chłopcy i dziewczęta w tym samym okienku, dwóch nauczycieli, dwie sale — to nie konflikt. */
  assert.deepEqual(findConflicts(S.db, [
    row({ subjectId: 'wf', teacherId: 'u_mazur', teacherIds: ['u_mazur'], room: 'sg', groupLabel: 'Chłopcy' }),
    row({ subjectId: 'wf', teacherId: 'u_krol', teacherIds: ['u_krol'], room: 'msg', groupLabel: 'Dziewczęta', line: 2 })]), []);

  /* Religia i etyka równolegle: inne przedmioty, inne grupy. */
  assert.deepEqual(findConflicts(S.db, [
    row({ subjectId: 'his', teacherId: 'u_lis', teacherIds: ['u_lis'], room: '9', groupLabel: 'Religia' }),
    row({ subjectId: 'geo', teacherId: 'u_mazur', teacherIds: ['u_mazur'], room: '', groupLabel: 'Etyka', line: 2 })]), []);

  /* Ten sam nauczyciel i ta sama sala, ale przeciwne tygodnie cyklu. */
  assert.deepEqual(findConflicts(S.db, [
    row({ classId: '7a', week: 'A' }),
    row({ classId: '7b', week: 'B', line: 2 })]), []);

  /* Cały oddział razem z grupą w tym samym okienku — to już konflikt. */
  const clash = findConflicts(S.db, [
    row({ subjectId: 'mat' }),
    row({ subjectId: 'ang', teacherId: 'u_krol', teacherIds: ['u_krol'], room: '15', groupLabel: '1. grupa', line: 2 })]);
  assert.equal(clash.filter((x) => x.kind === 'class').length, 1, JSON.stringify(clash));
  assert.deepEqual(clash.find((x) => x.kind === 'class').lines.sort(), [1, 2]);

  /* Ta sama grupa dwa razy — konflikt; obie pozycje „co tydzień”. */
  assert.equal(findConflicts(S.db, [
    row({ groupLabel: '1. grupa' }),
    row({ subjectId: 'ang', teacherId: 'u_krol', teacherIds: ['u_krol'], room: '15', groupLabel: '1. grupa', line: 2 })]).some((x) => x.kind === 'class'), true);

  /* Nauczyciel w dwóch oddziałach w tym samym tygodniu — konflikt; w przeciwnych — nie (wyżej). */
  const t = findConflicts(S.db, [row({ classId: '7a' }), row({ classId: '8b', room: '9', line: 2 })]);
  assert.equal(t.filter((x) => x.kind === 'teacher').length, 1, JSON.stringify(t));

  /* Nauczyciel wspomagający: kolizja liczy się dla każdego z `teacherIds`. */
  const both = findConflicts(S.db, [
    row({ teacherIds: ['u_nowak', 'u_wspomagajacy'] }),
    row({ classId: '7a', teacherId: 'u_wspomagajacy', teacherIds: ['u_wspomagajacy'], room: '11', line: 2 })]);
  assert.equal(both.some((x) => x.kind === 'teacher' && /Wspomagaj|wspomagaj/i.test(x.detail) === true || x.kind === 'teacher'), true, JSON.stringify(both));

  /* I dowód wprost: cały prawdziwy plan z aSc, w szkole, która go ma, nie zgłasza ani jednego
     fałszywego konfliktu — przed tą zmianą były ich setki (README fixture'ów, „Trzy rzeczy…” pkt 2). */
  const { c } = await richSchool();
  const dry = expectOk(await c.post('/api/admin/timetable/import', { format: 'asc-xml', dataBase64: b64('asc/plan-sp12.xml'), dryRun: true }));
  assert.equal(dry.rows, 272);
  assert.deepEqual(dry.conflicts, []);
  assert.deepEqual(dry.errors, []);
});

/* ------------------------------------------------------------------- 6. import dwufazowy */
test('[3.5.5] import dwufazowy: próbny przebieg zwraca propozycję dopasowania, a zapis bez mapowania kończy się 400 i niczego nie zapisuje', async () => {
  const T = await spawn();
  const c = await T.as('admin');

  const fmt = expectOk(await c.get('/api/admin/timetable/format'));
  assert.deepEqual(fmt.formats.map((f) => f.id), ['csv', 'json', 'asc-xml', 'optivum-html']);
  assert.match(fmt.weekCycle.anchor, /^\d{4}-\d{2}-\d{2}$/);

  const before = T.db.col('timetable').length;
  const dry = expectOk(await c.post('/api/admin/timetable/import', { dataBase64: b64('asc/plan-sp12.xml'), dryRun: true }));
  assert.equal(dry.format, 'asc-xml', 'format rozpoznany bez podpowiedzi');
  assert.equal(dry.applied, false);
  assert.equal(dry.ok, false, 'są encje bez odpowiednika');
  assert.equal(T.db.col('timetable').length, before, 'próbny przebieg niczego nie zapisuje');

  const p = dry.proposal;
  assert.equal(p.tool, 'asc');
  const teacher = (key) => p.teachers.find((x) => x.key === key);
  assert.equal(teacher('NJ').matched, 'u_nowak');
  assert.equal(teacher('NJ').how, 'short', 'skrót „nazwisko+imię”, którym posługuje się aSc');
  assert.equal(teacher('SB').matched, 'u_sikora');
  /* S3-18 — kandydatem na nauczyciela lekcji jest tylko ten, kto może ją ocenić. Bibliotekarka
     „Szymańska Barbara” ma ten sam skrót „SB”, ale nie jest kandydatem, więc skrót rozstrzyga sam;
     jeszcze ważniejsze, że nie da się jej wpisać do dziennika jako nauczycielki matematyki. */
  assert.ok(['short', 'name'].includes(teacher('SB').how), teacher('SB').how);
  const opts = p.options.teachers.map((x) => x.id);
  assert.equal(opts.includes('u_biblioteka'), false, 'bibliotekarka nie może prowadzić lekcji');
  assert.equal(opts.includes('u_iod'), false, 'inspektor ochrony danych też nie');
  assert.ok(opts.includes('u_nowak') && opts.includes('u_wspomagajacy'), 'nauczyciel i nauczyciel wspomagający — tak');
  const badTarget = await c.post('/api/admin/timetable/import', { dataBase64: b64('asc/plan-sp12.xml'), dryRun: true, mapping: { teachers: { NJ: 'u_iod' } } });
  assert.equal(expectOk(badTarget).proposal.teachers.find((x) => x.key === 'NJ').how, 'unknown_target', 'mapowanie na konto spoza kadry uczącej jest odrzucone');
  assert.equal(teacher('ŻM').matched, null);
  assert.equal(teacher('ŻM').how, 'unmatched');
  assert.ok(teacher('NJ').rows > 0, 'propozycja mówi, ilu wierszy dotyczy encja');

  assert.equal(p.classes.find((x) => x.key === '7A').matched, '7a');
  assert.equal(p.classes.find((x) => x.key === '8A').matched, null);
  assert.equal(p.subjects.find((x) => x.key === 'Matematyka').matched, 'mat');
  assert.equal(p.subjects.find((x) => x.key === 'Język polski').how, 'name');
  assert.equal(p.subjects.find((x) => x.key === 'Religia').matched, null);
  assert.equal(p.rooms.find((x) => x.key === '12').matched, '12');
  assert.equal(p.rooms.find((x) => x.key === '3').matched, null, 'sala „3” nie wskakuje na salę „30”');
  assert.ok(p.options.teachers.length && p.options.subjects.length, 'klient dostaje listy do wyboru');

  assert.deepEqual(dry.unmatched.rooms, [], 'sala to wolny tekst — nigdy nie blokuje');
  assert.ok(dry.unmatched.teachers.includes('ŻM'));
  assert.ok(dry.unmatched.classes.includes('8A'));
  assert.ok(dry.unmatched.subjects.includes('Etyka'));
  assert.deepEqual(Object.keys(dry.mapping).sort(), ['classes', 'groups', 'rooms', 'subjects', 'teachers']);
  assert.equal(dry.mapping.teachers.NJ, 'u_nowak');
  /* D3-51/OPS3-12 — encja bez dopasowania **nie ma klucza** w `mapping`. `null` znaczy „człowiek
     zdecydował: pomiń”, więc wpisanie go za człowieka zamieniało 400 „uzupełnij mapowanie” w cichy
     zapis planu bez tych lekcji — dokładnie wtedy, gdy klient odsyłał mapowanie bez zmian. */
  assert.equal('ŻM' in dry.mapping.teachers, false, 'encja bez dopasowania nie udaje decyzji człowieka');
  assert.equal('Etyka' in dry.mapping.subjects, false);
  /* A sale odwrotnie: każda ma klucz, a `null` znaczy „zostaw tekst z pliku”. */
  assert.ok(Object.keys(dry.mapping.rooms).length > 0);
  assert.equal(dry.mapping.rooms['3'], null, 'sala bez dopasowania: null = wpisz to, co w pliku');
  assert.ok(dry.rowsPerClass['7a'] > 0);
  assert.ok(dry.weeks.A > 0 && dry.weeks.B > 0);

  /* Zapis bez uzupełnionego mapowania: 400 z listą, żadnego zapisu częściowego. */
  const refused = await c.post('/api/admin/timetable/import', { dataBase64: b64('asc/plan-sp12.xml'), dryRun: false, force: true });
  assert.equal(refused.status, 400);
  assert.equal(refused.body.code, 'unmatched_entities');
  assert.ok(refused.body.blocking.length > 0);
  assert.ok(refused.body.unmatched.teachers.includes('ŻM'));
  assert.equal(T.db.col('timetable').length, before, 'nic nie zostało zapisane');

  /* OPS3-12/D3-51 na żywo: odesłanie `report.mapping` bez zmian — to, co robi ekran administracji
     i co pokazuje docs/IMPORT.md § 5 — nie może zgubić ani jednej sali. */
  const echo = expectOk(await c.post('/api/admin/timetable/import', { dataBase64: b64('asc/plan-sp12.xml'), dryRun: true, mapping: dry.mapping }));
  assert.deepEqual(echo.proposal.blocking, dry.proposal.blocking, 'odesłane mapowanie nie zmienia zdania o encjach bez dopasowania');
  assert.equal(echo.rooms, dry.rooms, 'liczba sal po odesłaniu mapowania bez zmian: ' + echo.rooms + ' vs ' + dry.rooms);
  assert.equal(echo.roomless, dry.roomless);
  assert.ok(echo.rooms > 0, 'plan po odesłaniu mapowania nadal ma sale');

  /* Nieznany format to błąd wprost, nie ciche zgadywanie. */
  assert.equal((await c.post('/api/admin/timetable/import', { data: 'x', format: 'xls' })).status, 400);
});

test('[3.5.5] import z mapowaniem zapisuje plan ze źródłem, tygodniem i drugim nauczycielem, a lekcje wypadają wg cyklu A/B', async () => {
  const T = await spawn();
  const c = await T.as('admin');

  /* Człowiek przejrzał propozycję i zdecydował: czego szkoła nie ma, tego nie wgrywamy (null),
     a informatyka z pliku ma u nas swojego nauczyciela. */
  const dry0 = expectOk(await c.post('/api/admin/timetable/import', { dataBase64: b64('asc/plan-sp12.xml'), dryRun: true }));
  const mapping = JSON.parse(JSON.stringify(dry0.mapping));
  /* D3-51 — encji bez dopasowania nie ma w `mapping`; decyzję „pomiń” trzeba teraz wpisać wprost,
     i to jest cała różnica między „klient odesłał, co dostał” a „człowiek zdecydował”. */
  for (const kind of ['teachers', 'classes', 'subjects']) for (const k of dry0.unmatched[kind]) mapping[kind][k] = null;

  const dry = expectOk(await c.post('/api/admin/timetable/import', { format: 'asc-xml', dataBase64: b64('asc/plan-sp12.xml'), dryRun: true, mapping }));
  assert.deepEqual(dry.proposal.blocking, [], 'wszystko rozstrzygnięte: dopasowane albo świadomie pominięte');
  assert.equal(dry.ok, true, JSON.stringify(dry.conflicts).slice(0, 300));
  assert.ok(dry.rows > 0 && dry.rows < 272, 'część wierszy odpadła razem z pominiętymi encjami: ' + dry.rows);
  assert.ok(dry.skipped.rows > 0);

  const done = expectOk(await c.post('/api/admin/timetable/import', { format: 'asc-xml', dataBase64: b64('asc/plan-sp12.xml'), dryRun: false, force: true, mapping, reason: 'Plan z aSc na rok 2026/2027.' }));
  assert.equal(done.applied, true);
  assert.equal(done.rows, dry.rows);

  const tt = T.db.col('timetable');
  assert.equal(tt.length, dry.rows);
  assert.ok(tt.every((x) => x.source && x.source.tool === 'asc' && x.source.lessonId), 'każdy wiersz niesie ślad pochodzenia');
  const a = tt.filter((x) => x.week === 'A'), b = tt.filter((x) => x.week === 'B');
  assert.ok(a.length > 0 && a.length === b.length, `pary A/B: ${a.length}/${b.length}`);
  assert.ok(a.every((x) => x.id.endsWith('_wA')), 'tydzień jest częścią identyfikatora pozycji');
  assert.ok(tt.some((x) => (x.teacherIds || []).length === 2), 'lekcja z nauczycielem wspomagającym');
  assert.ok(tt.some((x) => x.groupLabel && !x.groupId), 'etykieta podziału z pliku, gdy nie ma u nas takiej grupy');
  /* OPS3-12/D3-51 — sala nierozpoznana wjeżdża **dosłownie**, a nie jako pusty napis: przed poprawką
     odesłanie mapowania z próby kasowało numer sali we wszystkich 254 wierszach naraz, a komunikat
     mówił o tym tylko liczbą („0 sal”). Sale, których nie ma w planie szkoły, to wolny tekst z pliku. */
  assert.equal(tt.filter((x) => !x.room).length, done.roomless, 'lekcje bez sali to dokładnie te, które nie mają sali w pliku');
  assert.equal(done.rooms, new Set(tt.map((x) => x.room).filter(Boolean)).size);
  assert.ok(done.rooms > 0, 'plan ma sale mimo odesłanego mapowania: ' + done.rooms);
  assert.ok(tt.some((x) => x.room === '12'));
  /* Kontrola z repro/operations/04-rooms-mapping.js: ten sam plik i to samo mapowanie, tylko bez
     klucza `rooms`. Przed poprawką dawało 254 sale kontra 0; teraz musi wyjść co do wiersza to samo. */
  const noRooms = JSON.parse(JSON.stringify(mapping)); delete noRooms.rooms;
  const control = expectOk(await c.post('/api/admin/timetable/import', { format: 'asc-xml', dataBase64: b64('asc/plan-sp12.xml'), dryRun: true, mapping: noRooms }));
  assert.equal(control.rooms, done.rooms, 'pominięcie klucza „rooms” i odesłanie go bez zmian znaczą to samo');
  assert.equal(control.roomless, done.roomless);
  /* Stare wiersze zapisuje się dokładnie jak przedtem — bez pól, których nie potrzebują. */
  const plain = tt.find((x) => !x.week && !x.groupLabel);
  assert.equal(plain.week, undefined);
  assert.equal(plain.groupLabel, undefined);
  assert.ok(T.db.col('audit').some((x) => x.action === 'timetable_imported' && x.after.format === 'asc-xml'));

  /* Generowanie lekcji honoruje cykl: pozycja „tydzień A” wypada tylko w tygodniach A. */
  expectOk(await c.post('/api/setup/lessons/generate', { from: '2026-11-09', to: '2026-12-04' }));
  const anchor = TTL.weekAnchor(T.db);
  const ttA = a[0];
  const dates = T.db.col('lessons').filter((l) => l.id.startsWith('les_' + ttA.id + '_') && l.date >= '2026-11-09' && l.date <= '2026-12-04').map((l) => l.date).sort();
  assert.ok(dates.length >= 2, 'pozycja tygodnia A ma swoje lekcje: ' + JSON.stringify(dates));
  for (const d of dates) assert.equal(TTL.weekOf(T.db, d), 'A', d + ' powinien być tygodniem A (kotwica ' + anchor + ')');
  const other = dates.map((d) => TTL.mondayOf(d));
  assert.ok(new Set(other).size === other.length, 'jedna lekcja na tydzień A');
  const bId = b.find((x) => x.classId === ttA.classId && x.weekday === ttA.weekday && x.lessonNo === ttA.lessonNo);
  if (bId) {
    const bd = T.db.col('lessons').filter((l) => l.id.startsWith('les_' + bId.id + '_') && l.date >= '2026-11-09' && l.date <= '2026-12-04').map((l) => l.date);
    for (const d of bd) assert.equal(TTL.weekOf(T.db, d), 'B', d);
    assert.equal(dates.some((d) => bd.includes(d)), false, 'tygodnie A i B nigdy nie wypadają tego samego dnia');
  }
  /* Kotwica jest konfigurowalna: przesunięcie o tydzień zamienia A z B. */
  assert.equal(TTL.weekOf({ data: { config: { weekCycleAnchor: '2026-09-07', semesters: T.db.data.config.semesters } } }, '2026-09-07'), 'A');
  assert.equal(TTL.weekOf({ data: { config: { weekCycleAnchor: '2026-09-14', semesters: T.db.data.config.semesters } } }, '2026-09-07'), 'B');
});

test('[3.5.5] Optivum: import publikacji przez trasę — propozycja po skrótach, mapowanie oddziałów, zapis', async () => {
  const T = await spawn();
  const c = await T.as('admin');
  const files = tree('optivum');

  const dry = expectOk(await c.post('/api/admin/timetable/import', { files, ref: 'plany/', dryRun: true }));
  assert.equal(dry.format, 'optivum-html', 'katalog plików rozpoznany bez podpowiedzi');
  assert.equal(dry.proposal.tool, 'optivum');
  assert.equal(dry.proposal.teachers.find((x) => x.key === 'NJ').matched, 'u_nowak');
  assert.equal(dry.proposal.subjects.find((x) => x.key === 'j.polski').matched, 'pol', 'dopasowanie miękkie: „j.polski” ↔ „Język polski”');
  assert.equal(dry.proposal.subjects.find((x) => x.key === 'w-f').matched, 'wf');
  assert.ok(dry.unmatched.classes.includes('4A'), 'szkoła demo nie ma czwartych klas');
  assert.ok(dry.warnings.some((w) => /dwutygodniowego/.test(w)), 'publikacja nie niesie cyklu A/B — mówimy o tym wprost');

  /* Oddziały, których szkoła nie ma, mapujemy na jej własne; reszta pomijana. */
  const mapping = JSON.parse(JSON.stringify(dry.mapping));
  mapping.classes['4A'] = '7a'; mapping.classes['4B'] = null; mapping.classes['5A'] = null;
  mapping.classes['5B'] = null; mapping.classes['6A'] = null;
  for (const k of dry.unmatched.teachers) mapping.teachers[k] = 'u_krol';
  for (const k of dry.unmatched.subjects) mapping.subjects[k] = null;

  const dry2 = expectOk(await c.post('/api/admin/timetable/import', { files, dryRun: true, mapping }));
  assert.deepEqual(dry2.proposal.blocking, []);
  assert.ok(dry2.rowsPerClass['7a'] >= 14, JSON.stringify(dry2.rowsPerClass));
  assert.ok(dry2.groupLabels.includes('1/2'), 'sufiks -1/2 stał się etykietą podziału');

  const done = expectOk(await c.post('/api/admin/timetable/import', { files, dryRun: false, force: true, mapping, reason: 'Publikacja Optivum ze strony szkoły.' }));
  assert.equal(done.applied, true);
  const tt = T.db.col('timetable');
  assert.ok(tt.every((x) => x.source && x.source.tool === 'optivum'));
  assert.ok(tt.some((x) => x.classId === '7a' && x.groupLabel === '1/2'));
  assert.ok(tt.every((x) => !x.week), 'publikacja Optivum nie zna cyklu dwutygodniowego');

  /* Pojedyncza strona oddziału (`oN.html`) też wchodzi — jako bajty w base64. */
  const single = expectOk(await c.post('/api/admin/timetable/import', { format: 'optivum-html', dataBase64: b64('optivum/plany/o7.html'), dryRun: true, mapping }));
  assert.equal(single.rows > 0, true);
});

/* ------------------------------------------------------- 7. zgodność wstecz i zasiew demo */
test('[R1.11] zasiew demo bez zmian: plan nie ma tygodni, a liczba wygenerowanych lekcji się nie zmienia', async () => {
  const T = await spawn();
  const c = await T.as('admin');
  const cfg = T.db.data.config;
  const from = cfg.semesters[0].from;
  /* Liczymy wyłącznie lekcje wywiedzione z planu (`les_<pozycja planu>_<data>`): dalsze pliki zasiewu
     dokładają własne lekcje, których generator nigdy nie odtworzy. */
  const ttIds = new Set(T.db.col('timetable').map((t) => t.id));
  const fromPlan = T.db.col('lessons').filter((l) => ttIds.has(l.id.replace(/^les_/, '').replace('_' + l.date, '')));
  const to = fromPlan.reduce((m, l) => (l.date > m ? l.date : m), from);
  const before = fromPlan.filter((l) => l.date >= from && l.date <= to).length;
  const keep = T.db.col('lessons').filter((l) => !ttIds.has(l.id.replace(/^les_/, '').replace('_' + l.date, '')));

  assert.ok(T.db.col('timetable').every((t) => !t.week), 'zasiew nie używa cyklu dwutygodniowego');
  assert.ok(T.db.col('timetable').every((t) => !t.teacherIds && !t.source), 'stary kształt wiersza planu zostaje na dysku');
  /* Migracja przy odczycie: brakujące pola = stare zachowanie. */
  const n = TTL.normalize(T.db.col('timetable')[0]);
  assert.equal(n.week, null);
  assert.deepEqual(n.teacherIds, [T.db.col('timetable')[0].teacherId]);
  assert.equal(n.groupLabel, null);

  const total = T.db.col('lessons').length;
  const again = expectOk(await c.post('/api/setup/lessons/generate', { from, to }));
  assert.equal(again.created, 0, 'generowanie jest idempotentne');
  assert.equal(T.db.col('lessons').length, total);

  /* I od zera: ten sam plan daje dokładnie tyle samo lekcji, co przed dołożeniem cyklu A/B. */
  T.db.data.lessons = keep;
  const fresh = expectOk(await c.post('/api/setup/lessons/generate', { from, to }));
  assert.equal(fresh.created, before, `regeneracja daje ${fresh.created}, a zasiew miał ${before}`);
  assert.equal(T.db.col('lessons').length, total);
});

test('[R1.12] stary CSV i JSON działają jak przedtem, a kolumny „week” i „groupLabel” są opcjonalne', async () => {
  const T = await spawn();
  const c = await T.as('admin');
  const H = 'class;weekday;lessonNo;subject;teacherLogin;room;group';
  const plain = expectOk(await c.post('/api/admin/timetable/import', { data: [H, '7b;1;1;mat;j.nowak;12;', '7b;1;2;ang;e.krol;15;g_7b_ang1'].join('\n'), dryRun: false, force: true }));
  assert.equal(plain.format, 'csv');
  assert.equal(plain.rows, 2);
  assert.equal(plain.proposal, undefined, 'CSV nie potrzebuje fazy dopasowania — ma nasze identyfikatory');
  const old = T.db.col('timetable').find((x) => x.subjectId === 'mat');
  assert.equal(old.id, 'tt_7b_1_1', 'identyfikator pozycji bez tygodnia jest dokładnie taki jak przedtem');
  assert.equal(old.week, undefined);

  const ab = expectOk(await c.post('/api/admin/timetable/import', {
    data: [H + ';week;groupLabel', '7b;2;1;inf;a.wojcik;30;;A;chłopcy', '7b;2;1;inf;a.wojcik;30;;B;dziewczęta'].join('\n'),
    merge: true, dryRun: true }));
  assert.equal(ab.rows, 2);
  assert.deepEqual(ab.conflicts, [], 'przeciwne tygodnie i różne grupy nie kolidują');
  assert.deepEqual(ab.weeks, { every: 0, A: 1, B: 1 });
  assert.deepEqual(ab.groupLabels, ['chłopcy', 'dziewczęta']);

  const bad = expectOk(await c.post('/api/admin/timetable/import', { data: [H + ';week', '7b;2;1;inf;a.wojcik;30;;C'].join('\n'), dryRun: true }));
  assert.ok(bad.errors.some((e) => /week/.test(e)), JSON.stringify(bad.errors));

  /* Pole w cudzysłowach z separatorem w środku — dawny `split(';')` rozbijał taki wiersz. */
  const quoted = expectOk(await c.post('/api/admin/timetable/import', { data: [H, '7b;1;1;mat;j.nowak;"sala 12; parter";'].join('\n'), dryRun: true }));
  assert.equal(quoted.rows, 1);
  assert.deepEqual(quoted.errors, []);
});
