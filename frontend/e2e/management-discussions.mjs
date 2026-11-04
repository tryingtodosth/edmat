// A task, a plan, a need or a poll as a discussion location (`backend/community/discussions.py`,
// "A task, a plan, a need or a poll is a location too", HISTORY §17BY).
//
// Run: E2E_BASE=http://localhost:5173 E2E_API=http://localhost:8000 \
//      E2E_STAFF_TOKEN=<admin's token> E2E_USER_TOKEN=<student1's token> \
//      node e2e/management-discussions.mjs
//
// Tokens rather than the login form (`e2e/CLAUDE.md` trap 30): the DRF token is one per user and
// stable, and five scripts signing in as the same account in an hour burn the throttle for all of
// them. Without the env vars it falls back to the form, once per account.
//
// What it drives: the batched `?keys=` read answers one policy per row; a malformed key is 400 and
// a missing row 404; a member's comment under a task appears at once and the location row appears
// in the moderation list; the two settings (audience, moderated) apply to a row exactly as they
// do to a standing page; the row's own kill switch (`tasks`) takes the thread down; and in the
// browser the collapsed line is drawn under the task on `/about`, on `/tasks/<id>`, and under a
// plan on `/plans/<id>`, with the moderation tab linking the key to the row's page.
//
// It cleans up after itself: both comments it writes are deleted by their author (a tombstone,
// house rule 12), which `comment_count` never counts, so the count comes back to what it was.
let chromium;
try {
	({ chromium } = await import('playwright-core'));
} catch {
	console.error('playwright-core is not installed');
	process.exit(1);
}

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
const errors = [];
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

async function setFlag(key, on) {
	await api(`/feature-flags/${key}/`, {
		method: 'PATCH',
		body: { is_enabled: on },
		tok: staffToken
	});
}
for (const key of ['about_discussions', 'tasks', 'plans', 'needs', 'decisions'])
	await setFlag(key, true);

// --- the rows: the project's own organisation, read through the real API -----------------------
console.log('\n== finding the rows ==');
const orgs = await api('/organizations/', { tok: staffToken });
const org = (orgs.body ?? []).find((o) => o.slug === ORG_SLUG);
check(`the "${ORG_SLUG}" organisation exists`, !!org, JSON.stringify(orgs.body).slice(0, 200));
if (!org) process.exit(1);
const node = `/nodes/organization/${org.id}`;
const tasks = (await api(`${node}/tasks/`, { tok: staffToken })).body ?? [];
const task = tasks.find((t) => ['todo', 'in_progress', 'review'].includes(t.status)) ?? tasks[0];
const plan = ((await api(`${node}/plans/`, { tok: staffToken })).body ?? []).find(
	(p) => p.status === 'active'
);
const need = ((await api(`${node}/needs/`, { tok: staffToken })).body ?? []).find(
	(n) => n.status === 'open'
);
const poll = ((await api(`${node}/polls/`, { tok: staffToken })).body ?? [])[0];
check(
	'a task, a plan, a need and a poll are on it',
	!!(task && plan && need && poll),
	JSON.stringify({ task: !!task, plan: !!plan, need: !!need, poll: !!poll })
);
if (!(task && plan && need && poll)) process.exit(1);
const KEYS = {
	task: `tasks/${task.id}`,
	plan: `plans/${plan.id}`,
	need: `needs/${need.id}`,
	poll: `polls/${poll.id}`
};
console.log(`  (${Object.values(KEYS).join(', ')})`);

/** `comment_count` for one row, read AUTHENTICATED (trap 12: an anonymous GET may come from the
 *  60 s read cache). */
async function countOf(key) {
	const res = await api(`/discussions/?keys=${encodeURIComponent(key)}`, { tok: staffToken });
	return (res.body?.locations ?? []).find((l) => l.key === key)?.comment_count ?? 0;
}

console.log('\n== policies through the API ==');
const many = await api(`/discussions/?keys=${encodeURIComponent(Object.values(KEYS).join(','))}`, {
	tok: plainToken
});
check(
	'the batched read answers one policy per row',
	many.status === 200 && (many.body?.locations ?? []).length === 4,
	JSON.stringify(many.body).slice(0, 300)
);
check(
	'each is its own page with no section',
	(many.body?.locations ?? []).every((l) => l.section === '' && l.is_enabled),
	JSON.stringify(many.body?.locations?.map((l) => [l.key, l.section, l.is_enabled]))
);
check('a malformed key is 400', (await api('/discussions/?page=tasks/0')).status === 400);
check(
	'a row that does not exist is 404',
	(await api('/discussions/?page=tasks/999999')).status === 404
);
check(
	'a section under a row is 400',
	(await api(`/discussions/?page=${KEYS.task}&sections=x`)).status === 400
);

