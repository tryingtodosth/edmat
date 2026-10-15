// WP14b — the first-visitor audit's layout and first-impression findings (2026-10-15), in BOTH
// interface languages (Polish as a fresh context gets it, English through `english.mjs`).
//
//   6. A sentence-length status message wraps (`mix.status-message`): the booking panel's
//      "request sent" line and its link stay inside a 390px screen.
//  10. The branch page leads with its exercises: the concepts are a compact strip of chips AFTER
//      the list, not a block of cards before it.
//  11. On a phone the exercise statement is above the fold; empty covers/requires claims are one
//      quiet line (both groups still present), and a hint's/solution's licence is a tap away.
//  13. The course page says "Program kursu" / "Content" once, and the deck button says "fiszki".
//  14. Registering draws the welcome card once (inbox line, three first steps) and never again
//      after a reload; a new profile's activity is a real empty state, not "nothing matches".
//  Plus: no element wider than the screen at 390 on every page touched here.
//
//   E2E_BASE=http://localhost:5218 E2E_API=http://127.0.0.1:8068 E2E_TOKEN=<ola's token> \
//     CHROME=<chrome-headless-shell> TZ=Europe/Warsaw node e2e/wp14b-layout.mjs
//
// E2E_TOKEN is a seeded account that is NOT the tutor of listing E2E_SERVICE (default 7; ola on
// the dev database — read it as e2e/CLAUDE.md trap 30 says). Without it the booking check is
// skipped and says so. It registers TWO throwaway accounts (one per language; the register
// throttle is ~10/hour, trap 1), cancels the booking request it made and schedules both accounts
// for deletion through the real endpoints. Run it on a copy of the database.
import { readFileSync, mkdirSync } from 'node:fs';
let chromium;
try {
	({ chromium } = await import('playwright'));
} catch {
	({ chromium } = await import('playwright-core'));
}
import { englishContext } from './english.mjs';

const BASE = process.env.E2E_BASE ?? 'http://localhost:5173';
const API = process.env.E2E_API ?? 'http://localhost:8000';
const TOKEN = process.env.E2E_TOKEN ?? '';
const SERVICE = process.env.E2E_SERVICE ?? '7';
const BRANCH = process.env.E2E_BRANCH ?? 'analiza-matematyczna';
const EXERCISE = process.env.E2E_EXERCISE ?? '1';
const COURSE = process.env.E2E_COURSE ?? '7';
const SHOTS = 'e2e/screenshots';
mkdirSync(SHOTS, { recursive: true });

const CATALOGUE = {
	en: JSON.parse(readFileSync(new URL('../messages/en.json', import.meta.url), 'utf8')),
	pl: JSON.parse(readFileSync(new URL('../messages/pl.json', import.meta.url), 'utf8'))
};

let pass = 0,
	fail = 0;
