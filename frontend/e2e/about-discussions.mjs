// Discussions under the standing pages (`backend/community/discussions.py`, HISTORY §17BS).
//
// Run: E2E_BASE=http://localhost:5173 E2E_API=http://localhost:8000 node e2e/about-discussions.mjs
//
// **What `/about` draws now** (rewritten 2026-10-15). Since `/about` became the EdMat
// organisation's page (owner, 2026-10-07/08) it keeps exactly ONE location of its own from the old
// brochure: `about#money-and-openness`, the section the research thread is seeded under
// (`work/edmat_research_thread.json`). The brochure's `mission` / `origin` / `features` / `closing`
// keys are no longer drawn, and this script used to drive all four — it failed on "collapsed
// lines… found 2" and then timed out waiting for a third. The second line it found is NOT an
// `/about` location: it is the organisation description's own row discussion
// (`OrganizationPage` → `RowDiscussion`), which `e2e/management-discussions.mjs` covers; the
// `/about` checks below are scoped to `article.about` so they count the page's own sections only.
//
// One location therefore plays every policy in turn, set through the real API between phases:
// `anyone` (a visitor gets a composer and a name field, and what they write is held), `users` (a
// signed-in comment appears, and the collapsed line carries the exact count), `verified` (a
// signed-in-but-unverified reader gets the right sentence rather than a form), and switched off
// (no affordance at all). Then the whole surface disappears when the flag goes off (house rule 3).
//
// The location's ORIGINAL policy is read first and put back at the end, even when a check throws
// — it is the real research thread's location, not a scratch one (`e2e/CLAUDE.md` trap 1: a
// script that needs mutable state sets it, and this one also restores it). It CLEARS UP AFTER
// ITSELF too, which is what lets the count be asserted exactly rather than as ">= 1": the two
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

console.log('\n== the one /about location, through the API ==');
const SECTION = 'money-and-openness';
const KEY = `about#${SECTION}`;

async function findLocation() {
	const existing = await api('/discussion-locations/', { tok: staffToken });
	return (existing.body ?? []).find((r) => r.page === 'about' && r.section === SECTION) ?? null;
}
const original = await findLocation();
check(
	`${KEY} exists (the seed writes it — run seed_edmat_project if it does not)`,
	original !== null,
	'no such location'
);
if (!original) process.exit(1);
const ORIGINAL_POLICY = {
	audience: original.audience,
	moderated: original.moderated,
	is_enabled: original.is_enabled
};
console.log(`  (original policy: ${JSON.stringify(ORIGINAL_POLICY)})`);

async function setPolicy(settings) {
	return (
		await api(`/discussion-locations/${original.id}/`, {
			method: 'PATCH',
			body: settings,
			tok: staffToken
		})
	).body;
}

// A check that THROWS (a selector timing out, say) ends the script through an unhandled
// rejection; the real location and the flag are put back on the way out rather than left as
// whichever phase the run died in.
process.on('unhandledRejection', async (err) => {
	console.error('\nAborted:', err?.message ?? err);
	await setPolicy(ORIGINAL_POLICY).catch(() => {});
	await setFlag(true).catch(() => {});
	process.exit(1);
});

const anyone = await setPolicy({ audience: 'anyone', moderated: false, is_enabled: true });
check(
	'the location can be set to `anyone` and read back',
	anyone?.key === KEY && anyone?.audience === 'anyone',
	JSON.stringify(anyone)
);

/** The number the collapsed line prints for the /about location, read from the server.
 *
 * Authenticated on purpose (`e2e/CLAUDE.md` trap 12): an anonymous GET can be answered from the
 * 60s read cache, and a count read through it would be the count before this script wrote
 * anything. `comment_count` is public comments only — not tombstones, not held ones — which is the
 * same rule all three places that print a number here follow. */
async function publicCount() {
	const res = await api(`/discussions/?page=about&sections=${SECTION}`, { tok: staffToken });
	const row = (res.body?.locations ?? []).find((l) => l.section === SECTION);
	return row?.comment_count ?? 0;
}
// Read BEFORE anything is written, so the assertion further down is against a number this run
// computed rather than against whatever previous runs left behind.
const countBefore = await publicCount();
console.log(`  (before: ${KEY} ${countBefore})`);

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

