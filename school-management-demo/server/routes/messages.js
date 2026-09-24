'use strict';
/* Wiadomości wewnętrzne dziennika — wspólne dla wszystkich ról (3.6.9, 3.7, 3.3…).
   Zasady: rozmowa zostaje w dzienniku, nigdy nie pokazujemy numerów telefonów ani adresów e-mail drugiej strony,
   rodzic pisze wyłącznie do nauczycieli swojego dziecka (config.messaging.parentsCanMessage),
   uczeń do swoich nauczycieli, a wiadomości poufne widzą tylko nadawca i adresaci. */
const { httpError } = require('../lib/router');
const D = require('../lib/domain');
const util = require('../lib/util');
const { validateUploads } = require('../lib/uploads');
const N = require('./notifications');

const ROLE_LABEL = { teacher: 'nauczyciel', principal: 'dyrekcja', counselor: 'pedagog', psychologist: 'psycholog', specialEducator: 'pedagog specjalny', speechTherapist: 'logopeda', supportTeacher: 'nauczyciel wspomagający', registrar: 'sekretariat', admin: 'administrator', student: 'uczeń', parent: 'rodzic', careEducator: 'świetlica', cafeteria: 'stołówka', librarian: 'biblioteka', nurse: 'gabinet profilaktyczny', dpo: 'inspektor ochrony danych' };
const ALWAYS_OPEN = ['counselor', 'psychologist'];                 // pedagog i psycholog są dostępni zawsze
const OPEN_TO_STUDENTS = ALWAYS_OPEN.concat(['librarian', 'nurse', 'principal']);

/* ---- R7: wiadomość w dzienniku NIE jest doręczeniem (wiersz 24 triage'u) ----------------------
   Szkoły są w e-Doręczeniach od 1.01.2025, a decyzja administracyjna doręczona czatem dziennika nie
   jest doręczona wcale. Nie budujemy integracji z e-Doręczeniami — oznaczamy tylko, kiedy treść
   wygląda na decyzję, żeby nikt nie wysłał jej stąd w przekonaniu, że załatwił sprawę.
   `formal` jest domyślnie `false`; rodzaje poniżej ustawiają je same, dyrektor może ustawić jawnie. */
const FORMAL_KINDS = ['decision', 'expulsion', 'scholarship', 'appeal', 'disciplinary'];
/** Zdanie, które widzi nadawca w oknie pisania i każdy czytelnik przy wiadomości (klient ma je w pl+en). */
const FORMAL_NOTICE = 'To nie jest doręczenie administracyjne (e-Doręczenia). Decyzje formalne doręcza się w trybie KPA.';
const FORMAL_NOTICE_EN = 'This is not an administrative delivery (e-Doręczenia). Formal decisions must be delivered under KPA.';
/** Czy ta wiadomość jest „decyzją administracyjną”: jawna flaga dyrektora albo rodzaj z listy. */
const isFormalMessage = (kind, flag) => flag === true || FORMAL_KINDS.includes(String(kind || ''));

/* ---- U3-14: zdania serwera idą w języku czytelnika ------------------------------------------
   `policy.note` i `m.note` były zaszyte po polsku i trafiały do angielskiego builda dosłownie —
   a przy piśmie „formalnym” ekran pokazywał to samo zdanie dwa razy, raz po angielsku w banerze
   i raz po polsku w stopce. Język bierzemy z konta (`users[].locale`, ustawiane przez
   `POST /api/auth/locale`), a `?locale=` nadpisuje go tak samo jak w `/api/compliance`. */
const NOTES = {
  policy: { pl: 'Dane kontaktowe (telefon, e-mail) nie są udostępniane w wiadomościach.',
    en: 'Contact details (phone, e-mail) are never disclosed in logbook messages.' },
  thread: { pl: 'Rozmowa zostaje w dzienniku. Nie udostępniamy numerów telefonów ani adresów e-mail żadnej ze stron.',
    en: 'The conversation stays inside the logbook. We disclose neither phone numbers nor e-mail addresses of either party.' },
  formal: { pl: FORMAL_NOTICE, en: FORMAL_NOTICE_EN }
};
/** Język odpowiedzi: `?locale=` > język konta > polski. */
function localeOf(ctx) {
  const q = ctx && ctx.query ? ctx.query.locale : null;
  if (q === 'en' || q === 'pl') return q;
  return ctx && ctx.user && ctx.user.locale === 'en' ? 'en' : 'pl';
}
const note = (key, locale) => NOTES[key][locale === 'en' ? 'en' : 'pl'];

