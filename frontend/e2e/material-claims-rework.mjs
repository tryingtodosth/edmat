// End-to-end check of the claims rework: a claim's popover shows ONE reading (covers OR requires,
// never the same number under both), requirements are structured claims with a level, votes and a
// thread, an importance vote reorders the list, and comments carry up/down votes.
//
//   E2E_BASE=http://localhost:5173 node e2e/material-claims-rework.mjs
//
// Signs in as a seeded demo account (registration is throttled per IP). Everything it creates is
// removed at the end through the Django shell by the caller — see the cleanup note at the bottom.
let chromium;
try {
	({ chromium } = await import('playwright'));
} catch {
	({ chromium } = await import('playwright-core'));
}

const BASE = process.env.E2E_BASE ?? 'http://localhost:5173';
const SHOTS = process.env.E2E_SHOTS ?? '/tmp';
const MATERIAL = process.env.E2E_MATERIAL ?? '1';
const EMAIL = process.env.E2E_EMAIL ?? 'ola@edmat.example';
const PASSWORD = 'password123';

let pass = 0;
let fail = 0;
const errors = [];
const check = (label, ok, extra = '') => {
	if (ok) pass++;
	else fail++;
	console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${label} ${ok ? '' : extra}`);
};
const settle = (page, ms = 600) => page.waitForTimeout(ms);

const browser = await chromium.launch(
	process.env.CHROME ? { executablePath: process.env.CHROME } : {}
);
const context = await browser.newContext({ viewport: { width: 1200, height: 900 } });
const page = await context.newPage();
page.on('console', (msg) => msg.type() === 'error' && errors.push(`console: ${msg.text()}`));
page.on('pageerror', (e) => errors.push(`page: ${e.message}`));

async function goto(path) {
	await page.goto(`${BASE}${path}`, { waitUntil: 'load' });
	await settle(page, 900);
}

// ---- 1. anonymous: one reading per claim, importance widget asks to log in -------------------
console.log('anonymous reader');
await goto(`/materials/${MATERIAL}`);
await page.locator('section.claim-group button.coverage-badge').first().waitFor();
const groups = page.locator('section.claim-group');
check('two claim groups render', (await groups.count()) >= 2);
const coversBadges = groups.nth(0).locator('button.coverage-badge');
check('covers group lists claims', (await coversBadges.count()) > 3);
check(
	'requires group is empty and says so',
	(await groups.nth(1).locator('button.coverage-badge').count()) === 0 &&
		(await groups.nth(1).locator('p.status').count()) === 1
);
await coversBadges.first().click();
let dialog = page.locator('[role="dialog"]');
await dialog.waitFor();
let dts = await dialog.locator('dl dt').allTextContents();
check(
	'popover shows "Covered to depth" once',
	dts.filter((t) => /Covered to depth/i.test(t)).length === 1
);
check(
	'popover shows NO "Prior knowledge" line on a covers claim',
	!dts.some((t) => /Prior knowledge/i.test(t))
);
check(
	'popover explains what kind of claim it is',
	(await dialog.locator('.coverage-popover__kind').textContent()).includes('coverage claim')
);
check(
	'importance widget asks a signed-out reader to log in',
	(await dialog.locator('.importance a.login').count()) === 1
);
check(
	'no comment vote arrow is enabled for a signed-out reader',
	(await dialog.locator('.vote-arrow:not(:disabled)').count()) === 0
);
await page.screenshot({ path: `${SHOTS}/claims-anon-popover.png` });
await page.keyboard.press('Escape');
await settle(page, 300);

// ---- 2. signed in: add a structured requirement, vote, rank, comment, vote on comment ----------
console.log('signed-in reader');
// The login form must be hydrated before it is submitted, or the browser posts it natively as a
// GET and the page just reloads with a `?` — the same retry the other scripts carry.
for (let attempt = 0; attempt < 3; attempt++) {
	await goto('/login');
	await settle(page, 1200);
	await page.locator('form input[type="email"]').fill(EMAIL);
	await page.locator('form input[type="password"]').fill(PASSWORD);
	await page.locator('form button[type="submit"]').click();
	try {
		await page.waitForURL((url) => !url.pathname.includes('/login'), { timeout: 8000 });
		break;
	} catch {
		if (attempt === 2) throw new Error('login never left /login');
	}
}
await goto(`/materials/${MATERIAL}`);
await page.locator('section.claim-group button.coverage-badge').first().waitFor();

const addReq = page.getByRole('button', { name: /Add requirement/ });
check('"Add requirement" trigger is offered', (await addReq.count()) === 1);
await addReq.click();
dialog = page.locator('[role="dialog"]');
await dialog.waitFor();
check(
	'the add form explains it is a requirement claim',
	(await dialog.locator('.add-coverage__intro').textContent()).includes('should already know')
);
const topicSelect = dialog.locator('select');
const lastTopic = await topicSelect.locator('option').last().getAttribute('value');
await topicSelect.selectOption(lastTopic);
await dialog.locator('input.level-box').fill('35');
check(
	'typing an exact value moves the label',
	(await dialog.locator('#level-label').textContent()).includes('35/100')
);
await page.screenshot({ path: `${SHOTS}/claims-add-requirement.png` });
await dialog.getByRole('button', { name: /Propose/ }).click();
await settle(page, 900);
const reqBadges = page.locator('section.claim-group').nth(1).locator('button.coverage-badge');
check('the new requirement appears in the Requires group', (await reqBadges.count()) === 1);
check(
	'it is bucketed with a requirement word, not a coverage word',
	(await reqBadges.first().textContent()).includes('Solid grounding needed')
);
await page.screenshot({ path: `${SHOTS}/claims-page-signed-in.png`, fullPage: true });

await reqBadges.first().click();
dialog = page.locator('[role="dialog"]');
await dialog.waitFor();
dts = await dialog.locator('dl dt').allTextContents();
check(
	'requirement popover shows "Prior knowledge needed" once',
	dts.filter((t) => /Prior knowledge needed/i.test(t)).length === 1
);
check('and no "Covered to depth" line', !dts.some((t) => /Covered to depth/i.test(t)));
check(
	'the level is the one typed',
	(await dialog.locator('dd.depth').textContent()).includes('35/100')
);

await dialog.getByRole('button', { name: /Agree/ }).first().click();
await settle(page);
check(
	'accuracy vote registers',
	(await dialog.locator('.vote-widget__tally').textContent()).includes('100%')
);
await dialog.getByRole('button', { name: /More important/ }).click();
await settle(page);
check(
	'importance vote shows a +1 ranking',
	(await dialog.locator('.importance__net').textContent()).includes('+1')
);

await dialog.locator('textarea').first().fill('Rework check: does this need linear algebra first?');
await dialog
	.getByRole('button', { name: /^Post$/ })
	.first()
	.click();
await settle(page, 900);
const commentNode = dialog.locator('li.comment').first();
check('comment posts into the claim thread', (await commentNode.count()) === 1);
check(
	'a fresh comment scores 0',
	(await commentNode.locator('.comment__score').textContent()).trim() === '0'
);
await commentNode.getByRole('button', { name: /Upvote/ }).click();
await settle(page);
check(
	'upvoting moves the score to 1',
	(await commentNode.locator('.comment__score').textContent()).trim() === '1'
);
await page.screenshot({ path: `${SHOTS}/claims-requirement-popover.png` });
await commentNode.getByRole('button', { name: /Upvote/ }).click();
await settle(page);
check(
	'clicking the same arrow again retracts to 0',
	(await commentNode.locator('.comment__score').textContent()).trim() === '0'
);
await commentNode.getByRole('button', { name: /Downvote/ }).click();
await settle(page);
check(
	'downvote lands at -1',
	(await commentNode.locator('.comment__score').textContent()).trim() === '-1'
);
await page.keyboard.press('Escape');
await settle(page, 300);

// ---- 3. an importance vote reorders the covers list ------------------------------------------
console.log('ordering');
const coversNow = page.locator('section.claim-group').nth(0).locator('button.coverage-badge');
const thirdLabel = (await coversNow.nth(2).locator('.coverage-badge__label').textContent()).trim();
await coversNow.nth(2).click();
dialog = page.locator('[role="dialog"]');
await dialog.waitFor();
await dialog.getByRole('button', { name: /More important/ }).click();
await settle(page);
await page.keyboard.press('Escape');
await settle(page, 400);
const firstAfter = (await coversNow.first().locator('.coverage-badge__label').textContent()).trim();
check(
	`ranking a claim up moves it to the front (${thirdLabel})`,
	firstAfter === thirdLabel,
	`got ${firstAfter}`
);
await goto(`/materials/${MATERIAL}`);
await page.locator('section.claim-group button.coverage-badge').first().waitFor();
const firstReloaded = (
	await page
		.locator('section.claim-group')
		.nth(0)
		.locator('.coverage-badge__label')
		.first()
		.textContent()
).trim();
check(
	'the order survives a reload (server-side tally)',
	firstReloaded === thirdLabel,
	`got ${firstReloaded}`
);

// ---- 4. the browse card shows both lines, requirement chip is clickable ------------------------
console.log('browse card');
await goto('/materials');
await page.locator('article.material-card').first().waitFor();
const card = page
	.locator('article.material-card')
	.filter({ has: page.locator(`a[href$="/materials/${MATERIAL}"]`) })
	.first();
check(
	'card renders a Requires line',
	(await card.locator('.claim-line', { hasText: 'Requires:' }).count()) === 1
);
const reqChip = card.locator('button.claim-chip--requirement').first();
check('the requirement chip is a button', (await reqChip.count()) === 1);
await reqChip.click();
dialog = page.locator('[role="dialog"]');
await dialog.waitFor();
check(
	'clicking it opens the requirement popover from the grid',
	(await dialog.locator('dl dt').allTextContents()).some((t) => /Prior knowledge needed/i.test(t))
);
await page.screenshot({ path: `${SHOTS}/claims-card-popover.png` });
await page.keyboard.press('Escape');
await card.scrollIntoViewIfNeeded();
await card.screenshot({ path: `${SHOTS}/claims-card.png` });

await browser.close();
console.log(`\n${pass} passed, ${fail} failed, ${errors.length} console/page errors`);
for (const e of errors) console.log('  ' + e);
process.exit(fail || errors.length ? 1 : 0);
