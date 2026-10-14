// The manual's "Open this screen →" links (`GuideStep.tryHref`, 2026-10-14): every one of them,
// in both languages, opened in a real browser.
//
// What it checks:
//
//   1. every chapter page draws exactly the links its content file declares for an ANONYMOUS
//      reader — no more, no fewer — in Polish and in English (the moderators-only and members-only
//      ones are absent);
//   2. every link resolves: the screen behind it loads with a heading and is not SvelteKit's 404;
//   3. `/tutoring` is written as `/korki` for a Polish reader (`localizedPath`);
//   4. a moderator sees the moderation chapter's links, and they open; signed in, the contests
//      chapter adds the founding wizard;
//   5. **a killed feature takes its link with it** (house rule 3): the `volunteering` switch is
//      turned off through the real API, the help chapter is read by a non-staff reader, the offers
//      link is gone and the `needs` one is still there — then the switch is put back;
//   6. the chapter pages for `start` and `contests` have no horizontal scroll at 390 px, in both
//      languages, and are photographed at 1280 and 390 for a person to look at (`e2e/screenshots/`);
//   7. the showcase link ("See the design →") is an ordinary client-side link now (no
//      `rel="external"`), and opens.
//
// Zero page errors is a pass condition. KaTeX webfont 403s in a worktree are not (e2e/CLAUDE.md
// trap 26) — they are counted and printed.
//
// Run (your own ports; tokens rather than logins, e2e/CLAUDE.md trap 30):
//   E2E_BASE=http://localhost:5203 E2E_API=http://127.0.0.1:8053/api \
//     E2E_STAFF_TOKEN=<u-kasia> E2E_USER_TOKEN=<demo-ania> node e2e/guide-try-links.mjs
import { mkdirSync, readFileSync, readdirSync } from 'node:fs';
import { englishContext } from './english.mjs';

let chromium;
try {
	({ chromium } = await import('playwright'));
} catch {
	({ chromium } = await import('playwright-core'));
}

const BASE = process.env.E2E_BASE ?? 'http://localhost:5203';
const API = process.env.E2E_API ?? 'http://127.0.0.1:8053/api';
const STAFF = process.env.E2E_STAFF_TOKEN ?? '';
const USER = process.env.E2E_USER_TOKEN ?? '';
const OUT = 'e2e/screenshots'; // gitignored: these are for a person to look at, not to keep
mkdirSync(OUT, { recursive: true });

if (!STAFF || !USER) {
	console.error('E2E_STAFF_TOKEN (a staff account, e.g. u-kasia) and E2E_USER_TOKEN (a non-staff');
	console.error('account, e.g. demo-ania) are both required — see the header.');
	process.exit(1);
}

