// DSA Art. 16 legal notices — mirrors backend/legal/models.py. Distinct from `Issue`: never
// gated by a FeatureFlag, always requires a contact email even for a guest, and never publicly
// listed — see backend/legal/models.py's own module doc comment for the full reasoning.

export type LegalNoticeStatus = 'open' | 'acted' | 'rejected';

export interface LegalNotice {
	id: string;
	contentUrl: string;
	explanation: string;
	goodFaithConfirmed: boolean;
	notifierName: string;
	contactEmail: string;
	reporterId?: string;
	status: LegalNoticeStatus;
	contentKind: string;
	contentObjectId?: number;
	resolveNote: string;
	createdAt: string;
	updatedAt: string;
}

export interface LegalNoticeDraft {
	contentUrl: string;
	explanation: string;
	goodFaithConfirmed: boolean;
	notifierName: string;
	contactEmail: string;
}

/** Staff looking up who posted the content a notice points at, before deciding — see
 * backend/legal/views.py's `content_preview` action. `authorId`/`authorDisplayName` are both
 * absent, honestly, when the content has no real owner (e.g. most of the migrated corpus). */
export interface LegalNoticeContentPreview {
	preview: string;
	authorId?: string;
	authorDisplayName: string;
}
