// The home-page band chips as a RADIO group (Piotr, 2026-09-23: "selecting one audience on the home
// page should display content only for the selected audience and work as radio button not as
// checkbox as it is rn"). Checks: one band checked at a time, the store holds a one-element list,
// the exercises tab reloads and carries `?audience=<band>`, every card's badge is that band or
// "Everyone", exact counts against the very URL the page asked for, arrow keys move the selection,
// and a profile pinned to TWO bands (Settings keeps its multi-select) shows honestly as "no chip
// checked + a hint" rather than pretending one of them is chosen.
//
// Kasia (staff) creates two scratch exercises through the real API — one `primary`, one `secondary`,
// both `en` so an English-interface guest sees them (§17AQ) — and deletes them at the end; Ola's
// audience filter is reset both before and after.
//   E2E_BASE=http://localhost:5183 E2E_API=http://127.0.0.1:8012 node e2e/audience-radio.mjs
let chromium;
try {
	({ chromium } = await import('playwright'));
} catch {
	({ chromium } = await import('playwright-core'));
}
const BASE = process.env.E2E_BASE ?? 'http://localhost:5183';
const API = process.env.E2E_API ?? 'http://127.0.0.1:8011';
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
	const j = await r.json();
	if (!j.token) throw new Error(`login failed for ${email}: ${JSON.stringify(j)}`);
	return j.token;
};
const auth = (t) => ({ 'Content-Type': 'application/json', Authorization: `Token ${t}` });
const kasia = await tokenFor('kasia@edmat.example');
const ola = await tokenFor('ola@edmat.example');
const MARKER = 'Audience radio e2e';

// The real submission path, not a hand-made row: kasia is a verified contributor, so
// `/api/exercise-submissions/` auto-publishes (§18.4) and — the part that matters here — writes the
// PUBLISHED English translation with it. An exercise with no published translation is invisible to
// a reader whose content language is English (§17AQ), so a row posted straight to `/api/exercises/`
// would have made every list assertion below count zero against zero.
const mine = async () =>
	await (await fetch(`${API}/api/exercises/?lang=en`, { headers: auth(kasia) })).json();
const isScratch = (s) => String(s ?? '').startsWith(MARKER);
const dropScratch = async () => {
	for (const ex of await mine()) {
		if (isScratch(ex.title))
			await fetch(`${API}/api/exercises/${ex.id}/`, { method: 'DELETE', headers: auth(kasia) });
	}
	for (const s of await (
		await fetch(`${API}/api/exercise-submissions/`, { headers: auth(kasia) })
	).json()) {
		if (isScratch(s.payload?.title))
			await fetch(`${API}/api/exercise-submissions/${s.id}/`, {
				method: 'DELETE',
				headers: auth(kasia)
			});
	}
};
await dropScratch();
await fetch(`${API}/api/auth/me/`, {
	method: 'PATCH',
	headers: auth(ola),
	body: JSON.stringify({ audience_filter: [] })
});

for (const audience of ['primary', 'secondary']) {
	const r = await fetch(`${API}/api/exercise-submissions/`, {
		method: 'POST',
		headers: auth(kasia),
		body: JSON.stringify({
			branch: 'analiza-matematyczna',
			payload: {
				title: `${MARKER} — ${audience}`,
				statement: 'Scratch row for the band chips; deleted at the end of this script.',
				difficulty: 'easy',
				audience,
				locale: 'en',
				// Not decoration: `mappers.ts`'s `mapSource` dereferences `source` unconditionally, so
				// an exercise created through the API with no source at all crashes the whole home tab
				// it appears in. The submit form always sends one (defaulting to "other"), so this
				// matches what a real submission looks like rather than papering over it.
				source: { type: 'exercises' }
			}
		})
	});
	const j = await r.json();
	check(
		`a published ${audience} exercise exists to narrow to`,
		r.status === 201 && j.status === 'approved' && !!j.resulting_exercise,
		JSON.stringify(j).slice(0, 200)
	);
}

// e2e trap 12 / §17AB: an anonymous list response is cached for 60 s and a write does NOT
// invalidate it, so the guest's very first browse below can be served the PREVIOUS run's list —
// rows that no longer exist, counted against an API answer that is current. Nothing in the API can
// flush it, so the honest fix is to wait the TTL out before the browser ever asks. Skip it with
// E2E_NO_CACHE_WAIT=1 when the backend runs with EDMAT_CACHE_ADMISSION_MIN set high enough that no
// list is ever seated.
if (!process.env.E2E_NO_CACHE_WAIT) {
	console.log('  … waiting out the 60 s anonymous read cache before opening the page');
	await new Promise((r) => setTimeout(r, 65000));
}

