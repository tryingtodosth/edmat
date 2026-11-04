// Goals and their definitions of done (`backend/goals/`), plus the two smaller asks that landed
// with them on 2026-10-08: the thread under an organisation's description on `/about`, and the
// plan page's step EDIT form, which set its state and drew nothing.
//
// Run: E2E_BASE=http://localhost:5173 E2E_API=http://localhost:8000 \
//      E2E_STAFF_TOKEN=<admin's token> E2E_USER_TOKEN=<student1's token> \
//      E2E_OWNER_TOKEN=<a token of somebody who MANAGES the organisation> \
//      node e2e/goals.mjs
//
// Tokens rather than the login form (`e2e/CLAUDE.md` trap 30): the DRF token is one per user and
// stable, and several scripts signing in as the same account in an hour burn the throttle for all
// of them.
//
// **`E2E_OWNER_TOKEN` is not optional and cannot be logged in for.** Writing a goal is a node
// MANAGER's action, and `config/nodes.py: can_manage_node` has no `is_staff` bypass — platform
// staff are not automatically owners of an organisation, and on the dev database the `edmat`
// organisation's only owner is `piotrek`, whose password is not the seeded one. That is the rule
// working, not a gap: a moderator may moderate an organisation's content and still not speak for
// it. Left unset, the script falls back to the staff token and says plainly that the refusal it
// then gets is this.
//
// What it drives, through the real API and then in a real browser:
//   * `met` is DERIVED — ticking the last open condition meets the goal, un-ticking re-opens it,
//     a hand-written `met` is 400 and `met -> open` is 409;
//   * the goal's thread (`goals/<id>`) and the organisation's own (`organizations/edmat`) both
//     answer, which is the "and also commentable" half of the ask;
//   * on `/about`, the Goals panel draws the goal, its conditions as checkboxes, and a collapsed
//     thread line — and the description block has one of its own;
//   * on `/goals/<id>`, the same card and a thread;
//   * on `/plans/<id>`, clicking a step's "Edit" opens a form CAPTIONED with that step's title.
//
// It cleans up after itself: the goal it writes is deleted at the end, which the server allows
// only because nothing points at it and nobody commented under it (`rules.delete_block_reason`).
// It deliberately posts NO comment, for exactly that reason — the collapsed line is the thing to
// look at, and it is drawn whether or not the thread has anything in it.
let chromium;
try {
	({ chromium } = await import('playwright-core'));
} catch {
	console.error('playwright-core is not installed');
	process.exit(1);
}
import { englishContext } from './english.mjs';

const BASE = process.env.E2E_BASE ?? 'http://localhost:5173';
const API = process.env.E2E_API ?? 'http://localhost:8000';
const STAFF = {
	username: process.env.E2E_STAFF ?? 'admin',
	password: process.env.E2E_STAFF_PW ?? 'password123'
};
const PLAIN = {
	username: process.env.E2E_USER ?? 'student1',
	password: process.env.E2E_USER_PW ?? 'password123'
};
const ORG_SLUG = process.env.E2E_ORG ?? 'edmat';

let pass = 0,
	fail = 0;
