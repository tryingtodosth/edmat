// Phase 4 hardening: a real, mechanical, re-runnable accessibility audit — drives a real headless
// browser against the app's real running dev servers and runs the real axe-core engine in-page,
// against every major route (Section 15's own routing sketch), both anonymous and authenticated,
// the same "import/run the real thing, don't reimplement it" discipline
// check_katex_compatibility.ts already established for the LaTeX sweep.
//
// Prerequisites: both dev servers running (`cd backend && .venv/bin/python manage.py runserver
// 8000`, `cd frontend && npm run dev -- --port 5174`), and the demo users seeded
// (`manage.py seed_demo_users`).
//
// Usage: npx tsx scripts/check_accessibility.ts [--base http://localhost:5174] [--api http://localhost:8000]
//
// Reports every axe-core violation, grouped by page, at 'critical'/'serious' impact — those two
// tiers are what gates a nonzero exit; 'moderate'/'minor' findings are printed for visibility but
// don't fail the check on their own (axe-core's own impact taxonomy, not an invented one), since a
// real minor/moderate finding is often a legitimate design tradeoff, not a hard defect.
import { readFileSync, existsSync } from 'node:fs';
import { chromium } from 'playwright-core';

const args = process.argv.slice(2);
function argVal(flag: string, fallback: string): string {
	const i = args.indexOf(flag);
	return i !== -1 && args[i + 1] ? args[i + 1] : fallback;
}
const BASE = argVal('--base', 'http://localhost:5174');
const API = argVal('--api', 'http://localhost:8000');

const CHROMIUM_PATH = `${process.env.HOME}/.cache/ms-playwright/chromium-1234/chrome-linux64/chrome`;

interface AxeNode {
	target: string[];
	html: string;
}
interface AxeViolation {
	id: string;
	impact: 'minor' | 'moderate' | 'serious' | 'critical' | null;
	description: string;
	help: string;
	helpUrl: string;
	nodes: AxeNode[];
}
interface AxeResults {
	violations: AxeViolation[];
}

// Minimal shapes — just the fields this script actually reads, not full API contracts (those
// already live in `$lib/types`/`$lib/api/mappers.ts`, but this is a plain Node script outside the
// SvelteKit app, run against the raw backend JSON directly, not through that mapping layer).
interface RawFieldRow {
	slug: string;
}
interface RawCourseRow {
	slug: string;
	id: number;
}
interface RawExerciseRow {
	id: number;
}
interface RawLoginResponse {
	token: string;
	profile: { id: number };
}

async function fetchJson<T>(path: string, init?: RequestInit): Promise<T> {
	const res = await fetch(`${API}${path}`, {
		...init,
		headers: { 'Content-Type': 'application/json', ...(init?.headers ?? {}) }
	});
	if (!res.ok) throw new Error(`${path} -> ${res.status}`);
	return res.json() as Promise<T>;
}

