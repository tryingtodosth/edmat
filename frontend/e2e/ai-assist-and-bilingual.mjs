// Two features of 2026-10-08, in one run because they land on the same two pages:
//
//   A. **The "AI-assisted" mark** (`provenance/`): the content menu on an exercise statement, on a
//      hint/solution and on a review, with reply ABOVE "mark as AI-assisted" and report below it;
//      the confidence slider actually writing a vote; the chip appearing once something is claimed;
//      and the `ai_assisted` kill switch taking the menu item away from a NON-STAFF reader while
//      reply and report stay (house rule 3).
//   B. **Bilingual management text** (`translations/`): `/about` reading in ONE language rather than
//      in both glued together, in each interface language; and the owner's "Edit in both
//      languages…" menu opening a two-pane editor.
//
// Needs the EdMat organisation seeded (`manage.py seed_edmat_project --owner <username>`) and the
// demo users (`seed_demo_users`, password123). Part C also needs a token for the organisation's
// OWNER, whose account is a real person's and not a demo one — see `ownerToken` below.
//
// Run:
//   E2E_BASE=http://localhost:5183 E2E_API=http://127.0.0.1:8100/api \
//     E2E_OWNER_TOKEN=<token> node e2e/ai-assist-and-bilingual.mjs
//
// Screenshots land in e2e/screens/ai-assist-*.png and e2e/screens/bilingual-*.png and are meant to
// be LOOKED at — several real bugs on this project were only ever found that way.
import { mkdirSync } from 'node:fs';
import { englishContext } from './english.mjs';

let chromium;
try {
	({ chromium } = await import('playwright'));
} catch {
	({ chromium } = await import('playwright-core'));
}

const BASE = process.env.E2E_BASE ?? 'http://localhost:5183';
const API = process.env.E2E_API ?? 'http://127.0.0.1:8100/api';
const PASSWORD = 'password123';
const EXERCISE = process.env.E2E_EXERCISE ?? '3';
const SHOTS = 'e2e/screens/';
mkdirSync(SHOTS, { recursive: true });

let pass = 0,
	fail = 0;
