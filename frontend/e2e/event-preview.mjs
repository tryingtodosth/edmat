// "View as a visitor" (CONFERENCE-BRIEF.md §3.B): the persona organiser signs in, opens the
// Sandbox conference, turns the preview on, and the script checks the two things that make this a
// preview rather than an impersonation —
//
//   1. **no Authorization header leaves the page while the preview is fetching.** Asserted by
//      intercepting every request the browser makes, not by reading the code: the whole failure
//      mode this feature is built against (the 2018 Facebook "View As" breach) was a preview that
//      looked read-only and carried a token anyway.
//   2. **no action control is rendered inside the preview.** Not disabled — absent. A disabled
//      button is still a control somebody can re-enable in a console; an absent one is not there.
//
// It also checks the amber bar appears and cannot be dismissed except by leaving, that the layout
// preview says it is a layout preview, and that a draft honestly previews as nothing.
//
// Requires `manage.py seed_conference_personas` to have been run against the backend it drives.
//   E2E_BASE=http://localhost:5202 E2E_API=http://127.0.0.1:8102 node e2e/event-preview.mjs
let chromium;
try {
	({ chromium } = await import('playwright'));
} catch {
	({ chromium } = await import('playwright-core'));
}
import { englishContext } from './english.mjs';

const BASE = process.env.E2E_BASE ?? 'http://localhost:5202';
const API = process.env.E2E_API ?? 'http://127.0.0.1:8102';
const PASSWORD = process.env.E2E_PERSONA_PASSWORD ?? 'persona-pass-2026';

let pass = 0,
	fail = 0;
