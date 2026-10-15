// WP14a — the first-visitor audit's broken flows (2026-10-15), each driven the way a person meets
// it, in Polish on a 390 px touch screen and in English at 1280:
//
//   5  after /submit the notice is scrolled to and focused, and links to /submit/mine, which lists
//      what was sent (pending, published, not accepted with the moderator's reason); a rejection
//      notification opens it; /users/{me}/unpublished counts what is waiting and no longer says
//      everything is published.
//   7  the booking panel's "See your bookings" opens /bookings?tab=mine, the page's tabs live in the
//      address, and the page has one name ("Moje rezerwacje" / "My bookings").
//   8  saving to the working set says "added", not "removed".
//   19 "3 recenzje" / "3 reviews", never "3 recenzji".
//   20 the slot you tapped stays visible under a touch screen's sticky :hover.
//   18 Settings and the register form carry no English developer text in Polish.
//
// Mutates the dev database: two exercise submissions by `ola` (one rejected by `kasia`, both
// deleted at the end through the API), and two booking requests on listing E2E_LISTING (cancelled
// at the end — a booking has no delete). Signs in by token: set E2E_OLA_TOKEN and E2E_KASIA_TOKEN
// (e2e/CLAUDE.md trap 30), or it logs in with the demo password, which spends the login throttle.
//
//   E2E_BASE=http://127.0.0.1:5217 E2E_API=http://127.0.0.1:8067/api \
//     E2E_OLA_TOKEN=… E2E_KASIA_TOKEN=… node e2e/wp14a-flows.mjs
import { mkdirSync } from 'node:fs';
import { englishContext } from './english.mjs';

let chromium;
try {
	({ chromium } = await import('playwright'));
} catch {
	({ chromium } = await import('playwright-core'));
}

const BASE = process.env.E2E_BASE ?? 'http://127.0.0.1:5217';
const API = process.env.E2E_API ?? 'http://127.0.0.1:8067/api';
const SHOTS = process.env.E2E_SHOTS ?? 'e2e/screens/';
const LISTING = process.env.E2E_LISTING ?? '7';
const RATED_EXERCISE = process.env.E2E_RATED_EXERCISE ?? '1';
mkdirSync(SHOTS, { recursive: true });

let passed = 0;
let failed = 0;
const check = (label, ok, extra = '') => {
	if (ok) passed++;
	else failed++;
	console.log(`${ok ? '  PASS' : '  FAIL'} ${label}${extra ? ` — ${extra}` : ''}`);
};

async function login(username) {
	const r = await fetch(`${API}/auth/login/`, {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify({ username, password: 'password123' })
	});
	if (!r.ok) throw new Error(`login ${username}: ${r.status}`);
	return (await r.json()).token;
}
const olaToken = process.env.E2E_OLA_TOKEN ?? (await login('ola@edmat.example'));
const kasiaToken = process.env.E2E_KASIA_TOKEN ?? (await login('kasia@edmat.example'));
const api = async (token, path, init = {}) => {
	const r = await fetch(`${API}${path}`, {
		...init,
		headers: { Authorization: `Token ${token}`, 'Content-Type': 'application/json' }
	});
	const text = await r.text();
	return { status: r.status, body: text ? JSON.parse(text) : null };
};
const olaId = String((await api(olaToken, '/auth/me/')).body.id);

const browser = await chromium.launch({ executablePath: process.env.CHROME || undefined });
const errors = [];
let ignoredFonts = 0;
function watch(page) {
	page.on('pageerror', (e) => errors.push(`pageerror ${page.url()}: ${e.message}`));
	// e2e/CLAUDE.md trap 26: KaTeX's webfonts 403 from a worktree's dev server. Matched on the
	// response URL, never on the console text, and counted so the suppression is never silent.
	page.on('response', (r) => {
		if (r.status() === 403 && r.url().includes('/katex/')) ignoredFonts++;
	});
	page.on('console', (m) => {
		if (m.type() !== 'error') return;
		if (m.text().includes('Failed to load resource')) return; // reported via `response` below
		errors.push(`console ${page.url()}: ${m.text().slice(0, 200)}`);
	});
	page.on('response', (r) => {
		if (r.status() >= 500) errors.push(`${r.status()} ${r.url()}`);
	});
}

