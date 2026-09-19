// The six ways into a comment (root CLAUDE.md §17AV): Markdown file / LaTeX / JSON / Chemistry /
// Picture / PDF on one strip under the comment box. Ola, signed in by token, inserts a LaTeX
// block, a JSON block and a Markdown file into the source box; uploads a PICTURE, which goes into
// the body itself rather than into the attachment row, carrying the width/height/loading="lazy"
// that stop the page jumping; draws a REACTION in a REAL Ketcher (Indigo WASM in the browser),
// saved through /api/chem-drawings/ and embedded as <img data-chem>; posts the comment and both
// pictures genuinely load; clicking the drawing in rich mode reopens it for editing while an
// ordinary picture is inert; the `chemistry` kill switch removes the button and closes the API for
// a non-staff account. Cleans its comments up.
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
	['Markdown file', 'LaTeX', 'JSON', 'Chemistry', 'Picture', 'PDF'].every((k) =>
		labels.includes(k)
	),
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

// ---- Picture: uploaded on the spot and inserted INTO the body, not stapled under it
const PNG = Buffer.from(
	'iVBORw0KGgoAAAANSUhEUgAAAWgAAADwCAIAAACixWkYAAAFY0lEQVR4nO3azXETaRiFUc0UYcyKEAhkImLJktgIgVhm8bkYY1RS31Z//+ckIEGVH/d73X/98+/3G0Di795fAJiPcAAx4QBiwgHEhAOICQcQEw4gJhxATDiAmHAAMeEAYsIBxIQDiAkHEBMOICYcQEw4gJhwADHhAGLCAcSEA4gJBxATDiAmHEBMOICYcAAx4QBiwgHEhAOICQcQEw4gJhxATDiAmHAAMeEAYsIBxIQDiPUMx89vPzp+OnBa5yeOn99+yAdM51OvD37fC+2A0z5//dL+Q20cQKxPODxiwNQ8cQCxPuHocpUBV/HEAcSEA4gJBxDr9h7HafYR9jTU3yKHe+L4/PXL4zR42RS6Gy4cxdPHCvmAjgYNx+3Ao8dNPqCTccNRHMxHmy8DFKOHozB8wFDmCEfhcoFBzBSOm+EDxjBZOArDB/Q1ZTgKwwf0MnE4CpcLtDd9OG6GD2huhXAUhg9oZp1wFIYPaGC1cBQuF6hqzXDcDB9Q07LhKAwfUMPi4SgMH3CtLcJRuFzgKhuF42b4gIvsFY7C8AEv2jEcheEDTts3HIXLBU7YPRw3wwfkhOON4QOOE47fGD7gCOG4w+UCjwnHfYYPeEA4HjF8wF3C8ZzhAz4QjqNcLvCLcAQMH1AIR8zwAcJxkuGDnQnHS1wu7Ek4XmX4YEPCcQ3DB1sRjisZPtiEcFzP5cLyhKMKwwdrE46KDB+sSjiqM3ywHuFoxOXCSoSjHcMHyxCO1gwfLEA4+jB8MDXh6MnlwqSEozPDBzMSjiEYPpiLcAzE8MEshGM4LhfGJxwjMnwwOOEYl+GDYQnH6AwfDEg45uByYSjCMQ3DB+MQjskYPhiBcEzJ8EFfwjExlwu9CMfcDB90IRwrMHzQmHCsw/BBM8KxGpcLDQjHggwf1CYcyzJ8UI9wLM7wQQ3CsQWXC9cSjl0YPriQcOzF8MElhGNHhg9eJBz7crlwmnBszfDBOcKB4YOYcPDG8MFxwsFvXC4cIRx8ZPjgKeHgPsMHDwgHjxg+uEs4eM7lwgfCwSGGD94TDgKGDwrhIGb4QDg4yeWyM+HgPMPHtoSDVxk+NiQcXMPwsRXh4Eoul00IBxczfOxAOKjC8LE24aAiw8eqhIPqXC7rEQ5aMHwsRjhox/CxDOGgNcPHAoSDPlwuUxMOujF8zEs46MzwMSPhYAiGj7kIBwNxucxCOBiL4WMKwsGIDB+DEw7GZfgYlnAwOpfLgISDCRg+RiMcTMPwMQ7hYDKGjxEIB1NyufQlHMzK8NGRcDA3w0cXwsEKDB+NCQfrcLk0IxwsxfDRhnCwIMNHbcLBsgwf9QgHi3O51CAcrM/wcTnhYBeGjwsJB3sxfFxCONiRy+VFwsGmDB+vEA62Zvg4RzjA8BETDnjjcjlOOOB/ho+DhAM+Mnw8JRxwn+HjAeGAR1wudwkHPGH4+JNwwCGGj/eEAwKGj0I4IOZyEQ44Y/PhQzjgvG2HD+GAV204fAgHXGOry0U44DL7DB/CARfbYfgQDqhi7eFDOKCiVS8X4YC6lhw+hANaWGz4EA5oZ5nhQzigtQUuF+GADmYfPoQDupl3+PjU+wt8NOZ/E3Q04A+FJw4gJhxATDiAmHAAMeGAuXWZToUDiAkHzO3pmyA1dHuPo8u/FhYwwmsdnjhgMu9/6fb6BSwcMJ8j76pXJRwwq47tEA4gJhxATDiAmHAAMeEAYsIBxIQDiAkHEBMOICYcQEw4gJhwADHhAGLCAcSEA4gJBxATDiAmHEBMOICYcAAx4QBiwgHEhAOICQcQEw4gJhxATDiAmHAAMeEAYsIBxIQDiAkHEBMOICYcQEw4gNh/GE4XO7Gh9CIAAAAASUVORK5CYII=',
	'base64'
);
await stripRow
	.locator('label', { hasText: 'Picture' })
	.locator('input[type=file]')
	.setInputFiles({ name: 'apparatus.png', mimeType: 'image/png', buffer: PNG });
