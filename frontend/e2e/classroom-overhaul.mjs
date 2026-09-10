// Running a course with more than one person (root CLAUDE.md "Courses, overhauled"): a co-admin,
// contributed content that waits for review, a chapter that has not opened yet, and invite links —
// driven through the page as it is today: the management page at /courses/{id}/manage, the tabbed
// course page, the "Add something" title picker. Rewritten 2026-09-10 against the current page.
//
// Seeded accounts in separate contexts — ola owns the course, julia is made an administrator,
// bartek takes part and contributes, michał arrives through an invite link — plus a signed-out
// outsider. Tokens go straight into localStorage (no registration, no login-throttle budget); the
// course is created fresh per run and deleted at the end.
//   E2E_BASE=http://localhost:5183 E2E_API=http://127.0.0.1:8011 node e2e/classroom-overhaul.mjs
let chromium;
try {
	({ chromium } = await import('playwright'));
} catch {
	({ chromium } = await import('playwright-core'));
}
const BASE = process.env.E2E_BASE ?? 'http://localhost:5183';
// E2E_API may be given with or without a trailing /api — both conventions exist among these scripts.
const API = (process.env.E2E_API ?? 'http://127.0.0.1:8011').replace(/\/api\/?$/, '') + '/api';
let pass = 0,
	fail = 0;
const errors = [];
const check = (l, ok, x = '') => {
	if (ok) pass++;
	else fail++;
	console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${l} ${ok ? '' : x}`);
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
	if (r.status !== 200)
		throw new Error(
			`login failed for ${email}: ${r.status} ${JSON.stringify(r.body)} (login throttle? clear backend/cachedata)`
		);
	return r.body.token;
}
const browser = await chromium.launch(
	process.env.CHROME ? { executablePath: process.env.CHROME } : {}
);
/** One person, one context. Every context opts into Polish content: the course and the corpus
 * material it files are Polish, and an English-interface context would see both narrowed away by
 * the content-language rule (§17AQ). */
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
	const page = await ctx.newPage();
	page.on('pageerror', (e) => errors.push(`[${name}] pageerror: ${e.message}`));
	page.on('console', (msg) => {
		if (msg.type() !== 'error') return;
		// The course page's known pre-existing getAttachments 404 for non-members (todo board).
		if (page.url().includes('/courses/') && msg.text().includes('404')) return;
		errors.push(`[${name}] console: ${msg.text()}`);
	});
	return page;
}
const settle = (p, ms = 900) => p.waitForTimeout(ms);
async function goto(page, path, waitFor = '.page h1, main h1, h1') {
	await page.goto(`${BASE}${path}`, { waitUntil: 'load' });
	await page.locator(waitFor).first().waitFor({ timeout: 120000 });
	await settle(page);
}
const pad = (n) => String(n).padStart(2, '0');
/** A `datetime-local` value (local time, no zone) N days from now. */
function localIn(days) {
	const d = new Date();
	d.setDate(d.getDate() + days);
	return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T09:00`;
}

/** A signed-in profile's own `content_locales` overwrite the localStorage extras once it loads
 * (§17AQ), so an account that browses a list — the contribute picker — is given Polish through the
 * API for the run, and put back afterwards. Returns the undo. */
async function readPolish(token) {
	const before = (await api('/auth/me/', { token })).body.content_locales ?? [];
	await api('/auth/me/', { token, method: 'PATCH', body: { content_locales: ['pl'] } });
	return () => api('/auth/me/', { token, method: 'PATCH', body: { content_locales: before } });
}
const undo = [];
const olaToken = await tokenFor('ola@edmat.example');
const juliaToken = await tokenFor('julia@edmat.example');
const bartekToken = await tokenFor('bartek@edmat.example');
const michalToken = await tokenFor('michal@edmat.example');
for (const t of [olaToken, juliaToken, bartekToken, michalToken]) undo.push(await readPolish(t));
const owner = await person('owner', olaToken);
const coAdmin = await person('coAdmin', juliaToken);
const student = await person('student', bartekToken);
const invitee = await person('invitee', michalToken);
const outsider = await person('outsider');
const STAMP = Date.now();
const TITLE = `Topologia ${STAMP}`;
let courseId = null;

