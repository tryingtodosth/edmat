// Management step A — organisations, their rosters, and what they stand behind, in a real browser.
//
// Run it with both servers up (MANAGEMENT-BRIEF.md §4 rule 9 assigns this branch ports 8121/5221):
//   backend:  cd backend && DJANGO_CORS_ALLOWED_ORIGINS=http://localhost:5221,http://127.0.0.1:5221 \
//               ../.venv/bin/python3 manage.py runserver 127.0.0.1:8121
//   frontend: cd frontend && npm run dev -- --port 5221 --strictPort
//   E2E_BASE=http://localhost:5221 E2E_API=http://127.0.0.1:8121 node e2e/organizations.mjs
//
// `organizations/tests.py` already pins the rules — `last_owner`, `not_node_manager`, who may
// dissolve. What only a browser shows is the half no unit test reaches:
//
//  * that founding one through the real form lands on its page with the founder as owner;
//  * that the directory, its "Mine" tab and its search actually narrow (exact counts — trap 8);
//  * that a refusal arrives as a SENTENCE on the manage page, not as a bare 409/403;
//  * that the badge really appears in the management panel on the linked course's own page;
//  * that the `organizations` kill switch takes the pages, the panel and BOTH header entries away
//    from a NON-STAFF visitor (trap 10: a staff-bypassed check proves nothing) while `/courses/`
//    keeps working.
//
// It signs in as the seeded demo users rather than registering (trap 1: registration is throttled
// per IP, and a run that exhausts it fails in ways that read like a code regression). Everything it
// creates is stamped with `RUN` and cleaned up at the end through the real API.
let chromium;
try {
	({ chromium } = await import('playwright'));
} catch {
	({ chromium } = await import('playwright-core'));
}

// English copy in the checks below → ask for the English interface; the default is Polish (trap 24).
import { englishContext } from './english.mjs';

const BASE = process.env.E2E_BASE ?? 'http://localhost:5221';
const API = (process.env.E2E_API ?? 'http://127.0.0.1:8121').replace(/\/api\/?$/, '') + '/api';
const PASSWORD = process.env.E2E_DEMO_PASSWORD ?? 'password123';
// Kasia is the one seeded staff account (`seed_demo_users`), so she is the only person who can pull
// the kill switch (`feature-flags` is IsAdminUser). Ola founds the body; Michał runs the course she
// is NOT allowed to link, which is what makes `not_node_manager` a real refusal rather than a stub.
const STAFF = 'kasia@edmat.example';
const OWNER = 'ola@edmat.example';
const OTHER = 'michal@edmat.example';
const RUN = Date.now();
const ORG_NAME = `E2E Circle ${RUN}`;

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

const browser = await chromium.launch(
	process.env.CHROME ? { executablePath: process.env.CHROME } : {}
);

function wire(page, name) {
	page.on('pageerror', (e) => errors.push(`[${name}] pageerror: ${e.message}`));
	page.on('console', (msg) => {
		// This run deliberately provokes 403s (the kill-switch section, the refused link) and 409s
		// (the last owner trying to leave). A 500 still fails the run.
		if (msg.type() === 'error' && !/status of (40[0134]|409)\b/.test(msg.text())) {
			errors.push(`[${name}] console: ${msg.text()}`);
		}
	});
	return page;
}

async function person(name) {
	const ctx = await englishContext(browser, BASE, { viewport: { width: 1280, height: 950 } });
	return wire(await ctx.newPage(), name);
}

const settle = (page, ms = 800) => page.waitForTimeout(ms);

async function goto(page, path) {
	// 'load', not 'networkidle' — the notification SSE stream keeps a request open on every signed-in
	// page, so networkidle never fires there (trap 2). The `/feature-flags/` wait is trap 25: every
	// flag-gated link is meaningless until the root layout's own boot request has landed.
	const flags = page
		.waitForResponse((r) => r.url().includes('/feature-flags/'), { timeout: 25000 })
		.catch(() => null);
	await page.goto(`${BASE}${path}`, { waitUntil: 'load' });
	await flags;
	await settle(page);
}

