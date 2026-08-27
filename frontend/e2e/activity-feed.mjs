// The real activity feed + anchored micro-posts (root CLAUDE.md §17AI): the public feed page,
// publishing a post through the actual composer (anchor + exercise reference via the search
// picker), the anchor chip as a filtered-feed link, the post's own page and thread, the author
// notification, Followed's honest empty state, delete-as-tombstone, the home tab slice, and the
// `posts` kill switch removing the composer, the kind filter option and every post row.
//   E2E_BASE=http://localhost:5173 E2E_API=http://localhost:8000 node e2e/activity-feed.mjs
// Signs in ola + michal through the UI (once each — the login throttle) and kasia via the API for
// the flag toggle. Cleans up its post; reruns start clean.
let chromium;
try {
	({ chromium } = await import('playwright'));
} catch {
	({ chromium } = await import('playwright-core'));
}
const BASE = process.env.E2E_BASE ?? 'http://localhost:5173';
const API = process.env.E2E_API ?? 'http://localhost:8000';
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
async function newSession() {
	const context = await browser.newContext({ viewport: { width: 1280, height: 1000 } });
	const page = await context.newPage();
	page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
	page.on('pageerror', (e) => errors.push(e.message));
	return page;
}
const settle = (ms = 900) => new Promise((r) => setTimeout(r, ms));
async function goto(page, path) {
	await page.goto(`${BASE}${path}`, { waitUntil: 'load' });
	await settle(1200);
}
async function login(page, email) {
	await goto(page, '/login');
	await settle(2500); // cold-compile: filling before hydration submits the form natively
	await page.locator('form input[type="email"]').fill(email);
	await page.locator('form input[type="password"]').fill('password123');
	await page.locator('form button[type="submit"]').click();
	await page.waitForURL((u) => !u.pathname.includes('/login'), { timeout: 10000 });
	await settle(800);
}
async function apiLogin(email) {
	const res = await fetch(`${API}/api/auth/login/`, {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify({ username: email, password: 'password123' })
	});
	return (await res.json()).token;
}
const kasiaToken = await apiLogin('kasia@edmat.example');
const kasiaApi = (path, opts = {}) =>
	fetch(`${API}/api${path}`, {
		...opts,
		headers: {
			'Content-Type': 'application/json',
			Authorization: `Token ${kasiaToken}`,
			...(opts.headers ?? {})
		}
	});

// Reset: tombstone any earlier run's OWN posts — matched by this script's marker text, never
// wholesale (a blanket delete would eat real people's posts the day this runs against a shared
// server; e2e/CLAUDE.md's "reset through the real API" convention, scoped to what this made).
{
	const feed = await (await fetch(`${API}/api/activity/?kind=post&limit=50`)).json();
	for (const row of feed) {
		if (row.post && row.post_detail?.body?.includes('substitution cleaner')) {
			await kasiaApi(`/posts/${row.post}/`, { method: 'DELETE' });
		}
	}
}

// ---------------------------------------------------------------- 1. anonymous
const anon = await newSession();
await goto(anon, '/activity');
await anon.locator('.feed').waitFor({ timeout: 20000 });
check('the public feed renders rows', (await anon.locator('.feed > *').count()) > 0);
check('signed out: no composer', (await anon.locator('.composer').count()) === 0);
check(
	'signed out: no Followed toggle',
	(await anon.getByRole('button', { name: 'Followed' }).count()) === 0
);

// ---------------------------------------------------------------- 2. ola publishes a post
const ola = await newSession();
await login(ola, 'ola@edmat.example');
await goto(ola, '/activity');
await ola.locator('.composer').waitFor({ timeout: 20000 });
await ola
	.locator('.composer textarea')
	.fill('Anyone else find substitution cleaner here? \\(u = x^2\\) does it.');
await ola.locator('.composer .anchor-value').selectOption({ index: 1 }); // first real branch
// Attach an exercise through the real search picker.
await ola.locator('.composer .field select').nth(1).selectOption('exercise');
await ola.locator('.composer input[placeholder]').last().fill('Całka');
await ola.getByRole('button', { name: 'Search' }).click();
await settle(900);
const firstResult = ola.locator('.ref-results button').first();
check(
	'the reference search returns results',
	(await ola.locator('.ref-results button').count()) > 0
);
await firstResult.click();
await ola.getByRole('button', { name: 'Publish' }).click();
await settle(1200);
check('publishing confirms', (await ola.getByText('Published.').count()) === 1);
const postCard = ola.locator('.post', { hasText: 'substitution cleaner' }).first();
check('the post tops the feed with typeset math', (await postCard.locator('.katex').count()) > 0);
check('it carries its anchor chip', (await postCard.locator('.post__anchor').count()) === 1);
check('and the exercise reference link', (await postCard.locator('.post__ref').count()) === 1);

