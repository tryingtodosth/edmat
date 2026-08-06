// End-to-end check of editing your own profile in place.
//
// Run it with both running:
//   backend:  DJANGO_CORS_ALLOWED_ORIGINS=http://localhost:5183 manage.py runserver 127.0.0.1:8011
//   frontend: PUBLIC_API_BASE_URL=http://127.0.0.1:8011/api npx vite dev --port 5183
//   node e2e/profile-editing.mjs
//
// Playwright is deliberately not a dependency of this repo — `npx playwright install chromium`.
// Accepts `playwright-core` plus CHROME=/path/to/chrome too.
//
// The point of the feature is that there is no separate edit screen: your profile is the page
// everybody else sees, with ⋯ menus added. So the thing only a browser can confirm is exactly that
// — that the menus drive real writes, and that a visitor looking at the same page gets the content
// and none of the controls.
let chromium;
try {
	({ chromium } = await import('playwright'));
} catch {
	({ chromium } = await import('playwright-core'));
}

const BASE = process.env.E2E_BASE ?? 'http://localhost:5183';
const API = process.env.E2E_API ?? 'http://127.0.0.1:8000/api';

const b = await chromium.launch(process.env.CHROME ? { executablePath: process.env.CHROME } : {});
const p = await b.newPage({ viewport: { width: 1180, height: 1000 } });
const errs = [];
p.on('pageerror', (e) => errs.push(e.message));
p.on('console', (m) => {
	if (m.type() === 'error') errs.push(m.text().slice(0, 160));
});
p.on('dialog', (d) => d.accept());
let pass = 0,
	fail = 0;
const ck = (l, o, x = '') => {
	if (o) {
		pass++;
		console.log('  ok   ' + l);
	} else {
		fail++;
		console.log('  FAIL ' + l + ' ' + x);
	}
};

const email = `edit-${Date.now()}@example.com`;
await p.goto(`${BASE}/register`, { waitUntil: 'networkidle' });
await p.waitForTimeout(900);
await p.locator('form input[type="text"]').first().fill('Editor Person');
await p.locator('form input[type="email"]').fill(email);
await p.locator('form input[type="password"]').fill('Kw9-vortexline-42');
await p.locator('form button[type="submit"]').click();
await p.waitForTimeout(2500);

const api = API;
const tok = (
	await (
		await fetch(api + '/auth/login/', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ username: email, password: 'Kw9-vortexline-42' })
		})
	).json()
).token;
const me = await (
	await fetch(api + '/auth/me/', { headers: { Authorization: 'Token ' + tok } })
).json();

await p.goto(`${BASE}/users/${me.id}`, { waitUntil: 'networkidle' });
await p.waitForTimeout(1800);
ck('own profile shows meatballs menus', (await p.locator('.meatballs__trigger').count()) >= 2);

// Add two experience entries.
for (const title of ['First job', 'Second job']) {
	await p
		.locator('.profile-section')
		.filter({ hasText: 'Experience' })
		.locator('.meatballs__trigger')
		.first()
		.click();
	await p.waitForTimeout(400);
	await p.getByRole('menuitem', { name: 'Add' }).click();
	await p.waitForTimeout(500);
	await p.locator('.edit-form input[type="text"]').first().fill(title);
	await p.locator('.edit-form button[type="submit"]').click();
	await p.waitForTimeout(1800);
}
let txt = await p.locator('.profile-section').filter({ hasText: 'Experience' }).innerText();
ck(
	'both entries added',
	txt.includes('First job') && txt.includes('Second job'),
	txt.slice(0, 150)
);

// Reorder: move the second up.
const rowMenus = p.locator('.timeline .meatballs__trigger');
await rowMenus.nth(1).click();
await p.waitForTimeout(400);
await p.getByRole('menuitem', { name: 'Move up' }).click();
await p.waitForTimeout(2000);
let titles = await p.locator('.timeline li strong').allTextContents();
ck('reorder moved it up', titles[0] === 'Second job', JSON.stringify(titles));

// Edit the first.
await p.locator('.timeline .meatballs__trigger').first().click();
await p.waitForTimeout(400);
await p.getByRole('menuitem', { name: 'Edit' }).click();
await p.waitForTimeout(500);
await p.locator('.edit-form input[type="text"]').first().fill('Renamed job');
await p.locator('.edit-form button[type="submit"]').click();
await p.waitForTimeout(1800);
titles = await p.locator('.timeline li strong').allTextContents();
ck('edit renamed it in place', titles[0] === 'Renamed job', JSON.stringify(titles));

// Remove it.
await p.locator('.timeline .meatballs__trigger').first().click();
await p.waitForTimeout(400);
await p.getByRole('menuitem', { name: 'Remove' }).click();
await p.waitForTimeout(2000);
titles = await p.locator('.timeline li strong').allTextContents();
ck('remove deleted it', !titles.includes('Renamed job'), JSON.stringify(titles));

// Skills add.
await p
	.locator('.profile-section')
	.filter({ hasText: 'Skills' })
	.locator('.meatballs__trigger')
	.first()
	.click();
await p.waitForTimeout(400);
await p.getByRole('menuitem', { name: 'Add' }).click();
await p.waitForTimeout(500);
await p.locator('.edit-form input[type="text"]').first().fill('Topologia');
await p.locator('.edit-form button[type="submit"]').click();
await p.waitForTimeout(1800);
ck('skill added', (await p.locator('.skills').innerText()).includes('Topologia'));

// A visitor sees none of it.
const ctx2 = await b.newContext();
const q = await ctx2.newPage();
await q.goto(`${BASE}/users/${me.id}`, { waitUntil: 'networkidle' });
await q.waitForTimeout(1800);
ck('a visitor sees no menus', (await q.locator('.meatballs__trigger').count()) === 0);
ck('but sees the content', (await q.locator('body').innerText()).includes('Topologia'));

console.log(`\n${pass} passed, ${fail} failed`);
console.log(errs.length ? 'ERRORS: ' + errs.join(' | ') : 'zero page errors');
await b.close();

process.exit(fail === 0 && errs.length === 0 ? 0 : 1);
