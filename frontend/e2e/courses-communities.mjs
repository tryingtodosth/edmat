// Materials and Courses back in the navbar and the Add… menu, and a general course with its
// university/faculty versions (owner, 2026-10-14). Drives the real form, then reads what a reader
// would: the course pages, the gathered materials, the hub's filters, both locales, and the kill
// switches as a NON-staff account (trap 10).
//
// Signs in by TOKEN, never through the login form (trap 30: the login throttle is ~10/hour/IP and a
// verification session burns it in minutes). Read the three tokens once:
//   manage.py shell -c "from rest_framework.authtoken.models import Token; ..."
//
//   E2E_BASE=http://localhost:5196 E2E_API=http://localhost:8046/api \
//   E2E_STAFF_TOKEN=<u-kasia> E2E_TOKEN=<u-michal, verified, not staff> \
//   E2E_PLAIN_TOKEN=<u-ola, neither> E2E_MATERIAL=<a published material id> \
//   CHROME=<chrome-headless-shell> node e2e/courses-communities.mjs
//
// Leaves nothing behind: the two courses it creates are deleted through the API at the end, and
// both flags it turns off are turned back on in a `finally`.
import { mkdirSync } from 'node:fs';
import { englishContext } from './english.mjs';

let chromium;
try {
	({ chromium } = await import('playwright'));
} catch {
	({ chromium } = await import('playwright-core'));
}

const BASE = process.env.E2E_BASE ?? 'http://localhost:5196';
const API = process.env.E2E_API ?? 'http://localhost:8046/api';
const STAFF = process.env.E2E_STAFF_TOKEN;
const VERIFIED = process.env.E2E_TOKEN;
const PLAIN = process.env.E2E_PLAIN_TOKEN;
const MATERIAL = process.env.E2E_MATERIAL ?? '1';
if (!STAFF || !VERIFIED || !PLAIN) throw new Error('E2E_STAFF_TOKEN, E2E_TOKEN, E2E_PLAIN_TOKEN');
const SHOTS =
	process.env.SHOTS ?? new URL('./screens/courses-communities/', import.meta.url).pathname;
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
	page.on('console', (msg) => {
		// Trap 26: KaTeX fonts 403 in a worktree's dev server. Filtered by text because these lines
		// carry no URL; counted, never silent.
		if (msg.type() === 'error' && !/Failed to load resource/.test(msg.text()))
			errors.push(msg.text());
	});
	return { ctx, page };
}
/** Navigate and wait for the layout's boot request (trap 25) and the header's signed-in state. */
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
async function navFits(page) {
	return page.evaluate(() => {
		const nav = document.querySelector('.site-nav');
		return nav ? nav.scrollWidth - nav.clientWidth : -1;
	});
}

