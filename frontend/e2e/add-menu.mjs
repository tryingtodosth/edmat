// The Add… menu, grouped (WP13, 2026-10-15) — the account menu's pattern (WP8) applied to the
// other popover on the bar.
//
// What only a browser can show: that the two groups ("Content", "Something to run") render in
// order under their headings, in BOTH interface languages; that a heading is a label and never a
// stop (the arrow keys walk only the `menuitem`s, Home/End reach the ends, Esc and Tab-out close);
// that the phone drawer draws the same groups under its one "Add…" heading with no orphan
// `menuitem` roles; and — as a NON-staff account, because `can()` bypasses every flag for a
// moderator (e2e/CLAUDE.md trap 10) — that a group whose every entry is switched off disappears
// WITH its heading, and that the whole Add… trigger goes when both groups have (house rule 3).
//
// Run with both servers up:
//   E2E_BASE=http://localhost:5215 E2E_API=http://127.0.0.1:8065 \
//   E2E_TOKEN=<kasia's token> E2E_USER_TOKEN=<michal's token> E2E_SHOTS=/tmp/shots \
//   node e2e/add-menu.mjs
//
// The tokens are optional (without them the script signs in with password123), but pass them
// when you can — trap 30. It switches seven flags OFF for the killed-group checks and puts each
// back to the value it found in a `finally`, through the staff API the Flags tab uses. Run it
// against a COPY of the database. The non-staff account must be an adult the creation gate lets
// found every kind (michal, on the dev database), or the "run" group is legitimately shorter.
let chromium;
try {
	({ chromium } = await import('playwright'));
} catch {
	({ chromium } = await import('playwright-core'));
}
import { englishContext } from './english.mjs';

const BASE = process.env.E2E_BASE ?? 'http://localhost:5173';
const API = (process.env.E2E_API ?? 'http://127.0.0.1:8000').replace(/\/api\/?$/, '') + '/api';
const PASSWORD = process.env.E2E_DEMO_PASSWORD ?? 'password123';
const SHOTS = process.env.E2E_SHOTS ?? '';

