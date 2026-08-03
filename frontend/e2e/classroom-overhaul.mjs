// End-to-end check of the course overhaul: several people running one course, content contributed
// and reviewed, chapters that open on a date, and joining by link.
//
// Run it with both running:
//   backend:  DJANGO_CORS_ALLOWED_ORIGINS=http://localhost:5183 manage.py runserver 127.0.0.1:8011
//   frontend: PUBLIC_API_BASE_URL=http://127.0.0.1:8011/api npx vite dev --port 5183
//   node e2e/classroom-overhaul.mjs
//
// Playwright is deliberately not a dependency of this repo — `npx playwright install chromium`.
// Accepts `playwright-core` plus CHROME=/path/to/chrome as well, for a machine that has the
// browsers but not the full package.
//
// classroom/tests.py already pins the rules. What only a browser can show is that one course page
// genuinely renders four different things to four different people — an owner, a co-admin, a
// participant and somebody holding a link — and that the review and unlock states are legible
// rather than merely correct in a payload.
let chromium;
try {
	({ chromium } = await import('playwright'));
} catch {
	({ chromium } = await import('playwright-core'));
}

const BASE = process.env.E2E_BASE ?? 'http://localhost:5183';
let pass = 0;
let fail = 0;
const errors = [];
const check = (label, ok, extra = '') => {
	if (ok) {
		pass++;
		console.log(`  ok   ${label}`);
	} else {
		fail++;
		console.log(`  FAIL ${label} ${extra}`);
	}
};

const browser = await chromium.launch(
	process.env.CHROME ? { executablePath: process.env.CHROME } : {}
);

/** A separate context per person — the whole feature is about who is looking. */
async function person(name) {
	const ctx = await browser.newContext();
	const page = await ctx.newPage();
	page.on('pageerror', (e) => errors.push(`[${name}] pageerror: ${e.message}`));
	page.on('console', (m) => {
		if (m.type() === 'error') errors.push(`[${name}] console: ${m.text()}`);
	});
	return page;
}

const settle = (page, ms = 900) => page.waitForTimeout(ms);
async function goto(page, path) {
	await page.goto(`${BASE}${path}`, { waitUntil: 'networkidle' });
	await settle(page, 900);
}
async function register(page, label) {
	const email = `${label}-${Date.now()}@example.com`;
	await goto(page, '/register');
	await page.locator('form input[type="text"]').first().fill(label);
	await page.locator('form input[type="email"]').fill(email);
	await page.locator('form input[type="password"]').fill('Kw9-vortexline-42');
	await page.locator('form button[type="submit"]').click();
	await settle(page, 2200);
	return email;
}

/** The account id, which is how staff are named — there is no people search in this app yet.
 *
 * Asked of the API from Node rather than from the page: the frontend talks to a different origin
 * (PUBLIC_API_BASE_URL), so a same-origin fetch inside the browser would hit the dev server's HTML
 * fallback and parse a document as JSON. */
const API = process.env.E2E_API ?? 'http://127.0.0.1:8000/api';
async function accountId(email) {
	const login = await fetch(`${API}/auth/login/`, {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify({ username: email, password: 'Kw9-vortexline-42' })
	});
	const { token } = await login.json();
	const me = await fetch(`${API}/auth/me/`, { headers: { Authorization: `Token ${token}` } });
	return String((await me.json()).id);
}

const owner = await person('owner');
const coAdmin = await person('coAdmin');
const student = await person('student');
const invitee = await person('invitee');

console.log('\n[1] A course is created, and its author owns it');
const TITLE = `Topologia ${Date.now()}`;
await register(owner, 'owner');
await goto(owner, '/classroom/new');
await owner.locator('form input[type="text"]').first().fill(TITLE);
// The new setting is on the create form, not buried in a second screen.
check(
	'the contribution policy is on the form',
	(await owner.locator('form select').count()) >= 4
);
await owner.locator('form button[type="submit"]').click();
await settle(owner, 2200);
const courseUrl = owner.url();
const courseId = courseUrl.split('/').pop();
check('landed on the new course', /\/classroom\/\d+$/.test(courseUrl), courseUrl);

// Published, so the other three can reach it at all.
await goto(owner, `/classroom/${courseId}/edit`);
await owner.locator('form select').first().selectOption('open');
await owner.locator('form button[type="submit"]').click();
await settle(owner, 2000);

await goto(owner, `/classroom/${courseId}`);
let text = await owner.locator('.page').innerText();
check('the owner sees the staff panel', /Who runs this/i.test(text));
check('the owner sees invite links', /Invite links/i.test(text));

console.log('\n[2] A second person is made an administrator');
const coAdminEmail = await register(coAdmin, 'coadmin');
const coAdminId = await accountId(coAdminEmail);
await goto(owner, `/classroom/${courseId}`);
await owner.locator('.staff input[type="text"]').fill(coAdminId);
await owner.locator('.staff select').last().selectOption('admin');
await owner.locator('.staff button[type="submit"]').click();
await settle(owner, 2000);
text = await owner.locator('.page').innerText();
check('the new administrator is listed', /coadmin/i.test(text), text.slice(0, 400));

