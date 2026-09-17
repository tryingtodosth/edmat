// The six ways into a comment (root CLAUDE.md §17AV): Markdown file / LaTeX / JSON / Ketcher /
// PDF / Picture on one strip under the comment box. Ola, signed in by token, inserts a LaTeX
// block, a JSON block and a Markdown file into the source box; draws a REACTION in a REAL Ketcher
// (Indigo WASM in the browser), saved through /api/chem-drawings/ and embedded as <img data-chem>;
// posts the comment and the SVG genuinely loads; clicking the drawing in rich mode reopens it for
// editing; the `chemistry` kill switch removes the button and closes the API for a non-staff
// account. Cleans its comments up.
//   E2E_BASE=http://localhost:5183 E2E_API=http://127.0.0.1:8011 node e2e/comment-input-kinds.mjs
let chromium;
try {
	({ chromium } = await import('playwright'));
} catch {
	({ chromium } = await import('playwright-core'));
}
const BASE = process.env.E2E_BASE ?? 'http://localhost:5183';
const API = process.env.E2E_API ?? 'http://127.0.0.1:8011';
let pass = 0,
	fail = 0;
const errors = [];
const check = (l, ok, x = '') => {
	if (ok) pass++;
	else fail++;
	console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${l} ${ok ? '' : x}`);
};
const MARKER = 'Input kinds e2e';
const tokenFor = async (email) => {
	const r = await fetch(`${API}/api/auth/login/`, {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify({ username: email, password: 'password123' })
	});
	const j = await r.json();
	if (!j.token)
		throw new Error(
			`login failed for ${email}: ${JSON.stringify(j)} (login throttle? restart the backend)`
		);
	return j.token;
};
const ola = await tokenFor('ola@edmat.example');
const kasia = await tokenFor('kasia@edmat.example');
const auth = (t) => ({ 'Content-Type': 'application/json', Authorization: `Token ${t}` });
const setFlag = (on) =>
	fetch(`${API}/api/feature-flags/chemistry/`, {
		method: 'PATCH',
		headers: auth(kasia),
		body: JSON.stringify({ is_enabled: on })
	});
async function cleanup() {
	for (const c of await (
		await fetch(`${API}/api/exercises/2/comments/?fresh=${Date.now()}`, { headers: auth(ola) })
	).json()) {
		if (c.body.includes(MARKER) && !c.is_removed)
			await fetch(`${API}/api/comments/${c.id}/`, { method: 'DELETE', headers: auth(ola) });
	}
}
await setFlag(true);
await cleanup();
await fetch(`${API}/api/auth/me/`, {
	method: 'PATCH',
	headers: auth(ola),
	body: JSON.stringify({ editor_mode: 'source' })
});

const browser = await chromium.launch(
	process.env.CHROME ? { executablePath: process.env.CHROME } : {}
);
const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
await ctx.addInitScript((t) => localStorage.setItem('edmat-auth-token', t), ola);
const p = await ctx.newPage();
const requested = [];
p.on('request', (r) => requested.push(r.url()));
p.on('console', (msg) => {
	if (msg.type() === 'error') errors.push(msg.text());
});
p.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
const failedUrls = [];
p.on('response', (r) => {
	if (r.status() >= 400) failedUrls.push(`${r.status()} ${r.url()}`);
});
const settle = (ms = 700) => p.waitForTimeout(ms);
// The library files themselves (Vite serves deps from node_modules or its .vite/deps cache; the
// production build names its chunks by hash, so there the check is the KetcherHost module).
const LIB = /(node_modules|\.vite\/deps)\/(ketcher|react)|KetcherHost/i;

await p.goto(`${BASE}/exercises/2`, { waitUntil: 'load' });
const form = p.locator('.discussion form.comment-form').first();
await form.locator('.rich-editor textarea').waitFor({ timeout: 90000 });
const strip = form.locator('.insert-strip');
const stripRow = strip.locator('.insert-strip__row');
const labels = (await stripRow.locator('button, label').allInnerTexts()).map((s) => s.trim());
check(
	'the strip offers all six kinds',
	['Markdown file', 'LaTeX', 'JSON', 'Ketcher', 'PDF', 'Picture'].every((k) => labels.includes(k)),
	labels.join('|')
);
check(
	'no chemistry library was downloaded while nobody opened an editor',
	!requested.some((u) => LIB.test(u)),
	requested
		.filter((u) => LIB.test(u))
		.slice(0, 3)
		.join(' ')
);

// ---- LaTeX
const ta = form.locator('.rich-editor textarea');
await ta.fill(`${MARKER}: `);
await stripRow.locator('button', { hasText: /^LaTeX$/ }).click();
await strip.locator('.insert-strip__panel textarea').fill('\\frac{1}{2}');
await settle(900);
check(
	'the LaTeX panel previews the equation with KaTeX',
	(await strip.locator('.insert-strip__preview .katex').count()) > 0
);
await strip.locator('.insert-strip__actions .primary').click();
check(
	'Insert puts a displayed equation into the source',
	(await ta.inputValue()).includes('\\[\\frac{1}{2}\\]'),
	await ta.inputValue()
);

// ---- JSON
await stripRow.locator('button', { hasText: /^JSON$/ }).click();
await strip.locator('.insert-strip__panel textarea').fill('{"a": [1, 2');
await strip.locator('.insert-strip__actions .primary').click();
check(
	'invalid JSON is refused in words',
	(await strip.locator('.insert-strip__error').count()) === 1
);
await strip.locator('.insert-strip__panel textarea').fill('{"a":[1,2],"b":true}');
await strip.locator('.insert-strip__actions .primary').click();
const afterJson = await ta.inputValue();
check(
	'valid JSON lands pretty-printed in a fenced json block',
	afterJson.includes('```json') && afterJson.includes('"a": [\n    1,'),
	afterJson.slice(-120)
);

// ---- Markdown file
await stripRow
	.locator('label', { hasText: 'Markdown file' })
	.locator('input[type=file]')
	.setInputFiles({
		name: 'notes.md',
		mimeType: 'text/markdown',
		buffer: Buffer.from('\n**from a file**\n')
	});
await settle(400);
check('a Markdown file is read into the body', (await ta.inputValue()).includes('**from a file**'));

// ---- Ketcher
await stripRow.locator('button', { hasText: /^Ketcher$/ }).click();
const modal = p.locator('.modal-panel');
await modal.waitFor({ timeout: 20000 });
check('the Ketcher dialog opens', (await modal.locator('h2').innerText()).includes('Ketcher'));
await p.waitForFunction(() => !!window.ketcher, null, { timeout: 180000 });
await p.waitForFunction(
	() => !!document.querySelector('.modal-panel button.submit:not([disabled])'),
	null,
	{ timeout: 180000 }
);
check(
	'…and only now was Ketcher fetched',
	requested.some((u) => /ketcher/i.test(u))
);
// A REACTION, not a lone molecule: reaction SMILES straight into the editor, then the dialog's own
// one-click arrow on top of it (the "reactions must be easy to add" ask).
await p.evaluate(() => window.ketcher.setMolecule('CCO>>C=C'));
await settle(1200);
check(
	'Ketcher holds a reaction after reading reaction SMILES',
	await p.evaluate(() => window.ketcher.containsReaction())
);
await modal.locator('.chem-editor__tools .arrow').click();
await settle(1200);
const arrowCount = await p.evaluate(
	async () =>
		JSON.parse(await window.ketcher.getKet()).root.nodes.filter((n) => n.type === 'arrow').length
);
check('"Add reaction arrow" appends a real KET arrow node', arrowCount === 2, String(arrowCount));
const captionBefore = await modal.locator('.chem-editor__caption input').inputValue();
await modal.locator('button.submit').click();
await modal.waitFor({ state: 'detached', timeout: 60000 });
const afterKetcher = await ta.inputValue();
const ketcherId = /data-chem="(\d+)"/.exec(afterKetcher)?.[1];
check(
	'the Ketcher drawing is inserted as an <img data-chem> pointing at site media',
	!!ketcherId && /src="[^"]*\/media\/chem\/[a-f0-9]+\.svg"/.test(afterKetcher),
	afterKetcher.slice(-200)
);
const kd = ketcherId ? await (await fetch(`${API}/api/chem-drawings/${ketcherId}/`)).json() : null;
check(
	'the API holds it as KET source with a sanitized vector picture and a reaction-SMILES caption',
	!!kd &&
		kd.source_format === 'ket' &&
		kd.image_kind === 'svg' &&
		kd.label.includes('>>') &&
		kd.source.includes('"arrow"'),
	JSON.stringify({
		tool: kd?.tool,
		fmt: kd?.source_format,
		kind: kd?.image_kind,
		label: kd?.label,
		captionBefore
	})
);

