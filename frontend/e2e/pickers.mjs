// Lists instead of pasted ids (owner, 2026-10-21: "lets improve the course picker, and other places
// where we could instead of text input requirement give user a list instead"). Drives the real forms:
// the edit form's "Part of" course picker (a move), the course manage page's person picker (the
// suggestions list and the account-id fallback), the content editor's "Another course" picker, and
// the ask form's optional course. Tokens, not the login form (trap 30).
//
//   LD_LIBRARY_PATH=… E2E_BASE=http://localhost:5173 E2E_API=http://localhost:8000/api \
//   E2E_TOKEN=<u-michal, verified> E2E_PLAIN_TOKEN=<u-ola> CHROME=<chrome-headless-shell> node e2e/pickers.mjs
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
const VERIFIED = process.env.E2E_TOKEN;
const PLAIN = process.env.E2E_PLAIN_TOKEN;
if (!VERIFIED || !PLAIN) throw new Error('E2E_TOKEN, E2E_PLAIN_TOKEN');
const SHOTS = process.env.SHOTS ?? new URL('./screens/pickers/', import.meta.url).pathname;
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
	page.on('console', (msg) => {
		if (msg.type() === 'error' && !/Failed to load resource/.test(msg.text()))
			errors.push(msg.text());
	});
	return { ctx, page };
}
async function open(page, path) {
	const booted = page
		.waitForResponse((r) => r.url().includes('/feature-flags/'), { timeout: 30000 })
		.catch(() => {});
	await page.goto(`${BASE}${path}`, { waitUntil: 'load' });
	await booted;
	await page.locator('.account-trigger').first().waitFor({ timeout: 30000 });
	await page.waitForTimeout(1200);
}
const shot = (page, name) => page.screenshot({ path: `${SHOTS}${name}.png`, fullPage: true });

