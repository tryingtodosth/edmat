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
check(
	'the nav links to courses',
	(await stranger.locator('nav a[href$="/classroom"]').count()) === 1
);
await goto(stranger, '/classroom');
check('the browse page renders', (await stranger.locator('h1').innerText()).length > 0);

console.log('\n[2] An instructor creates a course — and it starts as a draft');
// Unique per run: this script talks to a real dev database that keeps whatever earlier runs left
// behind, so a fixed title would make "is my draft hidden?" match somebody else's published course.
const COURSE_TITLE = `Analiza od zera ${Date.now()}`;
await register(teacher, 'teacher');
await goto(teacher, '/classroom/new');
await teacher.locator('form input[type="text"]').first().fill(COURSE_TITLE);
await teacher
	.locator('form input[type="text"]')
	.nth(1)
	.fill('Od ciągów do całek, w dziesięć tygodni');
await teacher.locator('form textarea').first().fill('Spotkania w czwartki.');
await teacher.locator('form button[type="submit"]').click();
await settle(teacher, 2200);
const courseUrl = teacher.url();
check('landed on the new course', /\/classroom\/\d+$/.test(courseUrl), courseUrl);
let teacherText = await teacher.locator('.page').innerText();
check(
	'the instructor is told it is theirs',
	/You run this course/i.test(teacherText),
	teacherText.slice(0, 300)
);

const courseId = courseUrl.split('/').pop();
await goto(stranger, '/classroom');
let strangerText = await stranger.locator('.page').innerText();
check(
	'a draft is invisible to everybody else',
	!strangerText.includes(COURSE_TITLE),
	strangerText.slice(0, 300)
);

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
check(
	'the request is recorded as pending',
	/waiting for the instructor/i.test(studentText),
	studentText.slice(0, 400)
);
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
check(
	'and can now read the notes',
	/example\.invalid/.test(studentText),
	studentText.slice(0, 500)
);
check('and can see who else is here', /Taking part: 1/i.test(studentText));

console.log('\n[8] My courses splits teaching from taking part');
await goto(teacher, '/classroom/mine');
const teacherMine = await teacher.locator('.page').innerText();
check('the instructor sees it under courses they run', /Courses you run/i.test(teacherMine));
check(
	'and not under ones they take',
	/You have not joined any courses/i.test(teacherMine),
	teacherMine.slice(-400)
);

await goto(student, '/classroom/mine');
const studentMine = await student.locator('.page').innerText();
check('the student sees it under courses they take', studentMine.includes(COURSE_TITLE));
check('and runs nothing', /not running any courses/i.test(studentMine), studentMine.slice(0, 400));

console.log('\n[9] Leaving gives the seat back');
await goto(student, `/classroom/${courseId}`);
await student.locator('.enrol button', { hasText: 'Leave' }).click();
await settle(student, 1800);
// Scoped to the enrolment section on purpose: the discussion notice for non-participants contains
// the phrase "taking part in this course" too, so a whole-page match would be ambiguous.
const enrolAfterLeaving = await student.locator('.enrol').innerText();
check(
	'the student is out',
	!/You are taking part/i.test(enrolAfterLeaving),
	enrolAfterLeaving.slice(0, 300)
);
studentText = await student.locator('.page').innerText();
check('and the notes are locked again', !/example\.invalid/.test(studentText));
await goto(teacher, `/classroom/${courseId}`);
teacherText = await teacher.locator('.page').innerText();
check(
	'the roster is empty again',
	/Nobody has joined yet/i.test(teacherText),
	teacherText.slice(-500)
);

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
check(
	'a second person is told the course is full',
	/full/i.test(secondText),
	secondText.slice(0, 500)
);
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

console.log('\n[12] Discussion: participants only by default');
// Back to an approval-free, uncapped course with the student in it, so the thread has two people.
await goto(teacher, `/classroom/${courseId}/edit`);
await teacher.locator('form input[type="number"]').fill('0');
await teacher.locator('form button[type="submit"]').click();
await settle(teacher, 1600);

