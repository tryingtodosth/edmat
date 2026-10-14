// The design showcase under `/about/<feature>` (HISTORY.md §17BR.G, prompts/08-about-showcase.md).
//
// Twelve prerendered pages built from sample data in `lib/content/showcase/`, plus — since
// 2026-10-14 — screenshots of the running site and links to the real pages. The last four
// (goals-and-work, tutoring, materials, conference — WP5) are module pages with one framed sample
// each and more screenshots. What this script is actually for:
//
//   1. all twelve open, in BOTH interface languages, each with its own `<h1>`, the honest "nothing
//      here is live" notice, and at least one sample frame — with zero console/page errors and
//      zero failed requests;
//   2. nothing on them reaches the API beyond what every page asks for — the root layout's boot
//      requests, and the one discussion-policy request the page's own sections need (for its own
//      `about/<slug>` key and nothing else). Counted after the page has HYDRATED and settled: until
//      2026-10-14 this was counted straight after `load`, before any effect had run, and so passed
//      against pages that were in fact asking for `/api/discussions/` (a vacuous pass, e2e trap 8 —
//      found by adding a wait and watching all sixteen checks fail). Operating the one live sample
//      (the flashcard) must add nothing at all;
//   3. a sample card cannot be clicked through. The samples are drawn with the real components, so
//      `ExerciseCard` links to `/exercises/9001` — an id that exists in a content file and in no
//      database. `SampleFrame` wraps them in `inert`; this clicks one and asserts the URL did not
//      move, which is the only way to tell a working `inert` from a decorative attribute;
//   4. every link a reader CAN follow goes somewhere that exists (the allowlist below);
//   5. the index on `/about` has twelve cards, and no page overflows at phone width;
//   6. the real screens and the ways out (2026-10-14): each page's "Try it yourself" row has the
//      links it should, every screenshot is a real PNG of the size it claims and sits OUTSIDE any
//      inert frame, every followable link answers 200 from the server, the "Read the manual
//      chapter" link agrees with the manual's own `GUIDE_CHAPTERS[].showcase` (read off the
//      chapter pages, in both directions), a killed feature's links disappear (the flag list is
//      intercepted in the browser — no database row is touched), and a screenshot's "Open the real
//      page" really navigates.
//
// Run (ports must match the servers you started):
//   E2E_BASE=http://localhost:5237 E2E_API=http://127.0.0.1:8137/api node e2e/showcase.mjs
//
// A backend is not required for the pages themselves — they are prose — but one should be up so
// the root layout's own boot requests answer. Set E2E_NO_BACKEND=1 to run with it down, which
// stops those three failures counting against the page.
//
// Two things in a WORKTREE will otherwise read as product bugs and are not:
//   - `frontend/node_modules` is a symlink to the main checkout, which is outside Vite's
//     `server.fs.allow` root, so the dev server answers 403 for KaTeX's own font files
//     (`/@fs/…/katex/dist/fonts/…`). Production bundles them; the main checkout does not hit it.
//     Allowed below, by name, rather than by widening the check.
//   - the backend prints `no such table: telemetry_requestlog` per request, because the log shards
//     are separate database files that a worktree's copied `db.sqlite3` does not bring. The
//     middleware catches its own write, so nothing is affected.
//
// Screenshots land in e2e/screens/showcase-*.png and are meant to be LOOKED at.

import { mkdirSync } from 'node:fs';
import { englishContext } from './english.mjs';

let chromium;
try {
	({ chromium } = await import('playwright'));
} catch {
	({ chromium } = await import('playwright-core'));
}

const BASE = process.env.E2E_BASE ?? 'http://localhost:5237';
const API = process.env.E2E_API ?? 'http://127.0.0.1:8137/api';
// With no backend running, the header's flag/locale-hint fetches fail and that is not this
// feature's problem — but it must be an explicit choice rather than a silent pass.
const ALLOW_API_FAILURES = process.env.E2E_NO_BACKEND === '1';
const SHOTS = new URL('./screens/', import.meta.url).pathname;
mkdirSync(SHOTS, { recursive: true });

let pass = 0,
	fail = 0;
