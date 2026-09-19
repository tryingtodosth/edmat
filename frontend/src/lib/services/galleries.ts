// The gallery on a piece of content — see backend/galleries/. Every call goes through apiClient;
// no component fetches anything itself (the layer rule).

import { apiClient } from '$lib/api/client';
import {
	mapGallery,
	mapGalleryImage,
	type RawGallery,
	type RawGalleryImage
} from '$lib/api/mappers';
import type { Gallery, GalleryImage, GalleryTargetType } from '$lib/types/gallery';

export async function getGallery(
	targetType: GalleryTargetType,
	targetId: string
): Promise<Gallery | undefined> {
	try {
		const raw = await apiClient.get<RawGallery>(
			`/galleries/for-target/?target_type=${encodeURIComponent(targetType)}&target_id=${encodeURIComponent(targetId)}`
		);
		return mapGallery(raw);
	} catch {
		// A 404 here means the content itself is not readable (or the feature is off) — the caller
		// renders nothing rather than an error, the same shape `getMaterialById` already uses.
		return undefined;
	}
}

export async function addGalleryImage(
	targetType: GalleryTargetType,
	targetId: string,
	file: File,
	caption = ''
): Promise<GalleryImage> {
	const form = new FormData();
	form.set('target_type', targetType);
	form.set('target_id', targetId);
	form.set('image', file);
	if (caption) form.set('caption', caption);
	return mapGalleryImage(await apiClient.postForm<RawGalleryImage>('/gallery-images/', form));
}

export async function setGalleryImageCaption(
	imageId: string,
	caption: string
): Promise<GalleryImage> {
	const form = new FormData();
	form.set('caption', caption);
	return mapGalleryImage(
		await apiClient.patchForm<RawGalleryImage>(
			`/gallery-images/${encodeURIComponent(imageId)}/`,
			form
		)
	);
}

export async function removeGalleryImage(imageId: string): Promise<void> {
	await apiClient.delete(`/gallery-images/${encodeURIComponent(imageId)}/`);
}

/** The full list, in the order they should appear. The API refuses a partial one. */
export async function reorderGallery(galleryId: string, imageIds: string[]): Promise<Gallery> {
	const raw = await apiClient.put<RawGallery>(
		`/galleries/${encodeURIComponent(galleryId)}/order/`,
		{ image_ids: imageIds.map((id) => Number(id)) }
	);
	return mapGallery(raw);
}
