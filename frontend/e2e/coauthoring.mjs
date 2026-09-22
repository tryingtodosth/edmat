// Co-authoring a material (COAUTHORING-BRIEF.md §8): a project with a team, an invite link, a
// version somebody else uploads, a proposal from a stranger, a rejection with a reason, and the
// kill switch.
//
// The run is shaped around the one claim the whole feature rests on: **the Material row stays the
// published projection**. So every browser check that matters is made on the MATERIAL page — its
// download link serves whatever the current version carries, and the project panel disappears with
// the switch — rather than only inside the project's own pages.
//
// Four seeded accounts, one browser context each (`seed_demo_users`, password `password123`):
//   kasia   — staff. Owns the two feature flags and reviews the first publication.
//   ola     — owns the scratch project and decides what is proposed to it.
//   michał  — arrives through an invite link and uploads a version.
//   julia   — a stranger who proposes a change and is refused with a reason.
//
// Run:
//   E2E_BASE=http://localhost:5183 E2E_API=http://127.0.0.1:8011/api node e2e/coauthoring.mjs
// (CHROME=… points at a cached Chromium if `playwright-core` cannot find one itself.)
//
// **Cleanup: there is none, deliberately.** This app has no delete endpoint for a project, a
// version, a member or a material — versions are history and history is not deleted (root CLAUDE.md
// house rule 12), and a published material is not something a test script should be able to remove.
// Everything this run creates is therefore named `e2e-coauth-<timestamp>` so a human can find it,
// and the invite link it mints is REVOKED at the end, which is the one piece of cleanup the API
// genuinely supports. What the run does restore: both feature flags, and each account's
// `content_locales`.
//
// Traps this script is written around (e2e/CLAUDE.md):
//   2  — `waitUntil: 'networkidle'` never fires on an authenticated page (the notification SSE
//        stream is permanently in flight). Every navigation is `'load'` plus an explicit `waitFor`.
//   10 — a staff-bypassed check proves nothing about a FeatureFlag, so the kill-switch section is
//        driven as julia, who is not staff. kasia only flips the switch.
//   13 — the login form's identifier field is `type="text"`; `form input[autocomplete="username"]`
//        is the selector that still matches. This script does not use the form at all — it logs in
//        once per account through `POST /api/auth/login/` and puts the token straight into
//        localStorage (the classroom-overhaul precedent), because the REGISTER/login path is
//        throttled per IP and a run that spends that budget makes every later script fail in ways
//        that look like a code regression.
//   14 — an audience band is selected by option VALUE, never by position
//        (`select:has(option[value="university"])`). The project created here sends its band
//        through the API, so the only band control driven in the browser is named that way.
//   16 — lists are narrowed to the reader's content languages, and a signed-in profile's own
//        `content_locales` overwrite whatever localStorage says. Each account is given `['pl']`
//        through the API for the run and put back at the end.
//
// Zero console/page errors is part of the pass condition, as in every script here.
import { mkdtemp, writeFile } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

let chromium;
try {
	({ chromium } = await import('playwright'));
} catch {
	({ chromium } = await import('playwright-core'));
}

const BASE = process.env.E2E_BASE ?? 'http://localhost:5183';
// E2E_API is given with or without a trailing /api — both conventions exist among these scripts.
const API = (process.env.E2E_API ?? 'http://127.0.0.1:8011/api').replace(/\/api\/?$/, '') + '/api';
const SHOTS = process.env.E2E_SHOTS ?? 'e2e/screenshots';
const STAMP = Date.now();
const NAME = `e2e-coauth-${STAMP}`;

let pass = 0,
	fail = 0;
