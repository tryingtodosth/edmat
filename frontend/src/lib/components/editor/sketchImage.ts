/**
 * The freehand-sketch picture node — `chemImage.ts`'s sibling, and the same warning applies.
 *
 * Tiptap's own Image node declares `src`, `alt` and `title` and nothing else, and a ProseMirror
 * node silently drops every attribute it has not declared. A sketch's `<img>` (backend
 * `sketches/models.py`'s `embed_html`) carries five more: `data-sketch` (the drawing's id, which is
 * how `RichEditor`'s `handleClickOn` reopens the board when the picture is clicked), the
 * `sketch-drawing` class that styles it, and `width`/`height`/`loading="lazy"`, which are what stop
 * the page jumping while pictures and KaTeX settle.
 *
 * **Why a second extension rather than more attributes on `ChemImage`.** Tiptap resolves one node
 * type per name, so the two cannot both be `image` — mounting both would be a duplicate-name error.
 * This one therefore extends `ChemImage` rather than `Image`: it is the SAME node with one more
 * attribute, and `RichEditor` mounts only this one. Written the other way round (two siblings off
 * `Image`, pick one) a document would lose `data-chem` the moment the sketch node was the one
 * mounted, which is exactly the silent-attribute-loss bug this file exists to prevent. `ChemImage`
 * stays exported and separately documented because it owns the chem half of the attribute list.
 *
 * `config/sanitize.py`'s `img` callable is the other half of this list: an attribute added here and
 * not there is one bleach strips on write. Both files say so.
 */
import { ChemImage } from './chemImage';

export const SketchImage = ChemImage.extend({
	addAttributes() {
		const parent = this.parent?.() ?? {};
		return {
			...parent,
			sketch: {
				default: null,
				parseHTML: (el: HTMLElement) => el.getAttribute('data-sketch'),
				renderHTML: (attrs: { sketch?: string | null }) =>
					attrs.sketch ? { 'data-sketch': attrs.sketch } : {}
			},
			// A drawing is always given its own class, whether or not the parsed tag carried one —
			// that is what §17AV fixed when bleach was dropping it. A chem drawing keeps
			// `chem-drawing`, a sketch gets `sketch-drawing`, and anything else keeps the class it
			// arrived with, which is how `inline-image` survives.
			class: {
				default: null,
				parseHTML: (el: HTMLElement) => el.getAttribute('class'),
				renderHTML: (attrs: {
					chem?: string | null;
					sketch?: string | null;
					class?: string | null;
				}) => {
					const cls = attrs.chem ? 'chem-drawing' : attrs.sketch ? 'sketch-drawing' : attrs.class;
					return cls ? { class: cls } : {};
				}
			}
		};
	}
});
