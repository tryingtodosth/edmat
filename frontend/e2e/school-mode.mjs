// School mode, the completion certificate and the lesson→deck button (learning step C).
//
// Driven against the seeded school: run `manage.py seed_school_demo` against the backend this
// script drives first, or every check below fails on a sign-in rather than on anything under test.
//
//   1. as the teacher, open class 2a: the "run by <school>" line, the class notice, the roster with
//      its guardian column and the under-16 badges, and every pupil's register although the course's
//      `progress_visibility` is `private` — which is the whole of school mode;
//   2. issue a certificate to the one pupil who is eligible, open the print preview, screenshot it;
//   3. be refused for one who is not, with the WORD on screen (house rule 6);
//   4. as that pupil, see their own certificate and not anybody else's;
//   5. as a stranger, get 404 on the completion (not 403 — a 403 would confirm somebody finished);
//   6. the lesson→deck button: present behind `flashcards`, gone when the switch is off, and — with
//      `POST /api/decks/` MOCKED, because learning step A owns that endpoint and it does not exist
//      on this branch — producing a deck and a link to it.
//
// **The deck call is mocked and that is stated in the output**, per `prompts/README.md` §9: C, D and
// E verify their "make a deck" buttons against a mocked `POST /api/decks/`, and the real call is
// verified at integration once A has merged. The route `/flashcards/[id]` the link points at is A's
// too, so the link is asserted to EXIST and is deliberately not followed.
//
// **The control course in section 2 is founded by the teacher**, and founding a course passes the
// creation gate (`backend/config/creation.py`): with `creation_requires_verification` on, an
// unverified account is refused 403 `verification_required` — which `school.teacher` is, as seeded.
// So when `/api/creation/` says so, the script turns that switch OFF (as the seeded staff account,
// the way section 7 flips its switches) for the one POST that founds the control, and back ON in a
// `finally` — run it against a database COPY. The control must be the SAME teacher's course: what
// it proves is that the register comes from the school's link and not from the teacher's role.
// (WP12; until then the control was refused and section 2 failed on the gate, not on school mode.)
//
// Run (ports are step C's):
//   rm -rf backend/cachedata/*
//   E2E_BASE=http://localhost:5233 E2E_API=http://127.0.0.1:8133/api node e2e/school-mode.mjs
//
// Screenshots land in e2e/screens/school-*.png and are meant to be LOOKED at.

import { mkdirSync } from 'node:fs';
import { englishContext } from './english.mjs';

let chromium;
try {
	({ chromium } = await import('playwright'));
} catch {
	({ chromium } = await import('playwright-core'));
}

const BASE = process.env.E2E_BASE ?? 'http://localhost:5233';
const API = process.env.E2E_API ?? 'http://127.0.0.1:8133/api';
// The seeded school's own accounts (`backend/testing/school_demo.py`). Signed in as, rather than
// registered: the register endpoint is throttled ~10/hour per IP in a per-process cache, and a
// script that exhausts it makes every later run look like a code regression (e2e/CLAUDE.md trap 1).
const TEACHER = 'school.teacher';
const DONE_PUPIL = 'school.pupil.01'; // finished 2a — holds the seeded certificate
// The other two pupils this script acts on are found by DISPLAY NAME on the roster rather than by
// username: the picker and the panel rows are drawn by display name, and a check that looked up a
// username would be asserting against a string the page never renders.
const NEXT_PUPIL_NAME = 'Hanna Kamińska'; // school.pupil.05 — also finished 2a, the one issued to
const STUCK_PUPIL_NAME = 'Aleksander Zieliński'; // school.pupil.06 — stuck on lesson 1, the refusal
const STRANGER = 'kasia@edmat.example'; // a seeded staff account outside the school
const SCHOOL_PASSWORD = process.env.E2E_SCHOOL_PASSWORD ?? 'persona-pass-2026';
const STRANGER_PASSWORD = 'password123';
const SHOTS = new URL('./screens/', import.meta.url).pathname;
mkdirSync(SHOTS, { recursive: true });

let pass = 0,
	fail = 0;
