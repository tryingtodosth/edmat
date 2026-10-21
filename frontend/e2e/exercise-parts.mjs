// Sub-exercises, the reader's and the author's side (`SUBEXERCISES-BRIEF.md` §3–§4, step C,
// 2026-10-21). Seeds a three-part exercise owned by u-michal through `manage.py shell` on THIS
// checkout's database, then drives the real pages:
//   1. a stranger reads it — three part blocks in order, each labelled; the whole-exercise hint
//      stage says "for the whole exercise" and sits before the parts, the whole answer after them;
//      part (b)'s answer reveals (b)'s and nobody else's; each part lists only its own entries;
//   2. michal (the author, a verified contributor) adds a hint FOR (b) through the real composer —
//      "For:" pre-set to (b) — against the REAL `POST /exercises/{id}/entries/`, and sees it under
//      (b) only;
//   3. ola (a plain account) suggests an edit to part (b)'s statement — the request is
//      INTERCEPTED (see below) and its `part` asserted;
//   4. michal opens the edit page, adds a fourth part, reorders, removes one (the in-page confirm
//      names what goes with it), saves — the PATCH is INTERCEPTED and its `parts` asserted; Undo
//      and a refusal sentence too;
//   5. staff: an ordinary exercise's edit sends no `parts` at all; the moderation queue says which
//      part a pending entry is for.
//
// EVERY REQUEST IS REAL. On `parts/c-page` the PATCH with `parts` and the suggestion `part` were
// answered by route stand-ins, because step A (`parts/a-backend`) was built at the same time; the
// integration (§17CV) removed them. The PATCH, the suggestion and the entry POST now land on the
// merged backend and the script reads back what it wrote through the API — the parts after a
// save, the suggestion row, the deleted part's entries — so a stand-in cannot hide a backend that
// disagrees with the form. Staff's ordinary edit (step 5) is on a SECOND seeded exercise, never a
// corpus row: a real PATCH is a real write.
//
// Tokens come from the database (trap 30), never the login form. Clear `backend/cachedata/*` with
// the backend STOPPED first (trap 28).
//
//   E2E_BASE=http://127.0.0.1:5283 E2E_API=http://127.0.0.1:8183 \
//   LD_LIBRARY_PATH=… CHROME=<chrome-headless-shell> node e2e/exercise-parts.mjs
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
const RAW_API = process.env.E2E_API ?? 'http://localhost:8000/api';
const API = RAW_API.replace(/\/$/, '').endsWith('/api')
	? RAW_API.replace(/\/$/, '')
	: `${RAW_API.replace(/\/$/, '')}/api`;
const REPO = new URL('../../', import.meta.url).pathname;
const PY = process.env.E2E_PYTHON ?? `${REPO}.venv/bin/python3`;
const SHOTS = process.env.SHOTS ?? new URL('./screens/exercise-parts/', import.meta.url).pathname;
mkdirSync(SHOTS, { recursive: true });
const STAMP = Date.now();
const MARK = 'E2E parts';

let pass = 0,
	fail = 0;
