// The programme (AUDIENCE-BRIEF.md §3.1, §3.2, §3.5; root CLAUDE.md §17AM): an organiser builds a
// two-day event's programme through the real page — a track, a session with a speaker and links
// pasted as addresses — a second person bookmarks it, adds its exercises to My Set, asks a
// question, sees it on /events/agenda and exports an .ics; the exercise page shows the reverse
// link; the staff panel adds a reviewer. Kasia (host) and Ola, two contexts. Cleans up via the API.
//   E2E_BASE=http://localhost:5173 E2E_API=http://localhost:8000 node e2e/event-programme.mjs
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
	const p = await (
		await browser.newContext({ viewport: { width: 1280, height: 1000 }, acceptDownloads: true })
	).newPage();
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
const MARKER = 'Programme e2e — autumn school';
// Reset leftovers.
for (const e of await (
	await fetch(`${API}/api/events/?mine=hosting`, { headers: auth(kasia) })
).json()) {
	if (e.title === MARKER)
		await fetch(`${API}/api/events/${e.id}/`, { method: 'DELETE', headers: auth(kasia) });
}
const login = async (p, email) => {
	// A signed-OUT page has no SSE stream, so networkidle is safe here — and it is what waits out
	// Vite's cold compile of freshly added components, which a fixed settle does not.
	await p.goto(`${BASE}/login`, { waitUntil: 'networkidle', timeout: 90000 });
	await settle(p, 800);
	await p.locator('form input[type="email"]').fill(email);
	await p.locator('form input[type="password"]').fill('password123');
	await p.locator('form button[type="submit"]').click();
	await p.waitForURL((u) => !u.pathname.includes('/login'), { timeout: 15000 });
};

// A two-day, public, published event through the API (the form is covered by events-and-nav.mjs).
const start = new Date(Date.now() + 7 * 86400e3);
start.setHours(9, 0, 0, 0);
const end = new Date(start.getTime() + 2 * 86400e3);
const created = await (
	await fetch(`${API}/api/events/`, {
		method: 'POST',
		headers: auth(kasia),
		body: JSON.stringify({
			title: MARKER,
			status: 'published',
			visibility: 'public',
			starts_at: start.toISOString(),
			runs_until: end.toISOString(),
			duration_minutes: 60,
			location_kind: 'onsite',
			location_text: 'Main hall',
			audience: 'secondary'
		})
	})
).json();
check(
	'API creates a multi-day event (runs_until)',
	created.id && created.runs_until && created.ends_at === created.runs_until,
	JSON.stringify(created).slice(0, 200)
);
check('the host reads as able to organise', created.can_organise === true);
const EV = created.id;

// 1. Kasia builds the programme on the page.
const k = await mk();
await login(k, 'kasia@edmat.example');
await k.goto(`${BASE}/events/${EV}`, { waitUntil: 'load' });
await k.locator('.programme').waitFor({ timeout: 60000 });
await settle(k, 800);
check('an organiser sees the staff panel', (await k.locator('.staff-panel').count()) === 1);
await k.locator('.tracks input').fill('Room A');
await k.locator('.tracks button', { hasText: 'Add' }).click();
await settle(k, 1200);
check(
	'a track is added inline',
	(await k.locator('.track-chip', { hasText: 'Room A' }).count()) === 1
);
await k.locator('.programme__actions button', { hasText: 'Add a session' }).click();
const ed = k.locator('.session-editor');
await ed.waitFor();
await ed.locator('input[maxlength="200"]').fill('Opening talk: integrals');
const pad = (n) => String(n).padStart(2, '0');
const day2 = new Date(start.getTime() + 86400e3 + 3600e3 * 2);
const local = `${day2.getFullYear()}-${pad(day2.getMonth() + 1)}-${pad(day2.getDate())}T${pad(day2.getHours())}:${pad(day2.getMinutes())}`;
await ed.locator('input[type="datetime-local"]').fill(local);
await ed.locator('select').nth(1).selectOption({ label: 'Room A' });
await ed.locator('fieldset', { hasText: 'Speakers' }).locator('input').fill('Dr Guest');
await ed.locator('fieldset', { hasText: 'Speakers' }).locator('button', { hasText: 'Add' }).click();
const linksFs = ed.locator('fieldset', { hasText: 'Materials and exercises' });
await linksFs.locator('select').selectOption('live');
await linksFs.locator('input').fill(`${BASE}/exercises/1`);
await linksFs.locator('button', { hasText: 'Add' }).click();
await linksFs.locator('select').selectOption('recording');
await linksFs.locator('input').fill('https://example.org/recording');
await linksFs.locator('button', { hasText: 'Add' }).click();
await linksFs.locator('input').fill('not a link');
await linksFs.locator('button', { hasText: 'Add' }).click();
check('an unreadable address is refused in words', (await linksFs.locator('.error').count()) === 1);
check('two links queued as chips', (await linksFs.locator('.chips li').count()) === 2);
await ed.locator('button[type="submit"]').click();
await k.locator('.session', { hasText: 'Opening talk' }).waitFor({ timeout: 15000 });
const sess = k.locator('.session', { hasText: 'Opening talk' });
check('the session renders under a day heading', (await k.locator('.day').count()) === 1);
check(
	'with its track and speaker',
	(await sess.locator('.session-track', { hasText: 'Room A' }).count()) === 1 &&
		(await sess.locator('.speakers', { hasText: 'Dr Guest' }).count()) === 1
);
const liveGroup = sess.locator('.links', { hasText: 'Worked through in the room' });
check(
	'the pasted exercise resolved to its real title',
	(await liveGroup.count()) === 1 && !(await liveGroup.innerText()).includes('/exercises/1'),
	await liveGroup.innerText().catch(() => '')
);
check(
	'the recording link is grouped by its role',
	(await sess.locator('.links', { hasText: 'Recording' }).count()) === 1
);
await k.locator('.view-switch button', { hasText: 'Week' }).click();
await settle(k, 800);
const weekText = await k
	.locator('.week')
	.innerText()
	.catch(() => '(no .week)');
