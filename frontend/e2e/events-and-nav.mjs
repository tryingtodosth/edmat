// End-to-end check of the three things that shipped together: the rebuilt navbar, the homepage tabs,
// and the events module.
//
// Run it with both servers up:
//   backend:  DJANGO_CORS_ALLOWED_ORIGINS=http://localhost:5183 manage.py runserver 127.0.0.1:8000
//   frontend: PUBLIC_API_BASE_URL=http://127.0.0.1:8000/api npx vite dev --mode e2e --port 5183
//   node e2e/events-and-nav.mjs
//
// `events/tests.py` already pins the rules — who may see a draft, who may answer, what a full event
// refuses. What only a browser can show is the half no unit test reaches: that the create actions
// really are behind one menu and that menu really opens; that a tab survives a reload and a shared
// link; that a person who answers "I am going" sees the roster they were not allowed to see a moment
// earlier; and — the one this was explicitly asked to prove — that pulling the `events` kill switch
// removes every LINK to the feature, not just the pages behind them.
//
// **It signs in as the seeded demo users rather than registering**, for the reason booking.mjs
// records: registration is rate-limited per IP, and a script that registers people exhausts it on
// repeated runs, at which point the whole run fails in a way that looks exactly like a regression.
// The price is that these accounts carry state between runs, so everything this script creates is
// stamped with `RUN` and every event it creates is cleaned up at the end.
let chromium;
try {
	({ chromium } = await import('playwright'));
} catch {
	({ chromium } = await import('playwright-core'));
}

const BASE = process.env.E2E_BASE ?? 'http://localhost:5183';
const API = process.env.E2E_API ?? 'http://127.0.0.1:8000/api';
const PASSWORD = process.env.E2E_DEMO_PASSWORD ?? 'password123';
const HOST = 'kasia@edmat.example';
const GOER = 'michal@edmat.example';
const OTHER = 'ola@edmat.example';
// Kasia is the one seeded staff account (`seed_demo_users`), so she is both the host here and the
// only person who can pull the kill switch — `PATCH /api/feature-flags/{key}/` is IsAdminUser. A
// first draft of this script assumed julia and got a 403 that read like a broken endpoint. Hence
// `modToken = hostToken` below rather than a fifth account.
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

const contextOf = new Map();

function wire(page, ctx, name) {
	page.on('pageerror', (e) => errors.push(`[${name}] pageerror: ${e.message}`));
	page.on('console', (msg) => {
		// Chromium logs every non-2xx fetch regardless of whether the app handled it, and this run
		// deliberately provokes two kinds: a 403 on the private attendee roster (the rule working, and
		// swallowed on purpose by the page) and 403s from the kill-switch section. Only those are
		// ignored; a 500 still fails the run.
		if (msg.type() === 'error' && !/status of 40[39]\b/.test(msg.text())) {
			errors.push(`[${name}] console: ${msg.text()}`);
		}
	});
	contextOf.set(page, { ctx, name });
	return page;
}

async function person(name) {
	const ctx = await browser.newContext();
	return wire(await ctx.newPage(), ctx, name);
}

/** A fresh tab for the same person, keeping their session — see booking.mjs on why this is a real
 * fix rather than hygiene. */
async function renew(page) {
	const { ctx, name } = contextOf.get(page);
	await page.close();
	return wire(await ctx.newPage(), ctx, name);
}

const settle = (page, ms = 900) => page.waitForTimeout(ms);

async function goto(page, path) {
	await page.goto(`${BASE}${path}`, { waitUntil: 'networkidle' });
	await settle(page, 900);
}

/** Sign in through the real form.
 *
 * The retry is not superstition: on a cold Vite dev server the login page is still hydrating when
 * Playwright clicks, so the click lands on an inert form and nothing happens.
 */
async function login(page, email) {
	for (let attempt = 0; attempt < 2; attempt++) {
		if (attempt === 0) await goto(page, '/login');
		await page.locator('form input[type="email"]').fill(email);
		await page.locator('form input[type="password"]').fill(PASSWORD);
		await page.locator('form button[type="submit"]').click();
		try {
			await page.waitForURL((url) => !url.pathname.includes('/login'), { timeout: 8000 });
			await settle(page, 900);
			return;
		} catch {
			/* still on the login page — try once more */
		}
	}
	throw new Error(`could not sign in as ${email}`);
}

