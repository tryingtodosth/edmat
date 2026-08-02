// End-to-end check of the sign-in drafts and the education/USOS ground, against real servers.
//
// Run it with both running (see the header of backend/identity/usos.py for what the mock is for):
//   backend:  EDMAT_USOS_MOCK=true DJANGO_CORS_ALLOWED_ORIGINS=http://localhost:5183 \
//             manage.py runserver 127.0.0.1:8011
//   frontend: PUBLIC_API_BASE_URL=http://127.0.0.1:8011/api npx vite dev --port 5183
//   node e2e/education-auth.mjs
//
// Playwright is deliberately NOT a dependency of this repo — it is needed for this one script and
// nothing else, so it stays a `npx playwright install chromium` away rather than in package.json.
//
// The Django suite (backend/identity/tests.py) already pins the rules. What only a browser can
// confirm is the half this feature was actually asked for: that clicking a provider button opens a
// modal describing that connection's real state and linking to the repository — and that it does
// not sign anybody in.
import { chromium } from 'playwright';

const BASE = process.env.E2E_BASE ?? 'http://localhost:5183';
let pass = 0;
let fail = 0;
const errors = [];
const check = (label, ok, extra = '') => {
	if (ok) {
		pass++;
		console.log(`  ok   ${label}`);
	} else {
		fail++;
		console.log(`  FAIL ${label} ${extra}`);
	}
};

const browser = await chromium.launch();
const page = await browser.newPage();
page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
page.on('console', (m) => {
	if (m.type() === 'error') errors.push(`console: ${m.text()}`);
});
const settle = (ms = 700) => page.waitForTimeout(ms);

async function goto(path) {
	await page.goto(`${BASE}${path}`, { waitUntil: 'networkidle' });
	await settle(900);
}

console.log('\n[1] The login page offers all four sign-in drafts');
await goto('/login');
const buttons = await page.locator('.provider').allInnerTexts();
check('school is offered', buttons.some((t) => /University account/i.test(t)), buttons.join(' | '));
check('Google is offered', buttons.some((t) => /Google/.test(t)));
check('Apple is offered', buttons.some((t) => /Apple/.test(t)));
check('GitHub is offered', buttons.some((t) => /GitHub/.test(t)));
check('each is labelled a draft on the button itself', (await page.locator('.badge').count()) >= 4);
check(
	'the real email+password form is still there, and first',
	(await page.locator('form input[type="password"]').count()) === 1
);

console.log('\n[2] Clicking one opens a modal describing that connection');
await page.locator('.provider', { hasText: 'Apple' }).click();
await settle();
check('a modal opened', (await page.locator('.modal-panel').count()) === 1);
let modal = await page.locator('.modal-panel').innerText();
check('it says plainly that nothing is connected', /draft/i.test(modal), modal.slice(0, 160));
check("Apple's form_post quirk is described", /POST/.test(modal));
check('the name-sent-once trap is described', /once/i.test(modal));
check('what is missing is listed', /client id/i.test(modal));
check('the callback checks are listed', /state/i.test(modal) && /nonce/i.test(modal));
const repoHref = await page.locator('.modal-panel a.repo').getAttribute('href');
check('it links to the GitHub repository', /github\.com/.test(repoHref ?? ''), String(repoHref));

console.log('\n[3] The modal is per-provider, not one generic notice');
await page.keyboard.press('Escape');
await settle(400);
check('Escape closes it', (await page.locator('.modal-panel').count()) === 0);
await page.locator('.provider', { hasText: 'GitHub' }).click();
await settle();
modal = await page.locator('.modal-panel').innerText();
check("GitHub's second email call is described", /\/user\/emails/.test(modal));
check(
	'and its account-takeover warning is present, which the OIDC ones do not carry',
	/unverified email/i.test(modal)
);

console.log('\n[4] The school draft asks which institution, because USOS is per-university');
await page.keyboard.press('Escape');
await settle(400);
await page.locator('.provider', { hasText: 'University account' }).click();
await settle();
check('a school picker is offered', (await page.locator('.modal-panel select').count()) === 1);
await page.locator('.modal-panel select').selectOption('uw');
await settle(400);
modal = await page.locator('.modal-panel').innerText();
check('a university that runs USOS says so', /runs a USOS/i.test(modal), modal.slice(0, 400));
await page.locator('.modal-panel select').selectOption('asp-warszawa');
await settle(400);
modal = await page.locator('.modal-panel').innerText();
check('one that does not is honest about it', /no USOS/i.test(modal), modal.slice(0, 400));

console.log('\n[5] No draft ever signs anybody in');
await page.keyboard.press('Escape');
await settle(400);
const tokenAfter = await page.evaluate(() => window.localStorage.getItem('edmat-auth-token'));
check('no session was created by any of that', !tokenAfter, String(tokenAfter));