// ---- post it
await form.locator('button[type="submit"]').click();
const posted = p.locator('.discussion .comment', { hasText: MARKER }).first();
await posted.waitFor({ timeout: 30000 });
await settle(2500);
const imgs = posted.locator('.comment__body img.chem-drawing');
check(
	'the posted comment shows the drawing',
	(await imgs.count()) === 1,
	`count=${await imgs.count()} body=${(await posted.locator('.comment__body').innerHTML()).slice(0, 400)}`
);
const loaded = await imgs.evaluateAll((els) =>
	els.map((e) => [e.complete && e.naturalWidth > 0, e.getAttribute('data-chem'), e.alt])
);
check(
	'the picture genuinely loads (an SVG, not a broken image)',
	loaded.length > 0 && loaded.every(([ok]) => ok),
	JSON.stringify(loaded)
);
check(
	'the equation and the JSON block rendered alongside them',
	(await posted.locator('.comment__body .katex').count()) > 0 &&
		(await posted.locator('.comment__body pre code').count()) > 0
);
const stored = (
	await (
		await fetch(`${API}/api/exercises/2/comments/?fresh=${Date.now()}`, { headers: auth(ola) })
	).json()
).find((c) => c.body.includes(MARKER));
check(
	'the stored body kept data-chem through the server sanitizer',
	!!stored && stored.body.includes(`data-chem="${ketcherId}"`)
);
await posted.screenshot({ path: 'e2e/screenshots/comment-input-kinds-posted.png' });

