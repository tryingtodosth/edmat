// Usage analytics (backend `analytics/`, 2026-10-14): the staff tab in /moderation that leads to
// /moderation/analytics, the dashboard's sections, the period switch, "recompute", the "<10"
// suppression, and the refusal a plain account gets. Screenshots at 1280 and 390 px wide.
//
// Signs in by TOKEN, never through the login form (e2e/CLAUDE.md trap 30): the two accounts and
// their tokens are made once on the dev database —
//   cd backend && ../.venv/bin/python3 manage.py shell -c "from django.contrib.auth import \
//     get_user_model as g; from rest_framework.authtoken.models import Token as T; U=g(); \
//     s,_=U.objects.get_or_create(username='e2e-analyst'); s.is_staff=True; s.save(); \
//     p,_=U.objects.get_or_create(username='e2e-plainuser'); \
//     print(T.objects.get_or_create(user=s)[0].key, T.objects.get_or_create(user=p)[0].key)"
// The dashboard is empty until something has been rolled up: run `manage.py rollup_analytics
// --days 30` (against seeded or real log shards) first.
//
// Run: CHROME=<chromium> E2E_BASE=http://localhost:5191 E2E_STAFF_TOKEN=… E2E_USER_TOKEN=… \
//        E2E_SHOTS=/tmp/shots node e2e/analytics.mjs
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
const USER = process.env.E2E_USER_TOKEN;
if (!STAFF || !USER) throw new Error('E2E_STAFF_TOKEN and E2E_USER_TOKEN are required');

let pass = 0,
	fail = 0;
