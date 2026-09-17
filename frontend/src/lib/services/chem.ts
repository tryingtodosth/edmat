import { apiClient } from '$lib/api/client';
import type { ChemDrawing, ChemDrawingDraft } from '$lib/types/chem';

interface RawChemDrawing {
	id: number;
	author: number;
	source_format: ChemDrawing['sourceFormat'];
	source: string;
	label: string;
	image_url: string;
	image_kind: ChemDrawing['imageKind'];
	width: number;
	height: number;
	embed_html: string;
}

function map(raw: RawChemDrawing): ChemDrawing {
	return {
		id: String(raw.id),
		authorId: String(raw.author),
		sourceFormat: raw.source_format,
		source: raw.source,
		label: raw.label,
		imageUrl: raw.image_url,
		imageKind: raw.image_kind,
		width: raw.width,
		height: raw.height,
		embedHtml: raw.embed_html
	};
}

function body(draft: ChemDrawingDraft) {
	return {
		source_format: draft.sourceFormat,
		source: draft.source,
		label: draft.label,
		image: draft.image
	};
}

export async function createChemDrawing(draft: ChemDrawingDraft): Promise<ChemDrawing> {
	return map(await apiClient.post<RawChemDrawing>('/chem-drawings/', body(draft)));
}

export async function updateChemDrawing(id: string, draft: ChemDrawingDraft): Promise<ChemDrawing> {
	return map(
		await apiClient.put<RawChemDrawing>(`/chem-drawings/${encodeURIComponent(id)}/`, body(draft))
	);
}

export async function getChemDrawing(id: string): Promise<ChemDrawing> {
	return map(await apiClient.get<RawChemDrawing>(`/chem-drawings/${encodeURIComponent(id)}/`));
}
