// The personal work dashboard (MANAGEMENT-BRIEF.md §3.F): kasia (a real seeded staff account) signs
// in, an event she hosts within 14 days is created through the API so there is real work to show,
// and /work renders it — title, an "Events I'm hosting" section, the item's urgency dot and due
// date, and a working link through to the node. A second account whose `/api/work/` genuinely comes
// back empty (probed through the API first, never assumed) then signs in and /work shows the
// whole-page "nothing is waiting on you" state instead. Screenshots for both. Cleans up the scratch
// event through the API; a scratch account, if one had to be registered, is left in place (no
// account-delete endpoint exists — same reasoning `guardian-accounts.mjs` records).
//
// The per-SECTION empty state (`work_section_empty`) is not exercised here: `work/providers.py
// collect()` never appends a section with zero items in the first place (`if items: sections.append
// (...)`), so that branch in `+page.svelte` is unreachable through the real API — dead defensive
// code, not a gap in this script.
//   E2E_BASE=http://localhost:5226 E2E_API=http://127.0.0.1:8126 node e2e/work.mjs

let chromium;
try {
	({ chromium } = await import('playwright'));
} catch {
	({ chromium } = await import('playwright-core'));
}
import { englishContext } from './english.mjs';

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
// English on the CONTEXT, before the first navigation (e2e/CLAUDE.md trap 24: the interface
// default is Polish since 2026-09-23).
const mk = async () => {
	const context = await englishContext(browser, BASE, {
		viewport: { width: 1280, height: 1100 }
	});
	const p = await context.newPage();
	p.on('console', (m) => {
		if (m.type() === 'error') errors.push(`[${p.url()}] ${m.text()}`);
	});
	p.on('pageerror', (e) => errors.push(e.message));
	return p;
};
const settle = (p, ms = 900) => p.waitForTimeout(ms);
const tokenFor = async (email, password = 'password123') => {
	const r = await fetch(`${API}/api/auth/login/`, {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify({ username: email, password })
	});
	return (await r.json()).token;
};
const auth = (t) => ({ 'Content-Type': 'application/json', Authorization: `Token ${t}` });
// e2e/CLAUDE.md trap 13: the login form's identifier field is a plain text input now (email or
// username), not `input[type="email"]`.
const login = async (p, email) => {
	await p.goto(`${BASE}/login`, { waitUntil: 'networkidle', timeout: 90000 });
	await p.locator('form input[autocomplete="username"]').fill(email);
	await p.locator('form input[type="password"]').fill('password123');
	await p.locator('form button[type="submit"]').click();
	await p.waitForURL((u) => !u.pathname.includes('/login'), { timeout: 20000 });
};

const MARKER = 'E2E Test Work Event';

