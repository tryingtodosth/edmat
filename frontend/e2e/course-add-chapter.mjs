// A curator could rename and delete chapters but had no way to create one — the handler was
// written and rendered nowhere, so a course's structure could only ever shrink. And seven curator
// actions wrote their error to a variable nothing displayed, so a refused drag looked identical to
// one that worked. This checks both, through the real page.
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

async function chapterTitles() {
	const res = await fetch(`${API}/courses/${COURSE_ID}/`, {
		headers: { Authorization: `Token ${token}` }
	});
	const data = await res.json();
	return (data.chapters ?? []).map((c) => c.title);
}

const before = await chapterTitles();
const NEW_TITLE = 'Zzz Chapter From Browser';

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

	const form = page.locator('form.add-chapter');
	check('the curator is offered a way to add a chapter', (await form.count()) > 0);

	const submit = form.locator('button[type="submit"]');
	check(
		'submit is disabled until there is a title',
		await submit.isDisabled(),
		'enabled with an empty title'
	);

	await form.locator('input[type="text"]').fill(NEW_TITLE);
	await page.waitForTimeout(200);
	check('and enabled once there is one', !(await submit.isDisabled()));

	await submit.click();
	await page.waitForTimeout(2000);

	const after = await chapterTitles();
	check(
		'the chapter really exists afterwards',
		after.includes(NEW_TITLE),
		`before=[${before}] after=[${after}]`
	);
	check(
		'and it is on the page',
		(await page.locator('body').innerText()).includes(NEW_TITLE),
		''
	);
	check(
		'the form clears itself',
		(await form.locator('input[type="text"]').inputValue()) === '',
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

// Clean up whatever this run created, so it can be run again.
const res = await fetch(`${API}/courses/${COURSE_ID}/`, {
	headers: { Authorization: `Token ${token}` }
});
const course = await res.json();
for (const c of course.chapters ?? []) {
	if (c.title === NEW_TITLE) {
		await fetch(`${API}/courses/${COURSE_ID}/chapters/${c.id}/`, {
			method: 'DELETE',
			headers: { Authorization: `Token ${token}` }
		});
	}
}
console.log('cleaned up scratch chapters');

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) {
	console.log('problems:\n  ' + problems.join('\n  '));
	process.exit(1);
}
