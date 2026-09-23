// The volunteer rota (CONFERENCE-BRIEF.md §3.E): an organiser builds a station and two shifts
// through the real panel on the event page, a volunteer takes one and is refused the overlapping
// one with the reason in words, the coverage grid draws the day, the wall rota and the certificate
// print, /volunteering lists the event, and the `shifts` kill switch takes the whole panel away
// from a non-staff account while the event page keeps working. Kasia (host, real staff account)
// and Ola (volunteer), two contexts. Cleans up through the API.
//   E2E_BASE=http://localhost:5205 E2E_API=http://127.0.0.1:8105 node e2e/event-shifts.mjs
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
// English on the CONTEXT, before the first navigation: the interface default is Polish since
// 2026-09-23 and every assertion below names an English string (e2e/CLAUDE.md trap 24).
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
const kasia = await tokenFor('kasia@edmat.example');
const ola = await tokenFor('ola@edmat.example');
const auth = (t) => ({ 'Content-Type': 'application/json', Authorization: `Token ${t}` });
const me = async (t) => await (await fetch(`${API}/api/auth/me/`, { headers: auth(t) })).json();
const olaId = (await me(ola)).id;

const MARKER = 'Rota e2e — volunteer day';
const setFlag = (on) =>
	fetch(`${API}/api/feature-flags/shifts/`, {
		method: 'PATCH',
		headers: auth(kasia),
		body: JSON.stringify({ is_enabled: on })
	});

// Reset leftovers from an earlier run.
for (const e of await (
	await fetch(`${API}/api/events/?mine=hosting`, { headers: auth(kasia) })
).json()) {
	if (e.title === MARKER)
		await fetch(`${API}/api/events/${e.id}/`, { method: 'DELETE', headers: auth(kasia) });
}
await setFlag(true);

// A two-day event next week, with Ola on staff as a volunteer.
const start = new Date(Date.now() + 7 * 86400e3);
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
			runs_until: new Date(start.getTime() + 86400e3).toISOString(),
			duration_minutes: 60,
			location_kind: 'onsite',
			location_text: 'Main hall',
			audience: 'university'
		})
	})
).json();
const EV = event.id;
check('API creates the event', Boolean(EV), JSON.stringify(event).slice(0, 200));
const staffed = await fetch(`${API}/api/events/${EV}/staff/`, {
	method: 'POST',
	headers: auth(kasia),
	body: JSON.stringify({ user: Number(olaId), role: 'volunteer' })
});
check('Ola joins the staff as a volunteer', staffed.status === 201, String(staffed.status));

const login = async (p, email) => {
	await p.goto(`${BASE}/login`, { waitUntil: 'networkidle', timeout: 90000 });
	await settle(p, 800);
	await p.locator('form input[autocomplete="username"]').fill(email);
	await p.locator('form input[type="password"]').fill('password123');
	await p.locator('form button[type="submit"]').click();
	await p.waitForURL((u) => !u.pathname.includes('/login'), { timeout: 20000 });
};

// ---------------------------------------------------------------------------------------------
// 1. The organiser builds the rota through the real panel.
const k = await mk();
await login(k, 'kasia@edmat.example');
await k.goto(`${BASE}/events/${EV}`, { waitUntil: 'load', timeout: 60000 });
const rota = k.locator('section.rota');
await rota.waitFor({ timeout: 30000 });
check('the rota panel is on the event page for the organiser', await rota.isVisible());

const stationForm = k.locator('form.add-station');
await stationForm.locator('input[placeholder="Station name"]').fill('Main door');
await stationForm.locator('select').first().selectOption('door');
await stationForm.locator('input[placeholder="Where it is"]').fill('Foyer');
await stationForm.locator('button[type="submit"]').click();
await settle(k, 1200);
check(
	'the station appears after the form submit',
	(await k.locator('section.stations article.station h4', { hasText: 'Main door' }).count()) === 1
);

