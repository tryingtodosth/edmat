// The learning record on a public profile (`prompts/03-learning-record.md`, 2026-10-05):
//
//   1. with both consents on, an ANONYMOUS reader gets both blocks, and the two never mix — no
//      activity row carries an average, no grades row carries a metric (`00-DESIGN.md` §1 rule 3);
//   2. the `sets` column is recounted independently here, from her sets and those exercises' own
//      branches, and must agree row for row (house rule 5, and trap 8: exact counts, not "looks
//      populated" — the first version of `sets_by_branch` read 21 for an account with five);
//   3. `share_activity` off leaves the grades block alone and takes the activity block away —
//      `null`, drawn as "Not shared", not an empty table;
//   4. the owner looking at her own profile is told what others see, even with nothing shared;
//   5. a MINOR's shared set shows no name and links to no profile (`accounts/minors.py`: a minor
//      has no public profile, and a shared set is the one AllowAny surface in `study`);
//   6. kill switch off: the endpoint refuses an anonymous caller, the profile row is gone, the
//      settings toggle is gone, and the profile page still renders (house rule 3). Asserted
//      anonymously and for a non-staff account — e2e/CLAUDE.md trap 10.
//
// Run (ports must match whatever `run.sh`/test.md set up):
//   E2E_BASE=http://localhost:5232 E2E_API=http://127.0.0.1:8132/api node e2e/learning-record.mjs
//
// Needs `seed_demo_users`, `seed_demo_content` and `seed_profile_showcase` (the showcase is what
// gives u-kasia grades, sets and finished lessons to have a record OF). Screenshots land in
// e2e/screens/record-*.png and are meant to be LOOKED at.

import { mkdirSync } from 'node:fs';
import { englishContext } from './english.mjs';

let chromium;
try {
	({ chromium } = await import('playwright'));
} catch {
	({ chromium } = await import('playwright-core'));
}

const BASE = process.env.E2E_BASE ?? 'http://localhost:5232';
const API = process.env.E2E_API ?? 'http://127.0.0.1:8132/api';
const STAFF = 'kasia@edmat.example';
// A non-staff adult, for the guardian half and for the kill-switch checks: `feature_gate` lets real
// staff through every flag, so kasia can prove nothing about a switch being off.
const ADULT = 'ola@edmat.example';
const PASSWORD = 'password123';
const CHILD = {
	username: 'e2e-record-child',
	password: 'Dziecko-haslo-2026',
	display_name: 'Zosia'
};
const SHOTS = new URL('./screens/', import.meta.url).pathname;
mkdirSync(SHOTS, { recursive: true });

let pass = 0,
	fail = 0;
