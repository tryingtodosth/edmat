// The default licence for new content (`Profile.default_licence`, HISTORY §17CX, 2026-10-22):
// set it on `/settings/licences`, then see `/submit` start with it, say so, and still change with
// one click; naming a source moves the choice back to "EdMat only" (the source guard) and says the
// default was not applied; the hint composer on an exercise page starts with it too; clearing it
// gives every form its own suggestion back. Light and dark screenshots, looked at.
//
// It changes one throwaway account's profile only — no content is created.
//
//   E2E_BASE=http://localhost:5251 E2E_API=http://127.0.0.1:8151 node e2e/licence-default.mjs
import { mkdirSync } from 'node:fs';

let chromium;
try {
	({ chromium } = await import('playwright'));
} catch {
	({ chromium } = await import('playwright-core'));
}
import { englishContext } from './english.mjs';

const BASE = process.env.E2E_BASE ?? 'http://localhost:5173';
const API = process.env.E2E_API ?? 'http://localhost:8000';
const SHOTS = 'e2e/screenshots';
mkdirSync(SHOTS, { recursive: true });

let pass = 0,
	fail = 0;
const errors = [];
const check = (l, ok, x = '') => {
	if (ok) pass++;
	else fail++;
	console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${l} ${ok ? '' : x}`);
};
const api = async (method, path, body, token) => {
	const r = await fetch(`${API}${path}`, {
		method,
		headers: {
			'Content-Type': 'application/json',
			...(token ? { Authorization: `Token ${token}` } : {})
		},
		body: body ? JSON.stringify(body) : undefined
	});
	return { status: r.status, body: await r.json().catch(() => null) };
};

const stamp = Date.now() % 1000000;
const reg = await api('POST', '/api/auth/register/', {
	username: `e2e-deflic-${stamp}`,
	email: `e2e-deflic-${stamp}@example.org`,
	password: 'licence-e2e-Passw0rd!',
	display_name: `Default Licence ${stamp}`,
	preferred_locale: 'en',
	birth_year: 1990,
	accept_terms: true
});
if (reg.status !== 201) throw new Error(`register: ${reg.status} ${JSON.stringify(reg.body)}`);
const token = reg.body.token;
check('API: a new account has no default', reg.body.profile.default_licence === '');

const browser = await chromium.launch(
	process.env.CHROME ? { executablePath: process.env.CHROME } : {}
);
const page = async ({ colorScheme = 'light' } = {}) => {
	const ctx = await englishContext(browser, BASE, {
		viewport: { width: 1280, height: 1000 },
		colorScheme
	});
	await ctx.addInitScript(
		([t, theme]) => {
			localStorage.setItem('edmat-auth-token', t);
			localStorage.setItem('edmat-theme', theme);
		},
		[token, colorScheme]
	);
	const p = await ctx.newPage();
	p.on('console', (m) => {
		if (m.type() === 'error') errors.push(`[${p.url()}] ${m.text()}`);
	});
	p.on('pageerror', (e) => errors.push(e.message));
	return p;
};
const picked = (p, scope = 'body') =>
	p
		.locator(`${scope} [data-testid="licence-picker"] input[type="radio"]:checked`)
		.getAttribute('value');

// ---- 1. /submit without a default: the form's own suggestion -------------------------------------
let p = await page();
await p.goto(`${BASE}/submit`, { waitUntil: 'load' });
await p.locator('[data-testid="licence-picker"]').waitFor({ timeout: 60000 });
await p.waitForTimeout(800);
check('no default: /submit suggests CC BY for own work', (await picked(p)) === 'cc-by-4.0');
check(
	'no default: no "starts with your default" line',
	(await p.locator('[data-testid="licence-from-default"]').count()) === 0
);

// ---- 2. set a default on /settings/licences -------------------------------------------------------
await p.goto(`${BASE}/settings/licences`, { waitUntil: 'load' });
const form = p.locator('[data-testid="default-licence-form"]');
await form.waitFor({ timeout: 30000 });
check(
	'the form starts on "No default"',
	(await form.locator('input[value=""]').isChecked()) &&
		(await form.locator('[data-testid="default-licence-save"]').isDisabled())
);
check(
	'each choice carries its explanation',
	(await form.innerText()).includes('share their changes under the same licence')
);
await form.locator('[data-testid="default-licence-cc-by-sa-4.0"]').check();
await form.locator('[data-testid="default-licence-save"]').click();
await form.locator('[data-testid="default-licence-saved"]').waitFor({ timeout: 15000 });
check('saved, and says so', true);
const me = await api('GET', '/api/auth/me/', null, token);
check(
	'API: the default round-trips',
	me.body?.default_licence === 'cc-by-sa-4.0',
	JSON.stringify(me.body?.default_licence)
);
await p.screenshot({ path: `${SHOTS}/licence-default-settings-light.png`, fullPage: false });
await form.screenshot({ path: `${SHOTS}/licence-default-form-light.png` });

// ---- 3. /submit starts with it, says so, and changes with one click ------------------------------
await p.goto(`${BASE}/submit`, { waitUntil: 'load' });
await p.locator('[data-testid="licence-picker"]').waitFor({ timeout: 30000 });
await p.waitForTimeout(800);
check('/submit is prefilled with the default', (await picked(p)) === 'cc-by-sa-4.0');
const line = p.locator('[data-testid="licence-from-default"]');
check(
	'/submit says it started from the default',
	(await line.count()) === 1 && (await line.innerText()).includes('CC BY-SA 4.0')
);
check(
	'the default option carries a "Your default" tag',
	(await p.locator('[data-testid="licence-your-default"]').count()) === 1
);
await p.locator('[data-testid="licence-picker"]').scrollIntoViewIfNeeded();
await p
	.locator('[data-testid="licence-picker"]')
	.screenshot({ path: `${SHOTS}/licence-default-submit-light.png` });
await p.locator('[data-testid="licence-picker"] input[value="cc0-1.0"]').check();
check('one click changes it for this item', (await picked(p)) === 'cc0-1.0');
await p.reload({ waitUntil: 'load' });
await p.locator('[data-testid="licence-picker"]').waitFor({ timeout: 30000 });
await p.waitForTimeout(800);
check('a fresh form starts with the default again', (await picked(p)) === 'cc-by-sa-4.0');

// ---- 4. the source guard --------------------------------------------------------------------------
const sourceInput = p.locator('label.field:has-text("Source") input[type="text"]').first();
await sourceInput.fill('Halliday, Podstawy fizyki');
await p.waitForTimeout(300);
check('naming a source moves the choice to EdMat only', (await picked(p)) === 'edmat-only');
const notApplied = p.locator('[data-testid="licence-default-not-applied"]');
check(
	'and says the default is not applied here',
	(await notApplied.count()) === 1 && (await notApplied.innerText()).includes('CC BY-SA 4.0')
);
await p
	.locator('[data-testid="licence-picker"]')
	.screenshot({ path: `${SHOTS}/licence-default-source-light.png` });
await sourceInput.fill('');
await p.waitForTimeout(300);
check('clearing the source brings the default back', (await picked(p)) === 'cc-by-sa-4.0');
await p.close();

// ---- 5. the hint composer on an exercise page ------------------------------------------------------
const list = await api('GET', '/api/exercises/?content_locales=pl', null, token);
const exId = (Array.isArray(list.body) ? list.body : (list.body?.results ?? []))[0]?.id;
p = await page({ colorScheme: 'dark' });
await p.goto(`${BASE}/exercises/${exId}`, { waitUntil: 'load' });
const addHint = p.getByRole('button', { name: 'Add a hint', exact: true }).first();
await addHint.waitFor({ timeout: 60000 });
await addHint.click();
const composerPicker = p.locator('[data-testid="licence-picker"]').first();
await composerPicker.waitFor({ timeout: 15000 });
await p.waitForTimeout(500);
check(
	'the hint composer starts with the default',
	(await composerPicker.locator('input[type="radio"]:checked').getAttribute('value')) ===
		'cc-by-sa-4.0'
);
check(
	'its folded summary names it',
	(await composerPicker.locator('summary').innerText()).includes('CC BY-SA 4.0')
);
await composerPicker.locator('summary').click();
await composerPicker.screenshot({ path: `${SHOTS}/licence-default-composer-dark.png` });
await p.goto(`${BASE}/settings/licences`, { waitUntil: 'load' });
await p.locator('[data-testid="default-licence-form"]').waitFor({ timeout: 30000 });
await p
	.locator('[data-testid="default-licence-form"]')
	.screenshot({ path: `${SHOTS}/licence-default-form-dark.png` });

// ---- 6. clearing it, and refusals --------------------------------------------------------------------
const form2 = p.locator('[data-testid="default-licence-form"]');
await form2.locator('input[value=""]').check();
await form2.locator('[data-testid="default-licence-save"]').click();
await form2.locator('[data-testid="default-licence-saved"]').waitFor({ timeout: 15000 });
check(
	'API: cleared',
	(await api('GET', '/api/auth/me/', null, token)).body?.default_licence === ''
);
await p.goto(`${BASE}/submit`, { waitUntil: 'load' });
await p.locator('[data-testid="licence-picker"]').waitFor({ timeout: 30000 });
await p.waitForTimeout(800);
check('cleared: /submit is back to its own suggestion', (await picked(p)) === 'cc-by-4.0');
await p.close();
const refused = await api('PATCH', '/api/auth/me/', { default_licence: 'unknown' }, token);
check(
	'API: unknown is refused',
	refused.status === 400 && String(refused.body?.default_licence) === 'licence_not_selectable',
	JSON.stringify(refused.body)
);
check('API: anonymous gets nothing', (await api('GET', '/api/auth/me/')).status === 401);

await browser.close();
const real = errors.filter(
	(e) => !/Failed to load resource: the server responded with a status of (401|403)/.test(e)
);
check('no console or page errors', real.length === 0, real.join('\n'));
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
