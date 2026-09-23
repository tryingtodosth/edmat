// The language selector, after 2026-09-23 (three owner asks, one script):
//
//   1. the picker is the FIRST control in the phone drawer — top of the drawer, beside the ✕;
//   2. a first-time visitor lands in Polish (`baseLocale`), unless `/api/locale-hint/` says their
//      address is outside Poland; a stored choice always wins and costs no request at all;
//   3. nothing anybody needs sits under the bar an in-app browser (Facebook Messenger) draws over
//      the bottom edge of the viewport — checked by injecting a 60px overlay and measuring.
//
// Run (ports must match whatever `run.sh`/test.md set up):
//   E2E_BASE=http://localhost:5183 E2E_API=http://127.0.0.1:8011/api node e2e/language-default.mjs
//
// Screenshots land in e2e/screens/ and are meant to be LOOKED at — check 3 in particular is a
// geometry assertion standing in for "can a thumb reach it", which a picture answers better.

import { mkdirSync } from 'node:fs';

let chromium;
try {
	({ chromium } = await import('playwright'));
} catch {
	({ chromium } = await import('playwright-core'));
}

const BASE = process.env.E2E_BASE ?? 'http://localhost:5183';
const API = process.env.E2E_API ?? 'http://127.0.0.1:8011/api';
const SHOTS = new URL('./screens/', import.meta.url).pathname;
mkdirSync(SHOTS, { recursive: true });

let pass = 0,
	fail = 0;
