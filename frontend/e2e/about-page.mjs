// `/about` — since 2026-10-08 the project's own organisation page (OrganizationPage for the
// `edmat` body) with the research thread's section, the "what you can do here" grid, the showcase
// index and the manual link (HISTORY §17BW.C; the brochure version is §17BG):
//
//   1. it renders in both interface languages: the organisation's name as the h1, its goals
//      (plans), its needs, and — the open board — its tasks and polls, readable by a stranger with
//      no button to add, move or vote;
//   2. thirteen feature cards (WP7 added flashcards, contests, help wanted and organisations), and
//      ONE Explore section carrying `id="showcase"`, the manual band and the showcase index;
//   3. it holds at phone width without horizontal overflow;
//   4. a killed feature's card is gone for an anonymous visitor (house rule 3) and comes back —
//      tutoring, and each of the four new cards on its own switch;
//   5. the footer link points at it, and the tab title is shaped by PageHead (exactly one <title>);
//   6. (WP7) the "New here?" strip — `StartHere variant="about"` — is the first thing on the page,
//      above the organisation's, in the server-rendered HTML; its three doors land (the guide's
//      "Getting started" chapter, an in-page scroll to Explore, /disciplines); "hide" takes it away
//      and, being one shared choice with the homepage, takes the homepage's band away too.
//
// Needs the EdMat organisation seeded (`manage.py seed_edmat_project --owner <username>`).
//
// Run (ports must match whatever `run.sh`/test.md set up):
//   E2E_BASE=http://localhost:5183 E2E_API=http://127.0.0.1:8100/api \
//     [E2E_TOKEN=<kasia's token, trap 30>] [E2E_BUILD_HTML=build/about.html] node e2e/about-page.mjs
//
// `E2E_BUILD_HTML`, when set, also checks the PRERENDERED file: the strip before the organisation.
//
// Screenshots land in e2e/screens/about-*.png and are meant to be LOOKED at.
import { mkdirSync, readFileSync } from 'node:fs';
import { englishContext } from './english.mjs';

let chromium;
try {
	({ chromium } = await import('playwright'));
} catch {
	({ chromium } = await import('playwright-core'));
}

const BASE = process.env.E2E_BASE ?? 'http://localhost:5183';
const API = process.env.E2E_API ?? 'http://127.0.0.1:8100/api';
const STAFF = 'kasia@edmat.example';
const PASSWORD = 'password123';
const SHOTS = 'e2e/screens/';
mkdirSync(SHOTS, { recursive: true });

const CATALOGUE = {
	en: JSON.parse(readFileSync(new URL('../messages/en.json', import.meta.url), 'utf8')),
	pl: JSON.parse(readFileSync(new URL('../messages/pl.json', import.meta.url), 'utf8'))
};
const CARDS = 13;
const CARD = '.about__grid .about__card';
const STRIP = '[data-start-here="about"]';
/** A card by its route — `/tutoring` is `/korki` for a Polish reader. */
const cardFor = (...paths) => paths.map((p) => `${CARD} a[href$="${p}"]`).join(', ');

let pass = 0,
	fail = 0;
