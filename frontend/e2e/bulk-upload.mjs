// A person's bulk upload of exercise files (backend exercises/bulk.py, 2026-10-22; owner: "empower
// users to feed the DB with their own exercises in bulk … with a bunch of security checks and
// sanitization"). Drives the real page, end to end, three ways:
//
//   1. an UNVERIFIED account: the link on /submit, a preview with one good and one refused file
//      (the refusal words drawn as sentences), removing the bad file, sending → "Sent … to the
//      moderation queue", and the API showing a pending submission with an upload batch;
//   2. a VERIFIED contributor: two files (one with parts) and the AI-assisted box → "Published",
//      the exercise page opened from the result, its parts and its AI chip read back from the API;
//   3. STAFF: the moderation queue's "Approve all N from this upload" on a batch the unverified
//      account sent through the API, and the API showing both approved;
//   and the kill switch: `exercise_bulk_upload` off takes the /submit link and the Add… entry away,
//   the page shows the gate, the endpoint answers 403 — and back on.
//
// Light and dark screenshots of the report are taken (look at them). Tokens, not the login form.
//
//   LD_LIBRARY_PATH=… CHROME=<headless shell> E2E_BASE=http://localhost:5191 \
//   E2E_API=http://localhost:8191/api E2E_PLAIN_TOKEN=… E2E_VERIFIED_TOKEN=… E2E_STAFF_TOKEN=… \
//   E2E_DISCIPLINE=matematyka E2E_BRANCH=analiza-matematyczna E2E_TOPIC=szeregi node e2e/bulk-upload.mjs
import { mkdirSync } from 'node:fs';
import { englishContext } from './english.mjs';

let chromium;
try {
	({ chromium } = await import('playwright'));
} catch {
	({ chromium } = await import('playwright-core'));
}

const BASE = process.env.E2E_BASE ?? 'http://localhost:5173';
const API = process.env.E2E_API ?? 'http://localhost:8000/api';
const PLAIN = process.env.E2E_PLAIN_TOKEN;
const VERIFIED = process.env.E2E_VERIFIED_TOKEN;
const STAFF = process.env.E2E_STAFF_TOKEN;
const DISCIPLINE = process.env.E2E_DISCIPLINE ?? 'matematyka';
const BRANCH = process.env.E2E_BRANCH ?? 'analiza-matematyczna';
const TOPIC = process.env.E2E_TOPIC ?? 'szeregi';
if (!PLAIN || !VERIFIED || !STAFF)
	throw new Error('E2E_PLAIN_TOKEN, E2E_VERIFIED_TOKEN, E2E_STAFF_TOKEN');
const SHOTS = process.env.SHOTS ?? new URL('./screens/bulk-upload/', import.meta.url).pathname;
mkdirSync(SHOTS, { recursive: true });
const STAMP = Date.now();

let pass = 0,
	fail = 0;
