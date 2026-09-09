// Audience bands (AUDIENCE-BRIEF.md §1, step 1): every card carries a band badge, the homepage chip
// row narrows every list, the choice persists on a signed-in profile and shows in Settings, and
// every submit form requires a band. Kasia (staff) creates a scratch tutoring listing marked
// "Primary school" through the real API and deletes it at the end; Ola's filter is reset.
//   E2E_BASE=http://localhost:5173 E2E_API=http://localhost:8000 node e2e/audience-bands.mjs
let chromium;
try {
	({ chromium } = await import('playwright'));
} catch {
	({ chromium } = await import('playwright-core'));
}
const BASE = process.env.E2E_BASE ?? 'http://localhost:5173';
const API = process.env.E2E_API ?? 'http://localhost:8000';
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
const context = await browser.newContext({ viewport: { width: 1280, height: 1000 } });
const page = await context.newPage();
page.on('console', (m) => {
	if (m.type() === 'error') errors.push(m.text());
});
page.on('pageerror', (e) => errors.push(e.message));
const settle = (ms = 900) => page.waitForTimeout(ms);

const tokenFor = async (email) => {
	const r = await fetch(`${API}/api/auth/login/`, {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify({ username: email, password: 'password123' })
	});
	return (await r.json()).token;
};
const kasia = await tokenFor('kasia@edmat.example');
const ola = await tokenFor('ola@edmat.example');
const MARKER = 'Audience e2e — fractions for primary';
// Reset: remove a leftover scratch listing, and Ola's filter.
for (const s of await (
	await fetch(`${API}/api/services/?mine=true`, { headers: { Authorization: `Token ${kasia}` } })
).json()) {
	if (s.title === MARKER)
		await fetch(`${API}/api/services/${s.id}/`, {
			method: 'DELETE',
			headers: { Authorization: `Token ${kasia}` }
		});
}
await fetch(`${API}/api/auth/me/`, {
	method: 'PATCH',
	headers: { 'Content-Type': 'application/json', Authorization: `Token ${ola}` },
	body: JSON.stringify({ audience_filter: [] })
});

// Scratch listing marked for primary school.
const created = await (
	await fetch(`${API}/api/services/`, {
		method: 'POST',
		headers: { 'Content-Type': 'application/json', Authorization: `Token ${kasia}` },
		body: JSON.stringify({
			title: MARKER,
			description: 'scratch',
			branch_slugs: [],
			audience: 'primary',
			is_active: true,
			delivery_mode: 'online',
			currency: 'PLN',
			availability_mode: 'derived'
		})
	})
).json();
check(
	'API stores the band on a listing',
	created.audience === 'primary',
	JSON.stringify(created).slice(0, 200)
);
const totalListings = (await (await fetch(`${API}/api/services/`)).json()).length;
const primaryListings = (await (await fetch(`${API}/api/services/?audience=primary`)).json())
	.length;
check(
	'API narrows the listing browse to the band',
	primaryListings === 1 && totalListings > 1,
	`${primaryListings}/${totalListings}`
);

// 1. Guest homepage: chips, badges, narrowing.
await page.goto(`${BASE}/`, { waitUntil: 'load' });
await settle(3000);
const chips = page.locator('.chips .chip');
check('homepage shows the band chip row', (await chips.count()) === 7, String(await chips.count()));
await page.getByRole('tab', { name: 'Tutoring' }).click();
await page.locator('.service-card').first().waitFor({ timeout: 60000 });
check(
	'every tutoring card carries a band badge',
	(await page.locator('.service-card .badge').count()) ===
		(await page.locator('.service-card').count())
);
check(
	'the scratch listing is in the unfiltered tab',
	(await page.locator('.service-card', { hasText: MARKER }).count()) === 1
);
await page.locator('.chips .chip', { hasText: 'Primary school' }).click();
await settle(2500);
check(
	'narrowing to Primary leaves exactly the scratch listing',
	(await page.locator('.service-card').count()) === 1 &&
		(await page.locator('.service-card', { hasText: MARKER }).count()) === 1,
	String(await page.locator('.service-card').count())
);
check(
	'its badge reads the band',
	(await page.locator('.service-card .badge').first().innerText()).trim() === 'Primary school'
);
await page.getByRole('tab', { name: 'Exercises' }).click();
await settle(2500);
check(
	'exercises narrow too (no primary exercises exist yet)',
	(await page.locator('.exercise-card').count()) === 0,
	String(await page.locator('.exercise-card').count())
);
await page.locator('.chips .chip', { hasText: 'Everything' }).click();
await settle(2500);
check('Everything restores the exercises', (await page.locator('.exercise-card').count()) > 0);
check(
	'exercise cards carry the University badge',
	(await page.locator('.exercise-card .badge', { hasText: 'University' }).count()) > 0
);
await page.reload({ waitUntil: 'load' });
await settle(2500);
check(
	'a guest choice survives a reload (localStorage)',
	(await page.locator('.chips .chip', { hasText: 'Everything' }).getAttribute('aria-pressed')) ===
		'true'
);

