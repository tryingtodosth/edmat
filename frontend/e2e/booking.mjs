// End-to-end check of the booking module: a tutor's schedule, and the two availability modes seen
// from a student's side.
//
// Run it with both running:
//   backend:  DJANGO_CORS_ALLOWED_ORIGINS=http://localhost:5183 manage.py runserver 127.0.0.1:8011
//   frontend: PUBLIC_API_BASE_URL=http://127.0.0.1:8011/api npx vite dev --port 5183
//   node e2e/booking.mjs
//
// Playwright is deliberately not a dependency of this repo — `npx playwright install chromium`.
// Accepts `playwright-core` plus CHROME=/path/to/chrome as well, for a machine that has the
// browsers but not the full package.
//
// booking/tests.py already pins the rules, including the whole of the slot arithmetic. What only a
// browser can show is the half that decides whether the feature is honest: that the SAME grid of
// buttons is captioned differently in the two modes, that a `derived` slot really disappears for the
// next person to look, that a `declared` one really does not, and that nobody is ever told they have
// an appointment when what they have is a request.
//
// **This one signs in as the three seeded demo users rather than registering fresh accounts**,
// unlike the other scripts here. Registration is rate-limited per IP (accounts/throttles.py), and
// repeated runs of a script that registers three people exhaust it — at which point the whole run
// fails in a way that looks exactly like a regression. Signing in costs nothing per run. The price
// is that these accounts carry state between runs, so the script starts by clearing the tutor's own
// schedule and settling their outstanding requests; see `resetTutor` below.
let chromium;
try {
	({ chromium } = await import('playwright'));
} catch {
	({ chromium } = await import('playwright-core'));
}

const BASE = process.env.E2E_BASE ?? 'http://localhost:5183';
const API = process.env.E2E_API ?? 'http://127.0.0.1:8000/api';
const PASSWORD = process.env.E2E_DEMO_PASSWORD ?? 'password123';
const TUTOR = 'michal@edmat.example';
const STUDENT = 'ola@edmat.example';
const RIVAL = 'bartek@edmat.example';
// Stamped into everything this run creates, so assertions can be scoped to it rather than to
// whatever these long-lived accounts accumulated on earlier runs.
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

/** A separate context per person — the whole feature is about who is looking. */
const contextOf = new Map();

function wire(page, ctx, name) {
	page.on('pageerror', (e) => errors.push(`[${name}] pageerror: ${e.message}`));
	page.on('console', (m) => {
		// Chromium logs every non-2xx fetch to the console regardless of whether the application
		// handled it, and this run deliberately provokes one: confirming a second session at an hour
		// the tutor has already committed is refused with a 409, which is the behaviour under test.
		// Only that exact status is ignored, so a 500 or a 403 still fails the run.
		if (m.type() === 'error' && !/status of 409 \(Conflict\)/.test(m.text())) {
			errors.push(`[${name}] console: ${m.text()}`);
		}
	});
	contextOf.set(page, { ctx, name });
	return page;
}

async function person(name) {
	const ctx = await browser.newContext();
	return wire(await ctx.newPage(), ctx, name);
}

/** A fresh tab for the same person, keeping their session.
 *
 * Not hygiene — a real, reproduced failure. One long-lived tab driven through a long chain of
 * full-page navigations against the Vite dev server eventually dies with
 * `net::ERR_INSUFFICIENT_RESOURCES` and a failed dynamic import, and the symptom (a page rendering
 * nothing at all) looks exactly like a regression in whatever was being tested. CLAUDE.md records
 * the same artifact hitting several earlier scripts. Auth lives in the CONTEXT's storage, not in the
 * tab, so the person is still signed in on the other side of this.
 */
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

/** Sign in, and make sure it actually took.
 *
 * The retry is not superstition. On a cold Vite dev server the login page is still hydrating when
 * Playwright clicks, so the click lands on an inert form and nothing happens — the page simply stays
 * where it is, and every later assertion then fails as though the feature under test were broken.
 * A successful login navigates away from /login, so that is what is waited for; if it did not
 * happen, the form is submitted once more against a page that has certainly finished loading by now.
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
			/* still on the login page — try once more, then give up loudly */
		}
	}
	throw new Error(`could not sign in as ${email}`);
}