const check = (label, ok, detail = '') => {
	if (ok) pass++;
	else fail++;
	console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${label}${ok ? '' : ' — ' + detail}`);
};
async function api(token, method, path, body) {
	const res = await fetch(`${API}${path}`, {
		method,
		headers: {
			...(body instanceof FormData ? {} : { 'Content-Type': 'application/json' }),
			...(token ? { Authorization: `Token ${token}` } : {})
		},
		body: body instanceof FormData ? body : body ? JSON.stringify(body) : undefined
	});
	const text = await res.text();
	try {
		return { status: res.status, data: text ? JSON.parse(text) : null };
	} catch {
		return { status: res.status, data: text };
	}
}
const setFlag = (key, on) => api(STAFF, 'PATCH', `/feature-flags/${key}/`, { is_enabled: on });

const good = (title) => `---
title: ${title}
difficulty: łatwe
topics: [${TOPIC}]
---
## Treść
Zbadaj zbieżność szeregu \\(\\sum_{n=0}^{\\infty} 2^{-n}\\).

## Odpowiedź
\\(2\\)
`;
const withParts = (title) => `---
title: ${title}
difficulty: średnie
---
## Treść
Policz granice:

## Podpunkt a

## Treść
\\(\\lim_{n\\to\\infty} \\frac{1}{n}\\)

## Odpowiedź
\\(0\\)

## Rozwiązanie
Ciąg \\(1/n\\) maleje do zera.

## Podpunkt b

## Treść
\\(\\lim_{n\\to\\infty} \\frac{n}{n+1}\\)

## Odpowiedź
\\(1\\)
`;
const bad = `---
title: Plik z błędami ${STAMP}
difficulty: łatwe
topics: [nie-ma-takiego-dzialu]
licence: unknown
---
## Treść
<script>alert(1)</script>Tekst.

## Uwagi
To zniknęłoby bez słowa.
`;
const file = (name, text) => ({
	name,
	mimeType: 'text/markdown',
	buffer: Buffer.from(text, 'utf-8')
});

const browser = await chromium.launch(
	process.env.CHROME ? { executablePath: process.env.CHROME } : {}
);
const errors = [];
async function contextFor(token, { dark = false } = {}) {
	const ctx = await englishContext(browser, BASE, {
		viewport: { width: 1280, height: 900 },
		...(dark ? { colorScheme: 'dark' } : {})
	});
	await ctx.addInitScript(
		([t, theme]) => {
			localStorage.setItem('edmat-auth-token', t);
			localStorage.setItem('edmat-theme', theme);
		},
		[token, dark ? 'dark' : 'light']
	);
	const page = await ctx.newPage();
	page.on('pageerror', (e) => errors.push(String(e)));
	return { ctx, page };
}
const shot = (page, name) => page.screenshot({ path: `${SHOTS}${name}.png`, fullPage: true });

async function pickBranch(page) {
	await page.locator('[data-testid="bulk-discipline"]').selectOption(DISCIPLINE);
	await page.waitForFunction(
		(b) =>
			[...document.querySelectorAll('[data-testid="bulk-branch"] option')].some(
				(o) => o.value === b
			),
		BRANCH
	);
	await page.locator('[data-testid="bulk-branch"]').selectOption(BRANCH);
}

try {
	await setFlag('exercise_bulk_upload', true);

	// ---- 1. an unverified account ------------------------------------------------------------
	{
		console.log('1. unverified: preview, a refused file, send to the queue');
		const { ctx, page } = await contextFor(PLAIN);
		await page.goto(`${BASE}/submit`);
		const link = page.locator('[data-testid="submit-bulk-link"]');
		await link.waitFor({ timeout: 30000 });
		check('/submit links to the bulk upload', (await link.count()) === 1);
		await link.click();
		await page.waitForURL(/\/submit\/bulk/);
		await page.locator('[data-testid="bulk-mode"]').waitFor();
		check(
			'the page says the files will be reviewed',
			/moderation queue/i.test(await page.locator('[data-testid="bulk-mode"]').innerText())
		);
		await pickBranch(page);
		check(
			'the subject’s topic slugs are listed',
			(await page.locator('[data-testid="bulk-topics"]').innerText()).includes(TOPIC)
		);
		await page
			.locator('[data-testid="bulk-files"]')
			.setInputFiles([file('dobry.md', good(`Szereg ${STAMP}`)), file('zly.md', bad)]);
		check(
			'the send button is off before a check',
			await page.locator('[data-testid="bulk-send"]').isDisabled()
		);
		await page.locator('[data-testid="bulk-check"]').click();
		await page.locator('[data-testid="bulk-report"]').waitFor();
		const rows = page.locator('[data-testid="bulk-row"]');
		check('two rows in the report', (await rows.count()) === 2);
		const badRow = await rows.nth(1).innerText();
		check('the unknown licence is refused in words', /cannot be chosen/i.test(badRow), badRow);
		check('the missing topic is named', badRow.includes('nie-ma-takiego-dzialu'), badRow);
		check('the unknown heading is refused', /unknown section heading/i.test(badRow), badRow);
		check('the script is announced as removed', /Unsafe HTML/i.test(badRow), badRow);
		check(
			'send stays off while a file is refused',
			await page.locator('[data-testid="bulk-send"]').isDisabled()
		);
		await shot(page, '1-report-light');
		await page.getByRole('button', { name: '× zly.md' }).click();
		check(
			'touching the files makes the preview stale',
			await page.locator('[data-testid="bulk-send"]').isDisabled()
		);
		await page.locator('[data-testid="bulk-check"]').click();
		await page.waitForFunction(
			() => document.querySelectorAll('[data-testid="bulk-row"]').length === 1
		);
		await page.locator('[data-testid="bulk-send"]:not([disabled])').waitFor();
		await page.locator('[data-testid="bulk-send"]').click();
		await page.locator('[data-testid="bulk-done"]').waitFor();
		const done = await page.locator('[data-testid="bulk-done"]').innerText();
		check('"Sent 1 … to the moderation queue"', /Sent 1 exercise/.test(done), done);
		check('the row says it is waiting', /Waiting for review/.test(done), done);
		await shot(page, '1-sent');
		const mine = await api(PLAIN, 'GET', '/exercise-submissions/?mine=1');
		const latest = mine.data[0];
		check(
			'the API holds a pending submission with an upload batch',
			latest.status === 'pending' && /^[0-9a-f]{32}$/.test(latest.upload_batch),
			JSON.stringify(latest).slice(0, 200)
		);
		await ctx.close();
	}

	// ---- the same refused report in the dark theme -------------------------------------------
	{
		const { ctx, page } = await contextFor(PLAIN, { dark: true });
		await page.goto(`${BASE}/submit/bulk`);
		await page.locator('[data-testid="bulk-discipline"]').waitFor({ timeout: 30000 });
		await pickBranch(page);
		await page.locator('[data-testid="bulk-files"]').setInputFiles([file('zly.md', bad)]);
		await page.locator('[data-testid="bulk-check"]').click();
		await page.locator('[data-testid="bulk-report"]').waitFor();
		const theme = await page.evaluate(() => document.documentElement.dataset.theme);
		check('the dark theme is on', theme === 'dark', String(theme));
		await page.locator('details.format summary').click();
		await shot(page, '1-report-dark');
		await ctx.close();
	}

	// ---- 2. a verified contributor ------------------------------------------------------------
	{
		console.log('2. verified: publish two files, one with parts, AI-assisted');
		const { ctx, page } = await contextFor(VERIFIED);
		await page.goto(`${BASE}/submit/bulk`);
		await page.locator('[data-testid="bulk-mode"]').waitFor({ timeout: 30000 });
		check(
			'the page says they publish at once',
			/published as soon as/i.test(await page.locator('[data-testid="bulk-mode"]').innerText())
		);
		await pickBranch(page);
		await page
			.locator('[data-testid="bulk-files"]')
			.setInputFiles([
				file('jeden.md', good(`Zweryfikowany ${STAMP}`)),
				file('dwa.md', withParts(`Granice ${STAMP}`))
			]);
		await page.locator('[data-testid="bulk-ai"]').check();
		await page.locator('[data-testid="bulk-check"]').click();
		await page.locator('[data-testid="bulk-send"]:not([disabled])').waitFor();
		check(
			'the parts column says 2',
			(await page.locator('[data-testid="bulk-row"]').nth(1).innerText()).includes('2')
		);
		await page.locator('[data-testid="bulk-send"]').click();
		await page.locator('[data-testid="bulk-done"]').waitFor();
		const done = await page.locator('[data-testid="bulk-done"]').innerText();
		check('"Published 2 exercise(s)"', /Published 2 exercise/.test(done), done);
		await shot(page, '2-published');
		const open = page.locator('[data-testid="bulk-done"] a', { hasText: 'Open' }).nth(1);
		const href = await open.getAttribute('href');
		const id = href?.match(/exercises\/(\d+)/)?.[1];
		await open.click();
		await page.waitForURL(/\/exercises\/\d+/);
		await page.locator('h1').waitFor();
		check(
			'the exercise page opens with its title',
			(await page.locator('h1').innerText()).includes(`Granice ${STAMP}`)
		);
		await page.waitForTimeout(1500);
		await shot(page, '2-exercise');
		const detail = await api(VERIFIED, 'GET', `/exercises/${id}/`);
		check('it has two parts', detail.data.parts?.length === 2, JSON.stringify(detail.data.parts));
		check('it is not verified (AI-assisted, not reviewed)', detail.data.verified === false);
		const ai = await api(VERIFIED, 'GET', `/ai-assistance/?targets=exercise:${id}`);
		const reading = Array.isArray(ai.data)
			? ai.data[0]
			: (ai.data?.results?.[0] ?? Object.values(ai.data ?? {})[0]);
		check(
			'the author’s AI mark is on it',
			reading?.author_marked === true,
			JSON.stringify(ai.data).slice(0, 200)
		);
		await ctx.close();
	}

	// ---- 3. staff approves a whole batch -------------------------------------------------------
	{
		console.log('3. staff: approve one upload at once');
		const form = new FormData();
		form.append('branch', BRANCH);
		form.append('files', new Blob([good(`Partia A ${STAMP}`)], { type: 'text/markdown' }), 'a.md');
		form.append('files', new Blob([good(`Partia B ${STAMP}`)], { type: 'text/markdown' }), 'b.md');
		const sent = await api(PLAIN, 'POST', '/exercise-imports/?mode=commit', form);
		check(
			'the API commit queues two',
			sent.status === 201 && sent.data.created.length === 2,
			JSON.stringify(sent.data).slice(0, 200)
		);
		const { ctx, page } = await contextFor(STAFF);
		await page.goto(`${BASE}/moderation?tab=submissions`);
		const button = page.locator('[data-testid="queue-batch-approve"]').first();
		await button.waitFor({ timeout: 30000 });
		check(
			'the queue offers "Approve all … from this upload"',
			/Approve all \d+ from this upload/.test(await button.innerText())
		);
		check(
			'the row says it came from a bulk upload',
			(await page.locator('[data-testid="queue-bulk"]').count()) >= 2
		);
		await shot(page, '3-queue');
		await button.click();
		await page.getByText(/Approved \d+; skipped/).waitFor();
		const ids = sent.data.created.map((c) => c.submission);
		const after = await api(STAFF, 'GET', '/exercise-submissions/');
		const statuses = after.data.filter((s) => ids.includes(s.id)).map((s) => s.status);
		check(
			'both are approved',
			statuses.length === 2 && statuses.every((s) => s === 'approved'),
			statuses.join()
		);
		await ctx.close();
	}

	// ---- the kill switch ----------------------------------------------------------------------
	{
		console.log('4. the kill switch');
		await setFlag('exercise_bulk_upload', false);
		const { ctx, page } = await contextFor(PLAIN);
		await page.goto(`${BASE}/submit`);
		await page.locator('.mine-link').first().waitFor({ timeout: 30000 });
		check(
			'no bulk link on /submit',
			(await page.locator('[data-testid="submit-bulk-link"]').count()) === 0
		);
		await page.locator('.site-header button.popover__trigger:has(.add-trigger)').click();
		await page.waitForTimeout(300);
		check(
			'no bulk entry in the Add… menu',
			(await page.locator('a[href$="/submit/bulk"]').count()) === 0
		);
		await page.goto(`${BASE}/submit/bulk`);
		await page.waitForTimeout(1500);
		check(
			'the page draws no form',
			(await page.locator('[data-testid="bulk-files"]').count()) === 0
		);
		const closed = await api(PLAIN, 'POST', '/exercise-imports/?mode=preview', new FormData());
		check('the endpoint answers 403', closed.status === 403, String(closed.status));
		await ctx.close();
	}
} finally {
	await setFlag('exercise_bulk_upload', true);
	await browser.close();
}

check('no uncaught page errors', errors.length === 0, errors.join(' | '));
console.log(`\n${pass} passed, ${fail} failed; screenshots in ${SHOTS}`);
process.exit(fail ? 1 : 0);
