// The cooperation overview of a material (backend materials_coop/, HISTORY.md §17BG): the panel on
// the material page in its three designs, the cooperation page and its five views, the policy
// changing what a stranger may do, the team thread, and the kill switch.
//
// Everything that matters is checked on the MATERIAL page or its `/coop` page as julia, who is
// not staff (e2e/CLAUDE.md trap 10). kasia only creates the scratch material and flips the switch.
//
// Three seeded accounts (`seed_demo_users`, password `password123`):
//   kasia — staff. Creates the scratch project (a staff first publication publishes at once),
//           then hands it to ola and flips the switch at the end.
//   ola   — owner after the transfer. Sets the policy, accepts julia's application.
//   julia — a stranger. Reads the panel, switches designs, proposes, is refused, asks to join.
//
// Run:
//   E2E_BASE=http://localhost:5183 E2E_API=http://127.0.0.1:8011/api node e2e/materials-coop.mjs
//
// Cleanup: none for the material (no delete endpoint; house rule 12) — it is named
// `e2e-coop-<timestamp>` so a human can find it. The switch is restored, and so is each
// account's `content_locales`.
//
// Traps written around (e2e/CLAUDE.md): 2 (never `networkidle`), 10, 13 (token straight into
// localStorage), 16 (Polish content locales for the run), 24 (`englishContext`).
import { mkdirSync } from 'node:fs';

let chromium;
try {
	({ chromium } = await import('playwright'));
} catch {
	({ chromium } = await import('playwright-core'));
}
import { englishContext } from './english.mjs';

const BASE = process.env.E2E_BASE ?? 'http://localhost:5183';
const API = (process.env.E2E_API ?? 'http://127.0.0.1:8011/api').replace(/\/api\/?$/, '') + '/api';
const SHOTS = process.env.E2E_SHOTS ?? 'e2e/screenshots';
mkdirSync(SHOTS, { recursive: true });
const STAMP = Date.now();
const NAME = `e2e-coop-${STAMP}`;

let pass = 0,
	fail = 0;
