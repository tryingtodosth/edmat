// Contests, step B: the preset turned into rows on the contest node, and every page B ships
// (`prompts/19-contests-b-personalise.md`, `CONTESTS-BRIEF.md` §3.B).
//
// Run:
//   E2E_BASE=http://localhost:5272 E2E_API=http://127.0.0.1:8172/api \
//     E2E_OWNER_TOKEN=<a token for the account the contest is founded by> \
//     node e2e/contests-personalise.mjs
//
// **It founds its own contest through the ORM, and that is not a shortcut.** On step B's branch a
// contest has only the prep's two models and there is no `POST /api/contests/` — step A is building
// it at the same time. So the setup below shells out to `manage.py shell` in the backend beside this
// checkout, creates one `Contest` with `Contest.objects.create`, calls `personalize.apply_preset`
// and prints the ids as JSON. That is also the honest test of the seam A will call: `apply_preset`
// is invoked exactly as `ContestViewSet.create` will invoke it, by the organiser, on a fresh row.
//
// `E2E_OWNER_TOKEN` is required and cannot be logged in for. The panels this drives are a node
// MANAGER's, and `config/nodes.py: can_manage_node` has no `is_staff` bypass (e2e/CLAUDE.md trap
// 32) — so the browser has to arrive as the contest's own organiser, and the ORM setup has to found
// the contest in that same account. The script reads `/auth/me/` to find out who the token belongs
// to and passes that username to the setup, so the two can never disagree.
//
// What it checks, in the order a reader meets it:
//   1. `apply_preset` creates the plan, the goal, the tasks, the needs and the poll, and says so;
//   2. a second call creates nothing and answers `already_personalised`;
//   3. `/contests/<id>` (the prep's placeholder, which mounts `ManagementPanels`) draws all five
//      panels with those rows in them, each with the right count on its folded line;
//   4. a task carries its citation, its verification marker and "this is not legal advice";
//   5. the plan's steps are the timeline, in order, with due dates;
//   6. `/about/contests` draws the ten presets, the law table and its four markers;
//   7. `/about/guide/contests` is a real chapter, listed on the manual's hub;
//   8. `/work` loads with the contest sections absent-because-empty (step A owns the rows), and
//      says so rather than being asserted as broken;
//   9. a profile draws the "Contests" block behind the learning-record consent.
//
// It cleans up: the contest and every row `apply_preset` hung off it are deleted at the end through
// the same shell, and the deletion is re-queried.
import { mkdirSync } from 'node:fs';
import { execFileSync } from 'node:child_process';

let chromium;
try {
	({ chromium } = await import('playwright'));
} catch {
	({ chromium } = await import('playwright-core'));
}

const BASE = process.env.E2E_BASE ?? 'http://localhost:5272';
const API = process.env.E2E_API ?? 'http://127.0.0.1:8172/api';
const TOKEN = process.env.E2E_OWNER_TOKEN ?? '';
const PYTHON = process.env.E2E_PYTHON ?? '../.venv/bin/python3';
const BACKEND = process.env.E2E_BACKEND_DIR ?? '../backend';
const OUT = 'e2e/screens';
mkdirSync(OUT, { recursive: true });

