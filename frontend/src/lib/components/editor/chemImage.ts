/**
 * The one picture node this editor has, doing two jobs.
 *
 * Tiptap's own Image node declares `src`, `alt` and `title` and nothing else — and a ProseMirror
 * node silently drops every attribute it has not declared. So an `<img>` pasted or inserted here
 * comes back out of `getHTML()` stripped of anything this file does not name. Two kinds of picture
 * ride through it:
 *
 * - **A chemistry drawing** (backend `chem/`), carrying `data-chem` — the drawing's id, which is
 *   how `RichEditor`'s `handleClickOn` reopens the structure when the picture is clicked — and the
 *   `chem-drawing` class that styles it.
 * - **An uploaded picture** (backend `community/inline_images.py`), carrying `inline-image` plus
 *   `width`, `height` and `loading="lazy"`. Those three are not decoration: they are what stops the
 *   page jumping while pictures and KaTeX settle, and they are written by `InlineImage.embed_html`
 *   on the server, which is the only place that tag is spelled.
 *
 * `width`/`height`/`loading` and the class are declared here for that reason. Before they were, the
 * source-mode composer kept them (it is a textarea holding text) and the rich composer quietly ate
 * them — the picture still appeared, so nothing looked wrong, and the body that got saved had lost
 * its lazy loading and its intrinsic size. Found by a browser check asserting `img.inline-image`
 * inside the ProseMirror document, which found none.
 *
 * `config/sanitize.py`'s `img` callable is the other half of this list: an attribute added here and
 * not there is one bleach strips on write. Both files say so.
 */
import Image from '@tiptap/extension-image';

/** `parseHTML`/`renderHTML` for an attribute that is simply carried through unchanged. */
const passThrough = (name: string) => ({
	default: null,
	parseHTML: (el: HTMLElement) => el.getAttribute(name),
	renderHTML: (attrs: Record<string, unknown>) => (attrs[name] ? { [name]: attrs[name] } : {})
});

export const ChemImage = Image.extend({
	addAttributes() {
		return {
			...this.parent?.(),
			chem: {
				default: null,
				parseHTML: (el: HTMLElement) => el.getAttribute('data-chem'),
				renderHTML: (attrs: { chem?: string | null }) =>
					attrs.chem ? { 'data-chem': attrs.chem } : {}
			},
			// A chemistry drawing is always given its class, whether or not the parsed tag carried
			// one — that is what §17AV fixed when bleach was dropping it. Anything else keeps the
			// class it arrived with, which is how `inline-image` survives.
			class: {
				default: null,
				parseHTML: (el: HTMLElement) => el.getAttribute('class'),
				renderHTML: (attrs: { chem?: string | null; class?: string | null }) => {
					const cls = attrs.chem ? 'chem-drawing' : attrs.class;
					return cls ? { class: cls } : {};
				}
			},
			width: passThrough('width'),
			height: passThrough('height'),
			loading: passThrough('loading')
		};
	}
});