const created = [];
// Trap 16: lists are narrowed to the reader's content languages, and an English-interface context
// reading Polish-language courses would see an honestly EMPTY hub. Widen the account's languages for
// the run and put them back afterwards.
const me = await api(VERIFIED, 'GET', '/auth/me/');
const savedLocales = me.data?.content_locales ?? [];
try {
	await api(VERIFIED, 'PATCH', '/auth/me/', { content_locales: ['pl', 'en'] });
	await setFlag('courses', true);
	await setFlag('material_submissions', true);

	console.log('[1] The bar carries Materials and Courses, and still fits');
	{
		const { ctx, page } = await contextFor(VERIFIED);
		await open(page, '/');
		const order = await page
			.locator('.site-nav > a.nav-link')
			.evaluateAll((els) => els.map((e) => e.className.match(/nav-link--(\w+)/)?.[1]));
		check(
			'Exercises, Materials, Courses lead the bar in that order',
			order.slice(0, 3).join(',') === 'disciplines,materials,classroom',
			order.join(',')
		);
		check(
			'Materials is a word at 1280',
			await page.locator('.site-nav .nav-link--materials .nav-link__text').isVisible()
		);
		check(
			'Courses is a word at 1280',
			await page.locator('.site-nav .nav-link--classroom .nav-link__text').isVisible()
		);
		check('nothing in the bar is scrolled out of sight at 1280', (await navFits(page)) <= 0);
		await shot(page, 'nav-en-1280');
		await page.setViewportSize({ width: 1024, height: 900 });
		await page.waitForTimeout(400);
		check('nor at 1024', (await navFits(page)) <= 0, String(await navFits(page)));
		check(
			'Materials and Courses keep their words at 1024',
			(await page.locator('.site-nav .nav-link--materials .nav-link__text').isVisible()) &&
				(await page.locator('.site-nav .nav-link--classroom .nav-link__text').isVisible())
		);
		await shot(page, 'nav-en-1024');
		await page.setViewportSize({ width: 1280, height: 900 });
		await page.locator('header button[aria-haspopup="menu"]', { hasText: /Add/ }).click();
		await page.waitForTimeout(400);
		const menu = await page.locator('header [role="menu"]').first().innerText();
		check('the Add menu offers "Add a material"', /Add a material/.test(menu), menu);
		check(
			'the Add menu offers "Start a course or community"',
			/Start a course or community/.test(menu),
			menu
		);
		await shot(page, 'add-menu-en');
		await page.keyboard.press('Escape');
		await page.locator('.site-nav .nav-link--materials').click();
		await page.waitForURL(/\/materials/, { timeout: 15000 });
		check('the Materials link opens /materials', page.url().includes('/materials'));
		check(
			'the materials hub links onward to courses',
			await page.locator('a.courses-link').isVisible()
		);
		await ctx.close();
	}
	{
		const { ctx, page } = await contextFor(VERIFIED, { locale: 'pl' });
		await open(page, '/');
		check('Polish bar fits at 1280', (await navFits(page)) <= 0, String(await navFits(page)));
		const href = await page.locator('.site-nav .nav-link--materials').getAttribute('href');
		check('Materials points at /materialy in Polish', href === '/materialy', href);
		check(
			'Kursy is in the bar',
			(await page.locator('.site-nav .nav-link--classroom').innerText()).includes('Kursy')
		);
		await shot(page, 'nav-pl-1280');
		await page.setViewportSize({ width: 1024, height: 900 });
		await page.waitForTimeout(400);
		check('Polish bar fits at 1024', (await navFits(page)) <= 0, String(await navFits(page)));
		await shot(page, 'nav-pl-1024');
		await ctx.close();
	}

	console.log('[2] The phone drawer carries both, and both Add entries');
	{
		const { ctx, page } = await contextFor(VERIFIED, { width: 390, height: 844 });
		await open(page, '/', { signedIn: false });
		await page.waitForTimeout(1500);
		await page.locator('.drawer-toggle').click();
		await page.locator('.drawer').waitFor({ state: 'visible', timeout: 10000 });
		await page.waitForTimeout(500);
		const text = await page.locator('.drawer').innerText();
		for (const word of ['Materials', 'Courses', 'Add a material', 'Start a course or community'])
			check(`the drawer has "${word}"`, text.includes(word), text.slice(0, 300));
		await shot(page, 'drawer-390');
		await ctx.close();
	}

	console.log('[3] A general course, made through the form');
	let generalId;
	{
		const { ctx, page } = await contextFor(VERIFIED);
		await open(page, '/courses/new');
		const form = page.locator('form').filter({ has: page.locator('input[name="course-kind"]') });
		check('the form asks what is being started', (await form.count()) === 1);
		await form.locator('input[name="course-kind"][value="topic"]').check();
		check(
			'a general course asks no university',
			(await form.locator('input[name="university"]').count()) === 0
		);
		await form
			.locator('input[type="text"][maxlength="200"]')
			.last()
			.fill(`E2E Linear algebra ${STAMP}`);
		await form.locator('input[type="radio"][value="public"]').first().check();
		await form.locator('select:has(option[value="university"])').first().selectOption('university');
		await shot(page, 'form-general', true);
		await form.locator('button[type="submit"]').click();
		await page.waitForURL(/\/courses\/\d+$/, { timeout: 20000 });
		generalId = page.url().match(/\/courses\/(\d+)$/)[1];
		created.push(generalId);
		await page.locator('.kind-line').waitFor();
		check(
			'the page says it is a general course',
			/general course/i.test(await page.locator('.kind-line').innerText())
		);
		await page.locator('#course-versions-heading').waitFor({ timeout: 15000 });
		check(
			'it offers "Add a university/faculty version"',
			await page.locator('.versions a.add').isVisible()
		);
		await shot(page, 'general-course-empty', true);

		console.log('[4] A university/faculty version under it');
		await page.locator('.versions a.add').click();
		await page.waitForURL(/\/courses\/new\?parent=/, { timeout: 15000 });
		await page.locator('.version-of').waitFor({ timeout: 15000 });
		const vform = page.locator('form').filter({ has: page.locator('input[name="university"]') });
		check(
			'the version form does not ask the kind again',
			(await vform.locator('input[name="course-kind"]').count()) === 0
		);
		await vform.locator('input[name="university"]').fill('Uniwersytet Warszawski');
		await vform.locator('input[name="faculty"]').fill('Wydział MIM');
		await vform.locator('input[name="course_code"]').fill('1000-E2E');
		await vform.locator('input[name="current_term"]').fill('2026/27, zima');
		// The title is the first 200-long text input after the university block.
		const titles = vform.locator('input[type="text"][maxlength="200"]');
		await titles.nth((await titles.count()) - 1).fill(`E2E AM na MIM ${STAMP}`);
		await vform.locator('input[type="radio"][value="public"]').first().check();
		await vform
			.locator('select:has(option[value="university"])')
			.first()
			.selectOption('university');
		await shot(page, 'form-version', true);
		await vform.locator('button[type="submit"]').click();
		await page.waitForURL(/\/courses\/\d+$/, { timeout: 20000 });
		const versionId = page.url().match(/\/courses\/(\d+)$/)[1];
		created.push(versionId);
		await page.locator('.parent-link').waitFor({ timeout: 15000 });
		check(
			'the version links back to its general course',
			(await page.locator('.parent-link a').getAttribute('href')).endsWith(`/courses/${generalId}`)
		);
		check(
			'and names its university and faculty',
			(await page.locator('.kind-line').innerText()).includes(
				'Uniwersytet Warszawski · Wydział MIM'
			)
		);

		console.log('[5] A material pinned to the version shows up on the general course');
		const pinned = await api(VERIFIED, 'POST', `/courses/${versionId}/items/`, {
			material: Number(MATERIAL)
		});
		check(
			'pinning a material to the version: 201',
			pinned.status === 201,
			JSON.stringify(pinned.data)
		);
		await open(page, `/courses/${versionId}`);
		await page.locator('.materials-index li').first().waitFor({ timeout: 15000 });
		check(
			'the version lists it under its own materials',
			(await page.locator('.materials-index li').count()) === 1
		);
		await shot(page, 'version-course', true);
		await open(page, `/courses/${generalId}`);
		await page.locator('.materials-index h3').waitFor({ timeout: 15000 });
		const gathered = await page.locator('.materials-index').innerText();
		check(
			'the general course gathers it "From the university versions"',
			gathered.includes('From the university versions') && gathered.includes('Wydział MIM'),
			gathered
		);
		await page
			.locator('.versions .uni')
			.first()
			.waitFor({ timeout: 15000 })
			.catch(() => {});
		check(
			'and lists the version under its university',
			(await page.locator('.versions').innerText()).includes('Uniwersytet Warszawski')
		);
		await shot(page, 'general-course-with-version', true);

		console.log('[6] The hub: general courses by default, versions one chip away');
		await open(page, '/courses');
		await page.locator('.chip[aria-pressed="true"]').waitFor();
		const cardTitles = async () =>
			page
				.locator('.course-card .title')
				.evaluateAll((els) => els.map((e) => e.textContent.trim()));
		let titles2 = await cardTitles();
		check(
			'the default view lists the general course, not its version',
			titles2.includes(`E2E Linear algebra ${STAMP}`) &&
				!titles2.includes(`E2E AM na MIM ${STAMP}`),
			titles2.join(' | ')
		);
		await shot(page, 'hub-general-en', true);
		await page.locator('select.university-select').first().selectOption('Uniwersytet Warszawski');
		await page.waitForTimeout(300);
		titles2 = await cardTitles();
		check(
			'choosing a university reaches the version',
			titles2.includes(`E2E AM na MIM ${STAMP}`) &&
				!titles2.includes(`E2E Linear algebra ${STAMP}`),
			titles2.join(' | ')
		);
		check(
			'and offers its faculties',
			(await page.locator('select.university-select').count()) === 2
		);
		await shot(page, 'hub-university-en', true);
		await ctx.close();
	}
	{
		const { ctx, page } = await contextFor(VERIFIED, { locale: 'pl' });
		await open(page, '/courses');
		check(
			'Polish hub heading',
			(await page.locator('h1').innerText()).includes('Kursy i społeczności')
		);
		await shot(page, 'hub-general-pl', true);
		await open(page, `/courses/${generalId}`);
		await page.locator('#course-versions-heading').waitFor({ timeout: 15000 });
		check(
			'Polish general course page',
			(await page.locator('#course-versions-heading').innerText()).includes('Wersje uczelniane')
		);
		await shot(page, 'general-course-pl', true);
		await ctx.close();
	}

	console.log('[7] Kill switches and the creation gate, as non-staff accounts');
	{
		const { ctx, page } = await contextFor(PLAIN);
		await open(page, '/');
		check(
			'an unverified account still sees Courses in the bar',
			(await page.locator('.site-nav .nav-link--classroom').count()) === 1
		);
		await page.locator('header button[aria-haspopup="menu"]', { hasText: /Add/ }).click();
		await page.waitForTimeout(400);
		const menu = await page.locator('header [role="menu"]').first().innerText();
		check(
			'but is not offered "Start a course" (the creation gate)',
			!/Start a course/.test(menu),
			menu
		);
		check('while "Add a material" stays', /Add a material/.test(menu), menu);
		await ctx.close();
	}
	await setFlag('courses', false);
	await setFlag('material_submissions', false);
	{
		const { ctx, page } = await contextFor(VERIFIED);
		await open(page, '/');
		check(
			'courses off: no Courses link in the bar',
			(await page.locator('.site-nav .nav-link--classroom').count()) === 0
		);
		check(
			'Materials stays (browsing materials has no switch)',
			(await page.locator('.site-nav .nav-link--materials').count()) === 1
		);
		const addTrigger = page.locator('header button[aria-haspopup="menu"]', { hasText: /Add/ });
		if ((await addTrigger.count()) > 0) {
			await addTrigger.click();
			await page.waitForTimeout(400);
			const menu = await page.locator('header [role="menu"]').first().innerText();
			check('no "Start a course" entry', !/Start a course/.test(menu), menu);
			check('no "Add a material" entry', !/Add a material/.test(menu), menu);
			await page.keyboard.press('Escape');
		} else {
			check('no "Start a course" entry (no Add menu at all)', true);
		}
		await page.setViewportSize({ width: 390, height: 844 });
		await page.waitForTimeout(800);
		await page.locator('.drawer-toggle').click();
		await page.locator('.drawer').waitFor({ state: 'visible', timeout: 10000 });
		await page.waitForTimeout(400);
		const text = await page.locator('.drawer').innerText();
		check('nor in the drawer', !text.includes('Courses') && !text.includes('Start a course'), text);
		await open(page, '/materials', { signedIn: false });
		check(
			'and the materials hub drops its link to courses',
			(await page.locator('a.courses-link').count()) === 0
		);
		await ctx.close();
	}
} finally {
	await api(VERIFIED, 'PATCH', '/auth/me/', { content_locales: savedLocales });
	await setFlag('courses', true);
	await setFlag('material_submissions', true);
	// Versions first: deleting the general course would leave them standing alone (SET_NULL).
	for (const id of created.reverse()) {
		const res = await api(VERIFIED, 'DELETE', `/courses/${id}/`);
		if (res.status !== 204) console.log(`  (cleanup: course ${id} → ${res.status})`);
	}
	const left = await api(VERIFIED, 'GET', `/courses/?mine=teaching`);
	check(
		'cleanup: no E2E course of this run is left',
		!left.data.some((c) => String(c.title).includes(String(STAMP)))
	);
	check('zero page/console errors', errors.length === 0, errors.slice(0, 5).join('\n'));
	await browser.close();
	console.log(`\n${pass} passed, ${fail} failed`);
	process.exit(fail ? 1 : 0);
}
