// The account menu, grouped, and Help one click away (WP8, 2026-10-14).
//
// What only a browser can show: that the four groups render in order under their headings, in
// BOTH interface languages; that a heading is a label and never a stop (Tab and the arrow keys
// walk only the `menuitem`s); that Esc and Tab-out close the menu; that a group whose every entry
// is switched off disappears WITH its heading (house rule 3) — asserted as a NON-staff account,
// because `can()` bypasses every flag for a moderator (e2e/CLAUDE.md trap 10); that the phone
// drawer draws the same groups; and that "Help & manual" resolves to the manual, signed in from
// the menu and signed out from the drawer (a visitor has no menu on a desktop).
//
// Run with both servers up:
//   E2E_BASE=http://localhost:5204 E2E_API=http://127.0.0.1:8054 \
//   E2E_TOKEN=<kasia's token> E2E_USER_TOKEN=<michal's token> E2E_SHOTS=/tmp/shots \
//   node e2e/account-menu.mjs
//
// The two tokens are optional — without them the script signs in with password123 — but five
// scripts signing in within the hour burn the login throttle (trap 30), so pass them when you can.
// It turns `flashcards` OFF for the killed-group check and puts it back on in a
// `finally`, through the same staff API the Flags tab uses. Run it against a COPY of the database.
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
const setFlag = (key, on) => api('PATCH', `/feature-flags/${key}/`, STAFF, { is_enabled: on });

const LABELS = {
	en: {
		learning: 'Learning',
		'taking-part': 'Taking part',
		together: 'Working together',
		account: 'Your account',
		help: 'Help & manual'
	},
	pl: {
		learning: 'Uczę się',
		'taking-part': 'Biorę udział',
		together: 'Współpracuję',
		account: 'Twoje konto',
		help: 'Pomoc i instrukcja'
	}
};
// What each group carries for an ordinary adult account with every switch on. `null` is a button
// (Report issue, Log out), which has no href.
const ENTRIES = {
	// "My contests" is under Taking part by the owner's call (2026-10-15), so Learning holds one entry.
	learning: ['/flashcards'],
	'taking-part': [
		'/contests?mine=1',
		'/bookings',
		'/events/agenda',
		'/volunteering/hours',
		'/volunteering/mine'
	],
	together: ['/material-projects?tab=mine', '/tasks', '/organizations', '/work'],
	account: [`/users/${me.id}`, '/settings', '/about/guide', null, null]
};
const ORDER = ['learning', 'taking-part', 'together', 'account'];

const browser = await chromium.launch(
	process.env.CHROME ? { executablePath: process.env.CHROME } : {}
);

