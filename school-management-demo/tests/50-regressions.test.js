'use strict';
/* Second pass over the work of the seven fix packages: the time helpers, the shared upload
   validator and the audit log, each pushed at the edges the first round did not reach.
   Findings and fix status: docs/review/regressions.md. */
const { test } = require('node:test');
const assert = require('node:assert');
const U = require('../server/lib/util');
const D = require('../server/lib/domain');
const UP = require('../server/lib/uploads');
const A = require('../server/lib/audit');
const { Store } = require('../server/lib/store');
const { startServer } = require('./helpers');

const TZ = 'Europe/Warsaw';
/** A school just big enough for the time helpers: config only, no file behind it. */
function school(config) { const db = new Store(null); db.data = { config: Object.assign({ timezone: TZ }, config || {}) }; return db; }

/* ---------------------------------------------------------------- time ----------------- */

test('time: toInstant writes an instant whose offset matches its own wall clock, on both DST nights', () => {
  /* REG-03: in the hour that does not exist (28.03.2027 02:00 → 03:00) the search settled on the
     winter offset but printed the summer wall clock — '2027-03-28T03:30:00+01:00' is 04:30 in
     Warsaw, an hour later than the string says. A homework deadline moved by an hour on its own. */
  const roundTrip = (date, time) => { const i = U.toInstant(date, time, TZ); return { i, date: U.localDate(i, TZ), time: U.localTime(i, TZ) }; };

  const gap = roundTrip('2027-03-28', '02:30');
  assert.equal(gap.i, '2027-03-28T03:30:00+02:00', 'the missing hour moves forward, offset and all');
  assert.equal(gap.date + ' ' + gap.time, '2027-03-28 03:30', 'and reading it back gives what it says');
  assert.equal(U.toInstant('2027-03-28', '02:00', TZ), '2027-03-28T03:00:00+02:00');
  assert.equal(Date.parse(U.toInstant('2027-03-28', '02:00', TZ)), Date.parse(U.toInstant('2027-03-28', '03:00', TZ)), 'a time that does not exist lands on the first that does');

  for (const t of ['00:30', '01:30', '03:00', '03:30', '12:00', '23:30']) {
    const r = roundTrip('2027-03-28', t);
    assert.equal(r.time, t, `28.03.2027 ${t} survives the round trip (${r.i})`);
  }
  /* the repeated hour (25.10.2026 03:00 → 02:00) resolves to the later, winter occurrence */
  const twice = roundTrip('2026-10-25', '02:30');
  assert.equal(twice.i, '2026-10-25T02:30:00+01:00', 'the second 02:30, so a deadline is not cut short');
  assert.equal(twice.time, '02:30');
  for (const t of ['00:30', '01:30', '02:00', '02:30', '03:00', '23:30']) assert.equal(roundTrip('2026-10-25', t).time, t, `25.10.2026 ${t}`);

  /* year boundaries, both sides */
  assert.equal(U.toInstant('2026-12-31', '23:59', TZ), '2026-12-31T23:59:00+01:00');
  assert.equal(U.toInstant('2027-01-01', '00:00', TZ), '2027-01-01T00:00:00+01:00');
  assert.equal(U.localDate(U.toInstant('2027-01-01', '00:00', TZ), TZ), '2027-01-01', 'midnight on 1 January is still 1 January');
  assert.equal(U.toInstant('2026-06-30', '12:00', TZ), '2026-06-30T12:00:00+02:00');
  assert.equal(U.toInstant('2026-13-01', '12:00', TZ), null, 'REG-07: a month that does not exist is null, not January of the next year');
  assert.equal(U.toInstant('2026-02-30', '12:00', TZ), null, 'nor does 30 February roll over into March');
  assert.equal(U.toInstant('2026-02-28', '25:00', TZ), null, 'and neither does an impossible hour');
  assert.equal(U.toInstant('2026-10-25', 'obiad', TZ), null);
});

