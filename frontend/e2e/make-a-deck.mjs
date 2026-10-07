// The three "make a deck" buttons, against the REAL `POST /api/decks/` (HISTORY §17BU.D).
//
// Why this script exists at all. Learning steps C, D and E each grew a button that makes a
// flashcard deck — from a course lesson (`CourseContent.svelte`), from a programme session
// (`Programme.svelte`) and from a concept (`DeckFromConcept.svelte`) — and all three were built in
// parallel with step A, which owned the endpoint. So all three were verified against a `page.route`
// MOCK answering the agreed §API shape (`prompts/README.md` §9; `take-home.mjs` and
// `school-mode.mjs` still carry theirs). Nothing had ever pressed one of them against the real
// endpoint, which is how the thing that this run found stayed hidden: the create path REFUSED a
// name longer than 120 characters, and all three buttons GENERATE their name from a title whose own
// `max_length` is 200.
//
// What it drives, in a real browser, against both real servers:
//
//   1. a lesson, as the person running the course: the button makes a deck of the lesson's three
//      exercises IN ORDER, placed on the course, and the course's Flashcards panel lists it;
//   2. the same lesson, as a PARTICIPANT: a deck of their own, NOT placed — the one thing that
//      differs between the two readers of the same button (`CourseContent.svelte: makeDeck`);
//   3. a lesson whose title is longer than a deck name may be: the deck is still made, with the
//      name cut to fit. This failed with a 400 and the sentence "The deck could not be made."
//      before `backend/flashcards/serializers.py` was fixed in the same commit;
//   4. a programme session, as the organiser: "Take home" makes a deck placed on the event, and
//      the reader is told so;
//   5. the same session, as a VISITOR: the deck is simply theirs, and the event's panel does not
//      grow a row;
//   6. a concept: the deck is made, and the confirmation LINKS to it (it did not until this run —
//      §17BU.D) and the deck page shows the concept's exercises as cards;
//   7. pressing each of the three a SECOND time. The design answer is a second deck, not a
//      refusal: `POST /api/decks/` creates a row every time and `already_placed` can only fire for
//      a deck that is already on that node, which a brand-new one never is
//      (`flashcards/rules.py: place_block_reason`). So the course ends with two placements, the
//      event with two, and the concept with two decks of the same name.
//
// All scratch state is created and removed through the real API (e2e/CLAUDE.md trap 1: prefer the
// seeded demo users over registering), and the cleanup is confirmed by an AUTHENTICATED re-query,
// which bypasses the 60 s anonymous read cache (trap 12). The CONCEPT is the seeded `calka`
// (`manage.py seed_concepts`) and is not modified — only the decks made from it are removed.
//
// Run (ports must match the servers that are up). Clear the file cache with the backend DOWN:
// emptying `cachedata/` under a running server leaves an entry the server still holds open and the
// next read of it answers `OSError: [Errno 116] Stale file handle` as a 500 on an unrelated
// endpoint, which looks like a product bug and is not one.
//   rm -rf backend/cachedata/*          # backend stopped
//   E2E_BASE=http://localhost:5254 E2E_API=http://127.0.0.1:8154/api node e2e/make-a-deck.mjs
//
// First run against real servers: 2026-10-07, 45 checks, 0 failed, 0 console errors
// (`after/d-make-a-deck`).
//
// Screenshots land in e2e/screens/make-a-deck-*.png and are meant to be LOOKED at.

import { mkdirSync } from 'node:fs';
import { englishContext } from './english.mjs';

let chromium;
try {
	({ chromium } = await import('playwright'));
} catch {
	({ chromium } = await import('playwright-core'));
}

const BASE = process.env.E2E_BASE ?? 'http://localhost:5254';
// Tolerant of both spellings: `flashcards.mjs` documents `E2E_API` WITH the `/api` suffix and
// `take-home.mjs` without it, and a run that gets it wrong fails at the first login in a way that
// reads like a dead backend (e2e/CLAUDE.md trap 4).
const API = (process.env.E2E_API ?? 'http://127.0.0.1:8154').replace(/\/api\/?$/, '') + '/api';

