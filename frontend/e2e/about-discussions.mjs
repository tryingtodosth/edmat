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
// says a script that needs mutable state must — and it CLEARS UP AFTER ITSELF at the end, which
// is what lets the collapsed line's count be asserted exactly rather than as ">= 1". The two
// comments it writes are removed the two ways this platform actually has (house rule 12 forbids a
// hard delete and no endpoint was added for one): the signed-in one by its own author
// (`DELETE /api/comments/{id}/`, a tombstone), the anonymous one — which was HELD and so was never
// public — by staff through the report queue the hold already filed. Neither a tombstone nor a
// held row is counted anywhere (`community/discussions.py`, "What \"N comments\" counts"), so the
// count comes back to exactly the number this run started from.
let chromium;
try {
	({ chromium } = await import('playwright-core'));
} catch {
	console.error('playwright-core is not installed');
	process.exit(1);
}

const BASE = process.env.E2E_BASE ?? 'http://localhost:5173';
const API = process.env.E2E_API ?? 'http://localhost:8000';
const STAFF = {
	username: process.env.E2E_STAFF ?? 'admin',
	password: process.env.E2E_STAFF_PW ?? 'password123'
};
const PLAIN = {
	username: process.env.E2E_USER ?? 'student1',
	password: process.env.E2E_USER_PW ?? 'password123'
};

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
	return {
		status: res.status,
		body: res.status === 204 ? null : await res.json().catch(() => null)
	};
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
		return (
			await api(`/discussion-locations/${row.id}/`, {
				method: 'PATCH',
				body: settings,
				tok: staffToken
			})
		).body;
	}
	return (
		await api('/discussion-locations/', {
			method: 'POST',
			body: { page, section, ...settings },
			tok: staffToken
		})
	).body;
}

console.log('\n== policies through the API ==');
const open = await locationFor('about', 'mission', {
	audience: 'users',
	moderated: false,
	is_enabled: true
});
check(
	'a location can be created and read back',
	open?.key === 'about#mission',
	JSON.stringify(open)
);

const anon = await locationFor('about', 'origin', {
	audience: 'anyone',
	moderated: false,
	is_enabled: true
});
check('a location can be set to `anyone`', anon?.audience === 'anyone', JSON.stringify(anon));

const verified = await locationFor('about', 'features', { audience: 'verified', is_enabled: true });
check(
	'a location can be set to `verified`',
	verified?.audience === 'verified',
	JSON.stringify(verified)
);

const closed = await locationFor('about', 'closing', { is_enabled: false });
check('a location can be switched off', closed?.is_enabled === false, JSON.stringify(closed));

/** The number the collapsed line prints for one section of /about, read from the server.
 *
 * Authenticated on purpose (`e2e/CLAUDE.md` trap 12): an anonymous GET can be answered from the
 * 60s read cache, and a count read through it would be the count before this script wrote
 * anything. `comment_count` is public comments only — not tombstones, not held ones — which is the
 * same rule all three places that print a number here follow. */