if (!TOKEN) {
	console.error('E2E_OWNER_TOKEN is not set. Every panel this script drives belongs to a node');
	console.error('MANAGER and `can_manage_node` has no is_staff bypass, so without it the run');
	console.error('would fail for the rule working. See the header for how to read a token.');
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

/** Run a snippet of Python in the backend's own settings and parse the single JSON line it
 *  prints. `manage.py shell -c` rather than a file on disk: the whole of this script's state lives
 *  in this one file, which is what makes it re-runnable without a second thing to keep in step. */
function shell(code) {
	const out = execFileSync(PYTHON, ['manage.py', 'shell', '-c', code], {
		cwd: BACKEND,
		encoding: 'utf8'
	});
	const line = out
		.trim()
		.split('\n')
		.filter((l) => l.startsWith('{') || l.startsWith('['))
		.pop();
	if (!line) throw new Error(`no JSON from the shell:\n${out}`);
	return JSON.parse(line);
}

async function api(path) {
	const res = await fetch(`${API}${path}`, { headers: { Authorization: `Token ${TOKEN}` } });
	return { status: res.status, body: await res.json().catch(() => null) };
}

// --- who the token is, so the ORM setup founds the contest in that account --------------------
const me = await api('/auth/me/');
if (me.status !== 200 || !me.body?.username) {
	console.error(`/auth/me/ answered ${me.status} — the token is not usable.`);
	process.exit(1);
}
const USERNAME = me.body.username;
console.log(`\n== founding a contest as ${USERNAME} (through the ORM) ==`);

const TITLE = 'E2E konkurs personalizacji';
const SETUP = `
import json
from datetime import timedelta
from django.contrib.auth import get_user_model
from django.utils import timezone
from config import nodes
from contests.models import Contest
from contests.personalize import apply_preset
from decisions.models import Poll
from goals.models import Goal
from needs.models import Need
from plans.models import Plan
from tasks.models import Task

owner = get_user_model().objects.get(username=${JSON.stringify(USERNAME)})
# A row left behind by an ABORTED run, taken down the way the cleanup at the end does it: deleting
# the contest alone would leave the plan, the goal, the tasks, the needs and the poll pointing at a
# dead generic target, because a GenericForeignKey cascades nothing.
for stale in Contest.objects.filter(title=${JSON.stringify(TITLE)}):
    where = {'content_type': nodes.node_content_type(stale), 'object_id': stale.pk}
    for model in (Plan, Goal, Task, Need, Poll):
        model.objects.filter(**where).delete()
    stale.delete()
now = timezone.now()
contest = Contest.objects.create(
    title=${JSON.stringify(TITLE)},
    description='Konkurs utworzony przez e2e/contests-personalise.mjs.',
    preset_key='school',
    # Step A's column (default False); the wizard sets it from the preset, so this setup does too.
    has_prize=True,
    organiser=owner,
    status='announced',
    visibility='public',
    allows_minors=True,
    starts_at=now + timedelta(days=30),
    ends_at=now + timedelta(days=60),
    registration_opens_at=now + timedelta(days=31),
    registration_closes_at=now + timedelta(days=45),
)
first = apply_preset(contest, owner)
second = apply_preset(contest, owner)
print(json.dumps({'id': contest.pk, 'first': first, 'second': second}))
`;

let setup;
try {
	setup = shell(SETUP);
} catch (e) {
	console.error(`the ORM setup failed:\n${e.message}`);
	process.exit(1);
}
const CONTEST = setup.id;
const first = setup.first;
const second = setup.second;
console.log(`  (contest ${CONTEST})`);

check(
	'apply_preset names the preset back',
	first.preset === 'school',
	JSON.stringify(first.preset)
);
check('it created one plan', typeof first.created.plan === 'number', JSON.stringify(first.created));
check('it created one goal', typeof first.created.goal === 'number', JSON.stringify(first.created));
check(
	'it created a task per checklist item',
	first.created.tasks.length >= 10,
	`${first.created.tasks.length} tasks`
);
check('it created the needs', first.created.needs.length >= 1, `${first.created.needs.length}`);
check(
	'it created one draft poll',
	first.created.polls.length === 1,
	`${first.created.polls.length}`
);
check(
	'nothing was skipped with every flag on',
	first.skipped.length === 0,
	JSON.stringify(first.skipped)
);
check(
	'a second call creates nothing and says so',
	second.skipped.includes('already_personalised'),
	JSON.stringify(second.skipped)
);
check(
	'and it still names the same rows',
	second.created.plan === first.created.plan &&
		second.created.tasks.length === first.created.tasks.length,
	JSON.stringify(second.created)
);

// --- the rows through the real API, as the panels will read them ------------------------------
console.log('\n== the rows through the API ==');
const plans = await api(`/nodes/contest/${CONTEST}/plans/?lang=pl`);
check(
	'the plan is on the contest node',
	plans.status === 200 && plans.body?.length === 1,
	`${plans.status}`
);
const plan = plans.body?.[0];
const stepTitles = (plan?.steps ?? []).map((s) => s.title);
check(
	'its steps are the timeline, announcement first',
	stepTitles[0] === 'Ogłoszenie konkursu',
	JSON.stringify(stepTitles.slice(0, 3))
);
check(
	'the stage ladder sits between registration closing and judging',
	stepTitles.indexOf('Ocenianie') - stepTitles.indexOf('Zamknięcie zapisów') === 3,
	JSON.stringify(stepTitles)
);
check(
	'every step the contest has a date for has a due date',
	(plan?.steps ?? []).filter((s) => s.due_at).length >= 6,
	`${(plan?.steps ?? []).filter((s) => s.due_at).length} dated of ${stepTitles.length}`
);
check(
	'the plan reads in English too',
	(await api(`/nodes/contest/${CONTEST}/plans/?lang=en`)).body?.[0]?.title ===
		'Running the contest',
	'the English version of the plan title'
);

const goals = await api(`/nodes/contest/${CONTEST}/goals/?lang=pl`);
const goal = goals.body?.[0];
check('the goal is there with its criteria', (goal?.criteria ?? []).length >= 5, `${goals.status}`);
check(
	'and its status is derived, not written',
	goal?.status === 'open' && goal?.criteria_met_count === 0,
	JSON.stringify({ status: goal?.status, met: goal?.criteria_met_count })
);

const tasks = await api(`/nodes/contest/${CONTEST}/tasks/?lang=pl`);
check(
	'the tasks are on the board',
	tasks.status === 200 && tasks.body?.length >= 10,
	`${tasks.status}`
);
// By its EXACT title, not by a substring: `e2e/CLAUDE.md` trap 6 in miniature — the first draft of
// this line matched `termin` and found "Wydaj każdą nagrodę w terminie z §3" instead, so two checks
// failed against a feature that was working.
const CLAIM_TASK_TITLE = 'Ustal termin, w którym można ubiegać się o nagrodę';
const claimTask = (tasks.body ?? []).find((t) => t.title === CLAIM_TASK_TITLE);
check(
	'a task carries its citation',
	Boolean(claimTask?.description?.includes('art. 921')),
	claimTask?.description?.slice(0, 120) ?? `no task titled "${CLAIM_TASK_TITLE}"`
);
check(
	'…its verification marker',
	Boolean(claimTask?.description?.includes('sprawdzone w tekście')),
	'the marker word'
);
check(
	'…and that it is not legal advice',
	Boolean(claimTask?.description?.includes('nie jest porada prawna')),
	'the disclaimer'
);
check(
	'every task has somebody on it',
	(tasks.body ?? []).every((t) => (t.assignees ?? []).length >= 1),
	`${(tasks.body ?? []).filter((t) => (t.assignees ?? []).length === 0).length} unassigned`
);

const needs = await api(`/nodes/contest/${CONTEST}/needs/?lang=pl`);
check(
	'the need is open and public',
	needs.body?.[0]?.status === 'open',
	JSON.stringify(needs.body?.[0]?.status)
);
const polls = await api(`/nodes/contest/${CONTEST}/polls/?lang=pl`);
check(
	'the poll is a DRAFT for the jury with two options',
	polls.body?.[0]?.status === 'draft' &&
		polls.body?.[0]?.eligibility === 'staff' &&
		polls.body?.[0]?.options?.length === 2,
	JSON.stringify({
		status: polls.body?.[0]?.status,
		eligibility: polls.body?.[0]?.eligibility,
		options: polls.body?.[0]?.options?.length
	})
);

// --- the browser ------------------------------------------------------------------------------
const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1300, height: 1400 } });
const page = await ctx.newPage();
const errors = [];
let ignoredFonts = 0;
page.on('pageerror', (e) => errors.push(`pageerror: ${String(e).slice(0, 200)}`));
page.on('console', (m) => {
	if (m.type() === 'error') errors.push(m.text().slice(0, 200));
});
// e2e/CLAUDE.md trap 26: in a WORKTREE `frontend/node_modules` is a symlink outside Vite's
// `server.fs.allow`, so KaTeX's webfonts 403 — and the console line for a refused request carries
// no URL in its text, so it has to be matched on the `response` event and counted out loud.
page.on('response', (r) => {
	if (r.status() === 403 && r.url().includes('katex/dist/fonts')) ignoredFonts += 1;
});

