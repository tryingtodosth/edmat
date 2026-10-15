// The screenshots of the four module showcase pages added on 2026-10-14 (WP5):
// `/about/goals-and-work`, `/about/tutoring`, `/about/materials`, `/about/conference`.
//
// Why a script of its own rather than more blocks in `guide-screenshots.mjs`: that one writes
// `static/guide/<chapter>/` and its chapters ARE the manual's; these pictures belong to no chapter
// and land in `static/showcase/<slug>/`. The helpers are the same shapes (`open`, `visit`, `shoot`,
// the hydration wait, the 400 KB budget), copied rather than imported because the guide script is a
// top-level program, not a module — the third copy is when they get extracted (house rule 13).
//
// Run (your own ports; the frontend dev server must point at the same API):
//   E2E_BASE=http://localhost:5205 E2E_API=http://127.0.0.1:8055/api \
//   E2E_TOKENS=/path/to/tokens.json node e2e/showcase-screens.mjs
//
// `E2E_TOKENS` is a JSON file of DRF tokens by short name (e2e/CLAUDE.md trap 30 — reading them
// once avoids the login throttle): kasia, michal, ania, persona.organiser, persona.attendee,
// persona.clerk. Read them with `manage.py shell` as trap 30 shows.
//
// What it photographs, and what it writes first:
//   - Every picture is of the ENGLISH interface (`english.mjs`), as the manual's are.
//   - Everything conference-shaped is the seeded `TEST=FAKE Dni Dydaktyki Fizyki 2026` (event 133,
//     `seed_conference_demo`) and the demo building — invented people, and the captions say so.
//   - The development database has NO goal anywhere, so one is written through the real API on that
//     demo event, as its own organiser, idempotently (found by title): a goal with three criteria,
//     two of them ticked. That is the only row this script creates.
//   - Every shot is clipped, never `fullPage` (a full page PNG blows the 400 KB budget).
//   - Since WP10 (2026-10-15): the learning record (u-kasia's profile, read by a stranger, and her
//     consent switches) and a school (the `seed_school_demo` class as its teacher sees it, and the
//     `/dziennik` static build when DZIENNIK_DIR points at one). Neither writes a row. The school
//     pages need `manage.py seed_school_demo` and a `school.teacher` token in E2E_TOKENS.
//   - Run it with TZ=Europe/Warsaw: the browser draws times in its own zone, and this machine's is
//     UTC, which put the rota and the ticket two hours early in the first set.

import { mkdirSync, readFileSync, statSync } from 'node:fs';
import { englishContext } from './english.mjs';

let chromium;
try {
	({ chromium } = await import('playwright'));
} catch {
	({ chromium } = await import('playwright-core'));
}

const BASE = process.env.E2E_BASE ?? 'http://localhost:5205';
const API = process.env.E2E_API ?? 'http://127.0.0.1:8055/api';
const TOKENS = JSON.parse(readFileSync(process.env.E2E_TOKENS ?? 'tokens.json', 'utf8'));
const OUT = new URL('../static/showcase/', import.meta.url).pathname;
const ONLY = process.env.ONLY ? new Set(process.env.ONLY.split(',')) : null;
const MAX_BYTES = 400 * 1024;
const WIDTH = 1280;
/** The seeded demo conference (`seed_conference_demo`) — every person on it is invented. */
const CONFERENCE_TITLE = 'TEST=FAKE Dni Dydaktyki Fizyki 2026';
const GOAL_TITLE = 'TEST=FAKE: registration without a queue on day two';

