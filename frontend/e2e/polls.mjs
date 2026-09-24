// Polls (decisions, management step E — MANAGEMENT-BRIEF.md §3.E) on the real pages: kasia hosts
// a scratch event, creates a two-option poll on it, opens it for voting, votes for the first
// option herself (a host is node staff, and staff counts as a member — eligibility 'members'
// covers her), closes it with a decision note, and the results + note render both on the panel
// (`ManagementPanels` mounted on the event page) and on the full `/polls/[id]` page.
//
//   E2E_BASE=http://localhost:5225 E2E_API=http://127.0.0.1:8125 node e2e/polls.mjs
//
// Kasia is the seeded staff/demo account — irrelevant to any check here, since nothing tested is a
// FeatureFlag kill-switch check (e2e/CLAUDE.md trap 10). Scratch event removed through the API at
// the end; the poll itself is left behind (no delete endpoint once it is not a draft — the same
// "scratch data left behind" precedent as the claim scripts, e2e/CLAUDE.md trap 19), dangling and
// invisible once its node is gone.
let chromium;
try {
	({ chromium } = await import('playwright'));
} catch {
	({ chromium } = await import('playwright-core'));
}
const BASE = process.env.E2E_BASE ?? 'http://localhost:5225';
const API = process.env.E2E_API ?? 'http://127.0.0.1:8125';
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
const kasia = await tokenFor('kasia@edmat.example');
const auth = (t) => ({ 'Content-Type': 'application/json', Authorization: `Token ${t}` });

// ---- scratch event ------------------------------------------------------------------------
const MARKER = 'Polls e2e — decisions';
for (const e of await (
	await fetch(`${API}/api/events/?mine=hosting`, { headers: auth(kasia) })
).json()) {
	if (e.title === MARKER)
		await fetch(`${API}/api/events/${e.id}/`, { method: 'DELETE', headers: auth(kasia) });
}

