// The cloakroom desk (CONFERENCE-BRIEF.md §3.F) on the real pages: an organiser opens a desk,
// takes three things in, hands one back against its typed ticket, hands a second back WITHOUT a
// ticket through the exception dialog, finds the lost ticket refused afterwards, and closes the
// desk with one item still on a hook. Plus: an attendee is told there is a cloakroom and is given
// no way into the desk, and neither `qrcode` nor `@zxing/browser` is in the entry bundle.
//
//   E2E_BASE=http://localhost:5206 E2E_API=http://127.0.0.1:8106 node e2e/event-cloakroom.mjs
//
// Kasia hosts and works the desk (she is the seeded staff account, which is irrelevant here — no
// check in this script is a FeatureFlag check, so e2e/CLAUDE.md trap 10 does not bite). Michał is
// the attendee. Scratch data is removed through the API at the end.
let chromium;
try {
	({ chromium } = await import('playwright'));
} catch {
	({ chromium } = await import('playwright-core'));
}
const BASE = process.env.E2E_BASE ?? 'http://localhost:5206';
const API = process.env.E2E_API ?? 'http://127.0.0.1:8106';
let pass = 0,
	fail = 0;
const errors = [];
const check = (l, ok, x = '') => {
	if (ok) pass++;
	else fail++;
	console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${l} ${ok ? '' : x}`);
};

const tokenFor = async (email) => {
	const r = await fetch(`${API}/api/auth/login/`, {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify({ username: email, password: 'password123' })
	});
	return (await r.json()).token;
};
const kasia = await tokenFor('kasia@edmat.example');
const auth = (t) => ({ 'Content-Type': 'application/json', Authorization: `Token ${t}` });

const MARKER = 'Cloakroom e2e — konferencja';
for (const e of await (
	await fetch(`${API}/api/events/?mine=hosting`, { headers: auth(kasia) })
).json()) {
	if (e.title === MARKER)
		await fetch(`${API}/api/events/${e.id}/`, { method: 'DELETE', headers: auth(kasia) });
}

const start = new Date(Date.now() + 5 * 86400e3);
start.setHours(17, 0, 0, 0);
const event = await (
	await fetch(`${API}/api/events/`, {
		method: 'POST',
		headers: auth(kasia),
		body: JSON.stringify({
			title: MARKER,
			status: 'published',
			visibility: 'public',
			starts_at: start.toISOString(),
			duration_minutes: 300,
			location_kind: 'onsite',
			location_text: 'Banacha 2',
			language: 'pl',
			audience: 'university'
		})
	})
).json();
check('scratch event created', Boolean(event.id), JSON.stringify(event).slice(0, 200));

const browser = await chromium.launch(
	process.env.CHROME ? { executablePath: process.env.CHROME } : {}
);
const mk = async () => {
	const p = await (
		await browser.newContext({ viewport: { width: 1280, height: 1000 }, acceptDownloads: true })
	).newPage();
	p.on('console', (m) => {
		if (m.type() === 'error') errors.push(`[${p.url()}] ${m.text()}`);
	});
	p.on('pageerror', (e) => errors.push(e.message));
	// A generous default: this repo's dev server can take many seconds to compile a route the first
	// time (e2e/CLAUDE.md trap 11), and this script is routinely run on a machine with six other
	// agents' test suites on it. A timeout here means "the page never got there", not "slow".
	p.setDefaultTimeout(60000);
	return p;
};
const settle = (p, ms = 700) => p.waitForTimeout(ms);
const login = async (p, email) => {
	// Wait for the root layout's own boot request, not for the form element: every control is in
	// the server-rendered HTML, so the field resolves — and the submit button does a NATIVE form
	// GET, landing on `/login?` — until the bundle has hydrated (e2e/CLAUDE.md trap 25, which this
	// script hit on its first run).
	const booted = p.waitForResponse((r) => r.url().includes('/feature-flags/'), { timeout: 90000 });
	await p.goto(`${BASE}/login`, { waitUntil: 'load', timeout: 90000 });
	await booted;
	await p.locator('form input[autocomplete="username"]').waitFor({ timeout: 30000 });
	await settle(p, 1200);
	await p.locator('form input[autocomplete="username"]').fill(email);
	await p.locator('form input[type="password"]').fill('password123');
	await p.locator('form button[type="submit"]').click();
	await p.waitForURL((u) => !u.pathname.includes('/login'), { timeout: 45000 });
};

// ---- the organiser opens a desk ------------------------------------------------------------
const page = await mk();
await login(page, 'kasia@edmat.example');
await page.goto(`${BASE}/events/${event.id}`, { waitUntil: 'load', timeout: 90000 });
await page.locator('[data-cloakroom-panel]').waitFor({ timeout: 30000 });
check('the event page mounts the cloakroom panel', true);
await page.locator('[data-cloakroom-panel] a').click();
await page.waitForURL((u) => u.pathname.endsWith('/cloakroom'), { timeout: 20000 });
// Warm Vite's dependency optimizer before anything is asserted: the desk page is the first thing
// in the app that names `qrcode` and `@zxing/browser`, so the dev server discovers both, re-bundles
// and RELOADS the page underneath the script — which silently threw away a filled form on the
// first run of this script (e2e/CLAUDE.md trap 22). One throwaway load, then a reload of our own.
await settle(page, 4000);
await page.reload({ waitUntil: 'load', timeout: 90000 });
await settle(page, 1500);

await page.locator('input[name="desk_name"]').fill('Szatnia — wejście północne');
await page.locator('textarea[name="desk_racks"]').fill('1-6');
await page.locator('input[name="desk_note"]').fill('Parter, czynna od 17:00');
await page.locator('.new-desk button').click();
await page.locator('[data-cloakroom-counts]').waitFor({ timeout: 20000 });
check(
	'the desk opens with six hooks, all free',
	(await page.locator('[data-cloakroom-grid] button').count()) === 6,
	await page.locator('[data-cloakroom-counts]').innerText()
);

// ---- three deposits --------------------------------------------------------------------------
const depositOn = async (rack, description) => {
	await page
		.locator('[data-cloakroom-grid] button', { hasText: new RegExp(`^${rack}\\b`) })
		.first()
		.click();
	await page.locator('input[name="description"]').fill(description);
	await page.locator('.card > button.primary').click();
	await page.locator('[data-cloakroom-token]').waitFor({ timeout: 20000 });
	const token = await page.locator('[data-cloakroom-token]').getAttribute('data-cloakroom-token');
	return token;
};
const tokenOne = await depositOn('1', 'długi zielony płaszcz');
check(
	'a deposit hands back an eight-character ticket',
	(tokenOne ?? '').length === 8,
	String(tokenOne)
);
// The QR is drawn after a DYNAMIC import resolves (house rule 11), so it arrives a moment after
// the token does — waiting for it is the check, counting immediately is a race the first run lost.
await page
	.locator('.slip img.qr')
	.waitFor({ timeout: 20000 })
	.catch(() => {});
check('the slip draws a QR code', (await page.locator('.slip img.qr').count()) === 1);
await page.screenshot({ path: 'e2e/screens/cloakroom-slip.png' });

await page.locator('button:has-text("Następna rzecz")').click();
await settle(page, 400);
const tokenTwo = await depositOn('2', 'czarna kurtka z kapturem');
await page.locator('button:has-text("Następna rzecz")').click();
await settle(page, 400);
const tokenThree = await depositOn('3', 'plecak');
await page.locator('button:has-text("Następna rzecz")').click();
await settle(page, 400);
check(
	'three distinct tickets',
	new Set([tokenOne, tokenTwo, tokenThree]).size === 3,
	[tokenOne, tokenTwo, tokenThree].join(' ')
);
check(
	'the grid now shows three taken hooks',
	(await page.locator('[data-cloakroom-grid] button.taken').count()) === 3
);
await page.screenshot({ path: 'e2e/screens/cloakroom-racks.png' });

// ---- return by typed ticket ------------------------------------------------------------------
const returnTab = page.locator('.tabs button', { hasText: 'Wydaj rzecz' });
// The verdict line STAYS on the card between attempts, so reading it straight after the click
// reads the PREVIOUS answer — the first run of this script scored two false failures on exactly
// that. Wait for the value to change instead.
let lastVerdict = null;
const typeToken = async (value) => {
	await returnTab.click();
	await page.locator('input[name="token"]').fill(value);
	await page.locator('.card .actions button.primary').click();
	await page.locator('[data-cloakroom-verdict]').waitFor({ timeout: 20000 });
	const deadline = Date.now() + 20000;
	let seen = lastVerdict;
	while (Date.now() < deadline) {
		seen = await page.locator('[data-cloakroom-verdict]').getAttribute('data-cloakroom-verdict');
		if (seen !== lastVerdict) break;
		await page.waitForTimeout(200);
	}
	lastVerdict = seen;
	return seen;
};
check('a typed ticket hands the coat back', (await typeToken(tokenOne)) === 'returned');
check(
	'the same ticket a second time is refused',
	(await typeToken(tokenOne)) === 'already_returned'
);
check('an invented ticket is unknown', (await typeToken('ZZZZZZZZ')) === 'unknown_token');

// ---- the exception return ---------------------------------------------------------------------
await page.locator('.tabs button', { hasText: 'Wieszaki' }).click();
await settle(page, 400);
await page.locator('.stored-list li', { hasText: 'czarna kurtka' }).locator('button.ghost').click();
await page.locator('[data-cloakroom-exception]').waitFor({ timeout: 20000 });
check('the exception dialog opens', true);
await page
	.locator('[data-cloakroom-exception] input[name="description"]')
	.fill('czarna kurtka z kapturem, czerwona podszewka');
await page
	.locator('[data-cloakroom-exception] select[name="identity_kind"]')
	.selectOption('student_card');
await page.locator('[data-cloakroom-exception] button.primary').click();
await page.locator('[data-cloakroom-exception]').waitFor({ state: 'detached', timeout: 20000 });
// The dialog closes before the desk has been re-read; the rail is what the check is about.
await settle(page, 1500);
check(
	'the coat leaves the rack after an exception return',
	(await page.locator('.stored-list li', { hasText: 'czarna kurtka' }).count()) === 0
);
check('the lost ticket is blacklisted afterwards', (await typeToken(tokenTwo)) === 'blacklisted');

// ---- closing the desk --------------------------------------------------------------------------
await page.locator('.tabs button', { hasText: 'Zamknij szatnię' }).click();
await settle(page, 400);
await page.locator('.card button.primary').click();
await page.locator('[data-cloakroom-unclaimed]').waitFor({ timeout: 20000 });
const unclaimedHeading = await page.locator('[data-cloakroom-unclaimed]').innerText();
check(
	'closing the desk lists exactly the one thing left on a hook',
	/1$/.test(unclaimedHeading.trim()),
	unclaimedHeading
);
check(
	'the unclaimed row is the rucksack',
	(await page.locator('.stored-list li', { hasText: 'plecak' }).count()) === 1
);
await page.screenshot({ path: 'e2e/screens/cloakroom-close.png' });

const deskId = (
	await (
		await fetch(`${API}/api/events/${event.id}/cloakroom-desks/`, { headers: auth(kasia) })
	).json()
)[0].id;
const csv = await (
	await fetch(`${API}/api/cloakroom-desks/${deskId}/export/`, { headers: auth(kasia) })
).text();
// `csv.writer` ends lines with CRLF, so the header carries a trailing \r that is not a column.
const header = csv.trim().split('\n')[0].trim();
check(
	'the CSV header is the six no-name columns',
	header === 'rack,token,status,deposited_at,returned_at,identity_kind',
	header
);
check('no account name appears anywhere in the CSV', !/kasia|michal|Kasia|Michał/.test(csv));

// ---- the attendee's side ------------------------------------------------------------------------
const attendee = await mk();
await login(attendee, 'michal@edmat.example');
await attendee.goto(`${BASE}/events/${event.id}`, { waitUntil: 'load', timeout: 90000 });
await attendee.locator('[data-cloakroom-panel]').waitFor({ timeout: 30000 });
const attendeeText = await attendee.locator('[data-cloakroom-panel]').innerText();
check('an attendee is told there is a cloakroom', /Szatnia/.test(attendeeText), attendeeText);
check(
	'an attendee gets no way into the desk',
	(await attendee.locator('[data-cloakroom-panel] a').count()) === 0
);
check(
	'an attendee is told nothing about what is on the racks',
	!/plecak|kurtka|płaszcz/.test(attendeeText),
	attendeeText
);

// ---- the two heavy libraries stay out of the entry bundle ------------------------------------
const requested = [];
const bundlePage = await mk();
bundlePage.on('request', (r) => requested.push(r.url()));
await bundlePage.goto(`${BASE}/events/${event.id}`, { waitUntil: 'load', timeout: 90000 });
await settle(bundlePage, 1500);
check(
	'neither qrcode nor @zxing is fetched by a page that never draws a slip',
	!requested.some((u) => /qrcode|zxing/i.test(u)),
	requested.filter((u) => /qrcode|zxing/i.test(u)).join(' ')
);

// ---- cleanup --------------------------------------------------------------------------------
const removed = await fetch(`${API}/api/events/${event.id}/`, {
	method: 'DELETE',
	headers: auth(kasia)
});
check(
	'the scratch event (and its desk) is removed',
	removed.status === 204,
	String(removed.status)
);
const gone = await fetch(`${API}/api/cloakroom-desks/${deskId}/`, { headers: auth(kasia) });
check('the desk went with it', gone.status === 404, String(gone.status));

check('no console or page errors', errors.length === 0, errors.join(' | '));
await browser.close();
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
