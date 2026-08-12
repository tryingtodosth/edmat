// Linking real content from the chapter/lesson dialogs, and the two new actions on a comment.
//
//   backend:  DJANGO_CORS_ALLOWED_ORIGINS=http://localhost:5174 manage.py runserver 127.0.0.1:8021
//   frontend: PUBLIC_API_BASE_URL=http://localhost:8021/api npx vite dev --port 5174
//   E2E_BASE=http://localhost:5174 E2E_API=http://127.0.0.1:8021/api node e2e/course-content-links.mjs
//
// What only a browser can show: that the linking section is actually INSIDE the chapter dialog (it
// is nested in that dialog's own form, which is invalid HTML if it brings its own — the add button
// would have submitted the dialog and saved the chapter instead), that a PASTED ADDRESS becomes a
// real row rather than text, and that a comment's "⋯" now offers keeping and filing it.
let chromium;
try {
	({ chromium } = await import('playwright'));
} catch {
	({ chromium } = await import('playwright-core'));
}

const BASE = process.env.E2E_BASE ?? 'http://localhost:5174';
const API = process.env.E2E_API ?? 'http://127.0.0.1:8021/api';

let pass = 0;
let fail = 0;
const errors = [];
let ignoredAssets = 0;
const check = (label, ok, extra = '') => {
	if (ok) {
		pass++;
		console.log(`  ok   ${label}`);
	} else {
		fail++;
		console.log(`  FAIL ${label} ${extra}`);
	}
};

async function api(path, { token, method = 'GET', body } = {}) {
	const res = await fetch(`${API}${path}`, {
		method,
		headers: {
			'Content-Type': 'application/json',
			...(token ? { Authorization: `Token ${token}` } : {})
		},
		body: body ? JSON.stringify(body) : undefined
	});
	const text = await res.text();
	let parsed;
	try {
		parsed = text ? JSON.parse(text) : null;
	} catch {
		parsed = text;
	}
	return { status: res.status, body: parsed };
}

// Signing in as a seeded account rather than registering: registration is throttled per IP and a
// script that registers on every run exhausts it, then fails in ways that look like a regression.
const login = await api('/auth/login/', {
	method: 'POST',
	body: { username: 'kasia@edmat.example', password: 'password123' }
});
if (login.status !== 200) {
	console.error('could not sign in as the seeded account:', login.status, login.body);
	process.exit(1);
}
const TOKEN = login.body.token;

const stamp = Date.now();
const course = await api('/courses/', {
	token: TOKEN,
	method: 'POST',
	body: {
		title: `Content links ${stamp}`,
		summary: 'Fixture for the content-linking e2e run.',
		visibility: 'public',
		status: 'open',
		enrollment_policy: 'open'
	}
});
const COURSE_ID = course.body?.id;
const chapter = await api(`/courses/${COURSE_ID}/chapters/`, {
	token: TOKEN,
	method: 'POST',
	body: { title: 'Week 1', description: 'Original description.' }
});
const CHAPTER_ID = chapter.body?.id;

// A real exercise to link, and a real comment on it to file and to keep.
const exercises = await api('/exercises/?limit=1');
const EXERCISE_ID = exercises.body?.[0]?.id;
const comment = await api(`/exercises/${EXERCISE_ID}/comments/`, {
	token: TOKEN,
	method: 'POST',
	body: { body: `Why is step 3 allowed? ${stamp}` }
});
const COMMENT_ID = comment.body?.id;

if (!COURSE_ID || !CHAPTER_ID || !EXERCISE_ID || !COMMENT_ID) {
	console.error('fixtures failed', { COURSE_ID, CHAPTER_ID, EXERCISE_ID, COMMENT_ID });
	process.exit(1);
}
console.log(
	`fixtures: course ${COURSE_ID}, chapter ${CHAPTER_ID}, exercise ${EXERCISE_ID}, comment ${COMMENT_ID}`
);

const browser = await chromium.launch(
	process.env.CHROME ? { executablePath: process.env.CHROME } : {}
);
const ctx = await browser.newContext();
const page = await ctx.newPage();
page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
page.on('console', (m) => {
	if (m.type() !== 'error') return;
	// The same out-of-root asset failures also surface here, with no URL to tell them apart by —
	// so the generic resource-load line is dropped and real errors (which carry a message) are kept.
	if (m.text().startsWith('Failed to load resource')) return;
	errors.push(`console: ${m.text()}`);
});
// Vite refuses to serve anything outside the project root, so a checkout whose `node_modules` is a
// symlink to another directory (a git worktree, typically) 403s on KaTeX's font files. It is an
// artifact of where the checkout is, not of the app, and it would otherwise drown a real error.
page.on('response', (r) => {
	if (r.status() >= 400 && r.url().includes('/@fs/')) ignoredAssets++;
});

