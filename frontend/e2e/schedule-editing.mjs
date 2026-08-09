// End-to-end check of the schedule editor: dragging hours onto the calendar, saving a week as a
// template, repeating a week across a run of weeks, and then changing one of those weeks alone.
//
// Run it with both running:
//   backend:  DJANGO_CORS_ALLOWED_ORIGINS=http://localhost:5183 manage.py runserver 127.0.0.1:8011
//   frontend: PUBLIC_API_BASE_URL=http://127.0.0.1:8011/api npx vite dev --mode e2e --port 5183
//   node e2e/schedule-editing.mjs
//
// booking/test_week_schedules.py already pins the rules — precedence, merging, what a copy carries,
// who may write what. What only a browser can show is whether the gestures actually work: that a
// drag on a column becomes real stored hours, that the same window can be moved with a mouse AND
// with the arrow keys, and that the editor says which of the two things a change is about to reach
// BEFORE it is made rather than after.
//
// Signs in as a seeded demo user rather than registering, for the reason e2e/booking.mjs records:
// registration is rate-limited per IP, and a script that registers exhausts it on repeated runs.
// The account therefore carries state between runs, so this starts by clearing its own weeks.
let chromium;
try {
	({ chromium } = await import('playwright'));
} catch {
	({ chromium } = await import('playwright-core'));
}

const BASE = process.env.E2E_BASE ?? 'http://localhost:5183';
const API = process.env.E2E_API ?? 'http://127.0.0.1:8011/api';
const PASSWORD = process.env.E2E_DEMO_PASSWORD ?? 'password123';
const TUTOR = 'kasia@edmat.example';

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

/** A locator timing out kills the run before the summary, and the console errors collected up to
 * that point are exactly what explains why the page was not in the state expected — so they are
 * printed here rather than lost with the stack trace. */
process.on('uncaughtException', (error) => {
	console.log(`\nCRASHED: ${error.message.split('\n')[0]}`);
	if (errors.length) {
		console.log('console/page errors up to that point:');
		for (const e of errors) console.log(`  ${e}`);
	}
	console.log(`${pass} passed, ${fail} failed before the crash`);
	process.exit(1);
});

async function tokenFor(email) {
	const response = await fetch(`${API}/auth/login/`, {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		// The field is named `username` and takes an email — the login form has only ever asked for
		// an email, and LoginView resolves it. Sending `email` returns a 401 that reads exactly like a
		// wrong password.
		body: JSON.stringify({ username: email, password: PASSWORD })
	});
	return (await response.json()).token;
}

/** Asked of the API from Node rather than from inside the page: the frontend talks to a different
 * origin, so a same-origin fetch in the browser would hit the dev server's HTML fallback. */
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

const token = await tokenFor(TUTOR);
if (!token) throw new Error(`could not get a token for ${TUTOR}`);

/** Monday of the week containing today, plus `weeks`. The editor always works in Monday weeks, so
 * every assertion here has to speak the same calendar the backend stores. */
function monday(weeks = 0) {
	const now = new Date();
	const day = new Date(
		now.getFullYear(),
		now.getMonth(),
		now.getDate() - ((now.getDay() + 6) % 7) + weeks * 7
	);
	return `${day.getFullYear()}-${String(day.getMonth() + 1).padStart(2, '0')}-${String(day.getDate()).padStart(2, '0')}`;
}

async function weekOf(offset) {
	return (await api(token, `/week-schedules/week/?week_start=${monday(offset)}`)).body;
}

// ---- a known starting point ---------------------------------------------------------------
// The account is long-lived, so a previous run's weeks and templates would otherwise decide what
// this one sees. Cleared through the real endpoints, not the database, so the reset exercises the
// same system a person uses.
for (const row of (await api(token, '/week-schedules/')).body ?? []) {
	await api(token, `/week-schedules/${row.id}/`, { method: 'DELETE' });
}
for (const row of (await api(token, '/week-templates/')).body ?? []) {
	await api(token, `/week-templates/${row.id}/`, { method: 'DELETE' });
}
// The repeating pattern too, and rewritten to known hours. The last section of this script edits a
// rule on purpose, so without this each run starts from the previous run's drift — the grid's hour
// range moves with it, and assertions about where a drag lands stop meaning anything.
for (const row of (await api(token, '/availability-rules/')).body ?? []) {
	await api(token, `/availability-rules/${row.id}/`, { method: 'DELETE' });
}
for (const rule of [
	{ weekday: 1, start_time: '14:00', end_time: '16:00' },
	{ weekday: 3, start_time: '10:00', end_time: '12:00' }
]) {
	await api(token, '/availability-rules/', { method: 'POST', body: JSON.stringify(rule) });
}