const check = (label, ok, detail = '') => {
	if (ok) pass++;
	else fail++;
	console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${label}${ok ? '' : ' — ' + detail}`);
};

function shell(code) {
	return execFileSync(PY, ['manage.py', 'shell', '-c', code], {
		cwd: `${REPO}backend`,
		encoding: 'utf8',
		stdio: ['ignore', 'pipe', 'pipe']
	});
}
const lastJson = (out) => JSON.parse(out.trim().split('\n').pop());

// ---- seed: a three-part exercise by michal, with one entry in each place that matters --------
const seeded = lastJson(
	shell(`
import json
from django.contrib.auth import get_user_model
from django.db.models import Max
from rest_framework.authtoken.models import Token
from exercises.models import Exercise, ExerciseTranslation, ExercisePart, ExercisePartTranslation, SolutionEntry
U = get_user_model()
michal, ola, kasia = (U.objects.get(username=n) for n in ('u-michal', 'u-ola', 'u-kasia'))
Exercise.objects.filter(translations__title__startswith='${MARK}').delete()
branch = Exercise.objects.get(pk=1).branch
number = (Exercise.objects.filter(branch=branch).aggregate(n=Max('number'))['n'] or 0) + 1
ex = Exercise.objects.create(branch=branch, number=number, difficulty='easy', original_locale='pl', submitted_by=michal)
# A second, ordinary exercise for staff's edit in step 5 — scratch, so the real PATCH never
# touches a corpus row.
plain = Exercise.objects.create(branch=branch, number=number + 1, difficulty='easy', original_locale='pl', submitted_by=michal)
ExerciseTranslation.objects.create(exercise=plain, locale='pl', title='${MARK} plain ${STAMP}',
    statement='Oblicz \\((1+i)(1-i)\\).', answer='\\(2\\)', status='published')
ExerciseTranslation.objects.create(exercise=ex, locale='pl', title='${MARK} ${STAMP}',
    statement='Przedstaw w postaci \\\\(a+bi\\\\) następujące liczby zespolone:',
    answer='Wszystkie trzy wyniki leżą na okręgu \\\\(|z|=\\\\sqrt{2}\\\\) lub \\\\(|z|=1\\\\).', status='published')
def part(order, label, statement, answer):
    p = ExercisePart.objects.create(exercise=ex, order=order, label=label)
    ExercisePartTranslation.objects.create(part=p, locale='pl', statement=statement, answer=answer, status='published')
    return p
a = part(1, 'a', '\\\\((1+i)^2\\\\)', '\\\\(2i\\\\)')
b = part(2, 'b', '\\\\((1-i)^3\\\\)', '\\\\(-2-2i\\\\)')
c = part(3, 'c', '\\\\(\\\\frac{1}{i}\\\\)', '\\\\(-i\\\\)')
SolutionEntry.objects.create(exercise=ex, kind='hint', locale='pl', body='Pomnóż przez sprzężenie.', author=michal, status='published')
SolutionEntry.objects.create(exercise=ex, part=a, kind='hint', locale='pl', body='Rozwiń kwadrat.', author=michal, status='published')
SolutionEntry.objects.create(exercise=ex, part=c, kind='solution', locale='pl', body='\\\\(\\\\frac{1}{i}=\\\\frac{-i}{1}=-i\\\\).', author=michal, status='published')
SolutionEntry.objects.create(exercise=ex, part=c, kind='hint', locale='pl', body='Czekająca wskazówka do c.', author=ola, status='pending')
tok = lambda u: Token.objects.get_or_create(user=u)[0].key
print(json.dumps({'id': ex.pk, 'a': a.pk, 'b': b.pk, 'c': c.pk, 'plain': plain.pk,
    'michal': tok(michal), 'ola': tok(ola), 'kasia': tok(kasia)}))
`)
);
const EX = String(seeded.id);
const P = { a: String(seeded.a), b: String(seeded.b), c: String(seeded.c) };
console.log(`seeded exercise ${EX} (parts a=${P.a} b=${P.b} c=${P.c})`);

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

const browser = await chromium.launch(
	process.env.CHROME ? { executablePath: process.env.CHROME } : {}
);
const errors = [];
let katexFonts = 0;
async function contextFor(token, { width = 1280, height = 900 } = {}) {
	const ctx = await englishContext(browser, BASE, { viewport: { width, height } });
	if (token) await ctx.addInitScript((t) => localStorage.setItem('edmat-auth-token', t), token);
	const page = await ctx.newPage();
	page.on('pageerror', (e) => errors.push(String(e)));
	page.on('console', (msg) => {
		if (msg.type() === 'error' && !/Failed to load resource/.test(msg.text()))
			errors.push(`console: ${msg.text()}`);
	});
	page.on('response', (r) => {
		if (r.status() === 403 && /katex.*fonts/.test(r.url())) katexFonts++;
		else if (r.status() >= 500) errors.push(`${r.status()} ${r.url()}`);
	});
	return { ctx, page };
}
const shot = (page, name) => page.screenshot({ path: `${SHOTS}${name}.png`, fullPage: true });
async function openExercise(page, id = EX) {
	await page.goto(`${BASE}/exercises/${id}`);
	await page.waitForSelector('h1');
	await page.waitForSelector('.katex');
}
const block = (page, key) => page.locator(`[data-part="${P[key]}"]`);
// Fill a RichEditor whichever mode the account prefers: the source box, or Tiptap's document.
async function fillEditor(editor, text) {
	const area = editor.locator('textarea');
	if (await area.isVisible().catch(() => false)) {
		await area.fill(text);
		return;
	}
	const doc = editor.locator('.ProseMirror');
	await doc.waitFor();
	await doc.click();
	await doc.page().keyboard.type(text);
}
const stripTags = (s) => String(s ?? '').replace(/<[^>]+>/g, '');

try {
	// ---- 1. a stranger reads it ------------------------------------------------------------
	{
		const { ctx, page } = await contextFor(null);
		await openExercise(page);
		const blocks = page.locator('[data-part]');
		check(
			'stranger: three part blocks',
			(await blocks.count()) === 3,
			String(await blocks.count())
		);
		const ids = await blocks.evaluateAll((els) => els.map((e) => e.getAttribute('data-part')));
		check('stranger: in order a, b, c', ids.join() === [P.a, P.b, P.c].join(), ids.join());
		const heads = await page.locator('[data-part] .part__heading').allInnerTexts();
		check(
			'stranger: each block carries its label',
			heads.join('|') === 'Part a|Part b|Part c',
			heads.join('|')
		);
		check(
			'stranger: the sub-statements are typeset',
			(await block(page, 'b').locator('.katex').count()) > 0
		);
		const wholeStages = page.locator('article.exercise > section.content-section--stage');
		const wholeHeads = await wholeStages.locator('h2').allInnerTexts();
		check(
			'stranger: the whole-exercise hints are labelled "for the whole exercise"',
			/hints/i.test(wholeHeads[0] ?? '') && /for the whole exercise/i.test(wholeHeads[0] ?? ''),
			wholeHeads.join(' / ')
		);
		check(
			'stranger: the whole-exercise answer is labelled too',
			wholeHeads.some((h) => /answer/i.test(h) && /for the whole exercise/i.test(h)),
			wholeHeads.join(' / ')
		);
		const y = async (loc) => (await loc.boundingBox())?.y ?? NaN;
		const firstPartY = await y(block(page, 'a'));
		const lastPartY = await y(block(page, 'c'));
		check(
			'stranger: whole hints before the parts, whole answer after them',
			(await y(wholeStages.nth(0))) < firstPartY && (await y(wholeStages.nth(1))) > lastPartY
		);
		check(
			'stranger: no part stage says "for the whole exercise"',
			(await page.locator('[data-part] .scope').count()) === 0
		);

		// part (b)'s answer — and nobody else's
		await block(page, 'b').locator('[data-part-answer] .reveal-toggle').click();
		await block(page, 'b').locator('[data-part-answer] .katex').first().waitFor();
		const bAnswer = await block(page, 'b').locator('[data-part-answer]').innerText();
		check("stranger: (b)'s answer reveals", /2i/.test(bAnswer), bAnswer);
		check(
			"stranger: (a)'s and (c)'s answers stay hidden",
			(await block(page, 'a').locator('[data-part-answer] .katex').count()) === 0 &&
				(await block(page, 'c').locator('[data-part-answer] .katex').count()) === 0
		);
		check(
			'stranger: the whole answer stays hidden',
			(await wholeStages.nth(1).locator('.katex').count()) === 0
		);

		// each part's hints are its own
		await block(page, 'a').locator('.reveal-toggle', { hasText: 'Show hints' }).click();
		await wholeStages.nth(0).locator('.reveal-toggle', { hasText: 'Show hints' }).click();
		const aCards = await block(page, 'a').locator('article.entry').allInnerTexts();
		check(
			"stranger: (a)'s hints list (a)'s hint only",
			aCards.length === 1 && aCards[0].includes('Rozwiń kwadrat'),
			JSON.stringify(aCards)
		);
		const wholeCards = await wholeStages.nth(0).locator('article.entry').allInnerTexts();
		check(
			'stranger: the whole-exercise hints list the whole one only',
			wholeCards.length === 1 && wholeCards[0].includes('Pomnóż przez sprzężenie'),
			JSON.stringify(wholeCards)
		);
		check(
			'stranger: (b) has no hint stage to show (none written, signed out)',
			(await block(page, 'b')
				.locator('section.content-section--stage h2', { hasText: 'Hints' })
				.count()) === 0
		);
		check(
			"stranger: (c)'s solution is in (c)'s block",
			(await block(page, 'c')
				.locator('.reveal-toggle', { hasText: 'Show solutions (1)' })
				.count()) === 1
		);
		check(
			'stranger: no "Add a hint" for somebody signed out',
			(await page.getByRole('button', { name: 'Add a hint' }).count()) === 0
		);
		check(
			'stranger: no card says "for part" on its own exercise page',
			(await page.locator('[data-entry-part]').count()) === 0
		);
		await shot(page, '1-stranger-reads');
		await ctx.close();
	}

	// ---- 2. michal adds a hint FOR (b) through the real composer -----------------------------
	{
		const { ctx, page } = await contextFor(seeded.michal);
		await openExercise(page);
		// The whole-exercise composer starts at "the whole exercise".
		const wholeHints = page.locator('article.exercise > section.content-section--stage').nth(0);
		await wholeHints.getByRole('button', { name: 'Add a hint' }).click();
		check(
			'michal: the whole-exercise composer starts at "the whole exercise"',
			(await wholeHints.locator('[data-entry-for]').inputValue()) === ''
		);
		await wholeHints.getByRole('button', { name: 'Add a hint' }).click(); // close it again

		const bBlock = block(page, 'b');
		await bBlock.getByRole('button', { name: 'Add a hint' }).click();
		const forSelect = bBlock.locator('[data-entry-for]');
		await forSelect.waitFor();
		check("michal: (b)'s composer is pre-set to (b)", (await forSelect.inputValue()) === P.b);
		const options = await forSelect.locator('option').allInnerTexts();
		check(
			'michal: "For:" offers the whole exercise and each part',
			options.join('|') === 'the whole exercise|part a|part b|part c',
			options.join('|')
		);
		// Written in Polish, like the exercise: the composer defaults to the INTERFACE language
		// (frontend/CLAUDE.md), and an English entry would sit behind "1 more in other languages".
		await bBlock.locator('.composer select:has(option[value="pl"])').selectOption('pl');
		const body = `Najpierw policz (1-i)^2 = -2i. [${STAMP}]`;
		await fillEditor(bBlock.locator('.composer .rich-editor'), body);
		await shot(page, '2-michal-composer-for-b');
		const posted = page.waitForRequest(
			(r) => r.method() === 'POST' && r.url().includes(`/exercises/${EX}/entries/`)
		);
		const answered = page.waitForResponse(
			(r) => r.request().method() === 'POST' && r.url().includes(`/exercises/${EX}/entries/`)
		);
		await bBlock.locator('.composer button.primary').click();
		const sent = (await posted).postDataJSON();
		const res = await answered;
		check(
			'michal: the entry POST says part = (b)',
			sent.part === Number(P.b),
			JSON.stringify(sent)
		);
		check('michal: the entry POST is accepted (201)', res.status() === 201, String(res.status()));
		await bBlock.locator('article.entry', { hasText: String(STAMP) }).waitFor({ timeout: 10000 });
		check(
			'michal: the new hint shows under (b)',
			(await bBlock.locator('article.entry', { hasText: String(STAMP) }).count()) === 1
		);
		check(
			'michal: and nowhere else',
			(await page.locator('article.entry', { hasText: String(STAMP) }).count()) === 1
		);
		const detail = (await api(seeded.michal, 'GET', `/exercises/${EX}/`)).data;
		const created = detail.entries.find((e) => e.body.includes(String(STAMP)));
		check(
			'the API agrees: the hint is for (b)',
			created?.part === Number(P.b),
			JSON.stringify(created)
		);
		check(
			"michal (a reviewer) sees the pending hint for (c) in (c)'s block",
			(await block(page, 'c').locator('.reveal-toggle', { hasText: 'Show hints' }).count()) === 1
		);
		await shot(page, '3-michal-hint-under-b');
		await ctx.close();
	}

	// ---- 3. ola suggests an edit to part (b)'s statement — the real POST -----------------------
	{
		const { ctx, page } = await contextFor(seeded.ola);
		let suggestion = null;
		let suggestionStatus = 0;
		page.on('response', (r) => {
			if (
				r.request().method() === 'POST' &&
				new URL(r.url()).pathname.endsWith('/api/edit-suggestions/')
			) {
				suggestion = r.request().postDataJSON();
				suggestionStatus = r.status();
			}
		});
		await openExercise(page);
		await page.getByRole('button', { name: 'Suggest an edit' }).click();
		const form = page.locator('form.edit-suggestion-form');
		const select = form.locator('[data-suggest-field]');
		const choices = (await select.locator('option').allInnerTexts()).slice(3);
		check(
			'ola: "Suggest an edit" offers each part\'s statement and answer, named in full',
			choices.join('|') ===
				'Part a — statement|Part a — answer|Part b — statement|Part b — answer|Part c — statement|Part c — answer',
			choices.join('|')
		);
		await select.selectOption(`part:${P.b}:statement`);
		const prefilled = await form.locator('textarea').first().inputValue();
		check(
			"ola: the box is prefilled with (b)'s statement",
			prefilled.includes('(1-i)^3'),
			prefilled
		);
		await form.locator('textarea').first().fill('\\((1-i)^{3}\\) — z nawiasem klamrowym');
		await form.locator('textarea').nth(1).fill('Czytelniej.');
		await shot(page, '4-ola-suggest-part-b');
		await form.getByRole('button', { name: /submit|send|suggest/i }).click();
		await page.locator('.notice', { hasText: /suggestion/i }).waitFor({ timeout: 10000 });
		check(
			'ola: the suggestion POST carries part = (b), field = statement',
			suggestion?.part === Number(P.b) &&
				suggestion?.field === 'statement' &&
				suggestion?.exercise === Number(EX),
			JSON.stringify(suggestion)
		);
		check(
			'ola: and the backend accepted it (201)',
			suggestionStatus === 201,
			String(suggestionStatus)
		);
		const mine = (await api(seeded.ola, 'GET', `/edit-suggestions/?exercise=${EX}`)).data;
		const row = Array.isArray(mine) ? mine.find((x) => x.part === Number(P.b)) : null;
		check(
			'the API agrees: a pending suggestion for part (b), statement, by ola',
			row?.status === 'pending' && row?.field === 'statement' && row?.part_label === 'b',
			JSON.stringify(mine).slice(0, 300)
		);
		await ctx.close();
	}

	// ---- 4. michal's Parts editor — the real PATCH ----------------------------------------------
	const current = (await api(seeded.michal, 'GET', `/exercises/${EX}/?lang=pl`)).data;
	const patches = [];
	const patchStatuses = [];
	// Registered BEFORE the click that sends it (a `page.on('response')` listener missed the PATCH
	// whose success navigates the page away a moment later).
	const isPatch = (r) =>
		r.request().method() === 'PATCH' &&
		new RegExp(`/api/exercises/${EX}/$`).test(new URL(r.url()).pathname);
	async function recordPatch(pending) {
		const res = await pending;
		patches.push(res.request().postDataJSON());
		patchStatuses.push(res.status());
	}
	{
		const { ctx, page } = await contextFor(seeded.michal);
		await page.goto(`${BASE}/exercises/${EX}/edit`);
		const editor = page.locator('[data-parts-editor]');
		await editor.waitFor();
		const rows = editor.locator('[data-part-row]');
		const labels = async () =>
			rows.evaluateAll((els) => els.map((e) => e.querySelector('input').value));
		check('edit: three part rows', (await rows.count()) === 3, String(await rows.count()));
		check('edit: labelled a, b, c', (await labels()).join() === 'a,b,c', (await labels()).join());

		await editor.locator('[data-part-add]').click();
		check('edit: "Add a part" adds a fourth row', (await rows.count()) === 4);
		const d = rows.nth(3);
		await d.locator('input[type="text"]').fill('d');
		await fillEditor(d.locator('.rich-editor').nth(0), `Compute (2+i)(2-i). ${STAMP}`);
		await fillEditor(d.locator('.rich-editor').nth(1), 'Five.');
		await d.locator('[data-part-up]').click(); // a, b, d, c
		await rows.nth(0).locator('[data-part-down]').click(); // b, a, d, c
		check(
			'edit: reordered to b, a, d, c',
			(await labels()).join() === 'b,a,d,c',
			(await labels()).join()
		);
		check(
			'edit: the first row cannot move up, the last cannot move down',
			(await rows.nth(0).locator('[data-part-up]').isDisabled()) &&
				(await rows.nth(3).locator('[data-part-down]').isDisabled())
		);

		// remove (c): it stays as a line with Undo; saving asks first
		await rows.nth(3).locator('[data-part-remove]').click();
		check('edit: a removed part leaves the live rows', (await rows.count()) === 3);
		check(
			'edit: and says it will be deleted, with Undo',
			(await editor.locator(`[data-part-removed="${P.c}"]`).innerText()).includes(
				'will be deleted when you save'
			)
		);
		await page.locator('[data-exercise-edit] form button[type="submit"]').click();
		const confirm = page.locator('[data-parts-confirm]');
		await confirm.waitFor();
		const confirmText = await confirm.innerText();
		check(
			'edit: the in-page confirm names (c) and what goes with it',
			confirmText.includes('Part c — hints: 1, solutions: 1'),
			confirmText
		);
		check('edit: nothing was sent before the answer', patches.length === 0);
		await shot(page, '5-edit-confirm-drop');
		const patched = page.waitForResponse(isPatch);
		await confirm.locator('[data-parts-confirm-yes]').click();
		await recordPatch(patched);
		await page.waitForSelector('[data-saved]', { timeout: 15000 });
		const sent = patches[0]?.parts;
		check(
			'edit: the PATCH sends parts in the new order, without (c)',
			Array.isArray(sent) && sent.map((p) => p.label).join() === 'b,a,d',
			JSON.stringify(sent)
		);
		check(
			'edit: known parts carry their numeric id, the new one none',
			sent?.[0]?.id === Number(P.b) &&
				sent?.[1]?.id === Number(P.a) &&
				!('id' in (sent?.[2] ?? {})),
			JSON.stringify(sent)
		);
		check(
			'edit: each item is exactly {id?, label, statement, answer}',
			sent?.every(
				(p) =>
					Object.keys(p).sort().join() ===
					(p.id === undefined ? 'answer,label,statement' : 'answer,id,label,statement')
			),
			JSON.stringify(sent?.map((p) => Object.keys(p)))
		);
		check(
			"edit: the new part's text is sent",
			stripTags(sent?.[2]?.statement).includes(`Compute (2+i)(2-i). ${STAMP}`) &&
				stripTags(sent?.[2]?.answer).includes('Five.'),
			JSON.stringify(sent?.[2])
		);
		check(
			"edit: a known part's text goes back as it was",
			sent?.[0]?.statement === current.parts.find((p) => p.label === 'b').statement,
			JSON.stringify(sent?.[0])
		);
		check(
			'edit: the rest of the edit is unchanged',
			patches[0].title === current.title && patches[0].difficulty === 'easy',
			JSON.stringify(patches[0]).slice(0, 200)
		);
		check(
			'edit: the backend accepted the PATCH (200)',
			patchStatuses[0] === 200,
			String(patchStatuses[0])
		);
		await ctx.close();
	}
	// What the backend now holds: b, a, d in that order; (c) gone with its hint and solution.
	const after = (await api(seeded.michal, 'GET', `/exercises/${EX}/?lang=pl`)).data;
	check(
		'the API agrees: parts are b, a, d with orders 1, 2, 3',
		after.parts.map((p) => `${p.label}${p.order}`).join() === 'b1,a2,d3',
		JSON.stringify(after.parts.map((p) => [p.label, p.order]))
	);
	check(
		'the API agrees: (b) and (a) kept their ids, (d) is new',
		after.parts[0].id === Number(P.b) &&
			after.parts[1].id === Number(P.a) &&
			![P.a, P.b, P.c].map(Number).includes(after.parts[2].id),
		JSON.stringify(after.parts.map((p) => p.id))
	);
	check(
		"the API agrees: (d)'s statement and answer landed",
		stripTags(after.parts[2].statement).includes(`Compute (2+i)(2-i). ${STAMP}`) &&
			stripTags(after.parts[2].answer).includes('Five.'),
		JSON.stringify(after.parts[2])
	);
	check(
		"the API agrees: (c)'s hint and solution went with it, (a)'s and (b)'s entries stayed",
		!after.entries.some((e) => e.part === Number(P.c)) &&
			after.entries.some((e) => e.part === Number(P.a)) &&
			after.entries.some((e) => e.part === Number(P.b)),
		JSON.stringify(after.entries.map((e) => [e.kind, e.part]))
	);
	check(
		'the API agrees: a set with an unsolved part is not verified',
		after.verified === false,
		String(after.verified)
	);
	P.d = String(after.parts[2].id);
	{
		// Undo: nothing dropped, no question asked; and a refusal is said in words — the real
		// backend's `part_label_duplicate`, provoked by giving (d) the label "b".
		const { ctx, page } = await contextFor(seeded.michal);
		await page.goto(`${BASE}/exercises/${EX}/edit`);
		const editor = page.locator('[data-parts-editor]');
		await editor.waitFor();
		await editor.locator('[data-part-row]').nth(2).locator('[data-part-remove]').click();
		await editor.locator(`[data-part-removed="${P.d}"] button`).click();
		check('edit: Undo brings (d) back', (await editor.locator('[data-part-row]').count()) === 3);
		await editor.locator('[data-part-row]').nth(2).locator('input[type="text"]').fill('b');
		const refused = page.waitForResponse(isPatch);
		await page.locator('[data-exercise-edit] form button[type="submit"]').click();
		await recordPatch(refused);
		await page.locator('[data-exercise-edit] .error').waitFor({ timeout: 10000 });
		check(
			'edit: no confirm when nothing is dropped',
			(await page.locator('[data-parts-confirm]').count()) === 0
		);
		check(
			'edit: after Undo all three are sent, in order, with their ids',
			patches[1]?.parts?.map((p) => p.id).join() === [P.b, P.a, P.d].map(Number).join(),
			JSON.stringify(patches[1]?.parts)
		);
		check('edit: the backend refused it (400)', patchStatuses[1] === 400, String(patchStatuses[1]));
		const refusal = await page.locator('[data-exercise-edit] .error').innerText();
		check(
			'edit: part_label_duplicate is said as a sentence',
			refusal.includes('Two parts have the same label'),
			refusal
		);
		await page.locator('[data-parts-editor]').scrollIntoViewIfNeeded();
		await shot(page, '6-edit-refusal');
		await ctx.close();
	}

	// ---- 5. staff: an ordinary exercise sends no parts; the queue names the part -------------
	{
		const { ctx, page } = await contextFor(seeded.kasia);
		let plainPatch = null;
		let plainStatus = 0;
		await page.goto(`${BASE}/exercises/${seeded.plain}/edit`);
		await page.locator('[data-parts-editor]').waitFor();
		check(
			'staff: an ordinary exercise says it has no parts',
			(await page.locator('[data-parts-editor]').innerText()).includes('No parts')
		);
		const plainPatched = page.waitForResponse(
			(r) =>
				r.request().method() === 'PATCH' &&
				new RegExp(`/api/exercises/${seeded.plain}/$`).test(new URL(r.url()).pathname)
		);
		await page.locator('[data-exercise-edit] form button[type="submit"]').click();
		{
			const res = await plainPatched;
			plainPatch = res.request().postDataJSON();
			plainStatus = res.status();
		}
		await page.waitForSelector('[data-saved]', { timeout: 15000 });
		check(
			'staff: and its PATCH carries no "parts" key at all',
			plainPatch !== null && !('parts' in plainPatch),
			JSON.stringify(plainPatch).slice(0, 200)
		);
		check('staff: the backend accepted it (200)', plainStatus === 200, String(plainStatus));
		const plainAfter = (await api(seeded.kasia, 'GET', `/exercises/${seeded.plain}/?lang=pl`)).data;
		check(
			'staff: the ordinary exercise still has no parts',
			Array.isArray(plainAfter.parts) && plainAfter.parts.length === 0,
			JSON.stringify(plainAfter.parts)
		);
		// The seeded pending hint for (c) went with (c) in step 4 — the real cascade, not a
		// stand-in — so ola files a fresh one for (a) through the API, and it is this one the
		// queue has to name.
		const pendingBody = `Czekająca wskazówka do a. [${STAMP}]`;
		const filed = await api(seeded.ola, 'POST', `/exercises/${EX}/entries/`, {
			kind: 'hint',
			locale: 'pl',
			body: pendingBody,
			part: Number(P.a)
		});
		check(
			"staff: ola's new hint for (a) waits for review",
			filed.status === 201 && filed.data?.status === 'pending' && filed.data?.part === Number(P.a),
			`${filed.status} ${JSON.stringify(filed.data).slice(0, 200)}`
		);
		await page.goto(`${BASE}/moderation`);
		await page.locator('#mod-tab-entries').waitFor();
		await page.locator('#mod-tab-entries').click();
		const row = page.locator('li.queue-item', { hasText: pendingBody });
		await row.waitFor({ timeout: 15000 });
		check(
			'staff: the queue says the pending hint is for part a',
			(await row.locator('[data-part-label]').innerText()).trim() === 'for part a',
			await row.innerText()
		);
		await row.scrollIntoViewIfNeeded();
		await page.screenshot({ path: `${SHOTS}7-moderation-part-label.png` });
		await ctx.close();
	}
} catch (e) {
	check(
		'the script ran to its end',
		false,
		String(e?.message ?? e)
			.split('\n')
			.slice(0, 6)
			.join(' | ')
	);
} finally {
	shell(`
from exercises.models import Exercise
Exercise.objects.filter(translations__title__startswith='${MARK}').delete()
`);
	const gone = await api(seeded.kasia, 'GET', `/exercises/${EX}/`);
	check('cleanup: the seeded exercise is gone', gone.status === 404, String(gone.status));
	if (katexFonts) console.log(`  (ignored ${katexFonts} KaTeX font 403s — trap 26)`);
	check('zero page/console errors', errors.length === 0, errors.slice(0, 5).join('\n'));
	await browser.close();
	console.log(`\n${pass} passed, ${fail} failed`);
	process.exit(fail ? 1 : 0);
}
