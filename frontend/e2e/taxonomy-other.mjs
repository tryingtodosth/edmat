// "Other…" in the discipline and branch pickers of the exercise submit form: choosing it reveals a
// text box, and submitting creates the named node (pending) and files the exercise under it.
//   E2E_BASE=http://localhost:5173 node e2e/taxonomy-other.mjs
// Creates a pending discipline + branch and one pending exercise submission as ola; the caller
// deletes them afterwards (slugs printed at the end).
let chromium;
try {
	({ chromium } = await import('playwright'));
} catch {
	({ chromium } = await import('playwright-core'));
}
const BASE = process.env.E2E_BASE ?? 'http://localhost:5173';
const API = process.env.E2E_API ?? 'http://localhost:8000/api';
const SHOTS = process.env.E2E_SHOTS ?? '/tmp';
const STAMP = process.env.E2E_STAMP ?? 'e2e-other';
let pass = 0,
	fail = 0;
const errors = [];
const check = (l, ok, x = '') => {
	if (ok) pass++;
	else fail++;
	console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${l} ${ok ? '' : x}`);
};
const browser = await chromium.launch(
	process.env.CHROME ? { executablePath: process.env.CHROME } : {}
);
const page = await (await browser.newContext({ viewport: { width: 1200, height: 900 } })).newPage();
page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
page.on('pageerror', (e) => errors.push(e.message));
const settle = (ms = 800) => page.waitForTimeout(ms);
const goto = async (p) => {
	await page.goto(`${BASE}${p}`, { waitUntil: 'load' });
	await settle(1200);
};

await goto('/');
check(
	'the navbar says Exercises, not Disciplines',
	(await page.locator('nav.site-nav').textContent()).includes('Exercises')
);
await page
	.getByRole('link', { name: /^Log in$/ })
	.first()
	.click();
await page.waitForURL(/\/login/);
await settle(1200);
await page.locator('form input[type="email"]').fill('ola@edmat.example');
await page.locator('form input[type="password"]').fill('password123');
await page.locator('form button[type="submit"]').click();
await page.waitForURL((u) => !u.pathname.includes('/login'), { timeout: 10000 });
await settle(800);

await goto('/submit');
const form = page.locator('form.submit-form');
await form.locator('#submit-discipline').waitFor();
check(
	'no custom-name box before choosing Other',
	(await form.locator('input.other-name').count()) === 0
);
await form.locator('#submit-discipline').selectOption('__other__');
await settle(400);
check(
	'choosing Other for the discipline reveals a name box',
	(await form.locator('input.other-name').count()) >= 1
);
check(
	'a new discipline forces a new branch too',
	(await form.locator('#submit-branch').isDisabled()) &&
		(await form.locator('#submit-branch').inputValue()) === '__other__'
);
const disciplineName = `${STAMP} discipline`;
const branchName = `${STAMP} branch`;
await form.locator('input.other-name').nth(0).fill(disciplineName);
await form.locator('input.other-name').nth(1).fill(branchName);
await form.locator('input[type="text"]:not(.other-name)').first().fill(`${STAMP} exercise`);
await form.locator('textarea').first().fill('Show that the test passes.');
await page.screenshot({ path: `${SHOTS}/taxonomy-other-form.png`, fullPage: true });
const submit = form.locator('button[type="submit"]');
check('the form can be submitted once the names are typed', await submit.isEnabled());
await submit.click();
await settle(2000);
check(
	'the submission succeeded (success notice shown)',
	(await page.locator('p.notice').count()) === 1
);

const disciplines = await (await fetch(`${API}/disciplines/`)).json();
const newDiscipline = disciplines.find((d) => d.name === disciplineName);
check(
	'the named discipline now exists (pending)',
	newDiscipline?.status === 'pending',
	JSON.stringify(newDiscipline)
);
let newBranch = null;
if (newDiscipline) {
	const branches = await (await fetch(`${API}/disciplines/${newDiscipline.slug}/branches/`)).json();
	newBranch = branches.find((b) => b.name === branchName);
}
check(
	'the named branch now exists under it (pending)',
	newBranch?.status === 'pending',
	JSON.stringify(newBranch)
);
console.log(`created: discipline=${newDiscipline?.slug} branch=${newBranch?.slug}`);

await browser.close();
console.log(`\n${pass} passed, ${fail} failed, ${errors.length} console/page errors`);
for (const e of errors) console.log('  ' + e);
process.exit(fail || errors.length ? 1 : 0);
