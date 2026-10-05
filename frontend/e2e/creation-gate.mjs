// The creation gate (learning step F, prompts/07-creation-gate.md): until the USOS connection
// exists, FOUNDING a course, an event, a tutoring listing or an organisation is for staff and
// verified contributors — and a refused account must never be shown the button it would be refused
// at (house rule 3).
//
// What this drives, as a real browser against both real servers:
//
//   1. `GET /api/creation/` answers the three words for the three personas the demo seed already
//      has: ola (ordinary), michal (verified contributor), kasia (staff), plus a signed-out reader.
//   2. As ola: the Add… menu holds no "New event" and no "New listing"; the four hubs draw the
//      sentence instead of their create control; `/courses/new` typed in directly explains itself
//      and shows no form; the sentence links to `/levels`.
//   3. As kasia: every one of those controls is there and no sentence is drawn anywhere.
//   4. Flipping `creation_requires_verification` OFF (as kasia, through the real API) gives ola
//      every control back — the day USOS lands is one switch, not a deploy.
//   5. With the gate on AND the two submission switches off, the Add… TRIGGER itself disappears:
//      an empty menu invites a click and explains nothing (`hasAnythingToAdd`).
//
// Absence is asserted only after something POSITIVE has arrived on the same page (e2e/CLAUDE.md
// trap 8: a vacuous pass is a real risk) — for ola the gate sentence is that signal, for kasia the
// create control itself is.
//
// Run (the ports are learning step F's own; clear the file cache first — the login throttle lives
// in it, trap 1):
//   rm -rf backend/cachedata/*
//   E2E_BASE=http://localhost:5236 E2E_API=http://127.0.0.1:8136/api node e2e/creation-gate.mjs
//
// Screenshots land in e2e/screens/gate-*.png and are meant to be LOOKED at.

import { mkdirSync } from 'node:fs';
import { englishContext } from './english.mjs';

let chromium;
try {
	({ chromium } = await import('playwright'));
} catch {
	({ chromium } = await import('playwright-core'));
}

const BASE = process.env.E2E_BASE ?? 'http://localhost:5236';
const API = process.env.E2E_API ?? 'http://127.0.0.1:8136/api';
const PASSWORD = 'password123';
const ORDINARY = 'ola@edmat.example'; // is_verified_contributor=False, is_staff=False
const VERIFIED = 'michal@edmat.example'; // is_verified_contributor=True
const STAFF = 'kasia@edmat.example'; // is_staff=True (and verified)
const KINDS = ['course', 'event', 'service', 'organization'];
const SHOTS = new URL('./screens/', import.meta.url).pathname;
mkdirSync(SHOTS, { recursive: true });

let pass = 0,
	fail = 0;
