// A course's licence, one item's own audience, and collaborators added from the create form
// (owner, 2026-11-02; `backend/courses/test_licence_privacy.py` is the server half). Drives the real
// pages with tokens, not the login form (trap 30):
//
//  1. /courses/new — pick CC BY-SA, add an address to "Invite by email", create. The founder's own
//     address is NOT confirmed yet, so the course is made and the page stays to say the invitation
//     did not go out and why (the partial-success summary). Then the address is confirmed and the
//     manage page's own email form sends it.
//  2. The course page — the licence line; a corpus material (rights `unknown`) with its quiet note;
//     a staff-only item with its chip; the visibility select changing an item's audience.
//  3. A participant and a stranger see what their audience admits, and no more.
//  4. The join page of a mailed invite says the course's licence.
//
//   LD_LIBRARY_PATH=/home/piotr/syslibs/usr/lib/x86_64-linux-gnu \
//   CHROME=~/.cache/ms-playwright/chromium_headless_shell-1248/chrome-headless-shell-linux64/chrome-headless-shell \
//   E2E_TOKEN=<u-michal, verified> E2E_PLAIN_TOKEN=<u-ola> \
//   E2E_MATERIAL=<a published material whose licence is unknown> node e2e/course-licence-collab.mjs
//
// Step 1 confirms the founder's address through `manage.py shell` (there is no API for that short
// of opening the mail), so it needs `E2E_MANAGE` = the backend's `manage.py` path and the venv python.
import { execFileSync } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { englishContext } from './english.mjs';

let chromium;
try {
	({ chromium } = await import('playwright'));
} catch {
	({ chromium } = await import('playwright-core'));
}

const BASE = process.env.E2E_BASE ?? 'http://localhost:5173';
const API = process.env.E2E_API ?? 'http://localhost:8000/api';
const OWNER = process.env.E2E_TOKEN;
const PLAIN = process.env.E2E_PLAIN_TOKEN;
const MATERIAL = process.env.E2E_MATERIAL;
const MANAGE =
	process.env.E2E_MANAGE ?? new URL('../../backend/manage.py', import.meta.url).pathname;
const PYTHON =
	process.env.E2E_PYTHON ?? new URL('../../.venv/bin/python3', import.meta.url).pathname;
if (!OWNER || !PLAIN || !MATERIAL) throw new Error('E2E_TOKEN, E2E_PLAIN_TOKEN, E2E_MATERIAL');
const SHOTS = process.env.SHOTS ?? new URL('./screens/course-licence/', import.meta.url).pathname;
mkdirSync(SHOTS, { recursive: true });
const STAMP = Date.now();

let pass = 0,
	fail = 0;
