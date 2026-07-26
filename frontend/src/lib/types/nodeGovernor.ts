// The "node governor" feature — a moderator scoped to ONE taxonomy node (a Field or a Course)
// rather than the whole platform (which stays Django's own global `is_staff`, User.isModerator).
// A Field-level grant cascades down to every Course under it; a Course-level grant is scoped to
// just that one course. See backend moderation/models.py's own NodeGovernor for the full reasoning.

export type GovernableNodeKind = 'field' | 'course';

export interface NodeGovernorGrant {
	id: string;
	userId: string;
	userDisplayName: string;
	nodeType: GovernableNodeKind;
	nodeId: string; // the Field/Course's own slug — every Field/Course reference in this app is
	// slug-keyed, never a raw numeric id (see lib/api/mappers.ts's own id-format convention note)
	nodeLabel: string;
	grantedByUserId: string | null;
	createdAt: string;
}