/** Wait for a selector to carry its content rather than its "Loading…" state. A fixed timeout that
 *  is generous on a quiet machine is not generous on one running six worktrees' servers at once. */
async function waitForText(page, selector, needle, timeout = 25000) {
	try {
		await page.waitForFunction(
			([sel, text]) => document.querySelector(sel)?.textContent?.includes(text) ?? false,
			[selector, needle],
			{ timeout }
		);
		return true;
	} catch {
		return false;
	}
}

async function tokenFor(email) {
	const response = await fetch(`${API}/auth/login/`, {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify({ username: email, password: PASSWORD })
	});
	return (await response.json()).token;
}

async function api(token, path, init = {}) {
	const response = await fetch(`${API}${path}`, {
		...init,
		headers: {
			'Content-Type': 'application/json',
			...(token ? { Authorization: `Token ${token}` } : {}),
			...(init.headers ?? {})
		}
	});
	const text = await response.text();
	let body;
	try {
		body = text ? JSON.parse(text) : null;
	} catch {
		body = text;
	}
	return { status: response.status, body };
}

/** The token is what the app itself persists (`token.svelte.ts`), so seating one leaves the same
 *  state a real login does — and it keeps the run under the login throttle (trap 1). */
async function seat(page, token) {
	await page.goto(`${BASE}/`, { waitUntil: 'domcontentloaded' });
	await page.evaluate((value) => localStorage.setItem('edmat-auth-token', value), token);
	await goto(page, '/');
}

/** Open one of the header's popovers and read its items. The trigger is a real button with an
 *  accessible name; `exact` because `getByRole(name)` matches substrings (trap 20). */
async function menuText(page, label) {
	await page.getByRole('button', { name: label, exact: true }).first().click();
	await settle(page, 400);
	const text = (await page.locator('[role="menu"]').first().textContent()) ?? '';
	await page.keyboard.press('Escape');
	await settle(page, 200);
	return text;
}

const staffToken = await tokenFor(STAFF);
const ownerToken = await tokenFor(OWNER);
const otherToken = await tokenFor(OTHER);

const created = { orgId: null, orgSlug: null, myCourseId: null, otherCourseId: null };

async function setFlag(enabled) {
	await api(staffToken, '/feature-flags/organizations/', {
		method: 'PATCH',
		body: JSON.stringify({ is_enabled: enabled })
	});
}

async function cleanUp() {
	await setFlag(true);
	if (created.myCourseId)
		await api(ownerToken, `/courses/${created.myCourseId}/`, { method: 'DELETE' });
	if (created.otherCourseId)
		await api(otherToken, `/courses/${created.otherCourseId}/`, { method: 'DELETE' });
	// An organisation is deactivated, never deleted (house rule 12) — so the check afterwards is
	// that it has left the public list, not that the row is gone.
	if (created.orgId)
		await api(ownerToken, `/organizations/${created.orgId}/`, { method: 'DELETE' });
}

const owner = await person('owner');
await seat(owner, ownerToken);

const me = await api(ownerToken, '/auth/me/');
const other = await api(otherToken, '/auth/me/');
// A display name may be blank on a seeded account, and `''.includes('')` is a vacuous pass
// (trap 8) — fall back to the username, which is what the app itself draws in that case.
const nameOf = (who) => who.body?.display_name || who.body?.username || '(nobody)';

console.log('\n1. Founding one through the real form');

await goto(owner, '/organizations/new');
check('the form is there', (await owner.locator('form.edit-form').count()) === 1);
await owner.locator('form.edit-form input[type="text"]').first().fill(ORG_NAME);
await owner.locator('form.edit-form select').first().selectOption('student_circle');
await owner.locator('form.edit-form input[type="text"]').nth(1).fill('Warszawa');
await owner
	.locator('form.edit-form textarea')
	.fill(`A student circle made by an e2e run, ${RUN}.\n\nWith **bold** text.`);
