'use strict';
/* Moduł „meetings” — spotkania wideo na serwerze szkoły (Jitsi Meet / BigBlueButton / tylko link).
   Testy nie wykonują żadnego połączenia sieciowego: sprawdzamy budowanie tokenów, sum kontrolnych,
   uprawnień, obecności, zgód na nagrywanie i konfiguracji administratora. */
const { test } = require('node:test');
const assert = require('node:assert');
const crypto = require('node:crypto');
const { startServer, expectOk, fixtures } = require('./helpers');
const V = require('../server/lib/video');

let S;
test.before(async () => { S = await startServer(); });
test.after(() => S.close());

const FIZ = 'me_fiz_7b_1026';          // lekcja zdalna fizyki 7b, host a.wojcik
const KONS = 'me_kons_kowalczyk';      // konsultacja: j.nowak ↔ rodzic.kowalczyk
const RADA = 'me_rada_1020';           // zakończona rada pedagogiczna z obecnością
const ANNA_ID = 'st_kowalczyk_anna';   // uczennica 7b, zapisana na kurs co_ulamki

const b64urlJson = (s) => JSON.parse(Buffer.from(String(s).replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8'));

/* Konfiguracja Jitsi szkoły ustawiana raz (tests/helpers.js): w pełnym przebiegu robi to [meetings.1],
   a przy `--test-name-pattern` — pierwszy test, który jej potrzebuje. */
const need = fixtures();
const jitsiConfigured = () => need('jitsi', async () => {
  const admin = await S.as('admin');
  expectOk(await admin.patch('/api/admin/video', {
    provider: 'jitsi',
    jitsi: { domain: 'meet.sp12.krakow.pl', appId: 'edmat_sp12', appSecret: 'tajny-sekret-jitsi-2026' }
  }));
  return admin;
});

test('[meetings.1] token JWT dla Jitsi ma poprawne claims i podpis HS256 weryfikowalny node:crypto', async () => {
  await jitsiConfigured();

  const c = await S.as('a.wojcik');
  const j = expectOk(await c.get(`/api/meetings/${FIZ}/join`));
  assert.equal(j.provider, 'jitsi');
  assert.equal(j.domain, 'meet.sp12.krakow.pl');
  assert.equal(j.moderator, true, 'prowadzący dostaje uprawnienia moderatora');
  assert.ok(j.url.startsWith('https://meet.sp12.krakow.pl/'), 'adres pokoju na domenie szkoły: ' + j.url);
  assert.ok(j.jwt, 'token JWT jest zbudowany, gdy ustawiono appId i sekret');

  const [h64, p64, sig] = j.jwt.split('.');
  const header = b64urlJson(h64); const payload = b64urlJson(p64);
  assert.equal(header.alg, 'HS256'); assert.equal(header.typ, 'JWT');
  assert.equal(payload.iss, 'edmat_sp12');
  assert.equal(payload.aud, 'jitsi');
  assert.equal(payload.sub, 'meet.sp12.krakow.pl');
  assert.equal(payload.room, j.roomName);
  assert.ok(payload.exp > Math.floor(Date.now() / 1000), 'exp w przyszłości');
  assert.equal(payload.context.user.id, 'u_wojcik');
  assert.equal(payload.context.user.moderator, 'true');
  assert.match(payload.context.user.name, /Wójcik/);

  // podpis liczony niezależnie, prosto z node:crypto
  const expected = crypto.createHmac('sha256', 'tajny-sekret-jitsi-2026').update(h64 + '.' + p64).digest('base64')
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  assert.equal(sig, expected, 'podpis HS256 zgadza się z policzonym ręcznie');
  assert.equal(V.verifyJwt(j.jwt, 'tajny-sekret-jitsi-2026'), true);
  assert.equal(V.verifyJwt(j.jwt, 'inny-sekret'), false);
});

test('[meetings.2] suma kontrolna BigBlueButton to sha1(callName + query + secret) — policzona ręcznie', () => {
  const cfg = { provider: 'bbb', jitsi: {}, bbb: { url: 'https://bbb.sp12.krakow.pl/bigbluebutton', secret: 'bbb-shared-secret-2026' } };
  const query = 'name=Fizyka&meetingID=edmat-me_test&moderatorPW=mp&attendeePW=ap';
  const hand = crypto.createHash('sha1').update('create' + query + 'bbb-shared-secret-2026').digest('hex');
  assert.equal(V.bbbChecksum('create', query, 'bbb-shared-secret-2026'), hand);

  const url = V.bbbUrl(cfg, 'create', { name: 'Fizyka', meetingID: 'edmat-me_test', moderatorPW: 'mp', attendeePW: 'ap' });
  const m = /^https:\/\/bbb\.sp12\.krakow\.pl\/bigbluebutton\/api\/create\?(.*)&checksum=([0-9a-f]{40})$/.exec(url);
  assert.ok(m, 'adres create ma postać z dokumentacji BBB: ' + url);
  assert.equal(m[2], crypto.createHash('sha1').update('create' + m[1] + 'bbb-shared-secret-2026').digest('hex'));

  // join / end / getMeetingInfo — hasła moderatora i uczestnika są różne
  const meeting = { id: 'me_test', title: 'Fizyka', kind: 'lesson', waitingRoom: true, recording: { enabled: false } };
  const pw = V.bbbPasswords(meeting);
  assert.notEqual(pw.moderatorPW, pw.attendeePW);
  const join = V.bbbJoinUrl(cfg, meeting, { id: 'u_wojcik', name: 'Adam Wójcik' }, { moderator: true });
  assert.match(join, /\/api\/join\?/); assert.match(join, /role=MODERATOR/);
  assert.match(join, new RegExp('password=' + pw.moderatorPW));
  assert.match(V.bbbJoinUrl(cfg, meeting, { id: 'u_st', name: 'Anna' }, {}), new RegExp('password=' + pw.attendeePW));
  assert.match(V.bbbEndUrl(cfg, meeting), /\/api\/end\?/);
  assert.match(V.bbbInfoUrl(cfg, meeting), /\/api\/getMeetingInfo\?/);
});

test('[meetings.3] uprawnienia: uczeń innej klasy 403, uczeń klasy 200, zaproszony rodzic 200, obcy rodzic 403', async () => {
  const obcy = await S.as('julia.baran');                     // 7a — lekcja jest dla 7b
  const r1 = await obcy.get(`/api/meetings/${FIZ}/join`);
  assert.equal(r1.status, 403); assert.equal(r1.body.code, 'forbidden');

  const swoj = await S.as('anna.kowalczyk');                  // 7b
  const r2 = expectOk(await swoj.get(`/api/meetings/${FIZ}/join`));
  assert.equal(r2.moderator, false, 'uczeń nie jest moderatorem');

  const rodzic = await S.as('rodzic.kowalczyk');              // zaproszony na konsultację
  const r3 = expectOk(await rodzic.get(`/api/meetings/${KONS}/join`));
  assert.equal(r3.moderator, false);

  const innyRodzic = await S.as('rodzic.nowak');
  const r4 = await innyRodzic.get(`/api/meetings/${KONS}/join`);
  assert.equal(r4.status, 403);

  const host = await S.as('j.nowak');                          // prowadząca konsultację
  assert.equal(expectOk(await host.get(`/api/meetings/${KONS}/join`)).moderator, true);

  // uczeń nie widzi spotkania rady pedagogicznej
  const r5 = await swoj.get(`/api/meetings/${RADA}/join`);
  assert.equal(r5.status, 403); assert.equal(r5.body.code, 'forbidden');
});

test('[meetings.4] lista „moje spotkania” pokazuje tylko to, do czego dana rola może wejść', async () => {
  const uczen = await S.as('anna.kowalczyk');
  const mine = expectOk(await uczen.get('/api/meetings'));
  const ids = mine.upcoming.concat(mine.past).map((m) => m.id);
  assert.ok(ids.includes(FIZ), 'uczennica 7b widzi lekcję zdalną');
  assert.ok(!ids.includes(RADA), 'uczennica nie widzi rady pedagogicznej');
  assert.equal(mine.canSchedule, false);

  const dyr = await S.as('dyrektor');
  const d = expectOk(await dyr.get('/api/meetings'));
  assert.ok(d.past.some((m) => m.id === RADA), 'zakończona rada trafia do „zakończonych”');
  assert.equal(d.canSchedule, true);

  // opiekun widzi lekcję zdalną dziecka (żeby zdecydować o zgodzie na nagranie), ale do pokoju nie wchodzi
  const rodzic = await S.as('rodzic.kowalczyk');
  const p = expectOk(await rodzic.get('/api/meetings'));
  const fiz = p.upcoming.find((m) => m.id === FIZ);
  assert.ok(fiz, 'opiekun widzi lekcję zdalną swojego dziecka');
  assert.equal(fiz.canJoin, false);
  assert.equal(fiz.guardianView, true);
  assert.equal(fiz.recording.requested, true);
  assert.equal((await rodzic.get(`/api/meetings/${FIZ}/join`)).status, 403);

  const att = expectOk(await dyr.get(`/api/meetings/${RADA}/attendance`));
  assert.equal(att.rows.length, 6);
  assert.equal(att.present, 6);
  assert.ok(att.totalMinutes > 300, 'łączny czas obecności z seeda: ' + att.totalMinutes);
});

test('[meetings.5] zaplanowanie lekcji zdalnej i powiązanie ze wpisem lekcji (lesson.meetingId)', async () => {
  const c = await S.as('a.wojcik');
  const r = expectOk(await c.post('/api/meetings', {
    kind: 'lesson', title: 'Fizyka 7b — powtórzenie przed sprawdzianem',
    date: '2026-10-27', lessonNo: 2, joinPolicy: 'class', classIds: ['7b'], note: 'Lekcja zdalna.'
  }));
  const id = r.meeting.id;
  assert.match(id, /^me_/, 'identyfikatory spotkań mają prefiks me_');
  assert.equal(r.meeting.status, 'scheduled');
  assert.equal(r.meeting.startTime, '08:55', 'godzina wzięta z lessonTimes dla lekcji nr 2');
  assert.equal(r.meeting.recording.enabled, false, 'nagrywanie domyślnie wyłączone');
  assert.equal(r.meeting.recording.storedAt, 'school-server');

  const les = S.db.col('lessons').find((l) => l.date === '2026-10-27' && l.classId === '7b' && l.lessonNo === 2);
  const link = expectOk(await c.post(`/api/meetings/${id}/link-lesson`, { lessonId: les.id }));
  assert.equal(link.lesson.meetingId, id);
  assert.equal(S.db.get('lessons', les.id).meetingId, id);
  assert.equal(S.db.get('lessons', les.id).remote, true);

  // lekcja innej klasy zostaje odrzucona
  const other = S.db.col('lessons').find((l) => l.classId === '7a' && l.date === '2026-10-27');
  const bad = await c.post(`/api/meetings/${id}/link-lesson`, { lessonId: other.id });
  assert.equal(bad.status, 400); assert.equal(bad.body.code, 'class_mismatch');
});

test('[meetings.6] odwołanie spotkania powiadamia uczestników i zdejmuje powiązanie z lekcją', async () => {
  const c = await S.as('a.wojcik');
  const r = expectOk(await c.post('/api/meetings', {
    kind: 'lesson', title: 'Fizyka 7b — konsultacja przed poprawą', date: '2026-10-29', lessonNo: 1,
    joinPolicy: 'class', classIds: ['7b']
  }));
  const id = r.meeting.id;

  const noReason = await c.post(`/api/meetings/${id}/cancel`, { reason: '' });
  assert.equal(noReason.status, 400); assert.equal(noReason.body.code, 'no_reason');

  const before = S.db.col('notifications').length;
  const out = expectOk(await c.post(`/api/meetings/${id}/cancel`, { reason: 'Awaria łącza w szkole' }));
  assert.equal(out.meeting.status, 'cancelled');
  assert.ok(out.notified >= 12, 'powiadomiono wszystkich uczniów 7b: ' + out.notified);
  const fresh = S.db.col('notifications').slice(before);
  assert.equal(fresh.length, out.notified);
  assert.ok(fresh.every((n) => /Awaria łącza/.test(n.text)), 'powód odwołania jest w treści powiadomienia');
  const anna = S.db.col('users').find((u) => u.login === 'anna.kowalczyk');
  assert.ok(fresh.some((n) => n.userId === anna.id));

  // uczeń nie wejdzie do odwołanego pokoju
  const uczen = await S.as('anna.kowalczyk');
  const j = await uczen.get(`/api/meetings/${id}/join`);
  assert.equal(j.status, 403); assert.equal(j.body.code, 'meeting_cancelled');
});

test('[meetings.7] obecność ze zdarzeń dostawcy: zły sekret 401, dobry zapisuje wejścia i wyjścia', async () => {
  const secret = S.db.data.config.video.eventSecret;
  const c = await S.as('a.wojcik');
  const id = expectOk(await c.post('/api/meetings', {
    kind: 'staff', title: 'Zespół przedmiotowy — fizyka', date: '2026-10-30', start: '15:00', end: '16:00', joinPolicy: 'staff'
  })).meeting.id;

  const anon = S.client();
  const bad = await anon.post(`/api/meetings/${id}/events`, { type: 'participant-joined', userId: 'u_nowak' }, { 'X-EdMat-Video-Secret': 'nie-ten-sekret' });
  assert.equal(bad.status, 401); assert.equal(bad.body.code, 'bad_event_secret');
  assert.equal(S.db.col('meetingAttendance').filter((a) => a.meetingId === id).length, 0);

  const none = await anon.post(`/api/meetings/${id}/events`, { type: 'participant-joined', userId: 'u_nowak' });
  assert.equal(none.status, 401);

  const ok = expectOk(await anon.post(`/api/meetings/${id}/events`, {
    events: [
      { type: 'participant-joined', userId: 'u_nowak', at: '2026-10-30T15:01:00.000Z', via: 'web' },
      { type: 'participant-joined', userId: 'u_krol', at: '2026-10-30T15:02:00.000Z', via: 'mobile' },
      { type: 'participant-left', userId: 'u_nowak', at: '2026-10-30T15:46:00.000Z' }
    ]
  }, { 'X-EdMat-Video-Secret': secret }));
  assert.equal(ok.applied.length, 3);
  const rows = S.db.col('meetingAttendance').filter((a) => a.meetingId === id);
  assert.equal(rows.length, 2);
  const nowak = rows.find((a) => a.userId === 'u_nowak');
  assert.equal(nowak.leftAt, '2026-10-30T15:46:00.000Z');
  assert.equal(nowak.minutes, 45);
  assert.equal(rows.find((a) => a.userId === 'u_krol').via, 'mobile');

  // zdarzenie meeting-ended zamyka spotkanie i domyka otwarte wpisy
  expectOk(await anon.post(`/api/meetings/${id}/events`, { type: 'meeting-ended', at: '2026-10-30T16:00:00.000Z' }, { 'X-EdMat-Video-Secret': secret }));
  assert.equal(S.db.get('videoMeetings', id).status, 'ended');
  assert.equal(S.db.col('meetingAttendance').find((a) => a.meetingId === id && a.userId === 'u_krol').leftAt, '2026-10-30T16:00:00.000Z');

  // wejście z dziennika też zapisuje obecność
  const dyr = await S.as('dyrektor');
  const live = expectOk(await dyr.post('/api/meetings', { kind: 'staff', title: 'Rada — próbna', date: '2026-10-30', start: '17:00', end: '18:00', joinPolicy: 'staff' })).meeting.id;
  const nauczyciel = await S.as('e.krol');
  expectOk(await nauczyciel.get(`/api/meetings/${live}/join`));
  assert.ok(S.db.col('meetingAttendance').some((a) => a.meetingId === live && a.userId === 'u_krol'));
});

test('[meetings.8] nagrywanie pozostaje wyłączone bez zgody opiekunów; po zgodach da się włączyć', async () => {
  const c = await S.as('j.nowak');
  const id = expectOk(await c.post('/api/meetings', {
    kind: 'lesson', title: 'Matematyka 7b — lekcja zdalna', date: '2026-10-27', lessonNo: 3,
    joinPolicy: 'class', classIds: ['7b'], recording: true
  })).meeting.id;
  assert.equal(S.db.get('videoMeetings', id).recording.enabled, false, 'prośba o nagrywanie przy planowaniu nie omija zgód');

  const blocked = await c.post(`/api/meetings/${id}/recording`, { enabled: true });
  assert.equal(blocked.status, 409);
  assert.equal(blocked.body.code, 'recording_consent_missing');
  assert.ok(blocked.body.missing.length >= 12, 'brakuje zgód dla całej klasy 7b');
  assert.equal(S.db.get('videoMeetings', id).recording.enabled, false);

  // rodzic wyraża zgodę tylko za swoje dziecko
  const rodzic = await S.as('rodzic.kowalczyk');
  const zgoda = expectOk(await rodzic.post(`/api/meetings/${id}/recording-consent`, { studentId: 'st_kowalczyk_anna', granted: true }));
  assert.equal(zgoda.granted, true);
  assert.equal(S.db.get('videoMeetings', id).recording.consents.st_kowalczyk_anna.byUserId, 'u_p_kowalczyk');
  const cudze = await rodzic.post(`/api/meetings/${id}/recording-consent`, { studentId: 'st_nowak_jan', granted: true });
  assert.equal(cudze.status, 403);

  // komplet zgód: spotkanie tylko z jednym uczniem
  const solo = expectOk(await c.post('/api/meetings', {
    kind: 'consultation', title: 'Konsultacja: Anna Kowalczyk', date: '2026-10-29', start: '17:00', end: '17:20',
    joinPolicy: 'invited', participantIds: ['u_p_kowalczyk'], studentId: 'st_kowalczyk_anna'
  })).meeting.id;
  const stillBlocked = await c.post(`/api/meetings/${solo}/recording`, { enabled: true });
  assert.equal(stillBlocked.status, 409);
  expectOk(await rodzic.post(`/api/meetings/${solo}/recording-consent`, { studentId: 'st_kowalczyk_anna', granted: true }));
  const okRec = expectOk(await c.post(`/api/meetings/${solo}/recording`, { enabled: true }));
  assert.equal(okRec.recording.enabled, true);
  assert.equal(okRec.recording.storedAt, 'school-server', 'nagranie zostaje na serwerze szkoły');

  // wycofanie zgody natychmiast wyłącza nagrywanie
  expectOk(await rodzic.post(`/api/meetings/${solo}/recording-consent`, { studentId: 'st_kowalczyk_anna', granted: false }));
  assert.equal(S.db.get('videoMeetings', solo).recording.enabled, false);
});

test('[meetings.9] konsultacja wideo: rodzic rezerwuje termin, powstaje spotkanie, drugi rodzic dostaje 409', async () => {
  const rodzic = await S.as('rodzic.kowalczyk');
  const listed = expectOk(await rodzic.get('/api/meetings/consultations'));
  const free = listed.slots.find((s) => !s.booked);
  assert.ok(free, 'jest wolny termin konsultacji wideo');

  const booked = expectOk(await rodzic.post(`/api/meetings/consultations/${free.id}/book`, { studentId: 'st_kowalczyk_anna' }));
  assert.equal(booked.slot.mine, true);
  assert.ok(booked.meeting.id.startsWith('me_'));
  assert.equal(booked.meeting.kind, 'consultation');
  assert.equal(booked.meeting.joinPolicy, 'invited');
  assert.equal(S.db.get('consultationSlots', free.id).videoMeetingId, booked.meeting.id);

  const inny = await S.as('rodzic.nowak');
  const clash = await inny.post(`/api/meetings/consultations/${free.id}/book`, { studentId: 'st_nowak_jan' });
  assert.equal(clash.status, 409); assert.equal(clash.body.code, 'slot_taken');

  // rezerwacje wideo nie zaśmiecają listy zebrań z 3.7
  const zebrania = expectOk(await rodzic.get('/api/parent/meetings'));
  assert.ok(!zebrania.slots.some((s) => s.id === free.id), 'termin wideo nie pojawia się wśród terminów stacjonarnych');
});

test('[meetings.10] konfiguracja administratora: waliduje format, nigdy nie zwraca sekretu, test bez sieci', async () => {
  const admin = await jitsiConfigured();
  const cfg = expectOk(await admin.get('/api/admin/video'));
  assert.equal(JSON.stringify(cfg).includes('tajny-sekret-jitsi-2026'), false, 'sekret nie wycieka w odpowiedzi');
  assert.equal(cfg.jitsi.appSecretSet, true);
  assert.equal(cfg.jitsi.appSecret, undefined);

  const bad = await admin.patch('/api/admin/video', { provider: 'jitsi', jitsi: { domain: 'https://meet.sp12.krakow.pl/pokoj' } });
  assert.equal(bad.status, 400); assert.equal(bad.body.code, 'invalid_config');
  assert.ok(bad.body.errors.length);
  assert.equal(S.db.data.config.video.jitsi.domain, 'meet.sp12.krakow.pl', 'błędna wartość nie nadpisała konfiguracji');

  // puste pole sekretu = bez zmian
  expectOk(await admin.patch('/api/admin/video', { provider: 'jitsi', jitsi: { domain: 'meet.sp12.krakow.pl', appId: 'edmat_sp12', appSecret: '' } }));
  assert.equal(S.db.data.config.video.jitsi.appSecret, 'tajny-sekret-jitsi-2026');

  const t1 = expectOk(await admin.post('/api/admin/video/test', { provider: 'jitsi', jitsi: { domain: 'meet.sp12.krakow.pl' } }));
  assert.equal(t1.ok, true); assert.equal(t1.networkCall, false);
  assert.match(t1.preview, /^https:\/\/meet\.sp12\.krakow\.pl\//);
  const t2 = expectOk(await admin.post('/api/admin/video/test', { provider: 'bbb', bbb: { url: 'nie-adres' } }));
  assert.equal(t2.ok, false); assert.ok(t2.errors.length);

  // inne role nie dotykają konfiguracji
  const nauczyciel = await S.as('j.nowak');
  assert.equal((await nauczyciel.get('/api/admin/video')).status, 403);
  assert.equal((await nauczyciel.patch('/api/admin/video', { provider: 'none' })).status, 403);
});

test('[meetings.11] dostawca „tylko link” jest oznaczony jako zewnętrzny, a wyłączony moduł daje 404 module_disabled', async () => {
  const c = await S.as('dyrektor');
  const ext = expectOk(await c.post('/api/meetings', {
    kind: 'staff', title: 'Webinarium kuratorium', date: '2026-10-30', start: '10:00', end: '11:00',
    joinPolicy: 'staff', provider: 'none', externalUrl: 'https://kuratorium.example.org/webinar/123'
  })).meeting.id;
  const j = expectOk(await c.get(`/api/meetings/${ext}/join`));
  assert.equal(j.provider, 'none');
  assert.equal(j.external, true);
  assert.equal(j.embeddable, false);
  assert.match(j.warning, /zewnętrznego/);
  const badUrl = await c.post('/api/meetings', { kind: 'staff', title: 'Bez adresu', date: '2026-10-30', start: '10:00', end: '11:00', joinPolicy: 'staff', provider: 'none' });
  assert.equal(badUrl.status, 400); assert.equal(badUrl.body.code, 'bad_url');

  // moduł wyłączony w konfiguracji szkoły → wszystkie trasy modułu znikają
  S.db.data.config.modules = S.db.data.config.modules || { enabled: {} };
  S.db.data.config.modules.enabled.meetings = false;
  try {
    const off = await c.get('/api/meetings');
    assert.equal(off.status, 404);
    assert.equal(off.body.code, 'module_disabled');
    assert.equal(off.body.module, 'meetings');
    assert.equal((await c.get(`/api/meetings/${FIZ}/join`)).status, 404);
    assert.equal((await (await S.as('admin')).get('/api/admin/video')).status, 404);
  } finally {
    S.db.data.config.modules.enabled.meetings = true;
  }
  assert.equal(expectOk(await c.get('/api/meetings')).canSchedule, true, 'po włączeniu modułu trasy wracają');
});

test('[meetings.12] zajęcia kursu widzi wyłącznie uczeń zapisany na ten kurs', async () => {
  const c = await S.as('j.nowak');                             // prowadzi kurs „Ułamki zwykłe” (co_ulamki, klasa 7b)
  const item = expectOk(await c.post('/api/courses/co_ulamki/items', {
    unitId: 'co_ulamki_u2', kind: 'meeting', title: 'Ułamki: konsultacje online',
    start: '2026-11-05T16:30', end: '2026-11-05T17:15'
  })).item;
  const id = item.meetingId;
  const m = S.db.get('videoMeetings', id);
  assert.equal(m.kind, 'course'); assert.equal(m.courseId, 'co_ulamki'); assert.equal(m.joinPolicy, 'invited');

  // zapisany uczeń: widzi szczegóły, wchodzi do pokoju i ma spotkanie na swojej liście
  const anna = await S.as('anna.kowalczyk');                   // 7b — zapisana na kurs
  const detail = expectOk(await anna.get('/api/meetings/' + id));
  assert.equal(detail.canJoin, true); assert.equal(detail.moderator, false);
  assert.equal(detail.kindLabel, 'Zajęcia kursu');
  assert.ok(expectOk(await anna.get('/api/meetings')).upcoming.some((x) => x.id === id), 'spotkanie kursu jest na liście ucznia');
  expectOk(await anna.get('/api/meetings/' + id + '/join'));

  // uczeń spoza kursu: ani szczegółów, ani wejścia, ani wiersza na liście
  const obcy = await S.as('julia.baran');                      // 7a — nie jest zapisana na kurs
  const denied = await obcy.get('/api/meetings/' + id);
  assert.equal(denied.status, 403); assert.equal(denied.body.code, 'forbidden');
  assert.equal((await obcy.get('/api/meetings/' + id + '/join')).status, 403);
  const jej = expectOk(await obcy.get('/api/meetings'));
  assert.ok(!jej.upcoming.concat(jej.past).some((x) => x.id === id), 'spotkanie nie wycieka na listę obcego ucznia');

  // rodzic zapisanego ucznia widzi spotkanie jako opiekun (zgody na nagranie), ale do pokoju nie wchodzi
  const rodzic = await S.as('rodzic.kowalczyk');
  const podglad = expectOk(await rodzic.get('/api/meetings/' + id));
  assert.equal(podglad.guardianView, true); assert.equal(podglad.canJoin, false);

  // prowadzący jest gospodarzem i widzi listę obecności
  const host = expectOk(await c.get('/api/meetings/' + id));
  assert.equal(host.isHost, true); assert.equal(host.hostId, 'u_nowak');
  assert.ok(host.attendance.some((a) => a.userId === 'u_' + ANNA_ID), 'wejście ucznia zapisało się w obecności');
});
