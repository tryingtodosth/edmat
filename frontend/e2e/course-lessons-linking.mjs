// End-to-end check of creating lessons, and of linking the four kinds of content into either a
// lesson or a chapter, against real servers.
//
//   backend:  DJANGO_CORS_ALLOWED_ORIGINS=http://localhost:5175 manage.py runserver 127.0.0.1:8010
//   frontend: PUBLIC_API_BASE_URL=http://localhost:8010/api npx vite dev --port 5175
//   node e2e/course-lessons-linking.mjs
//
// Playwright is deliberately not a dependency of this repo — `npx playwright install chromium`.
//
// What only a browser can show here: that a lesson can be CREATED at all (the service function and
// the endpoint both existed all along and nothing rendered a way in), that editing a chapter opens a
// real dialog rather than the inline row it used to be, and that a chapter picker actually files the
// item where it says — the last one having been a silent no-op, since `chapter` was not a writable
// field and DRF dropped it without a word.
let chromium;
try {
	({ chromium } = await import('playwright'));
} catch {
	({ chromium } = await import('playwright-core'));
}

const BASE = process.env.E2E_BASE ?? 'http://localhost:5175';
const API = process.env.E2E_API ?? 'http://127.0.0.1:8010/api';

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

// --- setup through the API -----------------------------------------------------------------------
// The fixtures are made over HTTP rather than by reaching into the database, so this script only ever
// exercises the same system a person uses. Signing in as a seeded account rather than registering:
// registration is throttled per IP, and a script that registers on every run exhausts it and then
// fails in ways that look exactly like a regression.
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

const login = await api('/auth/login/', {
	method: 'POST',
	body: { username: 'kasia@edmat.example', password: 'password123' }
});
if (login.status !== 200) {
	console.error('could not sign in as the seeded moderator:', login.status, login.body);
	process.exit(1);
}
const TOKEN = login.body.token;

const stamp = Date.now();
const course = await api('/courses/', {
	token: TOKEN,
	method: 'POST',
	body: {
		title: `Linking check ${stamp}`,
		summary: 'Fixture for the lesson/linking e2e run.',
		visibility: 'public',
		status: 'open',
		enrollment_policy: 'open'
	}
});
if (course.status !== 201) {
	console.error('could not create the fixture course:', course.status, course.body);
	process.exit(1);
}
const COURSE_ID = course.body.id;

const chapter = await api(`/courses/${COURSE_ID}/chapters/`, {
	token: TOKEN,
	method: 'POST',
	body: { title: 'Week 1', description: 'Original description.' }
});
const CHAPTER_ID = chapter.body.id;

// A published event, since a draft is deliberately refused — it is not announced yet.
const event = await api('/events/', {
	token: TOKEN,
	method: 'POST',
	body: {
		title: `Guest lecture ${stamp}`,
		status: 'published',
		starts_at: new Date(Date.now() + 7 * 864e5).toISOString(),
		duration_minutes: 90,
		location_kind: 'online',
		online_url: 'https://example.org/talk'
	}
});
const EVENT_ID = event.body?.id;

const materials = await api('/materials/');
const MATERIAL_ID = materials.body?.[0]?.id;

console.log(
	`fixtures: course ${COURSE_ID}, chapter ${CHAPTER_ID}, event ${EVENT_ID}, material ${MATERIAL_ID}`
);

// --- the browser ---------------------------------------------------------------------------------
const browser = await chromium.launch(
	process.env.CHROME ? { executablePath: process.env.CHROME } : {}
);
const ctx = await browser.newContext();
const page = await ctx.newPage();
page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
page.on('console', (m) => {
	if (m.type() === 'error') errors.push(`console: ${m.text()}`);
});

const settle = (ms = 900) => page.waitForTimeout(ms);
async function goto(path) {
	await page.goto(`${BASE}${path}`, { waitUntil: 'networkidle' });
	await settle();
}

// Sign in through the real form, so the session is one the app itself created.
await goto('/login');
await page.locator('form input[type="email"]').fill('kasia@edmat.example');
await page.locator('form input[type="password"]').fill('password123');
await page.locator('form button[type="submit"]').click();
await settle(2200);