await strip.locator('.insert-strip__thumb').waitFor({ timeout: 15000 });
const altField = strip.locator('.insert-strip__field input');
check(
	'picking a picture shows it and offers a description, prefilled rather than left empty',
	(await altField.inputValue()) === 'apparatus.png'
);
await altField.fill('The apparatus, with the tap on the left');
// Taken BEFORE Insert: the point of this picture is the panel with the preview and the
// description field in it, and after Insert the panel is gone and it shows an empty strip.
await strip.screenshot({ path: 'e2e/screenshots/comment-input-kinds-picture.png' });
const beforePicture = await ta.inputValue();
await strip.locator('.insert-strip__actions .primary').click();
await p.waitForFunction(
	(before) => {
		const el = document.querySelector('.discussion form.comment-form .rich-editor textarea');
		return el && el.value.length > before.length && el.value.includes('inline-images');
	},
	beforePicture,
	{ timeout: 30000 }
);
const afterPicture = await ta.inputValue();
const pictureTag = /<img[^>]*inline-images[^>]*>/.exec(afterPicture)?.[0] ?? '';
check(
	'Insert uploads it and puts an <img> pointing at site media into the body itself',
	/src="[^"]*\/media\/inline-images\/[a-f0-9]+\.webp"/.test(pictureTag),
	pictureTag
);
check(
	'…carrying the description, the intrinsic size and lazy loading (so the layout cannot jump)',
	pictureTag.includes('alt="The apparatus, with the tap on the left"') &&
		/width="\d+"/.test(pictureTag) &&
		/height="\d+"/.test(pictureTag) &&
		pictureTag.includes('loading="lazy"'),
	pictureTag
);
check(
	'…and nothing was added to the attachment row: an attachment is a document now',
	(await form.locator('.comment-form__files .file-chip').count()) === 0
);

