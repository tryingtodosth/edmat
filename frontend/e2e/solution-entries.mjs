// The solution/hint pool (SolutionEntry): peer solutions & hints per exercise — reveal + pinned
// corpus originals, a plain user's entry queueing, a verified contributor's inline accept, votes
// reordering, other-language entries behind their own action, entry-targeted edit suggestions
// decided by the author, the moderation-queue tab, and the homepage Activity tab.
//   E2E_BASE=http://localhost:5173 E2E_API=http://localhost:8000 E2E_EXERCISE=1 node e2e/solution-entries.mjs
// Uses the seeded demo accounts (ola = plain, michal = verified contributor, kasia = staff) —
// login is throttled 10/min per identity, so each logs in exactly once, via the UI.
let chromium;
try {
	({ chromium } = await import('playwright'));
} catch {
	({ chromium } = await import('playwright-core'));
}
const BASE = process.env.E2E_BASE ?? 'http://localhost:5173';
const API = process.env.E2E_API ?? 'http://localhost:8000';
const EXERCISE = process.env.E2E_EXERCISE ?? '1';
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

async function newSession() {
	const context = await browser.newContext({ viewport: { width: 1280, height: 950 } });
	const page = await context.newPage();
	page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
	page.on('pageerror', (e) => errors.push(e.message));
	return page;
}
const settle = (ms = 900) => new Promise((r) => setTimeout(r, ms));
async function goto(page, path) {
	await page.goto(`${BASE}${path}`, { waitUntil: 'load' });
	await settle(1200);
}
async function login(page, email) {
	await goto(page, '/login');
	// A fresh context's first page pays Vite's cold-compile cost (e2e/CLAUDE.md trap 11) — filling
	// before hydration makes the form submit natively as a GET to /login? and nothing logs in.
	await settle(2500);
	await page.locator('form input[type="email"]').fill(email);
	await page.locator('form input[type="password"]').fill('password123');
	await page.locator('form button[type="submit"]').click();
	await page.waitForURL((u) => !u.pathname.includes('/login'), { timeout: 10000 });
	await settle(800);
}
const tokenOf = (page) => page.evaluate(() => localStorage.getItem('edmat-auth-token'));

// ---------------------------------------------------------------- 0. reset (idempotent reruns)
// Kasia (staff) signs in first; every non-pinned entry on the target exercise is deleted through
// the real API so a rerun — or a previous run that died mid-way — can't skew the counts below.
const kasia = await newSession();
await login(kasia, 'kasia@edmat.example');
const kasiaToken = await tokenOf(kasia);
const api = (path, opts = {}) =>
	fetch(`${API}/api${path}`, {
		...opts,
		headers: {
			'Content-Type': 'application/json',
			Authorization: `Token ${kasiaToken}`,
			...(opts.headers ?? {})
		}
	});
// Ola and michal sign in now too (each exactly once — the login throttle), both so their
// sessions are ready for the flow below and because cleanup needs THEIR tokens: a rejected entry
// is visible to its own author only, so kasia's view alone cannot find a previous run's rejects.
const ola = await newSession();
await login(ola, 'ola@edmat.example');
const michal = await newSession();
await login(michal, 'michal@edmat.example');
const tokens = [kasiaToken, await tokenOf(ola), await tokenOf(michal)];
async function resetEntries() {
	let removed = 0;
	for (const token of tokens) {
		const detail = await (
			await fetch(`${API}/api/exercises/${EXERCISE}/`, {
				headers: { Authorization: `Token ${token}` }
			})
		).json();
		for (const entry of detail.entries) {
			if (entry.pinned) continue;
			const res = await fetch(`${API}/api/solution-entries/${entry.id}/`, {
				method: 'DELETE',
				headers: { Authorization: `Token ${token}` }
			});
			if (res.status === 204) removed++;
		}
	}
	return removed;
}
await resetEntries();