// 2. Signed in: the choice is saved on the profile and shows in Settings.
await page.goto(`${BASE}/login`, { waitUntil: 'load' });
await settle(2000);
await page.locator('form input[type="email"]').fill('ola@edmat.example');
await page.locator('form input[type="password"]').fill('password123');
await page.locator('form button[type="submit"]').click();
await page.waitForURL((u) => !u.pathname.includes('/login'), { timeout: 10000 });
await page.goto(`${BASE}/`, { waitUntil: 'load' });
await settle(2500);
await page.locator('.chips .chip', { hasText: 'Seniors' }).click();
await settle(2000);
const me = await (
	await fetch(`${API}/api/auth/me/`, { headers: { Authorization: `Token ${ola}` } })
).json();
check(
	'a signed-in click is saved on the profile',
	JSON.stringify(me.audience_filter) === '["senior"]',
	JSON.stringify(me.audience_filter)
);
await page.goto(`${BASE}/settings`, { waitUntil: 'load' });
await settle(2500);
const seniorBox = page.locator('.checkbox-row', { hasText: 'Seniors' }).locator('input');
check('Settings shows the same band ticked', await seniorBox.isChecked());
await seniorBox.uncheck();
await page.locator('.checkbox-row', { hasText: 'Adult learners' }).locator('input').check();
await page.locator('form button[type="submit"]').first().click();
await settle(2000);
const me2 = await (
	await fetch(`${API}/api/auth/me/`, { headers: { Authorization: `Token ${ola}` } })
).json();
check(
	'Settings saves the band list',
	JSON.stringify(me2.audience_filter) === '["adult"]',
	JSON.stringify(me2.audience_filter)
);

// 3. Submit forms require a band.
await page.goto(`${BASE}/services/new`, { waitUntil: 'load' });
await settle(2500);
const sel = page
	.locator('form select[required]')
	.filter({ has: page.locator('option[value="primary"]') });
check('the tutoring form asks who it is for', (await sel.count()) === 1);
check('… with no default chosen', (await sel.inputValue()) === '');
for (const path of ['/submit', '/submit-material', '/events/new']) {
	await page.goto(`${BASE}${path}`, { waitUntil: 'load' });
	await settle(2200);
	const s2 = page
		.locator('form select[required]')
		.filter({ has: page.locator('option[value="senior"]') });
	check(`${path} asks who it is for`, (await s2.count()) === 1, String(await s2.count()));
}

// Cleanup
await fetch(`${API}/api/services/${created.id}/`, {
	method: 'DELETE',
	headers: { Authorization: `Token ${kasia}` }
});
await fetch(`${API}/api/auth/me/`, {
	method: 'PATCH',
	headers: { 'Content-Type': 'application/json', Authorization: `Token ${ola}` },
	body: JSON.stringify({ audience_filter: [] })
});
// Through an authenticated request: anonymous list responses are served from the 60s read cache
// (§17AB, TTL-only invalidation), so the unfiltered public URL can still show the deleted row.
const gone = (
	await (
		await fetch(`${API}/api/services/?mine=true`, { headers: { Authorization: `Token ${kasia}` } })
	).json()
).every((s) => s.title !== MARKER);
check('scratch listing removed', gone);
check('zero console/page errors', errors.length === 0, errors.join(' | ').slice(0, 400));
await page.screenshot({ path: 'e2e/screenshots/audience-bands.png', fullPage: false });
await browser.close();
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