const browser = await chromium.launch(
	process.env.CHROME ? { executablePath: process.env.CHROME } : {}
);
// Tall on purpose. `page.mouse` works in VIEWPORT coordinates while `boundingBox()` reports the
// element wherever it is, so on Playwright's default 720px-high window every drag aimed at the lower
// half of an ~580px calendar grid landed off-screen and did nothing at all. The symptom is a gesture
// that silently no-ops — indistinguishable from a broken feature, and it cost a real debugging round
// here. Upward drags kept working, which is what finally gave it away.
const context = await browser.newContext({ viewport: { width: 1280, height: 1200 } });
const page = await context.newPage();
page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
page.on('console', (m) => {
	if (m.type() === 'error') errors.push(`console: ${m.text()}`);
});

const settle = (ms = 900) => page.waitForTimeout(ms);

async function login(email) {
	for (let attempt = 0; attempt < 2; attempt++) {
		if (attempt === 0) await page.goto(`${BASE}/login`, { waitUntil: 'networkidle' });
		await settle(600);
		await page.locator('form input[type="email"]').fill(email);
		await page.locator('form input[type="password"]').fill(PASSWORD);
		await page.locator('form button[type="submit"]').click();
		try {
			await page.waitForURL((url) => !url.pathname.includes('/login'), { timeout: 8000 });
			await settle(900);
			return;
		} catch {
			/* still hydrating — try once more */
		}
	}
	throw new Error(`could not sign in as ${email}`);
}

/** Drag inside one day column, from one fraction of its height to another. Real pointer events —
 * Playwright's mouse API is what makes this a test of the gesture rather than of the handler. */
async function dragInColumn(dayIndex, fromFraction, toFraction) {
	const column = page.locator('.week__column').nth(dayIndex);
	const box = await column.boundingBox();
	await page.mouse.move(box.x + box.width / 2, box.y + box.height * fromFraction);
	await page.mouse.down();
	// Two intermediate moves rather than one: a single jump can be delivered before the pointer
	// capture is established, and the gesture then registers as a click.
	await page.mouse.move(
		box.x + box.width / 2,
		box.y + (box.height * (fromFraction + toFraction)) / 2,
		{ steps: 5 }
	);
	await page.mouse.move(box.x + box.width / 2, box.y + box.height * toFraction, { steps: 5 });
	await page.mouse.up();
	await settle(1200);
}

console.log('\n— the editor opens and says what a change will reach —');
await login(TUTOR);
await page.goto(`${BASE}/bookings`, { waitUntil: 'networkidle' });
await settle(1200);
await page.locator('nav.tabs button', { hasText: 'My availability' }).click();
await settle(1500);

check(
	'the availability tab offers an edit button',
	await page.locator('button', { hasText: 'Edit hours' }).isVisible()
);
await page.locator('button', { hasText: 'Edit hours' }).click();
await settle(1200);

check(
	'both editing scopes are offered',
	(await page.locator('.editor__scope label').count()) === 2
);
check(
	'an untouched week says it is following the usual timetable',
	(await page.locator('.editor__state').innerText()).includes('follows your usual timetable')
);
check(
	'the drag and the keyboard are both explained',
	(await page.locator('.editor').innerText()).includes('Drag on a day') &&
		(await page.locator('.editor').innerText()).includes('Enter on a day')
);
check(
	'the published-hours bands are not drawn underneath the editable ones',
	(await page.locator('.week__band').count()) === 0
);

console.log('\n— dragging on a column creates real, stored hours —');
const beforeDrag = await weekOf(0);
check('the week is not detached to begin with', beforeDrag.detached === false);
const patternWindows = beforeDrag.windows.length;
check(
	'the repeating pattern is drawn on it',
	patternWindows > 0,
	JSON.stringify(beforeDrag.windows)
);
check(
	'and drawn as draggable blocks, not as background bands',
	(await page.locator('.week__window').count()) === patternWindows
);

// Saturday: the seeded pattern says nothing about it, so what lands there came from the gesture.
const SAT = 5;
await dragInColumn(SAT, 0.25, 0.55);
const afterDrag = await weekOf(0);
check('the drag detached the week', afterDrag.detached === true, JSON.stringify(afterDrag));
check(
	'it added the dragged hours and kept the ones the week already showed',
	afterDrag.windows.length === patternWindows + 1 &&
		afterDrag.windows.filter((w) => w.weekday === SAT).length === 1,
	JSON.stringify(afterDrag.windows)
);
const saturday = afterDrag.windows.find((w) => w.weekday === SAT);
const drawn = await page
	.locator('.week__column')
	.nth(SAT)
	.locator('.week__window-time')
	.innerText();