try {
	console.log('work dashboard: kasia sees her work');

	const kasiaToken = await tokenFor('kasia@edmat.example');
	check('Kasia login', !!kasiaToken);

	// Clean up any leftover scratch event from an earlier interrupted run.
	for (const e of await (
		await fetch(`${API}/api/events/?mine=hosting`, { headers: auth(kasiaToken) })
	).json()) {
		if (e.title === MARKER)
			await fetch(`${API}/api/events/${e.id}/`, { method: 'DELETE', headers: auth(kasiaToken) });
	}

	// An event Kasia hosts, starting in 7 days — inside the provider's 14-day window.
	const eventDate = new Date();
	eventDate.setDate(eventDate.getDate() + 7);
	const eventResponse = await fetch(`${API}/api/events/`, {
		method: 'POST',
		headers: auth(kasiaToken),
		body: JSON.stringify({
			title: MARKER,
			summary: 'A test event for the work dashboard',
			description: 'This event is created by the e2e test',
			status: 'published',
			visibility: 'public',
			starts_at: eventDate.toISOString(),
			duration_minutes: 60,
			location_kind: 'onsite',
			location_text: 'Test Location',
			audience: 'university'
		})
	});
	const eventData = await eventResponse.json();
	const eventId = eventData.id;
	check('Create test event', !!eventId, JSON.stringify(eventData));

	// Sanity check against the API directly, so a failure in the browser assertions below is known
	// to be a RENDERING bug, not a missing fixture.
	const apiDashboard = await (
		await fetch(`${API}/api/work/`, { headers: auth(kasiaToken) })
	).json();
	const apiSection = apiDashboard.sections?.find((s) => s.key === 'event_hosting');
	check(
		'API: event_hosting section carries the test event',
		!!apiSection?.items?.some((i) => i.title === MARKER),
		JSON.stringify(apiDashboard.sections?.map((s) => s.key))
	);

	const k = await mk();
	await login(k, 'kasia@edmat.example');
	await k.goto(`${BASE}/work`, { waitUntil: 'load', timeout: 60000 });
	await settle(k);

	const pageTitle = await k.locator('h1').first().textContent();
	check('Page title is "My work"', (pageTitle ?? '').includes('My work'), pageTitle ?? '');

	const sections = k.locator('.work-section');
	check('At least one work section visible', (await sections.count()) > 0);

	// Scope to the section by its own heading — e2e/CLAUDE.md trap 6: never assert positionally.
	const hostingSection = k.locator('.work-section', { hasText: "Events I'm hosting" });
	check('"Events I\'m hosting" section is rendered', (await hostingSection.count()) === 1);

	const testItem = hostingSection.locator('.work-item', { hasText: MARKER });
	check('The test event appears as a work item', (await testItem.count()) === 1);
	check('Its urgency dot is rendered', (await testItem.locator('.urgency-dot').count()) === 1);
	check(
		'Its due date is rendered',
		((await testItem.locator('.item-due-date').textContent()) ?? '').trim().length > 0
	);
	check(
		'Its node link points at the event',
		((await testItem.locator('.node-link').getAttribute('href')) ?? '').includes(
			`/events/${eventId}`
		)
	);

	await k.screenshot({ path: '/tmp/work-dashboard-kasia.png' });
	console.log('  Screenshot saved to /tmp/work-dashboard-kasia.png');

	// --- the whole-page "nothing is waiting on you" state -----------------------------------
	// Probed through the API first rather than assumed — seed content changes over time, so the
	// first seeded demo account whose OWN dashboard genuinely comes back empty is used, and only a
	// fresh scratch account is registered if none of them do.
	const candidates = [
		'michal@edmat.example',
		'ola@edmat.example',
		'bartek@edmat.example',
		'julia@edmat.example'
	];
	let emptyEmail = null;
	for (const email of candidates) {
		const t = await tokenFor(email);
		if (!t) continue;
		const d = await (await fetch(`${API}/api/work/`, { headers: auth(t) })).json();
		if ((d.sections ?? []).length === 0) {
			emptyEmail = email;
			break;
		}
	}
	let scratchRegistered = false;
	if (!emptyEmail) {
		const scratchEmail = `work-e2e-${Date.now()}@edmat.example`;
		const reg = await fetch(`${API}/api/auth/register/`, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({
				username: `work-e2e-${Date.now()}`,
				email: scratchEmail,
				password: 'password123',
				birth_year: new Date().getFullYear() - 25,
				display_name: 'Work E2E Scratch',
				preferred_locale: 'en'
			})
		});
		if (reg.status < 300) {
			emptyEmail = scratchEmail;
			scratchRegistered = true;
		}
	}
	check('Found an account with nothing waiting on it', !!emptyEmail, emptyEmail ?? '(none)');

	if (emptyEmail) {
		const o = await mk();
		await login(o, emptyEmail);
		await o.goto(`${BASE}/work`, { waitUntil: 'load', timeout: 60000 });
		await settle(o);

		check('No work sections are rendered', (await o.locator('.work-section').count()) === 0);
		const emptyState = await o.locator('.empty-state').textContent();
		check(
			'"Nothing is waiting on you" is shown',
			(emptyState ?? '').includes('Nothing is waiting on you'),
			emptyState ?? ''
		);

		await o.screenshot({ path: '/tmp/work-dashboard-empty.png' });
		console.log('  Screenshot saved to /tmp/work-dashboard-empty.png');
		await o.close();
	}
	if (scratchRegistered) {
		console.log(`  (left a scratch account in place: ${emptyEmail} — no account-delete endpoint)`);
	}

	// Clean up the scratch event.
	const deleteResponse = await fetch(`${API}/api/events/${eventId}/`, {
		method: 'DELETE',
		headers: auth(kasiaToken)
	});
	check('Delete test event', deleteResponse.status === 204);

	await k.close();
} catch (e) {
	fail++;
	errors.push(e.toString());
}

check('zero console/page errors', errors.length === 0, errors.join(' | ').slice(0, 600));

await browser.close();

if (errors.length) {
	console.log('\nErrors:');
	errors.forEach((e) => console.log(`  ${e}`));
}
console.log(`\nResults: ${pass} pass, ${fail} fail`);
process.exit(fail);
