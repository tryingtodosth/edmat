// The manual (`src/lib/content/guide/`) and the showcase (`src/lib/content/showcase/`) are PLAIN
// TEXT: `guide/types.ts` says so of every `body` line, both pages draw each paragraph as `{text}`
// with nothing to sanitize, and so a Markdown habit typed into one of them — `*written*`,
// `**regulamin**`, `` `code` ``, `[a link](…)` — is printed to the reader with its punctuation
// showing. That shipped for months (`*content*`, `*treści*`, `*for*`, `*losowanie*` and four more;
// WP11, found by the screenshot pass), because nothing reads the words but a person.
//
// This reads them instead. It parses each file with the TypeScript compiler and looks only at
// STRING LITERALS (so the files' own `/** … */` comments, which are Markdown-ish and for
// developers, are never flagged), and refuses:
//   - an asterisk touching a letter or digit — `*word*`, `**word**`, `*do czego*`;
//   - an underscore pair around a word — `_word_`;
//   - a backtick — inline code;
//   - a Markdown link — `[text](url)`.
// A real asterisk in prose (a footnote mark, "a*b") would be flagged too; none exists, and the day
// one is needed this list is the place to say so.
//
//   npm run check:plain      (exit 1 and a line per hit, or one line saying how much it read)

import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import ts from 'typescript';

const ROOT = new URL('..', import.meta.url).pathname;
const DIRS = ['src/lib/content/guide', 'src/lib/content/showcase'];

const RULES = [
	{ name: 'Markdown emphasis (*…*)', re: /\*[\p{L}\p{N}]|[\p{L}\p{N}]\*/u },
	{
		name: 'Markdown emphasis (_…_)',
		re: /(^|[^\p{L}\p{N}_])_[\p{L}\p{N}][^_]*_(?![\p{L}\p{N}_])/u
	},
	{ name: 'inline code (`…`)', re: /`/ },
	{ name: 'Markdown link ([…](…))', re: /\[[^\]]+\]\([^)]+\)/ }
];

let strings = 0;
const hits = [];

function visit(node, source, file) {
	let text = null;
	if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) text = node.text;
	else if (ts.isTemplateHead(node) || ts.isTemplateMiddle(node) || ts.isTemplateTail(node))
		text = node.text;
	if (text !== null) {
		strings++;
		for (const rule of RULES) {
			const match = rule.re.exec(text);
			if (match) {
				const { line } = source.getLineAndCharacterOfPosition(node.getStart(source));
				const at = Math.max(0, match.index - 25);
				hits.push(
					`${file}:${line + 1}  ${rule.name}  …${text.slice(at, match.index + 30).replace(/\s+/g, ' ')}…`
				);
			}
		}
	}
	ts.forEachChild(node, (child) => visit(child, source, file));
}

let files = 0;
for (const dir of DIRS) {
	for (const name of readdirSync(join(ROOT, dir)).sort()) {
		if (!name.endsWith('.ts')) continue;
		const path = join(ROOT, dir, name);
		const source = ts.createSourceFile(
			path,
			readFileSync(path, 'utf8'),
			ts.ScriptTarget.Latest,
			true
		);
		files++;
		visit(source, source, relative(ROOT, path));
	}
}

if (hits.length) {
	console.error(`${hits.length} Markdown mark(s) in text that is drawn as plain text:\n`);
	for (const hit of hits) console.error(`  ${hit}`);
	console.error('\nTake the punctuation out of the words (the pages print it as typed).');
	process.exit(1);
}
console.log(
	`ok — ${strings} strings in ${files} files under ${DIRS.join(', ')}: no Markdown marks.`
);
