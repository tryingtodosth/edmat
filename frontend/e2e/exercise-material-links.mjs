// End-to-end check of exercise ↔ material links: a material page lists the exercises attached to
// it, an existing exercise can be linked with a locator from that page, the exercise's own page
// says which material it came from, the link can be removed again, and "Add an exercise" lands on
// /submit with a "For material: …" chip already filled in.
//
//   E2E_BASE=http://localhost:5173 E2E_API=http://localhost:8011/api \
//     node e2e/exercise-material-links.mjs
//
// Both dev servers must be up. `E2E_BASE` is the SvelteKit origin, `E2E_API` the Django API root
// INCLUDING `/api` (the cleanup probe at the end talks to it directly; no host/port is hardcoded).
// Optional: E2E_MATERIAL (default 1), E2E_EXERCISE (default 2), E2E_EMAIL, E2E_SHOTS, CHROME.
//
// Signs in as the seeded demo account ola@edmat.example / password123 — registration is throttled
// ~10/hour per IP and a long session exhausts it (e2e/CLAUDE.md trap 1).
//
// The corpus is Polish and a fresh context reads the English interface, so the picker's own search
// would honestly return nothing for seeded rows (trap 16). This script sets the account's
// `content_locales` to ['pl'] through the real API before browsing and puts it back at the end.
let chromium;
try {
	({ chromium } = await import('playwright'));
} catch {
	({ chromium } = await import('playwright-core'));
}

const BASE = process.env.E2E_BASE ?? 'http://localhost:5173';
const API = process.env.E2E_API ?? 'http://localhost:8011/api';
const SHOTS = process.env.E2E_SHOTS ?? '/tmp';
const MATERIAL = process.env.E2E_MATERIAL ?? '1';
const EXERCISE = process.env.E2E_EXERCISE ?? '2';
const EMAIL = process.env.E2E_EMAIL ?? 'ola@edmat.example';
const PASSWORD = 'password123';
const LOCATOR = `p. 34, ex. 3.2 (e2e ${Date.now() % 100000})`;