const iso = (d) => {
	// The datetime-local control wants "YYYY-MM-DDTHH:mm" in LOCAL time, not an ISO instant.
	const pad = (n) => String(n).padStart(2, '0');
	return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
};
const shiftStart = new Date(start.getTime());
shiftStart.setHours(10, 0, 0, 0);
const shiftEnd = new Date(shiftStart.getTime() + 2 * 3600e3);
const shiftForm = k.locator('section.stations form.add-shift').first();
await shiftForm.locator('input[type="datetime-local"]').first().fill(iso(shiftStart));
await shiftForm.locator('input[type="datetime-local"]').nth(1).fill(iso(shiftEnd));
await shiftForm.locator('button[type="submit"]').click();
await settle(k, 1200);
check(
	'the shift lands on the station',
	(await k.locator('section.stations .shifts > li').count()) === 1
);
const cells = k.locator('.coverage .grid .cell');
await cells.first().waitFor({ timeout: 15000 });
check('the coverage grid draws a cell for it', (await cells.count()) === 1);
check(
	'the empty shift is drawn red and prints its own count',
	(await cells.first().getAttribute('class')).includes('red') &&
		(await cells.first().innerText()).includes('0/1')
);
await k.screenshot({ path: 'e2e/screens/event-shifts-organiser.png', fullPage: true });

// A second, overlapping shift — the one Ola must be refused.
const stations = await (
	await fetch(`${API}/api/events/${EV}/stations/`, { headers: auth(kasia) })
).json();
const stationId = stations[0].id;
const clash = await fetch(`${API}/api/stations/${stationId}/shifts/`, {
	method: 'POST',
	headers: auth(kasia),
	body: JSON.stringify({
		starts_at: new Date(shiftStart.getTime() + 3600e3).toISOString(),
		ends_at: new Date(shiftEnd.getTime() + 3600e3).toISOString(),
		needed: 1
	})
});
check('API adds an overlapping second shift', clash.status === 201, String(clash.status));

// ---------------------------------------------------------------------------------------------
// 2. The volunteer takes one and is told why she cannot have the other.
const o = await mk();
await login(o, 'ola@edmat.example');
await o.goto(`${BASE}/events/${EV}`, { waitUntil: 'load', timeout: 60000 });
await o.locator('section.rota').waitFor({ timeout: 30000 });
check(
	'the volunteer sees two open shifts and no station editor',
	(await o.locator('.open .open-list > li').count()) === 2 &&
		(await o.locator('section.stations').count()) === 0
);
await o.locator('.open .open-list > li').first().locator('button').click();
await settle(o, 1400);
check(
	'claiming moves the shift into My shifts',
	(await o.locator('.mine .my-list > li').count()) === 1
);
const remaining = o.locator('.open .open-list > li').first();
check(
	'the overlapping shift is refused, with the reason in words',
	(await remaining.locator('button').isDisabled()) &&
		(await remaining.locator('.why').innerText()).includes('already somewhere else')
);
check(
	'the hours are shown and the shift is confirmed straight away',
	(await o.locator('.mine .totals').innerText()).includes('0.00') &&
		(await o.locator('.mine .my-list > li .pill').innerText()).includes('Confirmed')
);
await o.screenshot({ path: 'e2e/screens/event-shifts-volunteer.png', fullPage: true });

// The wall rota and the certificate, both print views.
await o.goto(`${BASE}/events/${EV}/rota`, { waitUntil: 'load', timeout: 60000 });
await o.locator('.day table').first().waitFor({ timeout: 20000 });
check('the wall rota lists the shift', (await o.locator('.day tbody tr').count()) === 2);
check(
	'the wall rota names the volunteer on her shift',
	(await o.locator('.day tbody').innerText()).includes('Ola')
);
await o.screenshot({ path: 'e2e/screens/event-shifts-wall.png', fullPage: true });