const settle = (ms = 900) => page.waitForTimeout(ms);
async function goto(path, waitFor) {
	// 'load', never 'networkidle': the notification SSE stream is permanently in flight on an
	// authenticated page, so networkidle only ever fires when that stream has failed. What replaces
	// it is an explicit wait on the element the checks are about to read — a fixed timer is either
	// too short (the course page needs a couple of seconds to resolve its chapters) or wasted.
	await page.goto(`${BASE}${path}`, { waitUntil: 'load' });
	if (waitFor) {
		try {
			await page.locator(waitFor).first().waitFor({ state: 'visible', timeout: 20000 });
		} catch (e) {
			await page.screenshot({ path: `/tmp/e2e-fail-${Date.now()}.png`, fullPage: true });
			throw e;
		}
	}
	await settle();
}

// Signed in through the real form, so the session is one the app itself created. Waited on
// explicitly and then ASSERTED: a submit fired before the page had hydrated silently does nothing,
// and every later check then fails as "the curator's buttons are missing" — which reads exactly
// like a broken feature rather than a script that never signed in.
await goto('/login', 'form input[type="email"]');
// The input being VISIBLE is not the same as the page being interactive — it is in the server-
// rendered HTML, so waiting on it can still land before hydration, and a click before then is
// handled by nobody. The first page of a fresh context also pays Vite's cold-compile cost.
await settle(3500);
await page.locator('form input[type="email"]').fill('kasia@edmat.example');
await page.locator('form input[type="password"]').fill('password123');
await page.locator('form button[type="submit"]').click();
await page
	.locator('header', { hasText: 'Kasia' })
	.first()
	.waitFor({ state: 'visible', timeout: 20000 });
await settle(1200);

// --- 1. the linking section lives inside the chapter dialog ---------------------------------------
console.log('\n[1] The chapter dialog carries a linked-content section');
await goto(`/courses/${COURSE_ID}`, '.chapter__actions button');
// Scoped to the chapter's own action row: the label is just "Edit", which several other
// buttons on the page also carry.
const editChapter = page.locator('.chapter__actions button', { hasText: 'Edit' }).first();
check('the chapter offers an edit button', (await editChapter.count()) === 1);
await editChapter.click();
await settle(700);

const dialog = page.locator('.modal-form').first();
check('the dialog is open', await dialog.isVisible());
check('it has a "Linked content" section', (await page.locator('section.links').count()) === 1);
check(
	'which says nothing is linked yet',
	(await page.locator('section.links .links__empty').innerText()).length > 0
);
// The nesting rule: the section must NOT bring its own form, or the browser drops it and the add
// button submits the chapter dialog instead.
check(
	'the section brings no nested <form>',
	(await page.locator('section.links form').count()) === 0
);

// --- 2. a pasted address becomes a real row -------------------------------------------------------
console.log('\n[2] Pasting an exercise address files it into the chapter');
await page.locator('section.links input[inputmode="url"]').fill(`${BASE}/exercises/${EXERCISE_ID}`);
await page.locator('section.links button', { hasText: 'Add link' }).click();
await settle(2000);

const afterExercise = await api(`/courses/${COURSE_ID}/`, { token: TOKEN });
const chapterItems = afterExercise.body?.chapters?.[0]?.items ?? [];
check('a real course item now exists', chapterItems.length === 1, JSON.stringify(chapterItems));
check('it is an exercise', chapterItems[0]?.kind === 'exercise');
check(
	'pointing at the one that was pasted',
	String(chapterItems[0]?.exercise) === String(EXERCISE_ID)
);

// --- 3. an address that means nothing is refused in words -----------------------------------------
console.log('\n[3] Nonsense is refused rather than filed');
await goto(`/courses/${COURSE_ID}`, '.chapter__actions button');
await page.locator('.chapter__actions button', { hasText: 'Edit' }).first().click();
await settle(700);
await page.locator('section.links input[inputmode="url"]').fill('not a link at all');
await page.locator('section.links button', { hasText: 'Add link' }).click();
await settle(700);
check(
	'the section says it does not recognise it',
	(await page.locator('section.links .links__error').count()) === 1
);
const afterNonsense = await api(`/courses/${COURSE_ID}/`, { token: TOKEN });
check('and nothing was filed', (afterNonsense.body?.chapters?.[0]?.items ?? []).length === 1);

