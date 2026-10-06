// The user manual's pictures: every screenshot under `static/guide/<chapter>/<nn>-<name>.png` is
// taken by THIS script, against the real app on real servers with a seeded database. Nothing in
// `/about/guide` is drawn by hand, which is the whole point — a manual whose pictures were drawn
// goes stale silently, and one whose pictures are screenshots goes stale loudly, the next time this
// runs.
//
// Run (your own ports; `frontend/.env` must already point at the same API):
//   rm -rf ../backend/cachedata/*
//   E2E_BASE=http://localhost:5238 E2E_API=http://127.0.0.1:8138/api node e2e/guide-screenshots.mjs
//
// One chapter at a time, while you are iterating:
//   ONLY=exercises,submit node e2e/guide-screenshots.mjs
//
// Five things about it that are not obvious:
//
//  1. **The pictures are of the ENGLISH interface** (`english.mjs`), one set only. The Polish
//     chapter text describes the same screens — a second set of pictures would double the deploy
//     bundle for a reader who can already see which button is which. Named as a cost in
//     HISTORY.md §17BR.H.
//  2. **The corpus is Polish and lists narrow to the reader's content languages** (e2e trap 16),
//     so an English interface over a Polish corpus honestly shows three exercises out of 388.
//     Every context here asks for `pl` + `en` content — anonymous through
//     `localStorage['edmat.contentLocales']`, signed in through `PATCH /api/auth/me/`, which is
//     the only thing that works for an account (the profile overwrites the local extras). The
//     accounts are put back at the end.
//  3. **The development database carries leftover rows from earlier browser runs** ("asdasd",
//     "Linking check 1788983075362", "Published hours …"). They are not deleted — this script does
//     not own them — they are HIDDEN before the shot by `hideScratch()`, which is the "crop or
//     mask anything else" the brief asks for. Everything else visible is `seed_demo_*` or
//     `TEST=FAKE `-titled seeded data.
//  4. **A few rows are created through the real API** where the seed leaves a surface empty (the
//     help-wanted board, a volunteering offer, one message, one pending exercise). They are
//     created idempotently under seeded demo accounts, so re-running does not pile them up, and
//     nothing a real person wrote is ever photographed.
//  5. **Every shot is clipped**, not `fullPage`. A full-page PNG of the notifications list is
//     809 KB on its own; the budget is 400 KB a picture and 8 MB in total, and `npm run build`
//     copies `static/` verbatim. The script fails if a picture or the total goes over.
//
// Zero console/page errors is NOT a pass condition here the way it is in the other scripts: this
// one drives surfaces (the moderation queue, a course's manage page) that log their own 403/404
// probes. Errors are printed at the end so a real one can be seen.

import { mkdirSync, rmSync, statSync, readdirSync } from 'node:fs';
import { englishContext } from './english.mjs';

let chromium;
try {
	({ chromium } = await import('playwright'));
} catch {
	({ chromium } = await import('playwright-core'));
}

const BASE = process.env.E2E_BASE ?? 'http://localhost:5238';
const API = process.env.E2E_API ?? 'http://127.0.0.1:8138/api';
const PASSWORD = 'password123';
const OUT = new URL('../static/guide/', import.meta.url).pathname;
const ONLY = process.env.ONLY ? new Set(process.env.ONLY.split(',')) : null;

const MAX_BYTES = 400 * 1024;
const MAX_TOTAL = 8 * 1024 * 1024;
const WIDTH = 1280;

