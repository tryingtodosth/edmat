// The rich editor (AUDIENCE-BRIEF.md §7; root CLAUDE.md §17AS): Ola switches the comment box to
// Editor mode, the toolbar appears, she types, bolds a word and inserts a fraction from the maths
// palette, posts — the stored body is HTML with <strong> and the fraction renders as KaTeX; the
// mode is remembered on her profile; switching back to Source shows the HTML; a reader never
// downloads Tiptap (no tiptap chunk requested on a page with no editor open).
//   E2E_BASE=http://localhost:5173 E2E_API=http://localhost:8000 node e2e/rich-editor.mjs
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
const p = await (await browser.newContext({ viewport: { width: 1280, height: 1000 } })).newPage();
const requested = [];
p.on('request', (r) => requested.push(r.url()));
p.on('console', (m) => {
	if (m.type() === 'error') errors.push(`[${p.url()}] ${m.text()}`);
});
p.on('pageerror', (e) => errors.push(e.message));
const settle = (ms = 900) => p.waitForTimeout(ms);
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
const MARKER = 'Editor e2e';
await fetch(`${API}/api/auth/me/`, {
	method: 'PATCH',
	headers: auth(ola),
	body: JSON.stringify({ editor_mode: 'source' })
});
for (const c of await (
	await fetch(`${API}/api/exercises/2/comments/?fresh=${Date.now()}`)
).json()) {
	if (c.body.includes(MARKER) && !c.is_removed)
		await fetch(`${API}/api/comments/${c.id}/`, { method: 'DELETE', headers: auth(ola) });
}
await p.goto(`${BASE}/login`, { waitUntil: 'networkidle', timeout: 90000 });
await settle(800);
await p.locator('form input[autocomplete="username"]').fill('ola@edmat.example');
await p.locator('form input[type="password"]').fill('password123');
await p.locator('form button[type="submit"]').click();
await p.waitForURL((u) => !u.pathname.includes('/login'), { timeout: 15000 });
await p.goto(`${BASE}/exercises/2`, { waitUntil: 'load' });
const form = p.locator('.discussion form.comment-form').first();
await form.locator('.rich-editor').waitFor({ timeout: 90000 });
check(
	'the comment box opens in Source mode for an account that never chose',
	(await form.locator('.rich-editor textarea').count()) === 1
);
check(
	'Tiptap was not downloaded while nobody opened the editor',
	!requested.some((u) => /tiptap|prosemirror/i.test(u)),
	requested
		.filter((u) => /tiptap/i.test(u))
		.slice(0, 2)
		.join(' ')
);
await form.locator('.rich-editor__modes button', { hasText: 'Editor' }).click();
await form.locator('.rich-editor__host .ProseMirror').waitFor({ timeout: 60000 });
check(
	'Editor mode mounts Tiptap and shows the formatting toolbar',
	(await form.locator('.rich-editor__fmt').count()) === 1
);
check(
	'…and only now was Tiptap fetched',
	requested.some((u) => /tiptap|prosemirror/i.test(u))
);
const pm = form.locator('.ProseMirror');
await pm.click();
await p.keyboard.type(`${MARKER} the area is `);
await form.locator('.rich-editor__fmt button[aria-label="Bold"]').click();
await p.keyboard.type('half');
await form.locator('.rich-editor__fmt button[aria-label="Bold"]').click();
await p.keyboard.type(' of ');
await form.locator('.rich-editor__math button', { hasText: 'a/b' }).click();
await settle(300);
check(
	'the document carries the bold word and the fraction source',
	/<strong>half<\/strong>/.test(await pm.innerHTML()) &&
		/\\frac\{a\}\{b\}/.test(await pm.innerText())
);
await form.locator('button[type="submit"]').click();
const posted = p.locator('.discussion .comment', { hasText: MARKER }).first();
await posted.waitFor({ timeout: 20000 });
await settle(1500);
const thread = await (await fetch(`${API}/api/exercises/2/comments/?fresh=${Date.now()}`)).json();
const row = thread.find((c) => c.body.includes(MARKER));
check(
	'the stored body is HTML with <strong> and the KaTeX delimiters intact',
	!!row && /<strong>half<\/strong>/.test(row.body) && row.body.includes('\\(\\frac{a}{b}\\)'),
	row?.body?.slice(0, 160)
);
const me = await (await fetch(`${API}/api/auth/me/`, { headers: auth(ola) })).json();
check('the mode is remembered on the profile', me.editor_mode === 'rich');
await p.reload({ waitUntil: 'load' });
const form2 = p.locator('.discussion form.comment-form').first();
await form2.locator('.rich-editor__host .ProseMirror').waitFor({ timeout: 90000 });
check('after a reload the box opens in Editor mode', true);
await form2.locator('.rich-editor__modes button', { hasText: 'Source' }).click();
await form2.locator('.rich-editor textarea').waitFor({ timeout: 10000 });
check(
	'Source mode is one click back, and remembered',
	(await (await fetch(`${API}/api/auth/me/`, { headers: auth(ola) })).json()).editor_mode ===
		'source'
);
// The maths palette works in source mode too.
await form2.locator('.rich-editor textarea').fill('x = ');
await form2.locator('.rich-editor__math button', { hasText: '√' }).click();
check(
	'the palette inserts KaTeX into the source box',
	/\\sqrt\{x\}/.test(await form2.locator('.rich-editor textarea').inputValue())
);
for (const c of await (
	await fetch(`${API}/api/exercises/2/comments/?fresh=${Date.now()}`)
).json()) {
	if (c.body.includes(MARKER) && !c.is_removed)
		await fetch(`${API}/api/comments/${c.id}/`, { method: 'DELETE', headers: auth(ola) });
}
check('zero console/page errors', errors.length === 0, errors.join(' | ').slice(0, 500));
await p.screenshot({ path: 'e2e/screenshots/rich-editor.png' });
await browser.close();
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
