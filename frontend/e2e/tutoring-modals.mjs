// Managing a tutoring listing: the create / edit / delete dialogs on /services.
//
// Run it with both halves up (ports are whatever you started them on):
//   backend:  DJANGO_CORS_ALLOWED_ORIGINS=http://localhost:5176 manage.py runserver 127.0.0.1:8003
//   frontend: PUBLIC_API_BASE_URL=http://127.0.0.1:8003/api npx vite dev --port 5176
//   E2E_BASE=http://localhost:5176 E2E_API=http://127.0.0.1:8003/api node e2e/tutoring-modals.mjs
//
// Like booking.mjs, this signs in by seeding the persisted token rather than logging in: login is
// rate-limited per IP AND per account (accounts/throttles.py), and a tripped throttle fails
// *silently anonymous*, which reads as a broken page rather than as a throttle. Set E2E_TOKEN to a
// real DRF token for the account that owns the listings (the seeded `u-michal` by default).
//
// What only a browser can show here: that the list is still standing BEHIND the dialog (the whole
// point of moving off the inline form), that Escape leaves the listing untouched, that Cancel
// really does not delete, and — the interesting one — that a 409 refusal lands inside the dialog
// that asked the question rather than at the foot of a list the reader has stopped looking at.
const BASE = process.env.E2E_BASE ?? 'http://localhost:5176';
const API = process.env.E2E_API ?? 'http://127.0.0.1:8003/api';

// Playwright is deliberately not a dependency of this repo — `npx playwright install chromium`.
// Accepts `playwright-core` plus CHROME=/path/to/chrome as well, for a machine that has the
// browsers but not the full package. Same fallback every sibling script here uses.
let chromium;
try {
	({ chromium } = await import('playwright'));
} catch {
	({ chromium } = await import('playwright-core'));
}

const CHROME = process.env.CHROME;
const TOKEN = process.env.E2E_TOKEN ?? '06076f72345ce89932d2119e5aad70a55ba41c79';

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
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const api = (path, init = {}) =>
	fetch(`${API}${path}`, {
		...init,
		headers: {
			...(init.body ? { 'Content-Type': 'application/json' } : {}),
			Authorization: `Token ${TOKEN}`,
			...(init.headers ?? {})
		}
	});

// A scratch listing to delete, so the run never destroys seeded data and is repeatable.
const scratchTitle = `E2E scratch ${Date.now()}`;
const scratch = await api('/services/', {
	method: 'POST',
	body: JSON.stringify({
		title: scratchTitle,
		description: 'created by the modal e2e run',
		branch_slugs: ['analiza-matematyczna'],
		hourly_rate: '10.00',
		currency: 'PLN',
		is_active: true,
		delivery_mode: 'online',
		availability_mode: 'derived',
		session_minutes: 60
	})
}).then((r) => r.json());
console.log(`       scratch listing id=${scratch.id}`);

const browser = await chromium.launch({
	...(CHROME ? { executablePath: CHROME } : {}),
	args: ['--no-sandbox']
});
const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
await ctx.addInitScript((t) => window.localStorage.setItem('edmat-auth-token', t), TOKEN);
const page = await ctx.newPage();
page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
page.on('console', (m) => {
	// The 409 IS a behaviour under test; Chromium logs every non-2xx fetch regardless of whether
	// the app handled it. Only that status is ignored, so a 500 still fails the run.
	if (m.type() === 'error' && !/409 \(Conflict\)/.test(m.text()))
		errors.push(`console: ${m.text()}`);
});

const openMine = async () => {
	await page.goto(`${BASE}/services`, { waitUntil: 'networkidle' });
	await sleep(1500);
	await page.locator('.tabs button').nth(1).click();
	await sleep(1200);
};

// ------------------------------------------------------------------ 1. edit dialog

console.log('\n1. Edit opens a dialog, list stays behind it');
await openMine();
const rowsBefore = await page.locator('.mine-row').count();
check('my listings render', rowsBefore >= 2, `rows=${rowsBefore}`);

await page.locator('.mine-row').first().locator('button', { hasText: /Edit/ }).click();
await sleep(800);
check('a real dialog opened', (await page.locator('[role="dialog"]').count()) === 1);
check('the form is inside the dialog', (await page.locator('[role="dialog"] form').count()) === 1);
check(
	'the list is still rendered behind the dialog',
	(await page.locator('.mine-row').count()) === rowsBefore,
	'rows vanished — that is the inline-form behaviour this replaced'
);
check(
	'exactly one dialog — no modal inside a modal',
	(await page.locator('[role="dialog"]').count()) === 1
);

// ------------------------------------------------------------------ 2. escape closes

console.log('\n2. Escape closes it without saving');
await page.keyboard.press('Escape');
await sleep(600);
check('dialog closed on Escape', (await page.locator('[role="dialog"]').count()) === 0);

// ------------------------------------------------------------------ 3. a real edit saves

console.log('\n3. Editing through the dialog really saves');
const newTitle = `Renamed by e2e ${Date.now()}`;
await openMine();
// Target the scratch row specifically rather than by position.
const scratchRow = page.locator('.mine-row', { hasText: scratchTitle });
check('scratch listing is in my listings', (await scratchRow.count()) === 1);
await scratchRow.locator('button', { hasText: /Edit/ }).click();
await sleep(800);
const titleInput = page.locator('[role="dialog"] form input[type="text"]').first();
await titleInput.fill(newTitle);
await page.locator('[role="dialog"] form button[type="submit"]').first().click();
await sleep(2000);
check('dialog closed after saving', (await page.locator('[role="dialog"]').count()) === 0);
const afterEdit = await api(`/services/${scratch.id}/`).then((r) => r.json());
check(
	'the new title really persisted to the API',
	afterEdit.title === newTitle,
	`got ${JSON.stringify(afterEdit.title)}`
);
check(
	'the row in the list shows the new title',
	(await page.locator('.mine-row', { hasText: newTitle }).count()) === 1
);

