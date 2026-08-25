// First Contentful Paint on the PRODUCTION build, on localhost and on a throttled link (150 ms
// latency, 1.6 Mbit/s down). Run against a static serve of `build/` with a 200.html fallback:
//   npm run build
//   python3 -m http.server is NOT enough (no fallback) — use any static server that falls back to
//   200.html, e.g. `npx sirv build --single --port 5190`, then
//   E2E_PROD=http://127.0.0.1:5190 node e2e/fcp.mjs
//
// What it pins: a prerendered page paints from its HTML; a fallback (SPA) route paints the boot
// shell in app.html from the HTML too, long before the bundle has booted. Before the shell, FCP on
// a fallback route WAS the hydration time (5.3 s on the throttled link). The localhost numbers are
// only a sanity floor — the bundle arrives before the browser's first frame there.
let chromium;
try {
	({ chromium } = await import('playwright'));
} catch {
	({ chromium } = await import('playwright-core'));
}
const BASE = process.env.E2E_PROD ?? 'http://127.0.0.1:5190';
let pass = 0,
	fail = 0;
const check = (l, ok, x = '') => {
	if (ok) pass++;
	else fail++;
	console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${l} ${ok ? '' : x}`);
};
const browser = await chromium.launch(
	process.env.CHROME ? { executablePath: process.env.CHROME } : {}
);

async function measure(path, throttle) {
	const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
	const page = await ctx.newPage();
	const cdp = await ctx.newCDPSession(page);
	await cdp.send('Network.enable');
	if (throttle) {
		await cdp.send('Network.emulateNetworkConditions', {
			offline: false,
			latency: 150,
			downloadThroughput: (1.6 * 1024 * 1024) / 8,
			uploadThroughput: (750 * 1024) / 8
		});
	}
	const t0 = Date.now();
	await page.goto(`${BASE}${path}`, { waitUntil: 'commit' });
	await page.locator('.site-header').first().waitFor({ timeout: 60000 });
	const hydrated = Date.now() - t0;
	// The paint entry is reported asynchronously; poll for it rather than reading too early.
	let fcp = -1;
	for (let i = 0; i < 20 && fcp < 0; i++) {
		fcp = await page.evaluate(() =>
			Math.round(
				performance.getEntriesByType('paint').find((e) => e.name === 'first-contentful-paint')
					?.startTime ?? -1
			)
		);
		if (fcp < 0) await page.waitForTimeout(200);
	}
	const shellHidden = await page.evaluate(() => {
		const s = document.querySelector('.boot-shell');
		return !s || getComputedStyle(s).display === 'none';
	});
	await ctx.close();
	return { fcp, hydrated, shellHidden };
}

// Prerendered routes carry their real header in the HTML, so "app header on screen" there is
// HTML arrival, not hydration — the meaningful check is that the header is there with JS off.
// Fallback routes are the ones where the boot shell has to paint long before the bundle boots.
const PRERENDERED = ['/materials', '/'];
const FALLBACK = ['/materials/1', '/exercises/51'];
for (const path of [...FALLBACK, ...PRERENDERED]) {
	const local = await measure(path, false);
	const slow = await measure(path, true);
	console.log(
		`${path.padEnd(14)} localhost FCP ${String(local.fcp).padStart(5)} ms / app ${String(local.hydrated).padStart(5)} ms   throttled FCP ${String(slow.fcp).padStart(5)} ms / app ${String(slow.hydrated).padStart(5)} ms`
	);
	if (FALLBACK.includes(path)) {
		check(
			`${path}: the boot shell paints well before the app is up on a slow link`,
			slow.fcp > 0 && slow.fcp < slow.hydrated * 0.5,
			`fcp ${slow.fcp} hydrated ${slow.hydrated}`
		);
	} else {
		check(`${path}: paints on a slow link`, slow.fcp > 0, `fcp ${slow.fcp}`);
	}
	check(
		`${path}: the boot shell is gone once the app is up`,
		local.shellHidden && slow.shellHidden
	);
}
const nojsCtx = await browser.newContext({
	viewport: { width: 1280, height: 300 },
	javaScriptEnabled: false
});
for (const path of PRERENDERED) {
	const p = await nojsCtx.newPage();
	await p.goto(`${BASE}${path}`, { waitUntil: 'load' });
	check(
		`${path}: with JS off the real header is already in the HTML`,
		await p.locator('.site-header').first().isVisible()
	);
	await p.close();
}
await nojsCtx.close();

// The CSS-only paint of a fallback route: exactly what the eye sees before any JS runs.
const ctx = await browser.newContext({
	viewport: { width: 1280, height: 300 },
	javaScriptEnabled: false
});
const page = await ctx.newPage();
await page.goto(`${BASE}/materials/1`, { waitUntil: 'load' });
check(
	'with JS off, a fallback route still shows the brand bar',
	await page.locator('.boot-shell__brand').isVisible()
);
await browser.close();
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
