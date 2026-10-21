// The author's (or staff's) in-place edit of an exercise (owner, 2026-10-21: "even though im a
// superadmin and author of a specific exercise, there's no edit option … and there should").
// Drives the real pages: the Edit link on the exercise page and on /submit/mine, the edit form
// end to end (title, statement, difficulty, a tag), the "Saved." notice, and the two refusals —
// a stranger sees "Suggest an edit" instead, gets 403 from PATCH, and the edit address tells
// them so. Tokens, not the login form (trap 30).
//
//   LD_LIBRARY_PATH=… E2E_BASE=http://localhost:5173 E2E_API=http://localhost:8000/api \
//   E2E_TOKEN=<u-michal, the author> E2E_PLAIN_TOKEN=<u-ola> E2E_STAFF_TOKEN=<u-kasia, staff> \
//   E2E_EXERCISE=<id of an exercise michal wrote> CHROME=<chrome-headless-shell> node e2e/exercise-edit.mjs
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
const AUTHOR = process.env.E2E_TOKEN;
const PLAIN = process.env.E2E_PLAIN_TOKEN;
const STAFF = process.env.E2E_STAFF_TOKEN;
const EXERCISE = process.env.E2E_EXERCISE;
if (!AUTHOR || !PLAIN || !STAFF || !EXERCISE)
	throw new Error('E2E_TOKEN, E2E_PLAIN_TOKEN, E2E_STAFF_TOKEN, E2E_EXERCISE');
const SHOTS = process.env.SHOTS ?? new URL('./screens/exercise-edit/', import.meta.url).pathname;
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
			'Content-Type': 'application/json',
			...(token ? { Authorization: `Token ${token}` } : {})
		},
		body: body ? JSON.stringify(body) : undefined
	});
	const text = await res.text();
	return { status: res.status, data: text ? JSON.parse(text) : null };
}

const browser = await chromium.launch(
	process.env.CHROME ? { executablePath: process.env.CHROME } : {}
);
const errors = [];
let katexFonts = 0;
async function contextFor(token, { width = 1280, height = 900 } = {}) {
	const ctx = await englishContext(browser, BASE, { viewport: { width, height } });
	if (token) await ctx.addInitScript((t) => localStorage.setItem('edmat-auth-token', t), token);
	const page = await ctx.newPage();
	page.on('pageerror', (e) => errors.push(String(e)));
	page.on('response', (r) => {
		if (r.status() === 403 && /katex.*fonts/.test(r.url())) katexFonts++;
	});
	return { ctx, page };
}
const shot = (page, name) => page.screenshot({ path: `${SHOTS}${name}.png`, fullPage: true });

const before = (await api(null, 'GET', `/exercises/${EXERCISE}/`)).data;
const originalTitle = before.title;
const originalDifficulty = before.difficulty;

