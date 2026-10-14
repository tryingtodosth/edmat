// Settings → Your data and your account (`/settings/account`, backend `accounts/erasure.py` +
// `export.py`): download my data, delete my account, the 14-day grace period and cancelling it, and
// what the site shows once the account is really erased.
//
// DESTRUCTIVE — it erases an account. Run it against a COPY of the dev database, never the shared
// one: the backend gets a settings module that points `DATABASES['default']` at the copy (see
// test.md, "Account deletion and data export"). It registers its own two throwaway accounts per run
// and touches no seeded account.
//
//   E2E_BASE=http://localhost:5194 E2E_API=http://127.0.0.1:8044 \
//   E2E_MANAGE='cd backend && PYTHONPATH=… DJANGO_SETTINGS_MODULE=… ../.venv/bin/python3 manage.py' \
//   node e2e/account-erasure.mjs
//
// E2E_MANAGE (required) is the backend's `manage.py` on the COPY. It is used twice: to attribute two
// published exercises to the throwaway account (one "EdMat only", one CC BY-SA — the deletion choice
// is about exactly that difference), and to reach "14 days later" without waiting:
// `erase_due_accounts --now --user <id>`, the operator's override for one named account.
import { execSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

let chromium;
try {
	({ chromium } = await import('playwright'));
} catch {
	({ chromium } = await import('playwright-core'));
}
import { englishContext } from './english.mjs';

const BASE = process.env.E2E_BASE ?? 'http://localhost:5173';
const API = process.env.E2E_API ?? 'http://localhost:8000';
const MANAGE = process.env.E2E_MANAGE ?? '';
if (!MANAGE)
	throw new Error('E2E_MANAGE is required (manage.py on a COPY of the database) — see the header');
const manage = (args) => execSync(`${MANAGE} ${args}`, { encoding: 'utf-8', shell: '/bin/bash' });
/** Two published exercises nobody submitted, attributed to `userId`: [edmat-only, cc-by-sa]. */
const giveExercises = (userId) => {
	const out = manage(
		`shell -c "from exercises.models import Exercise as E; ids=list(E.objects.filter(published=True, submitted_by__isnull=True).order_by('-pk').values_list('pk', flat=True)[:2]); E.objects.filter(pk=ids[0]).update(submitted_by_id=${userId}, licence='edmat-only'); E.objects.filter(pk=ids[1]).update(submitted_by_id=${userId}, licence='cc-by-sa-4.0'); print('IDS', ids[0], ids[1])"`
	);
	const m = out.match(/IDS (\d+) (\d+)/);
	return { edmatOnly: m[1], open: m[2] };
};
const isPublished = async (id) => (await get(`/api/exercises/${id}/`)).status === 200;
const SHOTS = 'e2e/screenshots';
let pass = 0,
	fail = 0;
const errors = [];
const check = (l, ok, x = '') => {
	if (ok) pass++;
	else fail++;
	console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${l} ${ok ? '' : x}`);
};
const browser = await chromium.launch(
	process.env.CHROME ? { executablePath: process.env.CHROME } : {}
);
// Expected non-2xx responses — the behaviour under test, not bugs. Chromium logs every failed fetch
// as a console error; these are matched on the RESPONSE (trap 26: the console text has no URL).
const EXPECTED = [
	(url, status) => url.includes('/api/auth/login/') && status === 403, // erasure_pending
	(url, status) => url.includes('/api/auth/logout/') && status === 401, // token already revoked
	(url, status) => url.includes('/api/auth/me/') && status === 401 // the revoked session's last read
];
let expectedFailures = 0;
const mk = async (width = 1280, height = 1000) => {
	const ctx = await englishContext(browser, BASE, {
		viewport: { width, height },
		acceptDownloads: true
	});
	const p = await ctx.newPage();
	p.on('response', (r) => {
		if (r.status() >= 400 && EXPECTED.some((f) => f(r.url(), r.status()))) expectedFailures++;
	});
	p.on('console', (m) => {
		if (m.type() !== 'error') return;
		if (/Failed to load resource: the server responded with a status of (401|403)/.test(m.text()))
			return;
		errors.push(`[${p.url()}] ${m.text()}`);
	});
	p.on('pageerror', (e) => errors.push(e.message));
	return p;
};
const settle = (p, ms = 900) => p.waitForTimeout(ms);
const json = (t) => ({
	'Content-Type': 'application/json',
	...(t ? { Authorization: `Token ${t}` } : {})
});
const post = async (path, body, token) => {
	const r = await fetch(`${API}${path}`, {
		method: 'POST',
		headers: json(token),
		body: JSON.stringify(body)
	});
	return { status: r.status, body: await r.json().catch(() => null) };
};
const get = async (path, token) => {
	const r = await fetch(`${API}${path}`, { headers: json(token) });
	return { status: r.status, body: await r.json().catch(() => null) };
};

// ---- setup: two throwaway accounts, a comment and a conversation -------------------------------
const stamp = Date.now() % 1000000;
const PASSWORD = 'erasure-e2e-Passw0rd!';
const register = async (username, displayName) => {
	const r = await post('/api/auth/register/', {
		username,
		email: `${username}@example.org`,
		password: PASSWORD,
		display_name: displayName,
		preferred_locale: 'en',
		birth_year: 1990,
		accept_terms: true
	});
	if (r.status !== 201)
		throw new Error(`register ${username}: ${r.status} ${JSON.stringify(r.body)}`);
	return { token: r.body.token, id: r.body.profile.id, username };
};
const ola = await register(`e2e-erase-${stamp}`, `Ola Erasure ${stamp}`);
const bartek = await register(`e2e-other-${stamp}`, `Bartek Other ${stamp}`);
const OLA_NAME = `Ola Erasure ${stamp}`;
const celina = await register(`e2e-celina-${stamp}`, `Celina Erasure ${stamp}`);
const olaEx = giveExercises(ola.id);
const celinaEx = giveExercises(celina.id);

const exercises = await get('/api/exercises/', ola.token);
const exerciseId = (
	Array.isArray(exercises.body) ? exercises.body : (exercises.body?.results ?? [])
)[0]?.id;
const comment = await post(
	`/api/exercises/${exerciseId}/comments/`,
	{ body: `erasure e2e comment ${stamp}` },
	ola.token
);
check('setup: Ola comments on an exercise', comment.status === 201, JSON.stringify(comment.body));
const sent = await post(
	'/api/messages/',
	{ recipient_id: bartek.id, subject: `hi ${stamp}`, body: `secret ${stamp}` },
	ola.token
);
const replied = await post(
	'/api/messages/',
	{ recipient_id: ola.id, subject: `re ${stamp}`, body: `reply ${stamp}` },
	bartek.token
);
check(
	'setup: a conversation between Ola and Bartek',
	sent.status === 201 && replied.status === 201,
	`${sent.status} ${replied.status}`
);

// ---- 1. the account page, from Settings ----------------------------------------------------------
const signedIn = async (token, width, height) => {
	const p = await mk(width, height);
	await p.context().addInitScript((t) => localStorage.setItem('edmat-auth-token', t), token);
	return p;
};
let p = await signedIn(ola.token);
await p.goto(`${BASE}/settings`, { waitUntil: 'load' });
await p.locator('[data-testid="account-link"]').waitFor({ timeout: 60000 });
await p.locator('[data-testid="account-link"]').click();
await p.waitForURL((u) => u.pathname === '/settings/account', { timeout: 15000 });
await p.locator('[data-testid="erasure-plan"]').waitFor({ timeout: 30000 });
check('Settings links to /settings/account', p.url().endsWith('/settings/account'));
const planText = await p.locator('[data-testid="erasure-plan"]').innerText();
check(
	'the plan names what is deleted and what stays published',
	/Deleted/.test(planText) &&
		/Stays published, without your name/.test(planText) &&
		/Comments, reviews and posts/.test(planText),
	planText.slice(0, 300)
);
check(
	'…and what is kept as a record (the conversation)',
	/Kept as a record/.test(planText) && /Private messages/.test(planText),
	planText.slice(0, 300)
);
await p.screenshot({ path: `${SHOTS}/account-erasure-desktop.png`, fullPage: true });

// ---- 2. download my data -----------------------------------------------------------------------
const [download] = await Promise.all([
	p.waitForEvent('download', { timeout: 30000 }),
	p.locator('[data-testid="export-button"]').click()
]);
const file = JSON.parse(readFileSync(await download.path(), 'utf-8'));
check(
	'the export downloads and parses',
	file.format === 'edmat-account-export' && file.version === 1
);
check(
	'…holds the account and the comment',
	file.sections['accounts.User'].rows[0].account.username === ola.username &&
		file.sections['community.Comment']?.rows.some((r) =>
			r.body.includes(`erasure e2e comment ${stamp}`)
		)
);
const msgs = file.sections['postman.Message']?.rows ?? [];
check(
	'…holds both sides of the conversation, decrypted',
	msgs.some((r) => r.body === `secret ${stamp}`) && msgs.some((r) => r.body === `reply ${stamp}`)
);
const blob = JSON.stringify(file);
check(
	'…names Bartek only by display name, never by e-mail or username',
	blob.includes(`Bartek Other ${stamp}`) &&
		!blob.includes(`${bartek.username}@example.org`) &&
		!blob.includes(`"${bartek.username}"`)
);
await p.locator('.ok', { hasText: 'Downloaded' }).waitFor({ timeout: 5000 });
check('the page says it downloaded', true);

// ---- 3. delete → the grace screen ----------------------------------------------------------------
const deleteFrom = async (page, choice, who = ola) => {
	const form = page.locator('[data-testid="erasure-form"]');
	await form.waitFor({ timeout: 30000 });
	if (choice) await page.locator(`[data-testid="content-choice"] input[value="${choice}"]`).check();
	await form.locator('input[type="text"]').fill(who.username);
	await form.locator('input[type="password"]').fill(PASSWORD);
	await form.locator('button[type="submit"]').click();
	await page.locator('.scheduled').waitFor({ timeout: 15000 });
};
const choiceBox = p.locator('[data-testid="content-choice"]');
const choiceText = await choiceBox.innerText();
check(
	'the "EdMat only" question is asked, with counts, and the CC rule explained',
	/1 of the things you published/.test(choiceText) &&
		/Creative Commons licence always stays/.test(choiceText),
	choiceText.slice(0, 300)
);
const form0 = p.locator('[data-testid="erasure-form"]');
await form0.locator('input[type="text"]').fill(ola.username);
await form0.locator('input[type="password"]').fill(PASSWORD);
check(
	'…and Delete waits until it is answered',
	await form0.locator('button[type="submit"]').isDisabled()
);
await choiceBox.scrollIntoViewIfNeeded();
await p.screenshot({ path: `${SHOTS}/account-erasure-choice.png`, fullPage: true });
await deleteFrom(p, 'remove');
const scheduled = await p.locator('.scheduled').innerText();
check(
	'deleting shows the grace screen with a date',
	/switched off/.test(scheduled) && /\d{4}/.test(scheduled),
	scheduled
);
await p.screenshot({ path: `${SHOTS}/account-erasure-scheduled.png`, fullPage: true });
check('the old token is revoked', (await get('/api/auth/me/', ola.token)).status === 401);
const hidden = await get(`/api/users/${ola.id}/`);
check(
	'the profile is withheld at once (the name its bylines show, nothing else)',
	hidden.status === 200 && hidden.body.is_profile_public === false && hidden.body.bio === '',
	JSON.stringify(hidden.body).slice(0, 200)
);
await p.close();

// ---- 4. signing in during the grace period offers to cancel ------------------------------------
p = await mk(390, 844);
// Trap 25: the form is in the server-rendered HTML long before it works — wait for the root
// layout's own boot request, registered before the navigation.
const booted = p.waitForResponse((r) => r.url().includes('/feature-flags/'), { timeout: 60000 });
await p.goto(`${BASE}/login`, { waitUntil: 'load' });
await booted;
await settle(p, 1500);
await p.locator('form input[autocomplete="username"]').fill(ola.username);
await p.locator('form input[type="password"]').fill(PASSWORD);
await p.locator('form button[type="submit"]').click();
const pending = p.locator('[data-testid="erasure-pending"]');
await pending.waitFor({ timeout: 15000 });
check(
	'the sign-in page says the account is waiting to be deleted',
	/will be deleted on/.test(await pending.innerText())
);
await p.screenshot({ path: `${SHOTS}/account-erasure-login-390.png`, fullPage: true });
await pending.locator('button', { hasText: 'Cancel the deletion and sign in' }).click();
await p.waitForURL((u) => !u.pathname.includes('/login'), { timeout: 15000 });
const tokenAfter = await p.evaluate(() => localStorage.getItem('edmat-auth-token'));
check(
	'cancelling signs back in',
	!!tokenAfter && (await get('/api/auth/me/', tokenAfter)).status === 200
);
await p.close();

// ---- 5. delete again, and erase it (the operator's override for one account) --------------------
p = await signedIn(tokenAfter, 390, 844);
await p.goto(`${BASE}/settings/account`, { waitUntil: 'load' });
await p.locator('[data-testid="erasure-plan"]').waitFor({ timeout: 30000 });
await p.screenshot({ path: `${SHOTS}/account-erasure-390.png`, fullPage: true });
// Second time round Ola answers "keep" — the cancelled request's "remove" must not linger.
await deleteFrom(p, 'keep');
await p.close();

{
	const out = manage(`erase_due_accounts --now --user ${ola.id}`);
	check('erase_due_accounts erased the account', /erased: user/.test(out), out);
	const me = await get(`/api/users/${ola.id}/`);
	check(
		'the public profile is the tombstone',
		me.status === 200 && me.body.display_name === '[deleted account]',
		JSON.stringify(me.body)
	);
	check(
		'signing in no longer works',
		(await post('/api/auth/login/', { username: ola.username, password: PASSWORD })).status === 401
	);

	// Bartek's inbox keeps the conversation; the comment stays — both under "Deleted account".
	p = await signedIn(bartek.token);
	await p.goto(`${BASE}/exercises/${exerciseId}`, { waitUntil: 'load' });
	const theComment = p
		.locator('article, li, .comment', { hasText: `erasure e2e comment ${stamp}` })
		.last();
	await theComment.waitFor({ timeout: 60000 });
	const commentText = await theComment.innerText();
	check(
		'the comment stays, bylined "Deleted account"',
		/Deleted account/.test(commentText) && !commentText.includes(OLA_NAME),
		commentText.slice(0, 200)
	);
	await theComment.scrollIntoViewIfNeeded();
	await p.screenshot({ path: `${SHOTS}/account-erasure-comment.png` });
	const inbox = await get('/api/messages/?folder=inbox', bartek.token);
	const fromOla = (inbox.body ?? []).find((m) => (m.subject ?? '').includes(`hi ${stamp}`));
	check(
		"Bartek's inbox keeps Ola's message, without her name",
		!!fromOla &&
			JSON.stringify(fromOla).includes('[deleted account]') &&
			!JSON.stringify(fromOla).includes(OLA_NAME),
		JSON.stringify(fromOla ?? inbox.body).slice(0, 300)
	);
	await p.close();
	check(
		'"keep": the EdMat-only exercise and the CC one both stay published',
		(await isPublished(olaEx.edmatOnly)) && (await isPublished(olaEx.open))
	);

	// Celina answers "remove".
	p = await signedIn(celina.token);
	await p.goto(`${BASE}/settings/account`, { waitUntil: 'load' });
	await deleteFrom(p, 'remove', celina);
	await p.close();
	manage(`erase_due_accounts --now --user ${celina.id}`);
	check('"remove": the EdMat-only exercise is hidden', !(await isPublished(celinaEx.edmatOnly)));
	check(
		'…and the CC BY-SA one stays, because that licence cannot be revoked',
		await isPublished(celinaEx.open)
	);
}

// ---- 6. a child's account: the line, not the form ------------------------------------------------
const childName = `e2e-kid-${stamp}`;
const made = await post(
	'/api/auth/children/',
	{ username: childName, password: PASSWORD, display_name: 'Kid' },
	bartek.token
);
const childLogin = await post('/api/auth/login/', { username: childName, password: PASSWORD });
p = await signedIn(childLogin.body.token, 390, 844);
await p.goto(`${BASE}/settings/account`, { waitUntil: 'load' });
const line = p.locator('[data-testid="guardian-managed"]');
await line.waitFor({ timeout: 30000 });
check(
	'a child sees "ask your parent or guardian" and no delete form',
	made.status === 201 &&
		/ask your parent or guardian/.test(await line.innerText()) &&
		(await p.locator('[data-testid="erasure-form"]').count()) === 0 &&
		(await p.locator('[data-testid="erasure-plan"]').count()) === 0
);
check(
	'…and can still download their data',
	(await p.locator('[data-testid="export-button"]').count()) === 1
);
await p.screenshot({ path: `${SHOTS}/account-erasure-minor-390.png`, fullPage: true });
await p.close();

console.log(`  (${expectedFailures} expected non-2xx responses ignored)`);
check('zero console/page errors', errors.length === 0, errors.join(' | ').slice(0, 600));
await browser.close();
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
