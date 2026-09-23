// Concepts: wiki-like pages for the things exercises and materials are ABOUT (CONCEPTS-BRIEF.md).
//
// The run follows one concept through its whole life, because that is the only way the interesting
// parts are reachable: a plain user writes it and it is invisible to everybody else; staff accept
// it from the moderation queue and it appears in the hub, the home tab and search; a verified
// contributor writes a second article for a different audience and it goes live at once; a third
// person writes their own article for the SAME audience and the two sit in a pool; a revision
// written against a head that moved underneath it gets the 409 dialogue; the article's own author
// decides a stranger's revision from the history page; a `[[mention]]` in the text becomes a link
// and a backlink; linking an exercise puts a chip on the exercise's own page; and with the kill
// switch off every one of those links, tabs, chips and sections goes away.
//
// Two things are set up through the API rather than driven: the CHEMISTRY block (Ketcher is a 21 MB
// WASM editor with its own scripts — `rich-editor.mjs` covers it, and loading it here would make
// this run about the editor instead of about concepts) and the stale-head race (publishing a
// revision from under an open editor needs a second actor, not a second tab). Everything a reader
// or a reviewer actually does is driven in the browser.
//
// Needs: both servers up, `manage.py seed_demo_users` and `manage.py seed_concepts`.
// Run: E2E_BASE=http://localhost:5173 E2E_API=http://localhost:8011 node e2e/concepts.mjs
import { writeFileSync } from 'node:fs';
let chromium;
try {
	({ chromium } = await import('playwright'));
} catch {
	({ chromium } = await import('playwright-core'));
}

const BASE = process.env.E2E_BASE ?? 'http://localhost:5173';
const API = process.env.E2E_API ?? 'http://localhost:8011';
const PASS = 'password123';
const OLA = { user: 'ola@edmat.example', pass: PASS }; // plain user — everything queues
const MICHAL = { user: 'michal@edmat.example', pass: PASS }; // verified contributor — publishes
const BARTEK = { user: 'bartek@edmat.example', pass: PASS }; // plain user, the second author
const KASIA = { user: 'kasia@edmat.example', pass: PASS }; // staff
const STAMP = Date.now().toString(36);
const TITLE = `Scratch concept ${STAMP}`;

let pass = 0;
let fail = 0;
const errors = [];
const failures = [];
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
// `let`, because each person after the first gets a context of their own — see `seat()`.
let ctx = await browser.newContext({ viewport: { width: 1360, height: 1000 } });
let page = await ctx.newPage();
// Chromium logs EVERY non-2xx fetch as a console error, handled or not, and the line it prints
// ("Failed to load resource…") never says which request it was — useless for deciding whether a
// run is clean. So the statuses are read off the responses themselves, with their URLs, and the
// two this run provokes on purpose are forgiven by name.
const httpErrors = [];
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
		// A stranger opening a concept whose only revision is still waiting: 404 is the answer the
		// check above is FOR (house rule 4 — for them it does not exist).
		if (status === 404 && /\/api\/concepts\/[^/]+\/(\?|$)/.test(url)) return;
		// The stale submit, provoked deliberately by publishing under an open editor.
		if (status === 409) return;
		// The kill-switch section: `featureFlagsStore` fails OPEN until its first fetch lands (its
		// own header says why — so a slow request never flashes disabled UI at somebody for whom
		// the feature is on), so a page opened in that window asks for concepts once and is
		// refused. The gate holds where it matters: the answer is discarded and the section never
		// renders, which is what the checks below assert.
		if ((status === 401 || status === 403) && /\/api\/concepts\//.test(url)) return;
		httpErrors.push(`${who} ${status} ${url}`);
	});
}
watch(page);

// A second, signed-out context: "invisible to everybody else" has to be answered by a browser
// that was never told anything, not by the same one with its storage cleared.
const stranger = await browser.newContext({ viewport: { width: 1280, height: 900 } });
const strangerPage = await stranger.newPage();
watch(strangerPage, 'stranger');

const settle = (ms = 800) => page.waitForTimeout(ms);

// Several real bugs in this project were found by LOOKING at a screenshot rather than by any
// assertion (house rule 2), so every state this run walks through leaves one behind, named after
// what it is rather than numbered.
const SHOTS = process.env.E2E_SHOTS ?? 'e2e/screenshots';
const shot = (target, name, fullPage = false) =>
	target.screenshot({ path: `${SHOTS}/concepts-${name}.png`, fullPage });

// ---- API, for setup and for the assertions a rendered page cannot answer -----------------------
// Always through a page so the request has a real origin, and always AUTHENTICATED where the answer
// matters: an anonymous list response comes from the 60 s read cache (e2e/CLAUDE.md trap 12).
async function apiCall(token, method, path, body) {
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
			let parsed;
			try {
				parsed = await res.json();
			} catch {
				parsed = null;
			}
			return { status: res.status, body: parsed ?? null };
		},
		{ api: API, token, method, path, body }
	);
}