async function main() {
	// Resolve real ids/slugs to visit, rather than hardcoding numbers that could drift the moment
	// the seed data changes — the same "read the real running system" discipline the KaTeX sweep's
	// own browser spot-check already used for its own id list. Deliberately picks the RICHEST real
	// course across every field (most exercises), not just `fields[0]`/`courses[0]` — two of this
	// corpus's own four courses are 1-exercise stubs (Section 3), and auditing one of those would
	// never exercise the exercise-detail page's real progressive-reveal hint/answer/solution
	// sections or its real, LaTeX-heavy content at any meaningful scale.
	const fields = await fetchJson<RawFieldRow[]>('/api/fields/');
	let bestCourseSlug = '';
	let bestFieldSlug = '';
	let bestExerciseCount = -1;
	for (const field of fields) {
		const courses = await fetchJson<RawCourseRow[]>(`/api/fields/${field.slug}/courses/`);
		for (const course of courses) {
			const exercises = await fetchJson<RawExerciseRow[]>(`/api/courses/${course.slug}/exercises/`);
			if (exercises.length > bestExerciseCount) {
				bestExerciseCount = exercises.length;
				bestCourseSlug = course.slug;
				bestFieldSlug = field.slug;
			}
		}
	}
	const fieldSlug = bestFieldSlug;
	const courseSlug = bestCourseSlug;
	const exercises = await fetchJson<RawExerciseRow[]>(`/api/courses/${courseSlug}/exercises/`);
	// Prefer a real, migrated exercise (a >2-digit id, not one of the low-numbered test fixtures
	// created during earlier Phase 3 verification passes) so the audited page has real, representative
	// content — long statements, hints, solutions — not a two-word placeholder.
	const realExercise = exercises.find((e) => e.id > 10) ?? exercises[0];
	const exerciseId = realExercise.id;

	const login = await fetchJson<RawLoginResponse>('/api/auth/login/', {
		method: 'POST',
		body: JSON.stringify({ username: 'kasia@edmat.example', password: 'password123' })
	});
	const kasiaToken = login.token;
	const kasiaUserId = login.profile.id;

	console.log(
		`Targeting field=${fieldSlug} course=${courseSlug} exercise=${exerciseId} user=${kasiaUserId}`
	);

	if (!existsSync(CHROMIUM_PATH)) {
		console.error(`Chromium binary not found at ${CHROMIUM_PATH}`);
		process.exit(2);
	}
	const axeSource = readFileSync(
		new URL('../node_modules/axe-core/axe.min.js', import.meta.url),
		'utf-8'
	);

	const browser = await chromium.launch({ executablePath: CHROMIUM_PATH });

	// Anonymous pages — no auth token set.
	const anonPages: { name: string; url: string }[] = [
		{ name: 'Home', url: '/' },
		{ name: 'Field', url: `/fields/${fieldSlug}` },
		{ name: 'Course', url: `/courses/${courseSlug}` },
		{ name: 'Exercise detail', url: `/exercises/${exerciseId}` },
		{ name: 'My Set (guest)', url: '/my-set' },
		{ name: 'Login', url: '/login' },
		{ name: 'Register', url: '/register' },
		{ name: 'Public profile', url: `/users/${kasiaUserId}` }
	];

	// Authenticated pages — a real moderator session (broadest surface: sees the moderation queue,
	// the notification bell with real content, and every settings section).
	const authPages: { name: string; url: string }[] = [
		{ name: 'Settings', url: '/settings' },
		{ name: 'Submit exercise', url: '/submit' },
		{ name: 'Moderation queue', url: '/moderation' },
		{ name: 'Notifications', url: '/notifications' }
	];

	const context = await browser.newContext();
	// Seed localStorage with the real auth token BEFORE any authenticated page loads, the same way a
	// real browser would have it already present from an earlier login — matching
	// `token.svelte.ts`'s own real persistence key (`STORAGE_KEY = 'edmat-auth-token'`).
	await context.addInitScript((token) => {
		window.localStorage.setItem('edmat-auth-token', token);
	}, kasiaToken);

	const page = await context.newPage();

	const allResults: {
		name: string;
		url: string;
		violations: AxeViolation[];
		consoleErrors: string[];
		bodyTextLength: number;
	}[] = [];

	async function auditPage(name: string, url: string, beforeAudit?: () => Promise<void>) {
		// A page that silently fails to render (a thrown error mid-mount, a 404 that renders blank)
		// would trivially "pass" axe-core with zero violations just because there's nothing left to
		// audit — the same false-negative risk the KaTeX sweep's own browser spot-check already had
		// to guard against for the same underlying reason. Console/page errors and a real content
		// sanity check (a non-trivial amount of body text) are what makes a clean result here mean
		// "genuinely accessible," not "genuinely empty."
		const errors: string[] = [];
		const consoleHandler = (msg: import('playwright-core').ConsoleMessage) => {
			if (msg.type() === 'error') errors.push(msg.text());
		};
		const pageErrorHandler = (err: Error) => errors.push(err.message);
		page.on('console', consoleHandler);
		page.on('pageerror', pageErrorHandler);

		await page.goto(`${BASE}${url}`, { waitUntil: 'networkidle' }).catch(() => {});
		await page.waitForTimeout(300); // let Svelte's own post-mount effects/hydration settle
		if (beforeAudit) await beforeAudit();
		const bodyTextLength = await page
			.locator('body')
			.innerText()
			.then((t) => t.trim().length)
			.catch(() => 0);
		await page.addScriptTag({ content: axeSource });
		const results: AxeResults = await page.evaluate(async () => {
			// @ts-expect-error — axe is injected globally by the script tag above
			return await window.axe.run(document, {
				resultTypes: ['violations'],
				// Excludes the one known, deliberate exception this app documents: a Vite/SvelteKit dev
				// overlay iframe axe-core can't meaningfully audit and that never ships to production.
				exclude: [['vite-error-overlay']]
			});
		});

		page.off('console', consoleHandler);
		page.off('pageerror', pageErrorHandler);
		allResults.push({
			name,
			url,
			violations: results.violations,
			consoleErrors: errors,
			bodyTextLength
		});
	}

	for (const p of anonPages) await auditPage(p.name, p.url);

	// The exercise-detail page's hint/answer/solution sections don't render into the DOM until
	// clicked (Section 7's own "progressive reveal" requirement) — auditing only the collapsed
	// state would never exercise their own expand-button ARIA state or the real, LaTeX-heavy
	// content revealed underneath. Re-visits the same page and clicks each reveal button before
	// running axe a second time, mirroring the exact interaction the KaTeX sweep's own real-browser
	// spot-check already performs for the same underlying reason.
	await auditPage('Exercise detail (revealed)', `/exercises/${exerciseId}`, async () => {
		for (const label of ['hint', 'answer', 'solution']) {
			await page
				.locator('button', { hasText: new RegExp(label, 'i') })
				.first()
				.click({ timeout: 1000 })
				.catch(() => {});
		}
		await page.waitForTimeout(150);
	});

	for (const p of authPages) await auditPage(p.name, p.url);

	await browser.close();

	// Below this, the header/nav/footer chrome alone (brand name + every nav link's own label)
	// already exceeds it on a real render — anything under it means the page's own main content
	// most likely failed to mount, which would make a "zero violations" result meaningless rather
	// than reassuring.
	const MIN_BODY_TEXT_LENGTH = 80;

	let criticalOrSerious = 0;
	let moderateOrMinor = 0;
	let brokenPages = 0;
	for (const { name, url, violations, consoleErrors, bodyTextLength } of allResults) {
		const looksBlank = bodyTextLength < MIN_BODY_TEXT_LENGTH;
		if (consoleErrors.length > 0 || looksBlank) {
			brokenPages++;
			console.log(`\n=== ${name} (${url}) — page-load problem, axe result is NOT trustworthy ===`);
			if (looksBlank)
				console.log(`  body text is only ${bodyTextLength} chars — page likely failed to render`);
			for (const e of consoleErrors.slice(0, 5)) console.log(`  console/page error: ${e}`);
		}
		if (violations.length === 0) continue;
		console.log(`\n=== ${name} (${url}) — ${violations.length} rule(s) violated ===`);
		for (const v of violations) {
			const isSevere = v.impact === 'critical' || v.impact === 'serious';
			if (isSevere) criticalOrSerious += v.nodes.length;
			else moderateOrMinor += v.nodes.length;
			console.log(`  [${v.impact ?? 'unknown'}] ${v.id} — ${v.help} (${v.nodes.length} node(s))`);
			console.log(`    ${v.helpUrl}`);
			for (const node of v.nodes.slice(0, 3)) {
				console.log(`    target: ${node.target.join(' ')}`);
				console.log(`    html: ${node.html.slice(0, 150)}`);
			}
		}
	}

	console.log(
		`\nAudited ${allResults.length} pages (${brokenPages} had a load problem). ` +
			`${criticalOrSerious} critical/serious violation node(s), ${moderateOrMinor} moderate/minor violation node(s).`
	);
	process.exit(criticalOrSerious > 0 || brokenPages > 0 ? 1 : 0);
}

main().catch((err) => {
	console.error(err);
	process.exit(2);
});
