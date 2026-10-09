// Attachments on anything (backend `attachments/`). The only seam between a component and the API
// for this feature — no route or component fetches (frontend/CLAUDE.md's layer boundary).
//
// Two things worth knowing before using it:
//
//  1. **A stored file is never a `/media/` URL.** `getAttachmentFile` fetches a Blob from the
//     tier-checked endpoint through `client.ts`, which is what carries the token; the caller turns
//     it into an object URL or a download. A static path would make every tier decision in
//     `attachments/access.py` decorative — the link would be the leak.
//  2. **One endpoint shape covers nine target kinds.** `/api/<kind>/<id>/attachments/` — the kind is
//     a word in the backend's registry, not a route each app adds, which is why there is one
//     function here and not nine.

import { apiClient } from '$lib/api/client';
import type {
	Attachment,
	AttachmentDraft,
	AttachmentReceipt,
	AttachmentTargetKind
} from '$lib/types/attachment';

/* eslint-disable @typescript-eslint/no-explicit-any */
function mapAttachment(raw: any): Attachment {
	return {
		id: String(raw.id),
		targetKind: raw.target_kind ?? null,
		kind: raw.kind,
		title: raw.title ?? '',
		description: raw.description ?? '',
		body: raw.body ?? '',
		url: raw.url ?? '',
		filePath: raw.file_url ?? null,
		sketchId: raw.sketch != null ? String(raw.sketch) : null,
		sketchImageUrl: raw.sketch_image_url ?? null,
		chemDrawingId: raw.chem_drawing != null ? String(raw.chem_drawing) : null,
		chemImageUrl: raw.chem_image_url ?? null,
		mediaType: raw.media_type ?? '',
		originalName: raw.original_name ?? '',
		byteSize: raw.byte_size ?? 0,
		visibility: raw.visibility,
		requiresAcknowledgement: Boolean(raw.requires_acknowledgement),
		version: raw.version ?? 1,
		uploadedBy: raw.uploaded_by
			? { id: String(raw.uploaded_by.id), displayName: raw.uploaded_by.display_name }
			: null,
		replacedById: raw.replaced_by != null ? String(raw.replaced_by) : null,
		isCurrent: Boolean(raw.is_current),
		acknowledged: Boolean(raw.acknowledged),
		acknowledgementCount: raw.acknowledgement_count ?? 0,
		scanned: Boolean(raw.scanned),
		scanDetail: raw.scan_detail ?? '',
		order: raw.order ?? 0,
		createdAt: raw.created_at ?? ''
	};
}

function mapReceipt(raw: any): AttachmentReceipt {
	return {
		attachmentId: String(raw.attachment),
		user: { id: String(raw.user?.id ?? ''), displayName: raw.user?.display_name ?? '' },
		version: raw.version ?? 1,
		acknowledgedAt: raw.acknowledged_at ?? ''
	};
}
/* eslint-enable @typescript-eslint/no-explicit-any */

export async function getAttachments(
	kind: AttachmentTargetKind,
	id: string
): Promise<Attachment[]> {
	const rows = await apiClient.get<unknown[]>(`/${kind}/${id}/attachments/`);
	return Array.isArray(rows) ? rows.map(mapAttachment) : [];
}

/** Multipart when there is a file, JSON otherwise — the server reads whichever it is given, and a
 *  `FormData` body must never carry an explicit Content-Type (the browser writes its own boundary;
 *  `client.ts` says so at length). */
export async function createAttachment(
	kind: AttachmentTargetKind,
	id: string,
	draft: AttachmentDraft
): Promise<Attachment> {
	const path = `/${kind}/${id}/attachments/`;
	if (draft.file) {
		const form = new FormData();
		form.append('kind', 'file');
		form.append('title', draft.title);
		form.append('description', draft.description ?? '');
		if (draft.visibility) form.append('visibility', draft.visibility);
		if (draft.requiresAcknowledgement) form.append('requires_acknowledgement', 'true');
		form.append('file', draft.file);
		return mapAttachment(await apiClient.postForm(path, form));
	}
	return mapAttachment(
		await apiClient.post(path, {
			kind: draft.kind,
			title: draft.title,
			description: draft.description ?? '',
			visibility: draft.visibility,
			requires_acknowledgement: draft.requiresAcknowledgement ?? false,
			body: draft.body,
			url: draft.url,
			sketch: draft.sketchId ? Number(draft.sketchId) : undefined,
			chem_drawing: draft.chemDrawingId ? Number(draft.chemDrawingId) : undefined
		})
	);
}

export const getAttachmentFile = (id: string): Promise<Blob> =>
	apiClient.getBlob(`/attachments/${id}/file/`);

export const acknowledgeAttachment = async (id: string): Promise<Attachment> =>
	mapAttachment(await apiClient.post(`/attachments/${id}/acknowledge/`, {}));

export const withdrawAttachment = async (id: string): Promise<Attachment> =>
	mapAttachment(await apiClient.post(`/attachments/${id}/withdraw/`, {}));

export async function getAttachmentReceipts(id: string): Promise<AttachmentReceipt[]> {
	const rows = await apiClient.get<unknown[]>(`/attachments/${id}/receipts/`);
	return Array.isArray(rows) ? rows.map(mapReceipt) : [];
}
