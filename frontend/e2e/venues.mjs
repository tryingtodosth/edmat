// Conference step A — venues, rooms, room bookings and the building's checklist, in a real browser.
//
// Run it with both servers up (CONFERENCE-BRIEF.md §4 rule 9 assigns this branch ports 8101/5201):
//   backend:  cd backend && DJANGO_CORS_ALLOWED_ORIGINS=http://localhost:5201,http://127.0.0.1:5201 \
//               ../.venv/bin/python3 manage.py runserver 127.0.0.1:8101
//   frontend: cd frontend && PUBLIC_API_BASE_URL=http://127.0.0.1:8101/api npx vite dev --port 5201 --strictPort
//   E2E_BASE=http://localhost:5201 E2E_API=http://127.0.0.1:8101 node e2e/venues.mjs
//
// `venues/tests.py` already pins the rules — who may decide a booking, what `room_busy` means, that
// a mandatory item blocks publishing. What only a browser shows is the half no unit test reaches:
//
//  * that `/venues` and `/venues/{slug}` actually render a building and its two capacities;
//  * that the Venue panel on the event page really asks for a room and really prints the building's
//    refusal **in words** rather than a bare 400;
//  * that the Checklist panel appears, starts a snapshot, and says why Publish is blocked;
//  * that the `venues` kill switch takes the panels, the footer link and the pages away for a
//    NON-STAFF visitor (e2e/CLAUDE.md trap 10: a staff-bypassed check proves nothing), while
//    `/events` keeps working.
//
// It signs in as the seeded demo users rather than registering (trap 1: registration is throttled
// per IP, and a run that exhausts it fails in ways that read like a code regression). Everything it
// creates is stamped with `RUN` and removed at the end through the real API.
let chromium;
try {
	({ chromium } = await import('playwright'));
} catch {
	({ chromium } = await import('playwright-core'));
}

// English copy in the checks below → ask for the English interface; the default is Polish (trap 24).
import { englishContext } from './english.mjs';

const BASE = process.env.E2E_BASE ?? 'http://localhost:5201';
const API = (process.env.E2E_API ?? 'http://127.0.0.1:8101').replace(/\/api\/?$/, '') + '/api';
const PASSWORD = process.env.E2E_DEMO_PASSWORD ?? 'password123';
// Kasia is the one seeded staff account (`seed_demo_users`), so she is the only person who can
// create a building, name its first administrator, and pull the kill switch — all three are
// deliberately platform-staff powers (CONFERENCE-BRIEF.md §6.4, and `feature-flags` is IsAdminUser).
const STAFF = 'kasia@edmat.example';
const ORGANISER = 'michal@edmat.example';
const STRANGER = 'ola@edmat.example';
const RUN = Date.now();
const SLUG = `e2e-venue-${RUN}`;

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
		// This run deliberately provokes 403s (the kill-switch section, and the private booking list
		// a stranger is not shown) and 404s (a venue that is not theirs). A 500 still fails the run.
		if (msg.type() === 'error' && !/status of 40[0349]\b/.test(msg.text())) {
			errors.push(`[${name}] console: ${msg.text()}`);
		}
	});
	return page;
}

async function person(name) {
	const ctx = await englishContext(browser, BASE, { viewport: { width: 1280, height: 950 } });
	return wire(await ctx.newPage(), name);
}

const settle = (page, ms = 900) => page.waitForTimeout(ms);

async function goto(page, path) {
	// 'load', not 'networkidle' — the notification SSE stream keeps a request open on every signed-in
	// page, so networkidle never fires there (trap 2).
	//
	// The `/feature-flags/` wait is trap 25: the root layout fetches the flags on boot, and every
	// check below that reads a flag-gated link is meaningless until that response has landed —
	// `featureFlagsStore.isEnabled` fails OPEN before it, so a killed feature's link is still on the
	// page. Registered BEFORE `goto`, or the response is already past by the time we ask.
	const flags = page
		.waitForResponse((r) => r.url().includes('/feature-flags/'), { timeout: 20000 })
		.catch(() => null);
	await page.goto(`${BASE}${path}`, { waitUntil: 'load' });
	await flags;
	await settle(page, 900);
}

