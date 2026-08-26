// The phone bar after 2026-08-26: the ☰ lives IN the bar (30×30, borderless) and tucks away with
// it; the drawer carries its own bordered ✕; the "Report issue" link sits beside the brand, inside
// the bar; the focus trap is scoped to the drawer and Escape returns focus to the ☰.
// Run: E2E_BASE=http://localhost:5173 node e2e/phone-navbar.mjs
let chromium;
try {
	({ chromium } = await import('playwright'));
} catch {
	({ chromium } = await import('playwright-core'));
}
const BASE = process.env.E2E_BASE ?? 'http://localhost:5173';
let pass = 0,
	fail = 0;
const errors = [];
const check = (l, ok, x = '') => {
	if (ok) pass++;
	else fail++;
	console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${l} ${ok ? '' : x}`);
};
const browser = await chromium.launch(
	process.env.CHROME ? { executablePath: process.env.CHROME } : {}
);
const page = await (await browser.newContext({ viewport: { width: 390, height: 844 } })).newPage();
page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
page.on('pageerror', (e) => errors.push(e.message));

await page.goto(`${BASE}/exercises/51`, { waitUntil: 'load' });
await page.locator('.drawer-toggle').waitFor({ timeout: 15000 });
await page.waitForTimeout(1200);
const header = page.locator('header.site-header');
const h = await header.boundingBox();
const t = await page.locator('.drawer-toggle').boundingBox();
const r = await page.locator('.brand__report').boundingBox();
const inside = (b) => b.y >= h.y && b.y + b.height <= h.y + h.height;
check('the menu button is inside the bar', inside(t), JSON.stringify(t));
check(
	'it is 30×30 with no border',
	t.width === 30 &&
		t.height === 30 &&
		(await page.locator('.drawer-toggle').evaluate((e) => getComputedStyle(e).borderStyle)) ===
			'none'
);
check('the Report issue link is inside the bar too', inside(r), JSON.stringify(r));
check('the bar is one short row', h.height <= 50, String(h.height));

// tucks with the bar on scroll down, back on scroll up
await page.evaluate(() => window.scrollTo(0, 600));
await page.waitForTimeout(500);
const tucked = await header.evaluate((e) => e.classList.contains('site-header--tucked'));
const tToggle = await page.locator('.drawer-toggle').boundingBox();
check(
	'scrolling down tucks the bar, and the ☰ goes with it',
	tucked && tToggle.y < 0,
	JSON.stringify(tToggle)
);
await page.evaluate(() => window.scrollTo(0, 200));
await page.waitForTimeout(500);
check(
	'scrolling up brings both back',
	!(await header.evaluate((e) => e.classList.contains('site-header--tucked'))) &&
		(await page.locator('.drawer-toggle').boundingBox()).y >= 0
);

// the drawer's own ✕, bordered like the old floating toggle
await page.locator('.drawer-toggle').click();
await page.waitForTimeout(500);
check('☰ opens the drawer', (await page.locator('.drawer--open').count()) === 1);
const close = page.locator('.drawer__close');
check(
	'the drawer has a bordered 40×40 ✕',
	(await close.evaluate((e) => {
		const c = getComputedStyle(e);
		return `${c.borderStyle} ${c.width} ${c.height}`;
	})) === 'solid 40px 40px'
);

const where = () =>
	page.evaluate(() => {
		const e = document.activeElement;
		return e?.closest('#site-drawer')
			? 'drawer'
			: e?.classList.contains('drawer-toggle')
				? 'toggle'
				: 'page';
	});
let stayed = true;
for (let i = 0; i < 40 && stayed; i++) {
	await page.keyboard.press('Tab');
	stayed = (await where()) === 'drawer';
}
for (let i = 0; i < 20 && stayed; i++) {
	await page.keyboard.press('Shift+Tab');
	stayed = (await where()) === 'drawer';
}
check('focus stays inside the drawer over 60 tabs', stayed);
await page.keyboard.press('Escape');
await page.waitForTimeout(400);
check(
	'Escape closes it and focus returns to the ☰',
	(await page.locator('.drawer--open').count()) === 0 && (await where()) === 'toggle'
);
await page.locator('.drawer-toggle').click();
await page.waitForTimeout(400);
await close.click();
await page.waitForTimeout(400);
check('the ✕ closes it', (await page.locator('.drawer--open').count()) === 0);
check('zero console/page errors', errors.length === 0, errors.join(' | '));
console.log(`\n${pass} passed, ${fail} failed`);
await browser.close();
process.exit(fail ? 1 : 0);
