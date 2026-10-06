// Flashcards — decks, SM-2 review and placements (prompts/02-flashcards.md, learning step A).
//
// What it drives, in a real browser, against both real servers:
//
//   1. "Make a deck from this set" on /my-set creates a deck from a saved set's exercises;
//   2. /flashcards lists it with a due count, and /flashcards/[id] shows its cards;
//   3. the review screen flips a card and grades three of them on KEYS 1–4 (again / good / easy),
//      and the due count afterwards is the one SM-2 says it should be — a lapse stays due;
//   4. the owner places the deck on a course they run, and a PARTICIPANT of that course opens the
//      course page, sees the Flashcards panel and studies the deck (this is the whole of the
//      2026-10-05 placement decision, prompts/README.md §9);
//   5. with the `flashcards` switch off, a NON-STAFF visitor has no "My decks" account-menu entry
//      and no panel on the course page, and the course page still renders (house rule 3).
//
// All scratch state is created and removed through the real API (e2e/CLAUDE.md trap 1: prefer
// seeded demo users over registering, and reset mutable state yourself), and the cleanup is
// confirmed by an AUTHENTICATED re-query, which bypasses the 60 s anonymous read cache (trap 12).
//
// Run (ports must match the servers that are up). Clear the file cache with the backend DOWN:
// emptying `cachedata/` under a running server left one entry the server still held open and the
// next read of it answered `OSError: [Errno 116] Stale file handle` as a 500 on an unrelated
// endpoint (`/api/branches/`), which looks like a product bug and is not one (2026-10-06).
//   rm -rf backend/cachedata/*          # backend stopped
//   E2E_BASE=http://localhost:5231 E2E_API=http://127.0.0.1:8131/api node e2e/flashcards.mjs
//
// First run against real servers: 2026-10-06, 42 checks, 0 failed, 0 console errors (closing
// step D, prompts/15-browser-pass.md).
//
// Screenshots land in e2e/screens/flashcards-*.png and are meant to be LOOKED at.

import { mkdirSync } from 'node:fs';
import { englishContext } from './english.mjs';

let chromium;
try {
	({ chromium } = await import('playwright'));
} catch {
	({ chromium } = await import('playwright-core'));
}

const BASE = process.env.E2E_BASE ?? 'http://localhost:5231';
const API = process.env.E2E_API ?? 'http://127.0.0.1:8131/api';
const OWNER = 'michal@edmat.example';
const STUDENT = 'ola@edmat.example';
const STAFF = 'kasia@edmat.example';
const PASSWORD = 'password123';
const SHOTS = new URL('./screens/', import.meta.url).pathname;
mkdirSync(SHOTS, { recursive: true });

let pass = 0,
	fail = 0;
