// Tickets, the door and the badge sheet (CONFERENCE-BRIEF.md §3.D). Kasia hosts, Ola attends.
//
// What is driven in the real browser: the ticket page (QR drawn, short code shown, print
// stylesheet present), the scanner's **typed-code** path with its result banner, and the badge
// sheet. The camera itself cannot be driven — Playwright can fake a webcam stream but not one
// holding a real QR code in focus — so the camera button is asserted to exist and the decode path
// is exercised through the code somebody would type when the camera fails, which is the same
// `queueScan()` → IndexedDB → batch endpoint the camera uses.
//
// What is driven through the API: a batch of scans posted as the volunteer would post them
// (entry, a duplicate in the same batch, an unknown token, an exit), because a batch is the thing
// the offline queue actually sends and the browser only ever sends one scan at a time.
//
//   E2E_BASE=http://localhost:5204 E2E_API=http://127.0.0.1:8104 node e2e/event-tickets.mjs
import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { englishContext } from './english.mjs';

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
const mk = async () => {
	const ctx = await englishContext(browser, BASE, { viewport: { width: 1000, height: 1100 } });
	const p = await ctx.newPage();
	p.on('console', (msg) => {
		if (msg.type() === 'error') errors.push(`[${p.url()}] ${msg.text()}`);
	});
	p.on('pageerror', (e) => errors.push(e.message));
	return p;
};
const settle = (p, ms = 900) => p.waitForTimeout(ms);
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
const auth = (t) => ({ 'Content-Type': 'application/json', Authorization: `Token ${t}` });
const MARKER = 'Tickets e2e — the door';

// ---- scratch state, reset first so a re-run is clean -------------------------------------------
for (const e of await (
	await fetch(`${API}/api/events/?mine=hosting`, { headers: auth(kasia) })
).json()) {
	if (e.title === MARKER)
		await fetch(`${API}/api/events/${e.id}/`, { method: 'DELETE', headers: auth(kasia) });
}
const start = new Date(Date.now() + 3 * 86400e3);
start.setHours(9, 0, 0, 0);
const created = await (
	await fetch(`${API}/api/events/`, {
		method: 'POST',
		headers: auth(kasia),
		body: JSON.stringify({
			title: MARKER,
			summary: 'Scanning at the door.',
			description: 'A scratch event for the tickets e2e script.',
			starts_at: start.toISOString(),
			duration_minutes: 240,
			location_kind: 'onsite',
			location_text: 'Hall A, ground floor',
			status: 'published',
			visibility: 'public',
			language: 'en',
			audience: 'university'
		})
	})
).json();
const eventId = created.id;
check('scratch event created', Boolean(eventId), JSON.stringify(created).slice(0, 200));

// Ola says she is coming — which is what mints her ticket.
const answered = await fetch(`${API}/api/events/${eventId}/attend/`, {
	method: 'POST',
	headers: auth(ola),
	body: JSON.stringify({ status: 'going' })
});
check('ola is going', answered.status === 200, String(answered.status));

const myTicket = await (
	await fetch(`${API}/api/events/${eventId}/my-ticket/`, { headers: auth(ola) })
).json();
check(
	'a ticket was minted with a 32-character token',
	(myTicket.token ?? '').length === 32,
	myTicket.token
);
check('the short code is the token prefix', myTicket.short_code === myTicket.token?.slice(0, 8));

// ---- the ticket page, in the browser ----------------------------------------------------------
const olaPage = await mk();
const login = async (p, email) => {
	await p.goto(`${BASE}/login`, { waitUntil: 'networkidle', timeout: 90000 });
	await settle(p, 800);
	await p.locator('form input[autocomplete="username"]').fill(email);
	await p.locator('form input[type="password"]').fill('password123');
	await p.locator('form button[type="submit"]').click();
	await p.waitForURL((u) => !u.pathname.includes('/login'), { timeout: 20000 });
};
await login(olaPage, 'ola@edmat.example');
await olaPage.goto(`${BASE}/events/${eventId}`, { waitUntil: 'load', timeout: 60000 });
// `waitFor`, not a fixed settle: a component added this session pays Vite's cold compile on the
// first page that asks for it (e2e/CLAUDE.md traps 11 and 22), and 1.5 s is not always enough —
// this check failed exactly once that way while the panel rendered perfectly in a probe run.
const ticketPanel = olaPage.locator('section.tickets');
const panelShown = await ticketPanel
	.waitFor({ timeout: 30000 })
	.then(() => true)
	.catch(() => false);