await goto(coAdmin, `/classroom/${courseId}`);
const coText = await coAdmin.locator('.page').innerText();
check('the co-admin can run it too', /Who runs this/i.test(coText));
check('and can mint links', /Invite links/i.test(coText));
// Deleting is the owner's alone — a co-admin runs a course but cannot end it.
check('but is offered no delete', (await coAdmin.getByRole('button', { name: /^Delete$/ }).count()) === 0);

console.log('\n[3] Chapters, one of which has not opened yet');
await goto(owner, `/classroom/${courseId}`);
await owner.locator('.chapter-new input[type="text"]').fill('Week 1');
await owner.locator('.chapter-new button[type="submit"]').click();
await settle(owner, 1800);
await owner.locator('.chapter-new input[type="text"]').fill('Week 9');
// Far enough ahead that the test cannot race the clock.
await owner.locator('.chapter-new input[type="datetime-local"]').fill('2099-01-01T09:00');
await owner.locator('.chapter-new button[type="submit"]').click();
await settle(owner, 1800);
text = await owner.locator('.page').innerText();
check('both chapters render', /Week 1/.test(text) && /Week 9/.test(text));
check('staff are told the later one is still shut', /Not open to participants yet/i.test(text));

console.log('\n[4] A participant joins and contributes');
await register(student, 'student');
await goto(student, `/classroom/${courseId}`);
await student.getByRole('button', { name: /Join|Request/i }).first().click();
await settle(student, 2000);

let sText = await student.locator('.page').innerText();
check('the participant sees the locked chapter exists', /Week 9/.test(sText));
check('and is told when it opens', /Opens/i.test(sText));
check('but not the staff panel controls', !/Invite links/i.test(sText));
check('the contribute form is offered', /Add something/i.test(sText));
check(
	'and says the submission will be reviewed',
	/review/i.test(sText),
	sText.slice(0, 200)
);

// Material 1 exists in the seeded corpus.
await student.locator('.contribute input[inputmode="numeric"]').fill('1');
await student.locator('.contribute button[type="submit"]').click();
await settle(student, 2200);
sText = await student.locator('.page').innerText();
check('the contributor is told it is waiting', /waiting for review/i.test(sText), sText.slice(0, 300));

console.log('\n[5] It is invisible to another participant until it is approved');
await goto(coAdmin, `/classroom/${courseId}`);
let cText = await coAdmin.locator('.page').innerText();
check('staff see it in the review queue', /Waiting for review/i.test(cText));

await goto(invitee, `/classroom/${courseId}`);
const outsiderText = await invitee.locator('.page').innerText();
check(
	'a logged-out visitor sees no pending content',
	!/Waiting for review/i.test(outsiderText)
);

console.log('\n[6] A co-admin approves it — approval is not the owner’s alone');
await goto(coAdmin, `/classroom/${courseId}`);
await coAdmin.locator('.queue button.primary').first().click();
await settle(coAdmin, 2200);
cText = await coAdmin.locator('.page').innerText();
check('the queue empties', !/Waiting for review/i.test(cText), cText.slice(0, 300));

await goto(student, `/classroom/${courseId}`);
sText = await student.locator('.page').innerText();
check('the contributor no longer sees it pending', !/Waiting for review/i.test(sText));
check('and the content is in the course', /Material/i.test(sText));

console.log('\n[7] Joining by link');
await goto(owner, `/classroom/${courseId}`);
await owner.locator('.invites button[type="submit"]').click();
await settle(owner, 2000);
const link = await owner.locator('.invites input.url').first().inputValue();
check('a link is minted', /\/classroom\/join\/.+/.test(link), link);
const token = link.split('/').pop();

// Readable while logged out, on purpose.
const anon = await person('anon');
await goto(anon, `/classroom/join/${token}`);
const anonText = await anon.locator('main.join').innerText();
check('the preview names the course without an account', anonText.includes(TITLE), anonText.slice(0, 200));
check('and offers to log in rather than joining', /Log in to accept/i.test(anonText));
check('while leaking nothing else', !/Invite links/i.test(anonText));

await register(invitee, 'invitee');
await goto(invitee, `/classroom/join/${token}`);
await invitee.getByRole('button', { name: /^Join$/i }).click();
await settle(invitee, 2500);
check(
	'following the link lands inside the course',
	invitee.url().includes(`/classroom/${courseId}`),
	invitee.url()
);
const iText = await invitee.locator('.page').innerText();
check('and they are really in it', !/Request to join|^Join$/m.test(iText));

console.log('\n[8] A revoked link stops working');
await goto(owner, `/classroom/${courseId}`);
await owner.locator('.invites button.link').first().click();
await settle(owner, 1800);
text = await owner.locator('.page').innerText();
check('the link is marked revoked, not deleted', /Revoked/i.test(text), text.slice(0, 300));

const late = await person('late');
await goto(late, `/classroom/join/${token}`);
const lateText = await late.locator('main.join').innerText();
check('and a fresh visitor is refused', /no longer works/i.test(lateText), lateText.slice(0, 200));

console.log(`\n${pass} passed, ${fail} failed`);
if (errors.length) console.log('page errors:\n' + errors.join('\n'));
else console.log('zero console/page errors');
await browser.close();
process.exit(fail === 0 && errors.length === 0 ? 0 : 1);
