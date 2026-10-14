// Mail for no-reply@edmat.net (backend `mail/`, 2026-10-14): forgotten password → reset link →
// new password works; settings → "not confirmed" → resend → confirmation link → "confirmed" → the
// digest switch; and the superuser's Mail tab in /moderation, which a plain account must not see.
//
// The dev backend runs with NO mailbox password, so every message goes to the console transport —
// the runserver's stdout. That is where this script reads the links from (`E2E_BACKEND_LOG`, the
// file `run.sh`'s output was redirected to): the database never holds a working link, by design,
// so there is nowhere else to get one. Nothing leaves the machine.
//
// Needs two accounts, created by hand on the dev database (never by this script — register is
// throttled, e2e/CLAUDE.md trap 1):
//   e2e-mailroot / Mailroot-pass-123  (superuser)     e2e-mailuser / Mailuser-pass-123
// The user's password is changed by the run and changed back at the end through the same flow.
// Before EVERY run, un-confirm the superuser (there is no API to do it, by design) and clear the
// throttle counters — the run spends three password-reset requests and five logins (trap 30):
//   cd backend && ../.venv/bin/python3 manage.py shell -c "from mail.models import ConfirmedEmail; \
//     ConfirmedEmail.objects.filter(user__username='e2e-mailroot').delete(); \
//     from django.core.cache import cache; cache.clear()"
//
// Run: CHROME=$(find ~/.cache/ms-playwright -name chrome -path '*chrome-linux*' -type f | head -1) \
//        E2E_BASE=http://localhost:5173 E2E_BACKEND_LOG=/path/to/run.log node e2e/mail.mjs
import { readFileSync } from 'node:fs';

let chromium;
try {
	({ chromium } = await import('playwright'));
} catch {
	({ chromium } = await import('playwright-core'));
}
const BASE = process.env.E2E_BASE ?? 'http://localhost:5173';
const SHOTS = process.env.E2E_SHOTS ?? '/tmp';
const LOG = process.env.E2E_BACKEND_LOG;
if (!LOG) throw new Error('E2E_BACKEND_LOG must name the file the backend prints to');
const ROOT = { user: 'e2e-mailroot', pass: 'Mailroot-pass-123' };
const USER = { user: 'e2e-mailuser', email: 'e2e-mailuser@example.com', pass: 'Mailuser-pass-123' };
const NEW_PASS = 'Changed-pass-456';

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
async function ctx() {
	const c = await browser.newContext({ viewport: { width: 1280, height: 1000 } });
	c.on('page', (pg) => {
		pg.on('pageerror', (e) => pageErrors.push(e.message));
		pg.on('console', (msg) => {
			if (msg.type() === 'error' && !/Failed to load resource/.test(msg.text()))
				pageErrors.push(msg.text());
		});
	});
	return c;
}
const settle = (p, ms = 1200) => p.waitForTimeout(ms);

/** goto, then wait for the root layout's own boot request — the sign that the bundle has hydrated
 *  and a click will reach a handler rather than submit the form natively (e2e/CLAUDE.md trap 25). */
async function go(p, url) {
	const booted = p
		.waitForResponse((r) => r.url().includes('/feature-flags/'), { timeout: 30000 })
		.catch(() => null);
	await p.goto(url, { waitUntil: 'load' });
	await booted;
	await settle(p, 400);
}

/** The newest link of one kind the console transport printed since `offset`. */
function linkFromLog(offset, path) {
	const text = readFileSync(LOG, 'utf8').slice(offset);
	const found = [...text.matchAll(new RegExp(`https?://\\S+/${path}\\?\\S+`, 'g'))];
	return found.length ? found[found.length - 1][0] : null;
}
const logSize = () => readFileSync(LOG, 'utf8').length;
async function waitForLink(offset, path) {
	for (let i = 0; i < 20; i++) {
		const link = linkFromLog(offset, path);
		if (link) return link;
		await new Promise((r) => setTimeout(r, 500));
	}
	return null;
}