test('time: localDate and localTime read an instant that is not stamped Z', () => {
  assert.equal(U.localDate('2026-10-28T20:00:00+01:00', TZ), '2026-10-28');
  assert.equal(U.localTime('2026-10-28T20:00:00+01:00', TZ), '20:00');
  assert.equal(U.localDate('2026-06-15T23:30:00-05:00', TZ), '2026-06-16', 'an evening in New York is the next morning in Warsaw');
  assert.equal(U.localTime('2026-06-15T23:30:00-05:00', TZ), '06:30');
  assert.equal(U.localDate('2026-01-01T00:30:00+02:00', TZ), '2025-12-31', 'and can fall back into the old year');
  assert.equal(U.localDate('nie-data', TZ), '', 'garbage is empty, never NaN in a document');
  assert.equal(U.localTime(new Date('2026-06-15T10:00:00Z'), TZ), '12:00', 'a Date works as well as a string');
});

test('time: schoolNow is one clock, pinned day and all', () => {
  const live = school(); const demo = school({ today: '2026-10-25' });
  const at = '2026-06-15T10:00:00Z';
  assert.deepEqual(D.schoolNow(live, at), { date: '2026-06-15', time: '12:00', instant: at }, 'unpinned: the instant is handed back untouched');

  const pinned = D.schoolNow(demo, at);
  assert.equal(pinned.date, '2026-10-25', 'pinned: the demo day wins');
  assert.equal(pinned.time, '12:00', 'the time of day is still the real one');
  assert.equal(U.localDate(pinned.instant, TZ), pinned.date, 'and the instant agrees with both');
  assert.equal(U.localTime(pinned.instant, TZ), pinned.time);

  /* pinned onto the night the clock jumps: the instant still has to parse back to what it says */
  const onGap = D.schoolNow(school({ today: '2027-03-28' }), '2026-06-15T00:30:00Z');
  assert.equal(U.localDate(onGap.instant, TZ), onGap.date);
  assert.equal(U.localTime(onGap.instant, TZ), U.localTime(onGap.instant, TZ));
  assert.equal(Date.parse(onGap.instant) > 0, true);
  assert.equal(D.today(demo), '2026-10-25');
  assert.equal(D.today(live), U.localDate(new Date(), TZ), 'without a pin: the wall date in the school time zone');
  assert.equal(D.tz(school({ timezone: 'Europe/Lisbon' })), 'Europe/Lisbon');
  assert.equal(D.tz(school({ timezone: undefined })), TZ, 'and Europe/Warsaw when the school never said');
});

test('time: the cut-off minute belongs to the cut-off, and a typo does not switch it off', () => {
  const db = school();
  const at = (local) => U.toInstant('2026-06-15', local, TZ);
  assert.equal(D.isBeforeCutoff(db, '12:00', at('11:59')), true);
  assert.equal(D.isBeforeCutoff(db, '12:00', at('11:59:59')), true);
  assert.equal(D.isBeforeCutoff(db, '12:00', at('12:00')), false, 'exactly at the cut-off it is too late');
  assert.equal(D.isBeforeCutoff(db, '12:00', at('12:00:59')), false);
  assert.equal(D.isBeforeCutoff(db, '00:00', at('00:00')), false, 'midnight cut-off is not "always open"');
  /* REG-11: a one-digit hour used to fail the RRRR-pattern and open the cut-off all day */
  assert.equal(D.isBeforeCutoff(db, '9:00', at('08:30')), true);
  assert.equal(D.isBeforeCutoff(db, '9:00', at('09:30')), false, 'a config typo is read, not ignored');
  assert.equal(D.isBeforeCutoff(db, '', at('23:59')), true, 'no cut-off configured = no cut-off');
  assert.equal(D.isBeforeCutoff(db, '24:00', at('23:59')), true, 'and an impossible one is the same');
});

test('time: quiet hours, both the window that crosses midnight and the one that does not', () => {
  const db = school();
  const at = (local) => U.toInstant('2026-06-15', local, TZ);
  const q = (from, to, local) => D.inQuietHours({ quietHours: { from, to } }, db, at(local));

  for (const [local, want] of [['20:59', false], ['21:00', true], ['23:59', true], ['00:00', true], ['05:00', true], ['06:29', true], ['06:30', false], ['12:00', false]])
    assert.equal(q('21:00', '06:30', local), want, `21:00–06:30 o ${local}`);
  for (const [local, want] of [['07:59', false], ['08:00', true], ['15:59', true], ['16:00', false], ['23:00', false], ['03:00', false]])
    assert.equal(q('08:00', '16:00', local), want, `08:00–16:00 o ${local}`);
  assert.equal(q('00:00', '06:00', '00:00'), true, 'a window that starts at midnight');
  assert.equal(q('00:00', '06:00', '06:00'), false);
  assert.equal(q('23:00', '00:00', '23:30'), true, 'and one that ends at it');
  assert.equal(q('23:00', '00:00', '00:00'), false);
  assert.equal(q('22:00', '22:00', '22:00'), false, 'from === to is off, never "always"');
  assert.equal(D.inQuietHours({}, db, at('23:00')), false, 'a user who never set quiet hours has none');
  assert.equal(D.inQuietHours({ quietHours: { from: '21:00' } }, db, at('23:00')), false, 'half a window is no window');
});

