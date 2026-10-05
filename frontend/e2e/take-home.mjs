// Learning step E — take-home decks from a programme session, and event ↔ course through the
// organisation, in a real browser (`prompts/06-event-takeaways.md`).
//
// Run it with both servers up (this branch's ports are 8135 / 5235):
//   backend:  cd backend && DJANGO_CORS_ALLOWED_ORIGINS=http://localhost:5235,http://127.0.0.1:5235 \
//               ../.venv/bin/python3 manage.py runserver 127.0.0.1:8135
//   frontend: cd frontend && npm run dev -- --port 5235 --strictPort
//   rm -rf backend/cachedata/*
//   E2E_BASE=http://localhost:5235 E2E_API=http://127.0.0.1:8135/api node e2e/take-home.mjs
//
// `backend/events/test_takehome.py` already pins the rules — who gets 404, what a private linked
// set contributes, what `organizations` off answers. What only a browser shows is the half no unit
// test reaches:
//
//  * that the "Take home" button appears on the session that has exercises and nowhere else, with
//    the server's own count on it;
//  * that pressing it makes ONE call with every id, and that an organiser is told the deck went on
//    the event while a visitor is told it is theirs;
//  * that the related-courses panel names the organisation before it lists the courses, and that a
//    stranger genuinely does not see the unlisted one (exact counts — e2e/CLAUDE.md trap 8);
//  * that `organizations` off takes the panel away from a NON-STAFF reader while the event page
//    itself keeps rendering, and `flashcards` off takes the button away (trap 10: a staff-bypassed
//    check proves nothing).
//
// **`POST /api/decks/` does not exist on this branch.** It is learning step A's endpoint, and C, D
// and E were all told to build against its documented shape and verify against a MOCK
// (`prompts/README.md` §9). So the deck call is intercepted with `page.route` and answered with the
// §API read shape; the real call is verified at integration, after A merges. Everything else here
// is the real API.
//
// It signs in as the seeded demo users rather than registering (trap 1: registration is throttled
// per IP and a run that exhausts it fails in ways that read like a code regression). Everything it
// creates is stamped with `RUN` and cleaned up at the end through the real API.
let chromium;
try {
	({ chromium } = await import('playwright'));
} catch {
	({ chromium } = await import('playwright-core'));
}

// English copy in the checks below → ask for the English interface; the default is Polish (trap 24).
import { englishContext } from './english.mjs';

const BASE = process.env.E2E_BASE ?? 'http://localhost:5235';
const API = (process.env.E2E_API ?? 'http://127.0.0.1:8135').replace(/\/api\/?$/, '') + '/api';
const PASSWORD = process.env.E2E_DEMO_PASSWORD ?? 'password123';
// Kasia is the one seeded staff account (`seed_demo_users`), so she is the only person who can pull
// a kill switch (`feature-flags` is IsAdminUser). Ola hosts the event, founds the body and runs both
// courses — she has to run both ends of every link, because agreeing to one takes two parties
// (`organizations/access.py: link_block_reason`). Michał is the stranger the narrowing is proved on.
const STAFF = 'kasia@edmat.example';
const HOST = 'ola@edmat.example';
const STRANGER = 'michal@edmat.example';
const RUN = Date.now();

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

const browser = await chromium.launch(
	process.env.CHROME ? { executablePath: process.env.CHROME } : {}
);

function wire(page, name) {
	page.on('pageerror', (e) => errors.push(`[${name}] pageerror: ${e.message}`));
	page.on('console', (msg) => {
		// This run deliberately provokes 403s (the kill-switch sections). A 500 still fails it.
		if (msg.type() === 'error' && !/status of (40[0134]|409)\b/.test(msg.text())) {
			errors.push(`[${name}] console: ${msg.text()}`);
		}
	});
	return page;
}

async function person(name) {
	const ctx = await englishContext(browser, BASE, { viewport: { width: 1280, height: 1100 } });
	return wire(await ctx.newPage(), name);
}

const settle = (page, ms = 800) => page.waitForTimeout(ms);