// ---- Ketcher
await stripRow.locator('button', { hasText: /^Chemistry$/ }).click();
const modal = p.locator('.modal-panel');
await modal.waitFor({ timeout: 20000 });
const chemTitle = await modal.locator('h2').innerText();
check(
	'the chemistry dialog opens, titled by what it makes rather than by the tool',
	chemTitle.includes('chemical structure') && !chemTitle.includes('Ketcher'),
	chemTitle
);
check(
	'…and Ketcher is still credited where the Apache 2.0 notice lives',
	(await modal.locator('.chem-editor__licence').innerText()).includes('Ketcher')
);
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
const inlinePics = posted.locator('.comment__body img.inline-image');
check(
	'the posted comment shows the uploaded picture in the text, not under it',
	(await inlinePics.count()) === 1 && (await posted.locator('.comment__attachments').count()) === 0,
	`pics=${await inlinePics.count()}`
);
const inlineLoaded = await inlinePics.evaluateAll((els) =>
	els.map((e) => [e.complete && e.naturalWidth > 0, e.getAttribute('loading'), e.alt])
);
check(
	'…it genuinely loads, still lazy and still described',
	inlineLoaded.length === 1 &&
		inlineLoaded[0][0] === true &&
		inlineLoaded[0][1] === 'lazy' &&
		inlineLoaded[0][2].startsWith('The apparatus'),
	JSON.stringify(inlineLoaded)
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
check(
	'…and kept the uploaded picture whole: src, alt, size and loading all survived bleach',
	!!stored &&
		/\/media\/inline-images\//.test(stored.body) &&
		stored.body.includes('loading="lazy"') &&
		stored.body.includes('The apparatus, with the tap on the left') &&
		/<img[^>]*inline-images[^>]*width="\d+"/.test(stored.body),
	(stored?.body ?? '').slice(-300)
);
await posted.screenshot({ path: 'e2e/screenshots/comment-input-kinds-posted.png' });

// ---- rich mode: clicking a drawing reopens it
await form.locator('.rich-editor__modes button', { hasText: 'Editor' }).click();
await form.locator('.rich-editor__host .ProseMirror').waitFor({ timeout: 60000 });
await form.locator('.ProseMirror').click();
await p.keyboard.type(`${MARKER} edit: `);
await stripRow.locator('button', { hasText: /^Chemistry$/ }).click();
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

// An ordinary picture is NOT a chemistry drawing: clicking it must do nothing at all, quietly.
await stripRow
	.locator('label', { hasText: 'Picture' })
	.locator('input[type=file]')
	.setInputFiles({ name: 'inert.png', mimeType: 'image/png', buffer: PNG });
await strip.locator('.insert-strip__thumb').waitFor({ timeout: 15000 });
await strip.locator('.insert-strip__actions .primary').click();
const richPic = form.locator('.ProseMirror img.inline-image');
await richPic.waitFor({ timeout: 30000 });
// A ProseMirror node drops every attribute it has not declared, and the picture still LOOKS right
// when it does — so this asserts the tag arrives whole, not merely that it arrives.
const richAttrs = await richPic.evaluate((e) => ({
	w: e.getAttribute('width'),
	h: e.getAttribute('height'),
	loading: e.getAttribute('loading')
}));
check(
	'the rich editor keeps the picture whole: class, intrinsic size and lazy loading all survive',
	!!richAttrs.w && !!richAttrs.h && richAttrs.loading === 'lazy',
	JSON.stringify(richAttrs)
);
const errorsBeforeClick = errors.length;
await richPic.click();
await settle(1200);
check(
	'clicking an ordinary picture in rich mode opens nothing and throws nothing',
	(await p.locator('.modal-panel').count()) === 0 && errors.length === errorsBeforeClick,
	`modals=${await p.locator('.modal-panel').count()} newErrors=${errors.length - errorsBeforeClick}`
);

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
	'with `chemistry` off, Chemistry leaves the strip while the other five stay',
	!labelsOff.includes('Chemistry') &&
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
