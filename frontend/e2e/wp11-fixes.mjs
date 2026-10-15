// WP11 — five small bugs the 2026-10-14 screenshot pass found, each checked where a reader sees it.
//
//   1. a school class says "A school class", draws no "University and faculty versions" panel and
//      no "Add a university/faculty version" link; `/courses/new?parent=<class>` says why instead of
//      drawing the form (the server's `parent_is_class`); a plain general course is unchanged;
//   2. the People tab's "under 16" badge sits on the pupil's own line and is pill-sized, not a bar
//      across the row;
//   3. the manual and the showcase print no Markdown asterisks (the four chapters and the one
//      showcase page that had them, both languages) — `npm run check:plain` is the static guard;
//   4. the tutoring showcase says what the clock really does (Polish-time hours since 2026-10-15,
//      drawn in the reader's zone; WP11 first wrote it as UTC, which was the bug)
//      instead of "the server's time zone";
//   5. `/about` with `organizations` OFF, for an anonymous reader: no request for the organisation,
//      no console error, the page below still drawn. Flips that switch, so run it against a
//      database COPY; it is put back in a `finally`.
//
// Needs `manage.py seed_school_demo` on the backend it drives. Tokens rather than sign-ins (trap 30):
//   E2E_BASE=http://localhost:5212 E2E_API=http://127.0.0.1:8062/api \
//     E2E_TEACHER_TOKEN=<school.teacher's> E2E_STAFF_TOKEN=<kasia's> node e2e/wp11-fixes.mjs
//
// The `/courses/new?parent=` check needs the teacher to pass the creation gate (a verified
// contributor while `creation_requires_verification` is on). When the gate refuses, that check is
// SKIPPED and says so — the refusal itself is pinned by `courses/test_school_mode.py`.
//
// Screenshots land in e2e/screens/wp11-*.png and are meant to be LOOKED at.

import { mkdirSync, readFileSync } from 'node:fs';
import { englishContext } from './english.mjs';

let chromium;
try {
	({ chromium } = await import('playwright'));
} catch {
	({ chromium } = await import('playwright-core'));
}

const BASE = process.env.E2E_BASE ?? 'http://localhost:5212';
const API = process.env.E2E_API ?? 'http://127.0.0.1:8062/api';
const SHOTS = new URL('./screens/', import.meta.url).pathname;
mkdirSync(SHOTS, { recursive: true });
const CATALOGUE = {
	en: JSON.parse(readFileSync(new URL('../messages/en.json', import.meta.url), 'utf8')),
	pl: JSON.parse(readFileSync(new URL('../messages/pl.json', import.meta.url), 'utf8'))
};
const TOKEN_KEY = 'edmat-auth-token';
const DESKTOP = { width: 1280, height: 950 };
const PHONE = { width: 390, height: 844 };
const MARKDOWN_EMPHASIS = /\*[\p{L}\p{N}]|[\p{L}\p{N}]\*/u;

let pass = 0,
	fail = 0,
	skipped = 0;
