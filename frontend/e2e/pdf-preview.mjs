// The in-browser PDF preview (root CLAUDE.md §17AJ): the collapsed Preview section on a
// material's page, PDF.js actually painting real page pixels onto the canvas (worker + media
// fetch included — the parts only a browser can prove), paging, and zoom. Signs nobody in.
//   E2E_BASE=http://localhost:5173 E2E_MATERIAL=1 node e2e/pdf-preview.mjs
let chromium;
try {
	({ chromium } = await import('playwright'));
} catch {
	({ chromium } = await import('playwright-core'));
}
const BASE = process.env.E2E_BASE ?? 'http://localhost:5173';
const MATERIAL = process.env.E2E_MATERIAL ?? '1'; // a hosted-PDF material (corpus skrypt)
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
const page = await (await browser.newContext({ viewport: { width: 1200, height: 950 } })).newPage();
page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
page.on('pageerror', (e) => errors.push(e.message));
const settle = (ms) => page.waitForTimeout(ms);

await page.goto(`${BASE}/materials/${MATERIAL}`, { waitUntil: 'load' });
const toggle = page.getByRole('button', { name: 'Show preview' });
await toggle.waitFor({ timeout: 20000 });
check('a PDF material offers the collapsed Preview section', (await toggle.count()) === 1);
check(
	'nothing of the viewer is mounted before asking',
	(await page.locator('.pdf-viewer').count()) === 0
);

await toggle.click();
// The click is what loads the pdf.js chunk + worker + the PDF itself — generous wait.
await page.locator('.pdf-viewer__controls').waitFor({ timeout: 30000 });
await settle(800);
const pageLabel = await page.locator('.pdf-viewer__page').textContent();
const total = Number((pageLabel?.match(/of (\d+)|z (\d+)/) ?? []).filter(Boolean).slice(1)[0] ?? 0);
check(`the document opens with a real page count (${pageLabel?.trim()})`, total >= 1);

// The canvas must hold REAL rendered pixels, not just exist — a worker/CORS failure leaves a
// zero-size or blank canvas while everything around it looks fine.
// OPAQUE dark pixels only — an unpainted canvas is transparent black, and a probe that reads
// red<200 alone counts every transparent pixel as "dark" and passes vacuously (it did: the
// first version of this check was green while the canvas sat at its default 300×150, unpainted;
// the screenshot is what told the truth).
const painted = await page.evaluate(() => {
	const canvas = document.querySelector('.pdf-viewer canvas');
	if (!canvas || canvas.width < 400 || canvas.height < 400) return 'small-canvas';
	const ctx = canvas.getContext('2d');
	const data = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
	let dark = 0,
		opaque = 0;
	for (let i = 0; i < data.length; i += 40) {
		if (data[i + 3] > 200) {
			opaque++;
			if (data[i] < 200) dark++;
		}
	}
	return opaque > 1000 && dark > 50 ? 'painted' : 'blank';
});
check('the first page is genuinely painted (non-blank pixels)', painted === 'painted', painted);

if (total > 1) {
	await page.getByRole('button', { name: 'Next page' }).click();
	await settle(900);
	const after = await page.locator('.pdf-viewer__page').textContent();
	check('paging advances', /2/.test(after ?? ''), after ?? '');
	await page.getByRole('button', { name: 'Previous page' }).click();
	await settle(600);
} else {
	console.log('  SKIP paging (single-page document)');
}

const widthBefore = await page.evaluate(
	() => document.querySelector('.pdf-viewer canvas')?.getBoundingClientRect().width ?? 0
);
await page.getByRole('button', { name: 'Zoom in' }).click();
await settle(900);
const widthAfter = await page.evaluate(
	() => document.querySelector('.pdf-viewer canvas')?.getBoundingClientRect().width ?? 0
);
check(
	'zoom actually grows the rendered page',
	widthAfter > widthBefore,
	`${widthBefore} -> ${widthAfter}`
);

await page.getByRole('button', { name: 'Hide preview' }).click();
await settle(400);
check('hiding unmounts the viewer', (await page.locator('.pdf-viewer').count()) === 0);

await page.screenshot({
	path: '/tmp/claude-1000/-home-alojzy-Wymiana-VM-edmat/10dab17e-3322-48be-be96-b9d846a1c0f9/scratchpad/shot-pdf-hidden.png'
});

console.log(`\n${pass} passed, ${fail} failed`);
if (errors.length) {
	console.log('console/page errors:');
	for (const e of errors) console.log('  ' + e);
}
await browser.close();
process.exit(fail || errors.length ? 1 : 0);
