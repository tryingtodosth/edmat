// WP12 — three edges of school classes, checked where a reader meets them.
//
//   1. the `/courses` hub's "General courses" chip no longer lists a school class. A seeded class is
//      made PUBLIC for the run (the case that matters: a listed class), and the hub is read signed
//      out, in English and Polish, at 1280 and 390: the class is under "All" — so it IS listed, and
//      its absence under "General" is the chip — and a general course and its version land under
//      "General" and "University versions" respectively. `?general=true` says the same.
//   2. a school may not start to RUN a course that is a university version (`course_is_version`) or
//      a general course with versions (`course_has_versions`): the organisations panel on each
//      course page says why, in words, and no link is made. `supports` is not refused.
//   3. the other door into the same state: a body that runs a version may not turn into a school.
//      The seeded school is turned into "Other" for the run, runs the version, and the manage page's
//      "Kind → School" is refused with the word. Put back in a `finally`.
//
// Founding the two scratch courses passes the creation gate, which refuses the (unverified) seeded
// teacher: the gate is lifted, as the seeded staff account, for those two POSTs only and put back in
// a `finally` — the `e2e/school-mode.mjs` arrangement. Every change is undone and re-queried, but
// run it against a database COPY all the same (it flips a switch and an organisation's kind).
//
// The hub is read SIGNED OUT, and anonymous lists come from the 60 s read cache (e2e/CLAUDE.md trap
// 12): a re-run within a minute of the last one is shown the previous run's list, without this
// run's scratch courses, and fails at its first hub check. Wait a minute between runs.
//
// Needs `manage.py seed_school_demo`. Tokens rather than sign-ins (trap 30):
//   E2E_BASE=http://localhost:5213 E2E_API=http://127.0.0.1:8063/api \
//     E2E_TEACHER_TOKEN=<school.teacher's> E2E_STAFF_TOKEN=<kasia's> node e2e/wp12-schools-tidy.mjs
//
// Screenshots land in e2e/screens/wp12-*.png and are meant to be LOOKED at.

import { mkdirSync, readFileSync } from 'node:fs';
import { englishContext } from './english.mjs';

let chromium;
try {
	({ chromium } = await import('playwright'));
} catch {
	({ chromium } = await import('playwright-core'));
}

const BASE = process.env.E2E_BASE ?? 'http://localhost:5213';
const API = process.env.E2E_API ?? 'http://127.0.0.1:8063/api';
const SHOTS = new URL('./screens/', import.meta.url).pathname;
mkdirSync(SHOTS, { recursive: true });
const CATALOGUE = {
	en: JSON.parse(readFileSync(new URL('../messages/en.json', import.meta.url), 'utf8')),
	pl: JSON.parse(readFileSync(new URL('../messages/pl.json', import.meta.url), 'utf8'))
};
const TOKEN_KEY = 'edmat-auth-token';
const DESKTOP = { width: 1280, height: 950 };
const PHONE = { width: 390, height: 844 };
const STAMP = Date.now();

let pass = 0,
	fail = 0;
