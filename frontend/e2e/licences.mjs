// The per-item content licence (backend `licensing/`, 2026-10-14), driven in a real browser:
//
//   1. A corpus exercise and a corpus material say "rights not yet clarified — study only", in
//      English and in Polish (the default locale).
//   2. `/submit`: the licence picker SUGGESTS CC BY 4.0 for an exercise with no source and moves
//      back to "EdMat only" (with its reason) the moment a source is named; a submission made by
//      choosing CC BY-SA 4.0 carries it — the moderation queue shows it, and once approved the
//      exercise page shows "© author · Licensed under CC BY-SA 4.0 since …".
//   3. The author widens it from the page (CC BY-SA → CC BY); the API refuses a narrowing with
//      its reason; a stranger sees no "Change licence".
//   4. The composer for a solution carries the compact picker.
//   5. The exercise page at 390 px: no horizontal scroll.
//   6. `/material-projects/new`: a file suggests "EdMat only" and says why; a version WRITTEN here
//      suggests CC BY 4.0; naming a source URL moves it back.
//
// Needs the demo users (`seed_demo_users`, password123): `u-ola` (plain) writes, `u-kasia` (staff)
// approves. Scratch exercises are titled `e2e-licence-…`; earlier ones are left as they are (an
// approved exercise is content, and house rule 12 keeps it) — the checks always read the newest.
//
// Run:
//   E2E_BASE=http://localhost:5195 E2E_API=http://127.0.0.1:8045/api \
//     CHROME=~/.cache/ms-playwright/chromium-1234/chrome-linux64/chrome node e2e/licences.mjs
//
// Screenshots land in e2e/screens/licence-*.png and are meant to be LOOKED at.
import { mkdirSync } from 'node:fs';
import { englishContext } from './english.mjs';

let chromium;
try {
	({ chromium } = await import('playwright'));
} catch {
	({ chromium } = await import('playwright-core'));
}

const BASE = process.env.E2E_BASE ?? 'http://localhost:5195';
const API = process.env.E2E_API ?? 'http://127.0.0.1:8045/api';
const PASSWORD = 'password123';
const CORPUS_EXERCISE = process.env.E2E_CORPUS_EXERCISE ?? '20';
const CORPUS_MATERIAL = process.env.E2E_CORPUS_MATERIAL ?? '1';
const SHOTS = process.env.E2E_SHOTS ?? 'e2e/screens/';
mkdirSync(SHOTS, { recursive: true });

let pass = 0,
	fail = 0;
