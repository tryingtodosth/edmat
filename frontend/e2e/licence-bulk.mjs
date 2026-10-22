// Settings → Licences (`/settings/licences`, backend `licensing/bulk.py`, 2026-10-22): the list of
// everything an account posted with each item's licence, select-all per kind, the target picker's
// "can move to it: n of m", the irrevocability confirm step, and the per-item result with the
// rules' own reason for what kept its licence. Light, dark and a 390px phone, screenshots looked at.
//
// It WRITES (licences change, LicenceChange rows are added), so run it against a COPY of the dev
// database. It registers one throwaway account per run and borrows three unattributed published
// exercises and one material by attributing them to it through E2E_MANAGE:
//
//   E2E_BASE=http://localhost:5251 E2E_API=http://127.0.0.1:8151 \
//   E2E_MANAGE='cd ../backend && ../../../../.venv/bin/python3 manage.py' \
//   node e2e/licence-bulk.mjs
import { execSync } from 'node:child_process';
import { mkdirSync } from 'node:fs';

let chromium;
try {
	({ chromium } = await import('playwright'));
} catch {
	({ chromium } = await import('playwright-core'));
}
import { englishContext } from './english.mjs';

const BASE = process.env.E2E_BASE ?? 'http://localhost:5173';
const API = process.env.E2E_API ?? 'http://localhost:8000';
const MANAGE = process.env.E2E_MANAGE ?? '';
if (!MANAGE) throw new Error('E2E_MANAGE is required (manage.py on a COPY of the database)');
const manage = (code) =>
	execSync(`${MANAGE} shell -c ${JSON.stringify(code)}`, { encoding: 'utf-8', shell: '/bin/bash' });
const SHOTS = 'e2e/screenshots';
mkdirSync(SHOTS, { recursive: true });

let pass = 0,
	fail = 0;