const check = (label, ok, detail = '') => {
	if (ok) pass++;
	else fail++;
	console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${label}${ok ? '' : ' — ' + detail}`);
};
async function api(token, method, path, body) {
	const res = await fetch(`${API}${path}`, {
		method,
		headers: {
			'Content-Type': 'application/json',
			...(token ? { Authorization: `Token ${token}` } : {})
		},
		body: body ? JSON.stringify(body) : undefined
	});
	const text = await res.text();
	return { status: res.status, data: text ? JSON.parse(text) : null };
}
function shell(code) {
	// The LAST line: `manage.py shell` prints its auto-import banner ("217 objects imported
	// automatically …") first, and the first run of this script mailed those words as addresses.
	const out = execFileSync(PYTHON, [MANAGE, 'shell', '-c', code], { encoding: 'utf8' }).trim();
	return out.split('\n').pop().trim();
}

const browser = await chromium.launch(
	process.env.CHROME ? { executablePath: process.env.CHROME } : {}
);
const errors = [];
async function contextFor(token, { width = 1280, height = 900, english = true } = {}) {
	const ctx = english
		? await englishContext(browser, BASE, { viewport: { width, height } })
		: await browser.newContext({ viewport: { width, height } });
	if (token) await ctx.addInitScript((t) => localStorage.setItem('edmat-auth-token', t), token);
	const page = await ctx.newPage();
	page.on('pageerror', (e) => errors.push(String(e)));
	return { ctx, page };
}

// Start unconfirmed, so the summary path is the one exercised first.
const ownerEmail = shell(
	`from rest_framework.authtoken.models import Token; from mail.models import ConfirmedEmail; u=Token.objects.get(key='${OWNER}').user; ConfirmedEmail.objects.filter(user=u).delete(); print(u.email)`
);

console.log('1. the create form');
const owner = await contextFor(OWNER);
let page = owner.page;
await page.goto(`${BASE}/courses/new`, { waitUntil: 'domcontentloaded' });
await page.getByRole('heading', { level: 1 }).waitFor();
await page.locator('[data-testid="course-licence"]').waitFor();
const title = `Licence check ${STAMP}`;
await page.getByLabel('Title').fill(title);
await page.locator('form select:has(option[value="university"])').selectOption('university');
await page.locator('input[name="course-licence"][value="cc-by-sa-4.0"]').check();
const invitee = `invitee-${STAMP}@example.com`;
await page.locator('[data-testid="collab-emails"]').fill(`${invitee}, not-an-address`);
await page.locator('[data-testid="collab-licence"]').waitFor();
check(
	'the collaborators block names the chosen licence',
	(await page.locator('[data-testid="collab-licence"]').innerText()).includes('CC BY-SA 4.0')
);
await page
	.locator('[data-testid="collab-confirm-first"]')
	.waitFor({ timeout: 5000 })
	.catch(() => {});
check(
	'an unconfirmed founder is told before submitting',
	await page.locator('[data-testid="collab-confirm-first"]').isVisible()
);
await page.screenshot({ path: `${SHOTS}01-create-form.png`, fullPage: true });
await page.getByRole('button', { name: 'Create the course' }).click();
await page.locator('[data-testid="collab-outcome"]').waitFor({ timeout: 15000 });
const outcomeText = await page.locator('[data-testid="collab-outcome"]').innerText();
check('the course is made and the page stays to explain', /course is made/i.test(outcomeText));
check(
	'it says why the invitation did not go',
	/confirm your own email/i.test(outcomeText),
	outcomeText
);
await page.screenshot({ path: `${SHOTS}02-create-outcome.png`, fullPage: true });

const mine = await api(OWNER, 'GET', '/courses/?mine=true');
let course = (Array.isArray(mine.data) ? mine.data : []).find((c) => c.title === title);
if (!course) {
	const all = await api(OWNER, 'GET', `/courses/?q=${encodeURIComponent(title)}`);
	course = (all.data ?? []).find((c) => c.title === title);
}
check(
	'the course exists with the chosen licence',
	course?.licence === 'cc-by-sa-4.0',
	JSON.stringify(course?.licence)
);
const courseId = course.id;
await api(OWNER, 'PATCH', `/courses/${courseId}/`, { visibility: 'public' });

console.log('   confirm the address, then the manage page sends it');
shell(
	`from rest_framework.authtoken.models import Token; from mail.models import ConfirmedEmail; u=Token.objects.get(key='${OWNER}').user; ConfirmedEmail.objects.update_or_create(user=u, defaults={'email': u.email})`
);
await page.goto(`${BASE}/courses/${courseId}/manage`, { waitUntil: 'domcontentloaded' });
await page.locator('[data-testid="course-email-invites"]').waitFor();
await page
	.locator('[data-testid="email-invites-text"]')
	.fill(`${invitee}\nnot-an-address\n${ownerEmail}`);
await page.getByRole('button', { name: 'Send invitations' }).click();
await page.locator('[data-testid="email-invites-results"]').waitFor({ timeout: 15000 });
const results = await page.locator('[data-testid="email-invites-results"]').innerText();
check('the invitation is sent', results.includes(`${invitee} — invitation sent`), results);
check(
	'a bad address gets its own reason',
	/not-an-address — That is not an email address/.test(results),
	results
);
check('your own address gets its own reason', /That is your own address/.test(results), results);
check(
	'exactly three answers, one per address',
	(await page.locator('[data-testid="email-invites-results"] li').count()) === 3
);
check(
	'only what failed stays in the box',
	!(await page.locator('[data-testid="email-invites-text"]').inputValue()).includes(invitee)
);
await page
	.getByText(`Sent to ${invitee}`)
	.first()
	.waitFor({ timeout: 5000 })
	.catch(() => {});
check(
	'the invite list says who it was sent to',
	await page.getByText(`Sent to ${invitee}`).first().isVisible()
);
await page.screenshot({ path: `${SHOTS}03-manage-email-invites.png`, fullPage: true });

const invites = await api(OWNER, 'GET', `/courses/${courseId}/invites/`);
const mailed = (invites.data ?? []).find((i) => i.sent_to === invitee);
check('a one-use invite with the address', mailed?.max_uses === 1, JSON.stringify(mailed));
const logged = shell(
	`from mail.models import OutboundEmail; r=OutboundEmail.objects.filter(kind='course_invite', to='${invitee}').first(); print(r.status if r else 'none', '[[link]]' in (r.body if r else ''), '${mailed?.token ?? 'x'}' in (r.body if r else ''))`
);
check('the mail is logged without a working link', logged.endsWith('True False'), logged);

console.log('2. the course page');
const chapter = await api(OWNER, 'POST', `/courses/${courseId}/chapters/`, {
	title: 'Week 1',
	order: 0
});
const corpus = await api(OWNER, 'POST', `/courses/${courseId}/items/`, {
	material: Number(MATERIAL),
	chapter: chapter.data.id
});
check('a corpus material is linked', corpus.status === 201, JSON.stringify(corpus.data));
check(
	'its relation is unclear',
	corpus.data?.licence_relation === 'unclear',
	corpus.data?.licence_relation
);
const outside = await api(OWNER, 'POST', `/courses/${courseId}/items/`, {
	link_url: `https://example.com/key-${STAMP}`,
	link_title: `Answer key ${STAMP}`,
	chapter: chapter.data.id,
	visibility: 'staff'
});
check(
	'a staff-only item is filed',
	outside.data?.visibility === 'staff',
	JSON.stringify(outside.data)
);
const cohort = await api(OWNER, 'POST', `/courses/${courseId}/items/`, {
	link_url: `https://example.com/cohort-${STAMP}`,
	link_title: `Cohort paper ${STAMP}`,
	chapter: chapter.data.id,
	visibility: 'participants'
});
check('a participants-only item is filed', cohort.status === 201, JSON.stringify(cohort.data));