test('time: semesterOf answers on every day of the year, including the gap between semesters', () => {
  const db = school({ semesters: [{ id: 1, from: '2026-09-01', to: '2027-01-29' }, { id: 2, from: '2027-02-15', to: '2027-06-25' }] });
  const both = (d) => [D.semesterOf(db, d), D.semesterOf(db, d, 'entry')];
  assert.deepEqual(both('2026-09-01'), [1, 1], 'first day of semester 1');
  assert.deepEqual(both('2027-01-29'), [1, 1], 'last day of semester 1');
  assert.deepEqual(both('2027-01-30'), [1, 2], 'first day of the gap: read the closed one, write into the new one');
  assert.deepEqual(both('2027-02-14'), [1, 2], 'last day of the gap');
  assert.deepEqual(both('2027-02-15'), [2, 2], 'first day of semester 2');
  assert.deepEqual(both('2027-06-25'), [2, 2], 'last day of semester 2');
  assert.deepEqual(both('2026-08-31'), [1, 1], 'before the year starts');
  assert.deepEqual(both('2027-06-26'), [2, 2], 'after it ends');
  assert.deepEqual(both('2027-09-01'), [2, 2], 'and far after');
  /* configuration entered out of order is sorted before it is read */
  const reversed = school({ semesters: [{ id: 2, from: '2027-02-15', to: '2027-06-25' }, { id: 1, from: '2026-09-01', to: '2027-01-29' }] });
  assert.deepEqual([D.semesterOf(reversed, '2027-02-01'), D.semesterOf(reversed, '2027-02-01', 'entry')], [1, 2]);
  assert.equal(D.semesterOf(school({ semesters: [{ id: 1, from: '2026-09-01', to: '2027-06-25' }] }), '2027-07-01', 'entry'), 1, 'one semester is safe');
  assert.equal(D.semesterOf(school(), '2027-07-01'), 1, 'no semesters at all is safe too');
});

test('time: the calendar helpers work far from 2026 and do not throw on an instant', () => {
  for (const [iso, wd] of [['1899-12-31', 7], ['1970-01-01', 4], ['2000-02-29', 2], ['2026-09-23', 3], ['2100-03-01', 1], ['2200-01-01', 3]])
    assert.equal(U.weekday(iso), wd, iso);
  assert.equal(U.addDays('2026-12-31', 1), '2027-01-01');
  assert.equal(U.addDays('2027-01-01', -1), '2026-12-31');
  assert.equal(U.addDays('2028-02-28', 1), '2028-02-29', 'a leap year');
  assert.equal(U.addDays('2100-02-28', 1), '2100-03-01', 'and a century that is not one');
  assert.equal(U.daysBetween('2026-10-24', '2027-03-29'), 156, 'the date arithmetic ignores the clock change');
  assert.equal(U.daysBetween('2027-03-27', '2027-03-29'), 2);
  /* REG-06: a caller that handed over a full instant used to get RangeError: Invalid time value */
  assert.equal(U.weekday('2026-09-23T10:00:00Z'), 3);
  assert.equal(U.addDays('2026-09-23T22:30:00+02:00', 1), '2026-09-24');
  assert.equal(U.daysBetween('2026-09-23T10:00:00Z', '2026-09-25'), 2);
  for (const bad of ['', 'nie-data', '2026-13-45', null]) {
    assert.throws(() => U.addDays(bad, 1), (e) => e.code === 'EDMAT_BAD_DATE' && /Nieprawid/.test(e.message), `addDays(${JSON.stringify(bad)}) says what is wrong`);
    assert.throws(() => U.weekday(bad), (e) => e.code === 'EDMAT_BAD_DATE');
  }
});

