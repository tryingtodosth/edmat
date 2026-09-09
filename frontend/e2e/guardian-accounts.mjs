// Guardian accounts and minor-safe defaults (AUDIENCE-BRIEF.md §2; root CLAUDE.md §17AP): the
// under-16 rule on the real register form; a guardian (Kasia) makes a child's account in Settings;
// the child signs in by username, sees no Messages, no "Host an event", no "Offer tutoring", a
// locked privacy toggle and no avatar section; the child's comment is held and shows in the
// guardian's panel; the guardian registers the child for an event, then deletes the account.
//   E2E_BASE=http://localhost:5173 E2E_API=http://localhost:8000 node e2e/guardian-accounts.mjs
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
		if (m.type() !== 'error') return;
		// The under-16 refusal IS a 400 from /auth/register/, and Chromium logs every failed
		// fetch as a console error — that one is the behaviour under test, not a bug.
		if (p.url().includes('/register') && m.text().includes('400')) return;
		errors.push(`[${p.url()}] ${m.text()}`);
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
	const j = await r.json();
	if (!j.token)
		throw new Error(
			`login failed for ${email}: ${JSON.stringify(j)} (login throttle? clear backend/cachedata)`
		);
	return j.token;
};
const kasia = await tokenFor('kasia@edmat.example');
const auth = (t) => ({ 'Content-Type': 'application/json', Authorization: `Token ${t}` });
const CHILD = 'e2e-zosia';
// Reset: a leftover child from an earlier run.
for (const c of await (await fetch(`${API}/api/auth/children/`, { headers: auth(kasia) })).json()) {
	if (c.username === CHILD)
		await fetch(`${API}/api/auth/children/${c.id}/`, { method: 'DELETE', headers: auth(kasia) });
}
const login = async (p, id, password = 'password123') => {
	await p.goto(`${BASE}/login`, { waitUntil: 'networkidle', timeout: 90000 });
	await settle(p, 800);
	await p.locator('form input[autocomplete="username"]').fill(id);
	await p.locator('form input[type="password"]').fill(password);
	await p.locator('form button[type="submit"]').click();
	await p.waitForURL((u) => !u.pathname.includes('/login'), { timeout: 15000 });
};

// 1. The register form refuses an under-16 in words, without creating anything.
const r = await mk();
await r.goto(`${BASE}/register`, { waitUntil: 'networkidle', timeout: 120000 });
await settle(r, 800);
const year = new Date().getFullYear();
await r.locator('form input[type="text"]').first().fill('Young Person');
await r.locator('form input[type="email"]').fill(`young-${Date.now()}@example.org`);
await r.locator('form input[inputmode="numeric"]').fill(String(year - 12));
await r.locator('form input[type="password"]').fill('a-strong-passw0rd!');
await r.locator('form button[type="submit"]').click();
await r.locator('.error.guardian').waitFor({ timeout: 15000 });
check(
	'an under-16 is told to ask a guardian, on the form',
	/parent or guardian/.test(await r.locator('.error.guardian').innerText())
);
check('…and no account was made', r.url().includes('/register'));
await r.close();

// 2. Kasia makes a child in Settings.
const k = await mk();
await login(k, 'kasia@edmat.example');
await k.goto(`${BASE}/settings`, { waitUntil: 'load' });
const gp = k.locator('.guardian');
await gp.waitFor({ timeout: 60000 });
await gp.locator('form.add input[type="text"]').first().fill('Zosia');
await gp.locator('form.add input[type="text"]').nth(1).fill(CHILD);
await gp.locator('form.add input[type="password"]').fill('a-strong-passw0rd!');
await gp.locator('form.add button[type="submit"]').click();
await gp.locator('.children li', { hasText: 'Zosia' }).waitFor({ timeout: 15000 });
check('the child appears in the guardian panel', true);
const children = await (await fetch(`${API}/api/auth/children/`, { headers: auth(kasia) })).json();
const child = children.find((c) => c.username === CHILD);
check('API lists the child under the guardian', !!child, JSON.stringify(children));

// 3. The child signs in by username and has none of the adult abilities.
const z = await mk();
await login(z, CHILD, 'a-strong-passw0rd!');
await z.goto(`${BASE}/settings`, { waitUntil: 'load' });
await z.locator('section.field-group', { hasText: 'Privacy' }).waitFor({ timeout: 60000 });
check('the child signed in by username', z.url().includes('/settings'));
check(
	'no Messages icon in the header',
	(await z.locator('header a[href="/messages"], header a[aria-label="Messages"]').count()) === 0
);
check(
	'no avatar section, no tutoring section',
	(await z.locator('section.avatar').count()) === 0 &&
		(await z.getByText('Tutoring', { exact: true }).count()) === 0
);
const priv = z
	.locator('section.field-group', { hasText: 'Privacy' })
	.locator('input[type="checkbox"]');
check(
	'the privacy toggle is locked with an explanation',
	(await priv.isDisabled()) &&
		(await z.getByText("A child's profile is always private").count()) === 1
);
await z
	.locator('header button', { hasText: 'Add' })
	.first()
	.click()
	.catch(() => {});
await settle(z, 600);
const menuText = await z
	.locator('[role="menu"]')
	.innerText()
	.catch(() => '');
