// Content management on the board rows (2026-10-10, the owner's ask: "add content management (eg
// edit, add attachement (ag a comment),) to needs and etc"). Five things, and the first is the one
// that would have gone unnoticed:
//
//   1. a plain edit of a TRANSLATED row is actually visible — and survives a reload. Until this
//      day it did not: `translations.resolve` reads a `TextVersion` whenever the row has one and
//      falls back to the row's own column only when it has none, so every management write
//      serializer was changing a column no reader ever saw. A 200 came back with the OLD text in
//      it and nothing anywhere went red;
//   2. a need's eight fields can be edited at all, from the `⋯` on its own page — `PATCH
//      /api/needs/{id}/` has always taken them and nothing in the app ever sent them;
//   3. a need's description is RENDERED (Markdown + this site's LaTeX), where it used to be drawn
//      as plain text inside a `<p>`;
//   4. attachments are on the need, and a `.md` becomes rendered text rather than a download;
//   5. a goal card on a board carries a DEFERRED panel — nothing is fetched until the reader opens
//      that card's own section, so a board does not pay a request per row.
//
// Run (ports must match whatever `run.sh` set up):
//   E2E_BASE=http://localhost:5173 E2E_NEED=13 \
//     E2E_OWNER_TOKEN=<token of somebody who MANAGES the edmat organisation> \
//     node e2e/needs-content-management.mjs
//
// **`E2E_OWNER_TOKEN` is required and cannot be logged in for** (e2e/CLAUDE.md traps 30 and 32):
// editing a board row is a node manager's act, `can_manage_node` has no `is_staff` bypass, and the
// seeded `admin` is not an owner of the `edmat` organisation. The UI is Polish, because `pl` is the
// base locale (trap 24) — the assertions below read Polish copy on purpose.
//
// It restores everything it changes: the title, the description, the wanted count, and the
// attachment it writes is withdrawn.
import { mkdirSync } from 'node:fs';

let chromium;
try {
	({ chromium } = await import('playwright'));
} catch {
	({ chromium } = await import('playwright-core'));
}

const BASE = process.env.E2E_BASE ?? 'http://localhost:5173';
const API = process.env.E2E_API ?? 'http://127.0.0.1:8000/api';
const TOKEN = process.env.E2E_OWNER_TOKEN ?? '';
const NEED = process.env.E2E_NEED ?? '13';
const OUT = 'e2e/screens';
mkdirSync(OUT, { recursive: true });

if (!TOKEN) {
	console.error('E2E_OWNER_TOKEN is not set — every write below would be refused, which would be');
	console.error('this script failing for the rule working. See the header.');
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

// What the row said before anything was touched — both languages, because the English baseline is
// what proves the edit did not quietly overwrite the translation, and it has to be read BEFORE the
// edit to be a baseline at all.
const auth = { headers: { Authorization: `Token ${TOKEN}` } };
const before = await fetch(`${API}/needs/${NEED}/?lang=pl`, auth).then((r) => r.json());
const beforeEnTitle = await fetch(`${API}/needs/${NEED}/?lang=en`, auth)
	.then((r) => r.json())
	.then((d) => d.title);

// Everything that TOUCHES the row happens inside the try below, and the restore is in its
// `finally`: the first two runs of this script threw at a locator before reaching the cleanup, and
// the third then "restored" the row to the scratch title the second run had left on it — a cleanup
// that only runs on success is a cleanup that fails exactly when it is needed.
let threw = null;
// Declared out here so the cleanup can remove it even when a check above throws — the crashed
// second run left a goal behind on the dev board exactly this way.
let madeGoal = null;
const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1300, height: 1400 } });
await ctx.addInitScript((t) => {
	try {
		localStorage.setItem('edmat-auth-token', t);
	} catch {
		/* a private window: the script then runs signed out and says so by failing */
	}
}, TOKEN);
const page = await ctx.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(String(e).slice(0, 200)));
page.on('console', (m) => {
	if (m.type() === 'error') errors.push(m.text().slice(0, 200));
});

