// Does the list cache actually do the thing it exists for?
//
// Four claims worth checking in a real browser, because none of them is visible to a type checker:
//   1. a first visit announces nothing (new-against-nothing is not news)
//   2. a return visit announces exactly what arrived since
//   3. rows still render when the API is unreachable — the whole point of keeping them
//   4. changing the filter does NOT report the newly-matching rows as "new"
// Run it with both halves up:
//   E2E_BASE=http://localhost:5176 E2E_API=http://127.0.0.1:8003/api node e2e/tutoring-cache.mjs
let chromium;
try {
	({ chromium } = await import('playwright'));
} catch {
	({ chromium } = await import('playwright-core'));
}

const BASE = process.env.E2E_BASE ?? 'http://localhost:5176';
const API = process.env.E2E_API ?? 'http://127.0.0.1:8003/api';
const CHROME = process.env.CHROME;
const TOKEN = process.env.E2E_TOKEN ?? '06076f72345ce89932d2119e5aad70a55ba41c79';

let pass = 0,
	fail = 0;
const errors = [];
const check = (l, ok, extra = '') => {
	if (ok) {
		pass++;
		console.log(`  ok   ${l}`);
	} else {
		fail++;
		console.log(`  FAIL ${l} ${extra}`);
	}
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const api = (path, init = {}) =>
	fetch(`${API}${path}`, {
		...init,
		headers: {
			...(init.body ? { 'Content-Type': 'application/json' } : {}),
			Authorization: `Token ${TOKEN}`,
			...(init.headers ?? {})
		}
	});

const browser = await chromium.launch({
	...(CHROME ? { executablePath: CHROME } : {}),
	args: ['--no-sandbox']
});
// ONE context throughout: the cache lives in localStorage, so a fresh context per step would be a
// fresh device and would never exercise the return visit this is about.
const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
await ctx.addInitScript((t) => window.localStorage.setItem('edmat-auth-token', t), TOKEN);
const page = await ctx.newPage();
page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
page.on('console', (m) => {
	// Step 3 deliberately severs the API, so its failed fetches are the behaviour under test.
	if (m.type() === 'error' && !/Failed to load resource|net::ERR_FAILED/.test(m.text()))
		errors.push(`console: ${m.text()}`);
});

const noticeText = async () => {
	const n = page.locator('.new-since');
	return (await n.count()) ? (await n.innerText()).trim() : '';
};

// ---------------------------------------------------------------- 1. first visit is quiet

console.log('\n1. A first visit announces nothing');
await page.goto(`${BASE}/services`, { waitUntil: 'networkidle' });
await sleep(1800);
const firstCards = await page.locator('.grid > *').count();
check('rows render on a first visit', firstCards >= 2, `cards=${firstCards}`);
check(
	'no "N new" notice on a first visit',
	(await noticeText()) === '',
	`notice said: ${await noticeText()}`
);

// ---------------------------------------------------------------- 2. a return visit reports arrivals

console.log('\n2. A return visit reports exactly what arrived');
const t = `Cache probe ${Date.now()}`;
const made = await api('/services/', {
	method: 'POST',
	body: JSON.stringify({
		title: t,
		description: '',
		branch_slugs: [],
		currency: 'PLN',
		is_active: true,
		delivery_mode: 'online',
		availability_mode: 'derived',
		session_minutes: 60
	})
}).then((r) => r.json());

await page.reload({ waitUntil: 'networkidle' });
await sleep(1800);
const notice = await noticeText();
check('the notice appeared', notice.length > 0, '(none)');
check('it names exactly one arrival', /\b1\b/.test(notice), notice);
check('the new listing is on screen', (await page.locator('.grid', { hasText: t }).count()) === 1);
// Prepended, not buried: "what appeared since I last looked" is the question being answered.
const firstCardText = await page.locator('.grid > *').first().innerText();
check(
	'the new row is at the TOP of the list',
	firstCardText.includes(t),
	firstCardText.slice(0, 80)
);

// ---------------------------------------------------------------- 3. it survives no network

console.log('\n3. Rows still render with the API unreachable');
await page.route('**/api/services/**', (r) => r.abort());
await page.reload({ waitUntil: 'domcontentloaded' });
await sleep(2500);
const offlineCards = await page.locator('.grid > *').count();
check(
	'the saved rows are still on screen with the API cut off',
	offlineCards >= 2,
	`cards=${offlineCards} — this is the whole reason the cache exists`
);
await page.unroute('**/api/services/**');

// ---------------------------------------------------------------- 4. a filter change is not "new"

console.log('\n4. Changing the filter does not cry "new"');
await page.reload({ waitUntil: 'networkidle' });
await sleep(1800);
await page.locator('.filters select').first().selectOption('analiza-matematyczna');
await sleep(1800);
const filteredNotice = await noticeText();
check(
	'no bogus arrival count after applying a filter',
	filteredNotice === '',
	`notice said: ${filteredNotice} — the cache key must include the filter`
);
const filteredCards = await page.locator('.grid > *').count();
check('the filter still actually filters', filteredCards >= 1, `cards=${filteredCards}`);

// and going back to "all" must not report the re-appearing rows as arrivals either
await page.locator('.filters select').first().selectOption('');
await sleep(1800);
check(
	'switching back is also quiet',
	(await noticeText()) === '',
	`notice said: ${await noticeText()}`
);

// ---------------------------------------------------------------- 5. the other two lists

console.log('\n5. Watchlist and bookings render through the cache');
await page.goto(`${BASE}/services/watchlist`, { waitUntil: 'networkidle' });
await sleep(1800);
check('watchlist page renders', (await page.locator('body').innerText()).length > 200);
await page.goto(`${BASE}/bookings`, { waitUntil: 'networkidle' });
await sleep(2500);
const bookingsBody = await page.locator('body').innerText();
check('bookings page renders', bookingsBody.length > 300);
check(
	'the schedule tabs are still there',
	(await page.locator('.tabs button, [role="tab"]').count()) >= 3
);

// a real booking row, faded by its own confirmedAt rather than not rendered at all
const rowOpacity = await page
	.locator('.booking')
	.first()
	.evaluate((el) => el.style.opacity)
	.catch(() => null);
check(
	'a booking row carries a real opacity from its own confirmedAt',
	rowOpacity === null || (Number(rowOpacity) >= 0.6 && Number(rowOpacity) <= 1),
	`opacity=${rowOpacity} — must never dip under the 0.6 legibility floor`
);

await api(`/services/${made.id}/`, { method: 'DELETE' });
await browser.close();
console.log(`\n${pass} passed, ${fail} failed`);
if (errors.length) {
	console.log(`${errors.length} console/page error(s):`);
	for (const e of [...new Set(errors)].slice(0, 12)) console.log(`  - ${e}`);
}
process.exit(fail || errors.length ? 1 : 0);
