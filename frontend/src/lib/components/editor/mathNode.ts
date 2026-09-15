/**
 * Live maths inside the rich editor (AUDIENCE-BRIEF.md §7's own "Left open" note, closed): a
 * Tiptap inline atom node that RENDERS through KaTeX while you edit, instead of showing the raw
 * `\( \)`/`\[ \]` source the way plain text does. Storage still does not change — this node's
 * `renderHTML` output (what `editor.getHTML()` persists) is the literal delimited text, nothing
 * else, so a document that has been through this editor is byte-for-byte the same kind of content
 * a hand-typed one already was, and the existing read pipeline (`renderContent.ts`'s own
 * extract-math-first pass) needs no change to typeset it.
 *
 * Deliberately hand-rolled over `@tiptap/extension-mathematics` (the package this app's own docs
 * already flagged as the "real fix"): that extension is built around MathML/`$…$` and would need
 * real reconfiguration for this site's own `\( \)`/`\[ \]` convention and its already-installed
 * KaTeX instance, at which point writing the ~80 lines a plain Tiptap `Node` needs costs about the
 * same as configuring someone else's — the same "no new dependency where the existing one already
 * does the job" call this codebase makes throughout (`testing/factories.py` over `factory_boy`,
 * `config/dblocale.py` over a locale library).
 *
 * One node type, not two (inline vs. display): `display` is an attribute, not a different node —
 * exactly the palette's own existing convention (every PALETTE entry already writes `\( \)`, never
 * `\[ \]`), and KaTeX's own `displayMode` already renders the centred, block-styled form regardless
 * of the surrounding ProseMirror node being "inline" — the visual result is correct either way, and
 * a second block-level node would double the surface for one cosmetic distinction.
 */
import { Node, mergeAttributes, nodeInputRule } from '@tiptap/core';
import type { Editor } from '@tiptap/core';
import katex from 'katex';
import { m } from '$lib/paraglide/messages.js';

export interface MathAttrs {
	latex: string;
	display: boolean;
}

const KATEX_OPTS = { throwOnError: false, strict: 'ignore' as const };

/** The same two delimiter conventions `renderContent.ts` extracts, reused rather than
 * reinvented — `\[ \]` before `\( \)` costs nothing extra here (the delimiter characters
 * themselves are unambiguous, unlike the `$`/`$$` case that file's own comment explains), kept in
 * the same order purely so a reader comparing the two files sees the same shape.
 *
 * Deliberately NOT global (no `/g`) and `$`-anchored, matching every official Tiptap node input
 * rule's own regex (e.g. `@tiptap/extension-image`'s `inputRegex`) rather than the `/g`-flagged
 * pair `convertMathText` builds fresh on every call below: Tiptap re-runs `find.exec(textBefore)`
 * on the SAME regex object after every keystroke, and a global regex's `lastIndex` persists
 * across those calls — so the very next keystroke resumes searching from wherever the previous
 * match left off in a now-different string, silently missing matches. `$`-anchoring is what makes
 * the match land exactly at the character just typed, not an earlier `\( \)` pair elsewhere in
 * the same text block. */
const DISPLAY_MATH_INPUT = /\\\[([\s\S]+?)\\\]$/;
const INLINE_MATH_INPUT = /\\\(([\s\S]+?)\\\)$/;

function wrapDelims(latex: string, display: boolean): string {
	return display ? `\\[${latex}\\]` : `\\(${latex}\\)`;
}

function renderKatex(latex: string, display: boolean): string {
	try {
		return katex.renderToString(latex || ' ', { ...KATEX_OPTS, displayMode: display });
	} catch {
		return '';
	}
}

