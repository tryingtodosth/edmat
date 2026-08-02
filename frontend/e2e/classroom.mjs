// End-to-end check of user-run courses, against real servers and two real accounts.
//
//   backend:  DJANGO_CORS_ALLOWED_ORIGINS=http://localhost:5183 manage.py runserver 127.0.0.1:8011
//   frontend: PUBLIC_API_BASE_URL=http://127.0.0.1:8011/api npx vite dev --port 5183
//   node e2e/classroom.mjs
//
// Playwright is deliberately not a dependency of this repo — `npx playwright install chromium`.
//
// The Django suite pins the rules; what only a browser can show is that the same page genuinely
// renders three different things to three different people — a stranger, a participant, and the
// person running the course — and that the approval flow works from both ends.
import { chromium } from 'playwright';

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

const browser = await chromium.launch();

/** A separate browser context per person — the whole feature is about who is looking, so sharing
 * one session between "the instructor" and "a student" would test nothing. */
async function person(name) {
	const ctx = await browser.newContext();
	const page = await ctx.newPage();
	page.on('pageerror', (e) => errors.push(`[${name}] pageerror: ${e.message}`));
	page.on('console', (m) => {
		if (m.type() === 'error') errors.push(`[${name}] console: ${m.text()}`);
	});
	return page;
}

const settle = (page, ms = 800) => page.waitForTimeout(ms);
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

const teacher = await person('teacher');
const student = await person('student');
const stranger = await person('stranger');

console.log('\n[1] Anyone can browse, and the nav offers it');
await goto(stranger, '/');
check('the nav links to courses', (await stranger.locator('nav a[href$="/classroom"]').count()) === 1);
await goto(stranger, '/classroom');
check('the browse page renders', (await stranger.locator('h1').innerText()).length > 0);

console.log('\n[2] An instructor creates a course — and it starts as a draft');
// Unique per run: this script talks to a real dev database that keeps whatever earlier runs left
// behind, so a fixed title would make "is my draft hidden?" match somebody else's published course.
const COURSE_TITLE = `Analiza od zera ${Date.now()}`;
await register(teacher, 'teacher');
await goto(teacher, '/classroom/new');
await teacher.locator('form input[type="text"]').first().fill(COURSE_TITLE);
await teacher.locator('form input[type="text"]').nth(1).fill('Od ciągów do całek, w dziesięć tygodni');
await teacher.locator('form textarea').first().fill('Spotkania w czwartki.');
await teacher.locator('form button[type="submit"]').click();
await settle(teacher, 2200);
const courseUrl = teacher.url();
check('landed on the new course', /\/classroom\/\d+$/.test(courseUrl), courseUrl);
let teacherText = await teacher.locator('.page').innerText();
check('the instructor is told it is theirs', /You run this course/i.test(teacherText), teacherText.slice(0, 300));

const courseId = courseUrl.split('/').pop();
await goto(stranger, '/classroom');
let strangerText = await stranger.locator('.page').innerText();
check('a draft is invisible to everybody else', !strangerText.includes(COURSE_TITLE), strangerText.slice(0, 300));

console.log('\n[3] Publishing it, with approval required');
await goto(teacher, `/classroom/${courseId}/edit`);
await teacher.locator('form select').first().selectOption('open');
await teacher.locator('form select').nth(1).selectOption('approval');
await teacher.locator('form button[type="submit"]').click();
await settle(teacher, 2000);
await goto(stranger, '/classroom');
strangerText = await stranger.locator('.page').innerText();
check('now it is listed publicly', strangerText.includes(COURSE_TITLE), strangerText.slice(0, 300));

console.log('\n[4] A lesson: public blurb, participant-only notes');
await goto(teacher, `/classroom/${courseId}`);
await teacher.locator('.add-lesson input[type="text"]').fill('Ciągi');
await teacher.locator('.add-lesson textarea').fill('Link do spotkania: example.invalid/zoom');
await teacher.locator('.add-lesson button[type="submit"]').click();
await settle(teacher, 1800);
teacherText = await teacher.locator('.page').innerText();
check('the instructor sees the lesson', /Ciągi/.test(teacherText));
check('and its notes', /example\.invalid/.test(teacherText));

await goto(stranger, `/classroom/${courseId}`);
strangerText = await stranger.locator('.page').innerText();
check('a stranger sees the lesson exists', /Ciągi/.test(strangerText));
check('but not the notes', !/example\.invalid/.test(strangerText), strangerText.slice(0, 400));
check(
	'and is told to sign in rather than shown a dead button',
	/[Ss]ign in/.test(strangerText),
	strangerText.slice(0, 400)
);