try {
	// ---- 1. the author: the link, the form, the save ----------------------------------------
	{
		const { ctx, page } = await contextFor(AUTHOR);
		await page.goto(`${BASE}/exercises/${EXERCISE}`);
		await page.waitForSelector('h1');
		const link = page.locator('[data-edit-exercise]');
		check('author: the exercise page offers Edit', (await link.count()) === 1);
		check(
			'author: no "Suggest an edit" beside it',
			(await page.getByRole('button', { name: 'Suggest an edit' }).count()) === 0
		);
		await link.click();
		await page.waitForSelector('[data-exercise-edit] form');
		await shot(page, 'author-edit-form');
		const form = page.locator('[data-exercise-edit] form');
		check(
			'author: the form is prefilled with the title',
			(await form.locator('input[type="text"]').first().inputValue()) === originalTitle
		);
		await form.locator('input[type="text"]').first().fill(`${originalTitle} (edited ${STAMP})`);
		await form.locator('select').first().selectOption('hard');
		await form.locator('input[type="text"]').nth(1).fill(`e2e-edit-${STAMP}`);
		await form.getByRole('button', { name: 'Save' }).click();
		await page.waitForSelector('[data-saved]', { timeout: 15000 });
		await shot(page, 'author-saved');
		check(
			'author: back on the exercise page with "Saved."',
			page.url().includes(`/exercises/${EXERCISE}`)
		);
		const after = (await api(null, 'GET', `/exercises/${EXERCISE}/`)).data;
		check('the title changed', after.title === `${originalTitle} (edited ${STAMP})`, after.title);
		check('the difficulty changed', after.difficulty === 'hard', after.difficulty);
		check('the tag is on it', after.tags.includes(`e2e-edit-${STAMP}`), JSON.stringify(after.tags));
		const history = (await api(AUTHOR, 'GET', `/edit-suggestions/?exercise=${EXERCISE}`)).data;
		check(
			'the title change is an approved row in the history',
			history.some((h) => h.field === 'title' && h.status === 'approved'),
			JSON.stringify(history).slice(0, 200)
		);
		await ctx.close();
	}

	// ---- 2. /submit/mine: the Edit link on the approved row --------------------------------
	{
		const { ctx, page } = await contextFor(AUTHOR);
		await page.goto(`${BASE}/submit/mine`);
		await page.waitForSelector('[data-submission]');
		const link = page.locator(`[data-edit-exercise][href$="/exercises/${EXERCISE}/edit"]`);
		check('mine: the approved row offers Edit', (await link.count()) === 1);
		await shot(page, 'mine-edit-link');
		await ctx.close();
	}

	// ---- 3. a stranger: suggestion path only, 403 on the API, told so on the edit address ----
	{
		const { ctx, page } = await contextFor(PLAIN);
		await page.goto(`${BASE}/exercises/${EXERCISE}`);
		await page.waitForSelector('h1');
		check('stranger: no Edit link', (await page.locator('[data-edit-exercise]').count()) === 0);
		check(
			'stranger: "Suggest an edit" is there',
			(await page.getByRole('button', { name: 'Suggest an edit' }).count()) === 1
		);
		const res = await api(PLAIN, 'PATCH', `/exercises/${EXERCISE}/`, { difficulty: 'easy' });
		check(
			'stranger: PATCH is 403 exercise_not_editor',
			res.status === 403 && res.data.detail === 'exercise_not_editor',
			JSON.stringify(res)
		);
		await page.goto(`${BASE}/exercises/${EXERCISE}/edit`);
		await page.waitForSelector('[data-exercise-edit] .refused');
		check(
			'stranger: the edit address refuses in words',
			(await page.locator('[data-exercise-edit] .refused').innerText()).includes(
				'You cannot edit this exercise'
			)
		);
		check(
			'stranger: no form drawn',
			(await page.locator('[data-exercise-edit] form').count()) === 0
		);
		await shot(page, 'stranger-refused');
		await ctx.close();
	}

	// ---- 4. staff: Edit on somebody else's exercise -----------------------------------------
	{
		const { ctx, page } = await contextFor(STAFF);
		await page.goto(`${BASE}/exercises/${EXERCISE}`);
		await page.waitForSelector('h1');
		check(
			'staff: the exercise page offers Edit',
			(await page.locator('[data-edit-exercise]').count()) === 1
		);
		await page.goto(`${BASE}/exercises/${EXERCISE}/edit`);
		await page.waitForSelector('[data-exercise-edit] form');
		check(
			'staff: the lead says it is a staff edit',
			(await page.locator('.subtitle').innerText()).includes('As staff')
		);
		await ctx.close();
	}
	check(
		'PUT is gone',
		(await api(STAFF, 'PUT', `/exercises/${EXERCISE}/`, { difficulty: 'easy' })).status === 405
	);
	check('DELETE is gone', (await api(STAFF, 'DELETE', `/exercises/${EXERCISE}/`)).status === 405);
} catch (e) {
	check(
		'the script ran to its end',
		false,
		String(e?.message ?? e)
			.split('\n')
			.slice(0, 6)
			.join(' | ')
	);
} finally {
	const restore = await api(AUTHOR, 'PATCH', `/exercises/${EXERCISE}/`, {
		title: originalTitle,
		difficulty: originalDifficulty,
		tags: before.tags
	});
	check(
		'cleanup: the exercise is as it was',
		restore.status === 200 && restore.data.title === originalTitle
	);
	if (katexFonts) console.log(`  (ignored ${katexFonts} KaTeX font 403s — trap 26)`);
	check('zero page/console errors', errors.length === 0, errors.slice(0, 5).join('\n'));
	await browser.close();
	console.log(`\n${pass} passed, ${fail} failed`);
	process.exit(fail ? 1 : 0);
}