// The anchor chip filters the feed — "the thread around that".
await postCard.locator('.post__anchor').click();
await settle(1200);
check(
	'the anchor chip opens the feed filtered to its anchor',
	ola.url().includes('branch=') &&
		(await ola.locator('.post', { hasText: 'substitution cleaner' }).count()) === 1
);

// Kind filter: posts only.
await goto(ola, '/activity?kind=post');
check(
	'the kind filter narrows to posts',
	(await ola.locator('.post').count()) >= 1 &&
		(await ola.locator('.row:not(.row--post)').count()) === 0
);

// ---------------------------------------------------------------- 3. michal comments on it
const postId = await (async () => {
	const feed = await (await fetch(`${API}/api/activity/?kind=post&limit=1`)).json();
	return String(feed[0].post);
})();
const michal = await newSession();
await login(michal, 'michal@edmat.example');
await goto(michal, `/posts/${postId}`);
check(
	"the post's own page renders with its thread open",
	(await michal.locator('.post .katex').count()) > 0 &&
		(await michal.locator('.post__discussion').count()) === 1
);
await michal.locator('.post__discussion textarea').fill('Parts works too, but this is cleaner.');
await michal.locator('.post__discussion button[type="submit"]').first().click();
await settle(1000);
check('a comment lands in the thread', (await michal.getByText('Parts works too').count()) >= 1);
// The author is notified, with the post as the link target.
const olaToken = await ola.evaluate(() => localStorage.getItem('edmat-auth-token'));
const notifications = await (
	await fetch(`${API}/api/notifications/`, { headers: { Authorization: `Token ${olaToken}` } })
).json();
const reply = notifications.find((n) => n.type === 'comment_reply' && String(n.post_id) === postId);
check("the post's author is notified, linked to the post", Boolean(reply));

// Followed: michal follows nothing → the honest empty state, not everything.
await goto(michal, '/activity?view=followed');
check(
	'Followed shows its honest empty state for somebody following nothing',
	(await michal.getByText('Nothing from what you follow yet', { exact: false }).count()) === 1
);

// ---------------------------------------------------------------- 4. home tab slice
await goto(anon, '/?tab=activity');
check(
	'the home Activity tab shows the feed slice with a See-all link',
	(await anon.locator('.activity .row, .activity .post').count()) > 0 &&
		(await anon.locator('a[href*="/activity"]', { hasText: 'See all' }).count()) >= 1
);

// ---------------------------------------------------------------- 5. delete = tombstone
await goto(ola, `/posts/${postId}`);
await ola.locator('.post').getByRole('button', { name: 'Delete' }).click();
await settle(1000);
check(
	'the author deletes it and the page shows the tombstone',
	(await ola.getByText('This post was removed.').count()) === 1
);
const feedAfter = await (await fetch(`${API}/api/activity/?kind=post&limit=10`)).json();
check('its feed row is forgotten', !feedAfter.some((r) => String(r.post) === postId));

// ---------------------------------------------------------------- 6. the kill switch
await kasiaApi('/feature-flags/posts/', {
	method: 'PATCH',
	body: JSON.stringify({ is_enabled: false })
});
try {
	await goto(ola, '/activity');
	check(
		'flag off: the composer is gone for a signed-in non-staff user',
		(await ola.locator('.composer').count()) === 0
	);
	check(
		'flag off: the kind filter no longer offers posts',
		(await ola.locator('.filter option[value="post"]').count()) === 0
	);
	const gatedFeed = await (await fetch(`${API}/api/activity/?limit=50`)).json();
	check('flag off: no post rows in the feed API', !gatedFeed.some((r) => r.kind === 'post'));
} finally {
	await kasiaApi('/feature-flags/posts/', {
		method: 'PATCH',
		body: JSON.stringify({ is_enabled: true })
	});
}

console.log(`\n${pass} passed, ${fail} failed`);
if (errors.length) {
	console.log('console/page errors:');
	for (const e of errors) console.log('  ' + e);
}
await browser.close();
process.exit(fail || errors.length ? 1 : 0);