let passed = 0;
let failed = 0;
function check(name, ok, detail = '') {
	if (ok) passed += 1;
	else failed += 1;
	console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${name}${ok || !detail ? '' : ` — ${detail}`}`);
}

// ---- what the content files declare ----------------------------------------------------------
// Read from the source rather than imported (they are TypeScript with `$lib` imports). Only the
// ENGLISH half of each file is read; the Polish half carries the same links on the same steps,
// which check 1 then confirms by counting them on the Polish page too.
const GUIDE = new URL('../src/lib/content/guide/', import.meta.url).pathname;
const declared = {};
for (const file of readdirSync(GUIDE)) {
	if (!file.endsWith('.ts') || ['index.ts', 'types.ts'].includes(file)) continue;
	const source = readFileSync(GUIDE + file, 'utf8');
	const en = source.slice(source.indexOf('const EN'), source.indexOf('const PL'));
	const links = [];
	for (const match of en.matchAll(
		/tryHref: '([^']+)',(?:\s*tryFlag: '([^']+)',)?(?:\s*tryFor: '([^']+)',)?/g
	)) {
		links.push({ href: match[1], flag: match[2] ?? null, who: match[3] ?? null });
	}
	declared[file.replace('.ts', '')] = links;
}
const total = Object.values(declared).reduce((n, links) => n + links.length, 0);
check(`the content files declare try-links (${total})`, total >= 20, `${total}`);

async function api(token, method, path, body) {
	const response = await fetch(`${API}${path}`, {
		method,
		headers: {
			Authorization: `Token ${token}`,
			...(body ? { 'Content-Type': 'application/json' } : {})
		},
		...(body ? { body: JSON.stringify(body) } : {})
	});
	return { status: response.status, body: await response.json().catch(() => null) };
}

// ---- the browser ------------------------------------------------------------------------------
const browser = await chromium.launch(
	process.env.CHROME ? { executablePath: process.env.CHROME } : {}
);
const errors = [];
let fontNoise = 0;

async function context({ english, token, width = 1280 }) {
	const options = { viewport: { width, height: 900 } };
	const ctx = english
		? await englishContext(browser, BASE, options)
		: await browser.newContext(options);
	if (token) {
		await ctx.addInitScript((t) => localStorage.setItem('edmat-auth-token', t), token);
	}
	const page = await ctx.newPage();
	page.on('pageerror', (e) => errors.push(`${page.url()}: ${String(e).slice(0, 160)}`));
	page.on('response', (r) => {
		if (r.status() === 403 && /\/node_modules\/katex\/dist\/fonts\//.test(r.url())) fontNoise += 1;
	});
	page.on('console', (m) => {
		if (m.type() !== 'error') return;
		if (/status of 403/.test(m.text())) return; // counted above, by URL
		errors.push(`${page.url()}: console: ${m.text().slice(0, 160)}`);
	});
	return { ctx, page };
}

/** A chapter page, hydrated and with the feature flags loaded (the links depend on both). */
async function chapter(page, slug) {
	const flags = page.waitForResponse((r) => r.url().includes('/feature-flags/'), {
		timeout: 60000
	});
	await page.goto(`${BASE}/about/guide/${slug}`, { waitUntil: 'load' });
	await flags.catch(() => {});
	await page.locator('.chapter__steps').waitFor({ timeout: 30000 });
	await page.waitForTimeout(1200);
}

async function tryLinks(page) {
	return page
		.locator('.chapter__try a')
		.evaluateAll((links) => links.map((a) => a.getAttribute('href')));
}

/** Open an address and say whether it is a real screen: a heading, and not the 404 page. */
async function opens(page, href) {
	const response = await page.goto(`${BASE}${href}`, { waitUntil: 'load' });
	await page
		.locator('h1, h2')
		.first()
		.waitFor({ timeout: 30000 })
		.catch(() => {});
	await page.waitForTimeout(800);
	const heading = (
		(await page
			.locator('h1')
			.first()
			.textContent()
			.catch(() => '')) ?? ''
	).trim();
	const status = response?.status() ?? 0;
	return { ok: status < 400 && heading !== '404' && heading.length > 0, status, heading };
}

const visited = new Map();

// ---- 1–3: every chapter, both languages, anonymous ----------------------------------------------
for (const english of [false, true]) {
	const label = english ? 'en' : 'pl';
	console.log(`\n${label}, signed out`);
	for (const [slug, links] of Object.entries(declared)) {
		// A fresh context per chapter: one page walked through ~40 full loads crashed the headless
		// renderer ("Target crashed") on the first run, which says nothing about the links.
		const { ctx, page } = await context({ english });
		await chapter(page, slug);
		const expected = links.filter((l) => l.who !== 'moderators' && l.who !== 'members');
		const drawn = await tryLinks(page);
		check(
			`${label} /about/guide/${slug}: ${drawn.length} link(s), as declared`,
			drawn.length === expected.length,
			`drawn ${JSON.stringify(drawn)}, declared ${JSON.stringify(expected.map((l) => l.href))}`
		);
		if (slug === 'tutoring') {
			const want = english ? '/tutoring' : '/korki';
			check(
				`${label} the tutoring link is written ${want}`,
				drawn.includes(want) && drawn.includes(`${want}/new`),
				JSON.stringify(drawn)
			);
		}
		for (const href of drawn) {
			const key = `${label} ${href}`;
			if (visited.has(key)) continue;
			const result = await opens(page, href);
			visited.set(key, result);
			check(
				`${label} ${href} opens ("${result.heading.slice(0, 40)}")`,
				result.ok,
				`status ${result.status}, h1 "${result.heading}"`
			);
		}
		await ctx.close();
	}
}

// ---- 4: the moderation chapter, as staff --------------------------------------------------------
{
	console.log('\nstaff');
	const { ctx, page } = await context({ english: true, token: STAFF });
	await chapter(page, 'moderation');
	await page
		.waitForFunction(() => document.querySelectorAll('.chapter__try a').length > 0, null, {
			timeout: 30000
		})
		.catch(() => {});
	const drawn = await tryLinks(page);
	check(
		'a moderator sees the moderation chapter s links',
		drawn.length === declared.moderation.length,
		JSON.stringify(drawn)
	);
	for (const href of drawn) {
		const result = await opens(page, href);
		check(`staff ${href} opens`, result.ok, `status ${result.status}, h1 "${result.heading}"`);
	}
	// 7. The showcase link: client-side, and it opens.
	await chapter(page, 'contests');
	await page
		.waitForFunction(() => document.querySelectorAll('.chapter__try a').length > 1, null, {
			timeout: 30000
		})
		.catch(() => {});
	const contestLinks = await tryLinks(page);
	check(
		'signed in, the contests chapter also offers the founding wizard (a members-only link)',
		contestLinks.includes('/contests/new') && contestLinks.length === declared.contests.length,
		JSON.stringify(contestLinks)
	);
	const showcase = page.locator('.chapter__showcase a');
	check(
		'the showcase link carries no rel="external"',
		(await showcase.getAttribute('rel')) === null
	);
	await showcase.click();
	await page.waitForURL(/\/about\/contests$/, { timeout: 30000 }).catch(() => {});
	check('and it opens /about/contests', page.url().endsWith('/about/contests'), page.url());
	await ctx.close();
}

// ---- 5: a killed feature takes its link with it -------------------------------------------------
{
	console.log('\nkill switch');
	const before = await api(STAFF, 'GET', '/feature-flags/');
	const was = (before.body ?? []).find((f) => f.key === 'volunteering')?.is_enabled;
	const off = await api(STAFF, 'PATCH', '/feature-flags/volunteering/', { is_enabled: false });
	check(
		'the volunteering switch is turned off for the check',
		off.status === 200,
		`status ${off.status}`
	);
	try {
		const { ctx, page } = await context({ english: true, token: USER });
		await chapter(page, 'help');
		const drawn = await tryLinks(page);
		check(
			'with volunteering off, a non-staff reader has no /volunteering link',
			!drawn.includes('/volunteering'),
			JSON.stringify(drawn)
		);
		check(
			'…while the help-wanted link (its own switch, still on) stays',
			drawn.includes('/needs'),
			JSON.stringify(drawn)
		);
		await ctx.close();
	} finally {
		const back = await api(STAFF, 'PATCH', '/feature-flags/volunteering/', {
			is_enabled: was !== false
		});
		check(
			'the switch is put back as it was',
			back.status === 200 && back.body?.is_enabled === (was !== false)
		);
	}
}

// ---- 6: start and contests, both languages, 1280 and 390 ----------------------------------------
console.log('\nlayout');
for (const english of [false, true]) {
	for (const width of [1280, 390]) {
		const { ctx, page } = await context({ english, width });
		for (const slug of ['start', 'contests']) {
			await chapter(page, slug);
			// The pictures are lazy: scroll through so every one is decoded before the shot.
			await page.evaluate(async () => {
				for (let y = 0; y < document.body.scrollHeight; y += 600) {
					window.scrollTo(0, y);
					await new Promise((r) => setTimeout(r, 60));
				}
				window.scrollTo(0, 0);
			});
			await page.waitForTimeout(800);
			const overflow = await page.evaluate(
				() => document.documentElement.scrollWidth - window.innerWidth
			);
			const label = `${english ? 'en' : 'pl'} ${slug} @${width}`;
			check(`${label}: no horizontal scroll`, overflow <= 0, `${overflow}px wider than the window`);
			const broken = await page
				.locator('.chapter__shot img')
				.evaluateAll((imgs) =>
					imgs.filter((i) => !i.complete || i.naturalWidth === 0).map((i) => i.getAttribute('src'))
				);
			check(`${label}: every picture loads`, broken.length === 0, broken.join(', '));
			await page.screenshot({
				path: `${OUT}/guide-${slug}-${english ? 'en' : 'pl'}-${width}.png`,
				fullPage: true
			});
		}
		await ctx.close();
	}
}

await browser.close();
check('zero page errors', errors.length === 0, errors.slice(0, 4).join(' | '));
if (fontNoise)
	console.log(`  --   ${fontNoise} KaTeX webfont 403s ignored (worktree, e2e/CLAUDE.md trap 26)`);
console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