const browser = await chromium.launch(
	process.env.CHROME ? { executablePath: process.env.CHROME } : {}
);
const context = await browser.newContext({ viewport: { width: 1280, height: 1100 } });
// `baseLocale` is Polish, so a fresh context reads the Polish interface and every label assertion
// below would be asserting the wrong catalogue. The cookie is the language a person's own choice
// persists into (`lib/state/locale.svelte.ts`), and setting it is also what stops the first-visit
// geo hint from firing — trap 7: `/pl/...` is not a locale URL, so this is the only honest lever.
await context.addCookies([{ name: 'PARAGLIDE_LOCALE', value: 'en', url: BASE }]);
const page = await context.newPage();
page.on('console', (m) => {
	if (m.type() === 'error') errors.push(m.text());
});
page.on('pageerror', (e) => errors.push(e.message));
const settle = (ms = 2500) => page.waitForTimeout(ms);

// Every `/api/exercises/?…` URL the page asks for, in order — the exact-count assertions re-fetch
// the last one rather than guessing at the query string the client built.
const exerciseCalls = [];
page.on('request', (r) => {
	const u = r.url();
	if (u.includes('/api/exercises/?')) exerciseCalls.push(u);
});
const lastRecentCall = () => [...exerciseCalls].reverse().find((u) => u.includes('sort=recent'));

const radios = page.locator('[role="radiogroup"] [role="radio"]');
const checked = page.locator('[role="radiogroup"] [role="radio"][aria-checked="true"]');
const recentSection = page
	.locator('.panel .section')
	.filter({ has: page.getByRole('heading', { name: 'Recently added', exact: true }) });
const cards = recentSection.locator('.exercise-card');
const storedBands = () => page.evaluate(() => localStorage.getItem('edmat.audienceFilter'));
const clickChip = async (name) => {
	await page.locator('[role="radio"]', { hasText: name }).first().click();
	await settle();
};

// 1. A guest, unnarrowed.
await page.goto(`${BASE}/`, { waitUntil: 'load', timeout: 60000 });
await settle(4000);
check(
	'the chip row is a radiogroup',
	(await page.locator('[role="radiogroup"]').count()) === 1,
	String(await page.locator('[role="radiogroup"]').count())
);
check(
	'seven radios: Everything + six bands',
	(await radios.count()) === 7,
	String(await radios.count())
);
check('exactly one is checked to start', (await checked.count()) === 1);
check(
	'… and it is Everything',
	(await checked.first().innerText()).trim() === 'Everything',
	await checked.first().innerText()
);
await cards.first().waitFor({ timeout: 60000 });
const unfilteredCards = await cards.count();
check('the unfiltered Recently added list has cards', unfilteredCards > 0, String(unfilteredCards));

// 2. Primary: one chip checked, a one-element store, a narrowed request, matching badges.
await clickChip('Primary school');
check('exactly one chip is checked after picking a band', (await checked.count()) === 1);
check(
	'… and it is Primary school',
	(await checked.first().innerText()).trim() === 'Primary school',
	await checked.first().innerText()
);
check(
	'the store holds a ONE-element list',
	(await storedBands()) === '["primary"]',
	await storedBands()
);
const primaryCall = lastRecentCall();
check(
	'the exercises tab re-asked with the band',
	/[?&]audience=primary(&|$)/.test(primaryCall ?? ''),
	primaryCall
);
const apiPrimary = await (
	await fetch(primaryCall.replace(/^https?:\/\/[^/]+/, API), { headers: auth(kasia) })
).json();
const primaryCards = await cards.count();
check(
	'the list matches the API exactly for that band',
	primaryCards === apiPrimary.length && primaryCards > 0,
	`${primaryCards} cards vs ${apiPrimary.length} rows`
);
check(
	'every card is Primary school or Everyone',
	(await recentSection
		.locator('.exercise-card:has(.badge--primary), .exercise-card:has(.badge--all)')
		.count()) === primaryCards
);
check(
	'no University card survives the narrowing',
	(await recentSection.locator('.exercise-card .badge--university').count()) === 0
);
check('the narrowed list is shorter than the unfiltered one', primaryCards < unfilteredCards);

// 3. Secondary: the first choice is dropped, not added to.
await clickChip('Secondary school');
check('still exactly one chip checked', (await checked.count()) === 1);
check(
	'Primary is no longer checked, Secondary is',
	(await checked.first().innerText()).trim() === 'Secondary school',
	await checked.first().innerText()
);
check('the store swapped bands', (await storedBands()) === '["secondary"]', await storedBands());
const secondaryCall = lastRecentCall();
check(
	'the request carries the new band only',
	/[?&]audience=secondary(&|$)/.test(secondaryCall ?? ''),
	secondaryCall
);
const apiSecondary = await (
	await fetch(secondaryCall.replace(/^https?:\/\/[^/]+/, API), { headers: auth(kasia) })
).json();
const secondaryCards = await cards.count();
check(
	'the list changed and matches the API',
	secondaryCards === apiSecondary.length && secondaryCards > 0,
	`${secondaryCards} cards vs ${apiSecondary.length} rows`
);
check(
	'every card is Secondary school or Everyone',
	(await recentSection
		.locator('.exercise-card:has(.badge--secondary), .exercise-card:has(.badge--all)')
		.count()) === secondaryCards
);
check(
	'the primary scratch exercise is gone from the list',
	(await recentSection.locator('.exercise-card .badge--primary').count()) === 0
);
await page.screenshot({ path: 'e2e/screenshots/audience-radio-desktop.png', fullPage: false });

