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
	const box = await rect(page, 'main');
	await shoot(page, 'tutoring', '03-schedule', {
		x: 0,
		y: 56,
		width: WIDTH,
		height: Math.min(520, (box?.height ?? 480) + 24)
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

try {
	await arrange();
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
