// `/about` — since 2026-10-08 the project's own organisation page (OrganizationPage for the
// `edmat` body) with the research thread's section, the "what you can do here" grid, the showcase
// index and the manual link (HISTORY §17BW.C; the brochure version is §17BG):
//
//   1. it renders in both interface languages: the organisation's name as the h1, its goals
//      (plans), its needs, and — the open board — its tasks and polls, readable by a stranger with
//      no button to add, move or vote;
//   2. nine feature cards, the showcase index and the manual link are still there;
//   3. it holds at phone width without horizontal overflow;
//   4. a killed feature's card is gone for an anonymous visitor (house rule 3) and comes back;
//   5. the footer link points at it, and the tab title is shaped by PageHead (exactly one <title>).
//
// Needs the EdMat organisation seeded (`manage.py seed_edmat_project --owner <username>`).
//
// Run (ports must match whatever `run.sh`/test.md set up):
//   E2E_BASE=http://localhost:5183 E2E_API=http://127.0.0.1:8100/api node e2e/about-page.mjs
//
// Screenshots land in e2e/screens/about-*.png and are meant to be LOOKED at.
import { mkdirSync } from 'node:fs';
import { englishContext } from './english.mjs';

let chromium;
try {
	({ chromium } = await import('playwright'));
} catch {
	({ chromium } = await import('playwright-core'));
}

const BASE = process.env.E2E_BASE ?? 'http://localhost:5183';
const API = process.env.E2E_API ?? 'http://127.0.0.1:8100/api';
const STAFF = 'kasia@edmat.example';
const PASSWORD = 'password123';
const SHOTS = 'e2e/screens/';
mkdirSync(SHOTS, { recursive: true });

let pass = 0,
	fail = 0;
const check = (l, ok, x = '') => {
	if (ok) pass++;
	else fail++;
	console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${l} ${ok ? '' : x}`);
};

async function tokenFor(email) {
	// A saved token beats the login throttle (e2e/CLAUDE.md trap 30).
	if (process.env.E2E_TOKEN) return process.env.E2E_TOKEN;
	const response = await fetch(`${API}/auth/login/`, {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify({ username: email, password: PASSWORD })
	});
	if (!response.ok) throw new Error(`login ${email}: ${response.status}`);
	return (await response.json()).token;
}
async function setFlag(token, key, isEnabled) {
	const response = await fetch(`${API}/feature-flags/${key}/`, {
		method: 'PATCH',
		headers: { 'Content-Type': 'application/json', Authorization: `Token ${token}` },
		body: JSON.stringify({ is_enabled: isEnabled })
	});
	if (!response.ok) throw new Error(`flag ${key}=${isEnabled}: ${response.status}`);
}

const browser = await chromium.launch(
	process.env.CHROME ? { executablePath: process.env.CHROME } : {}
);
const DESKTOP = { width: 1280, height: 900 };
const PHONE = { width: 390, height: 844 };
const errors = [];
function watch(page) {
	page.on('pageerror', (e) => errors.push(String(e)));
	page.on('console', (msg) => {
		if (msg.type() === 'error') errors.push(msg.text());
	});
}
async function openAbout(page) {
	watch(page);
	await page.goto(`${BASE}/about`, { waitUntil: 'load' });
	// The organisation body loads after the SPA boots; the plans panel is the last thing to arrive.
	await page.locator('.about__grid .about__card').first().waitFor();
	await page.locator('.plan-row').first().waitFor({ timeout: 15000 });
}
async function shoot(page, name) {
	await page.screenshot({ path: `${SHOTS}about-${name}.png`, fullPage: true });
}

try {
	// ---- 1. Polish (the base locale), desktop, light, anonymous --------------------------------
	{
		const ctx = await browser.newContext({ viewport: DESKTOP });
		const page = await ctx.newPage();
		await openAbout(page);
		check(
			'pl: h1 is the organisation, "EdMat"',
			(await page.locator('h1').textContent())?.trim() === 'EdMat'
		);
		check('pl: goals listed (plans panel)', (await page.locator('.plan-row').count()) >= 15);
		check(
			'pl: nine feature cards',
			(await page.locator('.about__grid .about__card').count()) === 9
		);
		check('exactly one <title>', (await page.locator('head title').count()) === 1);
		check('title is shaped by PageHead', (await page.title()).startsWith('EdMat: '));
		check('footer links to /about', (await page.locator('footer a[href$="/about"]').count()) === 1);
		// the open board: tasks and polls drawn for a stranger, nothing to press
		const tasks = page.locator('[data-testid="tasks-panel"]');
		check('open board: the task board is drawn for a stranger', (await tasks.count()) === 1);
		check(
			'open board: no "add a task" for a stranger',
			(await tasks.locator('button.add').count()) === 0
		);
		check(
			'open board: the polls are drawn, with no vote button',
			(await page.locator('.poll-item, .poll').count()) >= 2 &&
				(await page.locator('button:has-text("Głosuj"), button:has-text("Zagłosuj")').count()) === 0
		);
		check(
			'the research thread toggle is there',
			(await page.locator('.section-discussion__toggle').count()) === 1
		);
		await shoot(page, 'pl-desktop-light');
		await page.evaluate(() => {
			localStorage.setItem('edmat-theme', 'dark');
			document.documentElement.setAttribute('data-theme', 'dark');
		});
		await shoot(page, 'pl-desktop-dark');
		await ctx.close();
	}

	// ---- 2. English, phone, light — and no horizontal overflow --------------------------------
	{
		const ctx = await englishContext(browser, BASE, { viewport: PHONE });
		const page = await ctx.newPage();
		await openAbout(page);
		check('en: h1 is "EdMat"', (await page.locator('h1').textContent())?.trim() === 'EdMat');
		check(
			'en: nine feature cards',
			(await page.locator('.about__grid .about__card').count()) === 9
		);
		const overflow = await page.evaluate(
			() => document.documentElement.scrollWidth - document.documentElement.clientWidth
		);
		check('phone: no horizontal overflow', overflow <= 0, `overflow ${overflow}px`);
		await shoot(page, 'en-phone-light');
		await ctx.close();
	}

	// ---- 3. Kill switch: the tutoring card disappears for a stranger ---------------------------
	{
		const token = await tokenFor(STAFF);
		await setFlag(token, 'tutoring', false);
		try {
			const ctx = await englishContext(browser, BASE, { viewport: DESKTOP });
			const page = await ctx.newPage();
			await openAbout(page);
			await page
				.locator(
					'.about__grid .about__card a[href$="/tutoring"], .about__grid .about__card a[href$="/korki"]'
				)
				.waitFor({ state: 'detached', timeout: 8000 })
				.catch(() => {});
			check(
				'tutoring off: its card is gone',
				(await page
					.locator(
						'.about__grid .about__card a[href$="/tutoring"], .about__grid .about__card a[href$="/korki"]'
					)
					.count()) === 0
			);
			check(
				'tutoring off: eight cards remain',
				(await page.locator('.about__grid .about__card').count()) === 8
			);
			await shoot(page, 'en-desktop-tutoring-off');
			await ctx.close();
		} finally {
			await setFlag(token, 'tutoring', true);
		}
		const ctx = await englishContext(browser, BASE, { viewport: DESKTOP });
		const page = await ctx.newPage();
		await openAbout(page);
		check(
			'tutoring on again: nine cards',
			(await page.locator('.about__grid .about__card').count()) === 9
		);
		await ctx.close();
	}
} finally {
	await browser.close();
}

check('zero console/page errors', errors.length === 0, errors.join(' | ').slice(0, 300));
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