console.log('\n== the four module showcase pages (2026-10-14) ==');
// Run FIRST, as the anonymous reader the context starts as, so that its result does not depend on
// the `/about` checks below. Each draws one quiet discussion per section, asked for in ONE policy request under its own
// `about/<slug>` key (`ShowcasePage` → `providePageDiscussions`), and opening one asks for that
// section's thread and nothing else. The section counts are the content files' own
// (`lib/content/showcase/<slug>.ts: sections`).
// Its own context, so its requests never reach the thread-request log the `/about` checks below
// count from.
const moduleCtx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
const modulePage = await moduleCtx.newPage();
modulePage.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
for (const [slug, sections, first] of [
	['goals-and-work', 6, 'goals'],
	['tutoring', 4, 'listing'],
	['materials', 4, 'material'],
	['conference', 6, 'venue']
]) {
	const policyAsked = modulePage
		.waitForRequest((r) => r.url().includes('/api/discussions/?'), { timeout: 30000 })
		.catch(() => null);
	await modulePage.goto(`${BASE}/about/${slug}`, { waitUntil: 'load' });
	const policy = await policyAsked;
	check(
		`/about/${slug}: one policy request, for page about/${slug}`,
		policy !== null && new URL(policy.url()).searchParams.get('page') === `about/${slug}`,
		policy?.url() ?? 'none'
	);
	await modulePage
		.waitForSelector('.section-discussion__toggle', { timeout: 30000 })
		.catch(() => {});
	const drawn = await modulePage.locator('.section-discussion__toggle').count();
	check(`/about/${slug}: ${sections} collapsed discussions`, drawn === sections, `found ${drawn}`);
	// e2e trap 27: register the thread wait BEFORE the click.
	const threadAsked = modulePage
		.waitForResponse((r) => r.url().includes('/api/discussions/thread/'), { timeout: 15000 })
		.catch(() => null);
	await modulePage
		.locator(`section[data-section="${first}"]`)
		.locator('xpath=following-sibling::*[1]')
		.locator('.section-discussion__toggle')
		.click()
		.catch(() => {});
	const thread = await threadAsked;
	const params = thread ? new URL(thread.url()).searchParams : null;
	check(
		`/about/${slug}: opening the first section asks for about/${slug}#${first}`,
		params?.get('page') === `about/${slug}` && params?.get('section') === first,
		thread?.url() ?? 'no thread request'
	);
}
await modulePage.screenshot({
	path: 'e2e/screens/about-discussions-4-module-page.png',
	fullPage: false
});
await moduleCtx.close();

console.log('\n== an anonymous reader on /about ==');
// The page's OWN locations live inside `article.about`; the organisation page above it draws a
// row discussion of its own (see the header), which is not this script's to count.
const ABOUT = 'article.about .section-discussion';
await page.goto(`${BASE}/about`, { waitUntil: 'load' });
// 60s, not 15: on a cold Vite dev server /about's module graph is compiled on this first request,
// and on a loaded machine that is minutes rather than seconds. A production build is not this
// slow; the timeout is about the dev server, not about the page.
await page.waitForSelector(`${ABOUT} .section-discussion__toggle`, { timeout: 60000 });
const toggles = await page.locator(`${ABOUT} .section-discussion__toggle`).count();
check('exactly one collapsed line of /about’s own', toggles === 1, `found ${toggles}`);
check('no thread is fetched before a click', threadCalls.length === 0, threadCalls.join(' | '));