const before = await countOf(KEYS.task);
console.log(`  (before: ${KEYS.task} has ${before})`);

console.log('\n== a member writes under a task ==');
const BODY_PUBLIC = `Is this still wanted? (e2e ${Date.now()})`;
const posted = await api('/discussions/thread/', {
	method: 'POST',
	body: { page: KEYS.task, body: BODY_PUBLIC },
	tok: plainToken
});
check(
	'a signed-in comment is accepted',
	posted.status === 201,
	`${posted.status} ${JSON.stringify(posted.body)}`
);
check(
	'and is not held on an unmoderated row',
	posted.body?.is_held === false,
	JSON.stringify(posted.body)
);
const afterOne = await countOf(KEYS.task);
check('the count went up by exactly one', afterOne === before + 1, `${before} -> ${afterOne}`);

const locations = await api('/discussion-locations/', { tok: staffToken });
const row = (locations.body ?? []).find((r) => r.key === KEYS.task);
check(
	'the location row appears in the moderation list',
	!!row && row.section === '',
	JSON.stringify(row)
);

console.log('\n== the two settings apply to a row ==');
await api(`/discussion-locations/${row.id}/`, {
	method: 'PATCH',
	body: { audience: 'staff' },
	tok: staffToken
});
const refused = await api('/discussions/thread/', {
	method: 'POST',
	body: { page: KEYS.task, body: 'Should be refused.' },
	tok: plainToken
});
check(
	'`staff` refuses a member with its word',
	refused.status === 403 && refused.body?.detail === 'staff_only',
	`${refused.status} ${JSON.stringify(refused.body)}`
);
await api(`/discussion-locations/${row.id}/`, {
	method: 'PATCH',
	body: { audience: 'users', moderated: true },
	tok: staffToken
});
const BODY_HELD = `Held for a moderator (e2e ${Date.now()})`;
const held = await api('/discussions/thread/', {
	method: 'POST',
	body: { page: KEYS.task, body: BODY_HELD },
	tok: plainToken
});
check(
	'`moderated` holds what a member writes',
	held.status === 201 && held.body?.is_held === true,
	`${held.status} ${JSON.stringify(held.body)}`
);
const anonThread = await api(`/discussions/thread/?page=${KEYS.task}&_=${Date.now()}`);
check(
	'a held comment is invisible to a visitor',
	(anonThread.body?.comments ?? []).every((c) => c.body !== BODY_HELD)
);
const staffThread = await api(`/discussions/thread/?page=${KEYS.task}`, { tok: staffToken });
// Listed for staff and for its author, but with its body blanked behind the "hidden until
// reviewed" placeholder — `CommentSerializer` does that for every auto-hidden row, and a held
// comment IS one (`accounts.minors.hold_for_review`). So the test is the id, not the words.
check(
	'and listed for staff, who have to decide about it',
	(staffThread.body?.comments ?? []).some((c) => c.id === held.body?.id),
	JSON.stringify(staffThread.body?.comments?.map((c) => c.id))
);
const rowAfter = ((await api('/discussion-locations/', { tok: staffToken })).body ?? []).find(
	(r) => r.key === KEYS.task
);
check('the moderation list counts it as held', rowAfter?.held_count >= 1, JSON.stringify(rowAfter));
await api(`/discussion-locations/${row.id}/`, {
	method: 'PATCH',
	body: { audience: 'users', moderated: false },
	tok: staffToken
});

console.log("\n== the row's own kill switch ==");
await setFlag('tasks', false);
const killed = await api(`/discussions/?keys=${KEYS.task},${KEYS.plan}`, { tok: plainToken });
const byKey = Object.fromEntries((killed.body?.locations ?? []).map((l) => [l.key, l]));
check(
	'`tasks` off takes the task thread down',
	byKey[KEYS.task]?.is_enabled === false,
	JSON.stringify(byKey[KEYS.task])
);
check(
	'and leaves the plan thread alone',
	byKey[KEYS.plan]?.is_enabled === true,
	JSON.stringify(byKey[KEYS.plan])
);
await setFlag('tasks', true);

// --- the browser ---------------------------------------------------------------------------------
const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
await ctx.addInitScript((tok) => localStorage.setItem('edmat-auth-token', tok), plainToken);
const page = await ctx.newPage();
page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
let refusedFonts = 0,
	ignoredFontErrors = 0;
