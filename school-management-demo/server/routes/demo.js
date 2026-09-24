'use strict';
/* Demo mode: evaluators switch roles without passwords, read "what to try" per role, and leave feedback that the EdMat team exports. Enabled by EDMAT_DEMO=1 or config.demo.enabled. */
const fs = require('node:fs'); const path = require('node:path');
const { httpError } = require('../lib/router'); const D = require('../lib/domain'); const C = require('../lib/crypto'); const { now, id } = require('../lib/util');
const PERSONAS = [
  { login: 'j.nowak', role: 'teacher', pl: 'Nauczycielka matematyki, wychowawczyni 7b', en: 'Maths teacher, homeroom teacher of 7b' },
  { login: 'a.wojcik', role: 'teacher', pl: 'Nauczyciel fizyki i informatyki', en: 'Physics and IT teacher' },
  { login: 'dyrektor', role: 'principal', pl: 'Dyrektor szkoły', en: 'School principal' },
  { login: 'e.zielinska', role: 'psychologist', pl: 'Psycholog szkolny', en: 'School psychologist' },
  { login: 'pedagog', role: 'counselor', pl: 'Pedagog szkolny', en: 'School counsellor' },
  { login: 'sekretariat', role: 'registrar', pl: 'Sekretariat', en: 'Registrar' },
  { login: 'admin', role: 'admin', pl: 'Administrator systemu', en: 'System administrator' },
  { login: 'anna.kowalczyk', role: 'student', pl: 'Uczennica klasy 7b', en: 'Student, class 7b' },
  { login: 'rodzic.kowalczyk', role: 'parent', pl: 'Rodzic dwojga dzieci (7b i 3a)', en: 'Parent of two children (7b and 3a)' },
  { login: 'swietlica', role: 'careEducator', pl: 'Wychowawca świetlicy', en: 'After-school care educator' },
  { login: 'stolowka', role: 'cafeteria', pl: 'Intendent stołówki', en: 'Cafeteria manager' },
  { login: 'biblioteka', role: 'librarian', pl: 'Bibliotekarka', en: 'Librarian' },
  { login: 'pielegniarka', role: 'nurse', pl: 'Pielęgniarka szkolna', en: 'School nurse' }];
