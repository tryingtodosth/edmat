// Every notification type the backend really sends must render as its own sentence.
//
// `mapNotification` falls back to 'commentReply' for a type it does not recognise, so an unmapped
// type does not crash or render blank — it renders as somebody replying to a comment that does not
// exist. That is invisible to a typecheck and to every backend test, and it was live for seven
// types. This is the check that would have caught it.
import { chromium } from 'playwright-core';

const WEB = process.env.E2E_WEB || 'http://127.0.0.1:5173';
const API = process.env.E2E_API || 'http://127.0.0.1:8001/api';

let pass = 0;
let fail = 0;
const problems = [];
const check = (name, ok, detail = '') => {
	if (ok) {
		pass++;
		console.log(`  ok   ${name}`);
	} else {
		fail++;
		problems.push(`${name} ${detail}`);
		console.log(`  FAIL ${name} ${detail}`);
	}
};

const res = await fetch(`${API}/auth/login/`, {
	method: 'POST',
	headers: { 'Content-Type': 'application/json' },
	body: JSON.stringify({ username: 'zzz-notif-check@example.test', password: 'verify-pw-123' })
});
if (!res.ok) throw new Error(`login failed: ${res.status}`);
const token = (await res.json()).token;

const browser = await chromium.launch({
	executablePath: process.env.CHROME_PATH || undefined,
	args: ['--no-sandbox']
});

try {
	const ctx = await browser.newContext();
	const page = await ctx.newPage();
	const errors = [];
	page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
	page.on('pageerror', (e) => errors.push(String(e)));

	await page.goto(WEB);
	await page.evaluate((t) => localStorage.setItem('edmat-auth-token', t), token);
	await page.goto(`${WEB}/notifications`, { waitUntil: 'networkidle' });
	await page.waitForTimeout(1500);

	const body = await page.locator('body').innerText();

	// The seven rows exist at all.
	const rows = await page.locator('.notification-card, [class*="notification"]').count();
	check('the inbox rendered rows', rows > 0, `${rows} elements`);

	// The bug: every unmapped type collapsed onto this one sentence.
	const replyMatches = (body.match(/replied to your comment/gi) || []).length;
	check(
		'none of them renders as a comment reply',
		replyMatches === 0,
		`${replyMatches} occurrences — an unmapped type fell back to commentReply`
	);

	for (const [label, pattern] of [
		['contribution offered', /offered something to/i],
		['contribution accepted', /contribution to .* was accepted/i],
		['contribution not accepted', /contribution to .* was not accepted/i],
		['added to a course team', /part of the team running/i],
		['invite link used', /joined .* with your invite link/i],
		['material published', /material .* was published/i],
		['material not published', /material .* was not published/i]
	]) {
		check(`"${label}" renders its own sentence`, pattern.test(body), '');
	}

	check('no unresolved message key leaked', !/notification_[a-zA-Z]/.test(body), '');
	check(
		'no console or page errors',
		errors.filter((e) => !/favicon/i.test(e)).length === 0,
		errors.slice(0, 2).join(' || ')
	);
} finally {
	await browser.close();
}

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) {
	console.log('problems:\n  ' + problems.join('\n  '));
	process.exit(1);
}
