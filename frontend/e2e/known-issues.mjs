// The gaps CLAUDE.md §17V.7 listed as real defects rather than deliberate scope cuts, checked in a
// browser: editing an event, picking subjects on the form, the two calendar-clash warnings, the
// one-click "keep these hours free", and the drawer's focus trap.
//
// Run it with both running:
//   backend:  DJANGO_CORS_ALLOWED_ORIGINS=http://localhost:5183 manage.py runserver 127.0.0.1:8011
//   frontend: PUBLIC_API_BASE_URL=http://127.0.0.1:8011/api npx vite dev --port 5183
//   node e2e/known-issues.mjs
//
// Playwright is deliberately not a dependency here — `npx playwright install chromium`, or
// playwright-core plus CHROME=/path/to/chrome.
let chromium;
try {
	({ chromium } = await import('playwright'));
} catch {
	({ chromium } = await import('playwright-core'));
}

const BASE = process.env.E2E_BASE ?? 'http://localhost:5183';
const API = process.env.E2E_API ?? 'http://127.0.0.1:8011/api';
const PASSWORD = 'Kw9-vortexline-42';

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

async function person(name, viewport) {
	const ctx = await browser.newContext(viewport ? { viewport } : {});
	const page = await ctx.newPage();
	page.on('pageerror', (e) => errors.push(`[${name}] pageerror: ${e.message}`));
	page.on('console', (msg) => {
		if (msg.type() !== 'error') return;
		// The attendee roster is private until you are on it, so somebody opening an event they have not
		// answered yet genuinely gets a 403 — the page swallows it on purpose (see its own comment on
		// `loadAttendees`). The browser still logs the failed request, and that is the rule working
		// rather than a defect. Narrow on purpose: only a failed resource load with this exact status,
		// so a 403 raised anywhere else still fails the run.
		if (/Failed to load resource.*403/.test(msg.text())) return;
		errors.push(`[${name}] console: ${msg.text()}`);
	});
	return page;
}

const settle = (page, ms = 900) => page.waitForTimeout(ms);

/** The place field carries a hint in a `<small>` inside its own `<label>`, so the accessible name is
 * the label AND the hint — `getByLabel('Place', { exact: true })` matches nothing. Scoped to the
 * label's own span instead, which is the text a person actually reads as the field's name. */
const placeInput = (page) => page.locator('label.field:has(span:text-is("Place")) input');
async function goto(page, path) {
	// 'load', not 'networkidle': the notification SSE stream keeps a request open on every signed-in
	// page, so networkidle never fires there (e2e/CLAUDE.md, trap 2).
	await page.goto(`${BASE}${path}`, { waitUntil: 'load' });
	await settle(page);
}

async function register(page, label) {
	const email = `${label}-${Date.now()}@example.com`;
	await goto(page, '/register');
	await page.locator('form input[type="text"]').first().fill(label);
	await page.locator('form input[type="email"]').fill(email);
	await page.locator('form input[type="password"]').fill(PASSWORD);
	await page.locator('form button[type="submit"]').click();
	await settle(page, 2200);
	return email;
}

async function token(email) {
	const res = await fetch(`${API}/auth/login/`, {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify({ username: email, password: PASSWORD })
	});
	return (await res.json()).token;
}

/** A wide weekly window on the event's own weekday. Wide on purpose: this asserts that an overlap is
 * NOTICED, not that a boundary is computed to the minute, and a narrow band would make the check
 * hostage to any difference between the browser's timezone and Django's. */
async function publishAvailability(authToken, weekday) {
	const res = await fetch(`${API}/availability-rules/`, {
		method: 'POST',
		headers: { 'Content-Type': 'application/json', Authorization: `Token ${authToken}` },
		body: JSON.stringify({ weekday, start_time: '08:00', end_time: '20:00' })
	});
	return res.ok;
}

// A date comfortably in the future, at midday so no timezone offset can push it out of the 08:00–20:00
// band above or across a day boundary.
const when = new Date(Date.now() + 12 * 24 * 60 * 60 * 1000);
when.setHours(12, 0, 0, 0);
const pad = (n) => String(n).padStart(2, '0');
const whenLocal = `${when.getFullYear()}-${pad(when.getMonth() + 1)}-${pad(when.getDate())}T12:00`;
// Django counts weekdays from Monday=0; JS counts from Sunday=0.
const weekday = (when.getDay() + 6) % 7;

const host = await person('host');
const guest = await person('guest');

console.log('\n[1] The event form offers subjects (the API always accepted them)');
const hostEmail = await register(host, 'ehost');
const hostToken = await token(hostEmail);
check('a weekly availability window is published', await publishAvailability(hostToken, weekday));

await goto(host, '/events/new');
const subjectBoxes = host.locator('.subjects input[type="checkbox"]');
const subjectCount = await subjectBoxes.count();
check('the form has a subjects group', (await host.locator('.subjects').count()) === 1);
check('with real subjects in it', subjectCount > 0, `count=${subjectCount}`);

// By label, not by index: the text inputs are title / summary / place in DOM order, and an index is
// exactly the kind of thing a new field silently shifts.
const TITLE = `Warsztat ${Date.now()}`;
await host.getByLabel('Title', { exact: true }).fill(TITLE);
// Since fd70011 the date is optional: pick the "exact" scheduling mode so the field renders.
await host.locator('input[name="event-scheduling"][value="exact"]').check({ force: true });
await host.locator('input[name="event-visibility"][value="public"]').check({ force: true });
await host.locator('input[type="datetime-local"]').waitFor();
await host.locator('input[type="datetime-local"]').fill(whenLocal);
await placeInput(host).fill('Sala 101');
const firstSubjectLabel = (await host.locator('.subjects .check span').first().innerText()).trim();
await subjectBoxes.first().check();
await host.locator('button[type="submit"]').click();
await settle(host, 2500);
check('the event was created', /\/events\/\d+$/.test(host.url()), host.url());
const eventId = host.url().split('/').pop();