const SECTION_ROLE = { '3.1': ['teacher'], '3.2': ['teacher'], '3.3': ['principal'], '3.4': ['counselor', 'psychologist', 'specialEducator', 'speechTherapist', 'supportTeacher'], '3.5': ['registrar', 'admin'], '3.6': ['student'], '3.7': ['parent'], '3.8': ['careEducator', 'cafeteria', 'librarian', 'nurse', 'teacher'], '3.9': ['admin', 'student', 'parent', 'teacher'] };
let guideCache = null;
function loadGuide() {
  if (guideCache) return guideCache;
  const root = path.join(__dirname, '..', '..');  /* the demo's own root: checklist.md and checklist_pl.md travelled in with it (2026-09-24) */ const read = (f) => { try { return fs.readFileSync(path.join(root, f), 'utf8'); } catch (e) { return ''; } };
  const parse = (txt) => { const out = {}; let sec = null, n = 0; for (const line of txt.split('\n')) { const hm = /^## (3\.\d+)\s*(.*)$/.exec(line); if (hm) { sec = hm[1]; n = 0; out[sec] = { title: hm[2].trim(), items: [] }; continue; } const im = /^- \[( |x)\] (.*)$/.exec(line); if (im && sec) { n++; out[sec].items.push({ id: `${sec}.${n}`, done: im[1] === 'x', text: im[2] }); } } return out; };
  guideCache = { en: parse(read('checklist.md')), pl: parse(read('checklist_pl.md')) }; return guideCache;
}
function demoEnabled(db) { return process.env.EDMAT_DEMO === '1' || !!(db.data.config.demo && db.data.config.demo.enabled); }
function register(r, app) {
  app.sessionExtras.push((ctx) => ({ demo: demoEnabled(ctx.db) ? { enabled: true, personas: PERSONAS } : null }));
  r.get('/api/demo/personas', (ctx) => { if (!demoEnabled(ctx.db)) throw httpError(404, 'Tryb demo jest wyłączony.'); return { personas: PERSONAS }; }, { public: true });
  r.post('/api/demo/switch', (ctx) => {
    if (!demoEnabled(ctx.db)) throw httpError(404, 'Tryb demo jest wyłączony.');
    const persona = PERSONAS.find((p) => p.login === (ctx.body || {}).login); if (!persona) throw httpError(400, 'Nieznana rola demo.');
    const u = ctx.db.one('users', (x) => x.login === persona.login); if (!u) throw httpError(404, 'Brak konta demo.');
    const s = { id: id('ses'), token: C.token(), userId: u.id, createdAt: now(), lastActivity: now(), ip: ctx.ip, client: 'demo', totpPending: false, revoked: false }; ctx.db.col('sessions').push(s); ctx.db.save();
    ctx.audit({ action: 'demo_switch', userId: u.id, entity: 'session', entityId: s.id });
    ctx.setCookie(require('../auth').cookieHeader(s.token, !!app.options.secureCookies, 60 * 60 * 4)); return { user: require('../auth').publicUser(u) };
  }, { public: true });
  r.get('/api/demo/guide', (ctx) => {
    const role = ctx.query.role || ctx.user.role; const loc = ctx.query.locale === 'en' ? 'en' : 'pl'; const g = loadGuide()[loc];
    const sections = Object.keys(g).filter((k) => (SECTION_ROLE[k] || []).includes(role) || (k === '3.2' && role === 'teacher')).map((k) => ({ id: k, title: g[k].title, items: g[k].items }));
    return { role, locale: loc, sections };
  });
  r.post('/api/demo/reset', (ctx) => { if (!demoEnabled(ctx.db)) throw httpError(404, 'Tryb demo jest wyłączony.'); const keep = { feedback: ctx.db.col('feedback').slice() }; ctx.db.data = {}; require('../index').reseed(ctx.db); ctx.db.data.feedback = keep.feedback; ctx.db.save(); return { ok: true, reseededAt: now() }; }, { roles: ['admin', 'principal'] });
  r.post('/api/feedback', (ctx) => {
    const b = ctx.body || {}; if (!b.body || String(b.body).trim().length < 3) throw httpError(400, 'Wpisz treść opinii.');
    const f = ctx.db.insert('feedback', { userId: ctx.user ? ctx.user.id : null, role: ctx.user ? ctx.user.role : (b.role || null), login: ctx.user ? ctx.user.login : null, screen: String(b.screen || '').slice(0, 200), locale: b.locale === 'en' ? 'en' : 'pl', rating: Math.max(1, Math.min(5, +b.rating || 0)) || null, kind: ['bug', 'idea', 'praise', 'question'].includes(b.kind) ? b.kind : 'idea', body: String(b.body).slice(0, 4000), contact: String(b.contact || '').slice(0, 200), userAgent: String(ctx.req.headers['user-agent'] || '').slice(0, 200), at: now() });
    return { ok: true, id: f.id };
  }, { allowPending: true });
  r.get('/api/feedback', (ctx) => ({ items: ctx.db.col('feedback').slice().sort((a, b) => (a.at < b.at ? 1 : -1)), count: ctx.db.col('feedback').length }), { roles: ['admin', 'principal'] });
  r.get('/api/feedback/export.csv', (ctx) => ({ __raw: true, contentType: 'text/csv; charset=utf-8', filename: 'edmat-feedback.csv', body: D.csv(ctx.db.col('feedback').map((f) => [f.at, f.role, f.login, f.screen, f.locale, f.rating, f.kind, f.body, f.contact]), ['at', 'role', 'login', 'screen', 'locale', 'rating', 'kind', 'body', 'contact']) }), { roles: ['admin', 'principal'] });
}
module.exports = { register, PERSONAS, demoEnabled };
