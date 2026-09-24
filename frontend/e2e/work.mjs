// The personal work dashboard (MANAGEMENT-BRIEF.md §3.F): kasia (a course staff member and event
// host) signs in, opens /work, sees at least one real section from the seeded data, and the page
// renders cleanly. An event is created through the API in this script to ensure there is work to
// show. Screenshot taken. Cleans up through the API.
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
// English on the CONTEXT, before the first navigation
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
const tokenFor = async (email) => {
	const r = await fetch(`${API}/api/auth/login/`, {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify({ username: email, password: 'password123' })
	});
	return (await r.json()).token;
};

try {
	console.log('work dashboard: kasia sees her work');
	const p = await mk();

	// Get Kasia's token
	const kasiaToken = await tokenFor('kasia@edmat.example');
	check('Kasia login', kasiaToken && typeof kasiaToken === 'string');

	// Create an event that Kasia hosts, starting in 7 days
	const eventDate = new Date();
	eventDate.setDate(eventDate.getDate() + 7);
	const eventResponse = await fetch(`${API}/api/events/`, {
		method: 'POST',
		headers: {
			'Content-Type': 'application/json',
			Authorization: `Token ${kasiaToken}`
		},
		body: JSON.stringify({
			title: 'E2E Test Work Event',
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
	check('Create test event', eventId, JSON.stringify(eventData));

	// Navigate to /work
	await p.goto(`${BASE}/work`, { waitUntil: 'load' });
	await settle(p);

	// Check that the page loaded and has the title
	const pageTitle = await p.locator('h1').first().textContent();
	check('Page title is "My work"', pageTitle?.includes('My work') || pageTitle?.includes('Moja praca'));

	// Check that at least one section exists
	const sections = await p.locator('[class*="work-section"]').count();
	check('At least one work section visible', sections > 0, `Found ${sections} sections`);

	// Check that there are work items
	const items = await p.locator('[class*="work-item"]').count();
	check('At least one work item visible', items > 0, `Found ${items} items`);

	// Take a screenshot
	const screenshotPath = '/tmp/work-dashboard.png';
	await p.screenshot({ path: screenshotPath });
	console.log(`  Screenshot saved to ${screenshotPath}`);

	// Clean up: delete the test event
	const deleteResponse = await fetch(`${API}/api/events/${eventId}/`, {
		method: 'DELETE',
		headers: {
			Authorization: `Token ${kasiaToken}`
		}
	});
	check('Delete test event', deleteResponse.status === 204);

	await p.close();
} catch (e) {
	fail++;
	errors.push(e.toString());
}

await browser.close();

if (errors.length) {
	console.log('\nErrors:');
	errors.forEach((e) => console.log(`  ${e}`));
}
console.log(`\nResults: ${pass} pass, ${fail} fail`);
process.exit(fail);
