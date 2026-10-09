// Contests, end to end in a real browser (backend `contests/`, HISTORY §17CE.A) — the owner's ask
// of 2026-10-09: "add contests. personalize all current modules to this use case. … research law
// for konkursy in poland and add presets with making it possible by prefilling with current users".
//
// What it drives, in the order a contest actually happens:
//
//   1. the hub draws, with the organiser above the fold on every card;
//   2. the wizard founds a contest from a preset, with **a suggested person put on the jury** —
//      the "prefilling with current users" half of the ask;
//   3. **announcing is REFUSED** while the claim deadline is missing, with the sentence that says
//      why, and accepted once it is set;
//   4. a minor registers only with a guardian's name and consent;
//   5. a stage opens, an entrant answers and hands in;
//   6. the stage closes and the jury scores it;
//   7. results are published, and the list shows initials rather than names;
//   8. a complaint is lodged and answered with reasons;
//   9. the compliance panel shows its citations WITH their verification markers and says it is not
//      legal advice.
//
// Run (ports must match your own servers — never hardcoded, e2e/CLAUDE.md trap 4):
//   E2E_BASE=http://localhost:5271 E2E_API=http://127.0.0.1:8171/api \
//     E2E_ORGANISER_TOKEN=<u-kasia> E2E_JUROR_TOKEN=<u-michal> E2E_ENTRANT_TOKEN=<demo-ania> \
//     node e2e/contests.mjs
//
// **Tokens, not logins** (e2e/CLAUDE.md trap 30): `POST /api/auth/login/` is ~10/hour per IP and
// this script would sign in four times. Read each token once with
//   manage.py shell -c "from rest_framework.authtoken.models import Token; \
//     from django.contrib.auth import get_user_model as g; \
//     print(Token.objects.get_or_create(user=g().objects.get(username='u-kasia'))[0].key)"
// and pass them in. The script says plainly when one is missing rather than failing somewhere else.
//
// It needs `manage.py seed_contest_demo` to have run (the two demo contests and the dev accounts).
// It founds one contest of its own and leaves it **cancelled** rather than deleted: a contest
// people have entered is never deleted (house rule 12), and the refusal to delete it is one of the
// checks. Re-running it is safe — each run founds a differently-titled contest.
//
// Last run: 58 checks, 58 passed, 0 failed, zero page errors (2026-10-09, ports 5271 / 8171).
import { mkdirSync } from 'node:fs';

let chromium;
try {
	({ chromium } = await import('playwright'));
} catch {
	({ chromium } = await import('playwright-core'));
}

const BASE = process.env.E2E_BASE ?? 'http://localhost:5271';
const API = process.env.E2E_API ?? 'http://127.0.0.1:8171/api';
const ORGANISER = process.env.E2E_ORGANISER_TOKEN ?? '';
const JUROR = process.env.E2E_JUROR_TOKEN ?? '';
const ENTRANT = process.env.E2E_ENTRANT_TOKEN ?? '';
const OUT = 'e2e/screens';
mkdirSync(OUT, { recursive: true });

if (!ORGANISER || !JUROR || !ENTRANT) {
	console.error('E2E_ORGANISER_TOKEN, E2E_JUROR_TOKEN and E2E_ENTRANT_TOKEN are all required.');
	console.error('Every write below is an organiser, a juror or an entrant act, and a contest has');
	console.error('no is_staff bypass for any of them (e2e/CLAUDE.md trap 32). See the header.');
	process.exit(1);
}

let passed = 0;
let failed = 0;
function check(name, ok, detail = '') {
	if (ok) {
		passed += 1;
		console.log(`  ok   ${name}`);
	} else {
		failed += 1;
		console.log(`  FAIL ${name}${detail ? ` — ${detail}` : ''}`);
	}
}

/** The API, for the setup and the assertions a page cannot make honestly. Reads go through an
 *  AUTHENTICATED request so the 60-second anonymous read cache cannot answer with a stale list
 *  (e2e/CLAUDE.md trap 12). */