console.log('\n== opening the thread as a visitor (`anyone`) ==');
// Wait for the RESPONSE, not just for the panel: the panel appears instantly carrying
// "Loading…", and asserting against it is how the first run of this script reported a missing
// composer that was simply not drawn yet (e2e/CLAUDE.md trap 25 — waiting for an element proves
// nothing about whether it is finished).
const aboutDiscussion = page.locator(ABOUT).first();
const threadLoaded = page.waitForResponse((r) => r.url().includes('/api/discussions/thread/'));
await aboutDiscussion.locator('.section-discussion__toggle').click();
await threadLoaded;
await aboutDiscussion.locator('.section-discussion__body').waitFor({ timeout: 10000 });
await aboutDiscussion
	.locator('.section-discussion__body')
	.getByText(/Wczytywanie|Loading/)
	.waitFor({ state: 'detached', timeout: 10000 })
	.catch(() => {});
check('one thread request after one click', threadCalls.length === 1, threadCalls.join(' | '));
check(
	`and it asks for ${KEY}`,
	/[?&]page=about(&|$)/.test(threadCalls[0] ?? '') &&
		(threadCalls[0] ?? '').includes(`section=${SECTION}`),
	threadCalls[0] ?? 'none'
);

// Since 2026-10-09 the box is not on the page until somebody asks for it, and the visitor's name
// field lives INSIDE it — so this is asserted first and then opened, and the two checks below read
// the open composer.
check(
	'no input box until it is asked for',
	(await aboutDiscussion
		.locator('.section-discussion__body textarea, .section-discussion__body .ProseMirror')
		.count()) === 0
);
await aboutDiscussion.locator('.section-discussion__body .comment-form__open').first().click();
check(
	'a visitor gets a name field where the audience is `anyone`',
	(await aboutDiscussion.locator('.section-discussion__name input').count()) === 1
);
check(
	'a visitor gets a composer where the audience is `anyone`',
	(await aboutDiscussion
		.locator('.section-discussion__body')
		.locator('button', { hasText: /Post|Opublikuj|Dodaj/i })
		.count()) >= 1
);
await aboutDiscussion.scrollIntoViewIfNeeded();
await page.screenshot({ path: 'e2e/screens/about-discussions-1-anon-open.png', fullPage: false });

console.log('\n== a visitor writes, and it is held ==');
const VISITOR_TEXT = 'A question from a visitor (about-discussions.mjs).';
const held = await api('/discussions/thread/', {
	method: 'POST',
	body: { page: 'about', section: SECTION, body: VISITOR_TEXT, anon_name: 'Kasia' }
});
check('an anonymous comment is accepted', held.status === 201, `${held.status}`);
check('and comes back marked held', held.body?.is_held === true, JSON.stringify(held.body));
const publicThread = await api(`/discussions/thread/?page=about&section=${SECTION}`);
check(
	'a held comment is invisible to everybody else',
	(publicThread.body?.comments ?? []).every((c) => String(c.id) !== String(held.body?.id)),
	`${(publicThread.body?.comments ?? []).length} comments`
);
const staffThread = await api(`/discussions/thread/?page=about&section=${SECTION}`, {
	tok: staffToken
});
check(
	'and visible to staff, who have to decide about it',
	(staffThread.body?.comments ?? []).some((c) => String(c.id) === String(held.body?.id)),
	`${(staffThread.body?.comments ?? []).length} comments`
);

console.log('\n== a signed-in reader (`users`) ==');
const users = await setPolicy({ audience: 'users', moderated: false, is_enabled: true });
check('the location can be set to `users`', users?.audience === 'users', JSON.stringify(users));
const plainToken = await token(PLAIN);
const SIGNED_IN_TEXT = 'A real question about the research thread (about-discussions.mjs).';
const posted = await api('/discussions/thread/', {
	method: 'POST',
	body: { page: 'about', section: SECTION, body: SIGNED_IN_TEXT },
	tok: plainToken
});
check('a signed-in comment is accepted', posted.status === 201, `${posted.status}`);
check(
	'and is not held on an unmoderated location',
	posted.body?.is_held === false,
	JSON.stringify(posted.body)
);