const check = (label, ok, detail = '') => {
	if (ok) pass++;
	else fail++;
	console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${label}${ok ? '' : ' — ' + detail}`);
};

async function tokenFor(email) {
	const response = await fetch(`${API}/auth/login/`, {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify({ username: email, password: PASSWORD })
	});
	if (!response.ok) throw new Error(`login ${email}: ${response.status}`);
	return (await response.json()).token;
}

async function creationStatus(token) {
	const response = await fetch(`${API}/creation/`, {
		headers: token ? { Authorization: `Token ${token}` } : {}
	});
	if (!response.ok) throw new Error(`creation status: ${response.status}`);
	return response.json();
}

async function setFlag(token, key, isEnabled) {
	const response = await fetch(`${API}/feature-flags/${key}/`, {
		method: 'PATCH',
		headers: { 'Content-Type': 'application/json', Authorization: `Token ${token}` },
		body: JSON.stringify({ is_enabled: isEnabled })
	});
	if (!response.ok) throw new Error(`flag ${key}=${isEnabled}: ${response.status}`);
}

const everyKind = (status, expected) => KINDS.every((kind) => status[kind] === expected);

const browser = await chromium.launch(
	process.env.CHROME ? { executablePath: process.env.CHROME } : {}
);
const DESKTOP = { width: 1280, height: 950 };

const errors = [];
function watch(page) {
	page.on('pageerror', (e) => errors.push(String(e)));
	page.on('console', (msg) => {
		if (msg.type() === 'error') errors.push(msg.text());
	});
}

/** A signed-in English context. The identifier field takes an email OR a username and is
 *  `type="text"` since the guardian accounts (trap 13), so it is found by its autocomplete.
 *
 *  **The submit is retried**, because trap 25 is real and it bit this script on the first run: the
 *  form is in the server-rendered HTML, so filling and clicking it before the bundle has hydrated
 *  performs a NATIVE form submission — the browser lands on `/login?` with the fields cleared and
 *  nothing has happened. Waiting for the layout's own boot request is necessary but on a cold Vite
 *  dev server not sufficient, so a failed attempt is simply made again rather than believed. */
async function signedIn(email) {
	const ctx = await englishContext(browser, BASE, { viewport: DESKTOP });
	const page = await ctx.newPage();
	watch(page);
	const booted = page
		.waitForResponse((r) => r.url().includes('/feature-flags/'), { timeout: 25000 })
		.catch(() => {});
	await page.goto(`${BASE}/login`, { waitUntil: 'load' });
	await booted;

	for (let attempt = 1; attempt <= 3; attempt++) {
		await page.waitForTimeout(2000);
		await page.locator('form input[autocomplete="username"]').fill(email);
		await page.locator('form input[type="password"]').fill(PASSWORD);
		await page.locator('form button[type="submit"]').click();
		try {
			await page.waitForURL((u) => !u.pathname.includes('/login'), { timeout: 12000 });
			return { ctx, page };
		} catch {
			if (attempt === 3) throw new Error(`sign-in as ${email} never left /login`);
			// A native submit leaves `?` on the address; come back to a clean one and try again.
			await page.goto(`${BASE}/login`, { waitUntil: 'load' });
		}
	}
	return { ctx, page };
}

/** Opens the Add… popover and returns how many of the two gated entries it holds. `null` means the
 *  trigger itself was not there. */
async function addMenuEntries(page) {
	// The header's own boot requests, registered BEFORE the navigation (trap 25 — a listener armed
	// after `goto` can miss them). Every flag-gated entry waits on the first and every gated one on
	// the second, so both have to have landed before an absence means anything.
	const booted = page
		.waitForResponse((r) => r.url().includes('/feature-flags/'), { timeout: 20000 })
		.catch(() => {});
	const gated = page
		.waitForResponse((r) => r.url().includes('/creation/'), { timeout: 20000 })
		.catch(() => {});
	await page.goto(`${BASE}/`, { waitUntil: 'load' });
	await booted;
	await gated;
	const trigger = page.locator('.add-trigger');
	if ((await trigger.count()) === 0) return null;
	await trigger.click();
	const menu = page.locator('a.menu-item');
	await menu
		.first()
		.waitFor({ timeout: 10000 })
		.catch(() => {});
	return {
		items: await menu.count(),
		event: await page.locator('a.menu-item[href$="/events/new"]').count(),
		// `/tutoring/new` renders as `/korki/new` for a Polish reader; this context is English, but
		// both are matched so the check cannot pass vacuously if the address changes.
		service: await page
			.locator('a.menu-item[href$="/tutoring/new"], a.menu-item[href$="/korki/new"]')
			.count()
	};
}

/** Walks the four hubs and reports, per hub, whether the create control and the gate sentence are
 *  there. `wait` is the thing to wait for first, so no count is taken before the page settled. */
const HUBS = [
	{ kind: 'course', path: '/courses', create: 'a[href$="/courses/new"]' },
	{ kind: 'event', path: '/events', create: 'a[href$="/events/new"]' },
	{ kind: 'service', path: '/tutoring', create: 'button.new-listing' },
	{ kind: 'organization', path: '/organizations', create: 'a[href$="/organizations/new"]' }
];

async function hubState(page, hub, waitFor) {
	await page.goto(`${BASE}${hub.path}`, { waitUntil: 'load' });
	const note = page.locator(`[data-creation-gate="${hub.kind}"]`);
	const create = page.locator(hub.create);
	await (waitFor === 'note' ? note : create)
		.first()
		.waitFor({ timeout: 15000 })
		.catch(() => {});
	return {
		note: await note.count(),
		reason: (await note.count())
			? await note.first().getAttribute('data-creation-gate-reason')
			: null,
		create: await create.count(),
		levelsLink: await note.locator('a[href$="/levels"]').count()
	};
}

try {
	// ---- 1. The endpoint, for four callers ------------------------------------------------------
	console.log('\n1. GET /api/creation/');
	const staffToken = await tokenFor(STAFF);
	const ordinaryToken = await tokenFor(ORDINARY);
	const verifiedToken = await tokenFor(VERIFIED);

	const anon = await creationStatus(null);
	check(
		'signed out: every kind is "anonymous"',
		everyKind(anon, 'anonymous'),
		JSON.stringify(anon)
	);
	const ola = await creationStatus(ordinaryToken);
	check(
		'ola (ordinary): every kind is "verification_required"',
		everyKind(ola, 'verification_required'),
		JSON.stringify(ola)
	);
	const michal = await creationStatus(verifiedToken);
	check(
		'michal (verified contributor): every kind is null',
		everyKind(michal, null),
		JSON.stringify(michal)
	);
	const kasia = await creationStatus(staffToken);
	check('kasia (staff): every kind is null', everyKind(kasia, null), JSON.stringify(kasia));
	check(
		'the body carries exactly the four kinds',
		JSON.stringify(Object.keys(ola).sort()) ===
			JSON.stringify(['course', 'event', 'organization', 'service']),
		Object.keys(ola).join(',')
	);

	// ---- 2. As an ordinary account ---------------------------------------------------------------
	console.log('\n2. ola, refused — the buttons are gone and the page says why');
	{
		const { ctx, page } = await signedIn(ORDINARY);

		const menu = await addMenuEntries(page);
		check('Add… trigger is still there (exercises and materials remain)', menu !== null);
		if (menu) {
			check('Add…: no "New event"', menu.event === 0, `found ${menu.event}`);
			check('Add…: no "New listing"', menu.service === 0, `found ${menu.service}`);
			check('Add…: something else is still in it', menu.items > 0, `items ${menu.items}`);
		}
		await page.screenshot({ path: `${SHOTS}gate-ola-add-menu.png` });

		for (const hub of HUBS) {
			const state = await hubState(page, hub, 'note');
			check(`${hub.path}: the sentence is drawn`, state.note === 1, `notes ${state.note}`);
			check(
				`${hub.path}: it is the verification sentence`,
				state.reason === 'verification_required',
				String(state.reason)
			);
			check(`${hub.path}: no create control`, state.create === 0, `found ${state.create}`);
			check(`${hub.path}: the sentence links to /levels`, state.levelsLink >= 1);
			await page.screenshot({ path: `${SHOTS}gate-ola-hub-${hub.kind}.png`, fullPage: true });
		}

		// `/courses/new` typed in directly: the refusal, not a form that would 403 on submit.
		await page.goto(`${BASE}/courses/new`, { waitUntil: 'load' });
		await page
			.locator('[data-creation-gate="course"]')
			.waitFor({ timeout: 15000 })
			.catch(() => {});
		check(
			'/courses/new: the reason is on the page',
			(await page.locator('[data-creation-gate="course"]').count()) === 1
		);
		check('/courses/new: no form', (await page.locator('form').count()) === 0);
		check(
			'/courses/new: the reason links to /levels',
			(await page.locator('[data-creation-gate="course"] a[href$="/levels"]').count()) === 1
		);
		await page.screenshot({ path: `${SHOTS}gate-ola-courses-new.png`, fullPage: true });
		await ctx.close();
	}

	// ---- 3. As staff ----------------------------------------------------------------------------
	console.log('\n3. kasia, staff — everything is there, and nothing explains itself');
	{
		const { ctx, page } = await signedIn(STAFF);
		const menu = await addMenuEntries(page);
		check('Add…: "New event" is there', menu !== null && menu.event === 1);
		check('Add…: "New listing" is there', menu !== null && menu.service === 1);
		await page.screenshot({ path: `${SHOTS}gate-kasia-add-menu.png` });

		for (const hub of HUBS) {
			const state = await hubState(page, hub, 'create');
			check(`${hub.path}: the create control is there`, state.create >= 1, `found ${state.create}`);
			check(`${hub.path}: no sentence`, state.note === 0, `notes ${state.note}`);
		}
		await page.screenshot({ path: `${SHOTS}gate-kasia-hub-last.png`, fullPage: true });
		await ctx.close();
	}

	// ---- 4. The switch ---------------------------------------------------------------------------
	console.log('\n4. the flag off — ola gets everything back');
	await setFlag(staffToken, 'creation_requires_verification', false);
	try {
		const back = await creationStatus(ordinaryToken);
		check('API: every kind is null again', everyKind(back, null), JSON.stringify(back));

		const { ctx, page } = await signedIn(ORDINARY);
		const menu = await addMenuEntries(page);
		check('Add…: "New event" is back', menu !== null && menu.event === 1);
		check('Add…: "New listing" is back', menu !== null && menu.service === 1);

		for (const hub of HUBS) {
			const state = await hubState(page, hub, 'create');
			check(`${hub.path}: the create control is back`, state.create >= 1, `found ${state.create}`);
			check(`${hub.path}: the sentence is gone`, state.note === 0, `notes ${state.note}`);
		}

		await page.goto(`${BASE}/courses/new`, { waitUntil: 'load' });
		await page
			.locator('form')
			.first()
			.waitFor({ timeout: 15000 })
			.catch(() => {});
		check('/courses/new: the form is there', (await page.locator('form').count()) >= 1);
		check(
			'/courses/new: no sentence',
			(await page.locator('[data-creation-gate="course"]').count()) === 0
		);
		await page.screenshot({ path: `${SHOTS}gate-ola-flag-off-courses-new.png`, fullPage: true });
		await ctx.close();
	} finally {
		await setFlag(staffToken, 'creation_requires_verification', true);
	}

	// ---- 5. An empty menu is worse than no menu --------------------------------------------------
	console.log('\n5. nothing left to add — the trigger itself goes');
	await setFlag(staffToken, 'exercise_submissions', false);
	await setFlag(staffToken, 'material_submissions', false);
	try {
		const { ctx, page } = await signedIn(ORDINARY);
		// Positive signal first: the gate's own sentence proves `GET /api/creation/` landed, so the
		// absence below is a real absence rather than a page that had not finished booting.
		const state = await hubState(page, HUBS[0], 'note');
		check('the gate is on again (the sentence is back)', state.note === 1);
		const menu = await addMenuEntries(page);
		check('Add… trigger is gone entirely', menu === null, menu ? JSON.stringify(menu) : '');
		await page.screenshot({ path: `${SHOTS}gate-ola-nothing-to-add.png` });
		await ctx.close();
	} finally {
		await setFlag(staffToken, 'exercise_submissions', true);
		await setFlag(staffToken, 'material_submissions', true);
	}

	// ---- 6. Nothing was left flipped -------------------------------------------------------------
	console.log('\n6. the switches are back where they were');
	const after = await creationStatus(ordinaryToken);
	check(
		'creation_requires_verification is on again',
		everyKind(after, 'verification_required'),
		JSON.stringify(after)
	);
	const flags = await (
		await fetch(`${API}/feature-flags/`, { headers: { Authorization: `Token ${staffToken}` } })
	).json();
	const on = (key) => flags.find((f) => f.key === key)?.is_enabled === true;
	check('exercise_submissions is on again', on('exercise_submissions'));
	check('material_submissions is on again', on('material_submissions'));
} finally {
	await browser.close();
}

check('zero console/page errors', errors.length === 0, errors.join(' | ').slice(0, 400));

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
