// Pictures on a piece of content, and applying to look after it (root CLAUDE.md §17AY).
//
// The two features interlock and the run is shaped around that: an ordinary reader adds pictures
// and CANNOT reorder them, applies to look after the material, is approved by staff, and can then
// reorder the very pictures they could not touch a moment earlier.
//
// Needs two scratch accounts and a published material — see test.md for the snippet that makes them.
// Run: E2E_BASE=http://localhost:5173 E2E_API=http://localhost:8000 node e2e/galleries-and-applications.mjs
import { writeFileSync } from 'node:fs';
let chromium;
try {
	({ chromium } = await import('playwright'));
} catch {
	({ chromium } = await import('playwright-core'));
}
const BASE = process.env.E2E_BASE ?? 'http://localhost:5173';
const API = process.env.E2E_API ?? 'http://localhost:8000';
const MATERIAL = process.env.E2E_MATERIAL ?? '1';
const ANNA = { user: 'gal-anna@edmat.example', pass: 'scratchpass123' };
const BOSS = { user: 'gal-boss@edmat.example', pass: 'scratchpass123' };

let pass = 0,
	fail = 0;
const errors = [];
const check = (l, ok, x = '') => {
	ok ? pass++ : fail++;
	console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${l}${ok ? '' : '  <- ' + x}`);
};
const browser = await chromium.launch(
	process.env.CHROME ? { executablePath: process.env.CHROME } : {}
);
const ctx = await browser.newContext({ viewport: { width: 1280, height: 950 } });
const page = await ctx.newPage();
page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
page.on('pageerror', (e) => errors.push(e.message));
const settle = (ms = 900) => page.waitForTimeout(ms);

// A real PNG, written to disk so the file input takes a genuine file rather than a synthesized one.
function pngFile(path, label) {
	// A minimal, valid PNG built by hand would be fragile; use a data URL decoded in the browser
	// instead is not possible for setInputFiles, so write real bytes: a 2x2 PNG scaled by the
	// backend is enough to prove the pipeline, but a bigger one proves the resize too.
	const width = 1200,
		height = 800;
	const zlib = require('node:zlib');
	const raw = Buffer.alloc((width * 3 + 1) * height);
	let o = 0;
	for (let y = 0; y < height; y++) {
		raw[o++] = 0;
		for (let x = 0; x < width; x++) {
			raw[o++] = (x + label * 60) % 256;
			raw[o++] = (y * 2) % 256;
			raw[o++] = 128;
		}
	}
	const crcTable = [];
	for (let n = 0; n < 256; n++) {
		let c = n;
		for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
		crcTable[n] = c >>> 0;
	}
	const crc = (buf) => {
		let c = 0xffffffff;
		for (const b of buf) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8);
		return (c ^ 0xffffffff) >>> 0;
	};
	const chunk = (type, data) => {
		const len = Buffer.alloc(4);
		len.writeUInt32BE(data.length);
		const td = Buffer.concat([Buffer.from(type, 'ascii'), data]);
		const c = Buffer.alloc(4);
		c.writeUInt32BE(crc(td));
		return Buffer.concat([len, td, c]);
	};
	const ihdr = Buffer.alloc(13);
	ihdr.writeUInt32BE(width, 0);
	ihdr.writeUInt32BE(height, 4);
	ihdr[8] = 8;
	ihdr[9] = 2;
	const png = Buffer.concat([
		Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
		chunk('IHDR', ihdr),
		chunk('IDAT', zlib.deflateSync(raw)),
		chunk('IEND', Buffer.alloc(0))
	]);
	writeFileSync(path, png);
	return path;
}
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);

const fileA = pngFile('/tmp/edmat-gal-a.png', 1);
const fileB = pngFile('/tmp/edmat-gal-b.png', 2);

async function signIn({ user, pass: password }) {
	const hydrated = page
		.waitForResponse((r) => /\/api\/auth\/providers\//.test(r.url()), { timeout: 20000 })
		.catch(() => null);
	await page.goto(`${BASE}/`, { waitUntil: 'load' });
	await settle(600);
	await page.evaluate(() => localStorage.clear());
	await page.goto(`${BASE}/login`, { waitUntil: 'load' });
	await hydrated;
	await settle(900);
	await page.locator('form input[autocomplete="username"]').fill(user);
	await page.locator('form input[type="password"]').fill(password);
	await page.locator('form button[type="submit"]').click();
	await page.waitForURL((u) => !u.pathname.includes('/login'), { timeout: 15000 });
	await settle(1200);
}

async function openMaterial() {
	for (let i = 0; i < 3; i++) {
		if (i === 0) await page.goto(`${BASE}/materials/${MATERIAL}`, { waitUntil: 'load' });
		else await page.reload({ waitUntil: 'load' });
		await settle(1600);
		if (
			await page
				.locator('.gallery')
				.first()
				.isVisible()
				.catch(() => false)
		)
			return true;
	}
	return false;
}

console.log('\n— a reader adds pictures —');
await signIn(ANNA);
check('the gallery section is on the material page', await openMaterial());
check(
	'and it invites a signed-in reader to add one',
	await page.locator('.gallery__add-label').isVisible()
);

await page.locator('#gallery-file-material-' + MATERIAL).setInputFiles([fileA]);
await page.waitForFunction(() => document.querySelectorAll('.gallery__thumb').length >= 1, {
	timeout: 20000
});
await settle(800);
check('the picture appears in the grid', (await page.locator('.gallery__thumb').count()) >= 1);

const loaded = await page
	.locator('.gallery__thumb img')
	.first()
	.evaluate((el) => el.complete && el.naturalWidth > 0 && el.naturalWidth);
check('and it genuinely loaded', Boolean(loaded), `naturalWidth ${loaded}`);

await page.locator('#gallery-file-material-' + MATERIAL).setInputFiles([fileB]);
await page.waitForFunction(() => document.querySelectorAll('.gallery__thumb').length >= 2, {
	timeout: 20000
});
await settle(700);
check('a second one too', (await page.locator('.gallery__thumb').count()) >= 2);

console.log('\n— the picture is re-encoded, not the bytes that were sent —');
const stored = await page.evaluate(
	async ({ api, material }) => {
		const r = await fetch(
			`${api}/api/galleries/for-target/?target_type=material&target_id=${material}`
		);
		const g = await r.json();
		return g.images.map((i) => ({ url: i.url, width: i.width, height: i.height }));
	},
	{ api: API, material: MATERIAL }
);
check(
	'stored as webp',
	stored.every((i) => i.url.endsWith('.webp')),
	JSON.stringify(stored[0])
);
check(
	'and bounded to 2000px on the long edge, aspect kept',
	stored.every((i) => i.width <= 2000 && i.height <= 2000 && i.width > i.height),
	JSON.stringify(stored[0])
);

console.log('\n— adding is open, arranging is not —');
check(
	'the uploader can caption their own picture',
	(await page.locator('.gallery__actions button', { hasText: 'Caption' }).count()) >= 1
);
check(
	'but is given no way to reorder the gallery',
	(await page.locator('.gallery__actions button[aria-label="Move earlier"]').count()) === 0
);

console.log('\n— so they apply to look after it —');
await page.locator('.govapp__trigger').click();
await page.locator('[role="dialog"] textarea').waitFor({ timeout: 10000 });
check('the application form explains the job', await page.locator('[role="dialog"]').isVisible());
check(
	'and says there is no way to be read sooner',
	(await page.locator('[role="dialog"]').innerText()).includes('no way to be read sooner')
);
await page
	.locator('[role="dialog"] textarea')
	.fill('I photographed this handout and I would like to keep its pages in the right order.');
await page.locator('[role="dialog"] button[type="submit"]').click();
await settle(1500);
check(
	'the application is queued and its position shown',
	(await page.locator('.govapp__state').innerText()).length > 0,
	await page
		.locator('.govapp')
		.innerText()
		.catch(() => '')
);

console.log('\n— staff read the queue and approve —');
await signIn(BOSS);
await page.goto(`${BASE}/moderation`, { waitUntil: 'load' });
await page.locator('#mod-tab-applications').waitFor({ timeout: 20000 });
await settle(900);
await page.locator('#mod-tab-applications').click();
await settle(900);
const queueText = await page.locator('.applications-panel').innerText();
check(
	'the application is in the queue',
	queueText.includes('photographed this handout'),
	queueText.slice(0, 160)
);
check('with the applicant named', queueText.includes('Gal Anna'), queueText.slice(0, 160));

// Declining without a reason is refused — checked before approving, since approving ends the row.
await page.locator('.application-row__actions button', { hasText: 'Decline' }).first().click();
await settle(600);
check(
	'declining with no reason is refused in words',
	(
		await page
			.locator('.applications-panel .error')
			.innerText()
			.catch(() => '')
	).length > 0
);

await page.locator('.application-row__actions button', { hasText: 'Approve' }).first().click();
await settle(1500);
check(
	'approving takes it off the queue',
	(await page.locator('.application-row').count()) === 0,
	String(await page.locator('.application-row').count())
);

console.log('\n— and now she can arrange them —');
await signIn(ANNA);
await openMaterial();
check(
	'she is told she looks after this now',
	(await page.locator('.govapp__state').innerText()).length > 0
);
const before = await page
	.locator('.gallery__thumb img')
	.evaluateAll((els) => els.map((e) => e.src));
check(
	'the reorder buttons are there this time',
	(await page.locator('.gallery__actions button[aria-label="Move later"]').count()) >= 1
);
await page.locator('.gallery__actions button[aria-label="Move later"]').first().click();
await settle(1500);
const after = await page.locator('.gallery__thumb img').evaluateAll((els) => els.map((e) => e.src));
check('and the order really changed', before[0] !== after[0], `${before[0]} -> ${after[0]}`);

await page.reload({ waitUntil: 'load' });
await settle(1800);
const afterReload = await page
	.locator('.gallery__thumb img')
	.evaluateAll((els) => els.map((e) => e.src));
check('the new order survived a reload', afterReload[0] === after[0]);

console.log('\n— the lightbox —');
await page.locator('.gallery__thumb').first().click();
await page.locator('.lightbox').waitFor({ timeout: 10000 });
check('opens', await page.locator('.lightbox__image').isVisible());
await page.locator('.lightbox__nav button', { hasText: 'Next' }).click();
await settle(500);
check(
	'and steps to the next picture',
	(await page.locator('.lightbox__count').innerText()).startsWith('2')
);
await page.keyboard.press('Escape');
await settle(400);
check('Escape closes it', (await page.locator('.lightbox').count()) === 0);

console.log('\n— what a signed-out reader sees —');
await page.goto(`${BASE}/`, { waitUntil: 'load' });
await settle(500);
await page.evaluate(() => localStorage.clear());
await openMaterial();
check('the pictures are public', (await page.locator('.gallery__thumb').count()) >= 2);
check('but there is no upload control', (await page.locator('.gallery__add-label').count()) === 0);
check('and no way to apply', (await page.locator('.govapp__trigger').count()) === 0);

console.log(`\n${pass} passed, ${fail} failed, ${errors.length} console/page errors`);
if (errors.length) console.log(errors.slice(0, 8).join('\n'));
await page.screenshot({ path: 'e2e/screenshots/galleries.png', fullPage: false });
await browser.close();
process.exit(fail || errors.length ? 1 : 0);
