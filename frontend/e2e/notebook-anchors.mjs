// Notebook content and comments on ONE part of something (2026-11-04, HISTORY.md §17DI).
//
// Ola, signed in by token, on /exercises/2:
//   1. selects a phrase in the STATEMENT → a "Comment on this" button appears beside it → the
//      composer opens saying what it is about → the posted comment carries
//      `anchor = {block: 'statement', quote}` and an "On the statement: “…”" line; pressing that
//      line flashes the statement and marks the passage (CSS Custom Highlight API); the statement's
//      gutter now counts 1, and pressing the count narrows the thread to it;
//   2. writes a NOTEBOOK comment — text, a formula, a piece of code — which is stored as three
//      blocks and drawn as KaTeX and a <pre>, the code as text (a `<b>` in it stays visible text);
//   3. replies to the FORMULA block of that comment through its gutter → the reply's anchor names
//      that block id and its parent;
//   4. a notebook SOLUTION (written through the API by a verified contributor) renders its three
//      blocks, and a comment on its second step goes into the entry's own thread with an anchor.
// Screenshots in e2e/screens/notebook-*.png. Cleans its comments and entry up.
//   E2E_BASE=http://localhost:5193 E2E_API=http://127.0.0.1:8031 node e2e/notebook-anchors.mjs
import { englishContext } from './english.mjs';

