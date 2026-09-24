'use strict';
/* Module registry: every feature area is a module that can be enabled per school. Routes declare `module.exports.module = '<id>'`
   (default 'core'); screens declare `module: '<id>'` in EdApp.screen(). config.modules = { enabled: { id: bool } }. */
const MODULES = [
  { id: 'core', name: { pl: 'Rdzeń (logowanie, sesje, audyt)', en: 'Core (login, sessions, audit)' }, required: true },
  { id: 'logbook', name: { pl: 'Dziennik lekcyjny (frekwencja, tematy, zadania)', en: 'Lesson logbook (attendance, topics, homework)' }, required: true },
  { id: 'grades', name: { pl: 'Oceny i uwagi', en: 'Grades and remarks' }, required: true },
  { id: 'homeroom', name: { pl: 'Wychowawca i klasyfikacja', en: 'Homeroom and classification' } },
  { id: 'principal', name: { pl: 'Dyrekcja: zastępstwa, nadzór, audyt', en: 'Principal: substitutions, supervision, audit' } },
  { id: 'support', name: { pl: 'Pomoc psychologiczno-pedagogiczna', en: 'Psychological and pedagogical support' } },
  { id: 'registry', name: { pl: 'Sekretariat i administracja', en: 'Registrar and administration' }, required: true },
  { id: 'student', name: { pl: 'Konto ucznia', en: 'Student account' } },
  { id: 'parent', name: { pl: 'Konto rodzica', en: 'Parent account' } },
  { id: 'messages', name: { pl: 'Wiadomości i powiadomienia', en: 'Messages and notifications' }, required: true },
  { id: 'school', name: { pl: 'Świetlica, stołówka, wycieczki, biblioteka, gabinet', en: 'After-school care, cafeteria, trips, library, nurse' } },
  { id: 'courses', name: { pl: 'Kursy i materiały (LMS)', en: 'Courses and materials (LMS)' } },
  { id: 'meetings', name: { pl: 'Spotkania wideo (Jitsi / BigBlueButton, self-hosted)', en: 'Video meetings (Jitsi / BigBlueButton, self-hosted)' } },
  { id: 'compliance', name: { pl: 'Pakiet zgodności: DPIA, deklaracja dostępności, umowa powierzenia', en: 'Compliance pack: DPIA, accessibility statement, processing agreement' } },
  { id: 'demo', name: { pl: 'Tryb demonstracyjny i zbieranie opinii', en: 'Demo mode and feedback collection' } },
];
const ROUTE_MODULE = { attendance: 'logbook', lessons: 'logbook', homework: 'logbook', materials: 'logbook', grades: 'grades', remarks: 'grades', homeroom: 'homeroom', principal: 'principal', substitutions: 'principal', support: 'support', registry: 'registry', admin: 'registry', 'school-year': 'registry', privacy: 'registry', retention: 'registry', student: 'student', parent: 'parent', messages: 'messages', notifications: 'messages', modules: 'school', courses: 'courses', meetings: 'meetings', compliance: 'compliance', demo: 'demo' };
function enabledMap(db) {
  const cfg = db.data.config; if (!cfg.modules) cfg.modules = { enabled: {} };
  const out = {}; for (const m of MODULES) out[m.id] = m.required || cfg.modules.enabled[m.id] !== false; return out;
}
function isEnabled(db, id) { return enabledMap(db)[id] !== false; }
function moduleOfRouteFile(file) { const base = file.replace(/\.js$/, ''); return ROUTE_MODULE[base] || 'core'; }
function list(db) { const en = enabledMap(db); return MODULES.map((m) => Object.assign({}, m, { enabled: en[m.id] })); }
module.exports = { MODULES, enabledMap, isEnabled, moduleOfRouteFile, list };