/** A crash that is NOT this branch's and is flaky, so it is counted and printed rather than
 *  failing the run — the `ignoredFonts` posture, for a second reason.
 *
 *  `OrganizationsPanel.load()` reads `node.canManage` after an `await`, and `ManagementPanels` sets
 *  `node = null` whenever its key changes — which it does once on every node page, when
 *  `authStore.user` resolves after the anonymous first pass. If the organisations fetch is still in
 *  flight at that moment the panel throws. It is three characters of guard (`loadedFor === key`
 *  before the read, which the same function already does for every assignment), it has nothing to
 *  do with contests, and it reproduces on about one load in three. `todo.md` carries it. */
const KNOWN_PREEXISTING = 'canManage';
let ignoredKnown = 0;

/** A screenshot that cannot end the run.
 *
 *  Looking at these is the point (house rule 2), so a missing one is reported as a failed check —
 *  but `page.screenshot` answered "Target crashed" twice on this machine while another agent was
 *  building, and a capture that falls over is not a reason to throw away fifty checks that already
 *  passed. The check says which picture is missing.
 */
async function shot(name, options = {}) {
	try {
		await page.screenshot({ path: `${OUT}/${name}.png`, ...options });
		return true;
	} catch (e) {
		check(`screenshot ${name}`, false, String(e).split('\n')[0]);
		return false;
	}
}