const check = (label, ok, extra = '') => {
	if (ok) pass++;
	else fail++;
	console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${label} ${ok ? '' : extra}`);
};

async function login(username) {
	const r = await fetch(`${API}/auth/login/`, {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify({ username, password: PASSWORD })
	});
	if (!r.ok) throw new Error(`login ${username}: ${r.status}`);
	return (await r.json()).token;
}
const auth = (token) => ({ Authorization: `Token ${token}`, 'Content-Type': 'application/json' });

const olaToken = await login('u-ola');
const kasiaToken = await login('u-kasia');

const browser = await chromium.launch(
	process.env.CHROME ? { executablePath: process.env.CHROME } : {}
);
const pageErrors = [];

async function signedIn(ctx, token) {
	// The app keeps its token in localStorage (`token.svelte.ts`); setting it before the first
	// script runs is the same state a real sign-in leaves behind.
	await ctx.addInitScript((t) => localStorage.setItem('edmat-auth-token', t), token);
}

async function waitForNotice(page) {
	await page.locator('[data-testid="licence-notice"]').first().waitFor({ timeout: 90_000 });
}

// ---- 1. corpus content, both languages ---------------------------------------------------------
console.log('corpus content is "rights not yet clarified"');
{
	const en = await englishContext(browser, BASE, { viewport: { width: 1280, height: 950 } });
	const page = await en.newPage();
	page.on('pageerror', (e) => pageErrors.push(String(e)));
	await page.goto(`${BASE}/exercises/${CORPUS_EXERCISE}`, { waitUntil: 'load' });
	await waitForNotice(page);
	const notice = page.locator('[data-testid="licence-notice"]').first();
	check(
		'a corpus exercise is marked unknown',
		(await notice.getAttribute('data-licence')) === 'unknown'
	);
	check(
		'and says so in English',
		((await notice.textContent()) ?? '').includes('Rights not yet clarified'),
		await notice.textContent()
	);
	await notice.scrollIntoViewIfNeeded();
	await page.screenshot({ path: `${SHOTS}licence-corpus-exercise-en.png` });

	await page.goto(`${BASE}/materials/${CORPUS_MATERIAL}`, { waitUntil: 'load' });
	await waitForNotice(page);
	const mNotice = page.locator('[data-testid="licence-notice"]').first();
	check(
		'a corpus material is marked unknown',
		(await mNotice.getAttribute('data-licence')) === 'unknown'
	);
	await mNotice.scrollIntoViewIfNeeded();
	await page.screenshot({ path: `${SHOTS}licence-corpus-material-en.png` });
	await en.close();

	const pl = await browser.newContext({ viewport: { width: 1280, height: 950 } });
	const plPage = await pl.newPage();
	plPage.on('pageerror', (e) => pageErrors.push(String(e)));
	await plPage.goto(`${BASE}/exercises/${CORPUS_EXERCISE}`, { waitUntil: 'load' });
	await waitForNotice(plPage);
	const plNotice = plPage.locator('[data-testid="licence-notice"]').first();
	check(
		'and in Polish (the default locale)',
		((await plNotice.textContent()) ?? '').includes('Prawa autorskie jeszcze niewyjaśnione'),
		await plNotice.textContent()
	);
	await plNotice.scrollIntoViewIfNeeded();
	await plPage.screenshot({ path: `${SHOTS}licence-corpus-exercise-pl.png` });
	await pl.close();
}

// ---- 2. /submit with a licence, the queue, approval, the page ---------------------------------
console.log('/submit carries the chosen licence');
const TITLE = `e2e-licence-${Date.now()}`;
const ctx = await englishContext(browser, BASE, { viewport: { width: 1280, height: 950 } });
await signedIn(ctx, olaToken);
const page = await ctx.newPage();
page.on('pageerror', (e) => pageErrors.push(String(e)));
await page.goto(`${BASE}/submit`, { waitUntil: 'load' });
const form = page.locator('form').filter({ has: page.locator('#submit-branch') });
await form.waitFor({ timeout: 30_000 });
const picker = form.locator('[data-testid="licence-picker"]');
await picker.waitFor();
check(
	'the picker offers six licences and never "unknown"',
	(await picker.locator('input[type="radio"]').count()) === 6 &&
		(await picker.locator('input[value="unknown"]').count()) === 0
);
// The owner's suggestion (2026-10-14): no source → the author's own work → CC BY 4.0, pre-selected
// and labelled as a suggestion, with the reason under the hint.
await page.waitForTimeout(500);
check(
	'with no source it suggests CC BY 4.0',
	(await picker.locator('input[value="cc-by-4.0"]').isChecked()) &&
		(await picker.locator('[data-testid="licence-suggested"]').count()) === 1
);
check(
	'and says why',
	((await picker.locator('[data-testid="licence-why"]').textContent()) ?? '').includes(
		'your own work'
	)
);
await picker.scrollIntoViewIfNeeded();
await page.screenshot({ path: `${SHOTS}licence-submit-suggest-own.png` });
const sourceNameInput = form
	.locator('label.field')
	.filter({ hasText: 'Source name' })
	.locator('input');
await sourceNameInput.fill('Kolokwium 2024, zadanie 3');
await page.waitForTimeout(300);
check(
	'naming a source moves it back to "EdMat only"',
	await picker.locator('input[value="edmat-only"]').isChecked()
);
check(
	'and the reason says it may be somebody else’s work',
	((await picker.locator('[data-testid="licence-why"]').textContent()) ?? '').includes(
		'somebody else'
	)
);
await picker.scrollIntoViewIfNeeded();
await page.screenshot({ path: `${SHOTS}licence-submit-suggest-source.png` });
await sourceNameInput.fill('');
await page.waitForTimeout(300);
check(
	'clearing it suggests CC BY 4.0 again',
	await picker.locator('input[value="cc-by-4.0"]').isChecked()
);
await form.locator('#submit-discipline').selectOption('matematyka');
await page.waitForFunction(
	() => !!document.querySelector('#submit-branch option[value="analiza-matematyczna"]'),
	null,
	{ timeout: 15_000 }
);
await form.locator('#submit-branch').selectOption('analiza-matematyczna');
await form.locator('label.field').filter({ hasText: 'Title' }).locator('input').first().fill(TITLE);
await form.locator('select:has(option[value="university"])').selectOption('university');
// The statement editor may start in source (textarea) or rich (ProseMirror) mode — per the
// reader's own preference — so fill whichever it drew.
const statementField = form.locator('label.field').filter({ hasText: 'Statement' }).first();
if ((await statementField.locator('textarea').count()) > 0) {
	await statementField.locator('textarea').fill('Compute \\(1+1\\).');
} else {
	await statementField.locator('.ProseMirror').waitFor({ timeout: 60_000 });
	await statementField.locator('.ProseMirror').click();
	await page.keyboard.type('Compute two plus two.');
}
await picker
	.locator('label.licence-option')
	.filter({ has: page.locator('input[value="cc-by-sa-4.0"]') })
	.click();
check(
	'choosing CC BY-SA 4.0 checks it',
	await picker.locator('input[value="cc-by-sa-4.0"]').isChecked()
);
await picker.scrollIntoViewIfNeeded();
await page.screenshot({ path: `${SHOTS}licence-submit-picker.png` });
const submitted = page.waitForResponse(
	(r) => r.url().includes('/exercise-submissions/') && r.request().method() === 'POST'
);
await form.locator('button[type="submit"].submit').click();
const submission = await (await submitted).json();
check(
	'the submission carries the licence in its draft',
	submission?.payload?.licence === 'cc-by-sa-4.0',
	JSON.stringify(submission?.payload?.licence)
);

// The queue, as staff.
{
	const staff = await englishContext(browser, BASE, { viewport: { width: 1280, height: 950 } });
	await signedIn(staff, kasiaToken);
	const sp = await staff.newPage();
	sp.on('pageerror', (e) => pageErrors.push(String(e)));
	await sp.goto(`${BASE}/moderation?tab=submissions`, { waitUntil: 'load' });
	const row = sp.locator('li.queue-item').filter({ hasText: TITLE });
	// The whole queue loads in one request, which on a busy dev database takes a while.
	await row.waitFor({ timeout: 120_000 }).catch(() => {});
	check(
		'the moderation queue shows the chosen licence',
		(
			(await row
				.locator('[data-testid="queue-licence"]')
				.textContent()
				.catch(() => '')) ?? ''
		).includes('CC BY-SA 4.0')
	);
	await row.scrollIntoViewIfNeeded().catch(() => {});
	await sp.screenshot({ path: `${SHOTS}licence-queue.png` });
	await staff.close();
}

const approve = await fetch(`${API}/moderation/submission/${submission.id}/approve/`, {
	method: 'POST',
	headers: auth(kasiaToken),
	body: '{}'
});
check('staff approves it', approve.ok, String(approve.status));
const approved = await (
	await fetch(`${API}/exercise-submissions/${submission.id}/`, { headers: auth(kasiaToken) })
).json();
const exerciseId = String(approved.resulting_exercise);

await page.goto(`${BASE}/exercises/${exerciseId}`, { waitUntil: 'load' });
await waitForNotice(page);
const notice = page.locator('[data-testid="licence-notice"]').first();
check(
	'the exercise page shows CC BY-SA 4.0',
	(await notice.getAttribute('data-licence')) === 'cc-by-sa-4.0'
);
const noticeText = (await notice.textContent()) ?? '';
check(
	'with the attribution line',
	noticeText.includes('©') && noticeText.includes('Licensed under'),
	noticeText
);
check(
	'linked to the licence deed',
	((await notice.locator('a[rel~="license"]').getAttribute('href')) ?? '').includes('/by-sa/4.0/')
);
await notice
	.locator('.licence-notice__since')
	.waitFor({ timeout: 10_000 })
	.catch(() => {});
check('and since when', (await notice.locator('.licence-notice__since').count()) === 1);
await notice.scrollIntoViewIfNeeded();
await page.screenshot({ path: `${SHOTS}licence-exercise-ccbysa.png` });

// ---- 3. the author widens it; a narrowing is refused; a stranger cannot ----------------------
console.log('changing the licence');
const changeButton = notice.getByRole('button', { name: 'Change licence', exact: true });
await changeButton.waitFor({ timeout: 10_000 }).catch(() => {});
check('the author sees "Change licence"', (await changeButton.count()) === 1);
await changeButton.click();
const select = notice.locator('[data-testid="licence-change-select"]');
await select.waitFor();
const offered = await select.locator('option').evaluateAll((os) => os.map((o) => o.value));
check(
	'only wider licences are offered',
	offered.includes('cc-by-4.0') &&
		offered.includes('cc0-1.0') &&
		!offered.includes('cc-by-nc-4.0') &&
		!offered.includes('edmat-only'),
	offered.join(',')
);
await select.selectOption('cc-by-4.0');
await page.screenshot({ path: `${SHOTS}licence-change-form.png` });
await notice.locator('button[type="submit"]').click();
await page
	.waitForFunction(
		() =>
			document.querySelector('[data-testid="licence-notice"]')?.getAttribute('data-licence') ===
			'cc-by-4.0',
		null,
		{ timeout: 10_000 }
	)
	.catch(() => {});
check('it now says CC BY 4.0', (await notice.getAttribute('data-licence')) === 'cc-by-4.0');
check('and confirms it', ((await notice.textContent()) ?? '').includes('Licence updated.'));
// Widening the exercise moves its original-language text with it, so no "this translation is
// licensed under …" note may appear afterwards (it once did, read off the page-load value).
check(
	'and no stale "this translation" note appears',
	!((await notice.textContent()) ?? '').includes('This translation')
);
await page.screenshot({ path: `${SHOTS}licence-changed.png` });

const narrow = await fetch(`${API}/licences/exercise/${exerciseId}/`, {
	method: 'POST',
	headers: auth(olaToken),
	body: JSON.stringify({ licence: 'cc-by-sa-4.0' })
});
check(
	'the API refuses a narrowing with its reason',
	narrow.status === 400 && (await narrow.json()).detail === 'licence_narrowing'
);
const reading = await (await fetch(`${API}/licences/exercise/${exerciseId}/`)).json();
check(
	'the change is in the history',
	reading.history?.[0]?.from === 'cc-by-sa-4.0' && reading.history?.[0]?.to === 'cc-by-4.0'
);

{
	const stranger = await englishContext(browser, BASE, { viewport: { width: 1280, height: 950 } });
	const sp = await stranger.newPage();
	await sp.goto(`${BASE}/exercises/${exerciseId}`, { waitUntil: 'load' });
	await waitForNotice(sp);
	await sp.waitForTimeout(1500);
	check(
		'a signed-out reader sees the licence and no change control',
		(await sp.locator('[data-testid="licence-notice"] button').count()) === 0 &&
			(await sp.locator('[data-testid="licence-notice"]').first().getAttribute('data-licence')) ===
				'cc-by-4.0'
	);
	await stranger.close();
}

// ---- 4. the solution composer -----------------------------------------------------------------
console.log('the solution composer');
const addSolution = page.getByRole('button', { name: 'Add a solution' });
if ((await addSolution.count()) > 0) {
	await addSolution.first().click();
	const compact = page.locator('.composer [data-testid="licence-picker"] details');
	await compact.waitFor({ timeout: 10_000 }).catch(() => {});
	check('the composer carries a folded licence picker', (await compact.count()) === 1);
	check(
		'reading "Licence: EdMat only" until opened',
		((await compact.locator('summary').textContent()) ?? '').includes('EdMat only')
	);
	await compact.scrollIntoViewIfNeeded().catch(() => {});
	await page.screenshot({ path: `${SHOTS}licence-composer.png` });
} else {
	check('the composer button exists', false, 'no "Add a solution" button');
}

// ---- 5. 390 px ---------------------------------------------------------------------------------
console.log('390 px');
{
	const phone = await englishContext(browser, BASE, { viewport: { width: 390, height: 844 } });
	await signedIn(phone, olaToken);
	const pp = await phone.newPage();
	await pp.goto(`${BASE}/exercises/${exerciseId}`, { waitUntil: 'load' });
	await waitForNotice(pp);
	const overflow = await pp.evaluate(
		() => document.documentElement.scrollWidth - window.innerWidth
	);
	check(
		'the exercise page does not scroll sideways at 390 px',
		overflow <= 0,
		`overflow=${overflow}`
	);
	await pp.locator('[data-testid="licence-notice"]').first().scrollIntoViewIfNeeded();
	await pp.screenshot({ path: `${SHOTS}licence-exercise-390.png` });
	await pp.goto(`${BASE}/submit`, { waitUntil: 'load' });
	await pp.locator('[data-testid="licence-picker"]').waitFor({ timeout: 30_000 });
	await pp.locator('[data-testid="licence-picker"]').scrollIntoViewIfNeeded();
	const overflow2 = await pp.evaluate(
		() => document.documentElement.scrollWidth - window.innerWidth
	);
	check('nor does /submit with the picker', overflow2 <= 0, `overflow=${overflow2}`);
	await pp.screenshot({ path: `${SHOTS}licence-submit-390.png` });
	await phone.close();
}

// ---- 6. the material editor ---------------------------------------------------------------------
console.log('/material-projects/new');
{
	const mp = await ctx.newPage();
	mp.on('pageerror', (e) => pageErrors.push(String(e)));
	await mp.goto(`${BASE}/material-projects/new`, { waitUntil: 'load' });
	const mPicker = mp.locator('[data-testid="licence-picker"]');
	await mPicker.waitFor({ timeout: 60_000 });
	await mp.waitForTimeout(500);
	check(
		'a file version keeps "EdMat only"',
		await mPicker.locator('input[value="edmat-only"]').isChecked()
	);
	check(
		'and says a file or a link may be somebody else’s',
		((await mPicker.locator('[data-testid="licence-why"]').textContent()) ?? '').includes(
			'A file or a link'
		)
	);
	await mPicker.scrollIntoViewIfNeeded();
	await mp.screenshot({ path: `${SHOTS}licence-material-file.png` });
	await mp.locator('input[name="version-kind"][value="body"]').check();
	await mp.waitForTimeout(300);
	check(
		'a version written here suggests CC BY 4.0',
		(await mPicker.locator('input[value="cc-by-4.0"]').isChecked()) &&
			(await mPicker.locator('[data-testid="licence-suggested"]').count()) === 1
	);
	await mPicker.scrollIntoViewIfNeeded();
	await mp.screenshot({ path: `${SHOTS}licence-material-scratch.png` });
	await mp.locator('input[inputmode="url"]').first().fill('example.edu/lecture-notes');
	await mp.waitForTimeout(300);
	check(
		'naming where it came from moves it back to "EdMat only"',
		await mPicker.locator('input[value="edmat-only"]').isChecked()
	);
	// Once the author clicks, the suggestion no longer moves it.
	await mPicker
		.locator('label.licence-option')
		.filter({ has: mp.locator('input[value="cc0-1.0"]') })
		.click();
	await mp.locator('input[inputmode="url"]').first().fill('');
	await mp.waitForTimeout(300);
	check(
		'after a click the choice is the author’s and stays',
		await mPicker.locator('input[value="cc0-1.0"]').isChecked()
	);
	await mp.close();
}

check('no page errors', pageErrors.length === 0, pageErrors.join(' | '));
await browser.close();
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