const check = (label, ok, detail = '') => {
	if (ok) pass++;
	else fail++;
	console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${label}${ok ? '' : '  <- ' + detail}`);
};

async function login(who) {
	const res = await fetch(`${API}/api/auth/login/`, {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify(who)
	});
	if (!res.ok) throw new Error(`login ${who.username} -> ${res.status}`);
	return (await res.json()).token;
}

async function api(path, { method = 'GET', body, tok } = {}) {
	const res = await fetch(`${API}/api${path}`, {
		method,
		headers: {
			'Content-Type': 'application/json',
			...(tok ? { Authorization: `Token ${tok}` } : {})
		},
		...(body === undefined ? {} : { body: JSON.stringify(body) })
	});
	return {
		status: res.status,
		body: res.status === 204 ? null : await res.json().catch(() => null)
	};
}

const staffToken = process.env.E2E_STAFF_TOKEN || (await login(STAFF));
const plainToken = process.env.E2E_USER_TOKEN || (await login(PLAIN));
const ownerToken = process.env.E2E_OWNER_TOKEN || staffToken;
if (!process.env.E2E_OWNER_TOKEN) {
	console.log(
		'  note: E2E_OWNER_TOKEN unset — the goal writes below will be refused `not_manager`'
	);
}

for (const key of ['goals', 'about_discussions', 'organizations', 'tasks', 'plans']) {
	await api(`/feature-flags/${key}/`, {
		method: 'PATCH',
		body: { is_enabled: true },
		tok: staffToken
	});
}

// --- the node ----------------------------------------------------------------------------------
console.log('\n== the project organisation ==');
const orgs = await api('/organizations/', { tok: staffToken });
const org = (orgs.body ?? []).find((o) => o.slug === ORG_SLUG);
check(`the "${ORG_SLUG}" organisation exists`, !!org, JSON.stringify(orgs.body).slice(0, 200));
if (!org) process.exit(1);
const node = `/nodes/organization/${org.id}`;

// --- a goal, and its definition of done ---------------------------------------------------------
console.log('\n== a goal and its definition of done ==');
const created = await api(`${node}/goals/`, {
	method: 'POST',
	tok: ownerToken,
	body: {
		title: 'E2E: every exercise has a reviewed solution',
		description: 'Written by `e2e/goals.mjs` and deleted by it again.'
	}
});
check('a manager writes a goal', created.status === 201, JSON.stringify(created.body));
if (created.status !== 201) process.exit(1);
const goalId = created.body.id;
check(
	'it starts open with no conditions',
	created.body.status === 'open' && created.body.criteria_count === 0
);

const first = await api(`/goals/${goalId}/criteria/`, {
	method: 'POST',
	tok: ownerToken,
	body: { text: '740 statements imported' }
});
const second = await api(`/goals/${goalId}/criteria/`, {
	method: 'POST',
	tok: ownerToken,
	body: { text: 'every one has a reviewed solution' }
});
check('two conditions are added', first.status === 201 && second.status === 201);

const refusedMet = await api(`/goals/${goalId}/`, {
	method: 'PATCH',
	tok: ownerToken,
	body: { status: 'met' }
});
check(
	'a hand-written `met` is refused 400 with its reason',
	refusedMet.status === 400 && JSON.stringify(refusedMet.body).includes('tick the criteria'),
	`${refusedMet.status} ${JSON.stringify(refusedMet.body)}`
);

const tickOne = await api(`/goal-criteria/${first.body.id}/tick/`, {
	method: 'POST',
	tok: ownerToken
});
check(
	'one of two ticked leaves the goal open',
	tickOne.status === 200 &&
		tickOne.body.goal.status === 'open' &&
		tickOne.body.goal.criteria_met_count === 1,
	JSON.stringify(tickOne.body?.goal).slice(0, 160)
);
const tickTwo = await api(`/goal-criteria/${second.body.id}/tick/`, {
	method: 'POST',
	tok: ownerToken
});
check(
	'the last one ticked MEETS the goal, with the moment and who',
	tickTwo.status === 200 && tickTwo.body.goal.status === 'met' && !!tickTwo.body.goal.met_at,
	JSON.stringify(tickTwo.body?.goal).slice(0, 200)
);

const reopen = await api(`/goals/${goalId}/`, {
	method: 'PATCH',
	tok: ownerToken,
	body: { status: 'open' }
});
check(
	'a met goal cannot be re-opened by asserting it (409)',
	reopen.status === 409 && reopen.body.detail === 'illegal_transition',
	`${reopen.status} ${JSON.stringify(reopen.body)}`
);

const untick = await api(`/goal-criteria/${second.body.id}/tick/`, {
	method: 'DELETE',
	tok: ownerToken
});
check(
	'un-ticking a condition re-opens it and clears the moment',
	untick.status === 200 && untick.body.goal.status === 'open' && untick.body.goal.met_at === null,
	JSON.stringify(untick.body?.goal).slice(0, 200)
);

// --- the threads ---------------------------------------------------------------------------------
console.log('\n== commentable ==');
const goalPolicy = await api(`/discussions/?page=${encodeURIComponent(`goals/${goalId}`)}`, {
	tok: plainToken
});
check(
	"the goal's own thread answers and is open",
	goalPolicy.status === 200 && goalPolicy.body.locations[0].is_enabled,
	`${goalPolicy.status} ${JSON.stringify(goalPolicy.body).slice(0, 160)}`
);
const orgPolicy = await api(
	`/discussions/?page=${encodeURIComponent(`organizations/${ORG_SLUG}`)}`,
	{
		tok: plainToken
	}
);
check(
	"the organisation's description thread answers and is open",
	orgPolicy.status === 200 && orgPolicy.body.locations[0].is_enabled,
	`${orgPolicy.status} ${JSON.stringify(orgPolicy.body).slice(0, 160)}`
);
const badSection = await api(
	`/discussions/?page=${encodeURIComponent(`organizations/${ORG_SLUG}`)}&sections=description`,
	{ tok: plainToken }
);
check(
	'an organisation page has one thread and no sections (400)',
	badSection.status === 400,
	`${badSection.status} ${JSON.stringify(badSection.body)}`
);
const noSuchOrg = await api('/discussions/?page=organizations/nothing-here', { tok: plainToken });
check(
	'an unknown slug is 404, not an empty policy',
	noSuchOrg.status === 404,
	`${noSuchOrg.status}`
);

// --- the browser ---------------------------------------------------------------------------------
const browser = await chromium.launch();
const ctx = await englishContext(browser, BASE, { viewport: { width: 1280, height: 1000 } });
await ctx.addInitScript((tok) => localStorage.setItem('edmat-auth-token', tok), ownerToken);
const page = await ctx.newPage();
const problems = [];
page.on('pageerror', (e) => problems.push(String(e)));

console.log('\n== /coop (the organisation page, /about until 2026-11-02) in a real browser ==');
await page.goto(`${BASE}/coop`, { waitUntil: 'networkidle' });
await page.waitForTimeout(1500);
// The Goals panel is a fold on `/coop`, and its open/shut state is remembered per reader
// (`foldedSections`) — so open it only if it is shut; a blind click is as likely to close it.
// Before this, the run of 2026-11-03 read a shut panel and reported its goal missing.
const goalsFold = page.locator('[data-fold="goals"]');
if (!(await goalsFold.evaluate((e) => e.classList.contains('fold--open')))) {
	await goalsFold.locator('.fold__toggle').first().click();
}
await page.waitForTimeout(1500);
const aboutText = await page.textContent('body');
check('the Goals panel is drawn', aboutText.includes('Goals'), aboutText.slice(0, 200));
check(
	'the goal written above is on it',
	aboutText.includes('E2E: every exercise has a reviewed solution')
);
check('its definition of done is drawn', aboutText.includes('Definition of done'));
const boxes = await page.locator(`[data-goal-id="${goalId}"] input[type="checkbox"]`).count();
check('both conditions are drawn as checkboxes', boxes === 2, `found ${boxes}`);
const goalThread = await page
	.locator(`[data-goal-id="${goalId}"]`)
	.locator('text=/Comment on|Comments on/')
	.count();
check('the goal carries a collapsed thread line', goalThread > 0, `found ${goalThread}`);
// The description's own thread: the ask was "after the header, the description should be
// commentable as well", so the line has to be in the About block and named for the organisation.
const descThread = await page.locator(`text=/Comments? on ${org.name}/`).count();
check(
	"the organisation's description carries one too",
	descThread > 0,
	`looked for "Comment(s) on ${org.name}"`
);
await page.screenshot({ path: 'e2e/screens/goals-1-about.png', fullPage: false });

console.log('\n== the goal page ==');
await page.goto(`${BASE}/goals/${goalId}`, { waitUntil: 'networkidle' });
await page.waitForTimeout(1200);
const goalPageText = await page.textContent('body');
check(
	'the goal opens at its own address',
	goalPageText.includes('E2E: every exercise has a reviewed solution')
);
check('with its definition of done', goalPageText.includes('740 statements imported'));
check(
	'and the note that `met` is derived',
	goalPageText.includes('A goal is met when every condition is')
);
await page.screenshot({ path: 'e2e/screens/goals-2-goal-page.png', fullPage: false });

console.log('\n== the plan step edit form ==');
const plan = ((await api(`${node}/plans/`, { tok: ownerToken })).body ?? []).find(
	(p) => p.status === 'active' && (p.steps ?? []).length > 0
);
check('an active plan with steps exists', !!plan);
if (plan) {
	await page.goto(`${BASE}/plans/${plan.id}`, { waitUntil: 'networkidle' });
	await page.waitForTimeout(1200);
	const before = await page.locator('form.step-form').count();
	check('no step form is open to start with', before === 0, `found ${before}`);
	// The first step row's own Edit button — the one that set `formOpenFor = "edit:<id>"` and drew
	// nothing at all until this change.
	await page
		.locator('ol.steps > li.step .step-actions button', { hasText: 'Edit' })
		.first()
		.click();
	await page.waitForTimeout(400);
	const after = await page.locator('form.step-form').count();
	check('clicking Edit opens a form', after === 1, `found ${after}`);
	const caption = await page.locator('form.step-form .step-form__caption').first().textContent();
	check(
		'and the form says which step it is editing',
		(caption ?? '').startsWith('Editing'),
		`caption = ${JSON.stringify(caption)}`
	);
	// Compared against what the PAGE shows, not against the API row read above: this context is
	// English and the step's text is translated (`translations/`), so the API's untranslated
	// `title` is a different string from the caption — which is the whole point of that app, and
	// the first version of this check failed on it rather than on anything being wrong.
	const stepTitle = (
		await page.locator('ol.steps > li.step .step-title').first().textContent()
	)?.trim();
	check(
		'naming that step',
		!!stepTitle && (caption ?? '').includes(stepTitle),
		`caption = ${JSON.stringify(caption)}, step = ${JSON.stringify(stepTitle)}`
	);
	await page.screenshot({ path: 'e2e/screens/goals-3-plan-step-edit.png', fullPage: false });
}

check('no uncaught page errors', problems.length === 0, problems.join(' | '));
await browser.close();

// --- cleanup --------------------------------------------------------------------------------------
console.log('\n== cleanup ==');
const removed = await api(`/goals/${goalId}/`, { method: 'DELETE', tok: ownerToken });
check(
	'the goal deletes again (nothing points at it, nobody commented)',
	removed.status === 204,
	`${removed.status} ${JSON.stringify(removed.body)}`
);
const gone = await api(`/goals/${goalId}/`, { tok: ownerToken });
check('and is gone', gone.status === 404, `${gone.status}`);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