const errors = [];
const check = (l, ok, x = '') => {
	if (ok) pass++;
	else fail++;
	console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${l} ${ok ? '' : x}`);
};
const json = (t) => ({
	'Content-Type': 'application/json',
	...(t ? { Authorization: `Token ${t}` } : {})
});
const api = async (method, path, body, token) => {
	const r = await fetch(`${API}${path}`, {
		method,
		headers: json(token),
		body: body ? JSON.stringify(body) : undefined
	});
	return { status: r.status, body: await r.json().catch(() => null) };
};

// ---- setup -------------------------------------------------------------------------------------
const stamp = Date.now() % 1000000;
const reg = await api('POST', '/api/auth/register/', {
	username: `e2e-lic-${stamp}`,
	email: `e2e-lic-${stamp}@example.org`,
	password: 'licence-e2e-Passw0rd!',
	display_name: `Licence Bulk ${stamp}`,
	preferred_locale: 'en',
	birth_year: 1990,
	accept_terms: true
});
if (reg.status !== 201) throw new Error(`register: ${reg.status} ${JSON.stringify(reg.body)}`);
const token = reg.body.token;
const uid = reg.body.profile.id;
const out = manage(
	[
		'from exercises.models import Exercise as E, ExerciseTranslation as T',
		'from materials.models import Material as M',
		'from coauthoring.models import MaterialProject as P, MaterialVersion as V, ProjectMember as PM',
		'from django.contrib.auth import get_user_model as U',
		`ids=list(E.objects.filter(published=True, submitted_by__isnull=True).order_by('-pk').values_list('pk', flat=True)[:3])`,
		`E.objects.filter(pk__in=ids[:2]).update(submitted_by_id=${uid}, licence='edmat-only')`,
		`E.objects.filter(pk=ids[2]).update(submitted_by_id=${uid}, licence='cc-by-nc-4.0')`,
		`T.objects.filter(exercise_id__in=ids[:2]).update(licence='edmat-only')`,
		'from testing.factories import make_material',
		'from taxonomy.models import Branch',
		`mat=make_material(Branch.objects.first(), 'e2e-licence-bulk-${stamp}', title='E2E co-authored script ${stamp}')`,
		`M.objects.filter(pk=mat.pk).update(submitted_by_id=${uid}, licence='edmat-only')`,
		`co=U().objects.exclude(pk=${uid}).filter(is_staff=False).first()`,
		`pr=P.objects.create(material=mat, branch=mat.branch, created_by_id=${uid})`,
		`PM.objects.create(project=pr, user=co, role='coauthor')`,
		`V.objects.create(project=pr, number=1, status='published', title='v1', created_by=co)`,
		`print('IDS', *ids, mat.pk)`
	].join('; ')
);
const [ex1, ex2, exNc, matId] = out
	.match(/IDS ([\d ]+)/)[1]
	.trim()
	.split(' ');
check('setup: three exercises and a co-authored material are the account’s', !!matId, out);

const mine = await api('GET', '/api/licences/mine/?lang=en', null, token);
check(
	'API: /licences/mine/ lists the three exercises',
	mine.body?.kinds?.exercise?.items?.length === 3
);

const browser = await chromium.launch(
	process.env.CHROME ? { executablePath: process.env.CHROME } : {}
);
const page = async ({ width = 1280, height = 1000, colorScheme = 'light' } = {}) => {
	const ctx = await englishContext(browser, BASE, { viewport: { width, height }, colorScheme });
	await ctx.addInitScript(
		([t, theme]) => {
			localStorage.setItem('edmat-auth-token', t);
			localStorage.setItem('edmat-theme', theme);
		},
		[token, colorScheme]
	);
	const p = await ctx.newPage();
	p.on('console', (m) => {
		if (m.type() === 'error') errors.push(`[${p.url()}] ${m.text()}`);
	});
	p.on('pageerror', (e) => errors.push(e.message));
	return p;
};

// ---- 1. from Settings to the list --------------------------------------------------------------
let p = await page();
await p.goto(`${BASE}/settings`, { waitUntil: 'load' });
await p.locator('[data-testid="licences-link"]').waitFor({ timeout: 60000 });
await p.locator('[data-testid="licences-link"]').click();
await p.waitForURL((u) => u.pathname === '/settings/licences', { timeout: 15000 });
await p.locator('[data-testid="licences-group-exercise"]').waitFor({ timeout: 30000 });
check('Settings links to /settings/licences', true);
const exGroup = p.locator('[data-testid="licences-group-exercise"]');
check(
	'the exercise group lists 3',
	(await exGroup.locator('[data-testid="licences-item"]').count()) === 3
);
const matGroup = p.locator('[data-testid="licences-group-material"]');
check(
	'the material group lists 1',
	(await matGroup.locator('[data-testid="licences-item"]').count()) === 1
);
check(
	'the co-authored material cannot be picked, and says why',
	(await matGroup.locator('input[type="checkbox"]').last().isDisabled()) &&
		(await matGroup.innerText()).includes('Other people’s work is part of this')
);
await p.screenshot({ path: `${SHOTS}/licence-bulk-list-light.png`, fullPage: true });

// ---- 2. filter, select all, pick a target --------------------------------------------------------
await p.locator('[data-testid="licences-filter-licence"]').selectOption('cc-by-nc-4.0');
check(
	'the licence filter narrows to the BY-NC one',
	(await exGroup.locator('[data-testid="licences-item"]').count()) === 1
);
await p.locator('[data-testid="licences-filter-licence"]').selectOption('all');
await p.locator('[data-testid="licences-select-all-exercise"]').check();
check(
	'Select all ticks the three exercises',
	(await exGroup.locator('input[type="checkbox"]:checked').count()) === 4
);
await p.locator('input[type="radio"][value="cc-by-sa-4.0"]').check();
const fit = await p.locator('[data-testid="licences-fit-cc-by-sa-4.0"]').innerText();
check('BY-SA fits 2 of the 3 (BY-NC cannot become BY-SA)', fit.includes('2 of 3'), fit);
const fitBy = await p.locator('[data-testid="licences-fit-cc-by-4.0"]').innerText();
check('BY fits all 3', fitBy.includes('3 of 3'), fitBy);

// ---- 3. confirm: the irrevocability step ---------------------------------------------------------
await p.locator('[data-testid="licences-next"]').click();
await p.locator('[data-testid="licences-confirm"]').waitFor();
const confirm = await p.locator('[data-testid="licences-confirm"]').innerText();
check('the confirm step says it cannot be undone', confirm.includes('This cannot be undone'));
check(
	'the confirm step forecasts 2 moving, 1 keeping',
	confirm.includes(': 2.') && confirm.includes(': 1.'),
	confirm
);
await p.screenshot({ path: `${SHOTS}/licence-bulk-confirm-light.png`, fullPage: true });

// ---- 4. apply: per-item results with reasons -----------------------------------------------------
await p.locator('[data-testid="licences-apply"]').click();
await p.locator('[data-testid="licences-results"]').waitFor({ timeout: 30000 });
const results = await p.locator('[data-testid="licences-results"]').innerText();
check('2 changed', results.includes('new licence: 2'), results);
check(
	'the BY-NC one kept its licence, with the narrowing reason',
	results.includes('only be made more open'),
	results
);
await p.screenshot({ path: `${SHOTS}/licence-bulk-results-light.png`, fullPage: true });
const after = await api('GET', '/api/licences/mine/?lang=en', null, token);
const lic = Object.fromEntries(after.body.kinds.exercise.items.map((i) => [i.id, i.licence]));
check(
	'the server agrees: two BY-SA, the BY-NC untouched',
	lic[ex1] === 'cc-by-sa-4.0' && lic[ex2] === 'cc-by-sa-4.0' && lic[exNc] === 'cc-by-nc-4.0',
	JSON.stringify(lic)
);
const detail = await api('GET', `/api/licences/exercise/${ex1}/`, null, token);
check(
	'the item page’s own reading shows the change in its history',
	detail.body?.history?.[0]?.to === 'cc-by-sa-4.0'
);
await p.close();

// ---- 5. dark, Polish, and a phone ----------------------------------------------------------------
p = await page({ colorScheme: 'dark' });
await p.goto(`${BASE}/settings/licences`, { waitUntil: 'load' });
await p.locator('[data-testid="licences-group-exercise"]').waitFor({ timeout: 30000 });
await p.locator('[data-testid="licences-select-all-exercise"]').check();
await p.locator('input[type="radio"][value="cc-by-4.0"]').check();
await p.screenshot({ path: `${SHOTS}/licence-bulk-list-dark.png`, fullPage: true });
await p.locator('[data-testid="licences-next"]').click();
await p.locator('[data-testid="licences-confirm"]').waitFor();
await p.screenshot({ path: `${SHOTS}/licence-bulk-confirm-dark.png`, fullPage: true });
check(
	'dark: the page reads data-theme=dark',
	(await p.evaluate(() => document.documentElement.dataset.theme)) === 'dark'
);
await p.close();

p = await page({ width: 390, height: 844 });
await p.goto(`${BASE}/settings/licences`, { waitUntil: 'load' });
await p.locator('[data-testid="licences-group-exercise"]').waitFor({ timeout: 30000 });
const overflow = await p.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
check('phone: no horizontal scroll', overflow <= 0, `overflow ${overflow}px`);
await p.screenshot({ path: `${SHOTS}/licence-bulk-phone.png`, fullPage: true });
await p.close();

// Polish is the base locale: a context WITHOUT the English cookie.
{
	const ctx = await browser.newContext({ viewport: { width: 1280, height: 1000 } });
	await ctx.addInitScript((t) => localStorage.setItem('edmat-auth-token', t), token);
	const pl = await ctx.newPage();
	await pl.goto(`${BASE}/settings/licences`, { waitUntil: 'load' });
	await pl.locator('[data-testid="licences-group-exercise"]').waitFor({ timeout: 30000 });
	check(
		'Polish: the heading is Polish',
		(await pl.locator('h1').innerText()).includes('Licencje twoich treści')
	);
	await pl.screenshot({ path: `${SHOTS}/licence-bulk-pl.png`, fullPage: true });
	await ctx.close();
}

// ---- 6. anonymous ----------------------------------------------------------------------------------
check(
	'API: anonymous /licences/mine/ is 401',
	(await api('GET', '/api/licences/mine/')).status === 401
);

await browser.close();
const real = errors.filter(
	(e) => !/Failed to load resource: the server responded with a status of 401/.test(e)
);
check('no console or page errors', real.length === 0, real.join('\n'));
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