const check = (l, ok, x = '') => {
	if (ok) pass++;
	else fail++;
	console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${l} ${ok ? '' : x}`);
};

async function tokenFor(email) {
	// A saved token beats the login throttle (e2e/CLAUDE.md trap 30).
	if (process.env.E2E_TOKEN) return process.env.E2E_TOKEN;
	const response = await fetch(`${API}/auth/login/`, {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify({ username: email, password: PASSWORD })
	});
	if (!response.ok) throw new Error(`login ${email}: ${response.status}`);
	return (await response.json()).token;
}
async function setFlag(token, key, isEnabled) {
	const response = await fetch(`${API}/feature-flags/${key}/`, {
		method: 'PATCH',
		headers: { 'Content-Type': 'application/json', Authorization: `Token ${token}` },
		body: JSON.stringify({ is_enabled: isEnabled })
	});
	if (!response.ok) throw new Error(`flag ${key}=${isEnabled}: ${response.status}`);
}

const browser = await chromium.launch(
	process.env.CHROME ? { executablePath: process.env.CHROME } : {}
);
const DESKTOP = { width: 1280, height: 900 };
const PHONE = { width: 390, height: 844 };
const errors = [];
// With the organisations switch OFF, `OrganizationPage` still asks for the organisation and the
// gate answers an anonymous caller 401 — one refused request per load, and a console line for it.
// That is OrganizationPage's own behaviour (left open, WP7), not this page's; while the switch is
// off it is counted and printed here, never silently dropped, and nothing else is excused.
let orgKilled = false;
let orgKilledNoise = 0;
function watch(page) {
	page.on('pageerror', (e) => errors.push(String(e)));
	let refused = 0;
	page.on('console', (msg) => {
		if (msg.type() !== 'error') return;
		if (orgKilled && refused > 0 && msg.text().includes('401')) {
			refused--;
			orgKilledNoise++;
			return;
		}
		errors.push(msg.text());
	});
	// A refused request's console line carries no URL; this says which one it was.
	page.on('response', (r) => {
		if (r.status() < 400) return;
		if (orgKilled && r.status() === 401 && r.url().includes('/organizations/?slug=')) {
			refused++;
			orgKilledNoise++;
			return;
		}
		errors.push(`${r.status()} ${r.url()}`);
	});
}
/** `withOrg: false` when the organisations switch is off: there are no plans to wait for then. */
async function openAbout(page, { withOrg = true, path = '/about' } = {}) {
	watch(page);
	// The root layout's own boot request, registered before goto (trap 25): an element in the
	// prerendered HTML resolves long before its click handler exists.
	const booted = page.waitForResponse((r) => r.url().includes('/feature-flags/'), {
		timeout: 60000
	});
	await page.goto(`${BASE}${path}`, { waitUntil: 'load' });
	await booted;
	if (path !== '/about') return;
	await page.locator(CARD).first().waitFor();
	// The organisation body loads after the SPA boots; the plans panel is the last thing to arrive.
	// Panels are FOLDED since 3d9f613c (a node page is one line per panel until opened, and a
	// folded body is not rendered at all), so the wait is for the fold's own line, not its rows.
	if (withOrg) await page.locator('[data-fold="plans"]').waitFor({ timeout: 15000 });
	await page.waitForTimeout(300);
}
async function shoot(page, name) {
	await page.screenshot({ path: `${SHOTS}about-${name}.png`, fullPage: true });
}

try {
	// ---- 1. Polish (the base locale), desktop, light, anonymous --------------------------------
	{
		const ctx = await browser.newContext({ viewport: DESKTOP });
		const page = await ctx.newPage();
		await openAbout(page);
		check(
			'pl: h1 is the organisation, "EdMat"',
			(await page.locator('h1').textContent())?.trim() === 'EdMat'
		);
		// Open the three folds the open-board checks read (folded by default; the body is not drawn).
		for (const key of ['plans', 'tasks', 'polls']) {
			await page.locator(`[data-fold="${key}"] .fold__toggle`).click();
		}
		await page.locator('.plan-row').first().waitFor({ timeout: 15000 });
		check('pl: goals listed (plans panel)', (await page.locator('.plan-row').count()) >= 15);
		check(`pl: ${CARDS} feature cards`, (await page.locator(CARD).count()) === CARDS);
		for (const path of ['/flashcards', '/contests', '/needs', '/organizations']) {
			check(`pl: the ${path} card is there`, (await page.locator(cardFor(path)).count()) === 1);
		}
		// One Explore section: the id the strip's middle door targets, the manual, the showcase.
		const explore = page.locator('section#showcase');
		check('one element carries id="showcase"', (await page.locator('#showcase').count()) === 1);
		check(
			'Explore holds the manual band and the showcase index',
			(await explore.locator('.about__manual a[href$="/about/guide"]').count()) === 1 &&
				(await explore.locator('section.showcase-index .showcase-index__card').count()) === 12
		);
		check(
			'Explore is headed in Polish',
			(await explore.locator('h2').first().innerText()).trim() === CATALOGUE.pl.wp7_exploreHeading
		);
		check(
			'no manual band left outside Explore',
			(await page.locator('.about__manual').count()) === 1
		);
		// The strip: first, above the organisation, reading the catalogue.
		const strip = page.locator(STRIP);
		check('pl: the strip is drawn', (await strip.count()) === 1);
		check(
			'pl: the strip precedes the organisation h1 in the DOM and on screen',
			await page.evaluate((sel) => {
				const band = document.querySelector(sel);
				const h1 = document.querySelector('h1');
				if (!band || !h1) return false;
				const after = band.compareDocumentPosition(h1) & Node.DOCUMENT_POSITION_FOLLOWING;
				return (
					Boolean(after) && band.getBoundingClientRect().bottom <= h1.getBoundingClientRect().top
				);
			}, STRIP)
		);
		check(
			'pl: the strip doors read the catalogue',
			(await strip.locator('[data-start-door="guide"]').innerText()).includes(
				CATALOGUE.pl.startHere_guideLink
			) &&
				(await strip.locator('[data-start-door="showcase"]').innerText()).includes(
					CATALOGUE.pl.startHere_showcaseLink
				) &&
				(await strip.locator('[data-start-door="try"]').innerText()).includes(
					CATALOGUE.pl.startHere_tryLink
				)
		);
		check('exactly one <title>', (await page.locator('head title').count()) === 1);
		check('title is shaped by PageHead', (await page.title()).startsWith('EdMat: '));
		check('footer links to /about', (await page.locator('footer a[href$="/about"]').count()) === 1);
		// the open board: tasks and polls drawn for a stranger, nothing to press
		const tasks = page.locator('[data-testid="tasks-panel"]');
		check('open board: the task board is drawn for a stranger', (await tasks.count()) === 1);
		check(
			'open board: no "add a task" for a stranger',
			(await tasks.locator('button.add').count()) === 0
		);
		// The polls arrive with their own request after the fold opens.
		await page
			.locator('[data-fold="polls"] .poll')
			.first()
			.waitFor({ timeout: 15000 })
			.catch(() => {});
		// Scoped to the polls fold and matched on the catalogue's exact label: an unscoped
		// case-insensitive `has-text("Głosuj")` matched a TASK titled "…społeczność głosuje".
		const voteButtons = page
			.locator('[data-fold="polls"] button')
			.filter({ hasText: CATALOGUE.pl.polls_vote });
		check(
			'open board: the polls are drawn, with no vote button',
			(await page.locator('[data-fold="polls"] .poll').count()) >= 2 &&
				(await voteButtons.count()) === 0,
			`polls ${await page.locator('[data-fold="polls"] .poll').count()}, vote buttons ${await voteButtons.count()}`
		);
		check(
			'the research thread toggle is there',
			// Scoped by its title: since the board folded, a task row and the organisation's
			// description each carry a discussion toggle of their own (e4c62a61).
			(await page
				.locator('.section-discussion__toggle', { hasText: CATALOGUE.pl.about_researchHeading })
				.count()) === 1
		);
		await shoot(page, 'pl-desktop-light');
		await page.evaluate(() => {
			localStorage.setItem('edmat-theme', 'dark');
			document.documentElement.setAttribute('data-theme', 'dark');
		});
		await shoot(page, 'pl-desktop-dark');
		await ctx.close();
	}

	// ---- 2. English, phone, light — and no horizontal overflow --------------------------------
	{
		const ctx = await englishContext(browser, BASE, { viewport: PHONE });
		const page = await ctx.newPage();
		await openAbout(page);
		check('en: h1 is "EdMat"', (await page.locator('h1').textContent())?.trim() === 'EdMat');
		check(`en: ${CARDS} feature cards`, (await page.locator(CARD).count()) === CARDS);
		check(
			'en: Explore is headed in English',
			(await page.locator('section#showcase h2').first().innerText()).trim() ===
				CATALOGUE.en.wp7_exploreHeading
		);
		check(
			'en: the strip doors read the catalogue',
			(await page.locator(`${STRIP} [data-start-door="showcase"]`).innerText()).includes(
				CATALOGUE.en.startHere_showcaseLink
			)
		);
		const overflow = await page.evaluate(
			() => document.documentElement.scrollWidth - document.documentElement.clientWidth
		);
		check('phone: no horizontal overflow', overflow <= 0, `overflow ${overflow}px`);
		await shoot(page, 'en-phone-light');
		await ctx.close();
	}

	// ---- 3. Kill switch: the tutoring card disappears for a stranger ---------------------------
	{
		const token = await tokenFor(STAFF);
		await setFlag(token, 'tutoring', false);
		try {
			const ctx = await englishContext(browser, BASE, { viewport: DESKTOP });
			const page = await ctx.newPage();
			await openAbout(page);
			await page
				.locator(cardFor('/tutoring', '/korki'))
				.waitFor({ state: 'detached', timeout: 8000 })
				.catch(() => {});
			check(
				'tutoring off: its card is gone',
				(await page.locator(cardFor('/tutoring', '/korki')).count()) === 0
			);
			check(
				`tutoring off: ${CARDS - 1} cards remain`,
				(await page.locator(CARD).count()) === CARDS - 1
			);
			await shoot(page, 'en-desktop-tutoring-off');
			await ctx.close();
		} finally {
			await setFlag(token, 'tutoring', true);
		}
		const ctx = await englishContext(browser, BASE, { viewport: DESKTOP });
		const page = await ctx.newPage();
		await openAbout(page);
		check(`tutoring on again: ${CARDS} cards`, (await page.locator(CARD).count()) === CARDS);
		await ctx.close();
	}

	// ---- 4. Kill switch, each new card on its own switch (WP7), for a stranger ----------------
	// One flag at a time, so a card that answered to the WRONG switch would still be caught.
	{
		const token = await tokenFor(STAFF);
		for (const [flag, path] of [
			['flashcards', '/flashcards'],
			['contests', '/contests'],
			['needs', '/needs'],
			['organizations', '/organizations']
		]) {
			await setFlag(token, flag, false);
			orgKilled = flag === 'organizations';
			try {
				const ctx = await englishContext(browser, BASE, { viewport: DESKTOP });
				const page = await ctx.newPage();
				await openAbout(page, { withOrg: flag !== 'organizations' });
				await page
					.locator(cardFor(path))
					.waitFor({ state: 'detached', timeout: 8000 })
					.catch(() => {});
				check(
					`${flag} off: its card is gone, ${CARDS - 1} remain`,
					(await page.locator(cardFor(path)).count()) === 0 &&
						(await page.locator(CARD).count()) === CARDS - 1,
					`count ${await page.locator(CARD).count()}`
				);
				if (flag === 'organizations') {
					check(
						'organizations off: the strip still opens the page',
						(await page.locator(STRIP).count()) === 1
					);
					await shoot(page, 'en-desktop-organizations-off');
				}
				await ctx.close();
			} finally {
				orgKilled = false;
				await setFlag(token, flag, true);
			}
		}
		const flags = await (await fetch(`${API}/feature-flags/`)).json();
		const on = Object.fromEntries(flags.map((f) => [f.key, f.is_enabled]));
		check(
			'every switch this script turned off is back on',
			['tutoring', 'flashcards', 'contests', 'needs', 'organizations'].every((k) => on[k] === true)
		);
	}

	// ---- 5. The strip: static HTML, doors, in-page scroll, shared hide (WP7) -------------------
	{
		const html = await (await fetch(`${BASE}/about`)).text();
		const stripAt = html.indexOf('data-start-here="about"');
		const orgAt = html.search(/class="page[ "]/);
		check(
			'server-rendered /about: the strip comes before the organisation page',
			stripAt !== -1 && orgAt !== -1 && stripAt < orgAt,
			`strip ${stripAt}, org ${orgAt}`
		);
		check(
			'server-rendered /about: all three doors are in it',
			['guide', 'showcase', 'try'].every((d) => html.includes(`data-start-door="${d}"`))
		);
		check(
			'server-rendered /about: the strip is the first thing inside <main>',
			(() => {
				// Only wrappers between <main> and the strip: no heading, paragraph, link or list.
				const main = html.indexOf('<main');
				if (main === -1 || stripAt < main) return false;
				return !/<(h[1-6]|p|a|ul|ol|img)[\s>]/.test(html.slice(main, stripAt));
			})()
		);
		if (process.env.E2E_BUILD_HTML) {
			const built = readFileSync(process.env.E2E_BUILD_HTML, 'utf8');
			const b = built.indexOf('data-start-here="about"');
			const o = built.search(/class="page[ "]/);
			check(
				`${process.env.E2E_BUILD_HTML}: the strip comes before the organisation page`,
				b !== -1 && o !== -1 && b < o,
				`strip ${b}, org ${o}`
			);
		}

		for (const locale of ['en', 'pl']) {
			const t = CATALOGUE[locale];
			const fresh = () =>
				locale === 'en'
					? englishContext(browser, BASE, { viewport: DESKTOP })
					: browser.newContext({ viewport: DESKTOP });

			// Doors, each in a fresh tab (trap 3: a long chain of loads in one tab on /about's weight).
			const ctx = await fresh();
			let page = await ctx.newPage();
			await openAbout(page);
			await page.locator(`${STRIP} [data-start-door="showcase"]`).click();
			await page.waitForTimeout(1200);
			const landed = await page.evaluate(() => {
				const target = document.getElementById('showcase');
				const top = target ? target.getBoundingClientRect().top : null;
				return { path: location.pathname, hash: location.hash, top, y: window.scrollY };
			});
			check(
				`[${locale}] "See what EdMat can do" scrolls this page to Explore`,
				landed.path === '/about' &&
					landed.hash === '#showcase' &&
					landed.y > 500 &&
					landed.top !== null &&
					landed.top >= 0 &&
					landed.top < 200,
				JSON.stringify(landed)
			);
			check(
				`[${locale}] …and Explore's heading is not under the sticky header`,
				await page.evaluate(() => {
					const h2 = document.querySelector('#showcase h2');
					const header = document.querySelector('header');
					if (!h2) return false;
					const bottom = header ? header.getBoundingClientRect().bottom : 0;
					return h2.getBoundingClientRect().top >= bottom - 1;
				})
			);
			await page.close();

			for (const door of [
				{ key: 'guide', path: '/about/guide/start' },
				{ key: 'try', path: '/disciplines' }
			]) {
				page = await ctx.newPage();
				await openAbout(page);
				await page.locator(`${STRIP} [data-start-door="${door.key}"]`).click();
				await page.waitForURL((u) => u.pathname === door.path, { timeout: 15000 }).catch(() => {});
				await page
					.locator('h1')
					.first()
					.waitFor({ timeout: 15000 })
					.catch(() => {});
				const at = new URL(page.url()).pathname;
				const ok =
					at === door.path &&
					(await page.locator('h1').count()) > 0 &&
					(door.key !== 'guide' ||
						!(await page.locator('main').innerText()).includes(t.guide_unknownChapter));
				check(`[${locale}] "${door.key}" lands on ${door.path}`, ok, `at ${at}`);
				await page.close();
			}

			// Hide: gone here, remembered, and gone on the homepage too — one shared choice. Once, in
			// English: it reads no copy, and every /about load costs ~20 anonymous requests against a
			// 600/hour throttle (settings.py), which a doubled run here exhausted.
			if (locale === 'pl') {
				await ctx.close();
				continue;
			}
			page = await ctx.newPage();
			await openAbout(page);
			await page.locator(`${STRIP} [data-start-hide]`).click();
			check(`[${locale}] Hide takes the strip away`, (await page.locator(STRIP).count()) === 0);
			check(
				`[${locale}] …and remembers it in the shared key`,
				(await page.evaluate(() => localStorage.getItem('edmat.startHere.hidden'))) === '1'
			);
			check(
				`[${locale}] …leaving no empty gap above the organisation`,
				await page.evaluate(() => {
					const wrap = document.querySelector('.about-start');
					return !wrap || wrap.getBoundingClientRect().height === 0;
				})
			);
			await page.close();
			page = await ctx.newPage();
			await openAbout(page);
			check(
				`[${locale}] a reload of /about does not bring it back`,
				(await page.locator(STRIP).count()) === 0
			);
			await page.close();
			page = await ctx.newPage();
			await openAbout(page, { path: '/' });
			await page.waitForTimeout(500);
			check(
				`[${locale}] hiding it on /about hid the homepage's band too`,
				(await page.locator('[data-start-here]').count()) === 0
			);
			await page.evaluate(() => localStorage.removeItem('edmat.startHere.hidden'));
			await page.close();
			page = await ctx.newPage();
			await openAbout(page);
			check(
				`[${locale}] clearing the key brings the strip back`,
				(await page.locator(STRIP).count()) === 1
			);
			await page.close();
			await ctx.close();
		}
	}

	// ---- 6. Screens to LOOK at: 1280 and 390, light and dark, top and Explore -----------------
	// One load per width; the theme is switched in place the way the header's picker does it.
	for (const [vpName, viewport] of [
		['1280', DESKTOP],
		['390', PHONE]
	]) {
		const ctx = await englishContext(browser, BASE, { viewport });
		const page = await ctx.newPage();
		await openAbout(page);
		for (const scheme of ['light', 'dark']) {
			await page.evaluate((theme) => {
				localStorage.setItem('edmat-theme', theme);
				document.documentElement.setAttribute('data-theme', theme);
			}, scheme);
			await page.evaluate(() => window.scrollTo(0, 0));
			await page.waitForTimeout(300);
			await page.screenshot({ path: `${SHOTS}about-wp7-${vpName}-${scheme}-top.png` });
			await page.evaluate(() => document.getElementById('showcase')?.scrollIntoView());
			await page.waitForTimeout(300);
			await page.screenshot({ path: `${SHOTS}about-wp7-${vpName}-${scheme}-explore.png` });
			const overflow = await page.evaluate(
				() => document.documentElement.scrollWidth - document.documentElement.clientWidth
			);
			check(`${vpName} ${scheme}: no horizontal overflow`, overflow <= 0, `${overflow}px`);
		}
		await ctx.close();
	}
} finally {
	await browser.close();
}

if (orgKilledNoise) {
	console.log(
		`  (ignored ${orgKilledNoise} 401 lines for the organisation while its switch was off)`
	);
}
check('zero console/page errors', errors.length === 0, errors.join(' | ').slice(0, 300));
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
