// "Where to start" on the homepage, the footer's manual link, and three small fixes (WP2 of the
// 2026-10-14 loop). Everything runs in BOTH interface languages — English through `english.mjs`,
// Polish as the default a fresh context gets — and every visible string checked is compared with
// the catalogue, so a key missing from one language fails here.
//
//   1. The band (`lib/components/home/StartHere.svelte`) is in the server-rendered HTML of `/`,
//      draws three doors, and each door lands on a real page: the "Getting started" chapter (not
//      the "no chapter under that address" line), `/about`, `/disciplines`.
//   2. "Hide" takes it away, remembers that in localStorage, and a reload does not bring it back;
//      clearing the key brings it back. With storage untouched it never moves the tabs: the tab
//      strip's position is read before and after hydration and must not change.
//   3. The footer's "Manual" link opens `/about/guide`.
//   4. Fix (a): `/contests` signed out has no "New contest" in its header; signed in as an account
//      the creation gate allows (`E2E_TOKEN`, optional — kasia's token), it does.
//   5. Fix (b): `/concepts` at 390px — the Tag select (whose options include 40-character tags in
//      the dev database) ends inside the window, and the page has no horizontal scroll.
//   6. Fix (c): `/my-set` with items in the guest set, the bulk exercise fetch held back for 1.5 s:
//      the empty state is never drawn, a loading skeleton is, and then the list arrives.
//
// Screenshots go to `e2e/screenshots/home-start-*.png` (1280 and 390, light and dark) — LOOK at them.
//
//   E2E_BASE=http://localhost:5201 E2E_API=http://127.0.0.1:8051 CHROME=<chrome-headless-shell> \
//     [E2E_TOKEN=<a token the creation gate allows>] node e2e/home-start.mjs
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
const TOKEN = process.env.E2E_TOKEN ?? '';
const SHOTS = 'e2e/screenshots';
mkdirSync(SHOTS, { recursive: true });

const CATALOGUE = {
	en: JSON.parse(readFileSync(new URL('../messages/en.json', import.meta.url), 'utf8')),
	pl: JSON.parse(readFileSync(new URL('../messages/pl.json', import.meta.url), 'utf8'))
};

let pass = 0,
	fail = 0;