/** Asked of the API from Node rather than from the page: the frontend talks to a different origin
 * (PUBLIC_API_BASE_URL), so a same-origin fetch inside the browser would hit the dev server's HTML
 * fallback and parse a document as JSON. */
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
			Authorization: `Token ${token}`,
			...(init.headers ?? {})
		}
	});
	const text = await response.text();
	return { status: response.status, body: text ? JSON.parse(text) : null };
}

/** Put the tutor's calendar back to empty.
 *
 * Every rule and exception deleted, every live booking cancelled. Without this a second run inherits
 * the first run's hours (so "you haven't published any hours yet" is false) and its unanswered
 * requests (so the pending count and the free-slot count are both wrong). Cancelling rather than
 * deleting, because cancelling is a thing the API actually offers — a script that had to reach into
 * the database to set itself up would not be exercising the same system a person uses.
 */
async function resetTutor(token) {
	for (const rule of (await api(token, '/availability-rules/')).body ?? []) {
		await api(token, `/availability-rules/${rule.id}/`, { method: 'DELETE' });
	}
	for (const exception of (await api(token, '/availability-exceptions/')).body ?? []) {
		await api(token, `/availability-exceptions/${exception.id}/`, { method: 'DELETE' });
	}
	for (const booking of (await api(token, '/bookings/?role=tutor')).body ?? []) {
		if (booking.status === 'requested' || booking.status === 'confirmed') {
			await api(token, `/bookings/${booking.id}/cancel/`, { method: 'POST', body: '{}' });
		}
	}
	// Back to the app's own defaults. Without this a previous run that switched to 12-hour/Sunday
	// would leave the "defaults" check below asserting against a setting rather than a default.
	await api(token, '/auth/me/', {
		method: 'PATCH',
		body: JSON.stringify({ time_format: '24h', week_starts_on: 'monday' })
	});
}

/** A date a fixed number of weeks out that falls on `weekday` (Monday = 0, matching the backend).
 * Computed rather than hard-coded so the script does not start failing on a particular Tuesday. */
function nextWeekday(weekday, weeksAhead = 1) {
	const today = new Date();
	const mondayBased = (today.getDay() + 6) % 7;
	const ahead = (((weekday - mondayBased) % 7) + 7) % 7;
	const day = new Date(
		today.getFullYear(),
		today.getMonth(),
		today.getDate() + ahead + 7 * weeksAhead
	);
	return `${day.getFullYear()}-${String(day.getMonth() + 1).padStart(2, '0')}-${String(day.getDate()).padStart(2, '0')}`;
}

/** Page forward until the week holding the tutor's Tuesday rule is on screen.
 *
 * The panel opens on the current week, which may have no Tuesday left in it, so every check that
 * wants slots has to walk forward first. Waits for the panel itself to have rendered before looking
 * for its controls — `networkidle` is the dev server going quiet, which is not the same moment as
 * this component's own availability fetch resolving.
 */
async function pageToSlots(page, maxWeeks = 3) {
	await page.waitForSelector('.booking .mode-notice', { timeout: 20000 });
	for (let i = 0; i < maxWeeks; i++) {
		if ((await page.locator('.slot').count()) > 0) return;
		// The panel's own "Later →" pager became ViewSwitcher's forward arrow when this feature gained
		// week and month views, and this line was never updated — so the script had been failing here
		// on a selector that matches nothing anywhere in the app, long before the run that noticed.
		await page.locator('.booking .switcher__period button.arrow').last().click();
		await settle(page, 1400);
	}
}

let tutorPage = await person('tutor');
let studentPage = await person('student');
let rivalPage = await person('rival');

console.log('\n[1] A tutor publishes hours from their own schedule page');
const tutorToken = await tokenFor(TUTOR);
await resetTutor(tutorToken);

// Two listings, deliberately: one in each availability mode, so the two can be compared against the
// same underlying calendar rather than against two different tutors' habits.
const derivedListing = await api(tutorToken, '/services/', {
	method: 'POST',
	body: JSON.stringify({
		title: `Real availability ${RUN}`,
		description: 'Booked hours disappear.',
		availability_mode: 'derived',
		session_minutes: 60
	})
});
const declaredListing = await api(tutorToken, '/services/', {
	method: 'POST',
	body: JSON.stringify({
		title: `Published hours ${RUN}`,
		description: 'The window keeps showing.',
		availability_mode: 'declared',
		session_minutes: 60
	})
});
check(
	'both listings were created',
	derivedListing.status === 201 && declaredListing.status === 201,
	`${derivedListing.status}/${declaredListing.status}`
);
const derivedId = derivedListing.body.id;
const declaredId = declaredListing.body.id;

