'use strict';
/* Moduł „meetings” — spotkania wideo na własnym serwerze szkoły (Jitsi Meet / BigBlueButton).
   Patrz docs/VIDEO.md. Kolekcje: videoMeetings, meetingAttendance (+ terminy konsultacji wideo
   dopisane do wspólnej kolekcji consultationSlots z 3.7, z mode:'video').

   UWAGA: kolekcja `meetings` należy do 3.7 (zebrania i dni otwarte). Spotkania wideo mają własną
   kolekcję `videoMeetings`, żeby nie zaśmiecać listy zebrań rodzica. Identyfikatory: me_*. */

const TODAY = '2026-10-23';            // piątek (config.today)
const MONDAY = '2026-10-26';           // poniedziałek — lekcja 4 fizyki w 7b (plan: wd 1, nr 4)

function seed(db, ctx) {
  const cfg = db.data.config;

  /* --- konfiguracja dostawcy wideo ------------------------------------------------------- */
  cfg.video = Object.assign({
    provider: 'jitsi',
    jitsi: { domain: 'meet.sp12.krakow.pl (przykład)', appId: '', appSecret: '' },
    bbb: { url: '', secret: '' },
    eventSecret: 'edmat-video-events-secret-2026',   // nagłówek X-EdMat-Video-Secret dla zdarzeń dostawcy
    recordingConsentRequired: true,
    storedAt: 'school-server',
    maxMinutes: 90,
    note: 'Domena przykładowa — administrator wpisuje adres serwera szkoły w Administracji → Wideo. Dopóki jest przykładowa, dziennik nie ładuje żadnego skryptu z zewnątrz.'
  }, cfg.video || {});

  const meetings = db.col('videoMeetings');
  const attendance = db.col('meetingAttendance');
  const slots = db.col('consultationSlots');
  const has = (col, id) => col.some((x) => x.id === id);

  const meeting = (m) => {
    if (has(meetings, m.id)) return db.get('videoMeetings', m.id);
    const doc = Object.assign({
      kind: 'lesson', provider: 'jitsi', title: '', room: m.id, start: null, end: null,
      hostId: null, participantIds: [], classIds: [], groupIds: [], moderatorIds: [],
      courseId: null, lessonId: null, status: 'scheduled', joinPolicy: 'class',
      recording: { enabled: false, consentRequired: true, storedAt: 'school-server', fileId: null, consents: {} },
      waitingRoom: true, lobbyPasscode: null, externalUrl: null, note: '', createdAt: '2026-10-19T09:00:00.000Z'
    }, m);
    meetings.push(doc);
    return doc;
  };

  /* (1) zdalna lekcja fizyki dla 7b — poniedziałek 26.10, lekcja 4 (10:45–11:30), prowadzi a.wojcik */
  const les = db.col('lessons').find((l) => l.date === MONDAY && l.classId === '7b' && l.lessonNo === 4 && l.subjectId === 'fiz');
  const fiz = meeting({
    id: 'me_fiz_7b_1026', kind: 'lesson', title: 'Fizyka 7b — lekcja zdalna: siły i ich skutki',
    room: 'edmat-fiz-7b-20261026', start: `${MONDAY}T10:45:00.000Z`, end: `${MONDAY}T11:30:00.000Z`,
    hostId: 'u_wojcik', classIds: ['7b'], joinPolicy: 'class', lessonId: les ? les.id : null,
    lobbyPasscode: '4821',
    /* Nauczyciel poprosił o nagranie dla nieobecnych — nagrywanie pozostaje wyłączone do czasu zebrania zgód opiekunów. */
    recording: { enabled: false, requested: true, consentRequired: true, storedAt: 'school-server', fileId: null, consents: {} },
    note: 'Lekcja zdalna z powodu remontu pracowni. Uczniowie logują się z konta dziennika. Nauczyciel prosi o zgodę na nagranie dla nieobecnych.'
  });
  if (les && !les.meetingId) { les.meetingId = fiz.id; les.remote = true; }

  /* (2) konsultacja rodzica (rodzic.kowalczyk) z wychowawczynią 7b (j.nowak) */
  meeting({
    id: 'me_kons_kowalczyk', kind: 'consultation', title: 'Konsultacja: Anna Kowalczyk — postępy z matematyki',
    room: 'edmat-kons-kowalczyk-1028', start: '2026-10-28T17:20:00.000Z', end: '2026-10-28T17:40:00.000Z',
    hostId: 'u_nowak', participantIds: ['u_p_kowalczyk'], joinPolicy: 'invited', studentId: 'st_kowalczyk_anna',
    waitingRoom: true, lobbyPasscode: '7193',
    note: 'Rozmowa indywidualna — poczekalnia włączona, wchodzi wyłącznie zaproszony opiekun.'
  });

  /* (3) zakończona rada pedagogiczna z listą obecności */
  const rada = meeting({
    id: 'me_rada_1020', kind: 'staff', title: 'Rada pedagogiczna — organizacja zebrań i dnia otwartego',
    room: 'edmat-rada-20261020', start: '2026-10-20T15:00:00.000Z', end: '2026-10-20T16:05:00.000Z',
    hostId: 'u_dyrektor', joinPolicy: 'staff', status: 'ended',
    startedAt: '2026-10-20T15:02:00.000Z', endedAt: '2026-10-20T16:05:00.000Z',
    note: 'Spotkanie na serwerze szkoły; nagrywania nie włączono.'
  });
  const att = (userId, from, to, via) => {
    const id = `me_att_${rada.id}_${userId}`;
    if (!has(attendance, id)) attendance.push({ id, meetingId: rada.id, userId, joinedAt: from, leftAt: to, via: via || 'web', minutes: Math.round((new Date(to) - new Date(from)) / 60000), createdAt: from });
  };
  att('u_dyrektor', '2026-10-20T15:01:00.000Z', '2026-10-20T16:05:00.000Z', 'web');
  att('u_nowak', '2026-10-20T15:03:00.000Z', '2026-10-20T16:04:00.000Z', 'web');
  att('u_wojcik', '2026-10-20T15:02:00.000Z', '2026-10-20T16:05:00.000Z', 'web');
  att('u_sikora', '2026-10-20T15:07:00.000Z', '2026-10-20T16:05:00.000Z', 'mobile');
  att('u_lis', '2026-10-20T15:04:00.000Z', '2026-10-20T15:48:00.000Z', 'web');
  att('u_pedagog', '2026-10-20T15:05:00.000Z', '2026-10-20T16:02:00.000Z', 'web');

  /* --- wolne terminy konsultacji wideo (wspólna kolekcja consultationSlots z 3.7) --------- */
  const vslot = (id, teacherId, subjectId, start, end) => {
    if (has(slots, id)) return;
    slots.push({
      id, meetingId: null, videoMeetingId: null, mode: 'video', teacherId, subjectId,
      date: '2026-10-28', start, end, durationMin: cfg.consultationSlotMinutes || 20, room: null,
      bookedByUserId: null, bookedForStudentId: null, bookedAt: null, createdAt: '2026-10-19T09:10:00.000Z'
    });
  };
  vslot('me_slot_nowak_1', 'u_nowak', 'mat', '17:00', '17:20');
  vslot('me_slot_nowak_2', 'u_nowak', 'mat', '17:20', '17:40');
  vslot('me_slot_nowak_3', 'u_nowak', 'mat', '17:40', '18:00');
  vslot('me_slot_wojcik_1', 'u_wojcik', 'fiz', '17:00', '17:20');
  vslot('me_slot_wojcik_2', 'u_wojcik', 'fiz', '17:20', '17:40');
  /* termin już zajęty przez konsultację (2) */
  const taken = slots.find((x) => x.id === 'me_slot_nowak_2');
  if (taken && !taken.bookedByUserId) {
    taken.bookedByUserId = 'u_p_kowalczyk'; taken.bookedForStudentId = 'st_kowalczyk_anna';
    taken.bookedAt = '2026-10-21T19:12:00.000Z'; taken.videoMeetingId = 'me_kons_kowalczyk';
  }

  ['videoMeetings', 'meetingAttendance'].forEach((c) => db.col(c));
}

module.exports = { seed, TODAY, MONDAY };
