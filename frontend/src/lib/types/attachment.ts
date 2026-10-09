// Attachments on anything (backend `attachments/`, 2026-10-08).
//
// The owner's ask was ".md files, docs, etc, sketches etc for files when creating an event for
// attachements (in multiple places we lack this funcionality)", and their decision, when asked, was
// that this should SUPERSEDE the three narrower tables rather than sit beside them:
// `documents.EventDocument` (an event's tiered briefing pack), `courses.Attachment` (a course's
// files) and `community.CommentAttachment` (a picture on a comment).
//
// Two shapes to hold on to:
//
//  1. **An attachment is visible to a TIER**, and the tiers are a ladder —
//     `public ⊂ members ⊂ staff ⊂ managers` — plus `venue`, which is off the ladder because a
//     building's administrators are neither above nor below an organiser. On a comment only
//     `public` is legal; the API refuses the rest rather than quietly treating them as public.
//  2. **A mandatory one is not read until somebody says so at the version they saw.** A replacement
//     is a new row and the old one keeps its acknowledgements, so "who had read the fire plan that
//     morning" stays answerable.
//
// `AttachmentTargetKind` mirrors `TARGET_KINDS` in backend/attachments/targets.py and
// `AttachmentTier`/`AttachmentKind` mirror that app's own choice lists; the label maps that go with
// them live in `lib/utils/labels.ts`, and both files name each other (house rule 13).

export type AttachmentTargetKind =
	| 'course'
	| 'event'
	| 'material'
	| 'organization'
	| 'contest'
	| 'task'
	| 'plan'
	| 'need'
	| 'goal'
	| 'comment';

export type AttachmentTier = 'public' | 'members' | 'staff' | 'managers' | 'venue';

export type AttachmentKind = 'file' | 'text' | 'link' | 'sketch' | 'chem';

export interface Attachment {
	id: string;
	targetKind: AttachmentTargetKind | null;
	kind: AttachmentKind;
	title: string;
	description: string;
	/** Markdown with this site's LaTeX delimiters, for a `text` attachment — rendered, never
	 *  downloaded. Empty for every other kind. */
	body: string;
	/** Where a `link` attachment points. Empty for every other kind. */
	url: string;
	/** The PROTECTED endpoint's path (`/attachments/{id}/file/`), never a `/media/` URL — the tier
	 *  is re-checked on every request, so the bytes are fetched through `lib/api/client.ts` with the
	 *  token attached. Null for everything that is not a stored file. */
	filePath: string | null;
	sketchId: string | null;
	sketchImageUrl: string | null;
	chemDrawingId: string | null;
	chemImageUrl: string | null;
	/** What the stored file turned out to BE, decided by the server's sniff and never by the
	 *  uploader. */
	mediaType: string;
	/** The uploader's own name for the file. Shown so somebody can recognise what they are about to
	 *  download; never used to decide anything. */
	originalName: string;
	byteSize: number;
	visibility: AttachmentTier;
	requiresAcknowledgement: boolean;
	version: number;
	uploadedBy: { id: string; displayName: string } | null;
	replacedById: string | null;
	isCurrent: boolean;
	/** Whether the reader has acknowledged THIS version. */
	acknowledged: boolean;
	acknowledgementCount: number;
	/** `false` means no scanner was reachable — never "clean" (house rule 10). The panel says which
	 *  of the two it was, because somebody deciding whether to open a stranger's file is entitled to
	 *  know. */
	scanned: boolean;
	scanDetail: string;
	order: number;
	createdAt: string;
}

export interface AttachmentDraft {
	kind: AttachmentKind;
	title: string;
	description?: string;
	visibility?: AttachmentTier;
	requiresAcknowledgement?: boolean;
	file?: File | null;
	body?: string;
	url?: string;
	sketchId?: string;
	chemDrawingId?: string;
}

export interface AttachmentReceipt {
	attachmentId: string;
	user: { id: string; displayName: string };
	version: number;
	acknowledgedAt: string;
}
