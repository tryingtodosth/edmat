'use strict';
/* "Zgłoś błąd" — the site's own issue reporter, wired into this demo.
 *
 * EdMat has one place where anything wrong with the product is filed: `issues.Issue` in the Django
 * backend, reachable from the top bar and the footer of every page. This demo is a second product
 * with the same audience, so it files into the same table rather than growing a queue of its own —
 * and carries `source: 'school_demo'` plus an `area` (one of this demo's own modules, see
 * ../modules.js) so that "the grade book is wrong" and "the exercise browser is wrong" can be told
 * apart and handed to different people. `backend/issues/models.py` states the same reasoning from
 * the other side.
 *
 * Three decisions worth stating:
 *
 * - **The browser never talks to the Django API.** It posts here and this process forwards. A
 *   direct call would need CORS on an endpoint that is open to guests, would put the API's address
 *   into the page, and would break the moment the demo is shown on a laptop that cannot reach it.
 *   The demo already knows who is logged in; the proxy is also the only thing that can honestly
 *   attach the persona's role.
 * - **Every report is written here first, then forwarded.** A pilot runs on a projector in a school
 *   hall; the API being unreachable must not lose what somebody just typed. The local row records
 *   whether the hand-off happened (`forwarded`, `forwardError`, `remoteId`), so nothing silently
 *   claims to have been sent.
 * - **Failing to forward is not failing to report.** The person is told their report was saved, and
 *   `forwarded: false` travels with the response so the dialog can say the rest honestly rather
 *   than asking them to type it again.
 *
 * `EDMAT_ISSUES_API` points at the site's API root (default `http://127.0.0.1:8000/api`);
 * `EDMAT_ISSUES_FORWARD=0` turns the hand-off off entirely, for a demo run with no backend at all.
 */
const { httpError } = require('../lib/router');
const D = require('../lib/domain');
const { now } = require('../lib/util');
const modules = require('../modules');
const auth = require('../auth');

/* The kinds `issues.Issue` accepts. Mirrored rather than imported — the backend is Python — and
   pinned by tests/63-report-issue.test.js, which reads its models.py. */
const KINDS = ['bug', 'content', 'idea', 'other'];
const AREAS = modules.MODULES.map((m) => m.id);

const API_BASE = () => (process.env.EDMAT_ISSUES_API || 'http://127.0.0.1:8000/api').replace(/\/+$/, '');
const FORWARDING = () => process.env.EDMAT_ISSUES_FORWARD !== '0';

/* Kept short on purpose: this runs while somebody waits with a dialog open, and a demo whose
   backend is simply absent should say so in seconds rather than look frozen. */
const FORWARD_TIMEOUT_MS = 6000;

function clean(value, max) {
  return String(value == null ? '' : value).slice(0, max);
}

/* A `public: true` route is never handed a session — server/index.js resolves one only for routes
   that require it — so `ctx.user` is null even for somebody who is signed in. This route wants
   both at once: open to everybody, and honest about who is reporting when there is somebody to
   name. A session that has expired, or one still on the 2FA step, is nobody for this purpose:
   the first is stale and the second has not finished proving who they are, and a report is worth
   more with no role than with a role that was never established. */
function reporter(ctx) {
  let s = null;
  try { s = auth.resolveSession(ctx.db, ctx.req); } catch (e) { s = null; }
  if (!s || s.expired || !s.user || (s.session && s.session.totpPending)) return null;
  return s.user;
}

/** The body the site's own modal sends, built from what this demo knows. One function so the test
 *  can assert the shape without a live backend. */
function issuePayload(report) {
  return {
    kind: report.kind,
    source: 'school_demo',
    area: report.area || '',
    title: report.title,
    body: report.body,
    context: {
      path: report.screen,
      page_title: report.pageTitle,
      locale: report.locale,
      viewport: report.viewport,
      user_agent: report.userAgent,
      // The axis that matters most here: the same screen is a different product to a parent and to
      // a registrar. `context` rather than a column because nothing filters by it — see
      // backend/issues/serializers.py, CONTEXT_KEYS.
      role: report.role || '',
    },
    anonymous: !!report.anonymous,
    contact_email: report.anonymous ? '' : clean(report.contact, 200),
    is_public: !!report.isPublic,
  };
}

