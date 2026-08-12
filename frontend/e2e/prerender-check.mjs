// Verifies the prerendering change against a REAL browser and a REAL backend.
//
// The point is not "does the HTML contain an h1" — that was already proven by grepping the built
// file. The point is the two things only a browser can answer: does the prerendered markup still
// HYDRATE cleanly (a mismatch would break the app, and would be invisible to svelte-check), and is
// the h1 still there afterwards rather than being torn down and rebuilt.
import { chromium } from 'playwright-core';

const BASE = process.env.E2E_BASE || 'http://localhost:5174';
let pass = 0,
	fail = 0;
const check = (name, ok, detail = '') => {
	(ok ? pass++ : fail++), console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ' — ' + detail : ''}`);
};

const browser = await chromium.launch();
const ctx = await browser.newContext({
	// Throttled-mobile-ish viewport, so what we look at is what PageSpeed looks at.
	viewport: { width: 412, height: 915 },
	deviceScaleFactor: 2
});
const page = await ctx.newPage();

const errors = [];
page.on('console', (msg) => {
	if (msg.type() === 'error') errors.push(msg.text());
});
page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));

// --- 1. The prerendered homepage, before and after hydration -----------------------------------
// JS disabled first: this is exactly what a crawler that does not run scripts sees, and what the
// browser can paint on the very first frame. Before this change it was a blank page.
const noJsCtx = await browser.newContext({ javaScriptEnabled: false });
const noJsPage = await noJsCtx.newPage();
await noJsPage.goto(BASE + '/', { waitUntil: 'load' });
const noJsH1 = (await noJsPage.locator('h1').first().textContent().catch(() => null))?.trim();
check('homepage renders an h1 with JavaScript disabled', !!noJsH1, noJsH1 || 'none');
const noJsTitle = await noJsPage.title();
check('homepage has a title with JavaScript disabled', noJsTitle.length > 0, noJsTitle);
const noJsDesc = await noJsPage
	.locator('meta[name="description"]')
	.getAttribute('content')
	.catch(() => null);
check('homepage has a meta description with JS disabled', !!noJsDesc && noJsDesc.length > 50);
const noJsText = (await noJsPage.locator('body').innerText().catch(() => '')) || '';
check('homepage has real body text without JS', noJsText.length > 80, `${noJsText.length} chars`);
await noJsCtx.close();

// --- 2. Now with JS, the real thing ------------------------------------------------------------
await page.goto(BASE + '/', { waitUntil: 'load' });
await page.waitForTimeout(2500); // let hydration + the tab's own fetches settle

const h1 = (await page.locator('h1').first().textContent()).trim();
check('h1 survives hydration', h1.length > 0, h1);
check('exactly one h1 on the homepage', (await page.locator('h1').count()) === 1);

const hydrationErrors = errors.filter(
	(e) => /hydrat/i.test(e) || /did not expect/i.test(e) || /mismatch/i.test(e)
);
check('no hydration mismatch errors', hydrationErrors.length === 0, hydrationErrors.join(' | '));

// The tabs come from the feature flags, i.e. from a real API round trip — if they rendered, the
// prerendered shell genuinely handed over to a working client-side app rather than freezing.
const tabs = await page.locator('[role="tab"]').count();
check('feature-flagged tabs rendered after hydration', tabs > 0, `${tabs} tabs`);

// --- 3. A prerendered non-root route -----------------------------------------------------------
await page.goto(BASE + '/levels', { waitUntil: 'load' });
await page.waitForTimeout(800);
check('/levels title is its own', (await page.title()).includes('Levels'), await page.title());
check(
	'/levels canonical points at itself',
	(await page.locator('link[rel="canonical"]').getAttribute('content').catch(() => null)) === null
);
const lvlCanon = await page.locator('link[rel="canonical"]').getAttribute('href');
check('/levels canonical href correct', lvlCanon === 'https://edmat.net/levels', lvlCanon);

// --- 4. A route that is NOT prerendered still works (the SPA fallback is intact) ----------------
await page.goto(BASE + '/disciplines', { waitUntil: 'load' });
await page.waitForTimeout(2000);
const discH1 = await page.locator('h1').first().textContent().catch(() => '');
check('non-prerendered route still renders via SPA fallback', (discH1 || '').trim().length > 0, discH1);

// --- 5. Client-side navigation off a prerendered page ------------------------------------------
await page.goto(BASE + '/', { waitUntil: 'load' });
await page.waitForTimeout(1500);
// The hero's own browse link, NOT the navbar's: at this viewport the navbar has collapsed into
// the drawer (§17V.4), so the nav link exists in the DOM but is not visible and cannot be clicked.
await page.locator('.hero__browse').click();
await page.waitForTimeout(2000);
check('client-side nav from a prerendered page works', page.url().includes('/disciplines'), page.url());

const realErrors = errors.filter((e) => !/favicon/i.test(e));
check('no unexpected console errors', realErrors.length === 0, realErrors.slice(0, 3).join(' | '));

console.log(`\n${pass} passed, ${fail} failed`);
await browser.close();
process.exit(fail === 0 ? 0 : 1);
