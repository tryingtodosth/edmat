// Browse by audience first (owner, 2026-11-02: "we want the audience to be the primary way of
// serving materials"; HISTORY §17DE). The band chips lead /disciplines, /disciplines/<d> and
// /branches/<b>; every card counts through the lens; a node with nothing for it folds under
// "For other groups" instead of vanishing; one line says what the lens hides and offers "show
// everything"; `?audience=` in the address both sets the lens on arrival and follows a chip.
//
// Read-only: a guest, no data written. Expected numbers are taken from the very API the page reads
// (`counts` on /api/disciplines/ and /api/branches/), so the script holds on any corpus that has a
// `matematyka` discipline with `analiza-matematyczna` under it and content in more than one band.
//   E2E_BASE=http://localhost:5180 E2E_API=http://127.0.0.1:8010 node e2e/audience-browse.mjs
let chromium;
try {
	({ chromium } = await import('playwright'));
} catch {
	({ chromium } = await import('playwright-core'));
}
import { englishContext } from './english.mjs';

const BASE = process.env.E2E_BASE ?? 'http://localhost:5180';
const API = process.env.E2E_API ?? 'http://127.0.0.1:8010';
const SHOTS = process.env.E2E_SHOTS ?? '/tmp';
let pass = 0,
	fail = 0;
