// "Ask a question in a tag" (WP15, 2026-10-15 — the owner's "ask as ppl should be allowed to post
// in tags"; first-visitor audit finding 16). In BOTH interface languages:
//   - the homepage hero's "Ask a question" link, signed out (→ a sign-in prompt) and signed in
//     (→ the composer);
//   - asking through the real composer: the question, the searchable tag picker, the audience band;
//   - landing on /tags/<tag>, the question listed there, and in the activity feed;
//   - a reply from a second account, the reply count and the asker's notification;
//   - the Add… menu's "Ask a question" entry, and the exercise page's tag chip opening the tag page;
//   - no horizontal scroll at 390 on the hero, the composer and the tag page.
// Once: a minor's question is HELD (the page says so, the tag page does not list it), and the
// `posts` switch, off, takes every entry point away from a NON-staff account (trap 10) — restored
// in a `finally`.
//
// A NEW tag (WP16, 2026-10-15 — the owner's "tag creation is a must"), in both languages: the picker
// offers "Utwórz tag „…”" / "Create tag “…”" (shot at 390 and 1280), the question lands on
// /tags/<new-slug> with "the tag is created"; typing an existing tag in another case and without
// its Polish letters ("CALKA Z 1-FORMY") names the existing tag instead of offering to create one,
// and the API reuses it; a link as a tag name is refused with its reason, and so is a minor's new
// tag. Cleanup tombstones the questions, and the new tags then leave the site with them (the orphan
// rule) — asserted. Each run mints two tags as the asker; `tag_create` allows five an hour.
//
//   E2E_BASE=http://localhost:5221 E2E_API=http://127.0.0.1:8071 \
//   E2E_ASKER_TOKEN=… E2E_ANSWER_TOKEN=… E2E_STAFF_TOKEN=… E2E_MINOR_TOKEN=… \
//   E2E_SHOTS=/tmp/shots node e2e/ask.mjs
//
// Tokens rather than the login form: five sign-ins an hour burn the login throttle for everyone
// (trap 30). Read them with the `Token.objects.get_or_create` one-liner in e2e/CLAUDE.md. The
// asker and answerer must be ordinary accounts, the staff one staff, the minor one a minor.
// Every question this writes carries MARK and is tombstoned at the start and the end of a run.
let chromium;
try {
	({ chromium } = await import('playwright'));
} catch {
	({ chromium } = await import('playwright-core'));
}
import { readFileSync, mkdirSync } from 'node:fs';
import { englishContext } from './english.mjs';

const BASE = process.env.E2E_BASE ?? 'http://localhost:5173';
const API = process.env.E2E_API ?? 'http://localhost:8000';
const SHOTS = process.env.E2E_SHOTS ?? 'e2e/screens';
const TAG = process.env.E2E_TAG ?? 'indukcja';
const TOKENS = {
	asker: process.env.E2E_ASKER_TOKEN,
	answer: process.env.E2E_ANSWER_TOKEN,
	staff: process.env.E2E_STAFF_TOKEN,
	minor: process.env.E2E_MINOR_TOKEN
};
for (const [who, token] of Object.entries(TOKENS)) {
	if (!token) {
		console.error(`E2E_${who.toUpperCase()}_TOKEN is not set — see the header of this file.`);
		process.exit(2);
	}
}
mkdirSync(SHOTS, { recursive: true });
const MARK = 'WP15-e2e';
// The existing free-text corpus tag the reuse check types in capitals and without Polish letters.
const FOLD_TAG = process.env.E2E_FOLD_TAG ?? 'całka z 1-formy';
const createdTags = [];
const CATALOGUE = {
	pl: JSON.parse(readFileSync(new URL('../messages/pl.json', import.meta.url), 'utf8')),
	en: JSON.parse(readFileSync(new URL('../messages/en.json', import.meta.url), 'utf8'))
};

let pass = 0,
	fail = 0;
