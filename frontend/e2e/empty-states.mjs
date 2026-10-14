// Empty states that offer a next step (`lib/components/shared/EmptyState.svelte`, 2026-10-14).
//
// What it checks, in BOTH interface languages (English through `english.mjs`, Polish as the
// default a fresh context gets):
//
//   1. Honestly empty pages — a freshly registered account has no set, no tasks, no messages, no
//      decks, hosts no event, runs no contest, belongs to no organisation, has no tutoring listing
//      and follows nothing — each draw the empty state with ITS sentence (compared with the
//      catalogue, so a key missing from one language fails here), not "Nothing here yet".
//   2. The creation gate: on the four hubs whose next step is founding something, the button is
//      drawn exactly when `GET /api/creation/` says this account may (a fresh account is unverified,
//      and `creation_requires_verification` is on in the dev database, so it is normally ABSENT —
//      which is the point: never a button that answers 403).
//   3. A filter that matches nothing says "nothing matches" and offers "Clear filters", never a
//      create button, and clearing really clears (the URL or the inputs).
//   4. The in-page actions do what they say (events → "see what is coming up", activity → "show
//      everything").
//   5. Every next-step link any empty state drew resolves: a manual chapter that exists (not the
//      "no chapter under that address" line) or a page with a real heading (not a 404).
//
// Screenshots of each state at 1280 (light, and dark for a few) and 390 go to
// `e2e/screenshots/empty-*.png` — LOOK at them; that is half of this script's job.
//
//   E2E_BASE=http://localhost:5198 E2E_API=http://127.0.0.1:8048 CHROME=<chrome-headless-shell> \
//     node e2e/empty-states.mjs
//
// It registers ONE throwaway account (the register throttle is ~10/hour per IP, trap 1) and
// schedules it for deletion at the end through the real self-service erasure endpoint.
import { readFileSync, mkdirSync } from 'node:fs';
let chromium;
try {
	({ chromium } = await import('playwright'));
} catch {
	({ chromium } = await import('playwright-core'));
}
import { englishContext } from './english.mjs';

const BASE = process.env.E2E_BASE ?? 'http://localhost:5173';
const API = process.env.E2E_API ?? 'http://localhost:8000';
const SHOTS = 'e2e/screenshots';
mkdirSync(SHOTS, { recursive: true });

const CATALOGUE = {
	en: JSON.parse(readFileSync(new URL('../messages/en.json', import.meta.url), 'utf8')),
	pl: JSON.parse(readFileSync(new URL('../messages/pl.json', import.meta.url), 'utf8'))
};

let pass = 0,
	fail = 0;