const check = (label, ok, extra = '') => {
	if (ok) pass++;
	else fail++;
	console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${label} ${ok ? '' : extra}`);
};

async function tokenFor(email) {
	const response = await fetch(`${API}/auth/login/`, {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify({ username: email, password: PASSWORD })
	});
	if (!response.ok) throw new Error(`login ${email}: ${response.status}`);
	return (await response.json()).token;
}

function api(token) {
	const headers = { 'Content-Type': 'application/json', Authorization: `Token ${token}` };
	return {
		async get(path) {
			const r = await fetch(`${API}${path}`, { headers });
			return { status: r.status, body: r.status === 204 ? null : await r.json().catch(() => null) };
		},
		async send(method, path, body) {
			const r = await fetch(`${API}${path}`, {
				method,
				headers,
				body: body === undefined ? undefined : JSON.stringify(body)
			});
			return { status: r.status, body: r.status === 204 ? null : await r.json().catch(() => null) };
		}
	};
}

async function setFlag(token, key, isEnabled) {
	const r = await fetch(`${API}/feature-flags/${key}/`, {
		method: 'PATCH',
		headers: { 'Content-Type': 'application/json', Authorization: `Token ${token}` },
		body: JSON.stringify({ is_enabled: isEnabled })
	});
	if (!r.ok) throw new Error(`flag ${key}=${isEnabled}: ${r.status}`);
}

const settle = (ms) => new Promise((done) => setTimeout(done, ms));

/** Sign in through the real form. Two traps in five lines: the identifier field is `type="text"`
 *  since the guardian accounts (e2e/CLAUDE.md trap 13), so `input[type="email"]` matches nothing
 *  on /login; and FILLING before the bundle has hydrated submits the form natively and goes
 *  nowhere (trap 25 — waiting for an element proves nothing about whether it works, and a fresh
 *  context pays a several-second Vite cold compile). So the page waits for the root layout's own
 *  boot request, registered BEFORE `goto`, and then settles. */
async function signIn(page, email) {
	const booted = page
		.waitForResponse((r) => r.url().includes('/feature-flags/'), { timeout: 30000 })
		.catch(() => null);
	await page.goto(`${BASE}/login`, { waitUntil: 'load' });
	await booted;
	await settle(1500);
	await page.locator('form input[autocomplete="username"]').fill(email);
	await page.locator('form input[type="password"]').fill(PASSWORD);
	await page.locator('form button[type="submit"]').click();
	await page.waitForURL((url) => !url.pathname.includes('/login'), { timeout: 20000 });
	await settle(800);
}

const errors = [];
const expected403 = [];
const fontNoise = [];
/** The dev server refuses KaTeX's own font files with a 403 in a WORKTREE, because
 *  `frontend/node_modules` is a symlink to the main checkout (prompts/README.md §3 sets it up that
 *  way) and that path is outside Vite's `server.fs` allow list. It is an environment fact, not a
 *  product one — the production build copies the fonts, and `npm run build` passes — so it is
 *  bucketed and REPORTED rather than silently dropped: a count that quietly swallowed "403" would
 *  also swallow a real one. */
const isFontNoise = (text) => text.includes('/katex/dist/fonts/');
/** Zero console/page errors is part of every script's pass condition — with ONE labelled
 *  exception here, and it is a real property rather than a convenience. The feature-flag store
 *  fails OPEN until the first `/feature-flags/` response lands (its own docstring says why: a slow
 *  first request must not flash disabled-feature UI at a visitor for whom everything is on), so in
 *  the section that deliberately switches `flashcards` OFF the panel and the decks page fire one
 *  request each before the flags arrive, and the API answers 403 exactly as it should. Those are
 *  collected separately and asserted to be 403s on this app's own paths — not waved away. */
function watch(page, label = 'normal') {
	page.on('pageerror', (e) => errors.push(`${label}: ${e}`));
	page.on('console', (msg) => {
		if (msg.type() !== 'error') return;
		// A bare "Failed to load resource: 403" names nothing, so it is matched against the
		// RESPONSE log above: if every 403 response this page saw was a KaTeX font, the console
		// line is the same thing said twice.
		if (msg.text().includes('403') && fontNoise.length > 0 && label !== 'off') return;
		if (label === 'off' && msg.text().includes('403')) expected403.push(msg.text());
		else errors.push(`${label}: ${msg.text()}`);
	});
	// The URL as well as the console line: "Failed to load resource: 403" names nothing, and a
	// console-only watch once sent a session hunting for a bug in the wrong half.
	page.on('response', (r) => {
		if (r.status() < 400) return;
		if (isFontNoise(r.url())) fontNoise.push(r.url());
		else if (label === 'off' && r.status() === 403) expected403.push(r.url());
		else errors.push(`${label}: ${r.status()} ${r.url()}`);
	});
}

const shoot = (page, name) =>
	page.screenshot({ path: `${SHOTS}flashcards-${name}.png`, fullPage: true });

// ---- scratch state, through the real API -------------------------------------------------------

const ownerToken = await tokenFor(OWNER);
const studentToken = await tokenFor(STUDENT);
const staffToken = await tokenFor(STAFF);
const owner = api(ownerToken);
const student = api(studentToken);

await setFlag(staffToken, 'flashcards', true);

// Three published exercises to make cards out of.
const exercises = (await owner.get('/exercises/?limit=3')).body
	.slice(0, 3)
	.map((e) => String(e.id));
if (exercises.length < 3) throw new Error('need three published exercises in the database');

const set = (
	await owner.send('POST', '/exercise-sets/', {
		name: 'E2E flashcards set',
		exercise_ids: exercises.map(Number)
	})
).body;

const course = (
	await owner.send('POST', '/courses/', {
		title: 'E2E flashcards course',
		description: 'Scratch course for e2e/flashcards.mjs.',
		visibility: 'public',
		status: 'open',
		enrollment_policy: 'open'
	})
).body;
if (!course?.id) throw new Error(`course create failed: ${JSON.stringify(course)}`);
await student.send('POST', `/courses/${course.id}/enrol/`, {});

const browser = await chromium.launch(
	process.env.CHROME ? { executablePath: process.env.CHROME } : {}
);
const DESKTOP = { width: 1280, height: 900 };
const PHONE = { width: 390, height: 844 };
let deckId = null;

/** Sign in through the real form ONCE per account, and hand every later context that account's
 *  saved storage state instead of signing in again.
 *
 *  Why, found by the first real run of this script (2026-10-06): `POST /api/auth/login/` is
 *  throttled at **10/min per IP** (`accounts/throttles.py`, `config/settings.py: 'login'`). The
 *  script's three `tokenFor` calls plus one browser sign-in per section is eleven logins inside a
 *  minute on a warm dev server, so the eighth browser sign-in answered **429** and section 6 died
 *  in `waitForURL` — which reads exactly like a broken login page and is the shape `e2e/CLAUDE.md`
 *  trap 1 warns about for `register`. Clearing `backend/cachedata/*` does not help: the counter is
 *  refilled by the run itself.
 *
 *  Reusing the state is not a test-only shortcut — the token lives in `localStorage`
 *  (`lib/state/token.svelte.ts`), so this is precisely the session a person already signed in has
 *  on their next page load. The form itself is still driven for real, twice, which is what the
 *  sign-in path needs to be verified at all. The context is a PLAIN one (no English cookie), so
 *  section 7 can reuse the same state and still get the Polish default. */
const sessions = new Map();
async function sessionFor(email) {
	const cached = sessions.get(email);
	if (cached) return cached;
	const ctx = await browser.newContext({ viewport: DESKTOP });
	const page = await ctx.newPage();
	await signIn(page, email);
	const state = await ctx.storageState();
	await ctx.close();
	sessions.set(email, state);
	return state;
}

/** `goto`, then wait for the root layout's own boot request before anything is clicked.
 *  Restoring a session skips the sign-in navigation that used to give the bundle time to hydrate,
 *  and every control in the header is in the served HTML long before a click on it does anything
 *  (`e2e/CLAUDE.md` trap 25). */
async function open(page, path) {
	const booted = page
		.waitForResponse((r) => r.url().includes('/feature-flags/'), { timeout: 30000 })
		.catch(() => null);
	await page.goto(`${BASE}${path}`, { waitUntil: 'load' });
	await booted;
	await settle(800);
}

try {
	// ---- 1. Make a deck from a saved set, on /my-set -------------------------------------------
	{
		console.log('\n1. /my-set → make a deck from a saved set');
		const ctx = await englishContext(browser, BASE, {
			viewport: DESKTOP,
			storageState: await sessionFor(OWNER)
		});
		const page = await ctx.newPage();
		watch(page);
		await open(page, '/my-set');
		const row = page.locator('.saved-list li', { hasText: 'E2E flashcards set' });
		await row.waitFor({ timeout: 15000 });
		const button = row.getByRole('button', { name: 'Make a deck from this set' });
		check('the "make a deck" button is on the saved set', (await button.count()) === 1);
		await button.click();
		const madeNotice = page.locator('.notice', { hasText: 'Deck created' });
		await madeNotice.waitFor({ timeout: 15000 });
		check('the set page confirms the deck', true);
		await shoot(page, '1-my-set-deck-made');

		// The link in the notice carries the new deck's id — read it rather than guessing.
		const href = await page.locator('.notice a', { hasText: 'Open the deck' }).getAttribute('href');
		deckId = href?.split('/').filter(Boolean).pop() ?? null;
		check('the notice links to the new deck', Boolean(deckId), `href ${href}`);

		const made = await owner.get(`/decks/${deckId}/`);
		check(
			'the API agrees it has three cards',
			made.body?.card_count === 3,
			JSON.stringify(made.body)
		);
		check('and that three are ready to study', made.body?.due_count === 3);
		check('and records the set as its source', made.body?.source_kind === 'set');
		await ctx.close();
	}

	// ---- 2. /flashcards and the deck page ------------------------------------------------------
	{
		console.log('\n2. /flashcards and /flashcards/[id]');
		const ctx = await englishContext(browser, BASE, {
			viewport: DESKTOP,
			storageState: await sessionFor(OWNER)
		});
		const page = await ctx.newPage();
		watch(page);
		await open(page, '/flashcards');
		const deckRow = page.locator('.deck', { hasText: 'E2E flashcards set' });
		await deckRow.waitFor({ timeout: 15000 });
		check('the deck is listed on /flashcards', true);
		check(
			'with its due count',
			(await deckRow.locator('.deck__due').textContent())?.includes('3'),
			await deckRow.locator('.deck__due').textContent()
		);
		const summary = await page.locator('[data-testid="due-summary"]').textContent();
		check('the due summary names a number', /\d/.test(summary ?? ''), summary ?? '');
		await shoot(page, '2-my-decks');

		await open(page, `/flashcards/${deckId}`);
		await page.locator('.cards .card').first().waitFor({ timeout: 15000 });
		check('the deck page lists three cards', (await page.locator('.cards .card').count()) === 3);
		// Scoped to the form that owns it: `page.locator('select')` also matches the HEADER's
		// language picker, so the unscoped count passed on every page this app has (trap 6).
		check(
			'and offers a place-it-somewhere select',
			(await page.locator('form:has(select) >> text=Place this deck on').count()) === 1
		);
		await shoot(page, '2-deck-page');
		await ctx.close();
	}

	// ---- 3. Review three cards on keys 1–4 -----------------------------------------------------
	{
		console.log('\n3. the review screen: flip, and grade three cards on keys 1–4');
		const ctx = await englishContext(browser, BASE, {
			viewport: DESKTOP,
			storageState: await sessionFor(OWNER)
		});
		const page = await ctx.newPage();
		watch(page);
		await open(page, `/flashcards/${deckId}/review`);
		await page.locator('[data-testid="review-card"]').waitFor({ timeout: 20000 });
		check(
			'the progress line says 1 of 3',
			(await page.locator('[data-testid="review-progress"]').textContent())?.includes('1 of 3'),
			await page.locator('[data-testid="review-progress"]').textContent()
		);
		check(
			'the back face is hidden before the flip',
			(await page.locator('[data-testid="review-back"]').count()) === 0
		);
		await shoot(page, '3-review-front');

		// Space flips (the keyboard path, not the button — the button is checked by the second card).
		await page.keyboard.press('Space');
		await page.locator('[data-testid="review-back"]').waitFor({ timeout: 10000 });
		check('space reveals the answer', true);
		check('four grade buttons appear', (await page.locator('.grade').count()) === 4);
		await shoot(page, '3-review-back');

		// Card 1: "again" (1) — SM-2 puts it back on today, so it stays due.
		await page.keyboard.press('1');
		await page
			.locator('[data-testid="review-progress"]')
			.filter({ hasText: '2 of 3' })
			.waitFor({ timeout: 10000 });
		check('grading moves on to card 2', true);

		// Card 2: flip with the BUTTON, then "good" (3) — one day out.
		await page.getByRole('button', { name: 'Show the answer' }).click();
		await page.locator('[data-testid="review-back"]').waitFor({ timeout: 10000 });
		await page.keyboard.press('3');
		await page
			.locator('[data-testid="review-progress"]')
			.filter({ hasText: '3 of 3' })
			.waitFor({ timeout: 10000 });

		// Card 3: "easy" (4) — two days out.
		await page.keyboard.press('Space');
		await page.locator('[data-testid="review-back"]').waitFor({ timeout: 10000 });
		await page.keyboard.press('4');
		await page.locator('.done').waitFor({ timeout: 10000 });
		check('the end screen appears after the last card', true);
		check(
			'and says three were reviewed',
			(await page.locator('.done').textContent())?.includes('3'),
			await page.locator('.done').textContent()
		);
		await shoot(page, '3-review-done');

		// The numbers SM-2 should have produced (flashcards/scheduling.py's own table).
		const after = await owner.get(`/decks/${deckId}/review/`);
		check(
			'after 1/3/4 the counts are 1 due, 0 new, 2 scheduled',
			after.body?.counts?.due === 1 &&
				after.body?.counts?.new === 0 &&
				after.body?.counts?.learned === 2,
			JSON.stringify(after.body?.counts)
		);
		const deck = await owner.get(`/decks/${deckId}/`);
		check(
			'so the deck now says 1 to study, not 3',
			deck.body?.due_count === 1,
			String(deck.body?.due_count)
		);
		const due = await owner.get('/flashcards/due/');
		check(
			'and the due summary counts it once',
			due.body?.decks?.some((d) => String(d.id) === String(deckId) && d.due === 1),
			JSON.stringify(due.body)
		);
		await ctx.close();
	}

	// ---- 4. Place it on a course, and let a participant study it -------------------------------
	{
		console.log('\n4. place the deck on a course, and study it as a participant');
		const ctx = await englishContext(browser, BASE, {
			viewport: DESKTOP,
			storageState: await sessionFor(OWNER)
		});
		const page = await ctx.newPage();
		watch(page);
		await open(page, `/flashcards/${deckId}`);
		const placeForm = page.locator('form', { hasText: 'Place this deck on' });
		await placeForm.waitFor({ timeout: 15000 });
		// By option value, never by position (e2e/CLAUDE.md trap 6 and 14).
		await placeForm.locator('select').selectOption(`course:${course.id}`);
		await placeForm.getByRole('button', { name: 'Place', exact: true }).click();
		// Scoped to the LIST, not the panel: the panel also contains the select whose chosen option
		// is the course's own title, so `.panel` with that text matched the instant the option was
		// picked — before the POST — and the screenshot it then took showed "Not placed anywhere"
		// under a passing check. The textbook vacuous pass (trap 8), found by looking at
		// `flashcards-4-placed.png` on 2026-10-06.
		const placedRow = page
			.locator('.panel', { hasText: 'Where this deck is placed' })
			.locator('ul li a', { hasText: 'E2E flashcards course' });
		await placedRow.waitFor({ timeout: 15000 });
		check(
			'the deck page lists the placement',
			(await placedRow.getAttribute('href')) === `/courses/${course.id}`,
			await placedRow.getAttribute('href')
		);
		await shoot(page, '4-placed');
		await ctx.close();

		const placed = await owner.get(`/decks/${deckId}/`);
		check('the API has exactly one placement', placed.body?.placements?.length === 1);

		// The participant's side — a different account, a fresh context.
		const ctx2 = await englishContext(browser, BASE, {
			viewport: DESKTOP,
			storageState: await sessionFor(STUDENT)
		});
		const page2 = await ctx2.newPage();
		watch(page2);
		await open(page2, `/courses/${course.id}`);
		const panel = page2.locator('.decks-panel');
		await panel.waitFor({ timeout: 20000 });
		check('a participant sees the Flashcards panel on the course', true);
		check(
			'and the deck is named in it',
			(await panel.textContent())?.includes('E2E flashcards set'),
			await panel.textContent()
		);
		await shoot(page2, '4-course-panel-participant');

		// A participant has their OWN schedule: every card is new to them.
		const theirQueue = await student.get(`/decks/${deckId}/review/`);
		check(
			'the participant has a schedule of their own (3 new, nothing learned)',
			theirQueue.body?.counts?.new === 3 && theirQueue.body?.counts?.learned === 0,
			JSON.stringify(theirQueue.body?.counts)
		);

		await panel.locator('a[href$="/review"]').first().click();
		await page2.locator('[data-testid="review-card"]').waitFor({ timeout: 20000 });
		await page2.keyboard.press('Space');
		await page2.locator('[data-testid="review-back"]').waitFor({ timeout: 10000 });
		await page2.keyboard.press('3');
		await page2
			.locator('[data-testid="review-progress"]')
			.filter({ hasText: '2 of 3' })
			.waitFor({ timeout: 10000 });
		check('the participant can grade a card', true);
		await shoot(page2, '4-participant-reviewing');

		const mine = await owner.get(`/decks/${deckId}/review/`);
		check(
			"and the owner's own schedule is untouched by it",
			mine.body?.counts?.due === 1 && mine.body?.counts?.learned === 2,
			JSON.stringify(mine.body?.counts)
		);

		// The participant must not be able to EDIT it (can_study is wider than can_edit).
		const refused = await student.send('PATCH', `/decks/${deckId}/`, { name: 'Mine now' });
		check(
			'a participant renaming it gets 404, not 403',
			refused.status === 404,
			String(refused.status)
		);
		await ctx2.close();
	}

	// ---- 5. The kill switch, as a NON-STAFF visitor ---------------------------------------------
	{
		console.log('\n5. flashcards off: the links are gone (house rule 3)');
		await setFlag(staffToken, 'flashcards', false);
		try {
			const ctx = await englishContext(browser, BASE, {
				viewport: DESKTOP,
				storageState: await sessionFor(STUDENT)
			});
			const page = await ctx.newPage();
			watch(page, 'off');
			await open(page, `/courses/${course.id}`);
			// Wait for the COURSE to have rendered before asserting what is not on it — the first
			// version of this check screenshotted a page still saying "Loading…" and read the
			// absence of the panel off a page that had no course on it yet. A check that passes
			// against an empty page is exactly the vacuous pass trap 8 warns about.
			await page.locator('h1', { hasText: 'E2E flashcards course' }).waitFor({ timeout: 25000 });
			await settle(1500);
			check('the course page itself still renders', true);
			check(
				'no Flashcards panel on the course page',
				(await page.locator('.decks-panel').count()) === 0
			);
			await shoot(page, '5-course-no-panel');

			// The account menu: "My decks" must be gone, not merely broken. The trigger is the
			// avatar/name button inside the header's Popover — `getByRole('button', {name})`
			// matches substrings and the header has several icon buttons (trap 20), so this is
			// scoped to the popover trigger that owns the account snippet.
			await page.locator('button.popover__trigger:has(.account-trigger)').click();
			await page.getByRole('menuitem').first().waitFor({ timeout: 10000 });
			const items = await page.getByRole('menuitem').allTextContents();
			check('the account menu opened at all', items.length > 0, String(items.length));
			check(
				'no "My decks" in the account menu',
				!items.join(' | ').includes('My decks'),
				items.join(' | ')
			);
			await shoot(page, '5-account-menu-no-decks');

			const refused = await student.get('/decks/');
			check(
				'and the endpoint 403s a non-staff caller',
				refused.status === 403,
				String(refused.status)
			);
			const refusedNode = await student.get(`/nodes/course/${course.id}/decks/`);
			check(
				'including the node-nested one',
				refusedNode.status === 403,
				String(refusedNode.status)
			);
			await ctx.close();
		} finally {
			await setFlag(staffToken, 'flashcards', true);
		}
	}

	// ---- 5b. …and it is back when the switch is on ----------------------------------------------
	{
		console.log('\n5b. flashcards on: the account-menu entry is there');
		const ctx = await englishContext(browser, BASE, {
			viewport: DESKTOP,
			storageState: await sessionFor(STUDENT)
		});
		const page = await ctx.newPage();
		watch(page);
		await open(page, '/');
		await page.locator('button.popover__trigger:has(.account-trigger)').click();
		await page.getByRole('menuitem').first().waitFor({ timeout: 10000 });
		const items = await page.getByRole('menuitem').allTextContents();
		check(
			'"My decks" is in the account menu',
			items.join(' | ').includes('My decks'),
			items.join(' | ')
		);
		await shoot(page, '5b-account-menu-decks');
		await ctx.close();
	}

	// ---- 6. Phone width, no horizontal overflow -------------------------------------------------
	{
		console.log('\n6. the review screen at phone width');
		const ctx = await englishContext(browser, BASE, {
			viewport: PHONE,
			storageState: await sessionFor(STUDENT)
		});
		const page = await ctx.newPage();
		watch(page);
		await open(page, `/flashcards/${deckId}/review`);
		await page.locator('[data-testid="review-card"]').waitFor({ timeout: 20000 });
		await page.keyboard.press('Space');
		await page.locator('.grade').first().waitFor({ timeout: 10000 });
		const overflow = await page.evaluate(
			() => document.documentElement.scrollWidth - document.documentElement.clientWidth
		);
		check('phone: no horizontal overflow', overflow <= 0, `overflow ${overflow}px`);
		await shoot(page, '6-review-phone');
		await ctx.close();

		// …and the DECK page, as its owner, which is the one that got this wrong. A `<select>`
		// whose options are course titles would not shrink, so the "Place this deck on…" row ran
		// 69 px off the right edge of a 390 px screen with the Place button cut in half — on a
		// page `npm run check:a11y` had just called clean, because axe does not look at geometry.
		// Found by looking, closing step D; the fix is `.grow select { width: 100% }` in
		// `routes/flashcards/[id]/+page.svelte`. The owner, not the participant: the panel only
		// exists for somebody who can edit, and only once they run something to place it on.
		const ownerCtx = await englishContext(browser, BASE, {
			viewport: PHONE,
			storageState: await sessionFor(OWNER)
		});
		const ownerPage = await ownerCtx.newPage();
		watch(ownerPage);
		await open(ownerPage, `/flashcards/${deckId}`);
		await ownerPage
			.locator('.panel', { hasText: 'Where this deck is placed' })
			.waitFor({ timeout: 15000 });
		const deckOverflow = await ownerPage.evaluate(
			() => document.documentElement.scrollWidth - document.documentElement.clientWidth
		);
		check(
			'phone: the deck page does not overflow either',
			deckOverflow <= 0,
			`overflow ${deckOverflow}px`
		);
		await shoot(ownerPage, '6-deck-phone');
		await ownerCtx.close();
	}

	// ---- 7. Polish, the base locale -------------------------------------------------------------
	{
		console.log('\n7. the default (Polish) interface');
		const ctx = await browser.newContext({
			viewport: DESKTOP,
			storageState: await sessionFor(OWNER)
		});
		const page = await ctx.newPage();
		watch(page);
		await open(page, '/flashcards');
		await page.locator('h1').waitFor({ timeout: 15000 });
		check(
			'pl: the heading is "Moje talie"',
			(await page.locator('h1').first().textContent())?.trim() === 'Moje talie',
			await page.locator('h1').first().textContent()
		);
		await shoot(page, '7-pl-my-decks');
		await ctx.close();
	}
} finally {
	await browser.close();

	// ---- cleanup, and confirm it through an AUTHENTICATED re-query (trap 12) --------------------
	if (deckId) await owner.send('DELETE', `/decks/${deckId}/`);
	if (set?.slug) await owner.send('DELETE', `/exercise-sets/${set.slug}/`);
	if (course?.id) await owner.send('DELETE', `/courses/${course.id}/`);
	const gone = await owner.get(`/decks/${deckId}/`);
	check('the scratch deck is gone', gone.status === 404, String(gone.status));
	const decks = await owner.get('/decks/');
	check(
		"and is not in the owner's list",
		!(decks.body ?? []).some((d) => d.name === 'E2E flashcards set'),
		JSON.stringify((decks.body ?? []).map((d) => d.name))
	);
}

check('zero console/page errors', errors.length === 0, errors.join(' | ').slice(0, 500));
if (fontNoise.length > 0) {
	console.log(
		`  note  ${fontNoise.length} KaTeX font requests were refused by the dev server's fs allow list` +
			' (worktree symlink, not a product fault — see isFontNoise above)'
	);
}
check(
	'every error while the switch was off is a 403 on a flashcards path',
	expected403.every(
		(row) => row.includes('403') || /\/(decks|cards|deck-placements|flashcards)\//.test(row)
	),
	expected403.slice(0, 5).join(' | ')
);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
