// `/work` speaks the reader's language (2026-10-15): every row's status is drawn from a CODE plus,
// for the rows that stand for several things, an int `count` — never printed verbatim.
//
// Run: E2E_BASE=http://localhost:5173 E2E_API=http://localhost:8000 node e2e/work-labels.mjs
//      (E2E_TOKEN=<kasia's token> skips the sign-in, which is throttled — e2e/CLAUDE.md trap 30)
//
// What it checks, in BOTH interface languages (Polish is the default; English through
// `englishContext`, trap 24), against kasia's real dashboard:
//   - the API sends codes and counts, never a sentence (`'3 due'` was the old shape);
//   - every status pill on the page is the catalogue's own words for that (kind, status) — the
//     expected text is computed from `messages/<locale>.json` here, plural forms included, through
//     `Intl.PluralRules`, the same CLDR rules Paraglide's `plural` selector uses — so the Polish
//     "1 wersja / 3 karty / 5 kart" is checked, not just "something non-empty";
//   - an unknown code (injected by intercepting `/api/work/`) reads "Status unknown", never raw;
//   - no horizontal scroll at 390.
// Screenshots: e2e/screens/work-labels-{pl,en}-{1280,390}.png — look at them.
import { readFileSync } from 'node:fs';
import { englishContext } from './english.mjs';

let chromium;
try {
	({ chromium } = await import('playwright-core'));
} catch {
	console.error('playwright-core is not installed');
	process.exit(1);
}

const BASE = process.env.E2E_BASE ?? 'http://localhost:5173';
const API = process.env.E2E_API ?? 'http://localhost:8000';
const CATALOGUE = {
	en: JSON.parse(readFileSync(new URL('../messages/en.json', import.meta.url), 'utf8')),
	pl: JSON.parse(readFileSync(new URL('../messages/pl.json', import.meta.url), 'utf8'))
};

let pass = 0,
	fail = 0;