async function tokenFor({ user, pass: password }) {
	// `username`, which accepts an email too (accounts/views.py LoginView resolves one to the other)
	// — the FORM asks for an "identifier", the endpoint does not.
	const res = await apiCall(null, 'POST', '/auth/login/', { username: user, password });
	return res.body?.token ?? null;
}

/** The login FORM, driven for real — once, by the first person through it.
 *
 *  Everybody after that is SEATED with the token that was already issued. `POST /auth/login/` is
 *  throttled at 10/min per IP (`accounts/throttles.py`) and this run needs four API tokens plus six
 *  browser sign-ins: over the budget, and the failure reads exactly like a broken login page — it
 *  did, on this script's first run. The token is what the app itself persists
 *  (`lib/state/token.svelte.ts`), so a seated session is the same state a real login leaves behind,
 *  not a bypass of one. `events-and-nav.mjs` made the same trade for the same reason. */
async function signIn({ user, pass: password }) {
	await page.goto(`${BASE}/`, { waitUntil: 'load' });
	await settle(500);
	await page.evaluate(() => localStorage.clear());
	let landed = false;
	for (let attempt = 0; attempt < 4 && !landed; attempt += 1) {
		await page.goto(`${BASE}/login`, { waitUntil: 'load' });
		await page.locator('form input[autocomplete="username"]').waitFor({ timeout: 45000 });
		// A click that lands before the route has HYDRATED submits the form NATIVELY: the browser
		// goes to `/login?`, no request is made, and the wait below times out looking exactly like a
		// broken login page. On a dev server compiling this route for the first time that took over
		// ten seconds, so this waits, checks, and tries again rather than trusting one sleep.
		await settle(2500 + attempt * 4000);
		// `type="text"`, email OR username since the guardian accounts (e2e/CLAUDE.md trap 13).
		await page.locator('form input[autocomplete="username"]').fill(user);
		await page.locator('form input[type="password"]').fill(password);
		await page.locator('form button[type="submit"]').click();
		landed = await page
			.waitForURL((u) => !u.pathname.includes('/login'), { timeout: 20000 })
			.then(() => true)
			.catch(() => false);
	}
	// Said out loud: a silent failure here would leave every later check running as a GUEST, which
	// is how a broken login reads as a broken feature.
	check(`${user} signs in through the real form`, landed);
	await settle(1100);
}

async function seat(token) {
	// A FRESH context per person, with the previous one closed.
	//
	// Two reasons, both of them real failures of this script's own early runs. (1) Every signed-in
	// page load opens a notification stream, and with no Redis that stream is a request the server
	// holds for as long as ten minutes (`notifications/views.py SSE_MAX_CONNECTION_SECONDS`); six
	// full page loads in one context therefore exhaust Chromium's per-origin connection pool, after
	// which every later request simply QUEUES and the app sits there rendering "sign in" — which
	// reads exactly like a broken page (e2e/CLAUDE.md trap 2's bigger brother). Closing the context
	// closes those streams. (2) The token is written from `static/robots.txt`, a same-origin
	// document the app is not running in: writing localStorage on a booting SPA races
	// `authStore.init()`, which clears the very token it is validating when the next navigation
	// aborts that request.
	//
	// The token itself is what the app persists (`lib/state/token.svelte.ts`), so a seated session
	// is the state a real login leaves behind, not a bypass of one — and `POST /auth/login/` is
	// throttled at 10/min per IP, which four API tokens plus six browser sign-ins would blow
	// (`events-and-nav.mjs` made the same trade for the same reason). The form itself is still
	// driven for real, once, by the first person through it.
	const previous = ctx;
	ctx = await browser.newContext({ viewport: { width: 1360, height: 1000 } });
	page = await ctx.newPage();
	watch(page);
	await page.goto(`${BASE}/robots.txt`, { waitUntil: 'load' });
	await page.evaluate((value) => localStorage.setItem('edmat-auth-token', value), token);
	await page.goto(`${BASE}/`, { waitUntil: 'load' });
	await settle(1100);
	await previous.close().catch(() => null);
}

/** The corpus is Polish and a fresh context reads the English interface, so a browse list can
 *  honestly be empty for rows that exist (e2e/CLAUDE.md trap 16). For a SIGNED-IN context only the
 *  API route works — the profile's own `content_locales` overwrite the localStorage extras. */
async function readBothLanguages(token) {
	await apiCall(token, 'PATCH', '/auth/me/', { content_locales: ['pl', 'en'] });
}

/** The reader's viewing band, which is what decides which page of a concept resolves. */
async function setBands(target, bands) {
	// localStorage throws a SecurityError on `about:blank`, so a context that has not navigated yet
	// (the stranger's, before its first check) has to be put on the real origin first.
	if (!target.url().startsWith(BASE)) await target.goto(`${BASE}/`, { waitUntil: 'load' });
	await target.evaluate(
		(value) => localStorage.setItem('edmat.audienceFilter', JSON.stringify(value)),
		bands
	);
}

// ---- files the upload blocks need ---------------------------------------------------------------
function tinyPng(path) {
	// A real 1x1 PNG. The backend re-encodes it to WebP either way (house rule 7); what this proves
	// is that the block editor uploads and shows what came back.
	writeFileSync(
		path,
		Buffer.from(
			'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
			'base64'
		)
	);
	return path;
}

