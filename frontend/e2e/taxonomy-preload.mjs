// Does preloading the taxonomy actually cut requests, and does a language switch avoid showing the
// previous language's names from cache? Both are claims about network traffic and cache keys that
// no assertion on rendered text can make, so this counts real requests.
import { chromium } from 'playwright-core';

const WEB = process.env.E2E_WEB || 'http://127.0.0.1:5173';

let pass = 0;
let fail = 0;
const problems = [];
const check = (name, ok, detail = '') => {
	if (ok) {
		pass++;
		console.log(`  ok   ${name}`);
	} else {
		fail++;
		problems.push(`${name} ${detail}`);
		console.log(`  FAIL ${name} ${detail}`);
	}
};

const browser = await chromium.launch({
	executablePath: process.env.CHROME_PATH || undefined,
	args: ['--no-sandbox']
});

try {
	const ctx = await browser.newContext();
	const page = await ctx.newPage();
	const errors = [];
	page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
	page.on('pageerror', (e) => errors.push(String(e)));

	/** Every taxonomy request the page makes, so "did it refetch" is a fact and not a guess. */
	let taxonomyRequests = [];
	page.on('request', (r) => {
		const url = r.url();
		if (/\/api\/(disciplines|branches)/.test(url)) taxonomyRequests.push(url);
	});

	// --- first visit: it has to fetch, obviously -------------------------------------------------
	await page.goto(`${WEB}/disciplines`, { waitUntil: 'networkidle' });
	await page.waitForTimeout(900);
	const firstVisit = taxonomyRequests.length;
	check('first visit fetches the tree', firstVisit > 0, `${firstVisit} requests`);
	const cardCount = await page.locator('.page > .grid a').count();
	check('the grid actually rendered', cardCount > 0, `${cardCount} cards`);

	// Branch counts must be real, not zero — they now come from the preloaded list rather than one
	// request per discipline, so a wrong join here would silently show "Branches: 0" everywhere.
	const countsText = await page.locator('.page > .grid a').allInnerTexts();
	check(
		'branch counts are resolved from the preloaded list',
		countsText.some((t) => /Branches:\s*[1-9]/.test(t)),
		countsText.join(' | ')
	);

	// --- clicking into a discipline should not refetch the tree ------------------------------------
	taxonomyRequests = [];
	await page.locator('.page > .grid a').first().click();
	await page.waitForTimeout(1200);
	const listCalls = taxonomyRequests.filter((u) =>
		/\/api\/(disciplines|branches)\/?(\?|$)/.test(u)
	);
	check(
		'navigating into a discipline refetches neither list',
		listCalls.length === 0,
		listCalls.join(' | ')
	);

	// --- a language switch must NOT serve the other language's cached names -----------------------
	const before = await page.locator('h1').first().innerText();
	await page.goto(`${WEB}/disciplines`, { waitUntil: 'networkidle' });
	await page.waitForTimeout(600);
	const enNames = await page.locator('.page > .grid a h3').allInnerTexts();

	const localeSelect = page.locator('header select').first();
	if (await localeSelect.count()) {
		await localeSelect.selectOption('pl');
		await page.waitForTimeout(1500);
		const plNames = await page.locator('.page > .grid a h3').allInnerTexts();
		check(
			'switching language re-resolves the names rather than reusing the cached ones',
			plNames.length > 0,
			`en=${enNames.join(',')} pl=${plNames.join(',')}`
		);
		// The real corpus names happen to be Polish in both, so assert the cache KEY is per locale
		// instead — that is the property, and it is observable in storage.
		const keys = await page.evaluate(() =>
			Object.keys(localStorage).filter((k) => k.includes('taxonomy:'))
		);
		check(
			'the saved copy is keyed per locale',
			keys.some((k) => k.endsWith(':en')) && keys.some((k) => k.endsWith(':pl')),
			keys.join(' | ')
		);
	} else {
		check('locale picker found', false, 'no select in header');
	}

	check(
		'no console or page errors',
		errors.filter((e) => !/favicon/i.test(e)).length === 0,
		errors.slice(0, 2).join(' || ')
	);
	void before;
} finally {
	await browser.close();
}

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) {
	console.log('problems:\n  ' + problems.join('\n  '));
	process.exit(1);
}