/* -------------------------------------------------------------- uploads ---------------- */

const b64 = (s) => Buffer.from(s).toString('base64');
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3, 4]).toString('base64');
const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3, 4]).toString('base64');
const refuse = (fn) => { try { fn(); return null; } catch (e) { return Object.assign({ status: e.status }, e.extra); } };

test('uploads: the size comes from the bytes, whatever the padding and whatever the client claims', () => {
  for (const [text, bytes] of [['A', 1], ['AB', 2], ['ABC', 3], ['ABCD', 4], ['ABCDE', 5]]) {
    const padded = b64(text);
    assert.equal(UP.validateUpload({ name: 'a.txt', dataUrl: 'data:text/plain;base64,' + padded }).size, bytes, `${bytes} B, padded`);
    assert.equal(UP.validateUpload({ name: 'a.txt', dataUrl: 'data:text/plain;base64,' + padded.replace(/=+$/, '') }).size, bytes, `${bytes} B, unpadded`);
  }
  const wrapped = b64('ABCDEFGHI').replace(/(.{4})/g, '$1\n');
  assert.equal(UP.validateUpload({ name: 'a.txt', dataUrl: 'data:text/plain;base64,' + wrapped }).size, 9, 'a base64 broken into lines');
  const lying = UP.validateUpload({ name: 'a.txt', size: 99999999, dataUrl: 'data:text/plain;base64,' + b64('ABC') });
  assert.equal(lying.size, 3, 'the size the client sent is never believed');
  assert.equal(lying.dataUrl, 'data:text/plain;base64,' + b64('ABC'), 'and the stored data URL is normalised');
});

test('uploads: the limit is inclusive and an empty file is refused', () => {
  const oneByte = 1 / (1024 * 1024);
  assert.equal(UP.validateUpload({ name: 'a.txt', dataUrl: 'data:text/plain;base64,' + b64('A') }, { maxMB: oneByte }).size, 1, 'exactly at the limit passes');
  assert.equal(refuse(() => UP.validateUpload({ name: 'a.txt', dataUrl: 'data:text/plain;base64,' + b64('AB') }, { maxMB: oneByte })).code, 'attachment_too_large', 'one byte over does not');
  const ten = 'x'.repeat(10 * 1024 * 1024);
  assert.equal(UP.validateUpload({ name: 'a.txt', dataUrl: 'data:text/plain;base64,' + b64(ten) }).size, 10 * 1024 * 1024, '10 MB at a 10 MB limit');
  assert.equal(refuse(() => UP.validateUpload({ name: 'a.txt', dataUrl: 'data:text/plain;base64,' + b64(ten + 'x') })).code, 'attachment_too_large');
  /* a zero-byte attachment of an allowed type is still refused — a pupil who uploads nothing has
     not handed anything in, and the 400 says so instead of storing an empty row */
  assert.equal(refuse(() => UP.validateUpload({ name: 'pusty.txt', type: 'text/plain', dataUrl: 'data:text/plain;base64,' })).code, 'empty_file');
  const total = refuse(() => UP.validateUploads([{ name: 'a.txt', dataUrl: 'data:text/plain;base64,' + b64('x'.repeat(600)) }, { name: 'b.txt', dataUrl: 'data:text/plain;base64,' + b64('x'.repeat(600)) }], { maxTotalMB: 1000 / (1024 * 1024) }));
  assert.equal(total.code, 'attachments_too_large', 'and the whole consignment has its own limit');
});

