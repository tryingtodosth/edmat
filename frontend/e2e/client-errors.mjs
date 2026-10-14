// The browser error reporter (`lib/errors/reporter.ts`, backend `analytics/client_errors.py`,
// LINKING-AND-ERRORS.md §3.3, 2026-10-14). Drives a real Chromium against both servers:
//
//  1. a deliberate uncaught error on an exercise page sends ONE beacon whose body has exactly the
//     six allowlisted keys, the route TEMPLATE (`/exercises/[id]`), no URL origin/query anywhere,
//     and no `Authorization` header — even though the context is signed in;
//  2. the same error again is not sent again (dedupe), and a burst stops at 5 per page load;
//  3. an unhandled promise rejection is reported as `rejection`;
//  4. no cookie, localStorage, sessionStorage or IndexedDB key appears because of any of it
//     (listed before and after the errors);
//  5. a context whose browser says `navigator.globalPrivacyControl === true` sends nothing, and
//     neither does one with `navigator.doNotTrack === '1'`;
//  6. the staff dashboard's "Browser errors" section shows the group, with its sample stack.
//
// The browser's own User-Agent is replaced by a plain desktop Chrome one, because headless
// Chromium announces itself as `HeadlessChrome` and the server would file it under "bots".
//
// Signs in by TOKEN (e2e/CLAUDE.md trap 30); the staff account is the analytics script's:
//   cd backend && ../.venv/bin/python3 manage.py shell -c "from django.contrib.auth import \
//     get_user_model as g; from rest_framework.authtoken.models import Token as T; U=g(); \
//     s,_=U.objects.get_or_create(username='e2e-analyst'); s.is_staff=True; s.save(); \
//     print(T.objects.get_or_create(user=s)[0].key)"
// Each run spends up to 7 of the `client_error` throttle's 30/hour for this IP.
//
// Run: CHROME=<chromium> E2E_BASE=http://localhost:5197 E2E_STAFF_TOKEN=… E2E_EXERCISE=1 \
//        E2E_SHOTS=/tmp/shots node e2e/client-errors.mjs
import { englishContext } from './english.mjs';

let chromium;
try {
	({ chromium } = await import('playwright'));
} catch {
	({ chromium } = await import('playwright-core'));
}
const BASE = process.env.E2E_BASE ?? 'http://localhost:5173';
const SHOTS = process.env.E2E_SHOTS ?? '/tmp';
const STAFF = process.env.E2E_STAFF_TOKEN;
const EXERCISE = process.env.E2E_EXERCISE ?? '1';
if (!STAFF) throw new Error('E2E_STAFF_TOKEN is required');
const UA =
	'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';
const MARK = `e2e-deliberate-${Date.now() % 100000}`;
const ALLOWED = ['build', 'kind', 'locale', 'message', 'route', 'stack'];

let pass = 0,
	fail = 0;