await owner.locator('form.edit-form button[type="submit"]').click();
await owner.waitForURL(/\/organizations\/[^/]+$/, { timeout: 20000 }).catch(() => null);
check(
	'it lands on the new organisation page',
	/\/organizations\/[^/]+$/.test(owner.url()),
	owner.url()
);
check('with its name as the heading', (await waitForText(owner, 'h1', ORG_NAME)) === true);

const listed = await api(
	ownerToken,
	`/organizations/?q=${encodeURIComponent(`E2E Circle ${RUN}`)}`
);
created.orgId = listed.body?.[0]?.id ? String(listed.body[0].id) : null;
created.orgSlug = listed.body?.[0]?.slug ?? null;
check('the API has exactly one row for it', Array.isArray(listed.body) && listed.body.length === 1);

check(
	'the founder is on the roster as Owner',
	((await owner.locator('.block').nth(1).textContent()) ?? '').includes('Owner')
);
check(
	'the description rendered as Markdown',
	(await owner.locator('.math-content strong').count()) >= 1
);
check(
	'the page says a membership grants nothing on what it runs',
	((await owner.locator('.page').textContent()) ?? '').includes('gives nobody any standing')
);
await owner.screenshot({ path: 'e2e/screens/organizations-page.png', fullPage: true });

console.log('\n2. The directory, its tabs and its search');

await goto(owner, '/organizations');
check('the directory renders', (await waitForText(owner, 'h1', 'Organisations')) === true);
await owner.locator('.filters input[type="text"]').fill(`E2E Circle ${RUN}`);
await owner.locator('.filters button[type="submit"]').click();
await settle(owner, 1200);
check('search narrows to exactly one card', (await owner.locator('.orgs .card').count()) === 1);
await owner.getByRole('tab', { name: 'Mine', exact: true }).click();
await settle(owner, 1200);
check(
	'the Mine tab contains it',
	((await owner.locator('.orgs').textContent()) ?? '').includes(ORG_NAME)
);
await owner.screenshot({ path: 'e2e/screens/organizations-directory.png', fullPage: true });

console.log('\n3. A stranger sees the page, and none of its controls');

const stranger = await person('stranger');
await goto(stranger, `/organizations/${created.orgSlug}`);
check('a signed-out reader sees it', (await waitForText(stranger, 'h1', ORG_NAME)) === true);
check('and no Manage link', (await stranger.locator('a.manage').count()) === 0);

console.log('\n4. Linking something — and the refusal that comes as a sentence');

const mine = await api(ownerToken, '/courses/', {
	method: 'POST',
	body: JSON.stringify({ title: `E2E org course ${RUN}`, visibility: 'public' })
});
created.myCourseId = mine.body?.id ? String(mine.body.id) : null;
const theirs = await api(otherToken, '/courses/', {
	method: 'POST',
	body: JSON.stringify({ title: `E2E other course ${RUN}`, visibility: 'public' })
});
created.otherCourseId = theirs.body?.id ? String(theirs.body.id) : null;
check('two scratch courses exist', Boolean(created.myCourseId && created.otherCourseId));

await goto(owner, `/organizations/${created.orgSlug}/manage`);
check('the manage page opens for its owner', (await owner.locator('.block').count()) >= 3);

// Somebody else's course: visible, so not a 404 — refused because both sides have to agree.
const linkForm = owner.locator('form.add-form').nth(1);
await linkForm.locator('input[inputmode="numeric"]').fill(created.otherCourseId);
await linkForm.locator('button[type="submit"]').click();
await settle(owner, 1200);
check(
	'linking somebody else’s course refuses IN WORDS',
	((await owner.locator('.error').textContent()) ?? '').includes('both sides have to agree'),
	(await owner.locator('.error').textContent()) ?? '(no error line)'
);

await linkForm.locator('input[inputmode="numeric"]').fill(created.myCourseId);
await linkForm.locator('button[type="submit"]').click();
await settle(owner, 1400);
check(
	'linking her own course works',
	((await owner.locator('.links').textContent()) ?? '').includes(`E2E org course ${RUN}`)
);

console.log('\n5. The roster, and the last-owner invariant');

