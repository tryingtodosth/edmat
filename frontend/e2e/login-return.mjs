// Signing in (or registering) returns the visitor to the page they were on when they clicked
// "Log in", not the home page — including via a login link inside a modal, and across the
// login ↔ register hop. Run: E2E_BASE=http://localhost:5173 node e2e/login-return.mjs
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
	ok ? pass++ : fail++;
	console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${l} ${ok ? '' : x}`);
};
const browser = await chromium.launch(
	process.env.CHROME ? { executablePath: process.env.CHROME } : {}
);
const page = await (await browser.newContext({ viewport: { width: 1200, height: 900 } })).newPage();
page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
page.on('pageerror', (e) => errors.push(e.message));
const settle = (ms = 800) => page.waitForTimeout(ms);
async function signIn() {
	await page.locator('form input[type="email"]').fill('ola@edmat.example');
	await page.locator('form input[type="password"]').fill('password123');
	await page.locator('form button[type="submit"]').click();
	await page.waitForURL((u) => !u.pathname.includes('/login'), { timeout: 10000 });
	await settle();
}
async function logout() {
	await page.goto(`${BASE}/`, { waitUntil: 'load' });
	await settle(1200);
	await page.evaluate(() => localStorage.clear());
}

// 1. header "Log in" from a deep page
await page.goto(`${BASE}/materials/1`, { waitUntil: 'load' });
await settle(1500);
await page
	.getByRole('link', { name: /^Log in$/ })
	.first()
	.click();
await page.waitForURL(/\/login/);
await settle(1200);
await signIn();
check('header Log in returns to /materials/1', page.url().endsWith('/materials/1'), page.url());
await logout();

// 2. "Log in to vote" inside a claim popover
await page.goto(`${BASE}/materials/1`, { waitUntil: 'load' });
await settle(1500);
await page.locator('button.coverage-badge').first().click();
await page.locator('[role="dialog"] a.login').click();
await page.waitForURL(/\/login/);
await settle(1200);
await signIn();
check(
	'a login link inside a modal returns to the material',
	page.url().endsWith('/materials/1'),
	page.url()
);
await logout();

// 3. login → register → back to login keeps the original page; a query string survives
await page.goto(`${BASE}/materials?type=script`, { waitUntil: 'load' });
await settle(1500);
await page
	.getByRole('link', { name: /^Log in$/ })
	.first()
	.click();
await page.waitForURL(/\/login/);
await settle(1000);
await page.locator('.page a[href$="/register"]').click();
await page.waitForURL(/\/register/);
await settle(800);
await page.locator('.page a[href$="/login"]').click();
await page.waitForURL(/\/login/);
await settle(800);
await signIn();
check(
	'the login/register hop keeps the original page (with its query)',
	page.url().endsWith('/materials?type=script'),
	page.url()
);
await logout();

// 4. a direct visit to /login with nothing to return to lands on home
await page.goto(`${BASE}/login`, { waitUntil: 'load' });
await settle(1500);
await signIn();
check(
	'a cold /login still lands on the home page',
	new URL(page.url()).pathname === '/',
	page.url()
);
await logout();

// 5. ?next= to another site is refused
await page.goto(`${BASE}/login?next=//example.com/evil`, { waitUntil: 'load' });
await settle(1500);
await signIn();
check(
	'a cross-origin ?next= is ignored',
	page.url().startsWith(BASE) && new URL(page.url()).pathname === '/',
	page.url()
);

await browser.close();
console.log(`\n${pass} passed, ${fail} failed, ${errors.length} console/page errors`);
for (const e of errors) console.log('  ' + e);
process.exit(fail || errors.length ? 1 : 0);