check(
	'the event page offers "My ticket" at the conference mount point',
	panelShown && (await ticketPanel.innerText()).includes('My ticket')
);

await olaPage.goto(`${BASE}/events/${eventId}/ticket`, { waitUntil: 'load', timeout: 60000 });
await olaPage.locator('[data-testid="short-code"]').waitFor({ timeout: 45000 });
check(
	'the ticket page shows the same short code the API gave',
	(await olaPage.locator('[data-testid="short-code"]').innerText()).trim() === myTicket.short_code
);
// A canvas that has been drawn on is not blank: read a pixel back rather than trusting that the
// element exists (a blank canvas is exactly the bug a screenshot once caught on the whiteboard).
const qrDrawn = await olaPage.evaluate(() => {
	const c = document.querySelector('canvas');
	if (!c || !c.width) return false;
	const data = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
	let dark = 0;
	for (let i = 0; i < data.length; i += 4) if (data[i] < 128) dark++;
	return dark > 200;
});
check('the QR code is actually drawn (dark pixels on the canvas)', qrDrawn);
check(
	'the ticket page names the event and the room',
	(await olaPage.locator('.ticket').innerText()).includes('Hall A')
);
await olaPage.screenshot({ path: '/tmp/edmat-e2e-ticket.png', fullPage: true });

// ---- the scanner, typed-code path -------------------------------------------------------------
const kasiaPage = await mk();
await login(kasiaPage, 'kasia@edmat.example');
await kasiaPage.goto(`${BASE}/events/${eventId}/scan`, { waitUntil: 'load', timeout: 60000 });
await kasiaPage.locator('#typed-code').waitFor({ timeout: 45000 });
check(
	'the scanner offers the camera',
	await kasiaPage.locator('button', { hasText: 'Use the camera' }).first().isVisible()
);
await kasiaPage.locator('#typed-code').fill(myTicket.short_code);
await kasiaPage.locator('form.typed button[type="submit"]').click();
const bannerText = await kasiaPage
	.locator('[data-testid="scan-banner"]')
	.innerText({ timeout: 20000 })
	.catch(() => '');
check('a banner appears for the scan', bannerText.length > 0, bannerText);
// The queue flushes every 5 s; the banner turns from "queued" into the server's real answer.
await kasiaPage.waitForFunction(
	() => document.querySelector('[data-testid="scan-banner"]')?.textContent?.includes('Come in'),
	{ timeout: 20000 }
);
check('the typed code admits the holder', true);
await kasiaPage.screenshot({ path: '/tmp/edmat-e2e-scan.png', fullPage: true });

// The name search reads the cached list — masked names only, no ids.
await kasiaPage.locator('#name-search').fill('Ola');
await settle(kasiaPage, 500);
const matchText = await kasiaPage
	.locator('.matches')
	.innerText()
	.catch(() => '');
check('the cached list can be searched by first name', matchText.includes('Ola'), matchText);

const listRows = await (
	await fetch(`${API}/api/events/${eventId}/checkin-list/`, { headers: auth(kasia) })
).json();
check(
	'the check-in list carries no ids and no contact data',
	listRows.length > 0 &&
		Object.keys(listRows[0]).sort().join(',') ===
			'checked_in_at,checked_out_at,inside,name,short_code,status,token' &&
		!JSON.stringify(listRows).includes('@'),
	JSON.stringify(listRows[0])
);

// ---- a batch, as the offline queue would send it ------------------------------------------------
const now = Date.now();
const batch = await (
	await fetch(`${API}/api/events/${eventId}/scans/`, {
		method: 'POST',
		headers: auth(kasia),
		body: JSON.stringify({
			scans: [
				{
					token: myTicket.token,
					direction: 'exit',
					client_nonce: `e2e-exit-${now}`,
					client_at: new Date(now).toISOString(),
					is_offline_sync: true
				},
				{
					token: myTicket.token,
					direction: 'entry',
					client_nonce: `e2e-in-${now}`,
					client_at: new Date(now + 1000).toISOString(),
					is_offline_sync: true
				},
				{
					token: myTicket.token,
					direction: 'entry',
					client_nonce: `e2e-dup-${now}`,
					client_at: new Date(now + 2000).toISOString(),
					is_offline_sync: true
				},
				{
					token: 'notaticketatall',
					direction: 'entry',
					client_nonce: `e2e-unknown-${now}`,
					client_at: new Date(now + 3000).toISOString(),
					is_offline_sync: true
				}
			]
		})
	})
).json();
const byNonce = Object.fromEntries((batch.results ?? []).map((r) => [r.client_nonce, r.result]));
check('an exit is recorded', byNonce[`e2e-exit-${now}`] === 'exited', JSON.stringify(byNonce));
check('re-entry after an exit admits again', byNonce[`e2e-in-${now}`] === 'admitted');
check(
	'the second entry in the same batch is a collision',
	byNonce[`e2e-dup-${now}`] === 'collision'
);
check('an unknown token is refused', byNonce[`e2e-unknown-${now}`] === 'unknown');
check(
	'the counts are recomputed, not incremented',
	batch.counts?.inside === 1,
	JSON.stringify(batch.counts)
);

