// The profile's exercise tile is a stored counter, not the size of a 50-row feed slice, and the
// owner sees "+ N unpublished" linking to an owner-only list. Needs an account with more than 50
// exercises — see the seeding snippet in the done.md entry for this work.
// Run: E2E_BASE=http://localhost:5173 E2E_USER=4 node e2e/profile-exercise-counts.mjs
let chromium;
try {
	({ chromium } = await import('playwright'));
} catch {
	({ chromium } = await import('playwright-core'));
}
const BASE = process.env.E2E_BASE ?? 'http://localhost:5173';
const USER = process.env.E2E_USER ?? '4';
const EXPECT_PUBLISHED = Number(process.env.E2E_PUBLISHED ?? 55);
const EXPECT_PRIVATE = Number(process.env.E2E_PRIVATE ?? 2);
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
const context = await browser.newContext({ viewport: { width: 1200, height: 900 } });
const page = await context.newPage();
page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
page.on('pageerror', (e) => errors.push(e.message));
const settle = (ms = 800) => page.waitForTimeout(ms);
const exerciseTile = () =>
	page.locator('.tiles li', {
		has: page.locator('.tile__label', { hasText: /^(Exercises|Zadania)$/ })
	});
async function signIn(email) {
	await page.goto(`${BASE}/login`, { waitUntil: 'load' });
	await settle(1200);
	await page.locator('form input[type="email"]').fill(email);
	await page.locator('form input[type="password"]').fill('password123');
	await page.locator('form button[type="submit"]').click();
	await page.waitForURL((u) => !u.pathname.includes('/login'), { timeout: 10000 });
	await settle();
}
async function logout() {
	await page.goto(`${BASE}/`, { waitUntil: 'load' });
	await settle(1000);
	await page.evaluate(() => localStorage.clear());
}

// 1. a stranger: the real total, no unpublished link
await page.goto(`${BASE}/users/${USER}`, { waitUntil: 'load' });
await exerciseTile().waitFor({ timeout: 15000 });
let tile = exerciseTile();
check(
	`stranger sees the stored total (${EXPECT_PUBLISHED}), not 50`,
	(await tile.locator('.tile__count').innerText()).trim() === String(EXPECT_PUBLISHED),
	await tile.locator('.tile__count').innerText()
);
check('stranger sees no unpublished link', (await tile.locator('.tile__private').count()) === 0);

// 2. the owner: total plus "+ N unpublished"
await signIn('ola@edmat.example');
await page.goto(`${BASE}/users/${USER}`, { waitUntil: 'load' });
await exerciseTile().waitFor({ timeout: 15000 });
tile = exerciseTile();
await tile.locator('.tile__private').waitFor({ timeout: 10000 });
check(
	'owner sees the same published total',
	(await tile.locator('.tile__count').innerText()).trim() === String(EXPECT_PUBLISHED)
);
const link = tile.locator('.tile__private');
check(
	`owner sees "+ ${EXPECT_PRIVATE} unpublished"`,
	new RegExp(`\\+ ${EXPECT_PRIVATE} `).test(await link.innerText()),
	await link.innerText()
);
await page.screenshot({
	path: 'e2e/screenshots/profile-exercise-counts-owner.png',
	fullPage: false
});

// 3. the link opens the owner-only list
await link.click();
await page.waitForURL(new RegExp(`/users/${USER}/unpublished$`));
await settle(1500);
check('link lands on /users/{id}/unpublished', page.url().endsWith(`/users/${USER}/unpublished`));
const cards = page.locator('.grid > *');
await cards.first().waitFor({ timeout: 10000 });
check(
	`the list holds exactly the ${EXPECT_PRIVATE} unpublished exercises`,
	(await cards.count()) === EXPECT_PRIVATE,
	String(await cards.count())
);
await page.reload({ waitUntil: 'load' });
await cards.first().waitFor({ timeout: 10000 });
check('…and it still shows after reload', (await cards.count()) === EXPECT_PRIVATE);
await page.screenshot({
	path: 'e2e/screenshots/profile-exercise-counts-list.png',
	fullPage: false
});

// 4. somebody else signed in: no link, and the list page refuses in words
await logout();
await signIn('kasia@edmat.example');
await page.goto(`${BASE}/users/${USER}`, { waitUntil: 'load' });
await exerciseTile().waitFor({ timeout: 15000 });
check(
	'another signed-in person sees no unpublished link',
	(await exerciseTile().locator('.tile__private').count()) === 0
);
await page.goto(`${BASE}/users/${USER}/unpublished`, { waitUntil: 'load' });
await settle(1500);
check(
	'the list page tells a non-owner it is not theirs',
	(await page.locator('.grid > *').count()) === 0 &&
		/only the account holder|właściciel konta/i.test(await page.locator('main').innerText())
);

check('zero console/page errors', errors.length === 0, errors.join(' | '));
console.log(`\n${pass} passed, ${fail} failed`);
await browser.close();
process.exit(fail ? 1 : 0);