try {
	const NEW_TITLE = 'E2E: ogłoszenie po edycji';
	const NEW_BODY = 'Zażółć gęślą jaźń. Wzór: \\( x^2 + y^2 = r^2 \\)';

	await page.goto(`${BASE}/needs/${NEED}`, { waitUntil: 'load' });
	await page.waitForSelector('h1', { timeout: 60000 });
	await page.waitForTimeout(1500);

	// ---- 2. the menu exists at all, on the page a shared link lands on --------------------------
	// Scoped to the heading's own menu: the header carries a `[role="menu"]` of its own, so an
	// unscoped `allInnerTexts()` reads the account menu's twenty items along with these three
	// (e2e/CLAUDE.md trap 5 — the first run of this script failed there and nowhere else).
	const rowMenu = page.locator('.head .meatballs');
	check('the need’s own page has a ⋯ menu', (await rowMenu.count()) === 1);
	await rowMenu.locator('button[aria-label="Działania dla tego ogłoszenia"]').first().click();
	await page.waitForTimeout(400);
	const menuItems = rowMenu.locator('[role="menu"] button');
	const items = await menuItems.allInnerTexts();
	check(
		'it offers the fields, both languages, and cancel/reopen',
		items.some((t) => /Edytuj ogłoszenie/.test(t)) &&
			items.some((t) => /w obu językach|both languages/i.test(t)) &&
			items.some((t) => /Anuluj to ogłoszenie|Otwórz ponownie/.test(t)),
		items.join(' | ')
	);

	await menuItems
		.filter({ hasText: /Edytuj ogłoszenie/ })
		.first()
		.click();
	await page.waitForTimeout(600);

	const dialog = page.locator('[role="dialog"], dialog').first();
	const form = dialog.locator('form.need-form');
	check('the “Edit” item opens the eight-field form', (await form.count()) === 1);
	const fieldLabels = await form.locator('label').allInnerTexts();
	check(
		'and it carries the fields that were create-only until today',
		['Rodzaj', 'Ile osób', 'Termin', 'Szacowany czas'].every((want) =>
			fieldLabels.some((t) => t.includes(want))
		),
		fieldLabels.map((t) => t.split('\n')[0]).join(' | ')
	);
	await page.screenshot({ path: `${OUT}/needs-edit-form.png` });

	// Title, description and one plain field in ONE submission.
	await form.locator('label', { hasText: 'Tytuł' }).locator('input').fill(NEW_TITLE);
	await form.locator('label', { hasText: 'Opis' }).locator('textarea').fill(NEW_BODY);
	await form.locator('label', { hasText: 'Ile osób' }).locator('input').fill('5');
	await form.locator('button[type="submit"]').first().click();
	await page.waitForTimeout(2000);

	check('the dialog closes on a save the server took', (await dialog.count()) === 0);
	check('the new title is on the page', (await page.locator('h1').innerText()).includes(NEW_TITLE));
	check(
		'the plain field went with it',
		/Obsadzono \d+ z 5/.test(await page.locator('.meta').innerText()),
		await page.locator('.meta').innerText()
	);

	// ---- 1. the bug this pass was really about ---------------------------------------------------
	// A reload is the whole test: the write that was invisible also came BACK correct in its own
	// response (DRF answers from the instance it just saved), so only a fresh read tells the truth.
	await page.reload({ waitUntil: 'load' });
	await page.waitForSelector('h1', { timeout: 60000 });
	await page.waitForTimeout(1500);
	check(
		'and it is still there after a reload — the edit reached where the reader looks',
		(await page.locator('h1').innerText()).includes(NEW_TITLE),
		await page.locator('h1').innerText()
	);

	const fresh = await fetch(`${API}/needs/${NEED}/?lang=pl`, auth).then((r) => r.json());
	const freshEn = await fetch(`${API}/needs/${NEED}/?lang=en`, auth).then((r) => r.json());
	check('the Polish reading is the new text', fresh.title === NEW_TITLE, fresh.title);
	check(
		'the English translation was left alone, not silently overwritten',
		freshEn.title === beforeEnTitle,
		`${freshEn.title}`
	);
	check(
		'and the English reader is told the Polish is newer, which is true',
		freshEn.language?.newer_elsewhere?.locale === 'pl',
		JSON.stringify(freshEn.language?.newer_elsewhere)
	);

	// ---- 3. the body is rendered, not printed ----------------------------------------------------
	check(
		'the description is rendered Markdown + LaTeX, not plain text',
		(await page.locator('.description .katex').count()) > 0,
		await page.locator('.description').innerText()
	);

	// ---- 4. attachments on the need --------------------------------------------------------------
	const panel = page.locator('[data-fold="attachments"]');
	check('the need has an attachments panel', (await panel.count()) === 1);
	await panel.locator('.fold__toggle').first().click();
	await page.waitForTimeout(600);
	await panel
		.locator('button')
		.filter({ hasText: /Załącz coś/ })
		.first()
		.click();
	await page.waitForTimeout(400);
	await panel.locator('input[type="text"]').first().fill('E2E: notatka do ogłoszenia');
	await panel
		.locator('input[type="file"]')
		.first()
		.setInputFiles({
			name: 'notatka.md',
			mimeType: 'text/markdown',
			buffer: Buffer.from('# Ustalenia\n\nWzór: \\( a^2 + b^2 = c^2 \\)')
		});
	await panel.locator('button[type="submit"]').first().click();
	await page.waitForTimeout(2500);
	const textRow = panel.locator('[data-attachment-kind="text"]').first();
	check('a .md attached to a need becomes rendered text', (await textRow.count()) === 1);
	check(
		'and its maths is typeset in place',
		(await textRow.locator('.katex').count()) > 0,
		await textRow.innerText()
	);
	await page.screenshot({ path: `${OUT}/needs-attachments.png`, fullPage: false });

	// ---- 5. a goal card on a board defers its panel ----------------------------------------------
	// It writes its own goal, because `deferred` is only used where a card is drawn PER ROW, and the
	// dev database has no goals at all — a check that passes on an empty board is the vacuous pass
	// e2e/CLAUDE.md trap 8 is about.
	const ORG = process.env.E2E_ORG ?? '3';
	madeGoal = await fetch(`${API}/nodes/organization/${ORG}/goals/`, {
		method: 'POST',
		headers: { Authorization: `Token ${TOKEN}`, 'Content-Type': 'application/json' },
		body: JSON.stringify({ title: 'E2E: cel do sprawdzenia załączników', description: '' })
	}).then((r) => (r.ok ? r.json() : null));
	check('a goal can be written to hang the panel off', madeGoal !== null);

	if (madeGoal) {
		await page.goto(`${BASE}/about`, { waitUntil: 'load' });
		await page.waitForTimeout(3000);
		const goalsFold = page.locator('[data-fold="goals"]');
		// Its open/shut state is remembered per reader (`foldedSections`), so clicking blindly is as
		// likely to close it as to open it — which is how the first run of this script found "0 goal
		// cards" on a board that had one.
		if (!(await goalsFold.evaluate((e) => e.classList.contains('fold--open')))) {
			await goalsFold.locator('.fold__toggle').first().click();
		}
		await page.waitForTimeout(2500);
		const own = page.locator(`[data-fold="attachments:goal:${madeGoal.id}"]`);
		check(
			'the goal card on the board carries its own attachments section',
			(await own.count()) === 1
		);
		check(
			'shut, it shows no count — nothing has been counted yet (deferred)',
			(await own.locator('.fold__count').count()) === 0
		);
		const loads = page.waitForResponse(
			(r) => r.url().includes(`/goal/${madeGoal.id}/attachments/`),
			{
				timeout: 15000
			}
		);
		await own.locator('.fold__toggle').first().click();
		let fetched = true;
		try {
			await loads;
		} catch {
			fetched = false;
		}
		check('opening it is what fetches it — the request is made on the click', fetched);
		await page.waitForTimeout(1200);
		check(
			'and then it says what is there',
			/Nic jeszcze nie załączono|Załącz coś/.test(await own.innerText()),
			(await own.innerText()).slice(0, 120)
		);
		await page.screenshot({ path: `${OUT}/needs-goal-attachments.png`, fullPage: false });
	}
	// ---- 6. the other three row surfaces ---------------------------------------------------------
	// One panel each, eager, because each of these pages holds ONE row — the deferred mode is for a
	// board that draws a card per row. Asserted by their fold keys, which is also what proves the
	// keys are per-target (two panels sharing one key share their open state).
	const TASK = process.env.E2E_TASK ?? '13';
	const PLAN = process.env.E2E_PLAN ?? '24';
	const POLL = process.env.E2E_POLL ?? '8';

	await page.goto(`${BASE}/tasks/${TASK}`, { waitUntil: 'load' });
	await page.waitForTimeout(2500);
	check(
		'a task page carries its own attachments section',
		(await page.locator(`[data-fold="attachments:task:${TASK}"]`).count()) === 1
	);

	await page.goto(`${BASE}/plans/${PLAN}`, { waitUntil: 'load' });
	await page.waitForTimeout(2500);
	check('a plan page carries one', (await page.locator('[data-fold="attachments"]').count()) === 1);

	await page.goto(`${BASE}/polls/${POLL}`, { waitUntil: 'load' });
	await page.waitForTimeout(2500);
	check(
		'a poll page carries one — the kind that joined the registry today',
		(await page.locator('[data-fold="attachments"]').count()) === 1
	);
	await page.screenshot({ path: `${OUT}/needs-poll-attachments.png`, fullPage: false });
} catch (err) {
	threw = err;
	failed += 1;
	console.log(`  FAIL the script ran to the end — ${String(err).split('\n')[0]}`);
}