const rosterForm = owner.locator('form.add-form').first();
await rosterForm.locator('input[inputmode="numeric"]').fill(String(other.body.id));
await rosterForm.locator('button[type="submit"]').click();
await settle(owner, 1200);
check(
	'a second person joins the roster by account id',
	((await owner.locator('.roster').textContent()) ?? '').includes(nameOf(other))
);

// The sole owner trying to leave: the server recounts and refuses with `last_owner`.
const ownRow = owner
	.locator('.roster li')
	.filter({ hasText: me.body.display_name ?? '' })
	.first();
await ownRow.getByRole('button', { name: 'Leave', exact: true }).click();
await settle(owner, 1200);
check(
	'the last owner cannot leave, and is told why',
	((await owner.locator('.error').textContent()) ?? '').includes('at least one owner'),
	(await owner.locator('.error').textContent()) ?? '(no error line)'
);
await owner.screenshot({ path: 'e2e/screens/organizations-manage.png', fullPage: true });

console.log('\n6. The badge on the course’s own page');

await goto(owner, `/courses/${created.myCourseId}`);
const panel = owner.locator('.orgs-panel');
// The panel draws nothing until BOTH its requests have landed, and `goto`'s settle is not that —
// counting straight after the navigation found 0 on the first run while the very next check, one
// await later, read the badge fine. Wait for the thing, then count it (trap 25's other half).
await panel.waitFor({ state: 'visible', timeout: 25000 }).catch(() => null);
check('the management panel is on the course page', (await panel.count()) === 1);
check(
	'…and carries the organisation’s badge',
	((await panel.textContent()) ?? '').includes(ORG_NAME),
	((await panel.textContent()) ?? '').slice(0, 160)
);
await owner.screenshot({ path: 'e2e/screens/organizations-course-panel.png', fullPage: true });

console.log('\n7. The kill switch, as a NON-staff visitor');

await setFlag(false);
const off = await person('flag-off');
await seat(off, ownerToken);

check(
	'the Add… menu loses "New organisation"',
	!(await menuText(off, 'Add…')).includes('New organisation')
);
check(
	'the account menu loses "My organisations"',
	!(await menuText(off, 'Your account')).includes('My organisations')
);

await goto(off, `/courses/${created.myCourseId}`);
check('the panel goes', (await off.locator('.orgs-panel').count()) === 0);
check(
	'…and the rest of the course page is still there',
	((await off.locator('h1').first().textContent()) ?? '').includes(`E2E org course ${RUN}`)
);

await goto(off, '/organizations');
check(
	'the directory shows the disabled notice',
	(await off.locator('.feature-disabled').count()) === 1,
	((await off.locator('body').textContent()) ?? '').slice(0, 140)
);
await off.screenshot({ path: 'e2e/screens/organizations-killed.png', fullPage: true });

await setFlag(true);

console.log('\n8. Cleaning up');

await cleanUp();
// Asked ANONYMOUSLY on purpose, and it has to be: a dissolved body stays visible to its own roster
// (`access.visible_organizations`), so the owner's own list is exactly the one place it does NOT
// disappear from — the first run's check asked as the owner and failed for that reason. This URL has
// never been fetched anonymously in this run, so the 60 s read cache (trap 12) has nothing stale to
// hand back.
const gone = await api(null, `/organizations/?q=${encodeURIComponent(`E2E Circle ${RUN}`)}`);
check(
	'the scratch organisation has left the public list',
	Array.isArray(gone.body) && !gone.body.some((row) => row.slug === created.orgSlug),
	JSON.stringify(gone.body).slice(0, 140)
);
const stillThere = await api(ownerToken, `/organizations/${created.orgId}/`);
check('…but its page still resolves for its own owner (tombstone)', stillThere.status === 200);

console.log(`\n${pass} passed, ${fail} failed`);
if (errors.length) console.log('page errors:\n' + errors.join('\n'));
else console.log('zero console/page errors');
await browser.close();
process.exit(fail === 0 && errors.length === 0 ? 0 : 1);
