// Registration (AUDIENCE-BRIEF.md §3.3; root CLAUDE.md §17AN): the three modes on the real page —
// a form event with the organiser's own questions and the baseline ones, a full event's waiting
// list and 24-hour seat offer, approval, check-in, the CSV, the masked public list, and a capped
// session's seats. Kasia hosts; Ola and Michał register. Cleans up via the API.
//   E2E_BASE=http://localhost:5173 E2E_API=http://localhost:8000 node e2e/event-registration.mjs
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
const michal = await tokenFor('michal@edmat.example');
const auth = (t) => ({ 'Content-Type': 'application/json', Authorization: `Token ${t}` });
const MARKER = 'Registration e2e — lab day';
// Deleting an event with people going is refused (§17V); withdraw the scratch attendees first,
// and cancel whatever still cannot be deleted so it leaves every listing.
const removeEvent = async (id) => {
	for (const t of [ola, michal]) {
		await fetch(`${API}/api/events/${id}/attend/`, {
			method: 'POST',
			headers: auth(t),
			body: JSON.stringify({ status: 'not_going' })
		});
	}
	const r = await fetch(`${API}/api/events/${id}/`, { method: 'DELETE', headers: auth(kasia) });
	if (r.status !== 204)
		await fetch(`${API}/api/events/${id}/cancel/`, { method: 'POST', headers: auth(kasia) });
	return r.status;
};
for (const e of await (
	await fetch(`${API}/api/events/?mine=hosting`, { headers: auth(kasia) })
).json()) {
	if (e.title.startsWith(MARKER) && e.status !== 'cancelled') await removeEvent(e.id);
}
const login = async (p, email) => {
	await p.goto(`${BASE}/login`, { waitUntil: 'networkidle', timeout: 90000 });
	await settle(p, 800);
	await p.locator('form input[type="email"]').fill(email);
	await p.locator('form input[type="password"]').fill('password123');
	await p.locator('form button[type="submit"]').click();
	await p.waitForURL((u) => !u.pathname.includes('/login'), { timeout: 15000 });
};
const start = new Date(Date.now() + 6 * 86400e3);
start.setHours(10, 0, 0, 0);
const mkEvent = async (extra) =>
	(
		await fetch(`${API}/api/events/`, {
			method: 'POST',
			headers: auth(kasia),
			body: JSON.stringify({
				title: MARKER,
				status: 'published',
				visibility: 'public',
				starts_at: start.toISOString(),
				duration_minutes: 120,
				location_kind: 'hybrid',
				location_text: 'Lab 2',
				online_url: 'https://example.org/lab',
				audience: 'secondary',
				...extra
			})
		})
	).json();

// ---- A. A form event with a capacity of 1: the form, the waiting list, the seat offer.
const form = await mkEvent({
	registration_mode: 'form',
	capacity: 1,
	show_attendees_publicly: true
});
check(
	'API creates a form-mode event',
	form.registration_mode === 'form' && form.show_attendees_publicly === true,
	JSON.stringify(form).slice(0, 160)
);

// Warm Vite's cold compile once (the first page of a fresh dev server can take over a minute for
// a route with this many new components); every later context then loads in seconds.
{
	const warm = await mk();
	await warm.goto(`${BASE}/events/${form.id}`, { waitUntil: 'networkidle', timeout: 180000 });
	await warm.close();
}
// Kasia adds a question through the page.
const k = await mk();
await login(k, 'kasia@edmat.example');
await k.goto(`${BASE}/events/${form.id}`, { waitUntil: 'load' });
const fe = k.locator('.fields-editor');
await fe.waitFor({ timeout: 60000 });
await fe.locator('button', { hasText: 'Add a question' }).click();
await fe.locator('.row').last().locator('input[type="text"]').first().fill('Affiliation');
await fe.locator('.row').last().locator('.req input').check();
await fe.locator('button', { hasText: 'Add a question' }).click();
await fe.locator('.row').last().locator('input[type="text"]').first().fill('Track');
await fe.locator('.row').last().locator('select').selectOption('choice');
await fe.locator('.row').last().locator('input[type="text"]').nth(1).fill('Beginners, Advanced');
await fe.locator('button[type="submit"]').click();
await settle(k, 1500);
const fieldsApi = await (await fetch(`${API}/api/events/${form.id}/registration-fields/`)).json();
check(
	"the organiser's questions are saved (one required, one choice with two options)",
	fieldsApi.length === 2 && fieldsApi[0].required === true && fieldsApi[1].options.length === 2,
	JSON.stringify(fieldsApi)
);