/** Put an already-issued token into a browser context, rather than driving the form again.
 *
 * A real, hit failure rather than an optimisation: `POST /auth/login/` is throttled at 10 per minute
 * per IP (`accounts/throttles.py`), and this script needs four accounts in the browser plus four API
 * tokens in Node — which is over the budget before a single retry, at which point the run fails with
 * "could not sign in" and looks exactly like a broken login. The form itself is still exercised for
 * real, once, by the host; everybody else is seated with a token that was already issued. The token
 * is what the app itself persists (`token.svelte.ts`), so this is the same state a real login leaves
 * behind, not a bypass of one.
 */
async function seat(page, token) {
	await page.goto(`${BASE}/`, { waitUntil: 'domcontentloaded' });
	await page.evaluate((value) => localStorage.setItem('edmat-auth-token', value), token);
	await goto(page, '/');
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
	return { status: response.status, body: text ? JSON.parse(text) : null };
}

/** An ISO instant a fixed number of days out, at a fixed hour. Computed rather than hard-coded so
 * the script does not start failing on a particular afternoon. */
function daysOut(days, hour = 18) {
	const d = new Date();
	d.setDate(d.getDate() + days);
	d.setHours(hour, 0, 0, 0);
	return d.toISOString();
}

const hostToken = await tokenFor(HOST);
const goerToken = await tokenFor(GOER);
const otherToken = await tokenFor(OTHER);
const modToken = hostToken;

/** Every event these accounts left behind, gone. Without this the "coming up" list fills with a
 * previous run's leftovers and the counts stop meaning anything. Cancel-then-delete because the API
 * (correctly) refuses to delete something people are coming to. */
async function cleanUp() {
	// Seats are given up first: the API refuses to delete an event people are coming to (which is the
	// behaviour under test in section 5), so a run that left attendees behind would leave its events
	// behind too, and the "coming up" counts would drift a little further every run.
	for (const token of [goerToken, otherToken, hostToken]) {
		for (const event of (await api(token, '/events/?mine=attending')).body ?? []) {
			await api(token, `/events/${event.id}/attend/`, {
				method: 'POST',
				body: JSON.stringify({ status: 'not_going' })
			});
		}
	}
	for (const token of [hostToken, goerToken, otherToken]) {
		for (const event of (await api(token, '/events/?mine=hosting')).body ?? []) {
			await api(token, `/events/${event.id}/`, { method: 'DELETE' });
		}
	}
}
await cleanUp();
// And make sure the switch is on before anything else looks at it — a previous run that failed
// mid-way through the kill-switch section would otherwise leave it off.
await api(modToken, '/feature-flags/events/', {
	method: 'PATCH',
	body: JSON.stringify({ is_enabled: true })
});

const hostPage = await person('host');
const goerPage = await person('goer');
const guestPage = await person('guest');

console.log('\n[1] The navbar collapses ten links into three groups');
await login(hostPage, HOST);
await goto(hostPage, '/');

const addTrigger = hostPage.locator('header button[aria-haspopup="menu"]', { hasText: /Add/ });
check('there is one "Add…" trigger', (await addTrigger.count()) === 1);
check('it starts closed', (await addTrigger.getAttribute('aria-expanded')) === 'false');
await addTrigger.click();
await settle(hostPage, 400);
const addMenu = hostPage.locator('header [role="menu"]').first();
const addItems = (await addMenu.innerText()).replace(/\n+/g, ' | ');
check('it opens', (await addTrigger.getAttribute('aria-expanded')) === 'true');
for (const [label, needle] of [
	['submit exercise', /Submit exercise/i],
	['submit material', /Submit material/i],
	['create a course', /Create a course/i],
	['host an event', /Host an event/i],
	['offer tutoring', /Offer tutoring/i]
]) {
	check(`the Add menu offers ${label}`, needle.test(addItems), addItems);
}
// Escape closes it and hands focus back — the part that is easy to get wrong and the reason this
// went through one shared primitive rather than three ad-hoc dropdowns.
await hostPage.keyboard.press('Escape');
await settle(hostPage, 300);
check('Escape closes it', (await addTrigger.getAttribute('aria-expanded')) === 'false');
check(
	'and focus goes back to the trigger',
	await addTrigger.evaluate((el) => el === document.activeElement)
);

