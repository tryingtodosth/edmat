// A screenshot sweep of the colour-bearing pages — light + dark at 1280, light at 390, anonymous
// and signed in as kasia — so a theme or token change can be LOOKED at page by page (house rule 2)
// rather than trusted. Written for the 2026-10-07 colour pass (HISTORY.md §17BV), where the
// "before" set and the "after" set of these very shots were what the design panel and the visual
// reviewers judged. Not a check-counter: it prints the files it wrote and any page errors.
//
//   E2E_BASE=http://localhost:5260 E2E_API=http://127.0.0.1:8160/api node e2e/colour-screens.mjs <outdir> [prefix]
//
// Signing in: `POST /api/auth/login/` is throttled (~10/hour per IP, trap 1), and a sweep like this
// is often re-run several times in a row. Set `E2E_TOKEN` to kasia's DRF token (one per user, stable:
// `manage.py shell -c "from rest_framework.authtoken.models import Token; ..."`) to skip the login;
// without it the script logs in once. The pages: the home tabs, an exercise, a branch, the hubs,
// search, login; signed in: home, flashcards, my set, settings, notifications, courses, /work.
import { mkdirSync } from 'node:fs';
import { chromium } from 'playwright-core';

const BASE = process.env.E2E_BASE ?? 'http://localhost:5260';
const API = process.env.E2E_API ?? 'http://127.0.0.1:8160/api';
const OUT = process.argv[2] ?? './shots';
const LABEL = process.argv[3] ?? '';
// `CHROME`, like every other script here; unset, playwright-core picks its own cached build. Until
// 2026-11-03 this one script read `E2E_CHROMIUM` and defaulted to a hard-coded full
// `chromium-1234`, which will not start on a machine without its system libraries (`libcups`), so
// the `CHROME=<chrome-headless-shell>` every other run passes was silently ignored. `E2E_CHROMIUM`
// is still read, as an alias, so an old command line keeps working.
const EXE = process.env.CHROME ?? process.env.E2E_CHROMIUM;
mkdirSync(OUT, { recursive: true });

const j = async (p, init) => {
	const r = await fetch(API + p, init);
	if (!r.ok) throw new Error(`${p} ${r.status}`);
	return r.json();
};
const branches = await j('/branches/?content_locales=pl,en');
const branchSlug = branches[0]?.slug ?? branches[0]?.id;
const exercises = await j('/exercises/?content_locales=pl,en');
const exId = exercises[0]?.id;
const savedToken = process.env.E2E_TOKEN ?? '';
const login = savedToken
	? { token: savedToken }
	: await j('/auth/login/', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ username: 'kasia@edmat.example', password: 'password123' })
		});
const token = login.token;
console.log('branch', branchSlug, 'exercise', exId, 'token', token ? 'ok' : 'none');

const browser = await chromium.launch(EXE ? { executablePath: EXE } : {});
const errors = [];

async function shoot(ctx, path, name, { theme, width, height, waitMath = false, full = false }) {
	const page = await ctx.newPage();
	page.on('pageerror', (e) => errors.push(`${name}: ${String(e).slice(0, 140)}`));
	await page.addInitScript((t) => {
		try {
			localStorage.setItem('edmat-theme', t);
			localStorage.setItem('edmat.contentLocales', '["pl","en"]');
		} catch {
			// localStorage can throw in a locked-down context; the page then just uses its defaults.
		}
	}, theme);
	const flags = page
		.waitForResponse((r) => r.url().includes('/feature-flags/'), { timeout: 30000 })
		.catch(() => null);
	await page.goto(BASE + path, { waitUntil: 'load' });
	await flags;
	await page.waitForTimeout(1200);
	if (waitMath) await page.waitForSelector('.katex', { timeout: 15000 }).catch(() => {});
	await page.waitForTimeout(400);
	const file = `${OUT}/${LABEL}${name}-${theme}-${width}.png`;
	await page.screenshot({
		path: file,
		fullPage: full,
		clip: full ? undefined : { x: 0, y: 0, width, height }
	});
	await page.close();
	console.log('shot', file);
}

const anonPages = [
	['/', 'home', {}],
	['/?tab=materials', 'home-materials', {}],
	['/?tab=events', 'home-events', {}],
	[`/exercises/${exId}`, 'exercise', { waitMath: true, full: true }],
	[`/branches/${branchSlug}`, 'branch', { full: true }],
	['/disciplines', 'disciplines', {}],
	['/events', 'events', {}],
	['/korki', 'tutoring', {}],
	['/concepts', 'concepts', {}],
	['/about', 'about', {}],
	['/coop', 'coop', {}],
	['/search?q=ca%C5%82ka', 'search', {}],
	['/login', 'login', {}]
];
const authPages = [
	['/', 'home-auth', {}],
	['/flashcards', 'flashcards', {}],
	['/my-set', 'my-set', {}],
	['/settings', 'settings', { full: true }],
	['/notifications', 'notifications', {}],
	['/courses', 'courses', {}],
	['/work', 'work', {}]
];

for (const [theme, width, height] of [
	['light', 1280, 900],
	['dark', 1280, 900],
	['light', 390, 844]
]) {
	const ctx = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: 1 });
	for (const [p, n, o] of anonPages) {
		if (width === 390 && !['home', 'exercise', 'branch'].includes(n)) continue;
		await shoot(ctx, p, n, { theme, width, height, ...o });
	}
	await ctx.close();
	if (width === 390) continue;
	const actx = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: 1 });
	await actx.addInitScript((t) => {
		try {
			localStorage.setItem('edmat-auth-token', t);
		} catch {
			// localStorage can throw in a locked-down context; the page then just uses its defaults.
		}
	}, token);
	for (const [p, n, o] of authPages) await shoot(actx, p, n, { theme, width, height, ...o });
	await actx.close();
}
await browser.close();
console.log('errors:', errors.length);
for (const e of errors.slice(0, 20)) console.log(' ', e);
