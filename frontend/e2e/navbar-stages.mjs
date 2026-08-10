// End-to-end check of the navbar's staged collapse (NAVBAR-BRIEF.md) and the widened site search
// that two of its stages lean on.
//
// Run it with both servers up, same as events-and-nav.mjs:
//   node e2e/navbar-stages.mjs
//
// What only a browser can show here: that each stage actually fires at a narrower width than the
// one before it; that a collapsed link's icon twin appears in the action row, right of the dice, in
// nav order, with a real accessible name; that the search icon lands immediately left of the Add
// trigger; that the logo's disappearance is banded (back on the phone bar); that a signed-in
// person's language picker moves into the account menu while a guest keeps theirs in the row; and
// that the bar's height genuinely shrinks with the window rather than stepping.
//
// It signs in as a seeded demo user (kasia) for the reason booking.mjs records — registration is
// rate-limited per IP — and everything it creates is stamped with `RUN` and deleted at the end.
let chromium;
try {
	({ chromium } = await import('playwright'));
} catch {
	({ chromium } = await import('playwright-core'));
}

const BASE = process.env.E2E_BASE ?? 'http://localhost:5183';
const API = process.env.E2E_API ?? 'http://127.0.0.1:8000/api';
const PASSWORD = process.env.E2E_DEMO_PASSWORD ?? 'password123';
const HOST = 'kasia@edmat.example';
const RUN = Date.now();
const STAMP = `Navstage${RUN}`;
const SHOTS = process.env.E2E_SHOTS ?? '';

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

async function api(method, path, token, body) {
	const res = await fetch(`${API}${path}`, {
		method,
		headers: {
			'Content-Type': 'application/json',
			...(token ? { Authorization: `Token ${token}` } : {})
		},
		body: body ? JSON.stringify(body) : undefined
	});
	if (!res.ok && res.status !== 204) {
		throw new Error(`${method} ${path} -> ${res.status}: ${await res.text()}`);
	}
	return res.status === 204 ? null : res.json();
}

const browser = await chromium.launch(
	process.env.CHROME ? { executablePath: process.env.CHROME } : {}
);

function wire(page, name) {
	page.on('pageerror', (e) => errors.push(`[${name}] pageerror: ${e.message}`));
	page.on('console', (msg) => {
		if (msg.type() === 'error' && !/status of 40[139]\b/.test(msg.text())) {
			errors.push(`[${name}] console: ${msg.text()}`);
		}
	});
	return page;
}

const settle = (page, ms = 700) => page.waitForTimeout(ms);
async function goto(page, path) {
	await page.goto(`${BASE}${path}`, { waitUntil: 'networkidle' });
	await settle(page);
}
async function width(page, w) {
	await page.setViewportSize({ width: w, height: 900 });
	await settle(page, 250);
}
async function shot(page, name) {
	if (SHOTS) await page.screenshot({ path: `${SHOTS}/${name}.png` });
}

// ---- seats ---------------------------------------------------------------------------------------
const { token } = await api('POST', '/auth/login/', null, { username: HOST, password: PASSWORD });

const signedCtx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
const signed = wire(await signedCtx.newPage(), 'signed');
await signed.goto(`${BASE}/`, { waitUntil: 'domcontentloaded' });
await signed.evaluate((value) => localStorage.setItem('edmat-auth-token', value), token);
await goto(signed, '/');

const guestCtx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
const guest = wire(await guestCtx.newPage(), 'guest');
await goto(guest, '/');

const nav = (page, key) => page.locator(`.site-nav .nav-link--${key}`);
const collapsed = (page, key) => page.locator(`.collapsed--${key}`);

// ---- the full bar, before any stage --------------------------------------------------------------
console.log('[1] At 1280px nothing has collapsed');
for (const key of ['disciplines', 'materials', 'classroom', 'events', 'services']) {
	check(`the ${key} link is text`, await nav(signed, key).isVisible());
}
check('no collapsed icon is shown', !(await collapsed(signed, 'events').isVisible()));
check('the account trigger is the name', await signed.locator('.account-trigger__name').isVisible());
check('the logo is there', await signed.locator('.brand').isVisible());
check(
	'the language picker sits in the row',
	await signed.locator('.row-locale select').isVisible()
);
const heightAt = async (page) => (await page.locator('.site-header').boundingBox()).height;
const hWide = await heightAt(signed);
await shot(signed, 'stage0-1280');

// ---- the stages, in order ------------------------------------------------------------------------
console.log('[2] Stage 1 — Events becomes a calendar icon');
await width(signed, 1150);
check('the Events text is gone', !(await nav(signed, 'events').isVisible()));
check('the calendar icon appears', await collapsed(signed, 'events').isVisible());
check(
	'and carries an accessible name',
	(await collapsed(signed, 'events').getAttribute('aria-label')) === 'Events'
);
const dice = await signed.locator('.site-header__actions > :first-child').boundingBox();
const cal = await collapsed(signed, 'events').boundingBox();
check('and sits right of the dice', cal.x > dice.x, `dice ${dice.x} icon ${cal.x}`);

console.log('[3] Stage 2 — the account trigger becomes an icon');
await width(signed, 1100);
check('the name is gone', !(await signed.locator('.account-trigger__name').isVisible()));
check('an avatar/person icon shows', await signed.locator('.account-trigger__avatar').isVisible());

console.log('[4] Stage 4 — Materials becomes a book icon');
await width(signed, 1030);
check('the Materials text is gone', !(await nav(signed, 'materials').isVisible()));
check('the book icon appears', await collapsed(signed, 'materials').isVisible());

