// Discussions under the standing pages (`backend/community/discussions.py`, HISTORY §17BS).
//
// Run: E2E_BASE=http://localhost:5173 E2E_API=http://localhost:8000 node e2e/about-discussions.mjs
//
// What it drives, in the order a reader would meet it: the collapsed line is there and the thread
// is NOT loaded until it is clicked (asserted on the network, not on the DOM); a signed-in comment
// appears at once; a location set to `anyone` offers a visitor a composer and a name field and
// holds what they write; a location set to `verified` shows a signed-in-but-unverified reader the
// right sentence rather than a form; and the whole surface disappears when the flag goes off
// (house rule 3).
//
// It resets its own locations through the real API at the start, because `e2e/CLAUDE.md` trap 1
// says a script that needs mutable state must.
let chromium;
try {
	({ chromium } = await import('playwright-core'));
} catch {
	console.error('playwright-core is not installed');
	process.exit(1);
}

const BASE = process.env.E2E_BASE ?? 'http://localhost:5173';
const API = process.env.E2E_API ?? 'http://localhost:8000';
const STAFF = { username: process.env.E2E_STAFF ?? 'admin', password: process.env.E2E_STAFF_PW ?? 'password123' };
const PLAIN = { username: process.env.E2E_USER ?? 'student1', password: process.env.E2E_USER_PW ?? 'password123' };

let pass = 0,
	fail = 0;
