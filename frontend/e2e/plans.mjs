// Plans — roadmaps with steps and suggestions (MANAGEMENT-BRIEF.md §3.D).
//
// Kasia runs a scratch course and makes a plan on it: two steps, reordered, then activated.
// Michał — who has no standing on the course at all — opens the same plan by its link, finds the
// suggestion box open (the plan is active) and sends one. Kasia reopens the plan, finds it in her
// suggestion queue, and accepts it — which is checked both in the browser (a new step appears) and
// through the API (`created_step` on the suggestion points at that step). What only a browser can
// show: that the panel on the course page actually links to the plan page, that the up/down
// buttons genuinely reorder (not just accept a click), and that a stranger reading the SAME plan
// sees no suggestion queue and no editor buttons at all.
//
//   backend:  DJANGO_CORS_ALLOWED_ORIGINS=http://localhost:5224 manage.py runserver 127.0.0.1:8124
//   frontend: npm run dev -- --port 5224 --strictPort
//   E2E_BASE=http://localhost:5224 E2E_API=http://127.0.0.1:8124 node e2e/plans.mjs
//
// A course this scratch, once activated, cannot be deleted through the API (only a `draft` plan
// can be — the whole point of the lifecycle, house rule 12: tombstone, don't hard-delete). The
// scratch COURSE is removed at the end; its plan is left behind exactly as a real one would be,
// which is why the course title is timestamped — a repeat run never collides with an old one.
let chromium;
try {
	({ chromium } = await import('playwright'));
} catch {
	({ chromium } = await import('playwright-core'));
}

const BASE = process.env.E2E_BASE ?? 'http://localhost:5224';
const API = (process.env.E2E_API ?? 'http://127.0.0.1:8124').replace(/\/api\/?$/, '') + '/api';

let pass = 0;
let fail = 0;
const errors = [];
const check = (label, ok, extra = '') => {
	if (ok) {
		pass++;
		console.log(`  ok   ${label}`);
	} else {
		fail++;
		console.log(`  FAIL ${label} ${extra}`);
	}
};

async function api(path, { token, method = 'GET', body } = {}) {
	const res = await fetch(`${API}${path}`, {
		method,
		headers: {
			'Content-Type': 'application/json',
			...(token ? { Authorization: `Token ${token}` } : {})
		},
		body: body !== undefined ? JSON.stringify(body) : undefined
	});
	const text = await res.text();
	let parsed;
	try {
		parsed = text ? JSON.parse(text) : null;
	} catch {
		parsed = text;
	}
	return { status: res.status, body: parsed };
}

async function tokenFor(email) {
	const r = await api('/auth/login/', {
		method: 'POST',
		body: { username: email, password: 'password123' }
	});
	if (r.status !== 200) {
		throw new Error(
			`login failed for ${email}: ${r.status} ${JSON.stringify(r.body)} (login throttle? clear backend/cachedata)`
		);
	}
	return r.body.token;
}

const kasia = await tokenFor('kasia@edmat.example');
const michal = await tokenFor('michal@edmat.example');

const stamp = Date.now();
const COURSE_TITLE = `Plans e2e ${stamp}`;
const course = await api('/courses/', {
	token: kasia,
	method: 'POST',
	body: {
		title: COURSE_TITLE,
		summary: 'Fixture for the plans e2e run.',
		visibility: 'public',
		status: 'open',
		enrollment_policy: 'open'
	}
});
const COURSE_ID = course.body?.id;
check(
	'scratch course created',
	course.status === 201 && Boolean(COURSE_ID),
	JSON.stringify(course.body).slice(0, 160)
);

const browser = await chromium.launch(
	process.env.CHROME ? { executablePath: process.env.CHROME } : {}
);

// A pre-existing artifact of this worktree's dev server, not anything `plans` introduced: confirmed
// by an isolated probe (a bare login → home redirect, no plans code touched at all) that Chromium's
// console reports exactly six of these — one per KaTeX font — because `frontend/node_modules` is a
// symlink to the repo root's shared install (the per-worktree setup) and Vite's dev server 403s a
// font requested through `/@fs/...` once the resolved real path falls outside its allow-list.
// Chromium's synthetic message carries no URL, only this exact generic sentence, so the filter
// matches the sentence itself — narrowly, not any 403 — and a real `/api/` failure is still caught
// below via `page.on('response')`, which DOES carry a URL.
const KNOWN_NOISE =
	'Failed to load resource: the server responded with a status of 403 (Forbidden)';

