// End-to-end check of the one-screen profile and the modal-per-area editor.
//
// Run it with both halves running:
//   backend:  DJANGO_CORS_ALLOWED_ORIGINS=http://localhost:5177 EDMAT_USOS_MOCK=true manage.py runserver 8013
//   frontend: PUBLIC_API_BASE_URL=http://localhost:8013/api npm run dev -- --port 5177
//   E2E_BASE=http://localhost:5177 E2E_API=http://127.0.0.1:8013/api node e2e/profile-overhaul.mjs
//
// Seed the account it reads first: `manage.py seed_profile_showcase`.
//
// What only a browser can confirm, and therefore what this is for:
//
// * the summary really is one screen at PHONE width, with the detail behind dialogs rather than
//   below the fold — screenshots are written to /tmp and are meant to be looked at, since every
//   assertion here passed on a layout that was visibly wrong at least once in this project's history;
// * the tiles open the same feed filtered rather than nine separate views;
// * the transcript is grouped by year and each year carries its own average;
// * and the two privacy rules hold in the rendering, not just in the API — a private set and a
//   finished lesson are visible to their owner and to nobody else.
//
// Playwright is deliberately not a dependency of this repo — `npx playwright install chromium`, or
// point CHROME at a binary. `playwright-core` is accepted too.
let chromium;
try {
	({ chromium } = await import('playwright'));
} catch {
	({ chromium } = await import('playwright-core'));
}

const BASE = process.env.E2E_BASE ?? 'http://localhost:5177';
const API = process.env.E2E_API ?? 'http://127.0.0.1:8013/api';
const SHOTS = process.env.E2E_SHOTS ?? '/tmp/edmat-profile';

const PHONE = { width: 390, height: 844 };
const DESKTOP = { width: 1180, height: 1000 };

let pass = 0;
let fail = 0;
const ck = (label, ok, extra = '') => {
	if (ok) {
		pass++;
		console.log('  ok   ' + label);
	} else {
		fail++;
		console.log('  FAIL ' + label + (extra ? ' — ' + extra : ''));
	}
};

/** Requests this run deliberately provokes, so a refusal that is the POINT of a check does not read
 * as a fault. Recorded as a list of matchers rather than by suppressing "Failed to load resource"
 * wholesale, which would hide a genuine one. */
const EXPECTED_FAILURES = [
	// The duplicate-certificate check: a 400 with a real message is what it is asserting.
	{ status: 400, url: '/me/certificates/' },
	// KaTeX's own font files, served straight out of node_modules by Vite in dev. They 403 only when
	// node_modules is a SYMLINK outside the project root, which is how a git worktree is usually set up
	// here — an artifact of the checkout, not of the app, and absent from a production build where the
	// fonts are bundled. Named rather than silently dropped so a real font failure would still show.
	{ status: 403, url: '/node_modules/katex/dist/fonts/' }
];

const errs = [];
function watch(page) {
	page.on('pageerror', (e) => errs.push(e.message));
	// The browser's own "Failed to load resource" console line does not say WHICH resource, which
	// makes a genuine failure undiagnosable from the output. Recording the response instead names it.
	page.on('response', (res) => {
		if (res.status() < 400) return;
		const url = res.url();
		if (EXPECTED_FAILURES.some((e) => e.status === res.status() && url.includes(e.url))) return;
		errs.push(`${res.status()} ${url}`);
	});
	page.on('console', (msg) => {
		// Skipped: the text carries no URL, and the response listener above already reports every
		// failure with one.
		if (msg.type() === 'error' && !msg.text().startsWith('Failed to load resource')) {
			errs.push(msg.text().slice(0, 200));
		}
	});
	// Every destructive action in the editor goes through a native confirm; accepting is what the
	// person clicking Remove means.
	page.on('dialog', (d) => d.accept());
	return page;
}

