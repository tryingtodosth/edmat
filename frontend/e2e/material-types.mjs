// Material types are a vocabulary now, not thirteen values somebody guessed from a seven-material
// corpus. This drives the real form: propose a kind, see it grouped under "Others", have the badge
// on a card name it rather than throwing.
import { chromium } from 'playwright-core';

const WEB = process.env.E2E_WEB || 'http://127.0.0.1:5173';
const API = process.env.E2E_API || 'http://127.0.0.1:8001/api';

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

async function api(path, { token, method = 'GET', body } = {}) {
	const res = await fetch(API + path, {
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

async function login(username) {
	const { status, data } = await api('/auth/login/', {
		method: 'POST',
		body: { username, password: 'verify-pw-123' }
	});
	if (status !== 200) throw new Error(`login ${username}: ${status}`);
	return data.token;
}

const student = await login('zzz-type-student@example.test');

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
	await page.evaluate((t) => localStorage.setItem('edmat-auth-token', t), student);
	await page.goto(`${WEB}/submit-material`, { waitUntil: 'networkidle' });
	await page.waitForTimeout(1500);

	// By id, never by position (trap 6): the form grew a discipline -> branch cascade, so the type
	// picker is no longer the second select on it, and `.nth(1)` quietly checked the branch list.
	const typeSelect = page.locator('form.submit-form select#submit-material-type');
	check('the type picker is on the page', (await typeSelect.count()) > 0);

	const options = await typeSelect.locator('option').allInnerTexts();
	check(
		'the built-in kinds are still named properly',
		options.some((o) => /Skrypt|Course script/i.test(o)),
		options.slice(0, 4).join(' | ')
	);
	check('all thirteen built-ins are offered', options.length >= 13, `${options.length} options`);

	// The pending one seeded by the harness must be grouped, not mixed in.
	const optgroupLabel = await typeSelect.locator('optgroup').first().getAttribute('label');
	check(
		'a proposed kind sits under an Others optgroup',
		/others|inne/i.test(optgroupLabel || ''),
		`label=${optgroupLabel}`
	);
	const grouped = await typeSelect.locator('optgroup option').allInnerTexts();
	check(
		'and it is the proposed one that is in there',
		grouped.some((o) => /Zzz Lab Notebook/i.test(o)),
		grouped.join(' | ')
	);

	// The names must follow the READER's language, not the backend's default — the picker showing
	// Polish under an English interface is exactly the bug this branch exists to fix, and it was
	// reintroduced here by a fetch that forgot `?lang=`.
	check(
		'the picker is in the interface language',
		options.some((o) => /Course script/i.test(o)) && !options.some((o) => /^Skrypt$/i.test(o)),
		options.slice(0, 4).join(' | ')
	);

	// Naming a kind this database has never heard of. It used to be a separate "Not in the list?
	// Suggest one" button opening its own little form; the type picker now offers "Other…" inline,
	// the same mechanism the discipline and branch pickers on this form use — one way per field
	// rather than two competing ones. (The script asked for the old button long after it was gone.)
	const otherOption = typeSelect.locator('option[value="__other__"]');
	check(
		'the picker offers "Other…" for a kind it does not know',
		(await otherOption.count()) === 1
	);
	await typeSelect.selectOption('__other__');
	await page.waitForTimeout(400);
	const customName = page.locator('form.submit-form input.other-name');
	check(
		'and choosing it asks for the new kind by name',
		(await customName.count()) === 1,
		(await page.locator('form.submit-form').innerText()).slice(0, 160)
	);

	// A card badge must name a proposed type rather than throwing or saying "Other".
	await page.goto(`${WEB}/materials`, { waitUntil: 'networkidle' });
	await page.waitForTimeout(1200);
	const body = await page.locator('body').innerText();
	check('the materials page rendered', body.length > 200);
	check(
		'no message-key or undefined leaked into a type badge',
		!/undefined|materialType_/.test(body),
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