/** Wait for a section to actually carry its content rather than its "Loading…" state.
 *
 * Trap 11 and trap 25 together: on a cold Vite dev server the first navigation pays a multi-second
 * compile, and a fixed `waitForTimeout` that is generous on a quiet machine is not generous on one
 * running seven worktrees' servers at once. Every content check below goes through this, so a slow
 * box makes the run slower rather than making it lie. */
async function waitForText(page, selector, needle, timeout = 25000) {
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
	let body = null;
	try {
		body = text ? JSON.parse(text) : null;
	} catch {
		body = text;
	}
	return { status: response.status, body };
}

/** The token is what the app itself persists (`token.svelte.ts`), so seating one is the same state a
 *  real login leaves behind — and it keeps the run under the login throttle (trap 1). */
async function seat(page, token) {
	await page.goto(`${BASE}/`, { waitUntil: 'domcontentloaded' });
	await page.evaluate((value) => localStorage.setItem('edmat-auth-token', value), token);
	await goto(page, '/');
}

const staffToken = await tokenFor(STAFF);
const organiserToken = await tokenFor(ORGANISER);
const strangerToken = await tokenFor(STRANGER);

const created = { venueId: null, eventId: null, bookingId: null };

async function setFlag(enabled) {
	await api(staffToken, '/feature-flags/venues/', {
		method: 'PATCH',
		body: JSON.stringify({ is_enabled: enabled })
	});
}

async function cleanUp() {
	await setFlag(true);
	if (created.eventId) {
		await api(organiserToken, `/events/${created.eventId}/`, { method: 'DELETE' });
	}
	if (created.venueId) {
		// A building is deactivated, never deleted (house rule 12) — so the check afterwards is that
		// it has left the public list, not that the row is gone.
		await api(staffToken, `/venues/${created.venueId}/`, { method: 'DELETE' });
	}
}

console.log('\n1. A building, its rooms, and the public pages');

const venue = await api(staffToken, '/venues/', {
	method: 'POST',
	body: JSON.stringify({
		name: `E2E Building ${RUN}`,
		slug: SLUG,
		address: 'Banacha 2, Warszawa',
		contact_note: 'Ask at the lodge before 20:00',
		security_phone: '+48 22 000 00 00'
	})
});
check('platform staff creates a building', venue.status === 201, JSON.stringify(venue.body));
created.venueId = venue.body?.id;

const strangerVenue = await api(strangerToken, '/venues/', {
	method: 'POST',
	body: JSON.stringify({ name: 'Not mine', slug: `nope-${RUN}` })
});
check('an ordinary account cannot create one', strangerVenue.status === 403, strangerVenue.status);

const smallRoom = await api(staffToken, '/rooms/', {
	method: 'POST',
	body: JSON.stringify({
		venue_id: created.venueId,
		name: `Aula ${RUN}`,
		number: '4070',
		floor: '4',
		seated_capacity: 40,
		fire_capacity: 60,
		accessible: true,
		has_av: true
	})
});
check('a room with both capacities', smallRoom.status === 201, JSON.stringify(smallRoom.body));

const impossible = await api(staffToken, '/rooms/', {
	method: 'POST',
	body: JSON.stringify({
		venue_id: created.venueId,
		name: `Bad ${RUN}`,
		seated_capacity: 200,
		fire_capacity: 50
	})
});
check(
	'more chairs than the fire capacity is refused',
	impossible.status === 400,
	impossible.status
);

const visitor = await person('visitor');
await goto(visitor, '/venues');
check(
	'the directory lists the new building',
	await waitForText(visitor, '.page', `E2E Building ${RUN}`)
);

await goto(visitor, `/venues/${SLUG}`);
check(
	'the venue page names the building',
	await waitForText(visitor, '.page', `E2E Building ${RUN}`)
);
const venueText = await visitor.locator('.page').textContent();
check('…and shows both capacities', venueText.includes('40') && venueText.includes('60'));
check('…and the four seeded platform checklists are offered', venueText.includes('guest lecture'));
await visitor.screenshot({ path: 'e2e/screens/venues-detail.png', fullPage: true });

console.log('\n2. Asking for a room, and the building answering');

// Michał runs the event; Kasia's building answers it. That split is the whole point of the model.
await api(staffToken, `/venues/${created.venueId}/staff/`, {
	method: 'POST',
	body: JSON.stringify({ user_id: (await api(staffToken, '/auth/me/')).body.id })
});

