// The call for contributions (AUDIENCE-BRIEF.md §3.4; root CLAUDE.md §17AO): Ola proposes a talk
// through the real page, Michał (a reviewer) sees the queue, asks for revisions, Ola edits and
// resubmits, Michał accepts, Kasia (host) schedules it into the programme and the session appears
// with Ola as speaker; a second proposal is declined with a reason Ola sees — and never who
// decided. Cleans up via the API.
//   E2E_BASE=http://localhost:5173 E2E_API=http://localhost:8000 node e2e/event-contributions.mjs
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
	const p = await (await browser.newContext({ viewport: { width: 1280, height: 1000 } })).newPage();
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
	const j = await r.json();
	if (!j.token)
		throw new Error(
			`login failed for ${email}: ${JSON.stringify(j)} (login throttle? clear backend/cachedata)`
		);
	return j.token;
};
const kasia = await tokenFor('kasia@edmat.example');
const ola = await tokenFor('ola@edmat.example');
const michal = await tokenFor('michal@edmat.example');
const auth = (t) => ({ 'Content-Type': 'application/json', Authorization: `Token ${t}` });
const MARKER = 'CFP e2e — student colloquium';
const removeEvent = async (id) => {
	for (const t of [ola, michal])
		await fetch(`${API}/api/events/${id}/attend/`, {
			method: 'POST',
			headers: auth(t),
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
const login = async (p, email) => {
	await p.goto(`${BASE}/login`, { waitUntil: 'networkidle', timeout: 90000 });
	await settle(p, 800);
	await p.locator('form input[autocomplete="username"]').fill(email);
	await p.locator('form input[type="password"]').fill('password123');
	await p.locator('form button[type="submit"]').click();
	await p.waitForURL((u) => !u.pathname.includes('/login'), { timeout: 15000 });
};
const start = new Date(Date.now() + 9 * 86400e3);
start.setHours(9, 0, 0, 0);
const ev = await (
	await fetch(`${API}/api/events/`, {
		method: 'POST',
		headers: auth(kasia),
		body: JSON.stringify({
			title: MARKER,
			status: 'published',
			visibility: 'public',
			starts_at: start.toISOString(),
			runs_until: new Date(start.getTime() + 8 * 3600e3).toISOString(),
			location_kind: 'onsite',
			location_text: 'Aula',
			audience: 'university',
			cfp_open: true
		})
	})
).json();
check(
	'API creates an event with an open call',
	ev.cfp_open === true && ev.call_is_open === true,
	JSON.stringify(ev).slice(0, 160)
);
const michalMe = await (await fetch(`${API}/api/auth/me/`, { headers: auth(michal) })).json();
const staffed = await fetch(`${API}/api/events/${ev.id}/staff/`, {
	method: 'POST',
	headers: auth(kasia),
	body: JSON.stringify({ user: michalMe.id, role: 'reviewer' })
});
check('Michał is made a reviewer', staffed.status === 201);
{
	const warm = await mk();
	await warm.goto(`${BASE}/events/${ev.id}`, { waitUntil: 'networkidle', timeout: 180000 });
	await warm.close();
}

// 1. Ola proposes.
const o = await mk();
await login(o, 'ola@edmat.example');
await o.goto(`${BASE}/events/${ev.id}`, { waitUntil: 'load' });
const cp = o.locator('.contributions');
await cp.waitFor({ timeout: 60000 });
check(
	'the page says proposals are open',
	/Proposals are open/.test(await cp.locator('.head').innerText())
);
await cp.locator('.head button', { hasText: 'Propose' }).click();
const form = cp.locator('form.propose');
await form.waitFor();
await form.locator('input[maxlength="200"]').fill('Fourier series in one lecture');
await form.locator('select').first().selectOption('talk');
await form
	.locator('select')
	.filter({ has: o.locator('option[value="secondary"]') })
	.selectOption('university');
await form.locator('textarea').first().fill('What every second-year should know.');
await form.locator('input[placeholder*="affiliation"]').fill('Jan Kowalski (PW)');
await form.locator('button[type="submit"]').click();
const mine = cp.locator('.card', { hasText: 'Fourier series' });
await mine.waitFor({ timeout: 15000 });
check(
	'the proposal appears under "My proposals" as Submitted',
	(await mine.locator('.pill--submitted').count()) === 1
);
const strangerView = await (await fetch(`${API}/api/events/${ev.id}/contributions/`)).json();
check('a stranger sees no unaccepted proposal', strangerView.length === 0);

// 2. Michał reviews: asks for revisions.
const mi = await mk();
await login(mi, 'michal@edmat.example');
await mi.goto(`${BASE}/events/${ev.id}`, { waitUntil: 'load' });
const mq = mi.locator('.contributions');
await mq.locator('h3', { hasText: 'To review' }).waitFor({ timeout: 60000 });
const qcard = mq.locator('.card', { hasText: 'Fourier series' });
check(
	'the reviewer sees the queue with the submitter and co-author',
	/Ola/.test(await qcard.innerText()) && /Jan Kowalski/.test(await qcard.innerText())
);
await qcard.locator('button', { hasText: 'Start reviewing' }).click();
await settle(mi, 1200);
await qcard.locator('button', { hasText: 'Ask for revisions' }).click();
await qcard.locator('.decide input').fill('Please add the prerequisites.');
await qcard.locator('.decide button', { hasText: 'Ask for revisions' }).click();
await settle(mi, 1200);
check(
	'revisions put it back to Submitted',
	(await qcard.locator('.pill--submitted').count()) === 1
);

// 3. Ola sees the note (not who wrote it), edits, and it stays submitted.
await o.reload({ waitUntil: 'load' });
const mine2 = o.locator('.contributions .card', { hasText: 'Fourier series' });
await mine2.waitFor({ timeout: 60000 });
const noteText = await mine2.innerText();
check(
	'Ola reads the reason and the note',
	/Needs revision/.test(noteText) && /prerequisites/.test(noteText),
	noteText.slice(0, 200)
);
check('…but never who decided', !/decided by/.test(noteText) && !/Michał/.test(noteText));
await mine2.locator('button', { hasText: 'Edit' }).click();
const eform = o.locator('.contributions form.propose');
await eform
	.locator('textarea')
	.first()
	.fill('What every second-year should know. Prerequisites: integrals.');
await eform.locator('button[type="submit"]').click();
await settle(o, 1500);
check(
	'the edited proposal is still Submitted',
	(await o
		.locator('.contributions .card', { hasText: 'Fourier series' })
		.locator('.pill--submitted')
		.count()) === 1
);

// 4. Michał accepts; Kasia schedules.
await mi.reload({ waitUntil: 'load' });
const qcard2 = mi.locator('.contributions .card', { hasText: 'Fourier series' });
await qcard2.waitFor({ timeout: 60000 });
await qcard2.locator('button', { hasText: 'Accept' }).click();
await settle(mi, 1200);
check(
	'accepting moves it to Accepted with the decider shown to staff',
	(await qcard2.locator('.pill--accepted').count()) === 1 &&
		/decided by Michał/.test(await qcard2.innerText())
);
check(
	'a reviewer has no schedule button',
	(await qcard2.locator('button', { hasText: 'Put it on the programme' }).count()) === 0
);
const k = await mk();
await login(k, 'kasia@edmat.example');
await k.goto(`${BASE}/events/${ev.id}`, { waitUntil: 'load' });
const kcard = k.locator('.contributions .card', { hasText: 'Fourier series' });
await kcard.waitFor({ timeout: 60000 });
await kcard.locator('button', { hasText: 'Put it on the programme' }).click();
const pad = (n) => String(n).padStart(2, '0');
const at = new Date(start.getTime() + 2 * 3600e3);
await kcard
	.locator('input[type="datetime-local"]')
	.fill(
		`${at.getFullYear()}-${pad(at.getMonth() + 1)}-${pad(at.getDate())}T${pad(at.getHours())}:${pad(at.getMinutes())}`
	);
await kcard.locator('.decide button', { hasText: 'Schedule' }).click();
await settle(k, 1500);
check(
	'scheduling marks it On the programme',
	(await kcard.locator('.pill--scheduled').count()) === 1
);
const sess = k.locator('.programme .session', { hasText: 'Fourier series' });
await sess.waitFor({ timeout: 15000 }).catch(() => {});
if ((await sess.count()) === 0) await k.reload({ waitUntil: 'load' });
await k.locator('.programme .session', { hasText: 'Fourier series' }).waitFor({ timeout: 60000 });
const sessText = await k.locator('.programme .session', { hasText: 'Fourier series' }).innerText();
check(
	'a real session appears with Ola and the co-author as speakers',
	/Ola/.test(sessText) && /Jan Kowalski/.test(sessText),
	sessText.slice(0, 160)
);
const decidedNotif = (
	await (await fetch(`${API}/api/notifications/`, { headers: auth(ola) })).json()
).filter((n) => n.type === 'contribution_decided').length;
check('Ola was told at each decision', decidedNotif >= 3, String(decidedNotif));

// 5. A second proposal, declined with a reason.
const second = await (
	await fetch(`${API}/api/events/${ev.id}/contributions/`, {
		method: 'POST',
		headers: auth(ola),
		body: JSON.stringify({
			kind: 'poster',
			title: 'A poster nobody asked for',
			audience: 'university'
		})
	})
).json();
await mi.reload({ waitUntil: 'load' });
const pcard = mi.locator('.contributions .card', { hasText: 'poster nobody' });
await pcard.waitFor({ timeout: 60000 });
await pcard.locator('button', { hasText: 'Decline' }).first().click();
await pcard.locator('.decide select').selectOption('out_of_scope');
await pcard.locator('.decide input').fill('Posters are not part of this colloquium.');
await pcard.locator('.decide button', { hasText: 'Decline with this reason' }).click();
await settle(mi, 1200);
const olaSecond = await (
	await fetch(`${API}/api/events/${ev.id}/contributions/${second.id}/`, { headers: auth(ola) })
).json();
check(
	'the author gets the reason code and note, and no decider',
	olaSecond.status === 'rejected' &&
		olaSecond.reason_code === 'out_of_scope' &&
		olaSecond.decided_by === null,
	JSON.stringify(olaSecond).slice(0, 200)
);
// A fresh URL: the anonymous read cache (§17AB) still holds the empty list fetched above.
const publicList = await (
	await fetch(`${API}/api/events/${ev.id}/contributions/?fresh=${Date.now()}`)
).json();
check(
	'the public list carries the scheduled talk only',
	publicList.length === 1 && publicList[0].status === 'scheduled'
);

await removeEvent(ev.id);
check(
	'scratch event removed',
	(await (await fetch(`${API}/api/events/?mine=hosting`, { headers: auth(kasia) })).json()).filter(
		(e) => e.title.startsWith(MARKER) && e.status !== 'cancelled'
	).length === 0
);
check('zero console/page errors', errors.length === 0, errors.join(' | ').slice(0, 500));
await k.screenshot({ path: 'e2e/screenshots/event-contributions.png' });
await browser.close();
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
