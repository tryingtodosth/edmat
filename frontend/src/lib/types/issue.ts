// Site issue reports — mirrors backend/issues/models.py. Distinct from the moderation `Report`
// (flagging one piece of content): an issue is about the site, filed from wherever the person was.

export type IssueKind = 'bug' | 'content' | 'idea' | 'other';
export type IssueStatus = 'open' | 'in_progress' | 'resolved' | 'closed';

/** Which product the report was filed from. `kind` says what sort of problem it is; this says
 *  where it happened, and the two are deliberately independent. */
export type IssueSource = 'site' | 'school_demo';

/** Which part of that product — the school demo's module ids, mirrored from
 *  `school-management-demo/server/modules.js`. Always '' for a report filed from the site, which
 *  has no areas: the page already travels in `context.path`. */
export type IssueArea =
	| ''
	| 'core'
	| 'logbook'
	| 'grades'
	| 'homeroom'
	| 'principal'
	| 'support'
	| 'registry'
	| 'student'
	| 'parent'
	| 'messages'
	| 'school'
	| 'courses'
	| 'meetings'
	| 'compliance'
	| 'demo';

/** Where the reporter was when they filed it — captured by the modal by default and editable. */
export interface IssueContext {
	path?: string;
	pageTitle?: string;
	locale?: string;
	viewport?: string;
	userAgent?: string;
	/** The role the reporter was in — only the school demo sends it, where the same screen is a
	 *  different product to a parent and to a registrar. */
	role?: string;
}

export interface Issue {
	id: string;
	kind: IssueKind;
	source: IssueSource;
	area: IssueArea;
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
	/** Left unset by the site's own modal — the backend's default says the same thing. */
	source?: IssueSource;
	area?: IssueArea;
	title: string;
	body: string;
	context: IssueContext;
	anonymous: boolean;
	contactEmail: string;
	isPublic: boolean;
}