const check = (label, ok, extra = '') => {
	if (ok) pass++;
	else fail++;
	console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${label} ${ok ? '' : extra}`);
};

async function login(username, password) {
	const r = await fetch(`${API}/auth/login/`, {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify({ username, password })
	});
	if (!r.ok) throw new Error(`login ${username}: ${r.status}`);
	return (await r.json()).token;
}
const teacherToken =
	process.env.E2E_TEACHER_TOKEN ?? (await login('school.teacher', 'persona-pass-2026'));
const staffToken =
	process.env.E2E_STAFF_TOKEN ?? (await login('kasia@edmat.example', 'password123'));

async function api(token, method, path, body) {
	const res = await fetch(`${API}${path}`, {
		method,
		headers: {
			'Content-Type': 'application/json',
			...(token ? { Authorization: `Token ${token}` } : {})
		},
		body: body ? JSON.stringify(body) : undefined
	});
	const text = await res.text();
	let data;
	try {
		data = text ? JSON.parse(text) : null;
	} catch {
		data = text;
	}
	return { status: res.status, data };
}
const setFlag = (key, on) => api(staffToken, 'PATCH', `/feature-flags/${key}/`, { is_enabled: on });

// ---- console discipline -----------------------------------------------------------------------
// The two refusals this script provokes ARE 409 responses, and Chromium logs every non-2xx fetch as
// "Failed to load resource". So that line is not an error here only when a 409 this script expected
// was answered — every other ≥400 response, and every other console error, fails the run.
const errors = [];
const unexpected = [];
let expected409 = 0;
let seen409 = 0;
function watch(page) {
	page.on('pageerror', (e) => errors.push(String(e)));
	page.on('console', (msg) => {
		if (msg.type() !== 'error') return;
		if (/Failed to load resource: the server responded with a status of 409/.test(msg.text()))
			return; // accounted for by the response listener below
		// Trap 26: KaTeX webfonts 403 in a worktree's dev server; matched on the response, not here.
		if (/Failed to load resource: the server responded with a status of 403/.test(msg.text()))
			return;
		errors.push(msg.text());
	});
	page.on('response', (r) => {
		if (r.status() === 409) seen409++;
		else if (r.status() >= 400 && !/katex\/dist\/fonts/.test(r.url()))
			unexpected.push(`${r.status()} ${r.url()}`);
	});
}

async function contextFor(token, { locale = 'en', viewport = DESKTOP } = {}) {
	const ctx =
		locale === 'en'
			? await englishContext(browser, BASE, { viewport })
			: await browser.newContext({ viewport });
	await ctx.addInitScript(
		([key, value]) => {
			try {
				if (value) localStorage.setItem(key, value);
				// Trap 16, signed out: the seeded classes are Polish-language, and an English reader's
				// list would honestly leave them out — which would make "absent under General" vacuous.
				else localStorage.setItem('edmat.contentLocales', '["pl"]');
			} catch {
				/* storage blocked — the checks will say so */
			}
		},
		[TOKEN_KEY, token]
	);
	const page = await ctx.newPage();
	watch(page);
	return { ctx, page };
}

async function open(page, path) {
	const booted = page
		.waitForResponse((r) => r.url().includes('/feature-flags/'), { timeout: 60000 })
		.catch(() => null);
	await page.goto(`${BASE}${path}`, { waitUntil: 'load' });
	await booted;
	await page.locator('h1').first().waitFor({ timeout: 60000 });
}

async function openFold(page, key) {
	const fold = page.locator(`section.fold[data-fold="${key}"]`);
	await fold.waitFor({ timeout: 20000 });
	const toggle = fold.locator('.fold__toggle');
	if ((await toggle.getAttribute('aria-expanded')) !== 'true') await toggle.click();
	await fold.locator('.fold__body > *').first().waitFor({ timeout: 15000 });
	return fold;
}

const shoot = (page, name) => page.screenshot({ path: `${SHOTS}wp12-${name}.png`, fullPage: true });
const overflow = (page) =>
	page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
const card = (page, id) => page.locator(`.grid a.course-card[href$="/courses/${id}"]`);

// ---- the seeded school, found through the API ---------------------------------------------------
const teaching = (await api(teacherToken, 'GET', '/courses/?mine=teaching')).data ?? [];
const klass = teaching.find((row) => row.title.includes('2a') && row.school);
if (!klass) {
	console.error('No seeded class found. Run `manage.py seed_school_demo` on this backend.');
	process.exit(1);
}
const school = klass.school;
console.log(`\nWP12 — class ${klass.id} "${klass.title}", school ${school.slug}`);

const browser = await chromium.launch(
	process.env.CHROME ? { executablePath: process.env.CHROME } : {}
);

const me = await api(teacherToken, 'GET', '/auth/me/');
const savedLocales = me.data?.content_locales ?? [];
let general = null;
let version = null;
let classMadePublic = false;
let schoolKindChanged = false;
const scratchLinks = [];

try {
	await api(teacherToken, 'PATCH', '/auth/me/', { content_locales: ['pl', 'en'] });

	// ---- set-up: a general course and a version under it, both the teacher's --------------------
	const gate = (await api(teacherToken, 'GET', '/creation/')).data ?? {};
	const lifted = gate.course === 'verification_required';
	if (lifted) await setFlag('creation_requires_verification', false);
	try {
		const base = {
			visibility: 'public',
			status: 'open',
			enrollment_policy: 'open',
			audience: 'university',
			language: 'pl'
		};
		const g = await api(teacherToken, 'POST', '/courses/', {
			...base,
			title: `WP12 Mechanika ogólna ${STAMP}`
		});
		general = g.status === 201 ? g.data : null;
		const v = general
			? await api(teacherToken, 'POST', '/courses/', {
					...base,
					title: `WP12 Mechanika na UW ${STAMP}`,
					kind: 'university',
					parent: general.id,
					university: 'Uniwersytet Warszawski',
					faculty: 'Wydział Fizyki'
				})
			: { status: 0 };
		version = v.status === 201 ? v.data : null;
	} finally {
		if (lifted) await setFlag('creation_requires_verification', true);
	}
	check('set-up: a general course and its version exist', Boolean(general && version));
	if (!general || !version) throw new Error('set-up failed');

	// The case the chip has to get right: a class somebody LISTED.
	const pub = await api(teacherToken, 'PATCH', `/courses/${klass.id}/`, { visibility: 'public' });
	classMadePublic = pub.status === 200;
	check('set-up: the class is listed for the run', classMadePublic, `status ${pub.status}`);

	// ---- 1. the hub ------------------------------------------------------------------------------
	console.log('\n1. the hub\'s "General courses" chip');
	const anonGeneral = (await api(null, 'GET', '/courses/?general=true&content_locales=pl')).data;
	const anonAll = (await api(null, 'GET', '/courses/?content_locales=pl')).data;
	check(
		'API: the class is listed at all for a stranger',
		anonAll.some((row) => row.id === klass.id)
	);
	check(
		'API: ?general=true leaves the class out and keeps the general course',
		!anonGeneral.some((row) => row.id === klass.id) &&
			anonGeneral.some((row) => row.id === general.id) &&
			!anonGeneral.some((row) => row.id === version.id)
	);

	for (const [locale, viewport, tag] of [
		['en', DESKTOP, 'en-desktop'],
		['en', PHONE, 'en-phone'],
		['pl', DESKTOP, 'pl-desktop'],
		['pl', PHONE, 'pl-phone']
	]) {
		const { ctx, page } = await contextFor(null, { locale, viewport });
		await open(page, '/courses');
		await card(page, general.id).waitFor({ timeout: 20000 });
		const pressed = page.locator('.kind-chips .chip[aria-pressed="true"]');
		check(
			`${tag}: "${CATALOGUE[locale].course_filter_general}" is the chip that is on`,
			(await pressed.textContent())?.trim() === CATALOGUE[locale].course_filter_general,
			await pressed.textContent()
		);
		check(`${tag}: General lists the general course`, (await card(page, general.id).count()) === 1);
		check(`${tag}: General leaves out the class`, (await card(page, klass.id).count()) === 0);
		check(`${tag}: General leaves out the version`, (await card(page, version.id).count()) === 0);
		check(`${tag}: no horizontal scroll`, (await overflow(page)) <= 0);
		await shoot(page, `hub-general-${tag}`);

		await page
			.locator('.kind-chips .chip', { hasText: CATALOGUE[locale].course_filter_kindAll })
			.click();
		await card(page, klass.id).waitFor({ timeout: 10000 });
		check(
			`${tag}: All lists the class (so General's leaving it out is the chip)`,
			(await card(page, klass.id).count()) === 1
		);
		check(
			`${tag}: the class's card says it is a school class`,
			(await card(page, klass.id).locator('.kind-pill').textContent())?.trim() ===
				CATALOGUE[locale].wp11_courseKindClassBadge
		);
		await page
			.locator('.kind-chips .chip', { hasText: CATALOGUE[locale].course_filter_versions })
			.click();
		await card(page, version.id).waitFor({ timeout: 10000 });
		check(
			`${tag}: University versions lists the version and not the class`,
			(await card(page, version.id).count()) === 1 && (await card(page, klass.id).count()) === 0
		);
		await ctx.close();
	}

	// ---- 2. a school may not start to run a version, nor a general course with versions ---------
	console.log('\n2. the organisations panel refuses with the word');
	for (const [course, word, key, tag, locale, viewport] of [
		[version, 'course_is_version', 'wp12_orgBlockedCourseIsVersion', 'version', 'en', DESKTOP],
		[general, 'course_has_versions', 'wp12_orgBlockedCourseHasVersions', 'general', 'en', DESKTOP],
		[version, 'course_is_version', 'wp12_orgBlockedCourseIsVersion', 'version-pl', 'pl', PHONE]
	]) {
		const { ctx, page } = await contextFor(teacherToken, { locale, viewport });
		await open(page, `/courses/${course.id}`);
		const fold = await openFold(page, 'organizations');
		const form = fold.locator('form.link-form');
		await form.locator('select').first().selectOption({ label: school.name });
		await form.locator('select').nth(1).selectOption('runs');
		expected409++;
		const answered = page.waitForResponse(
			(r) =>
				r.url().includes(`/organizations/${school.id}/links/`) && r.request().method() === 'POST'
		);
		await form.locator('button[type="submit"]').click();
		const response = await answered;
		check(`${tag}: the server answers 409 ${word}`, response.status() === 409);
		const error = form.locator('.error');
		await error.waitFor({ timeout: 10000 });
		check(
			`${tag}: the panel says why, in words (${locale})`,
			(await error.textContent())?.trim() === CATALOGUE[locale][key],
			await error.textContent()
		);
		check(`${tag}: no raw word on screen`, !(await fold.textContent())?.includes(word));
		// The fold clips its overflow, so "no horizontal scroll" cannot see a sentence cut off at the
		// card's edge — which is how the first 390px screenshot of this refusal looked.
		const foldBox = await fold.boundingBox();
		const fits = async (locator) => {
			const box = await locator.boundingBox();
			return Boolean(box && foldBox && box.x + box.width <= foldBox.x + foldBox.width + 0.5);
		};
		check(`${tag}: the sentence fits inside its panel`, await fits(error));
		check(`${tag}: so does the organisation picker`, await fits(form.locator('select').first()));
		check(`${tag}: no horizontal scroll`, (await overflow(page)) <= 0);
		await form.scrollIntoViewIfNeeded();
		await shoot(page, `refused-${word}-${locale}-${viewport.width}`);
		const links = (await api(teacherToken, 'GET', `/nodes/course/${course.id}/organizations/`))
			.data;
		check(
			`${tag}: no link was made`,
			Array.isArray(links) && !links.some((row) => row.organization.id === school.id),
			JSON.stringify(links)
		);
		await ctx.close();
	}

	// `supports` is not the rule's business — the same panel, the same version, accepted.
	{
		const { ctx, page } = await contextFor(teacherToken);
		await open(page, `/courses/${version.id}`);
		const fold = await openFold(page, 'organizations');
		const form = fold.locator('form.link-form');
		await form.locator('select').first().selectOption({ label: school.name });
		await form.locator('select').nth(1).selectOption('supports');
		await form.locator('button[type="submit"]').click();
		await fold.locator('.badges .badge', { hasText: school.name }).waitFor({ timeout: 10000 });
		check('supports: a school may stand behind a version', true);
		check('supports: no error line', (await form.locator('.error').count()) === 0);
		const links = (await api(teacherToken, 'GET', `/nodes/course/${version.id}/organizations/`))
			.data;
		for (const row of links ?? []) scratchLinks.push(row.id);
		const after = (await api(teacherToken, 'GET', `/courses/${version.id}/`)).data;
		check('supports: the version did not become a class', after.school === null);
		await ctx.close();
	}
	for (const id of scratchLinks.splice(0))
		await api(teacherToken, 'DELETE', `/organization-links/${id}/`);

	// ---- 3. a body that runs a version may not become a school ----------------------------------
	console.log('\n3. the other door: turning into a school');
	{
		const toOther = await api(teacherToken, 'PATCH', `/organizations/${school.id}/`, {
			kind: 'other'
		});
		schoolKindChanged = toOther.status === 200;
		check('set-up: the school is "Other" for the run', schoolKindChanged, `${toOther.status}`);
		const runs = await api(teacherToken, 'POST', `/organizations/${school.id}/links/`, {
			node_kind: 'course',
			node_id: Number(version.id),
			kind: 'runs'
		});
		check('set-up: an ordinary body may run the version', runs.status === 201, `${runs.status}`);
		if (runs.status === 201) scratchLinks.push(runs.data.id);

		const { ctx, page } = await contextFor(teacherToken);
		await open(page, `/organizations/${school.slug}/manage`);
		const formKind = page.locator('form.edit-form select').first();
		await formKind.waitFor({ timeout: 20000 });
		await formKind.selectOption('school');
		expected409++;
		const answered = page.waitForResponse(
			(r) => r.url().includes(`/organizations/${school.id}/`) && r.request().method() === 'PATCH'
		);
		await page.locator('form.edit-form button[type="submit"]').click();
		const response = await answered;
		check('kind → school: the server answers 409 course_is_version', response.status() === 409);
		const error = page.locator('.error[role="alert"]').first();
		await error.waitFor({ timeout: 10000 });
		check(
			'kind → school: the manage page says why, in words',
			(await error.textContent())?.trim() === CATALOGUE.en.wp12_orgBlockedCourseIsVersion,
			await error.textContent()
		);
		await shoot(page, 'refused-kind-change-en-1280');
		const now = (await api(teacherToken, 'GET', `/organizations/${school.id}/`)).data;
		check('kind → school: the body is still "Other"', now.kind === 'other', now.kind);
		await ctx.close();
	}
} catch (err) {
	check('the run completed', false, String(err));
} finally {
	// ---- put everything back, and confirm it AUTHENTICATED (trap 12) ----------------------------
	for (const id of scratchLinks) await api(teacherToken, 'DELETE', `/organization-links/${id}/`);
	if (schoolKindChanged) {
		const back = await api(teacherToken, 'PATCH', `/organizations/${school.id}/`, {
			kind: 'school'
		});
		check('cleanup: the school is a school again', back.status === 200, `${back.status}`);
	}
	if (classMadePublic)
		await api(teacherToken, 'PATCH', `/courses/${klass.id}/`, { visibility: 'private' });
	if (version) await api(teacherToken, 'DELETE', `/courses/${version.id}/`);
	if (general) await api(teacherToken, 'DELETE', `/courses/${general.id}/`);
	await api(teacherToken, 'PATCH', '/auth/me/', { content_locales: savedLocales });
	await browser.close();
}

const after = (await api(teacherToken, 'GET', `/courses/${klass.id}/`)).data;
check(
	'cleanup: the class is private and a class again',
	after?.visibility === 'private' && after?.school?.slug === school.slug,
	JSON.stringify({ visibility: after?.visibility, school: after?.school })
);
for (const row of [general, version].filter(Boolean)) {
	const gone = await api(teacherToken, 'GET', `/courses/${row.id}/`);
	check(`cleanup: scratch course ${row.id} removed`, gone.status === 404, `${gone.status}`);
}
const gateNow = (await api(teacherToken, 'GET', '/creation/')).data ?? {};
check(
	'cleanup: the creation gate is as it was',
	gateNow.course === 'verification_required' || gateNow.course === null,
	JSON.stringify(gateNow)
);
check(
	`exactly the ${expected409} refusals provoked answered 409`,
	seen409 === expected409,
	`${seen409} seen`
);
check('no other failed request', unexpected.length === 0, unexpected.join(' | ').slice(0, 400));
check('zero console/page errors', errors.length === 0, errors.join(' | ').slice(0, 400));

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