const check = (label, ok, extra = '') => {
	if (ok) pass++;
	else fail++;
	console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${label} ${ok ? '' : extra}`);
};

async function tokenFor(identifier) {
	const response = await fetch(`${API}/auth/login/`, {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify({ username: identifier, password: PASSWORD })
	});
	if (!response.ok) throw new Error(`login ${identifier}: ${response.status}`);
	return (await response.json()).token;
}

/** Reset the mutable state this run writes, through the real API — e2e/CLAUDE.md: a script that
 *  needs mutable state resets it at the START of a run. Without this the second run finds its own
 *  vote from the first and the button it looks for reads "Change my opinion" instead. */
async function retractVote(token, kind, id) {
	await fetch(`${API}/ai-assistance/${kind}/${id}/vote/`, {
		method: 'DELETE',
		headers: { Authorization: `Token ${token}` }
	}).catch(() => {});
}

async function voteAs(token, kind, id, confidence) {
	const response = await fetch(`${API}/ai-assistance/${kind}/${id}/vote/`, {
		method: 'PUT',
		headers: { 'Content-Type': 'application/json', Authorization: `Token ${token}` },
		body: JSON.stringify({ confidence })
	});
	if (!response.ok) throw new Error(`vote ${kind}:${id}: ${response.status}`);
	return response.json();
}

async function setFlag(token, key, isEnabled) {
	const response = await fetch(`${API}/feature-flags/${key}/`, {
		method: 'PATCH',
		headers: { 'Content-Type': 'application/json', Authorization: `Token ${token}` },
		body: JSON.stringify({ is_enabled: isEnabled })
	});
	if (!response.ok) throw new Error(`flag ${key}: ${response.status}`);
}

/** A context already signed in: the token under `edmat-auth-token`, which is the key
 *  `token.svelte.ts` actually uses (`STORAGE_KEY`) — an earlier draft of this script guessed
 *  `edmat.token`, and the symptom was a menu with only "Reply" in it, because every other item
 *  needs `authStore.isAuthenticated`. Same path a person who signed in is on, and it skips the
 *  login throttle entirely (e2e/CLAUDE.md trap 1). */
async function signedIn(browser, token, { english = true } = {}) {
	const ctx = english
		? await englishContext(browser, BASE, { viewport: { width: 1280, height: 1000 } })
		: await browser.newContext({ viewport: { width: 1280, height: 1000 } });
	await ctx.addInitScript(
		([key, value]) => {
			try {
				window.localStorage.setItem(key, value);
				// The corpus is Polish; without this a list narrows to the reader's languages and
				// can honestly be empty (e2e/CLAUDE.md trap 16).
				window.localStorage.setItem('edmat.contentLocales', '["pl","en"]');
			} catch {
				/* private window */
			}
		},
		['edmat-auth-token', token]
	);
	return ctx;
}

/** The items of the one `⋯` inside `scope`, as text. Opens it, reads it, leaves it open. */
async function menuItems(scope) {
	const trigger = scope.locator('.meatballs__trigger').first();
	await trigger.waitFor({ timeout: 15000 });
	await trigger.click();
	const menu = scope.locator('[role="menu"]').first();
	await menu.waitFor({ timeout: 10000 });
	return (await menu.locator('[role="menuitem"]').allTextContents()).map((t) => t.trim());
}

/**
 * Open the `FoldSection` named `key` if it is shut. Every fold on `/coop` starts shut and its state
 * is remembered per browser (`foldedSections`), so a blind click is as likely to close it; and a
 * shut fold draws nothing inside it — a task title or `.needs-panel` is simply not on the page.
 */
async function openFold(page, key) {
	const fold = page.locator(`[data-fold="${key}"]`).first();
	if (!(await fold.count())) return;
	if (!(await fold.evaluate((e) => e.classList.contains('fold--open')))) {
		await fold.locator('.fold__toggle').first().click();
		await page.waitForTimeout(800);
	}
}

const browser = await chromium.launch();
const olaToken = await tokenFor('ola@edmat.example');
// Two more, because the chip only draws once a mark is LIT and that needs
// `MIN_VOTES_FOR_COMMUNITY_MARK` people — a figure off one vote would read as a community reading,
// which is the thing that constant exists to prevent. Neither of them wrote the exercise (its
// `submitted_by` is kasia, who therefore cannot vote on it at all).
const michalToken = await tokenFor('michal@edmat.example');
const bartekToken = await tokenFor('bartek@edmat.example');
const staffToken = await tokenFor('kasia@edmat.example');
// The organisation's OWNER, who is a real person's account rather than a demo one — so the script
// takes a token rather than a password. Mint one with:
//   manage.py shell -c "from rest_framework.authtoken.models import Token; \
//     from django.contrib.auth import get_user_model; \
//     print(Token.objects.get_or_create(user=get_user_model().objects.get(username='piotrek'))[0].key)"
const ownerToken = process.env.E2E_OWNER_TOKEN;
if (!ownerToken) {
	console.log('  skip  C needs E2E_OWNER_TOKEN (the EdMat organisation owner)');
}

try {
	// ---- A. the AI-assisted mark ---------------------------------------------------------------
	console.log('\nA. the "AI-assisted" mark on an exercise');
	await setFlag(staffToken, 'ai_assisted', true);
	for (const token of [olaToken, michalToken, bartekToken]) {
		await retractVote(token, 'exercise', EXERCISE);
	}
	{
		const ctx = await signedIn(browser, olaToken);
		const page = await ctx.newPage();
		// 'load', never 'networkidle': the notification SSE stream never goes idle on an
		// authenticated page (e2e/CLAUDE.md trap 2).
		await page.goto(`${BASE}/exercises/${EXERCISE}`, { waitUntil: 'load', timeout: 90000 });
		await page.locator('article.exercise').waitFor({ timeout: 30000 });

		const statement = page
			.locator('.content-section')
			.filter({ has: page.locator('h2') })
			.first();
		const items = await menuItems(statement);
		check(`the statement has a menu (${items.length} items)`, items.length >= 3, items.join(' | '));
		// The ORDER is the owner's instruction, so it is asserted as an order and not as a set.
		const replyAt = items.findIndex((t) => /^Reply$/i.test(t));
		const aiAt = items.findIndex((t) => /AI-assisted/i.test(t));
		const reportAt = items.findIndex((t) => /^Report$/i.test(t));
		check('it offers Reply', replyAt >= 0, items.join(' | '));
		check('it offers "Mark as AI-assisted"', aiAt >= 0, items.join(' | '));
		check('it offers Report', reportAt >= 0, items.join(' | '));
		check('reply is ABOVE the AI mark', replyAt >= 0 && aiAt > replyAt, `${replyAt} vs ${aiAt}`);
		check('report is BELOW the AI mark', reportAt > aiAt, `${aiAt} vs ${reportAt}`);
		await page.screenshot({ path: `${SHOTS}ai-assist-menu.png` });

		// The dialog, and a real vote through it.
		await page
			.locator('[role="menuitem"]', { hasText: /AI-assisted/i })
			.first()
			.click();
		const dialog = page.locator('[role="dialog"]').first();
		await dialog.waitFor({ timeout: 10000 });
		// Waited for, not counted: the dialog paints its "loading" line until the batched reading
		// lands, so the slider does not exist on the first frame.
		const slider = dialog.locator('input[type="range"]').first();
		let sliderThere = true;
		try {
			await slider.waitFor({ timeout: 15000 });
		} catch {
			sliderThere = false;
		}
		check('the dialog has a confidence slider', sliderThere);
		await slider.fill('80');
		await page.screenshot({ path: `${SHOTS}ai-assist-dialog.png` });
		await dialog
			.locator('button', { hasText: /Give my opinion/i })
			.first()
			.click();
		await dialog.locator('button', { hasText: /Change my opinion/i }).waitFor({ timeout: 15000 });
		const reading = await dialog.locator('.reading').innerText();
		check('the reading counts the opinion', /80/.test(reading), reading.replace(/\n/g, ' / '));
		await page.screenshot({ path: `${SHOTS}ai-assist-voted.png` });
		await page.keyboard.press('Escape');

		// The chip, which draws nothing until a mark is lit. One vote is not a community, so two
		// more readers agree first — through the API, because this check is about the chip and not
		// about three people driving the same dialog.
		await voteAs(michalToken, 'exercise', EXERCISE, 90);
		await voteAs(bartekToken, 'exercise', EXERCISE, 70);
		await page.reload({ waitUntil: 'load', timeout: 90000 });
		await page.locator('article.exercise').waitFor({ timeout: 30000 });
		const chip = page.locator('.exercise__badges .chip').first();
		let chipThere = true;
		try {
			await chip.waitFor({ timeout: 15000 });
		} catch {
			chipThere = false;
		}
		check('the chip is there (always, since 2026-11-02)', chipThere);
		if (chipThere) {
			const text = (await chip.innerText()).trim();
			check('the chip shows a percentage', /%/.test(text), text);
			// Owner, 2026-11-02: the chip reads "N% AI" on its face, not only in its title — and with
			// three readers at 80/90/70 behind it, N is their mean.
			check('the chip reads "N% AI"', /^\d+% AI$/.test(text), text);
			check('and N is the three readers’ mean (80)', text.startsWith('80%'), text);
			// The three-people icon is the lit one; the author has said nothing.
			const lit = await chip.locator('.mark--lit').count();
			check('exactly one of the two marks is lit', lit === 1, `${lit} lit`);
			const label = (await chip.getAttribute('aria-label')) ?? '';
			check('and it names the community', /Readers/i.test(label), label);
		}
		await page.screenshot({ path: `${SHOTS}ai-assist-chip.png` });

		// A hint/solution, and a review, each with their own menu. Two clicks to get to an entry at
		// all, and both are the real reader's path:
		//   1. the reveal toggle — the learning flow does not show a solution to somebody who has
		//      not asked for it;
		//   2. "show N more in other languages" — this script reads the ENGLISH interface and the
		//      corpus entries are Polish, so the section honestly says "Show hints (0)" until the
		//      reader asks for the other languages (e2e/CLAUDE.md trap 16, one layer in: it bites
		//      inside a page as well as on a list).
		for (const toggle of await page.locator('.reveal-toggle').all()) {
			await toggle.click();
			await page.waitForTimeout(400);
		}
		for (const more of await page.locator('.other-locales').all()) {
			await more.click();
			await page.waitForTimeout(400);
		}
		const entry = page.locator('article.entry').first();
		if (await entry.count()) {
			const entryItems = await menuItems(entry);
			check(
				'a hint/solution has the same menu',
				entryItems.some((t) => /AI-assisted/i.test(t)),
				entryItems.join(' | ')
			);
			await page.keyboard.press('Escape');
		} else {
			check('a hint/solution has the same menu', false, 'no .entry on the page');
		}

		const review = page.locator('.review').first();
		if (await review.count()) {
			const reviewItems = await menuItems(review);
			check(
				'a review has the same menu',
				reviewItems.some((t) => /AI-assisted/i.test(t)),
				reviewItems.join(' | ')
			);
			await page.keyboard.press('Escape');
		} else {
			check('a review has the same menu', false, 'no .review on the page');
		}
		await ctx.close();
	}

	// The kill switch, as a NON-STAFF reader — a staff-bypassed check proves nothing about a flag
	// (e2e/CLAUDE.md trap 10).
	console.log('\nA2. the ai_assisted kill switch (as a non-staff reader)');
	{
		await setFlag(staffToken, 'ai_assisted', false);
		const ctx = await signedIn(browser, olaToken);
		const page = await ctx.newPage();
		await page.goto(`${BASE}/exercises/${EXERCISE}`, { waitUntil: 'load', timeout: 90000 });
		await page.locator('article.exercise').waitFor({ timeout: 30000 });
		const statement = page
			.locator('.content-section')
			.filter({ has: page.locator('h2') })
			.first();
		const items = await menuItems(statement);
		check('the AI item is gone', !items.some((t) => /AI-assisted/i.test(t)), items.join(' | '));
		check(
			'reply survives the switch',
			items.some((t) => /^Reply$/i.test(t)),
			items.join(' | ')
		);
		check(
			'report survives the switch',
			items.some((t) => /^Report$/i.test(t)),
			items.join(' | ')
		);
		const chip = page.locator('.exercise__badges .chip');
		check('the chip is gone too', (await chip.count()) === 0);
		await page.screenshot({ path: `${SHOTS}ai-assist-killed.png` });
		await ctx.close();
		await setFlag(staffToken, 'ai_assisted', true);
	}

	// ---- A3. a material carries "N% AI" too (owner, 2026-11-02) ----------------------------------
	// "(percentage% AI) that should be in each exercise/material". The material page draws the chip
	// ALWAYS — 0% until somebody stands behind a number — and its submitter can mark it from the
	// material's own menu. Marked through the API (this check is about the chip), and the mark is
	// DELETED afterwards, so the material goes back to having no author answer at all.
	console.log('\nA3. a material reads "N% AI"');
	{
		const MATERIAL = process.env.E2E_MATERIAL ?? '1';
		const kasiaToken = await tokenFor('kasia@edmat.example');
		const markUrl = `${API}/ai-assistance/material/${MATERIAL}/author-mark/`;
		const auth = { 'Content-Type': 'application/json', Authorization: `Token ${kasiaToken}` };
		await fetch(markUrl, { method: 'DELETE', headers: auth }).catch(() => {});

		const ctx = await englishContext(browser, BASE, { viewport: { width: 1280, height: 1000 } });
		const page = await ctx.newPage();
		const pageErrors = [];
		page.on('pageerror', (e) => pageErrors.push(e.message));
		await page.goto(`${BASE}/materials/${MATERIAL}`, { waitUntil: 'load', timeout: 90000 });
		const chip = page.locator('.material-assist .chip');
		const there = await chip.waitFor({ timeout: 30000 }).then(
			() => true,
			() => false
		);
		const before = there ? (await chip.innerText()).trim() : '';
		check('an unmarked material shows its chip anyway', there && /^\d+% AI$/.test(before), before);

		const marked = await fetch(markUrl, {
			method: 'PUT',
			headers: auth,
			body: JSON.stringify({ assisted: true })
		});
		check('its submitter may mark it', marked.ok, `${marked.status}`);
		await page.reload({ waitUntil: 'load', timeout: 90000 });
		await chip.waitFor({ timeout: 30000 }).catch(() => {});
		const after = (await chip.innerText().catch(() => '')).trim();
		check('and then it reads "100% AI"', after === '100% AI', after);
		check('with the author’s mark lit', (await chip.locator('.mark--lit').count()) === 1);
		await chip.scrollIntoViewIfNeeded();
		await page.screenshot({ path: `${SHOTS}ai-assist-material.png` });
		check('no page errors on the material page', pageErrors.length === 0, pageErrors.join(' | '));
		await ctx.close();

		const removed = await fetch(markUrl, { method: 'DELETE', headers: auth });
		check('and the mark is taken off again', removed.ok, `${removed.status}`);
	}

	// ---- B. bilingual management text ----------------------------------------------------------
	console.log('\nB. /coop reads in ONE language');
	// The organisation's description as `seed_edmat_project` writes it (`work/edmat_project.py`);
	// it read "A community database of exercises…" before `--retake-description` rewrote it.
	const PL_START = 'Edukacja potrzebuje usprawnień';
	const EN_START = 'Education needs fixing';
	const PL_TASK = 'Wskaźnik „z pomocą AI”';
	const EN_TASK = 'The “AI-assisted” score';
	{
		const ctx = await englishContext(browser, BASE, { viewport: { width: 1280, height: 1100 } });
		const page = await ctx.newPage();
		await page.goto(`${BASE}/coop`, { waitUntil: 'load', timeout: 90000 });
		await page.locator('h1').first().waitFor({ timeout: 30000 });
		await page.waitForTimeout(2500); // the organisation body loads client-side
		await openFold(page, 'tasks');
		const body = await page.locator('body').innerText();
		check('the English reader gets the English description', body.includes(EN_START));
		check('and NOT the Polish one glued to it', !body.includes(PL_START));
		check('a task reads in English', body.includes(EN_TASK), 'no English task title');
		check('and not in Polish', !body.includes(PL_TASK));
		await page.screenshot({ path: `${SHOTS}bilingual-about-en.png`, fullPage: true });
		await ctx.close();
	}
	{
		// No cookie at all: the base locale is Polish (frontend/CLAUDE.md).
		const ctx = await browser.newContext({ viewport: { width: 1280, height: 1100 } });
		const page = await ctx.newPage();
		await page.goto(`${BASE}/coop`, { waitUntil: 'load', timeout: 90000 });
		await page.locator('h1').first().waitFor({ timeout: 30000 });
		await page.waitForTimeout(2500);
		await openFold(page, 'tasks');
		const body = await page.locator('body').innerText();
		check('the Polish reader gets the Polish description', body.includes(PL_START));
		check('and NOT the English one glued to it', !body.includes(EN_START));
		check('a task reads in Polish', body.includes(PL_TASK));
		await page.screenshot({ path: `${SHOTS}bilingual-about-pl.png`, fullPage: true });
		await ctx.close();
	}

	console.log('\nC. the owner edits both languages from the page');
	if (ownerToken) {
		const ctx = await signedIn(browser, ownerToken);
		const page = await ctx.newPage();
		await page.goto(`${BASE}/coop`, { waitUntil: 'load', timeout: 90000 });
		await page.locator('h1').first().waitFor({ timeout: 30000 });
		await page.waitForTimeout(3500);

		const aboutBlock = page.locator('.block').first();
		const orgItems = await menuItems(aboutBlock);
		check(
			'the organisation description has "Edit in both languages…"',
			orgItems.some((t) => /both languages/i.test(t)),
			orgItems.join(' | ')
		);
		await page
			.locator('[role="menuitem"]', { hasText: /both languages/i })
			.first()
			.click();
		const dialog = page.locator('[role="dialog"]').first();
		await dialog.waitFor({ timeout: 10000 });
		const panes = dialog.locator('.pane');
		check('the editor has two panes', (await panes.count()) === 2, `${await panes.count()}`);
		const areas = dialog.locator('textarea');
		check('both panes carry text', (await areas.count()) === 2, `${await areas.count()}`);
		const first = (await areas.nth(0).inputValue()).slice(0, 40);
		const second = (await areas.nth(1).inputValue()).slice(0, 40);
		check('the left pane is the Polish original', first.includes(PL_START), first);
		check('the right pane is the English', second.includes(EN_START), second);
		await page.screenshot({ path: `${SHOTS}bilingual-editor.png` });
		await page.keyboard.press('Escape');

		// A need row's menu — the surface that had NO frontend edit path at all before this.
		await openFold(page, 'needs');
		const needsPanel = page.locator('.needs-panel').first();
		if (await needsPanel.count()) {
			const row = needsPanel.locator('.row').first();
			const needItems = await menuItems(row);
			check(
				'a need row has the menu that did not exist before',
				needItems.some((t) => /both languages/i.test(t)),
				needItems.join(' | ')
			);
			await page.keyboard.press('Escape');
		} else {
			check('a need row has the menu that did not exist before', false, 'no .needs-panel');
		}
		await page.screenshot({ path: `${SHOTS}bilingual-about-owner.png`, fullPage: true });
		await ctx.close();
	}
} finally {
	await browser.close();
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