const check = (l, ok, x = '') => {
	if (ok) pass++;
	else fail++;
	console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${l} ${ok ? '' : x}`);
};

const browser = await chromium.launch(
	process.env.CHROME ? { executablePath: process.env.CHROME } : {}
);
const PHONE = { width: 390, height: 844 };
const DESKTOP = { width: 1280, height: 900 };
const errors = [];
const watch = (page) => {
	page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
	page.on('pageerror', (e) => errors.push(e.message));
	return page;
};

// Trap 11 of e2e/CLAUDE.md, and the reason the first version of this script lied to itself: on a
// dev server a fresh context waits seconds for Vite to compile, and until the bundle has hydrated
// the page is SERVER-rendered HTML with no behaviour at all. Every geometry check here would still
// have "passed" against a drawer that never opened, because a `visibility: hidden` element has a
// perfectly good bounding box. So hydration is waited for explicitly: the root layout's own boot
// request is the earliest honest proof that `onMount` has run.
const hydrated = (page) =>
	page.waitForResponse((r) => r.url().includes('/feature-flags/'), { timeout: 90000 });
const openDrawer = async (page) => {
	await page.locator('.drawer-toggle').click();
	await page.locator('.drawer--open').waitFor({ timeout: 15000 });
	await page.waitForTimeout(400);
};

// ── 0. the endpoint itself ────────────────────────────────────────────────────────────────────
// Asserted through a real request rather than trusted from the unit tests: a local run has no
// GeoIP database, so this is the "I cannot tell → Polish" path every clone is on.
{
	const res = await fetch(`${API}/locale-hint/`);
	const body = await res.json();
	check('GET /api/locale-hint/ answers 200', res.status === 200, String(res.status));
	check('with no GeoIP database it suggests Polish', body.suggested_locale === 'pl', body);
	check('and says honestly that it knows no country', body.country === null, String(body.country));
	check(
		'and is never cached — the answer is per-caller',
		res.headers.get('cache-control') === 'no-store',
		String(res.headers.get('cache-control'))
	);
}

// ── 1. a fresh visitor lands in Polish ────────────────────────────────────────────────────────
{
	const ctx = await browser.newContext({ viewport: DESKTOP });
	const page = watch(await ctx.newPage());
	const hintCalls = [];
	page.on('request', (r) => r.url().includes('/locale-hint/') && hintCalls.push(r.url()));
	const booted = hydrated(page);
	await page.goto(`${BASE}/`, { waitUntil: 'load' });
	await booted;
	await page.waitForTimeout(1500);
	check(
		'a fresh context paints <html lang="pl">',
		(await page.locator('html').getAttribute('lang')) === 'pl'
	);
	check(
		'the interface is Polish',
		(await page.locator('header .site-nav').innerText()).includes('Zadania'),
		await page.locator('header .site-nav').innerText()
	);
	check(
		'the picker itself reads PL',
		(await page.locator('header select').first().inputValue()) === 'pl'
	);
	check('the hint was asked exactly once', hintCalls.length === 1, String(hintCalls.length));
	await page.screenshot({ path: `${SHOTS}language-desktop-pl.png` });

	// Second load in the same browser: the offer is remembered, so nothing is asked again.
	hintCalls.length = 0;
	const booted2 = hydrated(page);
	await page.goto(`${BASE}/disciplines`, { waitUntil: 'load' });
	await booted2;
	await page.waitForTimeout(1200);
	check('a second load asks nothing', hintCalls.length === 0, String(hintCalls.length));
	await ctx.close();
}

// ── 1b. the other answer: somebody the server places outside Poland ──────────────────────────
// A local run has no GeoIP database, so the only honest way to drive this half in a browser is to
// answer the request the way a server WITH one would. Everything after the answer — applying it,
// remembering it as an OFFER rather than a choice, not asking again — is the real code path.
{
	const ctx = await browser.newContext({ viewport: DESKTOP });
	const page = watch(await ctx.newPage());
	await page.route('**/locale-hint/', (route) =>
		route.fulfill({
			status: 200,
			contentType: 'application/json',
			body: JSON.stringify({ suggested_locale: 'en', country: 'DE' })
		})
	);
	const booted = hydrated(page);
	await page.goto(`${BASE}/`, { waitUntil: 'load' });
	await booted;
	await page
		.locator('header .site-nav')
		.getByText('Exercises', { exact: true })
		.waitFor({ timeout: 15000 })
		.catch(() => {});
	const nav = await page.locator('header .site-nav').innerText();
	check('a visitor placed in DE is moved to English', nav.includes('Exercises'), nav);
	check('and <html lang> follows', (await page.locator('html').getAttribute('lang')) === 'en');
	const stored = await page.evaluate(() => [
		localStorage.getItem('edmat.localeGuess'),
		localStorage.getItem('edmat.localeChoice')
	]);
	check(
		'it is remembered as an offer, not written down as a choice',
		stored[0] === 'en' && stored[1] === null,
		JSON.stringify(stored)
	);
	await ctx.close();
}

// ── 2. a stored choice wins, in both places it can be stored ─────────────────────────────────
for (const [how, seed] of [
	[
		'a Paraglide cookie',
		async (ctx) => ctx.addCookies([{ name: 'PARAGLIDE_LOCALE', value: 'en', url: BASE }])
	],
	[
		'a locale in localStorage',
		async (ctx) => ctx.addInitScript(() => localStorage.setItem('PARAGLIDE_LOCALE', 'en'))
	]
]) {
	const ctx = await browser.newContext({ viewport: DESKTOP });
	await seed(ctx);
	const page = watch(await ctx.newPage());
	const hintCalls = [];
	page.on('request', (r) => r.url().includes('/locale-hint/') && hintCalls.push(r.url()));
	const booted = hydrated(page);
	await page.goto(`${BASE}/`, { waitUntil: 'load' });
	await booted;
	await page.waitForTimeout(1500);
	const nav = await page.locator('header .site-nav').innerText();
	check(`${how} keeps the interface English`, nav.includes('Exercises'), nav);
	check(`${how} needs no request`, hintCalls.length === 0, String(hintCalls.length));
	check(
		`${how} leaves <html lang="en">`,
		(await page.locator('html').getAttribute('lang')) === 'en'
	);
	if (how.startsWith('a Paraglide'))
		await page.screenshot({ path: `${SHOTS}language-desktop-en.png` });
	await ctx.close();
}

// ── 3. the phone drawer: the picker is the first thing, and nothing hides under the bottom bar ─
{
	const ctx = await browser.newContext({ viewport: PHONE });
	const page = watch(await ctx.newPage());
	const booted = hydrated(page);
	await page.goto(`${BASE}/`, { waitUntil: 'load' });
	await booted;
	await page.waitForTimeout(800);
	await openDrawer(page);
	check('the drawer really opened', (await page.locator('.drawer--open').count()) === 1);

	const picker = page.locator('.drawer select');
	const close = page.locator('.drawer__close');
	const p = await picker.boundingBox();
	const c = await close.boundingBox();
	check('the drawer holds the language picker', p !== null);
	check('it is in the top 120px of the screen', p.y + p.height <= 120, JSON.stringify(p));
	check(
		'it is on the ✕ line, not under it',
		Math.abs(p.y + p.height / 2 - (c.y + c.height / 2)) < 24,
		`picker ${JSON.stringify(p)} close ${JSON.stringify(c)}`
	);
	check('and to the left of the ✕', p.x + p.width <= c.x, `${p.x + p.width} vs ${c.x}`);

	// Messenger's own toolbar: a fixed 60px band over the bottom edge of the viewport. The page
	// cannot see it (that is the whole problem), so it is injected and then measured against.
	await page.evaluate(() => {
		const bar = document.createElement('div');
		bar.id = 'e2e-messenger-bar';
		bar.style.cssText =
			'position:fixed;left:0;right:0;bottom:0;height:60px;background:rgba(220,40,40,.75);' +
			'z-index:2147483647;color:#fff;font:600 13px sans-serif;display:flex;align-items:center;' +
			'justify-content:center';
		bar.textContent = 'Messenger bar (60px)';
		document.body.appendChild(bar);
	});
	await page.waitForTimeout(200);
	// Scroll the drawer itself to its end — the worst case for anything that lives at the bottom.
	await page.locator('.drawer').evaluate((d) => d.scrollTo(0, d.scrollHeight));
	await page.waitForTimeout(400);
	const stillThere = await picker.boundingBox();
	check(
		'the picker is STILL on screen with the drawer scrolled to its end (sticky top)',
		stillThere && stillThere.y >= 0 && stillThere.y + stillThere.height <= 120,
		JSON.stringify(stillThere)
	);
	const lastItem = page.locator('.drawer a, .drawer button').last();
	const l = await lastItem.boundingBox();
	check(
		'the last thing in the drawer clears the bar',
		l && l.y + l.height <= PHONE.height - 60,
		`${JSON.stringify(l)} vs ${PHONE.height - 60}`
	);
	await page.screenshot({ path: `${SHOTS}language-drawer-phone-pl.png` });

	// The other place a control lives at the very bottom: the end of the document.
	await page.locator('.drawer__close').click();
	await page.waitForTimeout(400);
	await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
	await page.waitForTimeout(600);
	const footerLink = page.locator('.site-footer__links a').last();
	const f = await footerLink.boundingBox();
	check(
		'the last footer link clears the bar too',
		f && f.y + f.height <= PHONE.height - 60,
		`${JSON.stringify(f)} vs ${PHONE.height - 60}`
	);
	await page.screenshot({ path: `${SHOTS}language-page-bottom-phone.png` });

	// ── 4. switching through the picker actually re-renders ───────────────────────────────────
	await openDrawer(page);
	await page.locator('.drawer select').selectOption('en');
	await page.waitForTimeout(600);
	const drawerText = await page.locator('.drawer').innerText();
	check(
		'switching to EN re-renders the drawer in place',
		drawerText.includes('My Set'),
		drawerText.slice(0, 120)
	);
	check('and updates <html lang>', (await page.locator('html').getAttribute('lang')) === 'en');
	await page.screenshot({ path: `${SHOTS}language-drawer-phone-en.png` });
	await page.locator('.drawer__close').click();
	await page.waitForTimeout(300);
	const rebooted = hydrated(page);
	await page.reload({ waitUntil: 'load' });
	await rebooted;
	await page.waitForTimeout(1200);
	check(
		'the choice survives a reload',
		(await page.locator('html').getAttribute('lang')) === 'en' &&
			(await page.locator('body').innerText()).includes('Exercises')
	);
	await ctx.close();
}

check('zero console/page errors', errors.length === 0, errors.join(' | '));
console.log(`\n${pass} passed, ${fail} failed`);
console.log(`screenshots in ${SHOTS}`);
await browser.close();
process.exit(fail ? 1 : 0);