console.log('\n[1] A lesson can be created at all');
await goto(`/courses/${COURSE_ID}`);
check('the course page renders', (await page.locator('h1').innerText()).includes('Linking check'));

const addLesson = page.locator('button', { hasText: 'Add lesson' }).first();
check('the chapter offers "Add lesson"', (await addLesson.count()) === 1);
await addLesson.click();
await settle(500);

const dialog = page.locator('[role="dialog"]');
check('it opens a dialog', (await dialog.count()) === 1);
await dialog.locator('input[type="text"]').first().fill('Tuesday session');
await dialog.locator('textarea').first().fill('What we cover on Tuesday.');
await dialog.locator('textarea').nth(1).fill('Bring the worksheet.');
await dialog.locator('button[type="submit"]').click();
await settle(2000);

check('the dialog closes', (await page.locator('[role="dialog"]').count()) === 0);
check(
	'the new lesson renders in its chapter',
	(await page.locator('.lesson h4', { hasText: 'Tuesday session' }).count()) === 1
);

const afterLesson = await api(`/courses/${COURSE_ID}/`, { token: TOKEN });
const lessons = afterLesson.body.chapters[0].lessons;
check(
	'the lesson is really stored, in the right chapter',
	lessons.length === 1,
	JSON.stringify(lessons)
);
check('its description was saved', lessons[0]?.description === 'What we cover on Tuesday.');
check('its participant notes were saved', lessons[0]?.participant_notes === 'Bring the worksheet.');
const LESSON_ID = lessons[0]?.id;

console.log('\n[2] Editing a chapter opens a modal, and can change the description');
await goto(`/courses/${COURSE_ID}`);
await page.locator('.chapter header button', { hasText: 'Edit' }).first().click();
await settle(500);
const chapterDialog = page.locator('[role="dialog"]');
check('the chapter edit is a dialog', (await chapterDialog.count()) === 1);
check(
	'it is titled for the job',
	(await chapterDialog.getAttribute('aria-label'))?.toLowerCase().includes('chapter')
);
check(
	'it is prefilled with the current title',
	(await chapterDialog.locator('input[type="text"]').first().inputValue()) === 'Week 1'
);
check(
	'and with the current description — which the inline row could not edit at all',
	(await chapterDialog.locator('textarea').first().inputValue()) === 'Original description.'
);
await chapterDialog.locator('input[type="text"]').first().fill('Week 1 — revised');
await chapterDialog.locator('textarea').first().fill('Rewritten in the dialog.');
await chapterDialog.locator('button[type="submit"]').click();
await settle(2000);

const afterEdit = await api(`/courses/${COURSE_ID}/`, { token: TOKEN });
check('the title change was saved', afterEdit.body.chapters[0].title === 'Week 1 — revised');
check(
	'the description change was saved',
	afterEdit.body.chapters[0].description === 'Rewritten in the dialog.',
	afterEdit.body.chapters[0].description
);

console.log('\n[3] Escape closes the dialog without saving');
await goto(`/courses/${COURSE_ID}`);
await page.locator('.chapter header button', { hasText: 'Edit' }).first().click();
await settle(400);
await page.locator('[role="dialog"] input[type="text"]').first().fill('Should not be saved');
await page.keyboard.press('Escape');
await settle(600);
check('Escape closes it', (await page.locator('[role="dialog"]').count()) === 0);
const afterEscape = await api(`/courses/${COURSE_ID}/`, { token: TOKEN });
check(
	'and nothing was written',
	afterEscape.body.chapters[0].title === 'Week 1 — revised',
	afterEscape.body.chapters[0].title
);

console.log('\n[4] The contribute form offers four kinds and both filing targets');
await goto(`/courses/${COURSE_ID}`);
const kindOptions = await page
	.locator('.contribute select')
	.first()
	.locator('option')
	.allInnerTexts();
check('four kinds are offered', kindOptions.length === 4, JSON.stringify(kindOptions));
const targetTexts = await page
	.locator('.contribute select')
	.nth(1)
	.locator('option')
	.allInnerTexts();