try {
	console.log('\n[1] A course is created, and its author owns it');
	await owner.goto(`${BASE}/`, { waitUntil: 'load', timeout: 180000 });
	await goto(owner, '/courses/new');
	const form = owner.locator('form').first();
	await form.locator('input[type="text"]').first().fill(TITLE);
	await form.locator('input[type="radio"][value="public"]').check();
	await form.locator('select:has(option[value="university"])').selectOption('university'); // audience band (§17AL)
	await form.locator('select:has(option[value="running"])').selectOption('open');
	// The contribution policy is on the create form, not buried in a second screen.
	const policy = form.locator('select:has(option[value="staff"])');
	check('the contribution policy is on the form', (await policy.count()) === 1);
	await policy.selectOption('approval');
	await form.locator('button[type="submit"]').click();
	await owner.waitForURL(/\/courses\/\d+$/, { timeout: 20000 });
	await settle(owner, 1500);
	courseId = owner.url().split('/').pop();
	check('landed on the new course', /^\d+$/.test(courseId), owner.url());
	check(
		'the owner is offered the management page',
		(await owner.locator('.manage-link a').count()) === 1
	);
	await goto(owner, `/courses/${courseId}/manage`);
	const manageText = await owner.locator('.page').innerText();
	check(
		'it has the review queue, the team and the invite links',
		/Waiting for review/.test(manageText) &&
			/Who runs this/.test(manageText) &&
			/Invite links/.test(manageText),
		manageText.slice(0, 300)
	);
	const staffText0 = await owner.locator('section.staff').innerText();
	check(
		'with the owner listed and locked',
		/owner/i.test(staffText0) && /cannot be changed or removed/.test(staffText0),
		staffText0.slice(0, 300)
	);

	console.log('\n[2] A second person is made an administrator');
	const juliaMe = await api('/auth/me/', { token: juliaToken });
	const staff = owner.locator('section.staff');
	await staff.locator('input[inputmode="numeric"]').fill(String(juliaMe.body.id));
	await staff.locator('form select').selectOption('admin');
	await staff.locator('button[type="submit"]').click();
	await settle(owner, 1500);
	const staffText = await staff.innerText();
	check(
		'the new administrator is listed',
		/Julia/.test(staffText) && /Administrator/.test(staffText),
		staffText.slice(0, 300)
	);
	await goto(coAdmin, `/courses/${courseId}`);
	check(
		'the co-admin is offered the management page too',
		(await coAdmin.locator('.manage-link a').count()) === 1
	);
	await goto(coAdmin, `/courses/${courseId}/manage`);
	check('and can mint links', /Invite links/.test(await coAdmin.locator('.page').innerText()));
	check(
		'but cannot touch the owner',
		(await coAdmin
			.locator('section.staff li', { hasText: 'Ola' })
			.getByRole('button', { name: 'Remove' })
			.count()) === 0
	);

	console.log('\n[3] Chapters, one of which has not opened yet');
	const chapterForm = owner.locator('form.chapter-form');
	await chapterForm.locator('input[type="text"]').fill('Week 1');
	await chapterForm.locator('button[type="submit"]').click();
	await settle(owner, 1200);
	await chapterForm.locator('input[type="text"]').fill('Week 9');
	await chapterForm.locator('input[type="datetime-local"]').fill(localIn(60));
	await chapterForm.locator('button[type="submit"]').click();
	await settle(owner, 1200);
	await goto(owner, `/courses/${courseId}`);
	let content = await owner.locator('.tab-panel').innerText();
	check(
		'both chapters render',
		/Week 1/.test(content) && /Week 9/.test(content),
		content.slice(0, 300)
	);
	check('staff are told the later one is still shut', /Not open to participants yet/.test(content));
	check('and it is drawn locked', (await owner.locator('.chapter--locked').count()) === 1);

	console.log('\n[4] A participant joins and contributes');
	await goto(student, `/courses/${courseId}`);
	await student.getByRole('button', { name: 'Join this course' }).click();
	await settle(student, 1500);
	check(
		'the participant is in',
		/You are taking part/.test(await student.locator('section.enrol').innerText())
	);
	content = await student.locator('.tab-panel').innerText();
	check('the participant sees the locked chapter exists', /Week 9/.test(content));
	check(
		'and is told when it opens',
		/Opens/.test(content) && !/Not open to participants yet/.test(content)
	);
	check(
		'but is offered no management page',
		(await student.locator('.manage-link a').count()) === 0
	);
	const contribute = student.locator('section.contribute');
	check('the contribute form is offered', (await contribute.count()) === 1);
	check(
		'and says the submission will be reviewed',
		/Staff will review this before it appears/.test(await contribute.innerText())
	);
	// The panel is a title search picker (§17AC); the corpus's first material is what gets offered.
	const material = (await api('/materials/?fresh=1')).body[0];
	await contribute.locator('input[placeholder]').fill(material.title);
	await contribute.locator('.results button').first().waitFor({ timeout: 15000 });
	await contribute.locator('.results button').first().click();
	await contribute.locator('input[type="text"]').last().fill(`Przydatne przed kolokwium ${STAMP}`);
	await contribute.locator('button[type="submit"]').click();
	await settle(student, 1500);
	check(
		'the submission is queued',
		/Submitted — waiting for review/.test(await contribute.innerText())
	);
	check(
		'and the contributor sees it marked pending',
		(await student.locator('.item--pending').count()) === 1
	);

	console.log('\n[5] It is invisible to everybody else until it is approved');
	await goto(outsider, `/courses/${courseId}`);
	const outsiderContent = await outsider.locator('.tab-panel').innerText();
	check(
		'a signed-out visitor sees no pending content',
		!outsiderContent.includes(material.title) &&
			(await outsider.locator('.item--pending').count()) === 0,
		outsiderContent.slice(0, 200)
	);
	await goto(coAdmin, `/courses/${courseId}`);
	check(
		'staff are told something is waiting',
		/1 waiting/.test(await coAdmin.locator('.manage-link').innerText())
	);

	console.log('\n[6] A co-admin approves it — approval is not the owner’s alone');
	await goto(coAdmin, `/courses/${courseId}/manage`);
	const queue = coAdmin.locator('section.queue');
	if ((await queue.count()) === 0) {
		await settle(coAdmin, 2500);
		if ((await queue.count()) === 0)
			console.log(
				'    (no queue rendered; headings:',
				await coAdmin.locator('.page h2').allTextContents(),
				')'
			);
	}
	const queueText = await queue.innerText();
	check(
		'the queue names the contributor and the note',
		/Offered by Bartek/.test(queueText) && queueText.includes(String(STAMP)),
		queueText.slice(0, 300)
	);
	await queue.getByRole('button', { name: 'Accept' }).first().click();
	await settle(coAdmin, 1500);
	// The queue component unmounts once nothing is pending; its section stays and says so.
	const reviewSection = coAdmin
		.locator('.page > section, .page section', {
			has: coAdmin.locator('h2', { hasText: /^Waiting for review$/ })
		})
		.first();
	check('the queue is empty afterwards', /Nothing waiting/.test(await reviewSection.innerText()));
	await goto(student, `/courses/${courseId}`);
	check(
		'the contributor no longer sees it pending',
		(await student.locator('.item--pending').count()) === 0
	);
	check(
		'and the content is in the course',
		(await student.locator('.tab-panel').innerText()).includes(material.title)
	);
	await goto(outsider, `/courses/${courseId}`);
	check(
		'now a visitor sees it too',
		(await outsider.locator('.tab-panel').innerText()).includes(material.title)
	);

	console.log('\n[7] Joining by link');
	const invites = coAdmin.locator('section.invites');
	await goto(coAdmin, `/courses/${courseId}/manage`);
	await invites.locator('form input[type="text"]').first().fill('Grupa ćwiczeniowa');
	await invites.locator('form select').selectOption('participant');
	await invites.locator('form button[type="submit"]').click();
	await settle(coAdmin, 1500);
	const link = await invites.locator('input.url').first().inputValue();
	check('a link is minted', /\/courses\/join\/.+/.test(link), link);
	const path = link.replace(/^https?:\/\/[^/]+/, '');
	await goto(outsider, path, 'main.join');
	const anonText = await outsider.locator('main.join').innerText();
	check(
		'a logged-out visitor sees whose course it is',
		/invited you to/.test(anonText) && anonText.includes(TITLE),
		anonText.slice(0, 200)
	);
	check(
		'and is offered to log in rather than joining',
		(await outsider.locator('main.join a', { hasText: 'Log in to accept' }).count()) === 1
	);
	check('while leaking nothing else', !/Invite links|Who runs this/.test(anonText));
	await goto(invitee, path, 'main.join');
	check(
		'a signed-in invitee is told they would take part',
		/join as a participant/.test(await invitee.locator('main.join').innerText())
	);
	await invitee.locator('main.join').getByRole('button', { name: 'Join' }).click();
	await invitee.waitForURL(new RegExp(`/courses/${courseId}$`), { timeout: 20000 });
	await settle(invitee, 1200);
	check(
		'and they are really in it',
		/You are taking part/.test(await invitee.locator('section.enrol').innerText())
	);
	await goto(coAdmin, `/courses/${courseId}/manage`);
	check('the link counts its use', /1 used/.test(await invites.innerText()));

	console.log('\n[8] A revoked link stops working');
	await invites.getByRole('button', { name: 'Revoke' }).first().click();
	await settle(coAdmin, 1200);
	check(
		'the link is marked revoked, not deleted',
		/Revoked/.test(await invites.innerText()) && (await invites.locator('input.url').count()) === 1
	);
	await goto(outsider, path, 'main.join');
	check(
		'and a fresh visitor is refused',
		/no longer works/.test(await outsider.locator('main.join').innerText())
	);
} catch (e) {
	fail++;
	console.log(`  FAIL the run aborted: ${e.message.split('\n')[0]}`);
} finally {
	for (const u of undo) await u();
	if (courseId) {
		const del = await api(`/courses/${courseId}/`, { token: olaToken, method: 'DELETE' });
		check(
			'cleanup: the scratch course is deleted',
			del.status === 204 || del.status === 200,
			String(del.status)
		);
	}
	await browser.close();
	console.log(`\n${pass} passed, ${fail} failed, ${errors.length} console/page errors`);
	for (const e of errors) console.log('  ' + e);
	process.exit(fail || errors.length ? 1 : 0);
}
