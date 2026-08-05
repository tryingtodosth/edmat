// Markdown + literal LaTeX delimiters -> sanitized, math-typeset HTML. See CLAUDE.md Section 11 for
// why this exact pipeline: content is stored as Markdown source with raw-HTML passthrough allowed
// (markdown-it's `html: true`), which is what lets the real, existing corpus's `<p>`-wrapped
// content (Database-of-Student-Exercise) migrate with zero rewriting — it's already valid input to
// any Markdown parser that passes raw HTML through untouched.
//
// Pipeline: extract + KaTeX-render every \( \) / \[ \] segment FIRST, stash each result behind an
// inert placeholder token, run the REMAINING text through markdown-it, then splice the real KaTeX
// HTML back in over the placeholders — and only THEN sanitize (DOMPurify), so it catches anything
// unsafe from either the raw-HTML passthrough or (defense in depth) unexpected KaTeX output.
//
// This order is load-bearing, not stylistic — a real, found-and-fixed bug: running markdown-it
// FIRST and only afterward regexing for \( \)/\[ \] in its OUTPUT (the original version of this
// file) silently broke on any math that wasn't already wrapped in a literal `<p>` tag. CommonMark's
// own inline backslash-escape rule treats `\[`, `\]`, `\(`, `\)` as escaped punctuation (backslash +
// ASCII punctuation = "print the punctuation literally, drop the backslash") the INSTANT that text
// is parsed as an ordinary Markdown paragraph rather than passed through as a raw HTML block —
// turning `\[ f(x) \]` into a bare `[ f(x) ]` with the backslashes gone before this file's own regex
// ever saw them (the inner LaTeX commands like `\mathbb`/`\to` survived only because backslash +
// LETTER isn't a CommonMark escape sequence, which is what made the corruption look so selective).
// Extracting math before markdown-it ever touches the text sidesteps this escaping question
// entirely — it no longer matters whether a given \[ \] block happens to sit inside a `<p>` tag or
// as bare paragraph text between two of them (the exact shape a chunk of the real corpus uses, e.g.
// `uw-matematyka-am2-0049`'s statement: `<p>Niech</p>\n\n\[\nf:\mathbb{R}^n\to\mathbb{R}\n\]\n\n<p>...`).

// `isomorphic-dompurify`, not the plain `dompurify` package — a real security-scan finding, fixed:
// the browser build of `dompurify` needs a real `document`, so this file used to just return the
// RAW, unsanitized rendered HTML whenever `window` was undefined (a server/Node render). That branch
// was never actually hit with real content in Phase 1-3's own mocked/client-only data loading, but
// it's live code, not dead code — the moment a real `load` function is ever added to any route (this
// app's own architecture notes already flag `adapter-node` as the expected next step), it becomes a
// genuine, unauthenticated stored-XSS path with zero mitigation. `isomorphic-dompurify` wraps the
// same DOMPurify API over a real jsdom instance when `window` doesn't exist, so sanitization is now
// unconditional in every environment — no environment-detection branch needed here at all anymore.
import DOMPurify from 'isomorphic-dompurify';
import katex from 'katex';
import MarkdownIt from 'markdown-it';

const md: MarkdownIt = new MarkdownIt({ html: true, linkify: true, breaks: false });

// Matches the exact delimiter convention the source corpus already uses — \( \) inline, \[ \]
// display — never $ $ or $$ $$, so a stray dollar sign in ordinary prose is never misread as math.
const DISPLAY_MATH = /\\\[([\s\S]+?)\\\]/g;
const INLINE_MATH = /\\\(([\s\S]+?)\\\)/g;

// Purely alphanumeric, no markdown-significant punctuation (no `*_[]()` etc.) — CommonMark never
// escapes, emphasizes, or otherwise transforms a plain run of letters/digits, so this token is
// guaranteed to survive markdown-it's inline parsing completely unchanged, regardless of whether it
// ends up inside a `<p>`, a list item, or anywhere else markdown-it decides to place it.
const PLACEHOLDER_RE = /EDMATHPLACEHOLDERx(\d+)xEND/g;