await page.goto(BASE, { waitUntil: 'load' });
await page.evaluate((t) => localStorage.setItem('edmat-auth-token', t), TOKEN);

console.log('\n== /contests/<id> — the panels the preset filled ==');
await page.goto(`${BASE}/contests/${CONTEST}`, { waitUntil: 'load' });
// Waiting for an element proves nothing about hydration (trap 25): the panels are drawn by the
// client after `/nodes/contest/<id>/` answers, so wait for THAT response rather than for a box.
await page.waitForSelector('[data-fold]', { timeout: 60000 });
await page.waitForTimeout(2500);

/** The number on a folded panel's own line — which is what a reader decides by. */
async function foldCount(key) {
	const row = page.locator(`[data-fold="${key}"] .fold__count`);
	if ((await row.count()) === 0) return null;
	return Number((await row.first().innerText()).trim());
}

for (const [key, wanted] of [
	['goals', 1],
	['tasks', first.created.tasks.length],
	['needs', first.created.needs.length],
	['plans', 1],
	['polls', 1]
]) {
	const got = await foldCount(key);
	check(
		`the ${key} panel is on the contest page with ${wanted} on its line`,
		got === wanted,
		`read ${got}`
	);
}

// Open all five, so the screenshot is of the rows and not of five shut lines.
for (const key of ['goals', 'tasks', 'needs', 'plans', 'polls']) {
	const toggle = page.locator(`[data-fold="${key}"] .fold__toggle`).first();
	if ((await toggle.count()) > 0) {
		await toggle.click();
		await page.waitForTimeout(400);
	}
}
await page.waitForTimeout(1200);
await shot('contests-personalise-1-panels', { fullPage: true });

const pageText = await page.locator('.management-panels').innerText();
check(
	'the goal’s definition of done is drawn',
	pageText.includes('Regulamin jest opublikowany'),
	pageText.slice(0, 160)
);
check(
	'a legal-checklist task is drawn',
	pageText.includes('Powołaj jury'),
	'the jury task on the board'
);
check(
	'the jury need is drawn',
	pageText.includes('Poszukiwany członek jury'),
	'the need on the board'
);
check(
	'the plan’s first step is drawn',
	pageText.includes('Ogłoszenie konkursu'),
	'the plan step on the board'
);
check(
	'the poll question is drawn',
	pageText.includes('Zatwierdzenie końcowego rankingu'),
	'the poll on the board'
);