async function goto(page, path) {
	// 'load', not 'networkidle' — the notification SSE stream keeps a request open on every signed-in
	// page (trap 2). The `/feature-flags/` wait is trap 25: a flag-gated control is meaningless until
	// the root layout's own boot request has landed.
	const flags = page
		.waitForResponse((r) => r.url().includes('/feature-flags/'), { timeout: 30000 })
		.catch(() => null);
	await page.goto(`${BASE}${path}`, { waitUntil: 'load' });
	await flags;
	await settle(page);
}

/** Counting an element that is still being fetched is a vacuous check in both directions: an
 *  absent panel "passes" before it could have appeared, and a present one "fails" because the
 *  count ran first (trap 8, and trap 25's lesson in another shape — this cost three FAILs on the
 *  first run of this script). The programme's own session title only renders after
 *  `GET /sessions/` resolves, so waiting for it is what makes every count below mean something. */
async function programmeLoaded(page) {
	return waitForText(page, 'section.programme', 'Integrals, slowly');
}

async function waitForText(page, selector, needle, timeout = 30000) {
	try {
		await page.waitForFunction(
			([sel, text]) => document.querySelector(sel)?.textContent?.includes(text) ?? false,
			[selector, needle],
			{ timeout }
		);
		return true;
	} catch {
		return false;
	}
}

async function tokenFor(email) {
	const response = await fetch(`${API}/auth/login/`, {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify({ username: email, password: PASSWORD })
	});
	return (await response.json()).token;
}

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
	let body;
	try {
		body = text ? JSON.parse(text) : null;
	} catch {
		body = text;
	}
	return { status: response.status, body };
}

/** The token is what the app itself persists (`token.svelte.ts`), so seating one leaves the same
 *  state a real login does — and it keeps the run under the login throttle (trap 1). */
async function seat(page, token) {
	await page.goto(`${BASE}/`, { waitUntil: 'domcontentloaded' });
	await page.evaluate((value) => localStorage.setItem('edmat-auth-token', value), token);
}

let lastDeckRequest = null;

/** Step A's `POST /api/decks/` does not exist yet — answer it with the §API read shape. The OPTIONS
 *  preflight has to be answered too: `apiClient.post` sends `Authorization` and a JSON
 *  content type, which makes this a non-simple cross-origin request. */
async function mockDecks(page, deckName) {
	await page.route('**/api/decks/', async (route) => {
		const cors = {
			'access-control-allow-origin': BASE,
			'access-control-allow-credentials': 'true',
			'access-control-allow-headers': 'authorization,content-type',
			'access-control-allow-methods': 'POST,OPTIONS'
		};
		if (route.request().method() === 'OPTIONS') {
			return route.fulfill({ status: 204, headers: cors });
		}
		const sent = JSON.parse(route.request().postData() ?? '{}');
		lastDeckRequest = sent;
		return route.fulfill({
			status: 201,
			headers: { ...cors, 'content-type': 'application/json' },
			body: JSON.stringify({
				id: 424242,
				name: deckName ?? sent.name,
				audience: 'university',
				is_public: false,
				source_kind: sent.source?.kind ?? '',
				source_id: sent.source?.id ?? null,
				card_count: (sent.exercise_ids ?? []).length,
				due_count: (sent.exercise_ids ?? []).length,
				created_at: new Date().toISOString(),
				can_edit: true,
				placements: sent.placement
					? [{ id: 1, node: { kind: sent.placement.kind, id: sent.placement.id } }]
					: []
			})
		});
	});
}

const staffToken = await tokenFor(STAFF);
const hostToken = await tokenFor(HOST);
const strangerToken = await tokenFor(STRANGER);
check(
	'the three seeded accounts sign in',
	Boolean(staffToken && hostToken && strangerToken),
	`${!!staffToken}/${!!hostToken}/${!!strangerToken}`
);
if (!staffToken || !hostToken || !strangerToken) {
	console.log('\nNo tokens — is `manage.py seed_demo_users` run against this backend?');
	await browser.close();
	process.exit(1);
}