const errors = [];
let fontNoise = 0;
const check = (label, ok, extra = '') => {
	if (ok) pass++;
	else fail++;
	console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${label} ${ok ? '' : extra}`);
};

// KaTeX webfonts 403 on a WORKTREE dev server (e2e/CLAUDE.md trap 26) — the homepage's exercise
// cards carry maths. Dropped by URL, counted, printed; anything else fails the run.
const KATEX_FONT = /\/katex\/dist\/fonts\//;
function watch(page) {
	page.on('pageerror', (e) => errors.push(String(e)));
	let refused = 0;
	page.on('response', (r) => {
		if (r.status() >= 400 && KATEX_FONT.test(r.url())) refused++;
	});
	page.on('console', (msg) => {
		if (msg.type() !== 'error') return;
		const location = msg.location?.()?.url ?? '';
		if (KATEX_FONT.test(location)) {
			fontNoise++;
			return;
		}
		if (!location && msg.text().includes('Failed to load resource') && refused > 0) {
			refused--;
			fontNoise++;
			return;
		}
		errors.push(msg.text());
	});
}

/** Go somewhere and wait for the root layout's own boot request (trap 25): an element in the
 * server-rendered HTML resolves long before its click handler exists. */
async function open(page, path) {
	const booted = page.waitForResponse((r) => r.url().includes('/feature-flags/'), {
		timeout: 60000
	});
	await page.goto(`${BASE}${path}`, { waitUntil: 'load' });
	await booted;
	await page.waitForTimeout(300);
}

const browser = await chromium.launch(
	process.env.CHROME ? { executablePath: process.env.CHROME } : {}
);

async function contextFor(locale, options = {}) {
	return locale === 'en' ? englishContext(browser, BASE, options) : browser.newContext(options);
}

// ---- 1. the band is in the static HTML ---------------------------------------------------------
{
	const html = await (await fetch(`${BASE}/`)).text();
	check('the band is in the server-rendered HTML of /', html.includes('data-start-here'));
	check(
		'all three doors are in that HTML',
		['guide', 'showcase', 'try'].every((d) => html.includes(`data-start-door="${d}"`))
	);
}

for (const locale of ['en', 'pl']) {
	const t = CATALOGUE[locale];
	console.log(`\n== ${locale} ==`);

	// ---- 1–2. doors, dismissal, no shift --------------------------------------------------------
	{
		const ctx = await contextFor(locale, { viewport: { width: 1280, height: 800 } });
		let page = await ctx.newPage();
		watch(page);
		// The band's own footprint as first painted, before any script ran, vs. after hydration and
		// its onMount: with storage empty it must neither collapse nor grow. Measured as the distance
		// from the band's top to the tab strip's, because the hero's hidden-languages notice arrives
		// with a list request and moves both on its own — that shift is not this band's.
		const gap = async () => {
			const b = await page.locator('[data-start-here]').boundingBox();
			const tabs = await page.locator('[role="tablist"]').first().boundingBox();
			return b && tabs ? tabs.y - b.y : null;
		};
		await page.goto(`${BASE}/`, { waitUntil: 'commit' });
		await page.locator('[role="tablist"]').first().waitFor();
		const before = await gap();
		await open(page, '/');
		let band = page.locator('[data-start-here]');
		check(`[${locale}] the band is drawn`, (await band.count()) === 1);
		const after = await gap();
		check(
			`[${locale}] the band is in the first paint and keeps its size through hydration`,
			before !== null && after !== null && Math.abs(after - before) < 1,
			`before ${before} after ${after}`
		);
		check(
			`[${locale}] the doors read the catalogue`,
			(await band.locator('[data-start-door="guide"]').innerText()).includes(
				t.startHere_guideLink
			) &&
				(await band.locator('[data-start-door="showcase"]').innerText()).includes(
					t.startHere_showcaseLink
				) &&
				(await band.locator('[data-start-door="try"]').innerText()).includes(t.startHere_tryLink)
		);
		const tabsTop = (await page.locator('[role="tablist"]').first().boundingBox())?.y;
		const firstCard = page.locator('.panel .grid > *').first();
		await firstCard.waitFor({ timeout: 30000 }).catch(() => {});
		const cardBox = await firstCard.boundingBox();
		check(
			`[${locale}] the first row of exercises still starts above the fold at 1280×800`,
			cardBox !== null && cardBox.y < 800,
			`tabs at ${tabsTop}, first card at ${cardBox?.y}`
		);
		await page.screenshot({ path: `${SHOTS}/home-start-1280-light-${locale}.png` });

		// Each door, followed by a real click — a fresh tab per door, because a long chain of full
		// loads in one tab crashed Chromium here (trap 3), on /about's weight.
		const doors = [
			{
				key: 'guide',
				path: '/about/guide/start',
				ok: async (p) =>
					(await p.locator('h1').count()) === 1 &&
					!(await p.locator('main').innerText()).includes(t.guide_unknownChapter)
			},
			{ key: 'showcase', path: '/about', ok: async (p) => (await p.locator('h1').count()) > 0 },
			{ key: 'try', path: '/disciplines', ok: async (p) => (await p.locator('h1').count()) > 0 }
		];
		await page.close();
		for (const door of doors) {
			const p = await ctx.newPage();
			watch(p);
			await open(p, '/');
			await p.locator(`[data-start-door="${door.key}"]`).click();
			await p.waitForURL((u) => u.pathname === door.path, { timeout: 15000 }).catch(() => {});
			await p.waitForTimeout(500);
			const at = new URL(p.url()).pathname;
			check(
				`[${locale}] "${door.key}" lands on ${door.path}`,
				at === door.path && (await door.ok(p)),
				`at ${at}`
			);
			await p.close();
		}
		page = await ctx.newPage();
		watch(page);
		band = page.locator('[data-start-here]');

		// Dismissal.
		await open(page, '/');
		await page.locator('[data-start-hide]').click();
		check(`[${locale}] Hide takes the band away`, (await band.count()) === 0);
		check(
			`[${locale}] …and remembers it`,
			(await page.evaluate(() => localStorage.getItem('edmat.startHere.hidden'))) === '1'
		);
		await open(page, '/');
		check(`[${locale}] a reload does not bring it back`, (await band.count()) === 0);
		await page.evaluate(() => localStorage.removeItem('edmat.startHere.hidden'));
		await open(page, '/');
		check(`[${locale}] clearing the key brings it back`, (await band.count()) === 1);

		// ---- 3. the footer's manual link ------------------------------------------------------------
		const manual = page.locator('footer [data-footer-manual]');
		check(
			`[${locale}] the footer says "${t.startHere_footerManual}"`,
			(await manual.innerText()).trim() === t.startHere_footerManual
		);
		await manual.click();
		await page.waitForURL((u) => u.pathname === '/about/guide', { timeout: 15000 }).catch(() => {});
		check(
			`[${locale}] …and opens the manual`,
			new URL(page.url()).pathname === '/about/guide' && (await page.locator('h1').count()) > 0
		);

		// ---- 4. fix (a): /contests signed out -------------------------------------------------------
		await open(page, '/contests');
		await page.locator('h1').first().waitFor();
		await page.waitForTimeout(800);
		check(
			`[${locale}] /contests signed out: no "New contest" in the header`,
			(await page.locator('header.head a[href="/contests/new"]').count()) === 0
		);
		await ctx.close();
	}

	// Dark theme at 1280, for looking at.
	{
		const ctx = await contextFor(locale, {
			viewport: { width: 1280, height: 800 },
			colorScheme: 'dark'
		});
		const page = await ctx.newPage();
		watch(page);
		await open(page, '/');
		await page
			.locator('.panel .grid > *')
			.first()
			.waitFor({ timeout: 30000 })
			.catch(() => {});
		await page.screenshot({ path: `${SHOTS}/home-start-1280-dark-${locale}.png` });
		await ctx.close();
	}

	// ---- 4b. fix (a), signed in -------------------------------------------------------------------
	if (TOKEN) {
		const creation = await (
			await fetch(`${API}/api/creation/`, { headers: { Authorization: `Token ${TOKEN}` } })
		).json();
		const ctx = await contextFor(locale, { viewport: { width: 1280, height: 800 } });
		await ctx.addInitScript((token) => {
			localStorage.setItem('edmat-auth-token', token);
		}, TOKEN);
		const page = await ctx.newPage();
		watch(page);
		await open(page, '/contests');
		await page.locator('h1').first().waitFor();
		const expected = creation.contest === null;
		await page
			.locator('header.head a[href="/contests/new"]')
			.waitFor({ timeout: expected ? 15000 : 1500 })
			.catch(() => {});
		const button = page.locator('header.head a[href="/contests/new"]');
		check(
			`[${locale}] /contests signed in: "New contest" is drawn exactly when the gate allows (${expected})`,
			((await button.count()) === 1) === expected
		);
		if (expected)
			check(
				`[${locale}] …and reads the catalogue`,
				(await button.innerText()).trim() === t.contests_newContest
			);
		await ctx.close();
	} else {
		console.log('  (E2E_TOKEN unset: the signed-in half of fix (a) is skipped)');
	}

	// ---- 5. fix (b) and the phone screenshots -----------------------------------------------------
	for (const scheme of ['light', 'dark']) {
		const ctx = await contextFor(locale, {
			viewport: { width: 390, height: 844 },
			colorScheme: scheme,
			isMobile: true,
			hasTouch: true
		});
		const page = await ctx.newPage();
		watch(page);
		await open(page, '/');
		await page
			.locator('.panel .grid > *')
			.first()
			.waitFor({ timeout: 30000 })
			.catch(() => {});
		check(
			`[${locale}/${scheme}] / at 390: no horizontal scroll`,
			(await page.evaluate(() => document.documentElement.scrollWidth)) <= 390
		);
		const band = await page.locator('[data-start-here]').boundingBox();
		check(
			`[${locale}/${scheme}] / at 390: the band fits the window`,
			band !== null && band.x >= 0 && band.x + band.width <= 390
		);
		await page.screenshot({ path: `${SHOTS}/home-start-390-${scheme}-${locale}.png` });

		if (scheme === 'light') {
			const tagsLoaded = page.waitForResponse((r) => /\/api\/tags\/(\?|$)/.test(r.url()), {
				timeout: 30000
			});
			await open(page, '/concepts');
			await tagsLoaded.catch(() => {});
			await page.waitForTimeout(500);
			const tagSelect = page
				.locator('label.field')
				.filter({ hasText: t.concept_hub_tag })
				.locator('select');
			const longest = await tagSelect.evaluate((s) =>
				Math.max(...[...s.options].map((o) => o.text.length))
			);
			const box = await tagSelect.boundingBox();
			check(
				`[${locale}] /concepts at 390: the Tag select (longest option ${longest} chars) ends inside the window`,
				longest > 25 && box !== null && box.x + box.width <= 390 - 8,
				`right edge ${box ? box.x + box.width : '?'}`
			);
			check(
				`[${locale}] /concepts at 390: no horizontal scroll`,
				(await page.evaluate(() => document.documentElement.scrollWidth)) <= 390
			);
			await page.screenshot({ path: `${SHOTS}/home-start-concepts-390-${locale}.png` });
		}
		await ctx.close();
	}

	// ---- 6. fix (c): /my-set never says "empty" about a set with items ----------------------------
	{
		const ids = (await (await fetch(`${API}/api/exercises/bulk/?ids=1,49,384`)).json()).map((e) =>
			String(e.id)
		);
		const ctx = await contextFor(locale, { viewport: { width: 1280, height: 900 } });
		await ctx.addInitScript((stored) => {
			localStorage.setItem('edmat-guest-set', stored);
		}, JSON.stringify(ids));
		const page = await ctx.newPage();
		watch(page);
		// Hold the bulk fetch back, so "after the page draws" is long enough to see.
		await page.route(/\/api\/exercises\/bulk\//, async (route) => {
			await new Promise((r) => setTimeout(r, 1500));
			await route.continue();
		});
		// Watch for the empty state from the very first frame, in the page itself.
		await ctx.addInitScript(() => {
			window.__emptySeen = false;
			new MutationObserver(() => {
				if (document.querySelector('[data-empty-state="my-set"]')) window.__emptySeen = true;
			}).observe(document, { childList: true, subtree: true });
		});
		await open(page, '/my-set');
		const skeleton = page.locator('.print-area .loading');
		check(
			`[${locale}] /my-set: a skeleton while the exercises load`,
			(await skeleton.count()) === 1
		);
		await page.locator('.set-item').first().waitFor({ timeout: 20000 });
		check(
			`[${locale}] /my-set: then the ${ids.length} exercises`,
			(await page.locator('.set-item').count()) === ids.length
		);
		check(
			`[${locale}] /my-set: the empty state was never drawn`,
			(await page.evaluate(() => window.__emptySeen)) === false
		);
		await ctx.close();
	}
	// And an honestly empty set still says so — a fresh context, because the one above re-seeds the
	// set on every navigation.
	{
		const ctx = await contextFor(locale, { viewport: { width: 1280, height: 900 } });
		const page = await ctx.newPage();
		watch(page);
		await open(page, '/my-set');
		const empty = page.locator('[data-empty-state="my-set"]');
		await empty.waitFor({ timeout: 10000 }).catch(() => {});
		check(
			`[${locale}] /my-set: an empty set still draws its empty state, with no skeleton`,
			(await empty.count()) === 1 && (await page.locator('.print-area .loading').count()) === 0
		);
		check(
			`[${locale}] …and says what the page is for`,
			(await empty.innerText()).includes(t.empty_mySet)
		);
		await ctx.close();
	}
}

await browser.close();

check('no console or page errors', errors.length === 0, errors.slice(0, 5).join(' | '));
console.log(`  (${fontNoise} KaTeX webfont 403s ignored — the worktree symlink, trap 26)`);
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