async function token(email, password = 'password123') {
	const res = await fetch(API + '/auth/login/', {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		// The login endpoint takes the EMAIL in a field called `username` — resolved server-side.
		body: JSON.stringify({ username: email, password })
	});
	const body = await res.json();
	if (!body.token) throw new Error('login failed for ' + email + ': ' + JSON.stringify(body));
	return body.token;
}

async function signedInPage(browser, tok, viewport) {
	const ctx = await browser.newContext({ viewport });
	// Written BEFORE the first navigation, or the root layout's own init() runs against an empty
	// store and the page renders signed out.
	await ctx.addInitScript((t) => localStorage.setItem('edmat-auth-token', t), tok);
	return watch(await ctx.newPage());
}

const browser = await chromium.launch(
	process.env.CHROME ? { executablePath: process.env.CHROME } : {}
);

const kasiaToken = await token('kasia@edmat.example');
const me = await (
	await fetch(API + '/auth/me/', { headers: { Authorization: 'Token ' + kasiaToken } })
).json();
const KASIA = me.id;

// This runs against a real account, and the bio check below writes to it. Captured here and put back
// at the end — without that, the first run replaced the seeded bio with its own short marker and
// every run after it failed the "a long bio is clamped" check for a reason that had nothing to do
// with the code. A script that degrades the data it reads is a script that only works once.
const ORIGINAL_BIO = me.bio ?? '';

// What the API says this reader may see, so the rendering can be checked against it rather than
// against a number typed into this file.
const anonCounts = (await (await fetch(`${API}/users/${KASIA}/activity/`)).json()).counts;
const selfCounts = (
	await (
		await fetch(`${API}/users/${KASIA}/activity/`, {
			headers: { Authorization: 'Token ' + kasiaToken }
		})
	).json()
).counts;

