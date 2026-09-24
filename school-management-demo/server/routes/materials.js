'use strict';
/* Współpraca nad materiałami z lekcji — na wzór strony treści („ContentDetail”) w 2donet: materiał jest
   treścią, która ma właściciela, może być otwarta na współpracę (`coopAllowed`, domyślnie tak), zbiera
   zgłoszenia współpracowników (`coopClaims` — „claim” z 2donet: nauczyciel bierze na siebie kawałek pracy nad
   materiałem i mówi jaki), ma dyskusję (komentarze przez wspólny mechanizm `log-comments`, rodzaj `materials`)
   i oś czasu z rejestru zdarzeń. Sam plik i pobieranie zostają w routes/student.js (`GET /api/materials/:id`);
   tutaj są wyłącznie metadane i współpraca — żadna trasa z tego pliku nie zwraca `dataUrl`. */
const { httpError } = require('../lib/router');
const D = require('../lib/domain');
const LA = require('../lib/log-access');
const util = require('../lib/util');

/* Kto pracuje nad materiałami dydaktycznymi: nauczyciele i kadra pedagogiczna. Sekretariat, administrator, IOD
   i moduły uzupełniające widzą metadane w rejestrach, ale nie zgłaszają się do współpracy. */
const COOP_ROLES = ['teacher', 'principal', 'supportTeacher', 'librarian', 'counselor', 'psychologist', 'specialEducator', 'speechTherapist'];
const MAX_NOTE = 300, MAX_DESC = 1000, MAX_NAME = 160;

const claimsOf = (m) => (Array.isArray(m.coopClaims) ? m.coopClaims : []);
const coopAllowed = (m) => m.coopAllowed !== false;                 // stare wiersze bez pola = otwarte („set to true”)
function userRef(db, uid) { const u = db.get('users', uid); return u ? { id: u.id, name: D.userLabel(u), role: u.role } : null; }
function subjectName(db, sid) { const s = sid ? db.get('subjects', sid) : null; return s ? s.name : (sid || ''); }
function commentCount(db, m) { return db.col('logComments').filter((c) => c.kind === 'materials' && c.entryId === m.id && !c.deleted && !c.private).length; }

function view(db, m, user) {
  const l = m.lessonId ? db.get('lessons', m.lessonId) : null;
  const claims = claimsOf(m).map((c) => ({ userId: c.userId, at: c.at, note: c.note || '', user: userRef(db, c.userId) }));
  const mine = m.byUserId === user.id, claimedByMe = claims.some((c) => c.userId === user.id);
  return {
    id: m.id, name: m.name, type: m.type, size: m.size || (m.dataUrl || '').length, at: m.at || m.createdAt, description: m.description || '',
    subjectId: m.subjectId || (l && l.subjectId) || null, subject: subjectName(db, m.subjectId || (l && l.subjectId)), classId: m.classId || (l && l.classId) || null,
    lesson: l ? { id: l.id, date: l.date, lessonNo: l.lessonNo, topic: l.topic || null } : null,
    owner: userRef(db, m.byUserId), coopAllowed: coopAllowed(m), claims, claimCount: claims.length, commentCount: commentCount(db, m),
    mine, claimedByMe, canClaim: coopAllowed(m) && !mine && !claimedByMe, canEdit: mine || user.role === 'principal',
    downloadPath: '/api/materials/' + m.id
  };
}
function mustFind(db, id) { const m = db.get('materials', id); if (!m) throw httpError(404, 'Nie ma takiego materiału.', { code: 'not_found' }); return m; }