await login(tutorPage, TUTOR);
await goto(tutorPage, '/bookings');
let text = await tutorPage.locator('.page').innerText();
check(
	'the schedule page offers all three tabs',
	/Requests for me/i.test(text) && /My availability/i.test(text),
	text.slice(0, 200)
);

await tutorPage.getByRole('button', { name: /My availability/i }).click();
await settle(tutorPage, 900);
text = await tutorPage.locator('.page').innerText();
check(
	'and says plainly that nobody can book you without published hours',
	/haven't published any hours/i.test(text),
	text.slice(0, 200)
);

// Tuesday, 14:00-17:00 — three one-hour slots, entered through the real form.
const rulesForm = tutorPage.locator('.panel', { hasText: 'Weekly hours' }).locator('form');
await rulesForm.locator('select').first().selectOption('1');
await rulesForm.locator('input[type="time"]').first().fill('14:00');
await rulesForm.locator('input[type="time"]').nth(1).fill('17:00');
await rulesForm.locator('button[type="submit"]').click();
await settle(tutorPage, 1600);
text = await tutorPage.locator('.panel', { hasText: 'Weekly hours' }).innerText();
check(
	'the weekly rule appears, applying to every listing',
	/Tuesday 14:00–17:00/i.test(text),
	text.slice(0, 300)
);

console.log('\n[2] The same hours are captioned differently in the two modes');
await goto(studentPage, `/services/${derivedId}`);
const derivedNotice = await studentPage.locator('.mode-notice').innerText();
check(
	'a `derived` listing promises the times shown are really free',
	/real free hours/i.test(derivedNotice),
	derivedNotice
);

await goto(studentPage, `/services/${declaredId}`);
const declaredNotice = await studentPage.locator('.mode-notice').innerText();
check(
	'a `declared` listing says some may already be taken',
	/may already be taken/i.test(declaredNotice),
	declaredNotice
);
check('the two captions are genuinely different', derivedNotice !== declaredNotice);

console.log('\n[3] A student books an hour on the `derived` listing');
studentPage = await renew(studentPage);
await login(studentPage, STUDENT);
await goto(studentPage, `/services/${derivedId}`);
await pageToSlots(studentPage);
const slotCount = await studentPage.locator('.slot').count();
check('the published window became three bookable hours', slotCount === 3, String(slotCount));

const takenTime = await studentPage.locator('.slot').first().innerText();
const STUDENT_NOTE = `Series convergence ${RUN}`;
await studentPage.locator('.slot').first().click();
await settle(studentPage, 400);
await studentPage.locator('.request textarea').fill(STUDENT_NOTE);
await studentPage.getByRole('button', { name: /Request this time/i }).click();
await settle(studentPage, 2000);
text = await studentPage.locator('.booking').innerText();
check(
	'they are told it is a REQUEST, not a confirmed appointment',
	/still has to confirm/i.test(text),
	text.slice(0, 300)
);

console.log('\n[4] That hour disappears for the next student — and only in `derived` mode');
await login(rivalPage, RIVAL);
await goto(rivalPage, `/services/${derivedId}`);
await pageToSlots(rivalPage);
const derivedSlots = await rivalPage.locator('.slot').allInnerTexts();
check(
	'the requested hour is gone from the derived listing',
	derivedSlots.length === 2 && !derivedSlots.includes(takenTime),
	JSON.stringify(derivedSlots)
);

rivalPage = await renew(rivalPage);
await goto(rivalPage, `/services/${declaredId}`);
await pageToSlots(rivalPage);
const declaredSlots = await rivalPage.locator('.slot').allInnerTexts();
check(
	'but the declared listing still offers all three, including that one',
	declaredSlots.length === 3 && declaredSlots.includes(takenTime),
	JSON.stringify(declaredSlots)
);

console.log('\n[5] Two people can legitimately ask for the same hour on a `declared` listing');
await rivalPage.locator('.slot', { hasText: takenTime }).first().click();
await settle(rivalPage, 400);
await rivalPage.getByRole('button', { name: /Request this time/i }).click();
await settle(rivalPage, 2000);
text = await rivalPage.locator('.booking').innerText();
check(
	'the second request is accepted rather than refused',
	/still has to confirm/i.test(text),
	text.slice(0, 200)
);

