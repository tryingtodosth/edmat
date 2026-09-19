// Pictures somebody added to a piece of content (backend/galleries/). Distinct from a comment
// attachment: an attachment belongs to one person's remark, a gallery belongs to the content and is
// the same set whoever is reading.

/** What a gallery can hang off. Mirrors `GALLERY_TARGETS` in backend/galleries/models.py — a
 *  deliberately much shorter list than the comment-target union, and the two are not derived from
 *  each other, so adding a target means editing both. */
export type GalleryTargetType = 'material' | 'exercise' | 'post';

export interface GalleryImage {
	id: string;
	url: string;
	caption: string;
	order: number;
	width: number;
	height: number;
	sizeBytes: number;
	originalName: string;
	uploadedByUserId: string | null;
	uploadedByDisplayName: string;
	/** Whether the viewer may caption or remove THIS picture — their own, or any of them if they
	 *  curate the gallery. Answered per row by the server so the rule lives in one place. */
	canEdit: boolean;
}

export interface Gallery {
	/** null when nothing has been added yet — "no pictures" rather than "no such content". */
	id: string | null;
	targetType: GalleryTargetType;
	targetId: string;
	images: GalleryImage[];
	/** Ordering, and editing somebody else's picture. Earned through a governor application. */
	canCurate: boolean;
	canAdd: boolean;
}