// 4. Clicking the CHECKED chip again does not clear it — a radio does not untick itself; the
//    Everything chip is the one way back (and that is the documented choice).
await clickChip('Secondary school');
check(
	're-clicking the checked chip keeps it checked',
	(await checked.count()) === 1 && (await storedBands()) === '["secondary"]',
	await storedBands()
);

// 5. Everything: back to an unnarrowed site.
await clickChip('Everything');
check('Everything is checked', (await checked.first().innerText()).trim() === 'Everything');
check('the store is empty again', (await storedBands()) === '[]', await storedBands());
check(
	'the request drops the band',
	!/[?&]audience=/.test(lastRecentCall() ?? ''),
	lastRecentCall()
);
check(
	'the full list is back',
	(await cards.count()) === unfilteredCards,
	`${await cards.count()} vs ${unfilteredCards}`
);

// 6. Keyboard: arrow keys move the selection, as in any radio group.
await page.locator('[role="radio"]', { hasText: 'Everything' }).first().focus();
await page.keyboard.press('ArrowRight');
await settle(1200);
check(
	'ArrowRight selects the next band',
	(await checked.first().innerText()).trim() === 'Early years' &&
		(await storedBands()) === '["early_years"]',
	await storedBands()
);
check(
	'focus follows the selection',
	await checked.first().evaluate((el) => el === document.activeElement)
);
await page.keyboard.press('ArrowRight');
await settle(1200);
check('ArrowRight again moves on', (await storedBands()) === '["primary"]', await storedBands());
await page.keyboard.press('ArrowLeft');
await settle(1200);
check('ArrowLeft goes back', (await storedBands()) === '["early_years"]', await storedBands());
await page.keyboard.press('Home');
await settle(1500);
check(
	'Home returns to Everything',
	(await checked.first().innerText()).trim() === 'Everything' && (await storedBands()) === '[]',
	await storedBands()
);
check('only ever one checked radio', (await checked.count()) === 1);

// 7. Phone width — the row wraps rather than scrolling the page sideways.
await page.setViewportSize({ width: 390, height: 844 });
await settle(1500);
check(
	'no horizontal page scroll at 390px',
	await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1),
	await page.evaluate(() => `${document.documentElement.scrollWidth} > ${window.innerWidth}`)
);
await page.screenshot({ path: 'e2e/screenshots/audience-radio-phone.png', fullPage: false });
await page.setViewportSize({ width: 1280, height: 1100 });

// 8. A profile pinned to TWO bands in Settings: the row says so instead of pretending.
await fetch(`${API}/api/auth/me/`, {
	method: 'PATCH',
	headers: auth(ola),
	body: JSON.stringify({ audience_filter: ['early_years', 'primary'] })
});
await page.goto(`${BASE}/login`, { waitUntil: 'load', timeout: 60000 });
await settle(2000);
await page.locator('form input[autocomplete="username"]').fill('ola@edmat.example');
await page.locator('form input[type="password"]').fill('password123');
await page.locator('form button[type="submit"]').click();
await page.waitForURL((u) => !u.pathname.includes('/login'), { timeout: 15000 });
await page.goto(`${BASE}/`, { waitUntil: 'load', timeout: 60000 });
await settle(4000);
check(
	'two pinned bands leave NO chip checked',
	(await checked.count()) === 0,
	String(await checked.count())
);
check(
	'… and the row says where they were set',
	(await page.locator('.chips__hint').innerText()).includes('2'),
	await page.locator('.chips__hint').innerText()
);
await page.screenshot({ path: 'e2e/screenshots/audience-radio-two-bands.png', fullPage: false });

// A click from that state collapses the pin to the one band clicked, and persists it.
await clickChip('Primary school');
const me = await (await fetch(`${API}/api/auth/me/`, { headers: auth(ola) })).json();
check(
	'a signed-in click saves ONE band on the profile',
	JSON.stringify(me.audience_filter) === '["primary"]',
	JSON.stringify(me.audience_filter)
);
check(
	'the hint is gone once one band is chosen',
	(await page.locator('.chips__hint').count()) === 0
);

// Cleanup.
await dropScratch();
await fetch(`${API}/api/auth/me/`, {
	method: 'PATCH',
	headers: auth(ola),
	body: JSON.stringify({ audience_filter: [] })
});
const gone = (await mine()).every((ex) => !isScratch(ex.title));
check('scratch exercises removed', gone);
const restored = await (await fetch(`${API}/api/auth/me/`, { headers: auth(ola) })).json();
check(
	'ola’s filter restored',
	JSON.stringify(restored.audience_filter) === '[]',
	JSON.stringify(restored.audience_filter)
);
check('zero console/page errors', errors.length === 0, errors.join(' | ').slice(0, 400));
await browser.close();
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
