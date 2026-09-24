'use strict';
/* Moduł „meetings” — spotkania wideo na serwerze szkoły (Jitsi Meet / BigBlueButton / tylko link).
   Scenariusze: (1) lekcja zdalna dla klasy, (2) konsultacja rodzica z nauczycielem, (3) rada pedagogiczna.

   Zasady:
   - serwer nigdy nie łączy się z dostawcą wideo; buduje tylko adres, token JWT lub sumę kontrolną (server/lib/video.js),
   - do pokoju wchodzi wyłącznie osoba uprawniona (joinPolicy) — wejście jest audytowane i zapisywane w obecności,
   - nagrywanie jest domyślnie wyłączone i wymaga zgody opiekunów uczniów niepełnoletnich; nagrania zostają na serwerze szkoły,
   - kolekcja `meetings` należy do 3.7 (zebrania stacjonarne) — spotkania wideo mają własną kolekcję `videoMeetings`.

   Kolekcje: videoMeetings, meetingAttendance, consultationSlots (wspólna z 3.7, tu mode:'video'). */
const D = require('../lib/domain');
const U = require('../lib/util');
const V = require('../lib/video');
const auth = require('../auth');
const { httpError } = require('../lib/router');

const KINDS = ['lesson', 'consultation', 'staff', 'course'];
const POLICIES = ['invited', 'class', 'staff'];
const STATUSES = ['scheduled', 'live', 'ended', 'cancelled'];
const HOST_ROLES = ['teacher', 'principal', 'counselor', 'psychologist', 'specialEducator', 'speechTherapist', 'supportTeacher', 'registrar', 'admin'];
const ANY = {};                                   // każda zalogowana rola
const HOSTS = { roles: HOST_ROLES };
const ADMIN = { roles: ['admin'] };
const ADMIN_READ = { roles: ['admin', 'principal'] };
const EVENT_HEADER = 'x-edmat-video-secret';

const KIND_LABEL = { lesson: 'Lekcja zdalna', consultation: 'Konsultacja', staff: 'Spotkanie zespołu', course: 'Zajęcia kursu' };
const isStaff = (u) => auth.STAFF.includes(u.role);
const groupsOf = (db, studentId) => db.col('groups').filter((g) => (g.studentIds || []).includes(studentId)).map((g) => g.id);

/* ---------------------------------------------------------------- odbiorcy i uprawnienia */

/** Uczniowie objęci spotkaniem (klasy, grupy, wskazani uczniowie, konta uczniów na liście uczestników). */
function studentsOf(db, m) {
  const out = new Map();
  for (const s of db.col('students')) {
    const inClass = (m.classIds || []).includes(s.classId);
    const inGroup = (m.groupIds || []).length && groupsOf(db, s.id).some((g) => (m.groupIds || []).includes(g));
    const named = m.studentId === s.id || (m.studentIds || []).includes(s.id);
    const viaAccount = (m.participantIds || []).some((uid) => { const u = db.get('users', uid); return u && u.role === 'student' && u.studentId === s.id; });
    if (inClass || inGroup || named || viaAccount) out.set(s.id, s);
  }
  return [...out.values()];
}
/** Konta, które mogą wejść — do powiadomień i listy „moje spotkania”. */
function audienceUserIds(db, m) {
  const ids = new Set([m.hostId, ...(m.participantIds || [])].filter(Boolean));
  if (m.joinPolicy === 'staff') for (const u of db.col('users')) if (isStaff(u)) ids.add(u.id);
  if (m.joinPolicy === 'class') for (const s of studentsOf(db, m)) { const u = db.col('users').find((x) => x.role === 'student' && x.studentId === s.id); if (u) ids.add(u.id); }
  return [...ids];
}
/** Czy nauczyciel uczy w którejś z klas spotkania (plan lekcji lub lekcje z zastępstwem)? */
function teachesMeeting(db, user, m) {
  return (m.classIds || []).some((c) => db.col('timetable').some((t) => t.classId === c && t.teacherId === user.id)
    || db.col('lessons').some((l) => l.classId === c && (l.teacherId === user.id || l.substituteTeacherId === user.id)));
}
/** { ok, moderator, reason } — jedyne miejsce, w którym decydujemy o wejściu do pokoju. */
function canJoin(db, m, user) {
  const named = (m.moderatorIds || []).includes(user.id);
  if (user.id === m.hostId) return { ok: true, moderator: true };
  if (m.status === 'cancelled') return { ok: false, reason: 'cancelled' };
  if ((m.participantIds || []).includes(user.id)) return { ok: true, moderator: named || (user.role === 'principal' && m.kind === 'staff') };
  if (m.joinPolicy === 'staff') return isStaff(user) ? { ok: true, moderator: named || user.role === 'principal' } : { ok: false, reason: 'staff_only' };
  if (m.joinPolicy === 'class') {
    if (user.role === 'student') {
      const s = db.get('students', user.studentId);
      const ok = !!s && ((m.classIds || []).includes(s.classId) || groupsOf(db, s.id).some((g) => (m.groupIds || []).includes(g)));
      return ok ? { ok: true, moderator: false } : { ok: false, reason: 'other_class' };
    }
    if (user.role === 'parent') return { ok: false, reason: 'not_invited' };
    if (isStaff(user)) {
      const ok = user.role === 'principal' || (m.classIds || []).some((c) => D.isHomeroomOf(db, user, c)) || teachesMeeting(db, user, m);
      return ok ? { ok: true, moderator: named || user.role === 'principal' } : { ok: false, reason: 'not_invited' };
    }
    return { ok: false, reason: 'not_invited' };
  }
  return { ok: false, reason: 'not_invited' };
}
const REASON_MSG = {
  cancelled: 'Spotkanie zostało odwołane.',
  staff_only: 'To spotkanie jest dostępne wyłącznie dla pracowników szkoły.',
  other_class: 'To spotkanie jest dla innej klasy.',
  not_invited: 'Nie jesteś na liście uczestników tego spotkania.',
  guardian: 'Podgląd dla opiekuna — do pokoju wchodzi uczeń ze swojego konta. Tutaj decydujesz o zgodzie na nagrywanie.'
};
function assertCanJoin(db, m, user) {
  const v = canJoin(db, m, user);
  if (!v.ok) throw httpError(403, REASON_MSG[v.reason] || 'Brak dostępu do tego spotkania.', { code: v.reason === 'cancelled' ? 'meeting_cancelled' : 'forbidden' });
  return v;
}
/** Opiekun ucznia objętego spotkaniem: nie wchodzi do pokoju, ale widzi spotkanie i decyduje o zgodzie na nagranie.
    D3-03 — „swoje dziecko” to dziecko, do którego danych to konto ma dziś dostęp (`D.guardianStanding`). */
