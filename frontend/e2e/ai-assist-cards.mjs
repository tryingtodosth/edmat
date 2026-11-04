// "N% AI" on every exercise and material CARD (owner, 2026-11-02: "add it to the cards in lists
// too"; HISTORY §17DG). The cards get their readings from the ROOT LAYOUT's holder
// (`provenance/aiAssistance.svelte.ts: provideSiteAiAssistance`), which prunes on navigation — so
// beside "every card has a chip" this checks the things that design can get wrong: one batched
// request rather than one per card; a list you come BACK to showing the new number, not the one
// from before; the material page drawing one chip and not two (its header is a `MaterialCard`);
// and the `/about` sample frames, whose invented ids a real row could share, drawing none.
//
// Run (Polish interface, the default; kasia is the seeded submitter of exercise 3 and
// `E2E_EXERCISE` must be one of hers that is on `E2E_BRANCH`'s first page of cards):
//   E2E_BASE=http://localhost:5173 E2E_API=http://127.0.0.1:8000/api \
//     [E2E_BRANCH=analiza-matematyczna] [E2E_EXERCISE=3] node e2e/ai-assist-cards.mjs
//
// It writes one author mark and DELETES it again (start and end), so it leaves nothing behind.
// The 80% check assumes the three reader votes `ai-assist-and-bilingual.mjs` leaves on exercise 3;
// on a database without them the line says what it found instead.
let chromium;
try {
	({ chromium } = await import('playwright'));
} catch {
	({ chromium } = await import('playwright-core'));
}
const BASE = process.env.E2E_BASE ?? 'http://localhost:5173';
const API = process.env.E2E_API ?? 'http://127.0.0.1:8000/api';
const BRANCH = process.env.E2E_BRANCH ?? 'analiza-matematyczna';
const EXERCISE = process.env.E2E_EXERCISE ?? '3';
const OUT = 'e2e/screens';
async function tokenFor(username) {
	const r = await fetch(`${API}/auth/login/`, {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify({ username, password: 'password123' })
	});
	if (!r.ok) throw new Error(`login ${username}: ${r.status}`);
	return (await r.json()).token;
}
const KASIA = process.env.E2E_KASIA_TOKEN ?? (await tokenFor('kasia@edmat.example'));
let pass = 0,
	fail = 0;
