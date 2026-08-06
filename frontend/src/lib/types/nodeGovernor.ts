// The "node governor" feature — a moderator scoped to ONE taxonomy node (a Discipline or a Branch)
// rather than the whole platform (which stays Django's own global `is_staff`, User.isModerator).
// A Discipline-level grant cascades down to every Branch under it; a Branch-level grant is scoped to
// just that one branch. See backend moderation/models.py's own NodeGovernor for the full reasoning.

export type GovernableNodeKind = 'discipline' | 'branch';

export interface NodeGovernorGrant {
	id: string;
	userId: string;
	userDisplayName: string;
	nodeType: GovernableNodeKind;
	nodeId: string; // the Discipline/Branch's own slug — every Discipline/Branch reference in this app is
	// slug-keyed, never a raw numeric id (see lib/api/mappers.ts's own id-format convention note)
	nodeLabel: string;
	grantedByUserId: string | null;
	createdAt: string;
}