console.log('\n[6] A real account, and the education panel');
// A fresh account per run rather than a demo one, so the script is repeatable: the whole point of
// what follows is a sequence of state changes, and re-running it against an account that already
// connected USOS would test nothing.
const email = `e2e-${Date.now()}@example.com`;
await goto('/register');
await page.locator('form input[type="text"]').first().fill('E2E Student');
await page.locator('form input[type="email"]').fill(email);
await page.locator('form input[type="password"]').fill('Kw9-vortexline-42');
await page.locator('form button[type="submit"]').click();
await settle(2200);
await goto('/settings');
check('the education panel renders', (await page.locator('.education').count()) === 1);
await page.locator('.education select').first().selectOption('uw');
await settle(300);
await page.locator('.education .row button').click();
await settle(1200);
let panel = await page.locator('.education').innerText();
check('declaring a school is recorded', /Self-declared/.test(panel), panel.slice(0, 400));
check('and is worth exactly one step', /Tier D/.test(panel), panel.slice(-600));

console.log('\n[7] USOS connects, and grades are a separate authorization');
await page.locator('.education button', { hasText: 'Connect USOS' }).first().click();
await settle(1800);
panel = await page.locator('.education').innerText();
check('verification became USOS', /Verified by USOS/.test(panel), panel.slice(0, 400));
check('the registry answered with a student number', /Student number/.test(panel));
check('the ceiling rose to S', /Tier S/.test(panel), panel.slice(-800));
check('the stand-in connector declares itself', /verifies nobody/i.test(panel));
check(
	'transferring grades is refused without its own scope',
	await page.locator('.education button:disabled', { hasText: 'Transfer my grades' }).count()
);

console.log('\n[8] Reconnecting with grades allowed, then transferring');
await page.locator('.education button', { hasText: 'Disconnect' }).click();
await settle(1200);
await page.locator('.education button', { hasText: 'Connect, and allow grades' }).click();
await settle(1600);
await page.locator('.education button', { hasText: 'Transfer my diploma' }).click();
await settle(1400);
await page.locator('.education button', { hasText: 'Transfer my grades' }).click();
await settle(1600);
panel = await page.locator('.education').innerText();
check('a diploma came across', /Diplomas/i.test(panel), panel.slice(0, 600));
check('a transcript came across', /Course results:/i.test(panel));
check('a weighted average is computed', /Weighted average:/.test(panel));

console.log('\n[9] Transferring is not publishing');
const userId = await page.evaluate(async () => {
	const res = await fetch('http://127.0.0.1:8011/api/auth/me/', {
		headers: { Authorization: `Token ${localStorage.getItem('edmat-auth-token')}` }
	});
	return (await res.json()).id;
});
await goto(`/users/${userId}`);
let profile = await page.locator('main').innerText();
check('the profile shows no education section at all', !/Education/i.test(profile), profile.slice(0, 300));
check('and certainly no marks', !/Analiza/.test(profile));

console.log('\n[10] Consent publishes it, one field at a time');
await goto('/settings');
const consents = page.locator('.education .check input');
await consents.nth(0).check();
await settle(1200);
await goto(`/users/${userId}`);
profile = await page.locator('main').innerText();
check('the institution is now public', /Uniwersytet Warszawski/.test(profile), profile.slice(0, 400));
check('the diploma is still private', !/Licencjat/.test(profile));
check('the marks are still private', !/Analiza/.test(profile));

await goto('/settings');
await page.locator('.education .check input').nth(1).check();
await settle(1000);
await page.locator('.education .check input').nth(2).check();
await settle(1200);
await goto(`/users/${userId}`);
profile = await page.locator('main').innerText();
check('the diploma is public once allowed', /Licencjat/.test(profile), profile.slice(0, 600));
check('the transcript is public once allowed', /Analiza/.test(profile));

console.log('\n[11] Publishing changes nothing about what you may do');
await goto('/settings');
panel = await page.locator('.education').innerText();
check('the ceiling is still S, not raised by publishing', /Tier S/.test(panel), panel.slice(-500));
check('and it says it grants no authority', /never authority/i.test(panel));

console.log('\n[12] Removing a transcript removes it everywhere');
await page.locator('.education button', { hasText: 'Remove imported grades' }).click();
await settle(1400);
panel = await page.locator('.education').innerText();
check('gone from settings', !/Course results:/i.test(panel));
await goto(`/users/${userId}`);
profile = await page.locator('main').innerText();
check('gone from the public profile', !/Analiza/.test(profile));

console.log(`\n${pass} passed, ${fail} failed`);
if (errors.length) {
	console.log('\nErrors:');
	for (const e of [...new Set(errors)]) console.log('  ! ' + e);
} else {
	console.log('Zero console/page errors.');
}
await browser.close();
process.exit(fail === 0 && errors.length === 0 ? 0 : 1);