let pass = 0;
let fail = 0;
const errors = [];
const check = (label, ok, extra = '') => {
	if (ok) pass++;
	else fail++;
	console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${label} ${ok ? '' : extra}`);
};
const settle = (page, ms = 600) => page.waitForTimeout(ms);

// ---- an authenticated API handle, for the content-locale setup and the honest cleanup probe ----
// (trap 12: an anonymous list read can come from the 60 s cache and show a row that is already
// gone, so every verification here goes through an authenticated request.)
const loginRes = await fetch(`${API}/auth/login/`, {
	method: 'POST',
	headers: { 'Content-Type': 'application/json' },
	body: JSON.stringify({ username: EMAIL, password: PASSWORD })
});
if (!loginRes.ok) throw new Error(`API login failed: ${loginRes.status}`);
const TOKEN = (await loginRes.json()).token;
const api = (path, init = {}) =>
	fetch(`${API}${path}`, {
		...init,
		headers: {
			'Content-Type': 'application/json',
			Authorization: `Token ${TOKEN}`,
			...(init.headers ?? {})
		}
	});

const meBefore = await (await api('/auth/me/')).json();
const localesBefore = meBefore.content_locales ?? [];
await api('/auth/me/', { method: 'PATCH', body: JSON.stringify({ content_locales: ['pl'] }) });

// A re-run must not trip over its own leftovers: unlink the pair first if an earlier run left it.
const existing = await (await api(`/materials/${MATERIAL}/exercises/`)).json();
for (const row of existing) {
	if (String(row.exercise?.id) === String(EXERCISE)) {
		await api(`/exercise-material-links/${row.id}/`, { method: 'DELETE' });
	}
}

const browser = await chromium.launch(
	process.env.CHROME ? { executablePath: process.env.CHROME } : {}
);
const context = await browser.newContext({ viewport: { width: 1200, height: 900 } });
const page = await context.newPage();
page.on('console', (msg) => msg.type() === 'error' && errors.push(`console: ${msg.text()}`));
page.on('pageerror', (e) => errors.push(`page: ${e.message}`));

async function goto(path) {
	await page.goto(`${BASE}${path}`, { waitUntil: 'load' });
	await settle(page, 900);
}

// ---- 1. anonymous: the section exists and offers no write controls ----------------------------
console.log('anonymous reader');
await goto(`/materials/${MATERIAL}`);
const section = page.locator('section.material-exercises');
await section.waitFor();
check(
	'the material page carries an "Exercises from this material" section',
	await section.isVisible()
);
check(
	'no "Link an existing exercise" trigger for a signed-out reader',
	(await section.getByRole('button', { name: /Link an existing exercise/ }).count()) === 0
);
check(
	'no "Add an exercise" link for a signed-out reader',
	(await section.locator('a.action').count()) === 0
);
await page.screenshot({ path: `${SHOTS}/exlink-material-anon.png`, fullPage: true });

// ---- 2. sign in ---------------------------------------------------------------------------------
console.log('sign in');
// The login form must be hydrated before it is submitted, or the browser posts it natively as a GET
// and the page just reloads with a `?` — the same retry every other script carries. The identifier
// field is `type="text"` since guardian accounts (trap 13).
for (let attempt = 0; attempt < 3; attempt++) {
	await goto('/login');
	await settle(page, 1200);
	await page.locator('form input[autocomplete="username"]').fill(EMAIL);
	await page.locator('form input[type="password"]').fill(PASSWORD);
	await page.locator('form button[type="submit"]').click();
	try {
		await page.waitForURL((url) => !url.pathname.includes('/login'), { timeout: 8000 });
		break;
	} catch {
		if (attempt === 2) throw new Error('login never left /login');
	}
}

// ---- 3. link exercise 2 to material 1 with a locator --------------------------------------------
console.log('link an existing exercise');
await goto(`/materials/${MATERIAL}`);
await section.waitFor();
const linkedBefore = await section.locator('ul.link-grid > li').count();
check(
	'"Link an existing exercise" is offered once signed in',
	(await section.getByRole('button', { name: /Link an existing exercise/ }).count()) === 1
);
await section.getByRole('button', { name: /Link an existing exercise/ }).click();
const picker = section.locator('.picker');
await picker.waitFor();

// Search by the exercise's own title rather than a guessed word, so the assertion below can be an
// exact count instead of "something showed up" (trap 8).
const targetRaw = await (await api(`/exercises/${EXERCISE}/?lang=pl`)).json();
const targetTitle = targetRaw.title;
await picker.locator('input[type="text"]').first().fill(targetTitle);
await picker.getByRole('button', { name: /^Search$/ }).click();
await settle(page, 1200);
const results = picker.locator('button.picker__result');
check(
	'the picker finds the exercise by title',
	(await results.count()) >= 1,
	`title=${targetTitle}`
);
// By text, never by position — list ordering has flipped an assertion before (trap 6).
await results.filter({ hasText: targetTitle }).first().click();
await settle(page, 300);
check(
	'picking one reveals the role/locator fields',
	(await picker.locator('select').count()) === 1
);
await picker.locator('select').selectOption('source');
await picker.locator('input[type="text"]').nth(1).fill(LOCATOR);
await page.screenshot({ path: `${SHOTS}/exlink-picker.png` });
await picker.getByRole('button', { name: /^Link$/ }).click();
await settle(page, 1200);

const rows = section.locator('ul.link-grid > li');
check('the list gains exactly one row', (await rows.count()) === linkedBefore + 1);
const newRow = rows.filter({ hasText: LOCATOR }).first();
check('the new row shows the locator chip', (await newRow.count()) === 1, `locator=${LOCATOR}`);
check(
	'and the role chip says it is in this material',
	((await newRow.locator('.chip').first().textContent()) ?? '').includes('In this material')
);
check(
	'the row renders a real exercise card',
	(await newRow.locator('article.exercise-card').count()) === 1
);
await page.screenshot({ path: `${SHOTS}/exlink-material-linked.png`, fullPage: true });

// ---- 4. the exercise's own page says where it came from -----------------------------------------
console.log('the exercise page');
await goto(`/exercises/${EXERCISE}`);
const fromMaterial = page.locator('section.exercise-materials');
await fromMaterial.waitFor();
const materialRaw = await (await api(`/materials/${MATERIAL}/?lang=pl`)).json();
const materialRow = fromMaterial.locator('ul.material-list > li').filter({ hasText: LOCATOR });
// The section's head renders before its list has loaded (trap 2: no networkidle on a signed-in
// page) — wait for the row itself, not the section, before counting.
await materialRow
	.first()
	.waitFor({ timeout: 10_000 })
	.catch(() => {});
check('"From material" lists the material', (await materialRow.count()) === 1);
check(
	'and links to the material page',
	(await materialRow.locator(`a[href$="/materials/${MATERIAL}"]`).count()) === 1,
	`title=${materialRaw.title}`
);
await page.screenshot({ path: `${SHOTS}/exlink-exercise-page.png`, fullPage: true });

// ---- 5. /submit?material= carries the chip ------------------------------------------------------
console.log('add an exercise to this material');
await goto(`/materials/${MATERIAL}`);
await section.waitFor();
const addLink = section.locator('a.action');
check('"Add an exercise" is offered once signed in', (await addLink.count()) === 1);
check(
	'and points at /submit with the material in the query string',
	((await addLink.getAttribute('href')) ?? '').includes(`/submit?material=${MATERIAL}`)
);
await goto(`/submit?material=${MATERIAL}`);
const chip = page.locator('.for-material__chip');
await chip.waitFor();
check(
	'the submit form shows a "For material: …" chip',
	((await chip.textContent()) ?? '').includes(materialRaw.title),
	`title=${materialRaw.title}`
);
const forMaterial = page.locator('.for-material');
check(
	'with a role select and a locator input under it',
	(await forMaterial.locator('select').count()) === 1 &&
		(await forMaterial.locator('input[type="text"]').count()) === 1
);
// The branch picker is pre-filled from the material — scoped to the form, never `select.first()`,
// which matches the header's language picker (trap 6). The band select owns `university` (trap 14).
const branchSelect = page.locator('form select#submit-branch');
// The chip appears as soon as the material has loaded; the discipline and branch are filled in two
// requests later (the branch, then that discipline's branch list). Wait for the value itself.
await page
	.waitForFunction(
		(want) => document.querySelector('form select#submit-branch')?.value === want,
		materialRaw.branch_slug,
		{ timeout: 10_000 }
	)
	.catch(() => {});
check(
	"the material's own branch is pre-selected",
	(await branchSelect.inputValue()) === materialRaw.branch_slug,
	`got=${await branchSelect.inputValue()} want=${materialRaw.branch_slug}`
);
await page.screenshot({ path: `${SHOTS}/exlink-submit-chip.png`, fullPage: true });
// Dismissible: arriving from a material is a hint, not a commitment.
await chip.locator('button').click();
await settle(page, 300);
check('the chip can be dismissed', (await page.locator('.for-material').count()) === 0);

// ---- 6. remove the link again -------------------------------------------------------------------
console.log('remove the link');
await goto(`/materials/${MATERIAL}`);
await section.waitFor();
const removable = section.locator('ul.link-grid > li').filter({ hasText: LOCATOR }).first();
// The section renders before its list has loaded, and the control only once the signed-in user is
// known — wait for the control (bounded) rather than counting on the first frame.
await removable
	.locator('button.link-row__remove')
	.waitFor({ timeout: 10_000 })
	.catch(() => {});
check(
	'the row offers a remove control to the person who added it',
	(await removable.locator('button.link-row__remove').count()) === 1
);
await removable.locator('button.link-row__remove').click();
await settle(page, 1200);
check(
	'the row is gone from the page',
	(await section.locator('ul.link-grid > li').filter({ hasText: LOCATOR }).count()) === 0
);

// Confirmed through an AUTHENTICATED request, which bypasses the anonymous read cache (trap 12).
const after = await (await api(`/materials/${MATERIAL}/exercises/`)).json();
check(
	'and gone from the API',
	!after.some((row) => String(row.exercise?.id) === String(EXERCISE)),
	JSON.stringify(after.map((r) => r.exercise?.id))
);

// ---- cleanup -------------------------------------------------------------------------------------
await api('/auth/me/', {
	method: 'PATCH',
	body: JSON.stringify({ content_locales: localesBefore })
});

await browser.close();
console.log(`\n${pass} passed, ${fail} failed, ${errors.length} console/page errors`);
for (const e of errors) console.log('  ' + e);
process.exit(fail || errors.length ? 1 : 0);
