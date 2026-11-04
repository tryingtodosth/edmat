/**
 * Turning a reader's selection into an anchor, and an anchor back into a place on the page.
 *
 * The server cannot check a quote (`backend/community/anchors.py` says why: a reader selects
 * RENDERED text, and only the browser has the rendering), so both directions live here and agree
 * with each other by construction — they read a block's text the same way:
 *
 * - **Maths reads as its source.** KaTeX draws a formula twice (a visual tree and a MathML copy),
 *   so a formula's `textContent` is the formula three times over in pieces. Every `.katex` element
 *   is read as the TeX in its `<annotation>` instead, one atom that a selection can include but
 *   never cut in half — a selection that starts or ends inside a formula is widened to the whole
 *   formula.
 * - **Whitespace is collapsed** on both sides, so a quote taken across a line break in one browser
 *   is found again in another.
 *
 * A block on the page is `[data-anchor-scope="<scope>"] > [data-block-id="<id>"]`. The scope says
 * whose blocks these are — `comment-<id>` for a comment, `<targetType>-<targetId>` for the thing a
 * thread hangs off — and the direct-child combinator is what keeps a block of a comment rendered
 * INSIDE a page's own scope from answering for the page.
 */

import type { Anchor } from '$lib/types/blocks';

export const MAX_QUOTE_CHARS = 500;

/** What a host hands `BlockContent` to make its blocks commentable. */
export interface Annotate {
	/** `{block id: how many comments are about it}` — see `anchorCounts`. */
	counts: Record<string, number>;
	/** A reader asked to comment on a block (no quote) or on a passage in it. */
	onComment: (anchor: Anchor) => void;
	/** A reader asked to see what is already said about a block. Without it the count is a label. */
	onShow?: (block: string) => void;
}
const CONTEXT_CHARS = 32;

type Segment = { node: Node; text: string; atomic: boolean };

function texOf(katex: Element): string {
	const tex = katex.querySelector('annotation[encoding="application/x-tex"]')?.textContent ?? '';
	return katex.closest('.katex-display') ? `\\[${tex}\\]` : `\\(${tex}\\)`;
}

/** Every piece of readable text under `root`, in order; a formula is one atomic piece. */
function segments(root: Node): Segment[] {
	const out: Segment[] = [];
	const walk = (node: Node) => {
		if (node.nodeType === Node.TEXT_NODE) {
			out.push({ node, text: node.textContent ?? '', atomic: false });
			return;
		}
		if (node instanceof Element) {
			if (node.classList.contains('katex')) {
				out.push({ node, text: texOf(node), atomic: true });
				return;
			}
			// The gutter's own buttons are not part of what anybody wrote.
			if (node.hasAttribute('data-anchor-ignore')) return;
		}
		node.childNodes.forEach(walk);
	};
	walk(root);
	return out;
}

/** Collapse whitespace, keeping a map from each collapsed index back to the raw one. */
function collapse(raw: string): { text: string; map: number[] } {
	let text = '';
	const map: number[] = [];
	let lastSpace = true;
	for (let i = 0; i < raw.length; i++) {
		const ch = raw[i];
		if (/\s/.test(ch)) {
			if (lastSpace) continue;
			text += ' ';
			map.push(i);
			lastSpace = true;
		} else {
			text += ch;
			map.push(i);
			lastSpace = false;
		}
	}
	map.push(raw.length);
	return { text, map };
}

const norm = (s: string) => collapse(s).text;

/** The block element a node sits in, within `container` (a scope), or null. */
export function blockOf(node: Node | null, container: Element): HTMLElement | null {
	let el: Node | null = node;
	while (el && el !== container) {
		if (el instanceof HTMLElement && el.dataset.blockId && el.parentElement === container)
			return el;
		el = el.parentNode;
	}
	return null;
}

/**
 * The anchor a selection inside one block makes, or null when the selection is empty, spans two
 * blocks, or is longer than the server accepts (the caller says so rather than truncating it —
 * a cut-off quote reads as if the reader meant less than they selected).
 */
export function anchorFromSelection(
	selection: Selection | null,
	container: Element
): { anchor: Anchor | null; tooLong: boolean } {
	if (!selection || selection.isCollapsed || selection.rangeCount === 0) {
		return { anchor: null, tooLong: false };
	}
	const range = selection.getRangeAt(0).cloneRange();
	const block = blockOf(range.startContainer, container);
	if (!block || blockOf(range.endContainer, container) !== block) {
		return { anchor: null, tooLong: false };
	}
	// Widen to whole formulas.
	const startKatex = (
		range.startContainer instanceof Element
			? range.startContainer
			: range.startContainer.parentElement
	)?.closest('.katex');
	if (startKatex && block.contains(startKatex)) range.setStartBefore(startKatex);
	const endKatex = (
		range.endContainer instanceof Element ? range.endContainer : range.endContainer.parentElement
	)?.closest('.katex');
	if (endKatex && block.contains(endKatex)) range.setEndAfter(endKatex);

	const before = document.createRange();
	before.setStart(block, 0);
	before.setEnd(range.startContainer, range.startOffset);
	const after = document.createRange();
	after.setStart(range.endContainer, range.endOffset);
	after.setEnd(block, block.childNodes.length);

	const read = (r: Range) =>
		segments(r.cloneContents())
			.map((s) => s.text)
			.join('');
	const quote = norm(read(range)).trim();
	if (!quote) return { anchor: null, tooLong: false };
	if (quote.length > MAX_QUOTE_CHARS) return { anchor: null, tooLong: true };
	const prefix = norm(read(before));
	const suffix = norm(read(after));
	return {
		anchor: {
			block: block.dataset.blockId!,
			quote,
			prefix: prefix.slice(-CONTEXT_CHARS),
			suffix: suffix.slice(0, CONTEXT_CHARS)
		},
		tooLong: false
	};
}

