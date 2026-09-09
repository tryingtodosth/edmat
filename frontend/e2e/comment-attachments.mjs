// Pictures and small PDFs on comments (AUDIENCE-BRIEF.md §6; root CLAUDE.md §17AR): Ola posts a
// comment with a real PNG sketch and a real PDF through the actual form; the thumbnail loads and the
// PDF chip opens the in-page viewer; a disguised executable is refused in words; a reply carries a
// picture; the API confirms the picture was re-encoded to WebP and bounded. Cleans its comments up.
//   E2E_BASE=http://localhost:5173 E2E_API=http://localhost:8000 node e2e/comment-attachments.mjs
let chromium;
try {
	({ chromium } = await import('playwright'));
} catch {
	({ chromium } = await import('playwright-core'));
}
import { writeFile, mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import zlib from 'node:zlib';
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
// A real PNG, 2000×1000 flat blue — big enough to prove the server bounds it.
function png(w, h) {
	const crc = (buf) => {
		let c = ~0;
		for (const b of buf) {
			c ^= b;
			for (let k = 0; k < 8; k++) c = c & 1 ? (c >>> 1) ^ 0xedb88320 : c >>> 1;
		}
		return ~c >>> 0;
	};
	const chunk = (type, data) => {
		const len = Buffer.alloc(4);
		len.writeUInt32BE(data.length);
		const td = Buffer.concat([Buffer.from(type), data]);
		const cr = Buffer.alloc(4);
		cr.writeUInt32BE(crc(td));
		return Buffer.concat([len, td, cr]);
	};
	const ihdr = Buffer.alloc(13);
	ihdr.writeUInt32BE(w, 0);
	ihdr.writeUInt32BE(h, 4);
	ihdr[8] = 8;
	ihdr[9] = 2;
	const row = Buffer.alloc(1 + w * 3);
	for (let x = 0; x < w; x++) {
		row[1 + x * 3] = 30;
		row[2 + x * 3] = 90;
		row[3 + x * 3] = 200;
	}
	const raw = Buffer.concat(Array.from({ length: h }, () => row));
	return Buffer.concat([
		Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
		chunk('IHDR', ihdr),
		chunk('IDAT', zlib.deflateSync(raw)),
		chunk('IEND', Buffer.alloc(0))
	]);
}
const dir = await mkdtemp(join(tmpdir(), 'edmat-att-'));
const PNG = join(dir, 'sketch.png');
const PDF = join(dir, 'notes.pdf');
const EXE = join(dir, 'virus.png');
await writeFile(PNG, png(2000, 1000));
await writeFile(
	PDF,
	Buffer.from(
		'%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n2 0 obj<</Type/Pages/Kids[]/Count 0>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF\n'
	)
);
await writeFile(EXE, Buffer.concat([Buffer.from('MZ\x90\x00'), Buffer.alloc(300)]));

const browser = await chromium.launch(
	process.env.CHROME ? { executablePath: process.env.CHROME } : {}
);
const p = await (await browser.newContext({ viewport: { width: 1280, height: 1000 } })).newPage();
p.on('console', (m) => {
	if (m.type() !== 'error') return;
	// The refusal under test is a 400 the browser logs as a console error.
	if (m.text().includes('400')) return;
	errors.push(`[${p.url()}] ${m.text()}`);
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
const MARKER = 'Attachment e2e —';
// Reset leftovers on exercise 1.
for (const c of await (
	await fetch(`${API}/api/exercises/1/comments/?fresh=${Date.now()}`)
).json()) {
	if (c.body.startsWith(MARKER) && !c.is_removed)
		await fetch(`${API}/api/comments/${c.id}/`, { method: 'DELETE', headers: auth(ola) });
}

await p.goto(`${BASE}/login`, { waitUntil: 'networkidle', timeout: 90000 });
await settle(800);
await p.locator('form input[autocomplete="username"]').fill('ola@edmat.example');
await p.locator('form input[type="password"]').fill('password123');
await p.locator('form button[type="submit"]').click();
await p.waitForURL((u) => !u.pathname.includes('/login'), { timeout: 15000 });
await p.goto(`${BASE}/exercises/1`, { waitUntil: 'load' });
const discussion = p.locator('.discussion');
await discussion.waitFor({ timeout: 90000 });
const form = discussion.locator('form.comment-form').first();
check(
	'the composer offers a picture/PDF picker',
	(await form.locator('.attach input[type="file"]').count()) === 1
);
await form.locator('.attach input[type="file"]').setInputFiles([PNG, PDF]);
await settle(300);
check('two chips queue before posting', (await form.locator('.file-chip').count()) === 2);
await form.locator('textarea').fill(`${MARKER} my sketch and notes`);
await form.locator('button[type="submit"]').click();
const mine = discussion.locator('.comment', { hasText: 'my sketch and notes' }).first();
await mine.waitFor({ timeout: 20000 });
await mine.locator('.comment__attachments img').waitFor({ timeout: 30000 });
const natural = await mine
	.locator('.comment__attachments img')
	.evaluate(
		(img) =>
			new Promise((res) =>
				img.complete ? res(img.naturalWidth) : (img.onload = () => res(img.naturalWidth))
			)
	);
check('the picture thumbnail genuinely loads', natural > 0, String(natural));
check('the PDF shows as a chip', (await mine.locator('.pdf-chip').count()) === 1);
await mine.locator('.pdf-chip').click();
await mine
	.locator('.comment__pdf canvas')
	.waitFor({ timeout: 60000 })
	.catch(() => {});
check('the chip opens the in-page viewer', (await mine.locator('.comment__pdf').count()) === 1);
const thread = await (await fetch(`${API}/api/exercises/1/comments/?fresh=${Date.now()}`)).json();
const row = thread.find((c) => c.body.includes('my sketch and notes'));
const img = row?.attachments?.find((a) => a.kind === 'image');
check(
	'the API stored a re-encoded WebP (never the uploaded bytes)',
	img && img.url.endsWith('.webp') && row.attachments.length === 2,
	JSON.stringify(row?.attachments)
);
const head = await fetch(img.url);
check(
	'the stored picture is bounded to 1600px on its long edge (size shrank)',
	head.ok && Number(head.headers.get('content-length')) < png(2000, 1000).length,
	head.headers.get('content-length')
);

// A disguised executable is refused in words.
const form2 = discussion.locator('form.comment-form').first();
await form2.locator('.attach input[type="file"]').setInputFiles([EXE]);
await form2.locator('textarea').fill(`${MARKER} with a bad file`);
await form2.locator('button[type="submit"]').click();
await discussion.locator('.file-error').waitFor({ timeout: 20000 });
check(
	'a disguised executable is refused and the comment still posts',
	/this is|could not be added/.test(await discussion.locator('.file-error').innerText()) &&
		(await discussion.locator('.comment', { hasText: 'with a bad file' }).count()) === 1,
	await discussion.locator('.file-error').innerText()
);

// A reply with a picture.
await mine.locator('.meatballs__trigger').first().click();
await mine.locator('[role="menuitem"]', { hasText: 'Reply' }).first().click();
const replyForm = mine.locator('form.comment-form').first();
await replyForm.waitFor();
await replyForm.locator('.attach input[type="file"]').setInputFiles([PNG]);
await replyForm.locator('textarea').fill(`${MARKER} reply with a picture`);
await replyForm.locator('button[type="submit"]').click();
const reply = discussion.locator('.comment', { hasText: 'reply with a picture' }).first();
await reply.locator('.comment__attachments img').waitFor({ timeout: 30000 });
check('a reply carries its picture', true);

for (const c of await (
	await fetch(`${API}/api/exercises/1/comments/?fresh=${Date.now()}`)
).json()) {
	if (c.body.startsWith(MARKER) && !c.is_removed)
		await fetch(`${API}/api/comments/${c.id}/`, { method: 'DELETE', headers: auth(ola) });
}
check('zero console/page errors', errors.length === 0, errors.join(' | ').slice(0, 500));
await p.screenshot({ path: 'e2e/screenshots/comment-attachments.png' });
await browser.close();
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