async function api(token, method, path, body) {
	const response = await fetch(`${API}${path}`, {
		method,
		headers: {
			Authorization: `Token ${token}`,
			...(body ? { 'Content-Type': 'application/json' } : {})
		},
		...(body ? { body: JSON.stringify(body) } : {})
	});
	const text = await response.text();
	let parsed;
	try {
		parsed = text ? JSON.parse(text) : null;
	} catch {
		parsed = text;
	}
	return { status: response.status, body: parsed };
}

const browser = await chromium.launch();
const errors = [];
/** Ignored console noise, counted rather than hidden: in a WORKTREE Vite serves KaTeX's webfonts
 *  from outside `server.fs.allow` and they 403 (e2e/CLAUDE.md trap 26). It is a dev-server fact
 *  about the checkout, not about this branch, and the count is printed so the suppression is never
 *  silent. Matched on the RESPONSE url, never on the console text, which carries no url. */
let ignored = 0;

async function openPage(token) {
	const ctx = await browser.newContext({ viewport: { width: 1320, height: 1200 } });
	const page = await ctx.newPage();
	page.on('pageerror', (e) => errors.push(String(e).slice(0, 200)));
	page.on('response', (r) => {
		if (r.status() === 403 && /\/node_modules\/katex\/dist\/fonts\//.test(r.url())) ignored += 1;
	});
	page.on('console', (m) => {
		if (m.type() !== 'error') return;
		const text = m.text();
		if (/Failed to load resource|net::ERR_|the server responded with a status of 403/.test(text)) {
			ignored += 1;
			return;
		}
		errors.push(text.slice(0, 200));
	});
	await page.goto(BASE, { waitUntil: 'load' });
	await page.evaluate((t) => localStorage.setItem('edmat-auth-token', t), token);
	return { ctx, page };
}

const TITLE = `E2E Konkurs ${Date.now()}`;

// ---- 0. who is who, and the ids the script needs ------------------------------------------------
const me = await api(ORGANISER, 'GET', '/auth/me/');
check('the organiser token resolves', me.status === 200, `status ${me.status}`);
const jurorMe = await api(JUROR, 'GET', '/auth/me/');
const entrantMe = await api(ENTRANT, 'GET', '/auth/me/');
check('the juror and entrant tokens resolve', jurorMe.status === 200 && entrantMe.status === 200);
const jurorId = jurorMe.body?.id;

// ---- 1. the hub ---------------------------------------------------------------------------------
const organiser = await openPage(ORGANISER);
// Register the wait BEFORE the navigation and await it after: `waitForSelector` on `.cards`
// resolves against a panel that has not fetched anything yet, and a fixed `waitForTimeout` is a
// guess that the first run of this script lost (0 cards, while the API had three) — e2e/CLAUDE.md
// traps 25 and 27, one layer apart.
const hubLoaded = organiser.page.waitForResponse(
	(r) => r.url().includes('/api/contests/') && r.request().method() === 'GET',
	{ timeout: 60000 }
);
await organiser.page.goto(`${BASE}/contests`, { waitUntil: 'load' });
await hubLoaded;
await organiser.page.waitForSelector('.cards > li', { timeout: 60000 });
const cards = organiser.page.locator('.cards > li');
const cardCount = await cards.count();
check('the hub lists the seeded demo contests', cardCount >= 2, `${cardCount} cards`);
check(
	'every card names its organiser above the fold',
	(await organiser.page.locator('.cards .organiser').count()) === cardCount,
	`${await organiser.page.locator('.cards .organiser').count()} of ${cardCount}`
);
// The three personal tabs appear only once the session has resolved, which happens AFTER the
// first paint (frontend/CLAUDE.md trap 3 is the same timing from the other side) — so wait for
// them rather than counting whatever is drawn at this instant.
await organiser.page
	.waitForFunction(() => document.querySelectorAll('[role="tab"]').length === 4, null, {
		timeout: 30000
	})
	.catch(() => {});
check(
	'the four tabs are there for a signed-in reader',
	(await organiser.page.locator('[role="tab"]').count()) === 4,
	`${await organiser.page.locator('[role="tab"]').count()} tabs`
);
await organiser.page.screenshot({ path: `${OUT}/contests-hub.png`, fullPage: false });
// (the screenshot is taken after the cards and the tabs, so it shows the hub somebody sees)

// ---- 2. the wizard, with a suggested person on the jury -----------------------------------------
await organiser.page.goto(`${BASE}/contests/new`, { waitUntil: 'load' });
await organiser.page.waitForSelector('.presets', { timeout: 60000 });
const presets = await organiser.page.locator('.presets > li').count();
check('the wizard offers the presets', presets >= 8, `${presets} presets`);
check(
	'and the prize-free default is first',
	/Wyzwanie|Challenge/.test(await organiser.page.locator('.presets > li').first().innerText())
);
// The `school` preset: a prize, minors, and the fullest regulamin — the one worth driving.
await organiser.page
	.locator('.preset')
	.filter({ hasText: /Konkurs szkolny|School contest/ })
	.first()
	.click();
await organiser.page.screenshot({ path: `${OUT}/contests-wizard-1.png`, fullPage: false });

await organiser.page.locator('button').filter({ hasText: /Dalej|Next/ }).first().click();
await organiser.page.waitForSelector('.grid', { timeout: 20000 });
// Scope every fill to its own label (e2e/CLAUDE.md trap 6): positional locators lie.
await organiser.page.locator('.field', { hasText: /Tytuł|Title/ }).first().locator('input').fill(TITLE);
await organiser.page
	.locator('.field', { hasText: /Według czego ocenia jury i jakie są wagi|What the jury marks against, and the weights/ })
	.first()
	.locator('textarea')
	.fill('Po 5 punktów za zadanie: poprawność i uzasadnienie. Remisy rozstrzyga się merytorycznie.');
await organiser.page
	.locator('.field', { hasText: /Kto odpowiada za dane uczestników|Who is responsible for the entrants' data/ })
	.first()
	.locator('input')
	.fill('E2E Szkoła');
await organiser.page
	.locator('.field', { hasText: /…i jak się z nim skontaktować|…and how to reach them/ })
	.first()
	.locator('input')
	.fill('e2e@example.org');
// Deliberately NO claim deadline: check 3 is that announcing is refused for exactly that.
await organiser.page.screenshot({ path: `${OUT}/contests-wizard-2.png`, fullPage: false });

await organiser.page.locator('button').filter({ hasText: /Dalej|Next/ }).first().click();
await organiser.page.waitForSelector('.pickers', { timeout: 20000 });
const suggestions = organiser.page.locator('.suggestions label');
const suggestionCount = await suggestions.count();
check(
	'the role picker suggests people the founder already works with',
	suggestionCount > 0,
	'no suggestions — has seed_demo_content run? the organiser must share a roster with somebody'
);
if (suggestionCount > 0) {
	check(
		'and each suggestion says WHY it is being suggested',
		(await organiser.page.locator('.suggestions .via').first().innerText()).trim().length > 0
	);
	await suggestions.first().locator('input[type="checkbox"]').check();
	check(
		'picking one shows it as chosen',
		(await organiser.page.locator('.picker').first().locator('.chosen li').count()) === 1
	);
}
await organiser.page.screenshot({ path: `${OUT}/contests-wizard-3-people.png`, fullPage: false });

await organiser.page.locator('button').filter({ hasText: /Dalej|Next/ }).first().click();
await organiser.page.waitForSelector('.checklist', { timeout: 20000 });
check(
	'the legal checklist is previewed before anything is created',
	(await organiser.page.locator('.checklist > li').count()) > 5
);
check(
	'and it says it is not legal advice',
	/nie jest poradą prawną|not legal advice/.test(
		await organiser.page.locator('.disclaimer').first().innerText()
	)
);
check(
	'every citation in it carries its verification marker',
	(await organiser.page.locator('.checklist .marker').count()) > 0
);
await organiser.page.screenshot({ path: `${OUT}/contests-wizard-4-law.png`, fullPage: false });

await organiser.page
	.locator('button')
	.filter({ hasText: /Utwórz konkurs|Create the contest/ })
	.first()
	.click();
await organiser.page.waitForURL(/\/contests\/\d+/, { timeout: 30000 });
const contestId = (organiser.page.url().match(/\/contests\/(\d+)/) ?? [])[1];
check('the wizard created the contest and went to its page', Boolean(contestId));

// ---- the contest page -----------------------------------------------------------------------------
await organiser.page.waitForSelector('.hero', { timeout: 30000 });
check(
	'the organiser is the FIRST thing on the contest page',
	/Organizuje|Organised by/.test(await organiser.page.locator('.hero .organiser').first().innerText())
);
check(
	'and the page says EdMat is only the medium',
	/EdMat/.test(await organiser.page.locator('.hero .medium').first().innerText())
);
check('the status strip is drawn', (await organiser.page.locator('.strip .step').count()) === 7);
await organiser.page.screenshot({ path: `${OUT}/contests-detail-draft.png`, fullPage: true });

const afterCreate = await api(ORGANISER, 'GET', `/contests/${contestId}/`);
check(
	'the jury row the wizard added is really there',
	afterCreate.body?.jury_count >= (suggestionCount > 0 ? 2 : 1),
	`jury_count ${afterCreate.body?.jury_count}`
);
check(
	'the preset laid out the regulamin skeleton and a stage',
	afterCreate.body?.stage_count === 1,
	`stage_count ${afterCreate.body?.stage_count}`
);

// ---- 3. announcing is refused for the missing claim deadline, then accepted ----------------------
const refusedAnnounce = await api(ORGANISER, 'POST', `/contests/${contestId}/announce/`);
check(
	'announcing is refused 409 while the claim deadline is missing',
	refusedAnnounce.status === 409 && refusedAnnounce.body?.detail === 'claim_deadline_missing',
	`${refusedAnnounce.status} ${JSON.stringify(refusedAnnounce.body)}`
);
// And the page says so in words, on its own read, before anybody presses anything.
await organiser.page.goto(`${BASE}/contests/${contestId}`, { waitUntil: 'load' });
await organiser.page.waitForSelector('.standing', { timeout: 30000 });
check(
	'and the page explains it in a sentence rather than a code',
	/termin, w którym można ubiegać się o nagrodę|deadline within which the prize may be claimed/.test(
		await organiser.page.locator('.standing').first().innerText()
	),
	await organiser.page.locator('.standing').first().innerText()
);

const deadline = new Date(Date.now() + 60 * 86400000).toISOString();
await api(ORGANISER, 'PATCH', `/contests/${contestId}/`, { prize_claim_deadline: deadline });
// The regulamin has to exist too — the law wants it readable and storable before entry.
await api(ORGANISER, 'PUT', `/contests/${contestId}/rules/`, {
	sections: [
		{ key: 'organiser', order: 0, body: 'Organizatorem jest E2E Szkoła.' },
		{ key: 'dates', order: 1, body: 'O nagrodę można ubiegać się w ciągu 60 dni od wyników.' },
		{ key: 'criteria_jury', order: 2, body: 'Po 5 punktów za zadanie. Remisy merytorycznie.' }
	]
});
await api(ORGANISER, 'POST', `/contests/${contestId}/rules/publish/`);
const announced = await api(ORGANISER, 'POST', `/contests/${contestId}/announce/`);
check(
	'with the deadline and a published regulamin it announces',
	announced.status === 200 && announced.body?.status === 'announced',
	`${announced.status} ${JSON.stringify(announced.body?.detail ?? '')}`
);
await api(ORGANISER, 'POST', `/contests/${contestId}/transition/`, { status: 'registration_open' });

// ---- 4. a minor registers only with a guardian's consent ----------------------------------------
const bare = await api(ENTRANT, 'POST', `/contests/${contestId}/registrations/`, {});
check('an adult entrant registers with no guardian block', bare.status === 201, `status ${bare.status}`);
const registrationId = bare.body?.id;
check('and `publish_name` defaults to FALSE', bare.body?.publish_name === false);
const consentPatch = await api(ENTRANT, 'PATCH', `/contest-registrations/${registrationId}/publish-name/`, {
	publish_name: true
});
check(
	'the name consent is its own, separate PATCH',
	consentPatch.status === 200 && consentPatch.body?.publish_name === true
);
const revoked = await api(ENTRANT, 'PATCH', `/contest-registrations/${registrationId}/publish-name/`, {
	publish_name: false
});
check('and it is revocable', revoked.status === 200 && revoked.body?.publish_name === false);
const organiserCannotRevoke = await api(
	ORGANISER,
	'PATCH',
	`/contest-registrations/${registrationId}/publish-name/`,
	{ publish_name: true }
);
check(
	'the organiser cannot set it for somebody else',
	organiserCannotRevoke.status === 403,
	`status ${organiserCannotRevoke.status}`
);

// The guardian-consent block itself, drawn on the page for an account the server refuses.
// `demo-zofia` carries the consent on the seeded contest, so the block is checked there instead of
// flipping a site-wide `is_minor` flag on a shared dev account (`seed_contest_demo` says why).
const seeded = await api(ORGANISER, 'GET', '/contests/?q=Szkolny');
const seededId = seeded.body?.[0]?.id;
const seededRoster = await api(ORGANISER, 'GET', `/contests/${seededId}/registrations/`);
const withConsent = (seededRoster.body ?? []).filter((r) => r.has_guardian_consent);
check(
	'the seeded school contest carries guardian consents with a name on them',
	withConsent.length === 2 && withConsent.every((r) => r.guardian_name.length > 0),
	`${withConsent.length} with consent`
);

await api(ORGANISER, 'POST', `/contest-registrations/${registrationId}/decide/`, {
	decision: 'accepted'
});

// ---- 5. a stage opens, the entrant answers and hands in -----------------------------------------
const stages = await api(ORGANISER, 'GET', `/contests/${contestId}/stages/`);
const stageId = stages.body?.[0]?.id;
const exercises = await api(ORGANISER, 'GET', '/exercises/?limit=2');
const exerciseId = exercises.body?.[0]?.id;
await api(ORGANISER, 'POST', `/contest-stages/${stageId}/problems/`, {
	exercise_id: exerciseId,
	points: 5
});

// Before it opens, the problems do not exist for an entrant — 404, not 403 (house rule 4).
const hidden = await api(ENTRANT, 'GET', `/contest-stages/${stageId}/problems/`);
check(
	'a stage s problems are 404 to an entrant before it opens',
	hidden.status === 404,
	`status ${hidden.status}`
);
const opened = await api(ORGANISER, 'POST', `/contest-stages/${stageId}/open/`);
check('the organiser opens the stage', opened.status === 200, `status ${opened.status}`);

const entrant = await openPage(ENTRANT);
await entrant.page.goto(`${BASE}/contests/${contestId}/stages/${stageId}`, { waitUntil: 'load' });
await entrant.page.waitForSelector('.problem', { timeout: 60000 });
// Wait for the renderer before shooting: `MathContent` fetches it on demand and a statement is raw
// LaTeX for a moment (e2e/CLAUDE.md trap 26, second half).
await entrant.page.waitForSelector('.problem .katex, .problem .math-content', { timeout: 30000 });
check('the entrant sees the problem', (await entrant.page.locator('.problem').count()) === 1);
const statementText = await entrant.page.locator('.problem .math-content').first().innerText();
check('the statement is rendered, not raw', statementText.trim().length > 0);
const problemHtml = await entrant.page.locator('.problem').first().innerHTML();
check(
	'and the page carries no hint and no solution for it',
	!/data-hint|solution-entry|SolutionEntry/.test(problemHtml)
);
await entrant.page.locator('.answer textarea').first().fill(
	'Z definicji granicy: dla każdego \\( \\varepsilon > 0 \\) istnieje \\( N \\)…'
);
await entrant.page.waitForTimeout(2200); // the autosave debounce
await entrant.page.screenshot({ path: `${OUT}/contests-stage-answer.png`, fullPage: false });
await entrant.page.locator('button').filter({ hasText: /Oddaj pracę|Hand it in/ }).first().click();
await entrant.page.waitForTimeout(400);
await entrant.page.locator('button').filter({ hasText: /Tak, oddaję|Yes, hand it in/ }).first().click();
await entrant.page.waitForTimeout(2000);
check(
	'handing in says so and cannot be undone',
	/Oddane|Handed in/.test(await entrant.page.locator('.handin, .ok').first().innerText())
);

// ---- 6. the stage closes and the jury scores it --------------------------------------------------
// The juror the wizard put on the jury is whoever the suggestion list offered, which is not
// necessarily the token holder — so put this one on it FIRST. The refusal below has to be
// `stage_open` and not `not_juror`, or the check would be asserting the wrong rule (the first run
// of this script did exactly that).
const onTheJury = await api(ORGANISER, 'POST', `/contests/${contestId}/staff/`, {
	user_id: jurorId,
	role: 'jury'
});
check(
	'the organiser puts the juror on the jury',
	onTheJury.status === 201 || onTheJury.status === 409,
	`${onTheJury.status} ${JSON.stringify(onTheJury.body)}`
);
const tooEarly = await api(JUROR, 'GET', `/contest-stages/${stageId}/submissions/`);
check(
	'the jury cannot see the answers while the stage is open',
	tooEarly.status === 409 && tooEarly.body?.detail === 'stage_open',
	`${tooEarly.status} ${JSON.stringify(tooEarly.body)}`
);
await api(ORGANISER, 'POST', `/contest-stages/${stageId}/close/`);

const juror = await openPage(JUROR);
await juror.page.goto(`${BASE}/contests/${contestId}/judge`, { waitUntil: 'load' });
// The row, not the container: `.matrix` is drawn before its fetch comes back, and counting then
// gives 0 while everything is working (the first run of this script reported exactly that, and
// then went on to fill the inputs successfully, because Playwright's own locators auto-wait).
await juror.page.waitForSelector('.matrix .row', { timeout: 60000 });
const matrixRows = await juror.page.locator('.matrix .row').count();
check('the jury sees the submission', matrixRows === 1, `${matrixRows} rows`);
const rowText = (await juror.page.locator('.matrix .row h4').first().innerText()).trim();
check(
	'and it is anonymised — a number, not a name',
	rowText.length > 0 && /#\d+/.test(rowText) && !/Ania|Kowalczyk/.test(rowText),
	`"${rowText}" — an empty heading would pass the "no name" half for the wrong reason (trap 8)`
);
await juror.page.locator('.mark input').first().fill('4');
await juror.page.locator('.mark input.note').first().fill('Uzasadnienie pełne.');
const marksSaved = juror.page.waitForResponse(
	(r) => r.url().includes('/scores/') && r.request().method() === 'POST',
	{ timeout: 30000 }
);
await juror.page.locator('button').filter({ hasText: /Zapisz moje oceny|Save my marks/ }).first().click();
await marksSaved;
await juror.page.waitForTimeout(500);
await juror.page.screenshot({ path: `${OUT}/contests-judge-matrix.png`, fullPage: false });
const scored = await api(ORGANISER, 'GET', `/contests/${contestId}/ranking/`);
check(
	'the ranking is recounted from the marks',
	scored.body?.rows?.[0]?.total_points === 4,
	JSON.stringify(scored.body?.rows?.[0] ?? {})
);

// ---- 7. results published, and the names obey the consent ---------------------------------------
await api(ORGANISER, 'POST', `/contest-stages/${stageId}/advance/`);
await api(ORGANISER, 'POST', `/contests/${contestId}/transition/`, { status: 'judging' });
const published = await api(ORGANISER, 'POST', `/contests/${contestId}/publish-results/`);
check('the results publish', published.status === 200, JSON.stringify(published.body?.detail ?? ''));

await organiser.page.goto(`${BASE}/contests/${contestId}/results`, { waitUntil: 'load' });
await organiser.page.waitForSelector('.ranking tbody tr', { timeout: 60000 });
const resultRows = await organiser.page.locator('.ranking tbody tr').count();
check('the results page lists the ranking', resultRows === 1, `${resultRows} rows`);
const who = await organiser.page.locator('.ranking tbody .who').first().innerText();
check(
	'and shows INITIALS, because nobody opted in',
	/^[A-ZŁŚŻŹĆĘÓĄŃ]\./.test(who.trim()),
	`shown as "${who}"`
);
check(
	'the complaints window and its end date are on the page',
	/reklamacj|complain/i.test(await organiser.page.locator('.complaints').first().innerText())
);
await organiser.page.screenshot({ path: `${OUT}/contests-results.png`, fullPage: true });

// ---- 8. a complaint, lodged and answered with reasons -------------------------------------------
const lodged = await api(ENTRANT, 'POST', `/contests/${contestId}/complaints/`, {
	text: 'Uważam, że zadanie 1 oceniono za nisko — uzasadnienie było pełne.'
});
check('an entrant lodges a complaint', lodged.status === 201, `status ${lodged.status}`);
const twice = await api(ENTRANT, 'POST', `/contests/${contestId}/complaints/`, { text: 'Jeszcze raz.' });
check('and cannot lodge a second one while the first waits', twice.status === 409);
const notAParticipant = await api(JUROR, 'POST', `/contests/${contestId}/complaints/`, {
	text: 'Ja też.'
});
check(
	'somebody who did not take part cannot complain',
	notAParticipant.status === 403 && notAParticipant.body?.detail === 'not_participant',
	`${notAParticipant.status} ${JSON.stringify(notAParticipant.body)}`
);

await organiser.page.goto(`${BASE}/contests/${contestId}/manage`, { waitUntil: 'load' });
await organiser.page.waitForSelector('.block', { timeout: 60000 });
await organiser.page.waitForTimeout(1500);
const inbox = organiser.page.locator('.list li').filter({ hasText: 'zadanie 1' }).first();
check('the complaint is in the organiser s inbox', (await inbox.count()) === 1);
await inbox.locator('textarea').first().fill(
	'Komisja ponownie przeczytała pracę. Zgodnie z §6 regulaminu za uzasadnienie przyznaje się do 3 punktów; brakowało przejścia granicznego. Ocena bez zmian. Droga sądowa pozostaje otwarta.'
);
await inbox.locator('button').filter({ hasText: /Wyślij odpowiedź|Send the answer/ }).first().click();
await organiser.page.waitForTimeout(2000);
const answered = await api(ORGANISER, 'GET', `/contests/${contestId}/complaints/`);
check(
	'answering it records the answer and who gave it',
	answered.body?.[0]?.status === 'answered' && answered.body?.[0]?.answer.length > 50,
	JSON.stringify(answered.body?.[0]?.status ?? '')
);

// ---- 9. the compliance panel, with its markers ---------------------------------------------------
check(
	'the manage page carries the compliance panel',
	(await organiser.page.locator('.panel').count()) >= 1
);
const panelText = await organiser.page.locator('.panel').first().innerText();
check(
	'it says plainly that it is not legal advice',
	/nie jest poradą prawną|not legal advice/.test(panelText)
);
check(
	'every citation it draws carries a verification marker',
	(await organiser.page.locator('.panel .marker').count()) > 0
);
check(
	'and the tax block shows the 2 000 zł line, never the mass-media limb',
	/2 ?000/.test(panelText) && !/masowego przekazu|mass media/.test(panelText.replace(/celowo nie proponuje[^.]*\./, '')),
	'the mass-media limb must only ever appear as the thing EdMat does NOT offer'
);
await organiser.page.screenshot({ path: `${OUT}/contests-manage.png`, fullPage: true });

// **403, not 404, and the difference is the project's own convention** (`backend/CLAUDE.md`, API
// conventions): a non-owner gets 404 *via queryset scoping*, and a real-but-wrong party gets 403.
// A registered entrant can see the contest, so the contest is not hidden from them — only the
// organiser's own obligations are. The first run of this script asserted 404 and was wrong about
// which rule it was testing; the backend was right.
const hiddenFromEntrant = await api(ENTRANT, 'GET', `/contests/${contestId}/compliance/`);
check(
	'an entrant, who CAN see the contest, is refused its compliance panel with a word',
	hiddenFromEntrant.status === 403 && hiddenFromEntrant.body?.detail === 'not_staff',
	`${hiddenFromEntrant.status} ${JSON.stringify(hiddenFromEntrant.body)}`
);

// ---- the certificate ------------------------------------------------------------------------------
const results = await api(ENTRANT, 'GET', `/contests/${contestId}/results/`);
const myResult = (results.body?.results ?? []).find((r) => r.is_me);
if (myResult && myResult.title !== 'participant') {
	await entrant.page.goto(`${BASE}/contests/${contestId}/certificate/${myResult.id}`, {
		waitUntil: 'load'
	});
	await entrant.page.waitForSelector('.sheet, .error', { timeout: 30000 });
	check(
		'a placed entrant s certificate names the ORGANISER as the issuer',
		/organizator|organiser/i.test(await entrant.page.locator('.sheet').first().innerText())
	);
	check(
		'and it is in the print area, or it would print a blank page',
		(await entrant.page.locator('.sheet.print-area').count()) === 1
	);
	await entrant.page.screenshot({ path: `${OUT}/contests-certificate.png`, fullPage: false });
} else {
	// Said rather than silently skipped: one answer worth 4 of 5 is a `participant` under the
	// default thresholds, and a participant has no certificate by design.
	console.log('  --   certificate skipped: the single entry placed as `participant` (by design)');
}

// ---- clean up ------------------------------------------------------------------------------------
// A contest with entries is cancelled, never deleted (house rule 12) — and `destroy` refuses
// anything past `draft`, which is the rule this also checks.
const refusedDelete = await api(ORGANISER, 'DELETE', `/contests/${contestId}/`);
check(
	'a contest people have entered cannot be deleted',
	refusedDelete.status === 409,
	`status ${refusedDelete.status}`
);
await api(ORGANISER, 'POST', `/contests/${contestId}/transition/`, { status: 'cancelled' });
const afterCancel = await api(ORGANISER, 'GET', `/contests/${contestId}/`);
check(
	'cancelling leaves the page, the entries and the results in place',
	afterCancel.status === 200 && afterCancel.body?.status === 'cancelled',
	`status ${afterCancel.body?.status}`
);

check('zero page errors', errors.length === 0, errors.slice(0, 3).join(' | '));
if (ignored > 0) {
	console.log(
		`  --   ${ignored} console/network errors ignored: KaTeX webfonts 403 in a worktree (e2e/CLAUDE.md trap 26)`
	);
}
await browser.close();
console.log(`\n${passed} passed, ${failed} failed`);
console.log(`Scratch contest ${contestId} ("${TITLE}") is left CANCELLED on purpose — see the header.`);
process.exit(failed === 0 ? 0 : 1);