const made = {
	eventId: null,
	sessionId: null,
	setSlug: null,
	orgId: null,
	publicCourseId: null,
	unlistedCourseId: null
};

async function setFlag(key, enabled) {
	await api(staffToken, `/feature-flags/${key}/`, {
		method: 'PATCH',
		body: JSON.stringify({ is_enabled: enabled })
	});
}

async function cleanUp() {
	await setFlag('organizations', true);
	await setFlag('flashcards', true);
	if (made.publicCourseId)
		await api(hostToken, `/courses/${made.publicCourseId}/`, { method: 'DELETE' });
	if (made.unlistedCourseId)
		await api(hostToken, `/courses/${made.unlistedCourseId}/`, { method: 'DELETE' });
	if (made.eventId) await api(hostToken, `/events/${made.eventId}/`, { method: 'DELETE' });
	if (made.setSlug) await api(hostToken, `/exercise-sets/${made.setSlug}/`, { method: 'DELETE' });
	// An organisation is deactivated, never deleted (house rule 12).
	if (made.orgId) await api(hostToken, `/organizations/${made.orgId}/`, { method: 'DELETE' });
}

// ---- the fixture, through the real API -------------------------------------------------------

console.log('\n0. Building the fixture through the real API');

const exercises = await api(null, '/exercises/?difficulty=medium');
const exerciseIds = (Array.isArray(exercises.body) ? exercises.body : [])
	.slice(0, 3)
	.map((e) => e.id);
check('three corpus exercises to work with', exerciseIds.length === 3, JSON.stringify(exerciseIds));

const starts = new Date(Date.now() + 7 * 86400000);
const createdEvent = await api(hostToken, '/events/', {
	method: 'POST',
	body: JSON.stringify({
		title: `E2E take-home ${RUN}`,
		summary: 'An event made by an e2e run.',
		description: 'Built by `e2e/take-home.mjs`; it deletes itself at the end.',
		status: 'published',
		visibility: 'public',
		starts_at: starts.toISOString(),
		duration_minutes: 240,
		location_kind: 'onsite',
		location_text: 'Sala 1',
		language: 'en',
		audience: 'university'
	})
});
made.eventId = createdEvent.body?.id ? String(createdEvent.body.id) : null;
check('the event is created', createdEvent.status === 201, JSON.stringify(createdEvent.body));

const createdSet = await api(hostToken, '/exercise-sets/', {
	method: 'POST',
	body: JSON.stringify({
		name: `E2E set ${RUN}`,
		audience: 'university',
		is_public: false,
		exercise_ids: exerciseIds.slice(1)
	})
});
made.setSlug = createdSet.body?.slug ?? null;
check(
	'a PRIVATE set of two exercises is created',
	createdSet.status === 201 && createdSet.body?.is_public === false,
	JSON.stringify(createdSet.body)
);

const createdSession = await api(hostToken, `/events/${made.eventId}/sessions/`, {
	method: 'POST',
	body: JSON.stringify({
		title: `Integrals, slowly ${RUN}`,
		abstract: 'One exercise link and one set link.',
		starts_at: new Date(starts.getTime() + 3600000).toISOString(),
		duration_minutes: 90,
		links: [
			{ exercise: exerciseIds[0], role: 'live', label: 'Worked in the room' },
			{ exercise_set: made.setSlug, role: 'homework', label: 'Afterwards' }
		]
	})
});
made.sessionId = createdSession.body?.id ? String(createdSession.body.id) : null;
check(
	'a session with one exercise link and one set link',
	createdSession.status === 201,
	JSON.stringify(createdSession.body)
);
check(
	"the session's own takehome_count is 3 (1 direct + 2 from the set)",
	createdSession.body?.takehome_count === 3,
	String(createdSession.body?.takehome_count)
);