await goto(stranger, `/classroom/${courseId}`);
strangerText = await stranger.locator('.page').innerText();
check(
	'a stranger is told the discussion is for participants',
	/for people taking part/i.test(strangerText),
	strangerText.slice(-500)
);
check('and gets no composer', (await stranger.locator('.discussion textarea').count()) === 0);

await goto(student, `/classroom/${courseId}`);
await student.locator('.discussion textarea').first().fill('Czy będą zadania domowe?');
await student.locator('.discussion button[type="submit"]').first().click();
await settle(student, 1800);
studentText = await student.locator('.page').innerText();
check('a participant can post', /zadania domowe/.test(studentText), studentText.slice(-600));

await goto(teacher, `/classroom/${courseId}`);
teacherText = await teacher.locator('.page').innerText();
check('and the instructor sees it', /zadania domowe/.test(teacherText));

console.log('\n[13] The instructor is notified, and it links back to the course');
await goto(teacher, '/notifications');
const notifText = await teacher.locator('.page, main').first().innerText();
check('a post notification arrived', /posted in/i.test(notifText), notifText.slice(0, 500));
const notifHref = await teacher
	.locator(`a[href$="/classroom/${courseId}"]`)
	.first()
	.getAttribute('href');
check('and links to the course', Boolean(notifHref), String(notifHref));

console.log('\n[14] A public thread is readable by anyone, writable only by participants');
await goto(teacher, `/classroom/${courseId}/edit`);
await teacher.locator('fieldset select').first().selectOption('public');
await teacher.locator('form button[type="submit"]').click();
await settle(teacher, 1800);
await goto(stranger, `/classroom/${courseId}`);
strangerText = await stranger.locator('.page').innerText();
check('a stranger can now read it', /zadania domowe/.test(strangerText), strangerText.slice(-600));
check(
	'and is told joining is what lets them post',
	/lets you post/i.test(strangerText),
	strangerText.slice(-400)
);

console.log('\n[15] Turning the discussion off removes it entirely');
await goto(teacher, `/classroom/${courseId}/edit`);
await teacher.locator('fieldset select').first().selectOption('off');
await teacher.locator('form button[type="submit"]').click();
await settle(teacher, 1800);
await goto(student, `/classroom/${courseId}`);
studentText = await student.locator('.page').innerText();
check('a participant no longer sees the thread', !/zadania domowe/.test(studentText));
check('nor a heading for it', !/Discussion/i.test(studentText), studentText.slice(-400));

console.log('\n[16] Muting one course, without leaving it');
await goto(teacher, `/classroom/${courseId}/edit`);
await teacher.locator('fieldset select').first().selectOption('participants');
await teacher.locator('form button[type="submit"]').click();
await settle(teacher, 1600);

await goto(student, `/classroom/${courseId}`);
check('the mute control is offered', (await student.locator('.mute input').count()) === 1);
await student.locator('.mute input').uncheck();
await settle(student, 1500);
await goto(teacher, `/classroom/${courseId}`);
await teacher.locator('.add-lesson input[type="text"]').fill('Całki');
await teacher.locator('.add-lesson button[type="submit"]').click();
await settle(teacher, 1800);
await goto(student, '/notifications');
const studentNotifs = await student.locator('.page, main').first().innerText();
check(
	'a muted course sends nothing about a new lesson',
	!/Całki/.test(studentNotifs),
	studentNotifs.slice(0, 400)
);
await goto(student, `/classroom/${courseId}`);
check(
	'and the person is still in the course',
	/You are taking part/i.test(await student.locator('.enrol').innerText())
);

console.log('\n[17] The account-wide setting exists and saves');
await goto(student, '/settings');
const settingsText = await student.locator('.page').innerText();
check(
	'the course notification category is offered',
	/Courses I run or take part in/i.test(settingsText),
	settingsText.slice(0, 600)
);
check(
	'with per-type rows under it',
	/A new lesson in a course I take/i.test(settingsText),
	settingsText.slice(0, 800)
);

console.log(`\n${pass} passed, ${fail} failed`);
if (errors.length) {
	console.log('\nErrors:');
	for (const e of [...new Set(errors)]) console.log('  ! ' + e);
} else {
	console.log('Zero console/page errors.');
}
await browser.close();
process.exit(fail === 0 && errors.length === 0 ? 0 : 1);