const errors = [];
const check = (label, ok, detail = '') => {
	if (ok) pass++;
	else fail++;
	console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${label}${ok ? '' : '  <- ' + detail}`);
};

async function token(who) {
	const res = await fetch(`${API}/api/auth/login/`, {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify(who)
	});
	if (!res.ok) throw new Error(`login ${who.username} -> ${res.status}`);
	return (await res.json()).token;
}

async function api(path, { method = 'GET', body, tok } = {}) {
	const res = await fetch(`${API}/api${path}`, {
		method,
		headers: {
			'Content-Type': 'application/json',
			...(tok ? { Authorization: `Token ${tok}` } : {})
		},
		...(body === undefined ? {} : { body: JSON.stringify(body) })
	});
	return { status: res.status, body: res.status === 204 ? null : await res.json().catch(() => null) };
}

const staffToken = await token(STAFF);

// --- the flag, and a clean set of locations --------------------------------------------------
async function setFlag(on) {
	await api('/feature-flags/about_discussions/', {
		method: 'PATCH',
		body: { is_enabled: on },
		tok: staffToken
	});
}
await setFlag(true);

async function locationFor(page, section, settings) {
	const existing = await api('/discussion-locations/', { tok: staffToken });
	const row = (existing.body ?? []).find((r) => r.page === page && r.section === section);
	if (row) {
		return (await api(`/discussion-locations/${row.id}/`, { method: 'PATCH', body: settings, tok: staffToken })).body;
	}
	return (await api('/discussion-locations/', { method: 'POST', body: { page, section, ...settings }, tok: staffToken })).body;
}

console.log('\n== policies through the API ==');
const open = await locationFor('about', 'mission', { audience: 'users', moderated: false, is_enabled: true });
check('a location can be created and read back', open?.key === 'about#mission', JSON.stringify(open));

const anon = await locationFor('about', 'origin', { audience: 'anyone', moderated: false, is_enabled: true });
check('a location can be set to `anyone`', anon?.audience === 'anyone', JSON.stringify(anon));

const verified = await locationFor('about', 'features', { audience: 'verified', is_enabled: true });
check('a location can be set to `verified`', verified?.audience === 'verified', JSON.stringify(verified));

const closed = await locationFor('about', 'closing', { is_enabled: false });
check('a location can be switched off', closed?.is_enabled === false, JSON.stringify(closed));

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
const page = await ctx.newPage();
page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
page.on('console', (m) => {
	if (m.type() === 'error') errors.push(`console: ${m.text()}`);
});

// Every request to the thread endpoint, so "not fetched until clicked" is asserted on the network
// rather than on the absence of DOM — which would also pass if the fetch had happened and failed.
const threadCalls = [];
page.on('request', (r) => {
	if (r.url().includes('/api/discussions/thread/')) threadCalls.push(`${r.method()} ${r.url()}`);
});

console.log('\n== an anonymous reader on /about ==');
await page.goto(`${BASE}/about`, { waitUntil: 'load' });
await page.waitForSelector('.section-discussion__toggle', { timeout: 15000 });
const toggles = await page.locator('.section-discussion__toggle').count();
check('collapsed lines are drawn, one per open section', toggles >= 3, `found ${toggles}`);
check('no thread is fetched before a click', threadCalls.length === 0, threadCalls.join(' | '));

// The switched-off location must draw nothing at all — not a disabled line (house rule 3).
const closingToggle = page.locator('.section-discussion__toggle', { hasText: /Closing|Na koniec|Zacznij/i });
check('a switched-off location draws no affordance', (await closingToggle.count()) === 0);

console.log('\n== opening a thread ==');
// Wait for the RESPONSE, not just for the panel: the panel appears instantly carrying
// "Loading…", and asserting against it is how the first run of this script reported a missing
// composer that was simply not drawn yet (e2e/CLAUDE.md trap 25 — waiting for an element proves
// nothing about whether it is finished).
const originToggle = page.locator('.section-discussion').nth(1).locator('.section-discussion__toggle');
const threadLoaded = page.waitForResponse((r) => r.url().includes('/api/discussions/thread/'));
await originToggle.click();
await threadLoaded;
await page.waitForSelector('.section-discussion__body', { timeout: 10000 });
await page.locator('.section-discussion__body').first().getByText(/Wczytywanie|Loading/).waitFor({ state: 'detached', timeout: 10000 }).catch(() => {});
check('one thread request after one click', threadCalls.length === 1, threadCalls.join(' | '));

// `about#origin` is `anyone`, so a visitor gets a composer AND the name field.
const nameField = page.locator('.section-discussion__name input');
check('a visitor gets a name field where the audience is `anyone`', (await nameField.count()) === 1);
const composer = page.locator('.section-discussion__body').locator('button', { hasText: /Post|Opublikuj|Dodaj/i });
check('a visitor gets a composer where the audience is `anyone`', (await composer.count()) >= 1);

await page.screenshot({ path: 'e2e/screens/about-discussions-1-anon-open.png', fullPage: false });

console.log('\n== a visitor writes, and it is held ==');
const held = await api('/discussions/thread/', {
	method: 'POST',
	body: { page: 'about', section: 'origin', body: 'A question from a visitor.', anon_name: 'Kasia' }
});
check('an anonymous comment is accepted', held.status === 201, `${held.status}`);
check('and comes back marked held', held.body?.is_held === true, JSON.stringify(held.body));

const publicThread = await api('/discussions/thread/?page=about&section=origin');
check(
	'a held comment is invisible to everybody else',
	(publicThread.body?.comments ?? []).every((c) => c.body !== 'A question from a visitor.'),
	JSON.stringify(publicThread.body?.comments)
);
const staffThread = await api('/discussions/thread/?page=about&section=origin', { tok: staffToken });
check(
	'and visible to staff, who have to decide about it',
	(staffThread.body?.comments ?? []).length >= 1,
	JSON.stringify(staffThread.body?.comments)
);

console.log('\n== a signed-in reader ==');
const plainToken = await token(PLAIN);
const posted = await api('/discussions/thread/', {
	method: 'POST',
	body: { page: 'about', section: 'mission', body: 'A real question about the mission.' },
	tok: plainToken
});
check('a signed-in comment is accepted', posted.status === 201, `${posted.status}`);
check('and is not held on an unmoderated location', posted.body?.is_held === false, JSON.stringify(posted.body));

const refused = await api('/discussions/thread/', {
	method: 'POST',
	body: { page: 'about', section: 'features', body: 'Should be refused.' },
	tok: plainToken
});
check('an unverified reader is refused where the audience is `verified`', refused.status === 403, `${refused.status}`);
check('and the refusal carries its word', refused.body?.detail === 'verification_required', JSON.stringify(refused.body));

// The rest of this section is about what a SIGNED-IN, unverified reader sees, so the browser has
// to be signed in too — an earlier version of this script checked it as a visitor and "failed" on
// the anonymous sentence, which was the correct answer to a different question. The token goes
// straight into the store's own key rather than driving the login form: this script is not about
// signing in, and the form has its own script.
await page.addInitScript((tok) => localStorage.setItem('edmat-auth-token', tok), plainToken);
await page.goto(`${BASE}/about`, { waitUntil: 'load' });
await page.waitForSelector('.section-discussion__toggle', { timeout: 30000 });
const missionToggle = page.locator('.section-discussion').first().locator('.section-discussion__toggle');
const missionLabel = (await missionToggle.textContent()) ?? '';
// A count, not THE count: this script leaves its comments behind (there is no delete endpoint for
// a standing-page thread yet — `todo.md`), so a re-run legitimately sees more than one.
const shown = missionLabel.match(/\((\d+)\)/);
check('the collapsed line carries the count', shown !== null && Number(shown[1]) >= 1, missionLabel.trim());
const missionLoaded = page.waitForResponse((r) => r.url().includes('/api/discussions/thread/'));
await missionToggle.click();
await missionLoaded;
await page.locator('.section-discussion__body').first().getByText(/Wczytywanie|Loading/).waitFor({ state: 'detached', timeout: 10000 }).catch(() => {});
const bodyText = (await page.locator('.section-discussion__body').first().textContent()) ?? '';
check('the comment is rendered in the thread', bodyText.includes('A real question about the mission'), bodyText.slice(0, 160));

const featuresDiscussion = page.locator('.section-discussion').nth(2);
const featuresLoaded = page.waitForResponse((r) => r.url().includes('/api/discussions/thread/'));
await featuresDiscussion.locator('.section-discussion__toggle').click();
await featuresLoaded;
await page.waitForTimeout(500);
const refusalText = (await featuresDiscussion.textContent()) ?? '';
check(
	'a signed-in but unverified reader gets the verified-only sentence, not a composer',
	/zweryfikowani|verified contributors/i.test(refusalText),
	refusalText.slice(0, 200)
);
check(
	'and no composer is drawn for them',
	(await featuresDiscussion.locator('.section-discussion__name input').count()) === 0
);
await page.screenshot({ path: 'e2e/screens/about-discussions-2-thread-and-refusal.png', fullPage: false });

console.log('\n== a manual chapter has one thread of its own ==');
await page.goto(`${BASE}/about/guide/courses`, { waitUntil: 'load' });
await page.waitForSelector('.section-discussion__toggle', { timeout: 30000 });
check('the chapter draws exactly one discussion', (await page.locator('.section-discussion__toggle').count()) === 1);

console.log('\n== the kill switch ==');
await setFlag(false);
await page.goto(`${BASE}/about`, { waitUntil: 'load' });
await page.waitForTimeout(2500);
check(
	'with the flag off, no affordance anywhere on the page',
	(await page.locator('.section-discussion__toggle').count()) === 0
);
const offPolicy = await api('/discussions/?page=about&sections=mission');
check(
	'and the policy endpoint still answers, saying it is off',
	offPolicy.status === 200 && offPolicy.body?.locations?.every((l) => l.is_enabled === false),
	JSON.stringify(offPolicy.body)
);
await setFlag(true);

await page.screenshot({ path: 'e2e/screens/about-discussions-3-flag-off.png', fullPage: false });
await browser.close();

console.log(`\n${pass} passed, ${fail} failed, ${errors.length} console/page errors`);
for (const e of errors.slice(0, 8)) console.log('  ' + e);
process.exit(fail || errors.length ? 1 : 0);
