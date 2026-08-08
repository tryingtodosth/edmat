// Text inputs that used to react to keystrokes the typist had not finished making.
//
// Two defects, and each is proved here the only way it can be: by COUNTING requests rather than by
// reading the debounce, and by dispatching real `CompositionEvent`s rather than by asserting on the
// shape of the code.
//
//  1. The browse search boxes fired one request per keystroke, and an older, slower answer could
//     still land on top of a newer one's results.
//  2. Nothing in the app guarded on `compositionstart`/`compositionend`, so an input method's
//     half-formed intermediate text was searched for, and Enter — which means "accept this
//     candidate" while a composition is open — added a chip holding a partial word.
//
// Worth knowing before changing any timing here: this branch's UNFILTERED list is 388 exercises and
// ~245 KB, which the dev server takes **four to five seconds** to answer, while a filtered query
// answers in about 300 ms. That asymmetry is not an inconvenience to be waited out — it is the
// stale-response bug's own natural habitat, and one test below reproduces the race from it with no
// artificial delay at all. It is also why every assertion about what is on screen waits for a
// condition rather than sleeping a fixed interval.
//
// Run it against its own servers, not the ones you are using:
//   E2E_WEB=http://127.0.0.1:5179 E2E_API=http://127.0.0.1:8015/api \
//   PLAYWRIGHT_BROWSERS_PATH=$HOME/.cache/ms-playwright node e2e/typing-guards.mjs
// The API must allow the web origin (DJANGO_CORS_ALLOWED_ORIGINS) or every page renders empty.
import { chromium } from 'playwright-core';

const WEB = process.env.E2E_WEB || 'http://127.0.0.1:5179';
const API = process.env.E2E_API || 'http://127.0.0.1:8015/api';

// A real, well-populated branch, and terms whose result counts are far enough apart to tell one
// answer from another by looking at the page.
const BRANCH = 'analiza-matematyczna';
const ALL = 388;
const SLOW_TERM = 'norma'; // 17 results, delayed on purpose by the route below
const FAST_TERM = 'miara'; // 21 results, answered at once
const FAST_HITS = 21;
const OTHER_TERM = 'pochodna'; // 9 results — a second real query, so a commit is a new question
const OTHER_HITS = 9;

let pass = 0;
let fail = 0;
const problems = [];
const check = (name, ok, detail = '') => {
	if (ok) {
		pass++;
		console.log(`  ok   ${name}`);
	} else {
		fail++;
		problems.push(`${name} ${detail}`);
		console.log(`  FAIL ${name} ${detail}`);
	}
};

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const cards = (page) => page.locator('.exercise-card').count();

/** Wait for the list to settle on a count, generously — the unfiltered answer alone takes ~4.5s. */
async function waitForCards(page, n, timeout = 30000) {
	try {
		await page.waitForFunction(
			(want) => document.querySelectorAll('.exercise-card').length === want,
			n,
			{ timeout }
		);
		return true;
	} catch {
		return false;
	}
}

/** Type into a box one real keystroke at a time.
 *
 * `page.click()` followed by `page.keyboard.type()` sends the keys wherever focus happens to be by
 * the time they are sent — and the /materials page moves its filter bar down when the recommended
 * strip finishes loading, so the keys can land on nothing at all. That reads exactly like a working
 * debounce (no requests fired) and is the reason this helper exists rather than the obvious pair.
 */
async function typeInto(page, selector, text, delay = 40) {
	await page.locator(selector).pressSequentially(text, { delay });
}

async function login(username) {
	const res = await fetch(`${API}/auth/login/`, {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify({ username, password: 'password123' })
	});
	if (!res.ok) throw new Error(`login ${username}: ${res.status} ${await res.text()}`);
	return (await res.json()).token;
}

/**
 * Drive one composition the way an input method does: open it, feed intermediate text through
 * `input` events that carry `isComposing`, then either commit it or leave it open. These are real
 * events on the real element, so the component's own handlers run exactly as they would for a
 * person typing Japanese — which is the only way to tell a guard that works from one that merely
 * reads as though it should.
 */