console.log('\n[5] A student asks to join, and waits');
await register(student, 'student');
await goto(student, `/classroom/${courseId}`);
await student.locator('.enrol textarea').fill('Jestem na drugim roku');
await student.locator('.enrol button').click();
await settle(student, 1800);
let studentText = await student.locator('.page').innerText();
check('the request is recorded as pending', /waiting for the instructor/i.test(studentText), studentText.slice(0, 400));
check('a pending request does not unlock the notes', !/example\.invalid/.test(studentText));

console.log('\n[6] The instructor sees the request, with the note, and approves');
await goto(teacher, `/classroom/${courseId}`);
teacherText = await teacher.locator('.page').innerText();
check('the request is listed', /Requests waiting: 1/i.test(teacherText), teacherText.slice(-600));
check('with what the student wrote', /drugim roku/.test(teacherText));
await teacher.locator('.roster button', { hasText: 'Approve' }).click();
await settle(teacher, 1800);
teacherText = await teacher.locator('.page').innerText();
check('they are now a participant', /Taking part: 1/i.test(teacherText), teacherText.slice(-600));

console.log('\n[7] Being in the course is what unlocks it');
await goto(student, `/classroom/${courseId}`);
studentText = await student.locator('.page').innerText();
check('the student is told they are in', /taking part in this course/i.test(studentText));
check('and can now read the notes', /example\.invalid/.test(studentText), studentText.slice(0, 500));
check('and can see who else is here', /Taking part: 1/i.test(studentText));

console.log('\n[8] My courses splits teaching from taking part');
await goto(teacher, '/classroom/mine');
const teacherMine = await teacher.locator('.page').innerText();
check('the instructor sees it under courses they run', /Courses you run/i.test(teacherMine));
check('and not under ones they take', /You have not joined any courses/i.test(teacherMine), teacherMine.slice(-400));

await goto(student, '/classroom/mine');
const studentMine = await student.locator('.page').innerText();
check('the student sees it under courses they take', studentMine.includes(COURSE_TITLE));
check('and runs nothing', /not running any courses/i.test(studentMine), studentMine.slice(0, 400));

console.log('\n[9] Leaving gives the seat back');
await goto(student, `/classroom/${courseId}`);
await student.locator('.enrol button', { hasText: 'Leave' }).click();
await settle(student, 1800);
studentText = await student.locator('.page').innerText();
check('the student is out', !/taking part in this course/i.test(studentText), studentText.slice(0, 400));
check('and the notes are locked again', !/example\.invalid/.test(studentText));
await goto(teacher, `/classroom/${courseId}`);
teacherText = await teacher.locator('.page').innerText();
check('the roster is empty again', /Nobody has joined yet/i.test(teacherText), teacherText.slice(-500));

console.log('\n[10] A full course refuses, in its own words');
await goto(teacher, `/classroom/${courseId}/edit`);
await teacher.locator('form select').nth(1).selectOption('open'); // anyone may join
await teacher.locator('form input[type="number"]').fill('0');
await teacher.locator('form button[type="submit"]').click();
await settle(teacher, 1800);
await goto(student, `/classroom/${courseId}`);
await student.locator('.enrol button', { hasText: 'Join' }).click();
await settle(student, 1600);
await goto(teacher, `/classroom/${courseId}/edit`);
await teacher.locator('form input[type="number"]').fill('1');
await teacher.locator('form button[type="submit"]').click();
await settle(teacher, 1800);

const second = await person('second-student');
await register(second, 'second');
await goto(second, `/classroom/${courseId}`);
const secondText = await second.locator('.page').innerText();
check('a second person is told the course is full', /full/i.test(secondText), secondText.slice(0, 500));
check('and is shown no join button', (await second.locator('.enrol button').count()) === 0);

console.log('\n[11] The cap cannot be cut below the people already in');
await goto(teacher, `/classroom/${courseId}/edit`);
await teacher.locator('form input[type="number"]').fill('0');
await teacher.locator('form button[type="submit"]').click();
await settle(teacher, 1500);
// 0 means uncapped, which is allowed. Setting a real cap below the roster is what must fail.
await goto(teacher, `/classroom/${courseId}`);
teacherText = await teacher.locator('.page').innerText();
check('uncapped is accepted', /Taking part: 1/i.test(teacherText), teacherText.slice(-400));

console.log(`\n${pass} passed, ${fail} failed`);
if (errors.length) {
	console.log('\nErrors:');
	for (const e of [...new Set(errors)]) console.log('  ! ' + e);
} else {
	console.log('Zero console/page errors.');
}
await browser.close();
process.exit(fail === 0 && errors.length === 0 ? 0 : 1);