let pass = 0;
let fail = 0;
const errors = [];
const check = (label, ok, extra = '') => {
	if (ok) pass++;
	else fail++;
	console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${label} ${ok ? '' : extra}`);
};

async function api(method, path, token, body) {
	const res = await fetch(`${API}${path}`, {
		method,
		headers: {
			'Content-Type': 'application/json',
			...(token ? { Authorization: `Token ${token}` } : {})
		},
		body: body ? JSON.stringify(body) : undefined
	});
	if (!res.ok && res.status !== 204) {
		throw new Error(`${method} ${path} -> ${res.status}: ${await res.text()}`);
	}
	return res.status === 204 ? null : res.json();
}
const tokenFor = async (email, given) =>
	given ?? (await api('POST', '/auth/login/', null, { username: email, password: PASSWORD })).token;

const STAFF = await tokenFor('kasia@edmat.example', process.env.E2E_TOKEN);
const USER = await tokenFor('michal@edmat.example', process.env.E2E_USER_TOKEN);
const me = await api('GET', '/auth/me/', USER);
if (me.is_staff || me.is_moderator) {
	console.log('E2E_USER_TOKEN must belong to a NON-staff account (trap 10).');
	process.exit(2);
}
const gate = await api('GET', '/creation/', USER);
if (['course', 'event', 'service', 'contest'].some((k) => gate[k] !== null)) {
	console.log(`The creation gate refuses ${me.username} something: ${JSON.stringify(gate)}.`);
	console.log('Use an adult, verified account (see the header).');
	process.exit(2);
}

const flagList = await api('GET', '/feature-flags/', STAFF);
const flagsBefore = Object.fromEntries(
	(Array.isArray(flagList) ? flagList : flagList.results).map((f) => [f.key, f.is_enabled])
);
const setFlag = (key, on) => api('PATCH', `/feature-flags/${key}/`, STAFF, { is_enabled: on });
const CONTENT_FLAGS = ['exercise_submissions', 'material_submissions', 'posts'];
const RUN_FLAGS = ['courses', 'events', 'tutoring', 'contests'];
for (const k of [...CONTENT_FLAGS, ...RUN_FLAGS]) {
	if (!flagsBefore[k]) {
		console.log(`"${k}" is already off on this database; turn it on before running.`);
		process.exit(2);
	}
}

const LABELS = {
	en: { 'add-content': 'Content', 'add-run': 'Something to run', add: 'Add…' },
	pl: { 'add-content': 'Treści', 'add-run': 'Coś do poprowadzenia', add: 'Dodaj…' }
};
// What each group carries for an adult account the gate lets found everything, every switch on.
// `/tutoring/new` is `/korki/new` for a Polish reader (the localized address, 2026-10-01).
const entries = (locale) => ({
	// `/submit/bulk` (2026-10-22) sits right under the one-exercise form it is the batch form of.
	'add-content': ['/submit', '/submit/bulk', '/submit-material', '/activity'],
	'add-run': [
		'/courses/new',
		'/events/new',
		locale === 'pl' ? '/korki/new' : '/tutoring/new',
		'/contests/new'
	]
});
const FIRST = { en: 'Submit exercise', pl: 'Dodaj zadanie' };
const LAST = { en: 'New contest', pl: 'Nowy konkurs' };
const ORDER = ['add-content', 'add-run'];

const browser = await chromium.launch(
	process.env.CHROME ? { executablePath: process.env.CHROME } : {}
);

async function contextFor(locale, { token = null, viewport, dark = false } = {}) {
	const opts = { viewport, ...(dark ? { colorScheme: 'dark' } : {}) };
	// Polish is the default (trap 24), so 'pl' is simply a fresh context.
	const ctx =
		locale === 'en' ? await englishContext(browser, BASE, opts) : await browser.newContext(opts);
	if (token) await ctx.addInitScript((t) => localStorage.setItem('edmat-auth-token', t), token);
	const page = await ctx.newPage();
	page.on('pageerror', (e) => errors.push(`[${locale}] pageerror: ${e.message}`));
	page.on('console', (msg) => {
		if (msg.type() === 'error' && !/status of 40[139]\b/.test(msg.text()))
			errors.push(`[${locale}] console: ${msg.text()}`);
	});
	return { ctx, page };
}

// Trap 25: wait for the root layout's boot requests, registered BEFORE goto, not for an element.
// The creation gate's answer decides two of the groups' entries, so it is waited for as well.
async function open(page, path, signedIn, { phone = false } = {}) {
	const booted = page.waitForResponse((r) => r.url().includes('/feature-flags/'), {
		timeout: 90000
	});
	const gated = signedIn
		? page.waitForResponse((r) => r.url().includes('/api/creation/'), { timeout: 90000 })
		: Promise.resolve();
	await page.goto(`${BASE}${path}`, { waitUntil: 'load' });
	await booted;
	await gated;
	// At 390 the account trigger lives in the drawer, so there is no bar control to wait for.
	if (signedIn && !phone) await page.locator('.account-trigger').waitFor({ timeout: 30000 });
	await page.waitForTimeout(600);
}

const trigger = (page) => page.locator('.site-header button.popover__trigger:has(.add-trigger)');
const menu = (page) => page.locator('.popover__panel[role="menu"]:has([data-group^="add-"])');
const drawerAdd = (page) => page.locator('#site-drawer .drawer__section--add');
const groupsIn = (root) =>
	root.locator('[role="group"][data-group^="add-"]').evaluateAll((els) =>
		els.map((e) => ({
			key: e.dataset.group,
			label: e.getAttribute('aria-label'),
			heading: e.querySelector('[aria-hidden="true"]')?.textContent?.trim(),
			headingFocusable: e.querySelector('[aria-hidden="true"]')?.tabIndex >= 0,
			headingRole: e.querySelector('[aria-hidden="true"]')?.getAttribute('role'),
			hrefs: Array.from(e.querySelectorAll('a')).map(
				(a) => new URL(a.href).pathname + new URL(a.href).search
			),
			roles: Array.from(e.querySelectorAll('a, button')).map((a) => a.getAttribute('role'))
		}))
	);
const activeInfo = (page) =>
	page.evaluate(() => {
		const a = document.activeElement;
		return {
			role: a?.getAttribute('role'),
			text: a?.textContent?.trim(),
			inMenu: !!a?.closest('.popover__panel'),
			addTrigger: !!a?.querySelector?.('.add-trigger')
		};
	});
async function openDrawer(page) {
	await page.locator('.drawer-toggle').click();
	await page.locator('.drawer--open').waitFor({ timeout: 5000 });
	await page.waitForTimeout(400); // the slide-in, before anything is measured or photographed
}

try {
	for (const locale of ['en', 'pl']) {
		const L = LABELS[locale];
		const E = entries(locale);
		console.log(`[${locale}] the Add… menu at 1280, as ${me.username}`);
		const { ctx, page } = await contextFor(locale, {
			token: USER,
			viewport: { width: 1280, height: 900 }
		});
		await open(page, '/', true);
		check('there is one Add… trigger', (await trigger(page).count()) === 1);
		await trigger(page).click();
		await menu(page).waitFor({ timeout: 5000 });
		const groups = await groupsIn(menu(page));
		check(
			'two groups, in order',
			JSON.stringify(groups.map((g) => g.key)) === JSON.stringify(ORDER),
			JSON.stringify(groups.map((g) => g.key))
		);
		for (const g of groups) {
			check(
				`"${g.key}" is labelled "${L[g.key]}" and its heading says so`,
				g.label === L[g.key] && g.heading === L[g.key],
				`${g.label} / ${g.heading}`
			);
			check(
				'its heading is a plain, unfocusable label',
				!g.headingFocusable && g.headingRole === null,
				`${g.headingFocusable} ${g.headingRole}`
			);
			check(
				'its entries are exactly the expected ones',
				JSON.stringify(g.hrefs) === JSON.stringify(E[g.key]),
				JSON.stringify(g.hrefs)
			);
			check(
				'every entry is a menuitem',
				g.roles.every((r) => r === 'menuitem')
			);
		}
		if (SHOTS) await page.screenshot({ path: `${SHOTS}/add-menu-1280-${locale}.png` });

		// ---- the keyboard ----------------------------------------------------------------------
		await page.keyboard.press('Escape');
		await page.waitForTimeout(200);
		let a = await activeInfo(page);
		check(
			'Esc closes it and focus returns to the trigger',
			a.addTrigger && (await menu(page).count()) === 0,
			JSON.stringify(a)
		);
		await page.keyboard.press('ArrowDown');
		await menu(page).waitFor({ timeout: 5000 });
		await page.waitForTimeout(100);
		a = await activeInfo(page);
		check(
			'ArrowDown on the trigger opens it on the first entry',
			a.role === 'menuitem' && a.text === FIRST[locale],
			JSON.stringify(a)
		);
		const total = (await groupsIn(menu(page))).reduce((n, g) => n + g.hrefs.length, 0);
		const walked = [];
		for (let i = 0; i < total; i++) {
			await page.keyboard.press('ArrowDown');
			walked.push(await activeInfo(page));
		}
		check(
			`ArrowDown walks ${total} entries across both groups and wraps, never on a heading`,
			total === 7 &&
				walked.every((w) => w.role === 'menuitem') &&
				walked[walked.length - 1].text === a.text,
			JSON.stringify(walked.map((w) => w.text))
		);
		await page.keyboard.press('End');
		const end = await activeInfo(page);
		check(`End goes to "${LAST[locale]}"`, end.text === LAST[locale], end.text);
		await page.keyboard.press('Home');
		check('Home goes back to the first entry', (await activeInfo(page)).text === a.text);
		await page.keyboard.press('ArrowUp');
		check('ArrowUp from the first wraps to the last', (await activeInfo(page)).text === end.text);
		await page.keyboard.press('Home');
		await page.keyboard.press('Tab');
		const tabbed = await activeInfo(page);
		check(
			'Tab still moves entry to entry',
			tabbed.role === 'menuitem' && tabbed.inMenu && tabbed.text !== a.text,
			JSON.stringify(tabbed)
		);
		await page.keyboard.press('End');
		await page.keyboard.press('Tab');
		await page.waitForTimeout(200);
		check('Tab past the last entry closes the menu', (await menu(page).count()) === 0);

		// ---- an entry still goes where it says -------------------------------------------------
		await trigger(page).click();
		await menu(page).waitFor({ timeout: 5000 });
		await menu(page).locator('a[href="/submit"]').click();
		await page.waitForURL(/\/submit$/, { timeout: 15000 });
		check('"Submit exercise" opens /submit', new URL(page.url()).pathname === '/submit');
		check('…and the menu closed behind it', (await menu(page).count()) === 0);
		await ctx.close();

		// ---- the phone drawer ------------------------------------------------------------------
		console.log(`[${locale}] the drawer at 390`);
		const phone = await contextFor(locale, { token: USER, viewport: { width: 390, height: 844 } });
		await open(phone.page, '/', true, { phone: true });
		await openDrawer(phone.page);
		check(
			`the drawer has one "${L.add}" section`,
			(await drawerAdd(phone.page).count()) === 1 &&
				(await drawerAdd(phone.page).locator('> .drawer__heading').textContent())?.trim() === L.add
		);
		const dg = await groupsIn(drawerAdd(phone.page));
		check(
			'holding the same two groups, in order',
			JSON.stringify(dg.map((g) => g.key)) === JSON.stringify(ORDER),
			JSON.stringify(dg.map((g) => g.key))
		);
		check(
			'with the same headings and entries',
			dg.every(
				(g) => g.heading === L[g.key] && JSON.stringify(g.hrefs) === JSON.stringify(E[g.key])
			),
			JSON.stringify(dg)
		);
		check(
			'and no orphan menuitem roles anywhere in the drawer (it is not a menu)',
			(await phone.page.locator('#site-drawer [role="menuitem"]').count()) === 0
		);
		const overflow = await phone.page.evaluate(
			() => document.documentElement.scrollWidth - document.documentElement.clientWidth
		);
		check('no horizontal scroll at 390', overflow <= 0, String(overflow));
		if (SHOTS) {
			await drawerAdd(phone.page).scrollIntoViewIfNeeded();
			await phone.page.screenshot({ path: `${SHOTS}/add-drawer-390-${locale}.png` });
		}
		await phone.ctx.close();
	}

	// ---- dark mode: the headings are readable ------------------------------------------------------
	console.log('[dark] the open menu');
	{
		const { ctx, page } = await contextFor('en', {
			token: USER,
			viewport: { width: 1280, height: 900 },
			dark: true
		});
		await open(page, '/', true);
		await trigger(page).click();
		await menu(page).waitFor({ timeout: 5000 });
		const colours = await menu(page)
			.locator('.menu-group__heading')
			.first()
			.evaluate((e) => [
				getComputedStyle(e).color,
				getComputedStyle(e.closest('.popover__panel')).backgroundColor
			]);
		check('a heading is drawn in a different colour from its panel', colours[0] !== colours[1]);
		if (SHOTS) await page.screenshot({ path: `${SHOTS}/add-menu-1280-dark.png` });
		await ctx.close();
	}

	// ---- a fully killed group disappears, then the whole menu ----------------------------------------
	console.log('[killed] exercise submissions, material submissions and posts off: Content goes');
	for (const k of CONTENT_FLAGS) await setFlag(k, false);
	{
		const { ctx, page } = await contextFor('en', {
			token: USER,
			viewport: { width: 1280, height: 900 }
		});
		await open(page, '/', true);
		await trigger(page).click();
		await menu(page).waitFor({ timeout: 5000 });
		const groups = await groupsIn(menu(page));
		check(
			'the menu has one group, Content gone',
			JSON.stringify(groups.map((g) => g.key)) === JSON.stringify(['add-run']),
			JSON.stringify(groups.map((g) => g.key))
		);
		check(
			'and no "Content" heading anywhere in it',
			!(await menu(page).textContent()).includes('Content')
		);
		if (SHOTS) await page.screenshot({ path: `${SHOTS}/add-menu-1280-content-killed.png` });
		await page.keyboard.press('Escape');
		await page.setViewportSize({ width: 390, height: 844 });
		await page.waitForTimeout(400);
		await openDrawer(page);
		const dg = await groupsIn(drawerAdd(page));
		check(
			'the drawer lost the same group',
			JSON.stringify(dg.map((g) => g.key)) === JSON.stringify(['add-run']),
			JSON.stringify(dg.map((g) => g.key))
		);
		await ctx.close();
	}

	console.log('[killed] …and courses, events, tutoring and contests: the Add… menu itself goes');
	for (const k of RUN_FLAGS) await setFlag(k, false);
	{
		const { ctx, page } = await contextFor('en', {
			token: USER,
			viewport: { width: 1280, height: 900 }
		});
		await open(page, '/', true);
		check('no Add… trigger on the bar', (await trigger(page).count()) === 0);
		check(
			'while the account menu is still there',
			(await page.locator('.account-trigger').count()) === 1
		);
		await page.setViewportSize({ width: 390, height: 844 });
		await page.waitForTimeout(400);
		await openDrawer(page);
		check('no "Add…" section in the drawer', (await drawerAdd(page).count()) === 0);
		await ctx.close();
	}
} finally {
	for (const k of [...CONTENT_FLAGS, ...RUN_FLAGS]) {
		await setFlag(k, flagsBefore[k]).catch((e) => console.log(`could not restore ${k}: ${e}`));
	}
	await browser.close();
}

// The switches are back: confirm through the API, not by assuming the `finally` worked.
const after = await api('GET', '/feature-flags/', STAFF);
const afterMap = Object.fromEntries(
	(Array.isArray(after) ? after : after.results).map((f) => [f.key, f.is_enabled])
);
check(
	'every switch this script touched is back where it was',
	[...CONTENT_FLAGS, ...RUN_FLAGS].every((k) => afterMap[k] === flagsBefore[k])
);

check('no console or page errors', errors.length === 0, errors.slice(0, 5).join('\n'));
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