function safeKatex(tex: string, displayMode: boolean): string {
	try {
		return katex.renderToString(tex, { displayMode, throwOnError: false, strict: 'ignore' });
	} catch {
		// A malformed formula shouldn't take the whole page down — fall back to showing the raw
		// LaTeX source, still wrapped in its own delimiters so it's visually distinguishable as math.
		return displayMode ? `\\[${tex}\\]` : `\\(${tex}\\)`;
	}
}

/**
 * Renders one content field (an exercise's statement/hint/answer/solution, or a material's
 * description). Sanitized unconditionally, in every environment — `isomorphic-dompurify` (see this
 * file's own top-of-file note) means there's no longer a browser-vs-server distinction to guard
 * here at all.
 */
export function renderContent(source: string | undefined | null): string {
	if (!source) return '';

	const renderedSegments: string[] = [];
	function stash(tex: string, displayMode: boolean): string {
		const token = `EDMATHPLACEHOLDERx${renderedSegments.length}xEND`;
		renderedSegments.push(safeKatex(tex, displayMode));
		return token;
	}

	const protectedSource = source
		.replace(DISPLAY_MATH, (_m, tex) => stash(tex, true))
		.replace(INLINE_MATH, (_m, tex) => stash(tex, false));

	const html = md.render(protectedSource);
	const withMath = html.replace(PLACEHOLDER_RE, (_m, i) => renderedSegments[Number(i)]);

	return DOMPurify.sanitize(withMath, { USE_PROFILES: { html: true, svg: true, mathMl: true } });
}

/**
 * Renders a single-line field that may contain inline LaTeX — an exercise/submission/translation
 * TITLE, not a full content field. A real, found-via-user-report bug: every title render site in
 * this app (`ExerciseCard`, the exercise detail page, "My Set", both `MaterialCard` and the
 * moderation queue's own submission/edit/translation rows) was interpolating `{title}` directly as
 * plain Svelte text — which HTML-escapes but never runs `renderContent()`, so a title like the real
 * corpus's `"Normy \(\ell^1\) i \(\ell^\infty\)"` rendered its literal `\(...\)` delimiters instead
 * of typeset math.
 *
 * Deliberately NOT `renderContent()` itself, reused as-is — a title is a plain string, never
 * Markdown source, so this skips markdown-it's block-level parsing entirely (no `<p>` wrapping,
 * which would be invalid HTML nested inside the `<h1>`/`<h3>` every title actually renders inside),
 * and always renders in KaTeX's non-display mode even for a `\[ \]`-delimited segment — a title is
 * inherently one inline run of text, never a place a block equation should visually sit.
 */
export function renderTitle(source: string | undefined | null): string {
	if (!source) return '';

	const renderedSegments: string[] = [];
	function stash(tex: string): string {
		const token = `EDMATHPLACEHOLDERx${renderedSegments.length}xEND`;
		renderedSegments.push(safeKatex(tex, false));
		return token;
	}

	// Placeholder tokens are pure alphanumeric (see PLACEHOLDER_RE's own note above) — safe to
	// HTML-escape the surrounding plain text AFTER stashing without touching the tokens themselves.
	const withPlaceholders = source
		.replace(DISPLAY_MATH, (_m, tex) => stash(tex))
		.replace(INLINE_MATH, (_m, tex) => stash(tex));
	const escaped = withPlaceholders
		.replace(/&/g, '&amp;')
		.replace(/</g, '&lt;')
		.replace(/>/g, '&gt;');
	const withMath = escaped.replace(PLACEHOLDER_RE, (_m, i) => renderedSegments[Number(i)]);

	return DOMPurify.sanitize(withMath, { USE_PROFILES: { html: true, svg: true, mathMl: true } });
}
