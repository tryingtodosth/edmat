// The course page was one long scroll — content, files, notes, discussion, a notification
// checkbox, the roster — so everything past the first screenful was invisible. This checks the
// tabs, and that they are a real tab list rather than three ARIA attributes on some buttons:
// `role="tablist"` is a promise that arrow keys work.
import { chromium } from 'playwright-core';

const WEB = process.env.E2E_WEB || 'http://127.0.0.1:5173';
const API = process.env.E2E_API || 'http://127.0.0.1:8001/api';
const COURSE_ID = process.env.E2E_COURSE || '2';

let pass = 0;
let fail = 0;
const problems = [];
const check = (name, ok, detail = '') => {
	if (ok) {
		pass++;
		console.log(`  ok   ${name}`);
	} else {
		fail++;
		problems.push(`${name} ${detail}`);
		console.log(`  FAIL ${name} ${detail}`);
	}
};

async function login(username, password) {
	const res = await fetch(`${API}/auth/login/`, {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify({ username, password })
	});
	if (!res.ok) throw new Error(`login ${username}: ${res.status}`);
	return (await res.json()).token;
}

const token = await login('kasia@edmat.example', process.env.E2E_PASSWORD || 'password123');

const browser = await chromium.launch({
	executablePath: process.env.CHROME_PATH || undefined,
	args: ['--no-sandbox']
});

try {
	const ctx = await browser.newContext();
	const page = await ctx.newPage();
	const errors = [];
	page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
	page.on('pageerror', (e) => errors.push(String(e)));

	await page.goto(WEB);
	await page.evaluate((t) => localStorage.setItem('edmat-auth-token', t), token);
	await page.goto(`${WEB}/courses/${COURSE_ID}`, { waitUntil: 'networkidle' });
	await page.waitForTimeout(1500);

	const tablist = page.locator('[role="tablist"]').first();
	check('the course page has a tab list', (await tablist.count()) > 0);

	const tabs = tablist.locator('[role="tab"]');
	const labels = await tabs.allInnerTexts();
	check('an instructor is offered every section', labels.length >= 4, labels.join(' | '));
	check('content is one of them', /Content|Treść/i.test(labels.join(' ')), '');

	// Content is the default and carries no ?tab= at all.
	check('content is selected by default', !page.url().includes('tab='), page.url());
	check(
		'and only the content panel is rendered',
		(await page.locator('.add-chapter').count()) > 0,
		'the add-chapter form belongs to the content tab'
	);

	// Switching must put it in the URL, so a reload keeps your place and the link is sendable.
	const peopleTab = tabs.filter({ hasText: /People|Osoby/i }).first();
	await peopleTab.click();
	await page.waitForTimeout(700);
	check('switching puts the tab in the URL', page.url().includes('tab=people'), page.url());
	check(
		'the content panel is gone',
		(await page.locator('.add-chapter').count()) === 0,
		'content was still rendered on another tab'
	);

	// A reload keeps it — the whole reason the tab lives in the URL.
	await page.reload({ waitUntil: 'networkidle' });
	await page.waitForTimeout(1200);
	check('a reload keeps the tab', page.url().includes('tab=people'), page.url());
	check(
		'and it is still the selected one',
		(await tablist.locator('[role="tab"][aria-selected="true"]').innerText()).match(
			/People|Osoby/i
		) !== null,
		''
	);

	// The back button must step back through tabs, not off the page.
	await page.goBack();
	await page.waitForTimeout(700);
	check('the back button steps between tabs', !page.url().includes('tab=people'), page.url());

	// `role="tablist"` is a promise that arrow keys work.
	await page.locator('[role="tab"][aria-selected="true"]').first().focus();
	await page.keyboard.press('ArrowRight');
	await page.waitForTimeout(700);
	const selectedAfterArrow = await tablist
		.locator('[role="tab"][aria-selected="true"]')
		.innerText();
	check(
		'arrow keys move between tabs',
		!/Content|Treść/i.test(selectedAfterArrow),
		`still ${selectedAfterArrow}`
	);
	check(
		'and focus follows the selection',
		await page.evaluate(() => document.activeElement?.getAttribute('aria-selected') === 'true'),
		'focus was left on the tab that is no longer selected'
	);

	// The two things that deliberately sit outside the tabs.
	check(
		'the manage link is visible whichever tab you are on',
		(await page.locator('.course-actions .manage-link').count()) > 0,
		''
	);
	// The notify checkbox is `{#if isActive}` — a participant's control, stored on their Enrollment
	// row. An instructor has no such row, so they are correctly not offered one here; what this
	// asserts is that when it IS rendered it sits outside the tabs with the manage link, never
	// filed under one of them.
	const muteCount = await page.locator('.mute').count();
	check(
		'the notify checkbox, when shown, is outside the tabs',
		muteCount === (await page.locator('.course-actions .mute').count()),
		`${muteCount} found, none of them in .course-actions`
	);

	// The homepage's own tabs must still work — they now share this component.
	await page.goto(`${WEB}/?tab=events`, { waitUntil: 'networkidle' });
	await page.waitForTimeout(1200);
	const homeTabs = page.locator('[role="tablist"] [role="tab"]');
	check('the homepage still has its tabs', (await homeTabs.count()) >= 4, '');
	check(
		'and honours ?tab= as before',
		(await page.locator('[role="tab"][aria-selected="true"]').innerText()).match(
			/Events|Wydarzenia/i
		) !== null,
		''
	);

	check(
		'no console or page errors',
		errors.filter((e) => !/favicon/i.test(e)).length === 0,
		errors.slice(0, 2).join(' || ')
	);
} finally {
	await browser.close();
}

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) {
	console.log('problems:\n  ' + problems.join('\n  '));
	process.exit(1);
}
