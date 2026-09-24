'use strict';
const { httpError } = require('../lib/router'); const modules = require('../modules');
function register(r) {
  r.get('/api/modules', (ctx) => ({ modules: modules.list(ctx.db), locale: ctx.user.locale || 'pl' }));
  r.patch('/api/admin/modules', (ctx) => {
    const en = (ctx.body || {}).enabled || {}; const cfg = ctx.db.data.config; cfg.modules = cfg.modules || { enabled: {} };
    for (const m of modules.MODULES) { if (!(m.id in en)) continue; if (m.required && en[m.id] === false) throw httpError(400, `Moduł „${m.name.pl}” jest wymagany i nie może zostać wyłączony.`, { code: 'module_required', module: m.id }); cfg.modules.enabled[m.id] = !!en[m.id]; }
    ctx.db.save(); ctx.audit({ action: 'modules_changed', entity: 'config', entityId: 'modules', after: cfg.modules.enabled });
    return { modules: modules.list(ctx.db) };
  }, { roles: ['admin', 'principal'] });
}
module.exports = { register };
