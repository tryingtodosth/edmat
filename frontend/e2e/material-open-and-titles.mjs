// Three asks from 2026-09-18, in one run against both real servers:
//   1. The "open / download the material" button sits under the title and summary, on the LEFT,
//      above everything else on the card — not at the bottom-right of the footer.
//   2. A material that IS a picture shows the picture, inline, actually loaded.
//   3. Every browser tab is named "EdMat: <page>".
// Plus the messaging round trip, whose other half (the row in the database is ciphertext) is
// checked server-side by the snippet in test.md — a browser cannot see a column.
//
// Run: E2E_BASE=http://localhost:5173 E2E_API=http://localhost:8000 node e2e/material-open-and-titles.mjs
let chromium;
try {
	({ chromium } = await import('playwright'));
} catch {
	({ chromium } = await import('playwright-core'));
}
const BASE = process.env.E2E_BASE ?? 'http://localhost:5173';
const API = process.env.E2E_API ?? 'http://localhost:8000';
const PICTURE_ID = process.env.E2E_PICTURE_MATERIAL ?? '8';
let pass = 0,
	fail = 0;
const errors = [];
const check = (l, ok, x = '') => {
	ok ? pass++ : fail++;
	console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${l}${ok ? '' : '  <- ' + x}`);
};
const browser = await chromium.launch(
	process.env.CHROME ? { executablePath: process.env.CHROME } : {}
);
const ctx = await browser.newContext({ viewport: { width: 1200, height: 900 } });
const page = await ctx.newPage();
page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
page.on('pageerror', (e) => errors.push(e.message));
const settle = (ms = 900) => page.waitForTimeout(ms);
const box = async (sel) => await page.locator(sel).first().boundingBox();

console.log('\n— the button moved —');
await page.goto(`${BASE}/materials/1`, { waitUntil: 'load' });
await page.locator('.material-card').waitFor({ timeout: 20000 });
await settle(1200);

const get = page.locator('.material-card__get a.download');
check('the card has a get-the-material button', (await get.count()) === 1);

const [getBox, descBox, titleBox, cardBox] = await Promise.all([
	box('.material-card__get a.download'),
	box('.material-card .description'),
	box('.material-card h1, .material-card h3'),
	box('.material-card')
]);
check('it is below the title', getBox.y > titleBox.y, `${getBox.y} vs ${titleBox.y}`);
check('it is below the summary', getBox.y > descBox.y, `${getBox.y} vs ${descBox.y}`);
// Left-aligned with the card's own text column, not pushed to the right-hand edge.
check(
	'it starts at the same left edge as the summary',
	Math.abs(getBox.x - descBox.x) <= 2,
	`${getBox.x} vs ${descBox.x}`
);
check(
	'it is on the LEFT half of the card',
	getBox.x + getBox.width < cardBox.x + cardBox.width / 2,
	`ends ${getBox.x + getBox.width}, card mid ${cardBox.x + cardBox.width / 2}`
);
// It used to be the last thing on the card; now the claims come after it.
const claims = await box('.claim-group');
check('the claim groups come after it, not before', claims.y > getBox.y, `${claims.y}`);
check('it is still a 44px tap target', getBox.height >= 44, `${getBox.height}`);

console.log('\n— pictures —');
await page.goto(`${BASE}/materials/${PICTURE_ID}`, { waitUntil: 'load' });
await page.locator('.material-card').waitFor({ timeout: 20000 });
await settle(1500);
const img = page.locator('.picture-preview img');
check('a picture material shows a preview', (await img.count()) === 1);
// Present is not loaded — a broken src passes a selector check and fails a reader.
const loaded = await img.evaluate((el) => el.complete && el.naturalWidth > 0 && el.naturalHeight);
check('the picture genuinely loaded', Boolean(loaded), `naturalHeight ${loaded}`);
check(
	'it is described by the material, not left unlabelled',
	((await img.getAttribute('alt')) ?? '').length > 0
);
const imgBox = await box('.picture-preview img');
const getBox2 = await box('.material-card__get a.download');
check('the picture is below the button', imgBox.y > getBox2.y, `${imgBox.y} vs ${getBox2.y}`);
check('the picture fits the viewport height', imgBox.height <= 900, `${imgBox.height}`);

await page.goto(`${BASE}/materials/1`, { waitUntil: 'load' });
await settle(1200);
check(
	'a PDF material still offers its own collapsed preview',
	(await page.locator('.pdf-preview__toggle').count()) === 1
);
check(
	'and a PDF shows no picture block',
	(await page.locator('.picture-preview').count()) === 0
);

console.log('\n— tab titles —');
for (const [path, expect] of [
	['/', 'EdMat: Home'],
	['/materials', 'EdMat: '],
	['/events', 'EdMat: '],
	['/login', 'EdMat: '],
	['/activity', 'EdMat: '],
	['/settings', 'EdMat: ']
]) {
	await page.goto(`${BASE}${path}`, { waitUntil: 'load' });
	await settle(700);
	const t = await page.title();
	check(`${path} is named "${t}"`, t.startsWith(expect), t);
	// Exactly one <title> — a second one silently wins and freezes every page on one name.
	const n = await page.locator('head title').count();
	check(`${path} has exactly one title element`, n === 1, `${n}`);
}
await page.goto(`${BASE}/materials/${PICTURE_ID}`, { waitUntil: 'load' });
await settle(1500);
const detailTitle = await page.title();
const detailHeading = (await page.locator('.material-card h1').first().innerText()).trim();
check(
	'a detail page is named after its record',
	detailTitle === `EdMat: ${detailHeading}`,
	`${detailTitle} vs heading ${detailHeading}`
);

console.log('\n— a message survives the round trip through encryption —');
// Two scratch accounts, not the seeded demo ones: this checkout's demo passwords are not the
// documented `password123`, and resetting somebody else's account to run a test is not on.
const ANNA = { user: 'scratch-anna@edmat.example', pass: 'scratchpass123' };
const PIOTR = { user: 'scratch-piotr@edmat.example', pass: 'scratchpass123', id: process.env.E2E_SCRATCH_RECIPIENT ?? '59' };
const BODY = `Encrypted at rest, readable here — Thursday at six? ${Date.now()}`;

async function signIn({ user, pass }) {
	await page.goto(`${BASE}/`, { waitUntil: 'load' });
	await settle(700);
	await page.evaluate(() => localStorage.clear());
	// Wait for a request the page only makes once it has HYDRATED. Clicking before that submits
	// the form natively (no preventDefault yet) and lands on `/login?` having sent nothing — which
	// looks exactly like a rejected password and is not one.
	const hydrated = page
		.waitForResponse((r) => /\/api\/auth\/providers\//.test(r.url()), { timeout: 20000 })
		.catch(() => null);
	await page.goto(`${BASE}/login`, { waitUntil: 'load' });
	await hydrated;
	await settle(900);
	await page.locator('form input[autocomplete="username"]').fill(user);
	await page.locator('form input[type="password"]').fill(pass);
	await page.locator('form button[type="submit"]').click();
	await page.waitForURL((u) => !u.pathname.includes('/login'), { timeout: 15000 });
	await settle(1200);
}

/** Open a page and wait for `sel`; reload once if it is not there yet. A navigation made straight
 *  after signing in can race `authStore.init()`, and the page then renders its signed-out branch —
 *  which is a timing artefact of the dev server, not a thing a real reader would sit through. */
async function openAndWait(url, sel, tries = 3) {
	for (let i = 0; i < tries; i++) {
		if (i === 0) await page.goto(url, { waitUntil: 'load' });
		else await page.reload({ waitUntil: 'load' });
		await settle(1500);
		if (await page.locator(sel).first().isVisible().catch(() => false)) return true;
	}
	console.log('  (page said:)', (await page.locator('body').innerText()).slice(0, 300));
	return false;
}

await signIn(ANNA);
check(
	'the compose form opens for the sender',
	await openAndWait(`${BASE}/messages/new?to=${PIOTR.id}`, 'form.compose-form')
);
await page.locator('form.compose-form input[type="text"]').fill('Scratch — encryption check');
await page.locator('form.compose-form textarea').fill(BODY);
await page.locator('form.compose-form button[type="submit"]').click();
await page.waitForURL(/\/messages\/\d+/, { timeout: 15000 });
await settle(1200);
const threadUrl = page.url();
check('the sender lands on the thread after sending', /\/messages\/\d+/.test(threadUrl), threadUrl);
check(
	'the sender reads their own message back',
	(await page.locator('.body').first().innerText()).includes('Thursday at six'),
	await page.locator('.body').first().innerText()
);

await signIn(PIOTR);
check('the recipient can open the thread', await openAndWait(threadUrl, '.body'));
const received = (await page.locator('.body').first().innerText()).trim();
check('the recipient reads the words that were sent', received === BODY, received);
check(
	'nothing is rendered as unreadable',
	(await page.locator('.body--unavailable').count()) === 0
);
// The other half — that what is stored is NOT those words — is a column, not a pixel: see the
// server-side snippet in test.md, which this run leaves the message behind for.
console.log(`  (scratch thread ${threadUrl})`);

console.log(`\n${pass} passed, ${fail} failed, ${errors.length} console/page errors`);
if (errors.length) console.log(errors.slice(0, 8).join('\n'));
await page.screenshot({ path: 'e2e/screenshots/material-open-picture.png', fullPage: false });
await browser.close();
process.exit(fail || errors.length ? 1 : 0);