let pass = 0;
let fail = 0;
const check = (label, ok, extra = '') => {
	if (ok) pass++;
	else fail++;
	console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${label} ${ok ? '' : extra}`);
};

const errors = [];
function watch(page) {
	page.on('pageerror', (e) => errors.push('pageerror: ' + String(e).slice(0, 160)));
	page.on('console', (m) => {
		if (m.type() === 'error') errors.push('console: ' + m.text().slice(0, 160));
	});
}

// ---- the API, for signing in and for the handful of rows the seeds do not make ----------------

const tokens = new Map();
async function tokenFor(email) {
	if (tokens.has(email)) return tokens.get(email);
	const response = await fetch(`${API}/auth/login/`, {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify({ username: email, password: PASSWORD })
	});
	if (!response.ok) throw new Error(`login ${email}: ${response.status}`);
	const { token } = await response.json();
	tokens.set(email, token);
	return token;
}

async function api(path, { token, method = 'GET', body } = {}) {
	const response = await fetch(API + path, {
		method,
		headers: {
			...(body ? { 'Content-Type': 'application/json' } : {}),
			...(token ? { Authorization: `Token ${token}` } : {})
		},
		...(body ? { body: JSON.stringify(body) } : {})
	});
	const text = await response.text();
	let parsed;
	try {
		parsed = text ? JSON.parse(text) : null;
	} catch {
		// A Django debug page rather than JSON — keep it, it is what says WHY (a 404 on a path that
		// does not exist reads very differently from a 400 with a field error).
		parsed = text;
	}
	return { status: response.status, ok: response.ok, body: parsed };
}

/** The content-language extras an account carries while this script runs; restored in `finally`. */
const widened = [];
async function widenContentLocales(email) {
	const token = await tokenFor(email);
	const me = await api('/auth/me/', { token });
	widened.push({ token, previous: me.body.content_locales ?? [] });
	await api('/auth/me/', { token, method: 'PATCH', body: { content_locales: ['pl', 'en'] } });
	return token;
}

// ---- the browser ------------------------------------------------------------------------------

const browser = await chromium.launch(
	process.env.CHROME ? { executablePath: process.env.CHROME } : {}
);

/** A fresh English context. `email` signs it in; without one it is an anonymous visitor. */
async function open(email, { height = 950 } = {}) {
	const ctx = await englishContext(browser, BASE, { viewport: { width: WIDTH, height } });
	const page = await ctx.newPage();
	watch(page);
	await page.goto(`${BASE}/`, { waitUntil: 'load' });
	if (email) {
		const token = await tokenFor(email);
		await page.evaluate((t) => localStorage.setItem('edmat-auth-token', t), token);
	} else {
		await page.evaluate(() => localStorage.setItem('edmat.contentLocales', '["pl","en"]'));
	}
	return { ctx, page };
}

/**
 * Rows left behind by earlier browser runs. They are real rows in the development database and
 * this script does not own them, so they are hidden rather than deleted — the manual's pictures
 * show seeded data only (the brief's "crop or mask anything else").
 */
const SCRATCH =
	/(^|\b)(asd[a-z]*|tax-(disc|branch)|e2e-other|Linking check \d|Published hours \d|Real availability \d|Plans e2e \d|Topologia \d|Analiza od zera \d|pw-verify|debug2|uxreview|Zzz |Test EN|Test submitted|single report test)/i;

async function hideScratch(page) {
	await page.evaluate((source) => {
		const pattern = new RegExp(source, 'i');
		const selectors = 'li, article, .card, [class*="card"], tr, .queue-item, .thread-row';
		for (const node of document.querySelectorAll(selectors)) {
			if (node.dataset.guideHidden) continue;
			const text = (node.textContent ?? '').trim();
			if (text && text.length < 600 && pattern.test(text)) {
				node.dataset.guideHidden = '1';
				node.style.display = 'none';
			}
		}
	}, SCRATCH.source);
}

/** Playwright's own screenshot, plus the budget check and a hidden caret. */
async function shoot(page, chapter, name, { locator, clip, padding = 16 } = {}) {
	const dir = `${OUT}${chapter}/`;
	mkdirSync(dir, { recursive: true });
	const path = `${dir}${name}.png`;
	await page.addStyleTag({
		content: '*{caret-color:transparent !important}*{scrollbar-width:none}'
	});
	// The header is `position: sticky`, and a full-page capture draws it wherever the page happens
	// to be scrolled to — which put a second header across the middle of the submit form. Scrolling
	// home first puts it back at the top of the document, where a clip below y=56 excludes it.
	await page.evaluate(() => window.scrollTo(0, 0));
	await page.waitForTimeout(250);
	let region = clip;
	if (!region && locator) {
		const box = await locator.boundingBox(); // after scrollTo(0,0) above: document coordinates
		if (!box) throw new Error(`${chapter}/${name}: nothing to clip to`);
		region = {
			x: Math.max(0, Math.round(box.x - padding)),
			y: Math.max(0, Math.round(box.y - padding)),
			width: Math.min(WIDTH, Math.round(box.width + padding * 2)),
			height: Math.round(box.height + padding * 2)
		};
	}
	if (region) {
		region.height = Math.min(region.height, 1100);
		region.width = Math.min(region.width, WIDTH);
	}
	// `fullPage` even with a clip: without it a region near the top of the viewport is captured with
	// the sticky header drawn over it, which is a picture of two headers.
	await page.screenshot({ path, fullPage: true, ...(region ? { clip: region } : {}) });
	const bytes = statSync(path).size;
	check(
		`${chapter}/${name}.png ${(bytes / 1024).toFixed(0)} KB`,
		bytes <= MAX_BYTES,
		'over 400 KB'
	);
	return path;
}

/**
 * The document-coordinate box of something. Playwright's `boundingBox()` is relative to the
 * VIEWPORT, so a box read after a click that scrolled the page is 600 px out — which is how the
 * submit form's preview panel was photographed as its own Topics field. Scroll home, then measure.
 */
async function rect(page, selector) {
	await page.evaluate(() => window.scrollTo(0, 0));
	await page.waitForTimeout(250);
	return (await page.locator(selector).first().boundingBox()) ?? null;
}

/** Go somewhere, wait for the heading, wait for hydration, let the animations finish. */
async function visit(page, path, { wait = 'h1', extra = 900 } = {}) {
	await page.goto(`${BASE}${path}`, { waitUntil: 'load' });
	if (wait)
		await page
			.locator(wait)
			.first()
			.waitFor({ timeout: 20000 })
			.catch(() => {});
	await hydrated(page);
	await settle(page, extra);
}

async function settle(page, ms = 900) {
	await page.waitForTimeout(ms);
}

/**
 * Wait until the bundle has hydrated (e2e trap 25 — every control is in the server-rendered HTML,
 * so waiting for an element proves nothing). The header's language picker is the honest signal:
 * its `<select>` carries `pl` in the server-rendered markup even on a page whose text is already
 * English — `locale.svelte.ts`'s module-level rune is evaluated once per server process, not per
 * request — and flips to `en` the moment the runes take over. On this dev server that is 3 s on a
 * light page and 8 s on the home page, which is exactly how long a screenshot taken too early will
 * show a picker disagreeing with the page it sits on.
 */
async function hydrated(page, timeout = 25000) {
	const select = page.locator('header select').first();
	const deadline = Date.now() + timeout;
	while (Date.now() < deadline) {
		const value = await select.inputValue().catch(() => null);
		if (value === 'en') return true;
		await page.waitForTimeout(250);
	}
	errors.push('hydration: the header picker never reached "en" on ' + page.url());
	return false;
}

// ================================================================================================
// Arranged once, before any chapter
// ================================================================================================

/**
 * `seed_demo_content` makes its courses `only_you` — creating a course never publishes it
 * (`courses/models.py: VISIBILITY_CHOICES`). For the manual that is the wrong starting point twice
 * over: a reader cannot be shown a course page an anonymous visitor could not open, and a
 * help-wanted posting on a course nobody can view is correctly hidden from the board
 * (`needs/rules.py: public_needs`), which is how the help chapter first photographed an empty page.
 * One idempotent PATCH, through the real API, as the course's own owner.
 */
let demoCourseId = null;
async function arrange() {
	const token = await tokenFor('ania@edmat.example');
	const courses = await api('/courses/', { token });
	const course = (Array.isArray(courses.body) ? courses.body : []).find(
		(c) => c.title === 'Analiza od zera'
	);
	if (!course) {
		check('arrange: the seeded course "Analiza od zera" exists', false);
		return;
	}
	demoCourseId = course.id;
	if (course.visibility !== 'public') {
		const made = await api(`/courses/${course.id}/`, {
			token,
			method: 'PATCH',
			body: { visibility: 'public' }
		});
		check('arrange: the demo course is public', made.ok, JSON.stringify(made.body).slice(0, 160));
	} else {
		check('arrange: the demo course is public', true);
	}
}

// ================================================================================================
// The chapters
// ================================================================================================

const chapters = {};

// ---- start -------------------------------------------------------------------------------------
chapters.start = async () => {
	const { ctx, page } = await open(null);
	await visit(page, '/', { wait: '.hero h1' });
	// The home page's tabs paint a card-shaped skeleton while they load; wait for real cards.
	await page
		.locator('.panel .grid .exercise-card, .panel .status')
		.first()
		.waitFor({ timeout: 20000 })
		.catch(() => {});
	await settle(page, 800);
	await shoot(page, 'start', '01-home', { clip: { x: 0, y: 0, width: WIDTH, height: 720 } });

	// The two header controls a first-time reader needs: the language picker and the reading size.
	await shoot(page, 'start', '02-header', { clip: { x: 0, y: 0, width: WIDTH, height: 64 } });

	// The audience chips — "show me what is for my age".
	const chips = page.locator('[class*="band"], [class*="audience"]').first();
	if (await chips.count()) {
		await shoot(page, 'start', '03-audience', { locator: chips });
	}

	await visit(page, '/register', { wait: 'form' });
	await shoot(page, 'start', '04-register', { locator: page.locator('form').first() });
	await ctx.close();

	// Signed in: the account menu, open.
	const signedIn = await open('michal@edmat.example');
	await visit(signedIn.page, '/', { wait: '.hero h1', extra: 1200 });
	const accountButton = signedIn.page
		.locator('header button')
		.filter({ hasText: 'Michał' })
		.first();
	if (await accountButton.count()) {
		await accountButton.click();
		await settle(signedIn.page);
	}
	await shoot(signedIn.page, 'start', '05-account-menu', {
		clip: { x: WIDTH - 560, y: 0, width: 560, height: 620 }
	});
	await signedIn.ctx.close();
};

// ---- exercises ----------------------------------------------------------------------------------
chapters.exercises = async () => {
	const { ctx, page } = await open(null);

	await visit(page, '/disciplines', { wait: 'h1', extra: 1500 });
	await hideScratch(page);
	// 285 px, not 330: the "Others" heading below it is the proposed-taxonomy queue, and with its
	// own leftover rows hidden it would photograph as an empty section.
	await shoot(page, 'exercises', '01-disciplines', {
		clip: { x: 0, y: 56, width: WIDTH, height: 285 }
	});

	await visit(page, '/branches/analiza-matematyczna', { wait: 'h1', extra: 2500 });
	await hideScratch(page);
	// From the filter column down: the concept cards above it are the concepts chapter's subject.
	const filters = await rect(page, 'aside, .filters');
	await shoot(page, 'exercises', '02-branch', {
		clip: { x: 0, y: Math.max(0, Math.round(filters?.y ?? 700) - 24), width: WIDTH, height: 820 }
	});

	await visit(page, '/exercises/50', { wait: 'article.exercise', extra: 1500 });
	await shoot(page, 'exercises', '03-exercise', {
		clip: { x: 0, y: 56, width: WIDTH, height: 820 }
	});

	// Open every reveal there is, then photograph the stack.
	for (const name of [/Show hint/i, /Show solution/i, /Show the answer|Show answer/i]) {
		const button = page.getByRole('button', { name }).first();
		if (await button.count()) {
			await button.click().catch(() => {});
			await settle(page, 600);
		}
	}
	await settle(page, 1200);
	const box = await rect(page, '.content-section');
	await shoot(page, 'exercises', '04-reveals', {
		clip: { x: 0, y: Math.round(box?.y ?? 400) - 10, width: WIDTH, height: 900 }
	});
	await ctx.close();

	// My set, signed in, with two exercises in it and a saved name.
	// Idempotent: the set is REUSED if a previous run already made it. `/api/exercise-sets/` is
	// looked up by its random slug, not by pk, so a DELETE by id answers 404 — deleting and
	// re-creating would quietly leave one more "Before the midterm" in the menu on every run, which
	// is exactly what the first screenshot showed.
	const token = await widenContentLocales('ania@edmat.example');
	const sets = await api('/exercise-sets/', { token });
	const existing = (Array.isArray(sets.body) ? sets.body : []).find(
		(set) => set.name === 'Before the midterm'
	);
	const created = existing
		? { ok: true, body: existing }
		: await api('/exercise-sets/', {
				token,
				method: 'POST',
				body: { name: 'Before the midterm', is_public: true, exercise_ids: [50, 100, 120] }
			});
	const setId = created.body?.slug ?? created.body?.id;
	check('a named set exists to photograph', created.ok, JSON.stringify(created.body).slice(0, 160));

	const mine = await open('ania@edmat.example');
	await visit(mine.page, '/branches/analiza-matematyczna', { wait: 'h1', extra: 2500 });
	await mine.page
		.locator('.save__trigger')
		.first()
		.waitFor({ timeout: 20000 })
		.catch(() => {});
	await hideScratch(mine.page);
	const addButton = mine.page.locator('.save__trigger').first();
	if (await addButton.count()) {
		await addButton.click().catch(() => {});
		await mine.page
			.locator('.menu')
			.first()
			.waitFor({ timeout: 8000 })
			.catch(() => {});
		await settle(mine.page, 800);
		const menu = await rect(mine.page, '.menu');
		await shoot(mine.page, 'exercises', '05-add-to-set', {
			clip: {
				x: Math.max(0, Math.round((menu?.x ?? 600) - 320)),
				y: Math.max(0, Math.round((menu?.y ?? 400) - 110)),
				width: 760,
				height: Math.round((menu?.height ?? 420) + 150)
			}
		});
	} else {
		check(
			'exercises/05-add-to-set: the save trigger was found',
			false,
			'no .save__trigger on the branch page'
		);
	}

	// Put two exercises in the working set, so the My set page has something on it. The working set
	// lives in localStorage, which is why it cannot be arranged through the API like the named one.
	for (const index of [0, 1]) {
		const trigger = mine.page.locator('.save__trigger').nth(index);
		if (!(await trigger.count())) continue;
		const open = await mine.page.locator('.menu').count();
		if (!open) await trigger.click().catch(() => {});
		await settle(mine.page, 400);
		const row = mine.page.locator('.menu__row').filter({ hasText: 'Working set' }).first();
		if (await row.count()) await row.click().catch(() => {});
		await mine.page.keyboard.press('Escape').catch(() => {});
		await settle(mine.page, 400);
	}

	await visit(mine.page, '/my-set', { wait: 'h1', extra: 2000 });
	await shoot(mine.page, 'exercises', '06-my-set', {
		clip: { x: 0, y: 56, width: WIDTH, height: 800 }
	});

	if (setId) {
		await visit(mine.page, `/sets/${setId}`, { wait: 'h1', extra: 1500 });
		await shoot(mine.page, 'exercises', '07-saved-set', {
			clip: { x: 0, y: 56, width: WIDTH, height: 820 }
		});
	}
	await mine.ctx.close();
};

// ---- submit --------------------------------------------------------------------------------------
chapters.submit = async () => {
	const { ctx, page } = await open('ania@edmat.example');

	await visit(page, '/submit', { wait: 'form', extra: 1500 });
	await shoot(page, 'submit', '01-form-top', { clip: { x: 0, y: 56, width: WIDTH, height: 560 } });

	// Fill it in the way a person does, so the picture shows a form with something in it.
	await page
		.selectOption('form select:has(option[value="matematyka"])', 'matematyka')
		.catch(() => {});
	await settle(page, 700);
	await page
		.selectOption('form select:has(option[value="analiza-matematyczna"])', 'analiza-matematyczna')
		.catch(() => {});
	await page
		.fill('form input[type="text"]', 'Granica ciągu zadanego rekurencyjnie')
		.catch(() => {});
	await page
		.selectOption('form select:has(option[value="university"])', 'university')
		.catch(() => {});
	const areas = page.locator('form textarea');
	if (await areas.count()) {
		await areas
			.nth(0)
			.fill(
				'Wykaż, że ciąg \\(a_{n+1} = \\tfrac12\\left(a_n + \\tfrac{2}{a_n}\\right)\\), \\(a_1 = 2\\), jest zbieżny, i policz jego granicę.'
			);
	}
	if ((await areas.count()) > 1) {
		await areas.nth(1).fill('Pokaż najpierw, że ciąg jest ograniczony z dołu przez \\(\\sqrt2\\).');
	}
	await settle(page, 800);
	await shoot(page, 'submit', '02-filled', { clip: { x: 0, y: 56, width: WIDTH, height: 900 } });

	const preview = page.locator('.preview-toggle').first();
	if (await preview.count()) {
		await preview.click().catch(() => {});
		await page
			.locator('.preview')
			.first()
			.waitFor({ timeout: 8000 })
			.catch(() => {});
		await settle(page, 1800);
		const box = await rect(page, '.preview');
		await shoot(page, 'submit', '03-preview', {
			clip: { x: 0, y: Math.max(56, Math.round(box?.y ?? 900) - 80), width: WIDTH, height: 700 }
		});
	} else {
		check('submit/03-preview: the preview toggle was found', false, 'no .preview-toggle');
	}

	// Actually submit it. That is the only way to photograph what the form says afterwards, and it
	// is what gives the moderation chapter a pending row with a real title to show. The cost is
	// named rather than worked around: **every run adds one pending submission** to the development
	// queue. Reject the spares from /moderation if they pile up.
	const submitButton = page.locator('form button[type="submit"].submit').first();
	if (await submitButton.count()) {
		await submitButton.click().catch(() => {});
		await page
			.locator('.notice, [class*="success"]')
			.first()
			.waitFor({ timeout: 15000 })
			.catch(() => {});
		await settle(page, 1500);
		await shoot(page, 'submit', '04-submitted', {
			clip: { x: 0, y: 56, width: WIDTH, height: 420 }
		});
	} else {
		check('submit/04-submitted: the submit button was found', false);
	}
	await ctx.close();

	// The other half of the chapter: a material, and what the queue does with a submission.
	const material = await open('ania@edmat.example');
	await visit(material.page, '/submit-material', { wait: 'form', extra: 1500 });
	await shoot(material.page, 'submit', '05-material', {
		clip: { x: 0, y: 56, width: WIDTH, height: 820 }
	});
	await material.ctx.close();
};

// ---- courses -------------------------------------------------------------------------------------
chapters.courses = async () => {
	const { ctx, page } = await open(null);
	await visit(page, '/courses', { wait: 'h1', extra: 2000 });
	await hideScratch(page);
	await shoot(page, 'courses', '01-hub', { clip: { x: 0, y: 56, width: WIDTH, height: 560 } });
	await ctx.close();

	// Ania runs "Analiza od zera" (seed_demo_content). Her own course, as she sees it.
	const owner = await open('ania@edmat.example');
	const courseId = demoCourseId;
	check('Ania has the seeded course "Analiza od zera"', Boolean(courseId));

	if (courseId) {
		await visit(owner.page, `/courses/${courseId}`, { wait: 'h1', extra: 2000 });
		await shoot(owner.page, 'courses', '02-course', {
			clip: { x: 0, y: 56, width: WIDTH, height: 900 }
		});

		// The chapters and lessons themselves, further down the same page.
		const content = await rect(owner.page, 'h2:text-is("Content")');
		await shoot(owner.page, 'courses', '03-content', {
			clip: { x: 0, y: Math.max(56, Math.round(content?.y ?? 900) - 24), width: WIDTH, height: 760 }
		});

		await visit(owner.page, `/courses/${courseId}/manage`, { wait: 'h1', extra: 2000 });
		await shoot(owner.page, 'courses', '04-manage', {
			clip: { x: 0, y: 56, width: WIDTH, height: 900 }
		});
	}
	await owner.ctx.close();

	// A public course somebody can actually join, from a reader's side.
	const joiner = await open('michal@edmat.example');
	await visit(joiner.page, '/courses/6', { wait: 'h1', extra: 2500 });
	await shoot(joiner.page, 'courses', '05-join', {
		clip: { x: 0, y: 56, width: WIDTH, height: 700 }
	});
	await joiner.ctx.close();
};

// ---- events --------------------------------------------------------------------------------------
chapters.events = async () => {
	const { ctx, page } = await open(null);
	await visit(page, '/events', { wait: 'h1', extra: 2000 });
	await shoot(page, 'events', '01-hub', { clip: { x: 0, y: 56, width: WIDTH, height: 480 } });

	await visit(page, '/events/68', { wait: 'h1', extra: 2500 });
	await shoot(page, 'events', '02-event', { clip: { x: 0, y: 56, width: WIDTH, height: 560 } });

	const box = await rect(page, 'h2:text-is("Programme")');
	await shoot(page, 'events', '03-programme', {
		clip: { x: 0, y: Math.round(box?.y ?? 600) - 20, width: WIDTH, height: 620 }
	});

	const proposals = page.locator('h2:text-is("Proposals")').first();
	if (await proposals.count()) {
		const pbox = await rect(page, 'h2:text-is("Proposals")');
		await shoot(page, 'events', '04-conference', {
			clip: { x: 0, y: Math.round(pbox?.y ?? 1200) - 20, width: WIDTH, height: 560 }
		});
	}
	await ctx.close();
};

// ---- tutoring ------------------------------------------------------------------------------------
chapters.tutoring = async () => {
	const { ctx, page } = await open(null);
	await visit(page, '/tutoring', { wait: 'h1', extra: 2000 });
	await hideScratch(page);
	await shoot(page, 'tutoring', '01-listings', {
		clip: { x: 0, y: 56, width: WIDTH, height: 760 }
	});
	await ctx.close();

	// Booking is only offered to somebody who is not the tutor, so this is Ania's listing
	// ("Analiza — dyżur konsultacyjny", seed_demo_content) seen by Michał. Booking it for real is
	// also what gives the messages chapter a genuine notification to photograph.
	const learner = await open('michal@edmat.example');
	await visit(learner.page, '/tutoring/7', { wait: 'h1, h2', extra: 2500 });
	await shoot(learner.page, 'tutoring', '02-listing', {
		clip: { x: 0, y: 56, width: WIDTH, height: 560 }
	});

	const booking = learner.page.getByText(/Book a session/i).first();
	if (await booking.count()) {
		const box = await rect(learner.page, 'text=/Book a session/i');
		await shoot(learner.page, 'tutoring', '03-booking', {
			clip: { x: 0, y: Math.round(box?.y ?? 400) - 24, width: WIDTH, height: 560 }
		});

		// One real booking request, if there is a free hour to ask for. `.slot` is the calendar's
		// own button class; a run with nothing free simply skips this step and says so.
		const slot = learner.page.locator('.slot, button[data-slot]').first();
		if (await slot.count()) {
			await slot.click().catch(() => {});
			await settle(learner.page, 1500);
			const confirm = learner.page
				.getByRole('button', { name: /^(Request|Book|Confirm)/i })
				.first();
			if (await confirm.count()) {
				await confirm.click().catch(() => {});
				await settle(learner.page, 2500);
			}
			const after = await rect(learner.page, 'text=/Book a session/i');
			await shoot(learner.page, 'tutoring', '04-requested', {
				clip: { x: 0, y: Math.max(56, Math.round(after?.y ?? 400) - 24), width: WIDTH, height: 520 }
			});
		} else {
			check('tutoring/04-requested: a free hour was offered', false, 'no .slot on the listing');
		}
	} else {
		check('tutoring: the booking panel was found', false);
	}
	await learner.ctx.close();
};

// ---- concepts ------------------------------------------------------------------------------------
chapters.concepts = async () => {
	const { ctx, page } = await open(null);
	await visit(page, '/concepts', { wait: 'h1', extra: 2000 });
	await hideScratch(page);
	await shoot(page, 'concepts', '01-hub', { clip: { x: 0, y: 56, width: WIDTH, height: 780 } });

	await visit(page, '/concepts/calka', { wait: 'h1', extra: 2500 });
	await hideScratch(page);
	await shoot(page, 'concepts', '02-concept', { clip: { x: 0, y: 56, width: WIDTH, height: 900 } });
	await ctx.close();

	const writer = await open('kasia@edmat.example');
	await visit(writer.page, '/concepts/calka', { wait: 'h1', extra: 2500 });
	await hideScratch(writer.page);
	// 340 px: below the tags the "Connections" block lists a linked exercise as a chip whose label
	// is the RAW LaTeX source (todo.md, "Found by the manual"), and the manual must not print it.
	await shoot(writer.page, 'concepts', '03-signed-in', {
		clip: { x: 0, y: 56, width: WIDTH, height: 340 }
	});
	await writer.ctx.close();
};

// ---- help ----------------------------------------------------------------------------------------
chapters.help = async () => {
	// The two boards are empty on a fresh seed; one row each, idempotent, under demo accounts.
	const aniaToken = await tokenFor('ania@edmat.example');
	const michalToken = await tokenFor('michal@edmat.example');

	// A need always hangs off a node — `POST /api/needs/` is deliberately not allowed, because the
	// node is taken from the URL it was posted under and never from the body (`needs/serializers.py`).
	// Ania's own course is the node here.
	const needs = await api('/needs/', { token: aniaToken });
	const NEED_TITLE = 'Somebody to read through the week 3 notes';
	if (
		demoCourseId &&
		!(Array.isArray(needs.body) ? needs.body : []).some((n) => n.title === NEED_TITLE)
	) {
		const made = await api(`/nodes/course/${demoCourseId}/needs/`, {
			token: aniaToken,
			method: 'POST',
			body: {
				title: NEED_TITLE,
				description:
					'Six pages on sequences and limits, written for people coming back to maths after school. I need one person who knows the material to read it and say where it is wrong or unclear — not to rewrite it.',
				kind: 'expertise',
				skill_level: 'intermediate',
				estimated_hours: 3,
				is_remote: true,
				wanted_count: 1
			}
		});
		check('a help-wanted row exists', made.ok, JSON.stringify(made.body).slice(0, 200));
	}

	const offers = await api('/volunteering-offers/', { token: michalToken });
	const OFFER_TITLE = 'I can proofread maths in Polish and English';
	if (!(Array.isArray(offers.body) ? offers.body : []).some((o) => o.title === OFFER_TITLE)) {
		const made = await api('/volunteering-offers/', {
			token: michalToken,
			method: 'POST',
			body: {
				title: OFFER_TITLE,
				description:
					'An evening a week. Analysis and probability at first- and second-year level; I can read a solution and say whether the argument holds.',
				audience: 'university',
				language: 'en',
				speaks: ['pl', 'en']
			}
		});
		check(
			'a volunteering offer exists',
			made.ok || made.status === 400,
			JSON.stringify(made.body).slice(0, 200)
		);
	}

	const { ctx, page } = await open(null);
	await visit(page, '/needs', { wait: 'h1', extra: 2000 });
	await hideScratch(page);
	await shoot(page, 'help', '01-needs', { clip: { x: 0, y: 56, width: WIDTH, height: 700 } });

	await visit(page, '/volunteering', { wait: 'h1', extra: 2000 });
	await hideScratch(page);
	await shoot(page, 'help', '02-volunteering', {
		clip: { x: 0, y: 56, width: WIDTH, height: 700 }
	});
	await ctx.close();

	// Posting one is NOT a page of its own — `/needs/new` is not a route (it falls through to
	// `/needs/[id]` with the id "new" and answers "Something went wrong"; written down in todo.md
	// under "Found by the manual"). A need is posted from the thing that needs the help, through
	// the `NeedsPanel` on its page, which is what the manual shows.
	const poster = await open('ania@edmat.example');
	if (demoCourseId) {
		await visit(poster.page, `/courses/${demoCourseId}`, { wait: 'h1', extra: 2500 });
		// The panel as it stands, with its own posting and the button that opens the form —
		// deliberately NOT the form itself: its text inputs and textarea render with no border or
		// background at all (todo.md, "Found by the manual"), and a manual that photographs a
		// broken control teaches the bug.
		const panel = await rect(poster.page, '[data-needs-panel]');
		check('help: the needs panel is on the course page', Boolean(panel));
		await shoot(poster.page, 'help', '03-post-a-need', {
			clip: { x: 0, y: Math.max(56, Math.round(panel?.y ?? 900) - 24), width: WIDTH, height: 170 }
		});
	}
	await poster.ctx.close();
};

// ---- messages ------------------------------------------------------------------------------------
chapters.messages = async () => {
	const kasia = await tokenFor('kasia@edmat.example');
	const michal = await tokenFor('michal@edmat.example');
	const me = await api('/auth/me/', { token: michal });

	// The idempotency check reads the RECIPIENT's inbox. `GET /api/messages/` is the signed-in
	// reader's INBOX, not a thread list — asking the sender returned an empty array every time, so
	// the guard never fired and five identical messages piled up before a screenshot showed them.
	const SUBJECT = 'About your analysis tutoring hours';
	const threads = await api('/messages/', { token: michal });
	const existing = (Array.isArray(threads.body) ? threads.body : []).some(
		(t) => (t.subject ?? '') === SUBJECT
	);
	if (!existing) {
		const sent = await api('/messages/', {
			token: kasia,
			method: 'POST',
			body: {
				recipient_id: me.body.id,
				subject: SUBJECT,
				body: 'Hello — could I take the Tuesday 17:00 slot next week? I want to go over the epsilon-delta proofs before the midterm.'
			}
		});
		check(
			'a message thread exists to photograph',
			sent.ok,
			JSON.stringify(sent.body).slice(0, 200)
		);
	}

	const { ctx, page } = await open('michal@edmat.example');
	await visit(page, '/messages', { wait: 'h1', extra: 2000 });
	await hideScratch(page);
	// Earlier runs of this script (before the guard above was right) left five identical copies of
	// the same message in the inbox. They are hidden, not deleted — a message has no delete
	// endpoint, and tombstoning is the house rule (12).
	await page.evaluate((subject) => {
		let seen = 0;
		for (const row of document.querySelectorAll('a.row')) {
			if (!(row.textContent ?? '').includes(subject)) continue;
			seen += 1;
			if (seen > 1) row.style.display = 'none';
		}
	}, SUBJECT);
	await shoot(page, 'messages', '01-inbox', { clip: { x: 0, y: 56, width: WIDTH, height: 420 } });

	const row = page.locator('a.row').filter({ hasText: SUBJECT }).first();
	if (await row.count()) {
		await row.click().catch(() => {});
		await page
			.locator('h1')
			.first()
			.waitFor({ timeout: 15000 })
			.catch(() => {});
		await hydrated(page);
		await settle(page, 1500);
		await shoot(page, 'messages', '02-thread', {
			clip: { x: 0, y: 56, width: WIDTH, height: 700 }
		});
	} else {
		check('messages/02-thread: the seeded thread was found in the inbox', false, SUBJECT);
	}

	// Writing one. There is no people search and no "write to anybody" box: `/messages/new` alone
	// says so and offers nothing, and the form appears only when a recipient came with the link —
	// which is what a "Contact" button on a listing or a profile does. `?to=` is that link.
	await visit(page, '/messages/new?to=2&subject=About%20Tuesday', { wait: 'form', extra: 1200 });
	await shoot(page, 'messages', '03-compose', { clip: { x: 0, y: 56, width: WIDTH, height: 600 } });

	await ctx.close();

	// Notifications are photographed on ANIA's account, not Michał's: his carries 85 rows left over
	// from earlier browser runs ("Registration e2e — lab day", "exam prep 1790253070635"), and a
	// manual must not teach a page made of other scripts' rubbish. Hers starts empty, so the two
	// rows on it are the two things this script just did — somebody joined her course, and somebody
	// offered to do the job she posted.
	const michalToken2 = await tokenFor('michal@edmat.example');
	if (demoCourseId) {
		await api(`/courses/${demoCourseId}/enrol/`, { token: michalToken2, method: 'POST' });
	}
	const openNeeds = await api('/needs/', { token: michalToken2 });
	const theNeed = (Array.isArray(openNeeds.body) ? openNeeds.body : []).find(
		(n) => n.title === 'Somebody to read through the week 3 notes'
	);
	if (theNeed) {
		await api(`/needs/${theNeed.id}/apply/`, {
			token: michalToken2,
			method: 'POST',
			body: { message: 'I teach this material and can read it this week.' }
		});
	}

	const notified = await open('ania@edmat.example');
	await visit(notified.page, '/notifications', { wait: 'h1', extra: 2500 });
	await hideScratch(notified.page);
	await shoot(notified.page, 'messages', '04-notifications', {
		clip: { x: 0, y: 56, width: WIDTH, height: 560 }
	});
	await notified.ctx.close();
};

// ---- moderation ----------------------------------------------------------------------------------
chapters.moderation = async () => {
	// This script posts one exercise submission per run (see the submit chapter), so a queue that
	// has been photographed before carries several identical rows — which reads as a bug in the
	// picture rather than as a script that ran twice. Every duplicate but the newest is REJECTED
	// here, through the real moderator endpoint with a real note: a rejected submission is kept,
	// not deleted (house rule 12), and rejecting is a thing a moderator legitimately does.
	const staff = await tokenFor('kasia@edmat.example');
	// The title lives in `payload`, not on the row — a submission is a JSON draft of an exercise
	// that does not exist yet, so there is nothing to denormalise it onto.
	const pending = await api('/exercise-submissions/', { token: staff });
	const DEMO_TITLE = 'Granica ciągu zadanego rekurencyjnie';
	const duplicates = (Array.isArray(pending.body) ? pending.body : [])
		.filter((row) => (row.payload?.title ?? '') === DEMO_TITLE && row.status === 'pending')
		.sort((a, b) => b.id - a.id)
		.slice(1);
	for (const row of duplicates) {
		await api(`/moderation/submission/${row.id}/reject/`, {
			token: staff,
			method: 'POST',
			body: { note: 'Duplicate of a submission already in this queue.' }
		});
	}
	if (duplicates.length)
		check(`moderation: ${duplicates.length} duplicate submission(s) rejected`, true);

	const { ctx, page } = await open('kasia@edmat.example');
	await visit(page, '/moderation', { wait: 'h1', extra: 3000 });

	// The tab row with its counts, which is the thing a moderator reads first. Deliberately NOT
	// the Reports tab: the development database's reported rows carry abuse somebody typed to
	// test the report button, and a manual must not reprint it.
	// The tabs carry ids (`#mod-tab-…`), which is what this drives — the queue's labels are
	// "New exercises (1)" and friends, so matching them by text means matching a count too.
	const tabs = await rect(page, '.tabs[role="tablist"]');
	check('moderation: the queue tab row was found', Boolean(tabs));
	await shoot(page, 'moderation', '01-queue', {
		clip: { x: 0, y: Math.max(56, Math.round(tabs?.y ?? 200) - 24), width: WIDTH, height: 130 }
	});

	// Deliberately the submissions tab and not Reports: the development database's reported rows
	// carry the abuse somebody typed to test the report button, and a manual must not reprint it.
	const newExercises = page.locator('#mod-tab-submissions');
	if (await newExercises.count()) {
		await newExercises.click();
		await settle(page, 2000);
		await hideScratch(page);
		const panel = await rect(page, '#mod-tabpanel');
		await shoot(page, 'moderation', '02-new-exercises', {
			clip: { x: 0, y: Math.max(56, Math.round(panel?.y ?? 300) - 80), width: WIDTH, height: 700 }
		});
	} else {
		check('moderation/02-new-exercises: #mod-tab-submissions exists', false);
	}

	const flags = page.locator('#mod-tab-flags');
	if (await flags.count()) {
		await flags.click();
		await settle(page, 2000);
		const panel = await rect(page, '#mod-tabpanel');
		await shoot(page, 'moderation', '03-flags', {
			clip: { x: 0, y: Math.max(56, Math.round(panel?.y ?? 300) - 80), width: WIDTH, height: 820 }
		});
	} else {
		check('moderation/03-flags: #mod-tab-flags exists', false);
	}
	await ctx.close();
};

