// The landing page, `/about` (2026-09-24):
//
//   1. it renders in both interface languages with the same section count and eight feature cards;
//   2. it holds under both themes and at phone width without horizontal overflow;
//   3. a killed feature's card is gone for an anonymous visitor (house rule 3 — links, not just
//      pages), and comes back when the switch is flipped on again;
//   4. the footer link points at it, and the tab title is shaped by PageHead (exactly one <title>).
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
const SHOTS = new URL('./screens/', import.meta.url).pathname;
mkdirSync(SHOTS, { recursive: true });

let pass = 0,
	fail = 0;
const check = (l, ok, x = '') => {
	if (ok) pass++;
	else fail++;
	console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${l} ${ok ? '' : x}`);
};

async function tokenFor(email) {
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
	await page.locator('.about__grid .about__card').first().waitFor();
}

async function shoot(page, name) {
	await page.screenshot({ path: `${SHOTS}about-${name}.png`, fullPage: true });
}

try {
	// ---- 1. Polish (the base locale), desktop, light ------------------------------------------
	{
		const ctx = await browser.newContext({ viewport: DESKTOP });
		const page = await ctx.newPage();
		await openAbout(page);
		check(
			'pl: h1 is "O EdMacie"',
			(await page.locator('h1').textContent())?.trim() === 'O EdMacie'
		);
		check(
			'pl: eight feature cards',
			(await page.locator('.about__grid .about__card').count()) === 8
		);
		check('pl: seven audience bands', (await page.locator('.about__bands li').count()) === 7);
		check('pl: seven h2 sections', (await page.locator('article.about h2').count()) === 7);
		check('exactly one <title>', (await page.locator('head title').count()) === 1);
		check('title is shaped by PageHead', (await page.title()).startsWith('EdMat: '));
		check(
			'anonymous: register CTA in the hero',
			(await page.locator('.about__cta a[href$="/register"]').count()) === 1
		);
		check('footer links to /about', (await page.locator('footer a[href$="/about"]').count()) === 1);
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
		check(
			'en: h1 is "About EdMat"',
			(await page.locator('h1').textContent())?.trim() === 'About EdMat'
		);
		check(
			'en: eight feature cards',
			(await page.locator('.about__grid .about__card').count()) === 8
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
			// The flags load after hydration; wait for the card to go rather than counting at once.
			await page
				.locator('.about__grid .about__card a[href$="/services"]')
				.waitFor({ state: 'detached', timeout: 8000 })
				.catch(() => {});
			check(
				'tutoring off: its card is gone',
				(await page.locator('.about__grid .about__card a[href$="/services"]').count()) === 0
			);
			check(
				'tutoring off: seven cards remain',
				(await page.locator('.about__grid .about__card').count()) === 7
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
			'tutoring on again: eight cards',
			(await page.locator('.about__grid .about__card').count()) === 8
		);
		await ctx.close();
	}
} finally {
	await browser.close();
}
check('zero console/page errors', errors.length === 0, errors.join(' | ').slice(0, 300));

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
