// End-to-end check of searching inside one course, and of the diacritics fix underneath it.
//
// Run it with both halves up:
//   backend:  DJANGO_CORS_ALLOWED_ORIGINS=http://localhost:5178 manage.py runserver 8014
//   frontend: PUBLIC_API_BASE_URL=http://localhost:8014/api npx vite dev --port 5178
//   E2E_BASE=http://localhost:5178 E2E_API=http://localhost:8014/api node e2e/course-search.mjs
//
// `courses/tests.py` and `config/test_dbsearch.py` already pin the rules and the lookup. What only a
// browser can show is the part those cannot: that the box debounces rather than firing per keystroke,
// that a result actually navigates to the thing it found, that the matched words are marked in the
// snippet, and that the same page shows a participant and a stranger different results.
//
// The fixture is built and torn down through the real endpoints, so a second run starts clean rather
// than finding last run's course. Sign-in is as the seeded demo accounts, never `register` — that is
// throttled per process at 10/hour, and a script that registers people exhausts it and then fails in
// ways that look exactly like a broken feature.
let chromium;
try {
	({ chromium } = await import('playwright'));
} catch {
	({ chromium } = await import('playwright-core'));
}

const BASE = process.env.E2E_BASE ?? 'http://localhost:5178';
const API = process.env.E2E_API ?? 'http://localhost:8014/api';
const PASSWORD = 'password123';
const TITLE = 'Szukajka — kurs do testu wyszukiwania';

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

async function tokenFor(email) {
	// The login endpoint takes the email in a field called `username`.
	const response = await fetch(`${API}/auth/login/`, {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify({ username: email, password: PASSWORD })
	});
	const body = await response.json();
	if (!body.token) throw new Error(`could not sign in as ${email}: ${JSON.stringify(body)}`);
	return body.token;
}

/** Called from Node rather than from the page: the frontend is on a different origin, so a fetch
 * inside the browser would hit the dev server's HTML fallback and try to parse a document as JSON. */
async function api(token, path, init = {}) {
	const response = await fetch(`${API}${path}`, {
		...init,
		headers: {
			'Content-Type': 'application/json',
			...(token ? { Authorization: `Token ${token}` } : {}),
			...(init.headers ?? {})
		}
	});
	const text = await response.text();
	return { status: response.status, body: text ? JSON.parse(text) : null };
}

const post = (token, path, payload) =>
	api(token, path, { method: 'POST', body: JSON.stringify(payload) });

// --- fixture ---------------------------------------------------------------------------------------

const kasia = await tokenFor('kasia@edmat.example');
const michal = await tokenFor('michal@edmat.example');
const ola = await tokenFor('ola@edmat.example');

// Anything left by an earlier run, gone before this one starts.
for (const course of (await api(kasia, '/courses/?mine=teaching')).body ?? []) {
	if (course.title === TITLE) await api(kasia, `/courses/${course.id}/`, { method: 'DELETE' });
}

const created = await post(kasia, '/courses/', {
	title: TITLE,
	summary: 'Kurs o zbieżności szeregów liczbowych',
	description: 'Zaczynamy od podstaw: zadania z granic i ciągów.',
	visibility: 'public',
	status: 'open',
	enrollment_policy: 'open',
	discussion_mode: 'participants'
});
if (created.status !== 201) throw new Error(`could not create the course: ${created.status}`);
const courseId = created.body.id;
console.log(`fixture: course ${courseId}`);

const openChapter = (
	await post(kasia, `/courses/${courseId}/chapters/`, {
		title: 'Ćwiczenia wstępne',
		description: 'Powtórka przed pierwszym kolokwium.',
		order: 0
	})
).body;
const lesson = (
	await post(kasia, `/courses/${courseId}/lessons/`, {
		chapter: openChapter.id,
		title: 'Kryterium Cauchy’ego',
		description: 'Dowód i kontrprzykłady.',
		participant_notes: 'Sekretne wskazówki: policzcie szereg harmoniczny.',
		order: 0
	})
).body;
const lockedChapter = (
	await post(kasia, `/courses/${courseId}/chapters/`, {
		title: 'Rachunek różniczkowy',
		description: 'Otwiera się w przyszłym tygodniu.',
		order: 1,
		unlocks_at: new Date(Date.now() + 7 * 86400_000).toISOString()
	})
).body;
await post(kasia, `/courses/${courseId}/lessons/`, {
	chapter: lockedChapter.id,
	title: 'Pochodna kierunkowa',
	order: 0
});
const material = (await api(null, '/materials/')).body[0];
await post(kasia, `/courses/${courseId}/items/`, {
	material: material.id,
	lesson: lesson.id,
	note: 'Rozdział 4 i 5'
});

