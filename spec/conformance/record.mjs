// Records the golden corpus from a RUNNING reference implementation (the Django backend, always —
// PORTS-BRIEF.md §3: goldens are generated from the reference, never hand-written, and never
// edited on a port branch).
//
//   node spec/conformance/record.mjs http://127.0.0.1:8012
//
// Each case becomes spec/golden/<name>.json: { name, method, path, status, body }. The case list
// lives here, in one place, because "which requests define the contract" is itself part of the
// contract. Milestone M0 covers the anonymous taxonomy read surface; later milestones append.
const base = process.argv[2];
if (!base) {
	console.error('usage: node spec/conformance/record.mjs <base-url-of-reference>');
	process.exit(2);
}

const CASES = [
	// M0 — disciplines. The three lang variants pin the whole locale-resolution contract
	// (config/i18n_utils.py): explicit locale, missing (defaults to 'pl', the original corpus
	// locale — NOT 'en', a real bug once), and unknown (falls back to 'pl').
	{ name: 'disciplines-list', path: '/api/disciplines/' },
	{ name: 'disciplines-list-en', path: '/api/disciplines/?lang=en' },
	{ name: 'disciplines-list-unknown-lang', path: '/api/disciplines/?lang=zz' },
	{ name: 'discipline-detail', path: '/api/disciplines/matematyka/' },
	{ name: 'discipline-detail-missing', path: '/api/disciplines/no-such-discipline/' },
	{ name: 'discipline-branches', path: '/api/disciplines/matematyka/branches/' }
];

const { mkdir, writeFile } = await import('node:fs/promises');
await mkdir(new URL('../golden/', import.meta.url), { recursive: true });

for (const c of CASES) {
	const res = await fetch(base + c.path, { method: c.method ?? 'GET' });
	const body = await res.json();
	const golden = { name: c.name, method: c.method ?? 'GET', path: c.path, status: res.status, body };
	await writeFile(
		new URL(`../golden/${c.name}.json`, import.meta.url),
		JSON.stringify(golden, null, '\t') + '\n'
	);
	console.log(`  recorded ${c.name} (${res.status})`);
}
console.log(`${CASES.length} goldens written to spec/golden/`);