// ------------------------------------------------------------------ 4. delete asks first

console.log('\n4. Delete asks in-app, and Cancel really cancels');
const renamedRow = page.locator('.mine-row', { hasText: newTitle });
await renamedRow.locator('button', { hasText: /Delete|Usuń/ }).click();
await sleep(700);
check('a confirm dialog opened', (await page.locator('[role="dialog"]').count()) === 1);
const dialogText = await page.locator('[role="dialog"]').innerText();
check(
	'the dialog names the listing it is about',
	dialogText.includes(newTitle),
	dialogText.slice(0, 200)
);
check(
	'the question is translated app copy, not a browser confirm',
	/can't be undone|nie można cofnąć/i.test(dialogText),
	dialogText.slice(0, 200)
);
await page
	.locator('[role="dialog"] button', { hasText: /Cancel|Anuluj/ })
	.first()
	.click();
await sleep(600);
check('cancel closed the dialog', (await page.locator('[role="dialog"]').count()) === 0);
const stillThere = await api(`/services/${scratch.id}/`);
check('cancel really did NOT delete it', stillThere.status === 200, `status ${stillThere.status}`);

// ------------------------------------------------------------------ 5. delete confirms

console.log('\n5. Confirming really deletes');
await renamedRow.locator('button', { hasText: /Delete|Usuń/ }).click();
await sleep(700);
await page
	.locator('[role="dialog"] button.danger', { hasText: /Delete|Usuń/ })
	.first()
	.click();
await sleep(2000);
check('dialog closed after delete', (await page.locator('[role="dialog"]').count()) === 0);
check(
	'the row is gone from the list',
	(await page.locator('.mine-row', { hasText: newTitle }).count()) === 0
);
const gone = await api(`/services/${scratch.id}/`);
check('the listing is really gone from the API', gone.status === 404, `status ${gone.status}`);

// ------------------------------------------------------------------ 6. create dialog

console.log('\n6. New listing opens a dialog and creates');
const createdTitle = `Created in dialog ${Date.now()}`;
await openMine();
await page.locator('button.new-listing').click();
await sleep(900);
check('create dialog opened', (await page.locator('[role="dialog"]').count()) === 1);
const cTitle = page.locator('[role="dialog"] form input[type="text"]').first();
await cTitle.fill(createdTitle);
const cRate = page.locator('[role="dialog"] form input[inputmode="decimal"]');
if (await cRate.count()) await cRate.first().fill('55.50');
const cBox = page.locator('[role="dialog"] form input[type="checkbox"]');
if (await cBox.count()) await cBox.first().check();
await page.locator('[role="dialog"] form button[type="submit"]').first().click();
await sleep(2500);
check('create dialog closed', (await page.locator('[role="dialog"]').count()) === 0);
const all = await api('/services/?mine=true').then((r) => r.json());
const made = all.find((s) => s.title === createdTitle);
check('the new listing exists in the API', !!made, `titles=${all.map((s) => s.title).join(' | ')}`);
check(
	'it appears in my listings without a reload',
	(await page.locator('.mine-row', { hasText: createdTitle }).count()) === 1
);
if (made) {
	check(
		'the rate round-tripped as a real number',
		made.hourly_rate === '55.50',
		`got ${made.hourly_rate}`
	);
	await api(`/services/${made.id}/`, { method: 'DELETE' });
}

// ------------------------------------------------------------------ 7. the 409 refusal
//
// Needs a listing with a live booking; skipped rather than failed when there isn't one, so the
// script stays runnable against a database that has no seeded booking.

console.log('\n7. A refusal lands inside the dialog that asked');
{
	const mine = await api('/services/?mine=true').then((r) => r.json());
	const booked = mine.find((s) => /booked/i.test(s.title));
	if (!booked) {
		console.log('  skip  no listing with a live booking in this database');
	} else {
		await openMine();
		const row = page.locator('.mine-row', { hasText: booked.title });
		await row.locator('button', { hasText: /Delete|Usuń/ }).click();
		await sleep(700);
		await page.locator('[role="dialog"] button.danger').first().click();
		await sleep(2200);
		check(
			'the dialog stayed open on refusal',
			(await page.locator('[role="dialog"]').count()) === 1
		);
		const errEl = page.locator('[role="dialog"] .delete-error');
		check('the refusal is shown inside the dialog', (await errEl.count()) === 1);
		if (await errEl.count()) {
			const msg = await errEl.innerText();
			check('it names pausing as the alternative', /paus/i.test(msg), msg);
		}
		await page.keyboard.press('Escape');
		await sleep(500);
		check(
			'Escape still closes it afterwards',
			(await page.locator('[role="dialog"]').count()) === 0
		);
	}
}

await browser.close();
console.log(`\n${pass} passed, ${fail} failed`);
if (errors.length) {
	console.log(`\n${errors.length} console/page error(s):`);
	for (const e of [...new Set(errors)].slice(0, 20)) console.log(`  - ${e}`);
}
process.exit(fail || errors.length ? 1 : 0);