// ---- rich mode: clicking a drawing reopens it
await form.locator('.rich-editor__modes button', { hasText: 'Editor' }).click();
await form.locator('.rich-editor__host .ProseMirror').waitFor({ timeout: 60000 });
await form.locator('.ProseMirror').click();
await p.keyboard.type(`${MARKER} edit: `);
await stripRow.locator('button', { hasText: /^Ketcher$/ }).click();
await modal.waitFor({ timeout: 20000 });
await p.waitForFunction(
	() => !!document.querySelector('.modal-panel button.submit:not([disabled])'),
	null,
	{ timeout: 180000 }
);
await p.evaluate(() => window.ketcher.setMolecule('CCO'));
await settle(1000);
await modal.locator('button.submit').click();
await modal.waitFor({ state: 'detached', timeout: 60000 });
const richImg = form.locator('.ProseMirror img.chem-drawing');
check('in rich mode the drawing is a live picture node', (await richImg.count()) === 1);
await richImg.click();
await modal.waitFor({ timeout: 20000 });
check(
	'clicking it reopens the drawing for editing',
	(await modal.locator('button.submit').innerText()).includes('Update')
);
await modal.locator('button.cancel').click();
await modal.waitFor({ state: 'detached', timeout: 10000 });

// ---- kill switch
await setFlag(false);
await p.reload({ waitUntil: 'load' });
const form2 = p.locator('.discussion form.comment-form').first();
await form2.locator('.insert-strip__row').waitFor({ timeout: 90000 });
await settle(1500);
const labelsOff = (
	await form2.locator('.insert-strip__row button, .insert-strip__row label').allInnerTexts()
).map((s) => s.trim());
check(
	'with `chemistry` off, Ketcher leaves the strip while the other five stay',
	!labelsOff.includes('Ketcher') &&
		['LaTeX', 'JSON', 'PDF', 'Picture'].every((k) => labelsOff.includes(k)),
	labelsOff.join('|')
);
const refused = await fetch(`${API}/api/chem-drawings/`, {
	method: 'POST',
	headers: auth(ola),
	body: JSON.stringify({
		tool: 'ketcher',
		source_format: 'mol',
		source: 'x V2000',
		image: '<svg xmlns="http://www.w3.org/2000/svg"/>'
	})
});
check(
	'…and the API refuses a non-staff drawing (403)',
	refused.status === 403,
	String(refused.status)
);
await setFlag(true);

await cleanup();
const left = (
	await (
		await fetch(`${API}/api/exercises/2/comments/?fresh=${Date.now()}`, { headers: auth(ola) })
	).json()
).filter((c) => c.body.includes(MARKER) && !c.is_removed);
check('scratch comments removed', left.length === 0);
await fetch(`${API}/api/auth/me/`, {
	method: 'PATCH',
	headers: auth(ola),
	body: JSON.stringify({ editor_mode: 'source' })
});
await browser.close();
const benign = errors.filter((e) => !/favicon|ERR_ABORTED|net::ERR_FAILED.*sourcemap/i.test(e));
check(
	'zero console/page errors',
	benign.length === 0,
	`${benign.slice(0, 3).join(' || ')} :: ${failedUrls.slice(0, 5).join(' ; ')}`
);
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
