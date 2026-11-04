// The notebook's block-kind labels and the anchor refusal words — mirrors of
// `backend/config/blocks.py` (the kinds) and `backend/community/anchors.py` (the words). House rule
// 13: both backend files say so too. The concept profile's two extra kinds keep their labels in
// `components/concept/labels.ts`.

import { m } from '$lib/paraglide/messages.js';
import type { ContentBlockKind } from '$lib/types/blocks';

export const NOTEBOOK_KIND_LABELS: Record<ContentBlockKind, () => string> = {
	markdown: m.concept_block_markdown, // "Text"
	latex: m.concept_block_latex, // "Formula"
	code: m.notebook_kind_code, // "Code"
	chem: m.concept_block_chem, // "Chemistry"
	sketch: m.notebook_kind_sketch, // "Sketch"
	image: m.concept_block_image // "Picture"
};

/** The "Add block" order: text first, because most blocks are text. */
export const NOTEBOOK_KINDS: ContentBlockKind[] = [
	'markdown',
	'latex',
	'code',
	'chem',
	'sketch',
	'image'
];

/** Why the server refused an anchor (`community/anchors.py: clean_anchor`). */
export const ANCHOR_REFUSAL_LABELS: Record<string, () => string> = {
	malformed: m.anchor_refused_malformed, // "That part could not be pointed at."
	not_addressable: m.anchor_refused_notAddressable, // "Comments here are about the whole thing, not a part of it."
	no_such_block: m.anchor_refused_noSuchBlock, // "That part has just been changed or removed. Select it again."
	quote_too_long: m.anchor_refused_quoteTooLong // "Select a shorter passage (up to 500 characters)."
};

/** The name of an IMPLICIT block (content that is not a notebook), for the "On …" line. */
export function implicitBlockLabel(block: string): string | null {
	if (block === 'statement') return m.anchor_onStatement(); // "the statement"
	if (block === 'answer') return m.anchor_onAnswer(); // "the answer"
	if (block.startsWith('part-')) return m.anchor_onPart(); // "a part of the exercise"
	return null;
}

/** "the formula", "the code"… — the name of a notebook block by its kind, for the "On …" line. */
export function blockKindPlace(kind: string | null | undefined): string | null {
	switch (kind) {
		case 'markdown':
			return m.anchor_kind_markdown(); // "the paragraph"
		case 'latex':
			return m.anchor_kind_latex(); // "the formula"
		case 'code':
			return m.anchor_kind_code(); // "the code"
		case 'chem':
			return m.anchor_kind_chem(); // "the drawing"
		case 'sketch':
			return m.anchor_kind_sketch(); // "the sketch"
		case 'image':
			return m.anchor_kind_image(); // "the picture"
		case 'pdf':
			return m.anchor_kind_pdf(); // "the PDF"
		default:
			return null;
	}
}