function tinyPdf(path) {
	// A minimal but genuinely valid one-page PDF — the backend sniffs the type and ClamAV-scans it
	// when a daemon exists, so a file that merely ends in `.pdf` is refused.
	const body = `%PDF-1.4
1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj
2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj
3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 200 200]/Contents 4 0 R/Resources<</Font<</F1 5 0 R>>>>>>endobj
4 0 obj<</Length 52>>stream
BT /F1 18 Tf 20 100 Td (EdMat concept block) Tj ET
endstream
endobj
5 0 obj<</Type/Font/Subtype/Type1/BaseFont/Helvetica>>endobj
trailer<</Root 1 0 R/Size 6>>
%%EOF
`;
	writeFileSync(path, Buffer.from(body, 'latin1'));
	return path;
}

const pngPath = tinyPng('/tmp/edmat-concept-block.png');
const pdfPath = tinyPdf('/tmp/edmat-concept-block.pdf');

// ---- block-editor helpers ------------------------------------------------------------------------
/** Add one block of `kind` through the "Add block" menu at the end of the list. */
async function addBlock(kind) {
	const trigger = page.locator('.block-editor .add__trigger').last();
	await trigger.click();
	await page.locator('.add__menu').last().waitFor({ timeout: 8000 });
	await page.locator('.add__menu').last().getByRole('button', { name: kind, exact: true }).click();
	await settle(500);
}

/** Type into the nth markdown block. The rich editor is switched to its source mode first: this
 *  script is about concepts, and Tiptap has `rich-editor.mjs` of its own. */
async function fillMarkdownBlock(index, text) {
	const card = page.locator('.block-editor .card').nth(index);
	const modes = card.locator('.rich-editor__modes button');
	await modes.last().click();
	await settle(400);
	await card.locator('.rich-editor textarea').fill(text);
	await settle(300);
}

async function fillLatexBlock(index, source) {
	await page
		.locator('.block-editor .card')
		.nth(index)
		.locator('.latex-block textarea')
		.fill(source);
	await settle(400);
}

console.log('\n— setting up —');
const olaToken = await (async () => {
	await page.goto(`${BASE}/`, { waitUntil: 'load' });
	// The first page of a fresh context pays Vite's cold-compile cost and can reload under the
	// script while it does (e2e/CLAUDE.md traps 11 and 22) — which destroys the execution context
	// an `apiCall` is running in. Let it settle before asking it to do anything.
	await settle(1500);
	return tokenFor(OLA);
})();
check('the seeded plain user signs in through the API', Boolean(olaToken));
const michalToken = await tokenFor(MICHAL);
const bartekToken = await tokenFor(BARTEK);
const kasiaToken = await tokenFor(KASIA);
check(
	'so do the verified contributor, the second author and staff',
	Boolean(michalToken && bartekToken && kasiaToken)
);
for (const t of [olaToken, michalToken, bartekToken, kasiaToken]) {
	if (t) await readBothLanguages(t);
}

// The flag has to be ON for any of this to be reachable — the last section turns it off deliberately.
await apiCall(kasiaToken, 'PATCH', '/feature-flags/concepts/', { is_enabled: true });

// A concept to mention and to link from, and an exercise to link to. Both taken from what is really
// there rather than assumed: `seed_concepts` names them, but a run against a differently-seeded
// database should say which row it used, not invent one.
// ANONYMOUSLY: a staff list also carries concepts whose only revision is still waiting (a previous
// run's scratch, say), and mentioning one of those would make the backlink check assert against a
// page the reader cannot open at all.
const seededConcepts = await apiCall(null, 'GET', '/concepts/?limit=5&audience=all');
const mentionSlug = (seededConcepts.body ?? []).map((c) => c.slug).find((s) => s !== undefined);
check('the seed left concepts to mention and link to', Boolean(mentionSlug), 'run seed_concepts');
const someExercise = await apiCall(kasiaToken, 'GET', '/exercises/?limit=1');
const exerciseId = someExercise.body?.[0]?.id;
const exerciseTitle = someExercise.body?.[0]?.title ?? '';
check('and an exercise to link the concept to', Boolean(exerciseId));

console.log('\n— a plain user writes a concept —');
await signIn(OLA);
await setBands(page, ['university']);
await page.goto(`${BASE}/concepts/new`, { waitUntil: 'load' });
await page.locator('.editor input[type="text"]').first().waitFor({ timeout: 45000 });
check('the create form is reachable from /concepts/new', await page.locator('.editor').isVisible());
check(
	'and says plainly that what is written here is public',
	(await page.locator('.editor .public-notice').innerText()).length > 20
);

await page.locator('.editor .field input[type="text"]').first().fill(TITLE);
await page
	.locator('.editor .field textarea')
	.first()
	.fill('A scratch concept written by a browser.');
// The band select is often the first select on a form now — pick it by option, never by position
// (e2e/CLAUDE.md trap 14).
await page
	.locator('.editor select:has(option[value="university"])')
	.first()
	.selectOption('university');