/** Nauczyciele uczący danego ucznia (plan lekcji + zrealizowane lekcje + wychowawca). */
function teachersOfStudent(db, studentId) {
  const s = db.get('students', studentId); if (!s) return [];
  const groups = db.col('groups').filter((g) => (g.studentIds || []).includes(studentId)).map((g) => g.id);
  const ids = new Set();
  for (const t of db.col('timetable')) if (t.classId === s.classId && (!t.groupId || groups.includes(t.groupId))) ids.add(t.teacherId);
  for (const l of db.col('lessons')) if (l.classId === s.classId && (!l.groupId || groups.includes(l.groupId))) { if (l.teacherId) ids.add(l.teacherId); if (l.substituteTeacherId) ids.add(l.substituteTeacherId); }
  const cls = db.get('classes', s.classId);
  if (cls) { if (cls.homeroomTeacherId) ids.add(cls.homeroomTeacherId); if (cls.actingHomeroomTeacherId) ids.add(cls.actingHomeroomTeacherId); }
  return [...ids];
}
/** Uczniowie „pod opieką” nadawcy: uczeń → on sam, rodzic → dzieci, do których ma dziś dostęp.
    D3-04 — lista szła po surowym `childrenIds`, więc rodzic pozbawiony władzy rodzicielskiej dostawał
    w „Nowa wiadomość” komplet nauczycieli dziecka i jego nazwisko w polu `context`. */
function ownStudents(db, user) {
  if (user.role === 'student') return user.studentId ? [user.studentId] : [];
  if (user.role === 'parent') return (D.visibleStudentIds(db, user) || []).slice();
  return [];
}
/**
 * S3-04 — skrzynka to drugi kanał, którym dane ucznia docierały do opiekuna mimo postanowienia sądu:
 * `isParty` pytał wyłącznie „czy jestem adresatem”. Pismo o uczniu (`m.studentId`) czyta opiekun
 * w legitymacji, której zakres ten rodzaj pisma przepuszcza — zawiadomienie o zagrożeniu oceną jest
 * pismem o ocenach, więc zakres `info` go nie obejmuje (docs/GUARDIANS.md § 1).
 */