const start = new Date(Date.now() + 5 * 86400e3);
start.setHours(18, 0, 0, 0);
const event = await (
	await fetch(`${API}/api/events/`, {
		method: 'POST',
		headers: auth(kasia),
		body: JSON.stringify({
			title: MARKER,
			status: 'published',
			visibility: 'public',
			starts_at: start.toISOString(),
			duration_minutes: 90,
			location_kind: 'onsite',
			location_text: 'Banacha 2',
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
	const p = await (await browser.newContext({ viewport: { width: 1280, height: 1200 } })).newPage();
	p.on('console', (m) => {
		if (m.type() === 'error') errors.push(`[${p.url()}] ${m.text()}`);
	});
	p.on('pageerror', (e) => errors.push(e.message));
	// This machine routinely runs several other agents' suites at once (e2e/CLAUDE.md's own note
	// on event-cloakroom.mjs) — a generous default so a timeout means "never got there", not "slow".
	p.setDefaultTimeout(60000);
	return p;
};
const settle = (p, ms = 700) => p.waitForTimeout(ms);
const login = async (p, email) => {
	// Every control is in the server-rendered HTML, so the field resolves and a click does nothing
	// until the bundle hydrates (trap 25) — wait for the root layout's own boot request first.
	const booted = p.waitForResponse((r) => r.url().includes('/feature-flags/'), { timeout: 90000 });
	await p.goto(`${BASE}/login`, { waitUntil: 'load', timeout: 90000 });
	await booted;
	await p.locator('form input[autocomplete="username"]').waitFor({ timeout: 30000 });
	await settle(p, 1200);
	await p.locator('form input[autocomplete="username"]').fill(email);
	await p.locator('form input[type="password"]').fill('password123');
	await p.locator('form button[type="submit"]').click();
	await p.waitForURL((u) => !u.pathname.includes('/login'), { timeout: 45000 });
};

const page = await mk();
await login(page, 'kasia@edmat.example');
await page.goto(`${BASE}/events/${event.id}`, { waitUntil: 'load', timeout: 90000 });
await page.locator('[data-polls-panel]').waitFor({ timeout: 30000 });
check('the event page mounts the polls panel', true);

// ---- create a two-option poll -----------------------------------------------------------------
await page.locator('.create-toggle').click();
await page.locator('.create-form input[name="question"]').waitFor({ timeout: 10000 });
await page.locator('.create-form input[name="question"]').fill('Sobota czy niedziela?');
await page.locator('.create-form input[name="option-0"]').fill('Sobota');
await page.locator('.create-form input[name="option-1"]').fill('Niedziela');
await page.locator('.create-form .form-actions .btn-primary').click();
await page.locator('[data-poll-status="draft"]').waitFor({ timeout: 20000 });
check(
	'the poll appears as a draft',
	(await page.locator('[data-poll-status="draft"]').count()) === 1
);

const pollId = await page
	.locator('[data-poll-status="draft"]')
	.first()
	.getAttribute('data-poll-id');
const draftFromApi = await (
	await fetch(`${API}/api/polls/${pollId}/`, { headers: auth(kasia) })
).json();
check(
	'the poll has exactly two options',
	Array.isArray(draftFromApi.options) && draftFromApi.options.length === 2,
	JSON.stringify(draftFromApi.options)
);
const firstOptionId = draftFromApi.options[0].id;

// ---- open it -------------------------------------------------------------------------------
await page.locator(`[data-poll-id="${pollId}"] .poll-actions button`).click();
await page
	.locator(`[data-poll-id="${pollId}"][data-poll-status="open"]`)
	.waitFor({ timeout: 20000 });
check('opening the poll flips it to open', true);

// ---- vote for the first option ---------------------------------------------------------------
await page.locator(`[data-poll-id="${pollId}"] form input[type="radio"]`).first().check();
await page.locator(`[data-poll-id="${pollId}"] form button.btn-primary`).click();
await page.locator(`[data-poll-id="${pollId}"] .poll-note`).waitFor({ timeout: 20000 });
const noteText = await page.locator(`[data-poll-id="${pollId}"] .poll-note`).innerText();
check('the panel shows "already voted" once cast', noteText.trim().length > 0, noteText);

const resultsWhileOpen = await (
	await fetch(`${API}/api/polls/${pollId}/results/`, { headers: auth(kasia) })
).json();
const firstCount = (resultsWhileOpen.options ?? []).find((o) => o.id === firstOptionId)?.count;
check(
	'the vote was recorded for the chosen option',
	firstCount === 1,
	JSON.stringify(resultsWhileOpen)
);

// ---- close with a decision note ----------------------------------------------------------------
const DECISION = 'Robimy w sobotę — więcej osób może przyjść.';
await page.locator(`[data-poll-id="${pollId}"] .poll-close-form textarea`).fill(DECISION);
await page.locator(`[data-poll-id="${pollId}"] .poll-close-form button`).click();
await page
	.locator(`[data-poll-id="${pollId}"][data-poll-status="closed"]`)
	.waitFor({ timeout: 20000 });
check('closing the poll flips it to closed', true);

await page.locator(`[data-poll-id="${pollId}"] .poll-decision-note`).waitFor({ timeout: 20000 });
const panelNote = await page.locator(`[data-poll-id="${pollId}"] .poll-decision-note`).innerText();
check('the decision note renders on the panel', panelNote.includes(DECISION), panelNote);

await page.locator(`[data-poll-id="${pollId}"] .poll-results`).waitFor({ timeout: 20000 });
const panelResultsText = await page.locator(`[data-poll-id="${pollId}"] .poll-results`).innerText();
check(
	'the results bar on the panel shows one vote for "Sobota"',
	/Sobota/.test(panelResultsText) && /\b1\b/.test(panelResultsText),
	panelResultsText
);
const turnoutText = await page.locator(`[data-poll-id="${pollId}"] .poll-turnout`).innerText();
check('a turnout line renders on the panel', /1/.test(turnoutText), turnoutText);
await page.screenshot({ path: 'e2e/screens/polls-panel-closed.png' });

// ---- the same poll, at full size on /polls/[id] ------------------------------------------------
await page.goto(`${BASE}/polls/${pollId}`, { waitUntil: 'load', timeout: 90000 });
await page.locator('.decision-note').waitFor({ timeout: 30000 });
const fullPageNote = await page.locator('.decision-note').innerText();
check('the decision note renders on /polls/[id]', fullPageNote.includes(DECISION), fullPageNote);
const fullPageResults = await page.locator('.poll-results').innerText();
check(
	'the results also render on /polls/[id]',
	/Sobota/.test(fullPageResults) && /\b1\b/.test(fullPageResults),
	fullPageResults
);
await page.screenshot({ path: 'e2e/screens/polls-full-page.png' });

// ---- cleanup --------------------------------------------------------------------------------
const removed = await fetch(`${API}/api/events/${event.id}/`, {
	method: 'DELETE',
	headers: auth(kasia)
});
check('the scratch event is removed', removed.status === 204, String(removed.status));

check('no console or page errors', errors.length === 0, errors.join(' | '));
await browser.close();
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
