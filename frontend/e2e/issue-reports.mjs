// "Report issue / Zgłoś błąd": the link under the logo (drawn over the bar, not growing it), in the
// account menu and in the footer; the modal pre-filling where you were; anonymous vs named filing;
// the public issues page with its discussion; staff moving a report and the reporter being told;
// and the kill switch taking every link away. Run: E2E_BASE=http://localhost:5173 node e2e/issue-reports.mjs
let chromium;
try {
	({ chromium } = await import('playwright'));
} catch {
	({ chromium } = await import('playwright-core'));
}
const BASE = process.env.E2E_BASE ?? 'http://localhost:5173';
const API = process.env.E2E_API ?? 'http://localhost:8000/api';
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
async function newPage(viewport = { width: 1280, height: 800 }) {
	const page = await (await browser.newContext({ viewport })).newPage();
	// A deliberate 404 (a private report opened by its own reporter) logs a resource error; that
	// one is the behaviour under test, not a defect.
	page.on(
		'console',
		(m) => m.type() === 'error' && !/status of 404/.test(m.text()) && errors.push(m.text())
	);
	page.on('pageerror', (e) => errors.push(e.message));
	return page;
}
const settle = (page, ms = 800) => page.waitForTimeout(ms);
async function signIn(page, email) {
	await page.goto(`${BASE}/login`, { waitUntil: 'load' });
	await settle(page, 1200);
	await page.locator('form input[type="email"]').fill(email);
	await page.locator('form input[type="password"]').fill('password123');
	await page.locator('form button[type="submit"]').click();
	await page.waitForURL((u) => !u.pathname.includes('/login'), { timeout: 10000 });
	await settle(page);
}
async function apiToken(email) {
	const r = await fetch(`${API}/auth/login/`, {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify({ username: email, password: 'password123' })
	});
	return (await r.json()).token;
}
const stamp = `e2e-issue-${Date.now()}`;

// ---- 1. a guest, from an exercise page: the link under the logo, context pre-filled, anonymous+public
const guest = await newPage();
await page_goto(guest, `${BASE}/exercises/51`);
const header = guest.locator('header.site-header');
const brandBox = await header.locator('.brand').boundingBox();
const reportBox = await header.locator('.brand__report').boundingBox();
check(
	'the "Report issue" link renders under the logo',
	Boolean(reportBox) && reportBox.y > brandBox.y + brandBox.height / 2
);
const headerBox = await header.boundingBox();
check(
	'the bar did not grow for it (link overlaps the bar, header ≤ 64px tall)',
	headerBox.height <= 64,
	String(headerBox.height)
);
await guest.screenshot({
	path: 'e2e/screenshots/issue-header-1280.png',
	clip: { x: 0, y: 0, width: 1280, height: 80 }
});
check(
	'its hit area is larger than the text',
	reportBox.height >= 17 && reportBox.width > 60,
	`${reportBox.width}x${reportBox.height}`
);
await header.locator('.brand__report').click();
const dialog = guest.locator('[role="dialog"]');
await dialog.waitFor({ timeout: 5000 });
check('the modal opens', await dialog.isVisible());
await guest.screenshot({ path: 'e2e/screenshots/issue-modal.png' });
check(
	'type pre-picked as content on an exercise page',
	(await dialog.locator('select').first().inputValue()) === 'content'
);
check(
	'page address pre-filled',
	(await dialog.locator('fieldset input').first().inputValue()) === '/exercises/51'
);
await dialog.getByLabel(/In one line/).fill(`${stamp} guest`);
await dialog.locator('textarea').fill('Filed by an anonymous guest.');
await dialog.getByLabel(/Report anonymously/).check();
check(
	'the email field hides once anonymous is ticked',
	(await dialog.locator('input[type="email"]').count()) === 0
);
await dialog.getByLabel(/may be shown on the public issues page/).check();
await dialog.locator('button[type="submit"]').click();
await dialog.getByText(/your report is filed/).waitFor({ timeout: 8000 });
check('a guest can file', true);
await dialog.getByRole('link', { name: /See it on the issues page/ }).click();
await guest.waitForURL(/\/issues\/\d+$/);
await settle(guest, 1200);
check('the public report has its own page', /\/issues\/\d+$/.test(guest.url()));
check('…and says it was anonymous', await guest.getByText('Reported anonymously').isVisible());
const guestIssueId = guest.url().match(/\/issues\/(\d+)$/)[1];
check(
	'an anonymous report stored no reporter (API)',
	(await (await fetch(`${API}/issues/${guestIssueId}/`)).json()).reporter === null
);
check(
	'the comment composer asks a guest to log in',
	await guest.locator('.discussion .login-prompt').isVisible()
);