// --- 4. the comment menu offers keeping and filing -------------------------------------------------
console.log('\n[4] A comment can be kept, and filed into a course');
await goto(`/exercises/${EXERCISE_ID}`, '.comment__menu button');
// Scoped to the comment THIS run created: a real exercise page already has a thread on it, and
// `.first()` would act on somebody else's comment — which is exactly what it did, silently.
const mine = page.locator(`li#comment-${COMMENT_ID}`);
const menu = mine.locator('.comment__menu button').first();
check('a comment offers its "⋯" menu', (await menu.count()) === 1);
await menu.click();
await settle(500);
const menuText = await mine.locator('.comment__menu').first().innerText();
check('it offers keeping it', menuText.includes('Save this'), menuText);
check('it offers linking it to a course', menuText.includes('Link to a course'), menuText);
check('it offers copying a link to it', menuText.includes('Copy link'), menuText);

// The anchor is what makes a comment addressable at all — and is exactly what the course's own
// paste-a-link field reads back.
check(
	'the comment carries its own anchor id',
	(await page.locator(`li#comment-${COMMENT_ID}`).count()) === 1
);

console.log('\n[5] Keeping it puts it on the settings page');
await mine
	.locator('.comment__menu button[role="menuitem"]', { hasText: 'Save this' })
	.first()
	.click();
await settle(1500);
const saved = await api('/comments/saved/', { token: TOKEN });
check('the server has it', saved.status === 200 && saved.body.length >= 1, String(saved.status));
check(
	'with the target it needs to be linkable',
	saved.body?.[0]?.target_type === 'exercise' &&
		String(saved.body?.[0]?.target_id) === String(EXERCISE_ID)
);

await goto('/settings');
const savedSection = page.locator('.saved-comments');
await savedSection.waitFor({ state: 'visible', timeout: 10000 });
// Waited on rather than read straight away: the list fetches on mount, so the first thing in it
// is "Loading…" and reading immediately asserts against that.
await savedSection.locator('li').first().waitFor({ state: 'visible', timeout: 15000 });
const savedText = await savedSection.innerText();
check(
	'the settings page lists it',
	savedText.includes(`Why is step 3 allowed? ${stamp}`),
	savedText.slice(0, 200)
);

console.log('\n[6] Filing the thread into a course through the comment menu');
await goto(`/exercises/${EXERCISE_ID}`, '.comment__menu button');
const mineAgain = page.locator(`li#comment-${COMMENT_ID}`);
await mineAgain.locator('.comment__menu button').first().click();
await settle(400);
await mineAgain
	.locator('.comment__menu button[role="menuitem"]', { hasText: 'Link to a course' })
	.first()
	.click();
await settle(1500);
const linkDialog = page.locator('.modal-form').first();
check('the dialog opens', await linkDialog.isVisible());
// Scoped to the dialog: the header has a language picker, and `select` unscoped would match it.
await linkDialog.locator('select').first().selectOption(String(COURSE_ID));
await settle(1200);
await linkDialog.locator('button[type="submit"]').click();
await settle(1800);

const afterThread = await api(`/courses/${COURSE_ID}/`, { token: TOKEN });
const allItems = [
	...(afterThread.body?.chapters ?? []).flatMap((c) => c.items ?? []),
	...(afterThread.body?.unfiled_items ?? [])
];
const threadItem = allItems.find((i) => i.kind === 'discussion');
check('the thread is now a real item in the course', Boolean(threadItem), JSON.stringify(allItems));
check(
	'labelled with its opening words',
	(threadItem?.label ?? '').includes('Why is step 3'),
	threadItem?.label
);
check('carrying where to read it', threadItem?.discussion_target_type === 'exercise');

// --- cleanup ---------------------------------------------------------------------------------------
await api(`/courses/${COURSE_ID}/`, { token: TOKEN, method: 'DELETE' });
await api(`/comments/${COMMENT_ID}/save-for-me/`, { token: TOKEN, method: 'DELETE' });
await api(`/comments/${COMMENT_ID}/`, { token: TOKEN, method: 'DELETE' });
const leftovers = await api('/comments/saved/', { token: TOKEN });
check('nothing kept behind', (leftovers.body ?? []).length === 0, JSON.stringify(leftovers.body));

console.log(`\n(${ignoredAssets} out-of-root asset 403s ignored — see the note above)`);
console.log('\n--- console/page errors ---');
if (errors.length === 0) console.log('  none');
else errors.forEach((e) => console.log(`  ${e}`));

console.log(`\n${pass} passed, ${fail} failed, ${errors.length} console/page errors`);
await browser.close();
process.exit(fail === 0 && errors.length === 0 ? 0 : 1);