async function compose(page, selector, { intermediate, final = null }) {
	await page.evaluate(
		({ selector, intermediate, final }) => {
			const el = document.querySelector(selector);
			el.focus();
			if (intermediate.length) {
				el.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true, data: '' }));
			}
			for (const step of intermediate) {
				el.value = step;
				el.dispatchEvent(new CompositionEvent('compositionupdate', { bubbles: true, data: step }));
				// `isComposing` is what separates this from a keystroke somebody meant.
				el.dispatchEvent(new InputEvent('input', { bubbles: true, isComposing: true }));
			}
			if (final !== null) {
				el.value = final;
				el.dispatchEvent(new CompositionEvent('compositionend', { bubbles: true, data: final }));
				// Browsers follow `compositionend` with a plain `input`; the app has to cope with
				// either order, and this is the common one.
				el.dispatchEvent(new InputEvent('input', { bubbles: true, isComposing: false }));
			}
		},
		{ selector, intermediate, final }
	);
}

/** Enter, delivered either mid-composition (where it means "accept this candidate") or for real. */
async function pressEnter(page, selector, { composing }) {
	await page.evaluate(
		({ selector, composing }) => {
			document.querySelector(selector).dispatchEvent(
				new KeyboardEvent('keydown', {
					key: 'Enter',
					code: 'Enter',
					bubbles: true,
					cancelable: true,
					isComposing: composing
				})
			);
		},
		{ selector, composing }
	);
}

// Vite serves this worktree's dependencies through a symlink into the main checkout, which its own
// `fs.allow` refuses — so KaTeX's font files 403. An artifact of how this worktree is set up, not
// anything the app does; every other console error still counts.
const isSandboxArtifact = (text) => text.includes('403') && !text.includes('/api/');

const kasia = await login('kasia@edmat.example');

const browser = await chromium.launch({
	executablePath: process.env.CHROME_PATH || undefined,
	args: ['--no-sandbox']
});