console.log('\n[2] The host is warned about their own published hours');
let text = await host.locator('.page').innerText();
check('a clash warning is shown', /still published as bookable/i.test(text), text.slice(0, 400));
check('and it is not phrased as an error', (await host.locator('.error').count()) === 0);

console.log('\n[3] Editing an event — the page that did not exist');
await goto(host, `/events/${eventId}/edit`);
const titleInput = host.getByLabel('Title', { exact: true });
check('the form is prefilled with the real title', (await titleInput.inputValue()) === TITLE);
const checkedSubject = host.locator('.subjects input[type="checkbox"]:checked');
check(
	'and the subject picked at creation is still ticked',
	(await checkedSubject.count()) === 1,
	`label=${firstSubjectLabel}`
);

const NEW_TITLE = `${TITLE} (poprawiony)`;
await titleInput.fill(NEW_TITLE);
await placeInput(host).fill('Sala 202');
await host.locator('button[type="submit"]').click();
await settle(host, 2500);
check('saving returns to the event', /\/events\/\d+$/.test(host.url()), host.url());
text = await host.locator('.page').innerText();
check('the new title is live', text.includes(NEW_TITLE));
check('and the new room is too', /Sala 202/.test(text));

console.log('\n[4] Somebody else cannot edit it');
const guestEmail = await register(guest, 'eguest');
await goto(guest, `/events/${eventId}/edit`);
const guestText = await guest.locator('.page').innerText();
check(
	'a non-host is refused in words, not with a form',
	/Only the person running this event/i.test(guestText),
	guestText.slice(0, 200)
);
check(
	'and is shown no form at all',
	(await guest.getByLabel('Title', { exact: true }).count()) === 0
);

console.log('\n[5] Attending does not block hours — but one click does');
await goto(guest, `/events/${eventId}`);
await guest
	.getByRole('button', { name: /I am going/i })
	.first()
	.click();
await settle(guest, 2000);
const holdButton = guest.getByRole('button', { name: /Keep these hours free/i });
check('the escape hatch is offered once going', (await holdButton.count()) === 1);
await holdButton.click();
await settle(guest, 2000);
const afterHold = await guest.locator('.page').innerText();
check(
	'and it confirms the hours are blocked',
	/now blocked in your tutoring schedule/i.test(afterHold),
	afterHold.slice(0, 300)
);

// The confirmation sentence is not the evidence — the stored exception is. Read it back from the API
// so a button that only ever changed a flag on the page would fail here.
const guestToken = await token(guestEmail);
const exceptions = await fetch(`${API}/availability-exceptions/`, {
	headers: { Authorization: `Token ${guestToken}` }
}).then((r) => r.json());
const held = exceptions.find((e) => e.kind === 'block' && e.note?.includes(TITLE));
check(
	'a real availability block was written, not just a message shown',
	Boolean(held),
	JSON.stringify(exceptions).slice(0, 300)
);
check(
	'and it names the event, so it is not an unexplained hole later',
	held?.note?.includes(TITLE)
);

console.log('\n[6] The drawer traps focus on a phone');
const phone = await person('phone', { width: 390, height: 844 });
await goto(phone, '/');
const toggle = phone.locator('.drawer-toggle');
check('the menu button is present', (await toggle.count()) === 1);
await toggle.click();
await settle(phone, 700);
check('the drawer opened', (await phone.locator('.drawer--open').count()) === 1);

// Tab far more times than there are stops, so the cycle must wrap several times over. Anything that
// leaks focus into the page behind shows up as an element outside the drawer and the toggle.
let escaped = null;
for (let i = 0; i < 40; i++) {
	await phone.keyboard.press('Tab');
	const where = await phone.evaluate(() => {
		const el = document.activeElement;
		if (!el || el === document.body) return 'body';
		if (el.closest('.drawer')) return 'drawer';
		if (el.classList.contains('drawer-toggle')) return 'toggle';
		return `OUTSIDE:${el.tagName.toLowerCase()}.${el.className}`;
	});
	if (where !== 'drawer' && where !== 'toggle') {
		escaped = `after ${i + 1} tabs → ${where}`;
		break;
	}
}
check('focus never leaves the drawer', escaped === null, escaped ?? '');

// Backwards too — a trap that only holds in one direction is not a trap.
let escapedBack = null;
for (let i = 0; i < 20; i++) {
	await phone.keyboard.press('Shift+Tab');
	const where = await phone.evaluate(() => {
		const el = document.activeElement;
		if (!el || el === document.body) return 'body';
		if (el.closest('.drawer')) return 'drawer';
		if (el.classList.contains('drawer-toggle')) return 'toggle';
		return `OUTSIDE:${el.tagName.toLowerCase()}`;
	});
	if (where !== 'drawer' && where !== 'toggle') {
		escapedBack = `after ${i + 1} shift-tabs → ${where}`;
		break;
	}
}
check('and it holds shift-tabbing backwards', escapedBack === null, escapedBack ?? '');

await phone.keyboard.press('Escape');
await settle(phone, 500);
check('Escape still closes it', (await phone.locator('.drawer--open').count()) === 0);
const focusReturned = await phone.evaluate(() =>
	document.activeElement?.classList.contains('drawer-toggle')
);
check('and focus comes back to the button that opened it', focusReturned === true);

console.log(`\n${pass} passed, ${fail} failed`);
if (errors.length) console.log('page errors:\n' + errors.join('\n'));
else console.log('zero console/page errors');
await browser.close();
process.exit(fail === 0 && errors.length === 0 ? 0 : 1);