const startsAt = new Date(Date.now() + 20 * 24 * 3600 * 1000);
const endsAt = new Date(startsAt.getTime() + 2 * 3600 * 1000);
const event = await api(organiserToken, '/events/', {
	method: 'POST',
	body: JSON.stringify({
		title: `E2E venue event ${RUN}`,
		starts_at: startsAt.toISOString(),
		duration_minutes: 120,
		location_kind: 'onsite',
		location_text: 'TBC',
		audience: 'university',
		language: 'en',
		visibility: 'public'
	})
});
check('the organiser has a draft event', event.status === 201, JSON.stringify(event.body));
created.eventId = event.body?.id;

const organiser = await person('organiser');
await seat(organiser, organiserToken);
await goto(organiser, `/events/${created.eventId}`);
const venuePanel = organiser.locator('.venue-panel');
check(
	'the Venue panel is on the event page',
	await waitForText(organiser, '.venue-panel', 'Venue and room')
);

// The form itself, driven for real — the point of a browser run.
await venuePanel
	.locator('select')
	.first()
	.selectOption({ label: `E2E Building ${RUN}` });
await settle(organiser, 900);
await venuePanel.locator('select').nth(1).selectOption({ index: 1 });
const headcountBox = venuePanel.locator('input[inputmode="numeric"]');
await headcountBox.fill('500');
await venuePanel.locator('button[type="submit"]').click();
await settle(organiser, 1400);
const overCapacity = await venuePanel.textContent();
check(
	'too many people gets the fire-capacity refusal in words',
	overCapacity.includes('fire safety instruction'),
	overCapacity.slice(0, 200)
);
await organiser.screenshot({ path: 'e2e/screens/venues-over-capacity.png', fullPage: true });

await headcountBox.fill('30');
await venuePanel.locator('button[type="submit"]').click();
await settle(organiser, 1500);
check(
	'a sane request is made and shows as waiting',
	(await venuePanel.textContent()).includes('Waiting for the building')
);

const queue = await api(staffToken, `/venues/${created.venueId}/bookings/`);
created.bookingId = queue.body?.[0]?.id;
check('the building sees it in its own queue', queue.status === 200 && queue.body.length === 1);

const desk = await person('desk');
await seat(desk, staffToken);
await goto(desk, `/venues/${SLUG}/manage`);
const managePage = desk.locator('.page');
check(
	'the building desk shows the waiting request',
	await waitForText(desk, '.page', `E2E venue event ${RUN}`)
);
await desk.screenshot({ path: 'e2e/screens/venues-manage.png', fullPage: true });

await managePage.locator('.decide input').first().fill('Yes, side door stays locked.');
await managePage.getByRole('button', { name: 'Approve', exact: true }).first().click();
await settle(desk, 1600);
check('approving moves it out of the queue', (await managePage.textContent()).includes('Approved'));

const strangerQueue = await api(strangerToken, `/venues/${created.venueId}/bookings/`);
check('a stranger cannot read the queue', strangerQueue.status === 403, strangerQueue.status);

// The Add… entry is for staff of a venue ONLY — the browse link lives in the footer for everybody
// else. Asserted from both sides, because an entry that appears for everyone is the same bug as one
// that appears for nobody.
await goto(desk, '/');
await desk.getByRole('button', { name: 'Add' }).first().click();
await settle(desk, 700);
check(
	'a venue administrator gets the Venues entry in Add…',
	(await desk.getByRole('menuitem', { name: 'Venues you run' }).count()) === 1
);

const outsider = await person('outsider');
await seat(outsider, strangerToken);
await outsider.getByRole('button', { name: 'Add' }).first().click();
await settle(outsider, 700);
check(
	'…and somebody who runs no building does not',
	(await outsider.getByRole('menuitem', { name: 'Venues you run' }).count()) === 0
);

console.log('\n3. The checklist, and the publish block');

const reloaded = await person('organiser-2');
await seat(reloaded, organiserToken);
await goto(reloaded, `/events/${created.eventId}`);
const checklistPanel = reloaded.locator('.checklist-panel');
check(
	'the Checklist panel appears once a room is approved',
	await waitForText(reloaded, '.checklist-panel', 'checklist')
);