async function signedInContext(locale, viewport, extra = {}) {
	const options = { viewport, timezoneId: 'Europe/Warsaw', ...extra };
	const ctx =
		locale === 'en'
			? await englishContext(browser, BASE, options)
			: await browser.newContext(options);
	await ctx.addInitScript((t) => localStorage.setItem('edmat-auth-token', t), olaToken);
	return ctx;
}
async function noHorizontalScroll(page) {
	return page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth);
}

const T = {
	pl: {
		title: 'Tytuł',
		statement: 'Treść',
		mineHeading: 'Wysłane przez Ciebie zadania',
		pending: 'Czeka na moderatora',
		rejected: 'Nieprzyjęte',
		reasonLabel: 'Powód podany przez moderatora',
		everythingPublished: 'Wszystko, co dodałeś/aś, jest opublikowane.',
		waiting: /\d+ wysłan\S+ zada\S+ czek/,
		bookingsHeading: 'Moje rezerwacje',
		tabMine: 'Zarezerwowane przeze mnie',
		added: 'Dodano do zestawu roboczego',
		removed: 'Usunięto z zestawu roboczego',
		reviews: /Średnia [\d.,]+ · 3 recenzje/,
		badReviews: /\b[1-4] recenzji\b/,
		usosEnglish: /OAuth|HMAC|LAUNCHCHECKLIST|Email confirmation|Active account/,
		standingPolish: 'Konto aktywne',
		school: 'Kontynuuj przez konto uczelniane'
	},
	en: {
		title: 'Title',
		statement: 'Statement',
		mineHeading: "Exercises you've sent",
		pending: 'Waiting for review',
		rejected: 'Not accepted',
		reasonLabel: "Moderator's reason",
		everythingPublished: 'Everything you contributed is published.',
		waiting: /\d+ exercises? you sent (is|are) waiting/,
		bookingsHeading: 'My bookings',
		tabMine: 'Booked by me',
		added: 'Added to your working set',
		removed: 'Removed from your working set',
		reviews: /[\d.,]+ average · 3 reviews/,
		badReviews: /\b1 reviews\b/,
		usosEnglish: /OAuth|HMAC|LAUNCHCHECKLIST|Email confirmation is not built/,
		standingPolish: 'Active account',
		school: 'Continue with University account'
	}
};

const created = { submissions: [], bookings: [] };