// ---- put it back -----------------------------------------------------------------------------
const restore = await fetch(`${API}/needs/${NEED}/`, {
	method: 'PATCH',
	headers: { Authorization: `Token ${TOKEN}`, 'Content-Type': 'application/json' },
	body: JSON.stringify({
		title: before.title,
		description: before.description,
		wanted_count: before.wantedCount ?? before.wanted_count
	})
});
check('the row is restored', restore.ok, `${restore.status}`);

if (madeGoal) {
	const gone = await fetch(`${API}/goals/${madeGoal.id}/`, {
		method: 'DELETE',
		headers: { Authorization: `Token ${TOKEN}` }
	});
	check('the scratch goal is removed', gone.ok || gone.status === 204, `${gone.status}`);
}

const rows = await fetch(`${API}/need/${NEED}/attachments/`, auth).then((r) =>
	r.ok ? r.json() : []
);
for (const row of rows) {
	if (String(row.title).startsWith('E2E:')) {
		await fetch(`${API}/attachments/${row.id}/withdraw/`, {
			method: 'POST',
			headers: { Authorization: `Token ${TOKEN}` }
		});
	}
}

check('no uncaught page errors', errors.length === 0, errors.slice(0, 3).join(' / '));
await browser.close();
if (threw) console.error(threw);

console.log(`\n${passed}/${passed + failed} checks passed`);
process.exit(failed === 0 ? 0 : 1);