const errors = [];
const check = (label, ok, detail = '') => {
	if (ok) pass++;
	else fail++;
	console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${label}${ok ? '' : '  <- ' + detail}`);
};

/* --- the API half ------------------------------------------------------------------------------
 * Everything the browser cannot reasonably do: minting the scratch project, flipping a staff-only
 * flag. */

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

/** Multipart, and deliberately without a `Content-Type` header: the boundary is the runtime's to
 *  generate, exactly as `client.ts`'s own `postForm` notes. */
async function upload(path, token, fields, file) {
	const form = new FormData();
	for (const [key, value] of Object.entries(fields)) {
		if (value !== undefined && value !== null) form.set(key, String(value));
	}
	if (file) {
		form.set('file', new Blob([readFileSync(file.path)], { type: file.type }), file.name);
	}
	const res = await fetch(`${API}${path}`, {
		method: 'POST',
		headers: { Authorization: `Token ${token}` },
		body: form
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
			`login failed for ${email}: ${r.status} ${JSON.stringify(r.body)} ` +
				'(login throttle? restart the backend by the PID holding the port)'
		);
	}
	return r.body.token;
}

/** A real, valid, tiny PDF. Minimal on purpose — libmagic only ever reads the first few KB to
 *  answer "is this genuinely a PDF", which is the question `validate_material_submission_file`
 *  asks. The `label` is what makes the three files genuinely different sets of bytes; the STORED
 *  name is random either way (house rule 7), which is exactly why the material-page check below
 *  compares download URLs rather than file names. */
function pdfBytes(label) {
	return Buffer.from(
		'%PDF-1.4\n' +
			'1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n' +
			'2 0 obj<</Type/Pages/Kids[]/Count 0>>endobj\n' +
			`% ${label}\n` +
			'trailer<</Root 1 0 R>>\n%%EOF\n'
	);
}

const dir = await mkdtemp(join(tmpdir(), 'edmat-coauth-'));
const PDF_V1 = join(dir, 'v1.pdf');
const PDF_V2 = join(dir, 'v2.pdf');
await writeFile(PDF_V1, pdfBytes(`${NAME} first version`));
await writeFile(PDF_V2, pdfBytes(`${NAME} second version, uploaded by a co-author`));
const asPdf = (path, name) => ({ path, name, type: 'application/pdf' });

/** A flag, set and remembered. Returns the undo, so a failing run still leaves the platform the
 *  way it found it (a kill switch left off by a crashed script is a bug report waiting to happen). */
async function setFlag(token, key, enabled) {
	const before = await api(`/feature-flags/`, { token });
	const row = (Array.isArray(before.body) ? before.body : []).find((f) => f.key === key);
	const was = row ? row.is_enabled : true;
	await api(`/feature-flags/${key}/`, { token, method: 'PATCH', body: { is_enabled: enabled } });
	return () => api(`/feature-flags/${key}/`, { token, method: 'PATCH', body: { is_enabled: was } });
}

/** Trap 16: a signed-in profile's own `content_locales` overwrite the localStorage extras the
 *  moment it loads, so an account that reads a LIST has to be given Polish through the API. */
async function readPolish(token) {
	const before = (await api('/auth/me/', { token })).body?.content_locales ?? [];
	await api('/auth/me/', { token, method: 'PATCH', body: { content_locales: ['pl'] } });
	return () => api('/auth/me/', { token, method: 'PATCH', body: { content_locales: before } });
}

/* --- the browser half --------------------------------------------------------------------- */

const browser = await chromium.launch(
	process.env.CHROME ? { executablePath: process.env.CHROME } : {}
);

/** One person, one context, signed in by token rather than through the form (trap 13's reason). */
async function person(name, token) {
	const ctx = await browser.newContext({
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

/** Trap 2: never `networkidle` on a signed-in page. `'load'` plus a real element to wait for. */
async function goto(p, path, waitFor = '.page h1, main h1, h1') {
	await p.goto(`${BASE}${path}`, { waitUntil: 'load', timeout: 120000 });
	await p.locator(waitFor).first().waitFor({ timeout: 120000 });
	await settle(p);
}

/** The header's account popover, opened. Both the desktop popover and the phone drawer render the
 *  SAME snippet, so checking one is checking the item list; the viewport here is a laptop. */
async function openAccountMenu(p) {
	await p.locator('.account-trigger').click();
	await settle(p, 400);
	return p.locator('.popover__panel');
}

const undo = [];
let olaPage, michalPage, juliaPage;

try {
	console.log('\n[0] the switches are on, and four people are signed in');
	const kasia = await tokenFor('kasia@edmat.example');
	const olaToken = await tokenFor('ola@edmat.example');
	const michalToken = await tokenFor('michal@edmat.example');
	const juliaToken = await tokenFor('julia@edmat.example');

	undo.push(await setFlag(kasia, 'coauthoring', true));
	undo.push(await setFlag(kasia, 'material_submissions', true));
	for (const t of [olaToken, michalToken, juliaToken]) undo.push(await readPolish(t));

	const flags = await api('/feature-flags/', { token: kasia });
	const coauthFlag = (flags.body ?? []).find((f) => f.key === 'coauthoring');
	check(
		'the `coauthoring` flag exists and is on',
		Boolean(coauthFlag?.is_enabled),
		JSON.stringify(coauthFlag)
	);

	console.log('\n[1] ola starts a project, and its first publication is reviewed');
	const branches = await api('/branches/');
	const branch = branches.body?.[0]?.slug;
	check('a branch to file it under', Boolean(branch), JSON.stringify(branches.body?.[0] ?? null));

	const created = await upload(
		'/material-projects/',
		olaToken,
		{
			branch,
			locale: 'pl',
			type: 'script',
			audience: 'university',
			title: `${NAME} skrypt`,
			description: 'Scratch project created by e2e/coauthoring.mjs.',
			kind: 'file',
			change_note: 'first version'
		},
		asPdf(PDF_V1, 'v1.pdf')
	);
	check(
		'the project is created',
		created.status === 201,
		`${created.status} ${JSON.stringify(created.body)}`
	);
	const projectId = String(created.body?.id ?? '');
	const v1Id = String(created.body?.head_version?.id ?? '');
	check(
		'with a first version waiting as a draft',
		Boolean(v1Id),
		JSON.stringify(created.body?.head_version ?? null)
	);
	check(
		'and no material yet — a draft project is not a material',
		created.body?.material_id === null || created.body?.material_id === undefined,
		JSON.stringify(created.body?.material_id)
	);

	const published = await api(`/material-versions/${v1Id}/publish/`, {
		token: olaToken,
		method: 'POST',
		body: {}
	});
	check(
		'publishing answers',
		published.status === 200,
		`${published.status} ${JSON.stringify(published.body)}`
	);
	// Two honest outcomes, and which one happens depends on whether ola is a verified contributor:
	// `published` if she may auto-publish a first publication, `proposed` if it goes to the queue.
	// The script asserts the DISTINCTION rather than one of them, then takes the queue branch.
	check(
		'a first publication is either published or queued, never anything else',
		['published', 'proposed'].includes(published.body?.status),
		String(published.body?.status)
	);
	if (published.body?.status === 'proposed') {
		// Where it waits: ONE Materials tab on /moderation, reading `material_versions` — since phase
		// 3 a new material IS a project's first version, and the old material-submissions queue is
		// gone. Read as staff here, which is who decides a first publication; the tab itself is
		// deliberately not behind the `coauthoring` switch, so a governor still sees it with
		// collaboration off.
		const kasiaPage = await person('kasia', kasia);
		await goto(kasiaPage, '/moderation?tab=materials', '#mod-tab-materials');
		const queueRow = kasiaPage.locator('.queue-item', { hasText: `${NAME} skrypt` }).first();
		await queueRow.waitFor({ timeout: 60000 });
		const queueText = await queueRow.innerText();
		check("the first publication is waiting in the queue's Materials tab", Boolean(queueText));
		check(
			'marked as the question it asks',
			/First publication/i.test(queueText),
			queueText.slice(0, 200)
		);
		check(
			'with a way into the version itself',
			(await queueRow.locator('a[href*="/versions/"]').count()) === 1,
			queueText.slice(0, 200)
		);
		// The same rule the version's own page follows: no rejection without a reason.
		check(
			'and a Reject that stays refused until a reason is typed',
			await queueRow.locator('button.reject').isDisabled()
		);
		await kasiaPage.screenshot({ path: `${SHOTS}/coauthoring-0-queue.png`, fullPage: true });
		await kasiaPage.close();

		const decided = await api(`/material-versions/${v1Id}/decide/`, {
			token: kasia,
			method: 'POST',
			body: { decision: 'accept', note: '' }
		});
		check(
			'staff accept it',
			decided.status === 200,
			`${decided.status} ${JSON.stringify(decided.body)}`
		);
		check(
			'and that publishes it',
			decided.body?.status === 'published',
			String(decided.body?.status)
		);
	}

	const project = await api(`/material-projects/${projectId}/`, { token: olaToken });
	const materialId = String(project.body?.material_id ?? '');
	check(
		'the project now has a material',
		Boolean(materialId),
		JSON.stringify(project.body?.material_id)
	);

	olaPage = await person('ola', olaToken);
	michalPage = await person('michal', michalToken);
	juliaPage = await person('julia', juliaToken);

	console.log('\n[2] the material page shows the project, and the project page shows the version');
	await goto(olaPage, `/materials/${materialId}`);
	await olaPage.locator('.project-panel').waitFor({ timeout: 30000 });
	check(
		'the material carries a project panel',
		await olaPage.locator('.project-panel').isVisible()
	);
	check(
		'naming the version and who wrote it',
		/Version 1/.test(await olaPage.locator('.project-panel .version-line').innerText()),
		await olaPage.locator('.project-panel').innerText()
	);
	// What the projection actually means: the material serves the version's bytes.
	const downloadV1 = await olaPage
		.locator('.material-card__get a.download')
		.first()
		.getAttribute('href');
	check('and the material serves a file', Boolean(downloadV1), String(downloadV1));

	await goto(olaPage, `/material-projects/${projectId}`);
	check(
		'the owner sees the current version',
		await olaPage.locator('.content-section .version-view').first().isVisible()
	);
	check('the team', await olaPage.locator('.members').isVisible());
	check(
		'and the invite links, because she manages it',
		await olaPage.locator('.invites').isVisible()
	);
	await olaPage.screenshot({ path: `${SHOTS}/coauthoring-1-project.png`, fullPage: true });

	console.log('\n[3] ola mints an invite link');
	const invites = olaPage.locator('section.invites');
	await invites.locator('form input[type="text"]').first().fill(`${NAME} link`);
	await invites.locator('form button[type="submit"]').click();
	await invites.locator('input.url').first().waitFor({ timeout: 20000 });
	await settle(olaPage, 600);
	const inviteUrl = await invites.locator('input.url').first().inputValue();
	check('the link is minted and shown in full', /\/project-invites\//.test(inviteUrl), inviteUrl);
	check('and starts unused', /0 /.test(await invites.innerText()), await invites.innerText());
	const invitePath = new URL(inviteUrl, BASE).pathname;

	console.log('\n[4] michał accepts it and becomes a co-author');
	await goto(michalPage, invitePath, 'main.invite h1');
	const invitePage = michalPage.locator('main.invite');
	check(
		'the invitation says who is inviting and to what',
		(await invitePage.locator('.lede').innerText()).includes(NAME),
		await invitePage.innerText()
	);
	await invitePage.getByRole('button').first().click();
	// Accepting navigates straight to the project page rather than leaving a notice on the invite
	// page — the invite has done its job, and the project is where he now works.
	await michalPage
		.waitForURL((url) => url.pathname === `/material-projects/${projectId}`, { timeout: 20000 })
		.catch(() => {});
	check(
		'accepting takes him to the project',
		new URL(michalPage.url()).pathname === `/material-projects/${projectId}`,
		michalPage.url()
	);

	await goto(michalPage, `/material-projects/${projectId}`);
	check(
		'and he is on the team',
		(await michalPage.locator('.members').innerText()).includes('Micha'),
		await michalPage.locator('.members').innerText()
	);

	const usesText = await olaPage.reload({ waitUntil: 'load' }).then(async () => {
		await olaPage.locator('section.invites input.url').first().waitFor({ timeout: 30000 });
		await settle(olaPage, 700);
		return olaPage.locator('section.invites').innerText();
	});
	check('the link counts its use', /1 /.test(usesText), usesText);

	console.log('\n[5] michał saves a new version as a draft');
	await michalPage.locator('.editor-slot button').first().click();
	await michalPage.locator('section.editor').waitFor({ timeout: 20000 });
	const editor = michalPage.locator('section.editor');
	check('a co-author gets the draft editor', await editor.isVisible());
	await editor.locator('label.field input[type="text"]').first().fill(`${NAME} skrypt, wydanie 2`);
	await editor.locator('input[type="file"]').setInputFiles(PDF_V2);
	await editor.locator('input[type="text"]').last().fill('drugie wydanie');
	await editor.getByRole('button', { name: 'Save draft' }).click();
	await settle(michalPage, 2000);
	await goto(michalPage, `/material-projects/${projectId}`);
	await michalPage.screenshot({ path: `${SHOTS}/coauthoring-5-draft.png`, fullPage: true });
	const versionsText = await michalPage.locator('section.versions').innerText();
	check('the draft is in the history as version 2', /Version 2/.test(versionsText), versionsText);
	check('and it is a draft, not published', /Draft/.test(versionsText), versionsText);

	console.log('\n[6] ola publishes it, and the material serves the new file');
	// On the version page, with the Publish button a saved draft now has. (Until the 2026-09-22
	// review there was no control for publishing an EXISTING draft — `VersionEditor` publishes only
	// at save time — and this step went through the endpoint instead.)
	const history = await api(`/material-projects/${projectId}/versions/`, { token: olaToken });
	const draft = (history.body ?? []).find((v) => v.number === 2);
	check(
		'the owner can see the draft somebody else wrote',
		Boolean(draft?.id),
		JSON.stringify(history.body)
	);
	await goto(olaPage, `/material-projects/${projectId}/versions/2`, 'section.publish button');
	// What changed against the version this one was written against (the in-house word diff, loaded
	// on demand — hence the wait for a mark rather than for the section alone).
	const changes = olaPage.locator('section.changes');
	await changes.locator('ins').first().waitFor({ timeout: 30000 });
	const changesText = await changes.innerText();
	check(
		'the version page says what changed against version 1',
		/version 1/i.test(changesText),
		changesText.slice(0, 200)
	);
	check(
		'naming the new title and the new file',
		/wydanie 2/.test(changesText) && /new file/i.test(changesText),
		changesText.slice(0, 300)
	);
	await olaPage.locator('section.publish button').click();
	await olaPage.locator('section.publish .notice').waitFor({ timeout: 20000 });
	check(
		'the draft publishes from its own page',
		/2/.test(await olaPage.locator('section.publish .notice').innerText()),
		await olaPage.locator('section.publish').innerText()
	);
	const promoted = await api(`/material-versions/${draft?.id}/`, { token: olaToken });
	check(
		'and the server agrees it is published',
		promoted.body?.status === 'published',
		JSON.stringify(promoted.body?.status)
	);

	await goto(juliaPage, `/materials/${materialId}`);
	await juliaPage.locator('.project-panel').waitFor({ timeout: 30000 });
	const downloadV2 = await juliaPage
		.locator('.material-card__get a.download')
		.first()
		.getAttribute('href');
	check(
		'the material now serves a different file — the projection followed the version',
		Boolean(downloadV2) && downloadV2 !== downloadV1,
		`${downloadV1} -> ${downloadV2}`
	);
	check(
		'and the panel says which version that is',
		/Version 2/.test(await juliaPage.locator('.project-panel .version-line').innerText()),
		await juliaPage.locator('.project-panel').innerText()
	);
	await juliaPage.screenshot({ path: `${SHOTS}/coauthoring-2-material.png`, fullPage: true });

	console.log('\n[7] julia proposes a change from the material page');
	await juliaPage.locator('.project-panel button.secondary').click();
	await juliaPage.locator('section.editor').waitFor({ timeout: 30000 });
	const proposeEditor = juliaPage.locator('section.editor');
	check('a reader gets the propose editor, prefilled', await proposeEditor.isVisible());
	check(
		'and is told what publishing here means',
		(await proposeEditor.locator('.public-notice').innerText()).length > 0
	);
	// A `link` version rather than another file: it needs no upload, and the point of this step is
	// the proposal's lifecycle, not a second trip through the image/PDF pipeline.
	await proposeEditor.locator('input[type="radio"][name="version-kind"][value="link"]').check();
	await settle(juliaPage, 400);
	await proposeEditor
		.locator('label.field input[type="text"]')
		.first()
		.fill(`${NAME} skrypt, propozycja`);
	await proposeEditor.locator('input[inputmode="url"]').fill('example.edu/skrypt.pdf');
	await proposeEditor.locator('input[type="text"]').last().fill('link zamiast pliku');
	await proposeEditor.getByRole('button', { name: 'Propose' }).click();
	await settle(juliaPage, 2000);
	check(
		'and is told a person will read it',
		(await juliaPage.locator('.project-panel .notice').count()) > 0,
		await juliaPage.locator('.project-panel').innerText()
	);

	console.log('\n[8] ola rejects it, with a reason');
	await goto(olaPage, `/material-projects/${projectId}`);
	const proposals = olaPage.locator('.proposals');
	check('the proposal is waiting on the project page', (await proposals.count()) > 0);
	await proposals.locator('a').first().click();
	await olaPage.locator('section.decision').waitFor({ timeout: 30000 });
	const decision = olaPage.locator('section.decision');
	const rejectButton = decision.getByRole('button', { name: 'Reject', exact: true });
	check('Reject is refused until a reason is typed', await rejectButton.isDisabled());
	await decision
		.locator('textarea')
		.fill('Wolimy trzymać plik u nas, a nie linkować do cudzej strony.');
	await settle(olaPage, 300);
	check('and offered once there is one', await rejectButton.isEnabled());
	await rejectButton.click();
	await settle(olaPage, 1800);
	check(
		'the rejection is confirmed',
		(await decision.locator('.notice').count()) > 0,
		await decision.innerText()
	);
	const versionPath = new URL(olaPage.url()).pathname;
	await olaPage.screenshot({ path: `${SHOTS}/coauthoring-3-rejected.png`, fullPage: true });

	console.log('\n[9] julia is told why');
	await goto(juliaPage, versionPath);
	const juliaVersion = await juliaPage.locator('.page').innerText();
	check(
		'her proposal is marked rejected',
		/Rejected/.test(juliaVersion),
		juliaVersion.slice(0, 300)
	);
	check(
		'and carries the reason, in the words ola wrote',
		juliaVersion.includes('Wolimy trzymać plik u nas'),
		juliaVersion.slice(0, 400)
	);
	// The material is untouched by a rejected proposal — the projection only ever follows a publish.
	await goto(juliaPage, `/materials/${materialId}`);
	await juliaPage.locator('.project-panel').waitFor({ timeout: 30000 });
	const downloadAfterReject = await juliaPage
		.locator('.material-card__get a.download')
		.first()
		.getAttribute('href');
	check(
		'and the material still serves version 2',
		downloadAfterReject === downloadV2,
		`${downloadV2} -> ${downloadAfterReject}`
	);

	console.log('\n[10] the kill switch takes the links, not just the pages');
	const restoreCoauthoring = await setFlag(kasia, 'coauthoring', false);
	// Driven as julia, who is not staff — trap 10: a staff account bypasses `feature_gate` and
	// would prove nothing at all about the flag.
	await goto(juliaPage, `/materials/${materialId}`);
	await settle(juliaPage, 1800);
	check(
		'the material page keeps working with co-authoring off',
		(await juliaPage.locator('.material-card__title').count()) === 1
	);
	check('but shows no project panel', (await juliaPage.locator('.project-panel').count()) === 0);
	const menuOff = await openAccountMenu(juliaPage);
	check(
		'and the account menu has no Co-authoring entry',
		(await menuOff.locator('a[href*="/material-projects"]').count()) === 0,
		await menuOff.innerText()
	);
	await juliaPage.screenshot({ path: `${SHOTS}/coauthoring-4-flag-off.png`, fullPage: true });

	await restoreCoauthoring();
	await goto(juliaPage, `/materials/${materialId}`);
	await juliaPage.locator('.project-panel').waitFor({ timeout: 30000 });
	check(
		'turning it back on brings the panel back',
		await juliaPage.locator('.project-panel').isVisible()
	);
	const menuOn = await openAccountMenu(juliaPage);
	check(
		'and the menu entry with it',
		(await menuOn.locator('a[href*="/material-projects"]').count()) === 1,
		await menuOn.innerText()
	);

	console.log('\n[11] the one piece of cleanup this API supports');
	await goto(olaPage, `/material-projects/${projectId}`);
	await olaPage.locator('section.invites').waitFor({ timeout: 30000 });
	await olaPage.locator('section.invites').getByRole('button', { name: 'Revoke' }).first().click();
	await settle(olaPage, 1500);
	check(
		'the invite link is revoked',
		/revoked/i.test(await olaPage.locator('section.invites').innerText()),
		await olaPage.locator('section.invites').innerText()
	);
	console.log(
		`  note  the project, its versions and the material stay behind as ${NAME}-* — there is no ` +
			'delete endpoint for any of them, by design (house rule 12).'
	);
} finally {
	// Flags and content languages go back however the run ended: a kill switch left off by a
	// crashed script reads as a platform outage to the next person who looks.
	for (const fn of undo.reverse()) await fn().catch(() => {});
	await browser.close();
}

console.log(`\n${pass} passed, ${fail} failed, ${errors.length} console/page errors`);
if (errors.length) console.log(errors.slice(0, 10).join('\n'));
process.exit(fail || errors.length ? 1 : 0);