// The rest of this section is about what a SIGNED-IN reader sees, so the browser has to be signed
// in too. The token goes straight into the store's own key rather than driving the login form:
// this script is not about signing in, and the form has its own script.
await page.addInitScript((tok) => localStorage.setItem('edmat-auth-token', tok), plainToken);
await page.goto(`${BASE}/about`, { waitUntil: 'load' });
await page.waitForSelector(`${ABOUT} .section-discussion__toggle`, { timeout: 30000 });
const signedInToggle = page.locator(ABOUT).first().locator('.section-discussion__toggle');
const label = (await signedInToggle.textContent()) ?? '';
// THE count, not a count. The script read `countBefore` from the server before it wrote anything
// and has written exactly one public comment here since, and it removes that comment again at the
// end — so this number is reproducible across runs.
const shown = label.match(/\((\d+)\)/);
const expectedCount = countBefore + 1;
check(
	`the collapsed line carries the exact count (${expectedCount})`,
	shown !== null && Number(shown[1]) === expectedCount,
	label.trim()
);
const signedInLoaded = page.waitForResponse((r) => r.url().includes('/api/discussions/thread/'));
await signedInToggle.click();
await signedInLoaded;
await page
	.locator(ABOUT)
	.first()
	.locator('.section-discussion__body')
	.getByText(/Wczytywanie|Loading/)
	.waitFor({ state: 'detached', timeout: 10000 })
	.catch(() => {});
const bodyText = (await page.locator(ABOUT).first().textContent()) ?? '';
check(
	'the comment is rendered in the thread',
	bodyText.includes(SIGNED_IN_TEXT),
	bodyText.slice(0, 160)
);

