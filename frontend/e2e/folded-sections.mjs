// Folded panels on an event and a course page (owner, 2026-10-08: "simplify and clean as rn its
// overwehalming: most things should be hidden under some kind of expandable sth").
//
//   1. every panel on `/events/[id]` and `/courses/[id]` draws as ONE line, shut, with its count;
//   2. the page is a fraction of its old height until something is opened;
//   3. opening a section grows it, and the choice SURVIVES A RELOAD (localStorage, per reader);
//   4. the control is a real disclosure: a button with `aria-expanded`, not a styled div;
//   5. a section the reader shuts stays shut, including one that is open by default.
//
// Run (ports must match whatever `run.sh`/test.md set up):
//   E2E_BASE=http://localhost:5173 E2E_API=http://127.0.0.1:8000/api node e2e/folded-sections.mjs
//
// Needs the conference demo (`manage.py seed_conference_demo`) for the event, and any course the
// seeded staff account can curate. Screenshots land in e2e/screens/folded-*.png — look at them.
import { mkdirSync } from 'node:fs';

let chromium;
try {
	({ chromium } = await import('playwright'));
} catch {
	({ chromium } = await import('playwright-core'));
}

const BASE = process.env.E2E_BASE ?? 'http://localhost:5173';
const API = process.env.E2E_API ?? 'http://127.0.0.1:8000/api';
// Resolved from the API rather than hard-coded: `seed_conference_demo --reset` re-creates the
// demo with a NEW id every time (e2e/CLAUDE.md's standing lesson about positional assumptions,
// one layer up — an id in a script is a position too).
const EVENT = process.env.E2E_EVENT ?? '';
const COURSE = process.env.E2E_COURSE ?? '';
const OUT = 'e2e/screens';
mkdirSync(OUT, { recursive: true });

let passed = 0;
let failed = 0;
function check(name, ok, detail = '') {
	if (ok) {
		passed += 1;
		console.log(`  ok   ${name}`);
	} else {
		failed += 1;
		console.log(`  FAIL ${name}${detail ? ` — ${detail}` : ''}`);
	}
}

const login = await fetch(`${API}/auth/login/`, {
	method: 'POST',
	headers: { 'Content-Type': 'application/json' },
	body: JSON.stringify({ username: 'u-kasia', password: 'password123' })
});
if (!login.ok) {
	console.error(`login failed: ${login.status} — is the backend up and seed_demo_users run?`);
	process.exit(1);
}
const { token } = await login.json();

async function firstId(path) {
	const rows = await (
		await fetch(`${API}${path}`, { headers: { Authorization: `Token ${token}` } })
	).json();
	return Array.isArray(rows) && rows.length ? String(rows[0].id) : '';
}
const eventId = EVENT || (await firstId('/events/'));
const courseId = COURSE || (await firstId('/courses/'));
if (!eventId || !courseId) {
	console.error('No event or no course to look at — seed one first.');
	process.exit(1);
}

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1200, height: 1000 } });
const page = await ctx.newPage();

async function openPage(path, attempt = 1) {
	await page.goto(`${BASE}${path}`, { waitUntil: 'load' });
	// `networkidle` never fires on an authenticated page — the notification stream is permanently
	// in flight (e2e/CLAUDE.md trap 2). Wait for the thing the checks read instead.
	try {
		await page.waitForSelector('[data-fold]', { timeout: 45000 });
	} catch (err) {
		// A long chain of full reloads exhausts the Vite dev server and times out a navigation that
		// works perfectly on its own (e2e/CLAUDE.md trap 3). One retry, then believe it.
		if (attempt > 2) throw err;
		console.log(`  …retrying ${path} (attempt ${attempt + 1})`);
		await page.waitForTimeout(3000);
		return openPage(path, attempt + 1);
	}
	await page.waitForTimeout(1500);
}

async function folds() {
	return Promise.all(
		(await page.locator('[data-fold]').all()).map(async (f) => ({
			key: await f.getAttribute('data-fold'),
			expanded: await f.locator('button[aria-expanded]').first().getAttribute('aria-expanded')
		}))
	);
}

await page.goto(BASE, { waitUntil: 'load' });
await page.evaluate((t) => localStorage.setItem('edmat-auth-token', t), token);

for (const [label, path] of [
	['event', `/events/${eventId}`],
	['course', `/courses/${courseId}`]
]) {
	console.log(`\n${label} ${path}`);
	// A fresh reader every time: the fold state is per-browser, and a run that inherited the last
	// run's open sections would assert nothing.
	await page.evaluate(() => localStorage.removeItem('edmat-open-sections'));
	await openPage(path);

	const rows = await folds();
	check(`${label}: panels are folded`, rows.length >= 3, `${rows.length} folds`);
	check(
		`${label}: every one is shut to begin with`,
		rows.every((r) => r.expanded === 'false'),
		rows
			.filter((r) => r.expanded !== 'false')
			.map((r) => r.key)
			.join(', ')
	);
	const shutHeight = await page.evaluate(() => document.body.scrollHeight);
	await page.screenshot({ path: `${OUT}/folded-${label}-shut.png`, fullPage: true });

	// Open the first one and watch the page grow.
	const first = rows[0].key;
	await page.locator(`[data-fold="${first}"] .fold__toggle`).first().click();
	await page.waitForTimeout(800);
	const openHeight = await page.evaluate(() => document.body.scrollHeight);
	check(
		`${label}: opening "${first}" shows something`,
		openHeight > shutHeight,
		`${shutHeight} → ${openHeight}`
	);
	check(
		`${label}: and says so to a screen reader`,
		(await page
			.locator(`[data-fold="${first}"] button[aria-expanded]`)
			.first()
			.getAttribute('aria-expanded')) === 'true'
	);
	await page.screenshot({ path: `${OUT}/folded-${label}-one-open.png`, fullPage: true });

	// The remembering half.
	await openPage(path);
	check(
		`${label}: "${first}" is still open after a reload`,
		(await page
			.locator(`[data-fold="${first}"] button[aria-expanded]`)
			.first()
			.getAttribute('aria-expanded')) === 'true'
	);
	await page.locator(`[data-fold="${first}"] .fold__toggle`).first().click();
	await page.waitForTimeout(500);
	await openPage(path);
	check(
		`${label}: and shut again after a reload`,
		(await page
			.locator(`[data-fold="${first}"] button[aria-expanded]`)
			.first()
			.getAttribute('aria-expanded')) === 'false'
	);
}

await browser.close();
console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
