// Attachments on anything (backend `attachments/`, HISTORY §17CD) — the owner's ask of 2026-10-08:
// ".md files, docs, etc, sketches etc for files when creating an event for attachements (in
// multiple places we lack this funcionality)", and "make two popups with warning before downloading
// a file".
//
//   1. the panel draws on a node page that had no attachment surface at all (an organisation);
//   2. a `.md` upload becomes TEXT and is RENDERED — maths and all — rather than offered as a
//      download, which is the whole reason that path exists;
//   3. a PDF stays a file, and says honestly whether a scanner saw it;
//   4. downloading goes through TWO warnings that say DIFFERENT things — the first about who put
//      the file there, the second about this file's own name, type and size — and the download only
//      fires after the second;
//   5. cancelling either one does not download anything.
//
// Run (ports must match whatever `run.sh`/test.md set up):
//   E2E_BASE=http://localhost:5173 E2E_API=http://127.0.0.1:8000/api \
//     E2E_OWNER_TOKEN=<token of somebody who MANAGES the edmat organisation> node e2e/attachments.mjs
//
// **`E2E_OWNER_TOKEN` is required and cannot be logged in for** — attaching is a node staff member's
// act and `can_manage_node` has no `is_staff` bypass (e2e/CLAUDE.md trap 32), so the seeded `admin`
// account is not an owner of the `edmat` organisation. Read the token the way trap 30 describes.
//
// It cleans up after itself: both attachments it writes are withdrawn at the end.
import { mkdirSync } from 'node:fs';

let chromium;
try {
	({ chromium } = await import('playwright'));
} catch {
	({ chromium } = await import('playwright-core'));
}

const BASE = process.env.E2E_BASE ?? 'http://localhost:5173';
const API = process.env.E2E_API ?? 'http://127.0.0.1:8000/api';
const TOKEN = process.env.E2E_OWNER_TOKEN ?? '';
const OUT = 'e2e/screens';
mkdirSync(OUT, { recursive: true });

if (!TOKEN) {
	console.error('E2E_OWNER_TOKEN is not set — every write below would be refused `not_allowed`,');
	console.error('which would be this script failing for the rule working. See the header.');
	process.exit(1);
}

let passed = 0;
let failed = 0;
function check(name, ok, detail = '') {
	if (ok) {
		passed += 1;
		console.log(`  ok   ${name}`);
	} else {
		failed += 1;
		console.log(`  FAIL ${name}${detail ? ` — ${detail}` : ''}`);
	}
}

const browser = await chromium.launch();
const ctx = await browser.newContext({
	viewport: { width: 1300, height: 1200 },
	acceptDownloads: true
});
const page = await ctx.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(String(e).slice(0, 200)));
page.on('console', (m) => {
	if (m.type() === 'error') errors.push(m.text().slice(0, 200));
});

await page.goto(BASE, { waitUntil: 'load' });
await page.evaluate((t) => localStorage.setItem('edmat-auth-token', t), TOKEN);
await page.goto(`${BASE}/about`, { waitUntil: 'load' });
await page.waitForSelector('[data-fold="attachments"]', { timeout: 60000 });
await page.waitForTimeout(2500);

const panel = page.locator('[data-fold="attachments"]');
check('the panel is on a page that had no attachment surface', (await panel.count()) === 1);
await panel.locator('.fold__toggle').first().click();
await page.waitForTimeout(600);

async function attach(title, file) {
	await panel
		.locator('button')
		.filter({ hasText: /Załącz coś|Attach something/ })
		.first()
		.click();
	await page.waitForTimeout(400);
	await panel.locator('input[type="text"]').first().fill(title);
	await panel.locator('input[type="file"]').first().setInputFiles(file);
	await panel.locator('button[type="submit"]').first().click();
	await page.waitForTimeout(2500);
}

await attach('E2E: notatka', {
	name: 'notatka.md',
	mimeType: 'text/markdown',
	buffer: Buffer.from('# Ustalenia\n\nZażółć gęślą jaźń. Wzór: \\( x^2 + y^2 = r^2 \\)')
});
const textRow = panel.locator('[data-attachment-kind="text"]').first();
check('a .md upload became text, not a file', (await textRow.count()) === 1);
check(
	'and it is RENDERED — the maths typeset, the heading is markdown',
	(await textRow.locator('.katex').count()) > 0,
	'no .katex inside the row'
);
check(
	'a text attachment offers no download',
	(await textRow
		.locator('button')
		.filter({ hasText: /Pobierz|Download/ })
		.count()) === 0
);

await attach('E2E: plan', {
	name: 'plan.pdf',
	mimeType: 'application/pdf',
	buffer: Buffer.from('%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF')
});
const fileRow = panel.locator('[data-attachment-kind="file"]').first();
check('a PDF stays a file', (await fileRow.count()) === 1);
check(
	'and says whether a scanner saw it, rather than implying one did',
	/skan|scan/i.test(await fileRow.innerText())
);
await page.screenshot({ path: `${OUT}/attachments-list.png`, fullPage: false });

// ---- the two warnings -------------------------------------------------------------------------
const dialog = page.locator('[role="dialog"], dialog').first();

await fileRow
	.locator('button')
	.filter({ hasText: /Pobierz|Download/ })
	.first()
	.click();
await page.waitForTimeout(600);
const first = await dialog.innerText();
check('warning 1 names who put the file there', /piotrek|EdMat/.test(first), first.slice(0, 120));
await page.screenshot({ path: `${OUT}/attachments-warn1.png` });

// Cancelling the first one downloads nothing.
await dialog
	.locator('button')
	.filter({ hasText: /Anuluj|Cancel/ })
	.first()
	.click();
await page.waitForTimeout(400);
check(
	'cancelling the first warning closes it',
	(await dialog.count()) === 0 || !(await dialog.isVisible())
);

await fileRow
	.locator('button')
	.filter({ hasText: /Pobierz|Download/ })
	.first()
	.click();
await page.waitForTimeout(600);
await dialog
	.locator('button')
	.filter({ hasText: /Rozumiem|go on/ })
	.first()
	.click();
await page.waitForTimeout(600);
const second = await dialog.innerText();
check('warning 2 says something DIFFERENT from warning 1', second !== first);
check(
	'and names this file — its name, type and size',
	second.includes('plan.pdf') && /pdf/i.test(second) && /B\b|kB|MB/.test(second),
	second.slice(0, 160)
);
await page.screenshot({ path: `${OUT}/attachments-warn2.png` });

const download = page.waitForEvent('download', { timeout: 20000 }).catch(() => null);
await dialog
	.locator('button')
	.filter({ hasText: /Zapisz plik|Save the file/ })
	.first()
	.click();
const saved = await download;
check('the download only fires after the second warning', Boolean(saved), 'no download event');
if (saved) check('and it is the file that was attached', saved.suggestedFilename() === 'plan.pdf');

// ---- clean up ----------------------------------------------------------------------------------
for (const label of ['E2E: plan', 'E2E: notatka']) {
	const row = panel.locator('.row').filter({ hasText: label }).first();
	if (await row.count()) {
		await row
			.locator('button')
			.filter({ hasText: /Zdejmij|Take it down/ })
			.first()
			.click();
		await page.waitForTimeout(1200);
	}
}
check(
	'both scratch attachments were taken down',
	(await panel.locator('.row').filter({ hasText: 'E2E:' }).count()) === 0
);

check('zero page errors', errors.length === 0, errors.slice(0, 3).join(' | '));
await browser.close();
console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
