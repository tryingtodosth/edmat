// The needs board (MANAGEMENT-BRIEF.md §3.C) on the real pages: Kasia hosts a scratch event and
// posts a need on it from `NeedsPanel`; Michał, a second demo account, opens the need from the
// public board and applies; Kasia accepts him from the need's own applications queue, and the
// need's status flips to "fulfilled" once accepted reaches `wantedCount`. Then the `needs` kill
// switch is flipped off and the panel/nav link are checked to vanish for a non-staff account
// (e2e/CLAUDE.md trap 10), and flipped back on.
//
//   E2E_BASE=http://localhost:5223 E2E_API=http://127.0.0.1:8123 node e2e/needs.mjs
//
// Scratch data (one event) is created and removed through the real API. The Need row itself has no
// DELETE endpoint by design (backend/needs/CLAUDE.md — tombstone, not hard-delete); once its event
// is gone the row is unreachable through the API (`needs/rules.py: public_needs` drops a need whose
// node fails to resolve), which is the honest cleanup this app offers.
let chromium;
try {
	({ chromium } = await import('playwright'));
} catch {
	({ chromium } = await import('playwright-core'));
}
const BASE = process.env.E2E_BASE ?? 'http://localhost:5223';
const API = process.env.E2E_API ?? 'http://127.0.0.1:8123';
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
const kasiaToken = await tokenFor('kasia@edmat.example');
const auth = (t) => ({ 'Content-Type': 'application/json', Authorization: `Token ${t}` });

const MARKER = 'Needs e2e — kartkówki do sprawdzenia';
for (const e of await (
	await fetch(`${API}/api/events/?mine=hosting`, { headers: auth(kasiaToken) })
).json()) {
	if (e.title === MARKER)
		await fetch(`${API}/api/events/${e.id}/`, { method: 'DELETE', headers: auth(kasiaToken) });
}

