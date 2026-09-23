// Event documents (backend `documents/`, CONFERENCE-BRIEF.md §3.C) — one function per endpoint, and
// nothing on this surface calls `fetch` (frontend/CLAUDE.md's layer boundary).
//
// The mapper lives here rather than in `lib/api/mappers.ts`, the way `events.ts`, `chem.ts` and
// `sketches.ts` already keep theirs: this shape is read by exactly one feature.
//
// Two things worth knowing before reading on:
//
// 1. **The file is never a URL you can put in an `<img src>` or an `<a href>`.** The backend serves
//    the bytes from a tier-checked endpoint that needs the token, so `getDocumentFile` fetches a
//    Blob through `client.ts` and the caller turns it into an object URL. A `/media/` path would
//    have made every tier decision in `documents/access.py` decorative.
// 2. **A refusal carries its reason** (house rule 6). `briefingBlockFrom` turns the 409 the check-in
//    endpoint answers with into the block the interstitial renders — parsed here, so no component
//    has to know the reason travelled inside an HTTP body.

import { apiClient, ApiError } from '$lib/api/client';
import type {
	BriefingBlock,
	DocumentReceipt,
	DocumentTier,
	EventDocument,
	EventDocumentDraft
} from '$lib/types/document';

interface RawPerson {
	id: number;
	display_name: string;
}

interface RawEventDocument {
	id: number;
	event: number;
	title: string;
	kind: 'file' | 'link';
	url: string | null;
	file_url: string | null;
	content_type: string | null;
	byte_size: number;
	visibility: DocumentTier;
	requires_acknowledgement: boolean;
	version: number;
	uploaded_by: RawPerson | null;
	replaced_by: number | null;
	is_current: boolean;
	acknowledged: boolean;
	acknowledgement_count: number;
	scanned: boolean;
	scan_detail: string | null;
	created_at: string;
}

interface RawReceipt {
	user: RawPerson;
	document_id: number;
	version: number;
	acknowledged_at: string | null;
	outstanding: boolean;
}

function mapDocument(raw: RawEventDocument): EventDocument {
	return {
		id: String(raw.id),
		eventId: String(raw.event),
		title: raw.title,
		kind: raw.kind,
		url: raw.url ?? '',
		filePath: raw.file_url ?? null,
		contentType: raw.content_type ?? '',
		byteSize: raw.byte_size ?? 0,
		visibility: raw.visibility,
		requiresAcknowledgement: Boolean(raw.requires_acknowledgement),
		version: raw.version,
		uploadedBy: raw.uploaded_by
			? { id: String(raw.uploaded_by.id), displayName: raw.uploaded_by.display_name }
			: null,
		replacedById: raw.replaced_by === null ? null : String(raw.replaced_by),
		isCurrent: Boolean(raw.is_current),
		acknowledged: Boolean(raw.acknowledged),
		acknowledgementCount: raw.acknowledgement_count ?? 0,
		scanned: Boolean(raw.scanned),
		scanDetail: raw.scan_detail ?? '',
		createdAt: raw.created_at
	};
}

function mapReceipt(raw: RawReceipt): DocumentReceipt {
	return {
		userId: String(raw.user.id),
		userDisplayName: raw.user.display_name,
		documentId: String(raw.document_id),
		version: raw.version,
		acknowledgedAt: raw.acknowledged_at,
		outstanding: Boolean(raw.outstanding)
	};
}

function toFormData(draft: EventDocumentDraft): FormData {
	const form = new FormData();
	form.set('title', draft.title);
	form.set('kind', draft.kind);
	form.set('visibility', draft.visibility);
	form.set('requires_acknowledgement', draft.requiresAcknowledgement ? 'true' : 'false');
	if (draft.kind === 'link') form.set('url', draft.url ?? '');
	if (draft.kind === 'file' && draft.file) form.set('file', draft.file);
	return form;
}

export async function getEventDocuments(eventId: string): Promise<EventDocument[]> {
	const raw = await apiClient.get<RawEventDocument[]>(`/events/${eventId}/documents/`);
	return raw.map(mapDocument);
}

export async function createEventDocument(
	eventId: string,
	draft: EventDocumentDraft
): Promise<EventDocument> {
	return mapDocument(
		await apiClient.postForm<RawEventDocument>(`/events/${eventId}/documents/`, toFormData(draft))
	);
}

/** Title, tier and whether it must be read. Never the file — that is `replaceEventDocument`, which
 *  writes a new version, because swapping the bytes under an acknowledgement would turn everybody's
 *  "I have read it" into a claim about text they never saw. */
export async function updateEventDocument(
	id: string,
	patch: Partial<Pick<EventDocument, 'title' | 'visibility' | 'requiresAcknowledgement'>>
): Promise<EventDocument> {
	const body: Record<string, unknown> = {};
	if (patch.title !== undefined) body.title = patch.title;
	if (patch.visibility !== undefined) body.visibility = patch.visibility;
	if (patch.requiresAcknowledgement !== undefined)
		body.requires_acknowledgement = patch.requiresAcknowledgement;
	return mapDocument(await apiClient.patch<RawEventDocument>(`/documents/${id}/`, body));
}

export async function replaceEventDocument(
	id: string,
	draft: EventDocumentDraft
): Promise<EventDocument> {
	return mapDocument(
		await apiClient.postForm<RawEventDocument>(`/documents/${id}/replace/`, toFormData(draft))
	);
}

/** A tombstone on the server (house rule 12): it leaves every list, and the read receipts stay
 *  answerable. */
export const removeEventDocument = (id: string): Promise<void> =>
	apiClient.delete<void>(`/documents/${id}/`);

export async function acknowledgeDocument(id: string): Promise<EventDocument> {
	return mapDocument(await apiClient.post<RawEventDocument>(`/documents/${id}/acknowledge/`));
}

export async function getDocumentReceipts(eventId: string): Promise<DocumentReceipt[]> {
	const raw = await apiClient.get<RawReceipt[]>(`/events/${eventId}/acknowledgements/`);
	return raw.map(mapReceipt);
}

/** The bytes, through the tier-checked endpoint with the token attached. The caller owns the object
 *  URL it makes from this and must revoke it. */
export const getDocumentFile = (id: string): Promise<Blob> =>
	apiClient.getBlob(`/documents/${id}/file/`);

/** The 409 a day-of action answers with when the acting staff member still owes a briefing, or
 *  `null` for any other failure. The check-in panel asks this of whatever it caught; steps D and F
 *  will ask it of the same shape. */
export function briefingBlockFrom(error: unknown): BriefingBlock | null {
	if (!(error instanceof ApiError) || error.status !== 409) return null;
	const body = error.body as
		{ detail?: string; documents?: number[]; titles?: string[] } | undefined;
	if (!body || body.detail !== 'briefing_unread') return null;
	return {
		documentIds: (body.documents ?? []).map(String),
		titles: body.titles ?? []
	};
}