await o.goto(`${BASE}/events/${EV}/certificate`, { waitUntil: 'load', timeout: 60000 });
await o.locator('article.sheet').waitFor({ timeout: 20000 });
const sheet = await o.locator('article.sheet').innerText();
check(
	'the certificate is bilingual on one sheet',
	sheet.includes('Zaświadczenie o wykonaniu świadczeń wolontariackich') &&
		sheet.includes('Certificate of volunteer service')
);
check('the certificate says it is unsigned', sheet.includes('unsigned'));
await o.screenshot({ path: 'e2e/screens/event-shifts-certificate.png', fullPage: true });

await o.goto(`${BASE}/volunteering`, { waitUntil: 'load', timeout: 60000 });
await o.locator('.page li').first().waitFor({ timeout: 20000 });
check(
	'/volunteering lists the event',
	(await o.locator('.page li', { hasText: MARKER }).count()) === 1
);

// ---------------------------------------------------------------------------------------------
// 3. Hours: the organiser marks the shift done, with an override that needs a note.
const mineShifts = await (
	await fetch(`${API}/api/events/${EV}/my-shifts/`, { headers: auth(ola) })
).json();
const assignmentId = mineShifts.shifts[0].assignment;
const shiftId = mineShifts.shifts[0].shift;
const refused = await fetch(`${API}/api/shifts/${shiftId}/done/`, {
	method: 'POST',
	headers: auth(kasia),
	body: JSON.stringify({ assignment: Number(assignmentId), hours: '0.25' })
});
check('a big hours override with no note is refused', refused.status === 400, String(refused.status));
const done = await fetch(`${API}/api/shifts/${shiftId}/done/`, {
	method: 'POST',
	headers: auth(kasia),
	body: JSON.stringify({ assignment: Number(assignmentId), hours: '0.25', note: 'Left early.' })
});
check('the same override with a note is accepted', done.status === 200, String(done.status));
const after = await (
	await fetch(`${API}/api/events/${EV}/my-shifts/`, { headers: auth(ola) })
).json();
check('the credited hours follow the override', after.hours === '0.25', after.hours);

const ics = await fetch(`${API}/api/events/${EV}/my-shifts.ics`, { headers: auth(ola) });
const icsBody = await ics.text();
check(
	'my-shifts.ics is a real calendar with one event',
	icsBody.includes('BEGIN:VCALENDAR') && icsBody.split('BEGIN:VEVENT').length === 2,
	icsBody.slice(0, 80)
);

// ---------------------------------------------------------------------------------------------
// 4. The kill switch — checked as Ola, who is NOT global staff (e2e/CLAUDE.md trap 10).
await setFlag(false);
await o.goto(`${BASE}/events/${EV}`, { waitUntil: 'load', timeout: 60000 });
await settle(o, 2000);
check('with the flag off the rota panel is gone', (await o.locator('section.rota').count()) === 0);
check(
	'…and the event page itself still works',
	(await o.locator('h1').innerText()).includes('Rota e2e')
);
const gated = await fetch(`${API}/api/events/${EV}/stations/`, { headers: auth(ola) });
check('…and the API refuses the rota for her too', gated.status === 403, String(gated.status));
const neighbour = await fetch(`${API}/api/events/${EV}/`, { headers: auth(ola) });
check('…while the neighbouring event endpoint answers', neighbour.status === 200);
await setFlag(true);

// Cleanup: deleting the event cascades the stations, shifts and assignments.
const del = await fetch(`${API}/api/events/${EV}/`, { method: 'DELETE', headers: auth(kasia) });
check('scratch event removed', del.status === 204, String(del.status));
const gone = await fetch(`${API}/api/events/${EV}/stations/`, { headers: auth(kasia) });
check('its rota went with it', gone.status === 404, String(gone.status));

check('zero console/page errors', errors.length === 0, errors.join(' | ').slice(0, 600));
await browser.close();
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