const check = (l, ok, x = '') => {
	if (ok) pass++;
	else fail++;
	console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${l} ${ok ? '' : x}`);
};

// ---- what the API says, and the lens rule mirrored from lib/utils/audienceCounts.ts -----------
const disciplines = await (await fetch(`${API}/api/disciplines/?lang=pl`)).json();
const branches = await (await fetch(`${API}/api/branches/?lang=pl`)).json();
const KINDS = ['exercises', 'materials', 'courses'];
const inLens = (band, bands) => bands.length === 0 || band === 'all' || bands.includes(band);
const count = (counts, bands, kind) =>
	(kind ? [kind] : KINDS).reduce(
		(sum, k) =>
			sum +
			Object.entries(counts[k] ?? {}).reduce((s, [b, n]) => s + (inLens(b, bands) ? n : 0), 0),
		0
	);
const mat = disciplines.find((d) => d.slug === 'matematyka');
const analiza = branches.find((b) => b.slug === 'analiza-matematyczna');
if (!mat || !analiza) {
	console.log('FAIL: the corpus has no matematyka / analiza-matematyczna — nothing to browse');
	process.exit(1);
}
// A band with something under matematyka, and one with nothing anywhere on the index.
const bandsWithContent = [
	...new Set(KINDS.flatMap((k) => Object.keys(mat.counts[k] ?? {})))
].filter((b) => b !== 'all');
const everyBand = ['early_years', 'primary', 'secondary', 'university', 'adult', 'senior'];
const emptyBand = everyBand.find((b) => disciplines.every((d) => count(d.counts, [b]) === 0));
const smallBand = bandsWithContent
	.filter((b) => b !== 'university')
	.sort((a, b) => count(mat.counts, [a]) - count(mat.counts, [b]))[0];
console.log(`  bands under matematyka: ${bandsWithContent.join(', ')}; empty: ${emptyBand}`);

const browser = await chromium.launch(
	process.env.CHROME ? { executablePath: process.env.CHROME } : {}
);
const consoleErrors = [];
async function freshPage(ctxOptions = {}, english = false) {
	const ctx = english
		? await englishContext(browser, BASE, ctxOptions)
		: await browser.newContext(ctxOptions);
	const page = await ctx.newPage();
	page.on('pageerror', (e) => consoleErrors.push(String(e)));
	page.on('console', (msg) => {
		if (msg.type() === 'error' && !/Failed to load resource/.test(msg.text()))
			consoleErrors.push(msg.text());
	});
	return { ctx, page };
}
const lensChip = (page, label) =>
	page.locator('[data-testid="browse-lens"] [role="radio"]', { hasText: label });
const stored = (page) => page.evaluate(() => localStorage.getItem('edmat.audienceFilter'));
const matCard = (page) =>
	page.locator('[data-testid="discipline-card"]', { hasText: mat.name }).first();

const PL_LABEL = {
	early_years: 'Najmłodsi',
	primary: 'Szkoła podstawowa',
	secondary: 'Szkoła średnia',
	university: 'Studia',
	adult: 'Dorośli',
	senior: 'Seniorzy'
};

for (const width of [1280, 390]) {
	console.log(`\n[${width}px] /disciplines, Polish, a first visit`);
	const { ctx, page } = await freshPage({ viewport: { width, height: 900 } });
	await page.goto(`${BASE}/disciplines`);
	await page.locator('[data-testid="discipline-card"]').first().waitFor();
	check('h1 is "Dziedziny"', (await page.locator('h1').innerText()).trim() === 'Dziedziny');
	check(
		'the chips ask the question',
		(await page.locator('[data-testid="browse-lens"]').innerText()).includes('Dla kogo szukasz?')
	);
	check(
		'"Wszystko" is the checked chip on a first visit',
		(await lensChip(page, 'Wszystko').getAttribute('aria-checked')) === 'true'
	);
	check('no lens line with no lens', (await page.locator('.lens__line').count()) === 0);
	check('nothing folded with no lens', (await page.locator('[data-testid="browse-folded"]').count()) === 0);
	const allText = await matCard(page).locator('[data-testid="node-counts"]').innerText();
	check(
		`matematyka card counts everything (${allText})`,
		allText.includes(`Zadania: ${count(mat.counts, [], 'exercises')}`) &&
			allText.includes(`Materiały: ${count(mat.counts, [], 'materials')}`)
	);
	if (width === 1280) {
		const nav = await page.locator('header .nav-link--disciplines').first().innerText();
		check(`the nav link reads "Przeglądaj" (${nav.trim()})`, nav.trim() === 'Przeglądaj');
	}
	await page.screenshot({ path: `${SHOTS}/audience-browse-${width}-all.png`, fullPage: true });

	if (emptyBand) {
		console.log(`[${width}px] a band with nothing anywhere: ${emptyBand}`);
		await lensChip(page, PL_LABEL[emptyBand]).click();
		await page.locator('[data-testid="browse-lens-nothing"]').waitFor();
		check('the address follows the chip', page.url().includes(`audience=${emptyBand}`), page.url());
		check('the choice is stored', (await stored(page)) === JSON.stringify([emptyBand]));
		const line = await page.locator('[data-testid="browse-lens-nothing"]').innerText();
		check(`the line names the band and where most is (${line})`, line.includes(PL_LABEL[emptyBand]) && line.includes('Studia'));
		check(
			'every card is folded, and the fold opens itself',
			(await page.locator('[data-testid="browse-folded"]').getAttribute('open')) !== null &&
				(await page.locator('[data-testid="browse-folded"] [data-testid="discipline-card"]').count()) ===
					disciplines.filter((d) => d.status !== 'pending').length
		);
		const folded = await matCard(page).locator('[data-testid="node-counts"]').innerText();
		check(`a folded card says who it IS for (${folded})`, folded.includes('Studia:'));
		const firstFolded = await page
			.locator('[data-testid="browse-folded"] [data-testid="discipline-card"] h3')
			.first()
			.innerText();
		check(`the fold leads with what has content (${firstFolded})`, firstFolded.trim() === mat.name);
		await page.screenshot({ path: `${SHOTS}/audience-browse-${width}-${emptyBand}.png`, fullPage: true });
	}

	if (smallBand) {
		console.log(`[${width}px] a band with a little under matematyka: ${smallBand}`);
		await lensChip(page, PL_LABEL[smallBand]).click();
		await page.locator('[data-testid="browse-lens-showing"]').waitFor();
		const shownText = await page
			.locator('.grid')
			.first()
			.locator('[data-testid="discipline-card"]', { hasText: mat.name })
			.locator('[data-testid="node-counts"]')
			.innerText();
		// Each kind the lens admits, with its number; a kind it admits none of is not drawn at all.
		const labelOf = { exercises: 'Zadania', materials: 'Materiały', courses: 'Kursy' };
		const lensRight = KINDS.every((k) => {
			const n = count(mat.counts, [smallBand], k);
			return n > 0 ? shownText.includes(`${labelOf[k]}: ${n}`) : !shownText.includes(labelOf[k]);
		});
		check(`matematyka leads, counted through the lens (${shownText})`, lensRight);
		const others = disciplines.reduce((s, d) => s + count(d.counts, []) - count(d.counts, [smallBand]), 0);
		const line = await page.locator('[data-testid="browse-lens-showing"]').innerText();
		check(`the line says how much the lens leaves out (${others})`, line.includes(String(others)), line);
		await page.screenshot({ path: `${SHOTS}/audience-browse-${width}-${smallBand}.png`, fullPage: true });

		await page.locator('[data-testid="browse-lens-showing"] button').click();
		await page.waitForFunction(() => !location.search.includes('audience='));
		check('"Pokaż wszystko" clears the lens and the address', (await stored(page)) === '[]');
		check('…and the line goes', (await page.locator('.lens__line').count()) === 0);

		console.log(`[${width}px] /disciplines/matematyka and the branch page through ${smallBand}`);
		await page.goto(`${BASE}/disciplines/matematyka?audience=${smallBand}`);
		await page.locator('[data-testid="branch-card"]').first().waitFor();
		check(
			'a shared link sets the lens on arrival',
			(await lensChip(page, PL_LABEL[smallBand]).getAttribute('aria-checked')) === 'true' &&
				(await stored(page)) === JSON.stringify([smallBand])
		);
		const mathBranches = branches.filter((b) => b.discipline === 'matematyka' && b.status !== 'pending');
		const shownBranches = mathBranches.filter((b) => count(b.counts, [smallBand]) > 0);
		check(
			`${shownBranches.length} branch(es) lead, ${mathBranches.length - shownBranches.length} fold`,
			(await page.locator('.grid').first().locator('[data-testid="branch-card"]').count()) === shownBranches.length &&
				(await page.locator('[data-testid="browse-folded"] [data-testid="branch-card"]').count()) ===
					mathBranches.length - shownBranches.length
		);
		await page.screenshot({ path: `${SHOTS}/audience-browse-${width}-matematyka.png`, fullPage: true });

		const requests = [];
		page.on('request', (r) => {
			if (/\/api\/branches\/analiza-matematyczna\/(exercises|materials)\//.test(r.url())) requests.push(r.url());
		});
		await page.goto(`${BASE}/branches/analiza-matematyczna`);
		await page.locator('[data-testid="browse-lens"]').waitFor();
		await page.waitForTimeout(800);
		check(
			'the branch lists ask through the lens',
			requests.length > 0 && requests.every((u) => u.includes(`audience=${smallBand}`)),
			requests.join(' ')
		);
		requests.length = 0;
		await lensChip(page, 'Studia').click();
		await page.waitForResponse((r) => /\/exercises\/.*audience=university/.test(r.url()));
		check(
			'a chip on the branch page refetches its lists',
			requests.some((u) => /exercises\/.*audience=university/.test(u)) &&
				requests.some((u) => /materials\/.*audience=university/.test(u)),
			requests.join(' ')
		);
		await page.locator('.exercises-column article, .exercises-column .empty').first().waitFor();
		await page.screenshot({ path: `${SHOTS}/audience-browse-${width}-branch.png`, fullPage: false });
		// Back to no lens for the next width's "first visit".
		await page.locator('[data-testid="browse-lens"] [role="radio"]', { hasText: 'Wszystko' }).click();
	}

	console.log(`[${width}px] an exercise's breadcrumb`);
	const ex = (await (await fetch(`${API}/api/branches/analiza-matematyczna/exercises/?lang=pl`)).json())[0];
	await page.goto(`${BASE}/exercises/${ex.id}`);
	const crumbs = page.locator('nav.breadcrumb a');
	await crumbs.nth(2).waitFor();
	check(
		'Home › Matematyka › Analiza',
		(await crumbs.count()) === 3 && (await crumbs.nth(1).innerText()).trim() === mat.name,
		await page.locator('nav.breadcrumb').innerText()
	);
	await ctx.close();
}

console.log('\n[1280px] English');
{
	const { ctx, page } = await freshPage({ viewport: { width: 1280, height: 900 } }, true);
	await page.goto(`${BASE}/disciplines`);
	await page.locator('[data-testid="discipline-card"]').first().waitFor();
	check('h1 is "Disciplines"', (await page.locator('h1').innerText()).trim() === 'Disciplines');
	check(
		'the chips ask "Who are you looking for?"',
		(await page.locator('[data-testid="browse-lens"]').innerText()).includes('Who are you looking for?')
	);
	if (emptyBand) {
		await page.locator('[data-testid="browse-lens"] [role="radio"]').nth(everyBand.indexOf(emptyBand) + 1).click();
		const line = await page.locator('[data-testid="browse-lens-nothing"]').innerText();
		check(`the English line reads as a sentence (${line})`, line.startsWith('Nothing here for'));
		await page.screenshot({ path: `${SHOTS}/audience-browse-en-${emptyBand}.png`, fullPage: true });
	}
	await ctx.close();
}

check('no page errors', consoleErrors.length === 0, consoleErrors.join('\n'));
await browser.close();
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