// A second session with nothing but a URL link — the button must NOT appear on it.
const plainSession = await api(hostToken, `/events/${made.eventId}/sessions/`, {
	method: 'POST',
	body: JSON.stringify({
		title: `Coffee ${RUN}`,
		kind: 'break',
		starts_at: new Date(starts.getTime() + 2 * 3600000).toISOString(),
		duration_minutes: 30,
		links: [{ url: 'https://example.org/map', role: 'other', label: 'Map' }]
	})
});
check(
	'a URL-only session reports takehome_count 0',
	plainSession.status === 201 && plainSession.body?.takehome_count === 0,
	JSON.stringify(plainSession.body)
);

const listed = await api(null, `/events/${made.eventId}/sessions/${made.sessionId}/exercises/`);
check(
	'the new read endpoint answers the three ids to a signed-out caller',
	listed.status === 200 && listed.body?.length === 3,
	JSON.stringify(listed.body)
);
check(
	'…and the direct link comes first, in programme order',
	String(listed.body?.[0]?.id) === String(exerciseIds[0]),
	JSON.stringify(listed.body?.map((r) => r.id))
);
const privateSet = await api(strangerToken, `/exercise-sets/${made.setSlug}/`);
check(
	'…while the set itself is still private to a stranger',
	privateSet.status === 404,
	String(privateSet.status)
);

const createdOrg = await api(hostToken, '/organizations/', {
	method: 'POST',
	body: JSON.stringify({
		name: `E2E Circle ${RUN}`,
		kind: 'student_circle',
		city: 'Warszawa',
		description: 'Founded by an e2e run.'
	})
});
made.orgId = createdOrg.body?.id ? String(createdOrg.body.id) : null;
const orgSlug = createdOrg.body?.slug ?? null;
check('the organisation is founded', createdOrg.status === 201, JSON.stringify(createdOrg.body));

async function makeCourse(title, visibility) {
	const res = await api(hostToken, '/courses/', {
		method: 'POST',
		body: JSON.stringify({
			title,
			summary: 'A course made by an e2e run.',
			description: 'Deleted at the end of the run.',
			visibility,
			status: 'open',
			enrollment_policy: 'open',
			language: 'en',
			audience: 'university'
		})
	});
	return { id: res.body?.id ? String(res.body.id) : null, status: res.status, body: res.body };
}

const publicCourse = await makeCourse(`E2E workshop course ${RUN}`, 'public');
const unlistedCourse = await makeCourse(`E2E unlisted course ${RUN}`, 'only_you');
made.publicCourseId = publicCourse.id;
made.unlistedCourseId = unlistedCourse.id;
check(
	'two courses: one public, one only_you',
	publicCourse.status === 201 && unlistedCourse.status === 201,
	`${publicCourse.status}/${unlistedCourse.status} ${JSON.stringify(unlistedCourse.body)}`
);

async function link(nodeKind, nodeId, kind = 'runs') {
	return api(hostToken, `/organizations/${made.orgId}/links/`, {
		method: 'POST',
		body: JSON.stringify({ node_kind: nodeKind, node_id: Number(nodeId), kind })
	});
}
const eventLink = await link('event', made.eventId);
const courseLink = await link('course', made.publicCourseId);
const unlistedLink = await link('course', made.unlistedCourseId);
check(
	'the body is linked to the event and to both courses',
	eventLink.status === 201 && courseLink.status === 201 && unlistedLink.status === 201,
	`${eventLink.status}/${courseLink.status}/${unlistedLink.status}`
);

const relatedForHost = await api(hostToken, `/events/${made.eventId}/related-courses/`);
check(
	'related-courses answers BOTH to the person who runs them',
	relatedForHost.status === 200 && relatedForHost.body?.length === 2,
	JSON.stringify(relatedForHost.body?.map((c) => c.title))
);
const relatedForStranger = await api(strangerToken, `/events/${made.eventId}/related-courses/`);
check(
	'…and only the public one to a stranger',
	relatedForStranger.status === 200 &&
		relatedForStranger.body?.length === 1 &&
		relatedForStranger.body[0].visibility === 'public',
	JSON.stringify(relatedForStranger.body?.map((c) => c.title))
);

// ---- the organiser's own page ----------------------------------------------------------------

console.log('\n1. The organiser opens the event');