const check = (l, ok, x = '') => {
	if (ok) pass++;
	else fail++;
	console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${l} ${ok ? '' : x}`);
};

async function api(path, { token, method = 'GET', body } = {}) {
	const response = await fetch(`${API}${path}`, {
		method,
		headers: {
			...(body ? { 'Content-Type': 'application/json' } : {}),
			...(token ? { Authorization: `Token ${token}` } : {})
		},
		...(body ? { body: JSON.stringify(body) } : {})
	});
	let data = null;
	const text = await response.text();
	if (text) {
		try {
			data = JSON.parse(text);
		} catch {
			data = text;
		}
	}
	return { status: response.status, data };
}

/** The identifier is email OR username since the guardian accounts (e2e/CLAUDE.md trap 13), and the
 * child this script makes has a password of its own — the seeded demo password is only a default. */
async function tokenFor(identifier, password = PASSWORD) {
	const { status, data } = await api('/auth/login/', {
		method: 'POST',
		body: { username: identifier, password }
	});
	if (status !== 200) throw new Error(`login ${identifier}: ${status}`);
	return data.token;
}

async function setFlag(token, key, isEnabled) {
	const { status } = await api(`/feature-flags/${key}/`, {
		token,
		method: 'PATCH',
		body: { is_enabled: isEnabled }
	});
	if (status !== 200) throw new Error(`flag ${key}=${isEnabled}: ${status}`);
}

const setActivityConsent = (token, on) =>
	api('/education/me/', { token, method: 'PATCH', body: { share_activity: on } });

const errors = [];
let fontNoise = 0;

/** KaTeX's webfonts 403 in a WORKTREE dev server and nowhere else: `frontend/node_modules` is a
 * symlink to the main checkout, so `/@fs/.../katex/dist/fonts/*.woff2` falls outside Vite's
 * `server.fs.allow` root and is refused. The maths still typesets — only the glyphs fall back — and
 * a production build serves the fonts itself, so there is nothing here to fix. Learning step G hit
 * it first. Reproduced on a set that predates this branch before being filtered, so it is the dev
 * server and not this work.
 *
 * Dropped by URL, never by message: a refused request's console line is a bare "Failed to load
 * resource" with no URL in its text, so the URL is taken from the response. Anything else that
 * fails still fails the run, and the suppressed count is printed rather than hidden.
 */
const KATEX_FONT = /\/katex\/dist\/fonts\//;

function watch(page) {
	page.on('pageerror', (e) => errors.push(String(e)));
	let fontsRefusedHere = 0;
	page.on('response', (r) => {
		if (r.status() >= 400 && KATEX_FONT.test(r.url())) fontsRefusedHere++;
	});
	page.on('console', (msg) => {
		if (msg.type() !== 'error') return;
		const location = msg.location?.()?.url ?? '';
		if (KATEX_FONT.test(location)) {
			fontNoise++;
			return;
		}
		// This Chromium build logs the refusal with no URL at all. Only swallowed while this page has
		// actually had a font request refused, and never more lines than there were refusals.
		if (!location && msg.text().includes('Failed to load resource') && fontsRefusedHere > 0) {
			fontsRefusedHere--;
			fontNoise++;
			return;
		}
		errors.push(msg.text());
	});
}

/** Open a profile and wait for the layout's own boot request before reading anything — trap 25:
 * every row is in the server-rendered HTML, so waiting for a selector proves nothing about
 * hydration, and the record row is drawn only after the flags and the record have both arrived. */
async function openProfile(page, id) {
	const booted = page.waitForResponse((r) => r.url().includes('/feature-flags/'));
	await page.goto(`${BASE}/users/${id}`, { waitUntil: 'load' });
	await booted;
	await page.locator('section.rows').first().waitFor({ timeout: 20000 });
	// The record row appears asynchronously after its own request; give that request time to land
	// before asserting its ABSENCE, or every kill-switch check passes vacuously.
	await page.waitForTimeout(1500);
}

const recordRow = (page) => page.locator('button.row', { hasText: 'Learning record' });

const browser = await chromium.launch(
	process.env.CHROME ? { executablePath: process.env.CHROME } : {}
);
const DESKTOP = { width: 1280, height: 950 };

const staffToken = await tokenFor(STAFF);
const adultToken = await tokenFor(ADULT);
const kasiaId = String((await api('/auth/me/', { token: staffToken })).data.id);
let childId = null;
let childSetSlug = null;

try {
	await setFlag(staffToken, 'learning_record', true);

	// 1 — both blocks, to an anonymous reader -----------------------------------------------------
	console.log('\nboth consents on, read anonymously');
	await setActivityConsent(staffToken, true);
	const shared = await api(`/users/${kasiaId}/learning-record/?lang=pl`);
	check('anonymous GET is 200', shared.status === 200, shared.status);
	const record = shared.data ?? {};
	check('grades is a list', Array.isArray(record.grades), JSON.stringify(record.grades));
	check('activity is a list', Array.isArray(record.activity), JSON.stringify(record.activity));
	check('grades block is not empty', (record.grades ?? []).length > 0);
	check('activity block is not empty', (record.activity ?? []).length > 0);
	check('a stranger is not the owner', record.is_owner === false, record.is_owner);
	check('no withheld reason for an adult', record.withheld_reason === null, record.withheld_reason);
	// §1 rule 3, asserted on the wire and not only in the layout: the two blocks cannot be
	// concatenated into one table because neither row shape has the other's columns.
	check(
		'no activity row carries an average',
		(record.activity ?? []).every((r) => !('average' in r)),
		JSON.stringify(record.activity?.[0])
	);
	check(
		'no grades row carries a metric',
		(record.grades ?? []).every((r) => !('sets' in r) && !('cards_reviewed' in r)),
		JSON.stringify(record.grades?.[0])
	);
	check(
		'every activity row has all three declared metrics',
		(record.activity ?? []).every(
			(r) =>
				typeof r.sets === 'number' &&
				typeof r.lessons_done === 'number' &&
				typeof r.cards_reviewed === 'number'
		)
	);
	// `flashcards` is not merged yet, so no provider answers this metric and every row must read 0 —
	// a non-zero here would mean the column is being filled by something it does not name.
	check(
		'cards_reviewed is 0 everywhere until step A registers its provider',
		(record.activity ?? []).every((r) => r.cards_reviewed === 0)
	);

	// 2 — the same numbers, recounted here from the raw rows ---------------------------------------
	console.log('\nthe sets column, recounted independently');
	const mySets = (await api('/exercise-sets/', { token: staffToken })).data ?? [];
	const exerciseIds = [...new Set(mySets.flatMap((s) => s.items.map((i) => i.exercise)))];
	const exercises =
		exerciseIds.length > 0
			? (await api(`/exercises/bulk/?ids=${exerciseIds.join(',')}`, { token: staffToken })).data
			: [];
	const branchOf = new Map(exercises.map((e) => [String(e.id), e.branch_slug]));
	// Distinct (set, branch) pairs — the same question the backend asks, asked a different way: a
	// set spanning two branches counts once in each, never twice in one.
	const pairs = new Set();
	for (const set of mySets) {
		for (const item of set.items) {
			const slug = branchOf.get(String(item.exercise));
			if (slug) pairs.add(`${set.slug}|${slug}`);
		}
	}
	const expected = {};
	for (const pair of pairs) {
		const slug = pair.split('|')[1];
		expected[slug] = (expected[slug] ?? 0) + 1;
	}
	check(`recount found sets in ${Object.keys(expected).length} branch(es)`, pairs.size > 0);
	const reported = Object.fromEntries(
		(record.activity ?? []).filter((r) => r.sets > 0).map((r) => [r.branch.slug, r.sets])
	);
	check(
		'the reported sets column matches the recount exactly',
		JSON.stringify(reported) === JSON.stringify(expected),
		`reported ${JSON.stringify(reported)} vs recount ${JSON.stringify(expected)}`
	);
	const lessonRows = (record.activity ?? []).filter((r) => r.lessons_done > 0);
	check('at least one branch has finished lessons', lessonRows.length > 0);

	// 3 — the same thing in a browser, anonymous ---------------------------------------------------
	console.log('\nanonymous browser, both blocks');
	const anon = await englishContext(browser, BASE, { viewport: DESKTOP });
	const page = await anon.newPage();
	watch(page);
	await openProfile(page, kasiaId);
	check('the record row is on the profile', (await recordRow(page).count()) === 1);
	const summary = await recordRow(page).locator('.row__value').innerText();
	check(
		'the row summarises both blocks and totals neither',
		summary.includes('with results') && summary.includes('with activity'),
		summary
	);
	await recordRow(page).click();
	const modal = page.locator('[role="dialog"]').first();
	await modal.locator('table').first().waitFor({ timeout: 10000 });
	const blocks = modal.locator('section.block');
	check('the modal draws exactly two blocks', (await blocks.count()) === 2);
	check(
		'the first block is the institution, the second is EdMat',
		(await blocks.nth(0).locator('h3').innerText()).includes('institution') &&
			(await blocks.nth(1).locator('h3').innerText()).includes('EdMat'),
		`${await blocks.nth(0).locator('h3').innerText()} / ${await blocks.nth(1).locator('h3').innerText()}`
	);
	const gradeHeads = await blocks.nth(0).locator('thead th').allInnerTexts();
	const activityHeads = await blocks.nth(1).locator('thead th').allInnerTexts();
	check(
		'the grades table has an Average column',
		gradeHeads.includes('Average'),
		gradeHeads.join('|')
	);
	check(
		'the activity table has none, and has the three metrics',
		!activityHeads.includes('Average') &&
			['Sets', 'Lessons finished', 'Cards reviewed'].every((h) => activityHeads.includes(h)),
		activityHeads.join('|')
	);
	check(
		'both tables have as many rows as the API returned',
		(await blocks.nth(0).locator('tbody tr').count()) === record.grades.length &&
			(await blocks.nth(1).locator('tbody tr').count()) === record.activity.length
	);
	check(
		'a stranger is not told what others see',
		(await modal.locator('.owner-note').count()) === 0
	);
	await page.screenshot({ path: `${SHOTS}record-both-blocks.png` });

	// 4 — consent withdrawn ------------------------------------------------------------------------
	console.log('\nshare_activity off');
	await setActivityConsent(staffToken, false);
	const gradesOnly = await api(`/users/${kasiaId}/learning-record/?lang=pl`);
	check(
		'grades survive',
		Array.isArray(gradesOnly.data?.grades) && gradesOnly.data.grades.length > 0
	);
	check(
		'activity is null, not an empty list',
		gradesOnly.data?.activity === null,
		JSON.stringify(gradesOnly.data?.activity)
	);
	await openProfile(page, kasiaId);
	await recordRow(page).click();
	const modal2 = page.locator('[role="dialog"]').first();
	await modal2.locator('table').first().waitFor({ timeout: 10000 });
	const blocks2 = modal2.locator('section.block');
	check(
		'the EdMat block has no table at all',
		(await blocks2.nth(1).locator('table').count()) === 0
	);
	check(
		'it says the consent is off rather than showing zeros',
		(await blocks2.nth(1).innerText()).includes('Not shared'),
		await blocks2.nth(1).innerText()
	);
	check(
		'the institution block is untouched',
		(await blocks2.nth(0).locator('tbody tr').count()) > 0
	);
	await page.screenshot({ path: `${SHOTS}record-grades-only.png` });

	// 5 — the owner's own view ---------------------------------------------------------------------
	console.log("\nthe owner's own view");
	const ownerSeen = await api(`/users/${kasiaId}/learning-record/?lang=pl`, { token: staffToken });
	check('the owner is told she is', ownerSeen.data?.is_owner === true);
	check('and the viewer argument widened nothing', ownerSeen.data?.activity === null);

	// 6 — a minor's shared set ---------------------------------------------------------------------
	console.log("\na minor's shared set");
	const created = await api('/auth/children/', { token: adultToken, method: 'POST', body: CHILD });
	check(
		'a guardian can create the child account',
		created.status === 201,
		JSON.stringify(created.data)
	);
	childId = created.data?.id;
	const childToken = await tokenFor(CHILD.username, CHILD.password);
	const anExercise = (await api('/exercises/?content_locales=pl', { token: childToken })).data?.[0];
	const madeSet = await api('/exercise-sets/', {
		token: childToken,
		method: 'POST',
		body: { name: 'Powtórka przed klasówką', exercise_ids: [anExercise.id], is_public: true }
	});
	check("the child's public set was created", madeSet.status === 201, JSON.stringify(madeSet.data));
	childSetSlug = madeSet.data?.slug;
	const asStranger = await api(`/exercise-sets/${childSetSlug}/`);
	check('a link-holder can open it', asStranger.status === 200, asStranger.status);
	check(
		'the name is withheld',
		asStranger.data?.owner_display_name === '',
		asStranger.data?.owner_display_name
	);
	check('and the refusal says so', asStranger.data?.owner_anonymous === true);
	check(
		"the child's display name is nowhere in the body",
		!JSON.stringify(asStranger.data).includes(CHILD.display_name)
	);
	const setPage = await anon.newPage();
	watch(setPage);
	await setPage.goto(`${BASE}/sets/${childSetSlug}`, { waitUntil: 'load' });
	await setPage.locator('header h1').waitFor({ timeout: 20000 });
	// `renderContent` is a ~380 KB chunk fetched on demand (frontend/CLAUDE.md), so the statements are
	// raw LaTeX for a moment after the header appears. Waiting for the first typeset span keeps the
	// screenshot honest — the first run's showed `\int_{-\infty}` as source and looked like a bug.
	await setPage.locator('.katex').first().waitFor({ timeout: 20000 });
	const sharedBy = setPage.locator('header .shared-by');
	check(
		'the page still says who shared it, neutrally',
		(await sharedBy.innerText()).trim() === 'Shared by a learner on EdMat',
		await sharedBy.innerText()
	);
	check(
		'nothing on the page names the child',
		!(await setPage.locator('main').innerText()).includes(CHILD.display_name)
	);
	check(
		"and nothing links to the child's profile",
		(await setPage.locator(`a[href*="/users/${childId}"]`).count()) === 0
	);
	await setPage.screenshot({ path: `${SHOTS}record-minor-set.png` });
	await setPage.close();

	// 7 — the kill switch --------------------------------------------------------------------------
	console.log('\nkill switch off');
	await setActivityConsent(staffToken, true);
	await setFlag(staffToken, 'learning_record', false);
	const refused = await api(`/users/${kasiaId}/learning-record/?lang=pl`);
	check(
		'an anonymous caller is refused, not served null',
		[401, 403].includes(refused.status),
		refused.status
	);
	const refusedSignedIn = await api(`/users/${kasiaId}/learning-record/?lang=pl`, {
		token: adultToken
	});
	check(
		'and so is a signed-in non-staff caller',
		refusedSignedIn.status === 403,
		refusedSignedIn.status
	);
	const stillStaff = await api(`/users/${kasiaId}/learning-record/?lang=pl`, { token: staffToken });
	check('staff keep their own tools', stillStaff.status === 200, stillStaff.status);
	const killed = await anon.newPage();
	watch(killed);
	await openProfile(killed, kasiaId);
	check('the record row is gone', (await recordRow(killed).count()) === 0);
	check('the profile itself still renders', (await killed.locator('button.row').count()) > 0);
	check(
		'and its other sections are untouched',
		(await killed.locator('main').innerText()).includes('Education') ||
			(await killed.locator('button.row').count()) > 1
	);
	await killed.screenshot({ path: `${SHOTS}record-killed-profile.png` });
	await killed.close();

	// The settings toggle, as a non-staff account: `GET /api/feature-flags/` is AllowAny and has no
	// staff bypass, so the control disappears for everybody — but this is the half house rule 3 is
	// actually about, so it is checked as an ordinary user.
	const settings = await englishContext(browser, BASE, { viewport: DESKTOP });
	const settingsPage = await settings.newPage();
	watch(settingsPage);
	// Trap 25: the whole form is in the server-rendered HTML, so filling and clicking it before the
	// bundle has hydrated submits it NATIVELY — the page reloads to `/login?` and the script times
	// out waiting for a navigation that reads like a broken sign-in. Wait for the layout's own boot
	// request first, then for the real login response rather than for a URL.
	const loginBooted = settingsPage.waitForResponse((r) => r.url().includes('/feature-flags/'));
	await settingsPage.goto(`${BASE}/login`, { waitUntil: 'load' });
	await loginBooted;
	await settingsPage.locator('form input[autocomplete="username"]').fill(ADULT);
	await settingsPage.locator('form input[type="password"]').fill(PASSWORD);
	const signedIn = settingsPage.waitForResponse(
		(r) => r.url().includes('/auth/login/') && r.request().method() === 'POST'
	);
	await settingsPage.locator('form button[type="submit"]').click();
	check('the non-staff account signed in', (await signedIn).status() === 200);
	await settingsPage.waitForURL((u) => !u.pathname.endsWith('/login'), { timeout: 20000 });
	// `/settings`, not `/settings/profile`: `EducationPanel` is a standalone section there (and the
	// profile page's own `EducationModal` renders the SAME component with `embedded`, so one toggle
	// covers both surfaces — which is why it went in the panel and not in the modal).
	await settingsPage.goto(`${BASE}/settings`, { waitUntil: 'load' });
	const consent = settingsPage.locator('.education-section .consent').first();
	await consent.waitFor({ timeout: 20000 });
	check(
		'the activity consent toggle is gone with the switch off',
		!(await consent.innerText()).includes('what I have done on EdMat'),
		await consent.innerText()
	);
	check(
		'the other three consents are still there',
		(await consent.locator('label.check').count()) === 3
	);
	await setFlag(staffToken, 'learning_record', true);
	await settingsPage.reload({ waitUntil: 'load' });
	await consent.waitFor({ timeout: 20000 });
	check(
		'and comes back when the switch does',
		(await consent.locator('label.check').count()) === 4
	);
	await settingsPage.screenshot({ path: `${SHOTS}record-settings-consents.png` });
	await settingsPage.close();
	await settings.close();

	check('no console or page errors anywhere', errors.length === 0, errors.slice(0, 4).join(' | '));
	console.log(`  (${fontNoise} KaTeX webfont 403s ignored — the worktree symlink, see watch())`);
	await page.close();
	await anon.close();
} catch (e) {
	// Without this the `finally` below (which exits the process) swallows the stack entirely, and a
	// script that died halfway reads as a short, clean, all-passing run.
	check('the script ran to the end', false, `${e}\n${e?.stack ?? ''}`);
} finally {
	// Cleanup, and the flag and consent put back the way they were found. Deleting the child takes
	// the set with it (`ChildDetailView.delete` cascades), and the re-query is AUTHENTICATED on
	// purpose — trap 12: the anonymous read cache would happily serve the row back for 60s.
	console.log('\ncleanup');
	try {
		await setFlag(staffToken, 'learning_record', true);
		await setActivityConsent(staffToken, false);
		if (childId) {
			const removed = await api(`/auth/children/${childId}/`, {
				token: adultToken,
				method: 'DELETE'
			});
			check('the child account was deleted', [200, 204].includes(removed.status), removed.status);
			if (childSetSlug) {
				const gone = await api(`/exercise-sets/${childSetSlug}/`, { token: adultToken });
				check('and its set went with it', gone.status === 404, gone.status);
			}
		}
		const restored = await api(`/users/${kasiaId}/learning-record/?lang=pl`);
		check(
			'the record is back to grades-only, as it was found',
			restored.status === 200 && restored.data?.activity === null,
			`${restored.status} ${JSON.stringify(restored.data?.activity)}`
		);
	} catch (e) {
		check('cleanup ran', false, String(e));
	}
	await browser.close();
	console.log(`\n${pass} passed, ${fail} failed`);
	process.exit(fail > 0 ? 1 : 0);
}