const check = (l, ok, d = '') => {
	if (ok) pass++;
	else fail++;
	console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${l}${ok ? '' : '  <- ' + d}`);
};
const mark = (method, body) =>
	fetch(`${API}/ai-assistance/exercise/${EXERCISE}/author-mark/`, {
		method,
		headers: { 'Content-Type': 'application/json', Authorization: `Token ${KASIA}` },
		...(body ? { body: JSON.stringify(body) } : {})
	});
await mark('DELETE');

const browser = await chromium.launch(
	process.env.CHROME ? { executablePath: process.env.CHROME } : {}
);
const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
await ctx.addInitScript(() => localStorage.setItem('edmat.contentLocales', '["pl","en"]'));
const page = await ctx.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
const asks = [];
page.on('request', (r) => {
	if (r.url().includes('/api/ai-assistance/?'))
		asks.push(new URL(r.url()).searchParams.get('targets').split(','));
});

console.log('== a branch list ==');
await page.goto(`${BASE}/branches/${BRANCH}`, { waitUntil: 'load' });
await page.locator('.exercise-card').first().waitFor({ timeout: 60000 });
await page.waitForTimeout(3000);
const cards = await page.locator('.exercise-card').count();
const chips = await page.locator('.exercise-card .chip').count();
check(
	`every exercise card carries a chip (${chips}/${cards})`,
	cards > 0 && chips === cards,
	`${chips}/${cards}`
);
check(
	'every chip reads "N% AI"',
	(await page.locator('.exercise-card .chip').allInnerTexts()).every((t) =>
		/^\d+% AI$/.test(t.trim())
	)
);
check(
	'chips are labels, not buttons',
	(await page.locator('.exercise-card button.chip').count()) === 0
);
const sizes = asks.map((a) => a.length);
check(
	`batched: ${asks.length} request(s) for ${cards} cards, none over 100`,
	asks.length >= 1 && asks.length <= Math.ceil(cards / 100) + 1 && sizes.every((n) => n <= 100),
	sizes.join(',')
);
const card3 = page
	.locator('.exercise-card')
	.filter({ has: page.locator(`a[href$="/exercises/${EXERCISE}"]`) })
	.first();
const before = (await card3.locator('.chip').innerText()).trim();
check(`exercise ${EXERCISE} reads its three readers’ mean (80% AI)`, before === '80% AI', before);
await card3.scrollIntoViewIfNeeded();
await page.screenshot({ path: `${OUT}/ai-assist-cards-branch.png` });

console.log('== come back after the author marks it ==');
const r = await mark('PUT', { assisted: true });
check(`kasia marks exercise ${EXERCISE} through the API`, r.ok, `${r.status}`);
await card3.locator(`a[href$="/exercises/${EXERCISE}"]`).first().click();
await page.waitForURL(new RegExp(`/exercises/${EXERCISE}$`), { timeout: 30000 });
await page.locator('.exercise__badges .chip').waitFor({ timeout: 30000 });
check(
	'the exercise page reads 100% AI',
	(await page.locator('.exercise__badges .chip').innerText()).trim() === '100% AI'
);
await page.goBack({ waitUntil: 'load' });
await page.locator('.exercise-card').first().waitFor({ timeout: 60000 });
await page.waitForTimeout(3000);
const after = (
	await page
		.locator('.exercise-card')
		.filter({ has: page.locator(`a[href$="/exercises/${EXERCISE}"]`) })
		.first()
		.locator('.chip')
		.innerText()
		.catch(() => '')
).trim();
check('back on the list, the card is fresh: 100% AI', after === '100% AI', after);
await mark('DELETE');

console.log('== the materials list ==');
await page.goto(`${BASE}/materials`, { waitUntil: 'load' });
await page.locator('.material-card').first().waitFor({ timeout: 60000 });
await page.waitForTimeout(2500);
const mcards = await page.locator('.material-card').count();
const mchips = await page.locator('.material-card .chip').count();
check(
	`every material card carries a chip (${mchips}/${mcards})`,
	mcards > 0 && mchips === mcards,
	`${mchips}/${mcards}`
);
await page.screenshot({ path: `${OUT}/ai-assist-cards-materials.png` });

console.log('== the material page: one chip, not two ==');
await page.goto(`${BASE}/materials/1`, { waitUntil: 'load' });
await page.locator('.material-assist .chip').waitFor({ timeout: 30000 });
await page.waitForTimeout(1000);
check(
	'exactly one chip on the material page',
	(await page.locator('.chip').count()) === 1,
	`${await page.locator('.chip').count()}`
);

console.log('== /about samples stay chip-free ==');
asks.length = 0;
await page.goto(`${BASE}/about/exercises`, { waitUntil: 'load' });
await page.locator('figure.frame').first().waitFor({ timeout: 30000 });
await page.waitForTimeout(2500);
check('no chip inside a sample frame', (await page.locator('figure.frame .chip').count()) === 0);
check(
	'and nothing asked about the invented ids',
	asks.flat().every((k) => !/:9\d{3}$/.test(k)),
	asks.flat().join(',')
);

console.log('== phone ==');
const phone = await browser.newContext({ viewport: { width: 390, height: 844 } });
await phone.addInitScript(() => localStorage.setItem('edmat.contentLocales', '["pl","en"]'));
const pp = await phone.newPage();
await pp.goto(`${BASE}/branches/${BRANCH}`, { waitUntil: 'load' });
await pp.locator('.exercise-card .chip').first().waitFor({ timeout: 60000 });
check(
	'390 px: no horizontal overflow',
	!(await pp.evaluate(() => document.documentElement.scrollWidth > innerWidth))
);
await pp
	.locator('.exercise-card')
	.first()
	.screenshot({ path: `${OUT}/ai-assist-cards-phone.png` });
await phone.close();

check('zero console/page errors', errors.length === 0, errors.slice(0, 3).join(' | '));
console.log(`\n${pass} passed, ${fail} failed`);
await browser.close();
process.exit(fail ? 1 : 0);