console.log('[5] Stage 4½ — Tutoring becomes a money icon');
await width(signed, 980);
check('the Tutoring text is gone', !(await nav(signed, 'services').isVisible()));
check('the money icon appears', await collapsed(signed, 'services').isVisible());
const bm = await collapsed(signed, 'materials').boundingBox();
const bc = await collapsed(signed, 'events').boundingBox();
const bs = await collapsed(signed, 'services').boundingBox();
check(
	'the cluster keeps nav order: book, calendar, money',
	bm.x < bc.x && bc.x < bs.x,
	`${bm.x} ${bc.x} ${bs.x}`
);
await shot(signed, 'stage4b-980');

console.log('[6] Stage 5 — the Add trigger keeps only its plus');
await width(signed, 930);
check('the Add label is gone', !(await signed.locator('.add-trigger__text').isVisible()));
check('the plus itself remains', await signed.locator('.add-trigger').isVisible());

console.log('[7] Stage 6 — Disciplines merges into a search icon, left of Add');
await width(signed, 880);
check('the Disciplines text is gone', !(await nav(signed, 'disciplines').isVisible()));
const search = signed.locator('.search-collapsed');
check('the search icon appears', await search.isVisible());
const sx = (await search.boundingBox()).x;
const ax = (await signed.locator('.add-trigger').boundingBox()).x;
check('immediately left of the Add trigger', sx < ax && ax - sx < 90, `search ${sx} add ${ax}`);

console.log('[8] Stage 7 — the logo disappears, and Home appears in the account menu');
await width(signed, 840);
check('the logo is gone', !(await signed.locator('.brand').isVisible()));
await signed.locator('.account-trigger').click();
await settle(signed, 300);
check('the account menu offers Home', await signed.locator('.menu-home').isVisible());
await shot(signed, 'stage7-840');

console.log('[9] Stage 8 — the language picker moves into the account menu (signed in)');
await width(signed, 790);
check('the row picker is gone', !(await signed.locator('.row-locale select').isVisible()));
check('the menu now holds it', await signed.locator('.menu-locale select').isVisible());
await signed.keyboard.press('Escape');
await settle(signed, 200);

console.log('[10] …while a guest keeps theirs in the row');
await width(guest, 790);
check(
	'a guest still has the row picker at 790px',
	await guest.locator('.row-locale select').isVisible()
);

console.log('[11] Stage 9 — Courses disappears');
await width(signed, 740);
check('the Courses text is gone', !(await nav(signed, 'classroom').isVisible()));

console.log('[12] Stage 10 — the drawer, and the brand comes back for it');
await width(signed, 700);
check('the drawer toggle is there', await signed.locator('.drawer-toggle').isVisible());
check('the nav row is gone', !(await signed.locator('.site-nav').isVisible()));
check('the brand is back on the phone bar', await signed.locator('.brand').isVisible());

console.log('[13] The bar shrinks linearly, not in steps');
await width(signed, 1000);
const hMid = await heightAt(signed);
await width(signed, 760);
const hNarrow = await heightAt(signed);
check(
	`height falls with width (${hWide} > ${hMid} > ${hNarrow})`,
	hWide > hMid && hMid > hNarrow
);

console.log('[14] A collapsed icon still navigates');
await width(signed, 880);
await collapsed(signed, 'events').click();
await settle(signed, 900);
check('the calendar icon opens /events', signed.url().includes('/events'));
await signed.locator('.search-collapsed').click();
await settle(signed, 900);
check('the search icon opens /search', signed.url().includes('/search'));

// ---- the widened search --------------------------------------------------------------------------
console.log('[15] Search now reaches courses, events, tutoring, and the taxonomy');
const course = await api('POST', '/courses/', token, {
	title: `${STAMP} course`,
	summary: 'navbar stage check',
	visibility: 'public',
	status: 'open'
});
const service = await api('POST', '/services/', token, {
	title: `${STAMP} tutoring`,
	description: 'navbar stage check'
});
const starts = new Date(Date.now() + 3 * 864e5).toISOString();
const event = await api('POST', '/events/', token, {
	title: `${STAMP} event`,
	description: 'navbar stage check',
	status: 'published',
	starts_at: starts,
	duration_minutes: 60,
	location_kind: 'onsite',
	location_text: 'room 1'
});

await width(signed, 1280);
await goto(signed, `/search?q=${STAMP}`);
const body = await signed.locator('.search-page').innerText();
check('the course is found', body.includes(`${STAMP} course`));
check('the tutoring listing is found', body.includes(`${STAMP} tutoring`));
check('the event is found', body.includes(`${STAMP} event`));
// The stamp is unique, so exactly these three may match — anything more means a backend `?q=` is
// not filtering and the three checks above passed vacuously on an unfiltered list. This is not a
// hypothetical: the first run of this script did exactly that, against a server that predated the
// filters, and only the screenshot showed it.
check('and nothing else matches the stamp', body.includes('Found: 3'), body.split('\n')[2] ?? '');

await goto(signed, '/search?q=matematyka');
check(
	'a discipline is found by name',
	await signed.locator('.taxonomy-hits a', { hasText: 'Matematyka' }).first().isVisible()
);
await shot(signed, 'search-wide');

// ---- cleanup -------------------------------------------------------------------------------------
await api('DELETE', `/courses/${course.id}/`, token);
await api('DELETE', `/services/${service.id}/`, token);
await api('DELETE', `/events/${event.id}/`, token);

await browser.close();

console.log(`\n${pass} passed, ${fail} failed`);
if (errors.length) {
	console.log('console/page errors:');
	for (const e of errors) console.log(`  ${e}`);
} else {
	console.log('zero console/page errors');
}
process.exit(fail || errors.length ? 1 : 0);