const check = (label, ok, extra = '') => {
	if (ok) pass++;
	else fail++;
	console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${label} ${ok ? '' : extra}`);
};
const api = async (path, { method = 'GET', body, token } = {}) => {
	const res = await fetch(`${API}${path}`, {
		method,
		headers: {
			'Content-Type': 'application/json',
			...(token ? { Authorization: `Token ${token}` } : {})
		},
		body: body ? JSON.stringify(body) : undefined
	});
	let data = null;
	try {
		data = await res.json();
	} catch {
		/* empty body */
	}
	return { status: res.status, data };
};

const browser = await chromium.launch(
	process.env.CHROME ? { executablePath: process.env.CHROME } : {}
);
const errors = [];
let ignoredFonts = 0;
function watch(page) {
	page.on('pageerror', (e) => errors.push(`${page.url()}: ${e.message}`));
	page.on('console', (m) => {
		if (m.type() !== 'error') return;
		// A refused resource logs a line with no URL in it; the `response` handler below decides
		// whether it was one we ignore (KaTeX fonts in a worktree, trap 26).
		if (m.text().startsWith('Failed to load resource')) return;
		errors.push(`${page.url()}: ${m.text()}`);
	});
	page.on('response', (r) => {
		if (r.status() < 400) return;
		if (r.url().includes('/katex/') && r.status() === 403) {
			ignoredFonts++;
			return;
		}
		errors.push(`${r.status()} ${r.url()}`);
	});
}

/** Everything under <main> that runs past the viewport's right edge: element boxes, AND text — a
 *  block whose text is held on one line by `nowrap` keeps its own box inside the column while the
 *  words run off it, which an element-box check cannot see (that is the exact shape of audit
 *  finding 6). Anything inside a real horizontal scroller (overflow-x auto/scroll — a wide table
 *  in a scroll box is fine) or a visually-hidden clip is ignored. `main` clips overflow, so
 *  `scrollWidth` alone cannot see any of this — it is how audit finding 3 hid. Checked against the
 *  old shape: forcing `nowrap` back onto the exercise page's paragraphs makes it report them. */
const overflowing = (page) =>
	page.evaluate(() => {
		const vw = window.innerWidth;
		const main = document.querySelector('main');
		const out = [];
		const excused = (node) => {
			for (let a = node.parentElement; a && a !== main; a = a.parentElement) {
				const cs = getComputedStyle(a);
				if (cs.overflowX === 'auto' || cs.overflowX === 'scroll') return true;
				if (cs.clip && cs.clip !== 'auto') return true;
			}
			return false;
		};
		for (const el of main.querySelectorAll('*')) {
			const r = el.getBoundingClientRect();
			if (r.width === 0 || r.height === 0 || r.right <= vw + 1 || excused(el)) continue;
			out.push(
				`${el.tagName.toLowerCase()}.${[...el.classList].join('.')} → ${Math.round(r.right)}`
			);
		}
		const walker = document.createTreeWalker(main, NodeFilter.SHOW_TEXT);
		const range = document.createRange();
		for (let n = walker.nextNode(); n; n = walker.nextNode()) {
			if (!n.textContent.trim()) continue;
			range.selectNodeContents(n);
			const r = range.getBoundingClientRect();
			if (r.width === 0 || r.right <= vw + 1 || excused(n)) continue;
			out.push(`text "${n.textContent.trim().slice(0, 40)}" → ${Math.round(r.right)}`);
		}
		return out.slice(0, 5);
	});

async function newPage(locale, viewport, extra = {}) {
	const options = { viewport, timezoneId: 'Europe/Warsaw', ...extra };
	const ctx =
		locale === 'en'
			? await englishContext(browser, BASE, options)
			: await browser.newContext(options);
	const page = await ctx.newPage();
	watch(page);
	return page;
}
const goto = async (page, path) => {
	await page.goto(`${BASE}${path}`, { waitUntil: 'load' });
};

const accounts = [];
let bookingId = null;

try {
	for (const locale of ['pl', 'en']) {
		const t = CATALOGUE[locale];
		console.log(`\n== ${locale} ==`);

		// ---- 10: the branch page at 390 -----------------------------------------------------------
		const phone = await newPage(locale, { width: 390, height: 844 });
		await goto(phone, `/branches/${BRANCH}`);
		// English hides the Polish corpus unless asked (§17AQ): read it in Polish too, as a reader would.
		if (locale === 'en') {
			await phone.evaluate(() => localStorage.setItem('edmat.contentLocales', '["pl"]'));
			await goto(phone, `/branches/${BRANCH}`);
		}
		await phone.locator('.exercises-column article').first().waitFor({ timeout: 30000 });
		await phone.waitForTimeout(800);
		await phone.screenshot({ path: `${SHOTS}/wp14b-branch-390-${locale}.png` });
		const branch = await phone.evaluate(() => {
			const cards = [...document.querySelectorAll('.exercises-column article')];
			const strip = document.querySelector('section.concepts');
			return {
				lastCard: cards.length
					? cards[cards.length - 1].getBoundingClientRect().top + scrollY
					: null,
				firstCard: cards.length ? cards[0].getBoundingClientRect().top + scrollY : null,
				strip: strip ? strip.getBoundingClientRect().top + scrollY : null,
				chips: strip ? strip.querySelectorAll('.concepts__chips li').length : 0,
				cards: document.querySelectorAll('.concept-card').length
			};
		});
		check(
			'branch: the concepts strip comes after the exercise list',
			branch.strip === null || branch.strip > branch.lastCard,
			JSON.stringify(branch)
		);
		check(
			'branch: concepts are chips (at most 8), not cards',
			branch.cards === 0 && branch.chips <= 8,
			JSON.stringify(branch)
		);
		check(
			'branch: no concept stands between the tabs and the first exercise',
			branch.firstCard !== null && (branch.strip === null || branch.strip > branch.firstCard)
		);
		check(
			'branch at 390: nothing wider than the screen',
			(await overflowing(phone)).length === 0,
			(await overflowing(phone)).join(', ')
		);
		if (branch.strip !== null) {
			await phone.locator('section.concepts').scrollIntoViewIfNeeded();
			await phone.screenshot({ path: `${SHOTS}/wp14b-branch-concepts-390-${locale}.png` });
			const all = await phone.locator('a.concepts__all').getAttribute('href');
			check(
				'branch: "see all" opens the concept hub filtered to this branch',
				all === `/concepts?branch=${BRANCH}`,
				all
			);
		}

		// ---- 11: the exercise page at 390 ---------------------------------------------------------
		await goto(phone, `/exercises/${EXERCISE}`);
		await phone.locator('.content-section .katex').first().waitFor({ timeout: 30000 });
		await phone.waitForTimeout(800);
		await phone.screenshot({ path: `${SHOTS}/wp14b-exercise-390-${locale}.png` });
		const ex = await phone.evaluate(() => {
			const section = document.querySelector('.content-section');
			const math = section?.querySelector('.katex');
			const claims = document.querySelector('.claim-groups');
			return {
				mathBottom: math ? math.getBoundingClientRect().bottom + scrollY : null,
				statementBeforeClaims: Boolean(
					section &&
					claims &&
					section.compareDocumentPosition(claims) & Node.DOCUMENT_POSITION_FOLLOWING
				),
				compact: document.querySelectorAll('.claim-groups--compact section.claim-group[data-kind]')
					.length,
				height: window.innerHeight
			};
		});
		check(
			'exercise at 390: the statement is above the fold',
			ex.mathBottom !== null && ex.mathBottom < ex.height,
			JSON.stringify(ex)
		);
		check('exercise: the statement comes before the claims', ex.statementBeforeClaims);
		check(
			'exercise: no claims yet → one compact line, both groups still there',
			ex.compact === 2,
			JSON.stringify(ex)
		);
		const none = await phone.locator('.claim-groups--compact .compact-none').first().innerText();
		check(
			'exercise: the compact line says "nothing yet" in this language',
			none.trim() === t.wp14b_claims_none,
			none
		);
		check(
			'exercise at 390: nothing wider than the screen',
			(await overflowing(phone)).length === 0,
			(await overflowing(phone)).join(', ')
		);

		// Hints/solutions: one quiet line, the licence opens on a tap.
		const reveal = phone.locator('button', {
			hasText: locale === 'pl' ? /Pokaż rozwiązania/ : /Show solutions/
		});
		if (await reveal.count()) {
			await reveal.first().click();
			await phone.locator('.entry').first().waitFor();
			const entry = phone.locator('.entry').first();
			const pills = await entry.locator('.entry__meta .badge').count();
			const pending = await entry
				.locator('.entry__meta .badge--pending, .entry__meta .badge--rejected')
				.count();
			check(
				"solution: no filled pills on a published entry's meta line",
				pills - pending === 0,
				`${pills}`
			);
			await entry.locator('[data-testid="entry-licence"]').click();
			const lic = await entry.locator('.entry__licence').innerText();
			check('solution: the licence sentence opens on a tap', lic.length > 20, lic);
			await entry.scrollIntoViewIfNeeded();
			await phone.screenshot({ path: `${SHOTS}/wp14b-solution-390-${locale}.png` });
		} else check('the exercise has a solution to open', false);

		// ---- 13: the course page --------------------------------------------------------------------
		await goto(phone, `/courses/${COURSE}`);
		await phone.locator('section.content h2').first().waitFor({ timeout: 30000 });
		await phone.waitForTimeout(800);
		const h2 = (await phone.locator('section.content h2').first().innerText()).trim();
		check(
			'course: the programme heading reads as the catalogue says',
			h2 === t.course_items_heading,
			h2
		);
		if (locale === 'pl') check('course: pl heading is "Program kursu"', h2 === 'Program kursu', h2);
		const heads = (await phone.locator('main h2, main h3').allInnerTexts()).map((s) =>
			s.split('\n')[0].trim()
		);
		check(
			'course: the programme heading appears once',
			heads.filter((h) => h === h2).length === 1,
			heads.join(' | ')
		);
		const deckButtons = await phone
			.locator('main button, main a')
			.filter({ hasText: t.school_deckFromLesson })
			.count();
		if (locale === 'pl')
			check(
				'course: the deck button says "Zrób fiszki z tego tygodnia"',
				t.school_deckFromLesson === 'Zrób fiszki z tego tygodnia'
			);
		console.log(
			`  (course: ${deckButtons} "${t.school_deckFromLesson}" buttons for a signed-out reader)`
		);
		check(
			'course at 390: nothing wider than the screen',
			(await overflowing(phone)).length === 0,
			(await overflowing(phone)).join(', ')
		);
		await phone.locator('section.content').scrollIntoViewIfNeeded();
		await phone.screenshot({ path: `${SHOTS}/wp14b-course-390-${locale}.png` });
		await phone.context().close();

		// ---- 6: the booking panel's sentence wraps --------------------------------------------------
		if (!TOKEN) {
			console.log('  (skipped the booking check: no E2E_TOKEN)');
		} else {
			const booker = await newPage(locale, { width: 390, height: 844 });
			await booker.context().addInitScript((tok) => {
				try {
					localStorage.setItem('edmat-auth-token', tok);
				} catch {
					/* no storage */
				}
			}, TOKEN);
			await goto(booker, locale === 'pl' ? `/korki/${SERVICE}` : `/tutoring/${SERVICE}`);
			const slots = booker.locator('.booking .slots button');
			await slots
				.first()
				.waitFor({ timeout: 30000 })
				.catch(() => {});
			let made = false;
			const n = await slots.count();
			for (let i = 0; i < n && !made; i++) {
				const slot = slots.nth(i);
				if (await slot.isDisabled()) continue;
				await slot.click();
				const askButton = booker.getByRole('button', { name: t.booking_request, exact: true });
				const response = booker.waitForResponse(
					(r) => r.url().endsWith('/api/bookings/') && r.request().method() === 'POST'
				);
				await askButton.first().click();
				const res = await response;
				if (res.status() < 300) {
					bookingId = (await res.json()).id;
					made = true;
				}
			}
			check('booking: a request was made', made);
			if (made) {
				const notice = booker.locator('.notice').first();
				await notice.waitFor();
				await notice.scrollIntoViewIfNeeded();
				const box = await notice.boundingBox();
				const link = await notice.locator('a').boundingBox();
				check(
					'booking: the "request sent" sentence fits a 390 screen',
					box.x + box.width <= 390,
					JSON.stringify(box)
				);
				check(
					'booking: its link is on the screen and tappable',
					link && link.x + link.width <= 390,
					JSON.stringify(link)
				);
				await booker.screenshot({ path: `${SHOTS}/wp14b-booking-390-${locale}.png` });
				const cancel = await api(`/api/bookings/${bookingId}/cancel/`, {
					method: 'POST',
					body: {},
					token: TOKEN
				});
				check('cleanup: the booking request is cancelled', cancel.status < 300, `${cancel.status}`);
				bookingId = null;
			}
			await booker.context().close();
		}

		// ---- 14: the welcome card, once; the new profile's empty state ------------------------------
		const fresh = await newPage(locale, { width: 390, height: 844 });
		await goto(fresh, '/register');
		await fresh.waitForTimeout(2500);
		const email = `wp14b.${locale}.${Date.now()}@example.com`;
		const password = 'wp14b-password-123';
		const form = fresh.locator('form').first();
		await form
			.locator('input[type=text]')
			.first()
			.fill(locale === 'pl' ? 'Nowa Osoba' : 'New Person');
		await form.locator('input[type=email]').fill(email);
		if (await form.locator('input[inputmode=numeric]').count())
			await form.locator('input[inputmode=numeric]').fill('2000');
		await form.locator('input[type=password]').fill(password);
		await form.locator('input[type=checkbox]').last().check();
		await form.locator('button[type=submit]').click();
		const card = fresh.locator('[data-testid="welcome-card"]');
		await card.waitFor({ timeout: 20000 });
		const token = await fresh.evaluate(() => localStorage.getItem('edmat-auth-token'));
		const me = await api('/api/auth/me/', { token });
		accounts.push({ token, password, username: me.data?.username, id: me.data?.id });
		await fresh
			.locator('[data-testid="welcome-inbox"]')
			.waitFor({ timeout: 10000 })
			.catch(() => {});
		await fresh.screenshot({ path: `${SHOTS}/wp14b-welcome-390-${locale}.png` });
		const heading = (await card.locator('h2').innerText()).trim();
		check(
			'welcome: the card greets the new account by name',
			heading.includes(locale === 'pl' ? 'Nowa Osoba' : 'New Person'),
			heading
		);
		check(
			'welcome: it says to check the inbox, with the address',
			(await card.locator('[data-testid="welcome-inbox"]').innerText()).includes(email)
		);
		const steps = await card
			.locator('[data-welcome-step]')
			.evaluateAll((as) => as.map((a) => a.getAttribute('href')));
		check(
			'welcome: three first steps (exercises, the guide, languages)',
			JSON.stringify(steps) === JSON.stringify(['/disciplines', '/about/guide/start', '/settings']),
			JSON.stringify(steps)
		);
		check(
			'welcome at 390: nothing wider than the screen',
			(await overflowing(fresh)).length === 0,
			(await overflowing(fresh)).join(', ')
		);
		await fresh.reload({ waitUntil: 'load' });
		await fresh.waitForTimeout(3000);
		check('welcome: shown once — gone after a reload', (await card.count()) === 0);

		await goto(fresh, `/users/${me.data?.id}`);
		const empty = fresh.locator('[data-empty-state="profile-activity"]').first();
		await empty.waitFor({ timeout: 20000 });
		check(
			'profile: a new account\'s activity is "empty", not "nothing matches"',
			(await empty.getAttribute('data-empty-kind')) === 'empty'
		);
		const said = await empty.locator('.empty-state__message').innerText();
		check(
			'profile: it says what the list is for, in this language',
			said.trim() === t.wp14b_activity_emptyOwn,
			said
		);
		check(
			'profile: and offers a first step',
			(await empty.locator('[data-empty-action]').count()) === 1
		);
		check(
			'profile at 390: nothing wider than the screen',
			(await overflowing(fresh)).length === 0,
			(await overflowing(fresh)).join(', ')
		);
		await empty.scrollIntoViewIfNeeded();
		await fresh.screenshot({ path: `${SHOTS}/wp14b-profile-empty-390-${locale}.png` });
		await fresh.context().close();

		// ---- the same pages at 1280, looked at --------------------------------------------------
		const desk = await newPage(locale, { width: 1280, height: 900 });
		if (locale === 'en') {
			await goto(desk, '/');
			await desk.evaluate(() => localStorage.setItem('edmat.contentLocales', '["pl"]'));
		}
		for (const [name, path, ready] of [
			['branch', `/branches/${BRANCH}`, '.exercises-column article'],
			['exercise', `/exercises/${EXERCISE}`, '.content-section .katex'],
			['course', `/courses/${COURSE}`, 'section.content h2']
		]) {
			await goto(desk, path);
			await desk.locator(ready).first().waitFor({ timeout: 30000 });
			await desk.waitForTimeout(800);
			await desk.screenshot({ path: `${SHOTS}/wp14b-${name}-1280-${locale}.png` });
		}
		await desk.context().close();
	}
} catch (error) {
	check('the run reached its end', false, String(error).split('\n')[0]);
} finally {
	if (bookingId && TOKEN)
		await api(`/api/bookings/${bookingId}/cancel/`, { method: 'POST', body: {}, token: TOKEN });
	for (const a of accounts) {
		const erase = await api('/api/auth/me/erasure/', {
			method: 'POST',
			body: { password: a.password, username: a.username },
			token: a.token
		});
		check(
			`cleanup: throwaway account ${a.id} is scheduled for deletion`,
			erase.status < 300,
			`${erase.status}`
		);
	}
	await browser.close();
}

if (ignoredFonts)
	console.log(`\n(ignored ${ignoredFonts} KaTeX font 403s — e2e/CLAUDE.md trap 26)`);
check(
	'no console or page errors',
	errors.length === 0,
	'\n    ' + errors.slice(0, 10).join('\n    ')
);
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