await post(michal, `/courses/${courseId}/enrol/`, {});
// Written in capitals on purpose: `LIKE` on SQLite folds ASCII only, so before the `ucontains` fix
// searching `zbieżność` could not find this. It is the one check here that exercises the SQL half of
// the fix rather than Python's `casefold()`.
await post(michal, `/courses/${courseId}/comments/`, {
	body: 'Czy ZBIEŻNOŚĆ trzeba pokazać wprost z definicji?'
});

// --- browser ---------------------------------------------------------------------------------------

const browser = await chromium.launch(
	process.env.CHROME ? { executablePath: process.env.CHROME } : {}
);

/** A context per person, with the token written before the first navigation — the app reads it from
 * localStorage on start, so setting it afterwards would leave the first page render signed out. */
async function person(name, token) {
	const ctx = await browser.newContext();
	if (token) {
		await ctx.addInitScript(
			([key, value]) => window.localStorage.setItem(key, value),
			['edmat-auth-token', token]
		);
	}
	const page = await ctx.newPage();
	page.on('pageerror', (e) => errors.push(`[${name}] pageerror: ${e.message}`));
	page.on('console', (m) => {
		if (m.type() !== 'error') return;
		// One known, deliberate 404, and it predates this feature: the course page fetches
		// `/attachments/` for anybody signed in and catches the refusal, because a stranger's 404
		// there IS the permission working — its own comment says so. Nothing can stop the browser
		// logging the response, so it is filtered by URL rather than by muting console errors
		// wholesale, which would hide a real one.
		const url = m.location()?.url ?? '';
		if (m.text().includes('404') && url.endsWith('/attachments/')) return;
		errors.push(`[${name}] console: ${m.text()} ${url}`);
	});
	return page;
}

const settle = (page, ms = 900) => page.waitForTimeout(ms);

async function goto(page, path) {
	await page.goto(`${BASE}${path}`, { waitUntil: 'networkidle' });
	await settle(page, 1200);
}

const box = (page) => page.locator('.course-search input[type="search"]');

/** Type a query and wait for the debounce plus the round trip. `fill` rather than `type` where the
 * keystrokes themselves do not matter. */
async function search(page, query) {
	await box(page).fill(query);
	await settle(page, 1400);
}

// Group headings are read in ENGLISH, because that is what a fresh browser context gets: Paraglide
// here has no URL strategy configured, so `/courses/7` is not a locale URL and the base locale wins
// until somebody uses the picker. Asserting the Polish labels is how the first version of this script
// "failed" against an app that was working — see the locale section at the end for the Polish half.
const groupRows = (page, group) =>
	page.locator('.course-search .group', { hasText: group }).locator('li');

async function groupTitles(page, group) {
	const rows = groupRows(page, group);
	return (await rows.count()) === 0
		? []
		: await rows.locator('.hit__head > :first-child').allInnerTexts();
}

const owner = await person('kasia', kasia);
const member = await person('michal', michal);
const stranger = await person('ola', ola);

console.log('\n— the box itself —');
await goto(owner, `/courses/${courseId}`);
check('the search box renders on the course page', (await box(owner).count()) === 1);

await box(owner).fill('ć');
await settle(owner, 1200);
const shortNotice = await owner.locator('.course-search .status').innerText();
check('one letter is refused in words', /at least/i.test(shortNotice), shortNotice);
check(
	'one letter produces no results',
	(await owner.locator('.course-search .group').count()) === 0
);

// The debounce, measured rather than assumed: seven keystrokes must not be seven requests.
let requests = 0;
owner.on('request', (r) => {
	if (r.url().includes('/search/')) requests += 1;
});
await box(owner).fill('');
await box(owner).pressSequentially('ciągów', { delay: 40 });
await settle(owner, 1500);
check(`typing six characters fired one request, not six (fired ${requests})`, requests === 1);

console.log('\n— what the owner finds —');
await search(owner, 'ćwiczenia');
check(
	'a capitalised Polish chapter title is found typed in lower case',
	(await groupTitles(owner, 'Chapters')).some((t) => t.includes('Ćwiczenia wstępne'))
);

// A term that matches the chapter's DESCRIPTION rather than its title, so the snippet is the text
// that matched and the marking is visible. A title match deliberately shows the description instead,
// since the title is already the heading of the row.
await search(owner, 'kolokwium');
check(
	'the matched words are marked in the snippet',
	(await owner.locator('.course-search .snippet mark').count()) > 0
);
// Worth a picture rather than only a count: the panel's own look is the part assertions cannot
// check, and the first version of it rendered with no card at all because its colour tokens did not
// exist in this app.
await owner.screenshot({ path: '/tmp/course-search-marked.png', fullPage: false });

