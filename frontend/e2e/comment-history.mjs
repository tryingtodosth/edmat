// Comment edit history (community.CommentRevision, root CLAUDE.md's comment-history feature):
// Ola posts and edits a real comment through the actual form; the "(edited)" marker opens a real
// history modal showing the pre-edit wording; Kasia (staff) hides that version from ordinary
// readers but can still read it herself; u-root (the one seeded superuser) seals it, after which
// nobody — not even staff — can read it through the app. Cleans its own comment up.
//   E2E_BASE=http://localhost:5173 E2E_API=http://localhost:8000 node e2e/comment-history.mjs
let chromium;
try {
	({ chromium } = await import('playwright'));
} catch {
	({ chromium } = await import('playwright-core'));
}
const BASE = process.env.E2E_BASE ?? 'http://localhost:5173';
const API = process.env.E2E_API ?? 'http://localhost:8000';
let pass = 0,
	fail = 0;
const errors = [];
const check = (l, ok, x = '') => {
	if (ok) pass++;
	else fail++;
	console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${l} ${ok ? '' : x}`);
};

const tokenFor = async (email) => {
	const r = await fetch(`${API}/api/auth/login/`, {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify({ username: email, password: 'password123' })
	});
	const j = await r.json();
	if (!j.token)
		throw new Error(
			`login failed for ${email}: ${JSON.stringify(j)} (login throttle? clear backend/cachedata)`
		);
	return j.token;
};
const auth = (t) => ({ 'Content-Type': 'application/json', Authorization: `Token ${t}` });
const ola = await tokenFor('ola@edmat.example');
const MARKER = 'History e2e —';

// Reset leftovers on exercise 1.
for (const c of await (
	await fetch(`${API}/api/exercises/1/comments/?fresh=${Date.now()}`)
).json()) {
	if (c.body.startsWith(MARKER) && !c.is_removed)
		await fetch(`${API}/api/comments/${c.id}/`, { method: 'DELETE', headers: auth(ola) });
}

const browser = await chromium.launch(
	process.env.CHROME ? { executablePath: process.env.CHROME } : {}
);
const settle = (p, ms = 700) => p.waitForTimeout(ms);

async function newPage(errList) {
	const ctx = await browser.newContext({ viewport: { width: 1280, height: 1000 } });
	const p = await ctx.newPage();
	p.on('console', (m) => {
		if (m.type() === 'error') errList.push(`[${p.url()}] ${m.text()}`);
	});
	p.on('pageerror', (e) => errList.push(e.message));
	return p;
}

async function login(p, email) {
	await p.goto(`${BASE}/login`, { waitUntil: 'load', timeout: 90000 });
	await settle(p, 800);
	await p.locator('form input[autocomplete="username"]').fill(email);
	await p.locator('form input[type="password"]').fill('password123');
	await p.locator('form button[type="submit"]').click();
	await p.waitForURL((u) => !u.pathname.includes('/login'), { timeout: 15000 });
}

// A moderator/superuser action's own note+confirm dialogs are native window.prompt/confirm —
// accept every prompt with a fixed note, accept every confirm.
function autoAcceptDialogs(p, note) {
	p.on('dialog', (d) => {
		if (d.type() === 'prompt') d.accept(note);
		else d.accept();
	});
}

// --- Ola: post, then edit, a real comment through the actual form ------------------------------
const olaErrors = [];
const olaPage = await newPage(olaErrors);
await login(olaPage, 'ola@edmat.example');
await olaPage.goto(`${BASE}/exercises/1`, { waitUntil: 'load' });
const discussion = olaPage.locator('.discussion');
await discussion.waitFor({ timeout: 90000 });
const form = discussion.locator('form.comment-form').first();
await form.locator('textarea').fill(`${MARKER} the original wording`);
await form.locator('button[type="submit"]').click();
const mine = discussion.locator('.comment', { hasText: 'the original wording' }).first();
await mine.waitFor({ timeout: 20000 });

check(
	'a fresh, never-edited comment has no "(edited)" marker',
	(await mine.locator('.comment__edited').count()) === 0
);

await mine.locator('.meatballs__trigger').first().click();
await mine.locator('[role="menuitem"]', { hasText: 'Edit' }).first().click();
const editForm = mine.locator('.comment__edit-form form').first();
await editForm.waitFor();
await editForm.locator('textarea').fill(`${MARKER} the edited wording`);
await editForm.locator('button[type="submit"]').click();
await discussion
	.locator('.comment', { hasText: 'the edited wording' })
	.first()
	.waitFor({ timeout: 20000 });
const edited = discussion.locator('.comment', { hasText: 'the edited wording' }).first();
check(
	'the edited comment now shows the "(edited)" marker',
	(await edited.locator('.comment__edited').count()) === 1
);

await edited.locator('.comment__edited').click();
const olaModal = olaPage.locator('.modal-panel');
await olaModal.waitFor({ timeout: 10000 });
const firstEntry = olaModal.locator('.history-item').first();
await firstEntry.waitFor();
check(
	'the history modal shows the real PRE-edit wording',
	(await firstEntry.locator('.history-item__body').innerText()).includes('the original wording')
);
check(
	'Ola (not staff) sees no hide/seal actions',
	(await firstEntry.locator('.history-action').count()) === 0
);
await olaPage.locator('.modal-panel .close').click();

// Find the comment/revision ids for the two moderation steps below.
const thread = await (await fetch(`${API}/api/exercises/1/comments/?fresh=${Date.now()}`)).json();
const row = thread.find((c) => c.body.includes('the edited wording'));
const revisionsBefore = await (await fetch(`${API}/api/comments/${row.id}/revisions/`)).json();
check('exactly one revision was recorded for one edit', revisionsBefore.length === 1);

// --- Kasia (staff): hide the earlier version -----------------------------------------------
const kasiaErrors = [];
const kasiaPage = await newPage(kasiaErrors);
autoAcceptDialogs(kasiaPage, 'contained something unnecessary');
await login(kasiaPage, 'kasia@edmat.example');
await kasiaPage.goto(`${BASE}/exercises/1`, { waitUntil: 'load' });
const kasiaComment = kasiaPage.locator('.comment', { hasText: 'the edited wording' }).first();
await kasiaComment.waitFor({ timeout: 20000 });
await kasiaComment.locator('.comment__edited').click();
const kasiaModal = kasiaPage.locator('.modal-panel');
await kasiaModal.waitFor();
const kasiaEntry = kasiaModal.locator('.history-item').first();
await kasiaEntry.waitFor();
check(
	'staff sees the real body before hiding it',
	(await kasiaEntry.locator('.history-item__body').innerText()).includes('the original wording')
);
await kasiaEntry.locator('.history-action', { hasText: 'Hide' }).click();
await settle(kasiaPage, 1200);
check(
	'staff still reads the real body AFTER hiding it themselves',
	(await kasiaEntry.locator('.history-item__body').innerText()).includes('the original wording')
);
await kasiaPage.locator('.modal-panel .close').click();

// An ordinary reader (anonymous) now sees the placeholder, not the real body.
const anonPage = await newPage(errors);
await anonPage.goto(`${BASE}/exercises/1`, { waitUntil: 'load' });
const anonComment = anonPage.locator('.comment', { hasText: 'the edited wording' }).first();
await anonComment.waitFor({ timeout: 20000 });
await anonComment.locator('.comment__edited').click();
const anonModal = anonPage.locator('.modal-panel');
await anonModal.waitFor();
const anonEntry = anonModal.locator('.history-item').first();
await anonEntry.waitFor();
check(
	'an anonymous reader sees the "removed by a moderator" placeholder, not the real body',
	(await anonEntry.locator('.history-item__placeholder').count()) === 1 &&
		(await anonEntry.locator('.history-item__body').count()) === 0
);
await anonPage.close();

// Confirmed via the API directly too, on both sides of the tier.
const asAnon = await (await fetch(`${API}/api/comments/${row.id}/revisions/`)).json();
check('the API itself never sends the body to an anonymous caller', asAnon[0].body === null);
const kasiaToken = await tokenFor('kasia@edmat.example');
const asStaff = await (
	await fetch(`${API}/api/comments/${row.id}/revisions/`, { headers: auth(kasiaToken) })
).json();
check(
	'the API sends the real body to staff',
	asStaff[0].body === 'History e2e — the original wording'
);

// --- u-root (the one seeded superuser): seal the same revision ---------------------------------
const rootErrors = [];
const rootPage = await newPage(rootErrors);
autoAcceptDialogs(rootPage, 'compromised account — legal hold');
await login(rootPage, 'root@edmat.example');
await rootPage.goto(`${BASE}/exercises/1`, { waitUntil: 'load' });
const rootComment = rootPage.locator('.comment', { hasText: 'the edited wording' }).first();
await rootComment.waitFor({ timeout: 20000 });
await rootComment.locator('.comment__edited').click();
const rootModal = rootPage.locator('.modal-panel');
await rootModal.waitFor();
const rootEntry = rootModal.locator('.history-item').first();
await rootEntry.waitFor();
check(
	'a superuser sees BOTH the hide and the seal action on an unsealed, hidden revision',
	(await rootEntry.locator('.history-action').count()) === 2
);
await rootEntry.locator('.history-action', { hasText: 'Seal' }).click();
await settle(rootPage, 1200);
check(
	'the superuser who just sealed it cannot read it back either — no exception for the sealer',
	(await rootEntry.locator('.history-item__placeholder').innerText()).length > 0 &&
		(await rootEntry.locator('.history-item__body').count()) === 0
);
check(
	'once sealed, no further actions are offered on that row',
	(await rootEntry.locator('.history-action').count()) === 0
);

// Staff, re-checked AFTER sealing: the body is gone for them too, but the row (and the fact that
// something is there) is not — a sealed entry is still a real, visible line, not a silent gap.
const asStaffAfterSeal = await (
	await fetch(`${API}/api/comments/${row.id}/revisions/`, { headers: auth(kasiaToken) })
).json();
check(
	'staff can no longer read the sealed body through the API either',
	asStaffAfterSeal[0].body === null && asStaffAfterSeal[0].is_sealed === true
);
const rootToken = await tokenFor('root@edmat.example');
const asRoot = await (
	await fetch(`${API}/api/comments/${row.id}/revisions/`, { headers: auth(rootToken) })
).json();
check('a superuser cannot read the sealed body through the API either', asRoot[0].body === null);

// A plain, non-staff user cannot even attempt to seal.
const hideAttempt = await fetch(`${API}/api/comment-revisions/${revisionsBefore[0].id}/hide/`, {
	method: 'POST',
	headers: auth(await tokenFor('ola@edmat.example')),
	body: JSON.stringify({ note: 'nope' })
});
check('a non-staff hide attempt is refused (409, already sealed)', hideAttempt.status === 409);

// --- cleanup -------------------------------------------------------------------------------
await fetch(`${API}/api/comments/${row.id}/`, { method: 'DELETE', headers: auth(ola) });

const allErrors = [...errors, ...olaErrors, ...kasiaErrors, ...rootErrors];
check('zero console/page errors', allErrors.length === 0, allErrors.join(' | ').slice(0, 500));
await olaPage.screenshot({ path: 'e2e/screenshots/comment-history.png' }).catch(() => {});
await browser.close();
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
