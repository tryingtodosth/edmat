// Concept paths: "before this, know…" and a deck from a concept (prompts/05-concept-paths.md).
//
// The run builds a real prerequisite chain THROUGH THE UI on the seeded concepts — the picker, the
// relation select, the Add button — and then looks at what grew out of it in three places: the
// path on the concept's own page, the flat "before this, know…" row on the page of an exercise that
// concept is about, and the bounded closure the API answers with. It deliberately closes the chain
// into a CYCLE (`granica` → `mechanika-kwantowa`, which is nonsense as mathematics and is exactly
// the shape two people filing the same pair from opposite ends produce), because a walk that loops
// is the one failure that takes the server down rather than showing something wrong.
//
// Two things are not the real thing, and both are said out loud:
//
// * **`POST /api/decks/` is MOCKED.** Step A owns `/api/decks/` and it does not exist on this
//   branch — the backend answers 404. `prompts/README.md` §9 fixed this: C, D and E verify their
//   "make a deck" buttons against a mocked response and the real call is verified at integration.
//   So the button, the exercise ids it collects and the confirmation line are real; the deck is not.
// * The two scratch links are removed through the real API at the end (they are `manual` rows, so
//   `DELETE /api/concept-links/{id}/` takes them), and the removal is re-queried AUTHENTICATED —
//   an anonymous list read comes from the 60 s cache (e2e/CLAUDE.md trap 12).
//
// Needs: both servers up, `manage.py seed_demo_users`, `manage.py seed_demo_content` and
// `manage.py seed_concepts` (the seeded prerequisite pairs are what the chain is built on top of).
// Run: E2E_BASE=http://localhost:5234 E2E_API=http://127.0.0.1:8134/api node e2e/concept-paths.mjs
import { englishContext } from './english.mjs';

let chromium;
try {
	({ chromium } = await import('playwright'));
} catch {
	({ chromium } = await import('playwright-core'));
}

const BASE = process.env.E2E_BASE ?? 'http://localhost:5234';
// Accepts either form — `http://host:port` or `http://host:port/api` — because `test.md` documents
// one and several existing scripts default to the other.
const API_RAW = process.env.E2E_API ?? 'http://127.0.0.1:8134/api';
const API = API_RAW.replace(/\/api\/?$/, '');
const PASS = 'password123';
const MICHAL = { user: 'michal@edmat.example', pass: PASS }; // verified contributor
const KASIA = { user: 'kasia@edmat.example', pass: PASS }; // staff — the flag switches
const SHOTS = process.env.E2E_SHOTS ?? 'e2e/screenshots';

// The seeded graph this builds on (`manage.py seed_concepts`): `mechanika-kwantowa → pochodna` and
// `calka → granica` are already prerequisites; the two links below are added through the UI.
const DEEP = 'mechanika-kwantowa';
const MID = 'calka';
const FAR = 'granica';

let pass = 0;
let fail = 0;
const failures = [];
const errors = [];
const httpErrors = [];
function check(label, ok, extra = '') {
	if (ok) {
		pass++;
		console.log(`  ok   ${label}`);
	} else {
		fail++;
		failures.push(label);
		console.log(`  FAIL ${label}${extra ? '  <- ' + extra : ''}`);
	}
}

const browser = await chromium.launch(
	process.env.CHROME ? { executablePath: process.env.CHROME } : {}
);