await page.goto(`${BASE}/courses/${courseId}`, { waitUntil: 'domcontentloaded' });
await page.locator('[data-testid="item-licence-note"]').first().waitFor({ timeout: 15000 });
const note = await page.locator('[data-testid="item-licence-note"]').first().innerText();
check(
	'the corpus material carries the quiet note',
	/not yet clarified/.test(note) && note.includes('CC BY-SA 4.0'),
	note
);
check(
	'the course shows its own licence line',
	(await page
		.locator('.course-licence [data-testid="licence-notice"]')
		.getAttribute('data-licence')) === 'cc-by-sa-4.0'
);
// A curator gets the select instead of the chip; a participant gets the chip.
const chips = await page
	.locator('[data-testid="item-visibility"]')
	.evaluateAll((els) => els.map((el) => el.options[el.selectedIndex].text));
check(
	'the narrowed items show their audience to the curator',
	chips.some((c) => c.includes('Staff only')) && chips.some((c) => c.includes('Participants only')),
	chips.join('|')
);
await page.locator('[data-testid="item-licence-note"]').first().scrollIntoViewIfNeeded();
await page.screenshot({ path: `${SHOTS}04-course-page-owner.png`, fullPage: true });

console.log('3. who sees what');
await api(PLAIN, 'POST', `/courses/${courseId}/enrol/`, {});
const participant = await contextFor(PLAIN);
await participant.page.goto(`${BASE}/courses/${courseId}`, { waitUntil: 'domcontentloaded' });
await participant.page
	.locator('[data-testid="item-licence-note"]')
	.first()
	.waitFor({ timeout: 15000 });