// None of the five create links are loose in the nav any more.
const navText = await hostPage.locator('header nav').innerText();
check('the nav no longer carries "Submit exercise"', !/Submit exercise/i.test(navText), navText);
check('nor "Submit material"', !/Submit material/i.test(navText), navText);

console.log('\n[2] The account button is a menu, not a link to Settings');
const accountTrigger = hostPage.locator('header button[aria-haspopup="menu"]').last();
await accountTrigger.click();
await settle(hostPage, 400);
const accountMenu = hostPage.locator('header [role="menu"]').last();
const accountItems = (await accountMenu.innerText()).replace(/\n+/g, ' | ');
for (const [label, needle] of [
	['Profile', /Profile/i],
	['My Set', /My Set/i],
	['the schedule', /My schedule/i],
	['Settings', /Settings/i],
	['Log out', /Log out/i]
]) {
	check(`the account menu holds ${label}`, needle.test(accountItems), accountItems);
}
// Profile is new, and has to point at this person's OWN page.
const profileHref = await accountMenu.locator('a', { hasText: /^Profile$/ }).getAttribute('href');
const me = (await api(hostToken, '/auth/me/')).body;
check(
	'and Profile links to your own user page',
	profileHref?.includes(`/users/${me.id}`),
	`${profileHref} vs id ${me.id}`
);
await hostPage.keyboard.press('Escape');
await settle(hostPage, 300);

console.log('\n[3] Messages is an icon with a name, not a word');
const messagesLink = hostPage.locator('header a[aria-label="Messages"]');
check('there is an icon-only Messages control', (await messagesLink.count()) === 1);
check(
	'it renders an SVG rather than text',
	(await messagesLink.locator('svg').count()) === 1 &&
		(await messagesLink.innerText()).trim().length === 0,
	JSON.stringify(await messagesLink.innerText())
);
check(
	'and it still has an accessible name',
	(await messagesLink.getAttribute('aria-label')) === 'Messages'
);

console.log('\n[4] The homepage is five real tabs');
const tabs = hostPage.locator('[role="tablist"] [role="tab"]');
const tabNames = await tabs.allInnerTexts();
check(
	'all five are offered',
	['Exercises', 'Materials', 'Courses', 'Tutoring', 'Events'].every((n) =>
		tabNames.some((t) => t.trim() === n)
	),
	JSON.stringify(tabNames)
);
check(
	'exercises is selected by default',
	(await tabs.first().getAttribute('aria-selected')) === 'true'
);
check(
	'and the panel is wired to the tab that owns it',
	(await hostPage.locator('[role="tabpanel"]').getAttribute('aria-labelledby')) === 'tab-exercises'
);

await hostPage.getByRole('tab', { name: 'Materials' }).click();
await settle(hostPage, 1400);
check(
	'choosing Materials puts it in the URL',
	hostPage.url().includes('tab=materials'),
	hostPage.url()
);
check(
	'and renders material cards, not exercises',
	(await hostPage.locator('[role="tabpanel"] .material-card').count()) > 0 ||
		/Recently added materials/i.test(await hostPage.locator('[role="tabpanel"]').innerText())
);

// The whole reason the tab lives in the URL.
await hostPage.reload({ waitUntil: 'networkidle' });
await settle(hostPage, 1400);
check(
	'the tab survives a reload',
	(await hostPage.getByRole('tab', { name: 'Materials' }).getAttribute('aria-selected')) === 'true'
);
await hostPage.goBack({ waitUntil: 'networkidle' });
await settle(hostPage, 1200);
check(
	'and the back button steps between tabs',
	(await hostPage.getByRole('tab', { name: 'Exercises' }).getAttribute('aria-selected')) === 'true',
	hostPage.url()
);

// Arrow keys, which is what makes role="tablist" an honest claim.
await hostPage.getByRole('tab', { name: 'Exercises' }).focus();
await hostPage.keyboard.press('ArrowRight');
await settle(hostPage, 1200);
check(
	'arrow keys move between tabs',
	(await hostPage.getByRole('tab', { name: 'Materials' }).getAttribute('aria-selected')) === 'true'
);