try {
	const ctx = await browser.newContext();
	await ctx.addInitScript((t) => localStorage.setItem('edmat-auth-token', t), kasia);
	const page = await ctx.newPage();
	const errors = [];
	page.on('console', (m) => {
		if (m.type() === 'error' && !isSandboxArtifact(m.text())) errors.push(m.text());
	});
	page.on('pageerror', (e) => errors.push(String(e)));

	// Every list request the two browse pages make, so typing can be measured rather than trusted.
	// `recommended` is excluded deliberately: it is its own strip, fired once on mount, and counting
	// it would put a request in the tally that no keystroke caused.
	let exerciseRequests = [];
	let materialRequests = [];
	page.on('request', (r) => {
		const url = r.url();
		if (url.includes(`/api/branches/${BRANCH}/exercises/`)) exerciseRequests.push(url);
		if (url.includes('/api/materials/') && !url.includes('recommended')) materialRequests.push(url);
	});

	const box = '.filters input[type="search"]';

	// ============================================================================================
	console.log('\n--- the race, with the app’s own real latencies and no artificial delay ---');
	// The unfiltered list takes ~4.5s; a filtered one ~0.3s. So typing a term while the page is
	// still loading puts a slow OLD answer and a fast NEW one in flight together, in that order —
	// which is exactly the ordering that used to leave a visitor looking at all 388 exercises a
	// moment after their search had correctly narrowed to 21.
	await page.goto(`${WEB}/branches/${BRANCH}`);
	await page.waitForSelector(box, { timeout: 90000 });
	await typeInto(page, box, FAST_TERM, 30);
	const narrowed = await waitForCards(page, FAST_HITS);
	check(
		'a search typed while the page is still loading narrows the list',
		narrowed,
		`${await cards(page)} cards`
	);
	await sleep(7000); // long enough for the unfiltered mount answer to have arrived
	const afterMountAnswer = await cards(page);
	check(
		'and the slower unfiltered answer, arriving after it, does not replace the results',
		afterMountAnswer === FAST_HITS,
		`list became ${afterMountAnswer} cards (unfiltered is ${ALL})`
	);

	// ============================================================================================
	console.log('\n--- one request per word, not one per keystroke ---');
	await page.goto(`${WEB}/branches/${BRANCH}`);
	await page.waitForSelector('.exercise-card', { timeout: 90000 });
	const settled = await waitForCards(page, ALL);
	check('the unfiltered branch lists all its exercises', settled, `${await cards(page)} cards`);

	exerciseRequests = [];
	await typeInto(page, box, FAST_TERM); // 5 real keystrokes, typed at speed
	const duringTyping = exerciseRequests.length;
	await sleep(1200); // debounce (250ms) plus room
	const afterTyping = exerciseRequests.length;
	check(
		'the word actually reached the search box',
		(await page.inputValue(box)) === FAST_TERM,
		JSON.stringify(await page.inputValue(box))
	);
	check(
		`typing a ${FAST_TERM.length}-letter word fires nothing while it is being typed`,
		duringTyping === 0,
		`${duringTyping} request(s) mid-word`
	);
	check(
		'the whole word costs one request, not one per letter',
		afterTyping === 1,
		`${afterTyping} request(s): ${exerciseRequests.join(' , ')}`
	);
	check(
		'and that one request carries the whole word',
		afterTyping === 1 && exerciseRequests[0].includes(`q=${FAST_TERM}`),
		exerciseRequests[0] || '(none)'
	);
	check('the list is filtered to that word’s results', await waitForCards(page, FAST_HITS));

	// ============================================================================================
	console.log('\n--- one character is not a question ---');
	exerciseRequests = [];
	await page.fill(box, '');
	await sleep(1200);
	const afterClear = exerciseRequests.length;
	check(
		'emptying the box asks one question — the unfiltered one',
		afterClear === 1 && !exerciseRequests[0].includes('q='),
		`${afterClear} request(s): ${exerciseRequests.join(' , ')}`
	);
	check(
		'and the full list comes back',
		await waitForCards(page, ALL),
		`${await cards(page)} cards`
	);

	exerciseRequests = [];
	await typeInto(page, box, 'm');
	await sleep(1200);
	check(
		'a single character fires no request at all',
		exerciseRequests.length === 0,
		`${exerciseRequests.length} request(s): ${exerciseRequests.join(' , ')}`
	);
	check(
		'and the list is left unfiltered rather than answering a one-letter query',
		(await cards(page)) === ALL,
		`${await cards(page)} cards`
	);

	// ============================================================================================
	console.log('\n--- a slow answer must not overwrite a newer one (deterministic) ---');
	// Same race as the first section, but reproduced on purpose rather than relying on the app's own
	// timing: one term is held back for 2.5s so the two requests provably overlap.
	await page.route(`**/api/branches/${BRANCH}/exercises/**`, async (route) => {
		if (route.request().url().includes(`q=${SLOW_TERM}`)) await sleep(2500);
		await route.continue();
	});
	exerciseRequests = [];
	await page.fill(box, '');
	await typeInto(page, box, SLOW_TERM, 30);
	await sleep(900); // debounce elapsed, so the delayed request is now in flight
	const slowInFlight = exerciseRequests.some((u) => u.includes(`q=${SLOW_TERM}`));
	await page.fill(box, '');
	await typeInto(page, box, FAST_TERM, 30);
	const newerShown = await waitForCards(page, FAST_HITS);
	await sleep(4000); // long enough for the held-back answer to have arrived
	const afterStale = await cards(page);
	check('the slow query really was in flight', slowInFlight, exerciseRequests.join(' , '));
	check('the newer query’s results are the ones shown', newerShown, `${afterStale} cards`);
	check(
		'the older, slower answer never overwrites them',
		afterStale === FAST_HITS,
		`list became ${afterStale} cards after the stale response landed`
	);
	check(
		'and the box still shows what was typed last',
		(await page.inputValue(box)) === FAST_TERM,
		await page.inputValue(box)
	);
	await page.unroute(`**/api/branches/${BRANCH}/exercises/**`);

	// ============================================================================================
	console.log('\n--- an unfinished composition is not a search ---');
	// Starting from the FAST_TERM results, so "nothing happened" is visible as the list not moving.
	const beforeCompose = await cards(page);
	exerciseRequests = [];
	// "みあら" as it actually arrives: romaji first, then kana, none of it committed yet.
	await compose(page, box, { intermediate: ['m', 'mi', 'みあ', 'みあら'] });
	await sleep(1500); // far longer than the debounce — this is where a person picks a candidate
	check(
		'an open IME composition fires no search, however long the pause',
		exerciseRequests.length === 0,
		`${exerciseRequests.length} request(s): ${exerciseRequests.join(' , ')}`
	);
	check(
		'and the list is untouched by the half-typed text',
		(await cards(page)) === beforeCompose,
		`${beforeCompose} -> ${await cards(page)}`
	);
	// Now accept a candidate: exactly one search, for the committed text.
	await compose(page, box, { intermediate: [], final: OTHER_TERM });
	await sleep(1200);
	check(
		'accepting the candidate fires exactly one search',
		exerciseRequests.length === 1,
		`${exerciseRequests.length} request(s): ${exerciseRequests.join(' , ')}`
	);
	check(
		'for the committed text, not any intermediate one',
		exerciseRequests.length === 1 && exerciseRequests[0].includes(`q=${OTHER_TERM}`),
		exerciseRequests[0] || '(none)'
	);
	check('and the results are the committed word’s', await waitForCards(page, OTHER_HITS));

	// ============================================================================================
	console.log('\n--- typing before the page is interactive ---');
	// This page's filter bar is in the server-rendered HTML, and on this dev server the client does
	// not take over for a second or two after it appears. Somebody typing in that window puts text
	// into real DOM that no handler is attached to yet, so it must survive hydration AND still be
	// searched for. The first attempt at this feature did neither: a one-way `value={draft}` wiped the
	// box the moment the component initialised, and no request was ever made for what had been typed.
	//
	// Deliberately NOT driven through a Playwright locator: its actionability checks wait long enough
	// that hydration has already happened, which hides the very window this is about. Waiting for the
	// element to merely EXIST and then writing to it directly is what a person racing the page does.
	const mbox = '.material-filters input[type="search"]';
	await page.goto(`${WEB}/materials`, { waitUntil: 'domcontentloaded' });
	await page.waitForFunction((sel) => !!document.querySelector(sel), mbox, { timeout: 90000 });
	materialRequests = [];
	await page.evaluate(
		({ sel, text }) => {
			const el = document.querySelector(sel);
			el.focus();
			el.value = text;
			// No handler is listening yet — which is the point. This is what the keystrokes amount to.
			el.dispatchEvent(new InputEvent('input', { bubbles: true }));
		},
		{ sel: mbox, text: 'skrypt' }
	);
	await sleep(4000); // hydration, then the debounce, then the request
	check(
		'text typed before hydration is not wiped by it',
		(await page.inputValue(mbox)) === 'skrypt',
		`box holds ${JSON.stringify(await page.inputValue(mbox))}`
	);
	check(
		'and is actually searched for, rather than sitting there unanswered',
		materialRequests.some((u) => u.includes('q=skrypt')),
		`requests: ${materialRequests.join(' , ') || '(none)'}`
	);

	// ============================================================================================
	console.log('\n--- the materials browse search box ---');
	await page.goto(`${WEB}/materials`);
	await page.waitForSelector(mbox, { timeout: 90000 });
	await sleep(3000); // let the mount-time list and the recommended strip settle

	materialRequests = [];
	await typeInto(page, mbox, 'skrypt'); // 6 keystrokes
	const mDuring = materialRequests.length;
	await sleep(1500);
	const mAfter = materialRequests.length;
	check(
		'the word actually reached the materials box',
		(await page.inputValue(mbox)) === 'skrypt',
		JSON.stringify(await page.inputValue(mbox))
	);
	check(
		'typing in the materials search fires nothing mid-word',
		mDuring === 0,
		`${mDuring} request(s) mid-word`
	);
	check(
		'and costs one request once the typing stops, not six',
		mAfter === 1,
		`${mAfter} request(s): ${materialRequests.join(' , ')}`
	);
	check(
		'carrying the whole word',
		mAfter === 1 && materialRequests[0].includes('q=skrypt'),
		materialRequests[0] || '(none)'
	);

	await page.fill(mbox, '');
	await sleep(1500);
	materialRequests = [];
	await compose(page, mbox, { intermediate: ['s', 'sk', 'すく'] });
	await sleep(1500);
	check(
		'an open composition in the materials search fires no request',
		materialRequests.length === 0,
		`${materialRequests.length} request(s): ${materialRequests.join(' , ')}`
	);
	await compose(page, mbox, { intermediate: [], final: 'zadania' });
	await sleep(1500);
	check(
		'and committing it fires exactly one, for the committed text',
		materialRequests.length === 1 && materialRequests[0].includes('q=zadania'),
		`${materialRequests.length}: ${materialRequests.join(' , ')}`
	);

	// The tag filter reaches the same fetching effect, so it is debounced too — from one character,
	// since a tag is a token rather than free text.
	await page.fill(mbox, '');
	await sleep(1500);
	const tagBox = '.material-filters .advanced-section input[type="text"]';
	if ((await page.locator(tagBox).count()) === 0) {
		await page.click('.material-filters .mode-toggle');
		await page.waitForSelector(tagBox, { timeout: 15000 });
	}
	materialRequests = [];
	await typeInto(page, tagBox, 'norma');
	const tDuring = materialRequests.length;
	await sleep(1500);
	check(
		'the word actually reached the tag box',
		(await page.inputValue(tagBox)) === 'norma',
		JSON.stringify(await page.inputValue(tagBox))
	);
	check('the tag filter fires nothing mid-word', tDuring === 0, `${tDuring} request(s)`);
	check(
		'and costs one request once typing stops',
		materialRequests.length === 1,
		`${materialRequests.length} request(s): ${materialRequests.join(' , ')}`
	);
	await page.fill(tagBox, '');
	await sleep(1500);
	materialRequests = [];
	await compose(page, tagBox, { intermediate: ['n', 'no', 'のる'] });
	await sleep(1500);
	check(
		'an open composition in the tag filter fires no request either',
		materialRequests.length === 0,
		`${materialRequests.length} request(s)`
	);

	// ============================================================================================
	console.log('\n--- Enter, which means “accept this candidate” mid-composition ---');
	await page.goto(`${WEB}/submit`);
	const reqBox = 'input[placeholder="Add a requirement…"]';
	await page.waitForSelector(reqBox, { timeout: 90000 });
	const chipsBefore = await page.locator('.chip-list li').count();

	// Compose, leave it open, and press Enter the way an IME user does to accept a candidate.
	await compose(page, reqBox, { intermediate: ['k', 'ki', 'きほ'] });
	await pressEnter(page, reqBox, { composing: true });
	await sleep(400);
	check(
		'Enter during a composition adds no chip',
		(await page.locator('.chip-list li').count()) === chipsBefore,
		`${chipsBefore} -> ${await page.locator('.chip-list li').count()}`
	);
	check(
		'and leaves the half-typed text in the box',
		(await page.inputValue(reqBox)) === 'きほ',
		JSON.stringify(await page.inputValue(reqBox))
	);

	// Commit the candidate, then press Enter for real. Now it must add the chip.
	await compose(page, reqBox, { intermediate: [], final: '基本' });
	await pressEnter(page, reqBox, { composing: false });
	await sleep(400);
	const chipsAfter = await page.locator('.chip-list li').count();
	check(
		'Enter once the composition has ended adds the chip',
		chipsAfter === chipsBefore + 1,
		`${chipsBefore} -> ${chipsAfter}`
	);
	check(
		'and the chip holds the committed word, not an intermediate one',
		(await page.locator('.chip-list li').last().innerText()).includes('基本'),
		JSON.stringify(await page.locator('.chip-list li').last().innerText())
	);
	check(
		'an ordinary Enter still works — nothing was broken to fix the IME case',
		(await page.inputValue(reqBox)) === '',
		`box holds ${JSON.stringify(await page.inputValue(reqBox))}`
	);

	console.log('\n--- console ---');
	check('no console or page errors anywhere', errors.length === 0, errors.slice(0, 4).join(' | '));

	await ctx.close();
} finally {
	await browser.close();
}

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) {
	console.log('problems:');
	for (const p of problems) console.log(`  - ${p}`);
	process.exit(1);
}