// ---------------------------------------------------------------------------------------------
console.log('\nA stranger, on a phone');
{
	const ctx = await browser.newContext({ viewport: PHONE });
	const p = watch(await ctx.newPage());
	await p.goto(`${BASE}/users/${KASIA}`, { waitUntil: 'networkidle' });
	await p.waitForTimeout(2500);

	ck('the name renders', (await p.locator('h1').first().innerText()).includes('Kasia'));
	ck('a bio is shown', (await p.locator('.bio').count()) >= 1);

	// A long bio is clamped rather than allowed to push the tiles off the screen, and the way back to
	// the whole of it is offered rather than left to be guessed at.
	const bio = p.locator('.bio').first();
	const clamped = await bio.evaluate((el) => el.scrollHeight > el.clientHeight + 2);
	ck('a long bio is visually clamped', clamped);
	ck(
		'and the rest is one tap away',
		(await p.locator('button', { hasText: 'Read all' }).count()) === 1
	);
	await p.locator('button', { hasText: 'Read all' }).click();
	await p.waitForTimeout(500);
	const full = await p
		.locator('[role="dialog"] .bio')
		.first()
		.evaluate((el) => el.scrollHeight <= el.clientHeight + 2);
	ck('the dialog shows the whole bio unclamped', full);
	await p.keyboard.press('Escape');
	await p.waitForTimeout(300);

	const tiles = p.locator('.tile');
	const tileCount = await tiles.count();
	ck('summary tiles render', tileCount >= 5, `saw ${tileCount}`);
	ck(
		'one tile per kind the API admits to',
		tileCount === Object.keys(anonCounts).length,
		`${tileCount} vs ${Object.keys(anonCounts).length}`
	);

	// The layout claim, checked rather than asserted: everything above the activity section has to
	// fit a 844px-tall screen, or "one screen" is not what this is.
	const summaryBottom = await p
		.locator('.rows')
		.first()
		.evaluate((el) => el.getBoundingClientRect().bottom);
	ck(
		'identity, tiles and the summary rows fit one phone screen',
		summaryBottom <= 844,
		`${Math.round(summaryBottom)}px`
	);

	// Nothing may scroll sideways at 390px — the failure this project has shipped before.
	const overflow = await p.evaluate(
		() => document.documentElement.scrollWidth - document.documentElement.clientWidth
	);
	ck('no horizontal overflow at 390px', overflow <= 0, `${overflow}px`);

	await p.screenshot({ path: `${SHOTS}-phone-profile.png`, fullPage: true });

	// A tile opens the feed filtered to its own kind.
	await p.locator('.tile').first().click();
	await p.waitForTimeout(600);
	ck('a tile opens a dialog', (await p.locator('[role="dialog"]').count()) === 1);
	const selected = await p.locator('[role="dialog"] select').first().inputValue();
	ck('the dialog opens pre-filtered to that tile', selected !== '', `value ${selected}`);
	const rows = await p.locator('[role="dialog"] .feed .row').count();
	ck('the filtered feed lists that kind', rows > 0, `${rows} rows`);
	await p.screenshot({ path: `${SHOTS}-phone-activity.png` });

	await p.keyboard.press('Escape');
	await p.waitForTimeout(400);
	ck('Escape closes it', (await p.locator('[role="dialog"]').count()) === 0);

	// Education, with the transcript grouped by year.
	await p.locator('.row', { hasText: 'Education' }).first().click();
	await p.waitForTimeout(600);
	const years = await p.locator('[role="dialog"] .year').count();
	ck('the transcript is grouped into academic years', years >= 3, `${years} years`);
	const averages = await p.locator('[role="dialog"] .year__average').count();
	ck('every year carries its own average', averages === years, `${averages} of ${years}`);
	await p.screenshot({ path: `${SHOTS}-phone-transcript.png` });

	// A collapsed year opens on demand — that is what keeps the modal readable at this width.
	const before = await p.locator('[role="dialog"] .grade').count();
	await p.locator('[role="dialog"] .year__toggle').nth(1).click();
	await p.waitForTimeout(300);
	const after = await p.locator('[role="dialog"] .grade').count();
	ck('opening a second year reveals its results', after > before, `${before} → ${after}`);

	await p.locator('[role="dialog"] .close').click();
	await p.waitForTimeout(300);

	// Certificates, the new record type.
	await p.locator('.row', { hasText: 'Certificates' }).first().click();
	await p.waitForTimeout(600);
	const certs = await p.locator('[role="dialog"] .certificate').count();
	ck('certificates are listed', certs >= 3, `${certs}`);
	ck(
		'an expired one says so rather than passing as current',
		(await p.locator('[role="dialog"] .badge--expired').count()) >= 1
	);
	ck(
		'a verification link is offered where there is one',
		(await p.locator('[role="dialog"] .certificate__link').count()) >= 2
	);
	await p.screenshot({ path: `${SHOTS}-phone-certificates.png` });
	await p.locator('[role="dialog"] .close').click();

	// The privacy half, in the rendering rather than only in the API.
	await p.locator('.tile', { hasText: 'Saved sets' }).first().click();
	await p.waitForTimeout(600);
	const setRows = await p.locator('[role="dialog"] .feed .row').count();
	ck(
		'a stranger sees only the shared sets',
		setRows === anonCounts.saved_set,
		`${setRows} vs ${anonCounts.saved_set}`
	);
	await p.locator('[role="dialog"] .close').click();

	ck(
		'nothing offers a stranger the finished-lesson tile',
		(await p.locator('.tile', { hasText: 'Finished' }).count()) === 0
	);
	ck(
		'no edit button for somebody else',
		(await p.locator('a', { hasText: 'Edit my profile' }).count()) === 0
	);

	await ctx.close();
}

// ---------------------------------------------------------------------------------------------
console.log('\nThe same profile on a desktop');
{
	const ctx = await browser.newContext({ viewport: DESKTOP });
	const p = watch(await ctx.newPage());
	await p.goto(`${BASE}/users/${KASIA}`, { waitUntil: 'networkidle' });
	await p.waitForTimeout(2000);
	ck('the same summary renders wide', (await p.locator('.tile').count()) >= 5);
	await p.screenshot({ path: `${SHOTS}-desktop-profile.png`, fullPage: true });
	await ctx.close();
}