function register(r) {
  /* Dyskusja pod materiałem: kto może współpracować, ten widzi i komentuje — także materiał zamknięty na współpracę,
     bo zamknięcie dotyczy nowych zgłoszeń, nie rozmowy o materiale, który nauczyciel i tak może pobrać. */
  LA.register('materials', { label: 'Materiały z lekcji — współpraca', roles: COOP_ROLES, find: (db, user, entryId) => db.get('materials', entryId) || null });

  r.get('/api/materials', (ctx) => {
    const db = ctx.db, q = ctx.query || {};
    let list = db.col('materials').slice();
    if (q.lessonId) list = list.filter((m) => m.lessonId === q.lessonId);
    if (q.subjectId) list = list.filter((m) => (m.subjectId || (db.get('lessons', m.lessonId) || {}).subjectId) === q.subjectId);
    const all = list.map((m) => view(db, m, ctx.user)).sort((a, b) => (a.at < b.at ? 1 : -1));
    const stats = { total: all.length, open: all.filter((m) => m.coopAllowed && !m.mine).length, mine: all.filter((m) => m.mine).length, claimed: all.filter((m) => m.claimedByMe).length, contributors: new Set(all.flatMap((m) => m.claims.map((c) => c.userId))).size };
    const f = q.filter || 'all';
    const out = f === 'open' ? all.filter((m) => m.coopAllowed && !m.mine) : f === 'mine' ? all.filter((m) => m.mine) : f === 'claimed' ? all.filter((m) => m.claimedByMe) : all;
    return { materials: out, stats, filter: f };
  }, { roles: COOP_ROLES });

  r.get('/api/materials/:id/details', (ctx) => {
    const db = ctx.db; const m = mustFind(db, ctx.params.id);
    /* Oś czasu z rejestru zdarzeń: wgranie, zgłoszenia, wycofania, zmiany ustawień. Pobrania przez uczniów to dane
       osobowe uczniów — wchodzą wyłącznie jako liczba. */
    const rows = db.col('audit').filter((a) => a.entity === 'material' && a.entityId === m.id);
    const timeline = rows.filter((a) => a.action !== 'material_downloaded').map((a) => ({ at: a.at, action: a.action, user: userRef(db, a.userId), note: (a.after && a.after.note) || null, coopAllowed: a.after && typeof a.after.coopAllowed === 'boolean' ? a.after.coopAllowed : undefined })).sort((a, b) => (a.at < b.at ? -1 : 1));
    if (!rows.some((a) => a.action === 'material_uploaded')) timeline.unshift({ at: m.at || m.createdAt, action: 'material_uploaded', user: userRef(db, m.byUserId), note: null });
    return Object.assign(view(db, m, ctx.user), { timeline, downloads: rows.filter((a) => a.action === 'material_downloaded').length, commentsPath: '/api/log-comments/materials/' + m.id, maxNote: MAX_NOTE, maxDescription: MAX_DESC });
  }, { roles: COOP_ROLES });

  r.post('/api/materials/:id/claim', (ctx) => {
    const db = ctx.db; const m = mustFind(db, ctx.params.id); const b = ctx.body || {};
    if (!coopAllowed(m)) throw httpError(409, 'Autor zamknął ten materiał na współpracę.', { code: 'coop_closed' });
    if (m.byUserId === ctx.user.id) throw httpError(409, 'To Twój materiał — zgłaszają się do niego inni.', { code: 'own_material' });
    if (claimsOf(m).some((c) => c.userId === ctx.user.id)) throw httpError(409, 'Już zgłosiłeś(-aś) się do tego materiału.', { code: 'already_claimed' });
    const note = String(b.note || '').trim().slice(0, MAX_NOTE);
    const claim = { userId: ctx.user.id, at: util.now(), note };
    db.update('materials', m.id, { coopClaims: claimsOf(m).concat([claim]) });
    ctx.audit({ action: 'material_claimed', entity: 'material', entityId: m.id, after: { note, name: m.name } });
    if (m.byUserId) D.notify(db, m.byUserId, 'material', `${D.userLabel(ctx.user)} zgłasza się do współpracy nad „${m.name}”${note ? ': ' + note : '.'}`, { link: '#/wspolpraca?m=' + m.id, dedupeKey: 'claim:' + m.id + ':' + ctx.user.id });
    return { ok: true, material: view(db, db.get('materials', m.id), ctx.user) };
  }, { roles: COOP_ROLES });

  r.delete('/api/materials/:id/claim', (ctx) => {
    const db = ctx.db; const m = mustFind(db, ctx.params.id);
    if (!claimsOf(m).some((c) => c.userId === ctx.user.id)) throw httpError(404, 'Nie ma Twojego zgłoszenia przy tym materiale.', { code: 'no_claim' });
    db.update('materials', m.id, { coopClaims: claimsOf(m).filter((c) => c.userId !== ctx.user.id) });
    ctx.audit({ action: 'material_claim_released', entity: 'material', entityId: m.id, after: { name: m.name } });
    return { ok: true, material: view(db, db.get('materials', m.id), ctx.user) };
  }, { roles: COOP_ROLES });

  r.patch('/api/materials/:id', (ctx) => {
    const db = ctx.db; const m = mustFind(db, ctx.params.id); const b = ctx.body || {};
    if (m.byUserId !== ctx.user.id && ctx.user.role !== 'principal') throw httpError(403, 'Ustawienia materiału zmienia jego autor albo dyrekcja.', { code: 'forbidden' });
    const patch = {}; const before = {}, after = {};
    if (typeof b.coopAllowed === 'boolean' && b.coopAllowed !== coopAllowed(m)) { patch.coopAllowed = b.coopAllowed; before.coopAllowed = coopAllowed(m); after.coopAllowed = b.coopAllowed; }
    if (typeof b.description === 'string') { const d = b.description.trim().slice(0, MAX_DESC); if (d !== (m.description || '')) { patch.description = d; before.description = m.description || ''; after.description = d; } }
    if (typeof b.name === 'string') { const n = b.name.trim().slice(0, MAX_NAME); if (!n) throw httpError(400, 'Nazwa materiału nie może być pusta.', { code: 'no_name' }); if (n !== m.name) { patch.name = n; before.name = m.name; after.name = n; } }
    if (Object.keys(patch).length) { db.update('materials', m.id, patch); ctx.audit({ action: 'material_updated', entity: 'material', entityId: m.id, before, after }); }
    return { ok: true, material: view(db, db.get('materials', m.id), ctx.user) };
  }, { roles: COOP_ROLES });
}
module.exports = { register, COOP_ROLES, view };