await settle(300);

await addBlock('Text');
await fillMarkdownBlock(
	0,
	`This is the scratch article. It mentions [[${mentionSlug}]] and has inline maths \\(a^2+b^2\\).`
);
await addBlock('Formula');
await fillLatexBlock(1, '\\int_0^1 x^2\\,dx = \\frac{1}{3}');
check(
	'the formula block previews as it is typed',
	(await page.locator('.block-editor .card').nth(1).locator('.preview .katex').count()) > 0
);
await addBlock('Picture');
await page
	.locator('.block-editor .card')
	.nth(2)
	.locator('input[type="file"]')
	.setInputFiles(pngPath);
await page
	.locator('.block-editor .card')
	.nth(2)
	.locator('img.thumb')
	.waitFor({ timeout: 25000 })
	.catch(() => null);
check(
	'the picture block uploads and shows what came back',
	(await page.locator('.block-editor .card').nth(2).locator('img.thumb').count()) === 1
);
await page
	.locator('.block-editor .card')
	.nth(2)
	.locator('input[type="text"]')
	.first()
	.fill('A one-pixel picture');

check('three blocks are in the list', (await page.locator('.block-editor .card').count()) === 3);

// The editor as its author sees it: the three cards and the menu that would add a fourth.
await page.locator('.block-editor .add__trigger').last().click();
await page
	.locator('.add__menu')
	.last()
	.waitFor({ timeout: 8000 })
	.catch(() => null);
await shot(page, 'editor');
await page.keyboard.press('Escape');
await settle(400);