test('uploads: the header, the declaration and the bytes all have to agree', () => {
  const upper = UP.validateUpload({ name: 'Zdjecie.PNG', type: 'IMAGE/PNG', dataUrl: 'data:IMAGE/PNG;base64,' + PNG });
  assert.equal(upper.type, 'image/png', 'an upper-case MIME is the same MIME');
  assert.equal(UP.validateUpload({ name: 'a.txt', type: 'text/plain;charset=utf-8', dataUrl: 'data:text/plain;charset=utf-8;base64,' + b64('ABC') }).type, 'text/plain', 'parameters on the data URL are accepted');
  assert.equal(refuse(() => UP.validateUpload({ name: 'a.png', type: 'image/png', dataUrl: 'data:image/png;base64,' + JPEG })).code, 'content_mismatch', 'a JPEG renamed to PNG');
  assert.equal(refuse(() => UP.validateUpload({ name: 'a.png', type: 'image/png', dataUrl: 'data:image/jpeg;base64,' + JPEG })).code, 'type_mismatch', 'a declaration that does not match the header');
  assert.equal(refuse(() => UP.validateUpload({ name: 'a.png', dataUrl: 'data:image/png;base64,' + b64('nie obrazek') })).code, 'content_mismatch');
  assert.equal(refuse(() => UP.validateUpload({ name: 'x.svg', dataUrl: 'data:image/svg+xml;base64,' + b64('<svg/>') }, { allow: ['image/*'] })).code, 'file_type_not_allowed', 'image/* never reaches an executable type');
  assert.equal(UP.validateUpload({ name: 'x.svg', dataUrl: 'data:image/svg+xml;base64,' + b64('<svg/>') }, { allow: ['image/svg+xml'] }).type, 'image/svg+xml', 'unless the school allows it by name');
  assert.equal(refuse(() => UP.validateUpload({ name: 'a.txt', dataUrl: 'nie data url' })).code, 'bad_data_url');
  assert.equal(refuse(() => UP.validateUpload({ name: 'a.txt', dataUrl: 'data:text/plain,ABC' })).code, 'bad_data_url', 'only base64 payloads');
});

test('uploads: Polish letters survive the file name, paths and control characters do not', () => {
  assert.equal(UP.cleanName('Sprawdzian — ułamki (żółw).pdf'), 'Sprawdzian — ułamki (żółw).pdf');
  assert.equal(UP.cleanName('ąćęłńóśźż ĄĆĘŁŃÓŚŹŻ.PDF'), 'ąćęłńóśźż ĄĆĘŁŃÓŚŹŻ.PDF');
  assert.equal(UP.cleanName('../../etc/passwd'), 'passwd');
  assert.equal(UP.cleanName('..\\..\\windows\\win.ini'), 'win.ini');
  assert.equal(UP.cleanName('.ukryty'), 'ukryty');
  assert.equal(UP.cleanName('a' + String.fromCharCode(0) + 'b' + String.fromCharCode(31) + 'c.txt'), 'abc.txt', 'NUL i znaki sterujace wypadaja z nazwy');
  assert.equal(UP.cleanName('plik<>:"|?*.txt'), 'plik_______.txt');
  assert.equal(UP.cleanName(''), 'zalacznik');
  assert.equal(UP.cleanName('   ', 'praca.pdf'), 'praca.pdf');
  const long = UP.cleanName('ż'.repeat(200) + '.pdf');
  assert.equal(long.length, 120, 'a very long name is cut');
  assert.equal(long.endsWith('.pdf'), true, 'but keeps its extension');
  assert.equal(UP.validateUpload({ name: 'załącznik żony.txt', dataUrl: 'data:text/plain;base64,' + b64('ABC') }).name, 'załącznik żony.txt');
});

/* ---------------------------------------------------------------- audit ---------------- */

