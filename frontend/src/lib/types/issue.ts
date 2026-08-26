// Site issue reports — mirrors backend/issues/models.py. Distinct from the moderation `Report`
// (flagging one piece of content): an issue is about the site, filed from wherever the person was.

export type IssueKind = 'bug' | 'content' | 'idea' | 'other';
export type IssueStatus = 'open' | 'in_progress' | 'resolved' | 'closed';

/** Where the reporter was when they filed it — captured by the modal by default and editable. */
export interface IssueContext {
	path?: string;
	pageTitle?: string;
	locale?: string;
	viewport?: string;
	userAgent?: string;
}

export interface Issue {
	id: string;
	kind: IssueKind;
	title: string;
	body: string;
	context: IssueContext;
	/** Absent for an anonymous or guest report — nothing was stored, so there is nothing to show. */
	reporterId?: string;
	reporterDisplayName: string;
	/** Staff only; '' for everybody else. */
	contactEmail: string;
	isPublic: boolean;
	status: IssueStatus;
	staffNote: string;
	commentCount: number;
	createdAt: string;
	updatedAt: string;
}

export interface IssueDraft {
	kind: IssueKind;
	title: string;
	body: string;
	context: IssueContext;
	anonymous: boolean;
	contactEmail: string;
	isPublic: boolean;
}