const errors = [];
const check = (label, ok, detail = '') => {
	if (ok) pass++;
	else fail++;
	console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${label}${ok ? '' : '  <- ' + detail}`);
};

// The message key for each (kind, status) — the words `labels.ts: workStatusLabel` draws. Kept
// here as data rather than imported, because this script reads the catalogues, not the bundle.
const KEYS = {
	'event:hosting': 'workStatus_event_hosting',
	'event:staffing': 'workStatus_event_staffing',
	'event:going': 'workStatus_event_going',
	'course_request:pending': 'workStatus_courseRequest_pending',
	'proposal:pending': 'workStatus_proposal_pending',
	'shift:offered': 'shifts_status_offered',
	'shift:claimed': 'shifts_status_claimed',
	'shift:confirmed': 'shifts_status_confirmed',
	'booking:requested': 'workStatus_booking_requested',
	'booking:confirmed': 'booking_status_confirmed',
	'task:todo': 'tasks_status_todo',
	'task:in_progress': 'tasks_status_inProgress',
	'task:review': 'tasks_status_review',
	'need_application:pending': 'workStatus_needApplication_pending',
	'need_decision:pending': 'workStatus_needDecision_pending',
	'plan_step:pending': 'workStatus_planStep_pending',
	'plan_step:in_progress': 'plans_stepStatus_inProgress',
	'plan_suggestion:pending': 'workStatus_planSuggestion_pending',
	'poll:open': 'workStatus_poll_open',
	'cards_due:due': 'workStatus_cardsDue_due',
	'organization:sole_owner': 'workStatus_organization_soleOwner',
	'contest_registration:requested': 'workStatus_contestRegistration_requested',
	'contest_registration:accepted': 'workStatus_contestRegistration_accepted',
	'contest_stage:open': 'workStatus_contestStage_open',
	'contest_judging:waiting': 'workStatus_contestJudging_waiting',
	'contest_complaint:open': 'workStatus_contestComplaint_open'
};

/** The catalogue's words for one key, with `{count}` filled and the plural variant chosen. */
function words(locale, key, count) {
	const entry = CATALOGUE[locale][key];
	if (typeof entry === 'string') return entry;
	const match = entry?.[0]?.match ?? {};
	const category = new Intl.PluralRules(locale).select(count);
	const pattern = match[`countPlural=${category}`] ?? match['countPlural=*'];
	return pattern.replaceAll('{count}', String(count));
}

const token =
	process.env.E2E_TOKEN ??
	(
		await (
			await fetch(`${API}/api/auth/login/`, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ username: 'kasia@edmat.example', password: 'password123' })
			})
		).json()
	).token;

console.log('\n== the API sends codes and counts ==');
const dashboard = await (
	await fetch(`${API}/api/work/`, { headers: { Authorization: `Token ${token}` } })
).json();
const items = dashboard.sections.flatMap((s) => s.items);
const kinds = new Set(items.map((i) => i.kind));
check(
	`kasia has rows of several kinds (${[...kinds].join(', ')})`,
	kinds.size >= 3,
	`${kinds.size}`
);
check(
	'every row has a declared code — no sentence, no space, no digit',
	items.every((i) => KEYS[`${i.kind}:${i.status}`] && /^[a-z_]+$/.test(i.status)),
	items.map((i) => `${i.kind}:${i.status}`).join(' ')
);
// `providers.py: COUNTED_KINDS` / `labels.ts: WORK_COUNTED_KINDS`.
const COUNTED = new Set([
	'course_request',
	'proposal',
	'need_decision',
	'cards_due',
	'contest_judging'
]);
check(
	'a count is an int exactly where the row stands for several things',
	items.every((i) =>
		COUNTED.has(i.kind) ? Number.isInteger(i.count) && i.count >= 1 : i.count === null
	),
	items.map((i) => `${i.kind}:${i.count}`).join(' ')
);
const counted = items.filter((i) => i.count !== null);
check('at least one counted row is on the page to test plurals with', counted.length >= 1);

const browser = await chromium.launch();

async function open(locale, width, { inject = false } = {}) {
	const options = { viewport: { width, height: 1000 } };
	const ctx =
		locale === 'en'
			? await englishContext(browser, BASE, options)
			: await browser.newContext(options);
	await ctx.addInitScript((t) => localStorage.setItem('edmat-auth-token', t), token);
	const page = await ctx.newPage();
	page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
	page.on('console', (m) => {
		if (m.type() === 'error') errors.push(`console: ${m.text()}`);
	});
	if (inject) {
		// Two rows the frontend has no words for: a code nobody declared, and a counted kind that
		// arrived without its count. Both must read "Status unknown" — never the raw code.
		await page.route('**/api/work/', async (route) => {
			const response = await route.fetch();
			const body = await response.json();
			const base = { title: '', url: '/work', due_at: null, urgency: 0, node: null, count: null };
			body.sections.unshift({
				// Its own section key: `/work` keys sections by it, and a second `task` is a duplicate key.
				key: 'injected',
				items: [
					{ ...base, kind: 'task', title: 'Injected: unknown code', status: 'blocked_forever' },
					{ ...base, kind: 'cards_due', title: 'Injected: no count', status: 'due' }
				]
			});
			await route.fulfill({ response, json: body });
		});
	}
	const loaded = page.waitForResponse((r) => r.url().includes('/api/work/'));
	await page.goto(`${BASE}/work`, { waitUntil: 'load' });
	await loaded;
	await page.waitForSelector('.item-status', { timeout: 60000 });
	await page.waitForTimeout(500);
	return { ctx, page };
}

for (const locale of ['pl', 'en']) {
	console.log(`\n== /work in ${locale} ==`);
	const { ctx, page } = await open(locale, 1280);
	const drawn = await page.locator('.item-card').evaluateAll((cards) =>
		cards.map((c) => ({
			kind: c.dataset.kind,
			title: c.querySelector('.item-title')?.textContent?.trim() ?? '',
			code: c.querySelector('.item-status')?.dataset.status ?? '',
			text: c.querySelector('.item-status')?.textContent?.trim() ?? ''
		}))
	);
	check(`every row is drawn (${items.length})`, drawn.length === items.length, `${drawn.length}`);
	const wrong = [];
	for (const item of items) {
		const row = drawn.find((d) => d.kind === item.kind && d.title === item.title.trim());
		const expected = words(locale, KEYS[`${item.kind}:${item.status}`], item.count ?? 0);
		if (!row || row.text !== expected)
			wrong.push(`${item.kind}:${item.status} "${row?.text}" ≠ "${expected}"`);
	}
	check(
		'each status is the catalogue’s words for its (kind, code, count)',
		wrong.length === 0,
		wrong.join(' | ')
	);
	check(
		'no pill prints a raw code',
		drawn.every((d) => d.text !== d.code && !/_/.test(d.text)),
		drawn.map((d) => d.text).join(' | ')
	);
	for (const item of counted) {
		const row = drawn.find((d) => d.kind === item.kind && d.title === item.title.trim());
		console.log(`    ${item.kind} ×${item.count}: "${row?.text}"`);
	}
	if (locale === 'pl') {
		check(
			'and none of it is the English catalogue',
			drawn.every(
				(d) =>
					!Object.values(KEYS).some(
						(k) => words('en', k, 3) === d.text && words('pl', k, 3) !== d.text
					)
			),
			drawn.map((d) => d.text).join(' | ')
		);
	}
	await page.screenshot({ path: `e2e/screens/work-labels-${locale}-1280.png`, fullPage: true });
	await ctx.close();

	const phone = await open(locale, 390);
	const scroll = await phone.page.evaluate(() => document.documentElement.scrollWidth);
	check(`no horizontal scroll at 390 (${scroll})`, scroll <= 390, `${scroll}`);
	await phone.page.screenshot({
		path: `e2e/screens/work-labels-${locale}-390.png`,
		fullPage: true
	});
	await phone.ctx.close();

	const injected = await open(locale, 1280, { inject: true });
	const unknown =
		locale === 'pl' ? CATALOGUE.pl.workStatus_unknown : CATALOGUE.en.workStatus_unknown;
	const injectedText = await injected.page
		.locator('.item-card', { hasText: 'Injected:' })
		.locator('.item-status')
		.allTextContents();
	check(
		`an undeclared code and a count-less counted row both read "${unknown}"`,
		injectedText.length === 2 && injectedText.every((t) => t.trim() === unknown),
		injectedText.join(' | ')
	);
	await injected.ctx.close();
}

await browser.close();
console.log(`\n${pass} passed, ${fail} failed, ${errors.length} console/page errors`);
for (const e of errors.slice(0, 8)) console.log('  ' + e);
process.exit(fail || errors.length ? 1 : 0);