const check = (label, ok, extra = '') => {
	if (ok) pass++;
	else fail++;
	console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${label} ${ok ? '' : extra}`);
};

async function login(username, password) {
	const r = await fetch(`${API}/auth/login/`, {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify({ username, password })
	});
	if (!r.ok) throw new Error(`login ${username}: ${r.status}`);
	return (await r.json()).token;
}
const teacherToken =
	process.env.E2E_TEACHER_TOKEN ?? (await login('school.teacher', 'persona-pass-2026'));
const staffToken =
	process.env.E2E_STAFF_TOKEN ?? (await login('kasia@edmat.example', 'password123'));

async function api(token, path, options = {}) {
	return fetch(`${API}${path}`, {
		...options,
		headers: {
			'Content-Type': 'application/json',
			...(token ? { Authorization: `Token ${token}` } : {}),
			...(options.headers ?? {})
		}
	});
}
async function setFlag(key, isEnabled) {
	const r = await api(staffToken, `/feature-flags/${key}/`, {
		method: 'PATCH',
		body: JSON.stringify({ is_enabled: isEnabled })
	});
	if (!r.ok) throw new Error(`flag ${key}=${isEnabled}: ${r.status}`);
}

const errors = [];
function watch(page) {
	page.on('pageerror', (e) => errors.push(String(e)));
	page.on('console', (msg) => {
		if (msg.type() === 'error') errors.push(msg.text());
	});
	page.on('response', (r) => {
		// KaTeX's webfonts 403 in a worktree's dev server (trap 26) — not this script's business.
		if (r.status() >= 400 && !r.url().includes('/katex/')) errors.push(`${r.status()} ${r.url()}`);
	});
}

/** A context in `locale`, optionally signed in by token (localStorage, before the first paint). */
async function contextFor(browser, locale, viewport, token) {
	const ctx =
		locale === 'en'
			? await englishContext(browser, BASE, { viewport })
			: await browser.newContext({ viewport });
	if (token) await ctx.addInitScript(([k, v]) => localStorage.setItem(k, v), [TOKEN_KEY, token]);
	return ctx;
}
async function open(page, path) {
	const booted = page
		.waitForResponse((r) => r.url().includes('/feature-flags/'), { timeout: 60000 })
		.catch(() => null);
	await page.goto(`${BASE}${path}`, { waitUntil: 'load' });
	await booted;
}
const shoot = (page, name, fullPage = true) =>
	page.screenshot({ path: `${SHOTS}wp11-${name}.png`, fullPage });

// ---- the seeded class, and a plain general course to compare with -------------------------------
const teaching = await (await api(teacherToken, '/courses/?mine=teaching')).json();
const klass = teaching.find((row) => row.title.includes('2a'));
if (!klass) {
	console.error('No seeded class. Run `manage.py seed_school_demo` against this backend first.');
	process.exit(1);
}
const tops = await (await api(staffToken, '/courses/?top=true&kind=topic')).json();
const general = tops.find((row) => !row.school && row.visibility === 'public');
const creation = await (await api(teacherToken, '/creation/')).json().catch(() => ({}));

const browser = await chromium.launch(
	process.env.CHROME ? { executablePath: process.env.CHROME } : {}
);
try {
	{
		const warm = await browser.newContext();
		const page = await warm.newPage();
		await page.goto(`${BASE}/courses`, { waitUntil: 'load' }).catch(() => {});
		await page.waitForTimeout(3000);
		await warm.close();
	}

	// ---- 1. a school class is a class ----------------------------------------------------------
	console.log(`\n1. a school class — course ${klass.id}`);
	for (const locale of ['en', 'pl']) {
		for (const [vp, viewport] of [
			['desktop', DESKTOP],
			['phone', PHONE]
		]) {
			const ctx = await contextFor(browser, locale, viewport, teacherToken);
			const page = await ctx.newPage();
			watch(page);
			await open(page, `/courses/${klass.id}`);
			await page.locator('.kind-pill').first().waitFor({ timeout: 60000 });
			await page
				.locator('.course-search, [class*="search"]')
				.first()
				.waitFor()
				.catch(() => {});
			const pill = (await page.locator('.kind-pill').first().textContent())?.trim();
			check(
				`${locale} ${vp}: the kind line says "${CATALOGUE[locale].wp11_courseKindClass}"`,
				pill === CATALOGUE[locale].wp11_courseKindClass,
				`got "${pill}"`
			);
			check(
				`${locale} ${vp}: no versions panel and no "add a version" link`,
				(await page.locator('section.versions').count()) === 0 &&
					(await page.locator('a[href*="/courses/new?parent="]').count()) === 0
			);
			if (vp === 'desktop' || locale === 'en') await shoot(page, `class-${locale}-${vp}`, false);
			await ctx.close();
		}
	}

	if (general) {
		const ctx = await contextFor(browser, 'en', DESKTOP, staffToken);
		const page = await ctx.newPage();
		watch(page);
		await open(page, `/courses/${general.id}`);
		await page
			.locator('section.versions')
			.waitFor({ timeout: 30000 })
			.catch(() => {});
		check(
			`a plain general course (${general.id}) still reads "${CATALOGUE.en.course_kind_topic}" with its versions panel`,
			(await page.locator('.kind-pill').first().textContent())?.trim() ===
				CATALOGUE.en.course_kind_topic && (await page.locator('section.versions').count()) === 1
		);
		await ctx.close();
	} else {
		skipped++;
		console.log('  SKIP no public general course without a school on this database');
	}

	{
		const ctx = await contextFor(browser, 'en', DESKTOP, teacherToken);
		const page = await ctx.newPage();
		watch(page);
		await open(page, `/courses/new?parent=${klass.id}`);
		await page.waitForTimeout(2500);
		const gateOpen = creation?.course === null; // `/api/creation/` answers a refusal word, or null
		const text = await page.locator('.page').first().innerText();
		if (text.includes(CATALOGUE.en.wp11_versionRefusalParentIsClass)) {
			check('/courses/new?parent=<class> says why instead of drawing the form', true);
			check(
				'…and draws no course form',
				(await page
					.locator('form')
					.filter({ has: page.locator('input') })
					.count()) === 0
			);
			await shoot(page, 'new-version-of-class', false);
		} else if (!gateOpen) {
			skipped++;
			console.log(
				'  SKIP /courses/new?parent=<class>: the creation gate refuses this teacher first (expected)'
			);
		} else {
			check(
				'/courses/new?parent=<class> says why instead of drawing the form',
				false,
				text.slice(0, 200)
			);
		}
		await ctx.close();
	}

	// ---- 2. the People tab's badge -------------------------------------------------------------
	console.log('\n2. the "under 16" badge on the People tab');
	for (const [vp, viewport] of [
		['desktop', DESKTOP],
		['phone', PHONE]
	]) {
		const ctx = await contextFor(browser, 'en', viewport, teacherToken);
		const page = await ctx.newPage();
		watch(page);
		await open(page, `/courses/${klass.id}?tab=people`);
		await page.locator('.roster li .badge').first().waitFor({ timeout: 30000 });
		const rows = await page.locator('.roster li').evaluateAll((lis) =>
			lis
				.filter((li) => li.querySelector('.badge'))
				.map((li) => {
					const name = li.querySelector('a').getBoundingClientRect();
					const badge = li.querySelector('.badge').getBoundingClientRect();
					return {
						badgeWidth: badge.width,
						rowWidth: li.getBoundingClientRect().width,
						sameLine: badge.top < name.bottom && badge.bottom > name.top
					};
				})
		);
		check(`${vp}: ${rows.length} badges drawn`, rows.length > 0);
		check(
			`${vp}: every badge is pill-sized (< 40% of its row), not a bar across it`,
			rows.every((r) => r.badgeWidth < r.rowWidth * 0.4),
			JSON.stringify(rows[0])
		);
		check(
			`${vp}: every badge sits on its pupil's own line`,
			rows.every((r) => r.sameLine),
			JSON.stringify(rows[0])
		);
		await page
			.locator('.roster')
			.first()
			.screenshot({ path: `${SHOTS}wp11-people-${vp}.png` });
		await ctx.close();
	}

	// ---- 3. no Markdown asterisks in the manual or the showcase -----------------------------------
	console.log('\n3. the manual and the showcase print no asterisks');
	for (const locale of ['en', 'pl']) {
		const ctx = await contextFor(browser, locale, DESKTOP);
		const page = await ctx.newPage();
		watch(page);
		for (const path of [
			'/about/guide/start',
			'/about/guide/submit',
			'/about/guide/help',
			'/about/guide/contests',
			'/about/contests'
		]) {
			await open(page, path);
			const root = page.locator('main').first();
			await root.waitFor();
			const text = await root.innerText();
			const hit = MARKDOWN_EMPHASIS.exec(text);
			check(
				`${locale} ${path}: no *emphasis* printed`,
				!hit,
				hit ? `…${text.slice(Math.max(0, hit.index - 30), hit.index + 30)}…` : ''
			);
			if (path === '/about/guide/start') await shoot(page, `guide-start-${locale}`);
		}
		await ctx.close();
	}

	// ---- 4. the tutoring showcase says what the clock really does -----------------------------------
	console.log('\n4. /about/tutoring on time zones');
	for (const locale of ['en', 'pl']) {
		const ctx = await contextFor(browser, locale, DESKTOP);
		const page = await ctx.newPage();
		watch(page);
		await open(page, '/about/tutoring');
		const text = await page.locator('main').first().innerText();
		// Since 2026-10-15 (`ux/tz-warsaw`) the server reads the hours in Polish time and the page
		// says so; the sentence WP11 wrote about the UTC bug must be gone, not kept beside it.
		check(`${locale}: says the hours are Polish time`, /Polish time|czasie polskim/.test(text));
		check(`${locale}: no longer describes the UTC bug`, !text.includes('UTC'));
		check(
			`${locale}: no longer claims the times are shown in the server's zone`,
			!/server’s time zone|strefie czasowej serwera/.test(text)
		);
		await ctx.close();
	}

	// ---- 5. /about with organisations off, for a stranger ---------------------------------------
	console.log('\n5. /about with `organizations` off, anonymous');
	await setFlag('organizations', false);
	try {
		for (const [locale, vp, viewport] of [
			['en', 'desktop', DESKTOP],
			['pl', 'phone', PHONE]
		]) {
			const ctx = await contextFor(browser, locale, viewport);
			const page = await ctx.newPage();
			const before = errors.length;
			watch(page);
			let asked = 0;
			page.on('request', (r) => {
				if (r.url().includes('/api/organizations/')) asked++;
			});
			await open(page, '/about');
			await page.locator('.about__research').waitFor({ timeout: 30000 });
			await page.waitForTimeout(2500);
			check(`${locale} ${vp}: no request for the organisation`, asked === 0, `${asked} request(s)`);
			check(
				`${locale} ${vp}: no console or page error`,
				errors.length === before,
				errors.slice(before).join(' | ').slice(0, 300)
			);
			check(
				`${locale} ${vp}: the rest of the page is drawn`,
				(await page.locator('.about__research').count()) === 1 &&
					(await page.locator('[data-start-here="about"]').count()) === 1
			);
			check(
				`${locale} ${vp}: no bare "unavailable" notice at the top of About`,
				(await page.locator('.feature-disabled').count()) === 0
			);
			await shoot(page, `about-orgs-off-${locale}-${vp}`);
			await ctx.close();
		}
	} finally {
		await setFlag('organizations', true);
	}
	const flags = await (await fetch(`${API}/feature-flags/`)).json();
	check(
		'organizations is back on',
		flags.find((f) => f.key === 'organizations')?.is_enabled === true
	);
} finally {
	await browser.close();
}

check('zero console/page errors', errors.length === 0, errors.join(' | ').slice(0, 400));
console.log(`\n${pass} passed, ${fail} failed${skipped ? `, ${skipped} skipped` : ''}`);
process.exit(fail ? 1 : 0);