const errors = [];
const check = (label, ok, extra = '') => {
	if (ok) pass++;
	else fail++;
	console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${label} ${ok ? '' : extra}`);
};

const json = (t) => ({
	'Content-Type': 'application/json',
	...(t ? { Authorization: `Token ${t}` } : {})
});
const post = async (path, body, token) => {
	const r = await fetch(`${API}${path}`, {
		method: 'POST',
		headers: json(token),
		body: JSON.stringify(body)
	});
	return { status: r.status, body: await r.json().catch(() => null) };
};
const get = async (path, token) => {
	const r = await fetch(`${API}${path}`, { headers: json(token) });
	return { status: r.status, body: await r.json().catch(() => null) };
};

// ---- setup: one fresh account --------------------------------------------------------------------
// `E2E_EMPTY_USER` + `E2E_EMPTY_TOKEN` reuse an account an earlier run registered (and kept with
// `E2E_KEEP=1`), so a re-run does not spend the register throttle again. It must still be empty.
const stamp = Date.now() % 1000000;
const PASSWORD = 'empty-states-e2e-Passw0rd!';
let USERNAME = process.env.E2E_EMPTY_USER ?? '';
let TOKEN = process.env.E2E_EMPTY_TOKEN ?? '';
if (!USERNAME || !TOKEN) {
	USERNAME = `e2e-empty-${stamp}`;
	const reg = await post('/api/auth/register/', {
		username: USERNAME,
		email: `${USERNAME}@example.org`,
		password: PASSWORD,
		display_name: `Empty States ${stamp}`,
		preferred_locale: 'en',
		birth_year: 1995,
		accept_terms: true
	});
	if (reg.status !== 201) {
		console.log(`register failed: ${reg.status} ${JSON.stringify(reg.body)}`);
		process.exit(1);
	}
	TOKEN = reg.body.token;
}
const creation = (await get('/api/creation/', TOKEN)).body ?? {};
const flags = Object.fromEntries(
	((await get('/api/feature-flags/')).body ?? []).map((f) => [f.key, f.is_enabled])
);
console.log(`account ${USERNAME}; creation ${JSON.stringify(creation)}`);

let ignoredFonts = 0;
const browser = await chromium.launch(
	process.env.CHROME ? { executablePath: process.env.CHROME } : {}
);
try {
	// Trap 26: KaTeX's webfonts 403 in a worktree's dev server. Matched on the RESPONSE, counted, and
	// said out loud rather than silently dropped.
	async function newPage(
		locale,
		{ signedIn = true, width = 1280, height = 900, theme = 'light' } = {}
	) {
		const options = { viewport: { width, height } };
		const ctx =
			locale === 'en'
				? await englishContext(browser, BASE, options)
				: await browser.newContext(options);
		const page = await ctx.newPage();
		await page.addInitScript(
			([token, t]) => {
				try {
					if (token) localStorage.setItem('edmat-auth-token', token);
					localStorage.setItem('edmat-theme', t);
				} catch {
					// A locked-down context: the page then simply runs signed out with its default theme.
				}
			},
			[signedIn ? TOKEN : '', theme]
		);
		page.on('response', (r) => {
			if (r.status() === 403 && r.url().includes('/katex/dist/fonts/')) ignoredFonts++;
		});
		page.on('console', (m) => {
			if (m.type() !== 'error') return;
			if (/Failed to load resource: the server responded with a status of 403/.test(m.text()))
				return;
			errors.push(`[${locale} ${page.url()}] ${m.text()}`);
		});
		page.on('pageerror', (e) => errors.push(`[${locale} ${page.url()}] ${e.message}`));
		return page;
	}

	/** Go somewhere and wait until the layout has booted (trap 25: an element is not hydration). */
	async function open(page, path) {
		const booted = page
			.waitForResponse((r) => r.url().includes('/feature-flags/'), { timeout: 30000 })
			.catch(() => null);
		await page.goto(BASE + path, { waitUntil: 'load' });
		await booted;
	}

	/** The list (or its empty state) is on screen: the page has hydrated and its first load landed —
	 *  typing into a filter before that is typing into server-rendered HTML nobody is listening to. */
	const loaded = (page) =>
		page
			.locator('.grid, ul.cards, ul.orgs, [data-empty-state]')
			.first()
			.waitFor({ timeout: 30000 });
	const panel = (page, name) => page.locator(`[data-empty-state="${name}"]`);
	const links = new Set();

	/** Check one drawn empty state: its kind, its sentence in this language, and remember its links. */
	async function expectState(page, locale, name, { key, kind = 'empty', action, how }) {
		const box = panel(page, name);
		// Waits for the KIND as well: a debounced search leaves the unfiltered state on screen for a
		// moment, and checking it then would be checking the wrong thing.
		// Twice, a moment apart: a hub keyed on the session (/contests is) loads once as a visitor and
		// again when the session resolves, so the first state drawn can be swapped for "Loading…" and
		// back while the checks below are reading it — which is how two runs each lost a different
		// /contests check before this.
		const settled = page.locator(`[data-empty-state="${name}"][data-empty-kind="${kind}"]`);
		const visible = await settled
			.waitFor({ timeout: 20000 })
			.then(() => page.waitForTimeout(900))
			.then(() => settled.waitFor({ timeout: 20000 }))
			.then(() => true)
			.catch(() => false);
		check(`[${locale}] ${name}: the empty state is drawn`, visible);
		if (!visible) return;
		check(
			`[${locale}] ${name}: it is the ${kind} kind`,
			(await box.getAttribute('data-empty-kind')) === kind
		);
		const text = (await box.locator('.empty-state__message').innerText()).trim();
		const wanted = CATALOGUE[locale][kind === 'filtered' ? 'empty_filteredNothing' : key];
		check(`[${locale}] ${name}: says its own sentence`, text === wanted, `got "${text}"`);
		const actionCount = await box.locator('[data-empty-action]').count();
		if (action === false) check(`[${locale}] ${name}: offers no action`, actionCount === 0);
		if (typeof action === 'string') {
			check(`[${locale}] ${name}: offers its action`, actionCount === 1);
			const label = actionCount
				? (await box.locator('[data-empty-action]').innerText()).trim()
				: '';
			check(
				`[${locale}] ${name}: the action is labelled`,
				label === CATALOGUE[locale][action],
				`got "${label}"`
			);
		}
		const howCount = await box.locator('[data-empty-how]').count();
		if (how) {
			const href = howCount ? await box.locator('[data-empty-how]').getAttribute('href') : null;
			check(`[${locale}] ${name}: links ${how}`, href === how, `got ${href}`);
		}
		if (kind === 'filtered') {
			check(`[${locale}] ${name}: a filtered list offers no create button`, actionCount === 0);
			check(
				`[${locale}] ${name}: offers to clear the filters`,
				(await box.getByRole('button', { name: CATALOGUE[locale].empty_clearFilters }).count()) ===
					1
			);
		}
		for (const a of await box.locator('a[href]').all()) links.add(await a.getAttribute('href'));
	}

	async function shoot(page, name, { full = false } = {}) {
		await page.waitForTimeout(300);
		await page.screenshot({ path: `${SHOTS}/empty-${name}.png`, fullPage: full });
	}

	/** The gate's answer for `kind`: the action key when the server allows it, `false` when it refuses. */
	const gated = (kind, key) => (creation[kind] === null ? key : false);

	for (const locale of ['en', 'pl']) {
		console.log(`\n== ${locale} ==`);
		const p = await newPage(locale);

		// ---- 1. honestly empty, signed in as the fresh account ----------------------------------------
		await open(p, '/my-set');
		await expectState(p, locale, 'my-set', {
			key: 'empty_mySet',
			action: 'empty_mySetFindExercises',
			how: '/about/guide/exercises'
		});
		await shoot(p, `my-set-${locale}`);

		await open(p, '/tasks');
		await expectState(p, locale, 'tasks', {
			key: 'empty_tasks',
			action: flags.needs ? 'empty_tasksFindHelp' : false
		});
		await shoot(p, `tasks-${locale}`);

		await open(p, '/notifications');
		await expectState(p, locale, 'notifications', {
			key: 'empty_notifications',
			action: 'empty_notificationsSettings',
			how: '/about/guide/messages'
		});
		await shoot(p, `notifications-${locale}`);

		await open(p, '/messages');
		await expectState(p, locale, 'messages-inbox', {
			key: 'empty_messagesInbox',
			action: false,
			how: '/about/guide/messages'
		});
		await p.getByRole('tab', { name: CATALOGUE[locale].messages_tab_sent }).click();
		await expectState(p, locale, 'messages-sent', {
			key: 'empty_messagesSent',
			action: false
		});
		await shoot(p, `messages-sent-${locale}`);

		await open(p, '/flashcards');
		await expectState(p, locale, 'flashcards', {
			key: 'empty_flashcards',
			action: 'empty_flashcardsToMySet',
			how: '/about/guide/flashcards'
		});
		await shoot(p, `flashcards-${locale}`);

		await open(p, '/events');
		await p.getByRole('button', { name: CATALOGUE[locale].events_hosting, exact: true }).click();
		await expectState(p, locale, 'events-hosting', {
			key: 'empty_eventsHosting',
			action: gated('event', 'events_hostAnEvent'),
			how: '/about/guide/events'
		});
		await shoot(p, `events-hosting-${locale}`);
		await p.getByRole('button', { name: CATALOGUE[locale].events_attending, exact: true }).click();
		await expectState(p, locale, 'events-attending', {
			key: 'empty_eventsAttending',
			action: 'empty_eventsSeeUpcoming'
		});
		await panel(p, 'events-attending').locator('[data-empty-action]').click();
		await p.waitForTimeout(800);
		check(
			`[${locale}] events: "see what is coming up" switches to upcoming`,
			(await p
				.getByRole('button', { name: CATALOGUE[locale].events_filter_upcoming, exact: true })
				.getAttribute('aria-pressed')) === 'true'
		);

		await open(p, '/contests?tab=mine');
		await expectState(p, locale, 'contests-mine', {
			key: 'empty_contestsMine',
			action: gated('contest', 'empty_contestsAnnounce'),
			how: '/about/guide/contests'
		});
		await shoot(p, `contests-mine-${locale}`);
		await open(p, '/contests?tab=judging');
		await expectState(p, locale, 'contests-judging', {
			key: 'empty_contestsJudging',
			action: false
		});
		await open(p, '/contests?tab=entering');
		await expectState(p, locale, 'contests-entering', {
			key: 'empty_contestsEntering',
			action: 'empty_contestsBrowse'
		});

		await open(p, '/organizations');
		await p.getByRole('tab', { name: CATALOGUE[locale].orgs_tabMine }).click();
		await expectState(p, locale, 'organizations-mine', {
			key: 'empty_orgsMine',
			action: gated('organization', 'empty_orgsFound'),
			how: '/about/schools'
		});
		check(
			`[${locale}] organizations: the lead paragraph is there`,
			(await p.getByText(CATALOGUE[locale].empty_orgsLead, { exact: true }).count()) === 1
		);
		await shoot(p, `organizations-mine-${locale}`);

		await open(p, '/tutoring');
		await p.getByRole('tab', { name: CATALOGUE[locale].services_tab_mine }).click();
		await expectState(p, locale, 'tutoring-mine', {
			key: 'empty_tutoringMine',
			action: gated('service', 'services_newListing'),
			how: '/about/guide/tutoring'
		});
		await shoot(p, `tutoring-mine-${locale}`);

		await open(p, '/activity?view=followed');
		await expectState(p, locale, 'activity-followed', {
			key: 'empty_activityFollowed',
			action: 'empty_activityShowAll'
		});
		await shoot(p, `activity-followed-${locale}`);
		await panel(p, 'activity-followed').locator('[data-empty-action]').click();
		await p.waitForTimeout(800);
		check(
			`[${locale}] activity: "show everything" leaves the followed view`,
			!new URL(p.url()).searchParams.has('view')
		);

		// ---- 2. a filter that matches nothing ------------------------------------------------------------
		const NOPE = `zzqx-nothing-${stamp}`;

		await open(p, `/concepts?q=${NOPE}`);
		await expectState(p, locale, 'concepts', { kind: 'filtered' });
		await shoot(p, `concepts-filtered-${locale}`);
		await panel(p, 'concepts').getByRole('button').click();
		await p.waitForTimeout(800);
		check(
			`[${locale}] concepts: clearing empties the query string`,
			new URL(p.url()).search === ''
		);

		for (const [route, name, input] of [
			['/needs', 'needs', 'input.search'],
			['/volunteering', 'volunteering', 'input.search'],
			['/contests', 'contests', 'form.filters input[type="text"]']
		]) {
			await open(p, route);
			await loaded(p);
			// The dev database has no contests at all, so the unfiltered hub is honestly empty too.
			if (name === 'contests' && (await panel(p, 'contests').count())) {
				await expectState(p, locale, 'contests', {
					key: 'empty_contestsAll',
					action: gated('contest', 'empty_contestsAnnounce'),
					how: '/about/guide/contests'
				});
				await shoot(p, `contests-${locale}`);
			}
			await p.locator(input).fill(NOPE);
			await expectState(p, locale, name, { kind: 'filtered' });
			await panel(p, name).getByRole('button').click();
			await p.waitForTimeout(600);
			check(
				`[${locale}] ${name}: clearing empties the search box`,
				(await p.locator(input).inputValue()) === ''
			);
			if (name === 'needs') await shoot(p, `needs-cleared-${locale}`);
		}

		await open(p, '/organizations');
		await loaded(p);
		await p.locator('form.filters input[type="text"]').fill(NOPE);
		await p.locator('form.filters button[type="submit"]').click();
		await expectState(p, locale, 'organizations', { kind: 'filtered' });
		await panel(p, 'organizations').getByRole('button').click();
		await p.waitForTimeout(600);
		check(
			`[${locale}] organizations: clearing empties the search box`,
			(await p.locator('form.filters input[type="text"]').inputValue()) === ''
		);

		await open(p, `/activity?tag=${NOPE}`);
		await expectState(p, locale, 'activity', { kind: 'filtered' });
		await panel(p, 'activity').getByRole('button').click();
		await p.waitForTimeout(800);
		check(
			`[${locale}] activity: clearing drops the tag`,
			!new URL(p.url()).searchParams.has('tag')
		);
		await p.context().close();

		// ---- signed out: an action that needs an account becomes a sign-in link ------------------
		const anon = await newPage(locale, { signedIn: false });
		await open(anon, '/contests');
		await loaded(anon);
		if (await panel(anon, 'contests').count()) {
			await expectState(anon, locale, 'contests', { key: 'empty_contestsAll', action: false });
			const door = panel(anon, 'contests').locator('[data-empty-signin]');
			check(
				`[${locale}] contests signed out: a sign-in link instead of the create button`,
				(await door.count()) === 1 && (await door.getAttribute('href')) === '/login'
			);
			await shoot(anon, `contests-anon-${locale}`);
		} else {
			console.log('  (skipped: there are contests, so the signed-out empty hub is unreachable)');
		}
		await anon.context().close();

		// ---- 3. phone width, and dark --------------------------------------------------------------------
		const phone = await newPage(locale, { width: 390, height: 844 });
		for (const [path, name] of [
			['/my-set', 'my-set'],
			['/tasks', 'tasks'],
			['/notifications', 'notifications'],
			[`/concepts?q=${NOPE}`, 'concepts']
		]) {
			await open(phone, path);
			await panel(phone, name).waitFor({ timeout: 20000 });
			const overflow = await phone.evaluate(
				() => document.documentElement.scrollWidth > window.innerWidth
			);
			check(`[${locale}] ${name} at 390: no horizontal scroll`, !overflow);
			await shoot(phone, `${name}-${locale}-390`, { full: true });
		}
		await phone.context().close();

		const dark = await newPage(locale, { theme: 'dark' });
		for (const [path, name] of [
			['/flashcards', 'flashcards'],
			[`/concepts?q=${NOPE}`, 'concepts']
		]) {
			await open(dark, path);
			await panel(dark, name).waitFor({ timeout: 20000 });
			await shoot(dark, `${name}-${locale}-dark`);
		}
		await dark.context().close();
	}

	// ---- the other direction of the gate: an account it ALLOWS gets the button ------------------
	// `E2E_ALLOWED_TOKEN` is any account `GET /api/creation/` answers `contest: null` for (a verified
	// contributor, or kasia — read her token the way e2e/CLAUDE.md trap 30 says). Only meaningful
	// while the dev database has no contests, which is what makes the unfiltered hub empty.
	const allowedToken = process.env.E2E_ALLOWED_TOKEN ?? '';
	if (allowedToken) {
		const allowed = (await get('/api/creation/', allowedToken)).body ?? {};
		const ctx = await englishContext(browser, BASE, { viewport: { width: 1280, height: 900 } });
		const ap = await ctx.newPage();
		await ap.addInitScript((t) => localStorage.setItem('edmat-auth-token', t), allowedToken);
		await open(ap, '/contests');
		await loaded(ap);
		if (allowed.contest === null && (await panel(ap, 'contests').count())) {
			await expectState(ap, 'en', 'contests', {
				key: 'empty_contestsAll',
				action: 'empty_contestsAnnounce',
				how: '/about/guide/contests'
			});
			check(
				'[en] contests, allowed account: the action leads to /contests/new',
				(await panel(ap, 'contests').locator('[data-empty-action]').getAttribute('href')) ===
					'/contests/new'
			);
			await shoot(ap, 'contests-allowed-en');
		} else {
			console.log('  (skipped: that account may not found a contest, or contests exist)');
		}
		await ctx.close();
	}

	// ---- 4. every next-step link resolves ------------------------------------------------------------
	console.log('\n== links ==');
	// Every chapter `EmptyState`'s `EmptyStateGuide` type allows, whether or not this run drew it:
	// the type is a hand-kept copy of `GUIDE_CHAPTERS`' slugs, and this is what catches it drifting.
	for (const slug of [
		'exercises',
		'events',
		'tutoring',
		'concepts',
		'help',
		'messages',
		'flashcards',
		'contests'
	])
		links.add(`/about/guide/${slug}`);
	const lp = await newPage('en');
	for (const href of [...links].sort()) {
		await open(lp, href);
		await lp.waitForTimeout(700);
		const h1 = (
			await lp
				.locator('h1')
				.first()
				.innerText()
				.catch(() => '')
		).trim();
		const missing = await lp.locator('.chapter__missing').count();
		check(
			`${href} resolves`,
			h1 !== '' && !/^404/.test(h1) && missing === 0,
			`h1="${h1}" missing=${missing}`
		);
	}
	await lp.context().close();
} catch (error) {
	check('the run reached its end', false, String(error).split('\n')[0]);
} finally {
	// ---- cleanup: the throwaway account goes through the real self-service erasure ---------------
	if (process.env.E2E_KEEP === '1') {
		console.log(`kept: E2E_EMPTY_USER=${USERNAME} E2E_EMPTY_TOKEN=${TOKEN}`);
	} else {
		const erase = await post(
			'/api/auth/me/erasure/',
			{ password: PASSWORD, username: USERNAME },
			TOKEN
		);
		check(
			'cleanup: the throwaway account is scheduled for deletion',
			erase.status < 300,
			`${erase.status}`
		);
	}
	await browser.close();
}
if (ignoredFonts)
	console.log(`\n(ignored ${ignoredFonts} KaTeX font 403s — e2e/CLAUDE.md trap 26)`);
check(
	'no console or page errors',
	errors.length === 0,
	`\n    ${errors.slice(0, 10).join('\n    ')}`
);
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
