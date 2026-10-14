// Sign in with Google / Apple / Microsoft (backend `sso/`, 2026-10-14), driven end to end against
// the local provider stub (`e2e/sso-stub.mjs`): the buttons on /login and /register, a first
// sign-in that finishes on /auth/sso/complete (terms, the age question, a username), a second
// sign-in that is a plain login, Settings → Sign-in methods (the "last way in" refusal, linking a
// second provider, unlinking), Apple's form_post landing on email_in_use, and a cancel.
//
// Needs, all on THROWAWAY data (the script creates accounts and never deletes them — point the
// backend at a copy of the database, as `test.md` describes):
//   node e2e/sso-stub.mjs                                   # the stub, :8049
//   backend with DEBUG on and EDMAT_SSO_DEV_STUB_URL=http://localhost:8049, EDMAT_SITE_URL=<E2E_BASE>,
//     EDMAT_SSO_GOOGLE_CLIENT_ID/_CLIENT_SECRET, EDMAT_SSO_MICROSOFT_CLIENT_ID/_CLIENT_SECRET,
//     EDMAT_SSO_APPLE_CLIENT_ID/_TEAM_ID/_KEY_ID/_PRIVATE_KEY_PATH (any EC P-256 key file)
//
// Run: CHROME=… E2E_BASE=http://localhost:5192 E2E_SHOTS=/tmp/shots node e2e/sso.mjs
import { englishContext } from './english.mjs';

let chromium;
try {
	({ chromium } = await import('playwright'));
} catch {
	({ chromium } = await import('playwright-core'));
}
const BASE = process.env.E2E_BASE ?? 'http://localhost:5192';
const SHOTS = process.env.E2E_SHOTS ?? '/tmp';
const RUN = Date.now().toString(36);
const PERSON = { email: `sso-${RUN}@example.com`, sub: `sub-${RUN}`, username: `sso_${RUN}` };

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
const ctx = await englishContext(browser, BASE, { viewport: { width: 1100, height: 1000 } });
const page = await ctx.newPage();
page.on('pageerror', (e) => pageErrors.push(e.message));
page.on('console', (msg) => {
	if (msg.type() === 'error' && !/Failed to load resource/.test(msg.text()))
		pageErrors.push(msg.text());
});
page.on('dialog', (d) => d.accept());

async function bootAt(path) {
	const flags = page.waitForResponse((r) => r.url().includes('/feature-flags/'));
	await page.goto(BASE + path, { waitUntil: 'load' });
	await flags.catch(() => {});
}

/** Clicks a provider button and answers the stub's page as `who`. */
async function viaStub(buttonName, who, { cancel = false } = {}) {
	await page.getByRole('button', { name: buttonName, exact: true }).click();
	await page.waitForURL(/localhost:8049\/\w+\/authorize/);
	await page.fill('input[name=email]', who.email);
	await page.fill('input[name=sub]', who.sub);
	await page.fill('input[name=name]', who.name ?? 'Ala Kowalska');
	await page.click(cancel ? '#cancel' : '#approve');
}

const token = () => page.evaluate(() => localStorage.getItem('edmat-auth-token'));

// ---- 1. the buttons ---------------------------------------------------------------------------
console.log('buttons on /login and /register');
await bootAt('/login');
await page.getByRole('button', { name: 'Continue with Google', exact: true }).first().waitFor();
for (const name of [
	'Continue with Google',
	'Sign in with Apple',
	'Sign in with GitHub',
	'Continue with Facebook',
	'Sign in with Microsoft'
]) {
	const n = await page.getByRole('button', { name, exact: true }).count();
	check(`/login has exactly one "${name}"`, n === 1, `${n}`);
}
await page.screenshot({ path: `${SHOTS}/sso-login.png`, fullPage: true });
await bootAt('/register');
await page.getByRole('button', { name: 'Sign in with Microsoft', exact: true }).waitFor();
check('/register has the five buttons', (await page.locator('.sso .btn').count()) === 5);
await page.screenshot({ path: `${SHOTS}/sso-register.png`, fullPage: true });

// ---- 2. first sign-in → complete the account ----------------------------------------------------
console.log('first sign-in with Google → complete');
await bootAt('/login?next=/settings');
await viaStub('Continue with Google', PERSON);
await page.waitForURL(/\/auth\/sso\/complete\?ticket=/);
await page.getByTestId('sso-email').waitFor();
check(
	'complete page shows the provider email',
	(await page.getByTestId('sso-email').innerText()) === PERSON.email
);
check(
	'the display name is suggested',
	(await page.inputValue('input[name=display_name]')) === 'Ala Kowalska'
);
await page.screenshot({ path: `${SHOTS}/sso-complete.png`, fullPage: true });