const check = (label, ok, extra = '') => {
	if (ok) pass++;
	else fail++;
	console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${label}${ok ? '' : '  <- ' + extra}`);
};

const browser = await chromium.launch(
	process.env.CHROME ? { executablePath: process.env.CHROME } : {}
);

async function context({ token, privacy } = {}) {
	const ctx = await englishContext(browser, BASE, {
		viewport: { width: 1280, height: 1000 },
		userAgent: UA
	});
	if (token) {
		await ctx.addInitScript((t) => {
			try {
				localStorage.setItem('edmat-auth-token', t);
			} catch {
				/* about:blank */
			}
		}, token);
	}
	if (privacy === 'gpc') {
		await ctx.addInitScript(() => {
			Object.defineProperty(Navigator.prototype, 'globalPrivacyControl', { get: () => true });
		});
	}
	if (privacy === 'dnt') {
		await ctx.addInitScript(() => {
			Object.defineProperty(Navigator.prototype, 'doNotTrack', { get: () => '1' });
		});
	}
	const beacons = [];
	ctx.on('request', (req) => {
		if (req.url().includes('/client-errors/')) {
			beacons.push({ body: req.postData() ?? '', headers: req.headers(), method: req.method() });
		}
	});
	return { ctx, beacons };
}

/** Every cookie, storage key and IndexedDB database the page can see. */
async function deviceState(ctx, page) {
	const cookies = (await ctx.cookies()).map((c) => `cookie:${c.name}`);
	const inPage = await page.evaluate(async () => {
		const out = [];
		for (let i = 0; i < localStorage.length; i++) out.push(`local:${localStorage.key(i)}`);
		for (let i = 0; i < sessionStorage.length; i++) out.push(`session:${sessionStorage.key(i)}`);
		const dbs = indexedDB.databases ? await indexedDB.databases() : [];
		for (const db of dbs) out.push(`idb:${db.name}`);
		return out;
	});
	return [...cookies, ...inPage].sort();
}

const throwLater = (page, message) =>
	page.evaluate((msg) => {
		setTimeout(() => {
			throw new Error(msg);
		}, 0);
	}, message);

const settle = (page, ms = 1200) => page.waitForTimeout(ms);

/** `networkidle` never fires on a signed-in page (the SSE stream, e2e/CLAUDE.md trap 2): wait for
 *  the root layout's own boot request instead (trap 25), and a beat for the lazy reporter. */
async function open(page, path) {
	const booted = page.waitForResponse((r) => r.url().includes('/feature-flags/'), {
		timeout: 60000
	});
	await page.goto(`${BASE}${path}`, { waitUntil: 'load' });
	await booted;
	await settle(page, 1500);
}

// ---- 1-4: a signed-in visitor on an exercise page ------------------------------------------------
console.log('signed-in visitor, no privacy signal');
{
	const { ctx, beacons } = await context({ token: STAFF });
	const page = await ctx.newPage();
	await open(page, `/exercises/${EXERCISE}`);
	const before = await deviceState(ctx, page);
	check('no beacon on a page that did not break', beacons.length === 0, JSON.stringify(beacons));

	await throwLater(page, `${MARK} id 4711 at https://evil.example/leak?q=secret#frag`);
	await settle(page);
	check('one beacon for one error', beacons.length === 1, `${beacons.length}`);
	const first = beacons[0];
	let body = {};
	try {
		body = JSON.parse(first?.body ?? '{}');
	} catch {
		/* checked below */
	}
	console.log('    payload:', JSON.stringify(body).slice(0, 400));
	check('POST', first?.method === 'POST', first?.method);
	check(
		'exactly the six allowlisted keys',
		JSON.stringify(Object.keys(body).sort()) === JSON.stringify(ALLOWED),
		Object.keys(body).join(',')
	);
	check('kind is error', body.kind === 'error', body.kind);
	check('route is the TEMPLATE', body.route === '/exercises/[id]', body.route);
	check('locale is en', body.locale === 'en', body.locale);
	check('build is set', typeof body.build === 'string' && body.build.length > 0, body.build);
	check('message carries the error', String(body.message).includes(MARK), body.message);
	const text = `${body.message}\n${body.stack}`;
	check('no origin anywhere', !/https?:\/\//.test(text), text.slice(0, 300));
	check('no query or fragment', !/q=secret|#frag|evil\.example/.test(text), text.slice(0, 300));
	check('no concrete exercise address', !text.includes(`/exercises/${EXERCISE}`), text);
	check(
		'no Authorization header',
		!('authorization' in (first?.headers ?? {})),
		JSON.stringify(first?.headers)
	);

	await throwLater(page, `${MARK} id 4711 at https://evil.example/leak?q=secret#frag`);
	await settle(page);
	check('the identical error is not sent twice', beacons.length === 1, `${beacons.length}`);

	await page.evaluate((m) => {
		setTimeout(() => Promise.reject(new Error(`${m} rejection`)), 0);
	}, MARK);
	await settle(page);
	const rejection = beacons[1] ? JSON.parse(beacons[1].body) : {};
	check(
		'a rejection is reported as rejection',
		rejection.kind === 'rejection',
		JSON.stringify(rejection).slice(0, 200)
	);

	for (let i = 0; i < 6; i++) await throwLater(page, `${MARK} burst ${i}`);
	await settle(page, 1500);
	check('at most 5 per page load', beacons.length === 5, `${beacons.length}`);

	const after = await deviceState(ctx, page);
	console.log('    device state before:', before.join(' '));
	console.log('    device state after: ', after.join(' '));
	check(
		'no new cookie or storage key',
		JSON.stringify(before) === JSON.stringify(after),
		after.join(' ')
	);
	await ctx.close();
}

// ---- 5: Global Privacy Control, Do Not Track ------------------------------------------------------
for (const privacy of ['gpc', 'dnt']) {
	console.log(`visitor with ${privacy.toUpperCase()}`);
	const { ctx, beacons } = await context({ privacy });
	const page = await ctx.newPage();
	await open(page, `/exercises/${EXERCISE}`);
	const signal = await page.evaluate(() => [navigator.globalPrivacyControl, navigator.doNotTrack]);
	check(
		`${privacy}: the signal is visible to the page`,
		privacy === 'gpc' ? signal[0] === true : signal[1] === '1',
		JSON.stringify(signal)
	);
	await throwLater(page, `${MARK} under ${privacy}`);
	await page.evaluate(() => {
		setTimeout(() => Promise.reject(new Error('rejected under a privacy signal')), 0);
	});
	await settle(page, 2000);
	check(`${privacy}: nothing sent`, beacons.length === 0, `${beacons.length}`);
	await ctx.close();
}

// ---- 6: the staff dashboard ---------------------------------------------------------------------
console.log('staff dashboard');
{
	const { ctx } = await context({ token: STAFF });
	const page = await ctx.newPage();
	const errors = [];
	page.on('pageerror', (e) => errors.push(e.message));
	await open(page, '/moderation/analytics');
	const section = page.locator('section[aria-labelledby="an-client-errors"]');
	await section.waitFor({ timeout: 20000 });
	await section.locator('.group').first().waitFor({ timeout: 20000 });
	const heading = await section.locator('h2').innerText();
	check('section heading', heading.trim() === 'Browser errors', heading);
	const group = section.locator('.group', {
		hasText: `${MARK} id 4711`.replace(/\b\d+\b/g, 'N')
	});
	// Earlier runs leave their own groups (a Playwright `evaluate` frame carries a per-run offset,
	// so each run can be a group of its own) — so: at least one, and the one holding THIS run's
	// sample is the one checked.
	check(
		'the deliberate error is a group, its numbers normalised',
		(await group.count()) >= 1,
		`${await group.count()}`
	);
	const groupText = (await group.first().innerText()).replace(/\s+/g, ' ');
	check('route template shown', groupText.includes('/exercises/[id]'), groupText.slice(0, 300));
	check('browser family shown', groupText.includes('Chrome'), groupText.slice(0, 300));
	check('a sparkline per group', (await group.first().locator('svg polyline').count()) === 1);
	await section.screenshot({ path: `${SHOTS}/client-errors-dashboard.png` });
	for (const summary of await group.locator('summary').all()) await summary.click();
	const stacks = await group.locator('pre.stack').allInnerTexts();
	const mine = stacks.find((t) => t.includes(MARK)) ?? '';
	check(
		'sample stack opens, with paths only',
		mine !== '' && !/https?:\/\//.test(mine),
		stacks.join(' || ').slice(0, 300)
	);
	const ownGroup = group.filter({ has: page.locator('pre.stack', { hasText: MARK }) }).first();
	await ownGroup.screenshot({ path: `${SHOTS}/client-errors-group-open.png` });
	await page.setViewportSize({ width: 390, height: 900 });
	await section.scrollIntoViewIfNeeded();
	const overflow = await page.evaluate(
		() => document.documentElement.scrollWidth > window.innerWidth
	);
	check('no horizontal scroll at 390 px', !overflow);
	await ownGroup.screenshot({ path: `${SHOTS}/client-errors-group-390.png` });
	check('no page errors on the dashboard', errors.length === 0, errors.join(' | '));
	await ctx.close();
}

await browser.close();
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