console.log('\n[6] The tutor sees both, is warned they clash, and answers each');
tutorPage = await renew(tutorPage);
await goto(tutorPage, '/bookings');
await settle(tutorPage, 1200);
text = await tutorPage.locator('.page').innerText();
check('the requests tab carries a count', /Requests for me \(2\)/i.test(text), text.slice(0, 200));
check("the student's own note came through", text.includes(STUDENT_NOTE), text.slice(0, 600));

const firstRequest = tutorPage.locator('.booking', { hasText: STUDENT_NOTE });
check(
	'and the tutor is told the hour is contested before deciding',
	/Other live bookings clash with this time: 1/i.test(await firstRequest.innerText()),
	await firstRequest.innerText()
);

await firstRequest.getByRole('button', { name: /^Confirm$/i }).click();
await settle(tutorPage, 2000);
text = await tutorPage.locator('.bookings').innerText();
check(
	'confirming one leaves the other still pending',
	/Confirmed/i.test(text) && /Requested/i.test(text),
	text.slice(0, 400)
);

// Confirming the SECOND one would put the tutor in two places at once — refused in both modes,
// because `declared` is a statement about what is published, not a claim to be in two places.
const clashing = tutorPage.locator('.booking', { hasText: 'Requested' }).first();
await clashing.getByRole('button', { name: /^Confirm$/i }).click();
await settle(tutorPage, 1800);
text = await tutorPage.locator('.page').innerText();
check(
	'but confirming the clashing one is refused in its own words',
	/already confirmed another session/i.test(text),
	text.slice(0, 400)
);

await tutorPage
	.locator('.booking', { hasText: 'Requested' })
	.first()
	.getByRole('button', { name: /^Decline$/i })
	.click();
await settle(tutorPage, 2000);
text = await tutorPage.locator('.bookings').innerText();
check('declining the other works', /Declined/i.test(text), text.slice(0, 300));

console.log('\n[7] Each student sees their own answer, and nobody sees the tutor’s calendar');
studentPage = await renew(studentPage);
await goto(studentPage, '/bookings');
await studentPage.getByRole('button', { name: /My bookings/i }).click();
await settle(studentPage, 1400);
const studentRow = studentPage.locator('.booking', { hasText: `Real availability ${RUN}` });
check(
	'the confirmed student sees Confirmed',
	/Confirmed/i.test(await studentRow.innerText()),
	await studentRow.innerText()
);
check(
	'and is never shown the tutor’s other bookings',
	!/clash with this time/i.test(await studentPage.locator('.bookings').innerText())
);

rivalPage = await renew(rivalPage);
await goto(rivalPage, '/bookings');
await rivalPage.getByRole('button', { name: /My bookings/i }).click();
await settle(rivalPage, 1400);
const rivalRow = rivalPage.locator('.booking', { hasText: `Published hours ${RUN}` });
check(
	'the declined student sees Declined',
	/Declined/i.test(await rivalRow.innerText()),
	await rivalRow.innerText()
);

console.log('\n[8] A notification reaches the student');
await goto(rivalPage, '/notifications');
text = await rivalPage.locator('main, .page').first().innerText();
check('the decline was announced', /declined/i.test(text), text.slice(0, 400));

console.log('\n[9] A one-off block takes the day off the calendar');
tutorPage = await renew(tutorPage);
await goto(tutorPage, '/bookings');
await tutorPage.getByRole('button', { name: /My availability/i }).click();
await settle(tutorPage, 900);
const exceptionForm = tutorPage.locator('.panel', { hasText: 'One-off changes' }).locator('form');
const blockedDay = nextWeekday(1, 2); // the Tuesday AFTER the one already booked
await exceptionForm.locator('input[type="date"]').fill(blockedDay);
await exceptionForm.locator('input[type="text"]').fill('Conference');
await exceptionForm.locator('button[type="submit"]').click();
await settle(tutorPage, 1600);
text = await tutorPage.locator('.panel', { hasText: 'One-off changes' }).innerText();
check(
	'the whole-day block is listed as such',
	new RegExp(blockedDay).test(text) && /all day/i.test(text),
	text.slice(0, 300)
);

const anonAvailability = await fetch(
	`${API}/services/${declaredId}/availability/?from=${blockedDay}&to=${blockedDay}`
);
const anonBody = await anonAvailability.json();
check('availability is readable without an account', anonAvailability.status === 200);
check(
	'and the blocked Tuesday offers nothing, despite the weekly rule',
	anonBody.days[0].slots.length === 0,
	JSON.stringify(anonBody.days[0])
);