function watch(target, who = 'page') {
	target.on(
		'console',
		(msg) =>
			msg.type() === 'error' &&
			!msg.text().startsWith('Failed to load resource') &&
			errors.push(`${who}: ${msg.text()}`)
	);
	target.on('pageerror', (e) => errors.push(`${who}: ${e.message}`));
	target.on('response', (res) => {
		const status = res.status();
		if (status < 400) return;
		const url = res.url();
		// The deck POST is mocked as a 201, but the FIRST click in the kill-switch section is made
		// with `flashcards` off and never fires at all — nothing to forgive there. What does need
		// forgiving: `featureFlagsStore` fails OPEN until its first fetch lands (its own header says
		// why), so a page opened in that window can ask for concepts once and be refused.
		if ((status === 401 || status === 403) && /\/api\/concepts?/.test(url)) return;
		if ((status === 401 || status === 403) && /\/api\/concept-links/.test(url)) return;
		// A WORKTREE artifact, not a product one: `node_modules` here is a symlink to the main
		// checkout, which is outside Vite's `fs.allow` root, so every KaTeX font 403s on the dev
		// server. The fonts are real in a build; this is the e2e/CLAUDE.md trap 11 posture — do not
		// chase a dev-server-only failure.
		if (status === 403 && /\/@fs\/.*\/node_modules\/katex\//.test(url)) return;
		httpErrors.push(`${who} ${status} ${url}`);
	});
}

// English, on the CONTEXT, before the first navigation — the base locale is Polish and every check
// below names an English string (e2e/CLAUDE.md trap 24).
let ctx = await englishContext(browser, BASE, { viewport: { width: 1360, height: 1000 } });
let page = await ctx.newPage();
watch(page);

const settle = (ms = 800) => page.waitForTimeout(ms);
const shot = (target, name, fullPage = false) =>
	target.screenshot({ path: `${SHOTS}/concept-paths-${name}.png`, fullPage });

// ---- the API, always through a page so the request has a real origin ---------------------------
async function apiCall(token, method, path, body) {
	// Retried once on "Execution context was destroyed": the SPA can navigate underneath an
	// `evaluate` that was issued a moment too early (the first-visit locale hint does exactly
	// this), and that is a race in the harness, not an answer from the API.
	for (let attempt = 0; ; attempt += 1) {
		try {
			return await apiCallOnce(token, method, path, body);
		} catch (e) {
			if (attempt >= 2 || !String(e?.message ?? e).includes('Execution context was destroyed')) {
				throw e;
			}
			await page.waitForTimeout(1500);
		}
	}
}

async function apiCallOnce(token, method, path, body) {
	return page.evaluate(
		async ({ api, token, method, path, body }) => {
			const res = await fetch(`${api}/api${path}`, {
				method,
				headers: {
					...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
					...(token ? { Authorization: `Token ${token}` } : {})
				},
				body: body === undefined ? undefined : JSON.stringify(body)
			});
			// `let parsed;` rather than `= null`: eslint's `no-useless-assignment` is right that the
			// initialiser is dead, and a body-less 204 falls through to `?? null` below either way.
			let parsed;
			try {
				parsed = await res.json();
			} catch {
				parsed = undefined;
			}
			return { status: res.status, body: parsed ?? null };
		},
		{ api: API, token, method, path, body }
	);
}

async function tokenFor({ user, pass: password }) {
	const res = await apiCall(null, 'POST', '/auth/login/', { username: user, password });
	return res.body?.token ?? null;
}

/** The login form, driven for real. */
async function signIn({ user, pass: password }) {
	let landed = false;
	for (let attempt = 0; attempt < 4 && !landed; attempt += 1) {
		await page.goto(`${BASE}/login`, { waitUntil: 'load' });
		await page.locator('form input[autocomplete="username"]').waitFor({ timeout: 45000 });
		// A click before hydration submits the form NATIVELY and nothing happens, which reads
		// exactly like a broken login page (e2e/CLAUDE.md trap 25).
		await settle(2500 + attempt * 4000);
		await page.locator('form input[autocomplete="username"]').fill(user);
		await page.locator('form input[type="password"]').fill(password);
		await page.locator('form button[type="submit"]').click();
		landed = await page
			.waitForURL((u) => !u.pathname.includes('/login'), { timeout: 20000 })
			.then(() => true)
			.catch(() => false);
	}
	check(`${user} signs in through the real form`, landed);
	await settle(1200);
}

console.log('— signing in —');
await page.goto(`${BASE}/`, { waitUntil: 'load' });
// Long enough for the SPA to have booted and done its first-visit navigation, before anything is
// evaluated in its context.
await settle(3000);
const kasiaToken = await tokenFor(KASIA);
await signIn(MICHAL);
const michalToken = await tokenFor(MICHAL);
check('two API tokens were issued', Boolean(michalToken && kasiaToken));
// The corpus is Polish and this context reads English, so a picker can honestly be empty for rows
// that exist. For a SIGNED-IN context only the API route works (trap 16).
await apiCall(michalToken, 'PATCH', '/auth/me/', { content_locales: ['pl', 'en'] });
await page.reload({ waitUntil: 'load' });
await settle(1200);

/** Remove anything a previous (possibly crashed) run left behind.
 *
 *  A script that needs mutable state resets it through the real API before it starts
 *  (e2e/CLAUDE.md trap 1). Without this the two picker checks fail in the most misleading way
 *  available: `add_link` answers 409 `already_linked`, the row's button stays on "Add", and every
 *  check AFTER it passes against last run's links — a green closure over a red button.
 */
async function removeScratchLinks() {
	let removed = 0;
	for (const [from, to] of [
		[DEEP, MID],
		[FAR, DEEP]
	]) {
		const payload = await apiCall(michalToken, 'GET', `/concepts/${from}/links/`);
		for (const link of payload.body?.links ?? []) {
			if (link.target_slug === to && link.relation === 'prerequisite') {
				await apiCall(michalToken, 'DELETE', `/concept-links/${link.id}/`);
				removed += 1;
			}
		}
	}
	return removed;
}

// ---- building the chain through the real UI ----------------------------------------------------

/** What this reader's own band and language call a concept.
 *
 *  Resolved from the API rather than written in, because it is NOT the Polish title: the context
 *  reads English and `content_locales` is `en,pl`, so `calka` is "Integral" here and `granica` is
 *  "Limit", while `mechanika-kwantowa` — which has no English article — stays Polish. Hardcoding
 *  either language would make this script assert against the wrong catalogue (the shape of
 *  e2e/CLAUDE.md trap 24, one layer down: not the interface, the CONTENT). The picker is searched
 *  by SLUG, which `?q=` matches too, so the search term never depends on the resolution either.
 */
async function titleOf(slug) {
	const rows = await apiCall(michalToken, 'GET', `/concepts/?q=${slug}&limit=8&audience=all`);
	const row = (Array.isArray(rows.body) ? rows.body : []).find((r) => r.slug === slug);
	return row?.title || slug;
}

/** Open a concept's "Link something" picker and file one concept link with a relation. */
async function linkConcept(slug, term, title, relationLabel) {
	await page.goto(`${BASE}/concepts/${slug}`, { waitUntil: 'load' });
	await page.locator('section.links').waitFor({ timeout: 30000 });
	await settle(1500);
	await page.getByRole('button', { name: 'Link something', exact: true }).click();
	const modal = page.locator('[role="dialog"]');
	await modal.waitFor({ timeout: 20000 });
	await modal.getByRole('tab', { name: 'Concept', exact: true }).click();
	// Scoped to the modal, by option value — the header's language picker is also a `select`
	// (e2e/CLAUDE.md trap 6).
	await modal.locator('select').selectOption({ label: relationLabel });
	await modal.locator('input[type="text"]').fill(term);
	const row = modal.locator('.results li').filter({ hasText: title }).first();
	await row.waitFor({ timeout: 20000 });
	await row.getByRole('button', { name: 'Add', exact: true }).click();
	await settle(1800);
	// The row's own button, read as text rather than matched by name: a failure then SAYS what it
	// said, instead of reporting a count of zero for a reason the output cannot show.
	const label = (await row.locator('button').first().innerText()).trim();
	await modal.getByRole('button', { name: 'Close' }).click();
	await settle(600);
	return label;
}

console.log('\n— building a prerequisite chain through the picker —');
const leftovers = await removeScratchLinks();
if (leftovers) console.log(`  (removed ${leftovers} link(s) a previous run left behind)`);
const DEEP_TITLE = await titleOf(DEEP);
const MID_TITLE = await titleOf(MID);
const FAR_TITLE = await titleOf(FAR);
console.log(`  (this reader reads them as: ${DEEP_TITLE} / ${MID_TITLE} / ${FAR_TITLE})`);
const midLabel = await linkConcept(DEEP, MID, MID_TITLE, 'Know this first');
check(
	`"${DEEP}" gains "${MID_TITLE}" as a prerequisite, filed in the real picker`,
	midLabel === 'Linked',
	`the row's button says "${midLabel}"`
);
await shot(page, 'after-linking');
// And the cycle: `granica` is already two hops BEHIND `mechanika-kwantowa`, so this closes the loop.
const farLabel = await linkConcept(FAR, DEEP, DEEP_TITLE, 'Know this first');
check(
	`"${FAR}" gains "${DEEP_TITLE}" as a prerequisite, closing a cycle on purpose`,
	farLabel === 'Linked',
	`the row's button says "${farLabel}"`
);

// ---- the closure, as the API answers it --------------------------------------------------------
console.log('\n— the bounded closure —');
const deep = await apiCall(michalToken, 'GET', `/concepts/${DEEP}/prerequisites/`);
const deepRows = Array.isArray(deep.body) ? deep.body : [];
check(
	'the closure of the deep concept is three rungs',
	deep.status === 200 && deepRows.length === 3,
	`${deep.status} ${JSON.stringify(deep.body).slice(0, 160)}`
);
check(
	'its two direct prerequisites are at distance 1',
	deepRows
		.filter((r) => r.distance === 1)
		.map((r) => r.slug)
		.join(',') === `${MID},pochodna`,
	JSON.stringify(deepRows.map((r) => [r.slug, r.distance]))
);
check(
	'and the concept two hops back is at distance 2',
	deepRows.some((r) => r.slug === FAR && r.distance === 2)
);
check(
	'every rung carries a real title, not a slug',
	deepRows.length > 0 && deepRows.every((r) => r.title && r.title !== r.slug),
	JSON.stringify(deepRows.map((r) => r.title))
);
const cycled = await apiCall(michalToken, 'GET', `/concepts/${FAR}/prerequisites/`);
const cycledRows = Array.isArray(cycled.body) ? cycled.body : [];
check(
	'the cycle is CUT: a concept is never its own prerequisite',
	cycled.status === 200 && !cycledRows.some((r) => r.slug === FAR),
	JSON.stringify(cycledRows.map((r) => [r.slug, r.distance]))
);
check(
	'and the walk still answers from inside the cycle',
	cycledRows.some((r) => r.slug === DEEP && r.distance === 1) && cycledRows.length >= 2,
	JSON.stringify(cycledRows.map((r) => [r.slug, r.distance]))
);

// ---- the path on the concept's own page --------------------------------------------------------
console.log('\n— the path on the concept page —');
await page.goto(`${BASE}/concepts/${DEEP}`, { waitUntil: 'load' });
await page.locator('.learn-path').waitFor({ timeout: 30000 });
await settle(1200);
const pathItems = await page.locator('.learn-path ol li').allInnerTexts();
check(
	'the path is drawn with every rung plus the concept itself',
	pathItems.length === 4,
	JSON.stringify(pathItems)
);
check(
	'it is ordered farthest first, ending where the reader is',
	pathItems[0].includes(FAR_TITLE) && pathItems[pathItems.length - 1].includes(DEEP_TITLE),
	JSON.stringify(pathItems)
);
check(
	'the heading says what the order means',
	(await page.locator('.learn-path h3').innerText()).includes('order to read them in')
);
await shot(page, 'concept-path', true);

// ---- the flat row on an exercise page ----------------------------------------------------------
console.log('\n— "before this, know…" on an exercise page —');
const linkedExercises = await apiCall(michalToken, 'GET', `/concepts/${DEEP}/exercises/`);
const exerciseRows = Array.isArray(linkedExercises.body) ? linkedExercises.body : [];
check(
	'the concept lists the exercises linked to it',
	linkedExercises.status === 200 && exerciseRows.length >= 1,
	`${linkedExercises.status} ${JSON.stringify(linkedExercises.body).slice(0, 160)}`
);

// The union closure of an exercise that is about EVERY concept in the chain is honestly EMPTY, and
// that is the semantics rather than a gap: `seed_concepts` links the same two exercises to every
// concept of the branch, so each of those exercises is already "about" each of its own
// prerequisites and there is nothing left to learn first. Worth pinning, because it is the one
// answer somebody reading the feature would call a bug.
const sharedId = exerciseRows[0]?.id;
const saturated = await apiCall(
	michalToken,
	'GET',
	`/concept-links/learn-first/?target_type=exercise&target_id=${sharedId}`
);
check(
	'an exercise about every link in the chain has nothing left to learn first',
	saturated.status === 200 && Array.isArray(saturated.body) && saturated.body.length === 0,
	JSON.stringify(saturated.body)
);

// So the real line needs an exercise about ONE end of the chain. Find two exercises no concept
// points at: one to link, one to leave alone.
const SEEDED = [DEEP, MID, FAR, 'pochodna', 'mol', 'rekurencja'];
const alreadyLinked = new Set();
for (const slug of SEEDED) {
	const rows = await apiCall(michalToken, 'GET', `/concepts/${slug}/exercises/`);
	for (const row of Array.isArray(rows.body) ? rows.body : []) alreadyLinked.add(String(row.id));
}
const plain = await apiCall(michalToken, 'GET', '/exercises/?limit=60');
const bare = (Array.isArray(plain.body) ? plain.body : [])
	.map((e) => String(e.id))
	.filter((id) => !alreadyLinked.has(id));
const exerciseId = bare[0];
const untouchedId = bare[1];
check(
	'two exercises with no concepts at all were found to work with',
	Boolean(exerciseId && untouchedId)
);

// Linked from the EXERCISE's own end, in its own picker — the control a reader actually uses.
await page.goto(`${BASE}/exercises/${exerciseId}`, { waitUntil: 'load' });
await page.locator('.linked-concepts').waitFor({ timeout: 30000 });
await settle(1800);
await page.getByRole('button', { name: 'Link a concept', exact: true }).click();
const exModal = page.locator('[role="dialog"]');
await exModal.waitFor({ timeout: 20000 });
await exModal.locator('input[type="text"]').fill(DEEP);
const exRow = exModal.locator('.results li').filter({ hasText: DEEP_TITLE }).first();
await exRow.waitFor({ timeout: 20000 });
await exRow.getByRole('button', { name: 'Add', exact: true }).click();
const newChip = page.locator('.linked-concepts li').filter({ hasText: DEEP_TITLE });
const chipArrived = await newChip
	.first()
	.waitFor({ timeout: 20000 })
	.then(() => true)
	.catch(() => false);
check(
	`the exercise is now about "${DEEP_TITLE}", linked from its own page`,
	chipArrived && (await newChip.count()) === 1
);

// Reloaded on purpose: `LearnFirst` fetches once per (target, session) and does not listen for a
// link added beside it — named in HISTORY §17BR.D's "Left open" rather than papered over here.
await page.reload({ waitUntil: 'load' });
await page.locator('.learn-first').waitFor({ timeout: 30000 });
await settle(1200);
const chips = await page.locator('.learn-first li a').allInnerTexts();
check('the exercise page grows the row', chips.length === 3, JSON.stringify(chips));
check(
	'it names the whole chain, not the concept the exercise is already about',
	chips.join('|').includes(FAR_TITLE) && !chips.join('|').includes(DEEP_TITLE),
	JSON.stringify(chips)
);
check(
	'a rung more than one hop back is marked as such',
	(await page.locator('.learn-first li.further').count()) === 1
);
// `text-transform: uppercase` means `innerText()` hands back "BEFORE THIS, KNOW…" — what is
// RENDERED, not what is in the catalogue. Compared case-insensitively rather than by matching the
// uppercase form, which would pin a style decision into a copy assertion.
const learnFirstHeading = await page.locator('.learn-first h2').innerText();
check(
	'the heading reads "Before this, know…"',
	learnFirstHeading.toLowerCase().includes('before this, know'),
	learnFirstHeading
);
await shot(page, 'exercise-learn-first', true);

// An exercise with no concepts at all must grow NOTHING — no heading, no empty state.
await page.goto(`${BASE}/exercises/${untouchedId}`, { waitUntil: 'load' });
await page.locator('h1').first().waitFor({ timeout: 30000 });
await settle(2400);
check(
	'an exercise with no prerequisites renders nothing at all',
	(await page.locator('.learn-first').count()) === 0
);

// ---- the deck button (POST /api/decks/ is MOCKED — step A owns it) -----------------------------
console.log('\n— make a deck from this concept (mocked POST /api/decks/) —');
let deckRequest = null;
await page.route('**/api/decks/', async (route) => {
	deckRequest = route.request().postDataJSON();
	await route.fulfill({
		status: 201,
		contentType: 'application/json',
		body: JSON.stringify({
			id: 4242,
			name: deckRequest?.name ?? '',
			card_count: (deckRequest?.exercise_ids ?? []).length,
			due_count: 0,
			is_public: false,
			source_kind: 'concept',
			created_at: new Date().toISOString()
		})
	});
});
// Re-read, because this run has linked one more exercise to the concept since the list above was
// taken — the button must post what is linked NOW.
const deckSource = await apiCall(michalToken, 'GET', `/concepts/${DEEP}/exercises/`);
const deckExercises = Array.isArray(deckSource.body) ? deckSource.body : [];
await page.goto(`${BASE}/concepts/${DEEP}`, { waitUntil: 'load' });
const deckButton = page.getByRole('button', { name: 'Make a deck from this concept', exact: true });
await deckButton.waitFor({ timeout: 30000 });
check('the button is on the concept page, behind `flashcards`', (await deckButton.count()) === 1);
await deckButton.click();
await page.locator('.made').waitFor({ timeout: 20000 });
check(
	'clicking it posts every linked exercise, in order, with the concept as the source',
	Boolean(deckRequest) &&
		deckRequest.source?.kind === 'concept' &&
		deckRequest.exercise_ids.length === deckExercises.length &&
		deckRequest.exercise_ids.every((id, i) => String(id) === String(deckExercises[i].id)),
	JSON.stringify(deckRequest)
);
check(
	'and the page says what was made',
	(await page.locator('.made').innerText()).includes('Deck made'),
	await page.locator('.made').innerText()
);
await shot(page, 'deck-made');
await page.unroute('**/api/decks/');

// A concept with no linked exercises must not offer the button at all.
const emptyConcept = 'mol';
const molExercises = await apiCall(michalToken, 'GET', `/concepts/${emptyConcept}/exercises/`);
if (Array.isArray(molExercises.body) && molExercises.body.length === 0) {
	await page.goto(`${BASE}/concepts/${emptyConcept}`, { waitUntil: 'load' });
	await page.locator('.actions').first().waitFor({ timeout: 30000 });
	await settle(1800);
	check(
		'a concept with no exercises does not offer the button',
		(await page.getByRole('button', { name: 'Make a deck from this concept' }).count()) === 0
	);
} else {
	console.log(
		`  (skipped "no exercises → no button": "${emptyConcept}" has ${molExercises.body?.length} linked exercise(s))`
	);
}

// ---- the kill switches -------------------------------------------------------------------------
console.log('\n— the kill switches, as a non-staff reader —');
await apiCall(kasiaToken, 'PATCH', '/feature-flags/flashcards/', { is_enabled: false });
await page.goto(`${BASE}/concepts/${DEEP}`, { waitUntil: 'load' });
await page.locator('section.links').waitFor({ timeout: 30000 });
await settle(2200);
check(
	'`flashcards` off → the deck button is gone, the concept page is intact',
	(await page.getByRole('button', { name: 'Make a deck from this concept' }).count()) === 0 &&
		(await page.locator('.learn-path').count()) === 1
);
await shot(page, 'flashcards-off');
await apiCall(kasiaToken, 'PATCH', '/feature-flags/flashcards/', { is_enabled: true });

// A staff-bypassed check proves nothing about a FeatureFlag (trap 10), so the concepts switch is
// asserted in a context that was never signed in.
await apiCall(kasiaToken, 'PATCH', '/feature-flags/concepts/', { is_enabled: false });
const strangerCtx = await englishContext(browser, BASE, { viewport: { width: 1280, height: 900 } });
const strangerPage = await strangerCtx.newPage();
watch(strangerPage, 'stranger');
await strangerPage.goto(`${BASE}/exercises/${exerciseId}`, { waitUntil: 'load' });
await strangerPage.locator('h1').first().waitFor({ timeout: 30000 });
await strangerPage.waitForTimeout(2600);
check(
	'`concepts` off → nothing on the exercise page',
	(await strangerPage.locator('.learn-first').count()) === 0
);
check('and the exercise page itself still works', (await strangerPage.locator('h1').count()) >= 1);
await shot(strangerPage, 'concepts-off-exercise', true);
const gated = await apiCall(
	null,
	'GET',
	`/concept-links/learn-first/?target_type=exercise&target_id=${exerciseId}`
);
check(
	'the endpoint answers [] rather than 403 (house rule 3)',
	gated.status === 200 && Array.isArray(gated.body) && gated.body.length === 0,
	`${gated.status} ${JSON.stringify(gated.body).slice(0, 80)}`
);
await apiCall(kasiaToken, 'PATCH', '/feature-flags/concepts/', { is_enabled: true });

// ---- putting the world back --------------------------------------------------------------------
console.log('\n— cleaning up —');
const links = await apiCall(michalToken, 'GET', `/concepts/${DEEP}/links/`);
const farLinks = await apiCall(michalToken, 'GET', `/concepts/${FAR}/links/`);
const scratch = [
	...(links.body?.links ?? []).filter(
		(l) => l.target_slug === MID && l.relation === 'prerequisite'
	),
	...(links.body?.links ?? []).filter(
		(l) => l.target_type === 'exercise' && String(l.target_id) === String(exerciseId)
	),
	...(farLinks.body?.links ?? []).filter(
		(l) => l.target_slug === DEEP && l.relation === 'prerequisite'
	)
];
for (const link of scratch) await apiCall(michalToken, 'DELETE', `/concept-links/${link.id}/`);
const after = await apiCall(michalToken, 'GET', `/concepts/${DEEP}/prerequisites/`);
check(
	'the two scratch links are gone and the graph is as it was seeded',
	Array.isArray(after.body) && after.body.length === 1 && after.body[0].slug === 'pochodna',
	JSON.stringify(after.body)
);
await apiCall(michalToken, 'PATCH', '/auth/me/', { content_locales: [] });

console.log(
	`\n${pass} passed, ${fail} failed, ${errors.length} console/page errors, ${httpErrors.length} unexpected HTTP failures`
);
if (failures.length) console.log('failed: ' + failures.join(' | '));
if (errors.length) console.log(errors.slice(0, 8).join('\n'));
if (httpErrors.length) console.log(httpErrors.slice(0, 8).join('\n'));
await browser.close();
process.exit(fail || errors.length || httpErrors.length ? 1 : 0);
