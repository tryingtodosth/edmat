// The conformance runner — the one definition of "done" for every implementation, reference
// included (PORTS-BRIEF.md §3). Point it at ANY running implementation seeded with the reference
// database and it replays every golden and diffs structurally:
//
//   node spec/conformance/run.mjs http://127.0.0.1:8090
//
// Structural diff, not string diff: JSON object key order and whitespace are serializer accidents,
// array order is contract. Prints the same ok/FAIL lines every e2e script in this repo prints;
// exit code 0 only on a clean sweep.
const base = process.argv[2];
if (!base) {
	console.error('usage: node spec/conformance/run.mjs <base-url-of-implementation>');
	process.exit(2);
}

const { readdir, readFile } = await import('node:fs/promises');
const dir = new URL('../golden/', import.meta.url);
const files = (await readdir(dir)).filter((f) => f.endsWith('.json')).sort();
if (files.length === 0) {
	console.error('no goldens found — record them first (spec/conformance/record.mjs)');
	process.exit(2);
}

function diff(expected, actual, path = '$') {
	if (expected === null || typeof expected !== 'object') {
		return Object.is(expected, actual) ? [] : [`${path}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`];
	}
	if (Array.isArray(expected)) {
		if (!Array.isArray(actual)) return [`${path}: expected array, got ${typeof actual}`];
		if (expected.length !== actual.length)
			return [`${path}: expected ${expected.length} items, got ${actual.length}`];
		return expected.flatMap((e, i) => diff(e, actual[i], `${path}[${i}]`));
	}
	if (actual === null || typeof actual !== 'object' || Array.isArray(actual))
		return [`${path}: expected object, got ${JSON.stringify(actual)}`];
	const problems = [];
	for (const key of new Set([...Object.keys(expected), ...Object.keys(actual)])) {
		if (!(key in actual)) problems.push(`${path}.${key}: missing`);
		else if (!(key in expected)) problems.push(`${path}.${key}: unexpected extra key`);
		else problems.push(...diff(expected[key], actual[key], `${path}.${key}`));
	}
	return problems;
}

let pass = 0;
let fail = 0;
for (const file of files) {
	const golden = JSON.parse(await readFile(new URL(file, dir), 'utf8'));
	let problems;
	try {
		const res = await fetch(base + golden.path, { method: golden.method });
		if (res.status !== golden.status) {
			problems = [`status: expected ${golden.status}, got ${res.status}`];
		} else {
			problems = diff(golden.body, await res.json());
		}
	} catch (e) {
		problems = [`request failed: ${e.message}`];
	}
	if (problems.length === 0) {
		pass++;
		console.log(`  ok   ${golden.name}`);
	} else {
		fail++;
		console.log(`  FAIL ${golden.name}`);
		for (const p of problems.slice(0, 5)) console.log(`         ${p}`);
	}
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
