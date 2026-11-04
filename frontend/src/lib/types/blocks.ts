/* --- notebooks --------------------------------------------------------------------------------
 * A comment, a solution, a post or a concept article may be an ORDERED LIST OF BLOCKS — a
 * paragraph, a display formula, code, a chemistry drawing, a whiteboard sketch, a picture — each
 * edited with the widget this app already has for that kind of thing (owner, 2026-11-04,
 * HISTORY.md §17DI). `backend/config/blocks.py` is the one place that says what a block may be;
 * this file is its mirror (house rule 13 — flagged in both files). Concepts add two kinds of their
 * own (`pdf`, and an `image` backed by a concept asset), which live in `types/concept.ts`.
 *
 * Every block has an `id`. It is '' on a block the server has not seen yet; the server allocates
 * one and KEEPS whatever id a client sends back, which is what lets a comment point at one block
 * (`Anchor.block`) and survive the notebook being edited around it.
 */

export type ContentBlockKind = 'markdown' | 'latex' | 'code' | 'chem' | 'sketch' | 'image';

/** A paragraph: Markdown with raw HTML and literal LaTeX, exactly like every other content field. */
export interface MarkdownBlock {
	id: string;
	kind: 'markdown';
	body: string;
}

/** One display formula, stored raw and drawn as `\[ … \]`. */
export interface LatexBlock {
	id: string;
	kind: 'latex';
	source: string;
}

/** A listing. Drawn as text, never as HTML, and never run. `language` is a label for the reader. */
export interface CodeBlock {
	id: string;
	kind: 'code';
	language: string;
	source: string;
}

/** A picture a block points at, expanded by the server for reading. */
export interface BlockPicture {
	imageUrl: string;
	label: string;
	width: number;
	height: number;
}

export interface ChemBlock {
	id: string;
	kind: 'chem';
	drawingId: string;
	caption: string;
	/** Read shape only. */
	drawing?: BlockPicture & { sourceFormat: string };
}

export interface SketchBlock {
	id: string;
	kind: 'sketch';
	sketchId: string;
	caption: string;
	/** Read shape only. */
	sketch?: BlockPicture;
}

/** A picture uploaded through `/api/inline-images/` — re-encoded, never the bytes sent. */
export interface InlineImageBlock {
	id: string;
	kind: 'image';
	imageId: string;
	alt: string;
	caption: string;
	/** Read shape only. */
	image?: { url: string; width: number; height: number };
}

export type ContentBlock =
	MarkdownBlock | LatexBlock | CodeBlock | ChemBlock | SketchBlock | InlineImageBlock;

/** What part of something a comment is about (`backend/community/anchors.py`). `block` is a block
 *  id, or an implicit one for content that is not a notebook: `body` (a plain comment, solution or
 *  post), `statement`, `answer`, `part-<id>` (an exercise). `quote` is the passage a reader
 *  selected, with a little `prefix`/`suffix` context so the right occurrence can be found again. */
export interface Anchor {
	block: string;
	quote: string;
	prefix: string;
	suffix: string;
	/** Read shape only: `detached` once the block itself has been deleted. */
	state?: 'attached' | 'detached';
}

/** What a composer hands its host besides the body: a notebook, and what the comment is about. */
export interface CommentExtras {
	blocks?: ContentBlock[];
	anchor?: Anchor | null;
}

/** Characters of text across one notebook, per owner — `config/blocks.py`'s profiles, mirrored so
 *  a composer can stop before the save is refused. */
export const NOTEBOOK_LIMITS = {
	comment: { maxBlocks: 40 },
	solution: { maxBlocks: 100 },
	post: { maxBlocks: 60 },
	concept: { maxBlocks: 200 }
} as const;