const errors = [];
const check = (label, ok, detail = '') => {
	if (ok) pass++;
	else fail++;
	console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${label}${ok ? '' : '  <- ' + detail}`);
};

async function api(path, { token, method = 'GET', body } = {}) {
	const res = await fetch(`${API}${path}`, {
		method,
		headers: {
			'Content-Type': 'application/json',
			...(token ? { Authorization: `Token ${token}` } : {})
		},
		body: body ? JSON.stringify(body) : undefined
	});
	const text = await res.text();
	let parsed;
	try {
		parsed = text ? JSON.parse(text) : null;
	} catch {
		parsed = text;
	}
	return { status: res.status, body: parsed };
}

async function tokenFor(email) {
	const r = await api('/auth/login/', {
		method: 'POST',
		body: { username: email, password: 'password123' }
	});
	if (r.status !== 200) {
		throw new Error(
			`login failed for ${email}: ${r.status} ${JSON.stringify(r.body)} (login throttle? clear backend/cachedata and restart)`
		);
	}
	return r.body.token;
}

async function setFlag(token, key, enabled) {
	const before = await api(`/feature-flags/`, { token });
	const row = (Array.isArray(before.body) ? before.body : []).find((f) => f.key === key);
	const was = row ? row.is_enabled : true;
	await api(`/feature-flags/${key}/`, { token, method: 'PATCH', body: { is_enabled: enabled } });
	return () => api(`/feature-flags/${key}/`, { token, method: 'PATCH', body: { is_enabled: was } });
}

async function readPolish(token) {
	const before = (await api('/auth/me/', { token })).body?.content_locales ?? [];
	await api('/auth/me/', { token, method: 'PATCH', body: { content_locales: ['pl'] } });
	return () => api('/auth/me/', { token, method: 'PATCH', body: { content_locales: before } });
}

const browser = await chromium.launch(
	process.env.CHROME ? { executablePath: process.env.CHROME } : {}
);

async function person(name, token) {
	const ctx = await englishContext(browser, BASE, {
		viewport: { width: 1280, height: 1000 },
		locale: 'en-US'
	});
	await ctx.addInitScript(
		([t]) => {
			localStorage.setItem('edmat.contentLocales', JSON.stringify(['pl']));
			if (t) localStorage.setItem('edmat-auth-token', t);
		},
		[token ?? '']
	);
	const p = await ctx.newPage();
	p.on('pageerror', (e) => errors.push(`[${name}] pageerror: ${e.message}`));
	p.on('console', (msg) => {
		if (msg.type() !== 'error') return;
		errors.push(`[${name}] console: ${msg.text()}`);
	});
	return p;
}

const settle = (p, ms = 900) => p.waitForTimeout(ms);
async function goto(p, path, waitFor = '.page h1, main h1, h1') {
	await p.goto(`${BASE}${path}`, { waitUntil: 'load', timeout: 120000 });
	await p.locator(waitFor).first().waitFor({ timeout: 120000 });
	await settle(p);
}
const shot = (p, name) => p.screenshot({ path: `${SHOTS}/coop-${name}.png`, fullPage: true });

const undo = [];
let juliaPage, olaPage;

try {
	console.log('\n[0] the switch is on, three people are signed in');
	const kasia = await tokenFor('kasia@edmat.example');
	const olaToken = await tokenFor('ola@edmat.example');
	const juliaToken = await tokenFor('julia@edmat.example');
	undo.push(await setFlag(kasia, 'coauthoring', true));
	undo.push(await setFlag(kasia, 'material_submissions', true));
	for (const t of [olaToken, juliaToken]) undo.push(await readPolish(t));
	const ola = (await api('/auth/me/', { token: olaToken })).body;
	const julia = (await api('/auth/me/', { token: juliaToken })).body;

	console.log('\n[1] kasia publishes a scratch material and hands it to ola');
	const branches = await api('/branches/');
	const branch = branches.body?.[0]?.slug;
	check('a branch to file it under', Boolean(branch));
	const created = await api('/material-projects/', {
		token: kasia,
		method: 'POST',
		body: {
			branch,
			locale: 'pl',
			type: 'script',
			audience: 'university',
			title: `${NAME} skrypt`,
			description: 'Scratch material created by e2e/materials-coop.mjs.',
			kind: 'body',
			body: '<p>Pierwsza wersja.</p>',
			change_note: 'first version',
			publish: true
		}
	});
	check(
		'the project is created and published at once',
		created.status === 201 && created.body?.material_id,
		`${created.status} ${JSON.stringify(created.body).slice(0, 200)}`
	);
	const projectId = created.body.id;
	const materialId = created.body.material_id;
	const added = await api(`/material-projects/${projectId}/members/`, {
		token: kasia,
		method: 'POST',
		body: { user_id: ola.id }
	});
	check(
		'ola is added as a co-author',
		added.status === 201,
		`${added.status} ${JSON.stringify(added.body)}`
	);
	const handed = await api(`/material-projects/${projectId}/transfer/`, {
		token: kasia,
		method: 'POST',
		body: { user_id: ola.id }
	});
	check(
		'and made the owner',
		handed.status === 200,
		`${handed.status} ${JSON.stringify(handed.body)}`
	);

	console.log('\n[2] the overview endpoint answers anybody');
	const anon = await api(`/materials/${materialId}/coop/`);
	check('anonymous GET is 200', anon.status === 200, String(anon.status));
	check('policy defaults to open', anon.body?.policy === 'open', String(anon.body?.policy));
	check(
		'two co-authors counted',
		anon.body?.stats?.members_count === 2,
		JSON.stringify(anon.body?.stats)
	);
	check(
		'the timeline names the publication',
		(anon.body?.timeline ?? []).some((e) => e.kind === 'version_published')
	);

	console.log('\n[3] julia sees the panel on the material page and switches its design');
	juliaPage = await person('julia', juliaToken);
	await goto(juliaPage, `/materials/${materialId}`);
	const panel = juliaPage.locator('.coop-panel');
	await panel.waitFor({ timeout: 30000 });
	check('the panel is there', await panel.isVisible());
	check(
		'it says which version',
		/Version 1/.test(await panel.locator('.version-line').innerText())
	);
	check('and the policy', /Open/.test(await panel.locator('.policy').innerText()));
	check('it starts in the roster design', (await panel.getAttribute('data-layout')) === 'roster');
	check(
		'the roster lists both co-authors',
		(await panel.locator('.rows .row').count()) === 2,
		String(await panel.locator('.rows .row').count())
	);
	await shot(juliaPage, '01-panel-roster');
	await panel.locator('.meatballs__trigger').click();
	await juliaPage.locator('.meatballs__item', { hasText: 'Timeline' }).click();
	await settle(juliaPage, 400);
	check(
		'the kebab switches to the timeline',
		(await panel.getAttribute('data-layout')) === 'timeline'
	);
	check(
		'which lists events',
		(await panel.locator('.timeline .event').count()) >= 2,
		String(await panel.locator('.timeline .event').count())
	);
	await shot(juliaPage, '02-panel-timeline');
	await panel.locator('.meatballs__trigger').click();
	await juliaPage.locator('.meatballs__item', { hasText: 'Tiles' }).click();
	await settle(juliaPage, 400);
	check('and to the tiles', (await panel.getAttribute('data-layout')) === 'tiles');
	check(
		'four tiles',
		(await panel.locator('.tile').count()) === 4,
		String(await panel.locator('.tile').count())
	);
	await shot(juliaPage, '03-panel-tiles');
	await juliaPage.reload({ waitUntil: 'load' });
	await juliaPage.locator('.coop-panel').waitFor({ timeout: 30000 });
	await settle(juliaPage);
	check(
		'the choice survives a reload',
		(await juliaPage.locator('.coop-panel').getAttribute('data-layout')) === 'tiles'
	);
	check(
		'an open material offers "Improve this material"',
		(await juliaPage.locator('.coop-panel button.secondary', { hasText: 'Improve' }).count()) === 1
	);

	console.log('\n[4] the cooperation page');
	await juliaPage.locator('.coop-panel a', { hasText: 'Cooperation page' }).click();
	await juliaPage.locator('.page h1').waitFor({ timeout: 30000 });
	await settle(juliaPage);
	check(
		'the URL is /materials/<id>/coop',
		juliaPage.url().includes(`/materials/${materialId}/coop`),
		juliaPage.url()
	);
	check(
		'the heading names the material',
		(await juliaPage.locator('.page h1').innerText()).includes(NAME)
	);
	const tabs = juliaPage.locator('.tabs [role=tab]');
	check(
		'four views for a stranger (no settings)',
		(await tabs.count()) === 4,
		String(await tabs.count())
	);
	await shot(juliaPage, '04-page-overview');
	await tabs.filter({ hasText: 'Team' }).click();
	await settle(juliaPage);
	check(
		'the team view shows the roster',
		(await juliaPage.locator('#coop-panel-team .rows .row').count()) === 2
	);
	check(
		'and, under an open policy, says why you cannot ask to join',
		/published/.test(await juliaPage.locator('#coop-panel-team .join').innerText())
	);
	await tabs.filter({ hasText: 'History' }).click();
	await settle(juliaPage);
	check(
		'the history view lists version 1',
		/Version 1/.test(await juliaPage.locator('#coop-panel-history .versions').innerText())
	);
	await tabs.filter({ hasText: 'Discussion' }).click();
	await settle(juliaPage);
	check(
		'the thread has a composer for a signed-in reader (open policy)',
		(await juliaPage.locator('#coop-panel-discussion textarea').count()) >= 1
	);
	await juliaPage
		.locator('#coop-panel-discussion textarea')
		.first()
		.fill(`Hello from julia ${STAMP}`);
	await juliaPage.locator('#coop-panel-discussion form button[type=submit]').first().click();
	await settle(juliaPage, 1200);
	check(
		'a comment lands in the team thread',
		(await juliaPage.locator('#coop-panel-discussion').innerText()).includes(
			`Hello from julia ${STAMP}`
		)
	);
	const materialThread = await api(`/materials/${materialId}/comments/`);
	check(
		"and not in the material's public thread",
		Array.isArray(materialThread.body) && materialThread.body.length === 0
	);
	await shot(juliaPage, '05-page-discussion');

	console.log('\n[5] ola closes the door: policy "by request"');
	olaPage = await person('ola', olaToken);
	await goto(olaPage, `/materials/${materialId}/coop?view=settings`);
	check('the owner sees five views', (await olaPage.locator('.tabs [role=tab]').count()) === 5);
	await olaPage.locator('#coop-panel-settings input[value=request]').check();
	await olaPage
		.locator('#coop-panel-settings textarea')
		.fill('Ask to join; we review every proposal within a week.');
	await olaPage.locator('#coop-panel-settings button[type=submit]').click();
	await settle(olaPage, 1200);
	check('saved', /Saved/.test(await olaPage.locator('#coop-panel-settings').innerText()));
	await shot(olaPage, '06-settings');
	const after = await api(`/materials/${materialId}/coop/`);
	check('the API agrees', after.body?.policy === 'request', String(after.body?.policy));

	console.log('\n[6] julia is now refused, and asks to join instead');
	await goto(juliaPage, `/materials/${materialId}`);
	await juliaPage.locator('.coop-panel').waitFor({ timeout: 30000 });
	check(
		'the panel says "By request"',
		/By request/.test(await juliaPage.locator('.coop-panel .head .policy').innerText())
	);
	check(
		'no "Improve this material" button',
		(await juliaPage.locator('.coop-panel button.secondary', { hasText: 'Improve' }).count()) === 0
	);
	check(
		'and the reason says to ask to join',
		/ask to join/.test(await juliaPage.locator('.coop-panel .hint').innerText())
	);
	await shot(juliaPage, '07-panel-refused');
	const refused = await api(`/material-projects/${projectId}/versions/`, {
		token: juliaToken,
		method: 'POST',
		body: {
			kind: 'body',
			body: '<p>x</p>',
			title: 'x',
			based_on: created.body.published_version?.id ?? created.body.head_version?.id
		}
	});
	check(
		'the API refuses her proposal with members_only',
		refused.status === 400 && refused.body?.detail === 'members_only',
		`${refused.status} ${JSON.stringify(refused.body)}`
	);
	await goto(juliaPage, `/materials/${materialId}/coop?view=team`);
	check(
		'the welcome note is on the overview',
		(
			await (await goto(juliaPage, `/materials/${materialId}/coop`),
			juliaPage.locator('.welcome').innerText())
		).includes('review every proposal')
	);
	await goto(juliaPage, `/materials/${materialId}/coop?view=team`);
	const joinForm = juliaPage.locator('#coop-panel-team .join form');
	check('the team view now offers "Ask to join"', (await joinForm.count()) === 1);
	await joinForm
		.locator('textarea')
		.fill('I have taught this course for six years and would like to help keep it current.');
	await joinForm.locator('button[type=submit]').click();
	await settle(juliaPage, 1200);
	check(
		'the application is sent',
		/Sent\./.test(await juliaPage.locator('#coop-panel-team .join').innerText())
	);
	await goto(juliaPage, `/materials/${materialId}/coop?view=discussion`);
	check(
		"the thread is now the team's room: no composer",
		(await juliaPage.locator('#coop-panel-discussion textarea').count()) === 0
	);
	check(
		'and says so',
		/co-authors' room/.test(await juliaPage.locator('#coop-panel-discussion').innerText())
	);

	console.log('\n[7] ola sees the application and accepts it');
	await goto(olaPage, `/materials/${materialId}/coop?view=team`);
	check(
		'the Team tab carries a badge of 1',
		/1/.test(await olaPage.locator('.tabs [role=tab]', { hasText: 'Team' }).innerText())
	);
	const request = olaPage.locator('#coop-panel-team .join li', {
		hasText: julia.display_name ?? 'julia'
	});
	check(
		'the request is listed with the statement',
		(await request.count()) === 1 && /six years/.test(await request.innerText())
	);
	await shot(olaPage, '08-owner-team');
	await request.locator('button', { hasText: 'Accept' }).click();
	await settle(olaPage, 1500);
	check(
		'julia is now on the roster',
		(await olaPage.locator('#coop-panel-team .rows .row').count()) === 3,
		String(await olaPage.locator('#coop-panel-team .rows .row').count())
	);
	await shot(olaPage, '09-owner-accepted');

	console.log('\n[8] the kill switch');
	undo.push(await setFlag(kasia, 'coauthoring', false));
	await goto(juliaPage, `/materials/${materialId}`);
	await settle(juliaPage, 1500);
	check(
		'the panel is gone for a non-staff reader',
		(await juliaPage.locator('.coop-panel').count()) === 0
	);
	await juliaPage.goto(`${BASE}/materials/${materialId}/coop`, { waitUntil: 'load' });
	await juliaPage.locator('.feature-disabled, .page h1').first().waitFor({ timeout: 30000 });
	await settle(juliaPage);
	check(
		'the page shows the unavailable notice',
		(await juliaPage.locator('.feature-disabled').count()) === 1
	);
	const gated = await api(`/materials/${materialId}/coop/`, { token: juliaToken });
	check('and the API answers 403', gated.status === 403, String(gated.status));
	await setFlag(kasia, 'coauthoring', true);
	await goto(juliaPage, `/materials/${materialId}`);
	await juliaPage.locator('.coop-panel').waitFor({ timeout: 30000 });
	check(
		'turning it back on brings the panel back',
		await juliaPage.locator('.coop-panel').isVisible()
	);
} catch (e) {
	fail++;
	console.log('  FAIL script threw:', e?.stack ?? e);
} finally {
	for (const u of undo.reverse()) await u().catch(() => {});
	await browser.close();
}

const unexpected = errors.filter(
	(e) => !/Failed to load resource|the server responded with a status of/.test(e)
);
if (unexpected.length) {
	console.log('\nconsole/page errors:');
	for (const e of unexpected) console.log('  ' + e);
}
console.log(`\n${pass} passed, ${fail} failed, ${unexpected.length} console/page errors`);
process.exit(fail || unexpected.length ? 1 : 0);
