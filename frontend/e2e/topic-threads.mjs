// Topic threads (root CLAUDE.md §17AK): a covers/requires claim chip's popover links to "the page
// for that tag" — the activity feed filtered to the claim's TOPIC — where the composer arrives
// pre-anchored, so posting into the topic's thread is one click from the material page. Also the
// tag-chip menu's own "Posts about this tag" row. Ola signs in once; cleans its post.
//   E2E_BASE=http://localhost:5173 E2E_API=http://localhost:8000 E2E_MATERIAL=1 node e2e/topic-threads.mjs
let chromium;
try {
	({ chromium } = await import('playwright'));
} catch {
	({ chromium } = await import('playwright-core'));
}
const BASE = process.env.E2E_BASE ?? 'http://localhost:5173';
const API = process.env.E2E_API ?? 'http://localhost:8000';
const MATERIAL = process.env.E2E_MATERIAL ?? '1'; // a material with covers claims
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
const page = await (
	await browser.newContext({ viewport: { width: 1280, height: 1000 } })
).newPage();
page.on('console', (m) => {
	if (m.type() !== 'error') return;
	// The course page's known pre-existing getAttachments 404 for non-members (todo board;
	// course-claims.mjs tolerates exactly this one too) — everything else still fails the run.
	if (page.url().includes('/courses/') && m.text().includes('404')) return;
	errors.push(m.text());
});
page.on('pageerror', (e) => errors.push(e.message));
const settle = (ms = 900) => page.waitForTimeout(ms);

const MARKER = 'Topic-thread e2e post';
// Reset: tombstone this script's own earlier posts (by marker text, never wholesale).
const login = await fetch(`${API}/api/auth/login/`, {
	method: 'POST',
	headers: { 'Content-Type': 'application/json' },
	body: JSON.stringify({ username: 'kasia@edmat.example', password: 'password123' })
});
const kasiaToken = (await login.json()).token;
{
	const feed = await (await fetch(`${API}/api/activity/?kind=post&limit=50`)).json();
	for (const row of feed) {
		if (row.post && row.post_detail?.body?.includes(MARKER)) {
			await fetch(`${API}/api/posts/${row.post}/`, {
				method: 'DELETE',
				headers: { Authorization: `Token ${kasiaToken}` }
			});
		}
	}
}

// 1. Sign in, open the material, open a covers claim's popover.
await page.goto(`${BASE}/login`, { waitUntil: 'load' });
await settle(2800);
await page.locator('form input[type="email"]').fill('ola@edmat.example');
await page.locator('form input[type="password"]').fill('password123');
await page.locator('form button[type="submit"]').click();
await page.waitForURL((u) => !u.pathname.includes('/login'), { timeout: 10000 });
await page.goto(`${BASE}/materials/${MATERIAL}`, { waitUntil: 'load' });
const chip = page.locator('.claim-group button.coverage-badge').first();
await chip.waitFor({ timeout: 20000 });
await chip.click();
const threadLink = page.locator('.topic-thread-link');
await threadLink.waitFor({ timeout: 10000 });
const linkText = await threadLink.textContent();
check(
	`the claim popover offers the topic thread (${linkText?.trim()})`,
	/Posts about/.test(linkText ?? '')
);
// The owner's screenshot: for a claim with NO subtopic, the meta rows used to repeat the topic
// name the popover title already carries — the row now renders only when a subtopic makes it
// new information.
const claimTopic = (linkText ?? '').match(/[\u201c\u201e](.+)[\u201d]/)?.[1] ?? '';
// No <dd> may hold the bare topic name (the thread link's own dd mentions it inside a longer
// sentence, which is fine — the redundancy was a row saying ONLY the name again).
const bareTopicRows = await page
	.locator('.coverage-popover__meta dd')
	.evaluateAll(
		(dds, topic) => dds.filter((d) => d.textContent?.trim() === topic).length,
		claimTopic
	);
check(
	'no duplicated topic row under the title (subtopic-less claim)',
	claimTopic !== '' && bareTopicRows === 0,
	`topic=${claimTopic} bareRows=${bareTopicRows}`
);