await page.fill('input[name=username]', PERSON.username);
await page.fill('input[name=birth_year]', String(new Date().getFullYear() - 12));
await page.getByRole('button', { name: 'Create account' }).click();
await page.locator('.error.guardian').waitFor();
check(
	'under 16 gets the guardian refusal',
	(await page.locator('.error.guardian').innerText()).includes('guardian')
);
check(
	'the terms refusal is shown too',
	(await page.getByText('Accept the terms of use to create an account.').count()) === 1
);
await page.screenshot({ path: `${SHOTS}/sso-complete-refused.png`, fullPage: true });

await page.fill('input[name=birth_year]', '1990');
await page.check('input[name=accept_terms]');
await page.getByRole('button', { name: 'Create account' }).click();
await page.waitForURL((u) => u.pathname === '/settings', { timeout: 20000 });
check('lands on the `next` it was started with (/settings)', true);
check('signed in (a token is stored)', !!(await token()));
const firstToken = await token();

// ---- 3. Settings: the last way in cannot go -----------------------------------------------------
console.log('Settings → Sign-in methods');
const section = page.getByTestId('sign-in-methods');
await section.waitFor();
check(
	'Google is listed',
	(await section.locator('[data-testid=sso-identity][data-provider=google]').count()) === 1
);
check('password says not set', (await section.innerText()).includes('Not set'));
await section.locator('[data-provider=google] button').click();
await page.getByTestId('sso-unlink-error').waitFor();
check(
	'unlinking the only way in is refused with the reason',
	(await page.getByTestId('sso-unlink-error').innerText()).includes('Set a password first')
);
await page.screenshot({ path: `${SHOTS}/sso-settings-refused.png`, fullPage: true });

// ---- 4. link Microsoft, then unlink Google ----------------------------------------------------------
console.log('link Microsoft, unlink Google');
await viaStub('Link a Microsoft account', { email: `ms-${RUN}@uw.example`, sub: `ms-${RUN}` });
await page.waitForURL(/\/auth\/sso\/done/);
await page.getByTestId('sso-linked').waitFor();
check(
	'done page says linked',
	(await page.getByTestId('sso-linked').innerText()).includes('Microsoft')
);
check('the code is gone from the address', !page.url().includes('code='));
await bootAt('/settings');
await section.locator('[data-provider=microsoft]').waitFor();
check('two identities listed', (await section.locator('[data-testid=sso-identity]').count()) === 2);
await page.screenshot({ path: `${SHOTS}/sso-settings-two.png`, fullPage: true });
await section.locator('[data-provider=google] button').click();
await page.getByText('Google unlinked.').waitFor();
check(
	'Google unlinked once Microsoft is a way in',
	(await section.locator('[data-testid=sso-identity]').count()) === 1
);
await page.screenshot({ path: `${SHOTS}/sso-settings.png`, fullPage: true });

// ---- 4b. Settings → Password: set a first password, then the last provider may go ---------------
console.log('set a first password');
const pw = page.getByTestId('password-settings');
check('password section says there is none', (await pw.innerText()).includes('has no password'));
await pw.getByRole('button', { name: 'Set a password' }).click();
check(
	'no current-password field for an account without one',
	(await pw.locator('input[name=current_password]').count()) === 0
);
await pw.locator('input[name=new_password]').fill('Sso-first-Passw0rd!');
await pw.locator('input[name=repeat_password]').fill('Sso-first-Passw0rd!x');
await pw.getByRole('button', { name: 'Set a password' }).click();
check(
	'a mismatch is said',
	(await pw.getByText('The two new passwords are not the same.').count()) === 1
);
await pw.locator('input[name=repeat_password]').fill('Sso-first-Passw0rd!');
await pw.getByRole('button', { name: 'Set a password' }).click();
await page.getByTestId('password-done').waitFor();
check('password set', (await page.getByTestId('password-done').innerText()).includes('set'));
await page.waitForFunction(() => document.querySelector('[data-testid=sign-in-methods] .pill.ok'));
check('Sign-in methods now says Set', (await section.locator('.pill.ok').count()) === 1);
await page.screenshot({ path: `${SHOTS}/sso-password-set.png`, fullPage: true });
await pw.getByRole('button', { name: 'Change password' }).click();
await pw.locator('input[name=current_password]').fill('not-it');
await pw.locator('input[name=new_password]').fill('Sso-second-Passw0rd!');
await pw.locator('input[name=repeat_password]').fill('Sso-second-Passw0rd!');
await pw.getByRole('button', { name: 'Change password' }).click();
await pw.getByText('That is not your current password.').waitFor();
check('a wrong current password is refused with its reason', true);
await pw.getByRole('button', { name: 'Cancel' }).click();

// ---- 5. sign out, sign in again with Microsoft = a login, same account -------------------------------
console.log('second sign-in is a login');
await page.evaluate(() => localStorage.removeItem('edmat-auth-token'));
await bootAt('/login');
await viaStub('Sign in with Microsoft', { email: `ms-${RUN}@uw.example`, sub: `ms-${RUN}` });
await page.waitForURL((u) => !u.pathname.startsWith('/auth/sso') && !u.hostname.includes('8049'), {
	timeout: 20000
});
check('signed in again with the same token', (await token()) === firstToken);