let chromium;
try {
	({ chromium } = await import('playwright'));
} catch {
	({ chromium } = await import('playwright-core'));
}
const BASE = process.env.E2E_BASE ?? 'http://localhost:5193';
const API = process.env.E2E_API ?? 'http://127.0.0.1:8031';
const EXERCISE = process.env.E2E_EXERCISE ?? '2';
let pass = 0;
let fail = 0;
const errors = [];
const check = (label, ok, extra = '') => {
	if (ok) pass++;
	else fail++;
	console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${label} ${ok ? '' : extra}`);
};
const MARKER = 'Notebook e2e';
const tokenFor = async (email) => {
	const r = await fetch(`${API}/api/auth/login/`, {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify({ username: email, password: 'password123' })
	});
	const j = await r.json();
	if (!j.token) throw new Error(`login failed for ${email}: ${JSON.stringify(j)}`);
	return j.token;
};
// Tokens may be passed in, so a session that runs several scripts does not burn the login
// throttle (e2e/CLAUDE.md trap 30).
const ola = process.env.E2E_TOKEN_OLA ?? (await tokenFor('ola@edmat.example'));
const kasia = process.env.E2E_TOKEN_KASIA ?? (await tokenFor('kasia@edmat.example'));
const auth = (t) => ({ 'Content-Type': 'application/json', Authorization: `Token ${t}` });
const getJson = async (path, token = ola) =>
	(
		await fetch(`${API}${path}${path.includes('?') ? '&' : '?'}fresh=${Date.now()}`, {
			headers: auth(token)
		})
	).json();

async function cleanup() {
	for (const c of await getJson(`/api/exercises/${EXERCISE}/comments/`)) {
		if (c.body.includes(MARKER) && !c.is_removed)
			await fetch(`${API}/api/comments/${c.id}/`, { method: 'DELETE', headers: auth(ola) });
	}
	const detail = await getJson(`/api/exercises/${EXERCISE}/`, kasia);
	for (const e of detail.entries ?? []) {
		if (e.body.includes(MARKER))
			await fetch(`${API}/api/solution-entries/${e.id}/`, {
				method: 'DELETE',
				headers: auth(kasia)
			});
	}
}
await cleanup();

const browser = await chromium.launch(
	process.env.CHROME ? { executablePath: process.env.CHROME } : {}
);
const ctx = await englishContext(browser, BASE, { viewport: { width: 1280, height: 1000 } });
await ctx.addInitScript((t) => localStorage.setItem('edmat-auth-token', t), ola);
const p = await ctx.newPage();
p.on('console', (msg) => {
	if (msg.type() === 'error' && !/katex.*fonts|403/i.test(msg.text())) errors.push(msg.text());
});
p.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
const settle = (ms = 700) => p.waitForTimeout(ms);

/** Select `phrase` inside the first text node under `selector` that contains it, and fire the
 *  mouseup a reader's drag would end with. */
async function selectPhrase(selector, phrase) {
	return p.evaluate(
		({ selector, phrase }) => {
			const root = document.querySelector(selector);
			if (!root) return 'no root';
			const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
			let node;
			while ((node = walker.nextNode())) {
				if (node.parentElement?.closest('.katex')) continue;
				const at = node.textContent.indexOf(phrase);
				if (at >= 0) {
					const range = document.createRange();
					range.setStart(node, at);
					range.setEnd(node, at + phrase.length);
					const sel = window.getSelection();
					sel.removeAllRanges();
					sel.addRange(range);
					root.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
					return 'ok';
				}
			}
			return 'phrase not found';
		},
		{ selector, phrase }
	);
}

await p.goto(`${BASE}/exercises/${EXERCISE}`, { waitUntil: 'load' });
const statement = `[data-anchor-scope="exercise-${EXERCISE}"] > [data-block-id="statement"]`;
await p.locator(statement).waitFor({ timeout: 90000 });
await settle(1500);

// ---- 1. a passage of the statement
const phrase = await p.evaluate((sel) => {
	// Two or three plain words inside ONE text node that is not part of a formula.
	const walker = document.createTreeWalker(document.querySelector(sel), NodeFilter.SHOW_TEXT);
	let node;
	while ((node = walker.nextNode())) {
		if (node.parentElement?.closest('.katex')) continue;
		const words = (node.textContent ?? '').match(/[A-Za-zÀ-ž]{4,}( [A-Za-zÀ-ž]{3,}){0,2}/);
		if (words) return words[0];
	}
	return '';
}, statement);
check('the statement has plain words to select', !!phrase, phrase);
check('selecting them works', (await selectPhrase(statement, phrase)) === 'ok');
await settle();
const selButton = p.locator('.nb-selection');
check('a "Comment on this" button appears beside the selection', await selButton.isVisible());
await selButton.click();
const form = p.locator('.discussion form.comment-form').first();
await form.waitFor({ timeout: 10000 });
const anchorLine = form.locator('.comment-form__anchor');
check('the composer says what it is about', await anchorLine.isVisible());
check(
	'…quoting the selection',
	(await anchorLine.innerText()).includes(phrase),
	await anchorLine.innerText()
);
await form.locator('.rich-editor textarea, .rich-editor [contenteditable="true"]').first().click();
await p.keyboard.type(`${MARKER}: is this about a closed interval?`);
await form.locator('button.submit').click();
await settle(1200);
let thread = await getJson(`/api/exercises/${EXERCISE}/comments/`);
const anchored = thread.find((c) => c.body.includes(`${MARKER}: is this`));
check('the comment was stored', !!anchored);
check(
	'with anchor.block = statement',
	anchored?.anchor?.block === 'statement',
	JSON.stringify(anchored?.anchor)
);
check('and the quote', anchored?.anchor?.quote === phrase, JSON.stringify(anchored?.anchor));
check('state attached', anchored?.anchor?.state === 'attached');
const chip = p.locator(`#comment-${anchored?.id} .anchor__go`).first();
const chipVisible = await chip.isVisible().catch(() => false);
check('the comment shows its "On the statement" line', chipVisible);
await p
	.locator(`#comment-${anchored?.id}`)
	.scrollIntoViewIfNeeded()
	.catch(() => {});
await settle(300);
await p.screenshot({ path: 'e2e/screens/notebook-1-anchored-comment.png', fullPage: false });
if (chipVisible) {
	await chip.click();
	await settle(1200);
	check(
		'pressing it flashes the statement',
		await p.locator(statement).evaluate((el) => el.classList.contains('nb-block--flash'))
	);
	check(
		'and marks the passage with a highlight',
		await p.evaluate(() =>
			globalThis.CSS?.highlights ? CSS.highlights.has('edmat-anchor') : 'n/a'
		)
	);
	await p.screenshot({ path: 'e2e/screens/notebook-2-highlighted.png', fullPage: false });
}
const count = p.locator(`${statement} .nb-count`);
check(
	'the statement gutter counts the comment',
	(await count.innerText().catch(() => '')).includes('1')
);
await count.click();
await settle();
check('pressing the count narrows the thread', await p.locator('.discussion__focus').isVisible());
check(
	'…to exactly the comments about it',
	(await p.locator('.discussion__roots > li').count()) ===
		thread.filter((c) => !c.parent && c.anchor?.block === 'statement' && !c.is_removed).length
);
await p.locator('.discussion__focus button').click();

// ---- 2. a notebook comment
await p.locator('.discussion .comment-form__open').first().click();
const nbForm = p.locator('.discussion form.comment-form').first();
await nbForm.locator('button.mode').click();
await nbForm.locator('.block-editor').waitFor();
await nbForm
	.locator(
		'.block-editor .rich-editor textarea, .block-editor .rich-editor [contenteditable="true"]'
	)
	.first()
	.click();
await p.keyboard.type(`${MARKER}: my working, step by step.`);
// Add a formula at the end, then code after it.
const addAt = (n) => nbForm.locator('.block-editor > .add').nth(n);
await addAt(1).locator('.add__trigger').click();
await addAt(1)
	.locator('.add__menu button', { hasText: /^Formula$/ })
	.click();
await nbForm.locator('.block-editor .card').nth(1).locator('textarea').fill("f'(x) = 3x^2 - 3 = 0");
await addAt(2).locator('.add__trigger').click();
await addAt(2)
	.locator('.add__menu button', { hasText: /^Code$/ })
	.click();
const codeCard = nbForm.locator('.block-editor .card').nth(2);
await codeCard.locator('input').fill('python');
await codeCard
	.locator('textarea')
	.fill('xs = [x / 100 for x in range(101)]\nprint(max(f(x) for x in xs))  # <b>not bold</b>');
await p.screenshot({ path: 'e2e/screens/notebook-3-composer.png', fullPage: false });
await nbForm.locator('button.submit').click();
await settle(1500);
thread = await getJson(`/api/exercises/${EXERCISE}/comments/`);
const notebook = thread.find((c) => c.body.includes(`${MARKER}: my working`));
check('the notebook comment was stored', !!notebook);
check(
	'as three blocks: text, formula, code',
	JSON.stringify(notebook?.blocks?.map((b) => b.kind)) === '["markdown","latex","code"]',
	JSON.stringify(notebook?.blocks?.map((b) => b.kind))
);
check(
	'each with an id',
	notebook?.blocks?.every((b) => /^[a-z0-9]{4,16}$/.test(b.id))
);
const nbEl = p.locator(`#comment-${notebook?.id}`);
await nbEl.waitFor({ timeout: 10000 }).catch(() => {});
check('the formula is typeset', (await nbEl.locator('[data-kind="latex"] .katex').count()) > 0);
check(
	'the code is drawn as text, markup and all',
	(
		await nbEl
			.locator('[data-kind="code"] pre code')
			.innerText()
			.catch(() => '')
	).includes('<b>not bold</b>')
);

// ---- 3. a reply on the formula block
const latexBlock = nbEl.locator(
	`[data-anchor-scope="comment-${notebook?.id}"] > [data-kind="latex"]`
);
await latexBlock.hover();
await latexBlock.locator('.nb-add').click();
const replyForm = nbEl.locator('.comment__reply-form form.comment-form');
await replyForm.waitFor({ timeout: 10000 });
check(
	'the reply box says it is about part of this comment',
	await replyForm.locator('.comment-form__anchor').isVisible()
);
await replyForm
	.locator('.rich-editor textarea, .rich-editor [contenteditable="true"]')
	.first()
	.click();
await p.keyboard.type(`${MARKER}: why does 3x^2 - 3 vanish only there?`);
await replyForm.locator('button.submit').click();
await settle(1500);
thread = await getJson(`/api/exercises/${EXERCISE}/comments/`);
const reply = thread.find((c) => c.body.includes(`${MARKER}: why does`));
const latexId = notebook?.blocks?.[1]?.id;
check(
	"the reply's line names the block's kind",
	(
		await p
			.locator(`#comment-${reply?.id} .anchor__label`)
			.innerText()
			.catch(() => '')
	).includes('formula')
);
check(
	'the reply names the formula block',
	reply?.anchor?.block === latexId,
	JSON.stringify(reply?.anchor)
);
check('and its parent', String(reply?.parent) === String(notebook?.id));
await p.goto(`${BASE}/exercises/${EXERCISE}#comment-${notebook?.id}`, { waitUntil: 'load' });
await p.locator(`#comment-${notebook?.id}`).waitFor({ timeout: 60000 });
await settle(1200);
check(
	'the formula block counts its reply',
	(
		await p
			.locator(`[data-anchor-scope="comment-${notebook?.id}"] > [data-kind="latex"] .nb-count`)
			.innerText()
			.catch(() => '')
	).includes('1')
);
await p.locator(`#comment-${notebook?.id}`).scrollIntoViewIfNeeded();
await p.screenshot({ path: 'e2e/screens/notebook-4-reply-on-block.png', fullPage: false });

// ---- 3b. editing the notebook keeps its blocks' ids, so the reply stays attached
const mine = p.locator(`#comment-${notebook?.id}`);
await mine.locator('.meatballs__trigger').first().click();
await mine.locator('[role="menuitem"]', { hasText: 'Edit' }).first().click();
const editForm = mine.locator('.comment__edit-form form').first();
await editForm.waitFor({ timeout: 10000 });
check(
	'a notebook comment is edited as a notebook',
	(await editForm.locator('.block-editor .card').count()) === 3
);
await editForm
	.locator('.block-editor .card')
	.nth(1)
	.locator('textarea')
	.fill("f'(x) = 3(x^2 - 1) = 0");
await editForm.locator('button.submit').click();
await settle(1500);
thread = await getJson(`/api/exercises/${EXERCISE}/comments/`);
const edited = thread.find((c) => c.id === notebook?.id);
check(
	'the edit saved the new formula',
	edited?.blocks?.[1]?.source === "f'(x) = 3(x^2 - 1) = 0",
	JSON.stringify(edited?.blocks?.[1])
);
check(
	'with the same block ids',
	JSON.stringify(edited?.blocks?.map((b) => b.id)) ===
		JSON.stringify(notebook?.blocks?.map((b) => b.id))
);
check(
	'so the reply on the formula is still attached',
	thread.find((c) => c.id === reply?.id)?.anchor?.state === 'attached'
);

// ---- 4. a notebook solution and a comment on one step
const created = await fetch(`${API}/api/exercises/${EXERCISE}/entries/`, {
	method: 'POST',
	headers: auth(kasia),
	body: JSON.stringify({
		kind: 'solution',
		locale: 'pl',
		blocks: [
			{ kind: 'markdown', body: `<p>${MARKER}: differentiate first.</p>` },
			{ kind: 'latex', source: "f'(x) = 0 \\iff x = 1" },
			{ kind: 'markdown', body: '<p>So the maximum is at an endpoint.</p>' }
		]
	})
});
const entry = await created.json();
check(
	'a notebook solution can be written through the API',
	created.status === 201,
	JSON.stringify(entry).slice(0, 200)
);
await p.goto(`${BASE}/exercises/${EXERCISE}`, { waitUntil: 'load' });
await p.locator(statement).waitFor({ timeout: 90000 });
await settle(1000);
const entryScope = `[data-anchor-scope="solutionEntry-${entry.id}"]`;
const reveal = p.locator('button', { hasText: /^Show solutions/ }).first();
if (await reveal.isVisible().catch(() => false)) await reveal.click();
await p
	.locator(entryScope)
	.waitFor({ timeout: 20000 })
	.catch(() => {});
check(
	'the solution draws its three blocks',
	(await p.locator(`${entryScope} > .nb-block`).count()) === 3
);
const step = p.locator(`${entryScope} > [data-kind="latex"]`);
await step.hover();
await step.locator('.nb-add').click();
const entryForm = p
	.locator(`article:has(${entryScope}) .entry__discussion form.comment-form`)
	.first();
await entryForm.waitFor({ timeout: 15000 }).catch(() => {});
check(
	'the entry thread opens with the step as its subject',
	await entryForm
		.locator('.comment-form__anchor')
		.isVisible()
		.catch(() => false)
);
await entryForm
	.locator('.rich-editor textarea, .rich-editor [contenteditable="true"]')
	.first()
	.click();
await p.keyboard.type(`${MARKER}: and x = -1?`);
await entryForm.locator('button.submit').click();
await settle(1500);
const entryThread = await getJson(`/api/solution-entries/${entry.id}/comments/`);
const onStep = entryThread.find((c) => c.body.includes(`${MARKER}: and x`));
check('the comment on the step is in the entry thread', !!onStep);
check(
	'naming the step',
	onStep?.anchor?.block === entry.blocks?.[1]?.id,
	JSON.stringify(onStep?.anchor)
);
await p.locator(entryScope).scrollIntoViewIfNeeded();
await p.screenshot({ path: 'e2e/screens/notebook-5-solution-step.png', fullPage: false });

check('no page errors', errors.length === 0, errors.slice(0, 3).join(' | '));

// cleanup
for (const c of entryThread)
	if (c.body.includes(MARKER))
		await fetch(`${API}/api/comments/${c.id}/`, { method: 'DELETE', headers: auth(ola) });
await cleanup();
await browser.close();
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