async function login(p, who, password) {
	await go(p, `${BASE}/login`);
	await p.locator('form input[autocomplete="username"]').fill(who);
	await p.locator('form input[type="password"]').fill(password);
	await p.locator('form button.submit').click();
	await settle(p, 2000);
	return !p.url().includes('/login');
}

async function resetPassword(p, email, newPassword) {
	const offset = logSize();
	await go(p, `${BASE}/forgot-password`);
	await p.locator('form input[type="email"]').fill(email);
	await p.locator('form button.submit').click();
	await p.locator('p.ok').waitFor({ timeout: 10000 });
	const link = await waitForLink(offset, 'reset-password');
	if (!link) return { link: null };
	await go(p, link.replace(/^https?:\/\/[^/]+/, BASE));
	await p.locator('form input[autocomplete="new-password"]').first().waitFor({ timeout: 10000 });
	const inputs = p.locator('form input[autocomplete="new-password"]');
	await inputs.nth(0).fill(newPassword);
	await inputs.nth(1).fill(newPassword);
	await p.locator('form button.submit').click();
	await settle(p);
	return { link, done: await p.locator('p.ok').isVisible() };
}

// --- 1. forgotten password --------------------------------------------------------------------
console.log('forgotten password');
{
	const c = await ctx();
	const p = await c.newPage();
	await go(p, `${BASE}/login`);
	const forgot = p.locator('a.forgot');
	check(
		'the login page links to /forgot-password',
		(await forgot.getAttribute('href'))?.endsWith('/forgot-password')
	);

	// An unknown address gets the same page as a known one.
	await go(p, `${BASE}/forgot-password`);
	await p.locator('form input[type="email"]').fill('nobody-at-all@example.com');
	await p.locator('form button.submit').click();
	await p.locator('p.ok').waitFor({ timeout: 10000 });
	check(
		'an unknown address is answered with the neutral confirmation',
		await p.locator('p.ok').isVisible()
	);
	await p.screenshot({ path: `${SHOTS}/mail-forgot-done.png` });

	const { link, done } = await resetPassword(p, USER.email, NEW_PASS);
	check(
		'a reset link was printed by the console transport',
		!!link,
		'no /reset-password link in the backend log'
	);
	check('the reset page says the password changed', !!done);
	await p.screenshot({ path: `${SHOTS}/mail-reset-done.png` });

	// The same link a second time: used up.
	if (link) {
		await go(p, link.replace(/^https?:\/\/[^/]+/, BASE));
		const inputs = p.locator('form input[autocomplete="new-password"]');
		await inputs.nth(0).fill('Whatever-pass-789');
		await inputs.nth(1).fill('Whatever-pass-789');
		await p.locator('form button.submit').click();
		await settle(p);
		check(
			'a used link is refused with a way to ask again',
			await p.locator('a[href$="/forgot-password"]').isVisible()
		);
	}
	check('the old password no longer logs in', !(await login(p, USER.user, USER.pass)));
	check('the new password logs in', await login(p, USER.user, NEW_PASS));
	await c.close();
}