const check = (l, ok, x = '') => {
	if (ok) pass++;
	else fail++;
	console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${l}${ok ? '' : '  <- ' + x}`);
};

const browser = await chromium.launch(
	process.env.CHROME ? { executablePath: process.env.CHROME } : {}
);
const pageErrors = [];

async function ctxFor(token, width) {
	const c = await englishContext(browser, BASE, { viewport: { width, height: 1000 } });
	// Runs in every frame, including about:blank where storage is refused — hence the try.
	await c.addInitScript((t) => {
		try {
			localStorage.setItem('edmat-auth-token', t);
		} catch {
			/* not this document */
		}
	}, token);
	c.on('page', (pg) => {
		pg.on('pageerror', (e) => pageErrors.push(e.message));
		pg.on('console', (msg) => {
			if (msg.type() === 'error' && !/Failed to load resource/.test(msg.text()))
				pageErrors.push(msg.text());
		});
	});
	return c;
}

/** goto, then wait for the root layout's boot request (trap 25), then for the sections to load. */
async function go(p, url) {
	const booted = p
		.waitForResponse((r) => r.url().includes('/feature-flags/'), { timeout: 30000 })
		.catch(() => null);
	await p.goto(url, { waitUntil: 'load' });
	await booted;
	await p.waitForTimeout(600);
}
async function sectionsLoaded(p) {
	await p
		.waitForFunction(
			() => document.querySelectorAll('section[aria-busy="true"]').length === 0,
			null,
			{
				timeout: 30000
			}
		)
		.catch(() => null);
	await p.waitForTimeout(300);
}

// ---- staff, desktop ------------------------------------------------------------------------------
{
	const c = await ctxFor(STAFF, 1280);
	const p = await c.newPage();
	const apiCalls = [];
	p.on('request', (r) => {
		if (r.url().includes('/api/analytics/')) apiCalls.push(r.url());
	});
	await go(p, `${BASE}/moderation`);
	const tab = p.locator('#mod-tab-analytics');
	await tab.waitFor({ timeout: 20000 }).catch(() => null);
	check('the moderation page shows an Analytics tab to staff', (await tab.count()) === 1);
	check('the tab reads "Analytics"', (await tab.textContent())?.trim() === 'Analytics');
	await tab.click();
	await p.waitForURL('**/moderation/analytics', { timeout: 15000 }).catch(() => null);
	check(
		'clicking it lands on /moderation/analytics',
		p.url().endsWith('/moderation/analytics'),
		p.url()
	);
	await sectionsLoaded(p);

	check('one <title>', (await p.locator('head title').count()) === 1);
	const headings = await p.locator('main h2, .page h2').allTextContents();
	for (const word of [
		'Traffic',
		'Content',
		'Community',
		'Moderation',
		'Retention',
		'Clients',
		'Health',
		'does not know'
	]) {
		check(
			`a section about ${word}`,
			headings.some((h) => h.includes(word)),
			headings.join(' | ')
		);
	}
	const tiles = await p.locator('.tile').count();
	check('KPI tiles are drawn', tiles >= 8, String(tiles));
	check('no section failed to load', (await p.locator('section .error').count()) === 0);
	check('charts are inline SVG', (await p.locator('section svg').count()) >= 3);
	check(
		'every request went to /api/analytics/ with ?days=30 (health excepted)',
		apiCalls.filter((u) => !u.includes('/health/')).every((u) => u.includes('days=30')),
		apiCalls.join(' ')
	);
	const privacy = (await p.locator('#an-privacy').locator('..').textContent()) ?? '';
	check(
		'the privacy panel links /privacy',
		(await p.locator('section a[href$="/privacy"]').count()) >= 1
	);
	check('the privacy panel names Global Privacy Control', /Global Privacy Control/i.test(privacy));
	const suppressed = await p.locator('.hidden-count').count();
	check(
		'small groups of people are drawn as "<10"',
		suppressed === 0 || (await p.locator('.hidden-count').first().textContent())?.includes('<10')
	);
	const bodyText = (await p.textContent('body')) ?? '';
	check(
		'no IP address appears anywhere on the dashboard',
		!/\b\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}\b/.test(bodyText)
	);

	await p.screenshot({ path: `${SHOTS}/analytics-desktop.png`, fullPage: true });

	apiCalls.length = 0;
	await p.getByRole('button', { name: '7 days', exact: true }).click();
	await sectionsLoaded(p);
	check(
		'the period switch reloads with ?days=7',
		apiCalls.some((u) => u.includes('days=7')),
		apiCalls.join(' ')
	);

	const recompute = p.locator('button', { hasText: /Recompute/ });
	check('a recompute button exists', (await recompute.count()) === 1);
	const answered = p
		.waitForResponse((r) => r.url().includes('/api/analytics/recompute/'), { timeout: 90000 })
		.catch(() => null);
	await recompute.click();
	const res = await answered;
	check('recompute answers 200', res?.status() === 200, String(res?.status()));
	await sectionsLoaded(p);
	await c.close();
}

// ---- staff, phone ------------------------------------------------------------------------------
{
	const c = await ctxFor(STAFF, 390);
	const p = await c.newPage();
	await go(p, `${BASE}/moderation/analytics`);
	await sectionsLoaded(p);
	const overflow = await p.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
	check('no horizontal page scroll at 390 px', overflow <= 1, `${overflow}px wider`);
	await p.screenshot({ path: `${SHOTS}/analytics-phone.png`, fullPage: true });
	await c.close();
}

// ---- a plain account -----------------------------------------------------------------------------
{
	const c = await ctxFor(USER, 1280);
	const p = await c.newPage();
	const analyticsResponses = [];
	p.on('response', (r) => {
		if (r.url().includes('/api/analytics/')) analyticsResponses.push(r.status());
	});
	await go(p, `${BASE}/moderation`);
	// Wait until the page has decided (the refusal is drawn), or "no tab" would be vacuous.
	await p
		.getByText(/only available to moderators/i)
		.waitFor({ timeout: 20000 })
		.catch(() => null);
	check(
		'a plain account sees no Analytics tab',
		(await p.locator('#mod-tab-analytics').count()) === 0
	);
	await go(p, `${BASE}/moderation/analytics`);
	const text = (await p.textContent('body')) ?? '';
	check(
		'a plain account is refused at /moderation/analytics',
		/only available to moderators/i.test(text)
	);
	check(
		'…and the page asked the API for nothing',
		analyticsResponses.length === 0,
		analyticsResponses.join(',')
	);
	await p.screenshot({ path: `${SHOTS}/analytics-refused.png` });
	await c.close();
}

check('zero page errors', pageErrors.length === 0, pageErrors.slice(0, 5).join(' || '));
await browser.close();
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
