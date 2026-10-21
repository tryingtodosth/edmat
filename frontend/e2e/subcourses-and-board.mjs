// The course tree, outside content in a course's programme, and the course board (owner,
// 2026-10-21: "courses can have their own courses (subcourses) … external courses (from edmat
// itself or as a link) … a discussion board … post pdfs, imgs, notes, comments, links … link and
// be linked to specific courses/subcourses"). Drives the real forms — the subcourse form, the ask
// form with a link attached — and reads what a reader would: the breadcrumb, the subcourses
// panel, the Board tab, the post's page, the content tab's three new kinds, and the `posts` kill
// switch as a NON-staff account (trap 10).
//
// Signs in by TOKEN (trap 30). Read the tokens once (test.md §e2e) and run:
//
//   E2E_BASE=http://localhost:5173 E2E_API=http://localhost:8000/api \
//   E2E_STAFF_TOKEN=<u-kasia> E2E_TOKEN=<u-michal, verified, not staff> \
//   E2E_PLAIN_TOKEN=<u-ola, neither> E2E_TAG=<an existing tag slug> \
//   CHROME=<chrome-headless-shell> node e2e/subcourses-and-board.mjs
//
// Leaves nothing behind: the courses and the post it creates are deleted through the API at the
// end, and the flag it turns off is turned back on in a `finally`.
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
const STAFF = process.env.E2E_STAFF_TOKEN;
const VERIFIED = process.env.E2E_TOKEN;
const PLAIN = process.env.E2E_PLAIN_TOKEN;
const TAG = process.env.E2E_TAG ?? 'granice';
if (!STAFF || !VERIFIED || !PLAIN) throw new Error('E2E_STAFF_TOKEN, E2E_TOKEN, E2E_PLAIN_TOKEN');
const SHOTS =
	process.env.SHOTS ?? new URL('./screens/subcourses-and-board/', import.meta.url).pathname;
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
const setFlag = (key, on) => api(STAFF, 'PATCH', `/feature-flags/${key}/`, { is_enabled: on });

const browser = await chromium.launch(
	process.env.CHROME ? { executablePath: process.env.CHROME } : {}
);
const errors = [];
async function contextFor(token, { locale = 'en', width = 1280, height = 900 } = {}) {
	const opts = { viewport: { width, height } };
	const ctx =
		locale === 'en' ? await englishContext(browser, BASE, opts) : await browser.newContext(opts);
	if (token) await ctx.addInitScript((t) => localStorage.setItem('edmat-auth-token', t), token);
	const page = await ctx.newPage();
	page.on('pageerror', (e) => errors.push(String(e)));
	page.on('response', (r) => {
		// Trap 26: KaTeX webfonts 403 under a worktree's dev server; matched by URL, counted.
		if (r.status() === 403 && /katex.*fonts/.test(r.url())) katexFonts++;
	});
	page.on('console', (msg) => {
		if (msg.type() === 'error' && !/Failed to load resource/.test(msg.text()))
			errors.push(msg.text());
	});
	return { ctx, page };
}
let katexFonts = 0;
async function open(page, path, { signedIn = true } = {}) {
	const booted = page
		.waitForResponse((r) => r.url().includes('/feature-flags/'), { timeout: 30000 })
		.catch(() => {});
	await page.goto(`${BASE}${path}`, { waitUntil: 'load' });
	await booted;
	if (signedIn) await page.locator('.account-trigger').first().waitFor({ timeout: 30000 });
	await page.waitForTimeout(1200);
}
const shot = (page, name, full = false) =>
	page.screenshot({ path: `${SHOTS}${name}.png`, fullPage: full });