console.log('\n== /about/contests ==');
await page.goto(`${BASE}/about/contests`, { waitUntil: 'load' });
await page.waitForSelector('.showcase', { timeout: 60000 });
await page.waitForTimeout(1200);
const presetCards = await page.locator('.presets li').count();
check('the ten presets are drawn', presetCards === 10, `${presetCards} cards`);
const lawRows = await page.locator('table.law tbody tr').count();
check('the law table has its rows', lawRows === 6, `${lawRows} rows`);
const markers = await page.locator('table.law .law__marker').count();
check('every law row carries a marker', markers === lawRows, `${markers} markers`);
const showcaseText = await page.locator('.showcase').innerText();
check(
	'it says it is not legal advice',
	showcaseText.includes('nie jest poradą prawną') || showcaseText.includes('not legal advice'),
	showcaseText.slice(0, 120)
);
check(
	'the prize-free default is a chip, not a footnote',
	(await page.locator('.preset__chip--noprize').count()) === 1,
	'exactly one preset promises nothing'
);
check(
	'the two staff-only presets are marked',
	(await page.locator('.preset__chip--staff').count()) === 2,
	'kuratorium and olympiad'
);
await shot('contests-personalise-2-about', { fullPage: true });

console.log('\n== /about and the manual ==');
await page.goto(`${BASE}/about`, { waitUntil: 'load' });
await page.waitForSelector('.showcase-index', { timeout: 60000 });
const indexCards = await page.locator('.showcase-index__card').count();
check('the showcase index now lists eight pages', indexCards === 8, `${indexCards} cards`);

await page.goto(`${BASE}/about/guide`, { waitUntil: 'load' });
await page.waitForTimeout(1200);
const hubText = await page.locator('body').innerText();
check('the manual’s hub lists the contests chapter', hubText.includes('Konkursy'), 'the hub list');
await page.goto(`${BASE}/about/guide/contests`, { waitUntil: 'load' });
await page.waitForTimeout(1200);
const chapterText = await page.locator('body').innerText();
check(
	'the chapter is written, not a placeholder',
	chapterText.includes('Zakładanie: najpierw rodzaj') && chapterText.length > 4000,
	`${chapterText.length} characters`
);
check(
	'and it says its screenshots come after the merge',
	chapterText.includes('zrzuty ekranu') || chapterText.includes('screenshots'),
	'the closing note'
);
await shot('contests-personalise-3-guide', { fullPage: true });

console.log('\n== /work and a profile ==');
await page.goto(`${BASE}/work`, { waitUntil: 'load' });
await page.waitForTimeout(2500);
const workText = await page.locator('body').innerText();
check(
	'the work dashboard loads with no error',
	!workText.includes('Error loading') && !workText.includes('Wczytywanie Twojej pracy'),
	workText.slice(0, 160)
);
// The positive half, which is what makes the negative one below worth anything: the preset put
// seventeen tasks on this account, so the task section HAS to be drawn — and it is also the proof
// that `/work` renders at all, which it did not before `services/work.ts` learned to stringify a
// node id (it threw during render and stayed on "Loading your work…" for ever).
check(
	'…and draws the contest’s own tasks, which is what proves it rendered',
	workText.includes('Opublikuj regulamin ze wszystkimi wymaganymi paragrafami'),
	workText.slice(0, 300)
);
// HONEST, not a weak assertion: `contests/work.py` is step A's and answers `[]` on this branch, so
// `collect()` drops all four sections. What is verified here is that the SECTIONS are registered
// (the backend test does that) and that registering them did not break the page.
check(
	'…and none of the four contest sections is drawn, because step A owns their rows',
	!workText.includes('Zgłoszenia do rozpatrzenia'),
	'a section with no rows is dropped by collect()'
);
// NOT `fullPage`: with seventeen tasks and ten plan steps on it this page is six thousand pixels
// tall, and a full-page capture of it crashed the Chromium tab outright on this machine. The top of
// the page is what the checks above read anyway.
await shot('contests-personalise-4-work');