// ---------------------------------------------------------------------------------------------
console.log('\nThe owner, looking at her own profile');
{
	const p = await signedInPage(browser, kasiaToken, PHONE);
	await p.goto(`${BASE}/users/${KASIA}`, { waitUntil: 'networkidle' });
	await p.waitForTimeout(2500);

	ck(
		'the owner is offered the editor',
		(await p.locator('a', { hasText: 'Edit my profile' }).count()) === 1
	);
	ck(
		'the owner is not offered a message link to herself',
		(await p.locator('a', { hasText: 'Send message' }).count()) === 0
	);
	ck(
		'the owner sees her own finished sessions',
		(await p.locator('.tile', { hasText: 'Finished' }).count()) === 1
	);

	await p.locator('.tile', { hasText: 'Saved sets' }).first().click();
	await p.waitForTimeout(600);
	const mine = await p.locator('[role="dialog"] .feed .row').count();
	ck(
		'the owner sees her private sets too',
		mine === selfCounts.saved_set && mine > anonCounts.saved_set,
		`${mine} vs anon ${anonCounts.saved_set}`
	);
	ck(
		'a private set is labelled as such',
		(await p.locator('[role="dialog"] .row__note', { hasText: 'only you' }).count()) >= 1
	);
	await p.locator('[role="dialog"] .close').click();
	await p.close();
}