await search(owner, 'zbieżność');
check(
	'an ALL-CAPS comment is found typed in lower case (the SQL half of the fix)',
	(await groupRows(owner, 'Discussion').count()) === 1
);

await search(owner, 'cauchy szereg');
check(
	'two words are ANDed across a title and the participant notes',
	(await groupTitles(owner, 'Sessions')).some((t) => t.includes('Cauchy'))
);

await search(owner, 'cauchy elipsoida');
const nothing = await owner.locator('.course-search .status').innerText();
check('a term nothing matches empties the result', /matches/i.test(nothing), nothing);

await search(owner, 'skrypt');
check(
	'a referenced material is found by its label',
	(await groupRows(owner, 'Content').count()) >= 1
);

await search(owner, 'pochodna');
check(
	'staff see a lesson inside a chapter that has not opened',
	(await groupTitles(owner, 'Sessions')).some((t) => t.includes('Pochodna'))
);

console.log('\n— clicking a result goes where it says —');
await search(owner, 'ćwiczenia');
await groupRows(owner, 'Chapters').first().locator('a').first().click();
await settle(owner, 1200);
check(
	'a chapter result lands on the content tab, anchored at the chapter',
	owner.url().includes('tab=content') && owner.url().includes(`#course-chapter-${openChapter.id}`),
	owner.url()
);
check(
	'the chapter it linked to is really on the page',
	await owner.locator(`#course-chapter-${openChapter.id}`).isVisible()
);
check('the box clears itself once a result is taken', (await box(owner).inputValue()) === '');

await search(owner, 'zbieżność');
await groupRows(owner, 'Discussion').first().locator('a').first().click();
await settle(owner, 1500);
check(
	'a comment result opens the discussion tab',
	owner.url().includes('tab=discussion'),
	owner.url()
);
check(
	'and the comment it found is on that tab',
	(await owner.locator('body').innerText()).includes('ZBIEŻNOŚĆ')
);

console.log('\n— the same page, three different people —');
await goto(member, `/courses/${courseId}`);
await search(member, 'sekretne');
check(
	'a participant finds the lesson by its participant notes',
	(await groupTitles(member, 'Sessions')).some((t) => t.includes('Cauchy'))
);

await goto(stranger, `/courses/${courseId}`);
await search(stranger, 'sekretne');
check(
	'a stranger does not — the notes are not searchable from outside',
	(await stranger.locator('.course-search .group').count()) === 0
);

await search(stranger, 'ćwiczenia');
check(
	'but the same stranger does find the chapter',
	(await groupTitles(stranger, 'Chapters')).some((t) => t.includes('Ćwiczenia wstępne'))
);

await search(stranger, 'pochodna');
check(
	'a locked chapter’s lesson stays hidden from a stranger',
	(await groupRows(stranger, 'Sessions').count()) === 0
);

await search(stranger, 'zbieżność');
check(
	'and a participants-only discussion is not searched for them',
	(await groupRows(stranger, 'Discussion').count()) === 0
);

console.log('\n— the other locale —');
await goto(owner, `/courses/${courseId}`);
await owner.screenshot({ path: '/tmp/course-search-en.png', fullPage: false });
await owner.locator('header select').first().selectOption('pl');
await settle(owner, 2000);
await search(owner, 'ćwiczenia');
const polishLabel = await owner.locator('.course-search .field span').first().innerText();
check('the box is translated', /szukaj w tym kursie/i.test(polishLabel), polishLabel);
check(
	'and still finds the same chapter, under the Polish heading',
	(await groupTitles(owner, 'Rozdziały')).some((t) => t.includes('Ćwiczenia wstępne'))
);
await owner.screenshot({ path: '/tmp/course-search-pl.png', fullPage: false });

// --- teardown --------------------------------------------------------------------------------------

await browser.close();
const deleted = await api(kasia, `/courses/${courseId}/`, { method: 'DELETE' });
check('the fixture course is deleted afterwards', deleted.status === 204, String(deleted.status));

console.log(`\n${pass} passed, ${fail} failed`);
if (errors.length) {
	console.log(`\n${errors.length} console/page errors:`);
	for (const line of errors.slice(0, 20)) console.log(`  ${line}`);
}
process.exit(fail === 0 && errors.length === 0 ? 0 : 1);