const pBody = await participant.page.locator('main').innerText();
check('a participant sees the cohort item', pBody.includes(`Cohort paper ${STAMP}`));
check('a participant does not see the staff-only item', !pBody.includes(`Answer key ${STAMP}`));
check(
	'a participant gets no visibility control',
	(await participant.page.locator('[data-testid="item-visibility"]').count()) === 0
);
check(
	'but sees the chip on the cohort item',
	(await participant.page.locator('[data-testid="item-audience"]').allInnerTexts()).some((t) =>
		t.includes('Participants only')
	)
);
await participant.page.screenshot({
	path: `${SHOTS}05-course-page-participant.png`,
	fullPage: true
});

const stranger = await contextFor(null);
await stranger.page.goto(`${BASE}/courses/${courseId}`, { waitUntil: 'domcontentloaded' });
await stranger.page
	.locator('[data-testid="item-licence-note"]')
	.first()
	.waitFor({ timeout: 15000 });
const sBody = await stranger.page.locator('main').innerText();
check(
	'a stranger sees neither narrowed item',
	!sBody.includes(`Cohort paper ${STAMP}`) && !sBody.includes(`Answer key ${STAMP}`)
);

console.log('   the visibility select');
const row = page.locator('li.item', { hasText: `Cohort paper ${STAMP}` });
await row.locator('[data-testid="item-visibility"]').selectOption('staff');
await page.waitForTimeout(1200);
const after = await api(OWNER, 'GET', `/courses/${courseId}/items/`);
check(
	'the select changes the item for real',
	(after.data ?? []).find((i) => i.id === cohort.data.id)?.visibility === 'staff'
);
const pAfter = await api(PLAIN, 'GET', `/courses/${courseId}/items/`);
check(
	'and the participant no longer gets it',
	!(pAfter.data ?? []).some((i) => i.id === cohort.data.id)
);

console.log('   the link editor offers the audience before adding');
await page.reload({ waitUntil: 'domcontentloaded' });
await page.locator('[data-testid="item-licence-note"]').first().waitFor({ timeout: 15000 });

console.log('4. the join page');
const join = await contextFor(null);
await join.page.goto(`${BASE}/courses/join/${mailed.token}`, { waitUntil: 'domcontentloaded' });
await join.page.locator('[data-testid="join-licence"]').waitFor({ timeout: 15000 });
check(
	'the join page names the course licence',
	(await join.page.locator('[data-testid="join-licence"]').innerText()).includes('CC BY-SA 4.0')
);
await join.page.screenshot({ path: `${SHOTS}06-join-page.png`, fullPage: true });

console.log('5. Polish and a phone');
const pl = await contextFor(OWNER, { width: 390, height: 844, english: false });
await pl.page.goto(`${BASE}/courses/${courseId}`, { waitUntil: 'domcontentloaded' });
await pl.page.locator('[data-testid="item-licence-note"]').first().waitFor({ timeout: 15000 });
const plNote = await pl.page.locator('[data-testid="item-licence-note"]').first().innerText();
check('the note is Polish in a Polish context', /nie są jeszcze wyjaśnione/.test(plNote), plNote);
const overflow = await pl.page.evaluate(
	() => document.documentElement.scrollWidth > window.innerWidth + 1
);
check('nothing runs off a 390 px screen', !overflow);
await pl.page.locator('[data-testid="item-licence-note"]').first().scrollIntoViewIfNeeded();
await pl.page.screenshot({ path: `${SHOTS}07-course-page-pl-390.png` });
await pl.page.goto(`${BASE}/courses/new`, { waitUntil: 'domcontentloaded' });
await pl.page.locator('[data-testid="course-collaborators"]').waitFor({ timeout: 15000 });
await pl.page.locator('[data-testid="course-collaborators"]').scrollIntoViewIfNeeded();
await pl.page.screenshot({ path: `${SHOTS}08-create-form-pl-390.png`, fullPage: true });

