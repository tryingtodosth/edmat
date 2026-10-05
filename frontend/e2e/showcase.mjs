// The design showcase under `/about/<feature>` (HISTORY.md §17BR.G, prompts/08-about-showcase.md).
//
// Seven prerendered pages built from sample data in `lib/content/showcase/`. What this script is
// actually for:
//
//   1. all seven open, in BOTH interface languages, each with its own `<h1>`, the honest "nothing
//      here is live" notice, and at least one sample frame — with zero console/page errors and
//      zero failed requests;
//   2. nothing on them reaches the API. The whole claim of these pages is that they need no
//      backend, so the script counts `/api/` requests after the page has settled and asserts that
//      operating the one live sample (the flashcard) adds none;
//   3. a sample card cannot be clicked through. The samples are drawn with the real components, so
//      `ExerciseCard` links to `/exercises/9001` — an id that exists in a content file and in no
//      database. `SampleFrame` wraps them in `inert`; this clicks one and asserts the URL did not
//      move, which is the only way to tell a working `inert` from a decorative attribute;
//   4. every link a reader CAN follow goes somewhere that exists (the allowlist below);
//   5. the index of the seven is on `/about` with seven cards, and no page overflows at phone
//      width.
//
// Deliberately NOT asserted: that `/flashcards`, `/users/{id}` or any other surface the seven
// pages DESCRIBE exists. Those belong to the other steps of this cycle and are not on this branch.
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

/** The seven, with the `<h1>` each must show in each language. */
const PAGES = [
	{
		slug: 'exercises',
		pl: 'Zadanie, zestaw, talia',
		en: 'An exercise, a set, a deck',
		frames: 4
	},
	{
		slug: 'flashcards',
		pl: 'Fiszki i powtórki w odstępach',
		en: 'Flashcards and spaced review',
		frames: 4
	},
	{ slug: 'learning-record', pl: 'Rejestr nauki', en: 'The learning record', frames: 4 },
	{
		slug: 'courses',
		pl: 'Kurs, tydzień, zaświadczenie',
		en: 'A course, a week, a certificate',
		frames: 5
	},
	{ slug: 'schools', pl: 'Szkoła w EdMacie', en: 'A school on EdMat', frames: 3 },
	{
		slug: 'concepts',
		pl: 'Pojęcia i co trzeba wiedzieć wcześniej',
		en: 'Concepts, and what to learn first',
		frames: 5
	},
	{ slug: 'events', pl: 'Co zostaje po wydarzeniu', en: 'What an event leaves behind', frames: 4 }
];

/**
 * Every route a showcase page is allowed to send a reader to. `/dziennik/` is the school-logbook
 * demonstration — not a route of this app but a real published path (HISTORY.md §17BO). Anything
 * outside this list is a link that would 404 or lead somewhere that is not on this branch.
 */
const ALLOWED = [
	'/about',
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
	'/dziennik/'
];

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
const LAYOUT_BOOT = ['/api/feature-flags/', '/api/locale-hint/', '/api/material-types/'];

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
	const api = { paths: [] };
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
		if (isApiRequest(url)) api.paths.push(new URL(url).pathname);
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

/** Which API paths this page asked for that the root layout does not ask for everywhere. */
const beyondBoot = (api) => [...new Set(api.paths.filter((p) => !LAYOUT_BOOT.includes(p)))];

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
		check('/about: seven showcase cards', (await cards.count()) === 7, String(await cards.count()));
		const hrefs = await index
			.locator('.showcase-index__card a')
			.evaluateAll((els) => els.map((el) => el.getAttribute('href')));
		check(
			'/about: every card points at one of the seven pages',
			PAGES.every((p) => hrefs.includes(`/about/${p.slug}`)),
			hrefs.join(' ')
		);
		await page.screenshot({ path: `${SHOTS}showcase-index-on-about.png`, fullPage: true });
		await ctx.close();
	}

	// ---- 2. All seven, Polish (the base locale) and English ------------------------------------
	for (const locale of ['pl', 'en']) {
		for (const spec of PAGES) {
			const ctx =
				locale === 'en'
					? await englishContext(browser, BASE, { viewport: DESKTOP })
					: await browser.newContext({ viewport: DESKTOP });
			const page = await ctx.newPage();
			const api = watch(page);
			await open(page, `/about/${spec.slug}`);

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
				`${locale} /about/${spec.slug}: six links to the other showcase pages`,
				(await page.locator('.showcase__others li a').count()) === 6
			);

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
			const strays = followable.filter((href) => !ALLOWED.includes(href));
			check(
				`${locale} /about/${spec.slug}: every followable link is a route that exists`,
				strays.length === 0,
				strays.join(' ')
			);

			if (locale === 'en') {
				await page.screenshot({
					path: `${SHOTS}showcase-${spec.slug}.png`,
					fullPage: true
				});
			}
			const extra = beyondBoot(api);
			check(
				`${locale} /about/${spec.slug}: asked for nothing beyond the layout's boot requests`,
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
		for (const slug of ['exercises', 'courses', 'learning-record']) {
			const ctx = await englishContext(browser, BASE, { viewport: PHONE });
			const page = await ctx.newPage();
			watch(page);
			await open(page, `/about/${slug}`);
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
		await page.screenshot({ path: `${SHOTS}showcase-courses-dark.png`, fullPage: true });
		check(
			'dark theme: the page still has its samples',
			(await page.locator('figure.frame').count()) === 5
		);
		await ctx.close();
	}

	// ---- 6. The server-rendered HTML carries the page, not just the shell ----------------------
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
console.log(`\nAPI base was ${API} (used only to say so — these pages call nothing).`);
console.log(`${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