// ---------------------------------------------------------------- 1. anonymous: the corpus pool
const anon = await newSession();
await goto(anon, `/exercises/${EXERCISE}`);
const showSolutions = anon.getByRole('button', { name: /Show solutions \(\d+\)/ });
await showSolutions.waitFor({ timeout: 20000 }); // first page of a fresh context: cold compile
check('anonymous sees the solutions reveal with a count', (await showSolutions.count()) === 1);
check(
	'and the hints reveal',
	(await anon.getByRole('button', { name: /Show hints \(\d+\)/ }).count()) === 1
);
check(
	'signed out: no "Add a solution"',
	(await anon.getByRole('button', { name: 'Add a solution' }).count()) === 0
);
await showSolutions.click();
await settle(600);
check('revealing shows the pinned corpus original', (await anon.locator('.entry').count()) >= 1);
check(
	'it is badged as pinned and attributed to the corpus',
	(await anon.locator('.entry .badge--pinned').count()) >= 1 &&
		(await anon.locator('.entry__author--corpus').count()) >= 1
);
check(
	'its vote arrows are disabled signed out',
	await anon.locator('.entry .vote-arrow').first().isDisabled()
);

// ---------------------------------------------------------------- 2. ola (plain) adds a solution
await goto(ola, `/exercises/${EXERCISE}`);
await ola.getByRole('button', { name: 'Add a solution' }).click();
await ola.locator('.composer textarea').fill('An alternative way: substitute \\(u = x^2\\).');
await ola.getByRole('button', { name: 'Show preview' }).click();
await settle(600);
check(
	'the composer preview typesets KaTeX',
	(await ola.locator('.composer__preview .katex').count()) > 0
);
await ola.getByRole('button', { name: /^Add$/ }).click();
await settle(900);
check(
	'a plain user is told their entry awaits review',
	(await ola.getByText('Added — it will appear once a reviewer accepts it.').count()) === 1
);
// Submitting auto-reveals the section (submitEntry sets revealed = true), so no click needed.
check(
	'the author sees their own pending card',
	(await ola.locator('.entry--pending').count()) === 1
);

// The pending entry must NOT leak to the signed-out reader.
await goto(anon, `/exercises/${EXERCISE}`);
await anon.getByRole('button', { name: /Show solutions/ }).click();
await settle(500);
check(
	'the pending entry is invisible to a stranger',
	(await anon.locator('.entry--pending').count()) === 0
);

// ---------------------------------------------------------------- 3. michal (verified) reviews
await goto(michal, `/exercises/${EXERCISE}`);
await michal.getByRole('button', { name: /Show solutions/ }).click();
await settle(500);
const pendingCard = michal.locator('.entry--pending').first();
check('a verified contributor sees the pending card inline', (await pendingCard.count()) === 1);
await pendingCard.getByRole('button', { name: 'Accept' }).click();
await settle(900);
check('one accept publishes it', (await michal.locator('.entry--pending').count()) === 0);

// Votes: michal (verified, weight 2) downvotes the corpus original, upvotes ola's — ola's should
// outrank the unpinned... corpus original is pinned so stays first; instead check the score text.
const olaCard = michal.locator('.entry', { hasText: 'alternative way' }).first();
await olaCard.locator('.vote-arrow').first().click();
await settle(700);
check(
	"a verified contributor's vote counts double",
	(await olaCard.locator('.entry__score').textContent()).trim() === '2'
);

// Michal (verified) adds an ENGLISH solution — publishes immediately, sits behind the
// other-languages action for a Polish-content reader.
await michal.getByRole('button', { name: 'Add a solution' }).click();
await michal.locator('.composer label input').fill('en');
await michal.locator('.composer textarea').fill('In English: integrate by parts.');
await michal.getByRole('button', { name: /^Add$/ }).click();
await settle(900);
check(
	"a verified contributor's entry publishes immediately",
	(await michal.getByText('Published — thank you!').count()) === 1
);
const otherToggle = michal.getByRole('button', { name: /Show 1 more in other languages/ });
check(
	'the English entry sits behind the other-languages action',
	(await otherToggle.count()) === 1
);
await otherToggle.click();
await settle(400);
check(
	'expanding shows it with its language badge',
	(await michal.locator('.entry .badge--lang', { hasText: 'EN' }).count()) === 1
);