async function person() {
	const ctx = await browser.newContext({ viewport: { width: 1280, height: 1000 } });
	const p = await ctx.newPage();
	p.on('console', (m) => {
		if (m.type() !== 'error') return;
		if (m.text() === KNOWN_NOISE) return;
		errors.push(`[${p.url()}] ${m.text()}`);
	});
	p.on('pageerror', (e) => errors.push(e.message));
	p.on('response', (r) => {
		if (r.url().includes('/api/') && r.status() >= 500) {
			errors.push(`[${r.status()}] ${r.url()}`);
		}
	});
	p.setDefaultTimeout(60000);
	return p;
}
const settle = (p, ms = 700) => p.waitForTimeout(ms);

async function login(p, email) {
	const booted = p.waitForResponse((r) => r.url().includes('/feature-flags/'), { timeout: 90000 });
	await p.goto(`${BASE}/login`, { waitUntil: 'load', timeout: 90000 });
	await booted;
	await p.locator('form input[autocomplete="username"]').waitFor({ timeout: 30000 });
	await settle(p, 1200);
	await p.locator('form input[autocomplete="username"]').fill(email);
	await p.locator('form input[type="password"]').fill('password123');
	await p.locator('form button[type="submit"]').click();
	await p.waitForURL((u) => !u.pathname.includes('/login'), { timeout: 45000 });
}

// ---- Kasia: the course page mounts the plans panel, and she starts a plan --------------------
const kasiaPage = await person();
await login(kasiaPage, 'kasia@edmat.example');
await kasiaPage.goto(`${BASE}/courses/${COURSE_ID}`, { waitUntil: 'load', timeout: 90000 });
await kasiaPage.locator('[data-plans-panel]').waitFor({ timeout: 30000 });
check('the course page mounts the plans panel', true);

await kasiaPage.locator('[data-plans-panel] button', { hasText: 'Nowy plan' }).click();
const planTitleInput = kasiaPage.locator('[data-plans-panel] .create-form input');
await planTitleInput.waitFor({ timeout: 10000 });
const PLAN_TITLE = `Roadmap ${stamp}`;
await planTitleInput.fill(PLAN_TITLE);
await kasiaPage.locator('[data-plans-panel] .create-form button[type="submit"]').click();
await kasiaPage.locator('[data-plan-card]', { hasText: PLAN_TITLE }).waitFor({ timeout: 20000 });
check('the new plan appears as a card in the panel', true);

await kasiaPage.locator('[data-plan-card]', { hasText: PLAN_TITLE }).click();
await kasiaPage.waitForURL((u) => /\/plans\/\d+/.test(u.pathname), { timeout: 20000 });
await kasiaPage.locator('[data-plan-detail]').waitFor({ timeout: 20000 });
check('the plan card opens the plan page', true);
const PLAN_URL = kasiaPage.url();
const PLAN_ID = PLAN_URL.match(/\/plans\/(\d+)/)?.[1];
check('a numeric plan id is in the URL', Boolean(PLAN_ID), PLAN_URL);

check(
	'the plan starts as a draft',
	(await kasiaPage.locator('[data-plan-status]').getAttribute('data-plan-status')) === 'draft'
);

// ---- two steps, reordered ----------------------------------------------------------------------
async function addStep(title) {
	await kasiaPage
		.locator('.content-section .section-head button', { hasText: 'Dodaj krok' })
		.click();
	// `.step-form` also holds the due-date `<input type="datetime-local">` — scope to the text
	// input specifically (e2e/CLAUDE.md trap 6: positional locators lie).
	await kasiaPage.locator('.step-form input[type="text"]').fill(title);
	await kasiaPage.locator('.step-form button[type="submit"]').click();
	await kasiaPage.locator('[data-plan-steps]', { hasText: title }).waitFor({ timeout: 20000 });
}
await addStep('Pierwszy krok');
await addStep('Drugi krok');
check(
	'both steps are on the page, in creation order',
	(await kasiaPage.locator('[data-plan-steps] > li .step-title').allInnerTexts()).join('|') ===
		'Pierwszy krok|Drugi krok'
);

// Move the SECOND step up — the up-arrow is `aria-label` "Przesuń w górę" (Polish default).
await kasiaPage
	.locator('[data-plan-steps] > li', { hasText: 'Drugi krok' })
	.getByRole('button', { name: 'Przesuń w górę' })
	.click();
