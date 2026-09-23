// The whiteboard (Excalidraw, MIT) as a content input: Ola, signed in by token, opens a comment
// form on exercise 2, presses **Sketch**, gets a FULLSCREEN board, draws a real stroke with a real
// mouse (down / move / move / up — not a synthesized element), saves it through /api/sketches/ and
// gets back an <img data-sketch> in the composer; posts the comment and the picture genuinely
// loads; switches to rich mode, clicks the drawing and the board reopens with the stroke still in
// it; and with the `sketches` kill switch off the button leaves the strip for a non-staff account
// while the API refuses her. Cleans its comments up and restores the flag and her editor mode.
//
//   E2E_BASE=http://localhost:5193 E2E_API=http://127.0.0.1:8023 node e2e/sketch.mjs
//
// Notes for whoever runs this next:
// * Excalidraw is a NEW dependency, so Vite's optimizer reloads the page the first time it is
//   imported (e2e/CLAUDE.md trap 22) — the run opens the board once as a throwaway, reloads, and
//   only then believes anything.
// * The interface default is Polish (trap 24), so this asks for English the way a person does.
// * The board must be drawn on with the freedraw tool, chosen by clicking its toolbar button.
//   Excalidraw's keyboard shortcut (`7`/`P`) only fires once the BOARD has focus, so pressing it
//   right after the dialog opens leaves the selection tool active and the drag that follows
//   selects empty space — a check that passes on "a stroke was drawn" while nothing was.
let chromium;
try {
	({ chromium } = await import('playwright'));
} catch {
	({ chromium } = await import('playwright-core'));
}
import { englishContext } from './english.mjs';

const BASE = process.env.E2E_BASE ?? 'http://localhost:5193';
const API = process.env.E2E_API ?? 'http://127.0.0.1:8023';
let pass = 0,
	fail = 0;