// ---------------------------------------------------------------- 4. suggest an edit → author decides
await goto(michal, `/exercises/${EXERCISE}`);
await michal.getByRole('button', { name: /Show solutions/ }).click();
await settle(500);
const target = michal.locator('.entry', { hasText: 'alternative way' }).first();
await target.getByRole('button', { name: 'Suggest an edit' }).click();
await target
	.locator('.entry__form textarea')
	.fill('An alternative way: substitute \\(u = x^2\\), then simplify.');
await target.getByRole('button', { name: 'Send suggestion' }).click();
await settle(800);
check(
	'a suggestion is sent to the author',
	(await michal.getByText('Suggestion sent to the author.').count()) === 1
);

await goto(ola, `/exercises/${EXERCISE}`);
await ola.getByRole('button', { name: /Show solutions/ }).click();
await settle(500);
const own = ola.locator('.entry', { hasText: 'alternative way' }).first();
await own.getByRole('button', { name: 'Edit suggestions' }).click();
await settle(700);
check(
	'the author sees the pending suggestion',
	(await own.locator('.entry__suggestions li').count()) === 1
);
await own.getByRole('button', { name: 'Apply' }).click();
await settle(800);
check('applying it mutates the body in place', (await own.textContent()).includes('then simplify'));

// ---------------------------------------------------------------- 5. the moderation-queue tab
// Ola files a pending HINT; kasia (staff) rejects it from the queue tab with a note.
await goto(ola, `/exercises/${EXERCISE}`);
await ola.getByRole('button', { name: 'Add a hint' }).click();
await ola.locator('.composer textarea').fill('Scratch hint for the queue test.');
await ola.getByRole('button', { name: /^Add$/ }).click();
await settle(900);

await goto(kasia, '/moderation');
// The count is platform-wide (the migration left two genuinely pending entries from a pending
// translation), so assert the tab exists and that OUR row is inside it — not an exact total.
const entriesTab = kasia.getByRole('tab', { name: /Solutions & hints \(\d+\)/ });
await entriesTab.waitFor();
check('the queue has a Solutions & hints tab with a live count', (await entriesTab.count()) === 1);
await entriesTab.click();
await settle(600);
check(
	'the tab lists the pending hint with its exercise',
	(await kasia.locator('.queue-item', { hasText: 'Scratch hint' }).count()) === 1
);
// Scope to OUR row by text, never positionally — the queue can hold other pending entries.
const scratchRow = kasia.locator('.queue-item', { hasText: 'Scratch hint' }).first();
const rejectBtn = scratchRow.locator('.reject');
check('reject stays disabled until a note says what went wrong', await rejectBtn.isDisabled());
await scratchRow.locator('textarea').fill('Not actually a hint.');
await rejectBtn.click();
await settle(900);
check(
	'rejecting clears it from the queue',
	(await kasia.locator('.queue-item', { hasText: 'Scratch hint' }).count()) === 0
);

// The author sees their rejected hint, with the note, on the exercise page.
await goto(ola, `/exercises/${EXERCISE}`);
await ola.getByRole('button', { name: /Show hints/ }).click();
await settle(500);
check(
	'the author sees the rejection and its note',
	(await ola.locator('.entry', { hasText: 'Not actually a hint.' }).count()) === 1
);

// ---------------------------------------------------------------- 6. the homepage Activity tab
await goto(anon, '/?tab=activity');
check(
	'the Activity tab renders newest actions',
	(await anon.locator('.activity__row').count()) > 0
);
check(
	'including a new-solution row',
	(await anon.locator('.activity__kind', { hasText: 'New solution' }).count()) > 0
);

// ---------------------------------------------------------------- cleanup (API, kasia's token)
const cleaned = await resetEntries();
const after = await (await api(`/exercises/${EXERCISE}/`)).json();
check(
	`cleanup removed the ${cleaned} scratch entries, corpus pool intact`,
	after.entries.every((e) => e.pinned) && after.entries.length === 2
);

console.log(`\n${pass} passed, ${fail} failed`);
if (errors.length) {
	console.log('console/page errors:');
	for (const e of errors) console.log('  ' + e);
}
await browser.close();
process.exit(fail || errors.length ? 1 : 0);
