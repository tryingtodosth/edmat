// Reading comfort (AUDIENCE-BRIEF.md §8; root CLAUDE.md §17AT): the header's "Aa" button cycles
// three text sizes for anybody, signed in or not, and remembers the choice across a reload; a
// signed-in click also saves it on the profile; Settings offers text size and high contrast, and
// saving them sets `data-contrast="high"` on the root element and keeps it after a reload; the
// homepage hero speaks to the wider audience, not "university exercises".
//   E2E_BASE=http://localhost:5173 E2E_API=http://localhost:8000 node e2e/reading-comfort.mjs
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
const settle = (p, ms = 700) => p.waitForTimeout(ms);
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
const auth = (t) => ({ 'Content-Type': 'application/json', Authorization: `Token ${t}` });
const ola = await tokenFor('ola@edmat.example');
const reset = () =>
	fetch(`${API}/api/auth/me/`, {
		method: 'PATCH',
		headers: auth(ola),
		body: JSON.stringify({ text_size: 'normal', high_contrast: false })
	});
await reset();
const rootAttr = (p, name) => p.evaluate((n) => document.documentElement.getAttribute(n), name);
const rootFontPx = (p) =>
	p.evaluate(() => parseFloat(getComputedStyle(document.documentElement).fontSize));

// 1. A guest: the "Aa" button is in the header and cycles the size.
const g = await mk();
// A signed-out page may wait for networkidle (no SSE stream); the first page after a Vite
// restart is a cold compile, and a press before hydration has no handler behind it.
await g.goto(`${BASE}/`, { waitUntil: 'networkidle', timeout: 180000 });
await g.locator('.hero h1').waitFor({ timeout: 60000 });
await settle(g, 1200);
const hero = (await g.locator('.hero h1').innerText()).trim();
check(
	'the homepage hero speaks to every age, not "university exercises"',
	/any age/i.test(hero) && !/university exercises/i.test(hero),
	hero
);
const aa = g.locator('header button.text-size');
check('the "Aa" control is in the header for a guest', (await aa.count()) === 1);
const base = await rootFontPx(g);
check('the root starts at the normal size', (await rootAttr(g, 'data-text-size')) === 'normal');
await aa.click();
await settle(g, 300);
check(
	'one press → large, and the root font really grows',
	(await rootAttr(g, 'data-text-size')) === 'large' && (await rootFontPx(g)) > base * 1.1,
	`${base} → ${await rootFontPx(g)}`
);
check(
	'the button says what it is set to',
	/large/i.test((await aa.getAttribute('aria-label')) ?? '')
);
await aa.click();
await settle(g, 300);
check(
	'a second press → larger',
	(await rootAttr(g, 'data-text-size')) === 'larger' && (await rootFontPx(g)) > base * 1.2
);
await g.reload({ waitUntil: 'networkidle', timeout: 120000 });
await g.locator('header button.text-size').waitFor({ timeout: 60000 });
await settle(g, 800);
check(
	'the size survives a reload for a guest (localStorage + app.html restore)',
	(await rootAttr(g, 'data-text-size')) === 'larger'
);
await g.locator('header button.text-size').click();
await settle(g, 300);
check('a third press wraps back to normal', (await rootAttr(g, 'data-text-size')) === 'normal');
await g.locator('main .card, main article, main .tabs, main [role="tablist"]').first().waitFor({
	timeout: 60000
});
await settle(g, 1500);
const small = await g.evaluate(() =>
	[...document.querySelectorAll('main button')]
		.filter((b) => b.offsetParent !== null && b.getBoundingClientRect().height < 44)
		.map(
			(b) =>
				`${b.className} ${Math.round(b.getBoundingClientRect().height)}px "${b.textContent.trim().slice(0, 30)}"`
		)
);
check('every button in main content is at least 44px tall', small.length === 0, small.join(' | '));

// 2. Ola, signed in: the press saves on the profile; Settings has the reading section.
const p = await mk();
await p.goto(`${BASE}/login`, { waitUntil: 'networkidle', timeout: 90000 });
await p.locator('form input[autocomplete="username"]').fill('ola@edmat.example');
await p.locator('form input[type="password"]').fill('password123');
await p.locator('form button[type="submit"]').click();
await p.waitForURL((u) => !u.pathname.includes('/login'), { timeout: 15000 });
await p.goto(`${BASE}/settings`, { waitUntil: 'load' });
await p.locator('form.edit-form').waitFor({ timeout: 120000 });
await settle(p, 1200);
await p.locator('header button.text-size').click();
await settle(p, 1200);
const me1 = await (await fetch(`${API}/api/auth/me/`, { headers: auth(ola) })).json();
check('a signed-in press is saved on the profile', me1.text_size === 'large', me1.text_size);
const reading = p.locator('form.edit-form section.field-group', { hasText: 'Reading comfort' });
check('Settings has a Reading comfort section', (await reading.count()) === 1);
check(
	'…whose text-size select reflects the header press',
	(await reading.locator('select').inputValue()) === 'large'
);
const defaultColor = await p.evaluate(() => getComputedStyle(document.body).color);
await reading.locator('select').selectOption('larger');
await reading.locator('input[type="checkbox"]').check();
await p.locator('form.edit-form button[type="submit"]').first().click();
await settle(p, 1500);
check(
	'saving applies high contrast and the larger size to the root at once',
	(await rootAttr(p, 'data-contrast')) === 'high' &&
		(await rootAttr(p, 'data-text-size')) === 'larger'
);
const me2 = await (await fetch(`${API}/api/auth/me/`, { headers: auth(ola) })).json();
check(
	'both are stored on the profile',
	me2.text_size === 'larger' && me2.high_contrast === true,
	JSON.stringify([me2.text_size, me2.high_contrast])
);
const contrastColor = await p.evaluate(() => getComputedStyle(document.body).color);
await p.reload({ waitUntil: 'load' });
await p.locator('form.edit-form').waitFor({ timeout: 120000 });
await settle(p, 800);
check(
	'both survive a reload',
	(await rootAttr(p, 'data-contrast')) === 'high' &&
		(await rootAttr(p, 'data-text-size')) === 'larger'
);
check(
	'high contrast changes the palette (body text colour differs from the default theme)',
	contrastColor !== defaultColor,
	`${defaultColor} → ${contrastColor}`
);
await p.screenshot({ path: 'e2e/screenshots/reading-comfort.png', fullPage: false });
// Untick and restore.
const reading2 = p.locator('form.edit-form section.field-group', { hasText: 'Reading comfort' });
await reading2.locator('input[type="checkbox"]').uncheck();
await reading2.locator('select').selectOption('normal');
await p.locator('form.edit-form button[type="submit"]').first().click();
await settle(p, 1200);
check(
	'turning it off removes the attribute again',
	(await rootAttr(p, 'data-contrast')) === null &&
		(await rootAttr(p, 'data-text-size')) === 'normal'
);
await reset();
await browser.close();
console.log(`\n${pass} passed, ${fail} failed, ${errors.length} console/page errors`);
for (const e of errors) console.log('  ' + e);
process.exit(fail || errors.length ? 1 : 0);