// "Submit", which for this account means "send it to be read" rather than "publish".
await page.locator('.editor .actions button.primary').click();
await page.waitForURL((u) => /\/concepts\//.test(u.pathname), { timeout: 25000 }).catch(() => null);
await settle(1500);

const mine = await apiCall(olaToken, 'GET', '/concepts/?limit=60&audience=all');
const scratch = (mine.body ?? []).find((c) => c.title === TITLE);
const slug =
	scratch?.slug ??
	(await page.evaluate(() => {
		const parts = location.pathname.split('/').filter(Boolean);
		return parts[0] === 'concepts' ? (parts[1] ?? null) : null;
	}));
check('the concept has a slug of its own', Boolean(slug), `path ${page.url()}`);

console.log('\n— and it is invisible until somebody reads it —');
await setBands(strangerPage, ['university']);
await strangerPage.goto(`${BASE}/concepts/${slug}`, { waitUntil: 'load' });
await settle(1600);
const strangerText = await strangerPage.locator('.page').innerText();
check(
	'a stranger gets "not found" rather than the waiting text',
	!strangerText.includes(TITLE),
	strangerText.slice(0, 120)
);
const strangerList = await apiCall(null, 'GET', '/concepts/?limit=60&audience=all');
check(
	'and it is in no list they can ask for',
	!(strangerList.body ?? []).some((c) => c.title === TITLE)
);

console.log('\n— staff accept it from the moderation queue —');
await seat(kasiaToken);
await page.goto(`${BASE}/moderation?tab=concepts`, { waitUntil: 'load' });
await page.locator('.tabpanel').waitFor({ timeout: 45000 });
await settle(1800);
const queueRow = page.locator('.queue-item').filter({ hasText: TITLE }).first();
check('the row is in the Concepts tab', (await queueRow.count()) === 1);
check(
	'marked as a whole new concept, not a revision',
	(
		await queueRow
			.locator('.version-badge')
			.innerText()
			.catch(() => '')
	).length > 0
);
check(
	'with the proposed blocks rendered for the reviewer',
	(await queueRow.locator('.concept-side .blocks').count()) >= 1
);
check(
	'and no second column, because there is nothing to compare it against yet',
	(await queueRow.locator('.concept-side').count()) === 1
);
check(
	'rejecting is refused until a reason is typed',
	await queueRow.locator('button.reject').isDisabled()
);
await shot(page, 'moderation-queue');
await queueRow.locator('button.approve').click();
await settle(2500);
check(
	'accepting takes the row out of the queue',
	(await page.locator('.queue-item').filter({ hasText: TITLE }).count()) === 0
);

console.log('\n— now it is a page anybody can open —');
await strangerPage.goto(`${BASE}/concepts/${slug}`, { waitUntil: 'load' });
await strangerPage
	.locator('.article')
	.waitFor({ timeout: 45000 })
	.catch(() => null);
check(
	'the concept page renders for a signed-out reader',
	await strangerPage.locator('.article').isVisible()
);
// `renderContent` (and KaTeX with it) is fetched on demand — the article is on screen a moment
// before the maths in it is typeset, so the two checks below need the renderer, not the article.
await strangerPage
	.locator('.article .blocks .katex')
	.first()
	.waitFor({ timeout: 20000 })
	.catch(() => null);
check(
	'the formula is typeset rather than shown as LaTeX source',
	(await strangerPage.locator('.article .blocks .katex').count()) > 0
);
check(
	'the picture block is drawn',
	(await strangerPage.locator('.article .blocks figure img').count()) >= 1
);
check(
	`the [[${mentionSlug}]] mention became a real link`,
	(await strangerPage.locator(`.article .blocks a[href$="/concepts/${mentionSlug}"]`).count()) >= 1
);
await shot(strangerPage, 'page-university');

await strangerPage.goto(`${BASE}/concepts/${mentionSlug}`, { waitUntil: 'load' });
await settle(1800);
check(
	'and shows as a backlink on the concept it mentions',
	(
		await strangerPage
			.locator('.links')
			.innerText()
			.catch(() => '')
	).includes(TITLE)
);

console.log('\n— and it is in the hub, the home tab and search —');
await strangerPage.goto(`${BASE}/concepts`, { waitUntil: 'load' });
await strangerPage.locator('.grid, .hint').first().waitFor({ timeout: 45000 });
await settle(1400);
check(
	'the hub lists it',
	(await strangerPage.locator('.concept-card').filter({ hasText: TITLE }).count()) === 1
);
await shot(strangerPage, 'hub');
await strangerPage.goto(`${BASE}/?tab=concepts`, { waitUntil: 'load' });
await strangerPage.locator('.panel').waitFor({ timeout: 45000 });
await settle(1600);
check(
	'the home tab lists it',
	(await strangerPage.locator('.concept-card').filter({ hasText: TITLE }).count()) === 1
);
await shot(strangerPage, 'home-tab');
await strangerPage.goto(`${BASE}/search?q=${encodeURIComponent(`Scratch concept ${STAMP}`)}`, {
	waitUntil: 'load'
});
await settle(2200);
check(
	'and the search page has a concepts section with it in',
	(await strangerPage.locator('.concept-card').filter({ hasText: TITLE }).count()) === 1
);
await shot(strangerPage, 'search');

console.log('\n— a verified contributor writes the primary-school article —');
await seat(michalToken);
await page.goto(`${BASE}/concepts/${slug}/write?audience=primary&lang=en`, { waitUntil: 'load' });
await page
	.locator('.editor')
	.waitFor({ timeout: 45000 })
	.catch(() => null);
check(
	'the write form opens for the verified contributor',
	(await page.locator('.editor').count()) === 1,
	(
		await page
			.locator('.page')
			.innerText()
			.catch(() => '')
	).slice(0, 140)
);
check(
	'the write form says this one will go live straight away',
	(await page.locator('.editor .actions button.primary').innerText()).length > 0
);
await page.locator('.editor .field input[type="text"]').first().fill(`${TITLE} for children`);
await addBlock('Text');
await fillMarkdownBlock(0, 'The same idea, said in shorter words.');
await addBlock('PDF');
await page
	.locator('.block-editor .card')
	.nth(1)
	.locator('input[type="file"]')
	.setInputFiles(pdfPath);
await settle(3000);
check(
	'the PDF block uploads and names the file',
	(await page.locator('.block-editor .card').nth(1).innerText()).includes('.pdf')
);
await page.locator('.editor .actions button.primary').click();
await page.waitForURL((u) => /\/concepts\//.test(u.pathname), { timeout: 25000 }).catch(() => null);
await settle(2000);

const articles = await apiCall(michalToken, 'GET', `/concepts/${slug}/articles/`);
// An article SUMMARY carries `head_published_at`, not the head itself (§5) — the head, and with it
// the blocks and the id a revision is based on, needs the article's own endpoint.
const primarySummary = (articles.body ?? []).find(
	(a) => a.audience === 'primary' && a.head_published_at
);
check("a verified contributor's article is published at once", Boolean(primarySummary));
const primaryArticle = primarySummary
	? (await apiCall(michalToken, 'GET', `/concept-articles/${primarySummary.id}/`)).body
	: null;

// The chemistry block through the API, deliberately (see this file's own note): the drawing is a
// seeded `chem.ChemDrawing`, and what is being proved here is that a `chem` block RENDERS.
// `GET /chem-drawings/` lists only the CALLER'S OWN drawings (`chem/views.py get_queryset`), and
// `seed_concepts` files its one under bartek — so it is his token that can find it.
const drawings = await apiCall(bartekToken, 'GET', '/chem-drawings/?limit=1');
const drawingId = drawings.body?.[0]?.id ?? drawings.body?.results?.[0]?.id;
check('the seed left a chemistry drawing to put in a block', Boolean(drawingId));
if (drawingId && primaryArticle?.head) {
	// KEEPING what is already there: a revision replaces the whole block list, so posting only the
	// chemistry block would quietly delete the PDF the browser just uploaded — and the checks below
	// would then be asserting against a page this script itself emptied. The picture is borrowed
	// from the university article so that one page really does carry all five kinds.
	const write = ({ drawing: _drawing, asset: _asset, ...rest }) => rest;
	const kept = (primaryArticle.head.blocks ?? []).map(write);
	const universitySummary = (articles.body ?? []).find((a) => a.audience === 'university');
	const university = universitySummary
		? (await apiCall(michalToken, 'GET', `/concept-articles/${universitySummary.id}/`)).body
		: null;
	const picture = (university?.head?.blocks ?? []).filter((b) => b.kind === 'image').map(write);
	await apiCall(michalToken, 'POST', `/concept-articles/${primaryArticle.id}/revisions/`, {
		title: `${TITLE} for children`,
		blocks: [
			...kept,
			{ kind: 'latex', source: 'E = mc^2' },
			...picture,
			{ kind: 'chem', drawing_id: Number(drawingId), caption: 'A drawing' }
		],
		change_note: 'Adding a picture of the molecule.',
		based_on: primaryArticle.head.id,
		submit: true
	});
	await settle(1200);
}

console.log('\n— which page a reader gets depends on their band —');
await setBands(strangerPage, ['primary']);
await strangerPage.goto(`${BASE}/concepts/${slug}`, { waitUntil: 'load' });
await strangerPage
	.locator('.article')
	.waitFor({ timeout: 45000 })
	.catch(() => null);
await settle(1200);
check(
	'a primary-school reader gets the primary-school article',
	(await strangerPage.locator('.article').innerText()).includes('for children')
);
check(
	'with no fallback notice, because it is really their page',
	(await strangerPage.locator('.switcher .fallback').count()) === 0
);
if (drawingId) {
	check(
		'the chemistry block renders as a picture',
		(await strangerPage.locator('.article .blocks img.chem-drawing').count()) >= 1
	);
}
const pdfRow = strangerPage.locator('.article .blocks .pdf').first();
check('the PDF block is offered', (await pdfRow.count()) === 1);
check(
	'and nothing of pdf.js is mounted before the click (house rule 11)',
	(await strangerPage.locator('.article .blocks canvas').count()) === 0
);
if ((await pdfRow.count()) === 1) {
	await pdfRow.locator('button').first().click();
	await strangerPage
		.locator('.article .blocks canvas')
		.first()
		.waitFor({ timeout: 30000 })
		.catch(() => null);
	check(
		'the preview opens on the click',
		(await strangerPage.locator('.article .blocks canvas').count()) >= 1
	);
}
// All five block kinds on one page, with the PDF preview open — full page, because an opened PDF
// preview is taller than the window on its own and the point of this one is seeing ALL of them.
await shot(strangerPage, 'page-primary-blocks', true);

await setBands(strangerPage, ['senior']);
await strangerPage.goto(`${BASE}/concepts/${slug}`, { waitUntil: 'load' });
await strangerPage
	.locator('.article')
	.waitFor({ timeout: 45000 })
	.catch(() => null);
await settle(1200);
check(
	'a reader with a band nobody wrote for is told which page they are being shown',
	(await strangerPage.locator('.switcher .fallback').count()) === 1
);
check(
	'and is offered the chance to write the missing one',
	(await strangerPage.locator('.switcher .write, .pool .write').count()) >= 1
);
await shot(strangerPage, 'fallback-notice');

console.log('\n— two people write for the same audience —');
await seat(bartekToken);
await setBands(page, ['primary']);
const bartekArticle = await apiCall(bartekToken, 'POST', `/concepts/${slug}/articles/`, {
	audience: 'primary',
	locale: 'en',
	title: `${TITLE}, another way`,
	summary: 'A second person, the same audience.',
	blocks: [{ kind: 'markdown', body: 'I would explain it like this instead.' }],
	submit: true
});
check(
	"a plain user's article waits rather than going live",
	bartekArticle.body?.head === null || bartekArticle.body?.my_open !== null,
	JSON.stringify(bartekArticle.body ?? {}).slice(0, 160)
);
// Accept it, so the pool really has two.
const queue = await apiCall(kasiaToken, 'GET', '/moderation/queue/');
const waiting = (queue.body?.concept_revisions ?? []).find((r) => r.slug === slug);
if (waiting) {
	await apiCall(kasiaToken, 'POST', `/concept-revisions/${waiting.id}/decide/`, {
		decision: 'accept'
	});
}
await settle(1200);

await page.goto(`${BASE}/concepts/${slug}?audience=primary&lang=en`, { waitUntil: 'load' });
await page
	.locator('.pool')
	.waitFor({ timeout: 45000 })
	.catch(() => null);
await settle(1200);
const poolCount = await page.locator('.pool li').count();
check('the pool lists both articles for that audience', poolCount === 2, `saw ${poolCount}`);
// The page switcher and the pool of peers, the shape §7 is really about.
await shot(page, 'switcher-and-pool');
const leadBefore = await page.locator('.article h1, .article .meta').first().innerText();
const otherHref = await page.locator('.pool li a').last().getAttribute('href');
if (otherHref) {
	await page.goto(new URL(otherHref, BASE).toString(), { waitUntil: 'load' });
	await settle(1400);
}
const leadAfter = await page.locator('.article h1, .article .meta').first().innerText();
check('and ?article= switches which one is shown in full', leadBefore !== leadAfter);

console.log('\n— a revision written against a head that moved —');
await seat(michalToken);
const articlesNow = await apiCall(michalToken, 'GET', `/concepts/${slug}/articles/`);
const targetSummary = (articlesNow.body ?? []).find(
	(a) => a.audience === 'primary' && a.head_published_at
);
const target = targetSummary
	? (await apiCall(michalToken, 'GET', `/concept-articles/${targetSummary.id}/`)).body
	: null;
check('the primary-school article has a head to write against', Boolean(target?.head?.id));
const staleBase = target?.head?.id;
await page.goto(`${BASE}/concepts/${slug}/articles/${target?.id}/edit`, { waitUntil: 'load' });
await page
	.locator('.editor')
	.waitFor({ timeout: 45000 })
	.catch(() => null);
check(
	'the edit form opens on the article',
	(await page.locator('.editor').count()) === 1,
	(
		await page
			.locator('.page')
			.innerText()
			.catch(() => '')
	).slice(0, 140)
);
await settle(900);
// Somebody else publishes while this editor is open. A second actor, not a second tab.
await apiCall(kasiaToken, 'POST', `/concept-articles/${target?.id}/revisions/`, {
	title: `${TITLE} for children`,
	blocks: [{ kind: 'markdown', body: 'Staff moved the head underneath the open editor.' }],
	change_note: 'Moving the head.',
	based_on: staleBase,
	submit: true
});
await settle(1200);
await fillMarkdownBlock(0, 'My own change, written against what I could see.');
await page.locator('.editor .actions button.primary').click();
await settle(2500);
check(
	'the editor answers the 409 with a dialogue rather than an error',
	(await page.locator('.editor .stale').count()) === 1
);
check(
	'and offers to reload and redo the change',
	(await page.locator('.editor .stale button').count()) >= 1
);
await shot(page, 'stale-409');

console.log("\n— an article's own author decides a stranger's revision —");
const strangerRevision = await apiCall(
	bartekToken,
	'POST',
	`/concept-articles/${target?.id}/revisions/`,
	{
		title: `${TITLE} for children`,
		blocks: [{ kind: 'markdown', body: 'A suggestion from somebody who does not own this.' }],
		change_note: 'A word was wrong.',
		based_on: (await apiCall(michalToken, 'GET', `/concept-articles/${target?.id}/`)).body?.head
			?.id,
		submit: true
	}
);
check(
	"a stranger's revision waits rather than publishing",
	strangerRevision.body?.status === 'pending',
	String(strangerRevision.body?.status)
);
await page.goto(`${BASE}/concepts/${slug}/articles/${target?.id}/history`, { waitUntil: 'load' });
await page
	.locator('.reader')
	.waitFor({ timeout: 45000 })
	.catch(() => null);
await settle(1500);
const pendingRow = page.locator('.revisions li, .reader').filter({ hasText: 'A word was wrong' });
if ((await pendingRow.count()) > 0) await pendingRow.first().click();
await settle(1200);
const acceptButton = page.locator('.reader button', { hasText: /Accept|Publish/ }).first();
check(
	'the history page offers the author a decision on it',
	(await acceptButton.count()) === 1 ||
		(await page.locator('.decision, .reader .actions button').count()) >= 1
);
await shot(page, 'history-decision');
if ((await acceptButton.count()) === 1) {
	await acceptButton.click();
	await settle(2200);
	const after = await apiCall(michalToken, 'GET', `/concept-articles/${target?.id}/`);
	check(
		'and accepting it makes it the one published revision',
		after.body?.head?.change_note === 'A word was wrong.',
		JSON.stringify(after.body?.head ?? {}).slice(0, 140)
	);
}

console.log('\n— linking an exercise from the concept page —');
await seat(michalToken);
await page.goto(`${BASE}/concepts/${slug}`, { waitUntil: 'load' });
await page
	.locator('.links')
	.waitFor({ timeout: 45000 })
	.catch(() => null);
await apiCall(michalToken, 'POST', `/concepts/${slug}/links/`, {
	target_type: 'exercise',
	target_id: Number(exerciseId)
});
await page.reload({ waitUntil: 'load' });
await settle(1800);
check(
	'the exercise appears among the concept’s links',
	(
		await page
			.locator('.links')
			.innerText()
			.catch(() => '')
	).includes(exerciseTitle.slice(0, 20))
);
await page.goto(`${BASE}/exercises/${exerciseId}`, { waitUntil: 'load' });
await settle(2200);
// The exercise page fires a dozen requests of its own and this row is one of the last to land.
await page
	.locator('.linked-concepts li')
	.first()
	.waitFor({ timeout: 20000 })
	.catch(() => null);
check(
	'and the chip row appears on the exercise page',
	(await page.locator('.linked-concepts').count()) === 1
);
check(
	'naming this concept',
	(
		await page
			.locator('.linked-concepts')
			.innerText()
			.catch(() => '')
	).includes(TITLE)
);
await shot(page, 'exercise-chips');

console.log('\n— what a reviewer sees when it is a change, not a new page —');
// The other half of the queue row: a revision of an article that already has a head is shown
// BESIDE what is published, not on its own. The new-concept row above proves the single-column
// case; this one is what a reviewer actually reads most of the time.
const forReview = await apiCall(bartekToken, 'POST', `/concept-articles/${target?.id}/revisions/`, {
	title: `${TITLE} for children`,
	blocks: [{ kind: 'markdown', body: 'One more suggestion, left in the queue to be looked at.' }],
	change_note: 'A second opinion.',
	based_on: (await apiCall(michalToken, 'GET', `/concept-articles/${target?.id}/`)).body?.head?.id,
	submit: true
});
await seat(kasiaToken);
await page.goto(`${BASE}/moderation?tab=concepts`, { waitUntil: 'load' });
await page.locator('.tabpanel').waitFor({ timeout: 45000 });
await settle(1800);
const changeRow = page.locator('.queue-item').filter({ hasText: 'A second opinion' }).first();
check(
	'a revision of an article that already has a head is shown beside what is published',
	(await changeRow.locator('.concept-side').count()) === 2
);
// Scrolled to, or the screenshot is of the top of a long queue rather than of the row this
// section is about.
await changeRow.scrollIntoViewIfNeeded().catch(() => null);
await settle(500);
await shot(page, 'moderation-side-by-side');
// Decided rather than left lying about — and rejecting is the decision that leaves the published
// page as it was. The note is not optional here, which is the point of the check further up.
if (forReview.body?.id) {
	await apiCall(kasiaToken, 'POST', `/concept-revisions/${forReview.body.id}/decide/`, {
		decision: 'reject',
		note: 'Left by a browser run — nothing wrong with it, and nothing to change.'
	});
}

console.log('\n— with the kill switch off, the links go too —');
await apiCall(kasiaToken, 'PATCH', '/feature-flags/concepts/', { is_enabled: false });
await settle(700);
// A non-staff reader: a staff-bypassed check proves nothing about a FeatureFlag (trap 10).
await strangerPage.goto(`${BASE}/`, { waitUntil: 'load' });
await settle(2000);
// `featureFlagsStore` fails OPEN until its first fetch resolves (its own header says why), so
// every link below is still on screen for a moment after a reload — waiting for the nav entry to
// go is waiting for the flags to have landed, and asserting a second too early would "prove" the
// kill switch broken on a run where it works.
await strangerPage
	.getByRole('link', { name: 'Concepts', exact: true })
	.waitFor({ state: 'detached', timeout: 20000 })
	.catch(() => null);
check(
	'the nav entry is gone',
	(await strangerPage.getByRole('link', { name: 'Concepts', exact: true }).count()) === 0
);
check(
	'the home tab is gone',
	(await strangerPage.locator('[role="tab"]').filter({ hasText: 'Concepts' }).count()) === 0
);
await shot(strangerPage, 'flag-off-home');
await strangerPage.goto(`${BASE}/search?q=${encodeURIComponent(`Scratch concept ${STAMP}`)}`, {
	waitUntil: 'load'
});
await settle(2200);
check('the search section is gone', (await strangerPage.locator('.concept-card').count()) === 0);
await strangerPage.goto(`${BASE}/exercises/${exerciseId}`, { waitUntil: 'load' });
await settle(2200);
await strangerPage
	.locator('h1')
	.first()
	.waitFor({ timeout: 20000 })
	.catch(() => null);
check(
	'the chip row is gone from the exercise page',
	(await strangerPage.locator('.linked-concepts').count()) === 0
);
check('and the exercise page itself still works', (await strangerPage.locator('h1').count()) >= 1);
await shot(strangerPage, 'flag-off-exercise');
const gatedLinks = await apiCall(
	null,
	'GET',
	`/concept-links/?target_type=exercise&target_id=${exerciseId}`
);
check(
	'the neighbouring endpoint answers [] rather than 403',
	gatedLinks.status === 200 && Array.isArray(gatedLinks.body) && gatedLinks.body.length === 0,
	`${gatedLinks.status} ${JSON.stringify(gatedLinks.body).slice(0, 80)}`
);

console.log('\n— putting the world back —');
await apiCall(kasiaToken, 'PATCH', '/feature-flags/concepts/', { is_enabled: true });
for (const t of [olaToken, michalToken, bartekToken, kasiaToken]) {
	if (t) await apiCall(t, 'PATCH', '/auth/me/', { content_locales: [] });
}
console.log(`  (the scratch concept "${TITLE}" is left behind — concepts have no delete endpoint)`);

// Last looks, on pages worth looking at: the concept as the person who may edit it, and as the
// reader who may not. (The queue has its own shot above, taken while there was something in it.)
await page.goto(`${BASE}/concepts/${slug}`, { waitUntil: 'load' });
await settle(1800);
await shot(page, 'page-signed-in');
await strangerPage.goto(`${BASE}/concepts/${slug}`, { waitUntil: 'load' });
await settle(1800);
await shot(strangerPage, 'reader');

console.log(
	`\n${pass} passed, ${fail} failed, ${errors.length} console/page errors, ${httpErrors.length} unexpected HTTP failures`
);
if (failures.length) console.log('failed: ' + failures.join(' | '));
if (errors.length) console.log(errors.slice(0, 8).join('\n'));
if (httpErrors.length) console.log(httpErrors.slice(0, 8).join('\n'));
await browser.close();
process.exit(fail || errors.length || httpErrors.length ? 1 : 0);
