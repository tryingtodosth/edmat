// Tasks (MANAGEMENT-BRIEF.md §3.B): an organiser opens the task panel on a real event page, writes
// a task with a due date already in the past, puts a volunteer on it through the picker fed by the
// shared roster endpoint, moves it along the transition table, folds a step under it and watches
// the recounted progress appear. The volunteer then sees the same task from her side — she may edit
// it because she is on it, and she may NOT assign, because that is the organiser's. `/tasks` lists
// it for her, `/tasks/{id}` resolves on its own, an anonymous reader gets no panel at all on the
// very same public event page, and the `tasks` kill switch takes the panel, the menu entry and the
// page away while the event page keeps working.
//
// Kasia (host, seeded staff account) and Ola (volunteer), two contexts. Everything it makes it
// removes, through the real API, and confirms by re-query.
//
//   E2E_BASE=http://localhost:5222 E2E_API=http://127.0.0.1:8122 node e2e/tasks.mjs
let chromium;
try {
	({ chromium } = await import('playwright'));
} catch {
	({ chromium } = await import('playwright-core'));
}
import { englishContext } from './english.mjs';

const BASE = process.env.E2E_BASE ?? 'http://localhost:5173';
const API = process.env.E2E_API ?? 'http://localhost:8000';
let pass = 0,
	fail = 0;