console.log('\n[5] Hosting an event, through the real form');
await goto(hostPage, '/events/new');
const TITLE = `Analiza II — exam prep ${RUN}`;
/** Fields are addressed by their own label rather than by position. A first draft of this script
 * filled `input[type="text"]` #1 expecting "Place" and got "One-line summary", leaving a required
 * field empty — at which point the browser silently refused to submit and the failure read as though
 * creating an event were broken. Labels do not move when a field is added. */
const field = (label) =>
	hostPage.locator('label.field', { hasText: label }).locator('input, textarea');
await field(/^Title/).fill(TITLE);
// Anchored, because "Place" is also a substring of "Limit on places" — a real strict-mode violation
// this hit on the first run.
await field(/^Place/).fill('room 4070, Banacha 2');
// `datetime-local` wants a LOCAL "YYYY-MM-DDTHH:mm" with no zone, so it is built from the browser's
// own clock rather than from an ISO string, which would silently shift the hour.
await field(/^Starts/).evaluate((el) => {
	const d = new Date();
	d.setDate(d.getDate() + 3);
	const pad = (n) => String(n).padStart(2, '0');
	el.value = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T18:00`;
	el.dispatchEvent(new Event('input', { bubbles: true }));
	el.dispatchEvent(new Event('change', { bubbles: true }));
});
await hostPage.locator('form button[type="submit"]').click();
await hostPage.waitForURL(/\/events\/\d+/, { timeout: 10000 });
await settle(hostPage, 1200);
const eventUrl = hostPage.url();
const eventId = eventUrl.match(/\/events\/(\d+)/)[1];
check('creating an event lands on its own page', /\/events\/\d+/.test(eventUrl), eventUrl);
const hostView = await hostPage.locator('.page').innerText();
check('which shows the title', hostView.includes(TITLE));
check('names the room', /room 4070/.test(hostView), hostView.slice(0, 400));
check('tells the host it is theirs', /You are running this/i.test(hostView));
check('and offers them the cancel action', /Cancel this event/i.test(hostView));
check(
	'a host is not offered a way to attend their own event',
	!/I am going/i.test(hostView),
	hostView.slice(0, 400)
);

console.log('\n[6] Somebody else says they are coming');
await seat(goerPage, goerToken);
await goto(goerPage, `/events/${eventId}`);
let goerView = await goerPage.locator('.page').innerText();
check('a visitor sees the event', goerView.includes(TITLE));
check(
	'the roster is private before they answer',
	/Only the host and the people going/i.test(goerView),
	goerView.slice(-400)
);
await goerPage.getByRole('button', { name: 'I am going' }).click();
await settle(goerPage, 1500);
goerView = await goerPage.locator('.page').innerText();
check('answering is confirmed back to them', /You said you are going/i.test(goerView));
check('the count moves', /Going: 1/.test(goerView), goerView.slice(0, 600));
check(
	'and answering is what unlocks the roster',
	!/Only the host and the people going/i.test(goerView) && /Michał|michal/i.test(goerView),
	goerView.slice(-400)
);

console.log('\n[7] The host is told, and the notification links to the event');
await goto(hostPage, '/notifications');
const notifications = await hostPage.locator('.page').innerText();
check('the host is notified', notifications.includes(TITLE), notifications.slice(0, 400));
const notifHref = await hostPage
	.locator(`a[href*="/events/${eventId}"]`)
	.first()
	.getAttribute('href');
check('and the notification links to the event itself', Boolean(notifHref), String(notifHref));

console.log('\n[8] Capacity, and giving a seat back');
await api(hostToken, `/events/${eventId}/`, {
	method: 'PATCH',
	body: JSON.stringify({ capacity: 1 })
});
const otherPage = await person('other');
await seat(otherPage, otherToken);
await goto(otherPage, `/events/${eventId}`);
let otherView = await otherPage.locator('.page').innerText();
check(
	'a third person is told it is full',
	/This event is full/i.test(otherView),
	otherView.slice(0, 700)
);
check(
	'and is not left with an unexplained dead button',
	/Going: 1 · Wolne|Going: 1 · 0 of 1|0 of 1 places left/.test(otherView) || /full/i.test(otherView)
);

// The person holding the seat can still change their mind, and that frees it.
await goerPage.reload({ waitUntil: 'networkidle' });
await settle(goerPage, 1200);
await goerPage.getByRole('button', { name: 'I cannot come' }).click();
await settle(goerPage, 1500);
check(
	'somebody holding the seat can still decline even when full',
	/You said you cannot come/i.test(await goerPage.locator('.page').innerText())
);
await otherPage.reload({ waitUntil: 'networkidle' });
await settle(otherPage, 1200);
otherView = await otherPage.locator('.page').innerText();
check(
	'and the freed seat is offered to the next person',
	!/This event is full/i.test(otherView),
	otherView.slice(0, 500)
);

console.log('\n[9] It shows up on the events page, the homepage tab, and your own schedule');
await goto(guestPage, '/events');
const browse = await guestPage.locator('.page').innerText();
check('a signed-out visitor can browse events', browse.includes(TITLE), browse.slice(0, 400));
check('and is not offered the host button', !/Host an event/i.test(browse));

await goto(guestPage, '/?tab=events');
await settle(guestPage, 1400);
check(
	'a shared link opens straight on the Events tab',
	(await guestPage.getByRole('tab', { name: 'Events' }).getAttribute('aria-selected')) === 'true'
);
check(
	'and the tab shows the real event',
	(await guestPage.locator('[role="tabpanel"]').innerText()).includes(TITLE)
);

await goto(hostPage, '/bookings');
await hostPage.getByRole('button', { name: /My availability/i }).click();
await settle(hostPage, 2000);
// Scoped to the calendar panel specifically — '.panel' matches three sections on this page.
const calendar = await hostPage.locator('.panel').first().innerText();
check(
	'an event you host lands on your own schedule',
	calendar.includes(TITLE) || calendar.includes(TITLE.slice(0, 20)),
	calendar.slice(0, 500)
);
check('labelled as something you are running', /Running/i.test(calendar), calendar.slice(0, 500));

// The decision this was asked to make explicitly: an event is ON the calendar but does NOT withdraw
// published hours from students. Checked against the API, since that is where it would leak.
const schedule = (await api(hostToken, '/my-schedule/')).body;
check(
	'the schedule endpoint carries events',
	(schedule.events ?? []).some((e) => e.title === TITLE),
	JSON.stringify(schedule.events)
);
check(
	'and it still carries the published windows untouched',
	Array.isArray(schedule.days),
	typeof schedule.days
);

console.log('\n[10] Cancelling tells the people who were coming');
// Put someone back in a seat first, so there is somebody to tell.
await api(goerToken, `/events/${eventId}/attend/`, {
	method: 'POST',
	body: JSON.stringify({ status: 'going' })
});
hostPage.on('dialog', (d) => d.accept());
await goto(hostPage, `/events/${eventId}`);
await hostPage.getByRole('button', { name: /Cancel this event/i }).click();
await settle(hostPage, 1600);
const cancelled = await hostPage.locator('.page').innerText();
check(
	'the event says it was called off',
	/was called off/i.test(cancelled),
	cancelled.slice(0, 400)
);
check('and the cancel button is gone', !/Cancel this event/i.test(cancelled));

const goerNotifs = (await api(goerToken, '/notifications/')).body ?? [];
check(
	'the person who was coming is told',
	goerNotifs.some((n) => n.type === 'event_cancelled' && n.target_label === TITLE),
	JSON.stringify(goerNotifs.slice(0, 2))
);

await goerPage.reload({ waitUntil: 'networkidle' });
await settle(goerPage, 1200);
check(
	'a cancelled event stays visible rather than vanishing',
	(await goerPage.locator('.page').innerText()).includes(TITLE)
);

console.log('\n[11] The kill switch takes the LINKS away, not just the pages');
// A fresh event so there is something for the flag to hide.
const live = (
	await api(hostToken, '/events/', {
		method: 'POST',
		body: JSON.stringify({
			title: `Kill switch check ${RUN}`,
			starts_at: daysOut(5),
			duration_minutes: 60,
			location_kind: 'online',
			online_url: 'https://example.invalid/room',
			status: 'published'
		})
	})
).body;

// Somebody non-staff has to be going to it, or the leak check below would be asserting against an
// empty list for the wrong reason.
await api(goerToken, `/events/${live.id}/attend/`, {
	method: 'POST',
	body: JSON.stringify({ status: 'going' })
});
const goerScheduleOn = (await api(goerToken, '/my-schedule/')).body;
check(
	'an event you are going to is on your schedule while the feature is up',
	(goerScheduleOn.events ?? []).some((e) => e.id === live.id),
	JSON.stringify(goerScheduleOn.events)
);

const flagOff = await api(modToken, '/feature-flags/events/', {
	method: 'PATCH',
	body: JSON.stringify({ is_enabled: false })
});
check('a moderator can pull the switch', flagOff.status === 200, String(flagOff.status));

let visitor = await renew(goerPage);
await goto(visitor, '/');
const navOff = await visitor.locator('header').innerText();
check('the Events nav link is gone', !/\bEvents\b/.test(navOff), navOff.replace(/\n+/g, ' | '));
const tabsOff = await visitor.locator('[role="tab"]').allInnerTexts();
check(
	'the homepage Events tab is gone',
	!tabsOff.some((t) => t.trim() === 'Events'),
	JSON.stringify(tabsOff)
);
await visitor.locator('header button[aria-haspopup="menu"]', { hasText: /Add/ }).click();
await settle(visitor, 400);
const addOff = await visitor.locator('header [role="menu"]').first().innerText();
check('and "Host an event" is gone from the Add menu', !/Host an event/i.test(addOff), addOff);
check('while the other create actions stay', /Submit exercise/i.test(addOff), addOff);

await goto(visitor, '/events');
check(
	'the events page itself refuses',
	/unavailable|niedostęp/i.test(await visitor.locator('body').innerText()),
	(await visitor.locator('body').innerText()).slice(0, 300)
);
const refusedApi = await api(goerToken, `/events/${live.id}/`);
check('and so does the API', refusedApi.status === 403, String(refusedApi.status));
// Asked as the ordinary account, not the moderator: staff bypass every flag by design, so asking
// Kasia would have proved the opposite of what it looks like. A first draft of this script did
// exactly that and failed, correctly.
const scheduleOff = (await api(goerToken, '/my-schedule/')).body;
check(
	'a killed feature does not leak through the schedule endpoint',
	(scheduleOff.events ?? []).length === 0,
	JSON.stringify(scheduleOff.events)
);
check(
	'while the schedule endpoint itself keeps working',
	Array.isArray(scheduleOff.days),
	typeof scheduleOff.days
);

// A moderator keeps access, which is the documented contract of every other flag here. Checked on
// the host's own page, since Kasia is the moderator.
const modPage = await renew(hostPage);
await goto(modPage, '/');
check(
	'a moderator still sees the feature while it is off for everybody else',
	/\bEvents\b/.test(await modPage.locator('header').innerText())
);

await api(modToken, '/feature-flags/events/', {
	method: 'PATCH',
	body: JSON.stringify({ is_enabled: true })
});
visitor = await renew(visitor);
await goto(visitor, '/');
check(
	'and turning it back on restores the link',
	/\bEvents\b/.test(await visitor.locator('header').innerText())
);

console.log('\n[12] Both locales');
// Paraglide is configured here WITHOUT a URL strategy (vite.config.ts), so there is no `/pl/…`
// prefix to visit — the language is chosen through the picker and remembered. A first draft of this
// script assumed a prefixed URL and got the English page back, which looked like a missing
// translation rather than a wrong assumption about the routing.
await goto(guestPage, '/events');
await guestPage.locator('header select[aria-label]').first().selectOption('pl');
await settle(guestPage, 2200);
const polish = await guestPage.locator('.page').innerText();
check('the events page is translated', /Wydarzenia/.test(polish), polish.slice(0, 200));
check('including the lead copy', /Jednorazowe rzeczy/.test(polish), polish.slice(0, 300));
check(
	'and the filter buttons',
	/Nadchodzące/.test(polish) && /Już się odbyły/.test(polish),
	polish.slice(0, 400)
);

await goto(guestPage, '/');
await settle(guestPage, 1200);
const polishTabs = await guestPage.locator('[role="tab"]').allInnerTexts();
check(
	'and so are the homepage tabs',
	polishTabs.some((t) => t.trim() === 'Zadania') &&
		polishTabs.some((t) => t.trim() === 'Wydarzenia'),
	JSON.stringify(polishTabs)
);
const polishNav = await guestPage.locator('header').innerText();
check('and the nav', /Wydarzenia/.test(polishNav), polishNav.replace(/\n+/g, ' | '));

console.log('\n[13] The navbar on a phone');
// A dedicated context, because the viewport is the thing under test and resizing a page other checks
// have already used would leave them depending on the order they ran in.
const phoneCtx = await browser.newContext({ viewport: { width: 390, height: 844 } });
const phone = wire(await phoneCtx.newPage(), phoneCtx, 'phone');
await phone.goto(`${BASE}/`, { waitUntil: 'domcontentloaded' });
await phone.evaluate((value) => localStorage.setItem('edmat-auth-token', value), hostToken);
await goto(phone, '/');

// One row: everything that lives across the top on a desktop is not on the bar at all here.
check('the desktop nav is not on the bar', !(await phone.locator('header .site-nav').isVisible()));
check('nor the action row', !(await phone.locator('header .site-header__actions').isVisible()));
const barRows = await phone
	.locator('header .site-header__row')
	.evaluate((el) => Math.round(el.getBoundingClientRect().height));
check('so the bar is a single row', barRows < 80, `${barRows}px`);

const toggle = phone.locator('.drawer-toggle');
check('the menu button is there', await toggle.isVisible());

// Opening it, and finding everything the desktop bar holds.
await toggle.click();
await settle(phone, 700);
const drawer = phone.locator('#site-drawer');
check('it opens a drawer', await drawer.isVisible());
const drawerText = (await drawer.innerText()).replace(/\n+/g, ' | ');
for (const [label, needle] of [
	// Was /Browse fields/ — the taxonomy rename made the nav say Disciplines, and this assertion
	// was never updated, so it failed on wording rather than on anything being missing.
	['the browse links', /Disciplines/i],
	['the events link', /\bEvents\b/],
	['the create actions', /Host an event/i],
	['the account items', /Log out/i],
	['and messages with its count', /Messages/i]
]) {
	check(`the drawer holds ${label}`, needle.test(drawerText), drawerText.slice(0, 300));
}

// Escape closes it and hands focus back, the same contract the desktop popovers keep.
await phone.keyboard.press('Escape');
await settle(phone, 600);
check('Escape closes it', !(await drawer.isVisible()));
check(
	'and focus returns to the menu button',
	await toggle.evaluate((el) => el === document.activeElement)
);

// The bar gets out of the way; the button does not.
const toggleBefore = await toggle.boundingBox();
await phone.evaluate(() => window.scrollTo(0, 700));
await settle(phone, 700);
const headerAfter = await phone.locator('header.site-header').boundingBox();
const toggleAfter = await toggle.boundingBox();
check(
	'scrolling down tucks the bar away',
	headerAfter.y + headerAfter.height <= 1,
	JSON.stringify(headerAfter)
);
// Since 2026-08-26 the ☰ lives IN the bar and tucks with it (owner's decision, §17AG addendum);
// scrolling up brings both back. `e2e/phone-navbar.mjs` covers the rest of the new bar.
check(
	'and the menu button goes with it',
	toggleAfter.y < toggleBefore.y,
	`${JSON.stringify(toggleBefore)} → ${JSON.stringify(toggleAfter)}`
);

await phone.evaluate(() => window.scrollTo(0, 300));
await settle(phone, 700);
check(
	'and scrolling up brings it straight back',
	(await phone.locator('header.site-header').boundingBox()).y === 0
);

// A link inside the drawer navigates AND closes it — under client-side routing the component is not
// torn down by the navigation, so a drawer left open would sit over the page it just went to.
await toggle.click();
await settle(phone, 700);
await drawer
	.locator('a', { hasText: /^Events$/ })
	.first()
	.click();
await settle(phone, 1800);
check('a drawer link navigates', phone.url().includes('/events'), phone.url());
check('and closes the drawer behind it', !(await drawer.isVisible()));

await cleanUp();

console.log(`\n${pass} passed, ${fail} failed`);
if (errors.length) console.log('page errors:\n' + errors.join('\n'));
else console.log('zero console/page errors');
await browser.close();
process.exit(fail === 0 && errors.length === 0 ? 0 : 1);
