/**
 * A picture that is really a chemistry drawing (backend chem/). Tiptap's own Image node, with one
 * attribute more: `chem`, the drawing's id, read from and written back to `data-chem` — the same
 * attribute the backend sanitizer keeps on a site-media `<img>` (config/sanitize.py) and the one
 * the rich editor uses to reopen the drawing when the picture is clicked (RichEditor.svelte's
 * `handleClickOn`). An ordinary picture (a comment attachment's thumbnail, say) parses through
 * the same node with `chem: null` and renders exactly as before.
 */
import Image from '@tiptap/extension-image';

export const ChemImage = Image.extend({
	addAttributes() {
		return {
			...this.parent?.(),
			chem: {
				default: null,
				parseHTML: (el: HTMLElement) => el.getAttribute('data-chem'),
				renderHTML: (attrs: { chem?: string | null }) =>
					attrs.chem ? { 'data-chem': attrs.chem, class: 'chem-drawing' } : {}
			}
		};
	}
});