test('audit: a live document with a back-reference is written, not thrown back at the route', async () => {
  const S = await startServer();
  try {
    const db = S.db;
    /* REG-09: structuredClone refuses a Proxy (every document the store hands out is one) and the
       JSON fallback refuses a cycle, so `audit({ after: liveDoc })` on a graph with a back-reference
       turned the request into a 500 — and the audit log is the one thing that must not fail. */
    const pupil = db.get('students', 'st_kowalczyk_anna');
    const graph = { studentId: pupil.id, student: pupil, note: 'wgląd' };
    graph.self = graph; graph.also = { parent: graph };
    const row = A.audit(db, { action: 'probe_cycle', entity: 'students', entityId: pupil.id, after: graph });
    assert.equal(row.after.studentId, pupil.id);
    assert.equal(row.after.student.firstName, 'Anna', 'the live document is copied, not referenced');
    assert.equal(row.after.self, '[cykl]', 'the cycle is written down as a cycle');
    assert.equal(row.after.also.parent, '[cykl]');
    assert.equal(Object.isFrozen(row.after.student), true, 'and the copy is deep-frozen (S-15)');
    assert.equal(JSON.parse(JSON.stringify(row)).after.student.firstName, 'Anna', 'the row is still storable');

    /* the copy must be cut off from the live row: an edit afterwards cannot rewrite the evidence */
    const was = pupil.firstName;
    pupil.firstName = 'Podmienione';
    assert.equal(row.after.student.firstName, 'Anna', 'the audit row did not move with it');
    pupil.firstName = was;
    assert.throws(() => { row.after.student.firstName = 'X'; }, TypeError, 'and cannot be written to');

    /* the shapes a route reaches for by accident */
    assert.equal(A.audit(db, { action: 'probe_date', after: { d: new Date('2026-01-01T00:00:00Z') } }).after.d, '2026-01-01T00:00:00.000Z');
    assert.deepEqual(A.audit(db, { action: 'probe_map', after: { m: new Map([['a', 1]]) } }).after.m, { a: 1 });
    assert.deepEqual(A.audit(db, { action: 'probe_set', after: { s: new Set([1, 2]) } }).after.s, [1, 2]);
    assert.deepEqual(A.audit(db, { action: 'probe_undef', after: { k: 1, u: undefined, f: () => 1 } }).after, { k: 1 });
    assert.equal(A.audit(db, { action: 'probe_big', after: { n: 10n } }).after.n, '10');
    assert.equal(A.audit(db, { action: 'probe_err', after: { e: new Error('boom') } }).after.e.message, 'boom');
    const arr = [1]; arr.push(arr);
    assert.deepEqual(A.audit(db, { action: 'probe_arr', after: arr }).after, [1, '[cykl]']);
  } finally { await S.close(); }
});

test('audit: edit_or_delete answers the same as the principal screen, and a range bound is not glued together', async () => {
  const S = await startServer();
  try {
    const db = S.db;
    const me = 'u_probe';
    /* the vocabulary routes really use for an edit or a deletion */
    const edits = ['grade_update', 'grade_value_edit', 'grade_revert', 'grade_superseded', 'remark_delete',
      'attendance_entry_delete', 'classification_grade_invalidated', 'student_removed', 'right_to_be_forgotten',
      'import_undone', 'group_updated', 'trip_updated'];
    const others = ['login', 'logout', 'grade_create', 'message_sent', 'report_card_printed', 'note_read', 'sio_export'];
    for (const action of edits.concat(others)) A.audit(db, { action, entity: 'probe', userId: me });

    const got = A.query(db, { userId: me, action: 'edit_or_delete' }).map((x) => x.action);
    for (const a of edits) assert.equal(got.includes(a), true, `edit_or_delete must catch ${a}`);
    for (const a of others) assert.equal(got.includes(a), false, `edit_or_delete must not catch ${a}`);
    /* the screen classifies with its own vocabulary; library and screen have to agree */
    const kindOf = (a) => (/delete|remove|invalid|revert/.test(a) ? 'delete' : /update|edit|assign|change|patch/.test(a) ? 'edit' : 'other');
    for (const a of edits.concat(others)) {
      const screen = ['edit', 'delete'].includes(kindOf(a)) || /forgotten|superseded|undone/.test(a);
      assert.equal(got.includes(a), screen, `${a}: library and screen disagree`);
    }
    assert.deepEqual(A.query(db, { userId: me, action: 'login' }).map((x) => x.action), ['login'], 'an exact action is still exact');
    assert.equal(A.query(db, { userId: me, entity: 'probe' }).length, edits.length + others.length);
    const desc = A.query(db, { userId: me });
    assert.deepEqual(desc.map((x) => x.at).slice().sort().reverse(), desc.map((x) => x.at), 'newest first');

    /* REG-10: `to` given as a full instant used to become 'RRRR-MM-DDTHH:MM:SSZT23:59:59.999Z' */
    const day = new Date().toISOString().slice(0, 10);
    assert.ok(A.query(db, { userId: me, from: day, to: day }).length >= edits.length, 'a one-day window still holds today');
    const instant = new Date(Date.now() + 60000).toISOString();
    assert.ok(A.query(db, { userId: me, to: instant }).length >= edits.length, 'an instant as the upper bound works');
    assert.equal(A.query(db, { userId: me, to: '2000-01-01T00:00:00.000Z' }).length, 0, 'and still excludes');
    assert.equal(A.query(db, { userId: me, from: '2000-01-01', to: '2000-12-31' }).length, 0);
    assert.equal(A.query(db, {}).length, db.col('audit').length, 'no filter, no filtering');
  } finally { await S.close(); }
});