const check = (label, ok, extra = '') => {
	if (ok) pass++;
	else fail++;
	console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${label} ${ok ? '' : extra}`);
};
const settle = (ms = 800) => new Promise((r) => setTimeout(r, ms));

const api = async (method, path, token, body) => {
	const res = await fetch(`${API}/api${path}`, {
		method,
		headers: {
			'Content-Type': 'application/json',
			...(token ? { Authorization: `Token ${token}` } : {})
		},
		body: body === undefined ? undefined : JSON.stringify(body)
	});
	let json = null;
	try {
		json = await res.json();
	} catch {
		/* 204 */
	}
	return { status: res.status, json };
};

/** Tombstone this script's own questions in the tag — never anybody else's. Staff list: bypasses
 * nothing but the switch, so a run that died with the switch off still cleans up. */
async function cleanUp(extraIds = []) {
	const ids = [];
	for (const tag of [TAG, FOLD_TAG, ...createdTags]) {
		const listed = await api(
			'GET',
			`/posts/?tag=${encodeURIComponent(tag)}&limit=50`,
			TOKENS.staff
		);
		ids.push(...(listed.json ?? []).filter((p) => p.body.includes(MARK)).map((p) => p.id));
	}
	for (const id of [...ids, ...extraIds]) await api('DELETE', `/posts/${id}/`, TOKENS.staff);
	return ids.length + extraIds.length;
}

// Trap 26: KaTeX fonts 403 under a worktree's dev server. Matched on the RESPONSE, counted, said.
const errors = [];
let ignoredFontErrors = 0;
// The refusals this script provokes on purpose (a link as a tag → 400, a minor's new tag → 403):
// the browser logs each as "Failed to load resource", which is the refusal working, not a bug.
let expectedRefusals = 0;
let ignoredRefusals = 0;
const browser = await chromium.launch(
	process.env.CHROME ? { executablePath: process.env.CHROME } : {}
);
async function session(locale, { width = 1280, height = 950, token, colorScheme } = {}) {
	const options = { viewport: { width, height }, ...(colorScheme ? { colorScheme } : {}) };
	const context =
		locale === 'en'
			? await englishContext(browser, BASE, options)
			: await browser.newContext(options);
	if (token) {
		await context.addInitScript((t) => {
			try {
				localStorage.setItem('edmat-auth-token', t);
			} catch {
				/* ignore */
			}
		}, token);
	}
	const page = await context.newPage();
	let fontFailures = 0;
	page.on('response', (r) => {
		if (r.status() === 403 && r.url().includes('/katex/') && r.url().endsWith('.woff2'))
			fontFailures++;
	});
	page.on('console', (msg) => {
		if (msg.type() !== 'error') return;
		if (expectedRefusals > 0 && /status of (400|403)/.test(msg.text())) {
			expectedRefusals--;
			ignoredRefusals++;
			return;
		}
		if (fontFailures > 0 && msg.text().includes('403')) {
			ignoredFontErrors++;
			return;
		}
		errors.push(`[${locale}] ${msg.text()}`);
	});
	page.on('pageerror', (e) => errors.push(`[${locale}] ${e.message}`));
	return page;
}
async function open(page, path) {
	const flags = page.waitForResponse((r) => r.url().includes('/feature-flags/'), {
		timeout: 30000
	});
	await page.goto(`${BASE}${path}`, { waitUntil: 'load' });
	await flags.catch(() => {});
	await settle(1200);
}
const noHorizontalScroll = (page) =>
	page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1);

async function fillQuestion(page, body) {
	await page.locator('form.ask textarea#ask-body').waitFor({ timeout: 20000 });
	await page.locator('form.ask textarea#ask-body').fill(body);
	await page.locator('form.ask #ask-tag').fill(TAG.slice(0, 6));
	await page
		.locator('.tag-picker__matches button', { hasText: `#${TAG}` })
		.first()
		.click();
	await page.locator('form.ask select:has(option[value="university"])').selectOption('university');
}

const removedAtStart = await cleanUp();
console.log(`reset: tombstoned ${removedAtStart} earlier question(s) marked ${MARK}`);

// An exercise carrying the tag, for the chip check.
const tagged = await api('GET', `/exercises/?tag=${encodeURIComponent(TAG)}`);
const taggedExerciseId = tagged.json?.[0]?.id;

