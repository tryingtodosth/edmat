// The enrolment lifecycle of a course somebody runs (root CLAUDE.md §17T), driven through the course
// page as it is today — the tabbed page, the enrol block, the People tab, /courses/mine, the
// discussion tab, the per-course mute. Rewritten 2026-09-10 against the current page; the original
// predated every rewrite of it.
//
// Three seeded accounts in three contexts — ola runs the course, bartek and julia take part — plus a
// signed-out stranger. Signed in by writing the token into localStorage (the login form is covered
// by login-return.mjs) so a run costs no registration and no login-throttle budget. The course is
// created fresh per run and deleted at the end.
//   E2E_BASE=http://localhost:5183 E2E_API=http://127.0.0.1:8011 node e2e/classroom.mjs
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
/** A browser context for one person. The token goes straight into localStorage; every context also
 * opts into Polish content, because the course is stored as Polish (the site's content default) and
 * an English-interface context would otherwise see it hidden behind the language notice (§17AQ). */
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
/** Signed-in pages never reach networkidle (the notification stream), so: load + the page's own h1. */
async function goto(page, path, waitFor = '.page h1, main h1, h1') {
	await page.goto(`${BASE}${path}`, { waitUntil: 'load' });
	await page.locator(waitFor).first().waitFor({ timeout: 120000 });
	await settle(page);
}
async function tab(page, name) {
	await page.getByRole('tab', { name }).click();
	await settle(page, 600);
}
const enrolText = (page) => page.locator('section.enrol').innerText();

const olaToken = await tokenFor('ola@edmat.example');
const bartekToken = await tokenFor('bartek@edmat.example');
const juliaToken = await tokenFor('julia@edmat.example');
const teacher = await person('teacher', olaToken);
const student = await person('student', bartekToken);
const second = await person('second', juliaToken);
const stranger = await person('stranger');
const STAMP = Date.now();
const TITLE = `Analiza od zera ${STAMP}`;
// The comment's own marker — the title carries the stamp too, so it must not be reused there.
const MARK = `kolokwium-${STAMP}`;
let courseId = null;

