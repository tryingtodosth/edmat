// 'material' was never a real backend target (see comments.ts's own note — no call site ever used
// it) and stays that way; 'materialCoverage' is the real second target added alongside 'exercise'
// — a discussion thread scoped to one specific topic-subtopic-level claim, not the whole material.
export type CommentTargetType = 'exercise' | 'material' | 'materialCoverage';

export interface Comment {
	id: string;
	targetType: CommentTargetType;
	targetId: string;
	parentId?: string;
	authorId: string;
	body: string;
	createdAt: string;
	isRemoved: boolean; // tombstone, not hard-delete — preserves thread structure, mirrors CLAUDE.md's model
	// True the instant community reports cross the auto-hide threshold (moderation/services.py),
	// independent of — and possibly without ever becoming — isRemoved. Distinct on purpose: this is
	// reversible ("restore," a moderator decided the reports were unfounded), isRemoved isn't.
	isAutoHidden: boolean;
}