const userId = me.body.id;
const consentBefore = (await api('/education/me/')).body?.share_activity ?? null;
await fetch(`${API}/education/me/`, {
	method: 'PATCH',
	headers: { 'Content-Type': 'application/json', Authorization: `Token ${TOKEN}` },
	body: JSON.stringify({ share_activity: true })
});
// Wait for the record's OWN request, not for a timeout: it is fetched in a second `$effect` after
// the profile itself and arrived after 2500 ms once on a loaded machine, which read as "the block
// is missing" (`e2e/CLAUDE.md` trap 27, one layer out).
const recordLoaded = page.waitForResponse((r) => r.url().includes('/learning-record/'), {
	timeout: 60000
});
await page.goto(`${BASE}/users/${userId}`, { waitUntil: 'load' });
await recordLoaded.catch(() => {});
await page.waitForTimeout(1200);
// The learning record is a ROW on the profile that opens a modal, not a section drawn on the page
// (`routes/users/[id]/+page.svelte`) — asserting its heading against the page text found nothing
// and said "the block is missing" about a block that was simply shut.
const recordRow = page.locator('button.row', { hasText: 'Historia nauki' }).first();
const hasRecordRow = (await recordRow.count()) === 1;
check('the learning-record row is on the profile', hasRecordRow, 'the consent is on');
if (hasRecordRow) {
	await recordRow.click();
	await page.waitForTimeout(900);
	const modalText = await page.locator('.modal-panel').first().innerText();
	check(
		'…and it draws the Contests block behind that consent',
		modalText.includes('Konkursy'),
		modalText.slice(0, 200)
	);
	check(
		'…empty, honestly, because step A owns the result rows',
		modalText.includes('Nie ma tu jeszcze czego pokazać') || modalText.includes('Nothing to show'),
		'the empty-block sentence'
	);
}
await shot('contests-personalise-5-profile');
if (consentBefore !== null) {
	await fetch(`${API}/education/me/`, {
		method: 'PATCH',
		headers: { 'Content-Type': 'application/json', Authorization: `Token ${TOKEN}` },
		body: JSON.stringify({ share_activity: consentBefore })
	});
}

const unexpected = errors.filter((e) => {
	if (e.includes(KNOWN_PREEXISTING)) {
		ignoredKnown += 1;
		return false;
	}
	return true;
});
check(
	'no console or page errors anywhere',
	unexpected.length === 0,
	unexpected.slice(0, 4).join(' | ') || ''
);
if (ignoredKnown > 0)
	console.log(`  (ignored ${ignoredKnown} OrganizationsPanel canManage races — see the header)`);
if (ignoredFonts > 0) console.log(`  (ignored ${ignoredFonts} worktree KaTeX font 403s — trap 26)`);

// --- cleanup, and the re-query that proves it -------------------------------------------------
console.log('\n== cleanup ==');
const left = shell(`
import json
from contests.models import Contest
from config import nodes
from plans.models import Plan
from goals.models import Goal
from tasks.models import Task
from needs.models import Need
from decisions.models import Poll
from activity.models import ActivityEvent

contest = Contest.objects.filter(title=${JSON.stringify(TITLE)}).first()
if contest is None:
    print(json.dumps({'rows': 0, 'feed': 0}))
else:
    where = {'content_type': nodes.node_content_type(contest), 'object_id': contest.pk}
    for model in (Plan, Goal, Task, Need, Poll):
        model.objects.filter(**where).delete()
    rows = sum(model.objects.filter(**where).count() for model in (Plan, Goal, Task, Need, Poll))
    contest.delete()
    print(json.dumps({
        'rows': rows,
        'feed': ActivityEvent.objects.filter(target_label=${JSON.stringify(TITLE)}).count(),
        'contests': Contest.objects.filter(title=${JSON.stringify(TITLE)}).count(),
    }))
`);
check('every row this run created is gone', left.rows === 0, JSON.stringify(left));
check('the contest is gone', (left.contests ?? 0) === 0, JSON.stringify(left));
check(
	'and its feed rows went with it (the FK cascades)',
	(left.feed ?? 0) === 0,
	JSON.stringify(left)
);

await browser.close();
console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