try {
	console.log('\n[1] Anyone can browse, and the nav offers it');
	// A cold Vite compile happens on the very first page; a signed-out page may wait for networkidle.
	await stranger.goto(`${BASE}/`, { waitUntil: 'networkidle', timeout: 180000 });
	check(
		'the nav links to courses',
		(await stranger
			.locator('header nav')
			.getByRole('link', { name: /Courses/ })
			.count()) >= 1
	);
	await goto(stranger, '/courses');
	check(
		'the browse page renders',
		/Courses run by people here/.test(await stranger.locator('h1').first().innerText())
	);

	console.log('\n[2] An instructor creates a course — and it starts visible to nobody else');
	await goto(teacher, '/courses/new');
	const form = teacher.locator('form').first();
	await form.locator('input[type="text"]').first().fill(TITLE);
	await form.locator('input[type="text"]').nth(1).fill('Od ciągów do całek, w dziesięć tygodni');
	await form.locator('textarea').first().fill('Spotkania w czwartki.');
	await form.locator('select:has(option[value="university"])').selectOption('university'); // audience band (§17AL)
	await form.locator('button[type="submit"]').click();
	await teacher.waitForURL(/\/courses\/\d+$/, { timeout: 20000 });
	await settle(teacher, 1500);
	courseId = teacher.url().split('/').pop();
	check('landed on the new course', /^\d+$/.test(courseId), teacher.url());
	check(
		'the instructor is told it is theirs',
		/You run this course/.test(await enrolText(teacher))
	);
	await stranger.goto(`${BASE}/courses/${courseId}`, { waitUntil: 'load' });
	// The first status line is "Loading…"; wait for the answer itself.
	await stranger
		.locator('.page p.status', { hasText: /does not exist|Loading/ })
		.first()
		.waitFor({ timeout: 60000 });
	await stranger
		.locator('.page p.status', { hasText: 'does not exist' })
		.first()
		.waitFor({ timeout: 60000 });
	check('a stranger cannot even find it — a new course is "only you"', true);

	console.log('\n[3] Publishing it through the edit form, with approval required');
	await goto(teacher, `/courses/${courseId}/edit`);
	const edit = teacher.locator('form').first();
	await edit.locator('input[type="radio"][value="public"]').check();
	await edit.locator('select:has(option[value="running"])').selectOption('open');
	await edit
		.locator('select:has(option[value="approval"]):not(:has(option[value="staff"]))')
		.selectOption('approval');
	await edit.locator('button[type="submit"]').click();
	await teacher.waitForURL(/\/courses\/\d+$/, { timeout: 20000 });
	await goto(stranger, '/courses');
	await stranger.locator('.page').getByText(TITLE).first().waitFor({ timeout: 30000 });
	check('now it is listed publicly', true);

	console.log('\n[4] A lesson: public blurb, participant-only notes');
	const chapter = await api(`/courses/${courseId}/chapters/`, {
		token: olaToken,
		method: 'POST',
		body: { title: 'Rozdział 1', description: '' }
	});
	check(
		'a chapter is created for it (API)',
		chapter.status === 201,
		JSON.stringify(chapter.body).slice(0, 120)
	);
	const lesson = await api(`/courses/${courseId}/lessons/`, {
		token: olaToken,
		method: 'POST',
		body: {
			chapter: chapter.body.id,
			title: 'Ciągi liczbowe',
			description: 'Granice ciągów, twierdzenie o trzech ciągach.',
			participant_notes: 'Zadania domowe: https://example.invalid/lista-1'
		}
	});
	check(
		'and a lesson with participant notes (API)',
		lesson.status === 201,
		JSON.stringify(lesson.body).slice(0, 120)
	);
	await goto(teacher, `/courses/${courseId}`);
	let content = await teacher.locator('.tab-panel').innerText();
	check('the instructor sees the lesson', /Ciągi liczbowe/.test(content));
	check('and its notes', /example\.invalid/.test(content));
	await goto(stranger, `/courses/${courseId}`);
	content = await stranger.locator('.tab-panel').innerText();
	check('a stranger sees the lesson exists', /Ciągi liczbowe/.test(content));
	check('but not the notes', !/example\.invalid/.test(content), content.slice(0, 300));
	check('and is told to sign in to join', /Sign in to join/.test(await enrolText(stranger)));

	console.log('\n[5] A student asks to join, and waits');
	await goto(student, `/courses/${courseId}`);
	await student
		.locator('section.enrol textarea')
		.fill('Jestem na drugim roku, chcę nadrobić analizę.');
	await student.getByRole('button', { name: 'Ask to join' }).click();
	await settle(student, 1500);
	check('the request is acknowledged', /waiting for the instructor/.test(await enrolText(student)));
	check(
		'a pending request does not unlock the notes',
		!/example\.invalid/.test(await student.locator('.tab-panel').innerText())
	);

	console.log('\n[6] The instructor sees the request, with the note, and approves');
	await goto(teacher, `/courses/${courseId}`);
	await tab(teacher, 'People');
	let roster = await teacher.locator('section.roster').innerText();
	check('the request is listed', /Requests waiting: 1/.test(roster), roster.slice(0, 300));
	check('with what the student wrote', /drugim roku/.test(roster));
	await teacher
		.locator('section.roster li.request')
		.getByRole('button', { name: 'Approve' })
		.click();
	await settle(teacher, 1500);
	roster = await teacher.locator('section.roster').innerText();
	check('they are now a participant', /Taking part: 1/.test(roster), roster.slice(0, 300));

	console.log('\n[7] Being in the course is what unlocks it');
	await goto(student, `/courses/${courseId}`);
	check('the student is told they are in', /You are taking part/.test(await enrolText(student)));
	check(
		'and now sees the notes',
		/example\.invalid/.test(await student.locator('.tab-panel').innerText())
	);
	await tab(student, 'People');
	check(
		'and can see who else is here',
		/Taking part: 1/.test(await student.locator('section.roster').innerText())
	);

	console.log('\n[8] My courses splits teaching from taking part');
	await goto(teacher, '/courses/mine');
	const teacherMine = await teacher.locator('.page').innerText();
	check(
		'the instructor sees it under courses they run',
		/Courses you run/.test(teacherMine) && teacherMine.includes(TITLE)
	);
	await goto(student, '/courses/mine');
	const studentMine = await student.locator('.page').innerText();
	check(
		'the student sees it under courses they take',
		/Courses you are taking/.test(studentMine) && studentMine.includes(TITLE)
	);
	check('and runs nothing', /not running any courses/.test(studentMine), studentMine.slice(0, 300));

	console.log('\n[9] Leaving gives the seat back, and somebody who left may ask again');
	await goto(student, `/courses/${courseId}`);
	await student.getByRole('button', { name: 'Leave this course' }).click();
	await settle(student, 1500);
	check(
		'the join offer is back',
		(await student.getByRole('button', { name: 'Ask to join' }).count()) === 1
	);
	check(
		'and the notes are locked again',
		!/example\.invalid/.test(await student.locator('.tab-panel').innerText())
	);
	await goto(teacher, `/courses/${courseId}`);
	await tab(teacher, 'People');
	check(
		'the instructor sees the seat given back',
		/Nobody has joined yet/.test(await teacher.locator('section.roster').innerText())
	);
	await student.getByRole('button', { name: 'Ask to join' }).click();
	await settle(student, 1500);
	check(
		'asking again is allowed after leaving',
		/waiting for the instructor/.test(await enrolText(student))
	);
	await goto(teacher, `/courses/${courseId}`);
	await tab(teacher, 'People');
	await teacher
		.locator('section.roster li.request')
		.getByRole('button', { name: 'Approve' })
		.click();
	await settle(teacher, 1200);

	console.log('\n[10] A full course refuses, in its own words');
	const capped = await api(`/courses/${courseId}/`, {
		token: olaToken,
		method: 'PATCH',
		body: { capacity: 1 }
	});
	check(
		'the cap is set to the one person already in (API)',
		capped.status === 200,
		JSON.stringify(capped.body).slice(0, 120)
	);
	await goto(second, `/courses/${courseId}`);
	check(
		'a second person is told it is full',
		/This course is full/.test(await enrolText(second)),
		await enrolText(second)
	);
	check(
		'and is shown no join button',
		(await second.locator('section.enrol button').count()) === 0
	);

	console.log('\n[11] The cap cannot be cut below the people already in');
	const uncapped = await api(`/courses/${courseId}/`, {
		token: olaToken,
		method: 'PATCH',
		body: { capacity: 0 }
	});
	check('uncapping is accepted', uncapped.status === 200);
	await goto(second, `/courses/${courseId}`);
	await second.locator('section.enrol textarea').fill('Też chętnie.');
	await second.getByRole('button', { name: 'Ask to join' }).click();
	await settle(second, 1200);
	await goto(teacher, `/courses/${courseId}`);
	await tab(teacher, 'People');
	await teacher
		.locator('section.roster li.request')
		.getByRole('button', { name: 'Approve' })
		.click();
	await settle(teacher, 1200);
	check(
		'two people are in',
		/Taking part: 2/.test(await teacher.locator('section.roster').innerText())
	);
	const tooLow = await api(`/courses/${courseId}/`, {
		token: olaToken,
		method: 'PATCH',
		body: { capacity: 1 }
	});
	check(
		'a cap below the two of them is refused',
		tooLow.status === 400,
		`${tooLow.status} ${JSON.stringify(tooLow.body).slice(0, 120)}`
	);

	console.log('\n[12] Somebody removed by the instructor cannot walk back in');
	await teacher
		.locator('section.roster li', { hasText: 'Julia' })
		.getByRole('button', { name: 'Remove' })
		.click();
	await settle(teacher, 1200);
	check(
		'the roster is down to one',
		/Taking part: 1/.test(await teacher.locator('section.roster').innerText())
	);
	await goto(second, `/courses/${courseId}`);
	check(
		'the removed person is told why',
		/instructor removed you/.test(await enrolText(second)),
		await enrolText(second)
	);
	check('and gets no way back in', (await second.locator('section.enrol button').count()) === 0);

	console.log('\n[13] Discussion: participants only by default');
	await goto(stranger, `/courses/${courseId}`);
	// The tab itself is what participants-only withholds: a stranger is offered no Discussion tab.
	check(
		'a stranger is offered no Discussion tab',
		(await stranger.getByRole('tab', { name: 'Discussion' }).count()) === 0
	);
	check(
		'and gets no composer anywhere',
		(await stranger.locator('form.comment-form').count()) === 0
	);
	await goto(student, `/courses/${courseId}`);
	await tab(student, 'Discussion');
	const composer = student.locator('.discussion-section form.comment-form').first();
	await composer.locator('textarea').first().waitFor({ timeout: 20000 });
	await composer
		.locator('textarea')
		.first()
		.fill(`Czy zadania domowe z listy 1 są na kolokwium? ${MARK}`);
	await composer.locator('button[type="submit"]').click();
	await student
		.locator('.discussion-section .comment', { hasText: MARK })
		.first()
		.waitFor({ timeout: 20000 });
	check('a participant can post', true);
	await goto(teacher, `/courses/${courseId}`);
	await tab(teacher, 'Discussion');
	check(
		'and the instructor sees it',
		(await teacher.locator('.discussion-section .comment', { hasText: MARK }).count()) === 1
	);

	console.log('\n[14] The instructor is notified, and it links back to the course');
	await goto(teacher, '/notifications');
	const notif = teacher
		.locator('main')
		.locator('article, li, .notification, .card', { hasText: TITLE })
		.first();
	await notif.waitFor({ timeout: 20000 });
	const notifText = await notif.innerText();
	check('a post notification arrived', /posted in/.test(notifText), notifText.slice(0, 200));
	const notifHref = await notif
		.locator(`a[href*="/courses/${courseId}"]`)
		.first()
		.getAttribute('href');
	check('and links to the course', Boolean(notifHref), String(notifHref));

	console.log('\n[15] A public thread is readable by anyone, writable only by participants');
	const pub = await api(`/courses/${courseId}/`, {
		token: olaToken,
		method: 'PATCH',
		body: { discussion_mode: 'public' }
	});
	check('the discussion is opened to readers (API)', pub.status === 200);
	// Read by a signed-in NON-member rather than the signed-out stranger: the stranger's earlier
	// anonymous reads of this course are in the 60 s read cache (e2e/CLAUDE.md trap 12), so the
	// stale, participants-only copy would still be served here. Julia was removed in [12], so she
	// is as much an outsider to the thread as a stranger, and her requests bypass the cache.
	await goto(second, `/courses/${courseId}`);
	await tab(second, 'Discussion');
	const outsiderPublic = await second.locator('.tab-panel').innerText();
	check('an outsider can now read it', outsiderPublic.includes(MARK), outsiderPublic.slice(0, 200));
	check(
		'and is told joining is what lets them post',
		/Joining the course is what lets you post/.test(outsiderPublic)
	);
	check('with no composer', (await second.locator('.tab-panel form.comment-form').count()) === 0);

	console.log('\n[16] Turning the discussion off removes it entirely');
	await api(`/courses/${courseId}/`, {
		token: olaToken,
		method: 'PATCH',
		body: { discussion_mode: 'off' }
	});
	await goto(student, `/courses/${courseId}`);
	check(
		'a participant is offered no Discussion tab',
		(await student.getByRole('tab', { name: 'Discussion' }).count()) === 0
	);
	const offText = await student.locator('.page').innerText();
	const at = offText.indexOf(MARK);
	check(
		'and the thread is nowhere on the page',
		at < 0,
		offText.slice(Math.max(0, at - 120), at + 40).replace(/\n/g, ' ')
	);

	console.log('\n[17] Muting one course, without leaving it');
	const mute = student.locator('label.mute input');
	check('the mute control is offered to a participant', (await mute.count()) === 1);
	check('and it starts on', await mute.isChecked());
	await mute.uncheck();
	await settle(student, 1200);
	const asStudent = await api(`/courses/${courseId}/`, { token: bartekToken });
	check(
		'unticking it is saved server-side',
		asStudent.body?.notify_me === false,
		JSON.stringify(asStudent.body?.notify_me)
	);
	check('while still taking part', /You are taking part/.test(await enrolText(student)));
	check(
		'and a stranger is offered no mute',
		(await stranger.locator('label.mute input').count()) === 0
	);

	console.log('\n[18] The account-wide setting exists');
	await goto(student, '/settings', 'form.edit-form');
	check(
		'Settings has the course-activity notification row',
		(await student
			.locator('label.checkbox', { hasText: 'Courses I run or take part in' })
			.locator('input')
			.count()) === 1
	);
} catch (e) {
	fail++;
	console.log(`  FAIL the run aborted: ${e.message.split('\n')[0]}`);
} finally {
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