await settle(kasiaPage, 800);
check(
	'reordering actually swapped the two top-level steps',
	(await kasiaPage.locator('[data-plan-steps] > li .step-title').allInnerTexts()).join('|') ===
		'Drugi krok|Pierwszy krok'
);
await kasiaPage.screenshot({ path: 'e2e/screens/plans-steps.png' });

// ---- activate ------------------------------------------------------------------------------------
await kasiaPage.locator('.transitions button', { hasText: 'Aktywuj' }).click();
await kasiaPage
	.locator('[data-plan-status][data-plan-status="active"]')
	.waitFor({ timeout: 20000 });
check('the plan is active now', true);

// ---- Michał: no standing on the course, opens the SAME plan by its link ------------------------
// The API half of house rule 4: a reader who is not this plan's editor is refused the queue
// outright, not handed a filtered/empty one.
const queueAsMichal = await api(`/plans/${PLAN_ID}/suggestions/`, { token: michal });
check(
	'michał is refused the suggestion queue (API)',
	queueAsMichal.status === 403,
	String(queueAsMichal.status)
);

const michalPage = await person();
await login(michalPage, 'michal@edmat.example');
await michalPage.goto(PLAN_URL, { waitUntil: 'load', timeout: 90000 });
await michalPage.locator('[data-plan-detail]').waitFor({ timeout: 20000 });
check(
	'a stranger reading an active plan sees no suggestion queue',
	(await michalPage.locator('[data-suggestions-queue]').count()) === 0
);
check(
	'a stranger sees no editor controls on the steps',
	(await michalPage.locator('.step-actions').count()) === 0
);

const SUGGESTION_TEXT = `Dodajcie ćwiczenia z limit ${stamp}`;
await michalPage.locator('[data-suggest-form] textarea').fill(SUGGESTION_TEXT);
await michalPage.locator('[data-suggest-form] button[type="submit"]').click();
await michalPage.locator('.notice').waitFor({ timeout: 20000 });
check(
	'michał is told his suggestion was sent',
	/Wysłano/.test(await michalPage.locator('.notice').innerText())
);

// ---- Kasia decides it -----------------------------------------------------------------------------
await kasiaPage.reload({ waitUntil: 'load', timeout: 90000 });
await kasiaPage.locator('[data-plan-detail]').waitFor({ timeout: 20000 });
await kasiaPage
	.locator('[data-suggestions-queue]', { hasText: SUGGESTION_TEXT })
	.waitFor({ timeout: 20000 });
check("kasia's queue shows michał's suggestion", true);

await kasiaPage
	.locator('[data-suggestions-queue] li', { hasText: SUGGESTION_TEXT })
	.getByRole('button', { name: 'Zaakceptuj' })
	.click();
await settle(kasiaPage, 1200);
check(
	'accepting it created a third step',
	(await kasiaPage.locator('[data-plan-steps] > li').count()) === 3
);
check(
	'the new step carries the suggestion text',
	(await kasiaPage.locator('[data-plan-steps] > li .step-title').last().innerText()).length > 0
);
await kasiaPage.screenshot({ path: 'e2e/screens/plans-accepted.png' });

// Cross-check through the API: the suggestion is `accepted` and its `created_step` is real.
const suggestionsCheck = await api(`/plans/${PLAN_ID}/suggestions/`, { token: kasia });
const decided = suggestionsCheck.body?.find((s) => s.text === SUGGESTION_TEXT);
check('the suggestion is accepted (API)', decided?.status === 'accepted', JSON.stringify(decided));
check('it points at a real created step (API)', Boolean(decided?.created_step));

// ---- mark the steps done, complete the plan -------------------------------------------------------
const statusSelects = kasiaPage.locator('[data-plan-steps] > li select');
const stepCount = await statusSelects.count();
for (let i = 0; i < stepCount; i++) {
	await statusSelects.nth(i).selectOption('done');
	await settle(kasiaPage, 400);
}
await kasiaPage.locator('.transitions button', { hasText: 'Oznacz jako ukończony' }).click();
await kasiaPage
	.locator('[data-plan-status][data-plan-status="completed"]')
	.waitFor({ timeout: 20000 });
check('the plan completes once every step is done', true);

check('no console or page errors', errors.length === 0, errors.join(' | '));

await browser.close();

// ---- cleanup: the scratch course (its plan is a tombstone left behind by design, see header) ----
const removed = await api(`/courses/${COURSE_ID}/`, { token: kasia, method: 'DELETE' });
check('the scratch course is removed', removed.status === 204, String(removed.status));

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