// ---- 2. ola, signed in: named, private (staff-only) report from the account menu
const ola = await newPage();
await signIn(ola, 'ola@edmat.example');
await page_goto(ola, `${BASE}/materials`);
await ola.locator('button.popover__trigger:has(.account-trigger)').click();
await ola.getByRole('menuitem', { name: 'Report issue' }).click();
const olaDialog = ola.locator('[role="dialog"]');
await olaDialog.waitFor();
check('the account menu opens the same modal', await olaDialog.isVisible());
check(
	'type defaults to bug off an exercise/material page',
	(await olaDialog.locator('select').first().inputValue()) === 'bug'
);
await olaDialog.getByLabel(/In one line/).fill(`${stamp} ola private`);
await olaDialog.locator('button[type="submit"]').click();
await olaDialog.getByText(/moderators only/).waitFor({ timeout: 8000 });
check('a private report says it is visible to moderators only', true);
await olaDialog.locator('button.button-primary:has-text("Close")').click();
const olaToken = await apiToken('ola@edmat.example');
const olaIssue = (
	await (
		await fetch(`${API}/issues/?all=1`, {
			headers: { Authorization: `Token ${await apiToken('kasia@edmat.example')}` }
		})
	).json()
).find((i) => i.title === `${stamp} ola private`);
check(
	'staff can see the private report through the API',
	Boolean(olaIssue) && olaIssue.reporter !== null
);
await page_goto(ola, `${BASE}/issues`);
check(
	'the public list shows the guest report',
	await ola.getByRole('link', { name: `${stamp} guest` }).isVisible()
);
check(
	'…but not the private one',
	(await ola.getByRole('link', { name: `${stamp} ola private` }).count()) === 0
);
await page_goto(ola, `${BASE}/issues/${olaIssue.id}`);
check(
	'a private report 404s even for its reporter',
	await ola.getByText(/does not exist, or is not public/).isVisible()
);
check(
	'the footer links to the issues page and offers the report button',
	(await ola.locator('footer a[href$="/issues"]').count()) === 1 &&
		(await ola.locator('footer button:has-text("Report issue")').count()) === 1
);

// ---- 3. ola discusses the guest report
await page_goto(ola, `${BASE}/issues/${guestIssueId}`);
await ola.locator('.discussion textarea').fill('Same here on Firefox.');
await ola.locator('.discussion form button[type="submit"]').first().click();
await ola.locator('.discussion').getByText('Same here on Firefox.').waitFor({ timeout: 8000 });
check('a signed-in person can discuss a public report', true);

// ---- 4. kasia (staff) moves the private report; ola is told, with the note
const kasia = await newPage();
await signIn(kasia, 'kasia@edmat.example');
await page_goto(kasia, `${BASE}/issues/${olaIssue.id}`);
check(
	'staff can open the private report',
	await kasia.getByRole('heading', { name: `${stamp} ola private` }).isVisible()
);
await kasia.locator('.staff select').selectOption('resolved');
await kasia.locator('.staff textarea').fill('Fixed, thanks for reporting.');
await kasia.locator('.staff button:has-text("Save")').click();
await kasia.locator('.pill--resolved').first().waitFor({ timeout: 8000 });
check('the status pill updates', true);
const olaNotifs = await (
	await fetch(`${API}/notifications/`, { headers: { Authorization: `Token ${olaToken}` } })
).json();
const told = (Array.isArray(olaNotifs) ? olaNotifs : (olaNotifs.results ?? [])).find(
	(n) => n.type === 'issue_status_changed' && n.target_label === `${stamp} ola private`
);
check(
	'the reporter was notified with the note',
	Boolean(told) && told.note === 'Fixed, thanks for reporting.'
);
await page_goto(ola, `${BASE}/notifications`);
check(
	'…and the notification renders and links to the report',
	(await ola.locator(`a[href$="/issues/${olaIssue.id}"]`).count()) >= 1
);

// ---- 5. phone: the link lives in the drawer, and the bar is still one row
const phone = await newPage({ width: 390, height: 844 });
await page_goto(phone, `${BASE}/`);
await phone.locator('button[aria-controls]').first().click();
await settle(phone, 600);
await phone.screenshot({ path: 'e2e/screenshots/issue-drawer-390.png' });
check(
	'the drawer offers Report issue to a guest',
	await phone.locator('.drawer button:has-text("Report issue")').isVisible()
);

// ---- 6. kill switch: every link goes for a non-staff visitor
const kasiaToken = await apiToken('kasia@edmat.example');
const setFlag = (on) =>
	fetch(`${API}/feature-flags/issues/`, {
		method: 'PATCH',
		headers: { 'Content-Type': 'application/json', Authorization: `Token ${kasiaToken}` },
		body: JSON.stringify({ is_enabled: on })
	});
check('flag off (API)', (await setFlag(false)).status === 200);
try {
	await page_goto(ola, `${BASE}/`);
	check('no link under the logo', (await ola.locator('.brand__report').count()) === 0);
	check(
		'no footer links',
		(await ola.locator('footer a[href$="/issues"]').count()) === 0 &&
			(await ola.locator('footer button:has-text("Report issue")').count()) === 0
	);
	await ola.locator('button.popover__trigger:has(.account-trigger)').click();
	check(
		'no account-menu item',
		(await ola.getByRole('menuitem', { name: 'Report issue' }).count()) === 0
	);
	await ola.keyboard.press('Escape');
	await page_goto(ola, `${BASE}/issues`);
	check(
		'the page shows the disabled notice',
		await ola.getByText(/currently unavailable/).isVisible()
	);
	check(
		'the API refuses filing',
		[401, 403].includes(
			(
				await fetch(`${API}/issues/`, {
					method: 'POST',
					headers: { 'Content-Type': 'application/json' },
					body: JSON.stringify({ title: 'x' })
				})
			).status
		)
	);
} finally {
	check('flag back on', (await setFlag(true)).status === 200);
}

check('zero console/page errors', errors.length === 0, errors.join(' | '));
console.log(`\n${pass} passed, ${fail} failed`);
await browser.close();
process.exit(fail ? 1 : 0);

async function page_goto(page, url) {
	await page.goto(url, { waitUntil: 'load' });
	await settle(page, 1500);
}