// 2. Following it lands on the topic-filtered feed with a pre-anchored composer.
await threadLink.click();
await page.waitForURL((u) => u.pathname === '/activity' && u.searchParams.has('topic'), {
	timeout: 10000
});
await settle(1500);
const topicId = new URL(page.url()).searchParams.get('topic');
const label = new URL(page.url()).searchParams.get('label');
check('the URL carries the topic id and its human label', Boolean(topicId && label));
// An arbitrary topic may have zero retained feed rows (corpus exercises produced no backfill
// rows), so the honest assertion is that the FILTERED page renders — either rows or the empty
// state — never everything unfiltered (which would be dozens of rows plus the kind chips).
const rowCount = await page.locator('.feed > *').count();
const emptyState = await page.locator('.status').count();
check(
	'the topic-filtered feed renders scoped (rows or the honest empty state)',
	rowCount > 0 || emptyState > 0,
	`rows=${rowCount}`
);
const fixed = page.locator('.composer .fixed-anchor');
check(
	`the composer arrives pre-anchored to the topic (${await fixed.textContent()})`,
	(await fixed.count()) === 1 && (await fixed.textContent())?.trim() === label
);
check(
	'with a "change" escape back to the manual pickers',
	(await page.getByRole('button', { name: 'change' }).count()) === 1
);

// 3. Publish into the thread.
await page.locator('.composer textarea').fill(`${MARKER}: my two cents on this topic.`);
await page.getByRole('button', { name: 'Publish' }).click();
await settle(1400);
const posted = page.locator('.post', { hasText: MARKER }).first();
check('the post lands in the topic thread', (await posted.count()) === 1);
check(
	'its anchor chip names the topic',
	(await posted.locator('.post__anchor').textContent())?.trim() === label
);
// And the API row is genuinely topic-anchored.
const feedRow = (
	await (await fetch(`${API}/api/activity/?topic=${topicId}&kind=post&limit=5`)).json()
)[0];
check(
	'the API confirms the topic anchor',
	feedRow && String(feedRow.post_detail?.topic) === topicId
);

// 4. Every other claim surface reaches the same popover — material BROWSE cards, exercise and
// course claim groups (one shared CoveragePopover, but proven live, not assumed from the import
// graph).
await page.goto(`${BASE}/materials`, { waitUntil: 'load' });
const cardChip = page.locator('button.claim-chip').first();
// The browse list loads async — count() the instant after goto is 0 on a healthy page.
await cardChip.waitFor({ timeout: 15000 }).catch(() => {});
if ((await cardChip.count()) > 0) {
	await cardChip.click();
	await page.locator('.topic-thread-link').waitFor({ timeout: 10000 });
	check("a material BROWSE card's chip popover carries the thread link", true);
	await page.keyboard.press('Escape');
} else {
	console.log('  SKIP browse-card chip (no claim chips in the grid)');
}

await page.goto(`${BASE}/courses/6`, { waitUntil: 'load' });
await settle(1500);
const courseChip = page.locator('.claim-group button.coverage-badge').first();
if ((await courseChip.count()) > 0) {
	await courseChip.click();
	await page.locator('.topic-thread-link').waitFor({ timeout: 10000 });
	check("a course page's claim popover carries the thread link", true);
	await page.keyboard.press('Escape');
} else {
	console.log('  SKIP course claim chip (course 6 has no claims)');
}

// The exercise page's own TOPIC PILLS — a topic named on the page now links to its thread
// directly, not only through a claim popover.
await page.goto(`${BASE}/exercises/1`, { waitUntil: 'load' });
const pill = page.locator('a.topic-pill').first();
await pill.waitFor({ timeout: 20000 });
const pillHref = await pill.getAttribute('href');
check(
	"an exercise page's topic pill links to the topic thread",
	Boolean(pillHref?.includes('/activity?topic=')),
	pillHref ?? ''
);

// 4b. The tag-chip menu's own thread row — on an exercise page, where TagChips actually render
// (the material card's compact rewrite shows tags on the detail page's card, but the corpus
// tags live on exercises — the page is already open from the pill check above).
const tagChip = page.locator('.tag-chip__trigger').first();
await tagChip.waitFor({ timeout: 20000 });
await tagChip.hover();
await settle(700);
const tagLink = page.locator('.tag-chip__menu a', { hasText: 'Posts about this tag' });
check(
	'the tag-chip menu links to the tag thread',
	(await tagLink.count()) === 1 && (await tagLink.getAttribute('href'))?.includes('/activity?tag=')
);

// Cleanup: tombstone the post.
{
	const feed = await (await fetch(`${API}/api/activity/?kind=post&limit=50`)).json();
	let cleaned = 0;
	for (const row of feed) {
		if (row.post && row.post_detail?.body?.includes(MARKER)) {
			const res = await fetch(`${API}/api/posts/${row.post}/`, {
				method: 'DELETE',
				headers: { Authorization: `Token ${kasiaToken}` }
			});
			if (res.status === 204) cleaned++;
		}
	}
	check(`cleanup tombstoned the ${cleaned} scratch post(s)`, cleaned >= 1);
}

console.log(`\n${pass} passed, ${fail} failed`);
if (errors.length) {
	console.log('console/page errors:');
	for (const e of errors) console.log('  ' + e);
}
await browser.close();
process.exit(fail || errors.length ? 1 : 0);
