// Browser pass over the "Others" grouping and the taxonomy reply card.
// Uses playwright-core against the cached Chromium this project already relies on.
import { chromium } from 'playwright-core';

const WEB = process.env.E2E_WEB || 'http://127.0.0.1:5173';
const API = process.env.E2E_API || 'http://127.0.0.1:8001/api';

let pass = 0;
let fail = 0;
const problems = [];

function check(name, ok, detail = '') {
	if (ok) {
		pass++;
		console.log(`  ok   ${name}`);
	} else {
		fail++;
		problems.push(`${name} ${detail}`);
		console.log(`  FAIL ${name} ${detail}`);
	}
}

async function login(username, password) {
	const res = await fetch(`${API}/auth/login/`, {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify({ username, password })
	});
	if (!res.ok) throw new Error(`login ${username}: ${res.status}`);
	return (await res.json()).token;
}

const browser = await chromium.launch({
	executablePath: process.env.CHROME_PATH || undefined,
	args: ['--no-sandbox']
});

const consoleErrors = [];

async function newPage(token) {
	const ctx = await browser.newContext();
	const page = await ctx.newPage();
	page.on('console', (msg) => {
		if (msg.type() === 'error') consoleErrors.push(msg.text());
	});
	page.on('pageerror', (e) => consoleErrors.push(String(e)));
	if (token) {
		await page.goto(WEB);
		await page.evaluate((t) => localStorage.setItem('edmat-auth-token', t), token);
	}
	return page;
}

try {
	// --- 1. the disciplines index groups a pending node under "Others" ---------------------------
	const page = await newPage(null);
	await page.goto(`${WEB}/disciplines`, { waitUntil: 'networkidle' });
	await page.waitForTimeout(500);

	const othersSection = page.locator('section.proposed');
	check('disciplines: an Others section is rendered', (await othersSection.count()) > 0);
	if (await othersSection.count()) {
		const heading = await othersSection.locator('h2').first().innerText();
		check(
			'disciplines: Others heading reads correctly',
			/others|inne/i.test(heading),
			`got "${heading}"`
		);
		const cards = await othersSection.locator('a').count();
		check('disciplines: the pending node is inside it', cards > 0, `${cards} cards`);
		// Deliberately absent here: the heading and its hint have just said it, and the badge exists
		// for the contexts where no grouping is present to carry it (below).
		const badge = await othersSection.locator('.pending-badge').count();
		check(
			'disciplines: no duplicate badge inside the Others section',
			badge === 0,
			`${badge} badges`
		);
	}

	// The settled grid must NOT contain the pending one.
	const settledNames = await page.locator('.page > .grid a h3').allInnerTexts();
	check(
		'disciplines: the pending node is not in the settled grid',
		!settledNames.some((n) => /Verify Pending/i.test(n)),
		settledNames.join(' | ')
	);

	// --- 1b. on the node's OWN page, where there is no grouping, the badge is what says it --------
	await page.goto(`${WEB}/disciplines/verify-pending-zzz`, { waitUntil: 'networkidle' });
	await page.waitForTimeout(700);
	check(
		'a pending node says so on its own page',
		(await page.locator('h1 .pending-badge').count()) > 0
	);
	await page.goto(`${WEB}/disciplines/matematyka`, { waitUntil: 'networkidle' });
	await page.waitForTimeout(700);
	check('a settled node does not', (await page.locator('h1 .pending-badge').count()) === 0);

	// --- 2. a <select> groups pending nodes into an <optgroup> ------------------------------------
	const studentToken = await login('zzz-verify-student@example.test', 'verify-pw-123');
	const submitPage = await newPage(studentToken);
	await submitPage.goto(`${WEB}/submit`, { waitUntil: 'networkidle' });
	await submitPage.waitForTimeout(1500);
	// Asserted separately so "0 optgroups" can never silently mean "the form never rendered".
	check(
		'submit form: the form is actually on the page',
		(await submitPage.locator('form.submit-form select').count()) > 0
	);
	const optgroups = await submitPage.locator('form.submit-form select optgroup').count();
	check(
		'submit form: a pending discipline lands in an <optgroup>',
		optgroups > 0,
		`${optgroups} optgroups`
	);
	if (optgroups > 0) {
		const label = await submitPage
			.locator('form.submit-form select optgroup')
			.first()
			.getAttribute('label');
		check(
			'submit form: the optgroup is labelled',
			/others|inne/i.test(label || ''),
			`got "${label}"`
		);
	}

	// --- 3. the reply card renders as real text, not a missing key ---------------------------------
	const inbox = await newPage(studentToken);
	await inbox.goto(`${WEB}/notifications`, { waitUntil: 'networkidle' });
	await inbox.waitForTimeout(1200);
	const body = await inbox.locator('body').innerText();
	check('inbox: the approve reply is a real sentence', /part of the taxonomy/i.test(body), '');
	check('inbox: the merge reply says it was merged', /already existed/i.test(body), '');
	check('inbox: the move reply says it moved', /moved somewhere else/i.test(body), '');
	check('inbox: the reject reply says it was not added', /was not added/i.test(body), '');
	check('inbox: the destination travels with it', /Matematyka/.test(body), '');
	check('inbox: no unresolved message key leaked', !/notification_taxonomy/.test(body), '');

	await page.screenshot({
		path: '/home/alojzy/.claude/jobs/725bbfd4/tmp/others.png',
		fullPage: true
	});
	await inbox.screenshot({
		path: '/home/alojzy/.claude/jobs/725bbfd4/tmp/inbox.png',
		fullPage: true
	});
} finally {
	await browser.close();
}

const realErrors = consoleErrors.filter((e) => !/favicon/i.test(e));
check('no console or page errors', realErrors.length === 0, realErrors.slice(0, 3).join(' || '));

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) {
	console.log('problems:\n  ' + problems.join('\n  '));
	process.exit(1);
}