function mayReadMessage(db, user, m) {
  if (!isParty(m, user.id)) return false;
  if (user.role !== 'parent' || !m.studentId) return true;
  const st = D.guardianStanding(db, user, m.studentId);
  return st.ok && D.guardianKindAllowed(st.scope, m.kind);
}
function subjectsLabel(db, u) {
  if (!u.subjects || !u.subjects.length) return '';
  return u.subjects.map((s) => (db.get('subjects', s) || { name: s }).name.toLowerCase()).join(', ');
}
/** Bezpieczna wizytówka osoby w wiadomości: bez e-maila, telefonu i loginu (3.6.9). */
function personRef(db, userId) {
  const u = db.get('users', userId);
  if (!u) return { id: userId, name: 'Konto usunięte', role: null, roleLabel: '—', context: '' };
  let context = subjectsLabel(db, u);
  if (u.homeroomOf) context = (context ? context + ' · ' : '') + 'wychowawca ' + u.homeroomOf;
  if (u.role === 'student') { const s = db.get('students', u.studentId); context = s ? s.classId : ''; }
  if (u.role === 'parent') context = (D.visibleStudentIds(db, u) || []).map((c) => { const s = db.get('students', c); return s ? s.firstName + ' ' + s.lastName : c; }).join(', ');
  return { id: u.id, name: D.userLabel(u), role: u.role, roleLabel: ROLE_LABEL[u.role] || u.role, context };
}
/** Czy `user` może napisać do `target`? Zwraca {ok, reason}. */
function canMessage(db, user, target) {
  if (!target || target.blocked) return { ok: false, reason: 'Konto odbiorcy jest nieaktywne.' };
  if (target.id === user.id) return { ok: false, reason: 'Nie wysyłamy wiadomości do siebie.' };
  const staff = !['student', 'parent'].includes(user.role);
  if (staff) return { ok: true };
  if (target.role === 'student' || target.role === 'parent') return { ok: false, reason: 'Wiadomości w dzienniku prowadzimy wyłącznie z pracownikami szkoły.' };
  const mine = ownStudents(db, user);
  const teachers = new Set(mine.flatMap((sid) => teachersOfStudent(db, sid)));
  if (user.role === 'student') {
    if (OPEN_TO_STUDENTS.includes(target.role)) return { ok: true };
    if (teachers.has(target.id)) return { ok: true };
    return { ok: false, reason: 'Możesz pisać do nauczycieli, którzy uczą Twoją klasę, oraz do pedagoga i psychologa.' };
  }
  // rodzic
  const mode = ((db.data.config.messaging || {}).parentsCanMessage) || 'homeroomAndSubject';
  if (ALWAYS_OPEN.includes(target.role)) return { ok: true };
  if (mode === 'all') return { ok: true };
  if (teachers.has(target.id)) return { ok: true };
  return { ok: false, reason: 'Zgodnie z ustawieniami szkoły rodzic pisze do wychowawcy i nauczycieli uczących dziecko oraz do pedagoga i psychologa.' };
}
function allowedRecipients(db, user) {
  return db.col('users').filter((u) => canMessage(db, user, u).ok).map((u) => personRef(db, u.id))
    .sort((a, b) => (a.roleLabel + a.name).localeCompare(b.roleLabel + b.name, 'pl'));
}
const isParty = (m, userId) => m.fromUserId === userId || (m.toUserIds || []).includes(userId);
function attachMeta(a) { return { name: a.name, type: a.type, size: a.size || (a.dataUrl ? a.dataUrl.length : 0) }; }
/** Widok listy: bez treści załączników i bez danych kontaktowych stron. */
function listView(db, m, userId, locale) {
  const mine = m.fromUserId === userId;
  return {
    id: m.id, threadId: m.threadId || m.id, subject: m.subject, preview: String(m.body || '').slice(0, 160), at: m.at, kind: m.kind || 'message',
    /* R7: znacznik „to nie jest doręczenie” jedzie z każdą wiadomością, także na liście. */
    formal: !!m.formal, formalNotice: m.formal ? note('formal', locale) : null,
    confidential: !!m.confidential, requiresAck: !!m.requiresAck, from: personRef(db, m.fromUserId), to: (m.toUserIds || []).map((id) => personRef(db, id)),
    unread: !mine && !(m.readBy || {})[userId], read: !!(m.readBy || {})[userId], readAt: (m.readBy || {})[userId] || null,
    acked: !!(m.ackBy || {})[userId], ackRequiredFromMe: !!m.requiresAck && !mine && !(m.ackBy || {})[userId],
    attachments: (m.attachments || []).map(attachMeta), box: mine ? 'sent' : 'inbox',
    receipt: mine ? receiptSummary(m) : null
  };
}
function receiptSummary(m) {
  const to = m.toUserIds || []; const read = to.filter((id) => (m.readBy || {})[id]).length;
  const delivered = to.filter((id) => (m.deliveredTo || []).includes(id)).length;
  const acked = to.filter((id) => (m.ackBy || {})[id]).length;
  return { state: read ? 'read' : delivered ? 'delivered' : 'pending', delivered, read, acked, recipients: to.length };
}
function detailView(db, m, userId, locale) {
  const out = listView(db, m, userId, locale);
  out.body = m.body; out.attachments = (m.attachments || []).map((a) => Object.assign(attachMeta(a), { dataUrl: a.dataUrl || null }));
  out.receipts = (m.toUserIds || []).map((id) => ({ user: personRef(db, id), delivered: (m.deliveredAt || {})[id] || ((m.deliveredTo || []).includes(id) ? m.at : null), read: (m.readBy || {})[id] || null, ack: (m.ackBy || {})[id] || null }));
  out.note = note('thread', locale);
  out.noteEn = NOTES.thread.en;
  if (out.formal) out.note = note('formal', locale) + ' ' + out.note;
  return out;
}
function markRead(db, m, userId) {
  if (m.fromUserId === userId) return m;
  m.readBy = m.readBy || {}; if (!m.readBy[userId]) { m.readBy[userId] = util.now(); db.save(); }
  return m;
}

