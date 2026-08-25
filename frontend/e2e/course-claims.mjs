// The covers/requires claims on a user-run course: the same badges, popover, votes, ranking and
// thread a material has, read from the course's own endpoint. E2E_COURSE names a public course
// that has at least one subject branch (otherwise there are no topics to claim against).
//   E2E_BASE=http://localhost:5173 E2E_COURSE=6 node e2e/course-claims.mjs
let chromium;
try {
	({ chromium } = await import('playwright'));
} catch {
	({ chromium } = await import('playwright-core'));
}
const BASE = process.env.E2E_BASE ?? 'http://localhost:5173';
const COURSE = process.env.E2E_COURSE ?? '6';
const SHOTS = process.env.E2E_SHOTS ?? '/tmp';
let pass = 0,
	fail = 0;
const errors = [];
const check = (l, ok, x = '') => {
	ok ? pass++ : fail++;
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
const groups = () => page.locator('section.claim-group');

await goto(`/courses/${COURSE}`);
await groups().first().waitFor();
check('a course page renders both claim groups', (await groups().count()) === 2);
check(
	'signed out: no add buttons',
	(await page.locator('.claim-group .add-trigger').count()) === 0
);

// Through the header link, so the login page has a page to return to (returnTo.ts).
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
check('login returned to the course page', page.url().endsWith(`/courses/${COURSE}`), page.url());
await groups().first().waitFor();

async function add(kind, level) {
	const g = groups()
		.locator(`[data-kind="${kind}"]`)
		.or(page.locator(`section.claim-group[data-kind="${kind}"]`))
		.first();
	await g.locator('.add-trigger').click();
	const dialog = page.locator('[role="dialog"]');
	await dialog.waitFor();
	const select = dialog.locator('select');
	const opts = await select.locator('option').allTextContents();
	await select.selectOption({ index: kind === 'covers' ? 1 : Math.min(2, opts.length - 1) });
	await dialog.locator('input.level-box').fill(String(level));
	await dialog.getByRole('button', { name: /Propose/ }).click();
	await settle(900);
	return g;
}
const coversGroup = await add('covers', 70);
check('a covers claim appears', (await coversGroup.locator('button.coverage-badge').count()) === 1);
check(
	'it reads as deep coverage',
	(await coversGroup.locator('button.coverage-badge').first().textContent()).includes(
		'Deep coverage'
	)
);
const reqGroup = await add('requires', 20);
check('a requires claim appears', (await reqGroup.locator('button.coverage-badge').count()) === 1);
check(
	'it reads as basics needed',
	(await reqGroup.locator('button.coverage-badge').first().textContent()).includes('Basics needed')
);
await page.screenshot({ path: `${SHOTS}/course-claims-page.png`, fullPage: true });

await reqGroup.locator('button.coverage-badge').first().click();
let dialog = page.locator('[role="dialog"]');
await dialog.waitFor();
const dts = await dialog.locator('dl dt').allTextContents();
check(
	'the requirement popover shows only the prior-knowledge line',
	dts.some((t) => /Prior knowledge/i.test(t)) && !dts.some((t) => /Covered to depth/i.test(t))
);
await dialog.getByRole('button', { name: /Agree/ }).first().click();
await settle();
check(
	'accuracy vote lands (course endpoint)',
	(await dialog.locator('.vote-widget__tally').textContent()).includes('100%')
);
await dialog.getByRole('button', { name: /More important/ }).click();
await settle();
check(
	'importance vote lands',
	(await dialog.locator('.importance__net').textContent()).includes('+1')
);
await dialog.locator('textarea').first().fill('Course claim thread check');
await dialog
	.getByRole('button', { name: /^Post$/ })
	.first()
	.click();
await settle(900);
const node = dialog.locator('li.comment').first();
check('a comment posts into the course claim thread', (await node.count()) === 1);
await node.getByRole('button', { name: /Upvote/ }).click();
await settle();
check(
	'the comment can be upvoted',
	(await node.locator('.comment__score').textContent()).trim() === '1'
);
await page.screenshot({ path: `${SHOTS}/course-claims-popover.png` });
await page.keyboard.press('Escape');
await settle(400);

await goto(`/courses/${COURSE}`);
await groups().first().waitFor();
await settle(800);
check(
	'claims survive a reload with their comment count',
	(await page
		.locator('section.claim-group[data-kind="requires"] .coverage-badge__count')
		.count()) === 1
);

await browser.close();
console.log(`\n${pass} passed, ${fail} failed, ${errors.length} console/page errors`);
for (const e of errors) console.log('  ' + e);
process.exit(fail || errors.length ? 1 : 0);