export const MathNode = Node.create({
	name: 'math',
	group: 'inline',
	inline: true,
	atom: true,
	selectable: true,

	addAttributes() {
		return {
			latex: { default: '' },
			display: {
				default: false,
				parseHTML: (el) => el.getAttribute('data-display') === 'true',
				renderHTML: (attrs) => ({ 'data-display': attrs.display ? 'true' : 'false' })
			}
		};
	},

	parseHTML() {
		// A round-trip safety net (copy/paste within the page) — never what the initial
		// source→rich conversion relies on, since stored content has no such span (see
		// `convertMathText` below, which scans plain delimited TEXT instead).
		return [{ tag: 'span[data-math-editor]' }];
	},

	renderHTML({ node, HTMLAttributes }) {
		// What `editor.getHTML()` persists: plain delimited text, wrapped in the least amount of
		// markup that still lets a same-session copy/paste recognise it via `parseHTML` above.
		// The wrapping `<span>` survives the backend's own sanitizer (config/sanitize.py already
		// allows `span`); `data-math-editor`/`data-display` do not (not in its attribute
		// allowlist) and are stripped on write — harmless, since the read pipeline never looks at
		// them, only at the delimited text itself.
		return [
			'span',
			mergeAttributes(HTMLAttributes, { 'data-math-editor': 'true' }),
			wrapDelims(node.attrs.latex as string, node.attrs.display as boolean)
		];
	},

	addNodeView() {
		return ({ node, getPos, editor }) => {
			const dom = document.createElement('span');
			dom.className = 'rich-editor-math';

			const paint = () => {
				const latex = node.attrs.latex as string;
				const display = node.attrs.display as boolean;
				const html = renderKatex(latex, display);
				if (html) {
					dom.innerHTML = html;
					dom.classList.remove('rich-editor-math--broken');
				} else {
					dom.textContent = wrapDelims(latex, display);
					dom.classList.add('rich-editor-math--broken');
				}
			};
			paint();

			dom.addEventListener('click', (event) => {
				event.preventDefault();
				if (typeof getPos !== 'function') return;
				editMathAt(editor, getPos(), node.attrs as MathAttrs);
			});

			return {
				dom,
				update(updated) {
					if (updated.type !== node.type) return false;
					node = updated;
					paint();
					return true;
				},
				selectNode() {
					dom.classList.add('is-selected');
				},
				deselectNode() {
					dom.classList.remove('is-selected');
				}
			};
		};
	},

	addInputRules() {
		return [
			nodeInputRule({
				find: DISPLAY_MATH_INPUT,
				type: this.type,
				getAttributes: (match) => ({ latex: match[1], display: true })
			}),
			nodeInputRule({
				find: INLINE_MATH_INPUT,
				type: this.type,
				getAttributes: (match) => ({ latex: match[1], display: false })
			})
		];
	}
});

/** Click-to-edit: the same `prompt()` the existing link button already uses (RichEditor.svelte),
 * not a new UI pattern for one node type. An empty answer removes the node — the honest way to
 * delete an equation you no longer want. */
function editMathAt(editor: Editor, pos: number, attrs: MathAttrs) {
	const next = prompt(m.editor_mathPrompt(), attrs.latex); // "LaTeX for this equation (leave blank to remove it)"
	if (next === null) return;
	const trimmed = next.trim();
	if (trimmed === '') {
		editor
			.chain()
			.focus()
			.deleteRange({ from: pos, to: pos + 1 })
			.run();
		return;
	}
	editor
		.chain()
		.focus()
		.command(({ tr }) => {
			tr.setNodeMarkup(pos, undefined, { ...attrs, latex: trimmed });
			return true;
		})
		.run();
}

/**
 * Converts every `\( \)`/`\[ \]` sequence already sitting in the document's plain text into a
 * live `math` node — called once right after the document is (re)built from stored `value`
 * (RichEditor.svelte's `mountRich`), so switching INTO rich mode shows existing maths rendered,
 * not just maths typed from that point on. Input rules (`addInputRules` above) only fire on a
 * live keystroke; they never see text that arrived via `setContent`.
 *
 * Collects every match first, then applies them in REVERSE document order in one transaction —
 * replacing earlier matches would shift the positions of every later one still to be applied.
 */
export function convertMathText(editor: Editor) {
	const mathType = editor.schema.nodes.math;
	if (!mathType) return;
	const pattern = /\\\[([\s\S]+?)\\\]|\\\(([\s\S]+?)\\\)/g;
	const matches: { from: number; to: number; attrs: MathAttrs }[] = [];
	editor.state.doc.descendants((node, pos) => {
		if (!node.isText) return;
		const text = node.text ?? '';
		pattern.lastIndex = 0;
		let match: RegExpExecArray | null;
		while ((match = pattern.exec(text))) {
			const display = match[1] !== undefined;
			matches.push({
				from: pos + match.index,
				to: pos + match.index + match[0].length,
				attrs: { latex: (display ? match[1] : match[2]) ?? '', display }
			});
		}
	});
	if (!matches.length) return;
	const { tr } = editor.state;
	for (const { from, to, attrs } of matches.reverse()) {
		tr.replaceWith(from, to, mathType.create(attrs));
	}
	editor.view.dispatch(tr);
}

/** Turns a palette entry's own `\(\frac{a}{b}\)`-shaped string into node attrs, or `null` for a
 * plain symbol (`±`, `α`, …) that should still just be inserted as text — RichEditor.svelte's
 * `insert()` uses this to decide which of the two `insertContent` shapes to call. */
export function paletteMathAttrs(text: string): MathAttrs | null {
	const display = /^\\\[([\s\S]+)\\\]$/.exec(text);
	if (display) return { latex: display[1], display: true };
	const inline = /^\\\(([\s\S]+)\\\)$/.exec(text);
	if (inline) return { latex: inline[1], display: false };
	return null;
}
