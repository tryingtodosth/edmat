// The `age_verification` kill switch: a moderator turning off the age gate on self-registration.
//
// What this has to prove is as much about what does NOT change as what does. The flag takes away
// one question and one refusal; the minors regime (accounts/minors.py) and Settings -> Children are
// deliberately outside its reach, so the run checks those are still standing with the gate off.
//
// The flags tab itself is checked for the drift that has now crashed it twice — a key seeded
// backend-side and missing from FEATURE_FLAG_LABELS used to render `undefined()` and throw. Every
// row must carry a real label, not a raw key.
//
// The register endpoint is throttled ~10/hour per IP (e2e/CLAUDE.md trap 1), and this script spends
// two of those. Restart the backend if a later run starts failing oddly.
//
// Run: CHROME=$(find ~/.cache/ms-playwright -name chrome -path '*chrome-linux*' -type f | head -1) \
//        E2E_BASE=http://localhost:5173 E2E_API=http://localhost:8000 node e2e/age-gate-flag.mjs
let chromium;
try {
	({ chromium } = await import('playwright'));
} catch {
	({ chromium } = await import('playwright-core'));
}
const BASE = process.env.E2E_BASE ?? 'http://localhost:5173';
const SHOTS = process.env.E2E_SHOTS ?? '/tmp';
const STAFF = { user: 'kasia@edmat.example', pass: 'password123' };
const YEAR = new Date().getFullYear();

let pass = 0,
	fail = 0;