// Ola registers through the form.
const o = await mk();
await login(o, 'ola@edmat.example');
await o.goto(`${BASE}/events/${form.id}`, { waitUntil: 'load' });
const registerBtn = o.locator('.answers button.primary');
await registerBtn.waitFor({ timeout: 60000 });
check(
	'a form event offers "Register", not "I am going"',
	(await registerBtn.innerText()).trim() === 'Register'
);
await registerBtn.click();
const rf = o.locator('.registration-form');
await rf.waitFor();
check(
	'the form shows the attendance-mode question for a hybrid event',
	(await rf.locator('input[name="attendance-mode"]').count()) === 2
);
await rf.locator('button[type="submit"]').click();
await settle(o, 400);
check(
	'a required question left empty is flagged before sending',
	(await rf.locator('.field--missing').count()) === 1
);
await rf.locator('.field input[type="text"]').first().fill('LO nr 5');
await rf.locator('.field select').selectOption('Advanced');
await rf.locator('input[name="attendance-mode"][value="online"]').check();
await rf.locator('.consent input').check();
await rf.locator('button[type="submit"]').click();
await o.locator('.respond .mine', { hasText: 'You are going' }).waitFor({ timeout: 15000 });
check('Ola is going after submitting the form', true);
const regs = await (
	await fetch(`${API}/api/events/${form.id}/registrations/`, { headers: auth(kasia) })
).json();
const olaRow = regs.find((r) => r.status === 'going');
check(
	'her answers arrived, baseline ones included',
	olaRow &&
		olaRow.answers._attendance_mode === 'online' &&
		Object.values(olaRow.answers).includes('Advanced') &&
		olaRow.answers._consent === true,
	JSON.stringify(olaRow?.answers)
);

// Michał finds it full → waiting list, position 1.
const mi = await mk();
await login(mi, 'michal@edmat.example');
await mi.goto(`${BASE}/events/${form.id}`, { waitUntil: 'load' });
const joinBtn = mi.locator('.answers button.primary');
try {
	await joinBtn.waitFor({ timeout: 60000 });
} catch (e) {
	console.log(
		'MICHAL PAGE:',
		mi.url(),
		(
			await mi
				.locator('main')
				.innerText()
				.catch(() => '')
		)
			.slice(0, 700)
			.replace(/\n+/g, ' | ')
	);
	console.log('ERRORS:', errors.slice(0, 6));
	throw e;
}
check(
	'a full event offers the waiting list',
	(await joinBtn.innerText()).trim() === 'Join the waiting list',
	await joinBtn.innerText()
);
await joinBtn.click();
await mi.locator('.registration-form').waitFor();
await mi.locator('.registration-form .field input[type="text"]').first().fill('PW');
await mi.locator('.registration-form .consent input').check();
await mi.locator('.registration-form button[type="submit"]').click();
await mi
	.locator('.respond .mine', { hasText: 'waiting list, position 1' })
	.waitFor({ timeout: 15000 });
check('Michał is on the waiting list at position 1', true);
// The masked public list, signed out.
const anon = await mk();
await anon.goto(`${BASE}/events/${form.id}`, { waitUntil: 'load' });
await anon.locator('.roster').waitFor({ timeout: 60000 });
await settle(anon, 1500);
const rosterText = await anon.locator('.roster').innerText();
check(
	'a stranger sees the masked public list (first name + initial)',
	/Ola N\./.test(rosterText) && !/Ola Nowak/.test(rosterText),
	rosterText.slice(0, 120)
);
// Ola withdraws → Michał is offered the seat with a 24h claim.
await o.locator('.answers button', { hasText: 'I cannot come' }).click();
await settle(o, 1500);
await mi.reload({ waitUntil: 'load' });
await mi.locator('.respond .mine--offer').waitFor({ timeout: 60000 });
check(
	'the freed seat is offered to Michał with a deadline',
	/until/.test(await mi.locator('.respond .mine--offer').innerText())
);
const claim = mi.locator('.answers button.primary');
check(
	'…and the button reads "Claim my seat"',
	(await claim.innerText()).trim() === 'Claim my seat'
);
await claim.click();
await mi.locator('.respond .mine', { hasText: 'You are going' }).waitFor({ timeout: 15000 });
check('claiming turns the offer into a seat', true);
const promoted = (
	await (await fetch(`${API}/api/notifications/`, { headers: auth(michal) })).json()
).filter((n) => n.type === 'registration_promoted').length;
check('the offer arrived as a notification', promoted >= 1);
// Kasia checks Michał in and downloads the CSV.
await k.reload({ waitUntil: 'load' });
const panel = k.locator('.registrations');
await panel.waitFor({ timeout: 60000 });
const michalRow = panel.locator('.row', { hasText: 'Michał' });
await michalRow.locator('button', { hasText: 'Check in' }).click();
await settle(k, 1200);
check('check-in marks the row', (await michalRow.locator('.pill--checked').count()) === 1);
await michalRow.locator('button', { hasText: 'Undo check-in' }).click();
await settle(k, 1200);
check('…and undo clears it', (await michalRow.locator('.pill--checked').count()) === 0);
const dl = k.waitForEvent('download', { timeout: 15000 });
await panel.locator('.head button').click();
const file = await dl;
const csv = await (await import('node:fs/promises')).readFile(await file.path(), 'utf8');
check(
	'the CSV carries the question column and the answers',
	csv.includes('Affiliation') && csv.includes('LO nr 5') && csv.includes('PW'),
	csv.slice(0, 200)
);