async function forward(report) {
  if (!FORWARDING()) return { forwarded: false, forwardError: 'forwarding_disabled', remoteId: null };
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FORWARD_TIMEOUT_MS);
  try {
    const res = await fetch(API_BASE() + '/issues/', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(issuePayload(report)),
      signal: controller.signal,
    });
    const text = await res.text();
    if (!res.ok) {
      /* The status and the first of the body, not the whole of it: enough for whoever reads the
         export to see a 400 from a bad area or a 429 from the throttle, without pasting a Django
         error page into the school's data file. */
      return { forwarded: false, forwardError: `http_${res.status}: ${text.slice(0, 300)}`, remoteId: null };
    }
    let remoteId = null;
    try { remoteId = String(JSON.parse(text).id); } catch (e) { remoteId = null; }
    return { forwarded: true, forwardError: null, remoteId };
  } catch (e) {
    return { forwarded: false, forwardError: (e && e.name === 'AbortError') ? 'timeout' : String((e && e.message) || e).slice(0, 300), remoteId: null };
  } finally {
    clearTimeout(timer);
  }
}

function register(r, app) {
  /* `public: true`: a reporter who cannot get past the login screen is exactly the reporter with
     the most useful thing to say. `allowPending` for the same reason — somebody stuck on the 2FA
     step or a forced password change is stuck on something worth hearing about.

     `rateLimit: true` is the price of that, for the same reason the accessibility document pays it
     (S3-03/R3-07): this is the only route in the product where somebody with no session WRITES a
     row and makes the process wait up to FORWARD_TIMEOUT_MS on an outbound call. Without the brake
     an anonymous loop from the internet is a "turn the school off" button while a teacher is taking
     attendance. The window is per address and wide enough that a person filing a real fault, even
     twice over, never meets it. */
  r.post('/api/report-issue', async (ctx) => {
    const b = ctx.body || {};
    const title = clean(b.title, 200).trim();
    if (title.length < 3) throw httpError(400, 'Wpisz krótki tytuł zgłoszenia.', { code: 'title_required' });
    const area = AREAS.includes(b.area) ? b.area : '';
    const who = reporter(ctx);
    const report = {
      kind: KINDS.includes(b.kind) ? b.kind : 'bug',
      area,
      title,
      body: clean(b.body, 4000),
      screen: clean(b.screen, 500),
      pageTitle: clean(b.pageTitle, 500),
      locale: b.locale === 'en' ? 'en' : 'pl',
      viewport: clean(b.viewport, 60),
      userAgent: clean(ctx.req.headers['user-agent'] || '', 500),
      // Never taken from the body: the client may not name somebody else's role.
      role: who ? who.role : '',
      login: who ? who.login : null,
      userId: who ? who.id : null,
      anonymous: !!b.anonymous,
      contact: b.anonymous ? '' : clean(b.contact, 200),
      isPublic: !!b.isPublic,
      at: now(),
    };
    const outcome = await forward(report);
    const row = ctx.db.insert('issueReports', Object.assign({}, report, outcome));
    ctx.audit({ action: 'issue_report', entity: 'issueReport', entityId: row.id, detail: { forwarded: outcome.forwarded, area } });
    return { ok: true, id: row.id, forwarded: outcome.forwarded, remoteId: outcome.remoteId };
  }, { public: true, rateLimit: true });

  /* Whoever runs the pilot needs to see what was filed from their own school and whether it got
     out — the site's /issues page only ever shows what reached it. */
  r.get('/api/report-issue', (ctx) => {
    const items = ctx.db.col('issueReports').slice().sort((a, b) => (a.at < b.at ? 1 : -1));
    return { items, count: items.length, pending: items.filter((x) => !x.forwarded).length, api: API_BASE(), forwarding: FORWARDING() };
  }, { roles: ['admin', 'principal'] });

  r.get('/api/report-issue/export.csv', (ctx) => ({
    __raw: true,
    contentType: 'text/csv; charset=utf-8',
    filename: 'edmat-zgloszenia.csv',
    body: D.csv(
      ctx.db.col('issueReports').map((f) => [f.at, f.kind, f.area, f.role, f.login, f.title, f.body, f.screen, f.locale, f.contact, f.forwarded ? 'tak' : 'nie', f.remoteId || '', f.forwardError || '']),
      ['at', 'kind', 'area', 'role', 'login', 'title', 'body', 'screen', 'locale', 'contact', 'forwarded', 'remoteId', 'forwardError'],
    ),
  }), { roles: ['admin', 'principal'] });
}

module.exports = { register, KINDS, AREAS, issuePayload };