function register(r, app) {
  /* ---- skrzynka ------------------------------------------------------------------------ */
  r.get('/api/messages', (ctx) => {
    const db = ctx.db; const me = ctx.user.id; const box = ctx.query.box || 'inbox'; const locale = localeOf(ctx);
    const q = String(ctx.query.q || '').toLowerCase();
    let rows = db.col('messages').filter((m) => mayReadMessage(db, ctx.user, m));
    if (box === 'inbox') rows = rows.filter((m) => m.fromUserId !== me);
    else if (box === 'sent') rows = rows.filter((m) => m.fromUserId === me);
    if (ctx.query.unread === '1') rows = rows.filter((m) => m.fromUserId !== me && !(m.readBy || {})[me]);
    if (q) rows = rows.filter((m) => (m.subject + ' ' + m.body).toLowerCase().includes(q));
    rows = rows.sort((a, b) => (a.at < b.at ? 1 : -1)).slice(0, +ctx.query.limit || 100);
    const all = db.col('messages').filter((m) => mayReadMessage(db, ctx.user, m));
    return {
      messages: rows.map((m) => listView(db, m, me, locale)),
      counts: { inbox: all.filter((m) => m.fromUserId !== me).length, sent: all.filter((m) => m.fromUserId === me).length, unread: all.filter((m) => m.fromUserId !== me && !(m.readBy || {})[me]).length, toAck: all.filter((m) => m.requiresAck && m.fromUserId !== me && !(m.ackBy || {})[me]).length },
      policy: { note: note('policy', locale), noteEn: NOTES.policy.en, locale, parentsCanMessage: (db.data.config.messaging || {}).parentsCanMessage || 'homeroomAndSubject',
        /* R7: klient zna listę rodzajów „decyzyjnych” i pokazuje baner, zanim ktokolwiek naciśnie „wyślij”. */
        formalKinds: FORMAL_KINDS, formalNotice: note('formal', locale), formalNoticePl: FORMAL_NOTICE, formalNoticeEn: FORMAL_NOTICE_EN,
        canSendFormal: ctx.user.role === 'principal' }
    };
  });

  /* ---- lista dozwolonych odbiorców (zasila Select w oknie „Nowa wiadomość”) ------------- */
  r.get('/api/messages/recipients', (ctx) => ({
    recipients: allowedRecipients(ctx.db, ctx.user),
    rule: ctx.user.role === 'parent' ? (((ctx.db.data.config.messaging || {}).parentsCanMessage === 'all') ? 'Rodzic może pisać do wszystkich pracowników szkoły.' : 'Rodzic pisze do wychowawcy i nauczycieli uczących dziecko oraz do pedagoga i psychologa.')
      : ctx.user.role === 'student' ? 'Piszesz do nauczycieli, którzy uczą Twoją klasę, oraz do pedagoga i psychologa.' : 'Pracownik szkoły pisze do wszystkich kont dziennika.'
  }));

  /* ---- nadzór: wiadomości poufne nie trafiają do wglądu dyrekcji ani IOD ----------------- */
  r.get('/api/messages/supervision', (ctx) => {
    const db = ctx.db;
    const rows = db.col('messages').filter((m) => !m.confidential).sort((a, b) => (a.at < b.at ? 1 : -1)).slice(0, +ctx.query.limit || 200);
    return {
      messages: rows.map((m) => ({ id: m.id, at: m.at, kind: m.kind || 'message', subject: m.subject, from: personRef(db, m.fromUserId), to: (m.toUserIds || []).map((id) => personRef(db, id)), requiresAck: !!m.requiresAck, formal: !!m.formal })),
      hiddenConfidential: db.col('messages').filter((m) => m.confidential).length,
      note: 'Wykaz obejmuje wyłącznie metadane wiadomości jawnych. Wiadomości oznaczone jako poufne są dostępne tylko nadawcy i adresatom.'
    };
  }, { roles: ['principal', 'dpo'] });

  /* ---- pojedyncza wiadomość (odczyt = potwierdzenie odczytu) ---------------------------- */
  r.get('/api/messages/:id', (ctx) => {
    const db = ctx.db; const m = db.get('messages', ctx.params.id);
    if (!m) throw httpError(404, 'Nie ma takiej wiadomości.');
    if (!isParty(m, ctx.user.id)) throw httpError(403, m.confidential ? 'Wiadomość poufna: dostęp mają wyłącznie nadawca i adresaci.' : 'Brak dostępu do tej wiadomości.', { code: 'forbidden' });
    if (!mayReadMessage(db, ctx.user, m)) throw httpError(403, 'Dostęp do danych dziecka został ograniczony decyzją zapisaną w dokumentacji szkoły.', { code: 'forbidden', deny: 'guardian_scope', scope: D.guardianStanding(db, ctx.user, m.studentId).scope });
    markRead(db, m, ctx.user.id);
    return detailView(db, m, ctx.user.id, localeOf(ctx));
  });

  /* ---- wysyłka --------------------------------------------------------------------------- */
  r.post('/api/messages', (ctx) => {
    const db = ctx.db; const b = ctx.body || {};
    const to = [...new Set((Array.isArray(b.toUserIds) ? b.toUserIds : b.toUserId ? [b.toUserId] : []).filter(Boolean))];
    if (!to.length) throw httpError(400, 'Wskaż co najmniej jednego odbiorcę.', { code: 'no_recipient' });
    const subject = String(b.subject || '').trim(); const body = String(b.body || '').trim();
    if (!subject) throw httpError(400, 'Wpisz temat wiadomości.', { code: 'no_subject' });
    if (!body) throw httpError(400, 'Wpisz treść wiadomości.', { code: 'no_body' });
    for (const id of to) {
      const target = db.get('users', id);
      const chk = canMessage(db, ctx.user, target);
      if (!chk.ok) throw httpError(403, chk.reason, { code: 'messaging_not_allowed', toUserId: id });
    }
    /* S-13: rozmiar liczymy z treści, a nie z pola `size` przysłanego przez klienta; typ musi zgadzać
       się z nagłówkiem data: i z sygnaturą pliku, a HTML/SVG/skrypt do skrzynki nie wchodzi. */
    const attachments = validateUploads(b.attachments, { maxMB: 10, maxTotalMB: 25, fallbackName: 'zalacznik' })
      .map((a) => ({ name: a.name, type: a.type, size: a.size, dataUrl: a.dataUrl }));
    const staff = !['student', 'parent'].includes(ctx.user.role);
    const kind = staff && b.kind ? String(b.kind) : 'message';
    /* R7 — pismo, które wygląda na decyzję administracyjną, wychodzi wyłącznie spod ręki dyrektora
       i zostaje oznaczone: dziennik nie doręcza w rozumieniu KPA, a nadawca musi to widzieć. */
    const formal = staff && isFormalMessage(kind, b.formal === true);
    if (formal && ctx.user.role !== 'principal') {
      throw httpError(403, `${note('formal', localeOf(ctx))} Pismo oznaczone jako decyzja („${kind}”) może wysłać wyłącznie dyrektor szkoły, i tylko jako informację o rozstrzygnięciu doręczonym osobno.`,
        { code: 'formal_requires_principal', kind, formalKinds: FORMAL_KINDS, notice: FORMAL_NOTICE, noticeEn: FORMAL_NOTICE_EN });
    }
    const at = util.now();
    const m = db.insert('messages', {
      id: util.id('msg'), fromUserId: ctx.user.id, toUserIds: to, subject, body, at, kind,
      /* Domyślnie `false`: zwykła wiadomość w dzienniku nie jest żadnym doręczeniem i nie udaje go. */
      formal: !!formal,
      confidential: !!b.confidential, requiresAck: !!(staff && b.requiresAck), readBy: {}, deliveredTo: to.slice(),
      deliveredAt: Object.fromEntries(to.map((id) => [id, at])), ackBy: {}, attachments, threadId: b.threadId || null
    });
    if (!m.threadId) { m.threadId = m.id; db.save(); }
    for (const id of to) N.createNotification(db, id, 'message', `Nowa wiadomość: ${subject}`, { link: '/wiadomosci?id=' + m.id, crisis: false });
    ctx.audit({ action: 'message_sent', entity: 'message', entityId: m.id, after: { to, subject, kind, formal: m.formal, confidential: m.confidential, requiresAck: m.requiresAck, attachments: attachments.map((a) => ({ name: a.name, size: a.size })) } });
    if (m.formal) ctx.audit({ action: 'formal_notice_sent', entity: 'message', entityId: m.id, after: { to, subject, kind, notice: FORMAL_NOTICE }, reason: 'pismo o charakterze decyzji wysłane kanałem dziennika — doręczenie nastąpiło poza systemem' });
    const locale = localeOf(ctx);
    return { ok: true, message: detailView(db, m, ctx.user.id, locale), formal: m.formal, formalNotice: m.formal ? note('formal', locale) : null,
      receipt: `Wysłano ${util.fmtDate(at)} ${at.slice(11, 16)} (czas serwera). Dostarczono do ${to.length} ${util.plural(to.length, 'odbiorcy', 'odbiorców', 'odbiorców')}.`
        + (m.formal ? ' ' + note('formal', locale) : '') };
  });

  /* ---- potwierdzenia ------------------------------------------------------------------- */
  r.post('/api/messages/:id/read', (ctx) => {
    const m = ctx.db.get('messages', ctx.params.id); if (!m) throw httpError(404, 'Nie ma takiej wiadomości.');
    if (!mayReadMessage(ctx.db, ctx.user, m)) throw httpError(403, 'Brak dostępu do tej wiadomości.', { code: 'forbidden', deny: 'guardian_scope' });
    markRead(ctx.db, m, ctx.user.id);
    return { ok: true, readAt: (m.readBy || {})[ctx.user.id] || null, receipt: receiptSummary(m) };
  });
  r.post('/api/messages/:id/ack', (ctx) => {
    const db = ctx.db; const m = db.get('messages', ctx.params.id); if (!m) throw httpError(404, 'Nie ma takiej wiadomości.');
    if (!(m.toUserIds || []).includes(ctx.user.id)) throw httpError(403, 'Potwierdzenie składa adresat wiadomości.', { code: 'forbidden' });
    if (!mayReadMessage(db, ctx.user, m)) throw httpError(403, 'Dostęp do danych dziecka został ograniczony decyzją zapisaną w dokumentacji szkoły.', { code: 'forbidden', deny: 'guardian_scope' });
    if (!m.requiresAck) throw httpError(400, 'Ta wiadomość nie wymaga potwierdzenia odbioru.', { code: 'ack_not_required' });
    m.ackBy = m.ackBy || {}; const already = m.ackBy[ctx.user.id];
    if (!already) { m.ackBy[ctx.user.id] = util.now(); markRead(db, m, ctx.user.id); db.save(); N.createNotification(db, m.fromUserId, 'ack', `Potwierdzono odbiór: ${m.subject}`, { link: '/wiadomosci?id=' + m.id }); }
    ctx.audit({ action: 'message_acked', entity: 'message', entityId: m.id, after: { at: m.ackBy[ctx.user.id] } });
    return { ok: true, ackAt: m.ackBy[ctx.user.id], receipt: `Potwierdzenie odbioru zapisano ${util.fmtDate(m.ackBy[ctx.user.id])} ${m.ackBy[ctx.user.id].slice(11, 16)}.` };
  });
}
module.exports = { register, canMessage, allowedRecipients, teachersOfStudent, personRef, mayReadMessage, NOTES, localeOf, ROLE_LABEL, FORMAL_KINDS, FORMAL_NOTICE, FORMAL_NOTICE_EN, isFormalMessage };