/** Where `anchor.quote` is in `block` now, as a DOM range; null when it is no longer there. */
export function rangeForQuote(block: Element, anchor: Anchor): Range | null {
	if (!anchor.quote) return null;
	const segs = segments(block);
	const raw = segs.map((s) => s.text).join('');
	const { text, map } = collapse(raw);
	const quote = norm(anchor.quote);
	// The occurrence with the context around it, then the quote alone.
	let at = -1;
	const withContext = norm(anchor.prefix) + quote + norm(anchor.suffix);
	const ctxAt = withContext !== quote ? text.indexOf(withContext) : -1;
	if (ctxAt >= 0) at = ctxAt + norm(anchor.prefix).length;
	if (at < 0) {
		const trimmedPrefix = norm(anchor.prefix).trimStart();
		const loose = trimmedPrefix ? text.indexOf(trimmedPrefix + quote) : -1;
		at = loose >= 0 ? loose + trimmedPrefix.length : text.indexOf(quote);
	}
	if (at < 0) return null;
	const rawStart = map[at];
	const rawEnd = map[at + quote.length - 1] + 1;

	const locate = (rawIndex: number, edge: 'start' | 'end'): [Node, number] | null => {
		let offset = 0;
		for (const seg of segs) {
			const end = offset + seg.text.length;
			if (rawIndex < end || (edge === 'end' && rawIndex === end)) {
				if (seg.atomic) {
					const parent = seg.node.parentNode!;
					const index = Array.prototype.indexOf.call(parent.childNodes, seg.node);
					return edge === 'start' ? [parent, index] : [parent, index + 1];
				}
				return [seg.node, rawIndex - offset];
			}
			offset = end;
		}
		return null;
	};
	const start = locate(rawStart, 'start');
	const end = locate(rawEnd, 'end');
	if (!start || !end) return null;
	const range = document.createRange();
	range.setStart(...start);
	range.setEnd(...end);
	return range;
}

/** The block element an anchor names, on this page right now. */
export function findBlock(scope: string, block: string): HTMLElement | null {
	if (typeof document === 'undefined') return null;
	return document.querySelector<HTMLElement>(
		`[data-anchor-scope="${CSS.escape(scope)}"] > [data-block-id="${CSS.escape(block)}"]`
	);
}

const HIGHLIGHT = 'edmat-anchor';

/**
 * Bring an anchor into view: scroll to its block, flash it, and mark the quoted passage with the
 * CSS Custom Highlight API where the browser has it (no DOM is changed, so nothing the renderer
 * drew is disturbed). Returns what it could find, so the caller can say "that passage has since
 * changed" rather than pretend it highlighted something.
 */
export function focusAnchor(
	scope: string,
	anchor: Anchor
): 'quote' | 'block' | 'quote-gone' | 'missing' {
	const block = findBlock(scope, anchor.block);
	if (!block) return 'missing';
	block.scrollIntoView({ behavior: 'smooth', block: 'center' });
	block.classList.remove('nb-block--flash');
	void block.offsetWidth; // restart the animation
	block.classList.add('nb-block--flash');
	const range = rangeForQuote(block, anchor);
	const registry = (globalThis as { CSS?: { highlights?: Map<string, unknown> } }).CSS?.highlights;
	const HighlightCtor = (globalThis as { Highlight?: new (...r: Range[]) => unknown }).Highlight;
	if (registry && HighlightCtor) {
		if (range) registry.set(HIGHLIGHT, new HighlightCtor(range));
		else registry.delete(HIGHLIGHT);
	}
	if (!anchor.quote) return 'block';
	return range ? 'quote' : 'quote-gone';
}

/** `{block id: how many comments are about it}` for a list of comments. */
export function anchorCounts(
	comments: { anchor: Anchor | null; isRemoved?: boolean }[]
): Record<string, number> {
	const counts: Record<string, number> = {};
	for (const c of comments) {
		if (!c.anchor || c.isRemoved) continue;
		counts[c.anchor.block] = (counts[c.anchor.block] ?? 0) + 1;
	}
	return counts;
}
