#!/usr/bin/env node

// Polls (decisions step E, 2026-09-24):
//
// 1. A manager creates a poll on their course
// 2. Opens it for voting
// 3. A member enrolls and votes
// 4. Manager closes it and sees results
// 5. Screenshots verify the full flow
//
// Run (ports must match whatever `run.sh`/test.md set up):
//   E2E_BASE=http://localhost:5183 E2E_API=http://127.0.0.1:8125/api node e2e/decisions.mjs

import { mkdirSync } from 'node:fs';

let chromium;
try {
	({ chromium } = await import('playwright'));
} catch {
	({ chromium } = await import('playwright-core'));
}

const BASE = process.env.E2E_BASE ?? 'http://localhost:5183';
const API = process.env.E2E_API ?? 'http://127.0.0.1:8125/api';
const MANAGER_EMAIL = 'kasia@edmat.example';
const MEMBER_EMAIL = 'adam@edmat.example';
const PASSWORD = 'password123';
const SHOTS = new URL('./screens/', import.meta.url).pathname;
mkdirSync(SHOTS, { recursive: true });

let pass = 0, fail = 0;
const check = (l, ok, x = '') => {
	if (ok) pass++;
	else fail++;
	console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${l} ${ok ? '' : x}`);
};

async function tokenFor(email) {
	const response = await fetch(`${API}/auth/login/`, {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify({ username: email, password: PASSWORD })
	});
	if (!response.ok) throw new Error(`login ${email}: ${response.status}`);
	return (await response.json()).token;
}

async function fetchAPI(method, path, token, body = null) {
	const opts = {
		method,
		headers: {
			'Content-Type': 'application/json',
			...(token ? { Authorization: `Token ${token}` } : {})
		}
	};
	if (body) opts.body = JSON.stringify(body);
	const response = await fetch(`${API}${path}`, opts);
	if (!response.ok) {
		const text = await response.text();
		throw new Error(`${method} ${path}: ${response.status} ${text}`);
	}
	return method === 'DELETE' ? null : response.json();
}

async function createTestCourse(managerToken) {
	const course = await fetchAPI('POST', '/courses/', managerToken, {
		title: 'Poll Test Course',
		description: 'A course to test the decisions feature',
		visibility: 'public'
	});
	return course;
}

async function enrollMember(memberToken, courseId) {
	const response = await fetch(`${API}/courses/${courseId}/enroll/`, {
		method: 'POST',
		headers: {
			'Content-Type': 'application/json',
			Authorization: `Token ${memberToken}`
		}
	});
	if (!response.ok) {
		const text = await response.text();
		throw new Error(`enroll: ${response.status} ${text}`);
	}
	return response.json();
}

async function createPoll(managerToken, courseId) {
	const poll = await fetchAPI('POST', `/nodes/course/${courseId}/polls/`, managerToken, {
		question: 'Should we meet on Mondays?',
		description: 'A test poll about meeting times',
		mode: 'single',
		eligibility: 'members'
	});

	// Add options
	await fetchAPI('POST', `/polls/${poll.id}/options/`, managerToken, {
		text: 'Yes, Mondays work',
		order: 1
	});
	await fetchAPI('POST', `/polls/${poll.id}/options/`, managerToken, {
		text: 'No, too early',
		order: 2
	});

	return poll;
}

const browser = await chromium.launch(
	process.env.CHROME ? { executablePath: process.env.CHROME } : {}
);
const DESKTOP = { width: 1280, height: 900 };
const PHONE = { width: 390, height: 844 };

const errors = [];
function watch(page) {
	page.on('pageerror', (e) => errors.push(String(e)));
	page.on('console', (msg) => {
		if (msg.type() === 'error') errors.push(msg.text());
	});
}

try {
	console.log('\n--- Decisions (Polls) E2E Test ---\n');

	// Get tokens
	const managerToken = await tokenFor(MANAGER_EMAIL);
	const memberToken = await tokenFor(MEMBER_EMAIL);

	// Create a test course
	const course = await createTestCourse(managerToken);
	const courseId = course.id;
	console.log(`Created course #${courseId}`);

	// Enroll member
	await enrollMember(memberToken, courseId);
	console.log(`Enrolled member in course`);

	// Create a poll
	const poll = await createPoll(managerToken, courseId);
	const pollId = poll.id;
	console.log(`Created poll #${pollId}`);
	check('poll status is draft', poll.status === 'draft');

	// Open the poll for voting
	const openedPoll = await fetchAPI('POST', `/polls/${pollId}/open/`, managerToken);
	check('poll can be opened', openedPoll.status === 'open');
	console.log(`Opened poll for voting`);

	// Member votes
	const pollOptions = openedPoll.options;
	check('poll has 2 options', pollOptions.length === 2);

	const vote = await fetchAPI('POST', `/polls/${pollId}/vote/`, memberToken, {
		options: [pollOptions[0].id]
	});
	check('vote created successfully', vote.id !== undefined);
	console.log(`Member voted`);

	// View results as manager
	const results = await fetchAPI('GET', `/polls/${pollId}/results/`, managerToken);
	check('results has options', results.options !== undefined);
	check('first option has 1 vote', results.options[0].count === 1);
	console.log(`Viewed results`);

	// Close the poll
	const closedPoll = await fetchAPI('POST', `/polls/${pollId}/close/`, managerToken, {
		decision_note: 'We decided to meet on Mondays!'
	});
	check('poll is closed', closedPoll.status === 'closed');
	check('decision note set', closedPoll.decision_note === 'We decided to meet on Mondays!');
	console.log(`Closed poll`);

	// Take desktop screenshot
	{
		const ctx = await browser.newContext({ viewport: DESKTOP });
		const page = await ctx.newPage();
		watch(page);

		await page.goto(`${BASE}/login`);
		await page.fill('input[autocomplete="username"]', MANAGER_EMAIL);
		await page.fill('input[type="password"]', PASSWORD);
		await page.click('button[type="submit"]');
		await page.waitForURL('**/');

		await page.goto(`${BASE}/polls/${pollId}`);
		await page.locator('h1, h2, [role="heading"]').first().waitFor({ timeout: 5000 }).catch(() => {});

		await page.screenshot({ path: `${SHOTS}decisions-manager.png`, fullPage: true });
		check('desktop screenshot taken', true);

		await ctx.close();
	}

	// Take phone screenshot
	{
		const ctx = await browser.newContext({ viewport: PHONE });
		const page = await ctx.newPage();
		watch(page);

		await page.goto(`${BASE}/login`);
		await page.fill('input[autocomplete="username"]', MEMBER_EMAIL);
		await page.fill('input[type="password"]', PASSWORD);
		await page.click('button[type="submit"]');
		await page.waitForURL('**/');

		await page.goto(`${BASE}/polls/${pollId}`);
		await page.locator('h1, h2, [role="heading"]').first().waitFor({ timeout: 5000 }).catch(() => {});

		await page.screenshot({ path: `${SHOTS}decisions-member.png`, fullPage: true });
		check('phone screenshot taken', true);

		await ctx.close();
	}

	check('no console errors', errors.length === 0, `${errors.length} errors`);

	console.log(`\n--- Summary ---`);
	console.log(`Pass: ${pass}`);
	console.log(`Fail: ${fail}`);
	console.log(`Screenshots: ${SHOTS}decisions-*.png`);

	process.exit(fail > 0 ? 1 : 0);
} catch (e) {
	console.error(`Fatal: ${e.message}`);
	process.exit(1);
} finally {
	await browser.close();
}