const errors = [];
const check = (label, ok, extra = '') => {
	if (ok) pass++;
	else fail++;
	console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${label} ${ok ? '' : extra}`);
};

const auth = (token) => ({ 'Content-Type': 'application/json', Authorization: `Token ${token}` });
const tokenFor = async (identifier) => {
	const r = await fetch(`${API}/api/auth/login/`, {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify({ username: identifier, password: PASSWORD })
	});
	const j = await r.json();
	if (!j.token)
		throw new Error(
			`login failed for ${identifier}: ${JSON.stringify(j)} — run ` +
				`"manage.py seed_conference_personas" against ${API}, and check the login throttle`
		);
	return j.token;
};

const organiser = await tokenFor('persona.organiser@edmat.example');
// The sandbox event, found the way a person would: the organiser's own hosting list.
const hosted = await (
	await fetch(`${API}/api/events/?mine=hosting`, { headers: auth(organiser) })
).json();
const sandbox = hosted.find((e) => e.title === 'Sandbox conference');
if (!sandbox) throw new Error('no "Sandbox conference" — run manage.py seed_conference_personas');
check('the seeded Sandbox conference exists and is published', sandbox.status === 'published');

// A draft of the same organiser's, so "a visitor sees nothing" has something to be true of.
const draft = await (
	await fetch(`${API}/api/events/`, {
		method: 'POST',
		headers: auth(organiser),
		body: JSON.stringify({
			title: 'Preview e2e — a draft nobody announced',
			status: 'draft',
			visibility: 'private',
			audience: 'university',
			location_kind: 'onsite',
			duration_minutes: 60
		})
	})
).json();
check('a draft is created to preview', Boolean(draft.id), JSON.stringify(draft).slice(0, 160));

const browser = await chromium.launch(
	process.env.CHROME ? { executablePath: process.env.CHROME } : {}
);
const context = await englishContext(browser, BASE, { viewport: { width: 1280, height: 1100 } });
const page = await context.newPage();
// The draft preview deliberately provokes a 404 (that IS the check), and the browser logs every
// failed subresource as a console error — so the one expected refusal is named here rather than
// letting it look like a bug. Nothing else is excused.
let expected404 = '';
page.on('console', (m) => {
	if (m.type() !== 'error') return;
	const from = m.location()?.url ?? '';
	if (expected404 && from.includes(expected404)) return;
	errors.push(`[${page.url()}] ${m.text()} ← ${from}`);
});
page.on('pageerror', (e) => errors.push(e.message));

// Every request the page makes, with whether it carried our sign-in. `request` fires for the real
// outgoing request, so this sees the header as it is actually sent rather than as intended.
const sent = [];
page.on('request', (req) => {
	const headers = req.headers();
	sent.push({
		url: req.url(),
		method: req.method(),
		authorization: headers['authorization'] ?? headers['Authorization'] ?? null
	});
});

// Trap 25 in `e2e/CLAUDE.md`: every control is in the server-rendered HTML, so the form resolves
// — and its submit does nothing — until the bundle has hydrated, which on a cold dev server takes
// many seconds. Waiting for the root layout's own boot request is the honest signal, registered
// BEFORE the navigation.
const booted = page.waitForResponse((r) => r.url().includes('/feature-flags/'), {
	timeout: 180000
});
await page.goto(`${BASE}/login`, { waitUntil: 'load', timeout: 300000 });
await booted;
await page.locator('form input[autocomplete="username"]').waitFor({ timeout: 90000 });
await page.waitForTimeout(1200);
await page.locator('form input[autocomplete="username"]').fill('persona.organiser@edmat.example');
await page.locator('form input[type="password"]').fill(PASSWORD);
await page.locator('form button[type="submit"]').click();
try {
	await page.waitForURL((u) => !u.pathname.includes('/login'), { timeout: 60000 });
} catch (e) {
	await page.screenshot({ path: 'e2e/screens/event-preview-login-failed.png' });
	console.log('  login page text:', (await page.locator('form').innerText()).slice(0, 300));
	throw e;
}

await page.goto(`${BASE}/events/${sandbox.id}`, { waitUntil: 'load' });
const switcher = page.locator('.preview-switch');
await switcher.waitFor({ timeout: 90000 });
check('the organiser is offered the preview', await switcher.isVisible());
check(
	'the switch says nobody is signed in as anybody else',
	/signed in as anybody else/i.test(await switcher.innerText())
);
check('no preview bar before the toggle', (await page.locator('.preview-bar').count()) === 0);

// ---- the visitor preview --------------------------------------------------------------------
const before = sent.length;
await switcher.locator('button', { hasText: 'signed-out visitor' }).click();
const bar = page.locator('.preview-bar');
await bar.waitFor({ timeout: 30000 });
const view = page.locator('.preview-view');
await view.locator('.preview-view__head').waitFor({ timeout: 30000 });
await page.waitForTimeout(600);

check('the amber bar appears', await bar.isVisible());
check(
	'the bar says the preview cannot change anything',
	/nothing here can be changed/i.test(await bar.innerText())
);
check(
	'the bar carries exactly one control, and it is the way out',
	(await bar.locator('button').count()) === 1 &&
		/leave the preview/i.test(await bar.locator('button').innerText())
);
check('the bar is pinned to the top of the viewport', (await bar.boundingBox())?.y === 0);

// (2) no action control inside the preview.
check(
	'no button is rendered inside the preview view',
	(await view.locator('button').count()) === 0,
	`${await view.locator('button').count()} found`
);
check('no link is rendered inside the preview view', (await view.locator('a').count()) === 0);
check(
	'no form control is rendered inside the preview view',
	(await view.locator('input, select, textarea').count()) === 0
);

// (1) no Authorization header on anything the preview fetched.
const previewCalls = sent
	.slice(before)
	.filter((r) => r.url.startsWith(API) && r.method === 'GET' && !r.url.includes('/auth/'));
check('the preview really did call the API', previewCalls.length >= 3, `${previewCalls.length}`);
check(
	'not one preview request carried an Authorization header',
	previewCalls.every((r) => r.authorization === null),
	JSON.stringify(previewCalls.filter((r) => r.authorization !== null).map((r) => r.url))
);
check(
	'the four reads the preview re-runs are the event, its programme, its roster and its proposals',
	['/events/', '/sessions/', '/attendees/', '/contributions/'].every((part) =>
		previewCalls.some((r) => r.url.includes(part))
	),
	JSON.stringify(previewCalls.map((r) => r.url.replace(API, '')))
);
check(
	'the preview shows the event a visitor can see',
	(await view.locator('.preview-view__title').innerText()).includes('Sandbox conference')
);
check(
	'the preview says every control is gone rather than disabled',
	/gone rather than disabled/i.test(await view.locator('.preview-view__hidden').innerText())
);

await page.screenshot({ path: 'e2e/screens/event-preview-visitor.png', fullPage: false });

// ---- the layout preview -----------------------------------------------------------------------
await switcher.locator('button', { hasText: 'somebody going' }).click();
await page.waitForTimeout(900);
check(
	'the second option says it is a layout preview, not a permission check',
	/not a permission check/i.test(await view.locator('.preview-view__kind').innerText())
);
check('the bar is still there in the second mode', await bar.isVisible());
check(
	'still no action control in the layout preview',
	(await view.locator('button, a, input, select, textarea').count()) === 0
);

// ---- leaving ------------------------------------------------------------------------------------
await bar.locator('button').click();
await page.waitForTimeout(400);
check('leaving removes the bar', (await page.locator('.preview-bar').count()) === 0);
check('leaving removes the preview view', (await page.locator('.preview-view').count()) === 0);
check(
	'the organiser’s own controls are back after leaving',
	(await page.locator('.host-actions').count()) === 1
);

// ---- a draft previews as nothing ------------------------------------------------------------
expected404 = `/api/events/${draft.id}/`;
await page.goto(`${BASE}/events/${draft.id}`, { waitUntil: 'load' });
const draftSwitch = page.locator('.preview-switch');
await draftSwitch.waitFor({ timeout: 60000 });
await draftSwitch.locator('button', { hasText: 'signed-out visitor' }).click();
await page.locator('.preview-view').waitFor({ timeout: 30000 });
await page.waitForTimeout(900);
check(
	'a draft previews as nothing at all, and says why',
	/404/.test(await page.locator('.preview-view__status--none').innerText())
);
await page.screenshot({ path: 'e2e/screens/event-preview-draft.png', fullPage: false });

check('no console or page errors', errors.length === 0, errors.join(' | '));

// Clean up the scratch draft through the real API, and confirm it is gone.
await fetch(`${API}/api/events/${draft.id}/`, { method: 'DELETE', headers: auth(organiser) });
const gone = await fetch(`${API}/api/events/${draft.id}/`, { headers: auth(organiser) });
check('the scratch draft is removed', gone.status === 404);

await browser.close();
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