await checklistPanel.locator('select').first().selectOption({ index: 1 });
await checklistPanel.locator('button[type="submit"]').click();
await settle(reloaded, 1800);
const started = await checklistPanel.textContent();
check('a checklist snapshot is started', started.includes('Required'), started.slice(0, 200));
check('…and it spells the publish block out', started.includes('cannot be published'));
await reloaded.screenshot({ path: 'e2e/screens/venues-checklist.png', fullPage: true });

const blocked = await api(organiserToken, `/events/${created.eventId}/`, {
	method: 'PATCH',
	body: JSON.stringify({ status: 'published' })
});
check(
	'publishing is refused, with its reason',
	blocked.status === 409 && blocked.body?.detail === 'checklist_pending',
	`${blocked.status} ${JSON.stringify(blocked.body)}`
);

const instances = await api(organiserToken, `/events/${created.eventId}/checklist/`);
for (const item of instances.body[0].items) {
	await api(organiserToken, `/checklist-items/${item.id}/`, {
		method: 'PATCH',
		body: JSON.stringify({ status: 'in_progress' })
	});
}
const nowOk = await api(organiserToken, `/events/${created.eventId}/`, {
	method: 'PATCH',
	body: JSON.stringify({ status: 'published' })
});
check(
	'…and lifts once everything required is under way',
	nowOk.status === 200 && nowOk.body?.status === 'published',
	`${nowOk.status} ${JSON.stringify(nowOk.body).slice(0, 120)}`
);

const signoffItem = instances.body[0].items.find((i) => i.requires_venue_signoff);
if (signoffItem) {
	const refused = await api(organiserToken, `/checklist-items/${signoffItem.id}/`, {
		method: 'PATCH',
		body: JSON.stringify({ status: 'done' })
	});
	check(
		'an organiser cannot tick an item the building signs off',
		refused.status === 400 && refused.body?.detail === 'needs_venue_signoff',
		`${refused.status} ${JSON.stringify(refused.body)}`
	);
	const signed = await api(staffToken, `/checklist-items/${signoffItem.id}/sign-off/`, {
		method: 'POST'
	});
	check('…but the building can', signed.status === 200 && signed.body?.status === 'done');
} else {
	check('the seeded template carries a sign-off item', false, 'none found');
}

console.log('\n4. The kill switch (as a non-staff visitor — trap 10)');

await setFlag(false);
const off = await person('flag-off');
await seat(off, organiserToken);

const apiOff = await api(organiserToken, '/venues/');
check('the venue API closes for a non-staff caller', apiOff.status === 403, apiOff.status);

const eventsStillUp = await api(organiserToken, '/events/');
check('…while /api/events/ keeps working', eventsStillUp.status === 200, eventsStillUp.status);

await goto(off, '/');
// The flags have landed by now (`goto` waits for that response), so a `Venues` still in the footer
// here is the link genuinely failing to go, not a race.
const footer = off.locator('footer.site-footer');
check(
	'the footer link goes',
	!(await footer.textContent()).includes('Venues'),
	(await footer.textContent()).slice(0, 120)
);

await goto(off, `/events/${created.eventId}`);
check('the Venue panel goes', (await off.locator('.venue-panel').count()) === 0);
check('the Checklist panel goes', (await off.locator('.checklist-panel').count()) === 0);
check(
	'…and the rest of the event page is still there',
	(await off.locator('h1').textContent()).includes(`E2E venue event ${RUN}`)
);
await off.screenshot({ path: 'e2e/screens/venues-killed.png', fullPage: true });

await goto(off, '/venues');
check(
	'the /venues page shows the disabled notice',
	(await off.locator('.feature-disabled').count()) === 1,
	(await off.locator('body').textContent()).slice(0, 120)
);

await setFlag(true);

await cleanUp();

const gone = await api(null, '/venues/');
check(
	'the scratch building has left the public list',
	Array.isArray(gone.body) && !gone.body.some((v) => v.slug === SLUG)
);

console.log(`\n${pass} passed, ${fail} failed`);
if (errors.length) console.log('page errors:\n' + errors.join('\n'));
else console.log('zero console/page errors');
await browser.close();
process.exit(fail === 0 && errors.length === 0 ? 0 : 1);