check(
	'what is drawn is what was stored',
	drawn === `${saturday.start_time}–${saturday.end_time}`,
	`drawn ${drawn} vs stored ${saturday.start_time}–${saturday.end_time}`
);
check(
	'the state line now says the week has its own hours',
	(await page.locator('.editor__state').innerText()).includes('has its own hours')
);
check(
	'and offers to put it back on the usual timetable',
	await page.locator('button', { hasText: 'Put this week back' }).isVisible()
);

console.log('\n— the block itself can be dragged, and its edges pulled —');
const cell = () => page.locator('.week__column').nth(SAT);

/** Drag from one point of an element to another, in real pointer events. */
async function dragBy(locator, grabFraction, deltaPixels) {
	const box = await locator.boundingBox();
	const x = box.x + box.width / 2;
	const y = box.y + box.height * grabFraction;
	await page.mouse.move(x, y);
	await page.mouse.down();
	await page.mouse.move(x, y + deltaPixels / 2, { steps: 5 });
	await page.mouse.move(x, y + deltaPixels, { steps: 5 });
	await page.mouse.up();
	await settle(1200);
}

const beforeMouseMove = afterDrag.windows.find((w) => w.weekday === SAT);
await dragBy(cell().locator('.week__window-body'), 0.5, 60);
const mouseMoved = (await weekOf(0)).windows.find((w) => w.weekday === SAT);
check(
	'dragging the block moves it later without changing its length',
	minutesOf(mouseMoved.start_time) > minutesOf(beforeMouseMove.start_time) &&
		minutesOf(mouseMoved.end_time) - minutesOf(mouseMoved.start_time) ===
			minutesOf(beforeMouseMove.end_time) - minutesOf(beforeMouseMove.start_time),
	`${beforeMouseMove.start_time}-${beforeMouseMove.end_time} -> ${mouseMoved.start_time}-${mouseMoved.end_time}`
);

await dragBy(cell().locator('.week__handle--end'), 0.5, 45);
const pulled = (await weekOf(0)).windows.find((w) => w.weekday === SAT);
check(
	'pulling the bottom edge lengthens it and leaves its start alone',
	pulled.start_time === mouseMoved.start_time &&
		minutesOf(pulled.end_time) > minutesOf(mouseMoved.end_time),
	`${mouseMoved.start_time}-${mouseMoved.end_time} -> ${pulled.start_time}-${pulled.end_time}`
);

await dragBy(cell().locator('.week__handle--start'), 0.5, -30);
const pulledTop = (await weekOf(0)).windows.find((w) => w.weekday === SAT);
check(
	'pulling the top edge moves its start earlier and leaves its end alone',
	pulledTop.end_time === pulled.end_time &&
		minutesOf(pulledTop.start_time) < minutesOf(pulled.start_time),
	`${pulled.start_time}-${pulled.end_time} -> ${pulledTop.start_time}-${pulledTop.end_time}`
);

console.log('\n— the same window answers the keyboard as well as the mouse —');
const onDay = async (index) => (await weekOf(0)).windows.find((w) => w.weekday === index);
const press = async (index, key) => {
	await page.locator('.week__column').nth(index).locator('.week__window-body').first().focus();
	await page.keyboard.press(key);
	await settle(1200);
};

const beforeArrow = await onDay(SAT);
await press(SAT, 'ArrowDown');
check(
	'ArrowDown moves it a quarter of an hour later',
	minutesOf((await onDay(SAT)).start_time) === minutesOf(beforeArrow.start_time) + 15,
	`${beforeArrow.start_time} -> ${(await onDay(SAT)).start_time}`
);

const beforeResize = await onDay(SAT);
const lengthBefore = minutesOf(beforeResize.end_time) - minutesOf(beforeResize.start_time);
await press(SAT, 'Shift+ArrowDown');
const resized = await onDay(SAT);
check(
	'Shift+ArrowDown makes it a quarter of an hour longer',
	minutesOf(resized.end_time) - minutesOf(resized.start_time) === lengthBefore + 15,
	`${lengthBefore} -> ${minutesOf(resized.end_time) - minutesOf(resized.start_time)}`
);

await press(SAT, 'ArrowRight');
check(
	'ArrowRight moves it to the next day',
	(await onDay(SAT)) === undefined && (await onDay(6)) !== undefined
);

await press(6, 'Delete');
check('Delete removes it', (await onDay(6)) === undefined);

