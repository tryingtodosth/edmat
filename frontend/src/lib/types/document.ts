// Event documents and the acknowledgement ledger (backend `documents/`, CONFERENCE-BRIEF.md §3.C).
//
// The one shape to hold on to: **a document is visible to a TIER, and a mandatory one is not read
// until somebody says so at the version they saw.** The tiers are a ladder —
// `public ⊂ attendees ⊂ staff ⊂ organisers` — plus `venue`, which is off the ladder because the
// building's administrators are neither above nor below an organiser. Until step A lands, only
// organisers answer to it (`documents/access.py: venue_admin_check`).
//
// `DocumentTier` mirrors `VISIBILITY_CHOICES` in backend/documents/models.py, and the label maps
// that go with it live at the end of `lib/utils/labels.ts` — both files name each other, house
// rule 13.

export type DocumentTier = 'public' | 'attendees' | 'staff' | 'organisers' | 'venue';

export type DocumentKind = 'file' | 'link';

export interface EventDocument {
	id: string;
	eventId: string;
	title: string;
	kind: DocumentKind;
	/** Where a `link` document points. Empty for a `file` one. */
	url: string;
	/** The PROTECTED endpoint's path (`/documents/{id}/file/`), never a `/media/` URL — the tier is
	 *  re-checked on every request, so the bytes are fetched through `lib/api/client.ts` with the
	 *  token attached. Null for a link document. */
	filePath: string | null;
	contentType: string;
	byteSize: number;
	visibility: DocumentTier;
	requiresAcknowledgement: boolean;
	version: number;
	uploadedBy: { id: string; displayName: string } | null;
	/** Set on the row this one supersedes; a superseded document refuses acknowledgement with 409. */
	replacedById: string | null;
	isCurrent: boolean;
	/** Whether the person asking has acknowledged THIS version. */
	acknowledged: boolean;
	acknowledgementCount: number;
	/** `false` means no scanner was reachable — never "clean" (house rule 10). An image is always
	 *  false, and honestly so: it was re-encoded from its pixels, so there is nothing to scan. */
	scanned: boolean;
	scanDetail: string;
	createdAt: string;
}

/** One cell of the organiser's read-receipt table: a person and what they have read. */
export interface DocumentReceipt {
	userId: string;
	userDisplayName: string;
	documentId: string;
	version: number;
	acknowledgedAt: string | null;
	outstanding: boolean;
}

/** What the API refuses a day-of action with when a briefing is unread (409 `briefing_unread`) —
 *  the ids, because "you have not read the briefing" is only actionable if it says which one. */
export interface BriefingBlock {
	documentIds: string[];
	titles: string[];
}

export interface EventDocumentDraft {
	title: string;
	kind: DocumentKind;
	visibility: DocumentTier;
	requiresAcknowledgement: boolean;
	url?: string;
	file?: File;
}