check(
	'the Add menu offers neither hosting nor tutoring',
	!/Host an event|Offer tutoring/.test(menuText),
	menuText.slice(0, 120)
);
await z.keyboard.press('Escape');
// A comment by the child is held.
await z.goto(`${BASE}/exercises/1`, { waitUntil: 'load' });
const ta = z.locator('.discussion textarea, textarea').last();
await ta.waitFor({ timeout: 60000 });
await ta.fill('Is the second step right?');
await z.locator('form:has(textarea) button[type="submit"]').last().click();
await settle(z, 1500);
const childTok = await tokenFor(CHILD, 'a-strong-passw0rd!');
const held = await (
	await fetch(`${API}/api/auth/children/${child.id}/content/`, { headers: auth(kasia) })
).json();
check(
	"the child's comment is held for a moderator",
	held.comments.length === 1 && held.comments[0].held === true,
	JSON.stringify(held).slice(0, 160)
);
check(
	'the child cannot message',
	(
		await fetch(`${API}/api/messages/`, {
			method: 'POST',
			headers: auth(childTok),
			body: JSON.stringify({ recipient_id: 1, subject: 'hi', body: 'x' })
		})
	).status === 403
);

// 4. The guardian sees it in the panel and registers the child for an event.
await k.reload({ waitUntil: 'load' });
const row = k.locator('.guardian .children li', { hasText: 'Zosia' });
await row.waitFor({ timeout: 60000 });
await row.locator('button', { hasText: 'What they wrote' }).click();
await row.locator('.items li').first().waitFor({ timeout: 10000 });
check(
	'the guardian reads the held comment',
	/second step/.test(await row.locator('.items').innerText()) &&
		/Awaiting a moderator/.test(await row.locator('.items').innerText())
);
const start = new Date(Date.now() + 4 * 86400e3);
const ev = await (
	await fetch(`${API}/api/events/`, {
		method: 'POST',
		headers: auth(kasia),
		body: JSON.stringify({
			title: 'Guardian e2e — kids day',
			status: 'published',
			visibility: 'public',
			starts_at: start.toISOString(),
			duration_minutes: 60,
			location_kind: 'online',
			online_url: 'https://example.org/k',
			audience: 'primary'
		})
	})
).json();
// Kasia hosts it, so she registers the child through the API path the page uses.
const reg = await fetch(`${API}/api/events/${ev.id}/attend/`, {
	method: 'POST',
	headers: auth(kasia),
	body: JSON.stringify({ status: 'going', on_behalf_of: child.id })
});
const regJ = await reg.json();
check(
	'the guardian registers the child (registered_by set)',
	reg.status === 200 && regJ.attendance.registered_by && regJ.attendance.registered_by.display_name,
	JSON.stringify(regJ).slice(0, 160)
);
// Another host's event, through the page: the on-behalf select.
const ola = await tokenFor('ola@edmat.example');
const ev2 = await (
	await fetch(`${API}/api/events/`, {
		method: 'POST',
		headers: auth(ola),
		body: JSON.stringify({
			title: 'Guardian e2e — workshop',
			status: 'published',
			visibility: 'public',
			starts_at: start.toISOString(),
			duration_minutes: 60,
			location_kind: 'online',
			online_url: 'https://example.org/w',
			audience: 'primary'
		})
	})
).json();
await k.goto(`${BASE}/events/${ev2.id}`, { waitUntil: 'load' });
const ob = k.locator('.on-behalf');
await ob.waitFor({ timeout: 60000 });
await ob.locator('select').selectOption({ label: 'Zosia' });
await ob.locator('button').click();
await ob.locator('.held', { hasText: 'Registered' }).waitFor({ timeout: 15000 });
const roster = await (
	await fetch(`${API}/api/events/${ev2.id}/registrations/`, { headers: auth(ola) })
).json();
check(
	"the page registers the child on the host's roster with the guardian named",
	roster.some((r) => r.attendee.display_name === 'Zosia' && r.registered_by),
	JSON.stringify(roster).slice(0, 200)
);

// 5. Delete the child's account from the panel.
k.on('dialog', (d) => d.accept());
await k.goto(`${BASE}/settings`, { waitUntil: 'load' });
const row2 = k.locator('.guardian .children li', { hasText: 'Zosia' });
await row2.waitFor({ timeout: 60000 });
await row2.locator('button', { hasText: 'Delete account' }).click();
await settle(k, 1500);
check(
	'deleting removes the child from the panel',
	(await k.locator('.guardian .children li', { hasText: 'Zosia' }).count()) === 0
);
check(
	'…and from the API',
	!(await (await fetch(`${API}/api/auth/children/`, { headers: auth(kasia) })).json()).some(
		(c) => c.username === CHILD
	)
);
// Cleanup events.
for (const [id, t] of [
	[ev.id, kasia],
	[ev2.id, ola]
]) {
	const d = await fetch(`${API}/api/events/${id}/`, { method: 'DELETE', headers: auth(t) });
	if (d.status !== 204)
		await fetch(`${API}/api/events/${id}/cancel/`, { method: 'POST', headers: auth(t) });
}
check('zero console/page errors', errors.length === 0, errors.join(' | ').slice(0, 500));
await k.screenshot({ path: 'e2e/screenshots/guardian-accounts.png' });
await browser.close();
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