async function run(locale, viewport, touch) {
	const t = T[locale];
	const tag = `${locale}-${viewport.width}`;
	console.log(`\n== ${locale.toUpperCase()} at ${viewport.width}`);
	const ctx = await signedInContext(
		locale,
		viewport,
		touch ? { hasTouch: true, isMobile: true } : {}
	);
	const page = await ctx.newPage();
	watch(page);

	// ---- finding 5: /submit → the notice, then /submit/mine ------------------------------------
	const title = `wp14a-${locale}-${Date.now()}`;
	await page.goto(`${BASE}/submit`, { waitUntil: 'load' });
	const form = page.locator('form').filter({ has: page.locator('#submit-branch') });
	await form.waitFor({ timeout: 60_000 });
	check(
		`[${tag}] /submit links to the list of what you sent`,
		(await page.locator('.mine-link a').getAttribute('href')) === '/submit/mine'
	);
	await form.locator('#submit-discipline').selectOption('matematyka');
	await page.waitForFunction(
		() => !!document.querySelector('#submit-branch option[value="analiza-matematyczna"]'),
		null,
		{ timeout: 15_000 }
	);
	await form.locator('#submit-branch').selectOption('analiza-matematyczna');
	await form
		.locator('label.field')
		.filter({ hasText: t.title })
		.locator('input')
		.first()
		.fill(title);
	await form.locator('select:has(option[value="university"])').selectOption('university');
	check(`[${tag}] /submit has no horizontal scroll`, await noHorizontalScroll(page));
	const statementField = form.locator('label.field').filter({ hasText: t.statement }).first();
	if ((await statementField.locator('textarea').count()) > 0) {
		await statementField.locator('textarea').fill('Policz \\(1+1\\).');
	} else {
		await statementField.locator('.ProseMirror').waitFor({ timeout: 60_000 });
		await statementField.locator('.ProseMirror').click();
		await page.keyboard.type('Policz 1+1.');
	}
	const posted = page.waitForResponse(
		(r) => r.url().includes('/exercise-submissions/') && r.request().method() === 'POST'
	);
	const send = form.locator('button[type="submit"].submit');
	await send.scrollIntoViewIfNeeded();
	await send.click();
	const submission = await (await posted).json();
	created.submissions.push(submission.id);
	const notice = page.locator('.submitted');
	await notice.waitFor({ timeout: 15_000 });
	await page.waitForTimeout(600);
	const placed = await notice.evaluate((el) => {
		const r = el.getBoundingClientRect();
		return {
			visible: r.top >= 0 && r.bottom <= window.innerHeight,
			focused: document.activeElement === el
		};
	});
	check(`[${tag}] the success notice is scrolled into view`, placed.visible);
	check(`[${tag}] and focused`, placed.focused);
	check(
		`[${tag}] and links to /submit/mine`,
		(await notice.locator('a[href="/submit/mine"]').count()) === 1
	);
	await page.screenshot({ path: `${SHOTS}wp14a-submitted-${tag}.png` });

	// A moderator rejects it, with a reason — the case the list exists for.
	const reject = await api(kasiaToken, `/moderation/submission/${submission.id}/reject/`, {
		method: 'POST',
		body: JSON.stringify({ review_note: `wp14a reason ${locale}` })
	});
	check(`[${tag}] (setup) kasia rejects it`, reject.status === 200, `status=${reject.status}`);

	await notice.locator('a[href="/submit/mine"]').click();
	await page.waitForURL('**/submit/mine', { timeout: 15_000 });
	const row = page.locator(`.row[data-submission="${submission.id}"]`);
	await row.waitFor({ timeout: 30_000 });
	check(
		`[${tag}] /submit/mine is headed "${t.mineHeading}"`,
		(await page.locator('h1').innerText()) === t.mineHeading
	);
	check(
		`[${tag}] the new submission is listed as not accepted`,
		(await row.getAttribute('data-status')) === 'rejected' &&
			(await row.innerText()).includes(t.rejected)
	);
	check(
		`[${tag}] with the moderator's reason`,
		(await row.innerText()).includes(t.reasonLabel) &&
			(await row.innerText()).includes(`wp14a reason ${locale}`)
	);
	const statuses = await page
		.locator('.row')
		.evaluateAll((rows) => rows.map((r) => r.getAttribute('data-status')));
	check(
		`[${tag}] and only ola's own rows are there`,
		statuses.length > 0 && statuses.every((s) => ['pending', 'approved', 'rejected'].includes(s))
	);
	check(`[${tag}] /submit/mine has no horizontal scroll`, await noHorizontalScroll(page));
	await page.screenshot({ path: `${SHOTS}wp14a-mine-${tag}.png`, fullPage: true });

	// The rejection notification opens the same list.
	await page.goto(`${BASE}/notifications`, { waitUntil: 'load' });
	const card = page.locator('a.notification-card[href="/submit/mine"]').first();
	await card.waitFor({ timeout: 30_000 }).catch(() => {});
	check(
		`[${tag}] a rejected-submission notification links to /submit/mine`,
		(await card.count()) === 1
	);

	// A second one left pending, so the unpublished page has something waiting to count.
	const pending = await api(olaToken, '/exercise-submissions/', {
		method: 'POST',
		body: JSON.stringify({
			branch: 'analiza-matematyczna',
			payload: {
				title: `${title}-pending`,
				statement: 'S',
				difficulty: 'easy',
				locale: 'pl',
				audience: 'university'
			}
		})
	});
	created.submissions.push(pending.body?.id);
	await page.goto(`${BASE}/users/${olaId}/unpublished`, { waitUntil: 'load' });
	await page.locator('.sent').waitFor({ timeout: 30_000 });
	const unpublished = await page.locator('main').innerText();
	check(`[${tag}] /users/{me}/unpublished counts what is waiting`, t.waiting.test(unpublished));
	check(
		`[${tag}] and no longer says everything is published`,
		!unpublished.includes(t.everythingPublished)
	);
	check(
		`[${tag}] and links to /submit/mine`,
		(await page.locator('.sent a[href="/submit/mine"]').count()) === 1
	);
	await page.screenshot({ path: `${SHOTS}wp14a-unpublished-${tag}.png` });

	// ---- findings 20 and 7: the tutoring slot, then "See your bookings" ------------------------
	const lp = locale === 'pl' ? `/korki/${LISTING}` : `/tutoring/${LISTING}`;
	await page.goto(`${BASE}${lp}`, { waitUntil: 'load' });
	const slot = page.locator('.slot').first();
	await slot.waitFor({ timeout: 30_000 });
	await slot.scrollIntoViewIfNeeded();
	if (touch) await slot.tap();
	else {
		await slot.click();
		await slot.hover();
	}
	await page.waitForTimeout(300);
	const look = await slot.evaluate((el) => {
		const s = getComputedStyle(el);
		return {
			color: s.color,
			bg: s.backgroundColor,
			pressed: el.getAttribute('aria-pressed'),
			hover: el.matches(':hover')
		};
	});
	check(
		`[${tag}] the tapped slot is pressed and hovered`,
		look.pressed === 'true' && look.hover,
		JSON.stringify(look)
	);
	check(
		`[${tag}] and its text is not white on a light fill (selected-soft: accent on accent-soft)`,
		look.color !== 'rgb(255, 255, 255)' && look.color !== look.bg,
		JSON.stringify(look)
	);
	await page.screenshot({ path: `${SHOTS}wp14a-slot-${tag}.png` });
	const requested = page.waitForResponse(
		(r) => r.url().endsWith('/bookings/') && r.request().method() === 'POST'
	);
	const ask = page.locator('.request button.submit');
	if (touch) await ask.tap();
	else await ask.click();
	const booking = await (await requested).json();
	created.bookings.push(booking.id);
	const see = page.locator('.booking .notice a');
	await see.waitFor({ timeout: 15_000 });
	check(
		`[${tag}] "See your bookings" points at ?tab=mine`,
		(await see.getAttribute('href')) === '/bookings?tab=mine'
	);
	// Through the DOM: on a phone the link can sit past the pill's edge (finding 6, WP14b's).
	await see.evaluate((a) => a.click());
	await page.waitForURL('**/bookings?tab=mine', { timeout: 15_000 });
	await page.locator('nav.tabs button.active').waitFor({ timeout: 30_000 });
	check(
		`[${tag}] the page is called "${t.bookingsHeading}"`,
		(await page.locator('h1').innerText()) === t.bookingsHeading
	);
	check(
		`[${tag}] and opens on "${t.tabMine}"`,
		(await page.locator('nav.tabs button.active').innerText()).trim() === t.tabMine
	);
	await page
		.locator('main')
		.getByText(booking.service_title, { exact: false })
		.first()
		.waitFor({ timeout: 15_000 })
		.catch(() => {});
	check(
		`[${tag}] where the new request is listed`,
		(await page.locator('main').innerText()).includes(booking.service_title),
		booking.service_title
	);
	check(`[${tag}] /bookings has no horizontal scroll`, await noHorizontalScroll(page));
	await page.screenshot({ path: `${SHOTS}wp14a-bookings-${tag}.png` });
	await page.locator('nav.tabs button').nth(2).click();
	await page.waitForURL('**/bookings?tab=availability', { timeout: 10_000 }).catch(() => {});
	check(
		`[${tag}] a tab click writes the tab into the address`,
		page.url().endsWith('/bookings?tab=availability'),
		page.url()
	);
	await page.locator('nav.tabs button').nth(0).click();
	await page.waitForTimeout(500);
	check(
		`[${tag}] and the default tab is the bare address`,
		page.url().endsWith('/bookings'),
		page.url()
	);

	// ---- finding 18: Settings and the register form --------------------------------------------
	await page.goto(`${BASE}/settings`, { waitUntil: 'load' });
	await page.locator('.standing').waitFor({ timeout: 30_000 });
	const standing = await page.locator('.standing').innerText();
	const usos = await page.locator('.usos').innerText();
	check(
		`[${tag}] "Your standing" is in the interface language`,
		standing.includes(t.standingPolish),
		standing.slice(0, 120)
	);
	check(
		`[${tag}] no protocol line or English developer text under USOS`,
		!t.usosEnglish.test(usos),
		usos.slice(0, 160)
	);
	if (locale === 'pl')
		check(
			`[${tag}] no English in "Twój poziom"`,
			!/Active account|Email confirmation/.test(standing)
		);
	await ctx.close();

	// Signed out from here: the register form, and the working set.
	const anon =
		locale === 'en'
			? await englishContext(browser, BASE, { viewport, timezoneId: 'Europe/Warsaw' })
			: await browser.newContext({ viewport, timezoneId: 'Europe/Warsaw' });
	const ap = await anon.newPage();
	watch(ap);
	await ap.goto(`${BASE}/register`, { waitUntil: 'load' });
	const providers = ap.locator('.providers');
	await providers.waitFor({ timeout: 30_000 });
	const providerText = await providers.innerText();
	check(
		`[${tag}] the institutional provider is named in the interface language`,
		providerText.includes(t.school),
		providerText.slice(0, 200)
	);
	const appleIcon = ap.locator('.provider').filter({ hasText: 'Apple' }).locator('.icon svg');
	check(`[${tag}] Apple's card has a visible mark`, (await appleIcon.count()) === 1);

	// ---- finding 8 and 19 on an exercise page --------------------------------------------------
	await ap.goto(`${BASE}/exercises/${RATED_EXERCISE}`, { waitUntil: 'load' });
	const trigger = ap.locator('.save__trigger').first();
	await trigger.waitFor({ timeout: 30_000 });
	await ap.waitForTimeout(800);
	const text = await ap.locator('main').innerText();
	check(
		`[${tag}] the rating line agrees with its number`,
		t.reviews.test(text) && !t.badReviews.test(text),
		(text.match(/.{0,20}(recenz|review).{0,10}/g) ?? []).slice(0, 3).join(' | ')
	);
	await trigger.click();
	const working = ap.locator('.menu button.menu__row').first();
	await working.waitFor({ timeout: 10_000 });
	await working.click();
	await ap.waitForTimeout(300);
	check(
		`[${tag}] saving says it was added`,
		(await ap.locator('.menu__notice').innerText()) === t.added
	);
	await ap.screenshot({ path: `${SHOTS}wp14a-saved-${tag}.png` });
	await working.click();
	await ap.waitForTimeout(300);
	check(
		`[${tag}] and removing says it was removed`,
		(await ap.locator('.menu__notice').innerText()) === t.removed
	);
	await anon.close();
}

