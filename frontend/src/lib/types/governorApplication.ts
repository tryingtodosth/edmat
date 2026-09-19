// Asking to look after a discipline, a branch or one material (backend/moderation/applications.py).

export type GovernorNodeKind = 'discipline' | 'branch' | 'material';
export type GovernorApplicationStatus = 'pending' | 'approved' | 'declined' | 'withdrawn';

export interface GovernorApplication {
	id: string;
	applicantUserId: string;
	applicantDisplayName: string;
	kind: GovernorNodeKind;
	nodeLabel: string;
	/** A slug for a discipline or branch, a numeric id for a material — the same value the API
	 *  takes back. Opaque here; never parsed. */
	nodeRef: string;
	statement: string;
	status: GovernorApplicationStatus;
	/** How many people are ahead, including this one. null once it has been decided — there is no
	 *  way to change it, by design (see the model's own docstring). */
	queuePosition: number | null;
	decisionNote: string;
	decidedByDisplayName: string;
	decidedAt: string | null;
	createdAt: string;
}