// A replayed batch changes nothing — the nonce is what makes a retry safe.
const replay = await (
	await fetch(`${API}/api/events/${eventId}/scans/`, {
		method: 'POST',
		headers: auth(kasia),
		body: JSON.stringify({
			scans: [
				{
					token: myTicket.token,
					direction: 'entry',
					client_nonce: `e2e-in-${now}`,
					client_at: new Date(now + 1000).toISOString()
				}
			]
		})
	})
).json();
check('a replayed nonce returns the stored answer', replay.results?.[0]?.result === 'admitted');
check(
	'and does not double-count',
	replay.counts?.entries === batch.counts?.entries,
	`${replay.counts?.entries} vs ${batch.counts?.entries}`
);

// ---- the panel shows the person checked in -----------------------------------------------------
await kasiaPage.goto(`${BASE}/events/${eventId}`, { waitUntil: 'load', timeout: 60000 });
await kasiaPage.locator('.registrations').waitFor({ timeout: 45000 });
// The container appears before its rows do; on the merged event page the gap is long enough to
// read "Registrations (0)" — wait for the pill the check is about (integration, 2026-09-23).
await kasiaPage
	.locator('.registrations .pill--checked')
	.first()
	.waitFor({ timeout: 15000 })
	.catch(() => {});
const panelText = await kasiaPage.locator('.registrations').innerText();
check(
	'the registrations panel shows the scanned person as checked in',
	panelText.includes('Checked in'),
	panelText.slice(0, 300)
);
check(
	'the panel links to the badge sheet',
	await kasiaPage.locator('.registrations a.badges').isVisible()
);

// ---- the badge sheet ----------------------------------------------------------------------------
await kasiaPage.goto(`${BASE}/events/${eventId}/badges`, { waitUntil: 'load', timeout: 60000 });
await kasiaPage.locator('.grid .badge').first().waitFor({ timeout: 45000 });
check(
	'the badge sheet draws one badge per person going',
	(await kasiaPage.locator('.grid .badge').count()) === 1
);
await kasiaPage.screenshot({ path: '/tmp/edmat-e2e-badges.png', fullPage: true });

// ---- the QR decoder is not in the entry bundle (house rule 11) -----------------------------------
// Asserted against a real production build if one is lying beside the source; skipped, loudly,
// when there is none, because a silently-skipped bundle check is how a lazily-imported library
// creeps back into every page's first paint.
const entryDir = join(process.cwd(), 'build', '_app', 'immutable', 'entry');
if (existsSync(entryDir)) {
	const blob = readdirSync(entryDir)
		.filter((f) => f.endsWith('.js'))
		.map((f) => readFileSync(join(entryDir, f), 'utf8'))
		.join('\n');
	// Library-internal identifiers, not generic ones: `toDataURL` is a canvas API that appears in
	// eleven chunks honestly, and asserting on it would fail for a reason that has nothing to do
	// with the QR libraries.
	check('jsQR is absent from the entry chunk', !/jsQR|locateFinderPattern/.test(blob));
	check('qrcode is absent from the entry chunk', !/getSymbolSize|alignmentPattern/.test(blob));
} else {
	console.log('  --  skipped the bundle assertion: run `npm run build` first');
}

// ---- cleanup ------------------------------------------------------------------------------------
await fetch(`${API}/api/events/${eventId}/attend/`, {
	method: 'POST',
	headers: auth(ola),
	body: JSON.stringify({ status: 'not_going' })
});
await fetch(`${API}/api/events/${eventId}/`, { method: 'DELETE', headers: auth(kasia) });
const gone = await fetch(`${API}/api/events/${eventId}/`, { headers: auth(kasia) });
check('the scratch event is removed', gone.status === 404, String(gone.status));

check('no console or page errors', errors.length === 0, errors.join(' | '));
await browser.close();
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
