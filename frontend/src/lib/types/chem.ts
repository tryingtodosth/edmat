/** A chemical structure or reaction drawn in Ketcher (backend chem/). The source is what the
 * editor reopens; the picture is what content embeds, as an ordinary `<img data-chem="…">`. */
export type ChemSourceFormat = 'ket' | 'mol';

export interface ChemDrawing {
	id: string;
	authorId: string;
	sourceFormat: ChemSourceFormat;
	source: string;
	label: string;
	imageUrl: string;
	imageKind: 'svg' | 'raster';
	width: number;
	height: number;
	/** The exact `<img …>` to put into content, built by the server so `data-chem` is spelled once. */
	embedHtml: string;
}

export interface ChemDrawingDraft {
	sourceFormat: ChemSourceFormat;
	source: string;
	label: string;
	/** An SVG document (Ketcher's vector export) or a `data:image/png;base64,…` URL. */
	image: string;
}