// ---- B. Approval mode.
const appr = await mkEvent({ registration_mode: 'approval' });
await o.goto(`${BASE}/events/${appr.id}`, { waitUntil: 'load' });
const ask = o.locator('.answers button.primary');
await ask.waitFor({ timeout: 60000 });
check('an approval event offers "Ask to join"', (await ask.innerText()).trim() === 'Ask to join');
await ask.click();
await o
	.locator('.respond .mine', { hasText: 'organiser has to confirm' })
	.waitFor({ timeout: 15000 });
await k.goto(`${BASE}/events/${appr.id}`, { waitUntil: 'load' });
const apanel = k.locator('.registrations');
await apanel.waitFor({ timeout: 60000 });
check(
	'the organiser sees the pending count',
	/Awaiting approval: 1/.test(
		await k
			.locator('.respond, dl')
			.first()
			.innerText()
			.catch(() => '')
	) || (await k.locator('.pill--pending').count()) === 1
);
await apanel.locator('.row', { hasText: 'Ola' }).locator('button', { hasText: 'Accept' }).click();
await settle(k, 1200);
check(
	'accepting seats her',
	(await apanel.locator('.row', { hasText: 'Ola' }).locator('.pill--going').count()) === 1
);
const confirmed = (
	await (await fetch(`${API}/api/notifications/`, { headers: auth(ola) })).json()
).filter((n) => n.type === 'registration_confirmed').length;
check('…and tells her', confirmed >= 1);

// ---- C. A capped session.
const sess = await (
	await fetch(`${API}/api/events/${appr.id}/sessions/`, {
		method: 'POST',
		headers: auth(kasia),
		body: JSON.stringify({
			title: 'Small workshop',
			starts_at: new Date(start.getTime() + 1800e3).toISOString(),
			duration_minutes: 45,
			capacity: 1
		})
	})
).json();
check(
	'API creates a capped session',
	sess.capacity === 1 && sess.registered_count === 0,
	JSON.stringify(sess).slice(0, 120)
);
await o.reload({ waitUntil: 'load' });
const seatBtn = o
	.locator('.session', { hasText: 'Small workshop' })
	.locator('button', { hasText: 'Take a seat' });
await seatBtn.waitFor({ timeout: 60000 });
await seatBtn.click();
await settle(o, 1200);
check(
	'somebody going takes the seat and the count shows 1/1',
	(await o
		.locator('.session', { hasText: 'Small workshop' })
		.locator('button', { hasText: 'Seat taken · 1/1' })
		.count()) === 1
);
const mSeat = await fetch(`${API}/api/events/${appr.id}/sessions/${sess.id}/register/`, {
	method: 'POST',
	headers: auth(michal)
});
check(
	'a person not going is refused a session seat',
	mSeat.status === 409 && (await mSeat.json()).detail === 'not_going'
);

// Cleanup
for (const id of [form.id, appr.id]) await removeEvent(id);
const left = (
	await (await fetch(`${API}/api/events/?mine=hosting`, { headers: auth(kasia) })).json()
).filter((e) => e.title.startsWith(MARKER) && e.status !== 'cancelled').length;
check('scratch events removed', left === 0, String(left));
check('zero console/page errors', errors.length === 0, errors.join(' | ').slice(0, 500));
await k.screenshot({ path: 'e2e/screenshots/event-registration.png' });
await browser.close();
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