let pass = 0;
let fail = 0;
const check = (label, ok, extra = '') => {
	if (ok) pass++;
	else fail++;
	console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${label} ${ok ? '' : extra}`);
};

const errors = [];

async function api(path, { who, method = 'GET', body } = {}) {
	const response = await fetch(API + path, {
		method,
		headers: {
			...(body ? { 'Content-Type': 'application/json' } : {}),
			...(who ? { Authorization: `Token ${TOKENS[who]}` } : {})
		},
		...(body ? { body: JSON.stringify(body) } : {})
	});
	const text = await response.text();
	let parsed = text;
	try {
		parsed = text ? JSON.parse(text) : null;
	} catch {
		/* a Django debug page: keep the text, it says why */
	}
	return { status: response.status, ok: response.ok, body: parsed };
}

const browser = await chromium.launch(
	process.env.CHROME ? { executablePath: process.env.CHROME } : {}
);

async function open(who, { height = 950 } = {}) {
	const ctx = await englishContext(browser, BASE, { viewport: { width: WIDTH, height } });
	await ctx.addInitScript(
		([token]) => {
			try {
				if (token) localStorage.setItem('edmat-auth-token', token);
				else localStorage.setItem('edmat.contentLocales', '["pl","en"]');
			} catch {
				/* storage may be unavailable; the shot then shows the default */
			}
		},
		[who ? TOKENS[who] : null]
	);
	const page = await ctx.newPage();
	page.on('pageerror', (e) => errors.push('pageerror: ' + String(e).slice(0, 160)));
	return { ctx, page };
}

/** e2e trap 25: the header's language picker reads `en` only once the runes have taken over. */
async function hydrated(page, timeout = 25000) {
	const select = page.locator('header select').first();
	const deadline = Date.now() + timeout;
	while (Date.now() < deadline) {
		if ((await select.inputValue().catch(() => null)) === 'en') return true;
		await page.waitForTimeout(250);
	}
	errors.push('hydration never reached "en" on ' + page.url());
	return false;
}

async function visit(page, path, { wait = 'h1', extra = 1500 } = {}) {
	await page.goto(`${BASE}${path}`, { waitUntil: 'load' });
	if (wait)
		await page
			.locator(wait)
			.first()
			.waitFor({ timeout: 20000 })
			.catch(() => {});
	await hydrated(page);
	await page.waitForTimeout(extra);
}

/** Document coordinates of the first match (scrolls home first — see the guide script). */
async function rect(page, selector) {
	await page.evaluate(() => window.scrollTo(0, 0));
	await page.waitForTimeout(250);
	const target = page.locator(selector).first();
	if ((await target.count()) === 0) return null;
	return (await target.boundingBox({ timeout: 5000 }).catch(() => null)) ?? null;
}

async function shoot(page, slug, name, clip) {
	const dir = `${OUT}${slug}/`;
	mkdirSync(dir, { recursive: true });
	const path = `${dir}${name}.png`;
	await page.addStyleTag({
		content: '*{caret-color:transparent !important}*{scrollbar-width:none}'
	});
	await page.evaluate(() => window.scrollTo(0, 0));
	await page.waitForTimeout(250);
	const region = {
		x: Math.max(0, Math.round(clip.x)),
		y: Math.max(0, Math.round(clip.y)),
		width: Math.min(WIDTH, Math.round(clip.width)),
		height: Math.min(1100, Math.round(clip.height))
	};
	await page.screenshot({ path, fullPage: true, clip: region });
	const bytes = statSync(path).size;
	check(
		`${slug}/${name}.png ${region.width}x${region.height} ${(bytes / 1024).toFixed(0)} KB`,
		bytes <= MAX_BYTES,
		'over 400 KB'
	);
}

// ================================================================================================

let conferenceId = null;
let goalId = null;

async function arrange() {
	// `when=all`: the list defaults to upcoming, and the demo conference may already be over.
	const events = await api('/events/?when=all&q=' + encodeURIComponent('TEST=FAKE'), {
		who: 'persona.organiser'
	});
	const list = Array.isArray(events.body) ? events.body : (events.body?.results ?? []);
	conferenceId = list.find((e) => e.title === CONFERENCE_TITLE)?.id ?? null;
	check('arrange: the demo conference exists', conferenceId !== null, String(events.status));
	if (!conferenceId) return;

	const goals = await api(`/nodes/event/${conferenceId}/goals/`, { who: 'persona.organiser' });
	let goal = (goals.body ?? []).find((g) => g.title === GOAL_TITLE);
	if (!goal) {
		const made = await api(`/nodes/event/${conferenceId}/goals/`, {
			who: 'persona.organiser',
			method: 'POST',
			body: {
				title: GOAL_TITLE,
				description:
					'A demonstration goal on the invented conference: what “registration went well” has to mean before anybody may say it did.'
			}
		});
		check('arrange: the demo goal was created', made.ok, JSON.stringify(made.body).slice(0, 200));
		goal = made.body;
		const lines = [
			'Two registration desks are staffed from 08:00 on day two',
			'Every attendee has a ticket code before the doors open',
			'Nobody waits more than ten minutes at the desk'
		];
		for (const text of lines) {
			await api(`/goals/${goal.id}/criteria/`, {
				who: 'persona.organiser',
				method: 'POST',
				body: { text }
			});
		}
		const fresh = await api(`/goals/${goal.id}/`, { who: 'persona.organiser' });
		for (const criterion of (fresh.body?.criteria ?? []).slice(0, 2)) {
			await api(`/goal-criteria/${criterion.id}/tick/`, {
				who: 'persona.organiser',
				method: 'POST'
			});
		}
	}
	goalId = goal?.id ?? null;
	check('arrange: the demo goal exists', goalId !== null);
}

const pages = {};

// ---- goals and work ----------------------------------------------------------------------------
pages['goals-and-work'] = async () => {
	const slug = 'goals-and-work';
	if (goalId) {
		const { ctx, page } = await open(null);
		await visit(page, `/goals/${goalId}`);
		// Down to the collapsed "Comment on …" line under the card, and no further.
		const comment = await rect(page, 'text=/^Comment on /');
		await shoot(page, slug, '01-goal', {
			x: 0,
			y: 56,
			width: WIDTH,
			height: Math.round((comment?.y ?? 440) + 36 - 56)
		});
		await ctx.close();
	}
	{
		const { ctx, page } = await open('kasia');
		await visit(page, '/tasks', { wait: 'h1', extra: 2500 });
		const waiting = await rect(page, 'h2:text-is("You are waiting on somebody")');
		await shoot(page, slug, '02-tasks', {
			x: 0,
			y: 56,
			width: WIDTH,
			height: Math.round((waiting?.y ?? 760) - 56 - 8)
		});
		await visit(page, '/work', { wait: 'h1', extra: 2500 });
		await shoot(page, slug, '04-work', { x: 0, y: 56, width: WIDTH, height: 1000 });
		await ctx.close();
	}
	{
		const { ctx, page } = await open(null);
		await visit(page, '/needs', { wait: 'h1', extra: 2500 });
		await shoot(page, slug, '03-needs', { x: 0, y: 56, width: WIDTH, height: 620 });
		await ctx.close();
	}
};

// ---- tutoring ----------------------------------------------------------------------------------
pages.tutoring = async () => {
	// The listings and a listing's booking panel are the manual's own pictures
	// (`static/guide/tutoring/01-listings.png`, `02-listing.png`), which still match. What the manual
	// has no picture of is the tutor's side: the request waiting to be confirmed or declined.
	const { ctx, page } = await open('ania');
	await visit(page, '/bookings', { wait: 'h1', extra: 2500 });
	// Down to the end of the SECOND request: the manual's own run (`guide-screenshots.mjs`, the
	// tutoring chapter) asks for one more hour every time it runs, so the list grows, and two
	// requests side by side are all the picture is for.
	await page.evaluate(() => window.scrollTo(0, 0));
	await page.waitForTimeout(250);
	const second = await page
		.locator('button:has-text("Decline")')
		.nth(1)
		.boundingBox()
		.catch(() => null);
	await shoot(page, 'tutoring', '03-schedule', {
		x: 0,
		y: 56,
		width: WIDTH,
		height: second ? Math.round(second.y + second.height + 20 - 56) : 483
	});
	await ctx.close();
};

// ---- materials ---------------------------------------------------------------------------------
pages.materials = async () => {
	const slug = 'materials';
	{
		const { ctx, page } = await open(null);
		await visit(page, '/materials/1', { wait: 'h1', extra: 2500 });
		// From the title down to the end of the cooperation card: what the material is, what it
		// covers, the licence line, and the team behind it.
		const coop = await rect(page, 'text=/^Cooperation$/i');
		const end = coop ? coop.y + 262 : 1090;
		await shoot(page, slug, '01-material', { x: 0, y: 56, width: WIDTH, height: end - 56 });
		await ctx.close();
	}
	{
		const { ctx, page } = await open('kasia');
		await visit(page, '/material-projects/1', { wait: 'h1', extra: 2500 });
		// From "Save a new version" down to the invite links: versions, the team, and how somebody
		// joins it. The current-version card above is left out — the material page already shows
		// it, and the seeded file carries its uploader's original filename.
		const save = await rect(page, 'button:has-text("Save a new version")');
		const join = await rect(page, 'text=/^Requests to join$/i');
		const top = Math.round((save?.y ?? 440) - 20);
		await shoot(page, slug, '02-project', {
			x: 0,
			y: top,
			width: WIDTH,
			height: Math.round((join?.y ?? 1350) - top - 30)
		});
		await ctx.close();
	}
};

// ---- conference --------------------------------------------------------------------------------
pages.conference = async () => {
	const slug = 'conference';
	if (!conferenceId) return;
	{
		const { ctx, page } = await open('persona.organiser');
		await visit(page, `/events/${conferenceId}`, { wait: 'h1', extra: 3000 });
		// The organiser's view: every conference panel stacked under the event, folded.
		const running = await rect(page, 'text=/^You are running this$/');
		const goals = await rect(page, 'section.fold:has(.fold__title:text-is("Goals"))');
		const top = Math.round((running?.y ?? 700) - 16);
		await shoot(page, slug, '01-event', {
			x: 0,
			y: top,
			width: WIDTH,
			height: Math.round((goals?.y ?? top + 900) - top - 12)
		});

		await visit(page, `/events/${conferenceId}/scan`, { wait: 'h1', extra: 2500 });
		await shoot(page, slug, '04-scan', { x: 340, y: 56, width: 600, height: 580 });

		await visit(page, `/events/${conferenceId}/rota`, { wait: 'table', extra: 2000 });
		await shoot(page, slug, '05-rota', { x: 0, y: 56, width: WIDTH, height: 560 });
		await ctx.close();
	}
	{
		const { ctx, page } = await open(null);
		await visit(page, '/venues/demo-pasteura-5', { wait: 'h1', extra: 2500 });
		const checklists = await rect(page, 'h2:text-is("Checklists this building hands out")');
		await shoot(page, slug, '02-venue', {
			x: 0,
			y: 56,
			width: WIDTH,
			height: Math.round((checklists?.y ?? 840) - 56 - 6)
		});
		await ctx.close();
	}
	{
		const { ctx, page } = await open('persona.attendee');
		await visit(page, `/events/${conferenceId}/ticket`, { wait: 'h1, h2', extra: 2500 });
		await shoot(page, slug, '03-ticket', { x: 420, y: 70, width: 440, height: 720 });
		await ctx.close();
	}
	{
		const { ctx, page } = await open('persona.clerk');
		await visit(page, `/events/${conferenceId}/cloakroom`, { wait: 'h1', extra: 2500 });
		await shoot(page, slug, '06-cloakroom', { x: 0, y: 56, width: WIDTH, height: 740 });
		await ctx.close();
	}
};

// ---- your account (WP6, 2026-10-15) ------------------------------------------------------------
// Signed-out forms, then the account pages as two seeded people: `persona.guardian` (who has a
// child account, so the Children card has something in it) and `julia` (an ordinary contributor
// with "EdMat only" content and nothing to hand over — so the deletion page draws its whole plan,
// the keep-or-remove choice and the confirm form, rather than a list of blockers). Nothing is
// written: the delete button is never pressed.
pages.account = async () => {
	const slug = 'account';
	{
		const { ctx, page } = await open(null);
		await visit(page, '/register', { wait: 'h1', extra: 2500 });
		const h1 = await rect(page, 'main h1');
		const end = await rect(page, 'p.switch');
		const top = Math.round((h1?.y ?? 100) - 24);
		await shoot(page, slug, '01-register', {
			x: 0,
			y: top,
			width: WIDTH,
			height: Math.round((end ? end.y + end.height : top + 1000) + 24 - top)
		});
		await visit(page, '/login', { wait: 'h1', extra: 2500 });
		const h1b = await rect(page, 'main h1');
		const endb = await rect(page, 'p.switch');
		const topb = Math.round((h1b?.y ?? 100) - 24);
		await shoot(page, slug, '02-login', {
			x: 0,
			y: topb,
			width: WIDTH,
			height: Math.round((endb ? endb.y + endb.height : topb + 700) + 24 - topb)
		});
		await ctx.close();
	}
	{
		const { ctx, page } = await open('persona.guardian');
		await visit(page, '/settings', { wait: 'section.email-settings', extra: 2500 });
		const first = await rect(page, 'section.email-settings');
		// Down to the child's row and its Suspend / Delete buttons; the "Add a child" form below it
		// would push the picture past the height budget, and the caption says it is there.
		const add = await rect(page, 'section.guardian form.add');
		const top = Math.round((first?.y ?? 400) - 16);
		await shoot(page, slug, '03-settings', {
			x: 0,
			y: top,
			width: WIDTH,
			height: Math.round((add ? add.y : top + 900) - 4 - top)
		});
		await ctx.close();
	}
	{
		const { ctx, page } = await open('julia');
		await visit(page, '/settings/account', { wait: '[data-testid="erasure-plan"]', extra: 2500 });
		const h1 = await rect(page, 'main h1');
		const plan = await rect(page, '[data-testid="erasure-plan"] .plan-group >> nth=1');
		const top = Math.round((h1?.y ?? 120) - 20);
		await shoot(page, slug, '04-data', {
			x: 0,
			y: top,
			width: WIDTH,
			height: Math.round((plan ? plan.y + plan.height : top + 1000) + 8 - top)
		});
		const choice = await rect(page, '[data-testid="content-choice"]');
		const form = await rect(page, '[data-testid="erasure-form"]');
		const topc = Math.round((choice?.y ?? 1400) - 10);
		await shoot(page, slug, '05-delete', {
			x: 0,
			y: topc,
			width: WIDTH,
			height: Math.round((form ? form.y + form.height : topc + 600) + 24 - topc)
		});
		await ctx.close();
	}
};

// ---- licences and your data (WP6, 2026-10-15) ---------------------------------------------------
// The licence picker on /submit as `ola` with nothing typed — no source named, so the form
// suggests CC BY 4.0 — and two licence lines: an exercise somebody published under CC BY 4.0
// (`E2E_CCBY_EXERCISE`, default 748: an e2e row on the development database, cropped to its
// statement so its test title is not in the picture) and a corpus exercise whose rights are not yet
// clarified (`E2E_CORPUS_EXERCISE`, default 1). No analytics picture, on purpose: the dashboard is
// staff-only and shows real counts.
pages['licences-and-data'] = async () => {
	const slug = 'licences-and-data';
	{
		const { ctx, page } = await open('ola');
		await visit(page, '/submit', { wait: '.licence-picker__hint', extra: 2500 });
		const box = await rect(page, 'fieldset:has(.licence-picker__hint)');
		const top = Math.round((box?.y ?? 1800) - 12);
		await shoot(page, slug, '01-picker', {
			x: 0,
			y: top,
			width: WIDTH,
			height: Math.round((box?.height ?? 820) + 24)
		});
		await ctx.close();
	}
	for (const [name, id] of [
		['02-cc-by', process.env.E2E_CCBY_EXERCISE ?? '748'],
		['03-corpus', process.env.E2E_CORPUS_EXERCISE ?? '1']
	]) {
		const { ctx, page } = await open(null);
		await visit(page, `/exercises/${id}`, { wait: '.licence-notice', extra: 3000 });
		await page
			.locator('.katex')
			.first()
			.waitFor({ timeout: 15000 })
			.catch(() => {});
		const notice = await rect(page, '.licence-notice');
		const heading = await rect(page, 'text=/^Statement$/i');
		const top = Math.round((heading?.y ?? (notice?.y ?? 500) - 200) - 40);
		await shoot(page, slug, name, {
			x: 0,
			y: top,
			width: WIDTH,
			height: Math.round((notice ? notice.y + notice.height : top + 300) + 36 - top)
		});
		await ctx.close();
	}
};

// ---- learning record ---------------------------------------------------------------------------
pages['learning-record'] = async () => {
	const slug = 'learning-record';
	// u-kasia's public profile (`seed_profile_showcase` gives her transferred grades), read by a
	// stranger: the record lives in a modal behind the profile's "Learning record" row. Her activity
	// consent is left exactly as it is (off), so the picture also shows what "Not shared" looks like
	// rather than a consent this script flipped for the photograph.
	{
		const { ctx, page } = await open(null);
		// Her id from her own session (there is no people search to look it up by name).
		const me = await api('/auth/me/', { who: 'kasia' });
		const kasiaId = me.body?.id;
		check('learning-record: u-kasia resolved', Boolean(kasiaId), String(me.status));
		mkdirSync(`${OUT}${slug}/`, { recursive: true });
		mkdirSync(`${OUT}${slug}/`, { recursive: true });
		await visit(page, `/users/${kasiaId}`, { wait: 'h1, h2', extra: 3000 });
		await page
			.getByRole('button', { name: /Learning record/ })
			.first()
			.click();
		await page.waitForTimeout(1500);
		const dialog = await page.locator('[role="dialog"]').first().boundingBox();
		check('learning-record: the record modal opened', Boolean(dialog));
		if (dialog) {
			await page.screenshot({
				path: `${OUT}${slug}/01-record.png`,
				clip: {
					// The dialog alone: any margin would show the dimmed profile behind it.
					x: Math.round(dialog.x),
					y: Math.round(dialog.y),
					width: Math.round(dialog.width),
					height: Math.round(dialog.height)
				}
			});
			const bytes = statSync(`${OUT}${slug}/01-record.png`).size;
			check(`${slug}/01-record.png ${(bytes / 1024).toFixed(0)} KB`, bytes <= MAX_BYTES);
		}
		await ctx.close();
	}
	// The other end: the four switches in Settings, as their owner sees them.
	{
		const { ctx, page } = await open('kasia');
		await visit(page, '/settings', { wait: 'h1', extra: 3000 });
		const box = await rect(page, '.education .consent');
		check('learning-record: the consent block is in Settings', Boolean(box));
		if (box) {
			await shoot(page, slug, '02-consent', {
				x: Math.round(box.x - 16),
				y: Math.round(box.y - 16),
				width: Math.round(box.width + 32),
				height: Math.round(box.height + 32)
			});
		}
		await ctx.close();
	}
};

// ---- schools -----------------------------------------------------------------------------------
pages.schools = async () => {
	const slug = 'schools';
	// The seeded demo school (`manage.py seed_school_demo`, everything in it `TEST=FAKE` and
	// invented). Its classes are private, so these are pictures of pages a visitor cannot open, and
	// the captions say so. `school.teacher` runs both classes; the token is read as trap 30 shows.
	const classes = await api('/courses/?mine=1', { who: 'school.teacher' });
	const list = Array.isArray(classes.body) ? classes.body : (classes.body?.results ?? []);
	const classId = list.find((c) => c.title === 'TEST=FAKE Fizyka — klasa 2a')?.id ?? null;
	check(
		'schools: the demo class exists (run manage.py seed_school_demo first)',
		Boolean(classId) && Boolean(TOKENS['school.teacher'])
	);
	if (classId) {
		const { ctx, page } = await open('school.teacher');
		await visit(page, `/courses/${classId}`, { wait: 'h1', extra: 3000 });
		// The top of a class: which school runs it, and the sentence that says what that changes.
		const fold = await rect(page, 'section.fold:has(.fold__toggle:has-text("What it covers"))');
		await shoot(page, slug, '01-class', {
			x: 0,
			y: 56,
			width: WIDTH,
			height: Math.round((fold?.y ?? 340) - 56 - 12)
		});
		// One lesson's register, opened: every pupil by name, because a school runs this class.
		await page.getByText('Show who is where').first().click();
		await page.waitForTimeout(1500);
		const bar = await rect(page, 'text=/have finished this/');
		const hide = await rect(page, 'text=/Hide who is where/');
		const people = await page.evaluate(() => {
			const link = [...document.querySelectorAll('button, a')].find((e) =>
				/Hide who is where/.test(e.textContent ?? '')
			);
			const list = link?.parentElement?.querySelector('ul');
			if (!list) return null;
			const r = list.getBoundingClientRect();
			return { bottom: r.bottom + window.scrollY };
		});
		if (bar && hide) {
			const top = Math.round(bar.y - 28);
			await shoot(page, slug, '02-register', {
				x: 280,
				y: top,
				width: 740,
				height: Math.round((people?.bottom ?? hide.y + 160) - top + 20)
			});
		}
		await ctx.close();
	}
	// The school logbook demonstration (`/dziennik`, HISTORY.md §17BO) is a separate static build
	// the dev server does not serve. Build it with
	//   node school-management-demo/scripts/build-static.js --out=<dir> --base=/dziennik
	// and pass the directory as DZIENNIK_DIR: the browser is handed those files for /dziennik/ —
	// exactly what Apache serves on edmat.net — and nothing else changes. Without it, skipped.
	const dir = process.env.DZIENNIK_DIR;
	if (!dir) {
		console.log('  (skipped: the logbook demo — set DZIENNIK_DIR to a build-static.js output)');
		return;
	}
	const types = {
		html: 'text/html',
		js: 'text/javascript',
		css: 'text/css',
		svg: 'image/svg+xml',
		json: 'application/json',
		webmanifest: 'application/manifest+json',
		png: 'image/png',
		woff2: 'font/woff2'
	};
	const ctx = await browser.newContext({ viewport: { width: WIDTH, height: 900 } });
	await ctx.route(`${BASE}/dziennik/**`, async (route) => {
		let file = new URL(route.request().url()).pathname.replace(/^\/dziennik/, '');
		if (file === '' || file.endsWith('/')) file += 'index.html';
		try {
			const body = readFileSync(dir + file);
			await route.fulfill({ status: 200, body, contentType: types[file.split('.').pop()] });
		} catch {
			await route.fulfill({ status: 404, body: '' });
		}
	});
	const page = await ctx.newPage();
	page.on('pageerror', (e) => errors.push('pageerror: ' + String(e).slice(0, 160)));
	await page.goto(`${BASE}/dziennik/`, { waitUntil: 'load' });
	await page.waitForTimeout(2500);
	// A teacher's lesson log: chosen from the demo's own "see as" list, as a visitor does.
	await page.selectOption('select', 'a.wojcik');
	await page.waitForTimeout(2500);
	await page.goto(`${BASE}/dziennik/#/lekcja`, { waitUntil: 'load' });
	await page.waitForTimeout(3000);
	await shoot(page, slug, '03-logbook', { x: 0, y: 0, width: WIDTH, height: 820 });
	await ctx.close();
};

try {
	// Only the goals and conference pictures need the demo conference and its goal.
	if (!ONLY || ONLY.has('goals-and-work') || ONLY.has('conference')) await arrange();
	for (const [slug, run] of Object.entries(pages)) {
		if (ONLY && !ONLY.has(slug)) continue;
		console.log(`\n== ${slug} ==`);
		await run();
	}
} finally {
	await browser.close();
}

if (errors.length) console.log('\nerrors seen:\n  ' + errors.join('\n  '));
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