function isGuardianOfAudience(db, m, user) {
  return user.role === 'parent' && studentsOf(db, m).some((s) => (user.childrenIds || []).includes(s.id) && D.guardianStanding(db, user, s.id).ok);
}
/** Domyślne dziecko opiekuna na trasach spotkań: pierwsze, które to konto w ogóle widzi. */
const firstVisibleChild = (db, user) => ((D.visibleStudentIds(db, user) || [])[0] || null);
/** Czy użytkownik należy do kręgu odbiorców niezależnie od statusu (do listy i podglądu odwołanych). */
function inAudience(db, m, user) { return m.hostId === user.id || canJoin(db, Object.assign({}, m, { status: 'scheduled' }), user).ok || isGuardianOfAudience(db, m, user); }
function isHost(m, user) { return user.id === m.hostId || user.role === 'principal' || user.role === 'admin'; }
function getMeeting(ctx) { const m = ctx.db.get('videoMeetings', ctx.params.id); if (!m) throw httpError(404, 'Nie ma takiego spotkania.', { code: 'not_found' }); return m; }

/* ---------------------------------------------------------------- zgody na nagrywanie */

/**
 * Kto może wyrazić zgodę na nagranie: uczeń pełnoletni — sam, uczeń niepełnoletni — opiekun prawny
 * **w pełnej legitymacji**. D3-03: lista szła wprost po `parentIds`, więc rodzic pozbawiony władzy
 * rodzicielskiej figurował jako uprawniony do zgody na nagrywanie dziecka — a zgoda złożona przez
 * osobę bez władzy rodzicielskiej jest nieważna, czyli nagranie bezprawne. Jedna bramka:
 * `D.guardianStanding(...).ok && scope === 'full'`.
 */
function mayDecideForStudent(db, s) {
  if (!s) return [];
  if (s.adult) return [`u_${s.id}`];
  return (s.parentIds || []).filter((p) => { const st = D.guardianStanding(db, p, s.id); return st.ok && st.scope === 'full'; });
}
function consentRows(db, m) {
  const rec = m.recording || {};
  const given = rec.consents || {};
  return studentsOf(db, m).map((s) => {
    const key = s.id; const c = given[key] || null;
    return {
      studentId: s.id, name: `${s.firstName} ${s.lastName}`, classId: s.classId, adult: !!s.adult,
      decidedBy: mayDecideForStudent(db, s),
      granted: !!(c && c.granted), at: c ? c.at : null, byUserId: c ? c.byUserId : null
    };
  });
}
function recordingBlockers(db, m) { return consentRows(db, m).filter((r) => !r.granted); }

/* ---------------------------------------------------------------- widok */

function attendanceOf(db, meetingId) { return db.col('meetingAttendance').filter((a) => a.meetingId === meetingId); }
function view(db, m, user) {
  const host = db.get('users', m.hostId);
  const att = attendanceOf(db, m.id);
  const cfg = V.videoConfig(db);
  const perm = user ? canJoin(db, m, user) : { ok: false };
  const consents = consentRows(db, m);
  return {
    id: m.id, kind: m.kind, kindLabel: KIND_LABEL[m.kind] || m.kind, title: m.title,
    provider: m.provider || cfg.provider, room: m.room, externalUrl: m.externalUrl || null,
    start: m.start, end: m.end, startedAt: m.startedAt || null, endedAt: m.endedAt || null,
    date: (m.start || '').slice(0, 10), startTime: (m.start || '').slice(11, 16), endTime: (m.end || '').slice(11, 16),
    hostId: m.hostId, host: D.userLabel(host), status: m.status, joinPolicy: m.joinPolicy,
    classIds: m.classIds || [], groupIds: m.groupIds || [], participantIds: m.participantIds || [],
    participants: (m.participantIds || []).map((id) => { const u = db.get('users', id); return { id, name: D.userLabel(u), role: u ? u.role : null }; }),
    courseId: m.courseId || null, courseItemId: m.courseItemId || null, lessonId: m.lessonId || null, studentId: m.studentId || null,
    recording: { enabled: !!(m.recording && m.recording.enabled), requested: !!(m.recording && m.recording.requested), consentRequired: !(m.recording && m.recording.consentRequired === false), storedAt: (m.recording && m.recording.storedAt) || 'school-server', fileId: (m.recording && m.recording.fileId) || null, consents, missingConsents: consents.filter((c) => !c.granted).length },
    waitingRoom: m.waitingRoom !== false, hasPasscode: !!m.lobbyPasscode,
    note: m.note || '', createdAt: m.createdAt,
    canJoin: !!perm.ok, moderator: !!perm.moderator, isHost: user ? isHost(m, user) : false,
    guardianView: !!(user && !perm.ok && isGuardianOfAudience(db, m, user)),
    joinReason: perm.ok ? null : (user && isGuardianOfAudience(db, m, user) ? REASON_MSG.guardian : (REASON_MSG[perm.reason] || null)),
    attendanceCount: new Set(att.map((a) => a.userId)).size
  };
}

/* ---------------------------------------------------------------- obecność */

function recordJoin(db, meetingId, userId, via) {
  const open = db.col('meetingAttendance').find((a) => a.meetingId === meetingId && a.userId === userId && !a.leftAt);
  if (open) return open;
  return db.insert('meetingAttendance', { meetingId, userId, joinedAt: U.now(), leftAt: null, via: via || 'web', minutes: null });
}
function recordLeave(db, meetingId, userId, at) {
  const open = db.col('meetingAttendance').filter((a) => a.meetingId === meetingId && a.userId === userId && !a.leftAt).pop();
  if (!open) return null;
  open.leftAt = at || U.now();
  open.minutes = Math.max(0, Math.round((new Date(open.leftAt) - new Date(open.joinedAt)) / 60000));
  db.save(); return open;
}

/* ---------------------------------------------------------------- tworzenie i odwoływanie (jedna ścieżka) */

/** Jedyne miejsce, w którym powstaje spotkanie wideo: trasa POST /api/meetings i moduł kursów wołają to samo.
    `start`/`end` przyjmujemy jako GG:MM z osobną datą albo jako pełny znacznik ISO (RRRR-MM-DDTGG:MM). */