console.log('\n== a signed-in but unverified reader (`verified`) ==');
const verified = await setPolicy({ audience: 'verified', is_enabled: true });
check(
	'the location can be set to `verified`',
	verified?.audience === 'verified',
	JSON.stringify(verified)
);
const refused = await api('/discussions/thread/', {
	method: 'POST',
	body: { page: 'about', section: SECTION, body: 'Should be refused.' },
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
await page.goto(`${BASE}/about`, { waitUntil: 'load' });
await page.waitForSelector(`${ABOUT} .section-discussion__toggle`, { timeout: 30000 });
const verifiedDiscussion = page.locator(ABOUT).first();
const verifiedLoaded = page.waitForResponse((r) => r.url().includes('/api/discussions/thread/'));
await verifiedDiscussion.locator('.section-discussion__toggle').click();
await verifiedLoaded;
await page.waitForTimeout(500);
const refusalText = (await verifiedDiscussion.textContent()) ?? '';
check(
	'they get the verified-only sentence, not a composer',
	/zweryfikowan|verified contributors/i.test(refusalText),
	refusalText.slice(0, 200)
);
check(
	'and no composer is drawn for them',
	(await verifiedDiscussion
		.locator('.comment-form__open, .section-discussion__name input')
		.count()) === 0
);
await verifiedDiscussion.scrollIntoViewIfNeeded();
await page.screenshot({
	path: 'e2e/screens/about-discussions-2-thread-and-refusal.png',
	fullPage: false
});

console.log('\n== a switched-off location ==');
const off = await setPolicy({ is_enabled: false });
check('the location can be switched off', off?.is_enabled === false, JSON.stringify(off));
await page.goto(`${BASE}/about`, { waitUntil: 'load' });
// The research heading is part of the static page, so its presence proves /about rendered and the
// absence below is the location's doing, not a page that never painted.
await page.locator('article.about h2').first().waitFor({ timeout: 30000 });
await page.waitForTimeout(2500);
check(
	'a switched-off location draws no affordance — not a disabled line (house rule 3)',
	(await page.locator(`${ABOUT} .section-discussion__toggle`).count()) === 0
);
await setPolicy({ is_enabled: true });

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
await page.locator('article.about h2').first().waitFor({ timeout: 30000 });
await page.waitForTimeout(2500);
check(
	'with the flag off, no affordance of /about’s own',
	(await page.locator(`${ABOUT} .section-discussion__toggle`).count()) === 0
);
await page.screenshot({ path: 'e2e/screens/about-discussions-3-flag-off.png', fullPage: false });
await page.goto(`${BASE}/about/conference`, { waitUntil: 'load' });
await page.waitForTimeout(2500);
check(
	'with the flag off, none on a module showcase page either',
	(await page.locator('.section-discussion__toggle').count()) === 0
);
const offPolicy = await api(`/discussions/?page=about&sections=${SECTION}`);
check(
	'and the policy endpoint still answers, saying it is off',
	offPolicy.status === 200 && offPolicy.body?.locations?.every((l) => l.is_enabled === false),
	JSON.stringify(offPolicy.body)
);
await setFlag(true);

console.log('\n== the held count is a link into the queue ==');
// A moderator who can see "Waiting: 1" has to be able to reach the one. The link is
// `/moderation?tab=reports&location=<key>` and it carries `data-sveltekit-reload`, because this
// panel lives inside /moderation and both query parameters are read once at that page's mount.
await page.addInitScript((tok) => localStorage.setItem('edmat-auth-token', tok), staffToken);
const locationsLoaded = page.waitForResponse((r) => r.url().includes('/api/discussion-locations/'));
await page.goto(`${BASE}/moderation?tab=discussions`, { waitUntil: 'load' });
await locationsLoaded;
await page.waitForSelector('.location-row', { timeout: 20000 });
const heldLink = page.locator('.location-row', { hasText: KEY }).locator('a.location-row__held');
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
	page.url().includes('tab=reports') && page.url().includes(`location=${encodeURIComponent(KEY)}`),
	page.url()
);
const filterLine = (await page.locator('.location-filter').textContent()) ?? '';
check('and the filter says so, visibly', filterLine.includes(KEY), filterLine.trim());
// How many rows SHOULD be there, computed from the same queue the page fetched, rather than
// "exactly one", which would be an assertion about the database rather than about the filter.
const queuePayload = await api('/moderation/queue/', { tok: staffToken });
const allRows = queuePayload.body?.reports ?? [];
const expectedRows = allRows.filter((r) => r.discussion_location === KEY).length;
const queueText =
	(await page
		.locator('.queue')
		.textContent()
		.catch(() => '')) ?? '';
const queued = await page.locator('.queue-item').count();
check(
	`report rows carry their location (${expectedRows} of ${allRows.length} at ${KEY})`,
	expectedRows >= 1 && expectedRows <= allRows.length,
	`${expectedRows}/${allRows.length}`
);
check(
	`only that location’s held comments are listed (${expectedRows})`,
	queued === expectedRows && queueText.includes(VISITOR_TEXT),
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
const countAfter = await publicCount();
check(`${KEY} is back to ${countBefore}`, countAfter === countBefore, `${countAfter}`);

// By ID, not by text: "did THIS run leave anything" is the question.
const after = await api(`/discussions/thread/?page=about&section=${SECTION}`, { tok: staffToken });
const leftovers = [posted.body?.id, held.body?.id]
	.map((id) => (after.body?.comments ?? []).find((c) => String(c.id) === String(id)))
	// Present is fine — a tombstone keeps a thread's shape (house rule 12). Readable is not.
	.filter((row) => row && (!row.is_removed || row.body))
	.map((row) => `${row.id} still readable`);
check(
	'no visible comment of this run is left behind',
	leftovers.length === 0,
	leftovers.join(' | ')
);

// The real location goes back to exactly the policy it had — the research thread lives here.
const restored = await setPolicy(ORIGINAL_POLICY);
check(
	`${KEY} is back to its original policy`,
	restored?.audience === ORIGINAL_POLICY.audience &&
		restored?.moderated === ORIGINAL_POLICY.moderated &&
		restored?.is_enabled === ORIGINAL_POLICY.is_enabled,
	JSON.stringify(restored)
);

console.log(
	`\n${pass} passed, ${fail} failed, ${errors.length} console/page errors` +
		` (${ignoredFontErrors} KaTeX webfont 403s ignored — trap 26, worktree only)`
);
for (const e of errors.slice(0, 8)) console.log('  ' + e);
process.exit(fail || errors.length ? 1 : 0);