const created = [];
const me = await api(VERIFIED, 'GET', '/auth/me/');
const ola = await api(PLAIN, 'GET', '/auth/me/');
const savedLocales = me.data?.content_locales ?? [];
try {
	await api(VERIFIED, 'PATCH', '/auth/me/', { content_locales: ['pl', 'en'] });
	const mk = async (body) => {
		const res = await api(VERIFIED, 'POST', '/courses/', {
			visibility: 'public',
			status: 'open',
			audience: 'university',
			language: 'en',
			...body
		});
		if (res.status !== 201) throw new Error(`course: ${res.status} ${JSON.stringify(res.data)}`);
		created.push(String(res.data.id));
		return String(res.data.id);
	};
	const rootA = await mk({ title: `E2E Picker root A ${STAMP}` });
	const rootB = await mk({ title: `E2E Picker root B ${STAMP}` });
	const sub = await mk({ title: `E2E Picker part ${STAMP}`, parent: Number(rootA) });

	console.log('[1] The edit form moves a subcourse with the course picker');
	{
		const { ctx, page } = await contextFor(VERIFIED);
		await open(page, `/courses/${sub}/edit`);
		const picker = page.locator('[data-course-picker]').first();
		await picker.waitFor({ timeout: 15000 });
		check(
			'the picker shows the current parent as a chip',
			(await picker.innerText()).includes(`E2E Picker root A ${STAMP}`),
			await picker.innerText()
		);
		await picker.locator('button.course-picker__change').click();
		await picker.locator('input#course-parent').fill(`Picker root B ${STAMP}`);
		await picker
			.locator('.course-picker__match', { hasText: `root B ${STAMP}` })
			.first()
			.waitFor({ timeout: 15000 });
		await shot(page, 'edit-move-matches');
		await picker
			.locator('.course-picker__match', { hasText: `root B ${STAMP}` })
			.first()
			.click();
		check(
			'choosing a match draws its title',
			(await picker.innerText()).includes(`root B ${STAMP}`)
		);
		await page.locator('form button[type="submit"]').last().click();
		await page.waitForURL(new RegExp(`/courses/${sub}$`), { timeout: 20000 });
		const moved = await api(VERIFIED, 'GET', `/courses/${sub}/`);
		check(
			'the course now sits under root B',
			String(moved.data.parent) === rootB,
			JSON.stringify(moved.data.parent)
		);
		await ctx.close();
	}

	console.log('[2] The manage page adds staff with the person picker');
	{
		const { ctx, page } = await contextFor(VERIFIED);
		await open(page, `/courses/${rootA}/manage`);
		const picker = page.locator('[data-person-picker]').first();
		await picker.waitFor({ timeout: 15000 });
		await page.waitForTimeout(1500);
		const text = await picker.innerText();
		check(
			'the picker offers a list or says there is nobody yet',
			/People you work with|anybody yet|matches that/.test(text) ||
				(await picker.locator('.person-picker__match').count()) > 0,
			text
		);
		await shot(page, 'manage-person-picker');
		await picker.locator('input[inputmode="numeric"]').fill(String(ola.data.id));
		await picker.locator('button.person-picker__use').click();
		check(
			'an account id becomes the chosen person',
			(await picker.innerText()).includes(`#${ola.data.id}`) ||
				(await picker.innerText()).includes(ola.data.display_name ?? '§'),
			await picker.innerText()
		);
		await page.locator('section.staff form button[type="submit"]').click();
		await page.waitForTimeout(1500);
		const staff = await api(VERIFIED, 'GET', `/courses/${rootA}/staff/`);
		check(
			'Ola is on the staff',
			staff.data.some((row) => String(row.user.id) === String(ola.data.id)),
			JSON.stringify(staff.data).slice(0, 200)
		);
		await ctx.close();
	}

	console.log('[3] The content editor files another course from the picker');
	const chapter = await api(VERIFIED, 'POST', `/courses/${rootA}/chapters/`, {
		title: 'Week 1',
		order: 0
	});
	{
		const { ctx, page } = await contextFor(VERIFIED);
		await open(page, `/courses/${rootA}`);
		await page.locator('.chapter__actions button', { hasText: /Edit/ }).first().click();
		const dialog = page.locator('[role="dialog"]').first();
		await dialog.waitFor({ timeout: 15000 });
		await dialog.locator('.links select').first().selectOption('course');
		const picker = dialog.locator('[data-course-picker]');
		await picker.waitFor({ timeout: 15000 });
		await picker.locator('input').fill(`Picker root B ${STAMP}`);
		await picker
			.locator('.course-picker__match', { hasText: `root B ${STAMP}` })
			.first()
			.waitFor({ timeout: 15000 });
		await picker
			.locator('.course-picker__match', { hasText: `root B ${STAMP}` })
			.first()
			.click();
		await page.waitForTimeout(1500);
		await shot(page, 'editor-course-picked');
		const items = await api(VERIFIED, 'GET', `/courses/${rootA}/items/`);
		check(
			'root B is now an item of root A',
			items.data.some((row) => row.kind === 'course' && String(row.linked_course) === rootB),
			JSON.stringify(items.data).slice(0, 200)
		);
		await ctx.close();
	}

	console.log('[4] The ask form offers a course when none was preset');
	{
		const { ctx, page } = await contextFor(VERIFIED);
		await open(page, '/ask');
		const picker = page.locator('form.ask [data-course-picker]');
		await picker.waitFor({ timeout: 15000 });
		await picker.locator('input#ask-course').fill(`Picker root A ${STAMP}`);
		await picker
			.locator('.course-picker__match', { hasText: `root A ${STAMP}` })
			.first()
			.waitFor({ timeout: 15000 });
		await picker
			.locator('.course-picker__match', { hasText: `root A ${STAMP}` })
			.first()
			.click();
		check(
			'the ask form holds the chosen course',
			(await picker.innerText()).includes(`root A ${STAMP}`)
		);
		await shot(page, 'ask-course-picked');
		await ctx.close();
	}
	void chapter;
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
	await api(VERIFIED, 'PATCH', '/auth/me/', { content_locales: savedLocales });
	for (const id of created.reverse()) {
		const res = await api(VERIFIED, 'DELETE', `/courses/${id}/`);
		if (res.status !== 204) console.log(`  (cleanup: course ${id} → ${res.status})`);
	}
	const left = await api(VERIFIED, 'GET', '/courses/?mine=teaching');
	check(
		'cleanup: no E2E course of this run is left',
		!left.data.some((c) => String(c.title).includes(String(STAMP)))
	);
	if (katexFonts) console.log(`  (ignored ${katexFonts} KaTeX font 403s — trap 26)`);
	check('zero page/console errors', errors.length === 0, errors.slice(0, 5).join('\n'));
	await browser.close();
	console.log(`\n${pass} passed, ${fail} failed`);
	process.exit(fail ? 1 : 0);
}