// Michał runs the course and hosts the event — he has to run both, because the whole point of
// sections 2 and 5 is the SAME button pressed by somebody who does not. Ola is that somebody:
// enrolled on the course, a plain visitor to the event. Kasia is the one seeded staff account and
// therefore the only one who can touch a feature flag (`/api/feature-flags/` is IsAdminUser).
const OWNER = 'michal@edmat.example';
const VISITOR = 'ola@edmat.example';
const STAFF = 'kasia@edmat.example';
const PASSWORD = process.env.E2E_DEMO_PASSWORD ?? 'password123';
// The seeded concept with linked exercises (`manage.py seed_concepts`). Read, never written.
const CONCEPT = 'calka';
const RUN = Date.now();
const SHOTS = new URL('./screens/', import.meta.url).pathname;
mkdirSync(SHOTS, { recursive: true });

let pass = 0,
	fail = 0;
const check = (label, ok, extra = '') => {
	if (ok) pass++;
	else fail++;
	console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${label} ${ok ? '' : extra}`);
};

async function tokenFor(email) {
	const response = await fetch(`${API}/auth/login/`, {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify({ username: email, password: PASSWORD })
	});
	if (!response.ok) throw new Error(`login ${email}: ${response.status}`);
	return (await response.json()).token;
}

function api(token) {
	const headers = { 'Content-Type': 'application/json', Authorization: `Token ${token}` };
	return {
		async get(path) {
			const r = await fetch(`${API}${path}`, { headers });
			return { status: r.status, body: r.status === 204 ? null : await r.json().catch(() => null) };
		},
		async send(method, path, body) {
			const r = await fetch(`${API}${path}`, {
				method,
				headers,
				body: body === undefined ? undefined : JSON.stringify(body)
			});
			return { status: r.status, body: r.status === 204 ? null : await r.json().catch(() => null) };
		}
	};
}

const settle = (ms) => new Promise((done) => setTimeout(done, ms));

/** Sign in through the real form. Two traps in five lines: the identifier field is `type="text"`
 *  since the guardian accounts (e2e/CLAUDE.md trap 13), so `input[type="email"]` matches nothing
 *  on /login; and filling before the bundle has hydrated submits the form natively and goes
 *  nowhere (trap 25), so this waits for the root layout's own boot request, registered BEFORE
 *  `goto`. Copied from `flashcards.mjs`, which is where both were learned. */
async function signIn(page, email) {
	const booted = page
		.waitForResponse((r) => r.url().includes('/feature-flags/'), { timeout: 30000 })
		.catch(() => null);
	await page.goto(`${BASE}/login`, { waitUntil: 'load' });
	await booted;
	await settle(1500);
	await page.locator('form input[autocomplete="username"]').fill(email);
	await page.locator('form input[type="password"]').fill(PASSWORD);
	await page.locator('form button[type="submit"]').click();
	await page.waitForURL((url) => !url.pathname.includes('/login'), { timeout: 20000 });
	await settle(800);
}

const errors = [];
const fontNoise = [];
/** The dev server refuses KaTeX's own font files with a 403 in a WORKTREE, because
 *  `frontend/node_modules` is a symlink to the main checkout and that path is outside Vite's
 *  `server.fs` allow list (e2e/CLAUDE.md trap 26). An environment fact, not a product one — the
 *  production build serves the fonts itself. Bucketed and REPORTED rather than dropped: a count
 *  that quietly swallowed "403" would also swallow a real one. Matched on the RESPONSE url,
 *  because the console line for a refused request carries no url in its text. */
const isFontNoise = (text) => text.includes('/katex/dist/fonts/');
function watch(page, label = 'normal') {
	page.on('pageerror', (e) => errors.push(`${label}: pageerror ${e}`));
	page.on('console', (msg) => {
		if (msg.type() !== 'error') return;
		// A bare "Failed to load resource: 403" names nothing, so it is matched against the
		// response log: if every 403 this page saw was a KaTeX font, the console line is the same
		// thing said twice.
		if (msg.text().includes('403') && fontNoise.length > 0) return;
		errors.push(`${label}: ${msg.text()}`);
	});
	page.on('response', (r) => {
		if (r.status() < 400) return;
		if (isFontNoise(r.url())) fontNoise.push(r.url());
		else errors.push(`${label}: ${r.status()} ${r.url()}`);
	});
}

const shoot = (page, name) =>
	page.screenshot({ path: `${SHOTS}make-a-deck-${name}.png`, fullPage: true });

// ---- the fixture, through the real API ---------------------------------------------------------

console.log('\n0. Building the fixture through the real API');

const staffToken = await tokenFor(STAFF);
const ownerToken = await tokenFor(OWNER);
const visitorToken = await tokenFor(VISITOR);
const owner = api(ownerToken);
const visitor = api(visitorToken);
const staff = api(staffToken);

await staff.send('PATCH', '/feature-flags/flashcards/', { is_enabled: true });

const exerciseRows = (await owner.get('/exercises/?difficulty=medium')).body ?? [];
const exerciseIds = exerciseRows.slice(0, 3).map((e) => Number(e.id));
// A FOURTH, for section 3's lesson. `CourseItem` is unique per (course, exercise), so filing one
// of the first three into a second lesson of the same course answers `already_in_course` (400) —
// and the lesson then points at nothing, so its button refuses with "This session points at no
// exercises" before the request under test is ever made. That cost this script's first run one
// FAIL that had nothing to do with what it is testing.
const extraExerciseId = Number(exerciseRows[3]?.id);
check(
	'four corpus exercises to work with',
	exerciseIds.length === 3 && Number.isInteger(extraExerciseId),
	JSON.stringify([exerciseIds, extraExerciseId])
);

const made = { courseId: null, eventId: null, lessonId: null, longLessonId: null, sessionId: null };
/** Every deck this run creates, so the cleanup can remove the ones the UI made as well as the ones
 *  it asked for — a deck has no natural key and `POST /decks/` makes a new row every time, so a
 *  run that lost track of one would leave somebody's deck list dirtier on each pass. */
const madeDecks = new Set();

const course = (
	await owner.send('POST', '/courses/', {
		title: `E2E make-a-deck course ${RUN}`,
		description: 'Scratch course for e2e/make-a-deck.mjs; it deletes itself at the end.',
		visibility: 'public',
		status: 'open',
		enrollment_policy: 'open'
	})
).body;
made.courseId = course?.id ? String(course.id) : null;
check('the course is created', Boolean(made.courseId), JSON.stringify(course).slice(0, 200));

const chapter = (
	await owner.send('POST', `/courses/${made.courseId}/chapters/`, { title: 'Week 1' })
).body;

const LESSON_TITLE = `Integration by substitution ${RUN}`;
const lesson = (
	await owner.send('POST', `/courses/${made.courseId}/lessons/`, {
		chapter: chapter.id,
		title: LESSON_TITLE
	})
).body;
made.lessonId = lesson?.id ? String(lesson.id) : null;
for (const exercise of exerciseIds) {
	const item = await owner.send('POST', `/courses/${made.courseId}/items/`, {
		lesson: lesson.id,
		exercise
	});
	if (item.status !== 201) throw new Error(`item ${exercise}: ${JSON.stringify(item.body)}`);
}

// Section 3's lesson. `Lesson.title` is `max_length=200` and a deck name is 120, so the generated
// `"{lesson} — flashcards"` is 150-odd characters — the exact shape that used to 400.
const LONG_TITLE = `${'Całkowanie przez podstawienie i przez części '.repeat(3)}${RUN}`;
const longLesson = (
	await owner.send('POST', `/courses/${made.courseId}/lessons/`, {
		chapter: chapter.id,
		title: LONG_TITLE,
		order: 1
	})
).body;
made.longLessonId = longLesson?.id ? String(longLesson.id) : null;
const longItem = await owner.send('POST', `/courses/${made.courseId}/items/`, {
	lesson: longLesson.id,
	exercise: extraExerciseId
});
check(
	'a lesson whose generated deck name would not fit, pointing at one exercise',
	`${LONG_TITLE} — flashcards`.length > 120 && longItem.status === 201,
	`${LONG_TITLE.length} chars, item ${longItem.status} ${JSON.stringify(longItem.body).slice(0, 120)}`
);

await visitor.send('POST', `/courses/${made.courseId}/enrol/`, {});

const starts = new Date(Date.now() + 7 * 86400000);
const event = (
	await owner.send('POST', '/events/', {
		title: `E2E make-a-deck event ${RUN}`,
		summary: 'An event made by an e2e run.',
		description: 'Built by `e2e/make-a-deck.mjs`; it deletes itself at the end.',
		status: 'published',
		visibility: 'public',
		starts_at: starts.toISOString(),
		duration_minutes: 240,
		location_kind: 'onsite',
		location_text: 'Sala 1',
		language: 'en',
		audience: 'university'
	})
).body;
made.eventId = event?.id ? String(event.id) : null;
check('the event is created', Boolean(made.eventId), JSON.stringify(event).slice(0, 200));

const SESSION_TITLE = `Integrals, slowly ${RUN}`;
const session = (
	await owner.send('POST', `/events/${made.eventId}/sessions/`, {
		title: SESSION_TITLE,
		abstract: 'Two exercise links, so "Take home" means something.',
		starts_at: new Date(starts.getTime() + 3600000).toISOString(),
		duration_minutes: 90,
		links: [
			{ exercise: exerciseIds[0], role: 'live', label: 'Worked in the room' },
			{ exercise: exerciseIds[1], role: 'homework', label: 'Afterwards' }
		]
	})
).body;
made.sessionId = session?.id ? String(session.id) : null;
check(
	"the session's take-home count is the server's own",
	session?.takehome_count === 2,
	String(session?.takehome_count)
);

const conceptExercises = (await owner.get(`/concepts/${CONCEPT}/exercises/`)).body ?? [];
check(
	`the seeded concept "${CONCEPT}" has exercises to make a deck of`,
	conceptExercises.length > 0,
	JSON.stringify(conceptExercises)
);

const browser = await chromium.launch(
	process.env.CHROME ? { executablePath: process.env.CHROME } : {}
);
const DESKTOP = { width: 1280, height: 1100 };

/** Sign in through the real form ONCE per account and hand every later context that account's
 *  saved storage state. `POST /api/auth/login/` is throttled at 10/min per IP
 *  (`accounts/throttles.py`), and three `tokenFor` calls plus one browser sign-in per section would
 *  exhaust it mid-run — which reads exactly like a broken login page (`flashcards.mjs` has the full
 *  story). Reusing the state is not a shortcut: the token lives in `localStorage`
 *  (`lib/state/token.svelte.ts`), so this is the session a person who signed in already has. */
const sessions = new Map();
async function sessionFor(email) {
	const cached = sessions.get(email);
	if (cached) return cached;
	const ctx = await browser.newContext({ viewport: DESKTOP });
	const page = await ctx.newPage();
	await signIn(page, email);
	const state = await ctx.storageState();
	await ctx.close();
	sessions.set(email, state);
	return state;
}

async function pageFor(email, label) {
	const ctx = await englishContext(browser, BASE, {
		viewport: DESKTOP,
		storageState: await sessionFor(email)
	});
	const page = await ctx.newPage();
	watch(page, label);
	return { ctx, page };
}

/** `goto`, then wait for the root layout's own boot request before anything is clicked. Restoring
 *  a session skips the sign-in navigation that used to give the bundle time to hydrate, and every
 *  control in the header is in the served HTML long before a click on it does anything (trap 25). */
async function open(page, path) {
	const booted = page
		.waitForResponse((r) => r.url().includes('/feature-flags/'), { timeout: 30000 })
		.catch(() => null);
	await page.goto(`${BASE}${path}`, { waitUntil: 'load' });
	await booted;
	await settle(900);
}

/** The deck ids placed on a node, newest last, as the API answers them. Read instead of trusting
 *  the page, and then compared WITH the page — a panel that lists a row the API does not have (or
 *  the other way round) is the two-surfaces-disagree bug these checks exist to catch. */
async function placedDeckIds(client, kind, id) {
	const r = await client.get(`/nodes/${kind}/${id}/decks/`);
	return { status: r.status, ids: (r.body ?? []).map((p) => String(p.deck.id)) };
}

try {
	// ---- 1. A lesson, pressed by the person running the course --------------------------------
	{
		console.log('\n1. /courses/[id] → "Make a deck from this week", as the instructor');
		const { ctx, page } = await pageFor(OWNER, 'course-owner');
		await open(page, `/courses/${made.courseId}`);
		const row = page.locator(`li.lesson#course-lesson-${made.lessonId}`);
		await row.waitFor({ timeout: 20000 });
		const button = row.getByRole('button', { name: 'Make a deck from this week' });
		check('the button is on the lesson', (await button.count()) === 1);
		await button.click();
		const note = row.locator('.deck-note');
		await note.waitFor({ timeout: 20000 });
		const noteText = (await note.textContent()) ?? '';
		check('the lesson confirms the deck by name', noteText.includes('Deck made:'), noteText);
		await shoot(page, '1-lesson-deck-made');

		// Read the id out of the link rather than guessing it (and the link is the other half of
		// the check: a confirmation with no door is a dead end — section 6 is about exactly that).
		const href = await note.locator('a').getAttribute('href');
		const deckId = href?.split('/').filter(Boolean).pop() ?? null;
		check('the note links to the new deck', Boolean(deckId), `href ${href}`);
		if (deckId) madeDecks.add(deckId);

		const deck = (await owner.get(`/decks/${deckId}/`)).body;
		check(
			"the real endpoint made a deck of the lesson's three exercises",
			deck?.card_count === 3 && deck?.skipped === undefined,
			JSON.stringify({ cards: deck?.card_count })
		);
		check(
			'and recorded the lesson as its source',
			deck?.source_kind === 'lesson' && String(deck?.source_id) === made.lessonId,
			JSON.stringify({ kind: deck?.source_kind, id: deck?.source_id })
		);
		check(
			'and placed it on the course, because an instructor may',
			deck?.placements?.length === 1 &&
				deck.placements[0].node?.kind === 'course' &&
				String(deck.placements[0].node?.id) === made.courseId,
			JSON.stringify(deck?.placements)
		);
		const cards = (await owner.get(`/decks/${deckId}/cards/`)).body ?? [];
		check(
			"the cards are in the lesson's own order",
			JSON.stringify(cards.map((c) => Number(c.exercise?.id))) === JSON.stringify(exerciseIds),
			JSON.stringify(cards.map((c) => c.exercise?.id))
		);

		// Press it a SECOND time. The design answer is a second deck (see the header): the endpoint
		// creates a row every time, and `already_placed` cannot fire for a deck that did not exist
		// a moment ago.
		await button.click();
		await page.waitForFunction(
			([selector, first]) =>
				document.querySelector(selector)?.getAttribute('href')?.endsWith(`/${first}`) === false,
			[`li.lesson#course-lesson-${made.lessonId} .deck-note a`, deckId],
			{ timeout: 20000 }
		);
		const secondHref = await note.locator('a').getAttribute('href');
		const secondId = secondHref?.split('/').filter(Boolean).pop() ?? null;
		if (secondId) madeDecks.add(secondId);
		check('pressing it again makes a SECOND deck, not a refusal', secondId !== deckId, secondHref);
		const placed = await placedDeckIds(owner, 'course', made.courseId);
		check(
			'and both are on the course',
			placed.ids.length === 2 && placed.ids.includes(deckId) && placed.ids.includes(secondId),
			JSON.stringify(placed)
		);

		// The UI's own half of that: the course page's Flashcards panel, after a reload.
		await open(page, `/courses/${made.courseId}`);
		const panel = page.locator('section.decks-panel');
		await panel.waitFor({ timeout: 20000 });
		await page.waitForFunction(
			() => (document.querySelectorAll('section.decks-panel ul li').length ?? 0) >= 2,
			undefined,
			{ timeout: 20000 }
		);
		check(
			"the course's Flashcards panel lists both decks",
			(await panel.locator('ul li').count()) === 2,
			`${await panel.locator('ul li').count()} rows`
		);
		check(
			'and each row links to its deck and offers the study door',
			(await panel.locator(`ul li a[href$="/flashcards/${deckId}"]`).count()) === 1 &&
				(await panel.locator('ul li a.study').count()) === 2
		);
		await shoot(page, '2-course-panel-two-decks');
		await ctx.close();
	}

	// ---- 2. The same lesson, pressed by a participant -----------------------------------------
	{
		console.log('\n2. the same button, pressed by a PARTICIPANT');
		const { ctx, page } = await pageFor(VISITOR, 'course-participant');
		await open(page, `/courses/${made.courseId}`);
		const row = page.locator(`li.lesson#course-lesson-${made.lessonId}`);
		await row.waitFor({ timeout: 20000 });
		const button = row.getByRole('button', { name: 'Make a deck from this week' });
		check('a participant is offered the button too', (await button.count()) === 1);
		await button.click();
		const note = row.locator('.deck-note');
		await note.waitFor({ timeout: 20000 });
		const href = await note.locator('a').getAttribute('href');
		const deckId = href?.split('/').filter(Boolean).pop() ?? null;
		if (deckId) madeDecks.add(deckId);
		const deck = (await visitor.get(`/decks/${deckId}/`)).body;
		check(
			"the participant's deck holds the same three exercises",
			deck?.card_count === 3,
			String(deck?.card_count)
		);
		check(
			'but is NOT placed on the course — placing is a curatorial act',
			Array.isArray(deck?.placements) && deck.placements.length === 0,
			JSON.stringify(deck?.placements)
		);
		const placed = await placedDeckIds(owner, 'course', made.courseId);
		check(
			"and the course's placements are still the instructor's two",
			placed.ids.length === 2 && !placed.ids.includes(deckId),
			JSON.stringify(placed)
		);
		await shoot(page, '3-participant-private-deck');
		await ctx.close();
	}

	// ---- 3. A lesson title longer than a deck name may be -------------------------------------
	{
		console.log('\n3. a lesson whose generated deck name is over the 120-character cap');
		const { ctx, page } = await pageFor(OWNER, 'long-title');
		await open(page, `/courses/${made.courseId}`);
		const row = page.locator(`li.lesson#course-lesson-${made.longLessonId}`);
		await row.waitFor({ timeout: 20000 });
		await row.getByRole('button', { name: 'Make a deck from this week' }).click();
		const note = row.locator('.deck-note');
		await note.waitFor({ timeout: 20000 });
		const text = (await note.textContent()) ?? '';
		check(
			'the deck is made rather than refused',
			text.includes('Deck made:') && !text.includes('could not be made'),
			text.slice(0, 160)
		);
		const href = await note.locator('a').getAttribute('href');
		const deckId = href?.split('/').filter(Boolean).pop() ?? null;
		if (deckId) madeDecks.add(deckId);
		const deck = (await owner.get(`/decks/${deckId}/`)).body;
		check(
			'and its name is the generated one, cut to fit',
			deck?.name?.length === 120 && `${LONG_TITLE} — flashcards`.startsWith(deck.name),
			`${deck?.name?.length} chars: ${deck?.name}`
		);
		await shoot(page, '4-long-title-truncated');
		await ctx.close();
	}

	// ---- 4. A programme session, pressed by the organiser --------------------------------------
	{
		console.log('\n4. /events/[id] → "Take home", as the organiser');
		const { ctx, page } = await pageFor(OWNER, 'event-organiser');
		await open(page, `/events/${made.eventId}`);
		const row = page.locator('li.session', { hasText: SESSION_TITLE });
		await row.waitFor({ timeout: 20000 });
		const button = row.getByRole('button', { name: 'Take home' });
		check(
			"the button carries the server's own count",
			(await button.textContent())?.includes('(2)'),
			await button.textContent()
		);
		await button.click();
		const done = row.locator('.take-home-done');
		await done.waitFor({ timeout: 20000 });
		const doneText = (await done.textContent()) ?? '';
		check(
			'the organiser is told the deck went ON THE EVENT',
			doneText.includes('on this event'),
			doneText
		);
		await shoot(page, '5-session-take-home');

		// No link in this confirmation, so the deck is found the way the panel finds it.
		const placed = await placedDeckIds(owner, 'event', made.eventId);
		check('exactly one deck is now on the event', placed.ids.length === 1, JSON.stringify(placed));
		const deckId = placed.ids[0];
		if (deckId) madeDecks.add(deckId);
		const deck = (await owner.get(`/decks/${deckId}/`)).body;
		check(
			"it holds the session's two exercises and names the session as its source",
			deck?.card_count === 2 &&
				deck?.source_kind === 'session' &&
				String(deck?.source_id) === made.sessionId,
			JSON.stringify({ cards: deck?.card_count, kind: deck?.source_kind, id: deck?.source_id })
		);

		await button.click();
		await settle(2500);
		const placedAgain = await placedDeckIds(owner, 'event', made.eventId);
		check(
			'pressing it again makes a second deck, also placed',
			placedAgain.ids.length === 2 && placedAgain.ids.includes(deckId),
			JSON.stringify(placedAgain)
		);
		for (const id of placedAgain.ids) madeDecks.add(id);

		await open(page, `/events/${made.eventId}`);
		const panel = page.locator('section.decks-panel');
		await panel.waitFor({ timeout: 20000 });
		await page.waitForFunction(
			() => (document.querySelectorAll('section.decks-panel ul li').length ?? 0) >= 2,
			undefined,
			{ timeout: 20000 }
		);
		check(
			"the event's Flashcards panel lists both",
			(await panel.locator('ul li').count()) === 2,
			`${await panel.locator('ul li').count()} rows`
		);
		await shoot(page, '6-event-panel-two-decks');
		await ctx.close();
	}

	// ---- 5. The same session, pressed by a visitor ---------------------------------------------
	{
		console.log('\n5. the same button, pressed by a VISITOR');
		const { ctx, page } = await pageFor(VISITOR, 'event-visitor');
		await open(page, `/events/${made.eventId}`);
		const row = page.locator('li.session', { hasText: SESSION_TITLE });
		await row.waitFor({ timeout: 20000 });
		await row.getByRole('button', { name: 'Take home' }).click();
		const done = row.locator('.take-home-done');
		await done.waitFor({ timeout: 20000 });
		const doneText = (await done.textContent()) ?? '';
		check(
			'…and is told the deck is simply theirs, not placed on the event',
			doneText.includes('in your decks') && !doneText.includes('on this event'),
			doneText
		);
		const theirs = ((await visitor.get('/decks/')).body ?? []).filter(
			(d) => d.name === `${SESSION_TITLE} — take home`
		);
		check(
			"it is in the visitor's own decks, unplaced",
			theirs.length === 1 && theirs[0].placements.length === 0 && theirs[0].card_count === 2,
			JSON.stringify(theirs.map((d) => ({ cards: d.card_count, placed: d.placements.length })))
		);
		for (const d of theirs) madeDecks.add(String(d.id));
		const placed = await placedDeckIds(owner, 'event', made.eventId);
		check(
			"and the event's panel did not grow a row",
			placed.ids.length === 2,
			JSON.stringify(placed)
		);
		await shoot(page, '7-visitor-private-deck');
		await ctx.close();
	}

	// ---- 6. A concept -------------------------------------------------------------------------
	{
		console.log(`\n6. /concepts/${CONCEPT} → "Make a deck from this concept"`);
		const { ctx, page } = await pageFor(OWNER, 'concept');
		await open(page, `/concepts/${CONCEPT}`);
		const button = page.getByRole('button', { name: 'Make a deck from this concept' });
		await button.waitFor({ timeout: 20000 });
		check('the button is on the concept page', (await button.count()) === 1);
		await button.click();
		const note = page.locator('p.made');
		await note.waitFor({ timeout: 20000 });
		const noteText = (await note.textContent()) ?? '';
		check('the page confirms the deck by name', noteText.includes('Deck made:'), noteText);
		// Added in this commit (§17BU.D): the sentence used to be a dead end, which is exactly the
		// gap the other two buttons do not have.
		const href = await note.locator('a').getAttribute('href');
		const deckId = href?.split('/').filter(Boolean).pop() ?? null;
		check('and links to it', Boolean(deckId), `href ${href}`);
		if (deckId) madeDecks.add(deckId);
		await shoot(page, '8-concept-deck-made');

		const deck = (await owner.get(`/decks/${deckId}/`)).body;
		check(
			"the deck holds the concept's exercises",
			deck?.card_count === conceptExercises.length,
			`${deck?.card_count} cards for ${conceptExercises.length} exercises`
		);
		check(
			'names the concept as its source, by numeric pk',
			deck?.source_kind === 'concept' && Number.isInteger(deck?.source_id),
			JSON.stringify({ kind: deck?.source_kind, id: deck?.source_id })
		);
		check(
			'and is placed nowhere — a concept is not a node a deck sits on',
			deck?.placements?.length === 0,
			JSON.stringify(deck?.placements)
		);

		// Follow the link, which is the whole point of adding it.
		await open(page, `/flashcards/${deckId}`);
		await page.locator('.cards li.card').first().waitFor({ timeout: 20000 });
		check(
			'the link opens the deck, with one card per exercise',
			(await page.locator('.cards li.card').count()) === conceptExercises.length,
			`${await page.locator('.cards li.card').count()} cards`
		);
		check(
			'and the deck page is titled with the deck',
			(await page.locator('h1').first().textContent())?.includes('Deck made:') === false &&
				(await page.locator('h1').first().textContent())?.trim() === deck?.name,
			await page.locator('h1').first().textContent()
		);
		await shoot(page, '9-concept-deck-page');

		await open(page, `/concepts/${CONCEPT}`);
		await button.waitFor({ timeout: 20000 });
		await button.click();
		await page.waitForFunction(
			([first]) =>
				document.querySelector('p.made a')?.getAttribute('href')?.endsWith(`/${first}`) === false,
			[deckId],
			{ timeout: 20000 }
		);
		const secondId = (await note.locator('a').getAttribute('href'))
			?.split('/')
			.filter(Boolean)
			.pop();
		if (secondId) madeDecks.add(secondId);
		check('pressing it again makes a second deck of the same name', secondId !== deckId, secondId);
		const sameName = ((await owner.get('/decks/')).body ?? []).filter((d) => d.name === deck?.name);
		check(
			'and both are in the maker’s own decks',
			sameName.length === 2,
			JSON.stringify(sameName.map((d) => d.id))
		);
		await ctx.close();
	}
} finally {
	await browser.close();

	// ---- cleanup, confirmed through AUTHENTICATED re-queries (trap 12) -------------------------
	for (const id of madeDecks) await owner.send('DELETE', `/decks/${id}/`);
	// The visitor owns two of them, so they refuse the owner's DELETE with a 404 — remove those as
	// the person who made them (`rules.can_edit`: the owner and nobody else).
	for (const id of madeDecks) await visitor.send('DELETE', `/decks/${id}/`);
	if (made.courseId) await owner.send('DELETE', `/courses/${made.courseId}/`);
	if (made.eventId) await owner.send('DELETE', `/events/${made.eventId}/`);

	const ownerLeft = ((await owner.get('/decks/')).body ?? []).filter((d) =>
		String(d.name).includes(String(RUN))
	);
	const visitorLeft = ((await visitor.get('/decks/')).body ?? []).filter((d) =>
		String(d.name).includes(String(RUN))
	);
	check(
		'every scratch deck is gone from both accounts',
		ownerLeft.length === 0 && visitorLeft.length === 0,
		JSON.stringify([ownerLeft.map((d) => d.name), visitorLeft.map((d) => d.name)])
	);
	const concept = await owner.get(`/concepts/${CONCEPT}/exercises/`);
	check(
		'the seeded concept is untouched',
		concept.status === 200 && (concept.body ?? []).length === conceptExercises.length,
		JSON.stringify(concept.body)
	);
}

check('zero console/page errors', errors.length === 0, errors.join(' | ').slice(0, 600));
if (fontNoise.length > 0) {
	console.log(
		`  note  ${fontNoise.length} KaTeX font requests were refused by the dev server's fs allow` +
			' list (worktree symlink, not a product fault — e2e/CLAUDE.md trap 26)'
	);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
