/** A freehand whiteboard drawing made in Excalidraw (backend `sketches/`). The source is the scene
 * JSON the editor reopens; the picture is what content embeds, as an ordinary
 * `<img data-sketch="…">`. The same pair as `types/chem.ts`, with a different editor behind it. */
export interface Sketch {
	id: string;
	authorId: string;
	/** The Excalidraw scene as JSON text — handed straight back to `restore()` on reopen. */
	source: string;
	label: string;
	imageUrl: string;
	width: number;
	height: number;
	/** The exact `<img …>` to put into content, built by the server so `data-sketch` is spelled once. */
	embedHtml: string;
}

export interface SketchDraft {
	source: string;
	label: string;
	/** A `data:image/png;base64,…` URL — what Excalidraw's `exportToBlob` produces. */
	image: string;
}