async function contextFor(locale, { token = null, viewport, dark = false } = {}) {
	const opts = { viewport, ...(dark ? { colorScheme: 'dark' } : {}) };
	// Polish is the default (trap 24), so 'pl' is simply a fresh context — what a first visitor sees.
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

// Trap 25: wait for the root layout's boot request, registered BEFORE goto, not for an element.
async function open(page, path, signedIn) {
	const booted = page.waitForResponse((r) => r.url().includes('/feature-flags/'), {
		timeout: 90000
	});
	await page.goto(`${BASE}${path}`, { waitUntil: 'load' });
	await booted;
	if (signedIn) await page.locator('.account-trigger').waitFor({ timeout: 30000 });
	await page.waitForTimeout(600);
}

const menu = (page) => page.locator('.popover__panel[role="menu"]:has(.menu-group)');
// The Add… menu's groups (WP13) are `add-*` and share the drawer with these; `e2e/add-menu.mjs`
// is where they are asserted, so they are left out of every count here.
const groupsIn = (root) =>
	root.locator('[role="group"][data-group]:not([data-group^="add-"])').evaluateAll((els) =>
		els.map((e) => ({
			key: e.dataset.group,
			label: e.getAttribute('aria-label'),
			heading: e.querySelector('[aria-hidden="true"]')?.textContent?.trim(),
			headingTag: e.querySelector('[aria-hidden="true"]')?.tagName,
			headingFocusable: e.querySelector('[aria-hidden="true"]')?.tabIndex >= 0,
			headingRole: e.querySelector('[aria-hidden="true"]')?.getAttribute('role'),
			hrefs: Array.from(e.querySelectorAll('a, button')).map((a) =>
				a.tagName === 'A' ? new URL(a.href).pathname + new URL(a.href).search : null
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
			trigger: !!a?.classList.contains('popover__trigger')
		};
	});

async function openAccountMenu(page) {
	await page.locator('.account-trigger').click();
	await menu(page).waitFor({ timeout: 5000 });
}

try {
	for (const locale of ['en', 'pl']) {
		const L = LABELS[locale];
		console.log(`[${locale}] the account menu at 1280, as ${me.username}`);
		const { ctx, page } = await contextFor(locale, {
			token: USER,
			viewport: { width: 1280, height: 900 }
		});
		await open(page, '/', true);
		await openAccountMenu(page);
		const groups = await groupsIn(menu(page));
		check(
			'four groups, in order',
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
				`its heading is a plain, unfocusable label`,
				g.headingTag === 'SPAN' && !g.headingFocusable && g.headingRole === null,
				`${g.headingTag} ${g.headingFocusable} ${g.headingRole}`
			);
			check(
				`its entries are exactly the expected ones`,
				JSON.stringify(g.hrefs) === JSON.stringify(ENTRIES[g.key]),
				JSON.stringify(g.hrefs)
			);
			check(
				`every entry is a menuitem`,
				g.roles.every((r) => r === 'menuitem')
			);
		}
		const help = menu(page).locator('a.help-link');
		check(`Help reads "${L.help}"`, (await help.textContent())?.trim() === L.help);
		if (SHOTS) await page.screenshot({ path: `${SHOTS}/menu-1280-${locale}.png` });

		// ---- the keyboard ----------------------------------------------------------------------
		await page.keyboard.press('Escape');
		await page.waitForTimeout(200);
		let a = await activeInfo(page);
		check(
			'Esc closes it and focus returns to the trigger',
			a.trigger && (await menu(page).count()) === 0
		);
		await page.keyboard.press('ArrowDown');
		await menu(page).waitFor({ timeout: 5000 });
		await page.waitForTimeout(100);
		a = await activeInfo(page);
		check(
			'ArrowDown on the trigger opens it on the first entry',
			a.role === 'menuitem' && a.text === (locale === 'en' ? 'My decks' : 'Moje talie'),
			JSON.stringify(a)
		);
		const total = (await groupsIn(menu(page))).reduce((n, g) => n + g.hrefs.length, 0);
		const walked = [];
		for (let i = 0; i < total; i++) {
			await page.keyboard.press('ArrowDown');
			walked.push(await activeInfo(page));
		}
		check(
			`ArrowDown walks ${total} entries and wraps, never stopping on a heading`,
			walked.every((w) => w.role === 'menuitem') && walked[walked.length - 1].text === a.text,
			JSON.stringify(walked.map((w) => w.role))
		);
		await page.keyboard.press('End');
		const end = await activeInfo(page);
		check(
			'End goes to Log out',
			end.text === (locale === 'en' ? 'Log out' : 'Wyloguj się'),
			end.text
		);
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

		// ---- Help resolves ---------------------------------------------------------------------
		await openAccountMenu(page);
		await menu(page).locator('a.help-link').click();
		await page.waitForURL(/\/about\/guide$/, { timeout: 15000 });
		await page.locator('main h1').first().waitFor({ timeout: 15000 });
		check('Help opens /about/guide', new URL(page.url()).pathname === '/about/guide');
		check(
			'…which is the manual (a heading and its chapters)',
			(await page.locator('main a[href^="/about/guide/"]').count()) > 3
		);
		check('…and the menu closed behind it', (await menu(page).count()) === 0);
		await ctx.close();

		// ---- the phone drawer, signed in -------------------------------------------------------
		console.log(`[${locale}] the drawer at 390, signed in`);
		const phone = await contextFor(locale, { token: USER, viewport: { width: 390, height: 844 } });
		await open(phone.page, '/', false);
		await phone.page.locator('.drawer-toggle').click();
		await phone.page.locator('.drawer--open').waitFor({ timeout: 5000 });
		await phone.page.waitForTimeout(300);
		const dg = await groupsIn(phone.page.locator('#site-drawer'));
		check(
			'the drawer draws the same four groups, in order',
			JSON.stringify(dg.map((g) => g.key)) === JSON.stringify(ORDER),
			JSON.stringify(dg.map((g) => g.key))
		);
		check(
			'with the same entries',
			dg.every((g) => JSON.stringify(g.hrefs) === JSON.stringify(ENTRIES[g.key]))
		);
		check(
			'and no orphan menuitem roles (the drawer is not a menu)',
			dg.every((g) => g.roles.every((r) => r === null))
		);
		const overflow = await phone.page.evaluate(
			() => document.documentElement.scrollWidth - document.documentElement.clientWidth
		);
		check('no horizontal scroll at 390', overflow <= 0, String(overflow));
		if (SHOTS) {
			await phone.page.locator('#site-drawer [data-group="learning"]').scrollIntoViewIfNeeded();
			await phone.page.screenshot({ path: `${SHOTS}/drawer-390-${locale}.png` });
			await phone.page.locator('#site-drawer [data-group="account"]').scrollIntoViewIfNeeded();
			await phone.page.screenshot({ path: `${SHOTS}/drawer-390-account-${locale}.png` });
		}
		await phone.ctx.close();

		// ---- the drawer, signed out: the one menu a visitor has -------------------------------
		console.log(`[${locale}] the drawer at 390, signed out`);
		const guest = await contextFor(locale, { viewport: { width: 390, height: 844 } });
		await open(guest.page, '/', false);
		check(
			'a visitor has no menu on the bar (so Help goes in the drawer only)',
			(await guest.page.locator('.site-header .popover').count()) === 0
		);
		await guest.page.locator('.drawer-toggle').click();
		await guest.page.locator('.drawer--open').waitFor({ timeout: 5000 });
		await guest.page.waitForTimeout(400); // the slide-in, before anything is photographed
		const gHelp = guest.page.locator('#site-drawer a.help-link');
		check(`the drawer offers "${L.help}"`, (await gHelp.textContent())?.trim() === L.help);
		if (SHOTS) await guest.page.screenshot({ path: `${SHOTS}/drawer-390-guest-${locale}.png` });
		await gHelp.click();
		await guest.page.waitForURL(/\/about\/guide$/, { timeout: 15000 });
		check('…and it opens the manual', new URL(guest.page.url()).pathname === '/about/guide');
		check('…closing the drawer', (await guest.page.locator('.drawer--open').count()) === 0);
		await guest.ctx.close();
	}

	// ---- dark mode -------------------------------------------------------------------------------
	console.log('[dark] the open menu, and the drawer');
	{
		const { ctx, page } = await contextFor('en', {
			token: USER,
			viewport: { width: 1280, height: 900 },
			dark: true
		});
		await open(page, '/', true);
		check(
			'the page is dark',
			(await page.evaluate(() => document.documentElement.getAttribute('data-theme'))) === 'dark'
		);
		await openAccountMenu(page);
		const colours = await menu(page)
			.locator('.menu-group__heading')
			.first()
			.evaluate((e) => [
				getComputedStyle(e).color,
				getComputedStyle(e.closest('.popover__panel')).backgroundColor
			]);
		check(
			'a heading is drawn in a different colour from its panel',
			colours[0] !== colours[1],
			colours.join(' on ')
		);
		if (SHOTS) await page.screenshot({ path: `${SHOTS}/menu-1280-dark.png` });
		await page.setViewportSize({ width: 390, height: 844 });
		await page.keyboard.press('Escape');
		await page.waitForTimeout(400);
		await page.locator('.drawer-toggle').click();
		await page.locator('.drawer--open').waitFor({ timeout: 5000 });
		await page.waitForTimeout(300);
		if (SHOTS) await page.screenshot({ path: `${SHOTS}/drawer-390-dark.png` });
		await ctx.close();
	}

	// ---- a fully killed group disappears -------------------------------------------------------
	console.log('[killed] flashcards off: the Learning group goes, heading and all');
	await setFlag('flashcards', false);
	{
		const { ctx, page } = await contextFor('en', {
			token: USER,
			viewport: { width: 1280, height: 900 }
		});
		await open(page, '/', true);
		await openAccountMenu(page);
		const groups = await groupsIn(menu(page));
		check(
			'the menu has three groups, Learning gone',
			JSON.stringify(groups.map((g) => g.key)) ===
				JSON.stringify(['taking-part', 'together', 'account']),
			JSON.stringify(groups.map((g) => g.key))
		);
		check(
			'and no "Learning" heading anywhere in it',
			!(await menu(page).textContent()).includes('Learning')
		);
		if (SHOTS) await page.screenshot({ path: `${SHOTS}/menu-1280-learning-killed.png` });
		await page.keyboard.press('Escape');
		await page.setViewportSize({ width: 390, height: 844 });
		await page.waitForTimeout(400);
		await page.locator('.drawer-toggle').click();
		await page.locator('.drawer--open').waitFor({ timeout: 5000 });
		const dg = await groupsIn(page.locator('#site-drawer'));
		check(
			'the drawer lost the same group',
			JSON.stringify(dg.map((g) => g.key)) ===
				JSON.stringify(['taking-part', 'together', 'account']),
			JSON.stringify(dg.map((g) => g.key))
		);
		await ctx.close();
	}
	// The switch back on: the group returns with its entry.
	await setFlag('flashcards', true);
	{
		const { ctx, page } = await contextFor('en', {
			token: USER,
			viewport: { width: 1280, height: 900 }
		});
		await open(page, '/', true);
		await openAccountMenu(page);
		const learning = (await groupsIn(menu(page))).find((g) => g.key === 'learning');
		check(
			'the switch back on brings the group back with its entry',
			JSON.stringify(learning?.hrefs) === JSON.stringify(['/flashcards']),
			JSON.stringify(learning?.hrefs)
		);
		await ctx.close();
	}
} finally {
	await setFlag('flashcards', true);
	const flags = await api('GET', '/feature-flags/', STAFF);
	const back = flags.filter((f) => f.key === 'flashcards').every((f) => f.is_enabled);
	check('the switch is back on (re-queried)', back);
	await browser.close();
}

check('zero console/page errors', errors.length === 0, errors.join(' | '));
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