function createMeeting(ctx, input) {
  const db = ctx.db; const b = input || {}; const cfg = V.videoConfig(db);
  const kind = KINDS.includes(b.kind) ? b.kind : 'lesson';
  const title = String(b.title || '').trim();
  if (title.length < 3) throw httpError(400, 'Podaj tytuł spotkania (co najmniej 3 znaki).', { code: 'bad_title' });
  const hhmm = /^\d{2}:\d{2}$/;
  const iso = /^(\d{4}-\d{2}-\d{2})[T ](\d{2}:\d{2})/;
  let date = String(b.date || '').slice(0, 10);
  let start = String(b.start || ''), end = String(b.end || '');
  const ms = iso.exec(start); if (ms) { date = ms[1]; start = ms[2]; }
  const me = iso.exec(end); if (me) { end = me[2]; }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw httpError(400, 'Podaj datę spotkania w formacie RRRR-MM-DD.', { code: 'bad_date' });
  if (b.lessonNo != null && !hhmm.test(start)) { const lt = D.lessonTime(db, +b.lessonNo); start = lt.start; end = lt.end; }
  if (!hhmm.test(start) || !hhmm.test(end)) throw httpError(400, 'Podaj godzinę początku i końca (GG:MM) albo numer lekcji.', { code: 'bad_time' });
  if (end <= start) throw httpError(400, 'Godzina końca musi być późniejsza niż początek.', { code: 'bad_time' });
  const provider = V.PROVIDERS.includes(b.provider) ? b.provider : cfg.provider;
  const externalUrl = provider === 'none' ? String(b.externalUrl || '').trim() : null;
  if (provider === 'none' && !/^https:\/\/\S+$/.test(externalUrl || '')) throw httpError(400, 'Dla dostawcy zewnętrznego podaj pełny adres https:// spotkania.', { code: 'bad_url' });
  const joinPolicy = POLICIES.includes(b.joinPolicy) ? b.joinPolicy : (kind === 'staff' ? 'staff' : kind === 'consultation' || kind === 'course' ? 'invited' : 'class');
  const classIds = (Array.isArray(b.classIds) ? b.classIds : []).filter((c) => db.get('classes', c));
  const groupIds = (Array.isArray(b.groupIds) ? b.groupIds : []).filter((g) => db.get('groups', g));
  const participantIds = (Array.isArray(b.participantIds) ? b.participantIds : []).filter((u) => db.get('users', u));
  if (joinPolicy === 'class' && !classIds.length && !groupIds.length) throw httpError(400, 'Wskaż klasę lub grupę, dla której jest spotkanie.', { code: 'no_audience' });
  if (joinPolicy === 'invited' && !participantIds.length) throw httpError(400, 'Wskaż zaproszone osoby.', { code: 'no_audience' });
  if (ctx.user.role === 'teacher' && classIds.length) {
    const mine = { classIds, groupIds };
    if (!classIds.some((c) => D.isHomeroomOf(db, ctx.user, c)) && !teachesMeeting(db, ctx.user, mine)) throw httpError(403, 'Możesz zaplanować lekcję zdalną tylko dla klasy, w której uczysz.', { code: 'forbidden' });
  }
  const id = U.id('me');
  const m = db.insert('videoMeetings', {
    id, kind, provider, title, room: 'edmat-' + kind + '-' + id.replace(/^me_/, ''),
    start: `${date}T${start}:00.000Z`, end: `${date}T${end}:00.000Z`,
    hostId: ctx.user.id, participantIds, classIds, groupIds, moderatorIds: Array.isArray(b.moderatorIds) ? b.moderatorIds : [],
    courseId: b.courseId || null, courseItemId: b.courseItemId || null, lessonId: b.lessonId || null, studentId: b.studentId || null,
    status: 'scheduled', joinPolicy,
    recording: { enabled: false, consentRequired: true, storedAt: cfg.storedAt, fileId: null, consents: {} },
    waitingRoom: b.waitingRoom !== false, lobbyPasscode: b.lobbyPasscode ? String(b.lobbyPasscode) : String(1000 + Math.floor(Math.random() * 9000)),
    externalUrl, note: String(b.note || '')
  });
  if (b.lessonId) { const les = db.get('lessons', b.lessonId); if (les) { les.meetingId = m.id; les.remote = true; db.save(); } }
  let recording = null;
  if (b.recording) { m.recording.requested = true; const blockers = recordingBlockers(db, m); if (blockers.length) { db.save(); recording = { enabled: false, reason: 'recording_consent_missing', missing: blockers.length }; } else { m.recording.enabled = true; db.save(); recording = { enabled: true }; } }
  for (const uid of audienceUserIds(db, m)) if (uid !== ctx.user.id) D.notify(db, uid, 'meeting', `Nowe spotkanie wideo: ${title} — ${U.fmtDate(date)}, ${start}.`, { link: '/spotkania' });
  ctx.audit({ action: 'meeting_scheduled', entity: 'videoMeetings', entityId: m.id, after: { kind, provider, title, start: m.start, joinPolicy, classIds, participantIds, courseId: m.courseId } });
  return { meeting: m, recording };
}

/** Czy spotkanie można jeszcze odwołać (nie ruszyło i nie zostało odwołane). */
function isCancellable(m) { return m.status === 'scheduled' && !m.startedAt; }

/** Odwołanie spotkania: powiadomienia, odłączenie lekcji i wpis audytowy — jedna ścieżka dla trasy i modułu kursów. */
function cancelMeeting(ctx, m, reason) {
  const db = ctx.db;
  const before = { status: m.status };
  m.status = 'cancelled'; m.cancelledAt = U.now(); m.cancelReason = reason; db.save();
  const targets = audienceUserIds(db, m).filter((u) => u !== ctx.user.id);
  for (const uid of targets) D.notify(db, uid, 'meeting', `Odwołano spotkanie „${m.title}” (${U.fmtDate((m.start || '').slice(0, 10))}, ${(m.start || '').slice(11, 16)}). Powód: ${reason}`, { link: '/spotkania' });
  if (m.lessonId) { const les = db.get('lessons', m.lessonId); if (les && les.meetingId === m.id) { les.meetingId = null; les.remote = false; db.save(); } }
  ctx.audit({ action: 'meeting_cancelled', entity: 'videoMeetings', entityId: m.id, before, after: { status: 'cancelled' }, reason });
  return { meeting: m, notified: targets.length };
}

/* ================================================================ routes */

