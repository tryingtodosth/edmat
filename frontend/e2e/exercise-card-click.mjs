// The whole exercise card is a link to the exercise — and everything inside it that owns its own
// click still owns it. Both halves matter: a card that navigates is only useful if the save menu
// sitting inside it does not fire the navigation too, and the title link must fire it exactly once
// rather than once for itself and once for the card underneath.
// Run: E2E_BASE=http://localhost:5173 node e2e/exercise-card-click.mjs
let chromium;
try {
	({ chromium } = await import('playwright'));
} catch {
	({ chromium } = await import('playwright-core'));
}
const BASE = process.env.E2E_BASE ?? 'http://localhost:5173';
// Any branch whose page lists cards. Its slug, not its id — branch ids are the backend slug.
const BRANCH = process.env.E2E_BRANCH ?? 'analiza-matematyczna';
const LIST = `/branches/${BRANCH}`;
let pass = 0,
	fail = 0;
const check = (l, ok, x = '') => {
	if (ok) pass++;
	else fail++;
	console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${l} ${ok ? '' : x}`);
};
const browser = await chromium.launch(
	process.env.CHROME ? { executablePath: process.env.CHROME } : {}
);
const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
// The corpus is Polish and a fresh context reads the English interface, so without this the list is
// honestly empty and every check below fails as if the page were broken (e2e/CLAUDE.md §16).
await ctx.addInitScript(() => localStorage.setItem('edmat.contentLocales', '["pl"]'));
const page = await ctx.newPage();
const at = () => new URL(page.url()).pathname;

await page.goto(BASE + LIST, { waitUntil: 'load' });
await page.locator('.exercise-card').first().waitFor({ timeout: 20000 });
check('the branch page lists exercise cards', (await page.locator('.exercise-card').count()) > 0);
// Whichever exercise the first card happens to be — the behaviour is the card's, not that row's.
const firstHref = await page
	.locator('.exercise-card a[href*="/exercises/"]')
	.first()
	.getAttribute('href');
const ID = firstHref.split('/').pop();
const DEST = `/exercises/${ID}`;

async function freshList() {
	await page.goto(BASE + LIST, { waitUntil: 'load' });
	await page.locator('.exercise-card').first().waitFor({ timeout: 20000 });
	// Cards are targeted by the exercise they link to, never by position: the list is ordered by
	// the backend and a positional locator has silently followed a reorder before.
	return page
		.locator('.exercise-card')
		.filter({ has: page.locator(`a[href$="/exercises/${ID}"]`) })
		.first();
}

// 1. Inert card chrome — the badges row — navigates.
let card = await freshList();
await card.locator('.exercise-card__badges').click();
await page.waitForURL(`**${DEST}`, { timeout: 10000 }).catch(() => {});
check('a click on the badges row opens the exercise', at() === DEST, at());

// 2. So does the card's own empty padding.
card = await freshList();
const box = await card.boundingBox();
await page.mouse.click(box.x + box.width - 12, box.y + box.height - 6);
await page.waitForURL(`**${DEST}`, { timeout: 10000 }).catch(() => {});
check('a click on empty card padding opens the exercise', at() === DEST, at());

// 3. The title link still works — and fires ONE navigation, not the link's plus the card's.
card = await freshList();
const before = await page.evaluate(() => history.length);
await card.locator(`a[href$="${DEST}"]`).click();
await page.waitForURL(`**${DEST}`, { timeout: 10000 }).catch(() => {});
check('the title link opens the exercise', at() === DEST, at());
check(
	'the title link pushes exactly one history entry',
	(await page.evaluate(() => history.length)) - before === 1,
	'a double navigation means the card handler ran as well as the link'
);

// 4-6. The save popover: its trigger, its panel's padding, and a real row in it.
card = await freshList();
await card.locator('button.popover__trigger').click();
await page.waitForTimeout(400);
check('the save trigger does not navigate', at() === LIST, at());
const panel = card.locator('[role="menu"]');
check('the save menu is open', (await panel.count()) === 1);
const pbox = await panel.boundingBox();
await page.mouse.click(pbox.x + pbox.width - 4, pbox.y + 3);
await page.waitForTimeout(400);
check('a click on the save panel padding does not navigate', at() === LIST, at());
await panel.locator('button.menu__row').first().click();
await page.waitForTimeout(400);
check('a save menu row does not navigate', at() === LIST, at());

// 7. A modified click means "open it somewhere else" and is left to the browser and the real link.
card = await freshList();
await card.locator('.exercise-card__badges').click({ modifiers: ['Control'] });
await page.waitForTimeout(600);
check('ctrl-click on the card does not navigate this tab', at() === LIST, at());

// 8. A drag that ended with text selected was somebody copying, not clicking.
card = await freshList();
const tbox = await card.locator('.exercise-card__meta .muted').boundingBox();
await page.mouse.move(tbox.x + 2, tbox.y + tbox.height / 2);
await page.mouse.down();
await page.mouse.move(tbox.x + tbox.width - 2, tbox.y + tbox.height / 2, { steps: 12 });
await page.mouse.up();
await page.waitForTimeout(600);
check('selecting text on the card does not navigate', at() === LIST, at());

console.log(`\n${pass} passed, ${fail} failed`);
await browser.close();
process.exit(fail ? 1 : 0);
