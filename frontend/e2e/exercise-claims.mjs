// Covers/requires claims on an exercise — the shared ClaimGroups on the exercise page, read from
// and proposed to the exercise's own endpoint. E2E_EXERCISE names a published exercise.
//   E2E_BASE=http://localhost:5173 E2E_EXERCISE=51 node e2e/exercise-claims.mjs
let chromium;
try {
	({ chromium } = await import('playwright'));
} catch {
	({ chromium } = await import('playwright-core'));
}
const BASE = process.env.E2E_BASE ?? 'http://localhost:5173';
const EXERCISE = process.env.E2E_EXERCISE ?? '51';
const SHOTS = process.env.E2E_SHOTS ?? '/tmp';
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
const group = (kind) => page.locator(`section.claim-group[data-kind="${kind}"]`);

await goto(`/exercises/${EXERCISE}`);
await group('covers').waitFor();
check(
	'the exercise page renders both claim groups',
	(await page.locator('section.claim-group').count()) === 2
);
check(
	'no free-text requirement editor remains',
	(await page.getByRole('button', { name: /Edit requirements/ }).count()) === 0
);
check(
	'signed out: no add buttons',
	(await page.locator('.claim-group .add-trigger').count()) === 0
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
await settle(1000);
check('login returned to the exercise', page.url().endsWith(`/exercises/${EXERCISE}`), page.url());
await group('covers').waitFor();

async function add(kind, level) {
	await group(kind).locator('.add-trigger').click();
	const dialog = page.locator('[role="dialog"]');
	await dialog.waitFor();
	await dialog.locator('select').selectOption({ index: kind === 'covers' ? 0 : 1 });
	await dialog.locator('input.level-box').fill(String(level));
	await dialog.getByRole('button', { name: /Propose/ }).click();
	await settle(900);
}
await add('covers', 80);
check(
	'a covers claim appears',
	(await group('covers').locator('button.coverage-badge').count()) === 1
);
await add('requires', 40);
check(
	'a requires claim appears, worded as a requirement',
	(await group('requires').locator('button.coverage-badge').first().textContent()).includes(
		'Solid grounding needed'
	)
);
await page.screenshot({ path: `${SHOTS}/exercise-claims-page.png`, fullPage: true });

await group('requires').locator('button.coverage-badge').first().click();
const dialog = page.locator('[role="dialog"]');
await dialog.waitFor();
check(
	'the explanation is worded for an exercise',
	(await dialog.locator('.coverage-popover__kind').textContent()).includes('this exercise')
);
await dialog.getByRole('button', { name: /Agree/ }).first().click();
await settle();
check(
	'accuracy vote lands (exercise endpoint)',
	(await dialog.locator('.vote-widget__tally').textContent()).includes('100%')
);
await dialog.getByRole('button', { name: /More important/ }).click();
await settle();
check(
	'importance vote lands',
	(await dialog.locator('.importance__net').textContent()).includes('+1')
);
await dialog.locator('textarea').first().fill('Exercise claim thread check');
await dialog
	.getByRole('button', { name: /^Post$/ })
	.first()
	.click();
await settle(900);
const node = dialog.locator('li.comment').first();
check('a comment posts into the claim thread', (await node.count()) === 1);
await node.getByRole('button', { name: /Upvote/ }).click();
await settle();
check(
	'the comment can be upvoted',
	(await node.locator('.comment__score').textContent()).trim() === '1'
);
await page.screenshot({ path: `${SHOTS}/exercise-claims-popover.png` });
await page.keyboard.press('Escape');
await settle(400);
await goto(`/exercises/${EXERCISE}`);
await group('requires').waitFor();
await settle(800);
check(
	'the claim and its comment count survive a reload',
	(await group('requires').locator('.coverage-badge__count').count()) === 1
);

await browser.close();
console.log(`\n${pass} passed, ${fail} failed, ${errors.length} console/page errors`);
for (const e of errors) console.log('  ' + e);
process.exit(fail || errors.length ? 1 : 0);
