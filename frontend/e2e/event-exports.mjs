// Exports and data minimisation on a real event (CONFERENCE-BRIEF.md §3.G; HISTORY.md §17BF.G).
//
// Two questions the browser answers and the Django suite cannot: does an organiser actually SEE
// the needs table and the export log on the page, and does a volunteer see the door-list button
// with no needs table, no export log and no full-CSV button next to it. Plus the API half of the
// minimisation, probed directly, because "the panel does not render it" is a weaker claim than
// "the response does not contain it".
//
// Kasia hosts; Ola registers with answers; Michał is the volunteer. Cleans up through the API.
//   E2E_BASE=http://localhost:5207 E2E_API=http://127.0.0.1:8107 node e2e/event-exports.mjs
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
const ctx = await englishContext(browser, BASE, {
	viewport: { width: 1280, height: 1100 },
	acceptDownloads: true
});
const mk = async () => {
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
const michal = await tokenFor('michal@edmat.example');
const auth = (t) => ({ 'Content-Type': 'application/json', Authorization: `Token ${t}` });
const me = async (t) =>
	(await (await fetch(`${API}/api/auth/me/`, { headers: auth(t) })).json()).id;
const michalId = await me(michal);

const MARKER = 'Exports e2e — conference day';
const removeEvent = async (id) => {
	await fetch(`${API}/api/events/${id}/attend/`, {
		method: 'POST',
		headers: auth(ola),
		body: JSON.stringify({ status: 'not_going' })
	});
	const r = await fetch(`${API}/api/events/${id}/`, { method: 'DELETE', headers: auth(kasia) });
	if (r.status !== 204)
		await fetch(`${API}/api/events/${id}/cancel/`, { method: 'POST', headers: auth(kasia) });
};
for (const e of await (
	await fetch(`${API}/api/events/?mine=hosting`, { headers: auth(kasia) })
).json()) {
	if (e.title.startsWith(MARKER) && e.status !== 'cancelled') await removeEvent(e.id);
}

const start = new Date(Date.now() + 5 * 86400e3);
start.setHours(9, 0, 0, 0);
const event = await (
	await fetch(`${API}/api/events/`, {
		method: 'POST',
		headers: auth(kasia),
		body: JSON.stringify({
			title: MARKER,
			status: 'published',
			visibility: 'public',
			starts_at: start.toISOString(),
			duration_minutes: 180,
			location_kind: 'hybrid',
			location_text: 'Hall B',
			online_url: 'https://example.org/hall-b',
			audience: 'university',
			registration_mode: 'form'
		})
	})
).json();
check('API creates the scratch event', Boolean(event.id), JSON.stringify(event).slice(0, 160));

// One organiser-defined choice question, so the needs summary has something to count per option.
const fields = await (
	await fetch(`${API}/api/events/${event.id}/registration-fields/`, {
		method: 'PUT',
		headers: auth(kasia),
		body: JSON.stringify([
			{ label: 'Lunch', kind: 'choice', required: false, options: ['Vegan', 'Meat'] },
			{ label: 'Affiliation', kind: 'text', required: false, options: [] }
		])
	})
).json();
check('two questions saved', fields.length === 2, JSON.stringify(fields).slice(0, 160));

// Michał becomes a volunteer; Ola registers with a full set of answers including an access note.
const staffed = await fetch(`${API}/api/events/${event.id}/staff/`, {
	method: 'POST',
	headers: auth(kasia),
	body: JSON.stringify({ user: michalId, role: 'volunteer' })
});
check('Michał is a volunteer on the event', staffed.status === 201, String(staffed.status));
const registered = await fetch(`${API}/api/events/${event.id}/attend/`, {
	method: 'POST',
	headers: auth(ola),
	body: JSON.stringify({
		status: 'going',
		answers: {
			_attendance_mode: 'online',
			_needs: 'Step-free access to the hall',
			_consent: true,
			[fields[0].id]: 'Vegan',
			[fields[1].id]: 'Wydział Fizyki'
		}
	})
});
check('Ola registers with answers', registered.status === 200, String(registered.status));

// ---- A. the API half of the minimisation --------------------------------------------------
const volunteerRows = await (
	await fetch(`${API}/api/events/${event.id}/registrations/`, { headers: auth(michal) })
).json();
check(
	"a volunteer's registration row carries only name, status and check-in",
	volunteerRows.length === 1 &&
		JSON.stringify(Object.keys(volunteerRows[0]).sort()) ===
			JSON.stringify(['attendee', 'checked_in', 'checked_in_at', 'id', 'status']),
	JSON.stringify(volunteerRows[0])
);
check(
	'none of the withheld words appear anywhere in that response',
	!JSON.stringify(volunteerRows).includes('Step-free') &&
		!JSON.stringify(volunteerRows).includes('Wydział Fizyki') &&
		volunteerRows[0].attendee.id === null,
	JSON.stringify(volunteerRows)
);
const organiserRows = await (
	await fetch(`${API}/api/events/${event.id}/registrations/`, { headers: auth(kasia) })
).json();
check(
	'the organiser still gets the answers',
	organiserRows[0].answers._needs === 'Step-free access to the hall',
	JSON.stringify(organiserRows[0].answers)
);
const volunteerNeeds = await fetch(`${API}/api/events/${event.id}/exports/needs/`, {
	headers: auth(michal)
});
check(
	'a volunteer is refused the needs summary',
	volunteerNeeds.status === 403,
	String(volunteerNeeds.status)
);
const volunteerFull = await fetch(`${API}/api/events/${event.id}/registrations/export/`, {
	headers: auth(michal)
});
check(
	'a volunteer is refused the full CSV',
	volunteerFull.status === 403,
	String(volunteerFull.status)
);
const volunteerDoor = await fetch(`${API}/api/events/${event.id}/exports/door-list.csv`, {
	headers: auth(michal)
});
const doorText = await volunteerDoor.text();
check(
	'a volunteer may take the door list, and it has three columns',
	volunteerDoor.status === 200 && doorText.split('\n')[0].trim() === 'name,status,checked_in',
	`${volunteerDoor.status} ${doorText.slice(0, 80)}`
);

// ---- B. the organiser's page ------------------------------------------------------------
const login = async (p, email) => {
	// Trap 25: every control on /login is in the server-rendered HTML, so waiting for the input
	// proves nothing — the click does nothing until the bundle has hydrated. Wait for the root
	// layout's own boot request, registered BEFORE the navigation.
	const booted = p.waitForResponse((r) => r.url().includes('/feature-flags/'), { timeout: 120000 });
	await p.goto(`${BASE}/login`, { waitUntil: 'load', timeout: 120000 });
	await booted;
	await p.locator('form input[autocomplete="username"]').waitFor({ timeout: 60000 });
	await settle(p, 1500);
	await p.locator('form input[autocomplete="username"]').fill(email);
	await p.locator('form input[type="password"]').fill('password123');
	await p.locator('form button[type="submit"]').click();
	await p.waitForURL((u) => !u.pathname.includes('/login'), { timeout: 60000 });
};
{
	// Warm Vite's cold compile once — the first load of this route can take a minute (trap 11).
	const warm = await ctx.newPage();
	await warm.goto(`${BASE}/events/${event.id}`, { waitUntil: 'load', timeout: 240000 });
	await settle(warm, 2000);
	await warm.close();
}
const k = await mk();
await login(k, 'kasia@edmat.example');
await k.goto(`${BASE}/events/${event.id}`, { waitUntil: 'load', timeout: 120000 });
const card = k.locator('.registrations .exports');
await card.waitFor({ timeout: 90000 });
check('the Exports card is on the organiser panel', true);
const needsTable = card.locator('table.needs');
await needsTable.waitFor({ timeout: 30000 });
const needsText = await needsTable.innerText();
check(
	'the needs table counts the one online attendee and their access need',
	/Joining online\s*1/i.test(needsText) && /Stated an accessibility need\s*1/i.test(needsText),
	needsText.replace(/\n/g, ' | ')
);
check(
	'the chosen lunch option is counted per option',
	/Lunch: Vegan\s*1/i.test(needsText) && /Lunch: Meat\s*0/i.test(needsText),
	needsText.replace(/\n/g, ' | ')
);
check(
	'the free-text question is a count, and its text is nowhere on the card',
	/Affiliation\s*1 of 1 answered/i.test(needsText) &&
		!(await card.innerText()).includes('Wydział Fizyki'),
	needsText.replace(/\n/g, ' | ')
);
check(
	'the organiser still has the full CSV button',
	(await k.locator('.registrations .head button').count()) === 1
);
// Not empty: section A above already took the door list as Michał through the API, and that is
// the point of the log — a download from anywhere lands in it, not only one made on this page.
check(
	"the export log already shows the volunteer's API download",
	(await card.locator('.log li').count()) === 1 &&
		(await card.locator('.log li').first().innerText()).includes('Micha'),
	await card.locator('.log').innerText()
);
// Download the door list from the page and watch the log grow.
const dl = k.waitForEvent('download', { timeout: 30000 });
await card.locator('button').first().click();
const file = await dl;
check(
	'the door list downloads as a .csv',
	file.suggestedFilename().endsWith('.csv'),
	file.suggestedFilename()
);
await settle(k, 1500);
check(
	'the export log now names Kasia too, newest first',
	(await card.locator('.log li').count()) === 2 &&
		(await card.locator('.log li').first().innerText()).includes('Kasia') &&
		(await card.locator('.log li').first().innerText()).includes('Door list'),
	await card.locator('.log').innerText()
);
await k.screenshot({ path: 'e2e/screens/event-exports-organiser.png', fullPage: false });

// ---- C. the volunteer's page ------------------------------------------------------------
const mi = await mk();
await login(mi, 'michal@edmat.example');
await mi.goto(`${BASE}/events/${event.id}`, { waitUntil: 'load', timeout: 120000 });
const vCard = mi.locator('.registrations .exports');
await vCard.waitFor({ timeout: 90000 });
check(
	'a volunteer sees the door-list button and no needs table',
	(await vCard.locator('table.needs').count()) === 0 &&
		(await vCard.locator('button').count()) === 1
);
check('a volunteer sees no export log', (await vCard.locator('.log').count()) === 0);
check(
	'a volunteer has no full-CSV button on the panel header',
	(await mi.locator('.registrations .head button').count()) === 0
);
const vRow = mi.locator('.registrations .rows li').first();
await vRow.waitFor({ timeout: 30000 });
const vRowText = await vRow.innerText();
check(
	"the volunteer's row shows a name and a status and no answers",
	(await vRow.locator('dl.answers').count()) === 0 &&
		(await vRow.locator('a[href*="/users/"]').count()) === 0 &&
		vRowText.length > 0,
	vRowText.replace(/\n/g, ' | ')
);
await mi.screenshot({ path: 'e2e/screens/event-exports-volunteer.png', fullPage: false });

// ---- cleanup --------------------------------------------------------------------------------
await removeEvent(event.id);
const gone = await (
	await fetch(`${API}/api/events/?mine=hosting`, { headers: auth(kasia) })
).json();
check(
	'the scratch event is gone (checked with an authenticated request, trap 12)',
	!gone.some((e) => e.title.startsWith(MARKER) && e.status !== 'cancelled')
);

check('no console or page errors', errors.length === 0, errors.join(' ยง '));
await browser.close();
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
