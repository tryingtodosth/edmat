// End-to-end check that a material card's "+N more" count is a real control, not a dead label.
//
// Run it with both running:
//   backend:  DJANGO_CORS_ALLOWED_ORIGINS=http://localhost:5183 manage.py runserver 127.0.0.1:8011
//   frontend: PUBLIC_API_BASE_URL=http://127.0.0.1:8011/api npx vite dev --port 5183
//   node e2e/material-claims.mjs
//
// Playwright is deliberately not a dependency of this repo — `npx playwright install chromium`.
// This one script also accepts `playwright-core` (which IS a devDependency) plus an explicit
// CHROME=/path/to/chrome, so it can run on a machine that has the browsers but not the full
// package; the other e2e scripts predate that and import `playwright` directly.
//
// What only a browser can show: the card deliberately previews just the top few claims of each
// group, so the count beside them is the ONLY route to the rest from a grid — and it was rendering
// as an inert <span>. The regression this pins is a reader seeing "+27 more" and being unable to
// reach any of the 27.
let chromium;
try {
	({ chromium } = await import('playwright'));
} catch {
	({ chromium } = await import('playwright-core'));
}

const BASE = process.env.E2E_BASE ?? 'http://localhost:5183';
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
const page = await browser.newPage();
page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
page.on('console', (msg) => {
	if (msg.type() === 'error') errors.push(`console: ${msg.text()}`);
});

console.log('\nA material card with more claims than it previews');
await page.goto(`${BASE}/materials`, { waitUntil: 'networkidle' });
await page.waitForTimeout(1500);

const more = page.locator('button.claim-more').first();
await more.waitFor({ state: 'visible', timeout: 15000 });
const moreText = (await more.textContent())?.trim();
check('the count renders as a button, not a span', true, moreText);
check('its text still reads "+N more"', /^\+\d+\s/.test(moreText ?? ''), moreText);
const aria = await more.getAttribute('aria-label');
// "+27 more" alone is not a usable accessible name — it names a quantity, not an action.
check('it has a descriptive accessible name', !!aria && aria.length > 10, aria ?? '(none)');

check('nothing is open beforehand', (await page.locator('[role="dialog"]').count()) === 0);
await more.click();
const dialog = page.locator('[role="dialog"]');
await dialog.waitFor({ state: 'visible', timeout: 5000 });
check('clicking it opens a modal', await dialog.isVisible());
const title = (await dialog.locator('h2').first().textContent())?.trim();
check('the modal is titled for the group it expands', !!title, title ?? '');

// The whole point: the modal holds every claim, not only the hidden remainder.
const badges = dialog.locator('button.coverage-badge');
const badgeCount = await badges.count();
const expected = Number((moreText ?? '').match(/\d+/)?.[0] ?? 0) + 3;
check(
	`it lists all ${expected} claims, not just the ${expected - 3} hidden ones`,
	badgeCount === expected,
	`got ${badgeCount}`
);

const firstCardChip = (
	await page.locator('button.claim-chip--coverage').first().textContent()
)?.trim();
const firstModalBadge = (
	await badges.first().locator('.coverage-badge__label').textContent()
)?.trim();
check(
	'it opens in the same sort order the card established',
	firstCardChip === firstModalBadge,
	`${firstCardChip} vs ${firstModalBadge}`
);

console.log('\nDrilling into one claim, and back out');
await badges.nth(1).click();
await page.waitForTimeout(1200);
const popoverTitle = (await page.locator('[role="dialog"] h2').first().textContent())?.trim();
check('a claim opens its own popover', popoverTitle !== title, popoverTitle ?? '');
// Two stacked backdrops would leave Escape ambiguous about which one it closes.
check('never two modals at once', (await page.locator('[role="dialog"]').count()) === 1);

await page.keyboard.press('Escape');
await page.waitForTimeout(800);
const backTitle = (await page.locator('[role="dialog"] h2').first().textContent())?.trim();
check('closing it returns to the list, not the card', backTitle === title, backTitle ?? '(gone)');

await page.keyboard.press('Escape');
await page.waitForTimeout(600);
check('Escape then closes the list', (await page.locator('[role="dialog"]').count()) === 0);

console.log('\nReachable without a mouse');
await more.focus();
check('the count takes focus', await more.evaluate((el) => el === document.activeElement));
await page.keyboard.press('Enter');
await page.waitForTimeout(800);
check('Enter opens it', (await page.locator('[role="dialog"]').count()) === 1);

console.log(`\n${pass} passed, ${fail} failed`);
if (errors.length) console.log('page errors:\n' + errors.join('\n'));
else console.log('zero console/page errors');
await browser.close();
process.exit(fail === 0 && errors.length === 0 ? 0 : 1);