// ---------------------------------------------------------------------------------------------
console.log('\nThe editor');
{
	const p = await signedInPage(browser, kasiaToken, PHONE);
	await p.goto(`${BASE}/settings/profile`, { waitUntil: 'networkidle' });
	await p.waitForTimeout(2500);

	const rows = await p.locator('.row').count();
	ck('every area is one row', rows === 6, `${rows}`);
	ck(
		'it points back at the rest of settings rather than swallowing them',
		(await p.locator('a', { hasText: 'Open settings' }).count()) === 1
	);
	const editorBottom = await p
		.locator('.card')
		.nth(1)
		.evaluate((el) => el.getBoundingClientRect().bottom);
	ck('the editor is one phone screen too', editorBottom <= 844, `${Math.round(editorBottom)}px`);
	await p.screenshot({ path: `${SHOTS}-phone-editor.png`, fullPage: true });

	// The avatar is a wrapper around the existing editor, so what needs checking is only that it
	// really opens inside the dialog rather than that its crop step works — which it already did
	// before this, on the settings page, and still does there.
	await p.locator('.row', { hasText: 'Profile picture' }).click();
	await p.waitForTimeout(700);
	ck(
		'the avatar editor opens in a dialog',
		(await p.locator('[role="dialog"] input[type="file"]').count()) === 1
	);
	await p.keyboard.press('Escape');
	await p.waitForTimeout(400);

	// --- the bio, which nothing in this app could write before ---------------------------------
	await p.locator('.row', { hasText: 'Name and bio' }).click();
	await p.waitForTimeout(600);
	ck('the basics dialog opens', (await p.locator('[role="dialog"]').count()) === 1);
	// Deliberately long enough to still be clamped: the bio this writes is what the NEXT run reads
	// before it is restored, so a short marker would quietly disarm the clamp check.
	const marker = `Sprawdzenie ${Date.now()} — ${'tekst wystarczająco długi, żeby przyciąć. '.repeat(4)}`;
	await p.locator('[role="dialog"] textarea').fill(marker);
	await p.screenshot({ path: `${SHOTS}-phone-editor-basics.png` });
	await p.locator('[role="dialog"] button[type="submit"]').click();
	await p.waitForTimeout(1800);
	ck('saving closes the dialog', (await p.locator('[role="dialog"]').count()) === 0);

	const savedBio = (
		await (
			await fetch(API + '/auth/me/', { headers: { Authorization: 'Token ' + kasiaToken } })
		).json()
	).bio;
	// Compared against the trimmed marker: the form trims before sending, which is correct, and this
	// marker ends in a space.
	ck('the bio really reached the server', savedBio === marker.trim(), savedBio?.slice(0, 40));

	// --- a certificate, end to end --------------------------------------------------------------
	await p.locator('.row', { hasText: 'Certificates' }).click();
	await p.waitForTimeout(600);
	const certsBefore = await p.locator('[role="dialog"] .row').count();
	await p.locator('[role="dialog"] button', { hasText: 'Add a certificate' }).click();
	await p.waitForTimeout(300);
	const title = `Scratch ${Date.now()}`;
	await p.locator('[role="dialog"] form input').nth(0).fill(title);
	await p.locator('[role="dialog"] form input').nth(1).fill('E2E Institute');
	// The URL field is deliberately type=text, so a scheme-less address is accepted and normalized.
	await p.locator('[role="dialog"] form input[inputmode="url"]').fill('example.org/verify/1');
	await p.locator('[role="dialog"] form button[type="submit"]').click();
	await p.waitForTimeout(1800);
	const certsAfter = await p.locator('[role="dialog"] .row').count();
	ck('the certificate is added', certsAfter === certsBefore + 1, `${certsBefore} → ${certsAfter}`);

	const extras = await (await fetch(`${API}/users/${KASIA}/extras/`)).json();
	const created = extras.certificates.find((c) => c.title === title);
	ck('it reached the server', Boolean(created));
	ck(
		'a scheme was added rather than the save being refused',
		created?.url === 'https://example.org/verify/1',
		created?.url
	);

	// A duplicate is refused in words, not as a server error.
	await p.locator('[role="dialog"] button', { hasText: 'Add a certificate' }).click();
	await p.waitForTimeout(300);
	await p.locator('[role="dialog"] form input').nth(0).fill(title);
	await p.locator('[role="dialog"] form input').nth(1).fill('E2E Institute');
	await p.locator('[role="dialog"] form button[type="submit"]').click();
	await p.waitForTimeout(1500);
	ck(
		'a duplicate is refused with a real message',
		(await p.locator('[role="dialog"] .error').count()) === 1,
		await p
			.locator('[role="dialog"] .error')
			.first()
			.innerText()
			.catch(() => '')
	);
	await p.screenshot({ path: `${SHOTS}-phone-editor-certificates.png` });

	// Clean up after ourselves — this runs against a real database.
	await p.locator('[role="dialog"] button', { hasText: 'Cancel' }).click();
	await p.waitForTimeout(300);
	await p
		.locator('[role="dialog"] .row', { hasText: title })
		.locator('button', { hasText: 'Remove' })
		.click();
	await p.waitForTimeout(1800);
	const after = await (await fetch(`${API}/users/${KASIA}/extras/`)).json();
	ck('removing it really removed it', !after.certificates.some((c) => c.title === title));
	await p.locator('[role="dialog"] .close').click();

	// --- experience and skills, the two lists the old edit-in-place surface used to own -----------
	// Carried over from `profile-editing.mjs`, which this replaces: that script drove ⋯ menus on the
	// public profile, and the whole point of this change is that those are now a dialog on an editor
	// of its own. The writes it checked still matter and are checked here.
	await p.locator('.row', { hasText: 'Experience' }).click();
	await p.waitForTimeout(800);
	const expBefore = await p.locator('[role="dialog"] .row').count();
	await p.locator('[role="dialog"] button', { hasText: 'Add an entry' }).click();
	await p.waitForTimeout(300);
	const expTitle = `Scratch experience ${Date.now()}`;
	await p.locator('[role="dialog"] form input[type="text"]').first().fill(expTitle);
	await p.locator('[role="dialog"] form button[type="submit"]').click();
	await p.waitForTimeout(1800);
	ck(
		'an experience entry is added',
		(await p.locator('[role="dialog"] .row').count()) === expBefore + 1
	);
	// Reordering is what the `order` column is for, and the check has to be against what the SERVER
	// returns rather than a DOM index computed from the starting positions: the seeded orders are not
	// guaranteed contiguous (an earlier run of this very script left a gap), and an index-based
	// assertion fails on that for a reason that has nothing to do with reordering working.
	const orderedBefore = (await (await fetch(`${API}/users/${KASIA}/extras/`)).json()).experience;
	const neighbour = orderedBefore[orderedBefore.length - 2];
	await p.locator('[role="dialog"] .row').last().locator('button[aria-label="Move up"]').click();
	await p.waitForTimeout(1800);
	const orderedAfter = (await (await fetch(`${API}/users/${KASIA}/extras/`)).json()).experience;
	const movedIndex = orderedAfter.findIndex((e) => e.title === expTitle);
	ck(
		'moving it up really reorders the list',
		movedIndex === orderedAfter.length - 2,
		`index ${movedIndex} of ${orderedAfter.length}`
	);

	await p
		.locator('[role="dialog"] .row', { hasText: expTitle })
		.locator('button', { hasText: 'Remove' })
		.click();
	await p.waitForTimeout(1800);
	ck(
		'and removing it puts the list back',
		(await p.locator('[role="dialog"] .row').count()) === expBefore
	);
	// Put the neighbour's own `order` back too. Removing the scratch row does not undo the swap that
	// moved it, so without this every run leaves the seeded list one step further from what the seed
	// command wrote — the same "leave it as you found it" the bio restore exists for.
	await fetch(`${API}/me/experience/${neighbour.id}/`, {
		method: 'PATCH',
		headers: { 'Content-Type': 'application/json', Authorization: 'Token ' + kasiaToken },
		body: JSON.stringify({ order: neighbour.order })
	});
	await p.locator('[role="dialog"] .close').click();
	await p.waitForTimeout(400);

	await p.locator('.row', { hasText: 'Skills' }).click();
	await p.waitForTimeout(800);
	const skillLabel = `Scratch skill ${Date.now()}`;
	await p.locator('[role="dialog"] button', { hasText: 'Add a skill' }).click();
	await p.waitForTimeout(300);
	await p.locator('[role="dialog"] form input[type="text"]').first().fill(skillLabel);
	await p.locator('[role="dialog"] form button[type="submit"]').click();
	await p.waitForTimeout(1800);

	const skillsNow = (await (await fetch(`${API}/users/${KASIA}/extras/`)).json()).skills;
	const added = skillsNow.find((s) => s.label === skillLabel);
	ck('a skill is added', Boolean(added));
	// The rule the API exists to hold: `registry` means an institution said so, and nothing typed into
	// a form may claim it. The form does not even offer the choice, so this checks the outcome.
	ck('anything typed here is self-declared', added?.evidence === 'self_declared', added?.evidence);
	await p
		.locator('[role="dialog"] .row', { hasText: skillLabel })
		.locator('button', { hasText: 'Remove' })
		.click();
	await p.waitForTimeout(1800);
	const skillsAfter = (await (await fetch(`${API}/users/${KASIA}/extras/`)).json()).skills;
	ck('and removing it really removes it', !skillsAfter.some((s) => s.label === skillLabel));
	await p.locator('[role="dialog"] .close').click();
	await p.waitForTimeout(400);

	// --- the transcript, a year at a time -------------------------------------------------------
	await p.locator('.row', { hasText: 'Education' }).click();
	await p.waitForTimeout(1500);
	const yearsBefore = await p.locator('[role="dialog"] .year').count();
	ck('the editor shows the years too', yearsBefore >= 3, `${yearsBefore}`);
	await p.screenshot({ path: `${SHOTS}-phone-editor-education.png` });

	const consentBefore = (
		await (
			await fetch(API + '/education/me/', { headers: { Authorization: 'Token ' + kasiaToken } })
		).json()
	).education.share_grades;

	await p.locator('[role="dialog"] .year__remove').last().click();
	await p.waitForTimeout(2000);
	const yearsAfter = await p.locator('[role="dialog"] .year').count();
	ck(
		'removing one year removes exactly one',
		yearsAfter === yearsBefore - 1,
		`${yearsBefore} → ${yearsAfter}`
	);

	const educationNow = (
		await (
			await fetch(API + '/education/me/', { headers: { Authorization: 'Token ' + kasiaToken } })
		).json()
	).education;
	ck(
		'pruning a year does not silently un-publish the rest',
		educationNow.share_grades === consentBefore,
		`${consentBefore} → ${educationNow.share_grades}`
	);

	// Put it back through the real transfer, which is also the check that a full transfer restores
	// every year rather than only the one that was removed.
	await p.locator('[role="dialog"] button', { hasText: 'Transfer my grades' }).click();
	await p.waitForTimeout(2500);
	const restored = await p.locator('[role="dialog"] .year').count();
	ck(
		'a full transfer restores every year',
		restored === yearsBefore,
		`${restored} vs ${yearsBefore}`
	);
	await p.locator('[role="dialog"] .close').click();

	await p.close();
}

