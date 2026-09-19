/** A picture uploaded to sit INSIDE the body somebody is writing, rather than in the attachment
 * row beneath it (backend community/inline_images.py). The editor never builds the `<img>` itself:
 * `embedHtml` is what the server hands back, so the tag the sanitizer will accept is spelled in
 * exactly one place — the same arrangement `ChemDrawing` has. */
export interface InlineImage {
	id: string;
	authorId: string;
	url: string;
	alt: string;
	width: number;
	height: number;
	originalName: string;
	sizeBytes: number;
	/** The exact `<img …>` to insert, with intrinsic width/height and `loading="lazy"`. */
	embedHtml: string;
}