const errors = [];
const check = (label, ok, extra = '') => {
	if (ok) pass++;
	else fail++;
	console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${label} ${ok ? '' : extra}`);
};

const browser = await chromium.launch(
	process.env.CHROME ? { executablePath: process.env.CHROME } : {}
);
// English on the CONTEXT, before the first navigation (e2e/CLAUDE.md trap 24): the interface
// default is Polish, and every assertion below names an English string.
const mk = async () => {
	const context = await englishContext(browser, BASE, {
		viewport: { width: 1280, height: 1100 }
	});
	const p = await context.newPage();
	p.on('console', (msg) => {
		if (msg.type() === 'error') errors.push(`[${p.url()}] ${msg.text()}`);
	});
	p.on('pageerror', (e) => errors.push(e.message));
	return p;
};
const settle = (p, ms = 900) => p.waitForTimeout(ms);
// A card draws its own subtasks with the SAME component, so `card.locator('.task__title')` matches
// the parent AND every step under it and Playwright refuses it in strict mode. Everything below
// that reads one card's own row goes through these two, which walk direct children only.
const titleOf = (card) => card.locator('> .task__head > .task__title');
const statusOf = (card) => card.locator('> .task__head > .status');
const ownActions = (card) => card.locator('> .actions');

const tokenFor = async (email) => {
	const r = await fetch(`${API}/api/auth/login/`, {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify({ username: email, password: 'password123' })
	});
	return (await r.json()).token;
};
const kasia = await tokenFor('kasia@edmat.example');
const ola = await tokenFor('ola@edmat.example');
const auth = (t) => ({ 'Content-Type': 'application/json', Authorization: `Token ${t}` });
const olaId = (await (await fetch(`${API}/api/auth/me/`, { headers: auth(ola) })).json()).id;

const MARKER = 'Tasks e2e — the open day';
const setFlag = (on) =>
	fetch(`${API}/api/feature-flags/tasks/`, {
		method: 'PATCH',
		headers: auth(kasia),
		body: JSON.stringify({ is_enabled: on })
	});

const login = async (p, email) => {
	// **Wait for the root layout's own boot request before touching the form** (e2e/CLAUDE.md trap
	// 25). Every control on /login is in the server-rendered HTML, so the locators resolve and the
	// click lands — and does nothing at all — until the bundle has hydrated, which on a cold dev
	// server is many seconds. The first version of this script clicked into an unhydrated form and
	// failed 25 s later at `waitForURL`, which reads exactly like a broken login page.
	const boot = p
		.waitForResponse((r) => r.url().includes('/feature-flags/'), { timeout: 90000 })
		.catch(() => null);
	await p.goto(`${BASE}/login`, { waitUntil: 'load', timeout: 90000 });
	await boot;
	await settle(p, 1500);
	// The identifier field is `type="text"` since the guardian accounts (e2e/CLAUDE.md trap 13).
	await p.locator('form input[autocomplete="username"]').fill(email);
	await p.locator('form input[type="password"]').fill('password123');
	await p.locator('form button[type="submit"]').click();
	try {
		await p.waitForURL((u) => !u.pathname.includes('/login'), { timeout: 25000 });
	} catch {
		// One retry: a click that landed in the same tick as Vite's dependency-optimizer reload
		// (trap 22) is swallowed whole, and the page is still perfectly usable afterwards.
		await settle(p, 1500);
		await p.locator('form button[type="submit"]').click();
		await p.waitForURL((u) => !u.pathname.includes('/login'), { timeout: 40000 });
	}
};

// The datetime-local control wants "YYYY-MM-DDTHH:mm" in LOCAL time, not an ISO instant.
const localInput = (d) => {
	const pad = (n) => String(n).padStart(2, '0');
	return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
};

let EV = null;
let kPage, oPage, anonPage;

try {
	// -----------------------------------------------------------------------------------------
	console.log('\n[0] a real public event, with Ola on staff, and the switch on');
	for (const e of await (
		await fetch(`${API}/api/events/?mine=hosting`, { headers: auth(kasia) })
	).json()) {
		if (e.title === MARKER)
			await fetch(`${API}/api/events/${e.id}/`, { method: 'DELETE', headers: auth(kasia) });
	}
	await setFlag(true);
	const start = new Date(Date.now() + 9 * 86400e3);
	start.setHours(9, 0, 0, 0);
	const event = await (
		await fetch(`${API}/api/events/`, {
			method: 'POST',
			headers: auth(kasia),
			body: JSON.stringify({
				title: MARKER,
				status: 'published',
				visibility: 'public',
				starts_at: start.toISOString(),
				duration_minutes: 180,
				location_kind: 'onsite',
				location_text: 'Main hall',
				audience: 'university'
			})
		})
	).json();
	EV = event.id;
	check('the event exists', Boolean(EV), JSON.stringify(event).slice(0, 200));
	const staffed = await fetch(`${API}/api/events/${EV}/staff/`, {
		method: 'POST',
		headers: auth(kasia),
		body: JSON.stringify({ user: Number(olaId), role: 'volunteer' })
	});
	check('Ola joins the staff', staffed.status === 201, String(staffed.status));

	// -----------------------------------------------------------------------------------------
	console.log('\n[1] the organiser writes a task on the event page');
	kPage = await mk();
	await login(kPage, 'kasia@edmat.example');
	await kPage.goto(`${BASE}/events/${EV}`, { waitUntil: 'load', timeout: 60000 });
	const panel = kPage.locator('[data-testid="tasks-panel"]');
	await panel.waitFor({ timeout: 30000 });
	check('the tasks panel is on the event page for the organiser', await panel.isVisible());
	// Wait for the line rather than reading whatever is there: the first thing `.status-line` says
	// is "Loading…", and a check that fires 900 ms after the panel appears is racing the fetch.
	const emptyLine = panel.locator('.status-line', { hasText: 'Nothing on the board' });
	await emptyLine.waitFor({ timeout: 20000 });
	check('an empty board says so rather than showing nothing', await emptyLine.isVisible());

	await panel.getByRole('button', { name: 'Add a task', exact: true }).click();
	const addForm = panel.locator('> form.task-form');
	await addForm.waitFor({ timeout: 10000 });
	await addForm.locator('input[type="text"]').fill('Print the badges');
	await addForm.locator('textarea').fill('200 of them, plus spares.');
	await addForm.locator('select').selectOption('1');
	const yesterday = new Date(Date.now() - 86400e3);
	await addForm.locator('input[type="datetime-local"]').fill(localInput(yesterday));
	await addForm.locator('button[type="submit"]').click();
	await settle(kPage, 1300);

	const card = panel.locator('article.task').first();
	await card.waitFor({ timeout: 15000 });
	check('the task appears on the board', (await titleOf(card).innerText()) === 'Print the badges');
	check(
		'its priority chip reads Urgent',
		(await card.locator('> .task__head > .pri').innerText()).includes('Urgent')
	);
	check(
		'a due date already past is drawn as overdue',
		(await card.locator('> .meta > .due--late').count()) === 1
	);
	check(
		'it lands in the To do column',
		(await panel.locator('.column h3').first().innerText()).toLowerCase().includes('to do')
	);
	check(
		'nobody is on it yet',
		(await card.locator('> .assignees > .assignees__none').count()) === 1
	);

	// -----------------------------------------------------------------------------------------
	console.log('\n[2] the picker is fed by the shared roster endpoint');
	await card.getByRole('button', { name: 'Put somebody on it', exact: true }).click();
	// The roster is fetched when the picker opens, so wait for a real option to exist before
	// reading the list — `allInnerTexts()` on a select that only has its placeholder yet is a
	// vacuous read, and it is also exactly what the duplicate-key bug looked like.
	// `state: 'attached'` and NOT the default `'visible'`: an `<option>` inside a closed `<select>`
	// has no bounding box, so Playwright never calls one visible and a plain `waitFor()` here times
	// out against a picker that is working perfectly.
	await card.locator('.picker select option').nth(1).waitFor({ state: 'attached', timeout: 20000 });
	const options = await card.locator('.picker select option').allInnerTexts();
	check(
		'the picker offers the node roster and nobody else',
		options.length >= 2 && options.some((o) => o.toLowerCase().includes('ola')),
		options.join(' | ')
	);
	// **By Ola's account id, never by position.** The roster comes back ordered by pk and the host
	// is on it too, so `{ index: 1 }` picked KASIA — and every later check about "the volunteer may
	// edit what she is carrying" then failed against a task she was not on. Positional locators lie
	// (e2e/CLAUDE.md trap 6), and a picker fed by a roster is exactly where.
	await card.locator('.picker select').selectOption(String(olaId));
	await card.locator('.picker button:not(.link)').click();
	await settle(kPage, 1200);
	const chip = card.locator('.chips .chip').first();
	await chip.waitFor({ timeout: 15000 });
	check(
		'the assignee appears as a chip, and it is the volunteer',
		(await card.locator('.chips .chip').count()) === 1 &&
			(await chip.innerText()).toLowerCase().includes('ola'),
		await chip.innerText()
	);

	// -----------------------------------------------------------------------------------------
	console.log('\n[3] the transition table, and a step folded under it');
	await card.getByRole('button', { name: 'Start', exact: true }).click();
	await settle(kPage, 1100);
	check(
		'the task moves to In progress and the column follows it',
		(await statusOf(card).innerText()).includes('In progress')
	);
	check(
		'the forward button is now Send to review, not Start',
		(await ownActions(card).getByRole('button', { name: 'Start', exact: true }).count()) === 0 &&
			(await ownActions(card)
				.getByRole('button', { name: 'Send to review', exact: true })
				.count()) === 1
	);

	await card.getByRole('button', { name: 'Add a step', exact: true }).click();
	const stepForm = card.locator('.steps form.task-form');
	await stepForm.waitFor({ timeout: 10000 });
	await stepForm.locator('input[type="text"]').fill('Order the lanyards');
	await stepForm.locator('button[type="submit"]').click();
	await settle(kPage, 1400);
	check(
		'the step lands under its parent',
		(await card.locator('.steps article.task').count()) === 1
	);
	check(
		'progress is recounted and printed',
		(await card.locator('> .meta > .progress').innerText()).includes('0 of 1')
	);
	check(
		'a step offers no step of its own (one level, 409 nested)',
		(await ownActions(card.locator('.steps article.task').first())
			.getByRole('button', { name: 'Add a step', exact: true })
			.count()) === 0
	);
	await kPage.screenshot({ path: 'e2e/screens/tasks-organiser.png', fullPage: true });

	// -----------------------------------------------------------------------------------------
	console.log('\n[4] the volunteer sees the same task, and a different set of buttons');
	oPage = await mk();
	await login(oPage, 'ola@edmat.example');
	await oPage.goto(`${BASE}/events/${EV}`, { waitUntil: 'load', timeout: 60000 });
	const oPanel = oPage.locator('[data-testid="tasks-panel"]');
	await oPanel.waitFor({ timeout: 30000 });
	const oCard = oPanel.locator('article.task').first();
	await oCard.waitFor({ timeout: 15000 });
	check('the volunteer sees the board', (await titleOf(oCard).innerText()) === 'Print the badges');
	check(
		'she may edit it, because she is on it',
		(await ownActions(oCard).getByRole('button', { name: 'Edit', exact: true }).count()) === 1
	);
	check(
		'she may NOT put anybody on it — that is the organiser’s',
		(await oCard
			.locator('> .assignees')
			.getByRole('button', { name: 'Put somebody on it', exact: true })
			.count()) === 0
	);
	await oPanel.getByRole('button', { name: 'Mine', exact: true }).click();
	await settle(oPage, 1200);
	check(
		'the Mine filter still finds it',
		(await titleOf(oPanel.locator('article.task').first()).innerText()) === 'Print the badges'
	);

	console.log('\n[5] /tasks and /tasks/{id}');
	await oPage.goto(`${BASE}/tasks`, { waitUntil: 'load', timeout: 60000 });
	const waiting = oPage.locator('.page section').first();
	await waiting.waitFor({ timeout: 25000 });
	await oPage.locator('article.task').first().waitFor({ timeout: 25000 });
	check(
		'"Waiting on you" lists the task',
		(await titleOf(oPage.locator('article.task').first()).innerText()) === 'Print the badges'
	);
	check(
		'and says what it hangs on',
		(await oPage.locator('article.task > .meta > .on-node').first().innerText()).includes(MARKER)
	);
	await oPage.screenshot({ path: 'e2e/screens/tasks-mine.png', fullPage: true });

	const taskId = await (async () => {
		const rows = await (await fetch(`${API}/api/tasks/mine/`, { headers: auth(ola) })).json();
		return rows.assigned[0].id;
	})();
	await oPage.goto(`${BASE}/tasks/${taskId}`, { waitUntil: 'load', timeout: 60000 });
	await oPage.locator('article.task').first().waitFor({ timeout: 25000 });
	check(
		'a task resolves on its own page',
		(await titleOf(oPage.locator('article.task').first()).innerText()) === 'Print the badges'
	);

	console.log('\n[6] an anonymous reader on the same public event page');
	anonPage = await mk();
	await anonPage.goto(`${BASE}/events/${EV}`, { waitUntil: 'load', timeout: 60000 });
	await settle(anonPage, 2000);
	check(
		'the event page itself works for a stranger',
		(await anonPage.locator('h1').first().innerText()).includes('open day')
	);
	check(
		'and there is no task panel on it at all',
		(await anonPage.locator('[data-testid="tasks-panel"]').count()) === 0
	);

	// -----------------------------------------------------------------------------------------
	console.log('\n[7] the kill switch takes the links, not just the pages (house rule 3)');
	await setFlag(false);
	await oPage.goto(`${BASE}/events/${EV}`, { waitUntil: 'load', timeout: 60000 });
	await settle(oPage, 2200);
	check(
		'the panel is gone from the event page',
		(await oPage.locator('[data-testid="tasks-panel"]').count()) === 0
	);
	check(
		'while the event page keeps working',
		(await oPage.locator('h1').first().innerText()).includes('open day')
	);
	await oPage.locator('.account-trigger').click();
	await settle(oPage, 500);
	const menuOff = await oPage.locator('.popover__panel').innerText();
	check('the account menu no longer offers My tasks', !menuOff.includes('My tasks'));
	await oPage.goto(`${BASE}/tasks`, { waitUntil: 'load', timeout: 60000 });
	await settle(oPage, 1400);
	check(
		'and the page itself shows the disabled notice',
		(await oPage.locator('.feature-disabled').count()) === 1
	);

	await setFlag(true);
	await oPage.goto(`${BASE}/events/${EV}`, { waitUntil: 'load', timeout: 60000 });
	await settle(oPage, 2200);
	await oPage.locator('.account-trigger').click();
	await settle(oPage, 500);
	check(
		'switched back on, the menu entry returns',
		(await oPage.locator('.popover__panel').innerText()).includes('My tasks')
	);

	// -----------------------------------------------------------------------------------------
	console.log('\n[8] refusals the API answers in words');
	const t = await (await fetch(`${API}/api/tasks/mine/`, { headers: auth(ola) })).json();
	const id = t.assigned[0].id;
	const illegal = await fetch(`${API}/api/tasks/${id}/transition/`, {
		method: 'POST',
		headers: auth(kasia),
		body: JSON.stringify({ status: 'done' })
	});
	check(
		'in_progress -> done is 409 illegal_transition',
		illegal.status === 409 && (await illegal.json()).reason === 'illegal_transition',
		String(illegal.status)
	);
	const notStaff = await fetch(`${API}/api/tasks/${id}/assign/`, {
		method: 'POST',
		headers: auth(kasia),
		body: JSON.stringify({ user: 999999 })
	});
	check(
		'assigning somebody off the roster is 400 not_staff',
		notStaff.status === 400 && (await notStaff.json()).reason === 'not_staff',
		String(notStaff.status)
	);
	const hasSubtasks = await fetch(`${API}/api/tasks/${id}/`, {
		method: 'DELETE',
		headers: auth(kasia)
	});
	check(
		'deleting a task that has steps is 409 has_subtasks',
		hasSubtasks.status === 409 && (await hasSubtasks.json()).reason === 'has_subtasks',
		String(hasSubtasks.status)
	);
	const undefinedId = await fetch(`${API}/api/tasks/undefined/`, { headers: auth(kasia) });
	check(
		'/api/tasks/undefined/ is a 404, not a 500',
		undefinedId.status === 404,
		String(undefinedId.status)
	);
} catch (e) {
	// Without this the `finally` below would `process.exit(0)` on a thrown locator timeout and the
	// run would report "4/4 checks passed" for a script that never reached check five — a vacuous
	// pass of exactly the kind e2e/CLAUDE.md trap 8 is about.
	fail++;
	console.log(`  FAIL the run threw: ${e && e.message ? e.message.split('\n')[0] : e}`);
} finally {
	// -----------------------------------------------------------------------------------------
	console.log('\n[9] cleanup, confirmed by re-query');
	await setFlag(true);
	if (EV) {
		const rows = await (
			await fetch(`${API}/api/nodes/event/${EV}/tasks/`, { headers: auth(kasia) })
		).json();
		for (const row of Array.isArray(rows) ? rows : []) {
			for (const child of row.subtasks ?? [])
				await fetch(`${API}/api/tasks/${child.id}/`, { method: 'DELETE', headers: auth(kasia) });
			await fetch(`${API}/api/tasks/${row.id}/`, { method: 'DELETE', headers: auth(kasia) });
		}
		// An AUTHENTICATED re-query: an anonymous list would come from the 60 s read cache
		// (e2e/CLAUDE.md trap 12) and could still show a row that is genuinely gone.
		const left = await (
			await fetch(`${API}/api/nodes/event/${EV}/tasks/`, { headers: auth(kasia) })
		).json();
		check(
			'every task this run made is gone',
			Array.isArray(left) && left.length === 0,
			JSON.stringify(left).slice(0, 200)
		);
		await fetch(`${API}/api/events/${EV}/`, { method: 'DELETE', headers: auth(kasia) });
	}
	check('no console or page errors anywhere', errors.length === 0, errors.slice(0, 5).join(' || '));
	await browser.close();
	console.log(`\n${pass}/${pass + fail} checks passed`);
	process.exit(fail === 0 ? 0 : 1);
}