// ---------------------------------------------------------------------------------------------
console.log('\nKeyboard');
{
	const p = await signedInPage(browser, kasiaToken, DESKTOP);
	await p.goto(`${BASE}/settings/profile`, { waitUntil: 'networkidle' });
	await p.waitForTimeout(2500);

	// The settings page is where somebody who has not seen the editor will go looking for it, so the
	// route it links to has to be the real one rather than a link nobody followed after it was written.
	await p.goto(`${BASE}/settings`, { waitUntil: 'networkidle' });
	await p.waitForTimeout(2000);
	const editorLink = p.locator('a', { hasText: 'Edit my profile' });
	ck('settings offers the editor', (await editorLink.count()) === 1);
	await editorLink.first().click();
	await p.waitForTimeout(2000);
	ck('and the link lands on it', p.url().endsWith('/settings/profile'), p.url());

	const trigger = p.locator('.row', { hasText: 'Skills' });
	await trigger.focus();
	await p.keyboard.press('Enter');
	await p.waitForTimeout(700);
	ck('a row opens with the keyboard', (await p.locator('[role="dialog"]').count()) === 1);

	// Focus must be inside the dialog, or Tab walks the page behind it — which `aria-modal` has been
	// promising it does not since the day this shell was written.
	const insideAtOpen = await p.evaluate(
		() => !!document.querySelector('[role="dialog"]')?.contains(document.activeElement)
	);
	ck('focus moves into the dialog on open', insideAtOpen);

	for (let i = 0; i < 25; i++) await p.keyboard.press('Tab');
	const stillInside = await p.evaluate(
		() => !!document.querySelector('[role="dialog"]')?.contains(document.activeElement)
	);
	ck('focus is trapped inside it', stillInside);

	await p.keyboard.press('Escape');
	await p.waitForTimeout(400);
	ck('Escape closes it', (await p.locator('[role="dialog"]').count()) === 0);
	const returned = await p.evaluate(
		() => document.activeElement?.textContent?.includes('Skills') ?? false
	);
	ck('focus returns to the row that opened it', returned);

	await p.close();
}

await browser.close();

// Put the bio back the way it was found.
await fetch(API + '/auth/me/', {
	method: 'PATCH',
	headers: { 'Content-Type': 'application/json', Authorization: 'Token ' + kasiaToken },
	body: JSON.stringify({ bio: ORIGINAL_BIO })
});

console.log(`\n${pass} passed, ${fail} failed`);
if (errs.length) {
	console.log('console/page errors:');
	for (const e of [...new Set(errs)]) console.log('  ' + e);
}
console.log(`screenshots: ${SHOTS}-*.png`);
process.exit(fail === 0 && errs.length === 0 ? 0 : 1);