const host = await person('host');
await mockDecks(host);
await seat(host, hostToken);
await goto(host, `/events/${made.eventId}`);
check('the event page has its title', await waitForText(host, 'h1', `E2E take-home ${RUN}`));
check('the programme has finished loading', await programmeLoaded(host));
// The panel fetches twice (`related-courses` and the node's organisations); wait for its own text
// before counting cards.
check(
	'the related-courses panel has finished loading',
	await waitForText(host, 'section.related-courses', 'Run by')
);

const programme = host.locator('section.programme');
check('the programme is drawn', (await programme.count()) === 1);
const takeHomeButtons = programme.getByRole('button', { name: 'Take home' });
check(
	'exactly ONE session carries a Take home button (the URL-only one does not)',
	(await takeHomeButtons.count()) === 1,
	String(await takeHomeButtons.count())
);
check(
	"…and it carries the server's own count",
	((await takeHomeButtons.first().textContent()) ?? '').includes('3'),
	(await takeHomeButtons.first().textContent()) ?? ''
);

await host.screenshot({ path: 'e2e/screens/take-home-1-organiser-programme.png', fullPage: true });

await takeHomeButtons.first().click();
await settle(host, 1500);
const sessionRow = programme.locator('li.session').filter({ hasText: 'Integrals, slowly' });
const doneText =
	(await sessionRow
		.locator('.take-home-done')
		.textContent()
		.catch(() => '')) ?? '';
check(
	'the organiser is told the deck went ON THE EVENT',
	doneText.includes('on this event'),
	doneText
);
check(
	'one call carried all three ids',
	lastDeckRequest?.exercise_ids?.length === 3,
	JSON.stringify(lastDeckRequest)
);
check(
	"the call named the session as the deck's source",
	lastDeckRequest?.source?.kind === 'session' &&
		String(lastDeckRequest?.source?.id) === String(made.sessionId),
	JSON.stringify(lastDeckRequest?.source)
);
check(
	'…and placed it on the event',
	lastDeckRequest?.placement?.kind === 'event' &&
		String(lastDeckRequest?.placement?.id) === String(made.eventId),
	JSON.stringify(lastDeckRequest?.placement)
);

const panel = host.locator('section.related-courses');
check('the related-courses panel is drawn', (await panel.count()) === 1);
const panelText = (await panel.textContent()) ?? '';
check('it names the organisation it came through', panelText.includes(`E2E Circle ${RUN}`));
check('under a "Run by" line', panelText.includes('Run by'));
check('and says the link is through the body, not direct', panelText.includes('no direct link'));
check(
	'the organiser sees BOTH courses as cards',
	(await panel.locator('.course-card').count()) === 2,
	String(await panel.locator('.course-card').count())
);
check(
	'the organisation name links to its own page',
	(await panel.locator(`a[href$="/organizations/${orgSlug}"]`).count()) >= 1
);

await host.screenshot({ path: 'e2e/screens/take-home-2-organiser-related.png', fullPage: true });

// ---- a stranger ------------------------------------------------------------------------------

console.log('\n2. A signed-in stranger');

const stranger = await person('stranger');
await mockDecks(stranger);
await seat(stranger, strangerToken);
await goto(stranger, `/events/${made.eventId}`);
check('the page loads for them too', await waitForText(stranger, 'h1', `E2E take-home ${RUN}`));
check('their programme loads', await programmeLoaded(stranger));
check(
	'their panel loads',
	await waitForText(stranger, 'section.related-courses', `E2E workshop course ${RUN}`)
);

const strangerPanel = stranger.locator('section.related-courses');
check(
	'the stranger sees ONE course card — the unlisted one is absent',
	(await strangerPanel.locator('.course-card').count()) === 1,
	String(await strangerPanel.locator('.course-card').count())
);
check(
	'…and it is the public one',
	((await strangerPanel.textContent()) ?? '').includes(`E2E workshop course ${RUN}`)
);
check(
	'the unlisted course title appears nowhere on the page',
	!((await stranger.locator('body').textContent()) ?? '').includes(`E2E unlisted course ${RUN}`)
);