const check = (l, ok, x = '') => {
	if (ok) pass++;
	else fail++;
	console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${l} ${ok ? '' : x}`);
};
const MARKER = 'Sketch e2e';
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
	fetch(`${API}/api/feature-flags/sketches/`, {
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
const ctx = await englishContext(browser, BASE, { viewport: { width: 1400, height: 950 } });
await ctx.addInitScript((t) => localStorage.setItem('edmat-auth-token', t), ola);
const p = await ctx.newPage();
const requested = [];
p.on('request', (r) => requested.push(r.url()));
const errors = [];
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
// production build names its chunks by hash, so there the check is the host module).
const LIB = /(node_modules|\.vite\/deps)\/(@excalidraw|react)|SketchHost/i;

const overlay = p.locator('.sketch-fullscreen');
const stage = p.locator('.sketch-fullscreen__stage');

async function openBoard(form) {
	await form.locator('.insert-strip__row button', { hasText: /^Sketch$/ }).click();
	await overlay.waitFor({ timeout: 30000 });
	await p.waitForFunction(() => !!window.excalidrawAPI, null, { timeout: 120000 });
	await p.waitForFunction(
		() => !!document.querySelector('.sketch-fullscreen button.submit:not([disabled])'),
		null,
		{ timeout: 120000 }
	);
}

/** A real stroke: pick the freehand tool off the toolbar with the mouse, then press, move,
 * move, move, release. The tool is chosen by clicking its toolbar button rather than by the
 * keyboard shortcut, because that is what somebody drawing with a mouse does — and because
 * Excalidraw's shortcut only fires once the board itself has focus, so pressing `7` straight
 * after the dialog opened (focus on the dialog panel) silently leaves the selection tool active
 * and the drag that follows selects empty space instead of drawing. Found by this check failing. */
async function drawStroke(x0 = 0.35, y0 = 0.35) {
	const box = await stage.boundingBox();
	await stage.locator('input[data-testid="toolbar-freedraw"]').click({ force: true });
	await settle(300);
	const tool = await p.evaluate(() => window.excalidrawAPI.getAppState().activeTool.type);
	const sx = box.x + box.width * x0;
	const sy = box.y + box.height * y0;
	await p.mouse.move(sx, sy);
	await p.mouse.down();
	for (let i = 1; i <= 24; i++) {
		await p.mouse.move(sx + i * 9, sy + Math.sin(i / 2.2) * 70, { steps: 2 });
	}
	await p.mouse.up();
	await settle(600);
	return tool;
}

// ---- warm Vite's optimizer on the brand-new dependency, then start for real (trap 22)
await p.goto(`${BASE}/exercises/2`, { waitUntil: 'load' });
await p.locator('.discussion form.comment-form .rich-editor textarea').waitFor({ timeout: 120000 });
await openBoard(p.locator('.discussion form.comment-form').first()).catch(() => {});
await settle(1500);
await p.reload({ waitUntil: 'load' });

const form = p.locator('.discussion form.comment-form').first();
await form.locator('.rich-editor textarea').waitFor({ timeout: 120000 });
const strip = form.locator('.insert-strip');
const stripRow = strip.locator('.insert-strip__row');
const labels = (await stripRow.locator('button, label').allInnerTexts()).map((s) => s.trim());
check(
	'the strip offers Sketch beside the other input kinds',
	labels.includes('Sketch'),
	labels.join('|')
);

requested.length = 0;
check(
	'nothing of the drawing library was downloaded before the button was pressed',
	!requested.some((u) => LIB.test(u))
);

// ---- open the board, fullscreen
const ta = form.locator('.rich-editor textarea');
await ta.fill(`${MARKER}: `);
await openBoard(form);
check('pressing Sketch opens a board', await overlay.isVisible());
check(
	'…and only now was the drawing library fetched',
	requested.some((u) => /@excalidraw|excalidraw/i.test(u))
);
const viewport = p.viewportSize();
const panelBox = await p.locator('.sketch-fullscreen__panel').boundingBox();
check(
	'the board really is fullscreen: it covers the viewport',
	panelBox.width >= viewport.width - 2 && panelBox.height >= viewport.height - 2,
	JSON.stringify({ panelBox, viewport })
);
const stageBox = await stage.boundingBox();
check(
	'…and the canvas takes nearly all of it, chrome aside',
	stageBox.height > viewport.height * 0.6,
	JSON.stringify(stageBox)
);
check(
	'Excalidraw is credited where the MIT notice lives',
	(await p.locator('.sketch-fullscreen__footer').innerText()).includes('Excalidraw')
);
// The library resolves its font files against `window.EXCALIDRAW_ASSET_PATH` and, with that unset,
// falls back to esm.sh — a third-party request from the reader's browser. A stroke needs no font, so
// the fetch is provoked here rather than waited for: `document.fonts.load` is what rendering a text
// element would do anyway, and it is the only way to see WHERE the face points.
await p.evaluate(() => document.fonts.load('20px Excalifont').catch(() => {}));
await settle(1200);
check(
	'the fonts come from this origin, not from a CDN',
	requested.some((u) => u.includes('/excalidraw/fonts/')) &&
		!requested.some((u) => /esm\.sh|unpkg\.com/i.test(u)),
	requested
		.filter((u) => /esm\.sh|unpkg|fonts/i.test(u))
		.slice(0, 4)
		.join(' ') || 'no font was fetched at all'
);
check(
	'the board draws its own toolbar (so pan/zoom are the library’s, not hand-built)',
	(await p.locator('.sketch-fullscreen__stage .excalidraw .App-toolbar').count()) > 0
);

// ---- a real stroke, drawn with the mouse
const toolChosen = await drawStroke();
check(
	'clicking the toolbar\u2019s pencil selects the freehand tool',
	toolChosen === 'freedraw',
	toolChosen
);
const scene = await p.evaluate(() =>
	window.excalidrawAPI
		.getSceneElements()
		.map((e) => ({ type: e.type, points: e.points?.length ?? 0 }))
);
check(
	'a real mouse drag left one freehand stroke with many points on the board',
	scene.length === 1 && scene[0].type === 'freedraw' && scene[0].points > 5,
	JSON.stringify(scene)
);

// Zoom, because that is half the ask: the picture must come from the DRAWING, not from the view.
const zoomBefore = await p.evaluate(() => window.excalidrawAPI.getAppState().zoom.value);
await p
	.locator('.sketch-fullscreen__stage .excalidraw button[data-testid="zoom-in-button"]')
	.click({ timeout: 5000 })
	.catch(async () => {
		await p.mouse.move(stageBox.x + stageBox.width / 2, stageBox.y + stageBox.height / 2);
		await p.keyboard.down('Control');
		await p.mouse.wheel(0, -240);
		await p.keyboard.up('Control');
	});
await settle(500);
const zoomAfter = await p.evaluate(() => window.excalidrawAPI.getAppState().zoom.value);
check('the XY space zooms', zoomAfter > zoomBefore, `${zoomBefore} -> ${zoomAfter}`);

await p.locator('.sketch-fullscreen__caption input').fill(`${MARKER} stroke`);
await p.screenshot({ path: 'e2e/screenshots/sketch-board.png' });

// ---- save
await p.locator('.sketch-fullscreen button.submit').click();
await overlay.waitFor({ state: 'detached', timeout: 60000 });
const afterSave = await ta.inputValue();
const sketchId = /data-sketch="(\d+)"/.exec(afterSave)?.[1];
check(
	'the drawing is inserted as an <img data-sketch> pointing at site media',
	!!sketchId && /src="[^"]*\/media\/sketches\/[a-f0-9]+\.webp"/.test(afterSave),
	afterSave.slice(-220)
);
check(
	'…carrying its intrinsic size and lazy loading, so the page does not jump',
	/width="\d+"/.test(afterSave) &&
		/height="\d+"/.test(afterSave) &&
		afterSave.includes('loading="lazy"'),
	afterSave.slice(-220)
);
const row = sketchId ? await (await fetch(`${API}/api/sketches/${sketchId}/`)).json() : null;
check(
	'the API holds the scene JSON and a re-encoded WebP of the declared size',
	!!row &&
		JSON.parse(row.source).elements.length === 1 &&
		/\.webp$/.test(row.image_url) &&
		row.width > 0 &&
		row.height > 0,
	JSON.stringify({ w: row?.width, h: row?.height, url: row?.image_url })
);
check('…labelled with what was typed', row?.label === `${MARKER} stroke`, row?.label);

// ---- post it
await form.locator('button[type="submit"]').click();
const posted = p.locator('.discussion .comment', { hasText: MARKER }).first();
await posted.waitFor({ timeout: 30000 });
await settle(2500);
const imgs = posted.locator('.comment__body img.sketch-drawing');
check(
	'the posted comment shows the picture',
	(await imgs.count()) === 1,
	`count=${await imgs.count()} body=${(await posted.locator('.comment__body').innerHTML()).slice(0, 400)}`
);
const loaded = await imgs.evaluateAll((els) =>
	els.map((e) => [
		e.complete && e.naturalWidth > 0,
		e.getAttribute('data-sketch'),
		e.getAttribute('loading')
	])
);
check(
	'…and it genuinely loads, still lazy (not a broken image)',
	loaded.length === 1 && loaded[0][0] === true && loaded[0][2] === 'lazy',
	JSON.stringify(loaded)
);
const stored = (
	await (
		await fetch(`${API}/api/exercises/2/comments/?fresh=${Date.now()}`, { headers: auth(ola) })
	).json()
).find((c) => c.body.includes(MARKER));
check(
	'the stored body kept data-sketch and the class through the server sanitizer',
	!!stored &&
		stored.body.includes(`data-sketch="${sketchId}"`) &&
		stored.body.includes('sketch-drawing'),
	(stored?.body ?? '').slice(-260)
);
await posted.screenshot({ path: 'e2e/screenshots/sketch-posted-comment.png' });

// ---- rich mode: clicking the drawing reopens the board with the stroke still there
await form.locator('.rich-editor__modes button', { hasText: 'Editor' }).click();
await form.locator('.rich-editor__host .ProseMirror').waitFor({ timeout: 60000 });
await form.locator('.ProseMirror').click();
await p.keyboard.type(`${MARKER} edit: `);
await openBoard(form);
await drawStroke(0.3, 0.55);
await p.locator('.sketch-fullscreen button.submit').click();
await overlay.waitFor({ state: 'detached', timeout: 60000 });
const richImg = form.locator('.ProseMirror img.sketch-drawing');
check('in rich mode the drawing is a live picture node', (await richImg.count()) === 1);
const richAttrs = await richImg.evaluate((e) => ({
	sketch: e.getAttribute('data-sketch'),
	w: e.getAttribute('width'),
	h: e.getAttribute('height'),
	loading: e.getAttribute('loading')
}));
check(
	'…and the rich editor kept the whole tag: data-sketch, intrinsic size and lazy loading',
	!!richAttrs.sketch && !!richAttrs.w && !!richAttrs.h && richAttrs.loading === 'lazy',
	JSON.stringify(richAttrs)
);
await richImg.click();
await overlay.waitFor({ timeout: 30000 });
await p.waitForFunction(() => !!window.excalidrawAPI, null, { timeout: 120000 });
await settle(1200);
check(
	'clicking it reopens the board for editing',
	(await p.locator('.sketch-fullscreen button.submit').innerText()).includes('Update')
);
const reopened = await p.evaluate(() => window.excalidrawAPI.getSceneElements().map((e) => e.type));
check(
	'…with the stroke still on it (the scene JSON round-tripped)',
	reopened.length >= 1 && reopened.every((t) => t === 'freedraw'),
	JSON.stringify(reopened)
);
await p.screenshot({ path: 'e2e/screenshots/sketch-reopened.png' });
await p.locator('.sketch-fullscreen button.cancel').click();
await overlay.waitFor({ state: 'detached', timeout: 15000 });

// ---- kill switch, as a NON-staff account (trap 10)
await setFlag(false);
await p.reload({ waitUntil: 'load' });
const form2 = p.locator('.discussion form.comment-form').first();
await form2.locator('.insert-strip__row').waitFor({ timeout: 120000 });
await settle(1500);
const labelsOff = (
	await form2.locator('.insert-strip__row button, .insert-strip__row label').allInnerTexts()
).map((s) => s.trim());
check(
	'with `sketches` off, Sketch leaves the strip while the other kinds stay',
	!labelsOff.includes('Sketch') && ['LaTeX', 'JSON', 'Picture'].every((k) => labelsOff.includes(k)),
	labelsOff.join('|')
);
const refused = await fetch(`${API}/api/sketches/`, {
	method: 'POST',
	headers: auth(ola),
	body: JSON.stringify({ source: '{"elements": []}', image: 'data:image/png;base64,x' })
});
check(
	'…and the API refuses a non-staff drawing (403)',
	refused.status === 403,
	String(refused.status)
);
const stillThere = await fetch(`${API}/api/sketches/${sketchId}/`, { headers: auth(kasia) });
check(
	'…while staff can still reach an existing one',
	stillThere.status === 200,
	String(stillThere.status)
);
await setFlag(true);

// ---- cleanup
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

// A sketch has no delete endpoint (a published comment must keep resolving), so the two rows this
// run created stay behind on purpose — the same honest leftover the claim scripts have.
const realErrors = errors.filter((e) => !/favicon|optimized dependencies changed/i.test(e));
check('no console or page errors', realErrors.length === 0, realErrors.slice(0, 3).join(' | '));
check(
	'no failed requests',
	failedUrls.filter((u) => !u.includes('/api/sketches/') || !u.startsWith('403')).length === 0,
	failedUrls.slice(0, 4).join(' | ')
);
console.log(`\n${pass} passed, ${fail} failed`);
await browser.close();
process.exit(fail === 0 ? 0 : 1);