function register(r, app) {

  /* --- konfiguracja widoczna dla wszystkich ról (bez sekretów) --------------------------- */
  r.get('/api/meetings/config', (ctx) => {
    const cfg = V.videoConfig(ctx.db);
    const placeholder = V.isPlaceholderDomain(cfg.jitsi.domain);
    return {
      provider: cfg.provider,
      domain: cfg.provider === 'jitsi' ? cfg.jitsi.domain : (cfg.bbb.url || null),
      jitsiDomain: cfg.jitsi.domain || '', placeholderDomain: placeholder,
      embeddable: cfg.provider === 'jitsi' && !placeholder,
      externalApi: cfg.provider === 'jitsi' && !placeholder ? `https://${cfg.jitsi.domain}/external_api.js` : null,
      jwtEnabled: !!(cfg.jitsi.appId && cfg.jitsi.appSecret),
      recordingConsentRequired: cfg.recordingConsentRequired, storedAt: cfg.storedAt,
      selfHosted: cfg.provider !== 'none',
      kinds: KINDS.map((k) => ({ value: k, label: KIND_LABEL[k] })),
      lessonTimes: ctx.db.data.config.lessonTimes,
      /* klasy, dla których zalogowany nauczyciel może zaplanować lekcję zdalną (bez sięgania do cudzych tras) */
      classes: isStaff(ctx.user)
        ? ctx.db.col('classes').filter((c) => ctx.user.role !== 'teacher' || D.isHomeroomOf(ctx.db, ctx.user, c.id) || teachesMeeting(ctx.db, ctx.user, { classIds: [c.id] })).map((c) => ({ id: c.id, name: c.name, level: c.level }))
        : [],
      today: D.today(ctx.db)
    };
  }, ANY);

  /* --- konsultacje wideo (rezerwacja terminu przez rodzica) ------------------------------ */
  const videoSlots = (db) => db.col('consultationSlots').filter((x) => x.mode === 'video');
  function slotView(db, x, user) {
    const t = db.get('users', x.teacherId);
    return {
      id: x.id, date: x.date, start: x.start, end: x.end, when: `${U.fmtDate(x.date)}, ${x.start}`,
      teacherId: x.teacherId, teacher: D.userLabel(t), subjectId: x.subjectId || null,
      subject: x.subjectId ? (db.data.subjects.find((s) => s.id === x.subjectId) || {}).name : null,
      booked: !!x.bookedByUserId, mine: !!user && x.bookedByUserId === user.id,
      bookedForStudentId: x.bookedForStudentId || null, videoMeetingId: x.videoMeetingId || null
    };
  }
  r.get('/api/meetings/consultations', (ctx) => {
    const db = ctx.db; const user = ctx.user;
    let rows = videoSlots(db);
    if (user.role === 'teacher' || isStaff(user)) rows = user.role === 'principal' || user.role === 'admin' ? rows : rows.filter((x) => x.teacherId === user.id);
    return {
      slots: rows.map((x) => slotView(db, x, user)).sort((a, b) => (a.date + a.start + a.teacher < b.date + b.start + b.teacher ? -1 : 1)),
      myBookings: videoSlots(db).filter((x) => x.bookedByUserId === user.id).map((x) => slotView(db, x, user)),
      note: 'Rezerwacja terminu tworzy spotkanie wideo w pokoju szkoły. Jeden termin przyjmuje jedną rezerwację.'
    };
  }, ANY);

  r.post('/api/meetings/consultations', (ctx) => {
    const db = ctx.db; const b = ctx.body || {};
    const date = String(b.date || '').slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw httpError(400, 'Podaj datę konsultacji w formacie RRRR-MM-DD.', { code: 'bad_date' });
    const times = Array.isArray(b.slots) ? b.slots : [];
    if (!times.length) throw httpError(400, 'Podaj co najmniej jeden termin (godzina początku i końca).', { code: 'no_slots' });
    const made = times.map((t) => db.insert('consultationSlots', {
      id: U.id('me_slot'), meetingId: null, videoMeetingId: null, mode: 'video', teacherId: ctx.user.id,
      subjectId: b.subjectId || (ctx.user.subjects || [])[0] || null, date, start: String(t.start || ''), end: String(t.end || ''),
      durationMin: db.data.config.consultationSlotMinutes || 20, room: null,
      bookedByUserId: null, bookedForStudentId: null, bookedAt: null
    }));
    ctx.audit({ action: 'consultation_slots_created', entity: 'consultationSlots', entityId: made[0].id, after: { count: made.length, date, mode: 'video' } });
    return { ok: true, slots: made.map((x) => slotView(db, x, ctx.user)) };
  }, HOSTS);

  r.post('/api/meetings/consultations/:id/book', (ctx) => {
    const db = ctx.db; const x = db.get('consultationSlots', ctx.params.id);
    if (!x || x.mode !== 'video') throw httpError(404, 'Nie ma takiego terminu konsultacji wideo.', { code: 'not_found' });
    const studentId = (ctx.body && ctx.body.studentId) || firstVisibleChild(db, ctx.user);
    if (!studentId) throw httpError(400, 'Wskaż dziecko, którego dotyczy konsultacja.', { code: 'no_student' });
    D.assertCanSeeStudent(db, ctx.user, studentId);
    if (x.bookedByUserId) throw httpError(409, x.bookedByUserId === ctx.user.id ? 'Ten termin jest już przez Ciebie zarezerwowany.' : `Termin ${U.fmtDate(x.date)} ${x.start} został właśnie zarezerwowany przez innego opiekuna.`, { code: x.bookedByUserId === ctx.user.id ? 'already_mine' : 'slot_taken' });
    const s = db.get('students', studentId);
    const m = db.insert('videoMeetings', {
      id: U.id('me'), kind: 'consultation', provider: V.videoConfig(db).provider,
      title: `Konsultacja: ${s.firstName} ${s.lastName}`, room: 'edmat-kons-' + U.id('').slice(0, 10),
      start: `${x.date}T${x.start}:00.000Z`, end: `${x.date}T${x.end}:00.000Z`,
      hostId: x.teacherId, participantIds: [ctx.user.id], classIds: [], groupIds: [], moderatorIds: [],
      courseId: null, lessonId: null, studentId, status: 'scheduled', joinPolicy: 'invited',
      recording: { enabled: false, consentRequired: true, storedAt: 'school-server', fileId: null, consents: {} },
      waitingRoom: true, lobbyPasscode: String(1000 + Math.floor(Math.random() * 9000)), note: ''
    });
    x.bookedByUserId = ctx.user.id; x.bookedForStudentId = studentId; x.bookedAt = U.now(); x.videoMeetingId = m.id; db.save();
    D.notify(db, x.teacherId, 'meeting', `Rezerwacja konsultacji wideo ${U.fmtDate(x.date)} ${x.start}: ${D.userLabel(ctx.user)} (${s.firstName} ${s.lastName}).`, { link: '/spotkania' });
    ctx.audit({ action: 'video_consultation_booked', entity: 'videoMeetings', entityId: m.id, after: { slotId: x.id, studentId, teacherId: x.teacherId } });
    return { ok: true, slot: slotView(db, x, ctx.user), meeting: view(db, m, ctx.user), confirmation: `Zarezerwowano konsultację wideo ${U.fmtDate(x.date)} o ${x.start} — ${D.userLabel(db.get('users', x.teacherId))}.` };
  }, { roles: ['parent'] });

  r.delete('/api/meetings/consultations/:id/book', (ctx) => {
    const db = ctx.db; const x = db.get('consultationSlots', ctx.params.id);
    if (!x || x.mode !== 'video') throw httpError(404, 'Nie ma takiego terminu konsultacji wideo.', { code: 'not_found' });
    if (x.bookedByUserId !== ctx.user.id) throw httpError(403, 'Rezerwację odwołuje opiekun, który ją założył.', { code: 'not_owner' });
    const before = { bookedByUserId: x.bookedByUserId, videoMeetingId: x.videoMeetingId };
    if (x.videoMeetingId) { const m = db.get('videoMeetings', x.videoMeetingId); if (m) { m.status = 'cancelled'; m.cancelledAt = U.now(); } }
    x.bookedByUserId = null; x.bookedForStudentId = null; x.bookedAt = null; x.videoMeetingId = null; db.save();
    ctx.audit({ action: 'video_consultation_cancelled', entity: 'consultationSlots', entityId: x.id, before, after: { bookedByUserId: null } });
    return { ok: true, slot: slotView(db, x, ctx.user) };
  }, { roles: ['parent'] });

  /* --- lista „moje spotkania” ------------------------------------------------------------ */
  r.get('/api/meetings', (ctx) => {
    const db = ctx.db; const user = ctx.user;
    const all = db.col('videoMeetings').filter((m) => inAudience(db, m, user));
    const rows = all.map((m) => view(db, m, user)).sort((a, b) => (String(a.start) < String(b.start) ? -1 : 1));
    const nowIso = U.now(); const todayIso = D.today(db);
    const past = rows.filter((x) => x.status === 'ended' || x.status === 'cancelled' || (x.end && x.end < nowIso && x.status !== 'live'));
    const upcoming = rows.filter((x) => !past.includes(x));
    return {
      upcoming, past: past.reverse(), today: todayIso,
      config: { provider: V.videoConfig(db).provider, placeholderDomain: V.isPlaceholderDomain(V.videoConfig(db).jitsi.domain) },
      canSchedule: HOST_ROLES.includes(user.role),
      note: 'Spotkania odbywają się na serwerze szkoły. Wejście wymaga zalogowania w dzienniku i jest zapisywane w obecności.'
    };
  }, ANY);

  /* --- planowanie -------------------------------------------------------------------------- */
  r.post('/api/meetings', (ctx) => {
    const made = createMeeting(ctx, ctx.body || {});
    const m = made.meeting;
    return {
      ok: true, meeting: view(ctx.db, m, ctx.user), recording: made.recording,
      confirmation: `Zaplanowano: ${m.title} — ${U.fmtDate((m.start || '').slice(0, 10))}, ${(m.start || '').slice(11, 16)}–${(m.end || '').slice(11, 16)}.`
    };
  }, HOSTS);

  /* --- szczegóły ---------------------------------------------------------------------------- */
  r.get('/api/meetings/:id', (ctx) => {
    const m = getMeeting(ctx); const db = ctx.db;
    if (!inAudience(db, m, ctx.user)) throw httpError(403, REASON_MSG.not_invited, { code: 'forbidden' });
    const v = view(db, m, ctx.user);
    if (isHost(m, ctx.user)) { v.passcode = m.lobbyPasscode || null; v.attendance = attendanceOf(db, m.id).map((a) => ({ userId: a.userId, name: D.userLabel(db.get('users', a.userId)), joinedAt: a.joinedAt, leftAt: a.leftAt, minutes: a.minutes, via: a.via })); }
    return v;
  }, ANY);

  /* --- wejście do pokoju --------------------------------------------------------------------- */
  r.get('/api/meetings/:id/join', (ctx) => {
    const db = ctx.db; const m = getMeeting(ctx); const cfg = V.videoConfig(db);
    const perm = assertCanJoin(db, m, ctx.user);
    if (m.status === 'ended') throw httpError(409, 'Spotkanie zostało zakończone.', { code: 'meeting_ended' });
    const canRecord = perm.moderator && !!(m.recording && m.recording.enabled);
    const payload = V.joinPayload(cfg, m, { id: ctx.user.id, name: D.userLabel(ctx.user), email: ctx.user.email || undefined }, { moderator: perm.moderator, canRecord, revealPasscode: true });
    recordJoin(db, m.id, ctx.user.id, /Mobi|Android/i.test(ctx.req.headers['user-agent'] || '') ? 'mobile' : 'web');
    if (m.status === 'scheduled' && perm.moderator) { m.status = 'live'; m.startedAt = m.startedAt || U.now(); db.save(); }
    ctx.audit({ action: 'meeting_join', entity: 'videoMeetings', entityId: m.id, after: { moderator: perm.moderator, provider: payload.provider } });
    return Object.assign(payload, {
      meetingId: m.id, title: m.title, kind: m.kind, status: m.status,
      recording: { enabled: !!(m.recording && m.recording.enabled), consentRequired: !(m.recording && m.recording.consentRequired === false), storedAt: (m.recording && m.recording.storedAt) || 'school-server' },
      privacyNote: 'Połączenie zestawia przeglądarka bezpośrednio z serwerem szkoły. Dziennik nie pośredniczy w obrazie ani dźwięku.'
    });
  }, ANY);

  /* --- start / koniec / odwołanie ------------------------------------------------------------- */
  r.post('/api/meetings/:id/start', (ctx) => {
    const db = ctx.db; const m = getMeeting(ctx);
    if (!isHost(m, ctx.user)) throw httpError(403, 'Spotkanie rozpoczyna prowadzący.', { code: 'not_host' });
    if (m.status === 'cancelled') throw httpError(409, 'Spotkanie zostało odwołane.', { code: 'meeting_cancelled' });
    m.status = 'live'; m.startedAt = m.startedAt || U.now(); db.save();
    ctx.audit({ action: 'meeting_started', entity: 'videoMeetings', entityId: m.id, after: { startedAt: m.startedAt } });
    return { ok: true, meeting: view(db, m, ctx.user) };
  }, HOSTS);

  r.post('/api/meetings/:id/end', (ctx) => {
    const db = ctx.db; const m = getMeeting(ctx);
    if (!isHost(m, ctx.user)) throw httpError(403, 'Spotkanie kończy prowadzący.', { code: 'not_host' });
    const at = U.now();
    m.status = 'ended'; m.endedAt = at; db.save();
    for (const a of attendanceOf(db, m.id)) if (!a.leftAt) recordLeave(db, m.id, a.userId, at);
    ctx.audit({ action: 'meeting_ended', entity: 'videoMeetings', entityId: m.id, after: { endedAt: at, participants: new Set(attendanceOf(db, m.id).map((a) => a.userId)).size } });
    return { ok: true, meeting: view(db, m, ctx.user), endUrl: (m.provider || V.videoConfig(db).provider) === 'bbb' ? V.bbbEndUrl(V.videoConfig(db), m) : null };
  }, HOSTS);

  r.post('/api/meetings/:id/cancel', (ctx) => {
    const db = ctx.db; const m = getMeeting(ctx);
    if (!isHost(m, ctx.user)) throw httpError(403, 'Spotkanie odwołuje prowadzący.', { code: 'not_host' });
    const reason = String((ctx.body && ctx.body.reason) || '').trim();
    if (reason.length < 3) throw httpError(400, 'Podaj powód odwołania — zobaczą go uczestnicy.', { code: 'no_reason' });
    const done = cancelMeeting(ctx, m, reason);
    return { ok: true, meeting: view(db, m, ctx.user), notified: done.notified };
  }, HOSTS);

  /* --- zdarzenia od dostawcy (obecność) ------------------------------------------------------- */
  /* Jitsi: moduł prosody/jicofo szkoły podpisuje treść HMAC-SHA256 (nagłówek X-EdMat-Video-Signature);
     BigBlueButton: callback z sumą kontrolną. Minimalnie wystarczy wspólny sekret w nagłówku. */
  r.post('/api/meetings/:id/events', (ctx) => {
    const db = ctx.db; const cfg = V.videoConfig(db);
    const m = db.get('videoMeetings', ctx.params.id);
    if (!m) throw httpError(404, 'Nie ma takiego spotkania.', { code: 'not_found' });
    const presented = ctx.req.headers[EVENT_HEADER];
    const signature = ctx.req.headers['x-edmat-video-signature'];
    const bySecret = V.verifyEventSecret(cfg.eventSecret, presented);
    const bySignature = signature ? V.verifyJitsiWebhook(cfg.eventSecret, ctx.body || {}, signature).ok : false;
    if (!bySecret && !bySignature) throw httpError(401, 'Nieprawidłowy sekret zdarzeń wideo.', { code: 'bad_event_secret' });
    const b = ctx.body || {};
    const events = Array.isArray(b.events) ? b.events : [b];
    const applied = [];
    for (const e of events) {
      const userId = e.userId || e.user_id || null;
      const type = e.type || e.event || '';
      if (!userId && type !== 'meeting-ended') continue;
      if (userId && !db.get('users', userId)) continue;
      if (type === 'participant-joined' || type === 'join') { const row = recordJoin(db, m.id, userId, e.via || 'provider'); if (e.at) { row.joinedAt = e.at; db.save(); } applied.push({ type: 'joined', userId }); }
      else if (type === 'participant-left' || type === 'leave') { const row = recordLeave(db, m.id, userId, e.at); if (row) applied.push({ type: 'left', userId, minutes: row.minutes }); }
      else if (type === 'meeting-ended') { m.status = 'ended'; m.endedAt = e.at || U.now(); for (const a of attendanceOf(db, m.id)) if (!a.leftAt) recordLeave(db, m.id, a.userId, m.endedAt); db.save(); applied.push({ type: 'ended' }); }
      else if (type === 'recording-stored') { m.recording = Object.assign({}, m.recording, { fileId: e.fileId || null, storedAt: e.storedAt || 'school-server' }); db.save(); applied.push({ type: 'recording', fileId: e.fileId || null }); }
    }
    ctx.audit({ action: 'meeting_provider_event', entity: 'videoMeetings', entityId: m.id, after: { applied: applied.length, via: bySignature ? 'signature' : 'secret' } });
    return { ok: true, applied, attendance: attendanceOf(db, m.id).length };
  }, { public: true });

  /* --- nagrywanie i zgody --------------------------------------------------------------------- */
  r.post('/api/meetings/:id/recording', (ctx) => {
    const db = ctx.db; const m = getMeeting(ctx);
    if (!isHost(m, ctx.user)) throw httpError(403, 'Nagrywanie włącza prowadzący.', { code: 'not_host' });
    const wanted = !!(ctx.body && ctx.body.enabled);
    if (!m.recording) m.recording = { enabled: false, consentRequired: true, storedAt: 'school-server', fileId: null, consents: {} };
    if (!wanted) { m.recording.enabled = false; m.recording.requested = false; db.save(); ctx.audit({ action: 'meeting_recording_disabled', entity: 'videoMeetings', entityId: m.id, after: { enabled: false } }); return { ok: true, recording: view(db, m, ctx.user).recording }; }
    m.recording.requested = true;
    const blockers = m.recording.consentRequired === false ? [] : recordingBlockers(db, m);
    if (blockers.length) {
      m.recording.enabled = false; db.save();
      throw httpError(409, `Nagrywanie pozostaje wyłączone — brak zgody opiekunów: ${blockers.map((x) => x.name).join(', ')}.`, { code: 'recording_consent_missing', missing: blockers.map((x) => ({ studentId: x.studentId, name: x.name })) });
    }
    m.recording.enabled = true; m.recording.storedAt = m.recording.storedAt || 'school-server'; db.save();
    for (const uid of audienceUserIds(db, m)) if (uid !== ctx.user.id) D.notify(db, uid, 'meeting', `Spotkanie „${m.title}” będzie nagrywane. Nagranie zostaje na serwerze szkoły.`, { link: '/spotkania' });
    ctx.audit({ action: 'meeting_recording_enabled', entity: 'videoMeetings', entityId: m.id, after: { enabled: true, storedAt: m.recording.storedAt } });
    return { ok: true, recording: view(db, m, ctx.user).recording };
  }, HOSTS);

  r.post('/api/meetings/:id/recording-consent', (ctx) => {
    const db = ctx.db; const m = getMeeting(ctx); const b = ctx.body || {};
    const studentId = b.studentId || (ctx.user.role === 'student' ? ctx.user.studentId : firstVisibleChild(db, ctx.user));
    if (!studentId) throw httpError(400, 'Wskaż ucznia, którego dotyczy zgoda.', { code: 'no_student' });
    D.assertCanSeeStudent(db, ctx.user, studentId);
    const s = db.get('students', studentId);
    if (!s) throw httpError(404, 'Nie ma takiego ucznia.', { code: 'not_found' });
    /* Zgodę na nagrywanie wyraża wyłącznie osoba do tego uprawniona (consentRows.decidedBy):
       opiekun prawny ucznia niepełnoletniego albo uczeń pełnoletni. Prowadzący spotkanie nie
       może jej wyrazić „za” uczniów — inaczej wymóg zgody nie istnieje. */
    if (ctx.user.role === 'student' && !s.adult) throw httpError(403, 'Zgodę na nagrywanie wyraża opiekun ucznia niepełnoletniego.', { code: 'needs_guardian' });
    const mayDecide = s.adult ? (ctx.user.role === 'student' && ctx.user.studentId === s.id) : mayDecideForStudent(db, s).includes(ctx.user.id);
    if (!mayDecide) {
      /* Rodzic wpisany w księdze, ale bez pełnej legitymacji, dostaje własny komunikat: nie może ani
         udzielić zgody, ani jej odmówić — decyduje drugi opiekun (decyzja 7 w docs/review/round3/domain.md). */
      const st = ctx.user.role === 'parent' ? D.guardianStanding(db, ctx.user, s.id) : null;
      if (st && (s.parentIds || []).includes(ctx.user.id)) throw httpError(403, 'Zgodę na nagrywanie zajęć z udziałem ucznia wyraża opiekun w pełni uprawniony do decyzji o dziecku. Zakres dostępu tego konta został zawężony decyzją zapisaną w dokumentacji szkoły.', { code: 'not_guardian', deny: 'guardian_scope', scope: st.scope, guardianStatus: st.status });
      throw httpError(403, 'Zgodę na nagrywanie zajęć z udziałem ucznia wyraża jego opiekun prawny (albo uczeń pełnoletni) — nie pracownik szkoły.', { code: 'not_guardian' });
    }
    if (!studentsOf(db, m).some((x) => x.id === studentId)) throw httpError(400, 'Ten uczeń nie bierze udziału w spotkaniu.', { code: 'not_participant' });
    const granted = b.granted !== false;
    if (!m.recording) m.recording = { enabled: false, consentRequired: true, storedAt: 'school-server', fileId: null, consents: {} };
    if (!m.recording.consents) m.recording.consents = {};
    const before = m.recording.consents[studentId] || null;
    m.recording.consents[studentId] = { granted, at: U.now(), byUserId: ctx.user.id };
    if (!granted && m.recording.enabled) m.recording.enabled = false;
    db.save();
    ctx.audit({ action: granted ? 'meeting_recording_consent_given' : 'meeting_recording_consent_withdrawn', entity: 'videoMeetings', entityId: m.id, before, after: m.recording.consents[studentId], reason: b.reason || null });
    const blockers = recordingBlockers(db, m);
    return { ok: true, granted, missingConsents: blockers.length, recording: view(db, m, ctx.user).recording, confirmation: granted ? 'Zgoda na nagrywanie zapisana. Możesz ją wycofać do chwili rozpoczęcia nagrania.' : 'Brak zgody zapisany — nagrywanie pozostaje wyłączone.' };
  }, ANY);

  /* --- powiązania z lekcją i kursem ------------------------------------------------------------ */
  r.post('/api/meetings/:id/link-lesson', (ctx) => {
    const db = ctx.db; const m = getMeeting(ctx);
    if (!isHost(m, ctx.user)) throw httpError(403, 'Powiązanie z lekcją ustawia prowadzący.', { code: 'not_host' });
    const les = db.get('lessons', (ctx.body && ctx.body.lessonId) || '');
    if (!les) throw httpError(404, 'Nie ma takiej lekcji.', { code: 'not_found' });
    if (m.classIds && m.classIds.length && !m.classIds.includes(les.classId)) throw httpError(400, `Lekcja jest w klasie ${les.classId}, a spotkanie dotyczy klasy ${m.classIds.join(', ')}.`, { code: 'class_mismatch' });
    const before = { lessonId: m.lessonId };
    m.lessonId = les.id; les.meetingId = m.id; les.remote = true; db.save();
    ctx.audit({ action: 'meeting_linked_to_lesson', entity: 'lessons', entityId: les.id, before, after: { meetingId: m.id } });
    return { ok: true, meeting: view(db, m, ctx.user), lesson: { id: les.id, date: les.date, lessonNo: les.lessonNo, classId: les.classId, subjectId: les.subjectId, meetingId: les.meetingId, remote: true } };
  }, HOSTS);

  r.post('/api/meetings/:id/link-course', (ctx) => {
    const db = ctx.db; const m = getMeeting(ctx); const b = ctx.body || {};
    if (!isHost(m, ctx.user)) throw httpError(403, 'Powiązanie z kursem ustawia prowadzący.', { code: 'not_host' });
    const courseId = String(b.courseId || '').trim();
    if (!courseId) throw httpError(400, 'Podaj identyfikator kursu.', { code: 'no_course' });
    const before = { courseId: m.courseId, courseItemId: m.courseItemId || null };
    m.courseId = courseId; m.courseItemId = b.itemId || null; db.save();
    const item = b.itemId ? db.get('courseItems', b.itemId) : null;
    if (item) { item.meetingId = m.id; db.save(); }
    ctx.audit({ action: 'meeting_linked_to_course', entity: 'videoMeetings', entityId: m.id, before, after: { courseId, courseItemId: m.courseItemId } });
    return { ok: true, meeting: view(db, m, ctx.user), linkedItem: item ? item.id : null };
  }, HOSTS);

  /* --- obecność ---------------------------------------------------------------------------------- */
  r.get('/api/meetings/:id/attendance', (ctx) => {
    const db = ctx.db; const m = getMeeting(ctx);
    if (!isHost(m, ctx.user)) throw httpError(403, 'Listę obecności widzi prowadzący.', { code: 'not_host' });
    const rows = attendanceOf(db, m.id).map((a) => {
      const u = db.get('users', a.userId);
      return { userId: a.userId, name: D.userLabel(u), role: u ? u.role : null, joinedAt: a.joinedAt, leftAt: a.leftAt, minutes: a.minutes, via: a.via };
    }).sort((a, b) => (a.joinedAt < b.joinedAt ? -1 : 1));
    const expected = audienceUserIds(db, m);
    const presentIds = new Set(rows.map((x) => x.userId));
    return {
      meetingId: m.id, title: m.title, status: m.status, rows,
      present: presentIds.size, expected: expected.length,
      absent: expected.filter((u) => !presentIds.has(u)).map((u) => ({ userId: u, name: D.userLabel(db.get('users', u)) })),
      totalMinutes: rows.reduce((s, x) => s + (x.minutes || 0), 0),
      note: 'Obecność zapisuje się przy wejściu z dziennika oraz ze zdarzeń serwera wideo. Nie zastępuje frekwencji na lekcji.'
    };
  }, HOSTS);

  /* --- konfiguracja administratora (sekret nigdy nie wraca) ---------------------------------------- */
  const adminView = (db) => {
    const raw = (db.data.config.video || {});
    const cfg = V.videoConfig(db);
    return {
      provider: cfg.provider,
      jitsi: { domain: cfg.jitsi.domain || '', appId: cfg.jitsi.appId || '', appSecretSet: !!(raw.jitsi && raw.jitsi.appSecret), domainFromEnv: !!process.env.EDMAT_JITSI_DOMAIN },
      bbb: { url: cfg.bbb.url || '', secretSet: !!(raw.bbb && raw.bbb.secret) },
      eventSecretSet: !!cfg.eventSecret,
      recordingConsentRequired: cfg.recordingConsentRequired, storedAt: cfg.storedAt,
      placeholderDomain: V.isPlaceholderDomain(cfg.jitsi.domain),
      providers: V.PROVIDERS,
      csp: cfg.provider === 'jitsi' && !V.isPlaceholderDomain(cfg.jitsi.domain)
        ? `Dodaj https://${cfg.jitsi.domain} do script-src, frame-src, connect-src i media-src w nagłówku CSP (server/index.js).` : null,
      note: 'Sekrety zapisujemy, ale nigdy ich nie zwracamy. Test konfiguracji sprawdza wyłącznie format — dziennik nie łączy się z serwerem wideo.'
    };
  };
  r.get('/api/admin/video', (ctx) => adminView(ctx.db), ADMIN_READ);

  r.patch('/api/admin/video', (ctx) => {
    const db = ctx.db; const b = ctx.body || {};
    const cur = db.data.config.video || {};
    const next = {
      provider: b.provider !== undefined ? String(b.provider) : (cur.provider || 'jitsi'),
      jitsi: Object.assign({ domain: '', appId: '', appSecret: '' }, cur.jitsi || {}),
      bbb: Object.assign({ url: '', secret: '' }, cur.bbb || {})
    };
    if (b.jitsi) {
      if (b.jitsi.domain !== undefined) next.jitsi.domain = String(b.jitsi.domain).trim();
      if (b.jitsi.appId !== undefined) next.jitsi.appId = String(b.jitsi.appId).trim();
      if (b.jitsi.appSecret !== undefined && b.jitsi.appSecret !== '') next.jitsi.appSecret = b.jitsi.appSecret === null ? '' : String(b.jitsi.appSecret);
    }
    if (b.bbb) {
      if (b.bbb.url !== undefined) next.bbb.url = String(b.bbb.url).trim();
      if (b.bbb.secret !== undefined && b.bbb.secret !== '') next.bbb.secret = b.bbb.secret === null ? '' : String(b.bbb.secret);
    }
    const check = V.validateConfig(next);
    if (!check.ok) throw httpError(400, check.errors.join(' '), { code: 'invalid_config', errors: check.errors });
    const before = { provider: cur.provider, domain: (cur.jitsi || {}).domain, appId: (cur.jitsi || {}).appId, appSecretSet: !!(cur.jitsi || {}).appSecret, bbbUrl: (cur.bbb || {}).url, bbbSecretSet: !!(cur.bbb || {}).secret };
    db.data.config.video = Object.assign({}, cur, next);
    if (b.recordingConsentRequired !== undefined) db.data.config.video.recordingConsentRequired = b.recordingConsentRequired !== false;
    db.save();
    ctx.audit({ action: 'video_config_updated', entity: 'config', entityId: 'video', before, after: { provider: next.provider, domain: next.jitsi.domain, appId: next.jitsi.appId, appSecretSet: !!next.jitsi.appSecret, bbbUrl: next.bbb.url, bbbSecretSet: !!next.bbb.secret } });
    return Object.assign({ ok: true, warnings: check.warnings }, adminView(db));
  }, ADMIN);

  /* Test konfiguracji: wyłącznie walidacja formatu, bez żadnego połączenia sieciowego. */
  r.post('/api/admin/video/test', (ctx) => {
    const db = ctx.db; const b = ctx.body || {};
    const cur = V.videoConfig(db);
    const next = {
      provider: b.provider || cur.provider,
      jitsi: Object.assign({}, cur.jitsi, (b.jitsi || {})),
      bbb: Object.assign({}, cur.bbb, (b.bbb || {}))
    };
    const check = V.validateConfig(next);
    const sample = { id: 'me_test', kind: 'lesson', room: 'edmat-test-room', title: 'Test', waitingRoom: true, recording: { enabled: false } };
    const preview = next.provider === 'bbb'
      ? V.bbbJoinUrl(next, sample, { id: 'u_test', name: 'Test' }, { moderator: true }).replace(/checksum=[0-9a-f]+/, 'checksum=…')
      : next.provider === 'none' ? '(adres podaje nauczyciel przy każdym spotkaniu)'
        : `https://${next.jitsi.domain}/${V.roomName(sample)}` + (next.jitsi.appId && next.jitsi.appSecret ? '?jwt=…' : '');
    return {
      ok: check.ok, errors: check.errors, warnings: check.warnings, preview,
      jwt: next.provider === 'jitsi' && next.jitsi.appId && next.jitsi.appSecret ? { alg: 'HS256', iss: next.jitsi.appId, aud: 'jitsi', sub: next.jitsi.domain } : null,
      networkCall: false,
      note: 'Sprawdzono wyłącznie format. Dziennik nie wysłał żadnego zapytania do serwera wideo.'
    };
  }, ADMIN);
}

module.exports = { register, createMeeting, cancelMeeting, isCancellable, canJoin, inAudience, isGuardianOfAudience, studentsOf, audienceUserIds, consentRows, recordingBlockers, KINDS, POLICIES, STATUSES };
