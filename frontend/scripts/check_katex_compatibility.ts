// Phase 4 hardening: the "real, mechanical LaTeX-compatibility check across the full corpus" that
// CLAUDE.md's Section 11 has flagged as needed since Phase 1, closed for real here — not a copy of
// the rendering pipeline, the ACTUAL renderContent.ts/renderTitle functions this app ships,
// imported directly, so this check can never silently drift out of sync with what a reader's
// browser actually runs.
//
// Usage:
//   1. `cd backend && .venv/bin/python manage.py dump_text_fields --out /tmp/edmat_text_fields.json`
//      (every ExerciseTranslation/MaterialTranslation's own text fields, every locale/status)
//   2. `cd frontend && npx tsx scripts/check_katex_compatibility.ts`
//
// Two real failure signatures, checked against the FULL rendered output:
//   1. A `.katex-error` element — KaTeX's own `throwOnError: false` behavior for a malformed or
//      unsupported command never throws, it renders visible red error text instead.
//   2. A literal, unprocessed `\( \) \[ \]` delimiter surviving into the output OUTSIDE of KaTeX's
//      own <annotation> element — that element faithfully echoes back the raw TeX SOURCE for
//      accessibility/copy-paste, which legitimately contains sequences like `\\[2mm]` (LaTeX's own
//      line-break-with-spacing syntax inside `cases`/`array` environments, used throughout this
//      corpus's real piecewise-function exercises) — a real false-positive class this checker's own
//      first draft hit and fixed, documented here so it isn't rediscovered from scratch later.
import { readFileSync } from 'node:fs';
import { renderContent, renderTitle } from '../src/lib/utils/renderContent';

interface Row {
	kind: 'exercise' | 'material';
	id: number;
	locale: string;
	status: string;
	ref: string;
	title?: string;
	statement?: string;
	hint?: string;
	answer?: string;
	solution?: string;
	description?: string;
}

interface Issue {
	kind: string;
	id: number;
	ref: string;
	locale: string;
	status: string;
	field: string;
	hasKatexError: boolean;
	leftoverDelimiter: boolean;
	rawSnippet: string;
}

const inputPath = process.argv[2] ?? '/tmp/edmat_text_fields.json';
const rows: Row[] = JSON.parse(readFileSync(inputPath, 'utf-8'));

const issues: Issue[] = [];

function check(
	row: Row,
	field: string,
	raw: string | undefined,
	renderFn: (s: string | undefined | null) => string
) {
	if (!raw) return;
	const rendered = renderFn(raw);
	const hasKatexError = rendered.includes('katex-error');
	// Strip KaTeX's own MathML block wholesale, not just <annotation> tags: since the
	// isomorphic-dompurify change (CLAUDE.md 17Q) sanitization runs for real in Node too, and
	// DOMPurify's default allowlist drops the <annotation> TAG while keeping its raw-TeX text —
	// so the old annotation-only strip left legitimate `\\[2mm]` line-break syntax sitting bare
	// inside <math> and flagged 100+ perfectly fine corpus fields (statements included) as
	// leftover delimiters. The whole katex-mathml block is visually hidden a11y/copy-paste
	// duplicate; the HTML half beside it is what readers see and what this check should judge.
	const withoutAnnotations = rendered
		.replace(/<math[\s\S]*?<\/math>/g, '')
		.replace(/<annotation[^>]*>[\s\S]*?<\/annotation>/g, '');
	const leftoverDelimiter = /\\[()[\]]/.test(withoutAnnotations);
	if (hasKatexError || leftoverDelimiter) {
		issues.push({
			kind: row.kind,
			id: row.id,
			ref: row.ref,
			locale: row.locale,
			status: row.status,
			field,
			hasKatexError,
			leftoverDelimiter,
			rawSnippet: raw.slice(0, 200)
		});
	}
}

for (const row of rows) {
	check(row, 'title', row.title, renderTitle);
	if (row.kind === 'exercise') {
		check(row, 'statement', row.statement, renderContent);
		check(row, 'answer', row.answer, renderContent);
	} else if (row.kind === 'solution_entry') {
		// The pool (exercises.SolutionEntry) — dump_text_fields emits one row per entry with the
		// body under its own kind's key ('hint' or 'solution'), no title of its own.
		check(row, 'hint', row.hint, renderContent);
		check(row, 'solution', row.solution, renderContent);
	} else {
		check(row, 'description', row.description, renderContent);
	}
}

console.log(`Checked ${rows.length} translation rows across the corpus.`);
console.log(`Found ${issues.length} field(s) with a real rendering issue.\n`);
for (const issue of issues) {
	console.log(
		`${issue.kind} #${issue.id} (${issue.ref}) [${issue.locale}/${issue.status}] — ${issue.field}: ` +
			`katex-error=${issue.hasKatexError} leftover-delimiter=${issue.leftoverDelimiter}`
	);
	console.log(`  raw: ${issue.rawSnippet.replace(/\n/g, '\\n')}`);
}

process.exit(issues.length > 0 ? 1 : 0);