// --- 2. confirming the address, and the digest switch -----------------------------------------
console.log('settings → email');
{
	const c = await ctx();
	const p = await c.newPage();
	await login(p, USER.user, NEW_PASS);
	await go(p, `${BASE}/settings`);
	const section = p.locator('section.email-settings');
	await section.waitFor({ timeout: 15000 });
	await settle(p);
	// The reset above opened a link from this inbox, which confirms the address too.
	check(
		'a completed reset left the address confirmed',
		await section.locator('.pill.ok').isVisible()
	);
	const digest = section.locator('input[type="checkbox"]');
	await digest.check();
	await settle(p, 800);
	await go(p, p.url());
	await section.waitFor({ timeout: 15000 });
	await settle(p);
	check(
		'the digest switch survives a reload',
		await section.locator('input[type="checkbox"]').isChecked()
	);
	await section.locator('input[type="checkbox"]').uncheck();
	await settle(p, 800);
	await p.screenshot({ path: `${SHOTS}/mail-settings.png`, fullPage: false });

	// Somebody else's account: unconfirmed, resend, open the link.
	await c.close();
}
{
	// The superuser has never confirmed: drive the confirmation from that account.
	const c = await ctx();
	const p = await c.newPage();
	await login(p, ROOT.user, ROOT.pass);
	await go(p, `${BASE}/settings`);
	const section = p.locator('section.email-settings');
	await section.waitFor({ timeout: 15000 });
	await settle(p);
	const unconfirmed = await section.locator('.pill.warn').isVisible();
	check('an unconfirmed address says so', unconfirmed);
	if (unconfirmed) {
		const offset = logSize();
		await section.locator('button.secondary').click();
		await section.locator('.ok-text').waitFor({ timeout: 10000 });
		const link = await waitForLink(offset, 'confirm-email');
		check('"send the link again" printed a confirmation link', !!link);
		if (link) {
			await go(p, link.replace(/^https?:\/\/[^/]+/, BASE));
			await p.locator('p.ok, p.error').first().waitFor({ timeout: 10000 });
			check('the confirmation page says done', await p.locator('p.ok').isVisible());
			await p.screenshot({ path: `${SHOTS}/mail-confirmed.png` });
			await go(p, `${BASE}/settings`);
			await section.waitFor({ timeout: 15000 });
			await settle(p);
			check(
				'settings now shows the address confirmed',
				await section.locator('.pill.ok').isVisible()
			);
		}
	}
	await go(p, `${BASE}/confirm-email?token=tampered`);
	await p.locator('p.ok, p.error').first().waitFor({ timeout: 10000 });
	check('a tampered confirmation link is refused', await p.locator('p.error').isVisible());

	// --- 3. the Mail tab -------------------------------------------------------------------
	console.log('the Mail tab');
	await go(p, `${BASE}/moderation?tab=mail`);
	const panel = p.locator('.mail-panel');
	await panel.waitFor({ timeout: 15000 });
	await settle(p, 1500);
	check('the superuser sees the Mail tab', await p.locator('#mod-tab-mail').isVisible());
	check(
		'the status line admits nothing is being sent',
		await panel.locator('.status-line .pill.warn').isVisible()
	);
	const rows = panel.locator('ul.rows > li');
	check('the sent list has rows', (await rows.count()) > 0, `${await rows.count()} rows`);
	const reset = rows.filter({ hasText: /Reset hasła|Password reset/ }).first();
	await reset.locator('button.row').click();
	const body = reset.locator('pre.body');
	await body.waitFor({ timeout: 10000 });
	const text = (await body.textContent()) ?? '';
	check(
		'a logged reset body holds no working link',
		text.includes('[[link]]') && !text.includes('token='),
		text.slice(0, 200)
	);
	await p.screenshot({ path: `${SHOTS}/mail-tab-sent.png` });
	await panel.getByRole('button', { name: /Pobierz nową pocztę|Fetch new mail now/ }).click();
	await panel.locator('p.error').waitFor({ timeout: 15000 });
	check(
		'fetching without a password says why instead of failing quietly',
		/hasła do skrzynki|mailbox password/.test((await panel.locator('p.error').textContent()) ?? '')
	);
	await panel.getByRole('tab', { name: /Odebrane|Received/ }).click();
	await settle(p, 600);
	await p.screenshot({ path: `${SHOTS}/mail-tab-received.png` });
	await c.close();
}
{
	const c = await ctx();
	const p = await c.newPage();
	await login(p, USER.user, NEW_PASS);
	await go(p, `${BASE}/moderation?tab=mail`);
	await settle(p, 2500);
	check(
		'a plain account sees no Mail tab button',
		(await p.locator('#mod-tab-mail').count()) === 0
	);
	check('…and no mail panel even with ?tab=mail', (await p.locator('.mail-panel').count()) === 0);
	await c.close();
}

// --- put the password back, through the same flow ---------------------------------------------
{
	const c = await ctx();
	const p = await c.newPage();
	const { done } = await resetPassword(p, USER.email, USER.pass);
	check('(cleanup) the password is set back', !!done);
	await c.close();
}

check(
	'no page errors in the whole run',
	pageErrors.length === 0,
	pageErrors.slice(0, 3).join(' | ')
);
await browser.close();
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