// ---- 6. Apple (form_post) with an email an account already has → email_in_use ------------------------
console.log('Apple form_post → email_in_use');
await page.evaluate(() => localStorage.removeItem('edmat-auth-token'));
await bootAt('/login');
await viaStub('Sign in with Apple', { email: PERSON.email, sub: `apple-${RUN}` });
await page.getByTestId('sso-error').waitFor();
check(
	'refused as email_in_use',
	(await page.getByTestId('sso-error').getAttribute('data-code')) === 'email_in_use'
);
check(
	'says how to link instead',
	(await page.getByTestId('sso-error').innerText()).includes('Settings')
);
check(
	'offers the password reset',
	(await page.getByRole('link', { name: 'Forgotten your password?' }).count()) === 1
);
check('not signed in', !(await token()));
await page.screenshot({ path: `${SHOTS}/sso-email-in-use.png`, fullPage: true });

// ---- 7. cancel at the provider ------------------------------------------------------------------------
console.log('cancel');
await bootAt('/login');
await viaStub('Continue with Google', { email: 'x@example.com', sub: 'x' }, { cancel: true });
await page.getByTestId('sso-error').waitFor();
check(
	'cancel is said as cancel',
	(await page.getByTestId('sso-error').getAttribute('data-code')) === 'cancelled'
);

// ---- 7b. GitHub and Facebook: a first sign-in reaches the complete page --------------------------
console.log('GitHub and Facebook');
await bootAt('/login');
await viaStub('Sign in with GitHub', { email: `gh-${RUN}@example.com`, sub: `gh-${RUN}` });
await page.waitForURL(/\/auth\/sso\/complete\?ticket=/);
await page.getByTestId('sso-email').waitFor();
check(
	'GitHub: the primary verified address',
	(await page.getByTestId('sso-email').innerText()) === `gh-${RUN}@example.com`
);
check(
	'GitHub: it counts as confirmed',
	(await page.getByText('Confirmed by GitHub.').count()) === 1
);
await bootAt('/login');
await viaStub('Continue with Facebook', { email: `fb-${RUN}@example.com`, sub: `fb-${RUN}` });
await page.waitForURL(/\/auth\/sso\/complete\?ticket=/);
await page.getByTestId('sso-email').waitFor();
check(
	'Facebook: the address',
	(await page.getByTestId('sso-email').innerText()) === `fb-${RUN}@example.com`
);
check(
	'Facebook: treated as unconfirmed',
	(await page.getByText('Facebook did not confirm this address', { exact: false }).count()) === 1
);
await page.screenshot({ path: `${SHOTS}/sso-complete-facebook.png`, fullPage: true });
await page.fill('input[name=username]', `fb_${RUN}`);
await page.fill('input[name=birth_year]', '1995');
await page.check('input[name=accept_terms]');
await page.getByRole('button', { name: 'Create account' }).click();
await page.waitForURL((u) => !u.pathname.startsWith('/auth/sso'), { timeout: 20000 });
check('Facebook: account created and signed in', !!(await token()));
await page.evaluate(() => localStorage.removeItem('edmat-auth-token'));

// ---- 8. a forwarded callback is dead in another tab -----------------------------------------------------
console.log('a forwarded code does not work in another browser');
await bootAt('/login');
await page.getByRole('button', { name: 'Sign in with Microsoft', exact: true }).click();
await page.waitForURL(/authorize/);
await page.fill('input[name=email]', `ms-${RUN}@uw.example`);
await page.fill('input[name=sub]', `ms-${RUN}`);
// Catch the backend's redirect to the done page before this tab follows it.
const isDone = (u) => String(u).includes('/auth/sso/done?code=');
await page.route(isDone, (route) => route.abort());
const doneRequest = page.waitForRequest((r) => isDone(r.url()), { timeout: 30000 });
await page.click('#approve');
const forwarded = (await doneRequest.catch(() => null))?.url() ?? '';
await page.unroute(isDone);
check('captured the done link', forwarded.includes('code='), forwarded);
const other = await englishContext(browser, BASE, { viewport: { width: 1100, height: 900 } });
const victim = await other.newPage();
await victim.goto(forwarded, { waitUntil: 'load' });
await victim.getByTestId('sso-error').waitFor();
check(
	'the other browser gets code_invalid',
	(await victim.getByTestId('sso-error').getAttribute('data-code')) === 'code_invalid'
);
check(
	'and is not signed in',
	!(await victim.evaluate(() => localStorage.getItem('edmat-auth-token')))
);
await other.close();

const errs = pageErrors.filter((e) => !/katex|fonts/i.test(e));
check('no page/console errors', errs.length === 0, errs.slice(0, 3).join(' | '));
await browser.close();
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
