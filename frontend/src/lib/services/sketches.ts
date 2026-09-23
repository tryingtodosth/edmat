import { apiClient } from '$lib/api/client';
import type { Sketch, SketchDraft } from '$lib/types/sketch';

interface RawSketch {
	id: number;
	author: number;
	source: string;
	label: string;
	image_url: string;
	width: number;
	height: number;
	embed_html: string;
}

function map(raw: RawSketch): Sketch {
	return {
		id: String(raw.id),
		authorId: String(raw.author),
		source: raw.source,
		label: raw.label,
		imageUrl: raw.image_url,
		width: raw.width,
		height: raw.height,
		embedHtml: raw.embed_html
	};
}

function body(draft: SketchDraft) {
	return { source: draft.source, label: draft.label, image: draft.image };
}

export async function createSketch(draft: SketchDraft): Promise<Sketch> {
	return map(await apiClient.post<RawSketch>('/sketches/', body(draft)));
}

export async function updateSketch(id: string, draft: SketchDraft): Promise<Sketch> {
	return map(await apiClient.put<RawSketch>(`/sketches/${encodeURIComponent(id)}/`, body(draft)));
}

export async function getSketch(id: string): Promise<Sketch> {
	return map(await apiClient.get<RawSketch>(`/sketches/${encodeURIComponent(id)}/`));
}