const check = (label, ok, extra = '') => {
	if (ok) pass++;
	else fail++;
	console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${label} ${ok ? '' : extra}`);
};

/**
 * The eight, with the `<h1>` each must show in each language, how many sample frames, how many
 * "Try it yourself" links (all features on), how many screenshots, and the manual chapter it links.
 */
const PAGES = [
	{
		slug: 'exercises',
		pl: 'Zadanie, zestaw, talia',
		en: 'An exercise, a set, a deck',
		frames: 4,
		tries: 3,
		shots: 2,
		guide: 'exercises'
	},
	{
		slug: 'flashcards',
		pl: 'Fiszki i powtórki w odstępach',
		en: 'Flashcards and spaced review',
		frames: 4,
		tries: 2,
		shots: 2,
		guide: 'flashcards'
	},
	{
		slug: 'learning-record',
		pl: 'Rejestr nauki',
		en: 'The learning record',
		frames: 4,
		tries: 1,
		shots: 0,
		guide: null
	},
	{
		slug: 'courses',
		pl: 'Kurs, tydzień, zaświadczenie',
		en: 'A course, a week, a certificate',
		frames: 5,
		tries: 2,
		shots: 1,
		guide: 'courses'
	},
	{
		slug: 'schools',
		pl: 'Szkoła w EdMacie',
		en: 'A school on EdMat',
		frames: 3,
		tries: 2,
		shots: 0,
		guide: null
	},
	{
		slug: 'concepts',
		pl: 'Pojęcia i co trzeba wiedzieć wcześniej',
		en: 'Concepts, and what to learn first',
		frames: 5,
		tries: 1,
		shots: 1,
		guide: 'concepts'
	},
	{
		slug: 'events',
		pl: 'Co zostaje po wydarzeniu',
		en: 'What an event leaves behind',
		frames: 4,
		tries: 1,
		shots: 1,
		guide: 'events'
	},
	{
		slug: 'contests',
		pl: 'Konkursy i to, co przynosi ze sobą nagroda',
		en: 'Contests, and what a prize brings with it',
		frames: 4,
		tries: 1,
		shots: 0,
		guide: 'contests'
	},
	// The module pages (2026-10-14). `tries` is what a SIGNED-OUT reader gets: goals-and-work has a
	// fourth link, `/work`, drawn only for a signed-in reader (`SHOWCASE_LIVE.signedIn`). `links` is
	// how many screenshots carry "Open the real page" — the conference's ticket, scanner, rota and
	// cloakroom pictures deliberately carry none (their pages need an event id and a staff right).
	{
		slug: 'goals-and-work',
		pl: 'Cele, plany i praca za nimi',
		en: 'Goals, plans and the work behind them',
		frames: 1,
		tries: 3,
		shots: 4,
		// The `/work` screenshot's link is signed-in only, like its "Try it" link.
		links: 3,
		guide: 'help'
	},
	{
		slug: 'tutoring',
		pl: 'Korepetycje z rezerwacją',
		en: 'Tutoring you can book',
		frames: 1,
		tries: 2,
		shots: 3,
		guide: 'tutoring'
	},
	{
		slug: 'materials',
		pl: 'Materiały pisane wspólnie',
		en: 'Materials, co-authored',
		frames: 1,
		tries: 2,
		shots: 2,
		guide: 'submit'
	},
	{
		slug: 'conference',
		pl: 'Prowadzenie konferencji',
		en: 'Running a conference',
		frames: 1,
		tries: 4,
		shots: 6,
		links: 2,
		guide: null
	}
];

/**
 * Every route a showcase page is allowed to send a reader to. `/dziennik/` is the school-logbook
 * demonstration — not a route of this app but a real published path (HISTORY.md §17BO). Anything
 * outside this list is a link that would 404 or lead somewhere that is not on this branch.
 */
const ALLOWED = [
	'/about',
	'/about/contests',
	'/about/guide/exercises',
	'/about/guide/flashcards',
	'/about/guide/courses',
	'/about/guide/concepts',
	'/about/guide/events',
	'/about/guide/contests',
	'/flashcards',
	'/contests',
	'/settings',
	'/about/exercises',
	'/about/flashcards',
	'/about/learning-record',
	'/about/courses',
	'/about/schools',
	'/about/concepts',
	'/about/events',
	'/disciplines',
	'/my-set',
	'/courses',
	'/events',
	'/concepts',
	'/organizations',
	'/settings/profile',
	'/dziennik/',
	// The module pages (2026-10-14) and where they send readers. `/korki` and `/materialy` are the
	// Polish addresses of `/tutoring` and `/materials` (frontend/CLAUDE.md, "i18n").
	'/about/goals-and-work',
	'/about/tutoring',
	'/about/materials',
	'/about/conference',
	'/about/guide/help',
	'/about/guide/tutoring',
	'/about/guide/submit',
	'/work',
	'/tasks',
	'/needs',
	'/tutoring',
	'/korki',
	'/bookings',
	'/materials',
	'/materialy',
	'/material-projects',
	'/conference',
	'/venues',
	'/volunteering/hours'
];

/** Live links that must come out in the reader's own address: Polish readers get `/korki` and
 *  `/materialy`, English readers the canonical path. Checked per page, per locale. */
const LOCALIZED = {
	tutoring: { en: '/tutoring', pl: '/korki' },
	materials: { en: '/materials', pl: '/materialy' }
};

const browser = await chromium.launch(
	process.env.CHROME ? { executablePath: process.env.CHROME } : {}
);
const DESKTOP = { width: 1280, height: 1000 };
const PHONE = { width: 390, height: 844 };

const errors = [];
const failedRequests = [];

/**
 * Everything the ROOT LAYOUT asks for on any page of this app, showcase or not: the feature flags
 * (every page's nav depends on them), the first-visit locale hint, and the material-type
 * vocabulary. A showcase page must add NOTHING to this list — that is the check, rather than
 * "zero API requests", which would be a check on the header.
 */
const LAYOUT_BOOT = [
	'/api/feature-flags/',
	'/api/locale-hint/',
	'/api/material-types/',
	// `taxonomyStore.preload()` in the root layout's onMount — every page, showcase or not
	// (measured on `/privacy`, 2026-10-14). Missing from this list until the check stopped being
	// vacuous; see the header, point 2.
	'/api/disciplines/',
	'/api/branches/'
];

/**
 * A request to the real backend, as opposed to a dev-server module request that merely has `/api/`
 * in its path — `/src/lib/api/client.ts` does, and counting it made every page look like it was
 * talking to the server.
 */
const isApiRequest = (url) => url.startsWith(new URL(API).origin + new URL(API).pathname);

/** See the header comment: a worktree's symlinked node_modules is outside Vite's fs root. */
const isWorktreeFontFailure = (url) => url.includes('/@fs/') && url.includes('/katex/dist/fonts/');

/** Attach the listeners every page in this script shares. Returns the API-request record. */
function watch(page) {
	const api = { paths: [], urls: [] };
	page.on('pageerror', (e) => errors.push(String(e)));
	page.on('console', (msg) => {
		if (msg.type() !== 'error') return;
		// A console "Failed to load resource" for one of those font files is the same worktree
		// artefact the response listener already allows; counting it here too would fail every run.
		if (/Failed to load resource/.test(msg.text())) return;
		errors.push(msg.text());
	});
	page.on('request', (req) => {
		const url = req.url();
		if (isApiRequest(url)) {
			api.paths.push(new URL(url).pathname);
			api.urls.push(url);
		}
	});
	page.on('response', (res) => {
		const url = res.url();
		if (res.status() < 400) return;
		if (isWorktreeFontFailure(url)) return;
		if (ALLOW_API_FAILURES && isApiRequest(url)) return;
		failedRequests.push(`${res.status()} ${url}`);
	});
	return api;
}

/**
 * Which API requests this page made that the root layout does not make everywhere — leaving out
 * the page's OWN discussion-policy request (`/api/discussions/?page=about/<slug>`), which is the
 * one request a showcase page is allowed: it is how its sections learn whether they have a thread.
 * A policy request for any other page key is still reported.
 */
const beyondBoot = (api, slug = null) => [
	...new Set(
		api.urls
			.map((u) => new URL(u))
			.filter((u) => !LAYOUT_BOOT.includes(u.pathname))
			.filter(
				(u) =>
					!(
						slug &&
						u.pathname === '/api/discussions/' &&
						u.searchParams.get('page') === `about/${slug}`
					)
			)
			.map((u) => u.pathname + (u.pathname === '/api/discussions/' ? u.search : ''))
	)
];

/** Wait for the root layout's flag request (e2e trap 25), then let the effects it unblocks run. */
async function settled(page, booted) {
	await booted;
	await page.waitForTimeout(2500);
}

/** Bring every lazy screenshot on the page into view and wait until it has decoded. */
async function loadShots(page) {
	const imgs = page.locator('figure.shot img');
	for (let i = 0; i < (await imgs.count()); i++) {
		const img = imgs.nth(i);
		await img.scrollIntoViewIfNeeded();
		await img
			.evaluate((el) =>
				el.complete && el.naturalWidth > 0
					? null
					: new Promise((r) => {
							el.addEventListener('load', r, { once: true });
							el.addEventListener('error', r, { once: true });
							setTimeout(r, 8000);
						})
			)
			.catch(() => {});
	}
	await page.evaluate(() => window.scrollTo(0, 0));
}

async function open(page, path) {
	// 'load', not 'networkidle': the notification SSE stream never settles on an authenticated page
	// and the dev server's first compile is slow enough to look like a hang either way.
	await page.goto(`${BASE}${path}`, { waitUntil: 'load' });
	await page.locator('article.showcase, section.showcase-index').first().waitFor();
}

try {
	// ---- 1. The index on /about ----------------------------------------------------------------
	{
		const ctx = await browser.newContext({ viewport: DESKTOP });
		const page = await ctx.newPage();
		watch(page);
		await page.goto(`${BASE}/about`, { waitUntil: 'load' });
		const index = page.locator('section.showcase-index');
		await index.waitFor();
		check(
			'/about: the showcase index is mounted at its marker',
			(await index.count()) === 1,
			String(await index.count())
		);
		const cards = index.locator('.showcase-index__card');
		check(
			'/about: twelve showcase cards',
			(await cards.count()) === PAGES.length && PAGES.length === 12,
			String(await cards.count())
		);
		const hrefs = await index
			.locator('.showcase-index__card a')
			.evaluateAll((els) => els.map((el) => el.getAttribute('href')));
		check(
			'/about: every card points at one of the twelve pages',
			PAGES.every((p) => hrefs.includes(`/about/${p.slug}`)),
			hrefs.join(' ')
		);
		await page.screenshot({ path: `${SHOTS}showcase-index-on-about.png`, fullPage: true });
		await ctx.close();
	}

	// ---- 2. All twelve, Polish (the base locale) and English ------------------------------------
	/** Every followable link and every screenshot seen on any page, fetched once each in step 7. */
	const seenLinks = new Set();
	const seenImages = new Set();
	/** showcase slug -> the manual chapter its "Read the manual chapter" link names (or null). */
	const guideLinkOf = {};
	for (const locale of ['pl', 'en']) {
		for (const spec of PAGES) {
			const ctx =
				locale === 'en'
					? await englishContext(browser, BASE, { viewport: DESKTOP })
					: await browser.newContext({ viewport: DESKTOP });
			const page = await ctx.newPage();
			const api = watch(page);
			const booted = page
				.waitForResponse((r) => r.url().includes('/feature-flags/'), { timeout: 30000 })
				.catch(() => null);
			await open(page, `/about/${spec.slug}`);
			await settled(page, booted);

			const h1 = (await page.locator('article.showcase h1').textContent())?.trim();
			check(`${locale} /about/${spec.slug}: h1 is "${spec[locale]}"`, h1 === spec[locale], h1);
			check(
				`${locale} /about/${spec.slug}: exactly one <title>`,
				(await page.locator('head title').count()) === 1
			);
			check(
				`${locale} /about/${spec.slug}: the "nothing here is live" notice is there`,
				(await page.locator('.showcase__notice').count()) >= 1
			);
			const frames = await page.locator('article.showcase figure.frame').count();
			check(
				`${locale} /about/${spec.slug}: ${spec.frames} sample frames`,
				frames === spec.frames,
				`got ${frames}`
			);
			check(
				`${locale} /about/${spec.slug}: ${PAGES.length - 1} links to the other showcase pages`,
				(await page.locator('.showcase__others li a').count()) === PAGES.length - 1
			);

			// The ways out: "Try it yourself", the manual, and the screenshots.
			const tries = await page.locator('.showcase__try a.showcase__try-link').count();
			check(
				`${locale} /about/${spec.slug}: ${spec.tries} "Try it yourself" link(s)`,
				tries === spec.tries,
				`got ${tries}`
			);
			const guideHrefs = await page
				.locator('.showcase__try a.showcase__guide-link')
				.evaluateAll((els) => els.map((a) => new URL(a.href).pathname));
			const expectedGuide = spec.guide ? [`/about/guide/${spec.guide}`] : [];
			check(
				`${locale} /about/${spec.slug}: manual link is ${expectedGuide[0] ?? 'absent'}`,
				JSON.stringify(guideHrefs) === JSON.stringify(expectedGuide),
				guideHrefs.join(' ')
			);
			guideLinkOf[spec.slug] = guideHrefs[0]?.replace('/about/guide/', '') ?? null;

			const shots = page.locator('article.showcase figure.shot');
			check(
				`${locale} /about/${spec.slug}: ${spec.shots} screenshot(s)`,
				(await shots.count()) === spec.shots,
				`got ${await shots.count()}`
			);
			if (spec.shots > 0) {
				// Scroll each into view so the lazy image actually loads, then ask the browser what
				// it decoded — a broken path is naturalWidth 0, a wrong size claim shifts layout.
				const facts = [];
				for (let i = 0; i < spec.shots; i++) {
					const img = shots.nth(i).locator('img');
					await img.scrollIntoViewIfNeeded();
					await img
						.evaluate((el) =>
							el.complete && el.naturalWidth > 0
								? null
								: new Promise((r) => {
										el.addEventListener('load', r, { once: true });
										el.addEventListener('error', r, { once: true });
										setTimeout(r, 8000);
									})
						)
						.catch(() => {});
					facts.push(
						await img.evaluate((el) => ({
							src: new URL(el.src).pathname,
							natural: [el.naturalWidth, el.naturalHeight],
							claimed: [Number(el.getAttribute('width')), Number(el.getAttribute('height'))],
							lazy: el.getAttribute('loading') === 'lazy',
							alt: (el.getAttribute('alt') ?? '').trim().length,
							inert: !!el.closest('[inert]'),
							inFrame: !!el.closest('figure.frame')
						}))
					);
				}
				for (const f of facts) seenImages.add(f.src);
				check(
					`${locale} /about/${spec.slug}: every screenshot decoded at the size it claims`,
					facts.every(
						(f) =>
							f.natural[0] > 0 && f.natural[0] === f.claimed[0] && f.natural[1] === f.claimed[1]
					),
					JSON.stringify(facts.map((f) => [f.src, f.natural, f.claimed]))
				);
				check(
					`${locale} /about/${spec.slug}: screenshots are lazy, have alt text, and are not inside a sample frame`,
					facts.every((f) => f.lazy && f.alt > 20 && !f.inert && !f.inFrame)
				);
				const links = spec.links ?? spec.shots;
				check(
					`${locale} /about/${spec.slug}: ${links} screenshot(s) carry an "open the real page" link`,
					(await page.locator('figure.shot a.shot__open').count()) === links,
					`got ${await page.locator('figure.shot a.shot__open').count()}`
				);
			}

			// Every link a reader can actually follow — which excludes the ones inside an inert
			// frame, because those are part of a picture.
			//
			// `a.href`, not `getAttribute('href')`: SvelteKit's `paths.relative` default emits
			// `../about`, so the raw attribute of the same destination differs by page depth. The
			// resolved pathname is what a click actually goes to, which is the thing being checked.
			const followable = await page.evaluate(() =>
				Array.from(document.querySelectorAll('article.showcase a[href]'))
					.filter((a) => !a.closest('[inert]'))
					.map((a) => new URL(a.href).pathname)
			);
			for (const href of followable) seenLinks.add(href);
			if (LOCALIZED[spec.slug]) {
				const { en, pl } = LOCALIZED[spec.slug];
				const own = locale === 'pl' ? pl : en;
				const other = locale === 'pl' ? en : pl;
				check(
					`${locale} /about/${spec.slug}: live links use the reader's own address (${own}, never ${other})`,
					followable.includes(own) && !followable.includes(other),
					followable.join(' ')
				);
			}
			const strays = followable.filter((href) => !ALLOWED.includes(href));
			check(
				`${locale} /about/${spec.slug}: every followable link is a route that exists`,
				strays.length === 0,
				strays.join(' ')
			);

			if (locale === 'en') {
				await loadShots(page);
				await page.screenshot({
					path: `${SHOTS}showcase-${spec.slug}.png`,
					fullPage: true
				});
			}
			const extra = beyondBoot(api, spec.slug);
			check(
				`${locale} /about/${spec.slug}: asked for nothing beyond the layout's boot requests and its own discussion policy`,
				extra.length === 0,
				extra.join(' ')
			);
			await ctx.close();
		}
	}

	// ---- 3. An inert sample cannot be clicked through -------------------------------------------
	{
		const ctx = await englishContext(browser, BASE, { viewport: DESKTOP });
		const page = await ctx.newPage();
		watch(page);
		await open(page, '/about/exercises');
		const card = page.locator('figure.frame [inert] article.exercise-card').first();
		await card.waitFor();
		check(
			'the sample exercise card is inside an inert region',
			(await page.locator('figure.frame [inert]').count()) >= 1
		);
		// `force` because an inert element is not hittable — which is the point: without force,
		// Playwright would time out and the check would pass for the wrong reason.
		await card.click({ force: true, timeout: 2000 }).catch(() => {});
		await page.waitForTimeout(400);
		check(
			'clicking it does not navigate to the exercise it names',
			new URL(page.url()).pathname === '/about/exercises',
			page.url()
		);
		await ctx.close();
	}

	// ---- 4. The one live sample works, and stores nothing ---------------------------------------
	{
		const ctx = await englishContext(browser, BASE, { viewport: DESKTOP });
		const page = await ctx.newPage();
		const api = watch(page);
		// e2e/CLAUDE.md trap 25: every control is in the server-rendered HTML, so the button
		// RESOLVES long before a click does anything. Registered before `goto`, this waits for the
		// root layout's own boot request, and the retry loop below covers the rest of the gap —
		// without it the first click is simply lost and the back face never appears at all.
		const booted = page
			.waitForResponse((r) => r.url().includes('/feature-flags/'), { timeout: 30000 })
			.catch(() => null);
		await open(page, '/about/flashcards');
		await booted;
		const flip = page.locator('.flip__turn');
		await flip.waitFor();
		const back = page.locator('.flip__face--back');

		check(
			'flashcards: the back of the card is hidden until it is turned',
			(await back.count()) === 0
		);

		// Everything after this point is the reader operating the sample, and must cost nothing.
		await page.waitForTimeout(1500);
		const before = api.paths.length;

		let turned = false;
		for (let attempt = 0; attempt < 6 && !turned; attempt++) {
			await flip.click();
			await page.waitForTimeout(700);
			turned = (await back.count()) === 1;
		}
		check('flashcards: turning it over shows the back', turned);
		check('flashcards: four grade buttons', (await page.locator('.flip__grade').count()) === 4);

		const outcome = page.locator('.flip__outcome');
		const prompt = (await outcome.textContent())?.trim();
		await page.locator('.flip__grade').nth(3).click();
		await page.waitForTimeout(200);
		const graded = (await outcome.textContent())?.trim();
		check(
			'flashcards: grading changes the line under the buttons',
			graded !== prompt,
			`${prompt} -> ${graded}`
		);
		check(
			'flashcards: the line says nothing was saved',
			/Nothing was saved|nie zosta/.test(graded ?? ''),
			graded
		);
		await page.locator('.flip__linklike').click();
		await page.waitForTimeout(200);
		check(
			'flashcards: the hint can be revealed',
			(await page.locator('.flip__hint').count()) === 1
		);

		check(
			'flashcards: operating the sample made no request at all',
			api.paths.length === before,
			`${before} -> ${api.paths.length}`
		);
		await page.screenshot({ path: `${SHOTS}showcase-flashcards-graded.png`, fullPage: true });
		await ctx.close();
	}

	// ---- 5. Phone width, and the dark theme ----------------------------------------------------
	{
		for (const slug of [
			'exercises',
			'courses',
			'learning-record',
			'flashcards',
			'concepts',
			'goals-and-work',
			'tutoring',
			'materials',
			'conference'
		]) {
			const ctx = await englishContext(browser, BASE, { viewport: PHONE });
			const page = await ctx.newPage();
			watch(page);
			await open(page, `/about/${slug}`);
			// The screenshots are lazy, so a full-page shot taken from the top shows empty boxes.
			// Scroll each into view and wait for it, so the picture of the phone is the real one.
			await loadShots(page);
			const overflow = await page.evaluate(
				() => document.documentElement.scrollWidth - document.documentElement.clientWidth
			);
			check(
				`phone /about/${slug}: no horizontal overflow`,
				overflow <= 0,
				`overflow ${overflow}px`
			);
			await page.screenshot({ path: `${SHOTS}showcase-${slug}-phone.png`, fullPage: true });
			await ctx.close();
		}

		const ctx = await englishContext(browser, BASE, { viewport: DESKTOP });
		const page = await ctx.newPage();
		watch(page);
		await open(page, '/about/courses');
		await page.evaluate(() => {
			localStorage.setItem('edmat-theme', 'dark');
			document.documentElement.setAttribute('data-theme', 'dark');
		});
		await page.waitForTimeout(200);
		await loadShots(page);
		await page.screenshot({ path: `${SHOTS}showcase-courses-dark.png`, fullPage: true });
		check(
			'dark theme: the page still has its samples',
			(await page.locator('figure.frame').count()) === 5
		);
		// And one module page, whose facts list and section-off note have their own colours.
		await open(page, '/about/materials');
		await page.evaluate(() => {
			localStorage.setItem('edmat-theme', 'dark');
			document.documentElement.setAttribute('data-theme', 'dark');
		});
		await page.waitForTimeout(200);
		await loadShots(page);
		await page.screenshot({ path: `${SHOTS}showcase-materials-dark.png`, fullPage: true });
		check(
			'dark theme: /about/materials draws its licence facts',
			(await page.locator('.module-section__facts dt').count()) === 7
		);
		await ctx.close();
	}

	// ---- 7. Every link a reader can follow, and every picture, answers ------------------------
	// Fetched from the server rather than clicked: the dev server SSRs every route, so an unknown
	// path is a real 404 here, and a static PNG must come back as an image.
	{
		// `/dziennik/` is the one exception: a separate static bundle the vhost serves beside the SPA
		// (HISTORY.md §17BO), so the dev server honestly has no such page.
		for (const href of [...seenLinks].filter((h) => h !== '/dziennik/').sort()) {
			const res = await fetch(`${BASE}${href}`, { redirect: 'manual' });
			check(`link ${href} answers 200`, res.status === 200, String(res.status));
		}
		for (const src of [...seenImages].sort()) {
			const res = await fetch(`${BASE}${src}`);
			check(
				`screenshot ${src} is served as a PNG`,
				res.status === 200 && (res.headers.get('content-type') ?? '').includes('image/png'),
				`${res.status} ${res.headers.get('content-type')}`
			);
		}
	}

	// ---- 8. The manual link agrees with the manual --------------------------------------------
	// `components/showcase/hrefs.ts: SHOWCASE_GUIDE` is kept by hand (it says why). The truth is
	// `GUIDE_CHAPTERS[].showcase`, which each chapter page draws as its "see the design" link — so
	// read it off every chapter the hub lists, and require the two directions to match exactly.
	{
		const ctx = await englishContext(browser, BASE, { viewport: DESKTOP });
		const page = await ctx.newPage();
		watch(page);
		await page.goto(`${BASE}/about/guide`, { waitUntil: 'load' });
		await page.locator('h1').first().waitFor();
		const chapters = [
			...new Set(
				await page.evaluate(() =>
					Array.from(document.querySelectorAll('main a[href]'))
						.map((a) => new URL(a.href).pathname)
						.filter((p) => /^\/about\/guide\/[a-z-]+$/.test(p))
						.map((p) => p.split('/').pop())
				)
			)
		];
		check('manual hub lists at least ten chapters', chapters.length >= 10, String(chapters.length));
		const fromManual = {};
		for (const chapter of chapters) {
			await page.goto(`${BASE}/about/guide/${chapter}`, { waitUntil: 'load' });
			await page.locator('h1').first().waitFor();
			const targets = await page.evaluate(
				(slugs) => {
					return Array.from(document.querySelectorAll('main a[href]'))
						.map((a) => new URL(a.href).pathname)
						.filter((p) => slugs.some((s) => p === `/about/${s}`));
				},
				PAGES.map((p) => p.slug)
			);
			for (const t of new Set(targets)) fromManual[t.replace('/about/', '')] = chapter;
		}
		for (const spec of PAGES) {
			check(
				`manual and /about/${spec.slug} agree on its chapter (${fromManual[spec.slug] ?? 'none'})`,
				(fromManual[spec.slug] ?? null) === guideLinkOf[spec.slug],
				`manual says ${fromManual[spec.slug] ?? 'none'}, showcase says ${guideLinkOf[spec.slug]}`
			);
		}
		await ctx.close();
	}

	// ---- 9. A killed feature's links disappear ------------------------------------------------
	// The flag list is rewritten IN THE BROWSER (page.route), so no database row changes and no
	// other worktree is affected. Signed out = not staff, so there is no moderator bypass (e2e
	// trap 10).
	{
		const ctx = await englishContext(browser, BASE, { viewport: DESKTOP });
		const page = await ctx.newPage();
		watch(page);
		await page.route('**/api/feature-flags/**', async (route) => {
			const res = await route.fetch();
			const flags = await res.json();
			const off = new Set(['flashcards', 'concepts']);
			await route.fulfill({
				response: res,
				json: flags.map((f) => (off.has(f.key) ? { ...f, is_enabled: false } : f))
			});
		});
		const booted = page
			.waitForResponse((r) => r.url().includes('/feature-flags/'), { timeout: 30000 })
			.catch(() => null);
		await open(page, '/about/flashcards');
		await booted;
		await page.waitForTimeout(1500);
		const links = await page.evaluate(() =>
			Array.from(document.querySelectorAll('article.showcase a[href]'))
				.filter((a) => !a.closest('[inert]'))
				.map((a) => new URL(a.href).pathname)
		);
		check(
			'flashcards off: no followable link to /flashcards is left',
			!links.includes('/flashcards'),
			links.join(' ')
		);
		check(
			'flashcards off: the screenshots stay, without their "open" links',
			(await page.locator('figure.shot').count()) === 2 &&
				(await page.locator('figure.shot a.shot__open').count()) === 0
		);
		check(
			'flashcards off: /my-set (no switch) is still offered',
			links.includes('/my-set'),
			links.join(' ')
		);
		check(
			'flashcards off: the manual link stays (the chapter is prose)',
			links.includes('/about/guide/flashcards')
		);
		check(
			'flashcards off: the page says the feature is switched off',
			(await page.locator('.showcase__notice--off').count()) === 1
		);
		await page.screenshot({ path: `${SHOTS}showcase-flashcards-killed.png`, fullPage: true });

		const rebooted = page
			.waitForResponse((r) => r.url().includes('/feature-flags/'), { timeout: 30000 })
			.catch(() => null);
		await open(page, '/about/concepts');
		await rebooted;
		await page.waitForTimeout(1500);
		const conceptLinks = await page.evaluate(() =>
			Array.from(document.querySelectorAll('article.showcase a[href]'))
				.filter((a) => !a.closest('[inert]'))
				.map((a) => new URL(a.href).pathname)
		);
		check(
			'concepts off: the "Try it" row is down to the manual link, and /concepts is gone',
			!conceptLinks.includes('/concepts') &&
				(await page.locator('.showcase__try a.showcase__try-link').count()) === 0 &&
				(await page.locator('.showcase__try a.showcase__guide-link').count()) === 1,
			conceptLinks.join(' ')
		);
		await ctx.close();
	}

	// ---- 9b. The module pages' switches -------------------------------------------------------
	// Same interception as above. Each module page answers to several switches: the page-wide
	// notice for its main one (tutoring, events), a one-line note on each section whose own feature
	// is off, and every live link dropped by `SHOWCASE_LIVE`. Screenshots stay, without their links.
	{
		/** Open `path` with `off` switched off in the browser; return the followable links. */
		async function withOff(off, path) {
			const ctx = await englishContext(browser, BASE, { viewport: DESKTOP });
			const page = await ctx.newPage();
			watch(page);
			await page.route('**/api/feature-flags/**', async (route) => {
				const res = await route.fetch();
				const flags = await res.json();
				await route.fulfill({
					response: res,
					json: flags.map((f) => (off.includes(f.key) ? { ...f, is_enabled: false } : f))
				});
			});
			const booted = page
				.waitForResponse((r) => r.url().includes('/feature-flags/'), { timeout: 30000 })
				.catch(() => null);
			await open(page, path);
			await settled(page, booted);
			const links = await page.evaluate(() =>
				Array.from(document.querySelectorAll('article.showcase a[href]'))
					.filter((a) => !a.closest('[inert]'))
					.map((a) => new URL(a.href).pathname)
			);
			return { ctx, page, links };
		}
		const tries = (page) => page.locator('.showcase__try a.showcase__try-link').count();
		const offNote = (page, key) =>
			page.locator(`section[data-section="${key}"] .module-section__off`).count();

		{
			const { ctx, page, links } = await withOff(['tutoring'], '/about/tutoring');
			check(
				'tutoring off: no link to /tutoring or /bookings is left',
				!links.includes('/tutoring') && !links.includes('/bookings'),
				links.join(' ')
			);
			check(
				'tutoring off: the page says so',
				(await page.locator('.showcase__notice--off').count()) === 1
			);
			check(
				'tutoring off: three screenshots, none with an "open" link',
				(await page.locator('figure.shot').count()) === 3 &&
					(await page.locator('figure.shot a.shot__open').count()) === 0
			);
			check('tutoring off: the manual link stays', links.includes('/about/guide/tutoring'));
			await ctx.close();
		}
		{
			const { ctx, page, links } = await withOff(
				['needs', 'tasks', 'organizations'],
				'/about/goals-and-work'
			);
			check(
				'needs+tasks+organizations off: the "Try it" row is empty',
				(await tries(page)) === 0 && !links.includes('/needs') && !links.includes('/tasks'),
				links.join(' ')
			);
			check(
				'needs off: the help-wanted section says it is switched off, goals does not',
				(await offNote(page, 'needs')) === 1 && (await offNote(page, 'goals')) === 0
			);
			check(
				'tasks off but plans on: "Plans and tasks" is not marked off',
				(await offNote(page, 'plans-and-tasks')) === 0
			);
			check(
				'some features still on: no page-wide "switched off" notice',
				(await page.locator('.showcase__notice--off').count()) === 0
			);
			await page.screenshot({ path: `${SHOTS}showcase-goals-killed.png`, fullPage: true });
			await ctx.close();
		}
		{
			const { ctx, page, links } = await withOff(
				['coauthoring', 'attachments'],
				'/about/materials'
			);
			check(
				'coauthoring off: /material-projects is gone, /materials (no switch) stays',
				!links.includes('/material-projects') && links.includes('/materials'),
				links.join(' ')
			);
			check(
				'coauthoring+attachments off: both sections say so, licences does not',
				(await offNote(page, 'coauthoring')) === 1 &&
					(await offNote(page, 'attachments')) === 1 &&
					(await offNote(page, 'licences')) === 0
			);
			await ctx.close();
		}
		{
			const { ctx, page, links } = await withOff(
				['events', 'venues', 'tickets', 'cloakroom'],
				'/about/conference'
			);
			check(
				'events+venues off: only "Your volunteering hours" is left to try',
				(await tries(page)) === 1 &&
					links.includes('/volunteering/hours') &&
					!links.includes('/conference') &&
					!links.includes('/venues') &&
					!links.includes('/events'),
				links.join(' ')
			);
			check(
				'events off: the page says so',
				(await page.locator('.showcase__notice--off').count()) === 1
			);
			check(
				'venues, tickets, cloakroom off: their sections say so; shifts does not',
				(await offNote(page, 'venue')) === 1 &&
					(await offNote(page, 'tickets')) === 1 &&
					(await offNote(page, 'cloakroom')) === 1 &&
					(await offNote(page, 'shifts')) === 0
			);
			await page.screenshot({ path: `${SHOTS}showcase-conference-killed.png`, fullPage: true });
			await ctx.close();
		}
	}

	// ---- 9c. `/work` is offered only to a signed-in reader ------------------------------------
	// It answers a signed-out visitor with an error, not a sign-in prompt, so the shell draws it
	// only after sign-in. E2E_TOKEN (any account's DRF token, e2e trap 30) turns this on.
	if (process.env.E2E_TOKEN) {
		const ctx = await englishContext(browser, BASE, { viewport: DESKTOP });
		await ctx.addInitScript(
			(t) => localStorage.setItem('edmat-auth-token', t),
			process.env.E2E_TOKEN
		);
		const page = await ctx.newPage();
		watch(page);
		const booted = page
			.waitForResponse((r) => r.url().includes('/feature-flags/'), { timeout: 30000 })
			.catch(() => null);
		await open(page, '/about/goals-and-work');
		await settled(page, booted);
		const tryHrefs = await page
			.locator('.showcase__try a.showcase__try-link')
			.evaluateAll((els) => els.map((a) => new URL(a.href).pathname));
		check(
			'signed in: goals-and-work offers four links, /work among them',
			tryHrefs.length === 4 && tryHrefs.includes('/work'),
			tryHrefs.join(' ')
		);
		await ctx.close();
	} else {
		console.log('  (skipped: the signed-in /work link — set E2E_TOKEN to check it)');
	}

	// ---- 10. A screenshot's link really goes to the real page ---------------------------------
	{
		const ctx = await englishContext(browser, BASE, { viewport: DESKTOP });
		const page = await ctx.newPage();
		watch(page);
		const booted = page
			.waitForResponse((r) => r.url().includes('/feature-flags/'), { timeout: 30000 })
			.catch(() => null);
		await open(page, '/about/concepts');
		await booted;
		const link = page.locator('figure.shot a.shot__open').first();
		await link.scrollIntoViewIfNeeded();
		await Promise.all([
			page.waitForURL((u) => u.pathname === '/concepts', { timeout: 15000 }).catch(() => {}),
			link.click()
		]);
		check(
			'clicking "Open the real page" under the concepts screenshot lands on /concepts',
			new URL(page.url()).pathname === '/concepts',
			page.url()
		);
		await ctx.close();
	}

	// ---- 6. The server-rendered HTML carries the page, not just the shell ----------------------
	{
		// The module pages are prose too: their sections and the sample's caption are in the HTML.
		const html = await (await fetch(`${BASE}/about/conference`)).text();
		check(
			'raw HTML of /about/conference carries its sections and its sample',
			(html.includes('Prowadzenie konferencji') || html.includes('Running a conference')) &&
				html.split('module-section__body').length - 1 >= 10 &&
				html.includes('figcaption')
		);
	}
	// These seven are prerendered in production; on the dev server the same code path SSRs them, so
	// a fetch with no JavaScript at all is what proves the text is in the HTML rather than painted
	// by the bundle. The maths is the sharper half of it: a typeset `.katex` span in the raw HTML
	// means the root layout's server-side loadMath() ran (frontend/CLAUDE.md).
	{
		const html = await (await fetch(`${BASE}/about/exercises`)).text();
		check(
			'raw HTML of /about/exercises carries its h1',
			html.includes('Zadanie, zestaw, talia') || html.includes('An exercise, a set, a deck')
		);
		// `class="katex"` is the typeset output. KaTeX also emits the original TeX inside a MathML
		// `<annotation>`, so the raw source APPEARING in the HTML is correct and is not the thing to
		// assert on — `check:katex` strips annotations first for exactly that reason.
		const katexCount = html.split('class="katex').length - 1;
		check(
			'raw HTML of /about/exercises carries typeset KaTeX',
			katexCount >= 4,
			`${katexCount} katex node(s)`
		);
		check(
			'raw HTML of /about/exercises carries its sample captions, not just the shell',
			html.includes('figcaption')
		);
	}
} finally {
	await browser.close();
}

check('zero console/page errors', errors.length === 0, errors.join(' | ').slice(0, 400));
check(
	'zero failed requests',
	failedRequests.length === 0,
	failedRequests.join(' | ').slice(0, 400)
);
console.log(
	`\nAPI base was ${API} (these pages ask it only for the layout's boot requests and their own discussion policy).`
);
console.log(`${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