const check = (l, ok, x = '') => {
	// `ok ? pass++ : fail++` is the idiom in the older scripts here; written out because eslint
	// (rightly) refuses an expression statement, and the existing ones each carry that error.
	if (ok) pass++;
	else fail++;
	console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${l}${ok ? '' : '  <- ' + x}`);
};

const browser = await chromium.launch(
	process.env.CHROME ? { executablePath: process.env.CHROME } : {}
);

// A fresh context per visitor: the gate is a thing an ANONYMOUS visitor meets, and trap 10 in
// e2e/CLAUDE.md is that a staff-bypassed check proves nothing about a flag. (This flag is read
// straight out of the serializer rather than through `feature_gate`, so it has no staff bypass at
// all — but the registration surface still deserves to be driven as a stranger.)
const anonCtx = () => browser.newContext({ viewport: { width: 1280, height: 1000 } });
const settle = (p, ms = 1000) => p.waitForTimeout(ms);

// Scoped by the label's own text, never by position — trap 6.
const field = (p, re) => p.locator('form label.field').filter({ hasText: re }).locator('input');
const fieldLabels = (p) => p.locator('form label.field span').allTextContents();
const BIRTH = /Year of birth|Rok urodzenia/;
const HINT = /old enough|samodzielnie założyć/;

async function openRegister(p) {
	await p.goto(`${BASE}/register`, { waitUntil: 'load' });
	await p.locator('form button.submit').waitFor({ timeout: 20000 });
	// The flags fetch is a separate request from the page load and `isEnabled` fails OPEN until it
	// lands, so a check made too early would see the gate up no matter what the flag says.
	await settle(p, 1800);
}

console.log('\n1. the gate as it ships — on');
const a = await anonCtx();
const p1 = await a.newPage();
const err1 = [];
p1.on('pageerror', (e) => err1.push(e.message));
await openRegister(p1);
let labels = await fieldLabels(p1);
check(
	'/register asks for a year of birth',
	labels.some((t) => BIRTH.test(t)),
	labels.join(' | ')
);
check(
	'and says why it is asking',
	labels.some((t) => HINT.test(t)),
	labels.join(' | ')
);
await p1.screenshot({ path: `${SHOTS}/agegate-1-on.png`, fullPage: true });

const s1 = Date.now();
await field(p1, /Display name|Nazwa/).fill(`Gate Kid ${s1}`);
await field(p1, /E-?mail/i).fill(`gatekid${s1}@example.org`);
await field(p1, BIRTH).fill(String(YEAR - 12));
await field(p1, /Password|Hasło/).fill('a-strong-passw0rd!');
await p1.locator('form button.submit').click();
await p1
	.locator('p.error.guardian')
	.waitFor({ timeout: 15000 })
	.catch(() => null);
const refusal = await p1.locator('p.error.guardian').count();
check(
	'an under-16 is refused, and told to ask a guardian rather than just "no"',
	refusal > 0,
	refusal ? '' : 'no p.error.guardian'
);
check(
	'and is still on /register, so no account was made',
	p1.url().includes('/register'),
	p1.url()
);
await p1.screenshot({ path: `${SHOTS}/agegate-2-refused.png`, fullPage: true });

console.log('\n2. a moderator turns it off on /moderation -> Flags');
const mod = await browser.newContext({ viewport: { width: 1280, height: 1000 } });
const pm = await mod.newPage();
const errMod = [];
pm.on('pageerror', (e) => errMod.push(e.message));
await pm.goto(`${BASE}/login`, { waitUntil: 'load' });
await settle(pm, 900);
await pm.locator('form input[autocomplete="username"]').fill(STAFF.user);
await pm.locator('form input[type="password"]').fill(STAFF.pass);
await pm.locator('form button[type="submit"]').click();
await pm.waitForURL((u) => !u.pathname.includes('/login'), { timeout: 20000 });
check('signed in as a moderator', !pm.url().includes('/login'), pm.url());

// 'load', never 'networkidle': the notification SSE stream never goes idle (trap 2).
await pm.goto(`${BASE}/moderation`, { waitUntil: 'load' });
await pm.locator('#mod-tab-flags').waitFor({ timeout: 20000 });
const errBefore = errMod.length;
await pm.locator('#mod-tab-flags').click();
await pm.locator('.flag-row').first().waitFor({ timeout: 15000 });
await settle(pm, 900);
const names = await pm.locator('.flag-row .flag-name').allTextContents();
check(
	'the Flags tab opens without throwing',
	errMod.length === errBefore,
	errMod.slice(errBefore).join(' / ')
);
check(
	'every row carries a real label, not a raw key',
	names.length > 0 && !names.some((t) => /^[a-z][a-z_]*$/.test(t.trim())),
	`${names.length} rows: ${names.join(' | ')}`
);
check(
	'including galleries, the key that crashed this tab',
	names.some((t) => /Picture galleries|Galerie/.test(t)),
	names.join(' | ')
);
check(
	'and the new age gate',
	names.some((t) => /Age gate|wiek/.test(t)),
	names.join(' | ')
);
await pm.screenshot({ path: `${SHOTS}/agegate-3-flags.png`, fullPage: true });

const ageRow = pm.locator('.flag-row').filter({ hasText: /Age gate|wiek/ });
check('it ships ON', /On|Włącz/i.test(await ageRow.locator('.flag-status').innerText()));
await ageRow.locator('button').click();
await settle(pm, 2000);
check(
	'and a moderator can turn it off',
	/Off|Wyłącz/i.test(await ageRow.locator('.flag-status').innerText()),
	await ageRow.locator('.flag-status').innerText()
);
await pm.screenshot({ path: `${SHOTS}/agegate-4-off.png`, fullPage: true });

console.log('\n3. the gate off — for a stranger, in a fresh session');
const b = await anonCtx();
const p2 = await b.newPage();
const err2 = [];
p2.on('pageerror', (e) => err2.push(e.message));
await openRegister(p2);
labels = await fieldLabels(p2);
check('the year-of-birth field is gone', !labels.some((t) => BIRTH.test(t)), labels.join(' | '));
check('and its hint went with it', !labels.some((t) => HINT.test(t)), labels.join(' | '));
await p2.screenshot({ path: `${SHOTS}/agegate-5-off-register.png`, fullPage: true });

const s2 = Date.now();
await field(p2, /Display name|Nazwa/).fill(`Gate Kid ${s2}`);
await field(p2, /E-?mail/i).fill(`gatekid${s2}@example.org`);
await field(p2, /Password|Hasło/).fill('a-strong-passw0rd!');
await p2.locator('form button.submit').click();
await p2.waitForURL((u) => !u.pathname.includes('/register'), { timeout: 20000 }).catch(() => null);
check(
	'someone who would have been refused a moment ago registers fine',
	!p2.url().includes('/register'),
	p2.url()
);
check('with no page errors along the way', err2.length === 0, err2.join(' / '));
await p2.screenshot({ path: `${SHOTS}/agegate-6-registered.png`, fullPage: true });

console.log('\n4. what the flag must NOT have taken with it');
await pm.goto(`${BASE}/settings`, { waitUntil: 'load' });
await pm
	.locator('section.guardian')
	.waitFor({ timeout: 20000 })
	.catch(() => null);
check(
	'Settings still offers Children: a guardian can still make a minor an account',
	(await pm.locator('section.guardian').count()) > 0
);
check('and the panel still explains itself', (await pm.locator('section.guardian h2').count()) > 0);
await pm.screenshot({ path: `${SHOTS}/agegate-7-children.png`, fullPage: true });

console.log('\n5. putting it back');
await pm.goto(`${BASE}/moderation`, { waitUntil: 'load' });
await pm.locator('#mod-tab-flags').waitFor({ timeout: 20000 });
await pm.locator('#mod-tab-flags').click();
await pm.locator('.flag-row').first().waitFor({ timeout: 15000 });
const ageRow2 = pm.locator('.flag-row').filter({ hasText: /Age gate|wiek/ });
await ageRow2.locator('button').click();
await settle(pm, 2000);
check(
	'turning it back on sticks',
	/On|Włącz/i.test(await ageRow2.locator('.flag-status').innerText())
);

const c = await anonCtx();
const p3 = await c.newPage();
await openRegister(p3);
labels = await fieldLabels(p3);
check(
	'and the question is back on /register',
	labels.some((t) => BIRTH.test(t)),
	labels.join(' | ')
);

await browser.close();
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