const heldIds = [];
try {
	for (const locale of ['pl', 'en']) {
		const T = CATALOGUE[locale];
		console.log(`\n== ${locale} ==`);
		const question = `${MARK} ${locale} ${Date.now()}: ${
			locale === 'pl'
				? 'Jak pokazać indukcyjnie, że \\(2^n > n\\) dla każdego \\(n\\)?'
				: 'How do I show by induction that \\(2^n > n\\) for every \\(n\\)?'
		}`;

		// ---- 1. signed out: the hero has a destination, and it asks you to sign in -------------
		for (const width of [1280, 390]) {
			const anon = await session(locale, { width, height: width === 390 ? 844 : 950 });
			await open(anon, '/');
			const heroAsk = anon.locator('.hero a[href="/ask"]');
			check(
				`${width}: the hero has "${T.ask_heroCta}"`,
				(await heroAsk.textContent())?.trim() === T.ask_heroCta
			);
			check(`${width}: the home page does not scroll sideways`, await noHorizontalScroll(anon));
			await anon.locator('.hero').screenshot({ path: `${SHOTS}/ask-hero-${locale}-${width}.png` });
			if (width === 1280) {
				await heroAsk.click();
				await anon.waitForURL((u) => u.pathname === '/ask', { timeout: 15000 });
				await settle(800);
				check(
					'signed out: /ask offers sign-in, not the composer',
					(await anon.locator('.login-prompt a').textContent())?.trim() === T.ask_loginToAsk &&
						(await anon.locator('form.ask').count()) === 0
				);
			}
			await anon.context().close();
		}

		// ---- 2. signed in: hero → composer → the tag page --------------------------------------
		const asker = await session(locale, { token: TOKENS.asker });
		await open(asker, '/');
		await asker.locator('.hero a[href="/ask"]').click();
		await asker.waitForURL((u) => u.pathname === '/ask', { timeout: 15000 });
		await fillQuestion(asker, question);
		check(
			'the picker shows the chosen tag',
			(await asker.locator('.tag-picker__chip').textContent())?.trim() === `#${TAG}`
		);
		await asker.screenshot({ path: `${SHOTS}/ask-composer-${locale}-1280.png`, fullPage: true });
		await asker.locator('form.ask button[type="submit"]').click();
		await asker.waitForURL((u) => u.pathname === `/tags/${encodeURIComponent(TAG)}`, {
			timeout: 15000
		});
		await asker.locator('.list article.post').first().waitFor({ timeout: 15000 });
		await asker
			.locator('.katex')
			.first()
			.waitFor({ timeout: 15000 })
			.catch(() => {});
		await settle(600);
		check(
			'landed on the tag page with "asked"',
			(await asker.locator('.notice').textContent())?.includes(T.ask_asked)
		);
		check(
			'the question is first on the tag page',
			(await asker.locator('.list article.post').first().textContent())?.includes(MARK)
		);
		check(
			'the tag page heading is the tag',
			(await asker.locator('h1').textContent())?.trim() === `#${TAG}`
		);
		check(
			'the list is headed "' + T.ask_questionsHeading + '"',
			(await asker.locator('h2.list-heading').textContent())?.trim() === T.ask_questionsHeading
		);
		await asker.screenshot({ path: `${SHOTS}/ask-tagpage-${locale}-1280.png`, fullPage: true });

		// …and in the activity feed.
		await open(asker, '/activity');
		await asker.locator('.feed').waitFor({ timeout: 20000 });
		check(
			'the question is in the activity feed',
			(await asker.locator('.feed', { hasText: `${MARK} ${locale}` }).count()) === 1
		);

		// The Add… menu's entry.
		await asker.locator(`button[aria-haspopup="menu"]:has(.add-trigger)`).click();
		await settle(300);
		const addAsk = asker.locator('[role="menu"] a[href="/ask"]');
		check(
			`Add… has "${T.ask_navAdd}"`,
			(await addAsk.count()) === 1 && (await addAsk.textContent())?.trim() === T.ask_navAdd
		);
		await asker.keyboard.press('Escape');

		// The exercise page's chip opens the tag page.
		if (taggedExerciseId) {
			await open(asker, `/exercises/${taggedExerciseId}`);
			const chip = asker.locator('.tag-chip', { hasText: `#${TAG}` }).first();
			// Hover, not click: the pointer entering the chip opens its menu, and a click on top
			// of that toggles it shut again.
			await chip.locator('.tag-chip__trigger').hover();
			await chip.locator('.tag-chip__menu').waitFor({ timeout: 5000 });
			const link = chip.locator(`a[href="/tags/${encodeURIComponent(TAG)}"]`);
			check(
				`the exercise's tag chip offers "${T.ask_tagChipLink}"`,
				(await link.count()) === 1 && (await link.textContent())?.trim() === T.ask_tagChipLink
			);
		} else {
			check('an exercise carries the tag (for the chip check)', false, `none tagged #${TAG}`);
		}
		await asker.context().close();

		// ---- 3. a reply from somebody else ------------------------------------------------------
		const answerer = await session(locale, { token: TOKENS.answer });
		await open(answerer, `/tags/${encodeURIComponent(TAG)}`);
		const card = answerer.locator('.list article.post', { hasText: `${MARK} ${locale}` }).first();
		await card.waitFor({ timeout: 15000 });
		await card.locator('.post__actions button.action').first().click();
		await card.locator('.comment-form__open').click();
		const reply =
			locale === 'pl'
				? `${MARK} odpowiedź: krok indukcyjny 2^{n+1} = 2·2^n.`
				: `${MARK} answer: the step is 2^{n+1} = 2·2^n.`;
		await card.locator('.post__discussion textarea').fill(reply);
		const posted = answerer.waitForResponse(
			(r) => r.url().includes('/comments/') && r.request().method() === 'POST',
			{ timeout: 15000 }
		);
		await card.locator('.post__discussion form.comment-form button[type="submit"]').click();
		check('the reply is accepted', (await posted).status() === 201);
		await settle(800);
		check('the reply shows under the question', (await card.textContent())?.includes(reply));
		await answerer.context().close();
		const listed = await api('GET', `/posts/?tag=${encodeURIComponent(TAG)}`, TOKENS.asker);
		const mine = (listed.json ?? []).find((p) => p.body.includes(`${MARK} ${locale}`));
		check(
			'the list counts one reply',
			mine?.comment_count === 1,
			JSON.stringify(mine?.comment_count)
		);
		const notes = await api('GET', '/notifications/', TOKENS.asker);
		check(
			'the asker is notified of the answer',
			(notes.json ?? []).some(
				(n) => n.type === 'comment_reply' && String(n.post_id) === String(mine?.id)
			)
		);

		// ---- 4. the phone width ----------------------------------------------------------------
		const phone = await session(locale, { width: 390, height: 844, token: TOKENS.asker });
		await open(phone, `/ask?tag=${encodeURIComponent(TAG)}`);
		await phone.locator('form.ask textarea#ask-body').waitFor({ timeout: 20000 });
		check(
			'390: ?tag= preselects the tag',
			(await phone.locator('.tag-picker__chip').textContent())?.trim() === `#${TAG}`
		);
		await phone
			.locator('form.ask textarea#ask-body')
			.fill(question.replace(MARK, `${MARK} (draft)`));
		check('390: the composer does not scroll sideways', await noHorizontalScroll(phone));
		await phone.screenshot({ path: `${SHOTS}/ask-composer-${locale}-390.png`, fullPage: true });
		await open(phone, `/tags/${encodeURIComponent(TAG)}`);
		await phone.locator('.list article.post').first().waitFor({ timeout: 15000 });
		await phone
			.locator('.katex')
			.first()
			.waitFor({ timeout: 15000 })
			.catch(() => {});
		await settle(600);
		check('390: the tag page does not scroll sideways', await noHorizontalScroll(phone));
		await phone.screenshot({ path: `${SHOTS}/ask-tagpage-${locale}-390.png`, fullPage: true });
		await phone.context().close();
	}

	// ---- the picker mid-search, and both pages in the dark theme --------------------------------
	console.log('\n== dark theme (pl) ==');
	{
		const dark = await session('pl', {
			width: 390,
			height: 844,
			token: TOKENS.asker,
			colorScheme: 'dark'
		});
		await open(dark, '/ask');
		await dark.locator('form.ask #ask-tag').fill('całka');
		await settle(300);
		const shown = await dark.locator('.tag-picker__matches button').count();
		check('typing "całka" finds tags (folded: "calka-…", "całka z …")', shown > 1, String(shown));
		check('390 dark: no sideways scroll', await noHorizontalScroll(dark));
		await dark.screenshot({ path: `${SHOTS}/ask-picker-pl-390-dark.png`, fullPage: true });
		await dark.locator('form.ask #ask-tag').fill('zzzz-no-such');
		await settle(300);
		check(
			'an unknown tag says so, and offers to create it',
			(await dark.locator('.tag-picker__note').first().textContent())?.trim() ===
				CATALOGUE.pl.ask_tagNoMatch &&
				(await dark.locator('.tag-picker__create-button').count()) === 1
		);
		await dark.context().close();
		const wide = await session('pl', { token: TOKENS.asker, colorScheme: 'dark' });
		await open(wide, `/tags/${encodeURIComponent(TAG)}`);
		await wide.locator('.list article.post').first().waitFor({ timeout: 15000 });
		await wide
			.locator('.katex')
			.first()
			.waitFor({ timeout: 15000 })
			.catch(() => {});
		await settle(500);
		await wide.screenshot({ path: `${SHOTS}/ask-tagpage-pl-1280-dark.png`, fullPage: true });
		await wide.context().close();
	}

	// ---- 4b. a NEW tag (WP16) --------------------------------------------------------------------
	for (const locale of ['pl', 'en']) {
		const T = CATALOGUE[locale];
		const fill = (template, values) =>
			template.replace(/\{(\w+)\}/g, (_, key) => String(values[key] ?? ''));
		console.log(`\n== a new tag (${locale}) ==`);
		const stamp = Date.now().toString(36);
		const name = locale === 'pl' ? `Próba Łąki ${stamp}` : `Trial Meadow ${stamp}`;
		const slug = locale === 'pl' ? `proba-laki-${stamp}` : `trial-meadow-${stamp}`;

		// The picker offering "create", at both widths — the screenshots the brief asks for.
		for (const width of [390, 1280]) {
			const page = await session(locale, {
				width,
				height: width === 390 ? 844 : 950,
				token: TOKENS.asker
			});
			await open(page, '/ask');
			await page.locator('form.ask textarea#ask-body').waitFor({ timeout: 20000 });
			await page.locator('form.ask #ask-tag').fill(name);
			await settle(300);
			const offer = page.locator('.tag-picker__create-button');
			check(
				`${width}: the picker offers "${fill(T.tagnew_create, { name })}"`,
				(await offer.count()) === 1 &&
					(await offer.textContent())?.trim() === fill(T.tagnew_create, { name })
			);
			check(
				`${width}: …and says it will be #${slug}`,
				(await page.locator('.tag-picker__create .tag-picker__note').textContent())?.trim() ===
					fill(T.tagnew_willBe, { slug })
			);
			check(`${width}: no sideways scroll with the offer open`, await noHorizontalScroll(page));
			await page.locator('form.ask').screenshot({
				path: `${SHOTS}/tagnew-offer-${locale}-${width}.png`
			});
			if (width === 390) {
				await page.context().close();
				continue;
			}

			// Create it, ask, and land on the new tag's page.
			await offer.click();
			check(
				'the chosen tag is the new slug, marked new',
				(await page.locator('.tag-picker__chip').textContent())?.trim() === `#${slug}` &&
					(await page.locator('.tag-picker__badge').textContent())?.trim() === T.tagnew_badge
			);
			await page
				.locator('form.ask textarea#ask-body')
				.fill(`${MARK} ${locale} new tag ${stamp}: ${locale === 'pl' ? 'czy ktoś' : 'anyone'}?`);
			await page
				.locator('form.ask select:has(option[value="university"])')
				.selectOption('university');
			const created = page.waitForResponse(
				(r) => r.url().endsWith('/api/posts/') && r.request().method() === 'POST',
				{ timeout: 15000 }
			);
			await page.locator('form.ask button[type="submit"]').click();
			const response = await created;
			const body = await response.json();
			check(
				'the question and the tag are made together (201, tag_created)',
				response.status() === 201 && body.tag === slug && body.tag_created === true,
				JSON.stringify({ status: response.status(), tag: body.tag, created: body.tag_created })
			);
			createdTags.push(slug);
			await page.waitForURL((u) => u.pathname === `/tags/${slug}`, { timeout: 15000 });
			await page.locator('.list article.post').first().waitFor({ timeout: 15000 });
			await settle(500);
			check(
				`landed on /tags/${slug} saying the tag is created`,
				(await page.locator('.notice').textContent())?.trim() ===
					fill(T.tagnew_createdNotice, { tag: slug })
			);
			check(
				'the question is listed on the new tag',
				(await page.locator('.list article.post').first().textContent())?.includes(MARK)
			);
			await page.screenshot({ path: `${SHOTS}/tagnew-landed-${locale}-1280.png`, fullPage: true });

			// An existing tag typed in capitals, without Polish letters: named, not re-made.
			await open(page, '/ask');
			await page.locator('form.ask #ask-tag').fill('CALKA Z 1-FORMY');
			await settle(300);
			check(
				`"CALKA Z 1-FORMY" names the existing #${FOLD_TAG}`,
				(await page.locator('.tag-picker__note').first().textContent())?.trim() ===
					fill(T.tagnew_exists, { name: 'CALKA Z 1-FORMY', tag: FOLD_TAG }) &&
					(await page.locator('.tag-picker__matches button').first().textContent())?.trim() ===
						`#${FOLD_TAG}`
			);
			check(
				'…and does not offer to create it',
				(await page.locator('.tag-picker__create-button').count()) === 0
			);
			await page.locator('form.ask').screenshot({
				path: `${SHOTS}/tagnew-exists-${locale}-1280.png`
			});

			// A link as a tag name: offered (it folds to letters), refused with its reason.
			await page.locator('form.ask #ask-tag').fill('www.example.com');
			await settle(300);
			await page.locator('.tag-picker__create-button').click();
			await page.locator('form.ask textarea#ask-body').fill(`${MARK} ${locale} link tag`);
			await page
				.locator('form.ask select:has(option[value="university"])')
				.selectOption('university');
			expectedRefusals++;
			await page.locator('form.ask button[type="submit"]').click();
			await page.locator('.ask__error').waitFor({ timeout: 15000 });
			check(
				'a link as a tag is refused with its reason',
				(await page.locator('.ask__error').textContent())?.trim() === T.tagnew_reason_linkOrMarkup
			);
			check('…and nothing navigated', new URL(page.url()).pathname === '/ask');
			await page.locator('form.ask').screenshot({
				path: `${SHOTS}/tagnew-refused-${locale}-1280.png`
			});
			await page.context().close();
		}

		// The server reuses the tag a name folds to, whatever the picker knew.
		const reused = await api('POST', '/posts/', TOKENS.asker, {
			body: `${MARK} ${locale} reuse`,
			tag_name: 'Całka Z 1-Formy',
			audience: 'university',
			language: locale
		});
		check(
			`the API reuses #${FOLD_TAG} for "Całka Z 1-Formy"`,
			reused.status === 201 && reused.json?.tag === FOLD_TAG && reused.json?.tag_created === false,
			JSON.stringify({ status: reused.status, tag: reused.json?.tag })
		);
	}

	// A minor may not mint a tag — refused with the reason, in the page.
	{
		const T = CATALOGUE.pl;
		const minor = await session('pl', { token: TOKENS.minor });
		await open(minor, '/ask');
		await minor.locator('form.ask textarea#ask-body').waitFor({ timeout: 20000 });
		await minor.locator('form.ask textarea#ask-body').fill(`${MARK} minor new tag`);
		await minor.locator('form.ask #ask-tag').fill(`nowy temat ${Date.now().toString(36)}`);
		await settle(300);
		await minor.locator('.tag-picker__create-button').click();
		await minor
			.locator('form.ask select:has(option[value="university"])')
			.selectOption('university');
		expectedRefusals++;
		await minor.locator('form.ask button[type="submit"]').click();
		await minor.locator('.ask__error').waitFor({ timeout: 15000 });
		check(
			"a minor's new tag is refused with its reason",
			(await minor.locator('.ask__error').textContent())?.trim() === T.tagnew_reason_minor
		);
		await minor.locator('form.ask').screenshot({ path: `${SHOTS}/tagnew-minor-pl-1280.png` });
		await minor.context().close();
	}

	// ---- 5. a minor's question is held, and the page says so ----------------------------------
	console.log('\n== a minor (pl) ==');
	{
		const T = CATALOGUE.pl;
		const minor = await session('pl', { token: TOKENS.minor });
		await open(minor, '/ask');
		await fillQuestion(minor, `${MARK} minor ${Date.now()}: czy to dobrze?`);
		const created = minor.waitForResponse(
			(r) => r.url().endsWith('/api/posts/') && r.request().method() === 'POST',
			{ timeout: 15000 }
		);
		await minor.locator('form.ask button[type="submit"]').click();
		const response = await created;
		const body = await response.json();
		heldIds.push(body.id);
		check('a minor may ask (201)', response.status() === 201);
		check('…and it comes back held', body.auto_hidden_at !== null);
		await settle(600);
		check(
			'the page says it waits for moderation',
			(await minor.locator('.held').textContent())?.includes(T.ask_held)
		);
		check('…and stays on /ask', new URL(minor.url()).pathname === '/ask');
		await minor.screenshot({ path: `${SHOTS}/ask-held-pl-1280.png`, fullPage: true });
		await minor.context().close();
		const listed = await api('GET', `/posts/?tag=${encodeURIComponent(TAG)}`, TOKENS.asker);
		check(
			'the held question is not on the tag page',
			!(listed.json ?? []).some((p) => p.id === body.id)
		);
		const feed = await api('GET', '/activity/?kind=post&limit=50', TOKENS.asker);
		check('…nor in the feed', !(feed.json ?? []).some((row) => row.post === body.id));
	}

	// ---- 6. the kill switch, as a NON-staff account (trap 10) ---------------------------------
	console.log('\n== posts switched off (pl, non-staff) ==');
	const off = await api('PATCH', '/feature-flags/posts/', TOKENS.staff, { is_enabled: false });
	check('staff switched `posts` off', off.status === 200 && off.json?.is_enabled === false);
	try {
		const T = CATALOGUE.pl;
		const page = await session('pl', { token: TOKENS.asker });
		await open(page, '/');
		check('off: no "Ask" in the hero', (await page.locator('a[href="/ask"]').count()) === 0);
		await page
			.locator(`button[aria-haspopup="menu"]:has(.add-trigger)`)
			.click()
			.catch(() => {});
		await settle(300);
		check('off: no "Ask" in the Add… menu', (await page.locator('a[href="/ask"]').count()) === 0);
		await page.keyboard.press('Escape');
		await open(page, '/ask');
		check(
			'off: /ask says the feature is unavailable',
			(await page.locator('.feature-disabled').textContent())?.includes(
				T.featureFlags_disabledNotice
			) && (await page.locator('form.ask').count()) === 0
		);
		await open(page, `/tags/${encodeURIComponent(TAG)}`);
		check(
			'off: the tag page says the same',
			(await page.locator('.feature-disabled').count()) === 1 &&
				(await page.locator('article.post').count()) === 0
		);
		if (taggedExerciseId) {
			await open(page, `/exercises/${taggedExerciseId}`);
			const chip = page.locator('.tag-chip', { hasText: `#${TAG}` }).first();
			// Hover, not click: the pointer entering the chip opens its menu, and a click on top
			// of that toggles it shut again.
			await chip.locator('.tag-chip__trigger').hover();
			await chip.locator('.tag-chip__menu').waitFor({ timeout: 5000 });
			check(
				'off: the tag chip has no tag-page link',
				(await chip.locator('a[href^="/tags/"]').count()) === 0
			);
		}
		await page.context().close();
		const closed = await api('GET', `/posts/?tag=${encodeURIComponent(TAG)}`, TOKENS.asker);
		check('off: the API refuses the list to a non-staff account', closed.status === 403);
	} finally {
		const on = await api('PATCH', '/feature-flags/posts/', TOKENS.staff, { is_enabled: true });
		check('`posts` switched back on', on.status === 200 && on.json?.is_enabled === true);
	}
} finally {
	const removed = await cleanUp(heldIds);
	const left = await api('GET', `/posts/?tag=${encodeURIComponent(TAG)}&limit=50`, TOKENS.staff);
	check(
		`cleanup: tombstoned ${removed}, none of ours left listed`,
		!(left.json ?? []).some((p) => p.body.includes(MARK))
	);
	// The orphan rule: a tag a question minted leaves the site when its only question does.
	for (const slug of createdTags) {
		const gone = await api('GET', `/tags/${encodeURIComponent(slug)}/`, TOKENS.asker);
		check(`cleanup: #${slug} is no longer listed (404)`, gone.status === 404, String(gone.status));
	}
	await browser.close();
}

if (ignoredRefusals)
	console.log(`(ignored ${ignoredRefusals} logged 400/403s — the refusals this script provokes)`);
if (ignoredFontErrors)
	console.log(`\n(ignored ${ignoredFontErrors} KaTeX font 403s — e2e/CLAUDE.md trap 26)`);
check(
	'no console or page errors',
	errors.length === 0,
	`\n    ${errors.slice(0, 8).join('\n    ')}`
);
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