check(
	'the chapter itself is a destination',
	targetTexts.some((t) => t.includes('The whole chapter')),
	JSON.stringify(targetTexts)
);
check(
	'and so is each lesson in it',
	targetTexts.some((t) => t.includes('Tuesday session')),
	JSON.stringify(targetTexts)
);

console.log('\n[5] Filing into a chapter actually files it there');
// The regression: this picker existed before and did nothing, because `chapter` was not a writable
// field. A 201 proved nothing — only where the row landed does.
await page.locator('.contribute select').nth(1).selectOption(`chapter:${CHAPTER_ID}`);
await page.locator('.contribute input[type="text"]').first().fill(String(MATERIAL_ID));
await page.locator('.contribute button[type="submit"]').click();
await settle(2200);

const afterFiling = await api(`/courses/${COURSE_ID}/`, { token: TOKEN });
check(
	'the item is on the chapter',
	afterFiling.body.chapters[0].items.length === 1,
	JSON.stringify(afterFiling.body.chapters[0].items)
);
check('and is NOT reported as unfiled', afterFiling.body.unfiled_items.length === 0);
check(
	'it renders under the chapter in the page',
	(await page.locator('.items--chapter .item').count()) === 1
);

console.log('\n[6] An event links in, into a lesson, and is labelled as an event');
await api(`/courses/${COURSE_ID}/items/`, {
	token: TOKEN,
	method: 'POST',
	body: { event: EVENT_ID, lesson: LESSON_ID }
});
await goto(`/courses/${COURSE_ID}`);
const eventRow = page.locator('.lesson .item', { hasText: 'Guest lecture' });
check('the event renders inside the lesson', (await eventRow.count()) === 1);
// Compared case-insensitively: the badge is uppercased in CSS and `innerText` reports what is drawn,
// so an exact match would be asserting the stylesheet rather than the label.
const eventKind = (await eventRow.locator('.kind').innerText()).trim().toLowerCase();
check(
	'labelled as an event, not a material',
	eventKind === 'event',
	`got ${JSON.stringify(eventKind)}`
);
const href = await eventRow.locator('a.label').getAttribute('href');
check('and links to the event itself', href?.includes(`/events/${EVENT_ID}`), href ?? '(none)');

console.log('\n[7] A draft event is refused, with a reason');
const draft = await api('/events/', {
	token: TOKEN,
	method: 'POST',
	body: {
		title: `Unannounced ${stamp}`,
		status: 'draft',
		starts_at: new Date(Date.now() + 8 * 864e5).toISOString(),
		location_kind: 'online',
		online_url: 'https://example.org/secret'
	}
});
const refused = await api(`/courses/${COURSE_ID}/items/`, {
	token: TOKEN,
	method: 'POST',
	body: { event: draft.body.id }
});
check('linking a draft event is refused', refused.status === 400, String(refused.status));

console.log('\n[8] Moving an item from a chapter to a lesson clears the chapter');
const chapterItemId = afterFiling.body.chapters[0].items[0].id;
const moved = await api(`/courses/${COURSE_ID}/items/${chapterItemId}/`, {
	token: TOKEN,
	method: 'PATCH',
	body: { lesson: LESSON_ID, chapter: null }
});
check('the move succeeds', moved.status === 200, String(moved.status));
check('it is now in the lesson', moved.body?.lesson === LESSON_ID);
check('and no longer on the chapter', moved.body?.chapter === null);

// --- cleanup ---------------------------------------------------------------------------------------
// Everything this run created, removed through the API. A script that leaves fixtures behind makes
// the next run's "is this mine?" ambiguous.
await api(`/courses/${COURSE_ID}/`, { token: TOKEN, method: 'DELETE' });
await api(`/events/${EVENT_ID}/`, { token: TOKEN, method: 'DELETE' });
await api(`/events/${draft.body.id}/`, { token: TOKEN, method: 'DELETE' });

console.log('\n--- console/page errors ---');
if (errors.length === 0) console.log('  none');
else errors.forEach((e) => console.log(`  ${e}`));

console.log(`\n${pass} passed, ${fail} failed, ${errors.length} console/page errors`);
await browser.close();
process.exit(fail === 0 && errors.length === 0 ? 0 : 1);