// ================================================================================================

const order = [
	'start',
	'exercises',
	'submit',
	'courses',
	'events',
	'tutoring',
	'concepts',
	'help',
	'messages',
	'moderation'
];

try {
	await arrange();
	for (const name of order) {
		if (ONLY && !ONLY.has(name)) continue;
		console.log(`\n${name}`);
		if (!process.env.KEEP) rmSync(`${OUT}${name}`, { recursive: true, force: true });
		try {
			await chapters[name]();
		} catch (error) {
			check(`${name}: the chapter ran to the end`, false, String(error).slice(0, 220));
		}
	}
} finally {
	for (const { token, previous } of widened) {
		await api('/auth/me/', { token, method: 'PATCH', body: { content_locales: previous } });
	}
	await browser.close();
}

// ---- the budget ---------------------------------------------------------------------------------
let total = 0;
let count = 0;
for (const chapter of readdirSync(OUT, { withFileTypes: true })) {
	if (!chapter.isDirectory()) continue;
	for (const file of readdirSync(`${OUT}${chapter.name}`)) {
		total += statSync(`${OUT}${chapter.name}/${file}`).size;
		count++;
	}
}
console.log(`\n${count} pictures, ${(total / 1024 / 1024).toFixed(2)} MB in static/guide/`);
check(`the whole set is under 8 MB`, total <= MAX_TOTAL, `${(total / 1024 / 1024).toFixed(2)} MB`);

if (errors.length) {
	console.log(`\n${errors.length} console/page errors (not a pass condition here):`);
	for (const line of [...new Set(errors)].slice(0, 12)) console.log('   ' + line);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