console.log('5a. a pinned set: its own audience');
const setSlug = shell(
	`from rest_framework.authtoken.models import Token; from study.models import ExerciseSet, ExerciseSetItem; from exercises.models import Exercise; u=Token.objects.get(key='${OWNER}').user; s=ExerciseSet.objects.create(owner=u, name='Staff warm-up ${STAMP}', is_public=True); ExerciseSetItem.objects.create(exercise_set=s, exercise=Exercise.objects.filter(published=True).first(), order=0); print(s.slug)`
);
const pinned = await api(
	OWNER,
	'POST',
	`/courses/${courseId}/chapters/${chapter.data.id}/exercise-sets/`,
	{
		set: setSlug,
		visibility: 'staff'
	}
);
check(
	'a staff-only set is pinned',
	pinned.data?.visibility === 'staff',
	JSON.stringify(pinned.data)
);
await page.goto(`${BASE}/courses/${courseId}`, { waitUntil: 'domcontentloaded' });
const setBlock = page.locator('article.set', { hasText: `Staff warm-up ${STAMP}` });
await setBlock.waitFor({ timeout: 15000 });
check(
	'the curator sees the set’s audience in its select',
	(await setBlock.locator('[data-testid="set-visibility"]').inputValue()) === 'staff'
);
await setBlock.scrollIntoViewIfNeeded();
await page.screenshot({ path: `${SHOTS}12-set-owner.png`, fullPage: true });
await participant.page.goto(`${BASE}/courses/${courseId}`, { waitUntil: 'domcontentloaded' });
await participant.page
	.locator('[data-testid="item-licence-note"]')
	.first()
	.waitFor({ timeout: 15000 });
check(
	'a participant does not see the staff-only set',
	!(await participant.page.locator('main').innerText()).includes(`Staff warm-up ${STAMP}`)
);
await setBlock.locator('[data-testid="set-visibility"]').selectOption('participants');
await page.waitForTimeout(1200);
await participant.page.reload({ waitUntil: 'domcontentloaded' });
await participant.page
	.locator('article.set', { hasText: `Staff warm-up ${STAMP}` })
	.waitFor({ timeout: 15000 })
	.catch(() => {});
check(
	'after the select, the participant does',
	(await participant.page.locator('main').innerText()).includes(`Staff warm-up ${STAMP}`)
);
shell(
	`from study.models import ExerciseSet; ExerciseSet.objects.filter(slug='${setSlug}').delete(); print('ok')`
);

console.log('5b. course files: their own audience');
const pdf = Buffer.concat([Buffer.from('%PDF-1.4\n'), Buffer.alloc(2048, 0x30)]);
await page.goto(`${BASE}/courses/${courseId}?tab=attachments`, { waitUntil: 'domcontentloaded' });
const filesForm = page.locator('section.attachments-section form');
await filesForm.waitFor({ timeout: 15000 });
await filesForm.getByLabel('Title').fill(`Marking scheme ${STAMP}`);
await filesForm.locator('input[type="file"]').setInputFiles({
	name: 'scheme.pdf',
	mimeType: 'application/pdf',
	buffer: pdf
});
await filesForm.locator('[data-testid="attachment-visibility-new"]').selectOption('staff');
await filesForm.getByRole('button', { name: 'Upload a file' }).click();
await page
	.locator('section.attachments-section li', { hasText: `Marking scheme ${STAMP}` })
	.waitFor({ timeout: 15000 });