const check = (label, ok, extra = '') => {
	if (ok) pass++;
	else fail++;
	console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${label} ${ok ? '' : extra}`);
};

// One sign-in per account per run, and none at all for an account whose token is passed in: the
// login endpoint is throttled ~10/hour per IP (e2e/CLAUDE.md trap 30), and this script used to sign
// the staff account in three times. `E2E_TEACHER_TOKEN` / `E2E_STAFF_TOKEN` skip those two.
const knownTokens = {
	[TEACHER]: process.env.E2E_TEACHER_TOKEN,
	[STRANGER]: process.env.E2E_STAFF_TOKEN
};
async function tokenFor(username, password) {
	knownTokens[username] ??= await signIn(username, password);
	return knownTokens[username];
}
async function signIn(username, password) {
	const response = await fetch(`${API}/auth/login/`, {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify({ username, password })
	});
	if (!response.ok) throw new Error(`login ${username}: ${response.status}`);
	return (await response.json()).token;
}

async function api(token, path, options = {}) {
	return fetch(`${API}${path}`, {
		...options,
		headers: {
			'Content-Type': 'application/json',
			Authorization: `Token ${token}`,
			...(options.headers ?? {})
		}
	});
}

async function setFlag(token, key, isEnabled) {
	const response = await api(token, `/feature-flags/${key}/`, {
		method: 'PATCH',
		body: JSON.stringify({ is_enabled: isEnabled })
	});
	if (!response.ok) throw new Error(`flag ${key}=${isEnabled}: ${response.status}`);
}

const errors = [];
function watch(page) {
	page.on('pageerror', (e) => errors.push(String(e)));
	page.on('console', (msg) => {
		if (msg.type() === 'error') errors.push(msg.text());
	});
}

/** The exact key `lib/state/token.svelte.ts` persists under. Spelled from that file rather than
 *  guessed: the first draft of this script used `edmat.token` and every page loaded signed OUT,
 *  which looks exactly like a broken page (the course is private, so it 404s). */
const TOKEN_KEY = 'edmat-auth-token';

/** A signed-in English context. The token goes into localStorage the way `token.svelte.ts` keeps
 *  it, so the page boots already authenticated — there is no sign-in form to drive and no throttle
 *  to exhaust (e2e/CLAUDE.md trap 1). */
async function signedIn(browser, token, viewport) {
	const ctx = await englishContext(browser, BASE, { viewport });
	await ctx.addInitScript(
		([key, value]) => {
			try {
				localStorage.setItem(key, value);
			} catch {
				/* a private context with storage blocked — the checks will say so */
			}
		},
		[TOKEN_KEY, token]
	);
	return ctx;
}

async function openCourse(page, courseId, { tab } = {}) {
	// Registered BEFORE `goto`: waiting for the root layout's own flag request is how this project's
	// scripts know the bundle has hydrated, rather than a fixed timeout (e2e/CLAUDE.md trap 25).
	const booted = page
		.waitForResponse((r) => r.url().includes('/feature-flags/'), { timeout: 60000 })
		.catch(() => null);
	// `'load'`, never `'networkidle'`: the notification SSE stream is permanently in flight on an
	// authenticated page and networkidle never fires (trap 2).
	await page.goto(`${BASE}/courses/${courseId}${tab ? `?tab=${tab}` : ''}`, {
		waitUntil: 'load'
	});
	await booted;
	await page.locator('h1').waitFor({ timeout: 60000 });
}

async function shoot(page, name) {
	await page.screenshot({ path: `${SHOTS}school-${name}.png`, fullPage: true });
}

/** Open a folded panel the way a reader does — by its toggle — and return the fold. Every panel
 *  below the tabs has been one line until opened since 3d9f613c (`FoldSection`), and its body is
 *  not in the DOM while shut, so waiting for `.completions` on a fresh context waited for something
 *  that is never drawn (WP12). A fresh context remembers no open folds, so it starts shut. */
async function openFold(page, key) {
	const fold = page.locator(`section.fold[data-fold="${key}"]`);
	await fold.waitFor({ timeout: 15000 });
	const toggle = fold.locator('.fold__toggle');
	if ((await toggle.getAttribute('aria-expanded')) !== 'true') await toggle.click();
	await fold.locator('.fold__body > *').first().waitFor({ timeout: 15000 });
	return fold;
}

const DESKTOP = { width: 1280, height: 950 };
const PHONE = { width: 390, height: 844 };

// ---- discover the seeded school through the API, so no id is hardcoded -------------------------

const teacherToken = await tokenFor(TEACHER, SCHOOL_PASSWORD);
const teaching = await (await api(teacherToken, '/courses/?mine=teaching')).json();
const klass = teaching.find((row) => row.title.includes('2a'));
if (!klass) {
	console.error(
		'No seeded class found. Run `manage.py seed_school_demo` against the backend this script drives.'
	);
	process.exit(1);
}
const roster = await (await api(teacherToken, `/courses/${klass.id}/participants/`)).json();
const rosterIdFor = (displayName) =>
	roster.find((row) => row.participant.display_name === displayName)?.participant.id ?? null;

const browser = await chromium.launch(
	process.env.CHROME ? { executablePath: process.env.CHROME } : {}
);

try {
	console.log(`\nSchool mode — class ${klass.id} "${klass.title}"`);
	console.log('NOTE: POST /api/decks/ is MOCKED below (learning step A owns it; it 404s here).\n');

	// One throwaway open first. A fresh context pays a ~3–5s Vite cold compile that production does
	// not (trap 11), and the dependency optimizer reloads the page the first time a new dependency is
	// imported (trap 22) — which would make the first real check time out against working code.
	{
		const warm = await browser.newContext({ viewport: DESKTOP });
		const page = await warm.newPage();
		await page.goto(`${BASE}/courses`, { waitUntil: 'load' }).catch(() => {});
		await page.waitForTimeout(3000);
		await warm.close();
	}

	// ---- 1. The teacher's view of a class ------------------------------------------------------
	console.log('1. the teacher opens the class');
	{
		const ctx = await signedIn(browser, teacherToken, DESKTOP);
		const page = await ctx.newPage();
		watch(page);
		await openCourse(page, klass.id);

		check(
			'the "run by" line names the school',
			(await page.locator('.run-by').textContent())?.includes('Szkoła Podstawowa') === true,
			await page
				.locator('.run-by')
				.textContent()
				.catch(() => '(absent)')
		);
		// And it does NOT repeat the instructor line's words. `course_byInstructorPrefix` is "Run by"
		// and names the PERSON; a screenshot showed the two stacked and reading identically.
		check(
			'the organisation line is not the instructor line said twice',
			(await page.locator('.run-by').textContent())?.includes('Organised by') === true &&
				(await page.locator('.meta').first().textContent())?.includes('Run by') === true
		);
		check(
			'the "run by" line links to the organisation',
			(await page.locator('.run-by a[href*="/organizations/demo-szkola-148"]').count()) === 1
		);
		check(
			'the class notice says the people running it see the progress and the guardians',
			(await page.locator('.class-notice').textContent())?.includes('class run by') === true
		);
		check(
			'the course payload says progress_visibility is private',
			klass.progress_visibility === 'private',
			klass.progress_visibility
		);
		// The whole of school mode: the register, although the mode is `private`.
		const progressNotice = page.locator('.progress .muted').first();
		await progressNotice.waitFor({ timeout: 15000 });
		check(
			'school mode is explained in words on the progress panel',
			(await progressNotice.textContent())?.includes('because a school runs this class') === true,
			await progressNotice.textContent()
		);
		check(
			'the register is drawn for all six lessons',
			(await page.locator('.progress').count()) === 6,
			`${await page.locator('.progress').count()} panels`
		);
		await page.locator('.progress button.linkish').first().click();
		await page.locator('.progress ul li').first().waitFor({ timeout: 8000 });
		check(
			'opening "who is where" names every pupil on the roster',
			(await page.locator('.progress').first().locator('ul li').count()) === 6,
			`${await page.locator('.progress').first().locator('ul li').count()} rows`
		);
		await shoot(page, 'teacher-register');

		// ---- the roster and its guardian column ----
		await openCourse(page, klass.id, { tab: 'people' });
		await page.locator('.roster li').first().waitFor({ timeout: 15000 });
		check(
			'the roster draws a guardian for every minor',
			(await page.locator('.roster .guardians').count()) === 6,
			`${await page.locator('.roster .guardians').count()} guardian cells`
		);
		check(
			'every pupil in 2a carries the under-16 badge',
			(await page.locator('.roster .badge').count()) === 6
		);
		check(
			'the siblings share one guardian, named twice',
			(await page.locator('.roster .guardians:has-text("Agnieszka Kowalska")').count()) === 2
		);
		check(
			'the pupil with two guardians lists both',
			(await page.locator('.roster li:has-text("Maja Lewandowska") .guardians a').count()) === 2
		);
		await shoot(page, 'teacher-roster');
		await ctx.close();
	}

	// ---- 2. The ordinary course beside it: the control ------------------------------------------
	console.log('2. the control — the same teacher on an ordinary private course sees no register');
	{
		// 3b is also a class, so the control has to be a course NO school runs. Made and removed
		// through the real API, which is also what proves the widening is the link and not the role.
		// The creation gate is lifted for this one POST when it would refuse the teacher (header).
		const gate = await (await api(teacherToken, '/creation/')).json();
		const lifted = gate.course === 'verification_required';
		const staffToken = lifted ? await tokenFor(STRANGER, STRANGER_PASSWORD) : null;
		if (lifted) {
			console.log('   (creation gate refuses the teacher: lifting it for the control POST only)');
			await setFlag(staffToken, 'creation_requires_verification', false);
		}
		let made;
		try {
			made = await api(teacherToken, '/courses/', {
				method: 'POST',
				body: JSON.stringify({
					title: 'E2E school-mode control',
					visibility: 'private',
					status: 'running',
					progress_visibility: 'private',
					enrollment_policy: 'approval',
					audience: 'university',
					language: 'pl'
				})
			});
		} finally {
			if (lifted) await setFlag(staffToken, 'creation_requires_verification', true);
		}
		if (lifted) {
			const back = await (await api(teacherToken, '/creation/')).json();
			check(
				'control: the creation gate is back on afterwards',
				back.course === 'verification_required',
				JSON.stringify(back)
			);
		}
		if (made.status === 201) {
			const control = await made.json();
			const chapter = await (
				await api(teacherToken, `/courses/${control.id}/chapters/`, {
					method: 'POST',
					body: JSON.stringify({ title: 'Week 1' })
				})
			).json();
			await api(teacherToken, `/courses/${control.id}/lessons/`, {
				method: 'POST',
				body: JSON.stringify({ chapter: chapter.id, title: 'One' })
			});
			const ctx = await signedIn(browser, teacherToken, DESKTOP);
			const page = await ctx.newPage();
			watch(page);
			await openCourse(page, control.id);
			check('control: no "run by" line', (await page.locator('.run-by').count()) === 0);
			check('control: no class notice', (await page.locator('.class-notice').count()) === 0);
			check(
				'control: the progress panel names nobody',
				(await page.locator('.progress button.linkish').count()) === 0
			);
			await shoot(page, 'control-no-school');
			await ctx.close();
			// Clean up through the real API and confirm by re-query, authenticated so the 60 s
			// anonymous read cache cannot answer with a row that is genuinely gone (trap 12).
			await api(teacherToken, `/courses/${control.id}/`, { method: 'DELETE' });
			const after = await api(teacherToken, `/courses/${control.id}/`);
			check('control: scratch course removed', after.status === 404, `status ${after.status}`);
		} else {
			check(
				'control: scratch course created',
				false,
				`status ${made.status} ${JSON.stringify(await made.json().catch(() => null))}`
			);
		}
	}

	// ---- 3. Issuing a certificate, and being refused --------------------------------------------
	console.log('3. the teacher issues one certificate, and is refused another');
	{
		// Start from a known state: the seed leaves exactly one certificate, on pupil.01.
		const existing = await (await api(teacherToken, `/courses/${klass.id}/completions/`)).json();
		check(
			'the seed left exactly one certificate',
			existing.length === 1,
			`${existing.length} rows`
		);
		const seeded = existing[0];
		check(
			'its note carries the basis the server froze',
			String(seeded.note).includes("by the participant's own statements"),
			seeded.note
		);
		check('it carries no grade field', !('grade' in seeded) && !('mark' in seeded));
		check(
			'it names the school as the organisation',
			seeded.organization?.slug === 'demo-szkola-148'
		);

		const ctx = await signedIn(browser, teacherToken, DESKTOP);
		const page = await ctx.newPage();
		watch(page);
		await openCourse(page, klass.id);
		const fold = await openFold(page, 'completions');
		const panel = fold.locator('.completions');
		await panel.waitFor({ timeout: 15000 });
		check(
			'the certificates panel is headed "Completion certificates" for staff',
			(await fold.locator('h2').textContent())?.includes('Completion certificates') === true,
			await fold.locator('h2').textContent()
		);
		check('the certificates panel is drawn for staff', await panel.isVisible());
		check(
			'the panel says what a certificate does NOT carry',
			(await panel.textContent())?.includes('no grade, no mark and no rank') === true
		);

		// Issue to the next eligible pupil. Targeted by option text, never by position — a
		// positional locator has matched the header's language picker before (trap 6).
		const select = panel.locator('select');
		const nextName = NEXT_PUPIL_NAME;
		await select.selectOption({ label: nextName });
		await panel.locator('textarea').fill('Wydane w ramach e2e.');
		const before = await panel.locator('ul li').count();
		await panel.locator('button.primary').click();
		await panel.locator(`ul li:has-text("${nextName}")`).waitFor({ timeout: 10000 });
		check(
			'issuing added exactly one row',
			(await panel.locator('ul li').count()) === before + 1,
			`${await panel.locator('ul li').count()} rows`
		);
		check(
			'the new row carries the server-written basis',
			(await panel.locator(`ul li:has-text("${nextName}")`).textContent())?.includes(
				'6 of 6 lessons'
			) === true
		);
		check(
			'the issued pupil is no longer offered in the picker',
			(await select.locator(`option:has-text("${nextName}")`).count()) === 0
		);
		await shoot(page, 'teacher-certificates');

		// The refusal, with its word. Driven through the API because the UI deliberately does not
		// offer an ineligible pupil (house rule 6 from the other side: do not offer a refusal) — so
		// the WORD is checked where it is produced, and the sentence for it is checked below.
		const refused = await api(teacherToken, `/courses/${klass.id}/completions/`, {
			method: 'POST',
			body: JSON.stringify({ participant: rosterIdFor(STUCK_PUPIL_NAME) })
		});
		const refusedBody = await refused.json();
		check(
			'an ineligible pupil is refused 409 not_done',
			refused.status === 409 && refusedBody.detail === 'not_done',
			`${refused.status} ${JSON.stringify(refusedBody)}`
		);
		const twice = await api(teacherToken, `/courses/${klass.id}/completions/`, {
			method: 'POST',
			body: JSON.stringify({ participant: seeded.participant.id })
		});
		check(
			'a second certificate for one pair is 409 already_issued',
			twice.status === 409 && (await twice.json()).detail === 'already_issued',
			`status ${twice.status}`
		);

		// The sentence the frontend has for that word, checked by withdrawing twice: the first
		// Withdraw succeeds, and a second call answers `already_revoked`, whose sentence the panel
		// renders. One click of the real control, then the API for the race the UI hides.
		const issued = await (await api(teacherToken, `/courses/${klass.id}/completions/`)).json();
		const mine = issued.find((row) => row.participant.display_name === nextName);
		await panel.locator(`ul li:has-text("${nextName}") button.danger`).click();
		await panel.locator(`ul li:has-text("${nextName}") .badge`).waitFor({ timeout: 10000 });
		check(
			'withdrawing marks the row withdrawn rather than removing it',
			(await panel.locator(`ul li:has-text("${nextName}")`).count()) === 1 &&
				(await panel.locator(`ul li:has-text("${nextName}") .badge`).count()) === 1
		);
		const again = await api(teacherToken, `/course-completions/${mine.id}/revoke/`, {
			method: 'POST'
		});
		check(
			'revoking twice is 409 already_revoked',
			again.status === 409 && (await again.json()).detail === 'already_revoked',
			`status ${again.status}`
		);
		await shoot(page, 'teacher-withdrawn');
		await ctx.close();

		// Put the course back the way the seed left it, and confirm authenticated (trap 12).
		await api(teacherToken, `/course-completions/${mine.id}/revoke/`, { method: 'POST' });
		const left = await (await api(teacherToken, `/courses/${klass.id}/completions/`)).json();
		check(
			'cleanup: the withdrawn scratch certificate is still a tombstone, not a delete',
			left.length === 2 && left.some((row) => row.is_revoked),
			`${left.length} rows`
		);
	}

	// ---- 4. The holder's own view, and the printable sheet --------------------------------------
	console.log('4. the pupil who holds one opens it and prints it');
	{
		const pupilToken = await tokenFor(DONE_PUPIL, SCHOOL_PASSWORD);
		const own = await (await api(pupilToken, `/courses/${klass.id}/completions/`)).json();
		check('the holder sees exactly their own', own.length === 1, `${own.length} rows`);
		check('and it is theirs', own[0].participant.display_name === 'Zofia Kowalska');

		const ctx = await signedIn(browser, pupilToken, DESKTOP);
		const page = await ctx.newPage();
		watch(page);
		await openCourse(page, klass.id);
		// The heading is the fold's own since 3d9f613c, so it is read from the fold, not the body.
		const fold = await openFold(page, 'completions');
		const panel = fold.locator('.completions');
		await panel.waitFor({ timeout: 15000 });
		check(
			'the panel is headed "Your certificate" for a holder, not "Completion certificates"',
			(await fold.locator('h2').textContent())?.includes('Your certificate') === true,
			await fold.locator('h2').textContent()
		);
		check('a pupil is offered no issue form', (await panel.locator('select').count()) === 0);
		check('a pupil is offered no Withdraw', (await panel.locator('button.danger').count()) === 0);

		// The sheet. `emulateMedia({ media: 'print' })` is what makes the @media print block the one
		// being screenshotted — a screenshot of the screen layout would prove nothing about the
		// thing somebody actually puts on paper.
		await panel.locator('a.secondary').first().click();
		await page.locator('article.sheet').waitFor({ timeout: 15000 });
		const sheet = await page.locator('article.sheet').textContent();
		check(
			'the sheet is bilingual on one page',
			/Zaświadczenie/.test(sheet) && /Certificate/.test(sheet)
		);
		check('the sheet names the pupil', sheet.includes('Zofia Kowalska'));
		check('the sheet names the school', sheet.includes('Szkoła Podstawowa'));
		check('the sheet names the issuer', sheet.includes('Barbara Nowakowska'));
		check('the sheet carries its own basis', sheet.includes('6 of 6 lessons'));
		check('the sheet carries the term', /Termin \/ Dates/.test(sheet) && sheet.includes('2026'));
		check(
			'the sheet says it is unsigned, in both languages',
			sheet.includes('niepodpisany') && sheet.includes('unsigned')
		);
		check(
			'the sheet says it carries no grade, in both languages',
			sheet.includes('oceny') && sheet.includes('no grade, mark or rank')
		);
		check('exactly one <title>', (await page.locator('head title').count()) === 1);
		await shoot(page, 'certificate-screen');
		await page.emulateMedia({ media: 'print' });
		check('print: the controls are hidden', !(await page.locator('.controls').isVisible()));
		// The check that matters, and the one the first run did NOT have: `lib/styles/_print.scss`
		// is global and hides `body *`, revealing only `.print-area`. Without that class the sheet
		// printed a blank page while every other assertion here passed — found by looking at the
		// screenshot, then pinned so it cannot come back.
		check(
			'print: the sheet itself is still visible (not hidden by the global print stylesheet)',
			await page.locator('article.sheet').isVisible()
		);
		check(
			'print: and its text is actually painted',
			((await page.locator('article.sheet h1').boundingBox())?.height ?? 0) > 0
		);
		await shoot(page, 'certificate-print');
		await page.emulateMedia({ media: null });

		// Somebody else's certificate: 404, not 403. A 403 would confirm that another pupil
		// finished the course, which is the fact the page exists to carry.
		const everything = await (await api(teacherToken, `/courses/${klass.id}/completions/`)).json();
		const notMine = everything.find((row) => row.participant.id !== own[0].participant.id);
		const peek = await api(pupilToken, `/course-completions/${notMine.id}/`);
		check(
			"a pupil gets 404 on a classmate's certificate",
			peek.status === 404,
			`status ${peek.status}`
		);
		await ctx.close();

		// The phone, because a certificate is a thing people open on a phone and hand over.
		const phoneCtx = await signedIn(browser, pupilToken, PHONE);
		const phone = await phoneCtx.newPage();
		watch(phone);
		await phone.goto(`${BASE}/courses/${klass.id}/certificate/${own[0].id}`, {
			waitUntil: 'load'
		});
		await phone.locator('article.sheet').waitFor({ timeout: 15000 });
		const overflow = await phone.evaluate(
			() => document.documentElement.scrollWidth - document.documentElement.clientWidth
		);
		check('phone: no horizontal overflow on the sheet', overflow <= 0, `overflow ${overflow}px`);
		await shoot(phone, 'certificate-phone');
		await phoneCtx.close();
	}

	// ---- 5. A stranger ---------------------------------------------------------------------------
	console.log('5. a stranger gets 404, and sees no class');
	{
		const strangerToken = await tokenFor(STRANGER, STRANGER_PASSWORD);
		const everything = await (await api(teacherToken, `/courses/${klass.id}/completions/`)).json();
		const some = everything[0];
		const peek = await api(strangerToken, `/course-completions/${some.id}/`);
		check('a stranger gets 404 on a completion', peek.status === 404, `status ${peek.status}`);
		const list = await api(strangerToken, `/courses/${klass.id}/completions/`);
		check(
			'and 404 on the course-scoped list (the class is private)',
			list.status === 404,
			`status ${list.status}`
		);
		const anon = await fetch(`${API}/course-completions/${some.id}/`);
		check(
			'and signed out it is 401 or 404, never the document',
			[401, 403, 404].includes(anon.status),
			`status ${anon.status}`
		);
		const anonRoster = await fetch(`${API}/courses/${klass.id}/participants/`);
		check(
			'the roster (and so the guardian column) is unreachable signed out',
			[401, 403, 404].includes(anonRoster.status),
			`status ${anonRoster.status}`
		);
	}

	// ---- 6. The lesson -> deck button, with POST /api/decks/ MOCKED -------------------------------
	console.log('6. "Make a deck from this week" — the deck POST is MOCKED (step A owns it)');
	{
		const ctx = await signedIn(browser, teacherToken, DESKTOP);
		const page = await ctx.newPage();
		watch(page);
		// The mock. This is the ONE thing in this script that is not the real backend, and it is
		// mocked because `/api/decks/` arrives with learning step A — on this branch it 404s. What is
		// being verified here is C's half: that the button exists behind the flag, that it sends the
		// lesson's exercise ids IN ORDER with a `lesson` source and a `course` placement, and that
		// the page then offers the deck. The call itself is verified at integration.
		let posted = null;
		await page.route('**/api/decks/', async (route) => {
			if (route.request().method() !== 'POST') return route.continue();
			posted = JSON.parse(route.request().postData() ?? '{}');
			await route.fulfill({
				status: 201,
				contentType: 'application/json',
				body: JSON.stringify({
					id: 4242,
					name: posted.name,
					card_count: (posted.exercise_ids ?? []).length,
					due_count: 0,
					is_public: false,
					source_kind: 'lesson',
					created_at: new Date().toISOString()
				})
			});
		});
		await openCourse(page, klass.id);
		const lesson = page.locator('li.lesson').first();
		await lesson.waitFor({ timeout: 15000 });
		const deckButton = lesson.getByRole('button', { name: 'Make a deck from this week' });
		check('the deck button is on the lesson', (await deckButton.count()) === 1);

		// What the lesson actually points at, from the API, so the assertion is a number this
		// script chose rather than whatever the page happened to draw (trap 8).
		const detail = await (await api(teacherToken, `/courses/${klass.id}/`)).json();
		const firstLesson = detail.chapters[0].lessons[0];
		const expected = firstLesson.items
			.filter((item) => item.kind === 'exercise')
			.map((item) => String(item.exercise));
		await deckButton.click();
		await lesson.locator('.deck-note').waitFor({ timeout: 10000 });
		check(
			'the deck POST carried the lesson as its source',
			posted?.source?.kind === 'lesson' && String(posted?.source?.id) === String(firstLesson.id),
			JSON.stringify(posted?.source)
		);
		check(
			'and the course as its placement, because a teacher may place one',
			posted?.placement?.kind === 'course' && String(posted?.placement?.id) === String(klass.id),
			JSON.stringify(posted?.placement)
		);
		check(
			`and exactly the lesson's ${expected.length} exercise ids, in order`,
			JSON.stringify(posted?.exercise_ids) === JSON.stringify(expected),
			`${JSON.stringify(posted?.exercise_ids)} vs ${JSON.stringify(expected)}`
		);
		check(
			'the page then offers the deck',
			(await lesson.locator('.deck-note a[href="/flashcards/4242"]').count()) === 1
		);
		await shoot(page, 'deck-from-lesson');
		await ctx.close();
	}

	// ---- 7. Kill switches, as a NON-staff account ------------------------------------------------
	// A staff-bypassed check proves nothing about a FeatureFlag (e2e/CLAUDE.md trap 10), and the
	// teacher here is an ordinary account — `assert_contained` guarantees it.
	console.log('7. the kill switches');
	{
		const staffToken = await tokenFor(STRANGER, STRANGER_PASSWORD); // kasia is the seeded staff
		await setFlag(staffToken, 'flashcards', false);
		try {
			const ctx = await signedIn(browser, teacherToken, DESKTOP);
			const page = await ctx.newPage();
			watch(page);
			await openCourse(page, klass.id);
			const lesson = page.locator('li.lesson').first();
			await lesson.waitFor({ timeout: 15000 });
			await lesson
				.getByRole('button', { name: 'Make a deck from this week' })
				.waitFor({ state: 'detached', timeout: 8000 })
				.catch(() => {});
			check(
				'flashcards off: the deck button is gone, not merely broken',
				(await lesson.getByRole('button', { name: 'Make a deck from this week' }).count()) === 0
			);
			check(
				'flashcards off: the lesson still renders and Edit still works',
				(await lesson.getByRole('button', { name: 'Edit' }).count()) === 1
			);
			await shoot(page, 'flashcards-off');
			await ctx.close();
		} finally {
			await setFlag(staffToken, 'flashcards', true);
		}

		await setFlag(staffToken, 'organizations', false);
		try {
			const ctx = await signedIn(browser, teacherToken, DESKTOP);
			const page = await ctx.newPage();
			watch(page);
			await openCourse(page, klass.id);
			await page
				.locator('.run-by')
				.waitFor({ state: 'detached', timeout: 8000 })
				.catch(() => {});
			check(
				'organizations off: the "run by" line is gone',
				(await page.locator('.run-by').count()) === 0
			);
			// And school mode is NOT switched off with it — `courses/rules.py` says so at the top:
			// turning the organisations surface off must not change what a teacher is shown about a
			// child in the middle of a term.
			await page.locator('.progress').first().waitFor({ timeout: 15000 });
			check(
				'organizations off: school mode still holds (deliberate)',
				(await page.locator('.progress .muted').first().textContent())?.includes(
					'because a school runs this class'
				) === true
			);
			await shoot(page, 'organizations-off');
			await ctx.close();
		} finally {
			await setFlag(staffToken, 'organizations', true);
		}
	}
} finally {
	await browser.close();
}

check('zero console/page errors', errors.length === 0, errors.join(' | ').slice(0, 400));

console.log(`\n${pass} passed, ${fail} failed`);
console.log('Reminder: POST /api/decks/ was MOCKED — step A owns it and the real call is');
console.log("verified at integration. /flashcards/[id] is A's route and was not followed.");
// Like the claim scripts (e2e/CLAUDE.md trap 19), this one leaves one row behind it cannot remove:
// the certificate it issued and then withdrew. There is no DELETE endpoint for a completion, which
// is house rule 12 working rather than a gap — so a re-run starts from two rows and the
// "exactly one certificate" check fails. `manage.py seed_school_demo` rebuilds the completions and
// puts it back to one.
console.log('Before re-running: `manage.py seed_school_demo` (this script leaves one withdrawn');
console.log('certificate behind and a completion has no DELETE — house rule 12).');
process.exit(fail ? 1 : 0);
