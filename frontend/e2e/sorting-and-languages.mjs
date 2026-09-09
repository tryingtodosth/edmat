// Sorting and the content-language rule (AUDIENCE-BRIEF.md §4–5; root CLAUDE.md §17AQ): a fresh
// browser reads the English interface, so the Polish corpus is hidden behind an honest count with
// "Show them"; the branch page sorts by title and flips, with the choice in the URL; an exercise
// page in another language than the interface says so and offers to show that language; Ola's
// Settings save an extra language on her profile; a listing carries a language.
//   E2E_BASE=http://localhost:5173 E2E_API=http://localhost:8000 node e2e/sorting-and-languages.mjs
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
const browser = await chromium.launch(
	process.env.CHROME ? { executablePath: process.env.CHROME } : {}
);
const mk = async () => {
	const p = await (
		await browser.newContext({ viewport: { width: 1280, height: 1000 }, locale: 'en-US' })
	).newPage();
	p.on('console', (m) => {
		if (m.type() === 'error') errors.push(`[${p.url()}] ${m.text()}`);
	});
	p.on('pageerror', (e) => errors.push(e.message));
	return p;
};
const settle = (p, ms = 900) => p.waitForTimeout(ms);
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
const ola = await tokenFor('ola@edmat.example');
const auth = (t) => ({ 'Content-Type': 'application/json', Authorization: `Token ${t}` });
await fetch(`${API}/api/auth/me/`, {
	method: 'PATCH',
	headers: auth(ola),
	body: JSON.stringify({ content_locales: [] })
});

// API: the header and the sort keys.
const en = await fetch(`${API}/api/exercises/?content_locales=en`);
const hiddenEn = Number(en.headers.get('X-EdMat-Hidden-Languages'));
const total = (await (await fetch(`${API}/api/exercises/?fresh=${Date.now()}`)).json()).length;
check(
	'the API hides the Polish corpus from an English-only reader and says how many',
	hiddenEn > 0 && (await en.json()).length + hiddenEn === total,
	`${hiddenEn} of ${total}`
);
const byTitle = await (
	await fetch(`${API}/api/branches/analiza-matematyczna/exercises/?sort=title&lang=pl`)
).json();
const titles = byTitle.map((e) => e.title.toLowerCase());
check(
	'sort=title orders A→Z',
	titles.length > 2 && titles.slice(0, 5).every((t, i, a) => i === 0 || a[i - 1] <= t),
	titles.slice(0, 4).join(' | ')
);
const desc = await (
	await fetch(`${API}/api/branches/analiza-matematyczna/exercises/?sort=title&dir=desc&lang=pl`)
).json();
check('dir=desc flips it', desc[0].id === byTitle[byTitle.length - 1].id);

// 1. A fresh English-interface visitor: the homepage tells the truth.
const g = await mk();
await g.goto(`${BASE}/`, { waitUntil: 'networkidle', timeout: 180000 });
await settle(g, 1500);
const notice = g.locator('.hidden-notice');
await notice.waitFor({ timeout: 60000 });
const cardsBefore = await g.locator('.exercise-card').count();
check(
	'the homepage shows how many items are hidden by language',
	/hidden/.test(await notice.innerText()) &&
		Number((await notice.innerText()).match(/\d+/)?.[0]) > 100,
	await notice.innerText()
);
await notice.locator('button').click();
await g.locator('.exercise-card').first().waitFor({ timeout: 30000 });
check(
	'"Show them" reveals more exercises and the notice goes',
	(await g.locator('.exercise-card').count()) > cardsBefore &&
		(await g.locator('.hidden-notice').count()) === 0
);
await g.reload({ waitUntil: 'load' });
await g.locator('.exercise-card').first().waitFor({ timeout: 60000 });
check(
	'the choice survives a reload (localStorage)',
	(await g.locator('.hidden-notice').count()) === 0
);