console.log('\n— Enter on a day is the keyboard way to add one —');
await page.locator('.week__canvas').nth(SAT).focus();
await page.keyboard.press('Enter');
await settle(1200);
const added = await onDay(SAT);
check(
	'Enter adds a whole hour on that day',
	added !== undefined && minutesOf(added.end_time) - minutesOf(added.start_time) === 60,
	JSON.stringify(added)
);

console.log('\n— lay a week out, then repeat it —');
const laidOut = await weekOf(0);
await page.locator('input[inputmode="numeric"]').fill('5');
await page.locator('button', { hasText: 'Repeat this week' }).click();
await settle(2000);
check(
	'the result says how many weeks were written',
	(await page.locator('.notice').innerText()).includes('5'),
	await page
		.locator('.notice')
		.innerText()
		.catch(() => '(no notice)')
);
const shapeOf = (week) =>
	week.windows
		.map((w) => `${w.weekday}:${w.start_time}-${w.end_time}`)
		.sort()
		.join('|');
let allMatch = true;
for (let offset = 1; offset <= 5; offset++) {
	const week = await weekOf(offset);
	if (!week.detached || shapeOf(week) !== shapeOf(laidOut)) allMatch = false;
}
check('all five following weeks carry exactly the same shape', allMatch);
check(
	'the week after the run is back on the usual timetable',
	(await weekOf(6)).detached === false
);

console.log('\n— then change the third of them on its own —');
for (let step = 0; step < 3; step++) {
	await page.locator('.switcher__period button.arrow').last().click();
	await settle(1000);
}
check(
	'the editor names the week the save will land on',
	/Week of/i.test(await page.locator('.editor__week').innerText()),
	await page.locator('.editor__week').innerText()
);
await press(SAT, 'ArrowDown');
const third = await weekOf(3);
const second = await weekOf(2);
check('the third week changed', shapeOf(third) !== shapeOf(laidOut), shapeOf(third));
check('and the second week did not', shapeOf(second) === shapeOf(laidOut), shapeOf(second));
check('nor did the first', shapeOf(await weekOf(0)) === shapeOf(laidOut));

console.log('\n— saving a week as a template, and applying it —');
await page.locator('input[maxlength="100"]').fill(`Term weeks ${Date.now()}`);
await page.locator('button', { hasText: 'Save this week' }).click();
await settle(1500);
check(
	'the saved week is listed',
	(await page.locator('.panel', { hasText: 'Saved weeks' }).locator('.rules li').count()) === 1
);
const templates = (await api(token, '/week-templates/')).body;
check('and it really exists', templates.length === 1 && templates[0].windows.length > 0);

console.log('\n— putting a week back on the usual timetable —');
await page.locator('button', { hasText: 'Put this week back' }).click();
await settle(1500);
const reattached = await weekOf(3);
check('the week follows the pattern again', reattached.detached === false);
check(
	'and the editor says so',
	(await page.locator('.editor__state').innerText()).includes('follows your usual timetable')
);

console.log('\n— the other scope edits the repeating pattern instead —');
await page.locator('.editor__scope label', { hasText: 'Every week' }).locator('input').check();
await settle(1200);
const rulesBefore = (await api(token, '/availability-rules/')).body;
check(
	'the repeating rules are drawn as draggable windows',
	(await page.locator('.week__window').count()) === rulesBefore.length,
	`${await page.locator('.week__window').count()} vs ${rulesBefore.length}`
);
if (rulesBefore.length > 0) {
	await page.locator('.week__window-body').first().focus();
	await page.keyboard.press('ArrowDown');
	await settle(1200);
	const rulesAfter = (await api(token, '/availability-rules/')).body;
	const changed = rulesAfter.some((rule) =>
		rulesBefore.some((was) => was.id === rule.id && was.start_time !== rule.start_time)
	);
	check('moving one changes the rule itself', changed, JSON.stringify(rulesAfter));
	check(
		'and the week it was dragged on is still not detached',
		(await weekOf(3)).detached === false
	);
}

console.log('\n— the month view has no time axis, so it offers no editing —');
await page.locator('button', { hasText: 'Done editing' }).click();
await settle(800);
await page.locator('.switcher__views button', { hasText: 'Month' }).click();
await settle(1200);
check(
	'no edit button in the month view',
	(await page.locator('button', { hasText: 'Edit hours' }).count()) === 0
);

function minutesOf(clock) {
	const [h, m] = clock.split(':').map(Number);
	return h * 60 + m;
}

console.log(`\n${pass} passed, ${fail} failed`);
if (errors.length) {
	console.log('\nconsole/page errors:');
	for (const e of errors) console.log(`  ${e}`);
}
await browser.close();
process.exit(fail === 0 && errors.length === 0 ? 0 : 1);