const createdCourses = [];
let postId = null;
const me = await api(VERIFIED, 'GET', '/auth/me/');
const savedLocales = me.data?.content_locales ?? [];
try {
	await api(VERIFIED, 'PATCH', '/auth/me/', { content_locales: ['pl', 'en'] });
	await setFlag('courses', true);
	await setFlag('posts', true);
	await setFlag('attachments', true);

	console.log('[1] A root course by API, a subcourse through the form');
	const root = await api(VERIFIED, 'POST', '/courses/', {
		title: `E2E Analysis ${STAMP}`,
		visibility: 'public',
		status: 'open',
		audience: 'university',
		language: 'en'
	});
	check('the root course is created', root.status === 201, JSON.stringify(root.data));
	const rootId = String(root.data.id);
	createdCourses.push(rootId);
	let subId;
	{
		const { ctx, page } = await contextFor(VERIFIED);
		await open(page, `/courses/new?parent=${rootId}&as=subcourse`);
		check(
			'the heading says "Add a subcourse"',
			(await page.locator('h1').innerText()).includes('Add a subcourse'),
			await page.locator('h1').innerText()
		);
		const form = page.locator('form').filter({ has: page.locator('input[name="course-kind"]') });
		check('the subcourse form still asks what kind it is', (await form.count()) === 1);
		check(
			'and says which course it is a subcourse of',
			(await page.locator('.version-of').innerText()).includes(`E2E Analysis ${STAMP}`)
		);
		await form.locator('input[name="course-kind"][value="topic"]').check();
		await form.locator('input[type="text"][maxlength="200"]').last().fill(`E2E Part one ${STAMP}`);
		await form.locator('input[type="radio"][value="public"]').first().check();
		await form.locator('select:has(option[value="university"])').first().selectOption('university');
		await shot(page, 'subcourse-form', true);
		await form.locator('button[type="submit"]').click();
		await page.waitForURL(/\/courses\/\d+$/, { timeout: 20000 });
		subId = page.url().match(/\/courses\/(\d+)$/)[1];
		createdCourses.push(subId);
		await page.waitForTimeout(1500);
		check(
			'the new course reads as a subcourse',
			(await page.locator('.kind-pill').innerText()).trim() === 'Subcourse',
			await page.locator('.kind-pill').innerText()
		);
		const trail = page.locator('[data-course-trail]');
		check(
			'the breadcrumb names the root',
			(await trail.innerText()).includes(`E2E Analysis ${STAMP}`),
			await trail.innerText()
		);
		await shot(page, 'subcourse-page', true);
		await ctx.close();
	}

	console.log('[2] The root lists its subcourse; a stranger is offered nothing to add');
	{
		const { ctx, page } = await contextFor(VERIFIED);
		await open(page, `/courses/${rootId}`);
		const panel = page.locator('[data-subcourses]');
		await panel.waitFor({ timeout: 15000 });
		check(
			'the subcourses panel names the part',
			(await panel.innerText()).includes(`E2E Part one ${STAMP}`),
			await panel.innerText()
		);
		check('the owner is offered "Add a subcourse"', (await panel.locator('a.add').count()) === 1);
		await shot(page, 'root-with-subcourse', true);
		await ctx.close();
	}
	{
		const { ctx, page } = await contextFor(PLAIN);
		await open(page, `/courses/${rootId}`);
		const panel = page.locator('[data-subcourses]');
		await panel.waitFor({ timeout: 15000 });
		check(
			'a stranger sees the subcourse',
			(await panel.innerText()).includes(`E2E Part one ${STAMP}`)
		);
		check('but no "Add a subcourse"', (await panel.locator('a.add').count()) === 0);
		await ctx.close();
	}

	console.log('[3] Outside content in the programme: another course, a link, a post');
	const chapter = await api(VERIFIED, 'POST', `/courses/${rootId}/chapters/`, {
		title: 'Week 1',
		order: 0
	});
	check('a chapter is created', chapter.status === 201, JSON.stringify(chapter.data));
	const chId = chapter.data.id;
	const courseItem = await api(VERIFIED, 'POST', `/courses/${rootId}/items/`, {
		linked_course: Number(subId),
		chapter: chId,
		note: 'Do this first'
	});
	check(
		'another course becomes an item',
		courseItem.status === 201 && courseItem.data.kind === 'course',
		JSON.stringify(courseItem.data)
	);
	const linkItem = await api(VERIFIED, 'POST', `/courses/${rootId}/items/`, {
		link_url: 'https://ocw.mit.edu/18-01',
		link_title: `MIT 18.01 ${STAMP}`,
		chapter: chId
	});
	check(
		'an outside link becomes an item',
		linkItem.status === 201 && linkItem.data.kind === 'link',
		JSON.stringify(linkItem.data)
	);
	const ftp = await api(VERIFIED, 'POST', `/courses/${rootId}/items/`, {
		link_url: 'ftp://x.org/a',
		chapter: chId
	});
	check('an ftp:// address is refused', ftp.status === 400, JSON.stringify(ftp.data));

	console.log('[4] A post about the subcourse from its board, with a link attached');
	{
		const { ctx, page } = await contextFor(VERIFIED);
		await open(page, `/courses/${subId}?tab=board`);
		const board = page.locator('[data-course-board]');
		await board.waitFor({ timeout: 15000 });
		check(
			'the Board tab is empty to begin with',
			(await board.innerText()).includes('Nothing posted about this course yet.'),
			await board.innerText()
		);
		await board.locator('a.post-here').click();
		await page.waitForURL(/\/ask\?course=/, { timeout: 15000 });
		await page.locator('form.ask').waitFor({ timeout: 15000 });
		await page.locator('[data-ask-about]').waitFor({ timeout: 15000 });
		check(
			'the ask form says which course it is about',
			(await page.locator('[data-ask-about]').innerText()).includes(`E2E Part one ${STAMP}`)
		);
		await page.locator('form.ask textarea#ask-body').waitFor({ timeout: 20000 });
		await page
			.locator('form.ask textarea#ask-body')
			.fill(`E2E board question ${STAMP}: which norm?`);
		await page.locator('form.ask #ask-tag').fill(TAG);
		await page
			.locator('.tag-picker__matches button', { hasText: `#${TAG}` })
			.first()
			.click();
		await page
			.locator('form.ask select:has(option[value="university"])')
			.selectOption('university');
		await page
			.locator('form.ask input[inputmode="url"]')
			.fill(`https://example.org/notes-${STAMP}`);
		await page.locator('form.ask input[maxlength="200"]').fill('My notes');
		await shot(page, 'ask-about-course', true);
		const posted = page
			.waitForResponse(
				(r) => r.url().includes('/attachments/') && r.request().method() === 'POST',
				{ timeout: 20000 }
			)
			.catch(() => null);
		await page.locator('form.ask button[type="submit"]').click();
		await posted;
		await page.waitForURL(/\/courses\/\d+\?tab=board/, { timeout: 20000 });
		await page.locator('[data-course-board] article.post').first().waitFor({ timeout: 15000 });
		const rows = page.locator('[data-course-board] article.post');
		check(
			'the board now lists the post',
			(await rows.innerText()).includes(`E2E board question ${STAMP}`)
		);
		check(
			'the row says one thing is attached',
			(await rows.first().innerText()).includes('1 attached'),
			await rows.first().innerText()
		);
		await shot(page, 'board-with-post', true);
		await rows.first().locator('a.post__permalink').click();
		await page.waitForURL(/\/posts\/\d+/, { timeout: 15000 });
		postId = page.url().match(/\/posts\/(\d+)/)[1];
		await page.locator('[data-fold="attachments"]').waitFor({ timeout: 15000 });
		const fold = page.locator('[data-fold="attachments"]');
		if (!(await fold.locator('a:has-text("Open the link")').count()))
			await fold.locator('.fold__toggle').first().click();
		await page.waitForTimeout(1200);
		check(
			'the post page shows the attached link',
			(await page.locator('[data-fold="attachments"]').innerText()).includes('My notes'),
			await page.locator('[data-fold="attachments"]').innerText()
		);
		await shot(page, 'post-with-attachment', true);
		await ctx.close();
	}
	{
		const parentBoard = await api(null, 'GET', `/posts/?course=${rootId}`);
		check(
			"the root's board gathers the subcourse's post",
			parentBoard.status === 200 &&
				parentBoard.data.some((p) => String(p.body).includes(String(STAMP))),
			JSON.stringify(parentBoard.data).slice(0, 200)
		);
		const postItem = await api(VERIFIED, 'POST', `/courses/${rootId}/items/`, {
			post: Number(postId),
			chapter: chId
		});
		check(
			'the post can be filed into the programme',
			postItem.status === 201 && postItem.data.kind === 'post',
			JSON.stringify(postItem.data)
		);
	}

	console.log('[5] The content tab draws the three kinds');
	{
		const { ctx, page } = await contextFor(PLAIN);
		await open(page, `/courses/${rootId}`);
		await page.locator('.item').first().waitFor({ timeout: 15000 });
		const items = await page.locator('.item').evaluateAll((els) =>
			els.map((e) => ({
				kind: e.querySelector('.kind')?.textContent.trim(),
				label: e.querySelector('a.label')?.textContent.trim(),
				href: e.querySelector('a.label')?.getAttribute('href'),
				target: e.querySelector('a.label')?.getAttribute('target')
			}))
		);
		check(
			'a "Course" row links to the subcourse',
			items.some((i) => i.kind === 'Course' && i.href === `/courses/${subId}`),
			JSON.stringify(items)
		);
		check(
			'a "Link" row opens the outside address in a new tab',
			items.some(
				(i) => i.kind === 'Link' && i.href === 'https://ocw.mit.edu/18-01' && i.target === '_blank'
			),
			JSON.stringify(items)
		);
		check(
			'a "Post" row links to the post',
			items.some((i) => i.kind === 'Post' && i.href === `/posts/${postId}`),
			JSON.stringify(items)
		);
		await shot(page, 'content-three-kinds', true);
		await ctx.close();
	}

	console.log('[6] posts off: the Board tab and the ask door leave (non-staff)');
	{
		await setFlag('posts', false);
		const { ctx, page } = await contextFor(PLAIN);
		await open(page, `/courses/${subId}`);
		await page.locator('[role="tablist"]').first().waitFor({ timeout: 15000 });
		const tabs = await page.locator('[role="tab"]').allInnerTexts();
		check('no Board tab', !tabs.some((t) => t.trim() === 'Board'), tabs.join(','));
		await ctx.close();
		await setFlag('posts', true);
	}
} catch (e) {
	// Said before the `finally` exits the process, or a thrown step would vanish without a trace.
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
	await setFlag('posts', true);
	if (postId) {
		const res = await api(VERIFIED, 'DELETE', `/posts/${postId}/`);
		if (res.status !== 204) console.log(`  (cleanup: post ${postId} → ${res.status})`);
	}
	for (const id of createdCourses.reverse()) {
		const res = await api(VERIFIED, 'DELETE', `/courses/${id}/`);
		if (res.status !== 204) console.log(`  (cleanup: course ${id} → ${res.status})`);
	}
	const left = await api(VERIFIED, 'GET', `/courses/?mine=teaching`);
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