check(
	'the week view draws the session on the grid',
	(await k.locator('.week .week__entry-label', { hasText: 'Opening talk' }).count()) >= 1,
	weekText.slice(0, 300).replace(/\n+/g, ' | ')
);
await k.locator('.view-switch button', { hasText: 'List' }).click();
// Staff: add Ola as reviewer.
const olaMe = await (await fetch(`${API}/api/auth/me/`, { headers: auth(ola) })).json();
await k.locator('.staff-panel .add input').fill(String(olaMe.id));
await k.locator('.staff-panel .add select').selectOption('reviewer');
await k.locator('.staff-panel .add button[type="submit"]').click();
await settle(k, 1500);
check(
	'a reviewer is added through the panel',
	(await k.locator('.staff-list li', { hasText: 'Ola' }).count()) === 1
);
const staffApi = await (
	await fetch(`${API}/api/events/${EV}/staff/`, { headers: auth(kasia) })
).json();
check(
	'…and the API agrees',
	staffApi.some((r) => r.role === 'reviewer' && r.user.id === olaMe.id)
);

// 2. Ola: bookmark, My Set, Q&A, agenda, ics.
const o = await mk();
await login(o, 'ola@edmat.example');
await o.goto(`${BASE}/events/${EV}`, { waitUntil: 'load' });
const osess = o.locator('.session', { hasText: 'Opening talk' });
try {
	await osess.waitFor({ timeout: 60000 });
} catch (e) {
	console.log(
		'OLA PAGE:',
		o.url(),
		(
			await o
				.locator('main')
				.innerText()
				.catch(() => '')
		)
			.slice(0, 400)
			.replace(/\n+/g, ' | ')
	);
	console.log('ERRORS SO FAR:', errors);
	throw e;
}
check(
	'a non-organiser gets no staff panel and no editor button',
	(await o.locator('.staff-panel').count()) === 0 &&
		(await o.locator('button', { hasText: 'Add a session' }).count()) === 0
);
await osess.locator('button', { hasText: 'Add to my agenda' }).click();
await settle(o, 1200);
check(
	'bookmarking flips the button',
	(await osess.locator('button', { hasText: 'On my agenda' }).count()) === 1
);
await osess.locator('button', { hasText: 'exercises to My Set' }).click();
await settle(o, 400);
check(
	"the session's exercises land in My Set",
	(await osess.locator('button', { hasText: 'Added 1 to My Set' }).count()) === 1
);
await osess.locator('button', { hasText: 'Questions' }).click();
const qa = osess.locator('.qa');
await qa.waitFor();
await qa.locator('textarea').first().fill('Will the recording be shared afterwards?');
await qa.locator('button[type="submit"]').first().click();
await settle(o, 1500);
check(
	'a question posts into the session thread',
	(await qa.getByText('Will the recording be shared').count()) === 1
);
await o.goto(`${BASE}/events/agenda`, { waitUntil: 'load' });
await o.locator('.agenda .rows').first().waitFor({ timeout: 30000 });
check(
	'/events/agenda lists the bookmarked session',
	(await o.locator('.agenda .rows li', { hasText: 'Opening talk' }).count()) === 1
);
const dl = o.waitForEvent('download', { timeout: 15000 });
await o.locator('.agenda__head button').click();
const file = await dl;
const ics = await (await import('node:fs/promises')).readFile(await file.path(), 'utf8');
check(
	'the .ics download carries the session',
	file.suggestedFilename().endsWith('.ics') &&
		ics.includes('BEGIN:VEVENT') &&
		ics.includes('Opening talk'),
	ics.slice(0, 120)
);
await o.goto(`${BASE}/exercises/1`, { waitUntil: 'load' });
await o.locator('.appears-in').waitFor({ timeout: 30000 });
check(
	'the exercise page lists the session it is worked through in',
	(await o.locator('.appears-in li', { hasText: 'Opening talk' }).count()) === 1
);

// 3. Moving the session tells Ola.
const before = (
	await (await fetch(`${API}/api/notifications/`, { headers: auth(ola) })).json()
).filter((n) => n.type === 'session_changed').length;
const sid = (await (await fetch(`${API}/api/events/${EV}/sessions/`)).json())[0].id;
await fetch(`${API}/api/events/${EV}/sessions/${sid}/`, {
	method: 'PATCH',
	headers: auth(kasia),
	body: JSON.stringify({ location_text: 'Room 5' })
});
const after = (
	await (await fetch(`${API}/api/notifications/`, { headers: auth(ola) })).json()
).filter((n) => n.type === 'session_changed').length;
check(
	'moving a bookmarked session notifies the bookmarker',
	after === before + 1,
	`${before} → ${after}`
);

// Cleanup
const del = await fetch(`${API}/api/events/${EV}/`, { method: 'DELETE', headers: auth(kasia) });
check('scratch event removed', del.status === 204, String(del.status));
check('zero console/page errors', errors.length === 0, errors.join(' | ').slice(0, 500));
await k.screenshot({ path: 'e2e/screenshots/event-programme.png' });
await browser.close();
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