// 2. The branch page: sort control, URL, order.
await g.goto(`${BASE}/branches/analiza-matematyczna`, { waitUntil: 'load' });
const sortSel = g.locator('.sort select');
await sortSel.waitFor({ timeout: 60000 });
await g.locator('.exercise-card').first().waitFor({ timeout: 60000 });
await sortSel.selectOption('title');
await settle(g, 2500);
check('choosing a sort puts it in the URL', g.url().includes('sort=title'), g.url());
const firstTitle = (
	await g.locator('.exercise-card h3, .exercise-card h2').first().innerText()
).trim();
check(
	'the first card is the alphabetically first title',
	firstTitle.toLowerCase() === byTitle[0].title.toLowerCase(),
	`${firstTitle} vs ${byTitle[0].title}`
);
await g.locator('.sort button').click();
await settle(g, 2500);
check('the flip button adds dir=asc/desc to the URL', /dir=(asc|desc)/.test(g.url()), g.url());
await g.goto(`${BASE}/branches/analiza-matematyczna?sort=title&dir=desc`, { waitUntil: 'load' });
await g.locator('.exercise-card').first().waitFor({ timeout: 60000 });
const lastFirst = (
	await g.locator('.exercise-card h3, .exercise-card h2').first().innerText()
).trim();
check(
	'a shared URL with sort+dir renders that order',
	lastFirst.toLowerCase() === desc[0].title.toLowerCase(),
	`${lastFirst} vs ${desc[0].title}`
);

// 3. A detail page in another language than the interface.
const g2 = await mk();
await g2.goto(`${BASE}/exercises/1`, { waitUntil: 'load' });
const banner = g2.locator('.other-language');
await banner.waitFor({ timeout: 60000 });
check(
	'a Polish exercise under the English interface says so',
	/PL/.test(await banner.innerText()) && /EN/.test(await banner.innerText()),
	await banner.innerText()
);
await banner.locator('button').click();
await settle(g2, 800);
check(
	"…and one click adds Polish to the reader's languages",
	(await g2.locator('.other-language').count()) === 0
);

// 4. Ola's Settings save an extra language on the profile; a listing carries a language.
const o = await mk();
await o.goto(`${BASE}/login`, { waitUntil: 'networkidle', timeout: 90000 });
await settle(o, 800);
await o.locator('form input[autocomplete="username"]').fill('ola@edmat.example');
await o.locator('form input[type="password"]').fill('password123');
await o.locator('form button[type="submit"]').click();
await o.waitForURL((u) => !u.pathname.includes('/login'), { timeout: 15000 });
await o.goto(`${BASE}/settings`, { waitUntil: 'load' });
const langSection = o.locator('section.field-group', { hasText: 'Content languages' });
await langSection.waitFor({ timeout: 60000 });
await langSection.locator('.checkbox-row', { hasText: 'Polski' }).locator('input').check();
// The settings page holds several forms — press the Save that belongs to THIS section's form.
await langSection
	.locator('xpath=ancestor::form[1]')
	.locator('button[type="submit"]')
	.first()
	.click();
await settle(o, 2000);
const me = await (await fetch(`${API}/api/auth/me/`, { headers: auth(ola) })).json();
check(
	'Settings saves the extra language on the profile',
	JSON.stringify(me.content_locales) === '["pl"]',
	JSON.stringify(me.content_locales)
);
await o.goto(`${BASE}/services/new`, { waitUntil: 'load' });
const langField = o
	.locator('form select')
	.filter({ has: o.locator('option[value="pl"]') })
	.first();
await langField.waitFor({ timeout: 60000 });
check(
	'the listing form asks for the language, defaulting to the interface one',
	(await langField.inputValue()) === 'en'
);

await fetch(`${API}/api/auth/me/`, {
	method: 'PATCH',
	headers: auth(ola),
	body: JSON.stringify({ content_locales: [] })
});
check('zero console/page errors', errors.length === 0, errors.join(' | ').slice(0, 500));
await g.screenshot({ path: 'e2e/screenshots/sorting-and-languages.png' });
await browser.close();
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
