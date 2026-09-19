import { apiClient } from '$lib/api/client';
import type { InlineImage } from '$lib/types/inlineImage';

interface RawInlineImage {
	id: number;
	author: number;
	url: string;
	alt: string;
	width: number;
	height: number;
	original_name: string;
	size_bytes: number;
	embed_html: string;
}

function map(raw: RawInlineImage): InlineImage {
	return {
		id: String(raw.id),
		authorId: String(raw.author),
		url: raw.url,
		alt: raw.alt,
		width: raw.width,
		height: raw.height,
		originalName: raw.original_name,
		sizeBytes: raw.size_bytes,
		embedHtml: raw.embed_html
	};
}

/** Multipart, unlike `chem.ts`'s JSON body: a chemistry drawing is a few tens of kilobytes of SVG
 * text, while a photograph is megabytes of binary that base64 would inflate by a third. */
export async function uploadInlineImage(file: File, alt: string): Promise<InlineImage> {
	const form = new FormData();
	form.append('file', file);
	form.append('alt', alt);
	return map(await apiClient.postForm<RawInlineImage>('/inline-images/', form));
}