console.log('\n[10] The same availability, seen as a week grid and a month');
studentPage = await renew(studentPage);
await goto(studentPage, `/services/${declaredId}`);
await pageToSlots(studentPage);
const listSlots = await studentPage.locator('.slot').count();

// Week: the same three hours, now as blocks against a time axis rather than chips in a list.
await studentPage.locator('[role="tablist"] button', { hasText: /^Week$/ }).click();
await settle(studentPage, 1500);
check('the week grid renders an hour axis', (await studentPage.locator('.week__hour').count()) > 0);
check(
	'with seven day columns',
	(await studentPage.locator('.week__column').count()) === 7,
	String(await studentPage.locator('.week__column').count())
);
const weekBlocks = await studentPage.locator('.week__entry').count();
check(
	'and exactly the slots the list showed, as blocks',
	weekBlocks === listSlots,
	`${weekBlocks} vs ${listSlots}`
);
// The blocks are real buttons for a signed-in student — a slot you cannot reach from the keyboard is
// not a booking control.
check(
	'the blocks are pressable, not decorative',
	(await studentPage.locator('button.week__entry').count()) === weekBlocks
);

// Month: a summary, one cell per day, with the count on the days that have something.
await studentPage.locator('[role="tablist"] button', { hasText: /^Month$/ }).click();
await settle(studentPage, 1800);
const cells = await studentPage.locator('.month__cell').count();
check('the month grid is whole weeks', cells % 7 === 0 && cells >= 28, String(cells));
check(
	'and marks the days that have free times',
	(await studentPage.locator('.month__count').count()) > 0
);
const monthLabel = await studentPage.locator('.switcher__label').innerText();
check('the period label names the month', /\d{4}/.test(monthLabel), monthLabel);

// Clicking a day is the ordinary calendar gesture: it opens that day's week.
await studentPage
	.locator('.month__cell', { has: studentPage.locator('.month__count') })
	.first()
	.click();
await settle(studentPage, 1600);
check(
	'clicking a day opens its week',
	(await studentPage.locator('.week__column').count()) === 7 &&
		(await studentPage.locator('.week__entry').count()) > 0
);

console.log('\n[11] The tutor’s own calendar shows bookings inside published hours');
tutorPage = await renew(tutorPage);
await goto(tutorPage, '/bookings');
await tutorPage.getByRole('button', { name: /My availability/i }).click();
await settle(tutorPage, 1800);
check(
	'the published hours render as background bands',
	(await tutorPage.locator('.week__band').count()) > 0,
	String(await tutorPage.locator('.week__band').count())
);
// Page forward to the week the session is actually in, exactly as `pageToSlots` already has to for
// the student panel and for the same reason: the booking was made on the tutor's Tuesday rule, which
// is only bookable from the next week once this week's Tuesday has passed. Without this the check
// silently depended on which day of the week the suite ran — it passes on a Monday and cannot pass
// on a Sunday, which is how it was found.
for (let i = 0; i < 3; i++) {
	if ((await tutorPage.locator('.week__entry').count()) > 0) break;
	await tutorPage.locator('.switcher__period button.arrow').last().click();
	await settle(tutorPage, 1400);
}
// The confirmed session from step [6] sits ON the band rather than being cut out of it — the whole
// difference between this endpoint and the student-facing one.
const tutorBlocks = await tutorPage.locator('.week__entry').allInnerTexts();
check(
	'and the confirmed session is drawn on top of them',
	tutorBlocks.some((text) => /Ola/i.test(text)),
	JSON.stringify(tutorBlocks)
);
check(
	'a declined session is not drawn at all',
	!tutorBlocks.some((text) => /Bartek/i.test(text)),
	JSON.stringify(tutorBlocks)
);
check(
	'the tutor calendar offers no list view — the editors below already are one',
	(await tutorPage.locator('.panel [role="tablist"] button').count()) === 2
);

await tutorPage.locator('.panel [role="tablist"] button', { hasText: /^Month$/ }).click();
await settle(tutorPage, 1800);
check('its month view counts sessions', (await tutorPage.locator('.month__count').count()) > 0);
check(
	'and dots the days that only have published hours',
	(await tutorPage.locator('.month__dot').count()) > 0,
	String(await tutorPage.locator('.month__dot').count())
);