const ownerFiles = await api(OWNER, 'GET', `/courses/${courseId}/attachments/`);
const scheme = (ownerFiles.data ?? []).find((a) => a.title === `Marking scheme ${STAMP}`);
check('the file is uploaded staff-only', scheme?.visibility === 'staff', JSON.stringify(scheme));
check('its licence starts from the course’s', scheme?.licence === 'cc-by-sa-4.0', scheme?.licence);
const plainFiles = await api(PLAIN, 'GET', `/courses/${courseId}/attachments/`);
check(
	'a participant does not get it',
	!(plainFiles.data ?? []).some((a) => a.id === scheme?.id),
	JSON.stringify(plainFiles.data)
);
check(
	'nor its page',
	(await api(PLAIN, 'GET', `/courses/${courseId}/attachments/${scheme?.id}/`)).status === 404
);

// A participant hands homework to the teacher alone (multipart through the API).
const form = new FormData();
form.append('file', new Blob([pdf], { type: 'application/pdf' }), 'homework.pdf');
form.append('title', `Homework ${STAMP}`);
form.append('visibility', 'staff');
const hw = await fetch(`${API}/courses/${courseId}/attachments/`, {
	method: 'POST',
	headers: { Authorization: `Token ${PLAIN}` },
	body: form
}).then((r) => r.json());
check('a participant uploads a staff-only file', hw.visibility === 'staff', JSON.stringify(hw));

await participant.page.goto(`${BASE}/courses/${courseId}?tab=attachments`, {
	waitUntil: 'domcontentloaded'
});
await participant.page
	.locator('section.attachments-section li', { hasText: `Homework ${STAMP}` })
	.waitFor({ timeout: 15000 });
const pFiles = await participant.page.locator('section.attachments-section').innerText();
check('the participant sees their own homework', pFiles.includes(`Homework ${STAMP}`));
check('and not the marking scheme', !pFiles.includes(`Marking scheme ${STAMP}`));
await participant.page.screenshot({ path: `${SHOTS}09-files-participant.png`, fullPage: true });

await page.reload({ waitUntil: 'domcontentloaded' });
const hwRow = page.locator('section.attachments-section li', { hasText: `Homework ${STAMP}` });
await hwRow.waitFor({ timeout: 15000 });
check('the teacher sees the homework', await hwRow.isVisible());
await hwRow.locator('[data-testid="attachment-visibility"]').selectOption('participants');
await page.waitForTimeout(1200);
const after2 = await api(OWNER, 'GET', `/courses/${courseId}/attachments/${hw.id}/`);
check('a curator widens it from the list', after2.data?.visibility === 'participants');
await page.screenshot({ path: `${SHOTS}10-files-owner.png`, fullPage: true });

await page.goto(`${BASE}/courses/${courseId}/attachments/${scheme.id}`, {
	waitUntil: 'domcontentloaded'
});
await page.locator('[data-testid="licence-notice"]').waitFor({ timeout: 15000 });
check(
	'the file page carries its licence line',
	(await page.locator('[data-testid="licence-notice"]').getAttribute('data-licence')) ===
		'cc-by-sa-4.0'
);
check(
	'and says who sees it',
	(await page.locator('[data-testid="attachment-audience"]').innerText()).includes('Staff only')
);
await page.screenshot({ path: `${SHOTS}11-file-page.png`, fullPage: true });

console.log('6. clean up');
await api(PLAIN, 'POST', `/courses/${courseId}/leave/`, {});
const gone = await api(OWNER, 'DELETE', `/courses/${courseId}/`);
check('the scratch course is deleted', gone.status === 204, String(gone.status));
check('and is really gone', (await api(OWNER, 'GET', `/courses/${courseId}/`)).status === 404);

check('no page errors', errors.length === 0, errors.join(' | '));
await browser.close();
console.log(`\n${pass} passed, ${fail} failed — screenshots in ${SHOTS}`);
process.exit(fail ? 1 : 0);