const start = new Date(Date.now() + 6 * 86400e3);
start.setHours(18, 0, 0, 0);
const event = await (
	await fetch(`${API}/api/events/`, {
		method: 'POST',
		headers: auth(kasiaToken),
		body: JSON.stringify({
			title: MARKER,
			status: 'published',
			visibility: 'public',
			starts_at: start.toISOString(),
			duration_minutes: 120,
			location_kind: 'onsite',
			location_text: 'Pasteura 5',
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
	const p = await (await browser.newContext({ viewport: { width: 1280, height: 1000 } })).newPage();
	p.on('console', (m) => {
		// A deliberately-triggered 409 (already applied, already decided) still logs Chromium's own
		// generic "Failed to load resource" network line to the console even though the app handles
		// it gracefully — the same noise `booking.mjs`/`tutoring-modals.mjs` already filter.
		if (m.type() === 'error' && !/status of 409 \(Conflict\)/.test(m.text())) {
			errors.push(`[${p.url()}] ${m.text()}`);
		}
	});
	p.on('pageerror', (e) => errors.push(e.message));
	p.setDefaultTimeout(60000);
	return p;
};
const settle = (p, ms = 700) => p.waitForTimeout(ms);
const login = async (p, email) => {
	const booted = p.waitForResponse((r) => r.url().includes('/feature-flags/'), { timeout: 90000 });
	await p.goto(`${BASE}/login`, { waitUntil: 'load', timeout: 90000 });
	await booted;
	await p.locator('form input[autocomplete="username"]').waitFor({ timeout: 30000 });
	await settle(p, 1000);
	await p.locator('form input[autocomplete="username"]').fill(email);
	await p.locator('form input[type="password"]').fill('password123');
	await p.locator('form button[type="submit"]').click();
	await p.waitForURL((u) => !u.pathname.includes('/login'), { timeout: 45000 });
};

// ---- Kasia posts a need from the event page's panel -------------------------------------------
const kasia = await mk();
await login(kasia, 'kasia@edmat.example');
await kasia.goto(`${BASE}/events/${event.id}`, { waitUntil: 'load', timeout: 90000 });
await kasia.locator('[data-needs-panel]').waitFor({ timeout: 30000 });
check('the event page mounts the needs panel', true);

await kasia.locator('[data-needs-panel] button.primary').click();
await settle(kasia, 300);
await kasia
	.locator('[data-needs-panel] .add-form input[type="text"]')
	.first()
	.fill('Sprawdzenie kartkówek z pierwszego tygodnia');
await kasia
	.locator('[data-needs-panel] .add-form textarea')
	.fill('Około 30 prac, klucz odpowiedzi gotowy, wystarczy porównać z kluczem.');
await kasia.locator('[data-needs-panel] .add-form select').first().selectOption('help');
// Two fields share `inputmode="numeric"` (estimated hours, then wanted count) — positional
// locators lie (e2e/CLAUDE.md trap 6), so both are addressed explicitly rather than `.first()`.
// wantedCount is left at 1 (its default) on purpose: the later "fulfilled at one acceptance"
// check depends on it.
const numericFields = kasia.locator('[data-needs-panel] .add-form input[inputmode="numeric"]');
await numericFields.nth(0).fill('2');
await kasia.locator('[data-needs-panel] .add-form button.primary').click();
await kasia.locator('[data-needs-panel] .list .row').first().waitFor({ timeout: 20000 });
check(
	'the posted need appears in the panel, open',
	(await kasia.locator('[data-needs-panel] .list .row .pill--open').count()) === 1
);

const needHref = await kasia
	.locator('[data-needs-panel] .list .row .title')
	.first()
	.getAttribute('href');
check('the need row links somewhere', Boolean(needHref), String(needHref));

await kasia.locator('[data-needs-panel] .list .row .title').first().click();
await kasia.waitForURL((u) => /\/needs\/\d+/.test(u.pathname), { timeout: 20000 });
const needId = kasia.url().match(/\/needs\/(\d+)/)[1];
check('landed on the need detail page', Boolean(needId), kasia.url());
await settle(kasia, 500);
await kasia.screenshot({ path: 'e2e/screens/needs-detail-manager.png' });

// The board lists it too.
const boardKasia = await mk();
await boardKasia.goto(`${BASE}/needs`, { waitUntil: 'load', timeout: 90000 });
await boardKasia.locator('.grid .card').first().waitFor({ timeout: 20000 });
check(
	'the board lists the scratch need',
	(await boardKasia.locator(`.card[href$="/needs/${needId}"]`).count()) === 1
);
await boardKasia.screenshot({ path: 'e2e/screens/needs-board.png' });

// ---- Michał finds it and applies ---------------------------------------------------------------
const michal = await mk();
await login(michal, 'michal@edmat.example');
await michal.goto(`${BASE}/needs/${needId}`, { waitUntil: 'load', timeout: 90000 });
await michal.locator('h1').waitFor({ timeout: 20000 });
check(
	'a non-manager sees the Apply form, not the applications queue',
	(await michal.locator('.apply form').count()) === 1 &&
		(await michal.locator('.manager').count()) === 0
);
await michal.locator('.apply textarea').fill('Mogę to zrobić w ten weekend.');
await michal.locator('.apply button.primary').click();
await michal.locator('.apply .status').waitFor({ timeout: 20000 });
check(
	'the application is recorded as pending',
	/Pending|Oczekuje/.test(await michal.locator('.apply .status').innerText())
);
check('a withdraw button appears', (await michal.locator('.apply button').count()) === 1);

// There is no "my own application" lookup endpoint (backend/needs/CLAUDE.md, Left open), so a
// reload honestly shows the apply form again rather than remembering the pending application —
// and a second submission from the same account is refused by the API with `already_applied`.
await michal.reload({ waitUntil: 'load', timeout: 90000 });
await settle(michal, 800);
check(
	'reloading shows the apply form again (no "my application" lookup yet)',
	(await michal.locator('.apply form').count()) === 1
);
await michal.locator('.apply textarea').fill('Jeszcze raz, na wszelki wypadek.');
await michal.locator('.apply button.primary').click();
await michal.locator('.apply .error').waitFor({ timeout: 20000 });
check(
	'a second application from the same account is refused as already_applied',
	/already applied|zgłosiłeś/i.test(await michal.locator('.apply .error').innerText())
);

// ---- Kasia accepts him ---------------------------------------------------------------------------
await kasia.reload({ waitUntil: 'load', timeout: 90000 });
await kasia.locator('.manager .list li').first().waitFor({ timeout: 20000 });
check(
	'the manager sees one pending application',
	(await kasia.locator('.manager .list li').count()) === 1
);
// Wait on the actual `/decide/` response rather than a fixed sleep — under six agents' worth of
// CPU contention on this machine a flat 1000ms settle has been seen to reload before the request
// even lands (e2e/CLAUDE.md trap 3's general shape, applied to a slow host rather than HMR).
const decided = kasia.waitForResponse(
	(r) => r.url().includes('/decide/') && r.request().method() === 'POST',
	{ timeout: 30000 }
);
await kasia
	.locator(
		'.manager .list li button:has-text("Accept"), .manager .list li button:has-text("Przyjmij")'
	)
	.click();
const decideResponse = await decided;
check('the accept decision was accepted by the server', decideResponse.status() === 200);
await kasia.reload({ waitUntil: 'load', timeout: 90000 });
await settle(kasia, 800);
check(
	'the need is now fulfilled (wanted_count reached)',
	(await kasia.locator('.head .pill--fulfilled').count()) === 1
);
await kasia.screenshot({ path: 'e2e/screens/needs-fulfilled.png' });

// The fulfilled need drops off the PUBLIC board for a stranger, and stays for its manager (kasia).
const anonBoard = await (await fetch(`${API}/api/needs/`)).json();
check(
	'the fulfilled need is gone from the anonymous board',
	!anonBoard.some((n) => String(n.id) === needId),
	JSON.stringify(anonBoard.map((n) => n.id))
);
const kasiaBoard = await (
	await fetch(`${API}/api/needs/?node_kind=event`, { headers: auth(kasiaToken) })
).json();
check(
	"the fulfilled need still shows on its manager's own board read",
	kasiaBoard.some((n) => String(n.id) === needId)
);

// ---- kill switch: off removes the panel and the nav link for a non-staff account ---------------
await fetch(`${API}/api/feature-flags/needs/`, {
	method: 'PATCH',
	headers: auth(kasiaToken),
	body: JSON.stringify({ is_enabled: false })
});
const michalOff = await mk();
await login(michalOff, 'michal@edmat.example');
await michalOff.goto(`${BASE}/events/${event.id}`, { waitUntil: 'load', timeout: 90000 });
await settle(michalOff, 3000);
check(
	'the needs panel is gone from the event page with the flag off',
	(await michalOff.locator('[data-needs-panel]').count()) === 0
);
check(
	'"Help wanted" leaves the nav for a non-staff account',
	(await michalOff.locator('a.nav-link--needs').count()) === 0
);
await fetch(`${API}/api/feature-flags/needs/`, {
	method: 'PATCH',
	headers: auth(kasiaToken),
	body: JSON.stringify({ is_enabled: true })
});

// ---- cleanup -------------------------------------------------------------------------------------
const removed = await fetch(`${API}/api/events/${event.id}/`, {
	method: 'DELETE',
	headers: auth(kasiaToken)
});
check('the scratch event is removed', removed.status === 204, String(removed.status));
const gone = await fetch(`${API}/api/needs/${needId}/`, { headers: auth(kasiaToken) });
check('the need is unreachable once its node is gone', gone.status === 404, String(gone.status));

check('no console or page errors', errors.length === 0, errors.join(' | '));
await browser.close();
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