page.on('response', (r) => {
	if (r.status() === 403 && /katex\/dist\/fonts\//.test(r.url())) refusedFonts++;
});
page.on('console', (msg) => {
	if (msg.type() !== 'error') return;
	if (refusedFonts > 0 && /Failed to load resource/i.test(msg.text())) {
		refusedFonts--;
		ignoredFontErrors++;
		return;
	}
	errors.push(`console: ${msg.text()}`);
});
const policyCalls = [];
page.on('request', (r) => {
	if (r.url().includes('/api/discussions/?keys=')) policyCalls.push(r.url());
});

console.log('\n== a member on /coop: the board is folded, a task opens in a modal ==');
await page.goto(`${BASE}/coop`, { waitUntil: 'load' });
// The Team tasks panel is itself a fold on `/coop`, shut by default and remembered per browser
// (`foldedSections`), and a shut fold draws no rows — open it only if it is shut.
const tasksFold = page.locator('[data-fold="tasks"]');
await tasksFold.waitFor({ timeout: 60000 });
if (!(await tasksFold.evaluate((e) => e.classList.contains('fold--open')))) {
	await tasksFold.locator('.fold__toggle').first().click();
}
// The board is one line per task (owner, 2026-10-08): the row is a button, and the full card —
// with the discussion line under it — is drawn in a modal whose URL is the task's own page.
const folded = page.locator(`[data-task-row="${task.id}"]`);
await folded.waitFor({ timeout: 60000 });
check('the task is folded to one line', (await folded.count()) === 1);
check(
	'and the line carries no description',
	!task.description ||
		!((await folded.textContent()) ?? '').includes(task.description.slice(0, 30)),
	((await folded.textContent()) ?? '').slice(0, 120)
);
check('no card is drawn on the board', (await page.locator('article.task').count()) === 0);
await folded.click();
// `.first()`: the card draws its subtasks as nested `article.task`s, and the first match is the
// task itself.
const card = page.locator('.modal-panel article.task').first();
await card.waitFor({ timeout: 15000 });
check(
	'clicking it opens the full card in a modal',
	(await page.locator('.modal-panel').count()) === 1
);
check("and the URL is the task's own page", page.url().endsWith(`/tasks/${task.id}`), page.url());
const toggle = card.locator('.section-discussion__toggle');
await toggle.waitFor({ timeout: 30000 });
check('the collapsed line is drawn under the task', (await toggle.count()) === 1);
const label = (await toggle.textContent()) ?? '';
const shown = label.match(/\((\d+)\)/);
check(
	`and carries the exact count (${before + 1})`,
	shown !== null && Number(shown[1]) === before + 1,
	label.trim()
);
const tasksPanelCalls = policyCalls.filter((u) => u.includes('tasks%2F') || u.includes('tasks/'));
check(
	'the board asked for every task in ONE request',
	tasksPanelCalls.length === 1,
	policyCalls.join(' | ')
);

const threadLoaded = page.waitForResponse((r) => r.url().includes('/api/discussions/thread/'));
await toggle.click();
await threadLoaded;
await card
	.locator('.section-discussion__body')
	.getByText(/Wczytywanie|Loading/)
	.waitFor({ state: 'detached', timeout: 10000 })
	.catch(() => {});
const bodyText = (await card.locator('.section-discussion__body').textContent()) ?? '';
check(
	'the comment is rendered in the thread',
	bodyText.includes(BODY_PUBLIC),
	bodyText.slice(0, 160)
);
check(
	'the held one is shown to its own author as a placeholder',
	/ukryty|hidden/i.test(bodyText),
	bodyText.slice(0, 160)
);
await page.screenshot({
	path: 'e2e/screens/management-discussions-1-about-task.png',
	fullPage: false
});

// Escape closes the modal and goes BACK — the URL returns to the board it came from.
await page.keyboard.press('Escape');
await card.waitFor({ state: 'detached', timeout: 10000 });
check(
	'Escape closes the modal and returns to /coop',
	new URL(page.url()).pathname.endsWith('/coop'),
	page.url()
);

console.log('\n== /tasks/<id>: the full page a refresh lands on ==');
await page.goto(`${BASE}/tasks/${task.id}`, { waitUntil: 'load' });
const detailToggle = page.locator('article.task .section-discussion__toggle');
await detailToggle.waitFor({ timeout: 30000 });
check(
	"the task's own page carries the same line",
	((await detailToggle.textContent()) ?? '').includes(`(${before + 1})`),
	(await detailToggle.textContent()) ?? ''
);
const backLink = page.locator('.on-node a');
check(
	'and a link back to the board it hangs on',
	((await backLink.getAttribute('href')) ?? '').endsWith('/coop'),
	(await backLink.getAttribute('href')) ?? ''
);

console.log('\n== /plans/<id>: steps are folded, a step opens with ?step= ==');
const fullPlan = (await api(`/plans/${plan.id}/`, { tok: plainToken })).body;
const stepWithText = (fullPlan?.steps ?? []).find((s) => s.description);
check(
	'the plan has a step with a description to fold',
	!!stepWithText,
	JSON.stringify(fullPlan?.steps?.map((s) => [s.id, !!s.description]))
);
await page.goto(`${BASE}/plans/${plan.id}`, { waitUntil: 'load' });
const planToggle = page.locator('[data-plan-detail] .section-discussion__toggle');
await planToggle.waitFor({ timeout: 30000 });
check("the plan's page carries one thread at its foot", (await planToggle.count()) === 1);
if (stepWithText) {
	const stepsText = (await page.locator('[data-plan-steps]').textContent()) ?? '';
	check(
		'a step description is NOT drawn in the list',
		!stepsText.includes(stepWithText.description.slice(0, 30)),
		stepsText.slice(0, 160)
	);
	const stepButton = page
		.locator('[data-plan-steps] button.step-title--opens', {
			hasText: stepWithText.title.slice(0, 40)
		})
		.first();
	await stepButton.click();
	const stepModal = page.locator('.modal-panel');
	await stepModal.waitFor({ timeout: 10000 });
	check(
		'clicking the step opens its description in a modal',
		((await stepModal.textContent()) ?? '').includes(stepWithText.description.slice(0, 30)),
		((await stepModal.textContent()) ?? '').slice(0, 160)
	);
	check(
		'and the URL carries ?step=',
		new URL(page.url()).searchParams.get('step') === String(stepWithText.id),
		page.url()
	);
	await page.screenshot({ path: 'e2e/screens/management-discussions-2-plan.png', fullPage: false });
	// The whole point of the query: a refresh re-opens the same modal over the plan.
	await page.reload({ waitUntil: 'load' });
	await page.locator('.modal-panel').waitFor({ timeout: 30000 });
	check(
		'a refresh re-opens the modal',
		((await page.locator('.modal-panel').textContent()) ?? '').includes(
			stepWithText.description.slice(0, 30)
		)
	);
	await page.locator('.modal-panel .step-modal__back button').click();
	await page.locator('.modal-panel').waitFor({ state: 'detached', timeout: 10000 });
	check(
		'"Back to the plan" after a refresh leaves a clean plan URL',
		new URL(page.url()).searchParams.get('step') === null &&
			new URL(page.url()).pathname.endsWith(`/plans/${plan.id}`),
		page.url()
	);
}

console.log('\n== the moderation tab, as staff ==');
const sctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
await sctx.addInitScript((tok) => localStorage.setItem('edmat-auth-token', tok), staffToken);
const spage = await sctx.newPage();
spage.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
await spage.goto(`${BASE}/moderation?tab=discussions`, { waitUntil: 'load' });
const keyLink = spage.locator('a.location-row__key', { hasText: KEYS.task });
await keyLink.waitFor({ timeout: 60000 });
check('the row is listed with its key as a link', (await keyLink.count()) === 1);
check(
	'and the link goes to the task',
	((await keyLink.getAttribute('href')) ?? '').endsWith(`/tasks/${task.id}`),
	(await keyLink.getAttribute('href')) ?? ''
);
const scope = spage
	.locator('.location-row', { hasText: KEYS.task })
	.locator('.location-row__scope');
check(
	'and says what kind of row it is',
	/zadanie|a task/i.test((await scope.textContent()) ?? ''),
	(await scope.textContent()) ?? ''
);
await spage.screenshot({
	path: 'e2e/screens/management-discussions-3-moderation.png',
	fullPage: false
});

// --- clean up, through the real API -----------------------------------------------------------
console.log('\n== cleaning up ==');
// The public one is deleted by its author. The HELD one cannot be: an author's DELETE of an
// auto-hidden comment is 409 (`community/views.py`), and until 2026-11-03 this loop ignored that
// status, so every run left a held comment waiting in the moderation queue. A moderator decides it.
if (posted.body?.id) {
	const gone = await api(`/comments/${posted.body.id}/`, { method: 'DELETE', tok: plainToken });
	check('the public comment is deleted by its author', gone.status < 300, `${gone.status}`);
}
if (held.body?.id) {
	const decided = await api(`/moderation/reports/comment/${held.body.id}/remove/`, {
		method: 'POST',
		tok: staffToken
	});
	check('the held comment is removed by a moderator', decided.status < 300, `${decided.status}`);
}
const after = await countOf(KEYS.task);
check(`the count is back to ${before}`, after === before, `${after}`);

await browser.close();
if (ignoredFontErrors > 0)
	console.log(`  (ignored ${ignoredFontErrors} KaTeX webfont 403s — e2e/CLAUDE.md trap 26)`);
check('no console or page errors', errors.length === 0, errors.join(' | '));
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