async function publicCount(section) {
	const res = await api(`/discussions/?page=about&sections=${section}`, { tok: staffToken });
	const row = (res.body?.locations ?? []).find((l) => l.section === section);
	return row?.comment_count ?? 0;
}
// Read BEFORE anything is written, so the assertion further down is against a number this run
// computed rather than against whatever previous runs left behind.
const missionBefore = await publicCount('mission');
const originBefore = await publicCount('origin');
console.log(`  (before: about#mission ${missionBefore}, about#origin ${originBefore})`);

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
const page = await ctx.newPage();
page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
// `e2e/CLAUDE.md` trap 26: in a WORKTREE `frontend/node_modules` is a symlink outside Vite's
// `server.fs.allow`, so KaTeX's webfonts 403 on the dev server — and the console line for a
// refused request carries no URL in its text, so it can only be matched on the `response` event.
// The moderation queue draws every report preview through `MathTitle`, so this script meets them
// the moment it opens that page. Counted and subtracted, never silently dropped: the number is
// printed with the summary.
let refusedFonts = 0;
let ignoredFontErrors = 0;
page.on('response', (r) => {
	if (r.status() === 403 && /katex\/dist\/fonts\//.test(r.url())) refusedFonts++;
});
page.on('console', (m) => {
	if (m.type() !== 'error') return;
	if (refusedFonts > 0 && /Failed to load resource/i.test(m.text())) {
		refusedFonts--;
		ignoredFontErrors++;
		return;
	}
	errors.push(`console: ${m.text()}`);
});

// Every request to the thread endpoint, so "not fetched until clicked" is asserted on the network
// rather than on the absence of DOM — which would also pass if the fetch had happened and failed.
const threadCalls = [];
page.on('request', (r) => {
	if (r.url().includes('/api/discussions/thread/')) threadCalls.push(`${r.method()} ${r.url()}`);
});

console.log('\n== an anonymous reader on /about ==');
await page.goto(`${BASE}/about`, { waitUntil: 'load' });
// 60s, not 15: on a cold Vite dev server /about's module graph is compiled on this first request,
// and on a loaded machine that is minutes rather than seconds. A production build is not this
// slow; the timeout is about the dev server, not about the page.
await page.waitForSelector('.section-discussion__toggle', { timeout: 60000 });
const toggles = await page.locator('.section-discussion__toggle').count();
check('collapsed lines are drawn, one per open section', toggles >= 3, `found ${toggles}`);
check('no thread is fetched before a click', threadCalls.length === 0, threadCalls.join(' | '));

// The switched-off location must draw nothing at all — not a disabled line (house rule 3).
const closingToggle = page.locator('.section-discussion__toggle', {
	hasText: /Closing|Na koniec|Zacznij/i
});
check('a switched-off location draws no affordance', (await closingToggle.count()) === 0);

console.log('\n== opening a thread ==');
// Wait for the RESPONSE, not just for the panel: the panel appears instantly carrying
// "Loading…", and asserting against it is how the first run of this script reported a missing
// composer that was simply not drawn yet (e2e/CLAUDE.md trap 25 — waiting for an element proves
// nothing about whether it is finished).
const originToggle = page
	.locator('.section-discussion')
	.nth(1)
	.locator('.section-discussion__toggle');
const threadLoaded = page.waitForResponse((r) => r.url().includes('/api/discussions/thread/'));
await originToggle.click();
await threadLoaded;
await page.waitForSelector('.section-discussion__body', { timeout: 10000 });
await page
	.locator('.section-discussion__body')
	.first()
	.getByText(/Wczytywanie|Loading/)
	.waitFor({ state: 'detached', timeout: 10000 })
	.catch(() => {});
check('one thread request after one click', threadCalls.length === 1, threadCalls.join(' | '));

// Since 2026-10-09 the box is not on the page until somebody asks for it, and the visitor's name
// field lives INSIDE it — so this is asserted first and then opened, and the two checks below read
// the open composer.
check(
	'no input box until it is asked for',
	(await page
		.locator('.section-discussion__body textarea, .section-discussion__body .ProseMirror')
		.count()) === 0
);
await page.locator('.section-discussion__body .comment-form__open').first().click();

// `about#origin` is `anyone`, so a visitor gets a composer AND the name field.
const nameField = page.locator('.section-discussion__name input');
check(
	'a visitor gets a name field where the audience is `anyone`',
	(await nameField.count()) === 1
);
const composer = page
	.locator('.section-discussion__body')
	.locator('button', { hasText: /Post|Opublikuj|Dodaj/i });
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
const staffThread = await api('/discussions/thread/?page=about&section=origin', {
	tok: staffToken
});
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
check(
	'and is not held on an unmoderated location',
	posted.body?.is_held === false,
	JSON.stringify(posted.body)
);

const refused = await api('/discussions/thread/', {
	method: 'POST',
	body: { page: 'about', section: 'features', body: 'Should be refused.' },
	tok: plainToken
});
check(
	'an unverified reader is refused where the audience is `verified`',
	refused.status === 403,
	`${refused.status}`
);
check(
	'and the refusal carries its word',
	refused.body?.detail === 'verification_required',
	JSON.stringify(refused.body)
);

// The rest of this section is about what a SIGNED-IN, unverified reader sees, so the browser has
// to be signed in too — an earlier version of this script checked it as a visitor and "failed" on
// the anonymous sentence, which was the correct answer to a different question. The token goes
// straight into the store's own key rather than driving the login form: this script is not about
// signing in, and the form has its own script.
await page.addInitScript((tok) => localStorage.setItem('edmat-auth-token', tok), plainToken);
await page.goto(`${BASE}/about`, { waitUntil: 'load' });
await page.waitForSelector('.section-discussion__toggle', { timeout: 30000 });
const missionToggle = page
	.locator('.section-discussion')
	.first()
	.locator('.section-discussion__toggle');
const missionLabel = (await missionToggle.textContent()) ?? '';
// THE count, not a count. The script read `missionBefore` from the server before it wrote
// anything and has written exactly one public comment at this location since, and it removes that
// comment again at the end — so this number is reproducible across runs.
const shown = missionLabel.match(/\((\d+)\)/);
const expectedMission = missionBefore + 1;
check(
	`the collapsed line carries the exact count (${expectedMission})`,
	shown !== null && Number(shown[1]) === expectedMission,
	missionLabel.trim()
);
const missionLoaded = page.waitForResponse((r) => r.url().includes('/api/discussions/thread/'));
await missionToggle.click();
await missionLoaded;
await page
	.locator('.section-discussion__body')
	.first()
	.getByText(/Wczytywanie|Loading/)
	.waitFor({ state: 'detached', timeout: 10000 })
	.catch(() => {});
const bodyText = (await page.locator('.section-discussion__body').first().textContent()) ?? '';
check(
	'the comment is rendered in the thread',
	bodyText.includes('A real question about the mission'),
	bodyText.slice(0, 160)
);

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
await page.screenshot({
	path: 'e2e/screens/about-discussions-2-thread-and-refusal.png',
	fullPage: false
});

console.log('\n== a manual chapter has one thread of its own ==');
await page.goto(`${BASE}/about/guide/courses`, { waitUntil: 'load' });
await page.waitForSelector('.section-discussion__toggle', { timeout: 30000 });
check(
	'the chapter draws exactly one discussion',
	(await page.locator('.section-discussion__toggle').count()) === 1
);

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

console.log('\n== the held count is a link into the queue ==');
// A moderator who can see "Waiting: 1" has to be able to reach the one. The link is
// `/moderation?tab=reports&location=<key>` and it carries `data-sveltekit-reload`, because this
// panel lives inside /moderation and both query parameters are read once at that page's mount.
await page.addInitScript((tok) => localStorage.setItem('edmat-auth-token', tok), staffToken);
const locationsLoaded = page.waitForResponse((r) => r.url().includes('/api/discussion-locations/'));
await page.goto(`${BASE}/moderation?tab=discussions`, { waitUntil: 'load' });
await locationsLoaded;
await page.waitForSelector('.location-row', { timeout: 20000 });
const heldLink = page
	.locator('.location-row', { hasText: 'about#origin' })
	.locator('a.location-row__held');
check('the held count in the panel is a link', (await heldLink.count()) === 1);
// Scrolled into view first: the panel sits under ten tab buttons and a form, and a screenshot of
// the top of the page is a screenshot of something else (house rule 2 — look at it).
await heldLink.first().scrollIntoViewIfNeeded();
await page.screenshot({
	path: 'e2e/screens/about-discussions-4-held-count-link.png',
	fullPage: false
});

await heldLink.first().click();
await page.waitForSelector('.location-filter', { timeout: 20000 });
check(
	'it lands on the Reports tab, filtered to that location',
	page.url().includes('tab=reports') && page.url().includes('location=about%23origin'),
	page.url()
);
const filterLine = (await page.locator('.location-filter').textContent()) ?? '';
check('and the filter says so, visibly', /about#origin/.test(filterLine), filterLine.trim());
// How many rows SHOULD be there, computed from the same queue the page fetched: earlier runs of
// this script left held comments at this location before it learned to clear up, so "exactly one"
// would be an assertion about the database rather than about the filter.
const queuePayload = await api('/moderation/queue/', { tok: staffToken });
const allRows = queuePayload.body?.reports ?? [];
const expectedRows = allRows.filter((r) => r.discussion_location === 'about#origin').length;
const queueText =
	(await page
		.locator('.queue')
		.textContent()
		.catch(() => '')) ?? '';
const queued = await page.locator('.queue-item').count();
check(
	`report rows carry their location (${expectedRows} of ${allRows.length} at about#origin)`,
	expectedRows >= 1 && expectedRows < allRows.length,
	`${expectedRows}/${allRows.length}`
);
check(
	`only that location’s held comments are listed (${expectedRows})`,
	queued === expectedRows && queueText.includes('A question from a visitor'),
	`${queued} row(s): ${queueText.slice(0, 160)}`
);
await page.screenshot({
	path: 'e2e/screens/about-discussions-5-reports-filtered.png',
	fullPage: false
});

await browser.close();

console.log('\n== the script clears up after itself ==');
// The signed-in comment: its own author may delete it, which is a tombstone and not a row delete
// (house rule 12). A tombstone is not counted, so the count goes back down.
const deleted = await api(`/comments/${posted.body?.id}/`, { method: 'DELETE', tok: plainToken });
check(
	'the signed-in comment is deleted by its author',
	deleted.status === 200,
	`${deleted.status}`
);
// The anonymous one was held, so it was never public and never counted — but leaving it would
// grow the moderator's "Waiting" number by one per run. Staff remove it through the report queue
// `hold_for_review` already filed for it; no endpoint was added for this.
const purged = await api(`/moderation/reports/comment/${held.body?.id}/remove/`, {
	method: 'POST',
	body: { resolved_note: 'about-discussions.mjs cleanup' },
	tok: staffToken
});
check(
	'the held anonymous comment is removed through the report queue',
	purged.status === 200,
	`${purged.status}`
);

// Re-queried AUTHENTICATED (trap 12), and as staff — who see held comments as well, so "nothing of
// this script's is left" is checked against the widest view there is.
const missionAfter = await publicCount('mission');
check(
	`about#mission is back to ${missionBefore}`,
	missionAfter === missionBefore,
	`${missionAfter}`
);
const originAfter = await publicCount('origin');
check(`about#origin is back to ${originBefore}`, originAfter === originBefore, `${originAfter}`);

// By ID, not by text: runs from before this script learned to clear up left comments with the
// same words at the same locations, and "did THIS run leave anything" is the question.
const leftovers = [];
for (const [section, id] of [
	['mission', posted.body?.id],
	['origin', held.body?.id]
]) {
	const after = await api(`/discussions/thread/?page=about&section=${section}`, {
		tok: staffToken
	});
	const row = (after.body?.comments ?? []).find((c) => String(c.id) === String(id));
	// Present is fine — a tombstone keeps a thread's shape (house rule 12). Readable is not.
	if (row && (!row.is_removed || row.body)) leftovers.push(`${section}: ${id} still readable`);
}
check(
	'no visible comment of this run is left behind',
	leftovers.length === 0,
	leftovers.join(' | ')
);

console.log(
	`\n${pass} passed, ${fail} failed, ${errors.length} console/page errors` +
		` (${ignoredFontErrors} KaTeX webfont 403s ignored — trap 26, worktree only)`
);
for (const e of errors.slice(0, 8)) console.log('  ' + e);
process.exit(fail || errors.length ? 1 : 0);