const strangerButton = stranger
	.locator('section.programme')
	.getByRole('button', { name: 'Take home' });
check('a visitor gets the button too', (await strangerButton.count()) === 1);
await strangerButton.first().click();
await settle(stranger, 1500);
const strangerDone =
	(await stranger
		.locator('section.programme .take-home-done')
		.textContent()
		.catch(() => '')) ?? '';
check(
	'…and is told the deck is simply theirs, not placed on the event',
	strangerDone.includes('in your decks') && !strangerDone.includes('on this event'),
	strangerDone
);
check(
	'their call carried no placement',
	lastDeckRequest?.placement === undefined,
	JSON.stringify(lastDeckRequest)
);

await stranger.screenshot({ path: 'e2e/screens/take-home-3-stranger.png', fullPage: true });

// ---- the two kill switches, as a NON-STAFF reader (trap 10) -----------------------------------

console.log('\n3. organizations off');

await setFlag('organizations', false);
const killed = await person('killed');
await seat(killed, strangerToken);
await goto(killed, `/events/${made.eventId}`);
check('the event page still renders', await waitForText(killed, 'h1', `E2E take-home ${RUN}`));
// Before asserting the panel is ABSENT: wait for the page's own async content, or the check passes
// against a page that simply had not drawn anything yet.
check('…with its programme', await programmeLoaded(killed));
check(
	'the related-courses panel is gone',
	(await killed.locator('section.related-courses').count()) === 0
);
check('the programme is untouched', (await killed.locator('section.programme').count()) === 1);
const offApi = await api(strangerToken, `/events/${made.eventId}/related-courses/`);
check(
	'the endpoint answers [] rather than 403 — the event page must keep working',
	offApi.status === 200 && Array.isArray(offApi.body) && offApi.body.length === 0,
	`${offApi.status} ${JSON.stringify(offApi.body)}`
);
await killed.screenshot({ path: 'e2e/screens/take-home-4-organizations-off.png', fullPage: true });
await setFlag('organizations', true);

console.log('\n4. flashcards off');

await setFlag('flashcards', false);
const noDecks = await person('no-decks');
await seat(noDecks, strangerToken);
await goto(noDecks, `/events/${made.eventId}`);
check('the programme loads', await programmeLoaded(noDecks));
check(
	'the related-courses panel is back',
	await waitForText(noDecks, 'section.related-courses', 'Run by')
);
check(
	'the Take home button is gone',
	(await noDecks
		.locator('section.programme')
		.getByRole('button', { name: 'Take home' })
		.count()) === 0
);
check(
	'"Add … to My Set" is still there — a neighbouring control is untouched',
	(await noDecks.locator('section.programme').getByRole('button', { name: 'My Set' }).count()) === 1
);
await noDecks.screenshot({ path: 'e2e/screens/take-home-5-flashcards-off.png', fullPage: true });
await setFlag('flashcards', true);

// ---- cleanup ---------------------------------------------------------------------------------

console.log('\n5. Cleaning up through the real API');
await cleanUp();
// Verified through an AUTHENTICATED request: an anonymous list read can be served from the 60 s
// response cache and show a row that is genuinely gone (trap 12).
const goneEvent = await api(hostToken, `/events/${made.eventId}/`);
check('the event is gone', goneEvent.status === 404, String(goneEvent.status));
const goneCourse = await api(hostToken, `/courses/${made.publicCourseId}/`);
check('the public course is gone', goneCourse.status === 404, String(goneCourse.status));
const dissolved = await api(null, `/organizations/?q=${encodeURIComponent(`E2E Circle ${RUN}`)}`);
check(
	'the organisation has left the public list',
	Array.isArray(dissolved.body) && dissolved.body.length === 0,
	JSON.stringify(dissolved.body)
);

check('no console or page errors', errors.length === 0, errors.join(' | '));

console.log(`\n${pass} passed, ${fail} failed`);
if (errors.length > 0) console.log(errors.join('\n'));
await browser.close();
process.exit(fail === 0 ? 0 : 1);