console.log('\n[12] 24-hour and Monday by default; 12-hour and Sunday are a real setting');
tutorPage = await renew(tutorPage);
await goto(tutorPage, '/bookings');
await tutorPage.getByRole('button', { name: /My availability/i }).click();
await settle(tutorPage, 1800);

// The default is the app's own, NOT whatever Intl would pick for the interface language — for `en`
// that is 12-hour and a Sunday-first week, which is precisely what these settings exist to stop
// being decided for people.
let axis = await tutorPage.locator('.week__axis').innerText();
check(
	'the clock is 24-hour out of the box, in English',
	/\d{2}:00/.test(axis) && !/AM|PM/.test(axis),
	axis.replace(/\n/g, ' ')
);
// Scoped to the FIRST column heading, not the whole row: the heading reads "3 Mon" (number then
// weekday), so anchoring a regex at the start of the row tests the date rather than the day.
let firstColumn = await tutorPage.locator('.week__day-head').first().innerText();
check('and the week starts on Monday', /Mon/i.test(firstColumn), firstColumn);
let ruleRow = await tutorPage.locator('.panel', { hasText: 'Weekly hours' }).innerText();
check('a published rule reads in 24-hour too', /14:00/.test(ruleRow), ruleRow.slice(0, 200));

await goto(tutorPage, '/settings');
await settle(tutorPage, 1200);
const dates = tutorPage.locator('.field-group', { hasText: 'Dates and times' });
check('Settings offers both as real choices', (await dates.locator('select').count()) === 2);
await dates.locator('select').first().selectOption('12h');
await dates.locator('select').nth(1).selectOption('sunday');
await tutorPage.locator('form button[type="submit"]').first().click();
await settle(tutorPage, 2200);

tutorPage = await renew(tutorPage);
await goto(tutorPage, '/bookings');
await tutorPage.getByRole('button', { name: /My availability/i }).click();
await settle(tutorPage, 1800);
axis = await tutorPage.locator('.week__axis').innerText();
check('the axis switches to AM/PM', /AM|PM/.test(axis), axis.replace(/\n/g, ' '));
firstColumn = await tutorPage.locator('.week__day-head').first().innerText();
check('and the week now starts on Sunday', /Sun/i.test(firstColumn), firstColumn);
ruleRow = await tutorPage.locator('.panel', { hasText: 'Weekly hours' }).innerText();
check(
	'the published rule follows, rather than staying 24-hour',
	/2:00/.test(ruleRow) && !/14:00/.test(ruleRow),
	ruleRow.slice(0, 200)
);

// The month grid has to agree with the header, or the 1st lands under the wrong name.
await tutorPage.locator('.panel [role="tablist"] button', { hasText: /^Month$/ }).click();
await settle(tutorPage, 1600);
const monthHead = await tutorPage.locator('.month__weekdays span').first().innerText();
check('the month grid re-orders with it', /Sun/i.test(monthHead), monthHead);

// It survives a hard reload — it is a stored setting, not a toggle living in the tab.
await goto(tutorPage, '/bookings');
await tutorPage.getByRole('button', { name: /My availability/i }).click();
await settle(tutorPage, 1800);
check('and it survives a reload', /AM|PM/.test(await tutorPage.locator('.week__axis').innerText()));

// Back to the defaults, so a later run of this script starts where it expects to.
await api(tutorToken, '/auth/me/', {
	method: 'PATCH',
	body: JSON.stringify({ time_format: '24h', week_starts_on: 'monday' })
});

console.log('\n[13] A listing with a live booking refuses to be deleted');
const deletion = await api(tutorToken, `/services/${derivedId}/`, { method: 'DELETE' });
check('deleting is refused with a conflict', deletion.status === 409, String(deletion.status));
check(
	'and the reason names pausing as the alternative',
	/Pause it instead/i.test(deletion.body?.detail ?? ''),
	JSON.stringify(deletion.body)
);

const rivalToken = await tokenFor(RIVAL);
const strangersQueue = await api(rivalToken, '/bookings/?role=tutor');
check(
	'a student has none of the tutor’s incoming requests',
	!JSON.stringify(strangersQueue.body).includes(STUDENT_NOTE),
	JSON.stringify(strangersQueue.body).slice(0, 200)
);

console.log(`\n${pass} passed, ${fail} failed`);
if (errors.length) console.log('page errors:\n' + errors.join('\n'));
else console.log('zero console/page errors');
await browser.close();
process.exit(fail === 0 && errors.length === 0 ? 0 : 1);
