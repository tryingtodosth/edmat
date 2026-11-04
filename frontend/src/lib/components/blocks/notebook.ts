// Small pure helpers every notebook composer needs (a comment's, a solution's, a post's — the third
// caller is what earned this file, house rule 13).

import type { ContentBlock } from '$lib/types/blocks';

/** Whether a block has anything in it yet. An "Add block" pressed and left is not content: the
 *  composers drop such blocks on submit rather than have the server refuse an empty formula. */
export function blockHasContent(block: ContentBlock): boolean {
	switch (block.kind) {
		case 'markdown':
			return !!block.body.replace(/<[^>]*>/g, '').trim() || block.body.includes('<img');
		case 'latex':
		case 'code':
			return !!block.source.trim();
		case 'chem':
			return !!block.drawingId;
		case 'sketch':
			return !!block.sketchId;
		case 'image':
			return !!block.imageId;
	}
}

/** What a composer sends: the blocks with something in them. */
export function filledBlocks(blocks: ContentBlock[]): ContentBlock[] {
	return blocks.filter(blockHasContent);
}

/** What a composer starts a notebook with: whatever was already typed, as its first paragraph. */
export function notebookFrom(body: string): ContentBlock[] {
	return [{ id: '', kind: 'markdown', body }];
}