try {
	await run('pl', { width: 390, height: 844 }, true);
	await run('en', { width: 1280, height: 900 }, false);
} finally {
	// ---- clean-up through the real API, then confirmed by re-query (authenticated: trap 12) ----
	for (const id of created.submissions.filter(Boolean)) {
		await api(olaToken, `/exercise-submissions/${id}/`, { method: 'DELETE' });
	}
	for (const id of created.bookings.filter(Boolean)) {
		await api(olaToken, `/bookings/${id}/cancel/`, { method: 'POST', body: '{}' });
	}
	const left = (await api(olaToken, '/exercise-submissions/?mine=1')).body ?? [];
	check(
		'clean-up: the scratch submissions are gone',
		!left.some((s) => created.submissions.includes(s.id))
	);
	const bookings = await Promise.all(
		created.bookings.map((id) => api(olaToken, `/bookings/${id}/`))
	);
	check(
		'clean-up: the scratch booking requests are cancelled',
		bookings.every((b) => b.body?.status === 'cancelled')
	);
	check('zero page or console errors', errors.length === 0, errors.slice(0, 5).join('\n'));
	if (ignoredFonts)
		console.log(
			`  (ignored ${ignoredFonts} KaTeX font 403s from the worktree dev server — trap 26)`
		);
	await browser.close();
	console.log(`\n${passed} passed, ${failed} failed`);
	process.exit(failed ? 1 : 0);
}
